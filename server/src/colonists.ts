// colonists.ts: Colonists: workers, builders, repair, farmers, housing/shelter, population, settlements, town centers, respawn windows, food, ward priest, the colonist tick.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import { TileType, type ColonistKind, TILE_SIZE, TICK_RATE } from "@colony/shared/protocol";
import type {
  Colonist, ConstructionSiteState, Cost, Mob, Player, ResourceKey, RespawnWindow, SettlementStat, TileCoord,
  TownCenter,
} from "./types.js";
import {
  BISHOP_MAX_HP, BISHOP_SPEED, BUILDER_IDLE_RETRY_TICKS, BUILDER_MAX_PER_SITE, BUILDER_ROUTE_CANDIDATES,
  BUILDER_WORK_RANGE_PX, CIVILIAN_MAX_HP, COLONIST_SPEED, CRAFT_RECIPES, DAY_TICKS, DUSK_RESPAWN_CYCLE_TICK,
  FARMER_PLOT_DWELL_TICKS, FARMHAND_YIELD_PER_CYCLE, FARM_PRODUCE_BY_TILE, FOOD_PER_COLONIST_PER_DAY, GAME_DAY_TICKS,
  GARRISON_LOITER_PX, GATHER_RESOURCE_TILE, HAPPINESS_DESERTION_CHANCE, HAPPINESS_DESERTION_THRESHOLD,
  HAPPINESS_MUTINY_THRESHOLD, HAPPINESS_SCENERY_TREE_BASELINE, HERO_POPULATION_COST, IDLE_RETRY_TICKS,
  KEEP_GARRISON_PER_LEVEL, KEEP_POPULATION_PER_LEVEL, MOB_ATTACK_RANGE, MOB_DAMAGE, MOB_KIND_CONFIG,
  MOB_MARK_DEFAULTS, MOB_SPEED, NEIGHBOURS_8, NIGHT_TICKS, POPULATION_GATED_TILES, PRODUCTION_HAPPINESS_FLOOR,
  REPAIR_COST_FRACTION, REPAIR_MOB_CLEARANCE_TILES, REPAIR_SECONDS_FULL, REPAIR_SHORT_TOAST_TICKS, RESPAWN_FOOD_COST,
  SETTLEMENT_POP_CAP_BY_TIER, SIEGE_POPULATION_COST, STARVATION_DAMAGE, TAVERN_HAPPINESS_RADIUS_TILES,
  TOWN_CENTER_BASE_POPULATION, TOWN_CENTER_EXTRA_POPULATION, TOWN_CENTER_LEVEL_BONUS_PER_STEP,
  TOWN_CENTER_LEVEL_POPULATION_BONUS, TOWN_CENTER_MAX_HP_BY_LEVEL, WARD_GRACE_TICKS, WARD_RADIUS_TILES,
  WARD_TEND_TICKS,
} from "./constants.js";
import {
  buildingHp, colonists, constructionSites, farmPlots, mobs, repairPaid, repairQueue, reservedResourceTiles,
  respawnQueue, state, summonedUntil, wardStoneLastTended, wardStonesActiveLastTick,
} from "./state.js";
import {
  biomeSpeedMultiplier, getBuildingLevel, inBounds, isNightNow, levelBonus, ownerAt, resourceKey,
  roadSpeedMultiplier, tileIndex, tileOfPixel, tileToPixelCenter,
} from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath } from "./pathfinding.js";
import {
  depositGatheredResource, effectiveChopTicks, effectiveCraftTicks, effectiveFarmhandCycleTicks,
  industrialSynergyMultiplier, isBarnStaffed, releaseResourceReservation, } from "./economy.js";
import { updateForager, updateHunter } from "./wildlife.js";
import {
  garrisonGain, guardStats, isGuardOrMilitiaKind, isMilitiaLineKind, isSiegeKind, isSoldierKind, militiaKindForLevel,
  militiaLevelForTile, returnToRally, settlementGarrisonTierCap, troopsAtPost, unitBuildingSlots,
  updateBishopColonist, updateGuardColonist,
} from "./units.js";
import { damageColonist, healStructure, structureHp } from "./combat.js";
import { isDormantGuardian, keyToTile } from "./mobs.js";
import {
  canAfford, currentBuildingLevel, placementCost, sendEvent, spend, upgradePlacementTile,
} from "./construction.js";
import { equipNewUnit, heroRespawnFee, heroTestEvent, isEquippedKind, spawnHeroColonist } from "./heroes.js";
import { broadcastEvent, broadcastTileUpdate } from "./net.js";

// Where world-gen puts the starting Town Center (the map's dead center; world-gen keeps it clear).
// Since Town Centers became placeable, gameplay reads the `townCenters` list instead.
export const TOWN_CENTER_TILE: TileCoord = {
  x: Math.floor(state.WORLD_TILES_X / 2),
  y: Math.floor(state.WORLD_TILES_Y / 2),
};

export function townCenterMaxHp(level: number): number {
  return TOWN_CENTER_MAX_HP_BY_LEVEL[Math.min(Math.max(level, 1), 3) - 1];
}

export function findTownCenterAt(tx: number, ty: number): TownCenter | undefined {
  return state.townCenters.find((tc) => tc.x === tx && tc.y === ty);
}

export function nearestTownCenter(px: number, py: number): TownCenter | null {
  let best: TownCenter | null = null;
  let bestD = Infinity;
  for (const tc of state.townCenters) {
    const c = tileToPixelCenter(tc);
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < bestD) {
      bestD = d;
      best = tc;
    }
  }
  return best;
}

// The colony-wide Town Center bonuses use the highest level among the standing ones (0 with none).
export function highestTownCenterLevel(): number {
  return state.townCenters.reduce((max, tc) => Math.max(max, tc.level), 0);
}

export function townCenterBonus(): number {
  return levelBonus(highestTownCenterLevel(), TOWN_CENTER_LEVEL_BONUS_PER_STEP);
}

// Next to the Town Center nearest `near` (default: the starting spot), or the starting spot itself
// when none stands.
export function spawnPointNearTownCenter(near?: { x: number; y: number }): { x: number; y: number } {
  const tc = near ? nearestTownCenter(near.x, near.y) : state.townCenters[0] ?? null;
  const tile = tc ?? TOWN_CENTER_TILE;
  const approach = findAdjacentWalkable(tile.x, tile.y);
  return tileToPixelCenter(approach ?? tile);
}

export function countTilesOfType(tileType: TileType): number {
  let count = 0;
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === tileType) count++;
  }
  return count;
}

export function computeColonyHappiness(): number {
  const foodTypesAvailable = (["grain", "meat", "fruit"] as const).filter((k) => state.stock[k] > 0).length;
  const foodVarietyScore = (foodTypesAvailable / 3) * 100;

  const treeCount = countTilesOfType(TileType.Tree);
  const sceneryScore = Math.min(100, (treeCount / HAPPINESS_SCENERY_TREE_BASELINE) * 100);

  const posts = new Set<string>();
  for (const c of colonists.values()) {
    if (!isAbbeyClergy(c)) posts.add(resourceKey(c.postX, c.postY));
  }

  const tavernTiles: TileCoord[] = [];
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      if (state.tiles[tileIndex(tx, ty)] === TileType.Tavern) tavernTiles.push({ x: tx, y: ty });
    }
  }
  let tavernCoverageScore = 0;
  if (posts.size > 0 && tavernTiles.length > 0) {
    let covered = 0;
    for (const postKey of posts) {
      const [px, py] = postKey.split(",").map(Number);
      if (tavernTiles.some((t) => Math.hypot(t.x - px, t.y - py) <= TAVERN_HAPPINESS_RADIUS_TILES)) covered++;
    }
    tavernCoverageScore = (covered / posts.size) * 100;
  }

  const happiness = foodVarietyScore * 0.4 + sceneryScore * 0.3 + tavernCoverageScore * 0.3;
  return Math.max(0, Math.min(100, Math.round(happiness)));
}

export function happinessSpeedMultiplier(): number {
  return PRODUCTION_HAPPINESS_FLOOR + (1 - PRODUCTION_HAPPINESS_FLOOR) * (state.colonyHappiness / 100);
}

// Every production timer (and builders' work rate) divides by this: happiness times the Town Center bonus.
export function productionSpeedMultiplier(): number {
  return happinessSpeedMultiplier() * (1 + townCenterBonus());
}

export function isStationaryMinerKind(kind: ColonistKind): boolean {
  return kind === "ironMiner" || kind === "rockMiner";
}

export function isStationaryWorkerKind(kind: ColonistKind): boolean {
  return kind === "farmer" || kind === "farmhand" || kind === "artisan" || isStationaryMinerKind(kind);
}

export function castleLevelForTile(t: TileType): number {
  if (t === TileType.CastleLevel2) return 2;
  if (t === TileType.CastleLevel3) return 3;
  return 1;
}

export function isValidPostTile(kind: ColonistKind, t: TileType): boolean {
  if (kind === "knight") {
    return t === TileType.KnightPost || t === TileType.CastleLevel2 || t === TileType.CastleLevel3;
  }
  if (kind === "archer") {
    return t === TileType.ArcherPost;
  }
  if (kind === "cavalry") return t === TileType.Stables;
  if (isSiegeKind(kind)) return t === TileType.SiegeWorkshop;
  if (isMilitiaLineKind(kind)) return t === TileType.MilitiaPost || t === TileType.MilitiaCamp2 || t === TileType.MilitiaCamp3;
  if (kind === "lumberjack") return t === TileType.LumberjackPost;
  if (kind === "farmer") return t === TileType.BarnPost;
  if (kind === "ironMiner") return t === TileType.IronMinePost;
  if (kind === "rockMiner") return t === TileType.RockMinePost;
  // Not AbbeyHall: Abbey clergy are world-gen residents and never go through the respawn queue.
  // Not WardStone: the Ward Priest respawns through updateWardPriestPresence instead.
  if (kind === "bishop") return t === TileType.ChurchPost;
  if (kind === "farmhand") return FARM_PRODUCE_BY_TILE[t] !== undefined;
  if (kind === "artisan") return CRAFT_RECIPES[t] !== undefined;
  if (kind === "hunter") return t === TileType.HunterHut;
  if (kind === "forager") return t === TileType.ForagerHut;
  // The colony's starting builders are posted at a Town Center, the rest at a Builders' Guild.
  if (kind === "builder") return t === TileType.BuildersGuild || t === TileType.TownCenter;
  return false;
}

export function isCivilianKind(kind: ColonistKind): boolean {
  return (
    kind === "lumberjack" ||
    kind === "farmer" ||
    kind === "ironMiner" ||
    kind === "rockMiner" ||
    kind === "farmhand" ||
    kind === "artisan" ||
    kind === "hunter" ||
    kind === "forager" ||
    kind === "builder"
  );
}

// Civilians and bishops count toward their settlement's population; siege engines and heroes at their
// cost (populationCostOf), Abbey clergy not at all. Soldiers did from 2026-10-28; since the barracks-housing
// rework (2026-10-29) each unit building houses its own troops instead (unitBuildingSlots).
export function consumesPopulation(kind: ColonistKind): boolean {
  return isCivilianKind(kind) || kind === "bishop";
}

// Saint Wren's Abbey's resident clergy: colonists only so the existing bishop code can drive them.
// They aren't the colony's (no population, food, happiness, commands); identified by their post,
// since AbbeyHall is only ever placed by world-gen.
export function isAbbeyClergy(c: Colonist): boolean {
  return state.tiles[tileIndex(c.postX, c.postY)] === TileType.AbbeyHall;
}

// What one unit counts for in population: civilians/bishops 1 (not Abbey clergy), siege engines and heroes
// their cost, soldiers 0 (housed by their unit building).
export function populationCostOf(c: Colonist): number {
  if (isSiegeKind(c.kind)) return SIEGE_POPULATION_COST;
  if (c.kind === "hero") return HERO_POPULATION_COST;
  // Hero phase 4: summoned skeletons count for nothing.
  if (summonedUntil.has(c.id)) return 0;
  return consumesPopulation(c.kind) && !isAbbeyClergy(c) ? 1 : 0;
}

export function civilianPopulationUsed(): number {
  let count = 0;
  for (const c of colonists.values()) count += populationCostOf(c);
  return count;
}

export function settlementTierCap(level: number): number {
  return SETTLEMENT_POP_CAP_BY_TIER[Math.min(Math.max(level, 1), SETTLEMENT_POP_CAP_BY_TIER.length) - 1];
}

// The settlement key (Town Center "x,y") nearest a tile; "" with no Town Center.
export function settlementKeyNear(tx: number, ty: number): string {
  const p = tileToPixelCenter({ x: tx, y: ty });
  const tc = nearestTownCenter(p.x, p.y);
  return tc ? resourceKey(tc.x, tc.y) : "";
}

// The Town Center a unit counts toward: its stored settlement, or (old save / that one fell) the one
// nearest its post, which is then stored.
export function settlementOf(c: Colonist): TownCenter | null {
  const tc = c.settlementId ? state.townCenters.find((t) => resourceKey(t.x, t.y) === c.settlementId) : undefined;
  if (tc) return tc;
  c.settlementId = settlementKeyNear(c.postX, c.postY);
  return state.townCenters.find((t) => resourceKey(t.x, t.y) === c.settlementId) ?? null;
}

// Per-settlement population: units by stored settlement, queued worker slots, and the cap = the
// housing-derived capacity (base + houses + neighbourhood bonus nearest to it) clamped by the tier cap.
export function settlementStats(): SettlementStat[] {
  const stats: SettlementStat[] = state.townCenters.map((tc, i) => ({
    tc,
    number: i + 1,
    used: 0,
    pending: 0,
    housingCap:
      TOWN_CENTER_BASE_POPULATION +
      (i > 0 ? TOWN_CENTER_EXTRA_POPULATION : 0) +
      TOWN_CENTER_LEVEL_POPULATION_BONUS * (tc.level - 1),
    tierCap: settlementTierCap(tc.level),
    keepBonus: 0,
    cap: 0,
    troops: 0,
    troopCap: 0,
    garrisonBase: 0,
    garrisonCap: settlementGarrisonTierCap(tc.level),
  }));
  if (stats.length === 0) return stats;
  const statNear = (tx: number, ty: number): SettlementStat | undefined => {
    const p = tileToPixelCenter({ x: tx, y: ty });
    const tc = nearestTownCenter(p.x, p.y);
    return stats.find((s) => s.tc === tc);
  };
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i] as TileType;
    const w = t === TileType.House ? 1 : t === TileType.BigHouse ? 3 : t === TileType.HouseLevel2 ? 5 : 0;
    if (w) {
      const s = statNear(i % state.WORLD_TILES_X, Math.floor(i / state.WORLD_TILES_X));
      if (s) s.housingCap += w;
    } else if (t === TileType.Keep) {
      const x = i % state.WORLD_TILES_X;
      const y = Math.floor(i / state.WORLD_TILES_X);
      const s = statNear(x, y);
      if (s) {
        const bonus = KEEP_POPULATION_PER_LEVEL * getBuildingLevel(x, y);
        s.keepBonus += bonus;
        s.housingCap += bonus;
        s.garrisonCap += KEEP_GARRISON_PER_LEVEL * getBuildingLevel(x, y);
      }
    } else if (isMilitaryTile(t)) {
      const x = i % state.WORLD_TILES_X;
      const y = Math.floor(i / state.WORLD_TILES_X);
      const slots = unitBuildingSlots(x, y);
      const s = statNear(x, y);
      if (s && slots) {
        s.troopCap += slots.cap;
        s.garrisonBase += slots.base;
      }
    }
  }
  neighbourhoodPopulationBonus((tx, ty) => {
    const s = statNear(tx, ty);
    if (s) s.housingCap++;
  });
  for (const c of colonists.values()) {
    const soldier = isSoldierKind(c.kind) && !summonedUntil.has(c.id);
    const cost = populationCostOf(c);
    if (!cost && !soldier) continue;
    const tc = settlementOf(c);
    const s = stats.find((x) => x.tc === tc);
    if (!s) continue;
    s.used += cost;
    if (soldier) s.troops++;
  }
  for (const site of constructionSites.values()) {
    const garrison = garrisonGain(site.target, site.prevTile, site.tx, site.ty);
    if (garrison > 0) {
      const s = statNear(site.tx, site.ty);
      if (s) s.garrisonBase += garrison;
    } else if (POPULATION_GATED_TILES.includes(site.target) && placementNeedsNewWorkerSlot(site.target, site.tx, site.ty)) {
      const s = statNear(site.tx, site.ty);
      if (s) s.pending++;
    }
  }
  for (const s of stats) s.cap = Math.min(s.housingCap, s.tierCap + s.keepBonus);
  return stats;
}

// "" when the settlement nearest (tx, ty) can take `cost` more population (counting queued worker
// slots), else why not.
export function settlementBlocker(tx: number, ty: number, cost = 1): string {
  const stats = settlementStats();
  if (stats.length === 0) return "No Town Center standing";
  const key = settlementKeyNear(tx, ty);
  const s = stats.find((x) => resourceKey(x.tc.x, x.tc.y) === key);
  if (!s || s.used + s.pending + cost <= s.cap) return "";
  const hint = s.housingCap < s.tierCap + s.keepBonus ? "build more houses" : "upgrade the Town Center or build a Keep";
  return `Settlement ${s.number} full (${s.used + s.pending}/${s.cap}) — ${hint}`;
}

// "" when the settlement nearest (tx, ty) has garrison room for a unit building's `gain` more base
// soldiers (a new post or an upgrade, see garrisonGain), else why not.
export function garrisonBlocker(tx: number, ty: number, gain: number): string {
  const stats = settlementStats();
  if (stats.length === 0) return "No Town Center standing";
  const key = settlementKeyNear(tx, ty);
  const s = stats.find((x) => resourceKey(x.tc.x, x.tc.y) === key);
  if (!s || s.garrisonBase + gain <= s.garrisonCap) return "";
  return `Settlement ${s.number} garrison full (${s.garrisonBase}/${s.garrisonCap} soldiers) — upgrade the Town Center or build a Keep`;
}

// Whole-colony population cap: the settlements' effective caps added up.
export function populationCap(): number {
  return settlementStats().reduce((n, s) => n + s.cap, 0);
}

export function isHouseTile(t: TileType): boolean {
  return t === TileType.House || t === TileType.BigHouse || t === TileType.HouseLevel2;
}

export function isMilitaryTile(t: TileType): boolean {
  return (
    t === TileType.KnightPost ||
    t === TileType.CastleLevel2 ||
    t === TileType.CastleLevel3 ||
    t === TileType.ArcherPost ||
    t === TileType.MilitiaPost ||
    t === TileType.MilitiaCamp2 ||
    t === TileType.MilitiaCamp3 ||
    t === TileType.Stables
  );
}

// Buildings that gain from standing next to houses: workplaces and unit buildings.
export function isSynergyBuilding(t: TileType): boolean {
  return POPULATION_GATED_TILES.includes(t) || isMilitaryTile(t);
}

// Neighbourhood synergy: +1 population for every adjacent (8-neighbour) pair of (house, house) or
// (house, any other staffed/unit building). Houses clustered with workplaces and barracks grow
// the colony faster, so neighbourhoods are worth building.
export function neighbourhoodPopulationBonus(onBonus?: (tx: number, ty: number) => void): number {
  let bonus = 0;
  for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
      if (!isHouseTile(state.tiles[tileIndex(tx, ty)] as TileType)) continue;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!inBounds(nx, ny)) continue;
        const n = state.tiles[tileIndex(nx, ny)] as TileType;
        if (isSynergyBuilding(n)) {
          bonus++;
          onBonus?.(tx, ty);
        }
        // House-house pairs are seen from both ends; count each once (the "later" tile in scan order).
        else if (isHouseTile(n) && (dy > 0 || (dy === 0 && dx > 0))) {
          bonus++;
          onBonus?.(tx, ty);
        }
      }
    }
  }
  return bonus;
}

// Upgrades happen by placing the same building on top of an existing one, not next to it.
export function findUpgradeTargetFor(tx: number, ty: number, type: TileType): TileCoord | null {
  if (state.tiles[tileIndex(tx, ty)] !== type) return null;
  return getBuildingLevel(tx, ty) < 3 ? { x: tx, y: ty } : null;
}

export function placementNeedsNewWorkerSlot(tile: TileType, tx: number, ty: number): boolean {
  if (tile === TileType.LumberjackPost) return findUpgradeTargetFor(tx, ty, TileType.LumberjackPost) === null;
  if (tile === TileType.BarnPost) return findUpgradeTargetFor(tx, ty, TileType.BarnPost) === null;
  if (tile === TileType.ChurchPost) return findUpgradeTargetFor(tx, ty, TileType.ChurchPost) === null;
  if (tile === TileType.WardStone) return state.wardPriestId === null;
  if (FARM_PRODUCE_BY_TILE[tile] !== undefined || CRAFT_RECIPES[tile] !== undefined) {
    return findUpgradeTargetFor(tx, ty, tile) === null;
  }
  return true;
}

export function spawnColonistForPost(
  tx: number,
  ty: number,
  kind: ColonistKind,
  castleLevel = 1
): Colonist {
  const isGuard = isGuardOrMilitiaKind(kind);
  const stationary = isStationaryMinerKind(kind) || kind === "farmhand";
  const spawnTile = isStationaryWorkerKind(kind) ? { x: tx, y: ty } : findAdjacentWalkable(tx, ty) ?? { x: tx, y: ty };
  const center = tileToPixelCenter(spawnTile);
  const stats = isGuard ? guardStats(kind, castleLevel) : null;
  const maxHp = stats ? stats.maxHp : kind === "bishop" ? BISHOP_MAX_HP : CIVILIAN_MAX_HP;
  const colonist: Colonist = {
    id: randomUUID(),
    kind,
    postX: tx,
    postY: ty,
    x: center.x,
    y: center.y,
    state: "idle",
    path: [],
    targetResourceX: -1,
    targetResourceY: -1,
    chopTicksRemaining: kind === "farmhand"
      ? effectiveFarmhandCycleTicks(tx, ty)
      : stationary
      ? effectiveChopTicks(tx, ty)
      : kind === "artisan"
      ? effectiveCraftTicks(tx, ty)
      : 0,
    idleCooldown: 0,
    growTicksRemaining: 0,
    harvestTicksRemaining: 0,
    hp: maxHp,
    maxHp,
    attackCooldownTicks: 0,
    targetMobId: null,
    repathCooldown: 0,
    sheltering: false,
    shelterAssigned: false,
    homeTileX: -1,
    homeTileY: -1,
    castleLevel,
    settlementId: settlementKeyNear(tx, ty),
    healTargetType: null,
    healTargetId: null,
    rallyTileX: tx,
    rallyTileY: ty,
    rallyX: tx * TILE_SIZE + TILE_SIZE / 2,
    rallyY: ty * TILE_SIZE + TILE_SIZE / 2,
    stance: "normal",
    poisonTicksRemaining: 0,
    poisonDamagePerTick: 0,
    targetWildlifeId: null,
    carryAmount: 0,
    buildSiteKey: null,
    repairKey: null,
    cycleTicksTotal: 0,
  };
  colonist.cycleTicksTotal = colonist.chopTicksRemaining;
  colonists.set(colonist.id, colonist);
  if (isEquippedKind(kind)) equipNewUnit(colonist);
  return colonist;
}

export function queueRespawn(c: Colonist) {
  // ticksRemaining is unused since dawn/dusk respawn windows (kept so old and new saves share a shape).
  respawnQueue.push({
    tx: c.postX, ty: c.postY, kind: c.kind, ticksRemaining: 0,
    ...(c.kind === "hero" && c.heroClass ? { hero: { id: c.id, name: c.heroName ?? "Hero", heroClass: c.heroClass } } : {}),
  });
}

export function removeColonistForPost(tx: number, ty: number) {
  for (const [id, c] of colonists) {
    // Heroes never despawn: a lost Keep leaves them posted at its tile (they respawn there too).
    if (c.postX === tx && c.postY === ty && c.kind !== "hero") {
      releaseResourceReservation(c);
      colonists.delete(id);
    }
  }
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    if (respawnQueue[i].tx === tx && respawnQueue[i].ty === ty && !respawnQueue[i].hero) {
      respawnQueue.splice(i, 1);
    }
  }
}

export function getColonistAtPost(tx: number, ty: number): Colonist | undefined {
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty) return c;
  }
  return undefined;
}

export function getColonistsAtPost(tx: number, ty: number): Colonist[] {
  const result: Colonist[] = [];
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty) result.push(c);
  }
  return result;
}

export function guardCountForLevel(level: number): number {
  if (level >= 3) return 5;
  if (level >= 2) return 3;
  return 1;
}

export function spawnExtraGuards(
  tx: number,
  ty: number,
  kind: "knight" | "archer" | "cavalry",
  newLevel: number
) {
  const targetCount = guardCountForLevel(newLevel);
  let currentCount = 0;
  for (const c of colonists.values()) {
    if (c.kind === kind && c.postX === tx && c.postY === ty) currentCount++;
  }
  for (let i = currentCount; i < targetCount; i++) {
    spawnColonistForPost(tx, ty, kind, newLevel);
  }
}
// Each Town Center keeps one builder per level (1 / 2 / 3) posted at it; the colony starts with one.
// Tops that Town Center's builders (alive or queued to respawn there) back up to its level. Runs at
// world-gen, whenever a Town Center is built or upgraded, so a colony that lost its Town Center and its
// builders can rebuild. (Builders' Guild builders are separate: one per Guild level.)
export function topUpTownCenterBuilders(tc: TownCenter) {
  let have = 0;
  for (const c of colonists.values()) if (c.kind === "builder" && c.postX === tc.x && c.postY === tc.y) have++;
  for (const q of respawnQueue) if (q.kind === "builder" && q.tx === tc.x && q.ty === tc.y) have++;
  for (let i = have; i < tc.level; i++) spawnColonistForPost(tc.x, tc.y, "builder");
}

export function respawnWindowAt(tick: number): RespawnWindow | null {
  const t = tick % GAME_DAY_TICKS;
  return t === 0 ? "dawn" : t === DUSK_RESPAWN_CYCLE_TICK ? "dusk" : null;
}

// The first window strictly after `tick`, and how many ticks away it is.
export function nextRespawnWindow(tick: number): { window: RespawnWindow; ticks: number } {
  const t = tick % GAME_DAY_TICKS;
  return t < DUSK_RESPAWN_CYCLE_TICK
    ? { window: "dusk", ticks: DUSK_RESPAWN_CYCLE_TICK - t }
    : { window: "dawn", ticks: GAME_DAY_TICKS - t };
}

// The snapshot's `respawn` (protocol RespawnWindowSnapshot).
export function respawnWindowSnapshot() {
  const next = nextRespawnWindow(state.cycleTick);
  return {
    waiting: respawnQueue.length + (state.wardPriestAwaitingWindow ? 1 : 0),
    nextWindow: next.window,
    ticksToWindow: next.ticks,
    dayTicks: DAY_TICKS,
    nightTicks: NIGHT_TICKS,
  };
}

export function processRespawnQueue() {
  // Replacements only arrive by day (both windows are daylight ticks); the queue waits out the night.
  if (isNightNow()) return;
  const windowNow = respawnWindowAt(state.cycleTick);
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const req = respawnQueue[i];
    // Hero phase 3: a fallen hero is never dropped; it comes back at a window when its settlement has room
    // (2 population) and the gold fee can be paid, else it waits for the next one.
    if (req.hero) {
      if (!windowNow) continue;
      if (settlementBlocker(req.tx, req.ty, HERO_POPULATION_COST) !== "") continue;
      const fee = heroRespawnFee(req.hero.id);
      if (state.stock.gold < fee) {
        heroTestEvent({ type: "respawnWait", id: req.hero.id, amount: fee });
        broadcastEvent("build", `${req.hero.name} waits for ${fee} gold to return at the next dawn or dusk`);
        continue;
      }
      state.stock.gold -= fee;
      state.respawnWindowSpawned++;
      spawnHeroColonist(req.hero.id, req.hero.name, req.hero.heroClass, req.tx, req.ty);
      heroTestEvent({ type: "respawn", id: req.hero.id, amount: fee, detail: windowNow });
      respawnQueue.splice(i, 1);
      continue;
    }
    // A builder whose Town Center fell respawns at the nearest one still standing.
    if (req.kind === "builder" && !isValidPostTile("builder", state.tiles[tileIndex(req.tx, req.ty)] as TileType)) {
      const p = tileToPixelCenter({ x: req.tx, y: req.ty });
      const tc = nearestTownCenter(p.x, p.y);
      if (tc) {
        req.tx = tc.x;
        req.ty = tc.y;
      }
    }
    const currentTile = state.tiles[tileIndex(req.tx, req.ty)] as TileType;
    if (!isValidPostTile(req.kind, currentTile)) {
      respawnQueue.splice(i, 1);
      continue;
    }
    // A barn only ever has one farmer: drop a queued replacement if one is already there.
    if (req.kind === "farmer" && isBarnStaffed(req.tx, req.ty)) {
      respawnQueue.splice(i, 1);
      continue;
    }
    // Barracks housing: a soldier only comes back while its unit building has a free troop slot (a
    // demolished neighbour house can shrink it); otherwise the replacement is dropped.
    if (isSoldierKind(req.kind)) {
      const slots = unitBuildingSlots(req.tx, req.ty);
      if (slots && troopsAtPost(req.tx, req.ty, slots.kind) >= slots.cap) {
        respawnQueue.splice(i, 1);
        continue;
      }
    }
    if (!windowNow) continue;
    // A settlement at its cap makes its dead civilians wait for the next window (soldiers use their building).
    if (consumesPopulation(req.kind) && settlementBlocker(req.tx, req.ty) !== "") {
      continue;
    }
    if (trySpendFood(RESPAWN_FOOD_COST)) {
      state.respawnWindowSpawned++;
      const castleLevel =
        req.kind === "knight"
          ? castleLevelForTile(currentTile)
          : req.kind === "archer" || req.kind === "cavalry"
          ? getBuildingLevel(req.tx, req.ty)
          : isMilitiaLineKind(req.kind)
          ? militiaLevelForTile(currentTile)
          : 1;
      const spawnKind = isMilitiaLineKind(req.kind) ? militiaKindForLevel(castleLevel) : req.kind;
      spawnColonistForPost(req.tx, req.ty, spawnKind, castleLevel);
      respawnQueue.splice(i, 1);
    }
  }
}

export function trySpendFood(amount: number): boolean {
  if (state.stock.grain + state.stock.meat + state.stock.fruit < amount) return false;
  let remaining = amount;
  for (const key of ["grain", "meat", "fruit"] as const) {
    if (remaining <= 0) break;
    const take = Math.min(state.stock[key], remaining);
    state.stock[key] -= take;
    remaining -= take;
  }
  return true;
}

export function applyDailyFoodConsumption() {
  // The Abbey provisions its own clergy: they neither eat the colony's food nor starve with it.
  const consumers = Array.from(colonists.values()).filter((c) => !isAbbeyClergy(c));
  const consumerCount = consumers.length;
  if (consumerCount === 0) return;
  let needed = Math.ceil(consumerCount * FOOD_PER_COLONIST_PER_DAY);
  for (const key of ["grain", "meat", "fruit"] as const) {
    if (needed <= 0) break;
    const take = Math.min(state.stock[key], needed);
    state.stock[key] -= take;
    needed -= take;
  }
  if (needed > 0) {
    for (const c of consumers) {
      damageColonist(c, STARVATION_DAMAGE);
    }
  }
}

export function desertColonist(c: Colonist) {
  releaseResourceReservation(c);
  const mob: Mob = {
    id: randomUUID(),
    kind: "goblin",
    x: c.x,
    y: c.y,
    hp: c.maxHp,
    maxHp: c.maxHp,
    path: [],
    repathCooldown: 0,
    targetType: null,
    targetId: null,
    attackCooldownTicks: 0,
    damage: c.maxHp > 0 ? Math.max(1, Math.round(c.maxHp / 5)) : MOB_DAMAGE,
    speed: MOB_SPEED,
    range: MOB_ATTACK_RANGE,
    melee: true,
    lastDamagedTick: 0,
    healCooldownTicks: 0,
    isDeserter: true,
    deserterActive: false,
    deserterSinceTick: state.cycleTick,
    siteId: null,
    siteKind: null,
    guardianActive: false,
    groupId: null,
    passive: false,
    ...MOB_MARK_DEFAULTS,
  };
  mobs.set(mob.id, mob);
  colonists.delete(c.id);
}

export function applyMoraleCheck() {
  if (state.colonyHappiness < HAPPINESS_MUTINY_THRESHOLD) {
    for (const c of Array.from(colonists.values())) {
      if (isSoldierKind(c.kind)) desertColonist(c);
    }
  } else if (state.colonyHappiness < HAPPINESS_DESERTION_THRESHOLD) {
    for (const c of Array.from(colonists.values())) {
      if (isSoldierKind(c.kind) && Math.random() < HAPPINESS_DESERTION_CHANCE) desertColonist(c);
    }
  }
}

export function planRouteToNearestResource(
  c: Colonist,
  resourceTile: TileType
): { path: TileCoord[]; resX: number; resY: number } | null {
  const spots: TileCoord[] = [];
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      if (state.tiles[tileIndex(tx, ty)] === resourceTile && !reservedResourceTiles.has(resourceKey(tx, ty))) {
        spots.push({ x: tx, y: ty });
      }
    }
  }
  spots.sort((a, b) => {
    const da = (a.x - c.x / TILE_SIZE) ** 2 + (a.y - c.y / TILE_SIZE) ** 2;
    const db = (b.x - c.x / TILE_SIZE) ** 2 + (b.y - c.y / TILE_SIZE) ** 2;
    return da - db;
  });

  const start = tileOfPixel(c.x, c.y);
  for (const spot of spots) {
    const approach = findAdjacentWalkable(spot.x, spot.y);
    if (!approach) continue;
    const path = findPath(start, approach);
    if (path) return { path, resX: spot.x, resY: spot.y };
  }
  return null;
}

export function updateStationaryMiner(c: Colonist, dt: number) {
  c.state = "mining";
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    depositGatheredResource(c.kind);
    c.chopTicksRemaining = effectiveChopTicks(c.postX, c.postY);
  }
}
export function updateFarmer(c: Colonist, dt: number) {
  if (c.farmPlotKey) {
    const plotTile = keyToTile(c.farmPlotKey);
    if (!plotTile || !farmPlots.has(c.farmPlotKey)) {
      c.farmPlotKey = null;
      c.state = "idle";
      return;
    }
    if (c.path.length > 0) {
      c.state = "idle";
      advanceAlongPath(c, dt, COLONIST_SPEED);
      return;
    }
    c.state = "farming";
    if ((c.farmDwellTicks ?? 0) <= 0) c.farmDwellTicks = FARMER_PLOT_DWELL_TICKS;
    if (--c.farmDwellTicks! <= 0) {
      c.farmPlotKey = null;
      c.state = "idle";
    }
    return;
  }
  c.state = "idle";
  if (c.idleCooldown > 0) {
    c.idleCooldown--;
    return;
  }
  const keys: string[] = [];
  for (const [key, plot] of farmPlots) if (plot.barnX === c.postX && plot.barnY === c.postY) keys.push(key);
  if (keys.length === 0) {
    c.farmTouring = false;
    return;
  }
  keys.sort();
  const start = tileOfPixel(c.x, c.y);
  for (let i = 0; i < keys.length; i++) {
    const idx = ((c.farmNextIdx ?? 0) + i) % keys.length;
    const tile = keyToTile(keys[idx]);
    const path = tile ? findPath(start, tile) : null;
    if (!tile || !path) continue;
    c.farmNextIdx = idx + 1;
    c.farmPlotKey = keys[idx];
    c.farmTouring = true;
    c.farmDwellTicks = 0;
    c.path = path;
    return;
  }
  c.farmTouring = false;
  c.idleCooldown = BUILDER_IDLE_RETRY_TICKS * 5; // none reachable: stay at the barn, retry later
}

// chopTicksRemaining counts down the current FARMHAND_CYCLE_TICKS cycle, one tick per tick of tending
// (daytime only: farmhands shelter at night), and the whole batch lands when it runs out.
export function updateFarmhand(c: Colonist) {
  const resource = FARM_PRODUCE_BY_TILE[state.tiles[tileIndex(c.postX, c.postY)] as TileType];
  if (!resource) return;
  c.state = "farming";
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    state.stock[resource] += FARMHAND_YIELD_PER_CYCLE[resource];
    c.chopTicksRemaining = effectiveFarmhandCycleTicks(c.postX, c.postY);
    c.cycleTicksTotal = c.chopTicksRemaining;
  }
}

export function updateArtisan(c: Colonist) {
  const recipe = CRAFT_RECIPES[state.tiles[tileIndex(c.postX, c.postY)] as TileType];
  if (!recipe) return;
  c.state = "crafting";
  const inputsReady = Object.entries(recipe.inputs).every(
    ([key, amount]) => state.stock[key as ResourceKey] >= (amount ?? 0)
  );
  if (!inputsReady) return; // don't tick the timer down while waiting on materials
  if (recipe.stockCap !== undefined && state.stock[recipe.output] >= recipe.stockCap) return; // enough in store
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    for (const [key, amount] of Object.entries(recipe.inputs)) {
      state.stock[key as ResourceKey] -= amount ?? 0;
    }
    state.stock[recipe.output] += recipe.outputAmount ?? 1;
    c.chopTicksRemaining = effectiveCraftTicks(c.postX, c.postY);
  }
}

export function updateGathererColonist(c: Colonist, dt: number) {
  const resourceTile = GATHER_RESOURCE_TILE[c.kind]!;
  switch (c.state) {
    case "idle": {
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        break;
      }
      const route = planRouteToNearestResource(c, resourceTile);
      if (route) {
        c.path = route.path;
        c.targetResourceX = route.resX;
        c.targetResourceY = route.resY;
        reservedResourceTiles.set(resourceKey(route.resX, route.resY), c.id);
        c.state = "toResource";
      } else {
        c.idleCooldown = IDLE_RETRY_TICKS;
      }
      break;
    }
    case "toResource": {
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) {
        c.state = "gathering";
        c.chopTicksRemaining = effectiveChopTicks(c.postX, c.postY);
      }
      break;
    }
    case "gathering": {
      c.chopTicksRemaining--;
      if (c.chopTicksRemaining <= 0) {
        const idx = tileIndex(c.targetResourceX, c.targetResourceY);
        if (c.kind === "lumberjack" && state.tiles[idx] === resourceTile) {
          state.tiles[idx] = TileType.Empty;
          broadcastTileUpdate(c.targetResourceX, c.targetResourceY, TileType.Empty);
        }
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
        const approach = findAdjacentWalkable(c.postX, c.postY);
        const start = tileOfPixel(c.x, c.y);
        const path = approach ? findPath(start, approach) : null;
        c.path = path ?? [];
        c.state = "toPost";
      }
      break;
    }
    case "toPost": {
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) {
        depositGatheredResource(c.kind);
        c.state = "idle";
      }
      break;
    }
    default: {
      c.state = "idle";
      break;
    }
  }
}

export function anyBuilderAlive(): boolean {
  for (const c of colonists.values()) if (c.kind === "builder") return true;
  return false;
}

export function siteBuilderCount(key: string, onlyWorking = false): number {
  let n = 0;
  for (const c of colonists.values()) {
    if (c.buildSiteKey === key && (!onlyWorking || c.state === "building")) n++;
  }
  return n;
}

// Progress a builder adds per tick (a site needs `totalTicks` of it): happiness and the Town Center
// bonus, plus its Guild's level and industrial synergy for a Guild builder.
export function builderRate(c: Colonist): number {
  let rate = productionSpeedMultiplier();
  if (state.tiles[tileIndex(c.postX, c.postY)] === TileType.BuildersGuild) {
    rate *= (1 + levelBonus(getBuildingLevel(c.postX, c.postY))) * industrialSynergyMultiplier(c.postX, c.postY);
  }
  return rate;
}

export function planBuildSite(c: Colonist): { key: string; path: TileCoord[] } | null {
  const candidates: { key: string; site: ConstructionSiteState; d: number; n: number }[] = [];
  for (const [key, site] of constructionSites) {
    const n = siteBuilderCount(key);
    if (n >= BUILDER_MAX_PER_SITE) continue;
    const center = tileToPixelCenter({ x: site.tx, y: site.ty });
    candidates.push({ key, site, d: Math.hypot(center.x - c.x, center.y - c.y), n });
  }
  // Spread out: the site with the fewest builders already on it first, ties nearest.
  candidates.sort((p, q) => p.n - q.n || p.d - q.d);
  const start = tileOfPixel(c.x, c.y);
  for (const { key, site } of candidates.slice(0, BUILDER_ROUTE_CANDIDATES)) {
    const center = tileToPixelCenter({ x: site.tx, y: site.ty });
    if (Math.hypot(center.x - c.x, center.y - c.y) <= BUILDER_WORK_RANGE_PX) return { key, path: [] };
    const approach = findAdjacentWalkable(site.tx, site.ty);
    if (!approach) continue;
    const path = findPath(start, approach);
    if (path) return { key, path };
  }
  return null;
}

export function updateBuilder(c: Colonist, dt: number) {
  // Its Town Center fell: report to the nearest one still standing.
  if (!isValidPostTile("builder", state.tiles[tileIndex(c.postX, c.postY)] as TileType)) {
    const tc = nearestTownCenter(c.x, c.y);
    if (tc) {
      c.postX = tc.x;
      c.postY = tc.y;
    }
  }
  const site = c.buildSiteKey ? constructionSites.get(c.buildSiteKey) : undefined;
  if (c.buildSiteKey && !site) {
    // Finished, or demolished under it.
    c.buildSiteKey = null;
    c.path = [];
    c.state = "idle";
  }
  switch (c.state) {
    case "carrying": {
      if (!site) return;
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length > 0) return;
      const center = tileToPixelCenter({ x: site.tx, y: site.ty });
      if (Math.hypot(center.x - c.x, center.y - c.y) <= BUILDER_WORK_RANGE_PX) {
        c.state = "building";
      } else {
        c.buildSiteKey = null;
        c.state = "idle";
        c.idleCooldown = BUILDER_IDLE_RETRY_TICKS;
      }
      return;
    }
    case "building":
      if (site) site.progress += builderRate(c);
      return;
    case "toRepair":
    case "repairing":
      if (updateRepair(c, dt)) return;
      break;
    case "toPost":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) c.state = "idle";
      // Keep looking for work on the way home.
      if (c.idleCooldown > 0) c.idleCooldown--;
      if (c.idleCooldown > 0) return;
      break;
    default:
      c.state = "idle";
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        return;
      }
  }
  c.idleCooldown = BUILDER_IDLE_RETRY_TICKS;
  const plan = planBuildSite(c);
  if (plan) {
    c.buildSiteKey = plan.key;
    c.path = plan.path;
    c.state = "carrying";
    return;
  }
  // Nothing to build: repair (manual requests first, then the most damaged building).
  const repair = planRepair(c);
  if (repair) {
    c.repairKey = repair.key;
    c.path = repair.path;
    c.state = "toRepair";
    return;
  }
  if (c.state === "toPost") return;
  const post = tileToPixelCenter({ x: c.postX, y: c.postY });
  if (Math.hypot(post.x - c.x, post.y - c.y) > TILE_SIZE * 1.6) {
    const approach = findAdjacentWalkable(c.postX, c.postY);
    const path = approach ? findPath(tileOfPixel(c.x, c.y), approach) : null;
    if (path && path.length > 0) {
      c.path = path;
      c.state = "toPost";
    }
  }
}

export function announceRepairShort() {
  if (state.cycleTick - state.lastRepairShortToastTick < REPAIR_SHORT_TOAST_TICKS && state.cycleTick >= state.lastRepairShortToastTick) return;
  state.lastRepairShortToastTick = state.cycleTick;
  broadcastEvent("build", "Not enough materials to repair");
}

// Materials for `hp` HP of repair at a tile: REPAIR_COST_FRACTION of the building's placement cost
// (times its level) pro rata to hp / max HP, each resource rounded up.
export function repairCost(tx: number, ty: number, hp: number): Cost {
  const s = structureHp(tx, ty);
  if (!s || hp <= 0) return {};
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  const base = placementCost(upgradePlacementTile(t) ?? t, TileType.Empty, tx, ty);
  const fraction = REPAIR_COST_FRACTION * currentBuildingLevel(tx, ty, t) * Math.min(1, hp / s.max);
  const cost: Cost = {};
  for (const [key, amount] of Object.entries(base)) {
    if (amount) cost[key as ResourceKey] = Math.ceil(amount * fraction - 1e-9);
  }
  return cost;
}

// HP still to be paid for before the building at a tile is back to full.
export function unpaidRepairHp(tx: number, ty: number): number {
  const s = structureHp(tx, ty);
  return s ? Math.max(0, s.max - s.hp - (repairPaid.get(resourceKey(tx, ty)) ?? 0)) : 0;
}

export function mobNearTile(tile: TileCoord, rangeTiles: number): boolean {
  const c = tileToPixelCenter(tile);
  const r = rangeTiles * TILE_SIZE;
  for (const m of mobs.values()) {
    if (isDormantGuardian(m) || m.passive || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - c.x, m.y - c.y) <= r) return true;
  }
  return false;
}

export function repairBuilderCount(key: string): number {
  let n = 0;
  for (const c of colonists.values()) if (c.repairKey === key) n++;
  return n;
}

// The repair job for an idle builder: manual Repair requests first (in request order), then the most
// damaged building (lowest HP fraction). Skips jobs with a mob nearby, full crews, unaffordable ones
// (announced) and unreachable ones.
export function planRepair(c: Colonist): { key: string; path: TileCoord[] } | null {
  // Drop manual requests for buildings that are gone or already back to full.
  for (let i = repairQueue.length - 1; i >= 0; i--) {
    const tile = keyToTile(repairQueue[i]);
    const s = tile ? structureHp(tile.x, tile.y) : null;
    if (!s || s.hp >= s.max) repairQueue.splice(i, 1);
  }
  const jobs: { key: string; tile: TileCoord; rank: number; n: number }[] = repairQueue.map((key, i) => ({ key, tile: keyToTile(key)!, rank: i - repairQueue.length, n: 0 }));
  const auto = Array.from(buildingHp.keys()).concat(state.townCenters.map((tc) => resourceKey(tc.x, tc.y)));
  for (const key of auto) {
    if (repairQueue.includes(key)) continue;
    const tile = keyToTile(key);
    // Forts phase A: builders never repair an NPC site's buildings.
    if (tile && ownerAt(tileIndex(tile.x, tile.y)) !== 0) continue;
    const s = tile ? structureHp(tile.x, tile.y) : null;
    if (tile && s && s.hp < s.max) jobs.push({ key, tile, rank: s.hp / s.max, n: 0 });
  }
  for (const job of jobs) job.n = repairBuilderCount(job.key);
  // Spread out: fewest builders already assigned first, then manual requests / lowest HP fraction.
  jobs.sort((p, q) => p.n - q.n || p.rank - q.rank);
  const start = tileOfPixel(c.x, c.y);
  let tried = 0;
  let short = false;
  for (const job of jobs) {
    if (tried >= BUILDER_ROUTE_CANDIDATES) break;
    if (job.n >= BUILDER_MAX_PER_SITE || mobNearTile(job.tile, REPAIR_MOB_CLEARANCE_TILES)) continue;
    if (!canAfford(repairCost(job.tile.x, job.tile.y, unpaidRepairHp(job.tile.x, job.tile.y)))) {
      short = true;
      continue;
    }
    tried++;
    const center = tileToPixelCenter(job.tile);
    if (Math.hypot(center.x - c.x, center.y - c.y) <= BUILDER_WORK_RANGE_PX) return { key: job.key, path: [] };
    const approach = findAdjacentWalkable(job.tile.x, job.tile.y);
    const path = approach ? findPath(start, approach) : null;
    if (path) return { key: job.key, path };
  }
  if (short) announceRepairShort();
  return null;
}

// A builder's "toRepair" (walking) / "repairing" (healing) step. False when the job ended this tick
// and the builder should look for new work right away.
export function updateRepair(c: Colonist, dt: number): boolean {
  const key = c.repairKey ?? null;
  const tile = key ? keyToTile(key) : null;
  const s = tile ? structureHp(tile.x, tile.y) : null;
  const endJob = () => {
    c.repairKey = null;
    c.path = [];
    c.state = "idle";
  };
  if (!key || !tile || !s || s.hp >= s.max || mobNearTile(tile, REPAIR_MOB_CLEARANCE_TILES)) {
    endJob();
    return false;
  }
  if (c.state === "toRepair") {
    advanceAlongPath(c, dt, COLONIST_SPEED);
    if (c.path.length > 0) return true;
    const center = tileToPixelCenter(tile);
    if (Math.hypot(center.x - c.x, center.y - c.y) > BUILDER_WORK_RANGE_PX) {
      endJob();
      c.idleCooldown = BUILDER_IDLE_RETRY_TICKS;
      return true;
    }
    c.state = "repairing";
    return true;
  }
  // Construction comes first: a newly opened site pulls the builder off its repair (paid HP is kept).
  if (state.cycleTick % BUILDER_IDLE_RETRY_TICKS === 0) {
    const plan = planBuildSite(c);
    if (plan) {
      endJob();
      c.buildSiteKey = plan.key;
      c.path = plan.path;
      c.state = "carrying";
      return true;
    }
  }
  const missing = s.max - s.hp;
  let paid = repairPaid.get(key) ?? 0;
  if (paid <= 1e-6) {
    const cost = repairCost(tile.x, tile.y, missing);
    if (!canAfford(cost)) {
      announceRepairShort();
      endJob();
      c.idleCooldown = BUILDER_IDLE_RETRY_TICKS;
      return true;
    }
    spend(cost);
    paid = missing;
  }
  const heal = Math.min(paid, missing, (s.max / (REPAIR_SECONDS_FULL * TICK_RATE)) * builderRate(c));
  healStructure(tile.x, tile.y, heal);
  paid -= heal;
  if (heal >= missing - 1e-6) {
    repairPaid.delete(key);
    const queued = repairQueue.indexOf(key);
    if (queued >= 0) repairQueue.splice(queued, 1);
    endJob();
    return true;
  }
  if (paid > 1e-6) repairPaid.set(key, paid);
  else repairPaid.delete(key);
  return true;
}

// Manual Repair (building info panel): pays for the missing HP now and puts the building at the front
// of the builders' repair work (served by day, like all builder work).
export function handleRepairBuilding(player: Player, tx: number, ty: number) {
  if (player.dead || (inBounds(tx, ty) && ownerAt(tileIndex(tx, ty)) !== 0)) return;
  const s = structureHp(tx, ty);
  const key = resourceKey(tx, ty);
  if (!s || s.hp >= s.max || repairQueue.includes(key)) return;
  const unpaid = unpaidRepairHp(tx, ty);
  if (unpaid > 0) {
    const cost = repairCost(tx, ty, unpaid);
    if (!canAfford(cost)) {
      sendEvent(player, "build", "Not enough materials to repair");
      return;
    }
    spend(cost);
    repairPaid.set(key, (repairPaid.get(key) ?? 0) + unpaid);
  }
  repairQueue.push(key);
}

export function houseCapacity(t: TileType): number {
  return t === TileType.HouseLevel2 ? 5 : t === TileType.BigHouse ? 3 : t === TileType.House ? 1 : 0;
}

export function houseOccupancy(tx: number, ty: number): number {
  let n = 0;
  for (const o of colonists.values()) {
    if (o.shelterAssigned && o.homeTileX === tx && o.homeTileY === ty) n++;
  }
  return n;
}

// Each civilian sleeps in the nearest house with a free bed; anyone left over (or with no house
// at all) uses the nearest standing Town Center (with none, they just wait where they are). Beds are a house's tier capacity (1 / 3 / 5).
export function assignShelter(c: Colonist) {
  c.shelterAssigned = true;
  c.homeTileX = -1;
  c.homeTileY = -1;
  let bestD = Infinity;
  for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
      const cap = houseCapacity(state.tiles[tileIndex(tx, ty)] as TileType);
      if (cap === 0) continue;
      const center = tileToPixelCenter({ x: tx, y: ty });
      const d = Math.hypot(c.x - center.x, c.y - center.y);
      if (d >= bestD) continue;
      if (houseOccupancy(tx, ty) >= cap) continue;
      bestD = d;
      c.homeTileX = tx;
      c.homeTileY = ty;
    }
  }
}

export function shelterTileFor(c: Colonist): TileCoord | null {
  return c.homeTileX >= 0 ? { x: c.homeTileX, y: c.homeTileY } : nearestTownCenter(c.x, c.y);
}

export function isAtShelter(c: Colonist): boolean {
  if (!c.sheltering || !c.shelterAssigned) return false;
  const shelter = shelterTileFor(c);
  if (!shelter) return false;
  const center = tileToPixelCenter(shelter);
  return Math.hypot(c.x - center.x, c.y - center.y) <= TILE_SIZE * 1.5;
}

export function updateShelteringCivilian(c: Colonist, dt: number) {
  // (Re)assign on first night tick, and if the house was demolished or replaced mid-night.
  if (!c.shelterAssigned || (c.homeTileX >= 0 && houseCapacity(state.tiles[tileIndex(c.homeTileX, c.homeTileY)] as TileType) === 0)) {
    assignShelter(c);
    c.path = [];
  }
  const target = shelterTileFor(c);
  if (!target) return;
  const center = tileToPixelCenter(target);
  const dist = Math.hypot(c.x - center.x, c.y - center.y);
  if (dist > TILE_SIZE * 1.5) {
    if (c.path.length === 0) {
      const approach = findAdjacentWalkable(target.x, target.y);
      const start = tileOfPixel(c.x, c.y);
      const path = approach ? findPath(start, approach) : null;
      c.path = path ?? [];
      if (c.path.length === 0 && c.homeTileX >= 0) {
        // Can't reach the house: fall back to the Town Center.
        c.homeTileX = -1;
        c.homeTileY = -1;
        return;
      }
    }
    advanceAlongPath(c, dt, COLONIST_SPEED);
  }
}

export function updateStationaryWorkerReturning(c: Colonist, dt: number) {
  const postCenter = tileToPixelCenter({ x: c.postX, y: c.postY });
  if (c.path.length > 0) {
    advanceAlongPath(c, dt, COLONIST_SPEED);
    return;
  }
  const dist = Math.hypot(c.x - postCenter.x, c.y - postCenter.y);
  if (dist <= 2) return;
  if (dist > TILE_SIZE * 1.2) {
    const approach = findAdjacentWalkable(c.postX, c.postY);
    const start = tileOfPixel(c.x, c.y);
    const path = approach ? findPath(start, approach) : null;
    c.path = path ?? [];
    if (c.path.length > 0) advanceAlongPath(c, dt, COLONIST_SPEED);
  } else {
    const ddx = postCenter.x - c.x;
    const ddy = postCenter.y - c.y;
    const step = COLONIST_SPEED * biomeSpeedMultiplier(c.x, c.y) * roadSpeedMultiplier(c.x, c.y) * dt;
    if (dist <= step) {
      c.x = postCenter.x;
      c.y = postCenter.y;
    } else {
      c.x += (ddx / dist) * step;
      c.y += (ddy / dist) * step;
    }
  }
}

export function isWardPriest(c: Colonist): boolean {
  return c.id === state.wardPriestId;
}

export function tilesOfType(type: TileType): TileCoord[] {
  const found: TileCoord[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === type) found.push({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) });
  }
  return found;
}

// Least-recently tended first (never-tended counts as oldest), nearest breaks ties.
export function nextWardStoneFor(c: Colonist, stones: TileCoord[], skip: TileCoord | null = null): TileCoord | null {
  let best: TileCoord | null = null;
  let bestTended = Infinity;
  let bestDist = Infinity;
  for (const s of stones) {
    if (skip && s.x === skip.x && s.y === skip.y) continue;
    const tended = wardStoneLastTended.get(resourceKey(s.x, s.y)) ?? -Infinity;
    const center = tileToPixelCenter(s);
    const d = Math.hypot(c.x - center.x, c.y - center.y);
    if (tended < bestTended || (tended === bestTended && d < bestDist)) {
      best = s;
      bestTended = tended;
      bestDist = d;
    }
  }
  return best;
}

export function assignWardPriestTarget(c: Colonist, stone: TileCoord) {
  c.postX = stone.x;
  c.postY = stone.y;
  c.rallyTileX = stone.x;
  c.rallyTileY = stone.y;
  const center = tileToPixelCenter(stone);
  c.rallyX = center.x;
  c.rallyY = center.y;
  c.path = [];
  state.wardPriestTendTicks = 0;
}

// Once per tick: forget tend records of demolished stones, then keep exactly one Ward Priest alive
// while a Church and at least one Ward Stone exist (dismissed otherwise). A first priest, or one
// re-summoned after a dismissal, appears at once; one that died waits for the next dawn/dusk respawn
// window and pays RESPAWN_FOOD_COST, matching processRespawnQueue.
export function updateWardPriestPresence() {
  for (const key of wardStoneLastTended.keys()) {
    const [tx, ty] = key.split(",").map(Number);
    if (state.tiles[tileIndex(tx, ty)] !== TileType.WardStone) wardStoneLastTended.delete(key);
  }
  const stones = tilesOfType(TileType.WardStone);
  const church = tilesOfType(TileType.ChurchPost)[0] ?? null;
  const priest = state.wardPriestId ? colonists.get(state.wardPriestId) : undefined;
  if (state.wardPriestId && !priest) {
    state.wardPriestId = null;
    // >= 0 = died, due back at a respawn window (0 since the windows; old saves may hold a countdown).
    state.wardPriestRespawnTicks = 0;
  }
  state.wardPriestAwaitingWindow = false;
  if (priest && (stones.length === 0 || !church)) {
    colonists.delete(priest.id);
    state.wardPriestId = null;
    return;
  }
  if (priest || stones.length === 0 || !church) return;
  state.wardPriestAwaitingWindow = state.wardPriestRespawnTicks >= 0;
  if (settlementBlocker(church.x, church.y) !== "") return;
  if (state.wardPriestRespawnTicks >= 0) {
    if (isNightNow() || !respawnWindowAt(state.cycleTick) || !trySpendFood(RESPAWN_FOOD_COST)) return;
    state.wardPriestAwaitingWindow = false;
    state.respawnWindowSpawned++;
  }
  const spawned = spawnColonistForPost(church.x, church.y, "bishop");
  state.wardPriestId = spawned.id;
  state.wardPriestRespawnTicks = -1;
  assignWardPriestTarget(spawned, nextWardStoneFor(spawned, stones)!);
}

export function updateWardPriest(c: Colonist, dt: number) {
  if (state.tiles[tileIndex(c.postX, c.postY)] !== TileType.WardStone) {
    const next = nextWardStoneFor(c, tilesOfType(TileType.WardStone));
    if (!next) {
      c.state = "idle";
      return;
    }
    assignWardPriestTarget(c, next);
  }
  const post = tileToPixelCenter({ x: c.postX, y: c.postY });
  if (Math.hypot(c.x - post.x, c.y - post.y) > GARRISON_LOITER_PX) {
    returnToRally(c, dt, BISHOP_SPEED);
    if (c.state === "returning") {
      c.state = "patrolling";
    } else if (c.state === "idle") {
      // No path to this stone (walled in): try another rather than stalling here forever.
      const other = nextWardStoneFor(c, tilesOfType(TileType.WardStone), { x: c.postX, y: c.postY });
      if (other) assignWardPriestTarget(c, other);
    }
    return;
  }
  c.path = [];
  c.state = "warding";
  state.wardPriestTendTicks++;
  if (state.wardPriestTendTicks < WARD_TEND_TICKS) return;
  wardStoneLastTended.set(resourceKey(c.postX, c.postY), state.cycleTick);
  const next = nextWardStoneFor(c, tilesOfType(TileType.WardStone));
  if (!next) return;
  if (next.x !== c.postX || next.y !== c.postY) c.state = "patrolling";
  assignWardPriestTarget(c, next);
}

// Every position currently under a ward: the Abbey (always) plus each Ward Stone the Ward Priest
// finished tending within the last WARD_GRACE_TICKS.
export function activeWardSources(): TileCoord[] {
  const sources: TileCoord[] = state.abbeyCenter ? [state.abbeyCenter] : [];
  for (const [key, tended] of wardStoneLastTended) {
    if (state.cycleTick - tended > WARD_GRACE_TICKS) continue;
    const [tx, ty] = key.split(",").map(Number);
    if (state.tiles[tileIndex(tx, ty)] === TileType.WardStone) sources.push({ x: tx, y: ty });
  }
  return sources;
}

export function isWarded(px: number, py: number, sources: TileCoord[]): boolean {
  const radiusPx = WARD_RADIUS_TILES * TILE_SIZE;
  return sources.some((s) => {
    const center = tileToPixelCenter(s);
    return Math.hypot(px - center.x, py - center.y) <= radiusPx;
  });
}

// Once per tick: any Ward Stone whose ward was up last tick and is down now has just lapsed, and a
// Half-Latch slips through at the stone. A stone that stays lapsed tick after tick triggers nothing
// more; it only re-arms once the Ward Priest tends it again. A stone that was
// demolished (no longer a WardStone tile) was removed, not left to lapse, so it spawns nothing.
export function checkWardStoneLapses() {
  const activeNow = new Set<string>();
  for (const s of activeWardSources()) {
    if (state.tiles[tileIndex(s.x, s.y)] === TileType.WardStone) activeNow.add(resourceKey(s.x, s.y));
  }
  for (const key of wardStonesActiveLastTick) {
    if (activeNow.has(key)) continue;
    const [tx, ty] = key.split(",").map(Number);
    if (state.tiles[tileIndex(tx, ty)] === TileType.WardStone) {
      spawnHalfLatch({ x: tx, y: ty });
      broadcastEvent("ward", "A Ward Stone's ward has lapsed — something slipped through");
    }
  }
  wardStonesActiveLastTick.clear();
  for (const key of activeNow) wardStonesActiveLastTick.add(key);
}

// Same Mob shape as createRaidMob/spawnGuardian, but no siteId: never dormant, it seeks a target via
// pickMobTarget on its very first updateMob.
export function spawnHalfLatch(tile: TileCoord) {
  const config = MOB_KIND_CONFIG.halfLatch;
  const center = tileToPixelCenter(tile);
  const mob: Mob = {
    id: randomUUID(),
    kind: "halfLatch",
    x: center.x,
    y: center.y,
    hp: config.maxHp,
    maxHp: config.maxHp,
    path: [],
    repathCooldown: 0,
    targetType: null,
    targetId: null,
    attackCooldownTicks: 0,
    damage: config.damage,
    speed: config.speed,
    range: config.range,
    melee: config.melee,
    lastDamagedTick: 0,
    healCooldownTicks: 0,
    isDeserter: false,
    deserterActive: false,
    deserterSinceTick: 0,
    siteId: null,
    siteKind: null,
    guardianActive: false,
    groupId: null,
    passive: false,
    ...MOB_MARK_DEFAULTS,
  };
  mobs.set(mob.id, mob);
}

export function updateColonist(c: Colonist, dt: number) {
  if (c.poisonTicksRemaining > 0) {
    c.poisonTicksRemaining--;
    // Tick once per second of poison, not every game tick (TICK_RATE=20/s) — a flat per-tick
    // amount would multiply the intended "light bleed" into a far heavier DPS than designed.
    if (c.poisonTicksRemaining % TICK_RATE === 0) {
      damageColonist(c, c.poisonDamagePerTick);
    }
    if (!colonists.has(c.id)) return;
  }

  if (isCivilianKind(c.kind)) {
    const night = isNightNow();
    const stationaryWorker = isStationaryWorkerKind(c.kind);
    if (night && !c.sheltering) {
      c.sheltering = true;
      if (!stationaryWorker) {
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
      }
      // Always reset display state to "idle" when sheltering starts, stationary or not: this
      // field drives the client's walk-vs-action animation choice, and a stationary worker's
      // leftover work state (e.g. "mining") is in COLONIST_ACTION_STATES, so leaving it set
      // made them play their static work pose the whole walk home instead of a walk animation -
      // looked exactly like they weren't actually heading to the Town Center.
      c.state = "idle";
      c.path = [];
      c.farmPlotKey = null;
      c.farmTouring = false;
    } else if (!night && c.sheltering) {
      c.sheltering = false;
      c.shelterAssigned = false;
      c.homeTileX = -1;
      c.homeTileY = -1;
      c.path = [];
    }
    if (c.sheltering) {
      updateShelteringCivilian(c, dt);
      return;
    }
    if (stationaryWorker) {
      const postCenter = tileToPixelCenter({ x: c.postX, y: c.postY });
      const distToPost = Math.hypot(c.x - postCenter.x, c.y - postCenter.y);
      if (!c.farmTouring && (c.path.length > 0 || distToPost > 2)) {
        updateStationaryWorkerReturning(c, dt);
        return;
      }
    }
  }

  switch (c.kind) {
    case "lumberjack":
      updateGathererColonist(c, dt);
      break;
    case "ironMiner":
    case "rockMiner":
      updateStationaryMiner(c, dt);
      break;
    case "farmhand":
      updateFarmhand(c);
      break;
    case "artisan":
      updateArtisan(c);
      break;
    case "farmer":
      updateFarmer(c, dt);
      break;
    case "hunter":
      updateHunter(c, dt);
      break;
    case "forager":
      updateForager(c, dt);
      break;
    case "builder":
      updateBuilder(c, dt);
      break;
    case "knight":
    case "cavalry":
    case "batteringRam":
    case "catapult":
    case "archer":
    case "militia":
    case "spearman":
    case "pikeman":
    case "hero":
      updateGuardColonist(c, dt);
      break;
    case "bishop":
      if (isWardPriest(c)) updateWardPriest(c, dt);
      else updateBishopColonist(c, dt);
      break;
  }
}
