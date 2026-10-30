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
