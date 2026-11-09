// Modular building phase 1: procedural stand-in art (flat top-down, tile-aligned, 32 px) for the room pieces, drawn
// on canvases at startup (SPRITES.md #90 / #91). Since 2026-11-09 the sliced atlas art (spriteRegistry.ts) replaces
// each piece whose png loaded; a missing file falls back to the stand-in here automatically.
import { Texture } from "pixi.js";
import { TileType } from "@colony/shared/protocol";
import {
  FLOOR_VARIANTS, STRUCTURE_FURNITURE_ART, structureDoorUrl, structureFloorUrl, structureRoofUrl, structureWindowUrl,
} from "./spriteRegistry";

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

// Modular building phase 2: furniture stand-ins (SPRITES.md #91), one flat 32 px piece each.
function furnitureTex(t: TileType): Texture {
  return make((g) => {
    const W = WOOD;
    switch (t) {
      case TileType.Table:
        block(g, 3, 7, 26, 18, W.fill, W.light, W.dark);
        g.fillStyle = "#e8e2d0";
        g.fillRect(12, 12, 8, 6);
        break;
      case TileType.Chair:
        block(g, 9, 6, 14, 4, W.dark, W.fill, "#2e1a08");
        block(g, 9, 11, 14, 14, W.fill, W.light, W.dark);
        break;
      case TileType.Chest:
        block(g, 4, 8, 24, 18, "#7a4a20", "#9a6a38", "#4a2a10");
        g.fillStyle = "#c9a640";
        g.fillRect(4, 14, 24, 2);
        g.fillRect(14, 15, 4, 5);
        break;
      case TileType.Shelf:
        block(g, 2, 4, 28, 24, W.dark, W.fill, "#2e1a08");
        g.fillStyle = W.light;
        for (const y of [11, 19]) g.fillRect(3, y, 26, 2);
        g.fillStyle = "#c46a3a";
        g.fillRect(5, 6, 4, 5);
        g.fillStyle = "#4a6fa5";
        g.fillRect(18, 13, 6, 6);
        break;
      case TileType.Hearth:
        block(g, 2, 2, 28, 28, STONE.fill, STONE.light, STONE.dark);
        g.fillStyle = "#2a2220";
        g.fillRect(8, 8, 16, 16);
        g.fillStyle = "#e0702a";
        g.fillRect(11, 14, 10, 8);
        g.fillStyle = "#f5c04a";
        g.fillRect(14, 12, 4, 8);
        break;
      case TileType.Lamp:
        g.fillStyle = "rgba(255, 220, 120, 0.25)";
        g.beginPath();
        g.arc(16, 16, 14, 0, Math.PI * 2);
        g.fill();
        block(g, 13, 18, 6, 10, "#4a4a50", "#6a6a70", "#2a2a30");
        g.fillStyle = "#f5d060";
        g.fillRect(12, 8, 8, 10);
        break;
      case TileType.Rug:
        g.fillStyle = "#8a2a2a";
        g.fillRect(2, 5, 28, 22);
        g.strokeStyle = "#d4a040";
        g.lineWidth = 2;
        g.strokeRect(5, 8, 22, 16);
        g.fillStyle = "#d4a040";
        g.fillRect(14, 14, 4, 4);
        break;
      case TileType.Workbench:
        block(g, 2, 8, 28, 16, "#7a5a3a", "#9a7a5a", "#4a3a2a");
        g.fillStyle = "#9a9ca1";
        g.fillRect(6, 11, 8, 3);
        g.fillRect(20, 12, 3, 9);
        break;
      case TileType.Statue:
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(8, 24, 18, 5);
        block(g, 8, 22, 16, 6, STONE.dark, STONE.fill, "#3c3e43");
        block(g, 12, 6, 8, 16, "#c8cacf", "#e2e4e8", "#8d8f94");
        g.fillStyle = "#c8cacf";
        g.fillRect(13, 2, 6, 6);
        break;
      case TileType.WeaponRack:
        block(g, 3, 6, 26, 4, W.fill, W.light, W.dark);
        block(g, 3, 22, 26, 4, W.fill, W.light, W.dark);
        g.fillStyle = "#b4b6ba";
        for (const x of [7, 14, 21]) g.fillRect(x, 3, 2, 26);
        g.fillStyle = "#6b4423";
        for (const x of [7, 14, 21]) g.fillRect(x, 20, 2, 8);
        break;
    }
  });
}

// How a piece is drawn: "flat" fills its tile (floors, rugs, stand-ins); "wall" like a connected wall piece
// (WALL_ART_PX_PER_TILE, bottom-centred); "upright" bottom-centred at STRUCTURE_ART_PX_PER_TILE (furniture).
export type StructurePlacement = "flat" | "wall" | "upright";
export interface StructureArt {
  texture: Texture;
  place: StructurePlacement;
}

export interface StructureTextures {
  // variant: any non-negative per-tile hash (picks one of the floor variants).
  floor: (t: number, variant: number) => StructureArt | undefined;
  // Bed and phase 2 furniture by tile type.
  furniture: (t: number) => StructureArt;
  window: (stone: boolean, horizontal: boolean) => StructureArt;
  door: (stone: boolean, horizontal: boolean, open: boolean) => StructureArt;
  roof: (stone: boolean) => Texture;
}

// `art`: the optional textures that loaded (url -> texture); anything missing uses the procedural stand-in.
export function makeStructureTextures(art: Record<string, Texture>): StructureTextures {
  const cache = new Map<string, Texture>();
  const memo = (key: string, f: () => Texture) => {
    let t = cache.get(key);
    if (!t) cache.set(key, (t = f()));
    return t;
  };
  const flat = (texture: Texture): StructureArt => ({ texture, place: "flat" });
  const pick = (url: string | undefined, place: StructurePlacement, fallback: () => StructureArt): StructureArt => {
    const texture = url ? art[url] : undefined;
    return texture ? { texture, place } : fallback();
  };
  return {
    floor: (t, variant) => {
      if (t !== TileType.WoodFloor && t !== TileType.StoneFloor) return undefined;
      const stone = t === TileType.StoneFloor;
      return pick(structureFloorUrl(stone, variant % FLOOR_VARIANTS), "flat", () => flat(memo(`fl${+stone}`, () => floor(stone))));
    },
    furniture: (t) => {
      const fallback = () => flat(t === TileType.Bed ? memo("bed", bedTex) : memo(`f${t}`, () => furnitureTex(t as TileType)));
      return pick(STRUCTURE_FURNITURE_ART[t as TileType], t === TileType.Rug ? "flat" : "upright", fallback);
    },
    window: (stone, h) => pick(structureWindowUrl(stone, h), "wall", () => flat(memo(`w${+stone}${+h}`, () => windowTex(h, stone)))),
    door: (stone, h, open) =>
      pick(structureDoorUrl(stone, h, open), "wall", () => flat(memo(`d${+stone}${+h}${+open}`, () => doorTex(h, stone, open)))),
    roof: (stone) => art[structureRoofUrl(stone)] ?? memo(`r${+stone}`, () => roofTex(stone)),
  };
}
