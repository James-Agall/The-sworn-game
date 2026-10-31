// warbands.ts: Forts phase G (PLAN-forts-diplomacy-moats.md §7, §10 G, decision 4): wandering warbands of bandits or
// greenskins spawn at the map edge now and then (capped by map size), walk one route (findPath segments) to a
// free spot far from every clan, and found a tier-1 camp there (the fort stamper, the warband as its garrison).
// Far from every player / colonist a warband has no bodies: its position just advances along the route
// (speed x elapsed time); near one it materialises as real mobs that walk the route in a loose pack, and turns to
// fight (dissolves into ordinary hostile mobs) when hit or closed in on. Founded camps grow (sites.ts
// catchUpCampGrowth) and raid from tier 3 (spawnCampRaids, on the normal raid schedule).
import { randomUUID } from "node:crypto";
import { TILE_SIZE, type MobKind } from "@colony/shared/protocol";
import type { Mob, RaidEdge, RaidFactionId, RaidGroup, SiteState, SiteTemplateId, TileCoord } from "./types.js";
import {
  CAMP_RAID_MIN_TIER, CAMP_RAID_RANGE_TILES, CAMP_RAID_SIZE_CAP, CAMP_RESETTLE_COOLDOWN_DAYS, DAY_TICKS, GAME_DAY_TICKS,
  MOB_KIND_CONFIG, MOB_REPATH_TICKS, RAID_FACTIONS, SITE_APRON_TILES, SITE_FORT_MIN_WORLD_TILES, SITE_FORT_SPACING_TILES, SITE_TEMPLATES,
  TEST_HOOKS, WARBAND_AWAKE_TILES, WARBAND_CLAN_CLEARANCE_TILES, WARBAND_COUNT_AT_512, WARBAND_COUNT_EXP,
  WARBAND_ENGAGE_TILES, WARBAND_FIRST_DAY, WARBAND_PACE, WARBAND_SEGMENT_TILES, WARBAND_SETTLE_ATTEMPTS,
  WARBAND_SETTLE_MAX_TC_TILES, WARBAND_SETTLE_MIN_TC_TILES, WARBAND_SIGHT_TILES, WARBAND_SIZE_BASE,
  WARBAND_SIZE_DAYS_PER_MOB, WARBAND_SIZE_MAX, WARBAND_SLEEP_TILES, WARBAND_SPAWN_DAYS,
} from "./constants.js";
import { colonists, hearths, mobs, players, raidGroups, sites, state } from "./state.js";
import { inBounds, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import {
  createRaidMob, isRaidKindUnlocked, pickRaidFactionKind, pickWeightedRaidKind, raidAnchorWithinPathBudget,
  raidDepartureTick, randomRaidAnchor, stepRaidMobToward,
} from "./raids.js";
import { catchUpCampGrowth, isInSiteGrounds, rebuildSiteGrounds, siteFitProblem, stampSiteTemplate, templateSize } from "./sites.js";
import { stampSiteSearch } from "./creative.js";
import { walkMobTo } from "./mobs.js";
import { broadcastEvent } from "./net.js";

export type WarbandFaction = "bandit" | "orc";
export interface Warband {
  id: string;
  faction: WarbandFaction;
  template: SiteTemplateId;
  // Members while abstract (kind -> count); while materialised the living mobs are the truth.
  roster: Partial<Record<MobKind, number>>;
  memberIds: string[];
  route: TileCoord[];
  // Progress along `route` (route index, fractional while abstract).
  idx: number;
  // Camp top-left it heads for; `resettle` = a razed founded camp it re-settles instead.
  x0: number;
  y0: number;
  resettle?: string;
  sighted: boolean;
  materialised: boolean;
  retries: number;
  spawnedTick: number;
  wokeTick: number;
  // Leader path bookkeeping (the route slice the leader walks) and the unstick watch (transient).
  pathBase?: number;
  pathLen?: number;
  lastIdx?: number;
  stuckSecs?: number;
}

const FACTIONS: Record<WarbandFaction, { template: SiteTemplateId; raid: RaidFactionId; label: string }> = {
  bandit: { template: "thornwick", raid: "banditBand", label: "bandit" },
  orc: { template: "grakkar", raid: "greenskinWarband", label: "greenskin" },
};

export const warbands = new Map<string, Warband>();
let nextSpawnDay = 0;

const gameDay = () => Math.floor(state.cycleTick / GAME_DAY_TICKS);
const sumRoster = (r: Partial<Record<MobKind, number>>) => Object.values(r).reduce((a, v) => a + (v ?? 0), 0);
const dTc = (x: number, y: number) =>
  state.townCenters.length === 0 ? Infinity : Math.min(...state.townCenters.map((tc) => Math.hypot(tc.x - x, tc.y - y)));

export function warbandCap(size = state.WORLD_TILES_X): number {
  if (size < SITE_FORT_MIN_WORLD_TILES) return 0;
  return Math.max(1, Math.round(WARBAND_COUNT_AT_512 * Math.pow(size / 512, WARBAND_COUNT_EXP)));
}

// Standing camps a warband founded (they count against the cap with the warbands on the move).
export function campCount(): number {
  let n = 0;
  for (const s of sites.values()) if (s.founded && !s.cleared && !s.captured) n++;
  return n;
}

function members(w: Warband): Mob[] {
  const out: Mob[] = [];
  for (const id of w.memberIds) {
    const m = mobs.get(id);
    if (m) out.push(m);
  }
  return out;
}

function liveRoster(w: Warband): Partial<Record<MobKind, number>> {
  if (!w.materialised) return { ...w.roster };
  const r: Partial<Record<MobKind, number>> = {};
  for (const m of members(w)) r[m.kind] = (r[m.kind] ?? 0) + 1;
  return r;
}

// Tile the warband stands on: its leader's while it has bodies, else its place on the route.
export function warbandTile(w: Warband): TileCoord {
  const leader = w.materialised ? mobs.get(w.memberIds[0] ?? "") : undefined;
  if (leader) return tileOfPixel(leader.x, leader.y);
  return w.route[Math.max(0, Math.min(w.route.length - 1, Math.floor(w.idx)))] ?? { x: 0, y: 0 };
}

// A camp spot for template `t`: a razed founded camp past its cooldown (first), else
// rejection sampling: centre WARBAND_SETTLE_MIN..MAX tiles from the nearest Town Center (the max only for the first
// half of the attempts; a second pass allows WARBAND_CLAN_CLEARANCE_TILES), SITE_FORT_SPACING_TILES from every
// site's keep and every other warband's target, clearable natural ground (siteFitProblem clearable).
function pickCampSpot(id: SiteTemplateId): { x0: number; y0: number; resettle?: string } | null {
  const t = SITE_TEMPLATES[id];
  const { w, h } = templateSize(t);
  const now = state.cycleTick;
  const claimed = new Set(Array.from(warbands.values(), (b) => b.resettle).filter(Boolean));
  const old = Array.from(sites.values()).filter((s) => s.founded && s.cleared && !s.captured && s.template === id && !claimed.has(s.id)
    && now - (s.clearedTick ?? now) >= CAMP_RESETTLE_COOLDOWN_DAYS * GAME_DAY_TICKS);
  if (old.length > 0) {
    const s = old[Math.floor(Math.random() * old.length)];
    return { x0: s.x0, y0: s.y0, resettle: s.id };
  }
  const targets = Array.from(warbands.values(), (b) => ({ x: b.x0 + (w >> 1), y: b.y0 + (h >> 1) }));
  for (const min of [WARBAND_SETTLE_MIN_TC_TILES, WARBAND_CLAN_CLEARANCE_TILES]) {
    for (let attempt = 0; attempt < WARBAND_SETTLE_ATTEMPTS; attempt++) {
      const x0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_X - w - 2));
      const y0 = 1 + Math.floor(Math.random() * (state.WORLD_TILES_Y - h - 2));
      const cx = x0 + (w >> 1);
      const cy = y0 + (h >> 1);
      const d = dTc(cx, cy);
      if (d < min || (d > WARBAND_SETTLE_MAX_TC_TILES && attempt < WARBAND_SETTLE_ATTEMPTS / 2)) continue;
      if (Array.from(sites.values()).some((s) => Math.hypot(s.keepX - cx, s.keepY - cy) < SITE_FORT_SPACING_TILES)) continue;
      if (targets.some((p) => Math.hypot(p.x - cx, p.y - cy) < SITE_FORT_SPACING_TILES)) continue;
      if (siteFitProblem(t, x0, y0, true) !== null) continue;
      return { x0, y0 };
    }
  }
  return null;
}

// A walkable tile 2 in from the map edge nearest (cx, cy), at least WARBAND_CLAN_CLEARANCE_TILES from every Town
// Center (other edges next, then random edge tiles).
function edgeSpawnPoint(cx: number, cy: number): TileCoord | null {
  const W = state.WORLD_TILES_X;
  const H = state.WORLD_TILES_Y;
  const ok = (p: TileCoord) => inBounds(p.x, p.y) && isWalkableTile(p.x, p.y) && dTc(p.x, p.y) >= WARBAND_CLAN_CLEARANCE_TILES;
  const clampX = (x: number) => Math.max(2, Math.min(W - 3, x));
  const clampY = (y: number) => Math.max(2, Math.min(H - 3, y));
  const edges = [
    { d: cx, at: (k: number) => ({ x: 2, y: clampY(cy + k) }) },
    { d: W - 1 - cx, at: (k: number) => ({ x: W - 3, y: clampY(cy + k) }) },
    { d: cy, at: (k: number) => ({ x: clampX(cx + k), y: 2 }) },
    { d: H - 1 - cy, at: (k: number) => ({ x: clampX(cx + k), y: H - 3 }) },
  ].sort((a, b) => a.d - b.d);
  for (const e of edges) {
    for (let k = 0; k <= 60; k += 2) {
      for (const p of [e.at(k), e.at(-k)]) if (ok(p)) return p;
    }
  }
  for (let n = 0; n < 60; n++) {
    const e = edges[n % 4];
    const p = e.at(Math.floor((Math.random() - 0.5) * Math.max(W, H)));
    if (ok(p)) return p;
  }
  return null;
}

// 4-connected straight tiles from a (exclusive) to b (inclusive): the fallback where a segment finds no path.
function lineTiles(a: TileCoord, b: TileCoord): TileCoord[] {
  const out: TileCoord[] = [];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    if (Math.abs(b.x - x) >= Math.abs(b.y - y)) x += Math.sign(b.x - x);
    else y += Math.sign(b.y - y);
    out.push({ x, y });
  }
  return out;
}

// One route per warband: findPath between straight-line waypoints WARBAND_SEGMENT_TILES apart (each well inside
// the path budget), a straight line where a segment finds none.
function buildRoute(start: TileCoord, goal: TileCoord): TileCoord[] {
  const route: TileCoord[] = [start];
  const n = Math.max(1, Math.ceil(Math.hypot(goal.x - start.x, goal.y - start.y) / WARBAND_SEGMENT_TILES));
  let cur = start;
  for (let i = 1; i <= n; i++) {
    let wp = i === n ? goal : { x: Math.round(start.x + ((goal.x - start.x) * i) / n), y: Math.round(start.y + ((goal.y - start.y) * i) / n) };
    if (!isWalkableTile(wp.x, wp.y)) wp = findAdjacentWalkable(wp.x, wp.y) ?? wp;
    const seg = findPath(cur, wp);
    route.push(...(seg && seg.length > 0 ? seg : lineTiles(cur, wp)));
    cur = route[route.length - 1];
  }
  return route;
}

function campGoal(w: Warband): TileCoord {
  const { w: tw, h: th } = templateSize(SITE_TEMPLATES[w.template]);
  const c = { x: w.x0 + (tw >> 1), y: w.y0 + (th >> 1) };
  return isWalkableTile(c.x, c.y) ? c : findAdjacentWalkable(c.x, c.y) ?? c;
}

// Spawns a warband (test hook spawnWarband, creative, the dawn timer). `x0, y0`: its camp's top-left (default: a
// picked spot); `at`: its spawn tile (default: the map edge nearest the camp). A reason string when it cannot.
export function spawnWarband(opts: { faction?: WarbandFaction; x0?: number; y0?: number; at?: TileCoord; size?: number } = {}): Warband | string {
  const day = gameDay();
  const faction: WarbandFaction = opts.faction ?? (day >= 4 && Math.random() < 0.4 ? "orc" : "bandit");
  const template = FACTIONS[faction].template;
  const spot = opts.x0 !== undefined && opts.y0 !== undefined ? { x0: Math.floor(opts.x0), y0: Math.floor(opts.y0) } : pickCampSpot(template);
  if (!spot) return "no free camp spot";
  const { w: tw, h: th } = templateSize(SITE_TEMPLATES[template]);
  const start = opts.at ?? edgeSpawnPoint(spot.x0 + (tw >> 1), spot.y0 + (th >> 1));
  if (!start) return "no spawn tile at the map edge";
  const size = Math.max(1, Math.floor(opts.size ?? Math.min(WARBAND_SIZE_MAX, WARBAND_SIZE_BASE + Math.floor(day / WARBAND_SIZE_DAYS_PER_MOB))));
  const pool = RAID_FACTIONS[FACTIONS[faction].raid].filter((e) => e.core && isRaidKindUnlocked(e.kind, day));
  const roster: Partial<Record<MobKind, number>> = {};
  for (let i = 0; i < size; i++) {
    const kind = pool.length > 0 ? pickWeightedRaidKind(pool) : RAID_FACTIONS[FACTIONS[faction].raid][0].kind;
    roster[kind] = (roster[kind] ?? 0) + 1;
  }
  const w: Warband = {
    id: `warband:${randomUUID()}`, faction, template, roster, memberIds: [], route: [], idx: 0, ...spot,
    sighted: false, materialised: false, retries: 0, spawnedTick: state.cycleTick, wokeTick: state.cycleTick,
  };
  w.route = buildRoute(start, campGoal(w));
  warbands.set(w.id, w);
  return w;
}

// Bodies: the roster as raid-style mobs (no group) around the warband's tile.
function materialise(w: Warband) {
  const at = warbandTile(w);
  const tiles: TileCoord[] = [];
  const seen = new Set<number>([tileIndex(at.x, at.y)]);
  const queue = [at];
  const n = sumRoster(w.roster);
  for (let head = 0; head < queue.length && tiles.length < n && head < 400; head++) {
    const t = queue[head];
    if (isWalkableTile(t.x, t.y)) tiles.push(t);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const p = { x: t.x + dx, y: t.y + dy };
      if (!inBounds(p.x, p.y) || seen.has(tileIndex(p.x, p.y))) continue;
      seen.add(tileIndex(p.x, p.y));
      queue.push(p);
    }
  }
  let k = 0;
  for (const [kind, count] of Object.entries(w.roster) as [MobKind, number][]) {
    for (let i = 0; i < count; i++) {
      const m = createRaidMob(kind, tiles[k++ % Math.max(1, tiles.length)] ?? at, "");
      m.groupId = null;
      m.passive = false;
      m.warbandId = w.id;
      w.memberIds.push(m.id);
    }
  }
  w.materialised = true;
  w.wokeTick = state.cycleTick;
  w.pathBase = undefined;
  w.stuckSecs = 0;
}

function dematerialise(w: Warband) {
  w.roster = liveRoster(w);
  for (const id of w.memberIds) mobs.delete(id);
  w.memberIds = [];
  w.materialised = false;
}

// Hit or closed in on: the members become ordinary hostile mobs (updateMob) and the warband is gone.
function engage(w: Warband) {
  for (const m of members(w)) {
    m.warbandId = undefined;
    m.path = [];
    m.targetType = null;
    m.targetId = null;
    m.repathCooldown = Math.floor(Math.random() * MOB_REPATH_TICKS);
  }
  warbands.delete(w.id);
  broadcastEvent("raid", `The ${FACTIONS[w.faction].label} warband turns to fight!`);
}

function disband(w: Warband) {
  for (const id of w.memberIds) mobs.delete(id);
  warbands.delete(w.id);
}

// The camp site of a razed founded camp goes (its leftover mobs, hearth, grounds) before a warband re-settles it.
function removeSite(s: SiteState) {
  for (const m of Array.from(mobs.values())) if (m.siteId === s.id) mobs.delete(m.id);
  hearths.delete(s.id);
  sites.delete(s.id);
  state.ownerVersion++;
  state.relationsVersion++;
  rebuildSiteGrounds();
}

// Arrived: stamp the camp (tier 1, the warband as its garrison) at the target (re-checked, 12 tiles of search),
// else re-target (3 tries) or disband.
function settle(w: Warband) {
  const roster = liveRoster(w);
  if (sumRoster(roster) === 0) return disband(w);
  const t = SITE_TEMPLATES[w.template];
  let site: SiteState | null = null;
  const old = w.resettle ? sites.get(w.resettle) : undefined;
  if (old && old.cleared && !old.captured) {
    removeSite(old);
    site = stampSiteTemplate(t.id, old.x0, old.y0, { tier: 1, broadcast: true, garrison: roster });
  } else {
    site = stampSiteSearch(t.id, w.x0, w.y0, 12, { tier: 1, garrison: roster }).site;
  }
  if (!site) {
    const spot = ++w.retries <= 3 ? pickCampSpot(w.template) : null;
    if (!spot) return disband(w);
    Object.assign(w, { x0: spot.x0, y0: spot.y0, resettle: spot.resettle, idx: 0, pathBase: undefined });
    w.route = buildRoute(warbandTile(w), campGoal(w));
    const leader = mobs.get(w.memberIds[0] ?? "");
    if (leader) leader.path = [];
    return;
  }
  for (const id of w.memberIds) mobs.delete(id);
  warbands.delete(w.id);
  site.founded = true;
  site.growthTick = site.lastSimTick = state.cycleTick;
  if (w.sighted || state.explored[tileIndex(site.keepX, site.keepY)]) broadcastEvent("raid", `A warband has settled at ${site.name}`);
}

function compass(from: TileCoord, to: TileCoord): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ns = dy < -Math.abs(dx) / 2 ? "north" : dy > Math.abs(dx) / 2 ? "south" : "";
  const ew = dx > Math.abs(dy) / 2 ? "east" : dx < -Math.abs(dy) / 2 ? "west" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "nearby";
}

// sim.ts every tick (inside withHostileMover): materialised warbands walk: the leader follows the route at the
// slowest member's pace x WARBAND_PACE, the rest keep loose slots round it (straight steps, a short path when
// blocked). Members are skipped by updateMob.
export function stepWarbandMobs(dt: number) {
  for (const w of warbands.values()) {
    if (!w.materialised) continue;
    const ms = members(w);
    const leader = ms[0];
    if (!leader) continue;
    const pace = Math.min(...ms.map((m) => m.speed)) * WARBAND_PACE;
    if (leader.path.length === 0 && Math.floor(w.idx) < w.route.length - 1) {
      w.pathBase = Math.floor(w.idx) + 1;
      leader.path = w.route.slice(w.pathBase, w.pathBase + 48);
      w.pathLen = leader.path.length;
    }
    advanceAlongPath(leader, dt, pace);
    if (w.pathBase !== undefined && w.pathLen !== undefined) w.idx = Math.max(w.idx, w.pathBase + (w.pathLen - leader.path.length) - 1);
    for (let i = 1; i < ms.length; i++) {
      const m = ms[i];
      const speed = Math.min(m.speed, pace * 1.4);
      if (m.path.length > 0) {
        advanceAlongPath(m, dt, speed);
        continue;
      }
      if (m.repathCooldown > 0) m.repathCooldown--;
      const a = i * 2.4;
      const r = (1 + Math.floor((i - 1) / 6)) * 1.3 * TILE_SIZE;
      const sx = leader.x + Math.cos(a) * r;
      const sy = leader.y + Math.sin(a) * r;
      if (Math.hypot(m.x - leader.x, m.y - leader.y) > 6 * TILE_SIZE || (!stepRaidMobToward(m, sx, sy, speed, dt) && !stepRaidMobToward(m, leader.x, leader.y, speed, dt))) {
        walkMobTo(m, leader.x, leader.y, speed, dt);
      }
    }
  }
}

// sim.ts once a second: abstract advance (no bodies far from everyone), materialise / dematerialise by the
// nearest player / colonist, sighting toast, engage, unstick, settle on arrival.
export function updateWarbands() {
  if (warbands.size === 0) return;
  const anchors: TileCoord[] = [];
  for (const p of players.values()) if (!p.dead) anchors.push({ x: p.x / TILE_SIZE, y: p.y / TILE_SIZE });
  for (const c of colonists.values()) if (c.hp > 0) anchors.push({ x: c.x / TILE_SIZE, y: c.y / TILE_SIZE });
  const tc = state.townCenters[0];
  for (const w of Array.from(warbands.values())) {
    if (w.materialised) {
      w.memberIds = w.memberIds.filter((id) => mobs.has(id));
      if (w.memberIds.length === 0) {
        warbands.delete(w.id);
        continue;
      }
    }
    let pos = warbandTile(w);
    const near = () => anchors.reduce((d, a) => Math.min(d, Math.max(Math.abs(a.x - pos.x - 0.5), Math.abs(a.y - pos.y - 0.5))), Infinity);
    if (!w.materialised) {
      const speed = Math.min(...(Object.keys(w.roster) as MobKind[]).map((k) => MOB_KIND_CONFIG[k].speed));
      w.idx = Math.min(w.route.length - 1, w.idx + (speed * WARBAND_PACE) / TILE_SIZE);
      pos = warbandTile(w);
      if (near() <= WARBAND_AWAKE_TILES) materialise(w);
    } else {
      const d = near();
      if (d > WARBAND_SLEEP_TILES) dematerialise(w);
      else if (d <= WARBAND_ENGAGE_TILES || members(w).some((m) => m.lastDamagedTick > w.wokeTick)) {
        engage(w);
        continue;
      } else {
        // Stuck (a closed gate, a knot of bodies) for 15 s: hop the leader 3 route tiles on.
        w.stuckSecs = Math.floor(w.idx) === w.lastIdx ? (w.stuckSecs ?? 0) + 1 : 0;
        w.lastIdx = Math.floor(w.idx);
        const leader = mobs.get(w.memberIds[0]);
        if (leader && (w.stuckSecs ?? 0) >= 15 && w.idx < w.route.length - 1) {
          w.idx = Math.min(w.route.length - 1, Math.floor(w.idx) + 3);
          const p = tileToPixelCenter(w.route[Math.floor(w.idx)]);
          Object.assign(leader, { x: p.x, y: p.y, path: [] });
          w.pathBase = undefined;
          w.stuckSecs = 0;
        }
      }
    }
    if (!w.sighted && near() <= WARBAND_SIGHT_TILES) {
      w.sighted = true;
      broadcastEvent("raid", `A ${FACTIONS[w.faction].label} warband is on the move${tc ? ` to the ${compass(tc, pos)}` : ""}`);
    }
    if (w.idx >= w.route.length - 1) settle(w);
  }
}

// Dawn (sim.ts): once the spawn day has come and the cap allows, one warband. Off in scripted tests
// (COLONY_TEST_HOOKS) unless setWarbands turned it on.
export function warbandsDawn() {
  if (TEST_HOOKS && !state.testWarbandsEnabled) return;
  const day = gameDay();
  if (day < Math.max(WARBAND_FIRST_DAY, nextSpawnDay)) return;
  if (warbands.size + campCount() >= warbandCap()) {
    nextSpawnDay = day + 1;
    return;
  }
  spawnWarband();
  nextSpawnDay = day + WARBAND_SPAWN_DAYS + (Math.random() < 0.5 ? 0 : 1);
}

// Raid spawn time (sim.ts, per clan, with spawnRaid): every standing founded camp catches up its growth; a tier
// CAMP_RAID_MIN_TIER camp raids every 2nd night (tier 4 every night) the nearest Town Center within
// CAMP_RAID_RANGE_TILES when that is the active clan's: 3 x tier + day / 4 mobs of its faction, mustered outside
// its walls on the Town Center's side (else at the colony's raid box edge), released through the raid groups.
export function spawnCampRaids(dayIndex: number): RaidGroup[] {
  const out: RaidGroup[] = [];
  const nightfall = dayIndex * GAME_DAY_TICKS + DAY_TICKS;
  for (const s of sites.values()) {
    if (!s.founded || s.cleared || s.captured) continue;
    catchUpCampGrowth(s);
    if (s.tier < CAMP_RAID_MIN_TIER || (s.tier < 4 && (dayIndex + s.num) % 2 !== 0)) continue;
    let tc: TileCoord | undefined;
    let best = Infinity;
    for (const t of state.townCenters) {
      const d = Math.hypot(t.x - s.keepX, t.y - s.keepY);
      if (d < best) [best, tc] = [d, t];
    }
    const own = state.townCenters.find((t) => t === tc);
    if (!tc || !own || best > CAMP_RAID_RANGE_TILES || (own.clan ?? 0) !== state.clan.id) continue;
    const dx = (tc.x - s.keepX) / best;
    const dy = (tc.y - s.keepY) / best;
    let anchor: TileCoord | null = null;
    for (let r = (Math.max(s.x1 - s.x0, s.y1 - s.y0) >> 1) + SITE_APRON_TILES; r < best && !anchor; r++) {
      const p = { x: Math.round(s.keepX + dx * r), y: Math.round(s.keepY + dy * r) };
      if (inBounds(p.x, p.y) && isWalkableTile(p.x, p.y) && !isInSiteGrounds(p.x, p.y)) anchor = p;
    }
    if (!anchor || !raidAnchorWithinPathBudget(anchor)) anchor = randomRaidAnchor()?.tile ?? anchor;
    if (!anchor) continue;
    const faction = FACTIONS[s.faction as WarbandFaction] ?? FACTIONS.bandit;
    const size = Math.min(CAMP_RAID_SIZE_CAP, 3 * s.tier + Math.floor(dayIndex / 4));
    const edge = compass(tc, anchor).split("-")[0];
    const group: RaidGroup = {
      id: randomUUID(), faction: faction.raid, isHorde: false,
      edge: (["north", "south", "east", "west"].includes(edge) ? edge : "north") as RaidEdge,
      memberIds: [], homes: new Map(), aggroTick: nightfall, state: "passive", leaderId: null, offsets: new Map(), repathCooldown: 0,
    };
    const seen = new Set<number>([tileIndex(anchor.x, anchor.y)]);
    const queue = [anchor];
    const tiles: TileCoord[] = [];
    for (let head = 0; head < queue.length && tiles.length < size && head < 600; head++) {
      const t = queue[head];
      tiles.push(t);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = { x: t.x + ox, y: t.y + oy };
        if (!isWalkableTile(p.x, p.y) || isInSiteGrounds(p.x, p.y) || seen.has(tileIndex(p.x, p.y))) continue;
        seen.add(tileIndex(p.x, p.y));
        queue.push(p);
      }
    }
    for (let i = 0; i < size; i++) {
      const tile = tiles[i % tiles.length];
      const m = createRaidMob(pickRaidFactionKind(faction.raid, dayIndex, {}), tile, group.id);
      group.memberIds.push(m.id);
      group.homes.set(m.id, tile);
    }
    if (!state.testHoldRaidAggro) group.aggroTick = raidDepartureTick(anchor, group, nightfall);
    raidGroups.set(group.id, group);
    out.push(group);
    broadcastEvent("raid", s.sighted ? `Raiders muster at ${s.name}` : `Raiders muster to the ${compass(tc, anchor)}`);
  }
  return out;
}

// ---- Saves (optional `warbands`; old saves have none) and the debug view ----
export function warbandsForSave() {
  return {
    nextSpawnDay,
    list: Array.from(warbands.values(), (w) => ({
      id: w.id, faction: w.faction, template: w.template, roster: liveRoster(w), idx: Math.floor(w.idx),
      route: w.route.flatMap((t) => [t.x, t.y]), x0: w.x0, y0: w.y0, resettle: w.resettle, sighted: w.sighted,
      retries: w.retries, spawnedTick: w.spawnedTick,
    })),
  };
}

// After the mobs: saved bodies of warband members go (each warband comes back abstract and re-materialises
// within a second if someone is near). undefined = a new world / an old save.
export function restoreWarbands(saved: ReturnType<typeof warbandsForSave> | undefined) {
  warbands.clear();
  nextSpawnDay = saved?.nextSpawnDay ?? 0;
  for (const m of Array.from(mobs.values())) if (m.warbandId) mobs.delete(m.id);
  for (const s of saved?.list ?? []) {
    const route: TileCoord[] = [];
    for (let i = 0; i + 1 < s.route.length; i += 2) route.push({ x: s.route[i], y: s.route[i + 1] });
    if (route.length === 0 || !(s.template in SITE_TEMPLATES)) continue;
    warbands.set(s.id, {
      id: s.id, faction: s.faction, template: s.template, roster: { ...s.roster }, memberIds: [], route, idx: s.idx,
      x0: s.x0, y0: s.y0, resettle: s.resettle, sighted: s.sighted, materialised: false, retries: s.retries,
      spawnedTick: s.spawnedTick, wokeTick: state.cycleTick,
    });
  }
}

export function warbandsDebug() {
  return {
    cap: warbandCap(), camps: campCount(), nextSpawnDay,
    warbands: Array.from(warbands.values(), (w) => ({
      id: w.id, faction: w.faction, template: w.template, roster: liveRoster(w), idx: w.idx, routeLen: w.route.length,
      tile: warbandTile(w), materialised: w.materialised, members: w.memberIds.length, x0: w.x0, y0: w.y0,
      resettle: w.resettle ?? null, sighted: w.sighted,
    })),
  };
}
