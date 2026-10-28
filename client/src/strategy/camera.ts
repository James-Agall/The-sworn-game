// Strategy mode phase 1 (docs PLAN-strategy-mode.md §1): the free bird's-eye camera. Pure state, no Pixi:
// main.ts reads `view()` each frame and applies it to worldLayer, and routes Tab / Esc, pan keys, edge
// scroll, middle-drag, the wheel and minimap clicks into it.
//
// The camera keeps a logical target (x, y = world px at the screen centre, zoom); pan / zoom / jumps move
// the target at once and the drawn view follows it closely (FOLLOW_RATE). Entering and exiting ease the
// displayed view from where it was to the target over TRANSITION_MS; on exit the target is the rider's live position at the tactical zoom, and once that
// transition ends the camera is inactive (main.ts follows the rider again).

export const TACTICAL_ZOOM = 1.3;
export const STRATEGY_ENTER_ZOOM = 0.5;
const TRANSITION_MS = 350;
// Never zoom out past this even on a small screen / huge map (the whole map fits above it up to 512 tiles).
const ABSOLUTE_MIN_ZOOM = 0.05;
export const PAN_SCREEN_PX_PER_S = 900;
export const EDGE_SCROLL_PX = 12;
export const WHEEL_ZOOM_STEP = 1.15;
// After the enter transition, the drawn view eases toward the target (wheel / pan / minimap jumps)
// at this rate per second (exponential).
const FOLLOW_RATE = 18;

export interface CamView {
  x: number;
  y: number;
  zoom: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class StrategyCamera {
  // True from enter() until the exit transition has finished.
  active = false;
  // True between exit() and the end of its transition (input is tactical again meanwhile).
  private exiting = false;
  private x = 0;
  private y = 0;
  private zoom = TACTICAL_ZOOM;
  private from: CamView | null = null;
  private fromAt = 0;
  private last: CamView = { x: 0, y: 0, zoom: TACTICAL_ZOOM };
  private lastAt = 0;
  private worldW = 1;
  private worldH = 1;
  minZoom = 0.1;

  // In strategy mode for input purposes (build off, rider idle, pan keys): not while easing back out.
  get inStrategy(): boolean {
    return this.active && !this.exiting;
  }

  // The logical target (what setView reports to the server).
  get target(): CamView {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  // Called every frame: world size (px) and the screen size give the zoom floor (whole map on screen).
  setBounds(worldW: number, worldH: number, screenW: number, screenH: number) {
    this.worldW = Math.max(1, worldW);
    this.worldH = Math.max(1, worldH);
    const fit = Math.min(screenW / this.worldW, screenH / this.worldH);
    this.minZoom = Math.min(TACTICAL_ZOOM, Math.max(ABSOLUTE_MIN_ZOOM, fit));
    if (this.inStrategy) this.clampTarget();
  }

  enter(current: CamView, now: number) {
    this.last = { ...current };
    this.lastAt = now;
    this.active = true;
    this.exiting = false;
    this.from = { ...current };
    this.fromAt = now;
    this.x = current.x;
    this.y = current.y;
    this.zoom = Math.max(this.minZoom, Math.min(TACTICAL_ZOOM, STRATEGY_ENTER_ZOOM));
    this.clampTarget();
  }

  exit(now: number) {
    if (!this.active || this.exiting) return;
    this.exiting = true;
    this.from = { ...this.last };
    this.fromAt = now;
  }

  // Ends strategy mode at once (welcome / world reset).
  reset() {
    this.active = false;
    this.exiting = false;
    this.from = null;
  }

  pan(dxWorld: number, dyWorld: number) {
    this.x += dxWorld;
    this.y += dyWorld;
    this.clampTarget();
  }

  jumpTo(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.clampTarget();
  }

  // Zooms by `factor` keeping the world point under the cursor (screen px) fixed.
  zoomAt(factor: number, sx: number, sy: number, screenW: number, screenH: number) {
    const z = Math.max(this.minZoom, Math.min(TACTICAL_ZOOM, this.zoom * factor));
    const ox = sx - screenW / 2;
    const oy = sy - screenH / 2;
    const wx = this.x + ox / this.zoom;
    const wy = this.y + oy / this.zoom;
    this.zoom = z;
    this.x = wx - ox / z;
    this.y = wy - oy / z;
    this.clampTarget();
  }

  // The view to draw this frame, or null when the camera is inactive (follow the rider as before).
  // `rider` is the exit target while easing back.
  view(now: number, rider: { x: number; y: number }): CamView | null {
    if (!this.active) return null;
    const to: CamView = this.exiting ? { x: rider.x, y: rider.y, zoom: TACTICAL_ZOOM } : this.target;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastAt) / 1000));
    this.lastAt = now;
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    let v: CamView = {
      x: lerp(this.last.x, to.x, k),
      y: lerp(this.last.y, to.y, k),
      zoom: lerp(this.last.zoom, to.zoom, k),
    };
    if (this.from) {
      const t = Math.min(1, (now - this.fromAt) / TRANSITION_MS);
      const e = easeInOutCubic(t);
      v = { x: lerp(this.from.x, to.x, e), y: lerp(this.from.y, to.y, e), zoom: lerp(this.from.zoom, to.zoom, e) };
      if (t >= 1) {
        this.from = null;
        if (this.exiting) {
          this.reset();
          return null;
        }
      }
    }
    this.last = v;
    return v;
  }

  private clampTarget() {
    this.zoom = Math.max(this.minZoom, Math.min(TACTICAL_ZOOM, this.zoom));
    this.x = Math.max(0, Math.min(this.worldW, this.x));
    this.y = Math.max(0, Math.min(this.worldH, this.y));
  }
}
