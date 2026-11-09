// chunks.ts: World streaming phase 1 (ROADMAP "World streaming"): the tile registry and per-chunk counters.
// Every tile write goes through setTile, which keeps per-type index sets (replacing full-map scans such as
// settlementStats / updateTowers / tilesOfType), per-type counts, per-chunk structure counts and the
// per-chunk regionVersion (bumped on any tile change in the chunk; cached paths check it). Bulk writes
// (worldgen fill, save load) call markTileRegistryStale(); a new state.tiles array is noticed by itself.
// Phase 2 adds the chunk manager (bottom). Imports only state and the shared protocol at runtime.
import { TileType, TILE_SIZE as TILE_PX } from "@colony/shared/protocol";
import { isRoomBoundaryTile, isRoomInteriorTile } from "@colony/shared/structures";
import { colonists, mobs, players, raidGroups, state } from "./state.js";

export const CHUNK_TILES = 32;

// Terrain too common to index (queries for these fall back to a full scan).
const UNINDEXED = new Uint8Array(256);
UNINDEXED[TileType.Empty] = 1;
UNINDEXED[TileType.Water] = 1;
// Natural tiles that don't count as a chunk's structures.
const NATURAL = new Uint8Array(256);
for (const t of [TileType.Empty, TileType.Water, TileType.Tree, TileType.IronOre, TileType.Rock]) NATURAL[t] = 1;

const byType: Set<number>[] = Array.from({ length: 256 }, () => new Set<number>());
const sortedCache: (number[] | null)[] = new Array(256).fill(null);
const counts = new Uint32Array(256);
let tilesRef: Uint8Array | null = null;
let stale = true;
let chunksX = 0;
let chunksY = 0;
// Per chunk: tile-change counter and the number of non-natural tiles (buildings, walls, props, roads).
let regionVersion = new Uint32Array(0);
let chunkStructures = new Uint32Array(0);
// Bumped by every rebuild: cached paths from before it are dropped.
let epoch = 0;
// Modular building phase 1: bumped when a tile write can make or break a room (a boundary piece, or a tile going
// between room interior and anything else); server structures.ts recomputes its rooms on a change.
let roomVersion = 0;
export function tileRoomVersion(): number {
  return roomVersion;
}

export function chunkOfIndex(i: number): number {
  const W = state.WORLD_TILES_X;
  return Math.floor(Math.floor(i / W) / CHUNK_TILES) * chunksX + Math.floor((i % W) / CHUNK_TILES);
}

export function markTileRegistryStale() {
  stale = true;
}

export function ensureTileRegistry() {
  if (!stale && tilesRef === state.tiles) return;
  const tiles = state.tiles;
  tilesRef = tiles;
  stale = false;
  epoch++;
  for (const s of byType) s.clear();
  sortedCache.fill(null);
  counts.fill(0);
  chunksX = Math.ceil(state.WORLD_TILES_X / CHUNK_TILES);
  chunksY = Math.ceil(state.WORLD_TILES_Y / CHUNK_TILES);
  if (regionVersion.length !== chunksX * chunksY) regionVersion = new Uint32Array(chunksX * chunksY);
  for (let c = 0; c < regionVersion.length; c++) regionVersion[c]++;
  chunkStructures = new Uint32Array(chunksX * chunksY);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    counts[t]++;
    if (!UNINDEXED[t]) byType[t].add(i);
    if (!NATURAL[t]) chunkStructures[chunkOfIndex(i)]++;
  }
}

// The one way to write a tile (outside worldgen's bulk fill and save loading).
export function setTile(i: number, t: TileType) {
  ensureTileRegistry();
  const old = state.tiles[i];
  if (old === t) return;
  state.tiles[i] = t;
  counts[old]--;
  counts[t]++;
  if (!UNINDEXED[old]) {
    byType[old].delete(i);
    sortedCache[old] = null;
  }
  if (!UNINDEXED[t]) {
    byType[t].add(i);
    sortedCache[t] = null;
  }
  const c = chunkOfIndex(i);
  regionVersion[c]++;
  if (isRoomBoundaryTile(old) || isRoomBoundaryTile(t) || isRoomInteriorTile(old) !== isRoomInteriorTile(t) || old === TileType.Bed || t === TileType.Bed) roomVersion++;
  if (!NATURAL[old]) chunkStructures[c]--;
  if (!NATURAL[t]) chunkStructures[c]++;
}

export function tileCountOf(t: TileType): number {
  ensureTileRegistry();
  return counts[t];
}

// Every tile index of type t, ascending (= the row-major order of a full-map scan). Do not mutate.
export function tileIndicesOf(t: TileType): readonly number[] {
  ensureTileRegistry();
  let list = sortedCache[t];
  if (list) return list;
  if (UNINDEXED[t]) {
    list = [];
    const tiles = state.tiles;
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === t) list.push(i);
    return list;
  }
  list = Array.from(byType[t]).sort((a, b) => a - b);
  sortedCache[t] = list;
  return list;
}

// Every tile index of any of `types`, ascending.
export function tileIndicesOfAny(types: readonly TileType[]): number[] {
  if (types.length === 1) return tileIndicesOf(types[0]).slice();
  const out: number[] = [];
  for (const t of types) for (const i of tileIndicesOf(t)) out.push(i);
  return out.sort((a, b) => a - b);
}

// The tile types (0..255) a predicate holds for, for tileIndicesOfAny.
export function tileTypesWhere(pred: (t: TileType) => boolean): TileType[] {
  const out: TileType[] = [];
  for (let t = 0; t < 256; t++) if (pred(t as TileType)) out.push(t as TileType);
  return out;
}

// Column-major order (x, then y): what a `for tx { for ty }` scan visits.
export function byColumn(indices: readonly number[]): number[] {
  const W = state.WORLD_TILES_X;
  return indices.slice().sort((a, b) => a % W - (b % W) || a - b);
}

export function chunkCounts(): { chunksX: number; chunksY: number } {
  ensureTileRegistry();
  return { chunksX, chunksY };
}

export function chunkRegionVersion(c: number): number {
  return regionVersion[c];
}

export function chunkStructureCount(c: number): number {
  ensureTileRegistry();
  return chunkStructures[c];
}

export function tileRegistryEpoch(): number {
  ensureTileRegistry();
  return epoch;
}

// Test hook 'auditRegistry': mismatches between the registry and a fresh full scan (0 = consistent).
export function auditTileRegistry(): number {
  ensureTileRegistry();
  let bad = 0;
  const fresh = new Uint32Array(256);
  const structures = new Uint32Array(chunksX * chunksY);
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    fresh[t]++;
    if (!UNINDEXED[t] && !byType[t].has(i)) bad++;
    if (!NATURAL[t]) structures[chunkOfIndex(i)]++;
  }
  for (let t = 0; t < 256; t++) {
    if (fresh[t] !== counts[t]) bad++;
    if (!UNINDEXED[t] && byType[t].size !== fresh[t]) bad++;
  }
  for (let c = 0; c < structures.length; c++) if (structures[c] !== chunkStructures[c]) bad++;
  return bad;
}

// ---- cached paths (phase 1, "they do not have to think") ----
// findPath results keyed by (start, goal, mover side), valid while every chunk the search VISITED keeps
// its regionVersion: then a fresh search would return exactly the same path. Searches that looked at a
// gate (state-dependent passability) are never cached. Bounded LRU (Map insertion order).
export const PATH_CACHE_MAX = 4096;
interface CachedPath {
  epoch: number;
  path: Int32Array | null;
  chunks: Int32Array;
  versions: Uint32Array;
}
const pathCache = new Map<number, CachedPath>();
export const pathCacheStats = { hits: 0, misses: 0, mismatches: 0 };

export function pathCacheKey(start: number, goal: number, hostile: boolean): number {
  return (start * state.tiles.length + goal) * 2 + (hostile ? 1 : 0);
}

// The cached path as fresh coords, undefined on a miss (null = cached "no path").
export function cachedPath(key: number): { x: number; y: number }[] | null | undefined {
  const e = pathCache.get(key);
  if (!e) return undefined;
  let ok = e.epoch === tileRegistryEpoch();
  for (let k = 0; ok && k < e.chunks.length; k++) if (regionVersion[e.chunks[k]] !== e.versions[k]) ok = false;
  pathCache.delete(key);
  if (!ok) {
    pathCacheStats.misses++;
    return undefined;
  }
  pathCache.set(key, e);
  pathCacheStats.hits++;
  if (!e.path) return null;
  const W = state.WORLD_TILES_X;
  return Array.from(e.path, (i) => ({ x: i % W, y: Math.floor(i / W) }));
}

export function storePath(key: number, path: readonly { x: number; y: number }[] | null, visited: Iterable<number>) {
  const W = state.WORLD_TILES_X;
  const H = state.WORLD_TILES_Y;
  const seen = new Set<number>();
  // A visited tile's 4 neighbours were looked at too: on a chunk edge they lie in the next chunk.
  for (const i of visited) {
    const x = i % W;
    const y = Math.floor(i / W);
    const cx = Math.floor(x / CHUNK_TILES);
    const cy = Math.floor(y / CHUNK_TILES);
    seen.add(cy * chunksX + cx);
    const lx = x % CHUNK_TILES;
    const ly = y % CHUNK_TILES;
    if (lx === 0 && x > 0) seen.add(cy * chunksX + cx - 1);
    if (lx === CHUNK_TILES - 1 && x < W - 1) seen.add(cy * chunksX + cx + 1);
    if (ly === 0 && y > 0) seen.add((cy - 1) * chunksX + cx);
    if (ly === CHUNK_TILES - 1 && y < H - 1) seen.add((cy + 1) * chunksX + cx);
  }
  const chunks = Int32Array.from(seen);
  const versions = Uint32Array.from(chunks, (c) => regionVersion[c]);
  pathCache.delete(key);
  pathCache.set(key, { epoch: tileRegistryEpoch(), path: path ? Int32Array.from(path, (p) => p.y * W + p.x) : null, chunks, versions });
  if (pathCache.size > PATH_CACHE_MAX) pathCache.delete(pathCache.keys().next().value!);
}

// ---- chunk manager (phase 2): ACTIVE / WARM / COLD ----
// Classified once a second from anchors (live players, living colonists incl. wagons, Town Centers, raid
// groups' members) by Chebyshev chunk distance d: d <= CHUNK_ACTIVATE -> ACTIVE, d <= CHUNK_WARM -> WARM,
// else COLD. Hysteresis: an ACTIVE chunk stays ACTIVE while d <= CHUNK_DEACTIVATE, and any demotion waits
// CHUNK_GRACE_TICKS. Only worlds of STREAMING_MIN_WORLD_TILES+ freeze anything (COLONY_STREAMING=1 forces it
// on in tests), so 160 / 256 / 512 maps behave exactly as before; there every chunk reads ACTIVE.
// COLD: idle free mobs (no raid group / warband / target) and wildlife stand still; sites there are asleep
// (the existing ~96-tile site dormancy). WARM: everything still runs (the band that hides pop-in).
export const enum ChunkState { Cold = 0, Warm = 1, Active = 2 }
export const CHUNK_ACTIVATE = 3;
export const CHUNK_DEACTIVATE = 5;
export const CHUNK_WARM = 5;
export const CHUNK_GRACE_TICKS = 20 * 10;
export const STREAMING_MIN_WORLD_TILES = 768;
const STREAMING_FORCED = process.env.COLONY_TEST_HOOKS === "1" && process.env.COLONY_STREAMING === "1";
let chunkState = new Uint8Array(0);
// Tick each chunk last qualified for its current state (grace timer start).
let chunkHeldTick = new Int32Array(0);
let chunkClassifiedTick = -Infinity;
// Bumped by every re-classification (phase 3's abstract.ts runs its park / unpark pass after each one).
export let chunkClassifyCount = 0;
const CHUNK_FAR = 255;

// Phase 3: a new world / a loaded save starts unclassified (the next tick classifies from COLD at once).
export function resetChunkStates() {
  chunkState = new Uint8Array(0);
  chunkClassifiedTick = -Infinity;
}

export function chunkStateOf(c: number): ChunkState {
  if (chunkState.length !== chunksX * chunksY || chunkState.length === 0) return ChunkState.Active;
  return chunkState[c] as ChunkState;
}

export function streamingOn(): boolean {
  return STREAMING_FORCED || state.WORLD_TILES_X >= STREAMING_MIN_WORLD_TILES;
}

export function chunkAtPixel(px: number, py: number): number {
  const cx = Math.min(chunksX - 1, Math.max(0, Math.floor(px / (TILE_PX * CHUNK_TILES))));
  const cy = Math.min(chunksY - 1, Math.max(0, Math.floor(py / (TILE_PX * CHUNK_TILES))));
  return cy * chunksX + cx;
}

// Re-classifies every chunk (sim calls it each tick; it works once a second, or at once with force).
export function updateChunkStates(force = false) {
  ensureTileRegistry();
  const n = chunksX * chunksY;
  const now = state.cycleTick;
  if (chunkState.length !== n) {
    chunkState = new Uint8Array(n).fill(ChunkState.Cold);
    chunkHeldTick = new Int32Array(n).fill(now);
    force = true;
  }
  if (!force && now - chunkClassifiedTick < 20 && now >= chunkClassifiedTick) return;
  chunkClassifiedTick = now;
  chunkClassifyCount++;
  if (!streamingOn()) {
    chunkState.fill(ChunkState.Active);
    return;
  }
  // Multi-source Chebyshev distance (in chunks, capped at CHUNK_FAR) from every anchor chunk.
  const anchorChunks = new Set<number>();
  for (const p of players.values()) if (!p.dead) anchorChunks.add(chunkAtPixel(p.x, p.y));
  // Phase 3: a far wagon convoy on a dice-resolved leg (ghost: the wagon and its escort) is not an anchor.
  for (const c of colonists.values()) if (c.hp > 0 && !c.ghost) anchorChunks.add(chunkAtPixel(c.x, c.y));
  for (const tc of state.townCenters) anchorChunks.add(chunkAtPixel((tc.x + 0.5) * TILE_PX, (tc.y + 0.5) * TILE_PX));
  for (const g of raidGroups.values()) {
    for (const id of g.memberIds) {
      const m = mobs.get(id);
      if (m) anchorChunks.add(chunkAtPixel(m.x, m.y));
    }
  }
  const dist = new Uint8Array(n).fill(CHUNK_FAR);
  const R = CHUNK_WARM + 2;
  for (const a of anchorChunks) {
    const ax = a % chunksX;
    const ay = Math.floor(a / chunksX);
    for (let y = Math.max(0, ay - R); y <= Math.min(chunksY - 1, ay + R); y++) {
      for (let x = Math.max(0, ax - R); x <= Math.min(chunksX - 1, ax + R); x++) {
        const d = Math.max(Math.abs(x - ax), Math.abs(y - ay));
        const c = y * chunksX + x;
        if (d < dist[c]) dist[c] = d;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    const d = dist[c];
    const cur = chunkState[c] as ChunkState;
    let want = d <= CHUNK_ACTIVATE ? ChunkState.Active : d <= CHUNK_WARM ? ChunkState.Warm : ChunkState.Cold;
    if (cur === ChunkState.Active && d <= CHUNK_DEACTIVATE) want = ChunkState.Active;
    if (want >= cur) {
      // Promotion is immediate; holding the state restarts the grace timer.
      chunkState[c] = want;
      chunkHeldTick[c] = now;
    } else if (now - chunkHeldTick[c] >= CHUNK_GRACE_TICKS || now < chunkHeldTick[c]) {
      chunkState[c] = want;
      chunkHeldTick[c] = now;
    }
  }
}

export function chunkStateAtPixel(px: number, py: number): ChunkState {
  if (chunkState.length !== chunksX * chunksY || chunkState.length === 0) return ChunkState.Active;
  return chunkState[chunkAtPixel(px, py)] as ChunkState;
}

export function isColdAtPixel(px: number, py: number): boolean {
  return chunkStateAtPixel(px, py) === ChunkState.Cold;
}

// A mob that stands still this tick: an idle free mob in a COLD chunk (raid groups, warbands and anything
// with a target are on a mission and keep running).
export function mobFrozenByStreaming(m: { x: number; y: number; groupId: string | null; warbandId?: string; targetId: string | null }): boolean {
  return !m.groupId && !m.warbandId && !m.targetId && isColdAtPixel(m.x, m.y);
}

// Phase 3 (d): the WARM band's low-rate tick. An idle free mob in a WARM chunk runs one tick in WARM_TICK_EVERY
// (staggered by id) with that many ticks of dt: no per-tick targeting / pathing, same distance walked. Returns the
// dt multiplier, 0 = skip this tick (always 1 outside WARM, so never below 768 tiles).
export const WARM_TICK_EVERY = 4;
export function warmMobStride(m: { id: string; x: number; y: number; groupId: string | null; warbandId?: string; targetId: string | null }): number {
  if (m.groupId || m.warbandId || m.targetId || chunkStateAtPixel(m.x, m.y) !== ChunkState.Warm) return 1;
  return (state.cycleTick + m.id.charCodeAt(m.id.length - 1)) % WARM_TICK_EVERY === 0 ? WARM_TICK_EVERY : 0;
}

// Test hook 'chunkState' / benchmarks.
export function chunkStateSummary(): { on: boolean; chunksX: number; chunksY: number; active: number; warm: number; cold: number } {
  let active = 0;
  let warm = 0;
  let cold = 0;
  for (const s of chunkState) {
    if (s === ChunkState.Active) active++;
    else if (s === ChunkState.Warm) warm++;
    else cold++;
  }
  return { on: streamingOn(), chunksX, chunksY, active, warm, cold };
}
