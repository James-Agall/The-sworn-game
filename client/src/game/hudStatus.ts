// HUD status rows: the PAUSED banner, weather overlay, calendar, food, winter, raid forecast and agriculture lines.
// Split out of main.ts (2026-11-26).
import { Application, Text } from "pixi.js";
import { setupWeatherOverlay } from "../weather";
import { SEASONS, WEATHER_LABEL, calendarLabel, type CalendarSnapshot } from "@colony/shared/calendar";
import { raidForecastText, type RaidForecast } from "@colony/shared/raidForecast";
import { isRaidWarning, isRaidWarningCleared, raidClearedText, raidWarningText, type RaidWarning } from "@colony/shared/raidWarning";
import { raidWarningsLive } from "./raidWarnings";
import { FUEL_LOW_DAYS, type WinterSnapshot } from "@colony/shared/winter";
import { foodLevel, type FoodSnapshot } from "@colony/shared/food";
import type { AgriSnapshot } from "@colony/shared/agri";
import type { GameEventCategory } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface HudStatusContext {
  app: Application;
  applySeason: (season: number) => void;
  readonly pushEventToast: (category: GameEventCategory, text: string) => void;
}

export function createHudStatus(game: HudStatusContext) {
  const { app, applySeason } = game;
  // Core stats (wood/iron/rock/gold/pop/time/happiness/army/selected) used to live here as a
  // floating canvas HUD; they're now DOM elements pinned to the top of #economy-panel, merged
  // into the same single menu as the goods/market panel. See the DOM refs set up below.

  const pausedBanner = new Text({
    text: "PAUSED",
    style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
  });
  pausedBanner.anchor.set(0.5);
  pausedBanner.visible = false;
  // Stardew phase 5b: the weather overlay (screen space, over the world, under the banner and the DOM HUD).
  const WEATHER_OVERLAY_PREF = "colony.weatherOverlay";
  const weatherUi = setupWeatherOverlay(() => app.screen);
  try {
    weatherUi.setEnabled(localStorage.getItem(WEATHER_OVERLAY_PREF) !== "0");
  } catch {
    // Storage blocked: on.
  }
  app.stage.addChild(weatherUi.layer);
  app.ticker.add((ticker) => weatherUi.update(ticker.deltaMS));
  const calendarEl = {
    seasonIcon: document.getElementById("cal-season-icon") as HTMLImageElement | null,
    weatherIcon: document.getElementById("cal-weather-icon") as HTMLImageElement | null,
    date: document.getElementById("stat-date"),
    weather: document.getElementById("stat-weather"),
  };
  for (const img of [calendarEl.seasonIcon, calendarEl.weatherIcon]) img?.addEventListener("error", () => (img.hidden = true));
  let shownCalendar = "";
  function refreshCalendar(cal: CalendarSnapshot | undefined) {
    if (!cal) return;
    applySeason(cal.season);
    weatherUi.set(cal.weather);
    const key = `${cal.year}/${cal.season}/${cal.day}/${cal.weather}`;
    if (key === shownCalendar) return;
    shownCalendar = key;
    const season = SEASONS[cal.season];
    if (calendarEl.date) calendarEl.date.textContent = calendarLabel(cal);
    if (calendarEl.weather) calendarEl.weather.textContent = WEATHER_LABEL[cal.weather];
    if (calendarEl.seasonIcon) {
      calendarEl.seasonIcon.hidden = false;
      calendarEl.seasonIcon.src = `/sprites/icons/season_${season}.png`;
    }
    // Every weather state has its own sprite.
    if (calendarEl.weatherIcon) {
      calendarEl.weatherIcon.hidden = false;
      calendarEl.weatherIcon.src = `/sprites/icons/weather_${cal.weather}.png`;
    }
  }
  // Food days (shared/src/food.ts): how long grain + meat + fruit last at the dawn meal; shown with seasons off too.
  const foodEl = document.getElementById("stat-food")!;
  let shownFood = "";
  function refreshFood(f: FoodSnapshot | undefined) {
    const key = JSON.stringify(f ?? null);
    if (key === shownFood) return;
    shownFood = key;
    if (!f) return;
    const level = foodLevel(f.days);
    const arrow = f.trend > 0 ? " \u25B2" : f.trend < 0 ? " \u25BC" : "";
    foodEl.textContent = f.days === null ? "Food: nobody to feed" : `Food: ${f.days} day${f.days === 1 ? "" : "s"} (${f.perDay}/day)${arrow}`;
    foodEl.classList.toggle("low", level === "low");
    foodEl.classList.toggle("critical", level === "critical");
    foodEl.title = `${f.stock} grain, meat and fruit in store; the dawn meal eats ${f.perDay}. ${f.trend >= 0 ? "+" : ""}${f.trend} since the last dawn meal.`;
  }
  // Winter (shared/src/winter.ts): days of fuel at the homes' burn, people needing warm clothes, and the autumn /
  // winter "Winter needs" warning. Hidden with seasons off (no `winter` field).
  const winterRowEl = document.getElementById("stat-winter")!;
  const fuelEl = document.getElementById("stat-fuel")!;
  const clothesEl = document.getElementById("stat-clothes")!;
  const winterWarnEl = document.getElementById("stat-winter-warn")!;
  const goalPrepEl = document.getElementById("goal-prep")!;
  const goalPrepTitleEl = document.getElementById("goal-prep-title")!;
  const goalPrepDetailEl = document.getElementById("goal-prep-detail")!;
  let shownWinter = "";
  function refreshWinter(w: WinterSnapshot | undefined) {
    const key = JSON.stringify(w ?? null);
    if (key === shownWinter) return;
    shownWinter = key;
    winterRowEl.hidden = !w;
    winterWarnEl.hidden = !w?.warning;
    goalPrepEl.hidden = !w?.prep;
    if (w?.prep) {
      const p = w.prep;
      goalPrepTitleEl.textContent = "Prepare for winter";
      goalPrepDetailEl.textContent = `Fuel ${p.fuelDays} / ${p.target} days${p.needClothes > 0 ? `, ${p.needClothes} need warm clothes` : ", all dressed"} (reward: ${p.reward})`;
    }
    if (!w) return;
    const days = w.days === null ? "no homes to heat" : `${w.days} day${w.days === 1 ? "" : "s"} (${w.burn}/day)`;
    fuelEl.textContent = `Fuel: ${days}${w.cold && w.coldHomes > 0 ? `, ${w.coldHomes} cold home${w.coldHomes === 1 ? "" : "s"}` : ""}`;
    fuelEl.classList.toggle("low", (w.days !== null && w.days < FUEL_LOW_DAYS) || (w.cold && w.coldHomes > 0));
    fuelEl.title = `${w.heat} heat in store (wood 1, coal / charcoal 2 each); ${w.homes} home${w.homes === 1 ? "" : "s"} burn ${w.burn} a winter day`;
    clothesEl.textContent = w.needClothes > 0 ? `Need clothes: ${w.needClothes}` : "Dressed for winter";
    clothesEl.classList.toggle("low", w.needClothes > 0 && w.cold);
    clothesEl.title = `${w.people - w.needClothes} of ${w.people} warmly dressed; ${w.garments} garment${w.garments === 1 ? "" : "s"} in store`;
    winterWarnEl.textContent = w.warning ?? "";
  }
  // Agriculture extras (shared/src/agri.ts): how fast raw food spoils after the stores' protection, sick people and the
  // sourdough starter. Hidden with seasons off (no `agri` field).
  const agriRowEl = document.getElementById("stat-agri")!;
  const spoilEl = document.getElementById("stat-spoil")!;
  const sickEl = document.getElementById("stat-sick")!;
  // Dusk raid forecast: one HUD line under the clock, and a toast the first time a given raid is announced.
  const raidForecastEl = document.createElement("div");
  raidForecastEl.id = "raid-forecast";
  raidForecastEl.style.cssText = "position:fixed;top:44px;left:50%;transform:translateX(-50%);padding:2px 10px;background:rgba(40,12,12,.8);color:#f3c9a8;border:1px solid #7a2a22;border-radius:4px;font:12px sans-serif;z-index:20;pointer-events:none";
  raidForecastEl.hidden = true;
  document.body.appendChild(raidForecastEl);
  // Raid warning (shared/src/raidWarning.ts): a small dismissible banner under the forecast line with direction,
  // distance and ETA (refreshed by the server every few seconds), a toast when the raid is over, and a pulsing red
  // marker on the minimap at the raiders' position. Dismissing hides the banner for that raid only.
  const raidWarningDismissed = new Set<string>();
  const raidWarnEl = document.createElement("div");
  raidWarnEl.id = "raid-warning";
  raidWarnEl.style.cssText = "position:fixed;top:66px;left:50%;transform:translateX(-50%);padding:3px 6px 3px 10px;background:rgba(60,14,10,.88);color:#ffd9c2;border:1px solid #b33a2a;border-radius:4px;font:12px sans-serif;z-index:20;display:flex;gap:8px;align-items:center";
  raidWarnEl.hidden = true;
  const raidWarnText = document.createElement("span");
  const raidWarnClose = document.createElement("button");
  raidWarnClose.textContent = "x";
  raidWarnClose.title = "Dismiss";
  raidWarnClose.style.cssText = "background:none;border:0;color:#ffd9c2;cursor:pointer;font:12px sans-serif;padding:0 2px";
  raidWarnClose.addEventListener("click", () => {
    for (const id of raidWarningsLive.keys()) raidWarningDismissed.add(id);
    refreshRaidWarning();
  });
  raidWarnEl.append(raidWarnText, raidWarnClose);
  document.body.appendChild(raidWarnEl);
  function refreshRaidWarning() {
    let shown: RaidWarning | null = null;
    for (const w of raidWarningsLive.values()) if (!raidWarningDismissed.has(w.id) && (!shown || w.etaTicks < shown.etaTicks)) shown = w;
    raidWarnEl.hidden = !shown;
    if (shown) raidWarnText.textContent = raidWarningText(shown) + (shown.count > 0 ? ` (${shown.count})` : "");
  }
  function onRaidWarning(w: unknown) {
    if (!isRaidWarning(w)) return;
    const first = !raidWarningsLive.has(w.id);
    raidWarningsLive.set(w.id, w);
    if (first) game.pushEventToast("raid", raidWarningText(w));
    refreshRaidWarning();
  }
  function onRaidWarningCleared(c: unknown) {
    if (!isRaidWarningCleared(c) || !raidWarningsLive.delete(c.id)) return;
    raidWarningDismissed.delete(c.id);
    game.pushEventToast("raid", raidClearedText(c));
    refreshRaidWarning();
  }
  function clearRaidWarnings() { raidWarningsLive.clear(); raidWarningDismissed.clear(); refreshRaidWarning(); }
  let shownRaidForecast = "";
  function refreshRaidForecast(f: RaidForecast | undefined) {
    const text = f ? raidForecastText(f) : "";
    if (text === shownRaidForecast) return;
    if (text && !shownRaidForecast) game.pushEventToast("raid", text);
    shownRaidForecast = text;
    raidForecastEl.textContent = text;
    raidForecastEl.hidden = !text;
  }
  let shownAgri = "";
  function refreshAgri(a: AgriSnapshot | undefined) {
    const key = JSON.stringify(a ?? null);
    if (key === shownAgri) return;
    shownAgri = key;
    agriRowEl.hidden = !a;
    if (!a) return;
    const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
    spoilEl.textContent = `Raw food spoils ${pct(a.raw)}/day`;
    spoilEl.classList.toggle("low", a.raw >= 0.04);
    const keeps = [a.cellarLevel > 0 ? `Cellar L${a.cellarLevel} -${pct(a.cellar)}` : "no Cellar", a.pots > 0 ? `pots -${pct(a.pots)}` : "no pots", a.storeroom > 0 ? `storerooms -${pct(a.storeroom)}` : "no storeroom"];
    spoilEl.title = `Per day: raw ${pct(a.raw)}, fresh ${pct(a.fresh)}, dry ${pct(a.dry)} (${keeps.join(", ")}); ${a.spoiled} food went off at the last dawn`;
    const starter = a.starter === "none" ? "" : a.starter === "kept" ? "; sourdough starter kept" : `; starter untended ${a.starter} day${a.starter === 1 ? "" : "s"}`;
    sickEl.textContent = a.sick > 0 ? `Sick: ${a.sick}` : "Healthy";
    sickEl.classList.toggle("low", a.sick > 0 || typeof a.starter === "number");
    sickEl.title = `${a.sick} of ${a.people} sick from bad food${starter}`;
  }
  app.stage.addChild(pausedBanner);
  app.ticker.add(() => {
    pausedBanner.position.set(app.screen.width / 2, app.screen.height / 2);
  });
  return { weatherUi, WEATHER_OVERLAY_PREF, pausedBanner, refreshCalendar, refreshFood, refreshWinter, refreshAgri, refreshRaidForecast, onRaidWarning, onRaidWarningCleared, clearRaidWarnings };
}
