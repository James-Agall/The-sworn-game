// settlementTemplates.ts: neutral human settlement templates (shared/src/settlementTemplates.ts has the format, legend,
// composition with building templates and validation). The store (templateStore.ts: server/data/settlements/*.json +
// the editor's user folder), the stamper (world-gen and the creative editor's "Stamp here") and world-gen's
// generateSettlements (template pick by tier and weight on the seeded Math.random, like the camps).
//
// A stamped settlement is the same SiteState as before (faction "human", kind "fort"): `template` is the behaviour
// profile (SITE_TEMPLATES hearthmoor / ironhold / riverwatch: workers, stock, trade, quests, noun, names, rebuild
// cost), `layout` the settlement template id. Its one keep "K" (a SiteKeep tile) is the anchor every older system keys
// on (relations, trade, levy, vassal, the Elder's talk, capture). Every stamped cell is owned by the site, so the
// buildings' beds never count as the player's homes and its stations stay inert until the settlement is captured.
// Prefab tiles in it (Market stalls, the Tavern counter, the Church altar, ...) keep their interior (5c) entry; the
// modular buildings are walked into directly (no interior map).
import { randomUUID } from "node:crypto";
import { TileType, isGateTile, type MobKind } from "@colony/shared/protocol";
import {
  type SettlementTemplate, settlementLayout, settlementTransforms, transformSettlement, validateSettlementTemplate,
} from "@colony/shared/settlementTemplates";
import type { SiteState, TileCoord } from "./types.js";
import {
  SETTLEMENT_INNER_RING_FRACTION, SETTLEMENT_PLACE_ATTEMPTS, SETTLEMENT_SPACING_TILES, SETTLEMENT_START_CLEARANCE_TILES,
  SITE_APRON_TILES, SITE_FORT_SPACING_TILES, SITE_KEEP_HP_BY_TIER, SITE_TEMPLATES,
} from "./constants.js";
import { gates, hearths, sites, state } from "./state.js";
import { inBounds, setOwner, siteNumber, tileIndex, tileToPixelCenter } from "./tiles.js";
import { pickSiteName, rebuildSiteGrounds, setSiteTile, settlementCounts, siteFitProblem } from "./sites.js";
import { spawnGuardian } from "./worldgen.js";
import { registerHearth } from "./hearths.js";
import { buildingTemplateById } from "./buildingTemplates.js";
import { makeTemplateStore } from "./templateStore.js";

const store = makeTemplateStore<SettlementTemplate>({
  kind: "settlements",
  userEnv: "COLONY_SETTLEMENT_USER_DIR",
  validate: (raw) => validateSettlementTemplate(raw, buildingTemplateById),
  normalise: (o) => ({
    id: o.id, name: o.name, tier: o.tier, weight: o.weight, minStartDist: o.minStartDist, profile: o.profile,
    garrison: { ...o.garrison }, rows: o.rows.slice(), buildings: o.buildings.map((b) => ({ ref: b.ref, x: b.x, y: b.y, ...(b.transform ? { transform: b.transform } : {}) })),
    rotate: o.rotate !== false, mirror: o.mirror !== false,
  }),
});

// Boot: after loadBuildingTemplates (settlements reference building templates).
export function loadSettlementTemplates() {
  const n = store.load();
  for (const tier of [1, 2, 3]) if (!store.all().some((t) => t.builtin && t.tier === tier && t.weight > 0)) throw new Error(`no tier ${tier} settlement template`);
  console.log(`[settlements] ${n.builtins} built-in + ${n.users} user settlement templates`);
}
export const settlementTemplates = () => store.all();
export const settlementTemplateById = (id: string) => store.byId(id);
export const saveUserSettlement = (raw: unknown) => store.save(raw);
export const deleteUserSettlement = (id: string) => store.remove(id);
export const userSettlementDir = () => store.userDir();

// World-gen's pool of a tier (weight > 0), built-ins then user templates by id.
export function settlementPool(tier: number): SettlementTemplate[] {
  return store.all().filter((t) => t.weight > 0 && t.tier === tier);
}

export function pickSettlementTemplate(pool: SettlementTemplate[]): SettlementTemplate {
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of pool) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return pool[0];
}

// Lays template `t` with its top-left at (x0, y0): clears the rectangle + apron (unowned), stamps every cell (owned by
// the new site; gates and doors registered closed), spawns the garrison dormant on the guard slots, registers the keep
// as the site's hearth and adds the SiteState with the NPC homes. The caller checked the spot (siteFitProblem).
export function stampSettlement(t: SettlementTemplate, x0: number, y0: number, opts: { broadcast?: boolean; name?: string } = {}): SiteState {
  const profile = SITE_TEMPLATES[t.profile];
  const l = settlementLayout(t, buildingTemplateById);
  if (!l.keep) throw new Error(`settlement template ${t.id}: no keep`);
  const broadcast = opts.broadcast ?? false;
  const id = `settlement:${randomUUID()}`;
  const num = siteNumber(id, true);
  const a = SITE_APRON_TILES;
  for (let y = y0 - a; y <= y0 + l.h - 1 + a; y++) {
    for (let x = x0 - a; x <= x0 + l.w - 1 + a; x++) {
      setOwner(tileIndex(x, y), 0);
      if (state.tiles[tileIndex(x, y)] !== TileType.Empty) setSiteTile(x, y, TileType.Empty, broadcast);
    }
  }
  for (let ry = 0; ry < l.h; ry++) {
    for (let rx = 0; rx < l.w; rx++) {
      const tile = l.tiles[ry * l.w + rx];
      const x = x0 + rx;
      const y = y0 + ry;
      // Slots and open ground stay Empty (owned when a slot: the folk's ground).
      if (tile < 0) {
        if (t.rows[ry][rx] !== ".") setOwner(tileIndex(x, y), num);
        continue;
      }
      setSiteTile(x, y, tile as TileType, broadcast);
      setOwner(tileIndex(x, y), num);
      if (isGateTile(tile)) gates.set(tileIndex(x, y), { open: false, lock: "auto", clearTicks: 0, overrun: false });
    }
  }
  state.gateTilesDirty = true;
  const keep = { x: x0 + l.keep.x, y: y0 + l.keep.y };
  const at = (p: { x: number; y: number }) => tileIndex(x0 + p.x, y0 + p.y);
  const guardSlots = l.slots.filter((s) => s.kind === "guard").map(at);
  const kinds: MobKind[] = [];
  for (const [kind, n] of Object.entries(t.garrison) as [MobKind, number][]) for (let k = 0; k < n; k++) kinds.push(kind);
  const garrison = kinds.map((kind, k) => {
    const i = guardSlots[k % guardSlots.length];
    return spawnGuardian(kind, { x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) }, id, "fort").id;
  });
  registerHearth(id, "fort", keep, kinds);
  const hearth = hearths.get(id)!;
  hearth.maxHp = hearth.hp = SITE_KEEP_HP_BY_TIER[t.tier - 1] ?? hearth.maxHp;
  hearth.faction = "human";
  // Muster point / leash centre: the road tile beside the keep.
  const beside = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: keep.x + dx, y: keep.y + dy }))
    .find((p) => inBounds(p.x, p.y) && (state.tiles[tileIndex(p.x, p.y)] === TileType.Road || state.tiles[tileIndex(p.x, p.y)] === TileType.CobbleRoad)) ?? { x: keep.x, y: keep.y + 1 };
  const slot = (kind: string) => l.slots.find((s) => s.kind === kind);
  const trader = slot("trader");
  const priest = slot("priest");
  const quest = slot("quest");
  const site: SiteState = {
    id, num, kind: "fort", faction: "human", template: t.profile, name: opts.name ?? pickSiteName(profile),
    x0, y0, x1: x0 + l.w - 1, y1: y0 + l.h - 1, apron: a, keepX: keep.x, keepY: keep.y,
    homeX: tileToPixelCenter(beside).x, homeY: tileToPixelCenter(beside).y,
    tier: 1, growthTick: state.cycleTick, awake: false, lastSimTick: state.cycleTick, provoked: false,
    stock: { ...profile.stock }, garrisonRoster: { ...t.garrison }, garrisonMax: kinds.length, garrison, workers: [],
    posts: Array.from(new Set(guardSlots)), sighted: false, cleared: false, captured: false,
    layout: t.id,
    homes: {
      ...(trader ? { trader: at(trader) } : {}),
      ...(priest ? { priest: at(priest) } : {}),
      ...(quest ? { quest: at(quest) } : {}),
      villagers: [...l.beds, ...l.npcSlots, ...l.slots.filter((s) => s.kind === "villager")].map(at),
    },
  };
  sites.set(id, site);
  rebuildSiteGrounds();
  return site;
}

// World-gen, before generateForts: every settlement of settlementCounts() (towns, then villages, then hamlets: the
// biggest pick their ground first), a weighted template of its tier turned / mirrored as a whole (gap closure G7: one
// of settlementTransforms, on the same seeded Math.random), by rejection sampling: centre >= the template's
// minStartDist (at least SETTLEMENT_START_CLEARANCE_TILES, at most 0.35 of the map side) from every Town Center (and,
// for the first half of the attempts, within SETTLEMENT_INNER_RING_FRACTION of the map side of one),
// >= SETTLEMENT_SPACING_TILES from every other settlement and >= SITE_FORT_SPACING_TILES from every fort, then
// siteFitProblem (Empty ground, off the Abbey / Castle Ruin / other grounds). One that finds no spot is skipped.
export function generateSettlements() {
  const counts = settlementCounts();
  const inner = state.WORLD_TILES_X * SETTLEMENT_INNER_RING_FRACTION;
  const plan: [number, number][] = [[3, counts.riverwatch], [2, counts.ironhold], [1, counts.hearthmoor]];
  for (const [tier, count] of plan) {
    const pool = settlementPool(tier);
    if (pool.length === 0) continue;
    for (let n = 0; n < count; n++) {
      const picked = pickSettlementTemplate(pool);
      const tfs = settlementTransforms(picked, buildingTemplateById);
      const t = transformSettlement(picked, tfs[Math.floor(Math.random() * tfs.length)] ?? 0, buildingTemplateById);
      const w = t.rows[0].length;
      const h = t.rows.length;
      const minStart = Math.max(SETTLEMENT_START_CLEARANCE_TILES, Math.min(t.minStartDist, state.WORLD_TILES_X * 0.35));
      for (let attempt = 0; attempt < SETTLEMENT_PLACE_ATTEMPTS; attempt++) {
        const x0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_X - w - 2));
        const y0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_Y - h - 2));
        const cx = x0 + (w >> 1);
        const cy = y0 + (h >> 1);
        const dTc = Math.min(...state.townCenters.map((tc) => Math.hypot(tc.x - cx, tc.y - cy)));
        if (dTc < minStart || (attempt < SETTLEMENT_PLACE_ATTEMPTS / 2 && dTc > inner)) continue;
        let spaced = true;
        for (const s of sites.values()) {
          const min = s.faction === "human" ? SETTLEMENT_SPACING_TILES : SITE_FORT_SPACING_TILES;
          if (Math.hypot(s.keepX - cx, s.keepY - cy) < min) {
            spaced = false;
            break;
          }
        }
        if (!spaced || siteFitProblem(t, x0, y0) !== null) continue;
        stampSettlement(t, x0, y0);
        break;
      }
    }
  }
}

// Creative "Stamp here" (the settlement editor): centred on the click; the rectangle + apron on the map, off other
// grounds, natural ground only (cleared). A reason string, or the stamped settlement.
export function stampSettlementLive(t: SettlementTemplate, center: TileCoord): string | SiteState {
  const errs = validateSettlementTemplate(t, buildingTemplateById);
  if (errs.length > 0) return errs[0];
  const x0 = center.x - (t.rows[0].length >> 1);
  const y0 = center.y - (t.rows.length >> 1);
  const problem = siteFitProblem(t, x0, y0, true);
  if (problem) return problem;
  const s = stampSettlement(t, x0, y0, { broadcast: true });
  state.ownerVersion++;
  return s;
}
