// constants.ts: Tuning numbers and constant tables (pure data: no runtime imports of other server modules).
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HungerMark, TICK_RATE, type Stance, TILE_SIZE, type MobKind, type HeroClass, type SiegeKind, type ColonistKind,
  type EquipSlot, type BossTier, type Difficulty, TileType, WildlifeState, type RegimentClass, type ArmyOrderKind,
  type CombatRole, type SaveSlot, type ItemSlotKind, type ItemStats, type SpellId, FIGHT_WINDOW_SECONDS,
} from "@colony/shared/protocol";
import { BUILD_COSTS } from "@colony/shared/buildings";
import type {
  Cost, CraftRecipe, DifficultyTuning, MobKindConfig, PoiSiteKind, RaidFactionEntry, RaidFactionId,
  RaidFormationShape, ResourceKey, SiteTemplate, SiteTemplateId, TileCoord, WildlifeMode,
} from "./types.js";

// The scripted server/*.mjs tests assume 80x80: run the server with COLONY_WORLD_SIZE=80 for them.
// The size is chosen per world (main menu / restart / save); COLONY_WORLD_SIZE is only the boot default.
// setWorldSize() (below, once every size-dependent module value is declared) re-allocates them all.
export const MIN_WORLD_SIZE = 64;
export const MAX_WORLD_SIZE = 512;
export const clampWorldSize = (n: number) => Math.min(MAX_WORLD_SIZE, Math.max(MIN_WORLD_SIZE, Math.round(n)));
// Things that cost CPU every tick (wildlife) or are expensive to populate (POIs and their guardians,
// mini-bosses) scale by area only up to the 160x160 tuning (scale 4); beyond that, as the 4th root, so a
// 512 map gets ~1.8x a 160 map's count instead of ~10x.
export const SUBLINEAR_FULL_SCALE = 4;
// Defaults for the Mob fields every creation site shares (spread into each Mob literal).
export const MOB_MARK_DEFAULTS = {
  mark: HungerMark.None,
  furyUntilTick: 0,
  feintTargetId: null,
  feintUntilTick: 0,
  withdrawUntilTick: 0,
  withdrawFromX: 0,
  withdrawFromY: 0,
  approachFor: null,
  approachX: -1,
  approachY: -1,
};
export const STARTING_WOOD = 80;
export const STARTING_IRON = 60;
export const STARTING_ROCK = 60;
// 60 (was 40): fields and animal farms now take ~3 days to deliver their first batch, so the
// opening stock has to carry a ~20-consumer colony through 3 dawns (see FARM_* / FARMHAND_*).
export const STARTING_GRAIN = 60;
// ---- Building hit points (mobs damage buildings; builders repair them) ----
// Max HP by building class, times BUILDING_HP_LEVEL_MULT[level - 1]. Town Centers keep their own HP
// (TOWN_CENTER_MAX_HP_BY_LEVEL). Classes: see buildingBaseHp.
// Walls & gates (2026-10-23): wood wall 60 -> 200, stone wall 250 (was BIG) -> 900; the gate sits
// between them so a mob storming a gate beats breaching stone but not wood (see breachStepCost).
export const BUILDING_HP_WALL = 200;
export const BUILDING_HP_STONE_WALL = 900;
export const BUILDING_HP_GATE = 450;
export const BUILDING_HP_SMALL = 120;
export const BUILDING_HP_WORKPLACE = 180;
export const BUILDING_HP_BIG = 250;
export const BUILDING_HP_LEVEL_MULT = [1, 1.4, 1.8];
// A mob with no guard / player to fight goes for the nearest building; it breaks through a wall only
// when no route exists, or the route is longer than BREACH_DETOUR_FACTOR x the straight distance (and
// longer than BREACH_MIN_ROUTE_TILES, so short walks around a wall end are never breached).
export const BREACH_DETOUR_FACTOR = 3;
export const BREACH_MIN_ROUTE_TILES = 12;
// Passed to routeToBuilding to run the breach search (> 0). Since walls & gates (2026-10-23) the cost of
// crossing each wall / closed gate tile is breachStepCost (HP and tower defence), not this flat value.
export const BREACH_WALL_COST = 8;
// How many of the nearest buildings get a route check per target pick.
export const BUILDING_TARGET_CANDIDATES = 3;
// Repair: a builder heals max HP over REPAIR_SECONDS_FULL (times its builder rate); materials cost
// REPAIR_COST_FRACTION of the building's own placement cost for a full 0 -> max repair, charged
// (rounded up) for the HP missing when the repair starts.
export const REPAIR_SECONDS_FULL = 60;
export const REPAIR_COST_FRACTION = 0.3;
// Builders don't start (and walk away from) a repair with a mob this close to the building.
export const REPAIR_MOB_CLEARANCE_TILES = 8;
// Max HP per Town Center level (1-3).
export const TOWN_CENTER_MAX_HP_BY_LEVEL = [1000, 1500, 2000];
// Each level above 1 of the HIGHEST standing Town Center adds this much colony-wide productivity (via
// productionSpeedMultiplier) and unit damage (via armyDamageMultiplier): +5% at Lv2, +10% at Lv3.
export const TOWN_CENTER_LEVEL_BONUS_PER_STEP = 0.05;
// ...and this much to the population base.
export const TOWN_CENTER_LEVEL_POPULATION_BONUS = 5;
// Biome gameplay effects (see generateBiomes for how biomes are laid out).
export const SWAMP_SPEED_PENALTY = 0.25;
export const HILLS_MINING_BONUS = 0.2;
export const PLAINS_FARMING_BONUS = 0.2;
// Roads (Road / Cobble Road tiles): colonists and players standing on one move this much faster
// (on top of the biome multiplier). Mobs get no bonus.
export const ROAD_SPEED_BONUS = 0.25;
export const PATH_NODE_BUDGET = 60000;
// advanceAlongPath: how near (px) an intermediate waypoint's tile centre counts as reached.
export const PATH_WAYPOINT_TOLERANCE_PX = 10;
// ---- Long days (2026-10-23): a 5-minute day and a 75 s night (was 60 s + 40 s). ----
// The night stays short so raids stay tense; the day is long so there's more to DO between raids.
// LEGACY_* is the old cycle: rates that must not slow down in real time are written as
// legacy-rate x DAY_LENGTH_SCALE / DAYLIGHT_SCALE (see ROADMAP "Long days & dawn/dusk respawns").
export const DAY_TICKS = TICK_RATE * 300;
export const NIGHT_TICKS = TICK_RATE * 75;
export const LEGACY_DAY_TICKS = TICK_RATE * 60;
export const LEGACY_NIGHT_TICKS = TICK_RATE * 40;
// Real-time length of a whole cycle vs the old one (375 s / 100 s = 3.75) and of the daylight (5).
export const DAY_LENGTH_SCALE = (DAY_TICKS + NIGHT_TICKS) / (LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS);
export const DAYLIGHT_SCALE = DAY_TICKS / LEGACY_DAY_TICKS;
export const GUARD_ALERT_RANGE_TILES = 7;
// Per-stance combat tuning for guard-tier units. Alert range: how close (from the unit) a mob must be
// before it's picked up as a target; "normal" is the original flat GUARD_ALERT_RANGE_TILES, so a unit
// nobody touches behaves as before. Chase leash: how far from its own rally point (rallyX/rallyY) a
// unit will go while closing on an out-of-range target before giving up and walking home.
export const STANCE_ALERT_RANGE_TILES: Record<Stance, number> = {
  defensive: 3,
  normal: GUARD_ALERT_RANGE_TILES,
  aggressive: 12,
};
// Line discipline: how far (tiles) a soldier may leave its rally slot to fight. Only mobs within this
// leash + attack range of the slot are picked up, a chase past it is dropped, and the unit walks back
// to its slot afterwards, so the line re-forms instead of dissolving. (Replaced the old 2/10/20 leash.)
// Battle discipline (2026-10-23) tightened normal 4 -> 3 and aggressive 8 -> 6 so a line holds its shape.
export const LINE_LEASH_TILES: Record<Stance, number> = {
  defensive: 1.5,
  normal: 3,
  aggressive: 6,
};
// Battle discipline: a soldier with no commanded target fights the enemy nearest to ITS OWN slot (not to
// wherever the scrum has pushed it), and re-checks once a second while not trading blows, switching
// only when another enemy is clearly nearer the slot (below this fraction of the current one's distance).
export const SLOT_RETARGET_FACTOR = 0.7;
// Melee attackers per unit target (see meleeAttackerCap): surplus attackers pick another enemy with room
// or wait (a queue) - soldiers on their own formation slot, mobs standing off this far outside strike
// range - instead of everyone piling onto one target. Players are exempt (their ring decides).
export const QUEUE_STANDOFF_PX = TILE_SIZE * 1.2;
// A melee attacker this close (px) to strike range closes straight on its target rather than walking
// round to its ring slot (it slides there while fighting); the far side can be walled off by bodies.
export const SLOT_CLOSE_IN_PX = TILE_SIZE * 0.5;
// How much further (px) a melee mob will go for a soldier with room than for the nearest one (pickMobTarget).
export const MOB_ROOM_DETOUR_PX = TILE_SIZE * 4;
// Archers don't advance past the front rank: the nearest friendly melee soldier (within this many
// tiles of the archer) to the target marks the front.
export const ARCHER_FRONT_RANK_SCAN_TILES = 6;
// Regiments & roles: a ranged unit (archer, or a raid's crossbow / archer / shaman) with a friendly front
// rank near it kites a step back when an enemy melee unit comes within this many tiles.
export const RANGED_KITE_TILES = 2;
// Squad march (updateSquadMarch): a squad on a formation move advances at its slowest member's pace;
// a member more than SQUAD_LEAD_TOLERANCE_TILES ahead of its place in the formation slows to
// SQUAD_AHEAD_SPEED_FACTOR of that pace, one that far behind catches up at its own speed. Within
// SQUAD_SETTLE_TILES of the destination (centroid of the slots) members settle onto their slots alone;
// with a member over SQUAD_BROKEN_TILES out of place the line is broken and nobody waits.
export const SQUAD_LEAD_TOLERANCE_TILES = 1;
export const SQUAD_AHEAD_SPEED_FACTOR = 0.25;
export const SQUAD_SETTLE_TILES = 2.5;
export const SQUAD_BROKEN_TILES = 6;
// Mob aggro: a guard / militia or a player is only a mob target within these ranges (tiles) of the mob;
// otherwise the mob goes for buildings. A mob already on a unit drops it past MOB_AGGRO_DROP_FACTOR x.
export const MOB_AGGRO_RANGE_GUARD_TILES = 9;
export const MOB_AGGRO_RANGE_PLAYER_TILES = 7;
export const MOB_AGGRO_DROP_FACTOR = 1.5;
// A mob (or marching raid group) heading for the Town Center turns on any non-wall building it passes
// within this many tiles ("if they find houses first they destroy the houses").
export const MOB_BUILDING_AGGRO_TILES = 6;
// ---- Bodies (separation) ----
// Body radii in px: colonists, and mobs by kind (about 0.9 x the client's MOB_VISUALS radius). Players
// have no body. separateBodies pushes overlapping bodies apart after everyone has moved.
export const COLONIST_BODY_RADIUS = 7;
export const PLAYER_BODY_RADIUS = 8;
export const MOB_BODY_RADIUS: Record<MobKind, number> = {
  goblin: 7,
  wolf: 7.5,
  goblinCrossbow: 7,
  orc: 9,
  skeleton: 8,
  armoredOrc: 10,
  giantSpider: 8.5,
  darkShaman: 7.5,
  troll: 12,
  ogre: 14,
  banditClubman: 7.5,
  banditArcher: 7.5,
  banditElite: 9,
  halfLatch: 5.5,
  batteringRam: 12,
  catapult: 11,
  goblinRider: 8,
  townGuard: 7,
  townArcher: 7,
  townKnight: 8,
  townFarmer: 7,
  townMiner: 7,
  townPriest: 7,
};
// Scale pass: the body grows with the mob's size (mobSizeScale: kind x roll x boss tier), capped so a
// boss still fits the one-cell neighbour scan of separateBodies.
export const MOB_BODY_RADIUS_MAX = TILE_SIZE * 0.7;
export const SEPARATION_ITERATIONS = 2;
// Share of an overlap a stationary / attacking body takes vs a moving one (normalised per pair).
export const SEPARATION_WEIGHT_STILL = 0.3;
export const SEPARATION_WEIGHT_MOVING = 0.7;
// Nothing within this many tiles of an active ward source (a staffed Ward Stone, or Saint Wren's
// Abbey, which is always warded) can be chosen as a mob target. See activeWardSources.
export const WARD_RADIUS_TILES = 12;
export const LEVEL_BONUS_PER_STEP = 0.05;
export const KNIGHT_LEVEL_STATS = [
  { maxHp: 60, damage: 12 },
  { maxHp: 100, damage: 20 },
  { maxHp: 160, damage: 32 },
];
export const KNIGHT_ATTACK_RANGE = TILE_SIZE * 0.8;
export const KNIGHT_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.8);
export const KNIGHT_SPEED = 110;
export const ARCHER_MAX_HP = 35;
export const ARCHER_DAMAGE = 8;
export const ARCHER_ATTACK_RANGE = TILE_SIZE * 4;
export const ARCHER_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 1.2);
export const ARCHER_SPEED = 100;
export const MILITIA_LEVEL_STATS = [
  { maxHp: 30, damage: 6 },
  { maxHp: 50, damage: 10 },
  { maxHp: 80, damage: 16 },
];
export const MILITIA_SPEED = 120;
export const CIVILIAN_MAX_HP = 20;
// ---- Cavalry & siege (ROADMAP "Cavalry & siege") ----
// Cavalry: knight HP / damage per Stables level, 1.6x the knight's speed, and a charge: the first blow
// after riding CAVALRY_CHARGE_TILES in a straight line deals CAVALRY_CHARGE_MULT x (then
// CAVALRY_CHARGE_COOLDOWN_TICKS before the next charge can land). See trackCharge.
export const CAVALRY_SPEED = Math.round(KNIGHT_SPEED * 1.6);
export const CAVALRY_CHARGE_TILES = 5;
export const CAVALRY_CHARGE_MULT = 2;
export const CAVALRY_CHARGE_COOLDOWN_TICKS = 8 * TICK_RATE;
// A charge run survives this long standing still (the tick between the last stride and the blow).
export const CAVALRY_CHARGE_IDLE_GRACE_TICKS = TICK_RATE;
// Siege engines (the player's and the raids' share these numbers). Ram: slow, very tough, melee, x4
// damage vs buildings / walls / gates, x0.3 vs units. Catapult: a boulder every 4 s at 3..11 tiles,
// splashing everything of the other side within 1.5 tiles (x3 vs buildings).
export const RAM_MAX_HP = KNIGHT_LEVEL_STATS[0].maxHp * 4;
export const RAM_DAMAGE = 12;
export const RAM_SPEED = Math.round(KNIGHT_SPEED * 0.5);
export const RAM_ATTACK_COOLDOWN_TICKS = 2 * TICK_RATE;
export const SIEGE_BUILDING_MULT = 4;
export const RAM_UNIT_MULT = 0.3;
export const CATAPULT_MAX_HP = ARCHER_MAX_HP * 2;
export const CATAPULT_DAMAGE = 18;
export const CATAPULT_SPEED = 50;
export const CATAPULT_RANGE = TILE_SIZE * 11;
export const CATAPULT_MIN_RANGE = TILE_SIZE * 3;
export const CATAPULT_RELOAD_TICKS = 4 * TICK_RATE;
export const CATAPULT_SPLASH_PX = TILE_SIZE * 1.5;
export const CATAPULT_BUILDING_MULT = 3;
// Siege Workshop production: one engine at a time, SIEGE_BUILD_TICKS each, SIEGE_WORKSHOP_CAP alive per
// workshop, SIEGE_POPULATION_COST population each (counted in civilianPopulationUsed).
export const SIEGE_BUILD_TICKS = 30 * TICK_RATE;
export const SIEGE_WORKSHOP_CAP = 2;
export const SIEGE_POPULATION_COST = 2;
// ---- Hero phase 3: heroes (ROADMAP "Hero phase 3: heroes"; the rest lives after the Hero phases 1-2 block) ----
// Class base stats; level (+4% damage, +6% HP per level) and equipment come on top via computeHeroStats.
export const HERO_CLASS_STATS: Record<HeroClass, { maxHp: number; damage: number; range: number; cooldown: number; speed: number; melee: boolean }> = {
  champion: { maxHp: 160, damage: 26, range: KNIGHT_ATTACK_RANGE, cooldown: KNIGHT_ATTACK_COOLDOWN_TICKS, speed: 110, melee: true },
  marksman: { maxHp: 90, damage: 16, range: ARCHER_ATTACK_RANGE + TILE_SIZE, cooldown: ARCHER_ATTACK_COOLDOWN_TICKS, speed: 100, melee: false },
  // A magic bolt (the client draws a Dark Shaman's bolt for it); spells are phase 4.
  mage: { maxHp: 80, damage: 14, range: TILE_SIZE * 7, cooldown: Math.round(TICK_RATE * 1.5), speed: 95, melee: false },
};
export const HERO_POPULATION_COST = 2;
export const SIEGE_UNIT_COST: Record<SiegeKind, Partial<Record<"wood" | "iron" | "rock", number>>> = {
  batteringRam: { wood: 30, iron: 10 },
  catapult: { wood: 25, iron: 15 },
};
export const SIEGE_LABEL: Record<SiegeKind, string> = { batteringRam: "Battering Ram", catapult: "Catapult" };
// Building costs: Stables (per level, like the Hall of the Sworn's iron + rock, plus wood) and the Workshop.
export const STABLES_COSTS = [
  { ...BUILD_COSTS[TileType.Stables] },
  { wood: 30, rock: 20, iron: 20 },
  { wood: 45, rock: 30, iron: 30 },
];
export const SIEGE_WORKSHOP_COST = { ...BUILD_COSTS[TileType.SiegeWorkshop] };
// Siege mobs pay this much more gold.
export const SIEGE_GOLD_MULT = 2;
// ---- Armour & weapons (ROADMAP "Armour & weapons — landed 2026-10-28") ----
// A colony-wide stock of armour and weapons by tier 1..3 (index tier - 1). Each EQUIPPED_KINDS unit takes
// the highest tier in stock of each slot (independently) when it spawns; with none it spawns unequipped
// (tier 0). Weapons scale damage dealt, armour damage taken; max HP is unchanged by either.
export const EQUIP_TIERS = 3;
export const EQUIPPED_KINDS: ColonistKind[] = ["knight", "spearman", "pikeman", "cavalry"];
// Indexed by tier 0..3 (0 = unequipped).
export const WEAPON_DAMAGE_MULT = [1, 1.2, 1.4, 1.7];
export const ARMOUR_DAMAGE_TAKEN_MULT = [1, 0.85, 0.7, 0.55];
// Blacksmith forging: the tier forged = the Blacksmith's level. Indexed by tier - 1.
export const FORGE_ARMOUR_IRON = [3, 5, 8];
export const FORGE_WEAPON_IRON = [2, 4, 6];
export const FORGE_WEAPON_WOOD = 1;
// Armour above tier 1 also takes (tier - 1) tools, or that much wood when the stock has too few tools.
export const FORGE_TICKS: Record<EquipSlot, number> = { armour: 15 * TICK_RATE, weapon: 10 * TICK_RATE };
// 5 -> 20 on 2026-10-30 (the queue line in the info panel summarises it per slot / tier).
export const FORGE_QUEUE_CAP = 20;
// Forge autocraft (2026-10-30, setForgeAuto): a Blacksmith with autocraft on queues one item of its tier
// whenever its queue is empty and the clan's stock (+ what its forges have queued) of that slot / tier is
// below the target; the slot furthest below target goes first (armour on a tie). It only queues when the
// stock still holds FORGE_AUTO_RESERVE iron and wood AFTER paying, so it never starves the economy (armour
// T2/T3 takes tools while there are any, else wood, as forgeCost always did; the smith's tools
// crafting keeps its BLACKSMITH_TOOLS_STOCK_CAP). Checked every FORGE_AUTO_CHECK_TICKS.
export const FORGE_AUTO_TARGET_DEFAULT = 4;
export const FORGE_AUTO_TARGET_MAX = 20;
export const FORGE_AUTO_RESERVE = 20;
export const FORGE_AUTO_CHECK_TICKS = TICK_RATE;
// Gear pickup (2026-10-30): every GEAR_PICKUP_INTERVAL_TICKS, idle EQUIPPED_KINDS soldiers (state idle, no
// target) upgrade their armour / weapon from the clan's stock: highest-value class first
// (GEAR_PICKUP_PRIORITY), lower current tier first within a class, each taking the best tier in stock that
// beats its own (never a downgrade). The piece it wore goes back to the stock for the next soldier.
export const GEAR_PICKUP_INTERVAL_TICKS = 3 * TICK_RATE;
export const GEAR_PICKUP_PRIORITY: ColonistKind[] = ["knight", "cavalry", "pikeman", "spearman"];
// Drops: an armoured enemy (EQUIP_ARMOURED_KINDS, any boss / mini-boss elite, any Hunger-marked mob) killed
// by the colony's side drops one tier-1 piece (armour / weapon 50/50) with EQUIP_DROP_CHANCE; bosses and
// marked mobs always drop one.
export const EQUIP_ARMOURED_KINDS: MobKind[] = ["armoredOrc", "banditElite"];
export const EQUIP_DROP_CHANCE = 0.35;
// Camp / boss loot: pieces of a random tier 1..3, weighted EQUIP_LOOT_TIER_WEIGHTS.
export const EQUIP_LOOT_TIER_WEIGHTS = [0.5, 0.35, 0.15];
// Extra tiered pieces for the Ogre Warlord / a mini-boss elite (on top of their guaranteed tier-1 drop).
export const BOSS_EQUIP_LOOT: Record<BossTier, number> = { warlord: 4, elite: 2 };
export const EQUIP_TOAST_THROTTLE_TICKS = 60 * TICK_RATE;
export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = { armour: "armour", weapon: "weapon" };
// Speed/range/damage fallbacks for deserter mobs, which take their stats from the deserting
// colonist rather than from MOB_KIND_CONFIG.
export const MOB_SPEED = 70;
export const MOB_DAMAGE = 5;
export const MOB_ATTACK_COOLDOWN_TICKS = TICK_RATE;
export const MOB_ATTACK_RANGE = TILE_SIZE * 0.8;
export const MOB_REPATH_TICKS = TICK_RATE;
// Flat per-kill gold regardless of monster tier made an Ogre pay the same as a Goblin. Scale off
// the mob's own current maxHp/damage instead of a lookup table, so this also naturally covers
// deserted-colonist mobs (whose stats already reflect how dangerous they were in service).
export const GOLD_PER_KILL_BASE_DIVISOR = 8;
export const GOLD_PER_KILL_MIN = 3;
// ---- Hunger-marked elites (ROADMAP Phase 6) ----
// At raid spawn each fresh raider may bear one of the six Hungers' marks (uniform pick). The chance
// is 0 before raid day HUNGER_MARK_MIN_DAY (0-based dayIndex, same as unlockDay), then rises
// linearly from HUNGER_MARK_CHANCE_START to HUNGER_MARK_CHANCE_MAX at HUNGER_MARK_CHANCE_MAX_DAY
// (flat after). At most one mark per HUNGER_MARK_RAIDERS_PER_MARK raiders (min 1). Deserters are
// never marked. A marked mob gets x1.5 hp, x1.25 damage and pays x3 gold.
export const HUNGER_MARK_MIN_DAY = 3;
export const HUNGER_MARK_CHANCE_START = 0.03;
export const HUNGER_MARK_CHANCE_MAX = 0.15;
export const HUNGER_MARK_CHANCE_MAX_DAY = 30;
export const HUNGER_MARK_RAIDERS_PER_MARK = 5;
export const HUNGER_MARK_HP_MULT = 1.5;
export const HUNGER_MARK_DAMAGE_MULT = 1.25;
export const HUNGER_MARK_GOLD_MULT = 3;
// Gunne / Gorrath re-evaluate their pick once a second (ordinary mobs keep a target until it's gone).
export const MARK_RETARGET_TICKS = TICK_RATE;
// Gorrath (frenzy): the first blow that would kill it leaves it at GORRATH_FURY_HP_FRACTION of its
// max hp instead and starts a wounded fury for GORRATH_FURY_TICKS, during which it takes only
// GORRATH_FURY_DAMAGE_TAKEN of incoming damage. Once per mob. It targets the healthiest (highest
// current hp) guard / militia / player within GORRATH_SCAN_RANGE_TILES.
export const GORRATH_FURY_HP_FRACTION = 0.2;
export const GORRATH_FURY_TICKS = 4 * TICK_RATE;
export const GORRATH_FURY_DAMAGE_TAKEN = 0.5;
export const GORRATH_SCAN_RANGE_TILES = 8;
// Gunne: targets the guard / militia / player with the lowest hp fraction within
// GUNNE_SCAN_RANGE_TILES, as long as one is wounded at all (else ordinary targeting).
export const GUNNE_SCAN_RANGE_TILES = 10;
// Rux (feint): the first time it closes to attack range on a new target it backs off for
// RUX_FEINT_TICKS instead of striking, then comes back and commits (one feint per target).
export const RUX_FEINT_TICKS = Math.round(1.5 * TICK_RATE);
// Morvain (hard to track): guards only notice it within MORVAIN_DETECTION_FACTOR of their alert
// range, and a guard chasing it loses the lock once it's further away than that reduced range.
export const MORVAIN_DETECTION_FACTOR = 0.5;
// Vhorrun (hit-and-run): after a hit that leaves its (colonist / player) target below
// VHORRUN_WITHDRAW_TARGET_HP of max hp, it drops the target and backs away for VHORRUN_WITHDRAW_TICKS,
// then picks a target afresh.
export const VHORRUN_WITHDRAW_TARGET_HP = 0.4;
export const VHORRUN_WITHDRAW_TICKS = 6 * TICK_RATE;
export const DIFFICULTY_EASY: DifficultyTuning = { mobDamage: 0.75, mobHp: 0.8, spawnCount: 0.75 };
export const DIFFICULTY_NORMAL: DifficultyTuning = { mobDamage: 1, mobHp: 1, spawnCount: 1 };
export const DIFFICULTY_HARD: DifficultyTuning = { mobDamage: 1.35, mobHp: 1.3, spawnCount: 1.35 };
export const DIFFICULTY_TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: DIFFICULTY_EASY,
  normal: DIFFICULTY_NORMAL,
  hard: DIFFICULTY_HARD,
};
export const MOB_KIND_CONFIG: Record<MobKind, MobKindConfig> = {
  goblin: { maxHp: 18, damage: 4, speed: 95, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  wolf: { maxHp: 22, damage: 6, speed: 130, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  goblinCrossbow: { maxHp: 16, damage: 6, speed: 80, range: TILE_SIZE * 4, melee: false, unlockDay: 1 },
  orc: { maxHp: 45, damage: 10, speed: 75, range: TILE_SIZE * 0.8, melee: true, unlockDay: 3 },
  skeleton: { maxHp: 50, damage: 8, speed: 60, range: TILE_SIZE * 0.8, melee: true, unlockDay: 4 },
  armoredOrc: { maxHp: 80, damage: 14, speed: 55, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6 },
  giantSpider: { maxHp: 35, damage: 7, speed: 115, range: TILE_SIZE * 0.8, melee: true, unlockDay: 6 },
  darkShaman: { maxHp: 25, damage: 12, speed: 70, range: TILE_SIZE * 5, melee: false, unlockDay: 7 },
  troll: { maxHp: 120, damage: 16, speed: 65, range: TILE_SIZE * 0.8, melee: true, unlockDay: 10 },
  ogre: { maxHp: 220, damage: 28, speed: 50, range: TILE_SIZE * 0.8, melee: true, unlockDay: 12 },
  // Bandits: encampment guardians (ENCAMPMENT_GUARDIAN_WEIGHTS, unaffected by unlockDay) and,
  // since raid waves, the Bandit band faction (RAID_FACTIONS).
  banditClubman: { maxHp: 30, damage: 7, speed: 85, range: TILE_SIZE * 0.8, melee: true, unlockDay: 0 },
  banditArcher: { maxHp: 25, damage: 8, speed: 75, range: TILE_SIZE * 4, melee: false, unlockDay: 0 },
  banditElite: { maxHp: 70, damage: 14, speed: 70, range: TILE_SIZE * 0.8, melee: true, unlockDay: 3 },
  // Half-Latch: the minor demon that slips through when a Ward Stone's ward lapses (see
  // checkWardStoneLapses). Deliberately a nuisance, not a threat. In no raid faction; unlockDay is
  // unreachable as a backstop.
  halfLatch: {
    maxHp: 12,
    damage: 3,
    speed: 90,
    range: TILE_SIZE * 0.8,
    melee: true,
    unlockDay: Number.POSITIVE_INFINITY,
  },
  // Siege engines (Cavalry & siege): the orc and bandit factions' non-core extras, at most
  // raidSiegeCap(day) of them per raid. See updateSiegeMob.
  batteringRam: { maxHp: RAM_MAX_HP, damage: RAM_DAMAGE, speed: RAM_SPEED, range: TILE_SIZE * 0.8, melee: true, unlockDay: 10 },
  catapult: { maxHp: CATAPULT_MAX_HP, damage: CATAPULT_DAMAGE, speed: CATAPULT_SPEED, range: CATAPULT_RANGE, melee: false, unlockDay: 14 },
  // Goblin wolf rider (scale pass): the greenskins' cavalry, from raid day 8 (see GOBLIN_RIDER_*).
  goblinRider: { maxHp: 30, damage: 7, speed: 125, range: TILE_SIZE * 0.8, melee: true, unlockDay: 8 },
  // Forts phase C: human settlement garrisons and workers (in no raid faction; unlockDay unreachable).
  townGuard: { maxHp: 40, damage: 8, speed: 80, range: TILE_SIZE * 0.8, melee: true, unlockDay: Number.POSITIVE_INFINITY },
  townArcher: { maxHp: 30, damage: 8, speed: 75, range: TILE_SIZE * 4, melee: false, unlockDay: Number.POSITIVE_INFINITY },
  townKnight: { maxHp: 85, damage: 14, speed: 75, range: TILE_SIZE * 0.8, melee: true, unlockDay: Number.POSITIVE_INFINITY },
  townFarmer: { maxHp: 20, damage: 2, speed: 55, range: TILE_SIZE * 0.8, melee: true, unlockDay: Number.POSITIVE_INFINITY },
  townMiner: { maxHp: 24, damage: 3, speed: 55, range: TILE_SIZE * 0.8, melee: true, unlockDay: Number.POSITIVE_INFINITY },
  townPriest: { maxHp: 18, damage: 1, speed: 50, range: TILE_SIZE * 0.8, melee: true, unlockDay: Number.POSITIVE_INFINITY },
};
// ---- Scale pass: size variation ----
// Every mob of a MOB_SIZE_RANGE kind rolls a size s, deterministically from its id (so a save can
// re-derive it; it is stored on the mob as `scale` anyway). The split mapping puts the median at 1
// (half the mobs in [min, 1], half in [1, max]). Bigger = more HP / damage / melee reach / body, a
// little slower; smaller = the reverse. HP x damage at s: about s^1.5, mean ~1.02 over the range, so
// raid strength (and enemy intel power, which sums the scaled hp / damage) stays roughly where it was.
export const MOB_SIZE_HP_PER_SCALE = 1;
export const MOB_SIZE_DAMAGE_PER_SCALE = 0.5;
export const MOB_SIZE_SPEED_PER_SCALE = -0.5;
// ---- Goblin wolf rider ----
// Charges like the colony's cavalry (trackCharge / takeChargeBonus: CAVALRY_CHARGE_MULT on the first blow
// after CAVALRY_CHARGE_TILES in a straight line), then withdraws GOBLIN_RIDER_WITHDRAW_TICKS to hit and
// run. Pikemen / spearmen hit it harder (GOBLIN_RIDER_DAMAGE_TAKEN).
export const GOBLIN_RIDER_WITHDRAW_TICKS = Math.round(TICK_RATE * 1.5);
export const GOBLIN_RIDER_DAMAGE_TAKEN: Partial<Record<ColonistKind, number>> = { pikeman: 1.6, spearman: 1.3 };
// ---- Raid waves: tuning ----
// Halfway through each day the whole of tonight's raid spawns at once at the map edge, in passive
// groups (see spawnRaid / updateRaidGroups). Raid size = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex,
// times the difficulty spawnCount (rounded, min 1). No cap.
export const RAID_BASE_SIZE = 5;
export const RAID_SIZE_PER_DAY = 2;
// The horde (one big group) takes this share of the raid, rolled uniformly in [MIN, MAX] and rounded
// up, so it is always at least half. The rest split into random groups of GROUP_SIZE_MIN..MAX.
export const RAID_HORDE_SHARE_MIN = 0.5;
export const RAID_HORDE_SHARE_MAX = 0.7;
export const RAID_GROUP_SIZE_MIN = 2;
export const RAID_GROUP_SIZE_MAX = 6;
export const RAID_FACTIONS: Record<RaidFactionId, RaidFactionEntry[]> = {
  wolfPack: [{ kind: "wolf", weight: 1, core: true }],
  // Scale pass: a wandering pack of goblin wolf riders (from the riders' unlock day), now and then.
  riderPack: [{ kind: "goblinRider", weight: 1, core: true }],
  // On a deserter night the eligible deserters are the raid's core and only this faction fills
  // the rest of the raid (see spawnRaid).
  banditBand: [
    { kind: "banditClubman", weight: 5, core: true },
    { kind: "banditArcher", weight: 3, core: true },
    { kind: "banditElite", weight: 1, core: true },
    { kind: "batteringRam", weight: 1, core: false },
    { kind: "catapult", weight: 1, core: false },
  ],
  greenskinWarband: [
    { kind: "goblin", weight: 10, core: true },
    { kind: "goblinCrossbow", weight: 4, core: true },
    { kind: "orc", weight: 5, core: true },
    { kind: "armoredOrc", weight: 3, core: true },
    { kind: "troll", weight: 1, core: false },
    { kind: "ogre", weight: 1, core: false },
    { kind: "batteringRam", weight: 1, core: false },
    { kind: "catapult", weight: 1, core: false },
    { kind: "goblinRider", weight: 2, core: false },
  ],
  darkHost: [
    { kind: "skeleton", weight: 4, core: true },
    { kind: "giantSpider", weight: 3, core: true },
    { kind: "darkShaman", weight: 2, core: true },
    { kind: "troll", weight: 1, core: false },
    { kind: "ogre", weight: 1, core: false },
    { kind: "goblin", weight: 1, core: false },
    { kind: "orc", weight: 1, core: false },
  ],
};
// Day-phase tick (within the cycle) at which the raid spawns: the midpoint of the day.
export const RAID_SPAWN_CYCLE_TICK = Math.floor(DAY_TICKS / 2);
// Arrival timing (2026-10-24): every edge-spawned group is timed to REACH the colony after nightfall but
// before RAID_ARRIVAL_WINDOW_FRACTION of the way into the night. At spawn its travel time (path length
// x RAID_TRAVEL_SLACK / the slowest member's speed, plus RAID_TRAVEL_MARGIN_TICKS) is subtracted from a
// random arrival tick in that window to get its departure (aggroTick), never earlier than the spawn.
// A group that gets to contact range before nightfall holds in formation (passive, no attacking) until
// night falls, or until it is attacked.
export const RAID_ARRIVAL_WINDOW_FRACTION = 2 / 3;
export const RAID_TRAVEL_SLACK = 1.15;
export const RAID_TRAVEL_MARGIN_TICKS = TICK_RATE * 8;
// Raiders spawn on walkable tiles within this many tiles of the map border.
export const RAID_EDGE_BAND_TILES = 3;
// Passive raiders wander one tile at a time, never more than this far (Chebyshev) from their spawn.
export const RAID_LOITER_RADIUS_TILES = 3;
export const RAID_LOITER_CHANCE_PER_TICK = 1 / (TICK_RATE * 3);
// A marching group breaks up into normal per-mob targeting once its leader is this close to the
// colony (Town Center) or to any targetable guard/player.
export const RAID_ENGAGE_RANGE_TILES = 8;
// Followers may move this much faster than the group pace to catch up with their formation slot.
export const RAID_FOLLOWER_CATCHUP = 1.5; // battle discipline 2026-10-23: was 1.25 (followers took most of a march to form up)
export const RAID_FORMATION_SHAPE: Record<RaidFactionId, RaidFormationShape> = {
  wolfPack: "wedge",
  riderPack: "wedge",
  banditBand: "line",
  greenskinWarband: "column",
  darkHost: "column",
};
export const RAID_FORMATION_SPACING_BODIES = 1.35; // battle discipline 2026-10-23: was 1.6
export const RAID_WEDGE_LOOSENESS = 1.3;
export const RAID_RELEASE_ROW_TICKS = Math.round(TICK_RATE * 0.4);
// Heading smoothing per tick (path corners would otherwise swing the whole formation each tile).
export const RAID_HEADING_SMOOTHING = 0.15;
export const RAID_MARCH_REPATH_TICKS = TICK_RATE * 2;
export const TROLL_REGEN_DELAY_TICKS = TICK_RATE * 4;
export const TROLL_REGEN_PER_TICK = 1;
export const POISON_DURATION_TICKS = TICK_RATE * 3;
export const POISON_DAMAGE_PER_TICK = 1;
export const DARK_SHAMAN_HEAL_RANGE = TILE_SIZE * 5;
export const DARK_SHAMAN_HEAL_AMOUNT = 15;
export const DARK_SHAMAN_HEAL_COOLDOWN_TICKS = TICK_RATE * 3;
// Long days: was 10 (of the old 100 s days); 3 long days (~19 min) keeps it near the old ~17 min.
export const DESERTER_ACTIVATION_DAYS = 3;
export const DESERTER_ACTIVATION_TICKS = DESERTER_ACTIVATION_DAYS * (DAY_TICKS + NIGHT_TICKS);
// Rolled at each midday raid spawn when eligible deserters exist: on success they become the core of
// tonight's raid (see spawnRaid).
export const DESERTER_WAVE_CHANCE = 0.25;
export const HAPPINESS_SCENERY_TREE_BASELINE = 20;
export const HAPPINESS_DESERTION_THRESHOLD = 35;
export const HAPPINESS_MUTINY_THRESHOLD = 15;
export const HAPPINESS_DESERTION_CHANCE = 0.15;
export const TAVERN_HAPPINESS_RADIUS_TILES = 6;
export const PRODUCTION_HAPPINESS_FLOOR = 0.5;
export const COLONIST_SPEED = 100;
export const CHOP_TICKS = TICK_RATE * 2;
export const CRAFT_TICKS = TICK_RATE * 4;
export const IDLE_RETRY_TICKS = TICK_RATE;
export const LUMBERJACK_WOOD_PER_TRIP = 3;
// ---- Slow farming: every farm number lives here. One game day = DAY_TICKS + NIGHT_TICKS (375 s). ----
// Long days: the farm timers below stay in REAL time, i.e. in "legacy days" of the old 100 s cycle
// (LEGACY_GAME_DAY_TICKS; a field grows 5 min, ~0.8 of a long day), so grain / meat / fruit / wool /
// cotton per real second, the opening food bridge (STARTING_GRAIN) and the farm tests are unchanged.
export const GAME_DAY_TICKS = DAY_TICKS + NIGHT_TICKS;
export const LEGACY_GAME_DAY_TICKS = LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS;
// Grain field (Farm Plot next to a staffed Barn): sown -> growing -> ripe (the short harvest phase)
// -> +FARM_YIELD_PER_HARVEST grain -> sown again. Plots grow day and night. Every
// FARM_HARVESTS_BEFORE_FALLOW harvests the field rests FALLOW for FARM_FALLOW_TICKS, then re-sows itself
// (once its Barn is staffed). Grow and harvest are scaled by the Barn's level, the plot's biome,
// happiness and the Barn's industrial synergy; fallow is a flat rest.
export const FARM_GROW_DAYS = 3;
export const FARM_GROW_TICKS = FARM_GROW_DAYS * LEGACY_GAME_DAY_TICKS;
// The first third of the grow phase reads as freshly sown soil (snapshot sownFarmPlots).
export const FARM_SOWN_FRACTION = 1 / 3;
export const FARM_HARVEST_TICKS = TICK_RATE * 2;
export const FARM_HARVESTS_BEFORE_FALLOW = 5;
export const FARM_FALLOW_DAYS = 3;
export const FARM_FALLOW_TICKS = FARM_FALLOW_DAYS * LEGACY_GAME_DAY_TICKS;
// Farm timers stay in real time, counted in legacy 100 s days (long days, 2026-10-23). A full field
// rotation is 5 x 3 grow days + 3 fallow days = 18 legacy days. 24 per harvest (was 36, cut a third on
// 2026-10-23 when a Barn's plot cap doubled from 4 to BARN_MAX_FARM_PLOTS 8) gives a long-run
// 5 * 24 / 18 = 6.67 grain per plot per legacy day (was 10), so a full Barn yields ~53 instead of 40.
export const FARM_YIELD_PER_HARVEST = 24;
// Farm Plots per Barn (was 4: the orthogonally adjacent tiles). A new plot may go anywhere within
// BARN_FARM_RADIUS_TILES (Chebyshev) of a Barn with fewer than BARN_MAX_FARM_PLOTS plots; it belongs to
// the nearest such Barn.
export const BARN_MAX_FARM_PLOTS = 8;
export const BARN_FARM_RADIUS_TILES = 2;
// Pasture / Orchard / Sheep Pasture / Hemp Field: the farmhand tends all day as before (works only by
// day, shelters at night), but the produce lands once per cycle of FARMHAND_CYCLE_DAYS days of tending.
// The old rate was 1 unit per CHOP_TICKS (2 s) of tending = DAY_TICKS / CHOP_TICKS = 30 a day, so a
// 3-day cycle yields 3 * 30 = 90 (same average rate, delivered in one batch). The cycle length is scaled
// by the building's level, biome, happiness and industrial synergy exactly like the old unit timer.
export const FARMHAND_CYCLE_DAYS = 3;
export const FARMHAND_CYCLE_TICKS = FARMHAND_CYCLE_DAYS * LEGACY_DAY_TICKS;
// 2x2 pastures (2026-10-30, FOOTPRINT_BY_TILE): a complete multi-tile farm yields this many batches' worth
// per cycle per tile of its footprint (same per-tile productivity: a 2x2 Pasture / Sheep Pasture delivers
// 4 x 90 = 360 per cycle, one farmhand). Legacy 1x1 pastures keep x1.
export const FOOTPRINT_YIELD_PER_TILE = 1;
export const FARMHAND_YIELD_PER_CYCLE: Record<"meat" | "fruit" | "wool" | "cotton", number> = {
  meat: 90,
  fruit: 90,
  wool: 90,
  cotton: 90,
};
// Long days: upkeep stays 1 per colonist per 100 s of real time, so a long day costs 3.75 (rounded up
// for the whole colony at dawn; see applyDailyFoodConsumption).
export const FOOD_PER_COLONIST_PER_DAY = 1 * DAY_LENGTH_SCALE;
export const STARVATION_DAMAGE = 10;
// Long days: replaces the old 5 s RESPAWN_DELAY_TICKS. Dead units wait in respawnQueue and come back
// together only at the two respawn windows, dawn (cycle tick 0) and dusk (the last daylight tick,
// DAY_TICKS - 1, so "day-only respawns" still holds); see respawnWindowAt / processRespawnQueue.
export const RESPAWN_FOOD_COST = 5;
export const ARCHER_WOOD_COST = BUILD_COSTS[TileType.ArcherPost].wood;
export const PASTURE_WOOD_COST = BUILD_COSTS[TileType.Pasture].wood;
export const SHEEP_PASTURE_WOOD_COST = BUILD_COSTS[TileType.WoolFarm].wood;
export const KNIGHT_IRON_COST = BUILD_COSTS[TileType.KnightPost].iron;
export const KNIGHT_ROCK_COST = BUILD_COSTS[TileType.KnightPost].rock;
// Walls & gates (2026-10-23): walls 3x their old 1 wood / 1 rock. Full repair = REPAIR_COST_FRACTION
// (0.3) of this, i.e. 1 wood / 1 rock per wall, 3 wood + 2 rock per gate.
export const WOOD_WALL_COST = BUILD_COSTS[TileType.Wall].wood;
export const STONE_WALL_COST = BUILD_COSTS[TileType.StoneWall].rock;
export const GATE_WOOD_COST = BUILD_COSTS[TileType.Gate].wood;
export const GATE_ROCK_COST = BUILD_COSTS[TileType.Gate].rock;
// Houses got costlier with barracks housing (2026-10-29): 10 wood -> 20 wood + 5 rock to build; the
// upgrades' wood doubled and they take rock too (placementCost).
export const HOUSE_WOOD_COST = BUILD_COSTS[TileType.House].wood;
export const HOUSE_ROCK_COST = BUILD_COSTS[TileType.House].rock;
export const BARN_WOOD_COST = BUILD_COSTS[TileType.BarnPost].wood;
export const CHURCH_WOOD_COST = BUILD_COSTS[TileType.ChurchPost].wood;
export const CRAFT_BUILDING_WOOD_COST = BUILD_COSTS[TileType.Blacksmith].wood!;
export const CRAFT_BUILDING_IRON_COST = BUILD_COSTS[TileType.Blacksmith].iron!;
export const SHOP_WOOD_COST = BUILD_COSTS[TileType.Market].wood!;
export const TAVERN_WOOD_COST = BUILD_COSTS[TileType.Tavern].wood;
export const TAVERN_ROCK_COST = BUILD_COSTS[TileType.Tavern].rock;
export const MILITIA_WOOD_COST = BUILD_COSTS[TileType.MilitiaPost].wood;
export const MILITIA_IRON_COST = BUILD_COSTS[TileType.MilitiaPost].iron;
export const WARD_STONE_WOOD_COST = BUILD_COSTS[TileType.WardStone].wood;
export const FOOD_HUT_WOOD_COST = BUILD_COSTS[TileType.HunterHut].wood!;
export const WARD_STONE_TOOLS_COST = BUILD_COSTS[TileType.WardStone].tools;
export const PLAYER_ATTACK_DAMAGE = 15;
export const PLAYER_ATTACK_RANGE = TILE_SIZE * 1.3;
export const PLAYER_ATTACK_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.5);
export const BISHOP_MAX_HP = 25;
export const BISHOP_HEAL_AMOUNT = 10;
export const BISHOP_HEAL_RANGE = TILE_SIZE * 2;
export const BISHOP_HEAL_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.8);
export const BISHOP_SPEED = 100;
export const CHURCH_HEAL_BONUS_PER_STEP = 0.1;
export const TREE_RESPAWN_INTERVAL_TICKS = TICK_RATE * 8;
export const LUMBERJACK_TREE_RADIUS = 2;
export const LUMBERJACK_TREE_INTERVAL_TICKS = TICK_RATE * 10;
export const POST_TILE_TYPES = [
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.TownCenter,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.BarnPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Stables,
  TileType.SiegeWorkshop,
];
export const GATHER_RESOURCE_TILE: Partial<Record<ColonistKind, TileType>> = {
  lumberjack: TileType.Tree,
  ironMiner: TileType.IronOre,
  rockMiner: TileType.Rock,
};
// Industrial cluster synergy: +5% productivity for every other industrial building within 5 tiles
// (Chebyshev distance), stacking. Applied as a speed multiplier on the building's work cycle.
export const INDUSTRIAL_SYNERGY_RADIUS = 5;
export const INDUSTRIAL_SYNERGY_PER_BUILDING = 0.05;
export const INDUSTRIAL_TILES: TileType[] = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
];
// Army cluster synergy: +5% unit damage per adjacent (incl. diagonal) army building, and +5% per adjacent Blacksmith.
export const ARMY_SYNERGY_PER_NEIGHBOUR = 0.05;
export const FARM_PRODUCE_BY_TILE: Partial<Record<TileType, "meat" | "fruit" | "wool" | "cotton">> = {
  [TileType.Pasture]: "meat",
  [TileType.Orchard]: "fruit",
  [TileType.WoolFarm]: "wool",
  [TileType.CottonFarm]: "cotton",
};
// Tools are only spent on a few upgrades, so an uncapped Blacksmith turned ~10 wood + 10 iron a game
// minute into a tools pile forever (the "wood slowly depleting" report, 2026-10-29).
export const BLACKSMITH_TOOLS_STOCK_CAP = 30;
export const CRAFT_RECIPES: Partial<Record<TileType, CraftRecipe>> = {
  [TileType.TailorShop]: { inputs: { wool: 1, cotton: 1 }, output: "clothes" },
  [TileType.Blacksmith]: { inputs: { iron: 1, wood: 1 }, output: "tools", stockCap: BLACKSMITH_TOOLS_STOCK_CAP },
  [TileType.LuxuryWorkshop]: { inputs: { rock: 1, fruit: 1 }, output: "luxuryItems" },
  [TileType.Brewery]: { inputs: { grain: 2 }, output: "alcohol" },
  [TileType.Tavern]: { inputs: { alcohol: 1 }, output: "gold", outputAmount: 10 },
};
// 10 -> 12 on 2026-10-29 with costlier houses, so the opening settlement isn't housing-starved.
export const TOWN_CENTER_BASE_POPULATION = 12;
// Every Town Center after the first adds this much to the base.
export const TOWN_CENTER_EXTRA_POPULATION = 5;
// Settlement population ceiling per Town Center tier (index = level - 1). Tune here.
export const SETTLEMENT_POP_CAP_BY_TIER = [20, 30, 40];
// The Keep no longer adds to the civilian population cap (user, 2026-10-30): its whole +10 per level goes to
// soldiers, via KEEP_GARRISON_PER_LEVEL below. Kept as a constant at 0 so the civilian maths stays in one place.
export const KEEP_POPULATION_PER_LEVEL = 0;
export const KEEP_MIN_TOWN_CENTER_LEVEL = 2;
// Synergy bonuses count all eight surrounding tiles (diagonals too), so buildings can be packed
// into solid blocks. Spawn-space checks still use the four orthogonal tiles units actually spawn on.
export const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
// ---- Barracks housing (2026-10-29) ----
// Soldiers don't use the settlement's (civilian) population: every unit building (Militia Camp line,
// Hall of the Sworn / castles, Archery Range, Stables) houses its own troops, `cap` = its tier headcount
// (`base`) + 1 per adjacent house (8 neighbours, diagonals included, any house tier: adjacentHouseCount).
// syncGuardBonusAt fields soldiers up to `cap`; respawns never exceed it. What gates new unit buildings
// and their upgrades is the settlement's garrison: the base headcounts of its unit buildings (built +
// queued) may not exceed SETTLEMENT_GARRISON_CAP_BY_TIER[Town Center level] + KEEP_GARRISON_PER_LEVEL per
// Keep level (garrisonBlocker). House extras ride on top of that ceiling.
export const SETTLEMENT_GARRISON_CAP_BY_TIER = [12, 24, 40];
export const KEEP_GARRISON_PER_LEVEL = 10;
export const WALL_TILES = [TileType.Wall, TileType.StoneWall];
export const NO_COLONIST_TILES = [
  TileType.ConstructionSite,
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.Market,
  TileType.GoldShop,
  TileType.Road,
  TileType.CobbleRoad,
  TileType.Keep,
];
// Event-feed names for tier upgrades, matching the client's build-panel labels.
export const UPGRADE_NAMES: Partial<Record<TileType, string>> = {
  [TileType.House]: "Cottage",
  [TileType.GoldShop]: "Trading Post",
  [TileType.KnightPost]: "Hall of the Sworn",
  [TileType.MilitiaPost]: "Militia Camp",
  [TileType.ArcherPost]: "Archery Range",
  [TileType.Tower]: "Tower",
  [TileType.IronMinePost]: "Iron Mine",
  [TileType.RockMinePost]: "Quarry",
  [TileType.LumberjackPost]: "Lumberjack",
  [TileType.BarnPost]: "Barn",
  [TileType.ChurchPost]: "Church",
  [TileType.Pasture]: "Pasture",
  [TileType.Orchard]: "Orchard",
  [TileType.WoolFarm]: "Sheep Pasture",
  [TileType.CottonFarm]: "Hemp Field",
  [TileType.TailorShop]: "Tailor Shop",
  [TileType.Blacksmith]: "Blacksmith",
  [TileType.LuxuryWorkshop]: "Jeweler's Workshop",
  [TileType.Brewery]: "Brewery",
  [TileType.Tavern]: "Tavern",
  [TileType.HunterHut]: "Hunter's Hut",
  [TileType.ForagerHut]: "Forager's Hut",
  [TileType.BuildersGuild]: "Builders' Guild",
  [TileType.TownCenter]: "Town Center",
  [TileType.Stables]: "Stables",
  [TileType.Keep]: "Keep",
};
export const DUSK_RESPAWN_CYCLE_TICK = DAY_TICKS - 1;
// ---- Farm art stages (snapshot farmStages; FarmStage in protocol.ts). Cosmetic only. ----
// A grain plot shows its stubble ("harvested") art this long after each harvest.
export const FARM_HARVESTED_SHOW_TICKS = TICK_RATE * 8;
// Stage boundaries as fractions (0..1) of the current grow phase / farmhand produce cycle.
export const FARM_SPROUTING_FRACTION = 2 / 3; // grain: sown < 1/3 <= sprouting < 2/3 <= growing
export const HEMP_GROWING_FROM = 1 / 3;
export const HEMP_RIPE_FROM = 2 / 3;
export const PASTURE_FAT_FROM = 0.7;
export const SHEEP_WOOLLY_FROM = 0.25; // sheared right after the wool batch lands
export const SHEEP_READY_FROM = 0.8;
export const ORCHARD_BLOSSOM_UNTIL = 0.35;
export const ORCHARD_FRUITING_FROM = 0.65;
// A Barn farmer walks its Barn's Farm Plots in turn and works a few seconds at each (presence only:
// grain growth / yield stay in updateFarmPlots). Unreachable plots are skipped; no plots = stays put.
export const FARMER_PLOT_DWELL_TICKS = 6 * TICK_RATE;
// Hunters: find the nearest unreserved living game within HUNTER_WORK_RADIUS_TILES of the hut, close to
// bow range, shoot until it dies, pick up the carcass and carry it home (meat lands on arrival).
export const HUNTER_WORK_RADIUS_TILES = 25;
// Give up a chase once the quarry is this far from the hut (it can flee past the work radius).
export const HUNTER_CHASE_LEASH_TILES = HUNTER_WORK_RADIUS_TILES + 5;
export const HUNTER_BOW_RANGE = TILE_SIZE * 4;
export const HUNTER_ARROW_DAMAGE = 10;
export const HUNTER_SHOT_COOLDOWN_TICKS = Math.round(TICK_RATE * 1.2);
export const HUNTER_REPATH_TICKS = TICK_RATE;
// How many of the nearest candidates (game or forage) get a path check before the worker waits.
export const FOOD_WORKER_ROUTE_CANDIDATES = 6;
export const FOOD_WORKER_IDLE_RETRY_TICKS = TICK_RATE * 2;
// Foragers: nearest RIPE forage within FORAGER_WORK_RADIUS_TILES of the hut, pick for FORAGE_TICKS, carry
// the fruit home. A picked plant regrows to ripe after FORAGE_REGROW_TICKS (day and night).
export const FORAGER_WORK_RADIUS_TILES = 25;
export const FORAGE_TICKS = TICK_RATE * 3;
// Long days: stays 100 s of real time (one legacy day), so forage income per second is unchanged.
export const FORAGE_REGROW_TICKS = LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS;
// Nothing wild grows this close to the Town Center (keeps the start area buildable).
export const FORAGE_MIN_TOWN_CENTER_DIST_TILES = 5;
export const FORAGE_RIPE_TO_PICKED: Partial<Record<TileType, TileType>> = {
  [TileType.BerryBush]: TileType.BerryBushPicked,
  [TileType.FruitTree]: TileType.FruitTreePicked,
  [TileType.MushroomPatch]: TileType.MushroomPatchPicked,
};
export const FORAGE_PICKED_TO_RIPE: Partial<Record<TileType, TileType>> = {
  [TileType.BerryBushPicked]: TileType.BerryBush,
  [TileType.FruitTreePicked]: TileType.FruitTree,
  [TileType.MushroomPatchPicked]: TileType.MushroomPatch,
};
// Fruit carried home per plant picked.
export const FORAGE_FRUIT_YIELD: Partial<Record<TileType, number>> = {
  [TileType.BerryBush]: 3,
  [TileType.FruitTree]: 5,
  [TileType.MushroomPatch]: 2,
};
export const FORAGE_TILES: TileType[] = [
  TileType.BerryBush,
  TileType.BerryBushPicked,
  TileType.FruitTree,
  TileType.FruitTreePicked,
  TileType.MushroomPatch,
  TileType.MushroomPatchPicked,
];
// Game never spawns this close to the Town Center (nor within WILDLIFE_PLAYER_CLEARANCE_TILES of a
// player, for respawns), so the colony's surroundings aren't a petting zoo.
export const WILDLIFE_MIN_TOWN_CENTER_DIST_TILES = 10;
export const WILDLIFE_PLAYER_CLEARANCE_TILES = 8;
// Wandering: short walks to a random walkable spot within this radius of home, with rests between.
export const WILDLIFE_WANDER_RADIUS_TILES = 5;
export const WILDLIFE_REST_MIN_TICKS = TICK_RATE * 2;
export const WILDLIFE_REST_MAX_TICKS = TICK_RATE * 8;
// Any damage makes an animal bolt directly away from the attacker for this long; it then settles
// wherever it ended up (its new home).
export const WILDLIFE_FLEE_TICKS = TICK_RATE * 4;
// A boar shot by a hunter charges him instead of fleeing, for at most BOAR_CHARGE_TICKS, then flees.
export const BOAR_CHARGE_TICKS = TICK_RATE * 6;
export const BOAR_CHARGE_SPEED = 95;
export const BOAR_DAMAGE = 4;
export const BOAR_ATTACK_RANGE = TILE_SIZE * 0.8;
export const BOAR_ATTACK_COOLDOWN_TICKS = TICK_RATE;
export const WILDLIFE_STATE_CODE: Record<WildlifeMode, WildlifeState> = {
  idle: WildlifeState.Idle,
  walk: WildlifeState.Walk,
  flee: WildlifeState.Flee,
  charge: WildlifeState.Charge,
};
// Dormancy: wildlife with no living player or colonist within this many tiles skips its AI and
// movement (only the cheap cooldown timer runs) and wakes when one comes near.
export const DORMANCY_RADIUS_TILES = 64;
// ---- Builders: they turn construction sites (see startConstruction) into buildings ----
// Civilians: work only by day, shelter at night (the site keeps its progress overnight). States:
// idle -> carrying (hauling materials to a site) -> building (adds to the site's progress every tick)
// -> idle; with nothing to build they walk back to their post ("toPost").
export const BUILDER_MAX_PER_SITE = 2;
export const BUILDER_IDLE_RETRY_TICKS = TICK_RATE;
// A builder works the site from any tile within this distance of its center (i.e. a neighbouring tile).
export const BUILDER_WORK_RANGE_PX = TILE_SIZE * 1.6;
// How many of the nearest open sites get a path check per try (unreachable ones stay queued).
export const BUILDER_ROUTE_CANDIDATES = 6;
// ---- Repair: idle builders (by day, like all builder work) heal damaged buildings ----
// "Not enough materials to repair" is announced at most this often.
export const REPAIR_SHORT_TOAST_TICKS = TICK_RATE * 30;
// Clockwise 8-ring around a tile; consecutive entries are edge-adjacent, so a run of walkable entries
// is one connected strip.
export const RING_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];
export const COMMANDABLE_KINDS: ColonistKind[] = [
  "knight", "archer", "bishop", "militia", "spearman", "pikeman", "cavalry", "batteringRam", "catapult", "hero",
];
export const STANCES: Stance[] = ["defensive", "normal", "aggressive"];
export const REGIMENT_CLASS_OF: Partial<Record<ColonistKind, RegimentClass>> = {
  knight: "knights",
  archer: "archers",
  cavalry: "cavalry",
  militia: "infantry",
  spearman: "infantry",
  pikeman: "infantry",
  bishop: "clergy",
  batteringRam: "rams",
  catapult: "catapults",
  hero: "hero",
};
export const REGIMENT_CLASS_LABEL: Record<RegimentClass, string> = {
  infantry: "Infantry", knights: "Knights", archers: "Archers", cavalry: "Cavalry", clergy: "Clergy",
  rams: "Rams", catapults: "Catapults", hero: "Hero", mixed: "Task Force",
};
export const REGIMENT_CLASS_ORDER: RegimentClass[] = ["knights", "infantry", "archers", "cavalry", "rams", "catapults", "clergy"];
// Without a membership / name change, armyRegiments rides along every this many ticks (2 Hz).
export const ARMY_REGIMENT_REFRESH_TICKS = 10;
export const ORDER_UPDATE_TICKS = 5;
export const REGIMENT_ORDER_MAX_PER_S = 20;
export const ORDER_DISPATCH_STEP_MS = 80;
export const ORDER_DISPATCH_MAX_SPREAD_MS = 600;
// Arrival is not checked until every staggered start has landed.
export const ORDER_ARRIVE_GRACE_TICKS = TICK_RATE;
export const ORDER_WIDTH_MAX_TILES = 64;
export const ATTACK_MOVE_RESUME_TICKS = 3 * TICK_RATE;
export const RETREAT_CORNERED_TILES = 1.2;
export const RETREAT_SPEED_FACTOR = 1.1;
export const RETREAT_TC_OFFSET_TILES = 3;
export const HOLD_LEASH_TILES = 0.5;
export const FOLLOW_REFORM_TILES = 2;
export const FOLLOW_BEHIND_TILES = 2.5;
export const ARMY_ORDER_KINDS: ArmyOrderKind[] = ["move", "attackMove", "retreat", "hold", "follow", "attack", "charge", "bombard", "attackHearth"];
// Phase 4: cycle charge (see the order list above) and skirmish (updateGuardColonist).
export const CHARGE_WITHDRAW_TILES = 11;
// A withdrawn rider turns to charge again only from this far out (so its run still reaches
// CAVALRY_CHARGE_TILES while the enemy closes in), or after CHARGE_WITHDRAW_MAX_TICKS out.
export const CHARGE_RECHARGE_GAP_TILES = 9;
export const CHARGE_WITHDRAW_MAX_TICKS = 12 * TICK_RATE;
export const SKIRMISH_KITE_TILES = 4;
// A skirmisher backs off at most this far from its slot.
export const SKIRMISH_DRIFT_TILES = 8;
export const EXCHANGE_RATES: Record<string, Record<string, { give: number; get: number }>> = {
  wood: { iron: { give: 3, get: 1 }, rock: { give: 3, get: 1 } },
  iron: { wood: { give: 3, get: 1 }, rock: { give: 2, get: 1 } },
  rock: { wood: { give: 3, get: 1 }, iron: { give: 2, get: 1 } },
};
export const GOLD_SHOP_PRICES: Record<string, { cost: number; amount: number }> = {
  tools: { cost: 10, amount: 1 },
  clothes: { cost: 8, amount: 1 },
  luxuryItems: { cost: 20, amount: 1 },
  wood: { cost: 5, amount: 5 },
  iron: { cost: 8, amount: 5 },
  rock: { cost: 8, amount: 5 },
};
export const RALLY_ARRIVE_PX = 2;
export const GARRISON_LOITER_PX = TILE_SIZE * 1.5;
// One Ward Priest per colony tends every Ward Stone in turn. He is a "bishop" colonist spawned at a
// Church, but his postX/postY always names the Ward Stone he is heading to or tending, so he reads
// as a (non-commandable) Ward Stone bishop everywhere the post tile is consulted, client included.
export const WARD_TEND_TICKS = TICK_RATE * 10;
export const WARD_GRACE_TICKS = TICK_RATE * 60;
// Raids spawn on the edge band of a "raid box": the whole map on small worlds, but at most this many
// tiles from the first Town Center on big ones, so a 512 map's raiders reach the colony in reasonable time.
export const RAID_MAX_SPAWN_DIST_TILES = 110;
// Shrinking spawn distances tried in turn until a raid anchor is within the pathfinding budget.
export const RAID_SPAWN_DIST_STEPS = [RAID_MAX_SPAWN_DIST_TILES, 80, 55, 35];
// A raid anchor must be able to reach the colony inside the pathfinding budget (a margin under
// PATH_NODE_BUDGET, since the real path also detours). Breadth-first from the anchor until it is within
// RAID_REACH_RADIUS tiles of a Town Center (walls are breached by mobs, so the last stretch is not tested).
export const RAID_REACH_RADIUS = 20;
export const RAID_REACH_BUDGET = Math.floor(PATH_NODE_BUDGET * 0.8);
// Regiments & roles: the front ranks hold the melee roles in the faction's formation - shock (heavies)
// first, so front / centre, then the frontline rank and file - with the fast roles (wolves, spiders) on
// the wings (the outermost front slots). The ranged / casters form a rear rank RAID_REAR_RANK_TILES behind
// the front row (or one spacing behind the last front row, if deeper), centred, released last on contact.
// The slowest front-rank member leads from the front-centre slot (an all-ranged group: the slowest of
// all); the march goes at the slowest member's pace (marchRaidGroup).
export const RAID_REAR_RANK_TILES = 3.5;
// ---- Walls & gates (ROADMAP §8 items 2-5, 2026-10-23) ----
// A Gate is one placeable tile with HP (BUILDING_HP_GATE) and a state per tile (`gates`):
//  - OPEN / CLOSED. With lock "auto" it opens while a friendly unit (a player or any colonist) is within
//    GATE_OPEN_RANGE_PX of its centre and closes GATE_CLOSE_DELAY_TICKS after the last one left. Lock
//    "open" / "closed" (building info menu, setGateLock) holds it either way; a locked-closed gate blocks
//    the colony's own units too. It never closes on a body standing in it.
//  - Passability (isWalkableTile via gatePassable): open = ground for everyone, friend or foe; closed =
//    solid for mobs and wildlife (hostileMover), passable for the colony's units (they open it on arrival).
//  - OVERRUN (item 5): once a second, if the summed strength (current HP) of awake mobs within
//    GATE_OVERRUN_RANGE_TILES beats the defenders' (guard / militia colonists in that range + towers in it)
//    and no living Tower (livingTowersNear) stands within GATE_TOWER_RANGE_TILES, the gate is overrun: it is
//    passable for mobs as if open until that majority is lost ("Gate overrun" toast on the way in).
// Mob choice gate vs wall (item 4): pickBuildingTarget first tries an ordinary route (open / overrun gates
// are ground, closed gates and walls solid) and takes it within BREACH_DETOUR_FACTOR. Otherwise the breach
// search crosses walls and closed gates at
//   breachStepCost = 1 + round(currentHp / BREACH_HP_PER_TILE) + BREACH_TOWER_PENALTY_TILES x (living
//                    towers within GATE_TOWER_RANGE_TILES of that tile)
// route tiles each (full HP: wood wall 9, gate 19, stone wall 37), and the first wall / closed gate on the
// cheapest route is attacked. So an open gate wins whenever it's within the detour, a closed gate beats a
// stone wall unless the wall route is ~18+ tiles shorter, a wood wall beats a gate unless the gate route
// is ~10+ tiles shorter, damaged sections and undefended stretches are preferred.
export const GATE_OPEN_RANGE_PX = TILE_SIZE * 1.5;
export const GATE_CLOSE_DELAY_TICKS = TICK_RATE * 2;
export const GATE_OVERRUN_RANGE_TILES = 6;
export const GATE_TOWER_RANGE_TILES = 8;
export const BREACH_HP_PER_TILE = 25;
export const BREACH_TOWER_PENALTY_TILES = 12;
export const BUILD_SECONDS_GATE = 8;
export const ROUTE_NODE_BUDGET = 120000;
// ---- Monster tactics: flanking, wall cover, morale & rout (ROADMAP "Monster tactics") ----
// A regiment is every mob sharing regimentKey: a raid group (groupId, then regimentId once it broke
// up) or a POI site (siteId; future horde / fort sites use the same key). updateRegiments evaluates
// each one once a second: its strength against the player's forces near it, its morale, and whether it
// sends a flank group, takes cover behind its own walls or routs. mobTactic then moves the members.
export const TACTICS_EVAL_TICKS = TICK_RATE;
// Player forces (soldiers, players, standing towers) this far from a regiment's centroid (plus its own
// spread, up to TACTICS_SPREAD_CAP_TILES) count against it; any at all means it is "in contact".
export const TACTICS_SCAN_TILES = 10;
export const TACTICS_SPREAD_CAP_TILES = 8;
// Flanking: the arc passes this far outside the enemy line's end, then cuts in behind it.
export const FLANK_ARC_TILES = 7;
export const FLANK_BEHIND_TILES = 3;
// No fast units: this share of the front line (at least FLANK_MIN_FRONT_FOR_DETACH strong) goes round.
export const FLANK_DETACH_FRACTION = 0.2;
export const FLANK_MIN_FRONT_FOR_DETACH = 5;
export const FLANK_MAX_TICKS = 20 * TICK_RATE;
export const FLANK_WAYPOINT_REACH_PX = TILE_SIZE * 1.5;
// A flanker past its first waypoint engages early once its target is this close.
export const FLANK_ENGAGE_TILES = 3;
// The front line counts as engaged once a front-rank member closes within this much of its reach of a
// soldier target (so the fast wing leaves as the lines meet, not after it has charged in itself).
export const FLANK_CONTACT_TILES = 6;
// Strength ratio (regiment / enemy) below which it is outnumbered (cover / morale drain), and above
// which a sheltering regiment comes back out.
export const TACTICS_OUTNUMBERED_RATIO = 0.6;
export const COVER_REENGAGE_RATIO = 1.0;
// A wall / gate of the shelter below this HP fraction (or an opened gate / a gap) is a breach.
export const COVER_BREACH_HP_FRACTION = 0.5;
// Walled enclosure search: Chebyshev radius from the start tile it must close within.
export const COVER_ENCLOSURE_TILES = 8;
export const MORALE_MAX = 100;
export const MORALE_ROUT = 25;
export const MORALE_RALLY = 50;
export const MORALE_RALLY_QUIET_TICKS = 10 * TICK_RATE;
// One death costs MORALE_CASUALTY x its weight / the regiment's peak size (only applied in contact).
export const MORALE_CASUALTY = 50;
// Siege: the ram weighs as shock (2), the catapult as ranged (0.8); see moraleWeight.
export const MORALE_ROLE_WEIGHT: Record<CombatRole, number> = { frontline: 1, shock: 2, ranged: 0.8, caster: 1, fast: 0.8, siege: 2 };
export const MORALE_LEADER_WEIGHT = 3;
export const MORALE_FRONT_LOST_PER_SEC = 8;
export const MORALE_OUTFLANKED_PER_SEC = 4;
// Drain at ratio 0, falling linearly to 0 at TACTICS_OUTNUMBERED_RATIO.
export const MORALE_OUTNUMBERED_PER_SEC = 20;
export const MORALE_RECOVER_PER_SEC = 3;
export const MORALE_WINNING_RATIO = 1.5;
// Losses are scaled by this while a morale anchor (boss / Hunger-marked) lives.
export const MORALE_ANCHOR_RESIST = 0.5;
// Night raids (reg.raid) commit to the fight: a lower rout line, half the casualty / outnumbered cost,
// gentler front-lost / outflanked drains, a morale grace at first contact, and a stronger anchor. They
// still rout once crushed (at most RAID_CRUSHED_FRACTION of peak left, or the anchor they had is dead).
export const RAID_MORALE_ROUT = 10;
export const RAID_MORALE_CASUALTY = 25;
export const RAID_MORALE_OUTNUMBERED_PER_SEC = 10;
export const RAID_MORALE_FRONT_LOST_PER_SEC = 4;
export const RAID_MORALE_OUTFLANKED_PER_SEC = 2;
export const RAID_MORALE_ANCHOR_RESIST = 0.25;
export const RAID_MORALE_GRACE_TICKS = 10 * TICK_RATE;
export const RAID_CRUSHED_FRACTION = 0.25;
export const ROUT_SPEED_FACTOR = 1.2;
export const RAID_LEAVE_MAX_TICKS = 60 * TICK_RATE;
export const ROUT_TOAST_COOLDOWN_TICKS = 30 * TICK_RATE;
export const ENEMY_OUTFLANKED_SHOW_TICKS = 3 * TICK_RATE;
export const SITE_KIND_WALLED: Partial<Record<PoiSiteKind, boolean>> = {};
export const PLAYER_MORALE_MIN_UNITS = 3;
export const PLAYER_MORALE_WAVER = 40;
export const PLAYER_MORALE_ROUT = 15;
export const PLAYER_MORALE_RALLY = 45;
export const PLAYER_MORALE_SCAN_TILES = 8;
// One death costs this x its role weight / max(3, the regiment's peak size).
export const PLAYER_MORALE_CASUALTY = 35;
export const PLAYER_MORALE_OUTNUMBERED_PER_SEC = 8;
export const PLAYER_MORALE_OUTFLANKED_PER_SEC = 3;
export const PLAYER_MORALE_FRONT_LOST_PER_SEC = 4;
export const PLAYER_MORALE_RECOVER_PER_SEC = 4;
export const PLAYER_MORALE_WINNING_PER_SEC = 2;
// The first seconds of a new engagement cost no morale beyond casualties.
export const PLAYER_MORALE_GRACE_TICKS = 5 * TICK_RATE;
// Contact after this long quiet is a new engagement (grace again).
export const PLAYER_MORALE_NEW_FIGHT_TICKS = 10 * TICK_RATE;
// Drain multipliers (stacking, floored at PLAYER_MORALE_RESIST_FLOOR).
export const PLAYER_MORALE_ANCHOR_TILES = 6;
export const PLAYER_MORALE_ANCHOR_RESIST = 0.6;
export const PLAYER_MORALE_TOWER_TILES = 8;
export const PLAYER_MORALE_TOWER_RESIST = 0.75;
export const PLAYER_MORALE_WALL_TILES = 4;
export const PLAYER_MORALE_WALL_RESIST = 0.85;
export const PLAYER_MORALE_TC_TILES = 12;
export const PLAYER_MORALE_TC_RESIST = 0.6;
export const PLAYER_MORALE_RESIST_FLOOR = 0.3;
// Out of contact within PLAYER_MORALE_TC_TILES of a Town Center: recovery x this.
export const PLAYER_MORALE_TC_RECOVER_MULT = 2;
export const PLAYER_MORALE_WAVERING_DAMAGE = 0.85;
export const PLAYER_ROUT_SPEED_FACTOR = 1.25;
export const PLAYER_ROUT_MIN_TICKS = 6 * TICK_RATE;
export const PLAYER_ROUT_QUIET_TICKS = 4 * TICK_RATE;
export const PLAYER_ROUT_MAX_TICKS = 25 * TICK_RATE;
export const PLAYER_MORALE_TOAST_COOLDOWN_TICKS = 20 * TICK_RATE;
// Nothing world-gen places (biome seeds, ponds, POI sites) comes closer than this to the Town Center.
export const SPAWN_CLEAR_RADIUS_TILES = 15;
// Biome blobs (including edge jitter) never reach within this many tiles of the Town Center, so the
// starting area is always Plains. A seed's own min distance from spawn is therefore
// max(SPAWN_CLEAR_RADIUS_TILES, radius + BIOME_EDGE_JITTER_TILES + this).
export const SPAWN_PLAINS_RADIUS_TILES = 6;
// Plains is meant to be the majority biome (the default colony-building terrain), with Hills and
// Swamp as scattered regional pockets. 14-18 made Hills+Swamp cover ~70% of the map instead;
// 10-13 brings Plains back to roughly half, per the executor's own simulation.
export const BIOME_SEED_RADIUS_MIN = 10;
export const BIOME_SEED_RADIUS_MAX = 13;
export const BIOME_SEED_MIN_SPACING = 12;
export const BIOME_EDGE_JITTER_TILES = 3;
export const BIOME_NOISE_CELL_TILES = 4;
export const POND_RADIUS_MIN = 2;
export const POND_RADIUS_MAX = 4;
export const POND_EDGE_JITTER_TILES = 1;
export const POND_NOISE_CELL_TILES = 2;
export const POND_MIN_SPACING = 12;
export const POI_SITE_MIN_SPACING = 10;
// Every tile within this Chebyshev radius of a site's center must be Empty before the site is placed.
export const POI_SITE_FOOTPRINT_RADIUS = 2;
// ...and there must be no Water within this Chebyshev radius.
export const POI_SITE_WATER_CLEARANCE = 3;
export const RUIN_CENTERPIECES = [TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch];
export const RUIN_EXTRAS = [TileType.RuinStatue, TileType.RuinRubble];
export const ENCAMPMENT_EXTRAS = [TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence];
// Skeleton is the most thematic ruin guardian: 60% skeleton, 20% darkShaman, 20% orc.
export const RUIN_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "skeleton", weight: 3 },
  { kind: "darkShaman", weight: 1 },
  { kind: "orc", weight: 1 },
];
// Clubman is the rank-and-file guard, Archer the support, Elite a rare mini-boss.
export const ENCAMPMENT_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "banditClubman", weight: 5 },
  { kind: "banditArcher", weight: 3 },
  { kind: "banditElite", weight: 1 },
];
// Saint Wren's Abbey: exactly one per world, a 9x9 walled complex, north at the top. H is the hall
// (church art) on the north side of the cloister; S the worn stone statue at the centre of the
// garth; X crosses down the east side (the cemetery); L lantern posts flanking the hall doors and the
// processional path from the south gate (the gap in the fence) up to the statue; F boundary fence;
// "." open ground (left Empty). The resident clergy stand on the row below the hall.
export const ABBEY_LAYOUT = [
  "FFFFFFFFF",
  "F.L.H.L.F",
  "F.......F",
  "F......XF",
  "F...S...F",
  "F......XF",
  "F.......F",
  "F..L.L.XF",
  "FFFF.FFFF",
];
export const ABBEY_LAYOUT_TILES: Record<string, TileType> = {
  F: TileType.PropFence,
  H: TileType.AbbeyHall,
  S: TileType.RuinStatue,
  X: TileType.PropCross,
  L: TileType.PropLanternPost,
};
export const ABBEY_FOOTPRINT_RADIUS = Math.floor(ABBEY_LAYOUT.length / 2);
// The footprint plus a one-tile apron that stays clear of resources/trees so the gate is never blocked.
export const ABBEY_GROUNDS_RADIUS = ABBEY_FOOTPRINT_RADIUS + 1;
// Far enough out that the Abbey's permanent ward never reaches the spawn-clear area.
export const ABBEY_MIN_SPAWN_DIST = SPAWN_CLEAR_RADIUS_TILES + WARD_RADIUS_TILES;
// "Never fewer than three" keep the Unbroken Watch; offsets from the Abbey's center (the statue).
export const ABBEY_CLERGY_OFFSETS: TileCoord[] = [
  { x: -1, y: -2 },
  { x: 0, y: -2 },
  { x: 1, y: -2 },
];
export const NEIGHBORS_8: TileCoord[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];
// ---- Camp hearths (ROADMAP "Camp hearths, soldier population, settlement spacing", 2026-10-28) ----
// Every non-player settlement / camp whose site kind has `hasHearth` gets a destroyable HEARTH on its
// centre tile (the encampment's PropCampfire today), registered by the site stamper (placePoiSite), so a
// future fort / human-settlement kind only needs the flag. Player soldiers, the player and siege engines
// can attack it; hitting it wakes the site's guardians (they defend it). At 0 HP the camp BREAKS: every
// guardian of the site routs (startRout as a "leave" regiment: they flee to the map edge and despawn there
// or after RAID_LEAVE_MAX_TICKS), the hearth tile burns to rubble and the camp's props burn out, a share of
// the camp's stockpile (HEARTH_LOOT_PER_GUARDIAN x garrison) goes to the colony, and campsDestroyed++.
// Destroyed hearths stay in the save (`destroyed`): never respawned, never re-woken.
export const SITE_KIND_HAS_HEARTH: Partial<Record<PoiSiteKind, { hasHearth: boolean; hp: number }>> = {
  encampment: { hasHearth: true, hp: 150 },
  // Forts phase B: a fort's hearth is its keep (SiteKeep tile); HP by tier from SITE_KEEP_HP_BY_TIER.
  fort: { hasHearth: true, hp: 350 },
};
export const HEARTH_DEFAULT_HP = 150;
export const HEARTH_LOOT_PER_GUARDIAN = { gold: 15, wood: 10, rock: 5, iron: 5 };
// Aggressive-stance soldiers with no enemy in reach go for a standing hearth this close to them.
export const HEARTH_AUTO_TARGET_TILES = 8;
// Forts phase A: what the attackHearth order / commandAttackHearth (generalised "attack structure") can
// hit at a tile: a standing hearth (id = its siteId) or a damageable tile of a hostile NPC site (id =
// STRUCTURE_TARGET_PREFIX + tile index). Colonist.targetHearthId holds either id.
export const STRUCTURE_TARGET_PREFIX = "tile:";
// ---- The Castle Ruin, its Ogre Warlord, and mini-boss packs (ROADMAP Phase 5) ----
// The Castle Ruin: exactly one per world, a 9x9 walled ruin (existing ruin tiles, no new art) placed
// as far from the starting Town Center as world-gen can manage. Gaps in the middle of each wall let
// units in and out. Its guardians stand inside, dormant; the Ogre Warlord holds the centre ("B").
// 1/2 ruin walls, A arch, S statue, R rubble, "." open ground (Empty).
export const CASTLE_RUIN_LAYOUT = [
  "12A1.1A21",
  "2.......2",
  "A..R.R..A",
  "1.S...S.1",
  "....B....",
  "1.S...S.1",
  "A..R.R..A",
  "2.......2",
  "12A1.1A21",
];
export const CASTLE_RUIN_LAYOUT_TILES: Record<string, TileType> = {
  "1": TileType.RuinWall1,
  "2": TileType.RuinWall2,
  A: TileType.RuinArch,
  S: TileType.RuinStatue,
  R: TileType.RuinRubble,
};
export const CASTLE_RUIN_FOOTPRINT_RADIUS = Math.floor(CASTLE_RUIN_LAYOUT.length / 2);
// The footprint plus a one-tile apron kept clear (like the Abbey's), so the gates are never blocked.
export const CASTLE_RUIN_GROUNDS_RADIUS = CASTLE_RUIN_FOOTPRINT_RADIUS + 1;
// Preferred minimum distances from the Town Center, as fractions of the map width, tried in order
// (a crowded or small map falls back to the next); last resort is just clear of the spawn area.
export const CASTLE_RUIN_SPAWN_DIST_FRACTIONS = [0.4, 0.33, 0.25];
export const CASTLE_RUIN_GUARDIANS_MIN = 8;
export const CASTLE_RUIN_GUARDIANS_MAX = 12;
// Ruin-weighted, with heavier hitters than an ordinary ruin.
export const CASTLE_RUIN_GUARDIAN_WEIGHTS: { kind: MobKind; weight: number }[] = [
  { kind: "skeleton", weight: 4 },
  { kind: "orc", weight: 2 },
  { kind: "armoredOrc", weight: 2 },
  { kind: "darkShaman", weight: 2 },
];
// ---- Forts phase B (PLAN-forts-diplomacy-moats.md §2, §8, §10 "B"): stamped NPC forts ----
// Legend of the fort templates (SITE_TEMPLATES): # wood wall, G gate, T tower, K keep / chief hall (the
// site's hearth), H tent, C campfire, s stockpile crate, p pen fence, f farm plot (decor: no barn), F forge
// (cart placeholder), M ore heap (barrel placeholder), ~ moat (tier 4 only; Water until phase H), D drawbridge (tier 4 only;
// open ground until phase H), "." open ground (left Empty and unowned, inside the reserved grounds).
// Every stamped (non-"." / non-"D") cell is owned by the site.
export const SITE_TEMPLATE_TILES: Record<string, TileType> = {
  "#": TileType.Wall,
  G: TileType.Gate,
  T: TileType.Tower,
  K: TileType.SiteKeep,
  H: TileType.Tent,
  C: TileType.PropCampfire,
  s: TileType.PropCrate,
  p: TileType.PropFence,
  f: TileType.FarmPlot,
  F: TileType.PropCart,
  // Ore heap decor (not real IronOre: colonists' resource searches would try to reach it inside the walls).
  M: TileType.PropBarrel,
  "~": TileType.Water,
};
// Forts phase C: human settlement symbols (SiteTemplate.symbols, over SITE_TEMPLATE_TILES): stone walls,
// houses, a forge (Blacksmith), real ore / rock (inside the reserved grounds: no player mine can go there),
// a well (one Water tile), barn, market, church, inn (Tavern), mill (BigHouse). The player-building tiles
// are inert while the site owns them (no workers; housing skips NPC tiles) and real after a capture.
export const HUMAN_SITE_SYMBOLS: Record<string, TileType> = {
  "#": TileType.StoneWall,
  H: TileType.House,
  F: TileType.Blacksmith,
  M: TileType.IronOre,
  R: TileType.Rock,
  W: TileType.Water,
  B: TileType.BarnPost,
  m: TileType.Market,
  c: TileType.ChurchPost,
  i: TileType.Tavern,
  n: TileType.BigHouse,
};
// Human templates are single-stage: every non-"." cell joins at tier 1.
function singleStage(rows: string[]): string[] {
  return rows.map((r) => r.replace(/[^.]/g, "1"));
}
const HEARTHMOOR_ROWS = [
      "fffffBffffffff...ffffffffffffff",
      "f.............................f",
      "f.#############G#############.f",
      "f.#T.......................T#.f",
      "f.#.........................#.f",
      "f.#...H..H..........H..H....#.f",
      "f.#.........................#.f",
      "f.#.........................#.f",
      "f.#.........n...............#.f",
      "f.#...H...........m.....H...#.f",
      "f.#.........................#.f",
      "f.#.........................#.f",
      "f.#.........................#.f",
      "f.#.........W..K............#.f",
      "f.#.....i............c......#.f",
      "f.#.........................#.f",
      "f.#.........................#.f",
      "f.#.....................H...#.f",
      "f.#...H....s.......s........#.f",
      "f.#.........................#.f",
      "f.#.........................#.f",
      "f.#......H..........H..H....#.f",
      "f.#.........................#.f",
      "f.#T.......................T#.f",
      "f.#############G#############.f",
      "f.............................f",
      "ffffffffffffff...ffffffffBfffff",
];
const IRONHOLD_ROWS = [
      ".............................",
      ".#####################.......",
      ".#T.................T#.......",
      ".#...................#.......",
      ".#...................#....R..",
      ".#...H..H.....H..H...#..MM.R.",
      ".#...................#....M..",
      ".#...................#..M....",
      ".#...................#.....M.",
      ".#....s.........s....#.......",
      ".#...................#.......",
      ".#.....W...K..F......G.......",
      ".#...................#.....R.",
      ".#..............s....#.......",
      ".#...................#..M.M..",
      ".#...................#...M...",
      ".#...H..H.....m..H...#.R...M.",
      ".#...................#...M...",
      ".#...................#....R..",
      ".#...................#.......",
      ".#T.................T#.......",
      ".##########G##########.......",
      ".............................",
      "..fff.fff....................",
      ".............................",
];
const RIVERWATCH_ROWS = [
      "~~~~~~~~~~~~~~~~~~~~~D~~~~~~~~~~~~~~~~~~~~~",
      "...........................................",
      "...##################G##################...",
      "...#T.................................T#...",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...H..H..H..............H..H..H....#..f",
      "f..#...................................#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#............m.........m............#..f",
      "f..#...H..........................H....#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "f..#.................K.................#..f",
      "...#........i.................c........#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "f..#T.............s.....s.............T#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "f..#...H.........n.......B........H....#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "f..#...H......F......W......W.....H....#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "f..#......H..H..............H..H.......#..f",
      "...#...................................#...",
      "f..#...................................#..f",
      "f..#...................................#..f",
      "...#T.................................T#...",
      "...##################G##################...",
      "...........................................",
      "~~~~~~~~~~~~~~~~~~~~~D~~~~~~~~~~~~~~~~~~~~~",
];
// The two wood forts. `tiers`: the tier (digit) each non-"." cell joins at. Below its tier a gate cell is a
// wall while the wall ring stands (tier 2+), a wall cell is a fence (tier 1 camp), anything else stays open.
export const SITE_TEMPLATES: Record<SiteTemplateId, SiteTemplate> = {
  // Fort 1 - Thornwick Palisade (bandit, 21x13, tiers 1-3): the early target, gold + food loot.
  thornwick: {
    id: "thornwick",
    faction: "bandit",
    label: "Palisade",
    names: [
      "Thornwick", "Blackbriar", "Crowmoor", "Ravensgate", "Gallowhill", "Brackenfell", "Wolfden", "Ashcombe",
      "Redmire", "Hollowmere", "Dunmarsh", "Stagthorn", "Briarwood", "Coldharbour",
    ],
    rows: [
      "##########G##########",
      "#..................T#",
      "#..H..H.......H..H..#",
      "#...................#",
      "#..s.....C.C.....s..#",
      "#...................#",
      "#..H.....sKs.....H..#",
      "#...................#",
      "#..p.p.........f.f..#",
      "#..p.p.........f.f..#",
      "#...................#",
      "#T..................#",
      "##########G##########",
    ],
    tiers: [
      "222222222232222222222",
      "2..................32",
      "2..3..1.......1..3..2",
      "2...................2",
      "2..1.....1.1.....1..2",
      "2...................2",
      "2..1.....111.....1..2",
      "2...................2",
      "2..1.1.........1.1..2",
      "2..1.1.........1.1..2",
      "2...................2",
      "22..................2",
      "222222222222222222222",
    ],
    maxTier: 3,
    startTier: 2,
    garrison: { banditClubman: 4, banditArcher: 3, banditElite: 1 },
    stock: { gold: 60, grain: 40, wood: 30 },
    rebuildCost: { wood: 40, rock: 20 },
  },
  // Fort 2 - Grakkar Stockade (orc, 29x21, tiers 1-4): the main punishment camp. Tier 4 (phase G / H) digs
  // the moat strip with a drawbridge before the south gate and adds the bottom towers.
  grakkar: {
    id: "grakkar",
    faction: "orc",
    label: "Stockade",
    names: [
      "Grakkar", "Urzog", "Mograth", "Skarbak", "Gulgor", "Drakmor", "Thrukka", "Vargnar", "Zagrot", "Krullgash",
      "Bolgrim", "Ushnak",
    ],
    rows: [
      "#############################",
      "#T.........................T#",
      "#..H.H.H.............H.H.H..#",
      "#...........................#",
      "#..F.......C.......C.....M..#",
      "#...........................#",
      "#.H.H...pp...........pp.H.H.#",
      "#.......pp...........pp.....#",
      "#...........................#",
      "#......sss....K....sss......G",
      "#...........................#",
      "#.H.H...ff...........ff.H.H.#",
      "#.......ff...........ff.....#",
      "#...........................#",
      "#..C.....................C..#",
      "#...........................#",
      "#T.........................T#",
      "##############G##############",
      ".............................",
      "~~~~~~~~~~~~~~D~~~~~~~~~~~~~~",
      ".............................",
    ],
    tiers: [
      "22222222222222222222222222222",
      "22.........................32",
      "2..1.1.1.............1.1.1..2",
      "2...........................2",
      "2..2.......1.......1.....1..2",
      "2...........................2",
      "2.3.3...11...........11.3.3.2",
      "2.......11...........11.....2",
      "2...........................2",
      "2......111....1....111......3",
      "2...........................2",
      "2.1.1...11...........11.1.1.2",
      "2.......11...........11.....2",
      "2...........................2",
      "2..1.....................1..2",
      "2...........................2",
      "24.........................42",
      "22222222222222222222222222222",
      ".............................",
      "44444444444444444444444444444",
      ".............................",
    ],
    maxTier: 4,
    startTier: 2,
    garrison: { orc: 4, goblin: 2, goblinCrossbow: 2, armoredOrc: 1, darkShaman: 1 },
    stock: { gold: 40, wood: 80, iron: 30, rock: 30 },
    rebuildCost: { wood: 40, rock: 20 },
  },
  // Fort 3 - Hearthmoor (human farming hamlet, stone, 31x27, single stage): farms in a ring outside the wall.
  hearthmoor: {
    id: "hearthmoor",
    faction: "human",
    label: "",
    noun: "village",
    names: [
      "Hearthmoor", "Ashford", "Willowby", "Brookhollow", "Oakhurst", "Millbrook", "Thistledown", "Elmstead", "Fairmead", "Greenhithe", "Kettlewell", "Marshfield",
    ],
    rows: HEARTHMOOR_ROWS,
    tiers: singleStage(HEARTHMOOR_ROWS),
    maxTier: 1,
    startTier: 1,
    symbols: HUMAN_SITE_SYMBOLS,
    garrison: { townGuard: 4, townArcher: 2 },
    workers: { farm: 4, priest: 1 },
    stock: { gold: 50, grain: 80, fruit: 30, meat: 20 },
    rebuildCost: { wood: 80, rock: 80, iron: 20 },
  },
  // Fort 4 - Ironhold (human mining outpost, stone, 29x25): ore field (real ore tiles, inside the reserved grounds) outside the east gate.
  ironhold: {
    id: "ironhold",
    faction: "human",
    label: "",
    noun: "mining outpost",
    names: [
      "Ironhold", "Deepdelve", "Coldforge", "Greystone", "Hammerfell", "Copperhill", "Slatebrook", "Anvilmere",
    ],
    rows: IRONHOLD_ROWS,
    tiers: singleStage(IRONHOLD_ROWS),
    maxTier: 1,
    startTier: 1,
    symbols: HUMAN_SITE_SYMBOLS,
    garrison: { townGuard: 3, townArcher: 2, townKnight: 1 },
    workers: { mine: 3, farm: 1 },
    stock: { gold: 40, iron: 60, rock: 80 },
    rebuildCost: { wood: 80, rock: 80, iron: 20 },
  },
  // Fort 5 - Riverwatch (human garrison town, stone, 43x39, rare): moat strips N / S (Water until phase H) with drawbridge gaps (open ground).
  riverwatch: {
    id: "riverwatch",
    faction: "human",
    label: "",
    noun: "town",
    names: [
      "Riverwatch", "Kingsbridge", "Highwater", "Stonebridge", "Castlemere",
    ],
    rows: RIVERWATCH_ROWS,
    tiers: singleStage(RIVERWATCH_ROWS),
    maxTier: 1,
    startTier: 1,
    symbols: HUMAN_SITE_SYMBOLS,
    garrison: { townGuard: 5, townArcher: 4, townKnight: 3 },
    workers: { farm: 4, mine: 1, priest: 1 },
    stock: { gold: 150, grain: 60, wood: 60, iron: 30, clothes: 20 },
    rebuildCost: { wood: 80, rock: 80, iron: 20 },
  },
};
// Reserved grounds around a fort's template rectangle: cleared at stamping, no player building, no POI.
export const SITE_APRON_TILES = 2;
// World-gen: no forts on maps smaller than this (the 80 / 96-tile test worlds stay as they were); counts are
// round(SITE_FORT_COUNT_AT_512 x (size / 512)^SITE_FORT_COUNT_EXP): 512: 12 + 10, 256: 5 + 4, 160: 2 + 2.
export const SITE_FORT_MIN_WORLD_TILES = 128;
export const SITE_FORT_COUNT_AT_512: Record<SiteTemplateId, number> = { thornwick: 12, grakkar: 10, hearthmoor: 5, ironhold: 3, riverwatch: 2 };
export const SITE_FORT_COUNT_EXP = 1.4;
// Fort centres keep this far apart (Euclidean tiles), this far from every Town Center (the start), and
// their grounds this far off the Abbey / Castle Ruin grounds. Orc stockades try the outer ring first (at
// least SITE_ORC_RING_FRACTION of the map side from the start), then anywhere legal.
export const SITE_FORT_SPACING_TILES = 40;
export const SITE_FORT_START_CLEARANCE_TILES = 50;
export const SITE_FORT_LANDMARK_CLEARANCE_TILES = 4;
export const SITE_ORC_RING_FRACTION = 0.3;
export const SITE_FORT_PLACE_ATTEMPTS = 600;
// Ruins / encampments / mini-boss packs keep this far off any fort's reserved grounds.
export const SITE_POI_CLEARANCE_TILES = 4;
// Keep (= hearth) HP by tier 1-4.
export const SITE_KEEP_HP_BY_TIER = [200, 350, 550, 800];
// Stage 2, sleeping sites: a fort simulates (towers, gates, refills) only while a living player or colonist is
// within this Chebyshev radius of its keep (3 chunks of 32).
export const SITE_AWAKE_RADIUS_TILES = 96;
// Provoke: a player / colonist within this far of the keep, or SITE_AGGRO_EDGE_TILES of its rectangle, wakes
// the whole garrison (as damage does).
export const SITE_AGGRO_TILES = 12;
export const SITE_AGGRO_EDGE_TILES = 3;
// Defender leash (site guardians only, never raid mobs): chase only within this many tiles of home (fort: the
// yard tile below the keep; other sites: the mob's own post), drop a target beyond leash +
// SITE_CHASE_EXTRA_TILES, walk home x SITE_RETURN_SPEED_MULT ignoring targets for SITE_RETURN_IGNORE_TICKS.
// The Castle Ruin (boss track) has no leash.
export const SITE_LEASH_TILES: Partial<Record<PoiSiteKind, number>> = { fort: 16, encampment: 12, ruin: 12, miniBoss: 14 };
export const SITE_CHASE_EXTRA_TILES = 2;
export const SITE_RETURN_SPEED_MULT = 1.2;
export const SITE_RETURN_IGNORE_TICKS = 2 * TICK_RATE;
// Healing at home: within SITE_HEAL_RADIUS_TILES of home with no hostile within SITE_CALM_SCAN_TILES and no
// damage for SITE_HEAL_CALM_TICKS: +SITE_HEAL_PER_SEC of max HP per second. After SITE_RESET_CALM_TICKS calm a
// guardian goes dormant again.
export const SITE_HEAL_RADIUS_TILES = 6;
export const SITE_CALM_SCAN_TILES = 10;
export const SITE_HEAL_CALM_TICKS = 5 * TICK_RATE;
export const SITE_HEAL_PER_SEC = 0.04;
export const SITE_RESET_CALM_TICKS = 20 * TICK_RATE;
// Anti-kite (forts): SITE_KITE_HITS hits on its mobs from attackers beyond the leash ring (decaying 1 per
// SITE_KITE_DECAY_TICKS) start a surge: leash +SITE_SURGE_LEASH_TILES, towers +SITE_SURGE_TOWER_RANGE_TILES
// range, melee defenders stop returning, for SITE_SURGE_TICKS; then SITE_SURGE_COOLDOWN_TICKS.
export const SITE_KITE_HITS = 3;
export const SITE_KITE_DECAY_TICKS = 4 * TICK_RATE;
export const SITE_SURGE_TICKS = 8 * TICK_RATE;
export const SITE_SURGE_COOLDOWN_TICKS = 12 * TICK_RATE;
export const SITE_SURGE_LEASH_TILES = 6;
export const SITE_SURGE_TOWER_RANGE_TILES = 2;
// Garrison refill on waking (not cleared): one guardian per SITE_REFILL_TICKS slept, up to the max.
export const SITE_REFILL_TICKS = 60 * TICK_RATE;
// Clearing (keep razed): this share of the fort's stockpile is plundered on top of the hearth loot.
export const SITE_LOOT_STOCK_SHARE = 0.5;

// ---- Forts phase G: wandering warbands found camps; camps grow and punish neglect (warbands.ts) ----
// At most round(WARBAND_COUNT_AT_512 x (size / 512)^WARBAND_COUNT_EXP) warbands + standing founded camps
// (512: 4, 256: 2, 160: 1; none below SITE_FORT_MIN_WORLD_TILES). At dawn of WARBAND_FIRST_DAY or later, once
// the next spawn day has come, one warband spawns at the map edge (never within WARBAND_CLAN_CLEARANCE_TILES of a
// Town Center); the next one is WARBAND_SPAWN_DAYS (+0..1) days later.
export const WARBAND_COUNT_AT_512 = 4;
export const WARBAND_COUNT_EXP = 1.2;
export const WARBAND_FIRST_DAY = 2;
export const WARBAND_SPAWN_DAYS = 3;
export const WARBAND_CLAN_CLEARANCE_TILES = 60;
// Where it settles: the camp's centre WARBAND_SETTLE_MIN..MAX tiles from the nearest Town Center, at least
// SITE_FORT_SPACING_TILES from every other site's keep, on clearable natural ground (siteFitProblem clearable).
export const WARBAND_SETTLE_MIN_TC_TILES = 70;
export const WARBAND_SETTLE_MAX_TC_TILES = 170;
export const WARBAND_SETTLE_ATTEMPTS = 400;
// Size at spawn: WARBAND_SIZE_BASE + day / WARBAND_SIZE_DAYS_PER_MOB, at most WARBAND_SIZE_MAX.
export const WARBAND_SIZE_BASE = 5;
export const WARBAND_SIZE_DAYS_PER_MOB = 5;
export const WARBAND_SIZE_MAX = 9;
// Walk pace (x the slowest member's speed); the route is findPath segments of WARBAND_SEGMENT_TILES.
export const WARBAND_PACE = 0.6;
export const WARBAND_SEGMENT_TILES = 24;
// Bodies only while a player / colonist is within WARBAND_AWAKE_TILES (Chebyshev); abstract again past
// WARBAND_SLEEP_TILES. "A warband is on the move" once one comes within WARBAND_SIGHT_TILES; it turns to fight
// (dissolves into ordinary hostile mobs) when hit or when a unit comes within WARBAND_ENGAGE_TILES.
export const WARBAND_AWAKE_TILES = 96;
export const WARBAND_SLEEP_TILES = 104;
export const WARBAND_SIGHT_TILES = 20;
export const WARBAND_ENGAGE_TILES = 5;
// Camp growth: a founded camp goes up one tier every CAMP_GROWTH_DAYS (+0..1, dice per site and tier) game
// days, up to its template's maxTier, applied lazily; paused while provoked, stops once cleared / captured.
export const CAMP_GROWTH_DAYS: Record<"bandit" | "orc", number> = { bandit: 4, orc: 5 };
export const CAMP_GARRISON_BY_TIER = [5, 8, 12, 18];
// Raids: a tier CAMP_RAID_MIN_TIER camp raids every 2nd night, tier 4 every night: 3 x tier + day / 4 mobs
// (cap CAMP_RAID_SIZE_CAP) at the nearest Town Center within CAMP_RAID_RANGE_TILES (only that Town Center's clan).
export const CAMP_RAID_MIN_TIER = 3;
export const CAMP_RAID_RANGE_TILES = 140;
export const CAMP_RAID_SIZE_CAP = 24;
// Each tier 3+ camp within CAMP_RAID_BONUS_RANGE_TILES of a clan's Town Center adds CAMP_RAID_BONUS_PER_CAMP
// to that clan's night raid size (cap CAMP_RAID_BONUS_MAX).
export const CAMP_RAID_BONUS_PER_CAMP = 0.1;
export const CAMP_RAID_BONUS_MAX = 0.4;
export const CAMP_RAID_BONUS_RANGE_TILES = 150;
// Settlements within QUEST_CAMP_RANGE_TILES of a tier 3+ camp roll quests x CAMP_QUEST_CHANCE_MULT, camp first.
export const CAMP_QUEST_CHANCE_MULT = 3;
// A razed founded camp's spot may be re-settled after this many game days.
export const CAMP_RESETTLE_COOLDOWN_DAYS = 10;
// ---- Forts phase C: human settlements (PLAN-forts-diplomacy-moats.md §3, §8, §10 "C") ----
// World-gen: round(SETTLEMENT_COUNT_AT_512 x (size / 512)^SITE_FORT_COUNT_EXP) settlements (512: 10, 256: 4,
// 160: 2; none < SITE_FORT_MIN_WORLD_TILES), split floor(n / 4) Riverwatch, round(n x 0.3) Ironhold, the rest
// Hearthmoor. Centres >= SETTLEMENT_SPACING_TILES apart, >= SETTLEMENT_START_CLEARANCE_TILES from every Town
// Center, >= SITE_FORT_SPACING_TILES from any fort; the first half of the attempts stay within
// SETTLEMENT_INNER_RING_FRACTION of the map side of a Town Center.
export const SETTLEMENT_COUNT_AT_512 = 10;
export const SETTLEMENT_SPACING_TILES = 80;
export const SETTLEMENT_START_CLEARANCE_TILES = 50;
export const SETTLEMENT_INNER_RING_FRACTION = 0.35;
export const SETTLEMENT_PLACE_ATTEMPTS = 1500;
// Attacked (any colony damage to its units / buildings): hostile for this long (2 game days), then calm.
export const SETTLEMENT_HOSTILE_TICKS = 2 * (DAY_TICKS + NIGHT_TICKS);
// Relations hook (phase D builds the rest): Clan.relations[site number], -100..100, default neutral.
export const RELATION_NEUTRAL = 0;
export const RELATION_MIN = -100;
export const RELATION_MAX = 100;
// First attack of a hostile spell (per clan), razing the keep, capturing it (every OTHER settlement).
export const RELATION_ATTACK_PENALTY = 15;
export const RELATION_RAZE_PENALTY = 40;
export const RELATION_CONQUEROR_PENALTY = 25;
// ---- Forts phase D: relations and direct trade (PLAN-forts-diplomacy-moats.md §4, §5; diplomacy.ts) ----
// Tiers by relation value (lower bound inclusive): Hostile <= -50 < Wary <= -10 < Neutral < 25 <= Friendly
// < 60 <= Allied; reaching RELATION_MAX flags the clan as the settlement's would-be liege ("Vassal-ready",
// phase F builds the mechanics), kept while >= RELATION_VASSAL_KEEP (hysteresis).
export const RELATION_WARY_MIN = -49;
export const RELATION_NEUTRAL_MIN = -9;
export const RELATION_FRIENDLY_MIN = 25;
export const RELATION_ALLIED_MIN = 60;
export const RELATION_VASSAL_KEEP = 70;
// Gains (per clan per settlement). Trade: +1 per TRADE_GOLD_PER_RELATION gold traded (both ways), capped
// RELATION_TRADE_DAILY_CAP per game day; defence: +1 per hostile mob (raid / bandit / orc) the clan kills
// within RELATION_DEFEND_RANGE_TILES of its walls, cap RELATION_DEFEND_DAILY_CAP. Both diminish as the day's
// cap fills (x max(RELATION_DIMINISH_FLOOR, 1 - gainedToday / cap)) and need relation > Hostile and the
// settlement not currently up in arms against that clan. Clearing a bandit / orc camp or fort: +15 to every
// settlement within RELATION_CAMP_NEAR_TILES, +5 within RELATION_CAMP_FAR_TILES (uncapped, also from Hostile:
// the way back). Drift: no gain for RELATION_IDLE_DAYS -> 1 point a dawn toward neutral.
export const TRADE_GOLD_PER_RELATION = 20;
export const RELATION_TRADE_DAILY_CAP = 6;
export const RELATION_DEFEND_RANGE_TILES = 20;
export const RELATION_DEFEND_DAILY_CAP = 8;
export const RELATION_DIMINISH_FLOOR = 0.2;
export const RELATION_CAMP_NEAR_TILES = 60;
export const RELATION_CAMP_FAR_TILES = 120;
export const RELATION_CAMP_NEAR_BONUS = 15;
export const RELATION_CAMP_FAR_BONUS = 5;
export const RELATION_IDLE_DAYS = 3;
export const RELATION_DRIFT_PER_DAY = 1;
// Direct trade: base price (gold per unit). Colony buys at base x TRADE_BUY_MARKUP x discount x (1 +
// TRADE_DAY_STEP x boughtToday); sells at base x TRADE_SELL_FACTOR x (2 - discount) x (1 - TRADE_DAY_STEP x
// soldToday) (floor TRADE_SELL_FLOOR x base); discount by tier below. Buy > sell at every tier.
export const TRADE_BASE_PRICE: Record<"wood" | "rock" | "iron" | "grain" | "meat" | "fruit" | "wool" | "clothes" | "tools", number> = {
  wood: 1, rock: 1.5, iron: 3, grain: 2, meat: 3, fruit: 3, wool: 2, clothes: 6, tools: 8,
};
export const TRADE_BUY_MARKUP = 1.4;
export const TRADE_SELL_FACTOR = 0.6;
export const TRADE_SELL_FLOOR = 0.3;
export const TRADE_DAY_STEP = 0.01;
export const TRADE_TIER_DISCOUNT = { neutral: 1, friendly: 0.85, allied: 0.7, vassal: 0.65 } as const;
// Per good per direction per clan per settlement per game day; one order 1..TRADE_MAX_QTY units.
export const TRADE_DAILY_CAP_PER_GOOD = 40;
export const TRADE_MAX_QTY = 50;
// The player (or one of the clan's colonists) must stand within this many tiles of the settlement's walls.
export const TRADE_RANGE_TILES = 6;
// A settlement holds at most this much of a good (what it accepts when you sell); gold is its purse.
export const SETTLEMENT_STOCK_CAP = 200;
export const SETTLEMENT_GOLD_CAP = 600;
// Daily production at dawn (capped); goods a settlement does not produce are used up by
// SETTLEMENT_CONSUME_FRACTION a dawn (so it buys them again).
export const SETTLEMENT_PRODUCTION: Partial<Record<SiteTemplateId, Partial<Record<ResourceKey, number>>>> = {
  hearthmoor: { grain: 20, fruit: 8, meat: 6, wool: 4, gold: 10 },
  ironhold: { iron: 8, rock: 15, tools: 1, gold: 10 },
  riverwatch: { grain: 10, wood: 15, iron: 3, fruit: 4, meat: 3, wool: 3, clothes: 2, gold: 25 },
};
export const SETTLEMENT_CONSUME_FRACTION = 0.1;
// ---- Forts phase D2: settlement help quests (quests.ts) ----
// Every QUEST_SCAN_TICKS each standing, sighted settlement may post (chance QUEST_POST_CHANCE) one quest to
// each clan that is not Hostile to it and that it is not up in arms against: at most QUEST_MAX_PER_SITE open
// per settlement per clan, and none sooner than QUEST_COOLDOWN_TICKS after its last one to that clan.
export const QUEST_SCAN_TICKS = TICK_RATE * 30;
export const QUEST_POST_CHANCE = 0.2;
export const QUEST_MAX_PER_SITE = 2;
export const QUEST_COOLDOWN_TICKS = DAY_TICKS + NIGHT_TICKS;
// Expiry (defend quests expire at the next dawn instead).
export const QUEST_EXPIRE_TICKS = 3 * (DAY_TICKS + NIGHT_TICKS);
// clearCamp: a standing bandit / orc camp or fort keep within this many tiles of the settlement's keep.
export const QUEST_CAMP_RANGE_TILES = 60;
// defend (only at night): at least QUEST_DEFEND_MIN_MOBS hostile mobs (no site) within QUEST_DEFEND_RANGE_TILES
// of its walls; the clan must kill need = min(those, QUEST_DEFEND_MAX_NEED) of them within that range.
export const QUEST_DEFEND_RANGE_TILES = 30;
export const QUEST_DEFEND_MIN_MOBS = 3;
export const QUEST_DEFEND_MAX_NEED = 6;
// deliver: a good the settlement does not make and has under QUEST_DELIVER_SHORT of; qty by template.
export const QUEST_DELIVER_SHORT = 20;
export const QUEST_DELIVER_QTY: Partial<Record<SiteTemplateId, number>> = { hearthmoor: 20, ironhold: 20, riverwatch: 30 };
// Gold: clearCamp 60 + 6 per garrison guardian, defend 20 per kill needed, deliver 2x the goods' base price;
// times the tier factor. Relation: gain on completion (capped by RELATION_QUEST_DAILY_CAP, diminishing like
// trade), loss on failure / abandon / ignoring it (expired unaccepted).
export const QUEST_TIER_REWARD = { wary: 0.8, neutral: 1, friendly: 1.15, allied: 1.3, vassal: 1.4, hostile: 0 } as const;
export const QUEST_RELATION_GAIN = { defend: 8, clearCamp: 10, deliver: 6 } as const;
export const RELATION_QUEST_DAILY_CAP = 12;
export const QUEST_FAIL_PENALTY = 8;
export const QUEST_ABANDON_PENALTY = 5;
export const QUEST_IGNORE_PENALTY = 3;
// ---- Forts phase E: trader wagons (wagons.ts; PLAN-forts-diplomacy-moats.md §5 "Trader wagons") ----
// Trading Post (TileType.GoldShop) upgrade costs to Lv2 / Lv3.
export const TRADING_POST_UPGRADE_COSTS: Cost[] = [
  { wood: 60, rock: 40, gold: 30 },
  { wood: 100, rock: 80, iron: 20, gold: 60 },
];
// Per Trading Post level: wagon HP, cargo (gold value of goods loaded per trip), its escort roster (soldiers
// housed by the post: no civilian population), speed (x COLONIST_SPEED), profit factor and the replacement cost.
export const WAGON_LEVELS: { hp: number; cargo: number; escort: ColonistKind[]; speed: number; profit: number; rebuild: Cost }[] = [
  { hp: 120, cargo: 80, escort: ["militia", "militia", "spearman"], speed: 0.8, profit: 1, rebuild: { wood: 20 } },
  { hp: 220, cargo: 180, escort: ["spearman", "spearman", "spearman", "spearman"], speed: 0.9, profit: 1.1, rebuild: { wood: 40, iron: 10 } },
  { hp: 400, cargo: 350, escort: ["pikeman", "pikeman", "pikeman", "pikeman", "cavalry"], speed: 0.9, profit: 1.2, rebuild: { wood: 60, iron: 30, gold: 20 } },
];
// At most this many wagons per clan (one per post).
export const WAGON_CLAN_CAP = 3;
// Destinations: human settlements at Friendly+ within WAGON_MAX_TRIP_TILES (straight line), and the clan's
// other Town Centers (internal trade: WAGON_INTERNAL_VALUE of the goods' base value, no relation).
export const WAGON_MAX_TRIP_TILES = 160;
export const WAGON_INTERNAL_VALUE = 0.5;
// Unloading at the destination (ticks); the wagon and its escorts wait there.
export const WAGON_UNLOAD_TICKS = 20 * TICK_RATE;
// Goods kept back at home (never loaded below this many units of a good).
export const WAGON_EXPORT_RESERVE = 20;
// Relation: a completed delivery adds WAGON_DELIVERY_RELATION + the trade value gain (one gainRelation "trade"
// call, so the daily trade cap applies); goods that never arrive cost WAGON_LOSS_RELATION.
export const WAGON_DELIVERY_RELATION = 2;
export const WAGON_LOSS_RELATION = 3;
// Mobs: a wagon draws aggro from this many tiles further than a soldier (bandits prefer it, see pickMobTarget).
export const WAGON_AGGRO_BONUS_TILES = 4;
// Danger score along a route (sampled every 2nd tile): hazard radius (tiles) and weight per sampled tile in it.
// Bands: score <= WAGON_DANGER_RISKY safe, <= WAGON_DANGER_DEADLY risky, else deadly. A route's cost is
// length + WAGON_DANGER_COST x score (direct path vs one detour around the hazards).
export const WAGON_HAZARD_SITE = { radius: 20, weight: 8 };
export const WAGON_HAZARD_CAMP = { radius: 12, weight: 8 };
export const WAGON_HAZARD_RAID = { radius: 15, weight: 3 };
export const WAGON_HAZARD_BOSS = { radius: 12, weight: 10 };
export const WAGON_RAID_MEMORY_DAYS = 3;
export const WAGON_DANGER_RISKY = 10;
export const WAGON_DANGER_DEADLY = 60;
export const WAGON_DANGER_COST = 4;
// A "under attack" toast at most once per this many ticks per wagon.
export const WAGON_ALERT_TICKS = 20 * TICK_RATE;
// ---- Forts phase F: vassals, call to arms and tribute (vassals.ts; PLAN-forts-diplomacy-moats.md §6) ----
// Power (vassals.ts clanPower / sitePower): every living soldier's hp x damage per hit (clan: its commandable
// fighters, levies and wagon escorts excluded; settlement: its garrison mobs) + POWER_PER_TOWER_LEVEL per tower
// level + POWER_PER_WALL per wall / gate tile (the clan's own tiles; the settlement's inside its rectangle).
export const POWER_PER_TOWER_LEVEL = 300;
export const POWER_PER_WALL = 4;
// Clan power is a map scan: cached this long per clan.
export const POWER_CACHE_TICKS = 2 * TICK_RATE;
// Call to arms: LEVY_SHARE of the living garrison guards (at least LEVY_MIN, if it has them) leave as the
// clan's units for LEVY_DURATION_TICKS (1 game day), never beyond LEVY_MAX_TILES of the keep, then march home
// (back in the garrison within LEVY_RETURN_TIMEOUT_TICKS at the latest); next call LEVY_COOLDOWN_TICKS after
// the call. Each levy killed costs LEVY_DEATH_RELATION, losing them all LEVY_WIPE_RELATION more.
export const LEVY_SHARE = 0.5;
export const LEVY_MIN = 2;
export const LEVY_DURATION_TICKS = DAY_TICKS + NIGHT_TICKS;
export const LEVY_COOLDOWN_TICKS = 3 * (DAY_TICKS + NIGHT_TICKS);
export const LEVY_MAX_TILES = 60;
export const LEVY_RETURN_TIMEOUT_TICKS = Math.round((DAY_TICKS + NIGHT_TICKS) / 4);
export const LEVY_DEATH_RELATION = 1;
export const LEVY_WIPE_RELATION = 5;
export const LEVY_KIND: Partial<Record<MobKind, ColonistKind>> = { townGuard: "spearman", townArcher: "archer", townKnight: "knight" };
// Tribute: allowed while clan power >= TAX_POWER_MIN x the vassal's; every TAX_INTERVAL_DAYS at dawn it takes
// share = min(TAX_SHARE_MAX, TAX_SHARE_BASE x clan / vassal power) of each good in its stock and of its purse
// (gold). Relation cost TAX_RELATION_COST x sqrt(share / TAX_SHARE_MAX) (3 at the base share, 6 at the max:
// heavier tax costs more, with diminishing extra cost). A vassal stronger than its liege (power ratio < 1 at
// a dawn) breaks free, as does relation < RELATION_VASSAL_KEEP.
export const TAX_POWER_MIN = 1.2;
export const TAX_INTERVAL_DAYS = 2;
export const TAX_SHARE_BASE = 0.1;
export const TAX_SHARE_MAX = 0.4;
export const TAX_RELATION_COST = 6;
// The liege hitting its own vassal: no hostile spell, but RELATION_ATTACK_PENALTY at most this often.
export const VASSAL_HIT_COOLDOWN_TICKS = 10 * TICK_RATE;
// Cosmetic workers: pause at each end of the walk (ticks, random up to x2), walk speed factor.
export const SETTLEMENT_WORKER_PAUSE_TICKS = 6 * TICK_RATE;
export const SETTLEMENT_WORKER_SPEED_MULT = 0.7;
export const WARLORD_HP_MULT = 4.5;
export const WARLORD_DAMAGE_MULT = 2;
// On top of the usual goldForKill.
export const WARLORD_REWARD: Partial<Record<ResourceKey, number>> = { gold: 250, wood: 150, rock: 150, iron: 100 };
export const MINI_BOSS_KINDS: MobKind[] = ["wolf", "orc", "skeleton", "giantSpider", "armoredOrc", "troll"];
export const ELITE_HP_MULT = 2.5;
export const ELITE_DAMAGE_MULT = 1.5;
export const ELITE_REWARD: Partial<Record<ResourceKey, number>> = { gold: 60, wood: 40, iron: 30 };
export const GOAL_WORKER_KINDS = new Set<ColonistKind>([
  "lumberjack", "farmer", "ironMiner", "rockMiner", "farmhand", "artisan", "hunter", "forager",
]);
export const EXPLORED_FLUSH_TICKS = 5; // 4 Hz at TICK_RATE 20
// Player-built structures that see (walls don't), plus the Town Center. Natural terrain, POI
// props and the Abbey never do.
export const VISION_BUILDING_TILES = new Set<TileType>([
  TileType.TownCenter,
  TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.BarnPost, TileType.LumberjackPost,
  TileType.FarmPlot, TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3, TileType.ArcherPost,
  TileType.Tower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost, TileType.Pasture,
  TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop, TileType.Blacksmith,
  TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery, TileType.Tavern,
  TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
  TileType.HunterHut, TileType.ForagerHut, TileType.BuildersGuild, TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
]);
export const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6];

// COLONY_TEST_HOOKS=1 enables the "testHook" client message for scripted tests (server/*.mjs):
// time travel, raid-state dumps, direct mob damage and tick timing. Off by default: never needed
// by (or reachable from) the real client.
export const TEST_HOOKS = process.env.COLONY_TEST_HOOKS === "1";
export const TICK_DURATION_SAMPLES = 400;
// PORT lets a scripted test run a private server without touching the shared :8080 world.
export const PORT = Number.parseInt(process.env.PORT ?? "", 10) || 8080;
// ---- Save files ----
// One JSON file per slot under server/saves/ (or COLONY_SAVE_DIR). snapshotWorld captures every piece
// of module state that defines the world; applyWorld writes it back IN PLACE (the const Maps/Sets/
// arrays/typed arrays are cleared and refilled, so nothing that holds a reference to them goes stale).
// Not saved: player sessions (connected players respawn at a Town Center, as after a restart),
// pendingEffects / pendingExplored / visionTile (per-tick transients) and client-only blood.
export const SAVE_VERSION = 1;
export const SAVE_SLOT_LABELS: Record<SaveSlot, string> = { autosave: "Autosave", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3", creative: "Creative" };
export const SAVE_DIR = process.env.COLONY_SAVE_DIR
  ? path.resolve(process.env.COLONY_SAVE_DIR)
  : fileURLToPath(new URL("../saves/", import.meta.url));
// A scripted test server (test hooks on) must never clobber the real world's autosave, so with test
// hooks it only autosaves into a COLONY_SAVE_DIR of its own.
export const AUTOSAVE_ENABLED = !TEST_HOOKS || !!process.env.COLONY_SAVE_DIR;
export const REACH = TILE_SIZE * 2.5;
export const PLACEABLE_TILES = [
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BarnPost,
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.TownCenter,
  TileType.Road,
  TileType.CobbleRoad,
  TileType.Gate,
  TileType.Stables,
  TileType.SiegeWorkshop,
  TileType.Keep,
];
export const BREAKABLE_TILES = [
  // Forts phase A: a fallen NPC wall's rubble can be cleared.
  TileType.Rubble,
  // Forts phase B: a fort's tents (soldiers can burn them down).
  TileType.Tent,
  TileType.Wall,
  TileType.StoneWall,
  TileType.House,
  TileType.BigHouse,
  TileType.HouseLevel2,
  TileType.BarnPost,
  TileType.LumberjackPost,
  TileType.FarmPlot,
  TileType.KnightPost,
  TileType.CastleLevel2,
  TileType.CastleLevel3,
  TileType.ArcherPost,
  TileType.Tower,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Market,
  TileType.GoldShop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.MilitiaPost,
  TileType.MilitiaCamp2,
  TileType.MilitiaCamp3,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Stables,
  TileType.SiegeWorkshop,
  TileType.Keep,
  // Demolishing a site frees its builders; the materials are lost (no refund).
  TileType.ConstructionSite,
  // Demolished roads revert to bare ground.
  TileType.Road,
  TileType.CobbleRoad,
  // Wild forage can be cleared like any other obstacle (it simply stops being food).
  ...FORAGE_TILES,
  TileType.Gate,
];
export const POPULATION_GATED_TILES = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.WardStone,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
];
export const CRAFT_BUILDING_TILES = [TileType.TailorShop, TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Brewery];
export const IN_PLACE_UPGRADE_TILES: TileType[] = [
  TileType.LumberjackPost,
  TileType.BarnPost,
  TileType.ChurchPost,
  TileType.Pasture,
  TileType.Orchard,
  TileType.WoolFarm,
  TileType.CottonFarm,
  TileType.TailorShop,
  TileType.Blacksmith,
  TileType.LuxuryWorkshop,
  TileType.Brewery,
  TileType.Tavern,
  TileType.IronMinePost,
  TileType.RockMinePost,
  TileType.HunterHut,
  TileType.ForagerHut,
  TileType.BuildersGuild,
  TileType.Tower,
  TileType.Keep,
  // Forts phase E: Trading Post levels 2-3 (bigger wagon, stronger escort).
  TileType.GoldShop,
];
export const BUILDERS_GUILD_WOOD_COST = BUILD_COSTS[TileType.BuildersGuild].wood;
export const TOWN_CENTER_COST: Cost = { ...BUILD_COSTS[TileType.TownCenter] };
// Upgrading a Town Center to level 2 / level 3.
export const TOWN_CENTER_UPGRADE_COSTS: Cost[] = [
  { wood: 80, rock: 60, iron: 40 },
  { wood: 120, rock: 100, iron: 80, tools: 10 },
];
// The Keep: build (level 1), then upgrade to level 2 / level 3.
export const KEEP_COSTS: Cost[] = [
  { ...BUILD_COSTS[TileType.Keep] },
  { wood: 90, rock: 70, iron: 40 },
  { wood: 130, rock: 100, iron: 70, tools: 10 },
];
// A new Town Center must stand at least this far (tiles) from every other one (built or queued).
// Doubled 12 -> 24 on 2026-10-28 so settlements spread out (a 160 map still fits several).
export const TOWN_CENTER_MIN_SPACING_TILES = 24;
export const TOWN_CENTER_POI_CLEARANCE_TILES = 6;
export const POI_TILES = new Set<TileType>([
  TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble,
  TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence,
  TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost,
  TileType.Tent, TileType.SiteKeep, TileType.RuinedKeep,
]);
// Base build time (seconds) per level; an upgrade to level n takes n times as long. Split between up
// to BUILDER_MAX_PER_SITE builders and scaled by builderRate (happiness, Town Center, Guild).
export const BUILD_SECONDS_WALL = 4;
// Roads: cheap ground tiles, built by builders like everything else (one tile per placement).
export const ROAD_ROCK_COST = BUILD_COSTS[TileType.Road].rock;
export const COBBLE_ROAD_ROCK_COST = BUILD_COSTS[TileType.CobbleRoad].rock;
export const BUILD_SECONDS_ROAD = 4;
export const BUILD_SECONDS_COBBLE_ROAD = 6;
export const BUILD_SECONDS_HOUSE = 10;
export const BUILD_SECONDS_DEFAULT = 12;
export const BUILD_SECONDS_BIG = 20;
export const BUILD_SECONDS_TOWN_CENTER = 40;
export const BIG_BUILD_TILES = new Set<TileType>([
  TileType.KnightPost, TileType.ChurchPost, TileType.Tavern, TileType.TailorShop, TileType.Blacksmith,
  TileType.LuxuryWorkshop, TileType.Brewery, TileType.Market, TileType.GoldShop, TileType.WardStone,
  TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
]);
// ---- Towers (ROADMAP §8 item 6; separate from the Archery Range) ----
// A free-standing 1x1 building with no workers and no population slot. Every tick each Tower counts down
// its cooldown; off cooldown it shoots the nearest hostile mob within range (a ranged AttackEffect, the
// arrow VFX the archers used). Upgraded in place to level 3 (place a Tower on a Tower, or the info
// panel's Upgrade): faster, harder and slightly longer shots. Max HP is the big-building class
// (BUILDING_HP_BIG x BUILDING_HP_LEVEL_MULT). Damage is flat: no army / Town Center multipliers.
export const TOWER_STATS = [
  { damage: 8, cooldownSeconds: 1.5, rangeTiles: 7 },
  { damage: 12, cooldownSeconds: 1.1, rangeTiles: 7.5 },
  { damage: 18, cooldownSeconds: 0.8, rangeTiles: 8 },
];
// Cost to build (level 1), then to upgrade to level 2 / level 3.
export const TOWER_COSTS: Cost[] = [
  { ...BUILD_COSTS[TileType.Tower] },
  { wood: 30, rock: 30 },
  { wood: 45, rock: 50 },
];
export const HERO_INVENTORY_CAP = 40;
// Total XP at which level 1..10 starts (index = level - 1).
export const HERO_LEVEL_XP = [0, 40, 100, 180, 280, 400, 550, 730, 940, 1200];
export const HERO_MAX_LEVEL = HERO_LEVEL_XP.length;
// Per level above 1: +4% damage dealt (multiplicative on the gear's), +6% of the base max HP (the player's
// base is 100, so +6 HP; a hero's base is its class HP).
export const HERO_LEVEL_DAMAGE_PCT = 4;
export const HERO_LEVEL_MAX_HP = 6;
// XP for a kill (killing blow by that player): 10 per mob, x3 Hunger-marked, 60 a mini-boss elite, 250 the Warlord.
export const HERO_XP_PER_KILL = 10;
export const HERO_XP_MARKED_MULT = 3;
export const HERO_XP_BOSS: Record<BossTier, number> = { warlord: 250, elite: 60 };
// Floors so stacked gear can't zero damage taken or freeze movement.
export const HERO_MIN_DAMAGE_TAKEN_MULT = 0.25;
export const HERO_MIN_SPEED_MULT = 0.5;
// Relic drop chances: a destroyed camp hearth; an armoured kind (EQUIP_ARMOURED_KINDS) or Hunger-marked
// mob (not a boss). The Ogre Warlord and every mini-boss elite always drop one.
export const RELIC_HEARTH_CHANCE = 0.15;
export const RELIC_ELITE_MOB_CHANCE = 0.08;
// Plain tiered pieces pulled from the colony stock: same strength as the soldiers' tier multipliers
// (WEAPON_DAMAGE_MULT x1.2 / 1.4 / 1.7 = +20 / 40 / 70%; ARMOUR_DAMAGE_TAKEN_MULT x0.85 / 0.7 / 0.55).
export const PLAIN_GEAR: Record<EquipSlot, { slot: ItemSlotKind; kind: string; names: string[]; stats: (tier: number) => ItemStats }> = {
  weapon: {
    slot: "weapon", kind: "sword", names: ["Iron Arming Sword", "Steel Arming Sword", "Gilded Arming Sword"],
    stats: (t) => ({ damagePct: Math.round((WEAPON_DAMAGE_MULT[t] - 1) * 100) }),
  },
  armour: {
    slot: "chest", kind: "cuirass", names: ["Iron & Leather Cuirass", "Steel Breastplate", "Gilded Breastplate"],
    stats: (t) => ({ damageTakenPct: Math.round((ARMOUR_DAMAGE_TAKEN_MULT[t] - 1) * 100) }),
  },
};
// The Sworn Relics: unique named pieces, at most one of each per profile (owned or equipped).
export const RELIC_CATALOGUE: { relicId: string; slot: ItemSlotKind; kind: string; name: string; icon: string; stats: ItemStats }[] = [
  { relicId: "oathkeeperHelm", slot: "head", kind: "helm", name: "Oathkeeper's Helm", icon: "relicHelm", stats: { damageTakenPct: -15, maxHp: 20 } },
  { relicId: "gorrathHide", slot: "chest", kind: "cuirass", name: "Gorrath's Hide", icon: "relicChest", stats: { damageTakenPct: -40, maxHp: 30 } },
  { relicId: "vhorrunStride", slot: "legs", kind: "greaves", name: "Vhorrun's Stride", icon: "relicLegs", stats: { moveSpeedPct: 15, damageTakenPct: -10 } },
  { relicId: "wardStoneAegis", slot: "offhand", kind: "shield", name: "Aegis of the Ward Stone", icon: "relicShield", stats: { damageTakenPct: -20, maxHp: 15 } },
  { relicId: "swornOathblade", slot: "weapon", kind: "sword", name: "The Sworn Oathblade", icon: "relicSword", stats: { damagePct: 60, attackSpeedPct: 10 } },
  { relicId: "gunneTooth", slot: "weapon", kind: "spear", name: "Gunne's Tooth", icon: "relicSpear", stats: { damagePct: 55, moveSpeedPct: 10 } },
  { relicId: "morvainWhisper", slot: "weapon", kind: "bow", name: "Morvain's Whisper", icon: "relicBow", stats: { damagePct: 40, attackSpeedPct: 30 } },
  { relicId: "abbeyEmberstaff", slot: "weapon", kind: "staff", name: "Abbey Emberstaff", icon: "relicStaff", stats: { damagePct: 35, spellPowerPct: 40 } },
];
// ---- Hero phase 3: heroes (ROADMAP "Hero phase 3: heroes") ----
// A hero is a colonist of kind "hero" with a class (HERO_CLASS_STATS) and a name; its id is stable across
// deaths and its profile "hero:<id>" (same list as the players') holds XP / level / equipment. It is
// recruited at a Keep (at most one per Keep level), counts HERO_POPULATION_COST toward the Keep's
// settlement, fights as a soldier of its class's role, never deserts or despawns, and comes back from
// death at a dawn / dusk window for a gold fee.
export const HERO_KEY_PREFIX = "hero:";
// One sheet tab per hero: at most this many in the colony.
export const HERO_MAX_TOTAL = 9;
export const HERO_RECRUIT_TICKS = 10 * TICK_RATE;
export const HERO_RESPAWN_FEE_BASE = 50;
export const HERO_RESPAWN_FEE_PER_LEVEL = 25;
export const HERO_RECRUIT_COST: Record<HeroClass, Cost> = {
  champion: { gold: 120, iron: 20 },
  marksman: { gold: 100, wood: 30 },
  mage: { gold: 140, rock: 20 },
};
export const HERO_NAMES = [
  "Aldric", "Brannoc", "Cedwyn", "Daria", "Edric", "Fenna", "Garrow", "Hild", "Isolde", "Jorund",
  "Kestrel", "Leofric", "Maelis", "Osric", "Rowena", "Sigrun", "Tamsin", "Ulric", "Wynne", "Yseult",
];
// ---- Hero phase 4: spells (ROADMAP "Hero phase 4: spells") ----
// The spell table (SPELLS) lives in protocol.ts so the client's tooltips use the same numbers. Every
// profile (the player's and each hero's) has learned spells + 4 spell slots; a spell has a cooldown per
// caster (no mana). Damage / heal / shield amounts scale with the caster's spellPowerMult (gear + a mage's
// SPELL_MAGE_BASE_PCT). Status effects (burn, slow, curse, ward shield, rally buff) and summons live in
// small transient maps (spellStatuses / summonedUntil) and are NOT saved: a load starts with none.
export const SPELL_MAGE_BASE_PCT = 25;
// Level-up spell grants: one at each of these levels, the next unlearned spell of the class's order.
export const SPELL_GRANT_LEVELS = [2, 4, 6, 8, 10];
export const SPELL_LEARN_ORDER: Record<HeroClass | "player", SpellId[]> = {
  player: ["fireBolt", "heal", "ward", "thunder", "rallyBanner"],
  champion: ["rallyBanner", "ward", "curse", "thunder", "heal"],
  marksman: ["fireBolt", "curse", "frost", "thunder", "rallyBanner"],
  mage: ["fireBolt", "frost", "thunder", "heal", "curse", "summon"],
};
// Spell Tomes: the Ogre Warlord always drops one, a mini-boss elite TOME_ELITE_CHANCE, a destroyed camp
// hearth TOME_HEARTH_CHANCE (to the killer, else every connected player's pack, like relics).
export const TOME_ELITE_CHANCE = 0.5;
export const TOME_HEARTH_CHANCE = 0.1;
// The Church sells the two basic spells to the player (colony gold).
export const CHURCH_SPELL_PRICES: Partial<Record<SpellId, number>> = { heal: 80, ward: 120 };
// A cast reaches this far past the spell's range (tiles), so a click on a target's edge still counts.
export const SPELL_RANGE_SLACK_PX = TILE_SIZE / 2;
// Hero auto-cast: rules are checked every SPELL_AUTO_EVERY_TICKS; thresholds per rule.
export const SPELL_AUTO_EVERY_TICKS = 5;
export const SPELL_AUTO_HEAL_BELOW = 0.6;
export const SPELL_AUTO_WARD_HURT_TICKS = 2 * TICK_RATE;
export const SPELL_AUTO_RALLY_ENGAGED = 4;
export const SPELL_AUTO_SUMMON_SCAN_TILES = 6;
// ---- The raids' siege engines (updateMob hands them to updateSiegeMob once released) ----
// A ram looks for a closed gate within RAM_GATE_SCAN_TILES first, then breaches walls / hits buildings
// like any mob (pickBuildingTarget); units only when it stands next to one and has no building to hit.
export const RAM_GATE_SCAN_TILES = 25;
export const SIEGE_RETARGET_TICKS = 2 * TICK_RATE;
export const BUILDING_NAMES: Partial<Record<TileType, string>> = {
  ...UPGRADE_NAMES,
  [TileType.BigHouse]: "Cottage",
  [TileType.HouseLevel2]: "Cottage",
  [TileType.CastleLevel2]: "Hall of the Sworn",
  [TileType.CastleLevel3]: "Hall of the Sworn",
  [TileType.MilitiaCamp2]: "Militia Camp",
  [TileType.MilitiaCamp3]: "Militia Camp",
  [TileType.Market]: "Bazaar",
  [TileType.GoldShop]: "Trading Post",
  [TileType.WardStone]: "Ward Stone",
  [TileType.FarmPlot]: "Farm Plot",
  [TileType.Wall]: "Wood Wall",
  [TileType.StoneWall]: "Stone Wall",
  [TileType.Gate]: "Gate",
  // Forts phase B.
  [TileType.Tent]: "Tent",
  [TileType.SiteKeep]: "Chief's hall",
  [TileType.RuinedKeep]: "Ruined keep",
  [TileType.Road]: "Road",
  [TileType.CobbleRoad]: "Cobble Road",
  [TileType.SiegeWorkshop]: "Siege Workshop",
};
export const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
// ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
// Every blow between a mob and the other side (a soldier/colonist/player hitting a mob, a mob hitting
// a colonist/player/building) is logged as a FightHit. Every FIGHT_SCAN_TICKS, scanFights drops hits
// older than FIGHT_WINDOW_SECONDS and clusters the rest by proximity (FIGHT_CLUSTER_TILES) into
// activeFights, keeping each fight's id while it lasts. Each snapshot then carries the player's own
// relevant subset (fightsForPlayer), spliced into the shared payload by withPlayerFights.
export const FIGHT_SCAN_TICKS = Math.round(TICK_RATE / 2);
export const FIGHT_WINDOW_TICKS = FIGHT_WINDOW_SECONDS * TICK_RATE;
// Bounds the work in a huge battle: the oldest hits go first past FIGHT_MAX_HITS, and only the
// FIGHT_MAX_TRACKED biggest clusters are kept.
export const FIGHT_MAX_HITS = 3000;
export const FIGHT_MAX_TRACKED = 32;
// Intensity thresholds (combatants / damage per second).
export const FIGHT_BATTLE_COMBATANTS = 5;
export const FIGHT_BATTLE_DPS = 20;
export const FIGHT_MAJOR_COMBATANTS = 12;
export const FIGHT_MAJOR_DPS = 60;
export const FIGHT_RAID_LABELS: Partial<Record<MobKind, string>> = {
  wolf: "Wolf pack",
  banditClubman: "Bandit raid",
  banditArcher: "Bandit raid",
  banditElite: "Bandit raid",
  skeleton: "Dark host",
  giantSpider: "Dark host",
  darkShaman: "Dark host",
};
// Interest management (worlds bigger than this): view distance (half-screen at max zoom-out) + margin.
export const SNAPSHOT_CULL_MIN_WORLD = 192;
export const SNAPSHOT_VIEW_TILES = 60;
// Strategy mode phase 1: a setView rect is capped at this half extent (tiles), padded by the margin, and
// accepted at most once per SET_VIEW_MIN_MS per socket (the client sends at most 5/s).
export const STRATEGY_VIEW_MAX_HALF_TILES = 140;
export const STRATEGY_VIEW_MARGIN_TILES = 4;
export const SET_VIEW_MIN_MS = 100;
export const dt = 1 / TICK_RATE;
