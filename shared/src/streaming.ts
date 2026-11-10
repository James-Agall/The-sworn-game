// World streaming phase 4: shared by server and client for the chunked welcome. A chunked client (ws `?chunks=1`)
// on a streamed world gets no full tile / biome arrays in `welcome`: it asks for 32x32 chunks as the camera
// needs them (`requestChunks` -> `chunks`), the explored mask comes run-length encoded and the minimap is a
// downscaled summary (one class byte per FACTOR x FACTOR cell) so it never looks empty.
import { Biome, TileType } from "./protocol.js";

export const STREAM_CHUNK_TILES = 32;

// Loading screen: the server's world-generation / load stages, in order, with the overall percent each one ends
// at (weights from profiling a 2048 map). The client adds "Sending map to your browser" (the chunk transfer)
// after "starting". Worlds of LOADING_SCREEN_MIN_WORLD_TILES+ show the screen; smaller ones load too fast to need it.
export const LOAD_STAGES = [
  { id: "read", label: "Reading the save", endPct: 5 },
  { id: "terrain", label: "Generating terrain", endPct: 45 },
  { id: "settlements", label: "Placing settlements and forts", endPct: 60 },
  { id: "resources", label: "Planting forests, ore and forage", endPct: 70 },
  { id: "camps", label: "Placing camps, ruins and lairs", endPct: 85 },
  { id: "wildlife", label: "Releasing wildlife and settlers", endPct: 92 },
  { id: "cache", label: "Saving base cache", endPct: 98 },
  { id: "starting", label: "Starting", endPct: 100 },
] as const;
export type LoadStageId = (typeof LOAD_STAGES)[number]["id"];
export const LOADING_SCREEN_MIN_WORLD_TILES = 512;
export const MAX_CHUNKS_PER_REQUEST = 64;

// Minimap cell side in tiles for a world: 1 up to 512, 2 at 1024, 4 at 2048.
export function minimapFactor(worldTiles: number): number {
  return Math.max(1, Math.ceil(worldTiles / 512));
}

export enum MinimapClass {
  Plains = 0, Hills, Swamp, Water, Moat, Tree, Rock, Iron, Wall, Road, Building, Ruin, Camp, Abbey,
}

const RUIN_TILES = new Set<number>([TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble, TileType.Rubble]);
const CAMP_TILES = new Set<number>([TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence]);
const ABBEY_TILES = new Set<number>([TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost]);

// The client's per-tile minimap colours, as classes (owned = an NPC fort's tile, drawn as a ruin).
export function minimapClassOf(tile: number, biome: number, owned: boolean): MinimapClass {
  if (owned) return MinimapClass.Ruin;
  const ground = biome === Biome.Hills ? MinimapClass.Hills : biome === Biome.Swamp ? MinimapClass.Swamp : MinimapClass.Plains;
  switch (tile) {
    case TileType.Empty:
    case TileType.BerryBush:
    case TileType.BerryBushPicked:
    case TileType.MushroomPatch:
    case TileType.MushroomPatchPicked:
      return ground;
    case TileType.Water: return MinimapClass.Water;
    case TileType.Tree:
    case TileType.FruitTree:
    case TileType.FruitTreePicked:
      return MinimapClass.Tree;
    case TileType.Rock: return MinimapClass.Rock;
    case TileType.IronOre: return MinimapClass.Iron;
    case TileType.Wall:
    case TileType.StoneWall:
    case TileType.Gate:
    case TileType.Drawbridge:
    case TileType.WoodDoor:
    case TileType.StoneDoor:
    case TileType.WoodWindow:
    case TileType.StoneWindow:
      return MinimapClass.Wall;
    case TileType.WoodFloor:
    case TileType.StoneFloor:
      return MinimapClass.Road;
    case TileType.Moat: return MinimapClass.Moat;
    case TileType.Road:
    case TileType.CobbleRoad:
      return MinimapClass.Road;
  }
  if (RUIN_TILES.has(tile)) return MinimapClass.Ruin;
  if (CAMP_TILES.has(tile)) return MinimapClass.Camp;
  if (ABBEY_TILES.has(tile)) return MinimapClass.Abbey;
  return MinimapClass.Building;
}

// One cell's class: any structure (wall / road / building / ruin / camp / Abbey) wins, else the commonest class.
export function minimapCellClass(
  tiles: ArrayLike<number>, biomes: ArrayLike<number>, W: number, H: number, cellX: number, cellY: number, f: number,
  owned: (i: number) => boolean,
): MinimapClass {
  const counts = new Uint16Array(14);
  let best: MinimapClass = MinimapClass.Plains;
  let bestStructure = -1;
  for (let y = cellY * f; y < Math.min(H, cellY * f + f); y++) {
    for (let x = cellX * f; x < Math.min(W, cellX * f + f); x++) {
      const i = y * W + x;
      const k = minimapClassOf(tiles[i] ?? 0, biomes[i] ?? 0, owned(i));
      if (k >= MinimapClass.Wall && k > bestStructure) bestStructure = k;
      counts[k]++;
    }
  }
  if (bestStructure >= 0) return bestStructure as MinimapClass;
  for (let k = 1; k < counts.length; k++) if (counts[k] > counts[best]) best = k as MinimapClass;
  return best;
}

// ---- Run-length codecs (base64 of LEB128 varints; works in node and the browser via btoa / atob) ----
function toBase64(bytes: number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(s);
}
function pushVarint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}
function readVarints(text: string): number[] {
  const s = atob(text);
  const out: number[] = [];
  let n = 0;
  let mul = 1;
  for (let i = 0; i < s.length; i++) {
    const b = s.charCodeAt(i);
    n += (b & 0x7f) * mul;
    if (b & 0x80) mul *= 128;
    else {
      out.push(n);
      n = 0;
      mul = 1;
    }
  }
  return out;
}

// A 0/1 mask as alternating run lengths, starting with a run of 0s (possibly empty).
export function encodeMaskRuns(mask: ArrayLike<number>): string {
  const out: number[] = [];
  let cur = 0;
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === cur) run++;
    else {
      pushVarint(out, run);
      cur = v;
      run = 1;
    }
  }
  pushVarint(out, run);
  return toBase64(out);
}
export function decodeMaskRuns(text: string, length: number) {
  const mask = new Uint8Array(length);
  let i = 0;
  let v = 0;
  for (const run of readVarints(text)) {
    if (v) mask.fill(1, i, Math.min(length, i + run));
    i += run;
    v ^= 1;
  }
  return mask;
}

// Bytes as (run, value) varint pairs.
export function encodeByteRuns(bytes: ArrayLike<number>): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    let j = i + 1;
    while (j < bytes.length && bytes[j] === bytes[i]) j++;
    pushVarint(out, j - i);
    pushVarint(out, bytes[i]);
    i = j;
  }
  return toBase64(out);
}
export function decodeByteRuns(text: string, length: number) {
  const out = new Uint8Array(length);
  const v = readVarints(text);
  let i = 0;
  for (let k = 0; k + 1 < v.length; k += 2) {
    out.fill(v[k + 1], i, Math.min(length, i + v[k]));
    i += v[k];
  }
  return out;
}
