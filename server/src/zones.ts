// zones.ts: Modular building phase 3 (2026-11-09, shared/src/zones.ts): painted zones per clan, growing-zone crops,
// loose goods (piles) and the zone jobs (till / sow / tend / harvest / haul) free villagers and idle Barn farmers do.
//
// Zones are a layer beside the tiles (no setTile / chunk versions / diff log): zone records with their tile sets,
// crop state per growing tile and piles per tile, all saved (optional fields: old saves have none). A harvest leaves
// a pile of loose goods on its tile; a hauler carries it to the nearest stockpile zone whose filters take it (else to
// the nearest own Barn for food / cloth, else a Town Center) and it enters the clan's stock there (a stockpile keeps a
// tally of what it received). Phase 4 (work.ts): free villagers take zone jobs by their farming / hauling priorities
// (ZONE_PRIORITY_WORK_RATE), and every Barn farmer with no old field to tend works zones (ZONE_FARMER_WORK_RATE).
import { TileType } from "@colony/shared/protocol";
import {
  CROP_RESOURCE, CROP_SOWN_FRACTION, CROPS, CropStage, PILE_RESOURCES, RESOURCE_CATEGORY, STOCK_CATEGORIES, ZONE_EDIT_MAX_TILES,
  ZONE_EDIT_RANGE_TILES, ZONE_KIND_LABEL, ZONE_KINDS, rleDecode, rleEncode, type CropId, type StockCategory, type ZoneKind,
  type ZonesSnapshot,
} from "@colony/shared/zones";
import type { Colonist, Player, ResourceKey, TileCoord } from "./types.js";
import { colonists, state } from "./state.js";
import {
  COLONIST_SPEED, ZONE_CROP_GROW_TICKS, ZONE_CROP_YIELD, ZONE_HARVEST_TICKS, ZONE_HAUL_CARRY, ZONE_HAUL_TICKS, ZONE_JOB_RANGE_TILES,
  ZONE_JOB_RETRY_TICKS, ZONE_JOB_ROUTE_CANDIDATES, ZONE_SOW_TICKS, ZONE_TEND_TICKS, ZONE_TILL_TICKS, ZONE_UNTENDED_GROWTH,
} from "./constants.js";
import { TICK_RATE } from "@colony/shared/protocol";
import { inBounds, ownerAt, tileIndex, tileOfPixel } from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { clanById, clanIdAt, isForeignClanTile, townCentersOfClan } from "./clans.js";
import { tileIndicesOf } from "./chunks.js";

export interface ZoneRec {
  id: number;
  clan: number;
  kind: ZoneKind;
  name: string;
  crop?: CropId;
  filters?: StockCategory[];
  tiles: Set<number>;
  // Stockpiles: goods delivered here (a tally; the stock spends them like any other).
  stored: Partial<Record<string, number>>;
}
interface CropRec {
  stage: number;
  progress: number;
  // Tended by a villager or watered by the hero: full growth speed (else ZONE_UNTENDED_GROWTH).
  tended: boolean;
  // Stardew phase 5a: a hero plot (tilled by the hero outside every zone): the owning clan, and the crop sown on it.
  // A plot inside a zone (painted over it later) grows its own crop until harvested, then follows the zone.
  plot?: number;
  crop?: CropId;
}
interface Pile {
  res: string;
  n: number;
  clan: number;
}
type JobKind = "till" | "sow" | "tend" | "harvest" | "haul";
interface ZoneJob {
  kind: JobKind;
  tile: number;
  phase: "go" | "work" | "carry";
  work: number;
  // Haul: where to (a tile index; a Barn / Town Center is approached from beside it) and what is carried.
  dest?: number;
  zoneId?: number;
  carry?: { res: string; n: number };
}

const zones = new Map<number, ZoneRec>();
const zoneOfTile = new Map<number, number>();
const crops = new Map<number, CropRec>();
const piles = new Map<number, Pile>();
let nextZoneId = 1;
// Bumped by every change the clients draw (zones, crop stages, piles).
let version = 1;
// Per player: the version last sent and when (wall clock: the game may be paused while zones are painted).
const sent = new WeakMap<Player, { v: number; at: number }>();
const ZONES_RESEND_MS = 500;
// Jobs and reservations are not saved: a load restarts every job (zonesForSave puts carried goods back down first).
const jobs = new Map<string, ZoneJob>();
const reserved = new Map<number, string>();
const retry = new Map<string, number>();

const W = () => state.WORLD_TILES_X;
const bump = () => {
  version++;
};

// ---- painting ----
function tileOk(kind: ZoneKind, i: number, clan: number): boolean {
  const x = i % W();
  const y = Math.floor(i / W());
  if (!inBounds(x, y) || ownerAt(i) !== 0 || isForeignClanTile(x, y, clan)) return false;
  // Growing: natural open ground only. Others: anything walkable.
  if (kind === "growing") return state.tiles[i] === TileType.Empty;
  return state.tiles[i] === TileType.Empty || isWalkableTile(x, y);
}

function inEditRange(player: Player, x: number, y: number): boolean {
  const r = ZONE_EDIT_RANGE_TILES;
  const p = tileOfPixel(player.x, player.y);
  if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= r) return true;
  return townCentersOfClan(player.clan).some((tc) => Math.max(Math.abs(tc.x - x), Math.abs(tc.y - y)) <= r);
}

function removeTile(i: number) {
  const id = zoneOfTile.get(i);
  if (id === undefined) return;
  zoneOfTile.delete(i);
  // A hero plot outlives the zone painted over it.
  if (crops.get(i)?.plot === undefined) crops.delete(i);
  const z = zones.get(id);
  if (z) {
    z.tiles.delete(i);
    if (z.tiles.size === 0) zones.delete(id);
  }
}

function defaultName(kind: ZoneKind, crop?: CropId): string {
  let n = 1;
  for (const z of zones.values()) if (z.kind === kind) n++;
  return `${kind === "growing" && crop === "hemp" ? "Hemp field" : kind === "growing" ? "Wheat field" : ZONE_KIND_LABEL[kind]} ${n}`;
}

export function createZone(clan: number, kind: ZoneKind, crop?: CropId): ZoneRec {
  const z: ZoneRec = {
    id: nextZoneId++, clan, kind, name: defaultName(kind, crop), tiles: new Set(), stored: {},
    ...(kind === "growing" ? { crop: crop ?? "wheat" } : {}),
    ...(kind === "stockpile" ? { filters: [...STOCK_CATEGORIES] } : {}),
  };
  zones.set(z.id, z);
  return z;
}

export function addZoneTiles(z: ZoneRec, list: number[]): number {
  let added = 0;
  for (const i of list) {
    if (zoneOfTile.has(i) || !tileOk(z.kind, i, z.clan)) continue;
    zoneOfTile.set(i, z.id);
    z.tiles.add(i);
    added++;
  }
  bump();
  return added;
}

export function handleZoneEdit(player: Player, m: Record<string, unknown>) {
  if (player.dead) return;
  const clan = player.clan ?? 0;
  const zoneId = typeof m.zoneId === "number" ? m.zoneId : undefined;
  const own = zoneId !== undefined ? zones.get(zoneId) : undefined;
  if (own && own.clan !== clan) return;
  const flat = Array.isArray(m.tiles) ? m.tiles : [];
  const list: number[] = [];
  for (let k = 0; k + 1 < flat.length && list.length < ZONE_EDIT_MAX_TILES; k += 2) {
    const x = flat[k];
    const y = flat[k + 1];
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y) || !inEditRange(player, x, y)) continue;
    list.push(tileIndex(x, y));
  }
  switch (m.op) {
    case "paint": {
      let z = own;
      if (!z) {
        const kind = m.kind as ZoneKind;
        if (!ZONE_KINDS.includes(kind)) return;
        const crop = CROPS.includes(m.crop as CropId) ? (m.crop as CropId) : undefined;
        z = createZone(clan, kind, crop);
      }
      addZoneTiles(z, list);
      if (z.tiles.size === 0) zones.delete(z.id);
      break;
    }
    case "erase":
      for (const i of list) {
        const id = zoneOfTile.get(i);
        if (id !== undefined && zones.get(id)?.clan === clan && (zoneId === undefined || id === zoneId)) removeTile(i);
      }
      break;
    case "rename":
      if (own && typeof m.name === "string") own.name = m.name.trim().slice(0, 32) || own.name;
      break;
    case "setCrop":
      // A new crop: the sown / growing tiles go back to tilled (ripe ones are harvested first by nobody: lost).
      if (own?.kind === "growing" && CROPS.includes(m.crop as CropId) && own.crop !== m.crop) {
        own.crop = m.crop as CropId;
        for (const i of own.tiles) {
          const c = crops.get(i);
          if (c && c.stage > CropStage.Tilled) Object.assign(c, { stage: CropStage.Tilled, progress: 0, tended: false, crop: undefined });
        }
      }
      break;
    case "setFilters":
      if (own?.kind === "stockpile" && Array.isArray(m.filters)) own.filters = STOCK_CATEGORIES.filter((c) => (m.filters as unknown[]).includes(c));
      break;
    case "delete":
      if (own) for (const i of Array.from(own.tiles)) removeTile(i);
      if (own) zones.delete(own.id);
      break;
    default:
      return;
  }
  bump();
}

// ---- crops (once a second) ----
export function updateZones() {
  if (state.cycleTick % TICK_RATE !== 0) return;
  for (const [i, c] of crops) {
    if (state.tiles[i] !== TileType.Empty || (!zoneOfTile.has(i) && c.plot === undefined)) {
      // Built over (or the zone went): the crop is gone.
      crops.delete(i);
      bump();
      continue;
    }
    if (c.stage !== CropStage.Sown && c.stage !== CropStage.Growing) continue;
    const z = zones.get(zoneOfTile.get(i) ?? -1);
    const grow = ZONE_CROP_GROW_TICKS[c.crop ?? z?.crop ?? "wheat"];
    c.progress += TICK_RATE * (c.tended ? 1 : ZONE_UNTENDED_GROWTH);
    const stage = c.progress >= grow ? CropStage.Ripe : c.progress >= grow * CROP_SOWN_FRACTION ? CropStage.Growing : CropStage.Sown;
    if (stage !== c.stage) {
      c.stage = stage;
      bump();
    }
  }
  // Workers that are gone (died, left the clan): their reservations go.
  for (const [id, job] of jobs) {
    if (colonists.has(id)) continue;
    jobs.delete(id);
    if (reserved.get(job.tile) === id) reserved.delete(job.tile);
  }
}

// ---- piles ----
// One good per tile: another good already there goes to the nearest tile (within 2) that is free or holds the same;
// with none, straight into the clan's stock.
function addPile(i: number, res: string, n: number, clan: number) {
  bump();
  const x0 = i % W();
  const y0 = Math.floor(i / W());
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !inBounds(x0 + dx, y0 + dy)) continue;
        const j = tileIndex(x0 + dx, y0 + dy);
        const p = piles.get(j);
        if (p && p.res !== res) continue;
        if (p) p.n += n;
        else piles.set(j, { res, n, clan });
        return;
      }
    }
  }
  const stock = clanById(clan).stock as Record<string, number>;
  stock[res] = (stock[res] ?? 0) + n;
}

function acceptsRes(z: ZoneRec, res: string): boolean {
  return z.kind === "stockpile" && (z.filters ?? []).includes(RESOURCE_CATEGORY[res] ?? "other");
}

// The nearest place a hauler takes `res` from tile `from`: a matching stockpile tile, else an own Barn (food / cloth),
// else an own Town Center. dest = tile index (walk onto it, or beside a building).
function haulDestination(res: string, clan: number, from: number): { dest: number; zoneId?: number } | null {
  const fx = from % W();
  const fy = Math.floor(from / W());
  let best: { dest: number; zoneId?: number; d: number } | null = null;
  for (const z of zones.values()) {
    if (z.clan !== clan || !acceptsRes(z, res)) continue;
    for (const i of z.tiles) {
      const d = Math.max(Math.abs((i % W()) - fx), Math.abs(Math.floor(i / W()) - fy));
      if (!best || d < best.d) best = { dest: i, zoneId: z.id, d };
    }
  }
  if (best) return best;
  const cat = RESOURCE_CATEGORY[res];
  const hubs: number[] = [];
  if (cat === "food" || cat === "cloth") for (const i of tileIndicesOf(TileType.BarnPost)) if (clanIdAt(i % W(), Math.floor(i / W())) === clan && ownerAt(i) === 0) hubs.push(i);
  if (hubs.length === 0) for (const tc of townCentersOfClan(clan)) hubs.push(tileIndex(tc.x, tc.y));
  for (const i of hubs) {
    const d = Math.max(Math.abs((i % W()) - fx), Math.abs(Math.floor(i / W()) - fy));
    if (!best || d < best.d) best = { dest: i, d };
  }
  return best;
}

function deliver(job: ZoneJob, clan: number) {
  const carry = job.carry!;
  const stock = clanById(clan).stock as Record<string, number>;
  stock[carry.res] = (stock[carry.res] ?? 0) + carry.n;
  const z = job.zoneId !== undefined ? zones.get(job.zoneId) : undefined;
  if (z) z.stored[carry.res] = (z.stored[carry.res] ?? 0) + carry.n;
  job.carry = undefined;
  bump();
}

// ---- jobs ----
const near = (c: Colonist, i: number) => {
  const t = tileOfPixel(c.x, c.y);
  return Math.max(Math.abs(t.x - (i % W())), Math.abs(t.y - Math.floor(i / W()))) <= 1;
};
function pathTo(c: Colonist, i: number): TileCoord[] | null {
  const x = i % W();
  const y = Math.floor(i / W());
  const start = tileOfPixel(c.x, c.y);
  if (Math.max(Math.abs(start.x - x), Math.abs(start.y - y)) <= (isWalkableTile(x, y) ? 0 : 1)) return [];
  const goal = isWalkableTile(x, y) ? { x, y } : findAdjacentWalkable(x, y);
  return goal ? findPath(start, goal) : null;
}
function reservedByOther(i: number, id: string): boolean {
  const r = reserved.get(i);
  if (!r || r === id) return false;
  const job = jobs.get(r);
  if (job && job.tile === i && colonists.has(r)) return true;
  reserved.delete(i);
  return false;
}

function jobFor(i: number, z: ZoneRec): JobKind | null {
  if (z.kind !== "growing" || state.tiles[i] !== TileType.Empty) return null;
  const c = crops.get(i);
  const stage = c?.stage ?? CropStage.Untilled;
  if (stage === CropStage.Ripe) return "harvest";
  if (stage === CropStage.Tilled) return "sow";
  if (stage === CropStage.Untilled) return "till";
  if (!c!.tended) return "tend";
  return null;
}
const JOB_ORDER: Record<JobKind, number> = { harvest: 0, haul: 1, sow: 2, till: 3, tend: 4 };
const JOB_TICKS: Record<JobKind, number> = { harvest: ZONE_HARVEST_TICKS, haul: ZONE_HAUL_TICKS, sow: ZONE_SOW_TICKS, till: ZONE_TILL_TICKS, tend: ZONE_TEND_TICKS };

// Phase 4: which zone jobs a worker takes (farm = till / sow / tend / harvest; haul = carry piles).
export interface ZoneWorkFilter {
  farm: boolean;
  haul: boolean;
}
const ALL_ZONE_WORK: ZoneWorkFilter = { farm: true, haul: true };

function planJob(c: Colonist, filter: ZoneWorkFilter): ZoneJob | null {
  const clan = c.clan ?? 0;
  const t = tileOfPixel(c.x, c.y);
  const R = ZONE_JOB_RANGE_TILES;
  const cands: { kind: JobKind; tile: number; d: number }[] = [];
  const dist = (i: number) => Math.max(Math.abs((i % W()) - t.x), Math.abs(Math.floor(i / W()) - t.y));
  for (const z of zones.values()) {
    if (!filter.farm || z.clan !== clan || z.kind !== "growing") continue;
    for (const i of z.tiles) {
      const d = dist(i);
      if (d > R) continue;
      const kind = jobFor(i, z);
      if (!kind || reservedByOther(i, c.id)) continue;
      cands.push({ kind, tile: i, d });
    }
  }
  for (const [i, p] of piles) {
    if (!filter.haul || p.clan !== clan || p.n < 1) continue;
    const d = dist(i);
    if (d > R || reservedByOther(i, c.id)) continue;
    cands.push({ kind: "haul", tile: i, d });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => JOB_ORDER[a.kind] - JOB_ORDER[b.kind] || a.d - b.d || a.tile - b.tile);
  for (const cand of cands.slice(0, ZONE_JOB_ROUTE_CANDIDATES)) {
    const path = pathTo(c, cand.tile);
    if (!path) continue;
    c.path = path;
    reserved.set(cand.tile, c.id);
    return { kind: cand.kind, tile: cand.tile, phase: "go", work: JOB_TICKS[cand.kind] };
  }
  return null;
}

function endJob(c: Colonist, job: ZoneJob) {
  if (job.carry) {
    // Interrupted mid-carry: put the goods down where the worker stands.
    const t = tileOfPixel(c.x, c.y);
    addPile(tileIndex(t.x, t.y), job.carry.res, job.carry.n, c.clan ?? 0);
  }
  jobs.delete(c.id);
  if (reserved.get(job.tile) === c.id) reserved.delete(job.tile);
  c.path = [];
  c.state = "idle";
}

// Drops any zone job (night shelter, a new post): carried goods are put down.
export function cancelZoneJob(c: Colonist) {
  const job = jobs.get(c.id);
  if (job) endJob(c, job);
}

export function hasZoneJob(c: Colonist): boolean {
  return jobs.has(c.id);
}

// Phase 4: what a worker's zone job is (labels), or undefined.
export function zoneJobKind(c: Colonist): JobKind | undefined {
  return jobs.get(c.id)?.kind;
}

// Phase 4 (work.ts): the distance in tiles (Chebyshev) to the nearest free zone job of that sort within
// ZONE_JOB_RANGE_TILES of c, or null. No path check (the job itself plans the route).
export function zoneJobDistance(c: Colonist, sort: "farm" | "haul"): number | null {
  const clan = c.clan ?? 0;
  const t = tileOfPixel(c.x, c.y);
  const R = ZONE_JOB_RANGE_TILES;
  const dist = (i: number) => Math.max(Math.abs((i % W()) - t.x), Math.abs(Math.floor(i / W()) - t.y));
  let best: number | null = null;
  if (sort === "haul") {
    for (const [i, p] of piles) {
      if (p.clan !== clan || p.n < 1) continue;
      const d = dist(i);
      if (d <= R && (best === null || d < best) && !reservedByOther(i, c.id)) best = d;
    }
    return best;
  }
  for (const z of zones.values()) {
    if (z.clan !== clan || z.kind !== "growing") continue;
    for (const i of z.tiles) {
      const d = dist(i);
      if (d > R || (best !== null && d >= best)) continue;
      if (jobFor(i, z) && !reservedByOther(i, c.id)) best = d;
    }
  }
  return best;
}

// Phase 4: does the clan have any free zone job of that sort (anywhere)? Used to decide whether a better-priority
// job is waiting (work.ts), so cheap: the first hit returns.
export function clanHasZoneWork(clan: number, sort: "farm" | "haul"): boolean {
  if (sort === "haul") {
    for (const [i, p] of piles) if (p.clan === clan && p.n >= 1 && !reservedByOther(i, "")) return true;
    return false;
  }
  for (const z of zones.values()) {
    if (z.clan !== clan || z.kind !== "growing") continue;
    for (const i of z.tiles) if (jobFor(i, z) && !reservedByOther(i, "")) return true;
  }
  return false;
}

// A worker's zone step: true while it is busy with a zone job (callers skip their own idle behaviour).
export function updateZoneWorker(c: Colonist, dt: number, rate: number, filter: ZoneWorkFilter = ALL_ZONE_WORK): boolean {
  let job = jobs.get(c.id);
  if (!job) {
    if (!filter.farm && !filter.haul) return false;
    if (zones.size === 0 && piles.size === 0) return false;
    const wait = retry.get(c.id) ?? 0;
    if (wait > 0) {
      retry.set(c.id, wait - 1);
      return false;
    }
    job = planJob(c, filter) ?? undefined;
    if (!job) {
      retry.set(c.id, ZONE_JOB_RETRY_TICKS);
      return false;
    }
    jobs.set(c.id, job);
  }
  const clan = c.clan ?? 0;
  // Still worth doing?
  if (job.phase !== "carry") {
    const z = zones.get(zoneOfTile.get(job.tile) ?? -1);
    const valid = job.kind === "haul" ? (piles.get(job.tile)?.n ?? 0) >= 1 : !!z && z.clan === clan && jobFor(job.tile, z) === job.kind;
    if (!valid) {
      endJob(c, job);
      return true;
    }
  }
  if (job.phase === "go" || job.phase === "carry") {
    const target = job.phase === "go" ? job.tile : job.dest!;
    if (c.path.length > 0) {
      advanceAlongPath(c, dt, COLONIST_SPEED);
      c.state = job.phase === "carry" ? "carrying" : "returning";
      return true;
    }
    if (!near(c, target)) {
      // Interrupted (night, a blocked path): find the way again once, else give up.
      const path = pathTo(c, target);
      if (!path || path.length === 0) {
        endJob(c, job);
        return true;
      }
      c.path = path;
      return true;
    }
    if (job.phase === "carry") {
      deliver(job, clan);
      endJob(c, job);
      return true;
    }
    job.phase = "work";
  }
  // Working on the tile.
  c.state = job.kind === "haul" ? "idle" : "farming";
  job.work -= rate;
  if (job.work > 0) return true;
  const i = job.tile;
  const crop = crops.get(i);
  const z = zones.get(zoneOfTile.get(i) ?? -1);
  switch (job.kind) {
    case "till":
      crops.set(i, { stage: CropStage.Tilled, progress: 0, tended: false });
      break;
    case "sow":
      // (A hero plot inside the zone stays a plot; it now grows the zone's crop.)
      if (crop) Object.assign(crop, { stage: CropStage.Sown, progress: 0, tended: false, crop: undefined });
      else crops.set(i, { stage: CropStage.Sown, progress: 0, tended: false });
      break;
    case "tend":
      if (crop) crop.tended = true;
      break;
    case "harvest": {
      const cropId = crop?.crop ?? z?.crop ?? "wheat";
      // Back to tilled soil: sow again.
      if (crop) Object.assign(crop, { stage: CropStage.Tilled, progress: 0, tended: false, crop: undefined });
      else crops.set(i, { stage: CropStage.Tilled, progress: 0, tended: false });
      addPile(i, CROP_RESOURCE[cropId], ZONE_CROP_YIELD[cropId], clan);
      break;
    }
    case "haul": {
      const p = piles.get(i);
      if (!p) break;
      const n = Math.min(ZONE_HAUL_CARRY, Math.floor(p.n));
      const to = haulDestination(p.res, clan, i);
      if (!to || n < 1) break;
      const path = pathTo(c, to.dest);
      if (!path) break;
      p.n -= n;
      if (p.n <= 1e-9) piles.delete(i);
      job.carry = { res: p.res, n };
      job.dest = to.dest;
      job.zoneId = to.zoneId;
      job.phase = "carry";
      c.path = path;
      if (reserved.get(i) === c.id) reserved.delete(i);
      bump();
      return true;
    }
  }
  bump();
  endJob(c, job);
  return true;
}

// Home area: a random tile of one of the clan's home zones within `r` tiles of (tx, ty), or null.
export function homeAreaTileNear(clan: number, tx: number, ty: number, r: number): TileCoord | null {
  const list: number[] = [];
  for (const z of zones.values()) {
    if (z.clan !== clan || z.kind !== "home") continue;
    for (const i of z.tiles) if (Math.max(Math.abs((i % W()) - tx), Math.abs(Math.floor(i / W()) - ty)) <= r) list.push(i);
  }
  if (list.length === 0) return null;
  const i = list[Math.floor(Math.random() * list.length)];
  return { x: i % W(), y: Math.floor(i / W()) };
}

// ---- snapshot / saves ----
export function zonesSnapshotFor(clan: number): ZonesSnapshot {
  const stock = clanById(clan).stock as Record<string, number>;
  const out: ZonesSnapshot = { zones: [], crops: [], piles: [] };
  for (const z of zones.values()) {
    if (z.clan !== clan) continue;
    const stored: Record<string, number> = {};
    for (const [k, v] of Object.entries(z.stored)) if ((v ?? 0) >= 1) stored[k] = Math.floor(Math.min(v ?? 0, stock[k] ?? 0));
    out.zones.push({
      id: z.id, kind: z.kind, name: z.name, ...(z.crop ? { crop: z.crop } : {}), ...(z.filters ? { filters: z.filters } : {}),
      tiles: rleEncode(Array.from(z.tiles).sort((a, b) => a - b)), ...(z.kind === "stockpile" ? { stored } : {}),
    });
    for (const i of z.tiles) {
      const c = crops.get(i);
      if (c && c.stage > 0) out.crops.push(i, cropCode(c));
    }
  }
  // Stardew phase 5a: the clan's hero plots outside every zone.
  for (const [i, c] of crops) if (c.plot === clan && !zoneOfTile.has(i) && c.stage > 0) out.crops.push(i, cropCode(c));
  for (const [i, p] of piles) if (p.clan === clan && p.n >= 1) out.piles.push(i, (PILE_RESOURCES as readonly string[]).indexOf(p.res), Math.floor(p.n));
  return out;
}

// The snapshot field for this player, or null when nothing changed (at most every half second).
export function zonesPayloadFor(player: Player): string | null {
  const s = sent.get(player);
  if (s && s.v === version) return null;
  const now = Date.now();
  if (s && now - s.at < ZONES_RESEND_MS) return null;
  sent.set(player, { v: version, at: now });
  return JSON.stringify(zonesSnapshotFor(player.clan ?? 0));
}

export function zonesForSave() {
  // Goods being carried are saved as piles where the carrier stands (jobs are not saved; the live game is untouched).
  const savedPiles = Array.from(piles, ([i, p]) => [i, p.res, Math.round(p.n * 1000) / 1000, p.clan] as [number, string, number, number]);
  for (const [id, job] of jobs) {
    const c = colonists.get(id);
    if (!job.carry || !c) continue;
    const t = tileOfPixel(c.x, c.y);
    const i = tileIndex(t.x, t.y);
    // This tile or a neighbour that is free or holds the same good.
    for (const j of [i, i + 1, i - 1, i + W(), i - W()]) {
      const at = savedPiles.find((p) => p[0] === j);
      if (at && at[1] !== job.carry.res) continue;
      if (at) at[2] += job.carry.n;
      else savedPiles.push([j, job.carry.res, job.carry.n, c.clan ?? 0]);
      break;
    }
  }
  return {
    nextId: nextZoneId,
    zones: Array.from(zones.values()).map((z) => ({
      id: z.id, clan: z.clan, kind: z.kind, name: z.name, crop: z.crop, filters: z.filters, stored: z.stored,
      tiles: rleEncode(Array.from(z.tiles).sort((a, b) => a - b)),
    })),
    // Hero plots add [plot clan, crop index or -1] (older saves: 4-tuples, zone tiles only).
    crops: Array.from(crops, ([i, c]) => {
      const base = [i, c.stage, Math.round(c.progress), c.tended ? 1 : 0];
      return c.plot === undefined ? base : [...base, c.plot, c.crop ? CROPS.indexOf(c.crop) : -1];
    }),
    piles: savedPiles,
  };
}
export type ZonesSave = ReturnType<typeof zonesForSave>;

export function restoreZones(s: ZonesSave | undefined) {
  zones.clear();
  zoneOfTile.clear();
  crops.clear();
  piles.clear();
  jobs.clear();
  reserved.clear();
  retry.clear();
  nextZoneId = s?.nextId ?? 1;
  for (const z of s?.zones ?? []) {
    const rec: ZoneRec = { id: z.id, clan: z.clan, kind: z.kind, name: z.name, tiles: new Set(), stored: { ...(z.stored ?? {}) } };
    if (z.crop) rec.crop = z.crop;
    if (z.filters) rec.filters = [...z.filters];
    for (const i of rleDecode(z.tiles)) {
      if (i < 0 || i >= state.tiles.length || zoneOfTile.has(i)) continue;
      rec.tiles.add(i);
      zoneOfTile.set(i, rec.id);
    }
    if (rec.tiles.size > 0) zones.set(rec.id, rec);
    nextZoneId = Math.max(nextZoneId, rec.id + 1);
  }
  for (const [i, stage, progress, tended, plot, cropIdx] of s?.crops ?? []) {
    if (!Number.isInteger(i) || i < 0 || i >= state.tiles.length) continue;
    const rec: CropRec = { stage, progress, tended: tended === 1 };
    if (typeof plot === "number") {
      rec.plot = plot;
      if (typeof cropIdx === "number" && CROPS[cropIdx]) rec.crop = CROPS[cropIdx];
    } else if (!zoneOfTile.has(i)) continue;
    crops.set(i, rec);
  }
  for (const [i, res, n, clan] of s?.piles ?? []) if (i >= 0 && i < state.tiles.length) piles.set(i, { res, n, clan });
  bump();
}

// ---- Stardew phase 5a: hero tools on tiles (herolife.ts) ----
// The hero tills, sows, waters and harvests the tile it faces. Inside an own GROWING zone it works that zone's tile
// (the zone's crop; villagers with farming priority may tend / harvest it too). Anywhere else on open, unclaimed ground
// it makes a HERO PLOT: a crop tile owned by the hero's clan with its own crop, which villagers never touch (their
// jobs only walk zones), grows like a zone tile (half speed unless watered) and is saved with the crops.
export type HeroFarmAct = "till" | "sow" | "water" | "harvest";

// Snapshot code of a crop tile: stage (bits 0-2), tended / watered (bit 3), a plot's own crop index + 1 (bits 4+).
function cropCode(c: CropRec): number {
  return c.stage | (c.tended ? 8 : 0) | (c.crop ? (CROPS.indexOf(c.crop) + 1) << 4 : 0);
}

function heroZoneAt(i: number): ZoneRec | undefined {
  const id = zoneOfTile.get(i);
  return id === undefined ? undefined : zones.get(id);
}

// The crop an own growing zone at i grows (the hero sows that, with no seed used), or null outside zones.
export function heroZoneCrop(i: number, clan: number): CropId | null {
  const z = heroZoneAt(i);
  return z && z.clan === clan && z.kind === "growing" ? z.crop ?? "wheat" : null;
}

// Crop stage at i (0 = untilled) for the hero's tool choice.
export function heroCropStage(i: number): number {
  return crops.get(i)?.stage ?? CropStage.Untilled;
}

// Why the hero cannot do `act` at tile i ("" = it can).
export function heroFarmCheck(act: HeroFarmAct, i: number, clan: number): string {
  const x = i % W();
  const y = Math.floor(i / W());
  if (!inBounds(x, y)) return "Out of bounds";
  const z = heroZoneAt(i);
  if (z && z.clan !== clan) return "That field is another clan's";
  if (z && z.kind !== "growing") return `Not in a ${ZONE_KIND_LABEL[z.kind].toLowerCase()}`;
  const c = crops.get(i);
  if (c?.plot !== undefined && c.plot !== clan) return "That plot is another clan's";
  if (state.tiles[i] !== TileType.Empty || ownerAt(i) !== 0) return act === "till" ? "Only open ground can be tilled" : "No soil there";
  if (isForeignClanTile(x, y, clan)) return "That is another clan's land";
  const stage = c?.stage ?? CropStage.Untilled;
  switch (act) {
    case "till":
      return stage === CropStage.Untilled ? "" : "Already tilled";
    case "sow":
      return stage === CropStage.Tilled ? "" : stage === CropStage.Untilled ? "Till the soil first (hoe)" : "Already sown";
    case "water":
      return stage === CropStage.Untilled ? "Nothing to water: till it first" : stage === CropStage.Ripe ? "Ripe: harvest it" : c!.tended ? "Already watered" : "";
    case "harvest":
      return stage === CropStage.Ripe ? "" : "Nothing ripe there";
  }
}

// Does it (heroFarmCheck first). Harvest returns the yield (the hero's pack takes it).
export function heroFarmApply(act: HeroFarmAct, i: number, clan: number, crop: CropId): { res: "grain" | "cotton"; crop: CropId; n: number } | null {
  const z = heroZoneAt(i);
  const c = crops.get(i);
  let out: { res: "grain" | "cotton"; crop: CropId; n: number } | null = null;
  if (act === "till") crops.set(i, { stage: CropStage.Tilled, progress: 0, tended: false, ...(z ? {} : { plot: clan }) });
  else if (c && act === "sow") Object.assign(c, { stage: CropStage.Sown, progress: 0, crop: z ? undefined : crop });
  else if (c && act === "water") c.tended = true;
  else if (c && act === "harvest") {
    const id = c.crop ?? z?.crop ?? "wheat";
    out = { res: CROP_RESOURCE[id], crop: id, n: ZONE_CROP_YIELD[id] };
    Object.assign(c, { stage: CropStage.Tilled, progress: 0, tended: false, crop: undefined });
  }
  bump();
  return out;
}

// ---- test hooks ----
export function zonesDebug() {
  const stages = [0, 0, 0, 0, 0];
  let tended = 0;
  for (const z of zones.values()) {
    if (z.kind !== "growing") continue;
    for (const i of z.tiles) {
      stages[crops.get(i)?.stage ?? 0]++;
      if (crops.get(i)?.tended) tended++;
    }
  }
  return {
    tended,
    zones: Array.from(zones.values()).map((z) => ({ id: z.id, clan: z.clan, kind: z.kind, name: z.name, crop: z.crop, filters: z.filters, size: z.tiles.size, stored: z.stored })),
    stages,
    piles: Array.from(piles, ([i, p]) => ({ x: i % W(), y: Math.floor(i / W()), res: p.res, n: p.n, clan: p.clan })),
    jobs: Array.from(jobs, ([id, j]) => ({ id, kind: j.kind, phase: j.phase, carry: j.carry ?? null })),
    // Stardew phase 5a: every crop tile the hero made or touched outside zones, and hero plots inside them.
    plots: Array.from(crops).filter(([, c]) => c.plot !== undefined).map(([i, c]) => ({ x: i % W(), y: Math.floor(i / W()), clan: c.plot, stage: c.stage, progress: c.progress, tended: c.tended, crop: c.crop ?? null, inZone: zoneOfTile.has(i) })),
    version,
  };
}
// One crop tile: stage / progress / tended (Stardew phase 5a tests).
export function debugSetCropAt(i: number, set: { stage?: number; progress?: number; tended?: boolean }) {
  const c = crops.get(i);
  if (!c) return;
  if (typeof set.stage === "number") c.stage = set.stage;
  if (typeof set.progress === "number") c.progress = set.progress;
  if (typeof set.tended === "boolean") c.tended = set.tended;
  bump();
}
// Sets every crop of the zone at (x, y) (or all) to `stage` (Ripe: grown; Sown / Growing: progress at that stage).
export function debugSetCrops(stage: number, tended: boolean, zoneId?: number) {
  for (const z of zones.values()) {
    if (z.kind !== "growing" || (zoneId !== undefined && z.id !== zoneId)) continue;
    const grow = ZONE_CROP_GROW_TICKS[z.crop ?? "wheat"];
    for (const i of z.tiles) {
      if (stage === 0) crops.delete(i);
      else crops.set(i, { stage, progress: stage === CropStage.Ripe ? grow : stage === CropStage.Growing ? grow * CROP_SOWN_FRACTION : 0, tended });
    }
  }
  bump();
}
