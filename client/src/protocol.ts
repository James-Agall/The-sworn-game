export const TICK_RATE = 20;
export const TILE_SIZE = 32;
// Server-side default; the live size is overridable (COLONY_WORLD_SIZE) and sent in `welcome`.
export const DEFAULT_WORLD_TILES = 160;
export const PLAYER_SPEED = 150;
export const PLAYER_HALF_SIZE = 10;
export const PLAYER_MAX_HP = 100;

// Fog-of-war vision radii, in tiles (minimap only; the main view is never fogged). A tile within
// one of these of a source's tile becomes "explored" for good (server-authoritative, shared by all
// players). The client reuses PLAYER/COLONIST to decide which mobs are in live view right now.
export const VISION_RADIUS_PLAYER = 10;
export const VISION_RADIUS_COLONIST = 6;
// Placed buildings (walls excluded) and the Town Center.
export const VISION_RADIUS_BUILDING = 5;
// Revealed around the Town Center when a world is generated, so the minimap isn't blank at t=0.
export const VISION_RADIUS_START = 12;

export enum TileType {
  Empty = 0,
  Wall = 1,
  Tree = 2,
  LumberjackPost = 3,
  FarmPlot = 4,
  KnightPost = 5,
  ArcherPost = 6,
  IronOre = 7,
  Rock = 8,
  IronMinePost = 9,
  RockMinePost = 10,
  StoneWall = 11,
  TownCenter = 12,
  House = 13,
  BigHouse = 14,
  HouseLevel2 = 15,
  BarnPost = 16,
  CastleLevel2 = 17,
  CastleLevel3 = 18,
  ArcherTower = 19,
  ChurchPost = 20,
  Pasture = 21,
  Orchard = 22,
  WoolFarm = 23,
  CottonFarm = 24,
  TailorShop = 25,
  Blacksmith = 26,
  LuxuryWorkshop = 27,
  Market = 28,
  GoldShop = 29,
  Brewery = 30,
  Tavern = 31,
  MilitiaPost = 32,
  MilitiaCamp2 = 33,
  MilitiaCamp3 = 34,
  // World-gen only (never player-placeable): ponds, ruin-site decoration, encampment props.
  Water = 35,
  RuinWall1 = 36,
  RuinWall2 = 37,
  RuinArch = 38,
  RuinStatue = 39,
  RuinRubble = 40,
  PropCampfire = 41,
  PropCart = 42,
  PropBarrel = 43,
  PropCrate = 44,
  PropFence = 45,
  // Saint Wren's Abbey (world-gen only, exactly one per map): the hall its resident clergy are
  // posted at, plus devotional props. Never player-placeable or demolishable.
  AbbeyHall = 46,
  PropCross = 47,
  PropLanternPost = 48,
  // Player-built: staffed by a warding Bishop, suppresses mob targeting nearby while he's present.
  WardStone = 49,
  // Player-built food huts: a hunter (wild game -> meat) / a forager (wild plants -> fruit) per level.
  HunterHut = 50,
  ForagerHut = 51,
  // World-gen wild forage the server tracks; each has a ripe and a picked (regrowing) state.
  // Bushes and mushrooms are walkable, fruit trees are solid like ordinary trees.
  BerryBush = 52,
  BerryBushPicked = 53,
  FruitTree = 54,
  FruitTreePicked = 55,
  MushroomPatch = 56,
  MushroomPatchPicked = 57,
  // Player-built: posts builders (one per level). Upgradeable in place to level 3.
  BuildersGuild = 58,
  // A building waiting for builders (server ConstructionSite record: target tile, progress). Solid.
  ConstructionSite = 59,
  // Player-built ground tiles: walkable, never solid, drawn as ground (autotiled from their road
  // neighbours on the client). Colonists and players move faster on them (server ROAD_SPEED_BONUS).
  Road = 60,
  CobbleRoad = 61,
}

export function isRoadTile(tile: TileType): boolean {
  return tile === TileType.Road || tile === TileType.CobbleRoad;
}

// Ground biome per tile, a separate layer from TileType (sent once in `welcome`, never changes
// after world-gen).
export enum Biome {
  Plains = 0,
  Hills = 1,
  Swamp = 2,
}

export function isSolidTile(tile: TileType): boolean {
  return (
    tile === TileType.Wall ||
    tile === TileType.Tree ||
    tile === TileType.LumberjackPost ||
    tile === TileType.KnightPost ||
    tile === TileType.ArcherPost ||
    tile === TileType.IronOre ||
    tile === TileType.Rock ||
    tile === TileType.IronMinePost ||
    tile === TileType.RockMinePost ||
    tile === TileType.StoneWall ||
    tile === TileType.TownCenter ||
    tile === TileType.House ||
    tile === TileType.BigHouse ||
    tile === TileType.HouseLevel2 ||
    tile === TileType.BarnPost ||
    tile === TileType.CastleLevel2 ||
    tile === TileType.CastleLevel3 ||
    tile === TileType.ArcherTower ||
    tile === TileType.ChurchPost ||
    tile === TileType.Pasture ||
    tile === TileType.Orchard ||
    tile === TileType.WoolFarm ||
    tile === TileType.CottonFarm ||
    tile === TileType.TailorShop ||
    tile === TileType.Blacksmith ||
    tile === TileType.LuxuryWorkshop ||
    tile === TileType.Market ||
    tile === TileType.GoldShop ||
    tile === TileType.Brewery ||
    tile === TileType.Tavern ||
    tile === TileType.MilitiaPost ||
    tile === TileType.MilitiaCamp2 ||
    tile === TileType.MilitiaCamp3 ||
    tile === TileType.Water ||
    tile === TileType.RuinWall1 ||
    tile === TileType.RuinWall2 ||
    tile === TileType.RuinArch ||
    tile === TileType.RuinStatue ||
    tile === TileType.RuinRubble ||
    tile === TileType.PropCampfire ||
    tile === TileType.PropCart ||
    tile === TileType.PropBarrel ||
    tile === TileType.PropCrate ||
    tile === TileType.PropFence ||
    tile === TileType.AbbeyHall ||
    tile === TileType.PropCross ||
    tile === TileType.PropLanternPost ||
    tile === TileType.WardStone ||
    tile === TileType.HunterHut ||
    tile === TileType.ForagerHut ||
    tile === TileType.FruitTree ||
    tile === TileType.FruitTreePicked ||
    tile === TileType.BuildersGuild ||
    tile === TileType.ConstructionSite
  );
}

export type ColonistKind =
  | "lumberjack"
  | "farmer"
  | "knight"
  | "archer"
  | "ironMiner"
  | "rockMiner"
  | "bishop"
  | "farmhand"
  | "artisan"
  | "militia"
  | "spearman"
  | "pikeman"
  | "hunter"
  | "forager"
  | "builder";

// Combat stance for guard-tier units (knight/archer/militia line): how far they aggro, how far they
// chase from their rally point, and how tight a formation they hold. Every colonist carries one
// (default "normal"); it has no effect on bishops or civilians.
export type Stance = "defensive" | "normal" | "aggressive";

export interface ColonistSnapshot {
  id: string;
  kind: ColonistKind;
  x: number;
  y: number;
  state: string;
  hp: number;
  maxHp: number;
  postX: number;
  postY: number;
  stance: Stance;
  // True once a civilian has reached its night shelter (a house, or the Town Center) and should be drawn "inside".
  sheltered: boolean;
}

export type MobKind =
  | "goblin"
  | "wolf"
  | "goblinCrossbow"
  | "orc"
  | "skeleton"
  | "armoredOrc"
  | "darkShaman"
  | "giantSpider"
  | "troll"
  | "ogre"
  | "banditClubman"
  | "banditArcher"
  | "banditElite"
  | "halfLatch";

// Hunger-marked elites (ROADMAP Phase 6): a rare raid mob bearing one Hunger's mark. Index = the
// snapshot's `mark` value; HUNGER_MARK_NAMES[mark] names it (sigil-<name>.png / aura-<name>.png).
export enum HungerMark {
  None = 0,
  Gorrath = 1,
  Nemri = 2,
  Rux = 3,
  Morvain = 4,
  Gunne = 5,
  Vhorrun = 6,
}
export const HUNGER_MARK_NAMES = ["", "gorrath", "nemri", "rux", "morvain", "gunne", "vhorrun"];

export interface MobSnapshot {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  // Omitted for unmarked mobs (the common case) to keep snapshots small.
  mark?: HungerMark;
  // Phase 5 bosses only (omitted for every other mob): see BossTier.
  boss?: BossTier;
}

// Phase 5 bosses: "warlord" is the Castle Ruin's Ogre Warlord (one per world, never respawns);
// "elite" leads a mini-boss pack of its own kind. Both are drawn larger (BOSS_RENDER_SCALE) with a
// name label (bossTitle) and a bigger hp bar.
export type BossTier = "warlord" | "elite";
export const BOSS_RENDER_SCALE: Record<BossTier, number> = { warlord: 1.6, elite: 1.3 };
const ELITE_TITLES: Partial<Record<MobKind, string>> = {
  wolf: "Dire Wolf Alpha",
  orc: "Orc Chieftain",
  skeleton: "Skeleton Lord",
  giantSpider: "Spider Matriarch",
  armoredOrc: "Orc Warchief",
  troll: "Troll Elder",
};
export function bossTitle(kind: MobKind, tier: BossTier): string {
  if (tier === "warlord") return "Ogre Warlord";
  return ELITE_TITLES[kind] ?? "Elite";
}

// The shared goal track (ROADMAP Phase 5): the current goal and its progress. `index` counts from 0;
// index === total means every goal is done (title is then a closing line, progress === target).
export interface GoalSnapshot {
  index: number;
  total: number;
  title: string;
  progress: number;
  target: number;
}

export interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  // Visual-only: melee hits flash at the target; ranged ones fly from attacker to target.
  melee?: boolean;
}

// A transient marker where a colonist died; the server drops every one at the next dawn.
export interface GravestoneSnapshot {
  x: number;
  y: number;
  variant: 0 | 1;
}

// Huntable wild game (server entities, unarmed and non-hostile; a hunted boar may charge its hunter).
export type WildlifeKind = "deer" | "rabbit" | "boar" | "pheasant";
// Index = the kind code in the snapshot's flattened `wildlife` list.
export const WILDLIFE_KINDS: WildlifeKind[] = ["deer", "rabbit", "boar", "pheasant"];
// `wildlife` is flattened, WILDLIFE_SNAPSHOT_STRIDE numbers per animal:
// [id, kind code, x (px, rounded), y (px, rounded), state code (WildlifeState below)].
export const WILDLIFE_SNAPSHOT_STRIDE = 5;
export enum WildlifeState {
  Idle = 0,
  Walk = 1,
  Flee = 2,
  Charge = 3,
}

// Night-mob tuning chosen on the main menu (server applies the multipliers; see DIFFICULTY_* there).
export type Difficulty = "easy" | "normal" | "hard";

export type GameEventCategory =
  | "night" | "dawn" | "upgrade" | "death" | "ward" | "deserter" | "raid" | "build"
  // Phase 5: a goal completed / a boss or mini-boss sighted or slain.
  | "milestone" | "boss";

// Per-tile art stage of a farm-type building (snapshot `farmStages`). Grain plots: Sown -> Sprouting ->
// Growing -> Ripe (being cut) -> Harvested (briefly) / Fallow. Hemp: Sown/Growing/Ripe. Pasture:
// Growing/Fat. Sheep Pasture: Sheared/Woolly/Ripe (ready to shear). Orchard: Blossoming/Growing/Fruiting.
export enum FarmStage {
  Sown = 0,
  Sprouting = 1,
  Growing = 2,
  Ripe = 3,
  Harvested = 4,
  Fallow = 5,
  Fat = 6,
  Sheared = 7,
  Woolly = 8,
  Blossoming = 9,
  Fruiting = 10,
}
// `farmStages` is flattened [tile index, FarmStage] pairs; `buildingLevels` is [tile index, level] pairs
// (only buildings above level 1, Town Centers included).
export const FARM_STAGE_SNAPSHOT_STRIDE = 2;
export const BUILDING_LEVEL_SNAPSHOT_STRIDE = 2;
// `constructionSites` is flattened, CONSTRUCTION_SNAPSHOT_STRIDE numbers per site: [tile index, target
// TileType (what will be built / upgraded), progress 0-1000, 1 if an in-place upgrade else 0, builders working].
export const CONSTRUCTION_SNAPSHOT_STRIDE = 5;
// `damagedBuildings` is flattened [tile index, hp permille 0-999] pairs: every building (Town Centers
// included) below full HP. A building missing from it is at full HP.
export const DAMAGED_BUILDING_SNAPSHOT_STRIDE = 2;

export interface TownCenterSnapshot {
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
}

// Reply to a `buildingInfo` request; every number is computed by the server's own formulas.
export interface BuildingInfo {
  name: string;
  tile: TileType;
  level: number;
  maxLevel: number;
  // Hit points of any building mobs can damage (null for the rest, e.g. construction sites, farm plots).
  hp: number | null;
  maxHp: number | null;
  // e.g. "Workers 2", "Beds 3/5", "Population base 10".
  staffing: string;
  bonuses: string[];
  // In-place upgrade (or null when the building can't be upgraded at all).
  upgrade: { cost: string; enabled: boolean; reason: string } | null;
  // 0-1 when a construction / upgrade is queued here, else null.
  construction: number | null;
  // Manual repair (null while the building is at full HP): the materials it costs now ("Free" when
  // already paid) and why it can't be ordered, if so.
  repair: { cost: string; enabled: boolean; reason: string } | null;
}

export type ClientMessage =
  | { type: "join"; name?: string }
  | { type: "input"; dx: number; dy: number }
  | { type: "setTile"; tileX: number; tileY: number; tile: TileType }
  | { type: "attack" }
  | { type: "pause" }
  // Optional difficulty: the restarting client's choice becomes the new world's difficulty.
  | { type: "restart"; difficulty?: Difficulty }
  // Sent after every welcome; only takes effect while the world's difficulty is still unclaimed
  // (see the server's handleSetDifficulty for the race rules).
  | { type: "setDifficulty"; difficulty: Difficulty }
  | { type: "commandMove"; unitIds: string[]; x: number; y: number }
  | { type: "commandAttack"; unitIds: string[]; mobId: string }
  | { type: "commandStance"; unitIds: string[]; stance: Stance }
  | { type: "assignTaskForce"; slot: number; unitIds: string[] }
  | { type: "exchangeResource"; from: "wood" | "iron" | "rock"; to: "wood" | "iron" | "rock" }
  | { type: "buyWithGold"; item: "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock" }
  | { type: "buildingInfo"; tileX: number; tileY: number }
  // Queues the in-place upgrade of the building at the tile (same rules as placing it on itself, no reach limit).
  | { type: "upgradeBuilding"; tileX: number; tileY: number }
  // Pays for the building's missing HP now and makes it the builders' first repair job.
  | { type: "repairBuilding"; tileX: number; tileY: number }
  // Save files (server/saves/<slot>.json). saveGame takes slot1-3 (the autosave is the server's own);
  // loadGame replaces the shared world for everyone connected.
  | { type: "saveGame"; slot: SaveSlot }
  | { type: "loadGame"; slot: SaveSlot }
  | { type: "listSaves" };

export type ServerMessage =
  | {
      type: "welcome";
      id: string;
      tileSize: number;
      worldTilesX: number;
      worldTilesY: number;
      tiles: number[];
      biomes: number[];
      // Explored-tile bitset, base64: bit (i & 7) of byte (i >> 3) is tile index i (y * worldTilesX + x).
      explored: string;
      difficulty: Difficulty;
      // Centre tile of this world's Castle Ruin (null if world-gen couldn't fit one, or an old save).
      // The minimap marks it once that tile is explored.
      castleRuin?: { x: number; y: number } | null;
    }
  | {
      type: "snapshot";
      players: PlayerSnapshot[];
      colonists: ColonistSnapshot[];
      mobs: MobSnapshot[];
      wood: number;
      iron: number;
      rock: number;
      grain: number;
      meat: number;
      fruit: number;
      wool: number;
      cotton: number;
      clothes: number;
      tools: number;
      luxuryItems: number;
      gold: number;
      alcohol: number;
      happiness: number;
      marketBuilt: boolean;
      goldShopBuilt: boolean;
      isNight: boolean;
      // 0-1 through the full day+night cycle; 0 = dawn, night starts at dayFraction.
      cycleProgress: number;
      dayFraction: number;
      isPaused: boolean;
      effects: AttackEffect[];
      townCenterHp: number;
      townCenterMaxHp: number;
      population: number;
      populationCap: number;
      taskForces: Record<string, string[]>;
      // Tile indices (y * worldTilesX + x) of Farm Plots whose crop is mature and being harvested.
      readyFarmPlots: number[];
      // Farm Plots freshly sown (bare soil) and resting fallow; any other plot is growing.
      sownFarmPlots: number[];
      fallowFarmPlots: number[];
      wildlife: number[];
      gravestones: GravestoneSnapshot[];
      difficulty: Difficulty;
      buildingLevels: number[];
      farmStages: number[];
      constructionSites: number[];
      townCenters: TownCenterSnapshot[];
      // See DAMAGED_BUILDING_SNAPSHOT_STRIDE.
      damagedBuildings: number[];
      // The shared goal track's current goal (Phase 5).
      goal?: GoalSnapshot;
    }
  | { type: "tileUpdate"; tileX: number; tileY: number; tile: TileType }
  // One-off notification for the event feed (not continuous state).
  | { type: "event"; category: GameEventCategory; text: string }
  // Tile indices newly explored since the last one (batched a few times a second, never empty).
  | { type: "explored"; tiles: number[] }
  | { type: "buildingInfo"; tileX: number; tileY: number; info: BuildingInfo | null }
  // Reply to listSaves (also served as JSON by GET /saves on the same port, for the main menu).
  | { type: "saveList"; saves: SaveInfo[] }
  // Reply to saveGame / loadGame, to the requesting client only (`action` says which).
  | { type: "saveResult"; ok: boolean; error?: string; slot: SaveSlot; action: "save" | "load" };

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  color: number;
  hp: number;
  maxHp: number;
  // Killed with no Town Center standing to respawn at (game over unless one is rebuilt).
  dead: boolean;
}

export type SaveSlot = "autosave" | "slot1" | "slot2" | "slot3";
export const SAVE_SLOTS: SaveSlot[] = ["autosave", "slot1", "slot2", "slot3"];

// One existing save file's metadata. dayIndex is 0-based (day 1 = 0).
export interface SaveInfo {
  slot: SaveSlot;
  label: string;
  savedAt: string;
  dayIndex: number;
  population: number;
  difficulty: Difficulty;
}
