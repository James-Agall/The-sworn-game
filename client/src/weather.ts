// weather.ts: Stardew phase 5b (2026-11-09): the screen-space weather overlay over the world (under the HUD). One
// Graphics redrawn each frame: rain streaks, heavier rain + lightning flashes for a storm, snow flakes, a fog veil.
// Capped particle counts (shared/src/calendar.ts WEATHER_*), nothing drawn while the tab is hidden, the strategy
// view or the overlay toggle (Creative > World > Weather overlay) is off. Cheap: no textures, no per-particle objects.
import { Container, Graphics } from "pixi.js";
import {
  WEATHER_FOG_ALPHA, WEATHER_RAIN_DROPS, WEATHER_SNOW_FLAKES, WEATHER_STORM_DROPS, WEATHER_STORM_FLASH_PER_S, type WeatherKind,
} from "@colony/shared/calendar";

interface Particle {
  x: number;
  y: number;
  v: number;
  // Snow: sway phase; rain: streak length.
  k: number;
}

export function setupWeatherOverlay(screen: () => { width: number; height: number }) {
  const layer = new Container();
  const g = new Graphics();
  const flash = new Graphics();
  layer.addChild(g, flash);
  layer.eventMode = "none";
  let kind: WeatherKind = "clear";
  let enabled = true;
  let suppressed = false;
  let parts: Particle[] = [];
  let flashAlpha = 0;
  let fog = 0;
  let t = 0;

  const want = (): number => (kind === "rain" ? WEATHER_RAIN_DROPS : kind === "storm" ? WEATHER_STORM_DROPS : kind === "snow" ? WEATHER_SNOW_FLAKES : 0);
  const spawn = (w: number, h: number, anywhere: boolean): Particle => {
    const snow = kind === "snow";
    return {
      x: Math.random() * (w + 80) - 40,
      y: anywhere ? Math.random() * h : -20 - Math.random() * 40,
      v: snow ? 30 + Math.random() * 40 : 700 + Math.random() * 300,
      k: snow ? Math.random() * Math.PI * 2 : 10 + Math.random() * 10,
    };
  };

  function set(next: WeatherKind) {
    if (next === kind) return;
    kind = next;
    parts = [];
  }

  function update(dtMs: number) {
    const on = enabled && !suppressed && !document.hidden;
    layer.visible = on;
    if (!on) return;
    const { width: w, height: h } = screen();
    const dt = Math.min(0.1, dtMs / 1000);
    t += dt;
    const n = want();
    while (parts.length < n) parts.push(spawn(w, h, parts.length < n / 2 && t < 0.5));
    if (parts.length > n) parts.length = n;
    g.clear();
    if (kind === "rain" || kind === "storm") {
      const slant = kind === "storm" ? 0.35 : 0.18;
      for (const p of parts) {
        p.y += p.v * dt;
        p.x += p.v * slant * dt;
        if (p.y > h + 20 || p.x > w + 40) Object.assign(p, spawn(w, h, false));
        g.moveTo(p.x, p.y).lineTo(p.x - p.k * slant, p.y - p.k);
      }
      if (parts.length) g.stroke({ width: 1.2, color: 0xaecbe8, alpha: kind === "storm" ? 0.55 : 0.45 });
    } else if (kind === "snow") {
      for (const p of parts) {
        p.y += p.v * dt;
        p.k += dt * 1.5;
        p.x += Math.sin(p.k) * 20 * dt;
        if (p.y > h + 10) Object.assign(p, spawn(w, h, false));
        g.circle(p.x, p.y, 1.6 + (p.v % 3) * 0.4);
      }
      if (parts.length) g.fill({ color: 0xffffff, alpha: 0.85 });
    }
    // Fog (and a light haze under storm / rain / snow), eased in and out.
    const fogWant = kind === "fog" ? WEATHER_FOG_ALPHA : kind === "storm" ? 0.12 : kind === "rain" || kind === "snow" ? 0.06 : 0;
    fog += (fogWant - fog) * Math.min(1, dt * 0.8);
    if (fog > 0.005) {
      g.rect(0, 0, w, h).fill({ color: kind === "snow" ? 0xe8eef6 : 0xc8ccd2, alpha: fog * (0.85 + 0.15 * Math.sin(t * 0.4)) });
    }
    // Storm: an occasional lightning flash.
    if (kind === "storm" && Math.random() < WEATHER_STORM_FLASH_PER_S * dt) flashAlpha = 0.55;
    flashAlpha = Math.max(0, flashAlpha - dt * 2.2);
    flash.clear();
    if (flashAlpha > 0) flash.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: flashAlpha });
  }

  return {
    layer,
    set,
    update,
    // Creative toggle (persisted by the caller).
    setEnabled(on: boolean) {
      enabled = on;
    },
    isEnabled: () => enabled,
    // Strategy view etc.: hide without forgetting the weather.
    setSuppressed(on: boolean) {
      suppressed = on;
    },
  };
}
