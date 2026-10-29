// Formation slots for group move orders, shared by client and server (strategy mode phase 3; docs
// PLAN-strategy-mode.md §4 "Shared formation code"). Lives in the @colony/shared workspace package, which
// both sides import. Pure: units in, slot points out. The client draws its ghosts with the same
// functions the server forms regiments with, so a ghost marks where the units stop. Moved out of the
// client's main.ts (computeFormationTargets / computeLineFormationTargets), behaviour unchanged.
import { TILE_SIZE, isRearRole, unitRole } from "./protocol.js";
import type { ColonistKind, FormationShape, HeroClass, Stance } from "./protocol.js";

// The fields a formation reads (a ColonistSnapshot on the client, a Colonist on the server).
export interface FormationUnit {
  id: string;
  kind: ColonistKind;
  x: number;
  y: number;
  heroClass?: HeroClass;
  stance: Stance;
  // Strategy mode phase 4: the unit's regiment shape (omitted = "line").
  shape?: FormationShape;
}
export interface FormationSlot {
  x: number;
  y: number;
  rear?: boolean;
}
export interface FormationPlan {
  targets: Map<string, FormationSlot>;
  spacing: number;
  // Unit facing (the front's normal); the front row is centred on the destination.
  fx: number;
  fy: number;
  frontHalfWidth: number;
}

// Formation rank for a group move order, front to back (0 = closest to the destination, i.e.
// leads the march). Knights (shock) and rams take the front row's centre (centreShock); cavalry
// (fast) the wings; catapults join the archers' rear line.
export const FORMATION_RANK: Record<string, number> = {
  knight: 0,
  cavalry: 0,
  batteringRam: 0,
  catapult: 1,
  militia: 0,
  spearman: 0,
  pikeman: 0,
  archer: 1,
  bishop: 2,
  artillery: 3,
};
// Max units per row within a rank's block before wrapping to a row behind it (Age of Empires'
// box formation uses a similarly tight, roughly-square block per unit type rather than one
// long line).
export const FORMATION_MAX_ROW_WIDTH = 5;
// Slot spacing (both across a row and between rows), in tiles, by the group's stance. A unit's
// visible footprint is ~23-28px wide and ~31px tall (26.5px body + the HP bar 18px above center), so
// at 1.0 (32px) rows touched edge-to-edge and diagonal facings (22.6px x/y offsets) overlapped; 1.25
// leaves a visible gap at every facing. Defensive deliberately packs tighter than that (a shield-wall
// look, sprites may touch on diagonals); Aggressive spreads out. Battle discipline (2026-10-23) tightened
// every stance (was 0.9 / 1.25 / 1.5): server bodies are 14px across, so even 0.8 (25.6px) never overlaps.
export const FORMATION_SPACING_TILES: Record<Stance, number> = {
  defensive: 0.8,
  normal: 1.05,
  aggressive: 1.3,
};
// Line-drag formations (computeLineFormationTargets). Minimum frontage: never more than
// LINE_MAX_DEPTH_ROWS rows deep, so a short drag can't string the group out in single file -
//   minCols = min(n, max(2, ceil(n / LINE_MAX_DEPTH_ROWS))),  minLength = (minCols - 1) * spacing
// (n = selected units): a drag shorter than minLength is widened symmetrically about its midpoint.
// A long drag spreads the front row along it, but no wider apart than LINE_MAX_GAP x spacing (the row
// stays centred on the line), so a thin line never opens gaps for enemies to walk through.
export const LINE_MAX_DEPTH_ROWS = 3;
export const LINE_MAX_GAP = 1.5;
// Regiments & roles: with a front rank in the order, the ranged rank (archers) forms a second line
// REAR_LINE_OFFSET_TILES behind the front row (or one spacing behind the last front row, if deeper),
// at most REAR_LINE_WIDTH x the front's columns wide; fast roles take the two ends of the front row.
// A line drag faces away from the units' side, or toward the nearest enemy within
// LINE_FACE_ENEMY_TILES of the line's centre.
export const REAR_LINE_OFFSET_TILES = 2.5;
export const REAR_LINE_WIDTH = 0.7;
export const LINE_FACE_ENEMY_TILES = 12;

// One spacing per block (mixing per-unit spacing would break the grid): the most common stance
// among the group's guard-tier units; a tie for most common, or no guard units at all, is "normal".
export function groupStance(units: FormationUnit[]): Stance {
  const counts: Record<Stance, number> = { defensive: 0, normal: 0, aggressive: 0 };
  for (const u of units) if (u.kind !== "bishop") counts[u.stance]++;
  const top = Math.max(counts.defensive, counts.normal, counts.aggressive);
  const leaders = (Object.keys(counts) as Stance[]).filter((st) => counts[st] === top);
  return leaders.length === 1 ? leaders[0] : "normal";
}

// Spreads a group move order into per-unit destinations: melee in front (closest to the
// clicked point), archers behind them, healers behind that, with a reserved rear rank for a
// future artillery-type unit. Units within a rank sit side by side, perpendicular to the
// direction of travel. A single unit just goes straight to the clicked point.
// Recomputed from scratch on every order from the units' live positions (no remembered squad).
// `facing` (unit vector) overrides the default facing (current centroid -> destination).
export function computeFormationTargets(
  units: FormationUnit[],
  destX: number,
  destY: number,
  facing?: { x: number; y: number }
): FormationPlan {
  const result = new Map<string, FormationSlot>();
  const spacing = TILE_SIZE * FORMATION_SPACING_TILES[groupStance(units)];
  if (units.length <= 1) {
    for (const u of units) result.set(u.id, { x: destX, y: destY });
    return { targets: result, spacing, fx: facing?.x ?? 1, fy: facing?.y ?? 0, frontHalfWidth: 0 };
  }

  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= units.length;
  cy /= units.length;

  let fx = facing ? facing.x : destX - cx;
  let fy = facing ? facing.y : destY - cy;
  const flen = Math.hypot(fx, fy);
  if (flen < (facing ? 1e-6 : 1)) {
    fx = 1;
    fy = 0;
  } else {
    fx /= flen;
    fy /= flen;
  }
  const px = -fy;
  const py = fx;

  const { ranks, fast, hasFront } = formationRanks(units);

  // Age of Empires-style box formation: each rank fills its own tight rectangular block (up
  // to FORMATION_MAX_ROW_WIDTH units per row, wrapping to further rows behind), rather than
  // one long single-file line — so a 10-pikeman front rank reads as a 5x2 block, not a row
  // ten units wide. Ranks stack front-to-back by how many rows the ranks ahead actually used.
  const sortedRanks = Array.from(ranks.keys()).sort((a, b) => a - b);
  let depthRows = 0;
  let frontHalfWidth = 0;
  let rearShift = 0;
  for (const rank of sortedRanks) {
    const members = ranks.get(rank)!;
    const rear = hasFront && isRearRole(unitRole(members[0].kind, members[0].heroClass), members[0].kind);
    // The ranged rank stands REAR_LINE_OFFSET_TILES behind the front row (further if the front is deeper).
    if (rear) rearShift = Math.max(rearShift, REAR_LINE_OFFSET_TILES * TILE_SIZE - depthRows * spacing);
    // Hand out slots in the same spatial order units already stand in, so nobody walks across
    // a squadmate: the units furthest along the facing take the rank's front row, and within a
    // row, left-to-right (along p) maps to left-to-right. Assigning by array order instead sent
    // e.g. the leftmost unit to the rightmost slot, and mirrored every row on a turn.
    members.sort((a, b) => Number(isShockUnit(b)) - Number(isShockUnit(a)) || b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
    const n = members.length;
    const cols = Math.min(FORMATION_MAX_ROW_WIDTH, n);
    const rowCount = Math.ceil(n / cols);
    if (depthRows === 0) frontHalfWidth = ((cols - 1) / 2) * spacing;
    for (let row = 0; row < rowCount; row++) {
      const rowMembers = centreShock(
        members.slice(row * cols, row * cols + cols).sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py))
      );
      const rowN = rowMembers.length;
      const depth = (depthRows + row) * spacing + rearShift;
      rowMembers.forEach((u, i) => {
        const lateral = (i - (rowN - 1) / 2) * spacing;
        result.set(u.id, {
          x: destX - depth * fx + lateral * px,
          y: destY - depth * fy + lateral * py,
          rear,
        });
      });
    }
    depthRows += rowCount;
  }
  placeFastOnWings(fast, result, destX, destY, px, py, frontHalfWidth, spacing);
  return { targets: result, spacing, fx, fy, frontHalfWidth };
}

// Shock troops (knights) and front-rank siege (rams) lead their rank and take the centre of its row.
export function isShockUnit(u: FormationUnit): boolean {
  const role = unitRole(u.kind, u.heroClass);
  return role === "shock" || (role === "siege" && !isRearRole(role, u.kind));
}
// `row` sorted left to right; returns it with the shock units moved onto the centre-most slots (each
// group keeping its left-to-right order, so nobody crosses a squadmate within it).
function centreShock<T extends FormationUnit>(row: T[]): T[] {
  const shock = row.filter(isShockUnit);
  if (shock.length === 0 || shock.length === row.length) return row;
  const rest = row.filter((u) => !isShockUnit(u));
  const mid = (row.length - 1) / 2;
  const centre = row
    .map((_, i) => i)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
    .slice(0, shock.length)
    .sort((a, b) => a - b);
  const out: T[] = new Array(row.length);
  centre.forEach((slot, i) => (out[slot] = shock[i]));
  let j = 0;
  for (let i = 0; i < row.length; i++) if (!out[i]) out[i] = rest[j++];
  return out;
}

// Formation ranks by FORMATION_RANK, minus the fast-role units (they take the front row's ends,
// see placeFastOnWings). hasFront: some unit fights in the front rank (frontline / shock / fast),
// so the ranged rank forms a second line behind it.
function formationRanks<T extends FormationUnit>(units: T[]) {
  const ranks = new Map<number, T[]>();
  const fast: T[] = [];
  let hasFront = false;
  for (const u of units) {
    const role = unitRole(u.kind, u.heroClass);
    if (role && !isRearRole(role, u.kind)) hasFront = true;
    if (role === "fast") {
      fast.push(u);
      continue;
    }
    // Hero phase 3: a hero ranks by its class's role (champion front, marksman / mage rear line).
    const rank = u.kind === "hero" ? (isRearRole(role) ? 1 : 0) : FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
    const bucket = ranks.get(rank);
    if (bucket) bucket.push(u);
    else ranks.set(rank, [u]);
  }
  return { ranks, fast, hasFront };
}

// Fast roles (flankers) on the wings: alternately right / left of the front row, one gap further out each.
function placeFastOnWings(
  fast: FormationUnit[],
  targets: Map<string, FormationSlot>,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  halfWidth: number,
  gap: number
) {
  fast
    .slice()
    .sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy))
    .forEach((u, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const lateral = side * (halfWidth + gap * (Math.floor(i / 2) + 1));
      targets.set(u.id, { x: cx + lateral * ux, y: cy + lateral * uy });
    });
}

// Custom-width formation: the player dragged a line on the ground; units spread evenly along it
// (front rank first, further ranks in rows behind) facing away from where they are now, or toward
// `foe` (the nearest enemy within LINE_FACE_ENEMY_TILES of the line's centre, found by the caller).
// `facing` (unit vector, perpendicular to the line) skips that rule.
export function computeLineFormationTargets(
  units: FormationUnit[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  opts: { foe?: { x: number; y: number } | null; facing?: { x: number; y: number } } = {}
): FormationPlan & { cx: number; cy: number } {
  const spacing = TILE_SIZE * FORMATION_SPACING_TILES[groupStance(units)];
  const dragLen = Math.hypot(bx - ax, by - ay);
  const ux = dragLen >= 1 ? (bx - ax) / dragLen : 1;
  const uy = dragLen >= 1 ? (by - ay) / dragLen : 0;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  // Minimum frontage (see LINE_MAX_DEPTH_ROWS): a short drag is widened about its midpoint.
  const minCols = Math.min(units.length, Math.max(2, Math.ceil(units.length / LINE_MAX_DEPTH_ROWS)));
  const L = Math.max(dragLen, (minCols - 1) * spacing, 1);
  let fx = -uy;
  let fy = ux;
  if (opts.facing) {
    fx = opts.facing.x;
    fy = opts.facing.y;
  } else {
    let ucx = 0;
    let ucy = 0;
    for (const u of units) {
      ucx += u.x;
      ucy += u.y;
    }
    ucx /= units.length;
    ucy /= units.length;
    // Front = the perpendicular pointing away from the units' current side of the line, or toward the
    // nearest enemy near the line when there is one.
    const foe = opts.foe;
    const toward = foe ? (foe.x - cx) * fx + (foe.y - cy) * fy : (cx - ucx) * fx + (cy - ucy) * fy;
    if (toward < 0) {
      fx = -fx;
      fy = -fy;
    }
  }
  const cols = Math.max(minCols, Math.min(units.length, Math.floor(L / spacing) + 1));
  const step = cols > 1 ? Math.min(L / (cols - 1), spacing * LINE_MAX_GAP) : 0;
  const { ranks, fast, hasFront } = formationRanks(units);
  const targets = new Map<string, FormationSlot>();
  // Depth (px behind the line) of the next row; the ranged rank behind a front is a narrower second
  // line REAR_LINE_OFFSET_TILES back (see REAR_LINE_WIDTH).
  let depth = 0;
  let frontHalfWidth = -1;
  for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
    const members = ranks.get(rank)!;
    const rear = hasFront && depth > 0 && isRearRole(unitRole(members[0].kind, members[0].heroClass), members[0].kind);
    const rankCols = rear ? Math.max(1, Math.min(members.length, Math.ceil(cols * REAR_LINE_WIDTH))) : cols;
    if (rear) depth = Math.max(depth, REAR_LINE_OFFSET_TILES * TILE_SIZE);
    members.sort((a, b) => Number(isShockUnit(b)) - Number(isShockUnit(a)) || b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
    const rowCount = Math.ceil(members.length / rankCols);
    for (let row = 0; row < rowCount; row++) {
      const rowMembers = centreShock(
        members.slice(row * rankCols, row * rankCols + rankCols).sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy))
      );
      if (frontHalfWidth < 0) frontHalfWidth = ((rowMembers.length - 1) * step) / 2;
      rowMembers.forEach((u, i) => {
        const lateral = (i - (rowMembers.length - 1) / 2) * step;
        targets.set(u.id, { x: cx - depth * fx + lateral * ux, y: cy - depth * fy + lateral * uy, rear });
      });
      depth += spacing;
    }
  }
  placeFastOnWings(fast, targets, cx, cy, ux, uy, Math.max(0, frontHalfWidth), step || spacing);
  return { targets, spacing, fx, fy, frontHalfWidth: ((cols - 1) * step) / 2, cx, cy };
}

// Strategy mode phase 4: loose order spreads every slot this much further from the front centre.
export const LOOSE_SPACING_MULT = 1.6;

// The group's shape: the most common among its units ("line" when omitted; a tie is "line").
export function groupShape(units: FormationUnit[]): FormationShape {
  const counts = new Map<FormationShape, number>();
  for (const u of units) counts.set(u.shape ?? "line", (counts.get(u.shape ?? "line") ?? 0) + 1);
  let best: FormationShape = "line";
  let top = 0;
  let tie = false;
  for (const [shape, n] of counts) {
    if (n > top) {
      best = shape;
      top = n;
      tie = false;
    } else if (n === top) {
      tie = true;
    }
  }
  return tie ? "line" : best;
}

// Re-lays a line-layout plan (front centre cx, cy) as another shape. Units keep their front-to-back,
// centre-out order (so shock stays at the front centre, archers at the back) and, within a row, their
// left-to-right order. block = ceil(sqrt(n)) columns; wedge = rows of 1, 2, 3 ... from the apex.
function reshapePlan(plan: FormationPlan, cx: number, cy: number, shape: FormationShape): FormationPlan {
  if (shape === "line" || plan.targets.size <= 1) return plan;
  const { fx, fy } = plan;
  const px = -fy;
  const py = fx;
  const entries = Array.from(plan.targets, ([id, s]) => ({ id, rear: s.rear, depth: (cx - s.x) * fx + (cy - s.y) * fy, lat: (s.x - cx) * px + (s.y - cy) * py }));
  const targets = new Map<string, FormationSlot>();
  const place = (id: string, rear: boolean | undefined, depth: number, lat: number) =>
    targets.set(id, { x: cx - depth * fx + lat * px, y: cy - depth * fy + lat * py, ...(rear ? { rear } : {}) });
  if (shape === "loose") {
    for (const e of entries) place(e.id, e.rear, e.depth * LOOSE_SPACING_MULT, e.lat * LOOSE_SPACING_MULT);
    return { targets, spacing: plan.spacing * LOOSE_SPACING_MULT, fx, fy, frontHalfWidth: plan.frontHalfWidth * LOOSE_SPACING_MULT };
  }
  entries.sort((a, b) => a.depth - b.depth || Math.abs(a.lat) - Math.abs(b.lat));
  const n = entries.length;
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = plan.spacing;
  let i = 0;
  for (let row = 0; i < n; row++) {
    const size = shape === "wedge" ? row + 1 : cols;
    const chunk = entries.slice(i, i + size).sort((a, b) => a.lat - b.lat);
    chunk.forEach((e, j) => place(e.id, e.rear, row * spacing, (j - (chunk.length - 1) / 2) * spacing));
    i += size;
  }
  return { targets, spacing, fx, fy, frontHalfWidth: shape === "wedge" ? 0 : ((Math.min(cols, n) - 1) / 2) * spacing };
}

// Regiment orders (strategy mode phase 3): the formation an order forms at (x, y). `facing` is the
// front's normal in radians, `widthTiles` the frontage of a line (omitted = the block of
// computeFormationTargets). A line without a facing faces the direction of travel. The server forms with
// this and the client draws its ghosts with it, so with a facing given both get the same slots.
// Phase 4: `shape` (default: the units' groupShape) re-lays the slots; block / wedge ignore the width.
export function planOrderFormation(
  units: FormationUnit[],
  x: number,
  y: number,
  facing?: number,
  widthTiles?: number,
  shape: FormationShape = groupShape(units)
): FormationPlan & { cx: number; cy: number } {
  let f = facing !== undefined && Number.isFinite(facing) ? { x: Math.cos(facing), y: Math.sin(facing) } : undefined;
  if (shape === "block" || shape === "wedge") widthTiles = undefined;
  if (widthTiles === undefined || units.length <= 1) return { ...reshapePlan(computeFormationTargets(units, x, y, f), x, y, shape), cx: x, cy: y };
  if (!f) {
    let ucx = 0;
    let ucy = 0;
    for (const u of units) {
      ucx += u.x;
      ucy += u.y;
    }
    const dx = x - ucx / units.length;
    const dy = y - ucy / units.length;
    const d = Math.hypot(dx, dy);
    f = d >= 1 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
  }
  // The line runs along u, with the front f = (-uy, ux), so u = (fy, -fx).
  const half = (Math.max(0, widthTiles) * TILE_SIZE) / 2;
  const ux = f.y;
  const uy = -f.x;
  const line = computeLineFormationTargets(units, x - ux * half, y - uy * half, x + ux * half, y + uy * half, { facing: f });
  return { ...reshapePlan(line, line.cx, line.cy, shape), cx: line.cx, cy: line.cy };
}
