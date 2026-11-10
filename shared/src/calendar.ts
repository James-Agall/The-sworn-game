// Stardew phase 5b (2026-11-09, docs/colony2d/PLAN-rimworld-stardew.md): seasons, calendar and weather, shared by the
// server (server/src/calendar.ts: the authoritative clock, effects) and the client (calendar HUD, tints, weather
// overlay). EVERY seasonal / weather number lives here.
//
// The calendar sits on the existing game-day clock: calendar day = floor(cycleTick / GAME_DAY_TICKS) + the saved
// calendar offset (creative "set season / day" moves the offset; old saves have none, so their day count maps
// straight onto the calendar: day 1 = Spring 1, Year 1). A day starts at dawn. Weather is a pure function of the
// world salt and the calendar day (deterministic: a reload or a replay sees the same sky).
import type { CropId } from "./zones.js";

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];
export const SEASON_LABEL: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
// Days per season (a year is 4 x this).
export const DAYS_PER_SEASON = 7;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export interface CalendarDate {
  // Absolute calendar day (0 = Spring 1, Year 1).
  abs: number;
  year: number; // 1..
  season: number; // index into SEASONS
  day: number; // 1..DAYS_PER_SEASON
  dayOfYear: number; // 0..DAYS_PER_YEAR-1
}
export function calendarOf(absDay: number): CalendarDate {
  const abs = Math.max(0, Math.floor(absDay));
  const dayOfYear = abs % DAYS_PER_YEAR;
  return { abs, year: Math.floor(abs / DAYS_PER_YEAR) + 1, season: Math.floor(dayOfYear / DAYS_PER_SEASON), day: (dayOfYear % DAYS_PER_SEASON) + 1, dayOfYear };
}
// The absolute day of (year, season index, day of season 1..).
export function absDayOf(year: number, season: number, day: number): number {
  return (Math.max(1, year) - 1) * DAYS_PER_YEAR + Math.max(0, Math.min(3, season)) * DAYS_PER_SEASON + Math.max(1, Math.min(DAYS_PER_SEASON, day)) - 1;
}
export const WINTER = 3;
export function calendarLabel(d: { season: number; day: number; year: number }): string {
  return `${SEASON_LABEL[SEASONS[d.season]]} ${d.day}, Year ${d.year}`;
}

// ---- crops: growing seasons (in season units: 0 = Spring 1 .. 4 = end of Winter; [from, to)) ----
// Out of season a crop stops growing (it keeps its progress); winter stops every outdoor crop. A crop tile in a
// roofed room (greenhouse rule) grows in any season at GREENHOUSE_GROWTH_MULT, is never frost-killed and is not
// watered by rain.
export const CROP_SEASONS: Record<CropId, { from: number; to: number }> = {
  wheat: { from: 0, to: 2.5 }, // spring, summer, the first half of autumn
  hemp: { from: 1, to: 2 }, // summer
};
export const GREENHOUSE_GROWTH_MULT = 0.5;
export function cropInSeason(crop: CropId, dayOfYear: number): boolean {
  const s = dayOfYear / DAYS_PER_SEASON;
  const r = CROP_SEASONS[crop];
  return s >= r.from && s < r.to;
}
export function cropSeasonLabel(crop: CropId): string {
  const r = CROP_SEASONS[crop];
  const name = (s: number) => SEASON_LABEL[SEASONS[Math.floor(s) % 4]];
  const part = (s: number) => (s % 1 === 0.5 ? `mid-${name(s).toLowerCase()}` : name(s));
  return r.to - r.from <= 1 && r.from % 1 === 0 ? name(r.from) : `${part(r.from)} to ${r.to % 1 === 0 ? `end of ${name(r.to - 1).toLowerCase()}` : part(r.to)}`;
}
// Watering resets every dawn (a new calendar day): the hero / villagers water again, or rain does.
export const CROP_WATER_RESETS_DAILY = true;
// Orchards bear fruit (their farmhand's cycle runs) only in these seasons; the old Hemp Field farm stops in winter.
export const ORCHARD_FRUIT_SEASONS: readonly number[] = [1, 2];

// ---- weather (one spell per day: a kind and when it runs, as fractions of the whole game day from dawn) ----
export type WeatherKind = "clear" | "rain" | "storm" | "snow" | "fog";
export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "rain", "storm", "snow", "fog"];
export const WEATHER_LABEL: Record<WeatherKind, string> = { clear: "Clear", rain: "Rain", storm: "Storm", snow: "Snow", fog: "Fog" };
// Odds of the day's weather per season (normalised; clear = no spell that day).
export const WEATHER_WEIGHTS: Record<Season, Partial<Record<WeatherKind, number>>> = {
  spring: { clear: 0.5, rain: 0.3, storm: 0.08, fog: 0.12 },
  summer: { clear: 0.65, rain: 0.15, storm: 0.15, fog: 0.05 },
  autumn: { clear: 0.45, rain: 0.3, storm: 0.1, fog: 0.15 },
  winter: { clear: 0.45, snow: 0.4, fog: 0.15 },
};
// A spell starts in [0, WEATHER_LATEST_START) of the day and lasts WEATHER_MIN_LEN..WEATHER_MAX_LEN of it; fog is a
// morning spell (from dawn, FOG_MIN_LEN..FOG_MAX_LEN).
export const WEATHER_LATEST_START = 0.5;
export const WEATHER_MIN_LEN = 0.25;
export const WEATHER_MAX_LEN = 0.6;
export const FOG_MIN_LEN = 0.15;
export const FOG_MAX_LEN = 0.35;
// Year 1, Spring 1 is always clear (a new game opens in sunshine).
export const WEATHER_FIRST_DAY_CLEAR = true;
// Kinds that water every unroofed crop tile while they last (for the rest of that day).
export const WATERING_WEATHER: readonly WeatherKind[] = ["rain", "storm"];

export interface DayWeather {
  kind: WeatherKind;
  from: number;
  to: number;
}
function hash32(...keys: number[]): () => number {
  let h = 0x2545f491;
  for (const k of keys) {
    h = Math.imul(h ^ (k | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The day's weather spell from the world salt and the absolute calendar day.
export function weatherForDay(salt: number, absDay: number): DayWeather {
  if (WEATHER_FIRST_DAY_CLEAR && absDay === 0) return { kind: "clear", from: 0, to: 0 };
  const rng = hash32(salt, absDay, 0x5ea5);
  const weights = WEATHER_WEIGHTS[SEASONS[calendarOf(absDay).season]];
  const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  let roll = rng() * total;
  let kind: WeatherKind = "clear";
  for (const [k, w] of Object.entries(weights) as [WeatherKind, number][]) {
    if ((roll -= w) < 0) {
      kind = k;
      break;
    }
  }
  if (kind === "clear") return { kind, from: 0, to: 0 };
  if (kind === "fog") return { kind, from: 0, to: FOG_MIN_LEN + rng() * (FOG_MAX_LEN - FOG_MIN_LEN) };
  const from = rng() * WEATHER_LATEST_START;
  return { kind, from, to: Math.min(1, from + WEATHER_MIN_LEN + rng() * (WEATHER_MAX_LEN - WEATHER_MIN_LEN)) };
}
// The weather at `frac` (0..1) through the day.
export function weatherAt(salt: number, absDay: number, frac: number): WeatherKind {
  const w = weatherForDay(salt, absDay);
  return frac >= w.from && frac < w.to ? w.kind : "clear";
}

// ---- winter cold (mild: no deaths) ----
// A room counts as warm at this warmth stat (shared/src/rooms.ts; 0-100).
export const ROOM_WARM_THRESHOLD = 50;
// Winter nights: colony happiness loses up to this many points (x the share of the clan's people whose home bed is
// not in a warm room); the bedroom sleep bonus counts x WINTER_ROOM_HAPPINESS_MULT all winter.
export const WINTER_COLD_HAPPINESS = 6;
export const WINTER_ROOM_HAPPINESS_MULT = 1.5;
// The hero at a winter night, not inside a warm room and with no shelter (campfire / lean-to / home): rest drains
// x WINTER_COLD_REST_DECAY_MULT and resting recovers x WINTER_COLD_REST_GAIN_MULT; resting in a warm room in winter
// recovers x WINTER_WARM_ROOM_REST_MULT.
export const WINTER_COLD_REST_DECAY_MULT = 1.5;
export const WINTER_COLD_REST_GAIN_MULT = 0.5;
export const WINTER_WARM_ROOM_REST_MULT = 1.25;
// Wild forage (berry bushes, fruit trees) regrows this much slower in winter. Hunting unchanged.
// Phase 6 balance (2026-11-10): was "no regrowth at all" (0): a colony living on its Forager's Hut ran out of fruit in
// the first winter's 5th day; a quarter keeps a trickle so a lean winter is not a starving one.
export const WINTER_FORAGE_REGROW_MULT = 0.25;

// ---- client look ----
// Multiply tints per season for the grass floor / scatter and for trees.
export const SEASON_GROUND_TINT: Record<Season, number> = { spring: 0xf2ffe6, summer: 0xffffff, autumn: 0xf2d9a6, winter: 0xdde6f2 };
export const SEASON_TREE_TINT: Record<Season, number> = { spring: 0xf4ffea, summer: 0xffffff, autumn: 0xffc87a, winter: 0xd2dce8 };
// Weather overlay (screen space): particle caps per kind, fog alpha, storm flash odds per second.
export const WEATHER_RAIN_DROPS = 160;
export const WEATHER_STORM_DROPS = 240;
export const WEATHER_SNOW_FLAKES = 140;
export const WEATHER_FOG_ALPHA = 0.28;
export const WEATHER_STORM_FLASH_PER_S = 0.12;

// Snapshot `calendar` (every snapshot; a few bytes).
export interface CalendarSnapshot {
  year: number;
  season: number;
  day: number;
  weather: WeatherKind;
  daysPerSeason: number;
  // Seasons off (test suites written before 5b): no effects, the HUD still shows the date.
  off?: boolean;
}
