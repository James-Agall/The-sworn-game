// Drawing templates, previews and thumbnails with the game's tile art (art.ts) onto canvases: one cell = `cell` px.
import {
  TileType, legendFor, gridOf, interiorLayout, buildingCells, buildingPieceTiles, spriteBuildingCells, TIER_COLOR, type BuildingLookup, type Kind,
  type AnyTemplate, type InteriorFile, type SettlementTemplate, type SiteTemplateFile, type Preview,
} from "../../../shared/area.ts";
import { renderInteriorRows } from "./interior.ts";
import { GROUND_URL, drawFitted, drawable, image, tileArt } from "./art.ts";

const WALLISH = new Set<number>([TileType.Wall, TileType.StoneWall, TileType.WoodWindow, TileType.StoneWindow, TileType.WoodDoor, TileType.StoneDoor, TileType.Gate]);
const FLAT = new Set<number>([TileType.WoodFloor, TileType.StoneFloor, TileType.Road, TileType.CobbleRoad, TileType.Water, TileType.Moat, TileType.FarmPlot]);

export function cellSizeFor(w: number, h: number): number {
  return Math.max(12, Math.min(48, Math.floor(2600 / Math.max(w, h, 1))));
}

function ground(g: CanvasRenderingContext2D, x: number, y: number, c: number) {
  const img = image(GROUND_URL);
  if (img) g.drawImage(img, x, y, c, c);
  else { g.fillStyle = "#6f8d4e"; g.fillRect(x, y, c, c); }
}

function swatch(g: CanvasRenderingContext2D, color: string, ch: string, x: number, y: number, c: number, round: boolean) {
  g.fillStyle = color;
  if (round) { g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.32, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = Math.max(1, c / 16); g.stroke(); }
  else { g.fillRect(x + c * 0.12, y + c * 0.12, c * 0.76, c * 0.76); }
  if (c >= 14) {
    g.font = `bold ${Math.floor(c * 0.42)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "rgba(0,0,0,0.75)"; g.fillText(ch, x + c / 2 + 1, y + c / 2 + 1);
    g.fillStyle = "#fff"; g.fillText(ch, x + c / 2, y + c / 2);
  }
}

/** One tile's art in the cell (span = 2-cell pieces: the anchor draws across both cells). Returns false if no art. */
export function drawTile(g: CanvasRenderingContext2D, tile: number, x: number, y: number, c: number, horizontal = true, spanW = 1, spanH = 1): boolean {
  if (tile === TileType.FurniturePartW || tile === TileType.FurniturePartN) return true;
  const spec = tileArt(tile, horizontal);
  if (!spec) return false;
  const src = drawable(spec);
  if (!src) return true;                         // still loading: the listener redraws
  if (FLAT.has(tile)) g.drawImage(src, x, y, c * spanW, c * spanH);
  else drawFitted(g, src, x, y, c * spanW, c * spanH);
  return true;
}

type TileGrid = { w: number; h: number; tile: (x: number, y: number) => number };
const horizontalAt = (tg: TileGrid, x: number, y: number) => {
  const l = x > 0 && WALLISH.has(tg.tile(x - 1, y)), r = x < tg.w - 1 && WALLISH.has(tg.tile(x + 1, y));
  const u = y > 0 && WALLISH.has(tg.tile(x, y - 1)), d = y < tg.h - 1 && WALLISH.has(tg.tile(x, y + 1));
  return l || r || !(u || d);
};

/**
 * The editor's grid: every cell's symbol drawn with its tile art over grass (slots / no-tile symbols as markers, symbols
 * without art as swatches); settlements also draw their building refs (the buildings' own cells, or the 3x3 prefab).
 */
export function renderTemplate(kind: Kind, t: AnyTemplate, lookup: BuildingLookup, cell: number, layer = "rows"): HTMLCanvasElement {
  if (kind === "interiors") {
    const l = interiorLayout(t as InteriorFile, layer);
    return renderInteriorRows(l?.rows ?? [], l?.floor ?? "wood", l?.wall ?? "wood", cell);
  }
  // a site's tier grid: the tile art (dimmed) under each cell's tier digit
  const rows = gridOf(kind, t, "rows"), h = rows.length, w = rows[0]?.length ?? 0;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, w * cell); cv.height = Math.max(1, h * cell);
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  const legend = legendFor(kind, t, "rows");
  const pieces = kind === "buildings" ? buildingPieceTiles(rows).tiles : null;
  const tileOf = (x: number, y: number) => {
    const ch = rows[y]?.[x];
    if (pieces) return pieces[y]?.[x] ?? -1;
    return ch !== undefined ? legend[ch]?.tile ?? -1 : -1;
  };
  const tg: TileGrid = { w, h, tile: tileOf };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ground(g, x * cell, y * cell, cell);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x], s = legend[ch];
    if (!s) { swatch(g, "#ff00ff", "?", x * cell, y * cell, cell, false); continue; }
    const tile = tileOf(x, y);
    if (tile >= 0) {
      const spanW = pieces && pieces[y][x + 1] === TileType.FurniturePartW ? 2 : 1, spanH = pieces && pieces[y + 1]?.[x] === TileType.FurniturePartN ? 2 : 1;
      if (!drawTile(g, tile, x * cell, y * cell, cell, horizontalAt(tg, x, y), spanW, spanH)) swatch(g, s.color, ch, x * cell, y * cell, cell, false);
      if (s.slot) swatch(g, s.color, ch, x * cell + cell * 0.25, y * cell + cell * 0.25, cell * 0.5, true);
    } else if (s.slot) swatch(g, s.color, ch, x * cell, y * cell, cell, true);
    else if (ch !== ".") { g.fillStyle = s.color + "88"; g.fillRect(x * cell, y * cell, cell, cell); }
  }
  if (kind === "settlements") drawRefs(g, t as SettlementTemplate, lookup, cell);
  if (kind === "sites" && layer === "tiers") drawTiers(g, t as SiteTemplateFile, cell);
  return cv;
}

function drawTiers(g: CanvasRenderingContext2D, t: SiteTemplateFile, cell: number) {
  const tiers = Array.isArray(t.tiers) ? t.tiers : [];
  g.fillStyle = "rgba(10,12,16,0.55)"; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.font = `bold ${Math.max(9, Math.floor(cell * 0.55))}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let y = 0; y < tiers.length; y++) for (let x = 0; x < (tiers[y]?.length ?? 0); x++) {
    const ch = tiers[y][x];
    if (ch === ".") continue;
    const n = Number(ch);
    g.fillStyle = (TIER_COLOR[n] ?? "#ff00ff") + "99"; g.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    if (cell >= 10) { g.fillStyle = "#fff"; g.fillText(ch, x * cell + cell / 2, y * cell + cell / 2 + 1); }
  }
}

function drawRefs(g: CanvasRenderingContext2D, t: SettlementTemplate, lookup: BuildingLookup, cell: number) {
  for (const b of t.buildings) {
    const bt = lookup(b.ref);
    if (!bt) continue;
    if (t.spriteBuildings) {
      const c = spriteBuildingCells(bt).cells[0];
      g.fillStyle = "rgba(70,55,35,0.35)"; g.fillRect(b.x * cell, b.y * cell, 3 * cell, 3 * cell);
      drawTile(g, c.tile, b.x * cell, b.y * cell, 3 * cell);
      continue;
    }
    const bc = buildingCells(bt, b.transform ?? 0);
    const grid = new Map(bc.cells.map((c) => [c.x + "," + c.y, c.tile]));
    const tg: TileGrid = { w: bc.w, h: bc.h, tile: (x, y) => grid.get(x + "," + y) ?? -1 };
    for (const c of bc.cells) {
      const spanW = grid.get(c.x + 1 + "," + c.y) === TileType.FurniturePartW ? 2 : 1, spanH = grid.get(c.x + "," + (c.y + 1)) === TileType.FurniturePartN ? 2 : 1;
      drawTile(g, c.tile, (b.x + c.x) * cell, (b.y + c.y) * cell, cell, horizontalAt(tg, c.x, c.y), spanW, spanH);
    }
  }
}

/** A building template's thumbnail (its own cells, transform applied) at `cell` px per cell. */
export function renderBuildingThumb(bt: Parameters<typeof buildingCells>[0], transform: number, cell: number): HTMLCanvasElement {
  const bc = buildingCells(bt, transform);
  const cv = document.createElement("canvas");
  cv.width = bc.w * cell; cv.height = bc.h * cell;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.fillStyle = "#4d6338"; g.fillRect(0, 0, cv.width, cv.height);
  const grid = new Map(bc.cells.map((c) => [c.x + "," + c.y, c.tile]));
  const tg: TileGrid = { w: bc.w, h: bc.h, tile: (x, y) => grid.get(x + "," + y) ?? -1 };
  for (const c of bc.cells) {
    const spanW = grid.get(c.x + 1 + "," + c.y) === TileType.FurniturePartW ? 2 : 1, spanH = grid.get(c.x + "," + (c.y + 1)) === TileType.FurniturePartN ? 2 : 1;
    drawTile(g, c.tile, c.x * cell, c.y * cell, cell, horizontalAt(tg, c.x, c.y), spanW, spanH);
  }
  return cv;
}

/** What a stamp preview grid looks like: the stamped tiles (real art), plus overlay data the tab draws on top. */
export type StampView = {
  w: number; h: number; tiles: number[]; owned?: number[]; grounds?: number[];
  markers: { x: number; y: number; kind: string; label: string; color: string }[];
  footprints: { x: number; y: number; w: number; h: number; label: string }[];
  arrow?: { side: string };
  // spriteBuildings settlements: draw each footprint's centre tile (the prefab) across its footprint, as the editor does
  prefab?: boolean;
  info: string[]; source: "shared-code" | "server-stamper";
};

const SLOT_COLOR: Record<string, string> = {
  guard: "#c03030", prisoner: "#40a070", loot: "#ffd84a", trader: "#2060c0", priest: "#f0f0ff", villager: "#20a060", quest: "#a040c0",
  worker: "#2060c0", npc: "#20a060", keep: "#c02020", hearth: "#e2572b", mob: "#ff4040",
};
export const slotColor = (k: string) => SLOT_COLOR[k] ?? "#ffffff";

export function viewFromPreview(p: Preview): StampView {
  const markers: StampView["markers"] = p.slots.map((s) => ({ x: s.x, y: s.y, kind: s.kind, label: s.guard ? s.guard.replace("bandit", "")[0] : s.kind[0], color: slotColor(s.kind) }));
  if (p.hearth) markers.push({ ...p.hearth, kind: "hearth", label: "H", color: slotColor("hearth") });
  if (p.keep) markers.push({ ...p.keep, kind: "keep", label: "K", color: slotColor("keep") });
  return {
    w: p.w, h: p.h, tiles: p.cells.map((c) => c.tile), owned: p.kind === "settlements" ? p.cells.map((c) => (c.owned ? 1 : 0)) : undefined,
    markers, footprints: p.footprints.map((f) => ({ ...f, label: f.ref })), arrow: p.entrance ? { side: p.entrance } : p.doorSide ? { side: p.doorSide } : undefined,
    info: Object.entries(p.stats).map(([k, v]) => `${k} ${v}`), prefab: p.prefab, source: "shared-code",
  };
}

export function renderStamp(v: StampView, cell: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = v.w * cell; cv.height = v.h * cell;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  const tg: TileGrid = { w: v.w, h: v.h, tile: (x, y) => v.tiles[y * v.w + x] ?? -1 };
  for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) ground(g, x * cell, y * cell, cell);
  const big = new Set<number>();
  if (v.prefab) for (const f of v.footprints) big.add((f.y + (f.h >> 1)) * v.w + f.x + (f.w >> 1));
  for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) {
    const tile = v.tiles[y * v.w + x];
    if (tile <= 0 || big.has(y * v.w + x)) continue;   // -1 / Empty: open ground; prefabs below
    const spanW = tg.tile(x + 1, y) === TileType.FurniturePartW ? 2 : 1, spanH = tg.tile(x, y + 1) === TileType.FurniturePartN ? 2 : 1;
    if (!drawTile(g, tile, x * cell, y * cell, cell, horizontalAt(tg, x, y), spanW, spanH)) { g.fillStyle = "#ff00ff88"; g.fillRect(x * cell, y * cell, cell, cell); }
  }
  if (v.prefab) for (const f of v.footprints) {
    const tile = v.tiles[(f.y + (f.h >> 1)) * v.w + f.x + (f.w >> 1)];
    if (tile > 0) drawTile(g, tile, f.x * cell, f.y * cell, f.w * cell, true, 1, 1);
  }
  return cv;
}
