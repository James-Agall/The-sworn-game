// animals.ts: Stardew phase 5d (2026-11-10, docs PLAN-rimworld-stardew.md; every number in shared/src/animals.ts):
// livestock living in buildings.
//
// Houses (Chicken Coop, Livestock Barn, Pig Sty, Sheep Pen, and the cavalry Stables for horses) get a record (feeder,
// trough, products waiting) while their tile stands; animals are persistent records bound to a house. The economy is
// abstract and chunk-independent: once per calendar day (dawnStep, with a bounded catch-up) every animal eats / drinks
// from its house, its happiness / health move, adults make their product into the house and pairs may breed; COLD
// chunks need nothing else. Wandering is cosmetic: by day (not in winter) animals walk the house's Animal area zone
// (or round the house), only in ACTIVE chunks; positions are never saved. Chores (refill feeder / trough, collect) are
// done by the house's Animal Keeper post (a farmhand posted there), by free villagers with the "animals" work type
// (work.ts), or by the hero with E (heroAnimalInteract).
//
// Gap closure G6 (2026-11-10): horses can be ridden (riders: player id -> horse id, runtime only) and speed up the
// clan's trade wagons; hostile mobs near a house send its animals fleeing inside and kill animals they reach outdoors;
// animals sell at an own Market or to a settlement trader; shears / milk pail take a due product by hand; houses
// gather manure (fertiliser, zones.ts); wandering sidesteps obstacles; "Call them in" pens a house's animals.
import { TICK_RATE, TILE_SIZE, TileType } from "@colony/shared/protocol";
import {
  ADULT_AGE_DAYS, ANIMAL_AREA_RANGE_TILES, ANIMAL_CATCHUP_MAX_DAYS, ANIMAL_CHORE_SECONDS, ANIMAL_HERO_RANGE_TILES,
  ANIMAL_JOB_RANGE_TILES, ANIMAL_PRICE_GOLD, ANIMAL_REST_SECONDS_MAX, ANIMAL_REST_SECONDS_MIN, ANIMAL_SPEED,
  ANIMAL_WANDER_TILES, BABY_LABEL, BABY_NEEDS_MULT, BREED_CHANCE, BREED_MIN_FED, BREED_MIN_HAPPINESS, BREEDS_IN_WINTER,
  FEED_PER_DAY, FEEDER_DAYS, GRAIN_FEED_RESERVE, GRAIN_FEED_UNITS, GRAZE_FEED_SHARE, HAPPINESS_STEP, HAPPINESS_W_FED,
  HAPPINESS_W_OUT, HAPPINESS_W_ROOM, HAPPINESS_W_WATER, HAPPY_FLAG, HAY_FEED_UNITS, HEALTH_LOSS_PER_NEED, HEALTH_REGEN,
  HF_ANIMALS, HF_FEED_LOW, HF_PRODUCTS, HF_WATER_LOW, HOUSE_LABEL, HOUSE_SPECIES, LF_BABY, LF_HAPPY, LF_HUNGRY, LF_MALE,
  LF_MOVING, LF_SICK, LF_THIRSTY, NEED_OK, OUTDOORS_NO_AREA, OUTDOORS_WINTER, PRODUCT_HAPPY_MULT, PRODUCT_LABEL,
  PRODUCT_MIN_HAPPINESS, PRODUCT_OF, PRODUCTS, PRODUCTS_WAITING_CAP, QUALITY_HAPPINESS_2, QUALITY_HAPPINESS_3,
  QUALITY_SKILL_3, REFILL_BELOW, RENAME_MAX_CHARS, ROOM_CROWD_PENALTY, SEX_LABEL, SICK_HEALTH, SLAUGHTER_YIELD, SPECIES,
  SPECIES_LABEL, START_HAPPINESS, TAME_HOUSE_RANGE_TILES, TAME_RANGE_TILES, TAME_WILD, TROUGH_WATER_RANGE_TILES,
  WATER_PER_DAY, WINTER_FEED_MULT, WINTER_PRODUCT_MULT, houseCapacity, houseKindOfTile, type AnimalHouseInfo, type HouseKind,
  type LivestockSnapshot, type ProductId, type Species,
  ANIMAL_FLEE_SPEED_MULT, ANIMAL_KILL_RANGE_TILES, ANIMAL_SELL_TRADER_RANGE_TILES, ANIMAL_THREAT_CHECK_TICKS,
  ANIMAL_THREAT_HOLD_SECONDS, ANIMAL_THREAT_RANGE_TILES, CART_HORSE_SPEED_MULT, HAND_PRODUCT_MULT, HAND_TOOL_SPECIES,
  HOUSE_HAND_TOOL, KEEPER_TOOL_CHORE_MULT, LF_FLEEING, LF_RIDDEN, MANURE_PER_DAY, MOUNT_RANGE_TILES, RIDE_HAPPINESS_PER_S,
  WANDER_SIDESTEP_DEGREES, animalSellPrice,
} from "@colony/shared/animals";
import { COLONIST_SPEED } from "./constants.js";
import type { Colonist, Player } from "./types.js";
import { colonists, mobs, players, sites, state, wildlife } from "./state.js";
import { getBuildingLevel, inBounds, isNightNow, ownerAt, tileIndex, tileOfPixel } from "./tiles.js";
import { ChunkState, chunkStateAtPixel, streamingOn, tileIndicesOf } from "./chunks.js";
import { clanById, clanIdAt, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { calendarDayNow, winterNow } from "./calendar.js";
import { animalAreaTilesNear } from "./zones.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { addItem, gatesOpen, itemCount, takeItem } from "./progression.js";
import { standingTown, tierOf } from "./diplomacy.js";
import { skillSpeed, workSkill } from "./work.js";

interface AnimalRec {
  id: number;
  species: Species;
  male: boolean;
  name?: string;
  // Calendar day of birth (a bought / tamed animal is born ADULT_AGE_DAYS ago).
  born: number;
  house: string;
  // Last day's share of its feed / water (0-1), happiness / health 0-100.
  fed: number;
  watered: number;
  happiness: number;
  health: number;
  // Days toward the next product, and the fraction of a product carried over.
  productDays: number;
  productFrac: number;
  // G6: the due product was taken by hand (shears / pail): the next daily step makes nothing for it.
  handDone?: boolean;
}
// Runtime only (never saved): where an animal stands while outdoors.
interface AnimalPos {
  x: number;
  y: number;
  tx: number;
  ty: number;
  rest: number;
  moving: boolean;
  // G6: walking back inside (called in, or fleeing a hostile mob: faster).
  home?: boolean;
  flee?: boolean;
}
interface HouseRec {
  key: string;
  x: number;
  y: number;
  kind: HouseKind;
  clan: number;
  feed: number;
  water: number;
  // Products waiting to be collected, per grade 1-3.
  waiting: Partial<Record<ProductId, number[]>>;
  // Made on the last daily step (panel "today").
  today: Partial<Record<ProductId, number>>;
  // Cached on the daily step / panel: a water tile near (the trough fills itself), and grazing ground.
  autoWater: boolean;
  graze: number[];
  // G6 (runtime only): manure fraction carried to the next day, "Call them in" (until let out or dawn), and the tick
  // until which a hostile mob seen nearby keeps the animals inside.
  manure: number;
  penned: boolean;
  threatUntil: number;
}

const animals = new Map<number, AnimalRec>();
const houses = new Map<string, HouseRec>();
const pos = new Map<number, AnimalPos>();
// G6: player id -> the horse (animal id) it rides. Runtime only (a load dismounts everyone).
const riders = new Map<string, number>();
let nextId = 1;
let lastDay = -1;

const W = () => state.WORLD_TILES_X;
const keyOf = (x: number, y: number) => `${x},${y}`;

// ---- houses ----
function houseLevel(h: HouseRec): number {
  return Math.max(1, getBuildingLevel(h.x, h.y));
}
export function capacityOf(h: HouseRec): number {
  return houseCapacity(h.kind, houseLevel(h));
}
function biggestNeed(h: HouseRec, per: Record<Species, number>): number {
  return Math.max(...HOUSE_SPECIES[h.kind].map((s) => per[s]));
}
function feedCap(h: HouseRec): number {
  return capacityOf(h) * biggestNeed(h, FEED_PER_DAY) * WINTER_FEED_MULT * FEEDER_DAYS;
}
function waterCap(h: HouseRec): number {
  return capacityOf(h) * biggestNeed(h, WATER_PER_DAY) * FEEDER_DAYS;
}
function residents(h: HouseRec): AnimalRec[] {
  const out: AnimalRec[] = [];
  for (const a of animals.values()) if (a.house === h.key) out.push(a);
  return out;
}
function waterNear(x: number, y: number): boolean {
  const r = TROUGH_WATER_RANGE_TILES;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!inBounds(x + dx, y + dy)) continue;
      const t = state.tiles[tileIndex(x + dx, y + dy)];
      if (t === TileType.Water || t === TileType.Moat) return true;
    }
  }
  return false;
}
function refreshHouseCache(h: HouseRec) {
  h.autoWater = waterNear(h.x, h.y);
  h.graze = animalAreaTilesNear(h.clan, h.x, h.y, ANIMAL_AREA_RANGE_TILES);
}
function waitingCount(h: HouseRec): number {
  let n = 0;
  for (const g of Object.values(h.waiting)) n += (g ?? []).reduce((a, b) => a + b, 0);
  return n;
}

// Once a second: a house record per standing animal house (player clans' only); a house gone takes its animals.
let syncedTick = -1;
function syncHouses() {
  const live = new Set<string>();
  for (const kind of ["coop", "barn", "sty", "pen", "stable"] as HouseKind[]) {
    const tile = kind === "coop" ? TileType.ChickenCoop : kind === "barn" ? TileType.LivestockBarn : kind === "sty" ? TileType.PigSty : kind === "pen" ? TileType.SheepPen : TileType.Stables;
    for (const i of tileIndicesOf(tile)) {
      if (ownerAt(i) !== 0) continue;
      const x = i % W();
      const y = Math.floor(i / W());
      const key = keyOf(x, y);
      live.add(key);
      let h = houses.get(key);
      if (!h || h.kind !== kind) {
        h = { key, x, y, kind, clan: clanIdAt(x, y), feed: 0, water: 0, waiting: {}, today: {}, autoWater: false, graze: [], manure: 0, penned: false, threatUntil: 0 };
        refreshHouseCache(h);
        houses.set(key, h);
      }
      h.clan = clanIdAt(x, y);
    }
  }
  for (const [key, h] of houses) {
    if (live.has(key)) continue;
    const lost = residents(h);
    for (const a of lost) {
      animals.delete(a.id);
      pos.delete(a.id);
    }
    houses.delete(key);
    if (lost.length > 0) withClan(clanById(h.clan), () => broadcastEvent("build", `${lost.length} animal${lost.length === 1 ? " was" : "s were"} lost with the ${HOUSE_LABEL[h.kind]}`));
  }
}
function ensureSynced() {
  if (syncedTick === state.cycleTick) return;
  syncedTick = state.cycleTick;
  syncHouses();
}
function houseAt(x: number, y: number): HouseRec | undefined {
  ensureSynced();
  return houses.get(keyOf(x, y));
}

function isBaby(a: AnimalRec, day = calendarDayNow()): boolean {
  return day - a.born < ADULT_AGE_DAYS[a.species];
}
function animalLabel(a: AnimalRec): string {
  return isBaby(a) ? BABY_LABEL[a.species] : SEX_LABEL[a.species][a.male ? 1 : 0];
}

function newAnimal(species: Species, male: boolean, house: string, born: number): AnimalRec {
  const a: AnimalRec = { id: nextId++, species, male, born, house, fed: 1, watered: 1, happiness: START_HAPPINESS, health: 100, productDays: 0, productFrac: 0 };
  animals.set(a.id, a);
  return a;
}

// The keeper's (the farmhand posted at the house) animals skill level, or 1.
function keeperOf(h: HouseRec): Colonist | undefined {
  for (const c of colonists.values()) if (c.kind === "farmhand" && c.postX === h.x && c.postY === h.y) return c;
  return undefined;
}
function keeperSkill(h: HouseRec): number {
  const k = keeperOf(h);
  return k?.person ? Math.max(1, workSkill(k.person, "animals")) : 1;
}

// ---- the daily step ----
function dailyStep(day: number) {
  const winter = winterNow();
  for (const h of houses.values()) {
    refreshHouseCache(h);
    if (h.autoWater) h.water = waterCap(h);
    h.today = {};
    h.penned = false;
    const list = residents(h);
    if (list.length === 0) continue;
    const grazing = !winter && h.graze.length > 0;
    const fill = list.length / Math.max(1, capacityOf(h));
    const room = 1 - Math.min(1, fill) * ROOM_CROWD_PENALTY;
    const outdoors = winter ? OUTDOORS_WINTER : grazing ? 1 : OUTDOORS_NO_AREA;
    const skill = keeperSkill(h);
    for (const a of list) {
      const baby = isBaby(a, day);
      const mult = baby ? BABY_NEEDS_MULT : 1;
      const feedNeed = FEED_PER_DAY[a.species] * mult * (winter ? WINTER_FEED_MULT : 1) * (grazing ? 1 - GRAZE_FEED_SHARE : 1);
      const eat = Math.min(feedNeed, h.feed);
      h.feed -= eat;
      a.fed = feedNeed > 0 ? eat / feedNeed : 1;
      const waterNeed = WATER_PER_DAY[a.species] * mult;
      const drink = Math.min(waterNeed, h.water);
      h.water -= drink;
      a.watered = waterNeed > 0 ? drink / waterNeed : 1;
      const target = 100 * (HAPPINESS_W_FED * a.fed + HAPPINESS_W_WATER * a.watered + HAPPINESS_W_ROOM * room + HAPPINESS_W_OUT * outdoors);
      a.happiness = Math.max(0, Math.min(100, a.happiness + (target - a.happiness) * HAPPINESS_STEP));
      const unmet = (a.fed < NEED_OK ? 1 : 0) + (a.watered < NEED_OK ? 1 : 0);
      a.health = Math.max(0, Math.min(100, unmet > 0 ? a.health - HEALTH_LOSS_PER_NEED * unmet : a.health + HEALTH_REGEN));
      if (a.health <= 0) {
        animals.delete(a.id);
        pos.delete(a.id);
        withClan(clanById(h.clan), () => broadcastEvent("death", `A ${SPECIES_LABEL[a.species].toLowerCase()}${a.name ? ` (${a.name})` : ""} died of hunger and thirst at the ${HOUSE_LABEL[h.kind]}`));
        continue;
      }
      h.manure += MANURE_PER_DAY[a.species] * mult;
      // G6: the due product was already taken by hand (shears / milk pail).
      if (a.handDone) {
        a.handDone = false;
        a.productDays = 0;
        continue;
      }
      const prod = PRODUCT_OF[a.species];
      if (!prod || baby || (prod.femaleOnly && a.male) || a.health < SICK_HEALTH || a.happiness < PRODUCT_MIN_HAPPINESS) continue;
      if (++a.productDays < prod.days) continue;
      a.productDays = 0;
      const amount = prod.amount * (winter ? WINTER_PRODUCT_MULT : 1) * (a.happiness >= HAPPY_FLAG ? PRODUCT_HAPPY_MULT : 1) + a.productFrac;
      const whole = Math.floor(amount);
      a.productFrac = amount - whole;
      if (whole <= 0) continue;
      const grade = 1 + (a.happiness >= QUALITY_HAPPINESS_2 ? 1 : 0) + (a.happiness >= QUALITY_HAPPINESS_3 && skill >= QUALITY_SKILL_3 ? 1 : 0);
      const g = (h.waiting[prod.product] ??= [0, 0, 0]);
      g[grade - 1] += whole;
      h.today[prod.product] = (h.today[prod.product] ?? 0) + whole;
    }
    const dung = Math.floor(h.manure);
    if (dung > 0) {
      h.manure -= dung;
      (h.waiting.manure ??= [0, 0, 0])[0] += dung;
      h.today.manure = dung;
    }
    // Uncollected for days: the surplus spoils.
    let over = waitingCount(h) - PRODUCTS_WAITING_CAP;
    for (const g of Object.values(h.waiting)) {
      for (let q = 0; q < 3 && over > 0 && g; q++) {
        const take = Math.min(g[q], over);
        g[q] -= take;
        over -= take;
      }
    }
    if (winter && !BREEDS_IN_WINTER) continue;
    const now = residents(h);
    let count = now.length;
    for (const sp of HOUSE_SPECIES[h.kind]) {
      if (count >= capacityOf(h)) break;
      const ok = (a: AnimalRec) => a.species === sp && !isBaby(a, day) && a.happiness >= BREED_MIN_HAPPINESS && a.fed >= BREED_MIN_FED;
      if (!now.some((a) => ok(a) && a.male) || !now.some((a) => ok(a) && !a.male)) continue;
      if (Math.random() >= BREED_CHANCE[sp]) continue;
      newAnimal(sp, Math.random() < 0.5, h.key, day);
      count++;
      withClan(clanById(h.clan), () => broadcastEvent("build", `A ${BABY_LABEL[sp].toLowerCase()} was born at the ${HOUSE_LABEL[h.kind]}`));
    }
  }
}

// Every tick (sim.ts): house sync once a second, the daily step at a new calendar day, riders, hostile-mob checks and
// wandering in ACTIVE chunks.
export function updateAnimals(dt: number) {
  if (state.cycleTick % TICK_RATE === 0) {
    ensureSynced();
    updateRiders();
  }
  const day = calendarDayNow();
  if (lastDay < 0 || day < lastDay) lastDay = day;
  if (day > lastDay) {
    ensureSynced();
    const from = Math.max(lastDay + 1, day - ANIMAL_CATCHUP_MAX_DAYS + 1);
    for (let d = from; d <= day; d++) dailyStep(d);
    lastDay = day;
  }
  if (animals.size > 0 && state.cycleTick % ANIMAL_THREAT_CHECK_TICKS === 0) checkThreats();
  if (animals.size > 0) wander(dt);
}

// ---- G6: hostile mobs near animals ----
function hostileMob(m: { hp: number; siteId: string | null; guardianActive: boolean; siteWorker?: unknown }): boolean {
  // Dormant site guardians and settlement workers never hunt animals.
  return m.hp > 0 && !m.siteWorker && !(m.siteId && !m.guardianActive);
}
function animalName(a: AnimalRec): string {
  return `${SPECIES_LABEL[a.species].toLowerCase()}${a.name ? ` (${a.name})` : ""}`;
}
function killAnimal(a: AnimalRec, h: HouseRec | undefined, by: string) {
  animals.delete(a.id);
  pos.delete(a.id);
  for (const [pid, hid] of riders) if (hid === a.id) riders.delete(pid);
  if (h) withClan(clanById(h.clan), () => broadcastEvent("death", `A ${by} killed a ${animalName(a)} by the ${HOUSE_LABEL[h.kind]}`));
}
// Every ANIMAL_THREAT_CHECK_TICKS: a hostile mob within ANIMAL_KILL_RANGE_TILES of an animal outdoors kills it; one
// within ANIMAL_THREAT_RANGE_TILES of a house or of its animals outdoors sends them inside (and keeps them there).
function checkThreats() {
  if (houses.size === 0 || mobs.size === 0) return;
  const reach = (ANIMAL_THREAT_RANGE_TILES + ANIMAL_AREA_RANGE_TILES + 1) * TILE_SIZE;
  const threat = ANIMAL_THREAT_RANGE_TILES * TILE_SIZE;
  const kill = ANIMAL_KILL_RANGE_TILES * TILE_SIZE;
  const outByHouse = new Map<string, [AnimalRec, AnimalPos][]>();
  for (const [id, p] of pos) {
    const a = animals.get(id);
    if (!a) continue;
    let list = outByHouse.get(a.house);
    if (!list) outByHouse.set(a.house, (list = []));
    list.push([a, p]);
  }
  for (const m of mobs.values()) {
    if (!hostileMob(m)) continue;
    for (const h of houses.values()) {
      const hx = (h.x + 0.5) * TILE_SIZE;
      const hy = (h.y + 0.5) * TILE_SIZE;
      if (Math.abs(m.x - hx) > reach || Math.abs(m.y - hy) > reach) continue;
      let seen = Math.hypot(m.x - hx, m.y - hy) <= threat;
      for (const [a, p] of outByHouse.get(h.key) ?? []) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d <= kill && animals.has(a.id)) killAnimal(a, h, m.kind);
        else if (d <= threat) seen = true;
      }
      if (!seen) continue;
      if (h.threatUntil <= state.cycleTick && (outByHouse.get(h.key)?.length ?? 0) > 0) {
        withClan(clanById(h.clan), () => broadcastEvent("build", `Danger near the ${HOUSE_LABEL[h.kind]}: the animals run inside`));
      }
      h.threatUntil = state.cycleTick + ANIMAL_THREAT_HOLD_SECONDS * TICK_RATE;
    }
  }
}

// ---- wandering (cosmetic) ----
function indoorsNow(): boolean {
  return isNightNow() || winterNow();
}
function pickTarget(h: HouseRec, p: AnimalPos) {
  if (h.graze.length > 0) {
    const i = h.graze[Math.floor(Math.random() * h.graze.length)];
    p.tx = (i % W()) * TILE_SIZE + TILE_SIZE * (0.2 + Math.random() * 0.6);
    p.ty = Math.floor(i / W()) * TILE_SIZE + TILE_SIZE * (0.2 + Math.random() * 0.6);
  } else {
    const r = ANIMAL_WANDER_TILES;
    const x = h.x + Math.round((Math.random() * 2 - 1) * r);
    const y = h.y + Math.round((Math.random() * 2 - 1) * r);
    if (!inBounds(x, y) || !isWalkableTile(x, y)) return;
    p.tx = x * TILE_SIZE + TILE_SIZE * (0.2 + Math.random() * 0.6);
    p.ty = y * TILE_SIZE + TILE_SIZE * (0.2 + Math.random() * 0.6);
  }
}
function walkablePx(x: number, y: number): boolean {
  const t = tileOfPixel(x, y);
  return inBounds(t.x, t.y) && isWalkableTile(t.x, t.y);
}
// G6: one step toward (dx, dy) / d of length `step`; blocked: the first walkable sidestep (WANDER_SIDESTEP_DEGREES), or
// false (the caller rests).
function stepAround(p: AnimalPos, dx: number, dy: number, d: number, step: number): boolean {
  const base = Math.atan2(dy, dx);
  for (const deg of [0, ...WANDER_SIDESTEP_DEGREES]) {
    const ang = base + (deg * Math.PI) / 180;
    const nx = p.x + Math.cos(ang) * Math.min(step, d);
    const ny = p.y + Math.sin(ang) * Math.min(step, d);
    if (walkablePx(nx, ny)) {
      p.x = nx;
      p.y = ny;
      return true;
    }
  }
  return false;
}
function wander(dt: number) {
  if (indoorsNow()) {
    if (pos.size > 0) pos.clear();
    return;
  }
  const streaming = streamingOn();
  const ridden = new Set(riders.values());
  for (const a of animals.values()) {
    const h = houses.get(a.house);
    if (!h) continue;
    if (ridden.has(a.id)) {
      pos.delete(a.id);
      continue;
    }
    const threatened = h.threatUntil > state.cycleTick;
    let p = pos.get(a.id);
    if (!p) {
      if (threatened || h.penned) continue;
      if (streaming && chunkStateAtPixel(h.x * TILE_SIZE, h.y * TILE_SIZE) !== ChunkState.Active) continue;
      const door = findAdjacentWalkable(h.x, h.y);
      if (!door) continue;
      const x = door.x * TILE_SIZE + TILE_SIZE / 2;
      const y = door.y * TILE_SIZE + TILE_SIZE / 2;
      p = { x, y, tx: x, ty: y, rest: Math.random() * ANIMAL_REST_SECONDS_MAX * TICK_RATE, moving: false };
      pos.set(a.id, p);
    }
    if (streaming && chunkStateAtPixel(p.x, p.y) !== ChunkState.Active) continue;
    // G6: called in or fleeing: walk to the house door, then go inside.
    if ((threatened || h.penned) && !p.home) {
      const door = findAdjacentWalkable(h.x, h.y);
      p.home = true;
      p.rest = 0;
      p.tx = door ? door.x * TILE_SIZE + TILE_SIZE / 2 : p.x;
      p.ty = door ? door.y * TILE_SIZE + TILE_SIZE / 2 : p.y;
    }
    p.flee = !!p.home && threatened;
    if (p.rest > 0) {
      p.rest--;
      p.moving = false;
      if (p.rest <= 0) pickTarget(h, p);
      continue;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = ANIMAL_SPEED[a.species] * (isBaby(a) ? 0.8 : 1) * (p.flee ? ANIMAL_FLEE_SPEED_MULT : 1) * dt;
    const restTicks = () => (ANIMAL_REST_SECONDS_MIN + Math.random() * (ANIMAL_REST_SECONDS_MAX - ANIMAL_REST_SECONDS_MIN)) * TICK_RATE;
    if (d <= step) {
      p.x = p.tx;
      p.y = p.ty;
      if (p.home) {
        pos.delete(a.id);
        continue;
      }
      p.rest = restTicks();
      p.moving = false;
      continue;
    }
    if (stepAround(p, dx, dy, d, step)) p.moving = true;
    else if (p.home) pos.delete(a.id);
    else {
      p.tx = p.x;
      p.ty = p.y;
      p.rest = restTicks();
      p.moving = false;
    }
  }
}

// ---- chores ----
type Chore = "feed" | "water" | "collect";
function feedAvailable(): boolean {
  return state.creative || itemCount("hay") > 0 || state.stock.grain > GRAIN_FEED_RESERVE;
}
// Pending chores of a house (call inside its clan context for the feed check).
function choresOf(h: HouseRec): Chore[] {
  const out: Chore[] = [];
  const n = residents(h).length;
  if (n > 0 && h.feed < feedCap(h) * REFILL_BELOW && feedAvailable()) out.push("feed");
  if (n > 0 && !h.autoWater && h.water < waterCap(h) * REFILL_BELOW) out.push("water");
  if (waitingCount(h) > 0) out.push("collect");
  return out;
}
function choresIn(h: HouseRec): Chore[] {
  return withClan(clanById(h.clan), () => choresOf(h));
}
// Does every pending chore of the house (in its clan's stores). Returns a short summary ("" = nothing done).
function doChores(h: HouseRec, only?: Chore[]): string {
  return withClan(clanById(h.clan), () => {
    const parts: string[] = [];
    for (const chore of only ?? choresOf(h)) {
      if (chore === "feed") {
        const before = h.feed;
        const cap = feedCap(h);
        if (state.creative) h.feed = cap;
        else {
          const hay = Math.min(itemCount("hay"), Math.ceil((cap - h.feed) / HAY_FEED_UNITS));
          if (hay > 0 && takeItem("hay", hay)) h.feed = Math.min(cap, h.feed + hay * HAY_FEED_UNITS);
          const grain = Math.min(Math.max(0, Math.floor(state.stock.grain - GRAIN_FEED_RESERVE)), Math.ceil((cap - h.feed) / GRAIN_FEED_UNITS));
          if (grain > 0) {
            state.stock.grain -= grain;
            h.feed = Math.min(cap, h.feed + grain * GRAIN_FEED_UNITS);
          }
        }
        if (h.feed > before) parts.push(`feeder filled (${Math.round(h.feed)}/${Math.round(cap)})`);
      } else if (chore === "water") {
        h.water = waterCap(h);
        parts.push("trough filled");
      } else {
        const got: string[] = [];
        for (const prod of PRODUCTS) {
          const g = h.waiting[prod];
          if (!g) continue;
          const n = g.reduce((x, y) => x + y, 0);
          if (n <= 0) continue;
          if (prod === "wool") state.stock.wool += n;
          else for (let q = 0; q < 3; q++) if (g[q] > 0) addItem(prod, g[q], q + 1);
          got.push(`${n} ${PRODUCT_LABEL[prod].toLowerCase()}`);
        }
        h.waiting = {};
        if (got.length) parts.push(`collected ${got.join(", ")}`);
      }
    }
    return parts.join("; ");
  });
}

// G6: a chore's work ticks: x KEEPER_TOOL_CHORE_MULT while the clan's stores hold the house's tool (shears / pail).
function choreTicks(h: HouseRec): number {
  const tool = HOUSE_HAND_TOOL[h.kind];
  const fast = !!tool && withClan(clanById(h.clan), () => itemCount(tool) > 0);
  return ANIMAL_CHORE_SECONDS * TICK_RATE * (fast ? KEEPER_TOOL_CHORE_MULT : 1);
}

// ---- the Animal Keeper post (a farmhand posted at a house) ----
const keeperWork = new Map<string, number>();
export function isAnimalHouseTile(t: TileType): boolean {
  return houseKindOfTile(t) !== undefined;
}
export function updateAnimalKeeper(c: Colonist) {
  const h = houseAt(c.postX, c.postY);
  if (!h || choresIn(h).length === 0) {
    keeperWork.delete(c.id);
    c.state = "idle";
    return;
  }
  c.state = "farming";
  const total = choreTicks(h);
  const left = (keeperWork.get(c.id) ?? total) - skillSpeed(c, "animals");
  if (left > 0) {
    keeperWork.set(c.id, left);
    return;
  }
  keeperWork.delete(c.id);
  doChores(h);
}

// ---- free villagers (work type "animals", work.ts) ----
interface AnimalJob {
  key: string;
  phase: "go" | "work";
  left: number;
}
const jobs = new Map<string, AnimalJob>();
const reservedHouse = new Map<string, string>();
function houseFree(h: HouseRec, id: string): boolean {
  const r = reservedHouse.get(h.key);
  return !r || r === id || !colonists.has(r);
}
// Chebyshev tiles to the nearest own house with a chore nobody else is doing, within ANIMAL_JOB_RANGE_TILES, or null.
export function animalJobDistance(c: Colonist): number | null {
  ensureSynced();
  const t = tileOfPixel(c.x, c.y);
  const clan = c.clan ?? 0;
  let best: number | null = null;
  for (const h of houses.values()) {
    if (h.clan !== clan || !houseFree(h, c.id)) continue;
    const d = Math.max(Math.abs(h.x - t.x), Math.abs(h.y - t.y));
    if (d > ANIMAL_JOB_RANGE_TILES || (best !== null && d >= best)) continue;
    if (choresIn(h).length > 0) best = d;
  }
  return best;
}
export function clanHasAnimalWork(clan: number): boolean {
  ensureSynced();
  for (const h of houses.values()) if (h.clan === clan && houseFree(h, "") && choresIn(h).length > 0) return true;
  return false;
}
export function hasAnimalJob(c: Colonist): boolean {
  return jobs.has(c.id);
}
export function cancelAnimalJob(c: Colonist) {
  const j = jobs.get(c.id);
  if (!j) return;
  jobs.delete(c.id);
  if (reservedHouse.get(j.key) === c.id) reservedHouse.delete(j.key);
  c.path = [];
  c.state = "idle";
}
function nearHouse(c: Colonist, h: HouseRec): boolean {
  const t = tileOfPixel(c.x, c.y);
  return Math.max(Math.abs(t.x - h.x), Math.abs(t.y - h.y)) <= 1;
}
// A free villager's animal chore: walk next to the nearest house that needs it, work, do every chore there. True while
// busy.
export function updateAnimalJob(c: Colonist, dt: number, rate: number): boolean {
  let job = jobs.get(c.id);
  if (!job) {
    ensureSynced();
    const t = tileOfPixel(c.x, c.y);
    let best: HouseRec | undefined;
    let bestD = Infinity;
    for (const h of houses.values()) {
      if (h.clan !== (c.clan ?? 0) || !houseFree(h, c.id)) continue;
      const d = Math.max(Math.abs(h.x - t.x), Math.abs(h.y - t.y));
      if (d <= ANIMAL_JOB_RANGE_TILES && d < bestD && choresIn(h).length > 0) {
        best = h;
        bestD = d;
      }
    }
    if (!best) return false;
    job = { key: best.key, phase: "go", left: choreTicks(best) };
    jobs.set(c.id, job);
    reservedHouse.set(best.key, c.id);
    c.path = [];
  }
  const h = houses.get(job.key);
  if (!h || choresIn(h).length === 0) {
    cancelAnimalJob(c);
    return false;
  }
  if (job.phase === "go") {
    if (c.path.length > 0) {
      advanceAlongPath(c, dt, COLONIST_SPEED);
      c.state = "returning";
      return true;
    }
    if (!nearHouse(c, h)) {
      const door = findAdjacentWalkable(h.x, h.y);
      const path = door ? findPath(tileOfPixel(c.x, c.y), door) : null;
      if (!path || path.length === 0) {
        cancelAnimalJob(c);
        return false;
      }
      c.path = path;
      return true;
    }
    job.phase = "work";
  }
  c.state = "farming";
  job.left -= rate;
  if (job.left > 0) return true;
  doChores(h);
  cancelAnimalJob(c);
  return false;
}
export function animalJobLabel(c: Colonist): string {
  const j = jobs.get(c.id);
  if (!j) return "";
  const h = houses.get(j.key);
  return `${j.phase === "go" ? "going to" : "tending"} the ${h ? HOUSE_LABEL[h.kind] : "animals"}`;
}

// ---- the hero (E) ----
function sendText(p: Player, text: string) {
  if (p.socket.readyState === p.socket.OPEN) p.socket.send(JSON.stringify({ type: "event", category: "build", text }));
}

// ---- G6: riding ----
// The horse the player rides, or undefined.
export function riddenHorseOf(p: Player): number | undefined {
  return riders.get(p.id);
}
export function isMounted(p: Player): boolean {
  return riders.has(p.id);
}
function mountHorse(p: Player, a: AnimalRec): string {
  if (p.interior) return "Horses stay outside";
  for (const hid of riders.values()) if (hid === a.id) return "Someone already rides that horse";
  riders.set(p.id, a.id);
  pos.delete(a.id);
  return `You mount ${a.name ?? `the ${animalLabel(a).toLowerCase()}`} (X to dismount)`;
}
export function dismountHero(p: Player, quiet = false): boolean {
  const id = riders.get(p.id);
  if (id === undefined) return false;
  riders.delete(p.id);
  const a = animals.get(id);
  const h = a ? houses.get(a.house) : undefined;
  // The horse walks home from where the rider got off (daytime, outside winter), else it is back in its house.
  if (a && h && !indoorsNow()) {
    const door = findAdjacentWalkable(h.x, h.y);
    pos.set(a.id, { x: p.x, y: p.y, tx: door ? door.x * TILE_SIZE + TILE_SIZE / 2 : p.x, ty: door ? door.y * TILE_SIZE + TILE_SIZE / 2 : p.y, rest: 0, moving: true });
  }
  if (!quiet) sendText(p, `You dismount${h ? `; the horse heads back to the ${HOUSE_LABEL[h.kind]}` : ""}`);
  return true;
}
// Once a second: riders that left / died / went indoors, or whose horse is gone, are dismounted; each ridden horse
// loses RIDE_HAPPINESS_PER_S a second.
function updateRiders() {
  for (const [pid, id] of riders) {
    const p = players.get(pid);
    const a = animals.get(id);
    if (!p || p.dead || p.interior || !a) {
      riders.delete(pid);
      if (p && !a) sendText(p, "Your horse is gone");
      continue;
    }
    a.happiness = Math.max(0, a.happiness - RIDE_HAPPINESS_PER_S);
  }
}
// wagons.ts: x CART_HORSE_SPEED_MULT for a clan with a Stables holding an adult horse nobody rides (cached a second).
const cartCache = new Map<number, { tick: number; mult: number }>();
export function cartHorseMult(clan: number): number {
  const hit = cartCache.get(clan);
  if (hit && hit.tick === state.cycleTick) return hit.mult;
  ensureSynced();
  const ridden = new Set(riders.values());
  let mult = 1;
  for (const a of animals.values()) {
    const h = houses.get(a.house);
    if (h && h.kind === "stable" && h.clan === clan && a.species === "horse" && !isBaby(a) && !ridden.has(a.id)) {
      mult = CART_HORSE_SPEED_MULT;
      break;
    }
  }
  cartCache.set(clan, { tick: state.cycleTick, mult });
  return mult;
}

// ---- G6: shears / milk pail ----
// Why an animal cannot give its product by hand now ("" = it can).
function handBlock(a: AnimalRec): string {
  const prod = PRODUCT_OF[a.species];
  if (!prod || isBaby(a) || (prod.femaleOnly && a.male)) return `The ${animalLabel(a).toLowerCase()} gives nothing`;
  if (a.health < SICK_HEALTH) return `The ${animalName(a)} is sick`;
  if (a.handDone || a.productDays + 1 < prod.days) return `The ${animalName(a)} has nothing ready yet`;
  return "";
}
// The shears / pail on the nearest own sheep / cow (outdoors within MOUNT_RANGE_TILES, or in an own house within
// ANIMAL_HERO_RANGE_TILES). "" = done, "-" = no such animal near, else why not.
export function heroHandProduct(p: Player, tool: "shears" | "milkPail"): string {
  ensureSynced();
  const clan = p.clan ?? 0;
  const sp = HAND_TOOL_SPECIES[tool];
  const cands: AnimalRec[] = [];
  for (const [id, q] of pos) {
    const a = animals.get(id);
    const h = a ? houses.get(a.house) : undefined;
    if (a && h && h.clan === clan && a.species === sp && Math.hypot(q.x - p.x, q.y - p.y) <= MOUNT_RANGE_TILES * TILE_SIZE) cands.push(a);
  }
  for (const h of houses.values()) {
    if (h.clan !== clan || Math.hypot((h.x + 0.5) * TILE_SIZE - p.x, (h.y + 0.5) * TILE_SIZE - p.y) > ANIMAL_HERO_RANGE_TILES * TILE_SIZE) continue;
    for (const a of residents(h)) if (a.species === sp && !pos.has(a.id)) cands.push(a);
  }
  if (cands.length === 0) return "-";
  const a = cands.find((x) => handBlock(x) === "");
  if (!a) return handBlock(cands[0]);
  const h = houses.get(a.house)!;
  const label = tool === "shears" ? "shears" : "milk pail";
  const why = withClan(clanById(clan), () => (!gatesOpen() && itemCount(tool) <= 0 ? `You need ${tool === "shears" ? "shears" : "a milk pail"} in your stores (craft by hand)` : ""));
  if (why) return why;
  const prod = PRODUCT_OF[a.species]!;
  const winter = winterNow();
  const amount = prod.amount * HAND_PRODUCT_MULT * (winter ? WINTER_PRODUCT_MULT : 1) * (a.happiness >= HAPPY_FLAG ? PRODUCT_HAPPY_MULT : 1) + a.productFrac;
  const whole = Math.max(1, Math.floor(amount));
  a.productFrac = Math.max(0, amount - whole);
  a.handDone = true;
  const grade = 1 + (a.happiness >= QUALITY_HAPPINESS_2 ? 1 : 0) + (a.happiness >= QUALITY_HAPPINESS_3 && keeperSkill(h) >= QUALITY_SKILL_3 ? 1 : 0);
  withClan(clanById(clan), () => {
    if (prod.product === "wool") state.stock.wool += whole;
    else addItem(prod.product, whole, grade);
  });
  sendText(p, `With the ${label}: +${whole} ${PRODUCT_LABEL[prod.product].toLowerCase()} from the ${animalName(a)}`);
  return "";
}

// E: shears / pail in hand on a sheep / cow; mount an own adult horse outdoors next to the hero; tame a wild animal
// next to the hero; else tend an own animal house within reach (or the house of an own animal next to the hero). True
// when it did something (or said why not).
export function heroAnimalInteract(p: Player, tool?: unknown): boolean {
  ensureSynced();
  const clan = p.clan ?? 0;
  if (tool === "shears" || tool === "milkPail") {
    const why = heroHandProduct(p, tool);
    if (why !== "-") {
      if (why) sendText(p, why);
      return true;
    }
  }
  // Riding: the nearest own adult horse outdoors within reach.
  if (!isMounted(p)) {
    let horse: AnimalRec | undefined;
    let bestH = MOUNT_RANGE_TILES * TILE_SIZE;
    for (const [id, q] of pos) {
      const a = animals.get(id);
      const h = a ? houses.get(a.house) : undefined;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (a && h && h.clan === clan && a.species === "horse" && !isBaby(a) && d <= bestH) {
        horse = a;
        bestH = d;
      }
    }
    if (horse) {
      sendText(p, mountHorse(p, horse));
      return true;
    }
  }
  // Taming.
  for (const w of wildlife.values()) {
    const rule = TAME_WILD[w.kind];
    if (!rule || Math.hypot(w.x - p.x, w.y - p.y) > TAME_RANGE_TILES * TILE_SIZE) continue;
    let home: HouseRec | undefined;
    let bestD = Infinity;
    for (const h of houses.values()) {
      if (h.clan !== clan || !HOUSE_SPECIES[h.kind].includes(rule.species) || residents(h).length >= capacityOf(h)) continue;
      const d = Math.hypot(h.x * TILE_SIZE - p.x, h.y * TILE_SIZE - p.y);
      if (d <= TAME_HOUSE_RANGE_TILES * TILE_SIZE && d < bestD) {
        home = h;
        bestD = d;
      }
    }
    if (!home) {
      sendText(p, `To tame the ${w.kind}, build a house with room for ${SPECIES_LABEL[rule.species].toLowerCase()}s within ${TAME_HOUSE_RANGE_TILES} tiles`);
      return true;
    }
    const why = withClan(clanById(clan), () => {
      if (!state.creative && state.stock[rule.food] < rule.amount) return `Taming a ${w.kind} takes ${rule.amount} ${rule.food}`;
      if (!state.creative) state.stock[rule.food] -= rule.amount;
      return "";
    });
    if (why) {
      sendText(p, why);
      return true;
    }
    wildlife.delete(w.id);
    newAnimal(rule.species, Math.random() < 0.5, home.key, calendarDayNow() - ADULT_AGE_DAYS[rule.species]);
    sendText(p, `You tame the ${w.kind}: a ${SPECIES_LABEL[rule.species].toLowerCase()} joins the ${HOUSE_LABEL[home.kind]}`);
    return true;
  }
  let target: HouseRec | undefined;
  let bestD = ANIMAL_HERO_RANGE_TILES * TILE_SIZE;
  for (const h of houses.values()) {
    if (h.clan !== clan) continue;
    const d = Math.hypot((h.x + 0.5) * TILE_SIZE - p.x, (h.y + 0.5) * TILE_SIZE - p.y);
    if (d <= bestD) {
      target = h;
      bestD = d;
    }
  }
  if (!target) {
    for (const [id, q] of pos) {
      const a = animals.get(id);
      const h = a ? houses.get(a.house) : undefined;
      if (h && h.clan === clan && Math.hypot(q.x - p.x, q.y - p.y) <= TILE_SIZE * 1.2) {
        target = h;
        break;
      }
    }
  }
  if (!target) return false;
  const done = doChores(target);
  sendText(p, done ? `${HOUSE_LABEL[target.kind]}: ${done}` : `${HOUSE_LABEL[target.kind]}: nothing to do (${residents(target).length} animals, feeder ${Math.round(target.feed)}/${Math.round(feedCap(target))})`);
  return true;
}

// ---- G6: selling ----
const SELL_TIERS: readonly string[] = ["neutral", "friendly", "allied", "vassal"];
function priceOf(a: AnimalRec): number {
  return animalSellPrice(a.species, isBaby(a), a.happiness, a.health);
}
// Where the player's clan could sell animals now: an own Market, or a settlement trader (neutral or better) within
// ANIMAL_SELL_TRADER_RANGE_TILES of the hero. venue "" = nowhere (why says what is needed).
export function sellVenueFor(p: Player | undefined, clan: number): { venue: string; why: string } {
  for (const i of tileIndicesOf(TileType.Market)) {
    if (ownerAt(i) === 0 && clanIdAt(i % W(), Math.floor(i / W())) === clan) return { venue: "your Market", why: "" };
  }
  if (p && !p.dead && !p.interior) {
    for (const m of mobs.values()) {
      if (!m.siteWorker || !m.siteId) continue;
      const s = sites.get(m.siteId);
      if (!standingTown(s) || s.workers[0] !== m.id || Math.hypot(m.x - p.x, m.y - p.y) > ANIMAL_SELL_TRADER_RANGE_TILES * TILE_SIZE) continue;
      if (SELL_TIERS.includes(tierOf(clan, s))) return { venue: `the trader of ${s.name}`, why: "" };
    }
  }
  return { venue: "", why: `To sell: build a Market, or stand within ${ANIMAL_SELL_TRADER_RANGE_TILES} tiles of a settlement trader (relation neutral or better)` };
}
function sellRec(a: AnimalRec, venue: string): string {
  for (const id of riders.values()) if (id === a.id) return "Someone rides that horse: dismount first";
  const h = houses.get(a.house);
  const price = priceOf(a);
  withClan(clanById(h?.clan ?? 0), () => {
    state.stock.gold += price;
  });
  animals.delete(a.id);
  pos.delete(a.id);
  return `Sold the ${animalName(a)} to ${venue} for ${price} gold`;
}
// Trader dialogue: the clan's animals (dearest first, at most `max`) with their prices.
export function animalsForSale(clan: number, max = 8): { id: number; label: string; price: number }[] {
  ensureSynced();
  const ridden = new Set(riders.values());
  const out: { id: number; label: string; price: number }[] = [];
  for (const a of animals.values()) {
    const h = houses.get(a.house);
    if (!h || h.clan !== clan || ridden.has(a.id)) continue;
    out.push({ id: a.id, label: `${a.name ? `${a.name} (${animalLabel(a)})` : animalLabel(a)} of the ${HOUSE_LABEL[h.kind]}`, price: priceOf(a) });
  }
  return out.sort((x, y) => y.price - x.price || x.id - y.id).slice(0, max);
}
// Sells one of the clan's animals at the venue (dialogue / panel). Returns the result line.
export function sellAnimalTo(clan: number, id: number, venue: string): string {
  const a = animals.get(id);
  const h = a ? houses.get(a.house) : undefined;
  if (!a || !h || h.clan !== clan) return "That animal is not yours to sell";
  return sellRec(a, venue);
}

// ---- the building panel ----
export function animalHouseInfo(tx: number, ty: number, viewer?: Player): AnimalHouseInfo | undefined {
  const h = houseAt(tx, ty);
  if (!h) return undefined;
  refreshHouseCache(h);
  const day = calendarDayNow();
  const list = residents(h);
  const cap = capacityOf(h);
  const winter = winterNow();
  const keeper = keeperOf(h);
  const ridden = new Set(riders.values());
  const sell = sellVenueFor(viewer, h.clan);
  const nearHouse = !!viewer && !viewer.interior && Math.hypot((h.x + 0.5) * TILE_SIZE - viewer.x, (h.y + 0.5) * TILE_SIZE - viewer.y) <= (ANIMAL_HERO_RANGE_TILES + 1) * TILE_SIZE;
  const buy: AnimalHouseInfo["buy"] = [];
  for (const sp of HOUSE_SPECIES[h.kind]) {
    for (const male of [false, true]) {
      const gold = ANIMAL_PRICE_GOLD[sp];
      const reason = list.length >= cap ? "Full: upgrade the building for more room" : !state.creative && state.stock.gold < gold ? `Needs ${gold} gold` : "";
      buy.push({ species: sp, male, label: SEX_LABEL[sp][male ? 1 : 0], gold, ok: reason === "", reason });
    }
  }
  const fmt = (r: Partial<Record<ProductId, number>>) =>
    PRODUCTS.filter((k) => (r[k] ?? 0) > 0).map((k) => `${r[k]} ${PRODUCT_LABEL[k].toLowerCase()}`).join(", ") || "nothing";
  const waiting: Partial<Record<ProductId, number>> = {};
  for (const k of PRODUCTS) waiting[k] = (h.waiting[k] ?? []).reduce((a, b) => a + b, 0);
  const notes: string[] = [];
  notes.push(`Feed: hay (${HAY_FEED_UNITS} each) first, then grain above a ${GRAIN_FEED_RESERVE}-grain reserve`);
  if (!h.autoWater) notes.push(`No water within ${TROUGH_WATER_RANGE_TILES} tiles: workers fill the trough by hand`);
  notes.push(h.graze.length > 0 ? `Grazes ${h.graze.length} Animal area tiles: ${Math.round(GRAZE_FEED_SHARE * 100)}% less feed (not in winter)` : `Paint an Animal area within ${ANIMAL_AREA_RANGE_TILES} tiles for grazing (less feed, happier)`);
  if (winter) notes.push(`Winter: indoors, x${WINTER_FEED_MULT} feed, x${WINTER_PRODUCT_MULT} products${BREEDS_IN_WINTER ? "" : ", no breeding"}`);
  notes.push("E next to the building: fill feeder / trough and collect (or free villagers with Animals work on)");
  const tool = HOUSE_HAND_TOOL[h.kind];
  if (tool) notes.push(`${tool === "shears" ? "Shears" : "A milk pail"} in the stores: chores x${KEEPER_TOOL_CHORE_MULT} time; the hero uses it (hotbar) for x${HAND_PRODUCT_MULT} when due`);
  if (h.threatUntil > state.cycleTick) notes.push("Danger nearby: the animals stay inside");
  return {
    kind: h.kind, capacity: cap,
    animals: list.map((a) => {
      const prod = PRODUCT_OF[a.species];
      const baby = isBaby(a, day);
      const isRidden = ridden.has(a.id);
      const ride = a.species !== "horse" ? "Only horses" : baby ? "Too young to ride" : isRidden ? "Being ridden" : !viewer ? "No hero" : isMounted(viewer) ? "You are riding already" : !nearHouse ? "Stand next to the building" : "";
      return {
        id: a.id, species: a.species, label: animalLabel(a), name: a.name ?? "", baby, male: a.male, ageDays: day - a.born,
        fed: Math.round(a.fed * 100), watered: Math.round(a.watered * 100), happiness: Math.round(a.happiness), health: Math.round(a.health),
        product: baby ? `grows up in ${ADULT_AGE_DAYS[a.species] - (day - a.born)} d` : prod && !(prod.femaleOnly && a.male) ? `${PRODUCT_LABEL[prod.product]} every ${prod.days} d` : "Meat on slaughter",
        price: priceOf(a), ridden: isRidden, ride,
      };
    }),
    feed: Math.round(h.feed * 10) / 10, feedCap: Math.round(feedCap(h)), water: Math.round(h.water * 10) / 10, waterCap: Math.round(waterCap(h)),
    autoWater: h.autoWater, grazing: !winter && h.graze.length > 0, winter,
    waiting: fmt(waiting), today: fmt(h.today),
    keeper: keeper?.person ? `${keeper.person.name} (Animal Keeper Lv ${Math.max(1, workSkill(keeper.person, "animals"))})` : h.kind === "stable" ? "No keeper post (free villagers with Animals work tend it)" : "Animal Keeper post open",
    buy, notes,
    sellVenue: sell.venue, sellWhy: sell.why,
    outdoors: list.filter((a) => pos.has(a.id)).length, penned: h.penned,
  };
}

// animalAction {tileX, tileY, op: buy | slaughter | rename | sell | ride | herd, species?, male?, id?, name?, on?} from
// the building panel.
export function handleAnimalAction(player: Player, m: Record<string, unknown>): string {
  const tx = m.tileX;
  const ty = m.tileY;
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return "";
  const h = houseAt(tx as number, ty as number);
  if (!h) return "No animal house there";
  if (h.clan !== (player.clan ?? 0)) return "Not your building";
  if (m.op === "herd") {
    h.penned = m.on !== false;
    return h.penned ? `You call the animals into the ${HOUSE_LABEL[h.kind]} (they stay in until you let them out, or dawn)` : `The animals may graze again`;
  }
  if (m.op === "buy") {
    const sp = m.species as Species;
    if (!SPECIES.includes(sp) || !HOUSE_SPECIES[h.kind].includes(sp)) return "That animal does not live here";
    if (residents(h).length >= capacityOf(h)) return `The ${HOUSE_LABEL[h.kind]} is full: upgrade it for more room`;
    const price = ANIMAL_PRICE_GOLD[sp];
    if (!state.creative) {
      if (state.stock.gold < price) return `A ${SPECIES_LABEL[sp].toLowerCase()} costs ${price} gold`;
      state.stock.gold -= price;
    }
    const male = m.male === true;
    newAnimal(sp, male, h.key, calendarDayNow() - ADULT_AGE_DAYS[sp]);
    return `Bought a ${SEX_LABEL[sp][male ? 1 : 0].toLowerCase()} for the ${HOUSE_LABEL[h.kind]}${state.creative ? "" : ` (${price} gold)`}`;
  }
  const a = typeof m.id === "number" ? animals.get(m.id) : undefined;
  if (!a || a.house !== h.key) return "No such animal here";
  if (m.op === "rename") {
    const name = typeof m.name === "string" ? m.name.replace(/[^\p{L}\p{N} '\-]/gu, "").trim().slice(0, RENAME_MAX_CHARS) : "";
    if (name) a.name = name;
    else delete a.name;
    return name ? `Named it ${name}` : "Name cleared";
  }
  if (m.op === "sell") {
    const v = sellVenueFor(player, h.clan);
    return v.venue ? sellRec(a, v.venue) : v.why;
  }
  if (m.op === "ride") {
    if (a.species !== "horse" || isBaby(a)) return "Only a grown horse can be ridden";
    if (isMounted(player)) return "You are riding already";
    if (player.interior || Math.hypot((h.x + 0.5) * TILE_SIZE - player.x, (h.y + 0.5) * TILE_SIZE - player.y) > (ANIMAL_HERO_RANGE_TILES + 1) * TILE_SIZE) return `Stand next to the ${HOUSE_LABEL[h.kind]} to ride`;
    return mountHorse(player, a);
  }
  if (m.op === "slaughter") {
    for (const id of riders.values()) if (id === a.id) return "Someone rides that horse: dismount first";
    if (isBaby(a)) return "Only fully grown animals can be slaughtered";
    const y = SLAUGHTER_YIELD[a.species];
    state.stock.meat += y.meat;
    if (y.hide > 0) addItem("hide", y.hide);
    animals.delete(a.id);
    pos.delete(a.id);
    return `Slaughtered the ${animalLabel(a).toLowerCase()}${a.name ? ` (${a.name})` : ""}: ${y.meat} meat${y.hide ? ` + ${y.hide} hide` : ""}`;
  }
  return "";
}

// ---- snapshot ----
// Per player: animals outdoors (near it on big worlds) and the clan's house need flags.
let snapTick = -1;
let snapAll: number[] = [];
const snapHouses = new Map<number, number[]>();
export function livestockPayloadFor(player: Player, near: ((x: number, y: number) => boolean) | null): string | null {
  if (houses.size === 0 && animals.size === 0) return null;
  if (snapTick !== state.cycleTick) {
    snapTick = state.cycleTick;
    snapHouses.clear();
    const day = calendarDayNow();
    snapAll = [];
    for (const [id, p] of pos) {
      const a = animals.get(id);
      if (!a) continue;
      const f = (isBaby(a, day) ? LF_BABY : 0) | (a.male ? LF_MALE : 0) | (p.moving ? LF_MOVING : 0) | (a.fed < NEED_OK ? LF_HUNGRY : 0) |
        (a.watered < NEED_OK ? LF_THIRSTY : 0) | (a.health < SICK_HEALTH ? LF_SICK : 0) | (a.happiness >= HAPPY_FLAG ? LF_HAPPY : 0) |
        (p.flee ? LF_FLEEING : 0);
      snapAll.push(id, SPECIES.indexOf(a.species), Math.round(p.x), Math.round(p.y), f);
    }
    // G6: ridden horses, drawn under their riders.
    for (const [pid, id] of riders) {
      const a = animals.get(id);
      const rp = players.get(pid);
      if (!a || !rp) continue;
      snapAll.push(id, SPECIES.indexOf(a.species), Math.round(rp.x), Math.round(rp.y), LF_RIDDEN | LF_MOVING | (a.male ? LF_MALE : 0));
    }
  }
  const clan = player.clan ?? 0;
  let h = snapHouses.get(clan);
  if (!h) {
    h = [];
    withClan(clanById(clan), () => {
      for (const house of houses.values()) {
        if (house.clan !== clan) continue;
        const n = residents(house).length;
        const f = (n > 0 ? HF_ANIMALS : 0) | (n > 0 && house.feed < feedCap(house) * REFILL_BELOW ? HF_FEED_LOW : 0) |
          (n > 0 && !house.autoWater && house.water < waterCap(house) * REFILL_BELOW ? HF_WATER_LOW : 0) | (waitingCount(house) > 0 ? HF_PRODUCTS : 0);
        h!.push(tileIndex(house.x, house.y), f);
      }
    });
    snapHouses.set(clan, h);
  }
  let a = snapAll;
  if (near) {
    a = [];
    for (let i = 0; i < snapAll.length; i += 5) if (near(snapAll[i + 2], snapAll[i + 3])) a.push(...snapAll.slice(i, i + 5));
  }
  const snap: LivestockSnapshot = { a, h };
  return JSON.stringify(snap);
}

// ---- saves ----
export interface LivestockSave {
  nextId: number;
  lastDay: number;
  houses: [key: string, feed: number, water: number, waiting: Partial<Record<ProductId, number[]>>][];
  animals: AnimalRec[];
}
export function livestockForSave(): LivestockSave | undefined {
  if (houses.size === 0 && animals.size === 0) return undefined;
  return {
    nextId, lastDay,
    houses: Array.from(houses.values(), (h) => [h.key, h.feed, h.water, h.waiting] as LivestockSave["houses"][number]),
    animals: Array.from(animals.values(), (a) => ({ ...a })),
  };
}
export function restoreLivestock(s: LivestockSave | undefined) {
  animals.clear();
  houses.clear();
  pos.clear();
  riders.clear();
  cartCache.clear();
  jobs.clear();
  reservedHouse.clear();
  keeperWork.clear();
  syncedTick = -1;
  nextId = s?.nextId ?? 1;
  lastDay = s?.lastDay ?? -1;
  if (!s) return;
  syncHouses();
  for (const [key, feed, water, waiting] of s.houses ?? []) {
    const h = houses.get(key);
    if (h) Object.assign(h, { feed, water, waiting: waiting ?? {} });
  }
  for (const a of s.animals ?? []) {
    if (!houses.has(a.house) || !SPECIES.includes(a.species)) continue;
    animals.set(a.id, { ...a });
    nextId = Math.max(nextId, a.id + 1);
  }
}

// ---- test hooks ----
export function livestockDebug(set?: Record<string, unknown>) {
  ensureSynced();
  if (set) {
    const h = typeof set.house === "string" ? houses.get(set.house) : undefined;
    if (h && typeof set.feed === "number") h.feed = set.feed;
    if (h && typeof set.water === "number") h.water = set.water;
    if (h && typeof set.autoWater === "boolean") h.autoWater = set.autoWater;
    // Run one daily step now (as if a new calendar day began).
    if (set.daily === true) dailyStep(calendarDayNow());
    if (typeof set.animal === "number") {
      const a = animals.get(set.animal);
      if (a && typeof set.happiness === "number") a.happiness = set.happiness;
      if (a && typeof set.born === "number") a.born = set.born;
      if (a && typeof set.health === "number") a.health = set.health;
      if (a && typeof set.productDays === "number") a.productDays = set.productDays;
    }
    // G6: `penned` {house, on}; `threat` false clears every house's danger hold.
    if (h && typeof set.penned === "boolean") h.penned = set.penned;
    if (set.threat === false) for (const x of houses.values()) x.threatUntil = 0;
  }
  return {
    lastDay, day: calendarDayNow(), winter: winterNow(),
    houses: Array.from(houses.values(), (h) => ({
      key: h.key, kind: h.kind, clan: h.clan, feed: h.feed, water: h.water, feedCap: feedCap(h), waterCap: waterCap(h), capacity: capacityOf(h),
      waiting: h.waiting, today: h.today, autoWater: h.autoWater, graze: h.graze.length, chores: choresIn(h), keeper: keeperOf(h)?.id ?? null,
      manure: h.manure, penned: h.penned, threatened: h.threatUntil > state.cycleTick, choreTicks: choreTicks(h),
    })),
    animals: Array.from(animals.values(), (a) => ({
      ...a, baby: isBaby(a), outdoors: pos.has(a.id), fleeing: !!pos.get(a.id)?.flee, price: priceOf(a),
      ...(pos.has(a.id) ? { x: pos.get(a.id)!.x, y: pos.get(a.id)!.y } : {}),
    })),
    riders: Object.fromEntries(riders),
    cartMult: Object.fromEntries(Array.from(new Set(Array.from(houses.values(), (h) => h.clan)), (c) => [c, cartHorseMult(c)])),
    jobs: Object.fromEntries(Array.from(jobs, ([id, j]) => [id, j.key])),
  };
}

