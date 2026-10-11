export const TICK_RATE = 20;
export const TILE_SIZE = 32;
// Server-side default; the live size is overridable (COLONY_WORLD_SIZE) and sent in `welcome`.
export const DEFAULT_WORLD_TILES = 160;
export const PLAYER_SPEED = 150;
export const PLAYER_HALF_SIZE = 10;
export const PLAYER_MAX_HP = 100;

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
    tile === TileType.WardStone
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
  | "pikeman";

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

export interface MobSnapshot {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  // Visual-only: melee hits flash at the target; ranged ones fly from attacker to target.
  melee?: boolean;
}

export type ClientMessage =
  | { type: "join"; name?: string }
  | { type: "input"; dx: number; dy: number }
  | { type: "setTile"; tileX: number; tileY: number; tile: TileType }
  | { type: "attack" }
  | { type: "pause" }
  | { type: "restart" }
  | { type: "commandMove"; unitIds: string[]; x: number; y: number }
  | { type: "commandAttack"; unitIds: string[]; mobId: string }
  | { type: "commandStance"; unitIds: string[]; stance: Stance }
  | { type: "assignTaskForce"; slot: number; unitIds: string[] }
  | { type: "exchangeResource"; from: "wood" | "iron" | "rock"; to: "wood" | "iron" | "rock" }
  | { type: "buyWithGold"; item: "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock" };

export type ServerMessage =
  | {
      type: "welcome";
      id: string;
      tileSize: number;
      worldTilesX: number;
      worldTilesY: number;
      tiles: number[];
      biomes: number[];
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
    }
  | { type: "tileUpdate"; tileX: number; tileY: number; tile: TileType };

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  color: number;
  hp: number;
  maxHp: number;
}
