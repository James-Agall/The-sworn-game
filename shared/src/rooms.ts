// Modular building phase 2 (2026-11-09, docs/colony2d/PLAN-rimworld-stardew.md): room roles, stats and effects.
// EVERY room number lives here (server effects, the Room panel and the build-menu text all read these).
//
// A room (shared/src/structures.ts findRooms: a roofed, enclosed area of at most ROOM_MAX_TILES) gets a ROLE from
// what stands in it and four STATS, each 0-100: size (for its role), beauty (furniture, floor, rugs, statues),
// cleanliness (dirt from traffic and blood, cleaned over time; damaged walls count as rubble) and warmth (hearths,
// lamps, ovens, roof; windows lose heat). The SCORE is their weighted sum; its quality q = (score - 50) / 50 in
// [-1, 1] drives the effects (bedroom sleep, workshop speed, kitchen meals, barracks morale, hero rest).
import { TileType } from "./protocol.js";

// ---- roles ----
export type RoomRole = "room" | "bedroom" | "barracks" | "kitchen" | "workshop" | "hall" | "storeroom" | "church";
export const ROOM_ROLE_LABEL: Record<RoomRole, string> = {
  room: "Empty room", bedroom: "Bedroom", barracks: "Barracks", kitchen: "Kitchen / dining", workshop: "Workshop",
  hall: "Hall", storeroom: "Storeroom", church: "Chapel",
};
// Barracks: at least this many beds plus a Weapon Rack (fewer beds, or no rack: a bedroom).
export const ROOM_BARRACKS_MIN_BEDS = 3;
// Hall: at least this many tiles with a table or a rug (and no bed / station).
export const ROOM_HALL_MIN_TILES = 30;
// Stations that heat a room like a hearth (ovens, forges, kilns).
export const ROOM_HOT_STATIONS: readonly TileType[] = [TileType.Bakery, TileType.Blacksmith, TileType.Bloomery, TileType.CharcoalBurner, TileType.Brewery];
// Stations (and the Workbench) that make a room a workshop.
export const ROOM_WORKSHOP_TILES: readonly TileType[] = [
  TileType.Blacksmith, TileType.TailorShop, TileType.LuxuryWorkshop, TileType.Brewery, TileType.Bloomery,
  TileType.CharcoalBurner, TileType.Mill, TileType.Bakery, TileType.Tavern, TileType.Workbench,
];

// ---- size: tiles a role wants (size stat = tiles / wanted, capped at 100) ----
export const ROOM_BEDROOM_TILES_PER_BED = 6;
export const ROOM_BARRACKS_TILES_PER_BED = 4;
export const ROOM_KITCHEN_TILES = 12;
export const ROOM_WORKSHOP_TILES_WANTED = 12;
export const ROOM_STOREROOM_TILES = 6;
export const ROOM_GENERIC_TILES = 9;

// ---- beauty: 50 + (points per tile) x ROOM_BEAUTY_SCALE, clamped 0-100 ----
export const ROOM_BEAUTY_SCALE = 60;
// Points per piece of furniture (beds and stations included).
export const ROOM_BEAUTY_POINTS: Partial<Record<TileType, number>> = {
  [TileType.Rug]: 3, [TileType.Statue]: 8, [TileType.Lamp]: 1, [TileType.Table]: 1, [TileType.Chair]: 1,
  [TileType.Shelf]: 1, [TileType.Hearth]: 2, [TileType.Bed]: 1, [TileType.Chest]: 0, [TileType.WeaponRack]: 0,
  [TileType.Workbench]: -1,
};
// Floor points per tile (a furniture tile counts its piece's points instead: a table on bare ground is not mud).
export const ROOM_BEAUTY_WOOD_FLOOR = 0.15;
export const ROOM_BEAUTY_STONE_FLOOR = 0.25;
export const ROOM_BEAUTY_BARE_GROUND = -0.4;

// ---- cleanliness: 100 - dirt (dirt 0-100, per room, saved) ----
// Each unit standing inside adds this much dirt a second, scaled down for big rooms (x ROOM_DIRT_AREA_TILES / tiles).
export const ROOM_DIRT_PER_VISITOR_SEC = 0.12;
export const ROOM_DIRT_AREA_TILES = 12;
// Dirt cleaned away every second (people sweep up).
export const ROOM_CLEAN_PER_SEC = 0.08;
// A death inside (blood) adds this much dirt at once.
export const ROOM_DIRT_BLOOD = 30;
// Bare ground never gets cleaner than this x its bare share (mud).
export const ROOM_DIRT_BARE_FLOOR = 40;
// Each damaged boundary piece (rubble, splinters) costs this much cleanliness.
export const ROOM_DIRT_PER_DAMAGED_WALL = 8;

// ---- warmth: base + heat per source (x ROOM_WARMTH_AREA_TILES / tiles, so a hearth warms a small room more) ----
export const ROOM_WARMTH_BASE = 20;
export const ROOM_WARMTH_STONE_ROOF = 10;
export const ROOM_WARMTH_AREA_TILES = 16;
export const ROOM_WARMTH_PER_HEARTH = 45;
export const ROOM_WARMTH_PER_LAMP = 10;
export const ROOM_WARMTH_PER_HOT_STATION = 30;
export const ROOM_WARMTH_PER_RUG = 3;
export const ROOM_WARMTH_PER_WINDOW = -4;

// ---- score: weighted stats ----
export const ROOM_SCORE_WEIGHTS = { size: 0.15, beauty: 0.35, cleanliness: 0.25, warmth: 0.25 };
// Tier names by score (the first whose bound the score is below).
export const ROOM_TIERS: readonly [number, string][] = [[20, "Awful"], [40, "Poor"], [55, "Decent"], [70, "Good"], [85, "Excellent"], [101, "Superb"]];

// ---- effects (q = (score - 50) / 50, -1..1) ----
// Bedroom / barracks: each resident (a person whose home is a bed in it) sleeps at q; colony happiness gets
// ROOM_SLEEP_HAPPINESS_MAX x the mean q over the clan's people (people housed elsewhere count 0).
export const ROOM_SLEEP_HAPPINESS_MAX = 10;
// Hero resting in a bedroom: rest gain x (ROOM_HERO_REST_MULT + ROOM_HERO_REST_QUALITY_MULT x q) (at least 1).
export const ROOM_HERO_REST_MULT = 3;
export const ROOM_HERO_REST_QUALITY_MULT = 2;
// Workshop: a station's work speed x (1 + ROOM_WORKSHOP_SPEED_MAX x max(0, q) + ROOM_WORKBENCH_SPEED per Workbench, at most
// ROOM_WORKBENCH_MAX); at score ROOM_WORKSHOP_GRADE_SCORE+ its output is one grade better (at most Fine).
export const ROOM_WORKSHOP_SPEED_MAX = 0.25;
export const ROOM_WORKBENCH_SPEED = 0.1;
export const ROOM_WORKBENCH_MAX = 2;
export const ROOM_WORKSHOP_GRADE_SCORE = 70;
// Kitchen / dining: colony happiness + ROOM_DINING_HAPPINESS_MAX x score / 100 of the clan's best kitchen (meals).
export const ROOM_DINING_HAPPINESS_MAX = 8;
// Barracks: the clan's soldiers lose morale x (1 - ROOM_BARRACKS_MORALE_RESIST x score / 100) of its best barracks.
export const ROOM_BARRACKS_MORALE_RESIST = 0.3;
// "Needs a roofed room": NEW placements of these stations must stand inside a roofed room (creative mode and old
// buildings are exempt; upgrades in place are too).
export const ROOM_REQUIRED_STATIONS: readonly TileType[] = [TileType.Bakery, TileType.Blacksmith];

export interface RoomStatsInput {
  tiles: number;
  counts: Record<number, number>;
  windows: number;
  stone: boolean;
  dirt: number;
  damagedWalls: number;
}
export interface RoomStats {
  role: RoomRole;
  size: number;
  beauty: number;
  cleanliness: number;
  warmth: number;
  score: number;
  tier: string;
  // (score - 50) / 50.
  q: number;
  tips: string[];
}

const n = (counts: Record<number, number>, t: TileType) => counts[t] ?? 0;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function roomRole(tiles: number, counts: Record<number, number>): RoomRole {
  if (n(counts, TileType.ChurchPost) > 0) return "church";
  if (ROOM_WORKSHOP_TILES.some((t) => n(counts, t) > 0)) return "workshop";
  const beds = n(counts, TileType.Bed);
  if (beds >= ROOM_BARRACKS_MIN_BEDS && n(counts, TileType.WeaponRack) > 0) return "barracks";
  if (beds > 0) return "bedroom";
  if (n(counts, TileType.Table) > 0 && n(counts, TileType.Hearth) > 0) return "kitchen";
  if (tiles >= ROOM_HALL_MIN_TILES && (n(counts, TileType.Table) > 0 || n(counts, TileType.Rug) > 0)) return "hall";
  if (n(counts, TileType.Chest) + n(counts, TileType.Shelf) > 0) return "storeroom";
  return "room";
}

function wantedTiles(role: RoomRole, beds: number): number {
  switch (role) {
    case "bedroom": return ROOM_BEDROOM_TILES_PER_BED * Math.max(1, beds);
    case "barracks": return ROOM_BARRACKS_TILES_PER_BED * beds;
    case "kitchen": return ROOM_KITCHEN_TILES;
    case "workshop": return ROOM_WORKSHOP_TILES_WANTED;
    case "hall": return ROOM_HALL_MIN_TILES;
    case "storeroom": return ROOM_STOREROOM_TILES;
    default: return ROOM_GENERIC_TILES;
  }
}

export function roomStats(r: RoomStatsInput): RoomStats {
  const { tiles, counts } = r;
  const role = roomRole(tiles, counts);
  const beds = n(counts, TileType.Bed);
  const size = clamp((tiles / wantedTiles(role, beds)) * 100);
  // Beauty.
  let points = 0;
  let bare = 0;
  for (const [k, v] of Object.entries(counts)) {
    const t = Number(k) as TileType;
    if (t === TileType.WoodFloor) points += ROOM_BEAUTY_WOOD_FLOOR * v;
    else if (t === TileType.StoneFloor) points += ROOM_BEAUTY_STONE_FLOOR * v;
    else if (t === TileType.Empty || t === TileType.Road || t === TileType.CobbleRoad || t === TileType.ConstructionSite) bare += v;
    else {
      points += (ROOM_BEAUTY_POINTS[t] ?? 0) * v;
    }
  }
  points += ROOM_BEAUTY_BARE_GROUND * bare;
  const beauty = clamp(50 + (points / Math.max(1, tiles)) * ROOM_BEAUTY_SCALE);
  // Cleanliness.
  const bareShare = bare / Math.max(1, tiles);
  const dirt = Math.max(r.dirt, ROOM_DIRT_BARE_FLOOR * bareShare) + ROOM_DIRT_PER_DAMAGED_WALL * r.damagedWalls;
  const cleanliness = clamp(100 - dirt);
  // Warmth.
  const area = ROOM_WARMTH_AREA_TILES / Math.max(ROOM_WARMTH_AREA_TILES, tiles);
  const hot = ROOM_HOT_STATIONS.reduce((s, t) => s + n(counts, t), 0);
  const heat = n(counts, TileType.Hearth) * ROOM_WARMTH_PER_HEARTH + n(counts, TileType.Lamp) * ROOM_WARMTH_PER_LAMP + hot * ROOM_WARMTH_PER_HOT_STATION;
  const warmth = clamp(ROOM_WARMTH_BASE + (r.stone ? ROOM_WARMTH_STONE_ROOF : 0) + heat * area + n(counts, TileType.Rug) * ROOM_WARMTH_PER_RUG + r.windows * ROOM_WARMTH_PER_WINDOW);
  const w = ROOM_SCORE_WEIGHTS;
  const score = clamp(size * w.size + beauty * w.beauty + cleanliness * w.cleanliness + warmth * w.warmth);
  const tier = ROOM_TIERS.find(([bound]) => score < bound)?.[1] ?? "Superb";
  // Tips, the cheapest / biggest first.
  const tips: string[] = [];
  if (size < 70) tips.push(role === "bedroom" || role === "barracks" ? `Cramped: ${wantedTiles(role, beds)} tiles suit ${beds} bed${beds === 1 ? "" : "s"} (has ${tiles})` : `Small for a ${ROOM_ROLE_LABEL[role].toLowerCase()}: ${wantedTiles(role, beds)} tiles suit it (has ${tiles})`);
  if (bareShare > 0.25) tips.push("Bare ground: lay a wood or stone floor (beauty, cleanliness)");
  if (warmth < 50) tips.push("Cold: add a hearth or a lamp (fewer windows, a stone roof help)");
  if (beauty < 60) tips.push("Plain: a rug, a statue or a lamp makes it nicer");
  if (r.damagedWalls > 0) tips.push(`${r.damagedWalls} damaged wall piece${r.damagedWalls === 1 ? "" : "s"}: repair (rubble lowers cleanliness)`);
  else if (cleanliness < 60) tips.push("Dirty: it is swept clean over time; less traffic through it helps");
  if (role === "room") tips.push("Give it a role: a bed (bedroom), a table + hearth (kitchen), a station or workbench (workshop), a chest (storeroom)");
  if (role === "bedroom" && beds >= ROOM_BARRACKS_MIN_BEDS && n(counts, TileType.WeaponRack) === 0) tips.push("A Weapon Rack makes it a barracks (soldiers' morale)");
  return { role, size, beauty, cleanliness, warmth, score, tier, q: (score - 50) / 50, tips: tips.slice(0, 4) };
}

// Effects text for the Room panel.
export function roomEffectLines(st: RoomStats, counts: Record<number, number>): string[] {
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
  switch (st.role) {
    case "bedroom":
    case "barracks": {
      const lines = [`Sleep quality ${pct(st.q)}: each resident adds ${(ROOM_SLEEP_HAPPINESS_MAX * st.q).toFixed(1)} happiness / population`];
      lines.push(`A hero resting here recovers x${Math.max(1, ROOM_HERO_REST_MULT + ROOM_HERO_REST_QUALITY_MULT * st.q).toFixed(1)}`);
      if (st.role === "barracks") lines.push(`Soldiers lose ${Math.round(ROOM_BARRACKS_MORALE_RESIST * st.score)}% less morale (the best barracks counts)`);
      return lines;
    }
    case "workshop": {
      const benches = Math.min(ROOM_WORKBENCH_MAX, counts[TileType.Workbench] ?? 0);
      const lines = [`Station speed x${roomStationSpeedMult(st, counts).toFixed(2)}${benches ? ` (${benches} workbench${benches === 1 ? "" : "es"})` : ""}`];
      lines.push(st.score >= ROOM_WORKSHOP_GRADE_SCORE ? "Output one grade better" : `Score ${ROOM_WORKSHOP_GRADE_SCORE}+: output one grade better`);
      return lines;
    }
    case "kitchen":
      return [`Meals: +${(ROOM_DINING_HAPPINESS_MAX * st.score / 100).toFixed(1)} colony happiness (the best kitchen counts)`];
    case "hall":
      return ["A gathering hall (no effect yet)"];
    case "storeroom":
      return ["Storage (stockpile zones in it are tidier; no effect yet)"];
    case "church":
      return ["A chapel round the church (no extra effect yet)"];
    default:
      return ["No role yet: no effect"];
  }
}

export function roomStationSpeedMult(st: RoomStats, counts: Record<number, number>): number {
  if (st.role !== "workshop") return 1;
  // Never below 1: a poor workshop is no worse than a station out in the open (old saves' stations keep their speed).
  return 1 + ROOM_WORKSHOP_SPEED_MAX * Math.max(0, st.q) + ROOM_WORKBENCH_SPEED * Math.min(ROOM_WORKBENCH_MAX, counts[TileType.Workbench] ?? 0);
}
