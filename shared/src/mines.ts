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
export const MINE_TILES: readonly TileType[] = [
  TileType.RockMinePost, TileType.IronMinePost, TileType.CoalMine, TileType.CopperMine, TileType.TinMine,
  // Industry extras (shared/src/industry.ts).
  TileType.LimeQuarry, TileType.GoldMine, TileType.LeadMine,
];
export function isMineTile(t: number): boolean {
  return (MINE_TILES as readonly number[]).includes(t);
}
export const MINE_LABEL: Record<number, string> = {
  [TileType.RockMinePost]: "Quarry",
  [TileType.IronMinePost]: "Iron Mine",
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
}
export const MINE_STATUS_LABEL: Record<MineStatus, string> = { clear: "Clear", infested: "Infested", cleared: "Cleared" };
