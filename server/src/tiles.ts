// tiles.ts: Tile helpers: indices, bounds, biomes, roads, building levels, the owner map, day/night.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TileType, TILE_SIZE, PLAYER_HALF_SIZE, isSolidTile, Biome, isRoadTile } from "@colony/shared/protocol";
import type { TileCoord } from "./types.js";
import {
  DAY_TICKS, FARM_PRODUCE_BY_TILE, HILLS_MINING_BONUS, LEVEL_BONUS_PER_STEP, NIGHT_TICKS, PLAINS_FARMING_BONUS,
  ROAD_SPEED_BONUS, SWAMP_SPEED_PENALTY,
} from "./constants.js";
import { buildingLevel, colonists, constructionSites, ownerSiteIds, players, state, structureBreach, tileOwner } from "./state.js";
import {
  FOOTPRINT_BY_TILE, footprintAnchorOf, placedFootprintAt, type Footprint,
} from "@colony/shared/buildings";
import { isWalkablePixel } from "./wildlife.js";

export function ownerAt(index: number): number {
  return tileOwner.size === 0 ? 0 : (tileOwner.get(index) ?? 0);
}

// The site number of a siteId (registered on first use), 0 for null.
export function siteNumber(siteId: string | null | undefined, register = false): number {
  if (!siteId) return 0;
  const i = ownerSiteIds.indexOf(siteId);
  if (i >= 0) return i + 1;
  if (!register) return 0;
  ownerSiteIds.push(siteId);
  return ownerSiteIds.length;
}

export function clearOwners() {
  tileOwner.clear();
  ownerSiteIds.length = 0;
  structureBreach.clear();
  state.ownerVersion++;
  state.buildingTargetsDirty = true;
}

export function setOwner(index: number, owner: number) {
  if (owner > 0) tileOwner.set(index, owner);
  else if (!tileOwner.delete(index)) return;
  state.ownerVersion++;
  state.buildingTargetsDirty = true;
}

// v1: every NPC site is hostile to the colony (relations come in phase D).
export function isHostileOwner(owner: number): boolean {
  return owner > 0;
}

export function tileIndex(tx: number, ty: number): number {
  return ty * state.WORLD_TILES_X + tx;
}

export function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < state.WORLD_TILES_X && ty < state.WORLD_TILES_Y;
}

export function tileAtPixel(px: number, py: number): TileType {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  if (!inBounds(tx, ty)) return TileType.Wall;
  return state.tiles[tileIndex(tx, ty)] as TileType;
}

export function collidesAt(px: number, py: number): boolean {
  const offsets = [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE];
  for (const ox of offsets) {
    for (const oy of offsets) {
      const t = tileAtPixel(px + ox, py + oy);
      if (isSolidTile(t) || (t === TileType.Gate && !isWalkablePixel(px + ox, py + oy))) return true;
    }
  }
  return false;
}

export function tileToPixelCenter(tile: TileCoord): { x: number; y: number } {
  return {
    x: tile.x * TILE_SIZE + TILE_SIZE / 2,
    y: tile.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function tileOfPixel(px: number, py: number): TileCoord {
  return { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
}

export function biomeAt(tx: number, ty: number): Biome {
  if (!inBounds(tx, ty)) return Biome.Plains;
  return state.biomes[tileIndex(tx, ty)] as Biome;
}

// Movement multiplier for any entity (player, colonist, mob), from the biome of the tile it is
// standing on right now (not where it is heading).
export function biomeSpeedMultiplier(px: number, py: number): number {
  const t = tileOfPixel(px, py);
  return biomeAt(t.x, t.y) === Biome.Swamp ? 1 - SWAMP_SPEED_PENALTY : 1;
}
export function roadSpeedMultiplier(px: number, py: number): number {
  return isRoadTile(tileAtPixel(px, py)) ? 1 + ROAD_SPEED_BONUS : 1;
}

// Production-timer multiplier for a building, from the biome of its own tile: mines on Hills and
// farms (Farm Plot / Pasture / Orchard / Sheep / Hemp) on Plains run 20% shorter cycles.
export function biomeProductionFactor(tx: number, ty: number): number {
  const tile = state.tiles[tileIndex(tx, ty)] as TileType;
  const biome = biomeAt(tx, ty);
  if ((tile === TileType.IronMinePost || tile === TileType.RockMinePost) && biome === Biome.Hills) {
    return 1 - HILLS_MINING_BONUS;
  }
  if ((tile === TileType.FarmPlot || FARM_PRODUCE_BY_TILE[tile] !== undefined) && biome === Biome.Plains) {
    return 1 - PLAINS_FARMING_BONUS;
  }
  return 1;
}

export function tileOccupiedByEntity(tx: number, ty: number): boolean {
  for (const p of players.values()) {
    const t = tileOfPixel(p.x, p.y);
    if (t.x === tx && t.y === ty) return true;
  }
  for (const c of colonists.values()) {
    const t = tileOfPixel(c.x, c.y);
    if (t.x === tx && t.y === ty) return true;
  }
  return false;
}
export function resourceKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}
export function isNightNow(): boolean {
  const t = state.cycleTick % (DAY_TICKS + NIGHT_TICKS);
  return t >= DAY_TICKS;
}

export function levelBonus(level: number, step = LEVEL_BONUS_PER_STEP): number {
  return (Math.min(Math.max(level, 1), 3) - 1) * step;
}

export function getBuildingLevel(tx: number, ty: number): number {
  return buildingLevel.get(resourceKey(tx, ty)) ?? 1;
}
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---- Multi-tile footprints (shared FOOTPRINT_BY_TILE; ROADMAP "Hemp, pastures, gear pickup, forge autocraft") ----
// The tile at (x, y), -1 off the map.
export function tileAtOrNone(x: number, y: number): number {
  return inBounds(x, y) ? state.tiles[tileIndex(x, y)] : -1;
}

// Footprint of the building type at (x, y) (for a construction site: of its target), null when 1x1-only.
export function footprintSizeAt(x: number, y: number): Footprint | null {
  if (!inBounds(x, y)) return null;
  const t = state.tiles[tileIndex(x, y)] as TileType;
  const target = t === TileType.ConstructionSite ? constructionSites.get(resourceKey(x, y))?.target : t;
  return target === undefined ? null : (FOOTPRINT_BY_TILE[target] ?? null);
}

// The footprint the building anchored at (x, y) covers now (1x1 for ordinary and legacy buildings).
export function placedFootprint(x: number, y: number): Footprint {
  return placedFootprintAt(tileAtOrNone, footprintSizeAt, x, y);
}

// A BuildingPart's anchor; any other tile (or an orphan part) is its own.
export function anchorOfTile(x: number, y: number): TileCoord {
  if (tileAtOrNone(x, y) !== TileType.BuildingPart) return { x, y };
  return footprintAnchorOf(tileAtOrNone, footprintSizeAt, x, y) ?? { x, y };
}
