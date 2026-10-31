// World visuals: tile / building / site art, FX, wildlife, wounds, hunger marks, sprite sizes and the player recolour shader (split out of main.ts, no behaviour change).
import type { Container, Graphics, Sprite, Text } from "pixi.js";
import {
  type ColonistKind, FarmStage, type HeroClass, HUNGER_MARK_NAMES, type MobKind, mobSizeScale, type MobSnapshot, type
  RegimentClass, type SiteFaction, TileType, type WildlifeKind,
} from "@colony/shared/protocol";
import { artUrl, frameUrls } from "./unitVisuals";

// Sprite art per tile type. Empty (bare floor) is deliberately absent.
export const TILE_SPRITE_FILES: Partial<Record<TileType, string>> = {
  [TileType.TownCenter]: "townCenter",
  [TileType.Wall]: "woodWall",
  [TileType.StoneWall]: "stoneWall",
  [TileType.Gate]: "gateWoodClosed",
  [TileType.KnightPost]: "barracks",
  [TileType.CastleLevel2]: "castleLv2",
  [TileType.CastleLevel3]: "castleLv3",
  [TileType.Keep]: "castleKeep",
  [TileType.ArcherPost]: "archeryRange",
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
  // Phase H stand-ins (moat: tinted water; drawbridge: the gate) until the moat_* / drawbridge* art loads.
  [TileType.Moat]: "waterTile",
  [TileType.Drawbridge]: "gateWoodClosed",
  [TileType.RuinWall1]: "ruinWall1",
  [TileType.RuinWall2]: "ruinWall2",
  [TileType.RuinArch]: "stoneArch",
  [TileType.RuinStatue]: "statue",
  [TileType.RuinRubble]: "rubble",
  // Forts phase A: a fallen NPC wall (walkable): the ruin rubble art, flatter and greyed.
  [TileType.Rubble]: "rubble",
  // Forts phase B stand-ins (tinted, TILE_STANDIN_TINT) until dedicated art lands (TILE_OPTIONAL_ART).
  [TileType.Tent]: "militiaCamp",
  [TileType.SiteKeep]: "castleKeep",
  [TileType.RuinedKeep]: "rubble",
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
  // Cavalry & siege stand-ins, used only if stables / siegeWorkshop art is missing (TILE_OPTIONAL_ART).
  [TileType.Stables]: "castleLv2",
  [TileType.SiegeWorkshop]: "blacksmith",
};
// Dedicated art per tile (SPRITES.md #30-#32), loaded optionally: a file that exists replaces the
// TILE_SPRITE_FILES stand-in above and drops its tint; a missing one keeps the stand-in.
export const TILE_OPTIONAL_ART: Partial<Record<TileType, string>> = {
  [TileType.HunterHut]: "hunterHut",
  [TileType.ForagerHut]: "foragerHut",
  [TileType.BerryBush]: "berryBushRipe",
  [TileType.BerryBushPicked]: "berryBushPicked",
  [TileType.FruitTree]: "appleTreeRipe",
  [TileType.FruitTreePicked]: "appleTreePicked",
  [TileType.MushroomPatch]: "mushroomRipe",
  [TileType.MushroomPatchPicked]: "mushroomPicked",
  [TileType.Stables]: "stables",
  [TileType.SiegeWorkshop]: "siegeWorkshop",
  [TileType.Tent]: "siteTent",
  [TileType.SiteKeep]: "siteKeep",
  [TileType.RuinedKeep]: "ruinedKeep",
};
// Batch 2 (SPRITES.md #71 / #74 / #77), loaded optionally: fort tiles drawn per site faction (snapshot
// `sites` via siteOwners / the keep position): the razed keep (bandit wood / orc / human stone), the
// rebuild-to-capture scaffold (a Town Center construction site on a fort keep), camp tents (beige / green /
// red by faction, upright or long by position hash) and fallen-wall rubble (wood for bandit / orc forts,
// stone for human settlements). Missing files keep TILE_SPRITE_FILES / TILE_OPTIONAL_ART above.
export const SITE_KEEP_RUIN_ART: Record<SiteFaction, string> = { bandit: "keepRuinWood", orc: "keepRuinOrc", human: "keepRuinStone" };
export const SITE_TENT_ART: Record<SiteFaction, string[]> = {
  bandit: ["tentVertical", "tentHorizontal"],
  orc: ["tentVertical_green", "tentHorizontal_green"],
  human: ["tentVertical_red", "tentHorizontal_red"],
};
export const SITE_RUBBLE_ART = { wood: ["rubbleWood0", "rubbleWood1", "rubbleWood2"], stone: ["rubbleStone0", "rubbleStone1", "rubbleStone2"] };
export const KEEP_SCAFFOLD_ART = "keepScaffold";
// Minimap quest markers (SPRITES.md #81), optional: a missing file never completes, so the diamond stays.
export const QUEST_MARKER_IMAGES = (() => {
  const img = (name: string) => Object.assign(new Image(), { src: `/sprites/${name}.png` });
  return { fresh: img("ui-questNew"), active: img("ui-questActive") };
})();
export const SITE_VARIANT_ART_NAMES = [
  ...Object.values(SITE_KEEP_RUIN_ART),
  ...Object.values(SITE_TENT_ART).flat(),
  ...SITE_RUBBLE_ART.wood,
  ...SITE_RUBBLE_ART.stone,
  KEEP_SCAFFOLD_ART,
];
// Alternate looks picked per tile by a stable position hash (half the fruit trees are pear/plum).
export const TILE_OPTIONAL_ALT_ART: Partial<Record<TileType, string>> = {
  [TileType.FruitTree]: "pearTreeRipe",
  [TileType.FruitTreePicked]: "pearTreePicked",
};
// Connected walls & oriented gates (SPRITES.md #59-62), loaded optionally: 16 pieces per wall set,
// indexed by the neighbour mask N=1 E=2 S=4 W=8 (a same-material wall or a Gate connects), a damaged
// set shown below WALL_DAMAGED_PERMILLE HP, and gates per material x orientation x state. A set with
// any file missing falls back to the single woodWall / stoneWall / gateWood* art.
export const WALL_PIECE_SETS = ["woodWall", "stoneWall", "woodWallDmg", "stoneWallDmg"] as const;
export type WallPieceSet = (typeof WALL_PIECE_SETS)[number];
export const wallPieceUrl = (set: WallPieceSet, mask: number) => `/sprites/${set}_${String(mask).padStart(2, "0")}.png`;
export const GATE_ART_STATES = ["Closed", "Open", "Damaged", "Overrun"] as const;
export type GateArtState = (typeof GATE_ART_STATES)[number];
export const gateArtUrl = (material: "Wood" | "Stone", orient: "H" | "V", state: GateArtState) =>
  `/sprites/gate${material}${orient}${state}.png`;
// Moats & drawbridges (SPRITES.md #72 / #73, phase H), loaded optionally: 16 moat pieces by the mask of
// moat / drawbridge neighbours (N=1 E=2 S=4 W=8), the dig-site art, and drawbridges per orientation x state
// (H spans a north-south moat, V an east-west one). A missing piece set keeps the tinted water stand-in.
export const moatPieceUrl = (mask: number) => `/sprites/moat_${String(mask).padStart(2, "0")}.png`;
export const MOAT_DIGGING_URL = "/sprites/moatDigging.png";
export const DRAWBRIDGE_ART_STATES = ["Lowered", "Raised", "Damaged"] as const;
export type DrawbridgeArtState = (typeof DRAWBRIDGE_ART_STATES)[number];
export const drawbridgeArtUrl = (orient: "H" | "V", state: DrawbridgeArtState) => `/sprites/drawbridgeWood${orient}${state}.png`;
export const MOAT_ART_URLS = [
  ...Array.from({ length: 16 }, (_, mask) => moatPieceUrl(mask)),
  MOAT_DIGGING_URL,
  ...(["H", "V"] as const).flatMap((o) => DRAWBRIDGE_ART_STATES.map((st) => drawbridgeArtUrl(o, st))),
];
export const WALL_ART_URLS = [
  ...WALL_PIECE_SETS.flatMap((set) => Array.from({ length: 16 }, (_, mask) => wallPieceUrl(set, mask))),
  ...(["Wood", "Stone"] as const).flatMap((m) => (["H", "V"] as const).flatMap((o) => GATE_ART_STATES.map((s) => gateArtUrl(m, o, s)))),
];
// Same threshold as fire tier 2 (fireTier): below half HP a wall shows its damaged piece / gate.
export const WALL_DAMAGED_PERMILLE = 500;
// All connector pieces and gates come from one atlas at one pixel scale; drawing them all at this
// many atlas px per tile keeps their proportions, and a horizontal straight (~80px) spans ~1.2 tiles
// so neighbouring straights overlap instead of leaving a seam.
export const WALL_ART_PX_PER_TILE = 68;
// Multiplicative tints that tell a stand-in apart from the building/prop whose art it borrows.
export const TILE_STANDIN_TINT: Partial<Record<TileType, number>> = {
  [TileType.Rubble]: 0x9a9088,
  [TileType.Moat]: 0x7894a0,
  [TileType.Tent]: 0xc8a070,
  [TileType.SiteKeep]: 0xb08870,
  [TileType.RuinedKeep]: 0x807468,
  [TileType.HunterHut]: 0xa8c08a,
  [TileType.ForagerHut]: 0xf0c890,
  [TileType.BerryBush]: 0xff9a9a,
  [TileType.BerryBushPicked]: 0x8a9478,
  [TileType.FruitTree]: 0xffc890,
  [TileType.FruitTreePicked]: 0x9a9a84,
  [TileType.MushroomPatch]: 0xd8a080,
  [TileType.MushroomPatchPicked]: 0x8a8a70,
  [TileType.Stables]: 0xd8c0a0,
  [TileType.SiegeWorkshop]: 0xc8a888,
};
// Looping tile animations (client-side, cosmetic). All frames of a loop share one canvas, so the
// box-fit scale setTileSprite computes from frame 0 stays valid for every frame. One shared clock
// drives them all (see the ticker in main); `phased` loops offset each tile by a stable hash so
// neighbouring campfires don't flicker in lockstep, while water stays in sync across tiles.
export const TILE_ANIM: Partial<Record<TileType, { urls: string[]; frameMs: number; phased: boolean }>> = {
  [TileType.PropCampfire]: { urls: frameUrls("campfire", 4), frameMs: 140, phased: true },
  [TileType.PropLanternPost]: { urls: frameUrls("lanternPost", 4), frameMs: 200, phased: true },
  [TileType.Water]: { urls: frameUrls("waterTile", 4), frameMs: 450, phased: false },
};
// Damaged buildings (client, cosmetic): flame width (px) per fire tier 1-3 (campfire0-3 frames),
// the soot tint on the building art, a smoke puff (fx-poof) every FIRE_SMOKE_MS per building from tier
// 2, and a cap on simultaneous overlays.
export const FIRE_FLAME_WIDTH = [0, 12, 18, 26];
export const SOOT_TINT = 0x8c7c6c;
export const FIRE_SMOKE_MS = 1600;
export const MAX_FIRE_OVERLAYS = 80;
// Farm art per server stage (snapshot `farmStages`, FarmStage in protocol.ts). A stage with no entry
// (or whose file failed to load) shows the tile's normal TILE_SPRITE_FILES art.
export const FARM_STAGE_ART: Partial<Record<TileType, Partial<Record<FarmStage, string>>>> = {
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
export const TILE_LEVEL_ART: Partial<Record<TileType, string[]>> = {
  [TileType.HunterHut]: ["hunterHut", "hunterHutLv2", "hunterHutLv3"],
  [TileType.ForagerHut]: ["foragerHut", "foragerHutLv2", "foragerHutLv3"],
  [TileType.BuildersGuild]: ["buildersGuild", "buildersGuildLv2", "buildersGuildLv3"],
  // Lv3 reuses the Lv2 plaza: the keep art (castleKeep.png) now belongs to the separate Keep building.
  [TileType.TownCenter]: ["townCenterLv1", "townCenterLv2", "townCenterLv2"],
  [TileType.Stables]: ["stables", "stablesLv2", "stablesLv3"],
  // SPRITES.md #54: Lv2 Smithy, Lv3 Armoury.
  [TileType.Blacksmith]: ["blacksmith", "blacksmithLv2", "blacksmithLv3"],
  // Forts phase E (SPRITES.md #66): Trading Post Lv2 / Lv3.
  [TileType.GoldShop]: ["tradingPost", "tradingPostLv2", "tradingPostLv3"],
};
// Forts phase E (SPRITES.md #63-#66, optional): per-level trader wagon art (batch 2 sheet: 6 move frames,
// 1 hit frame, one shared canvas per level); until it lands, the cart prop tinted and sized by level (brown
// hand cart / green covered wagon / iron-grey caravan), bobbing as it rolls.
export const WAGON_ART_URLS = [1, 2, 3].map((l) => ({
  walk: frameUrls(`traderWagon${l}Walk`, 6),
  idle: artUrl(`traderWagon${l}Idle`),
  hit: frameUrls(`traderWagon${l}Hit`, 1),
}));
export const WAGON_STANDIN_TINT = [0xc8955a, 0x9cc27a, 0xa8b2c0];
export const WAGON_HEIGHT = [24, 30, 36];
export const WAGON_DANGER_COLORS = { safe: 0x6fd36a, risky: 0xf0a030, deadly: 0xe04040 } as const;
// SPRITES.md #53: a Blacksmith the server reports forging (snapshot `forgeBusy`) loops these frames (one
// shared canvas), only while it shows its level-1 look (Lv2 / Lv3 art stays static). Loaded optionally.
export const BLACKSMITH_FORGE_URLS = frameUrls("blacksmithForge", 4);
export const BLACKSMITH_FORGE_FRAME_MS = 180;
// The tiered Town Center art (a plaza on its own diamond patch) skips the box fit like
// townCenter.png does: rendered `widthTiles` wide, `anchor` (the patch's center, under the statue / the
// keep's gate court) pinned on the tile center.
export const TOWN_CENTER_LEVEL_FIT = [
  { widthTiles: 3, anchor: { x: 0.51, y: 0.62 } },
  { widthTiles: 3, anchor: { x: 0.51, y: 0.63 } },
  { widthTiles: 3, anchor: { x: 0.51, y: 0.63 } },
];
// Placement ghost while the Town Center tool is selected.
export const TOWN_CENTER_MARKER_URL = "/sprites/townCenterMarker.png";
// A construction site shows its target's art faded and tinted (plus a scaffold + progress bar overlay).
export const CONSTRUCTION_ALPHA = 0.45;
export const CONSTRUCTION_TINT = 0xd8b890;
// A hunter's deer kill lies on the ground this long before it leaves its blood stain.
export const DEER_FALLEN_URL = "/sprites/deerFallen.png";
export const DEER_FALLEN_MS = 2600;
// Indexed by GravestoneSnapshot.variant.
export const GRAVESTONE_URLS = ["/sprites/gravestone.png", "/sprites/gravestone2.png"];
// Rendered height in px: a little shorter than a colonist so it reads as a ground marker.
export const GRAVESTONE_HEIGHT = 20;
// Ambient critters (client-only, cosmetic: never sent to or known by the server, no collision, no
// interaction). Each client rolls its own on every welcome, so two players won't see the same crow.
// `size` is the rendered canvas width in px; counts scale with the eligible terrain area (one critter
// per `tilesPer` eligible tiles) and are capped. Deer used to live here too; they are now real server
// game (see WILDLIFE_ART).
export const WILDLIFE = {
  crow: { frames: frameUrls("crow", 4), size: 12, tilesPer: 1400, max: 14 },
  frog: { frames: frameUrls("frog", 3), size: 9, tilesPer: 60, max: 16 },
};
// Huntable server wildlife (snapshot `wildlife`). Each kind's own frames (SPRITES.md #33) load from
// WILDLIFE_OPTIONAL_URLS, rendered `size` px wide (first walk frame); if a set is missing, that kind
// falls back to the deer frames, scaled and tinted. `walk` plays while walking, `idle` (graze)
// while standing, and the faster `run` (deer: optional deerRun) while fleeing or charging.
export const DEER_WALK_URLS = frameUrls("deerWalk", 4);
export const DEER_GRAZE_URLS = frameUrls("deerGraze", 2);
export const WILDLIFE_ART: Record<WildlifeKind, { size: number; tint: number }> = {
  deer: { size: 26, tint: 0xffffff },
  rabbit: { size: 12, tint: 0xd8c4a8 },
  boar: { size: 24, tint: 0x6e4c38 },
  pheasant: { size: 11, tint: 0xd07a3c },
};
export const WILDLIFE_OPTIONAL_URLS: Record<WildlifeKind, { walk: string[]; idle: string[]; run: string[] }> = {
  deer: { walk: [], idle: [], run: frameUrls("deerRun", 4) },
  rabbit: { walk: frameUrls("rabbitWalk", 4), idle: frameUrls("rabbitIdle", 2), run: [] },
  boar: { walk: frameUrls("boarWalk", 4), idle: frameUrls("boarGraze", 2), run: [] },
  pheasant: { walk: frameUrls("pheasantWalk", 4), idle: [], run: frameUrls("pheasantFlap", 3) },
};
export const WILDLIFE_FRAME_MS = 160;
export const WILDLIFE_RUN_FRAME_MS = 90;
// Ground blood splatters (client-side, cosmetic). Variants 0/1/3 (small blob, medium splash, streak)
// mark melee hits; 2/4/5 (large splash, pool, faded pool) mark deaths. Rendered size is the longer
// side in px.
export const BLOOD_URLS = frameUrls("bloodSplatter", 6);
export const BLOOD_HIT_VARIANTS = [0, 1, 3];
export const BLOOD_DEATH_VARIANTS = [2, 4, 5];
export const BLOOD_HIT_SIZE = 12;
export const BLOOD_DEATH_SIZE = 22;
// Only some melee hits leave a stain, so a long brawl doesn't carpet the ground in one spot.
export const BLOOD_HIT_CHANCE = 0.35;
export const BLOOD_ALPHA = 0.6;
// Oldest stain is removed past this many; they're all cleared at dawn like the gravestones.
export const BLOOD_MAX = 80;
export const FX_URLS = {
  slash: "/sprites/fx-slash.png",
  spark: "/sprites/fx-spark.png",
  poof: "/sprites/fx-poof.png",
  arrow: "/sprites/fx-arrow.png",
};
// Gameplay VFX sheet 2: 4-frame one-shots, each set on one shared canvas.
export const FX_ANIM_URLS = {
  build: frameUrls("fx-build", 4),
  upgrade: frameUrls("fx-upgrade", 4),
  heal: frameUrls("fx-heal", 4),
  poison: frameUrls("fx-poison", 4),
  wardPulse: frameUrls("fx-wardPulse", 4),
  wardLapse: frameUrls("fx-wardLapse", 4),
};
// Catapult boulder (5 rock variants, one picked per shot) and its 4-frame dust impact (SPRITES.md #42),
// loaded optionally: missing files fall back to the tinted spark / poof.
export const BOULDER_URLS = frameUrls("fx-boulder", 5);
export const BOULDER_IMPACT_URLS = frameUrls("fx-boulderImpact", 4);
// Wound decals over damaged units: [light, bleeding, heavy], small for colonists/most mobs, Large for
// the big mobs. Thresholds are hp fractions (below the first = light, ... below the last = heavy).
export const WOUND_URLS = ["woundLight", "woundBleeding", "woundHeavy"].map((n) => `/sprites/${n}.png`);
export const WOUND_LARGE_URLS = ["woundLightLarge", "woundBleedingLarge", "woundHeavyLarge"].map((n) => `/sprites/${n}.png`);
export const WOUND_THRESHOLDS = [0.66, 0.4, 0.2];
// Rendered longer side (px): half a colonist's 28px height; mobs scale with their rendered size.
export const COLONIST_WOUND_SIZE = 14;
export const MOB_WOUND_SIZE_FACTOR = 0.55;
export const WOUND_LARGE_KINDS = new Set<MobKind>(["orc", "armoredOrc", "troll", "ogre"]);
// Ground-like tile art that should cover its tile exactly (flush, no overhang into neighbors)
// instead of the bottom-anchored max-box fit buildings use, and always sit under other tile art.
export const TILE_SPRITE_FILL_TILE = new Set<number>([TileType.Water, TileType.Road, TileType.CobbleRoad, TileType.Moat, TileType.Drawbridge]);
// Road autotile, by the mask of orthogonal road neighbours (N=1, E=2, S=4, W=8; Road and Cobble Road
// connect to each other): [art, clockwise quarter turns]. The delivered road-* files don't all match
// their names (straightH, tJunctionB and some dead ends/corners are drawn with other connections), so
// only the pieces whose art matches are used, rotated for the rest. Measured connections: deadEndT = N,
// straightV = N+S, cornerTL = E+S, cornerTR = S+W, tJunctionR = E+S+W, tJunctionL = N+E+W, cross = all.
export const ROAD_AUTOTILE: [string, number][] = [
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
export const COBBLE_STRAIGHT = "cobbleRoad";
export const COBBLE_FILL = "cobblePlaza";
export const ROAD_ART_URLS = Array.from(new Set([...ROAD_AUTOTILE.map(([n]) => n), COBBLE_STRAIGHT, COBBLE_FILL])).map(
  (n) => `/sprites/${n}.png`
);
// Hunger-marked elites: sigil over the mob, pulsing aura ellipse on the ground under it, a tinted name
// label, and the mob drawn MARKED_MOB_SCALE larger. Indexed by HungerMark (0 = none).
export const HUNGER_SIGIL_URLS = HUNGER_MARK_NAMES.map((n) => (n ? `/sprites/sigil-${n}.png` : ""));
export const HUNGER_AURA_URLS = HUNGER_MARK_NAMES.map((n) => (n ? `/sprites/aura-${n}.png` : ""));
export const HUNGER_LABEL_COLORS = [0xffffff, 0xff5a4a, 0x4fd8c0, 0xf0c050, 0xb080d0, 0xa8bccc, 0xe0d0b8];
export const HUNGER_SIGIL_SIZE = 16;
export const HUNGER_AURA_WIDTH = 40;
export const MARKED_MOB_SCALE = 1.25;
// Render scale of a mob: Hunger-marked x1.25, times mobSizeScale (scale pass: the kind's MOB_KIND_SCALE, so
// trolls / ogres read bigger, x the mob's own rolled size, x BOSS_RENDER_SCALE for Phase 5 bosses; the
// Warlord has its own art, WARLORD_URLS, sized so the boss scale lands it at ~1.6x an ogre). All stack.
export function mobRenderScale(m: MobSnapshot): number {
  return (m.mark ? MARKED_MOB_SCALE : 1) * mobSizeScale(m);
}
// Boss name labels and hp bars (the bar is the usual one, drawn this much bigger).
export const BOSS_LABEL_COLORS = { warlord: 0xf1c40f, elite: 0xf0a050 };
export const BOSS_HP_BAR_SCALE = { warlord: 2, elite: 1.5 };
// Battered armor: below this hp fraction, an idle (not walking/attacking) pikeman or armoured orc
// shows its static battered pose. The knight's walk/attack set is drawn in a much chunkier style
// than knightBattered.png, so swapping in that pose looked like a different unit; knights are
// tinted darker instead (BATTERED_TINT), as are the pose kinds whenever the battered art is missing.
export const BATTERED_HP_FRACTION = 0.5;
export const BATTERED_TINT = 0x9a948c;
export const BATTERED_POSE_URLS: Record<string, string> = {
  pikeman: "/sprites/pikemanBattered.png",
  armoredOrc: "/sprites/armoredOrcBattered.png",
};
export const BATTERED_TINT_KINDS = new Set<string>(["knight", "pikeman", "armoredOrc"]);
// Hero phase 3: the soldier art each hero class borrows (PLACEHOLDER) and the hero tint.
export const HERO_VISUAL_KIND: Record<HeroClass, ColonistKind> = { champion: "knight", marksman: "archer", mage: "bishop" };
// Strategy mode phase 2: card icon (/sprites/<kind>Walk0.png) of a regiment with no unit alive.
export const REGIMENT_ICON_KIND: Record<RegimentClass, ColonistKind> = {
  infantry: "militia", knights: "knight", archers: "archer", cavalry: "cavalry", clergy: "bishop",
  rams: "batteringRam", catapults: "catapult", hero: "knight", mixed: "knight",
};
export const HERO_TINT = 0xffe7a0;
// Hero phase 4: a Summon spell's skeleton militia (PLACEHOLDER: the militia art tinted bone-grey).
export const SUMMON_TINT = 0xb8c0d8;
// Extra scale on top of the max-box fit for small world-gen props, so a barrel or crate doesn't
// render the same size as a cottage. Unlisted tiles use 1 (unchanged).
export const TILE_SPRITE_SIZE_FACTOR: Partial<Record<TileType, number>> = {
  [TileType.Keep]: 1.8,
  [TileType.RuinStatue]: 0.7,
  [TileType.RuinRubble]: 0.75,
  [TileType.Rubble]: 0.55,
  [TileType.Tent]: 0.85,
  [TileType.SiteKeep]: 1.4,
  [TileType.RuinedKeep]: 1.1,
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
// Scale pass (2026-10-29): buildings drawn bigger than the box fit (on top of TILE_SPRITE_SIZE_FACTOR) so the
// world feels larger without changing the grid. The sprite overflows its one tile, still bottom-centre
// anchored on the tile's bottom edge and depth-sorted by tile row like all tile art; a click on the part that
// overflows into the row above still opens the building (see buildingTileAt).
export const BUILDING_VISUAL_SCALE: Partial<Record<TileType, number>> = {
  [TileType.House]: 1.3,
  [TileType.BigHouse]: 1.3,
  [TileType.HouseLevel2]: 1.3,
};
// Tile sprites fit a box this many tiles wide/tall (aspect preserved), bottom-center anchored
// on the tile's bottom edge so tall art (towers, castles, trees) rises into the row above.
export const TILE_SPRITE_MAX_WIDTH_TILES = 1.4;
export const TILE_SPRITE_MAX_HEIGHT_TILES = 2;
// The Town Center art is a whole plaza-with-buildings scene on its own ground patch, so it skips the
// box fit: a fixed 3.5-tile width (~2.25 tiles tall) reads as the colony's centerpiece, and the
// anchor is the patch's center (its isometric diamond's midpoint), pinned on the tile's center.
export const TOWN_CENTER_WIDTH_TILES = 3.5;
export const TOWN_CENTER_ANCHOR = { x: 0.51, y: 0.67 };

export interface EntityVisual {
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
  // Hero phase 3: heroes only, "Name · Lv N" above the HP bar.
  heroLabel?: Text;
  // Strategy mode phase 5: snapshot interpolation, from (fx, fy) to the snapshot position (tx, ty); every
  // part is drawn offset by (ox, oy) from where the snapshot sync put it (see interpBeforeSnapshot).
  ip?: { fx: number; fy: number; tx: number; ty: number; ox: number; oy: number };
}

export const COLONIST_KINDS: ColonistKind[] = [
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
  "cavalry",
  "batteringRam",
  "catapult",
  "wagon",
];
// Rendered heights (px); width follows each texture's aspect ratio.
export const COLONIST_SPRITE_HEIGHT = 28;
// Mounted knight on a horse, plus banner — should read as clearly bigger than a foot soldier,
// not just a little taller. 64 keeps the rider's own body close to colonist scale while the
// horse (and banner) make the whole thing noticeably larger, same uniform-scale texture either way.
// 68 for the animated set: its walk frames carry a taller banner than player.png did, and 68 keeps
// the horse and rider at the old on-screen size (~40px wide).
export const PLAYER_SPRITE_HEIGHT = 68;

// Cosmetic nature scatter on Plains floor tiles: roughly 1 in NATURE_DECOR_ONE_IN eligible tiles
// gets one of these, chosen by a stable hash of the tile position (no server involvement).
export const NATURE_DECOR_ONE_IN = 16;
export const NATURE_DECOR: { url: string; height: number }[] = [
  { url: "/sprites/tallGrass.png", height: 16 },
  { url: "/sprites/flowers1.png", height: 12 },
  { url: "/sprites/bush3.png", height: 18 },
];

// Stable pseudo-random in [0, 1) from tile coordinates (+ salt for independent rolls).
export function tileHash01(tx: number, ty: number, salt: number): number {
  let h = Math.imul(tx, 374761393) ^ Math.imul(ty, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Recolors the blue banner/barding of the player sprite to uTargetHue (0..1), keeping the
// source saturation/value so shading survives. Low-saturation pixels (armor, horse) are untouched.
// Written in PixiJS v8's filter GLSL convention (same as ColorMatrixFilter): no #version,
// `in`/`out vec4 finalColor`/`texture()`; GlProgram adds the version/WebGL1 shims itself.
export const PLAYER_RECOLOR_FRAG = `in vec2 vTextureCoord;

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
export function hexToHue(hex: number): number {
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
