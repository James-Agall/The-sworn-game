// Strategy mode phase 1 (docs PLAN-strategy-mode.md §1): level-of-detail bands, the fog layer, unit dots
// for the Map band and the regiment banners (phase 2: one per server regiment, see main.ts).
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from "pixi.js";

export type LodBand = "tactical" | "field" | "map";
export const FIELD_BAND_ZOOM = 0.75;
export const MAP_BAND_ZOOM = 0.35;

export function lodBand(zoom: number): LodBand {
  return zoom >= FIELD_BAND_ZOOM ? "tactical" : zoom >= MAP_BAND_ZOOM ? "field" : "map";
}

// Explored but outside live vision: black at this alpha (45%); unexplored is solid black.
const FOG_DIM_ALPHA = 115;

export interface VisionSource {
  x: number; // tile
  y: number; // tile
  r: number; // tiles
}

// Strategy-mode fog: a one-pixel-per-tile canvas texture stretched over the world (linear filtering softens
// the edges), plus the live-vision grid it was built from, which also decides which enemies are drawn.
export class StrategyFog {
  readonly sprite = new Sprite(Texture.EMPTY);
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private image: ImageData | null = null;
  private texture: Texture | null = null;
  private vision = new Uint8Array(0);
  private w = 0;
  private h = 0;
  private tileSize = 32;

  constructor() {
    this.sprite.visible = false;
  }

  // On every welcome (the map size may have changed).
  reset(w: number, h: number, tileSize: number) {
    this.w = w;
    this.h = h;
    this.tileSize = tileSize;
    this.vision = new Uint8Array(w * h);
    // A fresh canvas + texture: a texture source keeps the size it was created at.
    this.texture?.destroy(true);
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(w, h);
    this.texture = new Texture({ source: new CanvasSource({ resource: this.canvas }) });
    this.sprite.texture = this.texture;
    this.sprite.scale.set(tileSize);
    this.sprite.position.set(0, 0);
  }

  // Rebuilds the vision grid and the fog pixels (one pass over the map; main.ts throttles it).
  update(explored: Uint8Array, sources: VisionSource[]) {
    if (!this.image || !this.texture) return;
    const { w, h, vision } = this;
    vision.fill(0);
    for (const s of sources) {
      const r = Math.ceil(s.r);
      const r2 = s.r * s.r;
      for (let y = Math.max(0, s.y - r); y <= Math.min(h - 1, s.y + r); y++) {
        const dy2 = (y - s.y) ** 2;
        for (let x = Math.max(0, s.x - r); x <= Math.min(w - 1, s.x + r); x++) {
          if ((x - s.x) ** 2 + dy2 <= r2) vision[y * w + x] = 1;
        }
      }
    }
    const px = new Uint32Array(this.image.data.buffer);
    for (let i = 0; i < w * h; i++) {
      const a = !explored[i] ? 255 : vision[i] ? 0 : FOG_DIM_ALPHA;
      // Little-endian RGBA: black with alpha a.
      px[i] = (a << 24) >>> 0;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  // Whether the world point (px) is inside live vision as of the last update.
  sees(x: number, y: number): boolean {
    const tx = Math.floor(x / this.tileSize);
    const ty = Math.floor(y / this.tileSize);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.vision[ty * this.w + tx] === 1;
  }
}

export interface UnitDot {
  x: number;
  y: number;
  color: number;
  // Screen px radius.
  r: number;
  ring?: boolean;
  square?: boolean;
}

// Map band: every unit as a small screen-size dot (sizes are divided by the zoom).
export function drawUnitDots(g: Graphics, zoom: number, dots: UnitDot[]) {
  g.clear();
  const k = 1 / zoom;
  for (const d of dots) {
    const r = d.r * k;
    if (d.square) g.rect(d.x - r, d.y - r, 2 * r, 2 * r).fill(d.color).stroke({ width: 1.5 * k, color: 0x1a0f06 });
    else if (d.ring) g.circle(d.x, d.y, r).stroke({ width: 2 * k, color: d.color });
    else g.circle(d.x, d.y, r).fill(d.color);
  }
}

export interface BannerGroup {
  key: string;
  label: string;
  // "alive/max".
  count: string;
  hpFrac: number;
  color: number;
  x: number;
  y: number;
}

interface Banner {
  root: Container;
  bg: Graphics;
  text: Text;
  label: string;
  hpFrac: number;
  color: number;
  // Screen px width (grows with the label).
  w: number;
}

const BANNER_MIN_W = 64;
const BANNER_H = 26;

// Fixed-screen-size banners above each regiment's centroid.
export class StrategyBanners {
  readonly layer = new Container();
  private banners = new Map<string, Banner>();

  sync(groups: BannerGroup[]) {
    const seen = new Set<string>();
    for (const g of groups) {
      seen.add(g.key);
      let b = this.banners.get(g.key);
      if (!b) {
        const root = new Container();
        const bg = new Graphics();
        const text = new Text({
          text: "",
          style: { fontFamily: "Palatino Linotype, Palatino, Georgia, serif", fontSize: 11, fontWeight: "bold", fill: 0xfbecc8 },
        });
        text.anchor.set(0.5, 0);
        text.position.set(0, -BANNER_H - 6);
        root.addChild(bg, text);
        this.layer.addChild(root);
        b = { root, bg, text, label: "", hpFrac: -1, color: -1, w: BANNER_MIN_W };
        this.banners.set(g.key, b);
      }
      const label = `${g.label} ${g.count}`;
      let resized = false;
      if (label !== b.label) {
        b.label = label;
        b.text.text = label;
        const w = Math.max(BANNER_MIN_W, Math.ceil(b.text.width) + 10);
        resized = w !== b.w;
        b.w = w;
      }
      const hp = Math.round(g.hpFrac * 40) / 40;
      if (resized || hp !== b.hpFrac || g.color !== b.color) {
        b.hpFrac = hp;
        b.color = g.color;
        const W = b.w;
        b.bg.clear();
        b.bg.roundRect(-W / 2, -BANNER_H - 8, W, BANNER_H, 4).fill({ color: 0x1a0f06, alpha: 0.82 }).stroke({ width: 1.5, color: g.color });
        b.bg.rect(-W / 2 + 5, -14, W - 10, 4).fill(0x550000);
        b.bg.rect(-W / 2 + 5, -14, (W - 10) * hp, 4).fill(0x3bd16f);
        b.bg.moveTo(-4, -8).lineTo(4, -8).lineTo(0, -2).closePath().fill(g.color);
      }
      b.root.position.set(g.x, g.y);
    }
    for (const [key, b] of this.banners) {
      if (seen.has(key)) continue;
      b.root.destroy({ children: true });
      this.banners.delete(key);
    }
  }

  // Keeps the banners the same size on screen at any zoom.
  setZoom(zoom: number) {
    const s = 1 / zoom;
    for (const b of this.banners.values()) b.root.scale.set(s);
  }

  // The banner key under the world point (px), or null; banners are BANNER_H screen px tall above their pin.
  hitTest(x: number, y: number, zoom: number): string | null {
    for (const [key, b] of this.banners) {
      const lx = (x - b.root.position.x) * zoom;
      const ly = (y - b.root.position.y) * zoom;
      if (Math.abs(lx) <= b.w / 2 && ly >= -BANNER_H - 8 && ly <= 0) return key;
    }
    return null;
  }

  clear() {
    this.sync([]);
  }
}
