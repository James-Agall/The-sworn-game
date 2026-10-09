import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import {
  ClientMessage,
  ServerMessage,
  PlayerSnapshot,
  ColonistSnapshot,
  ColonistKind,
  MobSnapshot,
  MobKind,
  AttackEffect,
  TileType,
  Biome,
  isSolidTile,
  TICK_RATE,
  TILE_SIZE,
  WORLD_TILES_X,
  WORLD_TILES_Y,
  PLAYER_SPEED,
  PLAYER_HALF_SIZE,
  PLAYER_MAX_HP,
} from "./protocol.js";

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

  castleLevel: number;
  isTower: boolean;

  healTargetType: "player" | "colonist" | null;
  healTargetId: string | null;

  rallyTileX: number;
  rallyTileY: number;
  // Exact pixel point inside the rally tile (a formation slot isn't a tile center, and two slots of
  // a diagonal formation can share one tile). See returnToRally.
  rallyX: number;
  rallyY: number;

  poisonTicksRemaining: number;
  poisonDamagePerTick: number;
}

type MobTargetType = "colonist" | "player" | "townCenter";

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
  siteKind: "ruin" | "encampment" | null;
  guardianActive: boolean;
}

interface RespawnRequest {
  tx: number;
  ty: number;
  kind: ColonistKind;
  ticksRemaining: number;
}

interface FarmPlotState {
  barnX: number;
  barnY: number;
  growTicksRemaining: number;
  harvestTicksRemaining: number;
  state: "growing" | "harvesting";
}

const players = new Map<string, Player>();
const colonists = new Map<string, Colonist>();
const mobs = new Map<string, Mob>();
const worldWidth = WORLD_TILES_X * TILE_SIZE;
const worldHeight = WORLD_TILES_Y * TILE_SIZE;

const tiles = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y).fill(TileType.Empty);
// Parallel to `tiles`; Biome value per tile, regenerated with the rest of the world.
const biomes = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y).fill(Biome.Plains);

const STARTING_WOOD = 80;
const STARTING_IRON = 60;
const STARTING_ROCK = 60;
const STARTING_GRAIN = 40;

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
const archerTowerWallType = new Map<string, TileType>();
const buildingLevel = new Map<string, number>();
const taskForces = new Map<number, string[]>();

function pruneTaskForces() {
  for (const [slot, unitIds] of taskForces) {
    const alive = unitIds.filter((id) => colonists.has(id));
    if (alive.length === 0) {
      taskForces.delete(slot);
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

const TOWN_CENTER_TILE: TileCoord = {
  x: Math.floor(WORLD_TILES_X / 2),
  y: Math.floor(WORLD_TILES_Y / 2),
};
const TOWN_CENTER_MAX_HP = 1000;
let townCenterHp = TOWN_CENTER_MAX_HP;
let townCenterDestroyed = false;
let isPaused = false;

function spawnPointNearTownCenter(): { x: number; y: number } {
  const approach = findAdjacentWalkable(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y);
  return tileToPixelCenter(approach ?? TOWN_CENTER_TILE);
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
      if (isSolidTile(tileAtPixel(px + ox, py + oy))) return true;
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
const TREE_COUNT = 96;
const IRON_ORE_COUNT = 56;
const ROCK_COUNT = 64;

function scatterResourceTiles(tileType: TileType, count: number) {
  const spawnTx = Math.floor(WORLD_TILES_X / 2);
  const spawnTy = Math.floor(WORLD_TILES_Y / 2);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 1000) {
    attempts++;
    const tx = Math.floor(Math.random() * WORLD_TILES_X);
    const ty = Math.floor(Math.random() * WORLD_TILES_Y);
    if (tx === spawnTx && ty === spawnTy) continue;
    if (isInAbbeyGrounds(tx, ty)) continue;
    const idx = tileIndex(tx, ty);
    if (tiles[idx] === TileType.Empty) {
      tiles[idx] = tileType;
      placed++;
    }
  }
}
function isWalkableTile(tx: number, ty: number): boolean {
  return inBounds(tx, ty) && !isSolidTile(tiles[tileIndex(tx, ty)] as TileType);
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

function findPath(start: TileCoord, goal: TileCoord): TileCoord[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];

  const key = (t: TileCoord) => t.y * WORLD_TILES_X + t.x;
  const visited = new Set<number>([key(start)]);
  const parent = new Map<number, TileCoord>();
  const queue: TileCoord[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
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

function advanceAlongPath(
  entity: { x: number; y: number; path: TileCoord[] },
  dt: number,
  speed: number
) {
  if (entity.path.length === 0) return;
  const target = tileToPixelCenter(entity.path[0]);
  const ddx = target.x - entity.x;
  const ddy = target.y - entity.y;
  const dist = Math.hypot(ddx, ddy);
  const step = speed * biomeSpeedMultiplier(entity.x, entity.y) * dt;
  if (dist <= step) {
    entity.x = target.x;
    entity.y = target.y;
    entity.path.shift();
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
  if (c.targetResourceX < 0 || c.targetResourceY < 0) return;
  const key = resourceKey(c.targetResourceX, c.targetResourceY);
  if (reservedResourceTiles.get(key) === c.id) {
    reservedResourceTiles.delete(key);
  }
}

const DAY_TICKS = TICK_RATE * 30;
const NIGHT_TICKS = TICK_RATE * 20;
let cycleTick = 0;
function isNightNow(): boolean {
  const t = cycleTick % (DAY_TICKS + NIGHT_TICKS);
  return t >= DAY_TICKS;
}

const GUARD_ALERT_RANGE_TILES = 7;
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

const ARCHER_TOWER_MAX_HP = 50;
const ARCHER_TOWER_DAMAGE = 14;

const MILITIA_LEVEL_STATS = [
  { maxHp: 30, damage: 6 },
  { maxHp: 50, damage: 10 },
  { maxHp: 80, damage: 16 },
];
const MILITIA_SPEED = 120;

const CIVILIAN_MAX_HP = 20;

function guardStats(kind: ColonistKind, level: number, isTower: boolean) {
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
  if (isTower) {
    return {
      maxHp: Math.round(ARCHER_TOWER_MAX_HP * (1 + bonus)),
      damage: Math.ceil(ARCHER_TOWER_DAMAGE * (1 + bonus)),
      range: ARCHER_ATTACK_RANGE,
      cooldown: Math.round(ARCHER_ATTACK_COOLDOWN_TICKS * (1 - bonus)),
      speed: 0,
      melee: false,
    };
  }
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
  return kind === "knight" || kind === "archer" || isMilitiaLineKind(kind);
}

function isSoldierKind(kind: ColonistKind): boolean {
  return kind === "knight" || kind === "archer" || kind === "militia" || kind === "spearman" || kind === "pikeman";
}

// Speed/range/damage fallbacks for deserter mobs, which take their stats from the deserting
// colonist rather than from MOB_KIND_CONFIG.
const MOB_SPEED = 70;
const MOB_DAMAGE = 5;
const MOB_ATTACK_COOLDOWN_TICKS = TICK_RATE;
const MOB_ATTACK_RANGE = TILE_SIZE * 0.8;
const MOB_REPATH_TICKS = TICK_RATE;
const MOB_SPAWN_INTERVAL_TICKS = TICK_RATE * 3;
const MOB_MAX_COUNT = 8;
// The night-wave cap grows over time so later nights stay a real threat instead of plateauing at
// the same 8 forever, capped so it never gets absurd.
const MOB_MAX_COUNT_GROWTH_INTERVAL_DAYS = 2;
const MOB_MAX_COUNT_CAP = 24;
function currentMobMaxCount(): number {
  const dayIndex = Math.floor(cycleTick / (DAY_TICKS + NIGHT_TICKS));
  return Math.min(MOB_MAX_COUNT_CAP, MOB_MAX_COUNT + Math.floor(dayIndex / MOB_MAX_COUNT_GROWTH_INTERVAL_DAYS));
}
// Flat per-kill gold regardless of monster tier made an Ogre pay the same as a Goblin. Scale off
// the mob's own current maxHp/damage instead of a lookup table, so this also naturally covers
// deserted-colonist mobs (whose stats already reflect how dangerous they were in service).
const GOLD_PER_KILL_BASE_DIVISOR = 8;
const GOLD_PER_KILL_MIN = 3;
function goldForKill(mob: Mob): number {
  return Math.max(GOLD_PER_KILL_MIN, Math.round((mob.maxHp + mob.damage * 2) / GOLD_PER_KILL_BASE_DIVISOR));
}
let mobSpawnCooldown = MOB_SPAWN_INTERVAL_TICKS;

interface MobKindConfig {
  maxHp: number;
  damage: number;
  speed: number;
  range: number; // in pixels, already multiplied by TILE_SIZE
  melee: boolean;
  unlockDay: number;
  weight: number;
}

const MOB_KIND_CONFIG: Record<MobKind, MobKindConfig> = {
  goblin: { maxHp: 18, damage: 4, speed: 95, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0, weight: 10 },
  wolf: { maxHp: 22, damage: 6, speed: 130, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0, weight: 6 },
  goblinCrossbow: { maxHp: 16, damage: 6, speed: 80, range: TILE_SIZE * 4, melee: false, unlockDay: 1, weight: 4 },
  orc: { maxHp: 45, damage: 10, speed: 75, range: TILE_SIZE * 0.8, melee: true, unlockDay: 3, weight: 5 },
  skeleton: { maxHp: 50, damage: 8, speed: 60, range: TILE_SIZE * 0.8, melee: true, unlockDay: 4, weight: 4 },
  armoredOrc: { maxHp: 80, damage: 14, speed: 55, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6, weight: 3 },
  giantSpider: { maxHp: 35, damage: 7, speed: 115, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6, weight: 3 },
  darkShaman: { maxHp: 25, damage: 12, speed: 70, range: TILE_SIZE * 5, melee: false, unlockDay: 7, weight: 2 },
  troll: { maxHp: 120, damage: 16, speed: 65, range: TILE_SIZE * 0.8, melee: true, unlockDay: 10, weight: 2 },
  ogre: { maxHp: 220, damage: 28, speed: 50, range: TILE_SIZE * 0.8, melee: true, unlockDay: 12, weight: 1 },
  // Encampment guardian only. Excluded by name from the night-wave pool (NIGHT_WAVE_EXCLUDED_KINDS);
  // unlockDay/weight are additionally set unreachable/zero as a backstop.
  bandit: {
    maxHp: 40,
    damage: 9,
    speed: 80,
    range: TILE_SIZE * 0.8,
    melee: true,
    unlockDay: Number.POSITIVE_INFINITY,
    weight: 0,
  },
};

// Kinds that only ever come from world-gen POI sites, never from the random night spawner.
const NIGHT_WAVE_EXCLUDED_KINDS = new Set<MobKind>(["bandit"]);

const TROLL_REGEN_DELAY_TICKS = TICK_RATE * 4;
const TROLL_REGEN_PER_TICK = 1;
const POISON_DURATION_TICKS = TICK_RATE * 3;
const POISON_DAMAGE_PER_TICK = 1;
const DARK_SHAMAN_HEAL_RANGE = TILE_SIZE * 5;
const DARK_SHAMAN_HEAL_AMOUNT = 15;
const DARK_SHAMAN_HEAL_COOLDOWN_TICKS = TICK_RATE * 3;

const DESERTER_ACTIVATION_DAYS = 10;
const DESERTER_ACTIVATION_TICKS = DESERTER_ACTIVATION_DAYS * (DAY_TICKS + NIGHT_TICKS);
const DESERTER_WAVE_CHANCE = 0.25;
let suppressMobSpawnTonight = false;

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
const FARM_GROW_TICKS = TICK_RATE * 8;
const FARM_HARVEST_TICKS = TICK_RATE * 2;
const FARM_YIELD_PER_HARVEST = 1;
const LUMBERJACK_WOOD_PER_TRIP = 3;

const FOOD_PER_COLONIST_PER_DAY = 1;
const STARVATION_DAMAGE = 10;
const RESPAWN_DELAY_TICKS = TICK_RATE * 5;
const RESPAWN_FOOD_COST = 5;

const ARCHER_WOOD_COST = 10;
const KNIGHT_IRON_COST = 10;
const KNIGHT_ROCK_COST = 5;
const WOOD_WALL_COST = 1;
const STONE_WALL_COST = 1;
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
const MAX_TREES = 200;
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

const POST_TILE_TYPES = [
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.ArcherPost,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.TownCenter,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.BarnPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ArcherTower,
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
        !isInAbbeyGrounds(tx, ty)
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
        if (isInAbbeyGrounds(tx, ty)) continue;
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

function effectiveChopTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((CHOP_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) / happinessSpeedMultiplier())
  );
}

function effectiveCraftTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(1, Math.round((CRAFT_TICKS * (1 - levelBonus(level))) / happinessSpeedMultiplier()));
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
    return t === TileType.ArcherPost || t === TileType.ArcherTower;
  }
  if (isMilitiaLineKind(kind)) return t === TileType.MilitiaPost || t === TileType.MilitiaCamp2 || t === TileType.MilitiaCamp3;
  if (kind === "lumberjack") return t === TileType.LumberjackPost;
  if (kind === "farmer") return t === TileType.BarnPost;
  if (kind === "ironMiner") return t === TileType.IronMinePost;
  if (kind === "rockMiner") return t === TileType.RockMinePost;
  // Not AbbeyHall: Abbey clergy are world-gen residents and never go through the respawn queue.
  if (kind === "bishop") return t === TileType.ChurchPost || t === TileType.WardStone;
  if (kind === "farmhand") return FARM_PRODUCE_BY_TILE[t] !== undefined;
  if (kind === "artisan") return CRAFT_RECIPES[t] !== undefined;
  return false;
}

function isCivilianKind(kind: ColonistKind): boolean {
  return (
    kind === "lumberjack" ||
    kind === "farmer" ||
    kind === "ironMiner" ||
    kind === "rockMiner" ||
    kind === "farmhand" ||
    kind === "artisan"
  );
}

function consumesPopulation(kind: ColonistKind): boolean {
  return isCivilianKind(kind) || kind === "bishop";
}

// Saint Wren's Abbey's resident clergy: colonists only so the existing bishop code can drive them.
// They aren't the colony's (no population, food, happiness, commands); identified by their post,
// since AbbeyHall is only ever placed by world-gen.
function isAbbeyClergy(c: Colonist): boolean {
  return tiles[tileIndex(c.postX, c.postY)] === TileType.AbbeyHall;
}

function civilianPopulationUsed(): number {
  let count = 0;
  for (const c of colonists.values()) {
    if (consumesPopulation(c.kind) && !isAbbeyClergy(c)) count++;
  }
  return count;
}

const TOWN_CENTER_BASE_POPULATION = 10;

function populationCap(): number {
  let cap = townCenterDestroyed ? 0 : TOWN_CENTER_BASE_POPULATION;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as TileType;
    if (t === TileType.House) cap += 1;
    else if (t === TileType.BigHouse) cap += 3;
    else if (t === TileType.HouseLevel2) cap += 5;
  }
  return cap;
}

function findUpgradeTargetFor(tx: number, ty: number, type: TileType): TileCoord | null {
  const found = adjacentTilesOfType(tx, ty, type)[0];
  if (!found) return null;
  return getBuildingLevel(found.x, found.y) < 3 ? found : null;
}

function placementNeedsNewWorkerSlot(tile: TileType, tx: number, ty: number): boolean {
  if (tile === TileType.LumberjackPost) return findUpgradeTargetFor(tx, ty, TileType.LumberjackPost) === null;
  if (tile === TileType.BarnPost) return findUpgradeTargetFor(tx, ty, TileType.BarnPost) === null;
  if (tile === TileType.ChurchPost) return findUpgradeTargetFor(tx, ty, TileType.ChurchPost) === null;
  if (FARM_PRODUCE_BY_TILE[tile] !== undefined || CRAFT_RECIPES[tile] !== undefined) {
    return findUpgradeTargetFor(tx, ty, tile) === null;
  }
  return true;
}

function spawnColonistForPost(
  tx: number,
  ty: number,
  kind: ColonistKind,
  castleLevel = 1,
  isTower = false
): Colonist {
  const isGuard = kind === "knight" || kind === "archer" || isMilitiaLineKind(kind);
  const stationary = isStationaryMinerKind(kind) || kind === "farmhand";
  const spawnTile = isStationaryWorkerKind(kind) ? { x: tx, y: ty } : findAdjacentWalkable(tx, ty) ?? { x: tx, y: ty };
  const center = tileToPixelCenter(spawnTile);
  const stats = isGuard ? guardStats(kind, castleLevel, isTower) : null;
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
    chopTicksRemaining: stationary
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
    castleLevel,
    isTower,
    healTargetType: null,
    healTargetId: null,
    rallyTileX: tx,
    rallyTileY: ty,
    rallyX: tx * TILE_SIZE + TILE_SIZE / 2,
    rallyY: ty * TILE_SIZE + TILE_SIZE / 2,
    poisonTicksRemaining: 0,
    poisonDamagePerTick: 0,
  };
  colonists.set(colonist.id, colonist);
  return colonist;
}

function queueRespawn(c: Colonist) {
  respawnQueue.push({ tx: c.postX, ty: c.postY, kind: c.kind, ticksRemaining: RESPAWN_DELAY_TICKS });
}

const WALL_TILES = [TileType.Wall, TileType.StoneWall];
const NO_COLONIST_TILES = [
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.Market,
  TileType.GoldShop,
];

function removeColonistForPost(tx: number, ty: number) {
  for (const [id, c] of colonists) {
    if (c.postX === tx && c.postY === ty) {
      releaseResourceReservation(c);
      colonists.delete(id);
    }
  }
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    if (respawnQueue[i].tx === tx && respawnQueue[i].ty === ty) {
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
  kind: "knight" | "archer",
  newLevel: number,
  isTower = false
) {
  const targetCount = guardCountForLevel(newLevel);
  let currentCount = 0;
  for (const c of colonists.values()) {
    if (c.kind === kind && c.postX === tx && c.postY === ty) currentCount++;
  }
  for (let i = currentCount; i < targetCount; i++) {
    spawnColonistForPost(tx, ty, kind, newLevel, isTower);
  }
}

function upgradeKnightAt(tx: number, ty: number, level: number) {
  const stats = guardStats("knight", level, false);
  for (const c of getColonistsAtPost(tx, ty)) {
    if (c.kind !== "knight") continue;
    c.castleLevel = level;
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  spawnExtraGuards(tx, ty, "knight", level, false);
}

function upgradeArcherAt(tx: number, ty: number, level: number, isTower: boolean) {
  for (const c of getColonistsAtPost(tx, ty)) {
    if (c.kind !== "archer") continue;
    c.castleLevel = level;
    const stats = guardStats("archer", level, c.isTower);
    c.maxHp = stats.maxHp;
    c.hp = stats.maxHp;
  }
  spawnExtraGuards(tx, ty, "archer", level, isTower);
}

function upgradeMilitiaAt(tx: number, ty: number, level: number) {
  const newKind = militiaKindForLevel(level);
  const stats = guardStats(newKind, level, false);
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
    spawnColonistForPost(tx, ty, newKind, level, false);
  }
}

function tryLevelUpAdjacent(tx: number, ty: number, matchTypes: TileType[]): TileCoord | null {
  for (const mt of matchTypes) {
    const found = adjacentTilesOfType(tx, ty, mt);
    if (found.length > 0) {
      const n = found[0];
      const currentLevel = getBuildingLevel(n.x, n.y);
      if (currentLevel < 3) {
        buildingLevel.set(resourceKey(n.x, n.y), currentLevel + 1);
        return n;
      }
    }
  }
  return null;
}

function resolveHousePlacement(tx: number, ty: number) {
  const bigNeighbors = adjacentTilesOfType(tx, ty, TileType.BigHouse);
  if (bigNeighbors.length > 0) {
    const n = bigNeighbors[0];
    if (
      stock.grain >= 2 &&
      stock.meat >= 2 &&
      stock.fruit >= 2 &&
      stock.clothes >= 3 &&
      stock.tools >= 2 &&
      stock.luxuryItems >= 1
    ) {
      stock.grain -= 2;
      stock.meat -= 2;
      stock.fruit -= 2;
      stock.clothes -= 3;
      stock.tools -= 2;
      stock.luxuryItems -= 1;
      tiles[tileIndex(n.x, n.y)] = TileType.HouseLevel2;
      broadcastTileUpdate(n.x, n.y, TileType.HouseLevel2);
      return;
    }
  }
  const houseNeighbors = adjacentTilesOfType(tx, ty, TileType.House);
  if (houseNeighbors.length > 0) {
    const n = houseNeighbors[0];
    if (stock.grain >= 1 && stock.meat >= 1 && stock.fruit >= 1 && stock.clothes >= 2) {
      stock.grain -= 1;
      stock.meat -= 1;
      stock.fruit -= 1;
      stock.clothes -= 2;
      tiles[tileIndex(n.x, n.y)] = TileType.BigHouse;
      broadcastTileUpdate(n.x, n.y, TileType.BigHouse);
      return;
    }
  }
  tiles[tileIndex(tx, ty)] = TileType.House;
  broadcastTileUpdate(tx, ty, TileType.House);
}

function resolveKnightPlacement(tx: number, ty: number) {
  const lvl2Neighbors = adjacentTilesOfType(tx, ty, TileType.CastleLevel2);
  if (lvl2Neighbors.length > 0) {
    const n = lvl2Neighbors[0];
    tiles[tileIndex(n.x, n.y)] = TileType.CastleLevel3;
    broadcastTileUpdate(n.x, n.y, TileType.CastleLevel3);
    upgradeKnightAt(n.x, n.y, 3);
    return;
  }
  const knightNeighbors = adjacentTilesOfType(tx, ty, TileType.KnightPost);
  if (knightNeighbors.length > 0) {
    const n = knightNeighbors[0];
    tiles[tileIndex(n.x, n.y)] = TileType.CastleLevel2;
    broadcastTileUpdate(n.x, n.y, TileType.CastleLevel2);
    upgradeKnightAt(n.x, n.y, 2);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.KnightPost;
  broadcastTileUpdate(tx, ty, TileType.KnightPost);
  spawnColonistForPost(tx, ty, "knight", 1, false);
}

function resolveMilitiaPlacement(tx: number, ty: number) {
  const lvl2Neighbors = adjacentTilesOfType(tx, ty, TileType.MilitiaCamp2);
  if (lvl2Neighbors.length > 0) {
    const n = lvl2Neighbors[0];
    tiles[tileIndex(n.x, n.y)] = TileType.MilitiaCamp3;
    broadcastTileUpdate(n.x, n.y, TileType.MilitiaCamp3);
    upgradeMilitiaAt(n.x, n.y, 3);
    return;
  }
  const militiaNeighbors = adjacentTilesOfType(tx, ty, TileType.MilitiaPost);
  if (militiaNeighbors.length > 0) {
    const n = militiaNeighbors[0];
    tiles[tileIndex(n.x, n.y)] = TileType.MilitiaCamp2;
    broadcastTileUpdate(n.x, n.y, TileType.MilitiaCamp2);
    upgradeMilitiaAt(n.x, n.y, 2);
    return;
  }
  tiles[tileIndex(tx, ty)] = TileType.MilitiaPost;
  broadcastTileUpdate(tx, ty, TileType.MilitiaPost);
  spawnColonistForPost(tx, ty, "militia", 1, false);
  spawnColonistForPost(tx, ty, "militia", 1, false);
}

function resolveArcherPlacement(tx: number, ty: number, wallType: TileType | null) {
  const archerNeighbor =
    adjacentTilesOfType(tx, ty, TileType.ArcherPost)[0] ??
    adjacentTilesOfType(tx, ty, TileType.ArcherTower)[0];
  if (archerNeighbor) {
    const currentLevel = getBuildingLevel(archerNeighbor.x, archerNeighbor.y);
    if (currentLevel < 3) {
      const newLevel = currentLevel + 1;
      buildingLevel.set(resourceKey(archerNeighbor.x, archerNeighbor.y), newLevel);
      const neighborIsTower =
        (tiles[tileIndex(archerNeighbor.x, archerNeighbor.y)] as TileType) === TileType.ArcherTower;
      upgradeArcherAt(archerNeighbor.x, archerNeighbor.y, newLevel, neighborIsTower);
      return;
    }
  }
  if (wallType !== null) {
    tiles[tileIndex(tx, ty)] = TileType.ArcherTower;
    archerTowerWallType.set(resourceKey(tx, ty), wallType);
    broadcastTileUpdate(tx, ty, TileType.ArcherTower);
    spawnColonistForPost(tx, ty, "archer", 1, true);
  } else {
    tiles[tileIndex(tx, ty)] = TileType.ArcherPost;
    broadcastTileUpdate(tx, ty, TileType.ArcherPost);
    spawnColonistForPost(tx, ty, "archer", 1, false);
  }
}

function resolveMinePlacement(
  tx: number,
  ty: number,
  mineType: TileType,
  oreType: TileType,
  minerKind: "ironMiner" | "rockMiner"
) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  const mineNeighbor = adjacentTilesOfType(tx, ty, mineType)[0];
  if (mineNeighbor) {
    const currentLevel = getBuildingLevel(mineNeighbor.x, mineNeighbor.y);
    if (currentLevel < 3) {
      buildingLevel.set(resourceKey(mineNeighbor.x, mineNeighbor.y), currentLevel + 1);
      spawnColonistForPost(mineNeighbor.x, mineNeighbor.y, minerKind);
      return;
    }
  }
  tiles[tileIndex(tx, ty)] = mineType;
  broadcastTileUpdate(tx, ty, mineType);
  if (current === oreType) minesPlacedOnOre.add(resourceKey(tx, ty));
  spawnColonistForPost(tx, ty, minerKind);
}

function resolveLumberjackPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.LumberjackPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.LumberjackPost;
  broadcastTileUpdate(tx, ty, TileType.LumberjackPost);
  spawnColonistForPost(tx, ty, "lumberjack");
}

function resolveBarnPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.BarnPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.BarnPost;
  broadcastTileUpdate(tx, ty, TileType.BarnPost);
  spawnColonistForPost(tx, ty, "farmer");
}

function resolveChurchPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.ChurchPost]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.ChurchPost;
  broadcastTileUpdate(tx, ty, TileType.ChurchPost);
  spawnColonistForPost(tx, ty, "bishop");
}

function resolvePasturePlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.Pasture]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Pasture;
  broadcastTileUpdate(tx, ty, TileType.Pasture);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveOrchardPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.Orchard]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Orchard;
  broadcastTileUpdate(tx, ty, TileType.Orchard);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveWoolFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.WoolFarm]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.WoolFarm;
  broadcastTileUpdate(tx, ty, TileType.WoolFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveCottonFarmPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.CottonFarm]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.CottonFarm;
  broadcastTileUpdate(tx, ty, TileType.CottonFarm);
  spawnColonistForPost(tx, ty, "farmhand");
}

function resolveTailorShopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.TailorShop]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.TailorShop;
  broadcastTileUpdate(tx, ty, TileType.TailorShop);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveBlacksmithPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.Blacksmith]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Blacksmith;
  broadcastTileUpdate(tx, ty, TileType.Blacksmith);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveLuxuryWorkshopPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.LuxuryWorkshop]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.LuxuryWorkshop;
  broadcastTileUpdate(tx, ty, TileType.LuxuryWorkshop);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveBreweryPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.Brewery]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Brewery;
  broadcastTileUpdate(tx, ty, TileType.Brewery);
  spawnColonistForPost(tx, ty, "artisan");
}

function resolveTavernPlacement(tx: number, ty: number) {
  const upgraded = tryLevelUpAdjacent(tx, ty, [TileType.Tavern]);
  if (upgraded) return;
  tiles[tileIndex(tx, ty)] = TileType.Tavern;
  broadcastTileUpdate(tx, ty, TileType.Tavern);
  spawnColonistForPost(tx, ty, "artisan");
}

function processRespawnQueue() {
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const req = respawnQueue[i];
    const currentTile = tiles[tileIndex(req.tx, req.ty)] as TileType;
    if (!isValidPostTile(req.kind, currentTile)) {
      respawnQueue.splice(i, 1);
      continue;
    }
    if (consumesPopulation(req.kind) && civilianPopulationUsed() >= populationCap()) {
      continue;
    }
    if (req.ticksRemaining > 0) {
      req.ticksRemaining--;
      continue;
    }
    if (trySpendFood(RESPAWN_FOOD_COST)) {
      const castleLevel =
        req.kind === "knight"
          ? castleLevelForTile(currentTile)
          : req.kind === "archer"
          ? getBuildingLevel(req.tx, req.ty)
          : isMilitiaLineKind(req.kind)
          ? militiaLevelForTile(currentTile)
          : 1;
      const isTower = req.kind === "archer" ? currentTile === TileType.ArcherTower : false;
      const spawnKind = isMilitiaLineKind(req.kind) ? militiaKindForLevel(castleLevel) : req.kind;
      spawnColonistForPost(req.tx, req.ty, spawnKind, castleLevel, isTower);
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
  let needed = consumerCount * FOOD_PER_COLONIST_PER_DAY;
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

function updateFarmPlots() {
  for (const [plotKey, plot] of farmPlots) {
    if (tiles[tileIndex(plot.barnX, plot.barnY)] !== TileType.BarnPost) continue;
    if (!isBarnStaffed(plot.barnX, plot.barnY)) continue;
    const bonus = levelBonus(getBuildingLevel(plot.barnX, plot.barnY));
    const [plotX, plotY] = plotKey.split(",").map(Number);
    const biomeFactor = biomeProductionFactor(plotX, plotY);
    if (plot.state === "harvesting") {
      plot.harvestTicksRemaining--;
      if (plot.harvestTicksRemaining <= 0) {
        stock.grain += FARM_YIELD_PER_HARVEST;
        plot.growTicksRemaining = Math.max(
          1,
          Math.round((FARM_GROW_TICKS * (1 - bonus) * biomeFactor) / happinessSpeedMultiplier())
        );
        plot.state = "growing";
      }
    } else {
      plot.growTicksRemaining--;
      if (plot.growTicksRemaining <= 0) {
        plot.state = "harvesting";
        plot.harvestTicksRemaining = Math.max(
          1,
          Math.round((FARM_HARVEST_TICKS * (1 - bonus) * biomeFactor) / happinessSpeedMultiplier())
        );
      }
    }
  }
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

function updateFarmhand(c: Colonist) {
  const resource = FARM_PRODUCE_BY_TILE[tiles[tileIndex(c.postX, c.postY)] as TileType];
  if (!resource) return;
  c.state = "farming";
  c.chopTicksRemaining--;
  if (c.chopTicksRemaining <= 0) {
    stock[resource] += 1;
    c.chopTicksRemaining = effectiveChopTicks(c.postX, c.postY);
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

function updateShelteringCivilian(c: Colonist, dt: number) {
  const center = tileToPixelCenter(TOWN_CENTER_TILE);
  const dist = Math.hypot(c.x - center.x, c.y - center.y);
  if (dist > TILE_SIZE * 1.5) {
    if (c.path.length === 0) {
      const approach = findAdjacentWalkable(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y);
      const start = tileOfPixel(c.x, c.y);
      const path = approach ? findPath(start, approach) : null;
      c.path = path ?? [];
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
    const step = COLONIST_SPEED * biomeSpeedMultiplier(c.x, c.y) * dt;
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

function findNearestMobInRange(fromX: number, fromY: number, maxRangeTiles: number): Mob | null {
  let best: Mob | null = null;
  let bestDist = Infinity;
  const maxRangePx = maxRangeTiles * TILE_SIZE;
  for (const mob of mobs.values()) {
    const d = Math.hypot(mob.x - fromX, mob.y - fromY);
    if (d <= maxRangePx && d < bestDist) {
      best = mob;
      bestDist = d;
    }
  }
  return best;
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

function damageMob(mob: Mob, amount: number) {
  if (isDormantGuardian(mob)) activateGuardianSite(mob.siteId!);
  mob.hp -= amount;
  mob.lastDamagedTick = cycleTick;
  if (mob.hp <= 0) {
    mobs.delete(mob.id);
    stock.gold += goldForKill(mob);
  }
}

function damagePlayer(player: Player, amount: number) {
  player.hp -= amount;
  if (player.hp <= 0) {
    player.hp = PLAYER_MAX_HP;
    player.poisonTicksRemaining = 0;
    const spawn = spawnPointNearTownCenter();
    player.x = spawn.x;
    player.y = spawn.y;
  }
}

function damageColonist(colonist: Colonist, amount: number) {
  colonist.hp -= amount;
  if (colonist.hp <= 0) {
    releaseResourceReservation(colonist);
    queueRespawn(colonist);
    colonists.delete(colonist.id);
  }
}

const COMMANDABLE_KINDS: ColonistKind[] = ["knight", "archer", "bishop", "militia", "spearman", "pikeman"];

// Only a Church's bishop takes orders: a Ward Stone's bishop must hold his post for the ward to
// stand, and the Abbey's clergy aren't the colony's at all. Mirrored by the client's isCommandable.
function isCommandable(c: Colonist): boolean {
  if (!COMMANDABLE_KINDS.includes(c.kind)) return false;
  return c.kind !== "bishop" || tiles[tileIndex(c.postX, c.postY)] === TileType.ChurchPost;
}

function handleCommandMove(unitIds: string[], x: number, y: number) {
  const tile = tileOfPixel(x, y);
  if (!inBounds(tile.x, tile.y)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c)) continue;
    c.rallyTileX = tile.x;
    c.rallyTileY = tile.y;
    c.rallyX = x;
    c.rallyY = y;
    c.targetMobId = null;
    c.healTargetType = null;
    c.healTargetId = null;
    c.path = [];
    c.repathCooldown = 0;
  }
}

function handleCommandAttack(unitIds: string[], mobId: string) {
  if (!mobs.has(mobId)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind)) continue;
    c.targetMobId = mobId;
    c.path = [];
    c.repathCooldown = 0;
  }
}

function handleAssignTaskForce(slot: number, unitIds: string[]) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) return;
  const valid = unitIds.filter((id) => {
    const c = colonists.get(id);
    return c && isCommandable(c);
  });
  if (valid.length === 0) {
    taskForces.delete(slot);
  } else {
    taskForces.set(slot, valid);
  }
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
  if (attacker.attackCooldownTicks > 0) return;
  attacker.attackCooldownTicks = PLAYER_ATTACK_COOLDOWN_TICKS;

  let bestType: "player" | "mob" | null = null;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const p of players.values()) {
    if (p.id === attacker.id) continue;
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

  if (!bestType || !bestId) return;
  if (bestType === "player") {
    const target = players.get(bestId);
    if (target) damagePlayer(target, PLAYER_ATTACK_DAMAGE);
  } else {
    const target = mobs.get(bestId);
    if (target) damageMob(target, PLAYER_ATTACK_DAMAGE);
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
  const onRallyTile = here.x === rallyTile.x && here.y === rallyTile.y;
  if (c.path.length === 0 && !onRallyTile) {
    c.path = findPath(here, rallyTile) ?? [];
    if (c.path.length === 0) {
      c.state = "idle";
      return;
    }
  }
  // Final leg: once the rally tile is the only step left, the unit is on an edge-adjacent tile, so
  // a straight line to any point in the rally tile stays on those two walkable tiles.
  if (c.path.length === 1 && c.path[0].x === rallyTile.x && c.path[0].y === rallyTile.y) c.path = [];
  if (c.path.length > 0) {
    advanceAlongPath(c, dt, speed);
  } else {
    const step = speed * biomeSpeedMultiplier(c.x, c.y) * dt;
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
  const stats = guardStats(c.kind, c.castleLevel, c.isTower);

  let target = c.targetMobId ? getMobById(c.targetMobId) : undefined;
  if (c.targetMobId && !target) {
    c.targetMobId = null;
    // The chase path leads to where the (now dead/gone) target was; without this the unit would
    // finish walking it before returnToRally plans the route back to its slot.
    c.path = [];
  }

  if (!target) {
    if (c.repathCooldown > 0) {
      c.repathCooldown--;
    } else {
      const found = findNearestMobInRange(c.x, c.y, GUARD_ALERT_RANGE_TILES);
      if (found) {
        c.targetMobId = found.id;
        target = found;
      } else {
        c.repathCooldown = MOB_REPATH_TICKS;
      }
    }
  }

  if (!target) {
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    returnToRally(c, dt, stats.speed);
    return;
  }

  const dist = Math.hypot(target.x - c.x, target.y - c.y);
  if (dist <= stats.range) {
    c.state = "attacking";
    c.path = [];
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
    } else {
      damageMob(target, stats.damage);
      c.attackCooldownTicks = stats.cooldown;
      if (!stats.melee) {
        pendingEffects.push({ fromX: c.x, fromY: c.y, toX: target.x, toY: target.y });
      }
      if (target.hp <= 0) {
        c.targetMobId = null;
      }
    }
  } else {
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    c.state = "engaging";
    if (c.path.length === 0 && c.repathCooldown <= 0) {
      const start = tileOfPixel(c.x, c.y);
      const goalTile = tileOfPixel(target.x, target.y);
      const path = findPath(start, goalTile);
      c.path = path ?? [];
      c.repathCooldown = MOB_REPATH_TICKS;
    } else if (c.repathCooldown > 0) {
      c.repathCooldown--;
    }
    advanceAlongPath(c, dt, stats.speed);
  }
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
    if (p.hp >= PLAYER_MAX_HP) continue;
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
    if (p && p.hp < PLAYER_MAX_HP) targetPos = { x: p.x, y: p.y };
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
        if (p) p.hp = Math.min(PLAYER_MAX_HP, p.hp + amount);
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

// A Ward Stone's bishop keeps the Unbroken Watch: no healing, just holds his place by the stone
// (returnToRally's garrison loiter; his rally is always the stone since he can't be commanded).
function updateWardingBishop(c: Colonist, dt: number) {
  returnToRally(c, dt, BISHOP_SPEED);
  if (c.state === "idle") c.state = "warding";
}

// Every position currently under a ward: the Abbey (always) plus each Ward Stone whose bishop is
// alive and stationed at it. A dead bishop is already gone from `colonists`, so the stone's ward
// lapses the same tick and stays down until the respawn queue refills the post.
function activeWardSources(): TileCoord[] {
  const sources: TileCoord[] = abbeyCenter ? [abbeyCenter] : [];
  for (const c of colonists.values()) {
    if (c.kind !== "bishop" || tiles[tileIndex(c.postX, c.postY)] !== TileType.WardStone) continue;
    const post = tileToPixelCenter({ x: c.postX, y: c.postY });
    if (Math.hypot(c.x - post.x, c.y - post.y) > GARRISON_LOITER_PX) continue;
    sources.push({ x: c.postX, y: c.postY });
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
        c.state = "idle";
      }
      c.path = [];
    } else if (!night && c.sheltering) {
      c.sheltering = false;
      c.path = [];
    }
    if (c.sheltering) {
      updateShelteringCivilian(c, dt);
      return;
    }
    if (stationaryWorker) {
      const postCenter = tileToPixelCenter({ x: c.postX, y: c.postY });
      const distToPost = Math.hypot(c.x - postCenter.x, c.y - postCenter.y);
      if (c.path.length > 0 || distToPost > 2) {
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
      break;
    case "knight":
    case "archer":
    case "militia":
    case "spearman":
    case "pikeman":
      updateGuardColonist(c, dt);
      break;
    case "bishop":
      if (tiles[tileIndex(c.postX, c.postY)] === TileType.WardStone) updateWardingBishop(c, dt);
      else updateBishopColonist(c, dt);
      break;
  }
}

function randomEdgeTile(): TileCoord {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.floor(Math.random() * WORLD_TILES_X), y: 0 };
  if (side === 1) return { x: Math.floor(Math.random() * WORLD_TILES_X), y: WORLD_TILES_Y - 1 };
  if (side === 2) return { x: 0, y: Math.floor(Math.random() * WORLD_TILES_Y) };
  return { x: WORLD_TILES_X - 1, y: Math.floor(Math.random() * WORLD_TILES_Y) };
}

function activeMobCount(): number {
  let count = 0;
  for (const m of mobs.values()) {
    if (isDormantGuardian(m)) continue;
    if (!m.isDeserter || m.deserterActive) count++;
  }
  return count;
}

function pickMobKindForSpawn(dayIndex: number): MobKind {
  const eligible = (Object.keys(MOB_KIND_CONFIG) as MobKind[]).filter(
    (k) => !NIGHT_WAVE_EXCLUDED_KINDS.has(k) && MOB_KIND_CONFIG[k].unlockDay <= dayIndex
  );
  const totalWeight = eligible.reduce((sum, k) => sum + MOB_KIND_CONFIG[k].weight, 0);
  let roll = Math.random() * totalWeight;
  for (const k of eligible) {
    roll -= MOB_KIND_CONFIG[k].weight;
    if (roll < 0) return k;
  }
  return eligible[eligible.length - 1];
}

function spawnMob() {
  let spot: TileCoord | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomEdgeTile();
    if (isWalkableTile(candidate.x, candidate.y)) {
      spot = candidate;
      break;
    }
  }
  if (!spot) return;
  const center = tileToPixelCenter(spot);
  const dayIndex = Math.floor(cycleTick / (DAY_TICKS + NIGHT_TICKS));
  const kind = pickMobKindForSpawn(dayIndex);
  const config = MOB_KIND_CONFIG[kind];
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
    siteId: null,
    siteKind: null,
    guardianActive: false,
  };
  mobs.set(mob.id, mob);
}

// Candidates under an active ward are skipped. If that leaves nothing, returns null and updateMob
// leaves the mob standing where it is until something targetable turns up (same as before when
// there was simply nothing to attack).
function pickMobTarget(mob: Mob): { type: MobTargetType; id: string | null } | null {
  const wards = activeWardSources();
  let bestGuard: Colonist | null = null;
  let bestGuardDist = Infinity;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (isWarded(c.x, c.y, wards)) continue;
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d < bestGuardDist) {
      bestGuardDist = d;
      bestGuard = c;
    }
  }
  if (bestGuard) return { type: "colonist", id: bestGuard.id };

  let bestPlayer: Player | null = null;
  let bestPlayerDist = Infinity;
  for (const p of players.values()) {
    if (isWarded(p.x, p.y, wards)) continue;
    const d = Math.hypot(p.x - mob.x, p.y - mob.y);
    if (d < bestPlayerDist) {
      bestPlayerDist = d;
      bestPlayer = p;
    }
  }
  if (bestPlayer) return { type: "player", id: bestPlayer.id };

  const townCenterPos = resolveTargetPosition("townCenter", null);
  if (townCenterPos && !isWarded(townCenterPos.x, townCenterPos.y, wards)) return { type: "townCenter", id: null };
  return null;
}

function resolveTargetPosition(
  targetType: MobTargetType,
  targetId: string | null
): { x: number; y: number } | null {
  if (targetType === "colonist") {
    if (!targetId) return null;
    const c = colonists.get(targetId);
    return c ? { x: c.x, y: c.y } : null;
  }
  if (targetType === "player") {
    if (!targetId) return null;
    const p = players.get(targetId);
    return p ? { x: p.x, y: p.y } : null;
  }
  if (townCenterDestroyed) return null;
  const approach = findAdjacentWalkable(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y);
  return tileToPixelCenter(approach ?? TOWN_CENTER_TILE);
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

  let targetPos = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId) : null;
  // A target that has since moved under (or been covered by) an active ward is dropped and re-picked.
  if (targetPos && isWarded(targetPos.x, targetPos.y, activeWardSources())) targetPos = null;

  if (!targetPos) {
    const picked = pickMobTarget(mob);
    if (picked) {
      mob.targetType = picked.type;
      mob.targetId = picked.id;
      targetPos = resolveTargetPosition(picked.type, picked.id);
    } else {
      mob.targetType = null;
      mob.targetId = null;
    }
  }

  if (!targetPos) return;

  const dist = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
  if (dist <= mob.range) {
    mob.path = [];
    if (mob.attackCooldownTicks > 0) {
      mob.attackCooldownTicks--;
    } else {
      mob.attackCooldownTicks = MOB_ATTACK_COOLDOWN_TICKS;
      if (!mob.melee) {
        pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: targetPos.x, toY: targetPos.y });
      }
      if (mob.targetType === "colonist" && mob.targetId) {
        const c = colonists.get(mob.targetId);
        if (c) {
          if (mob.kind === "giantSpider") {
            c.poisonTicksRemaining = POISON_DURATION_TICKS;
            c.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damageColonist(c, mob.damage);
        }
      } else if (mob.targetType === "player" && mob.targetId) {
        const p = players.get(mob.targetId);
        if (p) {
          if (mob.kind === "giantSpider") {
            p.poisonTicksRemaining = POISON_DURATION_TICKS;
            p.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damagePlayer(p, mob.damage);
        }
      } else if (mob.targetType === "townCenter" && !townCenterDestroyed) {
        townCenterHp -= mob.damage;
        if (townCenterHp <= 0) {
          townCenterHp = 0;
          townCenterDestroyed = true;
          tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.Empty;
          broadcastTileUpdate(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y, TileType.Empty);
        }
      }
    }
  } else {
    if (mob.path.length === 0 && mob.repathCooldown <= 0) {
      const start = tileOfPixel(mob.x, mob.y);
      const goalTile = tileOfPixel(targetPos.x, targetPos.y);
      const path = findPath(start, goalTile);
      mob.path = path ?? [];
      mob.repathCooldown = MOB_REPATH_TICKS;
    } else if (mob.repathCooldown > 0) {
      mob.repathCooldown--;
    }
    advanceAlongPath(mob, dt, mob.speed);
  }
}

// ---- World generation: biomes, ponds, resource scatter, POI sites (ruins / encampments) ----

// Nothing world-gen places (biome seeds, ponds, POI sites) comes closer than this to the Town Center.
const SPAWN_CLEAR_RADIUS_TILES = 15;
// Biome blobs (including edge jitter) never reach within this many tiles of the Town Center, so the
// starting area is always Plains. A seed's own min distance from spawn is therefore
// max(SPAWN_CLEAR_RADIUS_TILES, radius + BIOME_EDGE_JITTER_TILES + this).
const SPAWN_PLAINS_RADIUS_TILES = 6;

const BIOME_SEEDS_PER_KIND = 5;
// Plains is meant to be the majority biome (the default colony-building terrain), with Hills and
// Swamp as scattered regional pockets. 14-18 made Hills+Swamp cover ~70% of the map instead;
// 10-13 brings Plains back to roughly half, per the executor's own simulation.
const BIOME_SEED_RADIUS_MIN = 10;
const BIOME_SEED_RADIUS_MAX = 13;
const BIOME_SEED_MIN_SPACING = 12;
const BIOME_EDGE_JITTER_TILES = 3;
const BIOME_NOISE_CELL_TILES = 4;

const POND_COUNT_MIN = 8;
const POND_COUNT_MAX = 12;
const POND_RADIUS_MIN = 2;
const POND_RADIUS_MAX = 4;
const POND_EDGE_JITTER_TILES = 1;
const POND_NOISE_CELL_TILES = 2;
const POND_MIN_SPACING = 12;

const RUIN_SITE_COUNT_MIN = 6;
const RUIN_SITE_COUNT_MAX = 10;
const ENCAMPMENT_SITE_COUNT_MIN = 6;
const ENCAMPMENT_SITE_COUNT_MAX = 10;
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

function spawnGuardian(kind: MobKind, tile: TileCoord, siteId: string, siteKind: "ruin" | "encampment") {
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
  };
  mobs.set(mob.id, mob);
}

function pickRuinGuardianKind(): MobKind {
  const total = RUIN_GUARDIAN_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of RUIN_GUARDIAN_WEIGHTS) {
    roll -= w.weight;
    if (roll < 0) return w.kind;
  }
  return RUIN_GUARDIAN_WEIGHTS[0].kind;
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
  for (const spot of shuffled(guardianSpots).slice(0, guardianCount)) {
    spawnGuardian(siteKind === "ruin" ? pickRuinGuardianKind() : "bandit", spot, siteId, siteKind);
  }
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

// Saint Wren's Abbey: lays out ABBEY_LAYOUT around a clear spot (grounds + apron all Empty, no
// water) and posts its three resident clergy at the hall. Runs before resources are scattered, so
// the 11x11 clear area is only ever contested by ponds; scatter and tree regrowth then skip the
// grounds (isInAbbeyGrounds). Adds the Abbey's center to placedSites so later POIs keep their spacing.
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

// Full world regeneration (boot + restart). Callers must clear `mobs` and `colonists` first: this
// spawns the new world's POI guardians and Abbey clergy into them. Order: biomes (own layer) ->
// ponds -> Abbey -> resources -> POI sites, each step only ever writing onto Empty tiles, so nothing
// lands on top of anything placed before it.
function generateWorld() {
  tiles.fill(TileType.Empty);
  biomes.fill(Biome.Plains);
  worldNoiseSalt = Math.floor(Math.random() * 0x7fffffff);
  abbeyCenter = null;
  tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;
  generateBiomes();
  generatePonds();
  const placedSites: TileCoord[] = [];
  placeAbbey(placedSites);
  scatterResourceTiles(TileType.Tree, TREE_COUNT);
  scatterResourceTiles(TileType.IronOre, IRON_ORE_COUNT);
  scatterResourceTiles(TileType.Rock, ROCK_COUNT);
  generatePoiSites("ruin", randInt(RUIN_SITE_COUNT_MIN, RUIN_SITE_COUNT_MAX), placedSites);
  generatePoiSites("encampment", randInt(ENCAMPMENT_SITE_COUNT_MIN, ENCAMPMENT_SITE_COUNT_MAX), placedSites);
}

generateWorld();

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6];
let nextColorIndex = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function broadcastTileUpdate(tx: number, ty: number, tile: TileType) {
  const update: ServerMessage = { type: "tileUpdate", tileX: tx, tileY: ty, tile };
  const payload = JSON.stringify(update);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

const wss = new WebSocketServer({ port: 8080 });
console.log("colony2d server listening on ws://localhost:8080");

function sendWelcome(player: Player) {
  const welcome: ServerMessage = {
    type: "welcome",
    id: player.id,
    tileSize: TILE_SIZE,
    worldTilesX: WORLD_TILES_X,
    worldTilesY: WORLD_TILES_Y,
    tiles: Array.from(tiles),
    biomes: Array.from(biomes),
  };
  player.socket.send(JSON.stringify(welcome));
}

function resetWorld() {
  // mobs/colonists must be cleared before generateWorld, which spawns the fresh POI guardians and
  // Abbey clergy.
  colonists.clear();
  mobs.clear();
  generateWorld();

  respawnQueue.length = 0;
  farmPlots.clear();
  minesPlacedOnOre.clear();
  archerTowerWallType.clear();
  buildingLevel.clear();
  reservedResourceTiles.clear();
  taskForces.clear();
  pendingEffects = [];

  Object.assign(stock, initialStock());
  marketBuilt = false;
  goldShopBuilt = false;
  colonyHappiness = 100;
  suppressMobSpawnTonight = false;

  townCenterHp = TOWN_CENTER_MAX_HP;
  townCenterDestroyed = false;

  cycleTick = 0;
  wasNight = false;
  mobSpawnCooldown = MOB_SPAWN_INTERVAL_TICKS;
  treeRespawnCooldown = TREE_RESPAWN_INTERVAL_TICKS;
  lumberjackTreeGrowCooldown = LUMBERJACK_TREE_INTERVAL_TICKS;
  isPaused = false;

  for (const player of players.values()) {
    const spawn = spawnPointNearTownCenter();
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = PLAYER_MAX_HP;
    player.attackCooldownTicks = 0;
    player.poisonTicksRemaining = 0;
    player.poisonDamagePerTick = 0;
    player.input = { dx: 0, dy: 0 };
  }

  for (const player of players.values()) {
    sendWelcome(player);
  }
}

wss.on("connection", (socket) => {
  const id = randomUUID();
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
  };
  players.set(id, player);

  sendWelcome(player);

  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
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
    } else if (message.type === "pause") {
      isPaused = !isPaused;
    } else if (message.type === "restart") {
      resetWorld();
    } else if (message.type === "commandMove") {
      handleCommandMove(message.unitIds, message.x, message.y);
    } else if (message.type === "commandAttack") {
      handleCommandAttack(message.unitIds, message.mobId);
    } else if (message.type === "assignTaskForce") {
      handleAssignTaskForce(message.slot, message.unitIds);
    } else if (message.type === "exchangeResource") {
      handleExchangeResource(message.from, message.to);
    } else if (message.type === "buyWithGold") {
      handleBuyWithGold(message.item);
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
  TileType.ArcherTower,
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
];
const CRAFT_BUILDING_TILES = [TileType.TailorShop, TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Brewery];

function handleSetTile(player: Player, tx: number, ty: number, tile: TileType) {
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;

  const tileCenter = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(player.x - tileCenter.x, player.y - tileCenter.y);
  if (dist > REACH) return;

  const current = tiles[tileIndex(tx, ty)] as TileType;

  if (tile === TileType.Empty) {
    if (!BREAKABLE_TILES.includes(current)) return;
    if (!NO_COLONIST_TILES.includes(current)) {
      removeColonistForPost(tx, ty);
    }
    buildingLevel.delete(resourceKey(tx, ty));
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
    if (current === TileType.ArcherTower) {
      const key = resourceKey(tx, ty);
      const revert = archerTowerWallType.get(key) ?? TileType.Empty;
      archerTowerWallType.delete(key);
      tiles[tileIndex(tx, ty)] = revert;
      broadcastTileUpdate(tx, ty, revert);
      return;
    }
    tiles[tileIndex(tx, ty)] = TileType.Empty;
    broadcastTileUpdate(tx, ty, TileType.Empty);
    return;
  }

  if (tile === TileType.IronMinePost) {
    const onOre = current === TileType.IronOre;
    const adjacentToMine =
      !onOre && current === TileType.Empty && adjacentTilesOfType(tx, ty, TileType.IronMinePost).length > 0;
    if (!onOre && !adjacentToMine) return;
  } else if (tile === TileType.RockMinePost) {
    const onOre = current === TileType.Rock;
    const adjacentToMine =
      !onOre && current === TileType.Empty && adjacentTilesOfType(tx, ty, TileType.RockMinePost).length > 0;
    if (!onOre && !adjacentToMine) return;
  } else if (tile === TileType.FarmPlot) {
    if (current !== TileType.Empty) return;
    if (adjacentTilesOfType(tx, ty, TileType.BarnPost).length === 0) return;
  } else if (tile === TileType.ArcherPost) {
    if (current !== TileType.Empty && !WALL_TILES.includes(current)) return;
  } else {
    if (current !== TileType.Empty) return;
  }

  if (tile === TileType.Wall && stock.wood < WOOD_WALL_COST) return;
  if (tile === TileType.StoneWall && stock.rock < STONE_WALL_COST) return;
  if (tile === TileType.ArcherPost && stock.wood < ARCHER_WOOD_COST) return;
  if (tile === TileType.KnightPost && (stock.iron < KNIGHT_IRON_COST || stock.rock < KNIGHT_ROCK_COST)) return;
  if (tile === TileType.House && stock.wood < HOUSE_WOOD_COST) return;
  if (tile === TileType.BarnPost && stock.wood < BARN_WOOD_COST) return;
  if (tile === TileType.ChurchPost && stock.wood < CHURCH_WOOD_COST) return;
  if (tile === TileType.WardStone && (stock.wood < WARD_STONE_WOOD_COST || stock.tools < WARD_STONE_TOOLS_COST)) return;
  if (
    CRAFT_BUILDING_TILES.includes(tile) &&
    (stock.wood < CRAFT_BUILDING_WOOD_COST || stock.iron < CRAFT_BUILDING_IRON_COST)
  )
    return;
  if ((tile === TileType.Market || tile === TileType.GoldShop) && stock.wood < SHOP_WOOD_COST) return;
  if (tile === TileType.Tavern && (stock.wood < TAVERN_WOOD_COST || stock.rock < TAVERN_ROCK_COST)) return;
  if (tile === TileType.MilitiaPost && (stock.wood < MILITIA_WOOD_COST || stock.iron < MILITIA_IRON_COST)) return;
  if (
    POPULATION_GATED_TILES.includes(tile) &&
    placementNeedsNewWorkerSlot(tile, tx, ty) &&
    civilianPopulationUsed() >= populationCap()
  )
    return;

  if (tile !== TileType.FarmPlot) {
    for (const other of players.values()) {
      const otherTile = tileOfPixel(other.x, other.y);
      if (otherTile.x === tx && otherTile.y === ty) return;
    }
    for (const c of colonists.values()) {
      const ct = tileOfPixel(c.x, c.y);
      if (ct.x === tx && ct.y === ty) return;
    }
  }

  if (tile === TileType.Wall) stock.wood -= WOOD_WALL_COST;
  if (tile === TileType.StoneWall) stock.rock -= STONE_WALL_COST;
  if (tile === TileType.ArcherPost) stock.wood -= ARCHER_WOOD_COST;
  if (tile === TileType.KnightPost) {
    stock.iron -= KNIGHT_IRON_COST;
    stock.rock -= KNIGHT_ROCK_COST;
  }
  if (tile === TileType.House) stock.wood -= HOUSE_WOOD_COST;
  if (tile === TileType.BarnPost) stock.wood -= BARN_WOOD_COST;
  if (tile === TileType.ChurchPost) stock.wood -= CHURCH_WOOD_COST;
  if (tile === TileType.WardStone) {
    stock.wood -= WARD_STONE_WOOD_COST;
    stock.tools -= WARD_STONE_TOOLS_COST;
  }
  if (CRAFT_BUILDING_TILES.includes(tile)) {
    stock.wood -= CRAFT_BUILDING_WOOD_COST;
    stock.iron -= CRAFT_BUILDING_IRON_COST;
  }
  if (tile === TileType.Market || tile === TileType.GoldShop) stock.wood -= SHOP_WOOD_COST;
  if (tile === TileType.Tavern) {
    stock.wood -= TAVERN_WOOD_COST;
    stock.rock -= TAVERN_ROCK_COST;
  }
  if (tile === TileType.MilitiaPost) {
    stock.wood -= MILITIA_WOOD_COST;
    stock.iron -= MILITIA_IRON_COST;
  }

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
    const wallType = WALL_TILES.includes(current) ? current : null;
    resolveArcherPlacement(tx, ty, wallType);
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
    tiles[tileIndex(tx, ty)] = tile;
    broadcastTileUpdate(tx, ty, tile);
    const barn = adjacentTilesOfType(tx, ty, TileType.BarnPost)[0];
    farmPlots.set(resourceKey(tx, ty), {
      barnX: barn.x,
      barnY: barn.y,
      growTicksRemaining: FARM_GROW_TICKS,
      harvestTicksRemaining: 0,
      state: "growing",
    });
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
    spawnColonistForPost(tx, ty, "bishop");
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

const dt = 1 / TICK_RATE;
let wasNight = false;

setInterval(() => {
  if (!isPaused) {
    cycleTick++;
    const nightNow = isNightNow();

    if (!nightNow && wasNight) {
      applyDailyFoodConsumption();
      applyMoraleCheck();
    }

    if (nightNow && !wasNight) {
      const eligibleDeserters = Array.from(mobs.values()).filter(
        (m) => m.isDeserter && !m.deserterActive && cycleTick - m.deserterSinceTick >= DESERTER_ACTIVATION_TICKS
      );
      suppressMobSpawnTonight = eligibleDeserters.length > 0 && Math.random() < DESERTER_WAVE_CHANCE;
      if (suppressMobSpawnTonight) {
        for (const m of eligibleDeserters) m.deserterActive = true;
      }
    }
    wasNight = nightNow;

    colonyHappiness = computeColonyHappiness();

    if (nightNow) {
      if (!suppressMobSpawnTonight) {
        if (mobSpawnCooldown > 0) {
          mobSpawnCooldown--;
        } else if (activeMobCount() < currentMobMaxCount()) {
          spawnMob();
          mobSpawnCooldown = MOB_SPAWN_INTERVAL_TICKS;
        }
      }
    } else {
      mobSpawnCooldown = Math.min(mobSpawnCooldown, MOB_SPAWN_INTERVAL_TICKS);
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

      const { dx, dy } = player.input;
      const length = Math.hypot(dx, dy) || 1;
      const normDx = dx / length;
      const normDy = dy / length;
      const playerSpeed = PLAYER_SPEED * biomeSpeedMultiplier(player.x, player.y);

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

    for (const colonist of colonists.values()) {
      updateColonist(colonist, dt);
    }

    for (const mob of mobs.values()) {
      updateMob(mob, dt);
    }

    updateFarmPlots();
    processRespawnQueue();
  }

  const night = isNightNow();
  pruneTaskForces();

  const snapshot: ServerMessage = {
    type: "snapshot",
    players: Array.from(players.values()).map((p): PlayerSnapshot => ({
      id: p.id,
      x: p.x,
      y: p.y,
      color: p.color,
      hp: p.hp,
      maxHp: PLAYER_MAX_HP,
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
    })),
    mobs: Array.from(mobs.values()).map((m): MobSnapshot => ({
      id: m.id,
      kind: m.kind,
      x: m.x,
      y: m.y,
      hp: m.hp,
      maxHp: m.maxHp,
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
    isPaused,
    effects: pendingEffects,
    townCenterHp,
    townCenterMaxHp: TOWN_CENTER_MAX_HP,
    population: civilianPopulationUsed(),
    populationCap: populationCap(),
    taskForces: taskForcesForSnapshot(),
  };
  pendingEffects = [];

  const payload = JSON.stringify(snapshot);
  for (const player of players.values()) {
    if (player.socket.readyState === player.socket.OPEN) {
      player.socket.send(payload);
    }
  }
}, 1000 / TICK_RATE);
