// Build tool definitions: categories and the toolbar list (split out of main.ts, no behaviour change).
import {
  BARN_FARMERS_BY_LEVEL, BARN_FIELD_RADIUS_TILES, BLACKSMITH_TOOLS_STOCK_CAP, buildCostText, FIELDS_PER_FARMER, FOOD_OUTPUT_MULT, PASTURE_YIELDS,
} from "@colony/shared/buildings";
import { TileType } from "@colony/shared/protocol";
import { ROOM_TOOL_STONE, ROOM_TOOL_WOOD } from "@colony/shared/structures";
import {
  CROP_LABEL, ZONE_TOOL_ANIMAL, ZONE_TOOL_ERASE, ZONE_TOOL_HEMP, ZONE_TOOL_HOME, ZONE_TOOL_STOCKPILE, ZONE_TOOL_WHEAT,
} from "@colony/shared/zones";
import {
  ROOM_BARRACKS_MIN_BEDS, ROOM_BEAUTY_POINTS, ROOM_WARMTH_AREA_TILES, ROOM_WARMTH_PER_HEARTH, ROOM_WARMTH_PER_LAMP, ROOM_WORKBENCH_MAX,
  ROOM_WORKBENCH_SPEED,
} from "@colony/shared/rooms";

export type ToolCategory = "structure" | "zones" | "combat" | "farming" | "industry" | "civic" | "trade";

export interface ToolDef {
  tile: TileType;
  label: string;
  key: string;
  cost: string;
  category: ToolCategory;
  // Modular building phase 1: how a right-drag paints (blueprint orders, placeStructure): a straight wall line, a
  // filled rectangle, or a room outline. Without it a tool places one tile per click as before.
  drag?: "line" | "rect" | "room";
  // Modular building phase 3: retired from new play (Farm Plot, Hemp Field): shown only in creative mode.
  legacy?: boolean;
}

// Break has no category of its own — it's pinned so it's always visible regardless of
// which category tab is active (see refreshToolbarVisibility).
export const TOOL_CATEGORIES: { key: ToolCategory; label: string }[] = [
  { key: "farming", label: "Farming" },
  { key: "combat", label: "Combat" },
  { key: "industry", label: "Industry" },
  { key: "civic", label: "Civic" },
  { key: "trade", label: "Trade" },
  { key: "structure", label: "Structure" },
  { key: "zones", label: "Zones" },
];

// "Each batch: 240 meat + 2 hide" for a complete 2x2 pasture (x4 its per-tile PASTURE_YIELDS, x FOOD_OUTPUT_MULT).
function pastureYieldText(tile: TileType): string {
  const y = PASTURE_YIELDS[tile];
  if (!y) return "";
  const n = (v: number) => Math.round(v * 4 * FOOD_OUTPUT_MULT);
  const parts = [`${n(y.meat)} meat`, ...(y.wool ? [`${n(y.wool)} wool`] : []), ...(y.hide ? [`${n(y.hide)} hide`] : [])];
  return `Each batch: ${parts.join(" + ")}`;
}

export const TOOLS: ToolDef[] = [
  // Modular building phase 1: walls are the Structure section's wall pieces (right-drag paints a straight line).
  { tile: TileType.Wall, label: "Wood Wall", key: "1", cost: `${buildCostText(TileType.Wall)}. 200 HP. Right-drag paints a line`, category: "structure", drag: "line" },
  { tile: TileType.StoneWall, label: "Stone Wall", key: "2", cost: `${buildCostText(TileType.StoneWall)}. 900 HP. Right-drag paints a line`, category: "structure", drag: "line" },
  { tile: ROOM_TOOL_WOOD, label: "Wood Room", key: "", cost: `Right-drag a rectangle: wood wall outline (${buildCostText(TileType.Wall)} per tile). An enclosed room (up to 144 tiles inside, nothing but floor / beds) gets a roof`, category: "structure", drag: "room" },
  { tile: ROOM_TOOL_STONE, label: "Stone Room", key: "", cost: `Right-drag a rectangle: stone wall outline (${buildCostText(TileType.StoneWall)} per tile)`, category: "structure", drag: "room" },
  { tile: TileType.WoodDoor, label: "Wood Door", key: "", cost: `${buildCostText(TileType.WoodDoor)}. 160 HP. On ground or cut into a wall: opens for your people, shut to monsters until broken`, category: "structure" },
  { tile: TileType.StoneDoor, label: "Stone Door", key: "", cost: `${buildCostText(TileType.StoneDoor)}. 500 HP. Needs a Quarry`, category: "structure" },
  { tile: TileType.WoodWindow, label: "Wood Window", key: "", cost: `${buildCostText(TileType.WoodWindow)}. 120 HP. A wall piece (blocks like a wall); cut into a wall`, category: "structure", drag: "line" },
  { tile: TileType.StoneWindow, label: "Stone Window", key: "", cost: `${buildCostText(TileType.StoneWindow)}. 500 HP. Needs a Quarry`, category: "structure", drag: "line" },
  { tile: TileType.WoodFloor, label: "Wood Floor", key: "", cost: `${buildCostText(TileType.WoodFloor)} per tile. Right-drag fills a rectangle`, category: "structure", drag: "rect" },
  { tile: TileType.StoneFloor, label: "Stone Floor", key: "", cost: `${buildCostText(TileType.StoneFloor)} per tile. Needs a Quarry. Right-drag fills a rectangle`, category: "structure", drag: "rect" },
  { tile: TileType.Bed, label: "Bed", key: "", cost: `${buildCostText(TileType.Bed)}. In a roofed room: +1 population and a home for one (a bedroom with N beds = N slots)`, category: "structure" },
  // Modular building phase 2 (shared/src/rooms.ts): furniture sets a room's role and stats (click inside a room).
  { tile: TileType.Table, label: "Table", key: "", cost: `${buildCostText(TileType.Table)}. Table + Hearth in a room = kitchen / dining (meals: +happiness). Beauty +${ROOM_BEAUTY_POINTS[TileType.Table]}`, category: "structure" },
  { tile: TileType.Chair, label: "Chair", key: "", cost: `${buildCostText(TileType.Chair)}. Beauty +${ROOM_BEAUTY_POINTS[TileType.Chair]}`, category: "structure" },
  { tile: TileType.Chest, label: "Chest", key: "", cost: `${buildCostText(TileType.Chest)}. Makes a room a storeroom`, category: "structure" },
  { tile: TileType.Shelf, label: "Shelf", key: "", cost: `${buildCostText(TileType.Shelf)}. Makes a room a storeroom. Beauty +${ROOM_BEAUTY_POINTS[TileType.Shelf]}`, category: "structure" },
  { tile: TileType.Hearth, label: "Hearth", key: "", cost: `${buildCostText(TileType.Hearth)}. Needs a Quarry. Warmth +${ROOM_WARMTH_PER_HEARTH} (in a ${ROOM_WARMTH_AREA_TILES}-tile room); with a table: kitchen`, category: "structure" },
  { tile: TileType.Lamp, label: "Lamp", key: "", cost: `${buildCostText(TileType.Lamp)}. Needs an Iron Mine. Warmth +${ROOM_WARMTH_PER_LAMP}, beauty +${ROOM_BEAUTY_POINTS[TileType.Lamp]}`, category: "structure" },
  { tile: TileType.Rug, label: "Rug", key: "", cost: `${buildCostText(TileType.Rug)} per tile. Needs a Sheep Pasture. Beauty +${ROOM_BEAUTY_POINTS[TileType.Rug]}. Right-drag fills a rectangle`, category: "structure", drag: "rect" },
  { tile: TileType.Workbench, label: "Workbench", key: "", cost: `${buildCostText(TileType.Workbench)}. Makes a room a workshop; stations in it work +${Math.round(ROOM_WORKBENCH_SPEED * 100)}% faster per bench (up to ${ROOM_WORKBENCH_MAX})`, category: "structure" },
  { tile: TileType.Statue, label: "Statue", key: "", cost: `${buildCostText(TileType.Statue)}. Needs a Quarry. Beauty +${ROOM_BEAUTY_POINTS[TileType.Statue]}`, category: "structure" },
  { tile: TileType.WeaponRack, label: "Weapon Rack", key: "", cost: `${buildCostText(TileType.WeaponRack)}. Needs an Iron Mine. ${ROOM_BARRACKS_MIN_BEDS}+ beds and a rack in a room = barracks (soldiers' morale)`, category: "structure" },
  // Modular building phase 3 (shared/src/zones.ts): zones. Right-drag paints a rectangle (Shift: erases).
  { tile: ZONE_TOOL_WHEAT as TileType, label: "Wheat field", key: "", cost: `Growing zone, free. Idle villagers / Barn farmers till, sow, tend and harvest each tile; 4 tiles grow what a Farm Plot did (${CROP_LABEL.wheat})`, category: "zones", drag: "rect" },
  { tile: ZONE_TOOL_HEMP as TileType, label: "Hemp field", key: "", cost: `Growing zone, free: hemp for cloth (4 tiles = an old Hemp Field)`, category: "zones", drag: "rect" },
  { tile: ZONE_TOOL_STOCKPILE as TileType, label: "Stockpile", key: "", cost: "Storage zone, free: haulers bring loose goods (harvests) to the nearest stockpile whose filters take them. Set filters in the zone list", category: "zones", drag: "rect" },
  { tile: ZONE_TOOL_HOME as TileType, label: "Home area", key: "", cost: "Idle villagers stroll here instead of round the Town Center", category: "zones", drag: "rect" },
  { tile: ZONE_TOOL_ANIMAL as TileType, label: "Animal area", key: "", cost: "Placeholder for a later phase (animals in buildings): no effect yet", category: "zones", drag: "rect" },
  { tile: ZONE_TOOL_ERASE as TileType, label: "Erase zone", key: "", cost: "Right-drag removes zone tiles (any of your zones; the selected one only, if one is selected)", category: "zones", drag: "rect" },
  // Walls & gates (2026-10-23). Every letter is taken (and [ is the Tower), so the gate uses ].
  {
    tile: TileType.Gate,
    label: "Gate",
    key: "]",
    cost: `${buildCostText(TileType.Gate)}. 450 HP. Opens for your units, closed to monsters (lock it from its info panel); anyone may pass while it's open`,
    category: "combat",
  },
  // Moats & drawbridges (phase H): , and / are free keys. Right-drag lays a 4-connected moat line.
  {
    tile: TileType.Moat,
    label: "Moat",
    key: ",",
    cost: `${buildCostText(TileType.Moat)} per tile (5 s dig). Water no one can walk through (arrows fly over it); right-drag to dig a line. Demolish fills it`,
    category: "combat",
  },
  {
    tile: TileType.Drawbridge,
    label: "Drawbridge",
    key: "/",
    cost: `${buildCostText(TileType.Drawbridge)}, on a moat tile. 450 HP. A gate over the water: lowers for your units, raised against monsters (lock it from its info panel)`,
    category: "combat",
  },
  { tile: TileType.LumberjackPost, label: "Lumberjack", key: "3", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.FarmPlot, label: "Farm", key: "4", cost: `Free. Needs: a Barn nearby (its farmers tend fields within ${BARN_FIELD_RADIUS_TILES} tiles; no workers of its own). Retired: creative mode only (paint a Growing zone)`, category: "farming", legacy: true },
  { tile: TileType.KnightPost, label: "Hall of the Sworn", key: "5", cost: `${buildCostText(TileType.KnightPost)} (upgradeable)`, category: "combat" },
  { tile: TileType.ArcherPost, label: "Archery Range", key: "6", cost: `${buildCostText(TileType.ArcherPost)} (upgradeable)`, category: "combat" },
  // Cavalry & siege (2026-10-27): ; and ' are the last free keys.
  {
    tile: TileType.Stables,
    label: "Stables",
    key: ";",
    cost: `${buildCostText(TileType.Stables)} (upgradeable: 1/2/3 cavalry). Fast riders for the wings; x2 charge after 5 tiles in a straight line`,
    category: "combat",
  },
  {
    tile: TileType.SiegeWorkshop,
    label: "Siege Workshop",
    key: "'",
    cost: `${buildCostText(TileType.SiegeWorkshop)}. Builds battering rams and catapults (info panel), 2 population each, up to 2`,
    category: "combat",
  },
  // Keep (2026-10-28): every letter, digit and the other punctuation keys are taken, so it uses `.`.
  {
    tile: TileType.Keep,
    label: "Keep",
    key: ".",
    cost: `${buildCostText(TileType.Keep)}. One per settlement; needs a Town Center at level 2. Each level (upgradeable to 3) adds +10 to the settlement's soldier garrison (it does not raise the civilian population cap)`,
    category: "civic",
  },
  {
    tile: TileType.Tower,
    label: "Tower",
    key: "[",
    cost: `${buildCostText(TileType.Tower)}. Shoots the nearest monster within 7 tiles; no workers (upgradeable: faster, harder shots)`,
    category: "combat",
  },
  { tile: TileType.IronMinePost, label: "Iron Mine", key: "7", cost: "Free, on ore; place on a mine to upgrade", category: "industry" },
  { tile: TileType.RockMinePost, label: "Quarry", key: "8", cost: "Free, on ore; place on a mine to upgrade", category: "industry" },
  { tile: TileType.Empty, label: "Demolish", key: "9", cost: "", category: "farming" },
  { tile: TileType.House, label: "Cottage", key: "h", cost: `${buildCostText(TileType.House)} (+1 pop per adjacent house or workplace; +1 troop slot to each adjacent unit building; upgrade by placing on it)`, category: "civic" },
  { tile: TileType.BarnPost, label: "Barn", key: "b", cost: `${buildCostText(TileType.BarnPost)} (upgradeable). ${BARN_FARMERS_BY_LEVEL.join(" / ")} farmers by level: they tend old Farm / Hemp fields within ${BARN_FIELD_RADIUS_TILES} tiles, else work Growing zones (full speed). Food and cloth are hauled here when no stockpile takes them`, category: "farming" },
  { tile: TileType.ChurchPost, label: "Church", key: "c", cost: `${buildCostText(TileType.ChurchPost)} (upgradeable)`, category: "civic" },
  // w/a/s/d are movement keys, so the farm hotkeys avoid them.
  // Pasture animals (2026-11-06, shared PASTURE_YIELDS): the Pasture is the Cow pasture; pigs have no free hotkey.
  { tile: TileType.Pasture, label: "Cow pasture", key: "p", cost: `${buildCostText(TileType.Pasture)}, 2x2 (the tile you place on is its top-left corner; upgradeable). ${pastureYieldText(TileType.Pasture)}`, category: "farming" },
  { tile: TileType.PigPasture, label: "Pig pasture", key: "", cost: `${buildCostText(TileType.PigPasture)}, 2x2 (the tile you place on is its top-left corner; upgradeable). ${pastureYieldText(TileType.PigPasture)}`, category: "farming" },
  { tile: TileType.Orchard, label: "Orchard (Fruit)", key: "o", cost: `${buildCostText(TileType.Orchard)}, 2x2 (the tile you place on is its top-left corner; upgradeable)`, category: "farming" },
  { tile: TileType.WoolFarm, label: "Sheep Pasture", key: "f", cost: `${buildCostText(TileType.WoolFarm)}, 2x2 (the tile you place on is its top-left corner; upgradeable). ${pastureYieldText(TileType.WoolFarm)}`, category: "farming" },
  { tile: TileType.CottonFarm, label: "Hemp Field", key: "n", cost: `Free; walkable like a Farm Plot. Needs: a Barn nearby (tended by its farmers within ${BARN_FIELD_RADIUS_TILES} tiles). Retired: creative mode only (paint a Growing zone)`, category: "farming", legacy: true },
  {
    tile: TileType.HunterHut,
    label: "Hunter's Hut",
    key: "q",
    cost: `${buildCostText(TileType.HunterHut)} (place on it to upgrade: +1 hunter per level). Hunts wild game for meat by day`,
    category: "farming",
  },
  {
    tile: TileType.ForagerHut,
    label: "Forager's Hut",
    key: "y",
    cost: `${buildCostText(TileType.ForagerHut)} (place on it to upgrade: +1 forager per level). Picks wild berries, fruit and mushrooms by day`,
    category: "farming",
  },
  {
    tile: TileType.TailorShop,
    label: "Tailor Shop",
    key: "t",
    cost: `${buildCostText(TileType.TailorShop)} (upgradeable). Crafts 1 Wool + 1 Hemp → 1 Clothes`,
    category: "industry",
  },
  {
    tile: TileType.Blacksmith,
    label: "Blacksmith",
    key: "k",
    cost: `${buildCostText(TileType.Blacksmith)} (upgradeable). Needs a roofed room (build it inside walls + a door). Crafts 1 Iron + 1 Wood → 1 Tools, idles at ${BLACKSMITH_TOOLS_STOCK_CAP} tools`,
    category: "industry",
  },
  {
    tile: TileType.LuxuryWorkshop,
    label: "Jeweler's Workshop",
    key: "l",
    cost: `${buildCostText(TileType.LuxuryWorkshop)} (upgradeable). Crafts 1 Rock + 1 Fruit → 1 Luxury Item`,
    category: "industry",
  },
  // Progression tree phase 3: the metal chain (z / x were free).
  {
    tile: TileType.CharcoalBurner,
    label: "Charcoal Burner",
    key: "z",
    cost: `${buildCostText(TileType.CharcoalBurner)} (upgradeable). Burns 6 Wood → 3 Charcoal (slow)`,
    category: "industry",
  },
  {
    tile: TileType.Bloomery,
    label: "Bloomery",
    key: "x",
    cost: `${buildCostText(TileType.Bloomery)} (level 2+: Blast furnace). Smelts 3 Iron + 2 Charcoal → Iron bloom; casts the anvil, hammer & tongs a Blacksmith needs`,
    category: "industry",
  },
  // Phase 4: food. No free key left for these two (key "": button only).
  {
    tile: TileType.Mill,
    label: "Mill",
    key: "",
    cost: `${buildCostText(TileType.Mill)} (upgradeable). Grinds 2 Grain → 2 Flour`,
    category: "farming",
  },
  {
    tile: TileType.Bakery,
    label: "Bakery",
    key: "",
    cost: `${buildCostText(TileType.Bakery)} (upgradeable). Needs a roofed room (build it inside walls + a door). Bakes 2 Flour → 2 Flatbread; a level-2 baker cultures a sourdough starter (~3 days), then bakes Bread`,
    category: "farming",
  },
  { tile: TileType.Market, label: "Bazaar", key: "m", cost: buildCostText(TileType.Market), category: "trade" },
  { tile: TileType.GoldShop, label: "Trading Post", key: "g", cost: buildCostText(TileType.GoldShop), category: "trade" },
  {
    tile: TileType.Brewery,
    label: "Brewery",
    key: "r",
    cost: `${buildCostText(TileType.Brewery)} (upgradeable). Brews 2 Grain → 1 Alcohol`,
    category: "industry",
  },
  {
    tile: TileType.Tavern,
    label: "Tavern",
    key: "v",
    cost: `${buildCostText(TileType.Tavern)} (upgradeable). Sells 1 Alcohol → 10 Gold. Raises happiness within 6 tiles`,
    category: "trade",
  },
  { tile: TileType.MilitiaPost, label: "Militia Camp", key: "j", cost: `${buildCostText(TileType.MilitiaPost)} (upgradeable)`, category: "combat" },
  {
    tile: TileType.WardStone,
    label: "Ward Stone",
    key: "u",
    cost: `${buildCostText(TileType.WardStone)}. Its Bishop keeps the Unbroken Watch: nothing within 12 tiles can be targeted by monsters while he stands vigil`,
    category: "civic",
  },
  {
    tile: TileType.BuildersGuild,
    label: "Builders' Guild",
    key: "i",
    cost: `${buildCostText(TileType.BuildersGuild)} (place on it to upgrade: +1 builder per level). Builders raise every new building and upgrade`,
    category: "civic",
  },
  {
    tile: TileType.TownCenter,
    label: "Town Center",
    key: "0",
    cost: `${buildCostText(TileType.TownCenter)}, 12+ tiles from other Town Centers and ruins/camps (place on one to upgrade: +5% output and damage per level). Built at once if none stands`,
    category: "civic",
  },
  // Every letter is taken (tools, wasd movement, z/x/e stances), so roads use - and =.
  { tile: TileType.Road, label: "Road", key: "-", cost: `${buildCostText(TileType.Road)}. Colonists and you move 25% faster on roads`, category: "civic" },
  { tile: TileType.CobbleRoad, label: "Cobble Road", key: "=", cost: `${buildCostText(TileType.CobbleRoad)}. A paved road (same 25% speed bonus)`, category: "civic" },
];
