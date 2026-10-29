// sim.ts: One simulation tick (stepSimulation: everything the pause freezes); index.ts's tick loop and the fastForward test hook run it.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TICK_RATE, PLAYER_SPEED, PLAYER_HALF_SIZE } from "@colony/shared/protocol";
import {
  DAY_TICKS, FIGHT_SCAN_TICKS, LUMBERJACK_TREE_INTERVAL_TICKS, NIGHT_TICKS, RAID_SPAWN_CYCLE_TICK,
  TREE_RESPAWN_INTERVAL_TICKS, dt,
} from "./constants.js";
import { clans, colonists, gravestones, mobs, players, state, tileOwner } from "./state.js";
import { biomeSpeedMultiplier, clamp, collidesAt, isNightNow, roadSpeedMultiplier, siteNumber } from "./tiles.js";
import { separateBodies } from "./pathfinding.js";
import { tryGrowTree, tryGrowTreesNearLumberjackPosts, updateFarmPlots } from "./economy.js";
import { checkBossSightings } from "./worldgen.js";
import { updateForageRegrow, updateWildlife, updateWildlifeRespawn } from "./wildlife.js";
import {
  applyDailyFoodConsumption, applyMoraleCheck, checkWardStoneLapses, computeColonyHappiness, processRespawnQueue,
  respawnWindowAt, updateColonist, updateWardPriestPresence,
} from "./colonists.js";
import { updateSquadMarch } from "./units.js";
import {
  damagePlayer, pruneSlotClaims, respawnDeadPlayers, updateGates, updateTowers, withHostileMover,
} from "./combat.js";
import { updateSiegeWorkshops } from "./siege.js";
import { updateMob } from "./mobs.js";
import { updateConstructionSites } from "./construction.js";
import { updatePlayerMorale, updateRegiments } from "./tactics.js";
import { spawnRaid, updateRaidGroups } from "./raids.js";
import { evaluateGoals } from "./goals.js";
import { heroProfileOf, updateForges, updateHeroRecruits } from "./heroes.js";
import { spellBuffSpeedMult, updateSpellStatuses } from "./spells.js";
import { updateOrderGroups } from "./orders.js";
import { broadcastEvent, scanFights } from "./net.js";
import { clanTownCenters, enterClan, forEachClan, resetClan } from "./clans.js";

// One simulation tick (everything the pause freezes). The testHook "fastForward" runs it in a loop.
export function stepSimulation() {
  state.cycleTick++;
  const nightNow = isNightNow();

  if (!nightNow && state.wasNight) {
    gravestones.length = 0;
    broadcastEvent("dawn", "Dawn breaks — the colony survived the night");
    // Clans: each clan feeds its own colonists from its own stock, and its own soldiers may desert.
    forEachClan(() => {
      applyDailyFoodConsumption();
      applyMoraleCheck();
    });
    state.autosaveDue = true;
  }

  if (nightNow && !state.wasNight) broadcastEvent("night", "Night falls");
  state.wasNight = nightNow;

  // Clans: with several clans each clan's happiness is recomputed once a second (one map scan per clan).
  if (clans.length === 1) state.colonyHappiness = computeColonyHappiness();
  else if (state.cycleTick % TICK_RATE === 0) forEachClan((clan) => (clan.colonyHappiness = computeColonyHappiness()));

  const dayIndex = Math.floor(state.cycleTick / (DAY_TICKS + NIGHT_TICKS));
  if (!nightNow && state.cycleTick % (DAY_TICKS + NIGHT_TICKS) >= RAID_SPAWN_CYCLE_TICK && state.raidSpawnedForDay !== dayIndex) {
    state.raidSpawnedForDay = dayIndex;
    // With raids switched off by a test the day's raid is skipped for good, not deferred to re-enabling.
    // Clans: every clan with a Town Center gets its own raid on the shared schedule (clan 0 always).
    if (!state.testRaidsDisabled) {
      forEachClan((clan) => {
        if (clan.id === 0 || clanTownCenters().length > 0) spawnRaid(dayIndex);
      });
    }
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
  // Clans: each colonist works for (and pays from / delivers to) its own clan.
  for (const colonist of colonists.values()) {
    enterClan(colonist.clan);
    updateColonist(colonist, dt);
  }
  resetClan();
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
    forEachClan(() => evaluateGoals());
  }
  if (state.cycleTick % FIGHT_SCAN_TICKS === 0) scanFights();
}
