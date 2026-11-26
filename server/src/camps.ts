// camps.ts: bandit camp templates (shared/src/camps.ts has the format, legend, transforms and validation). The
// template store: built-ins from server/data/camps/*.json (a broken one fails the boot) and the camp editor's user
// templates (server/data/camps/user/*.json; with COLONY_TEST_HOOKS=1 a camps-user folder in COLONY_SAVE_DIR, so
// tests never write into the repo; COLONY_CAMP_USER_DIR overrides both). Plus the stamper (world-gen and creative
// "Stamp here") and world-gen's template / transform pick, all on Math.random, i.e. on the world seed while
// generateWorld runs: the same seed and template pool always lay out the same camps.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { type MobKind, TileType } from "@colony/shared/protocol";
import { CAMP_LEGEND, type CampTemplate, campCells, campRadius, campStats, validateCampTemplate } from "@colony/shared/camps";
import type { Mob, TileCoord } from "./types.js";
import { CAMP_GUARD_WEIGHTS_BY_TIER, CAMP_HEARTH_HP_BY_TIER, SAVE_DIR } from "./constants.js";
import { constructionSites, hearths, state } from "./state.js";
import { setTile } from "./chunks.js";
import { inBounds, resourceKey, tileIndex } from "./tiles.js";
import { broadcastTileUpdate } from "./net.js";
import { pickWeightedGuardianKind, randInt, shuffled, spawnGuardian } from "./worldgen.js";
import { registerHearth } from "./hearths.js";
import { isInSiteGrounds } from "./sites.js";

const BUILTIN_DIR = fileURLToPath(new URL("../data/camps/", import.meta.url));

export function userCampDir(): string {
  if (process.env.COLONY_CAMP_USER_DIR) return path.resolve(process.env.COLONY_CAMP_USER_DIR);
  if (process.env.COLONY_TEST_HOOKS === "1") return path.join(SAVE_DIR, "camps-user");
  return path.join(BUILTIN_DIR, "user");
}

// Only the known fields (a hand-edited file may carry notes).
function normalise(o: CampTemplate): CampTemplate {
  return {
    id: o.id, name: o.name, tier: o.tier, weight: o.weight, minStartDist: o.minStartDist, guards: [o.guards[0], o.guards[1]],
    entrance: o.entrance, rotate: o.rotate, mirror: o.mirror, rows: o.rows.slice(),
  };
}

function readDir(dir: string, strict: boolean): CampTemplate[] {
  if (!existsSync(dir)) return [];
  const out: CampTemplate[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      const errs = validateCampTemplate(raw);
      if (errs.length > 0) throw new Error(errs.join("; "));
      out.push(normalise(raw));
    } catch (err) {
      if (strict) throw new Error(`camp template ${f}: ${(err as Error).message}`);
      console.warn(`[camps] skipping user template ${f}: ${(err as Error).message}`);
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

let builtins: CampTemplate[] | null = null;
let users: CampTemplate[] | null = null;

function ensureLoaded() {
  if (!builtins) {
    builtins = readDir(BUILTIN_DIR, true);
    if (builtins.length === 0) throw new Error(`no camp templates in ${BUILTIN_DIR}`);
    for (const tier of [1, 2, 3]) if (!builtins.some((t) => t.tier === tier && t.weight > 0)) throw new Error(`no tier ${tier} camp template`);
  }
  if (!users) {
    const ids = new Set(builtins.map((t) => t.id));
    users = readDir(userCampDir(), false).filter((t) => {
      if (ids.has(t.id)) console.warn(`[camps] user template ${t.id} shadows a built-in: skipped`);
      return !ids.has(t.id);
    });
  }
}

// Boot: load (and validate) the store now so a broken built-in fails loudly before a world is made.
export function loadCampTemplates() {
  builtins = null;
  users = null;
  ensureLoaded();
  console.log(`[camps] ${builtins!.length} built-in + ${users!.length} user camp templates`);
}

// Built-ins (sorted by id) then user templates (sorted by id): the order world-gen's weighted pick walks.
export function campTemplates(): CampTemplate[] {
  ensureLoaded();
  return [...builtins!.map((t) => ({ ...t, builtin: true })), ...users!];
}

export function campTemplateById(id: string): CampTemplate | undefined {
  return campTemplates().find((t) => t.id === id);
}

// Writes a user template (validated; a built-in's id is refused). An error string, or null when saved.
export function saveUserCamp(raw: unknown): string | null {
  const errs = validateCampTemplate(raw);
  if (errs.length > 0) return errs.join("; ");
  const t = normalise(raw as CampTemplate);
  ensureLoaded();
  if (builtins!.some((b) => b.id === t.id)) return `"${t.id}" is a built-in template: save it under another id (Duplicate)`;
  const dir = userCampDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${t.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(t, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
  users = null;
  return null;
}

export function deleteUserCamp(id: string): string | null {
  ensureLoaded();
  if (builtins!.some((b) => b.id === id)) return "Built-in templates can't be deleted";
  if (!users!.some((u) => u.id === id)) return `No user template "${id}"`;
  rmSync(path.join(userCampDir(), `${id}.json`), { force: true });
  users = null;
  return null;
}

// World-gen's pool: every template with weight > 0 (optionally of one tier), in campTemplates() order.
export function campPool(tier?: number): CampTemplate[] {
  return campTemplates().filter((t) => t.weight > 0 && (tier === undefined || t.tier === tier));
}

export function pickCampTemplate(pool: CampTemplate[]): CampTemplate {
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of pool) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return pool[0];
}

// 0-7 (see campTransform in shared/src/camps.ts), limited by the template's rotate / mirror flags.
export function pickCampTransform(t: CampTemplate): number {
  const turns = t.rotate ? randInt(0, 3) : 0;
  const mirror = t.mirror && Math.random() < 0.5 ? 4 : 0;
  return turns | mirror;
}

export interface StampedCamp {
  siteId: string;
  guards: Mob[];
}

// Natural ground a camp clears from its footprint when stamped (world-gen and creative "Stamp here").
const CLEARABLE = new Set<number>([
  TileType.Empty, TileType.Tree, TileType.Rock, TileType.IronOre, TileType.Rubble,
  TileType.BerryBush, TileType.BerryBushPicked, TileType.FruitTree, TileType.FruitTreePicked,
  TileType.MushroomPatch, TileType.MushroomPatchPicked,
]);

export function campGroundClearable(tile: number): boolean {
  return CLEARABLE.has(tile);
}

// Lays template `t` (turned by `transform`) with its hearth at `center`: clears the natural ground in its
// footprint square, the tiles, the dormant guards on a shuffled pick of the guard slots, the hearth (HP by tier,
// prisoners capped by the prisoner slots, loot chests, the burn radius). The caller checked the spot (world-gen:
// campSpotOk; creative: stampCampLive).
export function stampCamp(t: CampTemplate, center: TileCoord, transform: number, broadcast = false): StampedCamp {
  const siteId = randomUUID();
  const r = campRadius(t);
  for (let y = center.y - r; y <= center.y + r; y++) {
    for (let x = center.x - r; x <= center.x + r; x++) {
      if (!inBounds(x, y) || state.tiles[tileIndex(x, y)] === TileType.Empty || !CLEARABLE.has(state.tiles[tileIndex(x, y)])) continue;
      setTile(tileIndex(x, y), TileType.Empty);
      if (broadcast) broadcastTileUpdate(x, y, TileType.Empty);
    }
  }
  const cells = campCells(t, transform);
  const guardSlots: { x: number; y: number; kind?: MobKind }[] = [];
  for (const c of cells) {
    const x = center.x + c.dx;
    const y = center.y + c.dy;
    const sym = CAMP_LEGEND[c.ch];
    if (sym.tile !== undefined) {
      setTile(tileIndex(x, y), sym.tile);
      if (broadcast) broadcastTileUpdate(x, y, sym.tile);
    }
    if (sym.slot === "guard") guardSlots.push({ x, y, kind: sym.guard });
  }
  const st = campStats(t);
  const tier = Math.max(1, Math.min(3, t.tier));
  const n = randInt(Math.min(t.guards[0], guardSlots.length), Math.min(t.guards[1], guardSlots.length));
  const guards: Mob[] = [];
  for (const slot of shuffled(guardSlots).slice(0, n)) {
    const kind = slot.kind ?? pickWeightedGuardianKind(CAMP_GUARD_WEIGHTS_BY_TIER[tier - 1]);
    guards.push(spawnGuardian(kind, slot, siteId, "encampment"));
  }
  registerHearth(siteId, "encampment", center, guards.map((m) => m.kind), {
    template: t.id, tier, hp: CAMP_HEARTH_HP_BY_TIER[tier - 1], prisonerSlots: st.prisonerSlots, chests: st.lootSlots, radius: r,
  });
  return { siteId, guards };
}

// Creative "Stamp here": the footprint square (the template's radius around the click) must be on the map
// (one tile margin), off fort / settlement grounds, with no standing hearth, building or water in it; natural
// ground is cleared first. A reason string, or the stamped camp.
export function stampCampLive(t: CampTemplate, center: TileCoord, transform: number): string | StampedCamp {
  const errs = validateCampTemplate(t);
  if (errs.length > 0) return errs[0];
  const r = campRadius(t);
  for (let y = center.y - r; y <= center.y + r; y++) {
    for (let x = center.x - r; x <= center.x + r; x++) {
      if (!inBounds(x, y) || x < 1 || y < 1 || x > state.WORLD_TILES_X - 2 || y > state.WORLD_TILES_Y - 2) return "Too close to the map edge";
      if (isInSiteGrounds(x, y)) return "On a fort / settlement's grounds";
      if (constructionSites.has(resourceKey(x, y))) return "A construction site is in the way";
      const tile = state.tiles[tileIndex(x, y)];
      if (!CLEARABLE.has(tile)) return `Something is in the way at ${x},${y} (tile ${tile})`;
    }
  }
  for (const h of hearths.values()) {
    if (!h.destroyed && Math.max(Math.abs(h.x - center.x), Math.abs(h.y - center.y)) <= r) return "Another camp's hearth is in the way";
  }
  return stampCamp(t, center, transform, true);
}
