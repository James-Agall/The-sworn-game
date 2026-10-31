// Sound triggers: the shared SoundManager and the work / growl / horse / ambient trigger tables (split out of main.ts, no behaviour change).
import { type ColonistSnapshot, PLAYER_SPEED, TileType } from "@colony/shared/protocol";
import { SoundManager } from "./sound";

// ---- Sound triggers (falloff, voice cap, cooldowns and per-key loudness live in sound.ts) ----
export const sound = new SoundManager();
// While a worker stays in its work state it repeats its sound once per work cycle (server
// CHOP_TICKS = 2 s, CRAFT_TICKS = 4 s), each colonist on its own random phase.
export const WORK_SOUND_INTERVAL_MS: Record<string, number> = {
  tree_chop: 2000,
  mine_pick: 2000,
  farm_work: 2000,
  craft_hammer: 4000,
  heal_chime: 2400,
};
// Non-blacksmith artisans hammer quieter.
export const CRAFT_VOLUME_NON_SMITH = 0.6;
// A mob growls (maybe) the first time it comes this close to the local player.
export const MOB_GROWL_RADIUS_TILES = 10;
export const MOB_GROWL_CHANCE = 0.5;
// Horse: gallop loop while the local player moves faster than this (px/s); its playbackRate follows
// speed / PLAYER_SPEED within these bounds. Jumps faster than HORSE_TELEPORT_SPEED are respawns.
export const HORSE_MOVING_MIN_SPEED = 20;
export const HORSE_RATE_MIN = 0.75;
export const HORSE_RATE_MAX = 1.15;
export const HORSE_TELEPORT_SPEED = PLAYER_SPEED * 3;
// Setting off after standing this long may get a whinny.
export const HORSE_WHINNY_IDLE_MS = 10000;
export const HORSE_WHINNY_CHANCE = 0.3;
// Ambient loops (water, campfires): nearest such tile within the silent radius, rescanned this often.
export const AMBIENT_SCAN_MS = 500;
export const AMBIENT_TILE_LOOPS: { tile: TileType; key: string; id: string }[] = [
  { tile: TileType.Water, key: "water_ambient", id: "ambient-water" },
  { tile: TileType.PropCampfire, key: "fire_crackle", id: "ambient-fire" },
];
// Dawn: chime, then the church bell this many seconds later.
export const DAWN_BELL_DELAY_S = 1.2;
// A local placement counts as confirmed if its tileUpdate arrives within this window.
export const PLACEMENT_CONFIRM_MS = 2000;

export function workSoundKey(c: ColonistSnapshot): string | null {
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
