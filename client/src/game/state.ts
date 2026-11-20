// Mutable state of the client (client main.ts split): every former `let` in main()'s setup closure is a
// field of `S` (MainState, one object per main() call, passed to the game/ modules), every former module-level
// `let` of main.ts a field of `G` (SessionState: main menu / session choices). ES module bindings can't be
// reassigned from another module, so shared mutable values live here; never `export let`.
import type { Cardinal } from "../autumnAnimations";
import type { LodBand } from "../strategy/lod";
import type {
  TownCenterSnapshot, SiteSnapshot, SiteRelationSnapshot, FightSnapshot, TileType, ProgressionSnapshot,
  ColonistSnapshot, MobSnapshot, GateLock, QuestSnapshot, ChronicleEntry, HeroProfileSnapshot, HERO_WEAPON_KINDS,
  HeroSheetSnapshot, EquipmentStock, PlayerSnapshot, SpellId, GoalSnapshot, SaveInfo, ArmyRegimentSnapshot,
  EnemyRegimentSnapshot, ArmyOrderGroupSnapshot, HeroAppearance, SaveSlot, Difficulty
} from "@colony/shared/protocol";
import type { Container } from "pixi.js";
import type { ToolCategory } from "../tools";
import type { Threat } from "../strategy/intel";
import type { SiteView, ArmedOrder, LeftPress, OrderPress } from "./types";

export interface MainState {
  heroToolPose: { row: number; facing: Cardinal; started: number } | null;
  // Strategy mode phase 1: the zoom is variable (TACTICAL_ZOOM unless the strategy camera is active).
  camZoom: number;
  pendingStartStrategy: boolean;
  // LOD band drawn this frame ("tactical" whenever the strategy camera is inactive).
  strategyBand: LodBand;
  myId: string | null;
  // Gap closure G6: the own hero rides a horse (snapshot `mounted`), and how far the sprite sits up.
  myMounted: boolean;
  tileSize: number;
  worldTilesX: number;
  worldTilesY: number;
  // Every standing Town Center, from the latest snapshot (minimap markers, HP bars, game over).
  latestTownCenters: TownCenterSnapshot[];
  // Camp hearths: tile indices of the standing ones (snapshot `hearths`), for right-click attack orders
  // and minimap markers (explored tiles only).
  latestHearths: Set<number>;
  // This world's Castle Ruin centre (welcome); the minimap marks it once that tile is explored.
  castleRuinTile: { x: number; y: number } | null;
  tiles: number[];
  // Biome per tile from `welcome`; static for the life of a world.
  biomes: number[];
  // World streaming phase 4: a chunked welcome (streamed world) sends tiles / biomes per 32x32 chunk on
  // request; until a chunk arrives its tiles read Empty / Plains, its floor is not built and the minimap shows
  // the welcome's downscaled summary (cells = one MinimapClass per f x f tiles, cellSeen = any tile explored).
  streamed: { chunkTiles: number; chunksX: number; chunksY: number; f: number; cw: number; ch: number; cells: Uint8Array; cellSeen: Uint8Array } | null;
  chunkLoaded: Uint8Array<ArrayBuffer>;
  chunkRequestAt: number;
  // Gap closure G7: quest givers with a quest for you (from the snapshot's `life`).
  questMarkIds: Set<string>;
  bloodOnNewGravestones: boolean;
  // A welcome (join or world restart) wipes every entity at once; that isn't a mass death.
  suppressDeathPoofs: boolean;
  // Server art state per tile index, from the snapshot: farm stage (FarmStage), building level (>1
  // only), and construction sites. Each sync re-draws only the tiles whose value changed.
  farmStages: Map<number, number>;
  buildingLevels: Map<number, number>;
  // Blacksmith tile indices forging right now (snapshot `forgeBusy`).
  forgeBusy: Set<number>;
  constructionSites: Map<number, SiteView>;
  // Damaged buildings (snapshot `damagedBuildings`): tile index -> HP permille. See syncDamagedBuildings.
  damagedBuildings: Map<number, number>;
  // Walls & gates: snapshot `gates`, tile index -> GATE_FLAG_* bits (see syncGates).
  gateFlags: Map<number, number>;
  // Modular building phase 1: the roofs need recomputing (a tile changed / the map or a chunk arrived).
  roofDirty: boolean;
  // Forts phase A: NPC-owned tiles (snapshot `siteTiles`, only sent when it changed): tile index -> site
  // number. Drawn tinted (FOREIGN_TINT), red on the minimap; right-click with soldiers = attack it.
  siteOwners: Map<number, number>;
  // Forts phase B: explored forts (snapshot `sites`, sent with siteTiles): minimap flags by faction.
  fortMarkers: SiteSnapshot[];
  // Forts phase D: this clan's relation to each sighted settlement (snapshot `relations`, by site number);
  // a settlement's minimap flag takes its tier's colour.
  siteRelations: Map<number, SiteRelationSnapshot>;
  // Clans (snapshot clanId / clans / clanTiles, only while 2+ clans play): this player's clan, every clan's
  // colour, and the clan of every player building. Another clan's buildings are tinted with its colour
  // and its units get a ring in it; neither can be selected or ordered.
  myClan: number;
  clanColors: Map<number, number>;
  clanNames: Map<number, string>;
  clanTiles: Map<number, number>;
  // True from a welcome until its first snapshot has been applied: state diffs then are a world
  // load, not events, so they make no sound.
  soundSuppressed: boolean;
  // Forts phase C: remember which site numbers are human settlements (their tiles get HUMAN_SITE_TINT);
  // repaint the tiles of a settlement the first time it shows up.
  fortMarkersKey: string;
  roofRooms: Container[];
  roofTileRoom: Map<number, number>;
  roofComputedAt: number;
  seasonTreeTint: number;
  shownSeason: number;
  interpSnapAt: number;
  interpIntervalMs: number;
  // Shared clock for every looping tile (fire flicker, water ripple): one pass over the animated
  // slots, and only on a frame boundary of the fastest loop, not per sprite or per render frame.
  lastTileAnimStep: number;
  minimapImage: ImageData | null;
  minimapStaticDirty: boolean;
  // The strategic map sprite's texture needs a re-upload from minimapStatic (done only in the Map band).
  strategicMapDirty: boolean;
  explored: Uint8Array<ArrayBuffer>;
  // Both integers, so tile -> pixel stays exact: CSS px per tile, and backing px per CSS px.
  minimapCssPerTile: number;
  minimapDpr: number;
  mmExpanded: boolean;
  mmFull: boolean;
  mmBaseCss: number;
  // Top-left of the visible window, in backing px of the map-space the drawing code works in (0, 0 when the whole map shows).
  mmOx: number;
  mmOy: number;
  latestFights: FightSnapshot[];
  lastFightToastAt: number;
  fightPeek: { x: number; y: number; until: number } | null;
  // The eased camera focus while peeking or easing back (null = locked on the player).
  fightPeekCam: { x: number; y: number } | null;
  shownCalendar: string;
  shownWinter: string;
  shownAgri: string;
  sundialDayFraction: number;
  foldedGroups: Set<string>;
  // ---- Toolbar (real DOM elements, not canvas-drawn) ----
  currentTool: TileType;
  // Gap closure G1: the turn (0 / 1) of the next 2-tile furniture piece (R).
  furnitureRot: number;
  // Phase 3: a creative world shows the retired build tools.
  creativeWorld: boolean;
  activeCategory: ToolCategory;
  // ---- Progression tree (shared/src/progression.ts; the server's `progression` snapshot) ----
  // The Build panel keeps the locked "needs: X" tool text and the prospector; hand crafting is the Crafting panel
  // (Craft button / Shift+C); the nearest goals are the Next steps bar (top centre) and its Progression dropdown.
  progressionLocked: Record<number, string[]>;
  progressionSig: string;
  latestProgression: ProgressionSnapshot | undefined;
  // Crafting panel: every hand recipe with each input's have / need, a Craft button, and "needs: X" when it can't.
  craftSig: string;
  // ---- Unit selection (client-local; task forces are server-synced) ----
  latestColonists: ColonistSnapshot[];
  latestMobs: MobSnapshot[];
  latestTaskForces: Record<string, string[]>;
  selectedIds: Set<string>;
  lastSelectionHudText: string;
  // Newest order number per unit. A rank's delayed commandMove is dropped for any unit that has
  // since been given another order (move or attack), so the tail of a staggered formation order
  // can never overwrite a quick re-order — while orders to other units are left alone.
  orderCounter: number;
  formationMarkerState: {
    ids: string[];
    shownAt: number;
    settleAfter: number;
    fadeFrom: number | null;
  } | null;
  lastMyHp: number | null;
  lastMyPos: { x: number; y: number; at: number } | null;
  horseIdleSince: number;
  horseMoving: boolean;
  lastAmbientScan: number;
  shownGateLock: GateLock;
  mineDigPreview: { level: number; chance: number; risk: string } | null;
  mineDigArmedUntil: number;
  shownLevyOnField: number;
  shownForgeAuto: { on: boolean; target: number };
  bpSpellsKey: string;
  bpWagonAuto: boolean;
  bpWagonDestKey: string;
  bpVassalTax: boolean;
  tradeOpen: boolean;
  tradeKey: string;
  // Forts phase D2: settlement quests (snapshot `quests`, the clan's open ones): the top-bar Quests button,
  // the parchment Quests panel (accept / abandon / deliver) and minimap markers (drawMinimap).
  latestQuests: QuestSnapshot[];
  questCycleTicks: number;
  questKey: string;
  questSeen: Set<number>;
  chronicleEntries: ChronicleEntry[];
  // Entries with an id above this arrived "while you were away" (the profile's read mark on the server).
  chronicleAwaySince: number;
  chronicleRead: number;
  // Tile the panel shows; re-requested every second while open so numbers stay live.
  infoTile: { tx: number; ty: number } | null;
  bpWorkCandsOpen: boolean;
  bpWorkSig: string;
  heirListKey: string;
  // ---- Networking ----
  // Hero phases 1-2: a stored per-browser profile id, so this player's gear / XP follow them across sessions.
  profileId: string;
  loadingSnapshotSeen: boolean;
  currentTimeScale: number;
  currentPaused: boolean;
  equipmentLineKey: string;
  heroProfile: HeroProfileSnapshot | null;
  armouryWeapon: typeof HERO_WEAPON_KINDS[number];
  armouryPart: "head"|"chest"|"offhand";
  // Hero phase 3: the colony's heroes (snapshot `heroes`) and the open tab ("" = the player).
  heroSheets: HeroSheetSnapshot[];
  sheetTab: string;
  heroStock: EquipmentStock | undefined;
  heroRenderKey: string;
  heroHpText: string;
  heroMe: PlayerSnapshot | undefined;
  // The spell picked in the spell book, waiting for a slot click.
  pickedSpell: SpellId | null;
  spellCdAt: number;
  spellAim: { slot: number; spell: SpellId } | null;
  spellBarKey: string;
  latestPlayersForSpells: PlayerSnapshot[];
  settlementPanelKey: string;
  // -1 until the first snapshot after a welcome, so a load / restart never flashes.
  lastGoalIndex: number;
  latestGoal: GoalSnapshot | null;
  goalFlashTimer: number;
  wasNight: boolean;
  // In-game Save Game section (top of the Settings modal): 3 manual slots, plus Load for every save.
  latestSaves: SaveInfo[];
  armyRegiments: ArmyRegimentSnapshot[];
  regimentOfUnit: Map<string, ArmyRegimentSnapshot>;
  lastGroupTap: { slot: number; at: number; };
  panDrag: { pointerId: number; lastX: number; lastY: number } | null;
  canvasPointer: { x: number; y: number } | null;
  lastPanAt: number;
  fogUpdatedAt: number;
  dotsDirty: boolean;
  dotsZoom: number;
  strategyWasActive: boolean;
  viewSent: { x: number; y: number; halfW: number; halfH: number } | null;
  viewSentAt: number;
  armedOrder: ArmedOrder | null;
  // Strategy mode phase 5: enemy summaries (snapshot enemyRegiments, kept until the next), their banners,
  // the intel overlay (strategy/intel.ts) and the own regiments under flank / rear threat.
  enemyRegiments: EnemyRegimentSnapshot[];
  strategyThreats: Threat[];
  orderGroups: ArmyOrderGroupSnapshot[];
  orderGroupOfUnit: Map<string, ArmyOrderGroupSnapshot>;
  leftPress: LeftPress | null;
  orderPress: OrderPress | null;
  pendingDemolish: { x: number; y: number }[];
  // Modular building phase 1: a structure tool's right press, until release.
  structDrag: { pointerId: number; tool: TileType; x0: number; y0: number; x1: number; y1: number } | null;
  // Phase H: right-dragging the Moat tool digs every tile the pointer crosses, 4-connected (a diagonal
  // step adds the orthogonal tile between), so the line has no corner gaps. Animal paddocks: the Fence tool too.
  moatDrag: { pointerId: number; x: number; y: number } | null;
}

export interface SessionState {
  pendingCreatorAppearance: HeroAppearance | null;
  // Main menu Continue / Load Game: the slot to load right after the first welcome (else null).
  pendingLoadSlot: SaveSlot | null;
  // Creative mode: the menu's game mode (Creative button / ?mode=creative), enforced on the first welcome after
  // New Game / Creative (never after Continue / Load: a save brings its own mode).
  preferredCreative: boolean;
  // Solo hero phase 4: the menu's "New Game (Solo)" (or ?mode=solo): start as the hero alone, no settlement.
  preferredSolo: boolean;
  enforceGameMode: boolean;
  // The menu choice: sent as setDifficulty after every welcome, and with an in-game Restart.
  preferredDifficulty: Difficulty;
  // Clans: the main menu's Clan choice (sent as the ws URL's `?clan=`): join the clan already playing (clan 0)
  // or found a new one. A page URL `?clan=new` / `?clan=<id>` overrides it (e.g. to join clan 2).
  preferredClan: "join" | "new";
  // Vast (1024) unless the player picked another size before (remembered in localStorage). The server's own default
  // (COLONY_WORLD_SIZE or 160) only applies to clients that send no size, such as the scripted tests.
  preferredWorldSize: number | undefined;
  gameStarted: boolean;
  // The world's active difficulty as the server reports it (null until the first welcome).
  activeDifficulty: Difficulty | null;
}
