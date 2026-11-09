// Modular building phase 1: procedural stand-in art (flat top-down, tile-aligned, 32 px) for the room pieces, drawn
// on canvases at startup. Every texture here is pending real art (SPRITES.md "Modular building phase 1").
import { Texture } from "pixi.js";
import { TileType } from "@colony/shared/protocol";

const PX = 32;
type Ctx = CanvasRenderingContext2D;

function make(draw: (g: Ctx) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = PX;
  canvas.height = PX;
  const g = canvas.getContext("2d")!;
  draw(g);
  const t = Texture.from(canvas);
  t.source.scaleMode = "nearest";
  return t;
}

// A block with a light top-left and a dark bottom-right edge.
function block(g: Ctx, x: number, y: number, w: number, h: number, fill: string, light: string, dark: string) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.fillStyle = light;
  g.fillRect(x, y, w, 2);
  g.fillRect(x, y, 2, h);
  g.fillStyle = dark;
  g.fillRect(x, y + h - 2, w, 2);
  g.fillRect(x + w - 2, y, 2, h);
}

const WOOD = { fill: "#8a5a2b", light: "#b07a40", dark: "#5a3818" };
const STONE = { fill: "#8d8f94", light: "#b4b6ba", dark: "#5c5e63" };

function floor(stone: boolean): Texture {
  return make((g) => {
    if (stone) {
      g.fillStyle = "#7d7f84";
      g.fillRect(0, 0, PX, PX);
      for (const [x, y, w, h] of [[0, 0, 16, 12], [16, 0, 16, 12], [0, 12, 10, 10], [10, 12, 22, 10], [0, 22, 20, 10], [20, 22, 12, 10]])
        block(g, x + 1, y + 1, w - 2, h - 2, "#9a9ca1", "#b1b3b8", "#6c6e73");
    } else {
      for (let i = 0; i < 4; i++) block(g, 0, i * 8, PX, 8, i % 2 ? "#a06c38" : "#94622f", "#b98448", "#6e4620");
      g.fillStyle = "#5a3818";
      g.fillRect(12, 0, 1, 8);
      g.fillRect(24, 8, 1, 8);
      g.fillRect(6, 16, 1, 8);
      g.fillRect(20, 24, 1, 8);
    }
  });
}

// A wall strip across the tile (horizontal: east-west) with a feature in the middle.
function strip(g: Ctx, horizontal: boolean, stone: boolean) {
  const c = stone ? STONE : WOOD;
  if (horizontal) block(g, 0, 8, PX, 16, c.fill, c.light, c.dark);
  else block(g, 8, 0, 16, PX, c.fill, c.light, c.dark);
}

function windowTex(horizontal: boolean, stone: boolean): Texture {
  return make((g) => {
    strip(g, horizontal, stone);
    g.fillStyle = "#3a2a1a";
    if (horizontal) g.fillRect(8, 11, 16, 10);
    else g.fillRect(11, 8, 10, 16);
    g.fillStyle = "#8fc8e8";
    if (horizontal) g.fillRect(10, 13, 12, 6);
    else g.fillRect(13, 10, 6, 12);
    g.fillStyle = "#d8f0ff";
    if (horizontal) g.fillRect(11, 14, 4, 2);
    else g.fillRect(14, 11, 2, 4);
  });
}

function doorTex(horizontal: boolean, stone: boolean, open: boolean): Texture {
  return make((g) => {
    const c = stone ? STONE : WOOD;
    // Posts at both ends.
    if (horizontal) {
      block(g, 0, 8, 6, 16, c.fill, c.light, c.dark);
      block(g, PX - 6, 8, 6, 16, c.fill, c.light, c.dark);
    } else {
      block(g, 8, 0, 16, 6, c.fill, c.light, c.dark);
      block(g, 8, PX - 6, 16, 6, c.fill, c.light, c.dark);
    }
    const leaf = { fill: "#6b4423", light: "#8a5a2b", dark: "#40260f" };
    if (!open) {
      if (horizontal) block(g, 6, 11, PX - 12, 10, leaf.fill, leaf.light, leaf.dark);
      else block(g, 11, 6, 10, PX - 12, leaf.fill, leaf.light, leaf.dark);
      g.fillStyle = "#e0c060";
      if (horizontal) g.fillRect(PX - 11, 15, 2, 2);
      else g.fillRect(15, PX - 11, 2, 2);
    } else {
      // Swung open: the leaf lies along one post.
      if (horizontal) block(g, 6, 12, 4, 18, leaf.fill, leaf.light, leaf.dark);
      else block(g, 12, 6, 18, 4, leaf.fill, leaf.light, leaf.dark);
    }
  });
}

function bedTex(): Texture {
  return make((g) => {
    block(g, 5, 2, 22, 28, "#6b4423", "#8a5a2b", "#40260f");
    g.fillStyle = "#e8e2d0";
    g.fillRect(8, 4, 16, 7);
    g.fillStyle = "#4a6fa5";
    g.fillRect(8, 12, 16, 16);
    g.fillStyle = "#6a8fc5";
    g.fillRect(8, 12, 16, 2);
  });
}

function roofTex(stone: boolean): Texture {
  return make((g) => {
    if (stone) {
      g.fillStyle = "#7a3b2a";
      g.fillRect(0, 0, PX, PX);
      for (let row = 0; row < 4; row++)
        for (let k = -1; k < 4; k++) block(g, k * 8 + (row % 2) * 4, row * 8, 8, 8, "#a5523a", "#c26a4e", "#6a3020");
    } else {
      g.fillStyle = "#b8963e";
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = "#8f7230";
      for (let row = 0; row < 4; row++) g.fillRect(0, row * 8 + 6, PX, 2);
      g.fillStyle = "#d4b25a";
      for (let x = 1; x < PX; x += 3) for (let row = 0; row < 4; row++) g.fillRect(x, row * 8 + 1, 1, 4);
    }
  });
}

export interface StructureTextures {
  floor: Map<number, Texture>;
  bed: Texture;
  // [stone][horizontal]
  window: (stone: boolean, horizontal: boolean) => Texture;
  door: (stone: boolean, horizontal: boolean, open: boolean) => Texture;
  roof: (stone: boolean) => Texture;
}

export function makeStructureTextures(): StructureTextures {
  const floors = new Map<number, Texture>([[TileType.WoodFloor, floor(false)], [TileType.StoneFloor, floor(true)]]);
  const cache = new Map<string, Texture>();
  const memo = (key: string, f: () => Texture) => {
    let t = cache.get(key);
    if (!t) cache.set(key, (t = f()));
    return t;
  };
  return {
    floor: floors,
    bed: bedTex(),
    window: (stone, h) => memo(`w${+stone}${+h}`, () => windowTex(h, stone)),
    door: (stone, h, open) => memo(`d${+stone}${+h}${+open}`, () => doorTex(h, stone, open)),
    roof: (stone) => memo(`r${+stone}`, () => roofTex(stone)),
  };
}
