// Real game tile art for the Area tab: TileType -> sprite file, from the GAME'S OWN tables (imported, not copied):
// client/src/worldVisuals.ts TILE_SPRITE_FILES / TILE_OPTIONAL_ART / TILE_STANDIN_TINT and client/src/spriteRegistry.ts
// STRUCTURE_FURNITURE_ART + the door / window / floor URL helpers. The rule is the one the game's build toolbar uses for a
// tile's icon (client/src/main.ts setupToolbar): structure furniture art, else the optional dedicated art, else the
// stand-in sprite (tinted with TILE_STANDIN_TINT, as the world renderer does while the dedicated art is missing).
// Not reproduced (the world renderer does them with neighbour context): wall / fence / road autotiling, floor variants,
// roofs, animated campfire frames, tents' per-faction variants. Each cell draws its one sprite, fitted to the cell.
import { TILE_OPTIONAL_ART, TILE_SPRITE_FILES, TILE_STANDIN_TINT } from "../../../../../client/src/worldVisuals.ts";
import { STRUCTURE_FURNITURE_ART, structureDoorUrl, structureFloorUrl, structureWindowUrl } from "../../../../../client/src/spriteRegistry.ts";
import { TileType, type LegendSymbol } from "../../../shared/area.ts";

export const GROUND_URL = "/sprites/grassFloor1.png";
const spriteUrl = (name: string) => `/sprites/${name}.png`;

export type ArtSpec = { urls: string[]; tint?: number; source: string };

/** The art for a tile: urls in preference order (the first that loads wins). null: no art (a swatch is drawn). */
export function tileArt(tile: number, horizontal = true): ArtSpec | null {
  const t = tile as TileType;
  if (t === TileType.WoodDoor || t === TileType.StoneDoor) return { urls: [structureDoorUrl(t === TileType.StoneDoor, horizontal, false)], source: "spriteRegistry door" };
  if (t === TileType.WoodWindow || t === TileType.StoneWindow) return { urls: [structureWindowUrl(t === TileType.StoneWindow, horizontal)], source: "spriteRegistry window" };
  if (t === TileType.WoodFloor || t === TileType.StoneFloor) return { urls: [structureFloorUrl(t === TileType.StoneFloor, 0)], source: "spriteRegistry floor" };
  const furniture = STRUCTURE_FURNITURE_ART[t];
  if (furniture) return { urls: [furniture], source: "STRUCTURE_FURNITURE_ART" };
  const opt = TILE_OPTIONAL_ART[t], base = TILE_SPRITE_FILES[t];
  if (opt && base) return { urls: [spriteUrl(opt), spriteUrl(base)], tint: TILE_STANDIN_TINT[t], source: "TILE_OPTIONAL_ART (stand-in TILE_SPRITE_FILES)" };
  if (opt) return { urls: [spriteUrl(opt)], source: "TILE_OPTIONAL_ART" };
  if (base) return { urls: [spriteUrl(base)], tint: TILE_STANDIN_TINT[t], source: "TILE_SPRITE_FILES" };
  return null;
}

// ---- image cache: url -> image (or failed); tinted stand-ins cached as canvases
type Slot = { img: HTMLImageElement; ok: boolean | null };
const images = new Map<string, Slot>();
const tinted = new Map<string, HTMLCanvasElement>();
let onLoaded: () => void = () => {};
export function setArtListener(fn: () => void) { onLoaded = fn; }
let pending = 0;
export const artPending = () => pending;

// The sprite files that exist (GET /api/refs), so optional art that is not there yet is skipped without a 404.
let available: Set<string> | null = null;
export function setAvailable(paths: string[]) { available = new Set(paths.map((p) => "/sprites/" + p)); }

function slot(url: string): Slot {
  let s = images.get(url);
  if (!s && available && !available.has(url)) { s = { img: new Image(), ok: false }; images.set(url, s); }
  if (!s) {
    const img = new Image();
    s = { img, ok: null };
    images.set(url, s);
    pending++;
    const done = (ok: boolean) => { s!.ok = ok; pending--; onLoaded(); };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  }
  return s;
}
export function image(url: string): HTMLImageElement | null {
  const s = slot(url);
  return s.ok ? s.img : null;
}

/** The drawable for a spec (null while loading or when every url failed); the tint applies to a stand-in only. */
export function drawable(spec: ArtSpec): CanvasImageSource | null {
  for (let i = 0; i < spec.urls.length; i++) {
    const s = slot(spec.urls[i]);
    if (s.ok === null) return null;              // wait for the preferred file before falling back
    if (!s.ok) continue;
    const standIn = spec.urls.length === 1 || i > 0;
    if (spec.tint === undefined || !standIn) return s.img;
    const key = spec.urls[i] + "#" + spec.tint;
    let c = tinted.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = s.img.naturalWidth; c.height = s.img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(s.img, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = "#" + spec.tint.toString(16).padStart(6, "0");
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(s.img, 0, 0);
      tinted.set(key, c);
    }
    return c;
  }
  return null;
}
/** "loading" until the preferred files have answered, then "ok" (something drew) or "none" (every url failed). */
export function specState(spec: ArtSpec): "loading" | "ok" | "none" {
  for (const u of spec.urls) { const s = slot(u); if (s.ok === null) return "loading"; if (s.ok) return "ok"; }
  return "none";
}
/** Which url a spec ended up using (for the coverage report), or null if none loaded (yet). */
export function usedUrl(spec: ArtSpec): string | null {
  for (const u of spec.urls) { const s = slot(u); if (s.ok === null) return null; if (s.ok) return u; }
  return null;
}

/** Draw `src` fitted into the cell (aspect kept, bottom-centred like the game's upright art). */
export function drawFitted(g: CanvasRenderingContext2D, src: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const iw = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width, ih = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
  if (!iw || !ih) return;
  const k = Math.min(w / iw, h / ih), dw = iw * k, dh = ih * k;
  g.drawImage(src, x + (w - dw) / 2, y + h - dh, dw, dh);
}

export type Coverage = { ch: string; label: string; tile: number | null; art: string | null; note: string };
/** Per legend symbol: the sprite it draws with, or why it has none (no tile = a slot / open ground; or no art). */
export function coverage(legend: Record<string, LegendSymbol>, propArt?: (prop: string) => ArtSpec | null): Coverage[] {
  return Object.entries(legend).map(([ch, s]) => {
    if (s.prop && propArt) {
      const spec = propArt(s.prop), u = spec && usedUrl(spec);
      return { ch, label: s.label, tile: null, art: u, note: u ? "interior furniture art (client/src/interior.ts tables)" : spec ? "art loading / missing: stand-in" : "drawn in code / stand-in" };
    }
    if (s.tile === undefined) return { ch, label: s.label, tile: null, art: null, note: s.slot ? "slot marker (no tile)" : s.tier ? "tier digit (no tile)" : "open ground / structure (no tile)" };
    const spec = tileArt(s.tile);
    if (!spec) return { ch, label: s.label, tile: s.tile, art: null, note: "no art in the game's tables: swatch" };
    const u = usedUrl(spec);
    return { ch, label: s.label, tile: s.tile, art: u, note: u ? spec.source + (spec.tint !== undefined && u !== spec.urls[0] ? " (tinted stand-in)" : "") : "art file missing: swatch" };
  });
}
