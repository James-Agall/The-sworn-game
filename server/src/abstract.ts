// abstract.ts: World streaming phase 3 (PLAN-world-streaming.md §4-5): abstract records for COLD chunks and the
// deterministic catch-up when a chunk leaves COLD. Runs after every chunk re-classification (once a second), only
// while streamingOn() (768+ maps, or COLONY_STREAMING=1 in tests); below that nothing here ever parks anything.
//  - Mobs: an idle free mob (mobFrozenByStreaming: dormant guardians, garrisons, stray mobs) in a COLD chunk is
//    PARKED: moved from `mobs` to `parkedMobs` unchanged (hp, post, kind), and put back when its chunk warms up.
//    Site garrisons keep the parked ids; the existing site catch-up (catchUpSite / catchUpCampGrowth on waking)
//    then refills by elapsed time as before.
//  - Wildlife: animals in a COLD chunk become a per-kind COUNT; on waking the count is caught up in closed form
//    (logistic toward a per-chunk level, never above the global cap) and real animals spawn inside the chunk.
//  - Forage regrowth: timers in COLD chunks stand still (wildlife.ts) and are caught up by the elapsed ticks.
// Dice: worldRng(worldNoiseSalt, chunk / site / wagon id, day), so a reload or replay rolls the same outcome.
// Conservation: every entity is in exactly one form; auditWorld (test hook) checks it.
import { type WildlifeKind, WILDLIFE_KINDS } from "@colony/shared/protocol";
import { GAME_DAY_TICKS } from "./constants.js";
import { forageRegrow, mobs, parkedMobs, sites, state, wildlife } from "./state.js";
import {
  CHUNK_TILES, ChunkState, chunkAtPixel, chunkClassifyCount, chunkCounts, chunkOfIndex, chunkStateOf, mobFrozenByStreaming,
  resetChunkStates, streamingOn,
} from "./chunks.js";
import { WILDLIFE_CONFIG, spawnWildlifeAt, wildlifeTileOk } from "./wildlife.js";

// ---- deterministic dice ----
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// mulberry32 seeded from the world seed and the keys (chunk / site / wagon id hash, day index).
export function worldRng(...keys: number[]): () => number {
  let h = (state.worldNoiseSalt | 0) ^ 0x9e3779b9;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- COLD chunk records ----
type WildCounts = Record<WildlifeKind, number>;
interface ColdChunk {
  since: number;
  mobIds: Set<string>;
  wild: WildCounts;
}
const zeroWild = (): WildCounts => ({ deer: 0, rabbit: 0, boar: 0, pheasant: 0 });
const cold = new Map<number, ColdChunk>();
const parkedWild = zeroWild();
let lastPass = -1;
// Transition ledger (auditWorld): parked - unparked must equal what is parked now.
export const abstractStats = {
  mobsParked: 0, mobsUnparked: 0, mobsDropped: 0,
  wildParked: 0, wildUnparked: 0, wildBorn: 0, wildDied: 0, wildLost: 0, wildRespawnedCold: 0,
  chunksWoken: 0, forageCaughtUp: 0,
};
// Wildlife catch-up: daily approach rate toward the per-chunk level, and that level as a multiple of cap / chunks.
const WILD_DAILY_RATE = 0.15;
const WILD_CHUNK_LEVEL = 3;

export function parkedWildlifeCount(kind: WildlifeKind): number {
  return parkedWild[kind];
}

// wildlife.ts updateWildlifeRespawn: an animal due to spawn on a COLD chunk tile joins that chunk's count.
export function parkRespawnedWildlife(kind: WildlifeKind, tx: number, ty: number): boolean {
  if (cold.size === 0) return false;
  const rec = cold.get(chunkOfIndex(ty * state.WORLD_TILES_X + tx));
  if (!rec) return false;
  rec.wild[kind]++;
  parkedWild[kind]++;
  abstractStats.wildRespawnedCold++;
  return true;
}

// wildlife.ts updateForageRegrow: a COLD chunk's regrowth timers stand still (caught up on waking).
export function forageFrozen(index: number): boolean {
  return cold.size > 0 && cold.has(chunkOfIndex(index));
}

// warbands.ts removeSite: a site going away takes its parked guardians with it.
export function dropParkedSiteMobs(siteId: string) {
  for (const rec of cold.values()) {
    for (const id of rec.mobIds) {
      if (parkedMobs.get(id)?.siteId !== siteId) continue;
      parkedMobs.delete(id);
      rec.mobIds.delete(id);
      abstractStats.mobsDropped++;
    }
  }
}

// sim.ts after updateChunkStates: one park / wake pass per re-classification.
export function updateAbstractWorld() {
  if (chunkClassifyCount === lastPass) return;
  lastPass = chunkClassifyCount;
  if (!streamingOn()) {
    if (cold.size > 0) for (const [c, rec] of Array.from(cold)) wakeChunk(c, rec);
    return;
  }
  const { chunksX, chunksY } = chunkCounts();
  const now = state.cycleTick;
  for (const [c, rec] of Array.from(cold)) if (chunkStateOf(c) !== ChunkState.Cold) wakeChunk(c, rec);
  for (let c = 0; c < chunksX * chunksY; c++) {
    if (chunkStateOf(c) === ChunkState.Cold && !cold.has(c)) cold.set(c, { since: now, mobIds: new Set(), wild: zeroWild() });
  }
  if (cold.size === 0) return;
  for (const m of mobs.values()) {
    if (m.hp <= 0 || m.siteWorker || !mobFrozenByStreaming(m)) continue;
    const rec = cold.get(chunkAtPixel(m.x, m.y));
    if (!rec) continue;
    mobs.delete(m.id);
    parkedMobs.set(m.id, m);
    rec.mobIds.add(m.id);
    abstractStats.mobsParked++;
  }
  for (const a of wildlife.values()) {
    if (a.reservedBy || a.chargeTargetId || a.mode === "flee" || a.mode === "charge") continue;
    const rec = cold.get(chunkAtPixel(a.x, a.y));
    if (!rec) continue;
    wildlife.delete(a.id);
    rec.wild[a.kind]++;
    parkedWild[a.kind]++;
    abstractStats.wildParked++;
  }
}

// Leaving COLD: parked mobs come back as they were, the animal counts are caught up and spawned, forage
// timers are advanced by the time the chunk spent COLD.
function wakeChunk(c: number, rec: ColdChunk) {
  cold.delete(c);
  abstractStats.chunksWoken++;
  for (const id of rec.mobIds) {
    const m = parkedMobs.get(id);
    if (!m) continue;
    parkedMobs.delete(id);
    mobs.set(id, m);
    abstractStats.mobsUnparked++;
  }
  const now = state.cycleTick;
  const elapsed = Math.max(0, now - rec.since);
  const days = Math.floor(elapsed / GAME_DAY_TICKS);
  const rng = worldRng(c, Math.floor(now / GAME_DAY_TICKS));
  const { chunksX, chunksY } = chunkCounts();
  const x0 = (c % chunksX) * CHUNK_TILES;
  const y0 = Math.floor(c / chunksX) * CHUNK_TILES;
  for (const kind of WILDLIFE_KINDS) {
    let n = rec.wild[kind];
    parkedWild[kind] -= n;
    abstractStats.wildUnparked += n;
    if (days > 0) {
      const cap = WILDLIFE_CONFIG[kind].cap;
      const level = Math.max(1, Math.round((cap / (chunksX * chunksY)) * WILD_CHUNK_LEVEL));
      let next = Math.floor(level + (n - level) * Math.pow(1 - WILD_DAILY_RATE, days) + rng());
      if (next > n) {
        let live = 0;
        for (const a of wildlife.values()) if (a.kind === kind) live++;
        next = Math.min(next, n + Math.max(0, cap - live - parkedWild[kind] - n));
      }
      next = Math.max(0, next);
      if (next > n) abstractStats.wildBorn += next - n;
      else abstractStats.wildDied += n - next;
      n = next;
    }
    for (let i = 0; i < n; i++) {
      let placed = false;
      for (let t = 0; t < 40 && !placed; t++) {
        const tx = x0 + Math.floor(rng() * CHUNK_TILES);
        const ty = y0 + Math.floor(rng() * CHUNK_TILES);
        if (tx >= state.WORLD_TILES_X || ty >= state.WORLD_TILES_Y || !wildlifeTileOk(kind, tx, ty)) continue;
        spawnWildlifeAt(kind, tx, ty);
        placed = true;
      }
      if (!placed) abstractStats.wildLost++;
    }
  }
  if (elapsed > 0) {
    for (const [i, ticks] of forageRegrow) {
      if (chunkOfIndex(i) !== c) continue;
      forageRegrow.set(i, Math.max(1, ticks - elapsed));
      abstractStats.forageCaughtUp++;
    }
  }
}

// ---- new world / saves ----
export function clearAbstractWorld() {
  cold.clear();
  parkedMobs.clear();
  Object.assign(parkedWild, zeroWild());
  for (const k of Object.keys(abstractStats) as (keyof typeof abstractStats)[]) abstractStats[k] = 0;
  lastPass = -1;
  resetChunkStates();
}

// Parked mobs are saved with the live ones (saves.ts); the records keep the animal counts and COLD-since ticks.
export function abstractForSave() {
  return {
    chunks: Array.from(cold, ([c, r]) => [c, r.since, ...WILDLIFE_KINDS.map((k) => r.wild[k])]),
  };
}

// After the mobs / wildlife are restored. Parked mobs came back live; the next pass re-parks them.
export function restoreAbstract(saved: ReturnType<typeof abstractForSave> | undefined) {
  clearAbstractWorld();
  for (const row of saved?.chunks ?? []) {
    const [c, since, ...w] = row;
    const rec: ColdChunk = { since, mobIds: new Set(), wild: zeroWild() };
    WILDLIFE_KINDS.forEach((k, i) => {
      rec.wild[k] = Math.max(0, Math.floor(w[i] ?? 0));
      parkedWild[k] += rec.wild[k];
    });
    cold.set(c, rec);
  }
}

// ---- test hook 'auditWorld': no duplicated / vanished entities ----
export function auditWorld(): { ok: boolean; problems: string[]; counts: Record<string, number> } {
  const problems: string[] = [];
  const p = (s: string) => problems.length < 30 && problems.push(s);
  const listed = new Map<string, number>();
  for (const [c, rec] of cold) {
    if (streamingOn() && chunkStateOf(c) !== ChunkState.Cold && lastPass === chunkClassifyCount) p(`record for non-COLD chunk ${c}`);
    for (const id of rec.mobIds) {
      if (listed.has(id)) p(`mob ${id} parked in chunks ${listed.get(id)} and ${c}`);
      listed.set(id, c);
      const m = parkedMobs.get(id);
      if (!m) p(`chunk ${c} lists missing parked mob ${id}`);
      else if (chunkAtPixel(m.x, m.y) !== c) p(`parked mob ${id} is outside its chunk ${c}`);
    }
  }
  for (const id of parkedMobs.keys()) {
    if (mobs.has(id)) p(`mob ${id} both live and parked`);
    if (!listed.has(id)) p(`parked mob ${id} in no chunk record`);
  }
  const wild = zeroWild();
  for (const rec of cold.values()) for (const k of WILDLIFE_KINDS) wild[k] += rec.wild[k];
  for (const k of WILDLIFE_KINDS) {
    if (wild[k] !== parkedWild[k]) p(`parked ${k} total ${parkedWild[k]} != records ${wild[k]}`);
    let live = 0;
    for (const a of wildlife.values()) if (a.kind === k) live++;
    if (wild[k] > 0 && live + wild[k] > WILDLIFE_CONFIG[k].cap) p(`${k}: ${live} live + ${wild[k]} parked over cap ${WILDLIFE_CONFIG[k].cap}`);
  }
  const owner = new Map<string, string>();
  for (const s of sites.values()) {
    for (const id of s.garrison) {
      if (owner.has(id)) p(`mob ${id} in the garrisons of ${owner.get(id)} and ${s.id}`);
      owner.set(id, s.id);
    }
  }
  if (abstractStats.mobsParked - abstractStats.mobsUnparked - abstractStats.mobsDropped !== parkedMobs.size) {
    p(`mob ledger: parked ${abstractStats.mobsParked} - unparked ${abstractStats.mobsUnparked} - dropped ${abstractStats.mobsDropped} != ${parkedMobs.size}`);
  }
  const wildTotal = WILDLIFE_KINDS.reduce((a, k) => a + parkedWild[k], 0);
  return {
    ok: problems.length === 0,
    problems,
    counts: { coldChunks: cold.size, parkedMobs: parkedMobs.size, liveMobs: mobs.size, parkedWildlife: wildTotal, liveWildlife: wildlife.size, ...abstractStats },
  };
}
