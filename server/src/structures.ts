// structures.ts: Modular building phase 1 (2026-11-09): the server's rooms (shared/src/structures.ts findRooms over
// state.tiles), cached until a tile write could change one (chunks.ts tileRoomVersion) or the registry is rebuilt
// (new world / save load). A room's roof is derived, so this is all there is to "roof presence": isRoofed.
// Bedrooms: every bed in a roofed room is one home slot (population cap: settlementStatsAll; sleeping: people.ts
// assignHomes, colonists.ts assignShelter).
import { TileType } from "@colony/shared/protocol";
import { findRooms, isRoomBoundaryTile, type Room } from "@colony/shared/structures";
import { state } from "./state.js";
import { tileIndicesOfAny, tileRegistryEpoch, tileRoomVersion, tileTypesWhere } from "./chunks.js";
import { inBounds, ownerAt, tileIndex } from "./tiles.js";

let BOUNDARY: TileType[] | null = null;
let cachedKey = "";
let rooms: Room[] = [];
let roomOfTile = new Map<number, number>();

function refresh() {
  const key = `${tileRegistryEpoch()}:${tileRoomVersion()}:${state.WORLD_TILES_X}`;
  if (key === cachedKey) return;
  cachedKey = key;
  BOUNDARY ??= tileTypesWhere(isRoomBoundaryTile);
  const tiles = state.tiles;
  rooms = findRooms(state.WORLD_TILES_X, state.WORLD_TILES_Y, (i) => tiles[i], tileIndicesOfAny(BOUNDARY));
  roomOfTile = new Map();
  rooms.forEach((r, n) => {
    for (const i of r.tiles) roomOfTile.set(i, n);
  });
}

export function allRooms(): readonly Room[] {
  refresh();
  return rooms;
}

// The room (enclosed, roofed area) a tile is inside, or null.
export function roomAt(tx: number, ty: number): Room | null {
  if (!inBounds(tx, ty)) return null;
  refresh();
  const n = roomOfTile.get(tileIndex(tx, ty));
  return n === undefined ? null : rooms[n];
}

export function isRoofed(tx: number, ty: number): boolean {
  return roomAt(tx, ty) !== null;
}

// A bed counts (a home slot) only inside a roofed room, and not in an NPC fort.
export function isUsableBed(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Bed || ownerAt(tileIndex(tx, ty)) !== 0) return false;
  return isRoofed(tx, ty);
}

// Every usable bed's tile index (bedrooms), ascending.
export function usableBedIndices(): number[] {
  refresh();
  const out: number[] = [];
  for (const r of rooms) for (const i of r.beds) if (ownerAt(i) === 0) out.push(i);
  return out.sort((a, b) => a - b);
}

// Building info lines for a structure piece or anything standing in a room.
export function roomInfoLines(tx: number, ty: number): string[] {
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  const inside = roomAt(tx, ty);
  if (inside) {
    const beds = inside.beds.length;
    return [
      `In a roofed room: ${inside.tiles.length} tiles, ${inside.stone ? "tile" : "thatch"} roof`,
      beds > 0 ? `Bedroom: ${beds} bed${beds === 1 ? "" : "s"}, +${beds} population` : "No bed: put a bed in to make it a bedroom (+1 population per bed)",
    ];
  }
  if (t === TileType.Bed) return ["Not in a roofed room: enclose it with walls and a door (up to 144 tiles inside) to make a bedroom"];
  // A wall piece: the rooms it encloses.
  const near = new Set<Room>();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r = roomAt(tx + dx, ty + dy);
    if (r) near.add(r);
  }
  if (near.size === 0) return isRoomBoundaryTile(t) ? ["Encloses no room yet"] : [];
  return [...near].map((r) => `Encloses a ${r.tiles.length}-tile room (${r.beds.length} bed${r.beds.length === 1 ? "" : "s"})`);
}
