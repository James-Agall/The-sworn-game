// Client-side view transform: the server's world stays axis-aligned; the client may draw it rotated
// (tiles as diamonds) and zoomed further in. Pure maths, no DOM / Pixi, so plain node can unit-test
// it (client/view-transform-test.mjs runs this file with node's type stripping: keep it to erasable
// TypeScript, no enums or parameter properties).
//
// The world container is rotated by `angle` about the world origin, scaled by `zoom`, and offset to
// (x, y) on screen, exactly like a Pixi Container (rotation positive = clockwise on a y-down screen):
//   screen = (x, y) + zoom * R(angle) * world

export const VIEW_PREF_KEY = "sworn.viewRotation";
export const ROTATED_VIEW_ANGLE = Math.PI / 4;
// Extra zoom on top of the base zoom in the rotated view (everything 50% larger).
export const ROTATED_VIEW_SCALE = 1.5;

export interface ViewSettings {
  angle: number;
  scale: number;
}

// "classic" = the original axis-aligned view at its original size; anything else (incl. unset) = rotated.
export function viewSettingsFor(pref: string | null): ViewSettings {
  return pref === "classic" ? { angle: 0, scale: 1 } : { angle: ROTATED_VIEW_ANGLE, scale: ROTATED_VIEW_SCALE };
}

export interface ViewState {
  angle: number;
  zoom: number;
  // Screen position of the world origin (the container's position).
  x: number;
  y: number;
}

export interface Vec {
  x: number;
  y: number;
}

// Rotate (dx, dy) by `angle` (clockwise on screen). Angle 0 returns the vector unchanged.
export function rotateVector(angle: number, dx: number, dy: number): Vec {
  if (angle === 0) return { x: dx, y: dy };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * dx - s * dy, y: s * dx + c * dy };
}

export function worldToScreen(v: ViewState, wx: number, wy: number): Vec {
  const r = rotateVector(v.angle, wx * v.zoom, wy * v.zoom);
  return { x: v.x + r.x, y: v.y + r.y };
}

export function screenToWorld(v: ViewState, sx: number, sy: number): Vec {
  return rotateVector(-v.angle, (sx - v.x) / v.zoom, (sy - v.y) / v.zoom);
}

// Container position that puts world point (fx, fy) at screen point (cx, cy).
export function cameraPosition(angle: number, zoom: number, cx: number, cy: number, fx: number, fy: number): Vec {
  const r = rotateVector(angle, fx * zoom, fy * zoom);
  return { x: cx - r.x, y: cy - r.y };
}

// The screen rectangle (x0, y0)-(x1, y1) as a world-space quad (corners in screen order TL, TR, BR, BL).
export function screenRectToWorldQuad(v: ViewState, x0: number, y0: number, x1: number, y1: number): Vec[] {
  return [screenToWorld(v, x0, y0), screenToWorld(v, x1, y0), screenToWorld(v, x1, y1), screenToWorld(v, x0, y1)];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// World-space axis-aligned bounding box of a screen rectangle (for culling).
export function visibleWorldBounds(v: ViewState, x0: number, y0: number, x1: number, y1: number): Bounds {
  const q = screenRectToWorldQuad(v, x0, y0, x1, y1);
  return {
    minX: Math.min(q[0].x, q[1].x, q[2].x, q[3].x),
    minY: Math.min(q[0].y, q[1].y, q[2].y, q[3].y),
    maxX: Math.max(q[0].x, q[1].x, q[2].x, q[3].x),
    maxY: Math.max(q[0].y, q[1].y, q[2].y, q[3].y),
  };
}

// Draw-order key for a tile (tx, ty) on a map `worldTiles` wide: increases with the tile's screen y,
// ties broken by screen x, and neighbouring tiles' keys are always >= 1 apart (so +-0.5 slots between
// them stay free) at the angles the client uses (0, PI/4, also PI/2). Angle 0 orders exactly like
// the row-major index ty * worldTiles + tx.
export function depthKey(angle: number, tx: number, ty: number, worldTiles: number): number {
  if (angle === 0) return ty * worldTiles + tx;
  const r = rotateVector(angle, tx, ty);
  return r.y * 4 * worldTiles + r.x + 2 * worldTiles;
}
