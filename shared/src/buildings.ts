// Building data shared by the server and the client (QUEUE item 5, stage 1: placement costs).
// BUILD_COSTS is the one definition of what placing a new building (level 1) or ground tile costs: the
// server's placementCost reads it through the named constants in server/src/constants.ts, and the
// client builds its build-tool cost text from it. Upgrade costs (House tiers, Stables / Keep / Tower /
// Town Center levels) are still server-only, in constants.ts.
import { TileType } from "./protocol.js";

export type BuildCost = Partial<Record<"wood" | "rock" | "iron" | "tools", number>>;

const CRAFT_BUILDING: BuildCost = { wood: 10, iron: 5 };
const FOOD_HUT: BuildCost = { wood: 15 };
const SHOP: BuildCost = { wood: 15 };

export const BUILD_COSTS = {
  // Walls & gates (2026-10-23): walls 3x their old 1 wood / 1 rock.
  [TileType.Wall]: { wood: 3 },
  [TileType.StoneWall]: { rock: 3 },
  [TileType.Gate]: { wood: 10, rock: 5 },
  [TileType.Road]: { rock: 1 },
  [TileType.CobbleRoad]: { rock: 2 },
  [TileType.KnightPost]: { iron: 10, rock: 5 },
  [TileType.ArcherPost]: { wood: 10 },
  [TileType.MilitiaPost]: { wood: 5, iron: 5 },
  [TileType.Stables]: { wood: 20, rock: 10, iron: 10 },
  [TileType.SiegeWorkshop]: { wood: 30, iron: 15, rock: 15 },
  [TileType.Tower]: { wood: 20, rock: 15 },
  [TileType.Keep]: { wood: 60, rock: 40, iron: 20 },
  [TileType.TownCenter]: { wood: 60, rock: 30, iron: 20 },
  // Houses got costlier with barracks housing (2026-10-29): 10 wood -> 20 wood + 5 rock.
  [TileType.House]: { wood: 20, rock: 5 },
  [TileType.BarnPost]: { wood: 15 },
  // 2x2 pastures (2026-10-30): were free as 1x1s; the four-tile paddock needs fencing. Upgrades stay free.
  [TileType.Pasture]: { wood: 10 },
  [TileType.WoolFarm]: { wood: 10 },
  [TileType.ChurchPost]: { wood: 15 },
  [TileType.WardStone]: { wood: 20, tools: 10 },
  [TileType.BuildersGuild]: { wood: 15 },
  [TileType.HunterHut]: FOOD_HUT,
  [TileType.ForagerHut]: FOOD_HUT,
  [TileType.Market]: SHOP,
  [TileType.GoldShop]: SHOP,
  [TileType.Tavern]: { wood: 20, rock: 10 },
  [TileType.TailorShop]: CRAFT_BUILDING,
  [TileType.Blacksmith]: CRAFT_BUILDING,
  [TileType.LuxuryWorkshop]: CRAFT_BUILDING,
  [TileType.Brewery]: CRAFT_BUILDING,
} satisfies Partial<Record<TileType, BuildCost>>;

// "10 wood + 5 rock" ("Free" for a tile with no entry).
export function buildCostText(tile: TileType): string {
  const cost: BuildCost = (BUILD_COSTS as Partial<Record<TileType, BuildCost>>)[tile] ?? {};
  const parts = Object.entries(cost).map(([key, amount]) => `${amount} ${key}`);
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

// ---- Multi-tile footprints (2026-10-30) ----
// A building listed here covers w x h tiles. Its anchor is the TOP-LEFT tile (the tile the player places /
// clicks with the build tool), which holds the building's own TileType and every per-building record
// (level, HP, workers, clan); the other tiles hold TileType.BuildingPart. A building of such a type
// without its part tiles is a legacy 1x1 (saves from before footprints), which keeps working as before.
// The footprint is derived from the tiles alone (no extra snapshot / save field): see footprintAnchorOf.
export interface Footprint {
  w: number;
  h: number;
}
export const FOOTPRINT_BY_TILE: Partial<Record<TileType, Footprint>> = {
  [TileType.Pasture]: { w: 2, h: 2 },
  [TileType.WoolFarm]: { w: 2, h: 2 },
};
// Largest w / h in FOOTPRINT_BY_TILE (bounds the anchor search).
export const FOOTPRINT_MAX_SIDE = 2;
const ONE_BY_ONE: Footprint = { w: 1, h: 1 };

// The footprint a NEW placement of `tile` takes (1x1 for ordinary buildings).
export function footprintOf(tile: number): Footprint {
  return FOOTPRINT_BY_TILE[tile as TileType] ?? ONE_BY_ONE;
}

// Offsets of the part tiles (every tile of the block but the anchor's).
export function footprintPartOffsets(fp: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) if (dx || dy) out.push([dx, dy]);
  return out;
}

// tileAt returns -1 (or anything but BuildingPart) off the map.
export type TileAt = (x: number, y: number) => number;

// True when every part tile of the fp block anchored at (x, y) is a BuildingPart.
export function hasFootprintParts(tileAt: TileAt, x: number, y: number, fp: Footprint): boolean {
  if (fp.w === 1 && fp.h === 1) return false;
  for (const [dx, dy] of footprintPartOffsets(fp)) if (tileAt(x + dx, y + dy) !== TileType.BuildingPart) return false;
  return true;
}

// The footprint the building at anchor (x, y) actually covers: its type's footprint when its part tiles
// are all there, else 1x1 (a legacy building). `sizeAt` gives the footprint of the type at a tile (for a
// construction site: of the building it will become), or null.
export function placedFootprintAt(tileAt: TileAt, sizeAt: (x: number, y: number) => Footprint | null, x: number, y: number): Footprint {
  const fp = sizeAt(x, y);
  return fp && hasFootprintParts(tileAt, x, y, fp) ? fp : ONE_BY_ONE;
}

// The anchor of the BuildingPart at (x, y): the tile up / left of it whose complete block covers it (a part
// belongs to exactly one block: blocks never overlap and are stamped / cleared whole). null for an orphan.
export function footprintAnchorOf(
  tileAt: TileAt,
  sizeAt: (x: number, y: number) => Footprint | null,
  x: number,
  y: number
): { x: number; y: number } | null {
  for (let dy = 0; dy < FOOTPRINT_MAX_SIDE; dy++) {
    for (let dx = 0; dx < FOOTPRINT_MAX_SIDE; dx++) {
      if (!dx && !dy) continue;
      const ax = x - dx;
      const ay = y - dy;
      if (tileAt(ax, ay) === TileType.BuildingPart) continue;
      const fp = sizeAt(ax, ay);
      if (fp && dx < fp.w && dy < fp.h && hasFootprintParts(tileAt, ax, ay, fp)) return { x: ax, y: ay };
    }
  }
  return null;
}
