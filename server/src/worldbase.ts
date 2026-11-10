// worldbase.ts: World streaming phase 4 (diff-log saves). A world made by this server is generated from a
// seed (generateWorld swaps Math.random for a seeded stream while it runs), and its tiles / biomes right after
// worldgen are the BASE layer. A streamed save stores the seed, the worldgen version, a checksum of the base
// and per-chunk tile diffs against it instead of the full arrays. The base comes back from (1) this module's
// in-memory cache, (2) a gzip cache file next to the saves, or (3) regenerating the world from the seed
// (checked against the checksum). Worlds without a seed (loaded from a full-array save) keep the old format.
import { promises as fsp } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { deflateRawSync, gunzip, gzip, inflateRawSync } from "node:zlib";
import { SAVE_DIR } from "./constants.js";
import { CHUNK_TILES } from "./chunks.js";
import { state } from "./state.js";

// Bump when worldgen changes what a seed produces (old diff saves then need their base cache file, which is
// named by the save's own worldgenVersion). 3: bandit camp templates (2026-11-06). 7: gap closure G7 (settlements
// turned / mirrored, quest slots, 6 more settlement templates). 8: gap closure G8 (town-citadel: a keep building).
export const WORLDGEN_VERSION = 8;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
// A chunk with more changed tiles than this is stored whole (1024 bytes) instead of as (u16 pos, u8 tile).
const CHUNK_FULL_AT = 340;

// version: the worldgen version that made it (a base loaded for an older save keeps that save's version).
interface Base { seed: number; size: number; tiles: Uint8Array; biomes: Uint8Array; sum: number; version: number }
let base: Base | null = null;
// The seed of the world now in memory (null: no regenerable base, e.g. loaded from a full-array save).
let worldSeed: number | null = null;

export function currentWorldSeed(): number | null {
  return worldSeed;
}

// mulberry32: the seeded stream generateWorld runs on.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The seeded stream of the generation in progress (null: none) and the real Math.random it replaced.
let seededRandom: (() => number) | null = null;
let realRandom: () => number = Math.random;

// Runs fn (generateWorld's body) on a seeded Math.random, then captures the base layer. COLONY_WORLD_SEED (tests):
// every new world uses that seed (a fixed map layout). fn may await yieldWorldgen() between stages.
export async function withWorldSeed(seed: number | undefined, fn: () => Promise<void>) {
  const fixed = process.env.COLONY_WORLD_SEED ? Number(process.env.COLONY_WORLD_SEED) : NaN;
  const s = seed ?? (Number.isFinite(fixed) ? fixed >>> 0 : Math.floor(Math.random() * 0x7fffffff));
  realRandom = Math.random;
  seededRandom = seeded(s);
  Math.random = seededRandom;
  try {
    await fn();
  } finally {
    Math.random = realRandom;
    seededRandom = null;
  }
  worldSeed = s;
  base = { seed: s, size: state.WORLD_TILES_X, tiles: state.tiles.slice(), biomes: state.biomes.slice(), sum: 0, version: WORLDGEN_VERSION };
  base.sum = checksum(base.tiles, base.biomes);
}

// Loading screen: lets the event loop run (socket I/O, progress messages) in the middle of a generation. Anything
// else that runs meanwhile gets the real Math.random, so the seeded stream (and so the world) stays the same.
export async function yieldWorldgen() {
  const rng = seededRandom;
  if (rng) Math.random = realRandom;
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (rng) Math.random = rng;
}

// Loading screen "Saving base cache": a streamed world's base file is written right after generation (async gzip),
// so the first save does not have to. A no-op when it exists or there is no base.
export async function ensureBaseCacheFile() {
  if (!base) return;
  const file = baseFile(base.seed, base.size, base.version);
  try {
    await fsp.access(file);
    return;
  } catch {
    /* not written yet */
  }
  await fsp.mkdir(SAVE_DIR, { recursive: true });
  const raw = new Uint8Array(base.tiles.length * 2);
  raw.set(base.tiles, 0);
  raw.set(base.biomes, base.tiles.length);
  await fsp.writeFile(`${file}.tmp`, await gzipAsync(raw));
  await fsp.rename(`${file}.tmp`, file);
}

// A load of a full-array save: nothing to diff against.
export function forgetWorldSeed() {
  worldSeed = null;
}

// Test hook: drop the in-memory base (and the cache files) so a load must regenerate it from the seed.
export async function dropBaseCache() {
  base = null;
  try {
    for (const f of await fsp.readdir(SAVE_DIR)) if (f.startsWith("base-")) await fsp.rm(path.join(SAVE_DIR, f), { force: true });
  } catch {
    /* no save dir yet */
  }
}

function checksum(tiles: Uint8Array, biomes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tiles.length; i++) h = Math.imul(h ^ tiles[i], 0x01000193);
  for (let i = 0; i < biomes.length; i++) h = Math.imul(h ^ biomes[i], 0x01000193);
  return h >>> 0;
}

function baseFile(seed: number, size: number, version = WORLDGEN_VERSION): string {
  return path.join(SAVE_DIR, `base-${seed}-${size}-v${version}.bin.gz`);
}

export function deflateBase64(bytes: Uint8Array): string {
  return deflateRawSync(bytes).toString("base64");
}
export function inflateBase64(text: string): Uint8Array {
  return new Uint8Array(inflateRawSync(Buffer.from(text, "base64")));
}

export interface TileDiffs {
  seed: number;
  worldgenVersion: number;
  baseSum: number;
  // [chunk index, base64 payload, whole?]: whole = the chunk's 1024 tiles row by row; else (u16 LE local
  // index, u8 tile) triples.
  tileDiffs: [number, string, 1?][];
}

// The streamed save's tile layer, or null when this world has no base (the caller writes full arrays).
export async function diffTilesForSave(): Promise<TileDiffs | null> {
  if (worldSeed === null || !base || base.seed !== worldSeed || base.size !== state.WORLD_TILES_X) return null;
  if (!sameBytes(state.biomes, base.biomes)) return null;
  // The cache file first: a diff save is only as good as its base.
  await ensureBaseCacheFile();
  return { seed: base.seed, worldgenVersion: base.version, baseSum: base.sum, tileDiffs: encodeDiffs(base.tiles, state.tiles) };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function encodeDiffs(from: Uint8Array, to: Uint8Array): [number, string, 1?][] {
  const W = state.WORLD_TILES_X;
  const H = state.WORLD_TILES_Y;
  const cx = Math.ceil(W / CHUNK_TILES);
  const cy = Math.ceil(H / CHUNK_TILES);
  const out: [number, string, 1?][] = [];
  for (let c = 0; c < cx * cy; c++) {
    const x0 = (c % cx) * CHUNK_TILES;
    const y0 = Math.floor(c / cx) * CHUNK_TILES;
    const changed: number[] = [];
    for (let ly = 0; ly < CHUNK_TILES && y0 + ly < H; ly++) {
      for (let lx = 0; lx < CHUNK_TILES && x0 + lx < W; lx++) {
        const i = (y0 + ly) * W + x0 + lx;
        if (from[i] !== to[i]) changed.push(ly * CHUNK_TILES + lx, to[i]);
      }
    }
    if (changed.length === 0) continue;
    if (changed.length / 2 > CHUNK_FULL_AT) {
      const whole = new Uint8Array(CHUNK_TILES * CHUNK_TILES);
      for (let ly = 0; ly < CHUNK_TILES && y0 + ly < H; ly++) {
        for (let lx = 0; lx < CHUNK_TILES && x0 + lx < W; lx++) whole[ly * CHUNK_TILES + lx] = to[(y0 + ly) * W + x0 + lx];
      }
      out.push([c, Buffer.from(whole).toString("base64"), 1]);
      continue;
    }
    const bytes = Buffer.alloc((changed.length / 2) * 3);
    for (let k = 0; k < changed.length; k += 2) {
      bytes.writeUInt16LE(changed[k], (k / 2) * 3);
      bytes[(k / 2) * 3 + 2] = changed[k + 1];
    }
    out.push([c, bytes.toString("base64")]);
  }
  return out;
}

function applyDiffs(tiles: Uint8Array, diffs: [number, string, 1?][]) {
  const W = state.WORLD_TILES_X;
  const H = state.WORLD_TILES_Y;
  const cx = Math.ceil(W / CHUNK_TILES);
  for (const [c, payload, whole] of diffs) {
    const x0 = (c % cx) * CHUNK_TILES;
    const y0 = Math.floor(c / cx) * CHUNK_TILES;
    const bytes = Buffer.from(payload, "base64");
    const put = (local: number, t: number) => {
      const lx = local % CHUNK_TILES;
      const ly = Math.floor(local / CHUNK_TILES);
      if (x0 + lx < W && y0 + ly < H) tiles[(y0 + ly) * W + x0 + lx] = t;
    };
    if (whole) for (let k = 0; k < bytes.length; k++) put(k, bytes[k]);
    else for (let k = 0; k + 2 < bytes.length; k += 3) put(bytes.readUInt16LE(k), bytes[k + 2]);
  }
}

// Load side: the base for (seed, size), from memory or the cache file of the save's worldgen `version`; null =
// the caller regenerates it.
export async function loadBase(seed: number, size: number, sum: number, version = WORLDGEN_VERSION): Promise<Base | null> {
  if (base && base.seed === seed && base.size === size && base.sum === sum) return base;
  try {
    const raw = new Uint8Array(await gunzipAsync(await fsp.readFile(baseFile(seed, size, version))));
    const cells = size * size;
    const b: Base = { seed, size, tiles: raw.slice(0, cells), biomes: raw.slice(cells, cells * 2), sum: 0, version };
    b.sum = checksum(b.tiles, b.biomes);
    if (b.sum === sum) return (base = b);
  } catch {
    /* no cache file */
  }
  return null;
}

// After a regeneration from the seed (withWorldSeed captured it): is it the save's base?
export function regeneratedBaseMatches(seed: number, sum: number): boolean {
  return !!base && base.seed === seed && base.sum === sum;
}

// Rebuilds the full base64 arrays a streamed save stands for (the old reader then applies them as before).
export function expandTiles(b: Base, diffs: [number, string, 1?][]): { tiles: string; biomes: string } {
  const tiles = b.tiles.slice();
  applyDiffs(tiles, diffs);
  worldSeed = b.seed;
  base = b;
  return { tiles: Buffer.from(tiles).toString("base64"), biomes: Buffer.from(b.biomes).toString("base64") };
}

// After a streamed save: cache files that no slot (and not the world in memory) names are deleted.
export async function pruneBaseFiles(slotFiles: string[]) {
  const keep = new Set<string>();
  if (base) keep.add(path.basename(baseFile(base.seed, base.size, base.version)));
  for (const f of slotFiles) {
    try {
      const file = JSON.parse(await fsp.readFile(f, "utf8"));
      if (typeof file?.state?.seed === "number") keep.add(`base-${file.state.seed}-${file.worldSize}-v${file.state.worldgenVersion}.bin.gz`);
    } catch {
      /* empty / unreadable slot */
    }
  }
  try {
    for (const f of await fsp.readdir(SAVE_DIR)) {
      if (f.startsWith("base-") && f.endsWith(".bin.gz") && !keep.has(f)) await fsp.rm(path.join(SAVE_DIR, f), { force: true });
    }
  } catch {
    /* no save dir */
  }
}
