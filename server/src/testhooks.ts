// testhooks.ts: COLONY_TEST_HOOKS handlers (scripted tests only).
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { livestockDebug } from "./animals.js";
import { childrenOf, spouseOf } from "./family.js";
import { handleDialogueChoice, handleGatherStop, handleHeroAction, handleHeroTool, handleInteract, heroLifeDebug, lifeOf, setNeedsOverride } from "./herolife.js";
import { addItem, itemCount, professionOf, takeItem, progressionDebug, progressionSnapshot, resetProgressCache, restoreProgress } from "./progression.js";
import { type ItemId, PROGRESSION } from "@colony/shared/progression";
import { recallWagon, refreshTradingPost, scanTradingPosts, sendWagon, setWagonAbstractRadius, wagonDebugState } from "./wagons.js";
import { buildingLevel, newClanProgress, tradingPosts } from "./state.js";
import { tileIndicesOf } from "./chunks.js";
import { auditTileRegistry, chunkStateAtPixel, chunkStateOf, chunkStateSummary, pathCacheStats, resetChunkStates, setTile, updateChunkStates } from "./chunks.js";
import { clanById, clanIdAt, clanOf, withClan } from "./clans.js";
import { auditWorld } from "./abstract.js";
import { currentWorldSeed, dropBaseCache } from "./worldbase.js";
import { strifeDawn, strifeStats } from "./strife.js";
import { chronicleEntries } from "./chronicle.js";
import { isSaveSlot, saveFileFor, savePath } from "./saves.js";
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  TileType, type WildlifeKind, WILDLIFE_KINDS, type MobKind, HungerMark, TILE_SIZE, SIEGE_KINDS, COLONIST_ROLE,
  MOB_ROLE, type ColonistKind, type Stance, type EquipSlot, HERO_CLASSES, type HeroClass,
} from "@colony/shared/protocol";
import type { Player, RaidGroup, ResourceKey, SiteTemplateId, TileCoord } from "./types.js";
import { adjustRelation, applySiteTier, catchUpCampGrowth, relationOf, siteFitProblem, stampSiteTemplate, templateSize } from "./sites.js";
import { spawnCampRaids, spawnWarband, warbandsDebug } from "./warbands.js";
import {
  ARMOUR_DAMAGE_TAKEN_MULT, BARN_FARM_RADIUS_TILES, BARN_MAX_FARM_PLOTS, DAY_LENGTH_SCALE, DAY_TICKS,
  DESERTER_ACTIVATION_TICKS, FARMHAND_CYCLE_TICKS, FARMHAND_YIELD_PER_CYCLE, HEMP_GROW_TICKS, HEMP_YIELD_PER_HARVEST,
  FARM_FALLOW_TICKS, FARM_GROW_TICKS, FARM_HARVESTS_BEFORE_FALLOW, FARM_HARVEST_TICKS, FARM_SOWN_FRACTION,
  FARM_YIELD_PER_HARVEST, FOOD_PER_COLONIST_PER_DAY, FORAGE_FRUIT_YIELD, FORAGE_PICKED_TO_RIPE, FORAGE_REGROW_TICKS,
  FORAGE_RIPE_TO_PICKED, GAME_DAY_TICKS, HERO_KEY_PREFIX, LEGACY_DAY_TICKS, LEGACY_GAME_DAY_TICKS,
  LEGACY_NIGHT_TICKS, MOB_KIND_CONFIG, MORALE_MAX, NIGHT_TICKS, RAID_FACTIONS, RESPAWN_FOOD_COST, STANCES,
  TOWER_COSTS, TOWER_STATS, WEAPON_DAMAGE_MULT,
  SITE_TEMPLATES,
  SAVE_DIR,
} from "./constants.js";
import {
  attackerSlots, buildingHp, colonists, constructionSites, equipEvents, farmPlots, forageRegrow,
  forgeAuto, forgeQueues, gates, hearthEvents, hearths, heroEvents, heroProfiles, heroRecruits, mobs, moraleRegimentOfUnit,
  ownerSiteIds, playerMorale, raidGroups, regiments, repairPaid, repairQueue, respawnQueue, routedUnits, siegeEvents,
  siegeWorkshops, spellCooldowns, spellEvents, spellStatuses, state, summonedUntil, systemMs, tacticsEvents, tickDurationsMs,
  tileOwner, towerCooldowns, towerEvents, walledSites, wildlife,
  sites, players,
} from "./state.js";
import {
  getBuildingLevel, inBounds, isNightNow, ownerAt, resourceKey, setOwner, siteNumber, tileIndex, tileOfPixel,
  tileToPixelCenter, dayTicksAt, setSnowSlow, biomeSpeedMultiplier,
} from "./tiles.js";
import { findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import {
  allRooms, barracksMoraleMult, forceFullRoomRecompute, heroRestMultAt, isRoofed, roomHappinessBonus, setRoomDirtAt, roomInfoAt, roomRecomputeStats, sleepQualityAt, updateRooms,
  workshopEffectAt, chapelHealMultAt, chapelReviveMult, hallGatherShare, heroInfirmaryHealMult, infirmaryHealRateAt, infirmaryStats, raidTheft,
  setHallGathered, spoilFood, storeroomProtectionOf, usableBedIndices,
} from "./structures.js";
import { colonyHappinessParts, computeColonyHappiness } from "./colonists.js";
import { debugAddPile, debugSetCropAt, debugSetCrops, updateZones, zoneCarryOf, zonesDebug, zonesSnapshotFor } from "./zones.js";
import { updateWorkAssignments, workDebug, workTabFor } from "./work.js";
import { farmPlotProgress, farmhandProgress, releaseResourceReservation } from "./economy.js";
import { makeBoss } from "./worldgen.js";
import { WILDLIFE_CONFIG, WILDLIFE_RESPAWN_INTERVAL_TICKS, damageWildlife, spawnWildlifeAt } from "./wildlife.js";
import {
  TOWN_CENTER_TILE, civilianPopulationUsed, findTownCenterAt, happinessSpeedMultiplier, populationCap,
  productionSpeedMultiplier, respawnWindowAt, respawnWindowSnapshot, settlementKeyNear, spawnColonistForPost, townCenterBonus,
  newPerson, peopleSnapshot, populationCostOf, spawnVillager, settlementStats,
} from "./colonists.js";
import { colonistRole, guardStats, isGuardOrMilitiaKind, isSiegeKind, unitStats } from "./units.js";
import {
  buildingMaxHp, damageBuilding, damageColonist, damageMob, damagePlayer, damageTownCenter,
  damagedBuildingsForSnapshot, isTowerTile, livingTowersNear, structureHp, towerCooldownTicks, updateGates,
} from "./combat.js";
import { raidSiegeCap } from "./siege.js";
import { applyHungerMark, mobBodyRadius, rollMobSize } from "./mobs.js";
import { placementCost, resolveTownCenterPlacement } from "./construction.js";
import { regimentKey } from "./tactics.js";
import { createRaidMob, raidSizeForDay, spawnRaid } from "./raids.js";
import { damageHearth } from "./hearths.js";
import { GOALS, nightsSurvived, refreshGoalSnapshot } from "./goals.js";
import {
  grantRelic, heroKey, heroProfileOf, heroProfileSnapshot, heroSheetsSnapshot, isEquippedKind, pickHeroName,
  playerAttackCooldownTicks, playerMaxHp, spawnHeroColonist,
} from "./heroes.js";
import { grantTome, isSpellId, learnSpell, spellBookSnapshot } from "./spells.js";
import { stepSimulation } from "./sim.js";
import { battleRegimentsForTest } from "./battle.js";
import { broadcastTileUpdate, fightsForPlayer } from "./net.js";
import { tierOf } from "./diplomacy.js";
import { endVassalage, forceTribute, updateVassals, vassalDebugState, vassalsDawn } from "./vassals.js";
import { forceVassal, placeTradingPost, spawnMobAt, spawnRaidGroupAt, spawnSoldierAt, stampSiteSearch } from "./creative.js";
import { forcePostQuest, quests, questsForSnapshot, scanQuests } from "./quests.js";
import { BARN_FARMERS_BY_LEVEL, BARN_FIELD_RADIUS_TILES, FIELDS_PER_FARMER, FOOD_OUTPUT_MULT, FOOD_TIME_MULT, PASTURE_YIELDS } from "@colony/shared/buildings";
import { assignHomes, handleCallVillagers, heirSnapshot, peopleDawnForClan, rescuePrisoners, trainInfo, villageLevyInfo } from "./people.js";
import { calendarDayNow, calendarNow, calendarSnapshot, rainingNow, setCalendar, setWeatherOverride, updateCalendar, winterNow, snowSlowNow, forageRegrowTicksBetween } from "./calendar.js";
import { weatherForDay } from "@colony/shared/calendar";
import { enterInterior, exitInterior, handleInteriorExit, interiorDebug } from "./interiors.js";

export function handleTestHook(player: Player, msg: Record<string, unknown>) {
  const reply = (data: Record<string, unknown>) =>
    player.socket.send(JSON.stringify({ type: "testHookResult", op: msg.op, ...data }));
  if (msg.op === "setCycleTick" && typeof msg.tick === "number") {
    state.cycleTick = Math.max(0, Math.floor(msg.tick));
    state.wasNight = isNightNow();
    reply({ cycleTick: state.cycleTick });
  } else if (msg.op === "raidState") {
    reply({
      cycleTick: state.cycleTick,
      dayTicks: dayTicksAt(),
      nightTicks: GAME_DAY_TICKS - dayTicksAt(),
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
      if (key in state.stock && typeof value === "number") state.stock[key as ResourceKey] = value;
    }
    reply({ stock: { ...state.stock } });
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
        PASTURE_YIELDS,
        BARN_FIELD_RADIUS_TILES,
        BARN_FARMERS_BY_LEVEL,
        FIELDS_PER_FARMER,
        HEMP_GROW_TICKS,
        HEMP_YIELD_PER_HARVEST,
        FOOD_OUTPUT_MULT,
        FOOD_TIME_MULT,
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
      setTile(tileIndex(msg.tx, msg.ty), msg.tile);
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
        setTile(i, t);
        broadcastTileUpdate(x, y, t);
        setOwner(i, t === TileType.Empty ? 0 : num);
        if (t === TileType.Gate) gate = { x, y };
        else if (t === TileType.Tower) tower = { x, y };
        else if (t !== TileType.Empty) walls.push({ x, y });
      }
    }
    reply({ siteId, site: num, gate, tower, walls });
  } else if (msg.op === "stampSite" && typeof msg.template === "string" && msg.template in SITE_TEMPLATES) {
    // Forts phase B: stamp a real fort template ({template: "thornwick" | "grakkar", x0, y0} top-left, or
    // {dx, dy}: its centre that far from the first Town Center; tier?, name?, search? tiles to look around). Clears natural ground (trees,
    // rock, water) in the rectangle + apron; refuses ({site: null, problem}) over buildings / other grounds.
    const t = SITE_TEMPLATES[msg.template as SiteTemplateId];
    const { w, h } = templateSize(t);
    const tc = state.townCenters[0] ?? { x: state.WORLD_TILES_X >> 1, y: state.WORLD_TILES_Y >> 1 };
    const x0 = typeof msg.x0 === "number" ? Math.floor(msg.x0) : tc.x + Math.floor(Number(msg.dx ?? 30)) - (w >> 1);
    const y0 = typeof msg.y0 === "number" ? Math.floor(msg.y0) : tc.y + Math.floor(Number(msg.dy ?? 0)) - (h >> 1);
    // {search: r}: else the nearest fitting top-left within r tiles (rings outward).
    const r = stampSiteSearch(t.id, x0, y0, typeof msg.search === "number" ? Math.floor(msg.search) : 0, {
      tier: typeof msg.tier === "number" ? msg.tier : undefined, name: typeof msg.name === "string" ? msg.name : undefined,
    });
    if (!r.site) reply({ site: null, problem: r.problem, x0: r.x0, y0: r.y0 });
    else reply({ site: { ...r.site } });
  } else if (msg.op === "siteFit" && typeof msg.template === "string" && msg.template in SITE_TEMPLATES) {
    // Dry run of stampSite: {template, x0, y0, search?}: the nearest top-left within `search` tiles where it fits
    // (clearable ground, off other grounds), else the first problem.
    const t = SITE_TEMPLATES[msg.template as SiteTemplateId];
    const x0 = Math.floor(Number(msg.x0)), y0 = Math.floor(Number(msg.y0));
    const search = typeof msg.search === "number" ? Math.min(60, Math.floor(msg.search)) : 0;
    let problem: string | null = null;
    let fit: TileCoord | null = null;
    for (let r = 0; r <= search && !fit; r++) {
      for (let dy = -r; dy <= r && !fit; dy++) {
        for (let dx = -r; dx <= r && !fit; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = siteFitProblem(t, x0 + dx, y0 + dy, true);
          if (!p) fit = { x: x0 + dx, y: y0 + dy };
          else problem ??= p;
        }
      }
    }
    reply(fit ? { x0: fit.x, y0: fit.y, problem: null } : { problem });
  } else if (msg.op === "setWarbands") {
    // Forts phase G: let the dawn timer spawn warbands in this scripted test (off by default with test hooks).
    state.testWarbandsEnabled = msg.enabled === true;
    reply({ enabled: state.testWarbandsEnabled });
  } else if (msg.op === "spawnWarband") {
    // Forts phase G: {faction?: "bandit" | "orc", x0?, y0? (camp top-left), atX?, atY? (spawn tile), size?}.
    const at = typeof msg.atX === "number" && typeof msg.atY === "number" ? { x: Math.floor(msg.atX), y: Math.floor(msg.atY) } : undefined;
    const w = spawnWarband({
      faction: msg.faction === "orc" ? "orc" : msg.faction === "bandit" ? "bandit" : undefined,
      x0: typeof msg.x0 === "number" ? msg.x0 : undefined, y0: typeof msg.y0 === "number" ? msg.y0 : undefined,
      at, size: typeof msg.size === "number" ? msg.size : undefined,
    });
    reply(typeof w === "string" ? { warband: null, problem: w } : { warband: warbandsDebug().warbands.find((b) => b.id === w.id) });
  } else if (msg.op === "warbandsState") {
    reply(warbandsDebug());
  } else if (msg.op === "growSite" && typeof msg.siteId === "string") {
    // Forts phase G: {siteId, days?} ages a founded camp's growth clock by `days` and catches up (lazy growth);
    // {tiers?} lays that many tiers on any fort at once; {found: true} marks any fort a founded camp; {clearedDaysAgo?} backdates a razed camp's cooldown.
    const st = sites.get(msg.siteId);
    if (!st) return reply({ found: false });
    if (msg.found === true) st.founded = true;
    if (typeof msg.days === "number") st.growthTick -= Math.floor(msg.days * GAME_DAY_TICKS);
    const gained = typeof msg.tiers === "number" ? (applySiteTier(st, st.tier + Math.floor(msg.tiers)), Math.floor(msg.tiers)) : catchUpCampGrowth(st);
    if (typeof msg.clearedDaysAgo === "number" && st.clearedTick !== undefined) st.clearedTick = state.cycleTick - Math.floor(msg.clearedDaysAgo * GAME_DAY_TICKS);
    const hearth = hearths.get(st.id);
    reply({ found: true, gained, tier: st.tier, garrisonMax: st.garrisonMax, roster: st.garrisonRoster, keepMaxHp: hearth?.maxHp ?? null, growthTick: st.growthTick, clearedTick: st.clearedTick ?? null });
  } else if (msg.op === "campRaids") {
    // Forts phase G: run the founded camps' raid spawn for clan 0 now (day = this day unless {day}).
    const day = typeof msg.day === "number" ? Math.floor(msg.day) : Math.floor(state.cycleTick / GAME_DAY_TICKS);
    const groups = spawnCampRaids(day);
    reply({ groups: groups.map((g) => ({ id: g.id, faction: g.faction, size: g.memberIds.length, aggroTick: g.aggroTick, kinds: g.memberIds.map((id) => mobs.get(id)?.kind) })) });
  } else if (msg.op === "sitesState") {
    // Forts phase B: every fort with its hearth (keep) and living garrison.
    reply({
      sites: Array.from(sites.values(), (st) => {
        const hearth = hearths.get(st.id);
        const members = Array.from(mobs.values()).filter((m) => m.siteId === st.id);
        return {
          ...st, hearth: hearth ? { hp: hearth.hp, maxHp: hearth.maxHp, destroyed: hearth.destroyed } : null,
          keepTile: state.tiles[tileIndex(st.keepX, st.keepY)],
          // Forts phase C: clan 0's relation hook value and the living cosmetic workers.
          relation: relationOf(0, st.id),
          workerMobs: members.filter((m) => m.siteWorker).map((m) => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, role: m.siteWorker, active: m.guardianActive })),
          // The nearest living player / colonist (Chebyshev tiles from the keep): what keeps it awake.
          nearestUnit: [...Array.from(players.values(), (p) => ({ who: "player", x: p.x, y: p.y, dead: p.dead })), ...Array.from(colonists.values(), (u) => ({ who: u.kind, x: u.x, y: u.y, dead: u.hp <= 0 }))]
            .filter((u) => !u.dead).map((u) => ({ who: u.who, d: Math.round(Math.max(Math.abs(u.x / TILE_SIZE - st.keepX), Math.abs(u.y / TILE_SIZE - st.keepY))) }))
            .sort((a, b) => a.d - b.d)[0] ?? null,
          alive: members.map((m) => ({ id: m.id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, active: m.guardianActive, postX: m.postX, postY: m.postY, target: m.targetType })),
        };
      }),
      grounds: state.siteGrounds.reduce((n, v) => n + v, 0),
      worldSize: state.WORLD_TILES_X,
    });
  } else if (msg.op === "diploSet" && typeof msg.siteId === "string") {
    // Forts phase D: set a clan's relation (adjustRelation: tier toasts / vassal flag apply) and / or a
    // settlement's stock entries; replies with the relation, tier and the site's diplo record.
    const st = sites.get(msg.siteId);
    const clan = typeof msg.clan === "number" ? msg.clan : 0;
    if (st && typeof msg.relation === "number") adjustRelation(clan, st.id, msg.relation - relationOf(clan, st.id));
    if (st && msg.stock && typeof msg.stock === "object") for (const [k, v] of Object.entries(msg.stock as Record<string, unknown>)) if (typeof v === "number") st.stock[k as ResourceKey] = v;
    reply({ found: !!st, relation: st ? relationOf(clan, st.id) : null, tier: st ? tierOf(clan, st) : null, diplo: st?.diplo?.[clan] ?? null, stock: st ? { ...st.stock } : null });
  } else if (msg.op === "questPost" && typeof msg.siteId === "string" && typeof msg.kind === "string") {
    // Forts phase D2: post a quest of kind defend / clearCamp / deliver from the settlement to clan (default 0)
    // now, ignoring chance, cooldown and the per-settlement cap (still refused by a Hostile / fallen one).
    const r = forcePostQuest(msg.siteId, typeof msg.clan === "number" ? msg.clan : 0, msg.kind as "defend" | "clearCamp" | "deliver");
    reply(typeof r === "string" ? { quest: null, problem: r } : { quest: { ...r } });
  } else if (msg.op === "questScan") {
    // Forts phase D2: one posting scan with every roll succeeding and no cooldown (the other rules apply).
    reply({ posted: scanQuests(true).map((q) => ({ ...q })) });
  } else if (msg.op === "questState") {
    // Forts phase D2: every open quest (raw) + clan's snapshot list; {id, expiresTick?} edits one first.
    const q = quests.find((o) => o.id === msg.id);
    if (q && typeof msg.expiresTick === "number") q.expiresTick = msg.expiresTick;
    reply({ quests: quests.map((o) => ({ ...o })), snapshot: questsForSnapshot(typeof msg.clan === "number" ? msg.clan : 0), cycleTick: state.cycleTick });
  } else if (msg.op === "wagonPost" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // Forts phase E: put a Trading Post at (tx, ty) (rule-free, like setTileRaw) at level (default 1), register it
    // now and look after it once (roster + wagon); auto (optional) sets auto-send. Replies wagonState.
    placeTradingPost(msg.tx, msg.ty, typeof msg.level === "number" ? msg.level : 1, msg.auto);
    reply({ posts: wagonDebugState() });
  } else if (msg.op === "wagonSend" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // Forts phase E: send the post's wagon now (dest id or "auto"), ignoring the time of day check's trip cap.
    const why = withClan(clanById(clanIdAt(msg.tx, msg.ty)), () => sendWagon(resourceKey(msg.tx as number, msg.ty as number), typeof msg.dest === "string" ? msg.dest : "auto", true, true));
    reply({ problem: why, posts: wagonDebugState() });
  } else if (msg.op === "wagonRecall" && typeof msg.id === "string") {
    const w = colonists.get(msg.id);
    reply({ ok: !!w && recallWagon(w), posts: wagonDebugState() });
  } else if (msg.op === "vassalSet" && typeof msg.siteId === "string") {
    // Forts phase F: {siteId, clan?, relation?} sets the relation (adjustRelation: 100 vassalises when strong
    // enough); vassal: true forces vassalOf = clan (no power check), false ends it; tax: bool sets tribute
    // without the power check; nextTaxDay / levyCooldownUntilTick / levyUntilTick overwrite those numbers;
    // collect: true takes one tribute now (no power check); dawn: true runs the dawn pass (vassalsDawn) now; tick: true runs updateVassals once. Replies vassalState.
    const st = sites.get(msg.siteId);
    const clan = typeof msg.clan === "number" ? msg.clan : 0;
    if (st) {
      if (typeof msg.relation === "number") adjustRelation(clan, st.id, msg.relation - relationOf(clan, st.id));
      if (msg.vassal === true) forceVassal(st, clan, true);
      else if (msg.vassal === false) endVassalage(st, "test hook");
      if (st.vassal) {
        if (typeof msg.tax === "boolean") st.vassal.tax = msg.tax;
        for (const k of ["nextTaxDay", "levyCooldownUntilTick", "levyUntilTick"] as const) if (typeof msg[k] === "number") st.vassal[k] = msg[k] as number;
      }
      if (msg.collect === true) forceTribute(st);
      if (msg.dawn === true) vassalsDawn();
      if (msg.tick === true) updateVassals();
    }
    reply(st ? { found: true, relation: relationOf(clan, st.id), tier: tierOf(clan, st), stock: { ...st.stock }, ...vassalDebugState(st, clan), cycleTick: state.cycleTick } : { found: false });
  } else if (msg.op === "wagonState") {
    reply({ posts: wagonDebugState(), cycleTick: state.cycleTick });
  } else if (msg.op === "siteSet" && typeof msg.siteId === "string") {
    // Forts phase B: overwrite numeric SiteState fields (lastSimTick to fake a long sleep, kiteHits, ...).
    const st = sites.get(msg.siteId);
    if (st) for (const [k, v] of Object.entries(msg.fields ?? {})) if (typeof v === "number" && typeof (st as unknown as Record<string, unknown>)[k] !== "object") (st as unknown as Record<string, unknown>)[k] = v;
    reply({ found: !!st });
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
    const mob = spawnMobAt(msg.kind, msg.tx, msg.ty, { mark: msg.mark, boss: msg.boss, regimentId: msg.regimentId, siteId: msg.siteId });
    if (!mob) reply({ id: null });
    else reply({ id: mob.id, mark: mob.mark, hp: mob.hp, maxHp: mob.maxHp, damage: mob.damage, scale: mob.scale ?? 1, speed: mob.speed, range: mob.range, bodyRadius: mobBodyRadius(mob) });
  } else if (msg.op === "spawnRaidGroup" && Array.isArray(msg.kinds) && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // A raid group already in contact (engaged now): member i is on row i, so the rows release one by
    // one (RAID_RELEASE_ROW_TICKS apart) and some are still in the group early on.
    const group = spawnRaidGroupAt(msg.kinds as unknown[], msg.tx, msg.ty);
    reply({ id: group.id, memberIds: group.memberIds });
  } else if (msg.op === "forceRaidSiege") {
    // Cavalry & siege: raids pick orc / bandit factions and take their siege engines first (up to the caps).
    state.testForceRaidSiege = msg.value === true;
    reply({ value: state.testForceRaidSiege });
  } else if (msg.op === "raidSize" && typeof msg.dayIndex === "number") {
    // Village life phase 4: tonight's raid size for a day (population- and tier-scaled), for the player's clan.
    reply({ size: withClan(clanById(player.clan ?? 0), () => raidSizeForDay(Math.max(0, Math.floor(msg.dayIndex as number)))) });
  } else if (msg.op === "spawnRaidNow" && typeof msg.dayIndex === "number") {
    const size = raidSizeForDay(Math.max(0, Math.floor(msg.dayIndex)));
    spawnRaid(Math.max(0, Math.floor(msg.dayIndex)));
    reply({ size, groups: raidGroups.size, caps: Object.fromEntries(SIEGE_KINDS.map((k) => [k, raidSiegeCap(Math.floor(msg.dayIndex as number), k)])) });
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
      stock: { ...state.stock },
    });
  } else if (msg.op === "setRegimentWalled" && typeof msg.id === "string") {
    if (msg.value === false) walledSites.delete(msg.id);
    else walledSites.add(msg.id);
    reply({ walled: walledSites.has(msg.id) });
  } else if (msg.op === "tacticsConfig") {
    state.testMoraleFrozen = msg.freezeMorale === true;
    reply({ freezeMorale: state.testMoraleFrozen });
  } else if (msg.op === "tacticsState") {
    // Battle engine phase 5: setMorale {regimentKey: value} forces a mob regiment's morale first.
    if (msg.setMorale && typeof msg.setMorale === "object") {
      for (const [id, v] of Object.entries(msg.setMorale as Record<string, unknown>)) {
        const reg = regiments.get(id);
        if (reg && typeof v === "number") reg.morale = Math.max(0, Math.min(MORALE_MAX, v));
      }
    }
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
    // Stardew phase 5c: a teleport is always to the world.
    player.interior = undefined;
    player.x = msg.x;
    player.y = msg.y;
    reply({ x: player.x, y: player.y });
  } else if (msg.op === "damagePlayer" && typeof msg.amount === "number") {
    damagePlayer(player, msg.amount);
    reply({ hp: player.hp, dead: player.dead });
  } else if (msg.op === "heroLife") {
    // Solo hero: `needs` true / false / null (= the default rule) overrides needs; food / rest / pack / skills set
    // them; `interact` / `choice` / `stop` / `action` (+ build) act as the messages; replies the life + talk state.
    if ("needs" in msg) setNeedsOverride(typeof msg.needs === "boolean" ? msg.needs : null);
    withClan(clanOf(player), () => {
      const life = lifeOf(player);
      if (typeof msg.food === "number") life.food = msg.food;
      if (typeof msg.rest === "number") life.rest = msg.rest;
      // Stardew phase 5a: energy / water set them; `use` {tool, tx, ty, crop} = the heroTool message, `interactWith`
      // {tool?, tx, ty, crop?} = interact with a tool in hand.
      if (typeof msg.energy === "number") life.energy = msg.energy;
      if (typeof msg.water === "number") life.water = msg.water;
      if (msg.pack && typeof msg.pack === "object") life.pack = { ...(msg.pack as Record<string, number>) };
      if (msg.skills && typeof msg.skills === "object") life.skills = { ...(msg.skills as Record<string, number>) };
      if (msg.flagsClear === true) life.flags = {};
      // Family: `flags` merges NPC flags (e.g. courtship points); `tpPriest` stands the hero on the nearest
      // settlement priest; `familyReset` makes the hero single again.
      if (msg.flags && typeof msg.flags === "object") Object.assign(life.flags, msg.flags as Record<string, number>);
      if (msg.familyReset === true) life.family = { selfId: `hero-test-${state.cycleTick}-${Math.floor(Math.random() * 1e6)}`, gen: 1 };
      // `growChildren`: the hero's children come of age now; `spouseKin` (site id): the spouse married in from there.
      if (msg.growChildren === true) for (const k of childrenOf(player)) Object.assign(k.person!, { child: false, born: state.cycleTick - 7 * GAME_DAY_TICKS });
      if (typeof msg.spouseKin === "string") {
        const sp = spouseOf(player);
        if (sp) sp.person!.kinOf = msg.spouseKin;
        if (life.family) life.family.spouseKin = msg.spouseKin;
      }
      if (msg.tpPriest === true || msg.tpPriest === "keep") {
        // The priest farthest from its keep (so the Elder is not the nearer NPC).
        const fromKeep = (m: { x: number; y: number; siteId?: string | null }) => {
          const s = sites.get(m.siteId ?? "");
          return s ? Math.hypot(m.x / TILE_SIZE - s.keepX, m.y / TILE_SIZE - s.keepY) : 0;
        };
        const pr = Array.from(mobs.values()).filter((m) => m.siteWorker === "priest").sort((a, b) => fromKeep(b) - fromKeep(a))[0];
        const ps = pr ? sites.get(pr.siteId ?? "") : undefined;
        // Too close to the keep: step the priest out to 6 tiles from it (the Elder would answer first).
        if (pr && ps && fromKeep(pr) < 6) {
          const kx = (ps.keepX + 0.5) * TILE_SIZE, ky = (ps.keepY + 0.5) * TILE_SIZE;
          const d = Math.max(1, Math.hypot(pr.x - kx, pr.y - ky));
          Object.assign(pr, { x: kx + ((pr.x - kx) / d) * 6 * TILE_SIZE, y: ky + ((pr.y - ky) / d || 1) * 6 * TILE_SIZE });
        }
        // Phase 6 (priest-talk fix): `tpPriest: "keep"` stands the priest 1.2 tiles from its keep (the side farthest
        // from the other NPCs) and the hero 0.3 tiles beyond it, so the priest is the nearest NPC though the Elder (the
        // keep) is in range too.
        if (pr && ps && msg.tpPriest === "keep") {
          const kx = (ps.keepX + 0.5) * TILE_SIZE, ky = (ps.keepY + 0.5) * TILE_SIZE;
          const others = Array.from(mobs.values()).filter((m) => m !== pr && m.siteWorker);
          const clear = ([dx, dy]: number[]) => Math.min(1e9, ...others.map((m) => Math.hypot(m.x - kx - dx * 1.5 * TILE_SIZE, m.y - ky - dy * 1.5 * TILE_SIZE)));
          const [dx, dy] = [[0, 1], [1, 0], [0, -1], [-1, 0]].sort((a, b) => clear(b) - clear(a))[0];
          Object.assign(pr, { x: kx + dx * 1.2 * TILE_SIZE, y: ky + dy * 1.2 * TILE_SIZE, path: [] });
          Object.assign(player, { x: kx + dx * 1.5 * TILE_SIZE, y: ky + dy * 1.5 * TILE_SIZE });
        } else if (pr) Object.assign(player, { x: pr.x, y: pr.y });
      }
      if (msg.interact === true) handleInteract(player);
      if (msg.interactWith && typeof msg.interactWith === "object") handleInteract(player, msg.interactWith as Record<string, unknown>);
      if (msg.use && typeof msg.use === "object") handleHeroTool(player, msg.use as Record<string, unknown>);
      if (typeof msg.choice === "number") handleDialogueChoice(player, msg.choice);
      if (msg.stop === true) handleGatherStop(player);
      if (typeof msg.action === "string") handleHeroAction(player, msg.action, msg.build);
    });
    reply(heroLifeDebug(player));
  } else if (msg.op === "heroDeath") {
    // Village life phase 5: `legacy` sets the old instant-respawn rule (COLONY_HERO_RESPAWN); `clan` moves this player
    // to that clan id (e.g. one with nobody in it, for game over); `revive` brings a dead player back where it lies.
    if (typeof msg.legacy === "boolean") state.legacyHeroRespawn = msg.legacy;
    if (typeof msg.clan === "number") player.clan = msg.clan;
    if (msg.revive === true) {
      player.dead = false;
      player.heirPending = false;
      player.hp = playerMaxHp(player);
    }
    reply({ legacy: state.legacyHeroRespawn, dead: player.dead, heirPending: !!player.heirPending, hp: player.hp, x: player.x, y: player.y, heirs: heirSnapshot(player.clan ?? 0) });
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
      // World streaming phase 4 benchmarks: resident set / heap of this process.
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      // Battle engine phase 1: average ms per tick by system (sim systems per sim step, snapshot per send).
      systems: Object.fromEntries(Array.from(systemMs, ([k, v]) => [k, Math.round((v / Math.max(1, sorted.length)) * 100) / 100])),
    });
    if (msg.reset) {
      tickDurationsMs.length = 0;
      systemMs.clear();
    }
  } else if (msg.op === "battleRegiments") {
    // Battle engine phase 1: the regiment store (state, order, anchor, strength, morale, target, member count).
    reply({ regiments: battleRegimentsForTest() });
  } else if (msg.op === "chunkState") {
    // World streaming phase 2: chunk state counts (force re-classifies now) and the state at {x, y} (pixels).
    // {reset: true}: forget every chunk's state (no hysteresis / grace left over) and classify afresh from the anchors.
    if (msg.reset) resetChunkStates();
    if (msg.force || msg.reset) updateChunkStates(true);
    const at = typeof msg.x === "number" && typeof msg.y === "number" ? chunkStateAtPixel(msg.x, msg.y) : null;
    // Phase 3: `list` adds the COLD chunk ids.
    const sum = chunkStateSummary();
    const coldList = msg.list ? Array.from({ length: sum.chunksX * sum.chunksY }, (_, i) => i).filter((i) => chunkStateOf(i) === 0) : undefined;
    reply({ ...sum, at, coldList });
  } else if (msg.op === "wagonAbstractRadius" && typeof msg.far === "number" && typeof msg.near === "number") {
    // World streaming phase 3: far wagon convoys go abstract past `far` tiles from everyone, real within `near`.
    setWagonAbstractRadius(msg.far, msg.near);
    reply({ far: msg.far, near: msg.near });
  } else if (msg.op === "strifeDawn") {
    // World streaming phase 5: one dawn of abstract strife now ({forceRaid, forceSiege, forceFall}).
    strifeDawn({ forceRaid: !!msg.forceRaid, forceSiege: !!msg.forceSiege, forceFall: !!msg.forceFall });
    reply({ stats: { ...strifeStats }, threats: [...sites.values()].filter((s) => s.threat).map((s) => ({ id: s.id, ...s.threat })), quests: quests.filter((q) => q.help).map((q) => ({ id: q.id, siteId: q.siteId, targetId: q.targetId, clan: q.clan })), cleared: [...sites.values()].filter((s) => s.faction === "human" && s.cleared).map((s) => s.id) });
  } else if (msg.op === "chronicle") {
    // World streaming phase 5: the chronicle as saved.
    reply({ entries: chronicleEntries() });
  } else if (msg.op === "dropBaseCache") {
    // World streaming phase 4: forget the base layer (memory + cache files): the next diff load regenerates it.
    void dropBaseCache().then(() => reply({ ok: true }));
  } else if (msg.op === "writeFullSave" && typeof msg.slot === "string" && isSaveSlot(msg.slot)) {
    // World streaming phase 4: a save in the old full-array format (the migration path's input).
    const slot = msg.slot;
    void fsp.mkdir(SAVE_DIR, { recursive: true })
      .then(() => fsp.writeFile(savePath(slot), JSON.stringify(saveFileFor(slot, null))))
      .then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
  } else if (msg.op === "tileHash") {
    // World streaming phase 4: FNV of tiles / biomes / explored, to compare a world across save -> load.
    const h = (a: Uint8Array) => { let x = 0x811c9dc5; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ a[i], 0x01000193); return x >>> 0; };
    reply({ tiles: h(state.tiles), biomes: h(state.biomes), explored: h(state.explored), seed: currentWorldSeed() });
  } else if (msg.op === "auditWorld") {
    // World streaming phase 3: no duplicated / vanished entities across live and abstract forms.
    reply(auditWorld());
  } else if (msg.op === "auditRegistry") {
    // World streaming phase 1: registry vs a fresh full scan (0 = consistent) and the path cache counters.
    reply({ bad: auditTileRegistry(), pathHits: pathCacheStats.hits, pathMisses: pathCacheStats.misses, pathMismatches: pathCacheStats.mismatches });
  } else if (msg.op === "spawnSoldier" && typeof msg.kind === "string" && typeof msg.x === "number" && typeof msg.y === "number") {
    // A soldier standing at pixel (x, y) with its rally slot there (post = that tile; no building).
    // Clans: the soldier is the requesting player's clan's. Heroes: the spawnHero hook.
    const c = msg.kind === "hero" ? null : spawnSoldierAt(msg.kind as ColonistKind, msg.x, msg.y, player.clan, { stance: msg.stance });
    reply({ id: c?.id ?? null });
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
      equipment: { armour: [...state.equipment.armour], weapon: [...state.equipment.weapon] },
      forges: Array.from(forgeQueues, ([key, f]) => ({ key, queue: f.queue.map((q) => ({ ...q })), ticksLeft: f.ticksLeft })),
      forgeAuto: Array.from(forgeAuto),
      units: Array.from(colonists.values())
        .filter((c) => isEquippedKind(c.kind))
        .map((c) => ({ id: c.id, kind: c.kind, hp: c.hp, maxHp: c.maxHp, armourTier: c.armourTier ?? 0, weaponTier: c.weaponTier ?? 0, postX: c.postX, postY: c.postY })),
      events: equipEvents.slice(),
      stock: { ...state.stock },
      mults: { weapon: WEAPON_DAMAGE_MULT, armour: ARMOUR_DAMAGE_TAKEN_MULT },
    });
  } else if (msg.op === "setEquipment") {
    for (const slot of ["armour", "weapon"] as EquipSlot[]) {
      const v = (msg as Record<string, unknown>)[slot];
      if (Array.isArray(v)) state.equipment[slot] = [0, 1, 2].map((i) => (typeof v[i] === "number" ? v[i] : 0));
    }
    reply({ equipment: { armour: [...state.equipment.armour], weapon: [...state.equipment.weapon] } });
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
      gold: state.stock.gold,
      events: heroEvents.filter((e) => e.key?.startsWith(HERO_KEY_PREFIX)),
    });
  } else if (msg.op === "spellState") {
    // Hero phase 4: this player's / every hero's spell book, statuses, summons, recent spell events.
    reply({
      spellTick: state.spellTick,
      player: { key: player.profileKey, ...spellBookSnapshot(heroProfileOf(player)), castXp: heroProfileOf(player).life?.skills.spellcasting ?? 0, spellPowerMult: heroProfileOf(player).stats.spellPowerMult, hp: player.hp, maxHp: playerMaxHp(player), x: player.x, y: player.y, id: player.id },
      heroes: Array.from(heroProfiles.values()).filter((p) => p.heroClass).map((p) => ({ key: p.key, level: p.level, spellPowerMult: p.stats.spellPowerMult, castXp: p.life?.skills.spellcasting ?? 0, ...spellBookSnapshot(p) })),
      statuses: Object.fromEntries(spellStatuses),
      summons: Array.from(summonedUntil, ([id, until]) => ({ id, until, alive: colonists.has(id) })),
      population: civilianPopulationUsed(),
      gold: state.stock.gold,
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
  } else if (msg.op === "gearPickupConfig") {
    // Gear pickup (idle soldiers re-arm from the stock): enabled false switches it off for scripted checks.
    state.testGearPickupOff = msg.enabled === false;
    reply({ enabled: !state.testGearPickupOff });
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
    // asPlayer: struck by the requesting player (the guards rule applies), else the test bypass.
    if (h) damageHearth(h, msg.amount, msg.asPlayer === true ? `p:${player.id}` : "test");
    reply({ found: !!h, hp: h?.hp ?? null, destroyed: h?.destroyed ?? null });
  } else if (msg.op === "setGoalIndex" && typeof msg.index === "number") {
    // Skip (or rewind) the goal track without paying rewards: exact stock checks after a first building /
    // worker / soldier otherwise see the early goals' payouts (index 3 = past "Arm a unit").
    state.goalIndex = Math.max(0, Math.min(GOALS.length, Math.floor(msg.index)));
    refreshGoalSnapshot();
    reply({ goalIndex: state.goalIndex });
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
      stock: { ...state.stock },
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
      stock: { ...state.stock },
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
  } else if (msg.op === "peopleState") {
    // Village life: optionally flip creative mode (to test the real people rules in a creative world) and/or add
    // free villagers (`spawn`, children with `child: true`) at the first Town Center; then the people summary.
    if (typeof msg.creative === "boolean") state.creative = msg.creative;
    // `clear`: every unit that takes population (any clan) is removed outright, and the open posts with them.
    if (msg.clear === true) {
      for (const c of Array.from(colonists.values())) if (populationCostOf(c) > 0) colonists.delete(c.id);
      for (let i = respawnQueue.length - 1; i >= 0; i--) if (!respawnQueue[i].hero) respawnQueue.splice(i, 1);
    }
    const tc = state.townCenters.find((t) => (t.clan ?? 0) === (player.clan ?? 0));
    const n = Math.max(0, Math.min(50, Math.floor(Number(msg.spawn) || 0)));
    for (let i = 0; tc && i < n; i++) {
      const p = newPerson("immigrant", msg.child === true ? state.cycleTick : undefined);
      if (msg.child === true) p.child = true;
      withClan(clanById(player.clan ?? 0), () => spawnVillager(tc, p));
    }
    // `dawn` runs the clan's dawn pass with forced dice ({ birth, immigrant }); `rescueAt` frees a camp's prisoners
    // at a tile; `finishTraining` ends every training next tick; `trainAt` returns that building's trainInfo.
    const pc = clanById(player.clan ?? 0);
    if (msg.dawn && typeof msg.dawn === "object") withClan(pc, () => peopleDawnForClan(msg.dawn as { birth?: boolean; immigrant?: boolean; heroBirth?: boolean }));
    if (msg.rescueAt && typeof msg.rescueAt === "object") {
      const r = msg.rescueAt as { x: number; y: number };
      rescuePrisoners({ siteId: "", siteKind: "encampment", x: r.x, y: r.y } as unknown as import("./types.js").HearthState, `p:${player.id}`);
    }
    if (msg.finishTraining === true) for (const c of colonists.values()) if (c.training) c.training.ticksLeft = 1;
    // Phase 4: `levyAt` {x, y, dismiss?} presses a Town Center's Call to arms / Stand down; `levyExpire` ends every
    // levy at the next once-a-second pass.
    const la = msg.levyAt as { x: number; y: number; dismiss?: boolean } | undefined;
    if (la) handleCallVillagers(player, la.x, la.y, la.dismiss === true);
    if (msg.levyExpire === true) for (const c of colonists.values()) if (c.callUp) c.callUp.untilTick = state.cycleTick;
    const ta = msg.trainAt as { x: number; y: number } | undefined;
    reply({
      trainInfo: ta ? withClan(pc, () => trainInfo(ta.x, ta.y)) : null,
      levyInfo: la ? withClan(pc, () => villageLevyInfo(la.x, la.y)) : null,
      creative: state.creative,
      people: withClan(clanById(player.clan ?? 0), () => peopleSnapshot()),
      population: civilianPopulationUsed(),
      cap: populationCap(),
      vacancies: respawnQueue.filter((q) => !q.hero).map((q) => ({ ...q })),
      persons: Array.from(colonists.values())
        .filter((c) => c.person)
        .map((c) => ({ id: c.id, kind: c.kind, name: c.person!.name, child: !!c.person!.child, born: c.person!.born, parents: c.person!.parents ?? [], origin: c.person!.origin, spouse: c.person!.spouse ?? null, partner: c.person!.partner ?? null, lastBirthTick: c.person!.lastBirthTick ?? null, kinOf: c.person!.kinOf ?? null, talent: c.person!.talent ?? null, training: c.training ?? null, postX: c.postX, postY: c.postY, hp: c.hp })),
    });
  } else if (msg.op === "progression") {
    // Progression tree: `unlockAll` sets the test-only unlock (COLONY_UNLOCK_ALL); `creativeUnlockAll` the creative
    // toggle; `reset` = a new game's tree (starter kit, nothing unlocked); `items` {id: n} adds items at `quality`.
    const pc = clanById(player.clan ?? 0);
    if (typeof msg.unlockAll === "boolean") state.testUnlockAll = msg.unlockAll;
    if (typeof msg.creativeUnlockAll === "boolean") state.creativeUnlockAll = msg.creativeUnlockAll;
    if (msg.reset === true) pc.progress = newClanProgress();
    // `grandfather`: what a load of a save from before the tree does (every owned gated type stays unlocked).
    if (msg.grandfather === true) restoreProgress(pc, undefined);
    // `xpAt` {x, y, xp}: every worker posted there gets `xp` in its profession (phase 2).
    const xa = msg.xpAt as { x: number; y: number; xp: number } | undefined;
    if (xa) {
      for (const c of colonists.values()) {
        const prof = c.postX === xa.x && c.postY === xa.y && c.person ? professionOf(c) : undefined;
        if (prof) (c.person!.xp ??= {})[prof] = Number(xa.xp) || 0;
      }
    }
    const items = (msg.items ?? {}) as Record<string, number>;
    withClan(pc, () => {
      // A negative count takes that many (poorest grade first; all of them when short).
      for (const [id, n] of Object.entries(items)) {
        if (!(id in PROGRESSION.items)) continue;
        const k = Number(n) || 0;
        if (k >= 0) addItem(id as ItemId, k, Number(msg.quality) || 1);
        else takeItem(id as ItemId, Math.min(-k, itemCount(id as ItemId)));
      }
    });
    resetProgressCache();
    reply(withClan(pc, () => ({ ...progressionDebug(), snapshot: progressionSnapshot() })));
  } else if (msg.op === "structureState") {
    // Modular building phase 1: rooms (roofed areas), whether given tiles are roofed, settlement housing, and
    // optional path probes [{from: {x, y}, to: {x, y}, hostile}] (friendly units path through doors, mobs do not).
    const W = state.WORLD_TILES_X;
    const at = (Array.isArray(msg.at) ? msg.at : []) as { x: number; y: number }[];
    const probes = (Array.isArray(msg.paths) ? msg.paths : []) as { from: TileCoord; to: TileCoord; hostile?: boolean }[];
    reply({
      rooms: allRooms().map((r) => ({ size: r.tiles.length, beds: r.beds.map((i) => ({ x: i % W, y: Math.floor(i / W) })), stone: r.stone, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })),
      roofed: at.map((p) => isRoofed(p.x, p.y)),
      tiles: at.map((p) => (inBounds(p.x, p.y) ? state.tiles[tileIndex(p.x, p.y)] : -1)),
      settlements: settlementStats().map((st) => ({ x: st.tc.x, y: st.tc.y, cap: st.cap, housingCap: st.housingCap, used: st.used, tierCap: st.tierCap })),
      populationCap: populationCap(),
      homes: Array.from(colonists.values()).filter((c) => c.person && c.person.homeX >= 0).map((c) => ({ id: c.id, x: c.person!.homeX, y: c.person!.homeY })),
      paths: probes.map((p) => {
        const prev = state.hostileMover;
        state.hostileMover = !!p.hostile;
        try {
          const path = findPath(p.from, p.to);
          return path ? path.length : null;
        } finally {
          state.hostileMover = prev;
        }
      }),
      sites: Array.from(constructionSites.values()).map((site) => ({ x: site.tx, y: site.ty, target: site.target, priority: !!site.priority, paid: site.paid ?? null })),
    });
  } else if (msg.op === "roomState") {
    // Modular building phase 2: room records (role, stats, dirt), the recompute counters, effects at given tiles
    // [{x, y}] and the clan's happiness parts. setDirt {x, y, dirt}: set the dirt of the room at (x, y); tickRooms:
    // run the once-a-second room update now.
    if (msg.fullRecompute) forceFullRoomRecompute();
    const home = msg.setHome as { id?: string; x: number; y: number } | undefined;
    if (home) {
      const who = home.id ? colonists.get(home.id) : Array.from(colonists.values()).find((c) => c.person && !c.person.child && (c.clan ?? 0) === 0);
      if (who?.person) {
        who.person.homeX = home.x;
        who.person.homeY = home.y;
      }
    }
    const sd = msg.setDirt as { x: number; y: number; dirt: number } | undefined;
    if (sd) setRoomDirtAt(sd.x, sd.y, sd.dirt);
    // Gap closure G1: hallGathered n (clan 0's dusk gathering), herbs n (added to clan 0's stores), spoil (run the
    // daily spoilage now), theftAt {x, y} (bandits wrecked a building there), patient {x, y, hpFrac} (a clan-0
    // villager put there hurt; its HP is replied after any tickRooms).
    if (typeof msg.hallGathered === "number") setHallGathered(0, msg.hallGathered);
    if (typeof msg.herbs === "number") withClan(clanById(0), () => addItem("herbs", msg.herbs as number));
    const spoiled = msg.spoil ? spoilFood(0) : undefined;
    const ta = msg.theftAt as { x: number; y: number } | undefined;
    const stolen = ta ? raidTheft(ta.x, ta.y) : undefined;
    const pt = msg.patient as { x: number; y: number; hpFrac: number; id?: string } | undefined;
    const patient = pt ? (pt.id ? colonists.get(pt.id) : Array.from(colonists.values()).find((c) => c.kind === "villager" && c.person && !c.person.child && (c.clan ?? 0) === 0)) : undefined;
    if (pt && patient) {
      patient.x = pt.x * TILE_SIZE + 16;
      patient.y = pt.y * TILE_SIZE + 16;
      patient.path = [];
      patient.hp = Math.max(1, patient.maxHp * pt.hpFrac);
    }
    if (msg.tickRooms) {
      const t = state.cycleTick;
      state.cycleTick = Math.ceil(t / 20) * 20;
      updateRooms();
      state.cycleTick = t;
    }
    const at = (Array.isArray(msg.at) ? msg.at : []) as { x: number; y: number }[];
    const W = state.WORLD_TILES_X;
    reply({
      rooms: allRooms().map((r) => ({ id: r.id, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, tiles: r.tiles.length, dirt: r.dirt, counts: r.counts, ...r.stats })),
      recompute: { ...roomRecomputeStats },
      at: at.map((p) => ({
        info: roomInfoAt(p.x, p.y),
        workshop: workshopEffectAt(p.x, p.y),
        heroRest: heroRestMultAt(p.x * TILE_SIZE + 16, p.y * TILE_SIZE + 16),
        sleep: sleepQualityAt(p.x, p.y),
        infirmaryRate: infirmaryHealRateAt(p.x * TILE_SIZE + 16, p.y * TILE_SIZE + 16),
        heroHeal: heroInfirmaryHealMult(p.x * TILE_SIZE + 16, p.y * TILE_SIZE + 16),
        chapelHeal: chapelHealMultAt(p.x, p.y),
        tile: state.tiles[p.y * W + p.x],
      })),
      storeroomProtection: storeroomProtectionOf(0),
      hallShare: hallGatherShare(0),
      reviveMult: chapelReviveMult(0),
      infirmary: { ...infirmaryStats },
      herbs: withClan(clanById(0), () => itemCount("herbs")),
      usableBeds: usableBedIndices().length,
      stock: { ...clanById(0).stock },
      ...(spoiled ? { spoiled } : {}),
      ...(stolen ? { stolen } : {}),
      ...(patient ? { patient: { id: patient.id, hp: patient.hp, maxHp: patient.maxHp } } : {}),
      happiness: state.colonyHappiness,
      happinessNow: computeColonyHappiness(),
      roomHappiness: roomHappinessBonus(),
      barracksMorale: barracksMoraleMult(0),
      homes: Array.from(colonists.values()).filter((c) => c.person && c.person.homeX >= 0 && state.tiles[c.person.homeY * W + c.person.homeX] === TileType.Bed).map((c) => ({ id: c.id, x: c.person!.homeX, y: c.person!.homeY })),
    });
  } else if (msg.op === "calendar") {
    // Stardew phase 5b: off (bool: seasons off / on), set {season?, day?, year?}, weather (kind | "auto"), salt (the
    // world salt), update (run updateCalendar now). Replies the snapshot, the offset, the day's spell and the next
    // `forecast` days' spells (deterministic checks).
    if (typeof msg.off === "boolean") state.seasonsOff = msg.off;
    if (typeof msg.salt === "number") state.worldNoiseSalt = msg.salt;
    const st = msg.set as { season?: number; day?: number; year?: number } | undefined;
    if (st) setCalendar(st.season, st.day, st.year);
    if (typeof msg.weather === "string") setWeatherOverride(msg.weather === "auto" ? null : msg.weather);
    if (msg.update) updateCalendar();
    // Gap closure G4: refresh the snow flag now (updateCalendar does it once a second); speedAt {x, y} (pixels): the
    // terrain / snow move-speed factor there; forageBetween [from, to]: winter-aware forage regrowth ticks.
    setSnowSlow(snowSlowNow());
    const sa = msg.speedAt as { x?: unknown; y?: unknown } | undefined;
    const fb = msg.forageBetween as unknown;
    const today = calendarDayNow();
    const n = Math.max(0, Math.min(400, Number(msg.forecast) || 0));
    reply({
      calendar: calendarSnapshot(),
      date: calendarNow(),
      offset: state.calendarOffset,
      lastDay: state.calendarLastDay,
      salt: state.worldNoiseSalt,
      today: weatherForDay(state.worldNoiseSalt, today),
      forecast: Array.from({ length: n }, (_, k) => weatherForDay(state.worldNoiseSalt, k)),
      winter: winterNow(),
      raining: rainingNow(),
      // Gap closure G4: today's daylight / night ticks and whether snow slows units now.
      dayTicks: dayTicksAt(),
      nightTicks: GAME_DAY_TICKS - dayTicksAt(),
      isNight: isNightNow(),
      snowSlow: snowSlowNow(),
      ...(sa && typeof sa.x === "number" && typeof sa.y === "number" ? { speed: biomeSpeedMultiplier(sa.x, sa.y) } : {}),
      ...(Array.isArray(fb) && fb.length === 2 ? { forage: forageRegrowTicksBetween(Number(fb[0]), Number(fb[1])) } : {}),
      happiness: state.colonyHappiness,
    });
  } else if (msg.op === "zoneState") {
    // Modular building phase 3: zones, crop stage counts, piles, jobs and the stock; setCrops {stage, tended, zoneId?}
    // sets every crop of a growing zone (or all); tickZones: run the once-a-second crop update now; freeVillagers:
    // how many free villagers (zone workers) there are.
    const sc = msg.setCrops as { stage: number; tended?: boolean; zoneId?: number } | undefined;
    if (sc) debugSetCrops(sc.stage, !!sc.tended, sc.zoneId);
    // Stardew phase 5a: setCropAt {x, y, stage?, progress?, tended?} sets one crop tile.
    const ca = msg.setCropAt as { x: number; y: number; stage?: number; progress?: number; tended?: boolean } | undefined;
    if (ca && Number.isInteger(ca.x) && Number.isInteger(ca.y)) debugSetCropAt(ca.y * state.WORLD_TILES_X + ca.x, ca);
    // Gap closure G2: addPile {x, y, res, n} drops loose goods (the player's clan's).
    const ap = msg.addPile as { x: number; y: number; res: string; n: number } | undefined;
    if (ap && Number.isInteger(ap.x) && Number.isInteger(ap.y)) debugAddPile(ap.y * state.WORLD_TILES_X + ap.x, ap.res, ap.n, player.clan ?? 0);
    if (msg.tickZones) {
      const t = state.cycleTick;
      state.cycleTick = Math.ceil(t / 20) * 20;
      updateZones();
      state.cycleTick = t;
    }
    reply({
      ...zonesDebug(),
      stock: { ...clanById(player.clan ?? 0).stock },
      freeVillagers: Array.from(colonists.values()).filter((c) => c.kind === "villager" && !c.person?.child && (c.clan ?? 0) === (player.clan ?? 0)).length,
      snapshot: zonesSnapshotFor(player.clan ?? 0),
      // Gap closure G2: haulers carrying a load (the colonist snapshot's `haul`).
      haulers: Array.from(colonists.values()).filter((c) => zoneCarryOf(c)).map((c) => ({ id: c.id, haul: zoneCarryOf(c) })),
    });
  } else if (msg.op === "workState") {
    // Modular building phase 4: the Work tab table, runtime jobs, the post-change log and the open vacancies.
    // setXp {id, prof, xp}: set a person's profession XP; assignments: run the once-a-second post check now.
    const sx = msg.setXp as { id: string; prof: string; xp: number } | undefined;
    const sp = sx ? colonists.get(sx.id)?.person : undefined;
    if (sx && sp) (sp.xp ??= {})[sx.prof as keyof NonNullable<typeof sp.xp>] = sx.xp;
    if (msg.assignments) updateWorkAssignments();
    const clan = player.clan ?? 0;
    reply({
      tab: workTabFor(clan),
      ...workDebug(),
      vacancies: respawnQueue.filter((q) => !q.hero && (q.clan ?? 0) === clan).map((q) => ({ kind: q.kind, x: q.tx, y: q.ty })),
      people: Array.from(colonists.values()).filter((c) => c.person && (c.clan ?? 0) === clan).map((c) => ({
        id: c.id, kind: c.kind, postX: c.postX, postY: c.postY, state: c.state, child: !!c.person!.child, byPriority: !!c.person!.byPriority,
        work: c.person!.work ?? null, site: c.buildSiteKey ?? null, x: c.x, y: c.y,
      })),
    });
  } else if (msg.op === "interior") {
    // Stardew phase 5c: `enter` {tx, ty} enters that building (reply `why`: "" = in), `exit` true leaves at once,
    // `escExit` true = the interiorExit message, `at` {x, y} (interior px) stands the hero there; replies the state.
    let why: string | undefined;
    withClan(clanOf(player), () => {
      if (msg.enter && typeof msg.enter === "object") {
        const e = msg.enter as { tx?: unknown; ty?: unknown };
        if (typeof e.tx === "number" && typeof e.ty === "number") why = enterInterior(player, e.tx, e.ty);
      }
      if (msg.at && typeof msg.at === "object" && player.interior) {
        const a = msg.at as { x?: unknown; y?: unknown };
        if (typeof a.x === "number" && typeof a.y === "number") Object.assign(player.interior, { x: a.x, y: a.y });
      }
      if (msg.escExit === true) handleInteriorExit(player);
      if (msg.exit === true) exitInterior(player);
    });
    // `find` (a TileType): every building of that type with its owner site number and clan.
    const found = typeof msg.find === "number"
      ? Array.from(tileIndicesOf(msg.find as TileType), (i) => ({ tx: i % state.WORLD_TILES_X, ty: Math.floor(i / state.WORLD_TILES_X), owner: ownerAt(i), clan: clanIdAt(i % state.WORLD_TILES_X, Math.floor(i / state.WORLD_TILES_X)) }))
      : undefined;
    reply({ ...(why !== undefined ? { why } : {}), ...(found ? { found } : {}), ...interiorDebug(player), world: { x: player.x, y: player.y }, cycleTick: state.cycleTick, night: isNightNow() });
  } else if (msg.op === "livestock") {
    // Stardew phase 5d: houses, animals, jobs; `set` {house "x,y", feed?, water?, daily?, animal id, happiness?, born?,
    // health?} adjusts state (daily: run one daily step now).
    reply(livestockDebug(msg.set as Record<string, unknown> | undefined));
  } else if (msg.op === "assignHomes") {
    assignHomes();
    reply({});
  } else if (msg.op === "balanceState") {
    // Phase 6 balance runs: happiness and its terms, food stock, people, population and cap, under the player's clan.
    withClan(clanById(player.clan ?? 0), () => {
      const people = Array.from(colonists.values()).filter((c) => c.person && (c.clan ?? 0) === (player.clan ?? 0));
      reply({
        cycleTick: state.cycleTick, day: state.cycleTick / GAME_DAY_TICKS, isNight: isNightNow(),
        happiness: state.colonyHappiness, parts: colonyHappinessParts(),
        stock: { ...state.stock }, items: { ...state.progress.items },
        people: people.length, children: people.filter((c) => c.person!.child).length,
        minHp: people.reduce((m, c) => Math.min(m, c.hp / Math.max(1, c.maxHp)), 1),
        population: civilianPopulationUsed(), cap: populationCap(),
      });
    });
  } else if (msg.op === "respawnState") {
    // Long days & dawn/dusk respawn windows (day-respawn-test).
    reply({
      cycleTick: state.cycleTick,
      isNight: isNightNow(),
      queue: respawnQueue.map((q) => ({ ...q })),
      respawn: respawnWindowSnapshot(),
      window: respawnWindowAt(state.cycleTick),
      duskTick: dayTicksAt() - 1,
      wardPriestRespawnTicks: state.wardPriestRespawnTicks,
      constants: {
        DAY_TICKS, NIGHT_TICKS, GAME_DAY_TICKS, LEGACY_DAY_TICKS, LEGACY_NIGHT_TICKS, DAY_LENGTH_SCALE, FOOD_TIME_MULT,
        FOOD_PER_COLONIST_PER_DAY, FARM_GROW_TICKS, FARMHAND_CYCLE_TICKS, FORAGE_REGROW_TICKS,
        WILDLIFE_RESPAWN_INTERVAL_TICKS, DESERTER_ACTIVATION_TICKS, RESPAWN_FOOD_COST,
      },
      goalTitles: GOALS.map((g) => g.title),
      colonists: Array.from(colonists.values()).map((c) => ({ id: c.id, kind: c.kind, postX: c.postX, postY: c.postY })),
    });
  }
}
