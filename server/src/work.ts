// work.ts: Modular building phase 4 (2026-11-09, docs PLAN-rimworld-stardew.md; shared/src/work.ts): job priorities.
//
// Every adult civilian has a priority per work type (Person.work: 1-4, 0 = off; missing = the default from its post
// and skills). The clan is in default mode (priorities are the defaults, cells are on / off) or manual mode (the stored
// numbers). Who works where:
//  - Free villagers pick, each time they are out of work, the best-priority job on offer (ties: nearest): building
//    (a clan construction site with room), farming (growing-zone jobs), hauling (loose goods). Station / building
//    posts (Lumber Camp, Quarry, Barn, Bakery, Town Center builders, ...) are offered centrally: a vacancy goes to
//    the free villager with the best priority for its work type, then the best skill, then the nearest, skipping
//    anyone busy with a strictly better-priority job (chooseWorkerFor; staffPost and processRespawnQueue).
//  - A worker on a post stays there (the old job slot is an override) while its work type is not off; set it off and
//    it goes back to the village (the post is open again). A worker put on its post by priorities (byPriority) also
//    leaves after WORK_MIN_SHIFT_TICKS when a strictly better-priority job is waiting.
//  - Fighting: a Town Center's call to arms and soldier training only take people with fighting on.
//  - Gap closure G3: a free villager can be put on a post by hand (assignWorkerTo: building panel / person card). It is
//    pinned (Person.pinned): never moved by priorities, takes the slot of a priority-placed worker if none is open,
//    and stays until Unassign (unassignWorker: back to the village, not refilled onto that post by priorities for
//    WORK_UNASSIGN_HOLD_TICKS) or its work type is set off. Sleep, meals and shelter are unchanged.
// Runtime job state is not saved (a load re-decides); priorities and the mode are.
import { animalJobDistance, animalJobLabel, cancelAnimalJob, clanHasAnimalWork, hasAnimalJob, updateAnimalJob } from "./animals.js";
import { TileType, type ColonistKind } from "@colony/shared/protocol";
import { PROFESSION_LABEL, PROGRESSION, PROGRESSION_BUILDING_LABEL, TIER_SPEED_BONUS, levelForXp, type Profession } from "@colony/shared/progression";
import {
  WORK_POST_CANDIDATES_MAX, WORK_POST_OPTIONS_MAX, type BuildingPostsInfo, type WorkPostOption,
  PROFESSION_WORK, WORK_DEFAULT, WORK_DEFAULT_ASSIGNED, WORK_DEFAULT_LEVEL_SKILLED, WORK_DEFAULT_SKILLED, WORK_LABEL,
  WORK_PRIORITY_MAX, WORK_PROFESSIONS, WORK_TYPES, type WorkTabRow, type WorkTabSnapshot, type WorkType,
} from "@colony/shared/work";
import type { Colonist, Person, Player } from "./types.js";
import { colonists, constructionSites, respawnQueue, state } from "./state.js";
import { BUILDER_MAX_PER_SITE, WORK_DECIDE_TICKS, WORK_MIN_SHIFT_TICKS, WORK_RECHECK_TICKS, WORK_UNASSIGN_HOLD_TICKS, ZONE_PRIORITY_WORK_RATE } from "./constants.js";
import { clanById, clanIdAt, withClan } from "./clans.js";
import { anchorOfTile, inBounds, tileIndex, tileOfPixel } from "./tiles.js";
import {
  freeVillagerFor, isCivilianKind, isFreeVillager, queueRespawn, releaseToVillage, spawnColonistForPost, transplantPerson, updateBuilder,
} from "./colonists.js";
import { cancelZoneJob, clanHasZoneWork, hasZoneJob, updateZoneWorker, zoneJobDistance, zoneJobKind } from "./zones.js";

// ---- mode (saved: the clans in manual mode) ----
const manualClans = new Set<number>();
export function isWorkManual(clan: number): boolean {
  return manualClans.has(clan);
}

// ---- priorities and skills ----
// The work type of a post (a civilian kind posted at a tile), or undefined (villagers, soldiers, bishops).
export function workTypeOfPost(kind: ColonistKind, tx: number, ty: number): WorkType | undefined {
  if (kind === "builder") return "building";
  if (kind === "villager" || !isCivilianKind(kind) || !inBounds(tx, ty)) return undefined;
  const prof = PROGRESSION.stations[state.tiles[tileIndex(tx, ty)] as TileType];
  return prof ? PROFESSION_WORK[prof] : undefined;
}
// The work type of the post c is assigned to (people only; a levied / training person has none).
export function assignedWorkType(c: Colonist): WorkType | undefined {
  if (!c.person || c.callUp || c.training) return undefined;
  return workTypeOfPost(c.kind, c.postX, c.postY);
}

function typeXp(p: Person, t: WorkType): number {
  let best = 0;
  for (const prof of WORK_PROFESSIONS[t]) best = Math.max(best, p.xp?.[prof] ?? 0);
  return best;
}
// Skill level 1-4 in a work type (its best profession), 0 for the types with no skill (building, hauling, fighting).
export function workSkill(p: Person, t: WorkType): number {
  return WORK_PROFESSIONS[t].length > 0 ? levelForXp(typeXp(p, t)) : 0;
}
// Work-speed factor from skill: +TIER_SPEED_BONUS per level above 1 (the station tier bonus, progression.ts).
export function skillSpeed(c: Colonist, t: WorkType): number {
  const level = c.person ? workSkill(c.person, t) : 0;
  return 1 + TIER_SPEED_BONUS * Math.max(0, level - 1);
}

export function defaultWorkPriority(c: Colonist, t: WorkType): number {
  if (assignedWorkType(c) === t) return WORK_DEFAULT_ASSIGNED;
  if (c.person && workSkill(c.person, t) >= WORK_DEFAULT_LEVEL_SKILLED) return WORK_DEFAULT_SKILLED;
  return WORK_DEFAULT;
}

// The priority c works t at: 0 = off, else 1 (first) .. 4. Children and non-people never work.
export function workPriority(c: Colonist, t: WorkType): number {
  const p = c.person;
  if (!p || p.child) return 0;
  const stored = p.work?.[t];
  if (stored === 0) return 0;
  if (stored !== undefined && manualClans.has(c.clan ?? 0)) return Math.min(WORK_PRIORITY_MAX, Math.max(1, Math.round(stored)));
  return defaultWorkPriority(c, t);
}

// ---- per-tick caches (cheap "is there any X work" checks) ----
let cacheTick = -1;
let siteCounts = new Map<string, number>();
const clanWork = new Map<number, Map<WorkType, boolean>>();
function freshCaches() {
  if (cacheTick === state.cycleTick) return;
  cacheTick = state.cycleTick;
  siteCounts = new Map();
  for (const c of colonists.values()) if (c.buildSiteKey) siteCounts.set(c.buildSiteKey, (siteCounts.get(c.buildSiteKey) ?? 0) + 1);
  clanWork.clear();
}
// Distance in tiles (Chebyshev) to the nearest own construction site with room for another builder, or null.
function siteDistance(c: Colonist): number | null {
  freshCaches();
  const t = tileOfPixel(c.x, c.y);
  const clan = c.clan ?? 0;
  let best: number | null = null;
  for (const [key, site] of constructionSites) {
    if ((siteCounts.get(key) ?? 0) >= BUILDER_MAX_PER_SITE || clanIdAt(site.tx, site.ty) !== clan) continue;
    const d = Math.max(Math.abs(site.tx - t.x), Math.abs(site.ty - t.y));
    if (best === null || d < best) best = d;
  }
  return best;
}
function clanHasWork(clan: number, t: WorkType): boolean {
  freshCaches();
  let m = clanWork.get(clan);
  if (!m) clanWork.set(clan, (m = new Map()));
  let v = m.get(t);
  if (v !== undefined) return v;
  v = false;
  if (t === "building") {
    for (const [key, site] of constructionSites) if ((siteCounts.get(key) ?? 0) < BUILDER_MAX_PER_SITE && clanIdAt(site.tx, site.ty) === clan) (v = true);
  } else if (t === "hauling") v = clanHasZoneWork(clan, "haul");
  if (!v && t === "farming") v = clanHasZoneWork(clan, "farm");
  if (!v && t === "animals") v = clanHasAnimalWork(clan);
  if (!v && t !== "fighting") {
    for (const q of respawnQueue) {
      if (q.hero || (q.clan ?? clanIdAt(q.tx, q.ty)) !== clan) continue;
      if (workTypeOfPost(q.kind, q.tx, q.ty) === t) {
        v = true;
        break;
      }
    }
  }
  m.set(t, v);
  return v;
}

// ---- free villagers' jobs (runtime) ----
interface VillagerJob {
  type: WorkType;
}
const villagerJobs = new Map<string, VillagerJob>();
const decideWait = new Map<string, number>();
// Tick a byPriority worker took its post (runtime; after a load the shift counts from the first check).
const shiftStart = new Map<string, number>();

const BUILD_STATES = new Set(["carrying", "building", "toRepair", "repairing"]);

// The priority of the job c is busy with (a free villager's building / farming / hauling), or Infinity when idle.
function currentJobPriority(c: Colonist): number {
  const job = villagerJobs.get(c.id);
  return job ? workPriority(c, job.type) || Infinity : Infinity;
}

// Drop whatever free-villager job c has (taking a post, night, set off): carried goods are put down.
export function stopVillagerJob(c: Colonist) {
  villagerJobs.delete(c.id);
  if (hasZoneJob(c)) cancelZoneJob(c);
  if (hasAnimalJob(c)) cancelAnimalJob(c);
  if (c.kind === "villager" && (c.buildSiteKey || c.repairKey || BUILD_STATES.has(c.state))) {
    c.buildSiteKey = null;
    c.repairKey = null;
    c.path = [];
    c.state = "idle";
  }
}

function runJob(c: Colonist, job: VillagerJob, dt: number): boolean {
  if (job.type === "building") {
    updateBuilder(c, dt);
    return !!c.buildSiteKey || !!c.repairKey || BUILD_STATES.has(c.state);
  }
  // Stardew phase 5d: animal chores (feeders, troughs, collecting) at the clan's animal houses.
  if (job.type === "animals") return updateAnimalJob(c, dt, skillSpeed(c, "animals"));
  const farm = job.type === "farming";
  const rate = ZONE_PRIORITY_WORK_RATE * (farm ? skillSpeed(c, "farming") : 1);
  return updateZoneWorker(c, dt, rate, { farm, haul: !farm }) && hasZoneJob(c);
}

// The best-priority job on offer to c right now (ties: nearest), among the ones a free villager walks to.
function decideJob(c: Colonist): VillagerJob | null {
  for (let p = 1; p <= WORK_PRIORITY_MAX; p++) {
    let best: { type: WorkType; d: number } | null = null;
    for (const t of WORK_TYPES) {
      if (workPriority(c, t) !== p) continue;
      const d = t === "building" ? siteDistance(c) : t === "farming" ? zoneJobDistance(c, "farm") : t === "hauling" ? zoneJobDistance(c, "haul") : t === "animals" ? animalJobDistance(c) : null;
      if (d !== null && (!best || d < best.d)) best = { type: t, d };
    }
    if (best) return { type: best.type };
  }
  return null;
}

// A free adult villager's work step: true while it is busy (the caller skips its idle stroll).
export function updateVillagerWork(c: Colonist, dt: number): boolean {
  const job = villagerJobs.get(c.id);
  if (job) {
    if (workPriority(c, job.type) > 0 && runJob(c, job, dt)) return true;
    // Finished (or set off): look for the next job straight away.
    stopVillagerJob(c);
    decideWait.set(c.id, 0);
    return false;
  }
  // A builder's site carried over from a save (runtime jobs are not saved): carry on building.
  if (c.buildSiteKey && workPriority(c, "building") > 0) {
    villagerJobs.set(c.id, { type: "building" });
    return runJob(c, { type: "building" }, dt);
  }
  const wait = decideWait.get(c.id) ?? 0;
  if (wait > 0) {
    decideWait.set(c.id, wait - 1);
    return false;
  }
  decideWait.set(c.id, WORK_DECIDE_TICKS);
  const next = decideJob(c);
  if (!next) return false;
  villagerJobs.set(c.id, next);
  if (next.type === "building") c.idleCooldown = 0;
  if (runJob(c, next, dt)) return true;
  villagerJobs.delete(c.id);
  return false;
}

// The profession a free villager's job trains (zone farming trains the farmer skill), or undefined.
export function villagerJobProfession(c: Colonist): Profession | undefined {
  const t = villagerJobs.get(c.id)?.type;
  if (t === "animals" && hasAnimalJob(c)) return "herder";
  return t === "farming" && hasZoneJob(c) ? "farmer" : undefined;
}

// ---- posts: who fills a vacancy ----
// The free villager of the clan to put on a post of `kind` at (tx, ty): best priority for its work type, then best
// skill, then nearest; never one with that work off or busy with a strictly better-priority job. Posts with no work
// type (bishops, the ward priest) take the nearest free villager as before.
export function chooseWorkerFor(clanId: number, tx: number, ty: number, kind: ColonistKind): Colonist | undefined {
  const t = workTypeOfPost(kind, tx, ty);
  if (!t) return freeVillagerFor(clanId, tx, ty);
  let best: Colonist | undefined;
  let bestKey: [number, number, number] | null = null;
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clanId || !isFreeVillager(c) || heldOffPost(c.id, tx, ty)) continue;
    const p = workPriority(c, t);
    if (p === 0 || currentJobPriority(c) < p) continue;
    const key: [number, number, number] = [p, -typeXp(c.person!, t), (c.postX - tx) ** 2 + (c.postY - ty) ** 2];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

// Soldier training and the levy (never forced): the free villager with fighting on, best priority, then nearest.
export function freeFighterFor(clanId: number, tx: number, ty: number): Colonist | undefined {
  let best: Colonist | undefined;
  let bestKey: [number, number] | null = null;
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clanId || !isFreeVillager(c)) continue;
    const p = workPriority(c, "fighting");
    if (p === 0) continue;
    const key: [number, number] = [p, (c.postX - tx) ** 2 + (c.postY - ty) ** 2];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}
export function freeFighterCount(clanId: number): number {
  let n = 0;
  for (const c of colonists.values()) if ((c.clan ?? 0) === clanId && isFreeVillager(c) && workPriority(c, "fighting") > 0) n++;
  return n;
}

// The villager v becomes the post worker `unit` (called right after transplantPerson): its old job is dropped and the
// person is marked as placed by priorities.
export function startPriorityShift(v: Colonist, unit: Colonist) {
  villagerJobs.delete(v.id);
  decideWait.delete(v.id);
  if (!unit.person || workTypeOfPost(unit.kind, unit.postX, unit.postY) === undefined) return;
  unit.person.byPriority = true;
  delete unit.person.pinned;
  shiftStart.set(unit.id, state.cycleTick);
}
// Called before the villager is transplanted (its zone job / site must be released while it is still a villager).
export function releaseVillagerForPost(v: Colonist) {
  stopVillagerJob(v);
}

// A post worker goes back to the village and its post is open again.
function leavePost(c: Colonist, why: string) {
  const name = c.person?.name ?? "A worker";
  c.person!.byPriority = undefined;
  delete c.person!.pinned;
  shiftStart.delete(c.id);
  withClan(clanById(c.clan ?? 0), () => {
    queueRespawn(c);
    releaseToVillage(c);
  });
  if (why) workLog.push(`${name}: ${why}`);
}
// Test / debug trail of post changes (bounded).
const workLog: string[] = [];

// Once a second: post workers whose work type is off leave; priority-placed ones leave for a strictly better job
// waiting after their minimum shift (staggered: each worker every WORK_RECHECK_TICKS).
export function updateWorkAssignments() {
  if (workLog.length > 50) workLog.splice(0, workLog.length - 50);
  for (const c of Array.from(colonists.values())) {
    if (!c.person || c.person.child || c.creativeDummy || c.levyOf) continue;
    // A villager's job type set off mid-job is dropped in updateVillagerWork; forget stale runtime state.
    if (c.kind === "villager") continue;
    const t = assignedWorkType(c);
    if (!t) continue;
    const p = workPriority(c, t);
    if (p === 0) {
      leavePost(c, `${WORK_LABEL[t]} is off`);
      continue;
    }
    if (!c.person.byPriority || c.sheltering) continue;
    const since = shiftStart.get(c.id);
    if (since === undefined || since > state.cycleTick) {
      shiftStart.set(c.id, state.cycleTick);
      continue;
    }
    const held = state.cycleTick - since;
    if (held < WORK_MIN_SHIFT_TICKS || (held - WORK_MIN_SHIFT_TICKS) % WORK_RECHECK_TICKS >= 20) continue;
    for (const t2 of WORK_TYPES) {
      const p2 = workPriority(c, t2);
      if (p2 > 0 && p2 < p && t2 !== "fighting" && clanHasWork(c.clan ?? 0, t2)) {
        leavePost(c, `leaves ${WORK_LABEL[t]} for ${WORK_LABEL[t2]}`);
        break;
      }
    }
  }
  for (const id of villagerJobs.keys()) if (!colonists.has(id)) villagerJobs.delete(id);
  for (const id of decideWait.keys()) if (!colonists.has(id)) decideWait.delete(id);
  for (const id of shiftStart.keys()) if (!colonists.has(id)) shiftStart.delete(id);
  for (const [id, h] of heldOff) if (h.until <= state.cycleTick || !colonists.has(id)) heldOff.delete(id);
}

// ---- labels ----
function postLabel(c: { postX: number; postY: number }): string {
  if (!inBounds(c.postX, c.postY)) return "";
  const tile = state.tiles[tileIndex(c.postX, c.postY)] as TileType;
  if (tile === TileType.TownCenter) return "Town Center";
  if (tile === TileType.BuildersGuild) return "Builders' Guild";
  return PROGRESSION_BUILDING_LABEL[tile] ?? "its post";
}
export function workRoleLabel(c: Colonist): string {
  if (c.callUp) return "Levied (militia)";
  if (c.training) return "In training";
  if (c.kind === "villager") return "Free villager";
  const prof = PROGRESSION.stations[inBounds(c.postX, c.postY) ? (state.tiles[tileIndex(c.postX, c.postY)] as TileType) : TileType.Empty];
  const what = c.kind === "builder" ? "Builder" : prof ? PROFESSION_LABEL[prof] : c.kind;
  return `${what} at ${postLabel(c)}${c.person?.pinned ? " (assigned)" : ""}`;
}
const ZONE_JOB_LABEL: Record<string, string> = { till: "tilling", sow: "sowing", tend: "tending crops", harvest: "harvesting", haul: "hauling goods" };
export function workJobLabel(c: Colonist): string {
  if (c.sheltering) return "Sheltering for the night";
  if (c.callUp) return "Fighting (levy)";
  if (c.training) return "Training";
  if (c.kind !== "villager") {
    const t = assignedWorkType(c);
    const zone = zoneJobKind(c);
    if (zone) return `${t ? WORK_LABEL[t] : "Working"}: ${ZONE_JOB_LABEL[zone]}`;
    const verb = c.state === "idle" ? "waiting" : c.state === "returning" || c.state === "toPost" ? "walking" : "working";
    return `${t ? WORK_LABEL[t] : "Working"} at ${postLabel(c)}: ${verb}`;
  }
  const job = villagerJobs.get(c.id);
  if (!job) return "Idle";
  if (job.type === "animals") return `Animals: ${animalJobLabel(c) || "looking for chores"}`;
  if (job.type === "building") return c.state === "building" ? "Building" : c.state === "repairing" || c.state === "toRepair" ? "Repairing" : "Going to a building site";
  const zone = zoneJobKind(c);
  return `${WORK_LABEL[job.type]}${zone ? `: ${ZONE_JOB_LABEL[zone]}` : ""}`;
}

// ---- the work tab ----
// Rows: the clan's adult civilians (free villagers, workers, builders, trainees, levied villagers); children, soldiers,
// bishops, prisoners (not colonists) and creative dummies are left out.
function workRows(clan: number): Colonist[] {
  const out: Colonist[] = [];
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clan || !c.person || c.person.child || c.creativeDummy || c.levyOf) continue;
    if (!isCivilianKind(c.kind) && !c.callUp) continue;
    out.push(c);
  }
  return out.sort((a, b) => a.person!.name.localeCompare(b.person!.name) || (a.id < b.id ? -1 : 1));
}
export function workTabFor(clan: number): WorkTabSnapshot {
  const rows: WorkTabRow[] = workRows(clan).map((c) => {
    const p = c.person!;
    const assigned = assignedWorkType(c);
    return {
      id: c.id, name: p.name, role: workRoleLabel(c), job: workJobLabel(c),
      pri: WORK_TYPES.map((t) => workPriority(c, t)),
      skill: WORK_TYPES.map((t) => workSkill(p, t)),
      xp: WORK_TYPES.map((t) => typeXp(p, t)),
      ...(assigned ? { assigned } : {}),
      ...(assigned && p.pinned ? { pinned: true } : {}),
    };
  });
  return { manual: manualClans.has(clan), rows };
}

function send(player: Player, msg: unknown) {
  if (player.socket.readyState === player.socket.OPEN) player.socket.send(JSON.stringify(msg));
}
export function sendWorkTab(player: Player) {
  send(player, { type: "workTab", tab: workTabFor(player.clan ?? 0) });
}

// workSet {ids, work, priority}: set one work type for these people (a cell, or a column's "all"). Manual mode
// stores 0-4; default mode only on / off (priority 0 = off, anything else = back to the default).
export function handleWorkSet(player: Player, m: { ids?: unknown; work?: unknown; priority?: unknown }) {
  const clan = player.clan ?? 0;
  const t = m.work as WorkType;
  const pr = typeof m.priority === "number" && Number.isFinite(m.priority) ? Math.round(m.priority) : -1;
  if (!(WORK_TYPES as readonly string[]).includes(t) || pr < 0 || pr > WORK_PRIORITY_MAX || !Array.isArray(m.ids)) return;
  const manual = manualClans.has(clan);
  for (const id of m.ids.slice(0, 500)) {
    const c = typeof id === "string" ? colonists.get(id) : undefined;
    if (!c || (c.clan ?? 0) !== clan || !c.person || c.person.child) continue;
    const work = (c.person.work ??= {});
    if (manual || pr === 0) work[t] = pr;
    else delete work[t];
    if (Object.keys(work).length === 0) delete c.person.work;
    // Off now: a free villager drops that job at once (posts are left in updateWorkAssignments).
    if (pr === 0 && villagerJobs.get(c.id)?.type === t) stopVillagerJob(c);
  }
  updateWorkAssignments();
  sendWorkTab(player);
}

// workMode {manual}: switching to manual freezes everyone's current priorities as their numbers; back to default keeps
// only what is off.
export function handleWorkMode(player: Player, manual: unknown) {
  const clan = player.clan ?? 0;
  if (manual === true && !manualClans.has(clan)) {
    for (const c of workRows(clan)) {
      const work: Partial<Record<WorkType, number>> = {};
      for (const t of WORK_TYPES) work[t] = workPriority(c, t);
      c.person!.work = work;
    }
    manualClans.add(clan);
  } else if (manual === false && manualClans.has(clan)) {
    manualClans.delete(clan);
    for (const c of workRows(clan)) {
      const w = c.person!.work;
      if (!w) continue;
      for (const t of WORK_TYPES) if (w[t] !== 0) delete w[t];
      if (Object.keys(w).length === 0) delete c.person!.work;
    }
  }
  sendWorkTab(player);
}

// ---- gap closure G3: hand-assigned posts ----
// Runtime: people sent back with Unassign, kept off that post by the priorities until `until`.
const heldOff = new Map<string, { tx: number; ty: number; until: number }>();
function heldOffPost(id: string, tx: number, ty: number): boolean {
  const h = heldOff.get(id);
  return !!h && h.tx === tx && h.ty === ty && h.until > state.cycleTick;
}

interface PostSlots {
  tx: number;
  ty: number;
  kind: ColonistKind;
  work: WorkType;
  open: number;
  workers: Colonist[];
}
// A worker that holds a post slot (not levied, training or a creative dummy).
function isPostWorker(c: Colonist): boolean {
  return !!c.person && !c.person.child && c.kind !== "villager" && isCivilianKind(c.kind) && !c.callUp && !c.training && !c.levyOf && !c.creativeDummy;
}
// The clan's work posts by anchor tile: open slots (vacancies) and the workers on them. `only` limits it to one tile.
function clanPosts(clan: number, only?: { tx: number; ty: number }): Map<string, PostSlots> {
  const out = new Map<string, PostSlots>();
  const slot = (tx: number, ty: number, kind: ColonistKind): PostSlots | undefined => {
    if (only && (only.tx !== tx || only.ty !== ty)) return undefined;
    const work = workTypeOfPost(kind, tx, ty);
    if (!work) return undefined;
    const key = `${tx},${ty}`;
    let p = out.get(key);
    if (!p) out.set(key, (p = { tx, ty, kind, work, open: 0, workers: [] }));
    return p;
  };
  for (const q of respawnQueue) {
    if (q.hero || q.kind === "villager" || !isCivilianKind(q.kind) || (q.clan ?? clanIdAt(q.tx, q.ty)) !== clan) continue;
    const p = slot(q.tx, q.ty, q.kind);
    if (p) p.open++;
  }
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clan || !isPostWorker(c)) continue;
    slot(c.postX, c.postY, c.kind)?.workers.push(c);
  }
  return out;
}
function postRole(p: PostSlots): string {
  if (p.kind === "builder") return "Builder";
  const prof = PROGRESSION.stations[state.tiles[tileIndex(p.tx, p.ty)] as TileType];
  return prof ? PROFESSION_LABEL[prof] : p.kind;
}
function postName(p: PostSlots): string {
  return postLabel({ postX: p.tx, postY: p.ty });
}
const dist2 = (c: Colonist, tx: number, ty: number) => {
  const t = tileOfPixel(c.x, c.y);
  return (t.x - tx) ** 2 + (t.y - ty) ** 2;
};

// BuildingInfo.posts for the building at (tx, ty) (an anchor), or undefined when it has no work posts.
export function buildingPostsInfo(clan: number, tx: number, ty: number): BuildingPostsInfo | undefined {
  const p = clanPosts(clan, { tx, ty }).get(`${tx},${ty}`);
  if (!p) return undefined;
  const t = p.work;
  const candidates = Array.from(colonists.values())
    .filter((c) => (c.clan ?? 0) === clan && isFreeVillager(c) && !!c.person && workPriority(c, t) > 0)
    .map((c) => ({ c, skill: workSkill(c.person!, t), xp: typeXp(c.person!, t), d: dist2(c, tx, ty) }))
    .sort((a, b) => b.xp - a.xp || a.d - b.d)
    .slice(0, WORK_POST_CANDIDATES_MAX)
    .map(({ c, skill }) => ({ id: c.id, name: c.person!.name, skill, job: workJobLabel(c) }));
  return {
    work: t, role: postRole(p), open: p.open,
    workers: p.workers.map((w) => ({ id: w.id, name: w.person!.name, skill: workSkill(w.person!, t), pinned: !!w.person!.pinned })),
    candidates,
    canAssign: p.open > 0 || p.workers.some((w) => w.person!.byPriority && !w.person!.pinned),
  };
}

// Hand-assign the free villager `id` to the post at (tx, ty): "" when done, else why not.
export function assignWorkerTo(clan: number, id: string, tx: number, ty: number): string {
  if (!inBounds(tx, ty)) return "No building there";
  ({ x: tx, y: ty } = anchorOfTile(tx, ty));
  if (clanIdAt(tx, ty) !== clan) return "Not your building";
  const v = colonists.get(id);
  if (!v || (v.clan ?? 0) !== clan || !v.person) return "Not one of your people";
  const name = v.person.name;
  if (v.person.child) return `${name} is too young to work`;
  if (!isFreeVillager(v)) return `${name} is not a free villager (already working a post, training, levied or a soldier)`;
  const p = clanPosts(clan, { tx, ty }).get(`${tx},${ty}`);
  if (!p) return "This building has no work posts";
  if (workPriority(v, p.work) === 0) return `${WORK_LABEL[p.work]} is off for ${name}`;
  if (p.open === 0) {
    const bump = p.workers.find((w) => w.person!.byPriority && !w.person!.pinned);
    if (!bump) return `No free slot at ${postName(p)}: every worker there is assigned by hand`;
    leavePost(bump, `gives the post at ${postName(p)} to ${name}`);
  }
  const qi = respawnQueue.findIndex((q) => !q.hero && q.tx === tx && q.ty === ty && q.kind === p.kind);
  if (qi < 0) return `No free slot at ${postName(p)}`;
  respawnQueue.splice(qi, 1);
  stopVillagerJob(v);
  decideWait.delete(v.id);
  heldOff.delete(v.id);
  const unit = withClan(clanById(clan), () => spawnColonistForPost(tx, ty, p.kind));
  transplantPerson(v, unit);
  unit.person!.byPriority = undefined;
  unit.person!.pinned = true;
  shiftStart.delete(unit.id);
  workLog.push(`${name}: assigned to ${postName(p)} by hand`);
  return "";
}

// Send the post worker `id` back to the village (its post opens; priorities do not put it back there for a while).
export function unassignWorker(clan: number, id: string): string {
  const c = colonists.get(id);
  if (!c || (c.clan ?? 0) !== clan || !c.person) return "Not one of your people";
  if (!isPostWorker(c) || !assignedWorkType(c)) return `${c.person.name} has no post to leave`;
  heldOff.set(c.id, { tx: c.postX, ty: c.postY, until: state.cycleTick + WORK_UNASSIGN_HOLD_TICKS });
  leavePost(c, `unassigned from ${postLabel(c)}`);
  return "";
}

// The posts near person `id` it could be assigned to: an open slot or a priority-placed worker to replace.
export function workPostsFor(clan: number, id: string): WorkPostOption[] {
  const v = colonists.get(id);
  if (!v || (v.clan ?? 0) !== clan || !v.person || !isFreeVillager(v)) return [];
  const out: WorkPostOption[] = [];
  for (const p of clanPosts(clan).values()) {
    const bump = p.open === 0 && p.workers.some((w) => w.person!.byPriority && !w.person!.pinned);
    if ((p.open === 0 && !bump) || workPriority(v, p.work) === 0) continue;
    out.push({
      tx: p.tx, ty: p.ty, name: `${postRole(p)} at ${postName(p)}`, work: p.work, open: p.open, bump,
      dist: Math.round(Math.sqrt(dist2(v, p.tx, p.ty))), skill: workSkill(v.person, p.work),
    });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, WORK_POST_OPTIONS_MAX);
}

export function handleAssignWorker(player: Player, m: { id?: unknown; tileX?: unknown; tileY?: unknown }) {
  if (typeof m.id !== "string" || typeof m.tileX !== "number" || typeof m.tileY !== "number") return;
  const why = assignWorkerTo(player.clan ?? 0, m.id, Math.floor(m.tileX), Math.floor(m.tileY));
  if (why) send(player, { type: "event", category: "build", text: why });
  sendWorkTab(player);
}
export function handleUnassignWorker(player: Player, m: { id?: unknown }) {
  if (typeof m.id !== "string") return;
  const why = unassignWorker(player.clan ?? 0, m.id);
  if (why) send(player, { type: "event", category: "build", text: why });
  sendWorkTab(player);
}
export function handleWorkPosts(player: Player, m: { id?: unknown }) {
  if (typeof m.id !== "string") return;
  send(player, { type: "workPosts", id: m.id, posts: workPostsFor(player.clan ?? 0, m.id) });
}

// ---- saves ----
export function workForSave(): number[] | undefined {
  return manualClans.size ? Array.from(manualClans) : undefined;
}
export function restoreWork(manual: number[] | undefined) {
  manualClans.clear();
  for (const id of manual ?? []) if (typeof id === "number") manualClans.add(id);
  villagerJobs.clear();
  decideWait.clear();
  shiftStart.clear();
  heldOff.clear();
  workLog.length = 0;
}

// Test hooks: runtime state.
export function workDebug() {
  return {
    manual: Array.from(manualClans),
    jobs: Object.fromEntries(Array.from(villagerJobs, ([id, j]) => [id, j.type])),
    log: [...workLog],
  };
}
