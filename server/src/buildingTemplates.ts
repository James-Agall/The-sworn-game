// buildingTemplates.ts: modular building templates (shared/src/buildingTemplates.ts has the format, legend, rooms and
// validation). The template store (templateStore.ts: server/data/buildings/*.json + the editor's user folder), the
// player's blueprint order (one batch of construction sites through the ordinary setTile rules: cost, progression,
// builders, priority / cancel with refunds) and the creative stamper (instant, the editor's "Stamp here").
import { TileType } from "@colony/shared/protocol";
import {
  type BuildingTemplate, buildingBareInterior, buildingCells, buildingOrigin, validateBuildingTemplate,
} from "@colony/shared/buildingTemplates";
import {
  FURNITURE_FOOTPRINT, isDoorTile, isFloorTile, isFurniturePartTile, isRoomStationTile, isWindowTile, isStructureTile, structurePlacementOk,
} from "@colony/shared/structures";
import type { Cost, Player, ResourceKey, TileCoord } from "./types.js";
import { constructionSites, state } from "./state.js";
import { inBounds, ownerAt, resourceKey, tileIndex } from "./tiles.js";
import { isInSiteGrounds } from "./sites.js";
import { isForeignClanTile, setTileClan } from "./clans.js";
import { progressionBlocker } from "./progression.js";
import { canAfford, formatCost, handleSetTile, inOrderRange, keepPlacementBlocker, placementCost, resolvePlacement, sendEvent } from "./construction.js";
import { anyBuilderAlive } from "./colonists.js";
import { setTile } from "./chunks.js";
import { broadcastTileUpdate } from "./net.js";
import { campGroundClearable } from "./camps.js";
import { makeTemplateStore } from "./templateStore.js";

const store = makeTemplateStore<BuildingTemplate>({
  kind: "buildings",
  userEnv: "COLONY_BUILDING_USER_DIR",
  validate: validateBuildingTemplate,
  normalise: (o) => ({
    id: o.id, name: o.name, buildingType: o.buildingType, tier: o.tier, doorSide: o.doorSide, rotate: o.rotate, mirror: o.mirror,
    role: o.role, rows: o.rows.slice(),
  }),
});

export function loadBuildingTemplates() {
  const n = store.load();
  console.log(`[buildings] ${n.builtins} built-in + ${n.users} user building templates`);
}
export const buildingTemplates = () => store.all();
export const buildingTemplateById = (id: string) => store.byId(id);
export const saveUserBuilding = (raw: unknown) => store.save(raw);
export const deleteUserBuilding = (id: string) => store.remove(id);
export const userBuildingDir = () => store.userDir();

export interface PlannedPiece {
  x: number;
  y: number;
  tile: TileType;
}

// The world cells of template `t` turned by `transform` with its footprint centred on `center`: the pieces and the
// bare room-interior cells.
export function planBuilding(t: BuildingTemplate, center: TileCoord, transform: number): { pieces: PlannedPiece[]; bare: TileCoord[]; x0: number; y0: number; w: number; h: number } {
  const { w, h, cells } = buildingCells(t, transform);
  const o = buildingOrigin(center.x, center.y, w, h);
  return {
    pieces: cells.map((c) => ({ x: o.x + c.x, y: o.y + c.y, tile: c.tile })),
    bare: buildingBareInterior(t, transform).map((c) => ({ x: o.x + c.x, y: o.y + c.y })),
    x0: o.x, y0: o.y, w, h,
  };
}

// Walls, doors and windows last: the floors, furniture and stations are queued first (cosmetic: builders pick sites by
// priority / load / distance).
const pieceOrder = (t: TileType) => (t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate ? 2 : isDoorTile(t) || isWindowTile(t) ? 1 : 0);

// Why a blueprint of `t` can't go down at `center` (null: it can). Checks every cell first, so an order is all or
// nothing (units standing on a cell still refuse that one piece, as for any placement).
function blueprintProblem(player: Player, plan: ReturnType<typeof planBuilding>): string | null {
  const total: Cost = {};
  for (const p of plan.bare) {
    if (!inBounds(p.x, p.y)) return "Off the map";
    const cur = state.tiles[tileIndex(p.x, p.y)];
    if (cur !== TileType.Empty && !isFloorTile(cur)) return `Something is in the way at ${p.x},${p.y}`;
  }
  const checked = new Set<TileType>();
  for (const p of plan.pieces) {
    if (!inBounds(p.x, p.y)) return "Off the map";
    if (!inOrderRange(player, p.x, p.y)) return "Too far: blueprints go within 40 tiles of your hero or a Town Center";
    const i = tileIndex(p.x, p.y);
    if (ownerAt(i) !== 0 || isInSiteGrounds(p.x, p.y)) return "Too close to a fort / settlement";
    if (isForeignClanTile(p.x, p.y, player.clan)) return "Another clan's land is in the way";
    const cur = state.tiles[i] as TileType;
    if (cur === p.tile) continue;
    // Gap closure G1: a 2-tile piece's part tile comes with its anchor (no cost, no gate): it just needs the room.
    if (isFurniturePartTile(p.tile)) {
      if ((cur !== TileType.Empty && !isFloorTile(cur)) || constructionSites.has(resourceKey(p.x, p.y))) return `Something is in the way at ${p.x},${p.y}`;
      continue;
    }
    const site = constructionSites.get(resourceKey(p.x, p.y));
    if (site) {
      if (site.target === p.tile) continue;
      return `A construction site is in the way at ${p.x},${p.y}`;
    }
    const ok = isStructureTile(p.tile) ? structurePlacementOk(p.tile, cur) : cur === TileType.Empty || (isFloorTile(cur) && isRoomStationTile(p.tile));
    if (!ok) return `Something is in the way at ${p.x},${p.y}`;
    if (!checked.has(p.tile)) {
      checked.add(p.tile);
      const locked = progressionBlocker(p.tile, TileType.Empty, p.x, p.y, false);
      if (locked) return locked;
    }
    // Gap closure G8: a keep template's anchor has the prefab Keep's gates (Town Center level 2, one per settlement).
    if (p.tile === TileType.Keep) {
      const keep = keepPlacementBlocker(p.x, p.y);
      if (keep) return keep;
    }
    for (const [k, v] of Object.entries(placementCost(p.tile, cur, p.x, p.y)) as [ResourceKey, number][]) total[k] = (total[k] ?? 0) + v;
  }
  if (!canAfford(total)) return `Not enough materials: needs ${formatCost(total)}`;
  if (!state.instantBuild && !anyBuilderAlive()) return "No builders available";
  return null;
}

// placeBlueprint {id, x, y (the centre tile), transform 0-7}: every piece becomes a blueprint (a construction site
// the builders build piece by piece; creative builds at once). A toast says how many went down.
export function handlePlaceBlueprint(player: Player, id: unknown, x: unknown, y: unknown, transform: unknown): string | null {
  if (player.dead) return "Dead";
  const t = typeof id === "string" ? store.byId(id) : undefined;
  if (!t || !Number.isInteger(x) || !Number.isInteger(y)) return "Unknown blueprint";
  let tf = Math.max(0, Math.min(7, Math.floor(Number(transform) || 0)));
  if (!t.rotate) tf &= 4;
  if (!t.mirror) tf &= 3;
  const plan = planBuilding(t, { x: x as number, y: y as number }, tf);
  const problem = blueprintProblem(player, plan);
  if (problem) {
    sendEvent(player, "build", `${t.name}: ${problem}`);
    return problem;
  }
  let placed = 0;
  let tried = 0;
  const pieces = plan.pieces.slice().sort((a, b) => pieceOrder(a.tile) - pieceOrder(b.tile));
  // Gap closure G1: 2-tile pieces are ordered at their anchor, turned to match the part tile the plan has beside it.
  const partAt = new Map(plan.pieces.filter((p) => isFurniturePartTile(p.tile)).map((p) => [`${p.x},${p.y}`, p.tile]));
  const rotOf = (p: PlannedPiece): number | undefined => {
    const fp = FURNITURE_FOOTPRINT[p.tile];
    if (!fp) return undefined;
    const wide = partAt.get(`${p.x + 1},${p.y}`) === TileType.FurniturePartW;
    const tall = partAt.get(`${p.x},${p.y + 1}`) === TileType.FurniturePartN;
    if (!wide && !tall) return undefined;
    return (wide ? fp.w > 1 : fp.h > 1) ? 0 : 1;
  };
  for (const p of pieces) {
    const i = tileIndex(p.x, p.y);
    if (isFurniturePartTile(p.tile)) continue;
    if (state.tiles[i] === p.tile || constructionSites.get(resourceKey(p.x, p.y))?.target === p.tile) continue;
    tried++;
    const before = state.tiles[i];
    handleSetTile(player, p.x, p.y, p.tile, true, true, rotOf(p));
    if (state.tiles[i] !== before) placed++;
  }
  sendEvent(player, "build", `${t.name}: ${placed} ${state.instantBuild ? "pieces built" : "blueprints placed"}${placed < tried ? `, ${tried - placed} refused (someone standing there?)` : ""}`);
  return null;
}

// Creative "Stamp here" (the building editor): the footprint must be on the map, off fort / settlement grounds, with
// no construction site and only natural ground in it (cleared first); the pieces are laid at once as the player's
// clan's (stations / annexes resolve like a finished placement: staffed). A reason string, or null.
export function stampBuildingLive(player: Player, t: BuildingTemplate, center: TileCoord, transform: number): string | null {
  const errs = validateBuildingTemplate(t);
  if (errs.length > 0) return errs[0];
  const plan = planBuilding(t, center, transform);
  for (let y = plan.y0; y < plan.y0 + plan.h; y++) for (let x = plan.x0; x < plan.x0 + plan.w; x++) {
    if (!inBounds(x, y) || x < 1 || y < 1 || x > state.WORLD_TILES_X - 2 || y > state.WORLD_TILES_Y - 2) return "Too close to the map edge";
    if (isInSiteGrounds(x, y) || ownerAt(tileIndex(x, y)) !== 0) return "On a fort / settlement's grounds";
    if (constructionSites.has(resourceKey(x, y))) return "A construction site is in the way";
    const tile = state.tiles[tileIndex(x, y)];
    if (!campGroundClearable(tile) && !isFloorTile(tile)) return `Something is in the way at ${x},${y} (tile ${tile})`;
  }
  for (let y = plan.y0; y < plan.y0 + plan.h; y++) for (let x = plan.x0; x < plan.x0 + plan.w; x++) {
    if (state.tiles[tileIndex(x, y)] === TileType.Empty) continue;
    setTile(tileIndex(x, y), TileType.Empty);
    broadcastTileUpdate(x, y, TileType.Empty);
  }
  for (const p of plan.pieces) {
    setTileClan(tileIndex(p.x, p.y), player.clan);
    resolvePlacement(p.x, p.y, p.tile, TileType.Empty);
  }
  return null;
}
