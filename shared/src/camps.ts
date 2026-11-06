// camps.ts: bandit camp templates (blueprints), shared by the server (world-gen stamper, template store) and the
// client's creative-mode camp editor. A template is an ASCII grid (CAMP_LEGEND) around exactly one hearth "H":
// tiles to stamp, guard / prisoner / loot slots, plus metadata (tier 1-3, world-gen weight, min distance from the
// start, guard count range, entrance side, whether world-gen may rotate / mirror it). Built-ins live in
// server/data/camps/*.json, the editor's saves in server/data/camps/user/*.json; both load at boot.
import { TileType } from "./protocol.js";

export type CampEntrance = "N" | "E" | "S" | "W";

export interface CampTemplate {
  id: string;
  name: string;
  tier: number;
  // World-gen pick weight among the pool (0: never placed by world-gen, only stamped from the editor).
  weight: number;
  // World-gen keeps this template at least this many tiles from the start (clamped on small worlds).
  minStartDist: number;
  // Guards stamped: a count in [min, max] (capped by the guard slots), on shuffled guard slots.
  guards: [number, number];
  entrance: CampEntrance;
  rotate: boolean;
  mirror: boolean;
  rows: string[];
  // Set by the server on the list it sends: a built-in (read-only in the editor) or a user template.
  builtin?: boolean;
}

export interface CampSymbol {
  label: string;
  // Tile stamped there (undefined: the cell stays / is cleared to open ground).
  tile?: TileType;
  slot?: "guard" | "prisoner" | "loot";
  // A guard slot's fixed kind (missing: weighted pick by the camp's tier).
  guard?: "banditClubman" | "banditArcher" | "banditElite";
  // Editor swatch colour.
  color: string;
}

// "." open ground (must be clear at stamp time). Solid: H # T W x b c L r +; walkable: . g m a e p.
// W "watch post": a lantern lookout (decor; a firing tower would need site ownership + its own art).
export const CAMP_LEGEND: Record<string, CampSymbol> = {
  ".": { label: "Open ground", color: "#c9d6a0" },
  H: { label: "Hearth (camp fire)", tile: TileType.PropCampfire, color: "#e2572b" },
  "#": { label: "Palisade (fence)", tile: TileType.PropFence, color: "#7a5230" },
  T: { label: "Tent", tile: TileType.Tent, color: "#c8a070" },
  W: { label: "Watch post (lantern)", tile: TileType.PropLanternPost, color: "#f0c040" },
  x: { label: "Crate", tile: TileType.PropCrate, color: "#a87a3c" },
  b: { label: "Barrel", tile: TileType.PropBarrel, color: "#8a5a2a" },
  c: { label: "Cart", tile: TileType.PropCart, color: "#9b6b3b" },
  r: { label: "Rubble", tile: TileType.RuinRubble, color: "#8c8c84" },
  "+": { label: "Grave", tile: TileType.PropCross, color: "#d8d8d0" },
  L: { label: "Loot chest", tile: TileType.PropCrate, slot: "loot", color: "#ffd84a" },
  g: { label: "Guard (any, by tier)", slot: "guard", color: "#c03030" },
  m: { label: "Guard: clubman", slot: "guard", guard: "banditClubman", color: "#e04848" },
  a: { label: "Guard: archer", slot: "guard", guard: "banditArcher", color: "#3070c0" },
  e: { label: "Guard: elite", slot: "guard", guard: "banditElite", color: "#8030a0" },
  p: { label: "Prisoner", slot: "prisoner", color: "#40a070" },
};

export const CAMP_SIZE_MIN = 5;
export const CAMP_SIZE_MAX = 31;
export const CAMP_GUARDS_MAX = 24;
export const CAMP_PRISONER_SLOTS_MAX = 12;
export const CAMP_LOOT_SLOTS_MAX = 8;
const ENTRANCES: CampEntrance[] = ["N", "E", "S", "W"];

export function campSymbolWalkable(ch: string): boolean {
  const s = CAMP_LEGEND[ch];
  return !!s && s.tile === undefined;
}

export interface CampCell {
  dx: number;
  dy: number;
  ch: string;
}

// The template's cells (every non-"." symbol) as offsets from the hearth after `transform` (0-7: bits 0-1 =
// quarter turns clockwise, bit 2 = mirror left-right first).
export function campCells(t: Pick<CampTemplate, "rows">, transform = 0): CampCell[] {
  let hx = 0;
  let hy = 0;
  t.rows.forEach((row, y) => {
    const x = row.indexOf("H");
    if (x >= 0) [hx, hy] = [x, y];
  });
  const out: CampCell[] = [];
  t.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      const [dx, dy] = transformOffset(x - hx, y - hy, transform);
      out.push({ dx, dy, ch: row[x] });
    }
  });
  return out;
}

export function transformOffset(dx: number, dy: number, transform: number): [number, number] {
  let x = transform & 4 ? -dx : dx;
  let y = dy;
  for (let k = 0; k < (transform & 3); k++) [x, y] = [-y, x];
  // Normalise -0.
  return [x + 0, y + 0];
}

export function transformEntrance(e: CampEntrance, transform: number): CampEntrance {
  let i = ENTRANCES.indexOf(e);
  if (transform & 4 && (e === "E" || e === "W")) i = (i + 2) % 4;
  return ENTRANCES[(i + (transform & 3)) % 4];
}

// The rows rotated / mirrored (the editor's buttons): a new grid, the hearth wherever it lands.
export function transformRows(rows: string[], transform: number): string[] {
  let out = transform & 4 ? rows.map((r) => [...r].reverse().join("")) : rows.slice();
  for (let k = 0; k < (transform & 3); k++) {
    // A quarter turn clockwise: new row x = old column x read bottom to top.
    const h = out.length;
    const w = out[0]?.length ?? 0;
    const turned: string[] = [];
    for (let x = 0; x < w; x++) {
      let r = "";
      for (let y = h - 1; y >= 0; y--) r += out[y][x];
      turned.push(r);
    }
    out = turned;
  }
  return out;
}

// Chebyshev radius of the template around its hearth (the footprint world-gen keeps clear).
export function campRadius(t: Pick<CampTemplate, "rows">): number {
  let hx = 0;
  let hy = 0;
  t.rows.forEach((row, y) => {
    const x = row.indexOf("H");
    if (x >= 0) [hx, hy] = [x, y];
  });
  const h = t.rows.length;
  const w = t.rows[0]?.length ?? 0;
  return Math.max(hx, w - 1 - hx, hy, h - 1 - hy);
}

export interface CampStats {
  w: number;
  h: number;
  guardSlots: number;
  prisonerSlots: number;
  lootSlots: number;
  radius: number;
}

export function campStats(t: Pick<CampTemplate, "rows">): CampStats {
  let guardSlots = 0;
  let prisonerSlots = 0;
  let lootSlots = 0;
  for (const row of t.rows) for (const ch of row) {
    const slot = CAMP_LEGEND[ch]?.slot;
    if (slot === "guard") guardSlots++;
    else if (slot === "prisoner") prisonerSlots++;
    else if (slot === "loot") lootSlots++;
  }
  return { w: t.rows[0]?.length ?? 0, h: t.rows.length, guardSlots, prisonerSlots, lootSlots, radius: campRadius(t) };
}

// Every problem with a template (empty: valid). Checks the shape, the legend, one hearth, slot counts, the
// metadata ranges, and that the outside reaches the hearth's side and every guard slot (4-way walking).
export function validateCampTemplate(t: unknown): string[] {
  const errs: string[] = [];
  const o = t as Partial<CampTemplate> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  if (typeof o.name !== "string" || o.name.trim().length === 0 || o.name.length > 40) errs.push("name: 1-40 characters");
  if (!Number.isInteger(o.tier) || o.tier! < 1 || o.tier! > 3) errs.push("tier: 1, 2 or 3");
  if (typeof o.weight !== "number" || !(o.weight >= 0 && o.weight <= 100)) errs.push("weight: 0-100");
  if (typeof o.minStartDist !== "number" || !(o.minStartDist >= 0 && o.minStartDist <= 400)) errs.push("minStartDist: 0-400");
  if (!ENTRANCES.includes(o.entrance as CampEntrance)) errs.push("entrance: N, E, S or W");
  if (typeof o.rotate !== "boolean" || typeof o.mirror !== "boolean") errs.push("rotate / mirror: true or false");
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) return [...errs, "rows: a list of strings"];
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h < CAMP_SIZE_MIN || h > CAMP_SIZE_MAX || w < CAMP_SIZE_MIN || w > CAMP_SIZE_MAX) errs.push(`size: ${CAMP_SIZE_MIN}-${CAMP_SIZE_MAX} each way (is ${w}x${h})`);
  let hearths = 0;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      errs.push(`row ${y}: ${rows[y].length} wide, not ${w}`);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!(ch in CAMP_LEGEND)) errs.push(`unknown symbol "${ch}" at ${x},${y}`);
      if (ch === "H") hearths++;
    }
  }
  if (hearths !== 1) errs.push(`exactly one hearth H (has ${hearths})`);
  if (errs.length > 0) return errs;
  const st = campStats({ rows });
  const g = o.guards;
  if (!Array.isArray(g) || g.length !== 2 || !Number.isInteger(g[0]) || !Number.isInteger(g[1]) || g[0] < 1 || g[0] > g[1] || g[1] > CAMP_GUARDS_MAX) {
    errs.push(`guards: [min, max], 1 <= min <= max <= ${CAMP_GUARDS_MAX}`);
  } else if (g[1] > st.guardSlots) errs.push(`guards: max ${g[1]} but only ${st.guardSlots} guard slots`);
  if (st.guardSlots === 0) errs.push("at least one guard slot");
  if (st.prisonerSlots > CAMP_PRISONER_SLOTS_MAX) errs.push(`at most ${CAMP_PRISONER_SLOTS_MAX} prisoner slots`);
  if (st.lootSlots > CAMP_LOOT_SLOTS_MAX) errs.push(`at most ${CAMP_LOOT_SLOTS_MAX} loot chests`);
  // Reachability: flood from every walkable border cell (the ground around the camp is open).
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && campSymbolWalkable(rows[y][x])) {
      seen[y * w + x] = 1;
      queue.push(y * w + x);
    }
  }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + ddx;
      const ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !campSymbolWalkable(rows[ny][nx])) continue;
      seen[ny * w + nx] = 1;
      queue.push(ny * w + nx);
    }
  }
  let hearthReached = false;
  let sealedGuards = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    if (CAMP_LEGEND[ch].slot === "guard" && !seen[y * w + x]) sealedGuards++;
    if (ch !== "H") continue;
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ddx;
      const ny = y + ddy;
      // A hearth on the grid's edge is reachable from outside.
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx]) hearthReached = true;
    }
  }
  if (!hearthReached) errs.push("the hearth is walled in: no way from outside to a side of it");
  if (sealedGuards > 0) errs.push(`${sealedGuards} guard slot(s) walled in (unreachable from outside)`);
  return errs;
}
