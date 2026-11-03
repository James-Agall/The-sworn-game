// Build tool definitions: categories and the toolbar list (split out of main.ts, no behaviour change).
import { BLACKSMITH_TOOLS_STOCK_CAP, buildCostText } from "@colony/shared/buildings";
import { TileType } from "@colony/shared/protocol";

export type ToolCategory = "combat" | "farming" | "industry" | "civic" | "trade";

export interface ToolDef {
  tile: TileType;
  label: string;
  key: string;
  cost: string;
  category: ToolCategory;
}

// Break has no category of its own — it's pinned so it's always visible regardless of
// which category tab is active (see refreshToolbarVisibility).
export const TOOL_CATEGORIES: { key: ToolCategory; label: string }[] = [
  { key: "farming", label: "Farming" },
  { key: "combat", label: "Combat" },
  { key: "industry", label: "Industry" },
  { key: "civic", label: "Civic" },
  { key: "trade", label: "Trade" },
];

export const TOOLS: ToolDef[] = [
  { tile: TileType.Wall, label: "Wood Wall", key: "1", cost: `${buildCostText(TileType.Wall)}. 200 HP`, category: "combat" },
  { tile: TileType.StoneWall, label: "Stone Wall", key: "2", cost: `${buildCostText(TileType.StoneWall)}. 900 HP`, category: "combat" },
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
  { tile: TileType.FarmPlot, label: "Farm", key: "4", cost: "Free, within 2 tiles of a Barn (up to 8 per Barn)", category: "farming" },
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
  { tile: TileType.BarnPost, label: "Barn", key: "b", cost: `${buildCostText(TileType.BarnPost)} (upgradeable)`, category: "farming" },
  { tile: TileType.ChurchPost, label: "Church", key: "c", cost: `${buildCostText(TileType.ChurchPost)} (upgradeable)`, category: "civic" },
  // w/a/s/d are movement keys, so the farm hotkeys avoid them.
  { tile: TileType.Pasture, label: "Pasture (Meat)", key: "p", cost: `${buildCostText(TileType.Pasture)}, 2x2 (the tile you place on is its top-left corner; upgradeable)`, category: "farming" },
  { tile: TileType.Orchard, label: "Orchard (Fruit)", key: "o", cost: "Free (upgradeable)", category: "farming" },
  { tile: TileType.WoolFarm, label: "Sheep Pasture", key: "f", cost: `${buildCostText(TileType.WoolFarm)}, 2x2 (the tile you place on is its top-left corner; upgradeable)`, category: "farming" },
  { tile: TileType.CottonFarm, label: "Hemp Field", key: "n", cost: "Free (upgradeable; walkable like a Farm Plot)", category: "farming" },
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
    cost: `${buildCostText(TileType.Blacksmith)} (upgradeable). Crafts 1 Iron + 1 Wood → 1 Tools, idles at ${BLACKSMITH_TOOLS_STOCK_CAP} tools`,
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
    cost: `${buildCostText(TileType.Bakery)} (upgradeable). Bakes 2 Flour → 2 Flatbread; a level-2 baker cultures a sourdough starter (~3 days), then bakes Bread`,
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
