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
export type RoomRole = "room" | "bedroom" | "barracks" | "kitchen" | "workshop" | "hall" | "storeroom" | "church" | "infirmary";
export const ROOM_ROLE_LABEL: Record<RoomRole, string> = {
  room: "Empty room", bedroom: "Bedroom", barracks: "Barracks", kitchen: "Kitchen / dining", workshop: "Workshop",
  hall: "Hall", storeroom: "Storeroom", church: "Chapel", infirmary: "Infirmary",
};
// Barracks: at least this many beds plus a Weapon Rack (fewer beds, or no rack: a bedroom).
export const ROOM_BARRACKS_MIN_BEDS = 3;
// Hall: at least this many tiles with a table or a rug (and no bed / station).
export const ROOM_HALL_MIN_TILES = 30;
// Gap closure G1: tables (a Long Table counts as one), storage pieces (a storeroom), devotional pieces (a chapel's
// faith needs one beside the altar) and the infirmary's medicine chest.
export const ROOM_TABLE_TILES: readonly TileType[] = [TileType.Table, TileType.LongTable];
export const ROOM_STORAGE_TILES: readonly TileType[] = [TileType.Chest, TileType.Shelf, TileType.Wardrobe];
export const ROOM_DEVOTION_TILES: readonly TileType[] = [TileType.Statue, TileType.Lamp];
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
export const ROOM_INFIRMARY_TILES_PER_BED = 5;
export const ROOM_GENERIC_TILES = 9;

// ---- beauty: 50 + (points per tile) x ROOM_BEAUTY_SCALE, clamped 0-100 ----
export const ROOM_BEAUTY_SCALE = 60;
// Points per piece of furniture (beds and stations included).
export const ROOM_BEAUTY_POINTS: Partial<Record<TileType, number>> = {
  [TileType.Rug]: 3, [TileType.Statue]: 8, [TileType.Lamp]: 1, [TileType.Table]: 1, [TileType.Chair]: 1,
  [TileType.Shelf]: 1, [TileType.Hearth]: 2, [TileType.Bed]: 1, [TileType.Chest]: 0, [TileType.WeaponRack]: 0,
  [TileType.Workbench]: -1, [TileType.LongTable]: 2, [TileType.Wardrobe]: 2, [TileType.MedicineChest]: 1,
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
// Phase 6 balance (2026-11-10): 0.08 -> 0.11: a 3-bed bedroom whose residents (and their children) are home a
// good part of the day silted up to cleanliness ~0 (score 68 -> 46); now it holds unless it is occupied ~half the time.
export const ROOM_CLEAN_PER_SEC = 0.11;
// A death inside (blood) adds this much dirt at once.
export const ROOM_DIRT_BLOOD = 30;
// Bare ground never gets cleaner than this x its bare share (mud).
export const ROOM_DIRT_BARE_FLOOR = 40;
// Each damaged boundary piece (rubble, splinters) costs this much cleanliness.
export const ROOM_DIRT_PER_DAMAGED_WALL = 8;

// ---- warmth: base + heat per source (x ROOM_WARMTH_AREA_TILES / tiles, so a hearth warms a small room more) ----
// Phase 6 balance (2026-11-10): 20 -> 30, so a plain bedroom (bed, no floor) is not a happiness malus (q ~0).
export const ROOM_WARMTH_BASE = 30;
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
// Phase 6 balance (2026-11-10): 10 -> 15 (a wood-floored bedroom for everyone: +6, so a fed, housed colony on two
// foods sits above 60 %).
export const ROOM_SLEEP_HAPPINESS_MAX = 15;
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

// ---- Gap closure G1 (2026-11-10): hall, storeroom, chapel and infirmary effects ----
// Hall (social room): colony happiness + ROOM_HALL_HAPPINESS_MAX x score / 100 of the clan's best hall x the gathering
// share: ROOM_HALL_BASE_SHARE + (1 - base) x min(1, gathered / ROOM_HALL_GATHER_FULL), where `gathered` = the most of
// the clan's people seen inside it during the latest dusk (the last ROOM_HALL_DUSK_SECONDS of the day: their free
// time). At dusk an idle villager within ROOM_HALL_GATHER_RANGE_TILES strolls into the best hall (chance per stroll).
export const ROOM_HALL_HAPPINESS_MAX = 6;
export const ROOM_HALL_BASE_SHARE = 0.25;
export const ROOM_HALL_GATHER_FULL = 6;
export const ROOM_HALL_DUSK_SECONDS = 60;
export const ROOM_HALL_GATHER_CHANCE = 0.6;
export const ROOM_HALL_GATHER_RANGE_TILES = 30;
// Storeroom: its goods count as protected. Each storage piece (chest, shelf, wardrobe) protects
// ROOM_STOREROOM_PROTECT_PER_PIECE x (0.5 + score / 100) of the clan stock (every storeroom adds up, at most
// ROOM_STOREROOM_PROTECT_MAX). Protection cuts food spoilage (FOOD_SPOIL_PER_DAY of grain / meat / fruit each new
// calendar day, seasons on) and raid theft (RAID_THEFT_SHARE of every stock good when bandits wreck a building).
export const ROOM_STOREROOM_PROTECT_PER_PIECE = 0.06;
export const ROOM_STOREROOM_PROTECT_MAX = 0.6;
export const FOOD_SPOIL_PER_DAY = 0.02;
export const FOOD_SPOIL_RESOURCES: readonly string[] = ["grain", "meat", "fruit"];
export const RAID_THEFT_SHARE = 0.05;
export const RAID_THEFT_RESOURCES: readonly string[] = ["grain", "meat", "fruit", "wood", "rock", "iron", "gold", "clothes", "tools"];
// Chapel (the Church altar in a room, plus at least one statue or lamp: devotions): faith gives colony happiness +
// ROOM_CHAPEL_HAPPINESS_MAX x score / 100 x the share of the clan's people living / posted within
// ROOM_CHAPEL_RANGE_TILES; the Priest posted at its altar heals x (1 + ROOM_CHAPEL_HEAL_BONUS x max(0, q)); the
// Church resurrection costs (1 - ROOM_CHAPEL_REVIVE_DISCOUNT x score / 100) of its price.
export const ROOM_CHAPEL_HAPPINESS_MAX = 6;
export const ROOM_CHAPEL_RANGE_TILES = 30;
export const ROOM_CHAPEL_HEAL_BONUS = 0.5;
export const ROOM_CHAPEL_REVIVE_DISCOUNT = 0.3;
// Infirmary (beds + a Medicine Chest, roofed): up to one hurt villager / soldier per bed inside heals
// ROOM_INFIRMARY_HEAL_FRAC_PER_SEC of max HP a second x max(ROOM_INFIRMARY_MIN_MULT, 1 + ROOM_INFIRMARY_QUALITY_MULT x q)
// x (1 + ROOM_INFIRMARY_PRIEST_BONUS with a Priest / Forager (herbalist) within ROOM_INFIRMARY_PRIEST_RANGE_TILES)
// x (1 + ROOM_INFIRMARY_MEDICINE_BONUS while a dose of herbs lasts: one is taken from the stores per patient every
// ROOM_INFIRMARY_MEDICINE_SECONDS of treatment). Idle villagers below ROOM_INFIRMARY_SEEK_HP_FRAC of max HP walk
// there. The hero resting in one heals x ROOM_INFIRMARY_HERO_HEAL_MULT (on top of the rest bonus).
export const ROOM_INFIRMARY_HEAL_FRAC_PER_SEC = 0.01;
export const ROOM_INFIRMARY_MIN_MULT = 0.25;
export const ROOM_INFIRMARY_QUALITY_MULT = 0.5;
export const ROOM_INFIRMARY_PRIEST_BONUS = 0.5;
export const ROOM_INFIRMARY_PRIEST_RANGE_TILES = 8;
export const ROOM_INFIRMARY_MEDICINE_BONUS = 1;
export const ROOM_INFIRMARY_MEDICINE_SECONDS = 30;
export const ROOM_INFIRMARY_MEDICINE_ITEM = "herbs";
export const ROOM_INFIRMARY_SEEK_HP_FRAC = 0.7;
export const ROOM_INFIRMARY_SEEK_RANGE_TILES = 30;
export const ROOM_INFIRMARY_HERO_HEAL_MULT = 3;
// Herbs a forager's trip home brings with its fruit (the hand recipe "Dry healing herbs" makes them from fruit too).
export const FORAGER_HERBS_PER_TRIP = 1;

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
const nAny = (counts: Record<number, number>, list: readonly TileType[]) => list.reduce((s, t) => s + (counts[t] ?? 0), 0);
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function roomRole(tiles: number, counts: Record<number, number>): RoomRole {
  if (n(counts, TileType.ChurchPost) > 0) return "church";
  if (ROOM_WORKSHOP_TILES.some((t) => n(counts, t) > 0)) return "workshop";
  const beds = n(counts, TileType.Bed);
  if (beds > 0 && n(counts, TileType.MedicineChest) > 0) return "infirmary";
  if (beds >= ROOM_BARRACKS_MIN_BEDS && n(counts, TileType.WeaponRack) > 0) return "barracks";
  if (beds > 0) return "bedroom";
  const tables = nAny(counts, ROOM_TABLE_TILES);
  if (tables > 0 && n(counts, TileType.Hearth) > 0) return "kitchen";
  if (tiles >= ROOM_HALL_MIN_TILES && (tables > 0 || n(counts, TileType.Rug) > 0)) return "hall";
  if (nAny(counts, ROOM_STORAGE_TILES) > 0) return "storeroom";
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
    case "infirmary": return ROOM_INFIRMARY_TILES_PER_BED * Math.max(1, beds);
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
  if (role === "bedroom") tips.push("A Medicine Chest makes it an infirmary (the hurt heal faster in it)");
  if (role === "church" && nAny(counts, ROOM_DEVOTION_TILES) === 0) tips.unshift("Add a statue or a lamp by the altar: faith needs devotions");
  if (role === "storeroom") tips.push("More chests / shelves protect more of the stock (spoilage, raid theft)");
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
      return [
        `Social: up to +${(ROOM_HALL_HAPPINESS_MAX * st.score / 100).toFixed(1)} colony happiness (the best hall counts)`,
        `Villagers gather here at dusk; ${ROOM_HALL_GATHER_FULL}+ at once for the full bonus (${Math.round(ROOM_HALL_BASE_SHARE * 100)}% without)`,
      ];
    case "storeroom": {
      const p = storeroomProtection(st, counts);
      return [`Protects ${Math.round(p * 100)}% of the stock from spoilage and raid theft (storerooms add up, at most ${Math.round(ROOM_STOREROOM_PROTECT_MAX * 100)}%)`];
    }
    case "church": {
      if (nAny(counts, ROOM_DEVOTION_TILES) === 0) return ["No devotions: add a statue or a lamp for faith, healing and resurrection effects"];
      return [
        `Faith: +${(ROOM_CHAPEL_HAPPINESS_MAX * st.score / 100).toFixed(1)} colony happiness x the share of people within ${ROOM_CHAPEL_RANGE_TILES} tiles`,
        `The Priest here heals x${(1 + ROOM_CHAPEL_HEAL_BONUS * Math.max(0, st.q)).toFixed(2)}; resurrection ${Math.round(ROOM_CHAPEL_REVIVE_DISCOUNT * st.score)}% cheaper`,
      ];
    }
    case "infirmary":
      return [
        `Heals ${(infirmaryHealMult(st) * ROOM_INFIRMARY_HEAL_FRAC_PER_SEC * 100).toFixed(1)}% max HP / s, one patient per bed (x${(1 + ROOM_INFIRMARY_PRIEST_BONUS).toFixed(1)} with a Priest or Forager near, x${1 + ROOM_INFIRMARY_MEDICINE_BONUS} with herbs)`,
        `Villagers under ${Math.round(ROOM_INFIRMARY_SEEK_HP_FRAC * 100)}% HP rest here; the hero resting here heals x${ROOM_INFIRMARY_HERO_HEAL_MULT}`,
      ];
    default:
      return ["No role yet: no effect"];
  }
}

// Storeroom: the share of the stock its storage pieces protect (before the clan-wide cap).
export function storeroomProtection(st: RoomStats, counts: Record<number, number>): number {
  if (st.role !== "storeroom") return 0;
  return nAny(counts, ROOM_STORAGE_TILES) * ROOM_STOREROOM_PROTECT_PER_PIECE * (0.5 + st.score / 100);
}
// Infirmary: the room's heal-rate multiplier from its quality (before the Priest / medicine bonuses).
export function infirmaryHealMult(st: RoomStats): number {
  return Math.max(ROOM_INFIRMARY_MIN_MULT, 1 + ROOM_INFIRMARY_QUALITY_MULT * st.q);
}
// Chapel: has the altar devotions (a statue or a lamp)?
export function chapelHasDevotions(counts: Record<number, number>): boolean {
  return nAny(counts, ROOM_DEVOTION_TILES) > 0;
}

export function roomStationSpeedMult(st: RoomStats, counts: Record<number, number>): number {
  if (st.role !== "workshop") return 1;
  // Never below 1: a poor workshop is no worse than a station out in the open (old saves' stations keep their speed).
  return 1 + ROOM_WORKSHOP_SPEED_MAX * Math.max(0, st.q) + ROOM_WORKBENCH_SPEED * Math.min(ROOM_WORKBENCH_MAX, counts[TileType.Workbench] ?? 0);
}
