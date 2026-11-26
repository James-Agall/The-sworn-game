// Pure grid operations for the Area tab's painter, on the game's ASCII rows (string[], one character per cell).
// No game rules here (those stay in the game's validators); just painting geometry. Every function returns new rows.
export type Cell = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const gridW = (rows: readonly string[]) => rows[0]?.length ?? 0;
export const inGrid = (rows: readonly string[], x: number, y: number) => y >= 0 && y < rows.length && x >= 0 && x < (rows[y]?.length ?? 0);
export const cellAt = (rows: readonly string[], x: number, y: number) => (inGrid(rows, x, y) ? rows[y][x] : undefined);

export function blankRows(w: number, h: number, ch = "."): string[] {
  return Array.from({ length: h }, () => ch.repeat(w));
}

/** Set `ch` on every listed cell that is inside the grid. */
export function paint(rows: readonly string[], cells: Iterable<Cell>, ch: string): string[] {
  const g = rows.map((r) => [...r]);
  for (const { x, y } of cells) if (y >= 0 && y < g.length && x >= 0 && x < g[y].length) g[y][x] = ch;
  return g.map((r) => r.join(""));
}

/** Cells of a straight line (Bresenham), both ends included. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** A rectangle between two corners: every cell (filled) or the outline. */
export function rectCells(x0: number, y0: number, x1: number, y1: number, filled: boolean): Cell[] {
  const r = normRect(x0, y0, x1, y1), out: Cell[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (filled || x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1) out.push({ x, y });
  }
  return out;
}

/** The 4-connected region of the same symbol as (x, y). */
export function floodCells(rows: readonly string[], x: number, y: number): Cell[] {
  const target = cellAt(rows, x, y);
  if (target === undefined) return [];
  const w = gridW(rows), h = rows.length, seen = new Uint8Array(w * h), out: Cell[] = [], stack = [y * w + x];
  seen[y * w + x] = 1;
  while (stack.length) {
    const i = stack.pop()!, cx = i % w, cy = (i - cx) / w;
    out.push({ x: cx, y: cy });
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ddx, ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || rows[ny][nx] !== target) continue;
      seen[ny * w + nx] = 1;
      stack.push(ny * w + nx);
    }
  }
  return out;
}
export function floodFill(rows: readonly string[], x: number, y: number, ch: string): string[] {
  if (cellAt(rows, x, y) === ch) return rows.slice();
  return paint(rows, floodCells(rows, x, y), ch);
}

/** Mirror painting: each cell plus its reflection(s) across the grid's vertical (h) / horizontal (v) centre line. */
export function mirrorCells(cells: readonly Cell[], w: number, h: number, horizontal: boolean, vertical: boolean): Cell[] {
  const key = new Set<string>(), out: Cell[] = [];
  const add = (x: number, y: number) => { const k = x + "," + y; if (!key.has(k)) { key.add(k); out.push({ x, y }); } };
  for (const c of cells) {
    add(c.x, c.y);
    if (horizontal) add(w - 1 - c.x, c.y);
    if (vertical) add(c.x, h - 1 - c.y);
    if (horizontal && vertical) add(w - 1 - c.x, h - 1 - c.y);
  }
  return out;
}

/** The sub-grid inside `r` (clipped to the grid). */
export function extract(rows: readonly string[], r: Rect): string[] {
  const out: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    if (y < 0 || y >= rows.length) continue;
    out.push(rows[y].slice(Math.max(0, r.x), Math.max(0, r.x + r.w)));
  }
  return out;
}
/** Fill `r` with `ch` (cut / delete a selection). */
export function fillRect(rows: readonly string[], r: Rect, ch: string): string[] {
  return paint(rows, rectCells(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, true), ch);
}
/** Paste `block` with its top-left at (x, y); cells off the grid are dropped; `skip` symbols are transparent. */
export function pasteBlock(rows: readonly string[], block: readonly string[], x: number, y: number, skip?: string): string[] {
  const g = rows.map((r) => [...r]);
  block.forEach((line, by) => {
    for (let bx = 0; bx < line.length; bx++) {
      const gx = x + bx, gy = y + by;
      if (gy < 0 || gy >= g.length || gx < 0 || gx >= g[gy].length || line[bx] === skip) continue;
      g[gy][gx] = line[bx];
    }
  });
  return g.map((r) => r.join(""));
}
/** Move the selection `r` by (dx, dy): the vacated cells become `fill`. */
export function moveRect(rows: readonly string[], r: Rect, dx: number, dy: number, fill: string): string[] {
  const block = extract(rows, r);
  return pasteBlock(fillRect(rows, r, fill), block, r.x + dx, r.y + dy);
}

/** Mirror left-right / a quarter turn clockwise of a block (the same convention as the game's transformRows). */
export const flipH = (rows: readonly string[]) => rows.map((r) => [...r].reverse().join(""));
export const flipV = (rows: readonly string[]) => rows.slice().reverse();
export function rotateCW(rows: readonly string[]): string[] {
  const h = rows.length, w = gridW(rows), out: string[] = [];
  for (let x = 0; x < w; x++) { let r = ""; for (let y = h - 1; y >= 0; y--) r += rows[y][x]; out.push(r); }
  return out;
}

export type Anchor = { ax: 0 | 1 | 2; ay: 0 | 1 | 2 };
/**
 * Resize to w x h keeping the content at the anchor (0 left / top, 1 centre, 2 right / bottom); new cells are `fill`.
 * Returns the new rows and where the old (0, 0) went (dx, dy), so placed objects (settlement buildings) can follow.
 */
export function resize(rows: readonly string[], w: number, h: number, anchor: Anchor, fill = "."): { rows: string[]; dx: number; dy: number } {
  const ow = gridW(rows), oh = rows.length;
  const off = (o: number, n: number, a: number) => (a === 0 ? 0 : a === 2 ? n - o : Math.floor((n - o) / 2));
  const dx = off(ow, w, anchor.ax), dy = off(oh, h, anchor.ay);
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = "";
    for (let x = 0; x < w; x++) r += rows[y - dy]?.[x - dx] ?? fill;
    out.push(r);
  }
  return { rows: out, dx, dy };
}

/** All cells holding `ch`. */
export function findAll(rows: readonly string[], ch: string): Cell[] {
  const out: Cell[] = [];
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === ch) out.push({ x, y }); });
  return out;
}

/**
 * A single-instance symbol (a camp's hearth H, a settlement's keep K): painting it at (x, y) removes every other copy
 * (they become `fill`), i.e. the symbol MOVES. Returns the rows and the cells that were cleared.
 */
export function placeUnique(rows: readonly string[], ch: string, x: number, y: number, fill = "."): { rows: string[]; moved: Cell[] } {
  const others = findAll(rows, ch).filter((c) => c.x !== x || c.y !== y);
  return { rows: paint(paint(rows, others, fill), [{ x, y }], ch), moved: others };
}

/** The cells whose symbol is not in `legend` (Import marks them). */
export function unknownSymbols(rows: readonly string[], legend: Record<string, unknown>): Cell[] {
  const out: Cell[] = [];
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (!(r[x] in legend)) out.push({ x, y }); });
  return out;
}
