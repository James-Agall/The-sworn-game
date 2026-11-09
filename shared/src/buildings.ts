// Building data shared by the server and the client (QUEUE item 5, stage 1: placement costs).
// BUILD_COSTS is the one definition of what placing a new building (level 1) or ground tile costs: the
// server's placementCost reads it through the named constants in server/src/constants.ts, and the
// client builds its build-tool cost text from it. Upgrade costs (House tiers, Stables / Keep / Tower /
// Town Center levels) are still server-only, in constants.ts.
import { TileType } from "./protocol.js";

export type BuildCost = Partial<Record<"wood" | "rock" | "iron" | "tools" | "wool", number>>;

const CRAFT_BUILDING: BuildCost = { wood: 10, iron: 5 };
const FOOD_HUT: BuildCost = { wood: 15 };
const SHOP: BuildCost = { wood: 15 };

export const BUILD_COSTS = {
  // Walls & gates (2026-10-23): walls 3x their old 1 wood / 1 rock.
  [TileType.Wall]: { wood: 3 },
  [TileType.StoneWall]: { rock: 3 },
  [TileType.Gate]: { wood: 10, rock: 5 },
  // Modular building phase 1 (2026-11-09, shared/src/structures.ts): room pieces.
  [TileType.WoodDoor]: { wood: 5 },
  [TileType.StoneDoor]: { wood: 2, rock: 4 },
  [TileType.WoodWindow]: { wood: 4 },
  [TileType.StoneWindow]: { rock: 4 },
  [TileType.WoodFloor]: { wood: 1 },
  [TileType.StoneFloor]: { rock: 1 },
  [TileType.Bed]: { wood: 6 },
  // Modular building phase 2 (shared/src/rooms.ts): furniture.
  [TileType.Table]: { wood: 4 },
  [TileType.Chair]: { wood: 2 },
  [TileType.Chest]: { wood: 4 },
  [TileType.Shelf]: { wood: 3 },
  [TileType.Hearth]: { rock: 8 },
  [TileType.Lamp]: { wood: 1, iron: 1 },
  [TileType.Rug]: { wool: 4 },
  [TileType.Workbench]: { wood: 6 },
  [TileType.Statue]: { rock: 12 },
  [TileType.WeaponRack]: { wood: 4, iron: 1 },
  // Moats & drawbridges (phase H): a drawbridge goes on a moat tile. Phase I: moat 1 -> 4 wood (it never
  // breaks and mobs never target it, so it must not undercut a 3-wood wall).
  [TileType.Moat]: { wood: 4 },
  [TileType.Drawbridge]: { wood: 25, iron: 10 },
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
  // Pig Pasture and the 2x2 Orchard (2026-11-06): the same fencing as the 2x2 pastures.
  [TileType.PigPasture]: { wood: 10 },
  [TileType.Orchard]: { wood: 10 },
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
  // Progression tree phase 3: the metal chain's stations.
  [TileType.CharcoalBurner]: { wood: 15, rock: 5 },
  [TileType.Bloomery]: { wood: 10, rock: 25 },
  // Phase 4: food.
  [TileType.Mill]: { wood: 20, rock: 10 },
  [TileType.Bakery]: { wood: 10, rock: 15 },
} satisfies Partial<Record<TileType, BuildCost>>;

// A Blacksmith stops crafting tools while the stock holds this many (server constants.ts; client tool text).
export const BLACKSMITH_TOOLS_STOCK_CAP = 30;

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
  // 2026-11-06: Pig Pasture, and Orchards 4x the area (2x2, like the pastures; old saves' orchards stay 1x1, x1).
  [TileType.PigPasture]: { w: 2, h: 2 },
  [TileType.Orchard]: { w: 2, h: 2 },
};

// ---- Pasture animals (2026-11-06): the balance numbers for every pasture, in one place ----
// Per footprint tile per farmhand cycle (FARMHAND_CYCLE_DAYS; a complete 2x2 yields x4, a legacy 1x1 x1). The old
// meat Pasture gave 90 meat + 1 hide a cycle per tile; now every pasture gives more meat than that:
//  - Cow Pasture (TileType.Pasture; old saves' pastures are cows): meat + hide.
//  - Pig Pasture: the most meat, no hide.
//  - Sheep Pasture (TileType.WoolFarm): wool as before (the Tailor's input) + meat.
// ---- Food balance (2026-11-06): every food producer except hunting and foraging ----
// Applied in one place each: FOOD_OUTPUT_MULT to grain per harvest (server constants FARM_YIELD_PER_HARVEST) and to
// every food farmhand batch (orchard fruit, pasture meat / hide / wool: colonists.ts updateFarmhand);
// FOOD_TIME_MULT to the crop grow time (FARM_GROW_TICKS) and to the food farms' farmhand cycle
// (economy.ts effectiveFarmhandCycleTicks). Hemp, hunters, foragers and the hero's own gathering are unchanged.
export const FOOD_OUTPUT_MULT = 0.5;
export const FOOD_TIME_MULT = 2;

// ---- Farm labour (2026-11-06): fields have no workers of their own ----
// Farm Plots (grain) and Hemp Fields are tended by the farmers of a staffed Barn within BARN_FIELD_RADIUS_TILES
// (Chebyshev). A Barn employs BARN_FARMERS_BY_LEVEL[level - 1] farmers and each keeps FIELDS_PER_FARMER fields
// productive, so a Barn with N farmers tends at most N x FIELDS_PER_FARMER fields (the nearest first). A field with
// no such Barn ("No barn in range", or every Barn in range already full) does not grow.
export const BARN_FIELD_RADIUS_TILES = 8;
export const BARN_FARMERS_BY_LEVEL = [2, 3, 4];
export const FIELDS_PER_FARMER = 4;

export interface PastureYield {
  meat: number;
  wool?: number;
  hide?: number;
}
export const PASTURE_YIELDS: Partial<Record<TileType, PastureYield>> = {
  [TileType.Pasture]: { meat: 120, hide: 1 },
  [TileType.PigPasture]: { meat: 160 },
  [TileType.WoolFarm]: { meat: 100, wool: 90 },
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
