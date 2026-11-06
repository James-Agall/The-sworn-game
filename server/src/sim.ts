// sim.ts: One simulation tick (stepSimulation: everything the pause freezes); index.ts's tick loop and the fastForward test hook run it.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { topUpCreative } from "./creative.js";
import { TICK_RATE, PLAYER_SPEED, PLAYER_HALF_SIZE } from "@colony/shared/protocol";
import {
  DAY_TICKS, FIGHT_SCAN_TICKS, LUMBERJACK_TREE_INTERVAL_TICKS, NIGHT_TICKS, RAID_SPAWN_CYCLE_TICK,
  TREE_RESPAWN_INTERVAL_TICKS, dt,
} from "./constants.js";
import { clans, colonists, gravestones, lap, lapReset, mobs, players, state, tileOwner } from "./state.js";
import { mobFrozenByStreaming, updateChunkStates, warmMobStride } from "./chunks.js";
import { updateAbstractWorld } from "./abstract.js";
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
import { updateSites, updateSiteWorker } from "./sites.js";
import { updateConstructionSites } from "./construction.js";
import { updatePlayerMorale, updateRegiments } from "./tactics.js";
import { spawnRaid, updateRaidGroups } from "./raids.js";
import { evaluateGoals } from "./goals.js";
import { heroProfileOf, updateForges, updateGearPickup, updateHeroRecruits } from "./heroes.js";
import { spellBuffSpeedMult, updateSpellStatuses } from "./spells.js";
import { updateOrderGroups } from "./orders.js";
import { updateBattleBrains, updateFormationMarch } from "./battle.js";
import { broadcastEvent, scanFights } from "./net.js";
import { clanTownCenters, enterClan, forEachClan, resetClan } from "./clans.js";
import { settlementsDawn } from "./diplomacy.js";
import { strifeDawn } from "./strife.js";
import { updateQuests } from "./quests.js";
import { updateWagons } from "./wagons.js";
import { updateVassals, vassalsDawn } from "./vassals.js";
import { spawnCampRaids, stepWarbandMobs, updateWarbands, warbandsDawn } from "./warbands.js";
import { updateFamily } from "./family.js";
import { assignHomes, heirOrderNames, peopleDawn, updateAging, updateTraining, updateVillageLevy } from "./people.js";
import { updateProspecting, updateWorkerXp } from "./progression.js";
import { heroSpeedMult, updateHeroLife } from "./herolife.js";

// One simulation tick (everything the pause freezes). The testHook "fastForward" runs it in a loop.
export function stepSimulation() {
  lapReset();
  state.cycleTick++;
  // World streaming phase 2: ACTIVE / WARM / COLD chunks (re-classified once a second).
  updateChunkStates();
  // Phase 3: park / wake COLD chunks' mobs, animals and regrowth after each re-classification.
  updateAbstractWorld();
  const nightNow = isNightNow();

  if (!nightNow && state.wasNight) {
    gravestones.length = 0;
    broadcastEvent("dawn", "Dawn breaks — the colony survived the night");
    // Clans: each clan feeds its own colonists from its own stock, and its own soldiers may desert.
    forEachClan(() => {
      applyDailyFoodConsumption();
      applyMoraleCheck();
    });
    // Village life phase 2: homes, births, immigrants.
    peopleDawn();
    // Forts phase D: settlement production / consumption and relation drift.
    settlementsDawn();
    // Forts phase F: fealty at relation 100, breakaways, tribute.
    vassalsDawn();
    // Forts phase G: a wandering warband now and then.
    warbandsDawn();
    // World streaming phase 5: abstract camp / settlement strife out of sight.
    strifeDawn();
    state.autosaveDue = true;
  }

  if (nightNow && !state.wasNight) {
    broadcastEvent("night", "Night falls");
    // Village life phase 4: beds for anyone who arrived since dawn, before they walk home to them.
    forEachClan(() => assignHomes());
  }
  state.wasNight = nightNow;

  // Forts phase D2: settlement quests (expiry, defend results at dawn, the posting scan).
  updateQuests();

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
        // Solo hero phase 4: a Solo hero without a camp is not raided (the world's camps and warbands still roam).
        if ((clan.id === 0 && !state.solo) || clanTownCenters().length > 0) {
          spawnRaid(dayIndex);
          // Forts phase G: overgrown founded camps raid their nearest clan too.
          spawnCampRaids(dayIndex);
        }
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
    const playerSpeed = PLAYER_SPEED * heroProfileOf(player).stats.moveSpeedMult * spellBuffSpeedMult("p:" + player.id) * biomeSpeedMultiplier(player.x, player.y) * roadSpeedMultiplier(player.x, player.y) * heroSpeedMult(player);

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

  lap("misc");
  updatePlayerMorale();
  updateOrderGroups();
  updateSquadMarch();
  // Battle engine phase 2: marching blocks move their anchors and their members' slot targets.
  updateFormationMarch();
  lap("orders");
  // Battle engine phase 1: the regiment brains (4 Hz, staggered; read-only for now).
  updateBattleBrains();
  lap("brain");
  // Clans: each colonist works for (and pays from / delivers to) its own clan.
  for (const colonist of colonists.values()) {
    // World streaming phase 3: a far wagon convoy's units are moved by wagons.ts.
    if (colonist.ghost) continue;
    enterClan(colonist.clan);
    updateColonist(colonist, dt);
  }
  resetClan();
  lap("colonists");
  // Forts phase E: trader wagons (movement, trips, post rosters).
  updateWagons();
  updateConstructionSites();
  updateSiegeWorkshops();
  updateForges();
  updateGearPickup();
  updateHeroRecruits();
  updateSpellStatuses();

  lap("misc");
  // Walls & gates: mobs and wildlife move and path from the hostile side of every gate.
  withHostileMover(() => {
    updateRegiments();
    updateRaidGroups(dt);
    // Forts phase G: warbands on the move (their members skip updateMob).
    stepWarbandMobs(dt);
    for (const mob of mobs.values()) {
      // World streaming phase 2: an idle free mob in a COLD chunk stands still (never on 160-512 maps).
      if (mobFrozenByStreaming(mob)) continue;
      // Phase 3: an idle free mob in a WARM chunk runs at a low rate (WARM_TICK_EVERY ticks of dt at once).
      const stride = warmMobStride(mob);
      if (stride === 0) continue;
      // Forts phase A: a site's own mobs pass its gates.
      state.moverOwner = tileOwner.size === 0 ? 0 : siteNumber(mob.siteId);
      // Forts phase C: a human settlement's cosmetic workers walk their loop instead.
      if (mob.siteWorker) updateSiteWorker(mob, dt * stride);
      else if (!mob.warbandId) updateMob(mob, dt * stride);
    }
    state.moverOwner = 0;
  });
  lap("mobs");
  updateTowers();
  separateBodies();
  lap("separate");
  if (state.cycleTick % TICK_RATE === 0) pruneSlotClaims();
  withHostileMover(() => updateWildlife(dt));
  updateWildlifeRespawn();
  updateGates();

  checkWardStoneLapses();

  updateFarmPlots();
  updateForageRegrow();
  processRespawnQueue();
  // Village life: trainees count down; children grow up (once a second).
  updateTraining();
  if (state.cycleTick % TICK_RATE === 0) {
    updateAging();
    updateFamily(heirOrderNames);
    updateVillageLevy();
    // Progression tree phase 2: worker XP.
    updateWorkerXp();
    updateProspecting();
  }
  updateWardPriestPresence();
  // Solo hero: gathering, station work, needs.
  updateHeroLife();
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
    updateSites();
    updateWarbands();
    updateVassals();
    forEachClan(() => evaluateGoals());
  }
  if (state.cycleTick % FIGHT_SCAN_TICKS === 0) scanFights();
  if (state.creative) topUpCreative();
  lap("misc");
}
