// structures.ts: Modular building phase 1 (2026-11-09): the server's rooms (shared/src/structures.ts findRooms over
// state.tiles). A room's roof is derived, so this is all there is to "roof presence": isRoofed.
// Bedrooms: every bed in a roofed room is one home slot (population cap: settlementStatsAll; sleeping: people.ts
// assignHomes, colonists.ts assignShelter).
//
// Phase 2 (rooms and quality, shared/src/rooms.ts): each room is a record (id = smallest tile index, tiles,
// contents, dirt, stats). Records are recomputed INCREMENTALLY: chunks.ts setTile logs every room-relevant tile
// write and refresh() re-floods only round those tiles (dropping the rooms they touched); a full recompute runs only
// on a new tile registry (new world / save load) or a bulk edit. Once a second updateRooms adds traffic dirt, cleans
// and refreshes each room's stats; the effects read the cached stats (roomEffects*).
import { TICK_RATE, TILE_SIZE, TileType } from "@colony/shared/protocol";
import { findRooms, floodRoomAt, isRoomBoundaryTile, type Room } from "@colony/shared/structures";
import {
  ROOM_BARRACKS_MORALE_RESIST, ROOM_CLEAN_PER_SEC, ROOM_DINING_HAPPINESS_MAX, ROOM_DIRT_AREA_TILES, ROOM_DIRT_BLOOD,
  ROOM_DIRT_PER_VISITOR_SEC, ROOM_HERO_REST_MULT, ROOM_HERO_REST_QUALITY_MULT, ROOM_ROLE_LABEL, ROOM_SLEEP_HAPPINESS_MAX,
  ROOM_WORKSHOP_GRADE_SCORE, roomEffectLines, roomStationSpeedMult, roomStats, type RoomStats,
  ROOM_CHAPEL_HAPPINESS_MAX, ROOM_CHAPEL_HEAL_BONUS, ROOM_CHAPEL_RANGE_TILES, ROOM_CHAPEL_REVIVE_DISCOUNT, ROOM_HALL_BASE_SHARE,
  ROOM_HALL_DUSK_SECONDS, ROOM_HALL_GATHER_FULL, ROOM_HALL_HAPPINESS_MAX, ROOM_INFIRMARY_HEAL_FRAC_PER_SEC, ROOM_INFIRMARY_HERO_HEAL_MULT,
  ROOM_INFIRMARY_MEDICINE_BONUS, ROOM_INFIRMARY_MEDICINE_ITEM, ROOM_INFIRMARY_MEDICINE_SECONDS, ROOM_INFIRMARY_PRIEST_BONUS,
  ROOM_INFIRMARY_PRIEST_RANGE_TILES, ROOM_STOREROOM_PROTECT_MAX, chapelHasDevotions, infirmaryHealMult, storeroomProtection,
  FOOD_SPOIL_PER_DAY, FOOD_SPOIL_RESOURCES, RAID_THEFT_RESOURCES, RAID_THEFT_SHARE,
} from "@colony/shared/rooms";
import { DAY_TICKS, GAME_DAY_TICKS } from "./constants.js";
import { clanById, withClan } from "./clans.js";
import { itemCount, takeItem } from "./progression.js";
import type { ItemId } from "@colony/shared/progression";
import type { RoomInfo } from "@colony/shared/protocol";
import { colonists, players, state } from "./state.js";
import { tileIndicesOfAny, tileRegistryEpoch, takeRoomDirtyTiles, tileTypesWhere } from "./chunks.js";
import { inBounds, ownerAt, tileIndex } from "./tiles.js";
import { structureHp } from "./combat.js";
import { BUILDING_NAMES } from "./constants.js";
import { clanIdAtIndex } from "./clans.js";
import { winterNow } from "./calendar.js";
import { ROOM_WARM_THRESHOLD, WINTER_ROOM_HAPPINESS_MULT } from "@colony/shared/calendar";

export interface RoomRec extends Room {
  // Traffic / blood dirt 0-100 (saved by room id).
  dirt: number;
  // Cached once a second (updateRooms) and on creation.
  stats: RoomStats;
}

let BOUNDARY: TileType[] | null = null;
let cachedKey = "";
const rooms = new Map<number, RoomRec>();
const roomOfTile = new Map<number, number>();
// Dirt by room id waiting for its room (a save load: the registry is rebuilt before the rooms exist).
let pendingDirt = new Map<number, number>();
// Test / debug counters: full recomputes, incremental passes and tiles flooded by them.
export const roomRecomputeStats = { full: 0, incremental: 0, flooded: 0 };

function newRec(r: Room, dirt: number): RoomRec {
  const rec = r as RoomRec;
  rec.dirt = dirt;
  rec.stats = computeStats(rec);
  return rec;
}

function addRoom(rec: RoomRec) {
  rooms.set(rec.id, rec);
  for (const i of rec.tiles) roomOfTile.set(i, rec.id);
}

function removeRoom(id: number) {
  const r = rooms.get(id);
  if (!r) return;
  for (const i of r.tiles) roomOfTile.delete(i);
  rooms.delete(id);
}

function refresh() {
  const W = state.WORLD_TILES_X;
  const key = `${tileRegistryEpoch()}:${W}:${state.WORLD_TILES_Y}`;
  const tiles = state.tiles;
  const dirty = takeRoomDirtyTiles();
  if (key !== cachedKey || dirty === null) {
    // Full recompute (new world, save load, bulk edit). Dirt carries over by room id.
    cachedKey = key;
    BOUNDARY ??= tileTypesWhere(isRoomBoundaryTile);
    const oldDirt = new Map<number, number>(pendingDirt);
    for (const r of rooms.values()) oldDirt.set(r.id, r.dirt);
    pendingDirt = new Map();
    rooms.clear();
    roomOfTile.clear();
    for (const r of findRooms(W, state.WORLD_TILES_Y, (i) => tiles[i], tileIndicesOfAny(BOUNDARY))) addRoom(newRec(r, oldDirt.get(r.id) ?? 0));
    roomRecomputeStats.full++;
    return;
  }
  if (dirty.length === 0) return;
  // Incremental: drop every room a dirty tile (or its neighbour) belongs to, then re-flood from those tiles.
  const seeds = new Set<number>();
  const H = state.WORLD_TILES_Y;
  for (const i of dirty) {
    seeds.add(i);
    const x = i % W;
    const y = Math.floor(i / W);
    if (x > 0) seeds.add(i - 1);
    if (x < W - 1) seeds.add(i + 1);
    if (y > 0) seeds.add(i - W);
    if (y < H - 1) seeds.add(i + W);
  }
  // Old dirt by tile (a room that changes keeps the dirt of the room it grew from).
  const dirtOfTile = new Map<number, number>();
  for (const s of seeds) {
    const id = roomOfTile.get(s);
    if (id === undefined) continue;
    const r = rooms.get(id)!;
    for (const t of r.tiles) dirtOfTile.set(t, r.dirt);
    removeRoom(id);
  }
  const visited = new Set<number>();
  for (const s of seeds) {
    if (visited.has(s) || isRoomBoundaryTile(tiles[s]) || roomOfTile.has(s)) continue;
    const { room, visited: v } = floodRoomAt(W, H, (i) => tiles[i], s);
    roomRecomputeStats.flooded += v.length;
    for (const t of v) visited.add(t);
    if (!room) continue;
    let dirt = 0;
    for (const t of room.tiles) dirt = Math.max(dirt, dirtOfTile.get(t) ?? 0);
    addRoom(newRec(room, dirt));
  }
  roomRecomputeStats.incremental++;
}

function damagedWalls(r: Room): number {
  const W = state.WORLD_TILES_X;
  const seen = new Set<number>();
  let n = 0;
  for (const i of r.tiles) {
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (seen.has(j) || !isRoomBoundaryTile(state.tiles[j])) continue;
      seen.add(j);
      const hp = structureHp(j % W, Math.floor(j / W));
      if (hp && hp.hp < hp.max) n++;
    }
  }
  return n;
}

function computeStats(r: RoomRec): RoomStats {
  return roomStats({ tiles: r.tiles.length, counts: r.counts, windows: r.windows, stone: r.stone, dirt: r.dirt, damagedWalls: damagedWalls(r) });
}

export function allRooms(): readonly RoomRec[] {
  refresh();
  return Array.from(rooms.values()).sort((a, b) => a.id - b.id);
}

// The room (enclosed, roofed area) a tile is inside, or null.
export function roomAt(tx: number, ty: number): RoomRec | null {
  if (!inBounds(tx, ty)) return null;
  refresh();
  const id = roomOfTile.get(tileIndex(tx, ty));
  return id === undefined ? null : rooms.get(id) ?? null;
}

export function roomAtIndex(i: number): RoomRec | null {
  refresh();
  const id = roomOfTile.get(i);
  return id === undefined ? null : rooms.get(id) ?? null;
}

export function isRoofed(tx: number, ty: number): boolean {
  return roomAt(tx, ty) !== null;
}

// A bed counts (a home slot) only inside a roofed room, and not in an NPC fort. Gap closure G1: an infirmary's beds
// are for patients, not homes.
export function isUsableBed(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Bed || ownerAt(tileIndex(tx, ty)) !== 0) return false;
  const r = roomAt(tx, ty);
  return !!r && r.stats.role !== "infirmary";
}

// Every usable bed's tile index (bedrooms), ascending.
export function usableBedIndices(): number[] {
  refresh();
  const out: number[] = [];
  for (const r of rooms.values()) if (r.stats.role !== "infirmary") for (const i of r.beds) if (ownerAt(i) === 0) out.push(i);
  return out.sort((a, b) => a - b);
}

// ---- phase 2: dirt, stats and effects ----
// Once a second (sim.ts): traffic dirt (every unit / hero standing inside), cleaning, fresh stats.
export function updateRooms() {
  if (state.cycleTick % TICK_RATE !== 0) return;
  refresh();
  if (rooms.size === 0) return;
  const W = state.WORLD_TILES_X;
  const visitors = new Map<number, number>();
  const count = (x: number, y: number) => {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= W || ty >= state.WORLD_TILES_Y) return;
    const id = roomOfTile.get(ty * W + tx);
    if (id !== undefined) visitors.set(id, (visitors.get(id) ?? 0) + 1);
  };
  for (const c of colonists.values()) count(c.x, c.y);
  for (const p of players.values()) if (!p.dead) count(p.x, p.y);
  for (const r of rooms.values()) {
    const v = visitors.get(r.id) ?? 0;
    r.dirt = Math.max(0, Math.min(100, r.dirt + v * ROOM_DIRT_PER_VISITOR_SEC * (ROOM_DIRT_AREA_TILES / Math.max(ROOM_DIRT_AREA_TILES, r.tiles.length)) - ROOM_CLEAN_PER_SEC));
    r.stats = computeStats(r);
  }
  updateHallGatherings();
  updateInfirmaries();
}

// ---- gap closure G1: hall, storeroom, chapel, infirmary ----
// Dusk: the last ROOM_HALL_DUSK_SECONDS of the day (villagers' free time before night).
export function isDuskNow(): boolean {
  const t = state.cycleTick % GAME_DAY_TICKS;
  return t >= DAY_TICKS - ROOM_HALL_DUSK_SECONDS * TICK_RATE && t < DAY_TICKS;
}
// Per clan: the most of its people seen in its best hall this dusk, and during the dusk before.
const hallGather = new Map<number, { now: number; last: number; wasDusk: boolean }>();
function updateHallGatherings() {
  const dusk = isDuskNow();
  const clansSeen = new Set<number>();
  for (const r of rooms.values()) if (r.stats.role === "hall" && ownerAt(r.id) === 0) clansSeen.add(clanOfRoom(r));
  for (const clan of clansSeen) {
    const g = hallGather.get(clan) ?? { now: 0, last: 0, wasDusk: false };
    hallGather.set(clan, g);
    if (dusk && !g.wasDusk) {
      g.last = g.now;
      g.now = 0;
    }
    g.wasDusk = dusk;
    if (!dusk) continue;
    const hall = bestOfRole("hall", clan);
    if (!hall) continue;
    let n = 0;
    for (const c of colonists.values()) if (c.person && (c.clan ?? 0) === clan && roomOfTile.get(tileIndexOfPx(c.x, c.y)) === hall.id) n++;
    g.now = Math.max(g.now, n);
  }
}
const tileIndexOfPx = (x: number, y: number) => Math.floor(y / TILE_SIZE) * state.WORLD_TILES_X + Math.floor(x / TILE_SIZE);
// The clan's best hall (the dusk gathering spot) and its gathering share (0..1).
export function bestHallOf(clan: number): RoomRec | null {
  return bestOfRole("hall", clan);
}
export function hallGatherShare(clan: number): number {
  const g = hallGather.get(clan);
  const gathered = g ? Math.max(g.now, g.last) : 0;
  return ROOM_HALL_BASE_SHARE + (1 - ROOM_HALL_BASE_SHARE) * Math.min(1, gathered / ROOM_HALL_GATHER_FULL);
}
// Test hook: set the clan's gathering count.
export function setHallGathered(clan: number, n: number) {
  hallGather.set(clan, { now: n, last: n, wasDusk: isDuskNow() });
}

// Raid theft: the clan owning (tx, ty) loses RAID_THEFT_SHARE x (1 - protection) of each RAID_THEFT_RESOURCES good.
export function raidTheft(tx: number, ty: number): Record<string, number> {
  if (!inBounds(tx, ty) || ownerAt(tileIndex(tx, ty)) !== 0) return {};
  const clan = clanIdAtIndex(tileIndex(tx, ty));
  const stock = clanById(clan).stock as Record<string, number>;
  const share = RAID_THEFT_SHARE * (1 - storeroomProtectionOf(clan));
  const out: Record<string, number> = {};
  for (const k of RAID_THEFT_RESOURCES) {
    const n = Math.floor((stock[k] ?? 0) * share);
    if (n <= 0) continue;
    stock[k] -= n;
    out[k] = n;
  }
  return out;
}
// Spoilage (once a calendar day, seasons on): FOOD_SPOIL_PER_DAY x (1 - protection) of each food good, per clan.
export function spoilFood(clan: number): Record<string, number> {
  const stock = clanById(clan).stock as Record<string, number>;
  const share = FOOD_SPOIL_PER_DAY * (1 - storeroomProtectionOf(clan));
  const out: Record<string, number> = {};
  for (const k of FOOD_SPOIL_RESOURCES) {
    const n = Math.floor((stock[k] ?? 0) * share);
    if (n <= 0) continue;
    stock[k] -= n;
    out[k] = n;
  }
  return out;
}

// Storeroom: the share of the clan's stock its storerooms protect (spoilage, raid theft), capped.
export function storeroomProtectionOf(clan: number): number {
  refresh();
  let p = 0;
  for (const r of rooms.values()) if (r.stats.role === "storeroom" && ownerAt(r.id) === 0 && clanOfRoom(r) === clan) p += storeroomProtection(r.stats, r.counts);
  return Math.min(ROOM_STOREROOM_PROTECT_MAX, p);
}

// Chapel: the clan's best chapel with devotions (a statue or a lamp), or null.
function bestChapel(clan: number): RoomRec | null {
  refresh();
  let best: RoomRec | null = null;
  for (const r of rooms.values()) {
    if (r.stats.role !== "church" || ownerAt(r.id) !== 0 || clanOfRoom(r) !== clan || !chapelHasDevotions(r.counts)) continue;
    if (!best || r.stats.score > best.stats.score) best = r;
  }
  return best;
}
// Faith: colony happiness from the best chapel x the share of the clan's people who live / are posted near it.
function chapelHappiness(clan: number): number {
  const ch = bestChapel(clan);
  if (!ch) return 0;
  const cx = (ch.x0 + ch.x1) / 2;
  const cy = (ch.y0 + ch.y1) / 2;
  let people = 0;
  let near = 0;
  for (const c of colonists.values()) {
    if (!c.person || (c.clan ?? 0) !== clan) continue;
    people++;
    const hx = c.person.homeX >= 0 ? c.person.homeX : c.postX;
    const hy = c.person.homeX >= 0 ? c.person.homeY : c.postY;
    if (Math.max(Math.abs(hx - cx), Math.abs(hy - cy)) <= ROOM_CHAPEL_RANGE_TILES) near++;
  }
  return people > 0 ? (ROOM_CHAPEL_HAPPINESS_MAX * ch.stats.score / 100) * (near / people) : 0;
}
// The Priest posted at a Church altar (tx, ty): its heal multiplier (a chapel with devotions round it).
export function chapelHealMultAt(tx: number, ty: number): number {
  const r = roomAt(tx, ty);
  if (!r || r.stats.role !== "church" || !chapelHasDevotions(r.counts)) return 1;
  return 1 + ROOM_CHAPEL_HEAL_BONUS * Math.max(0, r.stats.q);
}
// The Church resurrection price multiplier for a clan (its best chapel).
export function chapelReviveMult(clan: number): number {
  const ch = bestChapel(clan);
  return ch ? 1 - (ROOM_CHAPEL_REVIVE_DISCOUNT * ch.stats.score) / 100 : 1;
}

// Infirmary: the heal multiplier at a pixel (0 = not in an infirmary), before medicine.
function infirmaryAtPx(x: number, y: number): RoomRec | null {
  const r = roomAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  return r && r.stats.role === "infirmary" ? r : null;
}
function infirmaryCareMult(r: RoomRec): number {
  const clan = clanOfRoom(r);
  const R = ROOM_INFIRMARY_PRIEST_RANGE_TILES * TILE_SIZE;
  const cx = ((r.x0 + r.x1 + 1) / 2) * TILE_SIZE;
  const cy = ((r.y0 + r.y1 + 1) / 2) * TILE_SIZE;
  let carer = false;
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clan || (c.kind !== "bishop" && c.kind !== "forager")) continue;
    if (Math.hypot(c.x - cx, c.y - cy) <= R) {
      carer = true;
      break;
    }
  }
  return infirmaryHealMult(r.stats) * (carer ? 1 + ROOM_INFIRMARY_PRIEST_BONUS : 1);
}
// Seconds of medicine left per patient (colonist id).
const medicineLeft = new Map<string, number>();
// Test / debug: heal events this session.
export const infirmaryStats = { healed: 0, doses: 0 };
// Once a second: up to one hurt villager / soldier per bed inside each infirmary heals; a dose of herbs (from the
// clan's stores) doubles it for ROOM_INFIRMARY_MEDICINE_SECONDS.
function updateInfirmaries() {
  const patients = new Map<number, number>();
  for (const c of colonists.values()) {
    if (c.hp <= 0 || c.hp >= c.maxHp) {
      medicineLeft.delete(c.id);
      continue;
    }
    const r = infirmaryAtPx(c.x, c.y);
    if (!r || clanOfRoom(r) !== (c.clan ?? 0)) continue;
    const n = patients.get(r.id) ?? 0;
    if (n >= r.beds.length) continue;
    patients.set(r.id, n + 1);
    let mult = infirmaryCareMult(r);
    let left = medicineLeft.get(c.id) ?? 0;
    if (left <= 0) {
      const took = withClan(clanById(c.clan ?? 0), () => itemCount(ROOM_INFIRMARY_MEDICINE_ITEM as ItemId) >= 1 && takeItem(ROOM_INFIRMARY_MEDICINE_ITEM as ItemId, 1));
      if (took) {
        left = ROOM_INFIRMARY_MEDICINE_SECONDS;
        infirmaryStats.doses++;
      }
    }
    if (left > 0) {
      mult *= 1 + ROOM_INFIRMARY_MEDICINE_BONUS;
      medicineLeft.set(c.id, left - 1);
    }
    c.hp = Math.min(c.maxHp, c.hp + c.maxHp * ROOM_INFIRMARY_HEAL_FRAC_PER_SEC * mult);
    infirmaryStats.healed++;
  }
}
// The heal rate (fraction of max HP a second) a patient gets at a pixel now (0 outside an infirmary; no medicine).
export function infirmaryHealRateAt(x: number, y: number): number {
  const r = infirmaryAtPx(x, y);
  return r ? ROOM_INFIRMARY_HEAL_FRAC_PER_SEC * infirmaryCareMult(r) : 0;
}
// The hero resting at a pixel: natural healing multiplier (ROOM_INFIRMARY_HERO_HEAL_MULT in an infirmary, else 1).
export function heroInfirmaryHealMult(x: number, y: number): number {
  return infirmaryAtPx(x, y) ? ROOM_INFIRMARY_HERO_HEAL_MULT : 1;
}
// A free infirmary bed of the clan within `r` tiles of (tx, ty) for a hurt villager, or null.
export function infirmaryBedNear(clan: number, tx: number, ty: number, r: number): { x: number; y: number } | null {
  refresh();
  const W = state.WORLD_TILES_X;
  let best: { x: number; y: number; d: number } | null = null;
  for (const room of rooms.values()) {
    if (room.stats.role !== "infirmary" || ownerAt(room.id) !== 0 || clanOfRoom(room) !== clan) continue;
    for (const i of room.beds) {
      const x = i % W;
      const y = Math.floor(i / W);
      const d = Math.max(Math.abs(x - tx), Math.abs(y - ty));
      if (d <= r && (!best || d < best.d)) best = { x, y, d };
    }
  }
  return best;
}

// A death inside a room spills blood (dirt).
export function noteRoomBlood(px: number, py: number) {
  const r = roomAt(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  if (!r) return;
  r.dirt = Math.min(100, r.dirt + ROOM_DIRT_BLOOD);
  r.stats = computeStats(r);
}

function clanOfRoom(r: Room): number {
  return clanIdAtIndex(r.id);
}

function bestOfRole(role: string, clan: number): RoomRec | null {
  refresh();
  let best: RoomRec | null = null;
  for (const r of rooms.values()) if (r.stats.role === role && ownerAt(r.id) === 0 && clanOfRoom(r) === clan && (!best || r.stats.score > best.stats.score)) best = r;
  return best;
}

// The sleep quality q (-1..1) of a person whose home is (homeX, homeY): a bed in a bedroom / barracks, else 0.
export function sleepQualityAt(homeX: number, homeY: number): number {
  if (homeX < 0 || !inBounds(homeX, homeY) || state.tiles[tileIndex(homeX, homeY)] !== TileType.Bed) return 0;
  const r = roomAt(homeX, homeY);
  return r && (r.stats.role === "bedroom" || r.stats.role === "barracks") ? r.stats.q : 0;
}

// Colony happiness from rooms (computeColonyHappiness, under the clan's context): sleep (mean resident q over the
// clan's people) + the best kitchen's meals.
export function roomHappinessBonus(): number {
  refresh();
  if (rooms.size === 0) return 0;
  const clan = state.clan.id;
  let people = 0;
  let sleep = 0;
  for (const c of colonists.values()) {
    if (!c.person || (c.clan ?? 0) !== clan) continue;
    people++;
    sleep += sleepQualityAt(c.person.homeX, c.person.homeY);
  }
  const kitchen = bestOfRole("kitchen", clan);
  // Stardew phase 5b: a good bedroom counts more in winter.
  const sleepMult = winterNow() ? WINTER_ROOM_HAPPINESS_MULT : 1;
  // Gap closure G1: the best hall (social, by the dusk gathering) and the best chapel (faith).
  const hall = bestOfRole("hall", clan);
  return (people > 0 ? (ROOM_SLEEP_HAPPINESS_MAX * sleep * sleepMult) / people : 0) + (kitchen ? (ROOM_DINING_HAPPINESS_MAX * kitchen.stats.score) / 100 : 0) +
    (hall ? ((ROOM_HALL_HAPPINESS_MAX * hall.stats.score) / 100) * hallGatherShare(clan) : 0) + chapelHappiness(clan);
}

// Stardew phase 5b: a tile inside a room whose warmth is at least ROOM_WARM_THRESHOLD.
export function warmRoomAt(tx: number, ty: number): boolean {
  const r = roomAt(tx, ty);
  return !!r && r.stats.warmth >= ROOM_WARM_THRESHOLD;
}

// Hero resting inside a bedroom / barracks: the rest-gain multiplier (0 = not in one).
export function heroRestMultAt(px: number, py: number): number {
  const r = roomAt(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  if (!r || (r.stats.role !== "bedroom" && r.stats.role !== "barracks" && r.stats.role !== "infirmary")) return 0;
  return Math.max(1, ROOM_HERO_REST_MULT + ROOM_HERO_REST_QUALITY_MULT * r.stats.q);
}

// A station at (tx, ty): its workshop's speed multiplier and output grade bonus (1 / 0 outside a workshop).
export function workshopEffectAt(tx: number, ty: number): { speed: number; grade: number } {
  const r = roomAt(tx, ty);
  if (!r || r.stats.role !== "workshop") return { speed: 1, grade: 0 };
  return { speed: roomStationSpeedMult(r.stats, r.counts), grade: r.stats.score >= ROOM_WORKSHOP_GRADE_SCORE ? 1 : 0 };
}

// Barracks: the clan's morale-drain multiplier (1 without one).
export function barracksMoraleMult(clan: number): number {
  const b = bestOfRole("barracks", clan);
  return b ? 1 - (ROOM_BARRACKS_MORALE_RESIST * b.stats.score) / 100 : 1;
}

// The Room panel.
export function roomInfoAt(tx: number, ty: number): RoomInfo | null {
  const r = roomAt(tx, ty);
  if (!r) return null;
  const st = r.stats;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(r.counts)) {
    const name = BUILDING_NAMES[Number(k) as TileType];
    if (name && !/Floor/.test(name)) parts.push(`${v} ${name}`);
  }
  return {
    id: r.id, role: st.role, roleLabel: ROOM_ROLE_LABEL[st.role], size: st.size, beauty: st.beauty, cleanliness: st.cleanliness,
    warmth: st.warmth, score: st.score, tier: st.tier, effects: roomEffectLines(st, r.counts), tips: st.tips,
    contents: parts.join(", ") || "Nothing yet",
  };
}

// Test hook: set a room's dirt (stats follow at once).
export function setRoomDirtAt(tx: number, ty: number, dirt: number) {
  const r = roomAt(tx, ty);
  if (!r) return;
  r.dirt = dirt;
  r.stats = computeStats(r);
}

// Test hook: drop the cache so the next query recomputes every room (incremental == full check).
export function forceFullRoomRecompute() {
  cachedKey = "";
}

// ---- saves (optional field: older saves have clean rooms) ----
export function roomsForSave(): [number, number][] {
  refresh();
  return Array.from(rooms.values()).filter((r) => r.dirt > 0).map((r) => [r.id, Math.round(r.dirt * 10) / 10]);
}
export function restoreRooms(saved: [number, number][] | undefined) {
  rooms.clear();
  roomOfTile.clear();
  cachedKey = "";
  pendingDirt = new Map(saved ?? []);
}

// Building info lines for a structure piece or anything standing in a room.
export function roomInfoLines(tx: number, ty: number): string[] {
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  const inside = roomAt(tx, ty);
  if (inside) {
    const beds = inside.beds.length;
    return [
      `In a roofed room: ${inside.tiles.length} tiles, ${inside.stone ? "tile" : "thatch"} roof`,
      beds > 0 ? `Bedroom: ${beds} bed${beds === 1 ? "" : "s"}, +${beds} population` : "No bed: put a bed in to make it a bedroom (+1 population per bed)",
    ];
  }
  if (t === TileType.Bed) return ["Not in a roofed room: enclose it with walls and a door (up to 144 tiles inside) to make a bedroom"];
  // A wall piece: the rooms it encloses.
  const near = new Set<Room>();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = roomAt(tx + dx, ty + dy);
    if (r) near.add(r);
  }
  if (near.size === 0) return isRoomBoundaryTile(t) ? ["Encloses no room yet"] : [];
  return [...near].map((r) => `Encloses a ${r.tiles.length}-tile room (${r.beds.length} bed${r.beds.length === 1 ? "" : "s"})`);
}
