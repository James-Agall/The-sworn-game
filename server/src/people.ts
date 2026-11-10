// people.ts: Village life (docs/colony2d/PLAN-village-life.md). Phase 2: homes, children, aging, immigrants and
// rescued prisoners; phase 3: training soldiers at unit buildings from a free villager + tier-matched gear.
// The person model itself (Colonist.person, free villagers, staffPost / vacancies) lives in colonists.ts.
import { TICK_RATE, TileType, type ColonistKind } from "@colony/shared/protocol";
import type { HeirCandidateSnapshot } from "@colony/shared/protocol";
import type { Colonist, HearthState, Player, TownCenter } from "./types.js";
import {
  BIRTH_CHANCE_PER_COUPLE, BIRTH_MIN_FOOD, BIRTH_MIN_FOOD_DAYS, FOOD_PER_COLONIST_PER_DAY, COUPLE_BIRTH_COOLDOWN_DAYS, HEIR_GOLD_SHARE, HEIR_SKILL_SHARE, CHILD_MATURE_DAYS, DAY_TICKS, GAME_DAY_TICKS,
  IMMIGRANTS_PER_WEEK, IMMIGRATION_MIN_HAPPINESS, KEEP_POPULATION_PER_LEVEL, PRISONERS_PER_CAMP,
  PRISONER_DISTANCE_MAX_BONUS, PRISONER_DISTANCE_STEP_TILES,
  TOWN_CENTER_BASE_POPULATION, TOWN_CENTER_LEVEL_POPULATION_BONUS, TRAIN_BATCH_MAX, TRAIN_DAYS_BY_LEVEL, TRAIN_SLOTS_PER_LEVEL, VILLAGE_LEVY_COOLDOWN_TICKS,
  VILLAGE_LEVY_TICKS,
} from "./constants.js";
import { chargeRuns, colonists, hearths, players, respawnQueue, sites, state } from "./state.js";
import { getBuildingLevel, inBounds, isNightNow, ownerAt, resourceKey, tileIndex, tileToPixelCenter } from "./tiles.js";
import { tileIndicesOfAny } from "./chunks.js";
import { chapelReviveMult, usableBedIndices } from "./structures.js";
import {
  findTownCenterAt, freeVillagerFor, houseCapacity, isCivilianKind, isHouseTile, isValidPostTile, nearestTownCenter,
  newPerson, personAgeDays, queueRespawn, releaseToVillage, settlementOf, settlementStats, spawnColonistForPost, spawnVillager,
  TOWN_CENTER_TILE, transplantPerson,
} from "./colonists.js";
import { leaveOrderGroup } from "./orders.js";
import { isSoldierKind, troopsAtPost, unitBuildingSlots } from "./units.js";
import { clanIdAt, clanTownCenters, forEachClan, inClan, townCentersOfClan, withClan, clanById } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { attackerClan } from "./sites.js";
import { sendEvent } from "./construction.js";
import { heroKey, heroProfileFor, heroProfileOf, playerMaxHp, recomputeHeroProfile } from "./heroes.js";
import { releaseResourceReservation } from "./economy.js";
import { isSummoned } from "./spells.js";
import { heroBirthsDawn, kinRelation, succeedFamily } from "./family.js";
import { freeFighterCount, freeFighterFor, releaseVillagerForPost, workPriority } from "./work.js";
import { FAMILY_HEIR_GOLD_SHARE, FAMILY_HEIR_SKILL_SHARE, KIN_LABEL, type HeroSkill, type KinRelation } from "@colony/shared/herolife";

const isAdult = (c: Colonist) => !!c.person && !c.person.child;

// ---- Homes ----
// Beds: a Town Center TOWN_CENTER_BASE_POPULATION (+ its level bonus), a house its capacity, a Keep
// KEEP_POPULATION_PER_LEVEL per level. Run at dawn: anyone whose home is gone or over-full moves to the nearest
// home with room (or none: -1).
export function assignHomes() {
  const beds = new Map<string, { x: number; y: number; free: number }>();
  for (const tc of clanTownCenters()) {
    beds.set(resourceKey(tc.x, tc.y), { x: tc.x, y: tc.y, free: TOWN_CENTER_BASE_POPULATION + TOWN_CENTER_LEVEL_POPULATION_BONUS * (tc.level - 1) });
  }
  for (const i of tileIndicesOfAny([TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.Keep])) {
    const x = i % state.WORLD_TILES_X;
    const y = Math.floor(i / state.WORLD_TILES_X);
    if (clanIdAt(x, y) !== state.clan.id) continue;
    const t = state.tiles[i] as TileType;
    beds.set(resourceKey(x, y), { x, y, free: isHouseTile(t) ? houseCapacity(t) : KEEP_POPULATION_PER_LEVEL * getBuildingLevel(x, y) });
  }
  // Modular building phase 1: each bed in a roofed room (a built bedroom) is one person's home.
  for (const i of usableBedIndices()) {
    const x = i % state.WORLD_TILES_X;
    const y = Math.floor(i / state.WORLD_TILES_X);
    if (clanIdAt(x, y) === state.clan.id) beds.set(resourceKey(x, y), { x, y, free: 1 });
  }
  // Phase 6: a Town Center is only a shelter: people sleeping there move into a free house / keep / bed once there
  // is one (homes used to be kept for good, so a new bedroom housed nobody of the starting ten).
  const tcKeys = new Set(clanTownCenters().map((tc) => resourceKey(tc.x, tc.y)));
  const homeless: Colonist[] = [];
  const atTc: Colonist[] = [];
  for (const c of colonists.values()) {
    if (!c.person || !inClan(c)) continue;
    const key = resourceKey(c.person.homeX, c.person.homeY);
    const b = beds.get(key);
    if (b && tcKeys.has(key)) atTc.push(c);
    else if (b && b.free > 0) b.free--;
    else homeless.push(c);
  }
  const open = Array.from(beds.values());
  let roomy = open.reduce((n, b) => n + (tcKeys.has(resourceKey(b.x, b.y)) ? 0 : Math.max(0, b.free)), 0) - homeless.length;
  for (const c of atTc) {
    const b = beds.get(resourceKey(c.person!.homeX, c.person!.homeY))!;
    if (roomy > 0 || b.free <= 0) {
      homeless.push(c);
      roomy--;
    } else b.free--;
  }
  for (const c of homeless) {
    let best: { x: number; y: number; free: number } | undefined;
    let bestD = Infinity;
    for (const b of open) {
      if (b.free <= 0) continue;
      // A real home (house, keep, bed) before a Town Center shelter.
      const d = (b.x - c.postX) ** 2 + (b.y - c.postY) ** 2 + (tcKeys.has(resourceKey(b.x, b.y)) ? 1e9 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    c.person!.homeX = best ? best.x : -1;
    c.person!.homeY = best ? best.y : -1;
    if (best) best.free--;
  }
}

// ---- Phase 2: growth ----
function settlementLabel(tc: TownCenter): string {
  return tc.name ?? "the village";
}

function bornChild(tc: TownCenter, parents: Colonist[]): Colonist {
  const p = newPerson("born", state.cycleTick);
  p.child = true;
  p.parents = parents.map((c) => c.id);
  return spawnVillager(tc, p);
}

// Couples (2026-11-06): a settlement's adults pair up and stay paired (Person.partner, the other's colonist id) while
// both live in the same settlement; the widowed, newcomers and the moved re-pair with another unpaired adult at
// dawn. The hero's family (a person with a hero spouse, family.ts) has its own birth rules and never pairs here.
function settlementCouples(adults: Colonist[]): [Colonist, Colonist][] {
  const here = new Set(adults.filter((c) => !c.person!.spouse && c.kind !== "hero"));
  const couples: [Colonist, Colonist][] = [];
  const single: Colonist[] = [];
  for (const c of [...here].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const pid = c.person!.partner;
    const mate = pid ? colonists.get(pid) : undefined;
    if (mate && here.has(mate) && mate.person!.partner === c.id) {
      if (c.id < mate.id) couples.push([c, mate]);
      continue;
    }
    c.person!.partner = undefined;
    single.push(c);
  }
  for (let i = 0; i + 1 < single.length; i += 2) {
    const [a, b] = [single[i], single[i + 1]];
    a.person!.partner = b.id;
    b.person!.partner = a.id;
    couples.push([a, b]);
  }
  return couples;
}

// Births and immigrants, once per dawn for the active clan. `force` (test hooks / creative) skips the dice.
export function peopleDawnForClan(force: { birth?: boolean; immigrant?: boolean; heroBirth?: boolean } = {}) {
  assignHomes();
  heroBirthsDawn(force.heroBirth === true);
  const food = state.stock.grain + state.stock.meat + state.stock.fruit;
  // Phase 6 balance: births wait for BIRTH_MIN_FOOD_DAYS of the clan's upkeep in stock.
  let eaters = 0;
  for (const c of colonists.values()) if (c.person && inClan(c)) eaters++;
  const birthFood = Math.max(BIRTH_MIN_FOOD, eaters * FOOD_PER_COLONIST_PER_DAY * BIRTH_MIN_FOOD_DAYS);
  const stats = settlementStats();
  for (const st of stats) {
    const tc = st.tc;
    const adults = Array.from(colonists.values()).filter((c) => isAdult(c) && inClan(c) && settlementOf(c) === tc);
    for (const [a, b] of settlementCouples(adults)) {
      if (st.used >= st.cap && !state.creative) break;
      const last = Math.max(a.person!.lastBirthTick ?? -Infinity, b.person!.lastBirthTick ?? -Infinity);
      if (!force.birth && state.cycleTick - last < COUPLE_BIRTH_COOLDOWN_DAYS * GAME_DAY_TICKS) continue;
      if (!force.birth && (food < birthFood || Math.random() >= BIRTH_CHANCE_PER_COUPLE)) continue;
      const child = bornChild(tc, [a, b]);
      a.person!.lastBirthTick = state.cycleTick;
      b.person!.lastBirthTick = state.cycleTick;
      tc.lastBirthTick = state.cycleTick;
      st.used++;
      broadcastEvent("build", `A child is born in ${settlementLabel(tc)}: ${child.person!.name}, to ${a.person!.name} and ${b.person!.name}`);
      // A forced birth (test hooks / creative) is one child per settlement, as before.
      if (force.birth) break;
    }
  }
  // Immigrants: ~IMMIGRANTS_PER_WEEK a week at happiness 100, none at or below IMMIGRATION_MIN_HAPPINESS.
  const happy = Math.max(0, (state.colonyHappiness - IMMIGRATION_MIN_HAPPINESS) / (100 - IMMIGRATION_MIN_HAPPINESS));
  if (force.immigrant || Math.random() < (IMMIGRANTS_PER_WEEK / 7) * happy) {
    const room = stats.filter((s) => s.used < s.cap).sort((x, y) => x.used / x.cap - y.used / y.cap)[0];
    if (room) {
      const v = spawnVillager(room.tc, newPerson("immigrant"));
      broadcastEvent("build", `${v.person!.name} arrives from afar and settles in ${settlementLabel(room.tc)}`);
    }
  }
  prisonersDawnForClan();
}

export function peopleDawn() {
  forEachClan(() => peopleDawnForClan());
}

// Children grow up after CHILD_MATURE_DAYS (checked once a second).
export function updateAging() {
  for (const c of colonists.values()) {
    if (!c.person?.child || personAgeDays(c.person) < CHILD_MATURE_DAYS) continue;
    c.person.child = false;
    withClan(clanById(c.clan ?? 0), () => broadcastEvent("build", `${c.person!.name} has grown up and is ready to work`));
  }
}

// Prisoners a camp hearth at `at` holds: PRISONERS_PER_CAMP, more the farther it is from the start.
export function rollPrisoners(at: { x: number; y: number }): number {
  const [lo, hi] = PRISONERS_PER_CAMP;
  const far = Math.hypot(at.x - TOWN_CENTER_TILE.x, at.y - TOWN_CENTER_TILE.y);
  return lo + Math.floor(Math.random() * (hi - lo + 1)) + Math.min(PRISONER_DISTANCE_MAX_BONUS, Math.floor(far / PRISONER_DISTANCE_STEP_TILES));
}

// Up to `n` freed prisoners join the active clan where there is room (houses + Town Centers + Keeps; creative
// ignores the cap), nearest to (px, py) first. Returns their names.
function admitPrisoners(n: number, px: number, py: number): { names: string[]; where: TownCenter | null } {
  const names: string[] = [];
  let where: TownCenter | null = null;
  const stats = settlementStats().map((st) => ({ tc: st.tc, room: state.creative ? n : Math.max(0, st.cap - st.used) }));
  stats.sort((a, b) => {
    const ca = tileToPixelCenter(a.tc);
    const cb = tileToPixelCenter(b.tc);
    return Math.hypot(ca.x - px, ca.y - py) - Math.hypot(cb.x - px, cb.y - py);
  });
  for (const st of stats) {
    while (names.length < n && st.room > 0) {
      names.push(spawnVillager(st.tc, newPerson("rescued")).person!.name);
      st.room--;
      where ??= st.tc;
    }
  }
  return { names, where };
}

// A bandit / monster camp, fort or lair falls: its prisoners (HearthState.prisoners) are freed and join the
// attacker's clan where it has beds; the rest wait at the fallen camp (prisonersWaiting) and come in at dawn
// (prisonersDawnForClan). Human settlements hold no prisoners.
export function rescuePrisoners(h: HearthState, attackerKey?: string) {
  if (h.siteKind === "fort" && sites.get(h.siteId)?.faction === "human") return;
  const clanId = attackerClan(attackerKey);
  if (townCentersOfClan(clanId).length === 0) return;
  const n = h.prisoners ?? rollPrisoners(h);
  if (n <= 0) return;
  h.prisoners = 0;
  const p = tileToPixelCenter(h);
  withClan(clanById(clanId), () => {
    const { names, where } = admitPrisoners(n, p.x, p.y);
    const left = n - names.length;
    if (names.length > 0) broadcastEvent("build", `Prisoners freed: ${names.join(", ")} join ${settlementLabel(where!)}`);
    if (left > 0) {
      h.prisonersWaiting = left;
      h.prisonersClan = clanId;
      broadcastEvent("build", `${left} freed prisoner${left > 1 ? "s wait" : " waits"} at the camp: build houses (or a Keep) and they will come at dawn`);
    }
  });
}

// Dawn, per clan: freed prisoners waiting at fallen camps come in while there is room.
export function prisonersDawnForClan() {
  for (const h of hearths.values()) {
    if (!h.prisonersWaiting || h.prisonersClan !== state.clan.id) continue;
    const p = tileToPixelCenter(h);
    const { names, where } = admitPrisoners(h.prisonersWaiting, p.x, p.y);
    if (names.length === 0) continue;
    h.prisonersWaiting -= names.length;
    if (h.prisonersWaiting <= 0) {
      h.prisonersWaiting = undefined;
      h.prisonersClan = undefined;
    }
    broadcastEvent("build", `Freed prisoners arrive: ${names.join(", ")} settle in ${settlementLabel(where!)}`);
  }
}

// ---- Phase 3: training ----
function traineesAt(tx: number, ty: number): number {
  let n = 0;
  for (const c of colonists.values()) if (c.training && c.training.tx === tx && c.training.ty === ty) n++;
  return n;
}

export interface TrainInfo {
  kind: ColonistKind;
  level: number;
  troops: number;
  training: number;
  cap: number;
  days: number;
  reason: string;
  // Basic militia (level 1): gear is optional; geared = a T1 weapon + armour are in stock and will be taken.
  gearOptional: boolean;
  geared: boolean;
  // Batch training: places training at once, trainees waiting for one, how many one "Max" click would queue, and
  // each trainee (progress 0-1, waiting).
  slots: number;
  waiting: number;
  max: number;
  queue: { name: string; progress: number; waiting: boolean }[];
}


function traineesListAt(tx: number, ty: number): Colonist[] {
  return Array.from(colonists.values()).filter((c) => c.training && c.training.tx === tx && c.training.ty === ty);
}

// What "Train unit" at the unit building (tx, ty) would do for the active clan, and why it can't ("" = it can).
export function trainInfo(tx: number, ty: number): TrainInfo | null {
  if (!inBounds(tx, ty)) return null;
  const slots = unitBuildingSlots(tx, ty);
  if (!slots) return null;
  const level = Math.min(Math.max(slots.level, 1), 3);
  const troops = troopsAtPost(tx, ty, slots.kind);
  const training = traineesAt(tx, ty);
  const hasGear = state.equipment.weapon[level - 1] >= 1 && state.equipment.armour[level - 1] >= 1;
  const gearOptional = slots.kind === "militia";
  const list = traineesListAt(tx, ty);
  const gearSets = Math.min(state.equipment.weapon[level - 1], state.equipment.armour[level - 1]);
  const room = Math.max(0, slots.cap - troops - training);
  const info: TrainInfo = {
    kind: slots.kind, level, troops, training, cap: slots.cap, days: TRAIN_DAYS_BY_LEVEL[level - 1], reason: "", gearOptional, geared: hasGear,
    slots: TRAIN_SLOTS_PER_LEVEL * level,
    waiting: list.filter((c) => c.training!.waiting).length,
    max: state.creative ? Math.min(room, TRAIN_BATCH_MAX) : Math.min(room, freeFighterCount(state.clan.id), gearOptional ? TRAIN_BATCH_MAX : gearSets, TRAIN_BATCH_MAX),
    queue: list.map((c) => ({ name: c.person?.name ?? "Recruit", progress: 1 - c.training!.ticksLeft / Math.max(1, c.training!.ticksTotal), waiting: !!c.training!.waiting })),
  };
  if (clanIdAt(tx, ty) !== state.clan.id) info.max = 0;
  if (clanIdAt(tx, ty) !== state.clan.id) info.reason = "Not your building";
  else if (troops + training >= slots.cap) info.reason = `Barracks full (${troops + training}/${slots.cap})`;
  else if (state.creative) info.reason = "";
  // Modular building phase 4: only villagers with fighting on (Work tab) train.
  else if (!freeFighterFor(state.clan.id, tx, ty)) info.reason = freeVillagerFor(state.clan.id, tx, ty) ? "No free villager with Fighting on (Work tab)" : "No free villager";
  else if (!gearOptional && !hasGear) info.reason = `Needs a T${level} weapon and T${level} armour (forge them at a Blacksmith)`;
  return info;
}

function finishTraining(c: Colonist | null, tx: number, ty: number, kind: ColonistKind, level: number, unarmed = false) {
  const unit = spawnColonistForPost(tx, ty, kind, level, true);
  if (unarmed) unit.unarmed = true;
  else if (EQUIPPED.has(kind) || kind === "militia") {
    unit.armourTier = level;
    unit.weaponTier = level;
  }
  if (c) {
    transplantPerson(c, unit);
    unit.training = undefined;
  } else unit.person = newPerson("immigrant");
  // One open soldier post at this building is now filled.
  const i = respawnQueue.findIndex((q) => q.tx === tx && q.ty === ty && !q.hero && isSoldierKind(q.kind));
  if (i >= 0) respawnQueue.splice(i, 1);
  return unit;
}
const EQUIPPED = new Set<ColonistKind>(["knight", "spearman", "pikeman", "cavalry"]);

// `trainUnit` {count?: number | "max", cancel?: true}: queue `count` trainees (default 1) at once, each taking a free
// adult and (but basic militia) a tier weapon + armour up front, or refuse naming what's short; "max" queues as many
// as can be paid. `cancel` sends the last-queued trainee (waiting ones first) home with a refund.
export function handleTrainUnit(player: Player, tx: unknown, ty: unknown, count?: unknown, cancel?: unknown) {
  if (typeof tx !== "number" || typeof ty !== "number" || !Number.isInteger(tx) || !Number.isInteger(ty)) return;
  withClan(clanById(player.clan ?? 0), () => {
    if (cancel === true) {
      if (clanIdAt(tx, ty) !== state.clan.id) return;
      const list = traineesListAt(tx, ty);
      const c = [...list].reverse().find((x) => x.training!.waiting) ?? list[list.length - 1];
      if (!c) return;
      cancelTraining(c);
      sendEvent(player, "build", `${c.person?.name ?? "A recruit"} leaves training (gear back in the armoury)`);
      return;
    }
    const info = trainInfo(tx, ty);
    if (!info) return;
    const want = count === "max" ? info.max : typeof count === "number" && Number.isInteger(count) ? Math.min(Math.max(count, 1), TRAIN_BATCH_MAX) : 1;
    if (info.reason || want <= 0) {
      sendEvent(player, "build", `Cannot train: ${info.reason || "nobody can be trained now"}`);
      return;
    }
    if (want > info.max) {
      const free = freeFighterCount(state.clan.id);
      const gear = Math.min(state.equipment.weapon[info.level - 1], state.equipment.armour[info.level - 1]);
      const room = info.cap - info.troops - info.training;
      sendEvent(player, "build", `Cannot train ${want}: room for ${room}, ${free} free adult${free === 1 ? "" : "s"}${info.gearOptional ? "" : `, ${gear} T${info.level} gear set${gear === 1 ? "" : "s"}`} (Max trains ${info.max})`);
      return;
    }
    // Creative mode: instant, free, no villager needed.
    if (state.creative) {
      for (let i = 0; i < want; i++) finishTraining(null, tx, ty, info.kind, info.level);
      return;
    }
    const ticks = Math.round(info.days * DAY_TICKS * (state.instantBuild ? 0 : 1)) || 1;
    let active = traineesListAt(tx, ty).filter((c) => !c.training!.waiting).length;
    let unarmedN = 0;
    const names: string[] = [];
    for (let i = 0; i < want; i++) {
      const v = freeFighterFor(state.clan.id, tx, ty);
      if (!v) break;
      releaseVillagerForPost(v);
      // Basic militia take a T1 weapon + armour while the stock has them, else they train unarmed.
      const unarmed = !(state.equipment.weapon[info.level - 1] >= 1 && state.equipment.armour[info.level - 1] >= 1);
      if (!unarmed) {
        state.equipment.weapon[info.level - 1]--;
        state.equipment.armour[info.level - 1]--;
      } else unarmedN++;
      const waiting = active >= info.slots;
      if (!waiting) active++;
      v.training = { tx, ty, kind: info.kind, level: info.level, ticksLeft: ticks, ticksTotal: ticks, ...(unarmed ? { unarmed } : {}), ...(waiting ? { waiting } : {}) };
      v.postX = tx;
      v.postY = ty;
      v.path = [];
      names.push(v.person?.name ?? "A villager");
    }
    const who = names.length === 1 ? names[0] : `${names.length} recruits`;
    const waitN = traineesListAt(tx, ty).filter((c) => c.training!.waiting).length;
    sendEvent(player, "build", `${who} begin${names.length === 1 ? "s" : ""} training${unarmedN > 0 ? ` (${unarmedN} unarmed: no weapon or armour in stock)` : ""} (${info.days} day${info.days === 1 ? "" : "s"} each${waitN > 0 ? `, ${waitN} waiting for a place` : ""})`);
  });
}

// Every tick: trainees count down by day; a finished one becomes the soldier. A trainee whose building is gone (or
// changed line) goes back to the village and the gear returns to the stock.
export function updateTraining() {
  const night = isNightNow();
  // Batch training: trainees in training per building (waiting ones step up, in queue order, as places open).
  const active = new Map<number, number>();
  for (const c of colonists.values()) if (c.training && !c.training.waiting) active.set(tileIndex(c.training.tx, c.training.ty), (active.get(tileIndex(c.training.tx, c.training.ty)) ?? 0) + 1);
  for (const c of Array.from(colonists.values())) {
    const t = c.training;
    if (!t) continue;
    const slots = unitBuildingSlots(t.tx, t.ty);
    if (!slots || !sameLine(slots.kind, t.kind)) {
      cancelTraining(c);
      continue;
    }
    if (t.waiting) {
      const key = tileIndex(t.tx, t.ty);
      const n = active.get(key) ?? 0;
      if (n >= TRAIN_SLOTS_PER_LEVEL * Math.min(Math.max(slots.level, 1), 3)) continue;
      t.waiting = undefined;
      active.set(key, n + 1);
    }
    if (!night) t.ticksLeft--;
    if (t.ticksLeft > 0) continue;
    withClan(clanById(c.clan ?? 0), () => {
      const name = c.person?.name ?? "A recruit";
      const kind = slots!.kind;
      finishTraining(c, t.tx, t.ty, kind, t.level, t.unarmed === true && kind === "militia");
      broadcastEvent("build", `${name} finished training: a new ${kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase())}`);
    });
  }
}

const MILITIA_LINE = new Set<ColonistKind>(["militia", "spearman", "pikeman"]);
function sameLine(a: ColonistKind, b: ColonistKind): boolean {
  return a === b || (MILITIA_LINE.has(a) && MILITIA_LINE.has(b));
}

function cancelTraining(c: Colonist) {
  const t = c.training!;
  if (!t.unarmed) {
    withClan(clanById(c.clan ?? 0), () => {
      state.equipment.weapon[t.level - 1]++;
      state.equipment.armour[t.level - 1]++;
    });
  }
  c.training = undefined;
  const tc = nearestTownCenter(c.x, c.y, townCentersOfClan(c.clan ?? 0));
  if (tc) {
    c.postX = tc.x;
    c.postY = tc.y;
  }
}

// ---- Phase 4: the levy ----
// A Town Center's "Call to arms": every adult civilian of that settlement (free villagers and workers, not children,
// trainees or bishops) becomes a militiaman posted at the Town Center for VILLAGE_LEVY_TICKS; survivors then go back
// to their old job (Colonist.callUp: kind + post), or to the village if that post is gone. The dead stay dead.
// Modular building phase 4: never forced: only people with fighting on (Work tab) answer.
const levyCandidate = (c: Colonist, tc: TownCenter) =>
  isAdult(c) && isCivilianKind(c.kind) && !c.training && !c.callUp && !c.creativeDummy && !c.levyOf && inClan(c) && settlementOf(c) === tc &&
  workPriority(c, "fighting") > 0;

export interface VillageLevyInfo {
  ready: number;
  onField: number;
  ticksLeft: number;
  reason: string;
}

// The levy row of the active clan's Town Center at (tx, ty) ("" reason = can call now).
export function villageLevyInfo(tx: number, ty: number): VillageLevyInfo | null {
  const tc = findTownCenterAt(tx, ty);
  if (!tc || (tc.clan ?? 0) !== state.clan.id) return null;
  let ready = 0;
  let onField = 0;
  let until = 0;
  for (const c of colonists.values()) {
    if (c.callUp && inClan(c) && settlementOf(c) === tc) {
      onField++;
      until = Math.max(until, c.callUp.untilTick);
    } else if (levyCandidate(c, tc)) ready++;
  }
  const info = { ready, onField, ticksLeft: Math.max(0, until - state.cycleTick), reason: "" };
  if (onField > 0) info.reason = "The levy is on the field";
  else if (ready === 0) info.reason = "No villagers to call";
  else if (state.cycleTick < (tc.levyReadyTick ?? 0)) info.reason = `Called too recently: ready in ${Math.ceil(((tc.levyReadyTick ?? 0) - state.cycleTick) / TICK_RATE)} s`;
  return info;
}

export function handleCallVillagers(player: Player, tx: unknown, ty: unknown, dismiss: unknown) {
  if (typeof tx !== "number" || typeof ty !== "number" || !Number.isInteger(tx) || !Number.isInteger(ty)) return;
  withClan(clanById(player.clan ?? 0), () => {
    const tc = findTownCenterAt(tx, ty);
    const info = villageLevyInfo(tx, ty);
    if (!tc || !info) return;
    if (dismiss === true) {
      let n = 0;
      for (const c of Array.from(colonists.values())) if (c.callUp && inClan(c) && settlementOf(c) === tc) (standDown(c), n++);
      sendEvent(player, "build", n ? `The levy stands down: ${n} go back to work` : "No levy on the field");
      return;
    }
    if (info.reason) {
      sendEvent(player, "build", `Cannot call to arms: ${info.reason}`);
      return;
    }
    const until = state.cycleTick + VILLAGE_LEVY_TICKS;
    let n = 0;
    for (const c of Array.from(colonists.values())) {
      if (!levyCandidate(c, tc)) continue;
      const prev = { kind: c.kind, postX: c.postX, postY: c.postY };
      const u = spawnColonistForPost(tc.x, tc.y, "militia", 1, true);
      transplantPerson(c, u);
      u.callUp = { ...prev, untilTick: until };
      u.settlementId = resourceKey(tc.x, tc.y);
      if (c.clan) u.clan = c.clan;
      n++;
    }
    tc.levyReadyTick = state.cycleTick + VILLAGE_LEVY_COOLDOWN_TICKS;
    broadcastEvent("milestone", `${settlementLabel(tc)} answers the call to arms: ${n} villagers take up spears`);
  });
}

// The levy is over for c: back to its old job (same person and id), or a free villager if the post is gone.
function standDown(c: Colonist) {
  const cu = c.callUp!;
  leaveOrderGroup(c.id);
  withClan(clanById(c.clan ?? 0), () => {
    const t = state.tiles[tileIndex(cu.postX, cu.postY)] as TileType;
    if (cu.kind !== "villager" && inBounds(cu.postX, cu.postY) && isValidPostTile(cu.kind, t) && clanIdAt(cu.postX, cu.postY) === (c.clan ?? 0)) {
      const w = spawnColonistForPost(cu.postX, cu.postY, cu.kind);
      transplantPerson(c, w);
      if (c.clan) w.clan = c.clan;
    } else releaseToVillage(c);
  });
}

// Once a second: levies whose time is up stand down.
export function updateVillageLevy() {
  for (const c of Array.from(colonists.values())) if (c.callUp && state.cycleTick >= c.callUp.untilTick) standDown(c);
}

// ---- Phase 5: hero death and heirs (PLAN-village-life.md rule 6, PLAN-solo-hero.md "Death, resurrection and heirs") ----
// Who can take over as the hero: a living adult of the player's clan (villager, worker or soldier with a person
// record; not a trainee) or a companion hero. Wagons, summons and vassal levies never.
export function heirCandidates(clan: number): Colonist[] {
  const out: Colonist[] = [];
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clan || c.hp <= 0 || c.training || c.levyOf || c.kind === "wagon" || isSummoned(c)) continue;
    if (c.kind === "hero" || isAdult(c)) out.push(c);
  }
  return out;
}

// Family (PLAN-family-and-succession.md): eldest adult child, spouse, sibling (eldest first), parent, then everyone
// else in the old order.
const KIN_RANK: Record<KinRelation, number> = { child: 0, spouse: 1, sibling: 2, parent: 3 };
export function rankedHeirs(player: Player): { c: Colonist; rel: KinRelation | null }[] {
  return heirCandidates(player.clan ?? 0)
    .map((c, i) => ({ c, rel: kinRelation(player, c), i }))
    .sort((a, b) => {
      const ra = a.rel ? KIN_RANK[a.rel] : 9;
      const rb = b.rel ? KIN_RANK[b.rel] : 9;
      if (ra !== rb) return ra - rb;
      return ra < 9 ? (a.c.person?.born ?? 0) - (b.c.person?.born ?? 0) : a.i - b.i;
    });
}
export function heirOrderNames(p: Player): { name: string; rel: KinRelation | null }[] {
  return rankedHeirs(p).map((h) => ({ name: h.c.person?.name ?? h.c.heroName ?? h.c.kind, rel: h.rel }));
}

export function heirSnapshot(clan: number): HeirCandidateSnapshot[] {
  return heirCandidates(clan).map((c) => ({
    id: c.id,
    name: c.person?.name ?? c.heroName ?? c.kind,
    kind: c.kind,
    ...(c.person ? { ageDays: Math.floor(personAgeDays(c.person)) } : {}),
    ...(c.kind === "hero" ? { heroLevel: heroProfileFor(heroKey(c.id)).level } : {}),
  }));
}

// Solo hero: resurrection at the clan's Church (PLAN-solo-hero.md "Death, resurrection and heirs"). The best-tier own
// Church; gold = (REVIVE_GOLD_BASE + REVIVE_GOLD_PER_LEVEL x hero level) x the tier's price factor; the hero's XP and
// each hero skill lose the tier's share. Null: no Church of the clan stands.
const REVIVE_GOLD_BASE = 40;
const REVIVE_GOLD_PER_LEVEL = 20;
const REVIVE_PRICE = [1, 0.85, 0.7];
const REVIVE_LOSS = [0.3, 0.2, 0.1];
export function reviveOption(player: Player): { x: number; y: number; cost: number; loss: number } | null {
  const clan = player.clan ?? 0;
  let best: { x: number; y: number; lvl: number } | null = null;
  const W = state.WORLD_TILES_X;
  for (const i of tileIndicesOfAny([TileType.ChurchPost])) {
    const x = i % W;
    const y = Math.floor(i / W);
    // A settlement's own Church (site-owned tile) is not the clan's.
    if (clanIdAt(x, y) !== clan || ownerAt(i) !== 0) continue;
    const lvl = Math.max(1, Math.min(3, getBuildingLevel(x, y)));
    if (!best || lvl > best.lvl) best = { x, y, lvl };
  }
  if (!best) return null;
  const level = heroProfileOf(player).level;
  // Gap closure G1: the clan's best chapel (devotions) discounts it.
  const price = (REVIVE_GOLD_BASE + REVIVE_GOLD_PER_LEVEL * level) * REVIVE_PRICE[best.lvl - 1] * chapelReviveMult(clan);
  return { x: best.x, y: best.y, cost: Math.round(price), loss: REVIVE_LOSS[best.lvl - 1] };
}
function canRevive(player: Player): boolean {
  const r = reviveOption(player);
  return !!r && (clanById(player.clan ?? 0).stock.gold ?? 0) >= r.cost;
}
// The heir picker's rows: "Resurrect at the Church" first when it can be paid, then the heirs.
export function heirChoicesFor(player: Player): HeirCandidateSnapshot[] {
  const r = reviveOption(player);
  const all = heirSnapshot(player.clan ?? 0);
  const out: HeirCandidateSnapshot[] = rankedHeirs(player).map((h, i) => {
    const base = all.find((x) => x.id === h.c.id)!;
    const tags = [...(h.rel ? [`your ${KIN_LABEL[h.rel].toLowerCase()}`] : []), ...(i === 0 ? ["the heir"] : [])];
    return tags.length ? { ...base, name: `${base.name} (${tags.join(", ")})` } : base;
  });
  if (r && canRevive(player)) out.unshift({ id: "church", name: `Resurrect at the Church (${r.cost} gold, skills -${Math.round(r.loss * 100)}%)`, kind: "church" });
  return out;
}

// The player's hero fell (combat.ts damagePlayer): dead, then a Church resurrection or an heir choice, or game over
// with no Church / gold and nobody to take over.
export function onHeroDeath(player: Player) {
  player.hp = 0;
  player.dead = true;
  player.input = { dx: 0, dy: 0 };
  if (canRevive(player) || heirCandidates(player.clan ?? 0).length > 0) {
    player.heirPending = true;
    sendEvent(player, "death", "You have fallen. Choose an heir to carry on");
  } else {
    player.heirPending = false;
    broadcastEvent("death", "The hero has fallen and nobody is left to carry on: game over");
  }
}

// Every tick: a player choosing an heir whose last candidate died meanwhile is game over.
export function updateHeirChoices() {
  for (const p of players.values()) {
    if (!p.dead || !p.heirPending || heirCandidates(p.clan ?? 0).length > 0 || canRevive(p)) continue;
    p.heirPending = false;
    broadcastEvent("death", "No heir is left to carry on: game over");
  }
}

// `chooseHeir`: the colonist leaves its post (a worker / soldier leaves a vacancy) and the player rises in its place
// with HEIR_SKILL_SHARE of the hero's XP and HEIR_GOLD_SHARE of the clan's gold. Gear on the hero profile stays.
export function handleChooseHeir(player: Player, id: unknown) {
  if (!player.dead || !player.heirPending || typeof id !== "string") return;
  if (id === "church") return reviveAtChurch(player);
  const c = colonists.get(id);
  if (!c || !heirCandidates(player.clan ?? 0).includes(c)) {
    sendEvent(player, "build", "That heir can no longer take over");
    return;
  }
  withClan(clanById(player.clan ?? 0), () => {
    const name = c.person?.name ?? c.heroName ?? "An heir";
    // Family heirs (child / spouse / sibling / parent) inherit more; skills share too, the heir's talent if higher.
    const kin = kinRelation(player, c) !== null;
    const skillShare = kin ? FAMILY_HEIR_SKILL_SHARE : HEIR_SKILL_SHARE;
    const prof = heroProfileOf(player);
    prof.xp = Math.floor(prof.xp * skillShare);
    if (prof.life) {
      const sk = prof.life.skills;
      for (const k of new Set([...Object.keys(sk), ...Object.keys(c.person?.talent ?? {})]) as Set<HeroSkill>) {
        sk[k] = Math.max(Math.floor((sk[k] ?? 0) * skillShare), c.person?.talent?.[k] ?? 0);
      }
    }
    recomputeHeroProfile(prof);
    state.stock.gold = Math.floor((state.stock.gold ?? 0) * (kin ? FAMILY_HEIR_GOLD_SHARE : HEIR_GOLD_SHARE));
    succeedFamily(player, c);
    releaseResourceReservation(c);
    leaveOrderGroup(c.id);
    if (c.kind !== "hero" && c.kind !== "villager") queueRespawn(c);
    colonists.delete(c.id);
    chargeRuns.delete(c.id);
    if (c.kind === "hero") state.heroRosterVersion++;
    player.x = c.x;
    player.y = c.y;
    player.dead = false;
    player.heirPending = false;
    player.hp = playerMaxHp(player);
    player.attackCooldownTicks = 0;
    player.poisonTicksRemaining = 0;
    broadcastEvent("milestone", `${name} takes up the hero's mantle`);
  });
}

// `chooseHeir {id: "church"}`: pay the Church, lose the tier's share of XP and of every hero skill, rise next to it.
function reviveAtChurch(player: Player) {
  const r = reviveOption(player);
  withClan(clanById(player.clan ?? 0), () => {
    if (!r || (state.stock.gold ?? 0) < r.cost) {
      sendEvent(player, "build", "The Church cannot raise you (no Church or not enough gold)");
      return;
    }
    state.stock.gold -= r.cost;
    const prof = heroProfileOf(player);
    prof.xp = Math.floor(prof.xp * (1 - r.loss));
    for (const k of Object.keys(prof.life?.skills ?? {}) as (keyof NonNullable<typeof prof.life>["skills"])[]) prof.life!.skills[k] = Math.floor(prof.life!.skills[k]! * (1 - r.loss));
    recomputeHeroProfile(prof);
    const at = tileToPixelCenter({ x: r.x, y: r.y + 1 });
    player.x = at.x;
    player.y = at.y;
    player.dead = false;
    player.heirPending = false;
    player.hp = playerMaxHp(player);
    player.attackCooldownTicks = 0;
    player.poisonTicksRemaining = 0;
    broadcastEvent("milestone", `The hero is raised at the Church (${r.cost} gold; skills -${Math.round(r.loss * 100)}%)`);
  });
}
