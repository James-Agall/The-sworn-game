// testhooks.ts: COLONY_TEST_HOOKS handlers (scripted tests only).
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import {
  TileType, type WildlifeKind, WILDLIFE_KINDS, type MobKind, HungerMark, TILE_SIZE, SIEGE_KINDS, COLONIST_ROLE,
  MOB_ROLE, type ColonistKind, type Stance, type EquipSlot, HERO_CLASSES, type HeroClass,
} from "@colony/shared/protocol";
import type { Player, RaidGroup, ResourceKey, TileCoord } from "./types.js";
import {
  ARMOUR_DAMAGE_TAKEN_MULT, BARN_FARM_RADIUS_TILES, BARN_MAX_FARM_PLOTS, DAY_LENGTH_SCALE, DAY_TICKS,
  DESERTER_ACTIVATION_TICKS, DUSK_RESPAWN_CYCLE_TICK, FARMHAND_CYCLE_TICKS, FARMHAND_YIELD_PER_CYCLE,
  FARM_FALLOW_TICKS, FARM_GROW_TICKS, FARM_HARVESTS_BEFORE_FALLOW, FARM_HARVEST_TICKS, FARM_SOWN_FRACTION,
  FARM_YIELD_PER_HARVEST, FOOD_PER_COLONIST_PER_DAY, FORAGE_FRUIT_YIELD, FORAGE_PICKED_TO_RIPE, FORAGE_REGROW_TICKS,
  FORAGE_RIPE_TO_PICKED, GAME_DAY_TICKS, HERO_KEY_PREFIX, LEGACY_DAY_TICKS, LEGACY_GAME_DAY_TICKS,
  LEGACY_NIGHT_TICKS, MOB_KIND_CONFIG, MORALE_MAX, NIGHT_TICKS, RAID_FACTIONS, RESPAWN_FOOD_COST, STANCES,
  TOWER_COSTS, TOWER_STATS, WEAPON_DAMAGE_MULT,
} from "./constants.js";
import {
  attackerSlots, buildingHp, colonists, constructionSites, equipEvents, equipment, farmPlots, forageRegrow,
  forgeQueues, gates, hearthEvents, hearths, heroEvents, heroProfiles, heroRecruits, mobs, moraleRegimentOfUnit,
  ownerSiteIds, playerMorale, raidGroups, regiments, repairPaid, repairQueue, respawnQueue, routedUnits, siegeEvents,
  siegeWorkshops, spellCooldowns, spellEvents, spellStatuses, state, summonedUntil, tacticsEvents, tickDurationsMs,
  tileOwner, towerCooldowns, towerEvents, walledSites, wildlife,
} from "./state.js";
import {
  getBuildingLevel, inBounds, isNightNow, ownerAt, resourceKey, setOwner, siteNumber, tileIndex, tileOfPixel,
  tileToPixelCenter,
} from "./tiles.js";
import { findAdjacentWalkable, isWalkableTile } from "./pathfinding.js";
import { farmPlotProgress, farmhandProgress, releaseResourceReservation, stock } from "./economy.js";
import { makeBoss } from "./worldgen.js";
import { WILDLIFE_CONFIG, WILDLIFE_RESPAWN_INTERVAL_TICKS, damageWildlife, spawnWildlifeAt } from "./wildlife.js";
import {
  TOWN_CENTER_TILE, civilianPopulationUsed, findTownCenterAt, happinessSpeedMultiplier, populationCap,
  productionSpeedMultiplier, respawnWindowAt, respawnWindowSnapshot, spawnColonistForPost, townCenterBonus,
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
import { createRaidMob, spawnRaid } from "./raids.js";
import { damageHearth } from "./hearths.js";
import { GOALS, nightsSurvived } from "./goals.js";
import {
  grantRelic, heroKey, heroProfileOf, heroProfileSnapshot, heroSheetsSnapshot, isEquippedKind, pickHeroName,
  playerAttackCooldownTicks, playerMaxHp, spawnHeroColonist,
} from "./heroes.js";
import { grantTome, isSpellId, learnSpell, spellBookSnapshot } from "./spells.js";
import { stepSimulation } from "./sim.js";
import { broadcastTileUpdate, fightsForPlayer } from "./net.js";

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
