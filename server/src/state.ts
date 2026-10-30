// state.ts: The mutable world state: the `state` object (every module-level value that is reassigned after init) and the in-place-mutated containers (Maps / Sets / arrays). Imports only constants at runtime.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import {
  DEFAULT_WORLD_TILES, TILE_SIZE, TileType, Biome, type AttackEffect, type EquipmentStock, type Difficulty,
  type GravestoneSnapshot, type GoalSnapshot, type EquipSlot, type SpellId,
} from "@colony/shared/protocol";
import type {
  ResourceKey, ActiveFight, Body, ChargeRun, Colonist, ConstructionSiteState, FarmPlotState, FightHit, ForgeQueueState, GateState,
  HearthState, HeroProfile, HeroRecruit, Mob, OrderGroup, Player, PlayerMoraleState, RaidGroup, RegimentState,
  RespawnRequest, SiegeWorkshopState, SiteState, SpellStatus, TileCoord, TownCenter, Wildlife,
} from "./types.js";
import {
  EXPLORED_FLUSH_TICKS, LUMBERJACK_TREE_INTERVAL_TICKS, RAID_MAX_SPAWN_DIST_TILES, SUBLINEAR_FULL_SCALE,
  TREE_RESPAWN_INTERVAL_TICKS, clampWorldSize,
} from "./constants.js";

// Every module-level value that is reassigned after init lives on `state` (ES module bindings can't be
// reassigned from another module). Fields are grouped by domain (the per-clan refactor splits these).
// Initial values: literals below; size-dependent ones after the helpers; the rest are assigned where the
// value was declared (`state.x = ...` in the owning module).

export interface WorldSizeFields {
  WORLD_TILES_X: number;
  WORLD_TILES_Y: number;
  // World-gen counts below were tuned on 80x80; scale them by area so bigger maps keep the same density.
  WORLD_AREA_SCALE: number;
  // Tuned for the 80x80 map (4x the old 40x40 counts of 24/14/16, keeping per-tile density).
  TREE_COUNT: number;
  IRON_ORE_COUNT: number;
  ROCK_COUNT: number;
}

export interface CoreFields {
  worldWidth: number;
  worldHeight: number;
  tiles: Uint8Array<ArrayBuffer>;
  // Parallel to `tiles`; Biome value per tile, regenerated with the rest of the world.
  biomes: Uint8Array<ArrayBuffer>;
}

export interface EconomyFields {}

export interface CombatFields {
  pendingEffects: AttackEffect[];
}

export interface GatesFields {
  hostileMover: boolean;
  // Set by broadcastTileUpdate: the gate registry is rescanned.
  gateTilesDirty: boolean;
}

export interface OwnersFields {
  ownerVersion: number;
  // Clans: bumped whenever tileClan changes (snapshot `clanTiles` is resent).
  clanTilesVersion: number;
  moverOwner: number;
  // Forts phase B: 1 per tile inside a standing (uncaptured) fort's reserved grounds (template rectangle
  // + apron); rebuilt by sites.ts rebuildSiteGrounds. Scatter / regrowth / POIs / player builds keep off.
  siteGrounds: Uint8Array<ArrayBuffer>;
}

export interface RoutingFields {
  // Cached tiles of damageable non-wall buildings for mob target picks; rebuilt when tiles change.
  buildingTargetsDirty: boolean;
  // Damageable non-wall buildings (the candidates of pickBuildingTarget), rebuilt lazily after tile changes.
  buildingTargetTiles: TileCoord[];
  buildingTargetsBuiltTick: number;
  // Shortest route (start excluded) from `start` to a tile next to (gx, gy), 4-connected. wallCost 0:
  // walls are solid like any other building (an ordinary route); wallCost > 0: wall tiles are passable at
  // that cost each (the breach search). Dijkstra over a binary heap of cost * N + tile index.
  routeCost: Float64Array<ArrayBuffer>;
  routeParent: Int32Array<ArrayBuffer>;
}

export interface SettlementsFields {
  // Every standing Town Center (a destroyed one is removed). Reset to the starting one by generateWorld.
  townCenters: TownCenter[];
}

export interface SimFields {
  isPaused: boolean;
  // Strategy mode phase 5: global time controls (any player's pause / speed applies to everyone). The tick
  // loop adds timeScale to simAccum each tick and steps the sim once per whole unit (2x: twice a tick;
  // 1/2, 1/4: every 2nd / 4th tick, and only those ticks broadcast).
  timeScale: number;
  timeScaleBy: string | null;
  pausedBy: string | null;
  simAccum: number;
  wasNight: boolean;
}

export interface TimeFields {
  cycleTick: number;
}

export interface HeroesFields {
  // Bumped whenever a hero is recruited / spawns / dies / changes gear or XP: snapshot `heroes` is resent.
  heroRosterVersion: number;
  heroProfileVersionCounter: number;
  // testHook "heroConfig" {relicChance}: overrides both relic chances (null = the constants).
  testRelicChance: number | null;
}

export interface MobsFields {
  // Nemri (avoids engagement): ignores guards and players and makes straight for the nearest unwarded
  // Town Center (the thing being guarded); with none, ordinary targeting.
  // testHook "forceMarkChance" {value}: overrides the per-raider chance (null restores it).
  testForceMarkChance: number | null;
  // The world-wide setting. The first setDifficulty after a fresh (re)start claims it; later ones are
  // ignored unless the world is still on its first day with only the sender connected (so a solo
  // player can change their mind) or a restart carries a new value.
  difficulty: Difficulty;
  difficultyClaimed: boolean;
}

export interface HappinessFields {}

export interface TreesFields {
  // Regrowth cap, scaled 4x with TREE_COUNT for the 80x80 map (at the old 50 the 96 starting
  // trees would sit above the cap and natural regrowth would never run).
  MAX_TREES: number;
  treeRespawnCooldown: number;
  lumberjackTreeGrowCooldown: number;
}

export interface RespawnFields {
  // Units spawned by this tick's window (respawnQueue + Ward Priest), for the "Reinforcements" toast.
  respawnWindowSpawned: number;
  // True while a dead Ward Priest is due back at the next window (counted as waiting on the client).
  wardPriestAwaitingWindow: boolean;
}

export interface WildlifeFields {
  // Wild forage scatter (counts tuned for 80x80, scaled by area like the other world-gen counts).
  // Berry bushes on Plains, fruit trees on Plains, mushrooms next to trees (any biome) or in Swamp.
  BERRY_BUSH_COUNT: number;
  FRUIT_TREE_COUNT: number;
  MUSHROOM_PATCH_COUNT: number;
  // 4 a day on 80x80 (16 on 160x160): a map's sustainable hunt is about this many animals a day.
  WILDLIFE_RESPAWN_PER_DAY: number;
  nextWildlifeId: number;
  wildlifeRespawnCooldown: number;
  // testHook "setWildlifeRespawn" {enabled:false}: no new game appears (hunting tests control every animal).
  testWildlifeRespawnDisabled: boolean;
}

export interface BuildersFields {
  lastRepairShortToastTick: number;
}

export interface BodiesFields {
  cellHead: Int32Array<ArrayBuffer>;
  cellNext: Int32Array<ArrayBuffer>;
}

export interface RegimentsFields {}

export interface OrdersFields {
  nextOrderGroupId: number;
}

export interface WardFields {
  wardPriestId: string | null;
  wardPriestTendTicks: number;
  // -1: no respawn pending. Otherwise counts down like a respawnQueue entry, then costs food.
  wardPriestRespawnTicks: number;
}

export interface RaidsFields {
  // Day index whose raid has already spawned, so the midday check fires once per day.
  raidSpawnedForDay: number;
  raidSpawnDist: number;
}

export interface BuildingsFields {
  // Tile type -> 1 when mobs can damage it: player buildings that are solid and demolishable (walls
  // included), not construction sites, roads, farm plots or wild forage. Town Centers are separate.
  damageableLut: Uint8Array | null;
}

export interface TacticsFields {
  lastRoutToastTick: number;
  // testHook "tacticsConfig" {freezeMorale:true}: morale never changes (isolates flanking in tests).
  testMoraleFrozen: boolean;
}

export interface WorldgenFields {
  BIOME_SEEDS_PER_KIND: number;
  POND_COUNT_MIN: number;
  POND_COUNT_MAX: number;
  RUIN_SITE_COUNT_MIN: number;
  RUIN_SITE_COUNT_MAX: number;
  ENCAMPMENT_SITE_COUNT_MIN: number;
  ENCAMPMENT_SITE_COUNT_MAX: number;
  // Center tile of this world's Abbey (null only if world-gen couldn't fit one). Doubles as the
  // Abbey's permanent ward source.
  abbeyCenter: TileCoord | null;
  // Re-rolled per world so jittered biome/pond edges differ between worlds, but within a world the
  // jitter is a fixed function of tile position (stable, no flicker).
  worldNoiseSalt: number;
}

export interface HearthsFields {}

export interface CastleFields {
  // Mini-bosses: standalone packs of one kind, an upscaled elite plus 2-4 ordinary followers.
  MINI_BOSS_SITE_COUNT_MIN: number;
  MINI_BOSS_SITE_COUNT_MAX: number;
  // Centre tile of this world's Castle Ruin (null only if world-gen couldn't fit one, or an old save).
  castleRuinCenter: TileCoord | null;
}

export interface GoalsFields {}

export interface FogFields {
  // Explored tiles, shared by every player and kept for the life of the world. Sources only reveal
  // when their tile changes (or a building lands), stamping a precomputed circle; nothing ever scans
  // the whole map per tick.
  explored: Uint8Array<ArrayBuffer>;
  // Newly explored tile indices awaiting the next batched `explored` broadcast.
  pendingExplored: number[];
  exploredFlushCountdown: number;
  // Tile index each player/colonist last revealed from. Replaced on world reset so everyone re-stamps.
  visionTile: WeakMap<object, number>;
}

export interface NetFields {
  nextColorIndex: number;
}

export interface TesthooksFields {
  // Overrides spawnRaid's DESERTER_WAVE_CHANCE roll when set (testHook "forceDeserterRoll").
  testForceDeserterRoll: boolean | null;
  // When true, spawnRaid gives every group aggroTick = nightfall (testHook "holdRaidAggro"), so a test
  // can inspect passive groups without a random early aggro racing it.
  testHoldRaidAggro: boolean;
  // testHook "setRaids" {enabled:false} skips the midday raid spawn of every day that passes while it is
  // off (economy tests fast-forward days).
  testRaidsDisabled: boolean;
  // testHook "ignorePlayers" {value:true}: mobs never target players (so a test client standing in the
  // world doesn't draw every mob away from the buildings).
  testPlayersIgnored: boolean;
}

export interface SavesFields {
  // A freshly booted server's unattended world must not overwrite the last real autosave: autosaves
  // (dawn + shutdown) only start once a player has connected.
  anyPlayerSinceBoot: boolean;
  // Set by the dawn hook inside stepSimulation; the tick loop runs the save once, outside fastForward.
  autosaveDue: boolean;
  // Saves/loads run one at a time, queued in request order (a load asked for while the dawn autosave
  // is still writing just waits a few ms). A load also holds the simulation while the file is read.
  saveLoadQueue: Promise<unknown>;
  autosaveQueued: boolean;
  simHeldForLoad: boolean;
  // Ctrl+C / kill / tsx watch restarts: write the autosave synchronously, then exit.
  shuttingDown: boolean;
}

export interface ConstructionFields {
  // COLONY_INSTANT_BUILD=1 (or testHook "setInstantBuild") skips construction entirely, for the scripted
  // tests written before builders existed: every placement resolves on the spot, no builder needed.
  instantBuild: boolean;
}

export interface EquipmentFields {
  lastUnequippedToastTick: number;
  equipDropToasted: boolean;
  lastEquipDropToastTick: number;
  // testHook "equipConfig" {dropChance}: overrides EQUIP_DROP_CHANCE (null = the constant).
  testEquipDropChance: number | null;
  // testHook "gearPickupConfig" {enabled}: false switches the idle soldiers' gear pickup off (equipment-test).
  testGearPickupOff: boolean;
}

export interface SpellsFields {
  testTomeChance: number | null;
  // Monotonic spell clock (cycleTick restarts with a load / test hooks; this only counts up).
  spellTick: number;
}

export interface SiegeFields {
  // testHook "forceRaidSiege" {value:true}: raids pick orc / bandit factions and fill their siege caps first.
  testForceRaidSiege: boolean;
}

export interface FightsFields {
  fightHits: FightHit[];
  activeFights: ActiveFight[];
  nextFightId: number;
}

export interface IntelFields {
  // Live vision as a per-tile stamp (players + the colony's colonists, the client fog's radii), restamped per
  // summary pass; a regiment is reported when any member stands in it, from its seen members only. Cost per
  // pass: ~colonists x 113 tile writes + one pass over the mobs, every ENEMY_REGIMENT_REFRESH_TICKS.
  liveVisionGrid: Uint16Array<ArrayBuffer>;
  liveVisionStamp: number;
  enemyRegimentTick: number;
}

// ---- Clans (PLAN-forts-diplomacy-moats.md decision 1, phase A2; ROADMAP "Clans — landed") ----
// Everything a clan owns on its own. Players of one clan share all of it (clan 0 = the old shared colony).
// These fields are ACCESSOR properties on `state` that forward to `state.clan`, the active clan: code that
// reads `state.stock` / `state.goalIndex` / ... works on whichever clan the current context set (a player's
// message, a colonist's update, a per-clan loop; see clans.ts `withClan`). Outside any context it is clan 0.
export interface ClanFields {
  stock: Record<ResourceKey, number>;
  // Armour & weapons stock (pieces per tier).
  equipment: EquipmentStock;
  marketBuilt: boolean;
  goldShopBuilt: boolean;
  colonyHappiness: number;
  goalIndex: number;
  goalSnapshot: GoalSnapshot;
  // Set when the Ogre Warlord dies to this clan; the goal track's final goal reads it. Saved.
  castleCleared: boolean;
  campsDestroyed: number;
  // Snapshot change detection of this clan's army regiments / order groups.
  armyRegimentSignature: string;
  armyRegimentTicks: number;
  orderGroupSignature: string;
  orderGroupTicks: number;
  // Task force hotkey slots (1-9) -> unit ids, and the size each was assigned at (not saved).
  taskForces: Map<number, string[]>;
  taskForceMax: Map<number, number>;
}
export interface Clan extends ClanFields {
  id: number;
  name: string;
  // Banner / border tint (a PLAYER_COLORS entry: the founder's colour).
  color: number;
  // Phase D hook: relation to other clans by clan id (none yet: every clan is neutral to every other).
  relations: Record<number, number>;
  // Day index (dawns since the world began) the clan was founded on; its "Survive N nights" goals count from it.
  foundedDay: number;
}
export const CLAN_FIELD_KEYS: readonly (keyof ClanFields)[] = [
  "stock", "equipment", "marketBuilt", "goldShopBuilt", "colonyHappiness", "goalIndex", "goalSnapshot",
  "castleCleared", "campsDestroyed", "armyRegimentSignature", "armyRegimentTicks", "orderGroupSignature",
  "orderGroupTicks", "taskForces", "taskForceMax",
];
export interface ClanStateFields {
  // The active clan (see ClanFields). Never null: clan 0 when no context is set.
  clan: Clan;
  // The clan whose players broadcastEvent reaches (null: everyone). Set with `clan` by withClan.
  eventClan: Clan | null;
}

// A fresh clan; the stock starts empty (callers fill it, e.g. initialStock()).
export function makeClan(id: number, name: string, color: number, foundedDay = 0): Clan {
  return {
    id, name, color, relations: {}, foundedDay,
    stock: {
      wood: 0, iron: 0, rock: 0, grain: 0, meat: 0, fruit: 0, wool: 0, cotton: 0, clothes: 0, tools: 0,
      luxuryItems: 0, gold: 0, alcohol: 0,
    } as Record<ResourceKey, number>,
    equipment: { armour: [0, 0, 0], weapon: [0, 0, 0] },
    marketBuilt: false,
    goldShopBuilt: false,
    colonyHappiness: 100,
    goalIndex: 0,
    goalSnapshot: { index: 0, total: 1, title: "", progress: 0, target: 1 },
    castleCleared: false,
      campsDestroyed: 0,
    armyRegimentSignature: "",
    armyRegimentTicks: 0,
    orderGroupSignature: "",
    orderGroupTicks: 0,
    taskForces: new Map(),
    taskForceMax: new Map(),
  };
}

export interface ServerState
  extends ClanFields,
    ClanStateFields,
    WorldSizeFields,
    CoreFields,
    EconomyFields,
    CombatFields,
    GatesFields,
    OwnersFields,
    RoutingFields,
    SettlementsFields,
    SimFields,
    TimeFields,
    HeroesFields,
    MobsFields,
    HappinessFields,
    TreesFields,
    RespawnFields,
    WildlifeFields,
    BuildersFields,
    BodiesFields,
    RegimentsFields,
    OrdersFields,
    WardFields,
    RaidsFields,
    BuildingsFields,
    TacticsFields,
    WorldgenFields,
    HearthsFields,
    CastleFields,
    GoalsFields,
    FogFields,
    NetFields,
    TesthooksFields,
    SavesFields,
    ConstructionFields,
    EquipmentFields,
    SpellsFields,
    SiegeFields,
    FightsFields,
    IntelFields {}

const initial: Partial<ServerState> = {
  // WorldSizeFields
  WORLD_TILES_X: clampWorldSize(Number.parseInt(process.env.COLONY_WORLD_SIZE ?? "", 10) || DEFAULT_WORLD_TILES),
  // CombatFields
  pendingEffects: [],
  // GatesFields
  hostileMover: false,
  gateTilesDirty: true,
  // OwnersFields
  ownerVersion: 0,
  clanTilesVersion: 0,
  moverOwner: 0,
  // RoutingFields
  buildingTargetsDirty: true,
  buildingTargetTiles: [],
  buildingTargetsBuiltTick: -1,
  // SettlementsFields
  townCenters: [],
  // SimFields
  isPaused: false,
  timeScale: 1,
  timeScaleBy: null,
  pausedBy: null,
  simAccum: 0,
  wasNight: false,
  // TimeFields
  cycleTick: 0,
  // HeroesFields
  heroRosterVersion: 0,
  heroProfileVersionCounter: 0,
  testRelicChance: null,
  // MobsFields
  testForceMarkChance: null,
  difficulty: "normal",
  difficultyClaimed: false,
  // TreesFields
  treeRespawnCooldown: TREE_RESPAWN_INTERVAL_TICKS,
  lumberjackTreeGrowCooldown: LUMBERJACK_TREE_INTERVAL_TICKS,
  // RespawnFields
  respawnWindowSpawned: 0,
  wardPriestAwaitingWindow: false,
  // WildlifeFields
  nextWildlifeId: 1,
  testWildlifeRespawnDisabled: false,
  // BuildersFields
  lastRepairShortToastTick: -Infinity,
  // BodiesFields
  cellNext: new Int32Array(256),
  // OrdersFields
  nextOrderGroupId: 1,
  // WardFields
  wardPriestId: null,
  wardPriestTendTicks: 0,
  wardPriestRespawnTicks: -1,
  // RaidsFields
  raidSpawnedForDay: -1,
  raidSpawnDist: RAID_MAX_SPAWN_DIST_TILES,
  // BuildingsFields
  damageableLut: null,
  // TacticsFields
  lastRoutToastTick: -Infinity,
  testMoraleFrozen: false,
  // WorldgenFields
  abbeyCenter: null,
  worldNoiseSalt: 0,
  // CastleFields
  castleRuinCenter: null,
  // FogFields
  pendingExplored: [],
  exploredFlushCountdown: EXPLORED_FLUSH_TICKS,
  visionTile: new WeakMap<object, number>(),
  // NetFields
  nextColorIndex: 0,
  // TesthooksFields
  testForceDeserterRoll: null,
  testHoldRaidAggro: false,
  testRaidsDisabled: false,
  testPlayersIgnored: false,
  // SavesFields
  anyPlayerSinceBoot: false,
  autosaveDue: false,
  saveLoadQueue: Promise.resolve(),
  autosaveQueued: false,
  simHeldForLoad: false,
  shuttingDown: false,
  // ConstructionFields
  instantBuild: process.env.COLONY_INSTANT_BUILD === "1",
  // EquipmentFields
  lastUnequippedToastTick: -Infinity,
  equipDropToasted: false,
  lastEquipDropToastTick: -Infinity,
  testEquipDropChance: null,
  testGearPickupOff: false,
  // SpellsFields
  testTomeChance: null,
  spellTick: 0,
  // SiegeFields
  testForceRaidSiege: false,
  // FightsFields
  fightHits: [],
  activeFights: [],
  nextFightId: 1,
  // IntelFields
  liveVisionGrid: new Uint16Array(0),
  liveVisionStamp: 0,
  enemyRegimentTick: 0,
};
export const state = initial as ServerState;

// Every clan, by id (clans[i].id === i). Clan 0 always exists (the colony of every old save / default join).
export const clans: Clan[] = [makeClan(0, "The Colony", 0xd4a017)];
state.clan = clans[0];
state.eventClan = null;
for (const key of CLAN_FIELD_KEYS) {
  Object.defineProperty(state, key, {
    get: () => state.clan[key],
    set: (v) => {
      (state.clan as unknown as Record<string, unknown>)[key] = v;
    },
    enumerable: true,
    configurable: false,
  });
}
// Player-built tiles of clans other than 0: tile index -> clan id (>= 1). Missing = clan 0 / unowned, so old
// saves and single-clan games keep it empty. NPC site tiles are in tileOwner instead.
export const tileClan = new Map<number, number>();

export const scaledCount = (n: number) => Math.round(n * state.WORLD_AREA_SCALE);
export const subScale = () =>
  state.WORLD_AREA_SCALE <= SUBLINEAR_FULL_SCALE
    ? state.WORLD_AREA_SCALE
    : SUBLINEAR_FULL_SCALE * Math.pow(state.WORLD_AREA_SCALE / SUBLINEAR_FULL_SCALE, 0.25);
export const scaledCountSub = (n: number) => Math.round(n * subScale());

// Initial values that depend on other state (world size) or the helpers above, in declaration order.
state.WORLD_TILES_Y = state.WORLD_TILES_X;
state.WORLD_AREA_SCALE = (state.WORLD_TILES_X * state.WORLD_TILES_Y) / (80 * 80);
state.worldWidth = state.WORLD_TILES_X * TILE_SIZE;
state.worldHeight = state.WORLD_TILES_Y * TILE_SIZE;
state.tiles = new Uint8Array(state.WORLD_TILES_X * state.WORLD_TILES_Y).fill(TileType.Empty);
state.biomes = new Uint8Array(state.WORLD_TILES_X * state.WORLD_TILES_Y).fill(Biome.Plains);
state.TREE_COUNT = scaledCount(96);
state.IRON_ORE_COUNT = scaledCount(56);
state.ROCK_COUNT = scaledCount(64);
state.MAX_TREES = scaledCount(200);
state.BERRY_BUSH_COUNT = scaledCount(24);
state.FRUIT_TREE_COUNT = scaledCount(12);
state.MUSHROOM_PATCH_COUNT = scaledCount(10);
state.WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCountSub(4));
state.cellHead = new Int32Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
state.routeCost = new Float64Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
state.routeParent = new Int32Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
state.BIOME_SEEDS_PER_KIND = scaledCount(5);
state.POND_COUNT_MIN = scaledCount(8);
state.POND_COUNT_MAX = scaledCount(12);
state.RUIN_SITE_COUNT_MIN = scaledCountSub(6);
state.RUIN_SITE_COUNT_MAX = scaledCountSub(10);
state.ENCAMPMENT_SITE_COUNT_MIN = scaledCountSub(6);
state.ENCAMPMENT_SITE_COUNT_MAX = scaledCountSub(10);
state.MINI_BOSS_SITE_COUNT_MIN = Math.max(1, scaledCountSub(0.75));
state.MINI_BOSS_SITE_COUNT_MAX = Math.max(1, scaledCountSub(1.25));
state.explored = new Uint8Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
state.siteGrounds = new Uint8Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);

// ---- In-place containers (only mutated, never reassigned) ----

// -- core --
export const players = new Map<string, Player>();
export const colonists = new Map<string, Colonist>();
export const mobs = new Map<string, Mob>();

// -- respawn --
export const respawnQueue: RespawnRequest[] = [];

// -- farms --
export const farmPlots = new Map<string, FarmPlotState>();
export const minesPlacedOnOre = new Set<string>();

// -- buildings --
export const buildingLevel = new Map<string, number>();
// Current HP of damaged buildings (resourceKey); a building missing here is at full HP.
export const buildingHp = new Map<string, number>();

// -- towers --
// Towers: ticks until each Tower (resourceKey) may shoot again (transient, not saved). See the Tower block.
export const towerCooldowns = new Map<string, number>();
// Recent site-tower shots (testHook "ownerState").
export const towerEvents: Array<{ tick: number; tower: string; target: string; damage: number }> = [];

// -- gates --
export const gates = new Map<number, GateState>();
// Mobs whose last path search toward their building target failed (a gate closed on the route).
export const mobsWithoutRoute = new Set<string>();

// -- owners --
// Forts phase A (PLAN-forts-diplomacy-moats.md §1): tile owners. Sparse: tile index -> site number
// (>= 1); a tile missing here is the colony's / unowned (every tile of an old save). Site number n names
// ownerSiteIds[n - 1] (the mobs' siteId; phase B's SiteState takes this over). moverOwner is the site
// number of the mob currently moving / pathing (0: none), read by gatePassable next to hostileMover.
export const tileOwner = new Map<number, number>();
export const ownerSiteIds: string[] = [];
// Forts phase B (PLAN-forts-diplomacy-moats.md §2): stamped NPC forts by siteId (= their mobs' siteId,
// their hearth's key and ownerSiteIds[num - 1]). Saved as `sites`; old saves have none.
export const sites = new Map<string, SiteState>();
// Colonist id -> tile index of the site wall / gate it is breaching on the way to its structure target
// (the target itself is walled off; see structureStep). Not saved: a load re-plans.
export const structureBreach = new Map<string, number>();

// -- builders --
// HP of repair already paid for per building (manual Repair pays up front, builders pay when they start).
export const repairPaid = new Map<string, number>();
// Manual Repair requests (resourceKey), served before the automatic most-damaged pick.
export const repairQueue: string[] = [];


// -- economy --
export const reservedResourceTiles = new Map<string, string>();

// -- equipment --
// ---- Armour & weapons: stock, equipping, forging, drops (constants: EQUIP_* / FORGE_* / *_MULT) ----
// Test-hook log (equipState): equip / unequipped / forged / drop / loot / hit / taken.
export const equipEvents: { type: string; id?: string; slot?: EquipSlot; tier?: number; amount?: number; detail?: string; tick: number }[] = [];

// -- wildlife --
// Tile index -> ticks until that picked plant is ripe again.
export const forageRegrow = new Map<number, number>();
export const wildlife = new Map<number, Wildlife>();

// -- slots --
// ---- Engagement slots ----
// A melee attacker claims one slot on a ring around its target and fights from there, so several
// attackers spread around a target instead of stacking on one point. Unit targets (mob / colonist /
// player) get N slots at angles 2*pi*i/N; buildings and Town Centers get the walkable tiles of their
// 8-tile ring reachable from the approach tile pickBuildingTarget chose. Ranged attackers take none.
// Keys: "m:<mobId>", "c:<colonistId>", "p:<playerId>", "b:<x,y>" (buildings and Town Centers).
export const slotClaims = new Map<string, Map<number, string>>();
export const attackerSlots = new Map<string, { key: string; slot: number }>();

// -- bodies --
export const bodies: Body[] = [];
// Ids of mobs that struck or held in attack range this tick (they take the smaller separation share).
export const mobsAttackingThisTick = new Set<string>();

// -- combat --
// Wiped wholesale at each dawn (before that dawn's starvation deaths add new ones), so every entry
// was placed since the most recent dawn and lasts until the next one.
export const gravestones: GravestoneSnapshot[] = [];

// -- orders --
// Colonist id -> the mob an explicit Attack order sent it after: that chase ignores the line leash
// (LINE_LEASH_TILES) and the front-rank hold. Stale entries are harmless (checked against targetMobId).
export const commandedTargets = new Map<string, string>();
// Unit id -> its charge cycle on a charge order: "in" (riding at the target; readyTick = the charge
// cooldown it had when it set off, so a changed value = a charge landed) or "out" (withdrawing, since).
export const chargeCycle = new Map<string, { phase: "in" | "out"; readyTick: number; since: number }>();
export const orderGroups = new Map<string, OrderGroup>();
export const orderGroupOfUnit = new Map<string, OrderGroup>();
// Staggered start: unit id -> the slot it heads for once cycleTick reaches `at`.
export const pendingRallies = new Map<string, { at: number; x: number; y: number; group: string; squad: string | null }>();


// -- units --
// Squad march: per-tick speed for every squad member walking back to its formation slot (no target),
// see SQUAD_* above. Members without an entry move at their own speed.
export const squadMarchSpeed = new Map<string, number>();

// -- ward --
// resourceKey -> cycleTick at which the priest last finished tending that stone. A stone with no
// entry has never been tended and is not warded.
export const wardStoneLastTended = new Map<string, number>();
// Ward Stones (resourceKey) whose ward was up at the end of the previous tick. Only Ward Stones:
// the Abbey's ward never lapses, so it is never tracked and never lets a Half-Latch through.
export const wardStonesActiveLastTick = new Set<string>();

// -- raids --
export const raidGroups = new Map<string, RaidGroup>();

// -- tactics --
export const regiments = new Map<string, RegimentState>();
// Site / regiment ids that own walls (the cover behaviour). Fort / horde sites register here, or set
// SITE_KIND_WALLED for their kind; testHook "setRegimentWalled" too. Encampment fences do not count.
export const walledSites = new Set<string>();
// Recent tactics events (testHook "tacticsState").
export const tacticsEvents: Array<{ tick: number; type: string; regiment: string; detail?: string }> = [];

// -- playerMorale --
export const playerMorale = new Map<string, PlayerMoraleState>();
// Unit id -> its regiment id as of the last evaluation (casualties, wavering damage).
export const moraleRegimentOfUnit = new Map<string, string>();
// Routed unit -> the regiment it routed with, and whether it was in an order group before (on rally it
// keeps standing in its retreat group; otherwise it leaves the group and goes back to the rally slot it
// held before the rout: its post, or where a tactical-mode move left it).
export const routedUnits = new Map<string, { reg: string; hadGroup: boolean; rallyX: number; rallyY: number }>();

// -- hearths --
export const hearths = new Map<string, HearthState>();
// Recent hearth events (testHook "hearthState").
export const hearthEvents: Array<{ tick: number; type: string; siteId: string; detail?: string }> = [];

// -- testhooks --
export const tickDurationsMs: number[] = [];

// -- construction --
export const constructionSites = new Map<string, ConstructionSiteState>();

// -- siege --
export const chargeRuns = new Map<string, ChargeRun>();
// Recent siege / charge events (testHook "siegeState").
export const siegeEvents: Array<{ tick: number; type: string; id: string; amount?: number; detail?: string }> = [];
export const siegeWorkshops = new Map<string, SiegeWorkshopState>();

// -- heroes --
export const heroProfiles = new Map<string, HeroProfile>();
// Test-hook log (heroState): hit / taken / relic / xp / equip / refuse.
export const heroEvents: { type: string; key?: string; amount?: number; detail?: string; tick: number }[] = [];
export const heroRecruits: HeroRecruit[] = [];

// -- spells --
// Keyed "m:<mob id>" / "c:<colonist id>" / "p:<player id>".
export const spellStatuses = new Map<string, SpellStatus>();
// Profile key -> spell -> spellTick it is ready again.
export const spellCooldowns = new Map<string, Partial<Record<SpellId, number>>>();
// Summoned skeleton militia: colonist id -> spellTick it crumbles.
export const summonedUntil = new Map<string, number>();
// Last spellTick a friendly unit / player ("c:" / "p:" key) lost HP (hero Ward auto-cast).
export const lastHurtTick = new Map<string, number>();
// Test-hook log (spellState): cast / refuse / learn / tome / burn / absorb / summon / expire.
export const spellEvents: { type: string; key?: string; spell?: string; amount?: number; detail?: string; tick: number }[] = [];

// -- forge --
export const forgeQueues = new Map<string, ForgeQueueState>();
// Forge autocraft (setForgeAuto): Blacksmith tile key ("x,y") -> stock target, for every Blacksmith with
// autocraft on (its clan is the tile's). Saved (`forgeAuto`); dropped when the tile stops being a Blacksmith.
export const forgeAuto = new Map<string, number>();
