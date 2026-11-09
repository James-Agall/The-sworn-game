// interiors.ts: Stardew phase 5c (docs PLAN-rimworld-stardew.md 5c; ROADMAP "Stardew layer — phase 5c"). Building
// interiors: the hero steps through the door of a PREFAB building (house, tavern, church, smithy, bakery, shop,
// barracks, hall, barn) into a small separate tile map built from a per-building-type TEMPLATE below (an ASCII grid
// over INTERIOR_LEGEND, like the camp templates in camps.ts). Every interior number lives here (server + client).
// Player-built modular rooms (phases 1-2) are never entered (they keep the roof cutaway).
import { TileType } from "./protocol.js";
import type { PackGood } from "./herolife.js";

// ---- constants ----
// Interior tiles are world-sized (32 px), so hero / NPC art keeps its scale.
export const INTERIOR_TILE_PX = 32;
// E enters when the hero's centre is within this many tiles of the door tile's centre (the tile just below the
// building: its door side); walking north into the building from the door tile enters too (bump).
export const INTERIOR_DOOR_REACH_TILES = 0.9;
// Entering is refused while a hostile mob is within this many tiles of the door.
export const INTERIOR_ENEMY_BLOCK_TILES = 6;
// Inside: hostile mobs within this many tiles of the door raise the HUD warning ("Raiders near the door").
export const INTERIOR_THREAT_ALERT_TILES = 12;
// Hero speed indoors (x PLAYER_SPEED x the usual needs / load multiplier).
export const INTERIOR_SPEED_MULT = 0.75;
// E reaches a bed / chest / the exit mat within this many tiles (centre to centre); NPCs use TALK_RANGE_TILES.
export const INTERIOR_USE_RANGE_TILES = 1.6;
// Esc leaves when the hero is within this many tiles of the exit mat.
export const INTERIOR_ESC_EXIT_TILES = 2.2;
// A bump-enter / refusal is retried at most this often (ticks); a fresh exit ignores bumps this long.
export const INTERIOR_BUMP_COOLDOWN_TICKS = 30;
// Chest capacity in pack weight units (PACK_WEIGHT); a Barn's storage holds more.
export const INTERIOR_CHEST_CAP = 200;
export const INTERIOR_BARN_CHEST_CAP = 600;
// Resting in your own bed (daytime nap): rest / energy gain multiplier, like the home shelter.
export const INTERIOR_BED_REST_MULT = 3;
// NPCs, threat and chest are refreshed this often (ticks) while someone is inside.
export const INTERIOR_REFRESH_TICKS = 20;
// Client: the fade between world and interior (ms), the lighting vignette strength, the camera zoom indoors.
export const INTERIOR_FADE_MS = 260;
export const INTERIOR_VIGNETTE_ALPHA = 0.6;
export const INTERIOR_ZOOM = 2.4;

// ---- templates ----
export type InteriorTemplateId = "house" | "tavern" | "church" | "smithy" | "bakery" | "shop" | "barracks" | "hall" | "barn";
export type InteriorFloor = "wood" | "stone" | "dirt";
export type InteriorProp =
  | "bed" | "bedFine" | "chest" | "table" | "chair" | "hearth" | "lamp" | "rug" | "shelf" | "wardrobe" | "counter"
  | "altar" | "pew" | "anvil" | "oven" | "barrel" | "crates" | "sacks" | "hay" | "weaponRack" | "armourStand" | "banner"
  | "statue" | "throne" | "forge" | "stall" | "workbench" | "candelabra";
// NPC slots: "1" the building's keeper (smith, baker, trader, priest, elder), "2" a second (a hall's trader),
// "v" residents / patrons / soldiers (beside the beds and tables).
export type InteriorNpcSlot = "1" | "2" | "v";

export interface InteriorSymbol {
  label: string;
  prop?: InteriorProp;
  npc?: InteriorNpcSlot;
  // Shown only from this building level (below it the cell is plain floor).
  minLevel?: number;
}
// "#" wall, "." floor, "E" exit mat (exactly one, in the bottom wall), " " nothing. Solid: walls and every prop
// except INTERIOR_WALKABLE_PROPS.
export const INTERIOR_LEGEND: Record<string, InteriorSymbol> = {
  "#": { label: "Wall" },
  ".": { label: "Floor" },
  E: { label: "Exit mat" },
  b: { label: "Bed", prop: "bed" },
  q: { label: "Bed (level 2+)", prop: "bed", minLevel: 2 },
  Q: { label: "Fine bed (level 3)", prop: "bedFine", minLevel: 3 },
  c: { label: "Chest", prop: "chest" },
  t: { label: "Table", prop: "table" },
  h: { label: "Chair", prop: "chair" },
  H: { label: "Hearth", prop: "hearth" },
  l: { label: "Lamp (level 2+)", prop: "lamp", minLevel: 2 },
  r: { label: "Rug (level 2+)", prop: "rug", minLevel: 2 },
  s: { label: "Shelf", prop: "shelf" },
  w: { label: "Wardrobe (level 2+)", prop: "wardrobe", minLevel: 2 },
  K: { label: "Counter", prop: "counter" },
  A: { label: "Altar", prop: "altar" },
  p: { label: "Pew", prop: "pew" },
  n: { label: "Anvil", prop: "anvil" },
  o: { label: "Oven", prop: "oven" },
  x: { label: "Barrel", prop: "barrel" },
  X: { label: "Crates", prop: "crates" },
  k: { label: "Sacks", prop: "sacks" },
  y: { label: "Hay", prop: "hay" },
  R: { label: "Weapon rack", prop: "weaponRack" },
  a: { label: "Armour stand", prop: "armourStand" },
  B: { label: "Banner", prop: "banner" },
  S: { label: "Statue (level 3)", prop: "statue", minLevel: 3 },
  T: { label: "High seat", prop: "throne" },
  f: { label: "Forge", prop: "forge" },
  m: { label: "Market stall", prop: "stall" },
  W: { label: "Workbench", prop: "workbench" },
  C: { label: "Candelabra (level 2+)", prop: "candelabra", minLevel: 2 },
  "1": { label: "Keeper", npc: "1" },
  "2": { label: "Second keeper", npc: "2" },
  v: { label: "Resident / patron", npc: "v" },
};
export const INTERIOR_WALKABLE_PROPS: ReadonlySet<InteriorProp> = new Set(["rug", "chair"]);

export interface InteriorTemplate {
  id: InteriorTemplateId;
  label: string;
  floor: InteriorFloor;
  wall: "wood" | "stone";
  rows: string[];
}

export const INTERIOR_TEMPLATES: Record<InteriorTemplateId, InteriorTemplate> = {
  house: {
    id: "house", label: "House", floor: "wood", wall: "wood",
    rows: [
      "###########",
      "#b.qH..s.c#",
      "#v.v.....w#",
      "#...rr....#",
      "#..hth..x.#",
      "#l.......l#",
      "#####E#####",
    ],
  },
  tavern: {
    id: "tavern", label: "Tavern", floor: "wood", wall: "wood",
    rows: [
      "#############",
      "#xX.1.H.s.xc#",
      "#KKKKK......#",
      "#....v..v...#",
      "#.hth..hth..#",
      "#......v....#",
      "#.hth..hth.l#",
      "#C.........C#",
      "######E######",
    ],
  },
  church: {
    id: "church", label: "Church", floor: "stone", wall: "stone",
    rows: [
      "###########",
      "#C..BAB..C#",
      "#....1....#",
      "#.........#",
      "#pp.....pp#",
      "#.........#",
      "#pp..v..pp#",
      "#.........#",
      "#pp..r..pp#",
      "#S.......S#",
      "#####E#####",
    ],
  },
  smithy: {
    id: "smithy", label: "Smithy", floor: "stone", wall: "stone",
    rows: [
      "###########",
      "#fn1R.a.xc#",
      "#KKK..W.l.#",
      "#.........#",
      "#..x...X..#",
      "#.........#",
      "#####E#####",
    ],
  },
  bakery: {
    id: "bakery", label: "Bakery", floor: "stone", wall: "wood",
    rows: [
      "#########",
      "#oo1.k.c#",
      "#KKK..x.#",
      "#.......#",
      "#.hth..l#",
      "#.......#",
      "####E####",
    ],
  },
  shop: {
    id: "shop", label: "Shop", floor: "wood", wall: "wood",
    rows: [
      "###########",
      "#sXs.1.sxc#",
      "#..KKKKK..#",
      "#.........#",
      "#m.......m#",
      "#..k...X..#",
      "#l.......l#",
      "#####E#####",
    ],
  },
  barracks: {
    id: "barracks", label: "Barracks", floor: "wood", wall: "wood",
    rows: [
      "#############",
      "#bvb.bvb.RaR#",
      "#...........#",
      "#qvq.QvQ....#",
      "#...........#",
      "#.hth..B..xc#",
      "#l..1......l#",
      "######E######",
    ],
  },
  hall: {
    id: "hall", label: "Great hall", floor: "stone", wall: "stone",
    rows: [
      "###############",
      "#B.S..BTB..S.B#",
      "#......1......#",
      "#.....rrr.....#",
      "#C....rrr....C#",
      "#..ttttttt....#",
      "#..hhhhhhh..2.#",
      "#.............#",
      "#H...........H#",
      "#x.bq....s.xc.#",
      "#######E#######",
    ],
  },
  barn: {
    id: "barn", label: "Barn", floor: "dirt", wall: "wood",
    rows: [
      "###########",
      "#yyy.k.XXc#",
      "#.........#",
      "#yy..1..kk#",
      "#.........#",
      "#xx.....xx#",
      "#####E#####",
    ],
  },
};

// Which prefab buildings have an interior (and its level: the tile's own level, or fixed by the tile).
export const INTERIOR_TEMPLATE_BY_TILE: Partial<Record<TileType, InteriorTemplateId>> = {
  [TileType.House]: "house",
  [TileType.HouseLevel2]: "house",
  [TileType.BigHouse]: "house",
  [TileType.Tavern]: "tavern",
  [TileType.ChurchPost]: "church",
  [TileType.AbbeyHall]: "church",
  [TileType.Blacksmith]: "smithy",
  [TileType.Bakery]: "bakery",
  [TileType.Market]: "shop",
  [TileType.GoldShop]: "shop",
  [TileType.MilitiaPost]: "barracks",
  [TileType.MilitiaCamp2]: "barracks",
  [TileType.MilitiaCamp3]: "barracks",
  [TileType.TownCenter]: "hall",
  [TileType.CastleLevel2]: "hall",
  [TileType.CastleLevel3]: "hall",
  [TileType.Keep]: "hall",
  [TileType.SiteKeep]: "hall",
  [TileType.BarnPost]: "barn",
};
// Tiles whose level is the tile itself (House tiers, militia camps, castles, the Abbey).
export const INTERIOR_FIXED_LEVEL: Partial<Record<TileType, number>> = {
  [TileType.House]: 1,
  [TileType.HouseLevel2]: 2,
  [TileType.BigHouse]: 3,
  [TileType.MilitiaPost]: 1,
  [TileType.MilitiaCamp2]: 2,
  [TileType.MilitiaCamp3]: 3,
  [TileType.CastleLevel2]: 2,
  [TileType.CastleLevel3]: 3,
  [TileType.AbbeyHall]: 3,
};
// Your own bed: a house or your hall (Town Center / Keep). Chests open only in your own buildings.
export const INTERIOR_SLEEP_TEMPLATES: ReadonlySet<InteriorTemplateId> = new Set(["house", "hall"]);

// ---- the built map ----
// cells: one char per tile, row-major ("#" wall, "." floor, "E" exit, " " nothing).
export interface InteriorMap {
  templateId: InteriorTemplateId;
  label: string;
  level: number;
  w: number;
  h: number;
  floor: InteriorFloor;
  wall: "wood" | "stone";
  cells: string;
  props: { prop: InteriorProp; x: number; y: number }[];
  slots: { slot: InteriorNpcSlot; x: number; y: number }[];
  exit: { x: number; y: number };
  // Where the hero appears: the tile just inside the exit mat.
  spawn: { x: number; y: number };
}

// Pure: the same template + level always gives the same map (generated lazily, never saved).
export function buildInteriorMap(id: InteriorTemplateId, level: number): InteriorMap {
  const t = INTERIOR_TEMPLATES[id];
  const h = t.rows.length;
  const w = t.rows[0].length;
  let cells = "";
  const props: InteriorMap["props"] = [];
  const slots: InteriorMap["slots"] = [];
  let exit = { x: Math.floor(w / 2), y: h - 1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = t.rows[y][x] ?? " ";
      if (ch === "#" || ch === " ") {
        cells += ch;
        continue;
      }
      if (ch === "E") {
        exit = { x, y };
        cells += "E";
        continue;
      }
      cells += ".";
      const sym = INTERIOR_LEGEND[ch];
      if (!sym || (sym.minLevel ?? 1) > level) continue;
      if (sym.prop) props.push({ prop: sym.prop, x, y });
      if (sym.npc) slots.push({ slot: sym.npc, x, y });
    }
  }
  return { templateId: id, label: t.label, level, w, h, floor: t.floor, wall: t.wall, cells, props, slots, exit, spawn: { x: exit.x, y: exit.y - 1 } };
}

// Solid cells of a built map (walls, nothing, solid props); the exit mat is walkable.
export function interiorSolidGrid(m: InteriorMap): Uint8Array {
  const g = new Uint8Array(m.w * m.h);
  for (let i = 0; i < g.length; i++) g[i] = m.cells[i] === "#" || m.cells[i] === " " ? 1 : 0;
  for (const p of m.props) if (!INTERIOR_WALKABLE_PROPS.has(p.prop)) g[p.y * m.w + p.x] = 1;
  return g;
}

// ---- wire ----
// One NPC drawn inside (bound by the server to a colonist / a settlement's role).
export interface InteriorNpcSnapshot {
  id: string;
  name: string;
  roleLabel: string;
  x: number;
  y: number;
  color: number;
  // Art: a colonist kind ("bishop", "villager", ...).
  kind: string;
}
// Message `interior` view: the map (tiles), its NPCs, the chest (own buildings: contents; null: not yours / none),
// whether the bed is yours to sleep in, and how many hostiles are near the door.
export interface InteriorView {
  key: string;
  tx: number;
  ty: number;
  map: InteriorMap;
  npcs: InteriorNpcSnapshot[];
  chest: Partial<Record<PackGood, number>> | null;
  chestCap: number;
  canSleep: boolean;
  threat: number;
  // The settlement / owner shown in the title ("Your House", "Tavern of Ashford", "Saint Wren's Abbey").
  title: string;
}
