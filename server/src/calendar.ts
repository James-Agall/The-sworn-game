// calendar.ts: Stardew phase 5b (2026-11-09): the server-authoritative calendar and weather (numbers and pure rules:
// shared/src/calendar.ts). Calendar day = floor(cycleTick / GAME_DAY_TICKS) + state.calendarOffset; the weather is
// rolled per day from the world salt (or a creative override for one day). updateCalendar (sim.ts, every tick) spots a
// new calendar day: watering resets, and the first day of winter brings the frost (zones.ts frostCrops). The effects
// read seasonsOn() / winterNow() / rainingNow() / cropGrowthMult(); with state.seasonsOff (older test suites) every
// effect is off and only the date / weather are shown.
import {
  CROP_WATER_RESETS_DAILY, DAYS_PER_SEASON, WINTER_FORAGE_REGROW_MULT, SEASON_LABEL, SEASONS, WATERING_WEATHER, WEATHER_KINDS, WINTER, absDayOf, calendarOf,
  cropInSeason, GREENHOUSE_GROWTH_MULT, ORCHARD_FRUIT_SEASONS, weatherAt, type CalendarDate, type CalendarSnapshot, type WeatherKind,
} from "@colony/shared/calendar";
import type { CropId } from "@colony/shared/zones";
import { GAME_DAY_TICKS } from "./constants.js";
import { TICK_RATE } from "@colony/shared/protocol";
import { state } from "./state.js";
import { broadcastEvent } from "./net.js";
import { frostCrops, resetCropWatering } from "./zones.js";
import { setSnowSlow } from "./tiles.js";
import { spoilFood } from "./structures.js";
import { clans } from "./state.js";

export function seasonsOn(): boolean {
  return !state.seasonsOff;
}
export function calendarDayNow(): number {
  return Math.floor(state.cycleTick / GAME_DAY_TICKS) + state.calendarOffset;
}
export function calendarNow(): CalendarDate {
  return calendarOf(calendarDayNow());
}
export function winterNow(): boolean {
  return seasonsOn() && calendarNow().season === WINTER;
}
export function weatherNow(): WeatherKind {
  const day = calendarDayNow();
  const o = state.weatherOverride;
  if (o && o.day === day && (WEATHER_KINDS as readonly string[]).includes(o.kind)) return o.kind as WeatherKind;
  return weatherAt(state.worldNoiseSalt, day, (state.cycleTick % GAME_DAY_TICKS) / GAME_DAY_TICKS);
}
// Rain / storm right now (waters unroofed crops; zones.ts once a second).
export function rainingNow(): boolean {
  return seasonsOn() && WATERING_WEATHER.includes(weatherNow());
}
// Growth speed factor of a crop tile from the season: 1 in season, 0 out of season or in winter; roofed (greenhouse)
// GREENHOUSE_GROWTH_MULT in any season.
export function cropGrowthMult(crop: CropId, roofed: boolean): number {
  if (!seasonsOn()) return 1;
  if (roofed) return GREENHOUSE_GROWTH_MULT;
  const d = calendarNow();
  return d.season !== WINTER && cropInSeason(crop, d.dayOfYear) ? 1 : 0;
}
// Orchards bear fruit only in ORCHARD_FRUIT_SEASONS (old Hemp Fields stop in winter).
export function orchardFruitsNow(): boolean {
  return !seasonsOn() || ORCHARD_FRUIT_SEASONS.includes(calendarNow().season);
}

export function calendarSnapshot(): CalendarSnapshot {
  const d = calendarNow();
  return { year: d.year, season: d.season, day: d.day, weather: weatherNow(), daysPerSeason: DAYS_PER_SEASON, ...(state.seasonsOff ? { off: true } : {}) };
}

// Gap closure G4: how many forage regrowth ticks pass in cycle ticks [from, to): winter days count
// x WINTER_FORAGE_REGROW_MULT (wildlife.ts updateForageRegrow's rate), the rest in full; seasons off: all of it.
// A COLD chunk's catch-up (abstract.ts wakeChunk) uses it.
export function forageRegrowTicksBetween(from: number, to: number): number {
  if (to <= from) return 0;
  if (!seasonsOn()) return to - from;
  let total = 0;
  for (let t = from; t < to; ) {
    const day = Math.floor(t / GAME_DAY_TICKS);
    const end = Math.min(to, (day + 1) * GAME_DAY_TICKS);
    const winter = calendarOf(day + state.calendarOffset).season === WINTER;
    total += (end - t) * (winter ? WINTER_FORAGE_REGROW_MULT : 1);
    t = end;
  }
  return Math.floor(total);
}

// Every tick (sim.ts): a new calendar day resets watering; the first day of winter frosts unroofed growing crops.
// calendarLastDay -1 (new world / load): just note today.
// Gap closure G4: snow is falling now (seasons on): units outdoors move x SNOW_SPEED_MULT (tiles.ts).
export function snowSlowNow(): boolean {
  return seasonsOn() && weatherNow() === "snow";
}

export function updateCalendar() {
  // Once a second is enough for the snow flag (a weather spell starts / stops at most a few times a day).
  if (state.cycleTick % TICK_RATE === 0) setSnowSlow(snowSlowNow());
  const day = calendarDayNow();
  const last = state.calendarLastDay;
  if (day === last) return;
  state.calendarLastDay = day;
  if (last < 0 || !seasonsOn()) return;
  if (CROP_WATER_RESETS_DAILY) resetCropWatering();
  // Gap closure G1: food spoils a little every day (each clan's storerooms protect a share).
  for (const c of clans) spoilFood(c.id);
  const now = calendarOf(day);
  const before = calendarOf(last);
  if (now.season !== before.season || now.year !== before.year) {
    const name = SEASON_LABEL[SEASONS[now.season]];
    broadcastEvent("season", `${name} begins (Year ${now.year})`);
    if (now.season === WINTER) {
      const killed = frostCrops();
      if (killed > 0) broadcastEvent("season", `Frost: ${killed} growing crop${killed === 1 ? "" : "s"} died (roofed crops survive)`);
    }
  }
}

// Creative / test hooks: jump the calendar to (season, day) of the current year (the clock keeps its time of day;
// only the offset moves), or set / clear today's weather. Returns the new date.
export function setCalendar(season?: number, day?: number, year?: number): CalendarDate {
  const cur = calendarNow();
  const target = absDayOf(year ?? cur.year, season ?? cur.season, day ?? cur.day);
  state.calendarOffset += target - cur.abs;
  return calendarNow();
}
export function setWeatherOverride(kind: string | null) {
  state.weatherOverride = kind && (WEATHER_KINDS as readonly string[]).includes(kind) ? { kind, day: calendarDayNow() } : null;
}
