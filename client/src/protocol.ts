export const TICK_RATE = 20;
export const TILE_SIZE = 32;
// Server-side default; the live size is overridable (COLONY_WORLD_SIZE) and sent in `welcome`.
export const DEFAULT_WORLD_TILES = 160;
export const PLAYER_SPEED = 150;
export const PLAYER_HALF_SIZE = 10;
export const PLAYER_MAX_HP = 100;

// Fog-of-war vision radii, in tiles (minimap only; the main view is never fogged). A tile within
// one of these of a source's tile becomes "explored" for good (server-authoritative, shared by all
// players). The client reuses PLAYER/COLONIST to decide which mobs are in live view right now.
export const VISION_RADIUS_PLAYER = 10;
export const VISION_RADIUS_COLONIST = 6;
// Placed buildings (walls excluded) and the Town Center.
export const VISION_RADIUS_BUILDING = 5;
// Revealed around the Town Center when a world is generated, so the minimap isn't blank at t=0.
export const VISION_RADIUS_START = 12;

export enum TileType {
  Empty = 0,
  Wall = 1,
  Tree = 2,
  LumberjackPost = 3,
  FarmPlot = 4,
  KnightPost = 5,
  ArcherPost = 6,
  IronOre = 7,
  Rock = 8,
  IronMinePost = 9,
  RockMinePost = 10,
  StoneWall = 11,
  TownCenter = 12,
  House = 13,
  BigHouse = 14,
  HouseLevel2 = 15,
  BarnPost = 16,
  CastleLevel2 = 17,
  CastleLevel3 = 18,
  ArcherTower = 19,
  ChurchPost = 20,
  Pasture = 21,
  Orchard = 22,
  WoolFarm = 23,
  CottonFarm = 24,
  TailorShop = 25,
  Blacksmith = 26,
  LuxuryWorkshop = 27,
  Market = 28,
  GoldShop = 29,
  Brewery = 30,
  Tavern = 31,
  MilitiaPost = 32,
  MilitiaCamp2 = 33,
  MilitiaCamp3 = 34,
  // World-gen only (never player-placeable): ponds, ruin-site decoration, encampment props.
  Water = 35,
  RuinWall1 = 36,
  RuinWall2 = 37,
  RuinArch = 38,
  RuinStatue = 39,
  RuinRubble = 40,
  PropCampfire = 41,
  PropCart = 42,
  PropBarrel = 43,
  PropCrate = 44,
  PropFence = 45,
  // Saint Wren's Abbey (world-gen only, exactly one per map): the hall its resident clergy are
  // posted at, plus devotional props. Never player-placeable or demolishable.
  AbbeyHall = 46,
  PropCross = 47,
  PropLanternPost = 48,
  // Player-built: staffed by a warding Bishop, suppresses mob targeting nearby while he's present.
  WardStone = 49,
  // Player-built food huts: a hunter (wild game -> meat) / a forager (wild plants -> fruit) per level.
  HunterHut = 50,
  ForagerHut = 51,
  // World-gen wild forage the server tracks; each has a ripe and a picked (regrowing) state.
  // Bushes and mushrooms are walkable, fruit trees are solid like ordinary trees.
  BerryBush = 52,
  BerryBushPicked = 53,
  FruitTree = 54,
  FruitTreePicked = 55,
  MushroomPatch = 56,
  MushroomPatchPicked = 57,
  // Player-built: posts builders (one per level). Upgradeable in place to level 3.
  BuildersGuild = 58,
  // A building waiting for builders (server ConstructionSite record: target tile, progress). Solid.
  ConstructionSite = 59,
  // Player-built ground tiles: walkable, never solid, drawn as ground (autotiled from their road
  // neighbours on the client). Colonists and players move faster on them (server ROAD_SPEED_BONUS).
  Road = 60,
  CobbleRoad = 61,
  // Player-built, free-standing: shoots the nearest hostile mob in range on its own (no workers, no
  // population). Upgradeable in place to level 3. Separate from the Archery Range (ArcherPost).
  Tower = 62,
  // Player-built gate (Walls & gates, 2026-10-23). NOT in isSolidTile: its passability is server state
  // (snapshot `gates`): open for anyone, closed for mobs (the colony's own units open it by walking up).
  // Numbered apart from the run above so parallel tile additions don't collide.
  Gate = 70,
  // Cavalry & siege (2026-10-27): garrisons 1-3 cavalry (levels like the Archery Range) / produces one
  // battering ram or catapult at a time (building info panel), at most SIEGE_WORKSHOP_CAP alive.
  Stables = 71,
  SiegeWorkshop = 72,
  // Keep (2026-10-28): a separate per-settlement building (needs a Town Center at level 2); each of its
  // three levels (buildingLevels) adds +10 to that settlement's population cap.
  Keep = 73,
}

// ---- Walls & gates (2026-10-23) ----
// Gate lock chosen in the building info menu: "auto" opens for friendly units nearby, "open" / "closed"
// hold it (a locked-closed gate blocks the colony's own units too).
export type GateLock = "auto" | "open" | "closed";
// `gates` is flattened [tile index, GATE_FLAG_* bits] pairs, one per gate tile.
export const GATE_SNAPSHOT_STRIDE = 2;
export const GATE_FLAG_OPEN = 1;
export const GATE_FLAG_LOCK_OPEN = 2;
export const GATE_FLAG_LOCK_CLOSED = 4;
// Overrun: a hostile majority near the gate with no living tower in range; mobs pass as if it were open.
export const GATE_FLAG_OVERRUN = 8;

export function isRoadTile(tile: TileType): boolean {
  return tile === TileType.Road || tile === TileType.CobbleRoad;
}

// Ground biome per tile, a separate layer from TileType (sent once in `welcome`, never changes
// after world-gen).
export enum Biome {
  Plains = 0,
  Hills = 1,
  Swamp = 2,
}

export function isSolidTile(tile: TileType): boolean {
  return (
    tile === TileType.Wall ||
    tile === TileType.Tree ||
    tile === TileType.LumberjackPost ||
    tile === TileType.KnightPost ||
    tile === TileType.ArcherPost ||
    tile === TileType.IronOre ||
    tile === TileType.Rock ||
    tile === TileType.IronMinePost ||
    tile === TileType.RockMinePost ||
    tile === TileType.StoneWall ||
    tile === TileType.TownCenter ||
    tile === TileType.House ||
    tile === TileType.BigHouse ||
    tile === TileType.HouseLevel2 ||
    tile === TileType.BarnPost ||
    tile === TileType.CastleLevel2 ||
    tile === TileType.CastleLevel3 ||
    tile === TileType.ArcherTower ||
    tile === TileType.ChurchPost ||
    tile === TileType.Pasture ||
    tile === TileType.Orchard ||
    tile === TileType.WoolFarm ||
    tile === TileType.CottonFarm ||
    tile === TileType.TailorShop ||
    tile === TileType.Blacksmith ||
    tile === TileType.LuxuryWorkshop ||
    tile === TileType.Market ||
    tile === TileType.GoldShop ||
    tile === TileType.Brewery ||
    tile === TileType.Tavern ||
    tile === TileType.MilitiaPost ||
    tile === TileType.MilitiaCamp2 ||
    tile === TileType.MilitiaCamp3 ||
    tile === TileType.Water ||
    tile === TileType.RuinWall1 ||
    tile === TileType.RuinWall2 ||
    tile === TileType.RuinArch ||
    tile === TileType.RuinStatue ||
    tile === TileType.RuinRubble ||
    tile === TileType.PropCampfire ||
    tile === TileType.PropCart ||
    tile === TileType.PropBarrel ||
    tile === TileType.PropCrate ||
    tile === TileType.PropFence ||
    tile === TileType.AbbeyHall ||
    tile === TileType.PropCross ||
    tile === TileType.PropLanternPost ||
    tile === TileType.WardStone ||
    tile === TileType.HunterHut ||
    tile === TileType.ForagerHut ||
    tile === TileType.FruitTree ||
    tile === TileType.FruitTreePicked ||
    tile === TileType.BuildersGuild ||
    tile === TileType.ConstructionSite ||
    tile === TileType.Tower ||
    tile === TileType.Stables ||
    tile === TileType.SiegeWorkshop ||
    tile === TileType.Keep
  );
}

export type ColonistKind =
  | "lumberjack"
  | "farmer"
  | "knight"
  | "archer"
  | "ironMiner"
  | "rockMiner"
  | "bishop"
  | "farmhand"
  | "artisan"
  | "militia"
  | "spearman"
  | "pikeman"
  | "hunter"
  | "forager"
  | "builder"
  // Cavalry & siege (2026-10-27): Stables riders and Siege Workshop engines.
  | "cavalry"
  | "batteringRam"
  | "catapult"
  // Hero phase 3 (2026-10-28): a named, levelled hero recruited at a Keep (class in ColonistSnapshot.heroClass).
  | "hero";

// Hero phase 3: the three hero classes and the regiment role each fights in.
export type HeroClass = "champion" | "marksman" | "mage";
export const HERO_CLASSES: HeroClass[] = ["champion", "marksman", "mage"];
export const HERO_CLASS_ROLE: Record<HeroClass, CombatRole> = { champion: "shock", marksman: "ranged", mage: "caster" };
export const HERO_CLASS_LABEL: Record<HeroClass, string> = { champion: "Champion", marksman: "Marksman", mage: "Mage" };

// Combat stance for guard-tier units (knight/archer/militia line): how far they aggro, how far they
// chase from their rally point, and how tight a formation they hold. Every colonist carries one
// (default "normal"); it has no effect on bishops or civilians.
export type Stance = "defensive" | "normal" | "aggressive";

// Strategy mode phase 2 (additive): a player regiment, derived by the server every snapshot. Each
// commandable unit is in exactly one: a task force (assignTaskForce slot N, the manual merge / split),
// else a hero alone, else its settlement (Town Center) + class. Infantry = militia + spearmen + pikemen.
// Task-force regiments are "mixed" unless every member shares one class.
export type RegimentClass = "infantry" | "knights" | "archers" | "cavalry" | "clergy" | "rams" | "catapults" | "hero" | "mixed";
export interface ArmyRegimentSnapshot {
  // "tf<N>" (task force N), "h:<heroId>", or "a:<settlement x,y>:<class>".
  id: string;
  name: string;
  // Alive members (may be empty while the dead wait for the dawn respawn).
  unitIds: string[];
  cls: RegimentClass;
  // The members' most common role (none for clergy).
  role?: CombatRole;
  // Alive + queued respawns (auto / hero regiments) or the size it was assigned at (task forces).
  maxCount: number;
  // Sum hp / sum maxHp of the alive members (0 with none).
  hpFrac: number;
  // 1-based "Settlement N" of an auto regiment.
  settlement?: number;
  // Task force slot (1-9) of a manual regiment.
  taskForce?: number;
}

// Strategy mode phase 3 (additive): regiment orders. An order goes to a set of units (the selected
// regiments' members); the server keeps it as an order group (snapshot `orderGroups`) with a queue
// of up to ARMY_ORDER_QUEUE_MAX waypoints. Formations come from formation.ts (planOrderFormation).
// Phase 4 adds charge (shock / fast members run at a mob, cavalry cycle-charge), bombard (catapults shell
// the point x, y each reload) and attackHearth (the group attacks the camp hearth at tileX, tileY).
export type ArmyOrderKind = "move" | "attackMove" | "retreat" | "hold" | "follow" | "attack" | "charge" | "bombard" | "attackHearth";
export const ARMY_ORDER_QUEUE_MAX = 8;
export interface ArmyOrder {
  kind: ArmyOrderKind;
  // World px: the formation's front-centre (move / attackMove; retreat: optional, default the nearest
  // Town Center).
  x?: number;
  y?: number;
  // Radians, the direction the front faces; omitted = the direction of travel (the server fills it in
  // once the order starts).
  facing?: number;
  // Frontage of a line in tiles (a dragged line); omitted = a block (or the group's last width).
  width?: number;
  // follow: a colonist id or "p:<playerId>"; attack / charge: a mob id.
  targetId?: string;
  // attackHearth: the hearth's tile.
  tileX?: number;
  tileY?: number;
}
// Strategy mode phase 4 (additive): a regiment's formation shape (formation.ts planOrderFormation). line =
// the phase 3 layout (a block, or a line when a width is given); block = a square; wedge = a triangle
// pointing along the facing; loose = the line layout at LOOSE_SPACING_MULT spacing.
export type FormationShape = "line" | "block" | "wedge" | "loose";
export const FORMATION_SHAPES: FormationShape[] = ["line", "block", "wedge", "loose"];
export interface ArmyOrderGroupSnapshot {
  id: string;
  unitIds: string[];
  // The order being carried out (null = done, the units stand where it left them).
  order: ArmyOrder | null;
  queue: ArmyOrder[];
  // The group's last formation (radians / tiles), kept by a plain click-move.
  facing?: number;
  width?: number;
  // attackMove: halted and fighting.
  engaged?: boolean;
}

export interface ColonistSnapshot {
  id: string;
  kind: ColonistKind;
  x: number;
  y: number;
  state: string;
  hp: number;
  maxHp: number;
  postX: number;
  postY: number;
  stance: Stance;
  // True once a civilian has reached its night shelter (a house, or the Town Center) and should be drawn "inside".
  sheltered: boolean;
  // Armour & weapons: the tier (1-3) a knight / spearman / pikeman / cavalry spawned with; omitted = 0 (unequipped).
  armourTier?: number;
  weaponTier?: number;
  // Hero phase 3: heroes only (kind "hero"); the id is the hero's stable id.
  heroName?: string;
  heroClass?: HeroClass;
  heroLevel?: number;
  // Hero phase 4: a Summon spell's temporary skeleton militia (no population, despawns).
  summoned?: boolean;
  // Strategy mode phase 4 (regimentSettings; omitted = off / "line"): hold fire (ranged / catapults /
  // hero auto-spells only fire at a commanded target), skirmish (ranged back off from melee within
  // SKIRMISH_KITE_TILES), cycle charge (cavalry on a charge order withdraw and charge again), shape.
  holdFire?: boolean;
  skirmish?: boolean;
  cycleCharge?: boolean;
  shape?: FormationShape;
}

// Armour & weapons: the two equipment slots; the colony's stock counts each by tier 1..3.
export type EquipSlot = "armour" | "weapon";
export interface EquipmentStock {
  // Index 0 = tier 1, 1 = tier 2, 2 = tier 3.
  armour: number[];
  weapon: number[];
}

// ---- Hero phases 1-2: items, inventory, character sheet (ROADMAP "Hero phases 1-2", 2026-10-28) ----
// Per-player (later per-hero) gear. Plain tiered pieces (chest / weapon) are pulled from the colony's
// EquipmentStock; relics are unique named drops. Stats are additive percentages / flat HP.
export type GearSlot =
  | "head" | "chest" | "legs" | "weapon" | "offhand" | "trinket1" | "trinket2"
  | "spell1" | "spell2" | "spell3" | "spell4";
export const GEAR_SLOTS: GearSlot[] = [
  "head", "chest", "legs", "weapon", "offhand", "trinket1", "trinket2", "spell1", "spell2", "spell3", "spell4",
];
// What kind of socket an item fits (trinket -> trinket1/2, spell -> spell1-4).
// Hero phase 4: "tome" = a Spell Tome (pack only, never equipped; "Learn" consumes it, see useTome).
export type ItemSlotKind = "head" | "chest" | "legs" | "weapon" | "offhand" | "trinket" | "spell" | "tome";
export type ItemTier = 1 | 2 | 3 | "relic";
export interface ItemStats {
  damagePct?: number;
  // Negative = takes less damage.
  damageTakenPct?: number;
  maxHp?: number;
  moveSpeedPct?: number;
  attackSpeedPct?: number;
  spellPowerPct?: number;
}
export interface GearItem {
  // Unique per instance.
  id: string;
  slot: ItemSlotKind;
  name: string;
  tier: ItemTier;
  stats: ItemStats;
  // e.g. "sword" / "spear" / "bow" / "staff" / "helm" / "shield" (glyph on the placeholder icon).
  kind?: string;
  // Relic catalogue key (relics only).
  relicId?: string;
  // Optional sprite basename under /sprites/ (SPRITES.md #49 / #51); the client falls back to a placeholder.
  icon?: string;
  // Hero phase 4: Spell Tomes only - the spell it teaches.
  spellId?: SpellId;
}
export type Equipment = Record<GearSlot, GearItem | null>;
// Derived (server-computed) modifiers of the player's gear + level.
export interface HeroStats {
  maxHp: number;
  damageMult: number;
  damageTakenMult: number;
  moveSpeedMult: number;
  attackSpeedMult: number;
  spellPowerMult: number;
}
// Snapshot `profile`: sent only to its own player, and only when it changed (keep the last one).
export interface HeroProfileSnapshot {
  equipment: Equipment;
  inventory: GearItem[];
  inventoryCap: number;
  xp: number;
  level: number;
  // Total XP at which the current / next level starts (next = null at the max level).
  levelXp: number;
  nextLevelXp: number | null;
  stats: HeroStats;
  // Hero phase 4 (additive): learned spells, the 4 spell slots, auto-cast and cooldowns.
  spells?: SpellBookSnapshot;
}

// ---- Hero phase 4: spells (ROADMAP "Hero phase 4: spells", 2026-10-28) ----
// Cooldown-based, no mana. Numbers (damage / heal / shield) scale with the caster's spellPowerMult;
// percentages and durations do not. Range / radius in tiles, cooldown / duration in seconds.
export type SpellId = "fireBolt" | "thunder" | "frost" | "heal" | "ward" | "rallyBanner" | "summon" | "curse";
// enemy: click a monster; ally: click a friendly unit / player (none = yourself); ground: click a spot.
export type SpellTargeting = "enemy" | "ally" | "ground" | "self";
export interface SpellDef {
  id: SpellId;
  name: string;
  targeting: SpellTargeting;
  range: number;
  cooldown: number;
  // Main scaled amount: damage (fire bolt / thunder / frost), heal, shield absorb; 0 = none.
  power: number;
  radius?: number;
  // Status length in seconds (burn, slow, ward, rally, summon, curse).
  duration?: number;
  // Burn damage per second (scaled), slow / damage-taken / buff fractions (not scaled).
  burnPerSec?: number;
  slow?: number;
  damageTakenBonus?: number;
  buffDamage?: number;
  buffSpeed?: number;
  summonCount?: number;
  // Sprite basename under /sprites/ (SPRITES.md #57); the client draws a placeholder until it exists.
  icon: string;
  // Placeholder icon glyph and colour.
  glyph: string;
  color: string;
  text: string;
}
export const SPELLS: Record<SpellId, SpellDef> = {
  fireBolt: { id: "fireBolt", name: "Fire Bolt", targeting: "enemy", range: 8, cooldown: 4, power: 30, duration: 3, burnPerSec: 3, icon: "spell-fireBolt", glyph: "✹", color: "#b5461c", text: "A bolt of fire: {power} damage, then burns for {burn}/s over 3 s" },
  thunder: { id: "thunder", name: "Thunder", targeting: "ground", range: 7, cooldown: 12, power: 40, radius: 2, icon: "spell-thunder", glyph: "ϟ", color: "#5a6fb0", text: "Lightning strikes a spot: {power} damage to every enemy within 2 tiles" },
  frost: { id: "frost", name: "Frost", targeting: "ground", range: 7, cooldown: 14, power: 15, radius: 2.5, duration: 4, slow: 0.5, icon: "spell-frost", glyph: "✻", color: "#3f8fb5", text: "A burst of frost: {power} damage and 50% slow for 4 s to enemies within 2.5 tiles" },
  heal: { id: "heal", name: "Heal", targeting: "ally", range: 6, cooldown: 8, power: 45, icon: "spell-heal", glyph: "✚", color: "#3c8a3c", text: "Heals an ally (or yourself) for {power}" },
  ward: { id: "ward", name: "Ward", targeting: "ally", range: 6, cooldown: 18, power: 60, duration: 8, icon: "spell-ward", glyph: "◈", color: "#c9a227", text: "Shields an ally (or yourself): absorbs {power} damage for 8 s" },
  rallyBanner: { id: "rallyBanner", name: "Rally Banner", targeting: "ground", range: 5, cooldown: 30, power: 0, radius: 4, duration: 10, buffDamage: 0.25, buffSpeed: 0.15, icon: "spell-rally", glyph: "⚑", color: "#9a2f2f", text: "Plants a banner: friendly soldiers within 4 tiles deal +25% damage and move +15% faster for 10 s" },
  summon: { id: "summon", name: "Summon", targeting: "ground", range: 4, cooldown: 45, power: 0, duration: 40, summonCount: 2, icon: "spell-summon", glyph: "☠", color: "#5c5c6e", text: "Raises 2 skeleton militia for 40 s (no population)" },
  curse: { id: "curse", name: "Curse", targeting: "enemy", range: 8, cooldown: 16, power: 0, duration: 8, damageTakenBonus: 0.3, icon: "spell-curse", glyph: "☽", color: "#6b2f8a", text: "Curses an enemy: it takes +30% damage for 8 s" },
};
export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];
export const SPELL_SLOT_COUNT = 4;
// Snapshot form of a profile's spell book. cooldowns: ticks (TICK_RATE / s) left per spell at send time.
export interface SpellBookSnapshot {
  learned: SpellId[];
  slots: (SpellId | null)[];
  // Heroes only: auto-cast slotted spells (players never auto-cast).
  auto: boolean;
  cooldowns: Partial<Record<SpellId, number>>;
}
// Hero phase 3: snapshot `heroes`, one per hero of the colony (alive, waiting to respawn or still being
// recruited), sent per player only when the roster changed. `profile.inventory` is always empty: heroes
// equip from the player's shared pack (the player's own `profile`).
export interface HeroSheetSnapshot {
  id: string;
  name: string;
  heroClass: HeroClass;
  // "alive" | "recruiting" (arrives soon) | "fallen" (waits for a dawn / dusk window and its gold fee).
  status: "alive" | "recruiting" | "fallen";
  // Gold the next respawn costs (50 + 25 x level).
  respawnFee: number;
  profile: HeroProfileSnapshot;
}

export type MobKind =
  | "goblin"
  | "wolf"
  | "goblinCrossbow"
  | "orc"
  | "skeleton"
  | "armoredOrc"
  | "darkShaman"
  | "giantSpider"
  | "troll"
  | "ogre"
  | "banditClubman"
  | "banditArcher"
  | "banditElite"
  | "halfLatch"
  // Raid siege engines (orc / bandit factions, from day 10 / 14).
  | "batteringRam"
  | "catapult";

// Regiments & roles (ROADMAP "Regiments & roles"): every combat unit kind fights in a role.
//   frontline - the melee line: holds the front rank and engages what is in front of its slot.
//   shock     - heavy melee (troll / ogre / bandit elite): front rank, centre.
//   ranged    - bows / crossbows: a rear rank behind the line; never advances into melee, kites a step.
//   caster    - ranged spellcaster (dark shaman): as ranged.
//   fast      - flankers (wolf, giant spider; cavalry): the wings of the front rank.
//   siege     - battering ram (front / centre with the shock troops) and catapult (rear line, as ranged).
// Shared by server (formations, ranged discipline) and client (role rings, formation slots).
export type CombatRole = "frontline" | "shock" | "ranged" | "caster" | "fast" | "siege";
export const MOB_ROLE: Record<MobKind, CombatRole> = {
  goblin: "frontline",
  wolf: "fast",
  goblinCrossbow: "ranged",
  orc: "frontline",
  skeleton: "frontline",
  armoredOrc: "frontline",
  darkShaman: "caster",
  giantSpider: "fast",
  troll: "shock",
  ogre: "shock",
  banditClubman: "frontline",
  banditArcher: "ranged",
  banditElite: "shock",
  halfLatch: "frontline",
  batteringRam: "siege",
  catapult: "siege",
};
// Soldier kinds only (civilians and bishops have no combat role).
export const COLONIST_ROLE: Partial<Record<ColonistKind, CombatRole>> = {
  knight: "shock",
  cavalry: "fast",
  batteringRam: "siege",
  catapult: "siege",
  militia: "frontline",
  spearman: "frontline",
  pikeman: "frontline",
  archer: "ranged",
};
// A unit's role, heroes by their class (hero phase 3).
export function unitRole(kind: ColonistKind, heroClass?: HeroClass): CombatRole | undefined {
  if (kind === "hero") return heroClass ? HERO_CLASS_ROLE[heroClass] : "shock";
  return COLONIST_ROLE[kind];
}
// Ranged and caster units form the rear rank; of the siege engines only the catapult does (pass the
// unit's kind; without it a siege role counts as front rank, like the ram).
export function isRearRole(role: CombatRole | undefined, kind?: string): boolean {
  return role === "ranged" || role === "caster" || (role === "siege" && kind === "catapult");
}
// Siege Workshop production (shared so the client's panel and the server agree).
export type SiegeKind = "batteringRam" | "catapult";
export const SIEGE_KINDS: SiegeKind[] = ["batteringRam", "catapult"];

// Hunger-marked elites (ROADMAP Phase 6): a rare raid mob bearing one Hunger's mark. Index = the
// snapshot's `mark` value; HUNGER_MARK_NAMES[mark] names it (sigil-<name>.png / aura-<name>.png).
export enum HungerMark {
  None = 0,
  Gorrath = 1,
  Nemri = 2,
  Rux = 3,
  Morvain = 4,
  Gunne = 5,
  Vhorrun = 6,
}
export const HUNGER_MARK_NAMES = ["", "gorrath", "nemri", "rux", "morvain", "gunne", "vhorrun"];

export interface MobSnapshot {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  // Omitted for unmarked mobs (the common case) to keep snapshots small.
  mark?: HungerMark;
  // Phase 5 bosses only (omitted for every other mob): see BossTier.
  boss?: BossTier;
}

// Phase 5 bosses: "warlord" is the Castle Ruin's Ogre Warlord (one per world, never respawns);
// "elite" leads a mini-boss pack of its own kind. Both are drawn larger (BOSS_RENDER_SCALE) with a
// name label (bossTitle) and a bigger hp bar.
export type BossTier = "warlord" | "elite";
export const BOSS_RENDER_SCALE: Record<BossTier, number> = { warlord: 1.6, elite: 1.3 };
const ELITE_TITLES: Partial<Record<MobKind, string>> = {
  wolf: "Dire Wolf Alpha",
  orc: "Orc Chieftain",
  skeleton: "Skeleton Lord",
  giantSpider: "Spider Matriarch",
  armoredOrc: "Orc Warchief",
  troll: "Troll Elder",
};
export function bossTitle(kind: MobKind, tier: BossTier): string {
  if (tier === "warlord") return "Ogre Warlord";
  return ELITE_TITLES[kind] ?? "Elite";
}

// The shared goal track (ROADMAP Phase 5): the current goal and its progress. `index` counts from 0;
// index === total means every goal is done (title is then a closing line, progress === target).
export interface GoalSnapshot {
  index: number;
  total: number;
  title: string;
  progress: number;
  target: number;
}

export interface AttackEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  // Visual-only: melee hits flash at the target; ranged ones fly from attacker to target.
  melee?: boolean;
  // A catapult's boulder (arcing flight, impact puff at the target); omitted otherwise.
  boulder?: boolean;
  // Hero phase 4: a spell's cast (from caster to target / ground point); omitted otherwise.
  spell?: SpellId;
}

// A transient marker where a colonist died; the server drops every one at the next dawn.
export interface GravestoneSnapshot {
  x: number;
  y: number;
  variant: 0 | 1;
}

// Huntable wild game (server entities, unarmed and non-hostile; a hunted boar may charge its hunter).
export type WildlifeKind = "deer" | "rabbit" | "boar" | "pheasant";
// Index = the kind code in the snapshot's flattened `wildlife` list.
export const WILDLIFE_KINDS: WildlifeKind[] = ["deer", "rabbit", "boar", "pheasant"];
// `wildlife` is flattened, WILDLIFE_SNAPSHOT_STRIDE numbers per animal:
// [id, kind code, x (px, rounded), y (px, rounded), state code (WildlifeState below)].
export const WILDLIFE_SNAPSHOT_STRIDE = 5;
export enum WildlifeState {
  Idle = 0,
  Walk = 1,
  Flee = 2,
  Charge = 3,
}

// Night-mob tuning chosen on the main menu (server applies the multipliers; see DIFFICULTY_* there).
export type Difficulty = "easy" | "normal" | "hard";

export type GameEventCategory =
  | "night" | "dawn" | "upgrade" | "death" | "ward" | "deserter" | "raid" | "build"
  // Phase 5: a goal completed / a boss or mini-boss sighted or slain.
  | "milestone" | "boss";

// Per-tile art stage of a farm-type building (snapshot `farmStages`). Grain plots: Sown -> Sprouting ->
// Growing -> Ripe (being cut) -> Harvested (briefly) / Fallow. Hemp: Sown/Growing/Ripe. Pasture:
// Growing/Fat. Sheep Pasture: Sheared/Woolly/Ripe (ready to shear). Orchard: Blossoming/Growing/Fruiting.
export enum FarmStage {
  Sown = 0,
  Sprouting = 1,
  Growing = 2,
  Ripe = 3,
  Harvested = 4,
  Fallow = 5,
  Fat = 6,
  Sheared = 7,
  Woolly = 8,
  Blossoming = 9,
  Fruiting = 10,
}
// `farmStages` is flattened [tile index, FarmStage] pairs; `buildingLevels` is [tile index, level] pairs
// (only buildings above level 1, Town Centers included).
export const FARM_STAGE_SNAPSHOT_STRIDE = 2;
export const BUILDING_LEVEL_SNAPSHOT_STRIDE = 2;
// `constructionSites` is flattened, CONSTRUCTION_SNAPSHOT_STRIDE numbers per site: [tile index, target
// TileType (what will be built / upgraded), progress 0-1000, 1 if an in-place upgrade else 0, builders working].
export const CONSTRUCTION_SNAPSHOT_STRIDE = 5;
// `damagedBuildings` is flattened [tile index, hp permille 0-999] pairs: every building (Town Centers
// included) below full HP. A building missing from it is at full HP.
export const DAMAGED_BUILDING_SNAPSHOT_STRIDE = 2;
// `hearths` is flattened [tile index, hp permille 0-1000] pairs, one per standing camp hearth (damaged
// ones are also in `damagedBuildings`, which draws their HP bar).
export const HEARTH_SNAPSHOT_STRIDE = 2;

export interface TownCenterSnapshot {
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
  // Settlement population (units counting toward this Town Center), its effective cap (min of housing
  // and tier ceiling) and the tier ceiling alone. Omitted by older servers.
  population?: number;
  populationCap?: number;
  populationTierCap?: number;
  // Population added to that cap by the settlement's Keep (10 per Keep level; 0 or omitted: no Keep).
  populationKeepBonus?: number;
}

// Reply to a `buildingInfo` request; every number is computed by the server's own formulas.
export interface BuildingInfo {
  name: string;
  tile: TileType;
  level: number;
  maxLevel: number;
  // Hit points of any building mobs can damage (null for the rest, e.g. construction sites, farm plots).
  hp: number | null;
  maxHp: number | null;
  // e.g. "Workers 2", "Beds 3/5", "Population base 10".
  staffing: string;
  bonuses: string[];
  // In-place upgrade (or null when the building can't be upgraded at all).
  upgrade: { cost: string; enabled: boolean; reason: string } | null;
  // 0-1 when a construction / upgrade is queued here, else null.
  construction: number | null;
  // Manual repair (null while the building is at full HP): the materials it costs now ("Free" when
  // already paid) and why it can't be ordered, if so.
  repair: { cost: string; enabled: boolean; reason: string } | null;
  // Gates only: the current state and lock (see setGateLock).
  gate?: { open: boolean; lock: GateLock; overrun: boolean };
  // Siege Workshops only: what is being built (null: idle), its progress 0-1, engines alive / cap, and a
  // build button per engine (see queueSiege).
  siege?: {
    building: SiegeKind | null;
    progress: number | null;
    units: number;
    cap: number;
    options: { kind: SiegeKind; label: string; cost: string; enabled: boolean; reason: string }[];
  };
  // Blacksmiths only (Armour & weapons): the tier it forges (= its level), its queue (first = in progress,
  // progress 0-1), the queue cap, and a button per slot (see queueForge).
  forge?: {
    tier: number;
    queue: { slot: EquipSlot; tier: number }[];
    progress: number | null;
    cap: number;
    options: { slot: EquipSlot; label: string; cost: string; enabled: boolean; reason: string }[];
  };
  // Keeps only (hero phase 3): heroes posted here / cap (= Keep level), one recruit button per class
  // (see recruitHero), and the roster of this Keep's heroes.
  heroes?: {
    count: number;
    cap: number;
    options: { heroClass: HeroClass; label: string; cost: string; enabled: boolean; reason: string }[];
    roster: { name: string; heroClass: HeroClass; level: number; status: string }[];
  };
  // Churches only (hero phase 4): basic spells the requesting player can buy (see learnSpell).
  spellShop?: { spellId: SpellId; label: string; gold: number; enabled: boolean; reason: string }[];
}

export type ClientMessage =
  | { type: "join"; name?: string }
  | { type: "input"; dx: number; dy: number }
  | { type: "setTile"; tileX: number; tileY: number; tile: TileType }
  | { type: "attack" }
  | { type: "pause" }
  // Optional difficulty: the restarting client's choice becomes the new world's difficulty.
  | { type: "restart"; difficulty?: Difficulty; worldSize?: number }
  // Sent after every welcome; only takes effect while the world's difficulty is still unclaimed
  // (see the server's handleSetDifficulty for the race rules).
  | { type: "setDifficulty"; difficulty: Difficulty; worldSize?: number }
  // squad: optional, shared by every unit of one formation order (the client sends the order number), so the
  // server marches them together (see updateSquadMarch). Old clients omit it.
  | { type: "commandMove"; unitIds: string[]; x: number; y: number; squad?: string }
  | { type: "commandAttack"; unitIds: string[]; mobId: string }
  // Camp hearths: send the units against the standing hearth on that tile (additive, 2026-10-28).
  | { type: "commandAttackHearth"; unitIds: string[]; tileX: number; tileY: number }
  | { type: "commandStance"; unitIds: string[]; stance: Stance }
  // Task force N is also a manual regiment (strategy mode phase 2): its units leave their auto regiment and
  // any other task force; an empty unitIds disbands it (the units return to their auto regiments).
  | { type: "assignTaskForce"; slot: number; unitIds: string[] }
  // Strategy mode phase 3: an order for the members of the regiments and / or the units; queue = append
  // to their order group's queue (Shift). A per-unit commandMove / commandAttack takes a unit out of it.
  | { type: "regimentOrder"; regimentIds?: string[]; unitIds?: string[]; order: ArmyOrder; queue?: boolean }
  // Strategy mode phase 4: per-unit settings for the members of the regiments and / or the units (each
  // field omitted = unchanged). A shape change re-forms their order groups in place.
  | { type: "regimentSettings"; regimentIds?: string[]; unitIds?: string[]; stance?: Stance; holdFire?: boolean; skirmish?: boolean; cycleCharge?: boolean; shape?: FormationShape }
  | { type: "exchangeResource"; from: "wood" | "iron" | "rock"; to: "wood" | "iron" | "rock" }
  | { type: "buyWithGold"; item: "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock" }
  | { type: "buildingInfo"; tileX: number; tileY: number }
  // Queues the in-place upgrade of the building at the tile (same rules as placing it on itself, no reach limit).
  | { type: "upgradeBuilding"; tileX: number; tileY: number }
  // Pays for the building's missing HP now and makes it the builders' first repair job.
  | { type: "repairBuilding"; tileX: number; tileY: number }
  // Sets the lock of the gate at the tile (no reach limit, like the other building info buttons).
  | { type: "setGateLock"; tileX: number; tileY: number; lock: GateLock }
  // Starts building one siege engine at the Siege Workshop at the tile (building info panel button).
  | { type: "queueSiege"; tileX: number; tileY: number; kind: SiegeKind }
  // Queues one armour / weapon at the Blacksmith at the tile (tier = its level; building info panel button).
  | { type: "queueForge"; tileX: number; tileY: number; slot: EquipSlot }
  // Hero phases 1-2 (additive): equip an inventory item into a slot (swaps any occupant back), unequip a
  // slot, or pull one plain tiered piece (armour -> chest item, weapon -> weapon item) out of the colony stock.
  // Hero phase 3: heroId (optional, default = the player) targets that hero's equipment; items still come
  // from / return to the player's pack.
  | { type: "equipItem"; itemId: string; slot: GearSlot; heroId?: string }
  | { type: "unequipItem"; slot: GearSlot; heroId?: string }
  | { type: "takeFromArmoury"; slot: EquipSlot; tier: number; heroId?: string }
  // Hero phase 3: recruit a hero of `class` at the Keep at (tx, ty) (Keep panel buttons).
  | { type: "recruitHero"; tx: number; ty: number; class: HeroClass }
  // Hero phase 4: spells. slot 0-3; heroId (optional) = that hero's book instead of the player's.
  | { type: "setSpellSlot"; slot: number; spellId: SpellId | null; heroId?: string }
  // Reads a Spell Tome from the player's pack (taught to the player, or to heroId) and consumes it.
  | { type: "useTome"; itemId: string; heroId?: string }
  // Buys a basic spell at the Church at (tileX, tileY) for the player (gold from the colony stock).
  | { type: "learnSpell"; spellId: SpellId; tileX: number; tileY: number }
  // Casts the spell in a slot: targetId (a mob, colonist or player id) for enemy / ally spells, x / y (px)
  // for ground spells. heroId: the hero casts it.
  | { type: "castSpell"; slot: number; targetId?: string; x?: number; y?: number; heroId?: string }
  | { type: "setSpellAuto"; heroId: string; auto: boolean }
  // Strategy mode phase 1 (additive): the free camera's view in tiles (x / y = centre, halfW / halfH = half
  // extents; the server clamps them). While strategy is true, big-world snapshots also carry the mobs and
  // wildlife inside that view, not only those near the rider. strategy: false drops it.
  | { type: "setView"; x: number; y: number; halfW: number; halfH: number; strategy: boolean }
  // Save files (server/saves/<slot>.json). saveGame takes slot1-3 (the autosave is the server's own);
  // loadGame replaces the shared world for everyone connected.
  | { type: "saveGame"; slot: SaveSlot }
  | { type: "loadGame"; slot: SaveSlot }
  | { type: "listSaves" };

export type ServerMessage =
  | {
      type: "welcome";
      id: string;
      tileSize: number;
      worldTilesX: number;
      worldTilesY: number;
      tiles: number[];
      biomes: number[];
      // Explored-tile bitset, base64: bit (i & 7) of byte (i >> 3) is tile index i (y * worldTilesX + x).
      explored: string;
      difficulty: Difficulty;
      // Centre tile of this world's Castle Ruin (null if world-gen couldn't fit one, or an old save).
      // The minimap marks it once that tile is explored.
      castleRuin?: { x: number; y: number } | null;
    }
  | {
      type: "snapshot";
      players: PlayerSnapshot[];
      colonists: ColonistSnapshot[];
      mobs: MobSnapshot[];
      wood: number;
      iron: number;
      rock: number;
      grain: number;
      meat: number;
      fruit: number;
      wool: number;
      cotton: number;
      clothes: number;
      tools: number;
      luxuryItems: number;
      gold: number;
      alcohol: number;
      happiness: number;
      marketBuilt: boolean;
      goldShopBuilt: boolean;
      isNight: boolean;
      // 0-1 through the full day+night cycle; 0 = dawn, night starts at dayFraction.
      cycleProgress: number;
      dayFraction: number;
      isPaused: boolean;
      effects: AttackEffect[];
      townCenterHp: number;
      townCenterMaxHp: number;
      population: number;
      populationCap: number;
      taskForces: Record<string, string[]>;
      // Strategy mode phase 2: every player regiment; sent when membership / names change and every 10th
      // tick otherwise (omitted in between and by older servers: keep the last one).
      armyRegiments?: ArmyRegimentSnapshot[];
      // Strategy mode phase 3: every order group; sent when one changes and every 10th tick otherwise
      // (omitted in between: keep the last one).
      orderGroups?: ArmyOrderGroupSnapshot[];
      // Tile indices (y * worldTilesX + x) of Farm Plots whose crop is mature and being harvested.
      readyFarmPlots: number[];
      // Farm Plots freshly sown (bare soil) and resting fallow; any other plot is growing.
      sownFarmPlots: number[];
      fallowFarmPlots: number[];
      wildlife: number[];
      gravestones: GravestoneSnapshot[];
      difficulty: Difficulty;
      buildingLevels: number[];
      farmStages: number[];
      constructionSites: number[];
      townCenters: TownCenterSnapshot[];
      // See DAMAGED_BUILDING_SNAPSHOT_STRIDE.
      damagedBuildings: number[];
      // The shared goal track's current goal (Phase 5).
      goal?: GoalSnapshot;
      // See GATE_SNAPSHOT_STRIDE (omitted by older servers).
      gates?: number[];
      // Dawn/dusk respawn windows (long days): see RespawnWindowSnapshot.
      respawn?: RespawnWindowSnapshot;
      // Off-screen fight notifiers: active fights relevant to THIS player (per-player field, omitted
      // when there are none). See FightSnapshot.
      fights?: FightSnapshot[];
      // Camp hearths: standing (not destroyed) hearths, see HEARTH_SNAPSHOT_STRIDE (omitted by older servers).
      hearths?: number[];
      // Armour & weapons: the colony's equipment stock by tier (omitted by older servers).
      equipment?: EquipmentStock;
      // Hero phases 1-2: this player's gear / inventory / XP (per-player field, only when it changed).
      profile?: HeroProfileSnapshot;
      // Hero phase 3: the colony's heroes (sheet tabs); appended per player only when it changed.
      heroes?: HeroSheetSnapshot[];
    }
  | { type: "tileUpdate"; tileX: number; tileY: number; tile: TileType }
  // One-off notification for the event feed (not continuous state).
  | { type: "event"; category: GameEventCategory; text: string }
  // Tile indices newly explored since the last one (batched a few times a second, never empty).
  | { type: "explored"; tiles: number[] }
  | { type: "buildingInfo"; tileX: number; tileY: number; info: BuildingInfo | null }
  // Reply to listSaves (also served as JSON by GET /saves on the same port, for the main menu).
  | { type: "saveList"; saves: SaveInfo[] }
  // Reply to saveGame / loadGame, to the requesting client only (`action` says which).
  | { type: "saveResult"; ok: boolean; error?: string; slot: SaveSlot; action: "save" | "load" };

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  color: number;
  hp: number;
  maxHp: number;
  // Killed with no Town Center standing to respawn at (game over unless one is rebuilt).
  dead: boolean;
}

export type SaveSlot = "autosave" | "slot1" | "slot2" | "slot3";
export const SAVE_SLOTS: SaveSlot[] = ["autosave", "slot1", "slot2", "slot3"];

// One existing save file's metadata. dayIndex is 0-based (day 1 = 0).
export interface SaveInfo {
  slot: SaveSlot;
  label: string;
  savedAt: string;
  dayIndex: number;
  population: number;
  difficulty: Difficulty;
}

// ---- Long days & dawn/dusk respawns (2026-10-23) ----
// Snapshot `respawn`: dead units (respawnQueue + a fallen Ward Priest) come back together only at the
// two respawn windows, dawn (cycle tick 0) and dusk (the last daylight tick). `ticksToWindow` counts
// to `nextWindow` (TICK_RATE ticks a second); dayTicks / nightTicks are the server's cycle lengths.
export interface RespawnWindowSnapshot {
  waiting: number;
  nextWindow: "dawn" | "dusk";
  ticksToWindow: number;
  dayTicks: number;
  nightTicks: number;
}

// ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
// The server clusters recent blows (mob vs soldier / colonist / player / building) into fights; each
// snapshot lists, per player, the ones involving the colony or that player, or within
// FIGHT_RELEVANCE_TILES of them (at most FIGHT_MAX_PER_PLAYER, most urgent first). A fight drops out
// FIGHT_WINDOW_SECONDS after its last blow. The client draws an edge-of-screen arrow per off-screen fight.
export const FIGHT_WINDOW_SECONDS = 3;
export const FIGHT_CLUSTER_TILES = 8;
export const FIGHT_RELEVANCE_TILES = 48;
export const FIGHT_MAX_PER_PLAYER = 8;
// "raid": night-wave raiders; "guardians": ruin / encampment guardians; "boss": the Castle Ruin, its
// Warlord, a mini-boss pack; "deserters": turned deserters; "monsters": anything else (Half-Latch).
export type FightKind = "raid" | "guardians" | "boss" | "deserters" | "monsters";
export interface FightSnapshot {
  // Stable while the fight lasts (a cluster that drifts keeps its id).
  id: number;
  // Centre tile of the fight.
  x: number;
  y: number;
  // Distinct mobs and defenders seen trading blows in the window.
  combatants: number;
  // Damage dealt per second (both sides) over the window.
  dps: number;
  // 1 skirmish, 2 battle, 3 major battle.
  intensity: 1 | 2 | 3;
  kind: FightKind;
  // Who the attackers are, e.g. "Bandit raid", "Ruin guardians", "Castle Ruin", "Ogre Warlord".
  label: string;
  // The colony's units / buildings (Town Centers included) are in it; `you`: this player is.
  units: boolean;
  buildings: boolean;
  you: boolean;
  // Seconds since the last blow (0 .. FIGHT_WINDOW_SECONDS).
  quiet: number;
}
