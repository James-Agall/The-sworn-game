// Food days (DESIGN-REVIEW-nov20 gap G-B): how many game days the clan's food stock lasts at the dawn meal. Shared by
// the server (colonists.ts foodSnapshot, the "Food is low" event) and the client (the Colony panel's food row). Every
// number lives here. Spoilage and preserved / cooked foods (bread, salted meat ...) are NOT counted: grain + meat + fruit
// only, the stock the dawn meal eats from first.
// The Colony panel turns amber below FOOD_LOW_DAYS days and red below FOOD_CRITICAL_DAYS; the server fires one "Food is
// low" toast per game day (at the dawn meal) below FOOD_LOW_DAYS.
export const FOOD_LOW_DAYS = 3;
export const FOOD_CRITICAL_DAYS = 1;

export interface FoodSnapshot {
  // Grain + meat + fruit in store.
  stock: number;
  // Food the clan's eaters need at the dawn meal (ceil(eaters x the per-colonist upkeep)).
  perDay: number;
  // Days the stock covers (stock / perDay, rounded down to 0.1); null when nobody eats.
  days: number | null;
  // Change in stock since the last dawn meal's end (what was produced since; the meal itself is not counted).
  trend: number;
}

export function foodDays(stock: number, perDay: number): number | null {
  return perDay > 0 ? Math.floor((Math.max(0, stock) / perDay) * 10) / 10 : null;
}
// "ok" | "low" (amber) | "critical" (red) for the row's colour.
export function foodLevel(days: number | null): "ok" | "low" | "critical" {
  if (days === null || days >= FOOD_LOW_DAYS) return "ok";
  return days < FOOD_CRITICAL_DAYS ? "critical" : "low";
}
