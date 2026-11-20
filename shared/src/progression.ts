// Natural progression tree (docs/colony2d/PLAN-progression-tree.md; ROADMAP "Progression tree — landed").
// PROGRESSION is the one source of truth for items, recipes, quality grades, professions and what each building
// requires. The server checks placements / upgrades / crafts against it (server/src/progression.ts); the client
// builds its locked "needs: X" build-menu text, Next steps and Craft-by-hand panel from the server's
// `progression` snapshot, which is computed from this table.
import { TileType } from "./protocol.js";
import { MINE_IRON_RESERVE } from "./mines.js";
import { LEAD_GLAZE_GRADE_BONUS, MINT_COINS_PER_BATCH } from "./industry.js";

export type ItemId =
  | "stoneAxe" | "stonePick" | "stoneKnife" | "timberProps" | "hide" | "bellows"
  | "charcoal" | "ironBloom" | "anvil" | "smithTools"
  | "woodenPlow" | "millstone" | "clayOven" | "flour" | "gruel" | "flatbread" | "sourdoughStarter" | "bread"
  // Stardew phase 5a: the hero's farming tools (kept) and seed bags (one used per sown tile).
  | "hoe" | "wateringCan" | "scythe" | "wheatSeeds" | "hempSeeds"
  // Stardew phase 5d: animal feed and products (eggs / milk are food), and the tools of the bigger animal houses.
  | "hay" | "egg" | "milk" | "carpenterTools" | "herbs"
  // Gap closure G6: the hero's animal tools and fertiliser.
  | "shears" | "milkPail" | "manure"
  // Clay pit and pottery (PLAN-agri-industry-winter-mines.md phase 2).
  | "woodenShovel" | "clay" | "clayPot" | "bricks" | "roofTiles" | "tableware" | "crucible"
  // Deep mines (PLAN-agri-industry-winter-mines.md phase 3, shared/src/mines.ts): new ores and fuel, encounter loot, and
  // the mine fittings (lamps lower re-infestation; the vent and pump are the deep-shaft gates).
  | "coal" | "copperOre" | "tinOre" | "bones" | "gems" | "mineLamps" | "mineVent" | "minePump"
  // Winter (phase 4, shared/src/winter.ts): the Tailor's garments, worn by people (wardrobes) against the cold.
  | "tunic" | "coat" | "boots"
  // Agriculture extras (phase 5, shared/src/agri.ts): preserved foods and their inputs, the iron plow, hops and ale.
  | "salt" | "smokedMeat" | "saltedMeat" | "rennet" | "cheese" | "ironPlow" | "hops" | "hopSeeds" | "ale"
  // Industry extras (phase 6, shared/src/industry.ts): bronze and the tools the Bloomery casts from it (tier-1 weapons
  // and armour are forged from bronze at the Blacksmith: the armoury stock, no item).
  | "bronze" | "bronzeTools"
  // The new deposits' ores and what the Stamp Mill crushes and washes out of them.
  | "limestone" | "goldOre" | "leadOre" | "washedTin" | "goldDust" | "sand" | "crushedIron"
  // Steel from the Blast furnace (flux: limestone).
  | "steel"
  // The Glassworks.
  | "glass" | "glassPanes" | "bottles"
  // The Mint (coins go to the treasury) and lead.
  | "coins" | "lead"
  // Layered mines (2026-11-19): the pickaxes that open the Mine's deeper layers (forged at the Blacksmith).
  | "bronzePick" | "ironPick";

export type StockKey = "wood" | "rock" | "iron" | "grain" | "meat" | "fruit" | "wool" | "cotton" | "clothes" | "tools";

export interface ItemDef {
  label: string;
  desc: string;
  // Goods panel group: food, material (inputs, fuel, hides) or tool (kept tools and fittings).
  group: "food" | "material" | "tool";
}

// Quality grade 1-3 of a crafted item (index = grade - 1). A station's output grade is its effective tier
// (min(station level, worker level), capped at 3).
export const QUALITY_GRADES = [
  { grade: 1, label: "Poor", value: 1 },
  { grade: 2, label: "Good", value: 1.25 },
  { grade: 3, label: "Fine", value: 1.5 },
] as const;
export const MAX_QUALITY = 3;

export interface Requires {
  // Items that must be in stock (any grade). Not consumed: a tool in the store opens the building for good.
  items?: Partial<Record<ItemId, number>>;
  // Buildings of at least `level` (default 1) standing in the clan's lands.
  buildings?: { tile: TileType; level?: number }[];
  // The assigned worker's level (station upgrades always need level = the new tier; see WORKER_LEVEL_RULE).
  workerLevel?: number;
  // Days the clan has existed.
  days?: number;
}

export interface BuildingReq {
  // To place the first one (sticky: once placed, the building type stays unlocked).
  requires?: Requires;
  // Extra gates for upgrading to level 2 / 3 (checked on every upgrade).
  levels?: Partial<Record<2 | 3, Requires>>;
}

export interface Recipe {
  id: string;
  label: string;
  output: ItemId;
  amount: number;
  // Stock resources and items used up.
  stock?: Partial<Record<StockKey, number>>;
  // Stock that must stay behind: the recipe is only ready while the store holds this much MORE than `stock` asks.
  stockReserve?: Partial<Record<StockKey, number>>;
  items?: Partial<Record<ItemId, number>>;
  // Winter: made by a station's worker only while seasons are on (no winter: nobody needs it). Hand / personal
  // crafting is not affected.
  seasonsOnly?: boolean;
  // Items that must be in stock but are not used up (a sourdough starter is kept).
  needs?: Partial<Record<ItemId, number>>;
  // "hand": crafted at once from the build panel (the knapping spot, no building). Otherwise the station tile:
  // its artisan works the first recipe whose inputs are ready and whose output is under `cap`.
  station: "hand" | TileType;
  // Work seconds at a station (scaled by the station's speed); hand recipes are instant.
  seconds?: number;
  // A station stops making this while the stock holds this many (all grades).
  cap?: number;
  // Station recipes: the worker level needed (default 1).
  workerLevel?: number;
  // Station recipes: the station level needed (default 1; industry extras: steel only in a Blast furnace, Bloomery 2+).
  stationLevel?: number;
  // Industry extras: the output comes out this many grades better (lead glaze), at most Fine.
  gradeBonus?: number;
}

// One step of a Progression panel chain: a building type or an item.
export type ChainStep = { building: TileType; item?: undefined } | { item: ItemId; building?: undefined };
export interface ProgressionChain {
  id: string;
  label: string;
  steps: ChainStep[];
}

// Building types the chains name (the server reports which of them stand: snapshot `built`).
export function chainBuildingTiles(): TileType[] {
  const set = new Set<TileType>();
  for (const c of PROGRESSION.chains) for (const st of c.steps) if (st.building !== undefined) set.add(st.building);
  for (const r of PROGRESSION.recipes) if (r.station !== "hand") set.add(r.station);
  return [...set];
}

export type Profession =
  | "woodcutter" | "miner" | "farmer" | "farmhand" | "tailor" | "smith" | "smelter" | "collier" | "miller" | "baker" | "jeweler"
  | "brewer" | "innkeeper" | "hunter" | "forager" | "herder" | "digger" | "potter" | "salter" | "smoker" | "dairyman"
  | "founder" | "washer" | "glassblower" | "minter";

// Worker XP: one point per second at work. Level L needs WORKER_XP_LEVELS[L - 1] XP (level 1 at 0).
export const WORKER_XP_LEVELS = [0, 100, 300, 700];
export const WORKER_MAX_LEVEL = WORKER_XP_LEVELS.length;
// A station's effective tier = min(station level, worker level): +25% speed per tier above 1.
export const TIER_SPEED_BONUS = 0.25;

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < WORKER_XP_LEVELS.length; i++) if (xp >= WORKER_XP_LEVELS[i]) level = i + 1;
  return level;
}

// XP still needed for the next level (null at the top).
export function xpToNext(xp: number): number | null {
  const next = WORKER_XP_LEVELS[levelForXp(xp)];
  return next === undefined ? null : next - xp;
}

export const PROGRESSION = {
  items: {
    stoneAxe: { label: "Stone axe", desc: "Knapped flint on a haft. Fells trees: Lumberjack, Wooden House, Charcoal Burner.", group: "tool" },
    stonePick: { label: "Stone pick", desc: "Opens surface outcrops: the Quarry and a Mine's first level; with a knife, prospecting.", group: "tool" },
    stoneKnife: { label: "Stone knife", desc: "Skins game: Hunter's Hut (hides). With a pick, prospecting.", group: "tool" },
    timberProps: { label: "Timber props", desc: "Pit supports: a mine can be sunk to level 2 (shaft). Shafts wear one out every few days (none in store: cave-ins); props in store also keep nests away.", group: "tool" },
    hide: { label: "Hide", desc: "From a Hunter's Hut's kills (also pasture animals and game you hunt yourself). Bellows leather (the Blast furnace).", group: "material" },
    bellows: { label: "Bellows", desc: "Leather and wood. Blows the Blast furnace: the Bloomery's level 2 needs it.", group: "tool" },
    charcoal: { label: "Charcoal", desc: "Burned slowly from wood at the Charcoal Burner. Smelting fuel.", group: "material" },
    ironBloom: { label: "Iron bloom", desc: "Smelted at the Bloomery from iron ore and charcoal; a Blast furnace (level 2+) makes better grades.", group: "material" },
    anvil: { label: "Anvil", desc: "Cast in bronze at the Bloomery. With hammer and tongs, a Blacksmith can be built (its level is the anvil's tier: 1 bronze, 2 iron, 3 steel).", group: "tool" },
    smithTools: { label: "Hammer & tongs", desc: "Cast in bronze at the Bloomery. A Blacksmith needs them.", group: "tool" },
    woodenPlow: { label: "Wooden plow", desc: "Breaks the ground: a Barn (farm fields) can be built.", group: "tool" },
    millstone: { label: "Millstone", desc: "A dressed grinding stone: the Mill needs one.", group: "tool" },
    clayOven: { label: "Clay oven", desc: "Bricks and clay: the Bakery needs one.", group: "tool" },
    flour: { label: "Flour", desc: "Ground from grain at the Mill.", group: "food" },
    gruel: { label: "Wheat gruel", desc: "Grain boiled over the fire: filling, dull (no happiness bonus).", group: "food" },
    flatbread: { label: "Flatbread", desc: "Quick bread from the Bakery: good food, a small happiness bonus.", group: "food" },
    sourdoughStarter: { label: "Sourdough starter", desc: "A level-2 baker cultures it over ~3 days; kept, it lets the Bakery bake bread.", group: "food" },
    bread: { label: "Bread", desc: "The best food: most filling, the biggest happiness bonus (more for Good / Fine).", group: "food" },
    hoe: { label: "Hoe", desc: "The hero tills grass into soil (hotbar 1): a hero plot, or a tile of your growing zone.", group: "tool" },
    wateringCan: { label: "Watering can", desc: "The hero waters tilled soil and crops (hotbar 2): watered crops grow at full speed. Refill at water.", group: "tool" },
    scythe: { label: "Scythe", desc: "The hero harvests ripe crops quickly (hotbar 4); by hand is slower.", group: "tool" },
    wheatSeeds: { label: "Wheat seeds", desc: "A seed bag: the hero sows one per tilled tile (hotbar 3).", group: "material" },
    hempSeeds: { label: "Hemp seeds", desc: "A seed bag: the hero sows one per tilled tile (hotbar 3, press again for hemp).", group: "material" },
    hay: { label: "Hay", desc: "Straw left by every wheat harvest. Animal feed (2 feed each); grain feeds them too.", group: "material" },
    egg: { label: "Eggs", desc: "Laid daily by chickens in a Chicken Coop. Food (eaten at dawn).", group: "food" },
    milk: { label: "Milk", desc: "From cows in a Livestock Barn, daily. Food (eaten at dawn).", group: "food" },
    carpenterTools: { label: "Carpenter's tools", desc: "Saw, adze and mallet: the Livestock Barn, Pig Sty and Sheep Pen need them.", group: "tool" },
    herbs: { label: "Herbs", desc: "Brought home by foragers, or dried from fruit by hand. Infirmary medicine: patients heal faster.", group: "material" },
    shears: { label: "Shears", desc: "The hero shears a sheep whose wool is due (hotbar 7) for x1.25 wool; Sheep Pen chores go faster.", group: "tool" },
    milkPail: { label: "Milk pail", desc: "The hero milks a cow (hotbar 8) for x1.25 milk; Livestock Barn chores go faster.", group: "tool" },
    manure: { label: "Manure", desc: "Made daily by animals (collected at their houses). Fertiliser: a tilled / sown tile grows 25% faster (hotbar 9; villagers sowing use it too).", group: "material" },
    woodenShovel: { label: "Wooden shovel", desc: "A fire-hardened blade with a stone edge: a Clay Pit can be dug.", group: "tool" },
    clay: { label: "Clay", desc: "Dug at a Clay Pit (near water). The Kiln fires it; a clay oven needs some.", group: "material" },
    clayPot: { label: "Clay pots", desc: "Storage jars from the Kiln. Kept in store: every stockpile holds 1% more per pot (up to +25%).", group: "tool" },
    bricks: { label: "Bricks", desc: "Fired at the Kiln. The Bloomery needs 8 in store; a clay oven is built from them.", group: "material" },
    roofTiles: { label: "Roof tiles", desc: "Fired at the Kiln. A house's top tier needs 4 in store (a tiled roof).", group: "material" },
    tableware: { label: "Tableware", desc: "Plates and cups from the Kiln. 4+ in store: a small happiness bonus (more for Good / Fine).", group: "tool" },
    crucible: { label: "Crucible", desc: "A level-2 potter fires it hot with charcoal. The Blast furnace (Bloomery level 2) needs one.", group: "tool" },
    coal: { label: "Coal", desc: "Dug on a Mine's level 2. Smelting fuel like charcoal: the Bloomery burns it when charcoal runs out.", group: "material" },
    copperOre: { label: "Copper ore", desc: "Dug on a Mine's level 1. Kept for bronze.", group: "material" },
    tinOre: { label: "Tin ore", desc: "Dug on a Mine's level 1. Kept for bronze.", group: "material" },
    bones: { label: "Bones", desc: "Picked from the monsters cleared out of an infested mine.", group: "material" },
    gems: { label: "Rough gems", desc: "Rare finds in an infested mine's nests.", group: "material" },
    mineLamps: { label: "Miner's lamps", desc: "Kept in store, they light every deep shaft: nests come back half as often.", group: "tool" },
    mineVent: { label: "Air vent", desc: "A deep shaft (mine level 3) needs one in store; without it the air goes bad (half speed).", group: "tool" },
    minePump: { label: "Bucket pump", desc: "A deep shaft (mine level 3) needs one in store; without it the shaft floods now and then.", group: "tool" },
    tunic: { label: "Wool tunic", desc: "Sewn at the Tailor Shop. Warmth 1: with boots, dressed for winter. People take one from the stores themselves.", group: "tool" },
    coat: { label: "Winter coat", desc: "Sewn at the Tailor Shop. Warmth 2: dressed for winter on its own. Outdoors in winter without warm clothes: x0.6 work, slower, slowly hurt.", group: "tool" },
    boots: { label: "Boots", desc: "Hide boots from the Tailor Shop. Warmth 1: with a tunic, dressed for winter. Better grades wear out slower.", group: "tool" },
    salt: { label: "Salt", desc: "Boiled from brine at the Salt Works. The Smokehouse cures meat with it (salted meat keeps).", group: "material" },
    smokedMeat: { label: "Smoked meat", desc: "Smoked at the Smokehouse: keeps (no spoilage), safe to eat. Eaten after the fresh food runs out.", group: "food" },
    saltedMeat: { label: "Salted meat", desc: "Cured with salt at the Smokehouse: keeps (no spoilage), safe to eat. The winter reserve.", group: "food" },
    rennet: { label: "Rennet", desc: "Prepared from hides at the Dairy. Sets milk into cheese.", group: "material" },
    cheese: { label: "Cheese", desc: "Made from milk and rennet at the Dairy: keeps, filling, a happiness bonus.", group: "food" },
    ironPlow: { label: "Iron plow", desc: "Forged at the Blacksmith. In store: every farm field grows 25% faster and yields 25% more.", group: "tool" },
    hops: { label: "Hops", desc: "Harvested from a Growing zone set to Hops (summer to autumn). The Brewery brews ale with them.", group: "material" },
    hopSeeds: { label: "Hop cuttings", desc: "The hero plants one per tilled tile (seed bag, press again for hops).", group: "material" },
    ale: { label: "Ale", desc: "Hopped ale from the Brewery (grain + hops). In store: a happiness bonus by its best grade; drunk at dawn.", group: "food" },
    bronze: { label: "Bronze", desc: "Smelted at the Bloomery from copper ore and tin with charcoal (or coal). The Bloomery casts the anvil, hammer & tongs and bronze tools from it; the Blacksmith forges the bronze pickaxe and all tier-1 weapons and armour from it.", group: "material" },
    bronzeTools: { label: "Bronze tools", desc: "Cast at the Bloomery. In store: the hero and the clan's woodcutters, miners and diggers work 20% faster.", group: "tool" },
    limestone: { label: "Limestone", desc: "Cut on a Mine's level 1 (lime). Flux for steel at the Blast furnace; lime for glass.", group: "material" },
    goldOre: { label: "Gold ore", desc: "Dug on a Mine's level 3. The Stamp Mill crushes and washes it into gold dust (the Bloomery smelts some too, less of it).", group: "material" },
    leadOre: { label: "Lead ore", desc: "Dug on a Mine's level 3. The Bloomery smelts it into lead.", group: "material" },
    washedTin: { label: "Washed tin", desc: "Tin ore crushed and washed at the Stamp Mill (2 ore -> 3). The Bloomery makes more bronze from it.", group: "material" },
    crushedIron: { label: "Crushed iron ore", desc: "Iron ore crushed at the Stamp Mill (3 ore -> 4). The Bloomery smelts it into blooms with half the charcoal.", group: "material" },
    goldDust: { label: "Gold dust", desc: "Washed out of crushed gold ore at the Stamp Mill (or smelted at the Bloomery).", group: "material" },
    steel: { label: "Steel", desc: "Made at the Blast furnace (Bloomery level 2+) from iron blooms with limestone flux. Fine steel in store: the Blacksmith forges each piece a tier better.", group: "material" },
    glass: { label: "Glass", desc: "Melted at the Glassworks from sand and limestone (lime) with charcoal or coal.", group: "material" },
    glassPanes: { label: "Window glass", desc: "Blown at the Glassworks. 4+ in store: every window of your rooms is glazed (no heat lost, prettier).", group: "tool" },
    bottles: { label: "Bottles", desc: "Blown at the Glassworks. 4+ in store with ale: the ale's happiness bonus is higher (bottled ale).", group: "tool" },
    coins: { label: "Coins", desc: "Struck at the Mint from gold dust: they go straight into the treasury as gold.", group: "material" },
    lead: { label: "Lead", desc: "Smelted at the Bloomery from lead ore. The Kiln glazes tableware with it (a grade better).", group: "material" },
    sand: { label: "Sand", desc: "Stone crushed at the Stamp Mill. Glass is melted from it.", group: "material" },
    bronzePick: { label: "Bronze pickaxe", desc: "Forged at the Blacksmith (tier-1 anvil) from bronze. In store: a Mine can be dug to level 2 (iron ore, coal).", group: "tool" },
    ironPick: { label: "Iron pickaxe", desc: "Forged at the Blacksmith (tier-2 anvil) from iron blooms. In store: a Mine can be dug to level 3 (gold, lead).", group: "tool" },
  } satisfies Record<ItemId, ItemDef>,
  recipes: [
    { id: "stoneAxe", label: "Knap a stone axe", output: "stoneAxe", amount: 1, stock: { wood: 2, rock: 3 }, station: "hand" },
    { id: "stonePick", label: "Knap a stone pick", output: "stonePick", amount: 1, stock: { wood: 2, rock: 4 }, station: "hand" },
    { id: "stoneKnife", label: "Knap a stone knife", output: "stoneKnife", amount: 1, stock: { wood: 1, rock: 2 }, station: "hand" },
    { id: "timberProps", label: "Cut timber props", output: "timberProps", amount: 1, stock: { wood: 8 }, station: "hand" },
    { id: "bellows", label: "Sew bellows", output: "bellows", amount: 1, stock: { wood: 4 }, items: { hide: 2 }, station: "hand" },
    { id: "woodenPlow", label: "Carve a wooden plow", output: "woodenPlow", amount: 1, stock: { wood: 6, rock: 2 }, station: "hand" },
    { id: "millstone", label: "Dress a millstone", output: "millstone", amount: 1, stock: { rock: 12 }, station: "hand" },
    // Clay pit and pottery: bricks (and a little clay) replace the oven's stone placeholder.
    { id: "clayOven", label: "Build a clay oven", output: "clayOven", amount: 1, stock: { wood: 4 }, items: { bricks: 6, clay: 2 }, station: "hand" },
    { id: "woodenShovel", label: "Make a wooden shovel", output: "woodenShovel", amount: 1, stock: { wood: 3, rock: 1 }, station: "hand" },
    { id: "hoe", label: "Make a hoe", output: "hoe", amount: 1, stock: { wood: 2, rock: 2 }, station: "hand" },
    { id: "wateringCan", label: "Make a watering can", output: "wateringCan", amount: 1, stock: { wood: 4 }, station: "hand" },
    { id: "scythe", label: "Knap a scythe", output: "scythe", amount: 1, stock: { wood: 2, rock: 3 }, station: "hand" },
    { id: "wheatSeeds", label: "Sort wheat seed", output: "wheatSeeds", amount: 4, stock: { grain: 2 }, station: "hand" },
    { id: "hempSeeds", label: "Save hemp seed", output: "hempSeeds", amount: 4, stock: { cotton: 2 }, station: "hand" },
    { id: "carpenterTools", label: "Make carpenter's tools", output: "carpenterTools", amount: 1, stock: { wood: 6, rock: 4 }, station: "hand" },
    { id: "shears", label: "Knap shears", output: "shears", amount: 1, stock: { rock: 2, wood: 1 }, needs: { stoneKnife: 1 }, station: "hand" },
    { id: "milkPail", label: "Make a milk pail", output: "milkPail", amount: 1, stock: { wood: 3 }, needs: { carpenterTools: 1 }, station: "hand" },
    { id: "herbs", label: "Dry healing herbs", output: "herbs", amount: 2, stock: { fruit: 3 }, station: "hand" },
    { id: "hopSeeds", label: "Take hop cuttings", output: "hopSeeds", amount: 4, items: { hops: 2 }, station: "hand" },
    { id: "gruel", label: "Boil wheat gruel", output: "gruel", amount: 3, stock: { grain: 3, wood: 1 }, station: "hand" },
    // Deep mines: the fittings.
    { id: "mineLamps", label: "Make miner's lamps", output: "mineLamps", amount: 1, stock: { iron: 2, wood: 2 }, station: "hand" },
    { id: "mineVent", label: "Build an air vent", output: "mineVent", amount: 1, stock: { wood: 6, rock: 6 }, station: "hand" },
    { id: "minePump", label: "Build a bucket pump", output: "minePump", amount: 1, stock: { wood: 8, iron: 4 }, needs: { carpenterTools: 1 }, station: "hand" },
    { id: "charcoal", label: "Burn charcoal", output: "charcoal", amount: 3, stock: { wood: 6 }, station: TileType.CharcoalBurner, seconds: 90, cap: 40 },
    // The Glassworks: panes first, then bottles, while there is glass; else it melts glass.
    { id: "glassPanes", label: "Blow window glass", output: "glassPanes", amount: 2, stock: { wood: 1 }, items: { glass: 2 }, station: TileType.Glassworks, seconds: 30, cap: 20 },
    { id: "bottles", label: "Blow bottles", output: "bottles", amount: 2, items: { glass: 1 }, station: TileType.Glassworks, seconds: 25, cap: 20 },
    { id: "glass", label: "Melt glass", output: "glass", amount: 2, items: { sand: 2, limestone: 1, charcoal: 1 }, station: TileType.Glassworks, seconds: 40, cap: 30 },
    { id: "glassCoal", label: "Melt glass with coal", output: "glass", amount: 2, items: { sand: 2, limestone: 1, coal: 1 }, station: TileType.Glassworks, seconds: 40, cap: 30 },
    // The Mint strikes coins (straight into the treasury).
    { id: "coins", label: "Strike coins", output: "coins", amount: MINT_COINS_PER_BATCH, items: { goldDust: 2, charcoal: 1 }, station: TileType.Mint, seconds: 40 },
    { id: "coinsCoal", label: "Strike coins with coal", output: "coins", amount: MINT_COINS_PER_BATCH, items: { goldDust: 2, coal: 1 }, station: TileType.Mint, seconds: 40 },
    { id: "flour", label: "Grind flour", output: "flour", amount: 2, stock: { grain: 2 }, station: TileType.Mill, seconds: 20, cap: 40 },
    // Bakery: the starter first once the baker is level 2 (a ~3-day culture), then bread while it is kept, else flatbread.
    { id: "sourdoughStarter", label: "Culture a sourdough starter", output: "sourdoughStarter", amount: 1, items: { flour: 1 }, station: TileType.Bakery, seconds: 900, cap: 1, workerLevel: 2 },
    { id: "bread", label: "Bake bread", output: "bread", amount: 2, items: { flour: 2 }, needs: { sourdoughStarter: 1 }, station: TileType.Bakery, seconds: 40, cap: 40 },
    { id: "flatbread", label: "Bake flatbread", output: "flatbread", amount: 2, items: { flour: 2 }, station: TileType.Bakery, seconds: 20, cap: 40 },
    // Layered mines: the ores come from a Mine's miners by layer (shared/src/mines.ts MINE_LAYER_YIELDS), no recipes.
    // The Stamp Mill's ore washer: gold first, then tin, then sand from stone.
    { id: "goldDust", label: "Crush and wash gold ore", output: "goldDust", amount: 1, items: { goldOre: 3 }, station: TileType.StampMill, seconds: 40, cap: 20 },
    { id: "washedTin", label: "Crush and wash tin ore", output: "washedTin", amount: 3, items: { tinOre: 2 }, station: TileType.StampMill, seconds: 30, cap: 20 },
    { id: "crushedIron", label: "Crush iron ore", output: "crushedIron", amount: 4, stock: { iron: 3 }, stockReserve: { iron: MINE_IRON_RESERVE }, station: TileType.StampMill, seconds: 30, cap: 20 },
    { id: "sand", label: "Crush stone to sand", output: "sand", amount: 2, stock: { rock: 3 }, station: TileType.StampMill, seconds: 20, cap: 30 },
    // Clay pit and pottery. The Clay Pit's digger digs clay (no inputs); the Kiln's potter fires it with wood (the
    // crucible hot, with charcoal, by a level-2 potter), the first ready recipe under its cap in this order.
    { id: "clay", label: "Dig clay", output: "clay", amount: 2, station: TileType.ClayPit, seconds: 20, cap: 60 },
    { id: "crucible", label: "Fire a crucible", output: "crucible", amount: 1, items: { clay: 3, charcoal: 2 }, station: TileType.Kiln, seconds: 40, cap: 2, workerLevel: 2 },
    { id: "bricks", label: "Fire bricks", output: "bricks", amount: 4, stock: { wood: 1 }, items: { clay: 2 }, station: TileType.Kiln, seconds: 30, cap: 20 },
    { id: "clayPot", label: "Fire clay pots", output: "clayPot", amount: 2, stock: { wood: 1 }, items: { clay: 3 }, station: TileType.Kiln, seconds: 30, cap: 25 },
    { id: "roofTiles", label: "Fire roof tiles", output: "roofTiles", amount: 3, stock: { wood: 1 }, items: { clay: 2 }, station: TileType.Kiln, seconds: 30, cap: 8 },
    // Industry extras: lead-glazed tableware, a grade better, while there is lead.
    { id: "glazedTableware", label: "Fire glazed tableware", output: "tableware", amount: 2, stock: { wood: 1 }, items: { clay: 2, lead: 1 }, station: TileType.Kiln, seconds: 30, cap: 12, gradeBonus: LEAD_GLAZE_GRADE_BONUS },
    { id: "tableware", label: "Fire tableware", output: "tableware", amount: 2, stock: { wood: 1 }, items: { clay: 2 }, station: TileType.Kiln, seconds: 25, cap: 12 },
    // Winter: the Tailor sews garments from cloth (the "clothes" stock), wool and hides, coats first; with none of these
    // ready (or every cap reached) it weaves cloth from wool + hemp as before (constants.ts CRAFT_RECIPES).
    { id: "coat", label: "Sew a winter coat", output: "coat", amount: 1, stock: { clothes: 2, wool: 2 }, station: TileType.TailorShop, seconds: 45, cap: 20, seasonsOnly: true },
    { id: "boots", label: "Sew boots", output: "boots", amount: 1, items: { hide: 2 }, station: TileType.TailorShop, seconds: 30, cap: 20, seasonsOnly: true },
    { id: "tunic", label: "Sew a wool tunic", output: "tunic", amount: 1, stock: { clothes: 1, wool: 1 }, station: TileType.TailorShop, seconds: 30, cap: 20, seasonsOnly: true },
    // Agriculture extras (shared/src/agri.ts). The Salt Works boils brine with wood; the Smokehouse cures meat with salt
    // when there is some, else smokes it; the Dairy prepares rennet from hides, then sets milk into cheese.
    { id: "salt", label: "Boil salt", output: "salt", amount: 2, stock: { wood: 1 }, station: TileType.SaltWorks, seconds: 30, cap: 40 },
    { id: "saltedMeat", label: "Cure salted meat", output: "saltedMeat", amount: 4, stock: { meat: 4 }, items: { salt: 1 }, station: TileType.Smokehouse, seconds: 40, cap: 60 },
    { id: "smokedMeat", label: "Smoke meat", output: "smokedMeat", amount: 4, stock: { meat: 4, wood: 2 }, station: TileType.Smokehouse, seconds: 60, cap: 60 },
    { id: "rennet", label: "Prepare rennet", output: "rennet", amount: 2, items: { hide: 1 }, station: TileType.Dairy, seconds: 30, cap: 4 },
    { id: "cheese", label: "Make cheese", output: "cheese", amount: 2, items: { milk: 4, rennet: 1 }, station: TileType.Dairy, seconds: 60, cap: 40 },
    // The Blacksmith forges the iron plow (one is enough) before its tools; the Brewery brews hopped ale while hops are
    // in store, else plain ale (alcohol) as before.
    // Layered mines: the Blacksmith's anvil tier is its level (1 bronze, 2 iron, 3 steel): the bronze pickaxe on a tier-1
    // anvil, iron work (the iron pickaxe, the iron plow) from tier 2.
    { id: "bronzePick", label: "Forge a bronze pickaxe", output: "bronzePick", amount: 1, stock: { wood: 2 }, items: { bronze: 3 }, station: TileType.Blacksmith, seconds: 40, cap: 1 },
    { id: "ironPick", label: "Forge an iron pickaxe", output: "ironPick", amount: 1, stock: { wood: 2 }, items: { ironBloom: 3 }, station: TileType.Blacksmith, seconds: 50, cap: 1, stationLevel: 2 },
    { id: "ironPlow", label: "Forge an iron plow", output: "ironPlow", amount: 1, stock: { wood: 4 }, items: { ironBloom: 2 }, station: TileType.Blacksmith, seconds: 60, cap: 1, stationLevel: 2 },
    { id: "ale", label: "Brew hopped ale", output: "ale", amount: 2, stock: { grain: 2 }, items: { hops: 1 }, station: TileType.Brewery, seconds: 40, cap: 30 },
    // One furnace (2026-11-19, shared/src/industry.ts): the Bloomery smelts every metal. Its smelter casts the bronze
    // anvil and the smith's hammer & tongs first (one each: the Blacksmith needs no iron), then bronze tools (one set),
    // then steel (Blast furnace: level 2+, a level-2 smelter, blooms + limestone flux), then bronze (copper + tin), iron
    // blooms, lead and last gold dust; charcoal first, coal when it runs out.
    { id: "anvil", label: "Cast a bronze anvil", output: "anvil", amount: 1, items: { bronze: 4 }, station: TileType.Bloomery, seconds: 60, cap: 1 },
    { id: "smithTools", label: "Cast hammer & tongs", output: "smithTools", amount: 1, stock: { wood: 2 }, items: { bronze: 2 }, station: TileType.Bloomery, seconds: 40, cap: 1 },
    { id: "bronzeTools", label: "Cast bronze tools", output: "bronzeTools", amount: 1, stock: { wood: 2 }, items: { bronze: 2 }, station: TileType.Bloomery, seconds: 40, cap: 1 },
    { id: "steel", label: "Make steel", output: "steel", amount: 1, items: { ironBloom: 2, limestone: 1, charcoal: 2 }, station: TileType.Bloomery, seconds: 60, cap: 20, workerLevel: 2, stationLevel: 2 },
    { id: "steelCoal", label: "Make steel with coal", output: "steel", amount: 1, items: { ironBloom: 2, limestone: 1, coal: 2 }, station: TileType.Bloomery, seconds: 60, cap: 20, workerLevel: 2, stationLevel: 2 },
    { id: "bronzeWashed", label: "Smelt bronze from washed tin", output: "bronze", amount: 3, items: { copperOre: 3, washedTin: 2, charcoal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 30 },
    { id: "bronzeWashedCoal", label: "Smelt bronze from washed tin with coal", output: "bronze", amount: 3, items: { copperOre: 3, washedTin: 2, coal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 30 },
    { id: "bronze", label: "Smelt bronze", output: "bronze", amount: 2, items: { copperOre: 3, tinOre: 2, charcoal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 30 },
    { id: "bronzeCoal", label: "Smelt bronze with coal", output: "bronze", amount: 2, items: { copperOre: 3, tinOre: 2, coal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 30 },
    { id: "ironBloomCrushed", label: "Smelt an iron bloom from crushed ore", output: "ironBloom", amount: 1, items: { crushedIron: 2, charcoal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 20 },
    { id: "ironBloomCrushedCoal", label: "Smelt an iron bloom from crushed ore with coal", output: "ironBloom", amount: 1, items: { crushedIron: 2, coal: 1 }, station: TileType.Bloomery, seconds: 40, cap: 20 },
    { id: "ironBloom", label: "Smelt an iron bloom", output: "ironBloom", amount: 1, stock: { iron: 3 }, items: { charcoal: 2 }, station: TileType.Bloomery, seconds: 40, cap: 20 },
    // Deep mines: coal burns in the Bloomery when there is no charcoal.
    { id: "ironBloomCoal", label: "Smelt an iron bloom with coal", output: "ironBloom", amount: 1, stock: { iron: 3 }, items: { coal: 2 }, station: TileType.Bloomery, seconds: 40, cap: 20 },
    { id: "lead", label: "Smelt lead", output: "lead", amount: 2, items: { leadOre: 2, charcoal: 1 }, station: TileType.Bloomery, seconds: 30, cap: 20 },
    { id: "leadCoal", label: "Smelt lead with coal", output: "lead", amount: 2, items: { leadOre: 2, coal: 1 }, station: TileType.Bloomery, seconds: 30, cap: 20 },
    // Gold: the Stamp Mill washes more dust out of the same ore (3 -> 1 here vs. there, but slower and fuel-hungry).
    { id: "goldSmelt", label: "Smelt gold dust", output: "goldDust", amount: 1, items: { goldOre: 4, charcoal: 1 }, station: TileType.Bloomery, seconds: 50, cap: 20 },
  ] as Recipe[],
  // What each building needs. Buildings not listed are open from the start.
  buildings: {
    [TileType.LumberjackPost]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.House]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.HunterHut]: { requires: { items: { stoneKnife: 1 } } },
    // Deep mines: a deep shaft (level 3) also needs an air vent and a bucket pump in store (bad air / flooding).
    [TileType.RockMinePost]: {
      requires: { items: { stonePick: 1 } },
      levels: { 2: { items: { timberProps: 1 } }, 3: { items: { mineVent: 1, minePump: 1 }, buildings: [{ tile: TileType.Blacksmith }] } },
    },
    // Layered mines: the Mine (on ore ground) after a Quarry; each upgrade opens the next layer: level 2 (iron ore,
    // coal) needs a bronze pickaxe and timber props, level 3 (gold, lead) an iron pickaxe, an air vent and a pump.
    [TileType.IronMinePost]: {
      requires: { items: { stonePick: 1 }, buildings: [{ tile: TileType.RockMinePost }] },
      levels: { 2: { items: { bronzePick: 1, timberProps: 1 } }, 3: { items: { ironPick: 1, mineVent: 1, minePump: 1 } } },
    },
    [TileType.CharcoalBurner]: { requires: { items: { stoneAxe: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    // One furnace (2026-11-19): level 1 needs no iron, no Blacksmith and no bellows (charcoal, bricks, a Charcoal Burner), so
    // Quarry -> Mine L1 -> Bloomery -> bronze -> Blacksmith -> bronze pickaxe -> Mine L2 -> iron has no cycle.
    [TileType.Bloomery]: {
      // Clay pit and pottery: bricks from the Kiln line the shaft (the plan's "clay bricks").
      requires: { items: { charcoal: 2, bricks: 8 }, buildings: [{ tile: TileType.CharcoalBurner }] },
      // Level 2 is the Blast furnace (better blooms, steel): bellows (a hunter's hides), a crucible and a Blacksmith.
      levels: { 2: { items: { bellows: 1, crucible: 1 }, buildings: [{ tile: TileType.Blacksmith }] } },
    },
    // Layered mines: the bronze anvil and tools come from the Bloomery (no iron needed). Its level is the anvil tier: 2
    // (iron work) needs iron blooms in store, 3 (steel) steel in store.
    [TileType.Blacksmith]: {
      requires: { items: { anvil: 1, smithTools: 1 }, buildings: [{ tile: TileType.Bloomery }] },
      levels: { 2: { items: { ironBloom: 1 } }, 3: { items: { steel: 1 } } },
    },
    [TileType.KnightPost]: { requires: { buildings: [{ tile: TileType.Blacksmith }] } },
    // Phase 4: food. Farm fields need a Barn, the Barn a plow.
    [TileType.BarnPost]: { requires: { items: { woodenPlow: 1 } } },
    [TileType.Mill]: { requires: { items: { millstone: 1 }, buildings: [{ tile: TileType.BarnPost }] } },
    [TileType.Bakery]: { requires: { items: { clayOven: 1 }, buildings: [{ tile: TileType.Mill }] } },
    [TileType.Stables]: { requires: { buildings: [{ tile: TileType.Blacksmith }] } },
    [TileType.SiegeWorkshop]: { requires: { buildings: [{ tile: TileType.Blacksmith }] } },
    // Modular building phase 1: wood pieces need the stone axe (like the Wooden House), stone pieces a Quarry.
    // (The old Wood / Stone Wall stay ungated, as before.)
    [TileType.WoodDoor]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.WoodWindow]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.WoodFloor]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Bed]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.StoneDoor]: { requires: { buildings: [{ tile: TileType.RockMinePost }] } },
    [TileType.StoneWindow]: { requires: { buildings: [{ tile: TileType.RockMinePost }] } },
    [TileType.StoneFloor]: { requires: { buildings: [{ tile: TileType.RockMinePost }] } },
    // Modular building phase 2: furniture. Wood pieces need the stone axe; stone ones a Quarry; the lamp and the
    // weapon rack iron (a Mine); the rug wool (a Sheep Pasture).
    [TileType.Table]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Chair]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Chest]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Shelf]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Workbench]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Hearth]: { requires: { buildings: [{ tile: TileType.RockMinePost }] } },
    [TileType.Statue]: { requires: { buildings: [{ tile: TileType.RockMinePost }] } },
    [TileType.Lamp]: { requires: { buildings: [{ tile: TileType.IronMinePost }] } },
    [TileType.WeaponRack]: { requires: { buildings: [{ tile: TileType.IronMinePost }] } },
    [TileType.Rug]: { requires: { buildings: [{ tile: TileType.WoolFarm }] } },
    // Gap closure G1: the long table and wardrobe are carpentry (stone axe); the medicine chest needs a Forager's Hut.
    [TileType.LongTable]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.Wardrobe]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.MedicineChest]: { requires: { items: { stoneAxe: 1 }, buildings: [{ tile: TileType.ForagerHut }] } },
    // Stardew phase 5d: the coop needs the stone axe and a Lumberjack (sawn boards); the bigger houses carpenter's tools.
    [TileType.ChickenCoop]: { requires: { items: { stoneAxe: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    [TileType.LivestockBarn]: { requires: { items: { carpenterTools: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    [TileType.PigSty]: { requires: { items: { carpenterTools: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    [TileType.SheepPen]: { requires: { items: { carpenterTools: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    // Clay pit and pottery: the pit needs a shovel (and water near: CLAY_PIT_WATER_RADIUS_TILES), the Kiln a Clay Pit.
    [TileType.ClayPit]: { requires: { items: { woodenShovel: 1 } } },
    [TileType.Kiln]: { requires: { buildings: [{ tile: TileType.ClayPit }] } },
    // A house's top tier (Cottage level 3) needs a tiled roof (the level-2 row is the BigHouse's: upgrades read the
    // row of the tile being upgraded).
    [TileType.BigHouse]: { levels: { 3: { items: { roofTiles: 4 } } } },
    // Agriculture extras: salt pans are clay-lined (pots kept), the Smokehouse hangs a hunter's meat, the Dairy needs
    // cows (a Livestock Barn), the Cellar is brick-vaulted.
    [TileType.SaltWorks]: { requires: { items: { clayPot: 2 } } },
    [TileType.Smokehouse]: { requires: { buildings: [{ tile: TileType.HunterHut }] } },
    [TileType.Dairy]: { requires: { buildings: [{ tile: TileType.LivestockBarn }] } },
    [TileType.Cellar]: { requires: { items: { bricks: 6 } } },
    // The Foundry is retired (2026-11-19; the Bloomery smelts every metal): not buildable (server/src/construction.ts).
    // The Stamp Mill is millwork on a miner's know-how (carpenter's tools, a Mine; water near to wash:
    // STAMP_MILL_WATER_RADIUS_TILES).
    [TileType.StampMill]: { requires: { items: { carpenterTools: 1 }, buildings: [{ tile: TileType.IronMinePost }] } },
    // The Glassworks: a kiln-builder's furnace, fed with the Stamp Mill's sand.
    [TileType.Glassworks]: { requires: { buildings: [{ tile: TileType.Kiln }, { tile: TileType.StampMill }] } },
    // The Mint: gold dust from a Stamp Mill, dies cut at a Blacksmith.
    [TileType.Mint]: { requires: { buildings: [{ tile: TileType.StampMill }, { tile: TileType.Blacksmith }] } },
  } as Partial<Record<TileType, BuildingReq>>,
  // The profession a station's workers train in (XP per profession per person).
  stations: {
    [TileType.LumberjackPost]: "woodcutter",
    [TileType.IronMinePost]: "miner",
    [TileType.RockMinePost]: "miner",
    [TileType.BarnPost]: "farmer",
    [TileType.Pasture]: "farmhand",
    [TileType.PigPasture]: "farmhand",
    [TileType.Orchard]: "farmhand",
    [TileType.WoolFarm]: "farmhand",
    [TileType.CottonFarm]: "farmhand",
    [TileType.TailorShop]: "tailor",
    [TileType.Blacksmith]: "smith",
    [TileType.Bloomery]: "smelter",
    [TileType.CharcoalBurner]: "collier",
    [TileType.Mill]: "miller",
    [TileType.Bakery]: "baker",
    [TileType.LuxuryWorkshop]: "jeweler",
    [TileType.Brewery]: "brewer",
    [TileType.Tavern]: "innkeeper",
    [TileType.HunterHut]: "hunter",
    [TileType.ForagerHut]: "forager",
    // Stardew phase 5d: the Animal Keeper post of each animal house.
    [TileType.ChickenCoop]: "herder",
    [TileType.LivestockBarn]: "herder",
    [TileType.PigSty]: "herder",
    [TileType.SheepPen]: "herder",
    [TileType.ClayPit]: "digger",
    [TileType.Kiln]: "potter",
    [TileType.SaltWorks]: "salter",
    [TileType.Smokehouse]: "smoker",
    [TileType.Dairy]: "dairyman",
    // Retired (an old Foundry's founder stands idle: it has no recipes).
    [TileType.Foundry]: "founder",
    [TileType.StampMill]: "washer",
    [TileType.Glassworks]: "glassblower",
    [TileType.Mint]: "minter",
  } as Partial<Record<TileType, Profession>>,
  // The Progression panel's chains (order only: every step's needs come from `buildings` / `recipes` above).
  chains: [
    { id: "stone", label: "Stone age", steps: [{ item: "stoneAxe" }, { item: "stoneKnife" }, { item: "stonePick" }, { building: TileType.LumberjackPost }, { building: TileType.House }, { building: TileType.HunterHut }, { item: "hide" }] },
    // Layered mines: Quarry -> Mine L1 (copper, tin, lime) -> Bloomery / bronze -> Blacksmith -> bronze pickaxe -> Mine L2
    // (iron, coal) -> iron blooms -> iron pickaxe -> Mine L3 (gold, lead).
    { id: "mining", label: "Mining & ore", steps: [{ item: "stonePick" }, { building: TileType.RockMinePost }, { building: TileType.IronMinePost }, { item: "copperOre" }, { item: "tinOre" }, { item: "limestone" }, { building: TileType.Bloomery }, { item: "bronze" }, { building: TileType.Blacksmith }, { item: "bronzePick" }, { item: "timberProps" }, { item: "coal" }, { item: "ironBloom" }, { item: "ironPick" }, { item: "mineVent" }, { item: "minePump" }, { item: "goldOre" }, { item: "leadOre" }, { item: "mineLamps" }] },
    { id: "ore", label: "Crushing & washing", steps: [{ item: "carpenterTools" }, { building: TileType.StampMill }, { item: "washedTin" }, { item: "goldDust" }, { item: "crushedIron" }, { item: "sand" }] },
    { id: "glass", label: "Glass", steps: [{ item: "limestone" }, { item: "sand" }, { building: TileType.Glassworks }, { item: "glass" }, { item: "glassPanes" }, { item: "bottles" }] },
    { id: "gold", label: "Gold & lead", steps: [{ item: "goldOre" }, { item: "goldDust" }, { building: TileType.Mint }, { item: "coins" }, { item: "leadOre" }, { item: "lead" }] },
    { id: "bronze", label: "Bronze", steps: [{ item: "copperOre" }, { item: "tinOre" }, { building: TileType.Bloomery }, { item: "bronze" }, { item: "anvil" }, { item: "smithTools" }, { building: TileType.Blacksmith }, { item: "bronzePick" }, { item: "bronzeTools" }] },
    { id: "metal", label: "Metal", steps: [{ building: TileType.CharcoalBurner }, { item: "charcoal" }, { item: "bricks" }, { building: TileType.Bloomery }, { item: "bronze" }, { item: "ironBloom" }, { item: "ironPick" }, { item: "bellows" }, { item: "crucible" }, { item: "limestone" }, { item: "steel" }, { item: "lead" }] },
    { id: "clay", label: "Clay & pottery", steps: [{ item: "woodenShovel" }, { building: TileType.ClayPit }, { item: "clay" }, { building: TileType.Kiln }, { item: "bricks" }, { item: "clayPot" }, { item: "roofTiles" }, { item: "tableware" }, { item: "crucible" }] },
    { id: "food", label: "Food", steps: [{ item: "woodenPlow" }, { building: TileType.BarnPost }, { item: "gruel" }, { item: "millstone" }, { building: TileType.Mill }, { item: "flour" }, { item: "clayOven" }, { building: TileType.Bakery }, { item: "flatbread" }, { item: "sourdoughStarter" }, { item: "bread" }] },
    { id: "keeping", label: "Keeping food", steps: [{ building: TileType.Cellar }, { building: TileType.SaltWorks }, { item: "salt" }, { building: TileType.Smokehouse }, { item: "smokedMeat" }, { item: "saltedMeat" }, { building: TileType.Dairy }, { item: "rennet" }, { item: "cheese" }] },
    { id: "fields", label: "Fields & drink", steps: [{ item: "woodenPlow" }, { item: "ironPlow" }, { item: "hops" }, { item: "ale" }] },
    { id: "cloth", label: "Cloth", steps: [{ building: TileType.WoolFarm }, { building: TileType.CottonFarm }, { building: TileType.TailorShop }, { item: "tunic" }, { item: "coat" }, { item: "boots" }] },
    { id: "military", label: "Military", steps: [{ building: TileType.MilitiaPost }, { building: TileType.ArcherPost }, { building: TileType.KnightPost }, { building: TileType.Stables }, { building: TileType.SiegeWorkshop }] },
    { id: "animals", label: "Animals", steps: [{ building: TileType.ChickenCoop }, { item: "egg" }, { item: "carpenterTools" }, { building: TileType.LivestockBarn }, { building: TileType.PigSty }, { building: TileType.SheepPen }, { item: "milk" }] },
    { id: "faith", label: "Faith", steps: [{ building: TileType.ChurchPost }, { building: TileType.WardStone }] },
  ] as ProgressionChain[],
  // A new game's starting kit (plan open question: small kit, 1 stone axe + 1 pick). Stardew phase 5a: a hoe, a
  // watering can and a few wheat seeds, so a solo hero can farm from day one.
  starterKit: { stoneAxe: 1, stonePick: 1, hoe: 1, wateringCan: 1, wheatSeeds: 8 } as Partial<Record<ItemId, number>>,
};

export const PROFESSION_LABEL: Record<Profession, string> = {
  woodcutter: "Woodcutter", miner: "Miner", farmer: "Farmer", farmhand: "Farmhand", tailor: "Tailor", smith: "Smith",
  smelter: "Smelter", collier: "Collier", miller: "Miller", baker: "Baker", jeweler: "Jeweler", brewer: "Brewer", innkeeper: "Innkeeper",
  hunter: "Hunter", forager: "Forager", herder: "Animal Keeper", digger: "Digger", potter: "Potter", salter: "Salter",
  smoker: "Smoker", dairyman: "Dairy hand", founder: "Founder", washer: "Ore washer", glassblower: "Glassblower", minter: "Minter",
};

// Names for the buildings the table refers to (needs text).
export const PROGRESSION_BUILDING_LABEL: Partial<Record<TileType, string>> = {
  [TileType.LumberjackPost]: "Lumberjack",
  [TileType.CharcoalBurner]: "Charcoal Burner",
  [TileType.Bloomery]: "Bloomery",
  [TileType.BarnPost]: "Barn",
  [TileType.Mill]: "Mill",
  [TileType.Bakery]: "Bakery",
  [TileType.Blacksmith]: "Blacksmith",
  [TileType.House]: "Wooden House",
  [TileType.HunterHut]: "Hunter's Hut",
  [TileType.RockMinePost]: "Quarry",
  [TileType.IronMinePost]: "Mine",
  [TileType.KnightPost]: "Hall of the Sworn",
  [TileType.Stables]: "Stables",
  [TileType.SiegeWorkshop]: "Siege Workshop",
  [TileType.ChickenCoop]: "Chicken Coop",
  [TileType.LivestockBarn]: "Livestock Barn",
  [TileType.PigSty]: "Pig Sty",
  [TileType.SheepPen]: "Sheep Pen",
  [TileType.ClayPit]: "Clay Pit",
  [TileType.Kiln]: "Kiln",
  [TileType.CoalMine]: "Coal Mine",
  [TileType.CopperMine]: "Copper Mine",
  [TileType.TinMine]: "Tin Mine",
  [TileType.SaltWorks]: "Salt Works",
  [TileType.Smokehouse]: "Smokehouse",
  [TileType.Dairy]: "Dairy",
  [TileType.Cellar]: "Cellar",
  [TileType.Foundry]: "Foundry",
  [TileType.StampMill]: "Stamp Mill",
  [TileType.Glassworks]: "Glassworks",
  [TileType.Mint]: "Mint",
  [TileType.LimeQuarry]: "Lime Quarry",
  [TileType.GoldMine]: "Gold Mine",
  [TileType.LeadMine]: "Lead Mine",
};

// Smith training (plan §2): a level-1 smith makes tools only; forging tier-1/2 gear needs level 2, tier 3 level 3.
export function smithLevelForGearTier(tier: number): number {
  return Math.max(2, tier);
}

export interface ProgressContext {
  // Items in stock, all grades summed.
  items: Partial<Record<ItemId, number>>;
  // Highest standing level per building type (missing = none standing).
  buildings: Partial<Record<number, number>>;
  // Days since the clan was founded.
  day: number;
  // The assigned worker's level (upgrades only).
  workerLevel?: number;
}

// Human-readable unmet gates of `req` ("Stone axe", "a Lumberjack", "Smith level 2"); empty = all met.
export function unmetRequirements(req: Requires | undefined, ctx: ProgressContext, professionLabel = "Worker"): string[] {
  if (!req) return [];
  const out: string[] = [];
  for (const [id, n] of Object.entries(req.items ?? {}) as [ItemId, number][]) {
    if ((ctx.items[id] ?? 0) < n) out.push(n > 1 ? `${n} ${PROGRESSION.items[id].label}` : PROGRESSION.items[id].label);
  }
  for (const b of req.buildings ?? []) {
    const lvl = b.level ?? 1;
    if ((ctx.buildings[b.tile] ?? 0) < lvl) {
      const name = PROGRESSION_BUILDING_LABEL[b.tile] ?? "building";
      out.push(lvl > 1 ? `a level-${lvl} ${name}` : `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`);
    }
  }
  if (req.workerLevel !== undefined && (ctx.workerLevel ?? 0) < req.workerLevel) out.push(`${professionLabel} level ${req.workerLevel}`);
  if (req.days !== undefined && ctx.day < req.days) out.push(`day ${req.days}`);
  return out;
}

export function recipeById(id: string): Recipe | undefined {
  return PROGRESSION.recipes.find((r) => r.id === id);
}

export function stationRecipes(tile: number): Recipe[] {
  return PROGRESSION.recipes.filter((r) => r.station === tile);
}

// The production cap on an item: the lowest `cap` of every recipe that makes it (undefined: uncapped). The hero's
// own crafting (by hand or at a workstation) stops at the same cap as a station's worker: no uncapped fallback.
export function outputCap(id: ItemId): number | undefined {
  let cap: number | undefined;
  for (const r of PROGRESSION.recipes) if (r.output === id && r.cap !== undefined) cap = Math.min(cap ?? Infinity, r.cap);
  return cap;
}

// "2 wood + 3 rock + 2 Hide".
export function recipeCostText(r: Recipe): string {
  const parts = Object.entries(r.stock ?? {}).map(([k, n]) => `${n} ${k}`);
  for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) parts.push(`${n} ${PROGRESSION.items[id].label}`);
  for (const id of Object.keys(r.needs ?? {}) as ItemId[]) parts.push(`a ${PROGRESSION.items[id].label} (kept)`);
  return parts.join(" + ") || "Free";
}

// Phase 4: food items eaten at dawn before grain / meat / fruit (food units each; bread most filling) and their
// colony happiness bonus while in stock (bread +2 per grade above Poor). Agriculture extras: `preserved` foods keep, so
// they are eaten only after the grain / meat / fruit runs short (the winter reserve).
export const FOOD_ITEMS: { id: ItemId; food: number; happiness: number; preserved?: boolean }[] = [
  { id: "bread", food: 3, happiness: 8 },
  { id: "flatbread", food: 2, happiness: 3 },
  { id: "gruel", food: 1.2, happiness: 0 },
  // Stardew phase 5d: animal products.
  { id: "milk", food: 1, happiness: 2 },
  { id: "egg", food: 0.5, happiness: 2 },
  { id: "cheese", food: 2, happiness: 4, preserved: true },
  { id: "smokedMeat", food: 2, happiness: 3, preserved: true },
  { id: "saltedMeat", food: 2, happiness: 2, preserved: true },
];

// ---- Clay pit and pottery (PLAN-agri-industry-winter-mines.md phase 2) ----
// A Clay Pit needs water (a pond / river Water tile or a dug Moat) within this many tiles (Chebyshev).
export const CLAY_PIT_WATER_RADIUS_TILES = 3;
// Tableware in store: with at least TABLEWARE_MIN pieces, +TABLEWARE_HAPPINESS colony happiness, +1 per grade above
// Poor of the best tableware in store.
export const TABLEWARE_MIN = 4;
export const TABLEWARE_HAPPINESS = 3;
