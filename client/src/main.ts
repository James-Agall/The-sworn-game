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
} from "./protocol";
import { Biome, TILE_SIZE, TileType, VISION_RADIUS_COLONIST, VISION_RADIUS_PLAYER } from "./protocol";

const SERVER_URL = "ws://localhost:8080";

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
  { tile: TileType.Wall, label: "Wood Wall", key: "1", cost: "1 wood", category: "combat" },
  { tile: TileType.StoneWall, label: "Stone Wall", key: "2", cost: "1 rock", category: "combat" },
  { tile: TileType.LumberjackPost, label: "Lumberjack", key: "3", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.FarmPlot, label: "Farm", key: "4", cost: "Free, needs adjacent Barn", category: "farming" },
  { tile: TileType.KnightPost, label: "Hall of the Sworn", key: "5", cost: "10 iron + 5 rock (upgradeable)", category: "combat" },
  { tile: TileType.ArcherPost, label: "Archery Range", key: "6", cost: "10 wood (on Wall = Tower, upgradeable)", category: "combat" },
  { tile: TileType.IronMinePost, label: "Iron Mine", key: "7", cost: "Free, needs ore or adjacent mine (upgradeable)", category: "industry" },
  { tile: TileType.RockMinePost, label: "Quarry", key: "8", cost: "Free, needs ore or adjacent mine (upgradeable)", category: "industry" },
  { tile: TileType.Empty, label: "Demolish", key: "9", cost: "", category: "farming" },
  { tile: TileType.House, label: "Cottage", key: "h", cost: "10 wood", category: "civic" },
  { tile: TileType.BarnPost, label: "Barn", key: "b", cost: "15 wood (upgradeable)", category: "farming" },
  { tile: TileType.ChurchPost, label: "Church", key: "c", cost: "15 wood (upgradeable)", category: "civic" },
  // w/a/s/d are movement keys, so the farm hotkeys avoid them.
  { tile: TileType.Pasture, label: "Pasture (Meat)", key: "p", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.Orchard, label: "Orchard (Fruit)", key: "o", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.WoolFarm, label: "Sheep Pasture", key: "f", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.CottonFarm, label: "Hemp Field", key: "n", cost: "Free (upgradeable)", category: "farming" },
  {
    tile: TileType.TailorShop,
    label: "Tailor Shop",
    key: "t",
    cost: "10 wood + 5 iron (upgradeable). Crafts 1 Wool + 1 Cotton → 1 Clothes",
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
};

// Only military units take part in selection / commands / task forces.
const COMMANDABLE_KINDS = new Set<string>(["knight", "archer", "bishop", "militia", "spearman", "pikeman"]);
// Workers who vanish into their building/plot while on the job, instead of standing visibly on
// top of it. Guards/militia/bishop stay visible — you want to see your garrison standing watch.
const WORKER_KINDS = new Set<string>(["lumberjack", "farmer", "ironMiner", "rockMiner", "farmhand", "artisan"]);
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
// look, sprites may touch on diagonals); Aggressive spreads out.
const FORMATION_SPACING_TILES: Record<Stance, number> = {
  defensive: 0.9,
  normal: 1.25,
  aggressive: 1.5,
};
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
// Drives the sprite's rendered size (radius * MOB_SPRITE_SIZE_PER_RADIUS along the texture's
// longer side) and, if a texture is missing, the fallback colored circle.
const MOB_VISUALS: Record<MobKind, { color: number; radius: number }> = {
  goblin: { color: 0xa4c639, radius: 7 },
  wolf: { color: 0x8a8a8a, radius: 7.5 },
  goblinCrossbow: { color: 0x6b8e23, radius: 7 },
  orc: { color: 0x3d7a2a, radius: 9.5 },
  skeleton: { color: 0xe8e0c8, radius: 9.5 },
  armoredOrc: { color: 0x4a5a3a, radius: 11 },
  darkShaman: { color: 0x4b1f6b, radius: 8 },
  giantSpider: { color: 0x1e1a1e, radius: 8.5 },
  troll: { color: 0x3b4a2a, radius: 13 },
  ogre: { color: 0x8b5a2b, radius: 15 },
  banditClubman: { color: 0x6b4a2a, radius: 9 },
  banditArcher: { color: 0x5a5a3a, radius: 9 },
  // ~1.45x a regular bandit's footprint so the mini-boss reads as a step up at a glance.
  banditElite: { color: 0x7a2a2a, radius: 13 },
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
};
// Server colonist states that play the action cycle / the walk cycle. Any other state walks only
// while the colonist is actually moving (e.g. civilians sheltering), else shows the static pose.
const COLONIST_ACTION_STATES = new Set(["attacking", "gathering", "mining", "farming", "crafting", "healing", "warding"]);
const COLONIST_WALK_STATES = new Set(["engaging", "returning", "toResource", "toPost", "approaching", "patrolling"]);

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

function mobHitRadius(kind: MobKind): number {
  const radius = (MOB_VISUALS[kind] ?? MOB_VISUALS.goblin).radius;
  return Math.max(MOB_HIT_RADIUS, (radius * MOB_SPRITE_SIZE_PER_RADIUS) / 2);
}

// Sprite art per tile type. Empty (bare floor) is deliberately absent.
const TILE_SPRITE_FILES: Partial<Record<TileType, string>> = {
  [TileType.TownCenter]: "townCenter",
  [TileType.Wall]: "woodWall",
  [TileType.StoneWall]: "stoneWall",
  [TileType.KnightPost]: "barracks",
  [TileType.CastleLevel2]: "castleLv2",
  [TileType.CastleLevel3]: "castleLv3",
  [TileType.ArcherPost]: "archeryRange",
  [TileType.ArcherTower]: "archerTower",
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
};
// Mature-crop art, swapped in for the FarmPlot texture while the server reports a plot as ready.
const FARM_PLOT_READY_URL = "/sprites/farmPlotReady.png";
// Indexed by GravestoneSnapshot.variant.
const GRAVESTONE_URLS = ["/sprites/gravestone.png", "/sprites/gravestone2.png"];
// Rendered height in px: a little shorter than a colonist so it reads as a ground marker.
const GRAVESTONE_HEIGHT = 20;
const FX_URLS = {
  slash: "/sprites/fx-slash.png",
  spark: "/sprites/fx-spark.png",
  poof: "/sprites/fx-poof.png",
  arrow: "/sprites/fx-arrow.png",
};
// Ground-like tile art that should cover its tile exactly (flush, no overhang into neighbors)
// instead of the bottom-anchored max-box fit buildings use, and always sit under other tile art.
const TILE_SPRITE_FILL_TILE = new Set<number>([TileType.Water]);
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
];
// Rendered heights (px); width follows each texture's aspect ratio.
const COLONIST_SPRITE_HEIGHT = 28;
// Mounted knight on a horse, plus banner — should read as clearly bigger than a foot soldier,
// not just a little taller. 64 keeps the rider's own body close to colonist scale while the
// horse (and banner) make the whole thing noticeably larger, same uniform-scale texture either way.
const PLAYER_SPRITE_HEIGHT = 64;

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

async function main() {
  const app = new Application();
  await app.init({ background: "#1a1a1a", resizeTo: window });
  document.getElementById("app")!.appendChild(app.canvas);

  const colonistUrls = COLONIST_KINDS.map((kind) => `/sprites/${kind}.png`);
  const mobUrls = MOB_KINDS.map((kind) => MOB_SPRITE_URL_OVERRIDES[kind] ?? `/sprites/${kind}.png`);
  const tileSpriteEntries = Object.entries(TILE_SPRITE_FILES).map(
    ([tile, file]) => [Number(tile), `/sprites/${file}.png`] as const
  );
  // Extra variants not tied 1:1 to a TileType: extra Iron Ore looks and two grass-floor
  // textures, picked per-tile-position for visual variety instead of one fixed art per type.
  const EXTRA_URLS = [
    "/sprites/ironOre2.png",
    "/sprites/ironOre3.png",
    "/sprites/grassFloor1.png",
    "/sprites/grassFloor2.png",
    "/sprites/hillsFloor.png",
    "/sprites/swampFloor.png",
    ...NATURE_DECOR.map((d) => d.url),
    FARM_PLOT_READY_URL,
    ...GRAVESTONE_URLS,
    ...Object.values(FX_URLS),
  ];
  const ANIM_URLS = [
    ...Object.values(COLONIST_ANIM_URLS).flatMap((a) => [...a.walk, ...a.action]),
    ...Object.values(MOB_VARIANT_URLS).flatMap((variants) =>
      variants.flatMap((v) => [...(v.idle ? [v.idle] : []), ...(v.walk ?? []), ...(v.action ?? [])])
    ),
  ];
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
  const SWAMP_FLOOR_TEXTURE = loadedTextures["/sprites/swampFloor.png"];
  const NATURE_DECOR_TEXTURES = NATURE_DECOR.map((d) => ({ texture: loadedTextures[d.url], height: d.height }));
  const FARM_PLOT_READY_TEXTURE = loadedTextures[FARM_PLOT_READY_URL];
  const GRAVESTONE_TEXTURES = GRAVESTONE_URLS.map((url) => loadedTextures[url]);
  const FX_TEXTURES = {
    slash: loadedTextures[FX_URLS.slash],
    spark: loadedTextures[FX_URLS.spark],
    poof: loadedTextures[FX_URLS.poof],
    arrow: loadedTextures[FX_URLS.arrow],
  };
  // Frames within one set come from one source sheet, so they share a pixel scale: one constant
  // `scale` per set (sized from the first walk frame) keeps the body the same size while weapons
  // swing out, instead of re-fitting every frame's canvas to a fixed height.
  interface AnimSet {
    walk: Texture[];
    action: Texture[];
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
  interface AnimState {
    mode: "walk" | "action" | null;
    frame: number;
    ticksInFrame: number;
    lastX: number;
    lastY: number;
  }
  // Advances `anim` one snapshot tick; returns the frame to show, or null for the static pose.
  function stepAnim(anim: AnimState, set: AnimSet, mode: "walk" | "action" | null): Texture | null {
    if (mode !== anim.mode) {
      anim.mode = mode;
      anim.frame = 0;
      anim.ticksInFrame = 0;
    }
    if (!mode) return null;
    const sequence = mode === "walk" ? set.walk : set.action;
    anim.ticksInFrame++;
    if (anim.ticksInFrame >= ANIM_TICKS_PER_FRAME) {
      anim.ticksInFrame = 0;
      anim.frame = (anim.frame + 1) % sequence.length;
    }
    return sequence[anim.frame];
  }
  const colonistAnim = new Map<string, AnimState>();
  const mobAnim = new Map<string, AnimState>();
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
  // Pixel center of the Town Center tile, set once from `welcome` - same formula as the server's
  // own TOWN_CENTER_TILE (always dead center of the map).
  let townCenterPx = { x: 0, y: 0 };
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

  function syncGravestones(snapshot: GravestoneSnapshot[]) {
    const seen = new Set<string>();
    for (const g of snapshot) {
      const key = `${g.x},${g.y},${g.variant}`;
      seen.add(key);
      if (gravestoneSprites.has(key)) continue;
      const texture = GRAVESTONE_TEXTURES[g.variant];
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(GRAVESTONE_HEIGHT / texture.height);
      sprite.position.set(g.x, g.y + GRAVESTONE_HEIGHT / 2);
      decorSpriteLayer.addChild(sprite);
      gravestoneSprites.set(key, sprite);
    }
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
  // A welcome (join or world restart) wipes every entity at once; that isn't a mass death.
  let suppressDeathPoofs = true;
  let readyFarmPlots = new Set<number>();

  function syncReadyFarmPlots(indices: number[]) {
    const next = new Set(indices);
    const changed = [...readyFarmPlots].filter((i) => !next.has(i)).concat(indices.filter((i) => !readyFarmPlots.has(i)));
    readyFarmPlots = next;
    for (const index of changed) {
      if (tiles[index] !== TileType.FarmPlot) continue;
      setTileSprite(index % worldTilesX, Math.floor(index / worldTilesX), TileType.FarmPlot);
    }
  }

  const nightOverlay = new Graphics();
  nightOverlay.alpha = 0;
  worldLayer.addChild(nightOverlay);

  const townCenterHpBar = new Graphics();
  worldLayer.addChild(townCenterHpBar);

  const cursorHighlight = new Graphics();

  // World-space overlays: parented to worldLayer so they follow the camera automatically.
  const selectionRings = new Graphics();
  const dragBox = new Graphics();

  // Single source of truth for tileSpriteLayer: shows `tile`'s art at (tx, ty), or clears the
  // slot back to bare floor if it has none (Empty, anything unmapped).
  function setTileSprite(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    const texture =
      tile === TileType.IronOre
        ? IRON_ORE_VARIANTS[(tx * 7 + ty * 13) % IRON_ORE_VARIANTS.length]
        : tile === TileType.FarmPlot && readyFarmPlots.has(index)
          ? FARM_PLOT_READY_TEXTURE
          : TILE_TEXTURES.get(tile);
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
    if (tile === TileType.TownCenter) {
      sprite.anchor.set(TOWN_CENTER_ANCHOR.x, TOWN_CENTER_ANCHOR.y);
      sprite.scale.set((tileSize * TOWN_CENTER_WIDTH_TILES) / texture.width);
      sprite.position.set(tx * tileSize + tileSize / 2, ty * tileSize + tileSize / 2);
      sprite.zIndex = index;
      return;
    }
    sprite.anchor.set(0.5, 1);
    const fillTile = TILE_SPRITE_FILL_TILE.has(tile);
    const naturalScale = fillTile
      ? Math.max(tileSize / texture.width, tileSize / texture.height)
      : Math.min(
          (tileSize * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width,
          (tileSize * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height
        ) * (TILE_SPRITE_SIZE_FACTOR[tile as TileType] ?? 1);
    const minHeight = TILE_MIN_RENDER_HEIGHT.get(tile);
    const scale = minHeight ? Math.max(naturalScale, minHeight / texture.height) : naturalScale;
    sprite.scale.set(scale);
    sprite.position.set(tx * tileSize + tileSize / 2, (ty + 1) * tileSize);
    // Row-major index: lower rows draw in front of the rows above them; x breaks ties. Flush
    // ground-like tiles (water) go under all other tile art.
    sprite.zIndex = fillTile ? -1 : index;
  }

  // Floor never changes per-tile, so this only needs to run on a full map (re)load, not per edit.
  function setFloorSprites() {
    for (const s of floorSprites) s.destroy();
    floorSprites.length = 0;
    for (let x = 0; x < worldTilesX; x++) {
      for (let y = 0; y < worldTilesY; y++) {
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
        floorSpriteLayer.addChild(sprite);
        floorSprites.push(sprite);
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
      }
    }
    nightOverlay.clear();
    nightOverlay.rect(0, 0, worldTilesX * tileSize, worldTilesY * tileSize).fill(0x0a0a2a);
  }

  function setTileLocal(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    tiles[index] = tile;
    setTileSprite(tx, ty, tile);
    const decor = decorSprites.get(index);
    if (decor) decor.visible = tile === TileType.Empty;
  }

  function drawHpBar(bar: Graphics, hp: number, maxHp: number) {
    const width = 24;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
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
      map.delete(id);
    }
  }

  function pruneMissing(map: Map<string, EntityVisual>, seenIds: Set<string>, poofOnRemove = false) {
    for (const [id, entry] of Array.from(map)) {
      if (seenIds.has(id)) continue;
      if (poofOnRemove && !suppressDeathPoofs && entry.sprite.visible) {
        spawnDeathPoof(entry.sprite.position.x, entry.sprite.position.y);
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
    entry.marker?.position.set(p.x, p.y + PLAYER_SPRITE_HEIGHT * 0.4);
    // Just above the (taller) sprite's top edge instead of the old fixed -20.
    entry.hpBar.position.set(p.x, p.y - PLAYER_SPRITE_HEIGHT / 2 - 4);
    drawHpBar(entry.hpBar, p.hp, p.maxHp);
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(playerFacing, p.id, p.x));
  }

  function syncPlayers(snapshot: PlayerSnapshot[]) {
    const seenIds = new Set(snapshot.map((p) => p.id));
    pruneMissing(playerSprites, seenIds);
    pruneFacing(playerFacing, seenIds);
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
    // Civilians shelter at the Town Center at night (server: updateShelteringCivilian, same
    // TILE_SIZE*1.5 arrival radius) - once they've actually arrived, they should read as having
    // gone inside it, the same way a worker disappears into its own post above, not stand
    // visibly idling next to the flag all night.
    if (WORKER_KINDS.has(c.kind) && isNight) {
      if (Math.hypot(c.x - townCenterPx.x, c.y - townCenterPx.y) <= tileSize * 1.5) hidden = true;
    }
    entry.sprite.visible = !hidden;
    entry.hpBar.visible = !hidden;

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
        : COLONIST_WALK_STATES.has(c.state) || moved
          ? "walk"
          : null;
      const frame = stepAnim(anim, set, mode);
      // Idle pose = the walk cycle's own first frame, not the kind's separate static PNG: that
      // image was extracted independently and doesn't share the walk sheet's body-to-canvas
      // ratio, so using it here made units visibly pop in size on every idle<->walk/action
      // transition (i.e. every time they started or stopped moving).
      showAnimFrame(entry.sprite, set, frame ?? set.walk[0]);
    }
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(colonistFacing, c.id, c.x));
  }

  function syncColonists(snapshot: ColonistSnapshot[], isNight: boolean) {
    const seenIds = new Set(snapshot.map((c) => c.id));
    pruneMissing(colonistSprites, seenIds, true);
    for (const id of Array.from(colonistAnim.keys())) {
      if (!seenIds.has(id)) colonistAnim.delete(id);
    }
    pruneFacing(colonistFacing, seenIds);
    for (const c of snapshot) upsertColonist(c, isNight);
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
    const variants = MOB_VARIANTS[m.kind];
    if (variants) {
      upsertVariantMob(m, variants[stableHash(m.id) % variants.length]);
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
      sprite.scale.set(scale);
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    // Bar just above the sprite's top edge, matching the player's "height / 2 + 4" convention.
    const topOffset = texture ? (texture.height * scale) / 2 + 4 : visual.radius + 9;
    entry.hpBar.position.set(m.x, m.y - topOffset);
    drawHpBar(entry.hpBar, m.hp, m.maxHp);
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(mobFacing, m.id, m.x));
  }

  function upsertVariantMob(m: MobSnapshot, variant: MobVariant) {
    const entry = ensureVisual(mobSprites, m.id, () => {
      const sprite = new Sprite(variant.idle);
      sprite.anchor.set(0.5);
      sprite.scale.set(variant.idleScale);
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    entry.hpBar.position.set(m.x, m.y - (variant.idle.height * variant.idleScale) / 2 - 4);
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
    // showAnimFrame resets scale.x to a positive magnitude, so re-apply the flip after it.
    applyFacing(sprite, facingRight);
  }

  function syncMobs(snapshot: MobSnapshot[]) {
    const seenIds = new Set(snapshot.map((m) => m.id));
    pruneMissing(mobSprites, seenIds, true);
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

  function spawnDeathPoof(x: number, y: number) {
    const base = FX_SIZE.poof / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    addFx(FX_TEXTURES.poof, FX_SIZE.poof, x, y, 420, (s, t) => {
      s.scale.set(base * (0.7 + 0.5 * t));
      s.y = y - 6 * t;
      s.alpha = 1 - t;
    });
  }

  function spawnEffect(e: AttackEffect) {
    const angle = Math.atan2(e.toY - e.fromY, e.toX - e.fromX);
    if (e.melee) {
      const slash = addFx(FX_TEXTURES.slash, FX_SIZE.slash, e.toX, e.toY, 160, fadeOut);
      slash.rotation = angle;
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
    const projectile = addFx(
      isShaman ? FX_TEXTURES.spark : FX_TEXTURES.arrow,
      isShaman ? FX_SIZE.shamanBolt : FX_SIZE.arrow,
      e.fromX,
      e.fromY,
      durationMs,
      (s, t) => s.position.set(e.fromX + (e.toX - e.fromX) * t, e.fromY + (e.toY - e.fromY) * t),
      () => spawnImpactSpark(e.toX, e.toY, tint)
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

  app.ticker.add(() => {
    if (!myId) return;
    const mine = playerSprites.get(myId);
    if (!mine) return;
    worldLayer.position.set(
      app.screen.width / 2 - mine.sprite.position.x * ZOOM,
      app.screen.height / 2 - mine.sprite.position.y * ZOOM
    );
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
        return MINIMAP_TREE;
      case TileType.Rock:
        return MINIMAP_ROCK;
      case TileType.IronOre:
        return MINIMAP_IRON;
      case TileType.Wall:
      case TileType.StoneWall:
        return MINIMAP_WALL;
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

    const tcX = Math.floor(worldTilesX / 2);
    const tcY = Math.floor(worldTilesY / 2);
    if (tiles[tcY * worldTilesX + tcX] === TileType.TownCenter) {
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
        { key: "cotton", label: "Cotton" },
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
  const goodsListEl = document.getElementById("goods-list")!;
  for (const group of GOODS_GROUPS) {
    const heading = document.createElement("div");
    heading.className = "econ-heading";
    heading.textContent = group.heading;
    goodsListEl.appendChild(heading);
    for (const good of group.goods) {
      const row = document.createElement("div");
      row.className = "econ-row";
      const label = document.createElement("span");
      label.className = "econ-label";
      const icon = document.createElement("img");
      icon.className = "econ-icon";
      icon.src = `/sprites/icon-${good.key}.png`;
      icon.alt = "";
      label.append(icon, good.label);
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
    const stance =
      stances.size === 0 ? "" : stances.size === 1 ? STANCE_LABEL[[...stances][0]] : "Mixed";
    statSelectedEl.textContent = stance
      ? `Selected: ${selectedIds.size} · ${stance} (Z/X/E)`
      : `Selected: ${selectedIds.size}`;
  }

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

  function dispatchFormationMove(units: ColonistSnapshot[], destX: number, destY: number, order: number) {
    const plan = computeFormationTargets(units, destX, destY);
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
      socket.send(JSON.stringify({ type: "restart" }));
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
    toast.textContent = text;
    eventFeedEl.prepend(toast);
    const live = Array.from(eventFeedEl.children).filter(
      (el) => !el.classList.contains("dropped") && !el.classList.contains("fading")
    ) as HTMLElement[];
    for (const old of live.slice(MAX_TOASTS)) removeToast(old, "dropped", TOAST_DROP_MS);
    window.setTimeout(() => removeToast(toast, "fading", TOAST_FADE_MS), TOAST_SHOW_MS);
  }

  socket.addEventListener("message", (event) => {
    const message: ServerMessage = JSON.parse(event.data);
    if (message.type === "welcome") {
      myId = message.id;
      tileSize = message.tileSize;
      worldTilesX = message.worldTilesX;
      worldTilesY = message.worldTilesY;
      tiles = message.tiles;
      biomes = message.biomes;
      resetMinimap(message.explored);
      suppressDeathPoofs = true;
      readyFarmPlots = new Set();
      redrawGrid();
      townCenterPx = {
        x: Math.floor(worldTilesX / 2) * tileSize + tileSize / 2,
        y: Math.floor(worldTilesY / 2) * tileSize + tileSize / 2,
      };
      // Just above the Town Center art's top edge (its flag), which rises well above the tile.
      const tcTexture = TILE_TEXTURES.get(TileType.TownCenter)!;
      const tcArtAbove =
        ((tileSize * TOWN_CENTER_WIDTH_TILES) / tcTexture.width) * tcTexture.height * TOWN_CENTER_ANCHOR.y;
      townCenterHpBar.position.set(townCenterPx.x, townCenterPx.y - tcArtAbove - 6);
      worldLayer.addChild(cursorHighlight);
      worldLayer.addChild(formationMarker);
      worldLayer.addChild(selectionRings);
      worldLayer.addChild(dragBox);
    } else if (message.type === "snapshot") {
      syncPlayers(message.players);
      syncColonists(message.colonists, message.isNight);
      syncMobs(message.mobs);
      suppressDeathPoofs = false;
      syncReadyFarmPlots(message.readyFarmPlots);
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
      townCenterHpBar.visible = message.townCenterHp > 0;
      drawHpBar(townCenterHpBar, message.townCenterHp, message.townCenterMaxHp);
      for (const effect of message.effects) spawnEffect(effect);
      drawMinimap(message.players, message.colonists, message.mobs);
    } else if (message.type === "tileUpdate") {
      setTileLocal(message.tileX, message.tileY, message.tile);
      paintMinimapTile(message.tileY * worldTilesX + message.tileX);
    } else if (message.type === "event") {
      pushEventToast(message.category, message.text);
    } else if (message.type === "explored") {
      markExplored(message.tiles);
    }
  });

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
        latestMobs.filter((m) => (m.x - x) ** 2 + (m.y - y) ** 2 <= mobHitRadius(m.kind) ** 2),
        x,
        y,
        Infinity
      );
      if (mob) {
        socket.send(JSON.stringify({ type: "commandAttack", unitIds, mobId: mob.id }));
      } else if (units.length > 1) {
        dispatchFormationMove(units, x, y, order);
      } else {
        socket.send(JSON.stringify({ type: "commandMove", unitIds, x, y }));
      }
      return;
    }
    const tile = pointerTile(x, y);
    if (!tile) return;
    if (socket.readyState !== socket.OPEN) return;
    const value = e.button === 2 ? currentTool : TileType.Empty;
    socket.send(
      JSON.stringify({ type: "setTile", tileX: tile.tileX, tileY: tile.tileY, tile: value })
    );
  });

  app.canvas.addEventListener("pointerup", (e) => {
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
    if (tile && GARRISON_TILES.has(tiles[tile.tileY * worldTilesX + tile.tileX])) {
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
    if (!tile) return;
    if (socket.readyState !== socket.OPEN) return;
    socket.send(
      JSON.stringify({ type: "setTile", tileX: tile.tileX, tileY: tile.tileY, tile: TileType.Empty })
    );
  });

  app.canvas.addEventListener("pointercancel", (e) => {
    if (leftPress && e.pointerId === leftPress.pointerId) cancelLeftPress();
  });

  app.canvas.addEventListener("pointermove", (e) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / ZOOM;
    const y = (e.clientY - rect.top - worldLayer.position.y) / ZOOM;
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
    if (!tile) return;
    cursorHighlight
      .rect(tile.tileX * tileSize, tile.tileY * tileSize, tileSize, tileSize)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
  });
}

main();
