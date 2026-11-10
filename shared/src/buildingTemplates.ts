// buildingTemplates.ts: modular BUILDING templates (blueprints made of the phase 1-2 structure pieces), shared by the
// server (template store, blueprint orders, creative stamper, settlement stamper) and the client (Blueprints tab,
// creative building editor). A template is an ASCII grid (BUILDING_LEGEND) of walls, doors, windows, floors, beds,
// furniture, production stations (a station that IS the production building, e.g. the Blacksmith tile as the
// forge) and annexes (prefab buildings that stand OUTSIDE the rooms, e.g. the Market stall or a Barn), plus worker /
// NPC slots, and metadata (id, name, building type, tier, door side, may rotate / mirror, the room role it produces).
// Its footprint, materials, needs (progression) and rooms are computed from the grid, never stored. Built-ins live in
// server/data/buildings/*.json, the editor's saves in server/data/buildings/user/*.json; both load at boot.
import { TileType } from "./protocol.js";
import { BUILD_COSTS, type BuildCost } from "./buildings.js";
import { findRooms, isFurniturePartTile, isRoomBoundaryTile } from "./structures.js";
import { type RoomRole, roomRole } from "./rooms.js";
import { PROGRESSION, type Requires, unmetRequirements } from "./progression.js";
import { type CampEntrance, transformEntrance, transformRows } from "./camps.js";

export type BuildingDoorSide = CampEntrance;

export const BUILDING_TYPES = [
  "house", "longhouse", "tavern", "church", "abbey", "blacksmith", "bakery", "market", "barracks", "hall", "granary",
  "barn", "stables", "chickenCoop", "livestockBarn", "pigSty", "sheepPen", "mill", "brewery", "tailor", "library",
  "watchtower", "gatehouse", "hospital", "keep",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];
export const BUILDING_TYPE_LABEL: Record<BuildingType, string> = {
  house: "House", longhouse: "Longhouse", tavern: "Tavern", church: "Church", abbey: "Abbey", blacksmith: "Blacksmith",
  bakery: "Bakery", market: "Market / shop", barracks: "Barracks", hall: "Great hall", granary: "Granary", barn: "Barn",
  stables: "Stables", chickenCoop: "Chicken coop", livestockBarn: "Livestock barn", pigSty: "Pig sty", sheepPen: "Sheep pen",
  mill: "Mill", brewery: "Brewery", tailor: "Tailor", library: "Library / scribe", watchtower: "Watchtower", gatehouse: "Gatehouse",
  hospital: "Hospital / apothecary", keep: "Keep (town center)",
};
// Gap closure G8: building types whose templates may have a fenced animal yard (fence symbol "f").
export const YARD_BUILDING_TYPES: readonly BuildingType[] = ["chickenCoop", "pigSty", "sheepPen", "livestockBarn", "stables", "barn"];

export interface BuildingTemplate {
  id: string;
  name: string;
  buildingType: BuildingType;
  // Size tier 1 (small) - 3 (large).
  tier: number;
  // The side the one outside door faces (in the untransformed grid).
  doorSide: BuildingDoorSide;
  // Whether the player's ghost / world-gen may turn / mirror it.
  rotate: boolean;
  mirror: boolean;
  // The room role (shared/src/rooms.ts) the building is for: at least one of its rooms resolves to it.
  role: RoomRole;
  rows: string[];
  // Set by the server on the list it sends: a built-in (read-only in the editor) or a user template.
  builtin?: boolean;
}

// What a symbol is: a wall piece, a door, a window, a floor, furniture (beds too), a station (stands inside a
// room), an annex (a prefab building outside the rooms) or nothing.
export type BuildingPieceKind = "none" | "wall" | "door" | "window" | "floor" | "furniture" | "station" | "annex" | "fence";
export interface BuildingSymbol {
  label: string;
  // Tile placed there (undefined: nothing; the cell stays open ground / bare floor).
  tile?: TileType;
  kind: BuildingPieceKind;
  // A worker / NPC slot (the slot cell is laid as a wood floor).
  slot?: "worker" | "npc";
  // Editor swatch / thumbnail colour.
  color: string;
  // Gap closure G1: a 2-tile piece: two adjacent cells of the symbol (side by side or one above the other) make one
  // piece (pairs are read left to right, top to bottom; the top-left cell is its anchor, the other its part tile).
  cells?: 2;
  // Gap closure G8: a gate passage floor (a room of it may have two outside doors, one at each end).
  passage?: true;
}

export const BUILDING_LEGEND: Record<string, BuildingSymbol> = {
  ".": { label: "Open ground / bare floor", kind: "none", color: "#c9d6a0" },
  "#": { label: "Wood wall", tile: TileType.Wall, kind: "wall", color: "#7a5230" },
  "%": { label: "Stone wall", tile: TileType.StoneWall, kind: "wall", color: "#6c6e73" },
  "+": { label: "Wood door", tile: TileType.WoodDoor, kind: "door", color: "#c08040" },
  D: { label: "Stone door", tile: TileType.StoneDoor, kind: "door", color: "#a0a0a8" },
  w: { label: "Wood window", tile: TileType.WoodWindow, kind: "window", color: "#8fc8e8" },
  W: { label: "Stone window", tile: TileType.StoneWindow, kind: "window", color: "#6fa8d8" },
  "=": { label: "Wood floor", tile: TileType.WoodFloor, kind: "floor", color: "#b98448" },
  ":": { label: "Stone floor", tile: TileType.StoneFloor, kind: "floor", color: "#b1b3b8" },
  b: { label: "Bed", tile: TileType.Bed, kind: "furniture", color: "#d04848" },
  t: { label: "Table", tile: TileType.Table, kind: "furniture", color: "#8a5a2b" },
  c: { label: "Chair", tile: TileType.Chair, kind: "furniture", color: "#a87038" },
  x: { label: "Chest", tile: TileType.Chest, kind: "furniture", color: "#d8a040" },
  s: { label: "Shelf", tile: TileType.Shelf, kind: "furniture", color: "#906838" },
  h: { label: "Hearth", tile: TileType.Hearth, kind: "furniture", color: "#e2572b" },
  l: { label: "Lamp", tile: TileType.Lamp, kind: "furniture", color: "#f0d040" },
  r: { label: "Rug", tile: TileType.Rug, kind: "furniture", color: "#b04080" },
  k: { label: "Workbench", tile: TileType.Workbench, kind: "furniture", color: "#705030" },
  u: { label: "Statue", tile: TileType.Statue, kind: "furniture", color: "#e8e8e0" },
  a: { label: "Weapon rack", tile: TileType.WeaponRack, kind: "furniture", color: "#505870" },
  // Gap closure G1: 2-tile furniture (two cells each) and the medicine chest.
  B: { label: "Bed, 2 tiles (two cells)", tile: TileType.Bed, kind: "furniture", color: "#e06060", cells: 2 },
  n: { label: "Long table (two cells)", tile: TileType.LongTable, kind: "furniture", color: "#9a6a3b", cells: 2 },
  d: { label: "Wardrobe (two cells)", tile: TileType.Wardrobe, kind: "furniture", color: "#7a4a28", cells: 2 },
  m: { label: "Medicine chest", tile: TileType.MedicineChest, kind: "furniture", color: "#e8f0e0" },
  // Stations: the production building tile itself stands in the room as the station.
  F: { label: "Forge / anvil (Blacksmith)", tile: TileType.Blacksmith, kind: "station", color: "#402020" },
  O: { label: "Oven (Bakery)", tile: TileType.Bakery, kind: "station", color: "#c06030" },
  M: { label: "Mill stone (Mill)", tile: TileType.Mill, kind: "station", color: "#a09070" },
  L: { label: "Loom (Tailor)", tile: TileType.TailorShop, kind: "station", color: "#6080c0" },
  V: { label: "Brew vat (Brewery)", tile: TileType.Brewery, kind: "station", color: "#806020" },
  I: { label: "Inn counter (Tavern)", tile: TileType.Tavern, kind: "station", color: "#a04020" },
  A: { label: "Altar (Church)", tile: TileType.ChurchPost, kind: "station", color: "#f0f0ff" },
  J: { label: "Jeweller's bench (Luxury Workshop)", tile: TileType.LuxuryWorkshop, kind: "station", color: "#d0a0f0" },
  // Annexes: prefab buildings outside the rooms (they are not room interior tiles).
  $: { label: "Market stall (Market)", tile: TileType.Market, kind: "annex", color: "#e0b040" },
  G: { label: "Barn (farm fields)", tile: TileType.BarnPost, kind: "annex", color: "#a04030" },
  E: { label: "Stables", tile: TileType.Stables, kind: "annex", color: "#806040" },
  Q: { label: "Chicken coop", tile: TileType.ChickenCoop, kind: "annex", color: "#e0d0a0" },
  X: { label: "Livestock barn", tile: TileType.LivestockBarn, kind: "annex", color: "#905030" },
  P: { label: "Pig sty", tile: TileType.PigSty, kind: "annex", color: "#f0a0b0" },
  N: { label: "Sheep pen", tile: TileType.SheepPen, kind: "annex", color: "#f0f0e0" },
  T: { label: "Tower", tile: TileType.Tower, kind: "annex", color: "#505050" },
  K: { label: "Militia post", tile: TileType.MilitiaPost, kind: "annex", color: "#304080" },
  g: { label: "Gate (in a wall line)", tile: TileType.Gate, kind: "wall", color: "#604020" },
  // Slots (laid as a wood floor): where a posted worker / a resident or settlement NPC stands.
  "@": { label: "Worker slot", tile: TileType.WoodFloor, kind: "floor", slot: "worker", color: "#2060c0" },
  "&": { label: "NPC / resident slot", tile: TileType.WoodFloor, kind: "floor", slot: "npc", color: "#20a060" },
  // Gap closure G8: the Keep anchor (a "keep" template has exactly one: the single-tile Keep / town center building,
  // standing in its hall like a station; in a settlement it becomes the settlement's keep), the yard fence of an animal
  // house (encloses a yard with a gate "g"; animal houses only) and the gate passage floor (a gatehouse's road through).
  Y: { label: "Keep anchor (Keep / town center: exactly one in a keep)", tile: TileType.Keep, kind: "station", color: "#c02020" },
  f: { label: "Yard fence (animal houses)", tile: TileType.PropFence, kind: "fence", color: "#9a7040" },
  ",": { label: "Gate passage floor (two outside doors)", tile: TileType.StoneFloor, kind: "floor", passage: true, color: "#c8c0a8" },
};

// Client-only build tool (never sent as a tile): the Blueprints tab's "place the picked template" tool.
export const BLUEPRINT_TOOL = 220 as TileType;

export const BUILDING_SIZE_MIN = 3;
export const BUILDING_SIZE_MAX = 15;
const DOOR_SIDES: BuildingDoorSide[] = ["N", "E", "S", "W"];
const ROLES: RoomRole[] = ["bedroom", "barracks", "kitchen", "workshop", "hall", "storeroom", "church", "infirmary"];
const SIDE_STEP: Record<BuildingDoorSide, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

// Solid pieces (block walking): walls, windows, gates are boundaries; stations and annexes are buildings; fences.
// Doors are passable for the owner (gate tiles); furniture, beds and floors are walkable. Gap closure G8: a gate
// ("g", e.g. a yard's) passes too, like a door.
function symbolSolid(s: BuildingSymbol): boolean {
  return s.kind === "wall" || s.kind === "window" || s.kind === "station" || s.kind === "annex" || s.kind === "fence";
}
function symbolWalkable(s: BuildingSymbol): boolean {
  return s.tile === TileType.Gate || !symbolSolid(s);
}

// Gap closure G1: the tile of every cell (undefined: nothing), with 2-tile pieces paired (anchor + part tile), and the
// cells of a 2-tile symbol left without a partner ("half a bed": a validation error; it is laid as a 1x1 piece).
export function buildingPieceTiles(rows: readonly string[]): { tiles: (TileType | undefined)[][]; unpaired: { x: number; y: number }[] } {
  const tiles = rows.map((row) => Array.from(row, (ch) => BUILDING_LEGEND[ch]?.tile));
  const paired = rows.map((row) => new Array<boolean>(row.length).fill(false));
  const unpaired: { x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (BUILDING_LEGEND[row[x]]?.cells !== 2 || paired[y][x]) continue;
      paired[y][x] = true;
      if (row[x + 1] === row[x] && !paired[y][x + 1]) {
        paired[y][x + 1] = true;
        tiles[y][x + 1] = TileType.FurniturePartW;
      } else if (rows[y + 1]?.[x] === row[x] && !paired[y + 1][x]) {
        paired[y + 1][x] = true;
        tiles[y + 1][x] = TileType.FurniturePartN;
      } else unpaired.push({ x, y });
    }
  });
  return { tiles, unpaired };
}

export interface BuildingCell {
  x: number;
  y: number;
  ch: string;
  tile: TileType;
}

// The template's piece cells (every symbol with a tile) after `transform` (0-7: bits 0-1 = quarter turns clockwise,
// bit 2 = mirror left-right first), as offsets from the transformed grid's top-left; plus its transformed size.
export function buildingCells(t: Pick<BuildingTemplate, "rows">, transform = 0): { w: number; h: number; cells: BuildingCell[] } {
  const rows = transform ? transformRows(t.rows, transform) : t.rows;
  const cells: BuildingCell[] = [];
  const grid = buildingPieceTiles(rows).tiles;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const tile = grid[y][x];
      if (tile !== undefined) cells.push({ x, y, ch: row[x], tile });
    }
  });
  return { w: rows[0]?.length ?? 0, h: rows.length, cells };
}

// The top-left of a footprint of w x h centred on (cx, cy) (the ghost / order anchor: the cursor tile).
export function buildingOrigin(cx: number, cy: number, w: number, h: number): { x: number; y: number } {
  return { x: cx - (w >> 1), y: cy - (h >> 1) };
}

export function buildingDoorSide(t: Pick<BuildingTemplate, "doorSide">, transform: number): BuildingDoorSide {
  return transformEntrance(t.doorSide, transform);
}

export interface BuildingRoomInfo {
  role: RoomRole;
  tiles: number;
  beds: number;
}
export interface BuildingStats {
  w: number;
  h: number;
  rooms: BuildingRoomInfo[];
  beds: number;
  workerSlots: number;
  npcSlots: number;
  pieces: number;
  // Gap closure G8: fenced yards and gate passages.
  yards: number;
  passages: number;
  // Materials: the sum of the pieces' BUILD_COSTS.
  cost: BuildCost;
  // Progression gates of its pieces (labels, e.g. "Stone axe", "a Quarry").
  needs: string[];
}

export function buildingCost(t: Pick<BuildingTemplate, "rows">): BuildCost {
  const out: BuildCost = {};
  for (const c of buildingCells(t).cells) {
    const cost = (BUILD_COSTS as Partial<Record<TileType, BuildCost>>)[c.tile] ?? {};
    for (const [k, v] of Object.entries(cost) as [keyof BuildCost, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export function buildingCostText(cost: BuildCost): string {
  const parts = (Object.entries(cost) as [string, number][]).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k === "rock" ? "stone" : k}`);
  return parts.length ? parts.join(", ") : "free";
}

// Every progression gate of the template's pieces (shared PROGRESSION.buildings[tile].requires), as labels.
export function buildingNeeds(t: Pick<BuildingTemplate, "rows">): string[] {
  const merged: Requires = { items: {}, buildings: [] };
  const seen = new Set<number>();
  for (const c of buildingCells(t).cells) {
    if (seen.has(c.tile)) continue;
    seen.add(c.tile);
    const req = (PROGRESSION.buildings as Partial<Record<TileType, { requires?: Requires }>>)[c.tile]?.requires;
    if (!req) continue;
    const items = merged.items as Record<string, number>;
    for (const [id, n] of Object.entries(req.items ?? {})) items[id] = Math.max(items[id] ?? 0, n as number);
    for (const b of req.buildings ?? []) if (!merged.buildings!.some((o) => o.tile === b.tile)) merged.buildings!.push(b);
  }
  return unmetRequirements(merged, { items: {}, buildings: {}, day: 0 });
}

interface Analysis {
  w: number;
  h: number;
  errs: string[];
  rooms: BuildingRoomInfo[];
  // Per grid cell: room index, -1 outside, -2 boundary, -3 enclosed non-room, -4 fence, -5 a fenced yard.
  regionOf: Int32Array;
  // Gap closure G8: fenced animal yards and gate passages (rooms with a passage floor).
  yards: number;
  passages: number;
}

// The rooms (shared findRooms on the grid with a one-tile open apron) and the checks of validateBuildingTemplate.
function analyse(rows: string[], doorSide: BuildingDoorSide | undefined): Analysis {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const errs: string[] = [];
  const PW = w + 2;
  const PH = h + 2;
  const pieces = buildingPieceTiles(rows);
  for (const u of pieces.unpaired) errs.push(`${BUILDING_LEGEND[rows[u.y][u.x]].label} at ${u.x},${u.y} needs its second cell beside or below it`);
  const tileAt = (i: number) => {
    const x = (i % PW) - 1;
    const y = Math.floor(i / PW) - 1;
    if (x < 0 || y < 0 || x >= w || y >= h) return TileType.Empty;
    return pieces.tiles[y][x] ?? TileType.Empty;
  };
  const boundary: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isRoomBoundaryTile(tileAt((y + 1) * PW + x + 1))) boundary.push((y + 1) * PW + x + 1);
  const found = findRooms(PW, PH, tileAt, boundary);
  const regionOf = new Int32Array(w * h).fill(-3);
  const rooms: BuildingRoomInfo[] = [];
  found.forEach((r, k) => {
    rooms.push({ role: roomRole(r.tiles.length, r.counts), tiles: r.tiles.length, beds: r.beds.length });
    for (const i of r.tiles) regionOf[(Math.floor(i / PW) - 1) * w + (i % PW) - 1] = k;
  });
  const sym = (x: number, y: number) => BUILDING_LEGEND[rows[y][x]];
  // Outside: flood the non-boundary cells from the apron (fences stop it: what they enclose is a yard).
  const queue: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (isRoomBoundaryTile(sym(x, y).tile ?? TileType.Empty)) regionOf[y * w + x] = -2;
    else if (sym(x, y).kind === "fence") regionOf[y * w + x] = -4;
    else if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && regionOf[y * w + x] === -3) {
      regionOf[y * w + x] = -1;
      queue.push(y * w + x);
    }
  }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || regionOf[ny * w + nx] !== -3) continue;
      regionOf[ny * w + nx] = -1;
      queue.push(ny * w + nx);
    }
  }
  // Gap closure G8: an enclosed non-room area touching a fence is a yard: open ground and annexes (the animal house)
  // only, at most 144 tiles, entered through a gate / door (checked with the reachability below).
  const yardCells: number[][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (regionOf[y * w + x] !== -3) continue;
    const comp: number[] = [];
    let fenced = false;
    const stack = [y * w + x];
    const mark = new Set(stack);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const [dx, dy] of DIRS) {
        const nx = (cur % w) + dx;
        const ny = Math.floor(cur / w) + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (regionOf[n] === -4) fenced = true;
        if (regionOf[n] === -3 && !mark.has(n)) {
          mark.add(n);
          stack.push(n);
        }
      }
    }
    if (!fenced) {
      for (const i of comp) regionOf[i] = -6;
      continue;
    }
    for (const i of comp) regionOf[i] = -5;
    yardCells.push(comp);
    if (comp.length > 144) errs.push(`the yard at ${x},${y} is over 144 tiles`);
    for (const i of comp) {
      const s = sym(i % w, Math.floor(i / w));
      if (s.kind !== "none" && s.kind !== "annex") errs.push(`${s.label} at ${i % w},${Math.floor(i / w)}: a yard holds only open ground and the animal house`);
    }
  }
  for (let i = 0; i < w * h; i++) if (regionOf[i] === -6) regionOf[i] = -3;
  const enclosed: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const reg = regionOf[y * w + x];
    const s = sym(x, y);
    if (reg === -3) enclosed.push(`${x},${y}`);
    if (reg === -1 && (s.kind === "furniture" || s.kind === "station" || s.slot)) errs.push(`${s.label} at ${x},${y} is outside every room`);
    if (reg >= 0 && s.kind === "annex") errs.push(`${s.label} at ${x},${y} must stand outside the rooms`);
  }
  if (enclosed.length > 0) errs.push(`enclosed area at ${enclosed[0]} is not a valid room (only floors, beds, furniture and stations inside; at most 144 tiles)`);
  if (rooms.length === 0) errs.push("no room: enclose an area with walls and a door");
  // Gap closure G8: gate passages: rooms with a passage floor. Each has exactly two outside doors (one at each end);
  // the guard rooms either side open into it.
  const passageRoom = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (regionOf[y * w + x] >= 0 && sym(x, y).passage) passageRoom.add(regionOf[y * w + x]);
  // Doors: each touches a room (or a yard); exactly one opens to the outside, on the door side (a building with
  // passages: two per passage, plus at most one other).
  const outsideDoors: { x: number; y: number; passage: number }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sym(x, y).kind !== "door") continue;
    let room = false;
    let out = false;
    let passage = -1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const reg = nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : regionOf[ny * w + nx];
      if (reg >= 0 || reg === -5) room = true;
      if (reg >= 0 && passageRoom.has(reg)) passage = reg;
      if (reg === -1) out = true;
    }
    if (!room) errs.push(`door at ${x},${y} opens into no room`);
    if (out) outsideDoors.push({ x, y, passage });
  }
  const faces = (d: { x: number; y: number }, side: BuildingDoorSide) => {
    const [dx, dy] = SIDE_STEP[side];
    const nx = d.x + dx;
    const ny = d.y + dy;
    return nx < 0 || ny < 0 || nx >= w || ny >= h || regionOf[ny * w + nx] === -1;
  };
  const plain = outsideDoors.filter((d) => d.passage < 0);
  if (passageRoom.size === 0) {
    if (outsideDoors.length !== 1) errs.push(`exactly one outside door (has ${outsideDoors.length})`);
    else if (doorSide && !faces(outsideDoors[0], doorSide)) errs.push(`the outside door at ${outsideDoors[0].x},${outsideDoors[0].y} does not face ${doorSide}`);
  } else {
    for (const r of passageRoom) {
      const n = outsideDoors.filter((d) => d.passage === r).length;
      if (n !== 2) errs.push(`a gate passage (room ${r + 1}) needs exactly two outside doors, one at each end (has ${n})`);
    }
    if (plain.length > 1) errs.push(`at most one outside door besides the gate passages (has ${plain.length})`);
    if (doorSide && !outsideDoors.some((d) => faces(d, doorSide))) errs.push(`no outside door faces ${doorSide}`);
  }
  // Reachability: walk from the open apron through doors over walkable cells (stations and annexes are solid).
  const seen = new Uint8Array(w * h);
  const walk: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && symbolWalkable(sym(x, y)) && regionOf[y * w + x] !== -3) {
      seen[y * w + x] = 1;
      walk.push(y * w + x);
    }
  }
  while (walk.length > 0) {
    const cur = walk.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !symbolWalkable(sym(nx, ny))) continue;
      seen[ny * w + nx] = 1;
      walk.push(ny * w + nx);
    }
  }
  const reachedRoom = new Set<number>();
  let pockets = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const reg = regionOf[y * w + x];
    const s = sym(x, y);
    if (reg >= 0 && seen[y * w + x]) reachedRoom.add(reg);
    if (reg >= 0 && symbolWalkable(s) && !seen[y * w + x]) pockets++;
    if (s.kind === "station" || s.kind === "annex") {
      let ok = false;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx]) ok = true;
      }
      if (!ok) errs.push(`${s.label} at ${x},${y} can't be reached`);
    }
  }
  if (pockets > 0) errs.push(`${pockets} floor tile(s) inside cut off from the door`);
  rooms.forEach((r, k) => {
    if (!reachedRoom.has(k)) errs.push(`a ${r.role} (room ${k + 1}) has no way in from the door`);
    if (r.role === "room" && !passageRoom.has(k)) errs.push(`room ${k + 1} (${r.tiles} tiles) has no role: give it a bed, table + hearth, station, chest or shelf`);
  });
  for (const comp of yardCells) if (!comp.some((i) => seen[i])) errs.push(`the yard at ${comp[0] % w},${Math.floor(comp[0] / w)} has no gate "g" (or door) in`);
  return { w, h, errs, rooms, regionOf, yards: yardCells.length, passages: passageRoom.size };
}

export function buildingStats(t: Pick<BuildingTemplate, "rows">): BuildingStats {
  const a = analyse(t.rows, undefined);
  let workerSlots = 0;
  let npcSlots = 0;
  let pieces = 0;
  const grid = buildingPieceTiles(t.rows).tiles;
  t.rows.forEach((row, y) => Array.from(row).forEach((ch, x) => {
    const s = BUILDING_LEGEND[ch];
    if (!s) return;
    // A 2-tile piece counts once.
    if (grid[y][x] !== undefined && !isFurniturePartTile(grid[y][x]!)) pieces++;
    if (s.slot === "worker") workerSlots++;
    if (s.slot === "npc") npcSlots++;
  }));
  return {
    w: a.w, h: a.h, rooms: a.rooms, beds: a.rooms.reduce((n, r) => n + r.beds, 0), workerSlots, npcSlots, pieces, yards: a.yards, passages: a.passages,
    cost: buildingCost(t), needs: buildingNeeds(t),
  };
}

// Every problem with a template (empty: valid): the shape, the legend, the metadata, then the rooms: every enclosed
// area is a room (floors / beds / furniture / stations inside, at most 144 tiles), furniture / stations / slots stand
// in a room and annexes outside, exactly one outside door (on its door side), every room and station reachable from
// it, no room without a role, and the template's role among its rooms' roles.
export function validateBuildingTemplate(t: unknown): string[] {
  const errs: string[] = [];
  const o = t as Partial<BuildingTemplate> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  if (typeof o.name !== "string" || o.name.trim().length === 0 || o.name.length > 40) errs.push("name: 1-40 characters");
  if (!BUILDING_TYPES.includes(o.buildingType as BuildingType)) errs.push(`buildingType: one of ${BUILDING_TYPES.join(", ")}`);
  if (!Number.isInteger(o.tier) || o.tier! < 1 || o.tier! > 3) errs.push("tier: 1, 2 or 3");
  if (!DOOR_SIDES.includes(o.doorSide as BuildingDoorSide)) errs.push("doorSide: N, E, S or W");
  if (typeof o.rotate !== "boolean" || typeof o.mirror !== "boolean") errs.push("rotate / mirror: true or false");
  if (!ROLES.includes(o.role as RoomRole)) errs.push(`role: one of ${ROLES.join(", ")}`);
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) return [...errs, "rows: a list of strings"];
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h < BUILDING_SIZE_MIN || h > BUILDING_SIZE_MAX || w < BUILDING_SIZE_MIN || w > BUILDING_SIZE_MAX) errs.push(`size: ${BUILDING_SIZE_MIN}-${BUILDING_SIZE_MAX} each way (is ${w}x${h})`);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      errs.push(`row ${y}: ${rows[y].length} wide, not ${w}`);
      continue;
    }
    for (let x = 0; x < w; x++) if (!(rows[y][x] in BUILDING_LEGEND)) errs.push(`unknown symbol "${rows[y][x]}" at ${x},${y}`);
  }
  if (errs.length > 0) return errs;
  const a = analyse(rows, o.doorSide as BuildingDoorSide);
  errs.push(...a.errs);
  // Gap closure G8: the Keep anchor (one per keep, none elsewhere); yards on animal houses only.
  const anchors = rows.reduce((n, r) => n + [...r].filter((ch) => BUILDING_LEGEND[ch]?.tile === TileType.Keep).length, 0);
  if (o.buildingType === "keep" ? anchors !== 1 : anchors !== 0) errs.push(`${o.buildingType === "keep" ? "a keep has exactly one" : "only a keep has a"} Keep anchor Y (has ${anchors})`);
  if (a.yards > 0 && !YARD_BUILDING_TYPES.includes(o.buildingType as BuildingType)) errs.push("only animal houses (coop, sty, pen, livestock barn, stables, barn) have fenced yards");
  if (a.errs.length === 0 && !a.rooms.some((r) => r.role === o.role)) errs.push(`no room resolves to "${o.role}" (rooms: ${a.rooms.map((r) => r.role).join(", ")})`);
  return errs;
}

// The bare cells ("." with no piece) inside the template's rooms after `transform`, as offsets from the transformed
// grid's top-left: a blueprint needs them clear (open ground or a floor) or the room never closes.
export function buildingBareInterior(t: Pick<BuildingTemplate, "rows">, transform = 0): { x: number; y: number }[] {
  const rows = transform ? transformRows(t.rows, transform) : t.rows;
  const a = analyse(rows, undefined);
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (a.regionOf[y * a.w + x] >= 0 && BUILDING_LEGEND[rows[y][x]]?.tile === undefined) out.push({ x, y });
  return out;
}

// The rooms a placed template's tiles make (for tests / the editor): roles in grid order.
export function buildingRoomRoles(t: Pick<BuildingTemplate, "rows">): RoomRole[] {
  return analyse(t.rows, undefined).rooms.map((r) => r.role);
}
