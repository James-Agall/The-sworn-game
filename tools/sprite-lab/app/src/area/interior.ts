// Building interiors in the Area tab, drawn with the GAME'S interior art: the furniture tables of client/src/interior.ts
// (read from its source text by shared/interiorArt.ts: PROP_TILE -> STRUCTURE_FURNITURE_ART, PROP_EXTRA, the oriented
// interiors-v2 pieces, the rug, PROP_COLOR stand-in blocks, PROP_HEIGHT_PX, FLOOR_COLOR, WALL), the wired wood / stone
// floor art (spriteRegistry structureFloorUrl). Not reproduced (the room renderer does them with pixi): the 3/4 wall
// faces, the autumn atlas stairs frame (the renderer's own code-drawn stairs stand-in is used), lighting and the
// furnishInteriorEdges props are only in the PREVIEW (they come from the game's buildInteriorMap).
import interiorSrc from "../../../../../client/src/interior.ts?raw";
import { STRUCTURE_FURNITURE_ART, structureFloorUrl } from "../../../../../client/src/spriteRegistry.ts";
import { INTERIOR_LEGEND, TileType, tileByName, type InteriorMap, type InteriorFile } from "../../../shared/area.ts";
import { parseInteriorArt, propArtUrls } from "../../../shared/interiorArt.ts";
import { drawable, drawFitted, specState, type ArtSpec } from "./art.ts";

export const ART = parseInteriorArt(interiorSrc);
const furnitureUrl = (tileName: string) => { const t = tileByName(tileName); return t === undefined ? undefined : STRUCTURE_FURNITURE_ART[t as TileType]; };
const specs = new Map<string, ArtSpec | null>();
/** The art spec of a prop (facing: the oriented pieces' n / e / s / w), null when the game draws it in code. */
export function propArt(prop: string, facing = "s"): ArtSpec | null {
  const key = prop + "/" + facing;
  if (!specs.has(key)) {
    const urls = propArtUrls(ART, prop, facing, furnitureUrl);
    specs.set(key, urls.length ? { urls, source: "client/src/interior.ts" } : null);
  }
  return specs.get(key)!;
}
const hex = (n: number | undefined, d: string) => (n === undefined ? d : "#" + n.toString(16).padStart(6, "0"));
const NPC_COLOR: Record<string, string> = { "1": "#2060c0", "2": "#a040c0", v: "#20a060" };

function floorCell(g: CanvasRenderingContext2D, floor: string, x: number, y: number, c: number) {
  if (floor === "wood" || floor === "stone") {
    const src = drawable({ urls: [structureFloorUrl(floor === "stone", 0)], source: "floor" });
    if (src) { g.drawImage(src, x, y, c, c); return; }
  }
  g.fillStyle = hex(ART.floorColor[floor], "#7a6145"); g.fillRect(x, y, c, c);
}
function wallCell(g: CanvasRenderingContext2D, wall: string, x: number, y: number, c: number) {
  const w = ART.wall[wall] ?? ART.wall.wood;
  g.fillStyle = hex(w?.face, "#553319"); g.fillRect(x, y, c, c);
  g.fillStyle = hex(w?.top, "#6e4524"); g.fillRect(x, y, c, c * 0.45);
  g.strokeStyle = hex(w?.line, "#3a2210"); g.lineWidth = Math.max(1, c / 20); g.strokeRect(x + 0.5, y + 0.5, c - 1, c - 1);
}
function stairs(g: CanvasRenderingContext2D, up: boolean, x: number, y: number, c: number) {
  // the room renderer's code-drawn stand-in (steps up toward the back wall / a dark stairwell down)
  g.fillStyle = up ? "#6b4423" : "#24160a"; g.fillRect(x + c * 0.06, y + c * 0.06, c * 0.88, c * 0.88);
  for (let k = 0; k < 5; k++) {
    g.globalAlpha = up ? 1 - k * 0.12 : 0.4 + k * 0.12;
    g.fillStyle = up ? "#b07a45" : "#5a3a1c"; g.fillRect(x + c * 0.12, y + c * (0.12 + k * 0.155), c * 0.76, c * 0.09);
  }
  g.globalAlpha = 1;
}
/** A prop at its in-game height (PROP_HEIGHT_PX of the 32 px tile), bottom-centred; flat pieces fill the cell. */
export function drawProp(g: CanvasRenderingContext2D, prop: string, facing: string, x: number, y: number, c: number): void {
  if (prop === "stairsUp" || prop === "stairsDown") { stairs(g, prop === "stairsUp", x, y, c); return; }
  const spec = propArt(prop, facing);
  const src = spec && drawable(spec);
  if (src) {
    if (prop === "rug") { g.drawImage(src, x, y, c, c); return; }
    const h = Math.min(1.7, (ART.propHeight[prop] ?? 18) / 32) * c;
    drawFitted(g, src, x - c * 0.1, y + c - h, c * 1.2, h);
    return;
  }
  if (spec && specState(spec) === "loading") return;          // the art listener redraws
  const h = ((ART.propHeight[prop] ?? 18) / 32) * c;
  g.fillStyle = hex(ART.propColor[prop], "#8a6a4a"); g.fillRect(x + c * 0.1, y + c - h - c * 0.06, c * 0.8, h);
  g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + c * 0.1, y + c - h - c * 0.06, c * 0.8, c * 0.15);
  g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1; g.strokeRect(x + c * 0.1, y + c - h - c * 0.06, c * 0.8, h);
  if (prop === "throne") { g.fillStyle = "#c9a227"; g.fillRect(x + c * 0.25, y + c - h - c * 0.4, c * 0.5, c * 0.36); }
}
function npcMarker(g: CanvasRenderingContext2D, slot: string, x: number, y: number, c: number) {
  g.fillStyle = NPC_COLOR[slot] ?? "#20a060"; g.beginPath(); g.arc(x + c / 2, y + c / 2, c * 0.3, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#000"; g.lineWidth = Math.max(1, c / 16); g.stroke();
  if (c >= 14) { g.font = `bold ${Math.floor(c * 0.36)}px system-ui`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText(slot, x + c / 2, y + c / 2); }
}
function mat(g: CanvasRenderingContext2D, x: number, y: number, c: number) {
  g.fillStyle = "#c8a040"; g.fillRect(x + c * 0.12, y + c * 0.2, c * 0.76, c * 0.6);
  g.strokeStyle = "#6a4a10"; g.lineWidth = Math.max(1, c / 16); g.strokeRect(x + c * 0.12, y + c * 0.2, c * 0.76, c * 0.6);
}

/** The editor view of one layout's rows: floor / walls, every symbol's prop (level-gated ones with a "N+" badge). */
export function renderInteriorRows(rows: string[], floor: string, wall: string, cell: number): HTMLCanvasElement {
  const h = rows.length, w = rows[0]?.length ?? 0;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, w * cell); cv.height = Math.max(1, h * cell);
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x], X = x * cell, Y = y * cell;
    if (ch === " ") { g.fillStyle = "#050505"; g.fillRect(X, Y, cell, cell); continue; }
    if (ch === "#") { wallCell(g, wall, X, Y, cell); continue; }
    floorCell(g, floor, X, Y, cell);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x], X = x * cell, Y = y * cell, s = INTERIOR_LEGEND[ch];
    if (ch === " " || ch === "#" || ch === ".") continue;
    if (ch === "E") { mat(g, X, Y, cell); continue; }
    if (!s) { g.fillStyle = "#ff00ff"; g.fillRect(X + cell * 0.2, Y + cell * 0.2, cell * 0.6, cell * 0.6); continue; }
    if (s.prop) drawProp(g, s.prop, "s", X, Y, cell);
    if (s.npc) npcMarker(g, s.npc, X, Y, cell);
    if (s.minLevel && cell >= 14) {
      g.font = `bold ${Math.floor(cell * 0.3)}px system-ui`; g.textAlign = "right"; g.textBaseline = "top";
      g.fillStyle = "rgba(0,0,0,0.75)"; g.fillRect(X + cell * 0.5, Y, cell * 0.5, cell * 0.34);
      g.fillStyle = "#ffd84a"; g.fillText(s.minLevel + "+", X + cell - 2, Y + 1);
    }
  }
  return cv;
}

/** A map built by the game's buildInteriorMap (props with their facing, the edge furnishings, NPC slots, exit, spawn). */
export function renderInteriorMap(m: InteriorMap, cell: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = m.w * cell; cv.height = m.h * cell;
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const ch = m.cells[y * m.w + x], X = x * cell, Y = y * cell;
    if (ch === " ") { g.fillStyle = "#050505"; g.fillRect(X, Y, cell, cell); }
    else if (ch === "#") wallCell(g, m.wall, X, Y, cell);
    else { floorCell(g, m.floor, X, Y, cell); if (ch === "E") mat(g, X, Y, cell); }
  }
  const order = m.props.slice().sort((a, b) => a.y - b.y);
  for (const p of order.filter((q) => q.prop === "rug")) drawProp(g, p.prop, p.facing ?? "s", p.x * cell, p.y * cell, cell);
  for (const p of order.filter((q) => q.prop !== "rug")) drawProp(g, p.prop, p.facing ?? "s", p.x * cell, p.y * cell, cell);
  for (const s of m.slots) npcMarker(g, s.slot, s.x * cell, s.y * cell, cell);
  return cv;
}

/** Props whose symbols the layouts of a file use (palette coverage of the art). */
export function propsUsed(f: InteriorFile): Set<string> {
  const out = new Set<string>();
  for (const l of [...f.variants, ...(f.upper ? [f.upper] : [])]) for (const r of l.rows) for (const ch of r) { const p = INTERIOR_LEGEND[ch]?.prop; if (p) out.add(p); }
  return out;
}
