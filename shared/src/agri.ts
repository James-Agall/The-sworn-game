// Agriculture extras (docs/colony2d/PLAN-agri-industry-winter-mines.md phase 5; ROADMAP "Agriculture extras —
// landed"). Shared by the server (server/src/agri.ts: spoilage, sickness, the sourdough starter, orchard ages, the
// iron plow, ale) and the client (the Colony panel's food-store row, tool texts). EVERY number of these features lives
// here (the new items / recipes / gates are in shared/src/progression.ts). The daily rules run at each calendar dawn,
// so with seasons off (COLONY_NO_SEASONS) they never run; under COLONY_UNLOCK_ALL (older suites) the new spoilage,
// sickness and orchard ages are off too.
import { TileType } from "./protocol.js";

// ---- spoilage (once a calendar day, per clan) ----
// Every food good belongs to a spoilage class; the class sets the share lost per day. No per-item timers: the share of
// the whole store goes off each dawn (stock goods floored, items with a carried remainder so small stores spoil too).
export type SpoilClass = "raw" | "fresh" | "dry" | "preserved";
export const SPOIL_PER_DAY: Record<SpoilClass, number> = { raw: 0.05, fresh: 0.03, dry: 0.01, preserved: 0 };
export const SPOIL_CLASS_LABEL: Record<SpoilClass, string> = { raw: "Raw", fresh: "Fresh", dry: "Dry", preserved: "Preserved" };
// Stock goods (state.stock keys) and items (ItemId) that spoil, by class. Anything not listed keeps.
export const SPOIL_CLASS: Record<string, SpoilClass> = {
  meat: "raw", milk: "raw",
  fruit: "fresh", egg: "fresh", bread: "fresh", flatbread: "fresh", gruel: "fresh",
  grain: "dry", flour: "dry", hops: "dry",
  cheese: "preserved", smokedMeat: "preserved", saltedMeat: "preserved", ale: "preserved",
};
// What keeps food (each cuts the day's share; they multiply): the storerooms' protection (shared/src/rooms.ts, as
// before), clay pots in store (POT_SPOIL_CUT_PER_POT each, up to POT_SPOIL_CUT_MAX) and the clan's best Cellar
// (CELLAR_SPOIL_CUT by its level).
export const POT_SPOIL_CUT_PER_POT = 0.02;
export const POT_SPOIL_CUT_MAX = 0.3;
export const CELLAR_SPOIL_CUT = [0.3, 0.45, 0.6];

// ---- food quality -> sickness (at each dawn's meal, seasons on) ----
// A share of the day's spoiled food is eaten anyway; raw meat eaten from the stock is risky (a kitchen room halves
// that: cooked). Sick people = round(people x min(1, rawMeatShare x RAW_MEAT_SICK_RISK x kitchen + spoiledShare x
// SPOILED_SICK_RISK)), where rawMeatShare = raw meat eaten / food eaten and spoiledShare = min(1, food spoiled at the
// last dawn x SPOILED_EATEN_SHARE / food eaten). Smoked / salted meat and cheese are safe.
export const RAW_MEAT_SICK_RISK = 0.2;
export const KITCHEN_RAW_MEAT_MULT = 0.5;
export const SPOILED_EATEN_SHARE = 0.5;
export const SPOILED_SICK_RISK = 0.6;
// A sick person: SICK_DAYS dawns, SICK_DAMAGE hp at each of them (never below SICK_HP_FLOOR_FRAC of max), and colony
// happiness loses up to SICK_HAPPINESS (x the share of the clan's people sick).
export const SICK_DAYS = 2;
export const SICK_DAMAGE = 10;
export const SICK_HP_FLOOR_FRAC = 0.3;
export const SICK_HAPPINESS = 12;

// ---- sourdough starter ----
// The starter lives at the Bakery: it goes bad after this many dawns in a row with no baker posted at any of the
// clan's Bakeries, and is lost when a Bakery burns (falls below BAKERY_FIRE_HP_FRAC of its HP) or is destroyed. A
// level-2 baker cultures a new one (the recipe in shared/src/progression.ts, ~3 days of work).
export const STARTER_UNTENDED_DAYS = 3;
export const BAKERY_FIRE_HP_FRAC = 0.5;

// ---- iron plow (a Blacksmith item, kept) ----
// In store: every farm field (growing zones and the old Barn plots) grows x IRON_PLOW_GROWTH_MULT faster and yields
// x IRON_PLOW_YIELD_MULT. The wooden plow stays the Barn's gate.
export const IRON_PLOW_GROWTH_MULT = 1.25;
export const IRON_PLOW_YIELD_MULT = 1.25;

// ---- orchard years ----
// A new Orchard is a sapling: its fruit batch is x ORCHARD_YIELD_BY_AGE[full game years since planting] (the last
// entry from then on). Orchards from older saves (no planting day) count as ORCHARD_LEGACY_AGE years old.
export const ORCHARD_YIELD_BY_AGE = [0.25, 0.6, 1, 1.2];
export const ORCHARD_LEGACY_AGE = 2;

// ---- hops and ale ----
// Hops: a growing-zone crop (summer to autumn, shared/src/calendar.ts); a harvested tile gives HOPS_PER_TILE hops
// straight into the stores. The Brewery's brewer turns hops + grain into ale (grades by tier as every station).
export const HOPS_PER_TILE = 2;
// Ale in store: colony happiness ALE_HAPPINESS[best grade - 1]; at each dawn the clan drinks one ale per
// ALE_PEOPLE_PER_MUG people (rounded up), poorest first.
export const ALE_HAPPINESS = [3, 5, 8];
export const ALE_PEOPLE_PER_MUG = 4;

// ---- stations ----
// A new Salt Works needs water (a pond / river Water tile or a dug Moat: brine to boil) within this many tiles.
export const SALT_WORKS_WATER_RADIUS_TILES = 2;
// Buildings of this feature (client building panel, server lists).
export const AGRI_STATION_TILES: readonly TileType[] = [TileType.SaltWorks, TileType.Smokehouse, TileType.Dairy];
export const AGRI_BUILDING_TILES: readonly TileType[] = [...AGRI_STATION_TILES, TileType.Cellar];

// Snapshot `agri` (the clan's; seasons on only; recomputed once a second).
export interface AgriSnapshot {
  // Effective daily spoilage of raw / fresh / dry food (fractions) after every protection.
  raw: number;
  fresh: number;
  dry: number;
  // The protections: storeroom share, pot cut, cellar cut and the best cellar's level (0: none).
  storeroom: number;
  pots: number;
  cellar: number;
  cellarLevel: number;
  // Food lost at the last dawn (units).
  spoiled: number;
  // People sick now / the clan's people.
  sick: number;
  people: number;
  // The sourdough starter: "none", "kept", or dawns untended so far (1..STARTER_UNTENDED_DAYS - 1).
  starter: "none" | "kept" | number;
}
