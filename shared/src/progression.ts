// Natural progression tree (docs/colony2d/PLAN-progression-tree.md; ROADMAP "Progression tree — landed").
// PROGRESSION is the one source of truth for items, recipes, quality grades, professions and what each building
// requires. The server checks placements / upgrades / crafts against it (server/src/progression.ts); the client
// builds its locked "needs: X" build-menu text, Next steps and Craft-by-hand panel from the server's
// `progression` snapshot, which is computed from this table.
import { TileType } from "./protocol.js";

export type ItemId =
  | "stoneAxe" | "stonePick" | "stoneKnife" | "timberProps" | "hide" | "bellows"
  | "charcoal" | "ironBloom" | "anvil" | "smithTools"
  | "woodenPlow" | "millstone" | "clayOven" | "flour" | "gruel" | "flatbread" | "sourdoughStarter" | "bread"
  // Stardew phase 5a: the hero's farming tools (kept) and seed bags (one used per sown tile).
  | "hoe" | "wateringCan" | "scythe" | "wheatSeeds" | "hempSeeds"
  // Stardew phase 5d: animal feed and products (eggs / milk are food), and the tools of the bigger animal houses.
  | "hay" | "egg" | "milk" | "carpenterTools" | "herbs"
  // Gap closure G6: the hero's animal tools and fertiliser.
  | "shears" | "milkPail" | "manure";

export type StockKey = "wood" | "rock" | "iron" | "grain" | "meat" | "fruit" | "wool" | "cotton" | "tools";

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
  items?: Partial<Record<ItemId, number>>;
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
  | "brewer" | "innkeeper" | "hunter" | "forager" | "herder";

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
    stonePick: { label: "Stone pick", desc: "Opens surface outcrops: Quarry and Iron Mine; with a knife, prospecting.", group: "tool" },
    stoneKnife: { label: "Stone knife", desc: "Skins game: Hunter's Hut (hides). With a pick, prospecting.", group: "tool" },
    timberProps: { label: "Timber props", desc: "Pit supports: a mine can be sunk to level 2 (shaft).", group: "tool" },
    hide: { label: "Hide", desc: "From a Hunter's Hut's kills (also pasture animals and game you hunt yourself). Bellows leather.", group: "material" },
    bellows: { label: "Bellows", desc: "Leather and wood. Blows the Bloomery.", group: "tool" },
    charcoal: { label: "Charcoal", desc: "Burned slowly from wood at the Charcoal Burner. Smelting fuel.", group: "material" },
    ironBloom: { label: "Iron bloom", desc: "Smelted at the Bloomery from iron ore and charcoal; a Blast furnace (level 2+) makes better grades.", group: "material" },
    anvil: { label: "Anvil", desc: "Cast at the Bloomery. With hammer and tongs, a Blacksmith can be built.", group: "tool" },
    smithTools: { label: "Hammer & tongs", desc: "Forged at the Bloomery. A Blacksmith needs them.", group: "tool" },
    woodenPlow: { label: "Wooden plow", desc: "Breaks the ground: a Barn (farm fields) can be built.", group: "tool" },
    millstone: { label: "Millstone", desc: "A dressed grinding stone: the Mill needs one.", group: "tool" },
    clayOven: { label: "Clay oven", desc: "Stone and clay: the Bakery needs one.", group: "tool" },
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
  } satisfies Record<ItemId, ItemDef>,
  recipes: [
    { id: "stoneAxe", label: "Knap a stone axe", output: "stoneAxe", amount: 1, stock: { wood: 2, rock: 3 }, station: "hand" },
    { id: "stonePick", label: "Knap a stone pick", output: "stonePick", amount: 1, stock: { wood: 2, rock: 4 }, station: "hand" },
    { id: "stoneKnife", label: "Knap a stone knife", output: "stoneKnife", amount: 1, stock: { wood: 1, rock: 2 }, station: "hand" },
    { id: "timberProps", label: "Cut timber props", output: "timberProps", amount: 1, stock: { wood: 8 }, station: "hand" },
    { id: "bellows", label: "Sew bellows", output: "bellows", amount: 1, stock: { wood: 4 }, items: { hide: 2 }, station: "hand" },
    { id: "woodenPlow", label: "Carve a wooden plow", output: "woodenPlow", amount: 1, stock: { wood: 6, rock: 2 }, station: "hand" },
    { id: "millstone", label: "Dress a millstone", output: "millstone", amount: 1, stock: { rock: 12 }, station: "hand" },
    { id: "clayOven", label: "Build a clay oven", output: "clayOven", amount: 1, stock: { rock: 8, wood: 4 }, station: "hand" },
    { id: "hoe", label: "Make a hoe", output: "hoe", amount: 1, stock: { wood: 2, rock: 2 }, station: "hand" },
    { id: "wateringCan", label: "Make a watering can", output: "wateringCan", amount: 1, stock: { wood: 4 }, station: "hand" },
    { id: "scythe", label: "Knap a scythe", output: "scythe", amount: 1, stock: { wood: 2, rock: 3 }, station: "hand" },
    { id: "wheatSeeds", label: "Sort wheat seed", output: "wheatSeeds", amount: 4, stock: { grain: 2 }, station: "hand" },
    { id: "hempSeeds", label: "Save hemp seed", output: "hempSeeds", amount: 4, stock: { cotton: 2 }, station: "hand" },
    { id: "carpenterTools", label: "Make carpenter's tools", output: "carpenterTools", amount: 1, stock: { wood: 6, rock: 4 }, station: "hand" },
    { id: "shears", label: "Knap shears", output: "shears", amount: 1, stock: { rock: 2, wood: 1 }, needs: { stoneKnife: 1 }, station: "hand" },
    { id: "milkPail", label: "Make a milk pail", output: "milkPail", amount: 1, stock: { wood: 3 }, needs: { carpenterTools: 1 }, station: "hand" },
    { id: "herbs", label: "Dry healing herbs", output: "herbs", amount: 2, stock: { fruit: 3 }, station: "hand" },
    { id: "gruel", label: "Boil wheat gruel", output: "gruel", amount: 3, stock: { grain: 3, wood: 1 }, station: "hand" },
    { id: "charcoal", label: "Burn charcoal", output: "charcoal", amount: 3, stock: { wood: 6 }, station: TileType.CharcoalBurner, seconds: 90, cap: 40 },
    // Bloomery: the anvil and the smith's tools first (one each is enough), then blooms.
    { id: "anvil", label: "Cast an anvil", output: "anvil", amount: 1, items: { ironBloom: 4 }, station: TileType.Bloomery, seconds: 60, cap: 1 },
    { id: "smithTools", label: "Forge hammer & tongs", output: "smithTools", amount: 1, stock: { wood: 2 }, items: { ironBloom: 2 }, station: TileType.Bloomery, seconds: 40, cap: 1 },
    { id: "flour", label: "Grind flour", output: "flour", amount: 2, stock: { grain: 2 }, station: TileType.Mill, seconds: 20, cap: 40 },
    // Bakery: the starter first once the baker is level 2 (a ~3-day culture), then bread while it is kept, else flatbread.
    { id: "sourdoughStarter", label: "Culture a sourdough starter", output: "sourdoughStarter", amount: 1, items: { flour: 1 }, station: TileType.Bakery, seconds: 900, cap: 1, workerLevel: 2 },
    { id: "bread", label: "Bake bread", output: "bread", amount: 2, items: { flour: 2 }, needs: { sourdoughStarter: 1 }, station: TileType.Bakery, seconds: 40, cap: 40 },
    { id: "flatbread", label: "Bake flatbread", output: "flatbread", amount: 2, items: { flour: 2 }, station: TileType.Bakery, seconds: 20, cap: 40 },
    { id: "ironBloom", label: "Smelt an iron bloom", output: "ironBloom", amount: 1, stock: { iron: 3 }, items: { charcoal: 2 }, station: TileType.Bloomery, seconds: 40, cap: 20 },
  ] as Recipe[],
  // What each building needs. Buildings not listed are open from the start.
  buildings: {
    [TileType.LumberjackPost]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.House]: { requires: { items: { stoneAxe: 1 } } },
    [TileType.HunterHut]: { requires: { items: { stoneKnife: 1 } } },
    [TileType.RockMinePost]: {
      requires: { items: { stonePick: 1 } },
      levels: { 2: { items: { timberProps: 1 } }, 3: { buildings: [{ tile: TileType.Blacksmith }] } },
    },
    [TileType.IronMinePost]: {
      requires: { items: { stonePick: 1 } },
      levels: { 2: { items: { timberProps: 1 } }, 3: { buildings: [{ tile: TileType.Blacksmith }] } },
    },
    [TileType.CharcoalBurner]: { requires: { items: { stoneAxe: 1 }, buildings: [{ tile: TileType.LumberjackPost }] } },
    [TileType.Bloomery]: {
      requires: { items: { bellows: 1, charcoal: 2 }, buildings: [{ tile: TileType.CharcoalBurner }] },
      // Level 2 is the Blast furnace (better blooms): iron tools (a Blacksmith) first.
      levels: { 2: { buildings: [{ tile: TileType.Blacksmith }] } },
    },
    [TileType.Blacksmith]: { requires: { items: { anvil: 1, smithTools: 1 }, buildings: [{ tile: TileType.Bloomery }] } },
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
    // weapon rack iron (an Iron Mine); the rug wool (a Sheep Pasture).
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
  } as Partial<Record<TileType, Profession>>,
  // The Progression panel's chains (order only: every step's needs come from `buildings` / `recipes` above).
  chains: [
    { id: "stone", label: "Stone age", steps: [{ item: "stoneAxe" }, { item: "stoneKnife" }, { item: "stonePick" }, { building: TileType.LumberjackPost }, { building: TileType.House }, { building: TileType.HunterHut }, { item: "hide" }] },
    { id: "mining", label: "Mining & ore", steps: [{ item: "stonePick" }, { building: TileType.RockMinePost }, { building: TileType.IronMinePost }, { item: "timberProps" }] },
    { id: "metal", label: "Metal", steps: [{ building: TileType.CharcoalBurner }, { item: "charcoal" }, { item: "bellows" }, { building: TileType.Bloomery }, { item: "ironBloom" }, { item: "anvil" }, { item: "smithTools" }, { building: TileType.Blacksmith }] },
    { id: "food", label: "Food", steps: [{ item: "woodenPlow" }, { building: TileType.BarnPost }, { item: "gruel" }, { item: "millstone" }, { building: TileType.Mill }, { item: "flour" }, { item: "clayOven" }, { building: TileType.Bakery }, { item: "flatbread" }, { item: "sourdoughStarter" }, { item: "bread" }] },
    { id: "cloth", label: "Cloth", steps: [{ building: TileType.WoolFarm }, { building: TileType.CottonFarm }, { building: TileType.TailorShop }] },
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
  hunter: "Hunter", forager: "Forager", herder: "Animal Keeper",
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
  [TileType.IronMinePost]: "Iron Mine",
  [TileType.KnightPost]: "Hall of the Sworn",
  [TileType.Stables]: "Stables",
  [TileType.SiegeWorkshop]: "Siege Workshop",
  [TileType.ChickenCoop]: "Chicken Coop",
  [TileType.LivestockBarn]: "Livestock Barn",
  [TileType.PigSty]: "Pig Sty",
  [TileType.SheepPen]: "Sheep Pen",
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
      out.push(lvl > 1 ? `a level-${lvl} ${name}` : `a ${name}`);
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

// "2 wood + 3 rock + 2 Hide".
export function recipeCostText(r: Recipe): string {
  const parts = Object.entries(r.stock ?? {}).map(([k, n]) => `${n} ${k}`);
  for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) parts.push(`${n} ${PROGRESSION.items[id].label}`);
  for (const id of Object.keys(r.needs ?? {}) as ItemId[]) parts.push(`a ${PROGRESSION.items[id].label} (kept)`);
  return parts.join(" + ") || "Free";
}

// Phase 4: food items eaten at dawn before grain / meat / fruit (food units each; bread most filling) and their
// colony happiness bonus while in stock (bread +2 per grade above Poor).
export const FOOD_ITEMS: { id: ItemId; food: number; happiness: number }[] = [
  { id: "bread", food: 3, happiness: 8 },
  { id: "flatbread", food: 2, happiness: 3 },
  { id: "gruel", food: 1.2, happiness: 0 },
  // Stardew phase 5d: animal products.
  { id: "milk", food: 1, happiness: 2 },
  { id: "egg", food: 0.5, happiness: 2 },
];
