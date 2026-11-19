// agri.ts: Agriculture extras (PLAN-agri-industry-winter-mines.md phase 5; ROADMAP "Agriculture extras — landed";
// numbers in shared/src/agri.ts, items / recipes / gates in shared/src/progression.ts).
//  - Spoilage: at each calendar dawn (calendar.ts) every clan loses a share of its food by spoilage class (raw meat /
//    milk fast, fruit / eggs / baked goods slower, grain / flour / hops slowly, preserved foods never), cut by its
//    storerooms (as before), clay pots in store and its best Cellar. Seasons off or COLONY_UNLOCK_ALL: the old flat 2%
//    of grain / meat / fruit (structures.ts spoilFood).
//  - Sickness: at the dawn meal (colonists.ts applyDailyFoodConsumption) raw meat eaten from the stock and the food
//    spoiled at the last dawn make people sick for a few dawns: an hp hit each dawn and colony happiness down.
//  - Sourdough starter: lost when no baker tends any Bakery for STARTER_UNTENDED_DAYS dawns, or when a Bakery burns.
//  - Orchard years (planting day per orchard, saved), the iron plow's field bonus, hops harvests and ale (drunk at
//    dawn, a happiness bonus by grade).
//  - The Colony panel's `agri` snapshot and the building-panel lines.
import { TileType } from "@colony/shared/protocol";
import { DAYS_PER_YEAR } from "@colony/shared/calendar";
import {
  ALE_HAPPINESS, ALE_PEOPLE_PER_MUG, BAKERY_FIRE_HP_FRAC, CELLAR_SPOIL_CUT, IRON_PLOW_GROWTH_MULT, IRON_PLOW_YIELD_MULT,
  KITCHEN_RAW_MEAT_MULT, ORCHARD_LEGACY_AGE, ORCHARD_YIELD_BY_AGE, POT_SPOIL_CUT_MAX, POT_SPOIL_CUT_PER_POT, RAW_MEAT_SICK_RISK,
  SICK_DAMAGE, SICK_DAYS, SICK_HAPPINESS, SICK_HP_FLOOR_FRAC, SPOILED_EATEN_SHARE, SPOILED_SICK_RISK, SPOIL_CLASS, SPOIL_PER_DAY,
  STARTER_UNTENDED_DAYS, type AgriSnapshot, type SpoilClass,
} from "@colony/shared/agri";
import { FOOD_ITEMS, type ItemId } from "@colony/shared/progression";
import type { Colonist } from "./types.js";
import { type AgriState, type Clan, colonists, state } from "./state.js";
import { clanById, clanIdAt, clanIdAtIndex, withClan } from "./clans.js";
import { calendarDayNow, seasonsOn } from "./calendar.js";
import { itemCount, takeItem } from "./progression.js";
import { clanHasKitchen, storeroomProtectionOf } from "./structures.js";
import { isAbbeyClergy } from "./colonists.js";
import { broadcastEvent } from "./net.js";
import { getBuildingLevel, inBounds, tileIndex } from "./tiles.js";
import { tileIndicesOf } from "./chunks.js";

// The new daily rules (spoilage classes, sickness, the untended starter, orchard ages) run with seasons on and not
// under COLONY_UNLOCK_ALL (older suites keep their numbers).
export function agriOn(): boolean {
  return seasonsOn() && !state.testUnlockAll;
}

function agriOf(c: Clan = state.clan): AgriState {
  return (c.progress.agri ??= { untended: 0, spoiled: 0, sick: {}, carry: {} });
}

const clanOf = (c: Colonist) => c.clan ?? 0;
function clanPeople(clanId: number): Colonist[] {
  return Array.from(colonists.values()).filter((c) => c.person && clanOf(c) === clanId && !isAbbeyClergy(c));
}
function itemsOf(c: Clan, id: ItemId): number {
  return (c.progress.items[id] ?? []).reduce((a, b) => a + b, 0);
}

// ---- spoilage ----
export function potSpoilCut(c: Clan): number {
  return Math.min(POT_SPOIL_CUT_MAX, itemsOf(c, "clayPot") * POT_SPOIL_CUT_PER_POT);
}
// The level of the clan's best Cellar (0: none).
export function cellarLevelOf(clanId: number): number {
  let best = 0;
  const W = state.WORLD_TILES_X;
  for (const i of tileIndicesOf(TileType.Cellar)) {
    if (clanIdAtIndex(i) !== clanId) continue;
    best = Math.max(best, Math.min(CELLAR_SPOIL_CUT.length, getBuildingLevel(i % W, Math.floor(i / W))));
  }
  return best;
}
export function cellarSpoilCut(clanId: number): number {
  const lvl = cellarLevelOf(clanId);
  return lvl > 0 ? CELLAR_SPOIL_CUT[lvl - 1] : 0;
}
// What is left of a day's spoilage share after every protection (storerooms x pots x cellar).
export function spoilKeepMult(clanId: number): number {
  const c = clanById(clanId);
  return (1 - storeroomProtectionOf(clanId)) * (1 - potSpoilCut(c)) * (1 - cellarSpoilCut(clanId));
}

const STOCK_FOODS = ["meat", "fruit", "grain"] as const;

// The clan's daily spoilage (calendar dawn, agriOn): returns what went off, by good. Whole units only; the fraction of
// each good is carried to the next dawn (so a small store spoils too).
export function spoilFoodAgri(clanId: number): Record<string, number> {
  const c = clanById(clanId);
  const a = agriOf(c);
  const keep = spoilKeepMult(clanId);
  const out: Record<string, number> = {};
  let units = 0;
  const share = (good: string, have: number): number => {
    const cls = SPOIL_CLASS[good] as SpoilClass | undefined;
    const rate = cls ? SPOIL_PER_DAY[cls] * keep : 0;
    if (rate <= 0 || have <= 0) {
      delete a.carry[good];
      return 0;
    }
    const loss = have * rate + (a.carry[good] ?? 0);
    const whole = Math.min(Math.floor(have), Math.floor(loss + 1e-9));
    a.carry[good] = Math.round((loss - whole) * 1000) / 1000;
    return whole;
  };
  const stock = c.stock as Record<string, number>;
  for (const k of STOCK_FOODS) {
    const n = share(k, Math.floor(stock[k] ?? 0));
    if (n <= 0) continue;
    stock[k] -= n;
    out[k] = n;
    units += n;
  }
  withClan(c, () => {
    for (const id of Object.keys(SPOIL_CLASS) as ItemId[]) {
      if ((STOCK_FOODS as readonly string[]).includes(id)) continue;
      const n = share(id, itemCount(id));
      if (n <= 0) continue;
      takeItem(id, n);
      out[id] = n;
      units += n;
    }
  });
  a.spoiled = units;
  snapCache.delete(clanId);
  return out;
}

// ---- eating (colonists.ts applyDailyFoodConsumption, under the clan) ----
// After the grain / meat / fruit: the preserved foods (cheese, smoked / salted meat), the winter reserve. Returns the
// food units still needed.
export function eatPreservedFood(needed: number): number {
  for (const f of FOOD_ITEMS) {
    if (!f.preserved) continue;
    while (needed > 0 && itemCount(f.id) > 0) {
      takeItem(f.id, 1);
      needed -= f.food;
    }
  }
  return Math.max(0, needed);
}

// Ale: one mug per ALE_PEOPLE_PER_MUG people each dawn (poorest first; all of it when short).
export function drinkAle(people: number) {
  const have = itemCount("ale");
  if (have <= 0 || people <= 0) return;
  takeItem("ale", Math.min(have, Math.ceil(people / ALE_PEOPLE_PER_MUG)));
}
// Colony happiness from ale in store, by its best grade (0 with COLONY_UNLOCK_ALL).
export function aleHappinessBonus(): number {
  if (state.testUnlockAll || itemCount("ale") <= 0) return 0;
  const g = state.progress.items.ale ?? [];
  return ALE_HAPPINESS[g[2] > 0 ? 2 : g[1] > 0 ? 1 : 0];
}

// ---- sickness ----
// The dawn meal of the active clan: `eaten` food units, `rawMeat` of them raw meat from the stock. Ticks the sick list,
// makes new people sick by the day's risk and hurts every sick person. Off unless agriOn.
export function foodSickness(eaten: number, rawMeat: number) {
  if (!agriOn()) return;
  const a = agriOf();
  const people = clanPeople(state.clan.id);
  const alive = new Set(people.map((c) => c.id));
  for (const id of Object.keys(a.sick)) {
    const left = (a.sick[id] ?? 0) - 1;
    if (left <= 0 || !alive.has(id)) delete a.sick[id];
    else a.sick[id] = left;
  }
  const risk = foodRisk(eaten, rawMeat, a.spoiled);
  a.spoiled = 0;
  const target = Math.min(people.length, Math.round(people.length * risk));
  let sickNow = Object.keys(a.sick).length;
  let fresh = 0;
  for (const c of people.sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (sickNow >= target) break;
    if (a.sick[c.id] || c.person!.child) continue;
    a.sick[c.id] = SICK_DAYS;
    sickNow++;
    fresh++;
  }
  for (const c of people) {
    if (!a.sick[c.id]) continue;
    const floor = Math.ceil(c.maxHp * SICK_HP_FLOOR_FRAC);
    if (c.hp > floor) c.hp = Math.max(floor, c.hp - SICK_DAMAGE);
  }
  if (fresh > 0) broadcastEvent("death", `${fresh} ${fresh === 1 ? "person fell" : "people fell"} sick from bad food (${rawMeat > 0 ? "raw meat" : "spoiled stores"}). Smoke or salt the meat, keep the stores (pots, a Cellar, a storeroom), cook in a kitchen.`);
  snapCache.delete(state.clan.id);
}
// The share of people a day's meal makes sick (0..1).
export function foodRisk(eaten: number, rawMeat: number, spoiled: number): number {
  if (eaten <= 0) return 0;
  const raw = Math.min(1, rawMeat / eaten) * RAW_MEAT_SICK_RISK * (clanHasKitchen(state.clan.id) ? KITCHEN_RAW_MEAT_MULT : 1);
  const bad = Math.min(1, (spoiled * SPOILED_EATEN_SHARE) / eaten) * SPOILED_SICK_RISK;
  return Math.min(1, raw + bad);
}
function sickCount(clanId: number): { sick: number; people: number } {
  const a = clanById(clanId).progress.agri;
  const people = clanPeople(clanId);
  return { sick: a ? people.filter((c) => a.sick[c.id]).length : 0, people: people.length };
}
// Colony happiness: SICK_HAPPINESS x the share of the clan's people sick (colonists.ts).
export function sicknessPenalty(): number {
  if (!agriOn()) return 0;
  const { sick, people } = sickCount(state.clan.id);
  return people > 0 ? (SICK_HAPPINESS * sick) / people : 0;
}
export function isSick(c: Colonist): boolean {
  return !!clanById(clanOf(c)).progress.agri?.sick[c.id];
}

// ---- sourdough starter ----
function bakeryTended(clanId: number): boolean {
  for (const c of colonists.values()) {
    if (!c.person || clanOf(c) !== clanId || c.training || c.callUp || !inBounds(c.postX, c.postY)) continue;
    if (state.tiles[tileIndex(c.postX, c.postY)] === TileType.Bakery && clanIdAt(c.postX, c.postY) === clanId) return true;
  }
  return false;
}
function loseStarter(why: string) {
  const n = itemCount("sourdoughStarter");
  if (n <= 0) return;
  takeItem("sourdoughStarter", n);
  agriOf().untended = 0;
  snapCache.delete(state.clan.id);
  broadcastEvent("build", `The sourdough starter is lost: ${why}. A level-2 baker can culture a new one (about 3 days).`);
}
// A Bakery of the colony took damage (combat.ts damageBuilding): burning below BAKERY_FIRE_HP_FRAC of its HP, or
// destroyed, its clan's starter is lost.
export function bakeryBurned(tx: number, ty: number, hpFrac: number) {
  if (hpFrac > BAKERY_FIRE_HP_FRAC) return;
  withClan(clanById(clanIdAt(tx, ty)), () => loseStarter(hpFrac <= 0 ? "the Bakery was destroyed" : "the Bakery burned"));
}

// ---- daily (calendar.ts, each new calendar day with seasons on, under each clan) ----
export function agriDawn() {
  if (!agriOn()) return;
  const a = agriOf();
  if (itemCount("sourdoughStarter") <= 0 || bakeryTended(state.clan.id)) a.untended = 0;
  else if (++a.untended >= STARTER_UNTENDED_DAYS) loseStarter(`no baker tended the Bakery for ${STARTER_UNTENDED_DAYS} days`);
  snapCache.delete(state.clan.id);
}

// ---- iron plow ----
export function plowGrowthMult(clanId: number): number {
  return itemsOf(clanById(clanId), "ironPlow") > 0 ? IRON_PLOW_GROWTH_MULT : 1;
}
export function plowYieldMult(clanId: number): number {
  return itemsOf(clanById(clanId), "ironPlow") > 0 ? IRON_PLOW_YIELD_MULT : 1;
}

// ---- orchard years ----
// Tile index of an orchard (its post tile) -> the calendar day it was planted. Orchards with none are old.
const orchardPlanted = new Map<number, number>();
export function noteOrchardPlanted(tx: number, ty: number) {
  orchardPlanted.set(tileIndex(tx, ty), calendarDayNow());
}
// Full game years since planting (ORCHARD_LEGACY_AGE for an orchard with no planting day).
export function orchardAgeYears(tx: number, ty: number): number {
  const day = orchardPlanted.get(tileIndex(tx, ty));
  if (day === undefined) return ORCHARD_LEGACY_AGE;
  return Math.max(0, Math.floor((calendarDayNow() - day) / DAYS_PER_YEAR));
}
export function orchardYieldMult(tx: number, ty: number): number {
  if (!agriOn()) return 1;
  return ORCHARD_YIELD_BY_AGE[Math.min(ORCHARD_YIELD_BY_AGE.length - 1, orchardAgeYears(tx, ty))];
}
export function orchardsForSave(): [number, number][] {
  const out: [number, number][] = [];
  for (const [i, day] of orchardPlanted) if (state.tiles[i] === TileType.Orchard) out.push([i, day]);
  return out;
}
export function restoreOrchards(saved: unknown) {
  orchardPlanted.clear();
  if (!Array.isArray(saved)) return;
  for (const e of saved) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || typeof e[1] !== "number") continue;
    if (e[0] >= 0 && e[0] < state.tiles.length) orchardPlanted.set(e[0], e[1]);
  }
}
// Test hook: plant the orchard at (tx, ty) `daysAgo` calendar days ago.
export function setOrchardPlanted(tx: number, ty: number, daysAgo: number) {
  orchardPlanted.set(tileIndex(tx, ty), calendarDayNow() - daysAgo);
}

// ---- saves (progress.agri, via progression.ts) ----
export function agriForSave(a: AgriState | undefined): AgriState | undefined {
  if (!a) return undefined;
  return { untended: a.untended, spoiled: a.spoiled, sick: { ...a.sick }, carry: { ...a.carry } };
}
export function sanitizeAgri(raw: unknown): AgriState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const nums = (o: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    return out;
  };
  return { untended: Number(r.untended) || 0, spoiled: Number(r.spoiled) || 0, sick: nums(r.sick), carry: nums(r.carry) };
}
export function resetAgri() {
  orchardPlanted.clear();
  snapCache.clear();
}

// ---- building panel lines (progression.ts progressionInfo) ----
export function agriInfo(tx: number, ty: number, t: TileType): string[] {
  const clanId = clanIdAt(tx, ty);
  const lines: string[] = [];
  if (t === TileType.Cellar) {
    const lvl = Math.min(CELLAR_SPOIL_CUT.length, getBuildingLevel(tx, ty));
    lines.push(`Cellar level ${lvl}: food spoils ${Math.round(CELLAR_SPOIL_CUT[lvl - 1] * 100)}% slower (the clan's best Cellar counts)`);
  } else if (t === TileType.Orchard && agriOn()) {
    const age = orchardAgeYears(tx, ty);
    const next = age + 1 < ORCHARD_YIELD_BY_AGE.length ? `; x${ORCHARD_YIELD_BY_AGE[age + 1]} at ${age + 1} year${age + 1 === 1 ? "" : "s"}` : " (mature)";
    lines.push(`Orchard age: ${age} year${age === 1 ? "" : "s"}: fruit x${orchardYieldMult(tx, ty)}${next}`);
  } else if (t === TileType.Bakery) {
    const a = clanById(clanId).progress.agri;
    const kept = itemsOf(clanById(clanId), "sourdoughStarter") > 0;
    if (kept) lines.push(a && a.untended > 0 && agriOn() ? `Sourdough starter: untended ${a.untended} of ${STARTER_UNTENDED_DAYS} days (post a baker or it goes bad)` : "Sourdough starter: kept (bread)");
  } else if (t === TileType.BarnPost && plowYieldMult(clanId) > 1) {
    lines.push(`Iron plow: fields grow +${Math.round((IRON_PLOW_GROWTH_MULT - 1) * 100)}% faster, yield +${Math.round((IRON_PLOW_YIELD_MULT - 1) * 100)}%`);
  }
  return lines;
}

// ---- snapshot (per clan, seasons on, once a second by wall time) ----
const snapCache = new Map<number, { at: number; snap: AgriSnapshot }>();
export function agriSnapshot(): AgriSnapshot | undefined {
  if (!seasonsOn()) return undefined;
  const id = state.clan.id;
  const hit = snapCache.get(id);
  const now = Date.now();
  if (hit && now - hit.at < 1000) return hit.snap;
  const snap = buildAgriSnapshot(id);
  snapCache.set(id, { at: now, snap });
  return snap;
}
function buildAgriSnapshot(id: number): AgriSnapshot {
  const c = clanById(id);
  const keep = agriOn() ? spoilKeepMult(id) : 1;
  const a = c.progress.agri;
  const { sick, people } = sickCount(id);
  const starter = itemsOf(c, "sourdoughStarter") > 0 ? (a && a.untended > 0 && agriOn() ? a.untended : "kept") : "none";
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    raw: r3(SPOIL_PER_DAY.raw * keep), fresh: r3(SPOIL_PER_DAY.fresh * keep), dry: r3(SPOIL_PER_DAY.dry * keep),
    storeroom: r3(storeroomProtectionOf(id)), pots: r3(potSpoilCut(c)), cellar: r3(cellarSpoilCut(id)), cellarLevel: cellarLevelOf(id),
    spoiled: a?.spoiled ?? 0, sick, people, starter,
  };
}

// testHook "agri": the active clan's agriculture state.
export function agriDebug() {
  const id = state.clan.id;
  return {
    on: agriOn(),
    state: state.progress.agri ?? null,
    keep: spoilKeepMult(id),
    pots: potSpoilCut(state.clan),
    cellar: cellarSpoilCut(id),
    cellarLevel: cellarLevelOf(id),
    storeroom: storeroomProtectionOf(id),
    sickPenalty: sicknessPenalty(),
    ale: aleHappinessBonus(),
    plow: { growth: plowGrowthMult(id), yield: plowYieldMult(id) },
    orchards: Array.from(orchardPlanted, ([i, day]) => ({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X), day })),
    snapshot: seasonsOn() ? buildAgriSnapshot(id) : null,
    persons: clanPeople(id).map((c) => ({ id: c.id, hp: c.hp, maxHp: c.maxHp, sick: state.progress.agri?.sick[c.id] ?? 0 })),
  };
}
