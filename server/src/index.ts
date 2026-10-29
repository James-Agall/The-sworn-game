import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promises as fsp, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  TileType, type Stance, type ArmyOrderKind, TILE_SIZE, type ArmyOrder, ARMY_ORDER_QUEUE_MAX, TICK_RATE,
  FORMATION_SHAPES, type FormationShape, type ArmyOrderGroupSnapshot, type MobKind, type SiegeKind, SIEGE_KINDS,
  HungerMark, Biome, type BossTier, bossTitle, VISION_RADIUS_PLAYER, VISION_RADIUS_COLONIST, VISION_RADIUS_BUILDING,
  VISION_RADIUS_START, type ServerMessage, type GameEventCategory, type WildlifeKind, WILDLIFE_KINDS, COLONIST_ROLE,
  MOB_ROLE, type ColonistKind, type EquipSlot, HERO_CLASSES, type HeroClass, type SaveSlot, SAVE_SLOTS,
  type SaveInfo, PLAYER_MAX_HP, type ClientMessage, TIME_SCALES, type Equipment, GEAR_SLOTS, type HeroStats,
  type ItemStats, type GearItem, SPELL_SLOT_COUNT, type HeroProfileSnapshot, type GearSlot, type ItemSlotKind,
  type HeroSheetSnapshot, type BuildingInfo, HERO_CLASS_LABEL, type SpellId, SPELL_IDS, type SpellBookSnapshot,
  SPELLS, unitRole, type FightKind, FIGHT_CLUSTER_TILES, FIGHT_WINDOW_SECONDS, type FightSnapshot,
  FIGHT_RELEVANCE_TILES, FIGHT_MAX_PER_PLAYER, PLAYER_SPEED, PLAYER_HALF_SIZE, type EnemyRegimentSnapshot,
  ENEMY_CELL_TILES, type CombatRole, type PlayerSnapshot, type ColonistSnapshot, type MobSnapshot,
  type TownCenterSnapshot, ENEMY_REGIMENT_REFRESH_TICKS, WILDLIFE_SNAPSHOT_STRIDE,
} from "@colony/shared/protocol";
import { planOrderFormation } from "@colony/shared/formation";
import type {
  ActiveFight, AttackObjective, Colonist, Cost, EnemyUnit, FightHit, FriendlyUnit, GoalDef, HearthState, HeroProfile,
  HeroRecruit, Mob, MobTargetType, OrderGroup, Player, PlayerMoraleState, PoiSiteKind, RaidEdge, RaidFactionEntry,
  RaidFactionId, RaidFormationShape, RaidGroup, RegimentState, ResourceKey, SaveFile, SpellCaster, SpellStatus,
  SpellTarget, TileCoord, Wildlife, WorldState,
} from "./types.js";
import {
  ABBEY_CLERGY_OFFSETS, ABBEY_FOOTPRINT_RADIUS, ABBEY_GROUNDS_RADIUS, ABBEY_LAYOUT, ABBEY_LAYOUT_TILES,
  ABBEY_MIN_SPAWN_DIST, ARMOUR_DAMAGE_TAKEN_MULT, ARMY_ORDER_KINDS, ARMY_REGIMENT_REFRESH_TICKS,
  ATTACK_MOVE_RESUME_TICKS, AUTOSAVE_ENABLED, BARN_FARM_RADIUS_TILES, BARN_MAX_FARM_PLOTS, BIOME_EDGE_JITTER_TILES,
  BIOME_NOISE_CELL_TILES, BIOME_SEED_MIN_SPACING, BIOME_SEED_RADIUS_MAX, BIOME_SEED_RADIUS_MIN, BOSS_EQUIP_LOOT,
  BREACH_WALL_COST, BUILDING_HP_BIG, CASTLE_RUIN_FOOTPRINT_RADIUS, CASTLE_RUIN_GROUNDS_RADIUS,
  CASTLE_RUIN_GUARDIANS_MAX, CASTLE_RUIN_GUARDIANS_MIN, CASTLE_RUIN_GUARDIAN_WEIGHTS, CASTLE_RUIN_LAYOUT,
  CASTLE_RUIN_LAYOUT_TILES, CASTLE_RUIN_SPAWN_DIST_FRACTIONS, CATAPULT_BUILDING_MULT, CATAPULT_MIN_RANGE,
  CATAPULT_RANGE, CATAPULT_SPLASH_PX, CHARGE_RECHARGE_GAP_TILES, CHARGE_WITHDRAW_MAX_TICKS, CHARGE_WITHDRAW_TILES,
  CHURCH_SPELL_PRICES, COMMANDABLE_KINDS, COVER_BREACH_HP_FRACTION, COVER_ENCLOSURE_TILES, COVER_REENGAGE_RATIO,
  DAY_LENGTH_SCALE, DAY_TICKS, DESERTER_ACTIVATION_TICKS, DESERTER_WAVE_CHANCE, DIFFICULTY_TUNING,
  DUSK_RESPAWN_CYCLE_TICK, ELITE_DAMAGE_MULT, ELITE_HP_MULT, ELITE_REWARD, ENCAMPMENT_EXTRAS,
  ENCAMPMENT_GUARDIAN_WEIGHTS, ENEMY_OUTFLANKED_SHOW_TICKS, EQUIPPED_KINDS, EQUIP_ARMOURED_KINDS, EQUIP_DROP_CHANCE,
  EQUIP_LOOT_TIER_WEIGHTS, EQUIP_SLOT_LABEL, EQUIP_TIERS, EQUIP_TOAST_THROTTLE_TICKS, EXPLORED_FLUSH_TICKS,
  FARMHAND_CYCLE_TICKS, FARMHAND_YIELD_PER_CYCLE, FARM_FALLOW_TICKS, FARM_GROW_TICKS, FARM_HARVESTS_BEFORE_FALLOW,
  FARM_HARVEST_TICKS, FARM_SOWN_FRACTION, FARM_YIELD_PER_HARVEST, FIGHT_BATTLE_COMBATANTS, FIGHT_BATTLE_DPS,
  FIGHT_MAJOR_COMBATANTS, FIGHT_MAJOR_DPS, FIGHT_MAX_HITS, FIGHT_MAX_TRACKED, FIGHT_RAID_LABELS, FIGHT_SCAN_TICKS,
  FIGHT_WINDOW_TICKS, FLANK_ARC_TILES, FLANK_BEHIND_TILES, FLANK_CONTACT_TILES, FLANK_DETACH_FRACTION,
  FLANK_ENGAGE_TILES, FLANK_MAX_TICKS, FLANK_MIN_FRONT_FOR_DETACH, FLANK_WAYPOINT_REACH_PX, FOLLOW_BEHIND_TILES,
  FOLLOW_REFORM_TILES, FOOD_PER_COLONIST_PER_DAY, FORAGE_FRUIT_YIELD, FORAGE_PICKED_TO_RIPE, FORAGE_REGROW_TICKS,
  FORAGE_RIPE_TO_PICKED, FORGE_ARMOUR_IRON, FORGE_QUEUE_CAP, FORGE_TICKS, FORGE_WEAPON_IRON, FORGE_WEAPON_WOOD,
  GAME_DAY_TICKS, GOAL_WORKER_KINDS, HEARTH_AUTO_TARGET_TILES, HEARTH_DEFAULT_HP, HEARTH_LOOT_PER_GUARDIAN,
  HERO_CLASS_STATS, HERO_INVENTORY_CAP, HERO_KEY_PREFIX, HERO_LEVEL_DAMAGE_PCT, HERO_LEVEL_MAX_HP, HERO_LEVEL_XP,
  HERO_MAX_LEVEL, HERO_MAX_TOTAL, HERO_MIN_DAMAGE_TAKEN_MULT, HERO_MIN_SPEED_MULT, HERO_NAMES, HERO_POPULATION_COST,
  HERO_RECRUIT_COST, HERO_RECRUIT_TICKS, HERO_RESPAWN_FEE_BASE, HERO_RESPAWN_FEE_PER_LEVEL, HERO_XP_BOSS,
  HERO_XP_MARKED_MULT, HERO_XP_PER_KILL, HUNGER_MARK_RAIDERS_PER_MARK, LEGACY_DAY_TICKS, LEGACY_GAME_DAY_TICKS,
  LEGACY_NIGHT_TICKS, LINE_LEASH_TILES, LUMBERJACK_TREE_INTERVAL_TICKS, MAX_WORLD_SIZE, MINI_BOSS_KINDS,
  MIN_WORLD_SIZE, MOB_ATTACK_COOLDOWN_TICKS, MOB_KIND_CONFIG, MOB_MARK_DEFAULTS, MOB_REPATH_TICKS, MOB_SPEED,
  MORALE_ANCHOR_RESIST, MORALE_CASUALTY, MORALE_FRONT_LOST_PER_SEC, MORALE_LEADER_WEIGHT, MORALE_MAX,
  MORALE_OUTFLANKED_PER_SEC, MORALE_OUTNUMBERED_PER_SEC, MORALE_RALLY, MORALE_RALLY_QUIET_TICKS,
  MORALE_RECOVER_PER_SEC, MORALE_ROLE_WEIGHT, MORALE_ROUT, MORALE_WINNING_RATIO, NEIGHBORS_8, NIGHT_TICKS,
  ORDER_ARRIVE_GRACE_TICKS, ORDER_DISPATCH_MAX_SPREAD_MS, ORDER_DISPATCH_STEP_MS, ORDER_UPDATE_TICKS,
  ORDER_WIDTH_MAX_TILES, PLAIN_GEAR, PLAYER_ATTACK_COOLDOWN_TICKS, PLAYER_ATTACK_DAMAGE, PLAYER_COLORS,
  PLAYER_MORALE_ANCHOR_RESIST, PLAYER_MORALE_ANCHOR_TILES, PLAYER_MORALE_CASUALTY, PLAYER_MORALE_FRONT_LOST_PER_SEC,
  PLAYER_MORALE_GRACE_TICKS, PLAYER_MORALE_MIN_UNITS, PLAYER_MORALE_NEW_FIGHT_TICKS,
  PLAYER_MORALE_OUTFLANKED_PER_SEC, PLAYER_MORALE_OUTNUMBERED_PER_SEC, PLAYER_MORALE_RALLY,
  PLAYER_MORALE_RECOVER_PER_SEC, PLAYER_MORALE_RESIST_FLOOR, PLAYER_MORALE_ROUT, PLAYER_MORALE_SCAN_TILES,
  PLAYER_MORALE_TC_RECOVER_MULT, PLAYER_MORALE_TC_RESIST, PLAYER_MORALE_TC_TILES, PLAYER_MORALE_TOAST_COOLDOWN_TICKS,
  PLAYER_MORALE_TOWER_RESIST, PLAYER_MORALE_TOWER_TILES, PLAYER_MORALE_WALL_RESIST, PLAYER_MORALE_WALL_TILES,
  PLAYER_MORALE_WAVER, PLAYER_MORALE_WAVERING_DAMAGE, PLAYER_MORALE_WINNING_PER_SEC, PLAYER_ROUT_MAX_TICKS,
  PLAYER_ROUT_MIN_TICKS, PLAYER_ROUT_QUIET_TICKS, POI_SITE_FOOTPRINT_RADIUS, POI_SITE_MIN_SPACING,
  POI_SITE_WATER_CLEARANCE, POND_EDGE_JITTER_TILES, POND_MIN_SPACING, POND_NOISE_CELL_TILES, POND_RADIUS_MAX,
  POND_RADIUS_MIN, PORT, RAID_ARRIVAL_WINDOW_FRACTION, RAID_BASE_SIZE, RAID_CRUSHED_FRACTION, RAID_EDGE_BAND_TILES,
  RAID_ENGAGE_RANGE_TILES, RAID_FACTIONS, RAID_FOLLOWER_CATCHUP, RAID_FORMATION_SHAPE, RAID_FORMATION_SPACING_BODIES,
  RAID_GROUP_SIZE_MAX, RAID_GROUP_SIZE_MIN, RAID_HEADING_SMOOTHING, RAID_HORDE_SHARE_MAX, RAID_HORDE_SHARE_MIN,
  RAID_LEAVE_MAX_TICKS, RAID_LOITER_CHANCE_PER_TICK, RAID_LOITER_RADIUS_TILES, RAID_MARCH_REPATH_TICKS,
  RAID_MORALE_ANCHOR_RESIST, RAID_MORALE_CASUALTY, RAID_MORALE_FRONT_LOST_PER_SEC, RAID_MORALE_GRACE_TICKS,
  RAID_MORALE_OUTFLANKED_PER_SEC, RAID_MORALE_OUTNUMBERED_PER_SEC, RAID_MORALE_ROUT, RAID_REACH_BUDGET,
  RAID_REACH_RADIUS, RAID_REAR_RANK_TILES, RAID_RELEASE_ROW_TICKS, RAID_SIZE_PER_DAY, RAID_SPAWN_CYCLE_TICK,
  RAID_SPAWN_DIST_STEPS, RAID_TRAVEL_MARGIN_TICKS, RAID_TRAVEL_SLACK, RAID_WEDGE_LOOSENESS, REGIMENT_ORDER_MAX_PER_S,
  RELIC_CATALOGUE, RELIC_ELITE_MOB_CHANCE, RELIC_HEARTH_CHANCE, RESPAWN_FOOD_COST, RETREAT_TC_OFFSET_TILES,
  ROUT_SPEED_FACTOR, ROUT_TOAST_COOLDOWN_TICKS, RUIN_CENTERPIECES, RUIN_EXTRAS, RUIN_GUARDIAN_WEIGHTS, SAVE_DIR,
  SAVE_SLOT_LABELS, SAVE_VERSION, SET_VIEW_MIN_MS, SIEGE_BUILDING_MULT, SITE_KIND_HAS_HEARTH, SITE_KIND_WALLED,
  SNAPSHOT_CULL_MIN_WORLD, SNAPSHOT_VIEW_TILES, SPAWN_CLEAR_RADIUS_TILES, SPAWN_PLAINS_RADIUS_TILES,
  SPELL_AUTO_EVERY_TICKS, SPELL_AUTO_HEAL_BELOW, SPELL_AUTO_RALLY_ENGAGED, SPELL_AUTO_SUMMON_SCAN_TILES,
  SPELL_AUTO_WARD_HURT_TICKS, SPELL_GRANT_LEVELS, SPELL_LEARN_ORDER, SPELL_MAGE_BASE_PCT, SPELL_RANGE_SLACK_PX,
  SQUAD_SETTLE_TILES, STANCES, STANCE_ALERT_RANGE_TILES, STRATEGY_VIEW_MARGIN_TILES, STRATEGY_VIEW_MAX_HALF_TILES,
  STRUCTURE_TARGET_PREFIX, TACTICS_EVAL_TICKS, TACTICS_OUTNUMBERED_RATIO, TACTICS_SCAN_TILES,
  TACTICS_SPREAD_CAP_TILES, TEST_HOOKS, TICK_DURATION_SAMPLES, TOME_ELITE_CHANCE, TOME_HEARTH_CHANCE, TOWER_COSTS,
  TOWER_STATS, TREE_RESPAWN_INTERVAL_TICKS, VISION_BUILDING_TILES, WARLORD_DAMAGE_MULT, WARLORD_HP_MULT,
  WARLORD_REWARD, WEAPON_DAMAGE_MULT, clampWorldSize, dt,
} from "./constants.js";
import {
  attackerSlots, buildingHp, buildingLevel, chargeCycle, chargeRuns, colonists, commandedTargets, constructionSites,
  equipEvents, equipment, farmPlots, forageRegrow, forgeQueues, gates, gravestones, hearthEvents, hearths,
  heroEvents, heroProfiles, heroRecruits, lastHurtTick, minesPlacedOnOre, mobs, mobsWithoutRoute,
  moraleRegimentOfUnit, orderGroupOfUnit, orderGroups, ownerSiteIds, pendingRallies, playerMorale, players,
  raidGroups, regiments, repairPaid, repairQueue, reservedResourceTiles, respawnQueue, routedUnits, scaledCount,
  scaledCountSub, siegeEvents, siegeWorkshops, spellCooldowns, spellEvents, spellStatuses, state, structureBreach,
  summonedUntil, tacticsEvents, taskForceMax, taskForces, tickDurationsMs, tileOwner, towerCooldowns, towerEvents,
  walledSites, wardStoneLastTended, wardStonesActiveLastTick, wildlife,
} from "./state.js";
import {
  biomeSpeedMultiplier, clamp, clearOwners, collidesAt, getBuildingLevel, inBounds, isHostileOwner, isNightNow,
  ownerAt, resourceKey, roadSpeedMultiplier, setOwner, siteNumber, tileIndex, tileOfPixel, tileToPixelCenter,
} from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile, separateBodies } from "./pathfinding.js";
import {
  armyDamageMultiplier, farmPlotIndices, farmPlotProgress, farmStagesForSnapshot, farmhandProgress,
  handleBuyWithGold, handleExchangeResource, initialStock, releaseResourceReservation, stock, tryGrowTree,
  tryGrowTreesNearLumberjackPosts, updateFarmPlots,
} from "./economy.js";
import {
  WILDLIFE_CONFIG, WILDLIFE_RESPAWN_INTERVAL_TICKS, damageWildlife, generateForage, spawnInitialWildlife,
  spawnWildlifeAt, updateForageRegrow, updateWildlife, updateWildlifeRespawn, wildlifeForSnapshot,
} from "./wildlife.js";
import {
  TOWN_CENTER_TILE, activeWardSources, applyDailyFoodConsumption, applyMoraleCheck, checkWardStoneLapses,
  civilianPopulationUsed, computeColonyHappiness, findTownCenterAt, getColonistsAtPost, handleRepairBuilding,
  happinessSpeedMultiplier, isAbbeyClergy, isAtShelter, isWardPriest, isWarded, nearestTownCenter, populationCap,
  processRespawnQueue, productionSpeedMultiplier, respawnWindowAt, respawnWindowSnapshot, settlementBlocker,
  settlementKeyNear, settlementOf, settlementStats, spawnColonistForPost, spawnPointNearTownCenter,
  topUpTownCenterBuilders, townCenterBonus, townCenterMaxHp, updateColonist, updateWardPriestPresence,
} from "./colonists.js";
import {
  armyRegimentsForSnapshot, armyRegimentsNow, colonistRole, dropGuardTarget, guardStats, isGuardOrMilitiaKind,
  isRearColonist, isRearMob, isSiegeKind, isSoldierKind, mobRole, nearestMeleeSoldier, pruneTaskForces,
  taskForcesForSnapshot, unitStats, updateSquadMarch,
} from "./units.js";
import {
  buildingMaxHp, damageBuilding, damageColonist, damageMob, damagePlayer, damageTownCenter,
  damagedBuildingsForSnapshot, gatesForSnapshot, handlePlayerAttack, handleSetGateLock, isColonyBreachObstacle,
  isTowerTile, isWallTile, livingTowersNear, pruneSlotClaims, releaseSlot, respawnDeadPlayers, structureHp,
  towerCooldownTicks, towerStatsForLevel, updateGates, updateTowers, withHostileMover,
} from "./combat.js";
import { catapultImpact, handleQueueSiege, raidSiegeCap, updateSiegeWorkshops } from "./siege.js";
import {
  activateGuardianSite, applyHungerMark, applyMobSize, buildingNearby, handleSetDifficulty, hungerMarkChance,
  hungerMarkLabel, isDifficulty, isDormantGuardian, keyToTile, mobBodyRadius, mobKindLabel, pickMobTarget,
  resolveTargetPosition, rollMobSize, routeToBuilding, updateMob,
} from "./mobs.js";
import {
  buildingInfoFor, buildingLevelsForSnapshot, canAfford, constructionSitesForSnapshot, formatCost, handleSetTile,
  handleUpgradeBuilding, placementCost, resolveTownCenterPlacement, spend, updateConstructionSites,
} from "./construction.js";

state.tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;

function scatterResourceTiles(tileType: TileType, count: number) {
  const spawnTx = Math.floor(state.WORLD_TILES_X / 2);
  const spawnTy = Math.floor(state.WORLD_TILES_Y / 2);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < scaledCount(1000)) {
    attempts++;
    const tx = Math.floor(Math.random() * state.WORLD_TILES_X);
    const ty = Math.floor(Math.random() * state.WORLD_TILES_Y);
    if (tx === spawnTx && ty === spawnTy) continue;
    if (isInReservedGrounds(tx, ty)) continue;
    const idx = tileIndex(tx, ty);
    if (state.tiles[idx] === TileType.Empty) {
      state.tiles[idx] = tileType;
      placed++;
    }
  }
}

// Only a Church's bishop takes orders: the Ward Priest must keep his rounds for the wards to stand,
// and the Abbey's clergy aren't the colony's at all. Mirrored by the client's isCommandable (which
// sees the Ward Priest's post as a Ward Stone).
export function isCommandable(c: Colonist): boolean {
  if (!COMMANDABLE_KINDS.includes(c.kind)) return false;
  if (isWardPriest(c)) return false;
  return c.kind !== "bishop" || state.tiles[tileIndex(c.postX, c.postY)] === TileType.ChurchPost;
}

function handleCommandMove(unitIds: string[], x: number, y: number, squad?: unknown) {
  const tile = tileOfPixel(x, y);
  if (!inBounds(tile.x, tile.y)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c) || isRoutedUnit(c.id)) continue;
    // A per-unit order takes the unit out of its regiment order group (strategy mode phase 3).
    leaveOrderGroup(c.id);
    rallyUnit(c, x, y, typeof squad === "string" && squad.length > 0 && squad.length <= 64 ? squad : null);
  }
}

// The move part of commandMove for one unit: its rally slot becomes (x, y) (in bounds), targets dropped.
function rallyUnit(c: Colonist, x: number, y: number, squad: string | null) {
  const tile = tileOfPixel(x, y);
  c.squadId = squad;
  c.rallyTileX = tile.x;
  c.rallyTileY = tile.y;
  c.rallyX = x;
  c.rallyY = y;
  c.targetMobId = null;
  c.targetHearthId = null;
  commandedTargets.delete(c.id);
  c.healTargetType = null;
  c.healTargetId = null;
  c.path = [];
  c.repathCooldown = 0;
}

function handleCommandAttack(unitIds: string[], mobId: string) {
  if (!mobs.has(mobId) || !Array.isArray(unitIds)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind) || isRoutedUnit(c.id)) continue;
    leaveOrderGroup(c.id);
    c.targetMobId = mobId;
    c.targetHearthId = null;
    commandedTargets.set(c.id, mobId);
    c.path = [];
    c.repathCooldown = 0;
  }
}

function handleCommandStance(unitIds: string[], stance: Stance) {
  if (!STANCES.includes(stance)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c)) continue;
    c.stance = stance;
  }
}

// A task force is also a manual regiment (strategy mode phase 2), so a unit is in at most one: assigning
// takes the units out of every other slot. Empty (or no valid unit) disbands the slot.
function handleAssignTaskForce(slot: number, unitIds: string[]) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9 || !Array.isArray(unitIds)) return;
  const valid = Array.from(new Set(unitIds)).filter((id) => {
    const c = typeof id === "string" ? colonists.get(id) : undefined;
    return c && isCommandable(c);
  });
  taskForces.delete(slot);
  taskForceMax.delete(slot);
  if (valid.length === 0) return;
  const taken = new Set(valid);
  for (const [other, ids] of taskForces) {
    const kept = ids.filter((id) => !taken.has(id));
    if (kept.length === ids.length) continue;
    if (kept.length === 0) {
      taskForces.delete(other);
      taskForceMax.delete(other);
    } else {
      taskForces.set(other, kept);
    }
  }
  taskForces.set(slot, valid);
  taskForceMax.set(slot, valid.length);
}
// ---- Regiment orders (strategy mode phase 3; docs PLAN-strategy-mode.md §4 "Order execution").
// Regiments are derived per snapshot (above), so order state lives on the UNITS: a regimentOrder makes
// the units it names an order group ("g<N>": the members of every regiment in the selection), holding the
// current order and a queue (Shift waypoints, ARMY_ORDER_QUEUE_MAX). A unit is in at most one group; a
// per-unit commandMove / commandAttack / commandAttackHearth (tactical mode) takes it out. Groups are not
// saved. The server forms the slots itself with formation.ts (the client's ghosts use the same code) and
// moves each unit through rallyUnit + its squad (squadId = group id, so updateSquadMarch paces it), with
// the client's old 0-0.6 s staggered start done here. Work per tick: the pending staggered starts only;
// groups are checked every ORDER_UPDATE_TICKS, formations solved per order / re-form only.
//   move        form at (x, y) with the given facing / width (or the group's last width), then done
//   attackMove  as move; a valid enemy within a member's stance alert range halts the group (shifted so
//               its nearest member can reach it) and battle discipline fights; resumes 3 s after clear
//   retreat     to (x, y) or in front of the nearest Town Center, targets dropped, +10% speed, fights
//               only an enemy within RETREAT_CORNERED_TILES
//   hold        stays where it is (or on its slots), leash HOLD_LEASH_TILES; lasts until the next order
//   follow      re-forms FOLLOW_BEHIND_TILES behind a colonist / player when it moves FOLLOW_REFORM_TILES
//   attack      a commanded attack on a mob (as commandAttack) until it is gone
// Phase 4:
//   charge      shock / fast members run at a mob at full speed (a commanded target: no leash, no squad
//               pace; the cavalry charge x2 lands as ever); with cycleCharge a rider whose charge landed
//               withdraws CHARGE_WITHDRAW_TILES and charges again once its charge cooldown is over. The
//               rest of the group stands. Until the mob is gone.
//   bombard     catapults shell the point each reload from within their 3-11 tile band (walking into it
//               first); a standing hearth under the splash takes building damage. Until the next order.
//   attackHearth  the group attacks a camp hearth (as commandAttackHearth) until it falls.

function leaveOrderGroup(id: string) {
  pendingRallies.delete(id);
  chargeCycle.delete(id);
  const g = orderGroupOfUnit.get(id);
  if (!g) return;
  orderGroupOfUnit.delete(id);
  g.unitIds.delete(id);
  if (g.unitIds.size === 0) orderGroups.delete(g.id);
}

function clearOrderGroups() {
  orderGroups.clear();
  orderGroupOfUnit.clear();
  pendingRallies.clear();
  chargeCycle.clear();
  state.orderGroupSignature = "";
}

// The kind of order the unit's group is carrying out (hold / retreat change updateGuardColonist).
export function unitOrderKind(c: Colonist): ArmyOrderKind | undefined {
  return orderGroupOfUnit.get(c.id)?.current?.kind;
}

// Alive commandable members; the dead / gone are dropped from the group.
function groupMembers(g: OrderGroup): Colonist[] {
  const out: Colonist[] = [];
  for (const id of g.unitIds) {
    const c = colonists.get(id);
    if (c && isCommandable(c)) {
      out.push(c);
    } else {
      g.unitIds.delete(id);
      orderGroupOfUnit.delete(id);
      pendingRallies.delete(id);
      chargeCycle.delete(id);
    }
  }
  return out;
}

function centroidOf(units: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / Math.max(1, units.length), y: y / Math.max(1, units.length) };
}

// Stop where it stands (the rally slot moves onto it); a fight in progress goes on.
function haltUnit(c: Colonist, dx = 0, dy = 0) {
  pendingRallies.delete(c.id);
  const x = clamp(c.x + dx, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(c.y + dy, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  const t = tileOfPixel(x, y);
  Object.assign(c, { rallyTileX: t.x, rallyTileY: t.y, rallyX: x, rallyY: y, squadId: null });
  commandedTargets.delete(c.id);
  if (dx !== 0 || dy !== 0) c.path = [];
}

// Validated copy of a client order (null = rejected): known kind, finite in-bounds point, normalised
// facing, clamped width, a bounded target id.
function sanitizeArmyOrder(raw: unknown): ArmyOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as ArmyOrderKind;
  if (!ARMY_ORDER_KINDS.includes(kind)) return null;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const order: ArmyOrder = { kind };
  if (num(o.x) && num(o.y)) {
    order.x = clamp(o.x, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
    order.y = clamp(o.y, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  } else if (kind === "move" || kind === "attackMove" || kind === "bombard") {
    return null;
  }
  if (num(o.facing)) order.facing = Math.atan2(Math.sin(o.facing), Math.cos(o.facing));
  if (num(o.width)) order.width = clamp(o.width, 0, ORDER_WIDTH_MAX_TILES);
  if (kind === "follow" || kind === "attack" || kind === "charge") {
    if (typeof o.targetId !== "string" || o.targetId.length === 0 || o.targetId.length > 80) return null;
    order.targetId = o.targetId;
  }
  if (kind === "attackHearth") {
    if (!Number.isInteger(o.tileX) || !Number.isInteger(o.tileY) || !inBounds(o.tileX as number, o.tileY as number)) return null;
    order.tileX = o.tileX as number;
    order.tileY = o.tileY as number;
  }
  return order;
}

// A follow target: "p:<playerId>" (alive) or a colonist id.
function followTargetPos(targetId: string): { x: number; y: number } | null {
  if (targetId.startsWith("p:")) {
    const p = players.get(targetId.slice(2));
    return p && !p.dead ? p : null;
  }
  return colonists.get(targetId) ?? null;
}

// The commandable units a regimentOrder / regimentSettings names (regiment members + unit ids, capped).
function orderedUnits(regimentIds: unknown, unitIds: unknown): Colonist[] {
  const ids = new Set<string>();
  if (Array.isArray(regimentIds) && regimentIds.length > 0) {
    const wanted = new Set(regimentIds.slice(0, 64).filter((r): r is string => typeof r === "string"));
    for (const r of armyRegimentsNow()) if (wanted.has(r.id)) for (const id of r.unitIds) ids.add(id);
  }
  if (Array.isArray(unitIds)) for (const id of unitIds.slice(0, 1000)) if (typeof id === "string") ids.add(id);
  const units: Colonist[] = [];
  for (const id of ids) {
    const c = colonists.get(id);
    if (c && isCommandable(c)) units.push(c);
  }
  return units;
}

function handleRegimentOrder(player: Player, msg: { regimentIds?: unknown; unitIds?: unknown; order?: unknown; queue?: unknown }) {
  if (state.simHeldForLoad) return;
  const now = Date.now();
  if (now - player.orderWindowAt >= 1000) {
    player.orderWindowAt = now;
    player.orderWindowCount = 0;
  }
  if (++player.orderWindowCount > REGIMENT_ORDER_MAX_PER_S) return;
  const order = sanitizeArmyOrder(msg.order);
  if (!order) return;
  // Phase 6: routed units take no orders until they rally.
  const units = orderedUnits(msg.regimentIds, msg.unitIds).filter((c) => !isRoutedUnit(c.id));
  if (units.length === 0) return;
  const ids = new Set(units.map((c) => c.id));
  if ((order.kind === "attack" || order.kind === "charge") && !mobs.has(order.targetId!)) return;
  if (order.kind === "attackHearth" && !attackObjectiveAt(order.tileX!, order.tileY!)) return;
  if (order.kind === "follow" && (!followTargetPos(order.targetId!) || ids.has(order.targetId!))) return;
  // The same units as an existing group: Shift appends to its queue (a hold / follow / finished order
  // gives way at once), a plain order replaces its orders but keeps its formation memory.
  const prev = orderGroupOfUnit.get(units[0].id);
  const same = !!prev && prev.unitIds.size === units.length && units.every((c) => orderGroupOfUnit.get(c.id) === prev);
  if (prev && same) {
    if (msg.queue === true && prev.current && prev.current.kind !== "hold" && prev.current.kind !== "follow" && prev.current.kind !== "bombard") {
      if (prev.queue.length < ARMY_ORDER_QUEUE_MAX) prev.queue.push(order);
      return;
    }
    if (msg.queue !== true) prev.queue = [];
    startArmyOrder(prev, order);
    return;
  }
  for (const c of units) leaveOrderGroup(c.id);
  const g: OrderGroup = {
    id: `g${state.nextOrderGroupId++}`, unitIds: new Set(units.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: state.cycleTick, engaged: false, clearSince: -1, followAt: null,
  };
  orderGroups.set(g.id, g);
  for (const c of units) orderGroupOfUnit.set(c.id, g);
  startArmyOrder(g, order);
}

// Slots from formation.ts at (x, y); nearest-to-its-slot units start first, the rest staggered.
function formGroupAt(g: OrderGroup, members: Colonist[], x: number, y: number, facing: number | undefined, width: number | undefined) {
  const plan = planOrderFormation(members, x, y, facing, width);
  g.facing = Math.atan2(plan.fy, plan.fx);
  g.width = width;
  g.lastAt = { x, y };
  const slots = Array.from(plan.targets.values());
  const c0 = centroidOf(slots);
  g.destX = c0.x;
  g.destY = c0.y;
  const toSlot = (c: Colonist) => {
    const s = plan.targets.get(c.id)!;
    return Math.hypot(s.x - c.x, s.y - c.y);
  };
  const order = members.slice().sort((a, b) => toSlot(a) - toSlot(b));
  const stepMs = order.length > 1 ? Math.min(ORDER_DISPATCH_STEP_MS, ORDER_DISPATCH_MAX_SPREAD_MS / (order.length - 1)) : 0;
  const squad = order.length > 1 ? g.id : null;
  order.forEach((c, i) => {
    const s = plan.targets.get(c.id)!;
    const sx = clamp(s.x, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
    const sy = clamp(s.y, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
    const delay = Math.round((i * stepMs * TICK_RATE) / 1000);
    if (delay === 0) {
      pendingRallies.delete(c.id);
      rallyUnit(c, sx, sy, squad);
    } else {
      pendingRallies.set(c.id, { at: state.cycleTick + delay, x: sx, y: sy, group: g.id, squad });
    }
  });
}

function startArmyOrder(g: OrderGroup, order: ArmyOrder) {
  g.current = order;
  g.engaged = false;
  g.clearSince = -1;
  g.followAt = null;
  g.startedTick = state.cycleTick;
  const members = groupMembers(g);
  if (members.length === 0) return;
  for (const c of members) chargeCycle.delete(c.id);
  switch (order.kind) {
    case "move":
    case "attackMove":
    case "retreat": {
      if (order.x === undefined || order.y === undefined) {
        // Retreat: form RETREAT_TC_OFFSET_TILES in front of the nearest Town Center, facing out.
        const c0 = centroidOf(members);
        const tc = nearestTownCenter(c0.x, c0.y);
        if (!tc) {
          finishArmyOrder(g, members);
          return;
        }
        const tcx = (tc.x + 0.5) * TILE_SIZE;
        const tcy = (tc.y + 0.5) * TILE_SIZE;
        const d = Math.hypot(c0.x - tcx, c0.y - tcy);
        const dx = d >= 1 ? (c0.x - tcx) / d : 0;
        const dy = d >= 1 ? (c0.y - tcy) / d : 1;
        order.x = clamp(tcx + dx * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
        order.y = clamp(tcy + dy * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
        order.facing ??= Math.atan2(dy, dx);
      }
      // No facing given (a queued click): face the way it marches, at the group's last width.
      const width = order.width ?? (order.facing === undefined ? g.width : undefined);
      formGroupAt(g, members, order.x, order.y, order.facing, width);
      // Filled in, so the client's ghost of the current order matches the slots.
      order.facing = g.facing;
      if (width !== undefined) order.width = width;
      return;
    }
    case "hold":
      // Off the march: stop here; already on (or near) its slot: keep the slot.
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (Math.hypot(c.rallyX - c.x, c.rallyY - c.y) > TILE_SIZE) haltUnit(c);
        commandedTargets.delete(c.id);
        c.squadId = null;
      }
      return;
    case "follow":
      updateFollowOrder(g, members);
      return;
    case "attack": {
      const mob = mobs.get(order.targetId!);
      if (!mob) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (!isGuardOrMilitiaKind(c.kind)) continue;
        c.targetMobId = mob.id;
        c.targetHearthId = null;
        commandedTargets.set(c.id, mob.id);
        c.squadId = null;
        c.path = [];
        c.repathCooldown = 0;
      }
      return;
    }
    case "charge": {
      const mob = mobs.get(order.targetId!);
      if (!mob) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (canCharge(c)) chargeAt(c, mob);
      }
      return;
    }
    case "bombard":
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (c.kind === "catapult") bombardPosition(c, order.x!, order.y!);
      }
      return;
    case "attackHearth": {
      const h = attackObjectiveAt(order.tileX!, order.tileY!);
      if (!h) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (isGuardOrMilitiaKind(c.kind)) sendAgainstHearth(c, h);
      }
      return;
    }
  }
}

// Phase 4, charge: knights / cavalry / champions (shock and fast roles).
function canCharge(c: Colonist): boolean {
  const role = colonistRole(c);
  return role === "shock" || role === "fast";
}

// Off at the mob: a commanded target (no leash, no squad pace).
function chargeAt(c: Colonist, mob: Mob) {
  c.targetMobId = mob.id;
  c.targetHearthId = null;
  commandedTargets.set(c.id, mob.id);
  c.squadId = null;
  c.path = [];
  c.repathCooldown = 0;
  chargeCycle.set(c.id, { phase: "in", readyTick: chargeRuns.get(c.id)?.readyTick ?? 0, since: state.cycleTick });
}

// Every ORDER_UPDATE_TICKS on a charge order: a cycling rider whose charge landed withdraws (straight away
// from the mob, re-aimed while the mob closes in) and turns again once its cooldown is over and it has
// room for a full run.
function updateChargeOrder(g: OrderGroup, members: Colonist[]) {
  const mob = mobs.get(g.current!.targetId!);
  if (!mob || mob.hp <= 0) {
    finishArmyOrder(g, members);
    return;
  }
  for (const c of members) {
    const cyc = chargeCycle.get(c.id);
    if (!cyc) continue;
    const run = chargeRuns.get(c.id);
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (cyc.phase === "out") {
      const ready = !run || state.cycleTick >= run.readyTick;
      if (ready && (d >= CHARGE_RECHARGE_GAP_TILES * TILE_SIZE || state.cycleTick - cyc.since >= CHARGE_WITHDRAW_MAX_TICKS)) {
        // The attack cooldown only runs down while striking; out this long it is long over (else the rider
        // waits it out at the mob, sliding to its ring slot, which breaks the charge run).
        c.attackCooldownTicks = 0;
        chargeAt(c, mob);
      } else if (Math.hypot(c.rallyX - mob.x, c.rallyY - mob.y) < (CHARGE_WITHDRAW_TILES - 0.5) * TILE_SIZE) {
        withdrawFrom(c, mob, d);
      }
      continue;
    }
    if (c.cycleCharge && run && run.readyTick !== cyc.readyTick && run.readyTick > state.cycleTick) {
      chargeCycle.set(c.id, { phase: "out", readyTick: run.readyTick, since: state.cycleTick });
      withdrawFrom(c, mob, d);
    } else if (c.targetMobId !== mob.id) {
      chargeAt(c, mob);
    }
  }
}

function withdrawFrom(c: Colonist, mob: Mob, d: number) {
  const ux = d >= 1 ? (c.x - mob.x) / d : 1;
  const uy = d >= 1 ? (c.y - mob.y) / d : 0;
  const x = clamp(mob.x + ux * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, state.WORLD_TILES_X * TILE_SIZE - TILE_SIZE);
  const y = clamp(mob.y + uy * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, state.WORLD_TILES_Y * TILE_SIZE - TILE_SIZE);
  rallyUnit(c, x, y, null);
  releaseSlot(c.id);
}

// Phase 4, bombard: a catapult outside its throw band walks to the band's middle on the line to the point.
function bombardPosition(c: Colonist, x: number, y: number) {
  const d = Math.hypot(x - c.x, y - c.y);
  if (d >= CATAPULT_MIN_RANGE + TILE_SIZE / 2 && d <= CATAPULT_RANGE - TILE_SIZE / 2) {
    haltUnit(c);
    return;
  }
  const want = (CATAPULT_MIN_RANGE + CATAPULT_RANGE) / 2;
  const ux = d >= 1 ? (c.x - x) / d : 1;
  const uy = d >= 1 ? (c.y - y) / d : 0;
  rallyUnit(c, clamp(x + ux * want, 1, state.WORLD_TILES_X * TILE_SIZE - 1), clamp(y + uy * want, 1, state.WORLD_TILES_Y * TILE_SIZE - 1), null);
}

// The bombard point of a catapult whose group is on a bombard order (null otherwise).
export function bombardPoint(c: Colonist): { x: number; y: number } | null {
  const o = orderGroupOfUnit.get(c.id)?.current;
  return o && o.kind === "bombard" && o.x !== undefined && o.y !== undefined ? { x: o.x, y: o.y } : null;
}

// One bombard tick: inside the throw band it shells the point each reload (true = it acted).
export function bombardStep(c: Colonist, at: { x: number; y: number }, stats: { damage: number; cooldown: number }): boolean {
  const d = Math.hypot(at.x - c.x, at.y - c.y);
  if (d < CATAPULT_MIN_RANGE || d > CATAPULT_RANGE) return false;
  c.path = [];
  c.state = "attacking";
  if (c.attackCooldownTicks > 0) {
    c.attackCooldownTicks--;
    return true;
  }
  const damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
  catapultImpact(c.x, c.y, at.x, at.y, damage, "colony", "c:" + c.id);
  for (const h of hearths.values()) {
    if (h.destroyed) continue;
    const p = tileToPixelCenter(h);
    if (Math.hypot(p.x - at.x, p.y - at.y) <= CATAPULT_SPLASH_PX + TILE_SIZE / 2) damageHearth(h, damage * CATAPULT_BUILDING_MULT, "c:" + c.id);
  }
  c.attackCooldownTicks = stats.cooldown;
  return true;
}

// The current order is done: the next queued one starts, else the group stands (after an attack, where
// the fight left it).
function finishArmyOrder(g: OrderGroup, members: Colonist[]) {
  const was = g.current?.kind;
  g.current = null;
  g.engaged = false;
  const next = g.queue.shift();
  if (next) {
    startArmyOrder(g, next);
    return;
  }
  if (was === "attack" || was === "charge") for (const c of members) if (!c.targetMobId) haltUnit(c);
}

// Formed = the centroid of the members still marching (not fighting) is within SQUAD_SETTLE_TILES of the
// slots' centroid.
function groupArrived(g: OrderGroup, members: Colonist[]): boolean {
  if (state.cycleTick - g.startedTick < ORDER_ARRIVE_GRACE_TICKS) return false;
  const free = members.filter((c) => !c.targetMobId);
  const c0 = centroidOf(free.length > 0 ? free : members);
  return Math.hypot(c0.x - g.destX, c0.y - g.destY) <= SQUAD_SETTLE_TILES * TILE_SIZE;
}

// The nearest enemy an attack-move reacts to: awake, not routing / leaving (pursuit safety), within a
// member's stance alert range. `reach` = that member's leash + attack range.
function attackMoveContact(members: Colonist[]): { mob: Mob; member: Colonist; d: number } | null {
  const c0 = centroidOf(members);
  let spread = 0;
  for (const c of members) spread = Math.max(spread, Math.abs(c.x - c0.x), Math.abs(c.y - c0.y));
  const box = spread + STANCE_ALERT_RANGE_TILES.aggressive * TILE_SIZE;
  let best: { mob: Mob; member: Colonist; d: number } | null = null;
  for (const m of mobs.values()) {
    if (Math.abs(m.x - c0.x) > box || Math.abs(m.y - c0.y) > box) continue;
    if (m.hp <= 0 || m.passive || isDormantGuardian(m) || m.tactic === "rout" || m.tactic === "leave") continue;
    for (const c of members) {
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (d <= STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE && (!best || d < best.d)) best = { mob: m, member: c, d };
    }
  }
  return best;
}

function updateAttackMove(g: OrderGroup, members: Colonist[]) {
  const contact = attackMoveContact(members);
  const fighting = members.some((c) => !!c.targetMobId && mobs.has(c.targetMobId));
  // Forts phase A: with no enemy in reach, a hostile site's structure within the alert range of the group
  // is attacked (walls on the way get breached); the march resumes once it falls, as after a fight.
  if (!contact && !fighting && tileOwner.size > 0) {
    let busy = members.some((c) => c.targetHearthId?.startsWith(STRUCTURE_TARGET_PREFIX));
    if (!busy) {
      const c0 = centroidOf(members);
      const s = nearestHostileStructure(c0.x, c0.y, STANCE_ALERT_RANGE_TILES.aggressive * TILE_SIZE);
      if (s) {
        for (const c of members) if (isGuardOrMilitiaKind(c.kind)) sendAgainstHearth(c, s);
        busy = true;
      }
    }
    if (busy) {
      g.engaged = true;
      g.clearSince = -1;
      return;
    }
  }
  if (!g.engaged && !contact) {
    if (groupArrived(g, members)) finishArmyOrder(g, members);
    return;
  }
  if (contact && !fighting && (!g.engaged || !members.some((c) => c.state === "returning"))) {
    // Halt (first contact) or close in: the whole group shifts toward the enemy until its nearest member
    // has it inside its slot's reach, keeping the formation's shape; then battle discipline fights.
    const reach = LINE_LEASH_TILES[contact.member.stance] * TILE_SIZE + unitStats(contact.member).range;
    const shift = Math.max(0, contact.d - reach * 0.8);
    const dx = ((contact.mob.x - contact.member.x) / (contact.d || 1)) * shift;
    const dy = ((contact.mob.y - contact.member.y) / (contact.d || 1)) * shift;
    if (!g.engaged || shift > TILE_SIZE / 2) for (const c of members) haltUnit(c, dx, dy);
  }
  g.engaged = true;
  if (contact || fighting) {
    g.clearSince = -1;
    return;
  }
  if (g.clearSince < 0) {
    g.clearSince = state.cycleTick;
  } else if (state.cycleTick - g.clearSince >= ATTACK_MOVE_RESUME_TICKS && g.current) {
    // Clear for 3 s: on to the same destination and formation (re-formed from here).
    startArmyOrder(g, g.current);
  }
}

function updateFollowOrder(g: OrderGroup, members: Colonist[]) {
  const t = followTargetPos(g.current!.targetId!);
  if (!t) {
    finishArmyOrder(g, members);
    return;
  }
  const from = g.followAt ?? centroidOf(members);
  const moved = Math.hypot(t.x - from.x, t.y - from.y);
  if (g.followAt && moved <= FOLLOW_REFORM_TILES * TILE_SIZE) return;
  const dx = moved >= 1 ? (t.x - from.x) / moved : Math.cos(g.facing ?? 0);
  const dy = moved >= 1 ? (t.y - from.y) / moved : Math.sin(g.facing ?? 0);
  g.followAt = { x: t.x, y: t.y };
  const x = clamp(t.x - dx * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(t.y - dy * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  formGroupAt(g, members, x, y, Math.atan2(dy, dx), g.width);
}

// Per tick: the staggered starts that are due. Every ORDER_UPDATE_TICKS: arrivals, attack-move contact,
// follow re-forms, attack targets, queue pops.
function updateOrderGroups() {
  if (pendingRallies.size > 0) {
    for (const [id, p] of pendingRallies) {
      if (state.cycleTick < p.at) continue;
      pendingRallies.delete(id);
      const c = colonists.get(id);
      if (c && orderGroupOfUnit.get(id)?.id === p.group) rallyUnit(c, p.x, p.y, p.squad);
    }
  }
  if (state.cycleTick % ORDER_UPDATE_TICKS !== 0) return;
  for (const g of orderGroups.values()) {
    const members = groupMembers(g);
    if (members.length === 0) {
      orderGroups.delete(g.id);
      continue;
    }
    const o = g.current;
    if (!o) {
      const next = g.queue.shift();
      if (next) startArmyOrder(g, next);
      continue;
    }
    if (o.kind === "move" || o.kind === "retreat") {
      if (groupArrived(g, members)) finishArmyOrder(g, members);
    } else if (o.kind === "attackMove") {
      updateAttackMove(g, members);
    } else if (o.kind === "follow") {
      updateFollowOrder(g, members);
    } else if (o.kind === "attack") {
      const mob = mobs.get(o.targetId!);
      if (!mob || mob.hp <= 0) finishArmyOrder(g, members);
    } else if (o.kind === "charge") {
      updateChargeOrder(g, members);
    } else if (o.kind === "attackHearth") {
      if (!attackObjectiveAt(o.tileX!, o.tileY!)) finishArmyOrder(g, members);
    }
  }
}

// Strategy mode phase 4: per-unit settings for the named regiments' members and / or units. A shape
// change re-forms each affected order group where it stands (its destination while marching).
function handleRegimentSettings(player: Player, msg: { regimentIds?: unknown; unitIds?: unknown; stance?: unknown; holdFire?: unknown; skirmish?: unknown; cycleCharge?: unknown; shape?: unknown }) {
  if (state.simHeldForLoad) return;
  const now = Date.now();
  if (now - player.orderWindowAt >= 1000) {
    player.orderWindowAt = now;
    player.orderWindowCount = 0;
  }
  if (++player.orderWindowCount > REGIMENT_ORDER_MAX_PER_S) return;
  const units = orderedUnits(msg.regimentIds, msg.unitIds);
  const stance = STANCES.includes(msg.stance as Stance) ? (msg.stance as Stance) : undefined;
  const shape = FORMATION_SHAPES.includes(msg.shape as FormationShape) ? (msg.shape as FormationShape) : undefined;
  const reform = new Set<OrderGroup>();
  for (const c of units) {
    if (stance) c.stance = stance;
    if (typeof msg.holdFire === "boolean") c.holdFire = msg.holdFire || undefined;
    if (typeof msg.skirmish === "boolean") c.skirmish = msg.skirmish || undefined;
    if (typeof msg.cycleCharge === "boolean") c.cycleCharge = msg.cycleCharge || undefined;
    if (shape && (c.shape ?? "line") !== shape) {
      c.shape = shape === "line" ? undefined : shape;
      const g = orderGroupOfUnit.get(c.id);
      if (g) reform.add(g);
    }
    // Hold fire drops an uncommanded target at once.
    if (msg.holdFire === true && c.targetMobId && commandedTargets.get(c.id) !== c.targetMobId && !unitStats(c).melee) dropGuardTarget(c);
  }
  for (const g of reform) {
    const o = g.current;
    if (o && (o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat") && !g.engaged) {
      startArmyOrder(g, o);
    } else if ((!o || o.kind === "hold") && g.lastAt) {
      const members = groupMembers(g);
      if (members.length > 0) formGroupAt(g, members, g.lastAt.x, g.lastAt.y, g.facing, g.width);
    }
  }
}

// Sent when an order group changes, else every ARMY_REGIMENT_REFRESH_TICKS.
function orderGroupsForSnapshot(): ArmyOrderGroupSnapshot[] | undefined {
  const list: ArmyOrderGroupSnapshot[] = Array.from(orderGroups.values(), (g) => ({
    id: g.id,
    unitIds: Array.from(g.unitIds),
    order: g.current,
    queue: g.queue,
    ...(g.facing !== undefined ? { facing: g.facing } : {}),
    ...(g.width !== undefined ? { width: g.width } : {}),
    ...(g.engaged ? { engaged: true } : {}),
  }));
  const signature = JSON.stringify(list);
  state.orderGroupTicks++;
  if (signature === state.orderGroupSignature && state.orderGroupTicks < ARMY_REGIMENT_REFRESH_TICKS) return undefined;
  state.orderGroupSignature = signature;
  state.orderGroupTicks = 0;
  return list;
}

// ---- Raid waves ----
// spawnRaid runs once per day at the day's midpoint and puts the whole of tonight's raid on the map
// in passive groups. updateRaidGroups then drives every grouped mob (updateMob skips them):
//   passive  - loiter near their spawn; turn aggressive at the group's aggroTick (uniform between
//              spawn and nightfall), at nightfall at the latest, or as soon as any member is damaged.
//   marching - the group walks to the colony together: the slowest member leads along one shared
//              path at its own speed, the rest hold formation slots around it. Once the leader is
//              within RAID_ENGAGE_RANGE_TILES of the colony or a target, the group dissolves and each
//              member falls back to updateMob's normal per-mob targeting (as does a damaged group).

function raidSizeForDay(dayIndex: number): number {
  const base = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex;
  return Math.max(1, Math.round(base * DIFFICULTY_TUNING[state.difficulty].spawnCount));
}
function raidBox() {
  const c = state.townCenters[0] ?? TOWN_CENTER_TILE;
  return {
    x0: Math.max(0, c.x - state.raidSpawnDist),
    x1: Math.min(state.WORLD_TILES_X - 1, c.x + state.raidSpawnDist),
    y0: Math.max(0, c.y - state.raidSpawnDist),
    y1: Math.min(state.WORLD_TILES_Y - 1, c.y + state.raidSpawnDist),
  };
}
function raidAnchorWithinPathBudget(anchor: TileCoord): boolean {
  const goals = state.townCenters.length > 0 ? state.townCenters : [TOWN_CENTER_TILE];
  const near = (t: TileCoord) => goals.some((c) => Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) <= RAID_REACH_RADIUS);
  const seen = new Set<number>([tileIndex(anchor.x, anchor.y)]);
  const queue: TileCoord[] = [anchor];
  for (let head = 0; head < queue.length; head++) {
    if (head > RAID_REACH_BUDGET) return false;
    const t = queue[head];
    if (near(t)) return true;
    for (const n of [{ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }]) {
      if (!isWalkableTile(n.x, n.y)) continue;
      const k = tileIndex(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}

function isRaidEdgeTile(tx: number, ty: number): boolean {
  const b = raidBox();
  if (tx < b.x0 || tx > b.x1 || ty < b.y0 || ty > b.y1) return false;
  return Math.min(tx - b.x0, b.x1 - tx, ty - b.y0, b.y1 - ty) < RAID_EDGE_BAND_TILES;
}

function randomRaidAnchor(): { tile: TileCoord; edge: RaidEdge } | null {
  // Try the full spawn distance first, then closer boxes, until an anchor can path to the colony in budget.
  for (const dist of RAID_SPAWN_DIST_STEPS) {
    state.raidSpawnDist = dist;
    const found = randomRaidAnchorInBox(true);
    if (found) return found;
  }
  state.raidSpawnDist = RAID_SPAWN_DIST_STEPS[RAID_SPAWN_DIST_STEPS.length - 1];
  return randomRaidAnchorInBox(false);
}

function randomRaidAnchorInBox(requireBudget: boolean): { tile: TileCoord; edge: RaidEdge } | null {
  for (let attempt = 0; attempt < (requireBudget ? 16 : 40); attempt++) {
    const side = Math.floor(Math.random() * 4);
    const b = raidBox();
    const along = side < 2 ? randInt(b.x0, b.x1) : randInt(b.y0, b.y1);
    const tile =
      side === 0 ? { x: along, y: b.y0 }
      : side === 1 ? { x: along, y: b.y1 }
      : side === 2 ? { x: b.x0, y: along }
      : { x: b.x1, y: along };
    if (isWalkableTile(tile.x, tile.y) && (!requireBudget || raidAnchorWithinPathBudget(tile))) {
      const edge: RaidEdge = side === 0 ? "north" : side === 1 ? "south" : side === 2 ? "west" : "east";
      return { tile, edge };
    }
  }
  return null;
}

// `count` walkable edge-band tiles nearest the anchor (breadth-first), skipping tiles in `occupied`
// (and claiming the ones returned). Stacks on the tiles found only if there aren't enough free ones.
function clusterRaidTiles(anchor: TileCoord, count: number, occupied: Set<number>): TileCoord[] {
  const result: TileCoord[] = [];
  const seen = new Set<number>([tileIndex(anchor.x, anchor.y)]);
  const queue: TileCoord[] = [anchor];
  const searchLimit = count * 8 + 64;
  for (let head = 0; head < queue.length && result.length < count && head < searchLimit; head++) {
    const t = queue[head];
    const idx = tileIndex(t.x, t.y);
    if (!occupied.has(idx)) {
      occupied.add(idx);
      result.push(t);
    }
    const neighbors = [
      { x: t.x + 1, y: t.y },
      { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isWalkableTile(n.x, n.y) || !isRaidEdgeTile(n.x, n.y)) continue;
      const k = tileIndex(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  const pool = result.length > 0 ? result.slice() : [anchor];
  for (let i = 0; result.length < count; i++) result.push(pool[i % pool.length]);
  return result;
}

function isRaidKindUnlocked(kind: MobKind, dayIndex: number): boolean {
  return MOB_KIND_CONFIG[kind].unlockDay <= dayIndex;
}

function pickRaidFaction(dayIndex: number): RaidFactionId {
  const weighted = (Object.keys(RAID_FACTIONS) as RaidFactionId[])
    .filter((f) => !state.testForceRaidSiege || f === "banditBand" || f === "greenskinWarband")
    .map((f) => ({ f, w: RAID_FACTIONS[f].filter((e) => e.core && isRaidKindUnlocked(e.kind, dayIndex)).length }))
    .filter((x) => x.w > 0);
  let roll = Math.random() * weighted.reduce((sum, x) => sum + x.w, 0);
  for (const x of weighted) {
    roll -= x.w;
    if (roll < 0) return x.f;
  }
  return weighted[weighted.length - 1].f;
}

// `siegeLeft` (per raid): how many more of each siege kind the raid may still take (raidSiegeCap).
function pickRaidFactionKind(faction: RaidFactionId, dayIndex: number, siegeLeft?: Partial<Record<SiegeKind, number>>): MobKind {
  const eligible = RAID_FACTIONS[faction].filter(
    (e) => isRaidKindUnlocked(e.kind, dayIndex) && (!isSiegeKind(e.kind) || (siegeLeft?.[e.kind] ?? 0) > 0)
  );
  const pick = pickWeightedRaidKind(eligible);
  if (siegeLeft && isSiegeKind(pick)) siegeLeft[pick]!--;
  return pick;
}

function pickWeightedRaidKind(all: RaidFactionEntry[]): MobKind {
  const forced = state.testForceRaidSiege ? all.find((e) => isSiegeKind(e.kind)) : undefined;
  if (forced) return forced.kind;
  const eligible = all;
  let roll = Math.random() * eligible.reduce((sum, e) => sum + e.weight, 0);
  for (const e of eligible) {
    roll -= e.weight;
    if (roll < 0) return e.kind;
  }
  return eligible[eligible.length - 1].kind;
}

// Group sizes for a raid of `total`: the horde first, then random groups of
// RAID_GROUP_SIZE_MIN..MAX (a lone leftover mob joins the horde instead of standing alone).
function splitRaidGroups(total: number, hordeSize: number): number[] {
  const sizes = [hordeSize];
  let rest = total - hordeSize;
  while (rest > 0) {
    if (rest < RAID_GROUP_SIZE_MIN) {
      sizes[0] += rest;
      break;
    }
    let size = Math.min(rest, randInt(RAID_GROUP_SIZE_MIN, RAID_GROUP_SIZE_MAX));
    if (rest - size > 0 && rest - size < RAID_GROUP_SIZE_MIN) {
      size = size < RAID_GROUP_SIZE_MAX ? size + 1 : size - 1;
    }
    sizes.push(size);
    rest -= size;
  }
  return sizes;
}

function createRaidMob(kind: MobKind, tile: TileCoord, groupId: string, rollSize = true): Mob {
  const center = tileToPixelCenter(tile);
  const config = MOB_KIND_CONFIG[kind];
  const tuning = DIFFICULTY_TUNING[state.difficulty];
  const maxHp = Math.max(1, Math.round(config.maxHp * tuning.mobHp));
  const mob: Mob = {
    id: randomUUID(),
    kind,
    x: center.x,
    y: center.y,
    hp: maxHp,
    maxHp,
    path: [],
    repathCooldown: 0,
    targetType: null,
    targetId: null,
    attackCooldownTicks: 0,
    damage: Math.max(1, Math.round(config.damage * tuning.mobDamage)),
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
    groupId,
    passive: true,
    ...MOB_MARK_DEFAULTS,
  };
  applyMobSize(mob, rollSize);
  mobs.set(mob.id, mob);
  return mob;
}

// On a deserter night (DESERTER_WAVE_CHANCE, once deserters have waited DESERTER_ACTIVATION_DAYS)
// every eligible deserter joins the horde where it stands, and fresh Bandit-band mobs fill the raid up
// to its normal size (none if the deserters alone already reach it).
// Departure tick for a group at `from`: a random arrival tick in [nightfall, nightfall + window] minus
// the estimated trip to the engage range of the first Town Center, but never before now.
function raidDepartureTick(from: TileCoord, group: RaidGroup, nightfallTick: number): number {
  const tc = state.townCenters[0] ?? TOWN_CENTER_TILE;
  const route = findPath(from, tc);
  const routeTiles = route ? route.length : Math.hypot(tc.x - from.x, tc.y - from.y) * 1.5;
  const speeds = group.memberIds.map((id) => mobs.get(id)?.speed ?? MOB_SPEED);
  const slowest = Math.max(1, Math.min(...speeds));
  const px = Math.max(0, routeTiles - RAID_ENGAGE_RANGE_TILES) * TILE_SIZE;
  const travel = Math.ceil(((px * RAID_TRAVEL_SLACK) / slowest) * TICK_RATE) + RAID_TRAVEL_MARGIN_TICKS;
  const arrival = nightfallTick + Math.floor(Math.random() * NIGHT_TICKS * RAID_ARRIVAL_WINDOW_FRACTION);
  return Math.max(state.cycleTick, arrival - travel);
}

function spawnRaid(dayIndex: number) {
  const nightfallTick = dayIndex * (DAY_TICKS + NIGHT_TICKS) + DAY_TICKS;
  const total = raidSizeForDay(dayIndex);
  const eligibleDeserters = Array.from(mobs.values()).filter(
    (m) =>
      m.isDeserter &&
      !m.deserterActive &&
      m.groupId === null &&
      state.cycleTick - m.deserterSinceTick >= DESERTER_ACTIVATION_TICKS
  );
  const deserterRoll = state.testForceDeserterRoll ?? Math.random() < DESERTER_WAVE_CHANCE;
  const deserters = eligibleDeserters.length > 0 && deserterRoll ? eligibleDeserters : [];
  const combined = Math.max(total, deserters.length);
  const hordeShare = randRange(RAID_HORDE_SHARE_MIN, RAID_HORDE_SHARE_MAX);
  const hordeSize = Math.max(deserters.length, Math.min(combined, Math.ceil(combined * hordeShare)));
  const sizes = splitRaidGroups(combined, hordeSize);

  const occupied = new Set<number>();
  for (const m of mobs.values()) {
    const t = tileOfPixel(m.x, m.y);
    occupied.add(tileIndex(t.x, t.y));
  }

  const siegeLeft: Partial<Record<SiegeKind, number>> = {};
  for (const k of SIEGE_KINDS) siegeLeft[k] = isRaidKindUnlocked(k, dayIndex) ? raidSiegeCap(dayIndex, k) : 0;
  const markChance = hungerMarkChance(dayIndex);
  let marksLeft = markChance > 0 ? Math.max(1, Math.floor(combined / HUNGER_MARK_RAIDERS_PER_MARK)) : 0;
  const marked: Mob[] = [];
  let announceEdge: RaidEdge | null = null;
  sizes.forEach((size, i) => {
    const isHorde = i === 0;
    const group: RaidGroup = {
      id: randomUUID(),
      faction: deserters.length > 0 ? "banditBand" : pickRaidFaction(dayIndex),
      isHorde,
      edge: null,
      memberIds: [],
      homes: new Map(),
      aggroTick: state.testHoldRaidAggro
        ? nightfallTick
        : state.cycleTick + Math.floor(Math.random() * Math.max(1, nightfallTick - state.cycleTick)),
      state: "passive",
      leaderId: null,
      offsets: new Map(),
      repathCooldown: 0,
    };
    let freshCount = size;
    if (isHorde) {
      for (const d of deserters) {
        d.groupId = group.id;
        d.passive = true;
        d.path = [];
        group.memberIds.push(d.id);
      }
      freshCount -= deserters.length;
    }
    const anchor = freshCount > 0 ? randomRaidAnchor() : null;
    if (anchor) {
      group.edge = anchor.edge;
      for (const tile of clusterRaidTiles(anchor.tile, freshCount, occupied)) {
        const mob = createRaidMob(pickRaidFactionKind(group.faction, dayIndex, siegeLeft), tile, group.id);
        if (marksLeft > 0 && Math.random() < markChance) {
          applyHungerMark(mob, randInt(HungerMark.Gorrath, HungerMark.Vhorrun) as HungerMark);
          marksLeft--;
          marked.push(mob);
        }
        group.memberIds.push(mob.id);
        group.homes.set(mob.id, tile);
      }
      if (announceEdge === null) announceEdge = anchor.edge;
    }
    if (group.memberIds.length > 0) {
      if (anchor && !state.testHoldRaidAggro) group.aggroTick = raidDepartureTick(anchor.tile, group, nightfallTick);
      raidGroups.set(group.id, group);
    }
  });
  if (announceEdge) broadcastEvent("raid", `Raiders gather at the ${announceEdge} edge`);
  // One toast: the first marked elite by name, the rest as a count.
  if (marked.length > 0) {
    const first = marked[0];
    const more = marked.length > 1 ? `, with ${marked.length - 1} more Hunger-marked` : "";
    broadcastEvent("raid", `A ${hungerMarkLabel(first.mark)}-marked ${mobKindLabel(first.kind)} leads the raid${more}`);
  }
}

// Returns true when `m` was a still-dormant deserter (so the caller can announce the turn).
function releaseRaidMob(m: Mob): boolean {
  const turnedDeserter = m.isDeserter && !m.deserterActive;
  if (m.groupId) m.regimentId = m.groupId;
  m.groupId = null;
  m.passive = false;
  m.path = [];
  m.targetType = null;
  m.targetId = null;
  // Staggered so a whole horde breaking up doesn't pathfind on the same tick.
  m.repathCooldown = Math.floor(Math.random() * MOB_REPATH_TICKS);
  if (m.isDeserter) m.deserterActive = true;
  return turnedDeserter;
}

function announceDeserterTurn(count: number) {
  if (count > 0) broadcastEvent("deserter", `The deserters have turned on the colony (${count})`);
}

function raidGroupMembers(group: RaidGroup): Mob[] {
  const members: Mob[] = [];
  for (const id of group.memberIds) {
    const m = mobs.get(id);
    if (m && m.groupId === group.id) members.push(m);
  }
  if (members.length !== group.memberIds.length) group.memberIds = members.map((m) => m.id);
  return members;
}

// Contact: the group breaks up row by row (front row now, each further row RAID_RELEASE_ROW_TICKS
// later; see releaseRaidRows) instead of all at once. A group that never marched has no rows and is
// released whole.
export function engageRaidGroup(group: RaidGroup) {
  if (group.engagedTick !== undefined) return;
  const leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  const members = raidGroupMembers(group);
  const anchor = leader && leader.groupId === group.id ? leader : members[0];
  group.engagedTick = state.cycleTick;
  group.anchorX = anchor?.x ?? 0;
  group.anchorY = anchor?.y ?? 0;
  releaseRaidRows(group, 0);
}

function raidMemberRow(group: RaidGroup, m: Mob): number {
  return group.state === "marching" ? (group.offsets.get(m.id)?.row ?? 0) : 0;
}

// Releases every member whose row is due; the rest hold their slot around the contact point. The
// group is deleted once everyone is out.
function releaseRaidRows(group: RaidGroup, dt: number) {
  const due = Math.floor((state.cycleTick - (group.engagedTick ?? state.cycleTick)) / RAID_RELEASE_ROW_TICKS);
  let turned = 0;
  for (const m of raidGroupMembers(group)) {
    if (raidMemberRow(group, m) <= due) {
      if (releaseRaidMob(m)) turned++;
      continue;
    }
    const offset = group.offsets.get(m.id);
    if (offset && dt > 0) {
      const p = formationPoint(group, group.anchorX ?? m.x, group.anchorY ?? m.y, offset);
      stepRaidMobToward(m, p.x, p.y, m.speed, dt);
    }
  }
  announceDeserterTurn(turned);
  if (raidGroupMembers(group).length === 0) raidGroups.delete(group.id);
}

function isHeavyMobKind(kind: MobKind): boolean {
  return kind === "troll" || kind === "ogre";
}

// Heading-relative slots for `count` members, front row first, each row's slots centre-out:
// x = lateral (right of the heading), y = distance behind the front row.
//   wedge  (wolves)               - row r holds r + 1 slots, loosely spaced (naturally staggered).
//   line   (bandits)              - wide rows, every other row shifted half a spacing.
//   column (greenskins, dark host) - narrow rows (2-4 wide), every other row shifted half a spacing.
function raidFormationSlots(shape: RaidFormationShape, count: number, spacing: number): { x: number; y: number; row: number }[] {
  const slots: { x: number; y: number; row: number }[] = [];
  const width =
    shape === "line" ? Math.max(2, Math.ceil(Math.sqrt(count * 2.5)))
    : shape === "column" ? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count / 2))))
    : 0;
  const gap = shape === "wedge" ? spacing * RAID_WEDGE_LOOSENESS : spacing;
  for (let row = 0; slots.length < count; row++) {
    const w = shape === "wedge" ? row + 1 : width;
    const shift = shape !== "wedge" && row % 2 === 1 ? gap / 2 : 0;
    const rowSlots: { x: number; y: number; row: number }[] = [];
    for (let i = 0; i < w; i++) rowSlots.push({ x: (i - (w - 1) / 2) * gap + shift, y: row * gap * 0.9, row });
    rowSlots.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    for (const slot of rowSlots) if (slots.length < count) slots.push(slot);
  }
  return slots;
}

// World position of a heading-relative formation offset from (ox, oy).
function formationPoint(group: RaidGroup, ox: number, oy: number, offset: { x: number; y: number }): { x: number; y: number } {
  const fx = group.headingX ?? 1;
  const fy = group.headingY ?? 0;
  // Right of the heading in screen space (y down): (-fy, fx).
  return { x: ox - fy * offset.x - fx * offset.y, y: oy + fx * offset.x - fy * offset.y };
}
function assignRaidLeader(group: RaidGroup): Mob | null {
  const members = raidGroupMembers(group);
  if (members.length === 0) return null;
  const front = members.filter((m) => !isRearMob(m));
  const rear = front.length > 0 ? members.filter((m) => isRearMob(m)) : [];
  const line = front.length > 0 ? front : members;
  const leader = line.reduce((slowest, m) => (m.speed < slowest.speed ? m : slowest));
  group.leaderId = leader.id;
  group.repathCooldown = 0;
  group.offsets.clear();
  const meanR = members.reduce((sum, m) => sum + mobBodyRadius(m), 0) / members.length;
  const spacing = RAID_FORMATION_SPACING_BODIES * 2 * Math.min(12, Math.max(7, meanR));
  const slots = raidFormationSlots(RAID_FORMATION_SHAPE[group.faction] ?? "column", line.length, spacing);
  const origin = slots[0];
  const free = slots.slice(1);
  const take = (m: Mob, slot: { x: number; y: number; row: number }) =>
    group.offsets.set(m.id, { x: slot.x - origin.x, y: slot.y - origin.y, row: slot.row });
  // Shock, heavies and the ram take the front-centre slots.
  const rank = (m: Mob) => (mobRole(m) === "shock" || mobRole(m) === "siege" || isHeavyMobKind(m.kind) ? 0 : m.melee ? 1 : 2);
  const followers = line.filter((m) => m !== leader);
  // Fast roles take the wing slots (widest first, front rows first); the rest fill in formation order.
  const wings = free.slice().sort((a, b) => Math.abs(b.x - origin.x) - Math.abs(a.x - origin.x) || a.row - b.row);
  const used = new Set<{ x: number; y: number; row: number }>();
  for (const m of followers.filter((f) => mobRole(f) === "fast")) {
    const slot = wings.find((w) => !used.has(w));
    if (!slot) break;
    used.add(slot);
    take(m, slot);
  }
  const rest = free.filter((sl) => !used.has(sl));
  followers
    .filter((f) => !group.offsets.has(f.id))
    .sort((a, b) => rank(a) - rank(b))
    .forEach((m, i) => take(m, rest[i]));
  if (rear.length > 0) {
    const frontWidth = slots.filter((sl) => sl.row === 0).length;
    const lastRow = slots.reduce((r, sl) => Math.max(r, sl.row), 0);
    const backY = slots.reduce((y, sl) => Math.max(y, sl.y), 0);
    const y0 = Math.max(backY + spacing, RAID_REAR_RANK_TILES * TILE_SIZE);
    const width = Math.min(rear.length, Math.max(2, frontWidth));
    rear.forEach((m, i) => {
      const r = Math.floor(i / width);
      const inRow = Math.min(width, rear.length - r * width);
      const k = i % width;
      // Centre-out within the row: 0, +1, -1, +2, ...
      const col = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
      const centre = inRow % 2 === 0 ? spacing / 2 : 0;
      group.offsets.set(m.id, { x: col * spacing - centre - origin.x, y: y0 + r * spacing - origin.y, row: lastRow + 1 + r });
    });
  }
  return leader;
}

function startRaidGroupMarch(group: RaidGroup) {
  group.state = "marching";
  // Deserters are already inside the colony: they turn on it from where they stand.
  let turned = 0;
  for (const m of raidGroupMembers(group)) {
    if (m.isDeserter) {
      if (releaseRaidMob(m)) turned++;
    } else {
      m.passive = false;
      m.path = [];
    }
  }
  announceDeserterTurn(turned);
  if (raidGroupMembers(group).length === 0) {
    raidGroups.delete(group.id);
    return;
  }
  if (group.isHorde) broadcastEvent("raid", "The horde marches on the colony");
  assignRaidLeader(group);
}

function loiterRaidMob(group: RaidGroup, m: Mob, members: Mob[], dt: number) {
  if (m.isDeserter) return;
  if (m.path.length > 0) {
    advanceAlongPath(m, dt, m.speed * 0.5);
    return;
  }
  if (Math.random() >= RAID_LOITER_CHANCE_PER_TICK) return;
  const home = group.homes.get(m.id);
  if (!home) return;
  const here = tileOfPixel(m.x, m.y);
  const dir = Math.floor(Math.random() * 4);
  const n = {
    x: here.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0),
    y: here.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0),
  };
  if (!isWalkableTile(n.x, n.y)) return;
  if (Math.max(Math.abs(n.x - home.x), Math.abs(n.y - home.y)) > RAID_LOITER_RADIUS_TILES) return;
  // Keep to one mob per tile: skip a tile a groupmate stands on or is stepping to.
  for (const other of members) {
    if (other === m) continue;
    const t = other.path.length > 0 ? other.path[0] : tileOfPixel(other.x, other.y);
    if (t.x === n.x && t.y === n.y) return;
  }
  m.path = [n];
}

// Where a marching group heads: the Town Center while it stands unwarded, otherwise whatever the
// leader would target on its own. null (nothing targetable, e.g. all warded) means hold position.
function raidMarchGoal(leader: Mob): { x: number; y: number } | null {
  const nearest = nearestTownCenter(leader.x, leader.y);
  const tc = nearest ? resolveTargetPosition("townCenter", resourceKey(nearest.x, nearest.y)) : null;
  if (tc && !isWarded(tc.x, tc.y, activeWardSources())) return tc;
  const picked = pickMobTarget(leader);
  return picked ? resolveTargetPosition(picked.type, picked.id) : null;
}

function raidGroupShouldEngage(leader: Mob, goal: { x: number; y: number }): boolean {
  const range = RAID_ENGAGE_RANGE_TILES * TILE_SIZE;
  if (Math.hypot(goal.x - leader.x, goal.y - leader.y) <= range) return true;
  const wards = activeWardSources();
  // Houses and other buildings met on the way are attacked first (see MOB_BUILDING_AGGRO_TILES).
  if (buildingNearby(leader.x, leader.y, Infinity, wards)) return true;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (Math.hypot(c.x - leader.x, c.y - leader.y) <= range && !isWarded(c.x, c.y, wards)) return true;
  }
  for (const p of players.values()) {
    if (p.dead) continue;
    if (Math.hypot(p.x - leader.x, p.y - leader.y) <= range && !isWarded(p.x, p.y, wards)) return true;
  }
  return false;
}

// Straight-line step toward (tx, ty); false (and no move) if the step would enter a solid tile.
export function stepRaidMobToward(m: { x: number; y: number }, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const step = Math.min(d, speed * biomeSpeedMultiplier(m.x, m.y) * dt);
  const nx = m.x + (dx / d) * step;
  const ny = m.y + (dy / d) * step;
  if (!isWalkableTile(Math.floor(nx / TILE_SIZE), Math.floor(ny / TILE_SIZE))) return false;
  m.x = nx;
  m.y = ny;
  return true;
}

// Followers don't pathfind while they can walk straight to their slot (or the leader); only a
// follower blocked both ways gets a short path to the leader, rate-limited by MOB_REPATH_TICKS.
function moveRaidFollower(group: RaidGroup, m: Mob, leader: Mob, offset: { x: number; y: number }, pace: number, dt: number) {
  const speed = Math.min(m.speed, pace * RAID_FOLLOWER_CATCHUP);
  if (m.path.length > 0) {
    advanceAlongPath(m, dt, speed);
    return;
  }
  if (m.repathCooldown > 0) m.repathCooldown--;
  const slot = formationPoint(group, leader.x, leader.y, offset);
  if (stepRaidMobToward(m, slot.x, slot.y, speed, dt)) return;
  if (stepRaidMobToward(m, leader.x, leader.y, speed, dt)) return;
  if (m.repathCooldown <= 0) {
    m.path = findPath(tileOfPixel(m.x, m.y), tileOfPixel(leader.x, leader.y)) ?? [];
    m.repathCooldown = MOB_REPATH_TICKS;
  }
}

// Arrived before nightfall: stand in formation just outside contact range, passive (no attacking, not
// shot by towers or soldiers) until night falls; marchRaidGroup then engages. An attack engages at once.
function holdRaidGroup(group: RaidGroup, leader: Mob, dt: number) {
  leader.path = [];
  for (const m of raidGroupMembers(group)) {
    m.passive = true;
    if (m === leader) continue;
    const offset = group.offsets.get(m.id);
    if (offset) {
      const p = formationPoint(group, leader.x, leader.y, offset);
      stepRaidMobToward(m, p.x, p.y, Math.min(m.speed, leader.speed * RAID_FOLLOWER_CATCHUP), dt);
    }
  }
}

function marchRaidGroup(group: RaidGroup, dt: number) {
  let leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  if (!leader || leader.groupId !== group.id) leader = assignRaidLeader(group) ?? undefined;
  if (!leader) return;
  const goal = raidMarchGoal(leader);
  if (!goal) return;
  if (raidGroupShouldEngage(leader, goal)) {
    if (isNightNow()) engageRaidGroup(group);
    else holdRaidGroup(group, leader, dt);
    return;
  }
  if (leader.passive) for (const m of raidGroupMembers(group)) m.passive = false;
  if (leader.passive) for (const m of raidGroupMembers(group)) m.passive = false;
  if (group.repathCooldown > 0) group.repathCooldown--;
  // One shared path per group, refreshed every RAID_MARCH_REPATH_TICKS rather than every member
  // searching the map every second.
  if (leader.path.length === 0 && group.repathCooldown <= 0) {
    const route = findPath(tileOfPixel(leader.x, leader.y), tileOfPixel(goal.x, goal.y));
    // No route at all (a walled-in colony): the group breaks up and each mob picks its own target,
    // which breaches a wall when it has to (see pickBuildingTarget).
    if (!route) {
      if (isNightNow()) engageRaidGroup(group);
      else holdRaidGroup(group, leader, dt);
      return;
    }
    leader.path = route;
    group.repathCooldown = RAID_MARCH_REPATH_TICKS;
  }
  // Regiments: the whole group advances at its slowest member's pace (the leader is the slowest of the
  // front rank; a slower rear rank holds everyone back to it).
  const pace = raidGroupMembers(group).reduce((p, m) => Math.min(p, m.speed), leader.speed);
  const lx = leader.x;
  const ly = leader.y;
  if (group.headingX === undefined) {
    const d = Math.hypot(goal.x - lx, goal.y - ly) || 1;
    group.headingX = (goal.x - lx) / d;
    group.headingY = (goal.y - ly) / d;
  }
  advanceAlongPath(leader, dt, pace);
  const mx = leader.x - lx;
  const my = leader.y - ly;
  const moved = Math.hypot(mx, my);
  if (moved > 0.1) {
    const hx = (group.headingX ?? 1) * (1 - RAID_HEADING_SMOOTHING) + (mx / moved) * RAID_HEADING_SMOOTHING;
    const hy = (group.headingY ?? 0) * (1 - RAID_HEADING_SMOOTHING) + (my / moved) * RAID_HEADING_SMOOTHING;
    const h = Math.hypot(hx, hy) || 1;
    group.headingX = hx / h;
    group.headingY = hy / h;
  }
  for (const m of raidGroupMembers(group)) {
    if (m === leader) continue;
    const offset = group.offsets.get(m.id);
    if (offset) moveRaidFollower(group, m, leader, offset, pace, dt);
    else stepRaidMobToward(m, leader.x, leader.y, Math.min(m.speed, pace * RAID_FOLLOWER_CATCHUP), dt);
  }
}

function updateRaidGroups(dt: number) {
  const night = isNightNow();
  for (const group of raidGroups.values()) {
    const members = raidGroupMembers(group);
    if (members.length === 0) {
      raidGroups.delete(group.id);
      continue;
    }
    if (group.engagedTick !== undefined) {
      releaseRaidRows(group, dt);
      continue;
    }
    if (group.state === "passive") {
      if (state.cycleTick < group.aggroTick && !night) {
        for (const m of members) loiterRaidMob(group, m, members, dt);
        continue;
      }
      startRaidGroupMarch(group);
      if (!raidGroups.has(group.id)) continue;
    }
    marchRaidGroup(group, dt);
  }
}

export function regimentKey(m: Mob): string | null {
  return m.groupId ?? m.regimentId ?? m.siteId ?? null;
}

export function tacticsEvent(regiment: string, type: string, detail?: string) {
  tacticsEvents.push({ tick: state.cycleTick, type, regiment, detail });
  if (tacticsEvents.length > 200) tacticsEvents.shift();
}

// Bosses and Hunger-marked leaders: morale resistance for their regiment, and they never rout.
function isMoraleAnchor(m: Mob): boolean {
  return !!m.boss || m.mark !== HungerMark.None;
}

export function noteRegimentCasualty(m: Mob) {
  const key = regimentKey(m);
  const reg = key ? regiments.get(key) : undefined;
  if (!reg) return;
  const weight = isMoraleAnchor(m) ? MORALE_LEADER_WEIGHT : m.kind === "catapult" ? MORALE_ROLE_WEIGHT.ranged : MORALE_ROLE_WEIGHT[mobRole(m)];
  reg.pendingLoss += ((reg.raid ? RAID_MORALE_CASUALTY : MORALE_CASUALTY) * weight) / Math.max(3, reg.peak);
}

// The player's forces within radiusPx of (cx, cy): summed HP and damage per mob attack interval.
function playerForceNear(cx: number, cy: number, radiusPx: number): { hp: number; dmg: number; units: EnemyUnit[] } {
  let hp = 0;
  let dmg = 0;
  const units: EnemyUnit[] = [];
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind) || c.hp <= 0) continue;
    if (Math.abs(c.x - cx) > radiusPx || Math.abs(c.y - cy) > radiusPx || Math.hypot(c.x - cx, c.y - cy) > radiusPx) continue;
    const stats = unitStats(c);
    hp += c.hp;
    dmg += (stats.damage * MOB_ATTACK_COOLDOWN_TICKS) / Math.max(1, stats.cooldown);
    units.push({ type: "colonist", id: c.id, x: c.x, y: c.y, rear: isRearColonist(c) });
  }
  if (!state.testPlayersIgnored) {
    for (const p of players.values()) {
      if (p.dead || Math.hypot(p.x - cx, p.y - cy) > radiusPx) continue;
      hp += p.hp;
      dmg += playerDamage(p);
      units.push({ type: "player", id: p.id, x: p.x, y: p.y, rear: false });
    }
  }
  const t = tileOfPixel(cx, cy);
  for (const tw of livingTowersNear(t.x, t.y, radiusPx / TILE_SIZE, 0)) {
    hp += structureHp(tw.x, tw.y)?.hp ?? BUILDING_HP_BIG;
    dmg += (towerStatsForLevel(tw.level).damage * MOB_ATTACK_COOLDOWN_TICKS) / towerCooldownTicks(tw.level);
  }
  return { hp, dmg, units };
}

// The walkable tiles (mob's view: closed gates solid) reachable from `start` without passing
// COVER_ENCLOSURE_TILES from it, if they are closed off and at least one wall / gate closes them;
// barriers are the wall / gate tiles bordering them. null: open ground, or a gap / open gate (a breach).
function walledEnclosure(start: TileCoord): { tiles: TileCoord[]; barriers: TileCoord[] } | null {
  if (!isWalkableTile(start.x, start.y)) return null;
  const seen = new Set<number>([tileIndex(start.x, start.y)]);
  const barrierSeen = new Set<number>();
  const tilesOut: TileCoord[] = [start];
  const barriers: TileCoord[] = [];
  for (let i = 0; i < tilesOut.length; i++) {
    const t = tilesOut[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (!inBounds(n.x, n.y)) continue;
      const idx = tileIndex(n.x, n.y);
      if (seen.has(idx) || barrierSeen.has(idx)) continue;
      if (isWalkableTile(n.x, n.y)) {
        if (Math.max(Math.abs(n.x - start.x), Math.abs(n.y - start.y)) > COVER_ENCLOSURE_TILES) return null;
        seen.add(idx);
        tilesOut.push(n);
      } else {
        barrierSeen.add(idx);
        const tt = state.tiles[idx] as TileType;
        if (isWallTile(tt) || tt === TileType.Gate) barriers.push(n);
      }
    }
  }
  return barriers.length > 0 ? { tiles: tilesOut, barriers } : null;
}

function enclosureBreached(e: { barriers: TileCoord[] }): boolean {
  return e.barriers.some((b) => {
    const s = structureHp(b.x, b.y);
    return !!s && s.hp < s.max * COVER_BREACH_HP_FRACTION;
  });
}

// Where the regiment shelters: from its walled site's home, else (mobs already inside walls) from the
// member nearest its centroid. Only regiments that own walls (walledSites / SITE_KIND_WALLED) or stand
// inside a walled enclosure get one.
function regimentShelter(reg: RegimentState, members: Mob[], cx: number, cy: number) {
  const site = members.find((m) => m.siteId)?.siteKind ?? null;
  if (walledSites.has(reg.id) || (site && SITE_KIND_WALLED[site])) {
    const e = walledEnclosure(tileOfPixel(reg.homeX, reg.homeY));
    if (e) return e;
  }
  const near = members.reduce((b, m) => (Math.hypot(m.x - cx, m.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? m : b));
  return walledEnclosure(tileOfPixel(near.x, near.y));
}

// Posts inside the shelter: ranged / casters on the wall-side tiles nearest the enemy (fire over the
// wall), melee on the tiles nearest a gate (or the enemy, with no gate) to hold the way in.
function assignShelterPosts(reg: RegimentState, members: Mob[], e: { tiles: TileCoord[]; barriers: TileCoord[] }, ex: number, ey: number) {
  reg.posts.clear();
  const used = new Set<string>();
  const barrierKeys = new Set(e.barriers.map((b) => resourceKey(b.x, b.y)));
  const gatesIn = e.barriers.filter((b) => state.tiles[tileIndex(b.x, b.y)] === TileType.Gate);
  const enemyTile = { x: ex / TILE_SIZE, y: ey / TILE_SIZE };
  const byWall = e.tiles
    .filter((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => barrierKeys.has(resourceKey(t.x + dx, t.y + dy))))
    .sort((a, b) => tileDistance(a, enemyTile) - tileDistance(b, enemyTile));
  const toward = gatesIn.length > 0 ? gatesIn : [{ x: Math.floor(enemyTile.x), y: Math.floor(enemyTile.y) }];
  const byGate = e.tiles
    .slice()
    .sort((a, b) => Math.min(...toward.map((g) => tileDistance(a, g))) - Math.min(...toward.map((g) => tileDistance(b, g))));
  for (const m of members) {
    const list = m.melee ? byGate : byWall.length > 0 ? byWall : byGate;
    const post = list.find((t) => !used.has(resourceKey(t.x, t.y)));
    if (!post) continue;
    used.add(resourceKey(post.x, post.y));
    reg.posts.set(m.id, post);
  }
}

// A point on the map edge straight away from (ax, ay) as seen from the mob (the nearest edge when
// they coincide); a walkable tile near it when there is one.
function fleeEdgePoint(m: Mob, ax: number, ay: number): { x: number; y: number } {
  const t = tileOfPixel(m.x, m.y);
  let vx = m.x - ax;
  let vy = m.y - ay;
  if (Math.hypot(vx, vy) < 1) {
    const dW = t.x;
    const dE = state.WORLD_TILES_X - 1 - t.x;
    const dN = t.y;
    const dS = state.WORLD_TILES_Y - 1 - t.y;
    const min = Math.min(dW, dE, dN, dS);
    vx = min === dW ? -1 : min === dE ? 1 : 0;
    vy = vx !== 0 ? 0 : min === dN ? -1 : 1;
  }
  const maxX = state.WORLD_TILES_X - 1;
  const maxY = state.WORLD_TILES_Y - 1;
  const tx = vx > 0 ? (maxX - t.x) / vx : vx < 0 ? -t.x / vx : Infinity;
  const ty = vy > 0 ? (maxY - t.y) / vy : vy < 0 ? -t.y / vy : Infinity;
  const k = Math.min(tx, ty);
  const e = {
    x: Math.min(maxX, Math.max(0, Math.round(t.x + vx * k))),
    y: Math.min(maxY, Math.max(0, Math.round(t.y + vy * k))),
  };
  const alongX = tx > ty; // hit the north / south edge: search along x
  for (let d = 0; d <= 10; d++) {
    for (const s of [d, -d]) {
      const x = alongX ? Math.min(maxX, Math.max(0, e.x + s)) : e.x;
      const y = alongX ? e.y : Math.min(maxY, Math.max(0, e.y + s));
      if (isWalkableTile(x, y)) return tileToPixelCenter({ x, y });
    }
  }
  return tileToPixelCenter(e);
}

function despawnMob(m: Mob) {
  mobs.delete(m.id);
  releaseSlot(m.id);
  mobsWithoutRoute.delete(m.id);
}

function clearMobTarget(m: Mob) {
  m.targetType = null;
  m.targetId = null;
  m.path = [];
  releaseSlot(m.id);
}

function startRout(reg: RegimentState, members: Mob[], ex: number, ey: number, toast = true) {
  reg.routed = true;
  reg.sheltering = false;
  reg.flankIds = [];
  tacticsEvent(reg.id, "rout", `morale ${reg.morale.toFixed(0)}`);
  // A raid group still (partly) in formation breaks up at once; the raid's bookkeeping drops it.
  const group = raidGroups.get(reg.id);
  if (group) {
    for (const m of raidGroupMembers(group)) releaseRaidMob(m);
    raidGroups.delete(group.id);
  }
  for (const m of members) {
    if (isMoraleAnchor(m)) continue;
    clearMobTarget(m);
    m.tactic = reg.raid ? "leave" : "rout";
    m.flanker = false;
    if (reg.raid) {
      const edge = fleeEdgePoint(m, ex, ey);
      m.fleeX = edge.x;
      m.fleeY = edge.y;
      m.leaveUntilTick = state.cycleTick + RAID_LEAVE_MAX_TICKS;
    }
  }
  if (toast && reg.raid && state.cycleTick - state.lastRoutToastTick >= ROUT_TOAST_COOLDOWN_TICKS) {
    state.lastRoutToastTick = state.cycleTick;
    broadcastEvent("raid", "The raiders break and flee!");
  }
}

// Flank group: the regiment's fast units (or a detachment of its front line's wing) go round the end of
// an enemy line that is wider than the fight, to its archers (else the line's end unit).
function tryFlank(reg: RegimentState, members: Mob[], units: EnemyUnit[], cx: number, cy: number) {
  reg.flankIds = reg.flankIds.filter((id) => mobs.get(id)?.tactic === "flank");
  if (reg.flankIds.length > 0) return;
  const soldiers = units.filter((u) => u.type === "colonist");
  if (soldiers.length < 2) return;
  // A mob that already flanked once stays in the fight it was delivered to.
  const free = members.filter((m) => m.groupId === null && !m.tactic && !m.flanker);
  const engaged = free.filter((m) => {
    if (isRearMob(m) || m.targetType !== "colonist" || !m.targetId) return false;
    const c = colonists.get(m.targetId);
    return !!c && Math.hypot(c.x - m.x, c.y - m.y) <= m.range + FLANK_CONTACT_TILES * TILE_SIZE;
  });
  // Someone has to hold the front while the flank goes round (a pure wolf pack doesn't flank).
  if (engaged.length === 0 || !members.some((m) => !isRearMob(m) && mobRole(m) !== "fast")) return;
  const ex = soldiers.reduce((s, u) => s + u.x, 0) / soldiers.length;
  const ey = soldiers.reduce((s, u) => s + u.y, 0) / soldiers.length;
  const dl = Math.hypot(ex - cx, ey - cy) || 1;
  const dx = (ex - cx) / dl;
  const dy = (ey - cy) / dl;
  const lx = -dy;
  const ly = dx;
  const lat = (p: { x: number; y: number }) => (p.x - ex) * lx + (p.y - ey) * ly;
  const dep = (p: { x: number; y: number }) => (p.x - ex) * dx + (p.y - ey) * dy;
  const lo = Math.min(...soldiers.map(lat));
  const hi = Math.max(...soldiers.map(lat));
  // The fight's width: the front-rank members already trading blows (none yet: 0).
  const inMelee = engaged.filter((m) => {
    const c = colonists.get(m.targetId!);
    return mobRole(m) !== "fast" && !!c && Math.hypot(c.x - m.x, c.y - m.y) <= m.range + TILE_SIZE * 0.5;
  });
  const elo = inMelee.length > 0 ? Math.min(...inMelee.map(lat)) : 0;
  const ehi = inMelee.length > 0 ? Math.max(...inMelee.map(lat)) : 0;
  // The line must be a line, and wider than the fight; a regiment already past it is surrounding it.
  if (hi - lo < 2 * TILE_SIZE || hi - lo <= ehi - elo) return;
  if (members.some((m) => dep(m) > TILE_SIZE)) return;
  const back = Math.max(...soldiers.map(dep));
  const fast = free.filter((m) => mobRole(m) === "fast" && !isMoraleAnchor(m));
  // Siege engines never go round a flank.
  const front = free.filter((m) => !isRearMob(m) && mobRole(m) !== "fast" && mobRole(m) !== "siege" && !isMoraleAnchor(m));
  const prefer = fast.length > 0 ? Math.sign(fast.reduce((s, m) => s + lat(m), 0)) || 1 : 1;
  for (const s of [prefer, -prefer]) {
    const end = s > 0 ? hi : lo;
    const out = end + s * FLANK_ARC_TILES * TILE_SIZE;
    // Out to the side on its own side of the line first, then level with the line, then behind it.
    const ahead = Math.min(dl, 4 * TILE_SIZE);
    const w0 = { x: ex + lx * out - dx * ahead, y: ey + ly * out - dy * ahead };
    const w1 = { x: ex + lx * out, y: ey + ly * out };
    const along = end + s * FLANK_ARC_TILES * TILE_SIZE * 0.5;
    const behind = back + FLANK_BEHIND_TILES * TILE_SIZE;
    const w2 = { x: ex + lx * along + dx * behind, y: ey + ly * along + dy * behind };
    // Open flank: the arc's points and the ground between them are walkable and on the map.
    const probes = [w0, w1, w2, { x: (w1.x + w2.x) / 2, y: (w1.y + w2.y) / 2 }, { x: ex + lx * (end + s * TILE_SIZE * 3), y: ey + ly * (end + s * TILE_SIZE * 3) }];
    if (!probes.every((p) => { const t = tileOfPixel(p.x, p.y); return isWalkableTile(t.x, t.y); })) continue;
    let flankers = fast;
    if (flankers.length === 0) {
      if (front.length < FLANK_MIN_FRONT_FOR_DETACH) return;
      const n = Math.max(1, Math.round(front.length * FLANK_DETACH_FRACTION));
      flankers = front.slice().sort((a, b) => s * lat(b) - s * lat(a)).slice(0, n);
    }
    const rear = soldiers.filter((u) => u.rear);
    const pool = rear.length > 0 ? rear : soldiers;
    const target = rear.length > 0
      ? pool.reduce((b, u) => (Math.hypot(u.x - w2.x, u.y - w2.y) < Math.hypot(b.x - w2.x, b.y - w2.y) ? u : b))
      : pool.reduce((b, u) => (s * lat(u) > s * lat(b) ? u : b));
    for (const m of flankers) {
      clearMobTarget(m);
      m.tactic = "flank";
      m.flankWaypoints = [w0, w1, w2];
      m.flankTargetId = target.id;
      m.flankUntilTick = state.cycleTick + FLANK_MAX_TICKS;
      m.repathCooldown = 0;
      reg.flankIds.push(m.id);
    }
    tacticsEvent(reg.id, "flank", `${flankers.length} (${flankers.map((m) => m.kind).join(",")}) side ${s}`);
    return;
  }
}

function evaluateRegiment(reg: RegimentState, members: Mob[]) {
  let cx = 0;
  let cy = 0;
  for (const m of members) {
    cx += m.x / members.length;
    cy += m.y / members.length;
  }
  reg.peak = Math.max(reg.peak, members.length);
  const spread = Math.min(TACTICS_SPREAD_CAP_TILES * TILE_SIZE, Math.max(...members.map((m) => Math.hypot(m.x - cx, m.y - cy))));
  const enemy = playerForceNear(cx, cy, TACTICS_SCAN_TILES * TILE_SIZE + spread);
  const hp = members.reduce((s, m) => s + Math.max(0, m.hp), 0);
  const dmg = members.reduce((s, m) => s + m.damage, 0);
  // Lanchester-style strength (summed HP x summed damage), so numbers count as they do in a melee.
  const enemyPower = enemy.hp * enemy.dmg;
  const contact = enemyPower > 0;
  reg.ratio = contact ? (hp * dmg) / enemyPower : Infinity;
  let ex = cx;
  let ey = cy;
  if (enemy.units.length > 0) {
    ex = enemy.units.reduce((s, u) => s + u.x, 0) / enemy.units.length;
    ey = enemy.units.reduce((s, u) => s + u.y, 0) / enemy.units.length;
  }

  // Morale.
  const anchored = members.some(isMoraleAnchor);
  if (anchored) reg.hadAnchor = true;
  if (contact && reg.firstContactTick === -Infinity) reg.firstContactTick = state.cycleTick;
  if (!state.testMoraleFrozen) {
    let delta = 0;
    if (contact) {
      reg.lastContactTick = state.cycleTick;
      delta -= reg.pendingLoss;
      if (members.some((m) => !isRearMob(m))) reg.hadFront = true;
      else if (reg.hadFront) delta -= reg.raid ? RAID_MORALE_FRONT_LOST_PER_SEC : MORALE_FRONT_LOST_PER_SEC;
      // Outflanked: an enemy within 4 tiles of a member on the far side of the regiment.
      const dl = Math.hypot(ex - cx, ey - cy) || 1;
      const outflanked = enemy.units.some(
        (u) => ((u.x - cx) * (ex - cx) + (u.y - cy) * (ey - cy)) / dl < -TILE_SIZE &&
          members.some((m) => Math.hypot(m.x - u.x, m.y - u.y) <= 4 * TILE_SIZE)
      );
      if (outflanked) {
        delta -= reg.raid ? RAID_MORALE_OUTFLANKED_PER_SEC : MORALE_OUTFLANKED_PER_SEC;
        reg.outflankedTick = state.cycleTick;
      }
      if (reg.ratio < TACTICS_OUTNUMBERED_RATIO && !reg.sheltering) {
        delta -= (reg.raid ? RAID_MORALE_OUTNUMBERED_PER_SEC : MORALE_OUTNUMBERED_PER_SEC) * (1 - reg.ratio / TACTICS_OUTNUMBERED_RATIO);
      } else if (reg.ratio > MORALE_WINNING_RATIO) delta += MORALE_RECOVER_PER_SEC;
      if (delta < 0 && anchored) delta *= reg.raid ? RAID_MORALE_ANCHOR_RESIST : MORALE_ANCHOR_RESIST;
      // A raid's first seconds of contact cost no morale.
      if (reg.raid && state.cycleTick - reg.firstContactTick < RAID_MORALE_GRACE_TICKS) delta = Math.max(0, delta);
    } else {
      delta += MORALE_RECOVER_PER_SEC;
    }
    reg.morale = Math.max(0, Math.min(MORALE_MAX, reg.morale + delta));
  }
  reg.pendingLoss = 0;

  // Wall cover: shelter while clearly outnumbered and the walls hold; out again when the odds flip
  // or the walls are breached.
  if (reg.sheltering) {
    const e = regimentShelter(reg, members, cx, cy);
    if (!e || enclosureBreached(e) || reg.ratio > COVER_REENGAGE_RATIO) {
      reg.sheltering = false;
      reg.posts.clear();
      tacticsEvent(reg.id, "coverEnd", !e || enclosureBreached(e) ? "breach" : "odds");
    } else assignShelterPosts(reg, members, e, ex, ey);
  } else if (!reg.routed && contact && reg.ratio < TACTICS_OUTNUMBERED_RATIO) {
    const e = regimentShelter(reg, members, cx, cy);
    if (e && !enclosureBreached(e)) {
      reg.sheltering = true;
      for (const m of members) if (m.tactic === "flank") m.tactic = null;
      reg.flankIds = [];
      assignShelterPosts(reg, members, e, ex, ey);
      tacticsEvent(reg.id, "cover", `${e.tiles.length} tiles`);
    }
  }

  // Rout / rally.
  // A raid breaks on morale only below its lower line, or once crushed (few left / its anchor dead).
  const crushed = reg.raid && contact && !state.testMoraleFrozen && (members.length <= RAID_CRUSHED_FRACTION * reg.peak || (reg.hadAnchor && !anchored));
  if (!reg.routed && !reg.sheltering && (reg.morale < (reg.raid ? RAID_MORALE_ROUT : MORALE_ROUT) || crushed)) startRout(reg, members, ex, ey);
  else if (reg.routed && !reg.raid && reg.morale > MORALE_RALLY && state.cycleTick - reg.lastContactTick >= MORALE_RALLY_QUIET_TICKS) {
    reg.routed = false;
    tacticsEvent(reg.id, "rally", `morale ${reg.morale.toFixed(0)}`);
  }
  for (const m of members) {
    if (!reg.routed && m.tactic === "rout") m.tactic = null;
    else if (reg.routed && !reg.raid && !m.tactic && !isMoraleAnchor(m) && m.groupId === null) {
      clearMobTarget(m);
      m.tactic = "rout";
    }
  }

  if (!reg.routed && !reg.sheltering && contact) tryFlank(reg, members, enemy.units, cx, cy);
}

function updateRegiments() {
  if (state.cycleTick % TACTICS_EVAL_TICKS !== 0) return;
  const byReg = new Map<string, Mob[]>();
  const seen = new Set<string>();
  for (const m of mobs.values()) {
    const key = regimentKey(m);
    if (!key) continue;
    seen.add(key);
    let reg = regiments.get(key);
    if (!reg) {
      reg = {
        id: key, morale: MORALE_MAX, peak: 0, routed: false, raid: !m.siteId, homeX: m.x, homeY: m.y,
        lastContactTick: -Infinity, firstContactTick: -Infinity, hadAnchor: false, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: Infinity,
      };
      regiments.set(key, reg);
    }
    if (isDormantGuardian(m) || m.passive || (m.isDeserter && !m.deserterActive)) continue;
    const list = byReg.get(key);
    if (list) list.push(m);
    else byReg.set(key, [m]);
  }
  for (const id of regiments.keys()) if (!seen.has(id)) regiments.delete(id);
  for (const [id, members] of byReg) evaluateRegiment(regiments.get(id)!, members);
}
// ---- Player regiment morale (strategy mode phase 6; docs PLAN-strategy-mode.md Phase 6). The mob model
// above, tuned gentler: the player's derived regiments (armyRegimentsNow ids) of PLAYER_MORALE_MIN_UNITS+
// fighting units (no heroes, no siege engines) lose morale in contact for casualties, being outnumbered
// (the colony's whole force near them counts, towers included), being outflanked (an enemy behind them, or
// a flank group running at a member) and losing their front rank, and get it back out of contact (faster
// near a Town Center) or while clearly winning. Drains are scaled down by anchors: a hero, a player or a
// knight near the centroid, a tower, walls and the Town Center. Below PLAYER_MORALE_WAVER the regiment is
// Wavering (warning toast, PLAYER_MORALE_WAVERING_DAMAGE); below PLAYER_MORALE_ROUT it routs: its units
// are put on a retreat to the nearest Town Center (phase 3 retreat: fights only when cornered) at rout
// speed and refuse orders until it rallies (PLAYER_MORALE_RALLY after PLAYER_ROUT_QUIET_TICKS quiet and
// PLAYER_ROUT_MIN_TICKS fleeing, or at the latest after PLAYER_ROUT_MAX_TICKS). Evaluated once a second.

export function isRoutedUnit(id: string): boolean {
  return routedUnits.has(id);
}

function clearPlayerMorale() {
  playerMorale.clear();
  moraleRegimentOfUnit.clear();
  routedUnits.clear();
}

// Units whose morale counts: fighting soldiers, not heroes (solo, anchors) or siege engines.
function moraleUnit(c: Colonist): boolean {
  return c.hp > 0 && isGuardOrMilitiaKind(c.kind) && c.kind !== "hero" && !isSiegeKind(c.kind);
}

export function notePlayerCasualty(c: Colonist) {
  const reg = playerMorale.get(moraleRegimentOfUnit.get(c.id) ?? "");
  if (!reg || !isGuardOrMilitiaKind(c.kind) || c.kind === "hero" || isSiegeKind(c.kind)) return;
  const role = colonistRole(c) ?? "frontline";
  reg.pendingLoss += (PLAYER_MORALE_CASUALTY * MORALE_ROLE_WEIGHT[role]) / Math.max(3, reg.peak);
}

export function moraleDamageMult(c: Colonist): number {
  const reg = playerMorale.get(moraleRegimentOfUnit.get(c.id) ?? "");
  return reg && reg.active && !reg.routed && reg.morale < PLAYER_MORALE_WAVER ? PLAYER_MORALE_WAVERING_DAMAGE : 1;
}

// Awake hostile mobs (not routing / leaving) within radiusPx: summed hp and damage per attack interval.
function mobForceNear(cx: number, cy: number, radiusPx: number): { hp: number; dmg: number; units: Mob[] } {
  let hp = 0;
  let dmg = 0;
  const units: Mob[] = [];
  for (const m of mobs.values()) {
    if (Math.abs(m.x - cx) > radiusPx || Math.abs(m.y - cy) > radiusPx) continue;
    if (m.hp <= 0 || m.passive || isDormantGuardian(m) || m.tactic === "rout" || m.tactic === "leave" || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - cx, m.y - cy) > radiusPx) continue;
    hp += m.hp;
    dmg += m.damage;
    units.push(m);
  }
  return { hp, dmg, units };
}

// The product of the drain multipliers that apply at (cx, cy) for this regiment.
function playerMoraleResist(members: Colonist[], cx: number, cy: number): number {
  let k = 1;
  const anchorPx = PLAYER_MORALE_ANCHOR_TILES * TILE_SIZE;
  let anchored = members.some((c) => c.kind === "knight");
  if (!anchored && !state.testPlayersIgnored) {
    for (const p of players.values()) if (!p.dead && Math.hypot(p.x - cx, p.y - cy) <= anchorPx) anchored = true;
  }
  if (!anchored) {
    for (const c of colonists.values()) {
      if ((c.kind === "hero" || c.kind === "knight") && c.hp > 0 && Math.abs(c.x - cx) <= anchorPx && Math.abs(c.y - cy) <= anchorPx && Math.hypot(c.x - cx, c.y - cy) <= anchorPx) {
        anchored = true;
        break;
      }
    }
  }
  if (anchored) k *= PLAYER_MORALE_ANCHOR_RESIST;
  const t = tileOfPixel(cx, cy);
  if (livingTowersNear(t.x, t.y, PLAYER_MORALE_TOWER_TILES, 0).length > 0) k *= PLAYER_MORALE_TOWER_RESIST;
  let walls = false;
  for (let dy = -PLAYER_MORALE_WALL_TILES; dy <= PLAYER_MORALE_WALL_TILES && !walls; dy++) {
    for (let dx = -PLAYER_MORALE_WALL_TILES; dx <= PLAYER_MORALE_WALL_TILES; dx++) {
      if (!inBounds(t.x + dx, t.y + dy)) continue;
      const tt = state.tiles[tileIndex(t.x + dx, t.y + dy)] as TileType;
      if (isWallTile(tt) || tt === TileType.Gate) {
        walls = true;
        break;
      }
    }
  }
  if (walls) k *= PLAYER_MORALE_WALL_RESIST;
  if (nearTownCenter(cx, cy)) k *= PLAYER_MORALE_TC_RESIST;
  return Math.max(PLAYER_MORALE_RESIST_FLOOR, k);
}

function nearTownCenter(x: number, y: number): boolean {
  const tc = nearestTownCenter(x, y);
  if (!tc) return false;
  const p = tileToPixelCenter(tc);
  return Math.hypot(p.x - x, p.y - y) <= PLAYER_MORALE_TC_TILES * TILE_SIZE;
}

function moraleToast(reg: PlayerMoraleState, text: string, force = false) {
  if (!force && state.cycleTick - reg.lastWarnTick < PLAYER_MORALE_TOAST_COOLDOWN_TICKS) return;
  reg.lastWarnTick = state.cycleTick;
  broadcastEvent("morale", text);
}

// The regiment breaks: every member retreats to the nearest Town Center as one order group.
function startPlayerRout(reg: PlayerMoraleState, members: Colonist[]) {
  reg.routed = true;
  reg.routedTick = state.cycleTick;
  tacticsEvent(reg.id, "playerRout", `morale ${reg.morale.toFixed(0)}`);
  moraleToast(reg, `${reg.name} is routing!`, true);
  for (const c of members) {
    routedUnits.set(c.id, { reg: reg.id, hadGroup: orderGroupOfUnit.has(c.id), rallyX: c.rallyX, rallyY: c.rallyY });
    leaveOrderGroup(c.id);
    dropGuardTarget(c);
  }
  const g: OrderGroup = {
    id: `g${state.nextOrderGroupId++}`, unitIds: new Set(members.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: state.cycleTick, engaged: false, clearSince: -1, followAt: null,
  };
  orderGroups.set(g.id, g);
  for (const c of members) orderGroupOfUnit.set(c.id, g);
  startArmyOrder(g, { kind: "retreat" });
}

function releaseRoutedUnit(id: string, r: { hadGroup: boolean; rallyX: number; rallyY: number }) {
  routedUnits.delete(id);
  if (r.hadGroup) return;
  leaveOrderGroup(id);
  const c = colonists.get(id);
  if (c) rallyUnit(c, r.rallyX, r.rallyY, null);
}

function evaluatePlayerRegiment(reg: PlayerMoraleState, members: Colonist[]) {
  const c0 = centroidOf(members);
  let spread = 0;
  for (const c of members) spread = Math.max(spread, Math.hypot(c.x - c0.x, c.y - c0.y));
  spread = Math.min(TACTICS_SPREAD_CAP_TILES * TILE_SIZE, spread);
  const radius = PLAYER_MORALE_SCAN_TILES * TILE_SIZE + spread;
  const enemy = mobForceNear(c0.x, c0.y, radius);
  const enemyPower = enemy.hp * enemy.dmg;
  const contact = enemyPower > 0;
  reg.outflanked = false;
  let delta = 0;
  if (contact) {
    if (state.cycleTick - reg.lastContactTick > PLAYER_MORALE_NEW_FIGHT_TICKS) reg.fightStartTick = state.cycleTick;
    reg.lastContactTick = state.cycleTick;
    if (!reg.routed) {
      const friend = playerForceNear(c0.x, c0.y, radius);
      const ratio = (friend.hp * friend.dmg) / enemyPower;
      reg.ratio = ratio;
      if (members.some((c) => !isRearColonist(c))) reg.hadFront = true;
      else if (reg.hadFront) delta -= PLAYER_MORALE_FRONT_LOST_PER_SEC;
      // Outflanked: an enemy beyond the regiment's far side (from the enemy centroid) within 4 tiles of a
      // member, or a flank group running at one of its members.
      const ex = enemy.units.reduce((s, m) => s + m.x, 0) / enemy.units.length;
      const ey = enemy.units.reduce((s, m) => s + m.y, 0) / enemy.units.length;
      const dl = Math.hypot(ex - c0.x, ey - c0.y) || 1;
      const ids = new Set(members.map((c) => c.id));
      reg.outflanked = enemy.units.some(
        (m) => (m.tactic === "flank" && !!m.flankTargetId && ids.has(m.flankTargetId)) ||
          (((m.x - c0.x) * (ex - c0.x) + (m.y - c0.y) * (ey - c0.y)) / dl < -TILE_SIZE &&
            members.some((c) => Math.abs(c.x - m.x) <= 4 * TILE_SIZE && Math.abs(c.y - m.y) <= 4 * TILE_SIZE && Math.hypot(c.x - m.x, c.y - m.y) <= 4 * TILE_SIZE))
      );
      if (reg.outflanked) delta -= PLAYER_MORALE_OUTFLANKED_PER_SEC;
      if (ratio < TACTICS_OUTNUMBERED_RATIO) delta -= PLAYER_MORALE_OUTNUMBERED_PER_SEC * (1 - ratio / TACTICS_OUTNUMBERED_RATIO);
      else if (ratio > MORALE_WINNING_RATIO) delta += PLAYER_MORALE_WINNING_PER_SEC;
      if (state.cycleTick - reg.fightStartTick < PLAYER_MORALE_GRACE_TICKS) delta = Math.max(0, delta);
      delta -= reg.pendingLoss;
      if (delta < 0) delta *= playerMoraleResist(members, c0.x, c0.y);
    }
  } else {
    delta += PLAYER_MORALE_RECOVER_PER_SEC * (nearTownCenter(c0.x, c0.y) ? PLAYER_MORALE_TC_RECOVER_MULT : 1);
  }
  reg.pendingLoss = 0;
  if (!state.testMoraleFrozen) reg.morale = Math.max(0, Math.min(MORALE_MAX, reg.morale + delta));

  if (!reg.routed) {
    if (reg.morale < PLAYER_MORALE_ROUT && contact && members.length >= PLAYER_MORALE_MIN_UNITS) {
      startPlayerRout(reg, members);
    } else if (reg.morale < PLAYER_MORALE_WAVER && delta < 0) {
      moraleToast(reg, `${reg.name} is wavering`);
    }
    return;
  }
  const fled = state.cycleTick - reg.routedTick;
  const quiet = state.cycleTick - reg.lastContactTick >= PLAYER_ROUT_QUIET_TICKS;
  if ((reg.morale >= PLAYER_MORALE_RALLY && quiet && fled >= PLAYER_ROUT_MIN_TICKS) || fled >= PLAYER_ROUT_MAX_TICKS) {
    reg.routed = false;
    reg.morale = Math.max(reg.morale, PLAYER_MORALE_RALLY);
    reg.hadFront = false;
    tacticsEvent(reg.id, "playerRally", `morale ${reg.morale.toFixed(0)}`);
    moraleToast(reg, `${reg.name} rallies`, true);
    for (const [id, r] of routedUnits) if (r.reg === reg.id) releaseRoutedUnit(id, r);
  }
}

function updatePlayerMorale() {
  if (state.cycleTick % TACTICS_EVAL_TICKS !== 0) return;
  moraleRegimentOfUnit.clear();
  const seen = new Set<string>();
  for (const r of armyRegimentsNow()) {
    if (r.cls === "hero" || r.cls === "rams" || r.cls === "catapults") continue;
    const members: Colonist[] = [];
    for (const id of r.unitIds) {
      const c = colonists.get(id);
      if (c && moraleUnit(c)) members.push(c);
    }
    if (members.length === 0) continue;
    seen.add(r.id);
    let reg = playerMorale.get(r.id);
    if (!reg) {
      reg = {
        id: r.id, name: r.name, morale: MORALE_MAX, peak: 0, active: false, routed: false, routedTick: -Infinity,
        lastContactTick: -Infinity, fightStartTick: -Infinity, pendingLoss: 0, hadFront: false, outflanked: false, lastWarnTick: -Infinity, ratio: Infinity,
      };
      playerMorale.set(r.id, reg);
    }
    reg.name = r.name;
    for (const c of members) moraleRegimentOfUnit.set(c.id, r.id);
    reg.active = members.length >= PLAYER_MORALE_MIN_UNITS || reg.routed;
    if (!reg.active) {
      // Too small to break: morale only recovers.
      reg.pendingLoss = 0;
      reg.outflanked = false;
      reg.morale = Math.min(MORALE_MAX, reg.morale + PLAYER_MORALE_RECOVER_PER_SEC);
      continue;
    }
    reg.peak = Math.max(reg.peak, members.length);
    evaluatePlayerRegiment(reg, members);
  }
  for (const id of playerMorale.keys()) if (!seen.has(id)) playerMorale.delete(id);
  // Routed units whose regiment is gone / rallied (or who are dead) are released.
  for (const [id, r] of routedUnits) {
    const c = colonists.get(id);
    if (!c) routedUnits.delete(id);
    else if (!playerMorale.get(r.reg)?.routed) releaseRoutedUnit(id, r);
  }
}

// Walks `mob` to (gx, gy) along a path (repathed every MOB_REPATH_TICKS); false when no route exists.
function walkMobTo(mob: Mob, gx: number, gy: number, speed: number, dt: number): boolean {
  if (mob.path.length === 0) {
    if (mob.repathCooldown > 0) {
      mob.repathCooldown--;
      return true;
    }
    mob.repathCooldown = MOB_REPATH_TICKS;
    const route = findPath(tileOfPixel(mob.x, mob.y), tileOfPixel(gx, gy));
    if (!route) return false;
    mob.path = route;
    if (route.length === 0) stepRaidMobToward(mob, gx, gy, speed, dt);
  }
  advanceAlongPath(mob, dt, speed);
  return true;
}

function nearestPlayerUnitWithin(mob: Mob, radiusPx: number): { type: MobTargetType; id: string } | null {
  let best: { type: MobTargetType; id: string } | null = null;
  let bestD = radiusPx;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d <= bestD) {
      bestD = d;
      best = { type: "colonist", id: c.id };
    }
  }
  if (!state.testPlayersIgnored) {
    for (const p of players.values()) {
      const d = Math.hypot(p.x - mob.x, p.y - mob.y);
      if (!p.dead && d <= bestD) {
        bestD = d;
        best = { type: "player", id: p.id };
      }
    }
  }
  return best;
}

// Per-mob tactics step, from updateMob. "handled": it moved the mob this tick; "hold": sheltering, a
// unit target in reach is set (updateMob fights it but never moves); null: ordinary behaviour.
export function mobTactic(mob: Mob, dt: number): "handled" | "hold" | null {
  const key = regimentKey(mob);
  const reg = key ? regiments.get(key) : undefined;
  if (mob.tactic === "leave") {
    const t = tileOfPixel(mob.x, mob.y);
    const onEdge = t.x <= 0 || t.y <= 0 || t.x >= state.WORLD_TILES_X - 1 || t.y >= state.WORLD_TILES_Y - 1;
    const gx = mob.fleeX ?? mob.x;
    const gy = mob.fleeY ?? mob.y;
    if (onEdge || state.cycleTick >= (mob.leaveUntilTick ?? 0) || Math.hypot(gx - mob.x, gy - mob.y) < TILE_SIZE * 0.75) {
      despawnMob(mob);
      if (key) tacticsEvent(key, "despawn", mob.kind);
      return "handled";
    }
    if (!walkMobTo(mob, gx, gy, mob.speed * ROUT_SPEED_FACTOR, dt)) {
      const threat = nearestMeleeSoldier(mob.x, mob.y, TILE_SIZE * 1.2);
      if (threat) return null;
      stepRaidMobToward(mob, gx, gy, mob.speed * ROUT_SPEED_FACTOR, dt);
    }
    return "handled";
  }
  if (mob.tactic === "rout") {
    if (!reg || !reg.routed) {
      mob.tactic = null;
      return null;
    }
    const threat = nearestMeleeSoldier(mob.x, mob.y, TILE_SIZE * 1.2);
    const home = Math.hypot(reg.homeX - mob.x, reg.homeY - mob.y) <= TILE_SIZE * 1.5;
    // Cornered (an attacker on it and nowhere left to run): it fights back.
    if (home) return threat ? null : "handled";
    if (!walkMobTo(mob, reg.homeX, reg.homeY, mob.speed * ROUT_SPEED_FACTOR, dt)) {
      if (threat) return null;
      mob.tactic = null;
    }
    return "handled";
  }
  if (mob.tactic === "flank") {
    const target = mob.flankTargetId ? colonists.get(mob.flankTargetId) : undefined;
    const wps = mob.flankWaypoints ?? [];
    if (!target || state.cycleTick > (mob.flankUntilTick ?? 0) || (reg && (reg.routed || reg.sheltering))) {
      mob.tactic = null;
      return null;
    }
    if (wps.length === 0 || (wps.length < 3 && Math.hypot(target.x - mob.x, target.y - mob.y) <= FLANK_ENGAGE_TILES * TILE_SIZE)) {
      mob.tactic = null;
      mob.flanker = true;
      mob.targetType = "colonist";
      mob.targetId = target.id;
      mob.path = [];
      mob.repathCooldown = 0;
      return null;
    }
    const wp = wps[0];
    if (Math.hypot(wp.x - mob.x, wp.y - mob.y) <= FLANK_WAYPOINT_REACH_PX) {
      wps.shift();
      mob.path = [];
      mob.repathCooldown = 0;
      return "handled";
    }
    if (!walkMobTo(mob, wp.x, wp.y, mob.speed, dt)) {
      wps.shift();
      mob.repathCooldown = 0;
    }
    return "handled";
  }
  if (reg?.sheltering) {
    const post = reg.posts.get(mob.id);
    const foe = nearestPlayerUnitWithin(mob, mob.range + (mob.melee ? TILE_SIZE * 0.5 : 0));
    if (foe) {
      if (mob.targetId !== foe.id) {
        clearMobTarget(mob);
        mob.targetType = foe.type;
        mob.targetId = foe.id;
      }
      return "hold";
    }
    if (mob.targetType) clearMobTarget(mob);
    if (post) {
      const p = tileToPixelCenter(post);
      if (Math.hypot(p.x - mob.x, p.y - mob.y) > TILE_SIZE * 0.4 && !walkMobTo(mob, p.x, p.y, mob.speed, dt)) {
        stepRaidMobToward(mob, p.x, p.y, mob.speed, dt);
      }
    }
    return "handled";
  }
  return null;
}

// ---- World generation: biomes, ponds, resource scatter, POI sites (ruins / encampments) ----

function isInAbbeyGrounds(tx: number, ty: number): boolean {
  if (!state.abbeyCenter) return false;
  return Math.max(Math.abs(tx - state.abbeyCenter.x), Math.abs(ty - state.abbeyCenter.y)) <= ABBEY_GROUNDS_RADIUS;
}

// World-gen grounds that resource scatter, forage, wildlife and tree regrowth keep off: the Abbey's
// and the Castle Ruin's.
export function isInReservedGrounds(tx: number, ty: number): boolean {
  return isInAbbeyGrounds(tx, ty) || isInCastleRuinGrounds(tx, ty);
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffled<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function latticeHash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1]: bilinear (smoothstepped) interpolation of a hashed lattice every
// `cellTiles` tiles, so neighboring tiles get similar jitter and edges wobble instead of speckling.
function edgeJitter(tx: number, ty: number, cellTiles: number, salt: number): number {
  const fx = tx / cellTiles;
  const fy = ty / cellTiles;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const top = latticeHash(ix, iy, salt) * (1 - sx) + latticeHash(ix + 1, iy, salt) * sx;
  const bottom = latticeHash(ix, iy + 1, salt) * (1 - sx) + latticeHash(ix + 1, iy + 1, salt) * sx;
  return (top * (1 - sy) + bottom * sy) * 2 - 1;
}

function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Rejection sampling, same retry-until-attempts-run-out convention as scatterResourceTiles: a
// random tile at least minSpawnDist from the Town Center and minSpacing from every `avoid` point.
function pickScatteredTile(
  minSpawnDist: number,
  minSpacing: number,
  avoid: TileCoord[],
  isValid?: (t: TileCoord) => boolean
): TileCoord | null {
  for (let attempts = 0; attempts < 1000; attempts++) {
    const t = { x: Math.floor(Math.random() * state.WORLD_TILES_X), y: Math.floor(Math.random() * state.WORLD_TILES_Y) };
    if (tileDistance(t, TOWN_CENTER_TILE) < minSpawnDist) continue;
    if (avoid.some((o) => tileDistance(o, t) < minSpacing)) continue;
    if (isValid && !isValid(t)) continue;
    return t;
  }
  return null;
}

function generateBiomes() {
  const seeds: { x: number; y: number; radius: number; biome: Biome }[] = [];
  for (let i = 0; i < state.BIOME_SEEDS_PER_KIND * 2; i++) {
    // Alternate so a crowded map that runs out of room still gets both kinds.
    const biome = i % 2 === 0 ? Biome.Hills : Biome.Swamp;
    const radius = randRange(BIOME_SEED_RADIUS_MIN, BIOME_SEED_RADIUS_MAX);
    const minSpawnDist = Math.max(
      SPAWN_CLEAR_RADIUS_TILES,
      radius + BIOME_EDGE_JITTER_TILES + SPAWN_PLAINS_RADIUS_TILES
    );
    const spot = pickScatteredTile(minSpawnDist, BIOME_SEED_MIN_SPACING, seeds);
    if (spot) seeds.push({ x: spot.x, y: spot.y, radius, biome });
  }
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      let nearest: (typeof seeds)[number] | null = null;
      let nearestDist = Infinity;
      for (const seed of seeds) {
        const d = Math.hypot(seed.x - tx, seed.y - ty);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = seed;
        }
      }
      const jitter = edgeJitter(tx, ty, BIOME_NOISE_CELL_TILES, state.worldNoiseSalt) * BIOME_EDGE_JITTER_TILES;
      state.biomes[tileIndex(tx, ty)] =
        nearest && nearestDist <= nearest.radius + jitter ? nearest.biome : Biome.Plains;
    }
  }
}

function generatePonds() {
  const count = randInt(state.POND_COUNT_MIN, state.POND_COUNT_MAX);
  const centers: TileCoord[] = [];
  for (let i = 0; i < count; i++) {
    const radius = randRange(POND_RADIUS_MIN, POND_RADIUS_MAX);
    const reach = Math.ceil(radius + POND_EDGE_JITTER_TILES);
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + reach,
      POND_MIN_SPACING,
      centers,
      (t) => state.tiles[tileIndex(t.x, t.y)] === TileType.Empty
    );
    if (!center) continue;
    centers.push(center);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const tx = center.x + dx;
        const ty = center.y + dy;
        if (!inBounds(tx, ty)) continue;
        const idx = tileIndex(tx, ty);
        if (state.tiles[idx] !== TileType.Empty) continue;
        const jitter = edgeJitter(tx, ty, POND_NOISE_CELL_TILES, state.worldNoiseSalt + 1) * POND_EDGE_JITTER_TILES;
        if (Math.hypot(dx, dy) <= radius + jitter) state.tiles[idx] = TileType.Water;
      }
    }
  }
}

function poiSiteFootprintClear(
  center: TileCoord,
  footprintRadius = POI_SITE_FOOTPRINT_RADIUS,
  waterClearance = POI_SITE_WATER_CLEARANCE
): boolean {
  for (let dx = -waterClearance; dx <= waterClearance; dx++) {
    for (let dy = -waterClearance; dy <= waterClearance; dy++) {
      const tx = center.x + dx;
      const ty = center.y + dy;
      const inFootprint = Math.max(Math.abs(dx), Math.abs(dy)) <= footprintRadius;
      if (!inBounds(tx, ty)) {
        if (inFootprint) return false;
        continue;
      }
      const tile = state.tiles[tileIndex(tx, ty)] as TileType;
      if (tile === TileType.Water) return false;
      if (inFootprint && tile !== TileType.Empty) return false;
    }
  }
  return true;
}

function spawnGuardian(kind: MobKind, tile: TileCoord, siteId: string, siteKind: PoiSiteKind, rollSize = true): Mob {
  const config = MOB_KIND_CONFIG[kind];
  const center = tileToPixelCenter(tile);
  const mob: Mob = {
    id: randomUUID(),
    kind,
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
    siteId,
    siteKind,
    guardianActive: false,
    groupId: null,
    passive: false,
    ...MOB_MARK_DEFAULTS,
  };
  applyMobSize(mob, rollSize);
  mobs.set(mob.id, mob);
  return mob;
}

function pickWeightedGuardianKind(weights: { kind: MobKind; weight: number }[]): MobKind {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll < 0) return w.kind;
  }
  return weights[0].kind;
}

function pickRuinGuardianKind(): MobKind {
  return pickWeightedGuardianKind(RUIN_GUARDIAN_WEIGHTS);
}

function pickEncampmentGuardianKind(): MobKind {
  return pickWeightedGuardianKind(ENCAMPMENT_GUARDIAN_WEIGHTS);
}

// One POI site: a centerpiece decoration tile, 0-3 extra decorations on its 8 neighbors, and a
// group of dormant guardians standing on free tiles next to that cluster, all sharing one siteId.
// Ruins and encampments differ only in the decoration tiles and guardian kinds.
function placePoiSite(siteKind: "ruin" | "encampment", center: TileCoord) {
  const siteId = randomUUID();
  const centerpiece =
    siteKind === "ruin" ? RUIN_CENTERPIECES[randInt(0, RUIN_CENTERPIECES.length - 1)] : TileType.PropCampfire;
  const extraCount = siteKind === "ruin" ? randInt(0, 2) : randInt(1, 3);
  const extraPool = siteKind === "ruin" ? RUIN_EXTRAS : ENCAMPMENT_EXTRAS;
  const decorations: TileCoord[] = [center];
  state.tiles[tileIndex(center.x, center.y)] = centerpiece;
  for (const offset of shuffled(NEIGHBORS_8).slice(0, extraCount)) {
    const t = { x: center.x + offset.x, y: center.y + offset.y };
    state.tiles[tileIndex(t.x, t.y)] = extraPool[randInt(0, extraPool.length - 1)];
    decorations.push(t);
  }

  const guardianSpots: TileCoord[] = [];
  for (let dx = -POI_SITE_FOOTPRINT_RADIUS; dx <= POI_SITE_FOOTPRINT_RADIUS; dx++) {
    for (let dy = -POI_SITE_FOOTPRINT_RADIUS; dy <= POI_SITE_FOOTPRINT_RADIUS; dy++) {
      const t = { x: center.x + dx, y: center.y + dy };
      if (state.tiles[tileIndex(t.x, t.y)] !== TileType.Empty) continue;
      if (decorations.some((d) => Math.max(Math.abs(d.x - t.x), Math.abs(d.y - t.y)) === 1)) {
        guardianSpots.push(t);
      }
    }
  }
  const guardianCount = siteKind === "ruin" ? randInt(2, 3) : randInt(2, 4);
  const kinds: MobKind[] = [];
  for (const spot of shuffled(guardianSpots).slice(0, guardianCount)) {
    kinds.push(spawnGuardian(siteKind === "ruin" ? pickRuinGuardianKind() : pickEncampmentGuardianKind(), spot, siteId, siteKind).kind);
  }
  // Camp hearths: a site kind with `hasHearth` gets a destroyable hearth on its centrepiece.
  if (SITE_KIND_HAS_HEARTH[siteKind]?.hasHearth) registerHearth(siteId, siteKind, center, kinds);
}

function generatePoiSites(siteKind: "ruin" | "encampment", count: number, placedSites: TileCoord[]) {
  for (let i = 0; i < count; i++) {
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + POI_SITE_FOOTPRINT_RADIUS,
      POI_SITE_MIN_SPACING,
      placedSites,
      poiSiteFootprintClear
    );
    if (!center) continue;
    placedSites.push(center);
    placePoiSite(siteKind, center);
  }
}

function hearthEvent(siteId: string, type: string, detail?: string) {
  hearthEvents.push({ tick: state.cycleTick, type, siteId, detail });
  if (hearthEvents.length > 100) hearthEvents.shift();
}

function campFaction(kinds: MobKind[]): string {
  if (kinds.some((k) => k.startsWith("bandit"))) return "bandit";
  if (kinds.some((k) => k === "orc" || k === "armoredOrc" || k.startsWith("goblin"))) return "orc";
  return "enemy";
}

function registerHearth(siteId: string, siteKind: PoiSiteKind, center: TileCoord, kinds: MobKind[]) {
  const maxHp = SITE_KIND_HAS_HEARTH[siteKind]?.hp ?? HEARTH_DEFAULT_HP;
  hearths.set(siteId, {
    siteId, siteKind, x: center.x, y: center.y, hp: maxHp, maxHp, destroyed: false, faction: campFaction(kinds), garrison: kinds.length,
  });
}

function standingHearthAt(tx: number, ty: number): HearthState | undefined {
  for (const h of hearths.values()) if (!h.destroyed && h.x === tx && h.y === ty) return h;
  return undefined;
}

function hostileStructureAt(index: number): boolean {
  if (!isHostileOwner(ownerAt(index))) return false;
  return structureHp(index % state.WORLD_TILES_X, Math.floor(index / state.WORLD_TILES_X)) !== null;
}

function attackObjectiveAt(tx: number, ty: number): AttackObjective | null {
  if (!inBounds(tx, ty)) return null;
  const h = standingHearthAt(tx, ty);
  if (h) return { id: h.siteId, x: h.x, y: h.y };
  const index = tileIndex(tx, ty);
  return hostileStructureAt(index) ? { id: STRUCTURE_TARGET_PREFIX + index, x: tx, y: ty } : null;
}

// The nearest hostile NPC structure within maxPx of (px, py) and within zonePx of (zx, zy); null if none.
function nearestHostileStructure(px: number, py: number, maxPx: number, zx = px, zy = py, zonePx = Infinity): AttackObjective | null {
  let best: AttackObjective | null = null;
  let bestD = maxPx;
  for (const index of tileOwner.keys()) {
    const x = index % state.WORLD_TILES_X;
    const y = Math.floor(index / state.WORLD_TILES_X);
    const c = tileToPixelCenter({ x, y });
    if (Math.abs(c.x - px) > bestD || Math.abs(c.y - py) > bestD) continue;
    const d = Math.hypot(c.x - px, c.y - py);
    if (d > bestD || Math.hypot(c.x - zx, c.y - zy) > zonePx || !hostileStructureAt(index)) continue;
    bestD = d;
    best = { id: STRUCTURE_TARGET_PREFIX + index, x, y };
  }
  return best;
}

// Old saves (no hearth records) and sites missing one: a full-HP hearth on the campfire nearest each
// hearth-kind site's guardians; a campfire left with no guardians gets one too (it only leaves loot).
function backfillHearths() {
  const claimed = new Set<number>();
  for (const h of hearths.values()) claimed.add(tileIndex(h.x, h.y));
  const sites = new Map<string, Mob[]>();
  for (const m of mobs.values()) {
    if (!m.siteId || !m.siteKind || !SITE_KIND_HAS_HEARTH[m.siteKind]?.hasHearth || hearths.has(m.siteId)) continue;
    const list = sites.get(m.siteId);
    if (list) list.push(m);
    else sites.set(m.siteId, [m]);
  }
  const campfires: TileCoord[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i] === TileType.PropCampfire && !claimed.has(i)) campfires.push({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) });
  }
  for (const [siteId, members] of sites) {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length / TILE_SIZE;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length / TILE_SIZE;
    let best: TileCoord | null = null;
    let bestD = POI_SITE_FOOTPRINT_RADIUS + 8;
    for (const f of campfires) {
      const d = Math.hypot(f.x + 0.5 - cx, f.y + 0.5 - cy);
      if (!claimed.has(tileIndex(f.x, f.y)) && d <= bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) continue;
    claimed.add(tileIndex(best.x, best.y));
    registerHearth(siteId, members[0].siteKind!, best, members.map((m) => m.kind));
  }
  for (const f of campfires) {
    if (claimed.has(tileIndex(f.x, f.y))) continue;
    registerHearth(randomUUID(), "encampment", f, ["banditClubman", "banditClubman"]);
  }
}

// Damage to a hearth from the colony's side; wakes its guardians (they defend it).
export function damageHearth(h: HearthState, amount: number, attackerKey?: string) {
  if (h.destroyed || amount <= 0) return;
  activateGuardianSite(h.siteId);
  h.hp -= amount;
  hearthEvent(h.siteId, "hit", `${amount.toFixed(1)} ${attackerKey ?? ""}`.trim());
  if (h.hp <= 0) destroyHearth(h, attackerKey);
}

function destroyHearth(h: HearthState, attackerKey?: string) {
  h.destroyed = true;
  h.hp = 0;
  state.campsDestroyed++;
  const centre = tileToPixelCenter(h);
  // The fire burns out: the hearth tile becomes scorched rubble, the camp's props around it burn away.
  state.tiles[tileIndex(h.x, h.y)] = TileType.RuinRubble;
  broadcastTileUpdate(h.x, h.y, TileType.RuinRubble);
  state.pendingEffects.push({ fromX: centre.x, fromY: centre.y, toX: centre.x, toY: centre.y, boulder: true });
  for (const o of NEIGHBORS_8) {
    const x = h.x + o.x;
    const y = h.y + o.y;
    if (!inBounds(x, y) || !ENCAMPMENT_EXTRAS.includes(state.tiles[tileIndex(x, y)] as TileType)) continue;
    state.tiles[tileIndex(x, y)] = TileType.Empty;
    broadcastTileUpdate(x, y, TileType.Empty);
    const p = tileToPixelCenter({ x, y });
    state.pendingEffects.push({ fromX: p.x, fromY: p.y, toX: p.x, toY: p.y, boulder: true });
  }
  // Every guardian of the site breaks: a "leave" rout away from the attackers (or the hearth).
  const members = Array.from(mobs.values()).filter((m) => m.siteId === h.siteId);
  if (members.length > 0) {
    for (const m of members) m.guardianActive = true;
    let reg = regiments.get(h.siteId);
    if (!reg) {
      reg = {
        id: h.siteId, morale: 0, peak: members.length, routed: false, raid: true, homeX: centre.x, homeY: centre.y,
        lastContactTick: state.cycleTick, firstContactTick: state.cycleTick, hadAnchor: false, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: 0,
      };
      regiments.set(h.siteId, reg);
    }
    reg.raid = true;
    reg.morale = 0;
    const enemy = playerForceNear(centre.x, centre.y, TACTICS_SCAN_TILES * TILE_SIZE);
    const ex = enemy.units.length > 0 ? enemy.units.reduce((s, u) => s + u.x, 0) / enemy.units.length : centre.x;
    const ey = enemy.units.length > 0 ? enemy.units.reduce((s, u) => s + u.y, 0) / enemy.units.length : centre.y;
    startRout(reg, members, ex, ey, false);
    // A broken camp has no anchor: its bosses / marked leaders flee with the rest.
    for (const m of members) {
      if (m.tactic === "leave") continue;
      clearMobTarget(m);
      m.tactic = "leave";
      m.flanker = false;
      const edge = fleeEdgePoint(m, ex, ey);
      m.fleeX = edge.x;
      m.fleeY = edge.y;
      m.leaveUntilTick = state.cycleTick + RAID_LEAVE_MAX_TICKS;
    }
  }
  const g = Math.max(1, h.garrison);
  const loot = {
    gold: HEARTH_LOOT_PER_GUARDIAN.gold * g,
    wood: HEARTH_LOOT_PER_GUARDIAN.wood * g,
    rock: HEARTH_LOOT_PER_GUARDIAN.rock * g,
    iron: HEARTH_LOOT_PER_GUARDIAN.iron * g,
  };
  stock.gold += loot.gold;
  stock.wood += loot.wood;
  stock.rock += loot.rock;
  stock.iron += loot.iron;
  // Armour & weapons: 1 + floor(garrison / 2) pieces of a weighted random tier.
  const gear = grantTieredEquipment(1 + Math.floor(g / 2), "hearth");
  hearthEvent(h.siteId, "destroyed", `${members.length} routed; loot ${JSON.stringify(loot)}; gear ${gear}`);
  broadcastEvent(
    "milestone",
    `The ${h.faction} camp breaks and scatters! Plundered ${loot.gold} gold, ${loot.wood} wood, ${loot.rock} rock, ${loot.iron} iron, ${gear}`
  );
  // Hero phases 1-2: RELIC_HEARTH_CHANCE of a relic (after the plunder toast).
  heroRelicForHearth(attackerKey);
}

// Flattened [tile index, hp permille] per standing hearth (snapshot `hearths`, HEARTH_SNAPSHOT_STRIDE).
function hearthsForSnapshot(): number[] {
  const out: number[] = [];
  for (const h of hearths.values()) {
    if (!h.destroyed) out.push(tileIndex(h.x, h.y), Math.max(0, Math.floor((h.hp / h.maxHp) * 1000)));
  }
  return out;
}

// The orthogonal walkable neighbour of a hearth nearest (px, py), else any walkable neighbour.
function hearthApproachTile(h: { x: number; y: number }, px: number, py: number): TileCoord | null {
  let best: TileCoord | null = null;
  let bestD = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = { x: h.x + dx, y: h.y + dy };
    if (!isWalkableTile(t.x, t.y)) continue;
    const p = tileToPixelCenter(t);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ?? findAdjacentWalkable(h.x, h.y);
}

// Commanded attack on a hearth: the units' rally moves to the hearth (so they defend that spot
// against its guardians, and hold there once it falls).
function handleCommandAttackHearth(unitIds: string[], tx: number, ty: number) {
  const h = attackObjectiveAt(tx, ty);
  if (!h) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind) || isRoutedUnit(c.id)) continue;
    if (!hearthApproachTile(h, c.x, c.y)) continue;
    leaveOrderGroup(c.id);
    sendAgainstHearth(c, h);
  }
}

// The unit's rally moves to the hearth's approach tile and it attacks the hearth (no-op without one).
function sendAgainstHearth(c: Colonist, h: AttackObjective) {
  const approach = hearthApproachTile(h, c.x, c.y);
  if (!approach) return;
  const p = tileToPixelCenter(approach);
  structureBreach.delete(c.id);
  c.targetHearthId = h.id;
  c.targetMobId = null;
  commandedTargets.delete(c.id);
  c.squadId = null;
  c.rallyTileX = approach.x;
  c.rallyTileY = approach.y;
  c.rallyX = p.x;
  c.rallyY = p.y;
  c.path = [];
  c.repathCooldown = 0;
}

// A soldier with no mob target: works on its hearth target (commanded, or picked on an aggressive stance
// when one stands within HEARTH_AUTO_TARGET_TILES and inside the unit's zone). True when it acted.
export function hearthStep(c: Colonist, stats: { damage: number; cooldown: number; melee: boolean; range: number; speed: number }, dt: number): boolean {
  if (c.targetHearthId?.startsWith(STRUCTURE_TARGET_PREFIX)) return structureStep(c, stats, dt);
  let h = c.targetHearthId ? hearths.get(c.targetHearthId) : undefined;
  if (c.targetHearthId && (!h || h.destroyed)) {
    c.targetHearthId = null;
    c.path = [];
    h = undefined;
  }
  if (!h && c.stance === "aggressive" && !(c.holdFire && !stats.melee)) {
    const zone = LINE_LEASH_TILES[c.stance] * TILE_SIZE + stats.range + TILE_SIZE;
    let bestD = HEARTH_AUTO_TARGET_TILES * TILE_SIZE;
    for (const cand of hearths.values()) {
      if (cand.destroyed) continue;
      const p = tileToPixelCenter(cand);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= bestD && Math.hypot(p.x - c.rallyX, p.y - c.rallyY) <= zone) {
        bestD = d;
        h = cand;
      }
    }
    if (h) c.targetHearthId = h.siteId;
    // Forts phase A: else a hostile site's structure in the same reach (scanned a few times a second).
    if (!h && tileOwner.size > 0 && state.cycleTick % 5 === 0) {
      const s = nearestHostileStructure(c.x, c.y, HEARTH_AUTO_TARGET_TILES * TILE_SIZE, c.rallyX, c.rallyY, zone);
      if (s) {
        c.targetHearthId = s.id;
        return structureStep(c, stats, dt);
      }
    }
  }
  if (!h) return false;
  const p = tileToPixelCenter(h);
  const dist = Math.hypot(p.x - c.x, p.y - c.y);
  const reach = Math.max(stats.range + TILE_SIZE * 0.5, TILE_SIZE * 1.5);
  if (dist <= reach) {
    c.path = [];
    c.state = "attacking";
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
      return true;
    }
    let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
    if (c.kind === "batteringRam") damage *= SIEGE_BUILDING_MULT;
    else if (c.kind === "catapult") damage *= CATAPULT_BUILDING_MULT;
    c.attackCooldownTicks = stats.cooldown;
    state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: p.x, toY: p.y, melee: stats.melee, ...(c.kind === "catapult" ? { boulder: true } : {}) });
    damageHearth(h, damage, "c:" + c.id);
    if (h.destroyed) c.targetHearthId = null;
    return true;
  }
  if (stats.speed === 0) return false;
  if (c.path.length === 0) {
    const approach = hearthApproachTile(h, c.x, c.y);
    const route = approach ? findPath(tileOfPixel(c.x, c.y), approach) : null;
    if (!route) {
      c.targetHearthId = null;
      return false;
    }
    c.path = route;
    if (route.length === 0) stepRaidMobToward(c, p.x, p.y, stats.speed, dt);
  }
  if (c.path.length > 0) advanceAlongPath(c, dt, stats.speed);
  c.state = "engaging";
  return true;
}

// Forts phase A: hearthStep for a structure target (a hostile site's wall / gate / tower / building).
// Walled off: breaks through the first site wall / gate on the cheapest route (structureBreach) first.
function structureStep(c: Colonist, stats: { damage: number; cooldown: number; melee: boolean; range: number; speed: number }, dt: number): boolean {
  const goal = Number(c.targetHearthId!.slice(STRUCTURE_TARGET_PREFIX.length));
  if (!Number.isInteger(goal) || goal < 0 || goal >= state.tiles.length || !hostileStructureAt(goal)) {
    c.targetHearthId = null;
    structureBreach.delete(c.id);
    c.path = [];
    return false;
  }
  let at = goal;
  const breach = structureBreach.get(c.id);
  if (breach !== undefined) {
    if (hostileStructureAt(breach)) at = breach;
    else {
      structureBreach.delete(c.id);
      c.path = [];
    }
  }
  const tx = at % state.WORLD_TILES_X;
  const ty = Math.floor(at / state.WORLD_TILES_X);
  const p = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(p.x - c.x, p.y - c.y);
  const reach = Math.max(stats.range + TILE_SIZE * 0.5, TILE_SIZE * 1.5);
  if (dist <= reach) {
    c.path = [];
    c.state = "attacking";
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
      return true;
    }
    let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
    if (c.kind === "batteringRam") damage *= SIEGE_BUILDING_MULT;
    else if (c.kind === "catapult") damage *= CATAPULT_BUILDING_MULT;
    c.attackCooldownTicks = stats.cooldown;
    state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: p.x, toY: p.y, melee: stats.melee, ...(c.kind === "catapult" ? { boulder: true } : {}) });
    // Hitting a site's building wakes its guardians (they defend it).
    const siteId = ownerSiteIds[ownerAt(at) - 1];
    if (siteId) activateGuardianSite(siteId);
    damageBuilding(tx, ty, damage);
    if (!hostileStructureAt(at)) {
      if (at === goal) c.targetHearthId = null;
      structureBreach.delete(c.id);
      c.path = [];
    }
    return true;
  }
  if (stats.speed === 0) return false;
  if (c.path.length === 0) {
    const start = tileOfPixel(c.x, c.y);
    const approach = hearthApproachTile({ x: tx, y: ty }, c.x, c.y);
    let route = approach ? findPath(start, approach) : null;
    if (!route && at === goal) {
      const via = routeToBuilding(start, tx, ty, BREACH_WALL_COST, true);
      const wallAt = via ? via.findIndex((t) => isColonyBreachObstacle(t.x, t.y)) : -1;
      if (via && wallAt >= 0) {
        structureBreach.set(c.id, tileIndex(via[wallAt].x, via[wallAt].y));
        route = via.slice(0, wallAt);
      }
    }
    if (!route) {
      c.targetHearthId = null;
      structureBreach.delete(c.id);
      return false;
    }
    c.path = route;
    if (route.length === 0) stepRaidMobToward(c, p.x, p.y, stats.speed, dt);
  }
  if (c.path.length > 0) advanceAlongPath(c, dt, stats.speed);
  c.state = "engaging";
  return true;
}

// Saint Wren's Abbey: lays out ABBEY_LAYOUT around a clear spot (grounds + apron all Empty, no
// water) and posts its three resident clergy at the hall. Runs before resources are scattered, so
// the 11x11 clear area is only ever contested by ponds; scatter and tree regrowth then skip the
// grounds (isInReservedGrounds). Adds the Abbey's center to placedSites so later POIs keep their spacing.
function placeAbbey(placedSites: TileCoord[]) {
  const center = pickScatteredTile(ABBEY_MIN_SPAWN_DIST, POI_SITE_MIN_SPACING, placedSites, (t) =>
    poiSiteFootprintClear(t, ABBEY_GROUNDS_RADIUS, ABBEY_GROUNDS_RADIUS)
  );
  if (!center) return;
  state.abbeyCenter = center;
  placedSites.push(center);
  let hall: TileCoord | null = null;
  for (let ry = 0; ry < ABBEY_LAYOUT.length; ry++) {
    for (let rx = 0; rx < ABBEY_LAYOUT[ry].length; rx++) {
      const tile = ABBEY_LAYOUT_TILES[ABBEY_LAYOUT[ry][rx]];
      if (tile === undefined) continue;
      const t = { x: center.x + rx - ABBEY_FOOTPRINT_RADIUS, y: center.y + ry - ABBEY_FOOTPRINT_RADIUS };
      state.tiles[tileIndex(t.x, t.y)] = tile;
      if (tile === TileType.AbbeyHall) hall = t;
    }
  }
  if (!hall) return;
  for (const offset of ABBEY_CLERGY_OFFSETS) {
    const c = spawnColonistForPost(hall.x, hall.y, "bishop");
    const spot = tileToPixelCenter({ x: center.x + offset.x, y: center.y + offset.y });
    c.x = spot.x;
    c.y = spot.y;
  }
}

function isInCastleRuinGrounds(tx: number, ty: number): boolean {
  if (!state.castleRuinCenter) return false;
  return Math.max(Math.abs(tx - state.castleRuinCenter.x), Math.abs(ty - state.castleRuinCenter.y)) <= CASTLE_RUIN_GROUNDS_RADIUS;
}

function makeBoss(mob: Mob, tier: BossTier) {
  const hpMult = tier === "warlord" ? WARLORD_HP_MULT : ELITE_HP_MULT;
  const damageMult = tier === "warlord" ? WARLORD_DAMAGE_MULT : ELITE_DAMAGE_MULT;
  mob.maxHp = Math.round(mob.maxHp * hpMult);
  mob.hp = mob.maxHp;
  mob.damage = Math.round(mob.damage * damageMult);
  mob.boss = tier;
  mob.bossSighted = false;
}

function formatReward(reward: Partial<Record<ResourceKey, number>>): string {
  return Object.entries(reward)
    .map(([key, n]) => `+${n} ${key}`)
    .join(", ");
}

function grantReward(reward: Partial<Record<ResourceKey, number>>) {
  for (const [key, n] of Object.entries(reward)) stock[key as ResourceKey] += n ?? 0;
}

// Runs before resources are scattered (right after the Abbey), so the grounds are only contested by
// ponds and the Abbey; scatter and regrowth then skip them (isInReservedGrounds).
function placeCastleRuin(placedSites: TileCoord[]) {
  const fits = (t: TileCoord) => poiSiteFootprintClear(t, CASTLE_RUIN_GROUNDS_RADIUS, CASTLE_RUIN_GROUNDS_RADIUS);
  const spacing = ABBEY_GROUNDS_RADIUS + CASTLE_RUIN_GROUNDS_RADIUS + 2;
  let center: TileCoord | null = null;
  for (const fraction of CASTLE_RUIN_SPAWN_DIST_FRACTIONS) {
    center = pickScatteredTile(Math.floor(state.WORLD_TILES_X * fraction), spacing, placedSites, fits);
    if (center) break;
  }
  center ??= pickScatteredTile(SPAWN_CLEAR_RADIUS_TILES + CASTLE_RUIN_GROUNDS_RADIUS, spacing, placedSites, fits);
  if (!center) return;
  state.castleRuinCenter = center;
  placedSites.push(center);
  const siteId = randomUUID();
  const open: TileCoord[] = [];
  for (let ry = 0; ry < CASTLE_RUIN_LAYOUT.length; ry++) {
    for (let rx = 0; rx < CASTLE_RUIN_LAYOUT[ry].length; rx++) {
      const t = { x: center.x + rx - CASTLE_RUIN_FOOTPRINT_RADIUS, y: center.y + ry - CASTLE_RUIN_FOOTPRINT_RADIUS };
      const tile = CASTLE_RUIN_LAYOUT_TILES[CASTLE_RUIN_LAYOUT[ry][rx]];
      if (tile !== undefined) state.tiles[tileIndex(t.x, t.y)] = tile;
      // Guardians stand on the open ground inside the walls (not in the gate gaps, not on the boss).
      else if (CASTLE_RUIN_LAYOUT[ry][rx] === "." && rx > 0 && ry > 0 && rx < CASTLE_RUIN_LAYOUT.length - 1 && ry < CASTLE_RUIN_LAYOUT.length - 1) open.push(t);
    }
  }
  makeBoss(spawnGuardian("ogre", center, siteId, "castleRuin", false), "warlord");
  const count = randInt(CASTLE_RUIN_GUARDIANS_MIN, CASTLE_RUIN_GUARDIANS_MAX);
  for (const spot of shuffled(open).slice(0, count)) {
    spawnGuardian(pickWeightedGuardianKind(CASTLE_RUIN_GUARDIAN_WEIGHTS), spot, siteId, "castleRuin");
  }
}

// After the ruins and encampments, same spacing rules. No decoration: just the pack, the elite on
// the centre tile and its followers on free neighbours.
function generateMiniBossSites(count: number, placedSites: TileCoord[]) {
  for (let i = 0; i < count; i++) {
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + POI_SITE_FOOTPRINT_RADIUS,
      POI_SITE_MIN_SPACING,
      placedSites,
      poiSiteFootprintClear
    );
    if (!center) continue;
    placedSites.push(center);
    const siteId = randomUUID();
    const kind = MINI_BOSS_KINDS[randInt(0, MINI_BOSS_KINDS.length - 1)];
    makeBoss(spawnGuardian(kind, center, siteId, "miniBoss", false), "elite");
    for (const offset of shuffled(NEIGHBORS_8).slice(0, randInt(2, 4))) {
      spawnGuardian(kind, { x: center.x + offset.x, y: center.y + offset.y }, siteId, "miniBoss");
    }
  }
}

export function onBossKilled(mob: Mob) {
  const title = bossTitle(mob.kind, mob.boss!);
  if (mob.boss === "warlord") {
    state.castleCleared = true;
    grantReward(WARLORD_REWARD);
    const gear = grantTieredEquipment(BOSS_EQUIP_LOOT.warlord, "warlord");
    broadcastEvent("boss", `The ${title} has fallen — the Castle Ruin is cleared! (${formatReward(WARLORD_REWARD)}, ${gear})`);
    evaluateGoals();
  } else {
    grantReward(ELITE_REWARD);
    const gear = grantTieredEquipment(BOSS_EQUIP_LOOT.elite, "elite");
    broadcastEvent("boss", `The ${title} is slain (${formatReward(ELITE_REWARD)}, ${gear})`);
  }
}

// Once per boss: the first time a player (vision radius VISION_RADIUS_PLAYER) or one of the colony's
// colonists (VISION_RADIUS_COLONIST) has it in live vision. Checked once a second.
function checkBossSightings() {
  for (const mob of mobs.values()) {
    if (!mob.boss || mob.bossSighted) continue;
    const seen =
      Array.from(players.values()).some(
        (p) => !p.dead && Math.hypot(p.x - mob.x, p.y - mob.y) <= VISION_RADIUS_PLAYER * TILE_SIZE
      ) ||
      Array.from(colonists.values()).some(
        (c) => !isAbbeyClergy(c) && Math.hypot(c.x - mob.x, c.y - mob.y) <= VISION_RADIUS_COLONIST * TILE_SIZE
      );
    if (!seen) continue;
    mob.bossSighted = true;
    const title = bossTitle(mob.kind, mob.boss);
    broadcastEvent(
      "boss",
      mob.boss === "warlord" ? `The ${title} has been sighted at the Castle Ruin` : `A ${title} has been sighted`
    );
  }
}

// Dawns since the world began (cycle 0 starts at dawn, so day N's dawn is cycleTick N * cycle).
function nightsSurvived(): number {
  return Math.floor(state.cycleTick / GAME_DAY_TICKS);
}

// Any player-placed structure: a queued construction, a built building (Town Centers beyond the
// starting one count), or a wall.
function anyPlayerBuilding(): boolean {
  if (constructionSites.size > 0 || state.townCenters.length > 1) return true;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i] as TileType;
    if (t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate) return true;
    if (t !== TileType.TownCenter && VISION_BUILDING_TILES.has(t)) return true;
  }
  return false;
}

function flagGoal(done: boolean) {
  return { progress: done ? 1 : 0, target: 1 };
}

function nightsGoal(target: number, reward: Partial<Record<ResourceKey, number>>): GoalDef {
  return {
    title: target === 1 ? "Survive the first night" : `Survive ${target} nights`,
    progress: () => ({ progress: Math.min(target, nightsSurvived()), target }),
    reward,
  };
}

const GOALS: GoalDef[] = [
  { title: "Place a building", progress: () => flagGoal(anyPlayerBuilding()), reward: { wood: 20 } },
  {
    title: "Assign a worker",
    progress: () => flagGoal(Array.from(colonists.values()).some((c) => GOAL_WORKER_KINDS.has(c.kind))),
    reward: { wood: 20, rock: 10 },
  },
  {
    title: "Arm a unit",
    progress: () => flagGoal(Array.from(colonists.values()).some((c) => isSoldierKind(c.kind))),
    reward: { iron: 15 },
  },
  // Long days: was 1/3/7/14/21 nights of the old 100 s cycle (2 / 5 / 12 / 23 / 35 min); now 1/2/4/7/10
  // long nights of 375 s (6 / 12.5 / 25 / 44 / 62.5 min): each step still a meaningful stretch of play.
  nightsGoal(1, { gold: 15, grain: 20 }),
  nightsGoal(2, { gold: 30, wood: 30, rock: 30 }),
  nightsGoal(4, { gold: 60, iron: 40, rock: 40 }),
  nightsGoal(7, { gold: 100, wood: 60, iron: 60 }),
  nightsGoal(10, { gold: 150, wood: 80, iron: 80, rock: 80 }),
  { title: "Clear the Castle Ruin", progress: () => flagGoal(state.castleCleared), reward: { gold: 100 } },
];
state.goalSnapshot = { index: 0, total: GOALS.length, title: GOALS[0].title, progress: 0, target: 1 };

function refreshGoalSnapshot(progress?: { progress: number; target: number }) {
  if (state.goalIndex >= GOALS.length) {
    state.goalSnapshot = { index: GOALS.length, total: GOALS.length, title: "Every goal complete", progress: 1, target: 1 };
    return;
  }
  const p = progress ?? GOALS[state.goalIndex].progress();
  state.goalSnapshot = { index: state.goalIndex, total: GOALS.length, title: GOALS[state.goalIndex].title, ...p };
}

// silent: catch up without rewards or toasts (an old save loaded with no goal state).
function evaluateGoals(silent = false) {
  while (state.goalIndex < GOALS.length) {
    const goal = GOALS[state.goalIndex];
    const p = goal.progress();
    if (p.progress < p.target) {
      refreshGoalSnapshot(p);
      return;
    }
    state.goalIndex++;
    if (silent) continue;
    grantReward(goal.reward);
    const final = state.goalIndex === GOALS.length;
    broadcastEvent(
      "milestone",
      final
        ? `Final goal complete: ${goal.title} — the colony stands victorious! (${formatReward(goal.reward)})`
        : `Goal complete: ${goal.title} (${formatReward(goal.reward)})`
    );
  }
  refreshGoalSnapshot();
}

function resetGoals() {
  state.goalIndex = 0;
  state.castleCleared = false;
  state.campsDestroyed = 0;
  refreshGoalSnapshot(flagGoal(false));
}

// ---- Fog of war (minimap only) ----

function circleOffsets(radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push([dx, dy]);
    }
  }
  return out;
}
const PLAYER_VISION_OFFSETS = circleOffsets(VISION_RADIUS_PLAYER);
const COLONIST_VISION_OFFSETS = circleOffsets(VISION_RADIUS_COLONIST);
const BUILDING_VISION_OFFSETS = circleOffsets(VISION_RADIUS_BUILDING);
export const START_VISION_OFFSETS = circleOffsets(VISION_RADIUS_START);

export function revealAround(tx: number, ty: number, offsets: Array<[number, number]>) {
  for (const [dx, dy] of offsets) {
    const x = tx + dx;
    const y = ty + dy;
    if (x < 0 || y < 0 || x >= state.WORLD_TILES_X || y >= state.WORLD_TILES_Y) continue;
    const index = y * state.WORLD_TILES_X + x;
    if (state.explored[index]) continue;
    state.explored[index] = 1;
    state.pendingExplored.push(index);
  }
}

function revealFrom(source: object, px: number, py: number, offsets: Array<[number, number]>) {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const index = ty * state.WORLD_TILES_X + tx;
  if (state.visionTile.get(source) === index) return;
  state.visionTile.set(source, index);
  revealAround(tx, ty, offsets);
}

function updateVision() {
  for (const p of players.values()) revealFrom(p, p.x, p.y, PLAYER_VISION_OFFSETS);
  // The Abbey's clergy are world-gen residents, not the colony's eyes.
  for (const c of colonists.values()) {
    if (!isAbbeyClergy(c)) revealFrom(c, c.x, c.y, COLONIST_VISION_OFFSETS);
  }
}

function resetExplored() {
  state.explored.fill(0);
  state.visionTile = new WeakMap();
  revealAround(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y, START_VISION_OFFSETS);
  // The fresh world reaches clients whole, in `welcome`.
  state.pendingExplored = [];
}

function packExplored(): string {
  const bytes = new Uint8Array(Math.ceil(state.explored.length / 8));
  for (let i = 0; i < state.explored.length; i++) {
    if (state.explored[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

function flushExplored() {
  if (--state.exploredFlushCountdown > 0) return;
  state.exploredFlushCountdown = EXPLORED_FLUSH_TICKS;
  if (state.pendingExplored.length === 0) return;
  const message: ServerMessage = { type: "explored", tiles: state.pendingExplored };
  state.pendingExplored = [];
  const payload = JSON.stringify(message);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

// Full world regeneration (boot + restart). Callers must clear `mobs` and `colonists` first: this
// spawns the new world's POI guardians and Abbey clergy into them. Order: biomes (own layer) ->
// ponds -> Abbey -> Castle Ruin -> resources -> wild forage -> POI sites -> mini-boss packs -> wild game, each step only ever writing onto Empty tiles, so nothing
// lands on top of anything placed before it.
// Re-allocates every world-size-dependent module value for a new size (call before generateWorld, after
// clearing mobs/colonists). A no-op when the size is unchanged.
function setWorldSize(size: number) {
  size = clampWorldSize(size);
  if (size === state.WORLD_TILES_X) return;
  state.WORLD_TILES_X = state.WORLD_TILES_Y = size;
  state.WORLD_AREA_SCALE = (size * size) / (80 * 80);
  state.worldWidth = size * TILE_SIZE;
  state.worldHeight = size * TILE_SIZE;
  const cells = size * size;
  state.tiles = new Uint8Array(cells).fill(TileType.Empty);
  state.biomes = new Uint8Array(cells).fill(Biome.Plains);
  state.explored = new Uint8Array(cells);
  state.cellHead = new Int32Array(cells);
  state.routeCost = new Float64Array(cells);
  state.routeParent = new Int32Array(cells);
  TOWN_CENTER_TILE.x = TOWN_CENTER_TILE.y = Math.floor(size / 2);
  state.TREE_COUNT = scaledCount(96);
  state.IRON_ORE_COUNT = scaledCount(56);
  state.ROCK_COUNT = scaledCount(64);
  state.MAX_TREES = scaledCount(200);
  state.BERRY_BUSH_COUNT = scaledCount(24);
  state.FRUIT_TREE_COUNT = scaledCount(12);
  state.MUSHROOM_PATCH_COUNT = scaledCount(10);
  state.WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCountSub(4));
  WILDLIFE_CONFIG.deer.cap = scaledCountSub(6);
  WILDLIFE_CONFIG.rabbit.cap = scaledCountSub(8);
  WILDLIFE_CONFIG.boar.cap = scaledCountSub(3);
  WILDLIFE_CONFIG.pheasant.cap = scaledCountSub(4);
  state.BIOME_SEEDS_PER_KIND = scaledCount(5);
  state.POND_COUNT_MIN = scaledCount(8);
  state.POND_COUNT_MAX = scaledCount(12);
  state.RUIN_SITE_COUNT_MIN = scaledCountSub(6);
  state.RUIN_SITE_COUNT_MAX = scaledCountSub(10);
  state.ENCAMPMENT_SITE_COUNT_MIN = scaledCountSub(6);
  state.ENCAMPMENT_SITE_COUNT_MAX = scaledCountSub(10);
  state.MINI_BOSS_SITE_COUNT_MIN = Math.max(1, scaledCountSub(0.75));
  state.MINI_BOSS_SITE_COUNT_MAX = Math.max(1, scaledCountSub(1.25));
}

function generateWorld() {
  const genStart = performance.now();
  state.tiles.fill(TileType.Empty);
  state.biomes.fill(Biome.Plains);
  state.worldNoiseSalt = Math.floor(Math.random() * 0x7fffffff);
  state.abbeyCenter = null;
  state.castleRuinCenter = null;
  hearths.clear();
  clearOwners();
  resetGoals();
  state.tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;
  state.townCenters = [{ x: TOWN_CENTER_TILE.x, y: TOWN_CENTER_TILE.y, level: 1, hp: townCenterMaxHp(1) }];
  generateBiomes();
  generatePonds();
  const placedSites: TileCoord[] = [];
  placeAbbey(placedSites);
  placeCastleRuin(placedSites);
  scatterResourceTiles(TileType.Tree, state.TREE_COUNT);
  scatterResourceTiles(TileType.IronOre, state.IRON_ORE_COUNT);
  scatterResourceTiles(TileType.Rock, state.ROCK_COUNT);
  generateForage();
  generatePoiSites("ruin", randInt(state.RUIN_SITE_COUNT_MIN, state.RUIN_SITE_COUNT_MAX), placedSites);
  generatePoiSites("encampment", randInt(state.ENCAMPMENT_SITE_COUNT_MIN, state.ENCAMPMENT_SITE_COUNT_MAX), placedSites);
  generateMiniBossSites(randInt(state.MINI_BOSS_SITE_COUNT_MIN, state.MINI_BOSS_SITE_COUNT_MAX), placedSites);
  spawnInitialWildlife();
  resetExplored();
  topUpTownCenterBuilders(state.townCenters[0]);
  console.log(`[world] generated ${state.WORLD_TILES_X}x${state.WORLD_TILES_Y} in ${(performance.now() - genStart).toFixed(0)} ms`);
}

generateWorld();

export function broadcastTileUpdate(tx: number, ty: number, tile: TileType) {
  state.buildingTargetsDirty = true;
  state.gateTilesDirty = true;
  if (VISION_BUILDING_TILES.has(tile)) revealAround(tx, ty, BUILDING_VISION_OFFSETS);
  const update: ServerMessage = { type: "tileUpdate", tileX: tx, tileY: ty, tile };
  const payload = JSON.stringify(update);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

export function broadcastEvent(category: GameEventCategory, text: string) {
  const event: ServerMessage = { type: "event", category, text };
  const payload = JSON.stringify(event);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

function handleTestHook(player: Player, msg: Record<string, unknown>) {
  const reply = (data: Record<string, unknown>) =>
    player.socket.send(JSON.stringify({ type: "testHookResult", op: msg.op, ...data }));
  if (msg.op === "setCycleTick" && typeof msg.tick === "number") {
    state.cycleTick = Math.max(0, Math.floor(msg.tick));
    state.wasNight = isNightNow();
    reply({ cycleTick: state.cycleTick });
  } else if (msg.op === "raidState") {
    reply({
      cycleTick: state.cycleTick,
      dayTicks: DAY_TICKS,
      nightTicks: NIGHT_TICKS,
      worldTiles: state.WORLD_TILES_X,
      groups: Array.from(raidGroups.values()).map((g) => ({
        id: g.id,
        faction: g.faction,
        isHorde: g.isHorde,
        edge: g.edge,
        state: g.state,
        aggroTick: g.aggroTick,
        leaderId: g.leaderId,
        memberIds: g.memberIds,
        headingX: g.headingX ?? null,
        headingY: g.headingY ?? null,
        engagedTick: g.engagedTick ?? null,
        offsets: Array.from(g.offsets),
      })),
      mobs: Array.from(mobs.values()).map((m) => ({
        id: m.id,
        kind: m.kind,
        x: m.x,
        y: m.y,
        groupId: m.groupId,
        passive: m.passive,
        isDeserter: m.isDeserter,
        deserterActive: m.deserterActive,
        siteId: m.siteId,
        targetType: m.targetType,
        targetId: m.targetId,
        mark: m.mark,
        hp: m.hp,
        maxHp: m.maxHp,
        damage: m.damage,
        furyUntilTick: m.furyUntilTick,
        scale: m.scale ?? 1,
        speed: m.speed,
        range: m.range,
        bodyRadius: mobBodyRadius(m),
        rolledScale: rollMobSize(m.kind, m.id),
        regimentId: m.regimentId ?? null,
      })),
      factions: RAID_FACTIONS,
      unlockDays: Object.fromEntries(Object.entries(MOB_KIND_CONFIG).map(([k, c]) => [k, c.unlockDay])),
    });
  } else if (msg.op === "damageMob" && typeof msg.mobId === "string" && typeof msg.amount === "number") {
    const mob = mobs.get(msg.mobId);
    // byPlayer: the blow counts as this player's (relic / XP rewards go to them); byColonist: that unit's
    // (hero phase 3: a hero's killing blow).
    const by = msg.byPlayer === true ? "p:" + player.id : typeof msg.byColonist === "string" ? "c:" + msg.byColonist : undefined;
    if (mob) damageMob(mob, msg.amount, by);
    reply({ found: !!mob });
  } else if (msg.op === "forceDeserterRoll") {
    state.testForceDeserterRoll = typeof msg.value === "boolean" ? msg.value : null;
    reply({ value: state.testForceDeserterRoll });
  } else if (msg.op === "holdRaidAggro") {
    state.testHoldRaidAggro = msg.value === true;
    reply({ value: state.testHoldRaidAggro });
  } else if (msg.op === "raidDepartNow") {
    // Every group leaves immediately (raid-timing test: forces early arrivals, which must pause).
    for (const g of raidGroups.values()) g.aggroTick = Math.min(g.aggroTick, state.cycleTick);
    reply({ groups: raidGroups.size });
  } else if (msg.op === "addDeserters" && typeof msg.count === "number") {
    // Dormant deserters near the Town Center, already past DESERTER_ACTIVATION_DAYS.
    const ids: string[] = [];
    for (let i = 0; i < msg.count; i++) {
      const tile = findAdjacentWalkable(TOWN_CENTER_TILE.x + 2 + (i % 4), TOWN_CENTER_TILE.y + 2 + Math.floor(i / 4)) ?? TOWN_CENTER_TILE;
      const mob = createRaidMob("goblin", tile, "");
      Object.assign(mob, {
        groupId: null,
        passive: false,
        isDeserter: true,
        deserterSinceTick: state.cycleTick - DESERTER_ACTIVATION_TICKS,
      });
      ids.push(mob.id);
    }
    reply({ ids });
  } else if (msg.op === "fastForward" && typeof msg.ticks === "number") {
    // Runs whole simulation ticks back to back (no snapshots in between), up to 200000 per call.
    const n = Math.max(0, Math.min(200000, Math.floor(msg.ticks)));
    for (let i = 0; i < n; i++) stepSimulation();
    state.pendingEffects = [];
    reply({ cycleTick: state.cycleTick });
  } else if (msg.op === "setRaids") {
    state.testRaidsDisabled = msg.enabled === false;
    reply({ enabled: !state.testRaidsDisabled });
  } else if (msg.op === "setStock" && msg.stock && typeof msg.stock === "object") {
    for (const [key, value] of Object.entries(msg.stock as Record<string, unknown>)) {
      if (key in stock && typeof value === "number") stock[key as ResourceKey] = value;
    }
    reply({ stock: { ...stock } });
  } else if (msg.op === "farmState") {
    reply({
      plots: Array.from(farmPlots, ([key, p]) => ({ key, ...p, progress: farmPlotProgress(p) })),
      farmhands: Array.from(colonists.values())
        .filter((c) => c.kind === "farmhand")
        .map((c) => ({
          id: c.id,
          postX: c.postX,
          postY: c.postY,
          cycleTicksRemaining: c.chopTicksRemaining,
          state: c.state,
          progress: farmhandProgress(c),
        })),
      constants: {
        FARM_GROW_TICKS,
        FARM_HARVEST_TICKS,
        FARM_SOWN_FRACTION,
        FARM_HARVESTS_BEFORE_FALLOW,
        FARM_FALLOW_TICKS,
        FARM_YIELD_PER_HARVEST,
        FARMHAND_CYCLE_TICKS,
        FARMHAND_YIELD_PER_CYCLE,
        DAY_TICKS,
        NIGHT_TICKS,
        LEGACY_GAME_DAY_TICKS,
      },
      happiness: state.colonyHappiness,
    });
  } else if (msg.op === "wildlifeState") {
    reply({
      animals: Array.from(wildlife.values()).map((a) => ({ ...a })),
      config: WILDLIFE_CONFIG,
      forage: {
        ripe: state.tiles.reduce((n, t) => n + (FORAGE_RIPE_TO_PICKED[t as TileType] !== undefined ? 1 : 0), 0),
        picked: state.tiles.reduce((n, t) => n + (FORAGE_PICKED_TO_RIPE[t as TileType] !== undefined ? 1 : 0), 0),
        regrow: Array.from(forageRegrow, ([index, ticks]) => ({ index, ticks })),
        yields: FORAGE_FRUIT_YIELD,
        regrowTicks: FORAGE_REGROW_TICKS,
      },
      colonists: Array.from(colonists.values())
        .filter((c) => c.kind === "hunter" || c.kind === "forager")
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          x: c.x,
          y: c.y,
          state: c.state,
          postX: c.postX,
          postY: c.postY,
          targetWildlifeId: c.targetWildlifeId,
          targetResourceX: c.targetResourceX,
          targetResourceY: c.targetResourceY,
          carryAmount: c.carryAmount,
          sheltering: c.sheltering,
        })),
      cycleTick: state.cycleTick,
    });
  } else if (msg.op === "spawnWildlife" && typeof msg.kind === "string" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    const kind = msg.kind as WildlifeKind;
    if (!WILDLIFE_KINDS.includes(kind) || !inBounds(msg.tx, msg.ty)) {
      reply({ id: null });
    } else {
      reply({ id: spawnWildlifeAt(kind, msg.tx, msg.ty).id });
    }
  } else if (msg.op === "setWildlifeRespawn") {
    state.testWildlifeRespawnDisabled = msg.enabled === false;
    reply({ enabled: !state.testWildlifeRespawnDisabled });
  } else if (msg.op === "clearWildlife") {
    for (const c of colonists.values()) if (c.targetWildlifeId !== null) releaseResourceReservation(c);
    wildlife.clear();
    reply({ cleared: true });
  } else if (msg.op === "damageWildlife" && typeof msg.id === "number" && typeof msg.amount === "number") {
    const a = wildlife.get(msg.id);
    const fromX = typeof msg.fromX === "number" ? msg.fromX : a?.x ?? 0;
    const fromY = typeof msg.fromY === "number" ? msg.fromY : a?.y ?? 0;
    const killed = a ? damageWildlife(a, msg.amount, fromX, fromY, null) : false;
    reply({ found: !!a, killed });
  } else if (msg.op === "setTileRaw" && typeof msg.tx === "number" && typeof msg.ty === "number" && typeof msg.tile === "number") {
    // World editing for tests (forage plants next to a hut, clearing obstacles). No placement rules.
    if (inBounds(msg.tx, msg.ty)) {
      state.tiles[tileIndex(msg.tx, msg.ty)] = msg.tile;
      broadcastTileUpdate(msg.tx, msg.ty, msg.tile as TileType);
    }
    reply({ tile: state.tiles[tileIndex(msg.tx, msg.ty)] });
  } else if (msg.op === "stampTestSite" && typeof msg.cx === "number" && typeof msg.cy === "number") {
    // Forts phase A: a hand-placed NPC fort: a 5x5 ring of walls (stone with {stone:true}) owned by the
    // site `siteId` (default a fresh "testsite:<n>"), a gate in the middle of its west side and a tower in
    // the centre (unless {tower:false}); the rest of the 5x5 is cleared. No mobs: spawnMob {siteId} adds
    // its garrison.
    const siteId = typeof msg.siteId === "string" ? msg.siteId : `testsite:${ownerSiteIds.length + 1}`;
    const num = siteNumber(siteId, true);
    const walls: TileCoord[] = [];
    let gate: TileCoord | null = null;
    let tower: TileCoord | null = null;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = msg.cx + dx;
        const y = msg.cy + dy;
        if (!inBounds(x, y)) continue;
        const i = tileIndex(x, y);
        const ring = Math.abs(dx) === 2 || Math.abs(dy) === 2;
        const t = !ring ? (dx === 0 && dy === 0 && msg.tower !== false ? TileType.Tower : TileType.Empty)
          : dx === -2 && dy === 0 ? TileType.Gate : msg.stone ? TileType.StoneWall : TileType.Wall;
        buildingHp.delete(resourceKey(x, y));
        state.tiles[i] = t;
        broadcastTileUpdate(x, y, t);
        setOwner(i, t === TileType.Empty ? 0 : num);
        if (t === TileType.Gate) gate = { x, y };
        else if (t === TileType.Tower) tower = { x, y };
        else if (t !== TileType.Empty) walls.push({ x, y });
      }
    }
    reply({ siteId, site: num, gate, tower, walls });
  } else if (msg.op === "setOwner" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // Forts phase A: one tile's owner (siteId string, or null for the colony).
    if (inBounds(msg.tx, msg.ty)) setOwner(tileIndex(msg.tx, msg.ty), siteNumber(typeof msg.siteId === "string" ? msg.siteId : null, true));
    reply({ owner: inBounds(msg.tx, msg.ty) ? ownerAt(tileIndex(msg.tx, msg.ty)) : 0 });
  } else if (msg.op === "ownerState") {
    reply({
      owners: Array.from(tileOwner).map(([i, o]) => ({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X), owner: o, tile: state.tiles[i] })),
      sites: [...ownerSiteIds],
      version: state.ownerVersion,
      towerShots: towerEvents.slice(),
    });
  } else if (msg.op === "placeTownCenter" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // A new Town Center at the tile, no placement rules or builders' work (regiment-groups-test).
    if (inBounds(msg.tx, msg.ty) && !findTownCenterAt(msg.tx, msg.ty)) resolveTownCenterPlacement(msg.tx, msg.ty);
    reply({ townCenters: state.townCenters.map((t) => ({ ...t })) });
  } else if (msg.op === "forceMarkChance") {
    state.testForceMarkChance = typeof msg.value === "number" ? msg.value : null;
    reply({ value: state.testForceMarkChance });
  } else if (msg.op === "spawnMob" && typeof msg.kind === "string" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // An already-released (non-raid) mob at a tile, optionally Hunger-marked.
    if (!(msg.kind in MOB_KIND_CONFIG) || !inBounds(msg.tx, msg.ty)) {
      reply({ id: null });
    } else {
      const isBoss = msg.boss === "warlord" || msg.boss === "elite";
      const mob = createRaidMob(msg.kind as MobKind, { x: msg.tx, y: msg.ty }, "", !isBoss);
      mob.groupId = null;
      mob.passive = false;
      if (typeof msg.mark === "number" && msg.mark >= HungerMark.Gorrath && msg.mark <= HungerMark.Vhorrun) applyHungerMark(mob, msg.mark);
      // Monster tactics: optional regiment (raid-style) or an awake site guardian (siteId).
      if (typeof msg.regimentId === "string") mob.regimentId = msg.regimentId;
      if (typeof msg.siteId === "string") Object.assign(mob, { siteId: msg.siteId, siteKind: "encampment", guardianActive: true });
      // Hero phases 1-2: optional boss tier ("warlord" / "elite").
      if (msg.boss === "warlord" || msg.boss === "elite") makeBoss(mob, msg.boss);
      reply({ id: mob.id, mark: mob.mark, hp: mob.hp, maxHp: mob.maxHp, damage: mob.damage, scale: mob.scale ?? 1, speed: mob.speed, range: mob.range, bodyRadius: mobBodyRadius(mob) });
    }
  } else if (msg.op === "spawnRaidGroup" && Array.isArray(msg.kinds) && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // A raid group already in contact (engaged now): member i is on row i, so the rows release one by
    // one (RAID_RELEASE_ROW_TICKS apart) and some are still in the group early on.
    const id = randomUUID();
    const group: RaidGroup = {
      id, faction: "greenskinWarband", isHorde: false, edge: "west", memberIds: [], homes: new Map(), aggroTick: 0,
      state: "marching", leaderId: null, offsets: new Map(), repathCooldown: 0, headingX: 1, headingY: 0,
      engagedTick: state.cycleTick, anchorX: tileToPixelCenter({ x: msg.tx, y: msg.ty }).x, anchorY: tileToPixelCenter({ x: msg.tx, y: msg.ty }).y,
    };
    (msg.kinds as unknown[]).forEach((k, i) => {
      if (typeof k !== "string" || !(k in MOB_KIND_CONFIG)) return;
      const mob = createRaidMob(k as MobKind, { x: (msg.tx as number), y: (msg.ty as number) + i }, id);
      mob.passive = false;
      group.memberIds.push(mob.id);
      group.offsets.set(mob.id, { x: 0, y: i * TILE_SIZE, row: i });
    });
    group.leaderId = group.memberIds[0] ?? null;
    raidGroups.set(id, group);
    reply({ id, memberIds: group.memberIds });
  } else if (msg.op === "forceRaidSiege") {
    // Cavalry & siege: raids pick orc / bandit factions and take their siege engines first (up to the caps).
    state.testForceRaidSiege = msg.value === true;
    reply({ value: state.testForceRaidSiege });
  } else if (msg.op === "spawnRaidNow" && typeof msg.dayIndex === "number") {
    spawnRaid(Math.max(0, Math.floor(msg.dayIndex)));
    reply({ groups: raidGroups.size, caps: Object.fromEntries(SIEGE_KINDS.map((k) => [k, raidSiegeCap(Math.floor(msg.dayIndex as number), k)])) });
  } else if (msg.op === "siegeState") {
    reply({
      cycleTick: state.cycleTick,
      events: siegeEvents,
      workshops: Array.from(siegeWorkshops, ([key, w]) => ({ key, ...w })),
      units: Array.from(colonists.values())
        .filter((c) => c.kind === "cavalry" || isSiegeKind(c.kind))
        .map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp, postX: c.postX, postY: c.postY, level: c.castleLevel, speed: guardStats(c.kind, c.castleLevel).speed })),
      roles: { colonist: COLONIST_ROLE, mob: MOB_ROLE },
      population: civilianPopulationUsed(),
      populationCap: populationCap(),
      stock: { ...stock },
    });
  } else if (msg.op === "setRegimentWalled" && typeof msg.id === "string") {
    if (msg.value === false) walledSites.delete(msg.id);
    else walledSites.add(msg.id);
    reply({ walled: walledSites.has(msg.id) });
  } else if (msg.op === "tacticsConfig") {
    state.testMoraleFrozen = msg.freezeMorale === true;
    reply({ freezeMorale: state.testMoraleFrozen });
  } else if (msg.op === "tacticsState") {
    reply({
      cycleTick: state.cycleTick,
      regiments: Array.from(regiments.values()).map((r) => ({
        id: r.id, morale: r.morale, routed: r.routed, raid: r.raid, sheltering: r.sheltering, ratio: Number.isFinite(r.ratio) ? r.ratio : null,
        flankIds: r.flankIds, homeX: r.homeX, homeY: r.homeY,
      })),
      events: tacticsEvents,
      groups: Array.from(raidGroups.keys()),
      mobs: Array.from(mobs.values())
        .filter((m) => regimentKey(m))
        .map((m) => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, regiment: regimentKey(m), groupId: m.groupId, tactic: m.tactic ?? null, targetType: m.targetType, targetId: m.targetId })),
    });
  } else if (msg.op === "playerMoraleState") {
    // Phase 6: player regiment morale; setMorale {id: value} forces a regiment's morale first.
    if (msg.setMorale && typeof msg.setMorale === "object") {
      for (const [id, v] of Object.entries(msg.setMorale as Record<string, unknown>)) {
        const reg = playerMorale.get(id);
        if (reg && typeof v === "number") reg.morale = Math.max(0, Math.min(MORALE_MAX, v));
      }
    }
    reply({
      cycleTick: state.cycleTick,
      regiments: Array.from(playerMorale.values()).map((r) => ({ id: r.id, name: r.name, morale: r.morale, active: r.active, routed: r.routed, outflanked: r.outflanked, peak: r.peak, ratio: Number.isFinite(r.ratio) ? r.ratio : null, lastContactTick: Number.isFinite(r.lastContactTick) ? r.lastContactTick : null })),
      routedUnits: Array.from(routedUnits.keys()),
      unitRegiment: Object.fromEntries(moraleRegimentOfUnit),
    });
  } else if (msg.op === "setColonistHp" && typeof msg.id === "string" && typeof msg.hp === "number") {
    const c = colonists.get(msg.id);
    if (c) c.hp = Math.max(1, Math.min(c.maxHp, msg.hp));
    reply({ found: !!c, hp: c?.hp ?? null });
  } else if (msg.op === "setInstantBuild") {
    state.instantBuild = msg.enabled === true;
    reply({ enabled: state.instantBuild });
  } else if (msg.op === "teleportPlayer" && typeof msg.x === "number" && typeof msg.y === "number") {
    player.x = msg.x;
    player.y = msg.y;
    reply({ x: player.x, y: player.y });
  } else if (msg.op === "damagePlayer" && typeof msg.amount === "number") {
    damagePlayer(player, msg.amount);
    reply({ hp: player.hp, dead: player.dead });
  } else if (msg.op === "damageTownCenter" && typeof msg.tx === "number" && typeof msg.ty === "number" && typeof msg.amount === "number") {
    const tc = findTownCenterAt(msg.tx, msg.ty);
    if (tc) damageTownCenter(tc, msg.amount);
    reply({ found: !!tc, townCenters: state.townCenters.map((t) => ({ ...t })) });
  } else if (msg.op === "damageBuilding" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // amount 0 (or missing) just reports the HP.
    if (typeof msg.amount === "number" && msg.amount > 0 && structureHp(msg.tx, msg.ty)) damageBuilding(msg.tx, msg.ty, msg.amount);
    reply({ structure: structureHp(msg.tx, msg.ty) });
  } else if (msg.op === "killColonists" && typeof msg.kind === "string") {
    let killed = 0;
    for (const c of Array.from(colonists.values())) {
      if (c.kind !== msg.kind) continue;
      damageColonist(c, c.hp + 1);
      killed++;
    }
    reply({ killed });
  } else if (msg.op === "constructionState") {
    reply({
      sites: Array.from(constructionSites.values()).map((site) => ({ ...site })),
      builders: Array.from(colonists.values())
        .filter((c) => c.kind === "builder")
        .map((c) => ({ id: c.id, x: c.x, y: c.y, state: c.state, postX: c.postX, postY: c.postY, buildSiteKey: c.buildSiteKey, repairKey: c.repairKey ?? null })),
      farmers: Array.from(colonists.values())
        .filter((c) => c.kind === "farmer")
        .map((c) => ({ id: c.id, x: c.x, y: c.y, state: c.state, postX: c.postX, postY: c.postY, sheltering: c.sheltering })),
      townCenters: state.townCenters.map((t) => ({ ...t })),
      productionSpeedMultiplier: productionSpeedMultiplier(),
      happinessSpeedMultiplier: happinessSpeedMultiplier(),
      armyBonus: townCenterBonus(),
      populationCap: populationCap(),
      instantBuild: state.instantBuild,
    });
  } else if (msg.op === "tickStats") {
    const sorted = tickDurationsMs.slice().sort((p, q) => p - q);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / Math.max(1, sorted.length);
    reply({
      samples: sorted.length,
      avgMs: avg,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      mobs: mobs.size,
      groups: raidGroups.size,
    });
    if (msg.reset) tickDurationsMs.length = 0;
  } else if (msg.op === "spawnSoldier" && typeof msg.kind === "string" && typeof msg.x === "number" && typeof msg.y === "number") {
    // A soldier standing at pixel (x, y) with its rally slot there (post = that tile; no building).
    const kind = msg.kind as ColonistKind;
    const tile = tileOfPixel(msg.x, msg.y);
    if (!isGuardOrMilitiaKind(kind) || kind === "hero" || !isWalkableTile(tile.x, tile.y)) {
      reply({ id: null });
    } else {
      const c = spawnColonistForPost(tile.x, tile.y, kind);
      Object.assign(c, { x: msg.x, y: msg.y, rallyTileX: tile.x, rallyTileY: tile.y, rallyX: msg.x, rallyY: msg.y });
      if (typeof msg.stance === "string" && STANCES.includes(msg.stance as Stance)) c.stance = msg.stance as Stance;
      reply({ id: c.id });
    }
  } else if (msg.op === "bodyState") {
    // Positions, targets and engagement slots of soldiers and mobs (combat-line-test).
    reply({
      cycleTick: state.cycleTick,
      colonists: Array.from(colonists.values())
        .filter((c) => isGuardOrMilitiaKind(c.kind))
        .map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, state: c.state, rallyX: c.rallyX, rallyY: c.rallyY, targetMobId: c.targetMobId, hp: c.hp })),
      mobs: Array.from(mobs.values()).map((m) => ({
        id: m.id, kind: m.kind, x: m.x, y: m.y, groupId: m.groupId, targetType: m.targetType, targetId: m.targetId, hp: m.hp,
      })),
      slots: Array.from(attackerSlots),
    });
  } else if (msg.op === "ignorePlayers") {
    state.testPlayersIgnored = msg.value === true;
    reply({ value: state.testPlayersIgnored });
  } else if (msg.op === "damageBuilding" && typeof msg.tx === "number" && typeof msg.ty === "number" && typeof msg.amount === "number") {
    damageBuilding(msg.tx, msg.ty, msg.amount);
    reply({ hp: structureHp(msg.tx, msg.ty), tile: state.tiles[tileIndex(msg.tx, msg.ty)] });
  } else if (msg.op === "gateState") {
    // Walls & gates: every gate's state and HP; checkOverrun runs the overrun evaluation right now.
    if (msg.checkOverrun === true) {
      state.gateTilesDirty = true;
      updateGates(true);
    }
    reply({
      gates: Array.from(gates, ([index, g]) => {
        const x = index % state.WORLD_TILES_X;
        const y = Math.floor(index / state.WORLD_TILES_X);
        return { x, y, ...g, hp: structureHp(x, y) };
      }),
      hp: { wall: buildingMaxHp(0, 0, TileType.Wall), stoneWall: buildingMaxHp(0, 0, TileType.StoneWall), gate: buildingMaxHp(0, 0, TileType.Gate) },
      cost: {
        wall: placementCost(TileType.Wall, TileType.Empty, 0, 0),
        stoneWall: placementCost(TileType.StoneWall, TileType.Empty, 0, 0),
        gate: placementCost(TileType.Gate, TileType.Empty, 0, 0),
      },
    });
  } else if (msg.op === "equipState") {
    // Armour & weapons: the stock, every forge queue, every equipped-kind unit's tiers, recent events.
    reply({
      equipment: { armour: [...equipment.armour], weapon: [...equipment.weapon] },
      forges: Array.from(forgeQueues, ([key, f]) => ({ key, queue: f.queue.map((q) => ({ ...q })), ticksLeft: f.ticksLeft })),
      units: Array.from(colonists.values())
        .filter((c) => isEquippedKind(c.kind))
        .map((c) => ({ id: c.id, kind: c.kind, hp: c.hp, maxHp: c.maxHp, armourTier: c.armourTier ?? 0, weaponTier: c.weaponTier ?? 0, postX: c.postX, postY: c.postY })),
      events: equipEvents.slice(),
      stock: { ...stock },
      mults: { weapon: WEAPON_DAMAGE_MULT, armour: ARMOUR_DAMAGE_TAKEN_MULT },
    });
  } else if (msg.op === "setEquipment") {
    for (const slot of ["armour", "weapon"] as EquipSlot[]) {
      const v = (msg as Record<string, unknown>)[slot];
      if (Array.isArray(v)) equipment[slot] = [0, 1, 2].map((i) => (typeof v[i] === "number" ? v[i] : 0));
    }
    reply({ equipment: { armour: [...equipment.armour], weapon: [...equipment.weapon] } });
  } else if (msg.op === "heroState") {
    // Hero phases 1-2: this player's profile (snapshot form), hp, every saved profile key, recent events.
    const prof = heroProfileOf(player);
    reply({
      key: prof.key, profile: heroProfileSnapshot(prof), hp: player.hp, dead: player.dead,
      cooldownTicks: playerAttackCooldownTicks(player), keys: Array.from(heroProfiles.keys()), events: heroEvents.slice(),
    });
  } else if (msg.op === "grantRelic") {
    const item = grantRelic(heroProfileOf(player), "hook", typeof msg.relicId === "string" ? msg.relicId : undefined);
    reply({ item });
  } else if (msg.op === "heroUnitState") {
    // Hero phase 3: every hero (sheet form + live unit), pending recruits, queued respawns, gold.
    reply({
      heroes: heroSheetsSnapshot(),
      units: Array.from(colonists.values()).filter((c) => c.kind === "hero").map((c) => ({
        id: c.id, name: c.heroName, heroClass: c.heroClass, hp: c.hp, maxHp: c.maxHp, x: c.x, y: c.y, postX: c.postX, postY: c.postY,
        settlementId: c.settlementId, role: colonistRole(c), stats: unitStats(c), stance: c.stance, rallyX: c.rallyX, rallyY: c.rallyY,
      })),
      recruits: heroRecruits.map((r) => ({ ...r })),
      queue: respawnQueue.filter((q) => q.hero).map((q) => ({ ...q })),
      gold: stock.gold,
      events: heroEvents.filter((e) => e.key?.startsWith(HERO_KEY_PREFIX)),
    });
  } else if (msg.op === "spellState") {
    // Hero phase 4: this player's / every hero's spell book, statuses, summons, recent spell events.
    reply({
      spellTick: state.spellTick,
      player: { key: player.profileKey, ...spellBookSnapshot(heroProfileOf(player)), spellPowerMult: heroProfileOf(player).stats.spellPowerMult, hp: player.hp, maxHp: playerMaxHp(player), x: player.x, y: player.y, id: player.id },
      heroes: Array.from(heroProfiles.values()).filter((p) => p.heroClass).map((p) => ({ key: p.key, level: p.level, spellPowerMult: p.stats.spellPowerMult, ...spellBookSnapshot(p) })),
      statuses: Object.fromEntries(spellStatuses),
      summons: Array.from(summonedUntil, ([id, until]) => ({ id, until, alive: colonists.has(id) })),
      population: civilianPopulationUsed(),
      gold: stock.gold,
      inventory: heroProfileOf(player).inventory,
      events: spellEvents.slice(),
    });
  } else if (msg.op === "grantSpell" && isSpellId(msg.spellId)) {
    const prof = typeof msg.heroId === "string" ? heroProfiles.get(heroKey(msg.heroId)) : heroProfileOf(player);
    reply({ learned: prof ? learnSpell(prof, msg.spellId, "hook", false) : false });
  } else if (msg.op === "grantTome") {
    reply({ item: grantTome(heroProfileOf(player), "hook", isSpellId(msg.spellId) ? msg.spellId : undefined) });
  } else if (msg.op === "spellConfig") {
    state.testTomeChance = typeof msg.tomeChance === "number" ? msg.tomeChance : null;
    if (msg.resetCooldowns === true) spellCooldowns.clear();
    reply({ tomeChance: state.testTomeChance });
  } else if (msg.op === "spawnHero" && HERO_CLASSES.includes(msg.heroClass as HeroClass) && typeof msg.x === "number" && typeof msg.y === "number") {
    // A hero standing at pixel (x, y), posted on that tile (no Keep), without recruiting.
    const tile = tileOfPixel(msg.x, msg.y);
    const c = spawnHeroColonist(randomUUID(), pickHeroName(), msg.heroClass as HeroClass, tile.x, tile.y);
    Object.assign(c, { x: msg.x, y: msg.y, rallyTileX: tile.x, rallyTileY: tile.y, rallyX: msg.x, rallyY: msg.y });
    if (typeof msg.stance === "string" && STANCES.includes(msg.stance as Stance)) c.stance = msg.stance as Stance;
    reply({ id: c.id });
  } else if (msg.op === "heroConfig") {
    state.testRelicChance = typeof msg.relicChance === "number" ? msg.relicChance : null;
    reply({ relicChance: state.testRelicChance });
  } else if (msg.op === "equipConfig") {
    state.testEquipDropChance = typeof msg.dropChance === "number" ? msg.dropChance : null;
    reply({ dropChance: state.testEquipDropChance });
  } else if (msg.op === "damageColonist" && typeof msg.id === "string" && typeof msg.amount === "number") {
    const c = colonists.get(msg.id);
    const before = c?.hp ?? null;
    if (c) damageColonist(c, msg.amount);
    reply({ found: !!c, before, after: c ? c.hp : null });
  } else if (msg.op === "hearthState") {
    // Camp hearths: every hearth with its site's living guardians, the counter and recent events.
    reply({
      campsDestroyed: state.campsDestroyed,
      events: hearthEvents.slice(),
      hearths: Array.from(hearths.values()).map((h) => ({
        ...h,
        tile: state.tiles[tileIndex(h.x, h.y)],
        guardians: Array.from(mobs.values())
          .filter((m) => m.siteId === h.siteId)
          .map((m) => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, active: m.guardianActive, tactic: m.tactic ?? null })),
      })),
    });
  } else if (msg.op === "damageHearth" && typeof msg.siteId === "string" && typeof msg.amount === "number") {
    const h = hearths.get(msg.siteId);
    if (h) damageHearth(h, msg.amount, "test");
    reply({ found: !!h, hp: h?.hp ?? null, destroyed: h?.destroyed ?? null });
  } else if (msg.op === "goalState") {
    // Goal track, the Castle Ruin and every boss / Castle Ruin guardian (goals-castle-test).
    reply({
      goalIndex: state.goalIndex,
      goal: state.goalSnapshot,
      goalTitles: GOALS.map((g) => g.title),
      castleCleared: state.castleCleared,
      campsDestroyed: state.campsDestroyed,
      castleRuinCenter: state.castleRuinCenter,
      nightsSurvived: nightsSurvived(),
      stock: { ...stock },
      mobs: Array.from(mobs.values())
        .filter((m) => m.boss || m.siteKind === "castleRuin" || m.siteKind === "miniBoss")
        .map((m) => ({
          id: m.id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, damage: m.damage, boss: m.boss ?? null,
          siteId: m.siteId, siteKind: m.siteKind, guardianActive: m.guardianActive, bossSighted: m.bossSighted ?? false,
        })),
    });
  } else if (msg.op === "fightState") {
    // Every tracked fight (unfiltered) plus this player's filtered list (fight-notifier-test).
    reply({ cycleTick: state.cycleTick, hits: state.fightHits.length, fights: state.activeFights.map((f) => ({ ...f, playerIds: Array.from(f.playerIds) })), mine: fightsForPlayer(player) });
  } else if (msg.op === "buildingState") {
    // Building HP / repair state, builders, and every mob's target (with its approach tile).
    reply({
      buildingHp: Array.from(buildingHp),
      repairPaid: Array.from(repairPaid),
      repairQueue,
      damagedBuildings: damagedBuildingsForSnapshot(),
      stock: { ...stock },
      cycleTick: state.cycleTick,
      isNight: isNightNow(),
      builders: Array.from(colonists.values())
        .filter((c) => c.kind === "builder")
        .map((c) => ({ id: c.id, x: c.x, y: c.y, state: c.state, postX: c.postX, postY: c.postY, repairKey: c.repairKey ?? null })),
      mobs: Array.from(mobs.values()).map((m) => ({
        id: m.id, x: m.x, y: m.y, targetType: m.targetType, targetId: m.targetId, approachX: m.approachX, approachY: m.approachY,
      })),
    });
  } else if (msg.op === "towerState") {
    // Tower tuning, every standing Tower, and livingTowersNear(tx, ty, radius) when asked (towers-farms-test).
    const towers: Array<Record<string, unknown>> = [];
    for (let i = 0; i < state.tiles.length; i++) {
      if (!isTowerTile(state.tiles[i] as TileType)) continue;
      const x = i % state.WORLD_TILES_X;
      const y = Math.floor(i / state.WORLD_TILES_X);
      towers.push({ x, y, level: getBuildingLevel(x, y), cooldown: towerCooldowns.get(resourceKey(x, y)) ?? 0, hp: structureHp(x, y) });
    }
    reply({
      stats: TOWER_STATS,
      costs: TOWER_COSTS,
      cooldownTicks: [1, 2, 3].map(towerCooldownTicks),
      towers,
      near: typeof msg.tx === "number" && typeof msg.ty === "number" && typeof msg.radius === "number"
        ? livingTowersNear(msg.tx, msg.ty, msg.radius)
        : null,
      barnMaxFarmPlots: BARN_MAX_FARM_PLOTS,
      barnFarmRadiusTiles: BARN_FARM_RADIUS_TILES,
      cycleTick: state.cycleTick,
    });
  } else if (msg.op === "respawnState") {
    // Long days & dawn/dusk respawn windows (day-respawn-test).
    reply({
      cycleTick: state.cycleTick,
      isNight: isNightNow(),
      queue: respawnQueue.map((q) => ({ ...q })),
      respawn: respawnWindowSnapshot(),
      window: respawnWindowAt(state.cycleTick),
      duskTick: DUSK_RESPAWN_CYCLE_TICK,
      wardPriestRespawnTicks: state.wardPriestRespawnTicks,
      constants: {
        DAY_TICKS, NIGHT_TICKS, GAME_DAY_TICKS, LEGACY_DAY_TICKS, LEGACY_NIGHT_TICKS, DAY_LENGTH_SCALE,
        FOOD_PER_COLONIST_PER_DAY, FARM_GROW_TICKS, FARMHAND_CYCLE_TICKS, FORAGE_REGROW_TICKS,
        WILDLIFE_RESPAWN_INTERVAL_TICKS, DESERTER_ACTIVATION_TICKS, RESPAWN_FOOD_COST,
      },
      goalTitles: GOALS.map((g) => g.title),
      colonists: Array.from(colonists.values()).map((c) => ({ id: c.id, kind: c.kind, postX: c.postX, postY: c.postY })),
    });
  }
}
// One HTTP server on PORT: websocket upgrades go to `wss`; plain GET /saves lists the save slots for
// the main menu (which has no websocket open yet).
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/saves") {
    void listSaves().then((saves) => {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ saves }));
    });
    return;
  }
  res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
  res.end();
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT);
console.log(`colony2d server listening on ws://localhost:${PORT}`);

function sendWelcome(player: Player) {
  const welcome: ServerMessage = {
    type: "welcome",
    id: player.id,
    tileSize: TILE_SIZE,
    worldTilesX: state.WORLD_TILES_X,
    worldTilesY: state.WORLD_TILES_Y,
    tiles: Array.from(state.tiles),
    biomes: Array.from(state.biomes),
    explored: packExplored(),
    difficulty: state.difficulty,
    castleRuin: state.castleRuinCenter,
  };
  player.socket.send(JSON.stringify(welcome));
}

export function resetWorld(nextDifficulty?: unknown, nextSize?: unknown) {
  // A restart reopens the difficulty claim; a value sent with the restart claims it straight away.
  state.difficultyClaimed = false;
  if (isDifficulty(nextDifficulty)) {
    state.difficulty = nextDifficulty;
    state.difficultyClaimed = true;
  }
  // mobs/colonists must be cleared before generateWorld, which spawns the fresh POI guardians and
  // Abbey clergy.
  colonists.clear();
  mobs.clear();
  wildlife.clear();
  // A different size re-allocates the world arrays (live regeneration, no server restart).
  if (typeof nextSize === "number" && Number.isFinite(nextSize)) setWorldSize(nextSize);
  // Before generateWorld: it tops up the starting builders, counting queued builder respawns.
  respawnQueue.length = 0;
  generateWorld();

  respawnQueue.length = 0;
  farmPlots.clear();
  minesPlacedOnOre.clear();
  buildingLevel.clear();
  towerCooldowns.clear();
  buildingHp.clear();
  repairPaid.clear();
  repairQueue.length = 0;
  state.buildingTargetsDirty = true;
  reservedResourceTiles.clear();
  taskForces.clear();
  taskForceMax.clear();
  clearOrderGroups();
  clearPlayerMorale();
  wardStonesActiveLastTick.clear();
  wardStoneLastTended.clear();
  gravestones.length = 0;
  state.wardPriestId = null;
  state.wardPriestTendTicks = 0;
  state.wardPriestRespawnTicks = -1;
  state.pendingEffects = [];
  // Hero phase 4: statuses, cooldowns and summons are transient.
  clearSpellState();

  Object.assign(stock, initialStock());
  resetEquipment();
  heroProfiles.clear();
  heroRecruits.length = 0;
  state.heroRosterVersion++;
  state.marketBuilt = false;
  state.goldShopBuilt = false;
  state.colonyHappiness = 100;

  constructionSites.clear();
  gates.clear();
  state.gateTilesDirty = true;
  mobsWithoutRoute.clear();

  state.cycleTick = 0;
  state.wasNight = false;
  raidGroups.clear();
  regiments.clear();
  walledSites.clear();
  state.raidSpawnedForDay = -1;
  state.treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;
  state.lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;
  state.isPaused = false;
  state.pausedBy = null;
  state.timeScale = 1;
  state.timeScaleBy = null;
  state.simAccum = 0;

  respawnPlayersAndWelcome();
}

// After the world is replaced (restart or load): every connected player respawns at a Town Center
// and gets the whole new world in a fresh welcome.
function respawnPlayersAndWelcome() {
  clearFights();
  for (const player of players.values()) {
    const spawn = spawnPointNearTownCenter();
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = playerMaxHp(player);
    player.profileSentVersion = -1;
    player.heroesSentVersion = -1;
    player.attackCooldownTicks = 0;
    player.poisonTicksRemaining = 0;
    player.poisonDamagePerTick = 0;
    player.input = { dx: 0, dy: 0 };
    player.dead = false;
  }

  for (const player of players.values()) {
    sendWelcome(player);
  }
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = state.saveLoadQueue.then(fn, fn);
  state.saveLoadQueue = run.catch(() => undefined);
  return run;
}

function isSaveSlot(value: unknown): value is SaveSlot {
  return typeof value === "string" && (SAVE_SLOTS as string[]).includes(value);
}

function savePath(slot: SaveSlot): string {
  return path.join(SAVE_DIR, `${slot}.json`);
}

// Plain-object view of the world. Serialized right away (JSON.stringify), so live objects are
// referenced rather than copied. Raid groups' Maps become entry arrays.
export function snapshotWorld() {
  return {
    tiles: Buffer.from(state.tiles).toString("base64"),
    biomes: Buffer.from(state.biomes).toString("base64"),
    explored: packExplored(),
    worldNoiseSalt: state.worldNoiseSalt,
    abbeyCenter: state.abbeyCenter,
    castleRuinCenter: state.castleRuinCenter,
    goals: { goalIndex: state.goalIndex, castleCleared: state.castleCleared, campsDestroyed: state.campsDestroyed },
    hearths: Array.from(hearths.values()),
    // Forts phase A: NPC tile owners as flattened [tile index, site number] pairs + the site ids they
    // name (optional: saves without them have every tile the colony's).
    owners: Array.from(tileOwner).flat() as number[] | undefined,
    ownerSites: [...ownerSiteIds] as string[] | undefined,
    stock: { ...stock },
    // Armour & weapons (forge queues are not saved: a load starts every Blacksmith idle).
    equipment: { armour: [...equipment.armour], weapon: [...equipment.weapon] },
    // Hero phases 1-2: every player profile (gear, inventory, XP).
    heroProfiles: serializeHeroProfiles() as unknown,
    // Hero phase 3: heroes still being recruited (the heroes themselves are colonists / respawn entries).
    heroRecruits: heroRecruits.map((r) => ({ ...r })),
    marketBuilt: state.marketBuilt,
    goldShopBuilt: state.goldShopBuilt,
    colonyHappiness: state.colonyHappiness,
    difficulty: state.difficulty,
    cycleTick: state.cycleTick,
    // Long days: the cycle this cycleTick was counted in (saves without it are the old 1200 + 800).
    dayTicks: DAY_TICKS as number,
    nightTicks: NIGHT_TICKS as number,
    wasNight: state.wasNight,
    raidSpawnedForDay: state.raidSpawnedForDay,
    treeRespawnCooldown: state.treeRespawnCooldown,
    lumberjackTreeGrowCooldown: state.lumberjackTreeGrowCooldown,
    wildlifeRespawnCooldown: state.wildlifeRespawnCooldown,
    nextWildlifeId: state.nextWildlifeId,
    wardPriestId: state.wardPriestId,
    wardPriestTendTicks: state.wardPriestTendTicks,
    wardPriestRespawnTicks: state.wardPriestRespawnTicks,
    townCenters: state.townCenters,
    // Hero phase 4: summons aren't saved; a slowed mob is saved at its own speed.
    colonists: Array.from(colonists.values()).filter((c) => !summonedUntil.has(c.id)),
    mobs: Array.from(mobs.values(), (m) => (unslowedSpeed(m) === m.speed ? m : { ...m, speed: unslowedSpeed(m) })),
    wildlife: Array.from(wildlife.values()),
    respawnQueue,
    farmPlots: Array.from(farmPlots),
    forageRegrow: Array.from(forageRegrow),
    minesPlacedOnOre: Array.from(minesPlacedOnOre),
    buildingLevel: Array.from(buildingLevel),
    buildingHp: Array.from(buildingHp),
    repairPaid: Array.from(repairPaid),
    repairQueue,
    taskForces: Array.from(taskForces),
    reservedResourceTiles: Array.from(reservedResourceTiles),
    wardStoneLastTended: Array.from(wardStoneLastTended),
    wardStonesActiveLastTick: Array.from(wardStonesActiveLastTick),
    gravestones,
    constructionSites: Array.from(constructionSites),
    gates: Array.from(gates),
    raidGroups: Array.from(raidGroups.values()).map((g) => ({
      ...g,
      homes: Array.from(g.homes),
      offsets: Array.from(g.offsets),
    })),
    flags: {
      testForceDeserterRoll: state.testForceDeserterRoll,
      testHoldRaidAggro: state.testHoldRaidAggro,
      testRaidsDisabled: state.testRaidsDisabled,
      testWildlifeRespawnDisabled: state.testWildlifeRespawnDisabled,
      testForceMarkChance: state.testForceMarkChance,
      instantBuild: state.instantBuild,
      testPlayersIgnored: state.testPlayersIgnored,
    },
  };
}

function refill<K, V>(map: Map<K, V>, entries: [K, V][]) {
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
}

function applyWorld(s: WorldState) {
  state.tiles.set(Buffer.from(s.tiles, "base64"));
  state.biomes.set(Buffer.from(s.biomes, "base64"));
  const bits = Buffer.from(s.explored, "base64");
  for (let i = 0; i < state.explored.length; i++) state.explored[i] = (bits[i >> 3] >> (i & 7)) & 1;
  state.worldNoiseSalt = s.worldNoiseSalt;
  state.abbeyCenter = s.abbeyCenter;
  // `?? null` / missing `goals`: saves from before Phase 5 have no Castle Ruin, and their goal track
  // catches up silently (below, once the rest of the world is in place).
  state.castleRuinCenter = s.castleRuinCenter ?? null;
  state.goalIndex = s.goals?.goalIndex ?? 0;
  state.castleCleared = s.goals?.castleCleared ?? false;
  state.campsDestroyed = s.goals?.campsDestroyed ?? 0;
  Object.assign(stock, s.stock);
  // `?? zeros`: saves from before Armour & weapons have an empty stock (units without tiers fight as tier 0).
  resetEquipment();
  equipment.armour = [0, 1, 2].map((i) => s.equipment?.armour?.[i] ?? 0);
  equipment.weapon = [0, 1, 2].map((i) => s.equipment?.weapon?.[i] ?? 0);
  // Saves from before Hero phases 1-2: no profiles (everyone starts with an empty pack, level 1).
  restoreHeroProfiles(s.heroProfiles);
  // Saves from before hero phase 3: no heroes, nobody being recruited.
  heroRecruits.length = 0;
  heroRecruits.push(...((s.heroRecruits ?? []) as HeroRecruit[]));
  state.heroRosterVersion++;
  state.marketBuilt = s.marketBuilt;
  state.goldShopBuilt = s.goldShopBuilt;
  state.colonyHappiness = s.colonyHappiness;
  state.difficulty = s.difficulty;
  // The loaded world's difficulty is settled: joining clients' setDifficulty must not override it.
  state.difficultyClaimed = true;
  state.cycleTick = s.cycleTick;
  state.wasNight = s.wasNight;
  state.raidSpawnedForDay = s.raidSpawnedForDay;
  state.treeRespawnCooldown = s.treeRespawnCooldown;
  state.lumberjackTreeGrowCooldown = s.lumberjackTreeGrowCooldown;
  state.wildlifeRespawnCooldown = s.wildlifeRespawnCooldown;
  state.nextWildlifeId = s.nextWildlifeId;
  state.wardPriestId = s.wardPriestId;
  state.wardPriestTendTicks = s.wardPriestTendTicks;
  state.wardPriestRespawnTicks = s.wardPriestRespawnTicks;
  state.townCenters = s.townCenters;
  refill(colonists, s.colonists.map((c): [string, Colonist] => [c.id, c]));
  // Saves from before settlements: attach every unit to the Town Center nearest its post (never rejects).
  for (const c of colonists.values()) {
    settlementOf(c);
  }
  refill(mobs, s.mobs.map((m): [string, Mob] => [m.id, m]));
  refill(wildlife, s.wildlife.map((a): [number, Wildlife] => [a.id, a]));
  respawnQueue.length = 0;
  respawnQueue.push(...s.respawnQueue);
  refill(farmPlots, s.farmPlots);
  refill(forageRegrow, s.forageRegrow);
  minesPlacedOnOre.clear();
  for (const key of s.minesPlacedOnOre) minesPlacedOnOre.add(key);
  refill(buildingLevel, s.buildingLevel);
  // `?? []`: saves from before building HP load with every building at full HP.
  refill(buildingHp, s.buildingHp ?? []);
  refill(repairPaid, s.repairPaid ?? []);
  migrateArcherTowers();
  repairQueue.length = 0;
  repairQueue.push(...(s.repairQueue ?? []));
  state.buildingTargetsDirty = true;
  refill(taskForces, s.taskForces);
  taskForceMax.clear();
  clearOrderGroups();
  clearPlayerMorale();
  refill(reservedResourceTiles, s.reservedResourceTiles);
  refill(wardStoneLastTended, s.wardStoneLastTended);
  wardStonesActiveLastTick.clear();
  for (const key of s.wardStonesActiveLastTick) wardStonesActiveLastTick.add(key);
  gravestones.length = 0;
  gravestones.push(...s.gravestones);
  refill(constructionSites, s.constructionSites);
  // `?? []`: saves from before gates (none on the map); gate tiles without a record start closed / auto.
  refill(gates, s.gates ?? []);
  state.gateTilesDirty = true;
  mobsWithoutRoute.clear();
  refill(
    raidGroups,
    s.raidGroups.map((g): [string, RaidGroup] => [g.id, { ...g, homes: new Map(g.homes), offsets: new Map(g.offsets) }])
  );
  // Monster tactics state is not saved: regiments start fresh (morale 100) from the restored mobs.
  regiments.clear();
  // Camp hearths (destroyed ones included); saves from before them, or sites without one, get a
  // full-HP hearth on their campfire.
  refill(hearths, (s.hearths ?? []).map((h): [string, HearthState] => [h.siteId, h]));
  backfillHearths();
  clearOwners();
  ownerSiteIds.push(...(s.ownerSites ?? []));
  const owners = s.owners ?? [];
  for (let i = 0; i + 1 < owners.length; i += 2) if (owners[i] < state.tiles.length && owners[i + 1] > 0) tileOwner.set(owners[i], owners[i + 1]);
  state.testForceDeserterRoll = s.flags.testForceDeserterRoll;
  state.testHoldRaidAggro = s.flags.testHoldRaidAggro;
  state.testRaidsDisabled = s.flags.testRaidsDisabled;
  state.testWildlifeRespawnDisabled = s.flags.testWildlifeRespawnDisabled;
  state.testForceMarkChance = s.flags.testForceMarkChance;
  state.instantBuild = s.flags.instantBuild;
  state.testPlayersIgnored = s.flags.testPlayersIgnored ?? false;
  towerCooldowns.clear();
  migrateSaveDayLength(s.dayTicks ?? LEGACY_DAY_TICKS, s.nightTicks ?? LEGACY_NIGHT_TICKS);
  evaluateGoals(!s.goals);
  // Transients: nothing in flight survives a load; everyone re-stamps vision from scratch.
  state.pendingEffects = [];
  // Hero phase 4: statuses, cooldowns and summons are transient.
  clearSpellState();
  state.pendingExplored = [];
  state.visionTile = new WeakMap();
  state.isPaused = false;
  state.pausedBy = null;
  state.timeScale = 1;
  state.timeScaleBy = null;
  state.simAccum = 0;
}

// The wall-mounted Archer Tower is gone: an old save's ArcherTower tile becomes a plain Archery Range
// (its archers keep their post). One tile cannot hold both post and wall, so the wall the old tower
// replaced is not restored.
function migrateArcherTowers() {
  for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
      if ((state.tiles[tileIndex(tx, ty)] as TileType) !== TileType.ArcherTower) continue;
      state.tiles[tileIndex(tx, ty)] = TileType.ArcherPost;
      for (const c of getColonistsAtPost(tx, ty)) {
        if (c.kind !== "archer") continue;
        const stats = guardStats("archer", c.castleLevel);
        c.maxHp = stats.maxHp;
        c.hp = Math.min(c.hp, stats.maxHp);
      }
    }
  }
}

// Long days: a save counted in another cycle length (every save from before 2026-10-23 is 1200 + 800)
// keeps its day number and its place in the day/night (same fraction of the day or of the night).
// Absolute tick stamps move by the same delta, so their elapsed times (ward grace, fury, deserter
// age, raid aggro) are unchanged.
function migrateSaveDayLength(oldDay: number, oldNight: number) {
  if (oldDay === DAY_TICKS && oldNight === NIGHT_TICKS) return;
  const oldCycle = oldDay + oldNight;
  const day = Math.floor(state.cycleTick / oldCycle);
  const pos = state.cycleTick % oldCycle;
  const newPos =
    pos < oldDay
      ? Math.floor((pos * DAY_TICKS) / oldDay)
      : DAY_TICKS + Math.floor(((pos - oldDay) * NIGHT_TICKS) / oldNight);
  const delta = day * GAME_DAY_TICKS + newPos - state.cycleTick;
  state.cycleTick += delta;
  state.wasNight = isNightNow();
  for (const m of mobs.values()) {
    m.lastDamagedTick += delta;
    m.furyUntilTick += delta;
    m.withdrawUntilTick += delta;
    m.feintUntilTick += delta;
    m.deserterSinceTick += delta;
  }
  for (const g of raidGroups.values()) {
    g.aggroTick += delta;
    if (g.engagedTick !== undefined && g.engagedTick !== null) g.engagedTick += delta;
  }
  for (const [key, t] of wardStoneLastTended) wardStoneLastTended.set(key, t + delta);
  console.log(`[load] day length ${oldDay}+${oldNight} -> ${DAY_TICKS}+${NIGHT_TICKS} ticks: cycleTick moved by ${delta}`);
}

function saveFileFor(slot: SaveSlot): SaveFile {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    dayIndex: Math.floor(state.cycleTick / GAME_DAY_TICKS),
    population: civilianPopulationUsed(),
    difficulty: state.difficulty,
    worldSize: state.WORLD_TILES_X,
    label: SAVE_SLOT_LABELS[slot],
    state: snapshotWorld(),
  };
}

// Snapshot + stringify run synchronously inside one tick (so the sim is effectively paused for them
// and the save is a consistent instant); only the disk write is async (temp file + rename).
function saveToSlot(slot: SaveSlot): Promise<string | null> {
  return serialized(() => writeSave(slot));
}

async function writeSave(slot: SaveSlot): Promise<string | null> {
  try {
    const t0 = performance.now();
    const json = JSON.stringify(saveFileFor(slot));
    const syncMs = performance.now() - t0;
    await fsp.mkdir(SAVE_DIR, { recursive: true });
    const tmp = `${savePath(slot)}.tmp`;
    await fsp.writeFile(tmp, json);
    await fsp.rename(tmp, savePath(slot));
    console.log(
      `[save] ${slot}: ${(json.length / 1024).toFixed(1)} KiB, snapshot+stringify ${syncMs.toFixed(1)} ms (blocks the tick), total ${(performance.now() - t0).toFixed(1)} ms`
    );
    return null;
  } catch (err) {
    console.error(`[save] ${slot} failed:`, err);
    return `Save failed: ${(err as Error).message}`;
  }
}

function loadFromSlot(slot: SaveSlot): Promise<string | null> {
  return serialized(() => readSave(slot));
}

async function readSave(slot: SaveSlot): Promise<string | null> {
  state.simHeldForLoad = true;
  try {
    const t0 = performance.now();
    let file: SaveFile;
    try {
      file = JSON.parse(await fsp.readFile(savePath(slot), "utf8"));
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? `${SAVE_SLOT_LABELS[slot]} is empty` : `Save file is unreadable`;
    }
    if (file.version !== SAVE_VERSION) {
      return `Save version ${file.version} is not supported (this server reads version ${SAVE_VERSION})`;
    }
    // The save brings its own map size (saves from before sizes were chosen stored the size they ran at).
    if (!Number.isInteger(file.worldSize) || file.worldSize < MIN_WORLD_SIZE || file.worldSize > MAX_WORLD_SIZE) {
      return `Save has an unsupported world size (${file.worldSize})`;
    }
    if (file.worldSize !== state.WORLD_TILES_X) {
      colonists.clear();
      mobs.clear();
      wildlife.clear();
      setWorldSize(file.worldSize);
    }
    applyWorld(file.state);
    respawnPlayersAndWelcome();
    broadcastEvent("build", "Game loaded");
    console.log(`[load] ${slot}: day ${file.dayIndex + 1}, ${(performance.now() - t0).toFixed(1)} ms`);
    return null;
  } finally {
    state.simHeldForLoad = false;
  }
}

async function listSaves(): Promise<SaveInfo[]> {
  const out: SaveInfo[] = [];
  for (const slot of SAVE_SLOTS) {
    try {
      const file: SaveFile = JSON.parse(await fsp.readFile(savePath(slot), "utf8"));
      out.push({
        slot,
        label: file.label,
        savedAt: file.savedAt,
        dayIndex: file.dayIndex,
        population: file.population,
        difficulty: file.difficulty,
      });
    } catch {
      /* empty slot (or unreadable): not listed */
    }
  }
  return out;
}

function sendTo(player: Player, message: ServerMessage) {
  if (player.socket.readyState === player.socket.OPEN) player.socket.send(JSON.stringify(message));
}

async function handleSaveGame(player: Player, slot: unknown) {
  if (!isSaveSlot(slot) || slot === "autosave") return;
  const error = await saveToSlot(slot);
  sendTo(player, { type: "saveResult", ok: !error, ...(error ? { error } : {}), slot, action: "save" });
  sendTo(player, { type: "saveList", saves: await listSaves() });
}

async function handleLoadGame(player: Player, slot: unknown) {
  if (!isSaveSlot(slot)) return;
  const error = await loadFromSlot(slot);
  sendTo(player, { type: "saveResult", ok: !error, ...(error ? { error } : {}), slot, action: "load" });
}

function runDueAutosave() {
  if (!state.autosaveDue) return;
  state.autosaveDue = false;
  // Debounced: never more than one autosave queued or writing.
  if (!AUTOSAVE_ENABLED || !state.anyPlayerSinceBoot || state.autosaveQueued) return;
  state.autosaveQueued = true;
  void saveToSlot("autosave").finally(() => (state.autosaveQueued = false));
}
function saveOnShutdown(signal: string) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  if (AUTOSAVE_ENABLED && state.anyPlayerSinceBoot && !state.simHeldForLoad) {
    try {
      const t0 = performance.now();
      mkdirSync(SAVE_DIR, { recursive: true });
      writeFileSync(savePath("autosave"), JSON.stringify(saveFileFor("autosave")));
      console.log(`[save] autosave on ${signal}: ${(performance.now() - t0).toFixed(1)} ms`);
    } catch (err) {
      console.error(`[save] autosave on ${signal} failed:`, err);
    }
  }
  process.exit(0);
}
process.on("SIGINT", () => saveOnShutdown("SIGINT"));
process.on("SIGTERM", () => saveOnShutdown("SIGTERM"));

wss.on("connection", (socket, req) => {
  const id = randomUUID();
  // Hero phases 1-2: the client's stored profile id (`?profile=`), else the world's "default" profile.
  const profileParam = new URL(req.url ?? "/", "http://localhost").searchParams.get("profile") ?? "";
  const profileKey = /^[\w-]{1,64}$/.test(profileParam) ? profileParam : "default";
  const color = PLAYER_COLORS[state.nextColorIndex % PLAYER_COLORS.length];
  state.nextColorIndex += 1;

  const spawn = spawnPointNearTownCenter();
  const player: Player = {
    id,
    x: spawn.x,
    y: spawn.y,
    color,
    hp: PLAYER_MAX_HP,
    input: { dx: 0, dy: 0 },
    socket,
    attackCooldownTicks: 0,
    poisonTicksRemaining: 0,
    poisonDamagePerTick: 0,
    dead: false,
    profileKey,
    profileSentVersion: -1,
    heroesSentVersion: -1,
    view: null,
    viewSetAt: 0,
    orderWindowAt: 0,
    orderWindowCount: 0,
  };
  players.set(id, player);
  player.hp = playerMaxHp(player);
  state.anyPlayerSinceBoot = true;

  sendWelcome(player);

  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (TEST_HOOKS && (message as { type: string }).type === "testHook") {
      handleTestHook(player, message as unknown as Record<string, unknown>);
      return;
    }

    if (message.type === "input") {
      const dx = clamp(message.dx, -1, 1);
      const dy = clamp(message.dy, -1, 1);
      player.input = { dx, dy };
    } else if (message.type === "setTile") {
      handleSetTile(player, message.tileX, message.tileY, message.tile);
    } else if (message.type === "attack") {
      handlePlayerAttack(player);
    } else if (message.type === "setView") {
      handleSetView(player, message);
    } else if (message.type === "pause") {
      if (state.simHeldForLoad) return;
      state.isPaused = typeof message.paused === "boolean" ? message.paused : !state.isPaused;
      state.pausedBy = player.id;
    } else if (message.type === "setTimeScale") {
      if (state.simHeldForLoad || !(TIME_SCALES as readonly number[]).includes(message.scale)) return;
      state.timeScale = message.scale;
      state.timeScaleBy = player.id;
      state.simAccum = 0;
    } else if (message.type === "restart") {
      resetWorld(message.difficulty, message.worldSize);
    } else if (message.type === "setDifficulty") {
      handleSetDifficulty(message.difficulty, message.worldSize);
    } else if (message.type === "commandMove") {
      handleCommandMove(message.unitIds, message.x, message.y, message.squad);
    } else if (message.type === "commandAttack") {
      handleCommandAttack(message.unitIds, message.mobId);
    } else if (message.type === "commandAttackHearth") {
      if (!Array.isArray(message.unitIds) || !Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleCommandAttackHearth(message.unitIds, message.tileX, message.tileY);
    } else if (message.type === "commandStance") {
      handleCommandStance(message.unitIds, message.stance);
    } else if (message.type === "assignTaskForce") {
      handleAssignTaskForce(message.slot, message.unitIds);
    } else if (message.type === "regimentOrder") {
      handleRegimentOrder(player, message);
    } else if (message.type === "regimentSettings") {
      handleRegimentSettings(player, message);
    } else if (message.type === "exchangeResource") {
      handleExchangeResource(message.from, message.to);
    } else if (message.type === "buyWithGold") {
      handleBuyWithGold(message.item);
    } else if (message.type === "buildingInfo") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      const reply: ServerMessage = {
        type: "buildingInfo",
        tileX: message.tileX,
        tileY: message.tileY,
        info: buildingInfoFor(message.tileX, message.tileY, player),
      };
      socket.send(JSON.stringify(reply));
    } else if (message.type === "upgradeBuilding") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleUpgradeBuilding(player, message.tileX, message.tileY);
    } else if (message.type === "repairBuilding") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleRepairBuilding(player, message.tileX, message.tileY);
    } else if (message.type === "setGateLock") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleSetGateLock(message.tileX, message.tileY, message.lock);
    } else if (message.type === "queueSiege") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleQueueSiege(message.tileX, message.tileY, message.kind);
    } else if (message.type === "queueForge") {
      if (!Number.isInteger(message.tileX) || !Number.isInteger(message.tileY)) return;
      handleQueueForge(message.tileX, message.tileY, message.slot);
    } else if (message.type === "equipItem") {
      handleEquipItem(player, message.itemId, message.slot, message.heroId);
    } else if (message.type === "unequipItem") {
      handleUnequipItem(player, message.slot, message.heroId);
    } else if (message.type === "takeFromArmoury") {
      handleTakeFromArmoury(player, message.slot, message.tier, message.heroId);
    } else if (message.type === "recruitHero") {
      if (!Number.isInteger(message.tx) || !Number.isInteger(message.ty)) return;
      handleRecruitHero(player, message.tx, message.ty, message.class);
    } else if (message.type === "setSpellSlot") {
      handleSetSpellSlot(player, message.slot, message.spellId, message.heroId);
    } else if (message.type === "useTome") {
      handleUseTome(player, message.itemId, message.heroId);
    } else if (message.type === "learnSpell") {
      handleLearnSpell(player, message.spellId, message.tileX, message.tileY);
    } else if (message.type === "castSpell") {
      handleCastSpell(player, message as unknown as Record<string, unknown>);
    } else if (message.type === "setSpellAuto") {
      handleSetSpellAuto(player, message.heroId, message.auto);
    } else if (message.type === "saveGame") {
      void handleSaveGame(player, message.slot);
    } else if (message.type === "loadGame") {
      void handleLoadGame(player, message.slot);
    } else if (message.type === "listSaves") {
      void listSaves().then((saves) => sendTo(player, { type: "saveList", saves }));
    }
  });

  socket.on("close", () => {
    players.delete(id);
  });
});
export function equipEvent(e: Omit<(typeof equipEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  equipEvents.push({ ...e, tick: state.cycleTick });
  if (equipEvents.length > 300) equipEvents.splice(0, equipEvents.length - 300);
}

function resetEquipment() {
  equipment.armour = [0, 0, 0];
  equipment.weapon = [0, 0, 0];
  forgeQueues.clear();
  state.lastUnequippedToastTick = -Infinity;
  state.equipDropToasted = false;
  state.lastEquipDropToastTick = -Infinity;
}

export function isEquippedKind(kind: ColonistKind): boolean {
  return EQUIPPED_KINDS.includes(kind);
}

// Takes the highest tier in stock of `slot` (0 when the stock is empty).
function takeBestEquipment(slot: EquipSlot): number {
  for (let tier = EQUIP_TIERS; tier >= 1; tier--) {
    if (equipment[slot][tier - 1] > 0) {
      equipment[slot][tier - 1]--;
      return tier;
    }
  }
  return 0;
}

// Called by spawnColonistForPost for every EQUIPPED_KINDS unit (posts, upgrades, respawns, house extras).
export function equipNewUnit(c: Colonist) {
  c.armourTier = takeBestEquipment("armour");
  c.weaponTier = takeBestEquipment("weapon");
  equipEvent({ type: "equip", id: c.id, detail: `${c.kind} armour ${c.armourTier} weapon ${c.weaponTier}` });
  if (c.armourTier > 0 && c.weaponTier > 0) return;
  equipEvent({ type: "unequipped", id: c.id, detail: `${c.armourTier === 0 ? "armour " : ""}${c.weaponTier === 0 ? "weapon" : ""}`.trim() });
  if (state.cycleTick - state.lastUnequippedToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  state.lastUnequippedToastTick = state.cycleTick;
  const missing = c.armourTier === 0 && c.weaponTier === 0 ? "armour or weapons" : c.armourTier === 0 ? "armour" : "a forged weapon";
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent("build", `A ${name} musters without ${missing} — the stock is empty (forge more at a Blacksmith)`);
}

export function weaponDamageMult(c: Colonist): number {
  return WEAPON_DAMAGE_MULT[c.weaponTier ?? 0] ?? 1;
}

export function armourDamageTakenMult(c: Colonist): number {
  return ARMOUR_DAMAGE_TAKEN_MULT[c.armourTier ?? 0] ?? 1;
}

function rollLootTier(): number {
  let r = Math.random();
  for (let i = 0; i < EQUIP_LOOT_TIER_WEIGHTS.length; i++) {
    r -= EQUIP_LOOT_TIER_WEIGHTS[i];
    if (r < 0) return i + 1;
  }
  return 1;
}

// `count` pieces (armour or weapon at random) of a weighted random tier, straight into the stock.
// Returns the toast text, e.g. "2 armour (T1, T3), 1 weapon (T2)".
function grantTieredEquipment(count: number, source: string): string {
  const got: Record<EquipSlot, number[]> = { armour: [], weapon: [] };
  for (let i = 0; i < count; i++) {
    const slot: EquipSlot = Math.random() < 0.5 ? "armour" : "weapon";
    const tier = rollLootTier();
    equipment[slot][tier - 1]++;
    got[slot].push(tier);
    equipEvent({ type: "loot", slot, tier, detail: source });
  }
  return (["armour", "weapon"] as EquipSlot[])
    .filter((slot) => got[slot].length > 0)
    .map((slot) => `${got[slot].length} ${EQUIP_SLOT_LABEL[slot]} (${got[slot].sort().map((t) => `T${t}`).join(", ")})`)
    .join(", ");
}

// From damageMob on a kill: armoured kinds drop a tier-1 piece EQUIP_DROP_CHANCE of the time, bosses /
// mini-boss elites / Hunger-marked mobs always. Deserters (former colonists) drop nothing.
export function dropEquipmentFor(mob: Mob) {
  if (mob.isDeserter) return;
  const guaranteed = !!mob.boss || mob.mark !== HungerMark.None;
  if (!guaranteed && !EQUIP_ARMOURED_KINDS.includes(mob.kind)) return;
  if (!guaranteed && Math.random() >= (state.testEquipDropChance ?? EQUIP_DROP_CHANCE)) return;
  const slot: EquipSlot = Math.random() < 0.5 ? "armour" : "weapon";
  equipment[slot][0]++;
  equipEvent({ type: "drop", id: mob.id, slot, tier: 1, detail: mob.kind });
  const first = !state.equipDropToasted;
  if (!first && state.cycleTick - state.lastEquipDropToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  state.equipDropToasted = true;
  state.lastEquipDropToastTick = state.cycleTick;
  const name = mob.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent(
    first ? "milestone" : "build",
    `Salvaged a tier-1 ${EQUIP_SLOT_LABEL[slot]} from a fallen ${name}${first ? " — it goes to the colony's stock" : ""}`
  );
}
export function heroEvent(e: Omit<(typeof heroEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  heroEvents.push({ ...e, tick: state.cycleTick });
  if (heroEvents.length > 300) heroEvents.splice(0, heroEvents.length - 300);
}

function emptyEquipment(): Equipment {
  return Object.fromEntries(GEAR_SLOTS.map((s) => [s, null])) as Equipment;
}

function heroLevelFor(xp: number): number {
  let level = 1;
  while (level < HERO_MAX_LEVEL && xp >= HERO_LEVEL_XP[level]) level++;
  return level;
}

function computeHeroStats(equipment: Equipment, level: number, baseHp = PLAYER_MAX_HP, spellBasePct = 0): HeroStats {
  const sum: Required<ItemStats> = { damagePct: 0, damageTakenPct: 0, maxHp: 0, moveSpeedPct: 0, attackSpeedPct: 0, spellPowerPct: 0 };
  for (const slot of GEAR_SLOTS) {
    const item = equipment[slot];
    if (!item) continue;
    for (const k of Object.keys(sum) as (keyof ItemStats)[]) sum[k] += item.stats[k] ?? 0;
  }
  const lv = level - 1;
  return {
    maxHp: baseHp + sum.maxHp + Math.round((baseHp * HERO_LEVEL_MAX_HP * lv) / 100),
    damageMult: (1 + sum.damagePct / 100) * (1 + (HERO_LEVEL_DAMAGE_PCT * lv) / 100),
    damageTakenMult: Math.max(HERO_MIN_DAMAGE_TAKEN_MULT, 1 + sum.damageTakenPct / 100),
    moveSpeedMult: Math.max(HERO_MIN_SPEED_MULT, 1 + sum.moveSpeedPct / 100),
    attackSpeedMult: Math.max(HERO_MIN_SPEED_MULT, 1 + sum.attackSpeedPct / 100),
    spellPowerMult: 1 + (sum.spellPowerPct + spellBasePct) / 100,
  };
}

function newHeroProfile(
  key: string, equipment = emptyEquipment(), inventory: GearItem[] = [], xp = 0, hero?: { heroClass: HeroClass; heroName: string }
): HeroProfile {
  const level = heroLevelFor(xp);
  const baseHp = hero ? HERO_CLASS_STATS[hero.heroClass].maxHp : PLAYER_MAX_HP;
  return {
    key, equipment, inventory, xp, level, version: ++state.heroProfileVersionCounter,
    stats: computeHeroStats(equipment, level, baseHp, spellBasePctFor(hero?.heroClass)), ...(hero ?? {}),
    spells: [], spellSlots: Array(SPELL_SLOT_COUNT).fill(null), spellAuto: true, spellGrants: 0,
  };
}

export function heroProfileFor(key: string): HeroProfile {
  let prof = heroProfiles.get(key);
  if (!prof) {
    prof = newHeroProfile(key);
    heroProfiles.set(key, prof);
  }
  return prof;
}

export function heroProfileOf(player: Player): HeroProfile {
  return heroProfileFor(player.profileKey);
}

// After any change to a profile: re-derive its modifiers, mark it for resending, and clamp the HP of
// every player playing it to the new max (a max-HP gain doesn't heal).
function recomputeHeroProfile(prof: HeroProfile) {
  prof.level = heroLevelFor(prof.xp);
  prof.stats = computeHeroStats(prof.equipment, prof.level, prof.heroClass ? HERO_CLASS_STATS[prof.heroClass].maxHp : PLAYER_MAX_HP, spellBasePctFor(prof.heroClass));
  prof.version = ++state.heroProfileVersionCounter;
  for (const p of players.values()) {
    if (p.profileKey === prof.key && !p.dead) p.hp = Math.min(p.hp, prof.stats.maxHp);
  }
  // Hero phase 3: the living hero's max HP follows (a gain doesn't heal, a loss clamps).
  if (prof.heroClass) {
    state.heroRosterVersion++;
    const c = colonists.get(prof.key.slice(HERO_KEY_PREFIX.length));
    if (c) {
      c.maxHp = prof.stats.maxHp;
      c.hp = Math.min(c.hp, c.maxHp);
    }
  }
}

export function playerMaxHp(p: Player): number {
  return heroProfileOf(p).stats.maxHp;
}

export function playerDamage(p: Player): number {
  return PLAYER_ATTACK_DAMAGE * heroProfileOf(p).stats.damageMult * spellBuffDamageMult("p:" + p.id);
}

export function playerAttackCooldownTicks(p: Player): number {
  return Math.max(1, Math.round(PLAYER_ATTACK_COOLDOWN_TICKS / heroProfileOf(p).stats.attackSpeedMult));
}

function heroProfileSnapshot(prof: HeroProfile): HeroProfileSnapshot {
  return {
    equipment: prof.equipment,
    inventory: prof.inventory,
    inventoryCap: HERO_INVENTORY_CAP,
    xp: prof.xp,
    level: prof.level,
    levelXp: HERO_LEVEL_XP[prof.level - 1],
    nextLevelXp: prof.level < HERO_MAX_LEVEL ? HERO_LEVEL_XP[prof.level] : null,
    stats: prof.stats,
    spells: spellBookSnapshot(prof),
  };
}

function sendHeroEvent(prof: HeroProfile, category: GameEventCategory, text: string) {
  for (const p of players.values()) if (p.profileKey === prof.key) sendTo(p, { type: "event", category, text });
}

// Which slot kinds a gear slot accepts.
function gearSlotKind(slot: GearSlot): ItemSlotKind {
  if (slot === "trinket1" || slot === "trinket2") return "trinket";
  if (slot.startsWith("spell")) return "spell";
  return slot as ItemSlotKind;
}

function ownsRelic(prof: HeroProfile, relicId: string): boolean {
  const has = (p: HeroProfile) => p.inventory.some((i) => i.relicId === relicId) || GEAR_SLOTS.some((s) => p.equipment[s]?.relicId === relicId);
  // Hero phase 3: a relic worn by one of the colony's heroes counts as owned (heroes equip from the shared pack).
  return has(prof) || Array.from(heroProfiles.values()).some((p) => !!p.heroClass && has(p));
}

// A random relic this profile doesn't own yet (or `relicId`, if given and unowned) into its inventory.
// Returns the item, or null (all owned / unknown id / inventory full).
function grantRelic(prof: HeroProfile, source: string, relicId?: string): GearItem | null {
  const pool = RELIC_CATALOGUE.filter((r) => !ownsRelic(prof, r.relicId) && (relicId === undefined || r.relicId === relicId));
  if (pool.length === 0) return null;
  if (prof.inventory.length >= HERO_INVENTORY_CAP) {
    sendHeroEvent(prof, "build", "A relic was found, but your pack is full (40 items)");
    return null;
  }
  const r = pool[Math.floor(Math.random() * pool.length)];
  const item: GearItem = { id: randomUUID(), slot: r.slot, name: r.name, tier: "relic", stats: { ...r.stats }, kind: r.kind, relicId: r.relicId, icon: r.icon };
  prof.inventory.push(item);
  recomputeHeroProfile(prof);
  heroEvent({ type: "relic", key: prof.key, detail: `${r.relicId} ${source}` });
  sendHeroEvent(prof, "milestone", `Relic found: ${item.name}`);
  return item;
}

// Who gets a kill's relic / XP: the player who struck the blow ("p:<id>"), else (soldiers, towers, test
// hooks) every connected player's profile (relics only; XP needs a player's own killing blow).
function lootProfiles(attackerKey?: string): HeroProfile[] {
  if (attackerKey?.startsWith("p:")) {
    const p = players.get(attackerKey.slice(2));
    if (p) return [heroProfileOf(p)];
  }
  const keys = new Set(Array.from(players.values(), (p) => p.profileKey));
  return Array.from(keys, (k) => heroProfileFor(k));
}

// From damageMob on a kill: relics (bosses always, armoured / marked mobs RELIC_ELITE_MOB_CHANCE) and XP.
export function heroRewardsForKill(mob: Mob, attackerKey?: string) {
  if (attackerKey?.startsWith("p:")) {
    const p = players.get(attackerKey.slice(2));
    if (p) {
      const xp = mob.boss ? HERO_XP_BOSS[mob.boss] : HERO_XP_PER_KILL * (mob.mark !== HungerMark.None ? HERO_XP_MARKED_MULT : 1);
      const prof = heroProfileOf(p);
      const before = prof.level;
      prof.xp += xp;
      recomputeHeroProfile(prof);
      heroEvent({ type: "xp", key: prof.key, amount: xp, detail: mob.kind });
      if (prof.level > before) sendHeroEvent(prof, "milestone", `You reach level ${prof.level} (+${HERO_LEVEL_DAMAGE_PCT}% damage, +${HERO_LEVEL_MAX_HP} max HP)`);
      grantLevelSpells(prof, true);
    }
  }
  // Hero phase 3: a hero's killing blow (melee or its own arrow / bolt) earns that hero the XP; the relic
  // roll below still goes to the players' shared pack (lootProfiles: every connected player).
  if (attackerKey?.startsWith("c:")) {
    const hc = colonists.get(attackerKey.slice(2));
    if (hc?.kind === "hero") {
      const xp = mob.boss ? HERO_XP_BOSS[mob.boss] : HERO_XP_PER_KILL * (mob.mark !== HungerMark.None ? HERO_XP_MARKED_MULT : 1);
      const prof = heroProfileFor(heroKey(hc.id));
      const before = prof.level;
      prof.xp += xp;
      recomputeHeroProfile(prof);
      heroEvent({ type: "xp", key: prof.key, amount: xp, detail: mob.kind });
      if (prof.level > before) {
        broadcastEvent("milestone", `${hc.heroName ?? "A hero"} reaches level ${prof.level} (+${HERO_LEVEL_DAMAGE_PCT}% damage, +${HERO_LEVEL_MAX_HP}% max HP)`);
      }
      grantLevelSpells(prof, true);
    }
  }
  if (mob.isDeserter) return;
  // Hero phase 4: Spell Tomes (the Warlord always, a mini-boss elite TOME_ELITE_CHANCE).
  const tomeRoll = mob.boss === "warlord" ? 1 : mob.boss === "elite" ? (state.testTomeChance ?? TOME_ELITE_CHANCE) : 0;
  if (tomeRoll > 0 && Math.random() < tomeRoll) for (const prof of lootProfiles(attackerKey)) grantTome(prof, mob.boss ?? mob.kind);
  const roll = mob.boss ? 1 : mob.mark !== HungerMark.None || EQUIP_ARMOURED_KINDS.includes(mob.kind) ? (state.testRelicChance ?? RELIC_ELITE_MOB_CHANCE) : 0;
  if (roll <= 0 || Math.random() >= roll) return;
  for (const prof of lootProfiles(attackerKey)) grantRelic(prof, mob.boss ?? mob.kind);
}

function heroRelicForHearth(attackerKey?: string) {
  if (Math.random() < (state.testTomeChance ?? TOME_HEARTH_CHANCE)) for (const prof of lootProfiles(attackerKey)) grantTome(prof, "hearth");
  if (Math.random() >= (state.testRelicChance ?? RELIC_HEARTH_CHANCE)) return;
  for (const prof of lootProfiles(attackerKey)) grantRelic(prof, "hearth");
}

function refuseGear(player: Player, text: string) {
  heroEvent({ type: "refuse", key: player.profileKey, detail: text });
  sendTo(player, { type: "event", category: "build", text });
}

// Hero phase 3: the profile whose equipment an equip message targets: the player's own (no heroId), or the
// hero's ("hero:<id>"; any hero of the colony, alive or not). The pack is always the player's.
function gearTarget(player: Player, heroId: unknown): HeroProfile | null {
  if (heroId === undefined || heroId === null || heroId === "") return heroProfileOf(player);
  if (typeof heroId !== "string") return null;
  const prof = heroProfiles.get(heroKey(heroId));
  return prof?.heroClass ? prof : null;
}

function handleEquipItem(player: Player, itemId: unknown, slot: unknown, heroId?: unknown) {
  if (typeof itemId !== "string" || typeof slot !== "string" || !GEAR_SLOTS.includes(slot as GearSlot)) return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseGear(player, "No such hero");
  const idx = pack.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return refuseGear(player, "That item is not in your pack");
  const item = pack.inventory[idx];
  const gs = slot as GearSlot;
  if (gearSlotKind(gs) !== item.slot) return refuseGear(player, `${item.name} doesn't go in the ${gs} slot`);
  pack.inventory.splice(idx, 1);
  const old = prof.equipment[gs];
  if (old) pack.inventory.push(old);
  prof.equipment[gs] = item;
  recomputeHeroProfile(prof);
  if (prof !== pack) recomputeHeroProfile(pack);
  heroEvent({ type: "equip", key: prof.key, detail: `${gs} ${item.name}` });
}

function handleUnequipItem(player: Player, slot: unknown, heroId?: unknown) {
  if (typeof slot !== "string" || !GEAR_SLOTS.includes(slot as GearSlot)) return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseGear(player, "No such hero");
  const item = prof.equipment[slot as GearSlot];
  if (!item) return;
  if (pack.inventory.length >= HERO_INVENTORY_CAP) return refuseGear(player, "Your pack is full (40 items)");
  prof.equipment[slot as GearSlot] = null;
  pack.inventory.push(item);
  recomputeHeroProfile(prof);
  if (prof !== pack) recomputeHeroProfile(pack);
  heroEvent({ type: "unequip", key: prof.key, detail: `${slot} ${item.name}` });
}

// One plain tiered piece out of the colony stock into the player's pack (it no longer arms a soldier).
function handleTakeFromArmoury(player: Player, slot: unknown, tier: unknown, heroId?: unknown) {
  if (slot !== "armour" && slot !== "weapon") return;
  if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > EQUIP_TIERS) return;
  const prof = heroProfileOf(player);
  if (equipment[slot][tier - 1] <= 0) return refuseGear(player, `No tier-${tier} ${EQUIP_SLOT_LABEL[slot]} in the colony's stock`);
  if (prof.inventory.length >= HERO_INVENTORY_CAP) return refuseGear(player, "Your pack is full (40 items)");
  equipment[slot][tier - 1]--;
  const def = PLAIN_GEAR[slot];
  const item: GearItem = { id: randomUUID(), slot: def.slot, name: def.names[tier - 1], tier: tier as 1 | 2 | 3, stats: def.stats(tier), kind: def.kind, icon: `icon-${slot}T${tier}` };
  prof.inventory.push(item);
  recomputeHeroProfile(prof);
  heroEvent({ type: "take", key: prof.key, detail: `${slot} ${tier}` });
  // Hero phase 3: taken for a hero's tab - straight onto that hero when its socket is free.
  const hero = heroId ? gearTarget(player, heroId) : null;
  if (hero && hero !== prof && !hero.equipment[def.slot as GearSlot]) handleEquipItem(player, item.id, def.slot, heroId);
}

// Save / load: profiles as plain data; anything malformed is dropped (old saves: none).
function serializeHeroProfiles() {
  return Array.from(heroProfiles.values(), (p) => ({
    key: p.key, equipment: p.equipment, inventory: p.inventory, xp: p.xp,
    ...(p.heroClass ? { heroClass: p.heroClass, heroName: p.heroName } : {}),
    // Hero phase 4 (old saves: none learned; restore then grants the level-ups already earned).
    spells: p.spells, spellSlots: p.spellSlots, spellAuto: p.spellAuto, spellGrants: p.spellGrants,
  }));
}

function restoreHeroProfiles(saved: unknown) {
  heroProfiles.clear();
  if (!Array.isArray(saved)) return;
  const validItem = (i: unknown): i is GearItem =>
    !!i && typeof i === "object" && typeof (i as GearItem).id === "string" && typeof (i as GearItem).name === "string" &&
    typeof (i as GearItem).slot === "string" && typeof (i as GearItem).stats === "object";
  for (const raw of saved as Record<string, unknown>[]) {
    if (!raw || typeof raw.key !== "string") continue;
    const eq = emptyEquipment();
    const savedEq = (raw.equipment ?? {}) as Record<string, unknown>;
    for (const slot of GEAR_SLOTS) if (validItem(savedEq[slot])) eq[slot] = savedEq[slot] as GearItem;
    const inv = Array.isArray(raw.inventory) ? raw.inventory.filter(validItem).slice(0, HERO_INVENTORY_CAP) : [];
    const xp = typeof raw.xp === "number" && raw.xp >= 0 ? raw.xp : 0;
    const hero = HERO_CLASSES.includes(raw.heroClass as HeroClass)
      ? { heroClass: raw.heroClass as HeroClass, heroName: typeof raw.heroName === "string" ? raw.heroName : "Hero" }
      : undefined;
    const prof = newHeroProfile(raw.key, eq, hero ? [] : inv, xp, hero);
    restoreSpellBook(prof, raw);
    heroProfiles.set(raw.key, prof);
  }
}

// Appended to this player's snapshot payload only when their profile changed since the last one sent.
function withPlayerProfile(payload: string, player: Player): string {
  const prof = heroProfileOf(player);
  if (player.profileSentVersion === prof.version) return payload;
  player.profileSentVersion = prof.version;
  return payload.slice(0, -1) + ',"profile":' + JSON.stringify(heroProfileSnapshot(prof)) + "}";
}

export function heroKey(id: string): string {
  return HERO_KEY_PREFIX + id;
}

export function heroBaseStats(cls: HeroClass) {
  return { ...HERO_CLASS_STATS[cls] };
}

export function heroTestEvent(e: { type: string; id: string; amount?: number; detail?: string }) {
  heroEvent({ type: e.type, key: heroKey(e.id), amount: e.amount, detail: e.detail });
}

// The hero's profile, created (or given its class, e.g. after a lost profile) on demand.
function ensureHeroProfile(id: string, heroClass: HeroClass, heroName: string): HeroProfile {
  let prof = heroProfiles.get(heroKey(id));
  if (!prof) {
    prof = newHeroProfile(heroKey(id), emptyEquipment(), [], 0, { heroClass, heroName });
    heroProfiles.set(prof.key, prof);
  } else if (!prof.heroClass) {
    prof.heroClass = heroClass;
    prof.heroName = heroName;
    recomputeHeroProfile(prof);
  }
  return prof;
}

// Class base + the SAME HeroStats as the player (computeHeroStats: level and equipment).
export function heroCombatStats(c: Colonist) {
  const cls = c.heroClass ?? "champion";
  const base = HERO_CLASS_STATS[cls];
  const s = ensureHeroProfile(c.id, cls, c.heroName ?? "Hero").stats;
  return {
    maxHp: s.maxHp,
    damage: base.damage * s.damageMult,
    range: base.range,
    cooldown: Math.max(1, Math.round(base.cooldown / s.attackSpeedMult)),
    speed: base.speed * s.moveSpeedMult,
    melee: base.melee,
  };
}

export function heroRespawnFee(id: string): number {
  return HERO_RESPAWN_FEE_BASE + HERO_RESPAWN_FEE_PER_LEVEL * (heroProfiles.get(heroKey(id))?.level ?? 1);
}

// Every hero of the colony with where it belongs: alive (posted at its Keep), being recruited, or fallen
// (queued for a window).
function heroRoster(): { id: string; name: string; heroClass: HeroClass; tx: number; ty: number; status: HeroSheetSnapshot["status"] }[] {
  const out: ReturnType<typeof heroRoster> = [];
  for (const c of colonists.values()) {
    if (c.kind === "hero") out.push({ id: c.id, name: c.heroName ?? "Hero", heroClass: c.heroClass ?? "champion", tx: c.postX, ty: c.postY, status: "alive" });
  }
  for (const r of heroRecruits) out.push({ id: r.id, name: r.name, heroClass: r.heroClass, tx: r.tx, ty: r.ty, status: "recruiting" });
  for (const q of respawnQueue) if (q.hero) out.push({ ...q.hero, tx: q.tx, ty: q.ty, status: "fallen" });
  return out;
}

function pickHeroName(): string {
  const used = new Set(heroRoster().map((h) => h.name));
  const free = HERO_NAMES.filter((n) => !used.has(n));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) {
    const n = `${HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)]} ${["", "", "II", "III", "IV", "V"][i] ?? i}`;
    if (!used.has(n)) return n;
  }
}

// Why the Keep at (tx, ty) can't recruit a `cls` now ("" = it can).
function heroRecruitBlocker(tx: number, ty: number, cls: HeroClass): string {
  const level = getBuildingLevel(tx, ty);
  const roster = heroRoster();
  if (roster.filter((h) => h.tx === tx && h.ty === ty).length >= level) {
    return `Keep Lv ${level} holds ${level} hero${level === 1 ? "" : "es"}${level < 3 ? " (upgrade the Keep for more)" : ""}`;
  }
  if (roster.length >= HERO_MAX_TOTAL) return `At most ${HERO_MAX_TOTAL} heroes`;
  if (!canAfford(HERO_RECRUIT_COST[cls])) return "Not enough resources";
  // Heroes still being recruited for this settlement already hold their 2 population.
  const key = settlementKeyNear(tx, ty);
  const pending = heroRecruits.filter((r) => settlementKeyNear(r.tx, r.ty) === key).length;
  return settlementBlocker(tx, ty, HERO_POPULATION_COST * (1 + pending));
}

export function keepHeroInfo(tx: number, ty: number): NonNullable<BuildingInfo["heroes"]> {
  const here = heroRoster().filter((h) => h.tx === tx && h.ty === ty);
  return {
    count: here.length,
    cap: getBuildingLevel(tx, ty),
    options: HERO_CLASSES.map((heroClass) => {
      const reason = heroRecruitBlocker(tx, ty, heroClass);
      return { heroClass, label: HERO_CLASS_LABEL[heroClass], cost: formatCost(HERO_RECRUIT_COST[heroClass]), enabled: reason === "", reason };
    }),
    roster: here.map((h) => ({
      name: h.name,
      heroClass: h.heroClass,
      level: heroProfiles.get(heroKey(h.id))?.level ?? 1,
      status: h.status === "fallen" ? `fallen, back at dawn / dusk for ${heroRespawnFee(h.id)} gold` : h.status,
    })),
  };
}

function handleRecruitHero(player: Player, tx: number, ty: number, cls: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Keep) return;
  if (!HERO_CLASSES.includes(cls as HeroClass)) return;
  const heroClass = cls as HeroClass;
  const reason = heroRecruitBlocker(tx, ty, heroClass);
  if (reason) {
    heroEvent({ type: "recruitRefused", key: player.profileKey, detail: reason });
    sendTo(player, { type: "event", category: "build", text: `Can't recruit: ${reason}` });
    return;
  }
  spend(HERO_RECRUIT_COST[heroClass]);
  const id = randomUUID();
  const name = pickHeroName();
  ensureHeroProfile(id, heroClass, name);
  heroRecruits.push({ id, name, heroClass, tx, ty, ticksLeft: state.instantBuild ? 1 : HERO_RECRUIT_TICKS });
  state.heroRosterVersion++;
  heroTestEvent({ type: "recruit", id, detail: heroClass });
  broadcastEvent("build", `${name} the ${HERO_CLASS_LABEL[heroClass]} answers the Keep's call (arrives in ${state.instantBuild ? 0 : HERO_RECRUIT_TICKS / TICK_RATE} s)`);
}

// Once per tick: a recruit's short muster runs down, then the hero walks out of the Keep.
function updateHeroRecruits() {
  for (let i = heroRecruits.length - 1; i >= 0; i--) {
    const r = heroRecruits[i];
    if (--r.ticksLeft > 0) continue;
    heroRecruits.splice(i, 1);
    spawnHeroColonist(r.id, r.name, r.heroClass, r.tx, r.ty);
    broadcastEvent("milestone", `${r.name} the ${HERO_CLASS_LABEL[r.heroClass]} joins the colony`);
  }
}

// The hero (new or back from death) beside its Keep, holding the spot it stepped out on.
export function spawnHeroColonist(id: string, name: string, heroClass: HeroClass, tx: number, ty: number): Colonist {
  const c = spawnColonistForPost(tx, ty, "hero", 1);
  colonists.delete(c.id);
  c.id = id;
  c.heroClass = heroClass;
  c.heroName = name;
  colonists.set(id, c);
  const prof = ensureHeroProfile(id, heroClass, name);
  c.maxHp = prof.stats.maxHp;
  c.hp = c.maxHp;
  const t = tileOfPixel(c.x, c.y);
  Object.assign(c, { rallyTileX: t.x, rallyTileY: t.y, rallyX: c.x, rallyY: c.y });
  state.heroRosterVersion++;
  heroTestEvent({ type: "spawn", id, detail: heroClass });
  return c;
}

function heroSheetsSnapshot(): HeroSheetSnapshot[] {
  return heroRoster().map((h) => {
    const prof = ensureHeroProfile(h.id, h.heroClass, h.name);
    return { id: h.id, name: h.name, heroClass: h.heroClass, status: h.status, respawnFee: heroRespawnFee(h.id), profile: heroProfileSnapshot(prof) };
  });
}

// Appended to a player's snapshot payload only when the hero roster changed since the last one sent.
function withPlayerHeroes(payload: string, player: Player): string {
  if (player.heroesSentVersion === state.heroRosterVersion) return payload;
  player.heroesSentVersion = state.heroRosterVersion;
  return payload.slice(0, -1) + ',"heroes":' + JSON.stringify(heroSheetsSnapshot()) + "}";
}
function spellEvent(e: Omit<(typeof spellEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  spellEvents.push({ ...e, tick: state.spellTick });
  if (spellEvents.length > 400) spellEvents.splice(0, spellEvents.length - 400);
}

function spellBasePctFor(cls: HeroClass | undefined): number {
  return cls === "mage" ? SPELL_MAGE_BASE_PCT : 0;
}

function isSpellId(v: unknown): v is SpellId {
  return typeof v === "string" && (SPELL_IDS as string[]).includes(v);
}

function spellBookSnapshot(prof: HeroProfile): SpellBookSnapshot {
  const cooldowns: Partial<Record<SpellId, number>> = {};
  const cd = spellCooldowns.get(prof.key);
  if (cd) for (const id of SPELL_IDS) if ((cd[id] ?? 0) > state.spellTick) cooldowns[id] = cd[id]! - state.spellTick;
  return { learned: [...prof.spells], slots: [...prof.spellSlots], auto: !!prof.heroClass && prof.spellAuto, cooldowns };
}

// Marks a profile for resending (spell book / cooldown changes) without re-deriving its stats.
function touchSpellProfile(prof: HeroProfile) {
  prof.version = ++state.heroProfileVersionCounter;
  if (prof.heroClass) state.heroRosterVersion++;
}

function profileLabel(prof: HeroProfile): string {
  return prof.heroClass ? prof.heroName ?? "A hero" : "You";
}

// Teaches `id` (no-op if known) and puts it in the first free slot. Toasts to the player(s) of that
// profile, or everyone for a hero.
function learnSpell(prof: HeroProfile, id: SpellId, source: string, announce = true): boolean {
  if (prof.spells.includes(id)) return false;
  prof.spells.push(id);
  const free = prof.spellSlots.indexOf(null);
  if (free >= 0) prof.spellSlots[free] = id;
  touchSpellProfile(prof);
  spellEvent({ type: "learn", key: prof.key, spell: id, detail: source });
  if (announce) {
    const text = `${profileLabel(prof)} learn${prof.heroClass ? "s" : ""} ${SPELLS[id].name}${free >= 0 ? ` (spell slot ${free + 1})` : ""}`;
    if (prof.heroClass) broadcastEvent("milestone", text);
    else sendHeroEvent(prof, "milestone", text);
  }
  return true;
}

// Level-up grants: one spell per SPELL_GRANT_LEVELS level reached, the first unlearned one of the class
// order (then any unlearned spell). Also run on load, so an old save's level-N profile gets its spells.
function grantLevelSpells(prof: HeroProfile, announce: boolean) {
  const earned = SPELL_GRANT_LEVELS.filter((l) => prof.level >= l).length;
  while (prof.spellGrants < earned) {
    prof.spellGrants++;
    const order = SPELL_LEARN_ORDER[prof.heroClass ?? "player"];
    const next = order.find((s) => !prof.spells.includes(s)) ?? SPELL_IDS.find((s) => !prof.spells.includes(s));
    if (next) learnSpell(prof, next, `level ${prof.level}`, announce);
  }
}

function restoreSpellBook(prof: HeroProfile, raw: Record<string, unknown>) {
  const learned = Array.isArray(raw.spells) ? (raw.spells as unknown[]).filter(isSpellId) : [];
  prof.spells = Array.from(new Set(learned));
  const slots = Array.isArray(raw.spellSlots) ? (raw.spellSlots as unknown[]) : [];
  prof.spellSlots = Array.from({ length: SPELL_SLOT_COUNT }, (_, i) => (isSpellId(slots[i]) && prof.spells.includes(slots[i] as SpellId) ? (slots[i] as SpellId) : null));
  prof.spellAuto = raw.spellAuto !== false;
  prof.spellGrants = typeof raw.spellGrants === "number" && raw.spellGrants >= 0 ? Math.floor(raw.spellGrants) : 0;
  grantLevelSpells(prof, false);
}

// A Spell Tome into the profile's pack: `spellId`, else a random spell it hasn't learned (any once all are).
function grantTome(prof: HeroProfile, source: string, spellId?: SpellId): GearItem | null {
  if (prof.inventory.length >= HERO_INVENTORY_CAP) {
    sendHeroEvent(prof, "build", "A spell tome was found, but your pack is full (40 items)");
    return null;
  }
  const unknown = SPELL_IDS.filter((s) => !prof.spells.includes(s));
  const pool = unknown.length > 0 ? unknown : SPELL_IDS;
  const id = spellId ?? pool[Math.floor(Math.random() * pool.length)];
  const item: GearItem = { id: randomUUID(), slot: "tome", name: `Tome of ${SPELLS[id].name}`, tier: "relic", stats: {}, kind: "tome", spellId: id, icon: SPELLS[id].icon };
  prof.inventory.push(item);
  touchSpellProfile(prof);
  spellEvent({ type: "tome", key: prof.key, spell: id, detail: source });
  sendHeroEvent(prof, "milestone", `Spell tome found: ${item.name} (Learn it from the Hero sheet)`);
  return item;
}

function refuseSpell(player: Player, text: string) {
  spellEvent({ type: "refuse", key: player.profileKey, detail: text });
  sendTo(player, { type: "event", category: "build", text });
}

function handleUseTome(player: Player, itemId: unknown, heroId?: unknown) {
  if (typeof itemId !== "string") return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseSpell(player, "No such hero");
  const idx = pack.inventory.findIndex((i) => i.id === itemId && i.slot === "tome");
  if (idx < 0) return refuseSpell(player, "That tome is not in your pack");
  const tome = pack.inventory[idx];
  if (!isSpellId(tome.spellId)) return refuseSpell(player, "That tome is unreadable");
  if (prof.spells.includes(tome.spellId)) return refuseSpell(player, `${profileLabel(prof) === "You" ? "You already know" : `${profileLabel(prof)} already knows`} ${SPELLS[tome.spellId].name}`);
  pack.inventory.splice(idx, 1);
  touchSpellProfile(pack);
  learnSpell(prof, tome.spellId, "tome");
}

export function churchSpellShop(player: Player | undefined): NonNullable<BuildingInfo["spellShop"]> {
  const prof = player ? heroProfileOf(player) : null;
  return (Object.keys(CHURCH_SPELL_PRICES) as SpellId[]).map((spellId) => {
    const gold = CHURCH_SPELL_PRICES[spellId]!;
    const reason = prof?.spells.includes(spellId) ? "Already learned" : stock.gold < gold ? "Not enough gold" : "";
    return { spellId, label: SPELLS[spellId].name, gold, enabled: reason === "", reason };
  });
}

function handleLearnSpell(player: Player, spellId: unknown, tx: unknown, ty: unknown) {
  if (!isSpellId(spellId) || typeof tx !== "number" || typeof ty !== "number" || !inBounds(tx, ty)) return;
  if (state.tiles[tileIndex(tx, ty)] !== TileType.ChurchPost) return refuseSpell(player, "Spells are taught at a Church");
  const price = CHURCH_SPELL_PRICES[spellId];
  if (price === undefined) return refuseSpell(player, `The Church doesn't teach ${SPELLS[spellId].name}`);
  const prof = heroProfileOf(player);
  if (prof.spells.includes(spellId)) return refuseSpell(player, `You already know ${SPELLS[spellId].name}`);
  if (stock.gold < price) return refuseSpell(player, `Not enough gold (${SPELLS[spellId].name} costs ${price})`);
  stock.gold -= price;
  learnSpell(prof, spellId, "church");
}

function handleSetSpellSlot(player: Player, slot: unknown, spellId: unknown, heroId?: unknown) {
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPELL_SLOT_COUNT) return;
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseSpell(player, "No such hero");
  if (spellId === null) {
    prof.spellSlots[slot] = null;
  } else {
    if (!isSpellId(spellId)) return refuseSpell(player, "Unknown spell");
    if (!prof.spells.includes(spellId)) return refuseSpell(player, `${SPELLS[spellId].name} isn't learned yet`);
    // A spell sits in one slot at most: setting it elsewhere moves it.
    const was = prof.spellSlots.indexOf(spellId);
    if (was >= 0) prof.spellSlots[was] = null;
    prof.spellSlots[slot] = spellId;
  }
  touchSpellProfile(prof);
  spellEvent({ type: "slot", key: prof.key, spell: spellId ?? undefined, amount: slot });
}

function handleSetSpellAuto(player: Player, heroId: unknown, auto: unknown) {
  if (typeof heroId !== "string" || typeof auto !== "boolean") return;
  const prof = gearTarget(player, heroId);
  if (!prof || !prof.heroClass) return;
  prof.spellAuto = auto;
  touchSpellProfile(prof);
}

// ---- Status effects (single damage / speed code paths read them) ----
function statusAt(key: string): SpellStatus {
  let s = spellStatuses.get(key);
  if (!s) {
    s = {};
    spellStatuses.set(key, s);
  }
  return s;
}

// damageMob: +curseBonus damage taken while cursed.
export function spellDamageTakenMult(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.curseUntil !== undefined && s.curseUntil > state.spellTick ? 1 + (s.curseBonus ?? 0) : 1;
}

// damagePlayer / damageColonist: a ward shield soaks the blow first. Returns what gets through.
export function absorbWithWard(key: string, amount: number): number {
  lastHurtTick.set(key, state.spellTick);
  const s = spellStatuses.get(key);
  if (!s?.shield || (s.shieldUntil ?? 0) <= state.spellTick) return amount;
  const soaked = Math.min(s.shield, amount);
  s.shield -= soaked;
  spellEvent({ type: "absorb", key, amount: soaked, detail: String(amount) });
  return amount - soaked;
}

export function spellBuffDamageMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > state.spellTick ? 1 + (s.buffDamage ?? 0) : 1;
}

export function spellBuffSpeedMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > state.spellTick ? 1 + (s.buffSpeed ?? 0) : 1;
}

// A mob's speed is read in many places, so a slow scales `mob.speed` itself and restores it on expiry
// (snapshotWorld saves the unslowed speed).
function slowMob(mob: Mob, fraction: number, ticks: number) {
  const s = statusAt("m:" + mob.id);
  if (s.slowUntil === undefined || s.slowUntil <= state.spellTick || s.baseSpeed === undefined) {
    s.baseSpeed = mob.speed;
    mob.speed = mob.speed * (1 - fraction);
  }
  s.slowUntil = state.spellTick + ticks;
}

function unslowedSpeed(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.baseSpeed !== undefined && (s.slowUntil ?? 0) > state.spellTick ? s.baseSpeed : mob.speed;
}

// Once per tick: burn ticks, expiries, summon despawns.
function updateSpellStatuses() {
  state.spellTick++;
  for (const [key, s] of Array.from(spellStatuses)) {
    const mob = key.startsWith("m:") ? mobs.get(key.slice(2)) : undefined;
    const alive = mob || (key.startsWith("c:") ? colonists.has(key.slice(2)) : players.has(key.slice(2)));
    if (!alive) {
      spellStatuses.delete(key);
      continue;
    }
    if (mob && s.burnUntil !== undefined) {
      if (s.burnNext !== undefined && state.spellTick >= s.burnNext && s.burnNext <= s.burnUntil) {
        s.burnNext += TICK_RATE;
        spellEvent({ type: "burn", key, amount: s.burnPerSec });
        damageMob(mob, s.burnPerSec ?? 0, s.burnBy);
      }
      if (state.spellTick > s.burnUntil) s.burnUntil = s.burnNext = s.burnPerSec = s.burnBy = undefined;
    }
    if (mob && s.slowUntil !== undefined && state.spellTick >= s.slowUntil) {
      if (s.baseSpeed !== undefined && mobs.has(mob.id)) mob.speed = s.baseSpeed;
      s.slowUntil = s.baseSpeed = undefined;
    }
    if (s.curseUntil !== undefined && state.spellTick >= s.curseUntil) s.curseUntil = s.curseBonus = undefined;
    if (s.shieldUntil !== undefined && (state.spellTick >= s.shieldUntil || (s.shield ?? 0) <= 0)) s.shield = s.shieldUntil = undefined;
    if (s.buffUntil !== undefined && state.spellTick >= s.buffUntil) s.buffUntil = s.buffDamage = s.buffSpeed = undefined;
    if (Object.values(s).every((v) => v === undefined)) spellStatuses.delete(key);
  }
  for (const [id, until] of summonedUntil) {
    const c = colonists.get(id);
    if (!c) {
      summonedUntil.delete(id);
      continue;
    }
    if (state.spellTick < until) continue;
    summonedUntil.delete(id);
    releaseResourceReservation(c);
    releaseSlot(c.id);
    colonists.delete(id);
    spellEvent({ type: "expire", key: "c:" + id });
  }
  if (state.spellTick % (5 * TICK_RATE) === 0) {
    for (const [k, t] of lastHurtTick) if (state.spellTick - t > 5 * TICK_RATE) lastHurtTick.delete(k);
  }
}

function clearSpellState() {
  spellStatuses.clear();
  spellCooldowns.clear();
  summonedUntil.clear();
  lastHurtTick.clear();
}

export function isSummoned(c: Colonist): boolean {
  return summonedUntil.has(c.id);
}

function friendlyPos(f: FriendlyUnit) {
  return f.type === "player" ? { x: f.p.x, y: f.p.y } : { x: f.c.x, y: f.c.y };
}
function friendlyKey(f: FriendlyUnit) {
  return f.type === "player" ? "p:" + f.p.id : "c:" + f.c.id;
}
function friendlyHp(f: FriendlyUnit) {
  return f.type === "player" ? { hp: f.p.hp, max: playerMaxHp(f.p) } : { hp: f.c.hp, max: f.c.maxHp };
}

function resolveFriendly(caster: SpellCaster, targetId: string | undefined): FriendlyUnit | null {
  if (!targetId) return caster.self;
  const p = players.get(targetId);
  if (p) return p.dead ? null : { type: "player", p };
  const c = colonists.get(targetId);
  return c && !isAbbeyClergy(c) ? { type: "colonist", c } : null;
}

function spellScaled(caster: SpellCaster, base: number): number {
  return base * caster.prof.stats.spellPowerMult;
}

function spellCooldownLeft(prof: HeroProfile, id: SpellId): number {
  return Math.max(0, (spellCooldowns.get(prof.key)?.[id] ?? 0) - state.spellTick);
}

// Validates and casts. Returns "" on success, else the reason (nothing happened).
function castSpellNow(caster: SpellCaster, id: SpellId, target: SpellTarget): string {
  const def = SPELLS[id];
  if (!caster.prof.spells.includes(id)) return `${def.name} isn't learned`;
  const left = spellCooldownLeft(caster.prof, id);
  if (left > 0) return `${def.name} is on cooldown (${Math.ceil(left / TICK_RATE)} s)`;
  const rangePx = def.range * TILE_SIZE + SPELL_RANGE_SLACK_PX;
  const inRange = (x: number, y: number) => Math.hypot(x - caster.x, y - caster.y) <= rangePx;
  const sp = caster.prof.stats.spellPowerMult;
  const ticks = (s?: number) => Math.round((s ?? 0) * TICK_RATE);
  let fx: { x: number; y: number };
  if (def.targeting === "enemy") {
    const mob = target.targetId ? mobs.get(target.targetId) : undefined;
    if (!mob) return "No enemy targeted";
    if (!inRange(mob.x, mob.y)) return `Out of range (${def.range} tiles)`;
    fx = { x: mob.x, y: mob.y };
    if (id === "fireBolt") {
      damageMob(mob, def.power * sp, caster.attackerKey);
      if (mobs.has(mob.id)) {
        const s = statusAt("m:" + mob.id);
        s.burnUntil = state.spellTick + ticks(def.duration);
        s.burnNext = state.spellTick + TICK_RATE;
        s.burnPerSec = (def.burnPerSec ?? 0) * sp;
        s.burnBy = caster.attackerKey;
      }
    } else if (id === "curse") {
      const s = statusAt("m:" + mob.id);
      s.curseUntil = state.spellTick + ticks(def.duration);
      s.curseBonus = def.damageTakenBonus ?? 0;
    }
  } else if (def.targeting === "ally" || def.targeting === "self") {
    const ally = def.targeting === "self" ? caster.self : resolveFriendly(caster, target.targetId);
    if (!ally) return "No friendly target";
    const pos = friendlyPos(ally);
    if (!inRange(pos.x, pos.y)) return `Out of range (${def.range} tiles)`;
    fx = pos;
    if (id === "heal") {
      const amount = def.power * sp;
      if (ally.type === "player") ally.p.hp = Math.min(playerMaxHp(ally.p), ally.p.hp + amount);
      else ally.c.hp = Math.min(ally.c.maxHp, ally.c.hp + amount);
    } else if (id === "ward") {
      const s = statusAt(friendlyKey(ally));
      s.shield = def.power * sp;
      s.shieldUntil = state.spellTick + ticks(def.duration);
    }
  } else {
    if (typeof target.x !== "number" || typeof target.y !== "number" || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return "No spot targeted";
    if (!inRange(target.x, target.y)) return `Out of range (${def.range} tiles)`;
    fx = { x: target.x, y: target.y };
    const radiusPx = (def.radius ?? 0) * TILE_SIZE;
    if (id === "thunder" || id === "frost") {
      const hit = Array.from(mobs.values()).filter((m) => Math.hypot(m.x - fx.x, m.y - fx.y) <= radiusPx);
      for (const m of hit) {
        damageMob(m, def.power * sp, caster.attackerKey);
        if (id === "frost" && mobs.has(m.id)) slowMob(m, def.slow ?? 0, ticks(def.duration));
      }
      spellEvent({ type: "aoe", key: caster.prof.key, spell: id, amount: hit.length });
    } else if (id === "rallyBanner") {
      const buff = (key: string) => {
        const s = statusAt(key);
        s.buffUntil = state.spellTick + ticks(def.duration);
        s.buffDamage = def.buffDamage ?? 0;
        s.buffSpeed = def.buffSpeed ?? 0;
      };
      let n = 0;
      for (const c of colonists.values()) {
        if (unitRole(c.kind, c.heroClass) === undefined || Math.hypot(c.x - fx.x, c.y - fx.y) > radiusPx) continue;
        buff("c:" + c.id);
        n++;
      }
      for (const p of players.values()) {
        if (p.dead || Math.hypot(p.x - fx.x, p.y - fx.y) > radiusPx) continue;
        buff("p:" + p.id);
        n++;
      }
      spellEvent({ type: "rally", key: caster.prof.key, amount: n });
    } else if (id === "summon") {
      const t = tileOfPixel(fx.x, fx.y);
      const tile = isWalkableTile(t.x, t.y) ? t : tileOfPixel(caster.x, caster.y);
      for (let i = 0; i < (def.summonCount ?? 0); i++) {
        const c = spawnColonistForPost(tile.x, tile.y, "militia", 1);
        const p = { x: fx.x + (i === 0 ? -8 : 8), y: fx.y };
        if (isWalkableTile(tileOfPixel(p.x, p.y).x, tileOfPixel(p.x, p.y).y)) Object.assign(c, { x: p.x, y: p.y });
        Object.assign(c, { rallyTileX: tile.x, rallyTileY: tile.y, rallyX: c.x, rallyY: c.y, stance: "aggressive" as Stance });
        summonedUntil.set(c.id, state.spellTick + ticks(def.duration));
        spellEvent({ type: "summon", key: "c:" + c.id });
      }
    }
  }
  let cd = spellCooldowns.get(caster.prof.key);
  if (!cd) {
    cd = {};
    spellCooldowns.set(caster.prof.key, cd);
  }
  cd[id] = state.spellTick + ticks(def.cooldown);
  touchSpellProfile(caster.prof);
  state.pendingEffects.push({ fromX: caster.x, fromY: caster.y, toX: fx.x, toY: fx.y, spell: id });
  spellEvent({ type: "cast", key: caster.prof.key, spell: id, amount: def.power * sp, detail: target.targetId ?? (target.x !== undefined ? `${Math.round(target.x)},${Math.round(target.y ?? 0)}` : "self") });
  return "";
}

function playerCaster(p: Player): SpellCaster {
  return { prof: heroProfileOf(p), x: p.x, y: p.y, attackerKey: "p:" + p.id, self: { type: "player", p } };
}

function heroCaster(c: Colonist): SpellCaster {
  return { prof: heroProfileFor(heroKey(c.id)), x: c.x, y: c.y, attackerKey: "c:" + c.id, self: { type: "colonist", c } };
}

function handleCastSpell(player: Player, msg: Record<string, unknown>) {
  const slot = msg.slot;
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPELL_SLOT_COUNT) return;
  let caster: SpellCaster;
  if (msg.heroId !== undefined && msg.heroId !== null && msg.heroId !== "") {
    const c = typeof msg.heroId === "string" ? colonists.get(msg.heroId) : undefined;
    if (!c || c.kind !== "hero") return refuseSpell(player, "That hero can't cast now");
    caster = heroCaster(c);
  } else {
    if (player.dead) return refuseSpell(player, "You can't cast while fallen");
    caster = playerCaster(player);
  }
  const id = caster.prof.spellSlots[slot];
  if (!id) return refuseSpell(player, `Spell slot ${slot + 1} is empty`);
  const reason = castSpellNow(caster, id, {
    targetId: typeof msg.targetId === "string" ? msg.targetId : undefined,
    x: typeof msg.x === "number" ? msg.x : undefined,
    y: typeof msg.y === "number" ? msg.y : undefined,
  });
  if (reason) refuseSpell(player, reason);
}

// ---- Hero auto-cast: each slotted, ready spell whose condition holds (first match casts) ----
function autoEnemyInRange(c: Colonist, rangePx: number, want?: (m: Mob) => boolean): Mob | null {
  const ok = (m: Mob) => !m.passive && !isDormantGuardian(m) && Math.hypot(m.x - c.x, m.y - c.y) <= rangePx && (!want || want(m));
  const cur = c.targetMobId ? mobs.get(c.targetMobId) : undefined;
  if (cur && ok(cur)) return cur;
  let best: Mob | null = null;
  let bestD = Infinity;
  for (const m of mobs.values()) {
    if (!ok(m)) continue;
    const d = Math.hypot(m.x - c.x, m.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function friendliesNear(x: number, y: number, rangePx: number): FriendlyUnit[] {
  const out: FriendlyUnit[] = [];
  for (const o of colonists.values()) {
    if (isAbbeyClergy(o) || Math.hypot(o.x - x, o.y - y) > rangePx) continue;
    out.push({ type: "colonist", c: o });
  }
  for (const p of players.values()) if (!p.dead && Math.hypot(p.x - x, p.y - y) <= rangePx) out.push({ type: "player", p });
  return out;
}

function autoSpellTarget(c: Colonist, id: SpellId): SpellTarget | null {
  const def = SPELLS[id];
  const rangePx = def.range * TILE_SIZE;
  const idOf = (f: FriendlyUnit) => (f.type === "player" ? f.p.id : f.c.id);
  if (id === "fireBolt") {
    const m = autoEnemyInRange(c, rangePx);
    return m ? { targetId: m.id } : null;
  }
  if (id === "thunder" || id === "frost") {
    const m = autoEnemyInRange(c, rangePx);
    return m ? { x: m.x, y: m.y } : null;
  }
  if (id === "curse") {
    const m = autoEnemyInRange(c, rangePx, (mm) => !!mm.boss || mobRole(mm) === "shock");
    return m && spellDamageTakenMult(m) === 1 ? { targetId: m.id } : null;
  }
  if (id === "heal") {
    let best: FriendlyUnit | null = null;
    let bestFrac = SPELL_AUTO_HEAL_BELOW;
    for (const f of friendliesNear(c.x, c.y, rangePx)) {
      const { hp, max } = friendlyHp(f);
      if (max > 0 && hp / max < bestFrac) {
        bestFrac = hp / max;
        best = f;
      }
    }
    return best ? { targetId: idOf(best) } : null;
  }
  if (id === "ward") {
    let best: FriendlyUnit | null = null;
    let bestFrac = Infinity;
    for (const f of friendliesNear(c.x, c.y, rangePx)) {
      const key = friendlyKey(f);
      const hurt = lastHurtTick.get(key);
      if (hurt === undefined || state.spellTick - hurt > SPELL_AUTO_WARD_HURT_TICKS) continue;
      const s = spellStatuses.get(key);
      if (s?.shield && (s.shieldUntil ?? 0) > state.spellTick) continue;
      const { hp, max } = friendlyHp(f);
      if (hp / max < bestFrac) {
        bestFrac = hp / max;
        best = f;
      }
    }
    return best ? { targetId: idOf(best) } : null;
  }
  if (id === "rallyBanner") {
    const radiusPx = (def.radius ?? 0) * TILE_SIZE;
    let engaged = 0;
    for (const o of colonists.values()) {
      if (unitRole(o.kind, o.heroClass) === undefined || Math.hypot(o.x - c.x, o.y - c.y) > radiusPx) continue;
      if (o.state === "attacking" || o.state === "engaging") engaged++;
    }
    return engaged >= SPELL_AUTO_RALLY_ENGAGED ? { x: c.x, y: c.y } : null;
  }
  if (id === "summon") {
    const scan = SPELL_AUTO_SUMMON_SCAN_TILES * TILE_SIZE;
    let foes = 0;
    for (const m of mobs.values()) if (!m.passive && !isDormantGuardian(m) && Math.hypot(m.x - c.x, m.y - c.y) <= scan) foes++;
    let friends = 0;
    for (const o of colonists.values()) if (unitRole(o.kind, o.heroClass) !== undefined && Math.hypot(o.x - c.x, o.y - c.y) <= scan) friends++;
    return foes >= 2 && foes > friends ? { x: c.x, y: c.y } : null;
  }
  return null;
}

export function heroAutoCast(c: Colonist) {
  // Strategy mode phase 4: hold fire also holds a hero's auto-spells.
  if (c.holdFire) return;
  if ((state.spellTick + c.id.charCodeAt(0)) % SPELL_AUTO_EVERY_TICKS !== 0) return;
  const prof = heroProfiles.get(heroKey(c.id));
  if (!prof || !prof.spellAuto) return;
  for (const id of prof.spellSlots) {
    if (!id || spellCooldownLeft(prof, id) > 0) continue;
    const t = autoSpellTarget(c, id);
    if (t && castSpellNow(heroCaster(c), id, t) === "") return;
  }
}
// ---- Blacksmith forging: one item at a time per Blacksmith, FORGE_QUEUE_CAP queued (the first is in
// progress). Cost is paid when queued (no refund). Not saved: a load starts every forge empty.

function forgeCost(slot: EquipSlot, tier: number): Cost {
  const i = Math.min(Math.max(tier, 1), EQUIP_TIERS) - 1;
  if (slot === "weapon") return { iron: FORGE_WEAPON_IRON[i], wood: FORGE_WEAPON_WOOD };
  const extra = tier - 1;
  if (extra <= 0) return { iron: FORGE_ARMOUR_IRON[i] };
  return stock.tools >= extra ? { iron: FORGE_ARMOUR_IRON[i], tools: extra } : { iron: FORGE_ARMOUR_IRON[i], wood: extra };
}

function blacksmithStaffed(tx: number, ty: number): boolean {
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && c.kind === "artisan") return true;
  return false;
}

// Why the Blacksmith at (tx, ty) can't queue `slot` now ("" = it can).
function forgeQueueBlocker(tx: number, ty: number, slot: EquipSlot): string {
  if (!blacksmithStaffed(tx, ty)) return "No smith at work";
  if ((forgeQueues.get(resourceKey(tx, ty))?.queue.length ?? 0) >= FORGE_QUEUE_CAP) return `Queue full (${FORGE_QUEUE_CAP})`;
  if (!canAfford(forgeCost(slot, getBuildingLevel(tx, ty)))) return "Not enough resources";
  return "";
}

export function blacksmithForgeInfo(tx: number, ty: number): NonNullable<BuildingInfo["forge"]> {
  const state = forgeQueues.get(resourceKey(tx, ty));
  const tier = getBuildingLevel(tx, ty);
  const head = state?.queue[0];
  return {
    tier,
    queue: state ? state.queue.map((q) => ({ ...q })) : [],
    progress: head ? 1 - state!.ticksLeft / FORGE_TICKS[head.slot] : null,
    cap: FORGE_QUEUE_CAP,
    options: (["armour", "weapon"] as EquipSlot[]).map((slot) => {
      const reason = forgeQueueBlocker(tx, ty, slot);
      return {
        slot,
        label: `Forge ${slot === "armour" ? "Armour" : "Weapon"} T${tier}`,
        cost: `${formatCost(forgeCost(slot, tier))}, ${FORGE_TICKS[slot] / TICK_RATE}s`,
        enabled: reason === "",
        reason,
      };
    }),
  };
}

function handleQueueForge(tx: number, ty: number, slot: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Blacksmith) return;
  if (slot !== "armour" && slot !== "weapon") return;
  if (forgeQueueBlocker(tx, ty, slot) !== "") return;
  const tier = getBuildingLevel(tx, ty);
  spend(forgeCost(slot, tier));
  const key = resourceKey(tx, ty);
  let localState = forgeQueues.get(key);
  if (!localState) {
    localState = { queue: [], ticksLeft: 0 };
    forgeQueues.set(key, localState);
  }
  localState.queue.push({ slot, tier });
  if (localState.queue.length === 1) localState.ticksLeft = state.instantBuild ? 1 : FORGE_TICKS[slot];
}

// Once per tick: each Blacksmith's first queued item counts down while a smith is posted there.
function updateForges() {
  for (const [key, localState] of forgeQueues) {
    const tile = keyToTile(key);
    if (!tile || state.tiles[tileIndex(tile.x, tile.y)] !== TileType.Blacksmith) {
      forgeQueues.delete(key);
      continue;
    }
    const head = localState.queue[0];
    if (!head || !blacksmithStaffed(tile.x, tile.y)) continue;
    if (--localState.ticksLeft > 0) continue;
    equipment[head.slot][head.tier - 1]++;
    equipEvent({ type: "forged", slot: head.slot, tier: head.tier, detail: key });
    broadcastEvent("build", `The Blacksmith forged a tier-${head.tier} ${EQUIP_SLOT_LABEL[head.slot]}`);
    localState.queue.shift();
    const next = localState.queue[0];
    if (next) localState.ticksLeft = state.instantBuild ? 1 : FORGE_TICKS[next.slot];
    else forgeQueues.delete(key);
  }
}

// Snapshot `forgeBusy`: tile indices of the Blacksmiths whose queue head is counting down (the client
// plays the forging animation there).
function forgeBusyForSnapshot(): number[] {
  const out: number[] = [];
  for (const [key, state] of forgeQueues) {
    const tile = keyToTile(key);
    if (tile && state.queue.length > 0 && blacksmithStaffed(tile.x, tile.y)) out.push(tileIndex(tile.x, tile.y));
  }
  return out;
}

function clearFights() {
  state.fightHits = [];
  state.activeFights = [];
}

function fightThreatOf(mob: Mob): { kind: FightKind; label: string; rank: number } {
  if (mob.boss === "warlord") return { kind: "boss", label: bossTitle(mob.kind, "warlord"), rank: 7 };
  if (mob.siteKind === "castleRuin") return { kind: "boss", label: "Castle Ruin", rank: 6 };
  if (mob.boss === "elite") return { kind: "boss", label: bossTitle(mob.kind, "elite"), rank: 5 };
  if (mob.siteKind === "miniBoss") return { kind: "boss", label: "Mini-boss pack", rank: 5 };
  if (mob.siteKind === "ruin") return { kind: "guardians", label: "Ruin guardians", rank: 4 };
  if (mob.siteKind === "encampment") return { kind: "guardians", label: "Bandit camp", rank: 4 };
  if (mob.isDeserter) return { kind: "deserters", label: "Deserters", rank: 3 };
  if (mob.kind === "halfLatch") return { kind: "monsters", label: "Half-Latch", rank: 1 };
  return { kind: "raid", label: FIGHT_RAID_LABELS[mob.kind] ?? "Greenskin raid", rank: 2 };
}

export function recordFightHit(mob: Mob, x: number, y: number, other: string, amount: number) {
  const id = other.slice(2);
  const colonist = other.startsWith("c:") ? colonists.get(id) : undefined;
  state.fightHits.push({
    tick: state.cycleTick,
    x,
    y,
    mobId: mob.id,
    other,
    amount,
    units: !!colonist && !isAbbeyClergy(colonist),
    buildings: other.startsWith("b:"),
    playerId: other.startsWith("p:") ? id : null,
    ...fightThreatOf(mob),
  });
  if (state.fightHits.length > FIGHT_MAX_HITS) state.fightHits.splice(0, state.fightHits.length - FIGHT_MAX_HITS);
}

// A mob's own blow on its current target, logged halfway between the two.
export function recordMobStrike(mob: Mob, hitX: number, hitY: number) {
  const prefix = mob.targetType === "colonist" ? "c:" : mob.targetType === "player" ? "p:" : "b:";
  recordFightHit(mob, (mob.x + hitX) / 2, (mob.y + hitY) / 2, prefix + mob.targetId, mob.damage);
}

function scanFights() {
  const cutoff = state.cycleTick - FIGHT_WINDOW_TICKS;
  // A setCycleTick (tests) can move time backwards: future-dated hits go too.
  state.fightHits = state.fightHits.filter((h) => h.tick > cutoff && h.tick <= state.cycleTick);

  interface Cluster {
    sumX: number;
    sumY: number;
    n: number;
    hits: FightHit[];
  }
  const radius = FIGHT_CLUSTER_TILES * TILE_SIZE;
  const clusters: Cluster[] = [];
  for (const h of state.fightHits) {
    let best: Cluster | null = null;
    let bestD = radius;
    for (const c of clusters) {
      const d = Math.hypot(c.sumX / c.n - h.x, c.sumY / c.n - h.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) {
      best = { sumX: 0, sumY: 0, n: 0, hits: [] };
      clusters.push(best);
    }
    best.sumX += h.x;
    best.sumY += h.y;
    best.n++;
    best.hits.push(h);
  }
  // Centroids drift as hits join: merge any two that ended up within the radius.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        if (Math.hypot(a.sumX / a.n - b.sumX / b.n, a.sumY / a.n - b.sumY / b.n) > radius) continue;
        a.sumX += b.sumX;
        a.sumY += b.sumY;
        a.n += b.n;
        a.hits.push(...b.hits);
        clusters.splice(j, 1);
        merged = true;
        break;
      }
    }
  }

  const next: ActiveFight[] = clusters.map((c) => {
    const combatants = new Set<string>();
    const playerIds = new Set<string>();
    let damage = 0;
    let lastTick = 0;
    let units = false;
    let buildings = false;
    let top = c.hits[0];
    for (const h of c.hits) {
      combatants.add("m:" + h.mobId);
      combatants.add(h.other);
      damage += h.amount;
      lastTick = Math.max(lastTick, h.tick);
      units ||= h.units;
      buildings ||= h.buildings;
      if (h.playerId) playerIds.add(h.playerId);
      if (h.rank > top.rank) top = h;
    }
    const dps = Math.round(damage / FIGHT_WINDOW_SECONDS);
    const count = combatants.size;
    const intensity: 1 | 2 | 3 =
      count >= FIGHT_MAJOR_COMBATANTS || dps >= FIGHT_MAJOR_DPS ? 3 : count >= FIGHT_BATTLE_COMBATANTS || dps >= FIGHT_BATTLE_DPS ? 2 : 1;
    return {
      id: 0,
      x: Math.floor(c.sumX / c.n / TILE_SIZE),
      y: Math.floor(c.sumY / c.n / TILE_SIZE),
      combatants: count,
      dps,
      intensity,
      kind: top.kind,
      label: top.label,
      units,
      buildings,
      quiet: Math.round(((state.cycleTick - lastTick) / TICK_RATE) * 10) / 10,
      playerIds,
      lastTick,
    };
  });
  next.sort((a, b) => b.combatants - a.combatants);
  next.length = Math.min(next.length, FIGHT_MAX_TRACKED);

  // Keep ids stable: biggest fights first claim the nearest previous fight within ~1.5 radii.
  const unclaimed = state.activeFights.slice();
  for (const f of next) {
    let bestIdx = -1;
    let bestD = FIGHT_CLUSTER_TILES * 1.5;
    unclaimed.forEach((p, i) => {
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d <= bestD) {
        bestD = d;
        bestIdx = i;
      }
    });
    f.id = bestIdx >= 0 ? unclaimed.splice(bestIdx, 1)[0].id : state.nextFightId++;
  }
  state.activeFights = next;
}

// The colony is shared, so any fight its units or buildings are in concerns every player; other
// fights (a lone rider, the Abbey's clergy) only those within FIGHT_RELEVANCE_TILES. Fights the
// player is in come first, then bigger, then nearer.
function fightsForPlayer(player: Player): FightSnapshot[] {
  if (state.activeFights.length === 0) return [];
  const ptx = player.x / TILE_SIZE;
  const pty = player.y / TILE_SIZE;
  return state.activeFights
    .map((f) => ({ f, you: f.playerIds.has(player.id), dist: Math.hypot(f.x + 0.5 - ptx, f.y + 0.5 - pty) }))
    .filter(({ f, you, dist }) => you || f.units || f.buildings || dist <= FIGHT_RELEVANCE_TILES)
    .sort((a, b) => Number(b.you) - Number(a.you) || b.f.intensity - a.f.intensity || a.dist - b.dist)
    .slice(0, FIGHT_MAX_PER_PLAYER)
    .map(({ f, you }): FightSnapshot => ({
      id: f.id,
      x: f.x,
      y: f.y,
      combatants: f.combatants,
      dps: f.dps,
      intensity: f.intensity,
      kind: f.kind,
      label: f.label,
      units: f.units,
      buildings: f.buildings,
      you,
      quiet: f.quiet,
    }));
}

// Splices the player's `fights` into the shared snapshot JSON (omitted when they have none).
function withPlayerFights(payload: string, player: Player): string {
  const fights = fightsForPlayer(player);
  if (fights.length === 0) return payload;
  return payload.slice(0, -1) + ',"fights":' + JSON.stringify(fights) + "}";
}

// Validates / clamps a setView. Only culling reads it: dormancy, raids and fights still key off the rider.
function handleSetView(player: Player, msg: { x: unknown; y: unknown; halfW: unknown; halfH: unknown; strategy: unknown }) {
  if (msg.strategy !== true) {
    player.view = null;
    return;
  }
  const now = Date.now();
  if (now - player.viewSetAt < SET_VIEW_MIN_MS) return;
  const nums = [msg.x, msg.y, msg.halfW, msg.halfH];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return;
  const [x, y, halfW, halfH] = nums as number[];
  player.viewSetAt = now;
  player.view = {
    x: clamp(x, 0, state.WORLD_TILES_X) * TILE_SIZE,
    y: clamp(y, 0, state.WORLD_TILES_Y) * TILE_SIZE,
    halfW: (clamp(halfW, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
    halfH: (clamp(halfH, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
  };
}

// One simulation tick (everything the pause freezes). The testHook "fastForward" runs it in a loop.
function stepSimulation() {
  state.cycleTick++;
  const nightNow = isNightNow();

  if (!nightNow && state.wasNight) {
    gravestones.length = 0;
    broadcastEvent("dawn", "Dawn breaks — the colony survived the night");
    applyDailyFoodConsumption();
    applyMoraleCheck();
    state.autosaveDue = true;
  }

  if (nightNow && !state.wasNight) broadcastEvent("night", "Night falls");
  state.wasNight = nightNow;

  state.colonyHappiness = computeColonyHappiness();

  const dayIndex = Math.floor(state.cycleTick / (DAY_TICKS + NIGHT_TICKS));
  if (!nightNow && state.cycleTick % (DAY_TICKS + NIGHT_TICKS) >= RAID_SPAWN_CYCLE_TICK && state.raidSpawnedForDay !== dayIndex) {
    state.raidSpawnedForDay = dayIndex;
    // With raids switched off by a test the day's raid is skipped for good, not deferred to re-enabling.
    if (!state.testRaidsDisabled) spawnRaid(dayIndex);
  }

  if (state.treeRespawnCooldown > 0) {
    state.treeRespawnCooldown--;
  } else {
    tryGrowTree();
    state.treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;
  }

  if (state.lumberjackTreeGrowCooldown > 0) {
    state.lumberjackTreeGrowCooldown--;
  } else {
    tryGrowTreesNearLumberjackPosts();
    state.lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;
  }

  for (const player of players.values()) {
    if (player.attackCooldownTicks > 0) player.attackCooldownTicks--;
    if (player.poisonTicksRemaining > 0) {
      player.poisonTicksRemaining--;
      if (player.poisonTicksRemaining % TICK_RATE === 0) {
        damagePlayer(player, player.poisonDamagePerTick);
      }
    }

    if (player.dead) continue;
    const { dx, dy } = player.input;
    const length = Math.hypot(dx, dy) || 1;
    const normDx = dx / length;
    const normDy = dy / length;
    const playerSpeed = PLAYER_SPEED * heroProfileOf(player).stats.moveSpeedMult * spellBuffSpeedMult("p:" + player.id) * biomeSpeedMultiplier(player.x, player.y) * roadSpeedMultiplier(player.x, player.y);

    const nextX = clamp(
      player.x + normDx * playerSpeed * dt,
      PLAYER_HALF_SIZE,
      state.worldWidth - PLAYER_HALF_SIZE
    );
    if (!collidesAt(nextX, player.y)) player.x = nextX;

    const nextY = clamp(
      player.y + normDy * playerSpeed * dt,
      PLAYER_HALF_SIZE,
      state.worldHeight - PLAYER_HALF_SIZE
    );
    if (!collidesAt(player.x, nextY)) player.y = nextY;
  }

  updatePlayerMorale();
  updateOrderGroups();
  updateSquadMarch();
  for (const colonist of colonists.values()) {
    updateColonist(colonist, dt);
  }
  updateConstructionSites();
  updateSiegeWorkshops();
  updateForges();
  updateHeroRecruits();
  updateSpellStatuses();

  // Walls & gates: mobs and wildlife move and path from the hostile side of every gate.
  withHostileMover(() => {
    updateRegiments();
    updateRaidGroups(dt);
    for (const mob of mobs.values()) {
      // Forts phase A: a site's own mobs pass its gates.
      state.moverOwner = tileOwner.size === 0 ? 0 : siteNumber(mob.siteId);
      updateMob(mob, dt);
    }
    state.moverOwner = 0;
  });
  updateTowers();
  separateBodies();
  if (state.cycleTick % TICK_RATE === 0) pruneSlotClaims();
  withHostileMover(() => updateWildlife(dt));
  updateWildlifeRespawn();
  updateGates();

  checkWardStoneLapses();

  updateFarmPlots();
  updateForageRegrow();
  processRespawnQueue();
  updateWardPriestPresence();
  // Dawn/dusk respawn windows: one toast per batch.
  if (state.respawnWindowSpawned > 0) {
    broadcastEvent(
      "build",
      `Reinforcements arrive at ${respawnWindowAt(state.cycleTick) ?? "dawn"}: ${state.respawnWindowSpawned} unit${state.respawnWindowSpawned === 1 ? "" : "s"} back on duty`
    );
    state.respawnWindowSpawned = 0;
  }
  respawnDeadPlayers();
  if (state.cycleTick % TICK_RATE === 0) {
    checkBossSightings();
    evaluateGoals();
  }
  if (state.cycleTick % FIGHT_SCAN_TICKS === 0) scanFights();
}

// ---- Strategy mode phase 5: enemy regiment summaries (docs PLAN-strategy-mode.md §3 / §4) ----

function stampLiveVision() {
  if (state.liveVisionGrid.length !== state.WORLD_TILES_X * state.WORLD_TILES_Y) {
    state.liveVisionGrid = new Uint16Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
    state.liveVisionStamp = 0;
  }
  state.liveVisionStamp = (state.liveVisionStamp % 65535) + 1;
  if (state.liveVisionStamp === 1) state.liveVisionGrid.fill(0);
  const stamp = (px: number, py: number, offsets: Array<[number, number]>) => {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    for (const [dx, dy] of offsets) {
      const x = tx + dx;
      const y = ty + dy;
      if (x >= 0 && y >= 0 && x < state.WORLD_TILES_X && y < state.WORLD_TILES_Y) state.liveVisionGrid[y * state.WORLD_TILES_X + x] = state.liveVisionStamp;
    }
  };
  for (const p of players.values()) stamp(p.x, p.y, PLAYER_VISION_OFFSETS);
  for (const c of colonists.values()) if (!isAbbeyClergy(c)) stamp(c.x, c.y, COLONIST_VISION_OFFSETS);
}

function inLiveVision(px: number, py: number): boolean {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= state.WORLD_TILES_X || ty >= state.WORLD_TILES_Y) return false;
  return state.liveVisionGrid[ty * state.WORLD_TILES_X + tx] === state.liveVisionStamp;
}

function enemyRegimentsNow(): EnemyRegimentSnapshot[] {
  stampLiveVision();
  const groups = new Map<string, { all: number; seen: Mob[] }>();
  for (const m of mobs.values()) {
    if (m.hp <= 0) continue;
    const key = regimentKey(m) ?? `c:${Math.floor(m.x / TILE_SIZE / ENEMY_CELL_TILES)},${Math.floor(m.y / TILE_SIZE / ENEMY_CELL_TILES)}`;
    let g = groups.get(key);
    if (!g) {
      g = { all: 0, seen: [] };
      groups.set(key, g);
    }
    g.all++;
    if (inLiveVision(m.x, m.y)) g.seen.push(m);
  }
  const night = isNightNow();
  const out: EnemyRegimentSnapshot[] = [];
  for (const [id, g] of groups) {
    const seen = g.seen;
    if (seen.length === 0) continue;
    let x = 0;
    let y = 0;
    let hp = 0;
    let maxHp = 0;
    let dmg = 0;
    let threat = fightThreatOf(seen[0]);
    const roles: Partial<Record<CombatRole, number>> = {};
    for (const m of seen) {
      x += m.x;
      y += m.y;
      hp += Math.max(0, m.hp);
      maxHp += m.maxHp;
      dmg += m.damage;
      const role = mobRole(m);
      roles[role] = (roles[role] ?? 0) + 1;
      const t = fightThreatOf(m);
      if (t.rank > threat.rank) threat = t;
    }
    const snap: EnemyRegimentSnapshot = {
      id,
      // Scale pass: a pack of nothing but wolf riders gets its own banner label.
      label: seen.every((m) => m.kind === "goblinRider") && threat.kind === "raid" ? "Goblin wolf riders" : threat.label,
      x: Math.round(x / seen.length),
      y: Math.round(y / seen.length),
      count: seen.length,
      roles,
      power: Math.round(hp * dmg),
      hpFrac: maxHp > 0 ? Math.round((hp / maxHp) * 100) / 100 : 0,
    };
    if (g.all > seen.length) snap.partial = true;
    if (!night && seen.some((m) => m.groupId !== null && m.passive)) snap.massing = true;
    const reg = regiments.get(id);
    if (reg?.routed) snap.routed = true;
    if (reg?.sheltering) snap.sheltering = true;
    // Phase 6: morale bar and "Outflanked!" on the enemy banner.
    if (reg) snap.morale = Math.round(reg.morale);
    if (reg?.outflankedTick !== undefined && state.cycleTick - reg.outflankedTick <= ENEMY_OUTFLANKED_SHOW_TICKS) snap.outflanked = true;
    const flankers = reg ? reg.flankIds.map((fid) => mobs.get(fid)).filter((m): m is Mob => !!m && m.tactic === "flank") : [];
    const end = flankers[0]?.flankWaypoints?.[flankers[0].flankWaypoints.length - 1];
    // Only a flank whose runners are in sight (the arc itself is the warning).
    if (end && flankers.some((m) => inLiveVision(m.x, m.y))) {
      snap.flank = {
        fromX: Math.round(flankers.reduce((s, m) => s + m.x, 0) / flankers.length),
        fromY: Math.round(flankers.reduce((s, m) => s + m.y, 0) / flankers.length),
        x: Math.round(end.x),
        y: Math.round(end.y),
        ...(flankers[0].flankTargetId ? { targetId: flankers[0].flankTargetId } : {}),
      };
    }
    out.push(snap);
  }
  return out;
}

setInterval(() => {
  const tickStart = TEST_HOOKS ? performance.now() : 0;
  // Strategy mode phase 5: time scale (see timeScale). Paused / loading: no steps, snapshots every tick.
  let stepped = false;
  if (!state.isPaused && !state.simHeldForLoad) {
    state.simAccum += state.timeScale;
    while (state.simAccum >= 1) {
      stepSimulation();
      state.simAccum -= 1;
      stepped = true;
    }
  }
  runDueAutosave();
  state.enemyRegimentTick++;
  // Slow motion: nothing moved this tick, so no snapshot (the client interpolates across the gap).
  if (!stepped && !state.isPaused && !state.simHeldForLoad) {
    updateVision();
    flushExplored();
    return;
  }

  // Outside the pause gate so a player joining mid-pause still gets their surroundings.
  updateVision();
  flushExplored();

  const night = isNightNow();
  pruneTaskForces();

  const settlementStatsNow = settlementStats();
  const snapshot: ServerMessage = {
    type: "snapshot",
    players: Array.from(players.values()).map((p): PlayerSnapshot => ({
      id: p.id,
      x: p.x,
      y: p.y,
      color: p.color,
      hp: p.hp,
      maxHp: playerMaxHp(p),
      dead: p.dead,
    })),
    colonists: Array.from(colonists.values()).map((c): ColonistSnapshot => ({
      id: c.id,
      kind: c.kind,
      x: c.x,
      y: c.y,
      state: c.state,
      hp: c.hp,
      maxHp: c.maxHp,
      postX: c.postX,
      postY: c.postY,
      stance: c.stance,
      sheltered: isAtShelter(c),
      ...(c.armourTier ? { armourTier: c.armourTier } : {}),
      ...(c.weaponTier ? { weaponTier: c.weaponTier } : {}),
      ...(c.kind === "hero" ? { heroName: c.heroName, heroClass: c.heroClass, heroLevel: heroProfileFor(heroKey(c.id)).level } : {}),
      ...(summonedUntil.has(c.id) ? { summoned: true } : {}),
      ...(c.holdFire ? { holdFire: true } : {}),
      ...(c.skirmish ? { skirmish: true } : {}),
      ...(c.cycleCharge ? { cycleCharge: true } : {}),
      ...(c.shape ? { shape: c.shape } : {}),
    })),
    mobs: Array.from(mobs.values()).map((m): MobSnapshot => ({
      id: m.id,
      kind: m.kind,
      x: m.x,
      y: m.y,
      hp: m.hp,
      maxHp: m.maxHp,
      ...(m.mark !== HungerMark.None ? { mark: m.mark } : {}),
      ...(m.boss ? { boss: m.boss } : {}),
      ...(m.scale !== undefined && m.scale !== 1 ? { scale: m.scale } : {}),
    })),
    wood: stock.wood,
    iron: stock.iron,
    rock: stock.rock,
    grain: stock.grain,
    meat: stock.meat,
    fruit: stock.fruit,
    wool: stock.wool,
    cotton: stock.cotton,
    clothes: stock.clothes,
    tools: stock.tools,
    luxuryItems: stock.luxuryItems,
    gold: stock.gold,
    alcohol: stock.alcohol,
    happiness: state.colonyHappiness,
    marketBuilt: state.marketBuilt,
    goldShopBuilt: state.goldShopBuilt,
    isNight: night,
    cycleProgress: (state.cycleTick % (DAY_TICKS + NIGHT_TICKS)) / (DAY_TICKS + NIGHT_TICKS),
    dayFraction: DAY_TICKS / (DAY_TICKS + NIGHT_TICKS),
    isPaused: state.isPaused,
    ...(state.pausedBy ? { pausedBy: state.pausedBy } : {}),
    timeScale: state.timeScale,
    ...(state.timeScaleBy ? { timeScaleBy: state.timeScaleBy } : {}),
    effects: state.pendingEffects,
    // The first standing Town Center (the starting one unless it fell); townCenters has them all.
    townCenterHp: state.townCenters[0] ? Math.max(0, state.townCenters[0].hp) : 0,
    townCenterMaxHp: townCenterMaxHp(state.townCenters[0]?.level ?? 1),
    population: civilianPopulationUsed(),
    populationCap: settlementStatsNow.reduce((n, st) => n + st.cap, 0),
    taskForces: taskForcesForSnapshot(),
    armyRegiments: armyRegimentsForSnapshot(),
    orderGroups: orderGroupsForSnapshot(),
    readyFarmPlots: farmPlotIndices("harvesting"),
    sownFarmPlots: farmPlotIndices("sown"),
    fallowFarmPlots: farmPlotIndices("fallow"),
    wildlife: wildlifeForSnapshot(),
    gravestones,
    difficulty: state.difficulty,
    buildingLevels: buildingLevelsForSnapshot(),
    farmStages: farmStagesForSnapshot(),
    constructionSites: constructionSitesForSnapshot(),
    damagedBuildings: damagedBuildingsForSnapshot(),
    hearths: hearthsForSnapshot(),
    equipment,
    forgeBusy: forgeBusyForSnapshot(),
    townCenters: state.townCenters.map(
      (tc, i): TownCenterSnapshot => ({
        x: tc.x,
        y: tc.y,
        level: tc.level,
        hp: Math.max(0, tc.hp),
        maxHp: townCenterMaxHp(tc.level),
        population: settlementStatsNow[i].used,
        populationCap: settlementStatsNow[i].cap,
        populationTierCap: settlementStatsNow[i].tierCap,
        populationKeepBonus: settlementStatsNow[i].keepBonus,
        troops: settlementStatsNow[i].troops,
        troopCap: settlementStatsNow[i].troopCap,
        garrisonBase: settlementStatsNow[i].garrisonBase,
        garrisonCap: settlementStatsNow[i].garrisonCap,
      })
    ),
    goal: state.goalSnapshot,
    gates: gatesForSnapshot(),
    respawn: respawnWindowSnapshot(),
  };
  state.pendingEffects = [];

  // Small/medium worlds send everyone the same payload. On big worlds each player only gets the mobs and
  // wildlife within view distance + margin (their camera never shows more), keeping snapshots small.
  const cull = state.WORLD_TILES_X > SNAPSHOT_CULL_MIN_WORLD && snapshot.type === "snapshot";
  const sharedPayload = cull ? "" : JSON.stringify(snapshot);
  // Strategy mode phase 5: enemy summaries for strategy-mode players, on the first broadcast once due.
  let enemyJson: string | null = null;
  if (state.enemyRegimentTick >= ENEMY_REGIMENT_REFRESH_TICKS && Array.from(players.values()).some((p) => p.view)) {
    state.enemyRegimentTick = 0;
    enemyJson = JSON.stringify(enemyRegimentsNow());
  }
  for (const player of players.values()) {
    if (player.socket.readyState === player.socket.OPEN) {
      let payload = sharedPayload;
      if (snapshot.type === "snapshot" && cull) {
        const limit = SNAPSHOT_VIEW_TILES * TILE_SIZE;
        const view = player.view;
        const near = (x: number, y: number) =>
          (Math.abs(x - player.x) < limit && Math.abs(y - player.y) < limit) ||
          (!!view && Math.abs(x - view.x) < view.halfW && Math.abs(y - view.y) < view.halfH);
        const wl: number[] = [];
        for (let i = 0; i < snapshot.wildlife.length; i += WILDLIFE_SNAPSHOT_STRIDE) {
          if (near(snapshot.wildlife[i + 2], snapshot.wildlife[i + 3])) wl.push(...snapshot.wildlife.slice(i, i + WILDLIFE_SNAPSHOT_STRIDE));
        }
        payload = JSON.stringify({ ...snapshot, mobs: snapshot.mobs.filter((m) => near(m.x, m.y)), wildlife: wl });
      }
      if (enemyJson !== null && player.view) payload = payload.slice(0, -1) + ',"enemyRegiments":' + enemyJson + "}";
      if (snapshot.type === "snapshot" && player.siteTilesVersion !== state.ownerVersion) {
        player.siteTilesVersion = state.ownerVersion;
        payload = payload.slice(0, -1) + ',"siteTiles":' + JSON.stringify(Array.from(tileOwner).flat()) + "}";
      }
      player.socket.send(withPlayerHeroes(withPlayerProfile(withPlayerFights(payload, player), player), player));
    }
  }
  if (TEST_HOOKS) {
    tickDurationsMs.push(performance.now() - tickStart);
    if (tickDurationsMs.length > TICK_DURATION_SAMPLES) tickDurationsMs.shift();
  }
}, 1000 / TICK_RATE);
