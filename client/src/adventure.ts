// Village life phase 5 (docs PLAN-village-life.md, PLAN-solo-hero.md "Refinement"): the close adventure camera.
// Pure state, no Pixi: main.ts asks `follow()` for the focus each frame while the strategy camera is off.
// Close top-down (the same 2D art, zoomed in), locked on the hero with a smooth follow, no edge scrolling; the
// wheel nudges the zoom inside [ADVENTURE_MIN_ZOOM, ADVENTURE_MAX_ZOOM]. Off (?camera=classic or the setting):
// the old tactical camera (TACTICAL_ZOOM, hard-locked).

export const ADVENTURE_ZOOM = 2.4;
export const ADVENTURE_MIN_ZOOM = 1.6;
export const ADVENTURE_MAX_ZOOM = 3.2;
// Exponential follow rate per second (about 0.1 s to close two thirds of the gap).
const FOLLOW_RATE = 10;
// A focus jump farther than this (world px: teleport, heir, load) snaps instead of gliding.
const SNAP_PX = 20 * 32;
// Small party: with more commandable units selected than this (or a task force), adventure view shows the strategy
// hint instead of the party command bar.
export const PARTY_COMMAND_MAX = 8;

export const ADVENTURE_CAM_PREF = "sworn.adventureCam";
export const START_STRATEGY_PREF = "sworn.startStrategy";

export interface AdventurePrefs {
  // The close camera (else the classic tactical camera).
  on: boolean;
  // Enter strategy view as soon as a game starts.
  startStrategy: boolean;
}

// ?camera=classic|adventure and ?view=strategy|adventure override the stored settings.
export function readAdventurePrefs(search: string, stored: (key: string) => string | null): AdventurePrefs {
  const q = new URLSearchParams(search);
  const cam = q.get("camera");
  const view = q.get("view");
  return {
    on: cam === "classic" ? false : cam === "adventure" ? true : stored(ADVENTURE_CAM_PREF) !== "off",
    startStrategy: view === "strategy" ? true : view === "adventure" ? false : stored(START_STRATEGY_PREF) === "on",
  };
}

export class AdventureCamera {
  zoom = ADVENTURE_ZOOM;
  private x = NaN;
  private y = NaN;
  private at = 0;

  zoomBy(factor: number) {
    this.zoom = Math.max(ADVENTURE_MIN_ZOOM, Math.min(ADVENTURE_MAX_ZOOM, this.zoom * factor));
  }

  // Puts the camera where the view is drawn now (while the strategy camera drives it), so the hand-back glides.
  sync(x: number, y: number, now: number) {
    this.x = x;
    this.y = y;
    this.at = now;
  }

  // The focus to draw this frame, easing toward the target (the hero, or a fight peek).
  follow(tx: number, ty: number, now: number): { x: number; y: number } {
    const dt = Math.min(0.1, Math.max(0, (now - this.at) / 1000));
    this.at = now;
    if (!Number.isFinite(this.x) || Math.hypot(tx - this.x, ty - this.y) > SNAP_PX) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = 1 - Math.exp(-FOLLOW_RATE * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    return { x: this.x, y: this.y };
  }
}
