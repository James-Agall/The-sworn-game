// chunks.ts: World streaming phase 1 (ROADMAP "World streaming"): the tile registry and per-chunk counters.
// Every tile write goes through setTile, which keeps per-type index sets (replacing full-map scans such as
// settlementStats / updateTowers / tilesOfType), per-type counts, per-chunk structure counts and the
// per-chunk regionVersion (bumped on any tile change in the chunk; cached paths check it). Bulk writes
// (worldgen fill, save load) call markTileRegistryStale(); a new state.tiles array is noticed by itself.
// Imports only state and the shared protocol at runtime.
import { TileType } from "@colony/shared/protocol";
import { state } from "./state.js";

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
