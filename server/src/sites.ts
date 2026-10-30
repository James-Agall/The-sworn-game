// sites.ts: Forts phase B (PLAN-forts-diplomacy-moats.md §2, §8): stamped NPC forts. SiteState records, the
// ASCII template stamper (SITE_TEMPLATES), world-gen placement, the reserved-grounds mask, save / load.
// Stage 1: stamping + placement + saves only; dormancy / leash / capture build on these records later.
import { randomUUID } from "node:crypto";
import { TileType, type MobKind } from "@colony/shared/protocol";
import type { SiteState, SiteTemplate, SiteTemplateId, TileCoord } from "./types.js";
import {
  SITE_APRON_TILES, SITE_FORT_COUNT_AT_512, SITE_FORT_COUNT_EXP, SITE_FORT_LANDMARK_CLEARANCE_TILES,
  SITE_FORT_MIN_WORLD_TILES, SITE_FORT_PLACE_ATTEMPTS, SITE_FORT_SPACING_TILES, SITE_FORT_START_CLEARANCE_TILES,
  SITE_KEEP_HP_BY_TIER, SITE_ORC_RING_FRACTION, SITE_TEMPLATES, SITE_TEMPLATE_TILES,
} from "./constants.js";
import { buildingHp, buildingLevel, constructionSites, farmPlots, gates, hearths, mobs, sites, state } from "./state.js";
import { inBounds, resourceKey, setOwner, siteNumber, tileIndex, tileToPixelCenter } from "./tiles.js";
import { isInAbbeyGrounds, isInCastleRuinGrounds, shuffled, spawnGuardian } from "./worldgen.js";
import { registerHearth } from "./hearths.js";
import { broadcastTileUpdate } from "./net.js";

// Ground the test-hook stamper may clear (world-gen only ever stamps onto Empty).
const CLEARABLE_TILES = new Set<number>([
  TileType.Empty, TileType.Tree, TileType.Rock, TileType.IronOre, TileType.Water, TileType.Rubble,
  TileType.BerryBush, TileType.BerryBushPicked, TileType.FruitTree, TileType.FruitTreePicked,
  TileType.MushroomPatch, TileType.MushroomPatchPicked,
]);

const validated = new Set<SiteTemplateId>();
// Throws on a malformed template (rows / tiers not rectangular or not the same shape, not exactly one keep,
// unknown symbols, a non-"." cell without a tier digit). Checked once per template, on first stamp.
export function validateTemplate(t: SiteTemplate) {
  if (validated.has(t.id)) return;
  const h = t.rows.length;
  const w = t.rows[0]?.length ?? 0;
  if (h === 0 || w === 0 || t.tiers.length !== h) throw new Error(`site template ${t.id}: bad size`);
  let keeps = 0;
  for (let y = 0; y < h; y++) {
    if (t.rows[y].length !== w || t.tiers[y].length !== w) throw new Error(`site template ${t.id}: row ${y} not ${w} wide`);
    for (let x = 0; x < w; x++) {
      const c = t.rows[y][x];
      if (c === ".") continue;
      if (c !== "D" && SITE_TEMPLATE_TILES[c] === undefined) throw new Error(`site template ${t.id}: unknown "${c}" at ${x},${y}`);
      const tier = Number(t.tiers[y][x]);
      if (!(tier >= 1 && tier <= t.maxTier)) throw new Error(`site template ${t.id}: no tier at ${x},${y}`);
      if (c === "K") keeps++;
    }
  }
  if (keeps !== 1) throw new Error(`site template ${t.id}: ${keeps} keeps`);
  validated.add(t.id);
}

export function templateSize(t: SiteTemplate): { w: number; h: number } {
  return { w: t.rows[0].length, h: t.rows.length };
}

// The symbol a template cell shows at `tier` ("." = open ground). Below its own tier a gate is still a wall
// when the wall ring stands (tier 2+), a wall is a fence (the tier-1 camp), anything else is open.
export function cellAtTier(t: SiteTemplate, x: number, y: number, tier: number): string {
  const c = t.rows[y][x];
  if (c === ".") return ".";
  const at = Number(t.tiers[y][x]);
  if (at <= tier) return c;
  if (c === "G" && tier >= 2) return "#";
  if (c === "#" && tier === 1) return "p";
  return ".";
}

export function siteByNum(num: number): SiteState | undefined {
  for (const s of sites.values()) if (s.num === num) return s;
  return undefined;
}

export function isInSiteGrounds(tx: number, ty: number): boolean {
  return inBounds(tx, ty) && state.siteGrounds[tileIndex(tx, ty)] === 1;
}

// True when a standing (uncaptured) fort's reserved grounds come within `r` tiles (Chebyshev) of (tx, ty).
export function nearSiteGrounds(tx: number, ty: number, r: number): boolean {
  for (const s of sites.values()) {
    if (s.captured) continue;
    if (tx >= s.x0 - s.apron - r && tx <= s.x1 + s.apron + r && ty >= s.y0 - s.apron - r && ty <= s.y1 + s.apron + r) return true;
  }
  return false;
}

// Recomputes the reserved-grounds mask from `sites` (stamp, load, new world, capture).
export function rebuildSiteGrounds() {
  if (state.siteGrounds.length !== state.tiles.length) state.siteGrounds = new Uint8Array(state.tiles.length);
  state.siteGrounds.fill(0);
  for (const s of sites.values()) {
    if (s.captured) continue;
    for (let y = s.y0 - s.apron; y <= s.y1 + s.apron; y++) {
      for (let x = s.x0 - s.apron; x <= s.x1 + s.apron; x++) if (inBounds(x, y)) state.siteGrounds[tileIndex(x, y)] = 1;
    }
  }
}

export function clearSites() {
  sites.clear();
  state.siteGrounds.fill(0);
}

// Whether a template fits with its top-left at (x0, y0): rectangle + apron on the map (1 tile margin),
// clear of the Abbey / Castle Ruin grounds (plus SITE_FORT_LANDMARK_CLEARANCE_TILES) and of other forts'
// grounds; every tile Empty (world-gen) or clearable natural ground (`clearable`, the test hook). A reason
// string when it does not fit, else null.
export function siteFitProblem(t: SiteTemplate, x0: number, y0: number, clearable = false): string | null {
  const { w, h } = templateSize(t);
  const a = SITE_APRON_TILES;
  if (x0 - a < 1 || y0 - a < 1 || x0 + w - 1 + a > state.WORLD_TILES_X - 2 || y0 + h - 1 + a > state.WORLD_TILES_Y - 2) return "off the map";
  const l = SITE_FORT_LANDMARK_CLEARANCE_TILES;
  for (const [cx, cy] of [[x0 - a - l, y0 - a - l], [x0 + w - 1 + a + l, y0 - a - l], [x0 - a - l, y0 + h - 1 + a + l], [x0 + w - 1 + a + l, y0 + h - 1 + a + l], [x0 + (w >> 1), y0 + (h >> 1)]]) {
    if (isInAbbeyGrounds(cx, cy) || isInCastleRuinGrounds(cx, cy)) return "on the Abbey / Castle Ruin grounds";
  }
  for (let y = y0 - a - l; y <= y0 + h - 1 + a + l; y++) {
    for (let x = x0 - a - l; x <= x0 + w - 1 + a + l; x++) {
      if (!inBounds(x, y)) continue;
      if (isInAbbeyGrounds(x, y) || isInCastleRuinGrounds(x, y)) return "on the Abbey / Castle Ruin grounds";
    }
  }
  for (let y = y0 - a; y <= y0 + h - 1 + a; y++) {
    for (let x = x0 - a; x <= x0 + w - 1 + a; x++) {
      const i = tileIndex(x, y);
      if (state.siteGrounds[i] === 1) return "on another fort's grounds";
      if (constructionSites.has(resourceKey(x, y))) return "a construction site is in the way";
      const tile = state.tiles[i];
      if (clearable ? !CLEARABLE_TILES.has(tile) : tile !== TileType.Empty) return `tile ${tile} at ${x},${y} is in the way`;
    }
  }
  return null;
}

function setTile(x: number, y: number, tile: TileType, broadcast: boolean) {
  const key = resourceKey(x, y);
  buildingHp.delete(key);
  buildingLevel.delete(key);
  farmPlots.delete(key);
  const i = tileIndex(x, y);
  if (tile !== TileType.Gate) gates.delete(i);
  state.tiles[i] = tile;
  if (broadcast) broadcastTileUpdate(x, y, tile);
}

// Stamps `templateId` at tier `tier` (default the template's start tier) with its top-left at (x0, y0):
// clears the rectangle + apron, lays the cells (owned by the new site), registers gates (closed) and the
// keep as the site's hearth, spawns the dormant garrison on yard tiles near the keep and adds the SiteState.
// The caller has checked siteFitProblem. `broadcast`: send tile updates (a live world; not world-gen).
export function stampSiteTemplate(
  templateId: SiteTemplateId, x0: number, y0: number, opts: { tier?: number; name?: string; broadcast?: boolean } = {},
): SiteState {
  const t = SITE_TEMPLATES[templateId];
  validateTemplate(t);
  const { w, h } = templateSize(t);
  const tier = Math.max(1, Math.min(t.maxTier, Math.round(opts.tier ?? t.startTier)));
  const broadcast = opts.broadcast ?? false;
  const id = `fort:${randomUUID()}`;
  const num = siteNumber(id, true);
  const a = SITE_APRON_TILES;
  for (let y = y0 - a; y <= y0 + h - 1 + a; y++) {
    for (let x = x0 - a; x <= x0 + w - 1 + a; x++) {
      setOwner(tileIndex(x, y), 0);
      if (state.tiles[tileIndex(x, y)] !== TileType.Empty) setTile(x, y, TileType.Empty, broadcast);
    }
  }
  let keep: TileCoord = { x: x0, y: y0 };
  const gateCells: TileCoord[] = [];
  const yard: TileCoord[] = [];
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const x = x0 + rx;
      const y = y0 + ry;
      const c = cellAtTier(t, rx, ry, tier);
      if (c === "." || c === "D") continue;
      const tile = SITE_TEMPLATE_TILES[c];
      setTile(x, y, tile, broadcast);
      setOwner(tileIndex(x, y), num);
      if (tile === TileType.Gate) {
        gates.set(tileIndex(x, y), { open: false, lock: "auto", clearTicks: 0, overrun: false });
        gateCells.push({ x, y });
      } else if (tile === TileType.SiteKeep) keep = { x, y };
    }
  }
  state.gateTilesDirty = true;
  // Garrison posts: open yard tiles inside the wall ring (flood fill from the keep over the template's
  // non-wall / non-gate cells), not next to a gate, nearest the keep first (a little shuffled).
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  const krx = keep.x - x0;
  const kry = keep.y - y0;
  seen[kry * w + krx] = 1;
  queue.push(kry * w + krx);
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    if (cellAtTier(t, cx, cy, tier) === "." && t.rows[cy][cx] === ".") yard.push({ x: x0 + cx, y: y0 + cy });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx]) continue;
      const c = t.rows[ny][nx];
      if (c === "#" || c === "G") continue;
      seen[ny * w + nx] = 1;
      queue.push(ny * w + nx);
    }
  }
  const posts = shuffled(
    yard.filter((p) => !gateCells.some((g) => Math.max(Math.abs(g.x - p.x), Math.abs(g.y - p.y)) <= 1)),
  ).sort((p, q) => Math.round(Math.hypot(p.x - keep.x, p.y - keep.y) / 3) - Math.round(Math.hypot(q.x - keep.x, q.y - keep.y) / 3));
  const kinds: MobKind[] = [];
  for (const [kind, n] of Object.entries(t.garrison) as [MobKind, number][]) for (let k = 0; k < n; k++) kinds.push(kind);
  const garrison: string[] = [];
  const used: number[] = [];
  kinds.forEach((kind, k) => {
    const spot = posts[k % Math.max(1, posts.length)] ?? keep;
    used.push(tileIndex(spot.x, spot.y));
    garrison.push(spawnGuardian(kind, spot, id, "fort").id);
  });
  registerHearth(id, "fort", keep, kinds);
  const hearth = hearths.get(id)!;
  hearth.maxHp = hearth.hp = SITE_KEEP_HP_BY_TIER[tier - 1] ?? hearth.maxHp;
  hearth.faction = t.faction;
  const home = tileToPixelCenter({ x: keep.x, y: keep.y + 1 });
  const site: SiteState = {
    id, num, kind: "fort", faction: t.faction, template: t.id, name: opts.name ?? pickSiteName(t),
    x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, apron: a, keepX: keep.x, keepY: keep.y, homeX: home.x, homeY: home.y,
    tier, growthTick: state.cycleTick, awake: false, lastSimTick: state.cycleTick, provoked: false,
    stock: { ...t.stock }, garrisonRoster: { ...t.garrison }, garrisonMax: kinds.length, garrison, workers: [], posts: used,
    sighted: false, cleared: false, captured: false,
  };
  sites.set(id, site);
  rebuildSiteGrounds();
  return site;
}

// "<unused name> <label>" ("Thornwick Palisade"); "<name> <label> <n>" once the list is used up.
export function pickSiteName(t: SiteTemplate): string {
  const taken = new Set(Array.from(sites.values(), (s) => s.name));
  const free = t.names.map((n) => `${n} ${t.label}`).filter((n) => !taken.has(n));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  for (let n = 2; ; n++) {
    const name = `${t.names[0]} ${t.label} ${n}`;
    if (!taken.has(name)) return name;
  }
}

export function fortCountFor(templateId: SiteTemplateId, size = state.WORLD_TILES_X): number {
  if (size < SITE_FORT_MIN_WORLD_TILES) return 0;
  return Math.max(1, Math.round(SITE_FORT_COUNT_AT_512[templateId] * Math.pow(size / 512, SITE_FORT_COUNT_EXP)));
}

// World-gen: the orc stockades (outer ring first), then the bandit palisades, each by rejection sampling:
// centre >= SITE_FORT_START_CLEARANCE_TILES from every Town Center and >= SITE_FORT_SPACING_TILES from every
// other fort, then siteFitProblem. Runs after the Abbey / Castle Ruin and before resources are scattered, so
// only ponds compete for the ground. A fort that finds no spot is skipped.
export function generateForts() {
  const order: SiteTemplateId[] = ["grakkar", "thornwick"];
  for (const id of order) {
    const t = SITE_TEMPLATES[id];
    validateTemplate(t);
    const { w, h } = templateSize(t);
    const outer = t.faction === "orc" ? Math.floor(state.WORLD_TILES_X * SITE_ORC_RING_FRACTION) : 0;
    const count = fortCountFor(id);
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < SITE_FORT_PLACE_ATTEMPTS; attempt++) {
        const x0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_X - w - 2));
        const y0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_Y - h - 2));
        const cx = x0 + (w >> 1);
        const cy = y0 + (h >> 1);
        const minStart = Math.max(SITE_FORT_START_CLEARANCE_TILES, attempt < SITE_FORT_PLACE_ATTEMPTS / 2 ? outer : 0);
        if (state.townCenters.some((tc) => Math.hypot(tc.x - cx, tc.y - cy) < minStart)) continue;
        let spaced = true;
        for (const s of sites.values()) {
          if (Math.hypot(s.keepX - cx, s.keepY - cy) < SITE_FORT_SPACING_TILES) {
            spaced = false;
            break;
          }
        }
        if (!spaced || siteFitProblem(t, x0, y0) !== null) continue;
        stampSiteTemplate(id, x0, y0);
        break;
      }
    }
  }
}

// ---- Saves (optional `sites`; old saves have none) ----
export function sitesForSave(): SiteState[] {
  return Array.from(sites.values(), (s) => ({
    ...s, stock: { ...s.stock }, garrisonRoster: { ...s.garrisonRoster }, garrison: [...s.garrison], workers: [...s.workers], posts: [...s.posts],
  }));
}

// After the owner map is restored: re-registers each site's id (site number) and prunes dead garrison ids.
export function restoreSites(list: SiteState[] | undefined) {
  sites.clear();
  for (const s of list ?? []) {
    const num = siteNumber(s.id, true);
    sites.set(s.id, {
      ...s, num, stock: { ...s.stock }, garrisonRoster: { ...s.garrisonRoster },
      garrison: (s.garrison ?? []).filter((m) => mobs.has(m)), workers: (s.workers ?? []).filter((m) => mobs.has(m)), posts: [...(s.posts ?? [])],
      awake: false,
    });
  }
  rebuildSiteGrounds();
}

// Keep razed (hearth destroyed): the keep becomes a RuinedKeep (still the site's) and the site is cleared.
export function onFortKeepDestroyed(siteId: string) {
  const s = sites.get(siteId);
  if (!s) return;
  s.cleared = true;
  state.tiles[tileIndex(s.keepX, s.keepY)] = TileType.RuinedKeep;
  broadcastTileUpdate(s.keepX, s.keepY, TileType.RuinedKeep);
}
