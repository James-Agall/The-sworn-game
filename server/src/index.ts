// index.ts: boot and wiring. Imports every server module in evaluation order (types, constants and state
// first; see ROADMAP "Server module split"), generates the world, starts the HTTP/WebSocket server (net.ts),
// routes client messages, and runs the tick loop (stepSimulation in sim.ts) that sends the snapshots.
import { randomUUID } from "node:crypto";
import {
  TileType, PLAYER_MAX_HP, type ClientMessage, TIME_SCALES, type ServerMessage, type PlayerSnapshot,
  type ColonistSnapshot, type MobSnapshot, HungerMark, type TownCenterSnapshot, ENEMY_REGIMENT_REFRESH_TICKS,
  TILE_SIZE, WILDLIFE_SNAPSHOT_STRIDE, TICK_RATE,
} from "@colony/shared/protocol";
import type { Player } from "./types.js";
import {
  DAY_TICKS, NIGHT_TICKS, PLAYER_COLORS, PORT, SNAPSHOT_CULL_MIN_WORLD, SNAPSHOT_VIEW_TILES, TEST_HOOKS,
  TICK_DURATION_SAMPLES,
} from "./constants.js";
import {
  colonists, equipment, gravestones, mobs, players, state, summonedUntil, tickDurationsMs, tileOwner,
} from "./state.js";
import { clamp, isNightNow, tileIndex } from "./tiles.js";
import "./pathfinding.js";
import { farmPlotIndices, farmStagesForSnapshot, handleBuyWithGold, handleExchangeResource, stock } from "./economy.js";
import { generateWorld } from "./worldgen.js";
import { wildlifeForSnapshot } from "./wildlife.js";
import {
  TOWN_CENTER_TILE, civilianPopulationUsed, handleRepairBuilding, isAtShelter, respawnWindowSnapshot,
  settlementStats, spawnPointNearTownCenter, townCenterMaxHp,
} from "./colonists.js";
import { armyRegimentsForSnapshot, pruneTaskForces, taskForcesForSnapshot } from "./units.js";
import { damagedBuildingsForSnapshot, gatesForSnapshot, handlePlayerAttack, handleSetGateLock } from "./combat.js";
import { handleQueueSiege } from "./siege.js";
import { handleSetDifficulty } from "./mobs.js";
import {
  buildingInfoFor, buildingLevelsForSnapshot, constructionSitesForSnapshot, handleSetTile, handleUpgradeBuilding,
} from "./construction.js";
import "./tactics.js";
import "./raids.js";
import { handleCommandAttackHearth, hearthsForSnapshot } from "./hearths.js";
import "./goals.js";
import {
  forgeBusyForSnapshot, handleEquipItem, handleQueueForge, handleRecruitHero, handleTakeFromArmoury,
  handleUnequipItem, heroKey, heroProfileFor, playerMaxHp, withPlayerHeroes, withPlayerProfile,
} from "./heroes.js";
import { handleCastSpell, handleLearnSpell, handleSetSpellAuto, handleSetSpellSlot, handleUseTome } from "./spells.js";
import {
  enemyRegimentsNow, handleAssignTaskForce, handleCommandAttack, handleCommandMove, handleCommandStance,
  handleRegimentOrder, handleRegimentSettings, orderGroupsForSnapshot,
} from "./orders.js";
import { stepSimulation } from "./sim.js";
import {
  handleLoadGame, handleSaveGame, listSaves, resetWorld, runDueAutosave, saveOnShutdown, sendTo,
} from "./saves.js";
import { flushExplored, handleSetView, httpServer, sendWelcome, updateVision, withPlayerFights, wss } from "./net.js";
import { handleTestHook } from "./testhooks.js";

state.tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;

generateWorld();
httpServer.listen(PORT);
console.log(`colony2d server listening on ws://localhost:${PORT}`);
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
