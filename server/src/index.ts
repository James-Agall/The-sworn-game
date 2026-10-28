import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promises as fsp, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClientMessage,
  ServerMessage,
  PlayerSnapshot,
  ColonistSnapshot,
  ColonistKind,
  MobSnapshot,
  MobKind,
  AttackEffect,
  Stance,
  GameEventCategory,
  GravestoneSnapshot,
  Difficulty,
  WildlifeKind,
  WILDLIFE_KINDS,
  WildlifeState,
  FarmStage,
  TownCenterSnapshot,
  BuildingInfo,
  EquipSlot,
  EquipmentStock,
  TileType,
  Biome,
  HungerMark,
  HUNGER_MARK_NAMES,
  BossTier,
  bossTitle,
  GoalSnapshot,
  isSolidTile,
  isRoadTile,
  TICK_RATE,
  TILE_SIZE,
  DEFAULT_WORLD_TILES,
  PLAYER_SPEED,
  PLAYER_HALF_SIZE,
  PLAYER_MAX_HP,
  VISION_RADIUS_PLAYER,
  VISION_RADIUS_COLONIST,
  VISION_RADIUS_BUILDING,
  VISION_RADIUS_START,
  SaveSlot,
  SaveInfo,
  SAVE_SLOTS,
  GateLock,
  GATE_FLAG_OPEN,
  GATE_FLAG_LOCK_OPEN,
  GATE_FLAG_LOCK_CLOSED,
  GATE_FLAG_OVERRUN,
  FightKind,
  FightSnapshot,
  FIGHT_WINDOW_SECONDS,
  FIGHT_CLUSTER_TILES,
  FIGHT_RELEVANCE_TILES,
  FIGHT_MAX_PER_PLAYER,
  WILDLIFE_SNAPSHOT_STRIDE,
  CombatRole,
  SiegeKind,
  SIEGE_KINDS,
  MOB_ROLE,
  COLONIST_ROLE,
  isRearRole,
  GearSlot,
  GEAR_SLOTS,
  GearItem,
  ItemSlotKind,
  ItemStats,
  Equipment,
  HeroStats,
  HeroProfileSnapshot,
  HeroClass,
  HERO_CLASSES,
  HERO_CLASS_LABEL,
  HeroSheetSnapshot,
  unitRole,
  SpellId,
  SPELLS,
  SPELL_IDS,
  SPELL_SLOT_COUNT,
  SpellBookSnapshot,
  ArmyRegimentSnapshot,
  RegimentClass,
  HERO_CLASS_ROLE,
  ArmyOrder,
  ArmyOrderKind,
  ArmyOrderGroupSnapshot,
  ARMY_ORDER_QUEUE_MAX,
  FormationShape,
  FORMATION_SHAPES,
} from "./protocol.js";
import { planOrderFormation } from "./formation.js";

// The scripted server/*.mjs tests assume 80x80: run the server with COLONY_WORLD_SIZE=80 for them.
// The size is chosen per world (main menu / restart / save); COLONY_WORLD_SIZE is only the boot default.
// setWorldSize() (below, once every size-dependent module value is declared) re-allocates them all.
const MIN_WORLD_SIZE = 64;
const MAX_WORLD_SIZE = 512;
const clampWorldSize = (n: number) => Math.min(MAX_WORLD_SIZE, Math.max(MIN_WORLD_SIZE, Math.round(n)));
let WORLD_TILES_X = clampWorldSize(Number.parseInt(process.env.COLONY_WORLD_SIZE ?? "", 10) || DEFAULT_WORLD_TILES);
let WORLD_TILES_Y = WORLD_TILES_X;
// World-gen counts below were tuned on 80x80; scale them by area so bigger maps keep the same density.
let WORLD_AREA_SCALE = (WORLD_TILES_X * WORLD_TILES_Y) / (80 * 80);
const scaledCount = (n: number) => Math.round(n * WORLD_AREA_SCALE);
// Things that cost CPU every tick (wildlife) or are expensive to populate (POIs and their guardians,
// mini-bosses) scale by area only up to the 160x160 tuning (scale 4); beyond that, as the 4th root, so a
// 512 map gets ~1.8x a 160 map's count instead of ~10x.
const SUBLINEAR_FULL_SCALE = 4;
const subScale = () =>
  WORLD_AREA_SCALE <= SUBLINEAR_FULL_SCALE
    ? WORLD_AREA_SCALE
    : SUBLINEAR_FULL_SCALE * Math.pow(WORLD_AREA_SCALE / SUBLINEAR_FULL_SCALE, 0.25);
const scaledCountSub = (n: number) => Math.round(n * subScale());

interface Player {
  id: string;
  x: number;
  y: number;
  color: number;
  hp: number;
  input: { dx: number; dy: number };
  socket: WebSocket;
  attackCooldownTicks: number;
  poisonTicksRemaining: number;
  poisonDamagePerTick: number;
  // Killed while no Town Center stood: no respawn until one is (re)built (see respawnDeadPlayers).
  dead: boolean;
  // Hero phases 1-2: the persistent profile (gear, inventory, XP) this session plays as: the ws URL's
  // `?profile=` (the client's stored id), else "default". Several sessions with one key share it.
  profileKey: string;
  // heroProfile.version last sent in this player's snapshot (-1 = send it on the next one).
  profileSentVersion: number;
  // Hero phase 3: heroRosterVersion last sent as snapshot `heroes` (-1 = send it on the next one).
  heroesSentVersion: number;
  // Strategy mode phase 1: the free camera's view rect (px, centre + half extents) while the player is in
  // strategy mode, else null (see handleSetView); big-world snapshot culling also keeps what is inside it.
  view: { x: number; y: number; halfW: number; halfH: number } | null;
  viewSetAt: number;
  // Strategy mode phase 3: regimentOrder rate limit (REGIMENT_ORDER_MAX_PER_S per one-second window).
  orderWindowAt: number;
  orderWindowCount: number;
}

interface TileCoord {
  x: number;
  y: number;
}

interface Colonist {
  id: string;
  kind: ColonistKind;
  postX: number;
  postY: number;
  x: number;
  y: number;
  state: string;
  path: TileCoord[];

  targetResourceX: number;
  targetResourceY: number;
  chopTicksRemaining: number;
  idleCooldown: number;

  growTicksRemaining: number;
  harvestTicksRemaining: number;

  hp: number;
  maxHp: number;
  attackCooldownTicks: number;
  targetMobId: string | null;
  repathCooldown: number;

  sheltering: boolean;
  // Night shelter: a house tile, or the Town Center when homeTileX < 0. Reset each dawn.
  shelterAssigned: boolean;
  homeTileX: number;
  homeTileY: number;

  castleLevel: number;
  // The settlement (Town Center, "x,y" resourceKey) this unit counts toward. Set at spawn to the Town
  // Center nearest its post; old saves get it on load; settlementOf re-homes it if that Town Center fell.
  settlementId: string;

  healTargetType: "player" | "colonist" | null;
  healTargetId: string | null;

  rallyTileX: number;
  rallyTileY: number;
  // Exact pixel point inside the rally tile (a formation slot isn't a tile center, and two slots of
  // a diagonal formation can share one tile). See returnToRally.
  rallyX: number;
  rallyY: number;

  // Only read by updateGuardColonist (see STANCE_ALERT_RANGE_TILES / LINE_LEASH_TILES).
  stance: Stance;
  // Regiments: the formation order (commandMove.squad) this unit last marched under; its squadmates
  // march at one pace (updateSquadMarch). Missing / null: no squad (old saves, single-unit moves).
  squadId?: string | null;
  // Camp hearths: the siteId of the hearth this soldier is attacking (commanded or aggressive pick).
  targetHearthId?: string | null;
  // Strategy mode phase 4 (regimentSettings): hold fire, skirmish, cycle charge, formation shape.
  holdFire?: boolean;
  skirmish?: boolean;
  cycleCharge?: boolean;
  shape?: FormationShape;
  // Armour & weapons: the tier (0-3) taken from the stock when this unit spawned (EQUIPPED_KINDS only).
  // Missing in old saves = 0 (unequipped, today's stats).
  armourTier?: number;
  weaponTier?: number;
  // Hero phase 3: heroes only (kind "hero"). The colonist id is the hero's stable id (profile "hero:<id>",
  // which holds its XP / level / equipment). Missing on every other unit and in old saves.
  heroClass?: HeroClass;
  heroName?: string;

  poisonTicksRemaining: number;
  poisonDamagePerTick: number;

  // Hunter: the animal it is stalking/shooting (reserved via Wildlife.reservedBy). Hunter/forager:
  // the meat/fruit carried back to the hut, deposited on arrival.
  targetWildlifeId: number | null;
  carryAmount: number;

  // Builder: resourceKey of the construction site it is assigned to (see updateBuilder).
  buildSiteKey: string | null;
  // Builder: resourceKey of the damaged building it is repairing (see planRepair). Missing in old saves.
  repairKey?: string | null;
  // Farmer touring its Barn's plots (movement only): current plot key, ticks left working there, next plot index.
  farmPlotKey?: string | null;
  farmTouring?: boolean;
  farmDwellTicks?: number;
  farmNextIdx?: number;
  // Farmhand: length of the current produce cycle (chopTicksRemaining counts it down), for the art stage.
  cycleTicksTotal: number;
}

// "building": any damageable non-Town-Center building, keyed by its tile ("x,y"), walls included
// (a wall is only targeted to breach it; see pickBuildingTarget).
type MobTargetType = "colonist" | "player" | "townCenter" | "building";

interface Mob {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  path: TileCoord[];
  repathCooldown: number;
  targetType: MobTargetType | null;
  targetId: string | null;
  attackCooldownTicks: number;
  damage: number;
  speed: number;
  range: number;
  melee: boolean;
  lastDamagedTick: number;
  healCooldownTicks: number;
  isDeserter: boolean;
  deserterActive: boolean;
  deserterSinceTick: number;
  // World-gen POI guardians (ruins + encampments share one mechanic). siteId links every
  // guardian at the same site; null for night-wave mobs and deserters. Dormant (guardianActive
  // false) guardians do nothing in updateMob until any one of their site is damaged.
  siteId: string | null;
  siteKind: PoiSiteKind | null;
  guardianActive: boolean;
  // Phase 5 bosses (the Castle Ruin's Ogre Warlord, mini-boss pack leaders); missing on every other
  // mob and in old saves. bossSighted: the one-off "sighted" toast has fired for it.
  boss?: BossTier;
  bossSighted?: boolean;
  // Raid-wave group (see raidGroups). While groupId is set the mob is driven by updateRaidGroups,
  // not by updateMob's per-mob targeting; passive is true until its group turns aggressive.
  groupId: string | null;
  passive: boolean;
  // Regiments: the raid group this mob marched in, kept after its group breaks up so its ranged /
  // casters still know their front rank (see regimentFrontDistance). Missing for non-raid mobs.
  regimentId?: string | null;
  // Monster tactics (see the "Monster tactics" block); missing on most mobs and in old saves.
  //   flank - walking a flanking arc (flankWaypoints) round the enemy line to flankTargetId (a soldier)
  //   rout  - fleeing toward its regiment's home;  leave - a routed raider walking off the map (fleeX/Y)
  tactic?: "flank" | "rout" | "leave" | null;
  flankWaypoints?: { x: number; y: number }[];
  flankTargetId?: string | null;
  flankUntilTick?: number;
  // Set once a flank delivered it to its target (never sent round again; the "flankStrike" event).
  flanker?: boolean;
  fleeX?: number;
  fleeY?: number;
  leaveUntilTick?: number;
  // Hunger mark (HungerMark.None for ordinary mobs); see the HUNGER_* constants and markedMob* helpers.
  mark: HungerMark;
  // Gorrath: tick its one-off wounded fury ends (0 = never triggered; it triggers once per mob).
  furyUntilTick: number;
  // Rux: the target it has already feinted at, and the tick its current feint ends.
  feintTargetId: string | null;
  feintUntilTick: number;
  // Vhorrun: tick its withdrawal ends, and the point it backs away from meanwhile.
  withdrawUntilTick: number;
  withdrawFromX: number;
  withdrawFromY: number;
  // Building / Town Center targets: the tile to attack from, chosen by pickBuildingTarget (the route
  // there is known to be walkable). Only used while approachFor equals targetId; missing in old saves.
  approachFor?: string | null;
  approachX?: number;
  approachY?: number;
}

// Ruins and encampments are the small scattered sites; "castleRuin" is the one Castle Ruin and
// "miniBoss" a mini-boss pack (ROADMAP Phase 5). All share the dormant-until-provoked wake mechanic.
type PoiSiteKind = "ruin" | "encampment" | "castleRuin" | "miniBoss";

// Defaults for the Mob fields every creation site shares (spread into each Mob literal).
const MOB_MARK_DEFAULTS = {
  mark: HungerMark.None,
  furyUntilTick: 0,
  feintTargetId: null,
  feintUntilTick: 0,
  withdrawUntilTick: 0,
  withdrawFromX: 0,
  withdrawFromY: 0,
  approachFor: null,
  approachX: -1,
  approachY: -1,
};

interface RespawnRequest {
  tx: number;
  ty: number;
  kind: ColonistKind;
  ticksRemaining: number;
  // Hero phase 3: a fallen hero (comes back with the same id / name / class at a window, for a gold fee).
  hero?: { id: string; name: string; heroClass: HeroClass };
}

// "sown" and "growing" are one grow timer (sown = its first FARM_SOWN_FRACTION, for the client art);
// "harvesting" is the ripe crop being cut; "fallow" is the rest after FARM_HARVESTS_BEFORE_FALLOW
// harvests. See updateFarmPlots.
interface FarmPlotState {
  barnX: number;
  barnY: number;
  growTicksRemaining: number;
  // Length of the current grow phase, so the sown -> growing split can be told apart.
  growTicksTotal: number;
  harvestTicksRemaining: number;
  harvestsSinceFallow: number;
  fallowTicksRemaining: number;
  // Counts down after a harvest: the plot shows its "harvested" stubble art meanwhile (FarmStage.Harvested).
  harvestedTicksRemaining: number;
  state: "sown" | "growing" | "harvesting" | "fallow";
}

const players = new Map<string, Player>();
const colonists = new Map<string, Colonist>();
const mobs = new Map<string, Mob>();
let worldWidth = WORLD_TILES_X * TILE_SIZE;
let worldHeight = WORLD_TILES_Y * TILE_SIZE;

let tiles = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y).fill(TileType.Empty);
// Parallel to `tiles`; Biome value per tile, regenerated with the rest of the world.
let biomes = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y).fill(Biome.Plains);

const STARTING_WOOD = 80;
const STARTING_IRON = 60;
const STARTING_ROCK = 60;
// 60 (was 40): fields and animal farms now take ~3 days to deliver their first batch, so the
// opening stock has to carry a ~20-consumer colony through 3 dawns (see FARM_* / FARMHAND_*).
const STARTING_GRAIN = 60;

type ResourceKey =
  | "wood" | "iron" | "rock"
  | "grain" | "meat" | "fruit" | "wool" | "cotton"
  | "clothes" | "tools" | "luxuryItems"
  | "gold" | "alcohol";

function initialStock(): Record<ResourceKey, number> {
  return {
    wood: STARTING_WOOD,
    iron: STARTING_IRON,
    rock: STARTING_ROCK,
    grain: STARTING_GRAIN,
    meat: 0,
    fruit: 0,
    wool: 0,
    cotton: 0,
    clothes: 0,
    tools: 0,
    luxuryItems: 0,
    gold: 0,
    alcohol: 0,
  };
}

const stock: Record<ResourceKey, number> = initialStock();
let marketBuilt = false;
let goldShopBuilt = false;
let pendingEffects: AttackEffect[] = [];
const respawnQueue: RespawnRequest[] = [];
const farmPlots = new Map<string, FarmPlotState>();
const minesPlacedOnOre = new Set<string>();
const buildingLevel = new Map<string, number>();
// Towers: ticks until each Tower (resourceKey) may shoot again (transient, not saved). See the Tower block.
const towerCooldowns = new Map<string, number>();

// ---- Building hit points (mobs damage buildings; builders repair them) ----
// Max HP by building class, times BUILDING_HP_LEVEL_MULT[level - 1]. Town Centers keep their own HP
// (TOWN_CENTER_MAX_HP_BY_LEVEL). Classes: see buildingBaseHp.
// Walls & gates (2026-10-23): wood wall 60 -> 200, stone wall 250 (was BIG) -> 900; the gate sits
// between them so a mob storming a gate beats breaching stone but not wood (see breachStepCost).
const BUILDING_HP_WALL = 200;
const BUILDING_HP_STONE_WALL = 900;
const BUILDING_HP_GATE = 450;
const BUILDING_HP_SMALL = 120;
const BUILDING_HP_WORKPLACE = 180;
const BUILDING_HP_BIG = 250;
const BUILDING_HP_LEVEL_MULT = [1, 1.4, 1.8];
// A mob with no guard / player to fight goes for the nearest building; it breaks through a wall only
// when no route exists, or the route is longer than BREACH_DETOUR_FACTOR x the straight distance (and
// longer than BREACH_MIN_ROUTE_TILES, so short walks around a wall end are never breached).
const BREACH_DETOUR_FACTOR = 3;
const BREACH_MIN_ROUTE_TILES = 12;
// Passed to routeToBuilding to run the breach search (> 0). Since walls & gates (2026-10-23) the cost of
// crossing each wall / closed gate tile is breachStepCost (HP and tower defence), not this flat value.
const BREACH_WALL_COST = 8;
// How many of the nearest buildings get a route check per target pick.
const BUILDING_TARGET_CANDIDATES = 3;
// Repair: a builder heals max HP over REPAIR_SECONDS_FULL (times its builder rate); materials cost
// REPAIR_COST_FRACTION of the building's own placement cost for a full 0 -> max repair, charged
// (rounded up) for the HP missing when the repair starts.
const REPAIR_SECONDS_FULL = 60;
const REPAIR_COST_FRACTION = 0.3;
// Builders don't start (and walk away from) a repair with a mob this close to the building.
const REPAIR_MOB_CLEARANCE_TILES = 8;
// Current HP of damaged buildings (resourceKey); a building missing here is at full HP.
const buildingHp = new Map<string, number>();
// Walls & gates: state of every Gate tile, by tile index (see the "Walls & gates" block), and whose
// perspective isWalkableTile answers for: true while mobs (and wildlife) move / path (withHostileMover).
interface GateState {
  open: boolean;
  lock: GateLock;
  // Ticks since a friendly unit was last near (auto lock: closes at GATE_CLOSE_DELAY_TICKS).
  clearTicks: number;
  overrun: boolean;
}
const gates = new Map<number, GateState>();
let hostileMover = false;
// HP of repair already paid for per building (manual Repair pays up front, builders pay when they start).
const repairPaid = new Map<string, number>();
// Manual Repair requests (resourceKey), served before the automatic most-damaged pick.
const repairQueue: string[] = [];
// Cached tiles of damageable non-wall buildings for mob target picks; rebuilt when tiles change.
let buildingTargetsDirty = true;
const taskForces = new Map<number, string[]>();

function pruneTaskForces() {
  for (const [slot, unitIds] of taskForces) {
    const alive = unitIds.filter((id) => colonists.has(id));
    if (alive.length === 0) {
      taskForces.delete(slot);
      taskForceMax.delete(slot);
    } else if (alive.length !== unitIds.length) {
      taskForces.set(slot, alive);
    }
  }
}

function taskForcesForSnapshot(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [slot, unitIds] of taskForces) {
    result[String(slot)] = unitIds;
  }
  return result;
}

// Where world-gen puts the starting Town Center (the map's dead center; world-gen keeps it clear).
// Since Town Centers became placeable, gameplay reads the `townCenters` list instead.
const TOWN_CENTER_TILE: TileCoord = {
  x: Math.floor(WORLD_TILES_X / 2),
  y: Math.floor(WORLD_TILES_Y / 2),
};
// Max HP per Town Center level (1-3).
const TOWN_CENTER_MAX_HP_BY_LEVEL = [1000, 1500, 2000];
// Each level above 1 of the HIGHEST standing Town Center adds this much colony-wide productivity (via
// productionSpeedMultiplier) and unit damage (via armyDamageMultiplier): +5% at Lv2, +10% at Lv3.
const TOWN_CENTER_LEVEL_BONUS_PER_STEP = 0.05;
// ...and this much to the population base.
const TOWN_CENTER_LEVEL_POPULATION_BONUS = 5;
interface TownCenter {
  x: number;
  y: number;
  level: number;
  hp: number;
}
// Every standing Town Center (a destroyed one is removed). Reset to the starting one by generateWorld.
let townCenters: TownCenter[] = [];
let isPaused = false;

function townCenterMaxHp(level: number): number {
  return TOWN_CENTER_MAX_HP_BY_LEVEL[Math.min(Math.max(level, 1), 3) - 1];
}

function findTownCenterAt(tx: number, ty: number): TownCenter | undefined {
  return townCenters.find((tc) => tc.x === tx && tc.y === ty);
}

function nearestTownCenter(px: number, py: number): TownCenter | null {
  let best: TownCenter | null = null;
  let bestD = Infinity;
  for (const tc of townCenters) {
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
function highestTownCenterLevel(): number {
  return townCenters.reduce((max, tc) => Math.max(max, tc.level), 0);
}

function townCenterBonus(): number {
  return levelBonus(highestTownCenterLevel(), TOWN_CENTER_LEVEL_BONUS_PER_STEP);
}

// Next to the Town Center nearest `near` (default: the starting spot), or the starting spot itself
// when none stands.
function spawnPointNearTownCenter(near?: { x: number; y: number }): { x: number; y: number } {
  const tc = near ? nearestTownCenter(near.x, near.y) : townCenters[0] ?? null;
  const tile = tc ?? TOWN_CENTER_TILE;
  const approach = findAdjacentWalkable(tile.x, tile.y);
  return tileToPixelCenter(approach ?? tile);
}

function tileIndex(tx: number, ty: number): number {
  return ty * WORLD_TILES_X + tx;
}

function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < WORLD_TILES_X && ty < WORLD_TILES_Y;
}

function tileAtPixel(px: number, py: number): TileType {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  if (!inBounds(tx, ty)) return TileType.Wall;
  return tiles[tileIndex(tx, ty)] as TileType;
}

function collidesAt(px: number, py: number): boolean {
  const offsets = [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE];
  for (const ox of offsets) {
    for (const oy of offsets) {
      const t = tileAtPixel(px + ox, py + oy);
      if (isSolidTile(t) || (t === TileType.Gate && !isWalkablePixel(px + ox, py + oy))) return true;
    }
  }
  return false;
}

function tileToPixelCenter(tile: TileCoord): { x: number; y: number } {
  return {
    x: tile.x * TILE_SIZE + TILE_SIZE / 2,
    y: tile.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

function tileOfPixel(px: number, py: number): TileCoord {
  return { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
}

// Biome gameplay effects (see generateBiomes for how biomes are laid out).
const SWAMP_SPEED_PENALTY = 0.25;
const HILLS_MINING_BONUS = 0.2;
const PLAINS_FARMING_BONUS = 0.2;

function biomeAt(tx: number, ty: number): Biome {
  if (!inBounds(tx, ty)) return Biome.Plains;
  return biomes[tileIndex(tx, ty)] as Biome;
}

// Movement multiplier for any entity (player, colonist, mob), from the biome of the tile it is
// standing on right now (not where it is heading).
function biomeSpeedMultiplier(px: number, py: number): number {
  const t = tileOfPixel(px, py);
  return biomeAt(t.x, t.y) === Biome.Swamp ? 1 - SWAMP_SPEED_PENALTY : 1;
}

// Roads (Road / Cobble Road tiles): colonists and players standing on one move this much faster
// (on top of the biome multiplier). Mobs get no bonus.
const ROAD_SPEED_BONUS = 0.25;
function roadSpeedMultiplier(px: number, py: number): number {
  return isRoadTile(tileAtPixel(px, py)) ? 1 + ROAD_SPEED_BONUS : 1;
}

// Production-timer multiplier for a building, from the biome of its own tile: mines on Hills and
// farms (Farm Plot / Pasture / Orchard / Sheep / Hemp) on Plains run 20% shorter cycles.
function biomeProductionFactor(tx: number, ty: number): number {
  const tile = tiles[tileIndex(tx, ty)] as TileType;
  const biome = biomeAt(tx, ty);
  if ((tile === TileType.IronMinePost || tile === TileType.RockMinePost) && biome === Biome.Hills) {
    return 1 - HILLS_MINING_BONUS;
  }
  if ((tile === TileType.FarmPlot || FARM_PRODUCE_BY_TILE[tile] !== undefined) && biome === Biome.Plains) {
    return 1 - PLAINS_FARMING_BONUS;
  }
  return 1;
}

function tileOccupiedByEntity(tx: number, ty: number): boolean {
  for (const p of players.values()) {
    const t = tileOfPixel(p.x, p.y);
    if (t.x === tx && t.y === ty) return true;
  }
  for (const c of colonists.values()) {
    const t = tileOfPixel(c.x, c.y);
    if (t.x === tx && t.y === ty) return true;
  }
  return false;
}

tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;

// Tuned for the 80x80 map (4x the old 40x40 counts of 24/14/16, keeping per-tile density).
let TREE_COUNT = scaledCount(96);
let IRON_ORE_COUNT = scaledCount(56);
let ROCK_COUNT = scaledCount(64);

function scatterResourceTiles(tileType: TileType, count: number) {
  const spawnTx = Math.floor(WORLD_TILES_X / 2);
  const spawnTy = Math.floor(WORLD_TILES_Y / 2);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < scaledCount(1000)) {
    attempts++;
    const tx = Math.floor(Math.random() * WORLD_TILES_X);
    const ty = Math.floor(Math.random() * WORLD_TILES_Y);
    if (tx === spawnTx && ty === spawnTy) continue;
    if (isInReservedGrounds(tx, ty)) continue;
    const idx = tileIndex(tx, ty);
    if (tiles[idx] === TileType.Empty) {
      tiles[idx] = tileType;
      placed++;
    }
  }
}
function isWalkableTile(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = tiles[tileIndex(tx, ty)] as TileType;
  // Gates: passable by their state, from the current mover's side (hostileMover).
  if (t === TileType.Gate) return gatePassable(tileIndex(tx, ty), hostileMover);
  return !isSolidTile(t);
}

function findAdjacentWalkable(tx: number, ty: number): TileCoord | null {
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  for (const n of neighbors) {
    if (isWalkableTile(n.x, n.y)) return n;
  }
  return null;
}

function adjacentTilesOfType(tx: number, ty: number, type: TileType): TileCoord[] {
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  return neighbors.filter((n) => inBounds(n.x, n.y) && tiles[tileIndex(n.x, n.y)] === type);
}

const PATH_NODE_BUDGET = 60000;
function findPath(start: TileCoord, goal: TileCoord): TileCoord[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];

  const key = (t: TileCoord) => t.y * WORLD_TILES_X + t.x;
  const visited = new Set<number>([key(start)]);
  const parent = new Map<number, TileCoord>();
  const queue: TileCoord[] = [start];

  // Node budget: a request can never stall a tick on a huge map (a 160 map has 25.6k tiles in all, so
  // it is never reached there). Over budget = no path, like an unreachable goal.
  for (let head = 0; head < queue.length; head++) {
    if (head > PATH_NODE_BUDGET) return null;
    const current = queue[head];
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isWalkableTile(n.x, n.y)) continue;
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, current);
      if (n.x === goal.x && n.y === goal.y) {
        const path: TileCoord[] = [n];
        let back = current;
        while (!(back.x === start.x && back.y === start.y)) {
          path.unshift(back);
          back = parent.get(key(back))!;
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

// advanceAlongPath: how near (px) an intermediate waypoint's tile centre counts as reached.
const PATH_WAYPOINT_TOLERANCE_PX = 10;

function advanceAlongPath(
  entity: { x: number; y: number; path: TileCoord[] },
  dt: number,
  speed: number
) {
  if (entity.path.length === 0) return;
  // A gate on the path closed (or was locked) since it was planned: drop the path so the mover replans.
  const nextTile = entity.path[0];
  if (inBounds(nextTile.x, nextTile.y) && tiles[tileIndex(nextTile.x, nextTile.y)] === TileType.Gate && !isWalkableTile(nextTile.x, nextTile.y)) {
    entity.path = [];
    return;
  }
  const target = tileToPixelCenter(entity.path[0]);
  const ddx = target.x - entity.x;
  const ddy = target.y - entity.y;
  const dist = Math.hypot(ddx, ddy);
  // The road bonus is for colonists only (players move by input, mobs never get it).
  const isColonist = colonists.get((entity as { id?: string }).id ?? "") === entity;
  const road = isColonist ? roadSpeedMultiplier(entity.x, entity.y) : 1;
  const step = speed * biomeSpeedMultiplier(entity.x, entity.y) * road * dt;
  if (dist <= step) {
    entity.x = target.x;
    entity.y = target.y;
    entity.path.shift();
  } else if (entity.path.length > 1 && dist <= PATH_WAYPOINT_TOLERANCE_PX) {
    // Close enough to a waypoint that isn't the last: move on toward the next one. Bodies pushing each
    // other apart can never all stand on one tile centre, and used to orbit it forever (a squad stuck
    // in a knot on its way to its formation). Tile centres of a 4-connected path are edge-adjacent, so
    // the straight line from anywhere in this tile to the next centre stays on those two tiles.
    entity.path.shift();
    const next = tileToPixelCenter(entity.path[0]);
    const nd = Math.hypot(next.x - entity.x, next.y - entity.y);
    if (nd > 0) {
      const s = Math.min(step, nd);
      entity.x += ((next.x - entity.x) / nd) * s;
      entity.y += ((next.y - entity.y) / nd) * s;
    }
  } else {
    entity.x += (ddx / dist) * step;
    entity.y += (ddy / dist) * step;
  }
}

const reservedResourceTiles = new Map<string, string>();

function resourceKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function releaseResourceReservation(c: Colonist) {
  // A builder leaving its site (night shelter, death, desertion) frees its slot there; the site stays.
  c.buildSiteKey = null;
  c.repairKey = null;
  if (c.targetWildlifeId !== null) {
    const animal = wildlife.get(c.targetWildlifeId);
    if (animal && animal.reservedBy === c.id) animal.reservedBy = null;
    c.targetWildlifeId = null;
  }
  if (c.targetResourceX < 0 || c.targetResourceY < 0) return;
  const key = resourceKey(c.targetResourceX, c.targetResourceY);
  if (reservedResourceTiles.get(key) === c.id) {
    reservedResourceTiles.delete(key);
  }
}

// ---- Long days (2026-10-23): a 5-minute day and a 75 s night (was 60 s + 40 s). ----
// The night stays short so raids stay tense; the day is long so there's more to DO between raids.
// LEGACY_* is the old cycle: rates that must not slow down in real time are written as
// legacy-rate x DAY_LENGTH_SCALE / DAYLIGHT_SCALE (see ROADMAP "Long days & dawn/dusk respawns").
const DAY_TICKS = TICK_RATE * 300;
const NIGHT_TICKS = TICK_RATE * 75;
const LEGACY_DAY_TICKS = TICK_RATE * 60;
const LEGACY_NIGHT_TICKS = TICK_RATE * 40;
// Real-time length of a whole cycle vs the old one (375 s / 100 s = 3.75) and of the daylight (5).
const DAY_LENGTH_SCALE = (DAY_TICKS + NIGHT_TICKS) / (LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS);
const DAYLIGHT_SCALE = DAY_TICKS / LEGACY_DAY_TICKS;
let cycleTick = 0;
function isNightNow(): boolean {
  const t = cycleTick % (DAY_TICKS + NIGHT_TICKS);
  return t >= DAY_TICKS;
}

const GUARD_ALERT_RANGE_TILES = 7;
// Per-stance combat tuning for guard-tier units. Alert range: how close (from the unit) a mob must be
// before it's picked up as a target; "normal" is the original flat GUARD_ALERT_RANGE_TILES, so a unit
// nobody touches behaves as before. Chase leash: how far from its own rally point (rallyX/rallyY) a
// unit will go while closing on an out-of-range target before giving up and walking home.
const STANCE_ALERT_RANGE_TILES: Record<Stance, number> = {
  defensive: 3,
  normal: GUARD_ALERT_RANGE_TILES,
  aggressive: 12,
};
// Line discipline: how far (tiles) a soldier may leave its rally slot to fight. Only mobs within this
// leash + attack range of the slot are picked up, a chase past it is dropped, and the unit walks back
// to its slot afterwards, so the line re-forms instead of dissolving. (Replaced the old 2/10/20 leash.)
// Battle discipline (2026-10-23) tightened normal 4 -> 3 and aggressive 8 -> 6 so a line holds its shape.
const LINE_LEASH_TILES: Record<Stance, number> = {
  defensive: 1.5,
  normal: 3,
  aggressive: 6,
};
// Battle discipline: a soldier with no commanded target fights the enemy nearest to ITS OWN slot (not to
// wherever the scrum has pushed it), and re-checks once a second while not trading blows, switching
// only when another enemy is clearly nearer the slot (below this fraction of the current one's distance).
const SLOT_RETARGET_FACTOR = 0.7;
// Melee attackers per unit target (see meleeAttackerCap): surplus attackers pick another enemy with room
// or wait (a queue) - soldiers on their own formation slot, mobs standing off this far outside strike
// range - instead of everyone piling onto one target. Players are exempt (their ring decides).
const QUEUE_STANDOFF_PX = TILE_SIZE * 1.2;
// A melee attacker this close (px) to strike range closes straight on its target rather than walking
// round to its ring slot (it slides there while fighting); the far side can be walled off by bodies.
const SLOT_CLOSE_IN_PX = TILE_SIZE * 0.5;
// How much further (px) a melee mob will go for a soldier with room than for the nearest one (pickMobTarget).
const MOB_ROOM_DETOUR_PX = TILE_SIZE * 4;
// Archers don't advance past the front rank: the nearest friendly melee soldier (within this many
// tiles of the archer) to the target marks the front.
const ARCHER_FRONT_RANK_SCAN_TILES = 6;
// Regiments & roles: a ranged unit (archer, or a raid's crossbow / archer / shaman) with a friendly front
// rank near it kites a step back when an enemy melee unit comes within this many tiles.
const RANGED_KITE_TILES = 2;
// Squad march (updateSquadMarch): a squad on a formation move advances at its slowest member's pace;
// a member more than SQUAD_LEAD_TOLERANCE_TILES ahead of its place in the formation slows to
// SQUAD_AHEAD_SPEED_FACTOR of that pace, one that far behind catches up at its own speed. Within
// SQUAD_SETTLE_TILES of the destination (centroid of the slots) members settle onto their slots alone;
// with a member over SQUAD_BROKEN_TILES out of place the line is broken and nobody waits.
const SQUAD_LEAD_TOLERANCE_TILES = 1;
const SQUAD_AHEAD_SPEED_FACTOR = 0.25;
const SQUAD_SETTLE_TILES = 2.5;
const SQUAD_BROKEN_TILES = 6;

// Mob aggro: a guard / militia or a player is only a mob target within these ranges (tiles) of the mob;
// otherwise the mob goes for buildings. A mob already on a unit drops it past MOB_AGGRO_DROP_FACTOR x.
const MOB_AGGRO_RANGE_GUARD_TILES = 9;
const MOB_AGGRO_RANGE_PLAYER_TILES = 7;
const MOB_AGGRO_DROP_FACTOR = 1.5;
// A mob (or marching raid group) heading for the Town Center turns on any non-wall building it passes
// within this many tiles ("if they find houses first they destroy the houses").
const MOB_BUILDING_AGGRO_TILES = 6;

// ---- Bodies (separation) ----
// Body radii in px: colonists, and mobs by kind (about 0.9 x the client's MOB_VISUALS radius). Players
// have no body. separateBodies pushes overlapping bodies apart after everyone has moved.
const COLONIST_BODY_RADIUS = 7;
const PLAYER_BODY_RADIUS = 8;
const MOB_BODY_RADIUS: Record<MobKind, number> = {
  goblin: 7,
  wolf: 7.5,
  goblinCrossbow: 7,
  orc: 9,
  skeleton: 8,
  armoredOrc: 10,
  giantSpider: 8.5,
  darkShaman: 7.5,
  troll: 12,
  ogre: 14,
  banditClubman: 7.5,
  banditArcher: 7.5,
  banditElite: 9,
  halfLatch: 5.5,
  batteringRam: 12,
  catapult: 11,
};
const SEPARATION_ITERATIONS = 2;
// Share of an overlap a stationary / attacking body takes vs a moving one (normalised per pair).
const SEPARATION_WEIGHT_STILL = 0.3;
const SEPARATION_WEIGHT_MOVING = 0.7;
// Nothing within this many tiles of an active ward source (a staffed Ward Stone, or Saint Wren's
// Abbey, which is always warded) can be chosen as a mob target. See activeWardSources.
const WARD_RADIUS_TILES = 12;
const LEVEL_BONUS_PER_STEP = 0.05;

function levelBonus(level: number, step = LEVEL_BONUS_PER_STEP): number {
  return (Math.min(Math.max(level, 1), 3) - 1) * step;
}

function getBuildingLevel(tx: number, ty: number): number {
  return buildingLevel.get(resourceKey(tx, ty)) ?? 1;
}

const KNIGHT_LEVEL_STATS = [
  { maxHp: 60, damage: 12 },
  { maxHp: 100, damage: 20 },
  { maxHp: 160, damage: 32 },
];
const KNIGHT_ATTACK_RANGE = TILE_SIZE * 0.8;
const KNIGHT_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.8);
const KNIGHT_SPEED = 110;

const ARCHER_MAX_HP = 35;
const ARCHER_DAMAGE = 8;
const ARCHER_ATTACK_RANGE = TILE_SIZE * 4;
const ARCHER_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 1.2);
const ARCHER_SPEED = 100;

const MILITIA_LEVEL_STATS = [
  { maxHp: 30, damage: 6 },
  { maxHp: 50, damage: 10 },
  { maxHp: 80, damage: 16 },
];
const MILITIA_SPEED = 120;

const CIVILIAN_MAX_HP = 20;

// ---- Cavalry & siege (ROADMAP "Cavalry & siege") ----
// Cavalry: knight HP / damage per Stables level, 1.6x the knight's speed, and a charge: the first blow
// after riding CAVALRY_CHARGE_TILES in a straight line deals CAVALRY_CHARGE_MULT x (then
// CAVALRY_CHARGE_COOLDOWN_TICKS before the next charge can land). See trackCharge.
const CAVALRY_SPEED = Math.round(KNIGHT_SPEED * 1.6);
const CAVALRY_CHARGE_TILES = 5;
const CAVALRY_CHARGE_MULT = 2;
const CAVALRY_CHARGE_COOLDOWN_TICKS = 8 * TICK_RATE;
// A charge run survives this long standing still (the tick between the last stride and the blow).
const CAVALRY_CHARGE_IDLE_GRACE_TICKS = TICK_RATE;
// Siege engines (the player's and the raids' share these numbers). Ram: slow, very tough, melee, x4
// damage vs buildings / walls / gates, x0.3 vs units. Catapult: a boulder every 4 s at 3..11 tiles,
// splashing everything of the other side within 1.5 tiles (x3 vs buildings).
const RAM_MAX_HP = KNIGHT_LEVEL_STATS[0].maxHp * 4;
const RAM_DAMAGE = 12;
const RAM_SPEED = Math.round(KNIGHT_SPEED * 0.5);
const RAM_ATTACK_COOLDOWN_TICKS = 2 * TICK_RATE;
const SIEGE_BUILDING_MULT = 4;
const RAM_UNIT_MULT = 0.3;
const CATAPULT_MAX_HP = ARCHER_MAX_HP * 2;
const CATAPULT_DAMAGE = 18;
const CATAPULT_SPEED = 50;
const CATAPULT_RANGE = TILE_SIZE * 11;
const CATAPULT_MIN_RANGE = TILE_SIZE * 3;
const CATAPULT_RELOAD_TICKS = 4 * TICK_RATE;
const CATAPULT_SPLASH_PX = TILE_SIZE * 1.5;
const CATAPULT_BUILDING_MULT = 3;
// Siege Workshop production: one engine at a time, SIEGE_BUILD_TICKS each, SIEGE_WORKSHOP_CAP alive per
// workshop, SIEGE_POPULATION_COST population each (counted in civilianPopulationUsed).
const SIEGE_BUILD_TICKS = 30 * TICK_RATE;
const SIEGE_WORKSHOP_CAP = 2;
const SIEGE_POPULATION_COST = 2;
// ---- Hero phase 3: heroes (ROADMAP "Hero phase 3: heroes"; the rest lives after the Hero phases 1-2 block) ----
// Class base stats; level (+4% damage, +6% HP per level) and equipment come on top via computeHeroStats.
const HERO_CLASS_STATS: Record<HeroClass, { maxHp: number; damage: number; range: number; cooldown: number; speed: number; melee: boolean }> = {
  champion: { maxHp: 160, damage: 26, range: KNIGHT_ATTACK_RANGE, cooldown: KNIGHT_ATTACK_COOLDOWN_TICKS, speed: 110, melee: true },
  marksman: { maxHp: 90, damage: 16, range: ARCHER_ATTACK_RANGE + TILE_SIZE, cooldown: ARCHER_ATTACK_COOLDOWN_TICKS, speed: 100, melee: false },
  // A magic bolt (the client draws a Dark Shaman's bolt for it); spells are phase 4.
  mage: { maxHp: 80, damage: 14, range: TILE_SIZE * 7, cooldown: Math.round(TICK_RATE * 1.5), speed: 95, melee: false },
};
const HERO_POPULATION_COST = 2;
// Bumped whenever a hero is recruited / spawns / dies / changes gear or XP: snapshot `heroes` is resent.
let heroRosterVersion = 0;
const SIEGE_UNIT_COST: Record<SiegeKind, Partial<Record<"wood" | "iron" | "rock", number>>> = {
  batteringRam: { wood: 30, iron: 10 },
  catapult: { wood: 25, iron: 15 },
};
const SIEGE_LABEL: Record<SiegeKind, string> = { batteringRam: "Battering Ram", catapult: "Catapult" };
// Building costs: Stables (per level, like the Hall of the Sworn's iron + rock, plus wood) and the Workshop.
const STABLES_COSTS = [
  { wood: 20, rock: 10, iron: 10 },
  { wood: 30, rock: 20, iron: 20 },
  { wood: 45, rock: 30, iron: 30 },
];
const SIEGE_WORKSHOP_COST = { wood: 30, iron: 15, rock: 15 };
// Siege mobs pay this much more gold.
const SIEGE_GOLD_MULT = 2;

// ---- Armour & weapons (ROADMAP "Armour & weapons — landed 2026-10-28") ----
// A colony-wide stock of armour and weapons by tier 1..3 (index tier - 1). Each EQUIPPED_KINDS unit takes
// the highest tier in stock of each slot (independently) when it spawns; with none it spawns unequipped
// (tier 0). Weapons scale damage dealt, armour damage taken; max HP is unchanged by either.
const EQUIP_TIERS = 3;
const EQUIPPED_KINDS: ColonistKind[] = ["knight", "spearman", "pikeman", "cavalry"];
// Indexed by tier 0..3 (0 = unequipped).
const WEAPON_DAMAGE_MULT = [1, 1.2, 1.4, 1.7];
const ARMOUR_DAMAGE_TAKEN_MULT = [1, 0.85, 0.7, 0.55];
// Blacksmith forging: the tier forged = the Blacksmith's level. Indexed by tier - 1.
const FORGE_ARMOUR_IRON = [3, 5, 8];
const FORGE_WEAPON_IRON = [2, 4, 6];
const FORGE_WEAPON_WOOD = 1;
// Armour above tier 1 also takes (tier - 1) tools, or that much wood when the stock has too few tools.
const FORGE_TICKS: Record<EquipSlot, number> = { armour: 15 * TICK_RATE, weapon: 10 * TICK_RATE };
const FORGE_QUEUE_CAP = 5;
// Drops: an armoured enemy (EQUIP_ARMOURED_KINDS, any boss / mini-boss elite, any Hunger-marked mob) killed
// by the colony's side drops one tier-1 piece (armour / weapon 50/50) with EQUIP_DROP_CHANCE; bosses and
// marked mobs always drop one.
const EQUIP_ARMOURED_KINDS: MobKind[] = ["armoredOrc", "banditElite"];
const EQUIP_DROP_CHANCE = 0.35;
// Camp / boss loot: pieces of a random tier 1..3, weighted EQUIP_LOOT_TIER_WEIGHTS.
const EQUIP_LOOT_TIER_WEIGHTS = [0.5, 0.35, 0.15];
// Extra tiered pieces for the Ogre Warlord / a mini-boss elite (on top of their guaranteed tier-1 drop).
const BOSS_EQUIP_LOOT: Record<BossTier, number> = { warlord: 4, elite: 2 };
const EQUIP_TOAST_THROTTLE_TICKS = 60 * TICK_RATE;
const equipment: EquipmentStock = { armour: [0, 0, 0], weapon: [0, 0, 0] };
const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = { armour: "armour", weapon: "weapon" };

function isSiegeKind(kind: string): kind is SiegeKind {
  return kind === "batteringRam" || kind === "catapult";
}

function guardStats(kind: ColonistKind, level: number) {
  // Heroes: class base stats (unitStats adds level + equipment); champion as the class-less fallback.
  if (kind === "hero") return heroBaseStats("champion");
  if (kind === "cavalry") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = KNIGHT_LEVEL_STATS[lvl];
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - levelBonus(level))),
      speed: CAVALRY_SPEED,
      melee: true,
    };
  }
  if (kind === "batteringRam") {
    return { maxHp: RAM_MAX_HP, damage: RAM_DAMAGE, range: KNIGHT_ATTACK_RANGE, cooldown: RAM_ATTACK_COOLDOWN_TICKS, speed: RAM_SPEED, melee: true };
  }
  if (kind === "catapult") {
    return { maxHp: CATAPULT_MAX_HP, damage: CATAPULT_DAMAGE, range: CATAPULT_RANGE, cooldown: CATAPULT_RELOAD_TICKS, speed: CATAPULT_SPEED, melee: false };
  }
  if (kind === "knight") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = KNIGHT_LEVEL_STATS[lvl];
    const speedBonus = levelBonus(level);
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - speedBonus)),
      speed: KNIGHT_SPEED,
      melee: true,
    };
  }
  if (kind === "militia" || kind === "spearman" || kind === "pikeman") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = MILITIA_LEVEL_STATS[lvl];
    const speedBonus = levelBonus(level);
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - speedBonus)),
      speed: MILITIA_SPEED,
      melee: true,
    };
  }
  const bonus = levelBonus(level);
  return {
    maxHp: Math.round(ARCHER_MAX_HP * (1 + bonus)),
    damage: Math.ceil(ARCHER_DAMAGE * (1 + bonus)),
    range: ARCHER_ATTACK_RANGE,
    cooldown: Math.round(ARCHER_ATTACK_COOLDOWN_TICKS * (1 - bonus)),
    speed: ARCHER_SPEED,
    melee: false,
  };
}

function militiaCountForLevel(level: number): number {
  if (level >= 3) return 10;
  if (level >= 2) return 6;
  return 2;
}

function militiaKindForLevel(level: number): ColonistKind {
  if (level >= 3) return "pikeman";
  if (level >= 2) return "spearman";
  return "militia";
}

function militiaLevelForTile(t: TileType): number {
  if (t === TileType.MilitiaCamp2) return 2;
  if (t === TileType.MilitiaCamp3) return 3;
  return 1;
}

function isMilitiaLineKind(kind: ColonistKind): boolean {
  return kind === "militia" || kind === "spearman" || kind === "pikeman";
}

function isGuardOrMilitiaKind(kind: ColonistKind) {
  return kind === "knight" || kind === "archer" || kind === "cavalry" || kind === "hero" || isSiegeKind(kind) || isMilitiaLineKind(kind);
}

// Soldiers that can desert (siege engines and heroes can't; heroes count population via populationCostOf).
function isSoldierKind(kind: ColonistKind): boolean {
  return isGuardOrMilitiaKind(kind) && !isSiegeKind(kind) && kind !== "hero";
}

// Combat stats of a living soldier: heroes derive theirs from class + level + equipment (heroCombatStats).
function unitStats(c: Colonist) {
  const s = c.kind === "hero" ? heroCombatStats(c) : guardStats(c.kind, c.castleLevel);
  // Hero phase 4: a Rally Banner buff speeds the unit up.
  const buff = spellBuffSpeedMult("c:" + c.id);
  return buff === 1 ? s : { ...s, speed: s.speed * buff };
}

// Speed/range/damage fallbacks for deserter mobs, which take their stats from the deserting
// colonist rather than from MOB_KIND_CONFIG.
const MOB_SPEED = 70;
const MOB_DAMAGE = 5;
const MOB_ATTACK_COOLDOWN_TICKS = TICK_RATE;
const MOB_ATTACK_RANGE = TILE_SIZE * 0.8;
const MOB_REPATH_TICKS = TICK_RATE;
// Flat per-kill gold regardless of monster tier made an Ogre pay the same as a Goblin. Scale off
// the mob's own current maxHp/damage instead of a lookup table, so this also naturally covers
// deserted-colonist mobs (whose stats already reflect how dangerous they were in service).
const GOLD_PER_KILL_BASE_DIVISOR = 8;
const GOLD_PER_KILL_MIN = 3;
function goldForKill(mob: Mob): number {
  const raw = Math.max(GOLD_PER_KILL_MIN, Math.round((mob.maxHp + mob.damage * 2) / GOLD_PER_KILL_BASE_DIVISOR));
  const base = isSiegeKind(mob.kind) ? raw * SIEGE_GOLD_MULT : raw;
  return mob.mark !== HungerMark.None ? base * HUNGER_MARK_GOLD_MULT : base;
}

// ---- Hunger-marked elites (ROADMAP Phase 6) ----
// At raid spawn each fresh raider may bear one of the six Hungers' marks (uniform pick). The chance
// is 0 before raid day HUNGER_MARK_MIN_DAY (0-based dayIndex, same as unlockDay), then rises
// linearly from HUNGER_MARK_CHANCE_START to HUNGER_MARK_CHANCE_MAX at HUNGER_MARK_CHANCE_MAX_DAY
// (flat after). At most one mark per HUNGER_MARK_RAIDERS_PER_MARK raiders (min 1). Deserters are
// never marked. A marked mob gets x1.5 hp, x1.25 damage and pays x3 gold.
const HUNGER_MARK_MIN_DAY = 3;
const HUNGER_MARK_CHANCE_START = 0.03;
const HUNGER_MARK_CHANCE_MAX = 0.15;
const HUNGER_MARK_CHANCE_MAX_DAY = 30;
const HUNGER_MARK_RAIDERS_PER_MARK = 5;
const HUNGER_MARK_HP_MULT = 1.5;
const HUNGER_MARK_DAMAGE_MULT = 1.25;
const HUNGER_MARK_GOLD_MULT = 3;
// Gunne / Gorrath re-evaluate their pick once a second (ordinary mobs keep a target until it's gone).
const MARK_RETARGET_TICKS = TICK_RATE;
// Gorrath (frenzy): the first blow that would kill it leaves it at GORRATH_FURY_HP_FRACTION of its
// max hp instead and starts a wounded fury for GORRATH_FURY_TICKS, during which it takes only
// GORRATH_FURY_DAMAGE_TAKEN of incoming damage. Once per mob. It targets the healthiest (highest
// current hp) guard / militia / player within GORRATH_SCAN_RANGE_TILES.
const GORRATH_FURY_HP_FRACTION = 0.2;
const GORRATH_FURY_TICKS = 4 * TICK_RATE;
const GORRATH_FURY_DAMAGE_TAKEN = 0.5;
const GORRATH_SCAN_RANGE_TILES = 8;
// Gunne: targets the guard / militia / player with the lowest hp fraction within
// GUNNE_SCAN_RANGE_TILES, as long as one is wounded at all (else ordinary targeting).
const GUNNE_SCAN_RANGE_TILES = 10;
// Rux (feint): the first time it closes to attack range on a new target it backs off for
// RUX_FEINT_TICKS instead of striking, then comes back and commits (one feint per target).
const RUX_FEINT_TICKS = Math.round(1.5 * TICK_RATE);
// Morvain (hard to track): guards only notice it within MORVAIN_DETECTION_FACTOR of their alert
// range, and a guard chasing it loses the lock once it's further away than that reduced range.
const MORVAIN_DETECTION_FACTOR = 0.5;
// Vhorrun (hit-and-run): after a hit that leaves its (colonist / player) target below
// VHORRUN_WITHDRAW_TARGET_HP of max hp, it drops the target and backs away for VHORRUN_WITHDRAW_TICKS,
// then picks a target afresh.
const VHORRUN_WITHDRAW_TARGET_HP = 0.4;
const VHORRUN_WITHDRAW_TICKS = 6 * TICK_RATE;
// Nemri (avoids engagement): ignores guards and players and makes straight for the nearest unwarded
// Town Center (the thing being guarded); with none, ordinary targeting.
// testHook "forceMarkChance" {value}: overrides the per-raider chance (null restores it).
let testForceMarkChance: number | null = null;

function hungerMarkChance(dayIndex: number): number {
  if (testForceMarkChance !== null) return testForceMarkChance;
  if (dayIndex < HUNGER_MARK_MIN_DAY) return 0;
  const t = Math.min(1, (dayIndex - HUNGER_MARK_MIN_DAY) / (HUNGER_MARK_CHANCE_MAX_DAY - HUNGER_MARK_MIN_DAY));
  return HUNGER_MARK_CHANCE_START + (HUNGER_MARK_CHANCE_MAX - HUNGER_MARK_CHANCE_START) * t;
}

function applyHungerMark(mob: Mob, mark: HungerMark) {
  mob.mark = mark;
  mob.maxHp = Math.max(1, Math.round(mob.maxHp * HUNGER_MARK_HP_MULT));
  mob.hp = mob.maxHp;
  mob.damage = Math.max(1, Math.round(mob.damage * HUNGER_MARK_DAMAGE_MULT));
}

function hungerMarkLabel(mark: HungerMark): string {
  const name = HUNGER_MARK_NAMES[mark] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// "armoredOrc" -> "armored orc", for event text.
function mobKindLabel(kind: MobKind): string {
  return kind.replace(/([A-Z])/g, " $1").toLowerCase();
}

// Difficulty (chosen on the client's main menu). Scales RAID-WAVE mobs only (createRaidMob and the
// raid size); POI guardians, deserters and the Half-Latch are untouched.
interface DifficultyTuning {
  mobDamage: number;
  mobHp: number;
  spawnCount: number;
}
const DIFFICULTY_EASY: DifficultyTuning = { mobDamage: 0.75, mobHp: 0.8, spawnCount: 0.75 };
const DIFFICULTY_NORMAL: DifficultyTuning = { mobDamage: 1, mobHp: 1, spawnCount: 1 };
const DIFFICULTY_HARD: DifficultyTuning = { mobDamage: 1.35, mobHp: 1.3, spawnCount: 1.35 };
const DIFFICULTY_TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: DIFFICULTY_EASY,
  normal: DIFFICULTY_NORMAL,
  hard: DIFFICULTY_HARD,
};
// The world-wide setting. The first setDifficulty after a fresh (re)start claims it; later ones are
// ignored unless the world is still on its first day with only the sender connected (so a solo
// player can change their mind) or a restart carries a new value.
let difficulty: Difficulty = "normal";
let difficultyClaimed = false;
function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}
function handleSetDifficulty(value: unknown, worldSize?: unknown) {
  if (!isDifficulty(value)) return;
  const soloFirstDay = players.size <= 1 && cycleTick < DAY_TICKS;
  if (difficultyClaimed && !soloFirstDay) return;
  // New Game with a different map size: regenerate the (still unclaimed / first-day solo) world at it.
  if (typeof worldSize === "number" && Number.isFinite(worldSize) && clampWorldSize(worldSize) !== WORLD_TILES_X) {
    resetWorld(value, worldSize);
    return;
  }
  difficulty = value;
  difficultyClaimed = true;
}

interface MobKindConfig {
  maxHp: number;
  damage: number;
  speed: number;
  range: number; // in pixels, already multiplied by TILE_SIZE
  melee: boolean;
  unlockDay: number;
}

const MOB_KIND_CONFIG: Record<MobKind, MobKindConfig> = {
  goblin: { maxHp: 18, damage: 4, speed: 95, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  wolf: { maxHp: 22, damage: 6, speed: 130, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  goblinCrossbow: { maxHp: 16, damage: 6, speed: 80, range: TILE_SIZE * 4, melee: false, unlockDay: 1 },
  orc: { maxHp: 45, damage: 10, speed: 75, range: TILE_SIZE * 0.8, melee: true, unlockDay: 3 },
  skeleton: { maxHp: 50, damage: 8, speed: 60, range: TILE_SIZE * 0.8, melee: true, unlockDay: 4 },
  armoredOrc: { maxHp: 80, damage: 14, speed: 55, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6 },
  giantSpider: { maxHp: 35, damage: 7, speed: 115, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6 },
  darkShaman: { maxHp: 25, damage: 12, speed: 70, range: TILE_SIZE * 5, melee: false, unlockDay: 7 },
  troll: { maxHp: 120, damage: 16, speed: 65, range: TILE_SIZE * 0.8, melee: true, unlockDay: 10 },
  ogre: { maxHp: 220, damage: 28, speed: 50, range: TILE_SIZE * 0.8, melee: true, unlockDay: 12 },
  // Bandits: encampment guardians (ENCAMPMENT_GUARDIAN_WEIGHTS, unaffected by unlockDay) and,
  // since raid waves, the Bandit band faction (RAID_FACTIONS).
  banditClubman: { maxHp: 30, damage: 7, speed: 85, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  banditArcher: { maxHp: 25, damage: 8, speed: 75, range: TILE_SIZE * 4, melee: false, unlockDay: 0 },
  banditElite: { maxHp: 70, damage: 14, speed: 70, range: TILE_SIZE * 0.8, melee: true, unlockDay: 3 },
  // Half-Latch: the minor demon that slips through when a Ward Stone's ward lapses (see
  // checkWardStoneLapses). Deliberately a nuisance, not a threat. In no raid faction; unlockDay is
  // unreachable as a backstop.
  halfLatch: {
    maxHp: 12,
    damage: 3,
    speed: 90,
    range: TILE_SIZE * 0.8,
    melee: true,
    unlockDay: Number.POSITIVE_INFINITY,
  },
  // Siege engines (Cavalry & siege): the orc and bandit factions' non-core extras, at most
  // raidSiegeCap(day) of them per raid. See updateSiegeMob.
  batteringRam: { maxHp: RAM_MAX_HP, damage: RAM_DAMAGE, speed: RAM_SPEED, range: TILE_SIZE * 0.8, melee: true, unlockDay: 10 },
  catapult: { maxHp: CATAPULT_MAX_HP, damage: CATAPULT_DAMAGE, speed: CATAPULT_SPEED, range: CATAPULT_RANGE, melee: false, unlockDay: 14 },
};

// ---- Raid waves: tuning ----
// Halfway through each day the whole of tonight's raid spawns at once at the map edge, in passive
// groups (see spawnRaid / updateRaidGroups). Raid size = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex,
// times the difficulty spawnCount (rounded, min 1). No cap.
const RAID_BASE_SIZE = 5;
const RAID_SIZE_PER_DAY = 2;
// The horde (one big group) takes this share of the raid, rolled uniformly in [MIN, MAX] and rounded
// up, so it is always at least half. The rest split into random groups of GROUP_SIZE_MIN..MAX.
const RAID_HORDE_SHARE_MIN = 0.5;
const RAID_HORDE_SHARE_MAX = 0.7;
const RAID_GROUP_SIZE_MIN = 2;
const RAID_GROUP_SIZE_MAX = 6;

// Factions: each raid group is built from ONE faction. A faction is eligible on a day when at least
// one of its `core` kinds is unlocked (MOB_KIND_CONFIG unlockDay), and is picked with weight = the
// number of its unlocked core kinds. Inside a group, kinds are picked by `weight` among the faction's
// unlocked entries (core or not). Non-core entries are heavies/supplements: they never make a
// faction eligible by themselves (so goblins alone don't unlock the Dark host on day 0).
type RaidFactionId = "wolfPack" | "banditBand" | "greenskinWarband" | "darkHost";
interface RaidFactionEntry {
  kind: MobKind;
  weight: number;
  core: boolean;
}
const RAID_FACTIONS: Record<RaidFactionId, RaidFactionEntry[]> = {
  wolfPack: [{ kind: "wolf", weight: 1, core: true }],
  // On a deserter night the eligible deserters are the raid's core and only this faction fills
  // the rest of the raid (see spawnRaid).
  banditBand: [
    { kind: "banditClubman", weight: 5, core: true },
    { kind: "banditArcher", weight: 3, core: true },
    { kind: "banditElite", weight: 1, core: true },
    { kind: "batteringRam", weight: 1, core: false },
    { kind: "catapult", weight: 1, core: false },
  ],
  greenskinWarband: [
    { kind: "goblin", weight: 10, core: true },
    { kind: "goblinCrossbow", weight: 4, core: true },
    { kind: "orc", weight: 5, core: true },
    { kind: "armoredOrc", weight: 3, core: true },
    { kind: "troll", weight: 1, core: false },
    { kind: "ogre", weight: 1, core: false },
    { kind: "batteringRam", weight: 1, core: false },
    { kind: "catapult", weight: 1, core: false },
  ],
  darkHost: [
    { kind: "skeleton", weight: 4, core: true },
    { kind: "giantSpider", weight: 3, core: true },
    { kind: "darkShaman", weight: 2, core: true },
    { kind: "troll", weight: 1, core: false },
    { kind: "ogre", weight: 1, core: false },
    { kind: "goblin", weight: 1, core: false },
    { kind: "orc", weight: 1, core: false },
  ],
};

// Day-phase tick (within the cycle) at which the raid spawns: the midpoint of the day.
const RAID_SPAWN_CYCLE_TICK = Math.floor(DAY_TICKS / 2);
// Arrival timing (2026-10-24): every edge-spawned group is timed to REACH the colony after nightfall but
// before RAID_ARRIVAL_WINDOW_FRACTION of the way into the night. At spawn its travel time (path length
// x RAID_TRAVEL_SLACK / the slowest member's speed, plus RAID_TRAVEL_MARGIN_TICKS) is subtracted from a
// random arrival tick in that window to get its departure (aggroTick), never earlier than the spawn.
// A group that gets to contact range before nightfall holds in formation (passive, no attacking) until
// night falls, or until it is attacked.
const RAID_ARRIVAL_WINDOW_FRACTION = 2 / 3;
const RAID_TRAVEL_SLACK = 1.15;
const RAID_TRAVEL_MARGIN_TICKS = TICK_RATE * 8;
// Raiders spawn on walkable tiles within this many tiles of the map border.
const RAID_EDGE_BAND_TILES = 3;
// Passive raiders wander one tile at a time, never more than this far (Chebyshev) from their spawn.
const RAID_LOITER_RADIUS_TILES = 3;
const RAID_LOITER_CHANCE_PER_TICK = 1 / (TICK_RATE * 3);
// A marching group breaks up into normal per-mob targeting once its leader is this close to the
// colony (Town Center) or to any targetable guard/player.
const RAID_ENGAGE_RANGE_TILES = 8;
// Followers may move this much faster than the group pace to catch up with their formation slot.
const RAID_FOLLOWER_CATCHUP = 1.5; // battle discipline 2026-10-23: was 1.25 (followers took most of a march to form up)
// Formation: heading-relative staggered rows per faction (see raidFormationSlots). Slot spacing is
// RAID_FORMATION_SPACING_BODIES x the group's mean body diameter; heavies (troll / ogre) take the front
// centre, ranged kinds the rear rows. On contact rows are released one by one, RAID_RELEASE_ROW_TICKS apart.
type RaidFormationShape = "wedge" | "line" | "column";
const RAID_FORMATION_SHAPE: Record<RaidFactionId, RaidFormationShape> = {
  wolfPack: "wedge",
  banditBand: "line",
  greenskinWarband: "column",
  darkHost: "column",
};
const RAID_FORMATION_SPACING_BODIES = 1.35; // battle discipline 2026-10-23: was 1.6
const RAID_WEDGE_LOOSENESS = 1.3;
const RAID_RELEASE_ROW_TICKS = Math.round(TICK_RATE * 0.4);
// Heading smoothing per tick (path corners would otherwise swing the whole formation each tile).
const RAID_HEADING_SMOOTHING = 0.15;
const RAID_MARCH_REPATH_TICKS = TICK_RATE * 2;

const TROLL_REGEN_DELAY_TICKS = TICK_RATE * 4;
const TROLL_REGEN_PER_TICK = 1;
const POISON_DURATION_TICKS = TICK_RATE * 3;
const POISON_DAMAGE_PER_TICK = 1;
const DARK_SHAMAN_HEAL_RANGE = TILE_SIZE * 5;
const DARK_SHAMAN_HEAL_AMOUNT = 15;
const DARK_SHAMAN_HEAL_COOLDOWN_TICKS = TICK_RATE * 3;

// Long days: was 10 (of the old 100 s days); 3 long days (~19 min) keeps it near the old ~17 min.
const DESERTER_ACTIVATION_DAYS = 3;
const DESERTER_ACTIVATION_TICKS = DESERTER_ACTIVATION_DAYS * (DAY_TICKS + NIGHT_TICKS);
// Rolled at each midday raid spawn when eligible deserters exist: on success they become the core of
// tonight's raid (see spawnRaid).
const DESERTER_WAVE_CHANCE = 0.25;

let colonyHappiness = 100;

const HAPPINESS_SCENERY_TREE_BASELINE = 20;
const HAPPINESS_DESERTION_THRESHOLD = 35;
const HAPPINESS_MUTINY_THRESHOLD = 15;
const HAPPINESS_DESERTION_CHANCE = 0.15;
const TAVERN_HAPPINESS_RADIUS_TILES = 6;
const PRODUCTION_HAPPINESS_FLOOR = 0.5;

const COLONIST_SPEED = 100;
const CHOP_TICKS = TICK_RATE * 2;
const CRAFT_TICKS = TICK_RATE * 4;
const IDLE_RETRY_TICKS = TICK_RATE;
const LUMBERJACK_WOOD_PER_TRIP = 3;

// ---- Slow farming: every farm number lives here. One game day = DAY_TICKS + NIGHT_TICKS (375 s). ----
// Long days: the farm timers below stay in REAL time, i.e. in "legacy days" of the old 100 s cycle
// (LEGACY_GAME_DAY_TICKS; a field grows 5 min, ~0.8 of a long day), so grain / meat / fruit / wool /
// cotton per real second, the opening food bridge (STARTING_GRAIN) and the farm tests are unchanged.
const GAME_DAY_TICKS = DAY_TICKS + NIGHT_TICKS;
const LEGACY_GAME_DAY_TICKS = LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS;
// Grain field (Farm Plot next to a staffed Barn): sown -> growing -> ripe (the short harvest phase)
// -> +FARM_YIELD_PER_HARVEST grain -> sown again. Plots grow day and night. Every
// FARM_HARVESTS_BEFORE_FALLOW harvests the field rests FALLOW for FARM_FALLOW_TICKS, then re-sows itself
// (once its Barn is staffed). Grow and harvest are scaled by the Barn's level, the plot's biome,
// happiness and the Barn's industrial synergy; fallow is a flat rest.
const FARM_GROW_DAYS = 3;
const FARM_GROW_TICKS = FARM_GROW_DAYS * LEGACY_GAME_DAY_TICKS;
// The first third of the grow phase reads as freshly sown soil (snapshot sownFarmPlots).
const FARM_SOWN_FRACTION = 1 / 3;
const FARM_HARVEST_TICKS = TICK_RATE * 2;
const FARM_HARVESTS_BEFORE_FALLOW = 5;
const FARM_FALLOW_DAYS = 3;
const FARM_FALLOW_TICKS = FARM_FALLOW_DAYS * LEGACY_GAME_DAY_TICKS;
// Farm timers stay in real time, counted in legacy 100 s days (long days, 2026-10-23). A full field
// rotation is 5 x 3 grow days + 3 fallow days = 18 legacy days. 24 per harvest (was 36, cut a third on
// 2026-10-23 when a Barn's plot cap doubled from 4 to BARN_MAX_FARM_PLOTS 8) gives a long-run
// 5 * 24 / 18 = 6.67 grain per plot per legacy day (was 10), so a full Barn yields ~53 instead of 40.
const FARM_YIELD_PER_HARVEST = 24;
// Farm Plots per Barn (was 4: the orthogonally adjacent tiles). A new plot may go anywhere within
// BARN_FARM_RADIUS_TILES (Chebyshev) of a Barn with fewer than BARN_MAX_FARM_PLOTS plots; it belongs to
// the nearest such Barn.
const BARN_MAX_FARM_PLOTS = 8;
const BARN_FARM_RADIUS_TILES = 2;
// Pasture / Orchard / Sheep Pasture / Hemp Field: the farmhand tends all day as before (works only by
// day, shelters at night), but the produce lands once per cycle of FARMHAND_CYCLE_DAYS days of tending.
// The old rate was 1 unit per CHOP_TICKS (2 s) of tending = DAY_TICKS / CHOP_TICKS = 30 a day, so a
// 3-day cycle yields 3 * 30 = 90 (same average rate, delivered in one batch). The cycle length is scaled
// by the building's level, biome, happiness and industrial synergy exactly like the old unit timer.
const FARMHAND_CYCLE_DAYS = 3;
const FARMHAND_CYCLE_TICKS = FARMHAND_CYCLE_DAYS * LEGACY_DAY_TICKS;
const FARMHAND_YIELD_PER_CYCLE: Record<"meat" | "fruit" | "wool" | "cotton", number> = {
  meat: 90,
  fruit: 90,
  wool: 90,
  cotton: 90,
};

// Long days: upkeep stays 1 per colonist per 100 s of real time, so a long day costs 3.75 (rounded up
// for the whole colony at dawn; see applyDailyFoodConsumption).
const FOOD_PER_COLONIST_PER_DAY = 1 * DAY_LENGTH_SCALE;
const STARVATION_DAMAGE = 10;
// Long days: replaces the old 5 s RESPAWN_DELAY_TICKS. Dead units wait in respawnQueue and come back
// together only at the two respawn windows, dawn (cycle tick 0) and dusk (the last daylight tick,
// DAY_TICKS - 1, so "day-only respawns" still holds); see respawnWindowAt / processRespawnQueue.
const RESPAWN_FOOD_COST = 5;

const ARCHER_WOOD_COST = 10;
const KNIGHT_IRON_COST = 10;
const KNIGHT_ROCK_COST = 5;
// Walls & gates (2026-10-23): walls 3x their old 1 wood / 1 rock. Full repair = REPAIR_COST_FRACTION
// (0.3) of this, i.e. 1 wood / 1 rock per wall, 3 wood + 2 rock per gate.
const WOOD_WALL_COST = 3;
const STONE_WALL_COST = 3;
const GATE_WOOD_COST = 10;
const GATE_ROCK_COST = 5;
const HOUSE_WOOD_COST = 10;
const BARN_WOOD_COST = 15;
const CHURCH_WOOD_COST = 15;
const CRAFT_BUILDING_WOOD_COST = 10;
const CRAFT_BUILDING_IRON_COST = 5;
const SHOP_WOOD_COST = 15;
const TAVERN_WOOD_COST = 20;
const TAVERN_ROCK_COST = 10;
const MILITIA_WOOD_COST = 5;
const MILITIA_IRON_COST = 5;
const WARD_STONE_WOOD_COST = 20;
const FOOD_HUT_WOOD_COST = 15;
const WARD_STONE_TOOLS_COST = 10;

const PLAYER_ATTACK_DAMAGE = 15;
const PLAYER_ATTACK_RANGE = TILE_SIZE * 1.3;
const PLAYER_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.5);

const BISHOP_MAX_HP = 25;
const BISHOP_HEAL_AMOUNT = 10;
const BISHOP_HEAL_RANGE = TILE_SIZE * 2;
const BISHOP_HEAL_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.8);
const BISHOP_SPEED = 100;
const CHURCH_HEAL_BONUS_PER_STEP = 0.1;

const TREE_RESPAWN_INTERVAL_TICKS = TICK_RATE * 8;
// Regrowth cap, scaled 4x with TREE_COUNT for the 80x80 map (at the old 50 the 96 starting
// trees would sit above the cap and natural regrowth would never run).
let MAX_TREES = scaledCount(200);
let treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;

const LUMBERJACK_TREE_RADIUS = 2;
const LUMBERJACK_TREE_INTERVAL_TICKS = TICK_RATE * 10;
let lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;

function countTilesOfType(tileType: TileType): number {
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tileType) count++;
  }
  return count;
}

function computeColonyHappiness(): number {
  const foodTypesAvailable = (["grain", "meat", "fruit"] as const).filter((k) => stock[k] > 0).length;
  const foodVarietyScore = (foodTypesAvailable / 3) * 100;

  const treeCount = countTilesOfType(TileType.Tree);
  const sceneryScore = Math.min(100, (treeCount / HAPPINESS_SCENERY_TREE_BASELINE) * 100);

  const posts = new Set<string>();
  for (const c of colonists.values()) {
    if (!isAbbeyClergy(c)) posts.add(resourceKey(c.postX, c.postY));
  }

  const tavernTiles: TileCoord[] = [];
  for (let tx = 0; tx < WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
      if (tiles[tileIndex(tx, ty)] === TileType.Tavern) tavernTiles.push({ x: tx, y: ty });
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

function happinessSpeedMultiplier(): number {
  return PRODUCTION_HAPPINESS_FLOOR + (1 - PRODUCTION_HAPPINESS_FLOOR) * (colonyHappiness / 100);
}

// Every production timer (and builders' work rate) divides by this: happiness times the Town Center bonus.
function productionSpeedMultiplier(): number {
  return happinessSpeedMultiplier() * (1 + townCenterBonus());
}

const POST_TILE_TYPES = [
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.TownCenter,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.BarnPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Stables,
  TileType.SiegeWorkshop,
];

function isAdjacentToPlayerOrPost(tx: number, ty: number): boolean {
  for (const p of players.values()) {
    const t = tileOfPixel(p.x, p.y);
    if (Math.abs(t.x - tx) + Math.abs(t.y - ty) <= 1) return true;
  }
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  for (const n of neighbors) {
    if (!inBounds(n.x, n.y)) continue;
    if (POST_TILE_TYPES.includes(tiles[tileIndex(n.x, n.y)] as TileType)) return true;
  }
  return false;
}

function tryGrowTree() {
  if (countTilesOfType(TileType.Tree) >= MAX_TREES) return;
  const candidates: TileCoord[] = [];
  for (let tx = 0; tx < WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
      if (
        tiles[tileIndex(tx, ty)] === TileType.Empty &&
        !tileOccupiedByEntity(tx, ty) &&
        !isAdjacentToPlayerOrPost(tx, ty) &&
        !isInReservedGrounds(tx, ty)
      ) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }
  if (candidates.length === 0) return;
  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  tiles[tileIndex(spot.x, spot.y)] = TileType.Tree;
  broadcastTileUpdate(spot.x, spot.y, TileType.Tree);
}

function tryGrowTreesNearLumberjackPosts() {
  if (countTilesOfType(TileType.Tree) >= MAX_TREES) return;
  const posts: TileCoord[] = [];
  for (let tx = 0; tx < WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
      if (tiles[tileIndex(tx, ty)] === TileType.LumberjackPost) posts.push({ x: tx, y: ty });
    }
  }
  for (const post of posts) {
    if (countTilesOfType(TileType.Tree) >= MAX_TREES) return;
    const candidates: TileCoord[] = [];
    for (let dx = -LUMBERJACK_TREE_RADIUS; dx <= LUMBERJACK_TREE_RADIUS; dx++) {
      for (let dy = -LUMBERJACK_TREE_RADIUS; dy <= LUMBERJACK_TREE_RADIUS; dy++) {
        const tx = post.x + dx;
        const ty = post.y + dy;
        if (!inBounds(tx, ty)) continue;
        if (tiles[tileIndex(tx, ty)] !== TileType.Empty) continue;
        if (tileOccupiedByEntity(tx, ty)) continue;
        if (isAdjacentToPlayerOrPost(tx, ty)) continue;
        if (isInReservedGrounds(tx, ty)) continue;
        candidates.push({ x: tx, y: ty });
      }
    }
    if (candidates.length === 0) continue;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    tiles[tileIndex(spot.x, spot.y)] = TileType.Tree;
    broadcastTileUpdate(spot.x, spot.y, TileType.Tree);
  }
}

const GATHER_RESOURCE_TILE: Partial<Record<ColonistKind, TileType>> = {
  lumberjack: TileType.Tree,
  ironMiner: TileType.IronOre,
  rockMiner: TileType.Rock,
};

function depositGatheredResource(kind: ColonistKind) {
  if (kind === "lumberjack") stock.wood += LUMBERJACK_WOOD_PER_TRIP;
  else if (kind === "ironMiner") stock.iron += 1;
  else if (kind === "rockMiner") stock.rock += 1;
}

// Industrial cluster synergy: +5% productivity for every other industrial building within 5 tiles
// (Chebyshev distance), stacking. Applied as a speed multiplier on the building's work cycle.
const INDUSTRIAL_SYNERGY_RADIUS = 5;
const INDUSTRIAL_SYNERGY_PER_BUILDING = 0.05;
const INDUSTRIAL_TILES: TileType[] = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
];

function industrialSynergyMultiplier(tx: number, ty: number): number {
  if (!INDUSTRIAL_TILES.includes(tiles[tileIndex(tx, ty)] as TileType)) return 1;
  let others = 0;
  for (let y = ty - INDUSTRIAL_SYNERGY_RADIUS; y <= ty + INDUSTRIAL_SYNERGY_RADIUS; y++) {
    for (let x = tx - INDUSTRIAL_SYNERGY_RADIUS; x <= tx + INDUSTRIAL_SYNERGY_RADIUS; x++) {
      if ((x === tx && y === ty) || !inBounds(x, y)) continue;
      if (INDUSTRIAL_TILES.includes(tiles[tileIndex(x, y)] as TileType)) others++;
    }
  }
  return 1 + others * INDUSTRIAL_SYNERGY_PER_BUILDING;
}

// Army cluster synergy: +5% unit damage per adjacent (incl. diagonal) army building, and +5% per adjacent Blacksmith.
const ARMY_SYNERGY_PER_NEIGHBOUR = 0.05;

function armyDamageMultiplier(tx: number, ty: number): number {
  let bonus = 0;
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(nx, ny)) continue;
    const t = tiles[tileIndex(nx, ny)] as TileType;
    if (isMilitaryTile(t) || t === TileType.Blacksmith) bonus += ARMY_SYNERGY_PER_NEIGHBOUR;
  }
  return 1 + bonus + townCenterBonus();
}

function effectiveChopTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((CHOP_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

// Same multipliers as effectiveChopTicks, on the farmhand's multi-day cycle.
function effectiveFarmhandCycleTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((FARMHAND_CYCLE_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

function effectiveCraftTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(1, Math.round((CRAFT_TICKS * (1 - levelBonus(level))) / (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty))));
}

const FARM_PRODUCE_BY_TILE: Partial<Record<TileType, "meat" | "fruit" | "wool" | "cotton">> = {
  [TileType.Pasture]: "meat",
  [TileType.Orchard]: "fruit",
  [TileType.WoolFarm]: "wool",
  [TileType.CottonFarm]: "cotton",
};

interface CraftRecipe {
  inputs: Partial<Record<ResourceKey, number>>;
  output: ResourceKey;
  outputAmount?: number;
}
const CRAFT_RECIPES: Partial<Record<TileType, CraftRecipe>> = {
  [TileType.TailorShop]: { inputs: { wool: 1, cotton: 1 }, output: "clothes" },
  [TileType.Blacksmith]: { inputs: { iron: 1, wood: 1 }, output: "tools" },
  [TileType.LuxuryWorkshop]: { inputs: { rock: 1, fruit: 1 }, output: "luxuryItems" },
  [TileType.Brewery]: { inputs: { grain: 2 }, output: "alcohol" },
  [TileType.Tavern]: { inputs: { alcohol: 1 }, output: "gold", outputAmount: 10 },
};

function isStationaryMinerKind(kind: ColonistKind): boolean {
  return kind === "ironMiner" || kind === "rockMiner";
}

function isStationaryWorkerKind(kind: ColonistKind): boolean {
  return kind === "farmer" || kind === "farmhand" || kind === "artisan" || isStationaryMinerKind(kind);
}

function castleLevelForTile(t: TileType): number {
  if (t === TileType.CastleLevel2) return 2;
  if (t === TileType.CastleLevel3) return 3;
  return 1;
}

function isValidPostTile(kind: ColonistKind, t: TileType): boolean {
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

function isCivilianKind(kind: ColonistKind): boolean {
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

// Every living friendly unit counts toward its settlement's population (soldiers too since 2026-10-28);
// siege engines count at SIEGE_POPULATION_COST (populationCostOf), Abbey clergy not at all.
function consumesPopulation(kind: ColonistKind): boolean {
  return isCivilianKind(kind) || kind === "bishop" || isSoldierKind(kind);
}

// Saint Wren's Abbey's resident clergy: colonists only so the existing bishop code can drive them.
// They aren't the colony's (no population, food, happiness, commands); identified by their post,
// since AbbeyHall is only ever placed by world-gen.
function isAbbeyClergy(c: Colonist): boolean {
  return tiles[tileIndex(c.postX, c.postY)] === TileType.AbbeyHall;
}

// What one unit counts for in population: civilians/bishops/soldiers 1 (not Abbey clergy), siege engines their cost.
function populationCostOf(c: Colonist): number {
  if (isSiegeKind(c.kind)) return SIEGE_POPULATION_COST;
  if (c.kind === "hero") return HERO_POPULATION_COST;
  // Hero phase 4: summoned skeletons count for nothing.
  if (summonedUntil.has(c.id)) return 0;
  return consumesPopulation(c.kind) && !isAbbeyClergy(c) ? 1 : 0;
}

function civilianPopulationUsed(): number {
  let count = 0;
  for (const c of colonists.values()) count += populationCostOf(c);
  return count;
}

const TOWN_CENTER_BASE_POPULATION = 10;
// Every Town Center after the first adds this much to the base.
const TOWN_CENTER_EXTRA_POPULATION = 5;
// Settlement population ceiling per Town Center tier (index = level - 1). Tune here.
const SETTLEMENT_POP_CAP_BY_TIER = [20, 30, 40];
// Each level of a settlement's Keep (a separate building) adds this to both its tier ceiling and its
// housing capacity, so the bonus is real whichever of the two was limiting.
const KEEP_POPULATION_PER_LEVEL = 10;
const KEEP_MIN_TOWN_CENTER_LEVEL = 2;

function settlementTierCap(level: number): number {
  return SETTLEMENT_POP_CAP_BY_TIER[Math.min(Math.max(level, 1), SETTLEMENT_POP_CAP_BY_TIER.length) - 1];
}

// The settlement key (Town Center "x,y") nearest a tile; "" with no Town Center.
function settlementKeyNear(tx: number, ty: number): string {
  const p = tileToPixelCenter({ x: tx, y: ty });
  const tc = nearestTownCenter(p.x, p.y);
  return tc ? resourceKey(tc.x, tc.y) : "";
}

// The Town Center a unit counts toward: its stored settlement, or (old save / that one fell) the one
// nearest its post, which is then stored.
function settlementOf(c: Colonist): TownCenter | null {
  const tc = c.settlementId ? townCenters.find((t) => resourceKey(t.x, t.y) === c.settlementId) : undefined;
  if (tc) return tc;
  c.settlementId = settlementKeyNear(c.postX, c.postY);
  return townCenters.find((t) => resourceKey(t.x, t.y) === c.settlementId) ?? null;
}

interface SettlementStat {
  tc: TownCenter;
  number: number; // 1-based position in townCenters (the "Settlement N" label)
  used: number;
  pending: number; // worker slots of queued constructions
  housingCap: number; // includes keepBonus
  tierCap: number; // the Town Center tier ceiling alone
  keepBonus: number; // 10 per level of this settlement's Keep
  cap: number; // min(housingCap, tierCap + keepBonus)
}

// Per-settlement population: units by stored settlement, queued worker slots, and the cap = the
// housing-derived capacity (base + houses + neighbourhood bonus nearest to it) clamped by the tier cap.
function settlementStats(): SettlementStat[] {
  const stats: SettlementStat[] = townCenters.map((tc, i) => ({
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
  }));
  if (stats.length === 0) return stats;
  const statNear = (tx: number, ty: number): SettlementStat | undefined => {
    const p = tileToPixelCenter({ x: tx, y: ty });
    const tc = nearestTownCenter(p.x, p.y);
    return stats.find((s) => s.tc === tc);
  };
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as TileType;
    const w = t === TileType.House ? 1 : t === TileType.BigHouse ? 3 : t === TileType.HouseLevel2 ? 5 : 0;
    if (w) {
      const s = statNear(i % WORLD_TILES_X, Math.floor(i / WORLD_TILES_X));
      if (s) s.housingCap += w;
    } else if (t === TileType.Keep) {
      const x = i % WORLD_TILES_X;
      const y = Math.floor(i / WORLD_TILES_X);
      const s = statNear(x, y);
      if (s) {
        const bonus = KEEP_POPULATION_PER_LEVEL * getBuildingLevel(x, y);
        s.keepBonus += bonus;
        s.housingCap += bonus;
      }
    }
  }
  neighbourhoodPopulationBonus((tx, ty) => {
    const s = statNear(tx, ty);
    if (s) s.housingCap++;
  });
  for (const c of colonists.values()) {
    const cost = populationCostOf(c);
    if (!cost) continue;
    const tc = settlementOf(c);
    const s = stats.find((x) => x.tc === tc);
    if (s) s.used += cost;
  }
  for (const site of constructionSites.values()) {
    const garrison = garrisonGain(site.target, site.prevTile, site.tx, site.ty);
    if (garrison > 0) {
      const s = statNear(site.tx, site.ty);
      if (s) s.pending += garrison;
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
function settlementBlocker(tx: number, ty: number, cost = 1): string {
  const stats = settlementStats();
  if (stats.length === 0) return "No Town Center standing";
  const key = settlementKeyNear(tx, ty);
  const s = stats.find((x) => resourceKey(x.tc.x, x.tc.y) === key);
  if (!s || s.used + s.pending + cost <= s.cap) return "";
  const hint = s.housingCap < s.tierCap + s.keepBonus ? "build more houses" : "upgrade the Town Center or build a Keep";
  return `Settlement ${s.number} full (${s.used + s.pending}/${s.cap}) — ${hint}`;
}

// Whole-colony population cap: the settlements' effective caps added up.
function populationCap(): number {
  return settlementStats().reduce((n, s) => n + s.cap, 0);
}

// Synergy bonuses count all eight surrounding tiles (diagonals too), so buildings can be packed
// into solid blocks. Spawn-space checks still use the four orthogonal tiles units actually spawn on.
const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function isHouseTile(t: TileType): boolean {
  return t === TileType.House || t === TileType.BigHouse || t === TileType.HouseLevel2;
}

function isMilitaryTile(t: TileType): boolean {
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
function isSynergyBuilding(t: TileType): boolean {
  return POPULATION_GATED_TILES.includes(t) || isMilitaryTile(t);
}

// Neighbourhood synergy: +1 population for every adjacent (8-neighbour) pair of (house, house) or
// (house, any other staffed/unit building). Houses clustered with workplaces and barracks grow
// the colony faster, so neighbourhoods are worth building.
function neighbourhoodPopulationBonus(onBonus?: (tx: number, ty: number) => void): number {
  let bonus = 0;
  for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < WORLD_TILES_X; tx++) {
      if (!isHouseTile(tiles[tileIndex(tx, ty)] as TileType)) continue;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!inBounds(nx, ny)) continue;
        const n = tiles[tileIndex(nx, ny)] as TileType;
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
function findUpgradeTargetFor(tx: number, ty: number, type: TileType): TileCoord | null {
  if (tiles[tileIndex(tx, ty)] !== type) return null;
  return getBuildingLevel(tx, ty) < 3 ? { x: tx, y: ty } : null;
}

// Soldiers a military placement adds to its garrison (the post's base headcount after minus before:
// a new post or an in-place upgrade); 0 for anything else. Checked against the settlement cap like
// worker slots (handleSetTileInner, upgrade button) and counted as pending while under construction.
function garrisonGain(tile: TileType, current: TileType, tx: number, ty: number): number {
  let before = 0;
  let after = 0;
  if (tile === TileType.KnightPost) {
    const lv = current === TileType.KnightPost ? 1 : current === TileType.CastleLevel2 ? 2 : current === TileType.CastleLevel3 ? 3 : 0;
    if (lv >= 3) return 0;
    before = lv ? guardCountForLevel(lv) : 0;
    after = guardCountForLevel(lv + 1);
  } else if (tile === TileType.MilitiaPost) {
    const lv = current === TileType.MilitiaPost ? 1 : current === TileType.MilitiaCamp2 ? 2 : current === TileType.MilitiaCamp3 ? 3 : 0;
    if (lv >= 3) return 0;
    before = lv ? militiaCountForLevel(lv) : 0;
    after = militiaCountForLevel(lv + 1);
  } else if (tile === TileType.ArcherPost || tile === TileType.Stables) {
    const lv = current === tile ? getBuildingLevel(tx, ty) : 0;
    if (lv >= 3) return 0;
    const count = tile === TileType.ArcherPost ? guardCountForLevel : cavalryCountForLevel;
    before = lv ? count(lv) : 0;
    after = count(lv + 1);
  }
  return Math.max(0, after - before);
}

function placementNeedsNewWorkerSlot(tile: TileType, tx: number, ty: number): boolean {
  if (tile === TileType.LumberjackPost) return findUpgradeTargetFor(tx, ty, TileType.LumberjackPost) === null;
  if (tile === TileType.BarnPost) return findUpgradeTargetFor(tx, ty, TileType.BarnPost) === null;
  if (tile === TileType.ChurchPost) return findUpgradeTargetFor(tx, ty, TileType.ChurchPost) === null;
  if (tile === TileType.WardStone) return wardPriestId === null;
  if (FARM_PRODUCE_BY_TILE[tile] !== undefined || CRAFT_RECIPES[tile] !== undefined) {
    return findUpgradeTargetFor(tx, ty, tile) === null;
  }
  return true;
}

function spawnColonistForPost(
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

function queueRespawn(c: Colonist) {
  // ticksRemaining is unused since dawn/dusk respawn windows (kept so old and new saves share a shape).
  respawnQueue.push({
    tx: c.postX, ty: c.postY, kind: c.kind, ticksRemaining: 0,
    ...(c.kind === "hero" && c.heroClass ? { hero: { id: c.id, name: c.heroName ?? "Hero", heroClass: c.heroClass } } : {}),
  });
}

const WALL_TILES = [TileType.Wall, TileType.StoneWall];
const NO_COLONIST_TILES = [
  TileType.ConstructionSite,
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.Market,
  TileType.GoldShop,
  TileType.Road,
  TileType.CobbleRoad,
  TileType.Keep,
];

function removeColonistForPost(tx: number, ty: number) {
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

function getColonistAtPost(tx: number, ty: number): Colonist | undefined {
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty) return c;
  }
  return undefined;
}

function getColonistsAtPost(tx: number, ty: number): Colonist[] {
  const result: Colonist[] = [];
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty) result.push(c);
  }
  return result;
}

function guardCountForLevel(level: number): number {
  if (level >= 3) return 5;
  if (level >= 2) return 3;
  return 1;
}

function spawnExtraGuards(
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

function upgradeKnightAt(tx: number, ty: number, level: number) {
  const stats = guardStats("knight", level);
  for (const c of getColonistsAtPost(tx, ty)) {
    if (c.kind !== "knight") continue;
    c.castleLevel = level;
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  spawnExtraGuards(tx, ty, "knight", level);
}

function upgradeArcherAt(tx: number, ty: number, level: number) {
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
function cavalryCountForLevel(level: number): number {
  return Math.min(Math.max(level, 1), 3);
}

function resolveStablesPlacement(tx: number, ty: number) {
  if (tiles[tileIndex(tx, ty)] === TileType.Stables) {
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
  tiles[tileIndex(tx, ty)] = TileType.Stables;
  broadcastTileUpdate(tx, ty, TileType.Stables);
  spawnColonistForPost(tx, ty, "cavalry", 1);
}

function upgradeMilitiaAt(tx: number, ty: number, level: number) {
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

// Event-feed names for tier upgrades, matching the client's build-panel labels.
const UPGRADE_NAMES: Partial<Record<TileType, string>> = {
  [TileType.House]: "Cottage",
  [TileType.KnightPost]: "Hall of the Sworn",
  [TileType.MilitiaPost]: "Militia Camp",
  [TileType.ArcherPost]: "Archery Range",
  [TileType.Tower]: "Tower",
  [TileType.IronMinePost]: "Iron Mine",
  [TileType.RockMinePost]: "Quarry",
  [TileType.LumberjackPost]: "Lumberjack",
  [TileType.BarnPost]: "Barn",
  [TileType.ChurchPost]: "Church",
  [TileType.Pasture]: "Pasture",
  [TileType.Orchard]: "Orchard",
  [TileType.WoolFarm]: "Sheep Pasture",
  [TileType.CottonFarm]: "Hemp Field",
  [TileType.TailorShop]: "Tailor Shop",
  [TileType.Blacksmith]: "Blacksmith",
  [TileType.LuxuryWorkshop]: "Jeweler's Workshop",
  [TileType.Brewery]: "Brewery",
  [TileType.Tavern]: "Tavern",
  [TileType.HunterHut]: "Hunter's Hut",
  [TileType.ForagerHut]: "Forager's Hut",
  [TileType.BuildersGuild]: "Builders' Guild",
  [TileType.TownCenter]: "Town Center",
  [TileType.Stables]: "Stables",
  [TileType.Keep]: "Keep",
};

function announceUpgrade(baseType: TileType, level: number) {
  broadcastEvent("upgrade", `${UPGRADE_NAMES[baseType] ?? "A building"} upgraded to level ${level}`);
}

function tryLevelUpInPlace(tx: number, ty: number, matchTypes: TileType[]): TileCoord | null {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (!matchTypes.includes(current)) return null;
  const currentLevel = getBuildingLevel(tx, ty);
  if (currentLevel >= 3) return null;
  buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
  announceUpgrade(current, currentLevel + 1);
  return { x: tx, y: ty };
}

function canAffordHouseUpgrade(current: TileType): boolean {
  if (current === TileType.BigHouse) {
    return (
      stock.grain >= 2 && stock.meat >= 2 && stock.fruit >= 2 && stock.clothes >= 3 && stock.tools >= 2 && stock.luxuryItems >= 1
    );
  }
  return stock.grain >= 1 && stock.meat >= 1 && stock.fruit >= 1 && stock.clothes >= 2;
}

// The upgrade goods are charged at placement (placementCost), so a queued upgrade can't overdraw later.
function resolveHousePlacement(tx: number, ty: number) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.BigHouse) {
    tiles[tileIndex(tx, ty)] = TileType.HouseLevel2;
    broadcastTileUpdate(tx, ty, TileType.HouseLevel2);
    announceUpgrade(TileType.House, 3);
    return;
  }
  if (current === TileType.House) {
    tiles[tileIndex(tx, ty)] = TileType.BigHouse;
    broadcastTileUpdate(tx, ty, TileType.BigHouse);
    announceUpgrade(TileType.House, 2);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.House;
  broadcastTileUpdate(tx, ty, TileType.House);
}

function resolveKnightPlacement(tx: number, ty: number) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.CastleLevel2) {
    tiles[tileIndex(tx, ty)] = TileType.CastleLevel3;
    broadcastTileUpdate(tx, ty, TileType.CastleLevel3);
    upgradeKnightAt(tx, ty, 3);
    announceUpgrade(TileType.KnightPost, 3);
    return;
  }
  if (current === TileType.KnightPost) {
    tiles[tileIndex(tx, ty)] = TileType.CastleLevel2;
    broadcastTileUpdate(tx, ty, TileType.CastleLevel2);
    upgradeKnightAt(tx, ty, 2);
    announceUpgrade(TileType.KnightPost, 2);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.KnightPost;
  broadcastTileUpdate(tx, ty, TileType.KnightPost);
  spawnColonistForPost(tx, ty, "knight", 1);
}

function resolveMilitiaPlacement(tx: number, ty: number) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.MilitiaCamp2) {
    tiles[tileIndex(tx, ty)] = TileType.MilitiaCamp3;
    broadcastTileUpdate(tx, ty, TileType.MilitiaCamp3);
    upgradeMilitiaAt(tx, ty, 3);
    announceUpgrade(TileType.MilitiaPost, 3);
    return;
  }
  if (current === TileType.MilitiaPost) {
    tiles[tileIndex(tx, ty)] = TileType.MilitiaCamp2;
    broadcastTileUpdate(tx, ty, TileType.MilitiaCamp2);
    upgradeMilitiaAt(tx, ty, 2);
    announceUpgrade(TileType.MilitiaPost, 2);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.MilitiaPost;
  broadcastTileUpdate(tx, ty, TileType.MilitiaPost);
  spawnColonistForPost(tx, ty, "militia", 1);
  spawnColonistForPost(tx, ty, "militia", 1);
}

function resolveArcherPlacement(tx: number, ty: number) {
  const here = tiles[tileIndex(tx, ty)] as TileType;
  if (here === TileType.ArcherPost) {
    const newLevel = getBuildingLevel(tx, ty) + 1;
    buildingLevel.set(resourceKey(tx, ty), newLevel);
    upgradeArcherAt(tx, ty, newLevel);
    announceUpgrade(here, newLevel);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.ArcherPost;
  broadcastTileUpdate(tx, ty, TileType.ArcherPost);
  spawnColonistForPost(tx, ty, "archer", 1);
}

function resolveMinePlacement(
  tx: number,
  ty: number,
  mineType: TileType,
  oreType: TileType,
  minerKind: "ironMiner" | "rockMiner"
) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === mineType) {
    const currentLevel = getBuildingLevel(tx, ty);
    buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
    announceUpgrade(mineType, currentLevel + 1);
    spawnColonistForPost(tx, ty, minerKind);
    return;
  }
  tiles[tileIndex(tx, ty)] = mineType;
  broadcastTileUpdate(tx, ty, mineType);
  if (current === oreType) minesPlacedOnOre.add(resourceKey(tx, ty));
  spawnColonistForPost(tx, ty, minerKind);
}

function resolveLumberjackPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.LumberjackPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.LumberjackPost;
  broadcastTileUpdate(tx, ty, TileType.LumberjackPost);
  spawnColonistForPost(tx, ty, "lumberjack");
}

function resolveBarnPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.BarnPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.BarnPost;
  broadcastTileUpdate(tx, ty, TileType.BarnPost);
  spawnColonistForPost(tx, ty, "farmer");
}

function resolveChurchPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.ChurchPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.ChurchPost;
  broadcastTileUpdate(tx, ty, TileType.ChurchPost);
  spawnColonistForPost(tx, ty, "bishop");
}

function resolvePasturePlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Pasture]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Pasture;
  broadcastTileUpdate(tx, ty, TileType.Pasture);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveOrchardPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Orchard]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Orchard;
  broadcastTileUpdate(tx, ty, TileType.Orchard);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveWoolFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.WoolFarm]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.WoolFarm;
  broadcastTileUpdate(tx, ty, TileType.WoolFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveCottonFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.CottonFarm]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.CottonFarm;
  broadcastTileUpdate(tx, ty, TileType.CottonFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveTailorShopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.TailorShop]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.TailorShop;
  broadcastTileUpdate(tx, ty, TileType.TailorShop);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveBlacksmithPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Blacksmith]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Blacksmith;
  broadcastTileUpdate(tx, ty, TileType.Blacksmith);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveLuxuryWorkshopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.LuxuryWorkshop]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.LuxuryWorkshop;
  broadcastTileUpdate(tx, ty, TileType.LuxuryWorkshop);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveBreweryPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Brewery]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Brewery;
  broadcastTileUpdate(tx, ty, TileType.Brewery);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveTavernPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpInPlace(tx, ty, [TileType.Tavern]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Tavern;
  broadcastTileUpdate(tx, ty, TileType.Tavern);
  spawnColonistForPost(tx, ty, "artisan");
}

// Hunter's Hut / Forager's Hut: like a mine, every level adds one more worker (so each placement,
// upgrades included, needs a free population slot).
// The Builders' Guild works the same way (one builder per level).
function resolveFoodHutPlacement(tx: number, ty: number, hutType: TileType, kind: "hunter" | "forager" | "builder") {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === hutType) {
    const currentLevel = getBuildingLevel(tx, ty);
    buildingLevel.set(resourceKey(tx, ty), currentLevel + 1);
    announceUpgrade(hutType, currentLevel + 1);
    spawnColonistForPost(tx, ty, kind);
    return;
  }
  tiles[tileIndex(tx, ty)] = hutType;
  broadcastTileUpdate(tx, ty, hutType);
  spawnColonistForPost(tx, ty, kind);
}

// Each Town Center keeps one builder per level (1 / 2 / 3) posted at it; the colony starts with one.
// Tops that Town Center's builders (alive or queued to respawn there) back up to its level. Runs at
// world-gen, whenever a Town Center is built or upgraded, so a colony that lost its Town Center and its
// builders can rebuild. (Builders' Guild builders are separate: one per Guild level.)
function topUpTownCenterBuilders(tc: TownCenter) {
  let have = 0;
  for (const c of colonists.values()) if (c.kind === "builder" && c.postX === tc.x && c.postY === tc.y) have++;
  for (const q of respawnQueue) if (q.kind === "builder" && q.tx === tc.x && q.ty === tc.y) have++;
  for (let i = have; i < tc.level; i++) spawnColonistForPost(tc.x, tc.y, "builder");
}

// A new Town Center (instant when none stands or no builder is alive; see handleSetTileInner), or a
// level-up of an existing one: the level raises its max HP (and heals by the difference).
function resolveTownCenterPlacement(tx: number, ty: number) {
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
  tiles[tileIndex(tx, ty)] = TileType.TownCenter;
  const tc: TownCenter = { x: tx, y: ty, level: 1, hp: townCenterMaxHp(1) };
  townCenters.push(tc);
  broadcastTileUpdate(tx, ty, TileType.TownCenter);
  revealAround(tx, ty, START_VISION_OFFSETS);
  topUpTownCenterBuilders(tc);
  broadcastEvent("build", "A new Town Center stands");
}

// Mob damage brought it down: it is removed for good (a new one can be placed).
function destroyTownCenter(tc: TownCenter) {
  townCenters = townCenters.filter((t) => t !== tc);
  const key = resourceKey(tc.x, tc.y);
  constructionSites.delete(key);
  tiles[tileIndex(tc.x, tc.y)] = TileType.Empty;
  broadcastTileUpdate(tc.x, tc.y, TileType.Empty);
  broadcastEvent(
    "death",
    townCenters.length > 0 ? "A Town Center has been destroyed" : "The last Town Center has been destroyed — build a new one"
  );
}

// ---- Dawn/dusk respawn windows (long days, 2026-10-23) ----
// The dead wait in respawnQueue (still validated, re-homed and pruned every daylight tick) and come back in one
// batch at the next window: dawn = cycle tick 0 of a day, dusk = DAY_TICKS - 1, the last daylight
// tick (so replacements still only ever arrive by day). A unit the batch can't afford (food) or fit
// (population cap) keeps waiting for the next window. The Ward Priest follows the same windows.
type RespawnWindow = "dawn" | "dusk";
const DUSK_RESPAWN_CYCLE_TICK = DAY_TICKS - 1;
// Units spawned by this tick's window (respawnQueue + Ward Priest), for the "Reinforcements" toast.
let respawnWindowSpawned = 0;
// True while a dead Ward Priest is due back at the next window (counted as waiting on the client).
let wardPriestAwaitingWindow = false;

function respawnWindowAt(tick: number): RespawnWindow | null {
  const t = tick % GAME_DAY_TICKS;
  return t === 0 ? "dawn" : t === DUSK_RESPAWN_CYCLE_TICK ? "dusk" : null;
}

// The first window strictly after `tick`, and how many ticks away it is.
function nextRespawnWindow(tick: number): { window: RespawnWindow; ticks: number } {
  const t = tick % GAME_DAY_TICKS;
  return t < DUSK_RESPAWN_CYCLE_TICK
    ? { window: "dusk", ticks: DUSK_RESPAWN_CYCLE_TICK - t }
    : { window: "dawn", ticks: GAME_DAY_TICKS - t };
}

// The snapshot's `respawn` (protocol RespawnWindowSnapshot).
function respawnWindowSnapshot() {
  const next = nextRespawnWindow(cycleTick);
  return {
    waiting: respawnQueue.length + (wardPriestAwaitingWindow ? 1 : 0),
    nextWindow: next.window,
    ticksToWindow: next.ticks,
    dayTicks: DAY_TICKS,
    nightTicks: NIGHT_TICKS,
  };
}

function processRespawnQueue() {
  // Replacements only arrive by day (both windows are daylight ticks); the queue waits out the night.
  if (isNightNow()) return;
  const windowNow = respawnWindowAt(cycleTick);
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const req = respawnQueue[i];
    // Hero phase 3: a fallen hero is never dropped; it comes back at a window when its settlement has room
    // (2 population) and the gold fee can be paid, else it waits for the next one.
    if (req.hero) {
      if (!windowNow) continue;
      if (settlementBlocker(req.tx, req.ty, HERO_POPULATION_COST) !== "") continue;
      const fee = heroRespawnFee(req.hero.id);
      if (stock.gold < fee) {
        heroTestEvent({ type: "respawnWait", id: req.hero.id, amount: fee });
        broadcastEvent("build", `${req.hero.name} waits for ${fee} gold to return at the next dawn or dusk`);
        continue;
      }
      stock.gold -= fee;
      respawnWindowSpawned++;
      spawnHeroColonist(req.hero.id, req.hero.name, req.hero.heroClass, req.tx, req.ty);
      heroTestEvent({ type: "respawn", id: req.hero.id, amount: fee, detail: windowNow });
      respawnQueue.splice(i, 1);
      continue;
    }
    // A builder whose Town Center fell respawns at the nearest one still standing.
    if (req.kind === "builder" && !isValidPostTile("builder", tiles[tileIndex(req.tx, req.ty)] as TileType)) {
      const p = tileToPixelCenter({ x: req.tx, y: req.ty });
      const tc = nearestTownCenter(p.x, p.y);
      if (tc) {
        req.tx = tc.x;
        req.ty = tc.y;
      }
    }
    const currentTile = tiles[tileIndex(req.tx, req.ty)] as TileType;
    if (!isValidPostTile(req.kind, currentTile)) {
      respawnQueue.splice(i, 1);
      continue;
    }
    // A barn only ever has one farmer: drop a queued replacement if one is already there.
    if (req.kind === "farmer" && isBarnStaffed(req.tx, req.ty)) {
      respawnQueue.splice(i, 1);
      continue;
    }
    if (!windowNow) continue;
    // A settlement at its cap makes its dead (soldiers included) wait for the next window.
    if (consumesPopulation(req.kind) && settlementBlocker(req.tx, req.ty) !== "") {
      continue;
    }
    if (trySpendFood(RESPAWN_FOOD_COST)) {
      respawnWindowSpawned++;
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

function trySpendFood(amount: number): boolean {
  if (stock.grain + stock.meat + stock.fruit < amount) return false;
  let remaining = amount;
  for (const key of ["grain", "meat", "fruit"] as const) {
    if (remaining <= 0) break;
    const take = Math.min(stock[key], remaining);
    stock[key] -= take;
    remaining -= take;
  }
  return true;
}

function applyDailyFoodConsumption() {
  // The Abbey provisions its own clergy: they neither eat the colony's food nor starve with it.
  const consumers = Array.from(colonists.values()).filter((c) => !isAbbeyClergy(c));
  const consumerCount = consumers.length;
  if (consumerCount === 0) return;
  let needed = Math.ceil(consumerCount * FOOD_PER_COLONIST_PER_DAY);
  for (const key of ["grain", "meat", "fruit"] as const) {
    if (needed <= 0) break;
    const take = Math.min(stock[key], needed);
    stock[key] -= take;
    needed -= take;
  }
  if (needed > 0) {
    for (const c of consumers) {
      damageColonist(c, STARVATION_DAMAGE);
    }
  }
}

function desertColonist(c: Colonist) {
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
    deserterSinceTick: cycleTick,
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

function applyMoraleCheck() {
  if (colonyHappiness < HAPPINESS_MUTINY_THRESHOLD) {
    for (const c of Array.from(colonists.values())) {
      if (isSoldierKind(c.kind)) desertColonist(c);
    }
  } else if (colonyHappiness < HAPPINESS_DESERTION_THRESHOLD) {
    for (const c of Array.from(colonists.values())) {
      if (isSoldierKind(c.kind) && Math.random() < HAPPINESS_DESERTION_CHANCE) desertColonist(c);
    }
  }
}

function isBarnStaffed(bx: number, by: number): boolean {
  for (const c of colonists.values()) {
    if (c.kind === "farmer" && c.postX === bx && c.postY === by) return true;
  }
  return false;
}

function farmPlotCountForBarn(bx: number, by: number): number {
  let n = 0;
  for (const plot of farmPlots.values()) if (plot.barnX === bx && plot.barnY === by) n++;
  return n;
}

// The Barn a new Farm Plot at (tx, ty) would belong to: the nearest one within BARN_FARM_RADIUS_TILES
// that still has room (fewer than BARN_MAX_FARM_PLOTS plots), else null (the plot can't go there).
function barnForNewFarmPlot(tx: number, ty: number): TileCoord | null {
  let best: TileCoord | null = null;
  let bestD = Infinity;
  for (let y = ty - BARN_FARM_RADIUS_TILES; y <= ty + BARN_FARM_RADIUS_TILES; y++) {
    for (let x = tx - BARN_FARM_RADIUS_TILES; x <= tx + BARN_FARM_RADIUS_TILES; x++) {
      if (!inBounds(x, y) || tiles[tileIndex(x, y)] !== TileType.BarnPost) continue;
      const d = Math.hypot(x - tx, y - ty);
      if (d >= bestD || farmPlotCountForBarn(x, y) >= BARN_MAX_FARM_PLOTS) continue;
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

function farmPlotIndices(state: FarmPlotState["state"]): number[] {
  const result: number[] = [];
  for (const [plotKey, plot] of farmPlots) {
    if (plot.state !== state) continue;
    const [plotX, plotY] = plotKey.split(",").map(Number);
    result.push(tileIndex(plotX, plotY));
  }
  return result;
}

// Grow / harvest phase length for a plot, scaled by its Barn's level and synergy, its own biome and
// colony happiness (fallow is never scaled).
function effectiveFarmPlotTicks(base: number, plotX: number, plotY: number, plot: FarmPlotState): number {
  const bonus = levelBonus(getBuildingLevel(plot.barnX, plot.barnY));
  return Math.max(
    1,
    Math.round(
      (base * (1 - bonus) * biomeProductionFactor(plotX, plotY)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(plot.barnX, plot.barnY))
    )
  );
}

function sowFarmPlot(plot: FarmPlotState, ticks: number) {
  plot.state = "sown";
  plot.growTicksRemaining = ticks;
  plot.growTicksTotal = ticks;
}

function newFarmPlot(barnX: number, barnY: number): FarmPlotState {
  const plot: FarmPlotState = {
    barnX,
    barnY,
    growTicksRemaining: 0,
    growTicksTotal: 0,
    harvestTicksRemaining: 0,
    harvestsSinceFallow: 0,
    fallowTicksRemaining: 0,
    harvestedTicksRemaining: 0,
    state: "sown",
  };
  // The first sowing is the flat FARM_GROW_TICKS (as before: the plot's multipliers apply from the
  // second cycle on).
  sowFarmPlot(plot, FARM_GROW_TICKS);
  return plot;
}

function updateFarmPlots() {
  for (const [plotKey, plot] of farmPlots) {
    // A resting field recovers on its own; only re-sowing it needs the farmer.
    if (plot.state === "fallow" && plot.fallowTicksRemaining > 0) plot.fallowTicksRemaining--;
    if (plot.harvestedTicksRemaining > 0) plot.harvestedTicksRemaining--;
    if (tiles[tileIndex(plot.barnX, plot.barnY)] !== TileType.BarnPost) continue;
    if (!isBarnStaffed(plot.barnX, plot.barnY)) continue;
    const [plotX, plotY] = plotKey.split(",").map(Number);
    if (plot.state === "fallow") {
      if (plot.fallowTicksRemaining <= 0) sowFarmPlot(plot, effectiveFarmPlotTicks(FARM_GROW_TICKS, plotX, plotY, plot));
    } else if (plot.state === "harvesting") {
      plot.harvestTicksRemaining--;
      if (plot.harvestTicksRemaining <= 0) {
        stock.grain += FARM_YIELD_PER_HARVEST;
        plot.harvestsSinceFallow++;
        plot.harvestedTicksRemaining = FARM_HARVESTED_SHOW_TICKS;
        if (plot.harvestsSinceFallow >= FARM_HARVESTS_BEFORE_FALLOW) {
          plot.harvestsSinceFallow = 0;
          plot.state = "fallow";
          plot.fallowTicksRemaining = FARM_FALLOW_TICKS;
        } else {
          sowFarmPlot(plot, effectiveFarmPlotTicks(FARM_GROW_TICKS, plotX, plotY, plot));
        }
      }
    } else {
      plot.growTicksRemaining--;
      if (plot.state === "sown" && plot.growTicksRemaining <= plot.growTicksTotal * (1 - FARM_SOWN_FRACTION)) {
        plot.state = "growing";
      }
      if (plot.growTicksRemaining <= 0) {
        plot.state = "harvesting";
        plot.harvestTicksRemaining = effectiveFarmPlotTicks(FARM_HARVEST_TICKS, plotX, plotY, plot);
      }
    }
  }
}

// ---- Farm art stages (snapshot farmStages; FarmStage in protocol.ts). Cosmetic only. ----
// A grain plot shows its stubble ("harvested") art this long after each harvest.
const FARM_HARVESTED_SHOW_TICKS = TICK_RATE * 8;
// Stage boundaries as fractions (0..1) of the current grow phase / farmhand produce cycle.
const FARM_SPROUTING_FRACTION = 2 / 3; // grain: sown < 1/3 <= sprouting < 2/3 <= growing
const HEMP_GROWING_FROM = 1 / 3;
const HEMP_RIPE_FROM = 2 / 3;
const PASTURE_FAT_FROM = 0.7;
const SHEEP_WOOLLY_FROM = 0.25; // sheared right after the wool batch lands
const SHEEP_READY_FROM = 0.8;
const ORCHARD_BLOSSOM_UNTIL = 0.35;
const ORCHARD_FRUITING_FROM = 0.65;

// 0..1 through the plot's current grow phase (1 while ripe/fallow).
function farmPlotProgress(plot: FarmPlotState): number {
  if (plot.state === "harvesting" || plot.state === "fallow") return 1;
  return plot.growTicksTotal > 0 ? 1 - plot.growTicksRemaining / plot.growTicksTotal : 0;
}

function farmPlotStage(plot: FarmPlotState): FarmStage {
  if (plot.state === "harvesting") return FarmStage.Ripe;
  if (plot.state === "fallow") return FarmStage.Fallow;
  if (plot.harvestedTicksRemaining > 0) return FarmStage.Harvested;
  const p = farmPlotProgress(plot);
  if (p < FARM_SOWN_FRACTION) return FarmStage.Sown;
  return p < FARM_SPROUTING_FRACTION ? FarmStage.Sprouting : FarmStage.Growing;
}

// 0..1 through a farmhand's current produce cycle (the batch lands at 1).
function farmhandProgress(c: Colonist): number {
  return c.cycleTicksTotal > 0 ? Math.min(1, Math.max(0, 1 - c.chopTicksRemaining / c.cycleTicksTotal)) : 0;
}

function farmhandFarmStage(tile: TileType, p: number): FarmStage | null {
  if (tile === TileType.CottonFarm) return p < HEMP_GROWING_FROM ? FarmStage.Sown : p < HEMP_RIPE_FROM ? FarmStage.Growing : FarmStage.Ripe;
  if (tile === TileType.Pasture) return p < PASTURE_FAT_FROM ? FarmStage.Growing : FarmStage.Fat;
  if (tile === TileType.WoolFarm) return p < SHEEP_WOOLLY_FROM ? FarmStage.Sheared : p < SHEEP_READY_FROM ? FarmStage.Woolly : FarmStage.Ripe;
  if (tile === TileType.Orchard) {
    return p < ORCHARD_BLOSSOM_UNTIL ? FarmStage.Blossoming : p < ORCHARD_FRUITING_FROM ? FarmStage.Growing : FarmStage.Fruiting;
  }
  return null;
}

// Flattened [tile index, FarmStage] for every grain plot and every staffed animal/orchard/hemp farm.
function farmStagesForSnapshot(): number[] {
  const out: number[] = [];
  for (const [plotKey, plot] of farmPlots) {
    const [plotX, plotY] = plotKey.split(",").map(Number);
    out.push(tileIndex(plotX, plotY), farmPlotStage(plot));
  }
  const seen = new Set<number>();
  for (const c of colonists.values()) {
    if (c.kind !== "farmhand") continue;
    const index = tileIndex(c.postX, c.postY);
    if (seen.has(index)) continue;
    const stage = farmhandFarmStage(tiles[index] as TileType, farmhandProgress(c));
    if (stage === null) continue;
    seen.add(index);
    out.push(index, stage);
  }
  return out;
}

function planRouteToNearestResource(
  c: Colonist,
  resourceTile: TileType
): { path: TileCoord[]; resX: number; resY: number } | null {
  const spots: TileCoord[] = [];
  for (let tx = 0; tx < WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
      if (tiles[tileIndex(tx, ty)] === resourceTile && !reservedResourceTiles.has(resourceKey(tx, ty))) {
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

function updateStationaryMiner(c: Colonist, dt: number) {
  c.state = "mining";
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    depositGatheredResource(c.kind);
    c.chopTicksRemaining = effectiveChopTicks(c.postX, c.postY);
  }
}

// A Barn farmer walks its Barn's Farm Plots in turn and works a few seconds at each (presence only:
// grain growth / yield stay in updateFarmPlots). Unreachable plots are skipped; no plots = stays put.
const FARMER_PLOT_DWELL_TICKS = 6 * TICK_RATE;
function updateFarmer(c: Colonist, dt: number) {
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
function updateFarmhand(c: Colonist) {
  const resource = FARM_PRODUCE_BY_TILE[tiles[tileIndex(c.postX, c.postY)] as TileType];
  if (!resource) return;
  c.state = "farming";
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    stock[resource] += FARMHAND_YIELD_PER_CYCLE[resource];
    c.chopTicksRemaining = effectiveFarmhandCycleTicks(c.postX, c.postY);
    c.cycleTicksTotal = c.chopTicksRemaining;
  }
}

function updateArtisan(c: Colonist) {
  const recipe = CRAFT_RECIPES[tiles[tileIndex(c.postX, c.postY)] as TileType];
  if (!recipe) return;
  c.state = "crafting";
  const inputsReady = Object.entries(recipe.inputs).every(
    ([key, amount]) => stock[key as ResourceKey] >= (amount ?? 0)
  );
  if (!inputsReady) return; // don't tick the timer down while waiting on materials
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    for (const [key, amount] of Object.entries(recipe.inputs)) {
      stock[key as ResourceKey] -= amount ?? 0;
    }
    stock[recipe.output] += recipe.outputAmount ?? 1;
    c.chopTicksRemaining = effectiveCraftTicks(c.postX, c.postY);
  }
}

function updateGathererColonist(c: Colonist, dt: number) {
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
        if (c.kind === "lumberjack" && tiles[idx] === resourceTile) {
          tiles[idx] = TileType.Empty;
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

// ---- Hunting & foraging: Hunter's Hut / Forager's Hut workers, wild game, wild forage ----
// Every tunable lives here. Hunters and foragers are civilians: they only work by day and shelter in
// houses at night like everyone else (updateColonist). Their hut's level adds workers (one per level,
// see resolveFoodHutPlacement) and, with happiness and industrial synergy, speeds their work timers.

// Hunters: find the nearest unreserved living game within HUNTER_WORK_RADIUS_TILES of the hut, close to
// bow range, shoot until it dies, pick up the carcass and carry it home (meat lands on arrival).
const HUNTER_WORK_RADIUS_TILES = 25;
// Give up a chase once the quarry is this far from the hut (it can flee past the work radius).
const HUNTER_CHASE_LEASH_TILES = HUNTER_WORK_RADIUS_TILES + 5;
const HUNTER_BOW_RANGE = TILE_SIZE * 4;
const HUNTER_ARROW_DAMAGE = 10;
const HUNTER_SHOT_COOLDOWN_TICKS = Math.round(TICK_RATE * 1.2);
const HUNTER_REPATH_TICKS = TICK_RATE;
// How many of the nearest candidates (game or forage) get a path check before the worker waits.
const FOOD_WORKER_ROUTE_CANDIDATES = 6;
const FOOD_WORKER_IDLE_RETRY_TICKS = TICK_RATE * 2;

// Foragers: nearest RIPE forage within FORAGER_WORK_RADIUS_TILES of the hut, pick for FORAGE_TICKS, carry
// the fruit home. A picked plant regrows to ripe after FORAGE_REGROW_TICKS (day and night).
const FORAGER_WORK_RADIUS_TILES = 25;
const FORAGE_TICKS = TICK_RATE * 3;
// Long days: stays 100 s of real time (one legacy day), so forage income per second is unchanged.
const FORAGE_REGROW_TICKS = LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS;

// Wild forage scatter (counts tuned for 80x80, scaled by area like the other world-gen counts).
// Berry bushes on Plains, fruit trees on Plains, mushrooms next to trees (any biome) or in Swamp.
let BERRY_BUSH_COUNT = scaledCount(24);
let FRUIT_TREE_COUNT = scaledCount(12);
let MUSHROOM_PATCH_COUNT = scaledCount(10);
// Nothing wild grows this close to the Town Center (keeps the start area buildable).
const FORAGE_MIN_TOWN_CENTER_DIST_TILES = 5;
const FORAGE_RIPE_TO_PICKED: Partial<Record<TileType, TileType>> = {
  [TileType.BerryBush]: TileType.BerryBushPicked,
  [TileType.FruitTree]: TileType.FruitTreePicked,
  [TileType.MushroomPatch]: TileType.MushroomPatchPicked,
};
const FORAGE_PICKED_TO_RIPE: Partial<Record<TileType, TileType>> = {
  [TileType.BerryBushPicked]: TileType.BerryBush,
  [TileType.FruitTreePicked]: TileType.FruitTree,
  [TileType.MushroomPatchPicked]: TileType.MushroomPatch,
};
// Fruit carried home per plant picked.
const FORAGE_FRUIT_YIELD: Partial<Record<TileType, number>> = {
  [TileType.BerryBush]: 3,
  [TileType.FruitTree]: 5,
  [TileType.MushroomPatch]: 2,
};
const FORAGE_TILES: TileType[] = [
  TileType.BerryBush,
  TileType.BerryBushPicked,
  TileType.FruitTree,
  TileType.FruitTreePicked,
  TileType.MushroomPatch,
  TileType.MushroomPatchPicked,
];
// Tile index -> ticks until that picked plant is ripe again.
const forageRegrow = new Map<number, number>();

// Wild game. Counts per 80x80 (scaled by area): every kind starts at its cap, and the population is
// topped back up by WILDLIFE_RESPAWN_PER_DAY animals a day (the kind furthest below its cap first,
// never above the caps).
interface WildlifeConfig {
  maxHp: number;
  // px/s while wandering / fleeing.
  speed: number;
  fleeSpeed: number;
  // Meat delivered when the carcass reaches the hut (or straight away when a player kills it).
  meat: number;
  cap: number;
}
const WILDLIFE_CONFIG: Record<WildlifeKind, WildlifeConfig> = {
  deer: { maxHp: 18, speed: 28, fleeSpeed: 115, meat: 6, cap: scaledCountSub(6) },
  rabbit: { maxHp: 6, speed: 30, fleeSpeed: 125, meat: 2, cap: scaledCountSub(8) },
  boar: { maxHp: 30, speed: 24, fleeSpeed: 100, meat: 8, cap: scaledCountSub(3) },
  pheasant: { maxHp: 6, speed: 22, fleeSpeed: 120, meat: 2, cap: scaledCountSub(4) },
};
// 4 a day on 80x80 (16 on 160x160): a map's sustainable hunt is about this many animals a day.
let WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCountSub(4));
// Long days: the interval stays in real time (4 per legacy 100 s day = one every 25 s on 80x80), so a
// long day tops up ~15 animals and hunting income per second is unchanged.
const WILDLIFE_RESPAWN_INTERVAL_TICKS = Math.round((LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS) / WILDLIFE_RESPAWN_PER_DAY);
// Game never spawns this close to the Town Center (nor within WILDLIFE_PLAYER_CLEARANCE_TILES of a
// player, for respawns), so the colony's surroundings aren't a petting zoo.
const WILDLIFE_MIN_TOWN_CENTER_DIST_TILES = 10;
const WILDLIFE_PLAYER_CLEARANCE_TILES = 8;
// Wandering: short walks to a random walkable spot within this radius of home, with rests between.
const WILDLIFE_WANDER_RADIUS_TILES = 5;
const WILDLIFE_REST_MIN_TICKS = TICK_RATE * 2;
const WILDLIFE_REST_MAX_TICKS = TICK_RATE * 8;
// Any damage makes an animal bolt directly away from the attacker for this long; it then settles
// wherever it ended up (its new home).
const WILDLIFE_FLEE_TICKS = TICK_RATE * 4;
// A boar shot by a hunter charges him instead of fleeing, for at most BOAR_CHARGE_TICKS, then flees.
const BOAR_CHARGE_TICKS = TICK_RATE * 6;
const BOAR_CHARGE_SPEED = 95;
const BOAR_DAMAGE = 4;
const BOAR_ATTACK_RANGE = TILE_SIZE * 0.8;
const BOAR_ATTACK_COOLDOWN_TICKS = TICK_RATE;

type WildlifeMode = "idle" | "walk" | "flee" | "charge";
interface Wildlife {
  id: number;
  kind: WildlifeKind;
  x: number;
  y: number;
  hp: number;
  homeX: number;
  homeY: number;
  mode: WildlifeMode;
  targetX: number;
  targetY: number;
  restTicks: number;
  // flee / charge time left.
  modeTicks: number;
  fleeDirX: number;
  fleeDirY: number;
  // Colonist id of the hunter chasing it (one hunter per animal), and of the hunter a boar charges.
  reservedBy: string | null;
  chargeTargetId: string | null;
  attackCooldownTicks: number;
}
const wildlife = new Map<number, Wildlife>();
let nextWildlifeId = 1;
let wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;
// testHook "setWildlifeRespawn" {enabled:false}: no new game appears (hunting tests control every animal).
let testWildlifeRespawnDisabled = false;

const WILDLIFE_STATE_CODE: Record<WildlifeMode, WildlifeState> = {
  idle: WildlifeState.Idle,
  walk: WildlifeState.Walk,
  flee: WildlifeState.Flee,
  charge: WildlifeState.Charge,
};

function wildlifeForSnapshot(): number[] {
  const out: number[] = [];
  for (const a of wildlife.values()) {
    out.push(a.id, WILDLIFE_KINDS.indexOf(a.kind), Math.round(a.x), Math.round(a.y), WILDLIFE_STATE_CODE[a.mode]);
  }
  return out;
}

function hasTreeNear(tx: number, ty: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (inBounds(tx + dx, ty + dy) && tiles[tileIndex(tx + dx, ty + dy)] === TileType.Tree) return true;
    }
  }
  return false;
}

// Deer and rabbits on Plains; boar on Plains/Hills with a tree within 2 tiles (forest edges); pheasant
// on Plains/Hills. Always an Empty tile.
function wildlifeTileOk(kind: WildlifeKind, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || tiles[tileIndex(tx, ty)] !== TileType.Empty) return false;
  if (isInReservedGrounds(tx, ty)) return false;
  if (Math.hypot(tx - TOWN_CENTER_TILE.x, ty - TOWN_CENTER_TILE.y) < WILDLIFE_MIN_TOWN_CENTER_DIST_TILES) return false;
  const biome = biomeAt(tx, ty);
  if (kind === "deer" || kind === "rabbit") return biome === Biome.Plains;
  if (kind === "boar") return biome !== Biome.Swamp && hasTreeNear(tx, ty, 2);
  return biome !== Biome.Swamp;
}

function spawnWildlifeAt(kind: WildlifeKind, tx: number, ty: number): Wildlife {
  const center = tileToPixelCenter({ x: tx, y: ty });
  const animal: Wildlife = {
    id: nextWildlifeId++,
    kind,
    x: center.x,
    y: center.y,
    hp: WILDLIFE_CONFIG[kind].maxHp,
    homeX: center.x,
    homeY: center.y,
    mode: "idle",
    targetX: center.x,
    targetY: center.y,
    restTicks: randInt(0, WILDLIFE_REST_MAX_TICKS),
    modeTicks: 0,
    fleeDirX: 0,
    fleeDirY: 0,
    reservedBy: null,
    chargeTargetId: null,
    attackCooldownTicks: 0,
  };
  wildlife.set(animal.id, animal);
  return animal;
}

// Rejection-samples a spawn tile for `kind`; null if none found (crowded map).
function pickWildlifeSpawnTile(kind: WildlifeKind, avoidPlayers: boolean): TileCoord | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const tx = Math.floor(Math.random() * WORLD_TILES_X);
    const ty = Math.floor(Math.random() * WORLD_TILES_Y);
    if (!wildlifeTileOk(kind, tx, ty)) continue;
    if (avoidPlayers) {
      const center = tileToPixelCenter({ x: tx, y: ty });
      let tooClose = false;
      for (const p of players.values()) {
        if (Math.hypot(p.x - center.x, p.y - center.y) < WILDLIFE_PLAYER_CLEARANCE_TILES * TILE_SIZE) tooClose = true;
      }
      if (tooClose) continue;
    }
    return { x: tx, y: ty };
  }
  return null;
}

function spawnInitialWildlife() {
  wildlife.clear();
  nextWildlifeId = 1;
  wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;
  for (const kind of WILDLIFE_KINDS) {
    for (let i = 0; i < WILDLIFE_CONFIG[kind].cap; i++) {
      const tile = pickWildlifeSpawnTile(kind, false);
      if (tile) spawnWildlifeAt(kind, tile.x, tile.y);
    }
  }
}

// One animal every WILDLIFE_RESPAWN_INTERVAL_TICKS, of the kind furthest below its cap (by ratio).
function updateWildlifeRespawn() {
  if (testWildlifeRespawnDisabled) return;
  if (wildlifeRespawnCooldown > 0) {
    wildlifeRespawnCooldown--;
    return;
  }
  wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;
  const counts: Record<WildlifeKind, number> = { deer: 0, rabbit: 0, boar: 0, pheasant: 0 };
  for (const a of wildlife.values()) counts[a.kind]++;
  let best: WildlifeKind | null = null;
  let bestRatio = 1;
  for (const kind of WILDLIFE_KINDS) {
    const cap = WILDLIFE_CONFIG[kind].cap;
    if (cap <= 0) continue;
    const ratio = counts[kind] / cap;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = kind;
    }
  }
  if (!best) return;
  const tile = pickWildlifeSpawnTile(best, true);
  if (tile) spawnWildlifeAt(best, tile.x, tile.y);
}

function isWalkablePixel(px: number, py: number): boolean {
  const t = tileOfPixel(px, py);
  return isWalkableTile(t.x, t.y);
}

// Straight-line step toward (tx, ty), never onto a solid tile (slides along one axis if blocked).
// Returns false when it couldn't move at all. Wildlife never pathfinds: it only takes short hops.
function stepWildlife(a: Wildlife, dirX: number, dirY: number, speed: number, dt: number): boolean {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return false;
  const step = speed * biomeSpeedMultiplier(a.x, a.y) * dt;
  const nx = a.x + (dirX / len) * step;
  const ny = a.y + (dirY / len) * step;
  const clampX = clamp(nx, TILE_SIZE / 2, worldWidth - TILE_SIZE / 2);
  const clampY = clamp(ny, TILE_SIZE / 2, worldHeight - TILE_SIZE / 2);
  if (isWalkablePixel(clampX, clampY)) {
    a.x = clampX;
    a.y = clampY;
    return true;
  }
  if (isWalkablePixel(clampX, a.y)) {
    a.x = clampX;
    return true;
  }
  if (isWalkablePixel(a.x, clampY)) {
    a.y = clampY;
    return true;
  }
  return false;
}

function startWildlifeFlee(a: Wildlife, fromX: number, fromY: number) {
  let dx = a.x - fromX;
  let dy = a.y - fromY;
  if (Math.hypot(dx, dy) < 1) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  a.mode = "flee";
  a.modeTicks = WILDLIFE_FLEE_TICKS;
  a.fleeDirX = dx;
  a.fleeDirY = dy;
  a.chargeTargetId = null;
}

// Damage from anything (hunter arrow, player lance, test hook). Returns true if it killed the animal.
// A boar hit by a hunter charges him; everything else (and a boar hit by anyone else) flees.
function damageWildlife(a: Wildlife, amount: number, fromX: number, fromY: number, hunterId: string | null): boolean {
  a.hp -= amount;
  if (a.hp <= 0) {
    wildlife.delete(a.id);
    return true;
  }
  if (a.kind === "boar" && hunterId !== null && a.mode !== "charge" && colonists.has(hunterId)) {
    a.mode = "charge";
    a.modeTicks = BOAR_CHARGE_TICKS;
    a.chargeTargetId = hunterId;
  } else if (a.mode !== "charge") {
    startWildlifeFlee(a, fromX, fromY);
  }
  return false;
}

// Dormancy: wildlife with no living player or colonist within this many tiles skips its AI and
// movement (only the cheap cooldown timer runs) and wakes when one comes near.
const DORMANCY_RADIUS_TILES = 64;
function updateWildlife(dt: number) {
  const anchors: { x: number; y: number }[] = [];
  for (const p of players.values()) if (!p.dead) anchors.push(p);
  for (const c of colonists.values()) anchors.push(c);
  const dormantDist = DORMANCY_RADIUS_TILES * TILE_SIZE;
  for (const a of wildlife.values()) {
    const config = WILDLIFE_CONFIG[a.kind];
    if (a.attackCooldownTicks > 0) a.attackCooldownTicks--;
    if (!anchors.some((p) => Math.abs(p.x - a.x) < dormantDist && Math.abs(p.y - a.y) < dormantDist)) continue;
    // Something was built on top of it (placement only checks players/colonists): step off.
    const here = tileOfPixel(a.x, a.y);
    if (!isWalkableTile(here.x, here.y)) {
      const out = findAdjacentWalkable(here.x, here.y);
      if (out) {
        const center = tileToPixelCenter(out);
        a.x = a.homeX = a.targetX = center.x;
        a.y = a.homeY = a.targetY = center.y;
      }
    }
    if (a.mode === "flee") {
      if (!stepWildlife(a, a.fleeDirX, a.fleeDirY, config.fleeSpeed, dt)) {
        // Cornered: bolt off at a new random angle.
        const angle = Math.random() * Math.PI * 2;
        a.fleeDirX = Math.cos(angle);
        a.fleeDirY = Math.sin(angle);
      }
      if (--a.modeTicks <= 0) {
        a.mode = "idle";
        a.homeX = a.x;
        a.homeY = a.y;
        a.restTicks = randInt(WILDLIFE_REST_MIN_TICKS, WILDLIFE_REST_MAX_TICKS);
      }
      continue;
    }
    if (a.mode === "charge") {
      const target = a.chargeTargetId ? colonists.get(a.chargeTargetId) : undefined;
      if (!target || --a.modeTicks <= 0) {
        startWildlifeFlee(a, target?.x ?? a.x, target?.y ?? a.y);
        continue;
      }
      const dist = Math.hypot(target.x - a.x, target.y - a.y);
      if (dist <= BOAR_ATTACK_RANGE) {
        if (a.attackCooldownTicks <= 0) {
          a.attackCooldownTicks = BOAR_ATTACK_COOLDOWN_TICKS;
          pendingEffects.push({ fromX: a.x, fromY: a.y, toX: target.x, toY: target.y, melee: true });
          damageColonist(target, BOAR_DAMAGE);
        }
      } else {
        stepWildlife(a, target.x - a.x, target.y - a.y, BOAR_CHARGE_SPEED, dt);
      }
      continue;
    }
    if (a.mode === "walk") {
      const dist = Math.hypot(a.targetX - a.x, a.targetY - a.y);
      const step = config.speed * dt;
      if (dist <= step || !stepWildlife(a, a.targetX - a.x, a.targetY - a.y, config.speed, dt)) {
        if (dist <= step) {
          a.x = a.targetX;
          a.y = a.targetY;
        }
        a.mode = "idle";
        a.restTicks = randInt(WILDLIFE_REST_MIN_TICKS, WILDLIFE_REST_MAX_TICKS);
      }
      continue;
    }
    if (--a.restTicks > 0) continue;
    const home = tileOfPixel(a.homeX, a.homeY);
    const tx = home.x + randInt(-WILDLIFE_WANDER_RADIUS_TILES, WILDLIFE_WANDER_RADIUS_TILES);
    const ty = home.y + randInt(-WILDLIFE_WANDER_RADIUS_TILES, WILDLIFE_WANDER_RADIUS_TILES);
    if (isWalkableTile(tx, ty)) {
      a.targetX = tx * TILE_SIZE + TILE_SIZE * (0.25 + Math.random() * 0.5);
      a.targetY = ty * TILE_SIZE + TILE_SIZE * (0.25 + Math.random() * 0.5);
      a.mode = "walk";
    } else {
      a.restTicks = WILDLIFE_REST_MIN_TICKS;
    }
  }
}

function scatterForage(tile: TileType, count: number, isValid: (tx: number, ty: number) => boolean) {
  let placed = 0;
  for (let attempts = 0; placed < count && attempts < scaledCount(2000); attempts++) {
    const tx = Math.floor(Math.random() * WORLD_TILES_X);
    const ty = Math.floor(Math.random() * WORLD_TILES_Y);
    if (tiles[tileIndex(tx, ty)] !== TileType.Empty) continue;
    if (isInReservedGrounds(tx, ty)) continue;
    if (Math.hypot(tx - TOWN_CENTER_TILE.x, ty - TOWN_CENTER_TILE.y) < FORAGE_MIN_TOWN_CENTER_DIST_TILES) continue;
    if (!isValid(tx, ty)) continue;
    tiles[tileIndex(tx, ty)] = tile;
    placed++;
  }
}

function generateForage() {
  forageRegrow.clear();
  scatterForage(TileType.BerryBush, BERRY_BUSH_COUNT, (tx, ty) => biomeAt(tx, ty) === Biome.Plains);
  scatterForage(TileType.FruitTree, FRUIT_TREE_COUNT, (tx, ty) => biomeAt(tx, ty) === Biome.Plains);
  scatterForage(
    TileType.MushroomPatch,
    MUSHROOM_PATCH_COUNT,
    (tx, ty) => biomeAt(tx, ty) === Biome.Swamp || hasTreeNear(tx, ty, 1)
  );
}

// Picked plants count down to ripe; an entry whose tile was cleared (demolished) is dropped.
function updateForageRegrow() {
  for (const [index, ticks] of forageRegrow) {
    const tile = tiles[index] as TileType;
    const ripe = FORAGE_PICKED_TO_RIPE[tile];
    if (ripe === undefined) {
      forageRegrow.delete(index);
      continue;
    }
    if (ticks > 1) {
      forageRegrow.set(index, ticks - 1);
      continue;
    }
    forageRegrow.delete(index);
    tiles[index] = ripe;
    broadcastTileUpdate(index % WORLD_TILES_X, Math.floor(index / WORLD_TILES_X), ripe);
  }
}

// Hunter/forager work timers: hut level, happiness and industrial synergy (no biome factor).
function effectiveFoodHutTicks(base: number, tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((base * (1 - levelBonus(level))) / (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

function hutDistanceTiles(c: Colonist, px: number, py: number): number {
  const hut = tileToPixelCenter({ x: c.postX, y: c.postY });
  return Math.hypot(px - hut.x, py - hut.y) / TILE_SIZE;
}

// Path home to the hut's doorstep; the worker deposits when it arrives (state "carrying").
function startCarryingHome(c: Colonist) {
  const approach = findAdjacentWalkable(c.postX, c.postY);
  const path = approach ? findPath(tileOfPixel(c.x, c.y), approach) : null;
  c.path = path ?? [];
  c.state = "carrying";
}

function depositCarried(c: Colonist, resource: "meat" | "fruit") {
  stock[resource] += c.carryAmount;
  c.carryAmount = 0;
  c.state = "idle";
}

function planHunt(c: Colonist): { animal: Wildlife; path: TileCoord[] } | null {
  const candidates: { animal: Wildlife; d: number }[] = [];
  for (const a of wildlife.values()) {
    if (a.reservedBy !== null && a.reservedBy !== c.id) continue;
    if (hutDistanceTiles(c, a.x, a.y) > HUNTER_WORK_RADIUS_TILES) continue;
    candidates.push({ animal: a, d: Math.hypot(a.x - c.x, a.y - c.y) });
  }
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(c.x, c.y);
  for (const { animal } of candidates.slice(0, FOOD_WORKER_ROUTE_CANDIDATES)) {
    const path = findPath(start, tileOfPixel(animal.x, animal.y));
    if (path) return { animal, path };
  }
  return null;
}

// States: idle -> stalking (walk to bow range) -> hunting (shoot) -> collecting (walk to the carcass)
// -> carrying (walk home, deposit meat) -> idle. A carcass load survives the night (carried home at
// dawn); the reservation on a live animal doesn't (released when the hunter goes to shelter).
function updateHunter(c: Colonist, dt: number) {
  switch (c.state) {
    case "stalking":
    case "hunting": {
      const animal = c.targetWildlifeId !== null ? wildlife.get(c.targetWildlifeId) : undefined;
      if (!animal || hutDistanceTiles(c, animal.x, animal.y) > HUNTER_CHASE_LEASH_TILES) {
        releaseResourceReservation(c);
        c.path = [];
        c.state = "idle";
        c.idleCooldown = 0;
        return;
      }
      if (c.attackCooldownTicks > 0) c.attackCooldownTicks--;
      const dist = Math.hypot(animal.x - c.x, animal.y - c.y);
      if (dist > HUNTER_BOW_RANGE) {
        c.state = "stalking";
        if (c.repathCooldown > 0) c.repathCooldown--;
        if (c.path.length === 0 || c.repathCooldown <= 0) {
          c.path = findPath(tileOfPixel(c.x, c.y), tileOfPixel(animal.x, animal.y)) ?? [];
          c.repathCooldown = HUNTER_REPATH_TICKS;
        }
        advanceAlongPath(c, dt, COLONIST_SPEED);
        return;
      }
      c.state = "hunting";
      c.path = [];
      if (c.attackCooldownTicks > 0) return;
      c.attackCooldownTicks = effectiveFoodHutTicks(HUNTER_SHOT_COOLDOWN_TICKS, c.postX, c.postY);
      pendingEffects.push({ fromX: c.x, fromY: c.y, toX: animal.x, toY: animal.y });
      const carcass = { x: animal.x, y: animal.y };
      if (damageWildlife(animal, HUNTER_ARROW_DAMAGE, c.x, c.y, c.id)) {
        c.targetWildlifeId = null;
        c.carryAmount += WILDLIFE_CONFIG[animal.kind].meat;
        c.path = findPath(tileOfPixel(c.x, c.y), tileOfPixel(carcass.x, carcass.y)) ?? [];
        c.state = "collecting";
      }
      return;
    }
    case "collecting":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) startCarryingHome(c);
      return;
    case "carrying":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) depositCarried(c, "meat");
      return;
    default: {
      // "idle" (and anything left over from sheltering).
      c.state = "idle";
      if (c.carryAmount > 0) {
        startCarryingHome(c);
        return;
      }
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        return;
      }
      const plan = planHunt(c);
      if (!plan) {
        c.idleCooldown = FOOD_WORKER_IDLE_RETRY_TICKS;
        return;
      }
      plan.animal.reservedBy = c.id;
      c.targetWildlifeId = plan.animal.id;
      c.path = plan.path;
      c.repathCooldown = HUNTER_REPATH_TICKS;
      c.state = "stalking";
    }
  }
}

// Approach tile for a forage plant: walkable ones (bush, mushrooms) are stood on, a fruit tree from
// beside it.
function forageApproach(tx: number, ty: number): TileCoord | null {
  return isWalkableTile(tx, ty) ? { x: tx, y: ty } : findAdjacentWalkable(tx, ty);
}

function planForage(c: Colonist): { tx: number; ty: number; path: TileCoord[] } | null {
  const hut = { x: c.postX, y: c.postY };
  const r = FORAGER_WORK_RADIUS_TILES;
  const candidates: { tx: number; ty: number; d: number }[] = [];
  for (let ty = Math.max(0, hut.y - r); ty <= Math.min(WORLD_TILES_Y - 1, hut.y + r); ty++) {
    for (let tx = Math.max(0, hut.x - r); tx <= Math.min(WORLD_TILES_X - 1, hut.x + r); tx++) {
      if (FORAGE_RIPE_TO_PICKED[tiles[tileIndex(tx, ty)] as TileType] === undefined) continue;
      if (Math.hypot(tx - hut.x, ty - hut.y) > r) continue;
      if (reservedResourceTiles.has(resourceKey(tx, ty))) continue;
      candidates.push({ tx, ty, d: (tx + 0.5 - c.x / TILE_SIZE) ** 2 + (ty + 0.5 - c.y / TILE_SIZE) ** 2 });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(c.x, c.y);
  for (const cand of candidates.slice(0, FOOD_WORKER_ROUTE_CANDIDATES)) {
    const approach = forageApproach(cand.tx, cand.ty);
    if (!approach) continue;
    const path = findPath(start, approach);
    if (path) return { tx: cand.tx, ty: cand.ty, path };
  }
  return null;
}

// States: idle -> toForage (walk) -> foraging (pick for FORAGE_TICKS) -> carrying (walk home, deposit
// fruit) -> idle. The target plant is reserved in reservedResourceTiles like a lumberjack's tree.
function updateForager(c: Colonist, dt: number) {
  const targetRipe = () =>
    c.targetResourceX >= 0 &&
    FORAGE_RIPE_TO_PICKED[tiles[tileIndex(c.targetResourceX, c.targetResourceY)] as TileType] !== undefined;
  switch (c.state) {
    case "toForage":
      if (!targetRipe()) {
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
        c.path = [];
        c.state = "idle";
        return;
      }
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) {
        c.state = "foraging";
        c.chopTicksRemaining = effectiveFoodHutTicks(FORAGE_TICKS, c.postX, c.postY);
      }
      return;
    case "foraging": {
      if (!targetRipe()) {
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
        c.state = "idle";
        return;
      }
      if (--c.chopTicksRemaining > 0) return;
      const index = tileIndex(c.targetResourceX, c.targetResourceY);
      const ripe = tiles[index] as TileType;
      const picked = FORAGE_RIPE_TO_PICKED[ripe]!;
      tiles[index] = picked;
      broadcastTileUpdate(c.targetResourceX, c.targetResourceY, picked);
      forageRegrow.set(index, FORAGE_REGROW_TICKS);
      c.carryAmount += FORAGE_FRUIT_YIELD[ripe] ?? 0;
      releaseResourceReservation(c);
      c.targetResourceX = -1;
      c.targetResourceY = -1;
      startCarryingHome(c);
      return;
    }
    case "carrying":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) depositCarried(c, "fruit");
      return;
    default: {
      c.state = "idle";
      if (c.carryAmount > 0) {
        startCarryingHome(c);
        return;
      }
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        return;
      }
      const plan = planForage(c);
      if (!plan) {
        c.idleCooldown = FOOD_WORKER_IDLE_RETRY_TICKS;
        return;
      }
      reservedResourceTiles.set(resourceKey(plan.tx, plan.ty), c.id);
      c.targetResourceX = plan.tx;
      c.targetResourceY = plan.ty;
      c.path = plan.path;
      c.state = "toForage";
    }
  }
}

// ---- Builders: they turn construction sites (see startConstruction) into buildings ----
// Civilians: work only by day, shelter at night (the site keeps its progress overnight). States:
// idle -> carrying (hauling materials to a site) -> building (adds to the site's progress every tick)
// -> idle; with nothing to build they walk back to their post ("toPost").
const BUILDER_MAX_PER_SITE = 2;
const BUILDER_IDLE_RETRY_TICKS = TICK_RATE;
// A builder works the site from any tile within this distance of its center (i.e. a neighbouring tile).
const BUILDER_WORK_RANGE_PX = TILE_SIZE * 1.6;
// How many of the nearest open sites get a path check per try (unreachable ones stay queued).
const BUILDER_ROUTE_CANDIDATES = 6;

function anyBuilderAlive(): boolean {
  for (const c of colonists.values()) if (c.kind === "builder") return true;
  return false;
}

function siteBuilderCount(key: string, onlyWorking = false): number {
  let n = 0;
  for (const c of colonists.values()) {
    if (c.buildSiteKey === key && (!onlyWorking || c.state === "building")) n++;
  }
  return n;
}

// Progress a builder adds per tick (a site needs `totalTicks` of it): happiness and the Town Center
// bonus, plus its Guild's level and industrial synergy for a Guild builder.
function builderRate(c: Colonist): number {
  let rate = productionSpeedMultiplier();
  if (tiles[tileIndex(c.postX, c.postY)] === TileType.BuildersGuild) {
    rate *= (1 + levelBonus(getBuildingLevel(c.postX, c.postY))) * industrialSynergyMultiplier(c.postX, c.postY);
  }
  return rate;
}

function planBuildSite(c: Colonist): { key: string; path: TileCoord[] } | null {
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

function updateBuilder(c: Colonist, dt: number) {
  // Its Town Center fell: report to the nearest one still standing.
  if (!isValidPostTile("builder", tiles[tileIndex(c.postX, c.postY)] as TileType)) {
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

// ---- Repair: idle builders (by day, like all builder work) heal damaged buildings ----
// "Not enough materials to repair" is announced at most this often.
const REPAIR_SHORT_TOAST_TICKS = TICK_RATE * 30;
let lastRepairShortToastTick = -Infinity;

function announceRepairShort() {
  if (cycleTick - lastRepairShortToastTick < REPAIR_SHORT_TOAST_TICKS && cycleTick >= lastRepairShortToastTick) return;
  lastRepairShortToastTick = cycleTick;
  broadcastEvent("build", "Not enough materials to repair");
}

// Materials for `hp` HP of repair at a tile: REPAIR_COST_FRACTION of the building's placement cost
// (times its level) pro rata to hp / max HP, each resource rounded up.
function repairCost(tx: number, ty: number, hp: number): Cost {
  const s = structureHp(tx, ty);
  if (!s || hp <= 0) return {};
  const t = tiles[tileIndex(tx, ty)] as TileType;
  const base = placementCost(upgradePlacementTile(t) ?? t, TileType.Empty, tx, ty);
  const fraction = REPAIR_COST_FRACTION * currentBuildingLevel(tx, ty, t) * Math.min(1, hp / s.max);
  const cost: Cost = {};
  for (const [key, amount] of Object.entries(base)) {
    if (amount) cost[key as ResourceKey] = Math.ceil(amount * fraction - 1e-9);
  }
  return cost;
}

// HP still to be paid for before the building at a tile is back to full.
function unpaidRepairHp(tx: number, ty: number): number {
  const s = structureHp(tx, ty);
  return s ? Math.max(0, s.max - s.hp - (repairPaid.get(resourceKey(tx, ty)) ?? 0)) : 0;
}

function mobNearTile(tile: TileCoord, rangeTiles: number): boolean {
  const c = tileToPixelCenter(tile);
  const r = rangeTiles * TILE_SIZE;
  for (const m of mobs.values()) {
    if (isDormantGuardian(m) || m.passive || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - c.x, m.y - c.y) <= r) return true;
  }
  return false;
}

function repairBuilderCount(key: string): number {
  let n = 0;
  for (const c of colonists.values()) if (c.repairKey === key) n++;
  return n;
}

// The repair job for an idle builder: manual Repair requests first (in request order), then the most
// damaged building (lowest HP fraction). Skips jobs with a mob nearby, full crews, unaffordable ones
// (announced) and unreachable ones.
function planRepair(c: Colonist): { key: string; path: TileCoord[] } | null {
  // Drop manual requests for buildings that are gone or already back to full.
  for (let i = repairQueue.length - 1; i >= 0; i--) {
    const tile = keyToTile(repairQueue[i]);
    const s = tile ? structureHp(tile.x, tile.y) : null;
    if (!s || s.hp >= s.max) repairQueue.splice(i, 1);
  }
  const jobs: { key: string; tile: TileCoord; rank: number; n: number }[] = repairQueue.map((key, i) => ({ key, tile: keyToTile(key)!, rank: i - repairQueue.length, n: 0 }));
  const auto = Array.from(buildingHp.keys()).concat(townCenters.map((tc) => resourceKey(tc.x, tc.y)));
  for (const key of auto) {
    if (repairQueue.includes(key)) continue;
    const tile = keyToTile(key);
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
function updateRepair(c: Colonist, dt: number): boolean {
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
  if (cycleTick % BUILDER_IDLE_RETRY_TICKS === 0) {
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
function handleRepairBuilding(player: Player, tx: number, ty: number) {
  if (player.dead) return;
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

function houseCapacity(t: TileType): number {
  return t === TileType.HouseLevel2 ? 5 : t === TileType.BigHouse ? 3 : t === TileType.House ? 1 : 0;
}

function houseOccupancy(tx: number, ty: number): number {
  let n = 0;
  for (const o of colonists.values()) {
    if (o.shelterAssigned && o.homeTileX === tx && o.homeTileY === ty) n++;
  }
  return n;
}

// Each civilian sleeps in the nearest house with a free bed; anyone left over (or with no house
// at all) uses the nearest standing Town Center (with none, they just wait where they are). Beds are a house's tier capacity (1 / 3 / 5).
function assignShelter(c: Colonist) {
  c.shelterAssigned = true;
  c.homeTileX = -1;
  c.homeTileY = -1;
  let bestD = Infinity;
  for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < WORLD_TILES_X; tx++) {
      const cap = houseCapacity(tiles[tileIndex(tx, ty)] as TileType);
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

function shelterTileFor(c: Colonist): TileCoord | null {
  return c.homeTileX >= 0 ? { x: c.homeTileX, y: c.homeTileY } : nearestTownCenter(c.x, c.y);
}

function isAtShelter(c: Colonist): boolean {
  if (!c.sheltering || !c.shelterAssigned) return false;
  const shelter = shelterTileFor(c);
  if (!shelter) return false;
  const center = tileToPixelCenter(shelter);
  return Math.hypot(c.x - center.x, c.y - center.y) <= TILE_SIZE * 1.5;
}

function updateShelteringCivilian(c: Colonist, dt: number) {
  // (Re)assign on first night tick, and if the house was demolished or replaced mid-night.
  if (!c.shelterAssigned || (c.homeTileX >= 0 && houseCapacity(tiles[tileIndex(c.homeTileX, c.homeTileY)] as TileType) === 0)) {
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

function updateStationaryWorkerReturning(c: Colonist, dt: number) {
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

function getMobById(id: string): Mob | undefined {
  return mobs.get(id);
}

// ---- Engagement slots ----
// A melee attacker claims one slot on a ring around its target and fights from there, so several
// attackers spread around a target instead of stacking on one point. Unit targets (mob / colonist /
// player) get N slots at angles 2*pi*i/N; buildings and Town Centers get the walkable tiles of their
// 8-tile ring reachable from the approach tile pickBuildingTarget chose. Ranged attackers take none.
// Keys: "m:<mobId>", "c:<colonistId>", "p:<playerId>", "b:<x,y>" (buildings and Town Centers).
const slotClaims = new Map<string, Map<number, string>>();
const attackerSlots = new Map<string, { key: string; slot: number }>();

function releaseSlot(attackerId: string) {
  const claim = attackerSlots.get(attackerId);
  if (!claim) return;
  attackerSlots.delete(attackerId);
  const claims = slotClaims.get(claim.key);
  if (claims && claims.get(claim.slot) === attackerId) {
    claims.delete(claim.slot);
    if (claims.size === 0) slotClaims.delete(claim.key);
  }
}

// How many melee attackers may fight one unit target at once, by its body radius: 3 on a soldier-sized
// body, 4 on an orc-sized one, 6 on a troll / ogre.
function meleeAttackerCap(targetRadius: number): number {
  return targetRadius >= 12 ? 6 : targetRadius >= 9 ? 4 : 3;
}

// True when `attackerId` already fights `key` from a slot, or `key` has fewer than `cap` attackers.
function targetHasRoom(attackerId: string, key: string, cap: number): boolean {
  const held = attackerSlots.get(attackerId);
  if (held && held.key === key) return true;
  return (slotClaims.get(key)?.size ?? 0) < cap;
}

// Keeps the attacker's slot on `key` while it is still usable (finite score), else claims the free
// slot with the lowest score. -1 when every usable slot is taken, or `cap` attackers already hold one
// (the attacker then queues: see updateGuardColonist / updateMob).
function claimSlot(attackerId: string, key: string, count: number, score: (slot: number) => number, cap = Infinity): number {
  const held = attackerSlots.get(attackerId);
  if (held && held.key === key && held.slot < count && score(held.slot) !== Infinity) return held.slot;
  releaseSlot(attackerId);
  let claims = slotClaims.get(key);
  if ((claims?.size ?? 0) >= cap) return -1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    if (claims?.has(i)) continue;
    const s = score(i);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  if (best < 0) return -1;
  if (!claims) {
    claims = new Map();
    slotClaims.set(key, claims);
  }
  claims.set(best, attackerId);
  attackerSlots.set(attackerId, { key, slot: best });
  return best;
}

function mobSlotKey(mob: Mob): string | null {
  if (!mob.targetType || mob.targetId === null) return null;
  if (mob.targetType === "colonist") return `c:${mob.targetId}`;
  if (mob.targetType === "player") return `p:${mob.targetId}`;
  return `b:${mob.targetId}`;
}

// Once a second: frees slots of dead attackers and of attackers that have moved on to another target.
function pruneSlotClaims() {
  for (const [id, claim] of attackerSlots) {
    const mob = mobs.get(id);
    const c = mob ? undefined : colonists.get(id);
    const current = mob ? (mob.melee ? mobSlotKey(mob) : null) : c && c.targetMobId ? `m:${c.targetMobId}` : null;
    if (current !== claim.key) releaseSlot(id);
  }
}

// The point a melee attacker (at ax, ay, body ar, attack range `range`) should fight `key` from: a ring
// slot around the target at (tx, ty) with body radius tr. null: no free slot (or `cap` reached).
function unitSlotPoint(
  attackerId: string, ax: number, ay: number, ar: number, range: number,
  key: string, tx: number, ty: number, tr: number, cap = Infinity
): { x: number; y: number } | null {
  const n = tr >= 12 ? 10 : tr >= 9 ? 8 : 6;
  const radius = Math.min(range - 0.5, Math.max(range * 0.9, tr + ar + 1));
  const a0 = Math.atan2(ay - ty, ax - tx);
  const point = (i: number) => {
    const a = (2 * Math.PI * i) / n;
    return { x: tx + Math.cos(a) * radius, y: ty + Math.sin(a) * radius };
  };
  const slot = claimSlot(attackerId, key, n, (i) => {
    const p = point(i);
    if (!isWalkablePixel(p.x, p.y)) return Infinity;
    const da = Math.abs(((((2 * Math.PI * i) / n - a0) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    return da;
  }, cap);
  return slot < 0 ? null : point(slot);
}

// Clockwise 8-ring around a tile; consecutive entries are edge-adjacent, so a run of walkable entries
// is one connected strip.
const RING_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

// The ring tile a mob attacks building (bx, by) from: the walkable strip of the building's 8-ring that
// contains `approach` (so it is reachable), nearest free tile first. null without an approach tile.
function buildingSlotTile(mob: Mob, key: string, bx: number, by: number, approach: TileCoord | null): TileCoord | null {
  if (!approach) return null;
  const start = RING_8.findIndex(([dx, dy]) => bx + dx === approach.x && by + dy === approach.y);
  if (start < 0) return approach;
  const reachable = new Array<boolean>(8).fill(false);
  reachable[start] = true;
  for (const dir of [1, 7]) {
    for (let k = 1; k < 8; k++) {
      const i = (start + dir * k) % 8;
      if (!isWalkableTile(bx + RING_8[i][0], by + RING_8[i][1])) break;
      reachable[i] = true;
    }
  }
  const slot = claimSlot(mob.id, key, 8, (i) => {
    if (!reachable[i]) return Infinity;
    const c = tileToPixelCenter({ x: bx + RING_8[i][0], y: by + RING_8[i][1] });
    return Math.hypot(c.x - mob.x, c.y - mob.y);
  });
  return slot < 0 ? approach : { x: bx + RING_8[slot][0], y: by + RING_8[slot][1] };
}

// Moves a melee attacker toward `goal` (its slot, or the target itself) when out of attack range:
// close in straight once within 1.5 tiles, otherwise follow a path to the goal's tile (rate-limited).
function approachGoal(
  e: { x: number; y: number; path: TileCoord[]; repathCooldown: number },
  goal: { x: number; y: number },
  fallback: { x: number; y: number },
  speed: number,
  dt: number
) {
  if (Math.hypot(goal.x - e.x, goal.y - e.y) <= TILE_SIZE * 1.5) {
    e.path = [];
    if (stepRaidMobToward(e, goal.x, goal.y, speed, dt)) return;
    goal = fallback;
  }
  if (e.path.length === 0 && e.repathCooldown <= 0) {
    const goalTile = isWalkablePixel(goal.x, goal.y) ? tileOfPixel(goal.x, goal.y) : tileOfPixel(fallback.x, fallback.y);
    e.path = findPath(tileOfPixel(e.x, e.y), goalTile) ?? [];
    e.repathCooldown = MOB_REPATH_TICKS;
  } else if (e.repathCooldown > 0) {
    e.repathCooldown--;
  }
  advanceAlongPath(e, dt, speed);
}

// ---- Bodies: spatial hash + separation ----
// Rebuilt every tick after everything has moved: one cell per tile (bodies are at most 28 px across,
// so overlapping pairs are always in the same or adjacent cells). Bodies: soldiers and bishops (not the
// Ward Priest), and every awake mob that isn't a loitering raider or a dormant deserter. Civilians keep
// to their posts / paths and are left out, as are players.
interface Body {
  e: { x: number; y: number };
  r: number;
  w: number;
  // Walls & gates: a mob body is nudged from the hostile side (never onto a closed gate).
  mob?: boolean;
}
const bodies: Body[] = [];
let cellHead = new Int32Array(WORLD_TILES_X * WORLD_TILES_Y);
let cellNext = new Int32Array(256);
// Ids of mobs that struck or held in attack range this tick (they take the smaller separation share).
const mobsAttackingThisTick = new Set<string>();

function collectBodies() {
  bodies.length = 0;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind) && !(c.kind === "bishop" && !isWardPriest(c))) continue;
    const still = c.state === "attacking" || c.state === "idle";
    bodies.push({ e: c, r: COLONIST_BODY_RADIUS, w: still ? SEPARATION_WEIGHT_STILL : SEPARATION_WEIGHT_MOVING });
  }
  for (const m of mobs.values()) {
    if (isDormantGuardian(m) || (m.isDeserter && !m.deserterActive) || m.passive) continue;
    const still = mobsAttackingThisTick.has(m.id);
    bodies.push({ e: m, r: MOB_BODY_RADIUS[m.kind] ?? 8, w: still ? SEPARATION_WEIGHT_STILL : SEPARATION_WEIGHT_MOVING, mob: true });
  }
}

function rebuildBodyHash() {
  cellHead.fill(-1);
  if (cellNext.length < bodies.length) cellNext = new Int32Array(bodies.length * 2);
  for (let i = 0; i < bodies.length; i++) {
    const tx = Math.floor(bodies[i].e.x / TILE_SIZE);
    const ty = Math.floor(bodies[i].e.y / TILE_SIZE);
    if (!inBounds(tx, ty)) {
      cellNext[i] = -1;
      continue;
    }
    const cell = tileIndex(tx, ty);
    cellNext[i] = cellHead[cell];
    cellHead[cell] = i;
  }
}

// Moves a body by (dx, dy) unless that would put its centre on a solid tile.
function nudgeBody(b: Body, dx: number, dy: number) {
  const prevMover = hostileMover;
  hostileMover = b.mob === true;
  const nx = b.e.x + dx;
  const ny = b.e.y + dy;
  if (isWalkablePixel(nx, ny)) {
    b.e.x = nx;
    b.e.y = ny;
  } else if (isWalkablePixel(nx, b.e.y)) {
    b.e.x = nx;
  } else if (isWalkablePixel(b.e.x, ny)) {
    b.e.y = ny;
  }
  hostileMover = prevMover;
}

// Push-apart relaxation over every overlapping pair (allies and enemies alike).
function separateBodies() {
  collectBodies();
  for (let iter = 0; iter < SEPARATION_ITERATIONS; iter++) {
    rebuildBodyHash();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const tx = Math.floor(a.e.x / TILE_SIZE);
      const ty = Math.floor(a.e.y / TILE_SIZE);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!inBounds(tx + ox, ty + oy)) continue;
          for (let j = cellHead[tileIndex(tx + ox, ty + oy)]; j >= 0; j = cellNext[j]) {
            if (j <= i) continue;
            const b = bodies[j];
            let dx = b.e.x - a.e.x;
            let dy = b.e.y - a.e.y;
            const min = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            let d = Math.sqrt(d2);
            if (d < 0.01) {
              // Exactly stacked: split along a fixed per-pair direction.
              const ang = (i * 7 + j * 13) * 0.61803;
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              d = 1;
            }
            const overlap = min - Math.sqrt(d2);
            const share = overlap / (a.w + b.w);
            nudgeBody(a, (-dx / d) * share * a.w, (-dy / d) * share * a.w);
            nudgeBody(b, (dx / d) * share * b.w, (dy / d) * share * b.w);
          }
        }
      }
    }
  }
  mobsAttackingThisTick.clear();
}

function isDormantGuardian(mob: Mob): boolean {
  return mob.siteId !== null && !mob.guardianActive;
}

// Wakes every guardian sharing siteId, permanently (no re-dormancy).
function activateGuardianSite(siteId: string) {
  for (const m of mobs.values()) {
    if (m.siteId === siteId) m.guardianActive = true;
  }
}

// Wiped wholesale at each dawn (before that dawn's starvation deaths add new ones), so every entry
// was placed since the most recent dawn and lasts until the next one.
const gravestones: GravestoneSnapshot[] = [];

// attackerKey ("p:<playerId>" / "c:<colonistId>") marks a blow for the fight notifiers; blows without
// one (test hooks, untracked sources) aren't counted as fighting.
function damageMob(mob: Mob, amount: number, attackerKey?: string) {
  if (attackerKey) recordFightHit(mob, mob.x, mob.y, attackerKey, amount);
  if (isDormantGuardian(mob)) activateGuardianSite(mob.siteId!);
  // Hitting any member of a raid group (passive or marching) turns the whole group on its attackers.
  if (mob.groupId !== null) {
    const group = raidGroups.get(mob.groupId);
    if (group) engageRaidGroup(group);
  }
  // Hero phase 4: a cursed mob takes more from every source.
  amount *= spellDamageTakenMult(mob);
  mob.hp -= mob.mark === HungerMark.Gorrath && cycleTick < mob.furyUntilTick ? amount * GORRATH_FURY_DAMAGE_TAKEN : amount;
  mob.lastDamagedTick = cycleTick;
  // Gorrath's frenzy: the first lethal blow is shrugged off into a short wounded fury.
  if (mob.hp <= 0 && mob.mark === HungerMark.Gorrath && mob.furyUntilTick === 0) {
    mob.hp = Math.max(1, Math.round(mob.maxHp * GORRATH_FURY_HP_FRACTION));
    mob.furyUntilTick = cycleTick + GORRATH_FURY_TICKS;
  }
  if (mob.hp <= 0) {
    gravestones.push({ x: mob.x, y: mob.y, variant: Math.random() < 0.5 ? 0 : 1 });
    mobs.delete(mob.id);
    noteRegimentCasualty(mob);
    stock.gold += goldForKill(mob);
    dropEquipmentFor(mob);
    heroRewardsForKill(mob, attackerKey);
    if (mob.boss) onBossKilled(mob);
  }
}

// A killed player respawns at the standing Town Center nearest where they fell. With none standing
// they stay dead (game over for them) until someone builds one: see respawnDeadPlayers.
function damagePlayer(player: Player, amount: number) {
  if (player.dead) return;
  // Hero gear: every blow / poison tick the player takes is scaled (equipment survives death).
  const mult = heroProfileOf(player).stats.damageTakenMult;
  if (mult !== 1) heroEvent({ type: "taken", key: player.profileKey, amount: amount * mult, detail: String(amount) });
  // Hero phase 4: a ward shield soaks it first.
  player.hp -= absorbWithWard("p:" + player.id, amount * mult);
  if (player.hp <= 0) {
    player.poisonTicksRemaining = 0;
    if (townCenters.length > 0) {
      player.hp = playerMaxHp(player);
      const spawn = spawnPointNearTownCenter(player);
      player.x = spawn.x;
      player.y = spawn.y;
    } else {
      player.hp = 0;
      player.dead = true;
      player.input = { dx: 0, dy: 0 };
      broadcastEvent("death", "A rider has fallen, and no Town Center stands to rise again at");
    }
  }
}

function respawnDeadPlayers() {
  if (townCenters.length === 0) return;
  for (const p of players.values()) {
    if (!p.dead) continue;
    p.dead = false;
    p.hp = playerMaxHp(p);
    const spawn = spawnPointNearTownCenter(p);
    p.x = spawn.x;
    p.y = spawn.y;
  }
}

function colonistDeathText(c: Colonist): string {
  if (isWardPriest(c)) return "The Ward Priest has died";
  if (c.kind === "hero") return `${c.heroName ?? "A hero"} has fallen: back at the next dawn or dusk for ${heroRespawnFee(c.id)} gold`;
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  return `${/^[aeiou]/.test(name) ? "An" : "A"} ${name} has died`;
}

function damageColonist(colonist: Colonist, amount: number) {
  // Armour & weapons: armour scales every blow taken (max HP is unchanged).
  if ((colonist.armourTier ?? 0) > 0) {
    const raw = amount;
    amount *= armourDamageTakenMult(colonist);
    equipEvent({ type: "taken", id: colonist.id, tier: colonist.armourTier, amount, detail: String(raw) });
  }
  // Hero phase 3: a hero's own gear + level (the same HeroStats as the player).
  if (colonist.kind === "hero") amount *= heroProfileFor(heroKey(colonist.id)).stats.damageTakenMult;
  // Hero phase 4: a ward shield soaks it first.
  colonist.hp -= absorbWithWard("c:" + colonist.id, amount);
  if (colonist.hp <= 0 && isSummoned(colonist)) {
    // A summoned skeleton crumbles: no grave, toast or respawn.
    summonedUntil.delete(colonist.id);
    releaseResourceReservation(colonist);
    colonists.delete(colonist.id);
    return;
  }
  if (colonist.hp <= 0) {
    gravestones.push({ x: colonist.x, y: colonist.y, variant: Math.random() < 0.5 ? 0 : 1 });
    broadcastEvent("death", colonistDeathText(colonist));
    releaseResourceReservation(colonist);
    // Siege engines are rebuilt at their workshop, never respawned.
    if (!isWardPriest(colonist) && !isSiegeKind(colonist.kind)) queueRespawn(colonist);
    colonists.delete(colonist.id);
    chargeRuns.delete(colonist.id);
    if (colonist.kind === "hero") heroRosterVersion++;
  }
}

const COMMANDABLE_KINDS: ColonistKind[] = [
  "knight", "archer", "bishop", "militia", "spearman", "pikeman", "cavalry", "batteringRam", "catapult", "hero",
];

// Only a Church's bishop takes orders: the Ward Priest must keep his rounds for the wards to stand,
// and the Abbey's clergy aren't the colony's at all. Mirrored by the client's isCommandable (which
// sees the Ward Priest's post as a Ward Stone).
function isCommandable(c: Colonist): boolean {
  if (!COMMANDABLE_KINDS.includes(c.kind)) return false;
  if (isWardPriest(c)) return false;
  return c.kind !== "bishop" || tiles[tileIndex(c.postX, c.postY)] === TileType.ChurchPost;
}

function handleCommandMove(unitIds: string[], x: number, y: number, squad?: unknown) {
  const tile = tileOfPixel(x, y);
  if (!inBounds(tile.x, tile.y)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c)) continue;
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

// Colonist id -> the mob an explicit Attack order sent it after: that chase ignores the line leash
// (LINE_LEASH_TILES) and the front-rank hold. Stale entries are harmless (checked against targetMobId).
const commandedTargets = new Map<string, string>();

function handleCommandAttack(unitIds: string[], mobId: string) {
  if (!mobs.has(mobId) || !Array.isArray(unitIds)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind)) continue;
    leaveOrderGroup(c.id);
    c.targetMobId = mobId;
    c.targetHearthId = null;
    commandedTargets.set(c.id, mobId);
    c.path = [];
    c.repathCooldown = 0;
  }
}

const STANCES: Stance[] = ["defensive", "normal", "aggressive"];

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

// ---- Army regiments (strategy mode phase 2; docs PLAN-strategy-mode.md §4 and the user's 2026-10-28
// grouping decision). Derived from state at every snapshot, never stored: each commandable unit is in
// exactly one regiment —
//   task force N (assignTaskForce)  "tf<N>": the manual merge / split (select units, Ctrl+N)
//   a hero                          "h:<id>": alone
//   everything else                 "a:<settlement>:<class>": by Town Center (settlementOf) and class
// Respawned units get new ids, so they rejoin their post's auto regiment (a hero its own). Task forces and
// settlements are already saved, so save / load needs nothing new. Mob regiments (RegimentState) are separate.
const REGIMENT_CLASS_OF: Partial<Record<ColonistKind, RegimentClass>> = {
  knight: "knights",
  archer: "archers",
  cavalry: "cavalry",
  militia: "infantry",
  spearman: "infantry",
  pikeman: "infantry",
  bishop: "clergy",
  batteringRam: "rams",
  catapult: "catapults",
  hero: "hero",
};
const REGIMENT_CLASS_LABEL: Record<RegimentClass, string> = {
  infantry: "Infantry", knights: "Knights", archers: "Archers", cavalry: "Cavalry", clergy: "Clergy",
  rams: "Rams", catapults: "Catapults", hero: "Hero", mixed: "Task Force",
};
const REGIMENT_CLASS_ORDER: RegimentClass[] = ["knights", "infantry", "archers", "cavalry", "rams", "catapults", "clergy"];
// Without a membership / name change, armyRegiments rides along every this many ticks (2 Hz).
const ARMY_REGIMENT_REFRESH_TICKS = 10;
// Size each task force was assigned at (its card's max); not saved (a loaded one starts at its alive count).
const taskForceMax = new Map<number, number>();
let armyRegimentSignature = "";
let armyRegimentTicks = 0;

function romanNumeral(n: number): string {
  const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) for (; n >= v; n -= v) out += s;
  return out;
}

function armyRegimentsNow(): ArmyRegimentSnapshot[] {
  const settlementNumber = new Map(townCenters.map((tc, i) => [resourceKey(tc.x, tc.y), i + 1]));
  const inTaskForce = new Map<string, number>();
  for (const [slot, ids] of taskForces) for (const id of ids) inTaskForce.set(id, slot);
  interface Draft { snap: ArmyRegimentSnapshot; members: Colonist[]; pending: number; order: number }
  const drafts = new Map<string, Draft>();
  const draftFor = (id: string, make: () => Omit<Draft, "members" | "pending">): Draft => {
    let d = drafts.get(id);
    if (!d) {
      d = { ...make(), members: [], pending: 0 };
      drafts.set(id, d);
    }
    return d;
  };
  const autoDraft = (key: string, cls: RegimentClass) => {
    const n = settlementNumber.get(key);
    return draftFor(`a:${key}:${cls}`, () => ({
      snap: {
        id: `a:${key}:${cls}`, name: n ? `${REGIMENT_CLASS_LABEL[cls]} ${romanNumeral(n)}` : REGIMENT_CLASS_LABEL[cls],
        unitIds: [], cls, maxCount: 0, hpFrac: 0, ...(n ? { settlement: n } : {}),
      },
      order: 1000 + (n ?? 99) * 20 + REGIMENT_CLASS_ORDER.indexOf(cls),
    }));
  };
  const heroDraft = (id: string, name: string) =>
    draftFor(`h:${id}`, () => ({ snap: { id: `h:${id}`, name, unitIds: [], cls: "hero", maxCount: 0, hpFrac: 0 }, order: 5000 }));

  for (const c of colonists.values()) {
    const cls = REGIMENT_CLASS_OF[c.kind];
    if (!cls || !isCommandable(c)) continue;
    const slot = inTaskForce.get(c.id);
    let d: Draft;
    if (slot !== undefined) {
      d = draftFor(`tf${slot}`, () => ({
        snap: { id: `tf${slot}`, name: `Task Force ${slot}`, unitIds: [], cls, maxCount: 0, hpFrac: 0, taskForce: slot },
        order: slot,
      }));
      if (d.snap.cls !== cls) d.snap.cls = "mixed";
    } else if (c.kind === "hero") {
      d = heroDraft(c.id, c.heroName ?? "Hero");
    } else {
      settlementOf(c);
      d = autoDraft(c.settlementId, cls);
    }
    d.members.push(c);
  }
  // The dead waiting for the dawn respawn count toward the regiment they come back into.
  for (const q of respawnQueue) {
    if (q.hero) {
      heroDraft(q.hero.id, q.hero.name).pending++;
      continue;
    }
    const cls = REGIMENT_CLASS_OF[q.kind];
    if (!cls || (q.kind === "bishop" && tiles[tileIndex(q.tx, q.ty)] !== TileType.ChurchPost)) continue;
    autoDraft(settlementKeyNear(q.tx, q.ty), cls).pending++;
  }

  const result: Draft[] = Array.from(drafts.values());
  for (const d of result) {
    const roleCount = new Map<CombatRole, number>();
    let hp = 0;
    let maxHp = 0;
    for (const c of d.members) {
      d.snap.unitIds.push(c.id);
      hp += Math.max(0, c.hp);
      maxHp += c.maxHp;
      const role = unitRole(c.kind, c.heroClass);
      if (role) roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
    }
    let best = 0;
    for (const [role, n] of roleCount) {
      if (n > best) {
        best = n;
        d.snap.role = role;
      }
    }
    if (!d.snap.role && d.snap.cls === "hero") {
      // A dead hero: its class role, from the respawn entry.
      const q = respawnQueue.find((r) => r.hero && `h:${r.hero.id}` === d.snap.id);
      if (q?.hero) d.snap.role = HERO_CLASS_ROLE[q.hero.heroClass];
    }
    d.snap.hpFrac = maxHp > 0 ? Math.round((hp / maxHp) * 1000) / 1000 : 0;
    const tf = d.snap.taskForce;
    d.snap.maxCount = tf !== undefined ? Math.max(taskForceMax.get(tf) ?? 0, d.members.length) : d.members.length + d.pending;
  }
  result.sort((a, b) => a.order - b.order || a.snap.name.localeCompare(b.snap.name));
  return result.map((d) => d.snap);
}

// Sent when membership / names / max change, else every ARMY_REGIMENT_REFRESH_TICKS (HP drifts in between;
// the client reads live HP from the colonists anyway).
function armyRegimentsForSnapshot(): ArmyRegimentSnapshot[] | undefined {
  const regiments = armyRegimentsNow();
  const signature = JSON.stringify(regiments.map((r) => [r.id, r.name, r.cls, r.maxCount, r.unitIds]));
  armyRegimentTicks++;
  if (signature === armyRegimentSignature && armyRegimentTicks < ARMY_REGIMENT_REFRESH_TICKS) return undefined;
  armyRegimentSignature = signature;
  armyRegimentTicks = 0;
  return regiments;
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
interface OrderGroup {
  id: string;
  unitIds: Set<string>;
  current: ArmyOrder | null;
  queue: ArmyOrder[];
  // Last formation (radians / tiles; width undefined = block): a click-move keeps it.
  facing?: number;
  width?: number;
  // The slots' centroid (arrival) and the tick the current order started.
  destX: number;
  destY: number;
  startedTick: number;
  engaged: boolean;
  clearSince: number;
  followAt: { x: number; y: number } | null;
  // Phase 4: the front centre the group last formed at (a shape change re-forms there).
  lastAt?: { x: number; y: number };
}
const ORDER_UPDATE_TICKS = 5;
const REGIMENT_ORDER_MAX_PER_S = 20;
const ORDER_DISPATCH_STEP_MS = 80;
const ORDER_DISPATCH_MAX_SPREAD_MS = 600;
// Arrival is not checked until every staggered start has landed.
const ORDER_ARRIVE_GRACE_TICKS = TICK_RATE;
const ORDER_WIDTH_MAX_TILES = 64;
const ATTACK_MOVE_RESUME_TICKS = 3 * TICK_RATE;
const RETREAT_CORNERED_TILES = 1.2;
const RETREAT_SPEED_FACTOR = 1.1;
const RETREAT_TC_OFFSET_TILES = 3;
const HOLD_LEASH_TILES = 0.5;
const FOLLOW_REFORM_TILES = 2;
const FOLLOW_BEHIND_TILES = 2.5;
const ARMY_ORDER_KINDS: ArmyOrderKind[] = ["move", "attackMove", "retreat", "hold", "follow", "attack", "charge", "bombard", "attackHearth"];
// Phase 4: cycle charge (see the order list above) and skirmish (updateGuardColonist).
const CHARGE_WITHDRAW_TILES = 11;
// A withdrawn rider turns to charge again only from this far out (so its run still reaches
// CAVALRY_CHARGE_TILES while the enemy closes in), or after CHARGE_WITHDRAW_MAX_TICKS out.
const CHARGE_RECHARGE_GAP_TILES = 9;
const CHARGE_WITHDRAW_MAX_TICKS = 12 * TICK_RATE;
const SKIRMISH_KITE_TILES = 4;
// A skirmisher backs off at most this far from its slot.
const SKIRMISH_DRIFT_TILES = 8;
// Unit id -> its charge cycle on a charge order: "in" (riding at the target; readyTick = the charge
// cooldown it had when it set off, so a changed value = a charge landed) or "out" (withdrawing, since).
const chargeCycle = new Map<string, { phase: "in" | "out"; readyTick: number; since: number }>();
const orderGroups = new Map<string, OrderGroup>();
const orderGroupOfUnit = new Map<string, OrderGroup>();
// Staggered start: unit id -> the slot it heads for once cycleTick reaches `at`.
const pendingRallies = new Map<string, { at: number; x: number; y: number; group: string; squad: string | null }>();
let nextOrderGroupId = 1;
let orderGroupSignature = "";
let orderGroupTicks = 0;

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
  orderGroupSignature = "";
}

// The kind of order the unit's group is carrying out (hold / retreat change updateGuardColonist).
function unitOrderKind(c: Colonist): ArmyOrderKind | undefined {
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
  const x = clamp(c.x + dx, 1, WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(c.y + dy, 1, WORLD_TILES_Y * TILE_SIZE - 1);
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
    order.x = clamp(o.x, 1, WORLD_TILES_X * TILE_SIZE - 1);
    order.y = clamp(o.y, 1, WORLD_TILES_Y * TILE_SIZE - 1);
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
  if (simHeldForLoad) return;
  const now = Date.now();
  if (now - player.orderWindowAt >= 1000) {
    player.orderWindowAt = now;
    player.orderWindowCount = 0;
  }
  if (++player.orderWindowCount > REGIMENT_ORDER_MAX_PER_S) return;
  const order = sanitizeArmyOrder(msg.order);
  if (!order) return;
  const units = orderedUnits(msg.regimentIds, msg.unitIds);
  if (units.length === 0) return;
  const ids = new Set(units.map((c) => c.id));
  if ((order.kind === "attack" || order.kind === "charge") && !mobs.has(order.targetId!)) return;
  if (order.kind === "attackHearth" && !standingHearthAt(order.tileX!, order.tileY!)) return;
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
    id: `g${nextOrderGroupId++}`, unitIds: new Set(units.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: cycleTick, engaged: false, clearSince: -1, followAt: null,
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
    const sx = clamp(s.x, 1, WORLD_TILES_X * TILE_SIZE - 1);
    const sy = clamp(s.y, 1, WORLD_TILES_Y * TILE_SIZE - 1);
    const delay = Math.round((i * stepMs * TICK_RATE) / 1000);
    if (delay === 0) {
      pendingRallies.delete(c.id);
      rallyUnit(c, sx, sy, squad);
    } else {
      pendingRallies.set(c.id, { at: cycleTick + delay, x: sx, y: sy, group: g.id, squad });
    }
  });
}

function startArmyOrder(g: OrderGroup, order: ArmyOrder) {
  g.current = order;
  g.engaged = false;
  g.clearSince = -1;
  g.followAt = null;
  g.startedTick = cycleTick;
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
        order.x = clamp(tcx + dx * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, WORLD_TILES_X * TILE_SIZE - 1);
        order.y = clamp(tcy + dy * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, WORLD_TILES_Y * TILE_SIZE - 1);
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
      const h = standingHearthAt(order.tileX!, order.tileY!);
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
  chargeCycle.set(c.id, { phase: "in", readyTick: chargeRuns.get(c.id)?.readyTick ?? 0, since: cycleTick });
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
      const ready = !run || cycleTick >= run.readyTick;
      if (ready && (d >= CHARGE_RECHARGE_GAP_TILES * TILE_SIZE || cycleTick - cyc.since >= CHARGE_WITHDRAW_MAX_TICKS)) {
        // The attack cooldown only runs down while striking; out this long it is long over (else the rider
        // waits it out at the mob, sliding to its ring slot, which breaks the charge run).
        c.attackCooldownTicks = 0;
        chargeAt(c, mob);
      } else if (Math.hypot(c.rallyX - mob.x, c.rallyY - mob.y) < (CHARGE_WITHDRAW_TILES - 0.5) * TILE_SIZE) {
        withdrawFrom(c, mob, d);
      }
      continue;
    }
    if (c.cycleCharge && run && run.readyTick !== cyc.readyTick && run.readyTick > cycleTick) {
      chargeCycle.set(c.id, { phase: "out", readyTick: run.readyTick, since: cycleTick });
      withdrawFrom(c, mob, d);
    } else if (c.targetMobId !== mob.id) {
      chargeAt(c, mob);
    }
  }
}

function withdrawFrom(c: Colonist, mob: Mob, d: number) {
  const ux = d >= 1 ? (c.x - mob.x) / d : 1;
  const uy = d >= 1 ? (c.y - mob.y) / d : 0;
  const x = clamp(mob.x + ux * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, WORLD_TILES_X * TILE_SIZE - TILE_SIZE);
  const y = clamp(mob.y + uy * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, WORLD_TILES_Y * TILE_SIZE - TILE_SIZE);
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
  rallyUnit(c, clamp(x + ux * want, 1, WORLD_TILES_X * TILE_SIZE - 1), clamp(y + uy * want, 1, WORLD_TILES_Y * TILE_SIZE - 1), null);
}

// The bombard point of a catapult whose group is on a bombard order (null otherwise).
function bombardPoint(c: Colonist): { x: number; y: number } | null {
  const o = orderGroupOfUnit.get(c.id)?.current;
  return o && o.kind === "bombard" && o.x !== undefined && o.y !== undefined ? { x: o.x, y: o.y } : null;
}

// One bombard tick: inside the throw band it shells the point each reload (true = it acted).
function bombardStep(c: Colonist, at: { x: number; y: number }, stats: { damage: number; cooldown: number }): boolean {
  const d = Math.hypot(at.x - c.x, at.y - c.y);
  if (d < CATAPULT_MIN_RANGE || d > CATAPULT_RANGE) return false;
  c.path = [];
  c.state = "attacking";
  if (c.attackCooldownTicks > 0) {
    c.attackCooldownTicks--;
    return true;
  }
  const damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id);
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
  if (cycleTick - g.startedTick < ORDER_ARRIVE_GRACE_TICKS) return false;
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
    g.clearSince = cycleTick;
  } else if (cycleTick - g.clearSince >= ATTACK_MOVE_RESUME_TICKS && g.current) {
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
  const x = clamp(t.x - dx * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(t.y - dy * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, WORLD_TILES_Y * TILE_SIZE - 1);
  formGroupAt(g, members, x, y, Math.atan2(dy, dx), g.width);
}

// Per tick: the staggered starts that are due. Every ORDER_UPDATE_TICKS: arrivals, attack-move contact,
// follow re-forms, attack targets, queue pops.
function updateOrderGroups() {
  if (pendingRallies.size > 0) {
    for (const [id, p] of pendingRallies) {
      if (cycleTick < p.at) continue;
      pendingRallies.delete(id);
      const c = colonists.get(id);
      if (c && orderGroupOfUnit.get(id)?.id === p.group) rallyUnit(c, p.x, p.y, p.squad);
    }
  }
  if (cycleTick % ORDER_UPDATE_TICKS !== 0) return;
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
      if (!standingHearthAt(o.tileX!, o.tileY!)) finishArmyOrder(g, members);
    }
  }
}

// Strategy mode phase 4: per-unit settings for the named regiments' members and / or units. A shape
// change re-forms each affected order group where it stands (its destination while marching).
function handleRegimentSettings(player: Player, msg: { regimentIds?: unknown; unitIds?: unknown; stance?: unknown; holdFire?: unknown; skirmish?: unknown; cycleCharge?: unknown; shape?: unknown }) {
  if (simHeldForLoad) return;
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
  orderGroupTicks++;
  if (signature === orderGroupSignature && orderGroupTicks < ARMY_REGIMENT_REFRESH_TICKS) return undefined;
  orderGroupSignature = signature;
  orderGroupTicks = 0;
  return list;
}

const EXCHANGE_RATES: Record<string, Record<string, { give: number; get: number }>> = {
  wood: { iron: { give: 3, get: 1 }, rock: { give: 3, get: 1 } },
  iron: { wood: { give: 3, get: 1 }, rock: { give: 2, get: 1 } },
  rock: { wood: { give: 3, get: 1 }, iron: { give: 2, get: 1 } },
};

function handleExchangeResource(from: "wood" | "iron" | "rock", to: "wood" | "iron" | "rock") {
  if (!marketBuilt || from === to) return;
  const rate = EXCHANGE_RATES[from]?.[to];
  if (!rate) return;
  if (stock[from] < rate.give) return;
  stock[from] -= rate.give;
  stock[to] += rate.get;
}

const GOLD_SHOP_PRICES: Record<string, { cost: number; amount: number }> = {
  tools: { cost: 10, amount: 1 },
  clothes: { cost: 8, amount: 1 },
  luxuryItems: { cost: 20, amount: 1 },
  wood: { cost: 5, amount: 5 },
  iron: { cost: 8, amount: 5 },
  rock: { cost: 8, amount: 5 },
};

function handleBuyWithGold(item: "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock") {
  if (!goldShopBuilt) return;
  const price = GOLD_SHOP_PRICES[item];
  if (!price) return;
  if (stock.gold < price.cost) return;
  stock.gold -= price.cost;
  (stock as Record<string, number>)[item] += price.amount;
}

function handlePlayerAttack(attacker: Player) {
  if (attacker.dead || attacker.attackCooldownTicks > 0) return;
  attacker.attackCooldownTicks = playerAttackCooldownTicks(attacker);
  const damage = playerDamage(attacker);

  let bestType: "player" | "mob" | null = null;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const p of players.values()) {
    if (p.id === attacker.id || p.dead) continue;
    const d = Math.hypot(p.x - attacker.x, p.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestType = "player";
      bestId = p.id;
    }
  }
  for (const m of mobs.values()) {
    const d = Math.hypot(m.x - attacker.x, m.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestType = "mob";
      bestId = m.id;
    }
  }

  let bestAnimal: Wildlife | null = null;
  for (const a of wildlife.values()) {
    const d = Math.hypot(a.x - attacker.x, a.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestAnimal = a;
    }
  }
  if (bestAnimal) {
    // A player's kill is dressed on the spot: the meat goes straight to the stockpile.
    pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: bestAnimal.x, toY: bestAnimal.y, melee: true });
    const meat = WILDLIFE_CONFIG[bestAnimal.kind].meat;
    if (damageWildlife(bestAnimal, damage, attacker.x, attacker.y, null)) stock.meat += meat;
    return;
  }

  if (!bestType || !bestId) {
    // Camp hearths: with nothing else in reach, the player can strike a hearth next to them.
    for (const h of hearths.values()) {
      if (h.destroyed) continue;
      const p = tileToPixelCenter(h);
      if (Math.hypot(p.x - attacker.x, p.y - attacker.y) > PLAYER_ATTACK_RANGE + TILE_SIZE / 2) continue;
      pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: p.x, toY: p.y, melee: true });
      damageHearth(h, damage, "p:" + attacker.id);
      return;
    }
    return;
  }
  if (bestType === "player") {
    const target = players.get(bestId);
    if (target) {
      pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      damagePlayer(target, damage);
    }
  } else {
    const target = mobs.get(bestId);
    if (target) {
      pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      heroEvent({ type: "hit", key: attacker.profileKey, amount: damage, detail: target.id });
      damageMob(target, damage, "p:" + attacker.id);
    }
  }
}

const RALLY_ARRIVE_PX = 2;
const GARRISON_LOITER_PX = TILE_SIZE * 1.5;

// Walks an idle (no target) commandable unit back to its rally point; shared by guards and bishops.
// A walkable rally tile is a commanded point (a formation slot): path to that tile, then steer
// straight onto the exact rallyX/rallyY and stop there, so slots keep their exact spacing instead
// of every unit halting wherever it first comes within 1.5 tiles. A solid rally tile is the unit's
// own building (the spawn default): keep the garrison behaviour of loitering within 1.5 tiles of it.
function returnToRally(c: Colonist, dt: number, speed: number) {
  const rallyTile = { x: c.rallyTileX, y: c.rallyTileY };
  const here = tileOfPixel(c.x, c.y);

  if (!isWalkableTile(rallyTile.x, rallyTile.y)) {
    const rallyCenter = tileToPixelCenter(rallyTile);
    if (Math.hypot(c.x - rallyCenter.x, c.y - rallyCenter.y) <= GARRISON_LOITER_PX) {
      c.path = [];
      c.state = "idle";
      return;
    }
    if (c.path.length === 0) {
      const approach = findAdjacentWalkable(rallyTile.x, rallyTile.y);
      c.path = (approach && findPath(here, approach)) || [];
    }
    if (c.path.length === 0) {
      c.state = "idle";
      return;
    }
    advanceAlongPath(c, dt, speed);
    c.state = "returning";
    return;
  }

  const dist = Math.hypot(c.rallyX - c.x, c.rallyY - c.y);
  if (dist <= RALLY_ARRIVE_PX) {
    c.x = c.rallyX;
    c.y = c.rallyY;
    c.path = [];
    c.state = "idle";
    return;
  }
  // On (or edge-adjacent to) the rally tile: steer straight in (the final leg: a straight line from an
  // edge-adjacent tile to any point in the rally tile stays on those two walkable tiles). A path left
  // over from the march may still lead through this tile's centre, which a squadmate's body can hold
  // the unit off forever (it froze a few px short of its slot).
  const nextToRally = Math.abs(here.x - rallyTile.x) + Math.abs(here.y - rallyTile.y) <= 1;
  if (nextToRally) c.path = [];
  if (c.path.length === 0 && !nextToRally) {
    c.path = findPath(here, rallyTile) ?? [];
    if (c.path.length === 0) {
      c.state = "idle";
      return;
    }
  }
  if (c.path.length > 0) {
    advanceAlongPath(c, dt, speed);
  } else {
    const step = speed * biomeSpeedMultiplier(c.x, c.y) * roadSpeedMultiplier(c.x, c.y) * dt;
    if (dist <= step) {
      c.x = c.rallyX;
      c.y = c.rallyY;
    } else {
      c.x += ((c.rallyX - c.x) / dist) * step;
      c.y += ((c.rallyY - c.y) / dist) * step;
    }
  }
  c.state = "returning";
}

function updateGuardColonist(c: Colonist, dt: number) {
  // Hero phase 4: heroes auto-cast their slotted spells (when Auto is on).
  if (c.kind === "hero") heroAutoCast(c);
  const stats = unitStats(c);
  if (c.kind === "cavalry") trackCharge(c);

  let target = c.targetMobId ? getMobById(c.targetMobId) : undefined;
  if (c.targetMobId && !target) {
    c.targetMobId = null;
    // The chase path leads to where the (now dead/gone) target was; without this the unit would
    // finish walking it before returnToRally plans the route back to its slot.
    c.path = [];
  }
  // Strategy mode phase 3: a retreating unit only fights what corners it (RETREAT_CORNERED_TILES); so
  // does a rider withdrawing between charges (phase 4).
  const retreating = unitOrderKind(c) === "retreat" || chargeCycle.get(c.id)?.phase === "out";
  if (retreating && target && Math.hypot(target.x - c.x, target.y - c.y) > RETREAT_CORNERED_TILES * TILE_SIZE + stats.range) {
    c.targetMobId = null;
    c.path = [];
    releaseSlot(c.id);
    target = undefined;
  }
  // Phase 4: a catapult on a bombard order shells its point (a commanded target comes first).
  if (c.kind === "catapult" && !(target && commandedTargets.get(c.id) === target.id)) {
    const at = bombardPoint(c);
    if (at && bombardStep(c, at, stats)) return;
  }

  if (!target) {
    if (c.repathCooldown > 0) {
      c.repathCooldown--;
    } else {
      const found = retreating ? corneringMob(c) : pickGuardTarget(c, stats);
      if (found) {
        c.targetMobId = found.id;
        target = found;
      } else {
        c.repathCooldown = retreating ? ORDER_UPDATE_TICKS : MOB_REPATH_TICKS;
      }
    }
  }

  if (!target) {
    // Phase 4, skirmish: a ranged unit backs off from melee within SKIRMISH_KITE_TILES (hold fire too).
    if (c.skirmish && !stats.melee && stats.speed > 0) {
      const threat = nearestMeleeMob(c.x, c.y, SKIRMISH_KITE_TILES * TILE_SIZE);
      if (threat) {
        kiteStep(c, threat, guardLeashTiles(c) * TILE_SIZE, stats.speed, dt);
        c.state = "engaging";
        return;
      }
    }
    // Camp hearths: no enemy in reach (guardians are fought first, picked above), so the hearth.
    if (!retreating && hearthStep(c, stats, dt)) return;
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    returnToRally(c, dt, (squadMarchSpeed.get(c.id) ?? stats.speed) * (retreating ? RETREAT_SPEED_FACTOR : 1));
    return;
  }

  const commanded = commandedTargets.get(c.id) === target.id;
  const leashPx = guardLeashTiles(c) * TILE_SIZE;
  // The target has left the zone this unit holds (its slot's leash + attack range): let it go.
  if (!commanded && Math.hypot(target.x - c.rallyX, target.y - c.rallyY) > leashPx + stats.range + TILE_SIZE) {
    dropGuardTarget(c);
    if (stats.speed === 0) c.state = "idle";
    else returnToRally(c, dt, stats.speed);
    return;
  }

  let dist = Math.hypot(target.x - c.x, target.y - c.y);
  // Stickiness with a slot leash: once a second, while not trading blows, switch to an enemy clearly
  // nearer this unit's own slot (the line fights what is in front of each man, not one shared target).
  // A ranged unit switches to any enemy that is within bow range (pickGuardTarget ranks those first).
  if (!commanded && dist > stats.range && cycleTick % TICK_RATE === 0) {
    const better = pickGuardTarget(c, stats);
    const cur = Math.hypot(target.x - c.rallyX, target.y - c.rallyY);
    const switchTo = !better || better === target ? false
      : stats.melee ? Math.hypot(better.x - c.rallyX, better.y - c.rallyY) < cur * SLOT_RETARGET_FACTOR
      : Math.hypot(better.x - c.x, better.y - c.y) <= stats.range;
    if (better && switchTo) {
      releaseSlot(c.id);
      c.path = [];
      c.targetMobId = better.id;
      target = better;
      dist = Math.hypot(target.x - c.x, target.y - c.y);
    }
  }
  // Regiments: a ranged unit with a friendly front rank near it holds its rear slot - it fires at what
  // comes into bow range, never walks out toward the enemy line, and kites a step back (toward its slot
  // where that is away from the threat) from an enemy melee unit within RANGED_KITE_TILES. No front
  // rank (archers on their own) or a commanded target: the ordinary behaviour below. Phase 4: a
  // skirmisher does this with or without a front rank, from SKIRMISH_KITE_TILES.
  if (!stats.melee && stats.speed > 0 && !commanded && (c.skirmish || hasFriendlyFrontline(c))) {
    const threat = nearestMeleeMob(c.x, c.y, (c.skirmish ? SKIRMISH_KITE_TILES : RANGED_KITE_TILES) * TILE_SIZE);
    if (threat) {
      kiteStep(c, threat, leashPx, stats.speed, dt);
      dist = Math.hypot(target.x - c.x, target.y - c.y);
    }
    if (dist <= stats.range) {
      if (!threat) c.path = [];
      c.state = "attacking";
      guardStrike(c, target, stats);
    } else if (threat) {
      c.state = "engaging";
    } else {
      returnToRally(c, dt, stats.speed);
    }
    return;
  }
  // Melee fights from a ring slot around the target (see unitSlotPoint); ranged keeps its stand-off.
  const targetR = MOB_BODY_RADIUS[target.kind] ?? 8;
  const meleeMover = stats.melee && stats.speed > 0;
  const slot = meleeMover
    ? unitSlotPoint(c.id, c.x, c.y, COLONIST_BODY_RADIUS, stats.range, `m:${target.id}`, target.x, target.y, targetR, meleeAttackerCap(targetR))
    : null;
  if (meleeMover && !slot && dist > stats.range) {
    // Queue: the target already has its share of attackers. Uncommanded, give it up and hold this
    // unit's own slot (rescanned after the repath cooldown); commanded, close to a stand-off behind
    // the fighters and wait there for a place to free.
    if (!commanded) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    c.state = "engaging";
    if (dist > stats.range + QUEUE_STANDOFF_PX) approachGoal(c, target, target, stats.speed, dt);
    else c.path = [];
    return;
  }
  if (dist <= stats.range) {
    c.state = "attacking";
    c.path = [];
    // Slide round to the claimed slot while trading blows.
    if (slot && Math.hypot(slot.x - c.x, slot.y - c.y) > 2) stepRaidMobToward(c, slot.x, slot.y, stats.speed * 0.5, dt);
    guardStrike(c, target, stats);
  } else {
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    // Chase leash: only checked while closing on an out-of-range target (an exchange already in
    // attack range above is never interrupted). Past the leash, drop the target and head home this
    // tick; the repath cooldown holds off the next scan for a beat so the unit actually turns back
    // instead of re-acquiring the same target next tick and jittering on the leash edge.
    if (!commanded && Math.hypot(c.x - c.rallyX, c.y - c.rallyY) > leashPx) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    // A Morvain-marked mob slips away once it's past the reduced range guards can track it at.
    if (target.mark === HungerMark.Morvain && dist > STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE * MORVAIN_DETECTION_FACTOR) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    c.state = "engaging";
    // Within half a tile of strike range, close straight in (then slide round to the slot while fighting,
    // above): a slot on the far side of the target can't be walked to through the attackers already there.
    approachGoal(c, slot && dist > stats.range + SLOT_CLOSE_IN_PX ? slot : target, target, stats.speed, dt);
  }
}

// One blow / arrow at `target` when the cooldown allows.
function guardStrike(c: Colonist, target: Mob, stats: { damage: number; cooldown: number; melee: boolean }) {
  if (c.attackCooldownTicks > 0) {
    c.attackCooldownTicks--;
    return;
  }
  // Armour & weapons: the weapon tier multiplies every blow (charge x2 etc. stack on top).
  let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id);
  if ((c.weaponTier ?? 0) > 0) equipEvent({ type: "hit", id: c.id, tier: c.weaponTier, amount: damage, detail: String(damage / weaponDamageMult(c)) });
  // Cavalry & siege: the catapult lobs a splashing boulder (never inside its minimum range), the ram
  // barely scratches units, a rider's charge doubles its first blow.
  if (c.kind === "catapult") {
    if (Math.hypot(target.x - c.x, target.y - c.y) < CATAPULT_MIN_RANGE) return;
    catapultImpact(c.x, c.y, target.x, target.y, damage, "colony", "c:" + c.id);
    c.attackCooldownTicks = stats.cooldown;
    if (target.hp <= 0) c.targetMobId = null;
    return;
  }
  if (c.kind === "batteringRam") {
    damage *= RAM_UNIT_MULT;
    siegeEvent("ramHit", c.id, damage, "unit");
  }
  if (c.kind === "cavalry") {
    const mult = takeChargeBonus(c);
    if (mult > 1) siegeEvent("charge", c.id, damage * mult);
    else siegeEvent("hit", c.id, damage);
    damage *= mult;
  }
  if (c.kind === "hero") heroTestEvent({ type: "hit", id: c.id, amount: damage, detail: target.id });
  damageMob(target, damage, "c:" + c.id);
  c.attackCooldownTicks = stats.cooldown;
  pendingEffects.push({ fromX: c.x, fromY: c.y, toX: target.x, toY: target.y, melee: stats.melee });
  if (target.hp <= 0) c.targetMobId = null;
}

// Regiments: the combat role of a soldier (COLONIST_ROLE) or a mob (MOB_ROLE, corrected by the mob's
// own melee flag: a deserter takes its stats from the colonist it was).
function colonistRole(c: Colonist): CombatRole | undefined {
  return unitRole(c.kind, c.heroClass);
}
// isRearRole for a unit (the catapult is a rear siege role, the ram a front one).
function isRearColonist(c: Colonist): boolean {
  return isRearRole(colonistRole(c) ?? "frontline", c.kind);
}
function isRearMob(m: Mob): boolean {
  return isRearRole(mobRole(m), m.kind);
}
function mobRole(m: Mob): CombatRole {
  const role = MOB_ROLE[m.kind] ?? "frontline";
  if (role === "siege") return role;
  if (!m.melee) return isRearRole(role) ? role : "ranged";
  return isRearRole(role) ? "frontline" : role;
}

// True while a friendly front-rank soldier (any non-rear role) stands within ARCHER_FRONT_RANK_SCAN_TILES
// of the ranged soldier `c`: then `c` holds the rear (see updateGuardColonist).
function hasFriendlyFrontline(c: Colonist): boolean {
  const scanPx = ARCHER_FRONT_RANK_SCAN_TILES * TILE_SIZE;
  for (const o of colonists.values()) {
    if (o === c) continue;
    const role = colonistRole(o);
    if (!role || isRearColonist(o)) continue;
    if (Math.abs(o.x - c.x) <= scanPx && Math.abs(o.y - c.y) <= scanPx) return true;
  }
  return false;
}

// The nearest awake melee mob within radiusPx of (x, y), or null.
function nearestMeleeMob(x: number, y: number, radiusPx: number): Mob | null {
  let best: Mob | null = null;
  let bestD = radiusPx;
  for (const m of mobs.values()) {
    if (!m.melee || m.passive || isDormantGuardian(m)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

// The nearest guard / militia melee soldier within radiusPx of (x, y), or null (a ranged mob's kite threat).
function nearestMeleeSoldier(x: number, y: number, radiusPx: number): Colonist | null {
  let best: Colonist | null = null;
  let bestD = radiusPx;
  for (const c of colonists.values()) {
    const role = colonistRole(c);
    if (!role || isRearColonist(c)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// One kite step for a ranged soldier: back onto its rear slot when that lies further from the threat,
// otherwise a tile straight away from it (never past its leash from the slot).
function kiteStep(c: Colonist, threat: { x: number; y: number }, leashPx: number, speed: number, dt: number) {
  c.path = [];
  const dThreat = Math.hypot(threat.x - c.x, threat.y - c.y) || 1;
  const toSlot = Math.hypot(c.rallyX - c.x, c.rallyY - c.y);
  if (toSlot > RALLY_ARRIVE_PX && Math.hypot(c.rallyX - threat.x, c.rallyY - threat.y) > dThreat) {
    stepRaidMobToward(c, c.rallyX, c.rallyY, speed, dt);
    return;
  }
  const ax = c.x + ((c.x - threat.x) / dThreat) * TILE_SIZE;
  const ay = c.y + ((c.y - threat.y) / dThreat) * TILE_SIZE;
  if (Math.hypot(ax - c.rallyX, ay - c.rallyY) <= leashPx) stepRaidMobToward(c, ax, ay, speed, dt);
}

// True when the mob is fighting a front-rank soldier (a ranged unit's preferred target).
function engagedWithFrontline(m: Mob): boolean {
  if (m.targetType !== "colonist" || !m.targetId) return false;
  const c = colonists.get(m.targetId);
  const role = c ? colonistRole(c) : undefined;
  return !!c && !!role && !isRearColonist(c);
}

// Squad march: per-tick speed for every squad member walking back to its formation slot (no target),
// see SQUAD_* above. Members without an entry move at their own speed.
const squadMarchSpeed = new Map<string, number>();
function updateSquadMarch() {
  squadMarchSpeed.clear();
  const squads = new Map<string, Colonist[]>();
  for (const c of colonists.values()) {
    if (!c.squadId || c.targetMobId || !isGuardOrMilitiaKind(c.kind)) continue;
    const list = squads.get(c.squadId);
    if (list) list.push(c);
    else squads.set(c.squadId, [c]);
  }
  for (const members of squads.values()) {
    if (members.length < 2) continue;
    let pcx = 0, pcy = 0, rcx = 0, rcy = 0;
    let pace = Infinity;
    for (const m of members) {
      pcx += m.x; pcy += m.y; rcx += m.rallyX; rcy += m.rallyY;
      pace = Math.min(pace, unitStats(m).speed);
    }
    const n = members.length;
    pcx /= n; pcy /= n; rcx /= n; rcy /= n;
    const togo = Math.hypot(rcx - pcx, rcy - pcy);
    if (togo <= SQUAD_SETTLE_TILES * TILE_SIZE || pace <= 0) continue;
    const dx = (rcx - pcx) / togo;
    const dy = (rcy - pcy) / togo;
    // Lead: how far along the march direction a member is ahead of its own place in the formation.
    const leads = members.map((m) => (m.x - pcx - (m.rallyX - rcx)) * dx + (m.y - pcy - (m.rallyY - rcy)) * dy);
    const broken = leads.some((l) => Math.abs(l) > SQUAD_BROKEN_TILES * TILE_SIZE);
    const tol = SQUAD_LEAD_TOLERANCE_TILES * TILE_SIZE;
    members.forEach((m, i) => {
      const own = unitStats(m).speed;
      const lead = leads[i];
      squadMarchSpeed.set(m.id, lead < -tol ? own : lead > tol && !broken ? pace * SQUAD_AHEAD_SPEED_FACTOR : pace);
    });
  }
}

// The enemy a soldier should take on: within its alert range (from where it stands) and within its
// slot's reach (leash + attack range of the rally point - anything further it would only walk out to,
// give up on and re-acquire forever, e.g. a dormant POI guardian), NEAREST TO ITS SLOT. A melee soldier
// skips enemies that already have their share of attackers (meleeAttackerCap), so a line spreads over
// the enemies in front of it; with none left it holds its slot (the queue).
function pickGuardTarget(c: Colonist, stats: { range: number; melee: boolean; speed: number }): Mob | null {
  // Phase 4, hold fire: a ranged unit / catapult only shoots a commanded target; a catapult on a bombard
  // order only its point.
  if (!stats.melee && (c.holdFire || (c.kind === "catapult" && bombardPoint(c)))) return null;
  // A catapult sees as far as it throws; a ram only takes on what is right next to it.
  const alertPx = c.kind === "batteringRam" ? stats.range + COLONIST_BODY_RADIUS * 2
    : Math.max(STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE, c.kind === "catapult" ? stats.range : 0);
  const reachPx = guardLeashTiles(c) * TILE_SIZE + stats.range;
  const queues = stats.melee && stats.speed > 0;
  // Regiments: a ranged soldier behind a front rank ranks enemies already in bow range first (those
  // fighting a front-rank soldier before the rest, nearest to the archer first), then the slot rule.
  const rearRank = !stats.melee && hasFriendlyFrontline(c);
  let best: Mob | null = null;
  let bestDist = Infinity;
  for (const m of mobs.values()) {
    const du = Math.hypot(m.x - c.x, m.y - c.y);
    if (du > (m.mark === HungerMark.Morvain ? alertPx * MORVAIN_DETECTION_FACTOR : alertPx)) continue;
    // Monster tactics, pursuit safety: a routed / leaving mob is only fought within attack range, never
    // chased, so a broken enemy doesn't pull the line apart.
    if ((m.tactic === "rout" || m.tactic === "leave") && du > stats.range) continue;
    const ds = Math.hypot(m.x - c.rallyX, m.y - c.rallyY);
    if (ds > reachPx) continue;
    const score = rearRank && du <= stats.range ? du - (engagedWithFrontline(m) ? 2e6 : 1e6) : ds;
    if (score >= bestDist) continue;
    if (queues && !targetHasRoom(c.id, `m:${m.id}`, meleeAttackerCap(MOB_BODY_RADIUS[m.kind] ?? 8))) continue;
    best = m;
    bestDist = score;
  }
  return best;
}

// The slot leash (LINE_LEASH_TILES by stance; a regiment on a Hold order: HOLD_LEASH_TILES; a ranged
// skirmisher: at least SKIRMISH_DRIFT_TILES, the room it kites in).
function guardLeashTiles(c: Colonist): number {
  if (unitOrderKind(c) === "hold") return HOLD_LEASH_TILES;
  if (c.skirmish && !unitStats(c).melee) return Math.max(LINE_LEASH_TILES[c.stance], SKIRMISH_DRIFT_TILES);
  return LINE_LEASH_TILES[c.stance];
}

// A retreating unit's only target: an awake enemy within RETREAT_CORNERED_TILES of it.
function corneringMob(c: Colonist): Mob | null {
  let best: Mob | null = null;
  let bestD = RETREAT_CORNERED_TILES * TILE_SIZE;
  for (const m of mobs.values()) {
    if (m.passive || isDormantGuardian(m)) continue;
    const d = Math.hypot(m.x - c.x, m.y - c.y);
    if (d <= bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

function dropGuardTarget(c: Colonist) {
  c.targetMobId = null;
  c.path = [];
  c.repathCooldown = MOB_REPATH_TICKS;
  releaseSlot(c.id);
}

function findNearestInjured(
  fromX: number,
  fromY: number,
  maxRangeTiles: number,
  excludeId: string
): { kind: "player" | "colonist"; id: string; x: number; y: number } | null {
  let best: { kind: "player" | "colonist"; id: string; x: number; y: number } | null = null;
  let bestDist = Infinity;
  const maxRangePx = maxRangeTiles * TILE_SIZE;
  for (const p of players.values()) {
    if (p.hp >= playerMaxHp(p) || p.dead) continue;
    const d = Math.hypot(p.x - fromX, p.y - fromY);
    if (d <= maxRangePx && d < bestDist) {
      bestDist = d;
      best = { kind: "player", id: p.id, x: p.x, y: p.y };
    }
  }
  for (const c of colonists.values()) {
    if (c.id === excludeId) continue;
    if (c.hp >= c.maxHp) continue;
    const d = Math.hypot(c.x - fromX, c.y - fromY);
    if (d <= maxRangePx && d < bestDist) {
      bestDist = d;
      best = { kind: "colonist", id: c.id, x: c.x, y: c.y };
    }
  }
  return best;
}

function healAmountFor(churchX: number, churchY: number): number {
  const level = getBuildingLevel(churchX, churchY);
  return Math.round(BISHOP_HEAL_AMOUNT * (1 + (level - 1) * CHURCH_HEAL_BONUS_PER_STEP));
}

function updateBishopColonist(c: Colonist, dt: number) {
  let targetPos: { x: number; y: number } | null = null;

  if (c.healTargetType === "player" && c.healTargetId) {
    const p = players.get(c.healTargetId);
    if (p && p.hp < playerMaxHp(p)) targetPos = { x: p.x, y: p.y };
  } else if (c.healTargetType === "colonist" && c.healTargetId) {
    const other = colonists.get(c.healTargetId);
    if (other && other.hp < other.maxHp) targetPos = { x: other.x, y: other.y };
  }

  if (!targetPos) {
    // Same as guards: a route toward a healed/gone patient is stale once they no longer need it.
    if (c.healTargetId) c.path = [];
    c.healTargetType = null;
    c.healTargetId = null;
    const found = findNearestInjured(c.x, c.y, GUARD_ALERT_RANGE_TILES, c.id);
    if (found) {
      c.healTargetType = found.kind;
      c.healTargetId = found.id;
      targetPos = { x: found.x, y: found.y };
    }
  }

  if (!targetPos) {
    // Rally starts as the church (same loiter-by-the-post behaviour as before) and becomes the
    // bishop's formation slot after a move order; this used to ignore the rally and walk home.
    returnToRally(c, dt, BISHOP_SPEED);
    return;
  }

  const dist = Math.hypot(targetPos.x - c.x, targetPos.y - c.y);
  if (dist <= BISHOP_HEAL_RANGE) {
    c.state = "healing";
    c.path = [];
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
    } else {
      c.attackCooldownTicks = BISHOP_HEAL_COOLDOWN_TICKS;
      const amount = healAmountFor(c.postX, c.postY);
      if (c.healTargetType === "player" && c.healTargetId) {
        const p = players.get(c.healTargetId);
        if (p) p.hp = Math.min(playerMaxHp(p), p.hp + amount);
      } else if (c.healTargetType === "colonist" && c.healTargetId) {
        const other = colonists.get(c.healTargetId);
        if (other) other.hp = Math.min(other.maxHp, other.hp + amount);
      }
    }
  } else {
    c.state = "approaching";
    if (c.path.length === 0 && c.repathCooldown <= 0) {
      const start = tileOfPixel(c.x, c.y);
      const goalTile = tileOfPixel(targetPos.x, targetPos.y);
      const path = findPath(start, goalTile);
      if (path === null) {
        c.healTargetType = null;
        c.healTargetId = null;
        c.repathCooldown = MOB_REPATH_TICKS;
        return;
      }
      c.path = path;
      c.repathCooldown = MOB_REPATH_TICKS;
    } else if (c.repathCooldown > 0) {
      c.repathCooldown--;
    }
    advanceAlongPath(c, dt, BISHOP_SPEED);
  }
}

// One Ward Priest per colony tends every Ward Stone in turn. He is a "bishop" colonist spawned at a
// Church, but his postX/postY always names the Ward Stone he is heading to or tending, so he reads
// as a (non-commandable) Ward Stone bishop everywhere the post tile is consulted, client included.
const WARD_TEND_TICKS = TICK_RATE * 10;
const WARD_GRACE_TICKS = TICK_RATE * 60;
let wardPriestId: string | null = null;
let wardPriestTendTicks = 0;
// -1: no respawn pending. Otherwise counts down like a respawnQueue entry, then costs food.
let wardPriestRespawnTicks = -1;
// resourceKey -> cycleTick at which the priest last finished tending that stone. A stone with no
// entry has never been tended and is not warded.
const wardStoneLastTended = new Map<string, number>();

function isWardPriest(c: Colonist): boolean {
  return c.id === wardPriestId;
}

function tilesOfType(type: TileType): TileCoord[] {
  const found: TileCoord[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === type) found.push({ x: i % WORLD_TILES_X, y: Math.floor(i / WORLD_TILES_X) });
  }
  return found;
}

// Least-recently tended first (never-tended counts as oldest), nearest breaks ties.
function nextWardStoneFor(c: Colonist, stones: TileCoord[], skip: TileCoord | null = null): TileCoord | null {
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

function assignWardPriestTarget(c: Colonist, stone: TileCoord) {
  c.postX = stone.x;
  c.postY = stone.y;
  c.rallyTileX = stone.x;
  c.rallyTileY = stone.y;
  const center = tileToPixelCenter(stone);
  c.rallyX = center.x;
  c.rallyY = center.y;
  c.path = [];
  wardPriestTendTicks = 0;
}

// Once per tick: forget tend records of demolished stones, then keep exactly one Ward Priest alive
// while a Church and at least one Ward Stone exist (dismissed otherwise). A first priest, or one
// re-summoned after a dismissal, appears at once; one that died waits for the next dawn/dusk respawn
// window and pays RESPAWN_FOOD_COST, matching processRespawnQueue.
function updateWardPriestPresence() {
  for (const key of wardStoneLastTended.keys()) {
    const [tx, ty] = key.split(",").map(Number);
    if (tiles[tileIndex(tx, ty)] !== TileType.WardStone) wardStoneLastTended.delete(key);
  }
  const stones = tilesOfType(TileType.WardStone);
  const church = tilesOfType(TileType.ChurchPost)[0] ?? null;
  const priest = wardPriestId ? colonists.get(wardPriestId) : undefined;
  if (wardPriestId && !priest) {
    wardPriestId = null;
    // >= 0 = died, due back at a respawn window (0 since the windows; old saves may hold a countdown).
    wardPriestRespawnTicks = 0;
  }
  wardPriestAwaitingWindow = false;
  if (priest && (stones.length === 0 || !church)) {
    colonists.delete(priest.id);
    wardPriestId = null;
    return;
  }
  if (priest || stones.length === 0 || !church) return;
  wardPriestAwaitingWindow = wardPriestRespawnTicks >= 0;
  if (settlementBlocker(church.x, church.y) !== "") return;
  if (wardPriestRespawnTicks >= 0) {
    if (isNightNow() || !respawnWindowAt(cycleTick) || !trySpendFood(RESPAWN_FOOD_COST)) return;
    wardPriestAwaitingWindow = false;
    respawnWindowSpawned++;
  }
  const spawned = spawnColonistForPost(church.x, church.y, "bishop");
  wardPriestId = spawned.id;
  wardPriestRespawnTicks = -1;
  assignWardPriestTarget(spawned, nextWardStoneFor(spawned, stones)!);
}

function updateWardPriest(c: Colonist, dt: number) {
  if (tiles[tileIndex(c.postX, c.postY)] !== TileType.WardStone) {
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
  wardPriestTendTicks++;
  if (wardPriestTendTicks < WARD_TEND_TICKS) return;
  wardStoneLastTended.set(resourceKey(c.postX, c.postY), cycleTick);
  const next = nextWardStoneFor(c, tilesOfType(TileType.WardStone));
  if (!next) return;
  if (next.x !== c.postX || next.y !== c.postY) c.state = "patrolling";
  assignWardPriestTarget(c, next);
}

// Every position currently under a ward: the Abbey (always) plus each Ward Stone the Ward Priest
// finished tending within the last WARD_GRACE_TICKS.
function activeWardSources(): TileCoord[] {
  const sources: TileCoord[] = abbeyCenter ? [abbeyCenter] : [];
  for (const [key, tended] of wardStoneLastTended) {
    if (cycleTick - tended > WARD_GRACE_TICKS) continue;
    const [tx, ty] = key.split(",").map(Number);
    if (tiles[tileIndex(tx, ty)] === TileType.WardStone) sources.push({ x: tx, y: ty });
  }
  return sources;
}

function isWarded(px: number, py: number, sources: TileCoord[]): boolean {
  const radiusPx = WARD_RADIUS_TILES * TILE_SIZE;
  return sources.some((s) => {
    const center = tileToPixelCenter(s);
    return Math.hypot(px - center.x, py - center.y) <= radiusPx;
  });
}

// Ward Stones (resourceKey) whose ward was up at the end of the previous tick. Only Ward Stones:
// the Abbey's ward never lapses, so it is never tracked and never lets a Half-Latch through.
const wardStonesActiveLastTick = new Set<string>();

// Once per tick: any Ward Stone whose ward was up last tick and is down now has just lapsed, and a
// Half-Latch slips through at the stone. A stone that stays lapsed tick after tick triggers nothing
// more; it only re-arms once the Ward Priest tends it again. A stone that was
// demolished (no longer a WardStone tile) was removed, not left to lapse, so it spawns nothing.
function checkWardStoneLapses() {
  const activeNow = new Set<string>();
  for (const s of activeWardSources()) {
    if (tiles[tileIndex(s.x, s.y)] === TileType.WardStone) activeNow.add(resourceKey(s.x, s.y));
  }
  for (const key of wardStonesActiveLastTick) {
    if (activeNow.has(key)) continue;
    const [tx, ty] = key.split(",").map(Number);
    if (tiles[tileIndex(tx, ty)] === TileType.WardStone) {
      spawnHalfLatch({ x: tx, y: ty });
      broadcastEvent("ward", "A Ward Stone's ward has lapsed — something slipped through");
    }
  }
  wardStonesActiveLastTick.clear();
  for (const key of activeNow) wardStonesActiveLastTick.add(key);
}

// Same Mob shape as createRaidMob/spawnGuardian, but no siteId: never dormant, it seeks a target via
// pickMobTarget on its very first updateMob.
function spawnHalfLatch(tile: TileCoord) {
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

function updateColonist(c: Colonist, dt: number) {
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

// ---- Raid waves ----
// spawnRaid runs once per day at the day's midpoint and puts the whole of tonight's raid on the map
// in passive groups. updateRaidGroups then drives every grouped mob (updateMob skips them):
//   passive  - loiter near their spawn; turn aggressive at the group's aggroTick (uniform between
//              spawn and nightfall), at nightfall at the latest, or as soon as any member is damaged.
//   marching - the group walks to the colony together: the slowest member leads along one shared
//              path at its own speed, the rest hold formation slots around it. Once the leader is
//              within RAID_ENGAGE_RANGE_TILES of the colony or a target, the group dissolves and each
//              member falls back to updateMob's normal per-mob targeting (as does a damaged group).

type RaidEdge = "north" | "south" | "east" | "west";
type RaidGroupState = "passive" | "marching";
interface RaidGroup {
  id: string;
  faction: RaidFactionId;
  isHorde: boolean;
  // Edge its fresh mobs spawned on; null for a group of deserters only (they are never edge-spawned).
  edge: RaidEdge | null;
  memberIds: string[];
  // Loiter centre (spawn tile) per edge-spawned member; deserters stand still instead.
  homes: Map<string, TileCoord>;
  aggroTick: number;
  state: RaidGroupState;
  leaderId: string | null;
  // Formation slot per follower, set when the march starts: heading-relative pixels from the leader
  // (x = to the leader's right, y = behind it) and its row (0 = the leader's front row; old saves: 0).
  offsets: Map<string, { x: number; y: number; row?: number }>;
  repathCooldown: number;
  // March heading (unit vector, smoothed from the leader's movement); missing in old saves.
  headingX?: number;
  headingY?: number;
  // Contact: the tick row-by-row release began (see releaseRaidRows) and the leader's position then,
  // which the rows still waiting hold their slots around. Unset while the group is not engaging.
  engagedTick?: number;
  anchorX?: number;
  anchorY?: number;
}
const raidGroups = new Map<string, RaidGroup>();
// Day index whose raid has already spawned, so the midday check fires once per day.
let raidSpawnedForDay = -1;

function raidSizeForDay(dayIndex: number): number {
  const base = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex;
  return Math.max(1, Math.round(base * DIFFICULTY_TUNING[difficulty].spawnCount));
}

// Raids spawn on the edge band of a "raid box": the whole map on small worlds, but at most this many
// tiles from the first Town Center on big ones, so a 512 map's raiders reach the colony in reasonable time.
const RAID_MAX_SPAWN_DIST_TILES = 110;
// Shrinking spawn distances tried in turn until a raid anchor is within the pathfinding budget.
const RAID_SPAWN_DIST_STEPS = [RAID_MAX_SPAWN_DIST_TILES, 80, 55, 35];
let raidSpawnDist = RAID_MAX_SPAWN_DIST_TILES;
function raidBox() {
  const c = townCenters[0] ?? TOWN_CENTER_TILE;
  return {
    x0: Math.max(0, c.x - raidSpawnDist),
    x1: Math.min(WORLD_TILES_X - 1, c.x + raidSpawnDist),
    y0: Math.max(0, c.y - raidSpawnDist),
    y1: Math.min(WORLD_TILES_Y - 1, c.y + raidSpawnDist),
  };
}

// A raid anchor must be able to reach the colony inside the pathfinding budget (a margin under
// PATH_NODE_BUDGET, since the real path also detours). Breadth-first from the anchor until it is within
// RAID_REACH_RADIUS tiles of a Town Center (walls are breached by mobs, so the last stretch is not tested).
const RAID_REACH_RADIUS = 20;
const RAID_REACH_BUDGET = Math.floor(PATH_NODE_BUDGET * 0.8);
function raidAnchorWithinPathBudget(anchor: TileCoord): boolean {
  const goals = townCenters.length > 0 ? townCenters : [TOWN_CENTER_TILE];
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
    raidSpawnDist = dist;
    const found = randomRaidAnchorInBox(true);
    if (found) return found;
  }
  raidSpawnDist = RAID_SPAWN_DIST_STEPS[RAID_SPAWN_DIST_STEPS.length - 1];
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
    .filter((f) => !testForceRaidSiege || f === "banditBand" || f === "greenskinWarband")
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
  const forced = testForceRaidSiege ? all.find((e) => isSiegeKind(e.kind)) : undefined;
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

function createRaidMob(kind: MobKind, tile: TileCoord, groupId: string): Mob {
  const center = tileToPixelCenter(tile);
  const config = MOB_KIND_CONFIG[kind];
  const tuning = DIFFICULTY_TUNING[difficulty];
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
  mobs.set(mob.id, mob);
  return mob;
}

// On a deserter night (DESERTER_WAVE_CHANCE, once deserters have waited DESERTER_ACTIVATION_DAYS)
// every eligible deserter joins the horde where it stands, and fresh Bandit-band mobs fill the raid up
// to its normal size (none if the deserters alone already reach it).
// Departure tick for a group at `from`: a random arrival tick in [nightfall, nightfall + window] minus
// the estimated trip to the engage range of the first Town Center, but never before now.
function raidDepartureTick(from: TileCoord, group: RaidGroup, nightfallTick: number): number {
  const tc = townCenters[0] ?? TOWN_CENTER_TILE;
  const route = findPath(from, tc);
  const routeTiles = route ? route.length : Math.hypot(tc.x - from.x, tc.y - from.y) * 1.5;
  const speeds = group.memberIds.map((id) => mobs.get(id)?.speed ?? MOB_SPEED);
  const slowest = Math.max(1, Math.min(...speeds));
  const px = Math.max(0, routeTiles - RAID_ENGAGE_RANGE_TILES) * TILE_SIZE;
  const travel = Math.ceil(((px * RAID_TRAVEL_SLACK) / slowest) * TICK_RATE) + RAID_TRAVEL_MARGIN_TICKS;
  const arrival = nightfallTick + Math.floor(Math.random() * NIGHT_TICKS * RAID_ARRIVAL_WINDOW_FRACTION);
  return Math.max(cycleTick, arrival - travel);
}

function spawnRaid(dayIndex: number) {
  const nightfallTick = dayIndex * (DAY_TICKS + NIGHT_TICKS) + DAY_TICKS;
  const total = raidSizeForDay(dayIndex);
  const eligibleDeserters = Array.from(mobs.values()).filter(
    (m) =>
      m.isDeserter &&
      !m.deserterActive &&
      m.groupId === null &&
      cycleTick - m.deserterSinceTick >= DESERTER_ACTIVATION_TICKS
  );
  const deserterRoll = testForceDeserterRoll ?? Math.random() < DESERTER_WAVE_CHANCE;
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
      aggroTick: testHoldRaidAggro
        ? nightfallTick
        : cycleTick + Math.floor(Math.random() * Math.max(1, nightfallTick - cycleTick)),
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
      if (anchor && !testHoldRaidAggro) group.aggroTick = raidDepartureTick(anchor.tile, group, nightfallTick);
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
function engageRaidGroup(group: RaidGroup) {
  if (group.engagedTick !== undefined) return;
  const leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  const members = raidGroupMembers(group);
  const anchor = leader && leader.groupId === group.id ? leader : members[0];
  group.engagedTick = cycleTick;
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
  const due = Math.floor((cycleTick - (group.engagedTick ?? cycleTick)) / RAID_RELEASE_ROW_TICKS);
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

// Regiments & roles: the front ranks hold the melee roles in the faction's formation - shock (heavies)
// first, so front / centre, then the frontline rank and file - with the fast roles (wolves, spiders) on
// the wings (the outermost front slots). The ranged / casters form a rear rank RAID_REAR_RANK_TILES behind
// the front row (or one spacing behind the last front row, if deeper), centred, released last on contact.
// The slowest front-rank member leads from the front-centre slot (an all-ranged group: the slowest of
// all); the march goes at the slowest member's pace (marchRaidGroup).
const RAID_REAR_RANK_TILES = 3.5;
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
  const meanR = members.reduce((sum, m) => sum + (MOB_BODY_RADIUS[m.kind] ?? 8), 0) / members.length;
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
function stepRaidMobToward(m: { x: number; y: number }, tx: number, ty: number, speed: number, dt: number): boolean {
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
      if (cycleTick < group.aggroTick && !night) {
        for (const m of members) loiterRaidMob(group, m, members, dt);
        continue;
      }
      startRaidGroupMarch(group);
      if (!raidGroups.has(group.id)) continue;
    }
    marchRaidGroup(group, dt);
  }
}

// Candidates under an active ward are skipped. If that leaves nothing, returns null and updateMob
// leaves the mob standing where it is until something targetable turns up (same as before when
// there was simply nothing to attack).
// The nearest unwarded Town Center as a mob target, or null.
function nearestUnwardedTownCenterTarget(mob: Mob, wards: TileCoord[]): { type: MobTargetType; id: string } | null {
  const byDistance = townCenters
    .map((tc) => ({ tc, pos: tileToPixelCenter(tc) }))
    .sort((a, b) => Math.hypot(a.pos.x - mob.x, a.pos.y - mob.y) - Math.hypot(b.pos.x - mob.x, b.pos.y - mob.y));
  for (const { tc } of byDistance) {
    const id = resourceKey(tc.x, tc.y);
    const pos = resolveTargetPosition("townCenter", id);
    if (pos && !isWarded(pos.x, pos.y, wards)) return { type: "townCenter", id };
  }
  return null;
}

// Gunne: the most wounded (lowest hp fraction, below full) guard / militia / player in range.
// Gorrath: the healthiest (highest current hp) one in range. null falls back to ordinary targeting.
function pickMarkedUnitTarget(mob: Mob, wards: TileCoord[]): { type: MobTargetType; id: string } | null {
  const gunne = mob.mark === HungerMark.Gunne;
  const rangePx = (gunne ? GUNNE_SCAN_RANGE_TILES : GORRATH_SCAN_RANGE_TILES) * TILE_SIZE;
  let best: { type: MobTargetType; id: string } | null = null;
  let bestScore = -Infinity;
  const consider = (type: MobTargetType, id: string, x: number, y: number, hp: number, maxHp: number) => {
    if (Math.hypot(x - mob.x, y - mob.y) > rangePx || isWarded(x, y, wards)) return;
    const ratio = hp / Math.max(1, maxHp);
    if (gunne && ratio >= 1) return;
    const score = gunne ? -ratio : hp;
    if (score > bestScore) {
      bestScore = score;
      best = { type, id };
    }
  };
  for (const c of colonists.values()) {
    if (isGuardOrMilitiaKind(c.kind)) consider("colonist", c.id, c.x, c.y, c.hp, c.maxHp);
  }
  for (const p of players.values()) {
    if (!p.dead) consider("player", p.id, p.x, p.y, p.hp, playerMaxHp(p));
  }
  return best;
}

// A mob target pick; `approach` (building / Town Center targets only) is the tile to attack from.
interface PickedTarget {
  type: MobTargetType;
  id: string | null;
  approach?: TileCoord;
}

function pickMobTarget(mob: Mob): PickedTarget | null {
  const wards = activeWardSources();
  if (mob.mark === HungerMark.Nemri) {
    const tc = nearestUnwardedTownCenterTarget(mob, wards);
    if (tc) return tc;
  } else if (mob.mark === HungerMark.Gunne || mob.mark === HungerMark.Gorrath) {
    const picked = pickMarkedUnitTarget(mob, wards);
    if (picked) return picked;
  }
  // Guards / players only draw a mob within its aggro range; beyond that it goes for buildings.
  // Battle discipline: a melee mob prefers the nearest soldier that still has room for another attacker
  // (meleeAttackerCap) when it is at most MOB_ROOM_DETOUR_PX further than the nearest one, so a raid
  // spreads along the defenders' line instead of piling onto the first man; otherwise it queues on the
  // nearest (see updateMob).
  let bestGuard: Colonist | null = null;
  let bestGuardDist = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  let roomGuard: Colonist | null = null;
  let roomGuardDist = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  const guardCap = meleeAttackerCap(COLONIST_BODY_RADIUS);
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (isWarded(c.x, c.y, wards)) continue;
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d < bestGuardDist) {
      bestGuardDist = d;
      bestGuard = c;
    }
    if (mob.melee && d < roomGuardDist && targetHasRoom(mob.id, `c:${c.id}`, guardCap)) {
      roomGuardDist = d;
      roomGuard = c;
    }
  }
  if (roomGuard && roomGuardDist <= bestGuardDist + MOB_ROOM_DETOUR_PX) return { type: "colonist", id: roomGuard.id };
  if (bestGuard) return { type: "colonist", id: bestGuard.id };

  let bestPlayer: Player | null = null;
  let bestPlayerDist = MOB_AGGRO_RANGE_PLAYER_TILES * TILE_SIZE;
  for (const p of players.values()) {
    if (p.dead || testPlayersIgnored || isWarded(p.x, p.y, wards)) continue;
    const d = Math.hypot(p.x - mob.x, p.y - mob.y);
    if (d < bestPlayerDist) {
      bestPlayerDist = d;
      bestPlayer = p;
    }
  }
  if (bestPlayer) return { type: "player", id: bestPlayer.id };

  // No guard / player to fight: the nearest unwarded building (Town Centers included).
  return pickBuildingTarget(mob, wards);
}

// True while a guard / militia / player is targetable (unwarded) within the mob's aggro range: a mob on
// a building drops it then.
function unitInAggroRange(mob: Mob, wards: TileCoord[]): boolean {
  const guardPx = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  const playerPx = MOB_AGGRO_RANGE_PLAYER_TILES * TILE_SIZE;
  for (const c of colonists.values()) {
    if (isGuardOrMilitiaKind(c.kind) && Math.hypot(c.x - mob.x, c.y - mob.y) <= guardPx && !isWarded(c.x, c.y, wards)) return true;
  }
  for (const p of players.values()) {
    if (!p.dead && !testPlayersIgnored && Math.hypot(p.x - mob.x, p.y - mob.y) <= playerPx && !isWarded(p.x, p.y, wards)) return true;
  }
  return false;
}

// True when an unwarded non-wall building lies within MOB_BUILDING_AGGRO_TILES of (x, y) and nearer than
// `than` px (a mob heading for a Town Center turns on houses it passes). Scans the cached candidates.
function buildingNearby(x: number, y: number, than: number, wards: TileCoord[]): boolean {
  const limit = Math.min(than, MOB_BUILDING_AGGRO_TILES * TILE_SIZE);
  for (const b of buildingTargetCandidates()) {
    const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = b.y * TILE_SIZE + TILE_SIZE / 2;
    if (Math.abs(cx - x) > limit || Math.abs(cy - y) > limit) continue;
    if (Math.hypot(cx - x, cy - y) < limit && !isWarded(cx, cy, wards)) return true;
  }
  return false;
}

// `mob` (optional) lets a building / Town Center target resolve to the approach tile its pick chose.
function resolveTargetPosition(
  targetType: MobTargetType,
  targetId: string | null,
  mob?: Mob
): { x: number; y: number } | null {
  if (targetType === "colonist") {
    if (!targetId) return null;
    const c = colonists.get(targetId);
    return c ? { x: c.x, y: c.y } : null;
  }
  if (targetType === "player") {
    if (!targetId) return null;
    const p = players.get(targetId);
    return p && !p.dead ? { x: p.x, y: p.y } : null;
  }
  if (targetType === "building") {
    const tile = targetId ? keyToTile(targetId) : null;
    if (!tile || !isDamageableBuilding(tiles[tileIndex(tile.x, tile.y)] as TileType)) return null;
    return tileToPixelCenter(mobApproach(mob, targetId) ?? findAdjacentWalkable(tile.x, tile.y) ?? tile);
  }
  // Town Center targets are keyed by the Town Center's tile ("x,y").
  const tc = targetId ? townCenters.find((t) => resourceKey(t.x, t.y) === targetId) : undefined;
  if (!tc) return null;
  const approach = mobApproach(mob, targetId) ?? findAdjacentWalkable(tc.x, tc.y);
  return tileToPixelCenter(approach ?? tc);
}

function keyToTile(key: string): TileCoord | null {
  const [x, y] = key.split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) && inBounds(x, y) ? { x, y } : null;
}

// The approach tile `mob`'s pick chose for `targetId`, while it is still walkable.
function mobApproach(mob: Mob | undefined, targetId: string | null): TileCoord | null {
  if (!mob || targetId === null || mob.approachFor !== targetId) return null;
  const x = mob.approachX ?? -1;
  const y = mob.approachY ?? -1;
  return isWalkableTile(x, y) ? { x, y } : null;
}

function damageTownCenter(tc: TownCenter, amount: number) {
  tc.hp -= amount;
  if (tc.hp <= 0) destroyTownCenter(tc);
}

function isWallTile(t: TileType): boolean {
  return t === TileType.Wall || t === TileType.StoneWall;
}

// Tile type -> 1 when mobs can damage it: player buildings that are solid and demolishable (walls
// included), not construction sites, roads, farm plots or wild forage. Town Centers are separate.
let damageableLut: Uint8Array | null = null;
function isDamageableBuilding(t: TileType): boolean {
  if (!damageableLut) {
    damageableLut = new Uint8Array(256);
    for (const b of BREAKABLE_TILES) {
      if (b !== TileType.ConstructionSite && isSolidTile(b) && !FORAGE_TILES.includes(b)) damageableLut[b] = 1;
    }
    // Gates aren't solid tiles (their passability is gate state) but take damage like a wall.
    damageableLut[TileType.Gate] = 1;
  }
  return damageableLut[t] === 1;
}

function buildingBaseHp(t: TileType): number {
  if (t === TileType.Wall) return BUILDING_HP_WALL;
  if (t === TileType.StoneWall) return BUILDING_HP_STONE_WALL;
  if (t === TileType.Gate) return BUILDING_HP_GATE;
  if (
    BIG_BUILD_TILES.has(t) || t === TileType.CastleLevel2 || t === TileType.CastleLevel3 || t === TileType.Stables ||
    isTowerTile(t) || t === TileType.MilitiaCamp3
  )
    return BUILDING_HP_BIG;
  if (isHouseTile(t) || t === TileType.HunterHut || t === TileType.ForagerHut || t === TileType.ArcherPost) return BUILDING_HP_SMALL;
  return BUILDING_HP_WORKPLACE;
}

function buildingMaxHp(tx: number, ty: number, t: TileType): number {
  const level = Math.min(Math.max(currentBuildingLevel(tx, ty, t), 1), 3);
  return Math.round(buildingBaseHp(t) * BUILDING_HP_LEVEL_MULT[level - 1]);
}

// HP of the building / Town Center at a tile (null: nothing damageable there).
function structureHp(tx: number, ty: number): { hp: number; max: number } | null {
  if (!inBounds(tx, ty)) return null;
  const t = tiles[tileIndex(tx, ty)] as TileType;
  if (t === TileType.TownCenter) {
    const tc = findTownCenterAt(tx, ty);
    return tc ? { hp: Math.max(0, tc.hp), max: townCenterMaxHp(tc.level) } : null;
  }
  if (!isDamageableBuilding(t)) return null;
  const max = buildingMaxHp(tx, ty, t);
  return { hp: Math.min(max, buildingHp.get(resourceKey(tx, ty)) ?? max), max };
}

function healStructure(tx: number, ty: number, amount: number) {
  const key = resourceKey(tx, ty);
  const tc = findTownCenterAt(tx, ty);
  if (tc && tiles[tileIndex(tx, ty)] === TileType.TownCenter) {
    tc.hp = Math.min(townCenterMaxHp(tc.level), tc.hp + amount);
    return;
  }
  const s = structureHp(tx, ty);
  if (!s) return;
  if (s.hp + amount >= s.max) buildingHp.delete(key);
  else buildingHp.set(key, s.hp + amount);
}

// Mob damage to the building (or Town Center) at a tile; at 0 HP it is destroyed.
function damageBuilding(tx: number, ty: number, amount: number) {
  const t = tiles[tileIndex(tx, ty)] as TileType;
  if (t === TileType.TownCenter) {
    const tc = findTownCenterAt(tx, ty);
    if (tc) damageTownCenter(tc, amount);
    return;
  }
  const s = structureHp(tx, ty);
  if (!s) return;
  const hp = s.hp - amount;
  if (hp > 0) {
    buildingHp.set(resourceKey(tx, ty), hp);
    return;
  }
  // Destroyed: the same clean-up as a player demolishing it (posted workers, level, site, HP).
  demolishTile(tx, ty, t);
  syncGuardBonusesAround(tx, ty);
  broadcastEvent("death", `${BUILDING_NAMES[t] ?? "A building"} destroyed`);
}

// Flattened [tile index, hp permille] per damaged building and Town Center (see damagedBuildings).
function damagedBuildingsForSnapshot(): number[] {
  const out: number[] = [];
  for (const key of Array.from(buildingHp.keys())) {
    const tile = keyToTile(key);
    const s = tile ? structureHp(tile.x, tile.y) : null;
    // The building is gone (or became something undamageable) some other way: drop the record.
    if (!tile || !s || tiles[tileIndex(tile.x, tile.y)] === TileType.TownCenter) {
      buildingHp.delete(key);
      continue;
    }
    if (s.hp < s.max) out.push(tileIndex(tile.x, tile.y), Math.floor((s.hp / s.max) * 1000));
  }
  for (const tc of townCenters) {
    const max = townCenterMaxHp(tc.level);
    if (tc.hp < max) out.push(tileIndex(tc.x, tc.y), Math.max(0, Math.floor((tc.hp / max) * 1000)));
  }
  // Camp hearths: a damaged one gets the same HP bar / flames as a damaged building.
  for (const h of hearths.values()) {
    if (!h.destroyed && h.hp < h.maxHp) out.push(tileIndex(h.x, h.y), Math.max(0, Math.floor((h.hp / h.maxHp) * 1000)));
  }
  return out;
}

// ---- Walls & gates (ROADMAP §8 items 2-5, 2026-10-23) ----
// A Gate is one placeable tile with HP (BUILDING_HP_GATE) and a state per tile (`gates`):
//  - OPEN / CLOSED. With lock "auto" it opens while a friendly unit (a player or any colonist) is within
//    GATE_OPEN_RANGE_PX of its centre and closes GATE_CLOSE_DELAY_TICKS after the last one left. Lock
//    "open" / "closed" (building info menu, setGateLock) holds it either way; a locked-closed gate blocks
//    the colony's own units too. It never closes on a body standing in it.
//  - Passability (isWalkableTile via gatePassable): open = ground for everyone, friend or foe; closed =
//    solid for mobs and wildlife (hostileMover), passable for the colony's units (they open it on arrival).
//  - OVERRUN (item 5): once a second, if the summed strength (current HP) of awake mobs within
//    GATE_OVERRUN_RANGE_TILES beats the defenders' (guard / militia colonists in that range + towers in it)
//    and no living Tower (livingTowersNear) stands within GATE_TOWER_RANGE_TILES, the gate is overrun: it is
//    passable for mobs as if open until that majority is lost ("Gate overrun" toast on the way in).
// Mob choice gate vs wall (item 4): pickBuildingTarget first tries an ordinary route (open / overrun gates
// are ground, closed gates and walls solid) and takes it within BREACH_DETOUR_FACTOR. Otherwise the breach
// search crosses walls and closed gates at
//   breachStepCost = 1 + round(currentHp / BREACH_HP_PER_TILE) + BREACH_TOWER_PENALTY_TILES x (living
//                    towers within GATE_TOWER_RANGE_TILES of that tile)
// route tiles each (full HP: wood wall 9, gate 19, stone wall 37), and the first wall / closed gate on the
// cheapest route is attacked. So an open gate wins whenever it's within the detour, a closed gate beats a
// stone wall unless the wall route is ~18+ tiles shorter, a wood wall beats a gate unless the gate route
// is ~10+ tiles shorter, damaged sections and undefended stretches are preferred.
const GATE_OPEN_RANGE_PX = TILE_SIZE * 1.5;
const GATE_CLOSE_DELAY_TICKS = TICK_RATE * 2;
const GATE_OVERRUN_RANGE_TILES = 6;
const GATE_TOWER_RANGE_TILES = 8;
const BREACH_HP_PER_TILE = 25;
const BREACH_TOWER_PENALTY_TILES = 12;
const BUILD_SECONDS_GATE = 8;
// Set by broadcastTileUpdate: the gate registry is rescanned.
let gateTilesDirty = true;
// Mobs whose last path search toward their building target failed (a gate closed on the route).
const mobsWithoutRoute = new Set<string>();

// Runs `fn` with isWalkableTile answering for mobs (closed gates solid).
function withHostileMover<T>(fn: () => T): T {
  const prev = hostileMover;
  hostileMover = true;
  try {
    return fn();
  } finally {
    hostileMover = prev;
  }
}

function gateAt(index: number): GateState {
  let g = gates.get(index);
  if (!g) {
    g = { open: false, lock: "auto", clearTicks: GATE_CLOSE_DELAY_TICKS, overrun: false };
    gates.set(index, g);
  }
  return g;
}

// A gate tile with no record yet (just placed by a test, or a fresh load) counts as closed, auto.
function gatePassable(index: number, hostile: boolean): boolean {
  const g = gates.get(index);
  if (hostile) return !!g && (g.open || g.overrun);
  return !g || g.open || g.lock !== "closed";
}

// A wall or a gate mobs can't walk through right now (the breach search's obstacles).
function isBreachObstacle(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = tiles[tileIndex(tx, ty)] as TileType;
  return isWallTile(t) || (t === TileType.Gate && !gatePassable(tileIndex(tx, ty), true));
}

// Route cost of breaking through the wall / closed gate at a tile (integer: routeToBuilding's heap needs it).
function breachStepCost(tx: number, ty: number): number {
  const hp = structureHp(tx, ty)?.hp ?? 0;
  return 1 + Math.round(hp / BREACH_HP_PER_TILE) + BREACH_TOWER_PENALTY_TILES * livingTowersNear(tx, ty, GATE_TOWER_RANGE_TILES).length;
}

// updateMob's once-a-second check for a mob on a building target.
function mobTargetNeedsRepick(mob: Mob): boolean {
  if (mobsWithoutRoute.has(mob.id) && mob.path.length === 0) {
    mobsWithoutRoute.delete(mob.id);
    return true;
  }
  const tile = mob.targetType === "building" && mob.targetId ? keyToTile(mob.targetId) : null;
  return !!tile && tiles[tileIndex(tile.x, tile.y)] === TileType.Gate && gatePassable(tileIndex(tile.x, tile.y), true);
}

function friendlyNearGate(cx: number, cy: number): boolean {
  for (const p of players.values()) {
    if (!p.dead && Math.hypot(p.x - cx, p.y - cy) <= GATE_OPEN_RANGE_PX) return true;
  }
  for (const c of colonists.values()) {
    if (Math.hypot(c.x - cx, c.y - cy) <= GATE_OPEN_RANGE_PX) return true;
  }
  return false;
}

// Anything standing in the gate's tile (a player's box overlapping it): the gate can't close on it.
function gateOccupied(tx: number, ty: number): boolean {
  const inTile = (x: number, y: number) => Math.floor(x / TILE_SIZE) === tx && Math.floor(y / TILE_SIZE) === ty;
  const x0 = tx * TILE_SIZE;
  const y0 = ty * TILE_SIZE;
  for (const p of players.values()) {
    if (p.dead) continue;
    if (p.x + PLAYER_HALF_SIZE > x0 && p.x - PLAYER_HALF_SIZE < x0 + TILE_SIZE && p.y + PLAYER_HALF_SIZE > y0 && p.y - PLAYER_HALF_SIZE < y0 + TILE_SIZE) return true;
  }
  for (const c of colonists.values()) if (inTile(c.x, c.y)) return true;
  for (const m of mobs.values()) if (inTile(m.x, m.y)) return true;
  for (const a of wildlife.values()) if (inTile(a.x, a.y)) return true;
  return false;
}

function evaluateGateOverrun(index: number, g: GateState) {
  const tx = index % WORLD_TILES_X;
  const ty = Math.floor(index / WORLD_TILES_X);
  const c = tileToPixelCenter({ x: tx, y: ty });
  const range = GATE_OVERRUN_RANGE_TILES * TILE_SIZE;
  let hostile = 0;
  for (const m of mobs.values()) {
    if (m.passive || isDormantGuardian(m) || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - c.x, m.y - c.y) <= range) hostile += Math.max(0, m.hp);
  }
  let defence = 0;
  for (const col of colonists.values()) {
    if (isGuardOrMilitiaKind(col.kind) && Math.hypot(col.x - c.x, col.y - c.y) <= range) defence += Math.max(0, col.hp);
  }
  for (const t of livingTowersNear(tx, ty, GATE_OVERRUN_RANGE_TILES)) defence += structureHp(t.x, t.y)?.hp ?? 0;
  const overrun = hostile > 0 && hostile > defence && livingTowersNear(tx, ty, GATE_TOWER_RANGE_TILES).length === 0;
  if (overrun && !g.overrun) broadcastEvent("raid", "Gate overrun");
  g.overrun = overrun;
}

// Once per tick: registry upkeep, auto open / close, and (once a second) the overrun check.
function updateGates(forceOverrunCheck = false) {
  if (gateTilesDirty) {
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === TileType.Gate) gateAt(i);
    for (const index of Array.from(gates.keys())) if (tiles[index] !== TileType.Gate) gates.delete(index);
    gateTilesDirty = false;
  }
  if (cycleTick % TICK_RATE === 0) {
    for (const id of Array.from(mobsWithoutRoute)) if (!mobs.has(id)) mobsWithoutRoute.delete(id);
  }
  for (const [index, g] of gates) {
    const tx = index % WORLD_TILES_X;
    const ty = Math.floor(index / WORLD_TILES_X);
    const c = tileToPixelCenter({ x: tx, y: ty });
    if (g.lock === "open") {
      g.open = true;
    } else if (g.lock === "auto" && friendlyNearGate(c.x, c.y)) {
      g.open = true;
      g.clearTicks = 0;
    } else {
      if (g.lock === "auto") g.clearTicks++;
      const shouldClose = g.lock === "closed" || g.clearTicks >= GATE_CLOSE_DELAY_TICKS;
      if (g.open && shouldClose && !gateOccupied(tx, ty)) g.open = false;
    }
    if (forceOverrunCheck || cycleTick % TICK_RATE === 0) evaluateGateOverrun(index, g);
  }
}

function gatesForSnapshot(): number[] {
  const out: number[] = [];
  for (const [index, g] of gates) {
    out.push(
      index,
      (g.open ? GATE_FLAG_OPEN : 0) |
        (g.lock === "open" ? GATE_FLAG_LOCK_OPEN : 0) |
        (g.lock === "closed" ? GATE_FLAG_LOCK_CLOSED : 0) |
        (g.overrun ? GATE_FLAG_OVERRUN : 0)
    );
  }
  return out;
}

function handleSetGateLock(tx: number, ty: number, lock: unknown) {
  if (!inBounds(tx, ty) || tiles[tileIndex(tx, ty)] !== TileType.Gate) return;
  if (lock !== "auto" && lock !== "open" && lock !== "closed") return;
  const g = gateAt(tileIndex(tx, ty));
  g.lock = lock;
  if (lock === "open") g.open = true;
  // Auto: start the close countdown now; the next tick re-opens it for anyone still near.
  if (lock === "auto") g.clearTicks = GATE_CLOSE_DELAY_TICKS;
}

// Damageable non-wall buildings (the candidates of pickBuildingTarget), rebuilt lazily after tile changes.
let buildingTargetTiles: TileCoord[] = [];
let buildingTargetsBuiltTick = -1;
function buildingTargetCandidates(): TileCoord[] {
  // Also rebuilt every few seconds, in case some code path changed a tile without a tileUpdate.
  if (buildingTargetsDirty || cycleTick - buildingTargetsBuiltTick > TICK_RATE * 5 || cycleTick < buildingTargetsBuiltTick) {
    buildingTargetTiles = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as TileType;
      if (isDamageableBuilding(t) && !isWallTile(t) && t !== TileType.Gate) buildingTargetTiles.push({ x: i % WORLD_TILES_X, y: Math.floor(i / WORLD_TILES_X) });
    }
    buildingTargetsDirty = false;
    buildingTargetsBuiltTick = cycleTick;
  }
  return buildingTargetTiles;
}

// Shortest route (start excluded) from `start` to a tile next to (gx, gy), 4-connected. wallCost 0:
// walls are solid like any other building (an ordinary route); wallCost > 0: wall tiles are passable at
// that cost each (the breach search). Dijkstra over a binary heap of cost * N + tile index.
let routeCost = new Float64Array(WORLD_TILES_X * WORLD_TILES_Y);
let routeParent = new Int32Array(WORLD_TILES_X * WORLD_TILES_Y);
const ROUTE_NODE_BUDGET = 120000;
function routeToBuilding(start: TileCoord, gx: number, gy: number, wallCost: number): TileCoord[] | null {
  const n = tiles.length;
  const s = tileIndex(start.x, start.y);
  const isGoal = (i: number) => Math.abs((i % WORLD_TILES_X) - gx) + Math.abs(Math.floor(i / WORLD_TILES_X) - gy) === 1;
  if (isGoal(s)) return [];
  routeCost.fill(Infinity);
  routeCost[s] = 0;
  const heap: number[] = [s];
  const push = (v: number) => {
    let i = heap.push(v) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p] <= heap[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  // Settled-node budget (see PATH_NODE_BUDGET); a 160 map has only 25.6k tiles, so it never bites there.
  let settled = 0;
  while (heap.length > 0) {
    if (++settled > ROUTE_NODE_BUDGET) return null;
    const v = pop();
    const idx = v % n;
    const cost = (v - idx) / n;
    if (cost > routeCost[idx]) continue;
    if (idx !== s && isGoal(idx)) {
      const path: TileCoord[] = [];
      for (let i = idx; i !== s; i = routeParent[i]) path.unshift({ x: i % WORLD_TILES_X, y: Math.floor(i / WORLD_TILES_X) });
      return path;
    }
    const x = idx % WORLD_TILES_X;
    const y = Math.floor(idx / WORLD_TILES_X);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inBounds(nx, ny)) continue;
      const ni = tileIndex(nx, ny);
      const t = tiles[ni] as TileType;
      // Gates: an open (or overrun) gate is ground; a closed one is solid, or a breach obstacle like a wall.
      const step =
        t === TileType.Gate
          ? gatePassable(ni, true) ? 1 : wallCost > 0 ? breachStepCost(nx, ny) : 0
          : !isSolidTile(t) ? 1 : wallCost > 0 && isWallTile(t) ? breachStepCost(nx, ny) : 0;
      if (step === 0) continue;
      const next = cost + step;
      if (next >= routeCost[ni]) continue;
      routeCost[ni] = next;
      routeParent[ni] = idx;
      push(next * n + ni);
    }
  }
  return null;
}

// The nearest unwarded building or Town Center the mob can reach. A target that is walled off (no
// route, or a detour past BREACH_DETOUR_FACTOR) makes the target the first wall on the cheapest route
// through the walls instead, attacked from the tile before it.
function pickBuildingTarget(mob: Mob, wards: TileCoord[]): PickedTarget | null {
  const candidates: { x: number; y: number; type: MobTargetType; d: number }[] = [];
  const consider = (x: number, y: number, type: MobTargetType) => {
    const c = tileToPixelCenter({ x, y });
    if (!isWarded(c.x, c.y, wards)) candidates.push({ x, y, type, d: Math.hypot(c.x - mob.x, c.y - mob.y) });
  };
  for (const tc of townCenters) consider(tc.x, tc.y, "townCenter");
  for (const b of buildingTargetCandidates()) consider(b.x, b.y, "building");
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(mob.x, mob.y);
  for (const cand of candidates.slice(0, BUILDING_TARGET_CANDIDATES)) {
    const id = resourceKey(cand.x, cand.y);
    const straight = Math.hypot(cand.x - start.x, cand.y - start.y);
    const route = routeToBuilding(start, cand.x, cand.y, 0);
    const approachOf = (r: TileCoord[]) => (r.length > 0 ? r[r.length - 1] : start);
    if (route && (route.length <= BREACH_MIN_ROUTE_TILES || route.length <= BREACH_DETOUR_FACTOR * straight)) {
      return { type: cand.type, id, approach: approachOf(route) };
    }
    const breach = routeToBuilding(start, cand.x, cand.y, BREACH_WALL_COST);
    const wallAt = breach ? breach.findIndex((t) => isBreachObstacle(t.x, t.y)) : -1;
    if (breach && wallAt >= 0) {
      const wall = breach[wallAt];
      return { type: "building", id: resourceKey(wall.x, wall.y), approach: wallAt > 0 ? breach[wallAt - 1] : start };
    }
    if (route) return { type: cand.type, id, approach: approachOf(route) };
  }
  return null;
}

// One straight step directly away from (fx, fy); stays put if that would enter a solid tile.
function stepMobAwayFrom(mob: Mob, fx: number, fy: number, dt: number) {
  mob.path = [];
  const dx = mob.x - fx;
  const dy = mob.y - fy;
  const d = Math.hypot(dx, dy) || 1;
  stepRaidMobToward(mob, mob.x + (dx / d) * TILE_SIZE, mob.y + (dy / d) * TILE_SIZE, mob.speed, dt);
}

// Distance to `target` of the nearest front-rank (non-rear role) mob of the same regiment within
// ARCHER_FRONT_RANK_SCAN_TILES of `mob`; Infinity when it has no front rank left near it.
function regimentFrontDistance(mob: Mob, regiment: string, target: { x: number; y: number }): number {
  const scanPx = ARCHER_FRONT_RANK_SCAN_TILES * TILE_SIZE;
  let best = Infinity;
  for (const o of mobs.values()) {
    if (o === mob || (o.regimentId ?? o.siteId) !== regiment || o.groupId !== null || isRearMob(o)) continue;
    if (Math.abs(o.x - mob.x) > scanPx || Math.abs(o.y - mob.y) > scanPx) continue;
    best = Math.min(best, Math.hypot(target.x - o.x, target.y - o.y));
  }
  return best;
}

function startVhorrunWithdraw(mob: Mob, from: { x: number; y: number }) {
  mob.withdrawUntilTick = cycleTick + VHORRUN_WITHDRAW_TICKS;
  mob.withdrawFromX = from.x;
  mob.withdrawFromY = from.y;
  mob.targetType = null;
  mob.targetId = null;
  mob.path = [];
}

function updateMob(mob: Mob, dt: number) {
  if (mob.isDeserter && !mob.deserterActive) return;
  if (isDormantGuardian(mob)) return;

  if (
    mob.kind === "troll" &&
    mob.hp < mob.maxHp &&
    cycleTick - mob.lastDamagedTick >= TROLL_REGEN_DELAY_TICKS
  ) {
    mob.hp = Math.min(mob.maxHp, mob.hp + TROLL_REGEN_PER_TICK);
  }

  // Runs ahead of target resolution (not after it) so the `if (!targetPos) return` below can't
  // skip it; it's independent of the shaman's own attack either way.
  if (mob.kind === "darkShaman") {
    if (mob.healCooldownTicks > 0) {
      mob.healCooldownTicks--;
    } else {
      let healTarget: Mob | null = null;
      let lowestRatio = Infinity;
      for (const other of mobs.values()) {
        if (other.id === mob.id) continue;
        if (other.isDeserter && !other.deserterActive) continue;
        if (isDormantGuardian(other)) continue;
        if (other.hp >= other.maxHp) continue;
        if (Math.hypot(other.x - mob.x, other.y - mob.y) > DARK_SHAMAN_HEAL_RANGE) continue;
        const ratio = other.hp / other.maxHp;
        if (ratio < lowestRatio) {
          lowestRatio = ratio;
          healTarget = other;
        }
      }
      if (healTarget) healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + DARK_SHAMAN_HEAL_AMOUNT);
      mob.healCooldownTicks = DARK_SHAMAN_HEAL_COOLDOWN_TICKS;
    }
  }

  // Raid-group members are moved by updateRaidGroups until their group breaks up.
  if (mob.groupId !== null) return;

  // Monster tactics: flanking / routing / leaving mobs are moved by mobTactic; a sheltering one holds
  // its post behind the walls and only fights what is in reach ("hold").
  const tactic = mobTactic(mob, dt);
  if (tactic === "handled") return;
  const hold = tactic === "hold";

  // Cavalry & siege: rams and catapults pick and hit their own targets (see updateSiegeMob).
  if (isSiegeKind(mob.kind)) {
    updateSiegeMob(mob, dt, hold);
    return;
  }

  // Vhorrun withdrawing after winning an exchange: back away from where the fight was, then return.
  if (mob.mark === HungerMark.Vhorrun && cycleTick < mob.withdrawUntilTick) {
    stepMobAwayFrom(mob, mob.withdrawFromX, mob.withdrawFromY, dt);
    return;
  }

  let targetPos = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
  // A target that has since moved under (or been covered by) an active ward is dropped and re-picked.
  if (targetPos && isWarded(targetPos.x, targetPos.y, activeWardSources())) targetPos = null;
  // Once a second (Nemri keeps to its Town Center): a mob on a building / Town Center turns on any
  // guard or player that comes within aggro range; one heading for a Town Center turns on a nearer
  // building it passes; one chasing a unit gives up once it is well past aggro range.
  if (targetPos && mob.mark !== HungerMark.Nemri && cycleTick % TICK_RATE === 0) {
    const wards = activeWardSources();
    if (mob.targetType === "building" || mob.targetType === "townCenter") {
      if (unitInAggroRange(mob, wards)) targetPos = null;
      // Walls & gates: a gate it was storming opened / was overrun, or its route closed: re-pick.
      else if (mobTargetNeedsRepick(mob)) targetPos = null;
      else if (mob.targetType === "townCenter" && buildingNearby(mob.x, mob.y, Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y), wards)) targetPos = null;
    } else if (mob.mark === HungerMark.None) {
      const aggro = mob.targetType === "player" ? MOB_AGGRO_RANGE_PLAYER_TILES : MOB_AGGRO_RANGE_GUARD_TILES;
      if (Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y) > aggro * TILE_SIZE * MOB_AGGRO_DROP_FACTOR) targetPos = null;
      // Queued (no engagement slot on its soldier): look again for one with room.
      else if (mob.melee && mob.targetType === "colonist" && !attackerSlots.has(mob.id)) targetPos = null;
    }
  }
  // Gunne / Gorrath keep re-checking for a weaker / stronger victim.
  if ((mob.mark === HungerMark.Gunne || mob.mark === HungerMark.Gorrath) && cycleTick % MARK_RETARGET_TICKS === 0) targetPos = null;

  if (!targetPos && hold) return;
  if (!targetPos) {
    const picked = pickMobTarget(mob);
    releaseSlot(mob.id);
    if (picked) {
      mob.targetType = picked.type;
      mob.targetId = picked.id;
      mob.approachFor = picked.approach ? picked.id : null;
      mob.approachX = picked.approach?.x ?? -1;
      mob.approachY = picked.approach?.y ?? -1;
      // A fresh building route starts now (the old path led to the previous target).
      if (picked.approach) {
        mob.path = [];
        mob.repathCooldown = 0;
      }
      targetPos = resolveTargetPosition(picked.type, picked.id, mob);
    } else {
      mob.targetType = null;
      mob.targetId = null;
    }
  }

  if (!targetPos) return;

  // Rux mid-feint: falls back from the target it just closed on.
  if (mob.mark === HungerMark.Rux && cycleTick < mob.feintUntilTick) {
    stepMobAwayFrom(mob, targetPos.x, targetPos.y, dt);
    return;
  }

  // Regiments: a ranged / caster mob whose regiment (raid group, or POI site) still has a front rank near
  // it stays behind that front: it never closes on a unit target past the front's own distance to it,
  // fires once in range, and kites a step back from a soldier's melee within RANGED_KITE_TILES.
  if (!mob.melee && (mob.targetType === "colonist" || mob.targetType === "player")) {
    const regiment = mob.regimentId ?? mob.siteId;
    const frontDist = regiment ? regimentFrontDistance(mob, regiment, targetPos) : Infinity;
    if (frontDist < Infinity) {
      const threat = nearestMeleeSoldier(mob.x, mob.y, RANGED_KITE_TILES * TILE_SIZE);
      const d = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
      if (threat) {
        stepMobAwayFrom(mob, threat.x, threat.y, dt);
        if (Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y) > mob.range) return;
      } else if (d > mob.range && d <= frontDist + TILE_SIZE * 0.5) {
        mob.path = [];
        return;
      }
    }
  }

  // Melee engagement slot: a unit target gives a ring point to fight from; a building / Town Center
  // gives a free tile of its walkable ring, which becomes the spot to stand on.
  let slot: { x: number; y: number } | null = null;
  const slotKey = mob.melee ? mobSlotKey(mob) : null;
  if (slotKey && mob.targetId !== null) {
    if (mob.targetType === "building" || mob.targetType === "townCenter") {
      const b = keyToTile(mob.targetId);
      const ringTile = b ? buildingSlotTile(mob, slotKey, b.x, b.y, mobApproach(mob, mob.targetId)) : null;
      if (ringTile) targetPos = tileToPixelCenter(ringTile);
    } else {
      const tr = mob.targetType === "colonist" ? COLONIST_BODY_RADIUS : PLAYER_BODY_RADIUS;
      const cap = mob.targetType === "colonist" ? meleeAttackerCap(tr) : Infinity;
      slot = unitSlotPoint(mob.id, mob.x, mob.y, MOB_BODY_RADIUS[mob.kind] ?? 8, mob.range, slotKey, targetPos.x, targetPos.y, tr, cap);
    }
  }

  const dist = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
  if (hold && dist > mob.range) return;
  // Queue: a melee mob with no slot on its unit target stands off behind the fighters instead of
  // shoving into the scrum (it re-picks a target with room once a second, see above).
  if (
    slotKey && !slot && dist > mob.range && dist <= mob.range + QUEUE_STANDOFF_PX &&
    (mob.targetType === "colonist" || mob.targetType === "player")
  ) {
    mob.path = [];
    return;
  }
  if (dist <= mob.range) {
    mob.path = [];
    mobsAttackingThisTick.add(mob.id);
    if (slot && Math.hypot(slot.x - mob.x, slot.y - mob.y) > 2) stepRaidMobToward(mob, slot.x, slot.y, mob.speed * 0.5, dt);
    if (mob.mark === HungerMark.Rux && mob.feintTargetId !== mob.targetId) {
      mob.feintTargetId = mob.targetId;
      mob.feintUntilTick = cycleTick + RUX_FEINT_TICKS;
      return;
    }
    if (mob.attackCooldownTicks > 0) {
      mob.attackCooldownTicks--;
    } else {
      mob.attackCooldownTicks = MOB_ATTACK_COOLDOWN_TICKS;
      // Building hits land on the building itself, not the tile the mob attacks it from.
      const struck = (mob.targetType === "building" || mob.targetType === "townCenter") && mob.targetId ? keyToTile(mob.targetId) : null;
      const hit = struck ? tileToPixelCenter(struck) : targetPos;
      pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: hit.x, toY: hit.y, melee: mob.melee });
      if (mob.targetId) recordMobStrike(mob, hit.x, hit.y);
      if (mob.targetType === "colonist" && mob.targetId) {
        const c = colonists.get(mob.targetId);
        if (c) {
          if (mob.flanker && isRearColonist(c)) {
            tacticsEvent(regimentKey(mob) ?? "", "flankStrike", `${mob.kind}->${c.kind}`);
          }
          if (mob.kind === "giantSpider") {
            c.poisonTicksRemaining = POISON_DURATION_TICKS;
            c.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damageColonist(c, mob.damage);
          if (mob.mark === HungerMark.Vhorrun && c.hp > 0 && c.hp < c.maxHp * VHORRUN_WITHDRAW_TARGET_HP) {
            startVhorrunWithdraw(mob, targetPos);
          }
        }
      } else if (mob.targetType === "player" && mob.targetId) {
        const p = players.get(mob.targetId);
        if (p) {
          if (mob.kind === "giantSpider") {
            p.poisonTicksRemaining = POISON_DURATION_TICKS;
            p.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damagePlayer(p, mob.damage);
          if (mob.mark === HungerMark.Vhorrun && !p.dead && p.hp < playerMaxHp(p) * VHORRUN_WITHDRAW_TARGET_HP) {
            startVhorrunWithdraw(mob, targetPos);
          }
        }
      } else if (mob.targetType === "townCenter" && mob.targetId) {
        const tc = townCenters.find((t) => resourceKey(t.x, t.y) === mob.targetId);
        if (tc) damageTownCenter(tc, mob.damage);
      } else if (mob.targetType === "building" && struck) {
        damageBuilding(struck.x, struck.y, mob.damage);
      }
    }
  } else if (slot) {
    approachGoal(mob, dist > mob.range + SLOT_CLOSE_IN_PX ? slot : targetPos, targetPos, mob.speed, dt);
  } else {
    if (mob.path.length === 0 && mob.repathCooldown <= 0) {
      const start = tileOfPixel(mob.x, mob.y);
      const goalTile = tileOfPixel(targetPos.x, targetPos.y);
      const path = findPath(start, goalTile);
      mob.path = path ?? [];
      mob.repathCooldown = MOB_REPATH_TICKS;
      if (path) mobsWithoutRoute.delete(mob.id);
      else mobsWithoutRoute.add(mob.id);
    } else if (mob.repathCooldown > 0) {
      mob.repathCooldown--;
    }
    advanceAlongPath(mob, dt, mob.speed);
  }
}

// ---- Monster tactics: flanking, wall cover, morale & rout (ROADMAP "Monster tactics") ----
// A regiment is every mob sharing regimentKey: a raid group (groupId, then regimentId once it broke
// up) or a POI site (siteId; future horde / fort sites use the same key). updateRegiments evaluates
// each one once a second: its strength against the player's forces near it, its morale, and whether it
// sends a flank group, takes cover behind its own walls or routs. mobTactic then moves the members.
const TACTICS_EVAL_TICKS = TICK_RATE;
// Player forces (soldiers, players, standing towers) this far from a regiment's centroid (plus its own
// spread, up to TACTICS_SPREAD_CAP_TILES) count against it; any at all means it is "in contact".
const TACTICS_SCAN_TILES = 10;
const TACTICS_SPREAD_CAP_TILES = 8;
// Flanking: the arc passes this far outside the enemy line's end, then cuts in behind it.
const FLANK_ARC_TILES = 7;
const FLANK_BEHIND_TILES = 3;
// No fast units: this share of the front line (at least FLANK_MIN_FRONT_FOR_DETACH strong) goes round.
const FLANK_DETACH_FRACTION = 0.2;
const FLANK_MIN_FRONT_FOR_DETACH = 5;
const FLANK_MAX_TICKS = 20 * TICK_RATE;
const FLANK_WAYPOINT_REACH_PX = TILE_SIZE * 1.5;
// A flanker past its first waypoint engages early once its target is this close.
const FLANK_ENGAGE_TILES = 3;
// The front line counts as engaged once a front-rank member closes within this much of its reach of a
// soldier target (so the fast wing leaves as the lines meet, not after it has charged in itself).
const FLANK_CONTACT_TILES = 6;
// Strength ratio (regiment / enemy) below which it is outnumbered (cover / morale drain), and above
// which a sheltering regiment comes back out.
const TACTICS_OUTNUMBERED_RATIO = 0.6;
const COVER_REENGAGE_RATIO = 1.0;
// A wall / gate of the shelter below this HP fraction (or an opened gate / a gap) is a breach.
const COVER_BREACH_HP_FRACTION = 0.5;
// Walled enclosure search: Chebyshev radius from the start tile it must close within.
const COVER_ENCLOSURE_TILES = 8;
const MORALE_MAX = 100;
const MORALE_ROUT = 25;
const MORALE_RALLY = 50;
const MORALE_RALLY_QUIET_TICKS = 10 * TICK_RATE;
// One death costs MORALE_CASUALTY x its weight / the regiment's peak size (only applied in contact).
const MORALE_CASUALTY = 50;
// Siege: the ram weighs as shock (2), the catapult as ranged (0.8); see moraleWeight.
const MORALE_ROLE_WEIGHT: Record<CombatRole, number> = { frontline: 1, shock: 2, ranged: 0.8, caster: 1, fast: 0.8, siege: 2 };
const MORALE_LEADER_WEIGHT = 3;
const MORALE_FRONT_LOST_PER_SEC = 8;
const MORALE_OUTFLANKED_PER_SEC = 4;
// Drain at ratio 0, falling linearly to 0 at TACTICS_OUTNUMBERED_RATIO.
const MORALE_OUTNUMBERED_PER_SEC = 20;
const MORALE_RECOVER_PER_SEC = 3;
const MORALE_WINNING_RATIO = 1.5;
// Losses are scaled by this while a morale anchor (boss / Hunger-marked) lives.
const MORALE_ANCHOR_RESIST = 0.5;
const ROUT_SPEED_FACTOR = 1.2;
const RAID_LEAVE_MAX_TICKS = 60 * TICK_RATE;
const ROUT_TOAST_COOLDOWN_TICKS = 30 * TICK_RATE;

interface RegimentState {
  id: string;
  morale: number;
  peak: number;
  routed: boolean;
  // A raid regiment (no site): routing makes it leave the map instead of falling back home.
  raid: boolean;
  homeX: number;
  homeY: number;
  lastContactTick: number;
  pendingLoss: number;
  hadFront: boolean;
  sheltering: boolean;
  // Shelter post per member (a tile inside the walls), set while sheltering.
  posts: Map<string, TileCoord>;
  flankIds: string[];
  ratio: number;
}
const regiments = new Map<string, RegimentState>();
// Site / regiment ids that own walls (the cover behaviour). Fort / horde sites register here, or set
// SITE_KIND_WALLED for their kind; testHook "setRegimentWalled" too. Encampment fences do not count.
const walledSites = new Set<string>();
const SITE_KIND_WALLED: Partial<Record<PoiSiteKind, boolean>> = {};
// Recent tactics events (testHook "tacticsState").
const tacticsEvents: Array<{ tick: number; type: string; regiment: string; detail?: string }> = [];
let lastRoutToastTick = -Infinity;
// testHook "tacticsConfig" {freezeMorale:true}: morale never changes (isolates flanking in tests).
let testMoraleFrozen = false;

function regimentKey(m: Mob): string | null {
  return m.groupId ?? m.regimentId ?? m.siteId ?? null;
}

function tacticsEvent(regiment: string, type: string, detail?: string) {
  tacticsEvents.push({ tick: cycleTick, type, regiment, detail });
  if (tacticsEvents.length > 200) tacticsEvents.shift();
}

// Bosses and Hunger-marked leaders: morale resistance for their regiment, and they never rout.
function isMoraleAnchor(m: Mob): boolean {
  return !!m.boss || m.mark !== HungerMark.None;
}

function noteRegimentCasualty(m: Mob) {
  const key = regimentKey(m);
  const reg = key ? regiments.get(key) : undefined;
  if (!reg) return;
  const weight = isMoraleAnchor(m) ? MORALE_LEADER_WEIGHT : m.kind === "catapult" ? MORALE_ROLE_WEIGHT.ranged : MORALE_ROLE_WEIGHT[mobRole(m)];
  reg.pendingLoss += (MORALE_CASUALTY * weight) / Math.max(3, reg.peak);
}

interface EnemyUnit {
  type: "colonist" | "player";
  id: string;
  x: number;
  y: number;
  rear: boolean;
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
  if (!testPlayersIgnored) {
    for (const p of players.values()) {
      if (p.dead || Math.hypot(p.x - cx, p.y - cy) > radiusPx) continue;
      hp += p.hp;
      dmg += playerDamage(p);
      units.push({ type: "player", id: p.id, x: p.x, y: p.y, rear: false });
    }
  }
  const t = tileOfPixel(cx, cy);
  for (const tw of livingTowersNear(t.x, t.y, radiusPx / TILE_SIZE)) {
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
        const tt = tiles[idx] as TileType;
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
  const gatesIn = e.barriers.filter((b) => tiles[tileIndex(b.x, b.y)] === TileType.Gate);
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
    const dE = WORLD_TILES_X - 1 - t.x;
    const dN = t.y;
    const dS = WORLD_TILES_Y - 1 - t.y;
    const min = Math.min(dW, dE, dN, dS);
    vx = min === dW ? -1 : min === dE ? 1 : 0;
    vy = vx !== 0 ? 0 : min === dN ? -1 : 1;
  }
  const maxX = WORLD_TILES_X - 1;
  const maxY = WORLD_TILES_Y - 1;
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
      m.leaveUntilTick = cycleTick + RAID_LEAVE_MAX_TICKS;
    }
  }
  if (toast && reg.raid && cycleTick - lastRoutToastTick >= ROUT_TOAST_COOLDOWN_TICKS) {
    lastRoutToastTick = cycleTick;
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
      m.flankUntilTick = cycleTick + FLANK_MAX_TICKS;
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
  if (!testMoraleFrozen) {
    let delta = 0;
    if (contact) {
      reg.lastContactTick = cycleTick;
      delta -= reg.pendingLoss;
      if (members.some((m) => !isRearMob(m))) reg.hadFront = true;
      else if (reg.hadFront) delta -= MORALE_FRONT_LOST_PER_SEC;
      // Outflanked: an enemy within 4 tiles of a member on the far side of the regiment.
      const dl = Math.hypot(ex - cx, ey - cy) || 1;
      const outflanked = enemy.units.some(
        (u) => ((u.x - cx) * (ex - cx) + (u.y - cy) * (ey - cy)) / dl < -TILE_SIZE &&
          members.some((m) => Math.hypot(m.x - u.x, m.y - u.y) <= 4 * TILE_SIZE)
      );
      if (outflanked) delta -= MORALE_OUTFLANKED_PER_SEC;
      if (reg.ratio < TACTICS_OUTNUMBERED_RATIO && !reg.sheltering) {
        delta -= MORALE_OUTNUMBERED_PER_SEC * (1 - reg.ratio / TACTICS_OUTNUMBERED_RATIO);
      } else if (reg.ratio > MORALE_WINNING_RATIO) delta += MORALE_RECOVER_PER_SEC;
      if (delta < 0 && members.some(isMoraleAnchor)) delta *= MORALE_ANCHOR_RESIST;
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
  if (!reg.routed && !reg.sheltering && reg.morale < MORALE_ROUT) startRout(reg, members, ex, ey);
  else if (reg.routed && !reg.raid && reg.morale > MORALE_RALLY && cycleTick - reg.lastContactTick >= MORALE_RALLY_QUIET_TICKS) {
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
  if (cycleTick % TACTICS_EVAL_TICKS !== 0) return;
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
        lastContactTick: -Infinity, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: Infinity,
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
  if (!testPlayersIgnored) {
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
function mobTactic(mob: Mob, dt: number): "handled" | "hold" | null {
  const key = regimentKey(mob);
  const reg = key ? regiments.get(key) : undefined;
  if (mob.tactic === "leave") {
    const t = tileOfPixel(mob.x, mob.y);
    const onEdge = t.x <= 0 || t.y <= 0 || t.x >= WORLD_TILES_X - 1 || t.y >= WORLD_TILES_Y - 1;
    const gx = mob.fleeX ?? mob.x;
    const gy = mob.fleeY ?? mob.y;
    if (onEdge || cycleTick >= (mob.leaveUntilTick ?? 0) || Math.hypot(gx - mob.x, gy - mob.y) < TILE_SIZE * 0.75) {
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
    if (!target || cycleTick > (mob.flankUntilTick ?? 0) || (reg && (reg.routed || reg.sheltering))) {
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

// Nothing world-gen places (biome seeds, ponds, POI sites) comes closer than this to the Town Center.
const SPAWN_CLEAR_RADIUS_TILES = 15;
// Biome blobs (including edge jitter) never reach within this many tiles of the Town Center, so the
// starting area is always Plains. A seed's own min distance from spawn is therefore
// max(SPAWN_CLEAR_RADIUS_TILES, radius + BIOME_EDGE_JITTER_TILES + this).
const SPAWN_PLAINS_RADIUS_TILES = 6;

let BIOME_SEEDS_PER_KIND = scaledCount(5);
// Plains is meant to be the majority biome (the default colony-building terrain), with Hills and
// Swamp as scattered regional pockets. 14-18 made Hills+Swamp cover ~70% of the map instead;
// 10-13 brings Plains back to roughly half, per the executor's own simulation.
const BIOME_SEED_RADIUS_MIN = 10;
const BIOME_SEED_RADIUS_MAX = 13;
const BIOME_SEED_MIN_SPACING = 12;
const BIOME_EDGE_JITTER_TILES = 3;
const BIOME_NOISE_CELL_TILES = 4;

let POND_COUNT_MIN = scaledCount(8);
let POND_COUNT_MAX = scaledCount(12);
const POND_RADIUS_MIN = 2;
const POND_RADIUS_MAX = 4;
const POND_EDGE_JITTER_TILES = 1;
const POND_NOISE_CELL_TILES = 2;
const POND_MIN_SPACING = 12;

let RUIN_SITE_COUNT_MIN = scaledCountSub(6);
let RUIN_SITE_COUNT_MAX = scaledCountSub(10);
let ENCAMPMENT_SITE_COUNT_MIN = scaledCountSub(6);
let ENCAMPMENT_SITE_COUNT_MAX = scaledCountSub(10);
const POI_SITE_MIN_SPACING = 10;
// Every tile within this Chebyshev radius of a site's center must be Empty before the site is placed.
const POI_SITE_FOOTPRINT_RADIUS = 2;
// ...and there must be no Water within this Chebyshev radius.
const POI_SITE_WATER_CLEARANCE = 3;

const RUIN_CENTERPIECES = [TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch];
const RUIN_EXTRAS = [TileType.RuinStatue, TileType.RuinRubble];
const ENCAMPMENT_EXTRAS = [TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence];
// Skeleton is the most thematic ruin guardian: 60% skeleton, 20% darkShaman, 20% orc.
const RUIN_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "skeleton", weight: 3 },
  { kind: "darkShaman", weight: 1 },
  { kind: "orc", weight: 1 },
];
// Clubman is the rank-and-file guard, Archer the support, Elite a rare mini-boss.
const ENCAMPMENT_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "banditClubman", weight: 5 },
  { kind: "banditArcher", weight: 3 },
  { kind: "banditElite", weight: 1 },
];

// Saint Wren's Abbey: exactly one per world, a 9x9 walled complex, north at the top. H is the hall
// (church art) on the north side of the cloister; S the worn stone statue at the centre of the
// garth; X crosses down the east side (the cemetery); L lantern posts flanking the hall doors and the
// processional path from the south gate (the gap in the fence) up to the statue; F boundary fence;
// "." open ground (left Empty). The resident clergy stand on the row below the hall.
const ABBEY_LAYOUT = [
  "FFFFFFFFF",
  "F.L.H.L.F",
  "F.......F",
  "F......XF",
  "F...S...F",
  "F......XF",
  "F.......F",
  "F..L.L.XF",
  "FFFF.FFFF",
];
const ABBEY_LAYOUT_TILES: Record<string, TileType> = {
  F: TileType.PropFence,
  H: TileType.AbbeyHall,
  S: TileType.RuinStatue,
  X: TileType.PropCross,
  L: TileType.PropLanternPost,
};
const ABBEY_FOOTPRINT_RADIUS = Math.floor(ABBEY_LAYOUT.length / 2);
// The footprint plus a one-tile apron that stays clear of resources/trees so the gate is never blocked.
const ABBEY_GROUNDS_RADIUS = ABBEY_FOOTPRINT_RADIUS + 1;
// Far enough out that the Abbey's permanent ward never reaches the spawn-clear area.
const ABBEY_MIN_SPAWN_DIST = SPAWN_CLEAR_RADIUS_TILES + WARD_RADIUS_TILES;
// "Never fewer than three" keep the Unbroken Watch; offsets from the Abbey's center (the statue).
const ABBEY_CLERGY_OFFSETS: TileCoord[] = [
  { x: -1, y: -2 },
  { x: 0, y: -2 },
  { x: 1, y: -2 },
];

// Center tile of this world's Abbey (null only if world-gen couldn't fit one). Doubles as the
// Abbey's permanent ward source.
let abbeyCenter: TileCoord | null = null;

function isInAbbeyGrounds(tx: number, ty: number): boolean {
  if (!abbeyCenter) return false;
  return Math.max(Math.abs(tx - abbeyCenter.x), Math.abs(ty - abbeyCenter.y)) <= ABBEY_GROUNDS_RADIUS;
}

// World-gen grounds that resource scatter, forage, wildlife and tree regrowth keep off: the Abbey's
// and the Castle Ruin's.
function isInReservedGrounds(tx: number, ty: number): boolean {
  return isInAbbeyGrounds(tx, ty) || isInCastleRuinGrounds(tx, ty);
}

const NEIGHBORS_8: TileCoord[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

// Re-rolled per world so jittered biome/pond edges differ between worlds, but within a world the
// jitter is a fixed function of tile position (stable, no flicker).
let worldNoiseSalt = 0;

function randInt(min: number, max: number): number {
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
    const t = { x: Math.floor(Math.random() * WORLD_TILES_X), y: Math.floor(Math.random() * WORLD_TILES_Y) };
    if (tileDistance(t, TOWN_CENTER_TILE) < minSpawnDist) continue;
    if (avoid.some((o) => tileDistance(o, t) < minSpacing)) continue;
    if (isValid && !isValid(t)) continue;
    return t;
  }
  return null;
}

function generateBiomes() {
  const seeds: { x: number; y: number; radius: number; biome: Biome }[] = [];
  for (let i = 0; i < BIOME_SEEDS_PER_KIND * 2; i++) {
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
  for (let tx = 0; tx < WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
      let nearest: (typeof seeds)[number] | null = null;
      let nearestDist = Infinity;
      for (const seed of seeds) {
        const d = Math.hypot(seed.x - tx, seed.y - ty);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = seed;
        }
      }
      const jitter = edgeJitter(tx, ty, BIOME_NOISE_CELL_TILES, worldNoiseSalt) * BIOME_EDGE_JITTER_TILES;
      biomes[tileIndex(tx, ty)] =
        nearest && nearestDist <= nearest.radius + jitter ? nearest.biome : Biome.Plains;
    }
  }
}

function generatePonds() {
  const count = randInt(POND_COUNT_MIN, POND_COUNT_MAX);
  const centers: TileCoord[] = [];
  for (let i = 0; i < count; i++) {
    const radius = randRange(POND_RADIUS_MIN, POND_RADIUS_MAX);
    const reach = Math.ceil(radius + POND_EDGE_JITTER_TILES);
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + reach,
      POND_MIN_SPACING,
      centers,
      (t) => tiles[tileIndex(t.x, t.y)] === TileType.Empty
    );
    if (!center) continue;
    centers.push(center);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const tx = center.x + dx;
        const ty = center.y + dy;
        if (!inBounds(tx, ty)) continue;
        const idx = tileIndex(tx, ty);
        if (tiles[idx] !== TileType.Empty) continue;
        const jitter = edgeJitter(tx, ty, POND_NOISE_CELL_TILES, worldNoiseSalt + 1) * POND_EDGE_JITTER_TILES;
        if (Math.hypot(dx, dy) <= radius + jitter) tiles[idx] = TileType.Water;
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
      const tile = tiles[tileIndex(tx, ty)] as TileType;
      if (tile === TileType.Water) return false;
      if (inFootprint && tile !== TileType.Empty) return false;
    }
  }
  return true;
}

function spawnGuardian(kind: MobKind, tile: TileCoord, siteId: string, siteKind: PoiSiteKind): Mob {
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
  tiles[tileIndex(center.x, center.y)] = centerpiece;
  for (const offset of shuffled(NEIGHBORS_8).slice(0, extraCount)) {
    const t = { x: center.x + offset.x, y: center.y + offset.y };
    tiles[tileIndex(t.x, t.y)] = extraPool[randInt(0, extraPool.length - 1)];
    decorations.push(t);
  }

  const guardianSpots: TileCoord[] = [];
  for (let dx = -POI_SITE_FOOTPRINT_RADIUS; dx <= POI_SITE_FOOTPRINT_RADIUS; dx++) {
    for (let dy = -POI_SITE_FOOTPRINT_RADIUS; dy <= POI_SITE_FOOTPRINT_RADIUS; dy++) {
      const t = { x: center.x + dx, y: center.y + dy };
      if (tiles[tileIndex(t.x, t.y)] !== TileType.Empty) continue;
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

// ---- Camp hearths (ROADMAP "Camp hearths, soldier population, settlement spacing", 2026-10-28) ----
// Every non-player settlement / camp whose site kind has `hasHearth` gets a destroyable HEARTH on its
// centre tile (the encampment's PropCampfire today), registered by the site stamper (placePoiSite), so a
// future fort / human-settlement kind only needs the flag. Player soldiers, the player and siege engines
// can attack it; hitting it wakes the site's guardians (they defend it). At 0 HP the camp BREAKS: every
// guardian of the site routs (startRout as a "leave" regiment: they flee to the map edge and despawn there
// or after RAID_LEAVE_MAX_TICKS), the hearth tile burns to rubble and the camp's props burn out, a share of
// the camp's stockpile (HEARTH_LOOT_PER_GUARDIAN x garrison) goes to the colony, and campsDestroyed++.
// Destroyed hearths stay in the save (`destroyed`): never respawned, never re-woken.
const SITE_KIND_HAS_HEARTH: Partial<Record<PoiSiteKind, { hasHearth: boolean; hp: number }>> = {
  encampment: { hasHearth: true, hp: 150 },
};
const HEARTH_DEFAULT_HP = 150;
const HEARTH_LOOT_PER_GUARDIAN = { gold: 15, wood: 10, rock: 5, iron: 5 };
// Aggressive-stance soldiers with no enemy in reach go for a standing hearth this close to them.
const HEARTH_AUTO_TARGET_TILES = 8;

interface HearthState {
  siteId: string;
  siteKind: PoiSiteKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  // "bandit" / "orc": the toast's faction word.
  faction: string;
  // Guardians the site was stamped with (scales the loot).
  garrison: number;
}
const hearths = new Map<string, HearthState>();
let campsDestroyed = 0;
// Recent hearth events (testHook "hearthState").
const hearthEvents: Array<{ tick: number; type: string; siteId: string; detail?: string }> = [];

function hearthEvent(siteId: string, type: string, detail?: string) {
  hearthEvents.push({ tick: cycleTick, type, siteId, detail });
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
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TileType.PropCampfire && !claimed.has(i)) campfires.push({ x: i % WORLD_TILES_X, y: Math.floor(i / WORLD_TILES_X) });
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
function damageHearth(h: HearthState, amount: number, attackerKey?: string) {
  if (h.destroyed || amount <= 0) return;
  activateGuardianSite(h.siteId);
  h.hp -= amount;
  hearthEvent(h.siteId, "hit", `${amount.toFixed(1)} ${attackerKey ?? ""}`.trim());
  if (h.hp <= 0) destroyHearth(h, attackerKey);
}

function destroyHearth(h: HearthState, attackerKey?: string) {
  h.destroyed = true;
  h.hp = 0;
  campsDestroyed++;
  const centre = tileToPixelCenter(h);
  // The fire burns out: the hearth tile becomes scorched rubble, the camp's props around it burn away.
  tiles[tileIndex(h.x, h.y)] = TileType.RuinRubble;
  broadcastTileUpdate(h.x, h.y, TileType.RuinRubble);
  pendingEffects.push({ fromX: centre.x, fromY: centre.y, toX: centre.x, toY: centre.y, boulder: true });
  for (const o of NEIGHBORS_8) {
    const x = h.x + o.x;
    const y = h.y + o.y;
    if (!inBounds(x, y) || !ENCAMPMENT_EXTRAS.includes(tiles[tileIndex(x, y)] as TileType)) continue;
    tiles[tileIndex(x, y)] = TileType.Empty;
    broadcastTileUpdate(x, y, TileType.Empty);
    const p = tileToPixelCenter({ x, y });
    pendingEffects.push({ fromX: p.x, fromY: p.y, toX: p.x, toY: p.y, boulder: true });
  }
  // Every guardian of the site breaks: a "leave" rout away from the attackers (or the hearth).
  const members = Array.from(mobs.values()).filter((m) => m.siteId === h.siteId);
  if (members.length > 0) {
    for (const m of members) m.guardianActive = true;
    let reg = regiments.get(h.siteId);
    if (!reg) {
      reg = {
        id: h.siteId, morale: 0, peak: members.length, routed: false, raid: true, homeX: centre.x, homeY: centre.y,
        lastContactTick: cycleTick, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: 0,
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
      m.leaveUntilTick = cycleTick + RAID_LEAVE_MAX_TICKS;
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
function hearthApproachTile(h: HearthState, px: number, py: number): TileCoord | null {
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
  const h = standingHearthAt(tx, ty);
  if (!h) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind)) continue;
    if (!hearthApproachTile(h, c.x, c.y)) continue;
    leaveOrderGroup(c.id);
    sendAgainstHearth(c, h);
  }
}

// The unit's rally moves to the hearth's approach tile and it attacks the hearth (no-op without one).
function sendAgainstHearth(c: Colonist, h: HearthState) {
  const approach = hearthApproachTile(h, c.x, c.y);
  if (!approach) return;
  const p = tileToPixelCenter(approach);
  c.targetHearthId = h.siteId;
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
function hearthStep(c: Colonist, stats: { damage: number; cooldown: number; melee: boolean; range: number; speed: number }, dt: number): boolean {
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
    let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id);
    if (c.kind === "batteringRam") damage *= SIEGE_BUILDING_MULT;
    else if (c.kind === "catapult") damage *= CATAPULT_BUILDING_MULT;
    c.attackCooldownTicks = stats.cooldown;
    pendingEffects.push({ fromX: c.x, fromY: c.y, toX: p.x, toY: p.y, melee: stats.melee, ...(c.kind === "catapult" ? { boulder: true } : {}) });
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

// Saint Wren's Abbey: lays out ABBEY_LAYOUT around a clear spot (grounds + apron all Empty, no
// water) and posts its three resident clergy at the hall. Runs before resources are scattered, so
// the 11x11 clear area is only ever contested by ponds; scatter and tree regrowth then skip the
// grounds (isInReservedGrounds). Adds the Abbey's center to placedSites so later POIs keep their spacing.
function placeAbbey(placedSites: TileCoord[]) {
  const center = pickScatteredTile(ABBEY_MIN_SPAWN_DIST, POI_SITE_MIN_SPACING, placedSites, (t) =>
    poiSiteFootprintClear(t, ABBEY_GROUNDS_RADIUS, ABBEY_GROUNDS_RADIUS)
  );
  if (!center) return;
  abbeyCenter = center;
  placedSites.push(center);
  let hall: TileCoord | null = null;
  for (let ry = 0; ry < ABBEY_LAYOUT.length; ry++) {
    for (let rx = 0; rx < ABBEY_LAYOUT[ry].length; rx++) {
      const tile = ABBEY_LAYOUT_TILES[ABBEY_LAYOUT[ry][rx]];
      if (tile === undefined) continue;
      const t = { x: center.x + rx - ABBEY_FOOTPRINT_RADIUS, y: center.y + ry - ABBEY_FOOTPRINT_RADIUS };
      tiles[tileIndex(t.x, t.y)] = tile;
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

// ---- The Castle Ruin, its Ogre Warlord, and mini-boss packs (ROADMAP Phase 5) ----
// The Castle Ruin: exactly one per world, a 9x9 walled ruin (existing ruin tiles, no new art) placed
// as far from the starting Town Center as world-gen can manage. Gaps in the middle of each wall let
// units in and out. Its guardians stand inside, dormant; the Ogre Warlord holds the centre ("B").
// 1/2 ruin walls, A arch, S statue, R rubble, "." open ground (Empty).
const CASTLE_RUIN_LAYOUT = [
  "12A1.1A21",
  "2.......2",
  "A..R.R..A",
  "1.S...S.1",
  "....B....",
  "1.S...S.1",
  "A..R.R..A",
  "2.......2",
  "12A1.1A21",
];
const CASTLE_RUIN_LAYOUT_TILES: Record<string, TileType> = {
  "1": TileType.RuinWall1,
  "2": TileType.RuinWall2,
  A: TileType.RuinArch,
  S: TileType.RuinStatue,
  R: TileType.RuinRubble,
};
const CASTLE_RUIN_FOOTPRINT_RADIUS = Math.floor(CASTLE_RUIN_LAYOUT.length / 2);
// The footprint plus a one-tile apron kept clear (like the Abbey's), so the gates are never blocked.
const CASTLE_RUIN_GROUNDS_RADIUS = CASTLE_RUIN_FOOTPRINT_RADIUS + 1;
// Preferred minimum distances from the Town Center, as fractions of the map width, tried in order
// (a crowded or small map falls back to the next); last resort is just clear of the spawn area.
const CASTLE_RUIN_SPAWN_DIST_FRACTIONS = [0.4, 0.33, 0.25];
const CASTLE_RUIN_GUARDIANS_MIN = 8;
const CASTLE_RUIN_GUARDIANS_MAX = 12;
// Ruin-weighted, with heavier hitters than an ordinary ruin.
const CASTLE_RUIN_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "skeleton", weight: 4 },
  { kind: "orc", weight: 2 },
  { kind: "armoredOrc", weight: 2 },
  { kind: "darkShaman", weight: 2 },
];
const WARLORD_HP_MULT = 4.5;
const WARLORD_DAMAGE_MULT = 2;
// On top of the usual goldForKill.
const WARLORD_REWARD: Partial<Record<ResourceKey, number>> = { gold: 250, wood: 150, rock: 150, iron: 100 };

// Mini-bosses: standalone packs of one kind, an upscaled elite plus 2-4 ordinary followers.
let MINI_BOSS_SITE_COUNT_MIN = Math.max(1, scaledCountSub(0.75));
let MINI_BOSS_SITE_COUNT_MAX = Math.max(1, scaledCountSub(1.25));
const MINI_BOSS_KINDS: MobKind[] = ["wolf", "orc", "skeleton", "giantSpider", "armoredOrc", "troll"];
const ELITE_HP_MULT = 2.5;
const ELITE_DAMAGE_MULT = 1.5;
const ELITE_REWARD: Partial<Record<ResourceKey, number>> = { gold: 60, wood: 40, iron: 30 };

// Centre tile of this world's Castle Ruin (null only if world-gen couldn't fit one, or an old save).
let castleRuinCenter: TileCoord | null = null;

function isInCastleRuinGrounds(tx: number, ty: number): boolean {
  if (!castleRuinCenter) return false;
  return Math.max(Math.abs(tx - castleRuinCenter.x), Math.abs(ty - castleRuinCenter.y)) <= CASTLE_RUIN_GROUNDS_RADIUS;
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
    center = pickScatteredTile(Math.floor(WORLD_TILES_X * fraction), spacing, placedSites, fits);
    if (center) break;
  }
  center ??= pickScatteredTile(SPAWN_CLEAR_RADIUS_TILES + CASTLE_RUIN_GROUNDS_RADIUS, spacing, placedSites, fits);
  if (!center) return;
  castleRuinCenter = center;
  placedSites.push(center);
  const siteId = randomUUID();
  const open: TileCoord[] = [];
  for (let ry = 0; ry < CASTLE_RUIN_LAYOUT.length; ry++) {
    for (let rx = 0; rx < CASTLE_RUIN_LAYOUT[ry].length; rx++) {
      const t = { x: center.x + rx - CASTLE_RUIN_FOOTPRINT_RADIUS, y: center.y + ry - CASTLE_RUIN_FOOTPRINT_RADIUS };
      const tile = CASTLE_RUIN_LAYOUT_TILES[CASTLE_RUIN_LAYOUT[ry][rx]];
      if (tile !== undefined) tiles[tileIndex(t.x, t.y)] = tile;
      // Guardians stand on the open ground inside the walls (not in the gate gaps, not on the boss).
      else if (CASTLE_RUIN_LAYOUT[ry][rx] === "." && rx > 0 && ry > 0 && rx < CASTLE_RUIN_LAYOUT.length - 1 && ry < CASTLE_RUIN_LAYOUT.length - 1) open.push(t);
    }
  }
  makeBoss(spawnGuardian("ogre", center, siteId, "castleRuin"), "warlord");
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
    makeBoss(spawnGuardian(kind, center, siteId, "miniBoss"), "elite");
    for (const offset of shuffled(NEIGHBORS_8).slice(0, randInt(2, 4))) {
      spawnGuardian(kind, { x: center.x + offset.x, y: center.y + offset.y }, siteId, "miniBoss");
    }
  }
}

// Set when the Ogre Warlord dies; the goal track's final goal reads it. Saved.
let castleCleared = false;

function onBossKilled(mob: Mob) {
  const title = bossTitle(mob.kind, mob.boss!);
  if (mob.boss === "warlord") {
    castleCleared = true;
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

// ---- Goal track (ROADMAP Phase 5) ----
// One shared, ordered track per world. Only the current goal is checked (once a second, plus right
// after the Warlord dies); when it's met the colony gets its reward, a "milestone" toast, and the next
// goal becomes current (several can complete in one check, e.g. a night milestone already passed).
interface GoalDef {
  title: string;
  progress: () => { progress: number; target: number };
  reward: Partial<Record<ResourceKey, number>>;
}

const GOAL_WORKER_KINDS = new Set<ColonistKind>([
  "lumberjack", "farmer", "ironMiner", "rockMiner", "farmhand", "artisan", "hunter", "forager",
]);

// Dawns since the world began (cycle 0 starts at dawn, so day N's dawn is cycleTick N * cycle).
function nightsSurvived(): number {
  return Math.floor(cycleTick / GAME_DAY_TICKS);
}

// Any player-placed structure: a queued construction, a built building (Town Centers beyond the
// starting one count), or a wall.
function anyPlayerBuilding(): boolean {
  if (constructionSites.size > 0 || townCenters.length > 1) return true;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as TileType;
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
  { title: "Clear the Castle Ruin", progress: () => flagGoal(castleCleared), reward: { gold: 100 } },
];

let goalIndex = 0;
let goalSnapshot: GoalSnapshot = { index: 0, total: GOALS.length, title: GOALS[0].title, progress: 0, target: 1 };

function refreshGoalSnapshot(progress?: { progress: number; target: number }) {
  if (goalIndex >= GOALS.length) {
    goalSnapshot = { index: GOALS.length, total: GOALS.length, title: "Every goal complete", progress: 1, target: 1 };
    return;
  }
  const p = progress ?? GOALS[goalIndex].progress();
  goalSnapshot = { index: goalIndex, total: GOALS.length, title: GOALS[goalIndex].title, ...p };
}

// silent: catch up without rewards or toasts (an old save loaded with no goal state).
function evaluateGoals(silent = false) {
  while (goalIndex < GOALS.length) {
    const goal = GOALS[goalIndex];
    const p = goal.progress();
    if (p.progress < p.target) {
      refreshGoalSnapshot(p);
      return;
    }
    goalIndex++;
    if (silent) continue;
    grantReward(goal.reward);
    const final = goalIndex === GOALS.length;
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
  goalIndex = 0;
  castleCleared = false;
  campsDestroyed = 0;
  refreshGoalSnapshot(flagGoal(false));
}

// ---- Fog of war (minimap only) ----
// Explored tiles, shared by every player and kept for the life of the world. Sources only reveal
// when their tile changes (or a building lands), stamping a precomputed circle; nothing ever scans
// the whole map per tick.
let explored = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y);
// Newly explored tile indices awaiting the next batched `explored` broadcast.
let pendingExplored: number[] = [];
const EXPLORED_FLUSH_TICKS = 5; // 4 Hz at TICK_RATE 20
let exploredFlushCountdown = EXPLORED_FLUSH_TICKS;
// Tile index each player/colonist last revealed from. Replaced on world reset so everyone re-stamps.
let visionTile = new WeakMap<object, number>();

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
const START_VISION_OFFSETS = circleOffsets(VISION_RADIUS_START);

// Player-built structures that see (walls don't), plus the Town Center. Natural terrain, POI
// props and the Abbey never do.
const VISION_BUILDING_TILES = new Set<TileType>([
  TileType.TownCenter,
  TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.BarnPost, TileType.LumberjackPost,
  TileType.FarmPlot, TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3, TileType.ArcherPost,
  TileType.Tower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost, TileType.Pasture,
  TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop, TileType.Blacksmith,
  TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery, TileType.Tavern,
  TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
  TileType.HunterHut, TileType.ForagerHut, TileType.BuildersGuild, TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
]);

function revealAround(tx: number, ty: number, offsets: Array<[number, number]>) {
  for (const [dx, dy] of offsets) {
    const x = tx + dx;
    const y = ty + dy;
    if (x < 0 || y < 0 || x >= WORLD_TILES_X || y >= WORLD_TILES_Y) continue;
    const index = y * WORLD_TILES_X + x;
    if (explored[index]) continue;
    explored[index] = 1;
    pendingExplored.push(index);
  }
}

function revealFrom(source: object, px: number, py: number, offsets: Array<[number, number]>) {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const index = ty * WORLD_TILES_X + tx;
  if (visionTile.get(source) === index) return;
  visionTile.set(source, index);
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
  explored.fill(0);
  visionTile = new WeakMap();
  revealAround(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y, START_VISION_OFFSETS);
  // The fresh world reaches clients whole, in `welcome`.
  pendingExplored = [];
}

function packExplored(): string {
  const bytes = new Uint8Array(Math.ceil(explored.length / 8));
  for (let i = 0; i < explored.length; i++) {
    if (explored[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

function flushExplored() {
  if (--exploredFlushCountdown > 0) return;
  exploredFlushCountdown = EXPLORED_FLUSH_TICKS;
  if (pendingExplored.length === 0) return;
  const message: ServerMessage = { type: "explored", tiles: pendingExplored };
  pendingExplored = [];
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
  if (size === WORLD_TILES_X) return;
  WORLD_TILES_X = WORLD_TILES_Y = size;
  WORLD_AREA_SCALE = (size * size) / (80 * 80);
  worldWidth = size * TILE_SIZE;
  worldHeight = size * TILE_SIZE;
  const cells = size * size;
  tiles = new Uint8Array(cells).fill(TileType.Empty);
  biomes = new Uint8Array(cells).fill(Biome.Plains);
  explored = new Uint8Array(cells);
  cellHead = new Int32Array(cells);
  routeCost = new Float64Array(cells);
  routeParent = new Int32Array(cells);
  TOWN_CENTER_TILE.x = TOWN_CENTER_TILE.y = Math.floor(size / 2);
  TREE_COUNT = scaledCount(96);
  IRON_ORE_COUNT = scaledCount(56);
  ROCK_COUNT = scaledCount(64);
  MAX_TREES = scaledCount(200);
  BERRY_BUSH_COUNT = scaledCount(24);
  FRUIT_TREE_COUNT = scaledCount(12);
  MUSHROOM_PATCH_COUNT = scaledCount(10);
  WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCountSub(4));
  WILDLIFE_CONFIG.deer.cap = scaledCountSub(6);
  WILDLIFE_CONFIG.rabbit.cap = scaledCountSub(8);
  WILDLIFE_CONFIG.boar.cap = scaledCountSub(3);
  WILDLIFE_CONFIG.pheasant.cap = scaledCountSub(4);
  BIOME_SEEDS_PER_KIND = scaledCount(5);
  POND_COUNT_MIN = scaledCount(8);
  POND_COUNT_MAX = scaledCount(12);
  RUIN_SITE_COUNT_MIN = scaledCountSub(6);
  RUIN_SITE_COUNT_MAX = scaledCountSub(10);
  ENCAMPMENT_SITE_COUNT_MIN = scaledCountSub(6);
  ENCAMPMENT_SITE_COUNT_MAX = scaledCountSub(10);
  MINI_BOSS_SITE_COUNT_MIN = Math.max(1, scaledCountSub(0.75));
  MINI_BOSS_SITE_COUNT_MAX = Math.max(1, scaledCountSub(1.25));
}

function generateWorld() {
  const genStart = performance.now();
  tiles.fill(TileType.Empty);
  biomes.fill(Biome.Plains);
  worldNoiseSalt = Math.floor(Math.random() * 0x7fffffff);
  abbeyCenter = null;
  castleRuinCenter = null;
  hearths.clear();
  resetGoals();
  tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;
  townCenters = [{ x: TOWN_CENTER_TILE.x, y: TOWN_CENTER_TILE.y, level: 1, hp: townCenterMaxHp(1) }];
  generateBiomes();
  generatePonds();
  const placedSites: TileCoord[] = [];
  placeAbbey(placedSites);
  placeCastleRuin(placedSites);
  scatterResourceTiles(TileType.Tree, TREE_COUNT);
  scatterResourceTiles(TileType.IronOre, IRON_ORE_COUNT);
  scatterResourceTiles(TileType.Rock, ROCK_COUNT);
  generateForage();
  generatePoiSites("ruin", randInt(RUIN_SITE_COUNT_MIN, RUIN_SITE_COUNT_MAX), placedSites);
  generatePoiSites("encampment", randInt(ENCAMPMENT_SITE_COUNT_MIN, ENCAMPMENT_SITE_COUNT_MAX), placedSites);
  generateMiniBossSites(randInt(MINI_BOSS_SITE_COUNT_MIN, MINI_BOSS_SITE_COUNT_MAX), placedSites);
  spawnInitialWildlife();
  resetExplored();
  topUpTownCenterBuilders(townCenters[0]);
  console.log(`[world] generated ${WORLD_TILES_X}x${WORLD_TILES_Y} in ${(performance.now() - genStart).toFixed(0)} ms`);
}

generateWorld();

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6];
let nextColorIndex = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function broadcastTileUpdate(tx: number, ty: number, tile: TileType) {
  buildingTargetsDirty = true;
  gateTilesDirty = true;
  if (VISION_BUILDING_TILES.has(tile)) revealAround(tx, ty, BUILDING_VISION_OFFSETS);
  const update: ServerMessage = { type: "tileUpdate", tileX: tx, tileY: ty, tile };
  const payload = JSON.stringify(update);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

function broadcastEvent(category: GameEventCategory, text: string) {
  const event: ServerMessage = { type: "event", category, text };
  const payload = JSON.stringify(event);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}


// COLONY_TEST_HOOKS=1 enables the "testHook" client message for scripted tests (server/*.mjs):
// time travel, raid-state dumps, direct mob damage and tick timing. Off by default: never needed
// by (or reachable from) the real client.
const TEST_HOOKS = process.env.COLONY_TEST_HOOKS === "1";
// Overrides spawnRaid's DESERTER_WAVE_CHANCE roll when set (testHook "forceDeserterRoll").
let testForceDeserterRoll: boolean | null = null;
// When true, spawnRaid gives every group aggroTick = nightfall (testHook "holdRaidAggro"), so a test
// can inspect passive groups without a random early aggro racing it.
let testHoldRaidAggro = false;
// testHook "setRaids" {enabled:false} skips the midday raid spawn of every day that passes while it is
// off (economy tests fast-forward days).
let testRaidsDisabled = false;
// testHook "ignorePlayers" {value:true}: mobs never target players (so a test client standing in the
// world doesn't draw every mob away from the buildings).
let testPlayersIgnored = false;
const tickDurationsMs: number[] = [];
const TICK_DURATION_SAMPLES = 400;

function handleTestHook(player: Player, msg: Record<string, unknown>) {
  const reply = (data: Record<string, unknown>) =>
    player.socket.send(JSON.stringify({ type: "testHookResult", op: msg.op, ...data }));
  if (msg.op === "setCycleTick" && typeof msg.tick === "number") {
    cycleTick = Math.max(0, Math.floor(msg.tick));
    wasNight = isNightNow();
    reply({ cycleTick });
  } else if (msg.op === "raidState") {
    reply({
      cycleTick,
      dayTicks: DAY_TICKS,
      nightTicks: NIGHT_TICKS,
      worldTiles: WORLD_TILES_X,
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
    testForceDeserterRoll = typeof msg.value === "boolean" ? msg.value : null;
    reply({ value: testForceDeserterRoll });
  } else if (msg.op === "holdRaidAggro") {
    testHoldRaidAggro = msg.value === true;
    reply({ value: testHoldRaidAggro });
  } else if (msg.op === "raidDepartNow") {
    // Every group leaves immediately (raid-timing test: forces early arrivals, which must pause).
    for (const g of raidGroups.values()) g.aggroTick = Math.min(g.aggroTick, cycleTick);
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
        deserterSinceTick: cycleTick - DESERTER_ACTIVATION_TICKS,
      });
      ids.push(mob.id);
    }
    reply({ ids });
  } else if (msg.op === "fastForward" && typeof msg.ticks === "number") {
    // Runs whole simulation ticks back to back (no snapshots in between), up to 200000 per call.
    const n = Math.max(0, Math.min(200000, Math.floor(msg.ticks)));
    for (let i = 0; i < n; i++) stepSimulation();
    pendingEffects = [];
    reply({ cycleTick });
  } else if (msg.op === "setRaids") {
    testRaidsDisabled = msg.enabled === false;
    reply({ enabled: !testRaidsDisabled });
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
      happiness: colonyHappiness,
    });
  } else if (msg.op === "wildlifeState") {
    reply({
      animals: Array.from(wildlife.values()).map((a) => ({ ...a })),
      config: WILDLIFE_CONFIG,
      forage: {
        ripe: tiles.reduce((n, t) => n + (FORAGE_RIPE_TO_PICKED[t as TileType] !== undefined ? 1 : 0), 0),
        picked: tiles.reduce((n, t) => n + (FORAGE_PICKED_TO_RIPE[t as TileType] !== undefined ? 1 : 0), 0),
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
      cycleTick,
    });
  } else if (msg.op === "spawnWildlife" && typeof msg.kind === "string" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    const kind = msg.kind as WildlifeKind;
    if (!WILDLIFE_KINDS.includes(kind) || !inBounds(msg.tx, msg.ty)) {
      reply({ id: null });
    } else {
      reply({ id: spawnWildlifeAt(kind, msg.tx, msg.ty).id });
    }
  } else if (msg.op === "setWildlifeRespawn") {
    testWildlifeRespawnDisabled = msg.enabled === false;
    reply({ enabled: !testWildlifeRespawnDisabled });
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
      tiles[tileIndex(msg.tx, msg.ty)] = msg.tile;
      broadcastTileUpdate(msg.tx, msg.ty, msg.tile as TileType);
    }
    reply({ tile: tiles[tileIndex(msg.tx, msg.ty)] });
  } else if (msg.op === "placeTownCenter" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // A new Town Center at the tile, no placement rules or builders' work (regiment-groups-test).
    if (inBounds(msg.tx, msg.ty) && !findTownCenterAt(msg.tx, msg.ty)) resolveTownCenterPlacement(msg.tx, msg.ty);
    reply({ townCenters: townCenters.map((t) => ({ ...t })) });
  } else if (msg.op === "forceMarkChance") {
    testForceMarkChance = typeof msg.value === "number" ? msg.value : null;
    reply({ value: testForceMarkChance });
  } else if (msg.op === "spawnMob" && typeof msg.kind === "string" && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // An already-released (non-raid) mob at a tile, optionally Hunger-marked.
    if (!(msg.kind in MOB_KIND_CONFIG) || !inBounds(msg.tx, msg.ty)) {
      reply({ id: null });
    } else {
      const mob = createRaidMob(msg.kind as MobKind, { x: msg.tx, y: msg.ty }, "");
      mob.groupId = null;
      mob.passive = false;
      if (typeof msg.mark === "number" && msg.mark >= HungerMark.Gorrath && msg.mark <= HungerMark.Vhorrun) applyHungerMark(mob, msg.mark);
      // Monster tactics: optional regiment (raid-style) or an awake site guardian (siteId).
      if (typeof msg.regimentId === "string") mob.regimentId = msg.regimentId;
      if (typeof msg.siteId === "string") Object.assign(mob, { siteId: msg.siteId, siteKind: "encampment", guardianActive: true });
      // Hero phases 1-2: optional boss tier ("warlord" / "elite").
      if (msg.boss === "warlord" || msg.boss === "elite") makeBoss(mob, msg.boss);
      reply({ id: mob.id, mark: mob.mark, hp: mob.hp, maxHp: mob.maxHp, damage: mob.damage });
    }
  } else if (msg.op === "spawnRaidGroup" && Array.isArray(msg.kinds) && typeof msg.tx === "number" && typeof msg.ty === "number") {
    // A raid group already in contact (engaged now): member i is on row i, so the rows release one by
    // one (RAID_RELEASE_ROW_TICKS apart) and some are still in the group early on.
    const id = randomUUID();
    const group: RaidGroup = {
      id, faction: "greenskinWarband", isHorde: false, edge: "west", memberIds: [], homes: new Map(), aggroTick: 0,
      state: "marching", leaderId: null, offsets: new Map(), repathCooldown: 0, headingX: 1, headingY: 0,
      engagedTick: cycleTick, anchorX: tileToPixelCenter({ x: msg.tx, y: msg.ty }).x, anchorY: tileToPixelCenter({ x: msg.tx, y: msg.ty }).y,
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
    testForceRaidSiege = msg.value === true;
    reply({ value: testForceRaidSiege });
  } else if (msg.op === "spawnRaidNow" && typeof msg.dayIndex === "number") {
    spawnRaid(Math.max(0, Math.floor(msg.dayIndex)));
    reply({ groups: raidGroups.size, caps: Object.fromEntries(SIEGE_KINDS.map((k) => [k, raidSiegeCap(Math.floor(msg.dayIndex as number), k)])) });
  } else if (msg.op === "siegeState") {
    reply({
      cycleTick,
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
    testMoraleFrozen = msg.freezeMorale === true;
    reply({ freezeMorale: testMoraleFrozen });
  } else if (msg.op === "tacticsState") {
    reply({
      cycleTick,
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
  } else if (msg.op === "setColonistHp" && typeof msg.id === "string" && typeof msg.hp === "number") {
    const c = colonists.get(msg.id);
    if (c) c.hp = Math.max(1, Math.min(c.maxHp, msg.hp));
    reply({ found: !!c, hp: c?.hp ?? null });
  } else if (msg.op === "setInstantBuild") {
    instantBuild = msg.enabled === true;
    reply({ enabled: instantBuild });
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
    reply({ found: !!tc, townCenters: townCenters.map((t) => ({ ...t })) });
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
      townCenters: townCenters.map((t) => ({ ...t })),
      productionSpeedMultiplier: productionSpeedMultiplier(),
      happinessSpeedMultiplier: happinessSpeedMultiplier(),
      armyBonus: townCenterBonus(),
      populationCap: populationCap(),
      instantBuild,
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
      cycleTick,
      colonists: Array.from(colonists.values())
        .filter((c) => isGuardOrMilitiaKind(c.kind))
        .map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, state: c.state, rallyX: c.rallyX, rallyY: c.rallyY, targetMobId: c.targetMobId, hp: c.hp })),
      mobs: Array.from(mobs.values()).map((m) => ({
        id: m.id, kind: m.kind, x: m.x, y: m.y, groupId: m.groupId, targetType: m.targetType, targetId: m.targetId, hp: m.hp,
      })),
      slots: Array.from(attackerSlots),
    });
  } else if (msg.op === "ignorePlayers") {
    testPlayersIgnored = msg.value === true;
    reply({ value: testPlayersIgnored });
  } else if (msg.op === "damageBuilding" && typeof msg.tx === "number" && typeof msg.ty === "number" && typeof msg.amount === "number") {
    damageBuilding(msg.tx, msg.ty, msg.amount);
    reply({ hp: structureHp(msg.tx, msg.ty), tile: tiles[tileIndex(msg.tx, msg.ty)] });
  } else if (msg.op === "gateState") {
    // Walls & gates: every gate's state and HP; checkOverrun runs the overrun evaluation right now.
    if (msg.checkOverrun === true) {
      gateTilesDirty = true;
      updateGates(true);
    }
    reply({
      gates: Array.from(gates, ([index, g]) => {
        const x = index % WORLD_TILES_X;
        const y = Math.floor(index / WORLD_TILES_X);
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
      spellTick,
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
    testTomeChance = typeof msg.tomeChance === "number" ? msg.tomeChance : null;
    if (msg.resetCooldowns === true) spellCooldowns.clear();
    reply({ tomeChance: testTomeChance });
  } else if (msg.op === "spawnHero" && HERO_CLASSES.includes(msg.heroClass as HeroClass) && typeof msg.x === "number" && typeof msg.y === "number") {
    // A hero standing at pixel (x, y), posted on that tile (no Keep), without recruiting.
    const tile = tileOfPixel(msg.x, msg.y);
    const c = spawnHeroColonist(randomUUID(), pickHeroName(), msg.heroClass as HeroClass, tile.x, tile.y);
    Object.assign(c, { x: msg.x, y: msg.y, rallyTileX: tile.x, rallyTileY: tile.y, rallyX: msg.x, rallyY: msg.y });
    if (typeof msg.stance === "string" && STANCES.includes(msg.stance as Stance)) c.stance = msg.stance as Stance;
    reply({ id: c.id });
  } else if (msg.op === "heroConfig") {
    testRelicChance = typeof msg.relicChance === "number" ? msg.relicChance : null;
    reply({ relicChance: testRelicChance });
  } else if (msg.op === "equipConfig") {
    testEquipDropChance = typeof msg.dropChance === "number" ? msg.dropChance : null;
    reply({ dropChance: testEquipDropChance });
  } else if (msg.op === "damageColonist" && typeof msg.id === "string" && typeof msg.amount === "number") {
    const c = colonists.get(msg.id);
    const before = c?.hp ?? null;
    if (c) damageColonist(c, msg.amount);
    reply({ found: !!c, before, after: c ? c.hp : null });
  } else if (msg.op === "hearthState") {
    // Camp hearths: every hearth with its site's living guardians, the counter and recent events.
    reply({
      campsDestroyed,
      events: hearthEvents.slice(),
      hearths: Array.from(hearths.values()).map((h) => ({
        ...h,
        tile: tiles[tileIndex(h.x, h.y)],
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
      goalIndex,
      goal: goalSnapshot,
      goalTitles: GOALS.map((g) => g.title),
      castleCleared,
      campsDestroyed,
      castleRuinCenter,
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
    reply({ cycleTick, hits: fightHits.length, fights: activeFights.map((f) => ({ ...f, playerIds: Array.from(f.playerIds) })), mine: fightsForPlayer(player) });
  } else if (msg.op === "buildingState") {
    // Building HP / repair state, builders, and every mob's target (with its approach tile).
    reply({
      buildingHp: Array.from(buildingHp),
      repairPaid: Array.from(repairPaid),
      repairQueue,
      damagedBuildings: damagedBuildingsForSnapshot(),
      stock: { ...stock },
      cycleTick,
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
    for (let i = 0; i < tiles.length; i++) {
      if (!isTowerTile(tiles[i] as TileType)) continue;
      const x = i % WORLD_TILES_X;
      const y = Math.floor(i / WORLD_TILES_X);
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
      cycleTick,
    });
  } else if (msg.op === "respawnState") {
    // Long days & dawn/dusk respawn windows (day-respawn-test).
    reply({
      cycleTick,
      isNight: isNightNow(),
      queue: respawnQueue.map((q) => ({ ...q })),
      respawn: respawnWindowSnapshot(),
      window: respawnWindowAt(cycleTick),
      duskTick: DUSK_RESPAWN_CYCLE_TICK,
      wardPriestRespawnTicks,
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

// PORT lets a scripted test run a private server without touching the shared :8080 world.
const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 8080;
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
    worldTilesX: WORLD_TILES_X,
    worldTilesY: WORLD_TILES_Y,
    tiles: Array.from(tiles),
    biomes: Array.from(biomes),
    explored: packExplored(),
    difficulty,
    castleRuin: castleRuinCenter,
  };
  player.socket.send(JSON.stringify(welcome));
}

function resetWorld(nextDifficulty?: unknown, nextSize?: unknown) {
  // A restart reopens the difficulty claim; a value sent with the restart claims it straight away.
  difficultyClaimed = false;
  if (isDifficulty(nextDifficulty)) {
    difficulty = nextDifficulty;
    difficultyClaimed = true;
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
  buildingTargetsDirty = true;
  reservedResourceTiles.clear();
  taskForces.clear();
  taskForceMax.clear();
  clearOrderGroups();
  wardStonesActiveLastTick.clear();
  wardStoneLastTended.clear();
  gravestones.length = 0;
  wardPriestId = null;
  wardPriestTendTicks = 0;
  wardPriestRespawnTicks = -1;
  pendingEffects = [];
  // Hero phase 4: statuses, cooldowns and summons are transient.
  clearSpellState();

  Object.assign(stock, initialStock());
  resetEquipment();
  heroProfiles.clear();
  heroRecruits.length = 0;
  heroRosterVersion++;
  marketBuilt = false;
  goldShopBuilt = false;
  colonyHappiness = 100;

  constructionSites.clear();
  gates.clear();
  gateTilesDirty = true;
  mobsWithoutRoute.clear();

  cycleTick = 0;
  wasNight = false;
  raidGroups.clear();
  regiments.clear();
  walledSites.clear();
  raidSpawnedForDay = -1;
  treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;
  lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;
  isPaused = false;

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

// ---- Save files ----
// One JSON file per slot under server/saves/ (or COLONY_SAVE_DIR). snapshotWorld captures every piece
// of module state that defines the world; applyWorld writes it back IN PLACE (the const Maps/Sets/
// arrays/typed arrays are cleared and refilled, so nothing that holds a reference to them goes stale).
// Not saved: player sessions (connected players respawn at a Town Center, as after a restart),
// pendingEffects / pendingExplored / visionTile (per-tick transients) and client-only blood.
const SAVE_VERSION = 1;
const SAVE_SLOT_LABELS: Record<SaveSlot, string> = { autosave: "Autosave", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3" };
const SAVE_DIR = process.env.COLONY_SAVE_DIR
  ? path.resolve(process.env.COLONY_SAVE_DIR)
  : fileURLToPath(new URL("../saves/", import.meta.url));
// A scripted test server (test hooks on) must never clobber the real world's autosave, so with test
// hooks it only autosaves into a COLONY_SAVE_DIR of its own.
const AUTOSAVE_ENABLED = !TEST_HOOKS || !!process.env.COLONY_SAVE_DIR;
// A freshly booted server's unattended world must not overwrite the last real autosave: autosaves
// (dawn + shutdown) only start once a player has connected.
let anyPlayerSinceBoot = false;
// Set by the dawn hook inside stepSimulation; the tick loop runs the save once, outside fastForward.
let autosaveDue = false;
// Saves/loads run one at a time, queued in request order (a load asked for while the dawn autosave
// is still writing just waits a few ms). A load also holds the simulation while the file is read.
let saveLoadQueue: Promise<unknown> = Promise.resolve();
let autosaveQueued = false;
let simHeldForLoad = false;

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = saveLoadQueue.then(fn, fn);
  saveLoadQueue = run.catch(() => undefined);
  return run;
}

interface SaveFile {
  version: number;
  savedAt: string;
  dayIndex: number;
  population: number;
  difficulty: Difficulty;
  worldSize: number;
  label: string;
  state: WorldState;
}
type WorldState = ReturnType<typeof snapshotWorld>;

function isSaveSlot(value: unknown): value is SaveSlot {
  return typeof value === "string" && (SAVE_SLOTS as string[]).includes(value);
}

function savePath(slot: SaveSlot): string {
  return path.join(SAVE_DIR, `${slot}.json`);
}

// Plain-object view of the world. Serialized right away (JSON.stringify), so live objects are
// referenced rather than copied. Raid groups' Maps become entry arrays.
function snapshotWorld() {
  return {
    tiles: Buffer.from(tiles).toString("base64"),
    biomes: Buffer.from(biomes).toString("base64"),
    explored: packExplored(),
    worldNoiseSalt,
    abbeyCenter,
    castleRuinCenter,
    goals: { goalIndex, castleCleared, campsDestroyed },
    hearths: Array.from(hearths.values()),
    stock: { ...stock },
    // Armour & weapons (forge queues are not saved: a load starts every Blacksmith idle).
    equipment: { armour: [...equipment.armour], weapon: [...equipment.weapon] },
    // Hero phases 1-2: every player profile (gear, inventory, XP).
    heroProfiles: serializeHeroProfiles() as unknown,
    // Hero phase 3: heroes still being recruited (the heroes themselves are colonists / respawn entries).
    heroRecruits: heroRecruits.map((r) => ({ ...r })),
    marketBuilt,
    goldShopBuilt,
    colonyHappiness,
    difficulty,
    cycleTick,
    // Long days: the cycle this cycleTick was counted in (saves without it are the old 1200 + 800).
    dayTicks: DAY_TICKS as number,
    nightTicks: NIGHT_TICKS as number,
    wasNight,
    raidSpawnedForDay,
    treeRespawnCooldown,
    lumberjackTreeGrowCooldown,
    wildlifeRespawnCooldown,
    nextWildlifeId,
    wardPriestId,
    wardPriestTendTicks,
    wardPriestRespawnTicks,
    townCenters,
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
      testForceDeserterRoll,
      testHoldRaidAggro,
      testRaidsDisabled,
      testWildlifeRespawnDisabled,
      testForceMarkChance,
      instantBuild,
      testPlayersIgnored,
    },
  };
}

function refill<K, V>(map: Map<K, V>, entries: [K, V][]) {
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
}

function applyWorld(s: WorldState) {
  tiles.set(Buffer.from(s.tiles, "base64"));
  biomes.set(Buffer.from(s.biomes, "base64"));
  const bits = Buffer.from(s.explored, "base64");
  for (let i = 0; i < explored.length; i++) explored[i] = (bits[i >> 3] >> (i & 7)) & 1;
  worldNoiseSalt = s.worldNoiseSalt;
  abbeyCenter = s.abbeyCenter;
  // `?? null` / missing `goals`: saves from before Phase 5 have no Castle Ruin, and their goal track
  // catches up silently (below, once the rest of the world is in place).
  castleRuinCenter = s.castleRuinCenter ?? null;
  goalIndex = s.goals?.goalIndex ?? 0;
  castleCleared = s.goals?.castleCleared ?? false;
  campsDestroyed = s.goals?.campsDestroyed ?? 0;
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
  heroRosterVersion++;
  marketBuilt = s.marketBuilt;
  goldShopBuilt = s.goldShopBuilt;
  colonyHappiness = s.colonyHappiness;
  difficulty = s.difficulty;
  // The loaded world's difficulty is settled: joining clients' setDifficulty must not override it.
  difficultyClaimed = true;
  cycleTick = s.cycleTick;
  wasNight = s.wasNight;
  raidSpawnedForDay = s.raidSpawnedForDay;
  treeRespawnCooldown = s.treeRespawnCooldown;
  lumberjackTreeGrowCooldown = s.lumberjackTreeGrowCooldown;
  wildlifeRespawnCooldown = s.wildlifeRespawnCooldown;
  nextWildlifeId = s.nextWildlifeId;
  wardPriestId = s.wardPriestId;
  wardPriestTendTicks = s.wardPriestTendTicks;
  wardPriestRespawnTicks = s.wardPriestRespawnTicks;
  townCenters = s.townCenters;
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
  buildingTargetsDirty = true;
  refill(taskForces, s.taskForces);
  taskForceMax.clear();
  clearOrderGroups();
  refill(reservedResourceTiles, s.reservedResourceTiles);
  refill(wardStoneLastTended, s.wardStoneLastTended);
  wardStonesActiveLastTick.clear();
  for (const key of s.wardStonesActiveLastTick) wardStonesActiveLastTick.add(key);
  gravestones.length = 0;
  gravestones.push(...s.gravestones);
  refill(constructionSites, s.constructionSites);
  // `?? []`: saves from before gates (none on the map); gate tiles without a record start closed / auto.
  refill(gates, s.gates ?? []);
  gateTilesDirty = true;
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
  testForceDeserterRoll = s.flags.testForceDeserterRoll;
  testHoldRaidAggro = s.flags.testHoldRaidAggro;
  testRaidsDisabled = s.flags.testRaidsDisabled;
  testWildlifeRespawnDisabled = s.flags.testWildlifeRespawnDisabled;
  testForceMarkChance = s.flags.testForceMarkChance;
  instantBuild = s.flags.instantBuild;
  testPlayersIgnored = s.flags.testPlayersIgnored ?? false;
  towerCooldowns.clear();
  migrateSaveDayLength(s.dayTicks ?? LEGACY_DAY_TICKS, s.nightTicks ?? LEGACY_NIGHT_TICKS);
  evaluateGoals(!s.goals);
  // Transients: nothing in flight survives a load; everyone re-stamps vision from scratch.
  pendingEffects = [];
  // Hero phase 4: statuses, cooldowns and summons are transient.
  clearSpellState();
  pendingExplored = [];
  visionTile = new WeakMap();
  isPaused = false;
}

// The wall-mounted Archer Tower is gone: an old save's ArcherTower tile becomes a plain Archery Range
// (its archers keep their post). One tile cannot hold both post and wall, so the wall the old tower
// replaced is not restored.
function migrateArcherTowers() {
  for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < WORLD_TILES_X; tx++) {
      if ((tiles[tileIndex(tx, ty)] as TileType) !== TileType.ArcherTower) continue;
      tiles[tileIndex(tx, ty)] = TileType.ArcherPost;
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
  const day = Math.floor(cycleTick / oldCycle);
  const pos = cycleTick % oldCycle;
  const newPos =
    pos < oldDay
      ? Math.floor((pos * DAY_TICKS) / oldDay)
      : DAY_TICKS + Math.floor(((pos - oldDay) * NIGHT_TICKS) / oldNight);
  const delta = day * GAME_DAY_TICKS + newPos - cycleTick;
  cycleTick += delta;
  wasNight = isNightNow();
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
    dayIndex: Math.floor(cycleTick / GAME_DAY_TICKS),
    population: civilianPopulationUsed(),
    difficulty,
    worldSize: WORLD_TILES_X,
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
  simHeldForLoad = true;
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
    if (file.worldSize !== WORLD_TILES_X) {
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
    simHeldForLoad = false;
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
  if (!autosaveDue) return;
  autosaveDue = false;
  // Debounced: never more than one autosave queued or writing.
  if (!AUTOSAVE_ENABLED || !anyPlayerSinceBoot || autosaveQueued) return;
  autosaveQueued = true;
  void saveToSlot("autosave").finally(() => (autosaveQueued = false));
}

// Ctrl+C / kill / tsx watch restarts: write the autosave synchronously, then exit.
let shuttingDown = false;
function saveOnShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (AUTOSAVE_ENABLED && anyPlayerSinceBoot && !simHeldForLoad) {
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
  const color = PLAYER_COLORS[nextColorIndex % PLAYER_COLORS.length];
  nextColorIndex += 1;

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
  anyPlayerSinceBoot = true;

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
      isPaused = !isPaused;
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

const REACH = TILE_SIZE * 2.5;
const PLACEABLE_TILES = [
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BarnPost,
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.TownCenter,
  TileType.Road,
  TileType.CobbleRoad,
  TileType.Gate,
  TileType.Stables,
  TileType.SiegeWorkshop,
  TileType.Keep,
];
const BREAKABLE_TILES = [
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.BarnPost,
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Stables,
  TileType.SiegeWorkshop,
  TileType.Keep,
  // Demolishing a site frees its builders; the materials are lost (no refund).
  TileType.ConstructionSite,
  // Demolished roads revert to bare ground.
  TileType.Road,
  TileType.CobbleRoad,
  // Wild forage can be cleared like any other obstacle (it simply stops being food).
  ...FORAGE_TILES,
  TileType.Gate,
];
const POPULATION_GATED_TILES = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
];
const CRAFT_BUILDING_TILES = [TileType.TailorShop, TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Brewery];

const IN_PLACE_UPGRADE_TILES: TileType[] = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Tower,
  TileType.Keep,
];

// True when placing `tile` on the existing `current` building upgrades it in place.
function isInPlaceUpgrade(tile: TileType, current: TileType, tx: number, ty: number): boolean {
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
function adjacentHouseCount(tx: number, ty: number): number {
  let n = 0;
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (inBounds(nx, ny) && isHouseTile(tiles[tileIndex(nx, ny)] as TileType)) n++;
  }
  return n;
}

// Top up one unit building to its tier headcount plus its house bonus. Never removes units.
function syncGuardBonusAt(tx: number, ty: number) {
  const t = tiles[tileIndex(tx, ty)] as TileType;
  if (!isMilitaryTile(t)) return;
  let kind: ColonistKind;
  let level: number;
  let base: number;
  if (t === TileType.KnightPost || t === TileType.CastleLevel2 || t === TileType.CastleLevel3) {
    kind = "knight";
    level = t === TileType.KnightPost ? 1 : t === TileType.CastleLevel2 ? 2 : 3;
    base = guardCountForLevel(level);
  } else if (t === TileType.ArcherPost) {
    kind = "archer";
    level = getBuildingLevel(tx, ty);
    base = guardCountForLevel(level);
  } else if (t === TileType.Stables) {
    kind = "cavalry";
    level = getBuildingLevel(tx, ty);
    base = cavalryCountForLevel(level);
  } else {
    level = t === TileType.MilitiaPost ? 1 : t === TileType.MilitiaCamp2 ? 2 : 3;
    kind = militiaKindForLevel(level);
    base = militiaCountForLevel(level);
  }
  const target = base + adjacentHouseCount(tx, ty);
  let have = 0;
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty && (c.kind === kind || (isMilitiaLineKind(kind) && isMilitiaLineKind(c.kind)))) have++;
  }
  for (const q of respawnQueue) if (q.tx === tx && q.ty === ty) have++;
  for (let i = have; i < target; i++) {
    // House-bonus soldiers count toward the settlement too: they wait (next sync) while it is full.
    if (settlementBlocker(tx, ty) !== "") break;
    spawnColonistForPost(tx, ty, kind, level);
  }
}

function syncGuardBonusesAround(tx: number, ty: number) {
  syncGuardBonusAt(tx, ty);
  for (const [dx, dy] of NEIGHBOURS_8) {
    if (inBounds(tx + dx, ty + dy)) syncGuardBonusAt(tx + dx, ty + dy);
  }
}

function walkableNeighbourCount(tx: number, ty: number, ignoreX: number, ignoreY: number): number {
  let n = 0;
  for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
    if (nx === ignoreX && ny === ignoreY) continue;
    if (isWalkableTile(nx, ny)) n++;
  }
  return n;
}

// A unit building must keep at least one open neighbouring tile for its units to spawn onto.
// Refuse any solid placement that would seal one in (or a unit building with no open side).
function sealsInSpawner(tx: number, ty: number, tile: TileType): boolean {
  if (!isSolidTile(tile)) return false;
  if (isMilitaryTile(tile) && walkableNeighbourCount(tx, ty, -1, -1) === 0) return true;
  for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]] as const) {
    if (!inBounds(nx, ny) || !isMilitaryTile(tiles[tileIndex(nx, ny)] as TileType)) continue;
    if (walkableNeighbourCount(nx, ny, tx, ty) === 0) return true;
  }
  return false;
}

function handleSetTile(player: Player, tx: number, ty: number, tile: TileType, skipReach = false) {
  if (player.dead) return;
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;
  if (tile !== TileType.Empty && !isSolidTile(tiles[tileIndex(tx, ty)] as TileType) && sealsInSpawner(tx, ty, tile)) return;
  handleSetTileInner(player, tx, ty, tile, skipReach);
  syncGuardBonusesAround(tx, ty);
}

// ---- Placement costs (charged when a placement is accepted, i.e. when its construction site starts) ----
type Cost = Partial<Record<ResourceKey, number>>;
const BUILDERS_GUILD_WOOD_COST = 15;
const TOWN_CENTER_COST: Cost = { wood: 60, rock: 30, iron: 20 };
// Upgrading a Town Center to level 2 / level 3.
const TOWN_CENTER_UPGRADE_COSTS: Cost[] = [
  { wood: 80, rock: 60, iron: 40 },
  { wood: 120, rock: 100, iron: 80, tools: 10 },
];
// The Keep: build (level 1), then upgrade to level 2 / level 3.
const KEEP_COSTS: Cost[] = [
  { wood: 60, rock: 40, iron: 20 },
  { wood: 90, rock: 70, iron: 40 },
  { wood: 130, rock: 100, iron: 70, tools: 10 },
];
// A new Town Center must stand at least this far (tiles) from every other one (built or queued).
// Doubled 12 -> 24 on 2026-10-28 so settlements spread out (a 160 map still fits several).
const TOWN_CENTER_MIN_SPACING_TILES = 24;
const TOWN_CENTER_POI_CLEARANCE_TILES = 6;
const POI_TILES = new Set<TileType>([
  TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble,
  TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence,
  TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost,
]);

function placementCost(tile: TileType, current: TileType, tx: number, ty: number): Cost {
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
        return { wood: HOUSE_WOOD_COST, grain: 2, meat: 2, fruit: 2, clothes: 3, tools: 2, luxuryItems: 1 };
      }
      if (current === TileType.House) return { wood: HOUSE_WOOD_COST, grain: 1, meat: 1, fruit: 1, clothes: 2 };
      return { wood: HOUSE_WOOD_COST };
    case TileType.BarnPost:
      return { wood: BARN_WOOD_COST };
    case TileType.ChurchPost:
      return { wood: CHURCH_WOOD_COST };
    case TileType.WardStone:
      return { wood: WARD_STONE_WOOD_COST, tools: WARD_STONE_TOOLS_COST };
    case TileType.Market:
    case TileType.GoldShop:
      return { wood: SHOP_WOOD_COST };
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

function canAfford(cost: Cost): boolean {
  return Object.entries(cost).every(([key, amount]) => stock[key as ResourceKey] >= (amount ?? 0));
}

function spend(cost: Cost) {
  for (const [key, amount] of Object.entries(cost)) stock[key as ResourceKey] -= amount ?? 0;
}

function formatCost(cost: Cost): string {
  const parts = Object.entries(cost).map(([key, amount]) => `${amount} ${key === "luxuryItems" ? "luxury items" : key === "cotton" ? "hemp" : key}`);
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

// A new Town Center keeps its distance from every other one (built or under construction), from the
// Abbey and from ruins / encampments.
// True when (tx, ty) is closer than TOWN_CENTER_MIN_SPACING_TILES to a Town Center or a queued one.
function townCenterTooClose(tx: number, ty: number): boolean {
  for (const tc of townCenters) {
    if (Math.hypot(tc.x - tx, tc.y - ty) < TOWN_CENTER_MIN_SPACING_TILES) return true;
  }
  for (const site of constructionSites.values()) {
    if (site.target === TileType.TownCenter && Math.hypot(site.tx - tx, site.ty - ty) < TOWN_CENTER_MIN_SPACING_TILES) return true;
  }
  return false;
}

function townCenterSpotOk(tx: number, ty: number): boolean {
  if (townCenterTooClose(tx, ty)) return false;
  if (abbeyCenter && Math.hypot(abbeyCenter.x - tx, abbeyCenter.y - ty) < ABBEY_GROUNDS_RADIUS + TOWN_CENTER_POI_CLEARANCE_TILES) return false;
  const r = TOWN_CENTER_POI_CLEARANCE_TILES;
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (inBounds(x, y) && POI_TILES.has(tiles[tileIndex(x, y)] as TileType)) return false;
    }
  }
  return findAdjacentWalkable(tx, ty) !== null;
}

// The level a building will have once `tile` placed on `current` resolves (1 for a new building).
function levelAfterPlacement(tile: TileType, current: TileType, tx: number, ty: number): number {
  if (current === TileType.Empty || !isInPlaceUpgrade(tile, current, tx, ty)) return 1;
  return currentBuildingLevel(tx, ty, current) + 1;
}

function currentBuildingLevel(tx: number, ty: number, t: TileType): number {
  if (t === TileType.BigHouse || t === TileType.CastleLevel2 || t === TileType.MilitiaCamp2) return 2;
  if (t === TileType.HouseLevel2 || t === TileType.CastleLevel3 || t === TileType.MilitiaCamp3) return 3;
  if (t === TileType.House || t === TileType.KnightPost || t === TileType.MilitiaPost) return 1;
  if (t === TileType.TownCenter) return findTownCenterAt(tx, ty)?.level ?? 1;
  return getBuildingLevel(tx, ty);
}

// ---- Construction: builders turn an accepted placement into the building over time ----
// Every placeable building except Farm Plots (a field sown on the spot) becomes a construction site.
// The cost is charged at placement; a new building's tile turns into a solid ConstructionSite, an
// in-place upgrade keeps the building (and its workers) running until the upgrade lands. When the
// site's progress reaches its total, the normal resolve*Placement logic runs, exactly as an instant
// placement used to (worker spawns, upgrades and synergies all unchanged).
interface ConstructionSiteState {
  tx: number;
  ty: number;
  // The placement requested (e.g. ArcherPost, House on a House = upgrade).
  target: TileType;
  // What the tile held when the placement was accepted (restored just before resolving).
  prevTile: TileType;
  upgrade: boolean;
  // Builder work accumulated (each working builder adds builderRate per tick) / needed.
  progress: number;
  totalTicks: number;
}
const constructionSites = new Map<string, ConstructionSiteState>();
// COLONY_INSTANT_BUILD=1 (or testHook "setInstantBuild") skips construction entirely, for the scripted
// tests written before builders existed: every placement resolves on the spot, no builder needed.
let instantBuild = process.env.COLONY_INSTANT_BUILD === "1";

// Base build time (seconds) per level; an upgrade to level n takes n times as long. Split between up
// to BUILDER_MAX_PER_SITE builders and scaled by builderRate (happiness, Town Center, Guild).
const BUILD_SECONDS_WALL = 4;
// Roads: cheap ground tiles, built by builders like everything else (one tile per placement).
const ROAD_ROCK_COST = 1;
const COBBLE_ROAD_ROCK_COST = 2;
const BUILD_SECONDS_ROAD = 4;
const BUILD_SECONDS_COBBLE_ROAD = 6;
const BUILD_SECONDS_HOUSE = 10;
const BUILD_SECONDS_DEFAULT = 12;
const BUILD_SECONDS_BIG = 20;
const BUILD_SECONDS_TOWN_CENTER = 40;
const BIG_BUILD_TILES = new Set<TileType>([
  TileType.KnightPost, TileType.ChurchPost, TileType.Tavern, TileType.TailorShop, TileType.Blacksmith,
  TileType.LuxuryWorkshop, TileType.Brewery, TileType.Market, TileType.GoldShop, TileType.WardStone,
  TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
]);

function buildTicksFor(tile: TileType, level: number): number {
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

function startConstruction(tx: number, ty: number, tile: TileType, current: TileType, upgrade: boolean) {
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
    tiles[tileIndex(tx, ty)] = TileType.ConstructionSite;
    broadcastTileUpdate(tx, ty, TileType.ConstructionSite);
  }
}

function completeConstruction(key: string, site: ConstructionSiteState) {
  constructionSites.delete(key);
  const index = tileIndex(site.tx, site.ty);
  if (site.upgrade) {
    // The building changed under a queued upgrade (destroyed or replaced): nothing left to upgrade.
    if (tiles[index] !== site.prevTile) return;
  } else {
    if (tiles[index] !== TileType.ConstructionSite) return;
    tiles[index] = site.prevTile;
  }
  resolvePlacement(site.tx, site.ty, site.target, site.prevTile);
  syncGuardBonusesAround(site.tx, site.ty);
}

// Once per tick, after the builders have worked.
function updateConstructionSites() {
  for (const [key, site] of Array.from(constructionSites)) {
    const index = tileIndex(site.tx, site.ty);
    // Cleared some other way (e.g. a test rewriting the tile): drop the record.
    if (!site.upgrade && tiles[index] !== TileType.ConstructionSite) {
      constructionSites.delete(key);
      continue;
    }
    if (site.progress >= site.totalTicks) completeConstruction(key, site);
  }
}

// Flattened [tile index, target, progress 0-1000, upgrade 0/1, builders working] per site.
function constructionSitesForSnapshot(): number[] {
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
function buildingLevelsForSnapshot(): number[] {
  const out: number[] = [];
  for (const [key, level] of buildingLevel) {
    if (level <= 1) continue;
    const [tx, ty] = key.split(",").map(Number);
    out.push(tileIndex(tx, ty), level);
  }
  for (const tc of townCenters) if (tc.level > 1) out.push(tileIndex(tc.x, tc.y), tc.level);
  return out;
}

function sendEvent(player: Player, category: GameEventCategory, text: string) {
  if (player.socket.readyState === player.socket.OPEN) {
    player.socket.send(JSON.stringify({ type: "event", category, text } satisfies ServerMessage));
  }
}

// Removes the building (or site, road, forage) at a tile: its posted workers, level, farm plot, site,
// HP records; mines revert to the ore under them. Player demolish and mob
// destruction (damageBuilding) both end here.
function demolishTile(tx: number, ty: number, current: TileType) {
  const siteKey = resourceKey(tx, ty);
  buildingHp.delete(siteKey);
  repairPaid.delete(siteKey);
  // A queued construction or upgrade here is dropped with the tile (no refund).
  const site = constructionSites.get(siteKey);
  constructionSites.delete(siteKey);
  if (current === TileType.ConstructionSite) {
    // Ore / rock under an unfinished mine comes back.
    const revert = site && !site.upgrade ? site.prevTile : TileType.Empty;
    tiles[tileIndex(tx, ty)] = revert;
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
    tiles[tileIndex(tx, ty)] = revert;
    broadcastTileUpdate(tx, ty, revert);
    return;
  }
  if (current === TileType.RockMinePost) {
    const key = resourceKey(tx, ty);
    const revert = minesPlacedOnOre.has(key) ? TileType.Rock : TileType.Empty;
    minesPlacedOnOre.delete(key);
    tiles[tileIndex(tx, ty)] = revert;
    broadcastTileUpdate(tx, ty, revert);
    return;
  }
  if (isTowerTile(current)) towerCooldowns.delete(resourceKey(tx, ty));
  tiles[tileIndex(tx, ty)] = TileType.Empty;
  broadcastTileUpdate(tx, ty, TileType.Empty);
}

// "" when a new Keep may go up near (tx, ty): its settlement's Town Center is at level 2+ and has no
// Keep (built or queued) yet; else why not.
function keepPlacementBlocker(tx: number, ty: number): string {
  const key = settlementKeyNear(tx, ty);
  const tc = townCenters.find((t) => resourceKey(t.x, t.y) === key);
  if (!tc || tc.level < KEEP_MIN_TOWN_CENTER_LEVEL) return `Keep needs a Town Center at level ${KEEP_MIN_TOWN_CENTER_LEVEL}`;
  const has = (x: number, y: number) => settlementKeyNear(x, y) === key;
  for (const k of tilesOfType(TileType.Keep)) if (has(k.x, k.y)) return "This settlement already has a Keep";
  for (const site of constructionSites.values()) {
    if (site.target === TileType.Keep && !site.upgrade && has(site.tx, site.ty)) return "This settlement already has a Keep";
  }
  return "";
}

function handleSetTileInner(player: Player, tx: number, ty: number, tile: TileType, skipReach = false) {
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;

  const tileCenter = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(player.x - tileCenter.x, player.y - tileCenter.y);
  if (!skipReach && dist > REACH) return;

  const current = tiles[tileIndex(tx, ty)] as TileType;
  const siteKey = resourceKey(tx, ty);

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
    const full = settlementBlocker(tx, ty, garrison);
    if (full) {
      sendEvent(player, "build", full);
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
    instantBuild ||
    tile === TileType.FarmPlot ||
    (tile === TileType.TownCenter && (townCenters.length === 0 || !anyBuilderAlive()));
  if (!instant && !anyBuilderAlive()) {
    sendEvent(player, "build", "No builders available");
    return;
  }

  spend(cost);
  // A new building (e.g. a house over a cleared, damaged tile) starts at full HP.
  if (!upgradeInPlace) {
    buildingHp.delete(siteKey);
    repairPaid.delete(siteKey);
  }
  if (instant) {
    resolvePlacement(tx, ty, tile, current);
  } else {
    startConstruction(tx, ty, tile, current, upgradeInPlace);
  }
}

// Turns an accepted placement into the building (instantly, or when its construction completes).
// `current` is what the tile held when the placement was accepted.
function resolvePlacement(tx: number, ty: number, tile: TileType, current: TileType) {
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
    tiles[tileIndex(tx, ty)] = TileType.Keep;
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
    tiles[tileIndex(tx, ty)] = tile;
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
    tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    if (wardPriestId === null && wardPriestRespawnTicks < 0) updateWardPriestPresence();
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
    tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    marketBuilt = true;
    return;
  }
  if (tile === TileType.GoldShop) {
    tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    goldShopBuilt = true;
    return;
  }

  tiles[tileIndex(tx, ty)] = tile;
  broadcastTileUpdate(tx, ty, tile);
}

// ---- Towers (ROADMAP §8 item 6; separate from the Archery Range) ----
// A free-standing 1x1 building with no workers and no population slot. Every tick each Tower counts down
// its cooldown; off cooldown it shoots the nearest hostile mob within range (a ranged AttackEffect, the
// arrow VFX the archers used). Upgraded in place to level 3 (place a Tower on a Tower, or the info
// panel's Upgrade): faster, harder and slightly longer shots. Max HP is the big-building class
// (BUILDING_HP_BIG x BUILDING_HP_LEVEL_MULT). Damage is flat: no army / Town Center multipliers.
const TOWER_STATS = [
  { damage: 8, cooldownSeconds: 1.5, rangeTiles: 7 },
  { damage: 12, cooldownSeconds: 1.1, rangeTiles: 7.5 },
  { damage: 18, cooldownSeconds: 0.8, rangeTiles: 8 },
];
// Cost to build (level 1), then to upgrade to level 2 / level 3.
const TOWER_COSTS: Cost[] = [
  { wood: 20, rock: 15 },
  { wood: 30, rock: 30 },
  { wood: 45, rock: 50 },
];

// The one place that says what a Tower tile is (the gate logic asks it too).
export function isTowerTile(tile: TileType): boolean {
  return tile === TileType.Tower;
}

function towerStatsForLevel(level: number) {
  return TOWER_STATS[Math.min(Math.max(level, 1), 3) - 1];
}

function towerCostForLevel(level: number): Cost {
  return TOWER_COSTS[Math.min(Math.max(level, 1), 3) - 1];
}

function towerCooldownTicks(level: number): number {
  return Math.max(1, Math.round(towerStatsForLevel(level).cooldownSeconds * TICK_RATE));
}

// Every standing Tower within radiusTiles (Euclidean, tile units) of tile (tx, ty). A Tower tile only
// exists while the building stands (destroyed -> demolished to Empty; unfinished -> ConstructionSite),
// so every one found is alive. A Tower whose upgrade is under way keeps shooting and counts.
export function livingTowersNear(tx: number, ty: number, radiusTiles: number): Array<{ x: number; y: number; level: number }> {
  const out: Array<{ x: number; y: number; level: number }> = [];
  const r = Math.ceil(radiusTiles);
  for (let y = Math.max(0, ty - r); y <= Math.min(WORLD_TILES_Y - 1, ty + r); y++) {
    for (let x = Math.max(0, tx - r); x <= Math.min(WORLD_TILES_X - 1, tx + r); x++) {
      if (!isTowerTile(tiles[tileIndex(x, y)] as TileType)) continue;
      if (Math.hypot(x - tx, y - ty) <= radiusTiles) out.push({ x, y, level: getBuildingLevel(x, y) });
    }
  }
  return out;
}

function resolveTowerPlacement(tx: number, ty: number) {
  if (isTowerTile(tiles[tileIndex(tx, ty)] as TileType)) {
    tryLevelUpInPlace(tx, ty, [TileType.Tower]);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.Tower;
  broadcastTileUpdate(tx, ty, TileType.Tower);
  towerCooldowns.delete(resourceKey(tx, ty));
}

// Mobs a Tower may shoot: never a dormant guardian (that would wake its site), a passive raid group
// still loitering at the edge, or a deserter that hasn't turned yet.
function isTowerTarget(m: Mob): boolean {
  return !isDormantGuardian(m) && !m.passive && !(m.isDeserter && !m.deserterActive);
}

// Once per tick, after the mobs have moved.
function updateTowers() {
  for (let i = 0; i < tiles.length; i++) {
    if (!isTowerTile(tiles[i] as TileType)) continue;
    const tx = i % WORLD_TILES_X;
    const ty = Math.floor(i / WORLD_TILES_X);
    const key = resourceKey(tx, ty);
    const cooldown = towerCooldowns.get(key) ?? 0;
    if (cooldown > 1) {
      towerCooldowns.set(key, cooldown - 1);
      continue;
    }
    const level = getBuildingLevel(tx, ty);
    const stats = towerStatsForLevel(level);
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = ty * TILE_SIZE + TILE_SIZE / 2;
    let best: Mob | null = null;
    let bestD = stats.rangeTiles * TILE_SIZE;
    for (const m of mobs.values()) {
      if (!isTowerTarget(m)) continue;
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d <= bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) {
      towerCooldowns.set(key, 0);
      continue;
    }
    // Shot from the top of the tower art.
    pendingEffects.push({ fromX: cx, fromY: cy - TILE_SIZE / 3, toX: best.x, toY: best.y });
    damageMob(best, stats.damage, "b:" + key);
    towerCooldowns.set(key, towerCooldownTicks(level));
  }
}

function towerInfoLines(level: number): string[] {
  const line = (l: number) => {
    const s = towerStatsForLevel(l);
    return `${s.damage} damage every ${s.cooldownSeconds}s, range ${s.rangeTiles} tiles`;
  };
  const lines = [`Lv${level}: shoots the nearest monster: ${line(level)}`];
  if (level < 3) lines.push(`Next level: ${line(level + 1)}`);
  lines.push("No workers or population needed");
  return lines;
}

// ---- Cavalry & siege (ROADMAP "Cavalry & siege"): the cavalry charge, siege strikes and the catapult's
// splash, Siege Workshop production, and the raids' siege engines (updateSiegeMob). ----

// Cavalry charge runs: where the rider's current straight run began (ax, ay), its last position, ticks
// stood still, and the tick its next charge may land. Not saved.
interface ChargeRun {
  ax: number;
  ay: number;
  lx: number;
  ly: number;
  idle: number;
  readyTick: number;
}
const chargeRuns = new Map<string, ChargeRun>();
// Recent siege / charge events (testHook "siegeState").
const siegeEvents: Array<{ tick: number; type: string; id: string; amount?: number; detail?: string }> = [];
function siegeEvent(type: string, id: string, amount?: number, detail?: string) {
  siegeEvents.push({ tick: cycleTick, type, id, amount, detail });
  if (siegeEvents.length > 200) siegeEvents.shift();
}

// Once per tick for a rider (before it moves): a stride turning more than 60 degrees off the run's line
// starts a new run where the turn was; standing still past the grace ends it.
function trackCharge(c: Colonist) {
  const run = chargeRuns.get(c.id);
  if (!run) {
    chargeRuns.set(c.id, { ax: c.x, ay: c.y, lx: c.x, ly: c.y, idle: 0, readyTick: 0 });
    return;
  }
  const sx = c.x - run.lx;
  const sy = c.y - run.ly;
  const step = Math.hypot(sx, sy);
  const rx = run.lx - run.ax;
  const ry = run.ly - run.ay;
  const rl = Math.hypot(rx, ry);
  if (step < 0.5) {
    if (++run.idle > CAVALRY_CHARGE_IDLE_GRACE_TICKS) {
      run.ax = c.x;
      run.ay = c.y;
    }
  } else {
    run.idle = 0;
    if (rl > 1 && (sx * rx + sy * ry) / (step * rl) < 0.5) {
      run.ax = run.lx;
      run.ay = run.ly;
    }
  }
  run.lx = c.x;
  run.ly = c.y;
}

// The damage multiplier of a rider's blow: x CAVALRY_CHARGE_MULT when it ends a straight run of
// CAVALRY_CHARGE_TILES+ off cooldown. Any blow ends the run.
function takeChargeBonus(c: Colonist): number {
  const run = chargeRuns.get(c.id);
  if (!run) return 1;
  const ok = cycleTick >= run.readyTick && Math.hypot(c.x - run.ax, c.y - run.ay) >= CAVALRY_CHARGE_TILES * TILE_SIZE;
  run.ax = c.x;
  run.ay = c.y;
  if (!ok) return 1;
  run.readyTick = cycleTick + CAVALRY_CHARGE_COOLDOWN_TICKS;
  return CAVALRY_CHARGE_MULT;
}

// A boulder from (fx, fy) landing at (tx, ty): `damage` to every unit of the other side within
// CATAPULT_SPLASH_PX, x CATAPULT_BUILDING_MULT to every building there (the raids' catapults only: the
// colony's never hit its own buildings, and monsters have none).
function catapultImpact(fx: number, fy: number, tx: number, ty: number, damage: number, side: "colony" | "mob", attackerKey: string) {
  pendingEffects.push({ fromX: fx, fromY: fy, toX: tx, toY: ty, boulder: true });
  let hits = 0;
  if (side === "colony") {
    for (const m of Array.from(mobs.values())) {
      if (!isTowerTarget(m) || Math.hypot(m.x - tx, m.y - ty) > CATAPULT_SPLASH_PX) continue;
      damageMob(m, damage, attackerKey);
      hits++;
    }
    siegeEvent("boulder", attackerKey, damage, `units:${hits}`);
    return;
  }
  for (const c of Array.from(colonists.values())) {
    if (isAbbeyClergy(c) || Math.hypot(c.x - tx, c.y - ty) > CATAPULT_SPLASH_PX) continue;
    damageColonist(c, damage);
    hits++;
  }
  for (const p of players.values()) {
    if (p.dead || testPlayersIgnored || Math.hypot(p.x - tx, p.y - ty) > CATAPULT_SPLASH_PX) continue;
    damagePlayer(p, damage);
    hits++;
  }
  let buildings = 0;
  const c0 = tileOfPixel(tx, ty);
  const r = Math.ceil(CATAPULT_SPLASH_PX / TILE_SIZE);
  for (let y = c0.y - r; y <= c0.y + r; y++) {
    for (let x = c0.x - r; x <= c0.x + r; x++) {
      if (!inBounds(x, y) || !structureHp(x, y)) continue;
      const centre = tileToPixelCenter({ x, y });
      if (Math.hypot(centre.x - tx, centre.y - ty) > CATAPULT_SPLASH_PX + TILE_SIZE / 2) continue;
      damageBuilding(x, y, damage * CATAPULT_BUILDING_MULT);
      buildings++;
    }
  }
  siegeEvent("boulder", attackerKey, damage, `units:${hits},buildings:${buildings}`);
}

// ---- Siege Workshop production ----
interface SiegeWorkshopState {
  building: SiegeKind | null;
  ticksLeft: number;
}
const siegeWorkshops = new Map<string, SiegeWorkshopState>();

function siegeUnitsAt(tx: number, ty: number): number {
  let n = 0;
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && isSiegeKind(c.kind)) n++;
  return n;
}

// Why the workshop at (tx, ty) can't start `kind` now ("" = it can).
function siegeQueueBlocker(tx: number, ty: number, kind: SiegeKind): string {
  const state = siegeWorkshops.get(resourceKey(tx, ty));
  if (state?.building) return `Building a ${SIEGE_LABEL[state.building]}`;
  if (siegeUnitsAt(tx, ty) >= SIEGE_WORKSHOP_CAP) return `At most ${SIEGE_WORKSHOP_CAP} engines`;
  if (!canAfford(SIEGE_UNIT_COST[kind])) return "Not enough resources";
  const full = settlementBlocker(tx, ty, SIEGE_POPULATION_COST);
  if (full) return full;
  return "";
}

function siegeWorkshopInfo(tx: number, ty: number): NonNullable<BuildingInfo["siege"]> {
  const state = siegeWorkshops.get(resourceKey(tx, ty));
  return {
    building: state?.building ?? null,
    progress: state?.building ? 1 - state.ticksLeft / SIEGE_BUILD_TICKS : null,
    units: siegeUnitsAt(tx, ty),
    cap: SIEGE_WORKSHOP_CAP,
    options: SIEGE_KINDS.map((kind) => {
      const reason = siegeQueueBlocker(tx, ty, kind);
      return { kind, label: SIEGE_LABEL[kind], cost: formatCost(SIEGE_UNIT_COST[kind]), enabled: reason === "", reason };
    }),
  };
}

function handleQueueSiege(tx: number, ty: number, kind: unknown) {
  if (!inBounds(tx, ty) || tiles[tileIndex(tx, ty)] !== TileType.SiegeWorkshop) return;
  if (kind !== "batteringRam" && kind !== "catapult") return;
  if (siegeQueueBlocker(tx, ty, kind) !== "") return;
  spend(SIEGE_UNIT_COST[kind]);
  siegeWorkshops.set(resourceKey(tx, ty), { building: kind, ticksLeft: instantBuild ? 1 : SIEGE_BUILD_TICKS });
}

// Once per tick: an engine under way rolls out when its timer runs down.
function updateSiegeWorkshops() {
  for (const [key, state] of siegeWorkshops) {
    if (!state.building) continue;
    const tile = keyToTile(key);
    if (!tile || tiles[tileIndex(tile.x, tile.y)] !== TileType.SiegeWorkshop) {
      siegeWorkshops.delete(key);
      continue;
    }
    if (--state.ticksLeft > 0) continue;
    const c = spawnColonistForPost(tile.x, tile.y, state.building, 1);
    broadcastEvent("build", `A ${SIEGE_LABEL[state.building].toLowerCase()} rolls out of the Siege Workshop`);
    siegeEvent("built", c.id, undefined, state.building);
    state.building = null;
  }
}

// ---- Armour & weapons: stock, equipping, forging, drops (constants: EQUIP_* / FORGE_* / *_MULT) ----
// Test-hook log (equipState): equip / unequipped / forged / drop / loot / hit / taken.
const equipEvents: { type: string; id?: string; slot?: EquipSlot; tier?: number; amount?: number; detail?: string; tick: number }[] = [];
function equipEvent(e: Omit<(typeof equipEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  equipEvents.push({ ...e, tick: cycleTick });
  if (equipEvents.length > 300) equipEvents.splice(0, equipEvents.length - 300);
}
let lastUnequippedToastTick = -Infinity;
let equipDropToasted = false;
let lastEquipDropToastTick = -Infinity;
// testHook "equipConfig" {dropChance}: overrides EQUIP_DROP_CHANCE (null = the constant).
let testEquipDropChance: number | null = null;

function resetEquipment() {
  equipment.armour = [0, 0, 0];
  equipment.weapon = [0, 0, 0];
  forgeQueues.clear();
  lastUnequippedToastTick = -Infinity;
  equipDropToasted = false;
  lastEquipDropToastTick = -Infinity;
}

function isEquippedKind(kind: ColonistKind): boolean {
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
function equipNewUnit(c: Colonist) {
  c.armourTier = takeBestEquipment("armour");
  c.weaponTier = takeBestEquipment("weapon");
  equipEvent({ type: "equip", id: c.id, detail: `${c.kind} armour ${c.armourTier} weapon ${c.weaponTier}` });
  if (c.armourTier > 0 && c.weaponTier > 0) return;
  equipEvent({ type: "unequipped", id: c.id, detail: `${c.armourTier === 0 ? "armour " : ""}${c.weaponTier === 0 ? "weapon" : ""}`.trim() });
  if (cycleTick - lastUnequippedToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  lastUnequippedToastTick = cycleTick;
  const missing = c.armourTier === 0 && c.weaponTier === 0 ? "armour or weapons" : c.armourTier === 0 ? "armour" : "a forged weapon";
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent("build", `A ${name} musters without ${missing} — the stock is empty (forge more at a Blacksmith)`);
}

function weaponDamageMult(c: Colonist): number {
  return WEAPON_DAMAGE_MULT[c.weaponTier ?? 0] ?? 1;
}

function armourDamageTakenMult(c: Colonist): number {
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
function dropEquipmentFor(mob: Mob) {
  if (mob.isDeserter) return;
  const guaranteed = !!mob.boss || mob.mark !== HungerMark.None;
  if (!guaranteed && !EQUIP_ARMOURED_KINDS.includes(mob.kind)) return;
  if (!guaranteed && Math.random() >= (testEquipDropChance ?? EQUIP_DROP_CHANCE)) return;
  const slot: EquipSlot = Math.random() < 0.5 ? "armour" : "weapon";
  equipment[slot][0]++;
  equipEvent({ type: "drop", id: mob.id, slot, tier: 1, detail: mob.kind });
  const first = !equipDropToasted;
  if (!first && cycleTick - lastEquipDropToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  equipDropToasted = true;
  lastEquipDropToastTick = cycleTick;
  const name = mob.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent(
    first ? "milestone" : "build",
    `Salvaged a tier-1 ${EQUIP_SLOT_LABEL[slot]} from a fallen ${name}${first ? " — it goes to the colony's stock" : ""}`
  );
}

// ---- Hero phases 1-2: items, inventory, XP for the PLAYER (ROADMAP "Hero phases 1-2") ----
// A HeroProfile is the player's persistent gear + XP, keyed by Player.profileKey, saved with the world
// (`heroProfiles`), never touched by death / respawn. Heroes (phase 3) can own one each: nothing here is
// player-specific except heroProfileOf / playerMaxHp / playerDamage / playerAttackCooldownTicks.
interface HeroProfile {
  key: string;
  equipment: Equipment;
  // Unequipped items only (equipped ones live in `equipment`), at most HERO_INVENTORY_CAP.
  inventory: GearItem[];
  xp: number;
  // Bumped (from heroProfileVersionCounter) on every change; the snapshot resends the profile then.
  version: number;
  // Cached derived modifiers (recomputed by recomputeHeroProfile on every change).
  stats: HeroStats;
  level: number;
  // Hero phase 3: set on hero profiles ("hero:<id>") only - the hero's class (its base HP) and name, so a
  // fallen / recruiting hero is still known. Their `inventory` stays empty (they equip from the player's).
  heroClass?: HeroClass;
  heroName?: string;
  // Hero phase 4: learned spell ids, the 4 spell slots (spell ids; Equipment.spell1-4 stay null - an
  // Equipment socket holds a GearItem), the hero's Auto toggle (players never auto-cast) and how many
  // level-up spell grants (SPELL_GRANT_LEVELS) were already given.
  spells: SpellId[];
  spellSlots: (SpellId | null)[];
  spellAuto: boolean;
  spellGrants: number;
}
const HERO_INVENTORY_CAP = 40;
// Total XP at which level 1..10 starts (index = level - 1).
const HERO_LEVEL_XP = [0, 40, 100, 180, 280, 400, 550, 730, 940, 1200];
const HERO_MAX_LEVEL = HERO_LEVEL_XP.length;
// Per level above 1: +4% damage dealt (multiplicative on the gear's), +6% of the base max HP (the player's
// base is 100, so +6 HP; a hero's base is its class HP).
const HERO_LEVEL_DAMAGE_PCT = 4;
const HERO_LEVEL_MAX_HP = 6;
// XP for a kill (killing blow by that player): 10 per mob, x3 Hunger-marked, 60 a mini-boss elite, 250 the Warlord.
const HERO_XP_PER_KILL = 10;
const HERO_XP_MARKED_MULT = 3;
const HERO_XP_BOSS: Record<BossTier, number> = { warlord: 250, elite: 60 };
// Floors so stacked gear can't zero damage taken or freeze movement.
const HERO_MIN_DAMAGE_TAKEN_MULT = 0.25;
const HERO_MIN_SPEED_MULT = 0.5;
// Relic drop chances: a destroyed camp hearth; an armoured kind (EQUIP_ARMOURED_KINDS) or Hunger-marked
// mob (not a boss). The Ogre Warlord and every mini-boss elite always drop one.
const RELIC_HEARTH_CHANCE = 0.15;
const RELIC_ELITE_MOB_CHANCE = 0.08;
// Plain tiered pieces pulled from the colony stock: same strength as the soldiers' tier multipliers
// (WEAPON_DAMAGE_MULT x1.2 / 1.4 / 1.7 = +20 / 40 / 70%; ARMOUR_DAMAGE_TAKEN_MULT x0.85 / 0.7 / 0.55).
const PLAIN_GEAR: Record<EquipSlot, { slot: ItemSlotKind; kind: string; names: string[]; stats: (tier: number) => ItemStats }> = {
  weapon: {
    slot: "weapon", kind: "sword", names: ["Iron Arming Sword", "Steel Arming Sword", "Gilded Arming Sword"],
    stats: (t) => ({ damagePct: Math.round((WEAPON_DAMAGE_MULT[t] - 1) * 100) }),
  },
  armour: {
    slot: "chest", kind: "cuirass", names: ["Iron & Leather Cuirass", "Steel Breastplate", "Gilded Breastplate"],
    stats: (t) => ({ damageTakenPct: Math.round((ARMOUR_DAMAGE_TAKEN_MULT[t] - 1) * 100) }),
  },
};
// The Sworn Relics: unique named pieces, at most one of each per profile (owned or equipped).
const RELIC_CATALOGUE: { relicId: string; slot: ItemSlotKind; kind: string; name: string; icon: string; stats: ItemStats }[] = [
  { relicId: "oathkeeperHelm", slot: "head", kind: "helm", name: "Oathkeeper's Helm", icon: "relicHelm", stats: { damageTakenPct: -15, maxHp: 20 } },
  { relicId: "gorrathHide", slot: "chest", kind: "cuirass", name: "Gorrath's Hide", icon: "relicChest", stats: { damageTakenPct: -40, maxHp: 30 } },
  { relicId: "vhorrunStride", slot: "legs", kind: "greaves", name: "Vhorrun's Stride", icon: "relicLegs", stats: { moveSpeedPct: 15, damageTakenPct: -10 } },
  { relicId: "wardStoneAegis", slot: "offhand", kind: "shield", name: "Aegis of the Ward Stone", icon: "relicShield", stats: { damageTakenPct: -20, maxHp: 15 } },
  { relicId: "swornOathblade", slot: "weapon", kind: "sword", name: "The Sworn Oathblade", icon: "relicSword", stats: { damagePct: 60, attackSpeedPct: 10 } },
  { relicId: "gunneTooth", slot: "weapon", kind: "spear", name: "Gunne's Tooth", icon: "relicSpear", stats: { damagePct: 55, moveSpeedPct: 10 } },
  { relicId: "morvainWhisper", slot: "weapon", kind: "bow", name: "Morvain's Whisper", icon: "relicBow", stats: { damagePct: 40, attackSpeedPct: 30 } },
  { relicId: "abbeyEmberstaff", slot: "weapon", kind: "staff", name: "Abbey Emberstaff", icon: "relicStaff", stats: { damagePct: 35, spellPowerPct: 40 } },
];
const heroProfiles = new Map<string, HeroProfile>();
let heroProfileVersionCounter = 0;
// testHook "heroConfig" {relicChance}: overrides both relic chances (null = the constants).
let testRelicChance: number | null = null;
// Test-hook log (heroState): hit / taken / relic / xp / equip / refuse.
const heroEvents: { type: string; key?: string; amount?: number; detail?: string; tick: number }[] = [];
function heroEvent(e: Omit<(typeof heroEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  heroEvents.push({ ...e, tick: cycleTick });
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
    key, equipment, inventory, xp, level, version: ++heroProfileVersionCounter,
    stats: computeHeroStats(equipment, level, baseHp, spellBasePctFor(hero?.heroClass)), ...(hero ?? {}),
    spells: [], spellSlots: Array(SPELL_SLOT_COUNT).fill(null), spellAuto: true, spellGrants: 0,
  };
}

function heroProfileFor(key: string): HeroProfile {
  let prof = heroProfiles.get(key);
  if (!prof) {
    prof = newHeroProfile(key);
    heroProfiles.set(key, prof);
  }
  return prof;
}

function heroProfileOf(player: Player): HeroProfile {
  return heroProfileFor(player.profileKey);
}

// After any change to a profile: re-derive its modifiers, mark it for resending, and clamp the HP of
// every player playing it to the new max (a max-HP gain doesn't heal).
function recomputeHeroProfile(prof: HeroProfile) {
  prof.level = heroLevelFor(prof.xp);
  prof.stats = computeHeroStats(prof.equipment, prof.level, prof.heroClass ? HERO_CLASS_STATS[prof.heroClass].maxHp : PLAYER_MAX_HP, spellBasePctFor(prof.heroClass));
  prof.version = ++heroProfileVersionCounter;
  for (const p of players.values()) {
    if (p.profileKey === prof.key && !p.dead) p.hp = Math.min(p.hp, prof.stats.maxHp);
  }
  // Hero phase 3: the living hero's max HP follows (a gain doesn't heal, a loss clamps).
  if (prof.heroClass) {
    heroRosterVersion++;
    const c = colonists.get(prof.key.slice(HERO_KEY_PREFIX.length));
    if (c) {
      c.maxHp = prof.stats.maxHp;
      c.hp = Math.min(c.hp, c.maxHp);
    }
  }
}

function playerMaxHp(p: Player): number {
  return heroProfileOf(p).stats.maxHp;
}

function playerDamage(p: Player): number {
  return PLAYER_ATTACK_DAMAGE * heroProfileOf(p).stats.damageMult * spellBuffDamageMult("p:" + p.id);
}

function playerAttackCooldownTicks(p: Player): number {
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
function heroRewardsForKill(mob: Mob, attackerKey?: string) {
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
  const tomeRoll = mob.boss === "warlord" ? 1 : mob.boss === "elite" ? (testTomeChance ?? TOME_ELITE_CHANCE) : 0;
  if (tomeRoll > 0 && Math.random() < tomeRoll) for (const prof of lootProfiles(attackerKey)) grantTome(prof, mob.boss ?? mob.kind);
  const roll = mob.boss ? 1 : mob.mark !== HungerMark.None || EQUIP_ARMOURED_KINDS.includes(mob.kind) ? (testRelicChance ?? RELIC_ELITE_MOB_CHANCE) : 0;
  if (roll <= 0 || Math.random() >= roll) return;
  for (const prof of lootProfiles(attackerKey)) grantRelic(prof, mob.boss ?? mob.kind);
}

function heroRelicForHearth(attackerKey?: string) {
  if (Math.random() < (testTomeChance ?? TOME_HEARTH_CHANCE)) for (const prof of lootProfiles(attackerKey)) grantTome(prof, "hearth");
  if (Math.random() >= (testRelicChance ?? RELIC_HEARTH_CHANCE)) return;
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

// ---- Hero phase 3: heroes (ROADMAP "Hero phase 3: heroes") ----
// A hero is a colonist of kind "hero" with a class (HERO_CLASS_STATS) and a name; its id is stable across
// deaths and its profile "hero:<id>" (same list as the players') holds XP / level / equipment. It is
// recruited at a Keep (at most one per Keep level), counts HERO_POPULATION_COST toward the Keep's
// settlement, fights as a soldier of its class's role, never deserts or despawns, and comes back from
// death at a dawn / dusk window for a gold fee.
const HERO_KEY_PREFIX = "hero:";
// One sheet tab per hero: at most this many in the colony.
const HERO_MAX_TOTAL = 9;
const HERO_RECRUIT_TICKS = 10 * TICK_RATE;
const HERO_RESPAWN_FEE_BASE = 50;
const HERO_RESPAWN_FEE_PER_LEVEL = 25;
const HERO_RECRUIT_COST: Record<HeroClass, Cost> = {
  champion: { gold: 120, iron: 20 },
  marksman: { gold: 100, wood: 30 },
  mage: { gold: 140, rock: 20 },
};
const HERO_NAMES = [
  "Aldric", "Brannoc", "Cedwyn", "Daria", "Edric", "Fenna", "Garrow", "Hild", "Isolde", "Jorund",
  "Kestrel", "Leofric", "Maelis", "Osric", "Rowena", "Sigrun", "Tamsin", "Ulric", "Wynne", "Yseult",
];
interface HeroRecruit {
  id: string;
  name: string;
  heroClass: HeroClass;
  tx: number;
  ty: number;
  ticksLeft: number;
}
const heroRecruits: HeroRecruit[] = [];

function heroKey(id: string): string {
  return HERO_KEY_PREFIX + id;
}

function heroBaseStats(cls: HeroClass) {
  return { ...HERO_CLASS_STATS[cls] };
}

function heroTestEvent(e: { type: string; id: string; amount?: number; detail?: string }) {
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
function heroCombatStats(c: Colonist) {
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

function heroRespawnFee(id: string): number {
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

function keepHeroInfo(tx: number, ty: number): NonNullable<BuildingInfo["heroes"]> {
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
  if (!inBounds(tx, ty) || tiles[tileIndex(tx, ty)] !== TileType.Keep) return;
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
  heroRecruits.push({ id, name, heroClass, tx, ty, ticksLeft: instantBuild ? 1 : HERO_RECRUIT_TICKS });
  heroRosterVersion++;
  heroTestEvent({ type: "recruit", id, detail: heroClass });
  broadcastEvent("build", `${name} the ${HERO_CLASS_LABEL[heroClass]} answers the Keep's call (arrives in ${instantBuild ? 0 : HERO_RECRUIT_TICKS / TICK_RATE} s)`);
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
function spawnHeroColonist(id: string, name: string, heroClass: HeroClass, tx: number, ty: number): Colonist {
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
  heroRosterVersion++;
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
  if (player.heroesSentVersion === heroRosterVersion) return payload;
  player.heroesSentVersion = heroRosterVersion;
  return payload.slice(0, -1) + ',"heroes":' + JSON.stringify(heroSheetsSnapshot()) + "}";
}

// ---- Hero phase 4: spells (ROADMAP "Hero phase 4: spells") ----
// The spell table (SPELLS) lives in protocol.ts so the client's tooltips use the same numbers. Every
// profile (the player's and each hero's) has learned spells + 4 spell slots; a spell has a cooldown per
// caster (no mana). Damage / heal / shield amounts scale with the caster's spellPowerMult (gear + a mage's
// SPELL_MAGE_BASE_PCT). Status effects (burn, slow, curse, ward shield, rally buff) and summons live in
// small transient maps (spellStatuses / summonedUntil) and are NOT saved: a load starts with none.
const SPELL_MAGE_BASE_PCT = 25;
// Level-up spell grants: one at each of these levels, the next unlearned spell of the class's order.
const SPELL_GRANT_LEVELS = [2, 4, 6, 8, 10];
const SPELL_LEARN_ORDER: Record<HeroClass | "player", SpellId[]> = {
  player: ["fireBolt", "heal", "ward", "thunder", "rallyBanner"],
  champion: ["rallyBanner", "ward", "curse", "thunder", "heal"],
  marksman: ["fireBolt", "curse", "frost", "thunder", "rallyBanner"],
  mage: ["fireBolt", "frost", "thunder", "heal", "curse", "summon"],
};
// Spell Tomes: the Ogre Warlord always drops one, a mini-boss elite TOME_ELITE_CHANCE, a destroyed camp
// hearth TOME_HEARTH_CHANCE (to the killer, else every connected player's pack, like relics).
const TOME_ELITE_CHANCE = 0.5;
const TOME_HEARTH_CHANCE = 0.1;
// The Church sells the two basic spells to the player (colony gold).
const CHURCH_SPELL_PRICES: Partial<Record<SpellId, number>> = { heal: 80, ward: 120 };
// A cast reaches this far past the spell's range (tiles), so a click on a target's edge still counts.
const SPELL_RANGE_SLACK_PX = TILE_SIZE / 2;
// Hero auto-cast: rules are checked every SPELL_AUTO_EVERY_TICKS; thresholds per rule.
const SPELL_AUTO_EVERY_TICKS = 5;
const SPELL_AUTO_HEAL_BELOW = 0.6;
const SPELL_AUTO_WARD_HURT_TICKS = 2 * TICK_RATE;
const SPELL_AUTO_RALLY_ENGAGED = 4;
const SPELL_AUTO_SUMMON_SCAN_TILES = 6;
let testTomeChance: number | null = null;
// Monotonic spell clock (cycleTick restarts with a load / test hooks; this only counts up).
let spellTick = 0;

interface SpellStatus {
  burnUntil?: number;
  burnNext?: number;
  burnPerSec?: number;
  burnBy?: string;
  slowUntil?: number;
  baseSpeed?: number;
  curseUntil?: number;
  curseBonus?: number;
  shield?: number;
  shieldUntil?: number;
  buffUntil?: number;
  buffDamage?: number;
  buffSpeed?: number;
}
// Keyed "m:<mob id>" / "c:<colonist id>" / "p:<player id>".
const spellStatuses = new Map<string, SpellStatus>();
// Profile key -> spell -> spellTick it is ready again.
const spellCooldowns = new Map<string, Partial<Record<SpellId, number>>>();
// Summoned skeleton militia: colonist id -> spellTick it crumbles.
const summonedUntil = new Map<string, number>();
// Last spellTick a friendly unit / player ("c:" / "p:" key) lost HP (hero Ward auto-cast).
const lastHurtTick = new Map<string, number>();
// Test-hook log (spellState): cast / refuse / learn / tome / burn / absorb / summon / expire.
const spellEvents: { type: string; key?: string; spell?: string; amount?: number; detail?: string; tick: number }[] = [];
function spellEvent(e: Omit<(typeof spellEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  spellEvents.push({ ...e, tick: spellTick });
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
  if (cd) for (const id of SPELL_IDS) if ((cd[id] ?? 0) > spellTick) cooldowns[id] = cd[id]! - spellTick;
  return { learned: [...prof.spells], slots: [...prof.spellSlots], auto: !!prof.heroClass && prof.spellAuto, cooldowns };
}

// Marks a profile for resending (spell book / cooldown changes) without re-deriving its stats.
function touchSpellProfile(prof: HeroProfile) {
  prof.version = ++heroProfileVersionCounter;
  if (prof.heroClass) heroRosterVersion++;
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

function churchSpellShop(player: Player | undefined): NonNullable<BuildingInfo["spellShop"]> {
  const prof = player ? heroProfileOf(player) : null;
  return (Object.keys(CHURCH_SPELL_PRICES) as SpellId[]).map((spellId) => {
    const gold = CHURCH_SPELL_PRICES[spellId]!;
    const reason = prof?.spells.includes(spellId) ? "Already learned" : stock.gold < gold ? "Not enough gold" : "";
    return { spellId, label: SPELLS[spellId].name, gold, enabled: reason === "", reason };
  });
}

function handleLearnSpell(player: Player, spellId: unknown, tx: unknown, ty: unknown) {
  if (!isSpellId(spellId) || typeof tx !== "number" || typeof ty !== "number" || !inBounds(tx, ty)) return;
  if (tiles[tileIndex(tx, ty)] !== TileType.ChurchPost) return refuseSpell(player, "Spells are taught at a Church");
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
function spellDamageTakenMult(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.curseUntil !== undefined && s.curseUntil > spellTick ? 1 + (s.curseBonus ?? 0) : 1;
}

// damagePlayer / damageColonist: a ward shield soaks the blow first. Returns what gets through.
function absorbWithWard(key: string, amount: number): number {
  lastHurtTick.set(key, spellTick);
  const s = spellStatuses.get(key);
  if (!s?.shield || (s.shieldUntil ?? 0) <= spellTick) return amount;
  const soaked = Math.min(s.shield, amount);
  s.shield -= soaked;
  spellEvent({ type: "absorb", key, amount: soaked, detail: String(amount) });
  return amount - soaked;
}

function spellBuffDamageMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > spellTick ? 1 + (s.buffDamage ?? 0) : 1;
}

function spellBuffSpeedMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > spellTick ? 1 + (s.buffSpeed ?? 0) : 1;
}

// A mob's speed is read in many places, so a slow scales `mob.speed` itself and restores it on expiry
// (snapshotWorld saves the unslowed speed).
function slowMob(mob: Mob, fraction: number, ticks: number) {
  const s = statusAt("m:" + mob.id);
  if (s.slowUntil === undefined || s.slowUntil <= spellTick || s.baseSpeed === undefined) {
    s.baseSpeed = mob.speed;
    mob.speed = mob.speed * (1 - fraction);
  }
  s.slowUntil = spellTick + ticks;
}

function unslowedSpeed(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.baseSpeed !== undefined && (s.slowUntil ?? 0) > spellTick ? s.baseSpeed : mob.speed;
}

// Once per tick: burn ticks, expiries, summon despawns.
function updateSpellStatuses() {
  spellTick++;
  for (const [key, s] of Array.from(spellStatuses)) {
    const mob = key.startsWith("m:") ? mobs.get(key.slice(2)) : undefined;
    const alive = mob || (key.startsWith("c:") ? colonists.has(key.slice(2)) : players.has(key.slice(2)));
    if (!alive) {
      spellStatuses.delete(key);
      continue;
    }
    if (mob && s.burnUntil !== undefined) {
      if (s.burnNext !== undefined && spellTick >= s.burnNext && s.burnNext <= s.burnUntil) {
        s.burnNext += TICK_RATE;
        spellEvent({ type: "burn", key, amount: s.burnPerSec });
        damageMob(mob, s.burnPerSec ?? 0, s.burnBy);
      }
      if (spellTick > s.burnUntil) s.burnUntil = s.burnNext = s.burnPerSec = s.burnBy = undefined;
    }
    if (mob && s.slowUntil !== undefined && spellTick >= s.slowUntil) {
      if (s.baseSpeed !== undefined && mobs.has(mob.id)) mob.speed = s.baseSpeed;
      s.slowUntil = s.baseSpeed = undefined;
    }
    if (s.curseUntil !== undefined && spellTick >= s.curseUntil) s.curseUntil = s.curseBonus = undefined;
    if (s.shieldUntil !== undefined && (spellTick >= s.shieldUntil || (s.shield ?? 0) <= 0)) s.shield = s.shieldUntil = undefined;
    if (s.buffUntil !== undefined && spellTick >= s.buffUntil) s.buffUntil = s.buffDamage = s.buffSpeed = undefined;
    if (Object.values(s).every((v) => v === undefined)) spellStatuses.delete(key);
  }
  for (const [id, until] of summonedUntil) {
    const c = colonists.get(id);
    if (!c) {
      summonedUntil.delete(id);
      continue;
    }
    if (spellTick < until) continue;
    summonedUntil.delete(id);
    releaseResourceReservation(c);
    releaseSlot(c.id);
    colonists.delete(id);
    spellEvent({ type: "expire", key: "c:" + id });
  }
  if (spellTick % (5 * TICK_RATE) === 0) {
    for (const [k, t] of lastHurtTick) if (spellTick - t > 5 * TICK_RATE) lastHurtTick.delete(k);
  }
}

function clearSpellState() {
  spellStatuses.clear();
  spellCooldowns.clear();
  summonedUntil.clear();
  lastHurtTick.clear();
}

function isSummoned(c: Colonist): boolean {
  return summonedUntil.has(c.id);
}

// ---- Casting ----
interface SpellCaster {
  prof: HeroProfile;
  x: number;
  y: number;
  // Damage attribution ("p:<player id>" / "c:<hero id>": kills give that caster XP).
  attackerKey: string;
  self: { type: "player"; p: Player } | { type: "colonist"; c: Colonist };
}
type SpellTarget = { targetId?: string; x?: number; y?: number };
type FriendlyUnit = { type: "player"; p: Player } | { type: "colonist"; c: Colonist };

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
  return Math.max(0, (spellCooldowns.get(prof.key)?.[id] ?? 0) - spellTick);
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
        s.burnUntil = spellTick + ticks(def.duration);
        s.burnNext = spellTick + TICK_RATE;
        s.burnPerSec = (def.burnPerSec ?? 0) * sp;
        s.burnBy = caster.attackerKey;
      }
    } else if (id === "curse") {
      const s = statusAt("m:" + mob.id);
      s.curseUntil = spellTick + ticks(def.duration);
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
      s.shieldUntil = spellTick + ticks(def.duration);
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
        s.buffUntil = spellTick + ticks(def.duration);
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
        summonedUntil.set(c.id, spellTick + ticks(def.duration));
        spellEvent({ type: "summon", key: "c:" + c.id });
      }
    }
  }
  let cd = spellCooldowns.get(caster.prof.key);
  if (!cd) {
    cd = {};
    spellCooldowns.set(caster.prof.key, cd);
  }
  cd[id] = spellTick + ticks(def.cooldown);
  touchSpellProfile(caster.prof);
  pendingEffects.push({ fromX: caster.x, fromY: caster.y, toX: fx.x, toY: fx.y, spell: id });
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
      if (hurt === undefined || spellTick - hurt > SPELL_AUTO_WARD_HURT_TICKS) continue;
      const s = spellStatuses.get(key);
      if (s?.shield && (s.shieldUntil ?? 0) > spellTick) continue;
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

function heroAutoCast(c: Colonist) {
  // Strategy mode phase 4: hold fire also holds a hero's auto-spells.
  if (c.holdFire) return;
  if ((spellTick + c.id.charCodeAt(0)) % SPELL_AUTO_EVERY_TICKS !== 0) return;
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
interface ForgeQueueState {
  queue: { slot: EquipSlot; tier: number }[];
  ticksLeft: number;
}
const forgeQueues = new Map<string, ForgeQueueState>();

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

function blacksmithForgeInfo(tx: number, ty: number): NonNullable<BuildingInfo["forge"]> {
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
  if (!inBounds(tx, ty) || tiles[tileIndex(tx, ty)] !== TileType.Blacksmith) return;
  if (slot !== "armour" && slot !== "weapon") return;
  if (forgeQueueBlocker(tx, ty, slot) !== "") return;
  const tier = getBuildingLevel(tx, ty);
  spend(forgeCost(slot, tier));
  const key = resourceKey(tx, ty);
  let state = forgeQueues.get(key);
  if (!state) {
    state = { queue: [], ticksLeft: 0 };
    forgeQueues.set(key, state);
  }
  state.queue.push({ slot, tier });
  if (state.queue.length === 1) state.ticksLeft = instantBuild ? 1 : FORGE_TICKS[slot];
}

// Once per tick: each Blacksmith's first queued item counts down while a smith is posted there.
function updateForges() {
  for (const [key, state] of forgeQueues) {
    const tile = keyToTile(key);
    if (!tile || tiles[tileIndex(tile.x, tile.y)] !== TileType.Blacksmith) {
      forgeQueues.delete(key);
      continue;
    }
    const head = state.queue[0];
    if (!head || !blacksmithStaffed(tile.x, tile.y)) continue;
    if (--state.ticksLeft > 0) continue;
    equipment[head.slot][head.tier - 1]++;
    equipEvent({ type: "forged", slot: head.slot, tier: head.tier, detail: key });
    broadcastEvent("build", `The Blacksmith forged a tier-${head.tier} ${EQUIP_SLOT_LABEL[head.slot]}`);
    state.queue.shift();
    const next = state.queue[0];
    if (next) state.ticksLeft = instantBuild ? 1 : FORGE_TICKS[next.slot];
    else forgeQueues.delete(key);
  }
}

// ---- The raids' siege engines (updateMob hands them to updateSiegeMob once released) ----
// A ram looks for a closed gate within RAM_GATE_SCAN_TILES first, then breaches walls / hits buildings
// like any mob (pickBuildingTarget); units only when it stands next to one and has no building to hit.
const RAM_GATE_SCAN_TILES = 25;
const SIEGE_RETARGET_TICKS = 2 * TICK_RATE;
// Per raid, each siege kind is capped at raidSiegeCap(day): 1 from its unlock day, +1 every 6 days.
function raidSiegeCap(dayIndex: number, kind: SiegeKind): number {
  return Math.max(0, 1 + Math.floor((dayIndex - MOB_KIND_CONFIG[kind].unlockDay) / 6));
}
// testHook "forceRaidSiege" {value:true}: raids pick orc / bandit factions and fill their siege caps first.
let testForceRaidSiege = false;

function pickRamTarget(mob: Mob): PickedTarget | null {
  const wards = activeWardSources();
  const start = tileOfPixel(mob.x, mob.y);
  const closed: { x: number; y: number; d: number }[] = [];
  for (const index of gates.keys()) {
    if (gatePassable(index, true)) continue;
    const x = index % WORLD_TILES_X;
    const y = Math.floor(index / WORLD_TILES_X);
    const c = tileToPixelCenter({ x, y });
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d <= RAM_GATE_SCAN_TILES * TILE_SIZE && !isWarded(c.x, c.y, wards)) closed.push({ x, y, d });
  }
  closed.sort((a, b) => a.d - b.d);
  for (const g of closed.slice(0, 3)) {
    const route = routeToBuilding(start, g.x, g.y, 0);
    if (route) return { type: "building", id: resourceKey(g.x, g.y), approach: route.length > 0 ? route[route.length - 1] : start };
  }
  return pickBuildingTarget(mob, wards);
}

// The best catapult shot from where it stands, within [CATAPULT_MIN_RANGE, its range]: towers first,
// then walls / gates, then any other building or Town Center (nearest in each class), else the unit
// (colonist / player) with the most others within the splash. null: nothing in range.
function pickCatapultShot(mob: Mob): { x: number; y: number } | null {
  const wards = activeWardSources();
  const here = tileOfPixel(mob.x, mob.y);
  const r = Math.ceil(mob.range / TILE_SIZE);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = here.y - r; y <= here.y + r; y++) {
    for (let x = here.x - r; x <= here.x + r; x++) {
      if (!inBounds(x, y) || !structureHp(x, y)) continue;
      const c = tileToPixelCenter({ x, y });
      const d = Math.hypot(c.x - mob.x, c.y - mob.y);
      if (d < CATAPULT_MIN_RANGE || d > mob.range || isWarded(c.x, c.y, wards)) continue;
      const t = tiles[tileIndex(x, y)] as TileType;
      const cls = isTowerTile(t) ? 0 : isWallTile(t) || t === TileType.Gate ? 1 : 2;
      const score = cls * 1e6 + d;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  if (best) return best;
  const units: { x: number; y: number }[] = [];
  for (const c of colonists.values()) if (!isAbbeyClergy(c) && !isWarded(c.x, c.y, wards)) units.push(c);
  for (const p of players.values()) if (!p.dead && !testPlayersIgnored && !isWarded(p.x, p.y, wards)) units.push(p);
  let bestCount = 0;
  for (const u of units) {
    const d = Math.hypot(u.x - mob.x, u.y - mob.y);
    if (d < CATAPULT_MIN_RANGE || d > mob.range) continue;
    const count = units.filter((o) => Math.hypot(o.x - u.x, o.y - u.y) <= CATAPULT_SPLASH_PX).length;
    if (count > bestCount || (count === bestCount && best && d < Math.hypot(best.x - mob.x, best.y - mob.y))) {
      bestCount = count;
      best = { x: u.x, y: u.y };
    }
  }
  return best;
}

// Walks a siege mob along a path to (x, y) (the shared mob pathing, MOB_REPATH_TICKS apart).
function walkSiegeMob(mob: Mob, x: number, y: number, dt: number) {
  if (mob.path.length === 0 && mob.repathCooldown <= 0) {
    const path = findPath(tileOfPixel(mob.x, mob.y), tileOfPixel(x, y));
    mob.path = path ?? [];
    mob.repathCooldown = MOB_REPATH_TICKS;
  } else if (mob.repathCooldown > 0) {
    mob.repathCooldown--;
  }
  advanceAlongPath(mob, dt, mob.speed);
}

function updateSiegeMob(mob: Mob, dt: number, hold: boolean) {
  if (mob.attackCooldownTicks > 0) mob.attackCooldownTicks--;
  if (mob.kind === "catapult") {
    const shot = pickCatapultShot(mob);
    if (shot) {
      mob.path = [];
      const threat = nearestMeleeSoldier(mob.x, mob.y, RANGED_KITE_TILES * TILE_SIZE);
      if (threat && !hold) stepMobAwayFrom(mob, threat.x, threat.y, dt);
      if (mob.attackCooldownTicks <= 0) {
        mob.attackCooldownTicks = CATAPULT_RELOAD_TICKS;
        mobsAttackingThisTick.add(mob.id);
        recordFightHit(mob, (mob.x + shot.x) / 2, (mob.y + shot.y) / 2, "b:siege", mob.damage);
        catapultImpact(mob.x, mob.y, shot.x, shot.y, mob.damage, "mob", "m:" + mob.id);
      }
      return;
    }
    if (hold) return;
    // Nothing in range: advance on the colony like any raider, but never past its regiment's front rank.
    if (!mob.targetType || cycleTick % SIEGE_RETARGET_TICKS === 0) {
      const picked = pickBuildingTarget(mob, activeWardSources());
      mob.targetType = picked?.type ?? null;
      mob.targetId = picked?.id ?? null;
      mob.approachFor = picked?.approach ? picked.id : null;
      mob.approachX = picked?.approach?.x ?? -1;
      mob.approachY = picked?.approach?.y ?? -1;
    }
    const goal = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
    if (!goal) return;
    const regiment = mob.regimentId ?? mob.siteId;
    const frontDist = regiment ? regimentFrontDistance(mob, regiment, goal) : Infinity;
    if (frontDist < Infinity && Math.hypot(goal.x - mob.x, goal.y - mob.y) <= frontDist + TILE_SIZE * 2) {
      mob.path = [];
      return;
    }
    walkSiegeMob(mob, goal.x, goal.y, dt);
    return;
  }
  // Battering ram.
  let targetPos = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
  const onGate = mob.targetType === "building" && mob.targetId !== null && (() => {
    const t = keyToTile(mob.targetId!);
    return !!t && tiles[tileIndex(t.x, t.y)] === TileType.Gate;
  })();
  if (targetPos && mobTargetNeedsRepick(mob)) targetPos = null;
  if (targetPos && !onGate && cycleTick % SIEGE_RETARGET_TICKS === 0) targetPos = null;
  if (!targetPos && !hold) {
    const picked = pickRamTarget(mob);
    if (picked && (picked.id !== mob.targetId || picked.type !== mob.targetType)) {
      mob.path = [];
      mob.repathCooldown = 0;
    }
    mob.targetType = picked?.type ?? null;
    mob.targetId = picked?.id ?? null;
    mob.approachFor = picked?.approach ? picked.id : null;
    mob.approachX = picked?.approach?.x ?? -1;
    mob.approachY = picked?.approach?.y ?? -1;
    targetPos = picked ? resolveTargetPosition(picked.type, picked.id, mob) : null;
  }
  // No building to hit: a unit standing right next to it.
  if (!targetPos) {
    const reach = mob.range + COLONIST_BODY_RADIUS;
    for (const c of colonists.values()) {
      if (!isAbbeyClergy(c) && Math.hypot(c.x - mob.x, c.y - mob.y) <= reach) {
        mob.targetType = "colonist";
        mob.targetId = c.id;
        targetPos = { x: c.x, y: c.y };
        break;
      }
    }
    if (!targetPos) return;
  }
  const dist = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
  if (dist > mob.range) {
    if (!hold) walkSiegeMob(mob, targetPos.x, targetPos.y, dt);
    return;
  }
  mob.path = [];
  mobsAttackingThisTick.add(mob.id);
  if (mob.attackCooldownTicks > 0) return;
  mob.attackCooldownTicks = RAM_ATTACK_COOLDOWN_TICKS;
  const struck = (mob.targetType === "building" || mob.targetType === "townCenter") && mob.targetId ? keyToTile(mob.targetId) : null;
  const hit = struck ? tileToPixelCenter(struck) : targetPos;
  pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: hit.x, toY: hit.y, melee: true });
  if (mob.targetId) recordMobStrike(mob, hit.x, hit.y);
  if (struck) {
    const amount = mob.damage * SIEGE_BUILDING_MULT;
    siegeEvent("ramHit", mob.id, amount, `building:${tiles[tileIndex(struck.x, struck.y)]}`);
    damageBuilding(struck.x, struck.y, amount);
  } else if (mob.targetType === "colonist" && mob.targetId) {
    const c = colonists.get(mob.targetId);
    if (c) {
      siegeEvent("ramHit", mob.id, mob.damage * RAM_UNIT_MULT, "unit");
      damageColonist(c, mob.damage * RAM_UNIT_MULT);
    }
    mob.targetType = null;
    mob.targetId = null;
  }
}

// ---- Building info panel (client left-click) and its Upgrade button ----

// The tile to "place on itself" to upgrade the building at `t` in place (null: not upgradeable).
function upgradePlacementTile(t: TileType): TileType | null {
  if (t === TileType.House || t === TileType.BigHouse) return TileType.House;
  if (t === TileType.KnightPost || t === TileType.CastleLevel2) return TileType.KnightPost;
  if (t === TileType.MilitiaPost || t === TileType.MilitiaCamp2) return TileType.MilitiaPost;
  if (t === TileType.ArcherPost) return TileType.ArcherPost;
  if (t === TileType.Stables) return TileType.Stables;
  if (t === TileType.TownCenter) return TileType.TownCenter;
  return IN_PLACE_UPGRADE_TILES.includes(t) ? t : null;
}

const BUILDING_NAMES: Partial<Record<TileType, string>> = {
  ...UPGRADE_NAMES,
  [TileType.BigHouse]: "Cottage",
  [TileType.HouseLevel2]: "Cottage",
  [TileType.CastleLevel2]: "Hall of the Sworn",
  [TileType.CastleLevel3]: "Hall of the Sworn",
  [TileType.MilitiaCamp2]: "Militia Camp",
  [TileType.MilitiaCamp3]: "Militia Camp",
  [TileType.Market]: "Bazaar",
  [TileType.GoldShop]: "Trading Post",
  [TileType.WardStone]: "Ward Stone",
  [TileType.FarmPlot]: "Farm Plot",
  [TileType.Wall]: "Wood Wall",
  [TileType.StoneWall]: "Stone Wall",
  [TileType.Gate]: "Gate",
  [TileType.Road]: "Road",
  [TileType.CobbleRoad]: "Cobble Road",
  [TileType.SiegeWorkshop]: "Siege Workshop",
};

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

function buildingInfoFor(tx: number, ty: number, forPlayer?: Player): BuildingInfo | null {
  if (!inBounds(tx, ty)) return null;
  const t = tiles[tileIndex(tx, ty)] as TileType;
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
    bonuses.push(`Settlement population cap ${stat?.cap ?? 0}: housing ${stat?.housingCap ?? 0} (10 base, +5 per extra Town Center, +5 per level, houses, Keep), tier ceiling ${stat?.tierCap ?? 0}${stat && stat.keepBonus > 0 ? ` + Keep ${stat.keepBonus}` : ""}`);
    bonuses.push(`${tc.level} builder${tc.level === 1 ? "" : "s"} (one per level)`);
  } else if (isHouseTile(t)) {
    staffing = `Beds ${houseOccupancy(tx, ty)}/${houseCapacity(t)}`;
    let neighbours = 0;
    for (const [dx, dy] of NEIGHBOURS_8) {
      if (!inBounds(tx + dx, ty + dy)) continue;
      const n = tiles[tileIndex(tx + dx, ty + dy)] as TileType;
      if (isSynergyBuilding(n) || isHouseTile(n)) neighbours++;
    }
    bonuses.push(`+${houseCapacity(t)} population (tier ${level})`);
    if (neighbours > 0) bonuses.push(`+${neighbours} population from adjacent houses / workplaces / barracks`);
  } else if (level > 1 && !isMilitaryTile(t) && !isTowerTile(t) && t !== TileType.Keep) {
    bonuses.push(`Lv${level}: ${pct(levelBonus(level))} shorter work cycles`);
  }

  if (isMilitaryTile(t)) {
    const army = armyDamageMultiplier(tx, ty) - 1;
    if (army > 0) bonuses.push(`Unit damage +${pct(army)} (adjacent army buildings / Blacksmith, Town Center level)`);
    const houses = adjacentHouseCount(tx, ty);
    if (houses > 0) bonuses.push(`+${houses} extra unit${houses === 1 ? "" : "s"} from adjacent houses`);
  }
  if (t === TileType.ChurchPost) bonuses.push(`Heals ${healAmountFor(tx, ty)} per prayer`);
  if (t === TileType.BuildersGuild) bonuses.push(`${level} builder${level === 1 ? "" : "s"} (one per level)`);
  if (t === TileType.Stables) {
    bonuses.push(`Lv${level}: ${cavalryCountForLevel(level)} cavalry (fast, wings), charge x${CAVALRY_CHARGE_MULT} after ${CAVALRY_CHARGE_TILES} tiles in a straight line`);
  }
  if (t === TileType.Keep) {
    const stat = settlementStats().find((x) => resourceKey(x.tc.x, x.tc.y) === settlementKeyNear(tx, ty));
    staffing = `Population ${stat?.used ?? 0}/${stat?.cap ?? 0}`;
    bonuses.push(`Keep Lv ${level}: +${KEEP_POPULATION_PER_LEVEL * level} population`);
    bonuses.push(`Recruits up to ${level} hero${level === 1 ? "" : "es"} (one per Keep level), ${HERO_POPULATION_COST} population each`);
  }
  if (t === TileType.Blacksmith) {
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
    bonuses.push(`Happiness ${colonyHappiness}%: work speed x${happinessSpeedMultiplier().toFixed(2)}`);
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
      else if (garrisonGain(placeTile, t, tx, ty) > 0 && settlementBlocker(tx, ty, garrisonGain(placeTile, t, tx, ty)))
        reason = settlementBlocker(tx, ty, garrisonGain(placeTile, t, tx, ty));
      else if (!instantBuild && !anyBuilderAlive() && placeTile !== TileType.TownCenter) reason = "No builders available";
      const tierNote =
        t === TileType.TownCenter
          ? ` (max pop ${settlementTierCap(level + 1)})`
          : t === TileType.Keep
            ? ` (+${KEEP_POPULATION_PER_LEVEL * (level + 1)} population)`
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

  return {
    name,
    tile: t,
    level,
    maxLevel: t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate || t === TileType.SiegeWorkshop || t === TileType.Market || t === TileType.GoldShop || t === TileType.WardStone || t === TileType.FarmPlot || isRoadTile(t) ? 1 : 3,
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
  };
}

function handleUpgradeBuilding(player: Player, tx: number, ty: number) {
  if (!inBounds(tx, ty)) return;
  const placeTile = upgradePlacementTile(tiles[tileIndex(tx, ty)] as TileType);
  if (placeTile === null) return;
  handleSetTile(player, tx, ty, placeTile, true);
}

// ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
// Every blow between a mob and the other side (a soldier/colonist/player hitting a mob, a mob hitting
// a colonist/player/building) is logged as a FightHit. Every FIGHT_SCAN_TICKS, scanFights drops hits
// older than FIGHT_WINDOW_SECONDS and clusters the rest by proximity (FIGHT_CLUSTER_TILES) into
// activeFights, keeping each fight's id while it lasts. Each snapshot then carries the player's own
// relevant subset (fightsForPlayer), spliced into the shared payload by withPlayerFights.
const FIGHT_SCAN_TICKS = Math.round(TICK_RATE / 2);
const FIGHT_WINDOW_TICKS = FIGHT_WINDOW_SECONDS * TICK_RATE;
// Bounds the work in a huge battle: the oldest hits go first past FIGHT_MAX_HITS, and only the
// FIGHT_MAX_TRACKED biggest clusters are kept.
const FIGHT_MAX_HITS = 3000;
const FIGHT_MAX_TRACKED = 32;
// Intensity thresholds (combatants / damage per second).
const FIGHT_BATTLE_COMBATANTS = 5;
const FIGHT_BATTLE_DPS = 20;
const FIGHT_MAJOR_COMBATANTS = 12;
const FIGHT_MAJOR_DPS = 60;

interface FightHit {
  tick: number;
  x: number;
  y: number;
  mobId: string;
  // The mob's opponent: "c:<colonistId>", "p:<playerId>" or "b:<building tile key>".
  other: string;
  amount: number;
  // Colony colonist (not the Abbey's clergy) / colony building involved; the player, if one is.
  units: boolean;
  buildings: boolean;
  playerId: string | null;
  kind: FightKind;
  label: string;
  // Higher wins when a cluster's hits disagree on who the attackers are.
  rank: number;
}

interface ActiveFight extends Omit<FightSnapshot, "you"> {
  playerIds: Set<string>;
  lastTick: number;
}

let fightHits: FightHit[] = [];
let activeFights: ActiveFight[] = [];
let nextFightId = 1;

function clearFights() {
  fightHits = [];
  activeFights = [];
}

const FIGHT_RAID_LABELS: Partial<Record<MobKind, string>> = {
  wolf: "Wolf pack",
  banditClubman: "Bandit raid",
  banditArcher: "Bandit raid",
  banditElite: "Bandit raid",
  skeleton: "Dark host",
  giantSpider: "Dark host",
  darkShaman: "Dark host",
};

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

function recordFightHit(mob: Mob, x: number, y: number, other: string, amount: number) {
  const id = other.slice(2);
  const colonist = other.startsWith("c:") ? colonists.get(id) : undefined;
  fightHits.push({
    tick: cycleTick,
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
  if (fightHits.length > FIGHT_MAX_HITS) fightHits.splice(0, fightHits.length - FIGHT_MAX_HITS);
}

// A mob's own blow on its current target, logged halfway between the two.
function recordMobStrike(mob: Mob, hitX: number, hitY: number) {
  const prefix = mob.targetType === "colonist" ? "c:" : mob.targetType === "player" ? "p:" : "b:";
  recordFightHit(mob, (mob.x + hitX) / 2, (mob.y + hitY) / 2, prefix + mob.targetId, mob.damage);
}

function scanFights() {
  const cutoff = cycleTick - FIGHT_WINDOW_TICKS;
  // A setCycleTick (tests) can move time backwards: future-dated hits go too.
  fightHits = fightHits.filter((h) => h.tick > cutoff && h.tick <= cycleTick);

  interface Cluster {
    sumX: number;
    sumY: number;
    n: number;
    hits: FightHit[];
  }
  const radius = FIGHT_CLUSTER_TILES * TILE_SIZE;
  const clusters: Cluster[] = [];
  for (const h of fightHits) {
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
      quiet: Math.round(((cycleTick - lastTick) / TICK_RATE) * 10) / 10,
      playerIds,
      lastTick,
    };
  });
  next.sort((a, b) => b.combatants - a.combatants);
  next.length = Math.min(next.length, FIGHT_MAX_TRACKED);

  // Keep ids stable: biggest fights first claim the nearest previous fight within ~1.5 radii.
  const unclaimed = activeFights.slice();
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
    f.id = bestIdx >= 0 ? unclaimed.splice(bestIdx, 1)[0].id : nextFightId++;
  }
  activeFights = next;
}

// The colony is shared, so any fight its units or buildings are in concerns every player; other
// fights (a lone rider, the Abbey's clergy) only those within FIGHT_RELEVANCE_TILES. Fights the
// player is in come first, then bigger, then nearer.
function fightsForPlayer(player: Player): FightSnapshot[] {
  if (activeFights.length === 0) return [];
  const ptx = player.x / TILE_SIZE;
  const pty = player.y / TILE_SIZE;
  return activeFights
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

// Interest management (worlds bigger than this): view distance (half-screen at max zoom-out) + margin.
const SNAPSHOT_CULL_MIN_WORLD = 192;
const SNAPSHOT_VIEW_TILES = 60;
// Strategy mode phase 1: a setView rect is capped at this half extent (tiles), padded by the margin, and
// accepted at most once per SET_VIEW_MIN_MS per socket (the client sends at most 5/s).
const STRATEGY_VIEW_MAX_HALF_TILES = 140;
const STRATEGY_VIEW_MARGIN_TILES = 4;
const SET_VIEW_MIN_MS = 100;

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
    x: clamp(x, 0, WORLD_TILES_X) * TILE_SIZE,
    y: clamp(y, 0, WORLD_TILES_Y) * TILE_SIZE,
    halfW: (clamp(halfW, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
    halfH: (clamp(halfH, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
  };
}

const dt = 1 / TICK_RATE;
let wasNight = false;

// One simulation tick (everything the pause freezes). The testHook "fastForward" runs it in a loop.
function stepSimulation() {
  cycleTick++;
  const nightNow = isNightNow();

  if (!nightNow && wasNight) {
    gravestones.length = 0;
    broadcastEvent("dawn", "Dawn breaks — the colony survived the night");
    applyDailyFoodConsumption();
    applyMoraleCheck();
    autosaveDue = true;
  }

  if (nightNow && !wasNight) broadcastEvent("night", "Night falls");
  wasNight = nightNow;

  colonyHappiness = computeColonyHappiness();

  const dayIndex = Math.floor(cycleTick / (DAY_TICKS + NIGHT_TICKS));
  if (!nightNow && cycleTick % (DAY_TICKS + NIGHT_TICKS) >= RAID_SPAWN_CYCLE_TICK && raidSpawnedForDay !== dayIndex) {
    raidSpawnedForDay = dayIndex;
    // With raids switched off by a test the day's raid is skipped for good, not deferred to re-enabling.
    if (!testRaidsDisabled) spawnRaid(dayIndex);
  }

  if (treeRespawnCooldown > 0) {
    treeRespawnCooldown--;
  } else {
    tryGrowTree();
    treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;
  }

  if (lumberjackTreeGrowCooldown > 0) {
    lumberjackTreeGrowCooldown--;
  } else {
    tryGrowTreesNearLumberjackPosts();
    lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;
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
      worldWidth - PLAYER_HALF_SIZE
    );
    if (!collidesAt(nextX, player.y)) player.x = nextX;

    const nextY = clamp(
      player.y + normDy * playerSpeed * dt,
      PLAYER_HALF_SIZE,
      worldHeight - PLAYER_HALF_SIZE
    );
    if (!collidesAt(player.x, nextY)) player.y = nextY;
  }

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
      updateMob(mob, dt);
    }
  });
  updateTowers();
  separateBodies();
  if (cycleTick % TICK_RATE === 0) pruneSlotClaims();
  withHostileMover(() => updateWildlife(dt));
  updateWildlifeRespawn();
  updateGates();

  checkWardStoneLapses();

  updateFarmPlots();
  updateForageRegrow();
  processRespawnQueue();
  updateWardPriestPresence();
  // Dawn/dusk respawn windows: one toast per batch.
  if (respawnWindowSpawned > 0) {
    broadcastEvent(
      "build",
      `Reinforcements arrive at ${respawnWindowAt(cycleTick) ?? "dawn"}: ${respawnWindowSpawned} unit${respawnWindowSpawned === 1 ? "" : "s"} back on duty`
    );
    respawnWindowSpawned = 0;
  }
  respawnDeadPlayers();
  if (cycleTick % TICK_RATE === 0) {
    checkBossSightings();
    evaluateGoals();
  }
  if (cycleTick % FIGHT_SCAN_TICKS === 0) scanFights();
}

setInterval(() => {
  const tickStart = TEST_HOOKS ? performance.now() : 0;
  if (!isPaused && !simHeldForLoad) stepSimulation();
  runDueAutosave();

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
    happiness: colonyHappiness,
    marketBuilt,
    goldShopBuilt,
    isNight: night,
    cycleProgress: (cycleTick % (DAY_TICKS + NIGHT_TICKS)) / (DAY_TICKS + NIGHT_TICKS),
    dayFraction: DAY_TICKS / (DAY_TICKS + NIGHT_TICKS),
    isPaused,
    effects: pendingEffects,
    // The first standing Town Center (the starting one unless it fell); townCenters has them all.
    townCenterHp: townCenters[0] ? Math.max(0, townCenters[0].hp) : 0,
    townCenterMaxHp: townCenterMaxHp(townCenters[0]?.level ?? 1),
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
    difficulty,
    buildingLevels: buildingLevelsForSnapshot(),
    farmStages: farmStagesForSnapshot(),
    constructionSites: constructionSitesForSnapshot(),
    damagedBuildings: damagedBuildingsForSnapshot(),
    hearths: hearthsForSnapshot(),
    equipment,
    townCenters: townCenters.map(
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
      })
    ),
    goal: goalSnapshot,
    gates: gatesForSnapshot(),
    respawn: respawnWindowSnapshot(),
  };
  pendingEffects = [];

  // Small/medium worlds send everyone the same payload. On big worlds each player only gets the mobs and
  // wildlife within view distance + margin (their camera never shows more), keeping snapshots small.
  const cull = WORLD_TILES_X > SNAPSHOT_CULL_MIN_WORLD && snapshot.type === "snapshot";
  const sharedPayload = cull ? "" : JSON.stringify(snapshot);
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
      player.socket.send(withPlayerHeroes(withPlayerProfile(withPlayerFights(payload, player), player), player));
    }
  }
  if (TEST_HOOKS) {
    tickDurationsMs.push(performance.now() - tickStart);
    if (tickDurationsMs.length > TICK_DURATION_SAMPLES) tickDurationsMs.shift();
  }
}, 1000 / TICK_RATE);
