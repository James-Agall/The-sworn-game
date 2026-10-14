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
  Stance,
  GameEventCategory,
  GravestoneSnapshot,
  Difficulty,
  WildlifeKind,
  WILDLIFE_KINDS,
  WildlifeState,
  TileType,
  Biome,
  isSolidTile,
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
} from "./protocol.js";

// The scripted server/*.mjs tests assume 80x80: run the server with COLONY_WORLD_SIZE=80 for them.
const WORLD_TILES_X = Number.parseInt(process.env.COLONY_WORLD_SIZE ?? "", 10) || DEFAULT_WORLD_TILES;
const WORLD_TILES_Y = WORLD_TILES_X;
// World-gen counts below were tuned on 80x80; scale them by area so bigger maps keep the same density.
const WORLD_AREA_SCALE = (WORLD_TILES_X * WORLD_TILES_Y) / (80 * 80);
const scaledCount = (n: number) => Math.round(n * WORLD_AREA_SCALE);

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
  // Night shelter: a house tile, or the Town Center when homeTileX < 0. Reset each dawn.
  shelterAssigned: boolean;
  homeTileX: number;
  homeTileY: number;

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

  // Only read by updateGuardColonist (see STANCE_ALERT_RANGE_TILES / STANCE_CHASE_LEASH_TILES).
  stance: Stance;

  poisonTicksRemaining: number;
  poisonDamagePerTick: number;

  // Hunter: the animal it is stalking/shooting (reserved via Wildlife.reservedBy). Hunter/forager:
  // the meat/fruit carried back to the hut, deposited on arrival.
  targetWildlifeId: number | null;
  carryAmount: number;
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
  // Raid-wave group (see raidGroups). While groupId is set the mob is driven by updateRaidGroups,
  // not by updateMob's per-mob targeting; passive is true until its group turns aggressive.
  groupId: string | null;
  passive: boolean;
}

interface RespawnRequest {
  tx: number;
  ty: number;
  kind: ColonistKind;
  ticksRemaining: number;
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
  state: "sown" | "growing" | "harvesting" | "fallow";
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
const TREE_COUNT = scaledCount(96);
const IRON_ORE_COUNT = scaledCount(56);
const ROCK_COUNT = scaledCount(64);

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

const DAY_TICKS = TICK_RATE * 60;
const NIGHT_TICKS = TICK_RATE * 40;
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
const STANCE_CHASE_LEASH_TILES: Record<Stance, number> = {
  defensive: 2,
  normal: 10,
  aggressive: 20,
};
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
// Flat per-kill gold regardless of monster tier made an Ogre pay the same as a Goblin. Scale off
// the mob's own current maxHp/damage instead of a lookup table, so this also naturally covers
// deserted-colonist mobs (whose stats already reflect how dangerous they were in service).
const GOLD_PER_KILL_BASE_DIVISOR = 8;
const GOLD_PER_KILL_MIN = 3;
function goldForKill(mob: Mob): number {
  return Math.max(GOLD_PER_KILL_MIN, Math.round((mob.maxHp + mob.damage * 2) / GOLD_PER_KILL_BASE_DIVISOR));
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
function handleSetDifficulty(value: unknown) {
  if (!isDifficulty(value)) return;
  const soloFirstDay = players.size <= 1 && cycleTick < DAY_TICKS;
  if (difficultyClaimed && !soloFirstDay) return;
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
  ],
  greenskinWarband: [
    { kind: "goblin", weight: 10, core: true },
    { kind: "goblinCrossbow", weight: 4, core: true },
    { kind: "orc", weight: 5, core: true },
    { kind: "armoredOrc", weight: 3, core: true },
    { kind: "troll", weight: 1, core: false },
    { kind: "ogre", weight: 1, core: false },
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
// Raiders spawn on walkable tiles within this many tiles of the map border.
const RAID_EDGE_BAND_TILES = 3;
// Passive raiders wander one tile at a time, never more than this far (Chebyshev) from their spawn.
const RAID_LOITER_RADIUS_TILES = 3;
const RAID_LOITER_CHANCE_PER_TICK = 1 / (TICK_RATE * 3);
// A marching group breaks up into normal per-mob targeting once its leader is this close to the
// colony (Town Center) or to any targetable guard/player.
const RAID_ENGAGE_RANGE_TILES = 8;
// Followers may move this much faster than the group pace to catch up with their formation slot.
const RAID_FOLLOWER_CATCHUP = 1.25;
// Formation slots: golden-angle spiral, slot i at radius RAID_FORMATION_SPACING_TILES * sqrt(i).
const RAID_FORMATION_SPACING_TILES = 0.7;
const RAID_MARCH_REPATH_TICKS = TICK_RATE * 2;

const TROLL_REGEN_DELAY_TICKS = TICK_RATE * 4;
const TROLL_REGEN_PER_TICK = 1;
const POISON_DURATION_TICKS = TICK_RATE * 3;
const POISON_DAMAGE_PER_TICK = 1;
const DARK_SHAMAN_HEAL_RANGE = TILE_SIZE * 5;
const DARK_SHAMAN_HEAL_AMOUNT = 15;
const DARK_SHAMAN_HEAL_COOLDOWN_TICKS = TICK_RATE * 3;

const DESERTER_ACTIVATION_DAYS = 10;
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

// ---- Slow farming: every farm number lives here. One game day = DAY_TICKS + NIGHT_TICKS (100 s). ----
const GAME_DAY_TICKS = DAY_TICKS + NIGHT_TICKS;
// Grain field (Farm Plot next to a staffed Barn): sown -> growing -> ripe (the short harvest phase)
// -> +FARM_YIELD_PER_HARVEST grain -> sown again. Plots grow day and night. Every
// FARM_HARVESTS_BEFORE_FALLOW harvests the field rests FALLOW for FARM_FALLOW_TICKS, then re-sows itself
// (once its Barn is staffed). Grow and harvest are scaled by the Barn's level, the plot's biome,
// happiness and the Barn's industrial synergy; fallow is a flat rest.
const FARM_GROW_DAYS = 3;
const FARM_GROW_TICKS = FARM_GROW_DAYS * GAME_DAY_TICKS;
// The first third of the grow phase reads as freshly sown soil (snapshot sownFarmPlots).
const FARM_SOWN_FRACTION = 1 / 3;
const FARM_HARVEST_TICKS = TICK_RATE * 2;
const FARM_HARVESTS_BEFORE_FALLOW = 5;
const FARM_FALLOW_DAYS = 3;
const FARM_FALLOW_TICKS = FARM_FALLOW_DAYS * GAME_DAY_TICKS;
// The old 8 s grow + 2 s harvest gave 1 grain per 10 s = 10 grain per plot per game day. A full field
// rotation is now 5 x 3 grow days + 3 fallow days = 18 days, so 36 per harvest keeps the long-run
// average at 5 * 36 / 18 = 10 grain per plot-day (12 per active grow-day).
const FARM_YIELD_PER_HARVEST = 36;
// Pasture / Orchard / Sheep Pasture / Hemp Field: the farmhand tends all day as before (works only by
// day, shelters at night), but the produce lands once per cycle of FARMHAND_CYCLE_DAYS days of tending.
// The old rate was 1 unit per CHOP_TICKS (2 s) of tending = DAY_TICKS / CHOP_TICKS = 30 a day, so a
// 3-day cycle yields 3 * 30 = 90 (same average rate, delivered in one batch). The cycle length is scaled
// by the building's level, biome, happiness and industrial synergy exactly like the old unit timer.
const FARMHAND_CYCLE_DAYS = 3;
const FARMHAND_CYCLE_TICKS = FARMHAND_CYCLE_DAYS * DAY_TICKS;
const FARMHAND_YIELD_PER_CYCLE: Record<"meat" | "fruit" | "wool" | "cotton", number> = {
  meat: 90,
  fruit: 90,
  wool: 90,
  cotton: 90,
};

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
const MAX_TREES = scaledCount(200);
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
  TileType.HunterHut,
  TileType.ForagerHut,
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
  return 1 + bonus;
}

function effectiveChopTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((CHOP_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (happinessSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

// Same multipliers as effectiveChopTicks, on the farmhand's multi-day cycle.
function effectiveFarmhandCycleTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((FARMHAND_CYCLE_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (happinessSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

function effectiveCraftTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(1, Math.round((CRAFT_TICKS * (1 - levelBonus(level))) / (happinessSpeedMultiplier() * industrialSynergyMultiplier(tx, ty))));
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
  // Not WardStone: the Ward Priest respawns through updateWardPriestPresence instead.
  if (kind === "bishop") return t === TileType.ChurchPost;
  if (kind === "farmhand") return FARM_PRODUCE_BY_TILE[t] !== undefined;
  if (kind === "artisan") return CRAFT_RECIPES[t] !== undefined;
  if (kind === "hunter") return t === TileType.HunterHut;
  if (kind === "forager") return t === TileType.ForagerHut;
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
    kind === "forager"
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
    t === TileType.ArcherTower ||
    t === TileType.MilitiaPost ||
    t === TileType.MilitiaCamp2 ||
    t === TileType.MilitiaCamp3
  );
}

// Buildings that gain from standing next to houses: workplaces and unit buildings.
function isSynergyBuilding(t: TileType): boolean {
  return POPULATION_GATED_TILES.includes(t) || isMilitaryTile(t);
}

function populationCap(): number {
  let cap = townCenterDestroyed ? 0 : TOWN_CENTER_BASE_POPULATION;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as TileType;
    if (t === TileType.House) cap += 1;
    else if (t === TileType.BigHouse) cap += 3;
    else if (t === TileType.HouseLevel2) cap += 5;
  }
  return cap + neighbourhoodPopulationBonus();
}

// Neighbourhood synergy: +1 population for every adjacent (8-neighbour) pair of (house, house) or
// (house, any other staffed/unit building). Houses clustered with workplaces and barracks grow
// the colony faster, so neighbourhoods are worth building.
function neighbourhoodPopulationBonus(): number {
  let bonus = 0;
  for (let ty = 0; ty < WORLD_TILES_Y; ty++) {
    for (let tx = 0; tx < WORLD_TILES_X; tx++) {
      if (!isHouseTile(tiles[tileIndex(tx, ty)] as TileType)) continue;
      for (const [dx, dy] of NEIGHBOURS_8) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!inBounds(nx, ny)) continue;
        const n = tiles[tileIndex(nx, ny)] as TileType;
        if (isSynergyBuilding(n)) bonus++;
        // House-house pairs are seen from both ends; count each once (the "later" tile in scan order).
        else if (isHouseTile(n) && (dy > 0 || (dy === 0 && dx > 0))) bonus++;
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
    isTower,
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

// Event-feed names for tier upgrades, matching the client's build-panel labels.
const UPGRADE_NAMES: Partial<Record<TileType, string>> = {
  [TileType.House]: "Cottage",
  [TileType.KnightPost]: "Hall of the Sworn",
  [TileType.MilitiaPost]: "Militia Camp",
  [TileType.ArcherPost]: "Archery Range",
  [TileType.ArcherTower]: "Archer Tower",
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

function resolveHousePlacement(tx: number, ty: number) {
  const current = tiles[tileIndex(tx, ty)] as TileType;
  if (current === TileType.BigHouse) {
    stock.grain -= 2;
    stock.meat -= 2;
    stock.fruit -= 2;
    stock.clothes -= 3;
    stock.tools -= 2;
    stock.luxuryItems -= 1;
    tiles[tileIndex(tx, ty)] = TileType.HouseLevel2;
    broadcastTileUpdate(tx, ty, TileType.HouseLevel2);
    announceUpgrade(TileType.House, 3);
    return;
  }
  if (current === TileType.House) {
    stock.grain -= 1;
    stock.meat -= 1;
    stock.fruit -= 1;
    stock.clothes -= 2;
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
  spawnColonistForPost(tx, ty, "knight", 1, false);
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
  spawnColonistForPost(tx, ty, "militia", 1, false);
  spawnColonistForPost(tx, ty, "militia", 1, false);
}

function resolveArcherPlacement(tx: number, ty: number, wallType: TileType | null) {
  const here = tiles[tileIndex(tx, ty)] as TileType;
  if (here === TileType.ArcherPost || here === TileType.ArcherTower) {
    const newLevel = getBuildingLevel(tx, ty) + 1;
    buildingLevel.set(resourceKey(tx, ty), newLevel);
    const isTower = here === TileType.ArcherTower;
    upgradeArcherAt(tx, ty, newLevel, isTower);
    announceUpgrade(here, newLevel);
    return;
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
function resolveFoodHutPlacement(tx: number, ty: number, hutType: TileType, kind: "hunter" | "forager") {
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

function processRespawnQueue() {
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const req = respawnQueue[i];
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
    groupId: null,
    passive: false,
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
        (happinessSpeedMultiplier() * industrialSynergyMultiplier(plot.barnX, plot.barnY))
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
const FORAGE_REGROW_TICKS = DAY_TICKS + NIGHT_TICKS;

// Wild forage scatter (counts tuned for 80x80, scaled by area like the other world-gen counts).
// Berry bushes on Plains, fruit trees on Plains, mushrooms next to trees (any biome) or in Swamp.
const BERRY_BUSH_COUNT = scaledCount(24);
const FRUIT_TREE_COUNT = scaledCount(12);
const MUSHROOM_PATCH_COUNT = scaledCount(10);
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
  deer: { maxHp: 18, speed: 28, fleeSpeed: 115, meat: 6, cap: scaledCount(6) },
  rabbit: { maxHp: 6, speed: 30, fleeSpeed: 125, meat: 2, cap: scaledCount(8) },
  boar: { maxHp: 30, speed: 24, fleeSpeed: 100, meat: 8, cap: scaledCount(3) },
  pheasant: { maxHp: 6, speed: 22, fleeSpeed: 120, meat: 2, cap: scaledCount(4) },
};
// 4 a day on 80x80 (16 on 160x160): a map's sustainable hunt is about this many animals a day.
const WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCount(4));
const WILDLIFE_RESPAWN_INTERVAL_TICKS = Math.round((DAY_TICKS + NIGHT_TICKS) / WILDLIFE_RESPAWN_PER_DAY);
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
  if (isInAbbeyGrounds(tx, ty)) return false;
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

function updateWildlife(dt: number) {
  for (const a of wildlife.values()) {
    const config = WILDLIFE_CONFIG[a.kind];
    if (a.attackCooldownTicks > 0) a.attackCooldownTicks--;
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
    if (isInAbbeyGrounds(tx, ty)) continue;
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
    Math.round((base * (1 - levelBonus(level))) / (happinessSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
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
// at all) uses the Town Center. Beds are a house's tier capacity (1 / 3 / 5).
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

function shelterTileFor(c: Colonist): TileCoord {
  return c.homeTileX >= 0 ? { x: c.homeTileX, y: c.homeTileY } : TOWN_CENTER_TILE;
}

function isAtShelter(c: Colonist): boolean {
  if (!c.sheltering || !c.shelterAssigned) return false;
  const center = tileToPixelCenter(shelterTileFor(c));
  return Math.hypot(c.x - center.x, c.y - center.y) <= TILE_SIZE * 1.5;
}

function updateShelteringCivilian(c: Colonist, dt: number) {
  // (Re)assign on first night tick, and if the house was demolished or replaced mid-night.
  if (!c.shelterAssigned || (c.homeTileX >= 0 && houseCapacity(tiles[tileIndex(c.homeTileX, c.homeTileY)] as TileType) === 0)) {
    assignShelter(c);
    c.path = [];
  }
  const target = shelterTileFor(c);
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

function findNearestMobInRange(
  fromX: number,
  fromY: number,
  maxRangeTiles: number,
  isEligible?: (mob: Mob) => boolean
): Mob | null {
  let best: Mob | null = null;
  let bestDist = Infinity;
  const maxRangePx = maxRangeTiles * TILE_SIZE;
  for (const mob of mobs.values()) {
    if (isEligible && !isEligible(mob)) continue;
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

// Wiped wholesale at each dawn (before that dawn's starvation deaths add new ones), so every entry
// was placed since the most recent dawn and lasts until the next one.
const gravestones: GravestoneSnapshot[] = [];

function damageMob(mob: Mob, amount: number) {
  if (isDormantGuardian(mob)) activateGuardianSite(mob.siteId!);
  // Hitting any member of a raid group (passive or marching) turns the whole group on its attackers.
  if (mob.groupId !== null) {
    const group = raidGroups.get(mob.groupId);
    if (group) engageRaidGroup(group);
  }
  mob.hp -= amount;
  mob.lastDamagedTick = cycleTick;
  if (mob.hp <= 0) {
    gravestones.push({ x: mob.x, y: mob.y, variant: Math.random() < 0.5 ? 0 : 1 });
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

function colonistDeathText(c: Colonist): string {
  if (isWardPriest(c)) return "The Ward Priest has died";
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  return `${/^[aeiou]/.test(name) ? "An" : "A"} ${name} has died`;
}

function damageColonist(colonist: Colonist, amount: number) {
  colonist.hp -= amount;
  if (colonist.hp <= 0) {
    gravestones.push({ x: colonist.x, y: colonist.y, variant: Math.random() < 0.5 ? 0 : 1 });
    broadcastEvent("death", colonistDeathText(colonist));
    releaseResourceReservation(colonist);
    if (!isWardPriest(colonist)) queueRespawn(colonist);
    colonists.delete(colonist.id);
  }
}

const COMMANDABLE_KINDS: ColonistKind[] = ["knight", "archer", "bishop", "militia", "spearman", "pikeman"];

// Only a Church's bishop takes orders: the Ward Priest must keep his rounds for the wards to stand,
// and the Abbey's clergy aren't the colony's at all. Mirrored by the client's isCommandable (which
// sees the Ward Priest's post as a Ward Stone).
function isCommandable(c: Colonist): boolean {
  if (!COMMANDABLE_KINDS.includes(c.kind)) return false;
  if (isWardPriest(c)) return false;
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

const STANCES: Stance[] = ["defensive", "normal", "aggressive"];

function handleCommandStance(unitIds: string[], stance: Stance) {
  if (!STANCES.includes(stance)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c)) continue;
    c.stance = stance;
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
    if (damageWildlife(bestAnimal, PLAYER_ATTACK_DAMAGE, attacker.x, attacker.y, null)) stock.meat += meat;
    return;
  }

  if (!bestType || !bestId) return;
  if (bestType === "player") {
    const target = players.get(bestId);
    if (target) {
      pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      damagePlayer(target, PLAYER_ATTACK_DAMAGE);
    }
  } else {
    const target = mobs.get(bestId);
    if (target) {
      pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      damageMob(target, PLAYER_ATTACK_DAMAGE);
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
      // Skip anything the chase leash wouldn't let this unit reach (further from its rally point than
      // leash + attack range): it would only walk out to the leash, give up, and come back to
      // re-acquire the same mob, forever, e.g. against a dormant POI guardian that never moves.
      const reachPx = STANCE_CHASE_LEASH_TILES[c.stance] * TILE_SIZE + stats.range;
      const found = findNearestMobInRange(
        c.x,
        c.y,
        STANCE_ALERT_RANGE_TILES[c.stance],
        (m) => Math.hypot(m.x - c.rallyX, m.y - c.rallyY) <= reachPx
      );
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
      damageMob(target, stats.damage * armyDamageMultiplier(c.postX, c.postY));
      c.attackCooldownTicks = stats.cooldown;
      pendingEffects.push({ fromX: c.x, fromY: c.y, toX: target.x, toY: target.y, melee: stats.melee });
      if (target.hp <= 0) {
        c.targetMobId = null;
      }
    }
  } else {
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    // Chase leash: only checked while closing on an out-of-range target (an exchange already in
    // attack range above is never interrupted). Past the leash, drop the target and head home this
    // tick; the repath cooldown holds off the next scan for a beat so the unit actually turns back
    // instead of re-acquiring the same target next tick and jittering on the leash edge.
    if (Math.hypot(c.x - c.rallyX, c.y - c.rallyY) > STANCE_CHASE_LEASH_TILES[c.stance] * TILE_SIZE) {
      c.targetMobId = null;
      c.path = [];
      c.repathCooldown = MOB_REPATH_TICKS;
      returnToRally(c, dt, stats.speed);
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
// re-summoned after a dismissal, appears at once; one that died waits RESPAWN_DELAY_TICKS and pays
// RESPAWN_FOOD_COST, matching processRespawnQueue.
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
    wardPriestRespawnTicks = RESPAWN_DELAY_TICKS;
  }
  if (priest && (stones.length === 0 || !church)) {
    colonists.delete(priest.id);
    wardPriestId = null;
    return;
  }
  if (priest || stones.length === 0 || !church) return;
  if (civilianPopulationUsed() >= populationCap()) return;
  if (wardPriestRespawnTicks > 0) {
    wardPriestRespawnTicks--;
    return;
  }
  if (wardPriestRespawnTicks === 0 && !trySpendFood(RESPAWN_FOOD_COST)) return;
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
    case "hunter":
      updateHunter(c, dt);
      break;
    case "forager":
      updateForager(c, dt);
      break;
    case "knight":
    case "archer":
    case "militia":
    case "spearman":
    case "pikeman":
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
  // Formation offset (pixels from the leader) per follower, set when the march starts.
  offsets: Map<string, { x: number; y: number }>;
  repathCooldown: number;
}
const raidGroups = new Map<string, RaidGroup>();
// Day index whose raid has already spawned, so the midday check fires once per day.
let raidSpawnedForDay = -1;

function raidSizeForDay(dayIndex: number): number {
  const base = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex;
  return Math.max(1, Math.round(base * DIFFICULTY_TUNING[difficulty].spawnCount));
}

function isRaidEdgeTile(tx: number, ty: number): boolean {
  return Math.min(tx, ty, WORLD_TILES_X - 1 - tx, WORLD_TILES_Y - 1 - ty) < RAID_EDGE_BAND_TILES;
}

function randomRaidAnchor(): { tile: TileCoord; edge: RaidEdge } | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const side = Math.floor(Math.random() * 4);
    const along = Math.floor(Math.random() * (side < 2 ? WORLD_TILES_X : WORLD_TILES_Y));
    const tile =
      side === 0 ? { x: along, y: 0 }
      : side === 1 ? { x: along, y: WORLD_TILES_Y - 1 }
      : side === 2 ? { x: 0, y: along }
      : { x: WORLD_TILES_X - 1, y: along };
    if (isWalkableTile(tile.x, tile.y)) {
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
    .map((f) => ({ f, w: RAID_FACTIONS[f].filter((e) => e.core && isRaidKindUnlocked(e.kind, dayIndex)).length }))
    .filter((x) => x.w > 0);
  let roll = Math.random() * weighted.reduce((sum, x) => sum + x.w, 0);
  for (const x of weighted) {
    roll -= x.w;
    if (roll < 0) return x.f;
  }
  return weighted[weighted.length - 1].f;
}

function pickRaidFactionKind(faction: RaidFactionId, dayIndex: number): MobKind {
  const eligible = RAID_FACTIONS[faction].filter((e) => isRaidKindUnlocked(e.kind, dayIndex));
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
  };
  mobs.set(mob.id, mob);
  return mob;
}

// On a deserter night (DESERTER_WAVE_CHANCE, once deserters have waited DESERTER_ACTIVATION_DAYS)
// every eligible deserter joins the horde where it stands, and fresh Bandit-band mobs fill the raid up
// to its normal size (none if the deserters alone already reach it).
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
        const mob = createRaidMob(pickRaidFactionKind(group.faction, dayIndex), tile, group.id);
        group.memberIds.push(mob.id);
        group.homes.set(mob.id, tile);
      }
      if (announceEdge === null) announceEdge = anchor.edge;
    }
    if (group.memberIds.length > 0) raidGroups.set(group.id, group);
  });
  if (announceEdge) broadcastEvent("raid", `Raiders gather at the ${announceEdge} edge`);
}

// Returns true when `m` was a still-dormant deserter (so the caller can announce the turn).
function releaseRaidMob(m: Mob): boolean {
  const turnedDeserter = m.isDeserter && !m.deserterActive;
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

// Dissolves the group: every member switches to normal per-mob targeting right away.
function engageRaidGroup(group: RaidGroup) {
  let turned = 0;
  for (const m of raidGroupMembers(group)) if (releaseRaidMob(m)) turned++;
  raidGroups.delete(group.id);
  announceDeserterTurn(turned);
}

// Slowest member leads (so the group moves at its pace); the rest get golden-angle spiral slots.
function assignRaidLeader(group: RaidGroup): Mob | null {
  const members = raidGroupMembers(group);
  if (members.length === 0) return null;
  const leader = members.reduce((slowest, m) => (m.speed < slowest.speed ? m : slowest));
  group.leaderId = leader.id;
  group.repathCooldown = 0;
  group.offsets.clear();
  let slot = 1;
  for (const m of members) {
    if (m === leader) continue;
    const r = RAID_FORMATION_SPACING_TILES * TILE_SIZE * Math.sqrt(slot);
    const a = slot * 2.399963;
    group.offsets.set(m.id, { x: r * Math.cos(a), y: r * Math.sin(a) });
    slot++;
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
  const tc = resolveTargetPosition("townCenter", null);
  if (tc && !isWarded(tc.x, tc.y, activeWardSources())) return tc;
  const picked = pickMobTarget(leader);
  return picked ? resolveTargetPosition(picked.type, picked.id) : null;
}

function raidGroupShouldEngage(leader: Mob, goal: { x: number; y: number }): boolean {
  const range = RAID_ENGAGE_RANGE_TILES * TILE_SIZE;
  if (Math.hypot(goal.x - leader.x, goal.y - leader.y) <= range) return true;
  const wards = activeWardSources();
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (Math.hypot(c.x - leader.x, c.y - leader.y) <= range && !isWarded(c.x, c.y, wards)) return true;
  }
  for (const p of players.values()) {
    if (Math.hypot(p.x - leader.x, p.y - leader.y) <= range && !isWarded(p.x, p.y, wards)) return true;
  }
  return false;
}

// Straight-line step toward (tx, ty); false (and no move) if the step would enter a solid tile.
function stepRaidMobToward(m: Mob, tx: number, ty: number, speed: number, dt: number): boolean {
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
function moveRaidFollower(m: Mob, leader: Mob, offset: { x: number; y: number }, pace: number, dt: number) {
  const speed = Math.min(m.speed, pace * RAID_FOLLOWER_CATCHUP);
  if (m.path.length > 0) {
    advanceAlongPath(m, dt, speed);
    return;
  }
  if (m.repathCooldown > 0) m.repathCooldown--;
  if (stepRaidMobToward(m, leader.x + offset.x, leader.y + offset.y, speed, dt)) return;
  if (stepRaidMobToward(m, leader.x, leader.y, speed, dt)) return;
  if (m.repathCooldown <= 0) {
    m.path = findPath(tileOfPixel(m.x, m.y), tileOfPixel(leader.x, leader.y)) ?? [];
    m.repathCooldown = MOB_REPATH_TICKS;
  }
}

function marchRaidGroup(group: RaidGroup, dt: number) {
  let leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  if (!leader || leader.groupId !== group.id) leader = assignRaidLeader(group) ?? undefined;
  if (!leader) return;
  const goal = raidMarchGoal(leader);
  if (!goal) return;
  if (raidGroupShouldEngage(leader, goal)) {
    engageRaidGroup(group);
    return;
  }
  if (group.repathCooldown > 0) group.repathCooldown--;
  // One shared path per group. No route (e.g. a walled-in colony) holds the group where it is and
  // retries every RAID_MARCH_REPATH_TICKS, rather than every member searching the map every second.
  if (leader.path.length === 0 && group.repathCooldown <= 0) {
    leader.path = findPath(tileOfPixel(leader.x, leader.y), tileOfPixel(goal.x, goal.y)) ?? [];
    group.repathCooldown = RAID_MARCH_REPATH_TICKS;
  }
  const pace = leader.speed;
  advanceAlongPath(leader, dt, pace);
  for (const m of raidGroupMembers(group)) {
    if (m === leader) continue;
    const offset = group.offsets.get(m.id);
    if (offset) moveRaidFollower(m, leader, offset, pace, dt);
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

  // Raid-group members are moved by updateRaidGroups until their group breaks up.
  if (mob.groupId !== null) return;

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
      pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: targetPos.x, toY: targetPos.y, melee: mob.melee });
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

const BIOME_SEEDS_PER_KIND = scaledCount(5);
// Plains is meant to be the majority biome (the default colony-building terrain), with Hills and
// Swamp as scattered regional pockets. 14-18 made Hills+Swamp cover ~70% of the map instead;
// 10-13 brings Plains back to roughly half, per the executor's own simulation.
const BIOME_SEED_RADIUS_MIN = 10;
const BIOME_SEED_RADIUS_MAX = 13;
const BIOME_SEED_MIN_SPACING = 12;
const BIOME_EDGE_JITTER_TILES = 3;
const BIOME_NOISE_CELL_TILES = 4;

const POND_COUNT_MIN = scaledCount(8);
const POND_COUNT_MAX = scaledCount(12);
const POND_RADIUS_MIN = 2;
const POND_RADIUS_MAX = 4;
const POND_EDGE_JITTER_TILES = 1;
const POND_NOISE_CELL_TILES = 2;
const POND_MIN_SPACING = 12;

const RUIN_SITE_COUNT_MIN = scaledCount(6);
const RUIN_SITE_COUNT_MAX = scaledCount(10);
const ENCAMPMENT_SITE_COUNT_MIN = scaledCount(6);
const ENCAMPMENT_SITE_COUNT_MAX = scaledCount(10);
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
    groupId: null,
    passive: false,
  };
  mobs.set(mob.id, mob);
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
  for (const spot of shuffled(guardianSpots).slice(0, guardianCount)) {
    spawnGuardian(siteKind === "ruin" ? pickRuinGuardianKind() : pickEncampmentGuardianKind(), spot, siteId, siteKind);
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

// ---- Fog of war (minimap only) ----
// Explored tiles, shared by every player and kept for the life of the world. Sources only reveal
// when their tile changes (or a building lands), stamping a precomputed circle; nothing ever scans
// the whole map per tick.
const explored = new Uint8Array(WORLD_TILES_X * WORLD_TILES_Y);
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
  TileType.ArcherTower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost, TileType.Pasture,
  TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop, TileType.Blacksmith,
  TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery, TileType.Tavern,
  TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
  TileType.HunterHut, TileType.ForagerHut,
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
// ponds -> Abbey -> resources -> wild forage -> POI sites -> wild game, each step only ever writing onto Empty tiles, so nothing
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
  generateForage();
  generatePoiSites("ruin", randInt(RUIN_SITE_COUNT_MIN, RUIN_SITE_COUNT_MAX), placedSites);
  generatePoiSites("encampment", randInt(ENCAMPMENT_SITE_COUNT_MIN, ENCAMPMENT_SITE_COUNT_MAX), placedSites);
  spawnInitialWildlife();
  resetExplored();
}

generateWorld();

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6];
let nextColorIndex = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function broadcastTileUpdate(tx: number, ty: number, tile: TileType) {
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

// TODO: Phase 5 — broadcastEvent("milestone", ...) once the short-term goal system exists, and a
// boss/mini-boss "sighted" event once the Castle Ruin boss lands.

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
      })),
      factions: RAID_FACTIONS,
      unlockDays: Object.fromEntries(Object.entries(MOB_KIND_CONFIG).map(([k, c]) => [k, c.unlockDay])),
    });
  } else if (msg.op === "damageMob" && typeof msg.mobId === "string" && typeof msg.amount === "number") {
    const mob = mobs.get(msg.mobId);
    if (mob) damageMob(mob, msg.amount);
    reply({ found: !!mob });
  } else if (msg.op === "forceDeserterRoll") {
    testForceDeserterRoll = typeof msg.value === "boolean" ? msg.value : null;
    reply({ value: testForceDeserterRoll });
  } else if (msg.op === "holdRaidAggro") {
    testHoldRaidAggro = msg.value === true;
    reply({ value: testHoldRaidAggro });
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
      plots: Array.from(farmPlots, ([key, p]) => ({ key, ...p })),
      farmhands: Array.from(colonists.values())
        .filter((c) => c.kind === "farmhand")
        .map((c) => ({ id: c.id, postX: c.postX, postY: c.postY, cycleTicksRemaining: c.chopTicksRemaining, state: c.state })),
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
  }
}

// PORT lets a scripted test run a private server without touching the shared :8080 world.
const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 8080;
const wss = new WebSocketServer({ port: PORT });
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
  };
  player.socket.send(JSON.stringify(welcome));
}

function resetWorld(nextDifficulty?: unknown) {
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
  generateWorld();

  respawnQueue.length = 0;
  farmPlots.clear();
  minesPlacedOnOre.clear();
  archerTowerWallType.clear();
  buildingLevel.clear();
  reservedResourceTiles.clear();
  taskForces.clear();
  wardStonesActiveLastTick.clear();
  wardStoneLastTended.clear();
  gravestones.length = 0;
  wardPriestId = null;
  wardPriestTendTicks = 0;
  wardPriestRespawnTicks = -1;
  pendingEffects = [];

  Object.assign(stock, initialStock());
  marketBuilt = false;
  goldShopBuilt = false;
  colonyHappiness = 100;

  townCenterHp = TOWN_CENTER_MAX_HP;
  townCenterDestroyed = false;

  cycleTick = 0;
  wasNight = false;
  raidGroups.clear();
  raidSpawnedForDay = -1;
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
    } else if (message.type === "pause") {
      isPaused = !isPaused;
    } else if (message.type === "restart") {
      resetWorld(message.difficulty);
    } else if (message.type === "setDifficulty") {
      handleSetDifficulty(message.difficulty);
    } else if (message.type === "commandMove") {
      handleCommandMove(message.unitIds, message.x, message.y);
    } else if (message.type === "commandAttack") {
      handleCommandAttack(message.unitIds, message.mobId);
    } else if (message.type === "commandStance") {
      handleCommandStance(message.unitIds, message.stance);
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
  TileType.HunterHut,
  TileType.ForagerHut,
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
  TileType.HunterHut,
  TileType.ForagerHut,
  // Wild forage can be cleared like any other obstacle (it simply stops being food).
  ...FORAGE_TILES,
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
];

// True when placing `tile` on the existing `current` building upgrades it in place.
function isInPlaceUpgrade(tile: TileType, current: TileType, tx: number, ty: number): boolean {
  if (tile === TileType.House) {
    return (current === TileType.House || current === TileType.BigHouse) && canAffordHouseUpgrade(current);
  }
  if (tile === TileType.KnightPost) return current === TileType.KnightPost || current === TileType.CastleLevel2;
  if (tile === TileType.MilitiaPost) return current === TileType.MilitiaPost || current === TileType.MilitiaCamp2;
  if (tile === TileType.ArcherPost) {
    return (current === TileType.ArcherPost || current === TileType.ArcherTower) && getBuildingLevel(tx, ty) < 3;
  }
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
  let isTower = false;
  if (t === TileType.KnightPost || t === TileType.CastleLevel2 || t === TileType.CastleLevel3) {
    kind = "knight";
    level = t === TileType.KnightPost ? 1 : t === TileType.CastleLevel2 ? 2 : 3;
    base = guardCountForLevel(level);
  } else if (t === TileType.ArcherPost || t === TileType.ArcherTower) {
    kind = "archer";
    level = getBuildingLevel(tx, ty);
    isTower = t === TileType.ArcherTower;
    base = guardCountForLevel(level);
  } else {
    level = t === TileType.MilitiaPost ? 1 : t === TileType.MilitiaCamp2 ? 2 : 3;
    kind = militiaKindForLevel(level);
    base = militiaCountForLevel(level);
  }
  const target = base + adjacentHouseCount(tx, ty);
  let have = 0;
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty && (c.kind === kind || (kind !== "knight" && kind !== "archer" && isMilitiaLineKind(c.kind)))) have++;
  }
  for (const q of respawnQueue) if (q.tx === tx && q.ty === ty) have++;
  for (let i = have; i < target; i++) spawnColonistForPost(tx, ty, kind, level, isTower);
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

function handleSetTile(player: Player, tx: number, ty: number, tile: TileType) {
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;
  if (tile !== TileType.Empty && !isSolidTile(tiles[tileIndex(tx, ty)] as TileType) && sealsInSpawner(tx, ty, tile)) return;
  handleSetTileInner(player, tx, ty, tile);
  syncGuardBonusesAround(tx, ty);
}

function handleSetTileInner(player: Player, tx: number, ty: number, tile: TileType) {
  if (!inBounds(tx, ty)) return;
  if (tile !== TileType.Empty && !PLACEABLE_TILES.includes(tile)) return;

  const tileCenter = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(player.x - tileCenter.x, player.y - tileCenter.y);
  if (dist > REACH) return;

  const current = tiles[tileIndex(tx, ty)] as TileType;

  if (tile === TileType.Empty) {
    if (!BREAKABLE_TILES.includes(current)) return;
    // A Ward Stone has no colonist of its own; the Ward Priest merely targets it, and retargets.
    if (!NO_COLONIST_TILES.includes(current) && current !== TileType.WardStone) {
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

  const upgradeInPlace = isInPlaceUpgrade(tile, current, tx, ty);

  if (upgradeInPlace) {
    // Placing on top of an existing building upgrades it; nothing else to validate here.
  } else if (tile === TileType.IronMinePost) {
    if (current !== TileType.IronOre) return;
  } else if (tile === TileType.RockMinePost) {
    if (current !== TileType.Rock) return;
  } else if (tile === TileType.FarmPlot) {
    if (current !== TileType.Empty) return;
    if (adjacentTilesOfType(tx, ty, TileType.BarnPost).length === 0) return;
  } else if (tile === TileType.ArcherPost) {
    if (current !== TileType.Empty && !WALL_TILES.includes(current)) return;
  } else if (tile === TileType.WardStone) {
    if (current !== TileType.Empty) return;
    if (tilesOfType(TileType.ChurchPost).length === 0) return;
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
  if ((tile === TileType.HunterHut || tile === TileType.ForagerHut) && stock.wood < FOOD_HUT_WOOD_COST) return;
  if (
    POPULATION_GATED_TILES.includes(tile) &&
    placementNeedsNewWorkerSlot(tile, tx, ty) &&
    civilianPopulationUsed() >= populationCap()
  )
    return;

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
  if (tile === TileType.HunterHut || tile === TileType.ForagerHut) stock.wood -= FOOD_HUT_WOOD_COST;

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

// One simulation tick (everything the pause freezes). The testHook "fastForward" runs it in a loop.
function stepSimulation() {
  cycleTick++;
  const nightNow = isNightNow();

  if (!nightNow && wasNight) {
    gravestones.length = 0;
    broadcastEvent("dawn", "Dawn breaks — the colony survived the night");
    applyDailyFoodConsumption();
    applyMoraleCheck();
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

  updateRaidGroups(dt);
  for (const mob of mobs.values()) {
    updateMob(mob, dt);
  }
  updateWildlife(dt);
  updateWildlifeRespawn();

  checkWardStoneLapses();

  updateFarmPlots();
  updateForageRegrow();
  processRespawnQueue();
  updateWardPriestPresence();
}

setInterval(() => {
  const tickStart = TEST_HOOKS ? performance.now() : 0;
  if (!isPaused) stepSimulation();

  // Outside the pause gate so a player joining mid-pause still gets their surroundings.
  updateVision();
  flushExplored();

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
      stance: c.stance,
      sheltered: isAtShelter(c),
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
    cycleProgress: (cycleTick % (DAY_TICKS + NIGHT_TICKS)) / (DAY_TICKS + NIGHT_TICKS),
    dayFraction: DAY_TICKS / (DAY_TICKS + NIGHT_TICKS),
    isPaused,
    effects: pendingEffects,
    townCenterHp,
    townCenterMaxHp: TOWN_CENTER_MAX_HP,
    population: civilianPopulationUsed(),
    populationCap: populationCap(),
    taskForces: taskForcesForSnapshot(),
    readyFarmPlots: farmPlotIndices("harvesting"),
    sownFarmPlots: farmPlotIndices("sown"),
    fallowFarmPlots: farmPlotIndices("fallow"),
    wildlife: wildlifeForSnapshot(),
    gravestones,
    difficulty,
  };
  pendingEffects = [];

  const payload = JSON.stringify(snapshot);
  for (const player of players.values()) {
    if (player.socket.readyState === player.socket.OPEN) {
      player.socket.send(payload);
    }
  }
  if (TEST_HOOKS) {
    tickDurationsMs.push(performance.now() - tickStart);
    if (tickDurationsMs.length > TICK_DURATION_SAMPLES) tickDurationsMs.shift();
  }
}, 1000 / TICK_RATE);
