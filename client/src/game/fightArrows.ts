// Off-screen fight arrows, minimap fight pings and the camera 'fight peek'. Split out of main.ts (2026-11-26).
import { Application, Container } from "pixi.js";
import type { GameEventCategory } from "@colony/shared/protocol";
import type { FightSnapshot } from "@colony/shared/protocol";
import { FIGHT_WINDOW_SECONDS } from "@colony/shared/protocol";
import { compassDirection, fightArrowAlpha, placeEdgeArrow } from "../fightArrows";
import { StrategyCamera } from "../strategy/camera";
import { type EntityVisual } from "../worldVisuals";
import type { FightArrow } from "./types";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface FightArrowsContext {
  currentInput: () => { dx: number; dy: number };
  app: Application;
  worldLayer: Container;
  playerSprites: Map<string, EntityVisual>;
  strategyCam: StrategyCamera;
  readonly pushEventToast: (category: GameEventCategory, text: string) => void;
  fightPeek: { x: number; y: number; until: number } | null;
  fightPeekCam: { x: number; y: number } | null;
  readonly tileSize: number;
  readonly camZoom: number;
  readonly myId: string | null;
}

export function createFightArrows(game: FightArrowsContext) {
  const { currentInput, app, worldLayer, playerSprites, strategyCam } = game;
  // ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
  // The snapshot's per-player `fights` (server-clustered) become one DOM arrow each, clamped to the
  // screen rim by placeEdgeArrow and hidden while the fight is on screen; a fight the server drops fades
  // out over FIGHT_ARROW_FADE_MS. Clicking an arrow pans the camera there for FIGHT_PEEK_MS (any
  // movement key returns it to the player). The minimap pings every listed fight, and the first time a
  // fight begins off-screen a toast names it (at most one per FIGHT_TOAST_THROTTLE_MS).
  const fightArrowLayer = document.getElementById("fight-arrows")!;
  const fightArrows = new Map<number, FightArrow>();
  const FIGHT_ARROW_FADE_MS = 600;
  // Kept clear of the top button row / toasts and the bottom command bar.
  const FIGHT_ARROW_INSETS = { top: 70, right: 40, bottom: 56, left: 40 };
  const FIGHT_LABEL_OFFSET_PX = 34;
  const FIGHT_TOAST_THROTTLE_MS = 20000;
  const FIGHT_PEEK_MS = 4000;
  const FIGHT_PEEK_EASE = 0.18;
  let latestFights: FightSnapshot[] = [];
  const announcedFightIds = new Set<number>();
  let lastFightToastAt = -Infinity;
  function fightPeekFocus(playerX: number, playerY: number): { x: number; y: number } {
    if (game.fightPeek) {
      const input = currentInput();
      if (performance.now() > game.fightPeek.until || input.dx !== 0 || input.dy !== 0) game.fightPeek = null;
    }
    if (!game.fightPeek && !game.fightPeekCam) return { x: playerX, y: playerY };
    const cam = game.fightPeekCam ?? { x: playerX, y: playerY };
    const tx = game.fightPeek ? game.fightPeek.x : playerX;
    const ty = game.fightPeek ? game.fightPeek.y : playerY;
    cam.x += (tx - cam.x) * FIGHT_PEEK_EASE;
    cam.y += (ty - cam.y) * FIGHT_PEEK_EASE;
    game.fightPeekCam = cam;
    if (!game.fightPeek && Math.hypot(cam.x - playerX, cam.y - playerY) < 2) {
      game.fightPeekCam = null;
      return { x: playerX, y: playerY };
    }
    return cam;
  }
  function fightWorldPos(f: FightSnapshot): { x: number; y: number } {
    return { x: (f.x + 0.5) * game.tileSize, y: (f.y + 0.5) * game.tileSize };
  }
  function fightTitle(f: FightSnapshot): string {
    return f.buildings && !f.units && !f.you ? "Under attack" : f.label;
  }
  function fightIsOnScreen(f: FightSnapshot): boolean {
    const w = fightWorldPos(f);
    return placeEdgeArrow(
      app.screen.width, app.screen.height,
      worldLayer.position.x + w.x * game.camZoom, worldLayer.position.y + w.y * game.camZoom, FIGHT_ARROW_INSETS
    ).onScreen;
  }
  // Direction and distance in tiles from the local player (the camera centre if there is none).
  function fightBearing(f: FightSnapshot): { dir: string; tiles: number } {
    const me = game.myId ? playerSprites.get(game.myId) : undefined;
    const ox = me ? me.sprite.position.x / game.tileSize : (app.screen.width / 2 - worldLayer.position.x) / game.camZoom / game.tileSize;
    const oy = me ? me.sprite.position.y / game.tileSize : (app.screen.height / 2 - worldLayer.position.y) / game.camZoom / game.tileSize;
    const dx = f.x + 0.5 - ox;
    const dy = f.y + 0.5 - oy;
    return { dir: compassDirection(dx, dy), tiles: Math.round(Math.hypot(dx, dy)) };
  }
  function createFightArrow(f: FightSnapshot): FightArrow {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "fight-arrow";
    const chevron = document.createElement("span");
    chevron.className = "fight-chevron";
    const label = document.createElement("span");
    label.className = "fight-label";
    const title = document.createElement("span");
    const sub = document.createElement("small");
    label.append(title, sub);
    el.append(chevron, label);
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const arrow = fightArrows.get(f.id);
      const target = fightWorldPos(arrow ? arrow.fight : f);
      if (strategyCam.inStrategy) strategyCam.jumpTo(target.x, target.y);
      else game.fightPeek = { x: target.x, y: target.y, until: performance.now() + FIGHT_PEEK_MS };
      el.blur();
    });
    fightArrowLayer.append(el);
    return { fight: f, el, chevron, title, sub, goneAt: 0 };
  }
  function clearFightArrows() {
    for (const a of fightArrows.values()) a.el.remove();
    fightArrows.clear();
    latestFights = [];
    announcedFightIds.clear();
    game.fightPeek = null;
    game.fightPeekCam = null;
  }
  function syncFights(fights: FightSnapshot[] | undefined) {
    latestFights = fights ?? [];
    const now = performance.now();
    const seen = new Set<number>();
    for (const f of latestFights) {
      seen.add(f.id);
      let arrow = fightArrows.get(f.id);
      if (!arrow) {
        arrow = createFightArrow(f);
        fightArrows.set(f.id, arrow);
      }
      arrow.fight = f;
      arrow.goneAt = 0;
      arrow.el.className = `fight-arrow fight-i${f.intensity}`;
      arrow.el.title = `${f.label}: ${f.combatants} fighting${f.you ? " (you)" : ""} - click to look`;
      if (!announcedFightIds.has(f.id)) {
        announcedFightIds.add(f.id);
        if (now - lastFightToastAt >= FIGHT_TOAST_THROTTLE_MS && !fightIsOnScreen(f)) {
          lastFightToastAt = now;
          const { dir, tiles } = fightBearing(f);
          game.pushEventToast("raid", `${fightTitle(f)} to the ${dir} (${tiles} tiles)`);
        }
      }
    }
    for (const [id, arrow] of fightArrows) {
      if (!seen.has(id) && arrow.goneAt === 0) arrow.goneAt = now;
    }
  }
  app.ticker.add(() => {
    if (fightArrows.size === 0) return;
    const now = performance.now();
    for (const [id, a] of fightArrows) {
      const gone = a.goneAt ? now - a.goneAt : 0;
      if (gone >= FIGHT_ARROW_FADE_MS) {
        a.el.remove();
        fightArrows.delete(id);
        continue;
      }
      const w = fightWorldPos(a.fight);
      const p = placeEdgeArrow(
        app.screen.width, app.screen.height,
        worldLayer.position.x + w.x * game.camZoom, worldLayer.position.y + w.y * game.camZoom, FIGHT_ARROW_INSETS
      );
      a.el.hidden = p.onScreen;
      if (p.onScreen) continue;
      a.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      a.chevron.style.transform = `rotate(${p.angle.toFixed(3)}rad)`;
      // The label sits just inside the rim, opposite the point.
      const label = a.title.parentElement!;
      label.style.left = `${(-Math.cos(p.angle) * FIGHT_LABEL_OFFSET_PX * 1.6).toFixed(1)}px`;
      label.style.top = `${(-Math.sin(p.angle) * FIGHT_LABEL_OFFSET_PX).toFixed(1)}px`;
      const pulse = 0.8 + 0.2 * Math.sin(now / (a.fight.intensity >= 3 ? 110 : a.fight.intensity === 2 ? 160 : 220));
      a.el.style.opacity = (fightArrowAlpha(a.fight.quiet, FIGHT_WINDOW_SECONDS, gone, FIGHT_ARROW_FADE_MS) * pulse).toFixed(3);
      const { dir, tiles } = fightBearing(a.fight);
      const title = `${fightTitle(a.fight)} · ${dir}`;
      const sub = `${tiles} tiles${a.fight.you ? " · you" : ""}`;
      if (a.title.textContent !== title) a.title.textContent = title;
      if (a.sub.textContent !== sub) a.sub.textContent = sub;
    }
  });
  // Expanding rings on the minimap at every listed fight (on or off screen), faster and wider the
  // fiercer it is. Called at the end of drawMinimap, in its backing-pixel space.
  function drawFightPings(ctx: CanvasRenderingContext2D, s: number, u: number) {
    if (latestFights.length === 0) return;
    const now = performance.now();
    for (const f of latestFights) {
      const cx = (f.x + 0.5) * s;
      const cy = (f.y + 0.5) * s;
      const period = f.intensity >= 3 ? 700 : f.intensity === 2 ? 950 : 1200;
      const phase = ((now + f.id * 137) % period) / period;
      const fade = Math.max(0.25, Math.min(1, FIGHT_WINDOW_SECONDS - f.quiet));
      ctx.beginPath();
      ctx.arc(cx, cy, (3 + phase * (5 + 2 * f.intensity)) * u, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = `rgba(255, 70, 40, ${((1 - phase) * fade).toFixed(3)})`;
      ctx.stroke();
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u);
      ctx.fillStyle = f.you || f.units || f.buildings ? "#ff3b2a" : "#f1c40f";
      ctx.fillRect(cx - u, cy - u, 2 * u, 2 * u);
    }
  }
  return { fightPeekFocus, drawFightPings, clearFightArrows, syncFights, fightIsOnScreen, fightWorldPos, get latestFights() { return latestFights; } };
}
