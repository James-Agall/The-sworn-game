// Winter: heating fuel and clothing (docs/colony2d/PLAN-agri-industry-winter-mines.md phase 4; ROADMAP "Winter —
// landed"). Shared by the server (server/src/winter.ts: the daily burn, cold homes, wardrobes, cold exposure) and the
// client (the Colony panel's fuel / clothes row, the person card). EVERY winter number lives here. With seasons off
// (COLONY_NO_SEASONS) none of it runs.
import { TileType } from "./protocol.js";

// ---- heating ----
// A cold day is a winter day (the season index of shared/src/calendar.ts WINTER): from Winter 1 to the last day
// before Spring, every occupied home burns fuel at dawn.
// Heat a unit of fuel gives (heat units). Coal burns twice as hot as wood; charcoal too.
export type FuelId = "wood" | "coal" | "charcoal";
export const FUEL_HEAT: Record<FuelId, number> = { wood: 1, coal: 2, charcoal: 2 };
// Burned first to last: coal (little else uses it), then wood, then charcoal (kept for smelting while wood lasts).
export const FUEL_ORDER: readonly FuelId[] = ["coal", "wood", "charcoal"];
export const FUEL_LABEL: Record<FuelId, string> = { wood: "Wood", coal: "Coal", charcoal: "Charcoal" };
// Heat a home burns per cold day, by its building (bigger houses cost more). A bed in a room is heated as its room.
export const HOME_HEAT_PER_DAY: Partial<Record<TileType, number>> = {
  [TileType.House]: 1,
  [TileType.BigHouse]: 2,
  [TileType.HouseLevel2]: 3,
  [TileType.TownCenter]: 2,
  [TileType.Keep]: 3,
};
// A room with beds: ROOM_HEAT_BASE + 1 per ROOM_HEAT_TILES_PER_EXTRA floor tiles; a room with a hearth keeps the
// heat in and burns x HEARTH_HEAT_MULT.
export const ROOM_HEAT_BASE = 1;
export const ROOM_HEAT_TILES_PER_EXTRA = 16;
export const HEARTH_HEAT_MULT = 0.5;
// A heated home warms the ground around it (Chebyshev tiles): nobody there counts as out in the cold. A hearth in a
// heated room reaches further; Home area tiles within HOME_ZONE_HEAT_RADIUS_TILES of a heated home are warm too.
export const HOME_HEAT_RADIUS_TILES = 2;
export const HEARTH_HEAT_RADIUS_TILES = 3;
export const HOME_ZONE_HEAT_RADIUS_TILES = 6;
// A cold home (no fuel for it today, or no home at all): colony happiness loses up to COLD_HOME_HAPPINESS points
// (x the share of the clan's people in cold homes, all day); each of them loses COLD_HOME_DAMAGE hp at dawn and works
// x COLD_HOME_WORK_MULT (a poor night's rest). The hero resting in a cold house recovers x COLD_HOME_REST_GAIN_MULT.
export const COLD_HOME_HAPPINESS = 10;
export const COLD_HOME_DAMAGE = 8;
export const COLD_HOME_WORK_MULT = 0.85;
export const COLD_HOME_REST_GAIN_MULT = 0.5;
// Cold never takes anyone below this share of their max hp (a hard winter hurts, it does not kill).
export const COLD_HP_FLOOR_FRAC = 0.3;
// The Colony panel calls the fuel low below this many days of burn.
export const FUEL_LOW_DAYS = 3;

// ---- clothing ----
// Garments the Tailor sews (items in shared/src/progression.ts). Worn ones live in a person's wardrobe, one per slot.
export type GarmentId = "tunic" | "coat" | "boots";
// Priority order: what a cold person takes first.
export const GARMENTS: readonly GarmentId[] = ["coat", "boots", "tunic"];
export const GARMENT_LABEL: Record<GarmentId, string> = { tunic: "Wool tunic", coat: "Winter coat", boots: "Boots" };
// Warmth of each garment; WARM_CLOTHES_MIN or more = dressed for the cold (a coat alone, or a tunic and boots).
export const GARMENT_WARMTH: Record<GarmentId, number> = { tunic: 1, coat: 2, boots: 1 };
export const WARM_CLOTHES_MIN = 2;
// A Poor garment lasts GARMENT_LIFE_DAYS days of wear (x GARMENT_GRADE_LIFE_MULT by grade); winter days wear it
// x WINTER_WEAR_MULT.
export const GARMENT_LIFE_DAYS = 56;
export const GARMENT_GRADE_LIFE_MULT = [1, 1.5, 2];
export const WINTER_WEAR_MULT = 2;
// Out in the cold (a winter day, outdoors: not in a roofed room, an interior or a shelter, and not near a heated home)
// without warm clothes: work x COLD_WORK_MULT, move x COLD_SPEED_MULT, and COLD_DAMAGE hp every COLD_DAMAGE_EVERY_S
// seconds (down to COLD_HP_FLOOR_FRAC). The hero too.
export const COLD_WORK_MULT = 0.6;
export const COLD_SPEED_MULT = 0.85;
export const COLD_DAMAGE = 1;
export const COLD_DAMAGE_EVERY_S = 20;
// People fetch missing garments from the clan's stores every this many seconds (and at dawn).
export const WARDROBE_CHECK_EVERY_S = 5;

export interface WornGarment {
  // Quality grade 1-3 and condition 1 (new) .. 0 (worn out: thrown away).
  grade: number;
  cond: number;
}
export type Wardrobe = Partial<Record<GarmentId, WornGarment>>;

export function wardrobeWarmth(w: Wardrobe | undefined): number {
  let n = 0;
  for (const g of GARMENTS) if (w?.[g]) n += GARMENT_WARMTH[g];
  return n;
}
export function warmlyDressed(w: Wardrobe | undefined): boolean {
  return wardrobeWarmth(w) >= WARM_CLOTHES_MIN;
}
// Condition lost per day of wear.
export function garmentWearPerDay(grade: number, winter: boolean): number {
  const g = Math.min(3, Math.max(1, Math.round(grade)));
  return (winter ? WINTER_WEAR_MULT : 1) / (GARMENT_LIFE_DAYS * GARMENT_GRADE_LIFE_MULT[g - 1]);
}
// "Winter coat (Good, 80%), Boots (Poor, 35%)" / "nothing warm".
export function wardrobeText(w: Wardrobe | undefined): string {
  const grade = ["Poor", "Good", "Fine"];
  const parts = GARMENTS.filter((g) => w?.[g]).map((g) => `${GARMENT_LABEL[g]} (${grade[w![g]!.grade - 1] ?? "Poor"}, ${Math.round(100 * w![g]!.cond)}%)`);
  return parts.length ? parts.join(", ") : "nothing warm";
}
// A wardrobe from untrusted saved data (undefined: none / malformed).
export function sanitizeWardrobe(raw: unknown): Wardrobe | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Wardrobe = {};
  for (const g of GARMENTS) {
    const v = (raw as Record<string, unknown>)[g] as Record<string, unknown> | undefined;
    if (!v || typeof v.grade !== "number" || typeof v.cond !== "number" || !Number.isFinite(v.cond) || v.cond <= 0) continue;
    out[g] = { grade: Math.min(3, Math.max(1, Math.round(v.grade))), cond: Math.min(1, v.cond) };
  }
  return Object.keys(out).length ? out : undefined;
}

// Snapshot `winter` (the clan's; seasons on only; recomputed once a second).
export interface WinterSnapshot {
  // Heat units in store (wood + coal / charcoal x their heat) and the heat the clan's occupied homes burn per cold day.
  heat: number;
  burn: number;
  // Cold days the store lasts at that burn (null: nothing burns).
  days: number | null;
  homes: number;
  // Today's cold homes and the people in them (winter only).
  coldHomes: number;
  coldPeople: number;
  // People without warm clothes, and garments in store.
  needClothes: number;
  people: number;
  garments: number;
  // It is a cold day (winter) now.
  cold: boolean;
  // Autumn (or winter) shortfall text: "Winter needs: 40 more fuel, 3 warm clothes".
  warning?: string;
}
