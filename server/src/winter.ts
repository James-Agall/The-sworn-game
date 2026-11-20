// winter.ts: Winter, heating fuel and clothing (PLAN-agri-industry-winter-mines.md phase 4; ROADMAP "Winter — landed";
// numbers in shared/src/winter.ts). Seasons off (state.seasonsOff): nothing here runs and every multiplier is 1.
//  - Heating: at each winter dawn (calendar.ts updateCalendar) every occupied home of a clan burns heat from the shared
//    stock (coal, then wood, then charcoal; coal and charcoal give double heat). A home the fuel does not cover (and a
//    homeless person) is cold that day: colony happiness down (colonists.ts), a dawn health hit, slower work, and the
//    hero rests poorly in it. The clan's cold homes are saved (ClanProgress.winter).
//  - Clothing: people (and the hero) wear garments from the Tailor (a wardrobe: coat / boots / tunic), fetched from the
//    stores on their own (outdoor workers first) and worn out slowly. On a winter day (or in falling snow) anyone
//    outdoors (not in a roofed room, an interior, a shelter or an indoor workshop, and not near a heated home) without
//    warm clothes works slower, moves slower and is slowly hurt.
//  - The Colony panel's `winter` snapshot: heat in store, burn per day, days left, cold homes, clothes needed, and the
//    autumn "Winter needs" warning (also an event at each autumn dawn).
import { TICK_RATE, TILE_SIZE, TileType } from "@colony/shared/protocol";
import { DAYS_PER_SEASON, WINTER, calendarOf } from "@colony/shared/calendar";
import {
  COLD_DAMAGE, COLD_DAMAGE_EVERY_S, COLD_HOME_DAMAGE, COLD_HOME_HAPPINESS, COLD_HOME_REST_GAIN_MULT, COLD_HOME_WORK_MULT, COLD_HP_FLOOR_FRAC,
  COLD_SPEED_MULT, COLD_WORK_MULT, FUEL_HEAT, FUEL_LOW_DAYS, FUEL_ORDER, GARMENTS, GARMENT_LABEL, HEARTH_HEAT_MULT, HEARTH_HEAT_RADIUS_TILES,
  HOME_HEAT_PER_DAY, HOME_HEAT_RADIUS_TILES, HOME_ZONE_HEAT_RADIUS_TILES, ROOM_HEAT_BASE, ROOM_HEAT_TILES_PER_EXTRA, WARDROBE_CHECK_EVERY_S, WINTER_PREP_FUEL_DAYS, WINTER_PREP_REWARD,
  type FuelId, type GarmentId, type Wardrobe, type WinterPrepSnapshot, type WinterSnapshot, garmentWearPerDay, wardrobeText, warmlyDressed,
} from "@colony/shared/winter";
import { CRAFT_RECIPES } from "./constants.js";
import { stationRecipes } from "@colony/shared/progression";
import type { Colonist, Player } from "./types.js";
import { clans, colonists, players, state } from "./state.js";
import { clanById, withClan } from "./clans.js";
import { calendarDayNow, calendarNow, seasonsOn, snowSlowNow, winterNow } from "./calendar.js";
import { itemCount, takeBestItem, takeItem } from "./progression.js";
import { roomAt } from "./structures.js";
import { inHomeArea } from "./zones.js";
import { isAbbeyClergy, isAtShelter } from "./colonists.js";
import { heroProfileOf, playerMaxHp } from "./heroes.js";
import { lifeOf } from "./herolife.js";
import { broadcastEvent } from "./net.js";
import { inBounds, tileIndex } from "./tiles.js";

// ---- transient state (recomputed once a second; never saved) ----
// Colonist ids / player ids out in the cold without warm clothes right now.
const exposed = new Set<string>();
const exposedPlayers = new Set<string>();
// Per clan: the heat points (tile + radius) of today's heated homes.
const heatPoints = new Map<number, { x: number; y: number; r: number }[]>();
// Per clan: today's cold home keys as a set (built from ClanProgress.winter.cold).
const coldSets = new Map<number, { src: string[]; set: Set<string> }>();

export function resetWinterState() {
  exposed.clear();
  exposedPlayers.clear();
  heatPoints.clear();
  coldSets.clear();
  snapCache.clear();
}

const homeKey = (x: number, y: number) => `${x},${y}`;
const clanOf = (c: Colonist) => c.clan ?? 0;

// Today's burn result of the clan (only on a winter day, and only once today's dawn burn ran or a save restored it).
function todaysCold(clanId: number): Set<string> | null {
  if (!winterNow()) return null;
  const w = clanById(clanId)?.progress.winter;
  if (!w || w.day !== calendarDayNow()) return null;
  let hit = coldSets.get(clanId);
  if (!hit || hit.src !== w.cold) {
    hit = { src: w.cold, set: new Set(w.cold) };
    coldSets.set(clanId, hit);
  }
  return hit.set;
}

// A person whose home is cold today (no fuel for it, or no home at all).
export function inColdHome(c: Colonist): boolean {
  if (!c.person || state.seasonsOff) return false;
  const cold = todaysCold(clanOf(c));
  if (!cold) return false;
  return c.person.homeX < 0 || cold.has(homeKey(c.person.homeX, c.person.homeY));
}
// The building at (tx, ty) is a home left cold today (the hero resting inside it rests poorly).
export function isColdHomeAt(clanId: number, tx: number, ty: number): boolean {
  if (state.seasonsOff) return false;
  return !!todaysCold(clanId)?.has(homeKey(tx, ty));
}

// Work-speed factor of a colonist (progression.ts workSpeed, work.ts skillSpeed, colonists.ts builderRate).
export function coldWorkMult(c: Colonist): number {
  if (state.seasonsOff) return 1;
  let m = exposed.has(c.id) ? COLD_WORK_MULT : 1;
  if (inColdHome(c)) m *= COLD_HOME_WORK_MULT;
  return m;
}
// Move-speed factor of a colonist (pathfinding.ts advanceAlongPath).
export function coldSpeedMult(id: string): number {
  return exposed.has(id) ? COLD_SPEED_MULT : 1;
}
// The hero's work / move factors and whether it is out in the cold (herolife.ts).
export function heroCold(p: Player): boolean {
  return exposedPlayers.has(p.id);
}
export function heroColdWorkMult(p: Player): number {
  return exposedPlayers.has(p.id) ? COLD_WORK_MULT : 1;
}
export function heroColdSpeedMult(p: Player): number {
  return exposedPlayers.has(p.id) ? COLD_SPEED_MULT : 1;
}
export function heroColdRestGain(p: Player): number {
  const I = p.interior;
  return I && isColdHomeAt(p.clan ?? 0, I.tx, I.ty) ? COLD_HOME_REST_GAIN_MULT : 1;
}

// Colony happiness: COLD_HOME_HAPPINESS x the share of the clan's people in cold homes (colonists.ts).
export function coldHomePenalty(): number {
  if (state.seasonsOff || !todaysCold(state.clan.id)) return 0;
  let people = 0;
  let cold = 0;
  for (const c of colonists.values()) {
    if (!c.person || clanOf(c) !== state.clan.id) continue;
    people++;
    if (inColdHome(c)) cold++;
  }
  return people > 0 ? (COLD_HOME_HAPPINESS * cold) / people : 0;
}

// ---- homes and heat ----
interface HeatUnit {
  key: string;
  need: number;
  homes: string[];
  people: number;
  // Where its heat reaches outdoors (the home tile, or a room's hearths).
  points: { x: number; y: number; r: number }[];
}

// The clan's occupied homes grouped into heat units (a house / keep / Town Center, or a room with beds), and the
// clan's people with no home at all.
function heatUnits(): { units: HeatUnit[]; homeless: number; people: number } {
  const byKey = new Map<string, HeatUnit>();
  let homeless = 0;
  let people = 0;
  const W = state.WORLD_TILES_X;
  for (const c of colonists.values()) {
    if (!c.person || clanOf(c) !== state.clan.id || isAbbeyClergy(c)) continue;
    people++;
    const { homeX: x, homeY: y } = c.person;
    if (x < 0 || !inBounds(x, y)) {
      homeless++;
      continue;
    }
    const t = state.tiles[tileIndex(x, y)] as TileType;
    const room = t === TileType.Bed ? roomAt(x, y) : null;
    const key = room ? `room:${room.id}` : homeKey(x, y);
    let u = byKey.get(key);
    if (!u) {
      if (room) {
        const hearths = room.tiles.filter((i) => state.tiles[i] === TileType.Hearth);
        const need = (ROOM_HEAT_BASE + Math.floor(room.tiles.length / ROOM_HEAT_TILES_PER_EXTRA)) * (hearths.length > 0 ? HEARTH_HEAT_MULT : 1);
        u = { key, need, homes: [], people: 0, points: hearths.map((i) => ({ x: i % W, y: Math.floor(i / W), r: HEARTH_HEAT_RADIUS_TILES })) };
      } else u = { key, need: HOME_HEAT_PER_DAY[t] ?? 1, homes: [], people: 0, points: [] };
      byKey.set(key, u);
    }
    const hk = homeKey(x, y);
    if (!u.homes.includes(hk)) {
      u.homes.push(hk);
      u.points.push({ x, y, r: HOME_HEAT_RADIUS_TILES });
    }
    u.people++;
  }
  // Fullest homes are heated first when fuel is short.
  const units = [...byKey.values()].sort((a, b) => b.people - a.people || (a.key < b.key ? -1 : 1));
  return { units, homeless, people };
}

function fuelCount(f: FuelId): number {
  return f === "wood" ? Math.max(0, Math.floor(state.stock.wood)) : itemCount(f);
}
// Heat units in the active clan's store.
function heatInStore(): number {
  return FUEL_ORDER.reduce((n, f) => n + fuelCount(f) * FUEL_HEAT[f], 0);
}
// Takes fuel worth at least `heat` (coal, then wood, then charcoal); returns the heat actually taken.
function burnHeat(heat: number): number {
  let got = 0;
  for (const f of FUEL_ORDER) {
    if (got >= heat) break;
    const n = Math.min(fuelCount(f), Math.ceil((heat - got) / FUEL_HEAT[f]));
    if (n <= 0) continue;
    if (f === "wood") state.stock.wood -= n;
    else takeItem(f, n);
    got += n * FUEL_HEAT[f];
  }
  return got;
}

// The cold day's burn of the active clan (a winter dawn): heats what the fuel covers, the rest is cold.
function burnFuelToday(day: number) {
  const { units, homeless } = heatUnits();
  const prev = state.progress.winter;
  let carry = prev ? Math.max(0, prev.carry) : 0;
  let avail = carry + heatInStore();
  let heatNeeded = 0;
  const cold: string[] = [];
  let coldPeople = homeless;
  const points: { x: number; y: number; r: number }[] = [];
  for (const u of units) {
    if (avail + 1e-9 >= u.need) {
      avail -= u.need;
      heatNeeded += u.need;
      points.push(...u.points);
    } else {
      cold.push(...u.homes);
      coldPeople += u.people;
    }
  }
  const fromCarry = Math.min(carry, heatNeeded);
  carry -= fromCarry;
  const burned = burnHeat(heatNeeded - fromCarry);
  carry += burned - (heatNeeded - fromCarry);
  state.progress.winter = { day, cold, carry: Math.round(carry * 1000) / 1000 };
  heatPoints.set(state.clan.id, points);
  snapCache.delete(state.clan.id);
  // Cold homes hurt at dawn (never below COLD_HP_FLOOR_FRAC).
  for (const c of colonists.values()) if (clanOf(c) === state.clan.id && inColdHome(c)) chill(c, COLD_HOME_DAMAGE);
  if (cold.length > 0 || homeless > 0) {
    const homes = cold.length;
    broadcastEvent("season", `Cold homes: no fuel for ${homes} home${homes === 1 ? "" : "s"}${homeless ? ` and ${homeless} without a home` : ""} (${coldPeople} people cold). Stock wood, coal or charcoal.`);
  } else {
    const burn = units.reduce((n, u) => n + u.need, 0);
    const left = burn > 0 ? Math.floor((heatInStore() + carry) / burn) : null;
    const daysLeftInWinter = DAYS_PER_SEASON - calendarOf(day).day;
    if (left !== null && left < Math.min(FUEL_LOW_DAYS, daysLeftInWinter)) broadcastEvent("season", `Fuel is low: heat for about ${left} more day${left === 1 ? "" : "s"}`);
  }
}

function chill(c: Colonist, dmg: number) {
  const floor = Math.ceil(c.maxHp * COLD_HP_FLOOR_FRAC);
  if (c.hp > floor) c.hp = Math.max(floor, c.hp - dmg);
}
function chillPlayer(p: Player, dmg: number) {
  const floor = Math.ceil(playerMaxHp(p) * COLD_HP_FLOOR_FRAC);
  if (p.hp > floor) p.hp = Math.max(floor, p.hp - dmg);
}

// ---- clothing ----
// The clan's persons in wardrobe priority order: heroes first, then outdoor workers, then everyone else.
function dressOrder(): { wardrobe: () => Wardrobe | undefined; set: (w: Wardrobe | undefined) => void }[] {
  const heroes = Array.from(players.values())
    .filter((p) => (p.clan ?? 0) === state.clan.id && !p.dead)
    .map((p) => {
      const life = lifeOf(p);
      return { wardrobe: () => life.wardrobe, set: (w: Wardrobe | undefined) => (life.wardrobe = w) };
    });
  const people = Array.from(colonists.values())
    .filter((c) => c.person && clanOf(c) === state.clan.id && !isAbbeyClergy(c))
    .sort((a, b) => Number(worksIndoors(a)) - Number(worksIndoors(b)) || (a.id < b.id ? -1 : 1))
    .map((c) => ({ wardrobe: () => c.person!.wardrobe, set: (w: Wardrobe | undefined) => (c.person!.wardrobe = w) }));
  return [...heroes, ...people];
}

// People fetch garments from the stores: first everyone not warmly dressed (coat, then boots, then tunic), then the
// rest of each wardrobe.
export function dressFromStores() {
  const order = dressOrder();
  const take = (o: (typeof order)[number], g: GarmentId): boolean => {
    if (o.wardrobe()?.[g]) return false;
    const grade = takeBestItem(g);
    if (!grade) return false;
    o.set({ ...(o.wardrobe() ?? {}), [g]: { grade, cond: 1 } });
    return true;
  };
  for (const o of order) for (const g of GARMENTS) if (!warmlyDressed(o.wardrobe())) take(o, g);
  for (const o of order) for (const g of GARMENTS) take(o, g);
}

// Dawn: every worn garment loses condition (more in winter); worn-out ones are thrown away.
function wearClothes(winter: boolean) {
  for (const o of dressOrder()) {
    const w = o.wardrobe();
    if (!w) continue;
    const next: Wardrobe = {};
    for (const g of GARMENTS) {
      const it = w[g];
      if (!it) continue;
      const cond = it.cond - garmentWearPerDay(it.grade, winter);
      if (cond > 1e-6) next[g] = { grade: it.grade, cond: Math.round(cond * 10000) / 10000 };
    }
    o.set(Object.keys(next).length ? next : undefined);
  }
}

// ---- daily (calendar.ts, each new calendar day with seasons on, under each clan) ----
export function winterDawn(day: number) {
  const season = calendarOf(day).season;
  wearClothes(season === WINTER);
  dressFromStores();
  if (season === WINTER) burnFuelToday(day);
  else if (state.progress.winter) {
    state.progress.winter = undefined;
    heatPoints.delete(state.clan.id);
  }
  snapCache.delete(state.clan.id);
  if (season === WINTER - 1) {
    const w = winterNeeds();
    if (w) broadcastEvent("season", w);
  }
}

// "Winter needs: 40 more heat (wood; coal / charcoal count double), 3 warm clothes" for a whole winter at today's burn,
// or "" when the stores cover it.
function winterNeeds(): string {
  const { units, homeless } = heatUnits();
  const burn = units.reduce((n, u) => n + u.need, 0);
  const lacking = Math.max(0, Math.ceil(burn * DAYS_PER_SEASON - heatInStore() - (state.progress.winter?.carry ?? 0)));
  const clothes = Math.max(0, needClothesCount() - warmSetsInStore());
  const parts: string[] = [];
  if (lacking > 0) parts.push(`${lacking} more fuel (wood; coal or charcoal count double)`);
  if (clothes > 0) parts.push(`warm clothes for ${clothes} more ${clothes === 1 ? "person" : "people"} (Tailor: coats, or tunics + boots)`);
  if (homeless > 0) parts.push(`homes for ${homeless}`);
  return parts.length ? `Winter needs: ${parts.join(", ")}` : "";
}

// ---- the autumn "Prepare for winter" goal (goals.ts completes and pays it) ----
// Active in autumn (seasons on) until completed this calendar year.
export function winterPrepActive(): boolean {
  return seasonsOn() && calendarNow().season === WINTER - 1 && state.progress.winterPrepYear !== calendarNow().year;
}
export function winterPrepStatus(): WinterPrepSnapshot & { done: boolean } {
  const { units } = heatUnits();
  const burn = units.reduce((n, u) => n + u.need, 0);
  const heat = heatInStore() + (state.progress.winter?.carry ?? 0);
  const fuelDays = burn > 0 ? Math.floor((heat / burn) * 10) / 10 : 0;
  const reward = Object.entries(WINTER_PREP_REWARD).map(([k, n]) => `${n} ${k}`).join(", ");
  return { fuelDays, target: WINTER_PREP_FUEL_DAYS, needClothes: needClothesCount(), reward, done: burn > 0 && fuelDays >= WINTER_PREP_FUEL_DAYS };
}

// People (and heroes) not warmly dressed.
function needClothesCount(): number {
  return dressOrder().filter((o) => !warmlyDressed(o.wardrobe())).length;
}
// Warm outfits the stores could still hand out (a coat, or a tunic + boots).
function warmSetsInStore(): number {
  return itemCount("coat") + Math.min(itemCount("tunic"), itemCount("boots"));
}

// ---- exposure (once a second, sim.ts) ----
// Stations whose workers are under a roof (workshops, mines): their worker at the post is indoors.
function worksIndoors(c: Colonist): boolean {
  if (c.postX < 0 || c.postY < 0 || !inBounds(c.postX, c.postY)) return false;
  const t = state.tiles[tileIndex(c.postX, c.postY)] as TileType;
  return c.kind === "ironMiner" || c.kind === "rockMiner" || (c.kind === "artisan" && (CRAFT_RECIPES[t] !== undefined || stationRecipes(t).length > 0));
}
function atIndoorPost(c: Colonist): boolean {
  return worksIndoors(c) && Math.max(Math.abs(c.x / TILE_SIZE - (c.postX + 0.5)), Math.abs(c.y / TILE_SIZE - (c.postY + 0.5))) <= 1.5;
}

function nearHeat(clanId: number, tx: number, ty: number): boolean {
  const pts = heatPoints.get(clanId);
  if (!pts || pts.length === 0) return false;
  const home = inHomeArea(clanId, tileIndex(tx, ty));
  for (const p of pts) {
    const d = Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty));
    if (d <= p.r || (home && d <= HOME_ZONE_HEAT_RADIUS_TILES)) return true;
  }
  return false;
}

// The heat points of today's heated homes (rebuilt after a load / a calendar jump from the saved cold list).
function ensureHeatPoints(clanId: number) {
  if (heatPoints.has(clanId)) return;
  const cold = todaysCold(clanId);
  if (!cold) return;
  withClan(clanById(clanId), () => {
    const pts: { x: number; y: number; r: number }[] = [];
    for (const u of heatUnits().units) if (!u.homes.some((h) => cold.has(h))) pts.push(...u.points);
    heatPoints.set(clanId, pts);
  });
}

function colonistOutInCold(c: Colonist): boolean {
  if (!c.person || isAbbeyClergy(c) || warmlyDressed(c.person.wardrobe)) return false;
  const tx = Math.floor(c.x / TILE_SIZE);
  const ty = Math.floor(c.y / TILE_SIZE);
  if (!inBounds(tx, ty) || roomAt(tx, ty) || isAtShelter(c) || atIndoorPost(c)) return false;
  return !nearHeat(clanOf(c), tx, ty);
}
function playerOutInCold(p: Player): boolean {
  if (p.dead || p.interior || state.creative) return false;
  const life = heroProfileOf(p).life;
  if (warmlyDressed(life?.wardrobe)) return false;
  const tx = Math.floor(p.x / TILE_SIZE);
  const ty = Math.floor(p.y / TILE_SIZE);
  if (!inBounds(tx, ty) || roomAt(tx, ty)) return false;
  // The hero's own campfire / lean-to keeps the cold off too.
  if (life?.builds.some((b) => Math.max(Math.abs(b.x - tx), Math.abs(b.y - ty)) <= 3)) return false;
  return !nearHeat(p.clan ?? 0, tx, ty);
}

// `force` (test hook): recompute now, off the once-a-second beat (no dressing or cold damage then).
export function updateWinter(force = false) {
  if (!force && state.cycleTick % TICK_RATE !== 0) return;
  if (!seasonsOn()) {
    if (exposed.size || exposedPlayers.size) resetWinterState();
    return;
  }
  if (!force && state.cycleTick % (WARDROBE_CHECK_EVERY_S * TICK_RATE) === 0) for (const c of clans) withClan(c, dressFromStores);
  exposed.clear();
  exposedPlayers.clear();
  if (!winterNow()) heatPoints.clear();
  // Cold out of doors: a winter day, or snow falling (a creative / late snow outside winter too).
  if (!winterNow() && !snowSlowNow()) return;
  for (const c of clans) ensureHeatPoints(c.id);
  for (const c of colonists.values()) if (colonistOutInCold(c)) exposed.add(c.id);
  for (const p of players.values()) if (playerOutInCold(p)) exposedPlayers.add(p.id);
  if (!force && state.cycleTick % (COLD_DAMAGE_EVERY_S * TICK_RATE) === 0) {
    for (const id of exposed) {
      const c = colonists.get(id);
      if (c) chill(c, COLD_DAMAGE);
    }
    for (const id of exposedPlayers) {
      const p = players.get(id);
      if (p) chillPlayer(p, COLD_DAMAGE);
    }
  }
}

// ---- snapshot (per clan, once a second) ----
// Cached by wall time (a paused game still shows stock changes within a second).
const snapCache = new Map<number, { at: number; snap: WinterSnapshot }>();

export function winterSnapshot(): WinterSnapshot | undefined {
  if (!seasonsOn()) return undefined;
  const hit = snapCache.get(state.clan.id);
  const now = Date.now();
  if (hit && now - hit.at < 1000) return hit.snap;
  const snap = buildWinterSnapshot();
  snapCache.set(state.clan.id, { at: now, snap });
  return snap;
}

function buildWinterSnapshot(): WinterSnapshot {
  const id = state.clan.id;
  const { units, people } = heatUnits();
  const burn = Math.round(units.reduce((n, u) => n + u.need, 0) * 100) / 100;
  const heat = heatInStore() + (state.progress.winter?.carry ?? 0);
  const cold = todaysCold(id);
  let coldPeople = 0;
  if (cold) for (const c of colonists.values()) if (clanOf(c) === id && inColdHome(c)) coldPeople++;
  const season = calendarNow().season;
  const warning = season === WINTER - 1 || season === WINTER ? winterNeeds() : "";
  const snap: WinterSnapshot = {
    heat: Math.floor(heat),
    burn,
    days: burn > 0 ? Math.floor(heat / burn) : null,
    homes: units.reduce((n, u) => n + u.homes.length, 0),
    coldHomes: cold ? cold.size : 0,
    coldPeople: cold ? coldPeople : 0,
    needClothes: needClothesCount(),
    people: people + Array.from(players.values()).filter((p) => (p.clan ?? 0) === id && !p.dead).length,
    garments: GARMENTS.reduce((n, g) => n + itemCount(g), 0),
    cold: season === WINTER,
    ...(warning ? { warning } : {}),
  };
  if (winterPrepActive()) {
    const { done: _done, ...prep } = winterPrepStatus();
    snap.prep = prep;
  }
  return snap;
}

// Person card (work.ts workTab rows): the wardrobe and the cold flags.
export function personWinterInfo(c: Colonist): { wardrobe: string; cold?: string[] } | undefined {
  if (!c.person || state.seasonsOff) return undefined;
  const flags: string[] = [];
  if (!warmlyDressed(c.person.wardrobe)) flags.push(exposed.has(c.id) ? "Freezing: needs warm clothes" : "Needs warm clothes");
  if (inColdHome(c)) flags.push(c.person.homeX < 0 ? "No home: sleeps cold" : "Cold home: no fuel");
  return { wardrobe: wardrobeText(c.person.wardrobe), ...(flags.length ? { cold: flags } : {}) };
}

// testHook "winter": the active clan's heating, wardrobes and exposure.
export function winterDebug() {
  const { units, homeless, people } = heatUnits();
  return {
    seasonsOn: seasonsOn(),
    winter: winterNow(),
    state: state.progress.winter ?? null,
    units: units.map((u) => ({ key: u.key, need: u.need, homes: u.homes, people: u.people })),
    homeless,
    people,
    heat: heatInStore(),
    snapshot: seasonsOn() ? buildWinterSnapshot() : null,
    exposed: [...exposed],
    exposedPlayers: [...exposedPlayers],
    happinessPenalty: coldHomePenalty(),
    needs: winterNeeds(),
    persons: Array.from(colonists.values())
      .filter((c) => c.person && clanOf(c) === state.clan.id)
      .map((c) => ({ id: c.id, kind: c.kind, hp: c.hp, maxHp: c.maxHp, home: [c.person!.homeX, c.person!.homeY], wardrobe: c.person!.wardrobe ?? null, warm: warmlyDressed(c.person!.wardrobe), coldHome: inColdHome(c), exposed: exposed.has(c.id), work: coldWorkMult(c), indoors: worksIndoors(c) })),
    garmentLabels: GARMENT_LABEL,
  };
}
