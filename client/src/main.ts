import {
  Application,
  Assets,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type {
  ServerMessage,
  PlayerSnapshot,
  ColonistSnapshot,
  ColonistKind,
  MobSnapshot,
  MobKind,
  AttackEffect,
  Stance,
  GravestoneSnapshot,
  GameEventCategory,
  Difficulty,
  WildlifeKind,
  TownCenterSnapshot,
  BuildingInfo,
  SaveInfo,
  SaveSlot,
  GoalSnapshot,
  GateLock,
} from "./protocol";
import { TICK_RATE } from "./protocol"; // long days: respawn-window ETA
import {
  Biome,
  BOSS_RENDER_SCALE,
  bossTitle,
  BUILDING_LEVEL_SNAPSHOT_STRIDE,
  CONSTRUCTION_SNAPSHOT_STRIDE,
  DAMAGED_BUILDING_SNAPSHOT_STRIDE,
  FARM_STAGE_SNAPSHOT_STRIDE,
  FarmStage,
  GATE_FLAG_OPEN,
  GATE_FLAG_OVERRUN,
  GATE_SNAPSHOT_STRIDE,
  HUNGER_MARK_NAMES,
  HungerMark,
  isRoadTile,
  PLAYER_SPEED,
  TILE_SIZE,
  TileType,
  VISION_RADIUS_COLONIST,
  VISION_RADIUS_PLAYER,
  WILDLIFE_KINDS,
  WILDLIFE_SNAPSHOT_STRIDE,
  WildlifeState,
} from "./protocol";
import { SOUND_SILENT_RADIUS_TILES, SoundManager, proximityGain } from "./sound";
import type { FightSnapshot } from "./protocol";
import { FIGHT_WINDOW_SECONDS } from "./protocol";
import { compassDirection, fightArrowAlpha, placeEdgeArrow } from "./fightArrows";

const SERVER_URL = "ws://localhost:8080";
// The same server answers plain HTTP: GET /saves lists the save slots (the menu has no socket yet).
const SAVES_URL = `${SERVER_URL.replace(/^ws/, "http")}/saves`;
// Main menu Continue / Load Game: the slot to load right after the first welcome (else null).
let pendingLoadSlot: SaveSlot | null = null;

type ToolCategory = "combat" | "farming" | "industry" | "civic" | "trade";

interface ToolDef {
  tile: TileType;
  label: string;
  key: string;
  cost: string;
  category: ToolCategory;
}

// Break has no category of its own — it's pinned so it's always visible regardless of
// which category tab is active (see refreshToolbarVisibility).
const TOOL_CATEGORIES: { key: ToolCategory; label: string }[] = [
  { key: "farming", label: "Farming" },
  { key: "combat", label: "Combat" },
  { key: "industry", label: "Industry" },
  { key: "civic", label: "Civic" },
  { key: "trade", label: "Trade" },
];

const TOOLS: ToolDef[] = [
  { tile: TileType.Wall, label: "Wood Wall", key: "1", cost: "3 wood. 200 HP", category: "combat" },
  { tile: TileType.StoneWall, label: "Stone Wall", key: "2", cost: "3 rock. 900 HP", category: "combat" },
  // Walls & gates (2026-10-23). Every letter is taken (and [ is the Tower), so the gate uses ].
  {
    tile: TileType.Gate,
    label: "Gate",
    key: "]",
    cost: "10 wood + 5 rock. 450 HP. Opens for your units, closed to monsters (lock it from its info panel); anyone may pass while it's open",
    category: "combat",
  },
  { tile: TileType.LumberjackPost, label: "Lumberjack", key: "3", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.FarmPlot, label: "Farm", key: "4", cost: "Free, within 2 tiles of a Barn (up to 8 per Barn)", category: "farming" },
  { tile: TileType.KnightPost, label: "Hall of the Sworn", key: "5", cost: "10 iron + 5 rock (upgradeable)", category: "combat" },
  { tile: TileType.ArcherPost, label: "Archery Range", key: "6", cost: "10 wood (on Wall = Tower, upgradeable)", category: "combat" },
  {
    tile: TileType.Tower,
    label: "Tower",
    key: "[",
    cost: "20 wood + 15 rock. Shoots the nearest monster within 7 tiles; no workers (upgradeable: faster, harder shots)",
    category: "combat",
  },
  { tile: TileType.IronMinePost, label: "Iron Mine", key: "7", cost: "Free, on ore; place on a mine to upgrade", category: "industry" },
  { tile: TileType.RockMinePost, label: "Quarry", key: "8", cost: "Free, on ore; place on a mine to upgrade", category: "industry" },
  { tile: TileType.Empty, label: "Demolish", key: "9", cost: "", category: "farming" },
  { tile: TileType.House, label: "Cottage", key: "h", cost: "10 wood (+1 pop per adjacent house or workplace; upgrade by placing on it)", category: "civic" },
  { tile: TileType.BarnPost, label: "Barn", key: "b", cost: "15 wood (upgradeable)", category: "farming" },
  { tile: TileType.ChurchPost, label: "Church", key: "c", cost: "15 wood (upgradeable)", category: "civic" },
  // w/a/s/d are movement keys, so the farm hotkeys avoid them.
  { tile: TileType.Pasture, label: "Pasture (Meat)", key: "p", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.Orchard, label: "Orchard (Fruit)", key: "o", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.WoolFarm, label: "Sheep Pasture", key: "f", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.CottonFarm, label: "Hemp Field", key: "n", cost: "Free (upgradeable)", category: "farming" },
  {
    tile: TileType.HunterHut,
    label: "Hunter's Hut",
    key: "q",
    cost: "15 wood (place on it to upgrade: +1 hunter per level). Hunts wild game for meat by day",
    category: "farming",
  },
  {
    tile: TileType.ForagerHut,
    label: "Forager's Hut",
    key: "y",
    cost: "15 wood (place on it to upgrade: +1 forager per level). Picks wild berries, fruit and mushrooms by day",
    category: "farming",
  },
  {
    tile: TileType.TailorShop,
    label: "Tailor Shop",
    key: "t",
    cost: "10 wood + 5 iron (upgradeable). Crafts 1 Wool + 1 Hemp → 1 Clothes",
    category: "industry",
  },
  {
    tile: TileType.Blacksmith,
    label: "Blacksmith",
    key: "k",
    cost: "10 wood + 5 iron (upgradeable). Crafts 1 Iron + 1 Wood → 1 Tools",
    category: "industry",
  },
  {
    tile: TileType.LuxuryWorkshop,
    label: "Jeweler's Workshop",
    key: "l",
    cost: "10 wood + 5 iron (upgradeable). Crafts 1 Rock + 1 Fruit → 1 Luxury Item",
    category: "industry",
  },
  { tile: TileType.Market, label: "Bazaar", key: "m", cost: "15 wood", category: "trade" },
  { tile: TileType.GoldShop, label: "Trading Post", key: "g", cost: "15 wood", category: "trade" },
  {
    tile: TileType.Brewery,
    label: "Brewery",
    key: "r",
    cost: "10 wood + 5 iron (upgradeable). Brews 2 Grain → 1 Alcohol",
    category: "industry",
  },
  {
    tile: TileType.Tavern,
    label: "Tavern",
    key: "v",
    cost: "20 wood + 10 rock (upgradeable). Sells 1 Alcohol → 10 Gold. Raises happiness within 6 tiles",
    category: "trade",
  },
  { tile: TileType.MilitiaPost, label: "Militia Camp", key: "j", cost: "5 wood + 5 iron (upgradeable)", category: "combat" },
  {
    tile: TileType.WardStone,
    label: "Ward Stone",
    key: "u",
    cost: "20 wood + 10 tools. Its Bishop keeps the Unbroken Watch: nothing within 12 tiles can be targeted by monsters while he stands vigil",
    category: "civic",
  },
  {
    tile: TileType.BuildersGuild,
    label: "Builders' Guild",
    key: "i",
    cost: "15 wood (place on it to upgrade: +1 builder per level). Builders raise every new building and upgrade",
    category: "civic",
  },
  {
    tile: TileType.TownCenter,
    label: "Town Center",
    key: "0",
    cost: "60 wood + 30 rock + 20 iron, 12+ tiles from other Town Centers and ruins/camps (place on one to upgrade: +5% output and damage per level). Built at once if none stands",
    category: "civic",
  },
  // Every letter is taken (tools, wasd movement, z/x/e stances), so roads use - and =.
  { tile: TileType.Road, label: "Road", key: "-", cost: "1 rock. Colonists and you move 25% faster on roads", category: "civic" },
  { tile: TileType.CobbleRoad, label: "Cobble Road", key: "=", cost: "2 rock. A paved road (same 25% speed bonus)", category: "civic" },
];

const COLONIST_COLORS: Record<string, number> = {
  lumberjack: 0xd4a04c,
  farmer: 0x8fbf4d,
  knight: 0x7f8fa6,
  archer: 0x5fa8d3,
  ironMiner: 0xb8b8c8,
  rockMiner: 0x8d7b68,
  bishop: 0xf0e6d2,
  farmhand: 0xf28c38,
  artisan: 0xb36be0,
  militia: 0xc9a27a,
  spearman: 0xa86a3c,
  pikeman: 0x7a3f1e,
  hunter: 0x6b7d3a,
  forager: 0xc9a46a,
  builder: 0xb0784a,
};

// Only military units take part in selection / commands / task forces.
const COMMANDABLE_KINDS = new Set<string>(["knight", "archer", "bishop", "militia", "spearman", "pikeman"]);
// Workers who vanish into their building/plot while on the job, instead of standing visibly on
// top of it. Guards/militia/bishop stay visible — you want to see your garrison standing watch.
const WORKER_KINDS = new Set<string>([
  "lumberjack",
  "farmer",
  "ironMiner",
  "rockMiner",
  "farmhand",
  "artisan",
  "hunter",
  "forager",
  "builder",
]);
// Archer is the one garrison kind that also hides at its post: an Archer Tower reads as the
// archer firing from inside it, not standing beside it, unlike Barracks/Militia Camp where the
// garrison visibly stands watch outside.
const HIDE_AT_POST_KINDS = new Set<string>([...WORKER_KINDS, "archer"]);
const AT_POST_HIDE_RADIUS_PX = 6;
// Archers loiter within GARRISON_LOITER_PX (1.5 tiles) of their post server-side, not pinned to
// its exact center like a stationary worker, so the tight worker radius above would almost never
// match and the archer would stay visible nearly all the time. Match that loiter radius instead,
// so the archer reads as "inside the tower" for its whole idle/patrol range and only reappears
// once actually rallied or chasing beyond it.
const ARCHER_HIDE_RADIUS_PX = 48;
// Buildings whose garrison (knights/archers with matching postX/postY) can be click-selected.
const GARRISON_TILES = new Set<number>([
  TileType.KnightPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ArcherPost,
  TileType.ArcherTower,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
]);
const SELECTION_COLOR = 0x00e5ff;
const DRAG_THRESHOLD_PX = 6;
const UNIT_HIT_RADIUS = 10;

// Formation rank for a group move order, front to back (0 = closest to the destination, i.e.
// leads the march). "artillery" has no matching colonist kind yet, but the slot is reserved for
// a future siege unit so the ordering doesn't need revisiting when one is added.
const FORMATION_RANK: Record<string, number> = {
  knight: 0,
  militia: 0,
  spearman: 0,
  pikeman: 0,
  archer: 1,
  bishop: 2,
  artillery: 3,
};
// Max units per row within a rank's block before wrapping to a row behind it (Age of Empires'
// box formation uses a similarly tight, roughly-square block per unit type rather than one
// long line).
const FORMATION_MAX_ROW_WIDTH = 5;
// Slot spacing (both across a row and between rows), in tiles, by the group's stance. A unit's
// visible footprint is ~23-28px wide and ~31px tall (26.5px body + the HP bar 18px above center), so
// at 1.0 (32px) rows touched edge-to-edge and diagonal facings (22.6px x/y offsets) overlapped; 1.25
// leaves a visible gap at every facing. Defensive deliberately packs tighter than that (a shield-wall
// look, sprites may touch on diagonals); Aggressive spreads out. Battle discipline (2026-10-23) tightened
// every stance (was 0.9 / 1.25 / 1.5): server bodies are 14px across, so even 0.8 (25.6px) never overlaps.
const FORMATION_SPACING_TILES: Record<Stance, number> = {
  defensive: 0.8,
  normal: 1.05,
  aggressive: 1.3,
};
// Line-drag formations (computeLineFormationTargets). Minimum frontage: never more than
// LINE_MAX_DEPTH_ROWS rows deep, so a short drag can't string the group out in single file -
//   minCols = min(n, max(2, ceil(n / LINE_MAX_DEPTH_ROWS))),  minLength = (minCols - 1) * spacing
// (n = selected units): a drag shorter than minLength is widened symmetrically about its midpoint.
// A long drag spreads the front row along it, but no wider apart than LINE_MAX_GAP x spacing (the row
// stays centred on the line), so a thin line never opens gaps for enemies to walk through.
const LINE_MAX_DEPTH_ROWS = 3;
const LINE_MAX_GAP = 1.5;
// Stance hotkeys. 'c' (the AoE-style third key) is the Church build tool, so aggressive is 'e'.
const STANCE_HOTKEYS: Record<string, Stance> = { z: "defensive", x: "normal", e: "aggressive" };
const STANCE_LABEL: Record<Stance, string> = { defensive: "Defensive", normal: "Normal", aggressive: "Aggressive" };
// Per-unit move orders go out one at a time, units already closest to their own slot first, this
// far apart; the step shrinks for big groups so the last unit never waits more than the max spread.
// Measured with server/formation-test.mjs (stacked-sprite time on 90/180-degree turns), this beat
// both sending everything at once and sending whole ranks front-first.
const FORMATION_DISPATCH_STEP_MS = 80;
const FORMATION_DISPATCH_MAX_SPREAD_MS = 800;
// Destination marker for a formation move: stays until every unit has stopped walking (arrived, or
// peeled off to fight), then fades. Hard cap in case a unit never settles.
const FORMATION_MARKER_MIN_MS = 700;
const FORMATION_MARKER_MAX_MS = 60000;
const FORMATION_MARKER_FADE_MS = 400;
// Minimum click-to-target radius; bigger kinds get half their rendered sprite size instead
// (see mobHitRadius) so trolls/ogres are clickable anywhere on their body.
const MOB_HIT_RADIUS = 12;

// Per-kind mob size: radius scales roughly with toughness so size alone reads as a threat cue.
// Human-sized kinds (bandits, skeleton, shaman) stay close to the 28px colonist height (radius 8).
// Drives the sprite's rendered size (radius * MOB_SPRITE_SIZE_PER_RADIUS along the texture's
// longer side) and, if a texture is missing, the fallback colored circle.
const MOB_VISUALS: Record<MobKind, { color: number; radius: number }> = {
  goblin: { color: 0xa4c639, radius: 7 },
  wolf: { color: 0x8a8a8a, radius: 7.5 },
  goblinCrossbow: { color: 0x6b8e23, radius: 7 },
  orc: { color: 0x3d7a2a, radius: 9.5 },
  skeleton: { color: 0xe8e0c8, radius: 8.5 },
  armoredOrc: { color: 0x4a5a3a, radius: 11 },
  darkShaman: { color: 0x4b1f6b, radius: 8 },
  giantSpider: { color: 0x1e1a1e, radius: 8.5 },
  troll: { color: 0x3b4a2a, radius: 13 },
  ogre: { color: 0x8b5a2b, radius: 15 },
  banditClubman: { color: 0x6b4a2a, radius: 8.2 },
  banditArcher: { color: 0x5a5a3a, radius: 8 },
  // Bandits are people: sized against the 28px colonist (radius 8 ~ 28px). The elite is ~1.25x a
  // regular bandit so it still reads as a step up without towering over the colony's own units.
  banditElite: { color: 0x7a2a2a, radius: 10 },
  // Smaller than a goblin — "barely more than a shadow".
  halfLatch: { color: 0x0e0e12, radius: 5.5 },
};
const MOB_KINDS = Object.keys(MOB_VISUALS) as MobKind[];
// Mob kinds whose texture isn't /sprites/<kind>.png.
const MOB_SPRITE_URL_OVERRIDES: Partial<Record<MobKind, string>> = {
  halfLatch: "/sprites/halfLatch0.png",
  banditClubman: "/sprites/banditClubmanWalk0.png",
  banditArcher: "/sprites/banditArcherWalk2.png",
  banditElite: "/sprites/bandit.png",
};

const artUrl = (name: string) => `/sprites/${name}.png`;
const frameUrls = (name: string, count: number) =>
  Array.from({ length: count }, (_, i) => `/sprites/${name}${i}.png`);

// Walk + action (attack, or the worker's chop/mine/heal/... cycle) frame URLs per colonist kind.
// Each row was normalized at extraction onto one shared canvas with the feet on the bottom edge.
const COLONIST_ANIM_URLS: Record<ColonistKind, { walk: string[]; action: string[] }> = {
  knight: { walk: frameUrls("knightWalk", 4), action: frameUrls("knightAttack", 4) },
  archer: { walk: frameUrls("archerWalk", 4), action: frameUrls("archerAttack", 6) },
  militia: { walk: frameUrls("militiaWalk", 4), action: frameUrls("militiaAttack", 3) },
  spearman: { walk: frameUrls("spearmanWalk", 4), action: frameUrls("spearmanAttack", 3) },
  pikeman: { walk: frameUrls("pikemanWalk", 4), action: frameUrls("pikemanAttack", 3) },
  lumberjack: { walk: frameUrls("lumberjackWalk", 4), action: frameUrls("lumberjackChop", 3) },
  farmer: { walk: frameUrls("farmerWalk", 4), action: frameUrls("farmerHarvest", 3) },
  ironMiner: { walk: frameUrls("ironMinerWalk", 4), action: frameUrls("ironMinerMine", 3) },
  rockMiner: { walk: frameUrls("rockMinerWalk", 4), action: frameUrls("rockMinerMine", 3) },
  bishop: { walk: frameUrls("bishopWalk", 4), action: frameUrls("bishopHeal", 3) },
  farmhand: { walk: frameUrls("farmhandWalk", 4), action: frameUrls("farmhandTend", 3) },
  artisan: { walk: frameUrls("artisanWalk", 4), action: frameUrls("artisanCraft", 3) },
  // Stand-ins until SPRITES.md #28/#29 land (see COLONIST_OPTIONAL_ANIM_URLS): the hunter borrows the
  // archer's bow cycle, the forager the farmhand's, each tinted (COLONIST_STANDIN_TINT).
  hunter: { walk: frameUrls("archerWalk", 4), action: frameUrls("archerAttack", 6) },
  forager: { walk: frameUrls("farmhandWalk", 4), action: frameUrls("farmhandTend", 3) },
  // Stand-in until the builder frames load (COLONIST_OPTIONAL_ANIM_URLS).
  builder: { walk: frameUrls("lumberjackWalk", 4), action: frameUrls("lumberjackChop", 3) },
};
// Dedicated art for kinds still on stand-ins. Loaded separately and optionally (loadOptionalTextures):
// when every frame of a set loads it replaces the stand-in set and its tint; missing files are fine.
// `carry` (optional) plays in the server's "carrying" state (walking a carcass / full basket home).
const COLONIST_OPTIONAL_ANIM_URLS: Partial<Record<ColonistKind, { walk: string[]; action: string[]; carry: string[] }>> = {
  hunter: { walk: frameUrls("hunterWalk", 4), action: frameUrls("hunterHunt", 3), carry: frameUrls("hunterCarry", 2) },
  forager: { walk: frameUrls("foragerWalk", 4), action: frameUrls("foragerForage", 3), carry: frameUrls("foragerCarry", 2) },
  // Carry = hauling a plank to a construction site (server state "carrying"); action = hammering.
  builder: { walk: frameUrls("builderWalk", 4), action: frameUrls("builderBuild", 4), carry: frameUrls("builderCarry", 2) },
};
const COLONIST_STANDIN_TINT: Partial<Record<ColonistKind, number>> = {
  hunter: 0xb5d39a,
  forager: 0xffd9a8,
  builder: 0xffc890,
};
// Static (fallback) pose per kind when it isn't /sprites/<kind>.png.
const COLONIST_STATIC_URL_OVERRIDES: Partial<Record<ColonistKind, string>> = {
  hunter: "/sprites/archer.png",
  forager: "/sprites/farmhand.png",
  builder: "/sprites/lumberjack.png",
};
// Player (mounted knight): walk + 2-frame lance attack, idle = walk frame 0. The walk row carries
// the banner, the attack row doesn't; both canvases are centered on the horse's body (not the
// banner/lance), so the feet-pinned swap between rows doesn't hop. playerIdle.png (the banner-only
// standing frame) is staged on disk but unused, per the idle = walk-frame-0 convention.
const PLAYER_ANIM_URLS = { walk: frameUrls("playerWalk", 4), action: frameUrls("playerAttack", 2) };
// Server colonist states that play the action cycle / the walk cycle. Any other state walks only
// while the colonist is actually moving (e.g. civilians sheltering), else shows the static pose.
const COLONIST_ACTION_STATES = new Set([
  "attacking",
  "gathering",
  "mining",
  "farming",
  "crafting",
  "healing",
  "warding",
  "hunting",
  "foraging",
  "building",
  "repairing",
]);
const COLONIST_WALK_STATES = new Set([
  "engaging",
  "returning",
  "toResource",
  "toPost",
  "approaching",
  "patrolling",
  "stalking",
  "collecting",
  "carrying",
  "toForage",
  "toRepair",
]);
// Hunter/forager states that count as "working" in the Colony panel (out on the job, not idle at the hut).
const FOOD_WORKER_BUSY_STATES = new Set(["stalking", "hunting", "collecting", "carrying", "toForage", "foraging"]);

// Animated and/or multi-look mob kinds. A kind with several entries picks one per mob by a stable
// hash of its id. `idle` is the standing pose (defaults to the first walk frame).
interface MobVariantUrls {
  idle?: string;
  walk?: string[];
  action?: string[];
}
const MOB_VARIANT_URLS: Partial<Record<MobKind, MobVariantUrls[]>> = {
  banditClubman: [{ walk: frameUrls("banditClubmanWalk", 5), action: frameUrls("banditClubmanAttack", 4) }],
  // The source sheet's "archer walk" row starts with two club-holding frames and its attack row
  // has a spear-throw in the middle, so this only uses its bow-holding frames.
  banditArcher: [
    {
      walk: ["/sprites/banditArcherWalk2.png", "/sprites/banditArcherAttack0.png"],
      action: [
        "/sprites/banditArcherAttack0.png",
        "/sprites/banditArcherWalk3.png",
        "/sprites/banditArcherAttack2.png",
      ],
    },
  ],
  banditElite: [
    { idle: "/sprites/bandit.png", walk: frameUrls("banditWalk", 4), action: frameUrls("banditAttack", 3) },
  ],
  halfLatch: frameUrls("halfLatch", 5).map((idle) => ({ idle })),
  // The monster roster: one look each, 4 walk + 3 attack frames, idle = walk frame 0. The static
  // /sprites/<kind>.png stays as the fallback texture only.
  goblin: [{ walk: frameUrls("goblinWalk", 4), action: frameUrls("goblinAttack", 3) }],
  wolf: [{ walk: frameUrls("wolfWalk", 4), action: frameUrls("wolfAttack", 3) }],
  goblinCrossbow: [{ walk: frameUrls("goblinCrossbowWalk", 4), action: frameUrls("goblinCrossbowAttack", 3) }],
  orc: [{ walk: frameUrls("orcWalk", 4), action: frameUrls("orcAttack", 3) }],
  skeleton: [{ walk: frameUrls("skeletonWalk", 4), action: frameUrls("skeletonAttack", 3) }],
  armoredOrc: [{ walk: frameUrls("armoredOrcWalk", 4), action: frameUrls("armoredOrcAttack", 3) }],
  giantSpider: [{ walk: frameUrls("giantSpiderWalk", 4), action: frameUrls("giantSpiderAttack", 3) }],
  darkShaman: [{ walk: frameUrls("darkShamanWalk", 4), action: frameUrls("darkShamanAttack", 3) }],
  troll: [{ walk: frameUrls("trollWalk", 4), action: frameUrls("trollAttack", 3) }],
  ogre: [{ walk: frameUrls("ogreWalk", 4), action: frameUrls("ogreAttack", 3) }],
};
// Wide, low kinds whose anim set is sized by the first walk frame's longer side (its width), like
// the static mob textures (upsertMob), so they don't balloon horizontally. Every other animated
// kind fits by height: a walk canvas is widened symmetrically around the body's centroid to fit
// each frame's weapon reach, so its width overstates an upright body and a longer-side fit would
// shrink orcs/crossbowmen ~15% below their static size.
const MOB_ANIM_FIT_LONGER_SIDE = new Set<MobKind>(["wolf", "giantSpider"]);
// A stationary mob within this distance of a colonist/player plays its attack cycle (mob snapshots
// carry no state, so this is inferred client-side).
const MOB_ATTACK_ANIM_RANGE_PX = 40;
// Ranged kinds stand off at their server attack range (banditArcher/goblinCrossbow: TILE_SIZE * 4,
// darkShaman: TILE_SIZE * 5), plus slack.
const MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX: Partial<Record<MobKind, number>> = {
  banditArcher: TILE_SIZE * 4 + 16,
  goblinCrossbow: TILE_SIZE * 4 + 16,
  darkShaman: TILE_SIZE * 5 + 16,
};

function stableHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
// Same ratio colonists use: their r=8 fallback circle maps to the 28px COLONIST_SPRITE_HEIGHT.
// Goblin (r7) -> ~24px, ogre (r15) -> ~52px.
const MOB_SPRITE_SIZE_PER_RADIUS = 3.5;

function mobHitRadius(kind: MobKind, scale = 1): number {
  const radius = (MOB_VISUALS[kind] ?? MOB_VISUALS.goblin).radius;
  return Math.max(MOB_HIT_RADIUS, (radius * MOB_SPRITE_SIZE_PER_RADIUS * scale) / 2);
}

// Sprite art per tile type. Empty (bare floor) is deliberately absent.
const TILE_SPRITE_FILES: Partial<Record<TileType, string>> = {
  [TileType.TownCenter]: "townCenter",
  [TileType.Wall]: "woodWall",
  [TileType.StoneWall]: "stoneWall",
  [TileType.Gate]: "gateWoodClosed",
  [TileType.KnightPost]: "barracks",
  [TileType.CastleLevel2]: "castleLv2",
  [TileType.CastleLevel3]: "castleLv3",
  [TileType.ArcherPost]: "archeryRange",
  [TileType.ArcherTower]: "archerTower",
  [TileType.Tower]: "archerTower",
  [TileType.MilitiaPost]: "militiaCamp",
  [TileType.MilitiaCamp2]: "militiaCamp2",
  [TileType.MilitiaCamp3]: "militiaCamp3",
  [TileType.House]: "cottage",
  [TileType.BigHouse]: "bigCottage",
  [TileType.HouseLevel2]: "cottageLv2",
  [TileType.ChurchPost]: "church",
  [TileType.LumberjackPost]: "lumberjackPost",
  [TileType.FarmPlot]: "farmPlotGrowing",
  [TileType.BarnPost]: "barn",
  [TileType.Pasture]: "pasture",
  [TileType.Orchard]: "orchard",
  [TileType.WoolFarm]: "sheepPasture",
  [TileType.CottonFarm]: "hempField",
  [TileType.IronMinePost]: "ironMine",
  [TileType.RockMinePost]: "quarry",
  [TileType.TailorShop]: "tailorShop",
  [TileType.Blacksmith]: "blacksmith",
  [TileType.LuxuryWorkshop]: "jewelersWorkshop",
  [TileType.Brewery]: "brewery",
  [TileType.Market]: "bazaar",
  [TileType.GoldShop]: "tradingPost",
  [TileType.Tavern]: "tavern",
  [TileType.Tree]: "tree",
  [TileType.Rock]: "rock",
  [TileType.IronOre]: "ironOre",
  [TileType.Water]: "waterTile",
  [TileType.RuinWall1]: "ruinWall1",
  [TileType.RuinWall2]: "ruinWall2",
  [TileType.RuinArch]: "stoneArch",
  [TileType.RuinStatue]: "statue",
  [TileType.RuinRubble]: "rubble",
  [TileType.PropCampfire]: "campfire",
  [TileType.PropCart]: "cart",
  [TileType.PropBarrel]: "barrel",
  [TileType.PropCrate]: "crate",
  [TileType.PropFence]: "fence",
  [TileType.AbbeyHall]: "abbeyHall",
  [TileType.PropCross]: "cross",
  [TileType.PropLanternPost]: "lanternPost",
  [TileType.WardStone]: "wardStone",
  [TileType.BuildersGuild]: "buildersGuild",
  // Roads are autotiled in setTileSprite (ROAD_AUTOTILE); these are the construction-site / ghost art.
  [TileType.Road]: "road-isolated",
  [TileType.CobbleRoad]: "cobblePlaza",
  // Stand-in art (tinted, see TILE_STANDIN_TINT) until the real sprites in TILE_OPTIONAL_ART land.
  [TileType.HunterHut]: "lumberjackPost",
  [TileType.ForagerHut]: "orchard",
  [TileType.BerryBush]: "bush3",
  [TileType.BerryBushPicked]: "bush3",
  [TileType.FruitTree]: "tree",
  [TileType.FruitTreePicked]: "tree",
  [TileType.MushroomPatch]: "flowers1",
  [TileType.MushroomPatchPicked]: "tallGrass",
};
// Dedicated art per tile (SPRITES.md #30-#32), loaded optionally: a file that exists replaces the
// TILE_SPRITE_FILES stand-in above and drops its tint; a missing one keeps the stand-in.
const TILE_OPTIONAL_ART: Partial<Record<TileType, string>> = {
  [TileType.HunterHut]: "hunterHut",
  [TileType.ForagerHut]: "foragerHut",
  [TileType.BerryBush]: "berryBushRipe",
  [TileType.BerryBushPicked]: "berryBushPicked",
  [TileType.FruitTree]: "appleTreeRipe",
  [TileType.FruitTreePicked]: "appleTreePicked",
  [TileType.MushroomPatch]: "mushroomRipe",
  [TileType.MushroomPatchPicked]: "mushroomPicked",
};
// Alternate looks picked per tile by a stable position hash (half the fruit trees are pear/plum).
const TILE_OPTIONAL_ALT_ART: Partial<Record<TileType, string>> = {
  [TileType.FruitTree]: "pearTreeRipe",
  [TileType.FruitTreePicked]: "pearTreePicked",
};
// Multiplicative tints that tell a stand-in apart from the building/prop whose art it borrows.
const TILE_STANDIN_TINT: Partial<Record<TileType, number>> = {
  [TileType.HunterHut]: 0xa8c08a,
  [TileType.ForagerHut]: 0xf0c890,
  [TileType.BerryBush]: 0xff9a9a,
  [TileType.BerryBushPicked]: 0x8a9478,
  [TileType.FruitTree]: 0xffc890,
  [TileType.FruitTreePicked]: 0x9a9a84,
  [TileType.MushroomPatch]: 0xd8a080,
  [TileType.MushroomPatchPicked]: 0x8a8a70,
};
// Looping tile animations (client-side, cosmetic). All frames of a loop share one canvas, so the
// box-fit scale setTileSprite computes from frame 0 stays valid for every frame. One shared clock
// drives them all (see the ticker in main); `phased` loops offset each tile by a stable hash so
// neighbouring campfires don't flicker in lockstep, while water stays in sync across tiles.
const TILE_ANIM: Partial<Record<TileType, { urls: string[]; frameMs: number; phased: boolean }>> = {
  [TileType.PropCampfire]: { urls: frameUrls("campfire", 4), frameMs: 140, phased: true },
  [TileType.PropLanternPost]: { urls: frameUrls("lanternPost", 4), frameMs: 200, phased: true },
  [TileType.Water]: { urls: frameUrls("waterTile", 4), frameMs: 450, phased: false },
};
// Damaged buildings (client, cosmetic): flame width (px) per fire tier 1-3 (campfire0-3 frames),
// the soot tint on the building art, a smoke puff (fx-poof) every FIRE_SMOKE_MS per building from tier
// 2, and a cap on simultaneous overlays.
const FIRE_FLAME_WIDTH = [0, 12, 18, 26];
const SOOT_TINT = 0x8c7c6c;
const FIRE_SMOKE_MS = 1600;
const MAX_FIRE_OVERLAYS = 80;
// Farm art per server stage (snapshot `farmStages`, FarmStage in protocol.ts). A stage with no entry
// (or whose file failed to load) shows the tile's normal TILE_SPRITE_FILES art.
const FARM_STAGE_ART: Partial<Record<TileType, Partial<Record<FarmStage, string>>>> = {
  [TileType.FarmPlot]: {
    [FarmStage.Sown]: "farmPlotSown",
    [FarmStage.Sprouting]: "farmPlotSprouting",
    [FarmStage.Growing]: "farmPlotGrowing",
    [FarmStage.Ripe]: "farmPlotReady",
    [FarmStage.Harvested]: "farmPlotHarvested",
    [FarmStage.Fallow]: "farmPlotFallow",
  },
  [TileType.CottonFarm]: {
    [FarmStage.Sown]: "hempFieldSown",
    [FarmStage.Growing]: "hempFieldGrowing",
    [FarmStage.Ripe]: "hempFieldRipe",
  },
  [TileType.Pasture]: { [FarmStage.Growing]: "pastureGrowing", [FarmStage.Fat]: "pastureFat" },
  [TileType.WoolFarm]: {
    [FarmStage.Sheared]: "sheepPastureSheared",
    [FarmStage.Woolly]: "sheepPastureWoolly",
    [FarmStage.Ripe]: "sheepPastureReady",
  },
  [TileType.Orchard]: { [FarmStage.Blossoming]: "orchardBlossoming", [FarmStage.Fruiting]: "orchardFruiting" },
};
// Tier art by building level (snapshot `buildingLevels`; level 1 = index 0). Missing files fall back to
// the tile's TILE_SPRITE_FILES art.
const TILE_LEVEL_ART: Partial<Record<TileType, string[]>> = {
  [TileType.HunterHut]: ["hunterHut", "hunterHutLv2", "hunterHutLv3"],
  [TileType.ForagerHut]: ["foragerHut", "foragerHutLv2", "foragerHutLv3"],
  [TileType.BuildersGuild]: ["buildersGuild", "buildersGuildLv2", "buildersGuildLv3"],
  [TileType.TownCenter]: ["townCenterLv1", "townCenterLv2", "townCenterKeep"],
};
// The tiered Town Center art (a plaza on its own diamond patch, then the Keep) skips the box fit like
// townCenter.png does: rendered `widthTiles` wide, `anchor` (the patch's center, under the statue / the
// keep's gate court) pinned on the tile center.
const TOWN_CENTER_LEVEL_FIT = [
  { widthTiles: 3, anchor: { x: 0.51, y: 0.62 } },
  { widthTiles: 3, anchor: { x: 0.51, y: 0.63 } },
  { widthTiles: 3.2, anchor: { x: 0.5, y: 0.68 } },
];
// Placement ghost while the Town Center tool is selected.
const TOWN_CENTER_MARKER_URL = "/sprites/townCenterMarker.png";
// A construction site shows its target's art faded and tinted (plus a scaffold + progress bar overlay).
const CONSTRUCTION_ALPHA = 0.45;
const CONSTRUCTION_TINT = 0xd8b890;
// A hunter's deer kill lies on the ground this long before it leaves its blood stain.
const DEER_FALLEN_URL = "/sprites/deerFallen.png";
const DEER_FALLEN_MS = 2600;
// Indexed by GravestoneSnapshot.variant.
const GRAVESTONE_URLS = ["/sprites/gravestone.png", "/sprites/gravestone2.png"];
// Rendered height in px: a little shorter than a colonist so it reads as a ground marker.
const GRAVESTONE_HEIGHT = 20;
// Ambient critters (client-only, cosmetic: never sent to or known by the server, no collision, no
// interaction). Each client rolls its own on every welcome, so two players won't see the same crow.
// `size` is the rendered canvas width in px; counts scale with the eligible terrain area (one critter
// per `tilesPer` eligible tiles) and are capped. Deer used to live here too; they are now real server
// game (see WILDLIFE_ART).
const WILDLIFE = {
  crow: { frames: frameUrls("crow", 4), size: 12, tilesPer: 1400, max: 14 },
  frog: { frames: frameUrls("frog", 3), size: 9, tilesPer: 60, max: 16 },
};
// Huntable server wildlife (snapshot `wildlife`). Each kind's own frames (SPRITES.md #33) load from
// WILDLIFE_OPTIONAL_URLS, rendered `size` px wide (first walk frame); if a set is missing, that kind
// falls back to the deer frames, scaled and tinted. `walk` plays while walking, `idle` (graze)
// while standing, and the faster `run` (deer: optional deerRun) while fleeing or charging.
const DEER_WALK_URLS = frameUrls("deerWalk", 4);
const DEER_GRAZE_URLS = frameUrls("deerGraze", 2);
const WILDLIFE_ART: Record<WildlifeKind, { size: number; tint: number }> = {
  deer: { size: 26, tint: 0xffffff },
  rabbit: { size: 12, tint: 0xd8c4a8 },
  boar: { size: 24, tint: 0x6e4c38 },
  pheasant: { size: 11, tint: 0xd07a3c },
};
const WILDLIFE_OPTIONAL_URLS: Record<WildlifeKind, { walk: string[]; idle: string[]; run: string[] }> = {
  deer: { walk: [], idle: [], run: frameUrls("deerRun", 4) },
  rabbit: { walk: frameUrls("rabbitWalk", 4), idle: frameUrls("rabbitIdle", 2), run: [] },
  boar: { walk: frameUrls("boarWalk", 4), idle: frameUrls("boarGraze", 2), run: [] },
  pheasant: { walk: frameUrls("pheasantWalk", 4), idle: [], run: frameUrls("pheasantFlap", 3) },
};
const WILDLIFE_FRAME_MS = 160;
const WILDLIFE_RUN_FRAME_MS = 90;
// Ground blood splatters (client-side, cosmetic). Variants 0/1/3 (small blob, medium splash, streak)
// mark melee hits; 2/4/5 (large splash, pool, faded pool) mark deaths. Rendered size is the longer
// side in px.
const BLOOD_URLS = frameUrls("bloodSplatter", 6);
const BLOOD_HIT_VARIANTS = [0, 1, 3];
const BLOOD_DEATH_VARIANTS = [2, 4, 5];
const BLOOD_HIT_SIZE = 12;
const BLOOD_DEATH_SIZE = 22;
// Only some melee hits leave a stain, so a long brawl doesn't carpet the ground in one spot.
const BLOOD_HIT_CHANCE = 0.35;
const BLOOD_ALPHA = 0.6;
// Oldest stain is removed past this many; they're all cleared at dawn like the gravestones.
const BLOOD_MAX = 80;
const FX_URLS = {
  slash: "/sprites/fx-slash.png",
  spark: "/sprites/fx-spark.png",
  poof: "/sprites/fx-poof.png",
  arrow: "/sprites/fx-arrow.png",
};
// Gameplay VFX sheet 2: 4-frame one-shots, each set on one shared canvas.
const FX_ANIM_URLS = {
  build: frameUrls("fx-build", 4),
  upgrade: frameUrls("fx-upgrade", 4),
  heal: frameUrls("fx-heal", 4),
  poison: frameUrls("fx-poison", 4),
  wardPulse: frameUrls("fx-wardPulse", 4),
  wardLapse: frameUrls("fx-wardLapse", 4),
};
// Wound decals over damaged units: [light, bleeding, heavy], small for colonists/most mobs, Large for
// the big mobs. Thresholds are hp fractions (below the first = light, ... below the last = heavy).
const WOUND_URLS = ["woundLight", "woundBleeding", "woundHeavy"].map((n) => `/sprites/${n}.png`);
const WOUND_LARGE_URLS = ["woundLightLarge", "woundBleedingLarge", "woundHeavyLarge"].map((n) => `/sprites/${n}.png`);
const WOUND_THRESHOLDS = [0.66, 0.4, 0.2];
// Rendered longer side (px): half a colonist's 28px height; mobs scale with their rendered size.
const COLONIST_WOUND_SIZE = 14;
const MOB_WOUND_SIZE_FACTOR = 0.55;
const WOUND_LARGE_KINDS = new Set<MobKind>(["orc", "armoredOrc", "troll", "ogre"]);
// Ground-like tile art that should cover its tile exactly (flush, no overhang into neighbors)
// instead of the bottom-anchored max-box fit buildings use, and always sit under other tile art.
const TILE_SPRITE_FILL_TILE = new Set<number>([TileType.Water, TileType.Road, TileType.CobbleRoad]);
// Road autotile, by the mask of orthogonal road neighbours (N=1, E=2, S=4, W=8; Road and Cobble Road
// connect to each other): [art, clockwise quarter turns]. The delivered road-* files don't all match
// their names (straightH, tJunctionB and some dead ends/corners are drawn with other connections), so
// only the pieces whose art matches are used, rotated for the rest. Measured connections: deadEndT = N,
// straightV = N+S, cornerTL = E+S, cornerTR = S+W, tJunctionR = E+S+W, tJunctionL = N+E+W, cross = all.
const ROAD_AUTOTILE: [string, number][] = [
  ["road-isolated", 0], // 0: none
  ["road-deadEndT", 0], // 1: N
  ["road-deadEndT", 1], // 2: E
  ["road-cornerTL", 3], // 3: N+E
  ["road-deadEndT", 2], // 4: S
  ["road-straightV", 0], // 5: N+S
  ["road-cornerTL", 0], // 6: E+S
  ["road-tJunctionR", 3], // 7: N+E+S
  ["road-deadEndT", 3], // 8: W
  ["road-cornerTL", 2], // 9: N+W
  ["road-straightV", 1], // 10: E+W
  ["road-tJunctionL", 0], // 11: N+E+W
  ["road-cornerTR", 0], // 12: S+W
  ["road-tJunctionR", 1], // 13: N+S+W
  ["road-tJunctionR", 0], // 14: E+S+W
  ["road-cross", 0], // 15: all
];
// Cobble Road: the vertical cobbleRoad strip for straight runs (rotated for E-W), the plaza fill otherwise.
const COBBLE_STRAIGHT = "cobbleRoad";
const COBBLE_FILL = "cobblePlaza";
const ROAD_ART_URLS = Array.from(new Set([...ROAD_AUTOTILE.map(([n]) => n), COBBLE_STRAIGHT, COBBLE_FILL])).map(
  (n) => `/sprites/${n}.png`
);
// Hunger-marked elites: sigil over the mob, pulsing aura ellipse on the ground under it, a tinted name
// label, and the mob drawn MARKED_MOB_SCALE larger. Indexed by HungerMark (0 = none).
const HUNGER_SIGIL_URLS = HUNGER_MARK_NAMES.map((n) => (n ? `/sprites/sigil-${n}.png` : ""));
const HUNGER_AURA_URLS = HUNGER_MARK_NAMES.map((n) => (n ? `/sprites/aura-${n}.png` : ""));
const HUNGER_LABEL_COLORS = [0xffffff, 0xff5a4a, 0x4fd8c0, 0xf0c050, 0xb080d0, 0xa8bccc, 0xe0d0b8];
const HUNGER_SIGIL_SIZE = 16;
const HUNGER_AURA_WIDTH = 40;
const MARKED_MOB_SCALE = 1.25;
// Render scale of a mob: Hunger-marked x1.25, Phase 5 bosses x BOSS_RENDER_SCALE (no new art: the
// ogre sprite drawn 1.6x is the Ogre Warlord). Both stack.
function mobRenderScale(m: MobSnapshot): number {
  return (m.mark ? MARKED_MOB_SCALE : 1) * (m.boss ? BOSS_RENDER_SCALE[m.boss] : 1);
}
// Boss name labels and hp bars (the bar is the usual one, drawn this much bigger).
const BOSS_LABEL_COLORS = { warlord: 0xf1c40f, elite: 0xf0a050 };
const BOSS_HP_BAR_SCALE = { warlord: 2, elite: 1.5 };
// Battered armor: below this hp fraction, an idle (not walking/attacking) pikeman or armoured orc
// shows its static battered pose. The knight's walk/attack set is drawn in a much chunkier style
// than knightBattered.png, so swapping in that pose looked like a different unit; knights are
// tinted darker instead (BATTERED_TINT), as are the pose kinds whenever the battered art is missing.
const BATTERED_HP_FRACTION = 0.5;
const BATTERED_TINT = 0x9a948c;
const BATTERED_POSE_URLS: Record<string, string> = {
  pikeman: "/sprites/pikemanBattered.png",
  armoredOrc: "/sprites/armoredOrcBattered.png",
};
const BATTERED_TINT_KINDS = new Set<string>(["knight", "pikeman", "armoredOrc"]);
// Extra scale on top of the max-box fit for small world-gen props, so a barrel or crate doesn't
// render the same size as a cottage. Unlisted tiles use 1 (unchanged).
const TILE_SPRITE_SIZE_FACTOR: Partial<Record<TileType, number>> = {
  [TileType.RuinStatue]: 0.7,
  [TileType.RuinRubble]: 0.75,
  [TileType.PropCampfire]: 0.8,
  [TileType.PropBarrel]: 0.6,
  [TileType.PropCrate]: 0.65,
  [TileType.PropFence]: 0.85,
  // The wide abbey art is width-capped by the box fit; 2x makes it ~2.8 tiles wide (it sits between
  // lantern posts two tiles either side), roughly twice a player-built Church's footprint.
  [TileType.AbbeyHall]: 2,
  [TileType.PropCross]: 0.6,
  [TileType.PropLanternPost]: 0.65,
  [TileType.WardStone]: 0.75,
  [TileType.BerryBush]: 0.55,
  [TileType.BerryBushPicked]: 0.5,
  [TileType.MushroomPatch]: 0.45,
  [TileType.MushroomPatchPicked]: 0.45,
};
// Tile sprites fit a box this many tiles wide/tall (aspect preserved), bottom-center anchored
// on the tile's bottom edge so tall art (towers, castles, trees) rises into the row above.
const TILE_SPRITE_MAX_WIDTH_TILES = 1.4;
const TILE_SPRITE_MAX_HEIGHT_TILES = 2;
// The Town Center art is a whole plaza-with-buildings scene on its own ground patch, so it skips the
// box fit: a fixed 3.5-tile width (~2.25 tiles tall) reads as the colony's centerpiece, and the
// anchor is the patch's center (its isometric diamond's midpoint), pinned on the tile's center.
const TOWN_CENTER_WIDTH_TILES = 3.5;
const TOWN_CENTER_ANCHOR = { x: 0.51, y: 0.67 };

interface EntityVisual {
  sprite: Container;
  hpBar: Graphics;
  // "This is me" ground ring, only present on the local player's entry.
  marker?: Graphics;
  // Wound decal, created the first time the unit is seen damaged (see updateWound).
  wound?: Sprite;
  // Hunger-marked mobs only (see updateMarkVisuals).
  aura?: Sprite;
  sigil?: Sprite;
  markLabel?: Text;
  // Phase 5 bosses only (see updateBossVisuals).
  bossLabel?: Text;
}

const COLONIST_KINDS: ColonistKind[] = [
  "lumberjack",
  "farmer",
  "knight",
  "archer",
  "ironMiner",
  "rockMiner",
  "bishop",
  "farmhand",
  "artisan",
  "militia",
  "spearman",
  "pikeman",
  "hunter",
  "forager",
  "builder",
];
// Rendered heights (px); width follows each texture's aspect ratio.
const COLONIST_SPRITE_HEIGHT = 28;
// Mounted knight on a horse, plus banner — should read as clearly bigger than a foot soldier,
// not just a little taller. 64 keeps the rider's own body close to colonist scale while the
// horse (and banner) make the whole thing noticeably larger, same uniform-scale texture either way.
// 68 for the animated set: its walk frames carry a taller banner than player.png did, and 68 keeps
// the horse and rider at the old on-screen size (~40px wide).
const PLAYER_SPRITE_HEIGHT = 68;

// Cosmetic nature scatter on Plains floor tiles: roughly 1 in NATURE_DECOR_ONE_IN eligible tiles
// gets one of these, chosen by a stable hash of the tile position (no server involvement).
const NATURE_DECOR_ONE_IN = 16;
const NATURE_DECOR: { url: string; height: number }[] = [
  { url: "/sprites/tallGrass.png", height: 16 },
  { url: "/sprites/flowers1.png", height: 12 },
  { url: "/sprites/bush3.png", height: 18 },
];

// Stable pseudo-random in [0, 1) from tile coordinates (+ salt for independent rolls).
function tileHash01(tx: number, ty: number, salt: number): number {
  let h = Math.imul(tx, 374761393) ^ Math.imul(ty, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Recolors the blue banner/barding of the player sprite to uTargetHue (0..1), keeping the
// source saturation/value so shading survives. Low-saturation pixels (armor, horse) are untouched.
// Written in PixiJS v8's filter GLSL convention (same as ColorMatrixFilter): no #version,
// `in`/`out vec4 finalColor`/`texture()`; GlProgram adds the version/WebGL1 shims itself.
const PLAYER_RECOLOR_FRAG = `in vec2 vTextureCoord;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTargetHue;

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main()
{
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a > 0.0001) {
        vec3 unmult = color.rgb / color.a;
        vec3 hsv = rgb2hsv(unmult);
        float hueDeg = hsv.x * 360.0;
        float refHue = 221.7;
        float hueDist = min(abs(hueDeg - refHue), 360.0 - abs(hueDeg - refHue));
        float satGate = smoothstep(0.15, 0.3, hsv.y);
        // == smoothstep(30.0, 15.0, hueDist); GLSL leaves reversed edges undefined.
        float hueGate = 1.0 - smoothstep(15.0, 30.0, hueDist);
        float mixAmt = satGate * hueGate;
        vec3 recolored = hsv2rgb(vec3(uTargetHue, hsv.y, hsv.z));
        vec3 finalRgb = mix(unmult, recolored, mixAmt);
        color.rgb = finalRgb * color.a;
    }
    finalColor = color;
}
`;

// HSV hue of a 0xRRGGBB color, normalized to 0..1.
function hexToHue(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

// ---- Sound triggers (falloff, voice cap, cooldowns and per-key loudness live in sound.ts) ----
const sound = new SoundManager();
// While a worker stays in its work state it repeats its sound once per work cycle (server
// CHOP_TICKS = 2 s, CRAFT_TICKS = 4 s), each colonist on its own random phase.
const WORK_SOUND_INTERVAL_MS: Record<string, number> = {
  tree_chop: 2000,
  mine_pick: 2000,
  farm_work: 2000,
  craft_hammer: 4000,
  heal_chime: 2400,
};
// Non-blacksmith artisans hammer quieter.
const CRAFT_VOLUME_NON_SMITH = 0.6;
// A mob growls (maybe) the first time it comes this close to the local player.
const MOB_GROWL_RADIUS_TILES = 10;
const MOB_GROWL_CHANCE = 0.5;
// Horse: gallop loop while the local player moves faster than this (px/s); its playbackRate follows
// speed / PLAYER_SPEED within these bounds. Jumps faster than HORSE_TELEPORT_SPEED are respawns.
const HORSE_MOVING_MIN_SPEED = 20;
const HORSE_RATE_MIN = 0.75;
const HORSE_RATE_MAX = 1.15;
const HORSE_TELEPORT_SPEED = PLAYER_SPEED * 3;
// Setting off after standing this long may get a whinny.
const HORSE_WHINNY_IDLE_MS = 10000;
const HORSE_WHINNY_CHANCE = 0.3;
// Ambient loops (water, campfires): nearest such tile within the silent radius, rescanned this often.
const AMBIENT_SCAN_MS = 500;
const AMBIENT_TILE_LOOPS: { tile: TileType; key: string; id: string }[] = [
  { tile: TileType.Water, key: "water_ambient", id: "ambient-water" },
  { tile: TileType.PropCampfire, key: "fire_crackle", id: "ambient-fire" },
];
// Dawn: chime, then the church bell this many seconds later.
const DAWN_BELL_DELAY_S = 1.2;
// A local placement counts as confirmed if its tileUpdate arrives within this window.
const PLACEMENT_CONFIRM_MS = 2000;

function workSoundKey(c: ColonistSnapshot): string | null {
  switch (c.state) {
    case "gathering":
      if (c.kind === "lumberjack") return "tree_chop";
      if (c.kind === "farmer") return "farm_work";
      if (c.kind === "ironMiner" || c.kind === "rockMiner") return "mine_pick";
      return null;
    case "mining":
      return "mine_pick";
    case "farming":
    case "foraging":
      return "farm_work";
    case "crafting":
    case "building":
    case "repairing":
      return "craft_hammer";
    case "healing":
      return c.kind === "bishop" ? "heal_chime" : null;
    default:
      return null;
  }
}

async function main() {
  const app = new Application();
  await app.init({ background: "#1a1a1a", resizeTo: window });
  document.getElementById("app")!.appendChild(app.canvas);

  const colonistUrls = COLONIST_KINDS.map((kind) => COLONIST_STATIC_URL_OVERRIDES[kind] ?? `/sprites/${kind}.png`);
  const mobUrls = MOB_KINDS.map((kind) => MOB_SPRITE_URL_OVERRIDES[kind] ?? `/sprites/${kind}.png`);
  const tileSpriteEntries = Object.entries(TILE_SPRITE_FILES).map(
    ([tile, file]) => [Number(tile), `/sprites/${file}.png`] as const
  );
  // Extra variants not tied 1:1 to a TileType: extra Iron Ore looks and two grass-floor
  // textures, picked per-tile-position for visual variety instead of one fixed art per type.
  const EXTRA_URLS = [
    "/sprites/ironOre2.png",
    "/sprites/ironOre3.png",
    "/sprites/gateWoodOpen.png",
    "/sprites/grassFloor1.png",
    "/sprites/grassFloor2.png",
    "/sprites/hillsFloor.png",
    "/sprites/swampFloor.png",
    ...NATURE_DECOR.map((d) => d.url),
    ...GRAVESTONE_URLS,
    ...BLOOD_URLS,
    ...DEER_WALK_URLS,
    ...DEER_GRAZE_URLS,
    ...WILDLIFE.crow.frames,
    ...WILDLIFE.frog.frames,
    ...Object.values(FX_URLS),
    ...Object.values(FX_ANIM_URLS).flat(),
    ...WOUND_URLS,
    ...WOUND_LARGE_URLS,
    ...Object.values(TILE_ANIM).flatMap((a) => a!.urls),
    ...ROAD_ART_URLS,
    ...HUNGER_SIGIL_URLS.filter(Boolean),
    ...HUNGER_AURA_URLS.filter(Boolean),
    ...Object.values(BATTERED_POSE_URLS),
  ];
  const ANIM_URLS = [
    ...Object.values(COLONIST_ANIM_URLS).flatMap((a) => [...a.walk, ...a.action]),
    ...PLAYER_ANIM_URLS.walk,
    ...PLAYER_ANIM_URLS.action,
    ...Object.values(MOB_VARIANT_URLS).flatMap((variants) =>
      variants.flatMap((v) => [...(v.idle ? [v.idle] : []), ...(v.walk ?? []), ...(v.action ?? [])])
    ),
  ];
  // Art that may not exist yet (stand-ins cover it). Loaded one by one so a missing file can't fail
  // the main load below, which throws on any missing URL.
  async function loadOptionalTextures(urls: string[]): Promise<Record<string, Texture>> {
    const out: Record<string, Texture> = {};
    await Promise.all(
      urls.map(async (url) => {
        try {
          const texture = await Assets.load<Texture>(url);
          if (texture) {
            texture.source.scaleMode = "nearest";
            out[url] = texture;
          }
        } catch {
          // Not delivered yet: keep the stand-in.
        }
      })
    );
    return out;
  }
  const optionalTexturesPromise = loadOptionalTextures([
    ...Object.values(COLONIST_OPTIONAL_ANIM_URLS).flatMap((a) => [...a!.walk, ...a!.action, ...a!.carry]),
    ...[...Object.values(TILE_OPTIONAL_ART), ...Object.values(TILE_OPTIONAL_ALT_ART)].map((name) => `/sprites/${name}.png`),
    ...Object.values(FARM_STAGE_ART).flatMap((stages) => Object.values(stages!).map(artUrl)),
    ...Object.values(TILE_LEVEL_ART).flatMap((names) => names!.map(artUrl)),
    TOWN_CENTER_MARKER_URL,
    DEER_FALLEN_URL,
    ...Object.values(WILDLIFE_OPTIONAL_URLS).flatMap((a) => [...a.walk, ...a.idle, ...a.run]),
  ]);
  // De-duplicated: some images appear in more than one list (e.g. a frame reused across cycles),
  // and each URL should be requested once and resolve to one shared Texture.
  const loadedTextures = await Assets.load<Texture>(
    Array.from(
      new Set([
        ...colonistUrls,
        "/sprites/player.png",
        ...mobUrls,
        ...tileSpriteEntries.map(([, url]) => url),
        ...EXTRA_URLS,
        ...ANIM_URLS,
      ])
    )
  );
  for (const texture of Object.values(loadedTextures)) texture.source.scaleMode = "nearest";
  const optionalTextures = await optionalTexturesPromise;
  const COLONIST_TEXTURES = Object.fromEntries(
    COLONIST_KINDS.map((kind, i) => [kind, loadedTextures[colonistUrls[i]]])
  ) as Record<ColonistKind, Texture>;
  const PLAYER_TEXTURE = loadedTextures["/sprites/player.png"];
  const MOB_TEXTURES = Object.fromEntries(
    MOB_KINDS.map((kind, i) => [kind, loadedTextures[mobUrls[i]]])
  ) as Partial<Record<MobKind, Texture>>;
  // Keyed by TileType value; only types with sourced art have an entry.
  const TILE_TEXTURES = new Map<number, Texture>(
    tileSpriteEntries.map(([tile, url]) => [tile, loadedTextures[url]])
  );
  const TILE_TINT = new Map<number, number>(Object.entries(TILE_STANDIN_TINT).map(([tile, tint]) => [Number(tile), tint!]));
  for (const [tile, name] of Object.entries(TILE_OPTIONAL_ART)) {
    const texture = optionalTextures[`/sprites/${name}.png`];
    if (!texture) continue;
    TILE_TEXTURES.set(Number(tile), texture);
    TILE_TINT.delete(Number(tile));
  }
  // Only used where the tile's own optional art loaded too (an alt next to a tinted stand-in would clash).
  const TILE_ALT_TEXTURES = new Map<number, Texture>();
  for (const [tile, name] of Object.entries(TILE_OPTIONAL_ALT_ART)) {
    const texture = optionalTextures[`/sprites/${name}.png`];
    if (texture && !TILE_TINT.has(Number(tile))) TILE_ALT_TEXTURES.set(Number(tile), texture);
  }
  // Building tiers were generated as separate images and don't necessarily share proportions —
  // a busier/larger-canvas upgrade art can end up box-fit SMALLER than the tier before it, which
  // reads as the building shrinking when it upgrades. Force each tier's rendered height to be at
  // least as tall as the previous tier's (exceeding the normal max-box cap if it has to), so
  // upgrades only ever look the same size or bigger, never smaller.
  const TILE_TIER_FAMILIES: TileType[][] = [
    [TileType.House, TileType.BigHouse, TileType.HouseLevel2],
    [TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3],
    [TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3],
  ];
  const TILE_MIN_RENDER_HEIGHT = new Map<number, number>();
  for (const family of TILE_TIER_FAMILIES) {
    let runningMinHeight = 0;
    for (const tile of family) {
      const texture = TILE_TEXTURES.get(tile);
      if (!texture) continue;
      // tileSize isn't assigned yet this early in setup (it's only ever 32 regardless, set from
      // the same default `let tileSize = 32` declared below), so use the literal here.
      const naturalScale = Math.min(
        (32 * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width,
        (32 * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height
      );
      const renderHeight = Math.max(naturalScale * texture.height, runningMinHeight);
      TILE_MIN_RENDER_HEIGHT.set(tile, renderHeight);
      runningMinHeight = renderHeight;
    }
  }
  const IRON_ORE_VARIANTS = [
    TILE_TEXTURES.get(TileType.IronOre)!,
    loadedTextures["/sprites/ironOre2.png"],
    loadedTextures["/sprites/ironOre3.png"],
  ];
  const GRASS_FLOOR_VARIANTS = [
    loadedTextures["/sprites/grassFloor1.png"],
    loadedTextures["/sprites/grassFloor2.png"],
  ];
  const HILLS_FLOOR_TEXTURE = loadedTextures["/sprites/hillsFloor.png"];
  const GATE_OPEN_TEXTURE = loadedTextures["/sprites/gateWoodOpen.png"];
  const SWAMP_FLOOR_TEXTURE = loadedTextures["/sprites/swampFloor.png"];
  const NATURE_DECOR_TEXTURES = NATURE_DECOR.map((d) => ({ texture: loadedTextures[d.url], height: d.height }));
  // tile -> FarmStage -> texture, only for stage art that loaded.
  const FARM_STAGE_TEXTURES = new Map<number, Map<number, Texture>>();
  for (const [tile, stages] of Object.entries(FARM_STAGE_ART)) {
    const byStage = new Map<number, Texture>();
    for (const [stage, name] of Object.entries(stages!)) {
      const texture = optionalTextures[artUrl(name!)];
      if (texture) byStage.set(Number(stage), texture);
    }
    FARM_STAGE_TEXTURES.set(Number(tile), byStage);
  }
  // tile -> [lv1, lv2, lv3] tier textures (undefined where the file is missing).
  const TILE_LEVEL_TEXTURES = new Map<number, (Texture | undefined)[]>(
    Object.entries(TILE_LEVEL_ART).map(([tile, names]) => [Number(tile), names!.map((n) => optionalTextures[artUrl(n)])])
  );
  // Same "never shrink on upgrade" rule as TILE_TIER_FAMILIES, per level of a leveled building.
  const TILE_LEVEL_MIN_HEIGHT = new Map<string, number>();
  for (const [tile, textures] of TILE_LEVEL_TEXTURES) {
    if (tile === TileType.TownCenter) continue;
    let runningMinHeight = 0;
    textures.forEach((texture, i) => {
      if (!texture) return;
      const naturalScale = Math.min((32 * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width, (32 * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height);
      runningMinHeight = Math.max(naturalScale * texture.height, runningMinHeight);
      TILE_LEVEL_MIN_HEIGHT.set(`${tile}:${i + 1}`, runningMinHeight);
    });
  }
  const TOWN_CENTER_MARKER_TEXTURE = optionalTextures[TOWN_CENTER_MARKER_URL];
  const DEER_FALLEN_TEXTURE = optionalTextures[DEER_FALLEN_URL];
  const TILE_ANIM_TEXTURES = new Map<number, { frames: Texture[]; frameMs: number; phased: boolean }>(
    Object.entries(TILE_ANIM).map(([tile, a]) => [
      Number(tile),
      { frames: a!.urls.map((u) => loadedTextures[u]), frameMs: a!.frameMs, phased: a!.phased },
    ])
  );
  const FIRE_FRAMES = TILE_ANIM_TEXTURES.get(TileType.PropCampfire)!.frames;
  const FIRE_FRAME_MS = TILE_ANIM_TEXTURES.get(TileType.PropCampfire)!.frameMs;
  const GRAVESTONE_TEXTURES = GRAVESTONE_URLS.map((url) => loadedTextures[url]);
  const BLOOD_TEXTURES = BLOOD_URLS.map((url) => loadedTextures[url]);
  const FX_TEXTURES = {
    slash: loadedTextures[FX_URLS.slash],
    spark: loadedTextures[FX_URLS.spark],
    poof: loadedTextures[FX_URLS.poof],
    arrow: loadedTextures[FX_URLS.arrow],
  };
  const FX_ANIM_TEXTURES = Object.fromEntries(
    Object.entries(FX_ANIM_URLS).map(([k, urls]) => [k, urls.map((u) => loadedTextures[u])])
  ) as Record<keyof typeof FX_ANIM_URLS, Texture[]>;
  const WOUND_TEXTURES = WOUND_URLS.map((u) => loadedTextures[u]);
  const WOUND_LARGE_TEXTURES = WOUND_LARGE_URLS.map((u) => loadedTextures[u]);
  const roadTexture = (name: string) => loadedTextures[`/sprites/${name}.png`];
  const HUNGER_SIGIL_TEXTURES = HUNGER_SIGIL_URLS.map((u) => (u ? loadedTextures[u] : undefined));
  const HUNGER_AURA_TEXTURES = HUNGER_AURA_URLS.map((u) => (u ? loadedTextures[u] : undefined));
  const BATTERED_POSE_TEXTURES = new Map<string, Texture>(
    Object.entries(BATTERED_POSE_URLS).flatMap(([kind, url]) => (loadedTextures[url] ? [[kind, loadedTextures[url]] as const] : []))
  );
  // Frames within one set come from one source sheet, so they share a pixel scale: one constant
  // `scale` per set (sized from the first walk frame) keeps the body the same size while weapons
  // swing out, instead of re-fitting every frame's canvas to a fixed height.
  interface AnimSet {
    walk: Texture[];
    action: Texture[];
    // Optional carry-home walk (hunter/forager); falls back to `walk`.
    carry?: Texture[];
    scale: number;
    refHeight: number;
  }
  // `renderSize` is the first walk frame's rendered height, or its longer side with `fitLongerSide`.
  function buildAnimSet(
    urls: { walk: string[]; action: string[] },
    renderSize: number,
    fitLongerSide = false
  ): AnimSet {
    const walk = urls.walk.map((u) => loadedTextures[u]);
    const refHeight = walk[0].height;
    const refSize = fitLongerSide ? Math.max(walk[0].width, refHeight) : refHeight;
    return { walk, action: urls.action.map((u) => loadedTextures[u]), scale: renderSize / refSize, refHeight };
  }
  // Feet sit on each frame's bottom edge; pin them to where the first walk frame's feet land when
  // that frame is center-anchored, so switching between rows of different heights doesn't hop.
  function showAnimFrame(sprite: Sprite, set: AnimSet, texture: Texture) {
    sprite.texture = texture;
    sprite.scale.set(set.scale);
    sprite.anchor.set(0.5, 1 - set.refHeight / (2 * texture.height));
  }
  // All art is drawn facing right; flip horizontally (negate scale.x, since every sprite is
  // center-anchored) when net horizontal movement is leftward. Tracked per entity id in one of
  // three category maps (colonist/mob/player ids aren't guaranteed disjoint, so a single shared
  // map risks one category's prune deleting another's live entry), independent of any animation
  // state so it applies equally to animated and single-pose sprites. A small dead zone (the same
  // >0.5px threshold used for walk-vs-idle elsewhere) avoids flicker from sub-pixel jitter while
  // genuinely stationary; moving purely vertically keeps the last facing instead of snapping back
  // to a default.
  type FacingMap = Map<string, { lastX: number; facingRight: boolean }>;
  const colonistFacing: FacingMap = new Map();
  const mobFacing: FacingMap = new Map();
  const playerFacing: FacingMap = new Map();
  function getFacing(map: FacingMap, id: string, x: number): boolean {
    const prev = map.get(id);
    if (!prev) {
      map.set(id, { lastX: x, facingRight: true });
      return true;
    }
    const dx = x - prev.lastX;
    prev.lastX = x;
    if (Math.abs(dx) > 0.5) prev.facingRight = dx > 0;
    return prev.facingRight;
  }
  function applyFacing(sprite: Sprite, facingRight: boolean) {
    sprite.scale.x = Math.abs(sprite.scale.x) * (facingRight ? 1 : -1);
  }
  function pruneFacing(map: FacingMap, seenIds: Set<string>) {
    for (const id of Array.from(map.keys())) {
      if (!seenIds.has(id)) map.delete(id);
    }
  }
  const COLONIST_ANIMS = Object.fromEntries(
    Object.entries(COLONIST_ANIM_URLS).map(([kind, urls]) => [kind, buildAnimSet(urls, COLONIST_SPRITE_HEIGHT)])
  ) as Record<ColonistKind, AnimSet>;
  // Tint per kind while it still renders a stand-in set (cleared below when its own art loaded).
  const COLONIST_TINT = new Map<string, number>(Object.entries(COLONIST_STANDIN_TINT).map(([k, t]) => [k, t!]));
  for (const [kind, urls] of Object.entries(COLONIST_OPTIONAL_ANIM_URLS)) {
    if (![...urls!.walk, ...urls!.action].every((u) => optionalTextures[u])) continue;
    const walk = urls!.walk.map((u) => optionalTextures[u]);
    const action = urls!.action.map((u) => optionalTextures[u]);
    const carry = urls!.carry.every((u) => optionalTextures[u]) ? urls!.carry.map((u) => optionalTextures[u]) : undefined;
    COLONIST_ANIMS[kind as ColonistKind] = {
      walk,
      action,
      carry,
      scale: COLONIST_SPRITE_HEIGHT / walk[0].height,
      refHeight: walk[0].height,
    };
    COLONIST_TINT.delete(kind);
  }
  // Militia/Spearman/Pikeman were generated together on one shared sheet at one consistent body
  // scale, but Spearman/Pikeman's raised polearm pushes their own walk canvas well past their
  // actual body height (Pikeman's canvas is 254px tall - genuine pike art, not padding - versus
  // ~180px for Militia, who holds nothing overhead). Deriving `scale` from each kind's own canvas
  // height (buildAnimSet's normal behavior) under-scales those two kinds' bodies badly. Reuse
  // Militia's canvas height - the only un-inflated reference in the trio - for all three, so their
  // bodies render at a consistent size and the polearms are free to extend further above that
  // without shrinking the character holding them. `refHeight` (used for the feet-anchor math
  // across rows) is left untouched; only `scale` changes.
  const militiaRefHeight = COLONIST_ANIMS.militia.refHeight;
  for (const kind of ["militia", "spearman", "pikeman"] as ColonistKind[]) {
    COLONIST_ANIMS[kind].scale = COLONIST_SPRITE_HEIGHT / militiaRefHeight;
  }
  interface MobVariant {
    idle: Texture;
    idleScale: number;
    anim: AnimSet | null;
  }
  const MOB_VARIANTS = Object.fromEntries(
    Object.entries(MOB_VARIANT_URLS).map(([kind, variants]) => {
      const size = MOB_VISUALS[kind as MobKind].radius * MOB_SPRITE_SIZE_PER_RADIUS;
      return [
        kind,
        variants.map((v): MobVariant => {
          const anim =
            v.walk && v.action
              ? buildAnimSet({ walk: v.walk, action: v.action }, size, MOB_ANIM_FIT_LONGER_SIDE.has(kind as MobKind))
              : null;
          const idle = v.idle ? loadedTextures[v.idle] : anim!.walk[0];
          const idleScale = v.idle ? size / Math.max(idle.width, idle.height) : anim!.scale;
          return { idle, idleScale, anim };
        }),
      ];
    })
  ) as Partial<Record<MobKind, MobVariant[]>>;
  // Ticks (snapshots, ~20/s) each animation frame holds before advancing.
  const ANIM_TICKS_PER_FRAME = 4;
  type AnimMode = "walk" | "action" | "carry" | null;
  interface AnimState {
    mode: AnimMode;
    frame: number;
    ticksInFrame: number;
    lastX: number;
    lastY: number;
  }
  // Advances `anim` one snapshot tick; returns the frame to show, or null for the static pose.
  function stepAnim(anim: AnimState, set: AnimSet, mode: AnimMode): Texture | null {
    if (mode !== anim.mode) {
      anim.mode = mode;
      anim.frame = 0;
      anim.ticksInFrame = 0;
    }
    if (!mode) return null;
    const sequence = mode === "walk" ? set.walk : mode === "carry" ? (set.carry ?? set.walk) : set.action;
    anim.ticksInFrame++;
    if (anim.ticksInFrame >= ANIM_TICKS_PER_FRAME) {
      anim.ticksInFrame = 0;
      anim.frame = (anim.frame + 1) % sequence.length;
    }
    return sequence[anim.frame];
  }
  const colonistAnim = new Map<string, AnimState>();
  const mobAnim = new Map<string, AnimState>();
  // Null (static player.png fallback) if any player frame failed to load.
  const PLAYER_ANIM: AnimSet | null = [...PLAYER_ANIM_URLS.walk, ...PLAYER_ANIM_URLS.action].every(
    (u) => loadedTextures[u]
  )
    ? buildAnimSet(PLAYER_ANIM_URLS, PLAYER_SPRITE_HEIGHT)
    : null;
  // The lance thrust plays once per attack (each frame held ANIM_TICKS_PER_FRAME snapshots).
  const PLAYER_ATTACK_ANIM_TICKS = PLAYER_ANIM_URLS.action.length * ANIM_TICKS_PER_FRAME;
  const playerAnim = new Map<string, AnimState & { attackTicks: number }>();
  function triggerPlayerAttackAnim(id: string) {
    const anim = playerAnim.get(id);
    // Local keypress and the server's hit effect both trigger it; don't restart a thrust that's
    // still on its first frame.
    if (!anim || anim.attackTicks > PLAYER_ATTACK_ANIM_TICKS - ANIM_TICKS_PER_FRAME) return;
    anim.attackTicks = PLAYER_ATTACK_ANIM_TICKS;
    anim.mode = null; // restart the thrust from frame 0 even mid-swing
  }
  // Shared (stateless) program; each player sprite gets its own Filter + uniforms.
  // highp: the HSV helpers' 1e-10 epsilon underflows to 0 at mediump on some GPUs -> NaN on greys.
  const playerRecolorProgram = GlProgram.from({
    vertex: defaultFilterVert,
    fragment: PLAYER_RECOLOR_FRAG,
    name: "player-recolor-filter",
    preferredFragmentPrecision: "highp",
  });

  const buildRequirementsEl = document.getElementById("build-requirements")!;
  const buildPanel = document.getElementById("build-panel")!;
  const buildPanelToggle = document.getElementById("build-panel-toggle")!;
  buildPanelToggle.addEventListener("click", () => {
    buildPanel.classList.toggle("collapsed");
    buildPanelToggle.classList.toggle("panel-open", !buildPanel.classList.contains("collapsed"));
    buildPanelToggle.blur();
  });

  const ZOOM = 1.3;
  const worldLayer = new Container();
  worldLayer.scale.set(ZOOM);
  app.stage.addChild(worldLayer);

  let myId: string | null = null;
  let tileSize = 32;
  let worldTilesX = 25;
  let worldTilesY = 25;
  // Every standing Town Center, from the latest snapshot (minimap markers, HP bars, game over).
  let latestTownCenters: TownCenterSnapshot[] = [];
  // This world's Castle Ruin centre (welcome); the minimap marks it once that tile is explored.
  let castleRuinTile: { x: number; y: number } | null = null;
  let tiles: number[] = [];
  // Biome per tile from `welcome`; static for the life of a world.
  let biomes: number[] = [];

  const playerSprites = new Map<string, EntityVisual>();
  const colonistSprites = new Map<string, EntityVisual>();
  const mobSprites = new Map<string, EntityVisual>();

  // Grass floor art, one Sprite per tile, alternating two textures for visual variety. Bottom of
  // the stack: everything else (Town Center, buildings, entities) draws over it.
  const floorSpriteLayer = new Container();
  worldLayer.addChild(floorSpriteLayer);
  const floorSprites: Sprite[] = [];

  // Cosmetic nature scatter (tall grass / flowers / bushes), keyed by tile index: over the floor,
  // under Town Center / buildings / entities. Hidden whenever its tile isn't Empty.
  const decorSpriteLayer = new Container();
  worldLayer.addChild(decorSpriteLayer);
  const decorSprites = new Map<number, Sprite>();
  // Also in decorSpriteLayer (over the floor, under buildings and every unit), keyed by position +
  // variant since the server sends no id.
  const gravestoneSprites = new Map<string, Sprite>();

  // Blood stains: in decorSpriteLayer's bottom slot (under nature scatter and gravestones), oldest
  // first. A death stain is stamped whenever a new gravestone appears (the server drops one for
  // every death), except for the stones already standing when we join.
  const bloodSprites: Sprite[] = [];
  let bloodOnNewGravestones = false;
  function stampBlood(x: number, y: number, variants: number[], size: number) {
    const texture = BLOOD_TEXTURES[variants[Math.floor(Math.random() * variants.length)]];
    if (!texture) return;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    const scale = size / Math.max(texture.width, texture.height);
    sprite.scale.set(Math.random() < 0.5 ? -scale : scale, scale);
    sprite.position.set(x + (Math.random() - 0.5) * 6, y + 6 + (Math.random() - 0.5) * 4);
    sprite.alpha = BLOOD_ALPHA;
    decorSpriteLayer.addChildAt(sprite, 0);
    bloodSprites.push(sprite);
    if (bloodSprites.length > BLOOD_MAX) bloodSprites.shift()!.destroy();
  }
  function clearBlood() {
    for (const sprite of bloodSprites) sprite.destroy();
    bloodSprites.length = 0;
  }

  function syncGravestones(snapshot: GravestoneSnapshot[]) {
    const seen = new Set<string>();
    for (const g of snapshot) {
      const key = `${g.x},${g.y},${g.variant}`;
      seen.add(key);
      if (gravestoneSprites.has(key)) continue;
      if (bloodOnNewGravestones) stampBlood(g.x, g.y, BLOOD_DEATH_VARIANTS, BLOOD_DEATH_SIZE);
      const texture = GRAVESTONE_TEXTURES[g.variant];
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(GRAVESTONE_HEIGHT / texture.height);
      sprite.position.set(g.x, g.y + GRAVESTONE_HEIGHT / 2);
      decorSpriteLayer.addChild(sprite);
      gravestoneSprites.set(key, sprite);
    }
    bloodOnNewGravestones = true;
    for (const [key, sprite] of Array.from(gravestoneSprites)) {
      if (seen.has(key)) continue;
      sprite.destroy();
      gravestoneSprites.delete(key);
    }
  }

  // Building/environment art (Town Center included), one Sprite per occupied tile (keyed by tile
  // index). Sits over the floor and under the night overlay and every entity layer.
  const tileSpriteLayer = new Container();
  tileSpriteLayer.sortableChildren = true;
  worldLayer.addChild(tileSpriteLayer);
  const tileSprites = new Map<number, Sprite>();
  // Tile index -> tile type, for slots currently showing a looping TILE_ANIM.
  const animatedTiles = new Map<number, number>();
  function tileAnimTexture(index: number, tile: number, now: number): Texture | undefined {
    const anim = TILE_ANIM_TEXTURES.get(tile);
    if (!anim) return undefined;
    const phase = anim.phased ? stableHash(String(index)) : 0;
    return anim.frames[(Math.floor(now / anim.frameMs) + phase) % anim.frames.length];
  }
  // A welcome (join or world restart) wipes every entity at once; that isn't a mass death.
  let suppressDeathPoofs = true;
  // Server art state per tile index, from the snapshot: farm stage (FarmStage), building level (>1
  // only), and construction sites. Each sync re-draws only the tiles whose value changed.
  let farmStages = new Map<number, number>();
  let buildingLevels = new Map<number, number>();
  interface SiteView {
    target: number;
    progress: number;
    upgrade: boolean;
    builders: number;
  }
  let constructionSites = new Map<number, SiteView>();
  // Damaged buildings (snapshot `damagedBuildings`): tile index -> HP permille. See syncDamagedBuildings.
  let damagedBuildings = new Map<number, number>();
  // Walls & gates: snapshot `gates`, tile index -> GATE_FLAG_* bits (see syncGates).
  let gateFlags = new Map<number, number>();
  // True from a welcome until its first snapshot has been applied: state diffs then are a world
  // load, not events, so they make no sound.
  let soundSuppressed = true;

  const indexToTile = (index: number) => ({ tx: index % worldTilesX, ty: Math.floor(index / worldTilesX) });

  function syncFarmStages(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + FARM_STAGE_SNAPSHOT_STRIDE <= flat.length; i += FARM_STAGE_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const changed = new Set<number>();
    for (const [i, stage] of farmStages) if (next.get(i) !== stage) changed.add(i);
    for (const [i, stage] of next) if (farmStages.get(i) !== stage) changed.add(i);
    const prev = farmStages;
    farmStages = next;
    for (const index of changed) {
      const tile = tiles[index];
      if (FARM_STAGE_ART[tile as TileType] === undefined) continue;
      // Ripe or harvested grain. Not on the first snapshot after a welcome (that's every ripe plot at once).
      const ripeChanged = (prev.get(index) === FarmStage.Ripe) !== (next.get(index) === FarmStage.Ripe);
      if (tile === TileType.FarmPlot && !soundSuppressed && ripeChanged) {
        const c = indexToTile(index);
        sound.play("farm_work", { x: c.tx * tileSize + tileSize / 2, y: c.ty * tileSize + tileSize / 2 });
      }
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tile);
    }
  }

  function syncBuildingLevels(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + BUILDING_LEVEL_SNAPSHOT_STRIDE <= flat.length; i += BUILDING_LEVEL_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const changed = new Set<number>();
    for (const [i, level] of buildingLevels) if (next.get(i) !== level) changed.add(i);
    for (const [i, level] of next) if (buildingLevels.get(i) !== level) changed.add(i);
    buildingLevels = next;
    for (const index of changed) {
      if (TILE_LEVEL_ART[tiles[index] as TileType] === undefined) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  // Scaffolding + progress bars over every site (and a small marker over buildings being upgraded).
  const siteOverlay = new Graphics();
  function syncConstructionSites(flat: number[]) {
    const next = new Map<number, SiteView>();
    for (let i = 0; i + CONSTRUCTION_SNAPSHOT_STRIDE <= flat.length; i += CONSTRUCTION_SNAPSHOT_STRIDE) {
      next.set(flat[i], { target: flat[i + 1], progress: flat[i + 2] / 1000, upgrade: flat[i + 3] === 1, builders: flat[i + 4] });
    }
    const prev = constructionSites;
    constructionSites = next;
    for (const [index, site] of next) {
      const old = prev.get(index);
      if (!old || old.target !== site.target) {
        const { tx, ty } = indexToTile(index);
        if (tiles[index] === TileType.ConstructionSite) setTileSprite(tx, ty, tiles[index]);
      }
    }
    for (const [index, site] of prev) {
      if (next.has(index) || !site.upgrade || soundSuppressed) continue;
      // An in-place upgrade finished (or was dropped): the upgrade sparkle, if the building still stands.
      if (tiles[index] === TileType.Empty) continue;
      const { tx, ty } = indexToTile(index);
      const c = tileCenter(tx, ty);
      spawnFxAnim("upgrade", c.x, c.y + tileSize / 2, 700);
    }
    siteOverlay.clear();
    for (const [index, site] of next) {
      const { tx, ty } = indexToTile(index);
      const x = tx * tileSize;
      const y = ty * tileSize;
      if (!site.upgrade) {
        // Scaffold: two poles and cross braces over the faded building.
        const top = y - tileSize * 0.6;
        siteOverlay
          .moveTo(x + 4, y + tileSize - 2).lineTo(x + 4, top)
          .moveTo(x + tileSize - 4, y + tileSize - 2).lineTo(x + tileSize - 4, top)
          .moveTo(x + 4, top + 6).lineTo(x + tileSize - 4, top + 6)
          .moveTo(x + 4, y + tileSize * 0.45).lineTo(x + tileSize - 4, y + tileSize * 0.45)
          .moveTo(x + 4, top + 6).lineTo(x + tileSize - 4, y + tileSize * 0.45)
          .stroke({ width: 2, color: 0x6b4423, alpha: 0.9 });
      } else {
        // "Upgrading" marker: a small up-arrow badge.
        const cx = x + tileSize - 6;
        const cy = y - 4;
        siteOverlay.circle(cx, cy, 6).fill({ color: 0x2b1a0c, alpha: 0.85 });
        siteOverlay.poly([cx, cy - 4, cx + 4, cy + 1, cx + 1.5, cy + 1, cx + 1.5, cy + 4, cx - 1.5, cy + 4, cx - 1.5, cy + 1, cx - 4, cy + 1]).fill(0xf1c40f);
      }
      const barY = y + tileSize + 2;
      siteOverlay.rect(x + 2, barY, tileSize - 4, 4).fill({ color: 0x2b1a0c, alpha: 0.8 });
      siteOverlay.rect(x + 2, barY, (tileSize - 4) * site.progress, 4).fill(site.upgrade ? 0xf1c40f : 0xe0b468);
    }
  }

  // Walls & gates: redraw a gate whose open / overrun look changed.
  function syncGates(flat: number[] | undefined) {
    const next = new Map<number, number>();
    const list = flat ?? [];
    for (let i = 0; i + GATE_SNAPSHOT_STRIDE <= list.length; i += GATE_SNAPSHOT_STRIDE) next.set(list[i], list[i + 1]);
    const shown = (f: number | undefined) => ((f ?? 0) & (GATE_FLAG_OPEN | GATE_FLAG_OVERRUN)) !== 0;
    const prev = gateFlags;
    gateFlags = next;
    for (const index of new Set([...prev.keys(), ...next.keys()])) {
      if (shown(prev.get(index)) === shown(next.get(index)) || tiles[index] !== TileType.Gate) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  // ---- Damaged buildings: flames, soot and an HP bar ----
  // Fire tier by HP permille: 1 below 75% (small flames + soot), 2 below 50% (medium flames + smoke
  // puffs), 3 below 25% (large flames). Overlays are pooled (one flame sprite + one HP bar per damaged
  // building, at most MAX_FIRE_OVERLAYS) and animated by the shared tile clock below.
  function fireTier(permille: number): number {
    return permille < 250 ? 3 : permille < 500 ? 2 : permille < 750 ? 1 : 0;
  }
  interface FireOverlay {
    flame: Sprite;
    bar: Graphics;
    tier: number;
    phase: number;
    nextSmokeAt: number;
  }
  const fireOverlays = new Map<number, FireOverlay>();
  const firePool: FireOverlay[] = [];
  function releaseFire(index: number, o: FireOverlay, restoreArt: boolean) {
    o.flame.visible = false;
    o.bar.visible = false;
    fireOverlays.delete(index);
    firePool.push(o);
    if (restoreArt && index < tiles.length) {
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }
  function syncDamagedBuildings(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + DAMAGED_BUILDING_SNAPSHOT_STRIDE <= flat.length; i += DAMAGED_BUILDING_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const prev = damagedBuildings;
    damagedBuildings = next;
    for (const [index, o] of fireOverlays) if (!next.has(index)) releaseFire(index, o, true);
    for (const [index, permille] of next) {
      let o = fireOverlays.get(index);
      if (o && prev.get(index) === permille) continue;
      if (!o) {
        if (fireOverlays.size >= MAX_FIRE_OVERLAYS) continue;
        o = firePool.pop();
        if (!o) {
          const flame = new Sprite(FIRE_FRAMES[0]);
          flame.anchor.set(0.5, 1);
          tileSpriteLayer.addChild(flame);
          const bar = new Graphics();
          worldLayer.addChild(bar);
          o = { flame, bar, tier: -1, phase: 0, nextSmokeAt: 0 };
        }
        o.tier = -1;
        o.phase = index % FIRE_FRAMES.length;
        fireOverlays.set(index, o);
      }
      const { tx, ty } = indexToTile(index);
      const tier = fireTier(permille);
      if (tier !== o.tier) {
        o.tier = tier;
        o.flame.visible = tier > 0;
        o.flame.scale.set(FIRE_FLAME_WIDTH[tier] / FIRE_FRAMES[0].width);
        o.flame.position.set(tx * tileSize + tileSize / 2, (ty + 1) * tileSize - tileSize * 0.3);
        o.flame.zIndex = index + 0.5;
        // Soot tint on (or off) the building art.
        setTileSprite(tx, ty, tiles[index]);
      }
      // Town Centers keep their own always-on bar (syncTownCenterBars).
      o.bar.visible = tiles[index] !== TileType.TownCenter;
      o.bar.position.set(tx * tileSize + tileSize / 2, ty * tileSize - 8);
      drawHpBar(o.bar, permille, 1000);
    }
  }
  // Welcome: drop every overlay (the world's tile art is redrawn from scratch anyway).
  function clearFires() {
    for (const [index, o] of fireOverlays) releaseFire(index, o, false);
    damagedBuildings = new Map();
  }

  const nightOverlay = new Graphics();
  nightOverlay.alpha = 0;
  worldLayer.addChild(nightOverlay);

  // One HP bar per standing Town Center, keyed by tile index, just above its art.
  const townCenterHpBars = new Map<number, Graphics>();
  function syncTownCenterBars(list: TownCenterSnapshot[]) {
    const seen = new Set<number>();
    for (const tc of list) {
      const index = tc.y * worldTilesX + tc.x;
      seen.add(index);
      let bar = townCenterHpBars.get(index);
      if (!bar) {
        bar = new Graphics();
        worldLayer.addChild(bar);
        townCenterHpBars.set(index, bar);
      }
      bar.position.set(tc.x * tileSize + tileSize / 2, tc.y * tileSize + tileSize / 2 - townCenterArtAbove(tc.level) - 6);
      drawHpBar(bar, tc.hp, tc.maxHp);
    }
    for (const [index, bar] of Array.from(townCenterHpBars)) {
      if (seen.has(index)) continue;
      bar.destroy();
      townCenterHpBars.delete(index);
    }
  }

  const cursorHighlight = new Graphics();
  // Pale plaza ghost under the cursor while the Town Center tool is selected.
  const placementGhost = new Sprite(TOWN_CENTER_MARKER_TEXTURE ?? Texture.EMPTY);
  placementGhost.visible = false;
  placementGhost.alpha = 0.85;
  // Town Center: the plaza marker. Road tools: a faded road piece filling the hovered tile.
  function configurePlacementGhost(tool: TileType) {
    if (isRoadTile(tool)) {
      const texture = roadTexture(tool === TileType.Road ? "road-isolated" : COBBLE_FILL);
      placementGhost.texture = texture;
      placementGhost.anchor.set(0.5);
      placementGhost.scale.set(32 / texture.width);
      placementGhost.alpha = 0.55;
    } else if (TOWN_CENTER_MARKER_TEXTURE) {
      placementGhost.texture = TOWN_CENTER_MARKER_TEXTURE;
      placementGhost.anchor.set(TOWN_CENTER_LEVEL_FIT[0].anchor.x, TOWN_CENTER_LEVEL_FIT[0].anchor.y);
      placementGhost.scale.set((32 * TOWN_CENTER_LEVEL_FIT[0].widthTiles) / TOWN_CENTER_MARKER_TEXTURE.width);
      placementGhost.alpha = 0.85;
    }
  }
  configurePlacementGhost(TileType.TownCenter);

  // World-space overlays: parented to worldLayer so they follow the camera automatically.
  const selectionRings = new Graphics();
  const dragBox = new Graphics();

  // Single source of truth for tileSpriteLayer: shows `tile`'s art at (tx, ty), or clears the
  // slot back to bare floor if it has none (Empty, anything unmapped). A construction site draws the
  // building it will become, faded; leveled buildings and farms pick their tier / stage art.
  function setTileSprite(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    const site = tile === TileType.ConstructionSite ? constructionSites.get(index) : undefined;
    const artTile = site ? site.target : tile;
    const level = site ? 1 : (buildingLevels.get(index) ?? 1);
    const stage = farmStages.get(index);
    const stageTexture = !site && stage !== undefined ? FARM_STAGE_TEXTURES.get(tile)?.get(stage) : undefined;
    const levelTexture = TILE_LEVEL_TEXTURES.get(artTile)?.[level - 1];
    const gateOpen = tile === TileType.Gate && ((gateFlags.get(index) ?? 0) & (GATE_FLAG_OPEN | GATE_FLAG_OVERRUN)) !== 0;
    const texture = gateOpen
      ? GATE_OPEN_TEXTURE
      : tile === TileType.ConstructionSite && !site
        ? TILE_TEXTURES.get(TileType.Wall) // until the snapshot names the target
        : tile === TileType.IronOre
          ? IRON_ORE_VARIANTS[(tx * 7 + ty * 13) % IRON_ORE_VARIANTS.length]
          : (stageTexture ??
            levelTexture ??
            (TILE_ALT_TEXTURES.has(tile) && (tx * 7 + ty * 13) % 2 === 1
              ? TILE_ALT_TEXTURES.get(tile)
              : (tileAnimTexture(index, tile, performance.now()) ?? TILE_TEXTURES.get(artTile))));
    if (TILE_ANIM_TEXTURES.has(tile)) animatedTiles.set(index, tile);
    else animatedTiles.delete(index);
    let sprite = tileSprites.get(index);
    if (!texture) {
      if (sprite) {
        sprite.destroy();
        tileSprites.delete(index);
      }
      return;
    }
    if (sprite) {
      sprite.texture = texture;
    } else {
      sprite = new Sprite(texture);
      tileSpriteLayer.addChild(sprite);
      tileSprites.set(index, sprite);
    }
    sprite.rotation = 0;
    sprite.alpha = tile === TileType.ConstructionSite ? CONSTRUCTION_ALPHA : 1;
    sprite.tint =
      tile === TileType.ConstructionSite
        ? CONSTRUCTION_TINT
        : stageTexture || levelTexture
          ? 0xffffff
          : (TILE_TINT.get(tile) ?? 0xffffff);
    if (fireTier(damagedBuildings.get(index) ?? 1000) > 0) sprite.tint = SOOT_TINT;
    if (artTile === TileType.TownCenter) {
      const fit = levelTexture ? TOWN_CENTER_LEVEL_FIT[level - 1] : { widthTiles: TOWN_CENTER_WIDTH_TILES, anchor: TOWN_CENTER_ANCHOR };
      sprite.anchor.set(fit.anchor.x, fit.anchor.y);
      sprite.scale.set((tileSize * fit.widthTiles) / texture.width);
      sprite.position.set(tx * tileSize + tileSize / 2, ty * tileSize + tileSize / 2);
      sprite.zIndex = index;
      return;
    }
    if (isRoadTile(tile)) {
      // Autotiled ground: centered so it can rotate, flush on its tile, under all other tile art.
      const [roadArt, turns] = roadArtFor(tx, ty, tile);
      sprite.texture = roadArt;
      sprite.anchor.set(0.5);
      sprite.rotation = (turns * Math.PI) / 2;
      sprite.scale.set(tileSize / roadArt.width, tileSize / roadArt.height);
      sprite.position.set(tx * tileSize + tileSize / 2, ty * tileSize + tileSize / 2);
      sprite.zIndex = -1;
      return;
    }
    sprite.anchor.set(0.5, 1);
    const fillTile = TILE_SPRITE_FILL_TILE.has(artTile);
    const naturalScale = fillTile
      ? Math.max(tileSize / texture.width, tileSize / texture.height)
      : Math.min(
          (tileSize * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width,
          (tileSize * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height
        ) * (TILE_SPRITE_SIZE_FACTOR[artTile as TileType] ?? 1);
    const minHeight = levelTexture ? TILE_LEVEL_MIN_HEIGHT.get(`${artTile}:${level}`) : TILE_MIN_RENDER_HEIGHT.get(artTile);
    const scale = minHeight ? Math.max(naturalScale, minHeight / texture.height) : naturalScale;
    sprite.scale.set(scale);
    sprite.position.set(tx * tileSize + tileSize / 2, (ty + 1) * tileSize);
    // Row-major index: lower rows draw in front of the rows above them; x breaks ties. Flush
    // ground-like tiles (water) go under all other tile art.
    sprite.zIndex = fillTile ? -1 : index;
  }

  function isRoadAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= worldTilesX || ty >= worldTilesY) return false;
    return isRoadTile(tiles[ty * worldTilesX + tx] as TileType);
  }

  // [texture, clockwise quarter turns] for the road at (tx, ty) from its orthogonal road neighbours.
  function roadArtFor(tx: number, ty: number, tile: number): [Texture, number] {
    const mask =
      (isRoadAt(tx, ty - 1) ? 1 : 0) | (isRoadAt(tx + 1, ty) ? 2 : 0) | (isRoadAt(tx, ty + 1) ? 4 : 0) | (isRoadAt(tx - 1, ty) ? 8 : 0);
    if (tile === TileType.CobbleRoad) {
      if (mask === 5 || mask === 1 || mask === 4) return [roadTexture(COBBLE_STRAIGHT), 0];
      if (mask === 10 || mask === 2 || mask === 8) return [roadTexture(COBBLE_STRAIGHT), 1];
      return [roadTexture(COBBLE_FILL), 0];
    }
    const [name, turns] = ROAD_AUTOTILE[mask];
    return [roadTexture(name), turns];
  }

  // Pixels from a Town Center's tile center up to the top of its art (for its HP bar).
  function townCenterArtAbove(level: number): number {
    const levelTexture = TILE_LEVEL_TEXTURES.get(TileType.TownCenter)?.[level - 1];
    const texture = levelTexture ?? TILE_TEXTURES.get(TileType.TownCenter)!;
    const fit = levelTexture ? TOWN_CENTER_LEVEL_FIT[level - 1] : { widthTiles: TOWN_CENTER_WIDTH_TILES, anchor: TOWN_CENTER_ANCHOR };
    return ((tileSize * fit.widthTiles) / texture.width) * texture.height * fit.anchor.y;
  }

  // Floor never changes per-tile, so this only needs to run on a full map (re)load, not per edit.
  // A 512 map has 262k floor tiles, so sprites are built per 16x16-tile chunk, lazily the first time
  // the camera sees it (updateFloorChunks, every frame), and chunks off screen are hidden.
  const FLOOR_CHUNK_TILES = 16;
  const floorChunks = new Map<number, Container>();
  function setFloorSprites() {
    for (const s of floorSprites) s.destroy();
    floorSprites.length = 0;
    for (const c of floorChunks.values()) c.destroy({ children: true });
    floorChunks.clear();
  }
  function buildFloorChunk(cx: number, cy: number): Container {
    const chunk = new Container();
    const x0 = cx * FLOOR_CHUNK_TILES;
    const y0 = cy * FLOOR_CHUNK_TILES;
    for (let x = x0; x < Math.min(worldTilesX, x0 + FLOOR_CHUNK_TILES); x++) {
      for (let y = y0; y < Math.min(worldTilesY, y0 + FLOOR_CHUNK_TILES); y++) {
        const biome = biomes[y * worldTilesX + x] ?? Biome.Plains;
        const texture =
          biome === Biome.Hills
            ? HILLS_FLOOR_TEXTURE
            : biome === Biome.Swamp
            ? SWAMP_FLOOR_TEXTURE
            : GRASS_FLOOR_VARIANTS[(x + y) % GRASS_FLOOR_VARIANTS.length];
        const sprite = new Sprite(texture);
        sprite.anchor.set(0, 0);
        sprite.width = tileSize;
        sprite.height = tileSize;
        sprite.position.set(x * tileSize, y * tileSize);
        chunk.addChild(sprite);
      }
    }
    floorSpriteLayer.addChild(chunk);
    return chunk;
  }
  function updateFloorChunks() {
    const span = FLOOR_CHUNK_TILES * tileSize;
    const left = Math.floor(-worldLayer.position.x / ZOOM / span) - 1;
    const right = Math.floor((app.screen.width - worldLayer.position.x) / ZOOM / span) + 1;
    const top = Math.floor(-worldLayer.position.y / ZOOM / span) - 1;
    const bottom = Math.floor((app.screen.height - worldLayer.position.y) / ZOOM / span) + 1;
    const chunksX = Math.ceil(worldTilesX / FLOOR_CHUNK_TILES);
    const chunksY = Math.ceil(worldTilesY / FLOOR_CHUNK_TILES);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = cy * chunksX + cx;
        const visible = cx >= left && cx <= right && cy >= top && cy <= bottom;
        let chunk = floorChunks.get(key);
        if (!chunk) {
          if (!visible) continue;
          chunk = buildFloorChunk(cx, cy);
          floorChunks.set(key, chunk);
        }
        chunk.visible = visible;
      }
    }
  }

  // Like the floor, only rebuilt on a full map (re)load; per-tile edits just toggle visibility
  // (setTileLocal) so a decoration never shows through a building, water, ruin or prop.
  function setDecorSprites() {
    for (const s of decorSprites.values()) s.destroy();
    decorSprites.clear();
    for (let x = 0; x < worldTilesX; x++) {
      for (let y = 0; y < worldTilesY; y++) {
        const index = y * worldTilesX + x;
        if ((biomes[index] ?? Biome.Plains) !== Biome.Plains) continue;
        if (tileHash01(x, y, 1) * NATURE_DECOR_ONE_IN >= 1) continue;
        const variant = NATURE_DECOR_TEXTURES[Math.floor(tileHash01(x, y, 2) * NATURE_DECOR_TEXTURES.length)];
        const sprite = new Sprite(variant.texture);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(variant.height / variant.texture.height);
        // Small stable offset inside the tile so the scatter doesn't sit on a visible grid.
        const offsetX = (tileHash01(x, y, 3) - 0.5) * tileSize * 0.4;
        const offsetY = (tileHash01(x, y, 4) - 0.5) * tileSize * 0.3;
        sprite.position.set(x * tileSize + tileSize / 2 + offsetX, (y + 0.85) * tileSize + offsetY);
        sprite.visible = (tiles[index] ?? TileType.Empty) === TileType.Empty;
        decorSpriteLayer.addChild(sprite);
        decorSprites.set(index, sprite);
      }
    }
  }

  // ---- Ambient critters (see WILDLIFE) ----
  // Frogs sit and hop around swamp and water edges; crows perch anywhere and flap off to a new perch. Each critter only ever targets a tile
  // that's Empty right now, so it doesn't stroll into a building that already exists; one ticker
  // moves all of them and one shared clock picks their animation frames.
  type CritterKind = keyof typeof WILDLIFE;
  interface Critter {
    kind: CritterKind;
    sprite: Sprite;
    homeX: number;
    homeY: number;
    x: number;
    y: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    moving: boolean;
    moveMs: number;
    elapsedMs: number;
    restMs: number;
    phase: number;
  }
  const WILDLIFE_TEXTURES = {
    crow: WILDLIFE.crow.frames.map((u) => loadedTextures[u]),
    frog: WILDLIFE.frog.frames.map((u) => loadedTextures[u]),
  };
  const critters: Critter[] = [];
  const tileAt = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= worldTilesX || ty >= worldTilesY ? -1 : (tiles[ty * worldTilesX + tx] ?? TileType.Empty);
  function nearWater(tx: number, ty: number): boolean {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (tileAt(tx + dx, ty + dy) === TileType.Water) return true;
    return false;
  }
  function critterTileOk(kind: CritterKind, tx: number, ty: number): boolean {
    if (tileAt(tx, ty) !== TileType.Empty) return false;
    const biome = biomes[ty * worldTilesX + tx] ?? Biome.Plains;
    if (kind === "frog") return biome === Biome.Swamp || nearWater(tx, ty);
    return true;
  }
  // A random eligible tile within `radius` tiles of (cx, cy), or null after a few misses.
  function pickCritterSpot(kind: CritterKind, cx: number, cy: number, radius: number): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const tx = Math.floor(cx / tileSize + (Math.random() * 2 - 1) * radius);
      const ty = Math.floor(cy / tileSize + (Math.random() * 2 - 1) * radius);
      if (!critterTileOk(kind, tx, ty)) continue;
      return { x: (tx + 0.2 + Math.random() * 0.6) * tileSize, y: (ty + 0.3 + Math.random() * 0.6) * tileSize };
    }
    return null;
  }
  const critterZ = (x: number, y: number) =>
    Math.floor(y / tileSize) * worldTilesX + Math.floor(x / tileSize) + 0.5;
  function spawnWildlife() {
    for (const c of critters) c.sprite.destroy();
    critters.length = 0;
    const eligible: Record<CritterKind, number[]> = { crow: [], frog: [] };
    for (let ty = 0; ty < worldTilesY; ty++) {
      for (let tx = 0; tx < worldTilesX; tx++) {
        for (const kind of ["crow", "frog"] as CritterKind[]) {
          if (critterTileOk(kind, tx, ty)) eligible[kind].push(ty * worldTilesX + tx);
        }
      }
    }
    for (const kind of ["crow", "frog"] as CritterKind[]) {
      const spots = eligible[kind];
      const def = WILDLIFE[kind];
      const count = Math.min(def.max, Math.floor(spots.length / def.tilesPer));
      const textures = WILDLIFE_TEXTURES[kind];
      if (!textures.every(Boolean)) continue;
      for (let i = 0; i < count; i++) {
        const index = spots[Math.floor(Math.random() * spots.length)];
        const x = ((index % worldTilesX) + 0.5) * tileSize;
        const y = (Math.floor(index / worldTilesX) + 0.7) * tileSize;
        const sprite = new Sprite(textures[0]);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(def.size / textures[0].width);
        sprite.position.set(x, y);
        // Depth-sorted among the tile art like a prop on the tile it stands on (see setTileSprite's
        // row-major zIndex), so a frog behind a cottage is hidden by it. Updated only on a tile change.
        sprite.zIndex = critterZ(x, y);
        tileSpriteLayer.addChild(sprite);
        critters.push({
          kind, sprite, homeX: x, homeY: y, x, y, fromX: x, fromY: y, toX: x, toY: y,
          moving: false, moveMs: 0, elapsedMs: 0, restMs: Math.random() * 6000, phase: Math.floor(Math.random() * 4),
        });
      }
    }
  }
  // Wander radius (tiles) around home, travel speed (px/s) and rest range (ms) per kind.
  const CRITTER_MOVE = {
    crow: { radius: 7, speed: 70, restMin: 4000, restMax: 14000 },
    frog: { radius: 2, speed: 40, restMin: 1500, restMax: 6000 },
  };
  const CRITTER_FRAME_MS = 160;
  app.ticker.add((ticker) => {
    if (critters.length === 0) return;
    const dt = ticker.deltaMS;
    const clock = Math.floor(performance.now() / CRITTER_FRAME_MS);
    for (const c of critters) {
      const move = CRITTER_MOVE[c.kind];
      if (!c.moving) {
        c.restMs -= dt;
        if (c.restMs <= 0) {
          const spot = pickCritterSpot(c.kind, c.homeX, c.homeY, move.radius);
          if (spot) {
            c.fromX = c.x;
            c.fromY = c.y;
            c.toX = spot.x;
            c.toY = spot.y;
            c.moveMs = Math.max(250, (Math.hypot(spot.x - c.x, spot.y - c.y) / move.speed) * 1000);
            c.elapsedMs = 0;
            c.moving = true;
          } else {
            c.restMs = move.restMin;
          }
        }
      } else {
        c.elapsedMs += dt;
        const t = Math.min(1, c.elapsedMs / c.moveMs);
        c.x = c.fromX + (c.toX - c.fromX) * t;
        c.y = c.fromY + (c.toY - c.fromY) * t;
        if (Math.abs(c.toX - c.fromX) > 0.5) {
          c.sprite.scale.x = Math.abs(c.sprite.scale.x) * (c.toX > c.fromX ? 1 : -1);
        }
        if (t >= 1) {
          c.moving = false;
          c.restMs = move.restMin + Math.random() * (move.restMax - move.restMin);
        }
      }
      // Crows fly and frogs hop: lift the sprite along an arc while moving (purely visual).
      const t = c.moving ? Math.min(1, c.elapsedMs / c.moveMs) : 0;
      const lift = c.kind === "crow" ? Math.sin(Math.PI * t) * 14 : c.kind === "frog" ? Math.sin(Math.PI * t) * 5 : 0;
      c.sprite.position.set(c.x, c.y - lift);
      // A crow in flight passes over everything on the ground.
      const z = c.kind === "crow" && c.moving ? Number.MAX_SAFE_INTEGER : critterZ(c.x, c.y);
      if (z !== c.sprite.zIndex) c.sprite.zIndex = z;
      const f = clock + c.phase;
      if (c.kind === "crow") {
        // Perched: frame 0. Flying: flap through frames 1-3.
        c.sprite.texture = c.moving ? WILDLIFE_TEXTURES.crow[1 + (f % 3)] : WILDLIFE_TEXTURES.crow[0];
      } else {
        // Sit (0), leap (1) mid-hop, land (2) at the very end.
        c.sprite.texture = WILDLIFE_TEXTURES.frog[!c.moving ? 0 : t < 0.85 ? 1 : 2];
      }
    }
  });

  // ---- Server wildlife (huntable game; see WILDLIFE_ART) ----
  interface WildlifeSet {
    walk: Texture[];
    idle: Texture[];
    run: Texture[];
    tint: number;
  }
  const deerWalkTextures = DEER_WALK_URLS.map((u) => loadedTextures[u]);
  const deerGrazeTextures = DEER_GRAZE_URLS.map((u) => loadedTextures[u]);
  const loadedAll = (urls: string[]) => urls.length > 0 && urls.every((u) => optionalTextures[u]);
  const WILDLIFE_SETS = Object.fromEntries(
    WILDLIFE_KINDS.map((kind) => {
      const opt = WILDLIFE_OPTIONAL_URLS[kind];
      const ownWalk = loadedAll(opt.walk);
      const walk = ownWalk ? opt.walk.map((u) => optionalTextures[u]) : deerWalkTextures;
      const idle = loadedAll(opt.idle)
        ? opt.idle.map((u) => optionalTextures[u])
        : ownWalk
          ? [walk[0]]
          : deerGrazeTextures;
      const run = loadedAll(opt.run) ? opt.run.map((u) => optionalTextures[u]) : walk;
      // Stand-in deer frames are tinted per kind; a kind's own art is drawn as is.
      const tint = ownWalk || kind === "deer" ? 0xffffff : WILDLIFE_ART[kind].tint;
      return [kind, { walk, idle, run, tint }];
    })
  ) as Record<WildlifeKind, WildlifeSet>;
  const wildlifeSprites = new Map<number, { sprite: Sprite; kind: WildlifeKind; lastX: number; phase: number }>();
  // `flat` is the snapshot's flattened list (WILDLIFE_SNAPSHOT_STRIDE numbers per animal). An animal
  // that disappears was killed (nothing else removes one), so it leaves a small blood stain.
  function syncWildlife(flat: number[]) {
    const seen = new Set<number>();
    const now = performance.now();
    for (let i = 0; i + WILDLIFE_SNAPSHOT_STRIDE <= flat.length; i += WILDLIFE_SNAPSHOT_STRIDE) {
      const id = flat[i];
      const kind = WILDLIFE_KINDS[flat[i + 1]] ?? "deer";
      const x = flat[i + 2];
      const y = flat[i + 3];
      const state = flat[i + 4] as WildlifeState;
      seen.add(id);
      const set = WILDLIFE_SETS[kind];
      let entry = wildlifeSprites.get(id);
      if (!entry) {
        const sprite = new Sprite(set.walk[0]);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(WILDLIFE_ART[kind].size / set.walk[0].width);
        sprite.tint = set.tint;
        tileSpriteLayer.addChild(sprite);
        entry = { sprite, kind, lastX: x, phase: Math.floor(Math.random() * 4) };
        wildlifeSprites.set(id, entry);
      }
      const { sprite } = entry;
      // Feet a little below the server position (the tile-centre point), like the old critters.
      sprite.position.set(x, y + tileSize * 0.2);
      const z = critterZ(x, y);
      if (z !== sprite.zIndex) sprite.zIndex = z;
      const running = state === WildlifeState.Flee || state === WildlifeState.Charge;
      const frames = running ? set.run : state === WildlifeState.Walk ? set.walk : set.idle;
      const frameMs = running ? WILDLIFE_RUN_FRAME_MS : state === WildlifeState.Walk ? WILDLIFE_FRAME_MS : WILDLIFE_FRAME_MS * 4;
      sprite.texture = frames[(Math.floor(now / frameMs) + entry.phase) % frames.length];
      const scale = WILDLIFE_ART[kind].size / set.walk[0].width;
      if (Math.abs(x - entry.lastX) > 0.5) sprite.scale.x = x > entry.lastX ? scale : -scale;
      entry.lastX = x;
    }
    for (const [id, entry] of Array.from(wildlifeSprites)) {
      if (seen.has(id)) continue;
      const x = entry.sprite.position.x;
      const y = entry.sprite.position.y;
      const stain = () => stampBlood(x, y - tileSize * 0.2, BLOOD_HIT_VARIANTS, BLOOD_HIT_SIZE);
      // A killed deer lies where it fell for a moment, then leaves its stain (other game: just the stain).
      if (entry.kind === "deer" && DEER_FALLEN_TEXTURE) spawnFallenDeer(x, y, entry.sprite.scale.x < 0, stain);
      else stain();
      entry.sprite.destroy();
      wildlifeSprites.delete(id);
    }
  }
  function spawnFallenDeer(x: number, y: number, facingLeft: boolean, onEnd: () => void) {
    const texture = DEER_FALLEN_TEXTURE!;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    const scale = (WILDLIFE_ART.deer.size * 1.15) / texture.width;
    sprite.scale.set(facingLeft ? -scale : scale, scale);
    sprite.position.set(x, y);
    decorSpriteLayer.addChild(sprite);
    activeEffects.push({
      sprite,
      startedAt: performance.now(),
      durationMs: DEER_FALLEN_MS,
      update: (s, t) => {
        s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
      },
      onEnd,
    });
  }
  function clearWildlifeSprites() {
    for (const entry of wildlifeSprites.values()) entry.sprite.destroy();
    wildlifeSprites.clear();
  }

  // Full-map path (welcome, incl. restart).
  function redrawGrid() {
    setFloorSprites();
    setDecorSprites();
    for (let x = 0; x < worldTilesX; x++) {
      for (let y = 0; y < worldTilesY; y++) {
        setTileSprite(x, y, tiles[y * worldTilesX + x] ?? TileType.Empty);
      }
    }
    // Drop slots past the end of the map in case a new welcome shrank it.
    for (const [index, sprite] of tileSprites) {
      if (index >= worldTilesX * worldTilesY) {
        sprite.destroy();
        tileSprites.delete(index);
        animatedTiles.delete(index);
      }
    }
    nightOverlay.clear();
    nightOverlay.rect(0, 0, worldTilesX * tileSize, worldTilesY * tileSize).fill(0x0a0a2a);
    spawnWildlife();
  }

  function setTileLocal(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    tiles[index] = tile;
    setTileSprite(tx, ty, tile);
    const decor = decorSprites.get(index);
    if (decor) decor.visible = tile === TileType.Empty;
    // Neighbouring roads re-pick their autotile piece (this tile may have become / stopped being road).
    for (const [nx, ny] of [[tx, ty - 1], [tx + 1, ty], [tx, ty + 1], [tx - 1, ty]]) {
      if (isRoadAt(nx, ny)) setTileSprite(nx, ny, tiles[ny * worldTilesX + nx]);
    }
  }

  // Last ratio drawn per bar: every snapshot (20/s) upserts every entity, and with raid waves that can
  // be hundreds of mobs, so only rebuild a bar's geometry when its fill actually changed.
  const hpBarRatio = new WeakMap<Graphics, number>();
  function drawHpBar(bar: Graphics, hp: number, maxHp: number) {
    const width = 24;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    if (hpBarRatio.get(bar) === ratio) return;
    hpBarRatio.set(bar, ratio);
    bar.clear();
    bar.rect(-width / 2, 0, width, height).fill(0x550000);
    bar.rect(-width / 2, 0, width * ratio, height).fill(0x3bd16f);
  }

  function ensureVisual(
    map: Map<string, EntityVisual>,
    id: string,
    create: () => Container
  ): EntityVisual {
    let entry = map.get(id);
    if (!entry) {
      const sprite = create();
      const hpBar = new Graphics();
      worldLayer.addChild(sprite);
      worldLayer.addChild(hpBar);
      entry = { sprite, hpBar };
      map.set(id, entry);
    }
    return entry;
  }

  function destroyVisual(map: Map<string, EntityVisual>, id: string) {
    const entry = map.get(id);
    if (entry) {
      entry.sprite.destroy();
      entry.hpBar.destroy();
      entry.marker?.destroy();
      entry.wound?.destroy();
      entry.aura?.destroy();
      entry.sigil?.destroy();
      entry.markLabel?.destroy();
      entry.bossLabel?.destroy();
      map.delete(id);
    }
  }

  // Health-based wound decal over a unit (light < 66% hp, bleeding < 40%, heavy < 20%). The sprite is
  // created once, on the unit's first damaged snapshot, then only repositioned/retextured; healthy or
  // hidden units just hide it.
  function updateWound(
    entry: EntityVisual,
    hp: number,
    maxHp: number,
    x: number,
    y: number,
    size: number,
    large: boolean,
    hidden: boolean
  ) {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    let tier = -1;
    for (let i = 0; i < WOUND_THRESHOLDS.length; i++) if (ratio < WOUND_THRESHOLDS[i]) tier = i;
    if (tier < 0 || hidden || hp <= 0) {
      if (entry.wound) entry.wound.visible = false;
      return;
    }
    const texture = (large ? WOUND_LARGE_TEXTURES : WOUND_TEXTURES)[tier];
    let wound = entry.wound;
    if (!wound) {
      wound = new Sprite(texture);
      wound.anchor.set(0.5);
      wound.alpha = 0.9;
      worldLayer.addChild(wound);
      entry.wound = wound;
    }
    if (wound.texture !== texture) wound.texture = texture;
    wound.scale.set(size / Math.max(texture.width, texture.height));
    wound.position.set(x, y);
    wound.visible = true;
  }

  function pruneMissing(
    map: Map<string, EntityVisual>,
    seenIds: Set<string>,
    poofOnRemove = false,
    deathSound?: string
  ) {
    for (const [id, entry] of Array.from(map)) {
      if (seenIds.has(id)) continue;
      if (poofOnRemove && !suppressDeathPoofs && entry.sprite.visible) {
        spawnDeathPoof(entry.sprite.position.x, entry.sprite.position.y);
        if (deathSound) sound.play(deathSound, { x: entry.sprite.position.x, y: entry.sprite.position.y });
      }
      destroyVisual(map, id);
    }
  }

  function upsertPlayer(p: PlayerSnapshot) {
    const entry = ensureVisual(playerSprites, p.id, () => {
      const sprite = new Sprite(PLAYER_TEXTURE);
      sprite.anchor.set(0.5);
      sprite.scale.set(PLAYER_SPRITE_HEIGHT / PLAYER_TEXTURE.height);
      // One Filter per sprite: uniforms live on the Filter instance, so sharing one would
      // force every player to the same hue.
      sprite.filters = [
        new Filter({
          glProgram: playerRecolorProgram,
          resources: {
            recolorUniforms: { uTargetHue: { value: hexToHue(p.color), type: "f32" } },
          },
        }),
      ];
      return sprite;
    });
    if (p.id === myId && !entry.marker) {
      const marker = new Graphics().ellipse(0, 0, 14, 5).stroke({ width: 2, color: 0xffffff });
      // Under the sprite so it reads as a ground ring.
      worldLayer.addChildAt(marker, worldLayer.getChildIndex(entry.sprite));
      entry.marker = marker;
    }
    entry.sprite.position.set(p.x, p.y);
    // A rider with no Town Center to respawn at is gone until one is built (game over overlay).
    entry.sprite.visible = !p.dead;
    entry.hpBar.visible = !p.dead;
    if (entry.marker) entry.marker.visible = !p.dead;
    entry.marker?.position.set(p.x, p.y + PLAYER_SPRITE_HEIGHT * 0.4);
    // Just above the (taller) sprite's top edge instead of the old fixed -20.
    entry.hpBar.position.set(p.x, p.y - PLAYER_SPRITE_HEIGHT / 2 - 4);
    drawHpBar(entry.hpBar, p.hp, p.maxHp);
    if (!(entry.sprite instanceof Sprite)) return;
    const facingRight = getFacing(playerFacing, p.id, p.x);
    if (PLAYER_ANIM) {
      let anim = playerAnim.get(p.id);
      if (!anim) {
        anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: p.x, lastY: p.y, attackTicks: 0 };
        playerAnim.set(p.id, anim);
      }
      const moved = Math.hypot(p.x - anim.lastX, p.y - anim.lastY) > 0.5;
      anim.lastX = p.x;
      anim.lastY = p.y;
      const mode = anim.attackTicks > 0 ? "action" : moved ? "walk" : null;
      if (anim.attackTicks > 0) anim.attackTicks--;
      // The recolor Filter stays on the sprite; swapping its texture keeps the per-player hue.
      showAnimFrame(entry.sprite, PLAYER_ANIM, stepAnim(anim, PLAYER_ANIM, mode) ?? PLAYER_ANIM.walk[0]);
    }
    applyFacing(entry.sprite, facingRight);
  }

  function syncPlayers(snapshot: PlayerSnapshot[]) {
    const seenIds = new Set(snapshot.map((p) => p.id));
    pruneMissing(playerSprites, seenIds);
    pruneFacing(playerFacing, seenIds);
    for (const id of Array.from(playerAnim.keys())) {
      if (!seenIds.has(id)) playerAnim.delete(id);
    }
    for (const p of snapshot) upsertPlayer(p);
  }

  function upsertColonist(c: ColonistSnapshot, isNight: boolean) {
    const entry = ensureVisual(colonistSprites, c.id, () => {
      const texture = COLONIST_TEXTURES[c.kind];
      if (!texture) return new Graphics().circle(0, 0, 8).fill(COLONIST_COLORS[c.kind] ?? 0xffffff);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(COLONIST_SPRITE_HEIGHT / texture.height);
      return sprite;
    });
    entry.sprite.position.set(c.x, c.y);
    entry.hpBar.position.set(c.x, c.y - 18);
    drawHpBar(entry.hpBar, c.hp, c.maxHp);

    let hidden = false;
    if (HIDE_AT_POST_KINDS.has(c.kind)) {
      const postCenterX = c.postX * tileSize + tileSize / 2;
      const postCenterY = c.postY * tileSize + tileSize / 2;
      const hideRadius = c.kind === "archer" ? ARCHER_HIDE_RADIUS_PX : AT_POST_HIDE_RADIUS_PX;
      if (Math.hypot(c.x - postCenterX, c.y - postCenterY) <= hideRadius) hidden = true;
    }
    // Civilians shelter in a house (or the Town Center) at night; the server sets `sheltered` once
    // they've arrived (updateShelteringCivilian, TILE_SIZE*1.5 radius) - once they've actually arrived, they should read as having
    // gone inside it, the same way a worker disappears into its own post above, not stand
    // visibly idling next to the flag all night.
    if (WORKER_KINDS.has(c.kind) && isNight && c.sheltered) hidden = true;
    entry.sprite.visible = !hidden;
    entry.hpBar.visible = !hidden;
    updateWound(entry, c.hp, c.maxHp, c.x, c.y - 2, COLONIST_WOUND_SIZE, false, hidden);

    const set = COLONIST_ANIMS[c.kind];
    if (set && entry.sprite instanceof Sprite) {
      let anim = colonistAnim.get(c.id);
      if (!anim) {
        anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: c.x, lastY: c.y };
        colonistAnim.set(c.id, anim);
      }
      const moved = Math.hypot(c.x - anim.lastX, c.y - anim.lastY) > 0.5;
      anim.lastX = c.x;
      anim.lastY = c.y;
      const mode = COLONIST_ACTION_STATES.has(c.state)
        ? "action"
        : c.state === "carrying" && set.carry
          ? "carry"
          : COLONIST_WALK_STATES.has(c.state) || moved
          ? "walk"
          : null;
      const frame = stepAnim(anim, set, mode);
      // Idle pose = the walk cycle's own first frame, not the kind's separate static PNG: that
      // image was extracted independently and doesn't share the walk sheet's body-to-canvas
      // ratio, so using it here made units visibly pop in size on every idle<->walk/action
      // transition (i.e. every time they started or stopped moving).
      showAnimFrame(entry.sprite, set, frame ?? set.walk[0]);
      const battered = BATTERED_TINT_KINDS.has(c.kind) && c.hp < c.maxHp * BATTERED_HP_FRACTION;
      const posed = battered && !frame && showBatteredPose(entry.sprite, set, c.kind, COLONIST_SPRITE_HEIGHT);
      entry.sprite.tint = battered && !posed ? BATTERED_TINT : (COLONIST_TINT.get(c.kind) ?? 0xffffff);
    }
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(colonistFacing, c.id, c.x));
  }

  // Swaps an idle unit's frame for its static battered pose (BATTERED_POSE_URLS), `height` px tall
  // with its feet where the anim set's idle frame puts them. False when the kind has no pose art.
  function showBatteredPose(sprite: Sprite, set: AnimSet, kind: string, height: number): boolean {
    const texture = BATTERED_POSE_TEXTURES.get(kind);
    if (!texture) return false;
    const feetBelowCenter = (set.refHeight * set.scale) / 2;
    sprite.texture = texture;
    sprite.scale.set(height / texture.height);
    sprite.anchor.set(0.5, 1 - feetBelowCenter / height);
    return true;
  }

  function syncColonists(snapshot: ColonistSnapshot[], isNight: boolean) {
    const seenIds = new Set(snapshot.map((c) => c.id));
    pruneMissing(colonistSprites, seenIds, true, "colonist_death");
    for (const id of Array.from(colonistAnim.keys())) {
      if (!seenIds.has(id)) colonistAnim.delete(id);
    }
    pruneFacing(colonistFacing, seenIds);
    for (const id of Array.from(stateFxAt.keys())) {
      if (!seenIds.has(id)) stateFxAt.delete(id);
    }
    const now = performance.now();
    for (const c of snapshot) {
      upsertColonist(c, isNight);
      stateFx(c, now);
    }
  }

  function nearestFriendlyDistance(x: number, y: number): number {
    let best = Infinity;
    for (const map of [colonistSprites, playerSprites]) {
      for (const { sprite } of map.values()) {
        best = Math.min(best, Math.hypot(sprite.position.x - x, sprite.position.y - y));
      }
    }
    return best;
  }

  function upsertMob(m: MobSnapshot) {
    if (m.kind === "halfLatch" && !suppressDeathPoofs && !mobSprites.has(m.id)) maybeWardLapseFx(m.x, m.y);
    const variants = MOB_VARIANTS[m.kind];
    const woundSize = (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS * MOB_WOUND_SIZE_FACTOR;
    if (variants) {
      upsertVariantMob(m, variants[stableHash(m.id) % variants.length]);
      const entry = mobSprites.get(m.id)!;
      updateWound(entry, m.hp, m.maxHp, m.x, m.y, woundSize, WOUND_LARGE_KINDS.has(m.kind), !entry.sprite.visible);
      updateMarkVisuals(entry, m);
      updateBossVisuals(entry, m);
      return;
    }
    const visual = MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin;
    const texture = MOB_TEXTURES[m.kind];
    // Longer side, not height, so wide kinds (wolf, spider) don't balloon horizontally.
    const scale = texture
      ? (visual.radius * MOB_SPRITE_SIZE_PER_RADIUS) / Math.max(texture.width, texture.height)
      : 0;
    const entry = ensureVisual(mobSprites, m.id, () => {
      if (!texture) {
        // Dark outline keeps the green-toned kinds readable against the green grass floor.
        return new Graphics()
          .circle(0, 0, visual.radius)
          .fill(visual.color)
          .stroke({ width: 1.5, color: 0x1a0d0a });
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(scale * mobRenderScale(m));
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    // Bar just above the sprite's top edge, matching the player's "height / 2 + 4" convention.
    const topOffset = texture ? (texture.height * scale * mobRenderScale(m)) / 2 + 4 : visual.radius + 9;
    entry.hpBar.position.set(m.x, m.y - topOffset);
    drawHpBar(entry.hpBar, m.hp, m.maxHp);
    updateWound(entry, m.hp, m.maxHp, m.x, m.y, woundSize, WOUND_LARGE_KINDS.has(m.kind), !entry.sprite.visible);
    updateMarkVisuals(entry, m);
    updateBossVisuals(entry, m);
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(mobFacing, m.id, m.x));
  }

  // Sigil + name label above a Hunger-marked mob (over its hp bar) and its aura on the ground under it
  // (decor layer: over the floor, under tiles and units), alpha pulsing gently. Created on the mob's
  // first snapshot; ordinary mobs never get any of it.
  function updateMarkVisuals(entry: EntityVisual, m: MobSnapshot) {
    const mark = m.mark ?? HungerMark.None;
    if (mark === HungerMark.None) return;
    if (!entry.sigil) {
      const sigilTexture = HUNGER_SIGIL_TEXTURES[mark];
      const auraTexture = HUNGER_AURA_TEXTURES[mark];
      if (auraTexture) {
        entry.aura = new Sprite(auraTexture);
        entry.aura.anchor.set(0.5);
        entry.aura.scale.set(HUNGER_AURA_WIDTH / auraTexture.width);
        decorSpriteLayer.addChild(entry.aura);
      }
      entry.sigil = new Sprite(sigilTexture ?? Texture.EMPTY);
      entry.sigil.anchor.set(0.5, 1);
      if (sigilTexture) entry.sigil.scale.set(HUNGER_SIGIL_SIZE / Math.max(sigilTexture.width, sigilTexture.height));
      const name = HUNGER_MARK_NAMES[mark] ?? "";
      entry.markLabel = new Text({
        text: name.charAt(0).toUpperCase() + name.slice(1),
        style: { fontFamily: "monospace", fontSize: 8, fill: HUNGER_LABEL_COLORS[mark] ?? 0xffffff, stroke: { color: 0x000000, width: 2 } },
      });
      entry.markLabel.anchor.set(0.5, 1);
      worldLayer.addChild(entry.sigil);
      worldLayer.addChild(entry.markLabel);
    }
    const visible = entry.sprite.visible;
    const barY = entry.hpBar.position.y;
    entry.sigil.position.set(m.x, barY - 1);
    entry.sigil.visible = visible;
    entry.markLabel!.position.set(m.x, barY - HUNGER_SIGIL_SIZE - 1);
    entry.markLabel!.visible = visible;
    if (entry.aura) {
      const feetY = m.y + (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS * MARKED_MOB_SCALE * 0.4;
      entry.aura.position.set(m.x, feetY);
      entry.aura.alpha = 0.6 + 0.25 * Math.sin(performance.now() / 450);
      entry.aura.visible = visible;
    }
  }

  // Name label over a boss's (enlarged, still centred) hp bar. Created on the boss's first snapshot.
  function updateBossVisuals(entry: EntityVisual, m: MobSnapshot) {
    if (!m.boss) return;
    const barScale = BOSS_HP_BAR_SCALE[m.boss];
    if (!entry.bossLabel) {
      entry.hpBar.scale.set(barScale);
      entry.bossLabel = new Text({
        text: bossTitle(m.kind, m.boss),
        style: {
          fontFamily: "Palatino Linotype, Palatino, Georgia, serif",
          fontSize: m.boss === "warlord" ? 12 : 10,
          fontWeight: "bold",
          fill: BOSS_LABEL_COLORS[m.boss],
          stroke: { color: 0x000000, width: 3 },
        },
      });
      entry.bossLabel.anchor.set(0.5, 1);
      worldLayer.addChild(entry.bossLabel);
    }
    // The bar grows upward from its usual spot so it never covers the sprite.
    const barY = entry.hpBar.position.y - 4 * (barScale - 1);
    entry.hpBar.position.y = barY;
    entry.bossLabel.position.set(m.x, barY - 2 - (m.mark ? HUNGER_SIGIL_SIZE + 10 : 0));
    entry.bossLabel.visible = entry.sprite.visible;
  }

  function upsertVariantMob(m: MobSnapshot, variant: MobVariant) {
    const entry = ensureVisual(mobSprites, m.id, () => {
      const sprite = new Sprite(variant.idle);
      sprite.anchor.set(0.5);
      sprite.scale.set(variant.idleScale);
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    entry.hpBar.position.set(m.x, m.y - (variant.idle.height * variant.idleScale * mobRenderScale(m)) / 2 - 4);
    drawHpBar(entry.hpBar, m.hp, m.maxHp);
    const sprite = entry.sprite instanceof Sprite ? entry.sprite : null;
    const facingRight = sprite ? getFacing(mobFacing, m.id, m.x) : true;
    if (sprite) applyFacing(sprite, facingRight);

    const set = variant.anim;
    if (!set || !sprite) return;
    let anim = mobAnim.get(m.id);
    if (!anim) {
      anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: m.x, lastY: m.y };
      mobAnim.set(m.id, anim);
    }
    const moved = Math.hypot(m.x - anim.lastX, m.y - anim.lastY) > 0.5;
    anim.lastX = m.x;
    anim.lastY = m.y;
    const mode = moved
      ? "walk"
      : nearestFriendlyDistance(m.x, m.y) <= (MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX[m.kind] ?? MOB_ATTACK_ANIM_RANGE_PX)
        ? "action"
        : null;
    const frame = stepAnim(anim, set, mode);
    // Same fix as the colonist idle fallback above: use the walk cycle's own first frame instead
    // of `variant.idle` (a separately-extracted static texture) so idle<->animated transitions
    // don't pop in size.
    showAnimFrame(sprite, set, frame ?? set.walk[0]);
    const battered = BATTERED_TINT_KINDS.has(m.kind) && m.hp < m.maxHp * BATTERED_HP_FRACTION;
    const posed =
      battered && !frame && showBatteredPose(sprite, set, m.kind, (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS);
    sprite.tint = battered && !posed ? BATTERED_TINT : 0xffffff;
    const renderScale = mobRenderScale(m);
    if (renderScale !== 1) sprite.scale.set(sprite.scale.x * renderScale, sprite.scale.y * renderScale);
    // showAnimFrame resets scale.x to a positive magnitude, so re-apply the flip after it.
    applyFacing(sprite, facingRight);
  }

  function syncMobs(snapshot: MobSnapshot[]) {
    const seenIds = new Set(snapshot.map((m) => m.id));
    pruneMissing(mobSprites, seenIds, true, "monster_death");
    for (const id of Array.from(mobAnim.keys())) {
      if (!seenIds.has(id)) mobAnim.delete(id);
    }
    pruneFacing(mobFacing, seenIds);
    for (const m of snapshot) upsertMob(m);
  }

  // Client-only, short-lived combat VFX. `update` gets progress 0..1 each frame; `onEnd` can chain
  // a follow-up effect (an arrow's impact spark).
  interface ActiveEffect {
    sprite: Sprite;
    startedAt: number;
    durationMs: number;
    update: (sprite: Sprite, t: number) => void;
    onEnd?: () => void;
  }
  const activeEffects: ActiveEffect[] = [];
  // Rendered size (px, longest side) of each effect sprite in world space.
  const FX_SIZE = { slash: 22, spark: 14, poof: 30, arrow: 18, shamanBolt: 12 };
  const SHAMAN_BOLT_TINT = 0xb98cff;
  const PROJECTILE_PX_PER_MS = 0.5;

  function addFx(
    texture: Texture,
    size: number,
    x: number,
    y: number,
    durationMs: number,
    update: ActiveEffect["update"],
    onEnd?: () => void
  ): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(texture.width, texture.height));
    sprite.position.set(x, y);
    worldLayer.addChild(sprite);
    activeEffects.push({ sprite, startedAt: performance.now(), durationMs, update, onEnd });
    return sprite;
  }

  function fadeOut(sprite: Sprite, t: number) {
    sprite.alpha = 1 - t * t;
  }

  function spawnImpactSpark(x: number, y: number, tint = 0xffffff) {
    const spark = addFx(FX_TEXTURES.spark, FX_SIZE.spark, x, y, 140, fadeOut);
    spark.tint = tint;
  }

  // Dark smoke rising off a burning building (fx-poof, tinted; see syncDamagedBuildings).
  function spawnSmokePuff(x: number, y: number) {
    const base = FX_SIZE.poof / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    const puff = addFx(FX_TEXTURES.poof, FX_SIZE.poof, x, y, 1200, (s, t) => {
      s.scale.set(base * (0.6 + 0.8 * t));
      s.y = y - 18 * t;
      s.alpha = 0.55 * (1 - t);
    });
    puff.tint = 0x4a4440;
  }

  function spawnDeathPoof(x: number, y: number) {
    const base = FX_SIZE.poof / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    addFx(FX_TEXTURES.poof, FX_SIZE.poof, x, y, 420, (s, t) => {
      s.scale.set(base * (0.7 + 0.5 * t));
      s.y = y - 6 * t;
      s.alpha = 1 - t;
    });
  }

  // VFX sheet 2 one-shot: steps through the set's 4 frames, fading over the last quarter. `under`
  // puts it in the tile layer just beneath the tile at `underIndex` (the ward rings sit under the stone).
  const FX_ANIM_SIZE = { build: 30, upgrade: 30, heal: 22, poison: 20, wardPulse: 56, wardLapse: 56 };
  function spawnFxAnim(kind: keyof typeof FX_ANIM_TEXTURES, x: number, y: number, durationMs: number, underIndex?: number) {
    const frames = FX_ANIM_TEXTURES[kind];
    const sprite = addFx(frames[0], FX_ANIM_SIZE[kind], x, y, durationMs, (s, t) => {
      const frame = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
      if (s.texture !== frame) s.texture = frame;
      s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
    });
    sprite.anchor.set(0.5, 1);
    if (underIndex !== undefined) {
      tileSpriteLayer.addChild(sprite);
      sprite.zIndex = underIndex - 0.5;
    }
  }
  const tileCenter = (tx: number, ty: number) => ({ x: tx * tileSize + tileSize / 2, y: ty * tileSize + tileSize / 2 });
  // A Ward Stone's lapse lets a Half-Latch through at the stone (server checkWardStoneLapses), so a
  // Half-Latch first appearing on or next to a Ward Stone marks the lapse there.
  function maybeWardLapseFx(x: number, y: number) {
    const tx = Math.floor(x / tileSize);
    const ty = Math.floor(y / tileSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= worldTilesX || ny >= worldTilesY) continue;
        if (tiles[ny * worldTilesX + nx] !== TileType.WardStone) continue;
        const c = tileCenter(nx, ny);
        spawnFxAnim("wardLapse", c.x, c.y + tileSize / 2, 900, ny * worldTilesX + nx);
        return;
      }
    }
  }
  // Heal / ward-pulse cues from colonist state: one effect per bishop every HEAL_FX_MS while healing,
  // and per ward priest every WARD_FX_MS while tending its stone (its post).
  const HEAL_FX_MS = 900;
  const WARD_FX_MS = 1800;
  const stateFxAt = new Map<string, number>();
  const BUILD_FX_MS = 1500;
  function stateFx(c: ColonistSnapshot, now: number) {
    if (c.state === "building" || c.state === "repairing") {
      // Builders hammering: a build puff at the site (or damaged building) they work, the nearest one.
      const last = stateFxAt.get(c.id) ?? 0;
      if (now - last < BUILD_FX_MS) return;
      stateFxAt.set(c.id, now);
      let best: { tx: number; ty: number } | null = null;
      let bestD = tileSize * 2;
      for (const index of (c.state === "building" ? constructionSites : damagedBuildings).keys()) {
        const t = indexToTile(index);
        const d = Math.hypot(t.tx * tileSize + tileSize / 2 - c.x, t.ty * tileSize + tileSize / 2 - c.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        const p = tileCenter(best.tx, best.ty);
        spawnFxAnim("build", p.x, p.y + tileSize / 2, 700);
      }
      return;
    }
    const healing = c.state === "healing";
    if (!healing && c.state !== "warding") return;
    const last = stateFxAt.get(c.id) ?? 0;
    if (now - last < (healing ? HEAL_FX_MS : WARD_FX_MS)) return;
    stateFxAt.set(c.id, now);
    if (healing) {
      spawnFxAnim("heal", c.x, c.y + 10, 600);
    } else {
      const p = tileCenter(c.postX, c.postY);
      spawnFxAnim("wardPulse", p.x, p.y + tileSize / 2, 1000, c.postY * worldTilesX + c.postX);
    }
  }

  // Effects don't carry the attacker: whoever stands at the origin turns to face the target, so
  // fighters slash at each other rather than facing the way they last walked. The facing sticks
  // until the unit next moves horizontally (see getFacing).
  function faceAttacker(e: AttackEffect) {
    const dx = e.toX - e.fromX;
    if (Math.abs(dx) < 1) return;
    const right = dx > 0;
    const at = (x: number, y: number) => Math.abs(x - e.fromX) < 2 && Math.abs(y - e.fromY) < 2;
    const face = (map: FacingMap, sprites: Map<string, EntityVisual>, units: { id: string; x: number; y: number }[]) => {
      for (const u of units) {
        if (!at(u.x, u.y)) continue;
        const prev = map.get(u.id);
        if (prev) prev.facingRight = right;
        else map.set(u.id, { lastX: u.x, facingRight: right });
        const s = sprites.get(u.id)?.sprite;
        if (s instanceof Sprite) applyFacing(s, right);
      }
    };
    face(colonistFacing, colonistSprites, latestColonists);
    face(mobFacing, mobSprites, latestMobs);
  }

  function spawnEffect(e: AttackEffect) {
    faceAttacker(e);
    const angle = Math.atan2(e.toY - e.fromY, e.toX - e.fromX);
    if (e.melee) {
      // Effects don't carry the attacker; a player standing at the origin plays its lance thrust.
      for (const [id, { sprite }] of playerSprites) {
        if (Math.abs(sprite.position.x - e.fromX) < 2 && Math.abs(sprite.position.y - e.fromY) < 2) {
          triggerPlayerAttackAnim(id);
        }
      }
      if (Math.random() < BLOOD_HIT_CHANCE) stampBlood(e.toX, e.toY, BLOOD_HIT_VARIANTS, BLOOD_HIT_SIZE);
      sound.play("sword_hit", { x: e.toX, y: e.toY });
      const slash = addFx(FX_TEXTURES.slash, FX_SIZE.slash, e.toX, e.toY, 160, fadeOut);
      slash.rotation = angle;
      // Giant Spider bites poison (server: mob.kind === "giantSpider"); the effect's origin is the spider.
      if (latestMobs.some((m) => m.kind === "giantSpider" && Math.abs(m.x - e.fromX) < 2 && Math.abs(m.y - e.fromY) < 2)) {
        spawnFxAnim("poison", e.toX, e.toY + 8, 650);
      }
      return;
    }
    // Ranged attacks don't carry the attacker's kind; a Dark Shaman standing at the origin casts a
    // purple bolt instead of an arrow.
    const isShaman = latestMobs.some(
      (m) => m.kind === "darkShaman" && Math.abs(m.x - e.fromX) < 2 && Math.abs(m.y - e.fromY) < 2
    );
    const distance = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
    const durationMs = Math.min(260, Math.max(60, distance / PROJECTILE_PX_PER_MS));
    const tint = isShaman ? SHAMAN_BOLT_TINT : 0xffffff;
    // Shaman bolts are magic, not arrows: no bow sounds for them.
    if (!isShaman) sound.play("arrow_shoot", { x: e.fromX, y: e.fromY });
    const projectile = addFx(
      isShaman ? FX_TEXTURES.spark : FX_TEXTURES.arrow,
      isShaman ? FX_SIZE.shamanBolt : FX_SIZE.arrow,
      e.fromX,
      e.fromY,
      durationMs,
      (s, t) => s.position.set(e.fromX + (e.toX - e.fromX) * t, e.fromY + (e.toY - e.fromY) * t),
      () => {
        spawnImpactSpark(e.toX, e.toY, tint);
        if (!isShaman) sound.play("arrow_hit", { x: e.toX, y: e.toY });
      }
    );
    projectile.rotation = angle;
    projectile.tint = tint;
  }

  app.ticker.add(() => {
    const now = performance.now();
    for (let i = activeEffects.length - 1; i >= 0; i--) {
      const fx = activeEffects[i];
      const t = Math.min(1, (now - fx.startedAt) / fx.durationMs);
      fx.update(fx.sprite, t);
      if (t >= 1) {
        fx.sprite.destroy();
        activeEffects.splice(i, 1);
        fx.onEnd?.();
      }
    }
  });

  // Shared clock for every looping tile (fire flicker, water ripple): one pass over the animated
  // slots, and only on a frame boundary of the fastest loop, not per sprite or per render frame.
  let lastTileAnimStep = -1;
  const tileAnimStepMs = Math.min(...Array.from(TILE_ANIM_TEXTURES.values(), (a) => a.frameMs));
  app.ticker.add(() => {
    const now = performance.now();
    const step = Math.floor(now / tileAnimStepMs);
    if (step === lastTileAnimStep) return;
    lastTileAnimStep = step;
    for (const [index, tile] of animatedTiles) {
      const sprite = tileSprites.get(index);
      const texture = tileAnimTexture(index, tile, now);
      if (sprite && texture && sprite.texture !== texture) sprite.texture = texture;
    }
    // Building fires share the campfire loop's clock; tier 2+ also puffs smoke now and then.
    const fireFrame = Math.floor(now / FIRE_FRAME_MS);
    for (const o of fireOverlays.values()) {
      if (o.tier <= 0) continue;
      o.flame.texture = FIRE_FRAMES[(fireFrame + o.phase) % FIRE_FRAMES.length];
      if (o.tier >= 2 && now >= o.nextSmokeAt) {
        o.nextSmokeAt = now + FIRE_SMOKE_MS * (0.75 + 0.5 * Math.random());
        spawnSmokePuff(o.flame.x, o.flame.y - FIRE_FLAME_WIDTH[o.tier]);
      }
    }
  });

  app.ticker.add(() => {
    if (!myId) return;
    const mine = playerSprites.get(myId);
    if (!mine) return;
    const focus = fightPeekFocus(mine.sprite.position.x, mine.sprite.position.y);
    worldLayer.position.set(
      app.screen.width / 2 - focus.x * ZOOM,
      app.screen.height / 2 - focus.y * ZOOM
    );
    updateFloorChunks();
  });

  // ---- Fog-of-war minimap (DOM canvas, bottom-right; the main view is never fogged) ----
  // Static layer: one pixel per tile in an offscreen canvas, rebuilt whole only on `welcome` and
  // patched per tile on tileUpdate / explored. Each snapshot just blits it and draws the live dots
  // and camera rect on top, so nothing repaints the whole map per frame.
  const minimapEl = document.getElementById("minimap") as HTMLCanvasElement;
  minimapEl.addEventListener("contextmenu", (e) => e.preventDefault());
  const minimapCtx = minimapEl.getContext("2d")!;
  const minimapStatic = document.createElement("canvas");
  const minimapStaticCtx = minimapStatic.getContext("2d")!;
  let minimapImage: ImageData | null = null;
  let minimapStaticDirty = false;
  let explored = new Uint8Array(0);
  const MINIMAP_TARGET_CSS_PX = 180;
  // Both integers, so tile -> pixel stays exact: CSS px per tile, and backing px per CSS px.
  let minimapCssPerTile = 1;
  let minimapDpr = 1;

  const MINIMAP_UNEXPLORED = 0x140d07;
  const MINIMAP_BIOME: Record<number, number> = {
    [Biome.Plains]: 0x6b7a3c,
    [Biome.Hills]: 0x8a7650,
    [Biome.Swamp]: 0x4c5a44,
  };
  const MINIMAP_WATER = 0x3d5f73;
  const MINIMAP_TREE = 0x3c5428;
  const MINIMAP_ROCK = 0x8d8a80;
  const MINIMAP_IRON = 0x7d5644;
  const MINIMAP_WALL = 0xb8ad98;
  const MINIMAP_ROAD = 0xa8875a;
  const MINIMAP_BUILDING = 0xe0b468;
  const MINIMAP_RUIN = 0xa0322a;
  const MINIMAP_CAMP = 0xd2731a;
  const MINIMAP_ABBEY = 0xf0e6cc;
  const MINIMAP_RUIN_TILES = new Set<number>([
    TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble,
  ]);
  const MINIMAP_CAMP_TILES = new Set<number>([
    TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence,
  ]);
  const MINIMAP_ABBEY_TILES = new Set<number>([TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost]);

  function minimapTileColor(index: number): number {
    if (!explored[index]) return MINIMAP_UNEXPLORED;
    const tile = tiles[index] ?? TileType.Empty;
    switch (tile) {
      case TileType.Empty:
        return MINIMAP_BIOME[biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Water:
        return MINIMAP_WATER;
      case TileType.Tree:
      case TileType.FruitTree:
      case TileType.FruitTreePicked:
        return MINIMAP_TREE;
      // Bushes and mushroom patches are ground cover: drawn as the biome under them.
      case TileType.BerryBush:
      case TileType.BerryBushPicked:
      case TileType.MushroomPatch:
      case TileType.MushroomPatchPicked:
        return MINIMAP_BIOME[biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Rock:
        return MINIMAP_ROCK;
      case TileType.IronOre:
        return MINIMAP_IRON;
      case TileType.Wall:
      case TileType.StoneWall:
      case TileType.Gate:
        return MINIMAP_WALL;
      case TileType.Road:
      case TileType.CobbleRoad:
        return MINIMAP_ROAD;
    }
    if (MINIMAP_RUIN_TILES.has(tile)) return MINIMAP_RUIN;
    if (MINIMAP_CAMP_TILES.has(tile)) return MINIMAP_CAMP;
    if (MINIMAP_ABBEY_TILES.has(tile)) return MINIMAP_ABBEY;
    // Every other tile is something the colony built (the Town Center also gets its own marker).
    return MINIMAP_BUILDING;
  }

  function paintMinimapTile(index: number) {
    if (!minimapImage) return;
    const color = minimapTileColor(index);
    const o = index * 4;
    minimapImage.data[o] = color >> 16;
    minimapImage.data[o + 1] = (color >> 8) & 0xff;
    minimapImage.data[o + 2] = color & 0xff;
    minimapImage.data[o + 3] = 255;
    minimapStaticDirty = true;
  }

  // `welcome` (join or restart): unpack the bitset and rebuild the whole static layer once.
  function resetMinimap(packedExplored: string) {
    const count = worldTilesX * worldTilesY;
    const bytes = atob(packedExplored);
    explored = new Uint8Array(count);
    for (let i = 0; i < count; i++) explored[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
    minimapCssPerTile = Math.max(1, Math.round(MINIMAP_TARGET_CSS_PX / Math.max(worldTilesX, worldTilesY)));
    minimapDpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const scale = minimapCssPerTile * minimapDpr;
    minimapEl.width = worldTilesX * scale;
    minimapEl.height = worldTilesY * scale;
    minimapEl.style.width = `${worldTilesX * minimapCssPerTile}px`;
    minimapEl.style.height = `${worldTilesY * minimapCssPerTile}px`;
    minimapStatic.width = worldTilesX;
    minimapStatic.height = worldTilesY;
    minimapImage = minimapStaticCtx.createImageData(worldTilesX, worldTilesY);
    for (let i = 0; i < count; i++) paintMinimapTile(i);
  }

  function markExplored(indices: number[]) {
    for (const i of indices) {
      if (i < 0 || i >= explored.length || explored[i]) continue;
      explored[i] = 1;
      paintMinimapTile(i);
    }
  }

  function cssColor(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
  }

  function drawMinimap(players: PlayerSnapshot[], colonists: ColonistSnapshot[], mobs: MobSnapshot[]) {
    if (!minimapImage) return;
    if (minimapStaticDirty) {
      minimapStaticCtx.putImageData(minimapImage, 0, 0);
      minimapStaticDirty = false;
    }
    const ctx = minimapCtx;
    const s = minimapCssPerTile * minimapDpr; // backing px per tile
    const u = minimapDpr; // backing px per CSS px
    const toMap = (worldPx: number) => (worldPx / tileSize) * s;
    const tileOf = (worldPx: number) => Math.floor(worldPx / tileSize);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(minimapStatic, 0, 0, worldTilesX * s, worldTilesY * s);

    for (const { x: tcX, y: tcY } of latestTownCenters) {
      const size = 7 * u;
      const cx = (tcX + 0.5) * s;
      const cy = (tcY + 0.5) * s;
      ctx.fillStyle = "#2e1a0c";
      ctx.fillRect(cx - size / 2 - u, cy - size / 2 - u, size + 2 * u, size + 2 * u);
      ctx.fillStyle = "#7a1f1a";
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(cx - 1.5 * u, cy - 1.5 * u, 3 * u, 3 * u);
    }

    // The Castle Ruin, once its centre tile is explored: its 9x9 walls outlined, a red keep in the middle.
    if (castleRuinTile && explored[castleRuinTile.y * worldTilesX + castleRuinTile.x]) {
      const half = 4.5 * s;
      const cx = (castleRuinTile.x + 0.5) * s;
      const cy = (castleRuinTile.y + 0.5) * s;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = "#d8cfbf";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      const keep = 5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - keep / 2 - u, cy - keep / 2 - u, keep + 2 * u, keep + 2 * u);
      ctx.fillStyle = "#a8321e";
      ctx.fillRect(cx - keep / 2, cy - keep / 2, keep, keep);
    }

    // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with
    // the server's vision radii. Mobs outside it aren't drawn, even on explored ground.
    const sources: Array<{ x: number; y: number; r2: number }> = [];
    for (const p of players) {
      sources.push({ x: tileOf(p.x), y: tileOf(p.y), r2: VISION_RADIUS_PLAYER * VISION_RADIUS_PLAYER });
    }
    for (const c of colonists) {
      if (tiles[c.postY * worldTilesX + c.postX] === TileType.AbbeyHall) continue;
      sources.push({ x: tileOf(c.x), y: tileOf(c.y), r2: VISION_RADIUS_COLONIST * VISION_RADIUS_COLONIST });
    }

    ctx.fillStyle = "#f3da98";
    for (const c of colonists) {
      if (!explored[tileOf(c.y) * worldTilesX + tileOf(c.x)]) continue;
      ctx.fillRect(Math.round(toMap(c.x) - u), Math.round(toMap(c.y) - u), 2 * u, 2 * u);
    }

    for (const m of mobs) {
      const mx = tileOf(m.x);
      const my = tileOf(m.y);
      const seen = sources.some((src) => (src.x - mx) ** 2 + (src.y - my) ** 2 <= src.r2);
      if (!seen) continue;
      const x = Math.round(toMap(m.x) - 1.5 * u);
      const y = Math.round(toMap(m.y) - 1.5 * u);
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(x - u, y - u, 5 * u, 5 * u);
      ctx.fillStyle = "#ff3b2a";
      ctx.fillRect(x, y, 3 * u, 3 * u);
    }

    for (const p of players) {
      if (p.id === myId) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.y), 3 * u, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(p.color);
      ctx.fill();
      ctx.lineWidth = u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
    }

    const me = players.find((p) => p.id === myId);
    if (me) {
      ctx.beginPath();
      ctx.arc(toMap(me.x), toMap(me.y), 4 * u, 0, Math.PI * 2);
      ctx.lineWidth = 3.5 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
      ctx.lineWidth = 1.75 * u;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // Main camera viewport (worldLayer is scaled by ZOOM and offset to follow the player).
    const viewX = toMap(-worldLayer.position.x / ZOOM);
    const viewY = toMap(-worldLayer.position.y / ZOOM);
    const viewW = toMap(app.screen.width / ZOOM);
    const viewH = toMap(app.screen.height / ZOOM);
    ctx.lineWidth = u;
    ctx.strokeStyle = "rgba(251, 236, 200, 0.85)";
    ctx.strokeRect(Math.round(viewX) + u / 2, Math.round(viewY) + u / 2, Math.round(viewW) - u, Math.round(viewH) - u);
    drawFightPings(ctx, s, u);
  }

  // ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
  // The snapshot's per-player `fights` (server-clustered) become one DOM arrow each, clamped to the
  // screen rim by placeEdgeArrow and hidden while the fight is on screen; a fight the server drops fades
  // out over FIGHT_ARROW_FADE_MS. Clicking an arrow pans the camera there for FIGHT_PEEK_MS (any
  // movement key returns it to the player). The minimap pings every listed fight, and the first time a
  // fight begins off-screen a toast names it (at most one per FIGHT_TOAST_THROTTLE_MS).
  const fightArrowLayer = document.getElementById("fight-arrows")!;
  interface FightArrow {
    fight: FightSnapshot;
    el: HTMLButtonElement;
    chevron: HTMLElement;
    title: HTMLElement;
    sub: HTMLElement;
    goneAt: number;
  }
  const fightArrows = new Map<number, FightArrow>();
  const FIGHT_ARROW_FADE_MS = 600;
  // Kept clear of the top button row / toasts and the bottom command bar.
  const FIGHT_ARROW_INSETS = { top: 70, right: 40, bottom: 56, left: 40 };
  const FIGHT_LABEL_OFFSET_PX = 34;
  const FIGHT_TOAST_THROTTLE_MS = 20000;
  const FIGHT_PEEK_MS = 4000;
  const FIGHT_PEEK_EASE = 0.18;
  let latestFights: FightSnapshot[] = [];
  const announcedFightIds = new Set<number>();
  let lastFightToastAt = -Infinity;
  let fightPeek: { x: number; y: number; until: number } | null = null;
  // The eased camera focus while peeking or easing back (null = locked on the player).
  let fightPeekCam: { x: number; y: number } | null = null;

  function fightPeekFocus(playerX: number, playerY: number): { x: number; y: number } {
    if (fightPeek) {
      const input = currentInput();
      if (performance.now() > fightPeek.until || input.dx !== 0 || input.dy !== 0) fightPeek = null;
    }
    if (!fightPeek && !fightPeekCam) return { x: playerX, y: playerY };
    const cam = fightPeekCam ?? { x: playerX, y: playerY };
    const tx = fightPeek ? fightPeek.x : playerX;
    const ty = fightPeek ? fightPeek.y : playerY;
    cam.x += (tx - cam.x) * FIGHT_PEEK_EASE;
    cam.y += (ty - cam.y) * FIGHT_PEEK_EASE;
    fightPeekCam = cam;
    if (!fightPeek && Math.hypot(cam.x - playerX, cam.y - playerY) < 2) {
      fightPeekCam = null;
      return { x: playerX, y: playerY };
    }
    return cam;
  }

  function fightWorldPos(f: FightSnapshot): { x: number; y: number } {
    return { x: (f.x + 0.5) * tileSize, y: (f.y + 0.5) * tileSize };
  }

  function fightTitle(f: FightSnapshot): string {
    return f.buildings && !f.units && !f.you ? "Under attack" : f.label;
  }

  function fightIsOnScreen(f: FightSnapshot): boolean {
    const w = fightWorldPos(f);
    return placeEdgeArrow(
      app.screen.width, app.screen.height,
      worldLayer.position.x + w.x * ZOOM, worldLayer.position.y + w.y * ZOOM, FIGHT_ARROW_INSETS
    ).onScreen;
  }

  // Direction and distance in tiles from the local player (the camera centre if there is none).
  function fightBearing(f: FightSnapshot): { dir: string; tiles: number } {
    const me = myId ? playerSprites.get(myId) : undefined;
    const ox = me ? me.sprite.position.x / tileSize : (app.screen.width / 2 - worldLayer.position.x) / ZOOM / tileSize;
    const oy = me ? me.sprite.position.y / tileSize : (app.screen.height / 2 - worldLayer.position.y) / ZOOM / tileSize;
    const dx = f.x + 0.5 - ox;
    const dy = f.y + 0.5 - oy;
    return { dir: compassDirection(dx, dy), tiles: Math.round(Math.hypot(dx, dy)) };
  }

  function createFightArrow(f: FightSnapshot): FightArrow {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "fight-arrow";
    const chevron = document.createElement("span");
    chevron.className = "fight-chevron";
    const label = document.createElement("span");
    label.className = "fight-label";
    const title = document.createElement("span");
    const sub = document.createElement("small");
    label.append(title, sub);
    el.append(chevron, label);
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const arrow = fightArrows.get(f.id);
      const target = fightWorldPos(arrow ? arrow.fight : f);
      fightPeek = { x: target.x, y: target.y, until: performance.now() + FIGHT_PEEK_MS };
      el.blur();
    });
    fightArrowLayer.append(el);
    return { fight: f, el, chevron, title, sub, goneAt: 0 };
  }

  function clearFightArrows() {
    for (const a of fightArrows.values()) a.el.remove();
    fightArrows.clear();
    latestFights = [];
    announcedFightIds.clear();
    fightPeek = null;
    fightPeekCam = null;
  }

  function syncFights(fights: FightSnapshot[] | undefined) {
    latestFights = fights ?? [];
    const now = performance.now();
    const seen = new Set<number>();
    for (const f of latestFights) {
      seen.add(f.id);
      let arrow = fightArrows.get(f.id);
      if (!arrow) {
        arrow = createFightArrow(f);
        fightArrows.set(f.id, arrow);
      }
      arrow.fight = f;
      arrow.goneAt = 0;
      arrow.el.className = `fight-arrow fight-i${f.intensity}`;
      arrow.el.title = `${f.label}: ${f.combatants} fighting${f.you ? " (you)" : ""} - click to look`;
      if (!announcedFightIds.has(f.id)) {
        announcedFightIds.add(f.id);
        if (now - lastFightToastAt >= FIGHT_TOAST_THROTTLE_MS && !fightIsOnScreen(f)) {
          lastFightToastAt = now;
          const { dir, tiles } = fightBearing(f);
          pushEventToast("raid", `${fightTitle(f)} to the ${dir} (${tiles} tiles)`);
        }
      }
    }
    for (const [id, arrow] of fightArrows) {
      if (!seen.has(id) && arrow.goneAt === 0) arrow.goneAt = now;
    }
  }

  app.ticker.add(() => {
    if (fightArrows.size === 0) return;
    const now = performance.now();
    for (const [id, a] of fightArrows) {
      const gone = a.goneAt ? now - a.goneAt : 0;
      if (gone >= FIGHT_ARROW_FADE_MS) {
        a.el.remove();
        fightArrows.delete(id);
        continue;
      }
      const w = fightWorldPos(a.fight);
      const p = placeEdgeArrow(
        app.screen.width, app.screen.height,
        worldLayer.position.x + w.x * ZOOM, worldLayer.position.y + w.y * ZOOM, FIGHT_ARROW_INSETS
      );
      a.el.hidden = p.onScreen;
      if (p.onScreen) continue;
      a.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      a.chevron.style.transform = `rotate(${p.angle.toFixed(3)}rad)`;
      // The label sits just inside the rim, opposite the point.
      const label = a.title.parentElement!;
      label.style.left = `${(-Math.cos(p.angle) * FIGHT_LABEL_OFFSET_PX * 1.6).toFixed(1)}px`;
      label.style.top = `${(-Math.sin(p.angle) * FIGHT_LABEL_OFFSET_PX).toFixed(1)}px`;
      const pulse = 0.8 + 0.2 * Math.sin(now / (a.fight.intensity >= 3 ? 110 : a.fight.intensity === 2 ? 160 : 220));
      a.el.style.opacity = (fightArrowAlpha(a.fight.quiet, FIGHT_WINDOW_SECONDS, gone, FIGHT_ARROW_FADE_MS) * pulse).toFixed(3);
      const { dir, tiles } = fightBearing(a.fight);
      const title = `${fightTitle(a.fight)} · ${dir}`;
      const sub = `${tiles} tiles${a.fight.you ? " · you" : ""}`;
      if (a.title.textContent !== title) a.title.textContent = title;
      if (a.sub.textContent !== sub) a.sub.textContent = sub;
    }
  });

  // Expanding rings on the minimap at every listed fight (on or off screen), faster and wider the
  // fiercer it is. Called at the end of drawMinimap, in its backing-pixel space.
  function drawFightPings(ctx: CanvasRenderingContext2D, s: number, u: number) {
    if (latestFights.length === 0) return;
    const now = performance.now();
    for (const f of latestFights) {
      const cx = (f.x + 0.5) * s;
      const cy = (f.y + 0.5) * s;
      const period = f.intensity >= 3 ? 700 : f.intensity === 2 ? 950 : 1200;
      const phase = ((now + f.id * 137) % period) / period;
      const fade = Math.max(0.25, Math.min(1, FIGHT_WINDOW_SECONDS - f.quiet));
      ctx.beginPath();
      ctx.arc(cx, cy, (3 + phase * (5 + 2 * f.intensity)) * u, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = `rgba(255, 70, 40, ${((1 - phase) * fade).toFixed(3)})`;
      ctx.stroke();
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u);
      ctx.fillStyle = f.you || f.units || f.buildings ? "#ff3b2a" : "#f1c40f";
      ctx.fillRect(cx - u, cy - u, 2 * u, 2 * u);
    }
  }

  // Core stats (wood/iron/rock/gold/pop/time/happiness/army/selected) used to live here as a
  // floating canvas HUD; they're now DOM elements pinned to the top of #economy-panel, merged
  // into the same single menu as the goods/market panel. See the DOM refs set up below.

  const pausedBanner = new Text({
    text: "PAUSED",
    style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
  });
  pausedBanner.anchor.set(0.5);
  pausedBanner.visible = false;
  app.stage.addChild(pausedBanner);

  app.ticker.add(() => {
    pausedBanner.position.set(app.screen.width / 2, app.screen.height / 2);
  });

  // ---- Economy panel (DOM): goods stockpile + Market / Gold Shop, left side ----
  // The canvas HUD keeps the core numbers (wood/iron/rock/gold/pop/time); everything else lives here.

  type GoodKey =
    | "wood"
    | "iron"
    | "rock"
    | "gold"
    | "grain"
    | "meat"
    | "fruit"
    | "wool"
    | "cotton"
    | "clothes"
    | "tools"
    | "luxuryItems"
    | "alcohol";
  const GOODS_GROUPS: { heading: string; goods: { key: GoodKey; label: string }[] }[] = [
    {
      heading: "Food",
      goods: [
        { key: "grain", label: "Grain" },
        { key: "meat", label: "Meat" },
        { key: "fruit", label: "Fruit" },
      ],
    },
    {
      heading: "Materials",
      goods: [
        { key: "wood", label: "Wood" },
        { key: "iron", label: "Iron" },
        { key: "rock", label: "Rock" },
        { key: "gold", label: "Gold" },
        { key: "wool", label: "Wool" },
        { key: "cotton", label: "Hemp" },
      ],
    },
    {
      heading: "Crafted",
      goods: [
        { key: "clothes", label: "Clothes" },
        { key: "tools", label: "Tools" },
        { key: "luxuryItems", label: "Luxury Items" },
        { key: "alcohol", label: "Alcohol" },
      ],
    },
  ];

  const economyPanel = document.getElementById("economy-panel")!;
  const economyPanelToggle = document.getElementById("economy-panel-toggle")!;
  economyPanelToggle.addEventListener("click", () => {
    economyPanel.classList.toggle("collapsed");
    economyPanelToggle.classList.toggle("panel-open", !economyPanel.classList.contains("collapsed"));
    economyPanelToggle.blur();
  });

  // Core colony stats, pinned at the top of the same single menu as the goods/market panel.
  const statPopEl = document.getElementById("stat-pop")!;
  const statTimeEl = document.getElementById("stat-time")!;
  const sundialEl = document.getElementById("sundial")!;
  const sundialHandEl = document.getElementById("sundial-hand")!;
  const sundialNightArcEl = document.getElementById("sundial-night-arc")!;
  let sundialDayFraction = -1;
  const statHappinessEl = document.getElementById("stat-happiness")! as HTMLElement;
  const statArmyEl = document.getElementById("stat-army")!;
  const statSelectedEl = document.getElementById("stat-selected")!;

  const goodsValueEls = new Map<GoodKey, HTMLSpanElement>();
  const workerCountEls = new Map<string, HTMLSpanElement>();
  const goodsWorkerEls = new Map<GoodKey, HTMLSpanElement>();
  // Which goods group a worker's job feeds: Food (barn farmers, pastures, orchards), Materials
  // (lumberjacks, miners, wool/hemp fields) or Crafted (artisans). Null for non-workers.
  function workerGroup(c: { kind: string; postX: number; postY: number }): string | null {
    switch (c.kind) {
      case "farmer":
        return "Food";
      case "lumberjack":
      case "ironMiner":
      case "rockMiner":
        return "Materials";
      case "artisan":
        return "Crafted";
      case "hunter":
      case "forager":
        return "Food";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.WoolFarm || t === TileType.CottonFarm ? "Materials" : "Food";
      }
      default:
        return null;
    }
  }
  // The single resource a worker's job produces (artisans by their shop; the Tavern's brewers make gold).
  function workerResource(c: { kind: string; postX: number; postY: number }): GoodKey | null {
    switch (c.kind) {
      case "farmer":
        return "grain";
      case "lumberjack":
        return "wood";
      case "ironMiner":
        return "iron";
      case "rockMiner":
        return "rock";
      case "hunter":
        return "meat";
      case "forager":
        return "fruit";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.Orchard ? "fruit" : t === TileType.WoolFarm ? "wool" : t === TileType.CottonFarm ? "cotton" : "meat";
      }
      case "artisan": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.TailorShop
          ? "clothes"
          : t === TileType.Blacksmith
          ? "tools"
          : t === TileType.LuxuryWorkshop
          ? "luxuryItems"
          : t === TileType.Brewery
          ? "alcohol"
          : t === TileType.Tavern
          ? "gold"
          : null;
      }
      default:
        return null;
    }
  }
  // Barn farmers have no work animation of their own (the plots grow while the barn is staffed), so by
  // day they count as working; hunters and foragers count while they're out on a job.
  function isWorkerBusy(c: { kind: string; state: string }, isNight: boolean): boolean {
    if (COLONIST_ACTION_STATES.has(c.state)) return true;
    if (c.kind === "farmer") return !isNight;
    return (c.kind === "hunter" || c.kind === "forager") && FOOD_WORKER_BUSY_STATES.has(c.state);
  }
  function refreshWorkerCounts(colonists: { kind: string; state: string; postX: number; postY: number }[], isNight: boolean) {
    const working: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    const total: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    for (const c of colonists) {
      const group = workerGroup(c);
      if (!group) continue;
      total[group]++;
      if (isWorkerBusy(c, isNight)) working[group]++;
    }
    for (const [group, el] of workerCountEls) el.textContent = ` ${working[group]}/${total[group]} working`;
    const resWorking = new Map<GoodKey, number>();
    const resTotal = new Map<GoodKey, number>();
    for (const c of colonists) {
      const res = workerResource(c);
      if (!res) continue;
      resTotal.set(res, (resTotal.get(res) ?? 0) + 1);
      if (isWorkerBusy(c, isNight)) {
        resWorking.set(res, (resWorking.get(res) ?? 0) + 1);
      }
    }
    for (const [res, el] of goodsWorkerEls) {
      const total = resTotal.get(res) ?? 0;
      el.textContent = total > 0 ? ` ${resWorking.get(res) ?? 0}/${total}` : "";
    }
  }
  const goodsListEl = document.getElementById("goods-list")!;
  for (const group of GOODS_GROUPS) {
    const heading = document.createElement("div");
    heading.className = "econ-heading";
    heading.textContent = group.heading;
    const workerCount = document.createElement("span");
    workerCount.className = "econ-workers";
    workerCount.title = "Workers working / assigned";
    heading.appendChild(workerCount);
    workerCountEls.set(group.heading, workerCount);
    goodsListEl.appendChild(heading);
    for (const good of group.goods) {
      const row = document.createElement("div");
      row.className = "econ-row";
      const label = document.createElement("span");
      label.className = "econ-label";
      const icon = document.createElement("img");
      icon.className = "econ-icon";
      // The resource is Hemp (internal key "cotton" is kept so the protocol stays unchanged).
      icon.src = `/sprites/icon-${good.key === "cotton" ? "hemp" : good.key}.png`;
      icon.alt = "";
      label.append(icon, good.label);
      const workers = document.createElement("span");
      workers.className = "econ-workers-row";
      workers.title = "Workers working / assigned to this resource";
      label.append(workers);
      goodsWorkerEls.set(good.key, workers);
      const value = document.createElement("span");
      value.textContent = "0";
      row.append(label, value);
      goodsListEl.appendChild(row);
      goodsValueEls.set(good.key, value);
    }
  }

  // Mirrors the server's EXCHANGE_RATES / GOLD_SHOP_PRICES; the server re-validates every request.
  type BaseResource = "wood" | "iron" | "rock";
  type ShopItem = "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock";
  const RESOURCE_LABEL: Record<string, string> = {
    wood: "Wood",
    iron: "Iron",
    rock: "Rock",
    tools: "Tools",
    clothes: "Clothes",
    luxuryItems: "Luxury Item",
  };
  const MARKET_TRADES: { from: BaseResource; to: BaseResource; give: number; get: number }[] = [
    { from: "wood", to: "iron", give: 3, get: 1 },
    { from: "wood", to: "rock", give: 3, get: 1 },
    { from: "iron", to: "wood", give: 3, get: 1 },
    { from: "iron", to: "rock", give: 2, get: 1 },
    { from: "rock", to: "wood", give: 3, get: 1 },
    { from: "rock", to: "iron", give: 2, get: 1 },
  ];
  const GOLD_SHOP_ITEMS: { item: ShopItem; cost: number; amount: number }[] = [
    { item: "tools", cost: 10, amount: 1 },
    { item: "clothes", cost: 8, amount: 1 },
    { item: "luxuryItems", cost: 20, amount: 1 },
    { item: "wood", cost: 5, amount: 5 },
    { item: "iron", cost: 8, amount: 5 },
    { item: "rock", cost: 8, amount: 5 },
  ];

  const marketSection = document.getElementById("market-section")!;
  const goldShopSection = document.getElementById("gold-shop-section")!;
  const marketButtons: { btn: HTMLButtonElement; from: BaseResource; give: number }[] = [];
  const goldShopButtons: { btn: HTMLButtonElement; cost: number }[] = [];

  function sendMessage(msg: object) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  function makeEconButton(container: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "econ-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      onClick();
      // Never keep focus: Space is the attack key and would re-trigger a focused button.
      btn.blur();
    });
    container.appendChild(btn);
    return btn;
  }

  const marketBtnsEl = document.getElementById("market-btns")!;
  for (const trade of MARKET_TRADES) {
    const btn = makeEconButton(
      marketBtnsEl,
      `${trade.give} ${RESOURCE_LABEL[trade.from]} → ${trade.get} ${RESOURCE_LABEL[trade.to]}`,
      () => sendMessage({ type: "exchangeResource", from: trade.from, to: trade.to })
    );
    marketButtons.push({ btn, from: trade.from, give: trade.give });
  }

  const goldShopBtnsEl = document.getElementById("gold-shop-btns")!;
  for (const offer of GOLD_SHOP_ITEMS) {
    const btn = makeEconButton(
      goldShopBtnsEl,
      `${offer.amount} ${RESOURCE_LABEL[offer.item]} — ${offer.cost} gold`,
      () => sendMessage({ type: "buyWithGold", item: offer.item })
    );
    goldShopButtons.push({ btn, cost: offer.cost });
  }

  function refreshEconomyPanel(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    for (const [key, el] of goodsValueEls) el.textContent = String(snap[key]);
    // Sections stay hidden (not greyed out) until their building exists.
    marketSection.hidden = !snap.marketBuilt;
    goldShopSection.hidden = !snap.goldShopBuilt;
    for (const { btn, from, give } of marketButtons) btn.disabled = snap[from] < give;
    for (const { btn, cost } of goldShopButtons) btn.disabled = snap.gold < cost;
  }

  // ---- Toolbar (real DOM elements, not canvas-drawn) ----

  let currentTool: TileType = TileType.Wall;
  const toolButtonEls = new Map<TileType, HTMLButtonElement>();
  let activeCategory: ToolCategory = TOOL_CATEGORIES[0].key;
  const categoryTabEls = new Map<ToolCategory, HTMLButtonElement>();

  function setupToolbar() {
    const container = document.getElementById("toolbar")!;
    for (const tool of TOOLS) {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      btn.textContent = `${tool.label} (${tool.key})`;
      btn.addEventListener("click", () => {
        selectTool(tool.tile);
        btn.blur();
      });
      container.appendChild(btn);
      toolButtonEls.set(tool.tile, btn);
    }
    refreshToolbarSelection();
  }

  function setupCategoryTabs() {
    const container = document.getElementById("build-category-tabs")!;
    for (const cat of TOOL_CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "category-tab";
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        activeCategory = cat.key;
        refreshToolbarVisibility();
        refreshCategoryTabSelection();
        btn.blur();
      });
      container.appendChild(btn);
      categoryTabEls.set(cat.key, btn);
    }
    refreshCategoryTabSelection();
  }

  function refreshCategoryTabSelection() {
    for (const [key, btn] of categoryTabEls) {
      btn.classList.toggle("selected", key === activeCategory);
    }
  }

  // Break is pinned and always shown, regardless of the active category tab.
  function refreshToolbarVisibility() {
    for (const tool of TOOLS) {
      const btn = toolButtonEls.get(tool.tile);
      if (!btn) continue;
      const visible = tool.tile === TileType.Empty || tool.category === activeCategory;
      btn.style.display = visible ? "" : "none";
    }
  }

  function refreshToolbarSelection() {
    for (const [tile, btn] of toolButtonEls) {
      btn.classList.toggle("selected", tile === currentTool);
    }
  }

  function selectTool(tile: TileType) {
    currentTool = tile;
    if (tile !== TileType.TownCenter && !isRoadTile(tile)) placementGhost.visible = false;
    configurePlacementGhost(tile);
    refreshToolbarSelection();
    const def = TOOLS.find((t) => t.tile === tile);
    buildRequirementsEl.textContent = def && def.cost ? def.cost : "No requirements.";
  }

  setupToolbar();
  setupCategoryTabs();
  refreshToolbarVisibility();
  selectTool(currentTool);

  // ---- Unit selection (client-local; task forces are server-synced) ----

  let latestColonists: ColonistSnapshot[] = [];
  let latestMobs: MobSnapshot[] = [];
  let latestTaskForces: Record<string, string[]> = {};
  let selectedIds = new Set<string>();

  // Mirrors the server's isCommandable: of the bishops, only a Church's takes orders — the Ward
  // Priest (whose post is always the Ward Stone he's bound for) keeps his rounds, and Saint Wren's
  // Abbey clergy (posted at an AbbeyHall) aren't ours.
  function isCommandable(c: ColonistSnapshot): boolean {
    if (!COMMANDABLE_KINDS.has(c.kind)) return false;
    return c.kind !== "bishop" || tiles[c.postY * worldTilesX + c.postX] === TileType.ChurchPost;
  }

  function redrawSelectionRings() {
    selectionRings.clear();
    for (const c of latestColonists) {
      if (!selectedIds.has(c.id)) continue;
      selectionRings.circle(c.x, c.y, 12).stroke({ width: 2, color: SELECTION_COLOR });
    }
  }

  // Stance is only meaningful for guard-tier units, so bishops are left out of the readout (and of
  // the formation-spacing vote in groupStance).
  function refreshSelectionHud() {
    statSelectedEl.hidden = selectedIds.size === 0;
    const stances = new Set(
      latestColonists.filter((c) => selectedIds.has(c.id) && c.kind !== "bishop").map((c) => c.stance)
    );
    const single = stances.size === 1 ? [...stances][0] : null;
    commandBarEl.hidden = stances.size === 0;
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn"))) {
      b.classList.toggle("active", b.dataset.stance === single);
    }
    const stance = stances.size === 0 ? "" : single ? STANCE_LABEL[single] : "Mixed";
    const text = stance ? `Selected: ${selectedIds.size} · ${stance} (Z/X/E)` : `Selected: ${selectedIds.size}`;
    // Called every snapshot; only touch the DOM when the line actually changes.
    if (text === lastSelectionHudText) return;
    lastSelectionHudText = text;
    if (!single) {
      statSelectedEl.textContent = text;
      return;
    }
    const icon = document.createElement("img");
    icon.className = "econ-icon";
    icon.src = `/sprites/icon-stance-${single}.png`;
    icon.alt = "";
    statSelectedEl.replaceChildren(`Selected: ${selectedIds.size} · `, icon, ` ${stance} (Z/X/E)`);
  }
  let lastSelectionHudText = "";

  const commandBarEl = document.getElementById("command-bar")!;
  commandBarEl.addEventListener("click", (e) => {
    const stance = (e.target as HTMLElement).closest<HTMLElement>(".cmd-btn")?.dataset.stance as Stance | undefined;
    if (stance && selectedIds.size > 0) sendMessage({ type: "commandStance", unitIds: Array.from(selectedIds), stance });
  });
  // Keep a click on the bar from starting a map selection drag / deselecting.
  commandBarEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  function setSelection(ids: Iterable<string>) {
    selectedIds = new Set(ids);
    redrawSelectionRings();
    refreshSelectionHud();
  }

  function findNearest<T extends { x: number; y: number }>(
    list: T[],
    x: number,
    y: number,
    radius: number
  ): T | null {
    let best: T | null = null;
    let bestDist = radius * radius;
    for (const item of list) {
      const d = (item.x - x) ** 2 + (item.y - y) ** 2;
      if (d <= bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }

  interface FormationPlan {
    targets: Map<string, { x: number; y: number }>;
    spacing: number;
    // Unit facing (current centroid -> destination); the front row is centered on the destination.
    fx: number;
    fy: number;
    frontHalfWidth: number;
  }

  // Spreads a group move order into per-unit destinations: melee in front (closest to the
  // clicked point), archers behind them, healers behind that, with a reserved rear rank for a
  // future artillery-type unit. Units within a rank sit side by side, perpendicular to the
  // direction of travel. A single unit just goes straight to the clicked point.
  // One spacing per block (mixing per-unit spacing would break the grid): the most common stance
  // among the group's guard-tier units; a tie for most common, or no guard units at all, is "normal".
  function groupStance(units: ColonistSnapshot[]): Stance {
    const counts: Record<Stance, number> = { defensive: 0, normal: 0, aggressive: 0 };
    for (const u of units) if (u.kind !== "bishop") counts[u.stance]++;
    const top = Math.max(counts.defensive, counts.normal, counts.aggressive);
    const leaders = (Object.keys(counts) as Stance[]).filter((st) => counts[st] === top);
    return leaders.length === 1 ? leaders[0] : "normal";
  }

  // Recomputed from scratch on every order from the units' live positions (no remembered squad).
  function computeFormationTargets(
    units: ColonistSnapshot[],
    destX: number,
    destY: number
  ): FormationPlan {
    const result = new Map<string, { x: number; y: number }>();
    const spacing = tileSize * FORMATION_SPACING_TILES[groupStance(units)];
    if (units.length <= 1) {
      for (const u of units) result.set(u.id, { x: destX, y: destY });
      return { targets: result, spacing, fx: 1, fy: 0, frontHalfWidth: 0 };
    }

    let cx = 0;
    let cy = 0;
    for (const u of units) {
      cx += u.x;
      cy += u.y;
    }
    cx /= units.length;
    cy /= units.length;

    let fx = destX - cx;
    let fy = destY - cy;
    const flen = Math.hypot(fx, fy);
    if (flen < 1) {
      fx = 1;
      fy = 0;
    } else {
      fx /= flen;
      fy /= flen;
    }
    const px = -fy;
    const py = fx;

    const ranks = new Map<number, ColonistSnapshot[]>();
    for (const u of units) {
      const rank = FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
      const bucket = ranks.get(rank);
      if (bucket) bucket.push(u);
      else ranks.set(rank, [u]);
    }

    // Age of Empires-style box formation: each rank fills its own tight rectangular block (up
    // to FORMATION_MAX_ROW_WIDTH units per row, wrapping to further rows behind), rather than
    // one long single-file line — so a 10-pikeman front rank reads as a 5x2 block, not a row
    // ten units wide. Ranks stack front-to-back by how many rows the ranks ahead actually used.
    const sortedRanks = Array.from(ranks.keys()).sort((a, b) => a - b);
    let depthRows = 0;
    let frontHalfWidth = 0;
    for (const rank of sortedRanks) {
      const members = ranks.get(rank)!;
      // Hand out slots in the same spatial order units already stand in, so nobody walks across
      // a squadmate: the units furthest along the facing take the rank's front row, and within a
      // row, left-to-right (along p) maps to left-to-right. Assigning by array order instead sent
      // e.g. the leftmost unit to the rightmost slot, and mirrored every row on a turn.
      members.sort((a, b) => b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
      const n = members.length;
      const cols = Math.min(FORMATION_MAX_ROW_WIDTH, n);
      const rowCount = Math.ceil(n / cols);
      if (depthRows === 0) frontHalfWidth = ((cols - 1) / 2) * spacing;
      for (let row = 0; row < rowCount; row++) {
        const rowMembers = members
          .slice(row * cols, row * cols + cols)
          .sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py));
        const rowN = rowMembers.length;
        const depth = (depthRows + row) * spacing;
        rowMembers.forEach((u, i) => {
          const lateral = (i - (rowN - 1) / 2) * spacing;
          result.set(u.id, {
            x: destX - depth * fx + lateral * px,
            y: destY - depth * fy + lateral * py,
          });
        });
      }
      depthRows += rowCount;
    }
    return { targets: result, spacing, fx, fy, frontHalfWidth };
  }

  // Newest order number per unit. A rank's delayed commandMove is dropped for any unit that has
  // since been given another order (move or attack), so the tail of a staggered formation order
  // can never overwrite a quick re-order — while orders to other units are left alone.
  let orderCounter = 0;
  const unitOrder = new Map<string, number>();
  function stampOrder(ids: string[]): number {
    orderCounter++;
    for (const id of ids) unitOrder.set(id, orderCounter);
    return orderCounter;
  }

  // Ground marker at a formation's destination: a ring per slot, a line across the front row and
  // a chevron off its middle pointing the way the block will face. Drawn once per order; only its
  // alpha changes afterwards (see the ticker below).
  const formationMarker = new Graphics();
  let formationMarkerState: {
    ids: string[];
    shownAt: number;
    settleAfter: number;
    fadeFrom: number | null;
  } | null = null;

  function hideFormationMarker() {
    formationMarker.clear();
    formationMarkerState = null;
  }

  function showFormationMarker(plan: FormationPlan, destX: number, destY: number, dispatchMs: number) {
    const { fx, fy } = plan;
    const px = -fy;
    const py = fx;
    formationMarker.clear();
    formationMarker.alpha = 1;
    for (const pos of plan.targets.values()) {
      formationMarker.circle(pos.x, pos.y, 4).stroke({ width: 1.5, color: SELECTION_COLOR, alpha: 0.6 });
    }
    // Front edge sits half a slot ahead of the front row's centers.
    const edgeX = destX + fx * plan.spacing * 0.5;
    const edgeY = destY + fy * plan.spacing * 0.5;
    const half = plan.frontHalfWidth + 10;
    formationMarker
      .moveTo(edgeX - px * half, edgeY - py * half)
      .lineTo(edgeX + px * half, edgeY + py * half)
      .stroke({ width: 3, color: SELECTION_COLOR, alpha: 0.85 });
    const at = (along: number, across: number) => [edgeX + fx * along + px * across, edgeY + fy * along + py * across];
    formationMarker
      .poly([...at(16, 0), ...at(2, 11), ...at(7, 0), ...at(2, -11)])
      .fill(SELECTION_COLOR)
      .stroke({ width: 1.5, color: 0x0a1a24 });
    const now = performance.now();
    formationMarkerState = {
      ids: Array.from(plan.targets.keys()),
      shownAt: now,
      // Units only start walking once their (staggered) order reaches the server, so "everyone has
      // stopped" means nothing until the last rank's order has had a couple of ticks to land.
      settleAfter: now + Math.max(FORMATION_MARKER_MIN_MS, dispatchMs + 250),
      fadeFrom: null,
    };
  }

  app.ticker.add(() => {
    const s = formationMarkerState;
    if (!s) return;
    const now = performance.now();
    if (s.fadeFrom === null) {
      const ids = new Set(s.ids);
      // Settled = not walking to its slot any more: arrived (idle) or busy fighting/healing.
      const stillMarching = latestColonists.some((c) => ids.has(c.id) && c.state === "returning");
      if ((now >= s.settleAfter && !stillMarching) || now - s.shownAt > FORMATION_MARKER_MAX_MS) {
        s.fadeFrom = now;
      }
    }
    if (s.fadeFrom !== null) {
      const t = (now - s.fadeFrom) / FORMATION_MARKER_FADE_MS;
      if (t >= 1) hideFormationMarker();
      else formationMarker.alpha = 1 - t;
    }
  });

  // Custom-width formation: the player dragged a line on the ground; units spread evenly along it
  // (front rank first, further ranks in rows behind) facing away from where they are now.
  function computeLineFormationTargets(
    units: ColonistSnapshot[],
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): FormationPlan & { cx: number; cy: number } {
    const spacing = tileSize * FORMATION_SPACING_TILES[groupStance(units)];
    const dragLen = Math.hypot(bx - ax, by - ay);
    const ux = dragLen >= 1 ? (bx - ax) / dragLen : 1;
    const uy = dragLen >= 1 ? (by - ay) / dragLen : 0;
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    // Minimum frontage (see LINE_MAX_DEPTH_ROWS): a short drag is widened about its midpoint.
    const minCols = Math.min(units.length, Math.max(2, Math.ceil(units.length / LINE_MAX_DEPTH_ROWS)));
    const L = Math.max(dragLen, (minCols - 1) * spacing, 1);
    let ucx = 0;
    let ucy = 0;
    for (const u of units) {
      ucx += u.x;
      ucy += u.y;
    }
    ucx /= units.length;
    ucy /= units.length;
    // Front = the perpendicular pointing away from the units' current side of the line.
    let fx = -uy;
    let fy = ux;
    if ((cx - ucx) * fx + (cy - ucy) * fy < 0) {
      fx = -fx;
      fy = -fy;
    }
    const cols = Math.max(minCols, Math.min(units.length, Math.floor(L / spacing) + 1));
    const step = cols > 1 ? Math.min(L / (cols - 1), spacing * LINE_MAX_GAP) : 0;
    const ranks = new Map<number, ColonistSnapshot[]>();
    for (const u of units) {
      const rank = FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
      const bucket = ranks.get(rank);
      if (bucket) bucket.push(u);
      else ranks.set(rank, [u]);
    }
    const targets = new Map<string, { x: number; y: number }>();
    let depthRows = 0;
    for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
      const members = ranks.get(rank)!;
      members.sort((a, b) => b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
      const rowCount = Math.ceil(members.length / cols);
      for (let row = 0; row < rowCount; row++) {
        const rowMembers = members
          .slice(row * cols, row * cols + cols)
          .sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy));
        const depth = (depthRows + row) * spacing;
        rowMembers.forEach((u, i) => {
          const lateral = (i - (rowMembers.length - 1) / 2) * step;
          targets.set(u.id, { x: cx - depth * fx + lateral * ux, y: cy - depth * fy + lateral * uy });
        });
      }
      depthRows += rowCount;
    }
    return { targets, spacing, fx, fy, frontHalfWidth: ((cols - 1) * step) / 2, cx, cy };
  }

  function dispatchFormationMove(units: ColonistSnapshot[], destX: number, destY: number, order: number) {
    dispatchPlannedMove(units, computeFormationTargets(units, destX, destY), destX, destY, order);
  }

  function dispatchPlannedMove(units: ColonistSnapshot[], plan: FormationPlan, destX: number, destY: number, order: number) {
    const distToSlot = (u: ColonistSnapshot) => {
      const slot = plan.targets.get(u.id)!;
      return Math.hypot(slot.x - u.x, slot.y - u.y);
    };
    const queue = units.slice().sort((a, b) => distToSlot(a) - distToSlot(b));
    const step = Math.min(FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS / (queue.length - 1));
    queue.forEach((u, i) => {
      const send = () => {
        if (unitOrder.get(u.id) !== order) return;
        const pos = plan.targets.get(u.id)!;
        sendMessage({ type: "commandMove", unitIds: [u.id], x: pos.x, y: pos.y });
      };
      if (i === 0) send();
      else setTimeout(send, i * step);
    });
    showFormationMarker(plan, destX, destY, (queue.length - 1) * step);
  }

  // ---- Sound triggers driven by snapshots ----
  // colonist id -> its current work sound and when it next plays.
  const workSoundTimers = new Map<string, { key: string; next: number }>();
  const growledMobs = new Set<string>();
  let lastMyHp: number | null = null;
  let lastMyPos: { x: number; y: number; at: number } | null = null;
  let horseIdleSince = performance.now();
  let horseMoving = false;
  let lastAmbientScan = 0;
  // tile index -> {tile, at}: setTile requests we sent, so their tileUpdate can sound as ours.
  const pendingPlacements = new Map<number, { tile: number; at: number }>();

  function resetSoundState() {
    soundSuppressed = true;
    workSoundTimers.clear();
    growledMobs.clear();
    lastMyHp = null;
    lastMyPos = null;
    pendingPlacements.clear();
  }

  function soundOnSnapshot(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    sound.tileSize = tileSize;
    sound.setMusicMode(snap.isNight ? "night" : "day");
    const now = performance.now();
    const me = snap.players.find((p) => p.id === myId);
    if (me) {
      sound.setListener(me.x, me.y);
      if (lastMyHp !== null && me.hp < lastMyHp && !soundSuppressed) sound.play("player_hurt");
      lastMyHp = me.hp;

      let speed = 0;
      if (lastMyPos && now > lastMyPos.at) {
        speed = Math.hypot(me.x - lastMyPos.x, me.y - lastMyPos.y) / ((now - lastMyPos.at) / 1000);
        if (speed > HORSE_TELEPORT_SPEED) speed = 0;
      }
      // Snapshots can arrive bunched; only resample the speed every ~80 ms.
      if (!lastMyPos || now - lastMyPos.at >= 80) {
        lastMyPos = { x: me.x, y: me.y, at: now };
        const moving = speed > HORSE_MOVING_MIN_SPEED && !snap.isPaused;
        if (moving && !horseMoving && now - horseIdleSince > HORSE_WHINNY_IDLE_MS && Math.random() < HORSE_WHINNY_CHANCE) {
          sound.play("horse_whinny");
        }
        if (!moving && horseMoving) horseIdleSince = now;
        horseMoving = moving;
        const rate = Math.max(HORSE_RATE_MIN, Math.min(HORSE_RATE_MAX, speed / PLAYER_SPEED));
        sound.setLoop("horse", "horse_gallop", moving ? 1 : 0, rate);
      }

      if (now - lastAmbientScan >= AMBIENT_SCAN_MS) {
        lastAmbientScan = now;
        const r = SOUND_SILENT_RADIUS_TILES;
        const ptx = Math.floor(me.x / tileSize);
        const pty = Math.floor(me.y / tileSize);
        for (const loop of AMBIENT_TILE_LOOPS) {
          let best = Infinity;
          for (let ty = Math.max(0, pty - r); ty <= Math.min(worldTilesY - 1, pty + r); ty++) {
            for (let tx = Math.max(0, ptx - r); tx <= Math.min(worldTilesX - 1, ptx + r); tx++) {
              if (tiles[ty * worldTilesX + tx] !== loop.tile) continue;
              best = Math.min(best, Math.hypot(tx * tileSize + tileSize / 2 - me.x, ty * tileSize + tileSize / 2 - me.y));
            }
          }
          const level = best === Infinity ? 0 : proximityGain(best, 0, tileSize);
          sound.setLoop(loop.id, loop.key, level);
        }
      }
    }

    // Workers: one sound per work cycle each, phase-staggered so a whole village doesn't hit in sync.
    // Paused: the simulation is frozen, so nobody's working.
    const seen = new Set<string>();
    for (const c of snap.isPaused ? [] : snap.colonists) {
      seen.add(c.id);
      const key = workSoundKey(c);
      if (!key) {
        workSoundTimers.delete(c.id);
        continue;
      }
      const interval = WORK_SOUND_INTERVAL_MS[key] ?? 2000;
      const timer = workSoundTimers.get(c.id);
      if (!timer || timer.key !== key) {
        workSoundTimers.set(c.id, { key, next: now + Math.random() * interval * 0.5 });
        continue;
      }
      if (now < timer.next) continue;
      timer.next = now + interval;
      const volume =
        key === "craft_hammer" && tiles[c.postY * worldTilesX + c.postX] !== TileType.Blacksmith
          ? CRAFT_VOLUME_NON_SMITH
          : 1;
      sound.play(key, { x: c.x, y: c.y, volume });
    }
    for (const id of Array.from(workSoundTimers.keys())) if (!seen.has(id)) workSoundTimers.delete(id);

    // Mobs: maybe a growl the first time each comes within range (the per-key cooldown in sound.ts
    // keeps a whole wave from growling at once).
    const mobIds = new Set<string>();
    const growlRangePx = MOB_GROWL_RADIUS_TILES * tileSize;
    for (const m of snap.mobs) {
      mobIds.add(m.id);
      if (growledMobs.has(m.id) || !me) continue;
      if (Math.hypot(m.x - me.x, m.y - me.y) > growlRangePx) continue;
      growledMobs.add(m.id);
      if (!soundSuppressed && Math.random() < MOB_GROWL_CHANCE) sound.play("monster_growl", { x: m.x, y: m.y });
    }
    for (const id of Array.from(growledMobs)) if (!mobIds.has(id)) growledMobs.delete(id);
    soundSuppressed = false;
  }

  function soundOnEvent(category: GameEventCategory) {
    if (category === "night") sound.play("night_sting", { priority: true });
    else if (category === "dawn") {
      sound.play("dawn_chime", { priority: true });
      sound.play("church_bell", { priority: true, delay: DAWN_BELL_DELAY_S });
    } else if (category === "upgrade" || category === "milestone") sound.play("build_upgrade", { priority: true });
  }

  function soundOnTileUpdate(tileX: number, tileY: number, tile: number) {
    const index = tileY * worldTilesX + tileX;
    const prev = tiles[index] ?? TileType.Empty;
    if (prev === TileType.ConstructionSite && tile !== TileType.Empty && tile !== TileType.ConstructionSite) {
      // A construction finished (anyone's): the build sparkle and the placement thud.
      pendingPlacements.delete(index);
      const c = tileCenter(tileX, tileY);
      spawnFxAnim("build", c.x, c.y + tileSize / 2, 700);
      sound.play("build_place", { x: c.x, y: c.y });
      return;
    }
    const pending = pendingPlacements.get(index);
    if (!pending) return;
    // Our placement became a construction site: the sound waits for its completion.
    if (tile === TileType.ConstructionSite) {
      pendingPlacements.delete(index);
      return;
    }
    pendingPlacements.delete(index);
    if (performance.now() - pending.at > PLACEMENT_CONFIRM_MS || tile === TileType.Empty) return;
    const c = tileCenter(tileX, tileY);
    // Our placement landed: on bare ground it's a build; on an existing building that turned into a
    // different tile (House -> Big House, barracks -> castle) it's an upgrade.
    spawnFxAnim(prev !== TileType.Empty && prev !== tile ? "upgrade" : "build", c.x, c.y + tileSize / 2, 700);
    if (pending.tile !== tile) return;
    sound.play("build_place", { x: c.x, y: c.y });
  }

  // In-place level-ups (huts, workshops, mines, ...) keep their tile, so no tileUpdate arrives; the
  // server's "upgrade" event confirms one instead. Play the upgrade effect at our most recent pending
  // placement of a building onto the same building.
  function fxOnUpgradeEvent() {
    let best: { index: number; at: number } | null = null;
    const now = performance.now();
    for (const [index, pending] of pendingPlacements) {
      if (now - pending.at > PLACEMENT_CONFIRM_MS || tiles[index] !== pending.tile) continue;
      if (!best || pending.at > best.at) best = { index, at: pending.at };
    }
    if (!best) return;
    pendingPlacements.delete(best.index);
    const c = tileCenter(best.index % worldTilesX, Math.floor(best.index / worldTilesX));
    spawnFxAnim("upgrade", c.x, c.y + tileSize / 2, 700);
  }

  // ---- Building info panel (left-click a building; see the pointerup handler) ----
  // Buildings that open the panel. Walls, trees, rocks and forage keep the old left-click (break).
  const INFO_TILES = new Set<number>([
    TileType.TownCenter, TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.BarnPost,
    TileType.LumberjackPost, TileType.FarmPlot, TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3,
    TileType.ArcherPost, TileType.ArcherTower, TileType.Tower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost,
    TileType.Pasture, TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop,
    TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery,
    TileType.Tavern, TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
    TileType.HunterHut, TileType.ForagerHut, TileType.BuildersGuild, TileType.ConstructionSite,
    TileType.Gate,
  ]);
  const buildingPanelEl = document.getElementById("building-panel")!;
  const bpNameEl = document.getElementById("bp-name")!;
  const bpLevelEl = document.getElementById("bp-level")!;
  const bpStaffingEl = document.getElementById("bp-staffing")!;
  const bpHpEl = document.getElementById("bp-hp")!;
  const bpConstructionEl = document.getElementById("bp-construction")!;
  const bpBonusesEl = document.getElementById("bp-bonuses")!;
  const bpUpgradeRowEl = document.getElementById("bp-upgrade-row")!;
  const bpUpgradeBtn = document.getElementById("bp-upgrade") as HTMLButtonElement;
  const bpUpgradeCostEl = document.getElementById("bp-upgrade-cost")!;
  const bpRepairRowEl = document.getElementById("bp-repair-row")!;
  const bpRepairBtn = document.getElementById("bp-repair") as HTMLButtonElement;
  const bpRepairCostEl = document.getElementById("bp-repair-cost")!;
  // Walls & gates: the gate's lock (click cycles auto -> open -> closed).
  const bpGateRowEl = document.getElementById("bp-gate-row")!;
  const bpGateBtn = document.getElementById("bp-gate-lock") as HTMLButtonElement;
  const bpGateStateEl = document.getElementById("bp-gate-state")!;
  const GATE_LOCK_NEXT: Record<GateLock, GateLock> = { auto: "open", open: "closed", closed: "auto" };
  const GATE_LOCK_LABEL: Record<GateLock, string> = { auto: "Auto", open: "Locked open", closed: "Locked closed" };
  let shownGateLock: GateLock = "auto";
  // Tile the panel shows; re-requested every second while open so numbers stay live.
  let infoTile: { tx: number; ty: number } | null = null;
  const BUILDING_INFO_REFRESH_MS = 1000;

  function requestBuildingInfo() {
    if (infoTile) sendMessage({ type: "buildingInfo", tileX: infoTile.tx, tileY: infoTile.ty });
  }
  function openBuildingInfo(tx: number, ty: number) {
    infoTile = { tx, ty };
    requestBuildingInfo();
  }
  function closeBuildingInfo() {
    infoTile = null;
    buildingPanelEl.hidden = true;
  }
  function renderBuildingInfo(info: BuildingInfo) {
    bpNameEl.textContent = info.name;
    bpLevelEl.textContent = info.maxLevel > 1 ? `Lv ${info.level}/${info.maxLevel}` : "";
    bpStaffingEl.textContent = info.staffing;
    bpHpEl.hidden = info.hp === null;
    if (info.hp !== null) bpHpEl.textContent = `HP ${info.hp}/${info.maxHp}`;
    bpConstructionEl.hidden = info.construction === null;
    if (info.construction !== null) {
      const label = info.tile === TileType.ConstructionSite ? "Under construction" : "Upgrading";
      bpConstructionEl.textContent = `${label}: ${Math.round(info.construction * 100)}%`;
    }
    const items = info.bonuses.length > 0 ? info.bonuses : ["None yet"];
    bpBonusesEl.replaceChildren(
      ...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      })
    );
    bpUpgradeRowEl.hidden = info.upgrade === null;
    if (info.upgrade) {
      bpUpgradeBtn.disabled = !info.upgrade.enabled;
      bpUpgradeCostEl.textContent = info.upgrade.reason ? `${info.upgrade.cost} (${info.upgrade.reason})` : info.upgrade.cost;
    }
    bpRepairRowEl.hidden = info.repair === null;
    if (info.repair) {
      bpRepairBtn.disabled = !info.repair.enabled;
      bpRepairCostEl.textContent = info.repair.reason ? `${info.repair.cost} (${info.repair.reason})` : info.repair.cost;
    }
    bpGateRowEl.hidden = !info.gate;
    if (info.gate) {
      shownGateLock = info.gate.lock;
      bpGateBtn.textContent = `Lock: ${GATE_LOCK_LABEL[info.gate.lock]}`;
      bpGateStateEl.textContent = info.gate.overrun ? "Overrun!" : info.gate.open ? "Open" : "Closed";
    }
    buildingPanelEl.hidden = false;
  }
  bpGateBtn.addEventListener("click", () => {
    bpGateBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "setGateLock", tileX: infoTile.tx, tileY: infoTile.ty, lock: GATE_LOCK_NEXT[shownGateLock] });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpUpgradeBtn.addEventListener("click", () => {
    bpUpgradeBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "upgradeBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpRepairBtn.addEventListener("click", () => {
    bpRepairBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "repairBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  document.getElementById("bp-close")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    closeBuildingInfo();
  });
  window.setInterval(() => {
    if (infoTile && !buildingPanelEl.hidden) requestBuildingInfo();
  }, BUILDING_INFO_REFRESH_MS);

  // ---- Builders counter and game over ----
  const statBuildersEl = document.getElementById("stat-builders")!;
  const statRespawnEl = document.getElementById("stat-respawn")!;
  function refreshBuilderCount(colonists: ColonistSnapshot[], isNight: boolean) {
    let total = 0;
    let working = 0;
    for (const c of colonists) {
      if (c.kind !== "builder") continue;
      total++;
      if (!isNight && (c.state === "building" || c.state === "carrying" || c.state === "repairing" || c.state === "toRepair")) working++;
    }
    statBuildersEl.textContent = `Builders  ${working}/${total} working`;
  }
  const gameOverEl = document.getElementById("game-over")!;
  function refreshGameOver(me: PlayerSnapshot | undefined) {
    gameOverEl.hidden = !(me?.dead && latestTownCenters.length === 0);
  }
  document.getElementById("game-over-restart")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    sendMessage({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize });
  });

  // ---- Networking ----

  const socket = new WebSocket(SERVER_URL);

  const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
  const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;

  pauseBtn.addEventListener("click", () => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "pause" }));
    }
    pauseBtn.blur();
  });

  restartBtn.addEventListener("click", () => {
    restartBtn.blur();
    if (!window.confirm("Restart the world for everyone connected?")) return;
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize }));
    }
  });

  const eventFeedEl = document.getElementById("event-feed")!;
  const TOAST_SHOW_MS = 5000;
  const TOAST_FADE_MS = 600;
  const TOAST_DROP_MS = 200;
  const MAX_TOASTS = 5;

  function removeToast(toast: HTMLElement, cls: "fading" | "dropped", fadeMs: number) {
    if (toast.classList.contains("dropped") || toast.classList.contains("fading")) return;
    toast.classList.add(cls);
    window.setTimeout(() => toast.remove(), fadeMs);
  }

  // Newest on top. Past MAX_TOASTS the oldest still-live toast is dropped with a quick fade, so a
  // burst (a whole garrison dying at once) shows its latest few rather than flooding the screen.
  function pushEventToast(category: GameEventCategory, text: string) {
    const toast = document.createElement("div");
    toast.className = `event-toast event-${category}`;
    const icon = document.createElement("img");
    icon.className = "event-icon";
    // "raid" has no art of its own; it borrows the deserter icon (build/milestone the upgrade one, boss the death one).
    const iconName: Partial<Record<GameEventCategory, string>> = { raid: "deserter", build: "upgrade", milestone: "upgrade", boss: "death" };
    icon.src = `/sprites/icon-event-${iconName[category] ?? category}.png`;
    icon.alt = "";
    toast.append(icon, text);
    eventFeedEl.prepend(toast);
    const live = Array.from(eventFeedEl.children).filter(
      (el) => !el.classList.contains("dropped") && !el.classList.contains("fading")
    ) as HTMLElement[];
    for (const old of live.slice(MAX_TOASTS)) removeToast(old, "dropped", TOAST_DROP_MS);
    window.setTimeout(() => removeToast(toast, "fading", TOAST_FADE_MS), TOAST_SHOW_MS);
  }

  // ---- Goal tracker (top-right parchment card) and the Ogre Warlord's boss bar ----
  const goalTrackerEl = document.getElementById("goal-tracker")!;
  const goalStepEl = document.getElementById("goal-step")!;
  const goalTitleEl = document.getElementById("goal-title")!;
  const goalFillEl = document.getElementById("goal-progress-fill")!;
  const goalCountEl = document.getElementById("goal-progress-text")!;
  const GOAL_FLASH_MS = 1600;
  // -1 until the first snapshot after a welcome, so a load / restart never flashes.
  let lastGoalIndex = -1;
  let goalFlashTimer = 0;

  function syncGoal(goal: GoalSnapshot | undefined) {
    if (!goal) {
      goalTrackerEl.hidden = true;
      return;
    }
    goalTrackerEl.hidden = false;
    const done = goal.index >= goal.total;
    goalStepEl.textContent = done ? "Complete" : `${goal.index + 1} / ${goal.total}`;
    goalTitleEl.textContent = goal.title;
    goalFillEl.style.width = `${Math.round((Math.min(goal.progress, goal.target) / goal.target) * 100)}%`;
    goalCountEl.textContent = goal.target > 1 ? `${goal.progress} / ${goal.target}` : done ? "Victory" : "";
    goalTrackerEl.classList.toggle("goal-done", done);
    if (lastGoalIndex !== -1 && goal.index > lastGoalIndex) {
      goalTrackerEl.classList.remove("goal-flash");
      void goalTrackerEl.offsetWidth; // restart the animation
      goalTrackerEl.classList.add("goal-flash");
      window.clearTimeout(goalFlashTimer);
      goalFlashTimer = window.setTimeout(() => goalTrackerEl.classList.remove("goal-flash"), GOAL_FLASH_MS);
    }
    lastGoalIndex = goal.index;
  }

  const bossBarEl = document.getElementById("boss-bar")!;
  const bossBarNameEl = document.getElementById("boss-bar-name")!;
  const bossBarFillEl = document.getElementById("boss-bar-fill")!;
  // Shown while the Ogre Warlord is within this many tiles of the local player.
  const BOSS_BAR_RANGE_TILES = VISION_RADIUS_PLAYER * 1.5;

  function syncBossBar(mobs: MobSnapshot[], players: PlayerSnapshot[]) {
    const me = players.find((p) => p.id === myId);
    const warlord = mobs.find((m) => m.boss === "warlord");
    const near =
      !!me && !!warlord && Math.hypot(warlord.x - me.x, warlord.y - me.y) <= BOSS_BAR_RANGE_TILES * tileSize;
    bossBarEl.hidden = !near;
    if (!near || !warlord) return;
    bossBarNameEl.textContent = bossTitle(warlord.kind, "warlord");
    bossBarFillEl.style.width = `${Math.max(0, Math.min(100, (warlord.hp / warlord.maxHp) * 100)).toFixed(1)}%`;
  }

  let wasNight = false;
  socket.addEventListener("message", (event) => {
    const message: ServerMessage = JSON.parse(event.data);
    if (message.type === "welcome") {
      myId = message.id;
      if (pendingLoadSlot) {
        // Continue / Load Game: the save brings its own difficulty (no claim), then a fresh welcome.
        sendMessage({ type: "loadGame", slot: pendingLoadSlot });
        pendingLoadSlot = null;
      } else {
        // Claims the world's difficulty if nobody has yet (the server ignores it otherwise).
        sendMessage({ type: "setDifficulty", difficulty: preferredDifficulty, worldSize: preferredWorldSize });
      }
      sendMessage({ type: "listSaves" });
      setActiveDifficulty(message.difficulty);
      tileSize = message.tileSize;
      worldTilesX = message.worldTilesX;
      worldTilesY = message.worldTilesY;
      tiles = message.tiles;
      biomes = message.biomes;
      castleRuinTile = message.castleRuin ?? null;
      lastGoalIndex = -1;
      clearFightArrows();
      resetMinimap(message.explored);
      suppressDeathPoofs = true;
      resetSoundState();
      bloodOnNewGravestones = false;
      clearBlood();
      farmStages = new Map();
      buildingLevels = new Map();
      constructionSites = new Map();
      clearFires();
      siteOverlay.clear();
      clearWildlifeSprites();
      redrawGrid();
      latestTownCenters = [];
      syncTownCenterBars([]);
      worldLayer.addChild(siteOverlay);
      worldLayer.addChild(placementGhost);
      worldLayer.addChild(cursorHighlight);
      worldLayer.addChild(formationMarker);
      worldLayer.addChild(lineGuide);
      worldLayer.addChild(selectionRings);
      worldLayer.addChild(dragBox);
    } else if (message.type === "snapshot") {
      syncPlayers(message.players);
      syncColonists(message.colonists, message.isNight);
      syncMobs(message.mobs);
      suppressDeathPoofs = false;
      syncBuildingLevels(message.buildingLevels);
      syncFarmStages(message.farmStages);
      syncConstructionSites(message.constructionSites);
      syncDamagedBuildings(message.damagedBuildings);
      syncGates(message.gates);
      latestTownCenters = message.townCenters;
      syncTownCenterBars(message.townCenters);
      syncWildlife(message.wildlife);
      // Dawn wipes the blood, the same boundary at which the server clears the gravestones.
      if (wasNight && !message.isNight) clearBlood();
      wasNight = message.isNight;
      syncGravestones(message.gravestones);
      latestColonists = message.colonists;
      latestMobs = message.mobs;
      latestTaskForces = message.taskForces;
      const counts = { knight: 0, archer: 0, militia: 0, bishop: 0 };
      const alive = new Set<string>();
      for (const c of message.colonists) {
        if (!isCommandable(c)) continue;
        if (c.kind === "knight" || c.kind === "archer" || c.kind === "bishop") {
          counts[c.kind]++;
        } else if (c.kind === "militia" || c.kind === "spearman" || c.kind === "pikeman") {
          counts.militia++;
        }
        alive.add(c.id);
      }
      refreshWorkerCounts(message.colonists, message.isNight);
      statArmyEl.textContent = `Knights ${counts.knight}  Archers ${counts.archer}  Militia ${counts.militia}  Bishops ${counts.bishop}`;
      // Drop dead units from the selection so the count and commands stay accurate.
      const stillSelected = Array.from(selectedIds).filter((id) => alive.has(id));
      if (stillSelected.length !== selectedIds.size) {
        setSelection(stillSelected);
      } else {
        redrawSelectionRings();
        // Stance changes arrive by snapshot, not through setSelection.
        refreshSelectionHud();
      }
      refreshEconomyPanel(message);
      statPopEl.textContent = `${message.population}/${message.populationCap}`;
      setActiveDifficulty(message.difficulty);
      statTimeEl.textContent = message.isNight ? "Night" : "Day";
      sundialEl.classList.toggle("night", message.isNight);
      sundialHandEl.setAttribute("transform", `rotate(${message.cycleProgress * 360})`);
      if (message.dayFraction !== sundialDayFraction) {
        sundialDayFraction = message.dayFraction;
        // Pie slice over the night part of the cycle; 0 (dawn) is at 12 o'clock, clockwise.
        const a = sundialDayFraction * 2 * Math.PI;
        const r = 15;
        const largeArc = 1 - sundialDayFraction > 0.5 ? 1 : 0;
        sundialNightArcEl.setAttribute(
          "d",
          `M0 0 L${r * Math.sin(a)} ${-r * Math.cos(a)} A${r} ${r} 0 ${largeArc} 1 0 ${-r} Z`
        );
      }
      statHappinessEl.textContent = `Happiness: ${message.happiness}%`;
      // Thresholds mirror the server's desertion (35) and mutiny (15) lines. Colors are the
      // parchment-contrast tokens in index.html's :root.
      statHappinessEl.style.color =
        message.happiness < 15 ? "var(--mood-bad)" : message.happiness < 35 ? "var(--mood-warn)" : "var(--mood-good)";
      pausedBanner.visible = message.isPaused;
      pauseBtn.textContent = message.isPaused ? "Resume" : "Pause";
      nightOverlay.alpha = message.isNight ? 0.35 : 0;
      refreshGameOver(message.players.find((p) => p.id === myId));
      refreshBuilderCount(message.colonists, message.isNight);
      for (const effect of message.effects) spawnEffect(effect);
      syncFights(message.fights);
      drawMinimap(message.players, message.colonists, message.mobs);
      syncGoal(message.goal);
      // Long days: dawn/dusk respawn windows (cycle lengths come from the server, never hard-coded).
      if (message.respawn) {
        const r = message.respawn;
        const secs = Math.ceil(r.ticksToWindow / TICK_RATE);
        const eta = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
        statRespawnEl.textContent =
          r.waiting > 0
            ? `Reinforcements: ${r.waiting} waiting · ${r.nextWindow} in ${eta}`
            : `Next respawn window: ${r.nextWindow} in ${eta}`;
      }
      syncBossBar(message.mobs, message.players);
      soundOnSnapshot(message);
    } else if (message.type === "tileUpdate") {
      soundOnTileUpdate(message.tileX, message.tileY, message.tile);
      setTileLocal(message.tileX, message.tileY, message.tile);
      paintMinimapTile(message.tileY * worldTilesX + message.tileX);
    } else if (message.type === "event") {
      pushEventToast(message.category, message.text);
      if (message.category === "upgrade") fxOnUpgradeEvent();
      soundOnEvent(message.category);
    } else if (message.type === "explored") {
      markExplored(message.tiles);
    } else if (message.type === "buildingInfo") {
      if (!infoTile || infoTile.tx !== message.tileX || infoTile.ty !== message.tileY) return;
      if (message.info) renderBuildingInfo(message.info);
      else closeBuildingInfo();
    } else if (message.type === "saveList") {
      renderSavePanel(message.saves);
    } else if (message.type === "saveResult") {
      const name = SAVE_SLOT_NAMES[message.slot];
      if (message.ok && message.action === "save") pushEventToast("build", `Game saved to ${name}`);
      else if (!message.ok) pushEventToast("death", message.error ?? `Could not ${message.action} ${name}`);
    }
  });

  // Quick-save button: saves to the slot you last saved to (Slot 1 the first time), no dialog.
  function getLastSaveSlot(): SaveSlot {
    try {
      const v = localStorage.getItem("sworn.lastSaveSlot");
      if (v === "slot1" || v === "slot2" || v === "slot3") return v;
    } catch {
      /* ignore */
    }
    return "slot1";
  }
  function setLastSaveSlot(slot: SaveSlot) {
    try {
      localStorage.setItem("sworn.lastSaveSlot", slot);
    } catch {
      /* ignore */
    }
  }
  document.getElementById("save-btn")!.addEventListener("click", () => {
    sendMessage({ type: "saveGame", slot: getLastSaveSlot() });
  });

  // In-game Save Game section (top of the Settings modal): 3 manual slots, plus Load for every save.
  let latestSaves: SaveInfo[] = [];
  function renderSavePanel(saves: SaveInfo[]) {
    latestSaves = saves;
    const bySlot = new Map(saves.map((sv) => [sv.slot, sv]));
    renderSaveRows(
      document.getElementById("save-slot-list")!,
      (["slot1", "slot2", "slot3"] as SaveSlot[]).map((slot) => ({
        slot,
        info: bySlot.get(slot),
        buttons: [
          {
            label: "Save",
            onClick: () => {
              const existing = latestSaves.find((sv) => sv.slot === slot);
              if (existing && !window.confirm(`Overwrite ${SAVE_SLOT_NAMES[slot]} (${describeSave(existing)})?`)) return;
              setLastSaveSlot(slot);
              sendMessage({ type: "saveGame", slot });
            },
          },
        ],
      }))
    );
    renderSaveRows(
      document.getElementById("save-load-list")!,
      saves.map((sv) => ({
        slot: sv.slot,
        info: sv,
        buttons: [
          {
            label: "Load",
            secondary: true,
            onClick: () => {
              if (!window.confirm(`Load ${SAVE_SLOT_NAMES[sv.slot]} for everyone connected? Unsaved progress is lost.`)) return;
              sendMessage({ type: "loadGame", slot: sv.slot });
              document.getElementById("settings-modal")!.hidden = true;
            },
          },
        ],
      })),
      "No saves yet"
    );
  }
  // Refresh the list whenever the Settings modal opens (another player may have saved meanwhile).
  document.getElementById("settings-btn")!.addEventListener("click", () => sendMessage({ type: "listSaves" }));

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    keys.add(key);
    // Ctrl/Alt + digit is reserved for task forces; never let it change the build tool.
    if (e.ctrlKey || e.altKey) return;
    const match = TOOLS.find((t) => t.key === key);
    if (match) {
      if (match.tile !== TileType.Empty && match.category !== activeCategory) {
        activeCategory = match.category;
        refreshToolbarVisibility();
        refreshCategoryTabSelection();
      }
      selectTool(match.tile);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSelection([]);
      cancelLeftPress();
      cancelOrderPress();
      closeBuildingInfo();
      return;
    }
    const stance = STANCE_HOTKEYS[e.key.toLowerCase()];
    if (stance && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      if (selectedIds.size > 0) sendMessage({ type: "commandStance", unitIds: Array.from(selectedIds), stance });
      return;
    }
    // e.code is layout/modifier independent (Alt+1 can produce other e.key values on some OSes).
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (!digit || !(e.ctrlKey || e.altKey)) return;
    e.preventDefault();
    if (e.repeat) return;
    const slot = Number(digit[1]);
    if (e.ctrlKey) {
      if (selectedIds.size === 0) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({ type: "assignTaskForce", slot, unitIds: Array.from(selectedIds) })
        );
      }
    } else {
      setSelection(latestTaskForces[String(slot)] ?? []);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.repeat) {
      e.preventDefault();
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "attack" }));
        // Immediate feedback even when the swing hits nothing (no server effect then).
        if (myId) triggerPlayerAttackAnim(myId);
        sound.play("sword_swing");
      }
    }
  });

  function currentInput(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    return { dx, dy };
  }

  setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    const { dx, dy } = currentInput();
    socket.send(JSON.stringify({ type: "input", dx, dy }));
  }, 50);

  function pointerTile(clickX: number, clickY: number): { tileX: number; tileY: number } | null {
    const tileX = Math.floor(clickX / tileSize);
    const tileY = Math.floor(clickY / tileSize);
    if (tileX < 0 || tileY < 0 || tileX >= worldTilesX || tileY >= worldTilesY) return null;
    return { tileX, tileY };
  }

  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Left button is resolved on pointerup (it may become a drag-select); other buttons act on down.
  interface LeftPress {
    pointerId: number;
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    dragging: boolean;
  }
  let leftPress: LeftPress | null = null;
  // Right-button order in progress for a multi-unit selection (see computeLineFormationTargets).
  interface OrderPress {
    pointerId: number;
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    dragging: boolean;
    order: number;
  }
  let orderPress: OrderPress | null = null;
  const lineGuide = new Graphics();
  function cancelOrderPress() {
    if (orderPress && app.canvas.hasPointerCapture(orderPress.pointerId)) {
      app.canvas.releasePointerCapture(orderPress.pointerId);
    }
    orderPress = null;
    lineGuide.clear();
  }

  function cancelLeftPress() {
    if (leftPress && app.canvas.hasPointerCapture(leftPress.pointerId)) {
      app.canvas.releasePointerCapture(leftPress.pointerId);
    }
    leftPress = null;
    dragBox.clear();
  }

  app.canvas.addEventListener("pointerdown", (e) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / ZOOM;
    const y = (e.clientY - rect.top - worldLayer.position.y) / ZOOM;
    if (e.button === 0) {
      leftPress = {
        pointerId: e.pointerId,
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: x,
        worldY: y,
        dragging: false,
      };
      app.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2 && selectedIds.size > 0) {
      if (socket.readyState !== socket.OPEN) return;
      // latestColonists is replaced wholesale on every snapshot (20/s), so this is the units' live
      // positions at the moment of the order — a redirect mid-march re-faces from where they are.
      const units = latestColonists.filter((c) => selectedIds.has(c.id));
      const unitIds = units.map((u) => u.id);
      const order = stampOrder(unitIds);
      hideFormationMarker();
      const mob = findNearest(
        latestMobs.filter((m) => (m.x - x) ** 2 + (m.y - y) ** 2 <= mobHitRadius(m.kind, mobRenderScale(m)) ** 2),
        x,
        y,
        Infinity
      );
      if (mob) {
        socket.send(JSON.stringify({ type: "commandAttack", unitIds, mobId: mob.id }));
      } else if (units.length > 1) {
        // Wait for release: a click orders the normal block, a drag stretches a custom line.
        orderPress = { pointerId: e.pointerId, screenX: e.clientX, screenY: e.clientY, worldX: x, worldY: y, dragging: false, order };
        app.canvas.setPointerCapture(e.pointerId);
      } else {
        socket.send(JSON.stringify({ type: "commandMove", unitIds, x, y }));
      }
      return;
    }
    const tile = pointerTile(x, y);
    if (!tile) return;
    if (socket.readyState !== socket.OPEN) return;
    const value = e.button === 2 ? currentTool : TileType.Empty;
    if (value !== TileType.Empty) {
      pendingPlacements.set(tile.tileY * worldTilesX + tile.tileX, { tile: value, at: performance.now() });
    }
    socket.send(
      JSON.stringify({ type: "setTile", tileX: tile.tileX, tileY: tile.tileY, tile: value })
    );
  });

  app.canvas.addEventListener("pointerup", (e) => {
    if (e.button === 2 && orderPress && e.pointerId === orderPress.pointerId) {
      const press = orderPress;
      cancelOrderPress();
      // Units may have died or been deselected while the button was held.
      const units = latestColonists.filter((c) => selectedIds.has(c.id));
      if (units.length === 0 || unitOrder.get(units[0].id) !== press.order && !units.some((u) => unitOrder.get(u.id) === press.order)) return;
      const rect = app.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - worldLayer.position.x) / ZOOM;
      const y = (e.clientY - rect.top - worldLayer.position.y) / ZOOM;
      if (press.dragging && units.length > 1) {
        const plan = computeLineFormationTargets(units, press.worldX, press.worldY, x, y);
        dispatchPlannedMove(units, plan, plan.cx, plan.cy, press.order);
      } else if (units.length > 1) {
        dispatchFormationMove(units, press.worldX, press.worldY, press.order);
      }
      return;
    }
    if (e.button !== 0 || !leftPress || e.pointerId !== leftPress.pointerId) return;
    const press = leftPress;
    cancelLeftPress();
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / ZOOM;
    const y = (e.clientY - rect.top - worldLayer.position.y) / ZOOM;

    if (press.dragging) {
      const minX = Math.min(press.worldX, x);
      const maxX = Math.max(press.worldX, x);
      const minY = Math.min(press.worldY, y);
      const maxY = Math.max(press.worldY, y);
      setSelection(
        latestColonists
          .filter(
            (c) =>
              isCommandable(c) &&
              c.x >= minX &&
              c.x <= maxX &&
              c.y >= minY &&
              c.y <= maxY
          )
          .map((c) => c.id)
      );
      return;
    }

    const unit = findNearest(
      latestColonists.filter(isCommandable),
      x,
      y,
      UNIT_HIT_RADIUS
    );
    if (unit) {
      setSelection([unit.id]);
      return;
    }

    const tile = pointerTile(x, y);
    // Left-click on a building (any build tool but Demolish selected) opens its info panel instead of
    // breaking it; with Demolish selected it breaks as before. Garrison buildings also select their units.
    const tileValue = tile ? tiles[tile.tileY * worldTilesX + tile.tileX] : TileType.Empty;
    const showInfo = tile !== null && currentTool !== TileType.Empty && INFO_TILES.has(tileValue);
    if (showInfo) openBuildingInfo(tile.tileX, tile.tileY);
    if (tile && GARRISON_TILES.has(tileValue)) {
      setSelection(
        latestColonists
          .filter(
            (c) =>
              (c.kind === "knight" ||
                c.kind === "archer" ||
                c.kind === "militia" ||
                c.kind === "spearman" ||
                c.kind === "pikeman") &&
              c.postX === tile.tileX &&
              c.postY === tile.tileY
          )
          .map((c) => c.id)
      );
      return;
    }

    // Nothing selectable under the cursor: original left-click behaviour (break tile).
    setSelection([]);
    if (!tile || showInfo) return;
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({ type: "setTile", tileX: tile.tileX, tileY: tile.tileY, tile: TileType.Empty })
    );
  });

  app.canvas.addEventListener("pointercancel", (e) => {
    if (leftPress && e.pointerId === leftPress.pointerId) cancelLeftPress();
    if (orderPress && e.pointerId === orderPress.pointerId) cancelOrderPress();
  });

  app.canvas.addEventListener("pointermove", (e) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / ZOOM;
    const y = (e.clientY - rect.top - worldLayer.position.y) / ZOOM;
    if (orderPress && e.pointerId === orderPress.pointerId) {
      if (
        !orderPress.dragging &&
        Math.hypot(e.clientX - orderPress.screenX, e.clientY - orderPress.screenY) > DRAG_THRESHOLD_PX
      ) {
        orderPress.dragging = true;
      }
      if (orderPress.dragging) {
        const units = latestColonists.filter((c) => selectedIds.has(c.id));
        lineGuide.clear();
        if (units.length > 1) {
          const plan = computeLineFormationTargets(units, orderPress.worldX, orderPress.worldY, x, y);
          for (const pos of plan.targets.values()) {
            lineGuide.circle(pos.x, pos.y, 4).stroke({ width: 1.5, color: SELECTION_COLOR, alpha: 0.7 });
          }
          lineGuide
            .moveTo(orderPress.worldX, orderPress.worldY)
            .lineTo(x, y)
            .stroke({ width: 3, color: SELECTION_COLOR, alpha: 0.85 });
        }
      }
    }
    if (leftPress && e.pointerId === leftPress.pointerId) {
      if (
        !leftPress.dragging &&
        Math.hypot(e.clientX - leftPress.screenX, e.clientY - leftPress.screenY) > DRAG_THRESHOLD_PX
      ) {
        leftPress.dragging = true;
      }
      if (leftPress.dragging) {
        dragBox.clear();
        dragBox
          .rect(
            Math.min(leftPress.worldX, x),
            Math.min(leftPress.worldY, y),
            Math.abs(x - leftPress.worldX),
            Math.abs(y - leftPress.worldY)
          )
          .fill({ color: SELECTION_COLOR, alpha: 0.12 })
          .stroke({ width: 1.5, color: SELECTION_COLOR });
      }
    }
    cursorHighlight.clear();
    const tile = pointerTile(x, y);
    placementGhost.visible =
      !!tile && ((currentTool === TileType.TownCenter && !!TOWN_CENTER_MARKER_TEXTURE) || isRoadTile(currentTool));
    if (!tile) return;
    placementGhost.position.set(tile.tileX * tileSize + tileSize / 2, tile.tileY * tileSize + tileSize / 2);
    cursorHighlight
      .rect(tile.tileX * tileSize, tile.tileY * tileSize, tileSize, tileSize)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
  });
}

// Main menu: the game (and its server connection) only starts once Start is pressed. Settings are
// client-only prefs kept in localStorage, plus the Difficulty choice that's sent to the server on
// join. There is ONE settings panel: it lives in the main menu until Start, then moves into the
// in-game #settings-modal (opened by the Settings control button). "Menu" in-game reloads back here.
const DIFFICULTY_PREF_KEY = "sworn.difficulty";
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
// The menu choice: sent as setDifficulty after every welcome, and with an in-game Restart.
let preferredDifficulty: Difficulty = "normal";
// Map size (tiles per side) chosen in the menu; New Game / Restart regenerate the world at it.
const MAP_SIZE_PREF_KEY = "sworn.mapSize";
const MAP_SIZES = [64, 96, 160, 256, 384, 512];
// undefined until the player picks one: then the server keeps its own default (COLONY_WORLD_SIZE or 160).
let preferredWorldSize: number | undefined;
function renderMapSizeChoice(value: number | undefined) {
  document.querySelectorAll<HTMLButtonElement>("#set-mapsize button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(Number(btn.dataset.size) === (value ?? 160)));
  });
}
let gameStarted = false;
// The world's active difficulty as the server reports it (null until the first welcome).
let activeDifficulty: Difficulty | null = null;

function renderDifficultyChoice(value: Difficulty) {
  document.querySelectorAll<HTMLButtonElement>("#set-difficulty button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.difficulty === value));
  });
}

// Called from main() on every welcome/snapshot; cheap no-op unless the value changed.
function setActiveDifficulty(value: Difficulty) {
  if (value === activeDifficulty) return;
  activeDifficulty = value;
  document.getElementById("stat-difficulty")!.textContent = `${DIFFICULTY_LABEL[value]} difficulty`;
  if (gameStarted) renderDifficultyChoice(value);
}

const SAVE_SLOT_NAMES: Record<SaveSlot, string> = { autosave: "Autosave", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3" };

function describeSave(sv: SaveInfo): string {
  return `Day ${sv.dayIndex + 1} · ${sv.population} pop · ${DIFFICULTY_LABEL[sv.difficulty]}`;
}

// One parchment row per slot: name + day/population/difficulty + when, then its buttons.
function renderSaveRows(
  container: HTMLElement,
  rows: { slot: SaveSlot; info?: SaveInfo; buttons: { label: string; secondary?: boolean; onClick: () => void }[] }[],
  emptyText?: string
) {
  container.replaceChildren();
  if (rows.length === 0 && emptyText) {
    const empty = document.createElement("div");
    empty.className = "save-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "save-row";
    const text = document.createElement("span");
    text.textContent = SAVE_SLOT_NAMES[row.slot];
    const note = document.createElement("small");
    note.textContent = row.info
      ? `${describeSave(row.info)} · ${new Date(row.info.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
      : "Empty";
    text.append(note);
    const btns = document.createElement("span");
    btns.className = "save-btns";
    for (const b of row.buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      if (b.secondary) btn.className = "secondary";
      btn.addEventListener("click", () => {
        btn.blur();
        b.onClick();
      });
      btns.append(btn);
    }
    el.append(text, btns);
    container.append(el);
  }
}

function setupMainMenu() {
  const menu = document.getElementById("main-menu")!;
  const mainPanel = document.getElementById("menu-main")!;
  const settingsPanel = document.getElementById("menu-settings-panel")!;
  const settingsModal = document.getElementById("settings-modal")!;
  const settingsModalScroll = document.getElementById("settings-modal-scroll")!;
  const minimapBox = document.getElementById("set-minimap") as HTMLInputElement;
  const eventsBox = document.getElementById("set-events") as HTMLInputElement;
  const difficultySeg = document.getElementById("set-difficulty")!;
  const difficultyNote = document.getElementById("set-difficulty-note")!;

  const load = (key: string): boolean => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  };
  const save = (key: string, on: boolean) => {
    try {
      localStorage.setItem(key, on ? "on" : "off");
    } catch {
      /* private mode: setting just won't persist */
    }
  };
  const apply = () => {
    document.body.classList.toggle("hide-minimap", !minimapBox.checked);
    document.body.classList.toggle("hide-events", !eventsBox.checked);
  };
  // Sound: sliders/mute edit sound.volumes live (persisted by SoundManager). The AudioContext is
  // created on the first menu click (a user gesture), at the latest on Start.
  const volumeInputs: { el: HTMLInputElement; key: "master" | "music" | "sfx" }[] = [
    { el: document.getElementById("set-vol-master") as HTMLInputElement, key: "master" },
    { el: document.getElementById("set-vol-music") as HTMLInputElement, key: "music" },
    { el: document.getElementById("set-vol-sfx") as HTMLInputElement, key: "sfx" },
  ];
  const muteBox = document.getElementById("set-mute") as HTMLInputElement;
  for (const { el, key } of volumeInputs) {
    el.value = String(Math.round(sound.volumes[key] * 100));
    el.addEventListener("input", () => sound.setVolumes({ [key]: Number(el.value) / 100 }));
    // A sample at the new level once the slider is released.
    if (key !== "music") el.addEventListener("change", () => sound.play("ui_click", { cooldownMs: 0 }));
  }
  muteBox.checked = sound.volumes.muted;
  muteBox.addEventListener("change", () => sound.setVolumes({ muted: muteBox.checked }));
  document.addEventListener(
    "pointerdown",
    () => {
      if (!sound.unlocked) sound.unlock();
    },
    { capture: true }
  );
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, #build-panel-toggle, #economy-panel-toggle")) sound.play("ui_click");
  });

  minimapBox.checked = load("sworn.minimap");
  eventsBox.checked = load("sworn.events");
  apply();
  minimapBox.addEventListener("change", () => {
    save("sworn.minimap", minimapBox.checked);
    apply();
  });
  eventsBox.addEventListener("change", () => {
    save("sworn.events", eventsBox.checked);
    apply();
  });

  try {
    const stored = localStorage.getItem(DIFFICULTY_PREF_KEY);
    if (stored === "easy" || stored === "normal" || stored === "hard") preferredDifficulty = stored;
  } catch {
    /* default stays Normal */
  }
  renderDifficultyChoice(preferredDifficulty);
  try {
    const storedSize = Number(localStorage.getItem(MAP_SIZE_PREF_KEY));
    if (MAP_SIZES.includes(storedSize)) preferredWorldSize = storedSize;
  } catch {
    /* default stays Medium */
  }
  renderMapSizeChoice(preferredWorldSize);
  const mapSizeSeg = document.getElementById("set-mapsize")!;
  mapSizeSeg.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-size]");
    const value = Number(btn?.dataset.size);
    if (!MAP_SIZES.includes(value)) return;
    preferredWorldSize = value;
    renderMapSizeChoice(value);
    try {
      localStorage.setItem(MAP_SIZE_PREF_KEY, String(value));
    } catch {
      /* private mode: setting just won't persist */
    }
  });
  difficultySeg.addEventListener("click", (e) => {
    // Read-only once the game is running: the world's difficulty is fixed until a restart.
    if (gameStarted) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-difficulty]");
    const value = btn?.dataset.difficulty;
    if (value !== "easy" && value !== "normal" && value !== "hard") return;
    preferredDifficulty = value;
    renderDifficultyChoice(value);
    try {
      localStorage.setItem(DIFFICULTY_PREF_KEY, value);
    } catch {
      /* private mode: setting just won't persist */
    }
  });

  const closeModal = () => {
    settingsModal.hidden = true;
  };
  const startGame = (loadSlot: SaveSlot | null) => {
    pendingLoadSlot = loadSlot;
    sound.unlock();
    menu.hidden = true;
    gameStarted = true;
    // Hand the one settings panel over to the in-game modal.
    settingsModalScroll.appendChild(settingsPanel);
    settingsPanel.hidden = false;
    difficultySeg.classList.add("readonly");
    difficultySeg.setAttribute("aria-disabled", "true");
    difficultyNote.textContent = "Fixed for this world; a Restart uses your menu choice";
    document.getElementById("menu-back")!.textContent = "Close";
    if (activeDifficulty) renderDifficultyChoice(activeDifficulty);
    void main();
  };
  // New Game keeps the old Start behaviour (whatever world the server is running, menu difficulty).
  document.getElementById("menu-start")!.addEventListener("click", () => startGame(null));
  document.getElementById("menu-continue")!.addEventListener("click", () => startGame("autosave"));
  const loadPanel = document.getElementById("menu-load-panel")!;
  document.getElementById("menu-load")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    loadPanel.hidden = false;
  });
  document.getElementById("menu-load-back")!.addEventListener("click", () => {
    loadPanel.hidden = true;
    mainPanel.hidden = false;
  });
  // Continue / Load Game only show once the server reports saves (silently absent if it's down).
  fetch(SAVES_URL)
    .then((res) => res.json() as Promise<{ saves: SaveInfo[] }>)
    .then(({ saves }) => {
      if (gameStarted) return;
      document.getElementById("menu-continue")!.hidden = !saves.some((sv) => sv.slot === "autosave");
      document.getElementById("menu-load")!.hidden = saves.length === 0;
      renderSaveRows(
        document.getElementById("menu-load-list")!,
        saves.map((sv) => ({
          slot: sv.slot,
          info: sv,
          buttons: [{ label: "Load", onClick: () => startGame(sv.slot) }],
        }))
      );
    })
    .catch(() => {
      /* server unreachable: New Game only */
    });
  document.getElementById("menu-settings")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    settingsPanel.hidden = false;
  });
  document.getElementById("menu-back")!.addEventListener("click", () => {
    if (gameStarted) {
      closeModal();
      return;
    }
    settingsPanel.hidden = true;
    mainPanel.hidden = false;
  });
  document.getElementById("settings-btn")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    settingsModal.hidden = !settingsModal.hidden;
  });
  // Backdrop click or Escape closes; keys typed into the panel (arrows on a slider) don't reach the
  // game's movement/hotkey handlers on window.
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeModal();
  });
  settingsModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    e.stopPropagation();
  });
  // Escape with focus outside the panel (e.g. right after opening it).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.hidden) closeModal();
  });
  document.getElementById("menu-exit")!.addEventListener("click", () => {
    // Browsers only let a script close a tab it opened; otherwise show a goodbye line.
    window.close();
    document.getElementById("menu-bye")!.hidden = false;
  });
  document.getElementById("menu-btn")!.addEventListener("click", () => location.reload());
}

setupMainMenu();
