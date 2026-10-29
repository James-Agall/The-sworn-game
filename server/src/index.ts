import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promises as fsp, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  TileType, VISION_RADIUS_PLAYER, VISION_RADIUS_COLONIST, VISION_RADIUS_BUILDING, VISION_RADIUS_START, TILE_SIZE,
  type ServerMessage, type GameEventCategory, type WildlifeKind, WILDLIFE_KINDS, type MobKind, HungerMark,
  SIEGE_KINDS, COLONIST_ROLE, MOB_ROLE, type ColonistKind, type Stance, type EquipSlot, HERO_CLASSES, type HeroClass,
  type SaveSlot, SAVE_SLOTS, type SaveInfo, PLAYER_MAX_HP, type ClientMessage, TIME_SCALES, type FightKind,
  bossTitle, FIGHT_CLUSTER_TILES, FIGHT_WINDOW_SECONDS, TICK_RATE, type FightSnapshot, FIGHT_RELEVANCE_TILES,
  FIGHT_MAX_PER_PLAYER, PLAYER_SPEED, PLAYER_HALF_SIZE, type PlayerSnapshot, type ColonistSnapshot, type MobSnapshot,
  type TownCenterSnapshot, ENEMY_REGIMENT_REFRESH_TICKS, WILDLIFE_SNAPSHOT_STRIDE,
} from "@colony/shared/protocol";
import type {
  ActiveFight, Colonist, FightHit, HearthState, HeroRecruit, Mob, Player, RaidGroup, ResourceKey, SaveFile,
  TileCoord, Wildlife, WorldState,
} from "./types.js";
import {
  ARMOUR_DAMAGE_TAKEN_MULT, AUTOSAVE_ENABLED, BARN_FARM_RADIUS_TILES, BARN_MAX_FARM_PLOTS, DAY_LENGTH_SCALE,
  DAY_TICKS, DESERTER_ACTIVATION_TICKS, DUSK_RESPAWN_CYCLE_TICK, EXPLORED_FLUSH_TICKS, FARMHAND_CYCLE_TICKS,
  FARMHAND_YIELD_PER_CYCLE, FARM_FALLOW_TICKS, FARM_GROW_TICKS, FARM_HARVESTS_BEFORE_FALLOW, FARM_HARVEST_TICKS,
  FARM_SOWN_FRACTION, FARM_YIELD_PER_HARVEST, FIGHT_BATTLE_COMBATANTS, FIGHT_BATTLE_DPS, FIGHT_MAJOR_COMBATANTS,
  FIGHT_MAJOR_DPS, FIGHT_MAX_HITS, FIGHT_MAX_TRACKED, FIGHT_RAID_LABELS, FIGHT_SCAN_TICKS, FIGHT_WINDOW_TICKS,
  FOOD_PER_COLONIST_PER_DAY, FORAGE_FRUIT_YIELD, FORAGE_PICKED_TO_RIPE, FORAGE_REGROW_TICKS, FORAGE_RIPE_TO_PICKED,
  GAME_DAY_TICKS, HERO_KEY_PREFIX, LEGACY_DAY_TICKS, LEGACY_GAME_DAY_TICKS, LEGACY_NIGHT_TICKS,
  LUMBERJACK_TREE_INTERVAL_TICKS, MAX_WORLD_SIZE, MIN_WORLD_SIZE, MOB_KIND_CONFIG, MORALE_MAX, NIGHT_TICKS,
  PLAYER_COLORS, PORT, RAID_FACTIONS, RAID_SPAWN_CYCLE_TICK, RESPAWN_FOOD_COST, SAVE_DIR, SAVE_SLOT_LABELS,
  SAVE_VERSION, SET_VIEW_MIN_MS, SNAPSHOT_CULL_MIN_WORLD, SNAPSHOT_VIEW_TILES, STANCES, STRATEGY_VIEW_MARGIN_TILES,
  STRATEGY_VIEW_MAX_HALF_TILES, TEST_HOOKS, TICK_DURATION_SAMPLES, TOWER_COSTS, TOWER_STATS,
  TREE_RESPAWN_INTERVAL_TICKS, VISION_BUILDING_TILES, WEAPON_DAMAGE_MULT, dt,
} from "./constants.js";
import {
  attackerSlots, buildingHp, buildingLevel, colonists, constructionSites, equipEvents, equipment, farmPlots,
  forageRegrow, forgeQueues, gates, gravestones, hearthEvents, hearths, heroEvents, heroProfiles, heroRecruits,
  minesPlacedOnOre, mobs, mobsWithoutRoute, moraleRegimentOfUnit, ownerSiteIds, playerMorale, players, raidGroups,
  regiments, repairPaid, repairQueue, reservedResourceTiles, respawnQueue, routedUnits, siegeEvents, siegeWorkshops,
  spellCooldowns, spellEvents, spellStatuses, state, summonedUntil, tacticsEvents, taskForceMax, taskForces,
  tickDurationsMs, tileOwner, towerCooldowns, towerEvents, walledSites, wardStoneLastTended,
  wardStonesActiveLastTick, wildlife,
} from "./state.js";
import {
  biomeSpeedMultiplier, clamp, clearOwners, collidesAt, getBuildingLevel, inBounds, isNightNow, ownerAt, resourceKey,
  roadSpeedMultiplier, setOwner, siteNumber, tileIndex, tileOfPixel, tileToPixelCenter,
} from "./tiles.js";
import { findAdjacentWalkable, isWalkableTile, separateBodies } from "./pathfinding.js";
import {
  farmPlotIndices, farmPlotProgress, farmStagesForSnapshot, farmhandProgress, handleBuyWithGold,
  handleExchangeResource, initialStock, releaseResourceReservation, stock, tryGrowTree,
  tryGrowTreesNearLumberjackPosts, updateFarmPlots,
} from "./economy.js";
import { checkBossSightings, generateWorld, makeBoss, setWorldSize } from "./worldgen.js";
import {
  WILDLIFE_CONFIG, WILDLIFE_RESPAWN_INTERVAL_TICKS, damageWildlife, spawnWildlifeAt, updateForageRegrow,
  updateWildlife, updateWildlifeRespawn, wildlifeForSnapshot,
} from "./wildlife.js";
import {
  TOWN_CENTER_TILE, applyDailyFoodConsumption, applyMoraleCheck, checkWardStoneLapses, civilianPopulationUsed,
  computeColonyHappiness, findTownCenterAt, getColonistsAtPost, handleRepairBuilding, happinessSpeedMultiplier,
  isAbbeyClergy, isAtShelter, populationCap, processRespawnQueue, productionSpeedMultiplier, respawnWindowAt,
  respawnWindowSnapshot, settlementOf, settlementStats, spawnColonistForPost, spawnPointNearTownCenter,
  townCenterBonus, townCenterMaxHp, updateColonist, updateWardPriestPresence,
} from "./colonists.js";
import {
  armyRegimentsForSnapshot, colonistRole, guardStats, isGuardOrMilitiaKind, isSiegeKind, pruneTaskForces,
  taskForcesForSnapshot, unitStats, updateSquadMarch,
} from "./units.js";
import {
  buildingMaxHp, damageBuilding, damageColonist, damageMob, damagePlayer, damageTownCenter,
  damagedBuildingsForSnapshot, gatesForSnapshot, handlePlayerAttack, handleSetGateLock, isTowerTile,
  livingTowersNear, pruneSlotClaims, respawnDeadPlayers, structureHp, towerCooldownTicks, updateGates, updateTowers,
  withHostileMover,
} from "./combat.js";
import { handleQueueSiege, raidSiegeCap, updateSiegeWorkshops } from "./siege.js";
import { applyHungerMark, handleSetDifficulty, isDifficulty, mobBodyRadius, rollMobSize, updateMob } from "./mobs.js";
import {
  buildingInfoFor, buildingLevelsForSnapshot, constructionSitesForSnapshot, handleSetTile, handleUpgradeBuilding,
  placementCost, resolveTownCenterPlacement, updateConstructionSites,
} from "./construction.js";
import { clearPlayerMorale, regimentKey, updatePlayerMorale, updateRegiments } from "./tactics.js";
import { createRaidMob, spawnRaid, updateRaidGroups } from "./raids.js";
import { backfillHearths, damageHearth, handleCommandAttackHearth, hearthsForSnapshot } from "./hearths.js";
import { GOALS, evaluateGoals, nightsSurvived } from "./goals.js";
import {
  forgeBusyForSnapshot, grantRelic, handleEquipItem, handleQueueForge, handleRecruitHero, handleTakeFromArmoury,
  handleUnequipItem, heroKey, heroProfileFor, heroProfileOf, heroProfileSnapshot, heroSheetsSnapshot, isEquippedKind,
  pickHeroName, playerAttackCooldownTicks, playerMaxHp, resetEquipment, restoreHeroProfiles, serializeHeroProfiles,
  spawnHeroColonist, updateForges, updateHeroRecruits, withPlayerHeroes, withPlayerProfile,
} from "./heroes.js";
import {
  clearSpellState, grantTome, handleCastSpell, handleLearnSpell, handleSetSpellAuto, handleSetSpellSlot,
  handleUseTome, isSpellId, learnSpell, spellBookSnapshot, spellBuffSpeedMult, unslowedSpeed, updateSpellStatuses,
} from "./spells.js";
import {
  clearOrderGroups, enemyRegimentsNow, handleAssignTaskForce, handleCommandAttack, handleCommandMove,
  handleCommandStance, handleRegimentOrder, handleRegimentSettings, orderGroupsForSnapshot, updateOrderGroups,
} from "./orders.js";

state.tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;

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
export const PLAYER_VISION_OFFSETS = circleOffsets(VISION_RADIUS_PLAYER);
export const COLONIST_VISION_OFFSETS = circleOffsets(VISION_RADIUS_COLONIST);
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

export function resetExplored() {
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

export function sendTo(player: Player, message: ServerMessage) {
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

function clearFights() {
  state.fightHits = [];
  state.activeFights = [];
}

export function fightThreatOf(mob: Mob): { kind: FightKind; label: string; rank: number } {
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
