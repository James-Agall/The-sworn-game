// paddocks.ts: Animal paddocks (2026-11-18, docs PLAN-agri-industry-winter-mines.md phase 1; every number in
// shared/src/animals.ts PADDOCK_*).
//
// An Animal area zone (zones.ts) is a PADDOCK when its open ground is closed in: a 4-connected flood fill from its
// tiles over open ground (gates count as shut) stays within PADDOCK_MAX_TILES, never reaches the map edge, and meets at
// least one fence / gate / wall. The paddock's tiles are the whole enclosed ground. Checked once a second (zones.ts
// updateZones) and on demand; an unchanged enclosure keeps its record (and version), so linked animals are not
// disturbed. Also kept here: the grass per paddock tile (saved with the zones), the occupancy animals.ts reports
// once a second (snapshot, predators), the daily grazing step, and the fence a predator goes for.
import { TICK_RATE, TileType, isGateTile, isSolidTile } from "@colony/shared/protocol";
import { isFortification, wallConnects } from "@colony/shared/fortifications";
import {
  PADDOCK_BARE_GRASS, PADDOCK_BARE_REGROW_MULT, PADDOCK_CHOICE_RANGE_TILES, PADDOCK_GRASS_EATEN_PER_DAY,
  PADDOCK_GRASS_REGROW_PER_DAY, PADDOCK_LINK_RANGE_TILES, PADDOCK_MAX_TILES, PADDOCK_PREDATOR_RANGE_TILES,
} from "@colony/shared/animals";
import { rleEncode, type PaddockSnapshot } from "@colony/shared/zones";
import type { TileCoord } from "./types.js";
import { tileMutationVersion } from "./chunks.js";
import { state } from "./state.js";
import { inBounds, ownerAt, tileIndex, tileOfPixel } from "./tiles.js";
import { animalZones, bumpZones, zonesVersion } from "./zones.js";

export interface Paddock {
  zoneId: number;
  clan: number;
  name: string;
  fenced: boolean;
  // Open: why not.
  why: string;
  // Fenced: the enclosed ground (ascending tile indices) and as a set; its bounding box.
  list: number[];
  tiles: Set<number>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // Fence / fence gate tiles on its edge (predator targets), and Water / Moat on its edge (troughs fill themselves).
  fences: number[];
  water: boolean;
  // Bumped when the enclosure changes (animals.ts re-links on a new version).
  version: number;
}

const paddocks = new Map<number, Paddock>();
// Grass 0-1 per paddock tile; absent = full.
const grass = new Map<number, number>();
// Per paddock zone id: linked animals and the tiles they need (animals.ts, once a second).
const occupancy = new Map<number, { animals: number; need: number }>();
let builtSecond = -1;
let builtZones = -1;
let nextVersion = 1;

const W = () => state.WORLD_TILES_X;
// Ground a paddock is made of: walkable, not a gate, not a wall-top piece.
const ground = (t: number) => !isSolidTile(t as TileType) && !isGateTile(t) && !isFortification(t);
// What counts as a man-made enclosure (at least one needed): fences, gates, walls.
const closer = (t: number) => t === TileType.PropFence || isGateTile(t) || wallConnects(t);

type Enclosure = Pick<Paddock, "fenced" | "why" | "list" | "fences" | "water">;
function open(why: string): Enclosure {
  return { fenced: false, why, list: [], fences: [], water: false };
}
function enclose(zoneTiles: Set<number>): Enclosure {
  const w = W();
  const seen = new Set<number>();
  const list: number[] = [];
  const fences = new Set<number>();
  let closed = false;
  let water = false;
  for (const s of zoneTiles) {
    if (seen.has(s) || !ground(state.tiles[s])) continue;
    seen.add(s);
    list.push(s);
    for (let k = list.length - 1; k < list.length; k++) {
      const i = list[k];
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!inBounds(nx, ny)) return open("it reaches the map edge");
        const j = tileIndex(nx, ny);
        if (seen.has(j)) continue;
        seen.add(j);
        const t = state.tiles[j];
        if (ground(t)) {
          list.push(j);
          if (list.length > PADDOCK_MAX_TILES) return open(`more than ${PADDOCK_MAX_TILES} tiles inside: a gap in the fence?`);
          continue;
        }
        if (t === TileType.PropFence || t === TileType.FenceGate) fences.add(j);
        if (closer(t)) closed = true;
        if (t === TileType.Water || t === TileType.Moat) water = true;
      }
    }
  }
  if (list.length === 0) return open("no open ground in it");
  if (!closed) return open("no fence, gate or wall round it");
  return { fenced: true, why: "", list: list.sort((a, b) => a - b), fences: Array.from(fences).sort((a, b) => a - b), water };
}
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, k) => v === b[k]);

const enclosureCache = new WeakMap<Set<number>, { version: number; inputs: number[]; result: Enclosure }>();
function sameZoneOrder(inputs: number[], tiles: Set<number>): boolean {
  if (inputs.length !== tiles.size) return false;
  let n = 0; for (const i of tiles) if (i !== inputs[n++]) return false;
  return true;
}
function recompute(force = false) {
  const layoutVersion = tileMutationVersion();
  const live = new Set<number>();
  let changed = false;
  for (const z of animalZones()) {
    live.add(z.id);
    const cached = enclosureCache.get(z.tiles);
    const unchanged = !force && cached?.version === layoutVersion && sameZoneOrder(cached.inputs, z.tiles);
    const e = unchanged ? cached.result : enclose(z.tiles);
    if (!unchanged) enclosureCache.set(z.tiles, { version: layoutVersion, inputs: Array.from(z.tiles), result: e });
    const old = paddocks.get(z.id);
    if (old && old.fenced === e.fenced && old.why === e.why && old.water === e.water && sameList(old.list, e.list) && sameList(old.fences, e.fences)) {
      old.name = z.name;
      old.clan = z.clan;
      continue;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const i of e.list) {
      const x = i % W();
      const y = (i - x) / W();
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    paddocks.set(z.id, { zoneId: z.id, clan: z.clan, name: z.name, ...e, tiles: new Set(e.list), minX, maxX, minY, maxY, version: nextVersion++ });
    changed = true;
  }
  for (const id of Array.from(paddocks.keys())) {
    if (live.has(id)) continue;
    paddocks.delete(id);
    occupancy.delete(id);
    changed = true;
  }
  if (changed) bumpZones();
}

// Rechecked once a second (or after a zone edit); `force` rechecks now (tests, loads).
export function ensurePaddocks(force = false) {
  const sec = Math.floor(state.cycleTick / TICK_RATE);
  if (!force && sec === builtSecond && zonesVersion() === builtZones) return;
  builtSecond = sec;
  recompute(force);
  builtZones = zonesVersion();
}

export function paddockById(id: number): Paddock | undefined {
  ensurePaddocks();
  return paddocks.get(id);
}

// Chebyshev tiles from (x, y) to the nearest tile of p.
function distanceTo(p: Paddock, x: number, y: number): number {
  const box = Math.max(p.minX - x, x - p.maxX, p.minY - y, y - p.maxY, 0);
  let best = Infinity;
  for (const i of p.list) {
    const tx = i % W();
    const d = Math.max(Math.abs(tx - x), Math.abs((i - tx) / W() - y));
    if (d < best) best = d;
    if (best <= box) break;
  }
  return best;
}

// The fenced paddock a house at (x, y) of `clan` uses: choice -1 = none; a zone id = that one (own, fenced, within
// PADDOCK_CHOICE_RANGE_TILES); null = the nearest own fenced one within PADDOCK_LINK_RANGE_TILES.
export function paddockForHouse(clan: number, x: number, y: number, choice: number | null): Paddock | undefined {
  ensurePaddocks();
  if (choice === -1) return undefined;
  if (choice !== null) {
    const p = paddocks.get(choice);
    return p && p.fenced && p.clan === clan && distanceTo(p, x, y) <= PADDOCK_CHOICE_RANGE_TILES ? p : undefined;
  }
  let best: Paddock | undefined;
  let bestD = Infinity;
  for (const p of paddocks.values()) {
    if (!p.fenced || p.clan !== clan) continue;
    const d = distanceTo(p, x, y);
    if (d <= PADDOCK_LINK_RANGE_TILES && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

// The own fenced paddocks within PADDOCK_CHOICE_RANGE_TILES of a house (its panel's choices).
export function paddockChoicesFor(clan: number, x: number, y: number): Paddock[] {
  ensurePaddocks();
  return Array.from(paddocks.values()).filter((p) => p.fenced && p.clan === clan && distanceTo(p, x, y) <= PADDOCK_CHOICE_RANGE_TILES);
}

// The paddock tile nearest (x, y): where a house's animals come out and go back in.
export function paddockExitTile(p: Paddock, x: number, y: number): number {
  let best = p.list[0];
  let bestD = Infinity;
  for (const i of p.list) {
    const tx = i % W();
    const d = (tx - x) ** 2 + ((i - tx) / W() - y) ** 2;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

// animals.ts, once a second: linked animals and the tiles they need, per paddock (absent = none).
export function setPaddockOccupancy(next: Map<number, { animals: number; need: number }>) {
  let changed = next.size !== occupancy.size;
  for (const [id, o] of next) {
    const old = occupancy.get(id);
    if (!old || old.animals !== o.animals || Math.abs(old.need - o.need) > 1e-9) changed = true;
  }
  if (!changed) return;
  occupancy.clear();
  for (const [id, o] of next) occupancy.set(id, { ...o });
  bumpZones();
}

// The daily grazing step (animals.ts dailyStep): per fenced paddock, the tiles its animals need (`need`, 0 for none)
// -> coverage 0-1 (the share of PADDOCK_GRAZE_FEED_SHARE they get). Grass is eaten and regrows; nothing in winter.
export function paddockDailyGraze(need: Map<number, number>, winter: boolean): Map<number, number> {
  ensurePaddocks();
  const cover = new Map<number, number>();
  if (winter) return cover;
  const grazed = new Set<number>();
  for (const p of paddocks.values()) {
    if (!p.fenced) continue;
    const n = need.get(p.zoneId) ?? 0;
    let total = 0;
    for (const i of p.list) total += grass.get(i) ?? 1;
    if (n > 0) cover.set(p.zoneId, Math.min(1, total / n));
    const bite = (PADDOCK_GRASS_EATEN_PER_DAY * n) / p.list.length;
    for (const i of p.list) {
      grazed.add(i);
      grass.set(i, Math.max(0, (grass.get(i) ?? 1) - bite));
    }
  }
  // Regrowth: every tile with grass short of full (tiles of a broken / removed paddock too).
  for (const [i, g] of grass) {
    const next = Math.min(1, g + PADDOCK_GRASS_REGROW_PER_DAY * (g < PADDOCK_BARE_GRASS ? PADDOCK_BARE_REGROW_MULT : 1));
    if (next >= 1) grass.delete(i);
    else grass.set(i, next);
  }
  bumpZones();
  return cover;
}

// Zone snapshot / panel: an Animal area's fence state, occupancy and grass.
export function paddockSnapshot(zoneId: number): PaddockSnapshot {
  ensurePaddocks();
  const p = paddocks.get(zoneId);
  const occ = occupancy.get(zoneId) ?? { animals: 0, need: 0 };
  const need = Math.round(occ.need * 10) / 10;
  if (!p || !p.fenced) return { fenced: false, size: 0, why: p?.why ?? "not checked yet", need, animals: occ.animals, grass: 100 };
  let total = 0;
  const bare: number[] = [];
  for (const i of p.list) {
    const g = grass.get(i) ?? 1;
    total += g;
    if (g < PADDOCK_BARE_GRASS) bare.push(i);
  }
  return {
    fenced: true, area: rleEncode(p.list), size: p.list.length, need, animals: occ.animals, grass: Math.round((100 * total) / p.list.length),
    ...(bare.length > 0 ? { bare: rleEncode(bare) } : {}),
  };
}

// A hostile mob at (x, y) outside an occupied fenced paddock goes for its nearest fence / fence gate within
// PADDOCK_PREDATOR_RANGE_TILES (attacked from an outside tile next to it), or null.
export function paddockFenceTarget(x: number, y: number): { x: number; y: number; approach: TileCoord } | null {
  if (occupancy.size === 0) return null;
  const m = tileOfPixel(x, y);
  const mi = inBounds(m.x, m.y) ? tileIndex(m.x, m.y) : -1;
  const R = PADDOCK_PREDATOR_RANGE_TILES;
  let best: { x: number; y: number; approach: TileCoord } | null = null;
  let bestD = Infinity;
  for (const [id, occ] of occupancy) {
    const p = paddocks.get(id);
    if (occ.animals <= 0 || !p?.fenced || p.tiles.has(mi)) continue;
    if (m.x < p.minX - R - 1 || m.x > p.maxX + R + 1 || m.y < p.minY - R - 1 || m.y > p.maxY + R + 1) continue;
    for (const f of p.fences) {
      if (ownerAt(f) !== 0) continue;
      const fx = f % W();
      const fy = (f - fx) / W();
      const d = Math.hypot(fx - m.x, fy - m.y);
      if (d > R || d >= bestD) continue;
      let ap: TileCoord | null = null;
      let apD = Infinity;
      for (const [nx, ny] of [[fx + 1, fy], [fx - 1, fy], [fx, fy + 1], [fx, fy - 1]]) {
        if (!inBounds(nx, ny)) continue;
        const ni = tileIndex(nx, ny);
        if (p.tiles.has(ni) || !ground(state.tiles[ni])) continue;
        const dd = Math.hypot(nx - m.x, ny - m.y);
        if (dd < apD) {
          ap = { x: nx, y: ny };
          apD = dd;
        }
      }
      if (!ap) continue;
      best = { x: fx, y: fy, approach: ap };
      bestD = d;
    }
  }
  return best;
}

// ---- saves (with the zones: zones.ts) ----
// Flattened [tile, grass permille] for every tile short of full.
export function paddockGrassForSave(): number[] {
  const out: number[] = [];
  for (const [i, g] of grass) out.push(i, Math.round(g * 1000));
  return out;
}
export function restorePaddocks(flat: number[] | undefined) {
  paddocks.clear();
  grass.clear();
  occupancy.clear();
  builtSecond = -1;
  builtZones = -1;
  const n = state.tiles.length;
  for (let k = 0; k + 1 < (flat ?? []).length; k += 2) {
    const i = flat![k];
    const g = flat![k + 1] / 1000;
    if (Number.isInteger(i) && i >= 0 && i < n && g >= 0 && g < 1) grass.set(i, g);
  }
}

// ---- test hooks ----
// `set` {recheck: true} rechecks every paddock now; {zoneId, grass} sets every tile of that paddock to a grass level;
// {probe: [x, y]} (pixels) replies the fence a predator there would go for (`probe`).
export function paddocksDebug(set?: Record<string, unknown>) {
  if (set?.recheck === true) ensurePaddocks(true);
  if (set && typeof set.zoneId === "number" && typeof set.grass === "number") {
    const p = paddocks.get(set.zoneId);
    for (const i of p?.list ?? []) {
      if (set.grass >= 1) grass.delete(i);
      else grass.set(i, Math.max(0, set.grass));
    }
    bumpZones();
  }
  ensurePaddocks();
  const probe = Array.isArray(set?.probe) ? paddockFenceTarget(Number(set.probe[0]), Number(set.probe[1])) : undefined;
  return {
    ...(probe !== undefined ? { probe } : {}),
    paddocks: Array.from(paddocks.values(), (p) => ({
      zoneId: p.zoneId, clan: p.clan, name: p.name, why: p.why, fences: p.fences.length,
      water: p.water, version: p.version, minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY,
      tiles: p.list.map((i) => [i % W(), Math.floor(i / W())]),
      ...paddockSnapshot(p.zoneId),
    })),
    occupancy: Object.fromEntries(occupancy),
  };
}
