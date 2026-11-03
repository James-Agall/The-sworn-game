// people.ts: Village life (docs/colony2d/PLAN-village-life.md). Phase 2: homes, children, aging, immigrants and
// rescued prisoners; phase 3: training soldiers at unit buildings from a free villager + tier-matched gear.
// The person model itself (Colonist.person, free villagers, staffPost / vacancies) lives in colonists.ts.
import { TileType, type ColonistKind } from "@colony/shared/protocol";
import type { Colonist, HearthState, Player, TownCenter } from "./types.js";
import {
  BIRTH_CHANCE_PER_DAWN, BIRTH_COOLDOWN_DAYS, BIRTH_MIN_FOOD, CHILD_MATURE_DAYS, DAY_TICKS, GAME_DAY_TICKS,
  IMMIGRANTS_PER_WEEK, IMMIGRATION_MIN_HAPPINESS, KEEP_POPULATION_PER_LEVEL, PRISONERS_PER_CAMP,
  TOWN_CENTER_BASE_POPULATION, TOWN_CENTER_LEVEL_POPULATION_BONUS, TRAIN_DAYS_BY_LEVEL,
} from "./constants.js";
import { colonists, respawnQueue, sites, state } from "./state.js";
import { getBuildingLevel, inBounds, isNightNow, resourceKey, tileToPixelCenter } from "./tiles.js";
import { tileIndicesOfAny } from "./chunks.js";
import {
  freeVillagerFor, houseCapacity, isHouseTile, nearestTownCenter, newPerson, personAgeDays, settlementOf,
  settlementStats, spawnColonistForPost, spawnVillager, transplantPerson,
} from "./colonists.js";
import { isSoldierKind, troopsAtPost, unitBuildingSlots } from "./units.js";
import { clanIdAt, clanTownCenters, forEachClan, inClan, townCentersOfClan, withClan, clanById } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { attackerClan } from "./sites.js";
import { sendEvent } from "./construction.js";

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
  const homeless: Colonist[] = [];
  for (const c of colonists.values()) {
    if (!c.person || !inClan(c)) continue;
    const b = beds.get(resourceKey(c.person.homeX, c.person.homeY));
    if (b && b.free > 0) b.free--;
    else homeless.push(c);
  }
  const open = Array.from(beds.values());
  for (const c of homeless) {
    let best: { x: number; y: number; free: number } | undefined;
    let bestD = Infinity;
    for (const b of open) {
      if (b.free <= 0) continue;
      const d = (b.x - c.postX) ** 2 + (b.y - c.postY) ** 2;
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

// Births and immigrants, once per dawn for the active clan. `force` (test hooks / creative) skips the dice.
export function peopleDawnForClan(force: { birth?: boolean; immigrant?: boolean } = {}) {
  assignHomes();
  const food = state.stock.grain + state.stock.meat + state.stock.fruit;
  const stats = settlementStats();
  for (const st of stats) {
    if (st.used >= st.cap && !state.creative) continue;
    const tc = st.tc;
    if (!force.birth && (tc.lastBirthTick !== undefined && state.cycleTick - tc.lastBirthTick < BIRTH_COOLDOWN_DAYS * GAME_DAY_TICKS)) continue;
    if (!force.birth && (food < BIRTH_MIN_FOOD || Math.random() >= BIRTH_CHANCE_PER_DAWN)) continue;
    const adults = Array.from(colonists.values()).filter((c) => isAdult(c) && inClan(c) && settlementOf(c) === tc);
    if (adults.length < 2) continue;
    const a = adults[Math.floor(Math.random() * adults.length)];
    const others = adults.filter((c) => c !== a);
    const b = others[Math.floor(Math.random() * others.length)];
    const child = bornChild(tc, [a, b]);
    tc.lastBirthTick = state.cycleTick;
    st.used++;
    broadcastEvent("build", `A child is born in ${settlementLabel(tc)}: ${child.person!.name}, to ${a.person!.name} and ${b.person!.name}`);
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

// A bandit / monster camp, fort or lair falls: its prisoners (PRISONERS_PER_CAMP) are freed and join the attacker's
// clan at its nearest Town Center (even past the housing cap). Human settlements hold no prisoners.
export function rescuePrisoners(h: HearthState, attackerKey?: string) {
  if (h.siteKind === "fort" && sites.get(h.siteId)?.faction === "human") return;
  const clanId = attackerClan(attackerKey);
  const p = tileToPixelCenter(h);
  const tc = nearestTownCenter(p.x, p.y, townCentersOfClan(clanId));
  if (!tc) return;
  const [lo, hi] = PRISONERS_PER_CAMP;
  const n = lo + Math.floor(Math.random() * (hi - lo + 1));
  withClan(clanById(clanId), () => {
    const names: string[] = [];
    for (let i = 0; i < n; i++) names.push(spawnVillager(tc, newPerson("rescued")).person!.name);
    broadcastEvent("build", `Prisoners freed: ${names.join(", ")} join ${settlementLabel(tc)}`);
  });
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
}

// What "Train unit" at the unit building (tx, ty) would do for the active clan, and why it can't ("" = it can).
export function trainInfo(tx: number, ty: number): TrainInfo | null {
  if (!inBounds(tx, ty)) return null;
  const slots = unitBuildingSlots(tx, ty);
  if (!slots) return null;
  const level = Math.min(Math.max(slots.level, 1), 3);
  const troops = troopsAtPost(tx, ty, slots.kind);
  const training = traineesAt(tx, ty);
  const info = { kind: slots.kind, level, troops, training, cap: slots.cap, days: TRAIN_DAYS_BY_LEVEL[level - 1], reason: "" };
  if (clanIdAt(tx, ty) !== state.clan.id) info.reason = "Not your building";
  else if (troops + training >= slots.cap) info.reason = `Barracks full (${troops + training}/${slots.cap})`;
  else if (state.creative) info.reason = "";
  else if (!freeVillagerFor(state.clan.id, tx, ty)) info.reason = "No free villager";
  else if (state.equipment.weapon[level - 1] < 1 || state.equipment.armour[level - 1] < 1) info.reason = `Needs a T${level} weapon and T${level} armour (forge them at a Blacksmith)`;
  return info;
}

function finishTraining(c: Colonist | null, tx: number, ty: number, kind: ColonistKind, level: number) {
  const unit = spawnColonistForPost(tx, ty, kind, level, true);
  if (EQUIPPED.has(kind)) {
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

export function handleTrainUnit(player: Player, tx: unknown, ty: unknown) {
  if (typeof tx !== "number" || typeof ty !== "number" || !Number.isInteger(tx) || !Number.isInteger(ty)) return;
  withClan(clanById(player.clan ?? 0), () => {
    const info = trainInfo(tx, ty);
    if (!info) return;
    if (info.reason) {
      sendEvent(player, "build", `Cannot train: ${info.reason}`);
      return;
    }
    // Creative mode: instant, free, no villager needed.
    if (state.creative) {
      finishTraining(null, tx, ty, info.kind, info.level);
      return;
    }
    const v = freeVillagerFor(state.clan.id, tx, ty)!;
    state.equipment.weapon[info.level - 1]--;
    state.equipment.armour[info.level - 1]--;
    const ticks = Math.round(info.days * DAY_TICKS * (state.instantBuild ? 0 : 1)) || 1;
    v.training = { tx, ty, kind: info.kind, level: info.level, ticksLeft: ticks, ticksTotal: ticks };
    v.postX = tx;
    v.postY = ty;
    v.path = [];
    sendEvent(player, "build", `${v.person?.name ?? "A villager"} begins training (${info.days} day${info.days === 1 ? "" : "s"})`);
  });
}

// Every tick: trainees count down by day; a finished one becomes the soldier. A trainee whose building is gone (or
// changed line) goes back to the village and the gear returns to the stock.
export function updateTraining() {
  const night = isNightNow();
  for (const c of Array.from(colonists.values())) {
    const t = c.training;
    if (!t) continue;
    const slots = unitBuildingSlots(t.tx, t.ty);
    if (!slots || !sameLine(slots.kind, t.kind)) {
      cancelTraining(c);
      continue;
    }
    if (!night) t.ticksLeft--;
    if (t.ticksLeft > 0) continue;
    withClan(clanById(c.clan ?? 0), () => {
      const name = c.person?.name ?? "A recruit";
      const kind = slots!.kind;
      finishTraining(c, t.tx, t.ty, kind, t.level);
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
  withClan(clanById(c.clan ?? 0), () => {
    state.equipment.weapon[t.level - 1]++;
    state.equipment.armour[t.level - 1]++;
  });
  c.training = undefined;
  const tc = nearestTownCenter(c.x, c.y, townCentersOfClan(c.clan ?? 0));
  if (tc) {
    c.postX = tc.x;
    c.postY = tc.y;
  }
}
