// Off-screen fight notifiers: pure placement maths for the edge-of-screen arrows (no DOM / Pixi), so
// plain node can unit-test it (client/fight-arrows-test.mjs runs this file with node's type stripping:
// keep it to erasable TypeScript, no enums or parameter properties).

export interface RimInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EdgeArrowPlacement {
  // True when the target is inside the viewport itself: no arrow is drawn then.
  onScreen: boolean;
  // Arrow centre in screen px, clamped to the inset rim (the target point itself when on screen).
  x: number;
  y: number;
  // Radians, screen space (0 = pointing right, PI/2 = pointing down), from the arrow towards the target.
  angle: number;
}

// Where the arrow for a target at screen point (sx, sy) goes on a viewW x viewH viewport: on the ray
// from the inset rectangle's centre towards the target, where it meets that rectangle's edge.
export function placeEdgeArrow(viewW: number, viewH: number, sx: number, sy: number, insets: RimInsets): EdgeArrowPlacement {
  if (sx >= 0 && sx <= viewW && sy >= 0 && sy <= viewH) {
    return { onScreen: true, x: sx, y: sy, angle: 0 };
  }
  const left = Math.min(insets.left, viewW / 2);
  const right = Math.max(left, viewW - insets.right);
  const top = Math.min(insets.top, viewH / 2);
  const bottom = Math.max(top, viewH - insets.bottom);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const halfW = (right - left) / 2;
  const halfH = (bottom - top) / 2;
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty, 1);
  return { onScreen: false, x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

// 8-way compass name for a world/screen offset (y grows downwards, so -y is north).
export function compassDirection(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return "here";
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return COMPASS[(octant + 8) % 8];
}

// Arrow opacity: full while blows land, easing out over the last second of the server's window
// (quiet = seconds since the last blow), and faded to 0 over fadeMs once the server drops the fight.
export function fightArrowAlpha(quiet: number, windowSeconds: number, goneForMs: number, fadeMs: number): number {
  const base = Math.max(0.25, Math.min(1, windowSeconds - quiet));
  return goneForMs > 0 ? base * Math.max(0, 1 - goneForMs / fadeMs) : base;
}
