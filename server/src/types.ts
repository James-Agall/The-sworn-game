// types.ts: Shared interfaces and type aliases for the server simulation.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import type { WebSocket } from "ws";
import type {
  ColonistKind, Stance, FormationShape, HeroClass, MobKind, BossTier, HungerMark, GateLock, WildlifeKind, ArmyOrder,
  Difficulty, TileType, SiegeKind, Equipment, GearItem, HeroStats, SpellId, EquipSlot, FightKind, FightSnapshot,
  SiteFaction,
} from "@colony/shared/protocol";
import type { snapshotWorld } from "./saves.js";

export interface Player {
  // Clans: the clan this session plays for (state.ts `clans`; 0 = the default shared colony).
  clan: number;
  // Forts phase A: the ownerVersion of the last `siteTiles` this player was sent.
  siteTilesVersion?: number;
  // Clans: the clanTilesVersion of the last `clanTiles` this player was sent.
  clanTilesVersion?: number;
  // Forts phase D: the relationsVersion of the last `relations` this player was sent.
  relationsVersion?: number;
  // Forts phase D2: the quests version / tick of the last `quests` this player was sent.
  questsVersion?: number;
  questsSentTick?: number;
  id: string;
  x: number;
  y: number;
  color: number;
  hp: number;
  input: { dx: number; dy: number };
  socket: WebSocket;
  attackCooldownTicks: number;
  poisonTicksRemaining: number;
  poisonDamagePerTick: number;
  // Killed while no Town Center stood: no respawn until one is (re)built (see respawnDeadPlayers).
  dead: boolean;
  // Hero phases 1-2: the persistent profile (gear, inventory, XP) this session plays as: the ws URL's
  // `?profile=` (the client's stored id), else "default". Several sessions with one key share it.
  profileKey: string;
  // heroProfile.version last sent in this player's snapshot (-1 = send it on the next one).
  profileSentVersion: number;
  // Hero phase 3: heroRosterVersion last sent as snapshot `heroes` (-1 = send it on the next one).
  heroesSentVersion: number;
  // Strategy mode phase 1: the free camera's view rect (px, centre + half extents) while the player is in
  // strategy mode, else null (see handleSetView); big-world snapshot culling also keeps what is inside it.
  view: { x: number; y: number; halfW: number; halfH: number } | null;
  viewSetAt: number;
  // Strategy mode phase 3: regimentOrder rate limit (REGIMENT_ORDER_MAX_PER_S per one-second window).
  orderWindowAt: number;
  orderWindowCount: number;
}
export interface TileCoord {
  x: number;
  y: number;
}
export interface Colonist {
  id: string;
  kind: ColonistKind;
  postX: number;
  postY: number;
  x: number;
  y: number;
  state: string;
  path: TileCoord[];

  targetResourceX: number;
  targetResourceY: number;
  chopTicksRemaining: number;
  idleCooldown: number;

  growTicksRemaining: number;
  harvestTicksRemaining: number;

  hp: number;
  maxHp: number;
  attackCooldownTicks: number;
  targetMobId: string | null;
  repathCooldown: number;

  sheltering: boolean;
  // Night shelter: a house tile, or the Town Center when homeTileX < 0. Reset each dawn.
  shelterAssigned: boolean;
  homeTileX: number;
  homeTileY: number;

  castleLevel: number;
  // The settlement (Town Center, "x,y" resourceKey) this unit counts toward. Set at spawn to the Town
  // Center nearest its post; old saves get it on load; settlementOf re-homes it if that Town Center fell.
  settlementId: string;
  // Clans: owning clan (missing = 0). Set at spawn from the post tile's clan (clanIdAt).
  clan?: number;

  healTargetType: "player" | "colonist" | null;
  healTargetId: string | null;

  rallyTileX: number;
  rallyTileY: number;
  // Exact pixel point inside the rally tile (a formation slot isn't a tile center, and two slots of
  // a diagonal formation can share one tile). See returnToRally.
  rallyX: number;
  rallyY: number;

  // Only read by updateGuardColonist (see STANCE_ALERT_RANGE_TILES / LINE_LEASH_TILES).
  stance: Stance;
  // Regiments: the formation order (commandMove.squad) this unit last marched under; its squadmates
  // march at one pace (updateSquadMarch). Missing / null: no squad (old saves, single-unit moves).
  squadId?: string | null;
  // Camp hearths: the siteId of the hearth this soldier is attacking (commanded or aggressive pick).
  targetHearthId?: string | null;
  // Strategy mode phase 4 (regimentSettings): hold fire, skirmish, cycle charge, formation shape.
  holdFire?: boolean;
  skirmish?: boolean;
  cycleCharge?: boolean;
  shape?: FormationShape;
  // Armour & weapons: the tier (0-3) taken from the stock when this unit spawned (EQUIPPED_KINDS only).
  // Missing in old saves = 0 (unequipped, today's stats).
  armourTier?: number;
  weaponTier?: number;
  // Hero phase 3: heroes only (kind "hero"). The colonist id is the hero's stable id (profile "hero:<id>",
  // which holds its XP / level / equipment). Missing on every other unit and in old saves.
  heroClass?: HeroClass;
  heroName?: string;

  poisonTicksRemaining: number;
  poisonDamagePerTick: number;

  // Hunter: the animal it is stalking/shooting (reserved via Wildlife.reservedBy). Hunter/forager:
  // the meat/fruit carried back to the hut, deposited on arrival.
  targetWildlifeId: number | null;
  carryAmount: number;

  // Builder: resourceKey of the construction site it is assigned to (see updateBuilder).
  buildSiteKey: string | null;
  // Builder: resourceKey of the damaged building it is repairing (see planRepair). Missing in old saves.
  repairKey?: string | null;
  // Farmer touring its Barn's plots (movement only): current plot key, ticks left working there, next plot index.
  farmPlotKey?: string | null;
  farmTouring?: boolean;
  farmDwellTicks?: number;
  farmNextIdx?: number;
  // Farmhand: length of the current produce cycle (chopTicksRemaining counts it down), for the art stage.
  cycleTicksTotal: number;
  // Forts phase E: trader wagons only (kind "wagon"; postX / postY = its Trading Post). Saved with the colonist.
  wagon?: WagonState;
  // Forts phase F: a vassal's levy (vassals.ts): the settlement it came from, the garrison mob kind it turns
  // back into at home, and true once it marches home (no orders then). Saved with the colonist.
  levyOf?: string;
  levyKind?: MobKind;
  levyHome?: boolean;
}
// Forts phase E (wagons.ts). dest = "s:<siteId>" (settlement) or "t:<x>,<y>" (own Town Center); route = the
// outbound path from the post (the way home walks it backwards); cargo = goods loaded, value = their base
// gold value; proceeds = gold / goods bought, carried home; waitUntil = end of unloading.
export interface WagonState {
  level: number;
  leg: "home" | "out" | "unload" | "back" | "camp";
  dest: string;
  destName: string;
  route: TileCoord[];
  danger: number;
  cargo: Partial<Record<ResourceKey, number>>;
  value: number;
  proceeds: Partial<Record<ResourceKey, number>>;
  waitUntil: number;
  // The leg to resume after a night camp.
  resume?: "out" | "back";
  alertTick?: number;
  // Fled home (escort wiped): full speed.
  fleeing?: boolean;
}
// One Trading Post (key "x,y"): auto-send, the wagon's id, when a lost wagon may be replaced, the last game day
// a trip left, and the level its roster was last set up for.
export interface TradingPostState {
  auto: boolean;
  wagonId: string | null;
  rebuildAtTick: number;
  lastTripDay: number;
  tripsToday: number;
  level: number;
  clan: number;
  // The last finished trade (panel status, tests): destination, gold earned, goods bought, relation gained.
  lastTrip?: { dest: string; sold: Partial<Record<ResourceKey, number>>; gold: number; bought: Partial<Record<ResourceKey, number>>; relation: number };
}
// "building": any damageable non-Town-Center building, keyed by its tile ("x,y"), walls included
// (a wall is only targeted to breach it; see pickBuildingTarget).
export type MobTargetType = "colonist" | "player" | "townCenter" | "building";
export interface Mob {
  id: string;
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  path: TileCoord[];
  repathCooldown: number;
  targetType: MobTargetType | null;
  targetId: string | null;
  attackCooldownTicks: number;
  damage: number;
  speed: number;
  range: number;
  melee: boolean;
  lastDamagedTick: number;
  healCooldownTicks: number;
  isDeserter: boolean;
  deserterActive: boolean;
  deserterSinceTick: number;
  // World-gen POI guardians (ruins + encampments share one mechanic). siteId links every
  // guardian at the same site; null for night-wave mobs and deserters. Dormant (guardianActive
  // false) guardians do nothing in updateMob until any one of their site is damaged.
  siteId: string | null;
  siteKind: PoiSiteKind | null;
  guardianActive: boolean;
  // Phase 5 bosses (the Castle Ruin's Ogre Warlord, mini-boss pack leaders); missing on every other
  // mob and in old saves. bossSighted: the one-off "sighted" toast has fired for it.
  boss?: BossTier;
  bossSighted?: boolean;
  // Raid-wave group (see raidGroups). While groupId is set the mob is driven by updateRaidGroups,
  // not by updateMob's per-mob targeting; passive is true until its group turns aggressive.
  groupId: string | null;
  passive: boolean;
  // Regiments: the raid group this mob marched in, kept after its group breaks up so its ranged /
  // casters still know their front rank (see regimentFrontDistance). Missing for non-raid mobs.
  regimentId?: string | null;
  // Monster tactics (see the "Monster tactics" block); missing on most mobs and in old saves.
  //   flank - walking a flanking arc (flankWaypoints) round the enemy line to flankTargetId (a soldier)
  //   rout  - fleeing toward its regiment's home;  leave - a routed raider walking off the map (fleeX/Y)
  tactic?: "flank" | "rout" | "leave" | null;
  flankWaypoints?: { x: number; y: number }[];
  flankTargetId?: string | null;
  flankUntilTick?: number;
  // Set once a flank delivered it to its target (never sent round again; the "flankStrike" event).
  flanker?: boolean;
  fleeX?: number;
  fleeY?: number;
  leaveUntilTick?: number;
  // Hunger mark (HungerMark.None for ordinary mobs); see the HUNGER_* constants and markedMob* helpers.
  mark: HungerMark;
  // Gorrath: tick its one-off wounded fury ends (0 = never triggered; it triggers once per mob).
  furyUntilTick: number;
  // Rux: the target it has already feinted at, and the tick its current feint ends.
  feintTargetId: string | null;
  feintUntilTick: number;
  // Vhorrun: tick its withdrawal ends, and the point it backs away from meanwhile.
  withdrawUntilTick: number;
  withdrawFromX: number;
  withdrawFromY: number;
  // Building / Town Center targets: the tile to attack from, chosen by pickBuildingTarget (the route
  // there is known to be walkable). Only used while approachFor equals targetId; missing in old saves.
  approachFor?: string | null;
  approachX?: number;
  approachY?: number;
  // Scale pass: the mob's rolled size (MOB_SIZE_RANGE, see applyMobSize); missing = 1 (old saves too).
  scale?: number;
  // Forts phase B stage 2, site-guardian leash: its post (spawn point; leash home for non-fort sites), the
  // tick its walk home stops ignoring targets (set = walking home), and the last tick a hostile was near.
  postX?: number;
  postY?: number;
  leashReturnUntilTick?: number;
  leashCalmSinceTick?: number;
  // Forts phase C: a human settlement's cosmetic worker (never a guardian: stays dormant, never fights),
  // walking between work tile A and shelter tile B (tile indices); leg 0 = to A.
  siteWorker?: SiteWorkerRole;
  workA?: number;
  workB?: number;
  workLeg?: number;
  workWaitUntilTick?: number;
}
// Ruins and encampments are the small scattered sites; "castleRuin" is the one Castle Ruin and
// "miniBoss" a mini-boss pack (ROADMAP Phase 5). All share the dormant-until-provoked wake mechanic.
// Forts phase B: "fort" = a stamped NPC fort (a SiteState in `sites`, keyed by the mobs' siteId).
export type PoiSiteKind = "ruin" | "encampment" | "castleRuin" | "miniBoss" | "fort";
// ---- Forts phase B (PLAN-forts-diplomacy-moats.md §2, §8): stamped NPC fort sites ----
export type SiteTemplateId = "thornwick" | "grakkar" | "hearthmoor" | "ironhold" | "riverwatch";
export interface SiteTemplate {
  id: SiteTemplateId;
  faction: SiteFaction;
  // "Palisade" / "Stockade": the site name is "<picked name> <label>".
  label: string;
  names: string[];
  // ASCII grid (legend SITE_TEMPLATE_TILES) at the MAX tier; `tiers` is a same-size grid giving, per
  // non-"." cell, the tier (digit 1-4) that adds it. Rows must all have the same length.
  rows: string[];
  tiers: string[];
  maxTier: number;
  startTier: number;
  // Garrison at the start tier (kind -> count).
  garrison: Partial<Record<MobKind, number>>;
  // Starting stockpile (looted in part on clearing, stage 2).
  stock: Partial<Record<ResourceKey, number>>;
  // Rebuild-the-keep cost (capture, stage 3).
  rebuildCost: Partial<Record<ResourceKey, number>>;
  // Forts phase C: per-template symbol overrides on top of SITE_TEMPLATE_TILES (stone walls, houses, ...),
  // the cosmetic workers (spawned while awake) and the noun of the sighting toast ("village").
  symbols?: Record<string, TileType>;
  workers?: Partial<Record<SiteWorkerRole, number>>;
  noun?: string;
}
// Forts phase C: a human settlement worker's walk loop (farm plots / ore / church and back).
export type SiteWorkerRole = "farm" | "mine" | "priest";
export interface SiteState {
  // = the mobs' siteId (and the hearth's); num = its owner-map site number (ownerSiteIds index + 1).
  id: string;
  num: number;
  // Human settlements (phase C) are kind "fort" too (same stamper / hearth / leash / capture code),
  // told apart by faction "human".
  kind: "fort";
  faction: SiteFaction;
  template: SiteTemplateId;
  name: string;
  // Template rectangle (tiles, inclusive); the reserved grounds add `apron` tiles around it.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  apron: number;
  keepX: number;
  keepY: number;
  // Leash centre / muster point: a yard tile next to the keep.
  homeX: number;
  homeY: number;
  // Growth stage (phase G grows it; the stamper lays the template's cells up to this tier).
  tier: number;
  growthTick: number;
  // Dormancy (stage 2): simulated while a colony unit is within SITE_AWAKE_RADIUS_TILES.
  awake: boolean;
  lastSimTick: number;
  provoked: boolean;
  stock: Partial<Record<ResourceKey, number>>;
  // Garrison: kind -> count it is stamped / refilled with, its max, and the living members' mob ids.
  garrisonRoster: Partial<Record<MobKind, number>>;
  garrisonMax: number;
  garrison: string[];
  // Mob ids doing the cosmetic yard walks while awake (stage 2); spawn tiles of the garrison.
  workers: string[];
  posts: number[];
  // "Fort sighted" toast sent (stage 3).
  sighted: boolean;
  // Keep razed (site broken); captured = its keep was rebuilt into a clan's outpost (stage 3).
  cleared: boolean;
  captured: boolean;
  capturedBy?: number;
  // Stage 2 anti-kite: hits from beyond the leash ring (decaying), the surge window and its cooldown.
  kiteHits?: number;
  surgeUntilTick?: number;
  surgeCooldownUntilTick?: number;
  // Forts phase C (human settlements): attacked -> `provoked` until hostileUntilTick; the clans already
  // charged the relation penalty for this hostile spell.
  hostileUntilTick?: number;
  hostileClans?: number[];
  // Forts phase D (diplomacy.ts): per clan id, today's trade / relation bookkeeping (saved with the site).
  diplo?: Record<number, SiteDiplo>;
  // Forts phase F (vassals.ts): the clan this settlement is a vassal of (null / missing: none) and its
  // liege's book: tribute on / off, the tribute ledger, the levy on the field and the call-to-arms cooldown.
  vassalOf?: number | null;
  vassal?: VassalState;
}
export interface VassalState {
  tax: boolean;
  // Game day of the next tribute (dawn), the last one (day, gold, goods, relation cost) and the running total.
  nextTaxDay: number;
  lastTax?: { day: number; gold: number; goods: Partial<Record<ResourceKey, number>>; relation: number };
  taxGoldTotal: number;
  // Levy colonist ids on the field (alive), when it must go home, when it may be called again, and the
  // tick of the liege's last penalised hit.
  levyIds: string[];
  levyUntilTick: number;
  levyCooldownUntilTick: number;
  levyCalled: number;
  // Levies of the current call killed in the field.
  levyLost?: number;
  // Set while the levy marches home: by then it is back in the garrison regardless.
  levyReturnByTick?: number;
  leashToastTick?: number;
  // Game day of the last "would swear fealty but your army is too weak" toast (not yet a vassal).
  refusedDay?: number;
  lastHitTick?: number;
  // Attacker key of the liege's last hit (debug / test hooks).
  lastHitBy?: string;
}
// Forts phase D: one clan's day at one settlement. day = the game day the counters belong to (reset on a
// new day); bought / sold = units per good today; tradeGain / defendGain = relation gained today (for the
// daily caps); lastGainDay = the last day any gain landed (drift); vassal = phase D "Vassal-ready" flag (old
// saves only; phase F uses SiteState.vassalOf).
export interface SiteDiplo {
  day: number;
  bought: Partial<Record<ResourceKey, number>>;
  sold: Partial<Record<ResourceKey, number>>;
  tradeGain: number;
  defendGain: number;
  lastGainDay: number;
  vassal?: boolean;
  // Forts phase D2: relation gained from quests today (daily cap) and the earliest tick the settlement may
  // post this clan another quest (cooldown).
  questGain?: number;
  questNextTick?: number;
}
export interface RespawnRequest {
  tx: number;
  ty: number;
  kind: ColonistKind;
  ticksRemaining: number;
  // Clans: the dead unit's clan (missing = 0; falls back to the post tile's clan).
  clan?: number;
  // Hero phase 3: a fallen hero (comes back with the same id / name / class at a window, for a gold fee).
  hero?: { id: string; name: string; heroClass: HeroClass };
}
// "sown" and "growing" are one grow timer (sown = its first FARM_SOWN_FRACTION, for the client art);
// "harvesting" is the ripe crop being cut; "fallow" is the rest after FARM_HARVESTS_BEFORE_FALLOW
// harvests. See updateFarmPlots.
export interface FarmPlotState {
  barnX: number;
  barnY: number;
  growTicksRemaining: number;
  // Length of the current grow phase, so the sown -> growing split can be told apart.
  growTicksTotal: number;
  harvestTicksRemaining: number;
  harvestsSinceFallow: number;
  fallowTicksRemaining: number;
  // Counts down after a harvest: the plot shows its "harvested" stubble art meanwhile (FarmStage.Harvested).
  harvestedTicksRemaining: number;
  state: "sown" | "growing" | "harvesting" | "fallow";
}
export type ResourceKey =
  | "wood" | "iron" | "rock"
  | "grain" | "meat" | "fruit" | "wool" | "cotton"
  | "clothes" | "tools" | "luxuryItems"
  | "gold" | "alcohol";
// Walls & gates: state of every Gate tile, by tile index (see the "Walls & gates" block), and whose
// perspective isWalkableTile answers for: true while mobs (and wildlife) move / path (withHostileMover).
export interface GateState {
  open: boolean;
  lock: GateLock;
  // Ticks since a friendly unit was last near (auto lock: closes at GATE_CLOSE_DELAY_TICKS).
  clearTicks: number;
  overrun: boolean;
}
export interface TownCenter {
  x: number;
  y: number;
  level: number;
  hp: number;
  // Clans: owning clan (missing = 0).
  clan?: number;
  // Forts phase B: a captured fort's outpost name.
  name?: string;
}
// Difficulty (chosen on the client's main menu). Scales RAID-WAVE mobs only (createRaidMob and the
// raid size); POI guardians, deserters and the Half-Latch are untouched.
export interface DifficultyTuning {
  mobDamage: number;
  mobHp: number;
  spawnCount: number;
}
export interface MobKindConfig {
  maxHp: number;
  damage: number;
  speed: number;
  range: number; // in pixels, already multiplied by TILE_SIZE
  melee: boolean;
  unlockDay: number;
}
// Factions: each raid group is built from ONE faction. A faction is eligible on a day when at least
// one of its `core` kinds is unlocked (MOB_KIND_CONFIG unlockDay), and is picked with weight = the
// number of its unlocked core kinds. Inside a group, kinds are picked by `weight` among the faction's
// unlocked entries (core or not). Non-core entries are heavies/supplements: they never make a
// faction eligible by themselves (so goblins alone don't unlock the Dark host on day 0).
export type RaidFactionId = "wolfPack" | "banditBand" | "greenskinWarband" | "darkHost" | "riderPack";
export interface RaidFactionEntry {
  kind: MobKind;
  weight: number;
  core: boolean;
}
// Formation: heading-relative staggered rows per faction (see raidFormationSlots). Slot spacing is
// RAID_FORMATION_SPACING_BODIES x the group's mean body diameter; heavies (troll / ogre) take the front
// centre, ranged kinds the rear rows. On contact rows are released one by one, RAID_RELEASE_ROW_TICKS apart.
export type RaidFormationShape = "wedge" | "line" | "column";
export interface CraftRecipe {
  inputs: Partial<Record<ResourceKey, number>>;
  output: ResourceKey;
  outputAmount?: number;
  // The artisan idles once the colony holds this much of the output (so it stops eating its inputs).
  stockCap?: number;
}
export interface SettlementStat {
  tc: TownCenter;
  number: number; // 1-based position in townCenters (the "Settlement N" label)
  used: number;
  pending: number; // worker slots of queued constructions
  housingCap: number; // includes keepBonus
  tierCap: number; // the Town Center tier ceiling alone
  keepBonus: number; // 10 per level of this settlement's Keep
  cap: number; // min(housingCap, tierCap + keepBonus)
  troops: number; // living soldiers of this settlement (they don't count in `used`)
  troopCap: number; // sum of its unit buildings' own troop capacities (base + adjacent houses)
  garrisonBase: number; // its unit buildings' tier headcounts, built + queued (checked against garrisonCap)
  garrisonCap: number; // SETTLEMENT_GARRISON_CAP_BY_TIER + KEEP_GARRISON_PER_LEVEL per Keep level
}
// ---- Dawn/dusk respawn windows (long days, 2026-10-23) ----
// The dead wait in respawnQueue (still validated, re-homed and pruned every daylight tick) and come back in one
// batch at the next window: dawn = cycle tick 0 of a day, dusk = DAY_TICKS - 1, the last daylight
// tick (so replacements still only ever arrive by day). A unit the batch can't afford (food) or fit
// (population cap) keeps waiting for the next window. The Ward Priest follows the same windows.
export type RespawnWindow = "dawn" | "dusk";
// Wild game. Counts per 80x80 (scaled by area): every kind starts at its cap, and the population is
// topped back up by WILDLIFE_RESPAWN_PER_DAY animals a day (the kind furthest below its cap first,
// never above the caps).
export interface WildlifeConfig {
  maxHp: number;
  // px/s while wandering / fleeing.
  speed: number;
  fleeSpeed: number;
  // Meat delivered when the carcass reaches the hut (or straight away when a player kills it).
  meat: number;
  cap: number;
}
export type WildlifeMode = "idle" | "walk" | "flee" | "charge";
export interface Wildlife {
  id: number;
  kind: WildlifeKind;
  x: number;
  y: number;
  hp: number;
  homeX: number;
  homeY: number;
  mode: WildlifeMode;
  targetX: number;
  targetY: number;
  restTicks: number;
  // flee / charge time left.
  modeTicks: number;
  fleeDirX: number;
  fleeDirY: number;
  // Colonist id of the hunter chasing it (one hunter per animal), and of the hunter a boar charges.
  reservedBy: string | null;
  chargeTargetId: string | null;
  attackCooldownTicks: number;
}
// ---- Bodies: spatial hash + separation ----
// Rebuilt every tick after everything has moved: one cell per tile (bodies are at most 28 px across,
// so overlapping pairs are always in the same or adjacent cells). Bodies: soldiers and bishops (not the
// Ward Priest), and every awake mob that isn't a loitering raider or a dormant deserter. Civilians keep
// to their posts / paths and are left out, as are players.
export interface Body {
  e: { x: number; y: number };
  r: number;
  w: number;
  // Walls & gates: a mob body is nudged from the hostile side (never onto a closed gate).
  mob?: boolean;
}
export interface OrderGroup {
  id: string;
  unitIds: Set<string>;
  current: ArmyOrder | null;
  queue: ArmyOrder[];
  // Last formation (radians / tiles; width undefined = block): a click-move keeps it.
  facing?: number;
  width?: number;
  // The slots' centroid (arrival) and the tick the current order started.
  destX: number;
  destY: number;
  startedTick: number;
  engaged: boolean;
  clearSince: number;
  followAt: { x: number; y: number } | null;
  // Phase 4: the front centre the group last formed at (a shape change re-forms there).
  lastAt?: { x: number; y: number };
}
export type RaidEdge = "north" | "south" | "east" | "west";
export type RaidGroupState = "passive" | "marching";
export interface RaidGroup {
  id: string;
  faction: RaidFactionId;
  isHorde: boolean;
  // Edge its fresh mobs spawned on; null for a group of deserters only (they are never edge-spawned).
  edge: RaidEdge | null;
  memberIds: string[];
  // Loiter centre (spawn tile) per edge-spawned member; deserters stand still instead.
  homes: Map<string, TileCoord>;
  aggroTick: number;
  state: RaidGroupState;
  leaderId: string | null;
  // Formation slot per follower, set when the march starts: heading-relative pixels from the leader
  // (x = to the leader's right, y = behind it) and its row (0 = the leader's front row; old saves: 0).
  offsets: Map<string, { x: number; y: number; row?: number }>;
  repathCooldown: number;
  // March heading (unit vector, smoothed from the leader's movement); missing in old saves.
  headingX?: number;
  headingY?: number;
  // Contact: the tick row-by-row release began (see releaseRaidRows) and the leader's position then,
  // which the rows still waiting hold their slots around. Unset while the group is not engaging.
  engagedTick?: number;
  anchorX?: number;
  anchorY?: number;
}
// A mob target pick; `approach` (building / Town Center targets only) is the tile to attack from.
export interface PickedTarget {
  type: MobTargetType;
  id: string | null;
  approach?: TileCoord;
}
export interface RegimentState {
  id: string;
  morale: number;
  peak: number;
  routed: boolean;
  // A raid regiment (no site): routing makes it leave the map instead of falling back home.
  raid: boolean;
  homeX: number;
  homeY: number;
  lastContactTick: number;
  // First tick in contact (raid morale grace), and whether a morale anchor has ever been a member.
  firstContactTick: number;
  hadAnchor: boolean;
  pendingLoss: number;
  hadFront: boolean;
  sheltering: boolean;
  // Shelter post per member (a tile inside the walls), set while sheltering.
  posts: Map<string, TileCoord>;
  flankIds: string[];
  ratio: number;
  // Strategy mode phase 6: the last evaluation that found it outflanked (enemy banner "Outflanked!").
  outflankedTick?: number;
}
export interface EnemyUnit {
  type: "colonist" | "player";
  id: string;
  x: number;
  y: number;
  rear: boolean;
}
export interface PlayerMoraleState {
  id: string;
  name: string;
  morale: number;
  peak: number;
  // Evaluated this second (big enough, or routing): the snapshot carries its morale.
  active: boolean;
  routed: boolean;
  routedTick: number;
  lastContactTick: number;
  fightStartTick: number;
  pendingLoss: number;
  hadFront: boolean;
  outflanked: boolean;
  lastWarnTick: number;
  // Own side / enemy Lanchester strength at the last evaluation in contact (test hook).
  ratio: number;
}
export interface HearthState {
  siteId: string;
  siteKind: PoiSiteKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  // "bandit" / "orc": the toast's faction word.
  faction: string;
  // Guardians the site was stamped with (scales the loot).
  garrison: number;
}
export interface AttackObjective {
  id: string;
  x: number;
  y: number;
}
// ---- Goal track (ROADMAP Phase 5) ----
// One shared, ordered track per world. Only the current goal is checked (once a second, plus right
// after the Warlord dies); when it's met the colony gets its reward, a "milestone" toast, and the next
// goal becomes current (several can complete in one check, e.g. a night milestone already passed).
export interface GoalDef {
  title: string;
  progress: () => { progress: number; target: number };
  reward: Partial<Record<ResourceKey, number>>;
}
export interface SaveFile {
  version: number;
  savedAt: string;
  dayIndex: number;
  population: number;
  difficulty: Difficulty;
  worldSize: number;
  label: string;
  state: WorldState;
}
export type WorldState = ReturnType<typeof snapshotWorld>;
// ---- Placement costs (charged when a placement is accepted, i.e. when its construction site starts) ----
export type Cost = Partial<Record<ResourceKey, number>>;
// ---- Construction: builders turn an accepted placement into the building over time ----
// Every placeable building except Farm Plots (a field sown on the spot) becomes a construction site.
// The cost is charged at placement; a new building's tile turns into a solid ConstructionSite, an
// in-place upgrade keeps the building (and its workers) running until the upgrade lands. When the
// site's progress reaches its total, the normal resolve*Placement logic runs, exactly as an instant
// placement used to (worker spawns, upgrades and synergies all unchanged).
export interface ConstructionSiteState {
  tx: number;
  ty: number;
  // The placement requested (e.g. ArcherPost, House on a House = upgrade).
  target: TileType;
  // What the tile held when the placement was accepted (restored just before resolving).
  prevTile: TileType;
  upgrade: boolean;
  // Builder work accumulated (each working builder adds builderRate per tick) / needed.
  progress: number;
  totalTicks: number;
}
// Cavalry charge runs: where the rider's current straight run began (ax, ay), its last position, ticks
// stood still, and the tick its next charge may land. Not saved.
export interface ChargeRun {
  ax: number;
  ay: number;
  lx: number;
  ly: number;
  idle: number;
  readyTick: number;
}
// ---- Siege Workshop production ----
export interface SiegeWorkshopState {
  building: SiegeKind | null;
  ticksLeft: number;
}
// ---- Hero phases 1-2: items, inventory, XP for the PLAYER (ROADMAP "Hero phases 1-2") ----
// A HeroProfile is the player's persistent gear + XP, keyed by Player.profileKey, saved with the world
// (`heroProfiles`), never touched by death / respawn. Heroes (phase 3) can own one each: nothing here is
// player-specific except heroProfileOf / playerMaxHp / playerDamage / playerAttackCooldownTicks.
export interface HeroProfile {
  key: string;
  equipment: Equipment;
  // Unequipped items only (equipped ones live in `equipment`), at most HERO_INVENTORY_CAP.
  inventory: GearItem[];
  xp: number;
  // Bumped (from heroProfileVersionCounter) on every change; the snapshot resends the profile then.
  version: number;
  // Cached derived modifiers (recomputed by recomputeHeroProfile on every change).
  stats: HeroStats;
  level: number;
  // Hero phase 3: set on hero profiles ("hero:<id>") only - the hero's class (its base HP) and name, so a
  // fallen / recruiting hero is still known. Their `inventory` stays empty (they equip from the player's).
  heroClass?: HeroClass;
  heroName?: string;
  // Hero phase 4: learned spell ids, the 4 spell slots (spell ids; Equipment.spell1-4 stay null - an
  // Equipment socket holds a GearItem), the hero's Auto toggle (players never auto-cast) and how many
  // level-up spell grants (SPELL_GRANT_LEVELS) were already given.
  spells: SpellId[];
  spellSlots: (SpellId | null)[];
  spellAuto: boolean;
  spellGrants: number;
}
export interface HeroRecruit {
  id: string;
  name: string;
  heroClass: HeroClass;
  tx: number;
  ty: number;
  ticksLeft: number;
}
export interface SpellStatus {
  burnUntil?: number;
  burnNext?: number;
  burnPerSec?: number;
  burnBy?: string;
  slowUntil?: number;
  baseSpeed?: number;
  curseUntil?: number;
  curseBonus?: number;
  shield?: number;
  shieldUntil?: number;
  buffUntil?: number;
  buffDamage?: number;
  buffSpeed?: number;
}
// ---- Casting ----
export interface SpellCaster {
  prof: HeroProfile;
  x: number;
  y: number;
  // Damage attribution ("p:<player id>" / "c:<hero id>": kills give that caster XP).
  attackerKey: string;
  self: { type: "player"; p: Player } | { type: "colonist"; c: Colonist };
}
export type SpellTarget = { targetId?: string; x?: number; y?: number };
export type FriendlyUnit = { type: "player"; p: Player } | { type: "colonist"; c: Colonist };
export interface ForgeQueueState {
  queue: { slot: EquipSlot; tier: number }[];
  ticksLeft: number;
}
export interface FightHit {
  tick: number;
  x: number;
  y: number;
  mobId: string;
  // The mob's opponent: "c:<colonistId>", "p:<playerId>" or "b:<building tile key>".
  other: string;
  amount: number;
  // Colony colonist (not the Abbey's clergy) / colony building involved; the player, if one is.
  units: boolean;
  buildings: boolean;
  playerId: string | null;
  kind: FightKind;
  label: string;
  // Higher wins when a cluster's hits disagree on who the attackers are.
  rank: number;
}
export interface ActiveFight extends Omit<FightSnapshot, "you"> {
  playerIds: Set<string>;
  lastTick: number;
}
