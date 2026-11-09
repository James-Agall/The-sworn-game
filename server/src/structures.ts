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
} from "@colony/shared/rooms";
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

// A bed counts (a home slot) only inside a roofed room, and not in an NPC fort.
export function isUsableBed(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Bed || ownerAt(tileIndex(tx, ty)) !== 0) return false;
  return isRoofed(tx, ty);
}

// Every usable bed's tile index (bedrooms), ascending.
export function usableBedIndices(): number[] {
  refresh();
  const out: number[] = [];
  for (const r of rooms.values()) for (const i of r.beds) if (ownerAt(i) === 0) out.push(i);
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
  return (people > 0 ? (ROOM_SLEEP_HAPPINESS_MAX * sleep * sleepMult) / people : 0) + (kitchen ? (ROOM_DINING_HAPPINESS_MAX * kitchen.stats.score) / 100 : 0);
}

// Stardew phase 5b: a tile inside a room whose warmth is at least ROOM_WARM_THRESHOLD.
export function warmRoomAt(tx: number, ty: number): boolean {
  const r = roomAt(tx, ty);
  return !!r && r.stats.warmth >= ROOM_WARM_THRESHOLD;
}

// Hero resting inside a bedroom / barracks: the rest-gain multiplier (0 = not in one).
export function heroRestMultAt(px: number, py: number): number {
  const r = roomAt(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  if (!r || (r.stats.role !== "bedroom" && r.stats.role !== "barracks")) return 0;
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
