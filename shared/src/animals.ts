// Stardew phase 5d (2026-11-10, docs PLAN-rimworld-stardew.md): livestock living in buildings. EVERY animal number is
// here (the server's server/src/animals.ts simulates, the client draws and labels from the same table).
//
// Animal houses: Chicken Coop (chickens), Livestock Barn (cows, horses; not the farming Barn), Pig Sty (pigs), Sheep Pen
// (sheep) and the existing cavalry Stables (horses). Each holds HOUSE_CAPACITY[kind][level - 1] animals, a feeder (feed
// units: hay / grain from the clan stores) and a water trough. Animals are persistent records (species, sex, age, fed,
// watered, happiness, health, product timer). Once per calendar day (dawn of the 28-day calendar) every animal eats and
// drinks from its house, its happiness / health move, adults make their product (eggs, milk, wool) into the house, pairs
// may breed. Workers (work type "animals": the house's Animal Keeper post, free villagers by priority) refill the feeder
// and trough and collect the products; the hero does it with E at the house. Slaughter (adults only) gives meat + hide.
import { TileType } from "./protocol.js";

export type Species = "chicken" | "cow" | "pig" | "sheep" | "horse";
// Index = the species code in the snapshot's flattened `livestock.a` list.
export const SPECIES: readonly Species[] = ["chicken", "cow", "pig", "sheep", "horse"];
export const SPECIES_LABEL: Record<Species, string> = { chicken: "Chicken", cow: "Cow", pig: "Pig", sheep: "Sheep", horse: "Horse" };
export const SEX_LABEL: Record<Species, [female: string, male: string]> = {
  chicken: ["Hen", "Rooster"], cow: ["Cow", "Bull"], pig: ["Sow", "Boar"], sheep: ["Ewe", "Ram"], horse: ["Mare", "Stallion"],
};
export const BABY_LABEL: Record<Species, string> = { chicken: "Chick", cow: "Calf", pig: "Piglet", sheep: "Lamb", horse: "Foal" };

export type HouseKind = "coop" | "barn" | "sty" | "pen" | "stable";
export const HOUSE_KINDS: readonly HouseKind[] = ["coop", "barn", "sty", "pen", "stable"];
export const HOUSE_TILE: Record<HouseKind, TileType> = {
  coop: TileType.ChickenCoop, barn: TileType.LivestockBarn, sty: TileType.PigSty, pen: TileType.SheepPen, stable: TileType.Stables,
};
export const HOUSE_LABEL: Record<HouseKind, string> = {
  coop: "Chicken Coop", barn: "Livestock Barn", sty: "Pig Sty", pen: "Sheep Pen", stable: "Stables",
};
export function houseKindOfTile(t: number): HouseKind | undefined {
  for (const k of HOUSE_KINDS) if (HOUSE_TILE[k] === t) return k;
  return undefined;
}
// The new (5d) buildings; the Stables is the cavalry building that also stables horses.
export const NEW_ANIMAL_HOUSE_TILES: readonly TileType[] = [TileType.ChickenCoop, TileType.LivestockBarn, TileType.PigSty, TileType.SheepPen];
export const HOUSE_SPECIES: Record<HouseKind, readonly Species[]> = {
  coop: ["chicken"], barn: ["cow", "horse"], sty: ["pig"], pen: ["sheep"], stable: ["horse"],
};
// Animals per building level 1 / 2 / 3.
export const HOUSE_CAPACITY: Record<HouseKind, readonly number[]> = {
  coop: [4, 8, 12], barn: [4, 8, 12], sty: [4, 6, 8], pen: [4, 8, 12], stable: [2, 4, 6],
};
export function houseCapacity(kind: HouseKind, level: number): number {
  const caps = HOUSE_CAPACITY[kind];
  return caps[Math.min(Math.max(level, 1), caps.length) - 1];
}

// ---- buying / taming ----
// "Buy animals" in the building panel (gold from the clan stores).
export const ANIMAL_PRICE_GOLD: Record<Species, number> = { chicken: 15, cow: 60, pig: 35, sheep: 40, horse: 80 };
// Taming: the hero presses E within TAME_RANGE_TILES of a wild animal of this kind, with TAME_FOOD of the food in the
// stores, and an own house with room for the species within TAME_HOUSE_RANGE_TILES: the wild animal joins the house.
export const TAME_WILD: Partial<Record<string, { species: Species; food: "grain" | "fruit"; amount: number }>> = {
  boar: { species: "pig", food: "fruit", amount: 5 },
  pheasant: { species: "chicken", food: "grain", amount: 3 },
};
export const TAME_RANGE_TILES = 2;
export const TAME_HOUSE_RANGE_TILES = 30;

// ---- age ----
// Calendar days from birth to adult (a bought animal is adult).
export const ADULT_AGE_DAYS: Record<Species, number> = { chicken: 3, cow: 7, pig: 5, sheep: 5, horse: 7 };

// ---- feed and water (per animal per calendar day) ----
export const FEED_PER_DAY: Record<Species, number> = { chicken: 0.5, cow: 2, pig: 1.5, sheep: 1, horse: 2 };
export const WATER_PER_DAY: Record<Species, number> = { chicken: 0.5, cow: 2, pig: 1.5, sheep: 1, horse: 2 };
// A baby eats / drinks this share.
export const BABY_NEEDS_MULT = 0.5;
// Feed units per stores item (hay first; grain only above the people's reserve).
export const HAY_FEED_UNITS = 2;
export const GRAIN_FEED_UNITS = 1;
export const GRAIN_FEED_RESERVE = 20;
// The feeder / trough hold FEEDER_DAYS days of a full house's need.
export const FEEDER_DAYS = 3;
// Workers refill the feeder / trough when it falls under this share of its capacity.
export const REFILL_BELOW = 0.6;
// A trough within TROUGH_WATER_RANGE_TILES of a Water (river / pond) or Moat tile fills itself every day.
export const TROUGH_WATER_RANGE_TILES = 6;
// Hay: every wheat harvest (growing zone or hero plot) leaves this much straw / hay as a by-product.
export const HAY_PER_WHEAT_HARVEST = 1;

// ---- seasons (Stardew phase 5b calendar) ----
// Winter: animals stay indoors (no grazing), eat more, produce less, do not breed.
export const WINTER_FEED_MULT = 1.5;
export const WINTER_PRODUCT_MULT = 0.5;
export const BREEDS_IN_WINTER = false;
// Spring - autumn with an own Animal area zone tile within ANIMAL_AREA_RANGE_TILES of the house: the animals graze
// there and need GRAZE_FEED_SHARE less feed.
export const ANIMAL_AREA_RANGE_TILES = 12;
export const GRAZE_FEED_SHARE = 0.5;

// ---- happiness and health (0-100) ----
// Daily target = 100 x (fed x W_FED + watered x W_WATER + room x W_ROOM + outdoors x W_OUT); happiness moves
// HAPPINESS_STEP of the way there each day. room = 1 - fill x ROOM_CROWD_PENALTY; outdoors = 1 grazing an Animal area,
// OUTDOORS_NO_AREA without one, OUTDOORS_WINTER in winter.
export const HAPPINESS_W_FED = 0.4;
export const HAPPINESS_W_WATER = 0.3;
export const HAPPINESS_W_ROOM = 0.15;
export const HAPPINESS_W_OUT = 0.15;
export const ROOM_CROWD_PENALTY = 0.3;
export const OUTDOORS_NO_AREA = 0.5;
export const OUTDOORS_WINTER = 0.6;
export const HAPPINESS_STEP = 0.5;
export const START_HAPPINESS = 60;
// Fed / watered below NEED_OK: health loses HEALTH_LOSS_PER_NEED per unmet need a day; else regains HEALTH_REGEN.
// Health 0 = the animal dies. Below SICK_HEALTH it shows as sick and makes nothing.
export const NEED_OK = 0.5;
export const HEALTH_LOSS_PER_NEED = 20;
export const HEALTH_REGEN = 10;
export const SICK_HEALTH = 50;
// HUD flags: happy at or above HAPPY_FLAG.
export const HAPPY_FLAG = 80;

// ---- products ----
export type ProductId = "egg" | "milk" | "wool";
export const PRODUCTS: readonly ProductId[] = ["egg", "milk", "wool"];
export const PRODUCT_LABEL: Record<ProductId, string> = { egg: "Eggs", milk: "Milk", wool: "Wool" };
// Adults of a species make `amount` of `product` every `days` calendar days (pigs and horses: nothing); femaleOnly:
// hens lay, cows give milk (roosters / bulls make nothing), every sheep is shorn.
export const PRODUCT_OF: Partial<Record<Species, { product: ProductId; days: number; amount: number; femaleOnly: boolean }>> = {
  chicken: { product: "egg", days: 1, amount: 1, femaleOnly: true },
  cow: { product: "milk", days: 1, amount: 1, femaleOnly: true },
  sheep: { product: "wool", days: 3, amount: 3, femaleOnly: false },
};
// Nothing below PRODUCT_MIN_HAPPINESS; x PRODUCT_HAPPY_MULT at HAPPY_FLAG and up (a fraction carries to the next day).
export const PRODUCT_MIN_HAPPINESS = 25;
export const PRODUCT_HAPPY_MULT = 1.5;
// Quality grade 1-3 of eggs / milk: +1 at QUALITY_HAPPINESS_2, +1 more at QUALITY_HAPPINESS_3 with a collector of
// animals skill QUALITY_SKILL_3 or better.
export const QUALITY_HAPPINESS_2 = 60;
export const QUALITY_HAPPINESS_3 = 85;
export const QUALITY_SKILL_3 = 2;
// Products waiting in a house past this many are lost (nobody collected for days).
export const PRODUCTS_WAITING_CAP = 60;

// ---- slaughter (adults only) ----
export const SLAUGHTER_YIELD: Record<Species, { meat: number; hide: number }> = {
  chicken: { meat: 4, hide: 0 }, cow: { meat: 40, hide: 2 }, pig: { meat: 60, hide: 0 }, sheep: { meat: 25, hide: 1 }, horse: { meat: 30, hide: 2 },
};

// ---- breeding ----
// Per house per species per day: an adult male and female, both with happiness >= BREED_MIN_HAPPINESS and fed >=
// BREED_MIN_FED, room left: a baby with this chance.
export const BREED_CHANCE: Record<Species, number> = { chicken: 0.35, cow: 0.12, pig: 0.25, sheep: 0.15, horse: 0.1 };
export const BREED_MIN_HAPPINESS = 60;
export const BREED_MIN_FED = 0.9;

// ---- work (work type "animals") ----
// One chore (refill feeder, refill trough, collect) takes this many seconds x skill speed.
export const ANIMAL_CHORE_SECONDS = 4;
// Free villagers walk to houses within this range (tiles) of where they stand.
export const ANIMAL_JOB_RANGE_TILES = 40;
// The hero's E reaches an own house within this range (tiles from the building tile).
export const ANIMAL_HERO_RANGE_TILES = 2;
// Daily catch-up after a long pause / jump: at most this many missed days are simulated.
export const ANIMAL_CATCHUP_MAX_DAYS = 7;

// ---- wandering (cosmetic; server positions, only in ACTIVE chunks) ----
export const ANIMAL_SPEED: Record<Species, number> = { chicken: 22, cow: 16, pig: 18, sheep: 18, horse: 26 };
export const ANIMAL_WANDER_TILES = 3;
export const ANIMAL_REST_SECONDS_MIN = 2;
export const ANIMAL_REST_SECONDS_MAX = 7;
export const RENAME_MAX_CHARS = 20;

// ---- snapshot ----
// Per player `livestock` {a, h}: a = flattened LIVESTOCK_STRIDE numbers per animal outdoors: [id, species code, x, y,
// flags]; h = flattened [tile index, house flags] for the player's clan's houses.
export const LIVESTOCK_STRIDE = 5;
export const LF_BABY = 1;
export const LF_MALE = 2;
export const LF_MOVING = 4;
export const LF_HUNGRY = 8;
export const LF_THIRSTY = 16;
export const LF_SICK = 32;
export const LF_HAPPY = 64;
export const HOUSE_STRIDE = 2;
export const HF_FEED_LOW = 1;
export const HF_WATER_LOW = 2;
export const HF_PRODUCTS = 4;
export const HF_ANIMALS = 8;
export interface LivestockSnapshot {
  a: number[];
  h: number[];
}

// BuildingInfo.animals: the house panel.
export interface AnimalHouseInfo {
  kind: HouseKind;
  capacity: number;
  animals: {
    id: number; species: Species; label: string; name: string; baby: boolean; male: boolean; ageDays: number;
    fed: number; watered: number; happiness: number; health: number; product: string;
  }[];
  feed: number;
  feedCap: number;
  water: number;
  waterCap: number;
  autoWater: boolean;
  grazing: boolean;
  winter: boolean;
  waiting: string;
  today: string;
  keeper: string;
  buy: { species: Species; male: boolean; label: string; gold: number; ok: boolean; reason: string }[];
  notes: string[];
}
