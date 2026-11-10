// Modular building phase 1 (2026-11-09, docs/colony2d/PLAN-rimworld-stardew.md): structure pieces and rooms,
// shared by the server (population cap, homes, queries) and the client (roof drawing, build tools).
//
// Structure pieces are ordinary tiles in the one tile layer (setTile registry, chunk versions, saves): walls are
// the existing Wall (wood) / StoneWall, plus doors (gate tiles), windows (solid), floors and beds (walkable).
// A ROOM is a 4-connected region of interior tiles (ground, floors, beds, blueprints) fully enclosed by boundary
// pieces (walls, windows, doors, gates) and no larger than ROOM_MAX_TILES. Every room is roofed: the roof is
// derived from the tiles (never stored), so old saves and every tile edit stay consistent by construction.
// Anything else inside (a tree, a prefab building, a farm) means the area is not a room (an old walled compound
// full of houses never gets a roof).
import { TileType } from "./protocol.js";

export const ROOM_MAX_TILES = 144;
// Blueprint orders (placeStructure) reach this far from the hero or an own Town Center.
export const STRUCTURE_ORDER_RANGE_TILES = 40;
// Most tiles one placeStructure order may name.
export const STRUCTURE_ORDER_MAX_TILES = 400;

// Client-only build tools (never sent as tiles): the room rectangle tools (a wall outline in one drag).
export const ROOM_TOOL_WOOD = 200 as TileType;
export const ROOM_TOOL_STONE = 201 as TileType;

// Modular building phase 2: furniture (walkable 1x1 pieces; shared/src/rooms.ts gives them their room effects).
export const FURNITURE_TILES: readonly TileType[] = [
  TileType.Table, TileType.Chair, TileType.Chest, TileType.Shelf, TileType.Hearth, TileType.Lamp, TileType.Rug,
  TileType.Workbench, TileType.Statue, TileType.WeaponRack, TileType.LongTable, TileType.Wardrobe, TileType.MedicineChest,
];
export function isFurnitureTile(t: number): boolean {
  return t >= TileType.Table && t <= TileType.MedicineChest;
}

// ---- Gap closure G1 (2026-11-10): furniture larger than 1x1 ----
// A piece listed here covers 2 tiles: its ANCHOR (top-left) holds the piece's TileType (and is what rooms count, so
// every piece counts once), the other tile a part tile that names where the anchor is (FurniturePartW: west of it,
// FurniturePartN: north of it), so a piece's shape and turn are read from the tiles alone (no extra state).
// `rot` 1 turns the default footprint a quarter (w <-> h). A Bed placed with no turn given (old blueprint orders,
// templates' "b") stays a 1x1 bed; old 1x1 beds stay valid forever.
export interface FurnitureFootprint {
  w: number;
  h: number;
}
export const FURNITURE_FOOTPRINT: Partial<Record<TileType, FurnitureFootprint>> = {
  [TileType.Bed]: { w: 1, h: 2 },
  [TileType.LongTable]: { w: 2, h: 1 },
  [TileType.Wardrobe]: { w: 1, h: 2 },
};
export function isFurniturePartTile(t: number): boolean {
  return t === TileType.FurniturePartW || t === TileType.FurniturePartN;
}
// The footprint a NEW placement of `tile` takes (rot: 0 / 1, or undefined: a Bed stays 1x1).
export function furnitureFootprint(tile: number, rot: number | undefined): FurnitureFootprint {
  const fp = FURNITURE_FOOTPRINT[tile as TileType];
  if (!fp || (rot === undefined && tile === TileType.Bed)) return { w: 1, h: 1 };
  return rot === 1 ? { w: fp.h, h: fp.w } : fp;
}
// The part tiles of a w x h piece anchored at (x, y): [x, y, part tile] (2-tile pieces only).
export function furniturePartCells(x: number, y: number, fp: FurnitureFootprint): [number, number, TileType][] {
  if (fp.w === 2 && fp.h === 1) return [[x + 1, y, TileType.FurniturePartW]];
  if (fp.w === 1 && fp.h === 2) return [[x, y + 1, TileType.FurniturePartN]];
  return [];
}
// The piece a tile belongs to: its anchor and placed footprint (a part points at its anchor; an anchor's footprint
// follows its part tiles: none = 1x1). tileAt returns -1 off the map.
export function furniturePieceAt(tileAt: (x: number, y: number) => number, x: number, y: number): { x: number; y: number; w: number; h: number } {
  const t = tileAt(x, y);
  if (t === TileType.FurniturePartW) return { x: x - 1, y, w: 2, h: 1 };
  if (t === TileType.FurniturePartN) return { x, y: y - 1, w: 1, h: 2 };
  if (tileAt(x + 1, y) === TileType.FurniturePartW) return { x, y, w: 2, h: 1 };
  if (tileAt(x, y + 1) === TileType.FurniturePartN) return { x, y, w: 1, h: 2 };
  return { x, y, w: 1, h: 1 };
}
// Modular building phase 2: production stations that may stand inside a room (it becomes a workshop / church).
// They are ordinary 1x1 buildings; anything else (houses, posts, farms) still means "not a room". Gap closure G8: the
// Keep (and a settlement's SiteKeep) may stand in a keep template's hall (its anchor), giving the room no role of its own.
export const ROOM_STATION_TILES: readonly TileType[] = [
  TileType.Blacksmith, TileType.TailorShop, TileType.LuxuryWorkshop, TileType.Brewery, TileType.Bloomery,
  TileType.CharcoalBurner, TileType.Mill, TileType.Bakery, TileType.Tavern, TileType.ChurchPost, TileType.Keep, TileType.SiteKeep,
];
export function isRoomStationTile(t: number): boolean {
  return (ROOM_STATION_TILES as readonly number[]).includes(t);
}

// Every tile a placeStructure order may place.
export const STRUCTURE_TILES: readonly TileType[] = [
  TileType.Wall, TileType.StoneWall, TileType.WoodDoor, TileType.StoneDoor, TileType.WoodWindow, TileType.StoneWindow,
  TileType.WoodFloor, TileType.StoneFloor, TileType.Bed, ...FURNITURE_TILES,
];
// The new phase-1 pieces (walls predate them).
export const NEW_STRUCTURE_TILES: readonly TileType[] = STRUCTURE_TILES.filter((t) => t !== TileType.Wall && t !== TileType.StoneWall);

export function isStructureTile(t: number): boolean {
  return (STRUCTURE_TILES as readonly number[]).includes(t);
}
export function isDoorTile(t: number): boolean {
  return t === TileType.WoodDoor || t === TileType.StoneDoor;
}
export function isWindowTile(t: number): boolean {
  return t === TileType.WoodWindow || t === TileType.StoneWindow;
}
export function isFloorTile(t: number): boolean {
  return t === TileType.WoodFloor || t === TileType.StoneFloor;
}
export function isStoneStructure(t: number): boolean {
  return t === TileType.StoneWall || t === TileType.StoneDoor || t === TileType.StoneWindow || t === TileType.StoneFloor;
}
// Encloses a room: walls, windows, doors and the old gates.
export function isRoomBoundaryTile(t: number): boolean {
  return t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate || isDoorTile(t) || isWindowTile(t);
}
// May stand inside a room.
export function isRoomInteriorTile(t: number): boolean {
  return t === TileType.Empty || isFloorTile(t) || t === TileType.Bed || t === TileType.ConstructionSite || t === TileType.Road || t === TileType.CobbleRoad ||
    isFurnitureTile(t) || isFurniturePartTile(t) || isRoomStationTile(t);
}
// What a piece may be placed on (besides Empty): floors are re-laid over the other floor; walls, doors, windows
// and beds go over a floor; a door or window may replace a wall (cutting an opening).
export function structurePlacementOk(tile: number, current: number): boolean {
  if (current === TileType.Empty) return true;
  if (isFloorTile(tile)) return isFloorTile(current) && current !== tile;
  if (isFloorTile(current)) return true;
  if ((isDoorTile(tile) || isWindowTile(tile)) && (current === TileType.Wall || current === TileType.StoneWall)) return true;
  return false;
}

export interface Room {
  // Modular building phase 2: the room's id = its smallest tile index (stable while the room stands; the same on
  // server and client).
  id: number;
  // Interior tile indices, ascending.
  tiles: number[];
  // Phase 2: how many interior tiles hold each tile type (furniture, beds, floors, stations; Empty too), and how many
  // windows its boundary has.
  counts: Record<number, number>;
  windows: number;
  // Bed tile indices inside.
  beds: number[];
  // Stone roof (tile) when stone pieces make up at least half of the boundary, else thatch.
  stone: boolean;
  // Bounding box (tiles, inclusive).
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Every room on a W x H map. `boundary`: the indices of every boundary tile (rooms are found by flooding from
// their neighbours, so the cost follows the walls, not the map). Deterministic: server and client agree.
export function findRooms(W: number, H: number, tileAt: (i: number) => number, boundary: Iterable<number>): Room[] {
  // Tile index -> the flood that reached it (a flood that runs into an earlier one's tiles is connected to a
  // rejected region: enclosed rooms never touch each other).
  const seen = new Map<number, number>();
  const rooms: Room[] = [];
  let flood = 0;
  const seeds = Array.from(boundary).sort((a, b) => a - b);
  for (const b of seeds) {
    const bx = b % W;
    const by = Math.floor(b / W);
    for (const [dx, dy] of DIRS) {
      const sx = bx + dx;
      const sy = by + dy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const s = sy * W + sx;
      if (seen.has(s) || isRoomBoundaryTile(tileAt(s))) continue;
      const room = floodRoom(W, H, tileAt, s, seen, ++flood);
      if (room) rooms.push(room);
    }
  }
  return rooms;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function floodRoom(W: number, H: number, tileAt: (i: number) => number, start: number, seen: Map<number, number>, id: number): Room | null {
  const queue = [start];
  seen.set(start, id);
  let ok = true;
  let stoneN = 0;
  let woodN = 0;
  let windows = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % W;
    const y = Math.floor(i / W);
    if (!isRoomInteriorTile(tileAt(i))) ok = false;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      // Reaching the map edge: open to the world.
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
        ok = false;
        continue;
      }
      const n = ny * W + nx;
      const t = tileAt(n);
      if (isRoomBoundaryTile(t)) {
        if (isStoneStructure(t)) stoneN++;
        else woodN++;
        if (isWindowTile(t)) windows++;
        continue;
      }
      const prev = seen.get(n);
      if (prev !== undefined) {
        if (prev !== id) ok = false;
        continue;
      }
      seen.set(n, id);
      queue.push(n);
    }
    // Too big to be a room (an open field, a big walled yard): every tile seen is outside.
    if (queue.length > ROOM_MAX_TILES) {
      ok = false;
      break;
    }
  }
  // Rejected: its tiles stay marked, so a later flood that reaches them is rejected too.
  if (!ok) return null;
  queue.sort((a, b) => a - b);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const beds: number[] = [];
  const counts: Record<number, number> = {};
  for (const i of queue) {
    const x = i % W;
    const y = Math.floor(i / W);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    const t = tileAt(i);
    counts[t] = (counts[t] ?? 0) + 1;
    if (t === TileType.Bed) beds.push(i);
  }
  return { id: queue[0], tiles: queue, counts, windows, beds, stone: stoneN >= woodN && stoneN > 0, x0, y0, x1, y1 };
}

// Modular building phase 2 (incremental recompute): the room containing interior tile `start`, or null, plus every
// tile the flood visited (a rejected flood stops after ROOM_MAX_TILES + 1). Same rule as findRooms: a 4-connected
// non-boundary region of at most ROOM_MAX_TILES interior tiles that never reaches the map edge.
export function floodRoomAt(W: number, H: number, tileAt: (i: number) => number, start: number): { room: Room | null; visited: number[] } {
  const seen = new Map<number, number>();
  const room = floodRoom(W, H, tileAt, start, seen, 1);
  return { room, visited: Array.from(seen.keys()) };
}

// ---- build-tool shapes (client painting; the server just gets the tile list) ----
// A 4-connected line from a to b (a diagonal step adds the orthogonal tile between, so walls never leak at a corner).
export function lineTiles4(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  const out = [{ x: ax, y: ay }];
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    if (Math.abs(bx - x) >= Math.abs(by - y)) x += Math.sign(bx - x);
    else y += Math.sign(by - y);
    out.push({ x, y });
  }
  return out;
}

// A straight wall line: the drag snaps to its longer axis (what a wall painter wants).
export function wallLineTiles(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  return Math.abs(bx - ax) >= Math.abs(by - ay) ? lineTiles4(ax, ay, bx, ay) : lineTiles4(ax, ay, ax, by);
}

export function rectTiles(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push({ x, y });
  return out;
}

// The outline of a rectangle (a room's walls), clockwise from the top-left corner.
export function rectOutline(ax: number, ay: number, bx: number, by: number): { x: number; y: number }[] {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) out.push({ x, y: y0 });
  for (let y = y0 + 1; y <= y1; y++) out.push({ x: x1, y });
  if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) out.push({ x, y: y1 });
  if (x1 > x0) for (let y = y1 - 1; y > y0; y--) out.push({ x: x0, y });
  return out;
}
