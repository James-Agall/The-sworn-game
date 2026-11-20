// Deep mines (docs/colony2d/PLAN-agri-industry-winter-mines.md phase 3; ROADMAP "Deep mines — landed"). Every mine
// (Quarry, Iron Mine and the new Coal / Copper / Tin mines) is an enterable interior (shared/src/interiors.ts "mine",
// its layout = its depth: level 1 adit, 2 shaft, 3 deep). A mine is clear, infested or cleared: an infested one holds
// encounter monsters (cave spiders, cave bats, skeletons, giant spiders), its miners flee and it produces nothing
// until the hero (inside, fighting) or the clan's soldiers (the "Send soldiers in" order) kill them all. Deep (level
// 3) mines are re-infested now and then unless guarded; lamps, timber props and a Mine Foreman lower the odds and a
// foreman saves the miners. Cheap hazards: worn-out timber props (cave-ins), bad air without a vent, flooding without
// a pump. Every number lives here (server + client).
import { TileType, type MobKind } from "./protocol.js";

// ---- mines and deposits ----
// Every mine tile (each one an interior, infestable from level 2).
// Layered mines (2026-11-19): only two mine buildings remain: the Quarry (RockMinePost, unchanged: one interior whose
// layout is its depth) and the Mine (IronMinePost: one building, its levels are layers, each its own interior entered
// from the one above). The old Coal / Copper / Tin / Lime / Gold / Lead mine tiles are inert legacy (not buildable).
export const MINE_TILES: readonly TileType[] = [TileType.RockMinePost, TileType.IronMinePost];
// The layered Mine.
export function isLayeredMine(t: number): boolean {
  return t === TileType.IronMinePost;
}
export function isMineTile(t: number): boolean {
  return (MINE_TILES as readonly number[]).includes(t);
}
export const MINE_LABEL: Record<number, string> = {
  [TileType.RockMinePost]: "Quarry",
  [TileType.IronMinePost]: "Mine",
  [TileType.CoalMine]: "Coal Mine",
  [TileType.CopperMine]: "Copper Mine",
  [TileType.TinMine]: "Tin Mine",
  [TileType.LimeQuarry]: "Lime Quarry",
  [TileType.GoldMine]: "Gold Mine",
  [TileType.LeadMine]: "Lead Mine",
};
// The new deposits, the mine sunk on each (placed only on its deposit; demolished, the deposit comes back) and the
// item its miner digs (shared/src/progression.ts recipes).
// Industry extras: limestone (flux, lime), gold ore (washed into gold dust) and lead ore, appended (world gen places
// them after the first three, so those keep their spots).
export type DepositItem = "coal" | "copperOre" | "tinOre" | "limestone" | "goldOre" | "leadOre";
export const DEPOSIT_MINES: { deposit: TileType; mine: TileType; item: DepositItem; label: string }[] = [
  { deposit: TileType.CoalSeam, mine: TileType.CoalMine, item: "coal", label: "Coal seam" },
  { deposit: TileType.CopperOre, mine: TileType.CopperMine, item: "copperOre", label: "Copper ore" },
  { deposit: TileType.TinOre, mine: TileType.TinMine, item: "tinOre", label: "Tin ore" },
  { deposit: TileType.Limestone, mine: TileType.LimeQuarry, item: "limestone", label: "Limestone" },
  { deposit: TileType.GoldOre, mine: TileType.GoldMine, item: "goldOre", label: "Gold ore" },
  { deposit: TileType.LeadOre, mine: TileType.LeadMine, item: "leadOre", label: "Lead ore" },
];
export const DEPOSIT_TILES: readonly TileType[] = DEPOSIT_MINES.map((d) => d.deposit);
export function depositMineFor(tile: number) {
  return DEPOSIT_MINES.find((d) => d.mine === tile || d.deposit === tile);
}
// Ore ground a Mine may be sunk on: iron ore or any deposit (the deposits stay as map markers; demolished, a Mine
// gives its ground back).
export function isOreGround(t: number): boolean {
  return t === TileType.IronOre || DEPOSIT_TILES.includes(t as TileType);
}

// ---- the Mine's layers (one per building level; upgrading the Mine opens the next layer) ----
export const MINE_LAYERS = 3;
// What each layer yields: a miner's batch digs 1 (+ a known deposit's bonus) of one resource, rotating over every
// clear / cleared open layer's resources that are under their cap. "iron" is the iron ore stock.
export type MineResource = DepositItem | "iron";
export const MINE_LAYER_YIELDS: { res: MineResource; cap: number }[][] = [
  [{ res: "copperOre", cap: 60 }, { res: "tinOre", cap: 60 }, { res: "limestone", cap: 60 }],
  [{ res: "iron", cap: 400 }, { res: "coal", cap: 80 }],
  [{ res: "goldOre", cap: 40 }, { res: "leadOre", cap: 40 }],
];
export const MINE_RESOURCE_LABEL: Record<MineResource, string> = {
  copperOre: "copper ore", tinOre: "tin ore", limestone: "limestone", iron: "iron ore", coal: "coal", goldOre: "gold ore", leadOre: "lead ore",
};
export const mineLayerResourcesText = (layer: number) => (MINE_LAYER_YIELDS[layer - 1] ?? []).map((y) => MINE_RESOURCE_LABEL[y.res]).join(", ");
// The pickaxe in store a layer needs (the Mine's upgrade gate to it, shared/src/progression.ts).
export const MINE_LAYER_PICK = ["stonePick", "bronzePick", "ironPick"] as const;
// A newly opened layer breaks into a nest at this chance (1: every layer must be cleared before it produces).
export const MINE_LAYER_INFEST_CHANCE = [1, 1, 1];
// Danger by layer: encounter size and kinds (level 1 weak, level 2 skeletons and spiders, level 3 the strongest) and a
// multiplier on every monster's hp and bite.
export const MINE_LAYER_ENCOUNTER: { count: [number, number]; kinds: { kind: MobKind; weight: number }[] }[] = [
  { count: [2, 3], kinds: [{ kind: "caveBat", weight: 3 }, { kind: "caveSpider", weight: 3 }] },
  { count: [3, 5], kinds: [{ kind: "caveSpider", weight: 2 }, { kind: "skeleton", weight: 3 }, { kind: "giantSpider", weight: 2 }] },
  { count: [5, 7], kinds: [{ kind: "skeleton", weight: 3 }, { kind: "giantSpider", weight: 3 }, { kind: "caveSpider", weight: 1 }] },
];
export const MINE_LAYER_MOB_MULT = [1, 1.3, 1.7];
// Re-infestation by layer (rolled every MINE_REINFEST_EVERY_DAYS at dawn on a clear layer, lowered like the Quarry's).
export const MINE_LAYER_REINFEST_CHANCE = [0, 0.25, 0.4];
// World gen: veins per 80x80 tiles of world (scaled by area like ore / rock), each MIN..MAX tiles grown from a seed.
// Placed last, from a hash of the world's noise salt (no shared RNG draws, so older streamed saves keep their worlds).
export const DEPOSIT_VEINS_PER_80: Record<DepositItem, number> = { coal: 6, copperOre: 4, tinOre: 3, limestone: 5, goldOre: 2, leadOre: 3 };
export const DEPOSIT_VEIN_MIN_TILES = 2;
export const DEPOSIT_VEIN_MAX_TILES = 4;
// Veins keep at least this many tiles from the world's centre (the first Town Center).
export const DEPOSIT_START_CLEAR_TILES = 6;

// ---- infestation ----
export type MineStatus = "clear" | "infested" | "cleared";
// When a shaft reaches a level (placed or dug deeper) the depth decides: the chance it breaks into a nest, by level
// (1 surface adit, 2 shaft, 3 deep). Rolled from a hash of the tile, level and world salt (fixed at world gen).
export const MINE_INFEST_CHANCE_BY_LEVEL = [0, 0.35, 0.65];
// An encounter: how many monsters (min, max) and which kinds (weights), by level.
export const MINE_ENCOUNTER_BY_LEVEL: { count: [number, number]; kinds: { kind: MobKind; weight: number }[] }[] = [
  { count: [2, 3], kinds: [{ kind: "caveSpider", weight: 3 }, { kind: "caveBat", weight: 3 }] },
  { count: [3, 4], kinds: [{ kind: "caveSpider", weight: 4 }, { kind: "caveBat", weight: 3 }, { kind: "skeleton", weight: 2 }] },
  { count: [4, 6], kinds: [{ kind: "caveSpider", weight: 3 }, { kind: "giantSpider", weight: 3 }, { kind: "skeleton", weight: 3 }, { kind: "caveBat", weight: 2 }] },
];
// A cleared mine is safe this many days (no re-infestation roll).
export const MINE_CLEAR_GRACE_DAYS = 3;
// Deep mines (level 3) roll for a new nest every this many days (at dawn) unless guarded.
export const MINE_REINFEST_EVERY_DAYS = 2;
export const MINE_REINFEST_CHANCE = 0.4;
// Lamps (Miner's lamps in store) and timber props (in store) lower the roll; a Mine Foreman posted lowers it too.
export const MINE_REINFEST_LIT_MULT = 0.5;
export const MINE_REINFEST_PROPPED_MULT = 0.6;
export const MINE_REINFEST_FOREMAN_MULT = 0.5;
// Guarded: one of the clan's soldiers within this many tiles of the mine at dawn: no roll at all.
export const MINE_GUARD_RADIUS_TILES = 6;
// A nest breaking into a worked mine kills this many of its miners (permanent, village-life rules), none when a
// Mine Foreman (a miner of MINE_FOREMAN_LEVEL) is posted there: the foreman gets them out.
export const MINE_ATTACK_DEATHS = 1;
export const MINE_FOREMAN_LEVEL = 3;

// ---- hazards (cheap versions; the vent and pump are also the level-3 upgrade gates) ----
// Shaft mines (level 2+) wear out a timber prop from the store every this many days; without one they are
// unpropped: a cave-in (closed the rest of the day, a miner hurt) at this chance per dawn.
export const MINE_PROPS_WEAR_DAYS = 3;
export const MINE_CAVE_IN_CHANCE = 0.3;
// Fraction of a miner's max HP a cave-in costs (one miner; never below 1 HP).
export const MINE_CAVE_IN_HURT = 0.5;
// Deep mines (level 3) without an Air vent in store: bad air, work at this speed.
export const MINE_BAD_AIR_SPEED = 0.5;
// Deep mines without a Bucket pump in store: flooded (closed for the day) at this chance per dawn.
export const MINE_FLOOD_CHANCE = 0.3;

// ---- the hero digging at a Mine's ore face (inside, on an open layer; 2026-11-20) ----
// A batch digs this much of one of the layer's resources (into the stores, at the layer's cap like the miners).
export const MINE_HERO_DIG_AMOUNT = 2;
export const MINE_HERO_DIG_SECONDS = 20;
// An unpropped shaft (layer 2+, no timber props in store): a finished batch brings the roof down at this chance: the
// hero is hurt by this fraction of max HP (never below 1), the batch is lost and the Mine is closed for the day.
export const MINE_HERO_CAVE_IN_CHANCE = 0.2;
export const MINE_HERO_CAVE_IN_HURT = 0.25;

// ---- risk preview (the Mine / Quarry panel before an upgrade digs deeper; 2026-11-20) ----
export type MineRisk = "none" | "low" | "medium" | "high" | "certain";
export const MINE_RISK_LABEL: Record<MineRisk, string> = { none: "None", low: "Low", medium: "Medium", high: "High", certain: "Certain" };
export function mineRiskOf(chance: number): MineRisk {
  return chance >= 1 ? "certain" : chance >= 0.5 ? "high" : chance >= 0.25 ? "medium" : chance > 0 ? "low" : "none";
}
// How hard the nest fights (by depth: the Mine's layer, the Quarry's level).
export const MINE_DANGER_LABEL = ["Weak", "Strong", "Deadly"];

// ---- combat inside a mine (interior tiles, the hero's swings use its usual damage / cooldown) ----
// Monsters sleep at their lairs until a hero comes this close (tiles), then hunt it (waking the others near them).
export const MINE_MOB_AGGRO_TILES = 4.5;
export const MINE_MOB_WAKE_TILES = 3;
// A monster bites a hero within this reach (tiles), once per its cooldown.
export const MINE_MOB_REACH_TILES = 0.85;
// The hero's reach indoors (tiles): melee, a spear, a bow.
export const MINE_HERO_REACH_TILES = 1.4;
export const MINE_HERO_SPEAR_REACH_TILES = 1.9;
export const MINE_HERO_BOW_REACH_TILES = 5;
// Encounter monster stats (hp, damage per bite, speed tiles/s, bite cooldown ticks). Also the server's world config
// for the two cave kinds (creative can spawn them outside).
export const MINE_MOB_STATS: Partial<Record<MobKind, { hp: number; damage: number; speed: number; cooldownTicks: number }>> = {
  caveSpider: { hp: 20, damage: 4, speed: 2.4, cooldownTicks: 20 },
  caveBat: { hp: 10, damage: 2, speed: 3, cooldownTicks: 16 },
  skeleton: { hp: 50, damage: 8, speed: 1.6, cooldownTicks: 26 },
  giantSpider: { hp: 35, damage: 7, speed: 2.2, cooldownTicks: 22 },
};
// Monsters move / are sent this often (ticks) while a hero is inside.
export const MINE_MOB_SEND_TICKS = 3;

// ---- loot (per kill, into the clan's stores) ----
// Ore: the mine's own product (Quarry rock, Iron Mine iron, coal / copper ore / tin ore) per kill.
export const MINE_LOOT_ORE = 2;
// Bones (skeletons always, others at this chance) and rough gems (rare; skeletons and giant spiders more often).
export const MINE_LOOT_BONES_CHANCE = 0.35;
export const MINE_LOOT_GEM_CHANCE: Partial<Record<MobKind, number>> = { skeleton: 0.12, giantSpider: 0.12, caveSpider: 0.04, caveBat: 0.02 };
// Clearing a mine: gold to the clan.
export const MINE_CLEAR_GOLD = 20;

// ---- soldiers sent in (mineAssault: resolved at once, in rounds of a second) ----
export const MINE_ASSAULT_RADIUS_TILES = 12;
export const MINE_ASSAULT_MAX_SOLDIERS = 6;
export const MINE_ASSAULT_MAX_ROUNDS = 60;

// ---- wire ----
// One encounter monster inside the mine (message interiorMobs): interior tiles (fractional), facing, what it does.
export interface MineMobLive {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  face: "l" | "r";
  act: "sleep" | "idle" | "walk" | "attack";
}
// The mine's line in the interior view (status, monsters left, hazards now).
export interface MineView {
  // The mine's tile (its ore face is drawn in its colours).
  tile: number;
  // Layered Mine: the layer the hero is on (1-3), the layers open, what this layer yields.
  layer?: number;
  layers?: number;
  yields?: string;
  status: MineStatus;
  monsters: number;
  hazards: string[];
}
// Building panel (BuildingInfo.mine) of your own mine.
export interface MineInfo {
  status: MineStatus;
  monsters: number;
  lines: string[];
  // "Send soldiers in": soldiers near enough, and why it is refused ("" = allowed).
  assault: { soldiers: number; reason: string };
  // The next depth's risk, shown before the upgrade that digs it (absent at the bottom / with the gates off): the
  // level, the nest chance and its label, how hard the nest fights, and the detail lines (monsters, returns, hazards).
  preview?: { level: number; chance: number; risk: MineRisk; danger: string; lines: string[] };
}
export const MINE_STATUS_LABEL: Record<MineStatus, string> = { clear: "Clear", infested: "Infested", cleared: "Cleared" };
