// construction.ts: Placement rules and costs, construction sites, upgrades, demolition, building info panel.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { tradingPostInfo } from "./wagons.js";
import {
  TileType, isSolidTile, TICK_RATE, type GameEventCategory, type ServerMessage, type BuildingInfo, TILE_SIZE, Biome,
  isRoadTile, RELATION_TIER_NAMES,
} from "@colony/shared/protocol";
import { footprintOf, footprintPartOffsets } from "@colony/shared/buildings";
import type { ConstructionSiteState, Cost, Player, ResourceKey, TileCoord, TownCenter } from "./types.js";
import {
  ABBEY_GROUNDS_RADIUS, ARCHER_WOOD_COST, BARN_WOOD_COST, BIG_BUILD_TILES, BLACKSMITH_TOOLS_STOCK_CAP,
  BREAKABLE_TILES, BUILDERS_GUILD_WOOD_COST, BUILDER_MAX_PER_SITE, BUILDING_NAMES, BUILD_SECONDS_BIG,
  BUILD_SECONDS_COBBLE_ROAD, BUILD_SECONDS_DEFAULT, BUILD_SECONDS_GATE, BUILD_SECONDS_HOUSE, BUILD_SECONDS_ROAD,
  BUILD_SECONDS_TOWN_CENTER, BUILD_SECONDS_WALL, CATAPULT_RANGE, CAVALRY_CHARGE_MULT, CAVALRY_CHARGE_TILES,
  CHURCH_WOOD_COST, COBBLE_ROAD_ROCK_COST, CRAFT_BUILDING_IRON_COST, CRAFT_BUILDING_TILES, CRAFT_BUILDING_WOOD_COST,
  FOOD_HUT_WOOD_COST, GATE_ROCK_COST, GATE_WOOD_COST, HERO_POPULATION_COST, HOUSE_ROCK_COST, HOUSE_WOOD_COST,
  INDUSTRIAL_TILES, IN_PLACE_UPGRADE_TILES, KEEP_COSTS, KEEP_GARRISON_PER_LEVEL, KEEP_MIN_TOWN_CENTER_LEVEL,
  KEEP_POPULATION_PER_LEVEL, KNIGHT_IRON_COST, KNIGHT_ROCK_COST, MILITIA_IRON_COST, MILITIA_WOOD_COST, NEIGHBOURS_8,
  NO_COLONIST_TILES, PASTURE_WOOD_COST, PLACEABLE_TILES, SHEEP_PASTURE_WOOD_COST, FOOTPRINT_YIELD_PER_TILE, POI_TILES, POPULATION_GATED_TILES, RAM_UNIT_MULT, REACH, ROAD_ROCK_COST,
  SHOP_WOOD_COST, SIEGE_BUILDING_MULT, SIEGE_BUILD_TICKS, SIEGE_POPULATION_COST, SIEGE_WORKSHOP_CAP,
  SIEGE_WORKSHOP_COST, STABLES_COSTS, STONE_WALL_COST, TAVERN_ROCK_COST, TAVERN_WOOD_COST,
  TOWN_CENTER_BASE_POPULATION, TOWN_CENTER_COST, TOWN_CENTER_EXTRA_POPULATION, TOWN_CENTER_LEVEL_BONUS_PER_STEP,
  TOWN_CENTER_LEVEL_POPULATION_BONUS, TOWN_CENTER_MIN_SPACING_TILES, TOWN_CENTER_POI_CLEARANCE_TILES,
  TOWN_CENTER_UPGRADE_COSTS, TRADING_POST_UPGRADE_COSTS, UPGRADE_NAMES, WARD_STONE_TOOLS_COST, WARD_STONE_WOOD_COST, WOOD_WALL_COST, pct,
  RELATION_ALLIED_MIN, RELATION_VASSAL_KEEP,
} from "./constants.js";
import {
  buildingHp, buildingLevel, colonists, constructionSites, farmPlots, gates, minesPlacedOnOre, players, repairPaid,
  repairQueue, respawnQueue, siegeWorkshops, state, towerCooldowns, hearths, mobs,
} from "./state.js";
import {
  anchorOfTile, biomeAt, biomeProductionFactor, getBuildingLevel, inBounds, levelBonus, ownerAt, placedFootprint,
  resourceKey, setOwner, tileIndex, tileOfPixel, tileToPixelCenter,
} from "./tiles.js";
import { findAdjacentWalkable, isWalkableTile } from "./pathfinding.js";
import {
  armyDamageMultiplier, barnForNewFarmPlot, industrialSynergyMultiplier, newFarmPlot, } from "./economy.js";
import {
  anyBuilderAlive, findTownCenterAt, garrisonBlocker, getColonistsAtPost, happinessSpeedMultiplier,
  highestTownCenterLevel, houseCapacity, houseOccupancy, isAbbeyClergy, isHouseTile, isMilitaryTile,
  isSynergyBuilding, placementNeedsNewWorkerSlot, productionSpeedMultiplier, removeColonistForPost, repairCost,
  settlementBlocker, settlementKeyNear, settlementStats, settlementTierCap, siteBuilderCount, spawnColonistForPost,
  spawnExtraGuards, tilesOfType, topUpTownCenterBuilders, townCenterBonus, townCenterMaxHp, unpaidRepairHp,
  updateWardPriestPresence,
} from "./colonists.js";
import {
  garrisonGain, guardStats, healAmountFor, isMilitiaLineKind, militiaCountForLevel, militiaKindForLevel,
  troopsAtPost, unitBuildingSlots,
} from "./units.js";
import {
  gateAt, isTowerTile, resolveTowerPlacement, structureHp, towerCostForLevel, towerInfoLines,
} from "./combat.js";
import { siegeUnitsAt, siegeWorkshopInfo } from "./siege.js";
import { blacksmithForgeInfo, keepHeroInfo } from "./heroes.js";
import { churchSpellShop } from "./spells.js";
import { START_VISION_OFFSETS, broadcastEvent, broadcastTileUpdate, revealAround } from "./net.js";
import { tierOf, tradeInfoFor } from "./diplomacy.js";
import { clanPower, sitePower, vassalInfoFor } from "./vassals.js";
import { captureSite, isInSiteGrounds, nearSiteGrounds, rebuildKeepBlocker, relationOf, siteAtKeep, siteByNum } from "./sites.js";
import { SITE_TEMPLATES } from "./constants.js";
import { clanById, clanIdAt, clanTownCenters, enterClan, isForeignClanTile, resetClan, setTileClan, townCentersOfClan } from "./clans.js";

export function upgradeKnightAt(tx: number, ty: number, level: number) {
  const stats = guardStats("knight", level);
  for (const c of getColonistsAtPost(tx, ty)) {
    if (c.kind !== "knight") continue;
    c.castleLevel = level;
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  spawnExtraGuards(tx, ty, "knight", level);
}

export function upgradeArcherAt(tx: number, ty: number, level: number) {
  for (const c of getColonistsAtPost(tx, ty)) {
    if (c.kind !== "archer") continue;
    c.castleLevel = level;
    const stats = guardStats("archer", level);
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  spawnExtraGuards(tx, ty, "archer", level);
}

// Stables: 1 / 2 / 3 riders per level (plus the house bonus, see syncGuardBonusAt).
export function cavalryCountForLevel(level: number): number {
  return Math.min(Math.max(level, 1), 3);
}

export function resolveStablesPlacement(tx: number, ty: number) {
  if (state.tiles[tileIndex(tx, ty)] === TileType.Stables) {
    const level = getBuildingLevel(tx, ty) + 1;
    buildingLevel.set(resourceKey(tx, ty), level);
    const stats = guardStats("cavalry", level);
    for (const c of getColonistsAtPost(tx, ty)) {
      if (c.kind !== "cavalry") continue;
      c.castleLevel = level;
      c.maxHp = stats.maxHp;
      c.hp = stats.maxHp;
    }
    let have = getColonistsAtPost(tx, ty).filter((c) => c.kind === "cavalry").length;
    for (; have < cavalryCountForLevel(level); have++) spawnColonistForPost(tx, ty, "cavalry", level);
    announceUpgrade(TileType.Stables, level);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.Stables;
  broadcastTileUpdate(tx, ty, TileType.Stables);
  spawnColonistForPost(tx, ty, "cavalry", 1);
}

export function upgradeMilitiaAt(tx: number, ty: number, level: number) {
  const newKind = militiaKindForLevel(level);
  const stats = guardStats(newKind, level);
  for (const c of getColonistsAtPost(tx, ty)) {
    if (!isMilitiaLineKind(c.kind)) continue;
    c.kind = newKind;
    c.castleLevel = level;
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  const targetCount = militiaCountForLevel(level);
  let currentCount = 0;
  for (const c of colonists.values()) {
    if (isMilitiaLineKind(c.kind) && c.postX === tx && c.postY === ty) currentCount++;
  }
  for (let i = currentCount; i < targetCount; i++) {
    spawnColonistForPost(tx, ty, newKind, level);
  }
}

export function announceUpgrade(baseType: TileType, level: number) {
  broadcastEvent("upgrade", `${UPGRADE_NAMES[baseType] ?? "A building"} upgraded to level ${level}`);
}

export function tryLevelUpInPlace(tx: number, ty: number, matchTypes: TileType[]): TileCoord | null {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (!matchTypes.includes(current)) return null;
  const currentLevel = getBuildingLevel(tx, ty);
  if (currentLevel >= 3) return null;
  buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
  announceUpgrade(current, currentLevel + 1);
  return { x: tx, y: ty };
}

export function canAffordHouseUpgrade(current: TileType): boolean {
  if (current === TileType.BigHouse) {
    return (
      state.stock.grain >= 2 && state.stock.meat >= 2 && state.stock.fruit >= 2 && state.stock.clothes >= 3 && state.stock.tools >= 2 && state.stock.luxuryItems >= 1
    );
  }
  return state.stock.grain >= 1 && state.stock.meat >= 1 && state.stock.fruit >= 1 && state.stock.clothes >= 2;
}

// The upgrade goods are charged at placement (placementCost), so a queued upgrade can't overdraw later.
export function resolveHousePlacement(tx: number, ty: number) {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.BigHouse) {
    state.tiles[tileIndex(tx, ty)] = TileType.HouseLevel2;
    broadcastTileUpdate(tx, ty, TileType.HouseLevel2);
    announceUpgrade(TileType.House, 3);
    return;
  }
  if (current === TileType.House) {
    state.tiles[tileIndex(tx, ty)] = TileType.BigHouse;
    broadcastTileUpdate(tx, ty, TileType.BigHouse);
    announceUpgrade(TileType.House, 2);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.House;
  broadcastTileUpdate(tx, ty, TileType.House);
}

export function resolveKnightPlacement(tx: number, ty: number) {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.CastleLevel2) {
    state.tiles[tileIndex(tx, ty)] = TileType.CastleLevel3;
    broadcastTileUpdate(tx, ty, TileType.CastleLevel3);
    upgradeKnightAt(tx, ty, 3);
    announceUpgrade(TileType.KnightPost, 3);
    return;
  }
  if (current === TileType.KnightPost) {
    state.tiles[tileIndex(tx, ty)] = TileType.CastleLevel2;
    broadcastTileUpdate(tx, ty, TileType.CastleLevel2);
    upgradeKnightAt(tx, ty, 2);
    announceUpgrade(TileType.KnightPost, 2);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.KnightPost;
  broadcastTileUpdate(tx, ty, TileType.KnightPost);
  spawnColonistForPost(tx, ty, "knight", 1);
}

export function resolveMilitiaPlacement(tx: number, ty: number) {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.MilitiaCamp2) {
    state.tiles[tileIndex(tx, ty)] = TileType.MilitiaCamp3;
    broadcastTileUpdate(tx, ty, TileType.MilitiaCamp3);
    upgradeMilitiaAt(tx, ty, 3);
    announceUpgrade(TileType.MilitiaPost, 3);
    return;
  }
  if (current === TileType.MilitiaPost) {
    state.tiles[tileIndex(tx, ty)] = TileType.MilitiaCamp2;
    broadcastTileUpdate(tx, ty, TileType.MilitiaCamp2);
    upgradeMilitiaAt(tx, ty, 2);
    announceUpgrade(TileType.MilitiaPost, 2);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.MilitiaPost;
  broadcastTileUpdate(tx, ty, TileType.MilitiaPost);
  spawnColonistForPost(tx, ty, "militia", 1);
  spawnColonistForPost(tx, ty, "militia", 1);
}

export function resolveArcherPlacement(tx: number, ty: number) {
  const here = state.tiles[tileIndex(tx, ty)] as TileType;
  if (here === TileType.ArcherPost) {
    const newLevel = getBuildingLevel(tx, ty) + 1;
    buildingLevel.set(resourceKey(tx, ty), newLevel);
    upgradeArcherAt(tx, ty, newLevel);
    announceUpgrade(here, newLevel);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.ArcherPost;
  broadcastTileUpdate(tx, ty, TileType.ArcherPost);
  spawnColonistForPost(tx, ty, "archer", 1);
}

export function resolveMinePlacement(
  tx: number,
  ty: number,
  mineType: TileType,
  oreType: TileType,
  minerKind: "ironMiner" | "rockMiner"
) {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (current === mineType) {
    const currentLevel = getBuildingLevel(tx, ty);
    buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
    announceUpgrade(mineType, currentLevel + 1);
    spawnColonistForPost(tx, ty, minerKind);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = mineType;
  broadcastTileUpdate(tx, ty, mineType);
  if (current === oreType) minesPlacedOnOre.add(resourceKey(tx, ty));
  spawnColonistForPost(tx, ty, minerKind);
}

export function resolveLumberjackPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.LumberjackPost]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.LumberjackPost;
  broadcastTileUpdate(tx, ty, TileType.LumberjackPost);
  spawnColonistForPost(tx, ty, "lumberjack");
}

export function resolveBarnPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.BarnPost]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.BarnPost;
  broadcastTileUpdate(tx, ty, TileType.BarnPost);
  spawnColonistForPost(tx, ty, "farmer");
}

export function resolveChurchPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.ChurchPost]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.ChurchPost;
  broadcastTileUpdate(tx, ty, TileType.ChurchPost);
  spawnColonistForPost(tx, ty, "bishop");
}

export function resolvePasturePlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Pasture]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.Pasture;
  broadcastTileUpdate(tx, ty, TileType.Pasture);
  spawnColonistForPost(tx, ty, "farmhand");
}

export function resolveOrchardPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Orchard]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.Orchard;
  broadcastTileUpdate(tx, ty, TileType.Orchard);
  spawnColonistForPost(tx, ty, "farmhand");
}

export function resolveWoolFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.WoolFarm]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.WoolFarm;
  broadcastTileUpdate(tx, ty, TileType.WoolFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

export function resolveCottonFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.CottonFarm]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.CottonFarm;
  broadcastTileUpdate(tx, ty, TileType.CottonFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

export function resolveTailorShopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.TailorShop]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.TailorShop;
  broadcastTileUpdate(tx, ty, TileType.TailorShop);
  spawnColonistForPost(tx, ty, "artisan");
}

export function resolveBlacksmithPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Blacksmith]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.Blacksmith;
  broadcastTileUpdate(tx, ty, TileType.Blacksmith);
  spawnColonistForPost(tx, ty, "artisan");
}

export function resolveLuxuryWorkshopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.LuxuryWorkshop]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.LuxuryWorkshop;
  broadcastTileUpdate(tx, ty, TileType.LuxuryWorkshop);
  spawnColonistForPost(tx, ty, "artisan");
}

export function resolveBreweryPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Brewery]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.Brewery;
  broadcastTileUpdate(tx, ty, TileType.Brewery);
  spawnColonistForPost(tx, ty, "artisan");
}

export function resolveTavernPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Tavern]);
  if (upgraded) return;
  state.tiles[tileIndex(tx, ty)] = TileType.Tavern;
  broadcastTileUpdate(tx, ty, TileType.Tavern);
  spawnColonistForPost(tx, ty, "artisan");
}

// Hunter's Hut / Forager's Hut: like a mine, every level adds one more worker (so each placement,
// upgrades included, needs a free population slot).
// The Builders' Guild works the same way (one builder per level).
export function resolveFoodHutPlacement(tx: number, ty: number, hutType: TileType, kind: "hunter" | "forager" | "builder") {
  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  if (current === hutType) {
    const currentLevel = getBuildingLevel(tx, ty);
    buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
    announceUpgrade(hutType, currentLevel + 1);
    spawnColonistForPost(tx, ty, kind);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = hutType;
  broadcastTileUpdate(tx, ty, hutType);
  spawnColonistForPost(tx, ty, kind);
}

// A new Town Center (instant when none stands or no builder is alive; see handleSetTileInner), or a
// level-up of an existing one: the level raises its max HP (and heals by the difference).
export function resolveTownCenterPlacement(tx: number, ty: number) {
  const existing = findTownCenterAt(tx, ty);
  if (existing) {
    if (existing.level >= 3) return;
    const oldMax = townCenterMaxHp(existing.level);
    existing.level++;
    existing.hp = Math.min(townCenterMaxHp(existing.level), existing.hp + townCenterMaxHp(existing.level) - oldMax);
    announceUpgrade(TileType.TownCenter, existing.level);
    topUpTownCenterBuilders(existing);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.TownCenter;
  const tc: TownCenter = { x: tx, y: ty, level: 1, hp: townCenterMaxHp(1), ...(clanIdAt(tx, ty) ? { clan: clanIdAt(tx, ty) } : {}) };
  // Forts phase B: a Town Center on a razed fort's keep tile captures the fort (its outpost).
  const fort = siteAtKeep(tx, ty);
  if (fort && fort.cleared && !fort.captured) tc.name = captureSite(fort, clanIdAt(tx, ty));
  state.townCenters.push(tc);
  broadcastTileUpdate(tx, ty, TileType.TownCenter);
  revealAround(tx, ty, START_VISION_OFFSETS);
  topUpTownCenterBuilders(tc);
  broadcastEvent("build", tc.name ? `${tc.name} stands: the fort is yours` : "A new Town Center stands");
}

// Mob damage brought it down: it is removed for good (a new one can be placed).
export function destroyTownCenter(tc: TownCenter) {
  state.townCenters = state.townCenters.filter((t) => t !== tc);
  const key = resourceKey(tc.x, tc.y);
  constructionSites.delete(key);
  state.tiles[tileIndex(tc.x, tc.y)] = TileType.Empty;
  broadcastTileUpdate(tc.x, tc.y, TileType.Empty);
  broadcastEvent(
    "death",
    townCentersOfClan(tc.clan).length > 0 ? "A Town Center has been destroyed" : "The last Town Center has been destroyed — build a new one"
  );
}

// True when placing `tile` on the existing `current` building upgrades it in place.
export function isInPlaceUpgrade(tile: TileType, current: TileType, tx: number, ty: number): boolean {
  if (tile === TileType.House) {
    return (current === TileType.House || current === TileType.BigHouse) && canAffordHouseUpgrade(current);
  }
  if (tile === TileType.KnightPost) return current === TileType.KnightPost || current === TileType.CastleLevel2;
  if (tile === TileType.MilitiaPost) return current === TileType.MilitiaPost || current === TileType.MilitiaCamp2;
  if (tile === TileType.ArcherPost || tile === TileType.Stables) {
    return current === tile && getBuildingLevel(tx, ty) < 3;
  }
  if (tile === TileType.TownCenter) return current === TileType.TownCenter && (findTownCenterAt(tx, ty)?.level ?? 3) < 3;
  return tile === current && IN_PLACE_UPGRADE_TILES.includes(tile) && getBuildingLevel(tx, ty) < 3;
}

// Extra guards from living next to houses: +1 per adjacent house, diagonals included (at most 7,
// since placement always keeps one orthogonal tile free for the units to spawn onto).
export function adjacentHouseCount(tx: number, ty: number): number {
  let n = 0;
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (inBounds(nx, ny) && isHouseTile(state.tiles[tileIndex(nx, ny)] as TileType)) n++;
  }
  return n;
}

// Top up one unit building to its own troop capacity (tier headcount + house bonus, unitBuildingSlots).
// Never removes units.
export function syncGuardBonusAt(tx: number, ty: number) {
  const slots = unitBuildingSlots(tx, ty);
  if (!slots) return;
  let have = troopsAtPost(tx, ty, slots.kind);
  for (const q of respawnQueue) if (q.tx === tx && q.ty === ty) have++;
  for (let i = have; i < slots.cap; i++) spawnColonistForPost(tx, ty, slots.kind, slots.level);
}

export function syncGuardBonusesAround(tx: number, ty: number) {
  syncGuardBonusAt(tx, ty);
  for (const [dx, dy] of NEIGHBOURS_8) {
    if (inBounds(tx + dx, ty + dy)) syncGuardBonusAt(tx + dx, ty + dy);
  }
}

export function walkableNeighbourCount(tx: number, ty: number, ignoreX: number, ignoreY: number): number {
  let n = 0;
  for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
    if (nx === ignoreX && ny === ignoreY) continue;
    if (isWalkableTile(nx, ny)) n++;
  }
  return n;
}

// A unit building must keep at least one open neighbouring tile for its units to spawn onto.
// Refuse any solid placement that would seal one in (or a unit building with no open side).
export function sealsInSpawner(tx: number, ty: number, tile: TileType): boolean {
  if (!isSolidTile(tile)) return false;
  if (isMilitaryTile(tile) && walkableNeighbourCount(tx, ty, -1, -1) === 0) return true;
  for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
    if (!inBounds(nx, ny) || !isMilitaryTile(state.tiles[tileIndex(nx, ny)] as TileType)) continue;
    if (walkableNeighbourCount(nx, ny, tx, ty) === 0) return true;
  }
  return false;
}

export function handleSetTile(player: Player, tx: number, ty: number, tile: TileType, skipReach = false) {
  if (player.dead) return;
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;
  if (tile !== TileType.Empty && !isSolidTile(state.tiles[tileIndex(tx, ty)] as TileType) && sealsInSpawner(tx, ty, tile)) return;
  handleSetTileInner(player, tx, ty, tile, skipReach);
  syncGuardBonusesAround(tx, ty);
}

export function placementCost(tile: TileType, current: TileType, tx: number, ty: number): Cost {
  switch (tile) {
    case TileType.Wall:
      return { wood: WOOD_WALL_COST };
    case TileType.StoneWall:
      return { rock: STONE_WALL_COST };
    case TileType.Gate:
      return { wood: GATE_WOOD_COST, rock: GATE_ROCK_COST };
    case TileType.Road:
      return { rock: ROAD_ROCK_COST };
    case TileType.CobbleRoad:
      return { rock: COBBLE_ROAD_ROCK_COST };
    case TileType.ArcherPost:
      return { wood: ARCHER_WOOD_COST };
    case TileType.Tower:
      return towerCostForLevel(levelAfterPlacement(tile, current, tx, ty));
    case TileType.KnightPost:
      return { iron: KNIGHT_IRON_COST, rock: KNIGHT_ROCK_COST };
    case TileType.Stables:
      return STABLES_COSTS[Math.min(Math.max(levelAfterPlacement(tile, current, tx, ty), 1), 3) - 1];
    case TileType.SiegeWorkshop:
      return SIEGE_WORKSHOP_COST;
    case TileType.House:
      if (current === TileType.BigHouse) {
        return { wood: 30, rock: 15, grain: 2, meat: 2, fruit: 2, clothes: 3, tools: 2, luxuryItems: 1 };
      }
      if (current === TileType.House) return { wood: HOUSE_WOOD_COST, rock: 10, grain: 1, meat: 1, fruit: 1, clothes: 2 };
      return { wood: HOUSE_WOOD_COST, rock: HOUSE_ROCK_COST };
    case TileType.BarnPost:
      return { wood: BARN_WOOD_COST };
    // 2x2 pastures: the new paddock pays its fencing; levelling one up (or a legacy 1x1) stays free.
    case TileType.Pasture:
      return current === tile ? {} : { wood: PASTURE_WOOD_COST };
    case TileType.WoolFarm:
      return current === tile ? {} : { wood: SHEEP_PASTURE_WOOD_COST };
    case TileType.ChurchPost:
      return { wood: CHURCH_WOOD_COST };
    case TileType.WardStone:
      return { wood: WARD_STONE_WOOD_COST, tools: WARD_STONE_TOOLS_COST };
    case TileType.Market:
      return { wood: SHOP_WOOD_COST };
    // Forts phase E: levelling a Trading Post up costs TRADING_POST_UPGRADE_COSTS.
    case TileType.GoldShop:
      return current === tile ? TRADING_POST_UPGRADE_COSTS[Math.min(getBuildingLevel(tx, ty), 2) - 1] : { wood: SHOP_WOOD_COST };
    case TileType.Tavern:
      return { wood: TAVERN_WOOD_COST, rock: TAVERN_ROCK_COST };
    case TileType.MilitiaPost:
      return { wood: MILITIA_WOOD_COST, iron: MILITIA_IRON_COST };
    case TileType.HunterHut:
    case TileType.ForagerHut:
      return { wood: FOOD_HUT_WOOD_COST };
    case TileType.BuildersGuild:
      return { wood: BUILDERS_GUILD_WOOD_COST };
    case TileType.Keep:
      return KEEP_COSTS[Math.min(Math.max(levelAfterPlacement(tile, current, tx, ty), 1), 3) - 1];
    case TileType.TownCenter: {
      const tc = current === TileType.TownCenter ? findTownCenterAt(tx, ty) : undefined;
      return tc ? TOWN_CENTER_UPGRADE_COSTS[Math.min(tc.level, 2) - 1] : TOWN_CENTER_COST;
    }
  }
  if (CRAFT_BUILDING_TILES.includes(tile)) return { wood: CRAFT_BUILDING_WOOD_COST, iron: CRAFT_BUILDING_IRON_COST };
  return {};
}

export function canAfford(cost: Cost): boolean {
  return Object.entries(cost).every(([key, amount]) => state.stock[key as ResourceKey] >= (amount ?? 0));
}

export function spend(cost: Cost) {
  for (const [key, amount] of Object.entries(cost)) state.stock[key as ResourceKey] -= amount ?? 0;
}

export function formatCost(cost: Cost): string {
  const parts = Object.entries(cost).map(([key, amount]) => `${amount} ${key === "luxuryItems" ? "luxury items" : key === "cotton" ? "hemp" : key}`);
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

// A new Town Center keeps its distance from every other one (built or under construction), from the
// Abbey and from ruins / encampments.
// True when (tx, ty) is closer than TOWN_CENTER_MIN_SPACING_TILES to a Town Center or a queued one.
export function townCenterTooClose(tx: number, ty: number): boolean {
  for (const tc of state.townCenters) {
    if (Math.hypot(tc.x - tx, tc.y - ty) < TOWN_CENTER_MIN_SPACING_TILES) return true;
  }
  for (const site of constructionSites.values()) {
    if (site.target === TileType.TownCenter && Math.hypot(site.tx - tx, site.ty - ty) < TOWN_CENTER_MIN_SPACING_TILES) return true;
  }
  return false;
}

export function townCenterSpotOk(tx: number, ty: number): boolean {
  if (townCenterTooClose(tx, ty)) return false;
  if (state.abbeyCenter && Math.hypot(state.abbeyCenter.x - tx, state.abbeyCenter.y - ty) < ABBEY_GROUNDS_RADIUS + TOWN_CENTER_POI_CLEARANCE_TILES) return false;
  // Forts phase B: not next to a fort's reserved grounds either.
  if (nearSiteGrounds(tx, ty, TOWN_CENTER_POI_CLEARANCE_TILES)) return false;
  const r = TOWN_CENTER_POI_CLEARANCE_TILES;
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (inBounds(x, y) && POI_TILES.has(state.tiles[tileIndex(x, y)] as TileType)) return false;
    }
  }
  return findAdjacentWalkable(tx, ty) !== null;
}

// The level a building will have once `tile` placed on `current` resolves (1 for a new building).
export function levelAfterPlacement(tile: TileType, current: TileType, tx: number, ty: number): number {
  if (current === TileType.Empty || !isInPlaceUpgrade(tile, current, tx, ty)) return 1;
  return currentBuildingLevel(tx, ty, current) + 1;
}

export function currentBuildingLevel(tx: number, ty: number, t: TileType): number {
  if (t === TileType.BigHouse || t === TileType.CastleLevel2 || t === TileType.MilitiaCamp2) return 2;
  if (t === TileType.HouseLevel2 || t === TileType.CastleLevel3 || t === TileType.MilitiaCamp3) return 3;
  if (t === TileType.House || t === TileType.KnightPost || t === TileType.MilitiaPost) return 1;
  if (t === TileType.TownCenter) return findTownCenterAt(tx, ty)?.level ?? 1;
  return getBuildingLevel(tx, ty);
}

export function buildTicksFor(tile: TileType, level: number): number {
  const base =
    tile === TileType.Road
      ? BUILD_SECONDS_ROAD
      : tile === TileType.CobbleRoad
        ? BUILD_SECONDS_COBBLE_ROAD
        : tile === TileType.Wall || tile === TileType.StoneWall
      ? BUILD_SECONDS_WALL
      : tile === TileType.Gate
      ? BUILD_SECONDS_GATE
      : tile === TileType.House
        ? BUILD_SECONDS_HOUSE
        : tile === TileType.TownCenter
          ? BUILD_SECONDS_TOWN_CENTER
          : BIG_BUILD_TILES.has(tile)
            ? BUILD_SECONDS_BIG
            : BUILD_SECONDS_DEFAULT;
  return Math.round(base * TICK_RATE * Math.max(1, level));
}

export function startConstruction(tx: number, ty: number, tile: TileType, current: TileType, upgrade: boolean) {
  const site: ConstructionSiteState = {
    tx,
    ty,
    target: tile,
    prevTile: current,
    upgrade,
    progress: 0,
    totalTicks: buildTicksFor(tile, levelAfterPlacement(tile, current, tx, ty)),
  };
  constructionSites.set(resourceKey(tx, ty), site);
  if (!upgrade) {
    state.tiles[tileIndex(tx, ty)] = TileType.ConstructionSite;
    broadcastTileUpdate(tx, ty, TileType.ConstructionSite);
  }
}

export function completeConstruction(key: string, site: ConstructionSiteState) {
  constructionSites.delete(key);
  const index = tileIndex(site.tx, site.ty);
  if (site.upgrade) {
    // The building changed under a queued upgrade (destroyed or replaced): nothing left to upgrade.
    if (state.tiles[index] !== site.prevTile) return;
  } else {
    if (state.tiles[index] !== TileType.ConstructionSite) return;
    state.tiles[index] = site.prevTile;
  }
  resolvePlacement(site.tx, site.ty, site.target, site.prevTile);
  syncGuardBonusesAround(site.tx, site.ty);
}

// Once per tick, after the builders have worked.
export function updateConstructionSites() {
  for (const [key, site] of Array.from(constructionSites)) {
    const index = tileIndex(site.tx, site.ty);
    // Cleared some other way (e.g. a test rewriting the tile): drop the record.
    if (!site.upgrade && state.tiles[index] !== TileType.ConstructionSite) {
      constructionSites.delete(key);
      continue;
    }
    if (site.progress >= site.totalTicks) {
      // Clans: the finished building resolves in its own clan (costs, toasts, new workers).
      enterClan(clanIdAt(site.tx, site.ty));
      completeConstruction(key, site);
      resetClan();
    }
  }
}

// Flattened [tile index, target, progress 0-1000, upgrade 0/1, builders working] per site.
export function constructionSitesForSnapshot(): number[] {
  const out: number[] = [];
  for (const [key, site] of constructionSites) {
    out.push(
      tileIndex(site.tx, site.ty),
      site.target,
      Math.min(1000, Math.floor((site.progress / site.totalTicks) * 1000)),
      site.upgrade ? 1 : 0,
      siteBuilderCount(key, true)
    );
  }
  return out;
}

// Flattened [tile index, level] for every building above level 1 (Town Centers included).
export function buildingLevelsForSnapshot(): number[] {
  const out: number[] = [];
  for (const [key, level] of buildingLevel) {
    if (level <= 1) continue;
    const [tx, ty] = key.split(",").map(Number);
    out.push(tileIndex(tx, ty), level);
  }
  for (const tc of state.townCenters) if (tc.level > 1) out.push(tileIndex(tc.x, tc.y), tc.level);
  return out;
}

export function sendEvent(player: Player, category: GameEventCategory, text: string) {
  if (player.socket.readyState === player.socket.OPEN) {
    player.socket.send(JSON.stringify({ type: "event", category, text } satisfies ServerMessage));
  }
}

// Removes the building (or site, road, forage) at a tile: its posted workers, level, farm plot, site,
// HP records; mines revert to the ore under them. Player demolish and mob
// destruction (damageBuilding) both end here.
export function demolishTile(tx: number, ty: number, current: TileType) {
  // A multi-tile building (or its construction site) takes its whole block with it.
  clearFootprintParts(tx, ty);
  const siteKey = resourceKey(tx, ty);
  buildingHp.delete(siteKey);
  repairPaid.delete(siteKey);
  // A queued construction or upgrade here is dropped with the tile (no refund).
  const site = constructionSites.get(siteKey);
  constructionSites.delete(siteKey);
  if (current === TileType.ConstructionSite) {
    // Ore / rock under an unfinished mine comes back.
    const revert = site && !site.upgrade ? site.prevTile : TileType.Empty;
    state.tiles[tileIndex(tx, ty)] = revert;
    broadcastTileUpdate(tx, ty, revert);
    return;
  }
  // A Ward Stone has no colonist of its own; the Ward Priest merely targets it, and retargets.
  if (!NO_COLONIST_TILES.includes(current) && current !== TileType.WardStone) {
    removeColonistForPost(tx, ty);
  }
  buildingLevel.delete(resourceKey(tx, ty));
  if (current === TileType.Gate) gates.delete(tileIndex(tx, ty));
  if (current === TileType.SiegeWorkshop) siegeWorkshops.delete(resourceKey(tx, ty));
  if (current === TileType.FarmPlot) {
    farmPlots.delete(resourceKey(tx, ty));
  }
  if (current === TileType.IronMinePost) {
    const key = resourceKey(tx, ty);
    const revert = minesPlacedOnOre.has(key) ? TileType.IronOre : TileType.Empty;
    minesPlacedOnOre.delete(key);
    state.tiles[tileIndex(tx, ty)] = revert;
    broadcastTileUpdate(tx, ty, revert);
    return;
  }
  if (current === TileType.RockMinePost) {
    const key = resourceKey(tx, ty);
    const revert = minesPlacedOnOre.has(key) ? TileType.Rock : TileType.Empty;
    minesPlacedOnOre.delete(key);
    state.tiles[tileIndex(tx, ty)] = revert;
    broadcastTileUpdate(tx, ty, revert);
    return;
  }
  if (isTowerTile(current)) towerCooldowns.delete(resourceKey(tx, ty));
  state.tiles[tileIndex(tx, ty)] = TileType.Empty;
  broadcastTileUpdate(tx, ty, TileType.Empty);
}

// ---- Multi-tile footprints (FOOTPRINT_BY_TILE): the anchor is the placed (top-left) tile ----
// Clears the part tiles of the complete block anchored at (tx, ty) (none for a 1x1 / legacy building).
export function clearFootprintParts(tx: number, ty: number) {
  const fp = placedFootprint(tx, ty);
  if (fp.w === 1 && fp.h === 1) return;
  for (const [dx, dy] of footprintPartOffsets(fp)) {
    state.tiles[tileIndex(tx + dx, ty + dy)] = TileType.Empty;
    broadcastTileUpdate(tx + dx, ty + dy, TileType.Empty);
  }
}

// Why a new `tile` can't take its footprint's part tiles with its anchor at (tx, ty) ("" = it can): each must
// be on the map, Empty, not an NPC fort's, not under construction, and nobody may stand on it.
export function footprintBlocker(tile: TileType, tx: number, ty: number): string {
  const fp = footprintOf(tile);
  for (const [dx, dy] of footprintPartOffsets(fp)) {
    const x = tx + dx;
    const y = ty + dy;
    const bad =
      !inBounds(x, y) || state.tiles[tileIndex(x, y)] !== TileType.Empty || ownerAt(tileIndex(x, y)) !== 0 ||
      constructionSites.has(resourceKey(x, y)) || someoneStandsOn(x, y);
    if (bad) return `${BUILDING_NAMES[tile] ?? "This building"} needs a clear ${fp.w}x${fp.h} block (the tile you place on is its top-left corner)`;
  }
  return "";
}

function someoneStandsOn(x: number, y: number): boolean {
  for (const other of players.values()) {
    const t = tileOfPixel(other.x, other.y);
    if (t.x === x && t.y === y) return true;
  }
  for (const c of colonists.values()) {
    const t = tileOfPixel(c.x, c.y);
    if (t.x === x && t.y === y) return true;
  }
  return false;
}

// Stamps the part tiles of a new `tile` anchored at (tx, ty) (checked free by footprintBlocker) for clanId.
export function stampFootprintParts(tile: TileType, tx: number, ty: number, clanId: number) {
  for (const [dx, dy] of footprintPartOffsets(footprintOf(tile))) {
    const i = tileIndex(tx + dx, ty + dy);
    buildingHp.delete(resourceKey(tx + dx, ty + dy));
    state.tiles[i] = TileType.BuildingPart;
    setTileClan(i, clanId);
    broadcastTileUpdate(tx + dx, ty + dy, TileType.BuildingPart);
  }
}

// Produce multiplier of the farm anchored at (tx, ty): its footprint's tile count (1 for a legacy 1x1).
export function footprintYieldMult(tx: number, ty: number): number {
  const fp = placedFootprint(tx, ty);
  return fp.w * fp.h * FOOTPRINT_YIELD_PER_TILE;
}

// "" when a new Keep may go up near (tx, ty): its settlement's Town Center is at level 2+ and has no
// Keep (built or queued) yet; else why not.
export function keepPlacementBlocker(tx: number, ty: number): string {
  const key = settlementKeyNear(tx, ty);
  const tc = state.townCenters.find((t) => resourceKey(t.x, t.y) === key);
  if (!tc || tc.level < KEEP_MIN_TOWN_CENTER_LEVEL) return `Keep needs a Town Center at level ${KEEP_MIN_TOWN_CENTER_LEVEL}`;
  const has = (x: number, y: number) => settlementKeyNear(x, y) === key;
  for (const k of tilesOfType(TileType.Keep)) if (clanIdAt(k.x, k.y) === state.clan.id && has(k.x, k.y)) return "This settlement already has a Keep";
  for (const site of constructionSites.values()) {
    if (site.target === TileType.Keep && !site.upgrade && has(site.tx, site.ty)) return "This settlement already has a Keep";
  }
  return "";
}

export function handleSetTileInner(player: Player, tx: number, ty: number, tile: TileType, skipReach = false) {
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;

  const tileCenter = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(player.x - tileCenter.x, player.y - tileCenter.y);
  if (!skipReach && dist > REACH) return;
  // Multi-tile buildings: a part tile stands for its anchor (demolish / upgrade / build-over all act there).
  if (state.tiles[tileIndex(tx, ty)] === TileType.BuildingPart) {
    const anchor = anchorOfTile(tx, ty);
    if (anchor.x === tx && anchor.y === ty) {
      // An orphan part (its anchor is gone some other way): demolishing clears it.
      if (tile === TileType.Empty && ownerAt(tileIndex(tx, ty)) === 0 && !isForeignClanTile(tx, ty, player.clan)) {
        state.tiles[tileIndex(tx, ty)] = TileType.Empty;
        broadcastTileUpdate(tx, ty, TileType.Empty);
      }
      return;
    }
    tx = anchor.x;
    ty = anchor.y;
  }

  const current = state.tiles[tileIndex(tx, ty)] as TileType;
  const siteKey = resourceKey(tx, ty);
  // Forts phase A: an NPC site's tile can be neither demolished nor built on / upgraded.
  if (ownerAt(tileIndex(tx, ty)) !== 0) {
    sendEvent(player, "build", "That belongs to an enemy fort");
    return;
  }
  // Forts phase B: nothing is built inside a fort's reserved grounds (template rectangle + apron).
  if (tile !== TileType.Empty && isInSiteGrounds(tx, ty)) {
    sendEvent(player, "build", "Too close to an enemy fort");
    return;
  }
  // Clans: another clan's buildings are theirs alone.
  if (isForeignClanTile(tx, ty, player.clan)) {
    sendEvent(player, "build", `That belongs to ${clanById(clanIdAt(tx, ty)).name}`);
    return;
  }

  if (tile === TileType.Empty) {
    if (!BREAKABLE_TILES.includes(current)) return;
    demolishTile(tx, ty, current);
    return;
  }

  // One construction (or upgrade) per tile at a time.
  if (constructionSites.has(siteKey)) return;

  const upgradeInPlace = isInPlaceUpgrade(tile, current, tx, ty);

  if (upgradeInPlace) {
    // Placing on top of an existing building upgrades it; nothing else to validate here.
  } else if (tile === TileType.IronMinePost) {
    if (current !== TileType.IronOre) return;
  } else if (tile === TileType.RockMinePost) {
    if (current !== TileType.Rock) return;
  } else if (tile === TileType.FarmPlot) {
    if (current !== TileType.Empty) return;
    if (barnForNewFarmPlot(tx, ty) === null) return;
  } else if (tile === TileType.ArcherPost) {
    if (current !== TileType.Empty) return;
  } else if (tile === TileType.WardStone) {
    if (current !== TileType.Empty) return;
    // Clans: one Ward Priest per world, clan 0's (see ROADMAP "Clans — landed").
    if (player.clan !== 0) {
      sendEvent(player, "build", "Only the colony (the first clan) can raise Ward Stones");
      return;
    }
    if (tilesOfType(TileType.ChurchPost).length === 0) return;
  } else if (tile === TileType.TownCenter) {
    if (current !== TileType.Empty) return;
    if (townCenterTooClose(tx, ty)) {
      sendEvent(player, "build", `A new Town Center must stand at least ${TOWN_CENTER_MIN_SPACING_TILES} tiles from another`);
      return;
    }
    if (!townCenterSpotOk(tx, ty)) return;
  } else if (tile === TileType.Keep) {
    if (current !== TileType.Empty) return;
    const keepBlock = keepPlacementBlocker(tx, ty);
    if (keepBlock) {
      sendEvent(player, "build", keepBlock);
      return;
    }
  } else {
    if (current !== TileType.Empty) return;
  }

  const cost = placementCost(tile, current, tx, ty);
  if (!canAfford(cost)) return;
  if (POPULATION_GATED_TILES.includes(tile) && placementNeedsNewWorkerSlot(tile, tx, ty)) {
    const full = settlementBlocker(tx, ty);
    if (full) {
      sendEvent(player, "build", full);
      return;
    }
  }
  const garrison = garrisonGain(tile, current, tx, ty);
  if (garrison > 0) {
    const full = garrisonBlocker(tx, ty, garrison);
    if (full) {
      sendEvent(player, "build", full);
      return;
    }
  }
  // Multi-tile buildings (a new one, not a level-up): every part tile must be free.
  const multiTile = !upgradeInPlace && footprintPartOffsets(footprintOf(tile)).length > 0;
  if (multiTile) {
    const blocked = footprintBlocker(tile, tx, ty);
    if (blocked) {
      sendEvent(player, "build", blocked);
      return;
    }
  }

  if (tile !== TileType.FarmPlot && !upgradeInPlace) {
    for (const other of players.values()) {
      const otherTile = tileOfPixel(other.x, other.y);
      if (otherTile.x === tx && otherTile.y === ty) return;
    }
    for (const c of colonists.values()) {
      const ct = tileOfPixel(c.x, c.y);
      if (ct.x === tx && ct.y === ty) return;
    }
  }

  // A Town Center goes up at once when none stands or no builder is left, so a colony that lost both
  // can always start over.
  const instant =
    state.instantBuild ||
    tile === TileType.FarmPlot ||
    (tile === TileType.TownCenter && (clanTownCenters().length === 0 || !anyBuilderAlive()));
  if (!instant && !anyBuilderAlive()) {
    sendEvent(player, "build", "No builders available");
    return;
  }

  spend(cost);
  // A new building (e.g. a house over a cleared, damaged tile) starts at full HP.
  if (!upgradeInPlace) {
    buildingHp.delete(siteKey);
    repairPaid.delete(siteKey);
    // Clans: the new building is the placing player's clan's.
    setTileClan(tileIndex(tx, ty), player.clan);
  }
  if (multiTile) stampFootprintParts(tile, tx, ty, player.clan);
  if (instant) {
    resolvePlacement(tx, ty, tile, current);
  } else {
    startConstruction(tx, ty, tile, current, upgradeInPlace);
  }
}

// Turns an accepted placement into the building (instantly, or when its construction completes).
// `current` is what the tile held when the placement was accepted.
export function resolvePlacement(tx: number, ty: number, tile: TileType, current: TileType) {
  if (tile === TileType.House) {
    resolveHousePlacement(tx, ty);
    return;
  }
  if (tile === TileType.KnightPost) {
    resolveKnightPlacement(tx, ty);
    return;
  }
  if (tile === TileType.MilitiaPost) {
    resolveMilitiaPlacement(tx, ty);
    return;
  }
  if (tile === TileType.ArcherPost) {
    resolveArcherPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Stables) {
    resolveStablesPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Tower) {
    resolveTowerPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Keep) {
    if (current === TileType.Keep) {
      tryLevelUpInPlace(tx, ty, [TileType.Keep]);
      return;
    }
    state.tiles[tileIndex(tx, ty)] = TileType.Keep;
    broadcastTileUpdate(tx, ty, TileType.Keep);
    return;
  }
  if (tile === TileType.IronMinePost) {
    resolveMinePlacement(tx, ty, TileType.IronMinePost, TileType.IronOre, "ironMiner");
    return;
  }
  if (tile === TileType.RockMinePost) {
    resolveMinePlacement(tx, ty, TileType.RockMinePost, TileType.Rock, "rockMiner");
    return;
  }
  if (tile === TileType.FarmPlot) {
    // Checked by handleSetTileInner just before (Farm Plots are placed instantly).
    const barn = barnForNewFarmPlot(tx, ty);
    if (!barn) return;
    state.tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    farmPlots.set(resourceKey(tx, ty), newFarmPlot(barn.x, barn.y));
    return;
  }
  if (tile === TileType.BarnPost) {
    resolveBarnPlacement(tx, ty);
    return;
  }
  if (tile === TileType.LumberjackPost) {
    resolveLumberjackPlacement(tx, ty);
    return;
  }
  if (tile === TileType.ChurchPost) {
    resolveChurchPlacement(tx, ty);
    return;
  }
  if (tile === TileType.WardStone) {
    state.tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    if (state.wardPriestId === null && state.wardPriestRespawnTicks < 0) updateWardPriestPresence();
    return;
  }
  if (tile === TileType.Pasture) {
    resolvePasturePlacement(tx, ty);
    return;
  }
  if (tile === TileType.Orchard) {
    resolveOrchardPlacement(tx, ty);
    return;
  }
  if (tile === TileType.WoolFarm) {
    resolveWoolFarmPlacement(tx, ty);
    return;
  }
  if (tile === TileType.CottonFarm) {
    resolveCottonFarmPlacement(tx, ty);
    return;
  }
  if (tile === TileType.TailorShop) {
    resolveTailorShopPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Blacksmith) {
    resolveBlacksmithPlacement(tx, ty);
    return;
  }
  if (tile === TileType.LuxuryWorkshop) {
    resolveLuxuryWorkshopPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Brewery) {
    resolveBreweryPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Tavern) {
    resolveTavernPlacement(tx, ty);
    return;
  }
  if (tile === TileType.HunterHut) {
    resolveFoodHutPlacement(tx, ty, TileType.HunterHut, "hunter");
    return;
  }
  if (tile === TileType.ForagerHut) {
    resolveFoodHutPlacement(tx, ty, TileType.ForagerHut, "forager");
    return;
  }
  if (tile === TileType.BuildersGuild) {
    resolveFoodHutPlacement(tx, ty, TileType.BuildersGuild, "builder");
    return;
  }
  if (tile === TileType.TownCenter) {
    resolveTownCenterPlacement(tx, ty);
    return;
  }
  if (tile === TileType.Market) {
    state.tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    state.marketBuilt = true;
    return;
  }
  if (tile === TileType.GoldShop) {
    if (state.tiles[tileIndex(tx, ty)] === TileType.GoldShop) {
      tryLevelUpInPlace(tx, ty, [TileType.GoldShop]);
      return;
    }
    state.tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    state.goldShopBuilt = true;
    return;
  }

  state.tiles[tileIndex(tx, ty)] = tile;
  broadcastTileUpdate(tx, ty, tile);
}

// ---- Building info panel (client left-click) and its Upgrade button ----

// The tile to "place on itself" to upgrade the building at `t` in place (null: not upgradeable).
export function upgradePlacementTile(t: TileType): TileType | null {
  if (t === TileType.House || t === TileType.BigHouse) return TileType.House;
  if (t === TileType.KnightPost || t === TileType.CastleLevel2) return TileType.KnightPost;
  if (t === TileType.MilitiaPost || t === TileType.MilitiaCamp2) return TileType.MilitiaPost;
  if (t === TileType.ArcherPost) return TileType.ArcherPost;
  if (t === TileType.Stables) return TileType.Stables;
  if (t === TileType.TownCenter) return TileType.TownCenter;
  return IN_PLACE_UPGRADE_TILES.includes(t) ? t : null;
}

// Forts phase B: rebuild a razed fort's RuinedKeep as the sender clan's outpost (a Town Center
// construction on the keep tile, the template's rebuildCost). Bypasses the fort-grounds and "no Town
// Center near a fort" refusals for this one tile; still keeps the Town Center spacing.
export function handleRebuildKeep(player: Player, tx: number, ty: number) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.RuinedKeep) return;
  const s = siteAtKeep(tx, ty);
  if (!s) return;
  const problem = rebuildKeepProblem(s.id, tx, ty, player);
  if (problem) {
    sendEvent(player, "build", problem);
    return;
  }
  const cost = SITE_TEMPLATES[s.template].rebuildCost;
  spend(cost);
  setOwner(tileIndex(tx, ty), 0);
  setTileClan(tileIndex(tx, ty), player.clan);
  buildingHp.delete(resourceKey(tx, ty));
  if (state.instantBuild) {
    state.tiles[tileIndex(tx, ty)] = TileType.Empty;
    resolvePlacement(tx, ty, TileType.TownCenter, TileType.Empty);
  } else {
    startConstruction(tx, ty, TileType.TownCenter, TileType.RuinedKeep, false);
    sendEvent(player, "build", `Builders are on their way to rebuild ${s.name}'s keep`);
  }
}

// Why the player can't rebuild this RuinedKeep now (null = they can).
function rebuildKeepProblem(siteId: string, tx: number, ty: number, player?: Player): string | null {
  const s = siteAtKeep(tx, ty);
  if (!s || s.id !== siteId) return "Not a fort's keep";
  const blocker = rebuildKeepBlocker(s);
  if (blocker) return blocker;
  if (constructionSites.has(resourceKey(tx, ty))) return "Rebuilding";
  if (player) {
    const c = tileToPixelCenter({ x: tx, y: ty });
    if (Math.hypot(player.x - c.x, player.y - c.y) > REACH * 3) return "Walk up to the keep";
  }
  if (townCenterTooClose(tx, ty)) return `Too close to a Town Center (${TOWN_CENTER_MIN_SPACING_TILES} tiles)`;
  if (!canAfford(SITE_TEMPLATES[s.template].rebuildCost)) return "Not enough materials";
  if (!state.instantBuild && !anyBuilderAlive()) return "No builders available";
  return null;
}

// Building info for a tile an NPC fort owns ("Grakkar Stockade: Wall"), with the Rebuild button on a
// razed fort's RuinedKeep.
function siteTileInfo(tx: number, ty: number, t: TileType, forPlayer?: Player): BuildingInfo | null {
  const s = siteByNum(ownerAt(tileIndex(tx, ty))) ?? (t === TileType.RuinedKeep ? siteAtKeep(tx, ty) : undefined);
  if (!s) return null;
  const label = t === TileType.SiteKeep ? "Keep" : t === TileType.RuinedKeep ? "Ruined keep" : t === TileType.Tent ? "Tent" : BUILDING_NAMES[t] ?? "Wall";
  const hearth = t === TileType.SiteKeep ? hearths.get(s.id) : undefined;
  const hp = hearth ? { hp: Math.max(0, Math.round(hearth.hp)), max: hearth.maxHp } : structureHp(tx, ty);
  const living = s.garrison.filter((id) => mobs.has(id)).length;
  const human = s.faction === "human";
  const noun = SITE_TEMPLATES[s.template].noun ?? "village";
  const bonuses = [
    human ? `${label} of the ${noun} of ${s.name}` : `${s.faction === "orc" ? "Orc stockade" : "Bandit palisade"}, tier ${s.tier}`,
    s.captured ? "Captured" : s.cleared ? "Cleared: the keep is razed" : `Garrison ${living}/${s.garrisonMax}${s.awake ? "" : " (asleep)"}`,
  ];
  // Forts phase C: neutral until attacked; phase D: the clan's relation tier and the trade panel.
  const trade = human ? tradeInfoFor(s, forPlayer) : undefined;
  // Forts phase F: the clan's vassal: call to arms / tribute (BuildingInfo.vassal).
  const vassal = human ? vassalInfoFor(s, forPlayer) : undefined;
  if (human && !s.captured) {
    const myClan = forPlayer?.clan ?? 0;
    const tier = tierOf(myClan, s);
    const rel = Math.round(relationOf(myClan, s.id));
    bonuses.push(`Relation ${rel}: ${RELATION_TIER_NAMES[tier]}${tier === "vassal" ? ` (sworn to you; free again below ${RELATION_VASSAL_KEEP})` : ""}`);
    if (s.vassalOf != null && s.vassalOf !== myClan) bonuses.push(`Vassal of ${clanById(s.vassalOf).name}`);
    else if (s.vassalOf == null && !s.cleared && rel >= RELATION_ALLIED_MIN) bonuses.push(`At relation 100 it swears fealty if your army's power is at least its own (yours ${clanPower(myClan)}, theirs ${sitePower(s)})`);
    if (!s.cleared) bonuses.push(s.provoked ? "Hostile: you attacked them. Their guards and towers fight until they calm down" : "Neutral: gates open by day, guards and towers leave you alone unless you attack");
  }
  let keep: BuildingInfo["keep"];
  if (t === TileType.RuinedKeep && !s.captured) {
    const reason = rebuildKeepProblem(s.id, tx, ty, forPlayer) ?? "";
    keep = { cost: formatCost(SITE_TEMPLATES[s.template].rebuildCost), enabled: reason === "", reason };
    bonuses.push(`Rebuild it as your outpost: a level-1 Town Center named "${s.name} Outpost" with its own population cap; the walls, gates and towers become yours`);
  }
  const title = human && !s.captured && !s.cleared ? `${s.provoked ? "Hostile" : "Neutral"} settlement: ${s.name}` : `${s.name}: ${label}`;
  return {
    name: title, tile: t, level: 1, maxLevel: 1, hp: hp ? Math.round(hp.hp) : null, maxHp: hp?.max ?? null,
    staffing: s.captured ? "" : human && !s.provoked ? "Neutral" : "Hostile", bonuses, upgrade: null, construction: null, repair: null, ...(keep ? { keep } : {}), ...(trade ? { trade } : {}), ...(vassal ? { vassal } : {}),
  };
}

export function buildingInfoFor(tx: number, ty: number, forPlayer?: Player): BuildingInfo | null {
  if (!inBounds(tx, ty)) return null;
  ({ x: tx, y: ty } = anchorOfTile(tx, ty));
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  if (ownerAt(tileIndex(tx, ty)) !== 0 || t === TileType.RuinedKeep) {
    const info = siteTileInfo(tx, ty, t, forPlayer);
    if (info) return info;
  }
  const key = resourceKey(tx, ty);
  const site = constructionSites.get(key);
  if (t === TileType.ConstructionSite) {
    if (!site) return null;
    const level = levelAfterPlacement(site.target, site.prevTile, tx, ty);
    return {
      name: `Construction: ${BUILDING_NAMES[site.target] ?? "Building"}`,
      tile: t,
      level,
      maxLevel: 3,
      hp: null,
      maxHp: null,
      staffing: `Builders ${siteBuilderCount(key)}/${BUILDER_MAX_PER_SITE}`,
      bonuses: [`Build speed x${productionSpeedMultiplier().toFixed(2)} per builder (happiness, Town Center)`],
      upgrade: null,
      construction: Math.min(1, site.progress / site.totalTicks),
      repair: null,
    };
  }
  const name = BUILDING_NAMES[t];
  if (!name) return null;
  const level = currentBuildingLevel(tx, ty, t);
  const tc = t === TileType.TownCenter ? findTownCenterAt(tx, ty) : undefined;
  const posted = Array.from(colonists.values()).filter((c) => c.postX === tx && c.postY === ty && !isAbbeyClergy(c));
  const bonuses: string[] = [];
  let staffing = posted.length > 0 ? `Workers ${posted.length}` : "No workers";

  if (tc) {
    const stat = settlementStats().find((x) => x.tc === tc);
    staffing = `Population ${stat?.used ?? 0}/${stat?.cap ?? 0}`;
    bonuses.push(
      `Lv${tc.level}: +${pct(levelBonus(tc.level, TOWN_CENTER_LEVEL_BONUS_PER_STEP))} productivity and unit damage (colony-wide; the highest Town Center counts)`
    );
    bonuses.push(`Settlement population cap ${stat?.cap ?? 0}: housing ${stat?.housingCap ?? 0} (${TOWN_CENTER_BASE_POPULATION} base, +${TOWN_CENTER_EXTRA_POPULATION} per extra Town Center, +${TOWN_CENTER_LEVEL_POPULATION_BONUS} per level, houses, Keep), tier ceiling ${stat?.tierCap ?? 0}${stat && stat.keepBonus > 0 ? ` + Keep ${stat.keepBonus}` : ""}`);
    bonuses.push(`Troops ${stat?.troops ?? 0}/${stat?.troopCap ?? 0} (housed by unit buildings, not population); garrison ${stat?.garrisonBase ?? 0}/${stat?.garrisonCap ?? 0} base soldiers`);
    bonuses.push(`${tc.level} builder${tc.level === 1 ? "" : "s"} (one per level)`);
  } else if (isHouseTile(t)) {
    staffing = `Beds ${houseOccupancy(tx, ty)}/${houseCapacity(t)}`;
    let neighbours = 0;
    for (const [dx, dy] of NEIGHBOURS_8) {
      if (!inBounds(tx + dx, ty + dy)) continue;
      const n = state.tiles[tileIndex(tx + dx, ty + dy)] as TileType;
      if (isSynergyBuilding(n) || isHouseTile(n)) neighbours++;
    }
    bonuses.push(`+${houseCapacity(t)} population (tier ${level})`);
    if (neighbours > 0) bonuses.push(`+${neighbours} population from adjacent houses / workplaces / barracks`);
    let barracks = 0;
    for (const [dx, dy] of NEIGHBOURS_8) {
      if (inBounds(tx + dx, ty + dy) && isMilitaryTile(state.tiles[tileIndex(tx + dx, ty + dy)] as TileType)) barracks++;
    }
    if (barracks > 0) bonuses.push(`+1 troop slot to each of ${barracks} adjacent unit building${barracks === 1 ? "" : "s"}`);
  } else if (level > 1 && !isMilitaryTile(t) && !isTowerTile(t) && t !== TileType.Keep) {
    bonuses.push(`Lv${level}: ${pct(levelBonus(level))} shorter work cycles`);
  }

  if (isMilitaryTile(t)) {
    const army = armyDamageMultiplier(tx, ty) - 1;
    if (army > 0) bonuses.push(`Unit damage +${pct(army)} (adjacent army buildings / Blacksmith, Town Center level)`);
    const slots = unitBuildingSlots(tx, ty);
    if (slots) {
      const houses = slots.cap - slots.base;
      staffing = `Troops ${troopsAtPost(tx, ty, slots.kind)}/${slots.cap}`;
      bonuses.push(`Houses its own troops (not settlement population): ${slots.base} at Lv${slots.level}${houses > 0 ? ` + ${houses} from adjacent house${houses === 1 ? "" : "s"}` : "; each adjacent house adds +1"}`);
      const stat = settlementStats().find((x) => resourceKey(x.tc.x, x.tc.y) === settlementKeyNear(tx, ty));
      if (stat) bonuses.push(`Settlement ${stat.number} garrison ${stat.garrisonBase}/${stat.garrisonCap} base soldiers (Town Center tier, Keep)`);
    }
  }
  if (t === TileType.ChurchPost) bonuses.push(`Heals ${healAmountFor(tx, ty)} per prayer`);
  if (t === TileType.Pasture || t === TileType.WoolFarm) {
    const fp = placedFootprint(tx, ty);
    bonuses.push(fp.w > 1 ? `${fp.w}x${fp.h} paddock: x${footprintYieldMult(tx, ty)} produce per batch` : "Old 1x1 pasture: x1 produce (new pastures are 2x2, x4)");
  }
  if (t === TileType.BuildersGuild) bonuses.push(`${level} builder${level === 1 ? "" : "s"} (one per level)`);
  if (t === TileType.Stables) {
    bonuses.push(`Lv${level}: ${cavalryCountForLevel(level)} cavalry (fast, wings), charge x${CAVALRY_CHARGE_MULT} after ${CAVALRY_CHARGE_TILES} tiles in a straight line`);
  }
  if (t === TileType.Keep) {
    const stat = settlementStats().find((x) => resourceKey(x.tc.x, x.tc.y) === settlementKeyNear(tx, ty));
    staffing = `Population ${stat?.used ?? 0}/${stat?.cap ?? 0}`;
    bonuses.push(`Keep Lv ${level}: +${KEEP_GARRISON_PER_LEVEL * level} soldier garrison (no civilian population)`);
    bonuses.push(`Recruits up to ${level} hero${level === 1 ? "" : "es"} (one per Keep level), ${HERO_POPULATION_COST} population each`);
  }
  if (t === TileType.Blacksmith) {
    bonuses.push(`Crafts tools until the colony holds ${BLACKSMITH_TOOLS_STOCK_CAP}, then idles (saves wood and iron)`);
    bonuses.push(`Forges tier-${level} armour / weapons (tier = level) for knights, spearmen, pikemen and cavalry`);
  }
  if (t === TileType.SiegeWorkshop) {
    staffing = `Engines ${siegeUnitsAt(tx, ty)}/${SIEGE_WORKSHOP_CAP}`;
    bonuses.push(`Builds one engine at a time (${SIEGE_BUILD_TICKS / TICK_RATE}s each), ${SIEGE_POPULATION_COST} population each`);
    bonuses.push(`Ram: x${SIEGE_BUILDING_MULT} vs buildings, x${RAM_UNIT_MULT} vs units. Catapult: ${CATAPULT_RANGE / TILE_SIZE}-tile boulders, splash`);
  }
  if (isTowerTile(t)) {
    staffing = "No workers needed";
    bonuses.push(...towerInfoLines(level));
  }
  if (INDUSTRIAL_TILES.includes(t)) {
    const synergy = industrialSynergyMultiplier(tx, ty) - 1;
    bonuses.push(`Industrial synergy +${pct(synergy)} (+5% per industrial building within 5 tiles)`);
  }
  if (isSynergyBuilding(t)) {
    const houses = adjacentHouseCount(tx, ty);
    if (houses > 0 && !isMilitaryTile(t)) bonuses.push(`${houses} adjacent house${houses === 1 ? "" : "s"}: +${houses} population`);
  }
  const biome = biomeProductionFactor(tx, ty);
  if (biome < 1) bonuses.push(`${biomeAt(tx, ty) === Biome.Hills ? "Hills" : "Plains"} biome: ${pct(1 - biome)} shorter cycles`);
  if (POPULATION_GATED_TILES.includes(t) || INDUSTRIAL_TILES.includes(t)) {
    bonuses.push(`Happiness ${state.colonyHappiness}%: work speed x${happinessSpeedMultiplier().toFixed(2)}`);
    if (townCenterBonus() > 0) bonuses.push(`Town Center Lv${highestTownCenterLevel()}: +${pct(townCenterBonus())} productivity`);
  }

  let upgrade: BuildingInfo["upgrade"] = null;
  const placeTile = upgradePlacementTile(t);
  if (placeTile !== null) {
    if (level >= 3) {
      upgrade = { cost: "Max level", enabled: false, reason: "Already at level 3" };
    } else {
      const cost = placementCost(placeTile, t, tx, ty);
      let reason = "";
      if (site) reason = "Upgrade under way";
      else if (!canAfford(cost)) reason = "Not enough resources";
      else if (!isInPlaceUpgrade(placeTile, t, tx, ty)) reason = "Can't upgrade yet";
      else if (POPULATION_GATED_TILES.includes(placeTile) && placementNeedsNewWorkerSlot(placeTile, tx, ty) && settlementBlocker(tx, ty))
        reason = settlementBlocker(tx, ty);
      else if (garrisonGain(placeTile, t, tx, ty) > 0 && garrisonBlocker(tx, ty, garrisonGain(placeTile, t, tx, ty)))
        reason = garrisonBlocker(tx, ty, garrisonGain(placeTile, t, tx, ty));
      else if (!state.instantBuild && !anyBuilderAlive() && placeTile !== TileType.TownCenter) reason = "No builders available";
      const tierNote =
        t === TileType.TownCenter
          ? ` (max pop ${settlementTierCap(level + 1)})`
          : t === TileType.Keep
            ? ` (+${KEEP_GARRISON_PER_LEVEL * (level + 1)} soldier garrison)`
            : "";
      upgrade = { cost: `Lv${level + 1}: ${formatCost(cost)}${tierNote}`, enabled: reason === "", reason };
    }
  }

  const hpState = structureHp(tx, ty);
  let repair: BuildingInfo["repair"] = null;
  if (hpState && hpState.hp < hpState.max) {
    const cost = repairCost(tx, ty, unpaidRepairHp(tx, ty));
    let reason = "";
    if (repairQueue.includes(key)) reason = "Repair under way";
    else if (!canAfford(cost)) reason = "Not enough resources";
    else if (!anyBuilderAlive()) reason = "No builders available";
    repair = { cost: formatCost(cost), enabled: reason === "", reason };
  }

  // Forts phase A: an NPC site's building: labelled as theirs, no upgrade / repair / gate lock / shop.
  if (ownerAt(tileIndex(tx, ty)) !== 0) {
    return {
      name: `Enemy fort: ${name}`, tile: t, level, maxLevel: 1,
      hp: hpState ? Math.ceil(hpState.hp) : null, maxHp: hpState ? hpState.max : null,
      staffing: "", bonuses: ["Belongs to an enemy fort: right-click with soldiers selected to attack it"],
      upgrade: null, construction: null, repair: null,
    };
  }

  // Clans: another clan's building: labelled as theirs, no upgrade / repair / gate lock / shop.
  if (forPlayer && isForeignClanTile(tx, ty, forPlayer.clan)) {
    return {
      name: `${clanById(clanIdAt(tx, ty)).name}: ${name}`, tile: t, level, maxLevel: level,
      hp: hpState ? Math.ceil(hpState.hp) : null, maxHp: hpState ? hpState.max : null,
      staffing: "", bonuses: ["Belongs to another clan (neutral)"],
      upgrade: null, construction: null, repair: null,
    };
  }

  return {
    name: tc?.name ?? name,
    tile: t,
    level,
    maxLevel: t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate || t === TileType.SiegeWorkshop || t === TileType.Market || t === TileType.WardStone || t === TileType.FarmPlot || isRoadTile(t) ? 1 : 3,
    hp: hpState ? Math.ceil(hpState.hp) : null,
    maxHp: hpState ? hpState.max : null,
    staffing,
    bonuses,
    upgrade,
    construction: site ? Math.min(1, site.progress / site.totalTicks) : null,
    repair,
    ...(t === TileType.Gate ? { gate: (({ open, lock, overrun }) => ({ open, lock, overrun }))(gateAt(tileIndex(tx, ty))) } : {}),
    ...(t === TileType.SiegeWorkshop ? { siege: siegeWorkshopInfo(tx, ty) } : {}),
    ...(t === TileType.Blacksmith ? { forge: blacksmithForgeInfo(tx, ty) } : {}),
    ...(t === TileType.Keep ? { heroes: keepHeroInfo(tx, ty) } : {}),
    ...(t === TileType.ChurchPost ? { spellShop: churchSpellShop(forPlayer) } : {}),
    ...(t === TileType.GoldShop ? { tradingPost: tradingPostInfo(tx, ty) } : {}),
  };
}

export function handleUpgradeBuilding(player: Player, tx: number, ty: number) {
  if (!inBounds(tx, ty)) return;
  const placeTile = upgradePlacementTile(state.tiles[tileIndex(tx, ty)] as TileType);
  if (placeTile === null) return;
  handleSetTile(player, tx, ty, placeTile, true);
}
