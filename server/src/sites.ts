// sites.ts: Forts phase B (PLAN-forts-diplomacy-moats.md §2, §8): stamped NPC forts. SiteState records, the
// ASCII template stamper (SITE_TEMPLATES), world-gen placement, the reserved-grounds mask, save / load.
// Stage 2: sleeping sites (updateSites), the site-guardian leash (siteLeash), anti-kite surge, loot share.
import { randomUUID } from "node:crypto";
import { TILE_SIZE, TileType, type MobKind } from "@colony/shared/protocol";
import type { Mob, ResourceKey, SiteState, SiteTemplate, SiteTemplateId, SiteWorkerRole, TileCoord } from "./types.js";
import {
  SITE_AGGRO_EDGE_TILES, SITE_AGGRO_TILES, SITE_AWAKE_RADIUS_TILES, SITE_KITE_DECAY_TICKS, SITE_KITE_HITS,
  SITE_LEASH_TILES, SITE_LOOT_STOCK_SHARE, SITE_REFILL_TICKS, SITE_SURGE_COOLDOWN_TICKS, SITE_SURGE_LEASH_TILES,
  SITE_SURGE_TICKS, SITE_SURGE_TOWER_RANGE_TILES,
  SITE_APRON_TILES, SITE_FORT_COUNT_AT_512, SITE_FORT_COUNT_EXP, SITE_FORT_LANDMARK_CLEARANCE_TILES,
  SITE_FORT_MIN_WORLD_TILES, SITE_FORT_PLACE_ATTEMPTS, SITE_FORT_SPACING_TILES, SITE_FORT_START_CLEARANCE_TILES,
  SITE_KEEP_HP_BY_TIER, SITE_ORC_RING_FRACTION, SITE_TEMPLATES, SITE_TEMPLATE_TILES,
  RELATION_ATTACK_PENALTY, RELATION_CONQUEROR_PENALTY, RELATION_MAX, RELATION_MIN, RELATION_NEUTRAL, RELATION_RAZE_PENALTY,
  SETTLEMENT_HOSTILE_TICKS, SETTLEMENT_WORKER_PAUSE_TICKS, SETTLEMENT_WORKER_SPEED_MULT,
  SETTLEMENT_COUNT_AT_512, SETTLEMENT_INNER_RING_FRACTION, SETTLEMENT_PLACE_ATTEMPTS, SETTLEMENT_SPACING_TILES, SETTLEMENT_START_CLEARANCE_TILES,
} from "./constants.js";
import { buildingHp, buildingLevel, colonists, constructionSites, farmPlots, gates, hearths, mobs, players, sites, state, tileOwner } from "./state.js";
import { inBounds, isNightNow, resourceKey, setOwner, siteNumber, tileIndex, tileToPixelCenter } from "./tiles.js";
import { clanById, setTileClan } from "./clans.js";
import { findAdjacentWalkable, isWalkableTile } from "./pathfinding.js";
import type { SiteSnapshot } from "@colony/shared/protocol";
import { isInAbbeyGrounds, isInCastleRuinGrounds, shuffled, spawnGuardian } from "./worldgen.js";
import { registerHearth } from "./hearths.js";
import { broadcastEvent, broadcastTileUpdate } from "./net.js";
import { activateGuardianSite, walkMobTo } from "./mobs.js";

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
      if (c !== "D" && symbolTile(t, c) === undefined) throw new Error(`site template ${t.id}: unknown "${c}" at ${x},${y}`);
      const tier = Number(t.tiers[y][x]);
      if (!(tier >= 1 && tier <= t.maxTier)) throw new Error(`site template ${t.id}: no tier at ${x},${y}`);
      if (c === "K") keeps++;
    }
  }
  if (keeps !== 1) throw new Error(`site template ${t.id}: ${keeps} keeps`);
  validated.add(t.id);
}

// A template cell's tile: the template's own symbol table (human settlements) over the shared legend.
export function symbolTile(t: SiteTemplate, c: string): TileType | undefined {
  return t.symbols?.[c] ?? SITE_TEMPLATE_TILES[c];
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
  const id = `${t.faction === "human" ? "settlement" : "fort"}:${randomUUID()}`;
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
      const tile = symbolTile(t, c)!;
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
  const label = t.label ? ` ${t.label}` : "";
  const free = t.names.map((n) => `${n}${label}`).filter((n) => !taken.has(n));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  for (let n = 2; ; n++) {
    const name = `${t.names[0]}${label} ${n}`;
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

// ---- Forts phase C: human settlements at world-gen ----

// How many of each human template a world of `size` gets (512: 5 Hearthmoor + 3 Ironhold + 2 Riverwatch,
// 256: 2 + 1 + 1, 160: 1 + 1 + 0; none below SITE_FORT_MIN_WORLD_TILES).
export function settlementCounts(size = state.WORLD_TILES_X): Record<"hearthmoor" | "ironhold" | "riverwatch", number> {
  if (size < SITE_FORT_MIN_WORLD_TILES) return { hearthmoor: 0, ironhold: 0, riverwatch: 0 };
  const n = Math.round(SETTLEMENT_COUNT_AT_512 * Math.pow(size / 512, SITE_FORT_COUNT_EXP));
  const riverwatch = Math.floor(n / 4);
  const ironhold = Math.round(n * 0.3);
  return { hearthmoor: Math.max(0, n - riverwatch - ironhold), ironhold, riverwatch };
}

// Before generateForts: the human settlements (Riverwatch first, it is the biggest), by rejection sampling:
// centre >= SETTLEMENT_START_CLEARANCE_TILES from every Town Center (and, for the first half of the attempts,
// within SETTLEMENT_INNER_RING_FRACTION of the map side of one), >= SETTLEMENT_SPACING_TILES from every other
// settlement and >= SITE_FORT_SPACING_TILES from every fort, then siteFitProblem (Empty ground, off the
// Abbey / Castle Ruin / other grounds). One that finds no spot is skipped.
export function generateSettlements() {
  const counts = settlementCounts();
  const inner = state.WORLD_TILES_X * SETTLEMENT_INNER_RING_FRACTION;
  for (const id of ["riverwatch", "ironhold", "hearthmoor"] as const) {
    const t = SITE_TEMPLATES[id];
    validateTemplate(t);
    const { w, h } = templateSize(t);
    for (let n = 0; n < counts[id]; n++) {
      for (let attempt = 0; attempt < SETTLEMENT_PLACE_ATTEMPTS; attempt++) {
        const x0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_X - w - 2));
        const y0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_Y - h - 2));
        const cx = x0 + (w >> 1);
        const cy = y0 + (h >> 1);
        const dTc = Math.min(...state.townCenters.map((tc) => Math.hypot(tc.x - cx, tc.y - cy)));
        if (dTc < SETTLEMENT_START_CLEARANCE_TILES || (attempt < SETTLEMENT_PLACE_ATTEMPTS / 2 && dTc > inner)) continue;
        let spaced = true;
        for (const s of sites.values()) {
          const min = s.faction === "human" ? SETTLEMENT_SPACING_TILES : SITE_FORT_SPACING_TILES;
          if (Math.hypot(s.keepX - cx, s.keepY - cy) < min) {
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
  s.sighted = true;
  state.ownerVersion++;
  state.tiles[tileIndex(s.keepX, s.keepY)] = TileType.RuinedKeep;
  broadcastTileUpdate(s.keepX, s.keepY, TileType.RuinedKeep);
  // Forts phase C: razing a human settlement's keep: its folk flee (the rout) and the clan pays in relation.
  if (s.faction === "human") {
    s.provoked = false;
    adjustRelation(state.clan.id, s.id, -RELATION_RAZE_PENALTY);
    broadcastEvent("raid", `You attacked a settlement: ${s.name} will not forget (relation ${relationOf(state.clan.id, s.id)})`);
  }
}

// ---- Stage 2: sleeping sites, leash, anti-kite, loot ----

// Once a second (sim.ts): a site is awake while a living player or colonist (any clan) is within
// SITE_AWAKE_RADIUS_TILES (Chebyshev) of its keep; waking runs catchUpSite. An awake, uncleared site is
// provoked (its whole garrison wakes) by a player / colonist within SITE_AGGRO_TILES of the keep or
// SITE_AGGRO_EDGE_TILES of its rectangle; it stops being provoked once every guardian is dormant again.
export function updateSites() {
  if (sites.size === 0) return;
  const now = state.cycleTick;
  const anchors: { x: number; y: number; player: boolean }[] = [];
  for (const p of players.values()) if (!p.dead) anchors.push({ x: p.x / TILE_SIZE, y: p.y / TILE_SIZE, player: true });
  for (const c of colonists.values()) if (c.hp > 0) anchors.push({ x: c.x / TILE_SIZE, y: c.y / TILE_SIZE, player: false });
  for (const s of sites.values()) {
    s.garrison = s.garrison.filter((id) => mobs.has(id));
    if (s.captured) {
      s.awake = false;
      continue;
    }
    // Forts phase C: a human settlement is only provoked by being attacked (noteSettlementAttacked), and
    // calms down once its hostile spell runs out; while hostile, closing in wakes it as for a fort.
    const human = s.faction === "human";
    if (human && s.provoked && !s.cleared && now >= (s.hostileUntilTick ?? 0)) calmSettlement(s);
    let awake = false;
    let provoke = false;
    const kx = s.keepX + 0.5;
    const ky = s.keepY + 0.5;
    for (const a of anchors) {
      if (Math.max(Math.abs(a.x - kx), Math.abs(a.y - ky)) > SITE_AWAKE_RADIUS_TILES) continue;
      awake = true;
      if (s.cleared || (a.player && state.testPlayersIgnored) || (human && !s.provoked)) continue;
      const e = SITE_AGGRO_EDGE_TILES;
      if (Math.hypot(a.x - kx, a.y - ky) <= SITE_AGGRO_TILES || (a.x >= s.x0 - e && a.x <= s.x1 + 1 + e && a.y >= s.y0 - e && a.y <= s.y1 + 1 + e)) {
        provoke = true;
        break;
      }
    }
    // Stage 3: "<name> sighted" once its keep tile is explored (the minimap marker appears then).
    if (!s.sighted && state.explored[tileIndex(s.keepX, s.keepY)]) {
      s.sighted = true;
      state.ownerVersion++;
      if (human) broadcastEvent("build", `You sight the ${SITE_TEMPLATES[s.template].noun ?? "village"} of ${s.name}`);
      else broadcastEvent("raid", `${s.name} sighted (${s.faction === "orc" ? "orc stockade" : "bandit palisade"})`);
    }
    if (awake && !s.awake) {
      catchUpSite(s, now);
      if (human) spawnSiteWorkers(s);
    } else if (!awake && s.awake && human) despawnSiteWorkers(s);
    s.awake = awake;
    if (awake) s.lastSimTick = now;
    const garrison = s.garrison.map((id) => mobs.get(id)!);
    if (provoke && awake) {
      if (garrison.some((m) => !m.guardianActive)) activateGuardianSite(s.id);
      s.provoked = true;
    } else if (!human && s.provoked && garrison.every((m) => !m.guardianActive)) s.provoked = false;
    if ((s.kiteHits ?? 0) > 0 && now % SITE_KITE_DECAY_TICKS === 0) s.kiteHits!--;
  }
}

// On waking: one guardian back per SITE_REFILL_TICKS slept (missing kinds of the roster first), up to
// garrisonMax, dormant on the site's posts. Cleared / captured sites never refill.
export function catchUpSite(s: SiteState, now: number) {
  if (s.cleared || s.captured) return;
  let n = Math.floor((now - s.lastSimTick) / SITE_REFILL_TICKS);
  if (n <= 0) return;
  const living = new Map<MobKind, number>();
  for (const id of s.garrison) {
    const m = mobs.get(id);
    if (m) living.set(m.kind, (living.get(m.kind) ?? 0) + 1);
  }
  let k = 0;
  for (const [kind, want] of Object.entries(s.garrisonRoster) as [MobKind, number][]) {
    for (let have = living.get(kind) ?? 0; have < want && n > 0 && s.garrison.length < s.garrisonMax; have++, n--) {
      const post = s.posts[k++ % Math.max(1, s.posts.length)];
      const tile = post === undefined ? { x: s.keepX, y: s.keepY + 1 } : { x: post % state.WORLD_TILES_X, y: Math.floor(post / state.WORLD_TILES_X) };
      s.garrison.push(spawnGuardian(kind, tile, s.id, "fort").id);
    }
  }
}

// True when `num` is a fort's owner-map number and that fort is asleep (its towers / gates do not tick).
export function siteNumAsleep(num: number): boolean {
  if (num === 0) return false;
  const s = siteByNum(num);
  return !!s && !s.awake;
}

// A razed fort's gates let the colony through (builders walk in to rebuild the keep).
export function siteNumCleared(num: number): boolean {
  const s = num === 0 ? undefined : siteByNum(num);
  return !!s && s.cleared;
}

// Extra tower range (tiles) for a fort's towers during its anti-kite surge.
export function siteTowerRangeBonus(num: number): number {
  const s = num === 0 ? undefined : siteByNum(num);
  return s && (s.surgeUntilTick ?? 0) > state.cycleTick ? SITE_SURGE_TOWER_RANGE_TILES : 0;
}

// A site guardian's leash: chase only within `leashPx` of (cx, cy); walk back to its post (px, py).
// `free` = a melee fort defender during the anti-kite surge (does not turn back). Null = no leash (raid
// mobs, the Castle Ruin, a broken / captured fort).
export interface SiteLeash { cx: number; cy: number; px: number; py: number; leashPx: number; free: boolean }
export function siteLeash(mob: Mob): SiteLeash | null {
  if (mob.siteId === null || mob.siteKind === null) return null;
  const tiles = SITE_LEASH_TILES[mob.siteKind];
  if (tiles === undefined) return null;
  if (mob.postX === undefined || mob.postY === undefined) {
    mob.postX = mob.x;
    mob.postY = mob.y;
  }
  if (mob.siteKind !== "fort") return { cx: mob.postX, cy: mob.postY, px: mob.postX, py: mob.postY, leashPx: tiles * TILE_SIZE, free: false };
  const s = sites.get(mob.siteId);
  if (!s || s.cleared || s.captured) return null;
  const surge = (s.surgeUntilTick ?? 0) > state.cycleTick;
  return {
    cx: s.homeX, cy: s.homeY, px: mob.postX, py: mob.postY,
    leashPx: (tiles + (surge ? SITE_SURGE_LEASH_TILES : 0)) * TILE_SIZE, free: surge && mob.melee,
  };
}

// damageMob: a fort guardian hit by a player / colonist standing beyond the leash ring counts a kite hit;
// SITE_KITE_HITS of them start the surge (then a cooldown).
export function noteSiteHit(mob: Mob, attackerKey: string) {
  if (mob.siteKind !== "fort" || mob.siteId === null) return;
  const s = sites.get(mob.siteId);
  if (!s || s.cleared || s.captured) return;
  const a = attackerKey.startsWith("p:") ? players.get(attackerKey.slice(2)) : attackerKey.startsWith("c:") ? colonists.get(attackerKey.slice(2)) : undefined;
  if (!a || Math.hypot(a.x - s.homeX, a.y - s.homeY) <= (SITE_LEASH_TILES.fort ?? 0) * TILE_SIZE) return;
  s.kiteHits = (s.kiteHits ?? 0) + 1;
  const now = state.cycleTick;
  if (s.kiteHits < SITE_KITE_HITS || now < (s.surgeCooldownUntilTick ?? 0)) return;
  s.kiteHits = 0;
  s.surgeUntilTick = now + SITE_SURGE_TICKS;
  s.surgeCooldownUntilTick = s.surgeUntilTick + SITE_SURGE_COOLDOWN_TICKS;
  broadcastEvent("raid", `${s.name} sallies out against the skirmishers!`);
}

// destroyHearth on a fort keep: SITE_LOOT_STOCK_SHARE of its stockpile goes to the current clan's stock.
export function plunderSiteStock(siteId: string): Partial<Record<ResourceKey, number>> {
  const s = sites.get(siteId);
  const loot: Partial<Record<ResourceKey, number>> = {};
  if (!s) return loot;
  for (const [k, v] of Object.entries(s.stock) as [ResourceKey, number][]) {
    const take = Math.floor((v ?? 0) * SITE_LOOT_STOCK_SHARE);
    if (take <= 0) continue;
    loot[k] = take;
    s.stock[k] = v - take;
    state.stock[k] = (state.stock[k] ?? 0) + take;
  }
  return loot;
}

export function siteName(siteId: string): string | undefined {
  return sites.get(siteId)?.name;
}

// ---- Stage 3: capture (rebuild the ruined keep) ----

export function siteAtKeep(tx: number, ty: number): SiteState | undefined {
  for (const s of sites.values()) if (s.keepX === tx && s.keepY === ty) return s;
  return undefined;
}

// Why the ruined keep of `s` cannot be rebuilt yet (null = it can, cost aside).
export function rebuildKeepBlocker(s: SiteState): string | null {
  if (s.captured) return "Already rebuilt";
  if (!s.cleared) return "The keep still stands";
  for (const m of mobs.values()) {
    if (m.siteId === s.id && m.x >= s.x0 * TILE_SIZE && m.x < (s.x1 + 1) * TILE_SIZE && m.y >= s.y0 * TILE_SIZE && m.y < (s.y1 + 1) * TILE_SIZE) return "Defenders still hold the fort";
  }
  return null;
}

// The rebuilt keep is up (a Town Center of `clan` on the keep tile): the fort becomes that clan's outpost.
// Every tile the site owned goes to owner 0 + the clan (walls / gates / towers keep their HP; gates reset
// to "auto"; tents and props stay as decor); the grounds mask drops it. Returns the outpost name.
export function captureSite(s: SiteState, clan: number): string {
  s.captured = true;
  s.capturedBy = clan;
  s.awake = false;
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = tileIndex(x, y);
      if (tileOwner.get(i) !== s.num) continue;
      setOwner(i, 0);
      setTileClan(i, clan);
      const g = gates.get(i);
      if (g) {
        g.lock = "auto";
        g.overrun = false;
      }
    }
  }
  setTileClan(tileIndex(s.keepX, s.keepY), clan);
  state.ownerVersion++;
  rebuildSiteGrounds();
  // Forts phase C: taking a human settlement: every other settlement thinks less of the "Conqueror".
  if (s.faction === "human") {
    for (const o of sites.values()) if (o !== s && o.faction === "human" && !o.cleared) adjustRelation(clan, o.id, -RELATION_CONQUEROR_PENALTY);
  }
  return `${s.name} Outpost`;
}

// Snapshot `sites`: every sighted fort.
export function sitesForSnapshot(): SiteSnapshot[] {
  const out: SiteSnapshot[] = [];
  for (const s of sites.values()) {
    if (!s.sighted) continue;
    out.push({
      name: s.name, faction: s.faction, keepX: s.keepX, keepY: s.keepY, cleared: s.cleared, captured: s.captured,
      ...(s.capturedBy !== undefined ? { capturedBy: s.capturedBy } : {}),
      num: s.num, ...(s.faction === "human" ? { hostile: s.provoked } : {}),
    });
  }
  return out;
}

// ---- Forts phase C: human settlements (neutral until attacked), the relations hook, cosmetic workers ----

// A standing human settlement nobody has attacked lately: its guards stay put, its towers hold fire, its
// gates let the colony through by day, and soldiers never pick its buildings / folk on their own.
export function isNeutralSite(s: SiteState): boolean {
  return s.faction === "human" && !s.cleared && !s.captured && !s.provoked;
}

export function siteNumNeutral(num: number): boolean {
  const s = num === 0 ? undefined : siteByNum(num);
  return !!s && isNeutralSite(s);
}

export function siteIdNeutral(siteId: string): boolean {
  const s = sites.get(siteId);
  return !!s && isNeutralSite(s);
}

// A neutral settlement's gates: open to players / colonists by day, shut at night.
export function siteGateWelcomes(num: number): boolean {
  return siteNumNeutral(num) && !isNightNow();
}

// Relations hook (phase D builds bands / trade / quests on it): one score per clan per settlement, kept in
// Clan.relations keyed by the site's owner-map number (saved with the clan), RELATION_NEUTRAL when unset.
export function relationOf(clanId: number, siteId: string): number {
  const s = sites.get(siteId);
  return s ? clanById(clanId).relations[s.num] ?? RELATION_NEUTRAL : RELATION_NEUTRAL;
}

export function adjustRelation(clanId: number, siteId: string, delta: number): number {
  const s = sites.get(siteId);
  if (!s) return RELATION_NEUTRAL;
  const clan = clanById(clanId);
  const v = Math.max(RELATION_MIN, Math.min(RELATION_MAX, (clan.relations[s.num] ?? RELATION_NEUTRAL) + delta));
  clan.relations[s.num] = v;
  return v;
}

function attackerClan(attackerKey?: string): number {
  if (attackerKey?.startsWith("p:")) return players.get(attackerKey.slice(2))?.clan ?? state.clan.id;
  if (attackerKey?.startsWith("c:")) return colonists.get(attackerKey.slice(2))?.clan ?? state.clan.id;
  return state.clan.id;
}

// Any colony damage to a human settlement's folk, buildings or keep (damageMob / damageBuilding /
// damageHearth): it turns hostile for SETTLEMENT_HOSTILE_TICKS (renewed by every hit), its whole garrison
// wakes, and the attacker's clan loses RELATION_ATTACK_PENALTY once per hostile spell.
export function noteSettlementAttacked(siteId: string | null | undefined, attackerKey?: string) {
  const s = siteId ? sites.get(siteId) : undefined;
  if (!s || s.faction !== "human" || s.cleared || s.captured) return;
  if (!s.provoked) {
    s.provoked = true;
    s.hostileClans = [];
    state.ownerVersion++;
    broadcastEvent("raid", `${s.name} takes up arms: you attacked a neutral settlement!`);
  }
  s.hostileUntilTick = state.cycleTick + SETTLEMENT_HOSTILE_TICKS;
  activateGuardianSite(s.id);
  const clan = attackerClan(attackerKey);
  s.hostileClans ??= [];
  if (!s.hostileClans.includes(clan)) {
    s.hostileClans.push(clan);
    adjustRelation(clan, s.id, -RELATION_ATTACK_PENALTY);
  }
}

// The hostile spell ran out: neutral again, the garrison stands down where it is.
function calmSettlement(s: SiteState) {
  s.provoked = false;
  s.hostileClans = [];
  s.hostileUntilTick = undefined;
  state.ownerVersion++;
  for (const id of s.garrison) {
    const m = mobs.get(id);
    if (!m) continue;
    m.guardianActive = false;
    m.targetType = null;
    m.targetId = null;
    m.path = [];
    m.leashReturnUntilTick = undefined;
  }
  broadcastEvent("build", `${s.name} lays down its arms`);
}

const WORKER_KIND: Record<SiteWorkerRole, MobKind> = { farm: "townFarmer", mine: "townMiner", priest: "townPriest" };

// Work tiles of a settlement by role (walkable tile indices): farm plots, a tile next to each ore / rock
// tile, next to the church; shelter = the yard posts.
function workSpots(s: SiteState): Record<SiteWorkerRole, number[]> {
  const out: Record<SiteWorkerRole, number[]> = { farm: [], mine: [], priest: [] };
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = tileIndex(x, y);
      if (tileOwner.get(i) !== s.num) continue;
      const t = state.tiles[i];
      const role: SiteWorkerRole | null = t === TileType.FarmPlot ? "farm" : t === TileType.IronOre || t === TileType.Rock ? "mine" : t === TileType.ChurchPost ? "priest" : null;
      if (!role) continue;
      const at = isWalkableTile(x, y) ? { x, y } : findAdjacentWalkable(x, y);
      if (at) out[role].push(tileIndex(at.x, at.y));
    }
  }
  return out;
}

const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

// On waking: the template's workers (farmers / miners / a priest), each on a yard post with a work tile.
export function spawnSiteWorkers(s: SiteState) {
  despawnSiteWorkers(s);
  const roles = SITE_TEMPLATES[s.template].workers;
  if (!roles || s.cleared || s.captured || s.posts.length === 0) return;
  const spots = workSpots(s);
  for (const [role, n] of Object.entries(roles) as [SiteWorkerRole, number][]) {
    for (let k = 0; k < n; k++) {
      const home = pick(s.posts)!;
      const work = pick(spots[role]) ?? pick(s.posts)!;
      const m = spawnGuardian(WORKER_KIND[role], { x: home % state.WORLD_TILES_X, y: Math.floor(home / state.WORLD_TILES_X) }, s.id, "fort");
      m.siteWorker = role;
      m.workA = work;
      m.workB = home;
      m.workLeg = 0;
      m.workWaitUntilTick = state.cycleTick + Math.floor(Math.random() * SETTLEMENT_WORKER_PAUSE_TICKS);
      s.workers.push(m.id);
    }
  }
}

// Falling asleep (and before a respawn): the workers go away (they are only there while someone watches).
export function despawnSiteWorkers(s: SiteState) {
  for (const id of s.workers) mobs.delete(id);
  for (const m of Array.from(mobs.values())) if (m.siteId === s.id && m.siteWorker) mobs.delete(m.id);
  s.workers = [];
}

// sim.ts, per tick for a worker mob (instead of updateMob): walk to the work tile, pause, walk back to the
// shelter post, pause, again (a farmer picks another plot each trip). Everyone stays in at night and while
// the settlement is hostile. An asleep site's leftover workers (after a load) do nothing.
export function updateSiteWorker(mob: Mob, dt: number) {
  const s = mob.siteId ? sites.get(mob.siteId) : undefined;
  if (!s || !s.awake || mob.workB === undefined || mob.tactic === "rout" || mob.tactic === "leave") return;
  const now = state.cycleTick;
  const shelter = s.provoked || s.cleared || isNightNow();
  const leg = shelter ? 1 : mob.workLeg ?? 0;
  const goal = leg === 0 ? mob.workA ?? mob.workB : mob.workB;
  const p = tileToPixelCenter({ x: goal % state.WORLD_TILES_X, y: Math.floor(goal / state.WORLD_TILES_X) });
  if (Math.hypot(p.x - mob.x, p.y - mob.y) > TILE_SIZE * 0.4) {
    walkMobTo(mob, p.x, p.y, mob.speed * SETTLEMENT_WORKER_SPEED_MULT, dt);
    return;
  }
  mob.path = [];
  if (shelter) return;
  if (!mob.workWaitUntilTick) {
    mob.workWaitUntilTick = now + Math.floor(SETTLEMENT_WORKER_PAUSE_TICKS * (1 + Math.random()));
    return;
  }
  if (now < mob.workWaitUntilTick) return;
  mob.workWaitUntilTick = 0;
  mob.workLeg = leg === 0 ? 1 : 0;
  if (mob.workLeg === 0 && mob.siteWorker === "farm") mob.workA = pick(workSpots(s).farm) ?? mob.workA;
}
