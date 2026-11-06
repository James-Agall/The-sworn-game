import {
  Application,
  Assets,
  CanvasSource,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { setupCreative } from "./creative";
import { type HeroLifeUi, setupHeroLife } from "./herolife";
// Solo hero (herolife.ts): set once the hero bar exists; the socket handler forwards dialogue / life to it.
const heroLifeRef: { ui: HeroLifeUi | null } = { ui: null };
import type {
  ClientMessage,
  SiteFaction,
  SiteSnapshot,
  SiteRelationSnapshot,
  QuestSnapshot,
  RelationTier,
  TradeGood,
  ServerMessage,
  PlayerSnapshot,
  ColonistSnapshot,
  ColonistKind,
  MobSnapshot,
  MobKind,
  AttackEffect,
  Stance,
  GravestoneSnapshot,
  GameEventCategory,
  Difficulty,
  WildlifeKind,
  TownCenterSnapshot,
  BuildingInfo,
  SaveInfo,
  SaveSlot,
  GoalSnapshot,
  GateLock,
  EquipSlot,
  EquipmentStock,
  GearItem,
  GearSlot,
  HeroProfileSnapshot,
  HeroSheetSnapshot,
  HeroClass,
  ItemStats,
} from "@colony/shared/protocol";
import { TICK_RATE } from "@colony/shared/protocol"; // long days: respawn-window ETA
import { RELATION_TIER_NAMES } from "@colony/shared/protocol"; // forts phase D: relation tier labels
import {
  BLACKSMITH_TOOLS_STOCK_CAP, buildCostText, FOOTPRINT_BY_TILE, footprintAnchorOf, footprintOf, footprintPartOffsets,
  placedFootprintAt,
} from "@colony/shared/buildings";
import type { Footprint } from "@colony/shared/buildings";
import { type ChainStep, type ItemId, PROGRESSION, PROGRESSION_BUILDING_LABEL, QUALITY_GRADES } from "@colony/shared/progression";
import type { ProgressionSnapshot } from "@colony/shared/protocol";
import {
  Biome,
  BOSS_RENDER_SCALE,
  mobSizeScale,
  bossTitle,
  BUILDING_LEVEL_SNAPSHOT_STRIDE,
  CONSTRUCTION_SNAPSHOT_STRIDE,
  DAMAGED_BUILDING_SNAPSHOT_STRIDE,
  HEARTH_SNAPSHOT_STRIDE,
  FARM_STAGE_SNAPSHOT_STRIDE,
  FarmStage,
  GATE_FLAG_OPEN,
  GATE_FLAG_OVERRUN,
  SITE_TILE_SNAPSHOT_STRIDE,
  CLAN_TILE_SNAPSHOT_STRIDE,
  GATE_SNAPSHOT_STRIDE,
  HUNGER_MARK_NAMES,
  HungerMark,
  isRoadTile,
  PLAYER_SPEED,
  TILE_SIZE,
  TileType,
  VISION_RADIUS_COLONIST,
  VISION_RADIUS_PLAYER,
  WILDLIFE_KINDS,
  WILDLIFE_SNAPSHOT_STRIDE,
  WildlifeState,
} from "@colony/shared/protocol";
import { SOUND_SILENT_RADIUS_TILES, proximityGain } from "./sound";
import type { FightSnapshot } from "@colony/shared/protocol";
import { FIGHT_WINDOW_SECONDS } from "@colony/shared/protocol";
import { MOB_ROLE, isRearRole, SIEGE_KINDS, unitRole, HERO_CLASSES, HERO_CLASS_LABEL } from "@colony/shared/protocol";
import type { CombatRole, SiegeKind } from "@colony/shared/protocol";
import { SPELLS, SPELL_SLOT_COUNT } from "@colony/shared/protocol";
import { LINE_FACE_ENEMY_TILES, computeFormationTargets, computeLineFormationTargets as sharedLineFormation, groupShape, planOrderFormation } from "@colony/shared/formation";
import type { FormationPlan } from "@colony/shared/formation";
import type { SpellId, SpellBookSnapshot } from "@colony/shared/protocol";
import { compassDirection, fightArrowAlpha, placeEdgeArrow } from "./fightArrows";
import { EDGE_SCROLL_PX, PAN_SCREEN_PX_PER_S, StrategyCamera, TACTICAL_ZOOM, WHEEL_ZOOM_STEP } from "./strategy/camera";
import { ADVENTURE_CAM_PREF, AdventureCamera, PARTY_COMMAND_MAX, START_STRATEGY_PREF, readAdventurePrefs } from "./adventure";
import { drawUnitDots, lodBand, StrategyBanners, StrategyFog } from "./strategy/lod";
import type { BannerGroup, LodBand, UnitDot, VisionSource } from "./strategy/lod";
import { RegimentCardBar } from "./strategy/cards";
import type { RegimentCard } from "./strategy/cards";
import type { ArmyRegimentSnapshot, RegimentClass } from "@colony/shared/protocol";
import type { ChronicleEntry } from "@colony/shared/protocol";
import type { ArmyOrder, ArmyOrderGroupSnapshot, ArmyOrderKind, FormationShape } from "@colony/shared/protocol";
import { FORMATION_SHAPES } from "@colony/shared/protocol";
import { ORDER_COLORS, ORDER_LABEL, OrderMarkers } from "./strategy/orders";
import { BAND_COLORS, enemyBannerLabel, IntelOverlay, strengthBand } from "./strategy/intel";
import type { ObjectiveMarker, Threat } from "./strategy/intel";
import type { EnemyRegimentSnapshot } from "@colony/shared/protocol";
import { TIME_SCALES } from "@colony/shared/protocol";
import {
  MAX_CHUNKS_PER_REQUEST, MinimapClass, decodeByteRuns, decodeMaskRuns, minimapCellClass, minimapClassOf,
} from "@colony/shared/streaming";

import { type ToolCategory, TOOL_CATEGORIES, TOOLS } from "./tools";
import {
  COLONIST_COLORS, COMMANDABLE_KINDS, WORKER_KINDS, HIDE_AT_POST_KINDS, AT_POST_HIDE_RADIUS_PX, GARRISON_TILES,
  SELECTION_COLOR, DRAG_THRESHOLD_PX, UNIT_HIT_RADIUS, ROLE_COLORS, ROLE_LABEL, STANCE_HOTKEYS, STANCE_LABEL,
  SHAPE_LABEL, FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS, FORMATION_MARKER_MIN_MS,
  FORMATION_MARKER_MAX_MS, FORMATION_MARKER_FADE_MS, MOB_VISUALS, MOB_KINDS, MOB_SPRITE_URL_OVERRIDES, MOB_TINT,
  artUrl, COLONIST_ANIM_URLS, COLONIST_OPTIONAL_ANIM_URLS, TIER_ART_KINDS, COLONIST_TIER_ANIM_URLS,
  CAVALRY_CHARGE_URL, CAVALRY_CHARGE_TILES, CHARGE_DUST_URL, CHARGE_DUST_MS, SIEGE_WRECK_URLS, SIEGE_WRECK_MS,
  COLONIST_STANDIN_TINT, COLONIST_KIND_HEIGHT, COLONIST_STATIC_URL_OVERRIDES, PLAYER_ANIM_URLS,
  COLONIST_ACTION_STATES, COLONIST_WALK_STATES, FOOD_WORKER_BUSY_STATES, MOB_VARIANT_URLS, MOB_OPTIONAL_VARIANT_URLS,
  GOBLIN_RIDER_VET_URLS, WARLORD_URLS, WARLORD_ANIM_SIZE, WARLORD_ROAR_FRAME_MS, WARLORD_ROAR_EVERY_MS,
  MOB_ANIM_FIT_LONGER_SIDE, MOB_ATTACK_ANIM_RANGE_PX, MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX, stableHash,
  MOB_SPRITE_SIZE_PER_RADIUS, mobHitRadius,
} from "./unitVisuals";
import {
  TILE_SPRITE_FILES, TILE_OPTIONAL_ART, SITE_KEEP_RUIN_ART, SITE_TENT_ART, SITE_RUBBLE_ART, KEEP_SCAFFOLD_ART,
  QUEST_MARKER_IMAGES, SITE_VARIANT_ART_NAMES, TILE_OPTIONAL_ALT_ART, WALL_PIECE_SETS, type WallPieceSet,
  wallPieceUrl, type GateArtState, gateArtUrl, moatPieceUrl, MOAT_DIGGING_URL, type DrawbridgeArtState,
  drawbridgeArtUrl, MOAT_ART_URLS, WALL_ART_URLS, WALL_DAMAGED_PERMILLE, WALL_ART_PX_PER_TILE, TILE_STANDIN_TINT,
  TILE_ANIM, FIRE_FLAME_WIDTH, SOOT_TINT, FIRE_SMOKE_MS, MAX_FIRE_OVERLAYS, FARM_STAGE_ART, TILE_LEVEL_ART,
  WAGON_ART_URLS, WAGON_STANDIN_TINT, WAGON_HEIGHT, WAGON_DANGER_COLORS, BLACKSMITH_FORGE_URLS,
  BLACKSMITH_FORGE_FRAME_MS, TOWN_CENTER_LEVEL_FIT, TOWN_CENTER_MARKER_URL, CONSTRUCTION_ALPHA, CONSTRUCTION_TINT,
  DEER_FALLEN_URL, DEER_FALLEN_MS, GRAVESTONE_URLS, GRAVESTONE_HEIGHT, WILDLIFE, DEER_WALK_URLS, DEER_GRAZE_URLS,
  WILDLIFE_ART, WILDLIFE_OPTIONAL_URLS, WILDLIFE_FRAME_MS, WILDLIFE_RUN_FRAME_MS, BLOOD_URLS, BLOOD_HIT_VARIANTS,
  BLOOD_DEATH_VARIANTS, BLOOD_HIT_SIZE, BLOOD_DEATH_SIZE, BLOOD_HIT_CHANCE, BLOOD_ALPHA, BLOOD_MAX, FX_URLS,
  FX_ANIM_URLS, BOULDER_URLS, BOULDER_IMPACT_URLS, WOUND_URLS, WOUND_LARGE_URLS, WOUND_THRESHOLDS,
  COLONIST_WOUND_SIZE, MOB_WOUND_SIZE_FACTOR, WOUND_LARGE_KINDS, TILE_SPRITE_FILL_TILE, ROAD_AUTOTILE,
  COBBLE_STRAIGHT, COBBLE_FILL, ROAD_ART_URLS, HUNGER_SIGIL_URLS, HUNGER_AURA_URLS, HUNGER_LABEL_COLORS,
  HUNGER_SIGIL_SIZE, HUNGER_AURA_WIDTH, MARKED_MOB_SCALE, mobRenderScale, BOSS_LABEL_COLORS, BOSS_HP_BAR_SCALE,
  BATTERED_HP_FRACTION, BATTERED_TINT, BATTERED_POSE_URLS, BATTERED_TINT_KINDS, HERO_VISUAL_KIND, REGIMENT_ICON_KIND,
  HERO_TINT, SUMMON_TINT, TILE_SPRITE_SIZE_FACTOR, BUILDING_VISUAL_SCALE, TILE_SPRITE_MAX_WIDTH_TILES,
  TILE_SPRITE_MAX_HEIGHT_TILES, TOWN_CENTER_WIDTH_TILES, TOWN_CENTER_ANCHOR, type EntityVisual, COLONIST_KINDS,
  COLONIST_SPRITE_HEIGHT, PLAYER_SPRITE_HEIGHT, NATURE_DECOR_ONE_IN, NATURE_DECOR, tileHash01, PLAYER_RECOLOR_FRAG,
  hexToHue,
} from "./worldVisuals";
import {
  sound, WORK_SOUND_INTERVAL_MS, CRAFT_VOLUME_NON_SMITH, MOB_GROWL_RADIUS_TILES, MOB_GROWL_CHANCE,
  HORSE_MOVING_MIN_SPEED, HORSE_RATE_MIN, HORSE_RATE_MAX, HORSE_TELEPORT_SPEED, HORSE_WHINNY_IDLE_MS,
  HORSE_WHINNY_CHANCE, AMBIENT_SCAN_MS, AMBIENT_TILE_LOOPS, DAWN_BELL_DELAY_S, PLACEMENT_CONFIRM_MS, workSoundKey,
} from "./soundTriggers";

const SERVER_URL = "ws://localhost:8080";
// The same server answers plain HTTP: GET /saves lists the save slots (the menu has no socket yet).
const SAVES_URL = `${SERVER_URL.replace(/^ws/, "http")}/saves`;
// Main menu Continue / Load Game: the slot to load right after the first welcome (else null).
let pendingLoadSlot: SaveSlot | null = null;
// Creative mode: the menu's game mode (Creative button / ?mode=creative), enforced on the first welcome after
// New Game / Creative (never after Continue / Load: a save brings its own mode).
let preferredCreative = new URLSearchParams(location.search).get("mode") === "creative";
// Solo hero phase 4: the menu's "New Game (Solo)" (or ?mode=solo): start as the hero alone, no settlement.
let preferredSolo = new URLSearchParams(location.search).get("mode") === "solo";
// Village life phase 5: the close adventure camera (on unless ?camera=classic / the setting) and whether a game
// starts in strategy view (?view=strategy / the setting). Read once; the settings apply from the next page load.
const adventurePrefs = readAdventurePrefs(location.search, (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
});
let enforceGameMode = false;





async function main() {
  const app = new Application();
  await app.init({ background: "#1a1a1a", resizeTo: window });
  document.getElementById("app")!.appendChild(app.canvas);

  const colonistUrls = COLONIST_KINDS.map((kind) => COLONIST_STATIC_URL_OVERRIDES[kind] ?? `/sprites/${kind}.png`);
  const mobUrls = MOB_KINDS.map((kind) => MOB_SPRITE_URL_OVERRIDES[kind] ?? `/sprites/${kind}.png`);
  const tileSpriteEntries = Object.entries(TILE_SPRITE_FILES).map(
    ([tile, file]) => [Number(tile), `/sprites/${file}.png`] as const
  );
  // Extra variants not tied 1:1 to a TileType: extra Iron Ore looks and two grass-floor
  // textures, picked per-tile-position for visual variety instead of one fixed art per type.
  const EXTRA_URLS = [
    "/sprites/ironOre2.png",
    "/sprites/ironOre3.png",
    "/sprites/gateWoodOpen.png",
    "/sprites/grassFloor1.png",
    "/sprites/grassFloor2.png",
    "/sprites/hillsFloor.png",
    "/sprites/swampFloor.png",
    ...NATURE_DECOR.map((d) => d.url),
    ...GRAVESTONE_URLS,
    ...BLOOD_URLS,
    ...DEER_WALK_URLS,
    ...DEER_GRAZE_URLS,
    ...WILDLIFE.crow.frames,
    ...WILDLIFE.frog.frames,
    ...Object.values(FX_URLS),
    ...Object.values(FX_ANIM_URLS).flat(),
    ...WOUND_URLS,
    ...WOUND_LARGE_URLS,
    ...Object.values(TILE_ANIM).flatMap((a) => a!.urls),
    ...ROAD_ART_URLS,
    ...HUNGER_SIGIL_URLS.filter(Boolean),
    ...HUNGER_AURA_URLS.filter(Boolean),
    ...Object.values(BATTERED_POSE_URLS),
  ];
  const ANIM_URLS = [
    ...Object.values(COLONIST_ANIM_URLS).flatMap((a) => [...a.walk, ...a.action]),
    ...PLAYER_ANIM_URLS.walk,
    ...PLAYER_ANIM_URLS.action,
    ...Object.values(MOB_VARIANT_URLS).flatMap((variants) =>
      variants.flatMap((v) => [...(v.idle ? [v.idle] : []), ...(v.walk ?? []), ...(v.action ?? [])])
    ),
  ];
  // Art that may not exist yet (stand-ins cover it). Loaded one by one so a missing file can't fail
  // the main load below, which throws on any missing URL.
  async function loadOptionalTextures(urls: string[]): Promise<Record<string, Texture>> {
    const out: Record<string, Texture> = {};
    await Promise.all(
      urls.map(async (url) => {
        try {
          const texture = await Assets.load<Texture>(url);
          if (texture) {
            texture.source.scaleMode = "nearest";
            out[url] = texture;
          }
        } catch {
          // Not delivered yet: keep the stand-in.
        }
      })
    );
    return out;
  }
  const optionalTexturesPromise = loadOptionalTextures([
    ...Object.values(COLONIST_OPTIONAL_ANIM_URLS).flatMap((a) => [...a!.walk, ...a!.action, ...a!.carry]),
    ...Object.values(COLONIST_TIER_ANIM_URLS).flatMap((tiers) => tiers.flatMap((a) => [...a.walk, ...a.action])),
    ...BLACKSMITH_FORGE_URLS,
    ...WAGON_ART_URLS.flatMap((u) => [...u.walk, u.idle, ...u.hit]),
    ...[...Object.values(TILE_OPTIONAL_ART), ...Object.values(TILE_OPTIONAL_ALT_ART)].map((name) => `/sprites/${name}.png`),
    ...Object.values(FARM_STAGE_ART).flatMap((stages) => Object.values(stages!).map(artUrl)),
    ...Object.values(TILE_LEVEL_ART).flatMap((names) => names!.map(artUrl)),
    ...SITE_VARIANT_ART_NAMES.map(artUrl),
    TOWN_CENTER_MARKER_URL,
    DEER_FALLEN_URL,
    ...Object.values(WILDLIFE_OPTIONAL_URLS).flatMap((a) => [...a.walk, ...a.idle, ...a.run]),
    CAVALRY_CHARGE_URL,
    CHARGE_DUST_URL,
    ...Object.values(SIEGE_WRECK_URLS).flatMap((byKind) => Object.values(byKind) as string[]),
    ...Object.values(MOB_OPTIONAL_VARIANT_URLS).flatMap((v) => [...v!.walk, ...v!.action]),
    ...GOBLIN_RIDER_VET_URLS.walk,
    ...GOBLIN_RIDER_VET_URLS.action,
    ...WARLORD_URLS.walk,
    ...WARLORD_URLS.action,
    ...WARLORD_URLS.roar,
    WARLORD_URLS.idle,
    ...BOULDER_URLS,
    ...BOULDER_IMPACT_URLS,
    ...WALL_ART_URLS,
    ...MOAT_ART_URLS,
  ]);
  // De-duplicated: some images appear in more than one list (e.g. a frame reused across cycles),
  // and each URL should be requested once and resolve to one shared Texture.
  const loadedTextures = await Assets.load<Texture>(
    Array.from(
      new Set([
        ...colonistUrls,
        "/sprites/player.png",
        ...mobUrls,
        ...tileSpriteEntries.map(([, url]) => url),
        ...EXTRA_URLS,
        ...ANIM_URLS,
      ])
    )
  );
  for (const texture of Object.values(loadedTextures)) texture.source.scaleMode = "nearest";
  const optionalTextures = await optionalTexturesPromise;
  const COLONIST_TEXTURES = Object.fromEntries(
    COLONIST_KINDS.map((kind, i) => [kind, loadedTextures[colonistUrls[i]]])
  ) as Record<ColonistKind, Texture>;
  const PLAYER_TEXTURE = loadedTextures["/sprites/player.png"];
  const MOB_TEXTURES = Object.fromEntries(
    MOB_KINDS.map((kind, i) => [kind, loadedTextures[mobUrls[i]]])
  ) as Partial<Record<MobKind, Texture>>;
  // Keyed by TileType value; only types with sourced art have an entry.
  const TILE_TEXTURES = new Map<number, Texture>(
    tileSpriteEntries.map(([tile, url]) => [tile, loadedTextures[url]])
  );
  const TILE_TINT = new Map<number, number>(Object.entries(TILE_STANDIN_TINT).map(([tile, tint]) => [Number(tile), tint!]));
  for (const [tile, name] of Object.entries(TILE_OPTIONAL_ART)) {
    const texture = optionalTextures[`/sprites/${name}.png`];
    if (!texture) continue;
    TILE_TEXTURES.set(Number(tile), texture);
    TILE_TINT.delete(Number(tile));
  }
  // Only used where the tile's own optional art loaded too (an alt next to a tinted stand-in would clash).
  const TILE_ALT_TEXTURES = new Map<number, Texture>();
  for (const [tile, name] of Object.entries(TILE_OPTIONAL_ALT_ART)) {
    const texture = optionalTextures[`/sprites/${name}.png`];
    if (texture && !TILE_TINT.has(Number(tile))) TILE_ALT_TEXTURES.set(Number(tile), texture);
  }
  // Building tiers were generated as separate images and don't necessarily share proportions —
  // a busier/larger-canvas upgrade art can end up box-fit SMALLER than the tier before it, which
  // reads as the building shrinking when it upgrades. Force each tier's rendered height to be at
  // least as tall as the previous tier's (exceeding the normal max-box cap if it has to), so
  // upgrades only ever look the same size or bigger, never smaller.
  const TILE_TIER_FAMILIES: TileType[][] = [
    [TileType.House, TileType.BigHouse, TileType.HouseLevel2],
    [TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3],
    [TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3],
  ];
  const TILE_MIN_RENDER_HEIGHT = new Map<number, number>();
  for (const family of TILE_TIER_FAMILIES) {
    let runningMinHeight = 0;
    for (const tile of family) {
      const texture = TILE_TEXTURES.get(tile);
      if (!texture) continue;
      // tileSize isn't assigned yet this early in setup (it's only ever 32 regardless, set from
      // the same default `let tileSize = 32` declared below), so use the literal here.
      const naturalScale = Math.min(
        (32 * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width,
        (32 * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height
      ) * (BUILDING_VISUAL_SCALE[tile] ?? 1);
      const renderHeight = Math.max(naturalScale * texture.height, runningMinHeight);
      TILE_MIN_RENDER_HEIGHT.set(tile, renderHeight);
      runningMinHeight = renderHeight;
    }
  }
  const IRON_ORE_VARIANTS = [
    TILE_TEXTURES.get(TileType.IronOre)!,
    loadedTextures["/sprites/ironOre2.png"],
    loadedTextures["/sprites/ironOre3.png"],
  ];
  const GRASS_FLOOR_VARIANTS = [
    loadedTextures["/sprites/grassFloor1.png"],
    loadedTextures["/sprites/grassFloor2.png"],
  ];
  const HILLS_FLOOR_TEXTURE = loadedTextures["/sprites/hillsFloor.png"];
  const GATE_OPEN_TEXTURE = loadedTextures["/sprites/gateWoodOpen.png"];
  // Only complete 16-piece sets (see WALL_PIECE_SETS).
  const WALL_PIECE_TEXTURES = new Map<WallPieceSet, Texture[]>();
  for (const set of WALL_PIECE_SETS) {
    const pieces = Array.from({ length: 16 }, (_, mask) => optionalTextures[wallPieceUrl(set, mask)]);
    if (pieces.every(Boolean)) WALL_PIECE_TEXTURES.set(set, pieces);
  }
  const MOAT_PIECES = Array.from({ length: 16 }, (_, mask) => optionalTextures[moatPieceUrl(mask)]);
  const MOAT_PIECE_TEXTURES = MOAT_PIECES.every(Boolean) ? MOAT_PIECES : undefined;
  const SWAMP_FLOOR_TEXTURE = loadedTextures["/sprites/swampFloor.png"];
  const NATURE_DECOR_TEXTURES = NATURE_DECOR.map((d) => ({ texture: loadedTextures[d.url], height: d.height }));
  // tile -> FarmStage -> texture, only for stage art that loaded.
  const FARM_STAGE_TEXTURES = new Map<number, Map<number, Texture>>();
  for (const [tile, stages] of Object.entries(FARM_STAGE_ART)) {
    const byStage = new Map<number, Texture>();
    for (const [stage, name] of Object.entries(stages!)) {
      const texture = optionalTextures[artUrl(name!)];
      if (texture) byStage.set(Number(stage), texture);
    }
    FARM_STAGE_TEXTURES.set(Number(tile), byStage);
  }
  // tile -> [lv1, lv2, lv3] tier textures (undefined where the file is missing).
  const TILE_LEVEL_TEXTURES = new Map<number, (Texture | undefined)[]>(
    Object.entries(TILE_LEVEL_ART).map(([tile, names]) => [Number(tile), names!.map((n) => optionalTextures[artUrl(n)])])
  );
  // Same "never shrink on upgrade" rule as TILE_TIER_FAMILIES, per level of a leveled building.
  const TILE_LEVEL_MIN_HEIGHT = new Map<string, number>();
  for (const [tile, textures] of TILE_LEVEL_TEXTURES) {
    if (tile === TileType.TownCenter) continue;
    let runningMinHeight = 0;
    textures.forEach((texture, i) => {
      if (!texture) return;
      const naturalScale =
        Math.min((32 * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width, (32 * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height) *
        (BUILDING_VISUAL_SCALE[tile as TileType] ?? 1);
      runningMinHeight = Math.max(naturalScale * texture.height, runningMinHeight);
      TILE_LEVEL_MIN_HEIGHT.set(`${tile}:${i + 1}`, runningMinHeight);
    });
  }
  const TOWN_CENTER_MARKER_TEXTURE = optionalTextures[TOWN_CENTER_MARKER_URL];
  // Forts phase E: a level's wagon art only when its walk + idle frames all loaded (hit frames optional).
  const WAGON_TEXTURES = WAGON_ART_URLS.map((u) => {
    const walk = u.walk.map((x) => optionalTextures[x]);
    const idle = optionalTextures[u.idle];
    if (!idle || !walk.every(Boolean)) return null;
    const hit = u.hit.map((x) => optionalTextures[x]);
    return { walk, idle, hit: hit.every(Boolean) ? hit : null };
  });
  const DEER_FALLEN_TEXTURE = optionalTextures[DEER_FALLEN_URL];
  const TILE_ANIM_TEXTURES = new Map<number, { frames: Texture[]; frameMs: number; phased: boolean }>(
    Object.entries(TILE_ANIM).map(([tile, a]) => [
      Number(tile),
      { frames: a!.urls.map((u) => loadedTextures[u]), frameMs: a!.frameMs, phased: a!.phased },
    ])
  );
  const FIRE_FRAMES = TILE_ANIM_TEXTURES.get(TileType.PropCampfire)!.frames;
  const FIRE_FRAME_MS = TILE_ANIM_TEXTURES.get(TileType.PropCampfire)!.frameMs;
  const GRAVESTONE_TEXTURES = GRAVESTONE_URLS.map((url) => loadedTextures[url]);
  const BLOOD_TEXTURES = BLOOD_URLS.map((url) => loadedTextures[url]);
  const FX_TEXTURES = {
    slash: loadedTextures[FX_URLS.slash],
    spark: loadedTextures[FX_URLS.spark],
    poof: loadedTextures[FX_URLS.poof],
    arrow: loadedTextures[FX_URLS.arrow],
  };
  const FX_ANIM_TEXTURES = Object.fromEntries(
    Object.entries(FX_ANIM_URLS).map(([k, urls]) => [k, urls.map((u) => loadedTextures[u])])
  ) as Record<keyof typeof FX_ANIM_URLS, Texture[]>;
  const WOUND_TEXTURES = WOUND_URLS.map((u) => loadedTextures[u]);
  const WOUND_LARGE_TEXTURES = WOUND_LARGE_URLS.map((u) => loadedTextures[u]);
  const roadTexture = (name: string) => loadedTextures[`/sprites/${name}.png`];
  const HUNGER_SIGIL_TEXTURES = HUNGER_SIGIL_URLS.map((u) => (u ? loadedTextures[u] : undefined));
  const HUNGER_AURA_TEXTURES = HUNGER_AURA_URLS.map((u) => (u ? loadedTextures[u] : undefined));
  const BATTERED_POSE_TEXTURES = new Map<string, Texture>(
    Object.entries(BATTERED_POSE_URLS).flatMap(([kind, url]) => (loadedTextures[url] ? [[kind, loadedTextures[url]] as const] : []))
  );
  // Frames within one set come from one source sheet, so they share a pixel scale: one constant
  // `scale` per set (sized from the first walk frame) keeps the body the same size while weapons
  // swing out, instead of re-fitting every frame's canvas to a fixed height.
  interface AnimSet {
    walk: Texture[];
    action: Texture[];
    // Optional carry-home walk (hunter/forager); falls back to `walk`.
    carry?: Texture[];
    scale: number;
    refHeight: number;
  }
  // `renderSize` is the first walk frame's rendered height, or its longer side with `fitLongerSide`.
  function buildAnimSet(
    urls: { walk: string[]; action: string[] },
    renderSize: number,
    fitLongerSide = false,
    textures: Record<string, Texture> = loadedTextures
  ): AnimSet {
    const walk = urls.walk.map((u) => textures[u]);
    const refHeight = walk[0].height;
    const refSize = fitLongerSide ? Math.max(walk[0].width, refHeight) : refHeight;
    return { walk, action: urls.action.map((u) => textures[u]), scale: renderSize / refSize, refHeight };
  }
  // Feet sit on each frame's bottom edge; pin them to where the first walk frame's feet land when
  // that frame is center-anchored, so switching between rows of different heights doesn't hop.
  function showAnimFrame(sprite: Sprite, set: AnimSet, texture: Texture) {
    sprite.texture = texture;
    sprite.scale.set(set.scale);
    sprite.anchor.set(0.5, 1 - set.refHeight / (2 * texture.height));
  }
  // All art is drawn facing right; flip horizontally (negate scale.x, since every sprite is
  // center-anchored) when net horizontal movement is leftward. Tracked per entity id in one of
  // three category maps (colonist/mob/player ids aren't guaranteed disjoint, so a single shared
  // map risks one category's prune deleting another's live entry), independent of any animation
  // state so it applies equally to animated and single-pose sprites. A small dead zone (the same
  // >0.5px threshold used for walk-vs-idle elsewhere) avoids flicker from sub-pixel jitter while
  // genuinely stationary; moving purely vertically keeps the last facing instead of snapping back
  // to a default.
  type FacingMap = Map<string, { lastX: number; facingRight: boolean }>;
  const colonistFacing: FacingMap = new Map();
  const mobFacing: FacingMap = new Map();
  const playerFacing: FacingMap = new Map();
  function getFacing(map: FacingMap, id: string, x: number): boolean {
    const prev = map.get(id);
    if (!prev) {
      map.set(id, { lastX: x, facingRight: true });
      return true;
    }
    const dx = x - prev.lastX;
    prev.lastX = x;
    if (Math.abs(dx) > 0.5) prev.facingRight = dx > 0;
    return prev.facingRight;
  }
  function applyFacing(sprite: Sprite, facingRight: boolean) {
    sprite.scale.x = Math.abs(sprite.scale.x) * (facingRight ? 1 : -1);
  }
  function pruneFacing(map: FacingMap, seenIds: Set<string>) {
    for (const id of Array.from(map.keys())) {
      if (!seenIds.has(id)) map.delete(id);
    }
  }
  const COLONIST_ANIMS = Object.fromEntries(
    Object.entries(COLONIST_ANIM_URLS).map(([kind, urls]) => [
      kind,
      buildAnimSet(urls, COLONIST_KIND_HEIGHT[kind as ColonistKind] ?? COLONIST_SPRITE_HEIGHT),
    ])
  ) as Record<ColonistKind, AnimSet>;
  // Tint per kind while it still renders a stand-in set (cleared below when its own art loaded).
  const COLONIST_TINT = new Map<string, number>(Object.entries(COLONIST_STANDIN_TINT).map(([k, t]) => [k, t!]));
  for (const [kind, urls] of Object.entries(COLONIST_OPTIONAL_ANIM_URLS)) {
    if (![...urls!.walk, ...urls!.action].every((u) => optionalTextures[u])) continue;
    const walk = urls!.walk.map((u) => optionalTextures[u]);
    const action = urls!.action.map((u) => optionalTextures[u]);
    const carry = urls!.carry.every((u) => optionalTextures[u]) ? urls!.carry.map((u) => optionalTextures[u]) : undefined;
    COLONIST_ANIMS[kind as ColonistKind] = {
      walk,
      action,
      carry: carry && carry.length > 0 ? carry : undefined,
      scale: (urls!.height ?? COLONIST_KIND_HEIGHT[kind as ColonistKind] ?? COLONIST_SPRITE_HEIGHT) / walk[0].height,
      refHeight: walk[0].height,
    };
    COLONIST_TINT.delete(kind);
  }
  // The charge pose only goes with the rider's own set (not the player stand-in).
  const CAVALRY_CHARGE_TEXTURE = COLONIST_TINT.has("cavalry") ? undefined : optionalTextures[CAVALRY_CHARGE_URL];
  const CHARGE_DUST_TEXTURE = optionalTextures[CHARGE_DUST_URL];
  // Militia/Spearman/Pikeman were generated together on one shared sheet at one consistent body
  // scale, but Spearman/Pikeman's raised polearm pushes their own walk canvas well past their
  // actual body height (Pikeman's canvas is 254px tall - genuine pike art, not padding - versus
  // ~180px for Militia, who holds nothing overhead). Deriving `scale` from each kind's own canvas
  // height (buildAnimSet's normal behavior) under-scales those two kinds' bodies badly. Reuse
  // Militia's canvas height - the only un-inflated reference in the trio - for all three, so their
  // bodies render at a consistent size and the polearms are free to extend further above that
  // without shrinking the character holding them. `refHeight` (used for the feet-anchor math
  // across rows) is left untouched; only `scale` changes.
  const militiaRefHeight = COLONIST_ANIMS.militia.refHeight;
  for (const kind of ["militia", "spearman", "pikeman"] as ColonistKind[]) {
    COLONIST_ANIMS[kind].scale = COLONIST_SPRITE_HEIGHT / militiaRefHeight;
  }
  // kind -> [T1, T2, T3] armour-tier sets (undefined where a file is missing, or the base set is a stand-in).
  const COLONIST_TIER_ANIMS = new Map<string, (AnimSet | undefined)[]>(
    TIER_ART_KINDS.map((kind) => {
      const base = COLONIST_ANIMS[kind];
      return [
        kind,
        COLONIST_TIER_ANIM_URLS[kind].map((urls) => {
          if (COLONIST_TINT.has(kind) || ![...urls.walk, ...urls.action].every((u) => optionalTextures[u])) return undefined;
          const walk = urls.walk.map((u) => optionalTextures[u]);
          return { walk, action: urls.action.map((u) => optionalTextures[u]), scale: base.scale, refHeight: walk[0].height };
        }),
      ];
    })
  );
  const colonistTierSet = (c: ColonistSnapshot): AnimSet | undefined =>
    c.kind === "hero" || !c.armourTier ? undefined : COLONIST_TIER_ANIMS.get(c.kind)?.[c.armourTier - 1];
  const BLACKSMITH_FORGE_TEXTURES = BLACKSMITH_FORGE_URLS.every((u) => optionalTextures[u])
    ? BLACKSMITH_FORGE_URLS.map((u) => optionalTextures[u])
    : undefined;
  interface MobVariant {
    idle: Texture;
    idleScale: number;
    anim: AnimSet | null;
    // Ogre Warlord only: a standing pose shown instead of walk frame 0, and the roar frames.
    idlePose?: Texture;
    roar?: Texture[];
  }
  const MOB_VARIANTS = Object.fromEntries(
    Object.entries(MOB_VARIANT_URLS).map(([kind, variants]) => {
      const size = MOB_VISUALS[kind as MobKind].radius * MOB_SPRITE_SIZE_PER_RADIUS;
      return [
        kind,
        variants.map((v): MobVariant => {
          const anim =
            v.walk && v.action
              ? buildAnimSet({ walk: v.walk, action: v.action }, size, MOB_ANIM_FIT_LONGER_SIDE.has(kind as MobKind))
              : null;
          const idle = v.idle ? loadedTextures[v.idle] : anim!.walk[0];
          const idleScale = v.idle ? size / Math.max(idle.width, idle.height) : anim!.scale;
          return { idle, idleScale, anim };
        }),
      ];
    })
  ) as Partial<Record<MobKind, MobVariant[]>>;
  // Kinds whose MOB_OPTIONAL_VARIANT_URLS set loaded (they get their wreck art; stand-ins don't).
  const MOB_OWN_ART = new Set<string>();
  for (const [kind, urls] of Object.entries(MOB_OPTIONAL_VARIANT_URLS)) {
    if (![...urls!.walk, ...urls!.action].every((u) => optionalTextures[u])) continue;
    const size = MOB_VISUALS[kind as MobKind].radius * MOB_SPRITE_SIZE_PER_RADIUS;
    const anim = buildAnimSet(urls!, size, MOB_ANIM_FIT_LONGER_SIDE.has(kind as MobKind), optionalTextures);
    MOB_VARIANTS[kind as MobKind] = [{ idle: anim.walk[0], idleScale: anim.scale, anim }];
    MOB_OWN_ART.add(kind);
  }
  const GOBLIN_RIDER_VET: MobVariant | null =
    MOB_OWN_ART.has("goblinRider") && [...GOBLIN_RIDER_VET_URLS.walk, ...GOBLIN_RIDER_VET_URLS.action].every((u) => optionalTextures[u])
      ? (() => {
          const anim = buildAnimSet(GOBLIN_RIDER_VET_URLS, MOB_VISUALS.goblinRider.radius * MOB_SPRITE_SIZE_PER_RADIUS, true, optionalTextures);
          return { idle: anim.walk[0], idleScale: anim.scale, anim };
        })()
      : null;
  const SIEGE_WRECK_TEXTURES = {
    colonist: Object.fromEntries(Object.entries(SIEGE_WRECK_URLS.colonist).map(([k, u]) => [k, optionalTextures[u!]])),
    mob: Object.fromEntries(Object.entries(SIEGE_WRECK_URLS.mob).map(([k, u]) => [k, optionalTextures[u!]])),
  } as Record<"colonist" | "mob", Partial<Record<string, Texture>>>;
  const WARLORD_VARIANT: MobVariant | null = [...WARLORD_URLS.walk, ...WARLORD_URLS.action, ...WARLORD_URLS.roar, WARLORD_URLS.idle].every(
    (u) => optionalTextures[u]
  )
    ? (() => {
        const anim = buildAnimSet(WARLORD_URLS, WARLORD_ANIM_SIZE, false, optionalTextures);
        return {
          idle: anim.walk[0],
          idleScale: anim.scale,
          anim,
          idlePose: optionalTextures[WARLORD_URLS.idle],
          roar: WARLORD_URLS.roar.map((u) => optionalTextures[u]),
        };
      })()
    : null;
  // Per Warlord: when the current roar ends and when the next may start (performance.now() ms).
  const warlordRoar = new Map<string, { until: number; next: number; startedAt: number }>();
  const BOULDER_TEXTURES = BOULDER_URLS.map((u) => optionalTextures[u]).filter((t): t is Texture => !!t);
  const BOULDER_IMPACT_TEXTURES = BOULDER_IMPACT_URLS.every((u) => optionalTextures[u])
    ? BOULDER_IMPACT_URLS.map((u) => optionalTextures[u])
    : null;
  // Ticks (snapshots, ~20/s) each animation frame holds before advancing.
  const ANIM_TICKS_PER_FRAME = 4;
  type AnimMode = "walk" | "action" | "carry" | null;
  interface AnimState {
    mode: AnimMode;
    frame: number;
    ticksInFrame: number;
    lastX: number;
    lastY: number;
  }
  // Advances `anim` one snapshot tick; returns the frame to show, or null for the static pose.
  function stepAnim(anim: AnimState, set: AnimSet, mode: AnimMode): Texture | null {
    if (mode !== anim.mode) {
      anim.mode = mode;
      anim.frame = 0;
      anim.ticksInFrame = 0;
    }
    if (!mode) return null;
    const sequence = mode === "walk" ? set.walk : mode === "carry" ? (set.carry ?? set.walk) : set.action;
    anim.ticksInFrame++;
    if (anim.ticksInFrame >= ANIM_TICKS_PER_FRAME) {
      anim.ticksInFrame = 0;
      anim.frame = (anim.frame + 1) % sequence.length;
    }
    return sequence[anim.frame];
  }
  const colonistAnim = new Map<string, AnimState>();
  const mobAnim = new Map<string, AnimState>();
  // Null (static player.png fallback) if any player frame failed to load.
  const PLAYER_ANIM: AnimSet | null = [...PLAYER_ANIM_URLS.walk, ...PLAYER_ANIM_URLS.action].every(
    (u) => loadedTextures[u]
  )
    ? buildAnimSet(PLAYER_ANIM_URLS, PLAYER_SPRITE_HEIGHT)
    : null;
  // The lance thrust plays once per attack (each frame held ANIM_TICKS_PER_FRAME snapshots).
  const PLAYER_ATTACK_ANIM_TICKS = PLAYER_ANIM_URLS.action.length * ANIM_TICKS_PER_FRAME;
  const playerAnim = new Map<string, AnimState & { attackTicks: number }>();
  function triggerPlayerAttackAnim(id: string) {
    const anim = playerAnim.get(id);
    // Local keypress and the server's hit effect both trigger it; don't restart a thrust that's
    // still on its first frame.
    if (!anim || anim.attackTicks > PLAYER_ATTACK_ANIM_TICKS - ANIM_TICKS_PER_FRAME) return;
    anim.attackTicks = PLAYER_ATTACK_ANIM_TICKS;
    anim.mode = null; // restart the thrust from frame 0 even mid-swing
  }
  // Shared (stateless) program; each player sprite gets its own Filter + uniforms.
  // highp: the HSV helpers' 1e-10 epsilon underflows to 0 at mediump on some GPUs -> NaN on greys.
  const playerRecolorProgram = GlProgram.from({
    vertex: defaultFilterVert,
    fragment: PLAYER_RECOLOR_FRAG,
    name: "player-recolor-filter",
    preferredFragmentPrecision: "highp",
  });

  const buildRequirementsEl = document.getElementById("build-requirements")!;
  const buildPanel = document.getElementById("build-panel")!;
  const buildPanelToggle = document.getElementById("build-panel-toggle")!;
  buildPanelToggle.addEventListener("click", () => {
    buildPanel.classList.toggle("collapsed");
    buildPanelToggle.classList.toggle("panel-open", !buildPanel.classList.contains("collapsed"));
    buildPanelToggle.blur();
  });

  // Strategy mode phase 1: the zoom is variable (TACTICAL_ZOOM unless the strategy camera is active).
  let camZoom = TACTICAL_ZOOM;
  const strategyCam = new StrategyCamera();
  // Village life phase 5: the adventure camera (adventure.ts) while the strategy camera is off; a start in strategy
  // view waits for the first frame with the rider.
  const advCam = new AdventureCamera();
  let pendingStartStrategy = false;
  const homeZoom = () => (adventurePrefs.on ? advCam.zoom : TACTICAL_ZOOM);
  // LOD band drawn this frame ("tactical" whenever the strategy camera is inactive).
  let strategyBand: LodBand = "tactical";
  // Map band unit dots and the regiment banners (strategy mode only; see strategy/lod.ts).
  const strategyDots = new Graphics();
  const strategyBanners = new StrategyBanners();
  const worldLayer = new Container();
  worldLayer.scale.set(camZoom);
  app.stage.addChild(worldLayer);

  let myId: string | null = null;
  let tileSize = 32;
  let worldTilesX = 25;
  let worldTilesY = 25;
  // Every standing Town Center, from the latest snapshot (minimap markers, HP bars, game over).
  let latestTownCenters: TownCenterSnapshot[] = [];
  // Camp hearths: tile indices of the standing ones (snapshot `hearths`), for right-click attack orders
  // and minimap markers (explored tiles only).
  let latestHearths = new Set<number>();
  // This world's Castle Ruin centre (welcome); the minimap marks it once that tile is explored.
  let castleRuinTile: { x: number; y: number } | null = null;
  let tiles: number[] = [];
  // Biome per tile from `welcome`; static for the life of a world.
  let biomes: number[] = [];
  // World streaming phase 4: a chunked welcome (streamed world) sends tiles / biomes per 32x32 chunk on
  // request; until a chunk arrives its tiles read Empty / Plains, its floor is not built and the minimap shows
  // the welcome's downscaled summary (cells = one MinimapClass per f x f tiles, cellSeen = any tile explored).
  let streamed: { chunkTiles: number; chunksX: number; chunksY: number; f: number; cw: number; ch: number; cells: Uint8Array; cellSeen: Uint8Array } | null = null;
  let chunkLoaded = new Uint8Array(0);
  const chunkRequestedAt = new Map<number, number>();
  let chunkRequestAt = 0;
  const chunkOfTile = (tx: number, ty: number) =>
    streamed ? Math.floor(ty / streamed.chunkTiles) * streamed.chunksX + Math.floor(tx / streamed.chunkTiles) : 0;

  const playerSprites = new Map<string, EntityVisual>();
  const colonistSprites = new Map<string, EntityVisual>();
  const mobSprites = new Map<string, EntityVisual>();

  // Grass floor art, one Sprite per tile, alternating two textures for visual variety. Bottom of
  // the stack: everything else (Town Center, buildings, entities) draws over it.
  const floorSpriteLayer = new Container();
  worldLayer.addChild(floorSpriteLayer);
  const floorSprites: Sprite[] = [];
  // Strategy mode Map band: the minimap's 1 px/tile static canvas stretched over the world (nearest
  // scaling) stands in for the floor, decor and tile layers, which are hidden at that zoom.
  const strategicMapSprite = new Sprite(Texture.EMPTY);
  strategicMapSprite.visible = false;
  worldLayer.addChild(strategicMapSprite);

  // Cosmetic nature scatter (tall grass / flowers / bushes), keyed by tile index: over the floor,
  // under Town Center / buildings / entities. Hidden whenever its tile isn't Empty.
  const decorSpriteLayer = new Container();
  worldLayer.addChild(decorSpriteLayer);
  const decorSprites = new Map<number, Sprite>();
  // Also in decorSpriteLayer (over the floor, under buildings and every unit), keyed by position +
  // variant since the server sends no id.
  const gravestoneSprites = new Map<string, Sprite>();

  // Blood stains: in decorSpriteLayer's bottom slot (under nature scatter and gravestones), oldest
  // first. A death stain is stamped whenever a new gravestone appears (the server drops one for
  // every death), except for the stones already standing when we join.
  const bloodSprites: Sprite[] = [];
  let bloodOnNewGravestones = false;
  function stampBlood(x: number, y: number, variants: number[], size: number) {
    const texture = BLOOD_TEXTURES[variants[Math.floor(Math.random() * variants.length)]];
    if (!texture) return;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    const scale = size / Math.max(texture.width, texture.height);
    sprite.scale.set(Math.random() < 0.5 ? -scale : scale, scale);
    sprite.position.set(x + (Math.random() - 0.5) * 6, y + 6 + (Math.random() - 0.5) * 4);
    sprite.alpha = BLOOD_ALPHA;
    decorSpriteLayer.addChildAt(sprite, 0);
    bloodSprites.push(sprite);
    if (bloodSprites.length > BLOOD_MAX) bloodSprites.shift()!.destroy();
  }
  function clearBlood() {
    for (const sprite of bloodSprites) sprite.destroy();
    bloodSprites.length = 0;
  }

  function syncGravestones(snapshot: GravestoneSnapshot[]) {
    const seen = new Set<string>();
    for (const g of snapshot) {
      const key = `${g.x},${g.y},${g.variant}`;
      seen.add(key);
      if (gravestoneSprites.has(key)) continue;
      if (bloodOnNewGravestones) stampBlood(g.x, g.y, BLOOD_DEATH_VARIANTS, BLOOD_DEATH_SIZE);
      const texture = GRAVESTONE_TEXTURES[g.variant];
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(GRAVESTONE_HEIGHT / texture.height);
      sprite.position.set(g.x, g.y + GRAVESTONE_HEIGHT / 2);
      decorSpriteLayer.addChild(sprite);
      gravestoneSprites.set(key, sprite);
    }
    bloodOnNewGravestones = true;
    for (const [key, sprite] of Array.from(gravestoneSprites)) {
      if (seen.has(key)) continue;
      sprite.destroy();
      gravestoneSprites.delete(key);
    }
  }

  // Building/environment art (Town Center included), one Sprite per occupied tile (keyed by tile
  // index). Sits over the floor and under the night overlay and every entity layer.
  const tileSpriteLayer = new Container();
  tileSpriteLayer.sortableChildren = true;
  worldLayer.addChild(tileSpriteLayer);
  const tileSprites = new Map<number, Sprite>();
  // Tile index -> tile type, for slots currently showing a looping TILE_ANIM.
  const animatedTiles = new Map<number, number>();
  function tileAnimTexture(index: number, tile: number, now: number): Texture | undefined {
    if (tile === TileType.Blacksmith) {
      if (!BLACKSMITH_FORGE_TEXTURES || !forgeBusy.has(index)) return undefined;
      const frames = BLACKSMITH_FORGE_TEXTURES;
      return frames[(Math.floor(now / BLACKSMITH_FORGE_FRAME_MS) + stableHash(String(index))) % frames.length];
    }
    const anim = TILE_ANIM_TEXTURES.get(tile);
    if (!anim) return undefined;
    const phase = anim.phased ? stableHash(String(index)) : 0;
    return anim.frames[(Math.floor(now / anim.frameMs) + phase) % anim.frames.length];
  }
  // A welcome (join or world restart) wipes every entity at once; that isn't a mass death.
  let suppressDeathPoofs = true;
  // Server art state per tile index, from the snapshot: farm stage (FarmStage), building level (>1
  // only), and construction sites. Each sync re-draws only the tiles whose value changed.
  let farmStages = new Map<number, number>();
  let buildingLevels = new Map<number, number>();
  // Blacksmith tile indices forging right now (snapshot `forgeBusy`).
  let forgeBusy = new Set<number>();
  interface SiteView {
    target: number;
    progress: number;
    upgrade: boolean;
    builders: number;
  }
  let constructionSites = new Map<number, SiteView>();
  // Damaged buildings (snapshot `damagedBuildings`): tile index -> HP permille. See syncDamagedBuildings.
  let damagedBuildings = new Map<number, number>();
  // Walls & gates: snapshot `gates`, tile index -> GATE_FLAG_* bits (see syncGates).
  let gateFlags = new Map<number, number>();
  // Forts phase A: NPC-owned tiles (snapshot `siteTiles`, only sent when it changed): tile index -> site
  // number. Drawn tinted (FOREIGN_TINT), red on the minimap; right-click with soldiers = attack it.
  let siteOwners = new Map<number, number>();
  const FOREIGN_TINT = 0xffa090;
  // Forts phase B: explored forts (snapshot `sites`, sent with siteTiles): minimap flags by faction.
  let fortMarkers: SiteSnapshot[] = [];
  // Forts phase C: owner-map numbers of sighted human settlements, and their (pale, friendlier) tile tint.
  const humanSiteNums = new Set<number>();
  const HUMAN_SITE_TINT = 0xdfe6f5;
  // Forts phase C: neutral human settlements fly a white flag (red while hostile).
  const FORT_FLAG_COLOR: Record<SiteFaction, string> = { bandit: "#d35400", orc: "#6b8e23", human: "#f4f4f0" };
  // Forts phase D: this clan's relation to each sighted settlement (snapshot `relations`, by site number);
  // a settlement's minimap flag takes its tier's colour.
  let siteRelations = new Map<number, SiteRelationSnapshot>();
  const RELATION_TIER_COLOR: Record<RelationTier, string> = {
    hostile: "#c0392b", wary: "#e67e22", neutral: "#f4f4f0", friendly: "#8fd18a", allied: "#4a9bd8", vassal: "#f1c40f",
  };
  // Clans (snapshot clanId / clans / clanTiles, only while 2+ clans play): this player's clan, every clan's
  // colour, and the clan of every player building. Another clan's buildings are tinted with its colour
  // and its units get a ring in it; neither can be selected or ordered.
  let myClan = 0;
  let clanColors = new Map<number, number>();
  let clanNames = new Map<number, string>();
  let clanTiles = new Map<number, number>();
  const isForeignClanIndex = (index: number) => {
    const owner = clanTiles.get(index);
    return owner !== undefined && owner !== myClan;
  };
  // Halfway between the clan colour and white, so the building art still reads.
  const clanTint = (clan: number) => {
    const c = clanColors.get(clan) ?? 0xffffff;
    const mix = (shift: number) => Math.round((((c >> shift) & 0xff) + 0xff) / 2) << shift;
    return mix(16) | mix(8) | mix(0);
  };
  // True from a welcome until its first snapshot has been applied: state diffs then are a world
  // load, not events, so they make no sound.
  let soundSuppressed = true;

  const indexToTile = (index: number) => ({ tx: index % worldTilesX, ty: Math.floor(index / worldTilesX) });

  function syncFarmStages(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + FARM_STAGE_SNAPSHOT_STRIDE <= flat.length; i += FARM_STAGE_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const changed = new Set<number>();
    for (const [i, stage] of farmStages) if (next.get(i) !== stage) changed.add(i);
    for (const [i, stage] of next) if (farmStages.get(i) !== stage) changed.add(i);
    const prev = farmStages;
    farmStages = next;
    for (const index of changed) {
      const tile = tiles[index];
      if (FARM_STAGE_ART[tile as TileType] === undefined) continue;
      // Ripe or harvested grain. Not on the first snapshot after a welcome (that's every ripe plot at once).
      const ripeChanged = (prev.get(index) === FarmStage.Ripe) !== (next.get(index) === FarmStage.Ripe);
      if (tile === TileType.FarmPlot && !soundSuppressed && ripeChanged) {
        const c = indexToTile(index);
        sound.play("farm_work", { x: c.tx * tileSize + tileSize / 2, y: c.ty * tileSize + tileSize / 2 });
      }
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tile);
    }
  }

  function syncBuildingLevels(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + BUILDING_LEVEL_SNAPSHOT_STRIDE <= flat.length; i += BUILDING_LEVEL_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const changed = new Set<number>();
    for (const [i, level] of buildingLevels) if (next.get(i) !== level) changed.add(i);
    for (const [i, level] of next) if (buildingLevels.get(i) !== level) changed.add(i);
    buildingLevels = next;
    for (const index of changed) {
      if (TILE_LEVEL_ART[tiles[index] as TileType] === undefined) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  function syncForgeBusy(flat: number[] | undefined) {
    const next = new Set(flat ?? []);
    const changed = [...[...forgeBusy].filter((i) => !next.has(i)), ...[...next].filter((i) => !forgeBusy.has(i))];
    forgeBusy = next;
    for (const index of changed) {
      if (tiles[index] !== TileType.Blacksmith) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  // Scaffolding + progress bars over every site (and a small marker over buildings being upgraded).
  const siteOverlay = new Graphics();
  function syncConstructionSites(flat: number[]) {
    const next = new Map<number, SiteView>();
    for (let i = 0; i + CONSTRUCTION_SNAPSHOT_STRIDE <= flat.length; i += CONSTRUCTION_SNAPSHOT_STRIDE) {
      next.set(flat[i], { target: flat[i + 1], progress: flat[i + 2] / 1000, upgrade: flat[i + 3] === 1, builders: flat[i + 4] });
    }
    const prev = constructionSites;
    constructionSites = next;
    for (const [index, site] of next) {
      const old = prev.get(index);
      if (!old || old.target !== site.target) {
        const { tx, ty } = indexToTile(index);
        if (tiles[index] === TileType.ConstructionSite) setTileSprite(tx, ty, tiles[index]);
      }
    }
    for (const [index, site] of prev) {
      if (next.has(index) || !site.upgrade || soundSuppressed) continue;
      // An in-place upgrade finished (or was dropped): the upgrade sparkle, if the building still stands.
      if (tiles[index] === TileType.Empty) continue;
      const { tx, ty } = indexToTile(index);
      const c = tileCenter(tx, ty);
      spawnFxAnim("upgrade", c.x, c.y + tileSize / 2, 700);
    }
    siteOverlay.clear();
    for (const [index, site] of next) {
      const { tx, ty } = indexToTile(index);
      const x = tx * tileSize;
      const y = ty * tileSize;
      if (!site.upgrade) {
        // Scaffold: two poles and cross braces over the faded building.
        const top = y - tileSize * 0.6;
        siteOverlay
          .moveTo(x + 4, y + tileSize - 2).lineTo(x + 4, top)
          .moveTo(x + tileSize - 4, y + tileSize - 2).lineTo(x + tileSize - 4, top)
          .moveTo(x + 4, top + 6).lineTo(x + tileSize - 4, top + 6)
          .moveTo(x + 4, y + tileSize * 0.45).lineTo(x + tileSize - 4, y + tileSize * 0.45)
          .moveTo(x + 4, top + 6).lineTo(x + tileSize - 4, y + tileSize * 0.45)
          .stroke({ width: 2, color: 0x6b4423, alpha: 0.9 });
      } else {
        // "Upgrading" marker: a small up-arrow badge.
        const cx = x + tileSize - 6;
        const cy = y - 4;
        siteOverlay.circle(cx, cy, 6).fill({ color: 0x2b1a0c, alpha: 0.85 });
        siteOverlay.poly([cx, cy - 4, cx + 4, cy + 1, cx + 1.5, cy + 1, cx + 1.5, cy + 4, cx - 1.5, cy + 4, cx - 1.5, cy + 1, cx - 4, cy + 1]).fill(0xf1c40f);
      }
      const barY = y + tileSize + 2;
      siteOverlay.rect(x + 2, barY, tileSize - 4, 4).fill({ color: 0x2b1a0c, alpha: 0.8 });
      siteOverlay.rect(x + 2, barY, (tileSize - 4) * site.progress, 4).fill(site.upgrade ? 0xf1c40f : 0xe0b468);
    }
  }

  // Walls & gates: redraw a gate whose open / overrun look changed.
  function syncSiteTiles(flat: number[] | undefined) {
    if (!flat) return;
    const next = new Map<number, number>();
    for (let i = 0; i + SITE_TILE_SNAPSHOT_STRIDE <= flat.length; i += SITE_TILE_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const prev = siteOwners;
    siteOwners = next;
    for (const index of new Set([...prev.keys(), ...next.keys()])) {
      if (prev.get(index) === next.get(index)) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
      paintMinimapTile(index);
    }
  }

  // Forts phase C: remember which site numbers are human settlements (their tiles get HUMAN_SITE_TINT);
  // repaint the tiles of a settlement the first time it shows up.
  let fortMarkersKey = "";
  function syncFortMarkers(list: SiteSnapshot[]) {
    fortMarkers = list;
    // Batch 2: faction-dependent fort art (siteVariantTexture) redraws once the site list is known / changes.
    const key = list.map((f) => `${f.num}:${f.faction}:${f.keepX},${f.keepY}`).join("|");
    if (key !== fortMarkersKey) {
      fortMarkersKey = key;
      if (tiles.length > 0) {
        for (const f of list) setTileSprite(f.keepX, f.keepY, tiles[f.keepY * worldTilesX + f.keepX]);
        for (const index of siteOwners.keys()) {
          const t = tiles[index];
          if (t === TileType.Tent || t === TileType.Rubble || t === TileType.RuinedKeep) {
            const { tx, ty } = indexToTile(index);
            setTileSprite(tx, ty, t);
          }
        }
      }
    }
    const fresh = new Set<number>();
    for (const f of list) if (f.faction === "human" && f.num !== undefined && !humanSiteNums.has(f.num)) fresh.add(f.num);
    if (fresh.size === 0) return;
    for (const n of fresh) humanSiteNums.add(n);
    for (const [index, num] of siteOwners) {
      if (!fresh.has(num)) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  function syncClanTiles(flat: number[] | undefined) {
    if (!flat) return;
    const next = new Map<number, number>();
    for (let i = 0; i + CLAN_TILE_SNAPSHOT_STRIDE <= flat.length; i += CLAN_TILE_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const prev = clanTiles;
    clanTiles = next;
    for (const index of new Set([...prev.keys(), ...next.keys()])) {
      if (prev.get(index) === next.get(index)) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  function syncGates(flat: number[] | undefined) {
    const next = new Map<number, number>();
    const list = flat ?? [];
    for (let i = 0; i + GATE_SNAPSHOT_STRIDE <= list.length; i += GATE_SNAPSHOT_STRIDE) next.set(list[i], list[i + 1]);
    const shown = (f: number | undefined) => (f ?? 0) & (GATE_FLAG_OPEN | GATE_FLAG_OVERRUN);
    const prev = gateFlags;
    gateFlags = next;
    for (const index of new Set([...prev.keys(), ...next.keys()])) {
      if (shown(prev.get(index)) === shown(next.get(index)) || (tiles[index] !== TileType.Gate && tiles[index] !== TileType.Drawbridge)) continue;
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }

  // ---- Damaged buildings: flames, soot and an HP bar ----
  // Fire tier by HP permille: 1 below 75% (small flames + soot), 2 below 50% (medium flames + smoke
  // puffs), 3 below 25% (large flames). Overlays are pooled (one flame sprite + one HP bar per damaged
  // building, at most MAX_FIRE_OVERLAYS) and animated by the shared tile clock below.
  function fireTier(permille: number): number {
    return permille < 250 ? 3 : permille < 500 ? 2 : permille < 750 ? 1 : 0;
  }
  interface FireOverlay {
    flame: Sprite;
    bar: Graphics;
    tier: number;
    phase: number;
    nextSmokeAt: number;
  }
  const fireOverlays = new Map<number, FireOverlay>();
  const firePool: FireOverlay[] = [];
  function releaseFire(index: number, o: FireOverlay, restoreArt: boolean) {
    o.flame.visible = false;
    o.bar.visible = false;
    fireOverlays.delete(index);
    firePool.push(o);
    if (restoreArt && index < tiles.length) {
      const { tx, ty } = indexToTile(index);
      setTileSprite(tx, ty, tiles[index]);
    }
  }
  function syncDamagedBuildings(flat: number[]) {
    const next = new Map<number, number>();
    for (let i = 0; i + DAMAGED_BUILDING_SNAPSHOT_STRIDE <= flat.length; i += DAMAGED_BUILDING_SNAPSHOT_STRIDE) next.set(flat[i], flat[i + 1]);
    const prev = damagedBuildings;
    damagedBuildings = next;
    for (const [index, o] of fireOverlays) if (!next.has(index)) releaseFire(index, o, true);
    for (const [index, permille] of next) {
      let o = fireOverlays.get(index);
      if (o && prev.get(index) === permille) continue;
      if (!o) {
        if (fireOverlays.size >= MAX_FIRE_OVERLAYS) continue;
        o = firePool.pop();
        if (!o) {
          const flame = new Sprite(FIRE_FRAMES[0]);
          flame.anchor.set(0.5, 1);
          tileSpriteLayer.addChild(flame);
          const bar = new Graphics();
          worldLayer.addChild(bar);
          o = { flame, bar, tier: -1, phase: 0, nextSmokeAt: 0 };
        }
        o.tier = -1;
        o.phase = index % FIRE_FRAMES.length;
        fireOverlays.set(index, o);
      }
      const { tx, ty } = indexToTile(index);
      const tier = fireTier(permille);
      if (tier !== o.tier) {
        o.tier = tier;
        // A camp hearth is already a fire: its damage shows on the HP bar only (no second flame growing on top).
        o.flame.visible = tier > 0 && tiles[index] !== TileType.PropCampfire;
        o.flame.scale.set(FIRE_FLAME_WIDTH[tier] / FIRE_FRAMES[0].width);
        o.flame.position.set(tx * tileSize + tileSize / 2, (ty + 1) * tileSize - tileSize * 0.3);
        o.flame.zIndex = index + 0.5;
        // Soot tint on (or off) the building art.
        setTileSprite(tx, ty, tiles[index]);
      }
      // Town Centers keep their own always-on bar (syncTownCenterBars).
      o.bar.visible = tiles[index] !== TileType.TownCenter;
      o.bar.position.set(tx * tileSize + tileSize / 2, ty * tileSize - 8);
      drawHpBar(o.bar, permille, 1000);
    }
  }
  // Welcome: drop every overlay (the world's tile art is redrawn from scratch anyway).
  function clearFires() {
    for (const [index, o] of fireOverlays) releaseFire(index, o, false);
    damagedBuildings = new Map();
  }

  const nightOverlay = new Graphics();
  nightOverlay.alpha = 0;
  worldLayer.addChild(nightOverlay);
  // Strategy mode fog (only while the strategy camera is active; the tactical view stays unfogged).
  const strategyFog = new StrategyFog();
  worldLayer.addChild(strategyFog.sprite);

  // One HP bar per standing Town Center, keyed by tile index, just above its art.
  const townCenterHpBars = new Map<number, Graphics>();
  function syncTownCenterBars(list: TownCenterSnapshot[]) {
    const seen = new Set<number>();
    for (const tc of list) {
      const index = tc.y * worldTilesX + tc.x;
      seen.add(index);
      let bar = townCenterHpBars.get(index);
      if (!bar) {
        bar = new Graphics();
        worldLayer.addChild(bar);
        townCenterHpBars.set(index, bar);
      }
      bar.position.set(tc.x * tileSize + tileSize / 2, tc.y * tileSize + tileSize / 2 - townCenterArtAbove(tc.level) - 6);
      drawHpBar(bar, tc.hp, tc.maxHp);
    }
    for (const [index, bar] of Array.from(townCenterHpBars)) {
      if (seen.has(index)) continue;
      bar.destroy();
      townCenterHpBars.delete(index);
    }
  }

  const cursorHighlight = new Graphics();
  // Pale plaza ghost under the cursor while the Town Center tool is selected.
  const placementGhost = new Sprite(TOWN_CENTER_MARKER_TEXTURE ?? Texture.EMPTY);
  placementGhost.visible = false;
  placementGhost.alpha = 0.85;
  // Town Center: the plaza marker. Road tools: a faded road piece filling the hovered tile.
  function configurePlacementGhost(tool: TileType) {
    if (isRoadTile(tool)) {
      const texture = roadTexture(tool === TileType.Road ? "road-isolated" : COBBLE_FILL);
      placementGhost.texture = texture;
      placementGhost.anchor.set(0.5);
      placementGhost.scale.set(32 / texture.width);
      placementGhost.alpha = 0.55;
    } else if (TOWN_CENTER_MARKER_TEXTURE) {
      placementGhost.texture = TOWN_CENTER_MARKER_TEXTURE;
      placementGhost.anchor.set(TOWN_CENTER_LEVEL_FIT[0].anchor.x, TOWN_CENTER_LEVEL_FIT[0].anchor.y);
      placementGhost.scale.set((32 * TOWN_CENTER_LEVEL_FIT[0].widthTiles) / TOWN_CENTER_MARKER_TEXTURE.width);
      placementGhost.alpha = 0.85;
    }
  }
  configurePlacementGhost(TileType.TownCenter);

  // World-space overlays: parented to worldLayer so they follow the camera automatically.
  const selectionRings = new Graphics();
  const roleRings = new Graphics();
  // Forts phase E: the own clan's trader wagons' remaining routes, coloured by danger.
  const wagonRoutes = new Graphics();
  const dragBox = new Graphics();

  // Multi-tile footprints (shared FOOTPRINT_BY_TILE): derived from the tiles alone. The anchor (top-left)
  // draws the art across the block; BuildingPart tiles draw nothing and stand for their anchor in clicks.
  function footTile(x: number, y: number): number {
    return x < 0 || y < 0 || x >= worldTilesX || y >= worldTilesY ? -1 : (tiles[y * worldTilesX + x] ?? TileType.Empty);
  }
  function footSize(x: number, y: number): Footprint | null {
    const t = footTile(x, y);
    const target = t === TileType.ConstructionSite ? constructionSites.get(y * worldTilesX + x)?.target : t;
    return target === undefined ? null : (FOOTPRINT_BY_TILE[target as TileType] ?? null);
  }
  function placedFootprintClient(x: number, y: number): Footprint {
    return placedFootprintAt(footTile, footSize, x, y);
  }
  // A part tile's anchor (any other tile is its own).
  function anchorOfClient(x: number, y: number): { x: number; y: number } {
    if (footTile(x, y) !== TileType.BuildingPart) return { x, y };
    return footprintAnchorOf(footTile, footSize, x, y) ?? { x, y };
  }

  // Single source of truth for tileSpriteLayer: shows `tile`'s art at (tx, ty), or clears the
  // slot back to bare floor if it has none (Empty, anything unmapped). A construction site draws the
  // building it will become, faded; leveled buildings and farms pick their tier / stage art.
  // The faction of the fort / settlement that owns this tile (or whose keep stands on it), if known.
  function siteFactionAt(index: number, tx: number, ty: number): SiteFaction | undefined {
    const num = siteOwners.get(index);
    return fortMarkers.find((f) => (num !== undefined && f.num === num) || (f.keepX === tx && f.keepY === ty))?.faction;
  }
  // Batch 2 per-faction fort art (SITE_KEEP_RUIN_ART etc.), or undefined for the usual tile art.
  function siteVariantTexture(index: number, tx: number, ty: number, tile: number): Texture | undefined {
    const hash = tx * 7 + ty * 13;
    if (tile === TileType.RuinedKeep || tile === TileType.Tent || tile === TileType.Rubble) {
      const faction = siteFactionAt(index, tx, ty);
      const name =
        tile === TileType.RuinedKeep
          ? SITE_KEEP_RUIN_ART[faction ?? "bandit"]
          : tile === TileType.Tent
            ? SITE_TENT_ART[faction ?? "bandit"][hash % 2]
            : SITE_RUBBLE_ART[faction === "human" || faction === undefined ? "stone" : "wood"][hash % 3];
      return optionalTextures[artUrl(name)];
    }
    return undefined;
  }
  function setTileSprite(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    const site = tile === TileType.ConstructionSite ? constructionSites.get(index) : undefined;
    // Rebuilding a razed fort keep (rebuildKeep: a Town Center site on the keep tile) shows the scaffold.
    const scaffold =
      site && site.target === TileType.TownCenter && fortMarkers.some((f) => f.keepX === tx && f.keepY === ty)
        ? optionalTextures[artUrl(KEEP_SCAFFOLD_ART)]
        : undefined;
    const siteArt = scaffold ?? (site ? undefined : siteVariantTexture(index, tx, ty, tile));
    const artTile = site ? site.target : tile;
    const level = site ? 1 : (buildingLevels.get(index) ?? 1);
    const stage = farmStages.get(index);
    const stageTexture = !site && stage !== undefined ? FARM_STAGE_TEXTURES.get(tile)?.get(stage) : undefined;
    const levelTexture = TILE_LEVEL_TEXTURES.get(artTile)?.[level - 1];
    const forging =
      tile === TileType.Blacksmith && BLACKSMITH_FORGE_TEXTURES !== undefined && forgeBusy.has(index) && (level === 1 || !levelTexture);
    const gateOpen = tile === TileType.Gate && ((gateFlags.get(index) ?? 0) & (GATE_FLAG_OPEN | GATE_FLAG_OVERRUN)) !== 0;
    const wallArt = wallArtFor(tx, ty, artTile, !!site);
    const moatArt = moatArtFor(tx, ty, artTile, !!site);
    const texture = tile === TileType.BuildingPart
      ? undefined
      : moatArt
      ? moatArt
      : wallArt
      ? wallArt
      : gateOpen
      ? GATE_OPEN_TEXTURE
      : tile === TileType.ConstructionSite && !site
        ? TILE_TEXTURES.get(TileType.Wall) // until the snapshot names the target
        : tile === TileType.IronOre
          ? IRON_ORE_VARIANTS[(tx * 7 + ty * 13) % IRON_ORE_VARIANTS.length]
          : forging
            ? tileAnimTexture(index, tile, performance.now())
            : (siteArt ??
            stageTexture ??
            levelTexture ??
            (TILE_ALT_TEXTURES.has(tile) && (tx * 7 + ty * 13) % 2 === 1
              ? TILE_ALT_TEXTURES.get(tile)
              : (tileAnimTexture(index, tile, performance.now()) ?? TILE_TEXTURES.get(artTile))));
    if (TILE_ANIM_TEXTURES.has(tile) || forging) animatedTiles.set(index, tile);
    else animatedTiles.delete(index);
    let sprite = tileSprites.get(index);
    if (!texture) {
      if (sprite) {
        sprite.destroy();
        tileSprites.delete(index);
      }
      return;
    }
    if (sprite) {
      sprite.texture = texture;
    } else {
      sprite = new Sprite(texture);
      tileSpriteLayer.addChild(sprite);
      tileSprites.set(index, sprite);
    }
    sprite.rotation = 0;
    sprite.alpha = tile === TileType.ConstructionSite && !scaffold && !moatArt ? CONSTRUCTION_ALPHA : 1;
    sprite.tint =
      tile === TileType.ConstructionSite && !scaffold && !moatArt
        ? CONSTRUCTION_TINT
        : siteArt || stageTexture || levelTexture || moatArt
          ? 0xffffff
          : (TILE_TINT.get(tile) ?? 0xffffff);
    if (fireTier(damagedBuildings.get(index) ?? 1000) > 0 && tile !== TileType.PropCampfire) sprite.tint = SOOT_TINT;
    else if (siteOwners.has(index) && tile !== TileType.ConstructionSite) sprite.tint = humanSiteNums.has(siteOwners.get(index)!) ? HUMAN_SITE_TINT : FOREIGN_TINT;
    else if (isForeignClanIndex(index) && tile !== TileType.ConstructionSite) sprite.tint = clanTint(clanTiles.get(index)!);
    if (artTile === TileType.TownCenter && !scaffold) {
      const fit = levelTexture ? TOWN_CENTER_LEVEL_FIT[level - 1] : { widthTiles: TOWN_CENTER_WIDTH_TILES, anchor: TOWN_CENTER_ANCHOR };
      sprite.anchor.set(fit.anchor.x, fit.anchor.y);
      sprite.scale.set((tileSize * fit.widthTiles) / texture.width);
      sprite.position.set(tx * tileSize + tileSize / 2, ty * tileSize + tileSize / 2);
      sprite.zIndex = index;
      return;
    }
    if (isRoadTile(tile)) {
      // Autotiled ground: centered so it can rotate, flush on its tile, under all other tile art.
      const [roadArt, turns] = roadArtFor(tx, ty, tile);
      sprite.texture = roadArt;
      sprite.anchor.set(0.5);
      sprite.rotation = (turns * Math.PI) / 2;
      sprite.scale.set(tileSize / roadArt.width, tileSize / roadArt.height);
      sprite.position.set(tx * tileSize + tileSize / 2, ty * tileSize + tileSize / 2);
      sprite.zIndex = -1;
      return;
    }
    sprite.anchor.set(0.5, 1);
    const fitTile = scaffold ? TileType.RuinedKeep : artTile;
    const fillTile = TILE_SPRITE_FILL_TILE.has(fitTile);
    const naturalScale = fillTile
      ? Math.max(tileSize / texture.width, tileSize / texture.height)
      : Math.min(
          (tileSize * TILE_SPRITE_MAX_WIDTH_TILES) / texture.width,
          (tileSize * TILE_SPRITE_MAX_HEIGHT_TILES) / texture.height
        ) * (TILE_SPRITE_SIZE_FACTOR[fitTile as TileType] ?? 1) * (BUILDING_VISUAL_SCALE[fitTile as TileType] ?? 1);
    const minHeight = scaffold ? undefined : levelTexture ? TILE_LEVEL_MIN_HEIGHT.get(`${artTile}:${level}`) : TILE_MIN_RENDER_HEIGHT.get(artTile);
    const scale = wallArt
      ? tileSize / WALL_ART_PX_PER_TILE
      : minHeight
        ? Math.max(naturalScale, minHeight / texture.height)
        : naturalScale;
    sprite.scale.set(scale);
    sprite.position.set(tx * tileSize + tileSize / 2, (ty + 1) * tileSize);
    // Row-major index: lower rows draw in front of the rows above them; x breaks ties. Flush
    // ground-like tiles (water) go under all other tile art.
    sprite.zIndex = fillTile ? -1 : index;
    // A complete multi-tile block: the same art scaled up to span it, bottom-centred on the block and
    // sorted with its bottom-right tile. Legacy 1x1 pastures (no parts) draw as before.
    const fp = placedFootprintClient(tx, ty);
    if (fp.w > 1 || fp.h > 1) {
      sprite.scale.set(scale * Math.min(fp.w, fp.h));
      sprite.position.set(tx * tileSize + (fp.w * tileSize) / 2, (ty + fp.h) * tileSize);
      sprite.zIndex = (ty + fp.h - 1) * worldTilesX + tx + fp.w - 1;
    }
  }

  const isWallTile = (t: number) => t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate;
  const isMoatTile = (t: number) => t === TileType.Moat || t === TileType.Drawbridge;

  // Moat piece / drawbridge art (SPRITES.md #72-73) for (tx, ty), or undefined for the stand-in. A moat
  // being dug shows the dig site; a drawbridge is lowered while its gate is open (or overrun).
  function moatArtFor(tx: number, ty: number, artTile: number, site: boolean): Texture | undefined {
    if (!isMoatTile(artTile)) return undefined;
    if (site) return artTile === TileType.Moat ? optionalTextures[MOAT_DIGGING_URL] : undefined;
    const n = tileAt(tx, ty - 1);
    const e = tileAt(tx + 1, ty);
    const s = tileAt(tx, ty + 1);
    const w = tileAt(tx - 1, ty);
    if (artTile === TileType.Moat) {
      return MOAT_PIECE_TEXTURES?.[(isMoatTile(n) ? 1 : 0) | (isMoatTile(e) ? 2 : 0) | (isMoatTile(s) ? 4 : 0) | (isMoatTile(w) ? 8 : 0)];
    }
    const index = ty * worldTilesX + tx;
    const orient = isMoatTile(n) || isMoatTile(s) ? "H" : "V";
    const flags = gateFlags.get(index) ?? 0;
    const damaged = (damagedBuildings.get(index) ?? 1000) < WALL_DAMAGED_PERMILLE;
    const state: DrawbridgeArtState = flags & (GATE_FLAG_OPEN | GATE_FLAG_OVERRUN) ? "Lowered" : damaged ? "Damaged" : "Raised";
    return optionalTextures[drawbridgeArtUrl(orient, state)];
  }

  // Connector piece / oriented gate art (SPRITES.md #59-62) for a wall or gate at (tx, ty), or
  // undefined to use the single-sprite fallback. Sites draw undamaged.
  function wallArtFor(tx: number, ty: number, artTile: number, site: boolean): Texture | undefined {
    if (!isWallTile(artTile)) return undefined;
    const index = ty * worldTilesX + tx;
    const damaged = !site && (damagedBuildings.get(index) ?? 1000) < WALL_DAMAGED_PERMILLE;
    const n = tileAt(tx, ty - 1);
    const e = tileAt(tx + 1, ty);
    const s = tileAt(tx, ty + 1);
    const w = tileAt(tx - 1, ty);
    if (artTile === TileType.Gate) {
      // E/W walls make a horizontal gate, N/S (only) a vertical one; stone when stone walls outnumber wood.
      const orient = isWallTile(e) || isWallTile(w) ? "H" : isWallTile(n) || isWallTile(s) ? "V" : "H";
      const around = [n, e, s, w];
      const stone = around.filter((t) => t === TileType.StoneWall).length > around.filter((t) => t === TileType.Wall).length;
      const flags = site ? 0 : (gateFlags.get(index) ?? 0);
      const state: GateArtState =
        flags & GATE_FLAG_OVERRUN ? "Overrun" : flags & GATE_FLAG_OPEN ? "Open" : damaged ? "Damaged" : "Closed";
      return optionalTextures[gateArtUrl(stone ? "Stone" : "Wood", orient, state)];
    }
    const wood = artTile === TileType.Wall;
    const pieces =
      (damaged ? WALL_PIECE_TEXTURES.get(wood ? "woodWallDmg" : "stoneWallDmg") : undefined) ??
      WALL_PIECE_TEXTURES.get(wood ? "woodWall" : "stoneWall");
    if (!pieces) return undefined;
    const joins = (t: number) => t === artTile || t === TileType.Gate;
    return pieces[(joins(n) ? 1 : 0) | (joins(e) ? 2 : 0) | (joins(s) ? 4 : 0) | (joins(w) ? 8 : 0)];
  }

  function isRoadAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= worldTilesX || ty >= worldTilesY) return false;
    return isRoadTile(tiles[ty * worldTilesX + tx] as TileType);
  }

  // [texture, clockwise quarter turns] for the road at (tx, ty) from its orthogonal road neighbours.
  function roadArtFor(tx: number, ty: number, tile: number): [Texture, number] {
    const mask =
      (isRoadAt(tx, ty - 1) ? 1 : 0) | (isRoadAt(tx + 1, ty) ? 2 : 0) | (isRoadAt(tx, ty + 1) ? 4 : 0) | (isRoadAt(tx - 1, ty) ? 8 : 0);
    if (tile === TileType.CobbleRoad) {
      if (mask === 5 || mask === 1 || mask === 4) return [roadTexture(COBBLE_STRAIGHT), 0];
      if (mask === 10 || mask === 2 || mask === 8) return [roadTexture(COBBLE_STRAIGHT), 1];
      return [roadTexture(COBBLE_FILL), 0];
    }
    const [name, turns] = ROAD_AUTOTILE[mask];
    return [roadTexture(name), turns];
  }

  // Pixels from a Town Center's tile center up to the top of its art (for its HP bar).
  function townCenterArtAbove(level: number): number {
    const levelTexture = TILE_LEVEL_TEXTURES.get(TileType.TownCenter)?.[level - 1];
    const texture = levelTexture ?? TILE_TEXTURES.get(TileType.TownCenter)!;
    const fit = levelTexture ? TOWN_CENTER_LEVEL_FIT[level - 1] : { widthTiles: TOWN_CENTER_WIDTH_TILES, anchor: TOWN_CENTER_ANCHOR };
    return ((tileSize * fit.widthTiles) / texture.width) * texture.height * fit.anchor.y;
  }

  // Floor never changes per-tile, so this only needs to run on a full map (re)load, not per edit.
  // A 512 map has 262k floor tiles, so sprites are built per 16x16-tile chunk, lazily the first time
  // the camera sees it (updateFloorChunks, every frame), and chunks off screen are hidden.
  const FLOOR_CHUNK_TILES = 16;
  const FLOOR_CHUNK_KEEP = 256;
  const floorChunks = new Map<number, Container>();
  function setFloorSprites() {
    for (const s of floorSprites) s.destroy();
    floorSprites.length = 0;
    for (const c of floorChunks.values()) c.destroy({ children: true });
    floorChunks.clear();
  }
  function buildFloorChunk(cx: number, cy: number): Container {
    const chunk = new Container();
    const x0 = cx * FLOOR_CHUNK_TILES;
    const y0 = cy * FLOOR_CHUNK_TILES;
    for (let x = x0; x < Math.min(worldTilesX, x0 + FLOOR_CHUNK_TILES); x++) {
      for (let y = y0; y < Math.min(worldTilesY, y0 + FLOOR_CHUNK_TILES); y++) {
        const biome = biomes[y * worldTilesX + x] ?? Biome.Plains;
        const texture =
          biome === Biome.Hills
            ? HILLS_FLOOR_TEXTURE
            : biome === Biome.Swamp
            ? SWAMP_FLOOR_TEXTURE
            : GRASS_FLOOR_VARIANTS[(x + y) % GRASS_FLOOR_VARIANTS.length];
        const sprite = new Sprite(texture);
        sprite.anchor.set(0, 0);
        sprite.width = tileSize;
        sprite.height = tileSize;
        sprite.position.set(x * tileSize, y * tileSize);
        chunk.addChild(sprite);
      }
    }
    floorSpriteLayer.addChild(chunk);
    return chunk;
  }
  function updateFloorChunks() {
    // Map band: the strategic map sprite replaces the floor (building every chunk of a 512 map would
    // make ~262k sprites).
    floorSpriteLayer.visible = strategyBand !== "map";
    if (!floorSpriteLayer.visible) return;
    const span = FLOOR_CHUNK_TILES * tileSize;
    const left = Math.floor(-worldLayer.position.x / camZoom / span) - 1;
    const right = Math.floor((app.screen.width - worldLayer.position.x) / camZoom / span) + 1;
    const top = Math.floor(-worldLayer.position.y / camZoom / span) - 1;
    const bottom = Math.floor((app.screen.height - worldLayer.position.y) / camZoom / span) + 1;
    const chunksX = Math.ceil(worldTilesX / FLOOR_CHUNK_TILES);
    const chunksY = Math.ceil(worldTilesY / FLOOR_CHUNK_TILES);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = cy * chunksX + cx;
        const visible = cx >= left && cx <= right && cy >= top && cy <= bottom;
        let chunk = floorChunks.get(key);
        if (!chunk) {
          if (!visible) continue;
          // World streaming phase 4: not before its stream chunk's biomes have arrived.
          if (streamed && !chunkLoaded[chunkOfTile(cx * FLOOR_CHUNK_TILES, cy * FLOOR_CHUNK_TILES)]) continue;
          chunk = buildFloorChunk(cx, cy);
          floorChunks.set(key, chunk);
        }
        // Strategy panning can visit the whole map: past FLOOR_CHUNK_KEEP built chunks, off-screen ones
        // are freed (rebuilt if seen again) so a 512 map never holds all ~262k floor sprites.
        if (!visible && floorChunks.size > FLOOR_CHUNK_KEEP) {
          chunk.destroy({ children: true });
          floorChunks.delete(key);
          continue;
        }
        chunk.visible = visible;
      }
    }
  }

  // Like the floor, only rebuilt on a full map (re)load; per-tile edits just toggle visibility
  // (setTileLocal) so a decoration never shows through a building, water, ruin or prop.
  function setDecorSprites() {
    for (const s of decorSprites.values()) s.destroy();
    decorSprites.clear();
    // World streaming phase 4: chunked worlds add decor per arriving chunk (addDecorIn).
    if (!streamed) addDecorIn(0, 0, worldTilesX, worldTilesY);
  }
  function addDecorIn(x0: number, y0: number, w: number, h: number) {
    for (let x = x0; x < x0 + w; x++) {
      for (let y = y0; y < y0 + h; y++) {
        const index = y * worldTilesX + x;
        if (decorSprites.has(index)) continue;
        if ((biomes[index] ?? Biome.Plains) !== Biome.Plains) continue;
        if (tileHash01(x, y, 1) * NATURE_DECOR_ONE_IN >= 1) continue;
        const variant = NATURE_DECOR_TEXTURES[Math.floor(tileHash01(x, y, 2) * NATURE_DECOR_TEXTURES.length)];
        const sprite = new Sprite(variant.texture);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(variant.height / variant.texture.height);
        // Small stable offset inside the tile so the scatter doesn't sit on a visible grid.
        const offsetX = (tileHash01(x, y, 3) - 0.5) * tileSize * 0.4;
        const offsetY = (tileHash01(x, y, 4) - 0.5) * tileSize * 0.3;
        sprite.position.set(x * tileSize + tileSize / 2 + offsetX, (y + 0.85) * tileSize + offsetY);
        sprite.visible = (tiles[index] ?? TileType.Empty) === TileType.Empty;
        decorSpriteLayer.addChild(sprite);
        decorSprites.set(index, sprite);
      }
    }
  }

  // ---- Ambient critters (see WILDLIFE) ----
  // Frogs sit and hop around swamp and water edges; crows perch anywhere and flap off to a new perch. Each critter only ever targets a tile
  // that's Empty right now, so it doesn't stroll into a building that already exists; one ticker
  // moves all of them and one shared clock picks their animation frames.
  type CritterKind = keyof typeof WILDLIFE;
  interface Critter {
    kind: CritterKind;
    sprite: Sprite;
    homeX: number;
    homeY: number;
    x: number;
    y: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    moving: boolean;
    moveMs: number;
    elapsedMs: number;
    restMs: number;
    phase: number;
  }
  const WILDLIFE_TEXTURES = {
    crow: WILDLIFE.crow.frames.map((u) => loadedTextures[u]),
    frog: WILDLIFE.frog.frames.map((u) => loadedTextures[u]),
  };
  const critters: Critter[] = [];
  const tileAt = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= worldTilesX || ty >= worldTilesY ? -1 : (tiles[ty * worldTilesX + tx] ?? TileType.Empty);
  function nearWater(tx: number, ty: number): boolean {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (tileAt(tx + dx, ty + dy) === TileType.Water) return true;
    return false;
  }
  function critterTileOk(kind: CritterKind, tx: number, ty: number): boolean {
    if (tileAt(tx, ty) !== TileType.Empty) return false;
    const biome = biomes[ty * worldTilesX + tx] ?? Biome.Plains;
    if (kind === "frog") return biome === Biome.Swamp || nearWater(tx, ty);
    return true;
  }
  // A random eligible tile within `radius` tiles of (cx, cy), or null after a few misses.
  function pickCritterSpot(kind: CritterKind, cx: number, cy: number, radius: number): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const tx = Math.floor(cx / tileSize + (Math.random() * 2 - 1) * radius);
      const ty = Math.floor(cy / tileSize + (Math.random() * 2 - 1) * radius);
      if (!critterTileOk(kind, tx, ty)) continue;
      return { x: (tx + 0.2 + Math.random() * 0.6) * tileSize, y: (ty + 0.3 + Math.random() * 0.6) * tileSize };
    }
    return null;
  }
  const critterZ = (x: number, y: number) =>
    Math.floor(y / tileSize) * worldTilesX + Math.floor(x / tileSize) + 0.5;
  function spawnWildlife() {
    for (const c of critters) c.sprite.destroy();
    critters.length = 0;
    const eligible: Record<CritterKind, number[]> = { crow: [], frog: [] };
    for (let ty = 0; ty < worldTilesY; ty++) {
      for (let tx = 0; tx < worldTilesX; tx++) {
        for (const kind of ["crow", "frog"] as CritterKind[]) {
          if (critterTileOk(kind, tx, ty)) eligible[kind].push(ty * worldTilesX + tx);
        }
      }
    }
    for (const kind of ["crow", "frog"] as CritterKind[]) {
      const spots = eligible[kind];
      const def = WILDLIFE[kind];
      const count = Math.min(def.max, Math.floor(spots.length / def.tilesPer));
      const textures = WILDLIFE_TEXTURES[kind];
      if (!textures.every(Boolean)) continue;
      for (let i = 0; i < count; i++) {
        const index = spots[Math.floor(Math.random() * spots.length)];
        const x = ((index % worldTilesX) + 0.5) * tileSize;
        const y = (Math.floor(index / worldTilesX) + 0.7) * tileSize;
        const sprite = new Sprite(textures[0]);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(def.size / textures[0].width);
        sprite.position.set(x, y);
        // Depth-sorted among the tile art like a prop on the tile it stands on (see setTileSprite's
        // row-major zIndex), so a frog behind a cottage is hidden by it. Updated only on a tile change.
        sprite.zIndex = critterZ(x, y);
        tileSpriteLayer.addChild(sprite);
        critters.push({
          kind, sprite, homeX: x, homeY: y, x, y, fromX: x, fromY: y, toX: x, toY: y,
          moving: false, moveMs: 0, elapsedMs: 0, restMs: Math.random() * 6000, phase: Math.floor(Math.random() * 4),
        });
      }
    }
  }
  // Wander radius (tiles) around home, travel speed (px/s) and rest range (ms) per kind.
  const CRITTER_MOVE = {
    crow: { radius: 7, speed: 70, restMin: 4000, restMax: 14000 },
    frog: { radius: 2, speed: 40, restMin: 1500, restMax: 6000 },
  };
  const CRITTER_FRAME_MS = 160;
  app.ticker.add((ticker) => {
    if (critters.length === 0) return;
    const dt = ticker.deltaMS;
    const clock = Math.floor(performance.now() / CRITTER_FRAME_MS);
    for (const c of critters) {
      const move = CRITTER_MOVE[c.kind];
      if (!c.moving) {
        c.restMs -= dt;
        if (c.restMs <= 0) {
          const spot = pickCritterSpot(c.kind, c.homeX, c.homeY, move.radius);
          if (spot) {
            c.fromX = c.x;
            c.fromY = c.y;
            c.toX = spot.x;
            c.toY = spot.y;
            c.moveMs = Math.max(250, (Math.hypot(spot.x - c.x, spot.y - c.y) / move.speed) * 1000);
            c.elapsedMs = 0;
            c.moving = true;
          } else {
            c.restMs = move.restMin;
          }
        }
      } else {
        c.elapsedMs += dt;
        const t = Math.min(1, c.elapsedMs / c.moveMs);
        c.x = c.fromX + (c.toX - c.fromX) * t;
        c.y = c.fromY + (c.toY - c.fromY) * t;
        if (Math.abs(c.toX - c.fromX) > 0.5) {
          c.sprite.scale.x = Math.abs(c.sprite.scale.x) * (c.toX > c.fromX ? 1 : -1);
        }
        if (t >= 1) {
          c.moving = false;
          c.restMs = move.restMin + Math.random() * (move.restMax - move.restMin);
        }
      }
      // Crows fly and frogs hop: lift the sprite along an arc while moving (purely visual).
      const t = c.moving ? Math.min(1, c.elapsedMs / c.moveMs) : 0;
      const lift = c.kind === "crow" ? Math.sin(Math.PI * t) * 14 : c.kind === "frog" ? Math.sin(Math.PI * t) * 5 : 0;
      c.sprite.position.set(c.x, c.y - lift);
      // A crow in flight passes over everything on the ground.
      const z = c.kind === "crow" && c.moving ? Number.MAX_SAFE_INTEGER : critterZ(c.x, c.y);
      if (z !== c.sprite.zIndex) c.sprite.zIndex = z;
      const f = clock + c.phase;
      if (c.kind === "crow") {
        // Perched: frame 0. Flying: flap through frames 1-3.
        c.sprite.texture = c.moving ? WILDLIFE_TEXTURES.crow[1 + (f % 3)] : WILDLIFE_TEXTURES.crow[0];
      } else {
        // Sit (0), leap (1) mid-hop, land (2) at the very end.
        c.sprite.texture = WILDLIFE_TEXTURES.frog[!c.moving ? 0 : t < 0.85 ? 1 : 2];
      }
    }
  });

  // ---- Server wildlife (huntable game; see WILDLIFE_ART) ----
  interface WildlifeSet {
    walk: Texture[];
    idle: Texture[];
    run: Texture[];
    tint: number;
  }
  const deerWalkTextures = DEER_WALK_URLS.map((u) => loadedTextures[u]);
  const deerGrazeTextures = DEER_GRAZE_URLS.map((u) => loadedTextures[u]);
  const loadedAll = (urls: string[]) => urls.length > 0 && urls.every((u) => optionalTextures[u]);
  const WILDLIFE_SETS = Object.fromEntries(
    WILDLIFE_KINDS.map((kind) => {
      const opt = WILDLIFE_OPTIONAL_URLS[kind];
      const ownWalk = loadedAll(opt.walk);
      const walk = ownWalk ? opt.walk.map((u) => optionalTextures[u]) : deerWalkTextures;
      const idle = loadedAll(opt.idle)
        ? opt.idle.map((u) => optionalTextures[u])
        : ownWalk
          ? [walk[0]]
          : deerGrazeTextures;
      const run = loadedAll(opt.run) ? opt.run.map((u) => optionalTextures[u]) : walk;
      // Stand-in deer frames are tinted per kind; a kind's own art is drawn as is.
      const tint = ownWalk || kind === "deer" ? 0xffffff : WILDLIFE_ART[kind].tint;
      return [kind, { walk, idle, run, tint }];
    })
  ) as Record<WildlifeKind, WildlifeSet>;
  const wildlifeSprites = new Map<number, { sprite: Sprite; kind: WildlifeKind; lastX: number; phase: number }>();
  // `flat` is the snapshot's flattened list (WILDLIFE_SNAPSHOT_STRIDE numbers per animal). An animal
  // that disappears was killed (nothing else removes one), so it leaves a small blood stain.
  // Prisoners (snapshot `hearths`: [index, permille, prisoners, guarded]): stand-in captives at camp hearths, the
  // villager art tinted grey with a rope loop at the wrists (SPRITES.md "Prisoner / captive" is pending). At most
  // CAPTIVES_SHOWN per camp; a fallen camp (permille -1) shows the freed ones still waiting for beds, untied.
  const CAPTIVES_SHOWN = 6;
  const CAPTIVE_TINT = 0x9aa0ac;
  const captiveSprites = new Map<string, Container>();
  function syncCaptives(flat: number[]) {
    const seen = new Set<string>();
    for (let i = 0; i + HEARTH_SNAPSHOT_STRIDE <= flat.length; i += HEARTH_SNAPSHOT_STRIDE) {
      const index = flat[i];
      const waiting = flat[i + 1] < 0;
      const n = Math.min(CAPTIVES_SHOWN, flat[i + 2] ?? 0);
      const hx = (index % worldTilesX) + 0.5;
      const hy = Math.floor(index / worldTilesX) + 0.5;
      for (let k = 0; k < n; k++) {
        const key = `${index}:${k}:${waiting ? "w" : "c"}`;
        seen.add(key);
        if (captiveSprites.has(key)) continue;
        // A ring around the fire, 1.3 tiles out, evenly spaced from a per-camp start angle.
        const a = (index % 7) * 0.9 + (k / Math.max(n, 1)) * Math.PI * 2;
        const x = (hx + Math.cos(a) * 1.3) * tileSize;
        const y = (hy + Math.sin(a) * 1.3) * tileSize;
        const box = new Container();
        const tex = COLONIST_TEXTURES.villager;
        const body = new Sprite(tex);
        body.anchor.set(0.5, 1);
        body.scale.set(COLONIST_SPRITE_HEIGHT / tex.height);
        body.tint = waiting ? 0xd8d0c0 : CAPTIVE_TINT;
        box.addChild(body);
        if (!waiting) {
          const rope = new Graphics();
          rope.ellipse(0, -COLONIST_SPRITE_HEIGHT * 0.42, 5, 2.5).stroke({ width: 1.5, color: 0x5a3a1a });
          box.addChild(rope);
        }
        box.position.set(x, y + tileSize * 0.2);
        box.zIndex = critterZ(x, y);
        tileSpriteLayer.addChild(box);
        captiveSprites.set(key, box);
      }
    }
    for (const [key, box] of captiveSprites) {
      if (seen.has(key)) continue;
      box.destroy({ children: true });
      captiveSprites.delete(key);
    }
  }

  function syncWildlife(flat: number[]) {
    const seen = new Set<number>();
    const now = performance.now();
    for (let i = 0; i + WILDLIFE_SNAPSHOT_STRIDE <= flat.length; i += WILDLIFE_SNAPSHOT_STRIDE) {
      const id = flat[i];
      const kind = WILDLIFE_KINDS[flat[i + 1]] ?? "deer";
      const x = flat[i + 2];
      const y = flat[i + 3];
      const state = flat[i + 4] as WildlifeState;
      seen.add(id);
      const set = WILDLIFE_SETS[kind];
      let entry = wildlifeSprites.get(id);
      if (!entry) {
        const sprite = new Sprite(set.walk[0]);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(WILDLIFE_ART[kind].size / set.walk[0].width);
        sprite.tint = set.tint;
        tileSpriteLayer.addChild(sprite);
        entry = { sprite, kind, lastX: x, phase: Math.floor(Math.random() * 4) };
        wildlifeSprites.set(id, entry);
      }
      const { sprite } = entry;
      // Feet a little below the server position (the tile-centre point), like the old critters.
      sprite.position.set(x, y + tileSize * 0.2);
      const z = critterZ(x, y);
      if (z !== sprite.zIndex) sprite.zIndex = z;
      const running = state === WildlifeState.Flee || state === WildlifeState.Charge;
      const frames = running ? set.run : state === WildlifeState.Walk ? set.walk : set.idle;
      const frameMs = running ? WILDLIFE_RUN_FRAME_MS : state === WildlifeState.Walk ? WILDLIFE_FRAME_MS : WILDLIFE_FRAME_MS * 4;
      sprite.texture = frames[(Math.floor(now / frameMs) + entry.phase) % frames.length];
      const scale = WILDLIFE_ART[kind].size / set.walk[0].width;
      if (Math.abs(x - entry.lastX) > 0.5) sprite.scale.x = x > entry.lastX ? scale : -scale;
      entry.lastX = x;
    }
    for (const [id, entry] of Array.from(wildlifeSprites)) {
      if (seen.has(id)) continue;
      const x = entry.sprite.position.x;
      const y = entry.sprite.position.y;
      const stain = () => stampBlood(x, y - tileSize * 0.2, BLOOD_HIT_VARIANTS, BLOOD_HIT_SIZE);
      // A killed deer lies where it fell for a moment, then leaves its stain (other game: just the stain).
      if (entry.kind === "deer" && DEER_FALLEN_TEXTURE) spawnFallenDeer(x, y, entry.sprite.scale.x < 0, stain);
      else stain();
      entry.sprite.destroy();
      wildlifeSprites.delete(id);
    }
  }
  function spawnFallenDeer(x: number, y: number, facingLeft: boolean, onEnd: () => void) {
    const texture = DEER_FALLEN_TEXTURE!;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    const scale = (WILDLIFE_ART.deer.size * 1.15) / texture.width;
    sprite.scale.set(facingLeft ? -scale : scale, scale);
    sprite.position.set(x, y);
    decorSpriteLayer.addChild(sprite);
    activeEffects.push({
      sprite,
      startedAt: performance.now(),
      durationMs: DEER_FALLEN_MS,
      update: (s, t) => {
        s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
      },
      onEnd,
    });
  }
  function clearWildlifeSprites() {
    for (const entry of wildlifeSprites.values()) entry.sprite.destroy();
    wildlifeSprites.clear();
  }

  // Full-map path (welcome, incl. restart).
  function redrawGrid() {
    setFloorSprites();
    setDecorSprites();
    if (streamed) {
      // Every tile reads Empty until its chunk arrives: only clear what the previous world drew.
      for (const index of [...tileSprites.keys()]) {
        if (index < worldTilesX * worldTilesY) setTileSprite(index % worldTilesX, Math.floor(index / worldTilesX), TileType.Empty);
      }
    } else {
      for (let x = 0; x < worldTilesX; x++) {
        for (let y = 0; y < worldTilesY; y++) {
          setTileSprite(x, y, tiles[y * worldTilesX + x] ?? TileType.Empty);
        }
      }
    }
    // Drop slots past the end of the map in case a new welcome shrank it.
    for (const [index, sprite] of tileSprites) {
      if (index >= worldTilesX * worldTilesY) {
        sprite.destroy();
        tileSprites.delete(index);
        animatedTiles.delete(index);
      }
    }
    nightOverlay.clear();
    nightOverlay.rect(0, 0, worldTilesX * tileSize, worldTilesY * tileSize).fill(0x0a0a2a);
    spawnWildlife();
  }

  function setTileLocal(tx: number, ty: number, tile: number) {
    const index = ty * worldTilesX + tx;
    tiles[index] = tile;
    setTileSprite(tx, ty, tile);
    const decor = decorSprites.get(index);
    if (decor) decor.visible = tile === TileType.Empty;
    // Neighbouring roads re-pick their autotile piece (this tile may have become / stopped being road),
    // and neighbouring walls / gates their connector piece / orientation.
    for (const [nx, ny] of [[tx, ty - 1], [tx + 1, ty], [tx, ty + 1], [tx - 1, ty]]) {
      if (isRoadAt(nx, ny) || isWallTile(tileAt(nx, ny)) || isMoatTile(tileAt(nx, ny))) setTileSprite(nx, ny, tiles[ny * worldTilesX + nx]);
    }
    // A part tile appearing / going away re-fits the multi-tile art of the anchors up / left of it.
    for (const [nx, ny] of [[tx - 1, ty], [tx, ty - 1], [tx - 1, ty - 1]]) {
      if (footSize(nx, ny)) setTileSprite(nx, ny, tiles[ny * worldTilesX + nx]);
    }
  }

  // Last ratio drawn per bar: every snapshot (20/s) upserts every entity, and with raid waves that can
  // be hundreds of mobs, so only rebuild a bar's geometry when its fill actually changed.
  const hpBarRatio = new WeakMap<Graphics, number>();
  function drawHpBar(bar: Graphics, hp: number, maxHp: number, fill = 0x3bd16f) {
    const width = 24;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    if (hpBarRatio.get(bar) === ratio) return;
    hpBarRatio.set(bar, ratio);
    bar.clear();
    bar.rect(-width / 2, 0, width, height).fill(0x550000);
    bar.rect(-width / 2, 0, width * ratio, height).fill(fill);
  }

  function ensureVisual(
    map: Map<string, EntityVisual>,
    id: string,
    create: () => Container
  ): EntityVisual {
    let entry = map.get(id);
    if (!entry) {
      const sprite = create();
      const hpBar = new Graphics();
      worldLayer.addChild(sprite);
      worldLayer.addChild(hpBar);
      entry = { sprite, hpBar };
      map.set(id, entry);
    }
    return entry;
  }

  function destroyVisual(map: Map<string, EntityVisual>, id: string) {
    const entry = map.get(id);
    if (entry) {
      entry.sprite.destroy();
      entry.hpBar.destroy();
      entry.marker?.destroy();
      entry.wound?.destroy();
      entry.aura?.destroy();
      entry.sigil?.destroy();
      entry.markLabel?.destroy();
      entry.bossLabel?.destroy();
      entry.heroLabel?.destroy();
      map.delete(id);
    }
  }

  // ---- Strategy mode phase 5: snapshot interpolation (players, colonists, mobs) ----
  // Each part of a visual is placed by the snapshot syncs at the snapshot position; between snapshots it is
  // drawn shifted back along the move, so it glides from where it was drawn to the new position over the
  // measured snapshot interval (50 ms at 1x, 100 / 200 ms in slow motion, when the server only sends
  // stepped ticks). Undo the shift before the syncs, re-arm after them, shift every frame.
  const INTERP_SNAP_TILES = 3;
  let interpSnapAt = 0;
  let interpIntervalMs = 1000 / TICK_RATE;
  const interpMaps = [playerSprites, colonistSprites, mobSprites];

  function shiftVisual(e: EntityVisual, dx: number, dy: number) {
    if (dx === 0 && dy === 0) return;
    for (const part of [e.sprite, e.hpBar, e.marker, e.wound, e.aura, e.sigil, e.markLabel, e.bossLabel, e.heroLabel]) {
      if (part) part.position.set(part.position.x + dx, part.position.y + dy);
    }
  }

  function interpBeforeSnapshot() {
    const now = performance.now();
    if (interpSnapAt > 0) {
      const gap = Math.min(400, Math.max(20, now - interpSnapAt));
      interpIntervalMs += (gap - interpIntervalMs) * 0.3;
    }
    interpSnapAt = now;
    for (const map of interpMaps) {
      for (const e of map.values()) {
        if (!e.ip) continue;
        // Remember where it is drawn now (the next glide starts there), then put it back on the snapshot.
        e.ip.fx = e.ip.tx + e.ip.ox;
        e.ip.fy = e.ip.ty + e.ip.oy;
        shiftVisual(e, -e.ip.ox, -e.ip.oy);
        e.ip.ox = 0;
        e.ip.oy = 0;
      }
    }
  }

  function interpAfterSnapshot() {
    const snap = tileSize * INTERP_SNAP_TILES;
    for (const map of interpMaps) {
      for (const e of map.values()) {
        const tx = e.sprite.position.x;
        const ty = e.sprite.position.y;
        if (!e.ip || Math.abs(e.ip.fx - tx) > snap || Math.abs(e.ip.fy - ty) > snap) e.ip = { fx: tx, fy: ty, tx, ty, ox: 0, oy: 0 };
        else {
          e.ip.tx = tx;
          e.ip.ty = ty;
        }
      }
    }
  }

  // Before the camera ticker (which follows the rider's drawn sprite).
  app.ticker.add(() => {
    if (interpSnapAt === 0) return;
    const t = Math.min(1, (performance.now() - interpSnapAt) / interpIntervalMs);
    for (const map of interpMaps) {
      for (const e of map.values()) {
        const ip = e.ip;
        if (!ip) continue;
        const ox = (ip.fx - ip.tx) * (1 - t);
        const oy = (ip.fy - ip.ty) * (1 - t);
        shiftVisual(e, ox - ip.ox, oy - ip.oy);
        ip.ox = ox;
        ip.oy = oy;
      }
    }
  });

  // Battle engine phase 7: dot LOD for huge fights, behind the URL flag ?battleLod=1 (MANUAL-TESTS.md). With more
  // than BATTLE_LOD_UNITS soldiers + mobs drawn and the camera zoomed out below BATTLE_LOD_ZOOM, every soldier /
  // mob is one dot in a single Graphics (its clan's colour; mobs red) and its sprite, hp bar and wound are hidden;
  // zooming back in (or fewer units) shows them again. Off by default until checked in a browser.
  const BATTLE_LOD = new URLSearchParams(location.search).get("battleLod") === "1";
  const BATTLE_LOD_UNITS = 400;
  const BATTLE_LOD_ZOOM = 0.6;
  const lodDots = new Graphics();
  // Ids whose visuals the LOD hid (restored when it switches off; workers are never touched, their own
  // hide-at-post / shelter rules stay).
  const lodHidden = new Set<string>();
  if (BATTLE_LOD) worldLayer.addChild(lodDots);
  const lodHide = (e: EntityVisual) => {
    e.sprite.visible = false;
    e.hpBar.visible = false;
    if (e.wound) e.wound.visible = false;
  };
  app.ticker.add(() => {
    if (!BATTLE_LOD) return;
    lodDots.clear();
    const on = colonistSprites.size + mobSprites.size > BATTLE_LOD_UNITS && camZoom < BATTLE_LOD_ZOOM;
    if (!on) {
      for (const id of lodHidden) {
        const e = colonistSprites.get(id) ?? mobSprites.get(id);
        if (!e) continue;
        e.sprite.visible = true;
        e.hpBar.visible = true;
      }
      lodHidden.clear();
      return;
    }
    for (const c of latestColonists) {
      if (WORKER_KINDS.has(c.kind) || c.kind === "wagon") continue;
      const e = colonistSprites.get(c.id);
      if (!e) continue;
      lodDots.circle(e.sprite.position.x, e.sprite.position.y, 6).fill(clanColors.get(c.clan ?? 0) ?? 0x4a90e2);
      lodHide(e);
      lodHidden.add(c.id);
    }
    for (const [id, e] of mobSprites) {
      lodDots.circle(e.sprite.position.x, e.sprite.position.y, 6).fill(0xd0342c);
      lodHide(e);
      lodHidden.add(id);
    }
  });

  // Health-based wound decal over a unit (light < 66% hp, bleeding < 40%, heavy < 20%). The sprite is
  // created once, on the unit's first damaged snapshot, then only repositioned/retextured; healthy or
  // hidden units just hide it.
  function updateWound(
    entry: EntityVisual,
    hp: number,
    maxHp: number,
    x: number,
    y: number,
    size: number,
    large: boolean,
    hidden: boolean
  ) {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    let tier = -1;
    for (let i = 0; i < WOUND_THRESHOLDS.length; i++) if (ratio < WOUND_THRESHOLDS[i]) tier = i;
    if (tier < 0 || hidden || hp <= 0) {
      if (entry.wound) entry.wound.visible = false;
      return;
    }
    const texture = (large ? WOUND_LARGE_TEXTURES : WOUND_TEXTURES)[tier];
    let wound = entry.wound;
    if (!wound) {
      wound = new Sprite(texture);
      wound.anchor.set(0.5);
      wound.alpha = 0.9;
      worldLayer.addChild(wound);
      entry.wound = wound;
    }
    if (wound.texture !== texture) wound.texture = texture;
    wound.scale.set(size / Math.max(texture.width, texture.height));
    wound.position.set(x, y);
    wound.visible = true;
  }

  function pruneMissing(
    map: Map<string, EntityVisual>,
    seenIds: Set<string>,
    poofOnRemove = false,
    deathSound?: string
  ) {
    for (const [id, entry] of Array.from(map)) {
      if (seenIds.has(id)) continue;
      if (poofOnRemove && !suppressDeathPoofs && entry.sprite.visible) {
        spawnDeathPoof(entry.sprite.position.x, entry.sprite.position.y);
        if (deathSound) sound.play(deathSound, { x: entry.sprite.position.x, y: entry.sprite.position.y });
      }
      destroyVisual(map, id);
    }
  }

  function upsertPlayer(p: PlayerSnapshot) {
    const entry = ensureVisual(playerSprites, p.id, () => {
      const sprite = new Sprite(PLAYER_TEXTURE);
      sprite.anchor.set(0.5);
      sprite.scale.set(PLAYER_SPRITE_HEIGHT / PLAYER_TEXTURE.height);
      // One Filter per sprite: uniforms live on the Filter instance, so sharing one would
      // force every player to the same hue.
      sprite.filters = [
        new Filter({
          glProgram: playerRecolorProgram,
          resources: {
            recolorUniforms: { uTargetHue: { value: hexToHue(p.color), type: "f32" } },
          },
        }),
      ];
      return sprite;
    });
    if (p.id === myId && !entry.marker) {
      const marker = new Graphics().ellipse(0, 0, 14, 5).stroke({ width: 2, color: 0xffffff });
      // Under the sprite so it reads as a ground ring.
      worldLayer.addChildAt(marker, worldLayer.getChildIndex(entry.sprite));
      entry.marker = marker;
    }
    entry.sprite.position.set(p.x, p.y);
    // A rider with no Town Center to respawn at is gone until one is built (game over overlay).
    entry.sprite.visible = !p.dead;
    entry.hpBar.visible = !p.dead;
    if (entry.marker) entry.marker.visible = !p.dead;
    entry.marker?.position.set(p.x, p.y + PLAYER_SPRITE_HEIGHT * 0.4);
    // Just above the (taller) sprite's top edge instead of the old fixed -20.
    entry.hpBar.position.set(p.x, p.y - PLAYER_SPRITE_HEIGHT / 2 - 4);
    if (!(entry.sprite instanceof Sprite)) return;
    const facingRight = getFacing(playerFacing, p.id, p.x);
    if (PLAYER_ANIM) {
      let anim = playerAnim.get(p.id);
      if (!anim) {
        anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: p.x, lastY: p.y, attackTicks: 0 };
        playerAnim.set(p.id, anim);
      }
      const moved = Math.hypot(p.x - anim.lastX, p.y - anim.lastY) > 0.5;
      anim.lastX = p.x;
      anim.lastY = p.y;
      const mode = anim.attackTicks > 0 ? "action" : moved ? "walk" : null;
      if (anim.attackTicks > 0) anim.attackTicks--;
      // The recolor Filter stays on the sprite; swapping its texture keeps the per-player hue.
      showAnimFrame(entry.sprite, PLAYER_ANIM, stepAnim(anim, PLAYER_ANIM, mode) ?? PLAYER_ANIM.walk[0]);
    }
    applyFacing(entry.sprite, facingRight);
  }

  function syncPlayers(snapshot: PlayerSnapshot[]) {
    const seenIds = new Set(snapshot.map((p) => p.id));
    pruneMissing(playerSprites, seenIds);
    pruneFacing(playerFacing, seenIds);
    for (const id of Array.from(playerAnim.keys())) {
      if (!seenIds.has(id)) playerAnim.delete(id);
    }
    for (const p of snapshot) upsertPlayer(p);
  }

  function upsertColonist(c: ColonistSnapshot, isNight: boolean) {
    // Hero phase 3 (PLACEHOLDER art): a hero borrows its class's soldier art (champion = knight, marksman =
    // archer, mage = bishop), tinted gold-ish, with a name + level label and a gold ring (drawRoleRings).
    const vk: ColonistKind = c.kind === "hero" ? HERO_VISUAL_KIND[c.heroClass ?? "champion"] : c.kind;
    const entry = ensureVisual(colonistSprites, c.id, () => {
      const texture = COLONIST_TEXTURES[vk];
      if (!texture) return new Graphics().circle(0, 0, 8).fill(COLONIST_COLORS[c.kind] ?? 0xffffff);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(COLONIST_SPRITE_HEIGHT / texture.height);
      return sprite;
    });
    entry.sprite.position.set(c.x, c.y);
    entry.hpBar.position.set(c.x, c.y - 18);

    if (c.kind === "wagon") {
      showWagon(c, entry);
      return;
    }
    let hidden = false;
    if (HIDE_AT_POST_KINDS.has(c.kind)) {
      const postCenterX = c.postX * tileSize + tileSize / 2;
      const postCenterY = c.postY * tileSize + tileSize / 2;
      const hideRadius = AT_POST_HIDE_RADIUS_PX;
      if (Math.hypot(c.x - postCenterX, c.y - postCenterY) <= hideRadius) hidden = true;
    }
    // Civilians shelter in a house (or the Town Center) at night; the server sets `sheltered` once
    // they've arrived (updateShelteringCivilian, TILE_SIZE*1.5 radius) - once they've actually arrived, they should read as having
    // gone inside it, the same way a worker disappears into its own post above, not stand
    // visibly idling next to the flag all night.
    // Free villagers and children too (2026-11-06): every person indoors at night, none left standing outside.
    if ((WORKER_KINDS.has(c.kind) || c.kind === "villager") && isNight && c.sheltered) hidden = true;
    entry.sprite.visible = !hidden;
    entry.hpBar.visible = !hidden;
    updateWound(entry, c.hp, c.maxHp, c.x, c.y - 2, COLONIST_WOUND_SIZE, false, hidden);
    if (c.kind === "hero") {
      const text = `${c.heroName ?? "Hero"} · Lv ${c.heroLevel ?? 1}`;
      if (!entry.heroLabel) {
        entry.heroLabel = new Text({
          text,
          style: { fontFamily: "Palatino Linotype, Palatino, Georgia, serif", fontSize: 10, fontWeight: "bold", fill: 0xf2c94c, stroke: { color: 0x000000, width: 3 } },
        });
        entry.heroLabel.anchor.set(0.5, 1);
        worldLayer.addChild(entry.heroLabel);
      } else if (entry.heroLabel.text !== text) entry.heroLabel.text = text;
      entry.heroLabel.position.set(c.x, c.y - 21);
      entry.heroLabel.visible = !hidden;
    }

    const tierSet = colonistTierSet(c);
    const set = tierSet ?? COLONIST_ANIMS[vk];
    if (set && entry.sprite instanceof Sprite) {
      let anim = colonistAnim.get(c.id);
      if (!anim) {
        anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: c.x, lastY: c.y };
        colonistAnim.set(c.id, anim);
      }
      const stepX = c.x - anim.lastX;
      const stepY = c.y - anim.lastY;
      const moved = Math.hypot(stepX, stepY) > 0.5;
      anim.lastX = c.x;
      anim.lastY = c.y;
      const charging = vk === "cavalry" && CAVALRY_CHARGE_TEXTURE !== undefined && cavalryChargeRun(c.id, stepX, stepY);
      const mode = COLONIST_ACTION_STATES.has(c.state)
        ? "action"
        : c.state === "carrying" && set.carry
          ? "carry"
          : COLONIST_WALK_STATES.has(c.state) || moved
          ? "walk"
          : null;
      const frame = stepAnim(anim, set, mode);
      // Idle pose = the walk cycle's own first frame, not the kind's separate static PNG: that
      // image was extracted independently and doesn't share the walk sheet's body-to-canvas
      // ratio, so using it here made units visibly pop in size on every idle<->walk/action
      // transition (i.e. every time they started or stopped moving).
      // The couched-lance pose and the battered pose are base-set art, so a tier set keeps its own frames.
      showAnimFrame(entry.sprite, set, charging && mode === "walk" && !tierSet ? CAVALRY_CHARGE_TEXTURE! : (frame ?? set.walk[0]));
      // Village life: a child villager is drawn smaller.
      if (c.child) entry.sprite.scale.set(set.scale * 0.65);
      if (charging && mode === "walk" && !hidden) spawnChargeDust(c.id, c.x, c.y + (set.refHeight * set.scale) / 2, stepX);
      const battered = BATTERED_TINT_KINDS.has(vk) && c.hp < c.maxHp * BATTERED_HP_FRACTION;
      const posed = battered && !frame && !tierSet && showBatteredPose(entry.sprite, set, vk, COLONIST_SPRITE_HEIGHT);
      entry.sprite.tint = battered && !posed ? BATTERED_TINT : c.kind === "hero" ? HERO_TINT : c.summoned ? SUMMON_TINT : (COLONIST_TINT.get(vk) ?? 0xffffff);
    }
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(colonistFacing, c.id, c.x));
  }

  // Forts phase E: a trader wagon: its level's art (walk while rolling, hit flash after losing HP) or the
  // tinted, bobbing cart stand-in; a label with level, escort count and destination; facing like units.
  const wagonLook = new Map<string, { lastX: number; lastY: number; lastHp: number; hitUntil: number }>();
  function showWagon(c: ColonistSnapshot, entry: EntityVisual) {
    const w = c.wagon;
    const lv = Math.min(3, Math.max(1, w?.level ?? 1));
    const now = performance.now();
    let look = wagonLook.get(c.id);
    if (!look) {
      look = { lastX: c.x, lastY: c.y, lastHp: c.hp, hitUntil: 0 };
      wagonLook.set(c.id, look);
    }
    const moved = Math.hypot(c.x - look.lastX, c.y - look.lastY) > 0.3;
    if (c.hp < look.lastHp) look.hitUntil = now + 300;
    look.lastX = c.x;
    look.lastY = c.y;
    look.lastHp = c.hp;
    const hit = now < look.hitUntil;
    if (entry.sprite instanceof Sprite) {
      const art = WAGON_TEXTURES[lv - 1];
      const frame = Math.floor(now / 160);
      const texture = art ? (hit && art.hit ? art.hit[frame % art.hit.length] : moved ? art.walk[frame % art.walk.length] : art.idle) : COLONIST_TEXTURES.wagon;
      entry.sprite.texture = texture;
      entry.sprite.anchor.set(0.5);
      entry.sprite.scale.set(WAGON_HEIGHT[lv - 1] / texture.height);
      entry.sprite.tint = hit ? 0xff8080 : art ? 0xffffff : WAGON_STANDIN_TINT[lv - 1];
      if (!art && moved) entry.sprite.position.y += Math.sin(now / 90) * 1.2;
      applyFacing(entry.sprite, getFacing(colonistFacing, c.id, c.x));
    }
    entry.hpBar.position.set(c.x, c.y - WAGON_HEIGHT[lv - 1] / 2 - 4);
    const where = w && w.leg !== "home" ? ` · ${w.leg === "back" ? "home from" : w.leg === "camp" ? "camped," : "to"} ${w.dest}` : "";
    const text = `Trader Lv${lv} · ${w?.escorts ?? 0} escort${w?.escorts === 1 ? "" : "s"}${where}`;
    if (!entry.heroLabel) {
      entry.heroLabel = new Text({
        text,
        style: { fontFamily: "Palatino Linotype, Palatino, Georgia, serif", fontSize: 10, fontWeight: "bold", fill: 0xf3da98, stroke: { color: 0x000000, width: 3 } },
      });
      entry.heroLabel.anchor.set(0.5, 1);
      worldLayer.addChild(entry.heroLabel);
    } else if (entry.heroLabel.text !== text) entry.heroLabel.text = text;
    entry.heroLabel.style.fill = hit ? 0xff8080 : w && w.leg !== "home" ? WAGON_DANGER_COLORS[w.danger] : 0xf3da98;
    entry.heroLabel.position.set(c.x, c.y - WAGON_HEIGHT[lv - 1] / 2 - 8);
  }
  function drawWagonRoutes(colonists: ColonistSnapshot[]) {
    wagonRoutes.clear();
    for (const c of colonists) {
      const r = c.wagon?.route;
      if (!r || r.length < 2 || (c.clan ?? 0) !== myClan) continue;
      const color = WAGON_DANGER_COLORS[c.wagon!.danger];
      // Dashed: every other leg of the downsampled path.
      let px = c.x;
      let py = c.y;
      for (let i = 0; i + 1 < r.length; i += 2) {
        const x = r[i] * tileSize + tileSize / 2;
        const y = r[i + 1] * tileSize + tileSize / 2;
        if ((i / 2) % 2 === 0) wagonRoutes.moveTo(px, py).lineTo(x, y);
        px = x;
        py = y;
      }
      wagonRoutes.stroke({ width: 2, color, alpha: 0.6 });
    }
    for (const id of Array.from(wagonLook.keys())) if (!colonists.some((c) => c.id === id)) wagonLook.delete(id);
  }

  // Cavalry charge, inferred client-side (snapshots carry no charge flag): distance ridden in one
  // direction, reset when the rider stops or turns more than ~35 degrees. True once it reaches the server's
  // charge distance.
  const cavalryRuns = new Map<string, { dist: number; dirX: number; dirY: number; dustAt: number }>();
  function cavalryChargeRun(id: string, dx: number, dy: number): boolean {
    let run = cavalryRuns.get(id);
    if (!run) {
      run = { dist: 0, dirX: 0, dirY: 0, dustAt: 0 };
      cavalryRuns.set(id, run);
    }
    const len = Math.hypot(dx, dy);
    if (len <= 0.5) {
      run.dist = 0;
      return false;
    }
    const ux = dx / len;
    const uy = dy / len;
    if (run.dist > 0 && ux * run.dirX + uy * run.dirY < 0.82) run.dist = 0;
    run.dirX = ux;
    run.dirY = uy;
    run.dist += len;
    return run.dist >= CAVALRY_CHARGE_TILES * TILE_SIZE;
  }
  // A dust cloud kicked up behind the hooves (fx-dust0), drifting back and fading; one per CHARGE_DUST_MS.
  function spawnChargeDust(id: string, x: number, feetY: number, dx: number) {
    const run = cavalryRuns.get(id);
    const now = performance.now();
    if (!CHARGE_DUST_TEXTURE || !run || now - run.dustAt < CHARGE_DUST_MS) return;
    run.dustAt = now;
    const back = dx >= 0 ? -1 : 1;
    const sx = x + back * 14;
    const dust = addFx(CHARGE_DUST_TEXTURE, 24, sx, feetY, 600, (s, t) => {
      s.x = sx + back * 10 * t;
      s.alpha = 0.85 * (1 - t);
    });
    dust.anchor.set(0.5, 1);
    if (back > 0) dust.scale.x *= -1;
  }
  // A destroyed siege engine's wreck lies where it fell for SIEGE_WRECK_MS. `scale` is the unit's anim-set
  // scale (the wreck is cut from the same sheet, so it shares the pixel scale), `feetY` its feet line.
  function spawnSiegeWreck(texture: Texture, x: number, feetY: number, scale: number, facingLeft: boolean) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(facingLeft ? -scale : scale, scale);
    sprite.position.set(x, feetY);
    decorSpriteLayer.addChild(sprite);
    activeEffects.push({
      sprite,
      startedAt: performance.now(),
      durationMs: SIEGE_WRECK_MS,
      update: (s, t) => {
        s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
      },
    });
  }
  // Last known siege-engine kind per id (colonists / mobs), so a removed one can leave its wreck.
  const siegeIds = { colonist: new Map<string, string>(), mob: new Map<string, string>() };
  function dropSiegeWrecks(which: "colonist" | "mob", sprites: Map<string, EntityVisual>, seenIds: Set<string>, facing: FacingMap) {
    for (const [id, kind] of siegeIds[which]) {
      if (seenIds.has(id)) continue;
      siegeIds[which].delete(id);
      const entry = sprites.get(id);
      const texture = SIEGE_WRECK_TEXTURES[which][kind];
      const set = which === "colonist" ? COLONIST_ANIMS[kind as ColonistKind] : MOB_VARIANTS[kind as MobKind]?.[0]?.anim;
      if (suppressDeathPoofs || !entry || !entry.sprite.visible || !texture || !set) continue;
      // Only with the engine's own art (the wreck would not match a tinted stand-in).
      if (which === "colonist" ? COLONIST_TINT.has(kind) : !MOB_OWN_ART.has(kind)) continue;
      const { x, y } = entry.sprite.position;
      spawnSiegeWreck(texture, x, y + (set.refHeight * set.scale) / 2, set.scale, facing.get(id)?.facingRight === false);
    }
  }

  // Swaps an idle unit's frame for its static battered pose (BATTERED_POSE_URLS), `height` px tall
  // with its feet where the anim set's idle frame puts them. False when the kind has no pose art.
  function showBatteredPose(sprite: Sprite, set: AnimSet, kind: string, height: number): boolean {
    const texture = BATTERED_POSE_TEXTURES.get(kind);
    if (!texture) return false;
    const feetBelowCenter = (set.refHeight * set.scale) / 2;
    sprite.texture = texture;
    sprite.scale.set(height / texture.height);
    sprite.anchor.set(0.5, 1 - feetBelowCenter / height);
    return true;
  }

  function syncColonists(snapshot: ColonistSnapshot[], isNight: boolean) {
    const seenIds = new Set(snapshot.map((c) => c.id));
    dropSiegeWrecks("colonist", colonistSprites, seenIds, colonistFacing);
    pruneMissing(colonistSprites, seenIds, true, "colonist_death");
    for (const id of Array.from(colonistAnim.keys())) {
      if (!seenIds.has(id)) colonistAnim.delete(id);
    }
    for (const id of Array.from(cavalryRuns.keys())) {
      if (!seenIds.has(id)) cavalryRuns.delete(id);
    }
    for (const c of snapshot) if (c.kind === "batteringRam" || c.kind === "catapult") siegeIds.colonist.set(c.id, c.kind);
    pruneFacing(colonistFacing, seenIds);
    for (const id of Array.from(stateFxAt.keys())) {
      if (!seenIds.has(id)) stateFxAt.delete(id);
    }
    const now = performance.now();
    for (const c of snapshot) {
      upsertColonist(c, isNight);
      stateFx(c, now);
    }
  }

  function nearestFriendlyDistance(x: number, y: number): number {
    let best = Infinity;
    for (const map of [colonistSprites, playerSprites]) {
      for (const { sprite } of map.values()) {
        best = Math.min(best, Math.hypot(sprite.position.x - x, sprite.position.y - y));
      }
    }
    return best;
  }

  function upsertMob(m: MobSnapshot) {
    if (m.kind === "halfLatch" && !suppressDeathPoofs && !mobSprites.has(m.id)) maybeWardLapseFx(m.x, m.y);
    const variants = m.boss === "warlord" && WARLORD_VARIANT ? [WARLORD_VARIANT] : MOB_VARIANTS[m.kind];
    const woundSize = (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS * MOB_WOUND_SIZE_FACTOR;
    if (variants) {
      upsertVariantMob(m, m.kind === "goblinRider" && m.mark && GOBLIN_RIDER_VET ? GOBLIN_RIDER_VET : variants[stableHash(m.id) % variants.length]);
      const entry = mobSprites.get(m.id)!;
      updateWound(entry, m.hp, m.maxHp, m.x, m.y, woundSize, WOUND_LARGE_KINDS.has(m.kind), !entry.sprite.visible);
      updateMarkVisuals(entry, m);
      updateBossVisuals(entry, m);
      return;
    }
    const visual = MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin;
    const texture = MOB_TEXTURES[m.kind];
    // Longer side, not height, so wide kinds (wolf, spider) don't balloon horizontally.
    const scale = texture
      ? (visual.radius * MOB_SPRITE_SIZE_PER_RADIUS) / Math.max(texture.width, texture.height)
      : 0;
    const entry = ensureVisual(mobSprites, m.id, () => {
      if (!texture) {
        // Dark outline keeps the green-toned kinds readable against the green grass floor.
        return new Graphics()
          .circle(0, 0, visual.radius)
          .fill(visual.color)
          .stroke({ width: 1.5, color: 0x1a0d0a });
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(scale * mobRenderScale(m));
      sprite.tint = MOB_TINT[m.kind] ?? 0xffffff;
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    // Bar just above the sprite's top edge, matching the player's "height / 2 + 4" convention.
    const topOffset = texture ? (texture.height * scale * mobRenderScale(m)) / 2 + 4 : visual.radius + 9;
    entry.hpBar.position.set(m.x, m.y - topOffset);
    if (m.boss) drawHpBar(entry.hpBar, m.hp, m.maxHp, 0xe03020);
    updateWound(entry, m.hp, m.maxHp, m.x, m.y, woundSize, WOUND_LARGE_KINDS.has(m.kind), !entry.sprite.visible);
    updateMarkVisuals(entry, m);
    updateBossVisuals(entry, m);
    if (entry.sprite instanceof Sprite) applyFacing(entry.sprite, getFacing(mobFacing, m.id, m.x));
  }

  // Sigil + name label above a Hunger-marked mob (over its hp bar) and its aura on the ground under it
  // (decor layer: over the floor, under tiles and units), alpha pulsing gently. Created on the mob's
  // first snapshot; ordinary mobs never get any of it.
  function updateMarkVisuals(entry: EntityVisual, m: MobSnapshot) {
    const mark = m.mark ?? HungerMark.None;
    if (mark === HungerMark.None) return;
    if (!entry.sigil) {
      const sigilTexture = HUNGER_SIGIL_TEXTURES[mark];
      const auraTexture = HUNGER_AURA_TEXTURES[mark];
      if (auraTexture) {
        entry.aura = new Sprite(auraTexture);
        entry.aura.anchor.set(0.5);
        entry.aura.scale.set(HUNGER_AURA_WIDTH / auraTexture.width);
        decorSpriteLayer.addChild(entry.aura);
      }
      entry.sigil = new Sprite(sigilTexture ?? Texture.EMPTY);
      entry.sigil.anchor.set(0.5, 1);
      if (sigilTexture) entry.sigil.scale.set(HUNGER_SIGIL_SIZE / Math.max(sigilTexture.width, sigilTexture.height));
      const name = HUNGER_MARK_NAMES[mark] ?? "";
      entry.markLabel = new Text({
        text: name.charAt(0).toUpperCase() + name.slice(1),
        style: { fontFamily: "monospace", fontSize: 8, fill: HUNGER_LABEL_COLORS[mark] ?? 0xffffff, stroke: { color: 0x000000, width: 2 } },
      });
      entry.markLabel.anchor.set(0.5, 1);
      worldLayer.addChild(entry.sigil);
      worldLayer.addChild(entry.markLabel);
    }
    const visible = entry.sprite.visible;
    const barY = entry.hpBar.position.y;
    entry.sigil.position.set(m.x, barY - 1);
    entry.sigil.visible = visible;
    entry.markLabel!.position.set(m.x, barY - HUNGER_SIGIL_SIZE - 1);
    entry.markLabel!.visible = visible;
    if (entry.aura) {
      const feetY = m.y + (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS * MARKED_MOB_SCALE * 0.4;
      entry.aura.position.set(m.x, feetY);
      entry.aura.alpha = 0.6 + 0.25 * Math.sin(performance.now() / 450);
      entry.aura.visible = visible;
    }
  }

  // Name label over a boss's (enlarged, still centred) hp bar. Created on the boss's first snapshot.
  function updateBossVisuals(entry: EntityVisual, m: MobSnapshot) {
    if (!m.boss) return;
    const barScale = BOSS_HP_BAR_SCALE[m.boss];
    if (!entry.bossLabel) {
      entry.hpBar.scale.set(barScale);
      entry.bossLabel = new Text({
        text: bossTitle(m.kind, m.boss),
        style: {
          fontFamily: "Palatino Linotype, Palatino, Georgia, serif",
          fontSize: m.boss === "warlord" ? 12 : 10,
          fontWeight: "bold",
          fill: BOSS_LABEL_COLORS[m.boss],
          stroke: { color: 0x000000, width: 3 },
        },
      });
      entry.bossLabel.anchor.set(0.5, 1);
      worldLayer.addChild(entry.bossLabel);
    }
    // The bar grows upward from its usual spot so it never covers the sprite.
    const barY = entry.hpBar.position.y - 4 * (barScale - 1);
    entry.hpBar.position.y = barY;
    entry.bossLabel.position.set(m.x, barY - 2 - (m.mark ? HUNGER_SIGIL_SIZE + 10 : 0));
    entry.bossLabel.visible = entry.sprite.visible;
  }

  function upsertVariantMob(m: MobSnapshot, variant: MobVariant) {
    const entry = ensureVisual(mobSprites, m.id, () => {
      const sprite = new Sprite(variant.idle);
      sprite.anchor.set(0.5);
      sprite.scale.set(variant.idleScale);
      return sprite;
    });
    entry.sprite.position.set(m.x, m.y);
    entry.hpBar.position.set(m.x, m.y - (variant.idle.height * variant.idleScale * mobRenderScale(m)) / 2 - 4);
    if (m.boss) drawHpBar(entry.hpBar, m.hp, m.maxHp, 0xe03020);
    const sprite = entry.sprite instanceof Sprite ? entry.sprite : null;
    const facingRight = sprite ? getFacing(mobFacing, m.id, m.x) : true;
    if (sprite) applyFacing(sprite, facingRight);

    const set = variant.anim;
    if (!set || !sprite) return;
    let anim = mobAnim.get(m.id);
    if (!anim) {
      anim = { mode: null, frame: 0, ticksInFrame: 0, lastX: m.x, lastY: m.y };
      mobAnim.set(m.id, anim);
    }
    const moved = Math.hypot(m.x - anim.lastX, m.y - anim.lastY) > 0.5;
    anim.lastX = m.x;
    anim.lastY = m.y;
    const mode = moved
      ? "walk"
      : nearestFriendlyDistance(m.x, m.y) <= (MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX[m.kind] ?? MOB_ATTACK_ANIM_RANGE_PX)
        ? "action"
        : null;
    const frame = stepAnim(anim, set, mode);
    // Same fix as the colonist idle fallback above: use the walk cycle's own first frame instead
    // of `variant.idle` (a separately-extracted static texture) so idle<->animated transitions
    // don't pop in size. The Warlord's idle pose shares its walk canvas, so it doesn't pop either.
    showAnimFrame(sprite, set, frame ?? warlordIdleFrame(m.id, variant) ?? set.walk[0]);
    const battered = BATTERED_TINT_KINDS.has(m.kind) && m.hp < m.maxHp * BATTERED_HP_FRACTION;
    const posed =
      battered && !frame && showBatteredPose(sprite, set, m.kind, (MOB_VISUALS[m.kind] ?? MOB_VISUALS.goblin).radius * MOB_SPRITE_SIZE_PER_RADIUS);
    sprite.tint = battered && !posed ? BATTERED_TINT : MOB_OWN_ART.has(m.kind) ? 0xffffff : (MOB_TINT[m.kind] ?? 0xffffff);
    const renderScale = mobRenderScale(m);
    if (renderScale !== 1) sprite.scale.set(sprite.scale.x * renderScale, sprite.scale.y * renderScale);
    // showAnimFrame resets scale.x to a positive magnitude, so re-apply the flip after it.
    applyFacing(sprite, facingRight);
  }

  // Standing Warlord: its idle pose, or a roar when first seen and then every WARLORD_ROAR_EVERY_MS
  // (staggered a little). Null for any other variant.
  function warlordIdleFrame(id: string, variant: MobVariant): Texture | null {
    if (!variant.roar || !variant.idlePose) return null;
    const now = performance.now();
    let roar = warlordRoar.get(id);
    if (!roar) {
      roar = { until: 0, next: now, startedAt: 0 };
      warlordRoar.set(id, roar);
    }
    if (now >= roar.next && now >= roar.until) {
      roar.startedAt = now;
      roar.until = now + variant.roar.length * WARLORD_ROAR_FRAME_MS;
      roar.next = roar.until + WARLORD_ROAR_EVERY_MS + Math.random() * 3000;
    }
    if (now < roar.until) return variant.roar[Math.min(variant.roar.length - 1, Math.floor((now - roar.startedAt) / WARLORD_ROAR_FRAME_MS))];
    return variant.idlePose;
  }

  function syncMobs(snapshot: MobSnapshot[]) {
    const seenIds = new Set(snapshot.map((m) => m.id));
    dropSiegeWrecks("mob", mobSprites, seenIds, mobFacing);
    pruneMissing(mobSprites, seenIds, true, "monster_death");
    for (const id of Array.from(mobAnim.keys())) {
      if (!seenIds.has(id)) mobAnim.delete(id);
    }
    for (const id of Array.from(warlordRoar.keys())) {
      if (!seenIds.has(id)) warlordRoar.delete(id);
    }
    for (const m of snapshot) if (SIEGE_WRECK_URLS.mob[m.kind]) siegeIds.mob.set(m.id, m.kind);
    pruneFacing(mobFacing, seenIds);
    for (const m of snapshot) upsertMob(m);
  }

  // Client-only, short-lived combat VFX. `update` gets progress 0..1 each frame; `onEnd` can chain
  // a follow-up effect (an arrow's impact spark).
  interface ActiveEffect {
    sprite: Sprite;
    startedAt: number;
    durationMs: number;
    update: (sprite: Sprite, t: number) => void;
    onEnd?: () => void;
  }
  const activeEffects: ActiveEffect[] = [];
  // Rendered size (px, longest side) of each effect sprite in world space.
  const FX_SIZE = { slash: 22, spark: 14, poof: 30, arrow: 18, shamanBolt: 12 };
  const SHAMAN_BOLT_TINT = 0xb98cff;
  const BOULDER_SIZE = 12;
  const BOULDER_TINT = 0x7a5530;
  const BOULDER_PUFF_SIZE = 40;
  const BOULDER_PUFF_TINT = 0xb09070;
  const PROJECTILE_PX_PER_MS = 0.5;

  function addFx(
    texture: Texture,
    size: number,
    x: number,
    y: number,
    durationMs: number,
    update: ActiveEffect["update"],
    onEnd?: () => void
  ): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(texture.width, texture.height));
    sprite.position.set(x, y);
    worldLayer.addChild(sprite);
    activeEffects.push({ sprite, startedAt: performance.now(), durationMs, update, onEnd });
    return sprite;
  }

  function fadeOut(sprite: Sprite, t: number) {
    sprite.alpha = 1 - t * t;
  }

  function spawnImpactSpark(x: number, y: number, tint = 0xffffff) {
    const spark = addFx(FX_TEXTURES.spark, FX_SIZE.spark, x, y, 140, fadeOut);
    spark.tint = tint;
  }

  // Dark smoke rising off a burning building (fx-poof, tinted; see syncDamagedBuildings).
  function spawnSmokePuff(x: number, y: number) {
    const base = FX_SIZE.poof / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    const puff = addFx(FX_TEXTURES.poof, FX_SIZE.poof, x, y, 1200, (s, t) => {
      s.scale.set(base * (0.6 + 0.8 * t));
      s.y = y - 18 * t;
      s.alpha = 0.55 * (1 - t);
    });
    puff.tint = 0x4a4440;
  }

  function spawnDeathPoof(x: number, y: number) {
    const base = FX_SIZE.poof / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    addFx(FX_TEXTURES.poof, FX_SIZE.poof, x, y, 420, (s, t) => {
      s.scale.set(base * (0.7 + 0.5 * t));
      s.y = y - 6 * t;
      s.alpha = 1 - t;
    });
  }

  // VFX sheet 2 one-shot: steps through the set's 4 frames, fading over the last quarter. `under`
  // puts it in the tile layer just beneath the tile at `underIndex` (the ward rings sit under the stone).
  const FX_ANIM_SIZE = { build: 30, upgrade: 30, heal: 22, poison: 20, wardPulse: 56, wardLapse: 56 };
  function spawnFxAnim(kind: keyof typeof FX_ANIM_TEXTURES, x: number, y: number, durationMs: number, underIndex?: number) {
    const frames = FX_ANIM_TEXTURES[kind];
    const sprite = addFx(frames[0], FX_ANIM_SIZE[kind], x, y, durationMs, (s, t) => {
      const frame = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
      if (s.texture !== frame) s.texture = frame;
      s.alpha = t < 0.75 ? 1 : (1 - t) * 4;
    });
    sprite.anchor.set(0.5, 1);
    if (underIndex !== undefined) {
      tileSpriteLayer.addChild(sprite);
      sprite.zIndex = underIndex - 0.5;
    }
  }
  const tileCenter = (tx: number, ty: number) => ({ x: tx * tileSize + tileSize / 2, y: ty * tileSize + tileSize / 2 });
  // A Ward Stone's lapse lets a Half-Latch through at the stone (server checkWardStoneLapses), so a
  // Half-Latch first appearing on or next to a Ward Stone marks the lapse there.
  function maybeWardLapseFx(x: number, y: number) {
    const tx = Math.floor(x / tileSize);
    const ty = Math.floor(y / tileSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= worldTilesX || ny >= worldTilesY) continue;
        if (tiles[ny * worldTilesX + nx] !== TileType.WardStone) continue;
        const c = tileCenter(nx, ny);
        spawnFxAnim("wardLapse", c.x, c.y + tileSize / 2, 900, ny * worldTilesX + nx);
        return;
      }
    }
  }
  // Heal / ward-pulse cues from colonist state: one effect per bishop every HEAL_FX_MS while healing,
  // and per ward priest every WARD_FX_MS while tending its stone (its post).
  const HEAL_FX_MS = 900;
  const WARD_FX_MS = 1800;
  const stateFxAt = new Map<string, number>();
  const BUILD_FX_MS = 1500;
  function stateFx(c: ColonistSnapshot, now: number) {
    if (c.state === "building" || c.state === "repairing") {
      // Builders hammering: a build puff at the site (or damaged building) they work, the nearest one.
      const last = stateFxAt.get(c.id) ?? 0;
      if (now - last < BUILD_FX_MS) return;
      stateFxAt.set(c.id, now);
      let best: { tx: number; ty: number } | null = null;
      let bestD = tileSize * 2;
      for (const index of (c.state === "building" ? constructionSites : damagedBuildings).keys()) {
        const t = indexToTile(index);
        const d = Math.hypot(t.tx * tileSize + tileSize / 2 - c.x, t.ty * tileSize + tileSize / 2 - c.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        const p = tileCenter(best.tx, best.ty);
        spawnFxAnim("build", p.x, p.y + tileSize / 2, 700);
      }
      return;
    }
    const healing = c.state === "healing";
    if (!healing && c.state !== "warding") return;
    const last = stateFxAt.get(c.id) ?? 0;
    if (now - last < (healing ? HEAL_FX_MS : WARD_FX_MS)) return;
    stateFxAt.set(c.id, now);
    if (healing) {
      spawnFxAnim("heal", c.x, c.y + 10, 600);
    } else {
      const p = tileCenter(c.postX, c.postY);
      spawnFxAnim("wardPulse", p.x, p.y + tileSize / 2, 1000, c.postY * worldTilesX + c.postX);
    }
  }

  // Effects don't carry the attacker: whoever stands at the origin turns to face the target, so
  // fighters slash at each other rather than facing the way they last walked. The facing sticks
  // until the unit next moves horizontally (see getFacing).
  function faceAttacker(e: AttackEffect) {
    const dx = e.toX - e.fromX;
    if (Math.abs(dx) < 1) return;
    const right = dx > 0;
    const at = (x: number, y: number) => Math.abs(x - e.fromX) < 2 && Math.abs(y - e.fromY) < 2;
    const face = (map: FacingMap, sprites: Map<string, EntityVisual>, units: { id: string; x: number; y: number }[]) => {
      for (const u of units) {
        if (!at(u.x, u.y)) continue;
        const prev = map.get(u.id);
        if (prev) prev.facingRight = right;
        else map.set(u.id, { lastX: u.x, facingRight: right });
        const s = sprites.get(u.id)?.sprite;
        if (s instanceof Sprite) applyFacing(s, right);
      }
    };
    face(colonistFacing, colonistSprites, latestColonists);
    face(mobFacing, mobSprites, latestMobs);
  }

  // Hero phase 4: spell casts (PLACEHOLDER art, reusing the existing effect sprites): fire bolt = the shaman
  // bolt tinted orange, thunder = a big pale-blue spark burst, frost = a blue poof, heal = the green heal
  // sparks, ward = the ward pulse, rally = a red poof + spark (banner), summon = a grey poof, curse = a purple poof.
  const SPELL_FX_TINT: Record<SpellId, number> = {
    fireBolt: 0xff8a2a, thunder: 0xcfe0ff, frost: 0x7cc8ff, heal: 0x7fe07f, ward: 0xf2d36b, rallyBanner: 0xd04a3a, summon: 0x9aa0b0, curse: 0xb05be0,
  };
  function spellPoof(x: number, y: number, tint: number, size = 44, ms = 600) {
    const base = size / Math.max(FX_TEXTURES.poof.width, FX_TEXTURES.poof.height);
    const puff = addFx(FX_TEXTURES.poof, size, x, y, ms, (sp, t) => {
      sp.scale.set(base * (0.6 + 0.7 * t));
      sp.alpha = 0.9 * (1 - t);
    });
    puff.tint = tint;
  }
  function spawnSpellEffect(e: AttackEffect & { spell: SpellId }) {
    const tint = SPELL_FX_TINT[e.spell];
    if (e.spell === "fireBolt") {
      const distance = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
      const bolt = addFx(FX_TEXTURES.spark, FX_SIZE.shamanBolt * 1.6, e.fromX, e.fromY, Math.min(320, Math.max(80, distance / PROJECTILE_PX_PER_MS)),
        (sp, t) => sp.position.set(e.fromX + (e.toX - e.fromX) * t, e.fromY + (e.toY - e.fromY) * t),
        () => spellPoof(e.toX, e.toY, tint, 30, 400));
      bolt.tint = tint;
      return;
    }
    if (e.spell === "heal") {
      spawnFxAnim("heal", e.toX, e.toY + 10, 700);
      return;
    }
    if (e.spell === "ward") {
      spawnFxAnim("wardPulse", e.toX, e.toY + 16, 900);
      return;
    }
    if (e.spell === "thunder") {
      for (let i = 0; i < 5; i++) {
        const sx = e.toX + (Math.random() - 0.5) * TILE_SIZE * 2;
        const sy = e.toY + (Math.random() - 0.5) * TILE_SIZE * 2;
        const spark = addFx(FX_TEXTURES.spark, 26, sx, sy, 380, fadeOut);
        spark.tint = tint;
      }
      spellPoof(e.toX, e.toY, 0x8fa8ff, 80, 450);
      sound.play("sword_hit", { x: e.toX, y: e.toY });
      return;
    }
    const size = e.spell === "frost" ? 90 : e.spell === "rallyBanner" ? 70 : 44;
    spellPoof(e.toX, e.toY, tint, size, e.spell === "rallyBanner" ? 900 : 600);
    if (e.spell === "rallyBanner") spawnImpactSpark(e.toX, e.toY - 14, 0xf2c94c);
  }

  function spawnEffect(e: AttackEffect) {
    if (e.spell) {
      spawnSpellEffect(e as AttackEffect & { spell: SpellId });
      return;
    }
    faceAttacker(e);
    const angle = Math.atan2(e.toY - e.fromY, e.toX - e.fromX);
    if (e.boulder) {
      // Catapult boulder (one of the fx-boulder rocks, SPRITES.md #42): a slow tumbling arc, then the
      // 4-frame dust impact where it lands. Falls back to a brown-tinted spark and poof without that art.
      const distance = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
      const durationMs = Math.min(1100, Math.max(350, distance / 0.35));
      const arc = Math.min(90, distance * 0.35);
      const rock = BOULDER_TEXTURES.length > 0 ? BOULDER_TEXTURES[Math.floor(Math.random() * BOULDER_TEXTURES.length)] : null;
      const boulder = addFx(rock ?? FX_TEXTURES.spark, BOULDER_SIZE, e.fromX, e.fromY, durationMs, (sp, t) => {
        sp.position.set(e.fromX + (e.toX - e.fromX) * t, e.fromY + (e.toY - e.fromY) * t - Math.sin(Math.PI * t) * arc);
        sp.rotation = t * 6;
      }, () => {
        sound.play("sword_hit", { x: e.toX, y: e.toY });
        const frames = BOULDER_IMPACT_TEXTURES;
        if (frames) {
          const impact = addFx(frames[0], BOULDER_PUFF_SIZE, e.toX, e.toY + 6, 560, (sp, t) => {
            const frame = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
            if (sp.texture !== frame) sp.texture = frame;
            sp.alpha = t < 0.75 ? 1 : (1 - t) * 4;
          });
          impact.anchor.set(0.5, 1);
          return;
        }
        const puff = addFx(FX_TEXTURES.poof, BOULDER_PUFF_SIZE, e.toX, e.toY, 500, (sp, t) => {
          sp.alpha = 1 - t * t;
          sp.scale.set((BOULDER_PUFF_SIZE / Math.max(sp.texture.width, sp.texture.height)) * (0.7 + 0.6 * t));
        });
        puff.tint = BOULDER_PUFF_TINT;
      });
      if (!rock) boulder.tint = BOULDER_TINT;
      return;
    }
    if (e.melee) {
      // Effects don't carry the attacker; a player standing at the origin plays its lance thrust.
      for (const [id, { sprite }] of playerSprites) {
        if (Math.abs(sprite.position.x - e.fromX) < 2 && Math.abs(sprite.position.y - e.fromY) < 2) {
          triggerPlayerAttackAnim(id);
        }
      }
      if (Math.random() < BLOOD_HIT_CHANCE) stampBlood(e.toX, e.toY, BLOOD_HIT_VARIANTS, BLOOD_HIT_SIZE);
      sound.play("sword_hit", { x: e.toX, y: e.toY });
      const slash = addFx(FX_TEXTURES.slash, FX_SIZE.slash, e.toX, e.toY, 160, fadeOut);
      slash.rotation = angle;
      // Giant Spider bites poison (server: mob.kind === "giantSpider"); the effect's origin is the spider.
      if (latestMobs.some((m) => m.kind === "giantSpider" && Math.abs(m.x - e.fromX) < 2 && Math.abs(m.y - e.fromY) < 2)) {
        spawnFxAnim("poison", e.toX, e.toY + 8, 650);
      }
      return;
    }
    // Ranged attacks don't carry the attacker's kind; a Dark Shaman standing at the origin casts a
    // purple bolt instead of an arrow.
    const isShaman = latestMobs.some(
      (m) => m.kind === "darkShaman" && Math.abs(m.x - e.fromX) < 2 && Math.abs(m.y - e.fromY) < 2
    ) || latestColonists.some((c) => c.heroClass === "mage" && Math.abs(c.x - e.fromX) < 2 && Math.abs(c.y - e.fromY) < 2);
    const distance = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
    const durationMs = Math.min(260, Math.max(60, distance / PROJECTILE_PX_PER_MS));
    const tint = isShaman ? SHAMAN_BOLT_TINT : 0xffffff;
    // Shaman bolts are magic, not arrows: no bow sounds for them.
    if (!isShaman) sound.play("arrow_shoot", { x: e.fromX, y: e.fromY });
    const projectile = addFx(
      isShaman ? FX_TEXTURES.spark : FX_TEXTURES.arrow,
      isShaman ? FX_SIZE.shamanBolt : FX_SIZE.arrow,
      e.fromX,
      e.fromY,
      durationMs,
      (s, t) => s.position.set(e.fromX + (e.toX - e.fromX) * t, e.fromY + (e.toY - e.fromY) * t),
      () => {
        spawnImpactSpark(e.toX, e.toY, tint);
        if (!isShaman) sound.play("arrow_hit", { x: e.toX, y: e.toY });
      }
    );
    projectile.rotation = angle;
    projectile.tint = tint;
  }

  app.ticker.add(() => {
    const now = performance.now();
    for (let i = activeEffects.length - 1; i >= 0; i--) {
      const fx = activeEffects[i];
      const t = Math.min(1, (now - fx.startedAt) / fx.durationMs);
      fx.update(fx.sprite, t);
      if (t >= 1) {
        fx.sprite.destroy();
        activeEffects.splice(i, 1);
        fx.onEnd?.();
      }
    }
  });

  // Shared clock for every looping tile (fire flicker, water ripple): one pass over the animated
  // slots, and only on a frame boundary of the fastest loop, not per sprite or per render frame.
  let lastTileAnimStep = -1;
  const tileAnimStepMs = Math.min(...Array.from(TILE_ANIM_TEXTURES.values(), (a) => a.frameMs));
  app.ticker.add(() => {
    const now = performance.now();
    const step = Math.floor(now / tileAnimStepMs);
    if (step === lastTileAnimStep) return;
    lastTileAnimStep = step;
    for (const [index, tile] of animatedTiles) {
      const sprite = tileSprites.get(index);
      const texture = tileAnimTexture(index, tile, now);
      if (sprite && texture && sprite.texture !== texture) sprite.texture = texture;
    }
    // Building fires share the campfire loop's clock; tier 2+ also puffs smoke now and then.
    const fireFrame = Math.floor(now / FIRE_FRAME_MS);
    for (const o of fireOverlays.values()) {
      if (o.tier <= 0) continue;
      o.flame.texture = FIRE_FRAMES[(fireFrame + o.phase) % FIRE_FRAMES.length];
      if (o.tier >= 2 && now >= o.nextSmokeAt) {
        o.nextSmokeAt = now + FIRE_SMOKE_MS * (0.75 + 0.5 * Math.random());
        spawnSmokePuff(o.flame.x, o.flame.y - FIRE_FLAME_WIDTH[o.tier]);
      }
    }
  });

  app.ticker.add(() => {
    if (!myId) return;
    const mine = playerSprites.get(myId);
    if (!mine) return;
    if (pendingStartStrategy && !strategyCam.active) {
      pendingStartStrategy = false;
      toggleStrategy();
    }
    strategyCam.homeZoom = homeZoom();
    const sv = strategyCameraView(mine.sprite.position.x, mine.sprite.position.y);
    const now = performance.now();
    let focus = sv ?? fightPeekFocus(mine.sprite.position.x, mine.sprite.position.y);
    // Adventure camera: a smooth follow of the rider (or the fight peek); synced to the strategy view while that
    // drives the camera so the hand-back glides.
    if (sv) advCam.sync(sv.x, sv.y, now);
    else if (adventurePrefs.on) focus = advCam.follow(focus.x, focus.y, now);
    camZoom = sv ? sv.zoom : homeZoom();
    worldLayer.scale.set(camZoom);
    const camX = app.screen.width / 2 - focus.x * camZoom;
    const camY = app.screen.height / 2 - focus.y * camZoom;
    // Whole screen pixels at close zoom, so the pixel art doesn't shimmer while the camera glides.
    if (adventurePrefs.on && !sv) worldLayer.position.set(Math.round(camX), Math.round(camY));
    else worldLayer.position.set(camX, camY);
    strategyAfterCamera();
    updateFloorChunks();
    requestStreamChunks();
  });

  // World streaming phase 4: ask for the chunks the camera (one chunk margin) and the rider (2 chunks) need,
  // 5 times a second, at most MAX_CHUNKS_PER_REQUEST at a time; an unanswered request is retried after 3 s.
  // The Map band draws the summary minimap instead, so it asks only for the rider's chunks.
  function requestStreamChunks() {
    const sm = streamed;
    if (!sm || socket.readyState !== socket.OPEN) return;
    const now = performance.now();
    if (now - chunkRequestAt < 200) return;
    chunkRequestAt = now;
    const span = sm.chunkTiles * tileSize;
    const want: number[] = [];
    const add = (x0: number, x1: number, y0: number, y1: number) => {
      for (let cy = Math.max(0, y0); cy <= Math.min(sm.chunksY - 1, y1); cy++) {
        for (let cx = Math.max(0, x0); cx <= Math.min(sm.chunksX - 1, x1); cx++) {
          const c = cy * sm.chunksX + cx;
          if (chunkLoaded[c] || now - (chunkRequestedAt.get(c) ?? -Infinity) < 3000 || want.includes(c)) continue;
          want.push(c);
        }
      }
    };
    const mine = myId ? playerSprites.get(myId) : undefined;
    if (mine) {
      const pcx = Math.floor(mine.sprite.position.x / span);
      const pcy = Math.floor(mine.sprite.position.y / span);
      add(pcx - 2, pcx + 2, pcy - 2, pcy + 2);
    }
    if (strategyBand !== "map") {
      add(
        Math.floor(-worldLayer.position.x / camZoom / span) - 1,
        Math.floor((app.screen.width - worldLayer.position.x) / camZoom / span) + 1,
        Math.floor(-worldLayer.position.y / camZoom / span) - 1,
        Math.floor((app.screen.height - worldLayer.position.y) / camZoom / span) + 1,
      );
    }
    const batch = want.slice(0, MAX_CHUNKS_PER_REQUEST);
    if (!batch.length) return;
    for (const c of batch) chunkRequestedAt.set(c, now);
    sendMessage({ type: "requestChunks", chunks: batch });
  }

  function applyStreamChunks(list: { c: number; tiles: string; biomes: string }[]) {
    const sm = streamed;
    if (!sm) return;
    for (const { c, tiles: t64, biomes: b64 } of list) {
      if (c < 0 || c >= chunkLoaded.length) continue;
      const x0 = (c % sm.chunksX) * sm.chunkTiles;
      const y0 = Math.floor(c / sm.chunksX) * sm.chunkTiles;
      const w = Math.min(sm.chunkTiles, worldTilesX - x0);
      const h = Math.min(sm.chunkTiles, worldTilesY - y0);
      const t = atob(t64);
      const b = atob(b64);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y0 + y) * worldTilesX + x0 + x;
          tiles[i] = t.charCodeAt(y * w + x);
          biomes[i] = b.charCodeAt(y * w + x);
        }
      }
      chunkLoaded[c] = 1;
      chunkRequestedAt.delete(c);
      // The chunk's sprites, plus a 3-tile band up / left and 1 tile right / down (autotiled roads / walls and
      // multi-tile art reaching across the chunk edge).
      for (let y = Math.max(0, y0 - 3); y < Math.min(worldTilesY, y0 + h + 1); y++) {
        for (let x = Math.max(0, x0 - 3); x < Math.min(worldTilesX, x0 + w + 1); x++) {
          const inside = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
          if (!inside && !chunkLoaded[chunkOfTile(x, y)]) continue;
          setTileSprite(x, y, tiles[y * worldTilesX + x]);
        }
      }
      addDecorIn(x0, y0, w, h);
      // Floor chunks under it rebuild with the real biomes (built lazily by updateFloorChunks).
      const fcx = Math.ceil(worldTilesX / FLOOR_CHUNK_TILES);
      for (let fy = Math.floor(y0 / FLOOR_CHUNK_TILES); fy * FLOOR_CHUNK_TILES < y0 + h; fy++) {
        for (let fx = Math.floor(x0 / FLOOR_CHUNK_TILES); fx * FLOOR_CHUNK_TILES < x0 + w; fx++) {
          const key = fy * fcx + fx;
          floorChunks.get(key)?.destroy({ children: true });
          floorChunks.delete(key);
        }
      }
      for (let y = y0; y < y0 + h; y += sm.f) for (let x = x0; x < x0 + w; x += sm.f) paintMinimapTile(y * worldTilesX + x);
    }
  }

  // ---- Fog-of-war minimap (DOM canvas, bottom-right; the main view is never fogged) ----
  // Static layer: one pixel per tile in an offscreen canvas, rebuilt whole only on `welcome` and
  // patched per tile on tileUpdate / explored. Each snapshot just blits it and draws the live dots
  // and camera rect on top, so nothing repaints the whole map per frame.
  const minimapEl = document.getElementById("minimap") as HTMLCanvasElement;
  minimapEl.addEventListener("contextmenu", (e) => e.preventDefault());
  const minimapCtx = minimapEl.getContext("2d")!;
  const minimapStatic = document.createElement("canvas");
  const minimapStaticCtx = minimapStatic.getContext("2d")!;
  let minimapImage: ImageData | null = null;
  let minimapStaticDirty = false;
  // The strategic map sprite's texture needs a re-upload from minimapStatic (done only in the Map band).
  let strategicMapDirty = false;
  let explored = new Uint8Array(0);
  const MINIMAP_TARGET_CSS_PX = 180;
  // Both integers, so tile -> pixel stays exact: CSS px per tile, and backing px per CSS px.
  let minimapCssPerTile = 1;
  let minimapDpr = 1;

  const MINIMAP_UNEXPLORED = 0x140d07;
  const MINIMAP_BIOME: Record<number, number> = {
    [Biome.Plains]: 0x6b7a3c,
    [Biome.Hills]: 0x8a7650,
    [Biome.Swamp]: 0x4c5a44,
  };
  const MINIMAP_WATER = 0x3d5f73;
  const MINIMAP_MOAT = 0x2f4f5f;
  const MINIMAP_TREE = 0x3c5428;
  const MINIMAP_ROCK = 0x8d8a80;
  const MINIMAP_IRON = 0x7d5644;
  const MINIMAP_WALL = 0xb8ad98;
  const MINIMAP_ROAD = 0xa8875a;
  const MINIMAP_BUILDING = 0xe0b468;
  const MINIMAP_RUIN = 0xa0322a;
  const MINIMAP_CAMP = 0xd2731a;
  const MINIMAP_ABBEY = 0xf0e6cc;
  const MINIMAP_RUIN_TILES = new Set<number>([
    TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble, TileType.Rubble,
  ]);
  const MINIMAP_CAMP_TILES = new Set<number>([
    TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence,
  ]);
  const MINIMAP_ABBEY_TILES = new Set<number>([TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost]);

  function minimapTileColor(index: number): number {
    if (!explored[index]) return MINIMAP_UNEXPLORED;
    // Forts phase A: an NPC fort's walls / buildings.
    if (siteOwners.has(index)) return MINIMAP_RUIN;
    const tile = tiles[index] ?? TileType.Empty;
    switch (tile) {
      case TileType.Empty:
        return MINIMAP_BIOME[biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Water:
        return MINIMAP_WATER;
      case TileType.Tree:
      case TileType.FruitTree:
      case TileType.FruitTreePicked:
        return MINIMAP_TREE;
      // Bushes and mushroom patches are ground cover: drawn as the biome under them.
      case TileType.BerryBush:
      case TileType.BerryBushPicked:
      case TileType.MushroomPatch:
      case TileType.MushroomPatchPicked:
        return MINIMAP_BIOME[biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Rock:
        return MINIMAP_ROCK;
      case TileType.IronOre:
        return MINIMAP_IRON;
      case TileType.Wall:
      case TileType.StoneWall:
      case TileType.Gate:
      case TileType.Drawbridge:
        return MINIMAP_WALL;
      case TileType.Moat:
        return MINIMAP_MOAT;
      case TileType.Road:
      case TileType.CobbleRoad:
        return MINIMAP_ROAD;
    }
    if (MINIMAP_RUIN_TILES.has(tile)) return MINIMAP_RUIN;
    if (MINIMAP_CAMP_TILES.has(tile)) return MINIMAP_CAMP;
    if (MINIMAP_ABBEY_TILES.has(tile)) return MINIMAP_ABBEY;
    // Every other tile is something the colony built (the Town Center also gets its own marker).
    return MINIMAP_BUILDING;
  }

  const MINIMAP_CLASS_COLOR: Record<number, number> = {
    [MinimapClass.Plains]: MINIMAP_BIOME[Biome.Plains], [MinimapClass.Hills]: MINIMAP_BIOME[Biome.Hills],
    [MinimapClass.Swamp]: MINIMAP_BIOME[Biome.Swamp], [MinimapClass.Water]: MINIMAP_WATER, [MinimapClass.Moat]: MINIMAP_MOAT,
    [MinimapClass.Tree]: MINIMAP_TREE, [MinimapClass.Rock]: MINIMAP_ROCK, [MinimapClass.Iron]: MINIMAP_IRON,
    [MinimapClass.Wall]: MINIMAP_WALL, [MinimapClass.Road]: MINIMAP_ROAD, [MinimapClass.Building]: MINIMAP_BUILDING,
    [MinimapClass.Ruin]: MINIMAP_RUIN, [MinimapClass.Camp]: MINIMAP_CAMP, [MinimapClass.Abbey]: MINIMAP_ABBEY,
  };
  // World streaming phase 4: one minimap pixel per f x f cell. A loaded chunk's cell is recomputed from its
  // tiles; elsewhere a structure arriving by tileUpdate overrides the welcome's summary.
  function paintMinimapCell(index: number) {
    const sm = streamed!;
    const tx = index % worldTilesX;
    const ty = Math.floor(index / worldTilesX);
    const cx = Math.floor(tx / sm.f);
    const cy = Math.floor(ty / sm.f);
    const cell = cy * sm.cw + cx;
    if (chunkLoaded[chunkOfTile(tx, ty)]) {
      sm.cells[cell] = minimapCellClass(tiles, biomes, worldTilesX, worldTilesY, cx, cy, sm.f, (i) => siteOwners.has(i));
    } else {
      const k = minimapClassOf(tiles[index] ?? 0, biomes[index] ?? 0, siteOwners.has(index));
      if (k >= MinimapClass.Wall) sm.cells[cell] = k;
    }
    if (explored[index]) sm.cellSeen[cell] = 1;
    paintMinimapPixel(cell, sm.cellSeen[cell] ? MINIMAP_CLASS_COLOR[sm.cells[cell]] : MINIMAP_UNEXPLORED);
  }
  function paintMinimapPixel(pixel: number, color: number) {
    const o = pixel * 4;
    minimapImage!.data[o] = color >> 16;
    minimapImage!.data[o + 1] = (color >> 8) & 0xff;
    minimapImage!.data[o + 2] = color & 0xff;
    minimapImage!.data[o + 3] = 255;
    minimapStaticDirty = true;
  }

  function paintMinimapTile(index: number) {
    if (!minimapImage) return;
    if (streamed) return paintMinimapCell(index);
    const color = minimapTileColor(index);
    const o = index * 4;
    minimapImage.data[o] = color >> 16;
    minimapImage.data[o + 1] = (color >> 8) & 0xff;
    minimapImage.data[o + 2] = color & 0xff;
    minimapImage.data[o + 3] = 255;
    minimapStaticDirty = true;
  }

  // `welcome` (join or restart): unpack the bitset and rebuild the whole static layer once.
  function resetMinimap(packedExplored: string) {
    const count = worldTilesX * worldTilesY;
    if (streamed) {
      explored = decodeMaskRuns(packedExplored, count);
    } else {
      const bytes = atob(packedExplored);
      explored = new Uint8Array(count);
      for (let i = 0; i < count; i++) explored[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
    }
    // World streaming phase 4: a streamed world's minimap is one CSS px per summary cell (1 / f px per tile).
    minimapCssPerTile = streamed ? 1 / streamed.f : Math.max(1, Math.round(MINIMAP_TARGET_CSS_PX / Math.max(worldTilesX, worldTilesY)));
    minimapDpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const scale = minimapCssPerTile * minimapDpr;
    minimapEl.width = Math.ceil(worldTilesX * scale);
    minimapEl.height = Math.ceil(worldTilesY * scale);
    minimapEl.style.width = `${worldTilesX * minimapCssPerTile}px`;
    minimapEl.style.height = `${worldTilesY * minimapCssPerTile}px`;
    if (streamed) {
      const sm = streamed;
      for (let i = 0; i < count; i++) if (explored[i]) sm.cellSeen[Math.floor(Math.floor(i / worldTilesX) / sm.f) * sm.cw + Math.floor((i % worldTilesX) / sm.f)] = 1;
      minimapStatic.width = sm.cw;
      minimapStatic.height = sm.ch;
      minimapImage = minimapStaticCtx.createImageData(sm.cw, sm.ch);
      for (let c = 0; c < sm.cw * sm.ch; c++) paintMinimapPixel(c, sm.cellSeen[c] ? MINIMAP_CLASS_COLOR[sm.cells[c]] : MINIMAP_UNEXPLORED);
    } else {
      minimapStatic.width = worldTilesX;
      minimapStatic.height = worldTilesY;
      minimapImage = minimapStaticCtx.createImageData(worldTilesX, worldTilesY);
      for (let i = 0; i < count; i++) paintMinimapTile(i);
    }
    // The canvas was resized: a fresh texture for the strategic map sprite.
    if (strategicMapSprite.texture !== Texture.EMPTY) strategicMapSprite.texture.destroy(true);
    strategicMapSprite.texture = new Texture({ source: new CanvasSource({ resource: minimapStatic, scaleMode: "nearest" }) });
    strategicMapSprite.scale.set(tileSize * (streamed?.f ?? 1));
    strategicMapDirty = true;
  }

  function markExplored(indices: number[]) {
    for (const i of indices) {
      if (i < 0 || i >= explored.length || explored[i]) continue;
      explored[i] = 1;
      paintMinimapTile(i);
    }
  }

  // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with the
  // server's vision radii (minimap enemy dots and the strategy fog share it).
  function liveVisionSources(players: PlayerSnapshot[], colonists: ColonistSnapshot[]): VisionSource[] {
    const tileOf = (worldPx: number) => Math.floor(worldPx / tileSize);
    const sources: VisionSource[] = [];
    for (const p of players) sources.push({ x: tileOf(p.x), y: tileOf(p.y), r: VISION_RADIUS_PLAYER });
    for (const c of colonists) {
      if (tiles[c.postY * worldTilesX + c.postX] === TileType.AbbeyHall) continue;
      sources.push({ x: tileOf(c.x), y: tileOf(c.y), r: VISION_RADIUS_COLONIST });
    }
    return sources;
  }

  function cssColor(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
  }

  function drawMinimap(players: PlayerSnapshot[], colonists: ColonistSnapshot[], mobs: MobSnapshot[]) {
    if (!minimapImage) return;
    if (minimapStaticDirty) {
      minimapStaticCtx.putImageData(minimapImage, 0, 0);
      minimapStaticDirty = false;
      strategicMapDirty = true;
    }
    const ctx = minimapCtx;
    const s = minimapCssPerTile * minimapDpr; // backing px per tile
    const u = minimapDpr; // backing px per CSS px
    const toMap = (worldPx: number) => (worldPx / tileSize) * s;
    const tileOf = (worldPx: number) => Math.floor(worldPx / tileSize);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(minimapStatic, 0, 0, worldTilesX * s, worldTilesY * s);

    // Forts phase B: a flag on each explored fort's keep (faction colour; grey = razed, clan colour = captured).
    for (const f of fortMarkers) {
      const fx = (f.keepX + 0.5) * s;
      const fy = (f.keepY + 0.5) * s;
      const color = f.captured
        ? `#${(clanColors.get(f.capturedBy ?? 0) ?? 0x3a7bd5).toString(16).padStart(6, "0")}`
        : f.cleared ? "#8a8a8a" : f.hostile ? "#c0392b"
        : f.vassalOf !== undefined && f.vassalOf !== myClan ? "#a0743a"
        : f.faction === "human" && f.num !== undefined && siteRelations.has(f.num) ? RELATION_TIER_COLOR[siteRelations.get(f.num)!.tier]
        : FORT_FLAG_COLOR[f.faction];
      // Forts phase C: a human settlement's flag has a green edge (white = neutral, red = hostile).
      ctx.fillStyle = f.faction === "human" && !f.captured && !f.cleared ? "#2e8b3a" : "#1a1008";
      ctx.fillRect(fx - 0.5 * u, fy - 7 * u, 1.5 * u, 9 * u);
      ctx.fillRect(fx + u - 0.5 * u, fy - 7.5 * u, 7 * u, 5 * u);
      ctx.fillStyle = color;
      ctx.fillRect(fx + u, fy - 7 * u, 6 * u, 4 * u);
      // Forts phase F: a crown over this clan's vassals.
      if (f.vassalOf !== undefined && f.vassalOf === myClan && !f.cleared && !f.captured) {
        ctx.fillStyle = "#f1c40f";
        ctx.fillRect(fx + u, fy - 9.5 * u, 6 * u, 1.5 * u);
        for (const dx of [1, 3.5, 6]) ctx.fillRect(fx + dx * u - 0.5 * u, fy - 11 * u, u, 1.5 * u);
      }
    }
    for (const { x: tcX, y: tcY } of latestTownCenters) {
      const size = 7 * u;
      const cx = (tcX + 0.5) * s;
      const cy = (tcY + 0.5) * s;
      ctx.fillStyle = "#2e1a0c";
      ctx.fillRect(cx - size / 2 - u, cy - size / 2 - u, size + 2 * u, size + 2 * u);
      ctx.fillStyle = "#7a1f1a";
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(cx - 1.5 * u, cy - 1.5 * u, 3 * u, 3 * u);
    }

    // Forts phase D2: a quest marker (gold diamond; green once accepted) on each open quest's target tile.
    for (const q of latestQuests) {
      const qx = (q.x + 0.5) * s;
      const qy = (q.y + 0.5) * s;
      const r = 4.5 * u;
      // Batch 2 (SPRITES.md #81): the quest seal icon once it has loaded, else the drawn diamond.
      const seal = q.accepted ? QUEST_MARKER_IMAGES.active : QUEST_MARKER_IMAGES.fresh;
      if (seal.complete && seal.naturalWidth > 0) {
        ctx.drawImage(seal, qx - 2.2 * r, qy - 2.2 * r, 4.4 * r, 4.4 * r);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(qx, qy - r - u);
      ctx.lineTo(qx + r + u, qy);
      ctx.lineTo(qx, qy + r + u);
      ctx.lineTo(qx - r - u, qy);
      ctx.closePath();
      ctx.fillStyle = "#1a0f06";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(qx, qy - r);
      ctx.lineTo(qx + r, qy);
      ctx.lineTo(qx, qy + r);
      ctx.lineTo(qx - r, qy);
      ctx.closePath();
      ctx.fillStyle = q.accepted ? "#5fd35a" : "#f1c40f";
      ctx.fill();
    }

    // Camp hearths, once explored: a small ember dot with a dark rim on the camp's centre.
    for (const index of latestHearths) {
      if (!explored[index]) continue;
      const cx = ((index % worldTilesX) + 0.5) * s;
      const cy = (Math.floor(index / worldTilesX) + 0.5) * s;
      const r = 2.5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - r - u, cy - r - u, 2 * (r + u), 2 * (r + u));
      ctx.fillStyle = "#ff7a1a";
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }

    // The Castle Ruin, once its centre tile is explored: its 9x9 walls outlined, a red keep in the middle.
    if (castleRuinTile && explored[castleRuinTile.y * worldTilesX + castleRuinTile.x]) {
      const half = 4.5 * s;
      const cx = (castleRuinTile.x + 0.5) * s;
      const cy = (castleRuinTile.y + 0.5) * s;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = "#d8cfbf";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      const keep = 5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - keep / 2 - u, cy - keep / 2 - u, keep + 2 * u, keep + 2 * u);
      ctx.fillStyle = "#a8321e";
      ctx.fillRect(cx - keep / 2, cy - keep / 2, keep, keep);
    }

    // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with
    // the server's vision radii. Mobs outside it aren't drawn, even on explored ground.
    const sources = liveVisionSources(players, colonists).map((v) => ({ x: v.x, y: v.y, r2: v.r * v.r }));

    ctx.fillStyle = "#f3da98";
    for (const c of colonists) {
      if (!explored[tileOf(c.y) * worldTilesX + tileOf(c.x)]) continue;
      ctx.fillRect(Math.round(toMap(c.x) - u), Math.round(toMap(c.y) - u), 2 * u, 2 * u);
    }
    // Forts phase E: own trader wagons on the road, a bigger gold dot with a dark rim.
    for (const c of colonists) {
      if (!c.wagon || c.wagon.leg === "home" || (c.clan ?? 0) !== myClan) continue;
      const r = 2.5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(toMap(c.x) - r - u, toMap(c.y) - r - u, 2 * (r + u), 2 * (r + u));
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(toMap(c.x) - r, toMap(c.y) - r, 2 * r, 2 * r);
    }
    ctx.fillStyle = "#f3da98";

    for (const m of mobs) {
      const mx = tileOf(m.x);
      const my = tileOf(m.y);
      const seen = sources.some((src) => (src.x - mx) ** 2 + (src.y - my) ** 2 <= src.r2);
      if (!seen) continue;
      const x = Math.round(toMap(m.x) - 1.5 * u);
      const y = Math.round(toMap(m.y) - 1.5 * u);
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(x - u, y - u, 5 * u, 5 * u);
      ctx.fillStyle = "#ff3b2a";
      ctx.fillRect(x, y, 3 * u, 3 * u);
    }

    for (const p of players) {
      if (p.id === myId) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.y), 3 * u, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(p.color);
      ctx.fill();
      ctx.lineWidth = u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
    }

    const me = players.find((p) => p.id === myId);
    if (me) {
      ctx.beginPath();
      ctx.arc(toMap(me.x), toMap(me.y), 4 * u, 0, Math.PI * 2);
      ctx.lineWidth = 3.5 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
      ctx.lineWidth = 1.75 * u;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // Main camera viewport (worldLayer is scaled by camZoom and offset to the camera focus).
    const viewX = toMap(-worldLayer.position.x / camZoom);
    const viewY = toMap(-worldLayer.position.y / camZoom);
    const viewW = toMap(app.screen.width / camZoom);
    const viewH = toMap(app.screen.height / camZoom);
    ctx.lineWidth = u;
    ctx.strokeStyle = "rgba(251, 236, 200, 0.85)";
    ctx.strokeRect(Math.round(viewX) + u / 2, Math.round(viewY) + u / 2, Math.round(viewW) - u, Math.round(viewH) - u);
    drawFightPings(ctx, s, u);
  }

  // ---- Off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23") ----
  // The snapshot's per-player `fights` (server-clustered) become one DOM arrow each, clamped to the
  // screen rim by placeEdgeArrow and hidden while the fight is on screen; a fight the server drops fades
  // out over FIGHT_ARROW_FADE_MS. Clicking an arrow pans the camera there for FIGHT_PEEK_MS (any
  // movement key returns it to the player). The minimap pings every listed fight, and the first time a
  // fight begins off-screen a toast names it (at most one per FIGHT_TOAST_THROTTLE_MS).
  const fightArrowLayer = document.getElementById("fight-arrows")!;
  interface FightArrow {
    fight: FightSnapshot;
    el: HTMLButtonElement;
    chevron: HTMLElement;
    title: HTMLElement;
    sub: HTMLElement;
    goneAt: number;
  }
  const fightArrows = new Map<number, FightArrow>();
  const FIGHT_ARROW_FADE_MS = 600;
  // Kept clear of the top button row / toasts and the bottom command bar.
  const FIGHT_ARROW_INSETS = { top: 70, right: 40, bottom: 56, left: 40 };
  const FIGHT_LABEL_OFFSET_PX = 34;
  const FIGHT_TOAST_THROTTLE_MS = 20000;
  const FIGHT_PEEK_MS = 4000;
  const FIGHT_PEEK_EASE = 0.18;
  let latestFights: FightSnapshot[] = [];
  const announcedFightIds = new Set<number>();
  let lastFightToastAt = -Infinity;
  let fightPeek: { x: number; y: number; until: number } | null = null;
  // The eased camera focus while peeking or easing back (null = locked on the player).
  let fightPeekCam: { x: number; y: number } | null = null;

  function fightPeekFocus(playerX: number, playerY: number): { x: number; y: number } {
    if (fightPeek) {
      const input = currentInput();
      if (performance.now() > fightPeek.until || input.dx !== 0 || input.dy !== 0) fightPeek = null;
    }
    if (!fightPeek && !fightPeekCam) return { x: playerX, y: playerY };
    const cam = fightPeekCam ?? { x: playerX, y: playerY };
    const tx = fightPeek ? fightPeek.x : playerX;
    const ty = fightPeek ? fightPeek.y : playerY;
    cam.x += (tx - cam.x) * FIGHT_PEEK_EASE;
    cam.y += (ty - cam.y) * FIGHT_PEEK_EASE;
    fightPeekCam = cam;
    if (!fightPeek && Math.hypot(cam.x - playerX, cam.y - playerY) < 2) {
      fightPeekCam = null;
      return { x: playerX, y: playerY };
    }
    return cam;
  }

  function fightWorldPos(f: FightSnapshot): { x: number; y: number } {
    return { x: (f.x + 0.5) * tileSize, y: (f.y + 0.5) * tileSize };
  }

  function fightTitle(f: FightSnapshot): string {
    return f.buildings && !f.units && !f.you ? "Under attack" : f.label;
  }

  function fightIsOnScreen(f: FightSnapshot): boolean {
    const w = fightWorldPos(f);
    return placeEdgeArrow(
      app.screen.width, app.screen.height,
      worldLayer.position.x + w.x * camZoom, worldLayer.position.y + w.y * camZoom, FIGHT_ARROW_INSETS
    ).onScreen;
  }

  // Direction and distance in tiles from the local player (the camera centre if there is none).
  function fightBearing(f: FightSnapshot): { dir: string; tiles: number } {
    const me = myId ? playerSprites.get(myId) : undefined;
    const ox = me ? me.sprite.position.x / tileSize : (app.screen.width / 2 - worldLayer.position.x) / camZoom / tileSize;
    const oy = me ? me.sprite.position.y / tileSize : (app.screen.height / 2 - worldLayer.position.y) / camZoom / tileSize;
    const dx = f.x + 0.5 - ox;
    const dy = f.y + 0.5 - oy;
    return { dir: compassDirection(dx, dy), tiles: Math.round(Math.hypot(dx, dy)) };
  }

  function createFightArrow(f: FightSnapshot): FightArrow {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "fight-arrow";
    const chevron = document.createElement("span");
    chevron.className = "fight-chevron";
    const label = document.createElement("span");
    label.className = "fight-label";
    const title = document.createElement("span");
    const sub = document.createElement("small");
    label.append(title, sub);
    el.append(chevron, label);
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const arrow = fightArrows.get(f.id);
      const target = fightWorldPos(arrow ? arrow.fight : f);
      if (strategyCam.inStrategy) strategyCam.jumpTo(target.x, target.y);
      else fightPeek = { x: target.x, y: target.y, until: performance.now() + FIGHT_PEEK_MS };
      el.blur();
    });
    fightArrowLayer.append(el);
    return { fight: f, el, chevron, title, sub, goneAt: 0 };
  }

  function clearFightArrows() {
    for (const a of fightArrows.values()) a.el.remove();
    fightArrows.clear();
    latestFights = [];
    announcedFightIds.clear();
    fightPeek = null;
    fightPeekCam = null;
  }

  function syncFights(fights: FightSnapshot[] | undefined) {
    latestFights = fights ?? [];
    const now = performance.now();
    const seen = new Set<number>();
    for (const f of latestFights) {
      seen.add(f.id);
      let arrow = fightArrows.get(f.id);
      if (!arrow) {
        arrow = createFightArrow(f);
        fightArrows.set(f.id, arrow);
      }
      arrow.fight = f;
      arrow.goneAt = 0;
      arrow.el.className = `fight-arrow fight-i${f.intensity}`;
      arrow.el.title = `${f.label}: ${f.combatants} fighting${f.you ? " (you)" : ""} - click to look`;
      if (!announcedFightIds.has(f.id)) {
        announcedFightIds.add(f.id);
        if (now - lastFightToastAt >= FIGHT_TOAST_THROTTLE_MS && !fightIsOnScreen(f)) {
          lastFightToastAt = now;
          const { dir, tiles } = fightBearing(f);
          pushEventToast("raid", `${fightTitle(f)} to the ${dir} (${tiles} tiles)`);
        }
      }
    }
    for (const [id, arrow] of fightArrows) {
      if (!seen.has(id) && arrow.goneAt === 0) arrow.goneAt = now;
    }
  }

  app.ticker.add(() => {
    if (fightArrows.size === 0) return;
    const now = performance.now();
    for (const [id, a] of fightArrows) {
      const gone = a.goneAt ? now - a.goneAt : 0;
      if (gone >= FIGHT_ARROW_FADE_MS) {
        a.el.remove();
        fightArrows.delete(id);
        continue;
      }
      const w = fightWorldPos(a.fight);
      const p = placeEdgeArrow(
        app.screen.width, app.screen.height,
        worldLayer.position.x + w.x * camZoom, worldLayer.position.y + w.y * camZoom, FIGHT_ARROW_INSETS
      );
      a.el.hidden = p.onScreen;
      if (p.onScreen) continue;
      a.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      a.chevron.style.transform = `rotate(${p.angle.toFixed(3)}rad)`;
      // The label sits just inside the rim, opposite the point.
      const label = a.title.parentElement!;
      label.style.left = `${(-Math.cos(p.angle) * FIGHT_LABEL_OFFSET_PX * 1.6).toFixed(1)}px`;
      label.style.top = `${(-Math.sin(p.angle) * FIGHT_LABEL_OFFSET_PX).toFixed(1)}px`;
      const pulse = 0.8 + 0.2 * Math.sin(now / (a.fight.intensity >= 3 ? 110 : a.fight.intensity === 2 ? 160 : 220));
      a.el.style.opacity = (fightArrowAlpha(a.fight.quiet, FIGHT_WINDOW_SECONDS, gone, FIGHT_ARROW_FADE_MS) * pulse).toFixed(3);
      const { dir, tiles } = fightBearing(a.fight);
      const title = `${fightTitle(a.fight)} · ${dir}`;
      const sub = `${tiles} tiles${a.fight.you ? " · you" : ""}`;
      if (a.title.textContent !== title) a.title.textContent = title;
      if (a.sub.textContent !== sub) a.sub.textContent = sub;
    }
  });

  // Expanding rings on the minimap at every listed fight (on or off screen), faster and wider the
  // fiercer it is. Called at the end of drawMinimap, in its backing-pixel space.
  function drawFightPings(ctx: CanvasRenderingContext2D, s: number, u: number) {
    if (latestFights.length === 0) return;
    const now = performance.now();
    for (const f of latestFights) {
      const cx = (f.x + 0.5) * s;
      const cy = (f.y + 0.5) * s;
      const period = f.intensity >= 3 ? 700 : f.intensity === 2 ? 950 : 1200;
      const phase = ((now + f.id * 137) % period) / period;
      const fade = Math.max(0.25, Math.min(1, FIGHT_WINDOW_SECONDS - f.quiet));
      ctx.beginPath();
      ctx.arc(cx, cy, (3 + phase * (5 + 2 * f.intensity)) * u, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = `rgba(255, 70, 40, ${((1 - phase) * fade).toFixed(3)})`;
      ctx.stroke();
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u);
      ctx.fillStyle = f.you || f.units || f.buildings ? "#ff3b2a" : "#f1c40f";
      ctx.fillRect(cx - u, cy - u, 2 * u, 2 * u);
    }
  }

  // Core stats (wood/iron/rock/gold/pop/time/happiness/army/selected) used to live here as a
  // floating canvas HUD; they're now DOM elements pinned to the top of #economy-panel, merged
  // into the same single menu as the goods/market panel. See the DOM refs set up below.

  const pausedBanner = new Text({
    text: "PAUSED",
    style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
  });
  pausedBanner.anchor.set(0.5);
  pausedBanner.visible = false;
  app.stage.addChild(pausedBanner);

  app.ticker.add(() => {
    pausedBanner.position.set(app.screen.width / 2, app.screen.height / 2);
  });

  // ---- Economy panel (DOM): goods stockpile + Market / Gold Shop, left side ----
  // The canvas HUD keeps the core numbers (wood/iron/rock/gold/pop/time); everything else lives here.

  type GoodKey =
    | "wood"
    | "iron"
    | "rock"
    | "gold"
    | "grain"
    | "meat"
    | "fruit"
    | "wool"
    | "cotton"
    | "clothes"
    | "tools"
    | "luxuryItems"
    | "alcohol";
  const GOODS_GROUPS: { heading: string; goods: { key: GoodKey; label: string }[] }[] = [
    {
      heading: "Food",
      goods: [
        { key: "grain", label: "Grain" },
        { key: "meat", label: "Meat" },
        { key: "fruit", label: "Fruit" },
      ],
    },
    {
      heading: "Materials",
      goods: [
        { key: "wood", label: "Wood" },
        { key: "iron", label: "Iron" },
        { key: "rock", label: "Rock" },
        { key: "gold", label: "Gold" },
        { key: "wool", label: "Wool" },
        { key: "cotton", label: "Hemp" },
      ],
    },
    {
      heading: "Crafted",
      goods: [
        { key: "clothes", label: "Clothes" },
        { key: "tools", label: "Tools" },
        { key: "luxuryItems", label: "Luxury Items" },
        { key: "alcohol", label: "Alcohol" },
      ],
    },
  ];

  const economyPanel = document.getElementById("economy-panel")!;
  const economyPanelToggle = document.getElementById("economy-panel-toggle")!;
  economyPanelToggle.addEventListener("click", () => {
    economyPanel.classList.toggle("collapsed");
    economyPanelToggle.classList.toggle("panel-open", !economyPanel.classList.contains("collapsed"));
    economyPanelToggle.blur();
  });

  // Core colony stats, pinned at the top of the same single menu as the goods/market panel.
  const statPopEl = document.getElementById("stat-pop")!;
  const statTimeEl = document.getElementById("stat-time")!;
  const sundialEl = document.getElementById("sundial")!;
  const sundialHandEl = document.getElementById("sundial-hand")!;
  const sundialNightArcEl = document.getElementById("sundial-night-arc")!;
  let sundialDayFraction = -1;
  const statHappinessEl = document.getElementById("stat-happiness")! as HTMLElement;
  const statArmyEl = document.getElementById("stat-army")!;
  const statSelectedEl = document.getElementById("stat-selected")!;

  // The latest stock numbers (the Crafting panel's have / need counts).
  const latestStock: Partial<Record<GoodKey, number>> = {};
  const workerCountEls = new Map<string, HTMLSpanElement>();
  const goodsWorkerEls = new Map<GoodKey, HTMLSpanElement>();
  // Which goods group a worker's job feeds: Food (barn farmers, pastures, orchards), Materials
  // (lumberjacks, miners, wool/hemp fields) or Crafted (artisans). Null for non-workers.
  function workerGroup(c: { kind: string; postX: number; postY: number }): string | null {
    switch (c.kind) {
      case "farmer":
        return "Food";
      case "lumberjack":
      case "ironMiner":
      case "rockMiner":
        return "Materials";
      case "artisan":
        return "Crafted";
      case "hunter":
      case "forager":
        return "Food";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.WoolFarm || t === TileType.CottonFarm ? "Materials" : "Food";
      }
      default:
        return null;
    }
  }
  // The single resource a worker's job produces (artisans by their shop; the Tavern's brewers make gold).
  function workerResource(c: { kind: string; postX: number; postY: number }): GoodKey | null {
    switch (c.kind) {
      case "farmer":
        return "grain";
      case "lumberjack":
        return "wood";
      case "ironMiner":
        return "iron";
      case "rockMiner":
        return "rock";
      case "hunter":
        return "meat";
      case "forager":
        return "fruit";
      case "farmhand": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.Orchard ? "fruit" : t === TileType.WoolFarm ? "wool" : t === TileType.CottonFarm ? "cotton" : "meat";
      }
      case "artisan": {
        const t = tileAt(c.postX, c.postY);
        return t === TileType.TailorShop
          ? "clothes"
          : t === TileType.Blacksmith
          ? "tools"
          : t === TileType.LuxuryWorkshop
          ? "luxuryItems"
          : t === TileType.Brewery
          ? "alcohol"
          : t === TileType.Tavern
          ? "gold"
          : null;
      }
      default:
        return null;
    }
  }
  // Barn farmers have no work animation of their own (the plots grow while the barn is staffed), so by
  // day they count as working; hunters and foragers count while they're out on a job.
  function isWorkerBusy(c: { kind: string; state: string }, isNight: boolean): boolean {
    if (COLONIST_ACTION_STATES.has(c.state)) return true;
    if (c.kind === "farmer") return !isNight;
    return (c.kind === "hunter" || c.kind === "forager") && FOOD_WORKER_BUSY_STATES.has(c.state);
  }
  function refreshWorkerCounts(colonists: { kind: string; state: string; postX: number; postY: number }[], isNight: boolean) {
    const working: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    const total: Record<string, number> = { Food: 0, Materials: 0, Crafted: 0 };
    for (const c of colonists) {
      const group = workerGroup(c);
      if (!group) continue;
      total[group]++;
      if (isWorkerBusy(c, isNight)) working[group]++;
    }
    for (const [group, el] of workerCountEls) el.textContent = ` ${working[group]}/${total[group]} working`;
    const resWorking = new Map<GoodKey, number>();
    const resTotal = new Map<GoodKey, number>();
    for (const c of colonists) {
      const res = workerResource(c);
      if (!res) continue;
      resTotal.set(res, (resTotal.get(res) ?? 0) + 1);
      if (isWorkerBusy(c, isNight)) {
        resWorking.set(res, (resWorking.get(res) ?? 0) + 1);
      }
    }
    for (const [res, el] of goodsWorkerEls) {
      const total = resTotal.get(res) ?? 0;
      el.textContent = total > 0 ? ` ${resWorking.get(res) ?? 0}/${total}` : "";
    }
  }
  // Resources panel: every stock resource (GOODS_GROUPS), every progression item (PROGRESSION.items, by its `group`)
  // and the armoury's gear, in collapsible groups (folded state and "hide empty" remembered per browser).
  const goodsListEl = document.getElementById("goods-list")!;
  const GOODS_FOLD_PREF = "sworn.goodsFolded";
  const GOODS_HIDE_ZERO_PREF = "sworn.goodsHideZero";
  const readPref = (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const writePref = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked: the panel still works */
    }
  };
  let foldedGroups = new Set<string>();
  try {
    foldedGroups = new Set(JSON.parse(readPref(GOODS_FOLD_PREF) ?? "[]") as string[]);
  } catch {
    foldedGroups = new Set();
  }
  // Every row by key: a stock resource ("wood"), an item ("item:hide") or gear ("gear:armour:1").
  const goodsRows = new Map<string, { row: HTMLDivElement; value: HTMLSpanElement }>();
  function setGoodCount(key: string, n: number) {
    const r = goodsRows.get(key);
    if (!r) return;
    const text = String(n);
    if (r.value.textContent !== text) r.value.textContent = text;
    r.row.classList.toggle("zero", n <= 0);
  }
  const showAllBtn = document.createElement("button");
  showAllBtn.id = "goods-show-all";
  const applyHideZero = (hide: boolean) => {
    goodsListEl.classList.toggle("hide-zero", hide);
    showAllBtn.textContent = hide ? "Show all (incl. none in stock)" : "Hide empty";
  };
  applyHideZero(readPref(GOODS_HIDE_ZERO_PREF) === "1");
  showAllBtn.addEventListener("click", () => {
    const hide = !goodsListEl.classList.contains("hide-zero");
    applyHideZero(hide);
    writePref(GOODS_HIDE_ZERO_PREF, hide ? "1" : "0");
    showAllBtn.blur();
  });
  goodsListEl.appendChild(showAllBtn);
  const ITEM_GROUP_HEADING: Record<"food" | "material" | "tool", string> = { food: "Food", material: "Materials", tool: "Crafted" };
  const groupRows: { heading: string; label: string; rows: { key: string; label: string; icon?: string; good?: GoodKey }[] }[] = GOODS_GROUPS.map((g) => ({
    heading: g.heading,
    label: g.heading === "Crafted" ? "Crafted & tools" : g.heading,
    // The resource is Hemp (internal key "cotton" is kept so the protocol stays unchanged).
    rows: g.goods.map((good) => ({ key: good.key, label: good.label, icon: `/sprites/icon-${good.key === "cotton" ? "hemp" : good.key}.png`, good: good.key })),
  }));
  for (const [id, def] of Object.entries(PROGRESSION.items) as [ItemId, (typeof PROGRESSION.items)[ItemId]][]) {
    groupRows.find((g) => g.heading === ITEM_GROUP_HEADING[def.group])!.rows.push({ key: `item:${id}`, label: def.label });
  }
  groupRows.push({
    heading: "Gear",
    label: "Gear (armoury)",
    rows: [1, 2, 3].flatMap((t) => [
      { key: `gear:weapon:${t}`, label: `Weapons T${t}` },
      { key: `gear:armour:${t}`, label: `Armour T${t}` },
    ]),
  });
  for (const group of groupRows) {
    const heading = document.createElement("div");
    heading.className = "econ-heading econ-fold";
    heading.append(group.label);
    heading.title = "Click to fold / unfold";
    const workerCount = document.createElement("span");
    workerCount.className = "econ-workers";
    workerCount.title = "Workers working / assigned";
    heading.appendChild(workerCount);
    if (group.heading !== "Gear") workerCountEls.set(group.heading, workerCount);
    const body = document.createElement("div");
    body.className = "econ-group";
    const setFolded = (folded: boolean) => {
      body.hidden = folded;
      heading.classList.toggle("folded", folded);
    };
    setFolded(foldedGroups.has(group.heading));
    heading.addEventListener("click", () => {
      const folded = !body.hidden;
      setFolded(folded);
      if (folded) foldedGroups.add(group.heading);
      else foldedGroups.delete(group.heading);
      writePref(GOODS_FOLD_PREF, JSON.stringify([...foldedGroups]));
    });
    goodsListEl.append(heading, body);
    for (const good of group.rows) {
      const row = document.createElement("div");
      row.className = "econ-row zero";
      const label = document.createElement("span");
      label.className = "econ-label";
      if (good.icon) {
        const icon = document.createElement("img");
        icon.className = "econ-icon";
        icon.src = good.icon;
        icon.alt = "";
        label.append(icon);
      } else {
        // Items have no icon art yet: a lettered chip stands in.
        const glyph = document.createElement("span");
        glyph.className = "econ-glyph";
        glyph.textContent = good.label.charAt(0);
        label.append(glyph);
      }
      label.append(good.label);
      if (good.good) {
        const workers = document.createElement("span");
        workers.className = "econ-workers-row";
        workers.title = "Workers working / assigned to this resource";
        label.append(workers);
        goodsWorkerEls.set(good.good, workers);
      }
      const value = document.createElement("span");
      value.textContent = "0";
      row.append(label, value);
      body.appendChild(row);
      goodsRows.set(good.key, { row, value });
    }
  }

  // Mirrors the server's EXCHANGE_RATES / GOLD_SHOP_PRICES; the server re-validates every request.
  type BaseResource = "wood" | "iron" | "rock";
  type ShopItem = "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock";
  const RESOURCE_LABEL: Record<string, string> = {
    wood: "Wood",
    iron: "Iron",
    rock: "Rock",
    tools: "Tools",
    clothes: "Clothes",
    luxuryItems: "Luxury Item",
  };
  const MARKET_TRADES: { from: BaseResource; to: BaseResource; give: number; get: number }[] = [
    { from: "wood", to: "iron", give: 3, get: 1 },
    { from: "wood", to: "rock", give: 3, get: 1 },
    { from: "iron", to: "wood", give: 3, get: 1 },
    { from: "iron", to: "rock", give: 2, get: 1 },
    { from: "rock", to: "wood", give: 3, get: 1 },
    { from: "rock", to: "iron", give: 2, get: 1 },
  ];
  const GOLD_SHOP_ITEMS: { item: ShopItem; cost: number; amount: number }[] = [
    { item: "tools", cost: 10, amount: 1 },
    { item: "clothes", cost: 8, amount: 1 },
    { item: "luxuryItems", cost: 20, amount: 1 },
    { item: "wood", cost: 5, amount: 5 },
    { item: "iron", cost: 8, amount: 5 },
    { item: "rock", cost: 8, amount: 5 },
  ];

  const marketSection = document.getElementById("market-section")!;
  const goldShopSection = document.getElementById("gold-shop-section")!;
  const marketButtons: { btn: HTMLButtonElement; from: BaseResource; give: number }[] = [];
  const goldShopButtons: { btn: HTMLButtonElement; cost: number }[] = [];

  function sendMessage(msg: object) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }
  // Creative mode panel (shown only in creative worlds).
  const creativeUi = setupCreative({
    send: sendMessage,
    centre: () => ({ x: (app.screen.width / 2 - worldLayer.position.x) / camZoom, y: (app.screen.height / 2 - worldLayer.position.y) / camZoom }),
    toast: (ok, text) => pushEventToast(ok ? "build" : "death", text),
    selectedIds: () => Array.from(selectedIds),
  });

  function makeEconButton(container: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "econ-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      onClick();
      // Never keep focus: Space is the attack key and would re-trigger a focused button.
      btn.blur();
    });
    container.appendChild(btn);
    return btn;
  }

  const marketBtnsEl = document.getElementById("market-btns")!;
  for (const trade of MARKET_TRADES) {
    const btn = makeEconButton(
      marketBtnsEl,
      `${trade.give} ${RESOURCE_LABEL[trade.from]} → ${trade.get} ${RESOURCE_LABEL[trade.to]}`,
      () => sendMessage({ type: "exchangeResource", from: trade.from, to: trade.to })
    );
    marketButtons.push({ btn, from: trade.from, give: trade.give });
  }

  const goldShopBtnsEl = document.getElementById("gold-shop-btns")!;
  for (const offer of GOLD_SHOP_ITEMS) {
    const btn = makeEconButton(
      goldShopBtnsEl,
      `${offer.amount} ${RESOURCE_LABEL[offer.item]} — ${offer.cost} gold`,
      () => sendMessage({ type: "buyWithGold", item: offer.item })
    );
    goldShopButtons.push({ btn, cost: offer.cost });
  }

  function refreshEconomyPanel(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    for (const g of GOODS_GROUPS) for (const good of g.goods) {
      setGoodCount(good.key, snap[good.key]);
      latestStock[good.key] = snap[good.key];
    }
    if (!craftPanelEl.hidden) renderCraftPanel();
    // Sections stay hidden (not greyed out) until their building exists.
    marketSection.hidden = !snap.marketBuilt;
    goldShopSection.hidden = !snap.goldShopBuilt;
    for (const { btn, from, give } of marketButtons) btn.disabled = snap[from] < give;
    for (const { btn, cost } of goldShopButtons) btn.disabled = snap.gold < cost;
  }

  // ---- Toolbar (real DOM elements, not canvas-drawn) ----

  let currentTool: TileType = TileType.Wall;
  const toolButtonEls = new Map<TileType, HTMLButtonElement>();
  let activeCategory: ToolCategory = TOOL_CATEGORIES[0].key;
  const categoryTabEls = new Map<ToolCategory, HTMLButtonElement>();

  function setupToolbar() {
    const container = document.getElementById("toolbar")!;
    for (const tool of TOOLS) {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      btn.textContent = tool.key ? `${tool.label} (${tool.key})` : tool.label;
      btn.addEventListener("click", () => {
        selectTool(tool.tile, true);
        btn.blur();
      });
      container.appendChild(btn);
      toolButtonEls.set(tool.tile, btn);
    }
    refreshToolbarSelection();
  }

  function setupCategoryTabs() {
    const container = document.getElementById("build-category-tabs")!;
    for (const cat of TOOL_CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "category-tab";
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        activeCategory = cat.key;
        refreshToolbarVisibility();
        refreshCategoryTabSelection();
        btn.blur();
      });
      container.appendChild(btn);
      categoryTabEls.set(cat.key, btn);
    }
    refreshCategoryTabSelection();
  }

  function refreshCategoryTabSelection() {
    for (const [key, btn] of categoryTabEls) {
      btn.classList.toggle("selected", key === activeCategory);
    }
  }

  // Break is pinned and always shown, regardless of the active category tab.
  function refreshToolbarVisibility() {
    for (const tool of TOOLS) {
      const btn = toolButtonEls.get(tool.tile);
      if (!btn) continue;
      const visible = tool.tile === TileType.Empty || tool.category === activeCategory;
      btn.style.display = visible ? "" : "none";
    }
  }

  function refreshToolbarSelection() {
    for (const [tile, btn] of toolButtonEls) {
      btn.classList.toggle("selected", tile === currentTool);
    }
  }

  function selectTool(tile: TileType, fromUser = false) {
    currentTool = tile;
    // Picking something to build puts the units down, so right-click places instead of giving orders.
    if (fromUser && tile !== TileType.Empty && selectedIds.size > 0) setSelection([]);
    if (tile !== TileType.TownCenter && !isRoadTile(tile)) placementGhost.visible = false;
    configurePlacementGhost(tile);
    refreshToolbarSelection();
    refreshBuildRequirements();
  }

  function refreshBuildRequirements() {
    const def = TOOLS.find((t) => t.tile === currentTool);
    const text = def && def.cost ? def.cost : "No requirements.";
    const needs = progressionLocked[currentTool];
    buildRequirementsEl.textContent = needs ? `Locked. Needs: ${needs.join(", ")}. ${text}` : text;
  }

  // ---- Progression tree (shared/src/progression.ts; the server's `progression` snapshot) ----
  // The Build panel keeps the locked "needs: X" tool text and the prospector; hand crafting is the Crafting panel
  // (Craft button / Shift+C); the nearest goals are the Next steps bar (top centre) and its Progression dropdown.
  let progressionLocked: Record<number, string[]> = {};
  let progressionSig = "";
  let latestProgression: ProgressionSnapshot | undefined;
  const progressPanelEl = document.getElementById("progress-panel")!;
  const progressCraftsEl = document.getElementById("progress-crafts")!;
  const nextBarEl = document.getElementById("next-bar")!;
  const nextBarTextEl = document.getElementById("next-bar-text")!;
  const nextBarToggle = document.getElementById("next-bar-toggle") as HTMLButtonElement;
  const progressTreeEl = document.getElementById("progress-tree")!;
  const craftPanelEl = document.getElementById("craft-panel")!;
  const craftListEl = document.getElementById("craft-list")!;
  const craftItemsEl = document.getElementById("craft-items")!;
  const craftBtn = document.getElementById("craft-btn") as HTMLButtonElement;
  const itemTotal = (p: ProgressionSnapshot | undefined, id: ItemId) => (p?.items[id] ?? []).reduce((a, b) => a + b, 0);
  const STOCK_LABEL: Record<string, string> = Object.fromEntries(GOODS_GROUPS.flatMap((g) => g.goods.map((good) => [good.key, good.label])));
  const progressionBuildingLabel = (t: TileType) => PROGRESSION_BUILDING_LABEL[t] ?? TOOLS.find((tool) => tool.tile === t)?.label ?? "a building";

  function applyProgression(p: ProgressionSnapshot | undefined) {
    const sig = p ? JSON.stringify(p) : "";
    if (sig === progressionSig) return;
    progressionSig = sig;
    latestProgression = p;
    progressionLocked = p && !p.open ? p.locked : {};
    for (const [tile, btn] of toolButtonEls) {
      const needs = progressionLocked[tile];
      btn.classList.toggle("locked", !!needs);
      btn.title = needs ? `Locked. Needs: ${needs.join(", ")}` : "";
    }
    refreshBuildRequirements();
    for (const id of Object.keys(PROGRESSION.items) as ItemId[]) setGoodCount(`item:${id}`, itemTotal(p, id));
    progressPanelEl.hidden = !p?.prospect;
    nextBarEl.hidden = !p;
    if (!p) {
      progressTreeEl.hidden = true;
      return;
    }
    const next = p.open ? ["Everything is unlocked."] : p.next;
    nextBarTextEl.textContent = next.slice(0, 2).join("  ·  ");
    nextBarTextEl.title = `${next.join("\n")}\n(click for the whole progression)`;
    progressCraftsEl.replaceChildren();
    if (p.prospect) {
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = p.prospect.label;
      b.disabled = !p.prospect.ok;
      b.title = p.prospect.reason;
      b.addEventListener("click", () => {
        sendMessage({ type: "prospect" });
        b.blur();
      });
      progressCraftsEl.append(b);
    }
    if (!craftPanelEl.hidden) renderCraftPanel();
    if (!progressTreeEl.hidden) renderProgressTree();
  }

  // Crafting panel: every hand recipe with each input's have / need, a Craft button, and "needs: X" when it can't.
  let craftSig = "";
  function renderCraftPanel(force = false) {
    const p = latestProgression;
    const sig = `${progressionSig}|${JSON.stringify(latestStock)}`;
    if (!force && sig === craftSig) return;
    craftSig = sig;
    craftListEl.replaceChildren();
    if (!p) {
      craftListEl.textContent = "Nothing to craft yet.";
      return;
    }
    for (const r of PROGRESSION.recipes.filter((rc) => rc.station === "hand")) {
      const c = p.crafts.find((x) => x.id === r.id);
      const row = document.createElement("div");
      row.className = "craft-row";
      const main = document.createElement("div");
      main.className = "craft-main";
      const name = document.createElement("div");
      name.className = "craft-name";
      name.textContent = r.label;
      const have = document.createElement("span");
      have.className = "craft-have";
      have.textContent = `(${itemTotal(p, r.output)} in store${r.amount > 1 ? `, makes ${r.amount}` : ""})`;
      have.title = PROGRESSION.items[r.output].desc;
      name.append(have);
      const inputs = document.createElement("div");
      inputs.className = "craft-in";
      const parts: [string, number, number][] = [
        ...(Object.entries(r.stock ?? {}) as [string, number][]).map(([k, n]): [string, number, number] => [STOCK_LABEL[k] ?? k, latestStock[k as GoodKey] ?? 0, n]),
        ...(Object.entries(r.items ?? {}) as [ItemId, number][]).map(([id, n]): [string, number, number] => [PROGRESSION.items[id].label, itemTotal(p, id), n]),
      ];
      parts.forEach(([label, got, need], i) => {
        const span = document.createElement("span");
        span.textContent = `${label} ${Math.floor(got)}/${need}`;
        if (got < need) span.className = "short";
        inputs.append(...(i > 0 ? [" + "] : []), span);
      });
      main.append(name, inputs);
      const ok = p.open || (c?.ok ?? false);
      if (!ok) {
        const why = c?.why ?? "";
        const needs = document.createElement("div");
        needs.className = "craft-needs";
        needs.textContent = `needs: ${why.replace(/^Needs /, "").replace(/^Not enough (.*)$/, "more $1") || "its inputs"}`;
        main.append(needs);
      }
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = "Craft";
      b.disabled = !ok;
      b.addEventListener("click", () => {
        sendMessage({ type: "craftItem", recipe: r.id });
        b.blur();
      });
      row.append(main, b);
      craftListEl.append(row);
    }
    const owned = Object.entries(p.items).map(([id, grades]) => {
      const label = PROGRESSION.items[id as ItemId]?.label ?? id;
      const total = grades.reduce((a, b) => a + b, 0);
      const fine = grades.slice(1).some((n) => n > 0) ? ` (${grades.map((n, i) => (n > 0 ? `${n} ${QUALITY_GRADES[i].label}` : "")).filter(Boolean).join(", ")})` : "";
      return `${label} ${total}${fine}`;
    });
    craftItemsEl.textContent = owned.length > 0 ? `Items in store: ${owned.join(", ")}` : "Items in store: none";
  }
  function setCraftPanelOpen(open: boolean) {
    craftPanelEl.hidden = !open;
    craftBtn.classList.toggle("active", open);
    if (open) renderCraftPanel(true);
  }
  craftBtn.addEventListener("click", () => {
    craftBtn.blur();
    setCraftPanelOpen(craftPanelEl.hidden);
  });
  document.getElementById("craft-close")!.addEventListener("click", () => setCraftPanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !craftPanelEl.hidden) setCraftPanelOpen(false);
    if (e.key === "Escape" && !progressTreeEl.hidden) setProgressTreeOpen(false);
    if (e.code !== "KeyC" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    // Strategy mode with soldiers selected: Shift+C is Charge.
    if (strategyOrderKey(e)) return;
    e.preventDefault();
    setCraftPanelOpen(craftPanelEl.hidden);
  });

  // Progression dropdown: every chain of PROGRESSION.chains, each step done / available / locked with its needs.
  function chainStepState(p: ProgressionSnapshot, st: ChainStep): { label: string; cls: "done" | "avail" | "locked"; note: string } {
    const built = new Set(p.built ?? []);
    if (st.building !== undefined) {
      const label = progressionBuildingLabel(st.building);
      if (built.has(st.building)) return { label, cls: "done", note: "built" };
      const needs = p.open ? undefined : p.locked[st.building];
      return needs ? { label, cls: "locked", note: `needs: ${needs.join(", ")}` } : { label, cls: "avail", note: "can be built" };
    }
    const id = st.item;
    const label = PROGRESSION.items[id].label;
    const have = itemTotal(p, id);
    if (have > 0) return { label, cls: "done", note: `${have} in store` };
    const r = PROGRESSION.recipes.find((rc) => rc.output === id);
    if (!r) return { label, cls: "avail", note: PROGRESSION.items[id].desc.split(".")[0] };
    if (r.station === "hand") {
      const c = p.crafts.find((x) => x.id === r.id);
      if (p.open || c?.ok) return { label, cls: "avail", note: `craft by hand: ${c?.cost ?? ""}` };
      if (c?.why?.startsWith("Needs ")) return { label, cls: "locked", note: `needs: ${c.why.slice(6)}` };
      return { label, cls: "avail", note: `craft by hand: ${c?.cost ?? ""} (${(c?.why ?? "").toLowerCase()})` };
    }
    const station = progressionBuildingLabel(r.station);
    const lvl = r.workerLevel && r.workerLevel > 1 ? `, a level-${r.workerLevel} worker` : "";
    const kept = Object.keys(r.needs ?? {}).map((k) => `, a ${PROGRESSION.items[k as ItemId].label}`).join("");
    if (p.open || built.has(r.station)) return { label, cls: "avail", note: `made at the ${station}${lvl}${kept}` };
    return { label, cls: "locked", note: `needs: a ${station}${lvl}${kept}` };
  }
  function renderProgressTree() {
    const p = latestProgression;
    progressTreeEl.replaceChildren();
    if (!p) return;
    const legend = document.createElement("div");
    legend.className = "pt-legend";
    for (const [cls, text] of [["done", "done"], ["avail", "available now"], ["locked", "locked (needs shown)"]]) {
      const item = document.createElement("span");
      const sw = document.createElement("span");
      sw.className = `pt-swatch ${cls}`;
      item.append(sw, text);
      legend.append(item);
    }
    progressTreeEl.append(legend);
    for (const chain of PROGRESSION.chains) {
      const box = document.createElement("div");
      box.className = "pt-chain";
      const name = document.createElement("div");
      name.className = "pt-name";
      name.textContent = chain.label;
      const steps = document.createElement("div");
      steps.className = "pt-steps";
      chain.steps.forEach((st, i) => {
        const s = chainStepState(p, st);
        if (i > 0) {
          const arrow = document.createElement("span");
          arrow.className = "pt-arrow";
          arrow.textContent = "\u2192";
          steps.append(arrow);
        }
        const chip = document.createElement("div");
        chip.className = `pt-step ${s.cls}`;
        const b = document.createElement("b");
        b.textContent = s.label;
        const small = document.createElement("small");
        small.textContent = s.note;
        chip.append(b, small);
        chip.title = `${s.label}: ${s.note}`;
        steps.append(chip);
      });
      box.append(name, steps);
      progressTreeEl.append(box);
    }
  }
  function setProgressTreeOpen(open: boolean) {
    progressTreeEl.hidden = !open;
    nextBarToggle.setAttribute("aria-expanded", String(open));
    if (open) renderProgressTree();
  }
  nextBarToggle.addEventListener("click", () => {
    nextBarToggle.blur();
    setProgressTreeOpen(progressTreeEl.hidden);
  });
  nextBarTextEl.addEventListener("click", () => setProgressTreeOpen(progressTreeEl.hidden));

  setupToolbar();
  setupCategoryTabs();
  refreshToolbarVisibility();
  selectTool(currentTool);

  // ---- Unit selection (client-local; task forces are server-synced) ----

  let latestColonists: ColonistSnapshot[] = [];
  let latestMobs: MobSnapshot[] = [];
  let latestTaskForces: Record<string, string[]> = {};
  let selectedIds = new Set<string>();

  // Mirrors the server's isCommandable: of the bishops, only a Church's takes orders — the Ward
  // Priest (whose post is always the Ward Stone he's bound for) keeps his rounds, and Saint Wren's
  // Abbey clergy (posted at an AbbeyHall) aren't ours.
  function isCommandable(c: ColonistSnapshot): boolean {
    if (!COMMANDABLE_KINDS.has(c.kind)) return false;
    // Clans: another clan's units are neutral, never ours to command.
    if ((c.clan ?? 0) !== myClan) return false;
    return c.kind !== "bishop" || tiles[c.postY * worldTilesX + c.postX] === TileType.ChurchPost;
  }

  // Armour tier tint (T1 bronze, T2 silver, T3 gold).
  const ARMOUR_TIER_COLORS = [0xcd7f32, 0xc0c8d0, 0xf2c94c];
  // Regiments & roles: a thin role-tinted ring at the feet of every soldier and monster (ROLE_COLORS).
  function drawRoleRings() {
    roleRings.clear();
    const ring = (x: number, y: number, role: CombatRole | undefined, r: number) => {
      if (role) roleRings.ellipse(x, y + r * 0.8, r, r * 0.4).stroke({ width: 1.5, color: ROLE_COLORS[role], alpha: 0.65 });
    };
    for (const c of latestColonists) {
      const r = c.kind === "cavalry" || c.kind === "batteringRam" || c.kind === "catapult" ? 12 : 9;
      ring(c.x, c.y, unitRole(c.kind, c.heroClass), r);
      // Clans: another clan's unit wears a ring in its clan colour.
      if ((c.clan ?? 0) !== myClan) {
        roleRings.ellipse(c.x, c.y + r * 0.8, r + 2, (r + 2) * 0.4).stroke({ width: 2, color: clanColors.get(c.clan ?? 0) ?? 0xffffff, alpha: 0.9 });
      }
      // Armour & weapons: a thin bronze / silver / gold ring just inside the role ring shows the unit's
      // armour tier, only where its tier art (COLONIST_TIER_ANIMS) is missing.
      const tier = c.armourTier ?? 0;
      if (tier > 0 && !colonistTierSet(c)) roleRings.ellipse(c.x, c.y + r * 0.8, r - 2.5, (r - 2.5) * 0.4).stroke({ width: 1.5, color: ARMOUR_TIER_COLORS[tier - 1], alpha: 0.85 });
      // Hero phase 3: a gold ring outside the role ring with four pips on it.
      if (c.kind === "hero") {
        const hr = r + 3;
        roleRings.ellipse(c.x, c.y + r * 0.8, hr, hr * 0.4).stroke({ width: 2, color: 0xf2c94c, alpha: 0.95 });
        for (const [px, py] of [[hr, 0], [-hr, 0], [0, hr * 0.4], [0, -hr * 0.4]]) roleRings.circle(c.x + px, c.y + r * 0.8 + py, 1.8).fill(0xffe9a8);
      }
    }
    for (const m of latestMobs) if (strategySeesEnemy(m.x, m.y)) ring(m.x, m.y, MOB_ROLE[m.kind], 10);
  }

  function redrawSelectionRings() {
    selectionRings.clear();
    for (const c of latestColonists) {
      if (!selectedIds.has(c.id)) continue;
      selectionRings.circle(c.x, c.y, 12).stroke({ width: 2, color: 0x6fbf5a, alpha: 0.4 });
    }
  }

  // Stance is only meaningful for guard-tier units, so bishops are left out of the readout (and of
  // the formation-spacing vote in groupStance).
  function refreshSelectionHud() {
    statSelectedEl.hidden = selectedIds.size === 0;
    const stances = new Set(
      latestColonists.filter((c) => selectedIds.has(c.id) && c.kind !== "bishop").map((c) => c.stance)
    );
    const single = stances.size === 1 ? [...stances][0] : null;
    commandBarEl.hidden = stances.size === 0;
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-stance]"))) {
      b.classList.toggle("active", b.dataset.stance === single);
    }
    refreshSettingButtons();
    const stance = stances.size === 0 ? "" : single ? STANCE_LABEL[single] : "Mixed";
    // Regiments: the selection's roles, e.g. "6 Frontline, 4 Ranged".
    const roleCounts = new Map<CombatRole, number>();
    for (const c of latestColonists) {
      const role = selectedIds.has(c.id) ? unitRole(c.kind, c.heroClass) : undefined;
      if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
    const roles = Array.from(roleCounts, ([role, n]) => `${n} ${ROLE_LABEL[role]}`).join(", ");
    let count = roles ? `${selectedIds.size} (${roles})` : `${selectedIds.size}`;
    // Armour & weapons: a single selected knight / spearman / pikeman / cavalry shows its tiers.
    if (selectedIds.size === 1) {
      const u = latestColonists.find((c) => selectedIds.has(c.id));
      if (u?.kind === "hero") {
        count = `${HERO_CLASS_LABEL[u.heroClass ?? "champion"]} ${u.heroName ?? ""} Lv ${u.heroLevel ?? 1} (\` opens its sheet)`;
      } else if (u && EQUIPPED_KIND_LABEL[u.kind]) {
        const t = (n: number | undefined) => (n ? `T${n}` : "none");
        count = `${EQUIPPED_KIND_LABEL[u.kind]} (armour ${t(u.armourTier)}, weapon ${t(u.weaponTier)})`;
      }
    }
    const text = stance ? `Selected: ${count} · ${stance} (Z/X/E)` : `Selected: ${count}`;
    // Called every snapshot; only touch the DOM when the line actually changes.
    if (text === lastSelectionHudText) return;
    lastSelectionHudText = text;
    if (!single) {
      statSelectedEl.textContent = text;
      return;
    }
    const icon = document.createElement("img");
    icon.className = "econ-icon";
    icon.src = `/sprites/icon-stance-${single}.png`;
    icon.alt = "";
    statSelectedEl.replaceChildren(`Selected: ${count} · `, icon, ` ${stance} (Z/X/E)`);
  }
  let lastSelectionHudText = "";
  const EQUIPPED_KIND_LABEL: Partial<Record<ColonistKind, string>> = { knight: "Knight", spearman: "Spearman", pikeman: "Pikeman", cavalry: "Cavalry" };

  const commandBarEl = document.getElementById("command-bar")!;
  commandBarEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".cmd-btn");
    // Strategy mode phase 3: order buttons (Shift+click queues Hold / Retreat).
    const orderKind = btn?.dataset.order as ArmyOrderKind | undefined;
    if (orderKind && strategyCam.inStrategy && selectedIds.size > 0) issueOrder(orderKind, e.shiftKey);
    // Strategy mode phase 4: hold fire / skirmish / cycle charge toggles and the shape cycle.
    const setting = btn?.dataset.setting as StrategySetting | undefined;
    if (setting && strategyCam.inStrategy && selectedIds.size > 0) applyStrategySetting(setting);
    const stance = btn?.dataset.stance as Stance | undefined;
    if (stance && selectedIds.size > 0) sendMessage({ type: "commandStance", unitIds: Array.from(selectedIds), stance });
  });
  // Keep a click on the bar from starting a map selection drag / deselecting.
  commandBarEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  function setSelection(ids: Iterable<string>) {
    selectedIds = new Set(ids);
    redrawSelectionRings();
    refreshSelectionHud();
    // Banner borders / card highlights follow the selection without waiting for a snapshot.
    if (strategyCam.inStrategy) {
      buildStrategyBanners();
      redrawOrderMarkers();
    }
  }

  function findNearest<T extends { x: number; y: number }>(
    list: T[],
    x: number,
    y: number,
    radius: number
  ): T | null {
    let best: T | null = null;
    let bestDist = radius * radius;
    for (const item of list) {
      const d = (item.x - x) ** 2 + (item.y - y) ** 2;
      if (d <= bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }


  // Newest order number per unit. A rank's delayed commandMove is dropped for any unit that has
  // since been given another order (move or attack), so the tail of a staggered formation order
  // can never overwrite a quick re-order — while orders to other units are left alone.
  let orderCounter = 0;
  const unitOrder = new Map<string, number>();
  function stampOrder(ids: string[]): number {
    orderCounter++;
    for (const id of ids) unitOrder.set(id, orderCounter);
    return orderCounter;
  }

  // Ground marker at a formation's destination: a ring per slot, a line across the front row and
  // a chevron off its middle pointing the way the block will face. Drawn once per order; only its
  // alpha changes afterwards (see the ticker below).
  const formationMarker = new Graphics();
  let formationMarkerState: {
    ids: string[];
    shownAt: number;
    settleAfter: number;
    fadeFrom: number | null;
  } | null = null;

  function hideFormationMarker() {
    formationMarker.clear();
    formationMarkerState = null;
  }

  // A formation slot: a ring on the front rank, a square (ranged green) on the rear line.
  function drawSlot(g: Graphics, pos: { x: number; y: number; rear?: boolean }, alpha: number) {
    if (pos.rear) g.rect(pos.x - 3.5, pos.y - 3.5, 7, 7).stroke({ width: 1.5, color: ROLE_COLORS.ranged, alpha });
    else g.circle(pos.x, pos.y, 4).stroke({ width: 1.5, color: SELECTION_COLOR, alpha });
  }

  function showFormationMarker(plan: FormationPlan, destX: number, destY: number, dispatchMs: number) {
    const { fx, fy } = plan;
    const px = -fy;
    const py = fx;
    formationMarker.clear();
    formationMarker.alpha = 1;
    for (const pos of plan.targets.values()) drawSlot(formationMarker, pos, 0.6);
    // Front edge sits half a slot ahead of the front row's centers.
    const edgeX = destX + fx * plan.spacing * 0.5;
    const edgeY = destY + fy * plan.spacing * 0.5;
    const half = plan.frontHalfWidth + 10;
    formationMarker
      .moveTo(edgeX - px * half, edgeY - py * half)
      .lineTo(edgeX + px * half, edgeY + py * half)
      .stroke({ width: 3, color: SELECTION_COLOR, alpha: 0.85 });
    const at = (along: number, across: number) => [edgeX + fx * along + px * across, edgeY + fy * along + py * across];
    formationMarker
      .poly([...at(16, 0), ...at(2, 11), ...at(7, 0), ...at(2, -11)])
      .fill(SELECTION_COLOR)
      .stroke({ width: 1.5, color: 0x0a1a24 });
    const now = performance.now();
    formationMarkerState = {
      ids: Array.from(plan.targets.keys()),
      shownAt: now,
      // Units only start walking once their (staggered) order reaches the server, so "everyone has
      // stopped" means nothing until the last rank's order has had a couple of ticks to land.
      settleAfter: now + Math.max(FORMATION_MARKER_MIN_MS, dispatchMs + 250),
      fadeFrom: null,
    };
  }

  app.ticker.add(() => {
    const s = formationMarkerState;
    if (!s) return;
    const now = performance.now();
    if (s.fadeFrom === null) {
      const ids = new Set(s.ids);
      // Settled = not walking to its slot any more: arrived (idle) or busy fighting/healing.
      const stillMarching = latestColonists.some((c) => ids.has(c.id) && c.state === "returning");
      if ((now >= s.settleAfter && !stillMarching) || now - s.shownAt > FORMATION_MARKER_MAX_MS) {
        s.fadeFrom = now;
      }
    }
    if (s.fadeFrom !== null) {
      const t = (now - s.fadeFrom) / FORMATION_MARKER_FADE_MS;
      if (t >= 1) hideFormationMarker();
      else formationMarker.alpha = 1 - t;
    }
  });

  // Custom-width formation (formation.ts): the player dragged a line on the ground; the units face away
  // from their side of it, or toward the nearest enemy within LINE_FACE_ENEMY_TILES of its centre.
  function computeLineFormationTargets(units: ColonistSnapshot[], ax: number, ay: number, bx: number, by: number) {
    const foe = findNearest(latestMobs, (ax + bx) / 2, (ay + by) / 2, LINE_FACE_ENEMY_TILES * tileSize);
    return sharedLineFormation(units, ax, ay, bx, by, { foe });
  }

  function dispatchFormationMove(units: ColonistSnapshot[], destX: number, destY: number, order: number) {
    dispatchPlannedMove(units, computeFormationTargets(units, destX, destY), destX, destY, order);
  }

  function dispatchPlannedMove(units: ColonistSnapshot[], plan: FormationPlan, destX: number, destY: number, order: number) {
    const distToSlot = (u: ColonistSnapshot) => {
      const slot = plan.targets.get(u.id)!;
      return Math.hypot(slot.x - u.x, slot.y - u.y);
    };
    const queue = units.slice().sort((a, b) => distToSlot(a) - distToSlot(b));
    const step = Math.min(FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS / (queue.length - 1));
    queue.forEach((u, i) => {
      const send = () => {
        if (unitOrder.get(u.id) !== order) return;
        const pos = plan.targets.get(u.id)!;
        // One squad per formation order: the server marches its members at one pace.
        sendMessage({ type: "commandMove", unitIds: [u.id], x: pos.x, y: pos.y, squad: queue.length > 1 ? `o${order}` : undefined });
      };
      if (i === 0) send();
      else setTimeout(send, i * step);
    });
    showFormationMarker(plan, destX, destY, (queue.length - 1) * step);
  }

  // ---- Sound triggers driven by snapshots ----
  // colonist id -> its current work sound and when it next plays.
  const workSoundTimers = new Map<string, { key: string; next: number }>();
  const growledMobs = new Set<string>();
  let lastMyHp: number | null = null;
  let lastMyPos: { x: number; y: number; at: number } | null = null;
  let horseIdleSince = performance.now();
  let horseMoving = false;
  let lastAmbientScan = 0;
  // tile index -> {tile, at}: setTile requests we sent, so their tileUpdate can sound as ours.
  const pendingPlacements = new Map<number, { tile: number; at: number }>();

  function resetSoundState() {
    soundSuppressed = true;
    workSoundTimers.clear();
    growledMobs.clear();
    lastMyHp = null;
    lastMyPos = null;
    pendingPlacements.clear();
  }

  function soundOnSnapshot(snap: Extract<ServerMessage, { type: "snapshot" }>) {
    sound.tileSize = tileSize;
    sound.setMusicMode(snap.isNight ? "night" : "day");
    const now = performance.now();
    const me = snap.players.find((p) => p.id === myId);
    if (me) {
      sound.setListener(me.x, me.y);
      if (lastMyHp !== null && me.hp < lastMyHp && !soundSuppressed) sound.play("player_hurt");
      lastMyHp = me.hp;

      let speed = 0;
      if (lastMyPos && now > lastMyPos.at) {
        speed = Math.hypot(me.x - lastMyPos.x, me.y - lastMyPos.y) / ((now - lastMyPos.at) / 1000);
        if (speed > HORSE_TELEPORT_SPEED) speed = 0;
      }
      // Snapshots can arrive bunched; only resample the speed every ~80 ms.
      if (!lastMyPos || now - lastMyPos.at >= 80) {
        lastMyPos = { x: me.x, y: me.y, at: now };
        const moving = speed > HORSE_MOVING_MIN_SPEED && !snap.isPaused;
        if (moving && !horseMoving && now - horseIdleSince > HORSE_WHINNY_IDLE_MS && Math.random() < HORSE_WHINNY_CHANCE) {
          sound.play("horse_whinny");
        }
        if (!moving && horseMoving) horseIdleSince = now;
        horseMoving = moving;
        const rate = Math.max(HORSE_RATE_MIN, Math.min(HORSE_RATE_MAX, speed / PLAYER_SPEED));
        sound.setLoop("horse", "horse_gallop", moving ? 1 : 0, rate);
      }

      if (now - lastAmbientScan >= AMBIENT_SCAN_MS) {
        lastAmbientScan = now;
        const r = SOUND_SILENT_RADIUS_TILES;
        const ptx = Math.floor(me.x / tileSize);
        const pty = Math.floor(me.y / tileSize);
        for (const loop of AMBIENT_TILE_LOOPS) {
          let best = Infinity;
          for (let ty = Math.max(0, pty - r); ty <= Math.min(worldTilesY - 1, pty + r); ty++) {
            for (let tx = Math.max(0, ptx - r); tx <= Math.min(worldTilesX - 1, ptx + r); tx++) {
              if (tiles[ty * worldTilesX + tx] !== loop.tile) continue;
              best = Math.min(best, Math.hypot(tx * tileSize + tileSize / 2 - me.x, ty * tileSize + tileSize / 2 - me.y));
            }
          }
          const level = best === Infinity ? 0 : proximityGain(best, 0, tileSize);
          sound.setLoop(loop.id, loop.key, level);
        }
      }
    }

    // Workers: one sound per work cycle each, phase-staggered so a whole village doesn't hit in sync.
    // Paused: the simulation is frozen, so nobody's working.
    const seen = new Set<string>();
    for (const c of snap.isPaused ? [] : snap.colonists) {
      seen.add(c.id);
      const key = workSoundKey(c);
      if (!key) {
        workSoundTimers.delete(c.id);
        continue;
      }
      const interval = WORK_SOUND_INTERVAL_MS[key] ?? 2000;
      const timer = workSoundTimers.get(c.id);
      if (!timer || timer.key !== key) {
        workSoundTimers.set(c.id, { key, next: now + Math.random() * interval * 0.5 });
        continue;
      }
      if (now < timer.next) continue;
      timer.next = now + interval;
      const volume =
        key === "craft_hammer" && tiles[c.postY * worldTilesX + c.postX] !== TileType.Blacksmith
          ? CRAFT_VOLUME_NON_SMITH
          : 1;
      sound.play(key, { x: c.x, y: c.y, volume });
    }
    for (const id of Array.from(workSoundTimers.keys())) if (!seen.has(id)) workSoundTimers.delete(id);

    // Mobs: maybe a growl the first time each comes within range (the per-key cooldown in sound.ts
    // keeps a whole wave from growling at once).
    const mobIds = new Set<string>();
    const growlRangePx = MOB_GROWL_RADIUS_TILES * tileSize;
    for (const m of snap.mobs) {
      mobIds.add(m.id);
      if (growledMobs.has(m.id) || !me) continue;
      if (Math.hypot(m.x - me.x, m.y - me.y) > growlRangePx) continue;
      growledMobs.add(m.id);
      if (!soundSuppressed && Math.random() < MOB_GROWL_CHANCE) sound.play("monster_growl", { x: m.x, y: m.y });
    }
    for (const id of Array.from(growledMobs)) if (!mobIds.has(id)) growledMobs.delete(id);
    soundSuppressed = false;
  }

  function soundOnEvent(category: GameEventCategory, text: string) {
    if (category === "night") sound.play("night_sting", { priority: true });
    // Phase 6: one of the player's regiments breaks (wavering / rally toasts stay silent).
    else if (category === "morale" && text.endsWith("routing!")) sound.play("night_sting", { priority: true });
    else if (category === "dawn") {
      sound.play("dawn_chime", { priority: true });
      sound.play("church_bell", { priority: true, delay: DAWN_BELL_DELAY_S });
    } else if (category === "upgrade" || category === "milestone") sound.play("build_upgrade", { priority: true });
  }

  function soundOnTileUpdate(tileX: number, tileY: number, tile: number) {
    const index = tileY * worldTilesX + tileX;
    const prev = tiles[index] ?? TileType.Empty;
    if (prev === TileType.ConstructionSite && tile !== TileType.Empty && tile !== TileType.ConstructionSite) {
      // A construction finished (anyone's): the build sparkle and the placement thud.
      pendingPlacements.delete(index);
      const c = tileCenter(tileX, tileY);
      spawnFxAnim("build", c.x, c.y + tileSize / 2, 700);
      sound.play("build_place", { x: c.x, y: c.y });
      return;
    }
    const pending = pendingPlacements.get(index);
    if (!pending) return;
    // Our placement became a construction site: the sound waits for its completion.
    if (tile === TileType.ConstructionSite) {
      pendingPlacements.delete(index);
      return;
    }
    pendingPlacements.delete(index);
    if (performance.now() - pending.at > PLACEMENT_CONFIRM_MS || tile === TileType.Empty) return;
    const c = tileCenter(tileX, tileY);
    // Our placement landed: on bare ground it's a build; on an existing building that turned into a
    // different tile (House -> Big House, barracks -> castle) it's an upgrade.
    spawnFxAnim(prev !== TileType.Empty && prev !== tile ? "upgrade" : "build", c.x, c.y + tileSize / 2, 700);
    if (pending.tile !== tile) return;
    sound.play("build_place", { x: c.x, y: c.y });
  }

  // In-place level-ups (huts, workshops, mines, ...) keep their tile, so no tileUpdate arrives; the
  // server's "upgrade" event confirms one instead. Play the upgrade effect at our most recent pending
  // placement of a building onto the same building.
  function fxOnUpgradeEvent() {
    let best: { index: number; at: number } | null = null;
    const now = performance.now();
    for (const [index, pending] of pendingPlacements) {
      if (now - pending.at > PLACEMENT_CONFIRM_MS || tiles[index] !== pending.tile) continue;
      if (!best || pending.at > best.at) best = { index, at: pending.at };
    }
    if (!best) return;
    pendingPlacements.delete(best.index);
    const c = tileCenter(best.index % worldTilesX, Math.floor(best.index / worldTilesX));
    spawnFxAnim("upgrade", c.x, c.y + tileSize / 2, 700);
  }

  // ---- Building info panel (left-click a building; see the pointerup handler) ----
  // Buildings that open the panel. Walls, trees, rocks and forage keep the old left-click (break).
  const INFO_TILES = new Set<number>([
    TileType.TownCenter, TileType.House, TileType.BigHouse, TileType.HouseLevel2, TileType.BarnPost,
    TileType.LumberjackPost, TileType.FarmPlot, TileType.KnightPost, TileType.CastleLevel2, TileType.CastleLevel3,
    TileType.ArcherPost, TileType.Tower, TileType.IronMinePost, TileType.RockMinePost, TileType.ChurchPost,
    TileType.Pasture, TileType.PigPasture, TileType.Orchard, TileType.WoolFarm, TileType.CottonFarm, TileType.TailorShop,
    TileType.Blacksmith, TileType.LuxuryWorkshop, TileType.Market, TileType.GoldShop, TileType.Brewery,
    TileType.Tavern, TileType.MilitiaPost, TileType.MilitiaCamp2, TileType.MilitiaCamp3, TileType.WardStone,
    TileType.HunterHut, TileType.ForagerHut, TileType.BuildersGuild, TileType.ConstructionSite,
    TileType.Gate, TileType.Drawbridge, TileType.Stables, TileType.SiegeWorkshop, TileType.Keep,
    TileType.SiteKeep, TileType.RuinedKeep, TileType.Tent, TileType.CharcoalBurner, TileType.Bloomery, TileType.Mill, TileType.Bakery,
  ]);
  const buildingPanelEl = document.getElementById("building-panel")!;
  const bpNameEl = document.getElementById("bp-name")!;
  const bpLevelEl = document.getElementById("bp-level")!;
  const bpStaffingEl = document.getElementById("bp-staffing")!;
  const bpHpEl = document.getElementById("bp-hp")!;
  const bpConstructionEl = document.getElementById("bp-construction")!;
  const bpBonusesEl = document.getElementById("bp-bonuses")!;
  const bpUpgradeRowEl = document.getElementById("bp-upgrade-row")!;
  const bpUpgradeBtn = document.getElementById("bp-upgrade") as HTMLButtonElement;
  const bpUpgradeCostEl = document.getElementById("bp-upgrade-cost")!;
  const bpRepairRowEl = document.getElementById("bp-repair-row")!;
  const bpRepairBtn = document.getElementById("bp-repair") as HTMLButtonElement;
  const bpRepairCostEl = document.getElementById("bp-repair-cost")!;
  // Walls & gates: the gate's lock (click cycles auto -> open -> closed).
  const bpGateRowEl = document.getElementById("bp-gate-row")!;
  const bpGateBtn = document.getElementById("bp-gate-lock") as HTMLButtonElement;
  const bpGateStateEl = document.getElementById("bp-gate-state")!;
  const GATE_LOCK_NEXT: Record<GateLock, GateLock> = { auto: "open", open: "closed", closed: "auto" };
  const GATE_LOCK_LABEL: Record<GateLock, string> = { auto: "Auto", open: "Locked open", closed: "Locked closed" };
  let shownGateLock: GateLock = "auto";
  // Cavalry & siege: the Siege Workshop's two build buttons (queueSiege) and its status line.
  const bpSiegeRowEl = document.getElementById("bp-siege-row")!;
  const bpSiegeStateEl = document.getElementById("bp-siege-state")!;
  const bpSiegeBtns = new Map<SiegeKind, HTMLButtonElement>(
    SIEGE_KINDS.map((kind) => [kind, document.getElementById(`bp-siege-${kind}`) as HTMLButtonElement])
  );
  // Village life phase 3: a unit building's Train unit button (trainUnit) and its troops / reason line.
  const bpTrainRowEl = document.getElementById("bp-train-row")!;
  const bpTrainBtn = document.getElementById("bp-train") as HTMLButtonElement;
  const bpTrainStateEl = document.getElementById("bp-train-state")!;
  // Village life phase 4: a Town Center's Call to arms / Stand down button (callVillagers) and its levy line.
  const bpLevyRowEl = document.getElementById("bp-levy-row")!;
  const bpLevyBtn = document.getElementById("bp-levy") as HTMLButtonElement;
  const bpLevyStateEl = document.getElementById("bp-levy-state")!;
  let shownLevyOnField = 0;
  // Armour & weapons: the Blacksmith's two forge buttons (queueForge) and its queue line.
  const bpForgeRowEl = document.getElementById("bp-forge-row")!;
  const bpForgeStateEl = document.getElementById("bp-forge-state")!;
  // Forge autocraft: on / off toggle, target - / + (setForgeAuto), and its status line.
  const bpForgeAutoBtn = document.getElementById("bp-forge-auto") as HTMLButtonElement;
  const bpForgeAutoLessBtn = document.getElementById("bp-forge-auto-less") as HTMLButtonElement;
  const bpForgeAutoMoreBtn = document.getElementById("bp-forge-auto-more") as HTMLButtonElement;
  const bpForgeAutoStateEl = document.getElementById("bp-forge-auto-state")!;
  let shownForgeAuto: { on: boolean; target: number } = { on: false, target: 4 };
  const bpForgeBtns = new Map<EquipSlot, HTMLButtonElement>(
    (["armour", "weapon"] as EquipSlot[]).map((slot) => [slot, document.getElementById(`bp-forge-${slot}`) as HTMLButtonElement])
  );
  // Hero phase 3: the Keep's three recruit buttons (recruitHero) and its hero roster line.
  const bpHeroesRowEl = document.getElementById("bp-heroes-row")!;
  const bpHeroesStateEl = document.getElementById("bp-heroes-state")!;
  const bpHeroBtns = new Map<HeroClass, HTMLButtonElement>(
    HERO_CLASSES.map((cls) => [cls, document.getElementById(`bp-hero-${cls}`) as HTMLButtonElement])
  );
  const bpSpellsRowEl = document.getElementById("bp-spells-row")!;
  // Forts phase B: a razed fort's RuinedKeep: Rebuild (rebuildKeep) and its cost / reason.
  const bpKeepRowEl = document.getElementById("bp-keep-row")!;
  const bpKeepBtn = document.getElementById("bp-keep-rebuild") as HTMLButtonElement;
  const bpKeepStateEl = document.getElementById("bp-keep-state")!;
  let bpSpellsKey = "";
  // Forts phase D: a human settlement's Trade button and the trade panel (fed by the same buildingInfo
  // refresh while open; closes with the building panel).
  // Forts phase E: the Trading Post's trader wagon (status, escort, destinations, send / recall / auto).
  const bpWagonRowEl = document.getElementById("bp-wagon-row")!;
  const bpWagonStatusEl = document.getElementById("bp-wagon-status")!;
  const bpWagonEscortEl = document.getElementById("bp-wagon-escort")!;
  const bpWagonDestEl = document.getElementById("bp-wagon-dest") as HTMLSelectElement;
  const bpWagonSendBtn = document.getElementById("bp-wagon-send") as HTMLButtonElement;
  const bpWagonRecallBtn = document.getElementById("bp-wagon-recall") as HTMLButtonElement;
  const bpWagonAutoBtn = document.getElementById("bp-wagon-auto") as HTMLButtonElement;
  const bpWagonDestsEl = document.getElementById("bp-wagon-dests")!;
  let bpWagonAuto = true;
  let bpWagonDestKey = "";
  // Batch 2 (SPRITES.md #67 / #80): a small optional icon (/sprites/ui-<icon>.png) ahead of a panel line's
  // text; the img is made once per icon and removes itself if the file is missing, leaving just the text.
  function setIconText(el: HTMLElement, icon: string, text: string) {
    if (el.dataset.icon !== icon) {
      el.dataset.icon = icon;
      const img = document.createElement("img");
      img.className = "ui-ico";
      img.alt = "";
      img.src = `/sprites/ui-${icon}.png`;
      img.onerror = () => img.remove();
      el.replaceChildren(img, document.createTextNode(text));
    } else if (el.lastChild!.textContent !== text) el.lastChild!.textContent = text;
  }
  const relIcon = (tier: keyof typeof RELATION_TIER_NAMES) => `rel${Object.keys(RELATION_TIER_NAMES).indexOf(tier)}`;
  const ESCORT_LABEL: Partial<Record<ColonistKind, string>> = { militia: "Militia", spearman: "Spearman", pikeman: "Pikeman", cavalry: "Cavalry" };
  function renderTradingPost(tp: BuildingInfo["tradingPost"]) {
    bpWagonRowEl.hidden = !tp;
    if (!tp) return;
    const w = tp.wagon;
    setIconText(bpWagonStatusEl, w && w.hp < w.maxHp ? "tradeAlert" : "tradeRoute", `${w ? `Wagon HP ${w.hp}/${w.maxHp} · ` : ""}${tp.status}`);
    bpWagonEscortEl.textContent = `Escort: ${tp.escorts.map((e) => `${ESCORT_LABEL[e.kind] ?? e.kind}${e.alive ? "" : " (fallen)"}`).join(", ")}`;
    const key = tp.destinations.map((d) => `${d.id}:${d.ok}`).join("|");
    if (key !== bpWagonDestKey) {
      bpWagonDestKey = key;
      const keep = bpWagonDestEl.value;
      bpWagonDestEl.replaceChildren(
        new Option("Auto (best)", "auto"),
        ...tp.destinations.filter((d) => d.ok).map((d) => new Option(d.name, d.id))
      );
      bpWagonDestEl.value = Array.from(bpWagonDestEl.options).some((o) => o.value === keep) ? keep : "auto";
    }
    bpWagonSendBtn.disabled = !tp.canSend;
    bpWagonSendBtn.title = tp.sendReason;
    bpWagonRecallBtn.disabled = !tp.canRecall;
    bpWagonAuto = tp.auto;
    bpWagonAutoBtn.textContent = `Auto-send: ${tp.auto ? "On" : "Off"}`;
    bpWagonDestsEl.replaceChildren(
      ...(tp.destinations.length > 0 ? tp.destinations : [null]).map((d) => {
        const li = document.createElement("li");
        if (!d) {
          li.textContent = "No destinations yet: befriend a settlement (Friendly) or found another Town Center";
          return li;
        }
        const own = d.kind === "own" ? " (own, half value)" : "";
        li.textContent = d.ok
          ? `${d.name}${own}: ${d.dist} tiles, ${d.danger ?? "road not scouted"}, ~${d.profit} gold`
          : `${d.name}${own}: ${d.reason}`;
        if (!d.ok) li.className = "off";
        return li;
      })
    );
  }
  bpWagonSendBtn.addEventListener("click", () => {
    bpWagonSendBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "sendNow", dest: bpWagonDestEl.value || "auto" });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpWagonRecallBtn.addEventListener("click", () => {
    bpWagonRecallBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "recall" });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpWagonAutoBtn.addEventListener("click", () => {
    bpWagonAutoBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "wagonCommand", tileX: infoTile.tx, tileY: infoTile.ty, cmd: "auto", value: !bpWagonAuto });
    window.setTimeout(requestBuildingInfo, 150);
  });
  // Forts phase F: a vassal's block (power, Call to arms / Dismiss, Demand tribute, the tribute ledger).
  const bpVassalRowEl = document.getElementById("bp-vassal-row")!;
  const bpVassalPowerEl = document.getElementById("bp-vassal-power")!;
  const bpVassalCallBtn = document.getElementById("bp-vassal-call") as HTMLButtonElement;
  const bpVassalDismissBtn = document.getElementById("bp-vassal-dismiss") as HTMLButtonElement;
  const bpVassalLevyEl = document.getElementById("bp-vassal-levy")!;
  const bpVassalTaxBtn = document.getElementById("bp-vassal-tax") as HTMLButtonElement;
  const bpVassalTaxStateEl = document.getElementById("bp-vassal-tax-state")!;
  const bpVassalLedgerEl = document.getElementById("bp-vassal-ledger")!;
  let bpVassalTax = false;
  function renderVassal(v: BuildingInfo["vassal"]) {
    bpVassalRowEl.hidden = !v;
    if (!v) return;
    setIconText(bpVassalPowerEl, "vassal", `Your vassal. Power: yours ${v.clanPower}, theirs ${v.sitePower} (they break free if stronger than you)`);
    bpVassalCallBtn.disabled = !v.canCall;
    bpVassalCallBtn.title = v.canCall ? `${v.levySize} levies join you for a day${strategyCam.inStrategy && selectedIds.size > 0 ? " and follow your selected army" : " and follow you"}` : v.callReason;
    bpVassalDismissBtn.hidden = v.levyOnField === 0 || v.levyReturning;
    setIconText(bpVassalLevyEl, "callToArms", `Levy: ${v.levyStatus}${v.canCall ? ` (${v.levySize} would march)` : ""}`);
    bpVassalTax = v.tax;
    bpVassalTaxBtn.textContent = `Demand tribute: ${v.tax ? "On" : "Off"}`;
    bpVassalTaxBtn.disabled = !v.tax && !v.canTax;
    bpVassalTaxBtn.title = v.canTax || v.tax ? "Take a share of their stock and purse every 2 days (costs relation)" : v.taxReason;
    bpVassalTaxStateEl.textContent = v.canTax ? `Estimate: ${v.estimate}` : v.taxReason;
    setIconText(bpVassalLedgerEl, "tribute", `Tribute: last ${v.lastTax} · next ${v.nextTax} · total ${v.taxGoldTotal} gold`);
  }
  bpVassalCallBtn.addEventListener("click", () => {
    bpVassalCallBtn.blur();
    if (!infoTile) return;
    // Strategy mode: the levy joins the selected army (follows its first unit); otherwise it follows the player.
    const follow = strategyCam.inStrategy && selectedIds.size > 0 ? [...selectedIds][0] : undefined;
    sendMessage({ type: "callToArms", tileX: infoTile.tx, tileY: infoTile.ty, ...(follow ? { followId: follow } : {}) });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpVassalDismissBtn.addEventListener("click", () => {
    bpVassalDismissBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "callToArms", tileX: infoTile.tx, tileY: infoTile.ty, dismiss: true });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpVassalTaxBtn.addEventListener("click", () => {
    bpVassalTaxBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "setTax", tileX: infoTile.tx, tileY: infoTile.ty, on: !bpVassalTax });
    window.setTimeout(requestBuildingInfo, 150);
  });
  const bpTradeRowEl = document.getElementById("bp-trade-row")!;
  const bpTradeBtn = document.getElementById("bp-trade-open") as HTMLButtonElement;
  const bpTradeStateEl = document.getElementById("bp-trade-state")!;
  const tradePanelEl = document.getElementById("trade-panel")!;
  const tpNameEl = document.getElementById("tp-name")!;
  const tpRelationEl = document.getElementById("tp-relation")!;
  const tpReasonEl = document.getElementById("tp-reason")!;
  const tpFootEl = document.getElementById("tp-foot")!;
  const tpBodyEl = document.querySelector("#tp-goods tbody")!;
  const TRADE_GOOD_LABEL: Record<TradeGood, string> = {
    grain: "Grain", meat: "Meat", fruit: "Fruit", wool: "Wool", wood: "Wood", rock: "Rock", iron: "Iron", clothes: "Cloth", tools: "Tools",
  };
  let tradeOpen = false;
  let tradeKey = "";
  function sendTrade(good: TradeGood, qty: number, side: "buy" | "sell") {
    if (!infoTile) return;
    sendMessage({ type: "tradeWithSite", tileX: infoTile.tx, tileY: infoTile.ty, good, qty, side });
    window.setTimeout(requestBuildingInfo, 150);
  }
  function renderTrade(trade: BuildingInfo["trade"]) {
    tradePanelEl.hidden = !tradeOpen || !trade;
    if (!trade || !tradeOpen) return;
    tpNameEl.textContent = `Trade: ${trade.siteName}`;
    const pct = Math.round((1 - trade.discount) * 100);
    setIconText(tpRelationEl, relIcon(trade.tier), `${RELATION_TIER_NAMES[trade.tier]} (relation ${trade.relation})${pct > 0 ? ` · ${pct}% better prices` : ""} · their purse ${trade.gold} gold`);
    tpReasonEl.textContent = trade.reason;
    tpReasonEl.hidden = trade.reason === "";
    // Rebuild the rows only when something changed (the panel refreshes every second; keeps clicks landing).
    const key = JSON.stringify(trade);
    if (key === tradeKey) return;
    tradeKey = key;
    const btn = (label: string, enabled: boolean, title: string, on: () => void) => {
      const b = document.createElement("button");
      b.className = "econ-btn";
      b.textContent = label;
      b.disabled = !enabled;
      b.title = title;
      b.addEventListener("click", () => {
        b.blur();
        on();
      });
      return b;
    };
    tpBodyEl.replaceChildren(
      ...trade.goods.map((g) => {
        const tr = document.createElement("tr");
        const cell = (...kids: (string | HTMLElement)[]) => {
          const td = document.createElement("td");
          td.append(...kids);
          tr.append(td);
        };
        const canBuy = trade.canTrade && g.buyLeft > 0;
        const canSell = trade.canTrade && g.sellLeft > 0;
        cell(TRADE_GOOD_LABEL[g.good]);
        cell(`${g.stock}/${g.cap}`);
        cell(g.buy.toFixed(2));
        cell(
          btn("+1", canBuy, `Buy 1 (${g.buyLeft} more today)`, () => sendTrade(g.good, 1, "buy")),
          btn("+10", canBuy, `Buy 10 (${g.buyLeft} more today)`, () => sendTrade(g.good, 10, "buy"))
        );
        cell(g.sell.toFixed(2));
        cell(
          btn("-1", canSell, `Sell 1 (${g.sellLeft} more today)`, () => sendTrade(g.good, 1, "sell")),
          btn("-10", canSell, `Sell 10 (${g.sellLeft} more today)`, () => sendTrade(g.good, 10, "sell"))
        );
        return tr;
      })
    );
    tpFootEl.textContent = "Prices rise as you buy and fall as you sell the same good on one day. Each trade earns a little relation (up to 6 a day).";
  }
  // Forts phase D2: settlement quests (snapshot `quests`, the clan's open ones): the top-bar Quests button,
  // the parchment Quests panel (accept / abandon / deliver) and minimap markers (drawMinimap).
  let latestQuests: QuestSnapshot[] = [];
  let questCycleTicks = TICK_RATE * 375;
  let questKey = "";
  let questSeen = new Set<number>();
  const questPanelEl = document.getElementById("quest-panel")!;
  const questListEl = document.getElementById("qp-list")!;
  const questEmptyEl = document.getElementById("qp-empty")!;
  const questsBtn = document.getElementById("quests-btn") as HTMLButtonElement;
  function questTimeLeft(ticks: number): string {
    if (ticks >= questCycleTicks / 2) return `${(ticks / questCycleTicks).toFixed(1)} days left`;
    const secs = Math.ceil(ticks / TICK_RATE);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} left`;
  }
  function questMeta(q: QuestSnapshot): string {
    const progress = q.need !== undefined ? ` · slain ${q.progress ?? 0} / ${q.need}` : "";
    return `Reward ${q.reward} gold, relation +${q.relation} · ${q.accepted ? `fail -${q.penalty}` : `ignore -${q.penalty}`}${progress}`;
  }
  function renderQuests() {
    const open = !questPanelEl.hidden;
    if (open) for (const q of latestQuests) questSeen.add(q.id);
    const unseen = latestQuests.some((q) => !q.accepted && !questSeen.has(q.id));
    questsBtn.textContent = latestQuests.length > 0 ? `Quests (${latestQuests.length})` : "Quests";
    questsBtn.classList.toggle("has-new", unseen);
    if (!open) return;
    questEmptyEl.hidden = latestQuests.length > 0;
    const key = JSON.stringify(latestQuests.map((q) => ({ ...q, ticksLeft: 0 })));
    if (key !== questKey) {
      questKey = key;
      questListEl.replaceChildren(
        ...latestQuests.map((q) => {
          const el = document.createElement("div");
          el.className = `qp-quest${q.accepted ? " accepted" : ""}`;
          el.dataset.questId = String(q.id);
          const name = document.createElement("div");
          name.className = "qp-name has-icon";
          // Batch 2 (SPRITES.md #81): new / accepted quest seal; without the file the CSS "!" / tick shows.
          const seal = document.createElement("img");
          seal.className = "ui-ico";
          seal.alt = "";
          seal.src = q.accepted ? "/sprites/ui-questActive.png" : "/sprites/ui-questNew.png";
          seal.onerror = () => {
            seal.remove();
            name.classList.remove("has-icon");
          };
          name.append(seal, q.title);
          const text = document.createElement("div");
          text.className = "qp-text";
          text.textContent = q.text;
          const meta = document.createElement("div");
          meta.className = "qp-meta";
          setIconText(meta, "reward", questMeta(q));
          const time = document.createElement("div");
          time.className = "qp-meta qp-time";
          const btns = document.createElement("div");
          btns.className = "qp-btns";
          const btn = (label: string, title: string, type: "acceptQuest" | "abandonQuest" | "deliverQuest") => {
            const b = document.createElement("button");
            b.className = "econ-btn";
            b.textContent = label;
            b.title = title;
            b.addEventListener("click", () => {
              b.blur();
              sendMessage({ type, questId: q.id });
            });
            return b;
          };
          if (!q.accepted) btns.append(btn("Accept", "Take on this quest", "acceptQuest"));
          else {
            if (q.kind === "deliver") btns.append(btn("Deliver", `Hand over ${q.qty} from your stock (stand near ${q.siteName}'s walls)`, "deliverQuest"));
            btns.append(btn("Abandon", `Give up (relation -${q.penalty})`, "abandonQuest"));
          }
          el.append(name, text, meta, time, btns);
          return el;
        })
      );
    }
    for (const el of Array.from(questListEl.querySelectorAll<HTMLElement>(".qp-quest"))) {
      const q = latestQuests.find((o) => String(o.id) === el.dataset.questId);
      const t = el.querySelector(".qp-time");
      if (q && t) t.textContent = `${q.siteName} · ${questTimeLeft(q.ticksLeft)}`;
    }
  }
  function setQuestPanelOpen(open: boolean) {
    questPanelEl.hidden = !open;
    questKey = "";
    renderQuests();
  }
  questsBtn.addEventListener("click", () => {
    questsBtn.blur();
    setQuestPanelOpen(questPanelEl.hidden);
  });

  // ---- World streaming phase 5: the chronicle (server `chronicle` messages) ----
  const chroniclePanelEl = document.getElementById("chronicle-panel")!;
  const chronicleListEl = document.getElementById("cp-list")!;
  const chronicleEmptyEl = document.getElementById("cp-empty")!;
  const chronicleBtn = document.getElementById("chronicle-btn") as HTMLButtonElement;
  let chronicleEntries: ChronicleEntry[] = [];
  // Entries with an id above this arrived "while you were away" (the profile's read mark on the server).
  let chronicleAwaySince = 0;
  let chronicleRead = 0;
  function onChronicle(m: { entries: ChronicleEntry[]; since?: number; full?: boolean }) {
    if (m.full) {
      chronicleEntries = [...m.entries];
      chronicleAwaySince = chronicleRead = m.since ?? 0;
      const away = chronicleEntries.filter((e) => e.id > chronicleAwaySince).length;
      if (away > 0) pushEventToast("milestone", `While you were away: ${away} entr${away === 1 ? "y" : "ies"} in the Chronicle`);
    } else {
      chronicleEntries.push(...m.entries);
      if (chronicleEntries.length > 120) chronicleEntries.splice(0, chronicleEntries.length - 120);
    }
    renderChronicle();
  }
  function renderChronicle() {
    const open = !chroniclePanelEl.hidden;
    const last = chronicleEntries.length ? chronicleEntries[chronicleEntries.length - 1].id : 0;
    if (open && last > chronicleRead) {
      chronicleRead = last;
      sendMessage({ type: "chronicleSeen", id: last });
    }
    const unread = chronicleEntries.filter((e) => e.id > chronicleRead).length;
    chronicleBtn.textContent = unread > 0 ? `Chronicle (${unread})` : "Chronicle";
    chronicleBtn.classList.toggle("has-new", unread > 0);
    if (!open) return;
    chronicleEmptyEl.hidden = chronicleEntries.length > 0;
    chronicleListEl.replaceChildren();
    // Newest first: the "while you were away" block, then the rest under "Earlier".
    type Section = "" | "away" | "earlier";
    let section = "" as Section;
    for (const e of [...chronicleEntries].reverse()) {
      const away = e.id > chronicleAwaySince;
      const want: Section = away ? "away" : section === "away" ? "earlier" : section;
      if (want !== section) {
        const h = document.createElement("div");
        h.className = "cp-head";
        h.textContent = want === "away" ? "While you were away" : "Earlier";
        chronicleListEl.append(h);
        section = want;
      }
      const row = document.createElement("div");
      row.className = `cp-entry${away ? " new" : ""}`;
      const day = document.createElement("span");
      day.className = "cp-day";
      day.textContent = `Day ${e.day}`;
      row.append(day, e.text);
      chronicleListEl.append(row);
    }
  }
  function setChroniclePanelOpen(open: boolean) {
    chroniclePanelEl.hidden = !open;
    // Closing it: what was read is no longer "while you were away".
    if (!open) chronicleAwaySince = chronicleRead;
    renderChronicle();
  }
  chronicleBtn.addEventListener("click", () => {
    chronicleBtn.blur();
    setChroniclePanelOpen(chroniclePanelEl.hidden);
  });
  document.getElementById("cp-close")!.addEventListener("click", () => setChroniclePanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !chroniclePanelEl.hidden) setChroniclePanelOpen(false);
  });
  document.getElementById("qp-close")!.addEventListener("click", () => setQuestPanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !questPanelEl.hidden) setQuestPanelOpen(false);
  });

  bpTradeBtn.addEventListener("click", () => {
    bpTradeBtn.blur();
    tradeOpen = !tradeOpen;
    requestBuildingInfo();
  });
  document.getElementById("tp-close")!.addEventListener("click", () => {
    tradeOpen = false;
    tradePanelEl.hidden = true;
  });
  // Tile the panel shows; re-requested every second while open so numbers stay live.
  let infoTile: { tx: number; ty: number } | null = null;
  const BUILDING_INFO_REFRESH_MS = 1000;

  function requestBuildingInfo() {
    if (infoTile) sendMessage({ type: "buildingInfo", tileX: infoTile.tx, tileY: infoTile.ty });
  }
  function openBuildingInfo(tx: number, ty: number) {
    infoTile = { tx, ty };
    tradeOpen = false;
    requestBuildingInfo();
  }
  function closeBuildingInfo() {
    infoTile = null;
    buildingPanelEl.hidden = true;
    tradeOpen = false;
    tradePanelEl.hidden = true;
  }
  function renderBuildingInfo(info: BuildingInfo) {
    bpNameEl.textContent = info.name;
    bpLevelEl.textContent = info.maxLevel > 1 ? `Lv ${info.level}/${info.maxLevel}` : "";
    bpStaffingEl.textContent = info.staffing;
    bpHpEl.hidden = info.hp === null;
    if (info.hp !== null) bpHpEl.textContent = `HP ${info.hp}/${info.maxHp}`;
    bpConstructionEl.hidden = info.construction === null;
    if (info.construction !== null) {
      const label = info.tile === TileType.ConstructionSite ? "Under construction" : "Upgrading";
      bpConstructionEl.textContent = `${label}: ${Math.round(info.construction * 100)}%`;
    }
    const lines = [...info.bonuses, ...(info.progression ?? [])];
    const items = lines.length > 0 ? lines : ["None yet"];
    bpBonusesEl.replaceChildren(
      ...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      })
    );
    bpUpgradeRowEl.hidden = info.upgrade === null;
    if (info.upgrade) {
      bpUpgradeBtn.disabled = !info.upgrade.enabled;
      bpUpgradeCostEl.textContent = info.upgrade.reason ? `${info.upgrade.cost} (${info.upgrade.reason})` : info.upgrade.cost;
    }
    bpRepairRowEl.hidden = info.repair === null;
    if (info.repair) {
      bpRepairBtn.disabled = !info.repair.enabled;
      bpRepairCostEl.textContent = info.repair.reason ? `${info.repair.cost} (${info.repair.reason})` : info.repair.cost;
    }
    bpKeepRowEl.hidden = !info.keep;
    if (info.keep) {
      bpKeepBtn.disabled = !info.keep.enabled;
      bpKeepStateEl.textContent = info.keep.reason ? `${info.keep.cost} (${info.keep.reason})` : info.keep.cost;
    }
    renderTradingPost(info.tradingPost);
    renderVassal(info.vassal);
    bpTradeRowEl.hidden = !info.trade;
    if (info.trade) {
      bpTradeBtn.textContent = tradeOpen ? "Close trade" : "Trade";
      setIconText(bpTradeStateEl, info.trade.canTrade ? relIcon(info.trade.tier) : "relation", info.trade.canTrade ? `${RELATION_TIER_NAMES[info.trade.tier]} prices` : info.trade.reason);
    } else tradeOpen = false;
    renderTrade(info.trade);
    bpGateRowEl.hidden = !info.gate;
    if (info.gate) {
      shownGateLock = info.gate.lock;
      bpGateBtn.textContent = `Lock: ${GATE_LOCK_LABEL[info.gate.lock]}`;
      bpGateStateEl.textContent = info.gate.overrun ? "Overrun!" : info.gate.open ? "Open" : "Closed";
    }
    bpLevyRowEl.hidden = !info.levy;
    if (info.levy) {
      const l = info.levy;
      shownLevyOnField = l.onField;
      bpLevyBtn.disabled = l.onField === 0 && l.reason !== "";
      bpLevyBtn.textContent = l.onField > 0 ? `Stand down (${l.onField})` : `Call to arms (${l.ready} villagers)`;
      bpLevyBtn.title = l.onField > 0 ? "Send the levy back to work now" : l.reason || "Civilians fight as militia for half a day, then go back to work";
      bpLevyStateEl.textContent = l.onField > 0 ? `${l.onField} levies on the field, ${Math.ceil(l.ticksLeft / 20)} s left` : l.reason || `${l.ready} adult civilians would take up spears`;
    }
    bpTrainRowEl.hidden = !info.train;
    if (info.train) {
      const t = info.train;
      const name = t.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
      bpTrainBtn.disabled = t.reason !== "";
      // Basic militia need no gear: unarmed (weaker, no armour) unless a T1 weapon + armour are in stock.
      const gear = t.gearOptional ? (t.geared ? "takes T1 weapon + armour" : "unarmed: no gear in stock") : `T${t.level} weapon + armour`;
      bpTrainBtn.textContent = `Train ${name} (${gear}, ${t.days} day${t.days === 1 ? "" : "s"})`;
      bpTrainBtn.title =
        t.reason ||
        (t.gearOptional
          ? "Takes one free adult civilian. Basic militia train without gear; with a T1 weapon + armour in stock they take them (unarmed militia hit softer and have no armour)"
          : `Takes one free adult civilian and a T${t.level} weapon + armour`);
      bpTrainStateEl.textContent = `Troops ${t.troops}/${t.cap}${t.training ? ` · ${t.training} in training` : ""}${t.reason ? ` · ${t.reason}` : ""}`;
    }
    bpSiegeRowEl.hidden = !info.siege;
    if (info.siege) {
      for (const opt of info.siege.options) {
        const btn = bpSiegeBtns.get(opt.kind);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `Build ${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const reason = info.siege.options.find((o) => !o.enabled)?.reason ?? "";
      bpSiegeStateEl.textContent = info.siege.building
        ? `Building: ${info.siege.building === "batteringRam" ? "Battering Ram" : "Catapult"} ${Math.round((info.siege.progress ?? 0) * 100)}%`
        : `Engines ${info.siege.units}/${info.siege.cap}${reason ? ` · ${reason}` : ""}`;
    }
    bpForgeRowEl.hidden = !info.forge;
    if (info.forge) {
      for (const opt of info.forge.options) {
        const btn = bpForgeBtns.get(opt.slot);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const f = info.forge;
      const reason = f.options.find((o) => !o.enabled)?.reason ?? "";
      const head = f.queue[0];
      // A long queue (cap 20) reads as counts per slot / tier: "then Armour T2 x5, Weapon T2 x3".
      const rest = new Map<string, number>();
      for (const q of f.queue.slice(1)) {
        const k = `${q.slot === "armour" ? "Armour" : "Weapon"} T${q.tier}`;
        rest.set(k, (rest.get(k) ?? 0) + 1);
      }
      const then = rest.size > 0 ? ` · then ${Array.from(rest, ([k, n]) => `${k} x${n}`).join(", ")}` : "";
      bpForgeStateEl.textContent = head
        ? `Forging: ${head.slot === "armour" ? "Armour" : "Weapon"} T${head.tier} ${Math.round((f.progress ?? 0) * 100)}% · queue ${f.queue.length}/${f.cap}${then}${reason ? ` · ${reason}` : ""}`
        : `Forges tier ${f.tier} · queue 0/${f.cap}${reason ? ` · ${reason}` : ""}`;
      const auto = f.auto;
      bpForgeAutoBtn.hidden = bpForgeAutoLessBtn.hidden = bpForgeAutoMoreBtn.hidden = bpForgeAutoStateEl.hidden = !auto;
      if (auto) {
        shownForgeAuto = { on: auto.on, target: auto.target };
        bpForgeAutoBtn.textContent = `Autocraft: ${auto.on ? "On" : "Off"}`;
        bpForgeAutoBtn.classList.toggle("active", auto.on);
        bpForgeAutoStateEl.textContent = `Autocraft target ${auto.target} armour + ${auto.target} weapons T${f.tier} (keeps ${auto.reserve} iron / wood)${auto.on ? ` · ${auto.status}` : ""}`;
      }
    }
    bpHeroesRowEl.hidden = !info.heroes;
    if (info.heroes) {
      const h = info.heroes;
      for (const opt of h.options) {
        const btn = bpHeroBtns.get(opt.heroClass);
        if (!btn) continue;
        btn.disabled = !opt.enabled;
        btn.textContent = `Recruit ${opt.label} (${opt.cost})`;
        btn.title = opt.reason;
      }
      const reason = h.options.find((o) => !o.enabled)?.reason ?? "";
      const roster = h.roster.map((r) => `${r.name} (${HERO_CLASS_LABEL[r.heroClass]} Lv ${r.level}) - ${r.status}`).join("\n");
      bpHeroesStateEl.textContent = `Heroes ${h.count}/${h.cap}${reason ? ` · ${reason}` : ""}${roster ? `\n${roster}` : ""}`;
    }
    // Hero phase 4: a Church teaches the two basic spells to the player for colony gold.
    bpSpellsRowEl.hidden = !info.spellShop;
    if (info.spellShop) {
      const key = JSON.stringify(info.spellShop);
      if (key !== bpSpellsKey) {
        bpSpellsKey = key;
        bpSpellsRowEl.replaceChildren(
          ...info.spellShop.map((opt) => {
            const btn = document.createElement("button");
            btn.className = "econ-btn";
            btn.disabled = !opt.enabled;
            btn.textContent = `Learn ${opt.label} (${opt.gold} gold)`;
            btn.title = opt.reason || SPELLS[opt.spellId].text.replace("{power}", String(SPELLS[opt.spellId].power));
            btn.addEventListener("click", () => {
              btn.blur();
              if (!infoTile) return;
              sendMessage({ type: "learnSpell", spellId: opt.spellId, tileX: infoTile.tx, tileY: infoTile.ty });
              window.setTimeout(requestBuildingInfo, 150);
            });
            return btn;
          })
        );
      }
    }
    buildingPanelEl.hidden = false;
  }
  for (const [cls, btn] of bpHeroBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "recruitHero", tx: infoTile.tx, ty: infoTile.ty, class: cls });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  bpLevyBtn.addEventListener("click", () => {
    bpLevyBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "callVillagers", tileX: infoTile.tx, tileY: infoTile.ty, ...(shownLevyOnField > 0 ? { dismiss: true } : {}) });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpTrainBtn.addEventListener("click", () => {
    bpTrainBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "trainUnit", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  for (const [slot, btn] of bpForgeBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "queueForge", tileX: infoTile.tx, tileY: infoTile.ty, slot });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  const sendForgeAuto = (on: boolean, target: number) => {
    if (!infoTile) return;
    sendMessage({ type: "setForgeAuto", tileX: infoTile.tx, tileY: infoTile.ty, on, target: Math.max(1, Math.min(20, target)) });
    window.setTimeout(requestBuildingInfo, 150);
  };
  bpForgeAutoBtn.addEventListener("click", () => {
    bpForgeAutoBtn.blur();
    sendForgeAuto(!shownForgeAuto.on, shownForgeAuto.target);
  });
  bpForgeAutoLessBtn.addEventListener("click", () => {
    bpForgeAutoLessBtn.blur();
    sendForgeAuto(true, shownForgeAuto.target - 1);
  });
  bpForgeAutoMoreBtn.addEventListener("click", () => {
    bpForgeAutoMoreBtn.blur();
    sendForgeAuto(true, shownForgeAuto.target + 1);
  });
  bpKeepBtn.addEventListener("click", () => {
    bpKeepBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "rebuildKeep", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpGateBtn.addEventListener("click", () => {
    bpGateBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "setGateLock", tileX: infoTile.tx, tileY: infoTile.ty, lock: GATE_LOCK_NEXT[shownGateLock] });
    window.setTimeout(requestBuildingInfo, 150);
  });
  for (const [kind, btn] of bpSiegeBtns) {
    btn.addEventListener("click", () => {
      btn.blur();
      if (!infoTile) return;
      sendMessage({ type: "queueSiege", tileX: infoTile.tx, tileY: infoTile.ty, kind });
      window.setTimeout(requestBuildingInfo, 150);
    });
  }
  bpUpgradeBtn.addEventListener("click", () => {
    bpUpgradeBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "upgradeBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  bpRepairBtn.addEventListener("click", () => {
    bpRepairBtn.blur();
    if (!infoTile) return;
    sendMessage({ type: "repairBuilding", tileX: infoTile.tx, tileY: infoTile.ty });
    window.setTimeout(requestBuildingInfo, 150);
  });
  document.getElementById("bp-close")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    closeBuildingInfo();
  });
  window.setInterval(() => {
    if (infoTile && !buildingPanelEl.hidden) requestBuildingInfo();
  }, BUILDING_INFO_REFRESH_MS);

  // ---- Builders counter and game over ----
  const statBuildersEl = document.getElementById("stat-builders")!;
  const statRespawnEl = document.getElementById("stat-respawn")!;
  function refreshBuilderCount(colonists: ColonistSnapshot[], isNight: boolean) {
    let total = 0;
    let working = 0;
    for (const c of colonists) {
      if (c.kind !== "builder") continue;
      total++;
      if (!isNight && (c.state === "building" || c.state === "carrying" || c.state === "repairing" || c.state === "toRepair")) working++;
    }
    statBuildersEl.textContent = `Builders  ${working}/${total} working`;
  }
  const gameOverEl = document.getElementById("game-over")!;
  // Village life phase 5: a dead rider with `heirs` picks one (heir picker); dead without heirs is game over.
  const heirPickerEl = document.getElementById("heir-picker")!;
  const heirListEl = document.getElementById("heir-list")!;
  let heirListKey = "";
  function refreshGameOver(me: PlayerSnapshot | undefined) {
    const heirs = me?.dead ? me.heirs ?? [] : [];
    gameOverEl.hidden = !(me?.dead && heirs.length === 0);
    heirPickerEl.hidden = heirs.length === 0;
    const key = JSON.stringify(heirs);
    if (key === heirListKey) return;
    heirListKey = key;
    heirListEl.replaceChildren(
      ...heirs.map((h) => {
        const b = document.createElement("button");
        b.className = "menu-btn secondary heir-btn";
        const role = h.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
        b.textContent = h.id === "church" ? h.name : `${h.name}: ${role}${h.heroLevel ? `, level ${h.heroLevel}` : ""}${h.ageDays !== undefined ? `, ${h.ageDays} days old` : ""}`;
        b.addEventListener("click", () => {
          b.blur();
          sendMessage({ type: "chooseHeir", id: h.id });
        });
        return b;
      })
    );
  }
  document.getElementById("game-over-restart")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    sendMessage({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize, creative: creativeUi.on, solo: preferredSolo && !creativeUi.on });
  });

  // ---- Networking ----

  // Hero phases 1-2: a stored per-browser profile id, so this player's gear / XP follow them across sessions.
  let profileId = "";
  try {
    profileId = localStorage.getItem("sworn.profileId") ?? "";
    if (!/^[\w-]{1,64}$/.test(profileId)) {
      profileId = (crypto.randomUUID?.() ?? `p${Date.now()}${Math.floor(Math.random() * 1e9)}`).replace(/[^\w-]/g, "");
      localStorage.setItem("sworn.profileId", profileId);
    }
  } catch {
    profileId = "";
  }
  const wsParams = new URLSearchParams();
  if (profileId) wsParams.set("profile", profileId);
  if (clanParam()) wsParams.set("clan", clanParam());
  // World streaming phase 4: take chunked welcomes on streamed (768+ tile) worlds.
  wsParams.set("chunks", "1");
  const socket = new WebSocket(wsParams.toString() ? `${SERVER_URL}/?${wsParams}` : SERVER_URL);

  const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
  const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;

  pauseBtn.addEventListener("click", () => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "pause" }));
    }
    pauseBtn.blur();
  });

  // ---- Strategy mode phase 5: global time controls. Pause and speed are the server's, for everyone (no
  // handshake: whoever changes them last wins); the status line says who it was. Shift+Space pauses /
  // resumes, Shift+[ / Shift+] step the speed down / up (plain [ ] stay build hotkeys).
  const timeControlsEl = document.getElementById("time-controls")!;
  const timeStatusEl = document.getElementById("time-status")!;
  let currentTimeScale = 1;
  let currentPaused = false;
  function sendTimeScale(scale: number) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "setTimeScale", scale }));
  }
  for (const b of Array.from(timeControlsEl.querySelectorAll<HTMLButtonElement>("button[data-scale]"))) {
    b.addEventListener("click", () => {
      b.blur();
      sendTimeScale(Number(b.dataset.scale));
    });
  }
  window.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "pause", paused: !currentPaused }));
      return;
    }
    const step = e.code === "BracketLeft" ? -1 : e.code === "BracketRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    if (e.repeat) return;
    const scales = TIME_SCALES as readonly number[];
    const i = Math.max(0, scales.indexOf(currentTimeScale));
    const next = scales[Math.max(0, Math.min(scales.length - 1, i + step))];
    if (next !== currentTimeScale) sendTimeScale(next);
  });

  function whoLabel(id: string | undefined, players: PlayerSnapshot[]): string {
    if (!id) return "";
    if (id === myId) return "you";
    const i = players.findIndex((p) => p.id === id);
    return i >= 0 ? `Player ${i + 1}` : "a player who left";
  }

  function syncTimeControls(paused: boolean, pausedBy: string | undefined, scale: number, scaleBy: string | undefined, players: PlayerSnapshot[]) {
    currentPaused = paused;
    currentTimeScale = scale;
    for (const b of Array.from(timeControlsEl.querySelectorAll<HTMLButtonElement>("button[data-scale]"))) {
      b.classList.toggle("active", Number(b.dataset.scale) === scale);
    }
    const speed = scale === 1 ? "" : `${scale === 0.25 ? "¼" : scale === 0.5 ? "½" : `${scale}x`} speed`;
    const parts: string[] = [];
    if (paused) parts.push(`Paused${pausedBy ? ` by ${whoLabel(pausedBy, players)}` : ""}`);
    if (speed) parts.push(`${speed}${scaleBy ? ` (set by ${whoLabel(scaleBy, players)})` : ""}`);
    const text = parts.join(" · ");
    timeStatusEl.hidden = text === "";
    if (timeStatusEl.textContent !== text) timeStatusEl.textContent = text;
    const banner = paused && pausedBy ? `PAUSED by ${whoLabel(pausedBy, players)}` : "PAUSED";
    if (pausedBanner.text !== banner) pausedBanner.text = banner;
  }

  restartBtn.addEventListener("click", () => {
    restartBtn.blur();
    if (!window.confirm("Restart the world for everyone connected?")) return;
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize, creative: creativeUi.on, solo: preferredSolo && !creativeUi.on }));
    }
  });

  const eventFeedEl = document.getElementById("event-feed")!;
  const TOAST_SHOW_MS = 5000;
  const TOAST_FADE_MS = 600;
  const TOAST_DROP_MS = 200;
  const MAX_TOASTS = 5;

  function removeToast(toast: HTMLElement, cls: "fading" | "dropped", fadeMs: number) {
    if (toast.classList.contains("dropped") || toast.classList.contains("fading")) return;
    toast.classList.add(cls);
    window.setTimeout(() => toast.remove(), fadeMs);
  }

  // ---- Armour & weapons: "Armour T1/T2/T3: 2/0/1 · Weapons: 3/1/0" (amber when a slot is empty) ----
  const statEquipmentEl = document.getElementById("stat-equipment")!;
  let equipmentLineKey = "";
  function refreshEquipmentLine(eq: EquipmentStock | undefined) {
    statEquipmentEl.hidden = !eq;
    if (!eq) return;
    for (let t = 1; t <= 3; t++) {
      setGoodCount(`gear:weapon:${t}`, eq.weapon[t - 1] ?? 0);
      setGoodCount(`gear:armour:${t}`, eq.armour[t - 1] ?? 0);
    }
    const key = `${eq.armour.join("/")}|${eq.weapon.join("/")}`;
    if (key === equipmentLineKey) return;
    equipmentLineKey = key;
    const part = (label: string, counts: number[]) => {
      const span = document.createElement("span");
      span.textContent = `${label}: ${counts.join("/")}`;
      if (counts.every((n) => n <= 0)) {
        span.className = "equip-empty";
        span.title = "None in stock: new soldiers muster without it";
      }
      return span;
    };
    statEquipmentEl.replaceChildren(part("Armour T1/T2/T3", eq.armour), " · ", part("Weapons", eq.weapon));
  }

  // ---- Hero phases 1-2: Character sheet (` key or the Hero button). The server sends this player's
  // profile in a snapshot only when it changes (snapshot.profile); the sheet re-renders then, or when the
  // colony's armoury stock changes while it's open. Placeholder icons: a coloured square with a slot
  // glyph and a rarity border (bronze / silver / gold / purple-teal relic); a real icon (SPRITES.md #49 /
  // #51, /sprites/<item.icon>.png) is drawn over it once that file exists.
  const heroModal = document.getElementById("hero-modal")!;
  const hsDoll = document.getElementById("hs-doll")!;
  const hsInv = document.getElementById("hs-inv")!;
  const hsStats = document.getElementById("hs-stats")!;
  const hsArmoury = document.getElementById("hs-armoury")!;
  const hsTip = document.getElementById("hs-tip")!;
  let heroProfile: HeroProfileSnapshot | null = null;
  // Hero phase 3: the colony's heroes (snapshot `heroes`) and the open tab ("" = the player).
  let heroSheets: HeroSheetSnapshot[] = [];
  let sheetTab = "";
  const hsTabs = document.getElementById("hs-tabs")!;
  const hsTitle = document.getElementById("hs-title")!;
  let heroStock: EquipmentStock | undefined;
  let heroRenderKey = "";
  let heroHpText = "";
  let heroMe: PlayerSnapshot | undefined;
  const missingIcons = new Set<string>();
  const SLOT_LABEL: Record<GearSlot, string> = {
    head: "Head", chest: "Chest", legs: "Legs", weapon: "Weapon", offhand: "Off-hand", trinket1: "Trinket", trinket2: "Trinket",
    spell1: "Spell", spell2: "Spell", spell3: "Spell", spell4: "Spell",
  };
  const SLOT_GLYPH: Record<string, string> = {
    head: "H", chest: "C", legs: "L", offhand: "O", trinket: "T", spell: "✶", tome: "▤",
    sword: "⚔", spear: "↑", bow: ")", staff: "|", shield: "O", helm: "H", greaves: "L", cuirass: "C",
  };
  const SLOT_FILL: Record<string, string> = {
    head: "#5b6b7a", chest: "#6b4a2a", legs: "#4f5a3a", weapon: "#7a3a2a", offhand: "#3a4f6b", trinket: "#6b5a2a", spell: "#4a2f6b", tome: "#4a2f6b",
  };
  const STAT_LINES: { key: keyof ItemStats; label: string; pct: boolean; lowerIsBetter?: boolean }[] = [
    { key: "damagePct", label: "damage", pct: true },
    { key: "damageTakenPct", label: "damage taken", pct: true, lowerIsBetter: true },
    { key: "maxHp", label: "max HP", pct: false },
    { key: "moveSpeedPct", label: "move speed", pct: true },
    { key: "attackSpeedPct", label: "attack speed", pct: true },
    { key: "spellPowerPct", label: "spell power", pct: true },
  ];
  const signed = (n: number, pct: boolean) => `${n > 0 ? "+" : ""}${n}${pct ? "%" : ""}`;

  function gearSlotFor(item: GearItem, prof: HeroProfileSnapshot): GearSlot | null {
    if (item.slot === "spell" || item.slot === "tome") return null;
    if (item.slot === "trinket") return prof.equipment.trinket1 && !prof.equipment.trinket2 ? "trinket2" : "trinket1";
    return item.slot;
  }

  function itemIcon(item: GearItem): HTMLElement {
    const el = document.createElement("div");
    el.className = `hs-item ${item.tier === "relic" ? "relic" : `t${item.tier}`}`;
    el.style.background = SLOT_FILL[item.slot] ?? "#555";
    el.textContent = SLOT_GLYPH[item.kind ?? ""] ?? SLOT_GLYPH[item.slot] ?? "?";
    // A Spell Tome shows its spell's current icon (saved tomes may carry an older icon name).
    const icon = item.spellId ? SPELLS[item.spellId].icon : item.icon;
    if (icon && !missingIcons.has(icon)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = `/sprites/${icon}.png`;
      img.onerror = () => {
        missingIcons.add(icon);
        img.remove();
      };
      el.append(img);
    }
    return el;
  }

  function showItemTip(e: MouseEvent, item: GearItem, compare: GearItem | null, hint: string, showDelta: boolean) {
    hsTip.replaceChildren();
    const name = document.createElement("b");
    name.textContent = item.name;
    const tier = document.createElement("div");
    tier.className = "tier";
    tier.textContent = item.tier === "relic" ? `Relic · ${SLOT_LABEL[gearSlotFor(item, heroProfile!) ?? "head"]}` : `Tier ${item.tier} · ${SLOT_LABEL[gearSlotFor(item, heroProfile!) ?? "head"]}`;
    hsTip.append(name, tier);
    for (const line of STAT_LINES) {
      const v = item.stats[line.key] ?? 0;
      const old = compare?.stats[line.key] ?? 0;
      if (v === 0 && old === 0) continue;
      const row = document.createElement("div");
      row.textContent = `${signed(v, line.pct)} ${line.label}`;
      if (showDelta) {
        const d = v - old;
        if (d !== 0) {
          const span = document.createElement("span");
          const better = line.lowerIsBetter ? d < 0 : d > 0;
          span.className = better ? "up" : "down";
          span.textContent = ` (${signed(d, line.pct)})`;
          row.append(span);
        }
      }
      hsTip.append(row);
    }
    const foot = document.createElement("div");
    foot.className = "tier";
    foot.textContent = compare ? `${hint} · vs ${compare.name}` : hint;
    hsTip.append(foot);
    hsTip.hidden = false;
    hsTip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    hsTip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - hsTip.offsetHeight - 8)}px`;
  }

  function hideItemTip() {
    hsTip.hidden = true;
  }

  function makeSocket(slot: GearSlot | null, item: GearItem | null, opts: { disabled?: boolean; empty?: string; onClick?: () => void; tip?: (e: MouseEvent) => void }) {
    const el = document.createElement("div");
    el.className = `hs-socket${opts.disabled ? " disabled" : ""}`;
    if (slot) el.dataset.slot = slot;
    if (item) el.append(itemIcon(item));
    else {
      const empty = document.createElement("span");
      empty.className = "hs-empty";
      empty.textContent = opts.empty ?? "";
      el.append(empty);
    }
    if (opts.onClick && !opts.disabled) el.addEventListener("click", () => {
      hideItemTip();
      opts.onClick!();
    });
    if (opts.tip) {
      el.addEventListener("mousemove", opts.tip);
      el.addEventListener("mouseleave", hideItemTip);
    } else if (opts.disabled) el.title = "Spells: coming soon";
    return el;
  }

  // ---- Hero phase 4: spells on the sheet (icons, tooltips) ----
  const hsSpellbook = document.getElementById("hs-spellbook")!;
  const hsSpellAuto = document.getElementById("hs-spell-auto") as HTMLButtonElement;
  // The spell picked in the spell book, waiting for a slot click.
  let pickedSpell: SpellId | null = null;
  const TARGETING_LABEL = { enemy: "Target an enemy", ally: "Target an ally (or yourself)", ground: "Target a spot", self: "Self" };
  // Placeholder: a coloured square with the spell's glyph; /sprites/<icon>.png (SPRITES.md #57) over it once it exists.
  function spellIcon(id: SpellId): HTMLElement {
    const def = SPELLS[id];
    const el = document.createElement("div");
    el.className = "hs-item spell";
    el.style.background = def.color;
    el.textContent = def.glyph;
    if (!missingIcons.has(def.icon)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = `/sprites/${def.icon}.png`;
      img.onerror = () => {
        missingIcons.add(def.icon);
        img.remove();
      };
      el.append(img);
    }
    return el;
  }
  function spellText(id: SpellId, spellPower: number): string {
    const def = SPELLS[id];
    const n = (v: number) => String(Math.round(v * spellPower * 10) / 10);
    return def.text.replace("{power}", n(def.power)).replace("{burn}", n(def.burnPerSec ?? 0));
  }
  function showSpellTip(e: MouseEvent, id: SpellId, spellPower: number, hint: string) {
    const def = SPELLS[id];
    hsTip.replaceChildren();
    const name = document.createElement("b");
    name.textContent = def.name;
    const meta = document.createElement("div");
    meta.className = "tier";
    meta.textContent = `${TARGETING_LABEL[def.targeting]} · range ${def.range} tiles · cooldown ${def.cooldown} s`;
    const body = document.createElement("div");
    body.textContent = spellText(id, spellPower) + (def.power > 0 && Math.abs(spellPower - 1) > 1e-6 ? ` (spell power x${spellPower.toFixed(2)})` : "");
    const foot = document.createElement("div");
    foot.className = "tier";
    foot.textContent = hint;
    hsTip.append(name, meta, body, foot);
    hsTip.hidden = false;
    hsTip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 270)}px`;
    hsTip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - hsTip.offsetHeight - 8)}px`;
  }

  function renderHeroSheet(force = false) {
    if (heroModal.hidden || !heroProfile) return;
    // Hero phase 3: a hero tab shows that hero's sockets / stats / level over the player's shared pack.
    const hero = sheetTab ? heroSheets.find((h) => h.id === sheetTab) : undefined;
    if (sheetTab && !hero) sheetTab = "";
    const pack = heroProfile;
    const prof: HeroProfileSnapshot = hero ? { ...hero.profile, inventory: pack.inventory, inventoryCap: pack.inventoryCap } : pack;
    const heroArg = hero ? { heroId: hero.id } : {};
    const me = heroMe;
    const unit = hero ? latestColonists.find((c) => c.id === hero.id) : undefined;
    const hpText = hero
      ? unit ? `${Math.ceil(unit.hp)} / ${unit.maxHp}` : hero.status === "recruiting" ? `${prof.stats.maxHp} (arriving)` : `fallen: back at dawn / dusk for ${hero.respawnFee} gold`
      : me ? `${Math.ceil(me.hp)} / ${me.maxHp}` : `${prof.stats.maxHp}`;
    const key = JSON.stringify([{ ...prof, spells: prof.spells ? { ...prof.spells, cooldowns: {} } : undefined }, heroStock, sheetTab, pickedSpell, heroSheets.map((h) => [h.id, h.name, h.status, h.profile.level])]);
    if (!force && key === heroRenderKey) {
      if (hpText !== heroHpText) {
        heroHpText = hpText;
        const hpEl = document.getElementById("hs-hp");
        if (hpEl) hpEl.textContent = hpText;
      }
      return;
    }
    heroRenderKey = key;
    heroHpText = hpText;
    hideItemTip();
    hsTitle.textContent = hero ? `${hero.name} · ${HERO_CLASS_LABEL[hero.heroClass]}` : "Character";
    hsTabs.replaceChildren();
    if (heroSheets.length > 0) {
      const tab = (id: string, label: string, cls = "") => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = `${id === sheetTab ? "active" : ""} ${cls}`.trim();
        b.addEventListener("click", () => {
          sheetTab = id;
          renderHeroSheet(true);
        });
        hsTabs.append(b);
      };
      tab("", "Player");
      for (const h of heroSheets.slice(0, 9)) tab(h.id, `${h.name} Lv ${h.profile.level}`, h.status === "alive" ? "" : "fallen");
    }
    // Paper-doll: trinket / head / trinket, weapon / chest / off-hand, - / legs / -, then 4 spell slots.
    const layout: (GearSlot | null)[] = ["trinket1", "head", "trinket2", "weapon", "chest", "offhand", null, "legs", null];
    hsDoll.replaceChildren();
    for (const slot of layout) {
      if (!slot) {
        hsDoll.append(document.createElement("div"));
        continue;
      }
      const item = prof.equipment[slot];
      hsDoll.append(
        makeSocket(slot, item, {
          empty: SLOT_LABEL[slot],
          onClick: item ? () => sendMessage({ type: "unequipItem", slot, ...heroArg }) : undefined,
          tip: item ? (e) => showItemTip(e, item, null, "Click to unequip", false) : undefined,
        })
      );
    }
    // Hero phase 4: the 4 spell slots. With a spell picked in the spell book below, a click puts it in the
    // slot; otherwise a click on a filled slot empties it.
    const book: SpellBookSnapshot = prof.spells ?? { learned: [], slots: [null, null, null, null], auto: false, cooldowns: {} };
    const spells = document.createElement("div");
    spells.className = "hs-spells";
    for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
      const id = book.slots[i] ?? null;
      const el = document.createElement("div");
      el.className = `hs-socket${pickedSpell ? " target" : ""}`;
      if (id) el.append(spellIcon(id));
      else {
        const empty = document.createElement("span");
        empty.className = "hs-empty";
        empty.textContent = `Spell ${i + 1}`;
        el.append(empty);
      }
      el.addEventListener("click", () => {
        hideItemTip();
        if (pickedSpell) {
          sendMessage({ type: "setSpellSlot", slot: i, spellId: pickedSpell, ...heroArg });
          pickedSpell = null;
        } else if (id) sendMessage({ type: "setSpellSlot", slot: i, spellId: null, ...heroArg });
      });
      el.addEventListener("mousemove", (e) => (id ? showSpellTip(e, id, prof.stats.spellPowerMult, pickedSpell ? `Click to put ${SPELLS[pickedSpell].name} here` : "Click to empty the slot") : pickedSpell ? showSpellTip(e, pickedSpell, prof.stats.spellPowerMult, `Click to put it in slot ${i + 1}`) : hideItemTip()));
      el.addEventListener("mouseleave", hideItemTip);
      spells.append(el);
    }
    hsDoll.append(spells);

    // Level / XP.
    document.getElementById("hs-level")!.textContent = String(prof.level);
    const span = prof.nextLevelXp === null ? 1 : prof.nextLevelXp - prof.levelXp;
    const into = prof.nextLevelXp === null ? 1 : prof.xp - prof.levelXp;
    (document.getElementById("hs-xpfill") as HTMLElement).style.width = `${Math.round(Math.min(1, into / span) * 100)}%`;
    document.getElementById("hs-xptext")!.textContent =
      prof.nextLevelXp === null ? `${prof.xp} XP · max level` : `${prof.xp} / ${prof.nextLevelXp} XP · +4% damage and +6${hero ? "%" : ""} HP per level`;

    // Stat summary (multipliers include gear and level).
    const s = prof.stats;
    const mult = (v: number, lowerIsBetter = false) => {
      const el = document.createElement("span");
      el.textContent = `x${v.toFixed(2)}`;
      if (Math.abs(v - 1) > 1e-6) el.className = (lowerIsBetter ? v < 1 : v > 1) ? "up" : "down";
      return el;
    };
    const rows: [string, HTMLElement | string][] = [
      ["Health", hpText],
      ["Damage", mult(s.damageMult)],
      ["Damage taken", mult(s.damageTakenMult, true)],
      ["Move speed", mult(s.moveSpeedMult)],
      ["Attack speed", mult(s.attackSpeedMult)],
      ["Spell power", mult(s.spellPowerMult)],
    ];
    hsStats.replaceChildren();
    for (const [label, value] of rows) {
      const l = document.createElement("span");
      l.textContent = label;
      const v = typeof value === "string" ? document.createElement("span") : value;
      if (typeof value === "string") {
        v.id = "hs-hp";
        v.textContent = value;
      }
      hsStats.append(l, v);
    }

    // Hero phase 4: the spell book (learned spells; click one, then a slot) and a hero's Auto toggle.
    hsSpellbook.replaceChildren();
    if (book.learned.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hs-inv-empty";
      empty.textContent = "No spells yet: one every 2 levels, Spell Tomes from bosses and camps, Heal / Ward at a Church.";
      hsSpellbook.append(empty);
    }
    for (const id of book.learned) {
      const el = document.createElement("div");
      el.className = `hs-socket${pickedSpell === id ? " picked" : ""}`;
      el.append(spellIcon(id));
      el.addEventListener("click", () => {
        hideItemTip();
        pickedSpell = pickedSpell === id ? null : id;
        renderHeroSheet(true);
      });
      el.addEventListener("mousemove", (e) => showSpellTip(e, id, prof.stats.spellPowerMult, pickedSpell === id ? "Now click a spell slot (click again to cancel)" : "Click, then click a spell slot"));
      el.addEventListener("mouseleave", hideItemTip);
      hsSpellbook.append(el);
    }
    hsSpellAuto.hidden = !hero;
    if (hero) {
      hsSpellAuto.textContent = `Auto-cast: ${book.auto ? "On" : "Off"}`;
      hsSpellAuto.classList.toggle("on", book.auto);
      hsSpellAuto.onclick = () => sendMessage({ type: "setSpellAuto", heroId: hero.id, auto: !book.auto });
    }

    // Pack.
    document.getElementById("hs-invcount")!.textContent = `(${prof.inventory.length}/${prof.inventoryCap})`;
    hsInv.replaceChildren();
    if (prof.inventory.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hs-inv-empty";
      empty.textContent = "Empty. Relics drop from bosses, mini-bosses and camps; plain gear comes from the armoury.";
      hsInv.append(empty);
    }
    for (const item of prof.inventory) {
      // Hero phase 4: a Spell Tome is read ("Learn") by whoever's tab is open, and consumed.
      if (item.slot === "tome" && item.spellId) {
        const spellId = item.spellId;
        const known = book.learned.includes(spellId);
        hsInv.append(
          makeSocket(null, item, {
            onClick: known ? undefined : () => sendMessage({ type: "useTome", itemId: item.id, ...heroArg }),
            tip: (e) => showSpellTip(e, spellId, prof.stats.spellPowerMult, known ? `${item.name}: already known${hero ? ` by ${hero.name}` : ""}` : `${item.name}: click to Learn${hero ? ` (${hero.name})` : ""}`),
          })
        );
        continue;
      }
      const target = gearSlotFor(item, prof);
      const current = target ? prof.equipment[target] : null;
      hsInv.append(
        makeSocket(null, item, {
          onClick: target ? () => sendMessage({ type: "equipItem", itemId: item.id, slot: target, ...heroArg }) : undefined,
          tip: (e) => showItemTip(e, item, current, target ? `Click to equip (${SLOT_LABEL[target]})` : "Coming soon", !!target),
        })
      );
    }

    // Take from the armoury: one plain piece of a tier out of the colony stock (armour -> chest, weapon -> weapon).
    hsArmoury.replaceChildren();
    const full = prof.inventory.length >= prof.inventoryCap;
    for (const slot of ["armour", "weapon"] as EquipSlot[]) {
      for (let tier = 1; tier <= 3; tier++) {
        const n = heroStock?.[slot][tier - 1] ?? 0;
        const btn = document.createElement("button");
        btn.textContent = `${slot === "armour" ? "Chest armour" : "Weapon"} T${tier} (${n})`;
        btn.disabled = n <= 0 || full;
        btn.title = full ? "Your pack is full" : n <= 0 ? "None in the colony's stock (forge at a Blacksmith)" : "Takes it from the stock soldiers muster with";
        btn.addEventListener("click", () => sendMessage({ type: "takeFromArmoury", slot, tier, ...heroArg }));
        hsArmoury.append(btn);
      }
    }
  }

  function setHeroSheetOpen(open: boolean) {
    // Hero phase 3: opening with exactly one hero selected shows that hero's tab.
    if (open && selectedIds.size === 1) {
      const id = [...selectedIds][0];
      if (heroSheets.some((h) => h.id === id)) sheetTab = id;
    }
    heroModal.hidden = !open;
    hideItemTip();
    if (open) renderHeroSheet(true);
  }
  document.getElementById("hero-btn")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    setHeroSheetOpen(heroModal.hidden);
  });
  document.getElementById("hs-close")!.addEventListener("click", () => setHeroSheetOpen(false));
  heroModal.addEventListener("click", (e) => {
    if (e.target === heroModal) setHeroSheetOpen(false);
  });
  // ` (Backquote; C is the Church tool) toggles the sheet, Escape closes it.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      e.preventDefault();
      setHeroSheetOpen(heroModal.hidden);
    } else if (e.key === "Escape" && !heroModal.hidden) {
      setHeroSheetOpen(false);
    }
  });

  function syncHeroProfile(
    profile: HeroProfileSnapshot | undefined, stock: EquipmentStock | undefined, me: PlayerSnapshot | undefined, heroes?: HeroSheetSnapshot[]
  ) {
    if (profile) heroProfile = profile;
    // Hero phase 4: cooldown ticks are as of this snapshot; the spell bar counts down from here.
    if (profile?.spells) spellCdAt = performance.now();
    if (heroes) heroSheets = heroes;
    heroMe = me;
    heroStock = stock;
    renderHeroSheet();
    renderSpellBar();
  }

  // ---- Hero phase 4: the player's spell bar (bottom centre, above the command bar) ----
  // Hotkeys Shift+1..4 or F1..F4 (every letter, every bare digit and Ctrl / Alt + digit are taken). A
  // targeted spell then waits for a left click: enemy = a monster, ally = a friendly unit / player (empty
  // ground = yourself), ground = the spot; right click or Escape cancels; the same key again casts an
  // ally spell on yourself. Cooldowns are drawn as a dark overlay with the seconds left.
  const spellBarEl = document.getElementById("spell-bar")!;
  let spellCdAt = performance.now();
  let spellAim: { slot: number; spell: SpellId } | null = null;
  const spellBtns: HTMLButtonElement[] = [];
  const SPELL_KEY_LABEL = ["⇧1", "⇧2", "⇧3", "⇧4"];
  for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
    const b = document.createElement("button");
    b.className = "spell-btn";
    b.addEventListener("click", () => {
      b.blur();
      useSpellSlot(i);
    });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    spellBarEl.append(b);
    spellBtns.push(b);
  }
  const spellRangeRing = new Graphics();
  let spellBarKey = "";
  function spellCooldownMs(id: SpellId): number {
    const ticks = heroProfile?.spells?.cooldowns[id] ?? 0;
    return Math.max(0, (ticks / TICK_RATE) * 1000 - (performance.now() - spellCdAt));
  }
  function renderSpellBar() {
    const book = heroProfile?.spells;
    spellBarEl.hidden = !book || book.learned.length === 0;
    if (!book) return;
    const key = JSON.stringify([book.slots, spellAim, heroProfile?.stats.spellPowerMult]);
    if (key !== spellBarKey) {
      spellBarKey = key;
      book.slots.forEach((id, i) => {
        const b = spellBtns[i];
        b.replaceChildren();
        b.classList.toggle("aiming", spellAim?.slot === i);
        b.disabled = !id;
        if (id) b.append(spellIcon(id));
        const k = document.createElement("kbd");
        k.textContent = SPELL_KEY_LABEL[i];
        const cd = document.createElement("div");
        cd.className = "spell-cd";
        b.append(k, cd);
        b.onmousemove = id ? (e) => showSpellTip(e, id, heroProfile?.stats.spellPowerMult ?? 1, `Shift+${i + 1} or F${i + 1}`) : null;
        b.onmouseleave = hideItemTip;
      });
    }
    book.slots.forEach((id, i) => {
      const cd = spellBtns[i].querySelector<HTMLElement>(".spell-cd");
      if (!cd) return;
      const left = id ? spellCooldownMs(id) : 0;
      cd.style.height = id && left > 0 ? `${Math.min(100, (left / (SPELLS[id].cooldown * 1000)) * 100)}%` : "0";
      cd.textContent = left > 0 ? String(Math.ceil(left / 1000)) : "";
    });
  }
  window.setInterval(renderSpellBar, 100);
  function setSpellAim(aim: typeof spellAim) {
    spellAim = aim;
    app.canvas.style.cursor = aim ? "crosshair" : "";
    spellRangeRing.clear();
    renderSpellBar();
  }
  function castSlot(slot: number, target: { targetId?: string; x?: number; y?: number }) {
    sendMessage({ type: "castSpell", slot, ...target });
    setSpellAim(null);
  }
  function useSpellSlot(slot: number) {
    const id = heroProfile?.spells?.slots[slot];
    if (!id) return;
    const def = SPELLS[id];
    if (spellCooldownMs(id) > 0) {
      pushEventToast("build", `${def.name}: ${Math.ceil(spellCooldownMs(id) / 1000)} s cooldown`);
      return;
    }
    // Pressing an ally spell's key again while aiming casts it on yourself.
    if (def.targeting === "self" || (def.targeting === "ally" && spellAim?.slot === slot)) return castSlot(slot, {});
    setSpellAim(spellAim?.slot === slot ? null : { slot, spell: id });
  }
  // A left click while aiming: true when it was used for the spell.
  function spellAimClick(x: number, y: number): boolean {
    if (!spellAim) return false;
    const def = SPELLS[spellAim.spell];
    if (def.targeting === "enemy") {
      const mob = findNearest(latestMobs.filter((m) => (m.x - x) ** 2 + (m.y - y) ** 2 <= (mobHitRadius(m.kind, mobRenderScale(m)) + 6) ** 2), x, y, Infinity);
      if (!mob) {
        pushEventToast("build", `${def.name}: click on an enemy (right click cancels)`);
        return true;
      }
      castSlot(spellAim.slot, { targetId: mob.id });
    } else if (def.targeting === "ally") {
      const friends = [...latestColonists, ...(latestPlayersForSpells.filter((p) => !p.dead) as { id: string; x: number; y: number }[])];
      const ally = findNearest(friends, x, y, UNIT_HIT_RADIUS + 4);
      castSlot(spellAim.slot, ally && ally.id !== myId ? { targetId: ally.id } : {});
    } else {
      castSlot(spellAim.slot, { x, y });
    }
    return true;
  }
  let latestPlayersForSpells: PlayerSnapshot[] = [];
  app.ticker.add(() => {
    if (!spellAim || !myId) return;
    const me = latestPlayersForSpells.find((p) => p.id === myId);
    spellRangeRing.clear();
    if (!me) return;
    spellRangeRing.circle(me.x, me.y, SPELLS[spellAim.spell].range * TILE_SIZE).stroke({ width: 2, color: 0xf2c94c, alpha: 0.6 });
    if (spellRangeRing.parent !== worldLayer) worldLayer.addChild(spellRangeRing);
  });
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const digit = /^Digit([1-4])$/.exec(e.code);
    const fkey = /^F([1-4])$/.exec(e.code);
    if (digit && e.shiftKey) {
      e.preventDefault();
      useSpellSlot(Number(digit[1]) - 1);
    } else if (fkey) {
      e.preventDefault();
      useSpellSlot(Number(fkey[1]) - 1);
    } else if (e.key === "Escape" && spellAim) {
      setSpellAim(null);
    }
  });

  // ---- Settlement population (ROADMAP "Settlement population caps"): one Colony panel row per Town
  // Center ("Settlement 1: 9/12"), amber when full, red when over its cap; a toast (throttled per
  // settlement) when one reaches its cap. Rows are rebuilt only when the text changes.
  const statSettlementsEl = document.getElementById("stat-settlements")!;
  const SETTLEMENT_FULL_TOAST_THROTTLE_MS = 60000;
  const settlementWasFull = new Map<number, boolean>();
  const settlementToastAt = new Map<number, number>();
  let settlementPanelKey = "";
  function refreshSettlementPanel(tcs: TownCenterSnapshot[]) {
    // Grey the Keep tool until some Town Center is at level 2 (it stays selectable, the cost text says why).
    const keepBtn = toolButtonEls.get(TileType.Keep);
    if (keepBtn) {
      const keepReady = tcs.some((tc) => tc.level >= 2);
      keepBtn.style.opacity = keepReady ? "" : "0.5";
      keepBtn.title = keepReady ? "" : "Keep needs a Town Center at level 2";
    }
    const rows = tcs.map((tc, i) => ({
      n: i + 1,
      used: tc.population ?? 0,
      cap: tc.populationCap ?? 0,
      known: tc.populationCap !== undefined,
      // Barracks housing: soldiers live in their unit buildings, shown apart from the civilian count.
      troops: tc.troops,
      troopCap: tc.troopCap ?? 0,
    }));
    const key = rows.map((r) => `${r.n}:${r.used}/${r.cap}:${r.troops}/${r.troopCap}`).join("|");
    if (key !== settlementPanelKey) {
      settlementPanelKey = key;
      statSettlementsEl.replaceChildren();
      for (const r of rows) {
        if (!r.known) continue;
        const row = document.createElement("div");
        row.className = "econ-row";
        const label = document.createElement("span");
        label.textContent = `Settlement ${r.n}`;
        const count = document.createElement("span");
        count.textContent = `${r.used}/${r.cap}`;
        if (r.used > r.cap) count.className = "pop-over";
        else if (r.used === r.cap) count.className = "pop-full";
        row.append(label, count);
        statSettlementsEl.append(row);
        if (r.troops !== undefined && r.troopCap > 0) {
          const troopRow = document.createElement("div");
          troopRow.className = "econ-row";
          const troopLabel = document.createElement("span");
          troopLabel.textContent = `Settlement ${r.n} troops`;
          troopLabel.title = "Soldiers live in their unit buildings (each houses its tier headcount + 1 per adjacent house), not in settlement population";
          const troopCount = document.createElement("span");
          troopCount.textContent = `${r.troops}/${r.troopCap}`;
          troopRow.append(troopLabel, troopCount);
          statSettlementsEl.append(troopRow);
        }
      }
    }
    const now = performance.now();
    for (const r of rows) {
      const full = r.known && r.cap > 0 && r.used >= r.cap;
      if (full && !settlementWasFull.get(r.n) && now - (settlementToastAt.get(r.n) ?? -Infinity) >= SETTLEMENT_FULL_TOAST_THROTTLE_MS) {
        settlementToastAt.set(r.n, now);
        pushEventToast("build", `Settlement ${r.n} is at its population cap — upgrade its Town Center or build a Keep`);
      }
      settlementWasFull.set(r.n, full);
    }
  }

  // Newest on top. Past MAX_TOASTS the oldest still-live toast is dropped with a quick fade, so a
  // burst (a whole garrison dying at once) shows its latest few rather than flooding the screen.
  function pushEventToast(category: GameEventCategory, text: string) {
    const toast = document.createElement("div");
    toast.className = `event-toast event-${category}`;
    const icon = document.createElement("img");
    icon.className = "event-icon";
    // "raid" has no art of its own; it borrows the deserter icon (build/milestone the upgrade one, boss the death one).
    const iconName: Partial<Record<GameEventCategory, string>> = { raid: "deserter", build: "upgrade", milestone: "upgrade", boss: "death", morale: "deserter" };
    icon.src = `/sprites/icon-event-${iconName[category] ?? category}.png`;
    icon.alt = "";
    toast.append(icon, text);
    eventFeedEl.prepend(toast);
    const live = Array.from(eventFeedEl.children).filter(
      (el) => !el.classList.contains("dropped") && !el.classList.contains("fading")
    ) as HTMLElement[];
    for (const old of live.slice(MAX_TOASTS)) removeToast(old, "dropped", TOAST_DROP_MS);
    window.setTimeout(() => removeToast(toast, "fading", TOAST_FADE_MS), TOAST_SHOW_MS);
  }

  // ---- Goal tracker (top-right parchment card) and the Ogre Warlord's boss bar ----
  const goalTrackerEl = document.getElementById("goal-tracker")!;
  const goalStepEl = document.getElementById("goal-step")!;
  const goalTitleEl = document.getElementById("goal-title")!;
  const goalFillEl = document.getElementById("goal-progress-fill")!;
  const goalCountEl = document.getElementById("goal-progress-text")!;
  const GOAL_FLASH_MS = 1600;
  // -1 until the first snapshot after a welcome, so a load / restart never flashes.
  let lastGoalIndex = -1;
  let latestGoal: GoalSnapshot | null = null;
  let goalFlashTimer = 0;

  function syncGoal(goal: GoalSnapshot | undefined) {
    latestGoal = goal ?? null;
    if (!goal) {
      goalTrackerEl.hidden = true;
      return;
    }
    goalTrackerEl.hidden = false;
    const done = goal.index >= goal.total;
    goalStepEl.textContent = done ? "Complete" : `${goal.index + 1} / ${goal.total}`;
    goalTitleEl.textContent = goal.title;
    goalFillEl.style.width = `${Math.round((Math.min(goal.progress, goal.target) / goal.target) * 100)}%`;
    goalCountEl.textContent = goal.target > 1 ? `${goal.progress} / ${goal.target}` : done ? "Victory" : "";
    goalTrackerEl.classList.toggle("goal-done", done);
    if (lastGoalIndex !== -1 && goal.index > lastGoalIndex) {
      goalTrackerEl.classList.remove("goal-flash");
      void goalTrackerEl.offsetWidth; // restart the animation
      goalTrackerEl.classList.add("goal-flash");
      window.clearTimeout(goalFlashTimer);
      goalFlashTimer = window.setTimeout(() => goalTrackerEl.classList.remove("goal-flash"), GOAL_FLASH_MS);
    }
    lastGoalIndex = goal.index;
  }

  const bossBarEl = document.getElementById("boss-bar")!;
  const bossBarNameEl = document.getElementById("boss-bar-name")!;
  const bossBarFillEl = document.getElementById("boss-bar-fill")!;
  // Shown while the Ogre Warlord is within this many tiles of the local player.
  const BOSS_BAR_RANGE_TILES = VISION_RADIUS_PLAYER * 1.5;

  // The player's own health bar at the top of the screen (unit bars over sprites are hidden).
  const playerBarEl = document.getElementById("player-bar")!;
  const playerBarLabelEl = document.getElementById("player-bar-label")!;
  const playerBarFillEl = document.getElementById("player-bar-fill")!;
  function syncPlayerBar(players: PlayerSnapshot[]) {
    const me = players.find((p) => p.id === myId);
    playerBarEl.hidden = !me || me.dead || me.maxHp <= 0;
    if (!me || me.dead || me.maxHp <= 0) return;
    const frac = Math.max(0, Math.min(1, me.hp / me.maxHp));
    playerBarLabelEl.textContent = `Health ${Math.ceil(me.hp)} / ${Math.ceil(me.maxHp)}`;
    playerBarFillEl.style.width = `${(frac * 100).toFixed(1)}%`;
    playerBarFillEl.className = frac <= 0.25 ? "crit" : frac <= 0.5 ? "low" : "";
  }

  function syncBossBar(mobs: MobSnapshot[], players: PlayerSnapshot[]) {
    const me = players.find((p) => p.id === myId);
    const warlord = mobs.find((m) => m.boss === "warlord");
    const near =
      !!me && !!warlord && Math.hypot(warlord.x - me.x, warlord.y - me.y) <= BOSS_BAR_RANGE_TILES * tileSize;
    bossBarEl.hidden = !near;
    if (!near || !warlord) return;
    bossBarNameEl.textContent = bossTitle(warlord.kind, "warlord");
    bossBarFillEl.style.width = `${Math.max(0, Math.min(100, (warlord.hp / warlord.maxHp) * 100)).toFixed(1)}%`;
  }

  let wasNight = false;
  socket.addEventListener("message", (event) => {
    const message: ServerMessage = JSON.parse(event.data);
    if (message.type === "welcome") {
      myId = message.id;
      if (pendingLoadSlot) {
        // Continue / Load Game: the save brings its own difficulty (no claim), then a fresh welcome.
        sendMessage({ type: "loadGame", slot: pendingLoadSlot });
        pendingLoadSlot = null;
      } else if (enforceGameMode && preferredSolo) {
        // Solo hero phase 4: a Solo New Game always starts a fresh Solo world (a restart for everyone).
        sendMessage({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize, solo: true });
      } else if (enforceGameMode && !!message.creative !== preferredCreative) {
        // Creative mode: New Game / Creative from the menu start a world of that mode (a restart for everyone).
        sendMessage({ type: "restart", difficulty: preferredDifficulty, worldSize: preferredWorldSize, creative: preferredCreative });
      } else {
        // Claims the world's difficulty if nobody has yet (the server ignores it otherwise).
        sendMessage({ type: "setDifficulty", difficulty: preferredDifficulty, worldSize: preferredWorldSize });
      }
      enforceGameMode = false;
      creativeUi.onWelcome(message.creative === true);
      sendMessage({ type: "listSaves" });
      setActiveDifficulty(message.difficulty);
      tileSize = message.tileSize;
      worldTilesX = message.worldTilesX;
      worldTilesY = message.worldTilesY;
      const ck = message.chunked;
      chunkRequestedAt.clear();
      if (ck) {
        const f = ck.minimapFactor;
        const cw = Math.ceil(worldTilesX / f);
        const ch = Math.ceil(worldTilesY / f);
        streamed = {
          chunkTiles: ck.chunkTiles, chunksX: Math.ceil(worldTilesX / ck.chunkTiles), chunksY: Math.ceil(worldTilesY / ck.chunkTiles),
          f, cw, ch, cells: decodeByteRuns(ck.minimap, cw * ch), cellSeen: new Uint8Array(cw * ch),
        };
        chunkLoaded = new Uint8Array(streamed.chunksX * streamed.chunksY);
        tiles = new Array(worldTilesX * worldTilesY).fill(TileType.Empty);
        biomes = new Array(worldTilesX * worldTilesY).fill(Biome.Plains);
      } else {
        streamed = null;
        chunkLoaded = new Uint8Array(0);
        tiles = message.tiles;
        biomes = message.biomes;
      }
      castleRuinTile = message.castleRuin ?? null;
      lastGoalIndex = -1;
      clearFightArrows();
      resetMinimap(ck ? ck.exploredRuns : message.explored);
      suppressDeathPoofs = true;
      resetSoundState();
      bloodOnNewGravestones = false;
      clearBlood();
      farmStages = new Map();
      buildingLevels = new Map();
      forgeBusy = new Set();
      constructionSites = new Map();
      clearFires();
      siteOverlay.clear();
      clearWildlifeSprites();
      redrawGrid();
      latestTownCenters = [];
      latestHearths = new Set();
      syncTownCenterBars([]);
      worldLayer.addChild(siteOverlay);
      worldLayer.addChild(placementGhost);
      worldLayer.addChild(cursorHighlight);
      worldLayer.addChild(formationMarker);
      worldLayer.addChild(lineGuide);
      worldLayer.addChild(wagonRoutes);
      worldLayer.addChild(selectionRings);
      worldLayer.addChild(roleRings);
      worldLayer.addChild(dragBox);
      strategyOnWelcome();
    } else if (message.type === "snapshot") {
      creativeUi.onSnapshot(message);
      applyProgression(message.progression);
      interpBeforeSnapshot();
      syncPlayers(message.players);
      latestPlayersForSpells = message.players;
      if (message.life) heroLifeRef.ui?.onLife(message.life);
      syncColonists(message.colonists, message.isNight);
      syncMobs(message.mobs);
      interpAfterSnapshot();
      suppressDeathPoofs = false;
      syncBuildingLevels(message.buildingLevels);
      syncForgeBusy(message.forgeBusy);
      syncFarmStages(message.farmStages);
      syncConstructionSites(message.constructionSites);
      syncDamagedBuildings(message.damagedBuildings);
      syncGates(message.gates);
      if (message.sites) syncFortMarkers(message.sites);
      if (message.relations) siteRelations = new Map(message.relations.map((r) => [r.num, r]));
      if (message.respawn) questCycleTicks = message.respawn.dayTicks + message.respawn.nightTicks;
      if (message.quests) {
        latestQuests = message.quests;
        const ids = new Set(latestQuests.map((q) => q.id));
        questSeen = new Set([...questSeen].filter((id) => ids.has(id)));
        renderQuests();
      }
      syncSiteTiles(message.siteTiles);
      if (message.clans) {
        clanColors = new Map(message.clans.map((c) => [c.id, c.color]));
        clanNames = new Map(message.clans.map((c) => [c.id, c.name]));
      }
      const clanNow = message.clanId ?? 0;
      if (clanNow !== myClan) {
        myClan = clanNow;
        pushEventToast("milestone", `You play for ${clanNames.get(myClan) ?? `clan ${myClan}`}`);
        for (const index of clanTiles.keys()) {
          const { tx, ty } = indexToTile(index);
          setTileSprite(tx, ty, tiles[index]);
        }
      }
      // Back to one clan (a restart / load): nothing is foreign any more.
      syncClanTiles(message.clanId === undefined && clanTiles.size > 0 ? [] : message.clanTiles);
      latestTownCenters = message.townCenters;
      latestHearths = new Set();
      const hearthFlat = message.hearths ?? [];
      for (let i = 0; i + HEARTH_SNAPSHOT_STRIDE <= hearthFlat.length; i += HEARTH_SNAPSHOT_STRIDE) if (hearthFlat[i + 1] >= 0) latestHearths.add(hearthFlat[i]);
      syncCaptives(hearthFlat);
      syncTownCenterBars(message.townCenters);
      syncWildlife(message.wildlife);
      // Dawn wipes the blood, the same boundary at which the server clears the gravestones.
      if (wasNight && !message.isNight) clearBlood();
      wasNight = message.isNight;
      syncGravestones(message.gravestones);
      latestColonists = message.colonists;
      latestMobs = message.mobs;
      drawRoleRings();
      drawWagonRoutes(message.colonists);
      latestTaskForces = message.taskForces;
      const counts = { knight: 0, archer: 0, militia: 0, bishop: 0, cavalry: 0, siege: 0, hero: 0 };
      const alive = new Set<string>();
      for (const c of message.colonists) {
        if (!isCommandable(c)) continue;
        if (c.kind === "knight" || c.kind === "archer" || c.kind === "bishop" || c.kind === "cavalry") {
          counts[c.kind]++;
        } else if (c.kind === "militia" || c.kind === "spearman" || c.kind === "pikeman") {
          counts.militia++;
        } else if (c.kind === "batteringRam" || c.kind === "catapult") {
          counts.siege++;
        } else if (c.kind === "hero") {
          counts.hero++;
        }
        alive.add(c.id);
      }
      refreshWorkerCounts(myClan === 0 && clanTiles.size === 0 ? message.colonists : message.colonists.filter((c) => (c.clan ?? 0) === myClan), message.isNight);
      statArmyEl.textContent =
        `Knights ${counts.knight}  Cavalry ${counts.cavalry}  Archers ${counts.archer}  Militia ${counts.militia}` +
        `${counts.siege > 0 ? `  Siege ${counts.siege}` : ""}${counts.hero > 0 ? `  Heroes ${counts.hero}` : ""}  Bishops ${counts.bishop}`;
      // Drop dead units from the selection so the count and commands stay accurate.
      const stillSelected = Array.from(selectedIds).filter((id) => alive.has(id));
      if (stillSelected.length !== selectedIds.size) {
        setSelection(stillSelected);
      } else {
        redrawSelectionRings();
        // Stance changes arrive by snapshot, not through setSelection.
        refreshSelectionHud();
      }
      refreshEconomyPanel(message);
      refreshEquipmentLine(message.equipment);
      syncHeroProfile(message.profile, message.equipment, message.players.find((p) => p.id === myId), message.heroes);
      statPopEl.textContent = `${message.population}/${message.populationCap}`;
      refreshSettlementPanel(message.townCenters);
      setActiveDifficulty(message.difficulty);
      statTimeEl.textContent = message.isNight ? "Night" : "Day";
      sundialEl.classList.toggle("night", message.isNight);
      sundialHandEl.setAttribute("transform", `rotate(${message.cycleProgress * 360})`);
      if (message.dayFraction !== sundialDayFraction) {
        sundialDayFraction = message.dayFraction;
        // Pie slice over the night part of the cycle; 0 (dawn) is at 12 o'clock, clockwise.
        const a = sundialDayFraction * 2 * Math.PI;
        const r = 15;
        const largeArc = 1 - sundialDayFraction > 0.5 ? 1 : 0;
        sundialNightArcEl.setAttribute(
          "d",
          `M0 0 L${r * Math.sin(a)} ${-r * Math.cos(a)} A${r} ${r} 0 ${largeArc} 1 0 ${-r} Z`
        );
      }
      statHappinessEl.textContent = `Happiness: ${message.happiness}%`;
      // Thresholds mirror the server's desertion (35) and mutiny (15) lines. Colors are the
      // parchment-contrast tokens in index.html's :root.
      statHappinessEl.style.color =
        message.happiness < 15 ? "var(--mood-bad)" : message.happiness < 35 ? "var(--mood-warn)" : "var(--mood-good)";
      pausedBanner.visible = message.isPaused;
      pauseBtn.textContent = message.isPaused ? "Resume" : "Pause";
      nightOverlay.alpha = message.isNight ? 0.35 : 0;
      refreshGameOver(message.players.find((p) => p.id === myId));
      refreshBuilderCount(message.colonists, message.isNight);
      for (const effect of message.effects) spawnEffect(effect);
      syncFights(message.fights);
      drawMinimap(message.players, message.colonists, message.mobs);
      strategyOnSnapshot(message.players, message.armyRegiments, message.orderGroups, message.enemyRegiments);
      syncTimeControls(message.isPaused, message.pausedBy, message.timeScale ?? 1, message.timeScaleBy, message.players);
      syncGoal(message.goal);
      // Long days: dawn/dusk respawn windows (cycle lengths come from the server, never hard-coded).
      if (message.people) {
        // Village life: nobody respawns; open posts wait for free villagers (soldier posts for training).
        const p = message.people;
        statRespawnEl.textContent = `Villagers: ${p.free} free · ${p.children} children · ${p.training} training · ${p.vacancies} posts open`;
      } else if (message.respawn) {
        const r = message.respawn;
        const secs = Math.ceil(r.ticksToWindow / TICK_RATE);
        const eta = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
        statRespawnEl.textContent =
          r.waiting > 0
            ? `Reinforcements: ${r.waiting} waiting · ${r.nextWindow} in ${eta}`
            : `Next respawn window: ${r.nextWindow} in ${eta}`;
      }
      syncBossBar(message.mobs, message.players);
      syncPlayerBar(message.players);
      soundOnSnapshot(message);
    } else if (message.type === "tileUpdate") {
      soundOnTileUpdate(message.tileX, message.tileY, message.tile);
      setTileLocal(message.tileX, message.tileY, message.tile);
      paintMinimapTile(message.tileY * worldTilesX + message.tileX);
    } else if (message.type === "event") {
      pushEventToast(message.category, message.text);
      if (message.category === "upgrade") fxOnUpgradeEvent();
      soundOnEvent(message.category, message.text);
    } else if (message.type === "explored") {
      markExplored(message.tiles);
    } else if (message.type === "chunks") {
      applyStreamChunks(message.chunks);
    } else if (message.type === "chronicle") {
      onChronicle(message);
    } else if (message.type === "dialogue" || message.type === "interactNone") {
      heroLifeRef.ui?.onMessage(message);
    } else if (message.type === "buildingInfo") {
      if (!infoTile || infoTile.tx !== message.tileX || infoTile.ty !== message.tileY) return;
      if (message.info) renderBuildingInfo(message.info);
      else closeBuildingInfo();
    } else if (message.type === "creativeResult") {
      creativeUi.onResult(message);
    } else if (message.type === "saveList") {
      renderSavePanel(message.saves);
    } else if (message.type === "saveResult") {
      const name = SAVE_SLOT_NAMES[message.slot];
      if (message.ok && message.action === "save") pushEventToast("build", `Game saved to ${name}`);
      else if (!message.ok) pushEventToast("death", message.error ?? `Could not ${message.action} ${name}`);
    }
  });

  // Quick-save button: saves to the slot you last saved to (Slot 1 the first time), no dialog.
  function getLastSaveSlot(): SaveSlot {
    try {
      const v = localStorage.getItem("sworn.lastSaveSlot");
      if (v === "slot1" || v === "slot2" || v === "slot3") return v;
    } catch {
      /* ignore */
    }
    return "slot1";
  }
  function setLastSaveSlot(slot: SaveSlot) {
    try {
      localStorage.setItem("sworn.lastSaveSlot", slot);
    } catch {
      /* ignore */
    }
  }
  document.getElementById("save-btn")!.addEventListener("click", () => {
    sendMessage({ type: "saveGame", slot: getLastSaveSlot() });
  });

  // In-game Save Game section (top of the Settings modal): 3 manual slots, plus Load for every save.
  let latestSaves: SaveInfo[] = [];
  function renderSavePanel(saves: SaveInfo[]) {
    latestSaves = saves;
    const bySlot = new Map(saves.map((sv) => [sv.slot, sv]));
    renderSaveRows(
      document.getElementById("save-slot-list")!,
      // Creative mode: a creative game saves only to its own slot.
      ((creativeUi.on ? ["creative"] : ["slot1", "slot2", "slot3"]) as SaveSlot[]).map((slot) => ({
        slot,
        info: bySlot.get(slot),
        buttons: [
          {
            label: "Save",
            onClick: () => {
              const existing = latestSaves.find((sv) => sv.slot === slot);
              if (existing && !window.confirm(`Overwrite ${SAVE_SLOT_NAMES[slot]} (${describeSave(existing)})?`)) return;
              setLastSaveSlot(slot);
              sendMessage({ type: "saveGame", slot });
            },
          },
        ],
      }))
    );
    renderSaveRows(
      document.getElementById("save-load-list")!,
      saves.map((sv) => ({
        slot: sv.slot,
        info: sv,
        buttons: [
          {
            label: "Load",
            secondary: true,
            onClick: () => {
              if (!window.confirm(`Load ${SAVE_SLOT_NAMES[sv.slot]} for everyone connected? Unsaved progress is lost.`)) return;
              sendMessage({ type: "loadGame", slot: sv.slot });
              document.getElementById("settings-modal")!.hidden = true;
            },
          },
        ],
      })),
      "No saves yet"
    );
  }
  // Refresh the list whenever the Settings modal opens (another player may have saved meanwhile).
  document.getElementById("settings-btn")!.addEventListener("click", () => sendMessage({ type: "listSaves" }));

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    keys.add(key);
    // Ctrl/Alt + digit is reserved for task forces; never let it change the build tool. Nor does a plain
    // digit that recalls a control group in strategy mode.
    if (e.ctrlKey || e.altKey || isStrategyGroupRecall(e) || strategyOrderKey(e) || strategySettingKey(e) || adventurePartyKey(e)) return;
    // Shift+C opens the Crafting panel (not the C build tool).
    if (e.shiftKey && e.code === "KeyC") return;
    const match = key ? TOOLS.find((t) => t.key === key) : undefined;
    if (match) {
      if (match.tile !== TileType.Empty && match.category !== activeCategory) {
        activeCategory = match.category;
        refreshToolbarVisibility();
        refreshCategoryTabSelection();
      }
      selectTool(match.tile, true);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSelection([]);
      cancelLeftPress();
      cancelOrderPress();
      closeBuildingInfo();
      return;
    }
    const stance = STANCE_HOTKEYS[e.key.toLowerCase()];
    if (stance && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      if (selectedIds.size > 0) sendMessage({ type: "commandStance", unitIds: Array.from(selectedIds), stance });
      return;
    }
    // Strategy mode: plain 1-9 recalls an assigned group (double-tap centres on it).
    const recall = isStrategyGroupRecall(e);
    if (recall) {
      e.preventDefault();
      if (!e.repeat) recallControlGroup(recall);
      return;
    }
    // e.code is layout/modifier independent (Alt+1 can produce other e.key values on some OSes).
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (!digit || !(e.ctrlKey || e.altKey)) return;
    e.preventDefault();
    if (e.repeat) return;
    const slot = Number(digit[1]);
    if (e.ctrlKey) {
      // A task force is also a manual regiment: assigning merges / splits the selection into it, and
      // Ctrl+N with nothing selected disbands it (its units go back to their auto regiments).
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({ type: "assignTaskForce", slot, unitIds: Array.from(selectedIds) })
        );
      }
    } else {
      recallControlGroup(slot);
    }
  });

  window.addEventListener("keydown", (e) => {
    // Shift+Space is the global pause (phase 5), not an attack.
    if (e.key === " " && !e.repeat && !e.shiftKey) {
      e.preventDefault();
      // The rider stands idle in strategy mode.
      if (strategyCam.inStrategy) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "attack" }));
        // Immediate feedback even when the swing hits nothing (no server effect then).
        if (myId) triggerPlayerAttackAnim(myId);
        sound.play("sword_swing");
      }
    }
  });

  function currentInput(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    return { dx, dy };
  }

  setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    // Strategy mode: WASD pans the camera, the rider stops.
    const { dx, dy } = strategyCam.inStrategy ? { dx: 0, dy: 0 } : currentInput();
    socket.send(JSON.stringify({ type: "input", dx, dy }));
  }, 50);

  // ---- Strategy mode phase 1 (docs PLAN-strategy-mode.md §1): Tab toggles a free bird's-eye camera
  // (strategy/camera.ts) with LOD bands, fog and stand-in banners (strategy/lod.ts). While it is on:
  // WASD / arrows / edge scroll / middle-drag pan, the wheel zooms about the cursor, a minimap click
  // jumps there, Home centres on the rider; building is off and the rider stands idle. The server gets
  // the view as `setView` so it sends the mobs inside it, not only those near the rider.
  const STRATEGY_HIT_SCREEN_PX = 6;
  // Phase 5: clicking a clash icon zooms here (the Field band).
  const STRATEGY_CLASH_ZOOM = 0.5;
  const STRATEGY_FOG_REFRESH_MS = 200;
  const SET_VIEW_INTERVAL_MS = 200;
  // World px the banner tip sits above its group's centroid (about half a unit's height).
  const BANNER_LIFT_PX = 18;
  // Strategy mode phase 2: the server's regiments (snapshot armyRegiments, kept until the next one) and
  // each unit's regiment. Tapping the same control-group digit twice within this window centres on it.
  const GROUP_DOUBLE_TAP_MS = 350;
  let armyRegiments: ArmyRegimentSnapshot[] = [];
  let regimentOfUnit = new Map<string, ArmyRegimentSnapshot>();
  let lastGroupTap = { slot: 0, at: -Infinity };
  const regimentCards = new RegimentCardBar(document.getElementById("regiment-cards")!, {
    select: (id, additive) => {
      const reg = armyRegiments.find((r) => r.id === id);
      if (!reg) return;
      if (!additive) {
        setSelection(reg.unitIds);
        return;
      }
      // Shift: toggle this regiment in / out of the selection.
      const next = new Set(selectedIds);
      const allIn = reg.unitIds.length > 0 && reg.unitIds.every((u) => next.has(u));
      for (const u of reg.unitIds) {
        if (allIn) next.delete(u);
        else next.add(u);
      }
      setSelection(next);
    },
    centre: (id) => {
      const reg = armyRegiments.find((r) => r.id === id);
      if (reg) centreOnUnits(reg.unitIds);
    },
  });
  const strategyBtn = document.getElementById("strategy-btn") as HTMLButtonElement;
  let panDrag: { pointerId: number; lastX: number; lastY: number } | null = null;
  let canvasPointer: { x: number; y: number } | null = null;
  let lastPanAt = 0;
  let fogUpdatedAt = -Infinity;
  let dotsDirty = true;
  let dotsZoom = 0;
  let strategyWasActive = false;
  let viewSent: { x: number; y: number; halfW: number; halfH: number } | null = null;
  let viewSentAt = -Infinity;

  function cancelPanDrag() {
    if (panDrag && app.canvas.hasPointerCapture(panDrag.pointerId)) app.canvas.releasePointerCapture(panDrag.pointerId);
    panDrag = null;
  }
  app.canvas.addEventListener("pointerleave", () => {
    canvasPointer = null;
  });

  // ---- Strategy mode phase 3: regiment orders (strategy/orders.ts draws them). Right-click = move as the
  // formation stands (its last width / facing kept), right-drag = a line (width = drag length, facing away
  // from the units or toward a nearby enemy, Alt flips), Ctrl+right-click or Shift+F then right-click =
  // attack-move, right-click an enemy = attack, Shift+G then right-click a friend = follow, Shift+H hold,
  // Shift+R retreat; Shift on any of these queues it. Shift+letter so every build hotkey stays as it is.
  // Phase 4: Shift+C then right-click an enemy = charge, Shift+B then right-click = bombard that point;
  // right-clicking a camp hearth = attackHearth. Settings: Shift+T hold fire, Shift+V skirmish, Alt+C cycle
  // charge (toggles), Shift+Q cycles the shape.
  type ArmedOrder = "attackMove" | "follow" | "charge" | "bombard";
  const ORDER_HOTKEYS: Record<string, ArmyOrderKind> = { f: "attackMove", g: "follow", h: "hold", r: "retreat", c: "charge", b: "bombard" };
  type StrategySetting = "holdFire" | "skirmish" | "cycleCharge" | "shape";
  const SETTING_HOTKEYS: Record<string, StrategySetting> = { t: "holdFire", v: "skirmish", q: "shape" };
  let armedOrder: ArmedOrder | null = null;
  // Strategy mode phase 5: enemy summaries (snapshot enemyRegiments, kept until the next), their banners,
  // the intel overlay (strategy/intel.ts) and the own regiments under flank / rear threat.
  let enemyRegiments: EnemyRegimentSnapshot[] = [];
  const enemyBanners = new StrategyBanners();
  const intel = new IntelOverlay();
  let strategyThreats: Threat[] = [];
  // Rear threat: a visible enemy within this many tiles of a member and over a tile behind the facing line.
  const REAR_THREAT_TILES = 4;
  let orderGroups: ArmyOrderGroupSnapshot[] = [];
  let orderGroupOfUnit = new Map<string, ArmyOrderGroupSnapshot>();
  const orderMarkers = new OrderMarkers();

  function armOrder(kind: ArmedOrder | null) {
    armedOrder = kind;
    app.canvas.style.cursor = kind ? "crosshair" : "";
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-order]"))) b.classList.toggle("active", b.dataset.order === kind);
  }

  function sendRegimentOrder(order: ArmyOrder, queue: boolean) {
    if (selectedIds.size === 0) return;
    const msg: ClientMessage = { type: "regimentOrder", unitIds: Array.from(selectedIds), order, ...(queue ? { queue: true } : {}) };
    sendMessage(msg);
  }

  // A dragged line as an order: centre, facing (the shared line rule, Alt flips it) and width in tiles.
  function strategyLine(units: ColonistSnapshot[], ax: number, ay: number, bx: number, by: number, flip: boolean) {
    const plan = computeLineFormationTargets(units, ax, ay, bx, by);
    const facing = Math.atan2(flip ? -plan.fy : plan.fy, flip ? -plan.fx : plan.fx);
    return { x: plan.cx, y: plan.cy, facing, width: Math.hypot(bx - ax, by - ay) / tileSize };
  }

  // A plain click keeps the formation (facing + width) of the order group the selection exactly is; a
  // queued click leaves it to the server (it faces its march at the group's width).
  function keptFormation(queued: boolean): { facing?: number; width?: number } {
    if (queued) return {};
    const alive = latestColonists.filter((c) => selectedIds.has(c.id));
    const g = alive.length > 0 ? orderGroupOfUnit.get(alive[0].id) : undefined;
    if (!g || !alive.every((c) => orderGroupOfUnit.get(c.id) === g)) return {};
    const groupAlive = g.unitIds.filter((id) => latestColonists.some((c) => c.id === id)).length;
    if (groupAlive !== alive.length) return {};
    return { ...(g.facing !== undefined ? { facing: g.facing } : {}), ...(g.width !== undefined ? { width: g.width } : {}) };
  }

  // Follow target under the cursor: a colonist outside the selection, else a player ("p:<id>").
  function followTargetAt(x: number, y: number): string | null {
    const hit = Math.max(UNIT_HIT_RADIUS, STRATEGY_HIT_SCREEN_PX / camZoom);
    const unit = findNearest(latestColonists.filter((c) => !selectedIds.has(c.id)), x, y, hit);
    if (unit) return unit.id;
    const p = findNearest(latestPlayersForSpells.filter((pl) => !pl.dead), x, y, Math.max(hit, 14));
    return p ? `p:${p.id}` : null;
  }

  // Shift+F / G / H / R with soldiers selected in strategy mode (else the key is a build hotkey as ever).
  function strategyOrderKey(e: KeyboardEvent): ArmyOrderKind | null {
    if (!strategyCam.inStrategy || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
    const kind = ORDER_HOTKEYS[e.key.toLowerCase()];
    if (!kind || !latestColonists.some((c) => selectedIds.has(c.id) && isCommandable(c))) return null;
    return kind;
  }

  // Shift+T / V / Q, or Alt+C, with soldiers selected in strategy mode.
  function strategySettingKey(e: KeyboardEvent): StrategySetting | null {
    if (!strategyCam.inStrategy || e.ctrlKey || e.metaKey) return null;
    const key = e.key.toLowerCase();
    const setting = e.altKey && !e.shiftKey ? (e.code === "KeyC" ? "cycleCharge" : null) : e.shiftKey && !e.altKey ? SETTING_HOTKEYS[key] ?? null : null;
    if (!setting || !latestColonists.some((c) => selectedIds.has(c.id) && isCommandable(c))) return null;
    return setting;
  }

  function selectedCommandable(): ColonistSnapshot[] {
    return latestColonists.filter((c) => selectedIds.has(c.id) && isCommandable(c));
  }

  // A toggle turns on unless every selected unit already has it; the shape steps on from the selection's.
  function applyStrategySetting(setting: StrategySetting) {
    const units = selectedCommandable();
    if (units.length === 0) return;
    const unitIds = units.map((u) => u.id);
    if (setting === "shape") {
      const next = FORMATION_SHAPES[(FORMATION_SHAPES.indexOf(groupShape(units)) + 1) % FORMATION_SHAPES.length];
      sendMessage({ type: "regimentSettings", unitIds, shape: next });
      return;
    }
    const on = !units.every((u) => u[setting] === true);
    sendMessage({ type: "regimentSettings", unitIds, [setting]: on });
  }

  // Command bar: the setting toggles light up when every selected unit has them; Shape shows the shape.
  function refreshSettingButtons() {
    const units = selectedCommandable();
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-setting]"))) {
      const setting = b.dataset.setting as StrategySetting;
      if (setting === "shape") {
        const label = b.querySelector(".cmd-shape");
        const text = units.length > 0 ? SHAPE_LABEL[groupShape(units)] : "Shape";
        if (label && label.textContent !== text) label.textContent = text;
        continue;
      }
      b.classList.toggle("active", units.length > 0 && units.every((u) => u[setting] === true));
    }
  }

  // Order panel button / hotkey: attack-move, follow, charge and bombard wait for a right-click, hold /
  // retreat go now.
  function issueOrder(kind: ArmyOrderKind, queue: boolean) {
    if (kind === "attackMove" || kind === "follow" || kind === "charge" || kind === "bombard") {
      armOrder(armedOrder === kind ? null : kind);
      return;
    }
    sendRegimentOrder({ kind }, queue);
  }

  function setOrderGroups(groups: ArmyOrderGroupSnapshot[]) {
    orderGroups = groups;
    orderGroupOfUnit = new Map();
    for (const g of groups) for (const id of g.unitIds) orderGroupOfUnit.set(id, g);
  }

  function redrawOrderMarkers() {
    orderMarkers.layer.visible = strategyCam.active;
    if (!strategyCam.active) return;
    const units = colonistsById();
    orderMarkers.draw(orderGroups, {
      units,
      selected: selectedIds,
      zoom: camZoom,
      targetPos: (o) => {
        if (!o.targetId) return null;
        if (o.kind === "attack" || o.kind === "charge") {
          const m = latestMobs.find((mob) => mob.id === o.targetId);
          return m && strategySeesEnemy(m.x, m.y) ? m : null;
        }
        if (o.targetId.startsWith("p:")) return latestPlayersForSpells.find((p) => p.id === o.targetId!.slice(2)) ?? null;
        return units.get(o.targetId) ?? null;
      },
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && armedOrder) armOrder(null);
    const setting = strategySettingKey(e);
    if (setting) {
      e.preventDefault();
      if (!e.repeat) applyStrategySetting(setting);
      return;
    }
    const kind = strategyOrderKey(e);
    if (!kind) return;
    e.preventDefault();
    if (!e.repeat) issueOrder(kind, false);
  });

  function toggleStrategy() {
    const now = performance.now();
    armOrder(null);
    if (strategyCam.inStrategy) {
      strategyCam.exit(now);
      return;
    }
    // From wherever the camera is now (the rider, a fight peek, or mid exit transition).
    const focus = {
      x: (app.screen.width / 2 - worldLayer.position.x) / camZoom,
      y: (app.screen.height / 2 - worldLayer.position.y) / camZoom,
      zoom: camZoom,
    };
    fightPeek = null;
    fightPeekCam = null;
    cancelLeftPress();
    cancelOrderPress();
    placementGhost.visible = false;
    cursorHighlight.clear();
    strategyCam.enter(focus, now);
    enemyRegiments = [];
    refreshStrategyFog();
    buildStrategyBanners();
    dotsDirty = true;
  }

  // ---- Village life phase 5: adventure view (close camera, adventure.ts). Compact hero bar (HP, XP, Attack / Interact),
  // Enter interacts with the building next to the rider, and a small-party command bar: Follow me / Hold / Shape
  // (Shift+G / H / Q) on the regiment order plumbing, right-click moves / attacks as ever. More than
  // PARTY_COMMAND_MAX commandable units or a task force selected shows the strategy hint instead.
  const heroBarName = document.getElementById("hb-name")!;
  const heroBarHp = document.getElementById("hb-hp")!;
  const heroBarHpText = document.getElementById("hb-hp-text")!;
  const heroBarXp = document.getElementById("hb-xp")!;
  const INTERACT_RANGE_TILES = 2;
  function partyCommandsOn(): boolean {
    return adventurePrefs.on && !strategyCam.active && !document.body.classList.contains("party-large") && selectedCommandable().length > 0;
  }
  function refreshAdventureHud() {
    if (!adventurePrefs.on) return;
    const units = selectedCommandable();
    const large = units.length > PARTY_COMMAND_MAX || units.some((u) => regimentOfUnit.get(u.id)?.id.startsWith("tf"));
    if (document.body.classList.contains("party-large") !== large) document.body.classList.toggle("party-large", large);
    const me = latestPlayersForSpells.find((p) => p.id === myId);
    if (!me) return;
    const hpFrac = me.maxHp > 0 ? Math.max(0, Math.min(1, me.hp / me.maxHp)) : 0;
    heroBarHp.style.width = `${hpFrac * 100}%`;
    heroBarHpText.textContent = me.dead ? "Fallen" : `${Math.ceil(me.hp)} / ${me.maxHp}`;
    const prof = heroProfile;
    const next = prof?.nextLevelXp ?? null;
    const xpFrac = prof && next !== null && next > prof.levelXp ? (prof.xp - prof.levelXp) / (next - prof.levelXp) : 1;
    heroBarXp.style.width = `${Math.max(0, Math.min(1, xpFrac)) * 100}%`;
    const name = `Hero, level ${prof?.level ?? 1}`;
    if (heroBarName.textContent !== name) heroBarName.textContent = name;
  }
  window.setInterval(refreshAdventureHud, 150);
  function adventureInteract() {
    const me = latestPlayersForSpells.find((p) => p.id === myId);
    if (!me || me.dead) return;
    const mx = Math.floor(me.x / tileSize);
    const my = Math.floor(me.y / tileSize);
    let best: { tx: number; ty: number; d: number } | null = null;
    for (let ty = my - INTERACT_RANGE_TILES; ty <= my + INTERACT_RANGE_TILES; ty++) {
      for (let tx = mx - INTERACT_RANGE_TILES; tx <= mx + INTERACT_RANGE_TILES; tx++) {
        if (tx < 0 || ty < 0 || tx >= worldTilesX || ty >= worldTilesY) continue;
        const i = ty * worldTilesX + tx;
        if (!INFO_TILES.has(tiles[i]) && !siteOwners.has(i)) continue;
        const d = Math.hypot((tx + 0.5) * tileSize - me.x, (ty + 0.5) * tileSize - me.y);
        if (!best || d < best.d) best = { tx, ty, d };
      }
    }
    if (best) openBuildingInfo(best.tx, best.ty);
    else pushEventToast("build", "Nothing to interact with nearby");
  }
  // Solo hero: E (talk / gather / work), the dialogue panel, needs and the Pack panel.
  heroLifeRef.ui = setupHeroLife({
    send: sendMessage,
    openBuildingInfo,
    fallbackInteract: adventureInteract,
    blocked: () => strategyCam.inStrategy || !myId || !heroModal.hidden,
    openSheet: () => setHeroSheetOpen(true),
  });
  function partyCommand(cmd: "followMe" | "hold" | "shape") {
    if (!partyCommandsOn() || !myId) return;
    if (cmd === "followMe") sendRegimentOrder({ kind: "follow", targetId: `p:${myId}` }, false);
    else if (cmd === "hold") issueOrder("hold", false);
    else applyStrategySetting("shape");
  }
  commandBarEl.addEventListener("click", (e) => {
    if (strategyCam.inStrategy) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".cmd-btn");
    if (btn?.dataset.party === "followMe") partyCommand("followMe");
    else if (btn?.dataset.order === "hold") partyCommand("hold");
    else if (btn?.dataset.setting === "shape") partyCommand("shape");
  });
  document.getElementById("hb-attack")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    if (strategyCam.inStrategy || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ type: "attack" }));
    if (myId) triggerPlayerAttackAnim(myId);
    sound.play("sword_swing");
  });
  document.getElementById("hb-interact")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    adventureInteract();
  });
  // Shift+G / H / Q with a small party selected in adventure view (else the key is a build hotkey as ever).
  function adventurePartyKey(e: KeyboardEvent): "followMe" | "hold" | "shape" | null {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !partyCommandsOn()) return null;
    return ({ g: "followMe", h: "hold", q: "shape" } as const)[e.key.toLowerCase() as "g" | "h" | "q"] ?? null;
  }
  window.addEventListener("keydown", (e) => {
    if (!adventurePrefs.on || strategyCam.active || !myId || e.repeat) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Not while a button / field has focus (menus, panels) or a dialog is up.
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button")) return;
      e.preventDefault();
      adventureInteract();
      return;
    }
    const cmd = adventurePartyKey(e);
    if (!cmd) return;
    e.preventDefault();
    partyCommand(cmd);
  });

  // Camera ticker hook: pans from keys / screen edge, then the view to draw (null = follow the rider).
  function strategyCameraView(riderX: number, riderY: number): { x: number; y: number; zoom: number } | null {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastPanAt) / 1000));
    lastPanAt = now;
    strategyCam.setBounds(worldTilesX * tileSize, worldTilesY * tileSize, app.screen.width, app.screen.height);
    if (strategyCam.inStrategy && dt > 0) {
      let { dx, dy } = currentInput();
      if (canvasPointer && !panDrag) {
        if (canvasPointer.x <= EDGE_SCROLL_PX) dx = -1;
        else if (canvasPointer.x >= app.screen.width - EDGE_SCROLL_PX) dx = 1;
        if (canvasPointer.y <= EDGE_SCROLL_PX) dy = -1;
        else if (canvasPointer.y >= app.screen.height - EDGE_SCROLL_PX) dy = 1;
      }
      if (dx !== 0 || dy !== 0) {
        const step = (PAN_SCREEN_PX_PER_S * dt) / strategyCam.target.zoom / Math.hypot(dx, dy);
        strategyCam.pan(dx * step, dy * step);
      }
    }
    return strategyCam.view(now, { x: riderX, y: riderY });
  }

  // Camera ticker hook, after worldLayer is placed: LOD layer toggles, dots, banner scale, setView.
  function strategyAfterCamera() {
    const active = strategyCam.active;
    const band: LodBand = active ? lodBand(camZoom) : "tactical";
    const changed = band !== strategyBand || active !== strategyWasActive;
    strategyBand = band;
    const map = band === "map";
    decorSpriteLayer.visible = !map;
    tileSpriteLayer.visible = !map;
    strategicMapSprite.visible = map;
    roleRings.visible = !map;
    strategyDots.visible = map;
    strategyFog.sprite.visible = active;
    strategyBanners.layer.visible = active;
    enemyBanners.layer.visible = active;
    intel.layer.visible = active;
    orderMarkers.layer.visible = active;
    if (map && strategicMapDirty) {
      strategicMapSprite.texture.source.update();
      strategicMapDirty = false;
    }
    if (active) {
      strategyBanners.setZoom(camZoom);
      enemyBanners.setZoom(camZoom);
      drawIntel(map);
    }
    if (map && (dotsDirty || dotsZoom !== camZoom)) redrawStrategyDots();
    if (changed) {
      strategyWasActive = active;
      applyStrategyVisibility();
      document.body.classList.toggle("strategy-mode", active);
    }
    const label = strategyCam.inStrategy ? (adventurePrefs.on ? "Adventure" : "Exit") : adventurePrefs.on ? "Strategy" : "Command";
    if (strategyBtn.textContent !== label) strategyBtn.textContent = label;
    // Village life phase 5: adventure-view UI (hero bar, party command bar) via body.adventure-mode.
    const adventure = adventurePrefs.on && !active;
    if (document.body.classList.contains("adventure-mode") !== adventure) document.body.classList.toggle("adventure-mode", adventure);
    sendStrategyView();
  }

  // Enemies (and wildlife) are drawn in strategy mode only inside live vision.
  function strategySeesEnemy(x: number, y: number): boolean {
    return !strategyCam.active || strategyFog.sees(x, y);
  }

  function refreshStrategyFog() {
    strategyFog.update(explored, liveVisionSources(latestPlayersForSpells, latestColonists));
    fogUpdatedAt = performance.now();
  }

  function setEntityVisible(e: EntityVisual, visible: boolean) {
    e.sprite.visible = visible;
    e.hpBar.visible = visible;
    if (visible) return;
    for (const part of [e.marker, e.wound, e.aura, e.sigil, e.markLabel, e.bossLabel, e.heroLabel]) if (part) part.visible = false;
  }

  // After each snapshot's syncs (which reset colonist / player visibility) and on a band change. Showing
  // only touches sprite + HP bar; the wound / mark / boss parts follow the sprite on the next snapshot.
  function applyStrategyVisibility() {
    const on = strategyCam.active;
    const map = strategyBand === "map";
    const field = strategyBand === "field";
    for (const m of latestMobs) {
      const e = mobSprites.get(m.id);
      if (!e) continue;
      const show = !on || (!map && strategyFog.sees(m.x, m.y));
      if (show !== e.sprite.visible) setEntityVisible(e, show);
    }
    for (const w of wildlifeSprites.values()) w.sprite.visible = !on || strategyFog.sees(w.sprite.position.x, w.sprite.position.y);
    for (const c of latestColonists) {
      const e = colonistSprites.get(c.id);
      if (!e) continue;
      if (on && map) setEntityVisible(e, false);
      e.sprite.alpha = on && field && WORKER_KINDS.has(c.kind) ? 0.5 : 1;
    }
    if (on && map) for (const e of playerSprites.values()) setEntityVisible(e, false);
  }

  function redrawStrategyDots() {
    const dots: UnitDot[] = [];
    for (const tc of latestTownCenters) dots.push({ x: (tc.x + 0.5) * tileSize, y: (tc.y + 0.5) * tileSize, color: 0x7a1f1a, r: 5, square: true });
    for (const c of latestColonists) {
      if (!isCommandable(c)) continue;
      const role = unitRole(c.kind, c.heroClass);
      dots.push({ x: c.x, y: c.y, color: selectedIds.has(c.id) ? SELECTION_COLOR : role ? ROLE_COLORS[role] : 0xf3da98, r: 2 });
    }
    for (const m of latestMobs) if (strategyFog.sees(m.x, m.y)) dots.push({ x: m.x, y: m.y, color: 0xff3b2a, r: 2.5 });
    // Phase 5: every summarised enemy regiment (also those beyond the snapshot's mob cull).
    for (const e of enemyRegiments) dots.push({ x: e.x, y: e.y, color: 0xff3b2a, r: 3 + Math.min(4, Math.sqrt(e.count)), ring: true });
    for (const p of latestPlayersForSpells) {
      if (!p.dead) dots.push({ x: p.x, y: p.y, color: p.id === myId ? 0xffffff : p.color, r: 4, ring: true });
    }
    drawUnitDots(strategyDots, camZoom, dots);
    dotsZoom = camZoom;
    dotsDirty = false;
  }

  function colonistsById(): Map<string, ColonistSnapshot> {
    return new Map(latestColonists.map((c) => [c.id, c]));
  }

  // Centre of the alive units of the list (no-op if none is alive).
  function centreOnUnits(ids: string[]) {
    const byId = colonistsById();
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) continue;
      x += c.x;
      y += c.y;
      n++;
    }
    if (n > 0) strategyCam.jumpTo(x / n, y / n);
  }

  // Strategy mode selection widens a pick to whole regiments (Alt keeps single units, see pointerup).
  function wholeRegiments(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const id of ids) {
      const reg = regimentOfUnit.get(id);
      if (reg) for (const u of reg.unitIds) out.add(u);
      else out.add(id);
    }
    return Array.from(out);
  }

  // Banners over each regiment's alive units and the card bar, from the server regiments + live HP.
  function buildStrategyBanners() {
    const byId = colonistsById();
    const banners: BannerGroup[] = [];
    const cards: RegimentCard[] = [];
    for (const reg of armyRegiments) {
      let x = 0;
      let y = 0;
      let hp = 0;
      let maxHp = 0;
      let first: ColonistSnapshot | null = null;
      let stance: Stance | null | undefined;
      let holdFire = true;
      let skirmish = true;
      let cycle = true;
      let shape: FormationShape | null | undefined;
      let alive = 0;
      let selected = 0;
      for (const id of reg.unitIds) {
        const u = byId.get(id);
        if (!u) continue;
        first ??= u;
        stance = stance === undefined ? u.stance : stance === u.stance ? stance : null;
        holdFire &&= u.holdFire === true;
        skirmish &&= u.skirmish === true;
        cycle &&= u.cycleCharge === true;
        const us = u.shape ?? "line";
        shape = shape === undefined ? us : shape === us ? shape : null;
        alive++;
        if (selectedIds.has(id)) selected++;
        x += u.x;
        y += u.y;
        hp += Math.max(0, u.hp);
        maxHp += u.maxHp;
      }
      const hpFrac = maxHp > 0 ? hp / maxHp : alive === 0 ? 0 : reg.hpFrac;
      const roleColor = reg.role ? ROLE_COLORS[reg.role] : 0xd8a24a;
      const count = `${alive}/${Math.max(reg.maxCount, alive)}`;
      if (alive > 0) {
        // Phase 6: morale bar + state tag; a routing banner goes grey, a wavering one amber.
        const moraleColor = reg.moraleState === "routing" ? 0x8a8a8a : reg.moraleState === "wavering" ? 0xffb02e : roleColor;
        banners.push({
          key: reg.id,
          label: reg.name,
          count,
          hpFrac,
          color: selected > 0 ? SELECTION_COLOR : moraleColor,
          x: x / alive,
          y: y / alive - BANNER_LIFT_PX,
          ...(reg.morale !== undefined ? { morale: reg.morale / 100 } : {}),
          ...(reg.moraleState === "routing" ? { tag: "Routing" } : reg.moraleState === "wavering" ? { tag: "Wavering" } : reg.outflanked ? { tag: "Outflanked!" } : {}),
        });
      }
      const iconKind: ColonistKind = first
        ? first.kind === "hero" ? HERO_VISUAL_KIND[first.heroClass ?? "champion"] : first.kind
        : REGIMENT_ICON_KIND[reg.cls];
      cards.push({
        id: reg.id,
        name: reg.name,
        icon: `/sprites/${iconKind}Walk0.png`,
        count: alive,
        maxCount: Math.max(reg.maxCount, alive),
        hpFrac,
        role: reg.role,
        roleLabel: reg.cls === "clergy" ? "Healer" : reg.role ? ROLE_LABEL[reg.role] : "",
        roleColor: `#${roleColor.toString(16).padStart(6, "0")}`,
        hero: reg.cls === "hero",
        slot: reg.taskForce,
        stance: stance ?? undefined,
        order: regimentOrderLabel(reg),
        flags: alive > 0 ? [holdFire && "HF", skirmish && "Sk", cycle && "Cyc", shape && shape !== "line" && SHAPE_LABEL[shape]].filter(Boolean).join(" ") || undefined : undefined,
        morale: alive > 0 ? reg.morale : undefined,
        moraleState: alive > 0 ? reg.moraleState : undefined,
        outflanked: alive > 0 && reg.outflanked === true,
        selected: alive > 0 && selected === alive,
      });
    }
    strategyBanners.sync(banners);
    regimentCards.render(cards);
    buildEnemyIntel(byId, banners);
  }

  // Phase 5: the selection's (else the whole army's) Lanchester power: sum hp x sum damage, each regiment's
  // damage (snapshot ArmyRegimentSnapshot.dmg) prorated by its share of selected alive members.
  function ownPower(byId: Map<string, ColonistSnapshot>): number {
    const any = Array.from(selectedIds).some((id) => { const c = byId.get(id); return !!c && isCommandable(c); });
    let hp = 0;
    let dmg = 0;
    for (const reg of armyRegiments) {
      let alive = 0;
      let picked = 0;
      for (const id of reg.unitIds) {
        const u = byId.get(id);
        if (!u) continue;
        alive++;
        if (any && !selectedIds.has(id)) continue;
        picked++;
        hp += Math.max(0, u.hp);
      }
      if (alive > 0) dmg += ((reg.dmg ?? 0) * picked) / alive;
    }
    return hp * dmg;
  }

  // Enemy banners (strength band vs the selection / army) and the own regiments under threat: targeted by
  // a visible flank group, or a visible enemy behind the facing line of their order group.
  function buildEnemyIntel(byId: Map<string, ColonistSnapshot>, own: BannerGroup[]) {
    const power = ownPower(byId);
    const groups: BannerGroup[] = enemyRegiments.map((e) => {
      const band = strengthBand(e.power, power);
      return {
        key: `e:${e.id}`,
        label: enemyBannerLabel(e, band),
        count: `${e.count}${e.partial ? "+" : ""}`,
        hpFrac: e.hpFrac,
        color: e.routed ? 0x8a8a8a : BAND_COLORS[band],
        x: e.x,
        y: e.y - BANNER_LIFT_PX,
        // Phase 6: the enemy's morale bar, and "Outflanked!" when a rear attack is draining it.
        ...(e.morale !== undefined ? { morale: e.morale / 100 } : {}),
        ...(e.outflanked && !e.routed ? { tag: "Outflanked!" } : {}),
      };
    });
    enemyBanners.sync(groups);
    const ownPos = new Map(own.map((b) => [b.key, b]));
    const threats = new Map<string, Threat>();
    for (const e of enemyRegiments) {
      const reg = e.flank?.targetId ? regimentOfUnit.get(e.flank.targetId) : undefined;
      const b = reg ? ownPos.get(reg.id) : undefined;
      if (reg && b) threats.set(reg.id, { x: b.x, y: b.y, text: "Flank threatened" });
    }
    const near = REAR_THREAT_TILES * tileSize;
    const seen = latestMobs.filter((m) => strategySeesEnemy(m.x, m.y));
    for (const reg of armyRegiments) {
      const b = ownPos.get(reg.id);
      const g = reg.unitIds.length > 0 ? orderGroupOfUnit.get(reg.unitIds[0]) : undefined;
      if (!b || threats.has(reg.id) || g?.facing === undefined || seen.length === 0) continue;
      const fx = Math.cos(g.facing);
      const fy = Math.sin(g.facing);
      const members = reg.unitIds.map((id) => byId.get(id)).filter((u): u is ColonistSnapshot => !!u);
      const cx = members.reduce((sum, u) => sum + u.x, 0) / members.length;
      const cy = members.reduce((sum, u) => sum + u.y, 0) / members.length;
      const behind = seen.some(
        (m) => (m.x - cx) * fx + (m.y - cy) * fy < -tileSize && members.some((u) => Math.abs(u.x - m.x) <= near && Math.abs(u.y - m.y) <= near && Math.hypot(u.x - m.x, u.y - m.y) <= near)
      );
      if (behind) threats.set(reg.id, { x: b.x, y: b.y, text: "Rear threatened" });
    }
    strategyThreats = Array.from(threats.values());
  }

  // Every frame in strategy mode: flank arrows, threats, clash icons (Map band) and objective markers.
  function drawIntel(mapBand: boolean) {
    const objectives: ObjectiveMarker[] = [];
    const castleGoal = latestGoal !== null && latestGoal.index < latestGoal.total && /castle ruin/i.test(latestGoal.title);
    if (castleRuinTile && explored[castleRuinTile.y * worldTilesX + castleRuinTile.x]) {
      objectives.push({
        key: "castle", kind: "castle", label: castleGoal ? latestGoal!.title : "Castle Ruin", objective: castleGoal,
        x: (castleRuinTile.x + 0.5) * tileSize, y: (castleRuinTile.y + 0.5) * tileSize,
      });
    }
    for (const index of latestHearths) {
      if (!explored[index]) continue;
      objectives.push({
        key: `h${index}`, kind: "camp", label: "Camp", objective: false,
        x: ((index % worldTilesX) + 0.5) * tileSize, y: (Math.floor(index / worldTilesX) + 0.5) * tileSize,
      });
    }
    intel.draw({
      zoom: camZoom,
      mapBand,
      enemies: enemyRegiments,
      clashes: mapBand ? latestFights.filter(fightIsOnScreen).map((f) => ({ fight: f, ...fightWorldPos(f) })) : [],
      threats: strategyThreats,
      objectives,
      now: performance.now(),
    });
  }

  // The order glyph of a regiment whose members all share one order group ("Hold", "Move +2").
  function regimentOrderLabel(reg: ArmyRegimentSnapshot): string | undefined {
    const g = reg.unitIds.length > 0 ? orderGroupOfUnit.get(reg.unitIds[0]) : undefined;
    if (!g || !g.order || !reg.unitIds.every((id) => orderGroupOfUnit.get(id) === g)) return undefined;
    const label = g.engaged ? "Engaged" : ORDER_LABEL[g.order.kind];
    return g.queue.length > 0 ? `${label} +${g.queue.length}` : label;
  }

  function setArmyRegiments(regiments: ArmyRegimentSnapshot[]) {
    armyRegiments = regiments;
    regimentOfUnit = new Map();
    for (const reg of regiments) for (const id of reg.unitIds) regimentOfUnit.set(id, reg);
  }

  // Control groups (task forces): select slot N; a second tap of N within GROUP_DOUBLE_TAP_MS centres on it.
  function recallControlGroup(slot: number) {
    const ids = latestTaskForces[String(slot)] ?? [];
    setSelection(ids);
    const now = performance.now();
    if (strategyCam.inStrategy && lastGroupTap.slot === slot && now - lastGroupTap.at <= GROUP_DOUBLE_TAP_MS) centreOnUnits(ids);
    lastGroupTap = { slot, at: now };
  }

  // Strategy mode: a plain 1-9 recalls that control group when it has one (else it stays a build hotkey).
  function isStrategyGroupRecall(e: KeyboardEvent): number {
    if (!strategyCam.inStrategy || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return 0;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (!digit || !(latestTaskForces[digit[1]]?.length > 0)) return 0;
    return Number(digit[1]);
  }

  function strategyOnSnapshot(
    players: PlayerSnapshot[],
    regiments: ArmyRegimentSnapshot[] | undefined,
    groups: ArmyOrderGroupSnapshot[] | undefined,
    enemies: EnemyRegimentSnapshot[] | undefined
  ) {
    if (regiments) setArmyRegiments(regiments);
    if (enemies) enemyRegiments = enemies;
    if (groups) setOrderGroups(groups);
    redrawOrderMarkers();
    if (strategyCam.active) {
      if (performance.now() - fogUpdatedAt >= STRATEGY_FOG_REFRESH_MS) {
        strategyFog.update(explored, liveVisionSources(players, latestColonists));
        fogUpdatedAt = performance.now();
      }
      buildStrategyBanners();
      dotsDirty = true;
    }
    applyStrategyVisibility();
  }

  function strategyOnWelcome() {
    if (viewSent) {
      const off: ClientMessage = { type: "setView", x: 0, y: 0, halfW: 0, halfH: 0, strategy: false };
      sendMessage(off);
      viewSent = null;
    }
    strategyCam.reset();
    advCam.sync(NaN, NaN, performance.now());
    pendingStartStrategy = adventurePrefs.startStrategy;
    cancelPanDrag();
    strategyFog.reset(worldTilesX, worldTilesY, tileSize);
    strategyBanners.clear();
    setArmyRegiments([]);
    setOrderGroups([]);
    orderMarkers.clear();
    armOrder(null);
    regimentCards.render([]);
    strategyDots.clear();
    enemyRegiments = [];
    strategyThreats = [];
    enemyBanners.clear();
    intel.clear();
    worldLayer.addChild(strategyDots);
    worldLayer.addChild(orderMarkers.layer);
    worldLayer.addChild(intel.layer);
    worldLayer.addChild(enemyBanners.layer);
    worldLayer.addChild(strategyBanners.layer);
  }

  // At most every SET_VIEW_INTERVAL_MS and only when the target moved / resized by a tile or more; one
  // strategy:false when the mode ends.
  function sendStrategyView() {
    if (!strategyCam.inStrategy) {
      if (viewSent) {
        const off: ClientMessage = { type: "setView", x: 0, y: 0, halfW: 0, halfH: 0, strategy: false };
        sendMessage(off);
        viewSent = null;
      }
      return;
    }
    const now = performance.now();
    if (now - viewSentAt < SET_VIEW_INTERVAL_MS) return;
    const t = strategyCam.target;
    const round = (n: number) => Math.round(n * 10) / 10;
    const v = {
      x: round(t.x / tileSize),
      y: round(t.y / tileSize),
      halfW: round(app.screen.width / 2 / t.zoom / tileSize),
      halfH: round(app.screen.height / 2 / t.zoom / tileSize),
    };
    const prev = viewSent;
    if (prev && Math.abs(v.x - prev.x) < 1 && Math.abs(v.y - prev.y) < 1 && Math.abs(v.halfW - prev.halfW) < 1 && Math.abs(v.halfH - prev.halfH) < 1) return;
    const msg: ClientMessage = { type: "setView", ...v, strategy: true };
    sendMessage(msg);
    viewSent = v;
    viewSentAt = now;
  }

  strategyBtn.addEventListener("click", () => {
    strategyBtn.blur();
    if (myId) toggleStrategy();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      if (!e.repeat && myId) toggleStrategy();
    } else if (e.key === "Home" && strategyCam.inStrategy && myId) {
      const me = playerSprites.get(myId);
      if (me) strategyCam.jumpTo(me.sprite.position.x, me.sprite.position.y);
    }
  });
  // Esc leaves strategy mode once nothing else would take it (spell aim, a panel or modal, a selection).
  // Capture phase, so this runs before the other Escape handlers have closed anything.
  const settingsModalEl = document.getElementById("settings-modal")!;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !strategyCam.inStrategy) return;
      if (spellAim || infoTile || selectedIds.size > 0 || !settingsModalEl.hidden || !heroModal.hidden) return;
      e.stopImmediatePropagation();
      strategyCam.exit(performance.now());
    },
    { capture: true }
  );
  app.canvas.addEventListener(
    "wheel",
    (e) => {
      if (!strategyCam.inStrategy) {
        // Adventure camera: the wheel nudges the close zoom (no zoom-out to strategy: that is Tab).
        if (!adventurePrefs.on || strategyCam.active) return;
        e.preventDefault();
        advCam.zoomBy(WHEEL_ZOOM_STEP ** -Math.max(-3, Math.min(3, (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) / 100)));
        return;
      }
      e.preventDefault();
      const rect = app.canvas.getBoundingClientRect();
      const notches = Math.max(-3, Math.min(3, (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) / 100));
      strategyCam.zoomAt(WHEEL_ZOOM_STEP ** -notches, e.clientX - rect.left, e.clientY - rect.top, app.screen.width, app.screen.height);
    },
    { passive: false }
  );
  // Minimap click / drag moves the strategy view there.
  function minimapJump(e: PointerEvent) {
    const r = minimapEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    strategyCam.jumpTo(((e.clientX - r.left) / r.width) * worldTilesX * tileSize, ((e.clientY - r.top) / r.height) * worldTilesY * tileSize);
  }
  minimapEl.addEventListener("pointerdown", (e) => {
    if (!strategyCam.inStrategy || e.button !== 0) return;
    minimapEl.setPointerCapture(e.pointerId);
    minimapJump(e);
  });
  minimapEl.addEventListener("pointermove", (e) => {
    if (strategyCam.inStrategy && minimapEl.hasPointerCapture(e.pointerId)) minimapJump(e);
    // Forts phase D: hovering a fort flag names it (a settlement with your clan's relation tier).
    const r = minimapEl.getBoundingClientRect();
    if (r.width <= 0) return;
    const tx = ((e.clientX - r.left) / r.width) * worldTilesX;
    const ty = ((e.clientY - r.top) / r.height) * worldTilesY;
    const reach = (8 / r.width) * worldTilesX;
    let tip = "";
    let best = Infinity;
    for (const f of fortMarkers) {
      const d = Math.hypot(f.keepX + 0.5 - tx, f.keepY - 2 - ty);
      if (d > reach || d >= best) continue;
      best = d;
      const rel = f.num !== undefined ? siteRelations.get(f.num) : undefined;
      tip = f.faction !== "human"
        ? `${f.name} (${f.faction === "orc" ? "orc stockade" : "bandit palisade"}${f.cleared ? ", razed" : ""})`
        : f.captured || f.cleared ? `${f.name} (${f.captured ? "captured" : "razed"})`
        : `${f.name}: ${f.hostile ? "up in arms" : f.vassalOf === myClan ? "your vassal" : RELATION_TIER_NAMES[rel?.tier ?? "neutral"]} (relation ${rel?.value ?? 0})${f.vassalOf !== undefined && f.vassalOf !== myClan ? `, vassal of ${clanNames.get(f.vassalOf) ?? "another clan"}` : ""}`;
    }
    if (minimapEl.title !== tip) minimapEl.title = tip;
  });

  function pointerTile(clickX: number, clickY: number): { tileX: number; tileY: number } | null {
    const tileX = Math.floor(clickX / tileSize);
    const tileY = Math.floor(clickY / tileSize);
    if (tileX < 0 || tileY < 0 || tileX >= worldTilesX || tileY >= worldTilesY) return null;
    return { tileX, tileY };
  }

  // Scale pass: the tile a click lands on, or the scaled building (BUILDING_VISUAL_SCALE) just below it when
  // the click hits that building's sprite where it overflows into this (non-building) tile.
  function buildingTileAt(clickX: number, clickY: number): { tileX: number; tileY: number } | null {
    const pointed = pointerTile(clickX, clickY);
    // A multi-tile building's part tile opens / demolishes its anchor.
    const anchor = pointed ? anchorOfClient(pointed.tileX, pointed.tileY) : null;
    const tile = pointed && anchor ? { tileX: anchor.x, tileY: anchor.y } : pointed;
    if (!tile || INFO_TILES.has(tiles[tile.tileY * worldTilesX + tile.tileX])) return tile;
    const below = { tileX: tile.tileX, tileY: tile.tileY + 1 };
    if (below.tileY >= worldTilesY) return tile;
    const index = below.tileY * worldTilesX + below.tileX;
    if (!BUILDING_VISUAL_SCALE[tiles[index] as TileType]) return tile;
    const sprite = tileSprites.get(index);
    if (!sprite) return tile;
    // Bottom-centre anchored on the tile's bottom edge (setTileSprite), in world px.
    const halfW = Math.abs(sprite.width) / 2;
    const hit = Math.abs(clickX - sprite.position.x) <= halfW && clickY <= sprite.position.y && clickY >= sprite.position.y - Math.abs(sprite.height);
    return hit ? below : tile;
  }

  app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Left button is resolved on pointerup (it may become a drag-select); other buttons act on down.
  interface LeftPress {
    pointerId: number;
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    dragging: boolean;
  }
  let leftPress: LeftPress | null = null;
  // Right-button order in progress for a multi-unit selection (see computeLineFormationTargets).
  interface OrderPress {
    pointerId: number;
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    dragging: boolean;
    order: number;
    // Strategy mode: the regiment order a release sends (Shift at press = queue it).
    kind?: "move" | "attackMove";
    queue?: boolean;
  }
  let orderPress: OrderPress | null = null;
  const lineGuide = new Graphics();
  function cancelOrderPress() {
    if (orderPress && app.canvas.hasPointerCapture(orderPress.pointerId)) {
      app.canvas.releasePointerCapture(orderPress.pointerId);
    }
    orderPress = null;
    lineGuide.clear();
  }

  function cancelLeftPress() {
    if (leftPress && app.canvas.hasPointerCapture(leftPress.pointerId)) {
      app.canvas.releasePointerCapture(leftPress.pointerId);
    }
    leftPress = null;
    dragBox.clear();
  }

  app.canvas.addEventListener("pointerdown", (e) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / camZoom;
    const y = (e.clientY - rect.top - worldLayer.position.y) / camZoom;
    // Strategy mode: middle-drag pans the camera.
    if (e.button === 1 && strategyCam.inStrategy) {
      e.preventDefault();
      panDrag = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      app.canvas.setPointerCapture(e.pointerId);
      return;
    }
    // Creative mode: a spawn / stamp placed "At click" takes the left click.
    if (e.button === 0 && creativeUi.consumeClick(x, y)) return;
    // Hero phase 4: aiming a spell takes the left click; a right click cancels the aim.
    if (spellAim && e.button === 0 && spellAimClick(x, y)) return;
    if (spellAim && e.button === 2) {
      setSpellAim(null);
      return;
    }
    if (e.button === 0) {
      leftPress = {
        pointerId: e.pointerId,
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: x,
        worldY: y,
        dragging: false,
      };
      app.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2 && selectedIds.size > 0) {
      if (socket.readyState !== socket.OPEN) return;
      // latestColonists is replaced wholesale on every snapshot (20/s), so this is the units' live
      // positions at the moment of the order — a redirect mid-march re-faces from where they are.
      // Creative mode: Ctrl+right-click on another clan's unit or an animal force-attacks it.
      if (e.ctrlKey && creativeUi.forceAttackAt(x, y, latestColonists, myClan, Math.max(STRATEGY_HIT_SCREEN_PX / camZoom, tileSize * 0.6))) return;
      const units = latestColonists.filter((c) => selectedIds.has(c.id));
      const unitIds = units.map((u) => u.id);
      const order = stampOrder(unitIds);
      hideFormationMarker();
      // Zoomed out, a unit is a few screen px: keep the hit area at least STRATEGY_HIT_SCREEN_PX wide.
      const minHit = STRATEGY_HIT_SCREEN_PX / camZoom;
      const mobUnder = findNearest(
        latestMobs.filter(
          (m) => strategySeesEnemy(m.x, m.y) && (m.x - x) ** 2 + (m.y - y) ** 2 <= Math.max(minHit, mobHitRadius(m.kind, mobRenderScale(m))) ** 2
        ),
        x,
        y,
        Infinity
      );
      // Phase 5: right-clicking an enemy banner attacks the visible member nearest its centroid.
      const enemyKey = !mobUnder && strategyCam.inStrategy ? enemyBanners.hitTest(x, y, camZoom) : null;
      const enemyReg = enemyKey ? enemyRegiments.find((r) => `e:${r.id}` === enemyKey) : undefined;
      const mob = mobUnder ?? (enemyReg ? findNearest(latestMobs.filter((m) => strategySeesEnemy(m.x, m.y)), enemyReg.x, enemyReg.y, 6 * tileSize) : null);
      const clicked = pointerTile(x, y);
      const hearthIndex = clicked ? clicked.tileY * worldTilesX + clicked.tileX : -1;
      // Strategy mode phase 3: regiment orders (attack, follow, move / attack-move with a line drag).
      const strategic = strategyCam.inStrategy;
      const armed = armedOrder;
      if (strategic) armOrder(null);
      // Phase 4: a charge armed on the ground takes the nearest visible enemy within 3 tiles of the click.
      const chargeMob = strategic && armed === "charge"
        ? mob ?? findNearest(latestMobs.filter((m) => strategySeesEnemy(m.x, m.y)), x, y, 3 * tileSize)
        : null;
      if (strategic && armed === "bombard") {
        sendRegimentOrder({ kind: "bombard", x, y }, e.shiftKey);
      } else if (chargeMob) {
        sendRegimentOrder({ kind: "charge", targetId: chargeMob.id }, e.shiftKey);
      } else if (strategic && armed === "charge") {
        // Nothing to charge there: no order.
      } else if (mob) {
        if (strategic) sendRegimentOrder({ kind: "attack", targetId: mob.id }, e.shiftKey);
        else socket.send(JSON.stringify({ type: "commandAttack", unitIds, mobId: mob.id }));
      } else if (clicked && (latestHearths.has(hearthIndex) || siteOwners.has(hearthIndex))) {
        // Camp hearths: right-click a standing hearth to send the selection against it (strategy mode: as
        // a regiment order, so the group keeps its queue / settings).
        if (strategic) sendRegimentOrder({ kind: "attackHearth", tileX: clicked.tileX, tileY: clicked.tileY }, e.shiftKey);
        else socket.send(JSON.stringify({ type: "commandAttackHearth", unitIds, tileX: clicked.tileX, tileY: clicked.tileY }));
      } else if (strategic && armed === "follow") {
        const targetId = followTargetAt(x, y);
        if (targetId) sendRegimentOrder({ kind: "follow", targetId }, e.shiftKey);
      } else if (strategic) {
        // Wait for release: a click moves the formation as it stands, a drag lays out a line.
        const kind = armed === "attackMove" || e.ctrlKey ? "attackMove" : "move";
        orderPress = { pointerId: e.pointerId, screenX: e.clientX, screenY: e.clientY, worldX: x, worldY: y, dragging: false, order, kind, queue: e.shiftKey };
        app.canvas.setPointerCapture(e.pointerId);
      } else if (units.length > 1) {
        // Wait for release: a click orders the normal block, a drag stretches a custom line.
        orderPress = { pointerId: e.pointerId, screenX: e.clientX, screenY: e.clientY, worldX: x, worldY: y, dragging: false, order };
        app.canvas.setPointerCapture(e.pointerId);
      } else {
        socket.send(JSON.stringify({ type: "commandMove", unitIds, x, y }));
      }
      return;
    }
    const tile = pointerTile(x, y);
    if (!tile) return;
    if (socket.readyState !== socket.OPEN) return;
    const value = e.button === 2 ? currentTool : TileType.Empty;
    if (value === TileType.Empty) {
      requestDemolish([{ x: tile.tileX, y: tile.tileY }]);
      return;
    }
    placeTile(tile.tileX, tile.tileY, value);
    if (value === TileType.Moat) moatDrag = { pointerId: e.pointerId, x: tile.tileX, y: tile.tileY };
  });

  // Demolishing your own building asks first ("Confirm demolish <name>", Cancel / Esc). Instant as before: walls,
  // moats, roads, natural tiles and anything not built from the Build menu (camp hearths are attacked, not demolished).
  // A list (a future batch) gets one confirm with its count.
  const DEMOLISH_INSTANT = new Set<number>([TileType.Wall, TileType.StoneWall, TileType.Moat, TileType.Road, TileType.CobbleRoad]);
  const demolishConfirmEl = document.getElementById("demolish-confirm")!;
  const demolishConfirmText = document.getElementById("demolish-confirm-text")!;
  const demolishConfirmBtn = document.getElementById("demolish-confirm-ok") as HTMLButtonElement;
  let pendingDemolish: { x: number; y: number }[] = [];
  function demolishLabel(x: number, y: number): string | null {
    const a = anchorOfClient(x, y);
    const index = a.y * worldTilesX + a.x;
    const t = tiles[index];
    if (t === TileType.Empty || DEMOLISH_INSTANT.has(t) || siteOwners.has(index)) return null;
    return TOOLS.find((tool) => tool.tile === t && tool.tile !== TileType.Empty)?.label ?? null;
  }
  function sendDemolish(list: { x: number; y: number }[]) {
    if (socket.readyState !== socket.OPEN) return;
    for (const t of list) socket.send(JSON.stringify({ type: "setTile", tileX: t.x, tileY: t.y, tile: TileType.Empty }));
  }
  function closeDemolishConfirm() {
    pendingDemolish = [];
    demolishConfirmEl.hidden = true;
  }
  function requestDemolish(list: { x: number; y: number }[]) {
    const named = list.map((t) => ({ t, label: demolishLabel(t.x, t.y) }));
    sendDemolish(named.filter((n) => n.label === null).map((n) => n.t));
    const ask = named.filter((n) => n.label !== null);
    if (ask.length === 0) return;
    pendingDemolish = ask.map((n) => n.t);
    const label = ask.length === 1 ? ask[0].label! : `${ask.length} buildings`;
    demolishConfirmText.textContent = `Demolish ${label}?`;
    demolishConfirmBtn.textContent = `Confirm demolish ${label}`;
    demolishConfirmEl.hidden = false;
  }
  demolishConfirmBtn.addEventListener("click", () => {
    demolishConfirmBtn.blur();
    sendDemolish(pendingDemolish);
    closeDemolishConfirm();
  });
  document.getElementById("demolish-confirm-cancel")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    closeDemolishConfirm();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !demolishConfirmEl.hidden) closeDemolishConfirm();
  });

  function placeTile(tileX: number, tileY: number, value: number) {
    if (value !== TileType.Empty) {
      pendingPlacements.set(tileY * worldTilesX + tileX, { tile: value, at: performance.now() });
    }
    socket.send(JSON.stringify({ type: "setTile", tileX, tileY, tile: value }));
  }
  // Phase H: right-dragging the Moat tool digs every tile the pointer crosses, 4-connected (a diagonal
  // step adds the orthogonal tile between), so the line has no corner gaps.
  let moatDrag: { pointerId: number; x: number; y: number } | null = null;
  function extendMoatDrag(worldX: number, worldY: number) {
    const drag = moatDrag;
    const tile = drag ? pointerTile(worldX, worldY) : null;
    if (!drag || !tile || socket.readyState !== socket.OPEN || currentTool !== TileType.Moat) return;
    while (drag.x !== tile.tileX || drag.y !== tile.tileY) {
      if (Math.abs(tile.tileX - drag.x) >= Math.abs(tile.tileY - drag.y)) drag.x += Math.sign(tile.tileX - drag.x);
      else drag.y += Math.sign(tile.tileY - drag.y);
      placeTile(drag.x, drag.y, TileType.Moat);
    }
  }

  app.canvas.addEventListener("pointerup", (e) => {
    if (moatDrag && e.pointerId === moatDrag.pointerId) moatDrag = null;
    if (e.button === 2 && orderPress && e.pointerId === orderPress.pointerId) {
      const press = orderPress;
      cancelOrderPress();
      // Units may have died or been deselected while the button was held.
      const units = latestColonists.filter((c) => selectedIds.has(c.id));
      if (units.length === 0 || unitOrder.get(units[0].id) !== press.order && !units.some((u) => unitOrder.get(u.id) === press.order)) return;
      const rect = app.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - worldLayer.position.x) / camZoom;
      const y = (e.clientY - rect.top - worldLayer.position.y) / camZoom;
      if (press.kind) {
        const shape = press.dragging && units.length > 1 ? strategyLine(units, press.worldX, press.worldY, x, y, e.altKey) : { x: press.worldX, y: press.worldY, ...keptFormation(press.queue === true) };
        sendRegimentOrder({ kind: press.kind, ...shape }, press.queue === true);
        return;
      }
      if (press.dragging && units.length > 1) {
        const plan = computeLineFormationTargets(units, press.worldX, press.worldY, x, y);
        dispatchPlannedMove(units, plan, plan.cx, plan.cy, press.order);
      } else if (units.length > 1) {
        dispatchFormationMove(units, press.worldX, press.worldY, press.order);
      }
      return;
    }
    if (e.button === 1 && panDrag && e.pointerId === panDrag.pointerId) {
      cancelPanDrag();
      return;
    }
    if (e.button !== 0 || !leftPress || e.pointerId !== leftPress.pointerId) return;
    const press = leftPress;
    cancelLeftPress();
    const rect = app.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - worldLayer.position.x) / camZoom;
    const y = (e.clientY - rect.top - worldLayer.position.y) / camZoom;

    if (press.dragging) {
      const minX = Math.min(press.worldX, x);
      const maxX = Math.max(press.worldX, x);
      const minY = Math.min(press.worldY, y);
      const maxY = Math.max(press.worldY, y);
      const boxed = latestColonists
        .filter(
          (c) =>
            isCommandable(c) &&
            c.x >= minX &&
            c.x <= maxX &&
            c.y >= minY &&
            c.y <= maxY
        )
        .map((c) => c.id);
      // Strategy mode: whole regiments of anything inside, Shift adds; Alt keeps just the boxed units.
      if (strategyCam.inStrategy) {
        const picked = e.altKey ? boxed : wholeRegiments(boxed);
        setSelection(e.shiftKey ? [...selectedIds, ...picked] : picked);
      } else {
        setSelection(boxed);
      }
      return;
    }

    // Strategy mode: a banner selects its regiment.
    const bannerKey = strategyCam.inStrategy ? strategyBanners.hitTest(x, y, camZoom) : null;
    const bannerReg = bannerKey ? armyRegiments.find((r) => r.id === bannerKey) : undefined;
    if (bannerReg) {
      setSelection(e.shiftKey ? [...selectedIds, ...bannerReg.unitIds] : bannerReg.unitIds);
      return;
    }
    // Phase 5: a clash icon (Map band) zooms to the Field band there.
    const clash = strategyCam.inStrategy && strategyBand === "map" ? intel.hitClash(x, y) : null;
    if (clash) {
      strategyCam.zoomAt(STRATEGY_CLASH_ZOOM / strategyCam.target.zoom, app.screen.width / 2, app.screen.height / 2, app.screen.width, app.screen.height);
      strategyCam.jumpTo(clash.x, clash.y);
      return;
    }

    const unit = findNearest(
      latestColonists.filter(isCommandable),
      x,
      y,
      Math.max(UNIT_HIT_RADIUS, STRATEGY_HIT_SCREEN_PX / camZoom)
    );
    // Clicking your own hero (closer than any unit) opens the hero sheet, in adventure and strategy view alike.
    const meHit = latestPlayersForSpells.find((pl) => pl.id === myId && !pl.dead);
    const heroHitPx = Math.max(UNIT_HIT_RADIUS, STRATEGY_HIT_SCREEN_PX / camZoom);
    if (meHit && Math.hypot(meHit.x - x, meHit.y - y) <= heroHitPx && (!unit || Math.hypot(meHit.x - x, meHit.y - y) < Math.hypot(unit.x - x, unit.y - y))) {
      setHeroSheetOpen(true);
      return;
    }
    if (unit) {
      // Strategy mode: a unit stands for its whole regiment (Alt+click = just that unit), Shift adds.
      if (strategyCam.inStrategy) {
        const picked = e.altKey ? [unit.id] : wholeRegiments([unit.id]);
        setSelection(e.shiftKey ? [...selectedIds, ...picked] : picked);
      } else {
        setSelection([unit.id]);
      }
      return;
    }

    const tile = buildingTileAt(x, y);
    // Left-click on a building (any build tool but Demolish selected) opens its info panel instead of
    // breaking it; with Demolish selected it breaks as before. Garrison buildings also select their units.
    const tileValue = tile ? tiles[tile.tileY * worldTilesX + tile.tileX] : TileType.Empty;
    // Strategy mode never demolishes, so its clicks always open the panel.
    // Forts phase B: any tile of an NPC fort opens its info ("Grakkar Stockade: Wall").
    const showInfo = tile !== null && currentTool !== TileType.Empty && (INFO_TILES.has(tileValue) || siteOwners.has(tile.tileY * worldTilesX + tile.tileX));
    if (showInfo) openBuildingInfo(tile.tileX, tile.tileY);
    if (tile && GARRISON_TILES.has(tileValue)) {
      setSelection(
        latestColonists
          .filter((c) => unitRole(c.kind, c.heroClass) !== undefined && c.postX === tile.tileX && c.postY === tile.tileY)
          .map((c) => c.id)
      );
      return;
    }

    // Nothing selectable under the cursor: original left-click behaviour (break tile).
    setSelection([]);
    if (!tile || showInfo) return;
    requestDemolish([{ x: tile.tileX, y: tile.tileY }]);
  });

  app.canvas.addEventListener("pointercancel", (e) => {
    if (moatDrag && e.pointerId === moatDrag.pointerId) moatDrag = null;
    if (leftPress && e.pointerId === leftPress.pointerId) cancelLeftPress();
    if (orderPress && e.pointerId === orderPress.pointerId) cancelOrderPress();
    if (panDrag && e.pointerId === panDrag.pointerId) cancelPanDrag();
  });

  app.canvas.addEventListener("pointermove", (e) => {
    const rect = app.canvas.getBoundingClientRect();
    canvasPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (panDrag && e.pointerId === panDrag.pointerId) {
      strategyCam.pan(-(e.clientX - panDrag.lastX) / camZoom, -(e.clientY - panDrag.lastY) / camZoom);
      panDrag.lastX = e.clientX;
      panDrag.lastY = e.clientY;
      return;
    }
    const x = (e.clientX - rect.left - worldLayer.position.x) / camZoom;
    const y = (e.clientY - rect.top - worldLayer.position.y) / camZoom;
    if (moatDrag && e.pointerId === moatDrag.pointerId) extendMoatDrag(x, y);
    if (orderPress && e.pointerId === orderPress.pointerId) {
      if (
        !orderPress.dragging &&
        Math.hypot(e.clientX - orderPress.screenX, e.clientY - orderPress.screenY) > DRAG_THRESHOLD_PX
      ) {
        orderPress.dragging = true;
      }
      if (orderPress.dragging) {
        const units = latestColonists.filter((c) => selectedIds.has(c.id));
        lineGuide.clear();
        if (units.length > 1 && orderPress.kind) {
          // Strategy mode: the ghost is the very formation the server will form (formation.ts).
          const line = strategyLine(units, orderPress.worldX, orderPress.worldY, x, y, e.altKey);
          const plan = planOrderFormation(units, line.x, line.y, line.facing, line.width);
          for (const pos of plan.targets.values()) drawSlot(lineGuide, pos, 0.7);
          const color = orderPress.kind === "attackMove" ? ORDER_COLORS.attackMove : SELECTION_COLOR;
          lineGuide.moveTo(orderPress.worldX, orderPress.worldY).lineTo(x, y).stroke({ width: 3, color, alpha: 0.85 });
          // Facing arrow off the line's middle.
          const fx = Math.cos(line.facing);
          const fy = Math.sin(line.facing);
          const ex = line.x + fx * 26;
          const ey = line.y + fy * 26;
          lineGuide.moveTo(line.x, line.y).lineTo(ex, ey).stroke({ width: 3, color, alpha: 0.85 });
          lineGuide.poly([ex + fx * 8, ey + fy * 8, ex - fy * 6, ey + fx * 6, ex + fy * 6, ey - fx * 6]).fill({ color, alpha: 0.85 });
        } else if (units.length > 1) {
          const plan = computeLineFormationTargets(units, orderPress.worldX, orderPress.worldY, x, y);
          for (const pos of plan.targets.values()) drawSlot(lineGuide, pos, 0.7);
          lineGuide
            .moveTo(orderPress.worldX, orderPress.worldY)
            .lineTo(x, y)
            .stroke({ width: 3, color: SELECTION_COLOR, alpha: 0.85 });
        }
      }
    }
    if (leftPress && e.pointerId === leftPress.pointerId) {
      if (
        !leftPress.dragging &&
        Math.hypot(e.clientX - leftPress.screenX, e.clientY - leftPress.screenY) > DRAG_THRESHOLD_PX
      ) {
        leftPress.dragging = true;
      }
      if (leftPress.dragging) {
        dragBox.clear();
        dragBox
          .rect(
            Math.min(leftPress.worldX, x),
            Math.min(leftPress.worldY, y),
            Math.abs(x - leftPress.worldX),
            Math.abs(y - leftPress.worldY)
          )
          .fill({ color: SELECTION_COLOR, alpha: 0.12 })
          .stroke({ width: 1.5, color: SELECTION_COLOR });
      }
    }
    cursorHighlight.clear();
    const tile = pointerTile(x, y);
    placementGhost.visible =
      !!tile && ((currentTool === TileType.TownCenter && !!TOWN_CENTER_MARKER_TEXTURE) || isRoadTile(currentTool));
    if (!tile) return;
    placementGhost.position.set(tile.tileX * tileSize + tileSize / 2, tile.tileY * tileSize + tileSize / 2);
    // Multi-tile build tools: a w x h ghost from the hovered (top-left) tile, red when a part tile is taken
    // (placing on the same building upgrades it instead, so that stays white).
    const fp = footprintOf(currentTool);
    const hovered = tiles[tile.tileY * worldTilesX + tile.tileX];
    const upgrading = hovered === currentTool || (hovered === TileType.BuildingPart && (() => {
      const a = anchorOfClient(tile.tileX, tile.tileY);
      return tiles[a.y * worldTilesX + a.x] === currentTool;
    })());
    const blocked = !upgrading && (fp.w > 1 || fp.h > 1) &&
      footprintPartOffsets(fp).some(([dx, dy]) => footTile(tile.tileX + dx, tile.tileY + dy) !== TileType.Empty);
    const ghost = upgrading ? { w: 1, h: 1 } : fp;
    cursorHighlight
      .rect(tile.tileX * tileSize, tile.tileY * tileSize, ghost.w * tileSize, ghost.h * tileSize)
      .stroke({ width: 2, color: blocked ? 0xff5040 : 0xffffff, alpha: blocked ? 0.85 : 0.6 });
  });
}

// Main menu: the game (and its server connection) only starts once Start is pressed. Settings are
// client-only prefs kept in localStorage, plus the Difficulty choice that's sent to the server on
// join. There is ONE settings panel: it lives in the main menu until Start, then moves into the
// in-game #settings-modal (opened by the Settings control button). "Menu" in-game reloads back here.
const DIFFICULTY_PREF_KEY = "sworn.difficulty";
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
// The menu choice: sent as setDifficulty after every welcome, and with an in-game Restart.
let preferredDifficulty: Difficulty = "normal";
// Map size (tiles per side) chosen in the menu; New Game / Restart regenerate the world at it.
const MAP_SIZE_PREF_KEY = "sworn.mapSize";
// Clans: the main menu's Clan choice (sent as the ws URL's `?clan=`): join the clan already playing (clan 0)
// or found a new one. A page URL `?clan=new` / `?clan=<id>` overrides it (e.g. to join clan 2).
let preferredClan: "join" | "new" = "join";
function clanParam(): string {
  const fromPage = new URLSearchParams(location.search).get("clan");
  if (fromPage && /^(new|\d{1,3})$/.test(fromPage)) return fromPage;
  return preferredClan === "new" ? "new" : "";
}
function renderClanChoice() {
  document.querySelectorAll<HTMLButtonElement>("#set-clan button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.clan === preferredClan));
  });
}
const MAP_SIZES = [64, 96, 160, 256, 384, 512, 1024];
// undefined until the player picks one: then the server keeps its own default (COLONY_WORLD_SIZE or 160).
let preferredWorldSize: number | undefined;
function renderMapSizeChoice(value: number | undefined) {
  document.querySelectorAll<HTMLButtonElement>("#set-mapsize button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(Number(btn.dataset.size) === (value ?? 160)));
  });
}
let gameStarted = false;
// The world's active difficulty as the server reports it (null until the first welcome).
let activeDifficulty: Difficulty | null = null;

function renderDifficultyChoice(value: Difficulty) {
  document.querySelectorAll<HTMLButtonElement>("#set-difficulty button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.difficulty === value));
  });
}

// Called from main() on every welcome/snapshot; cheap no-op unless the value changed.
function setActiveDifficulty(value: Difficulty) {
  if (value === activeDifficulty) return;
  activeDifficulty = value;
  document.getElementById("stat-difficulty")!.textContent = `${DIFFICULTY_LABEL[value]} difficulty`;
  if (gameStarted) renderDifficultyChoice(value);
}

const SAVE_SLOT_NAMES: Record<SaveSlot, string> = { autosave: "Autosave", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3", creative: "Creative" };

function describeSave(sv: SaveInfo): string {
  return `${sv.creative ? "Creative · " : ""}Day ${sv.dayIndex + 1} · ${sv.population} pop · ${DIFFICULTY_LABEL[sv.difficulty]}`;
}

// One parchment row per slot: name + day/population/difficulty + when, then its buttons.
function renderSaveRows(
  container: HTMLElement,
  rows: { slot: SaveSlot; info?: SaveInfo; buttons: { label: string; secondary?: boolean; onClick: () => void }[] }[],
  emptyText?: string
) {
  container.replaceChildren();
  if (rows.length === 0 && emptyText) {
    const empty = document.createElement("div");
    empty.className = "save-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "save-row";
    const text = document.createElement("span");
    text.textContent = SAVE_SLOT_NAMES[row.slot];
    const note = document.createElement("small");
    note.textContent = row.info
      ? `${describeSave(row.info)} · ${new Date(row.info.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
      : "Empty";
    text.append(note);
    const btns = document.createElement("span");
    btns.className = "save-btns";
    for (const b of row.buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      if (b.secondary) btn.className = "secondary";
      btn.addEventListener("click", () => {
        btn.blur();
        b.onClick();
      });
      btns.append(btn);
    }
    el.append(text, btns);
    container.append(el);
  }
}

function setupMainMenu() {
  const menu = document.getElementById("main-menu")!;
  const mainPanel = document.getElementById("menu-main")!;
  const settingsPanel = document.getElementById("menu-settings-panel")!;
  const settingsModal = document.getElementById("settings-modal")!;
  const settingsModalScroll = document.getElementById("settings-modal-scroll")!;
  const minimapBox = document.getElementById("set-minimap") as HTMLInputElement;
  const eventsBox = document.getElementById("set-events") as HTMLInputElement;
  const difficultySeg = document.getElementById("set-difficulty")!;
  const difficultyNote = document.getElementById("set-difficulty-note")!;

  const load = (key: string): boolean => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  };
  const save = (key: string, on: boolean) => {
    try {
      localStorage.setItem(key, on ? "on" : "off");
    } catch {
      /* private mode: setting just won't persist */
    }
  };
  const apply = () => {
    document.body.classList.toggle("hide-minimap", !minimapBox.checked);
    document.body.classList.toggle("hide-events", !eventsBox.checked);
  };
  // Sound: sliders/mute edit sound.volumes live (persisted by SoundManager). The AudioContext is
  // created on the first menu click (a user gesture), at the latest on Start.
  const volumeInputs: { el: HTMLInputElement; key: "master" | "music" | "sfx" }[] = [
    { el: document.getElementById("set-vol-master") as HTMLInputElement, key: "master" },
    { el: document.getElementById("set-vol-music") as HTMLInputElement, key: "music" },
    { el: document.getElementById("set-vol-sfx") as HTMLInputElement, key: "sfx" },
  ];
  const muteBox = document.getElementById("set-mute") as HTMLInputElement;
  for (const { el, key } of volumeInputs) {
    el.value = String(Math.round(sound.volumes[key] * 100));
    el.addEventListener("input", () => sound.setVolumes({ [key]: Number(el.value) / 100 }));
    // A sample at the new level once the slider is released.
    if (key !== "music") el.addEventListener("change", () => sound.play("ui_click", { cooldownMs: 0 }));
  }
  muteBox.checked = sound.volumes.muted;
  muteBox.addEventListener("change", () => sound.setVolumes({ muted: muteBox.checked }));
  document.addEventListener(
    "pointerdown",
    () => {
      if (!sound.unlocked) sound.unlock();
    },
    { capture: true }
  );
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, #build-panel-toggle, #economy-panel-toggle")) sound.play("ui_click");
  });

  minimapBox.checked = load("sworn.minimap");
  // Village life phase 5: camera settings (read at page load by readAdventurePrefs, so they apply after a reload).
  const adventureCamBox = document.getElementById("set-adventure-cam") as HTMLInputElement;
  const startStrategyBox = document.getElementById("set-start-strategy") as HTMLInputElement;
  adventureCamBox.checked = load(ADVENTURE_CAM_PREF);
  try {
    startStrategyBox.checked = localStorage.getItem(START_STRATEGY_PREF) === "on";
  } catch {
    startStrategyBox.checked = false;
  }
  adventureCamBox.addEventListener("change", () => save(ADVENTURE_CAM_PREF, adventureCamBox.checked));
  startStrategyBox.addEventListener("change", () => save(START_STRATEGY_PREF, startStrategyBox.checked));
  eventsBox.checked = load("sworn.events");
  apply();
  minimapBox.addEventListener("change", () => {
    save("sworn.minimap", minimapBox.checked);
    apply();
  });
  eventsBox.addEventListener("change", () => {
    save("sworn.events", eventsBox.checked);
    apply();
  });

  try {
    const stored = localStorage.getItem(DIFFICULTY_PREF_KEY);
    if (stored === "easy" || stored === "normal" || stored === "hard") preferredDifficulty = stored;
  } catch {
    /* default stays Normal */
  }
  renderDifficultyChoice(preferredDifficulty);
  try {
    const storedSize = Number(localStorage.getItem(MAP_SIZE_PREF_KEY));
    if (MAP_SIZES.includes(storedSize)) preferredWorldSize = storedSize;
  } catch {
    /* default stays Medium */
  }
  renderMapSizeChoice(preferredWorldSize);
  renderClanChoice();
  document.getElementById("set-clan")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-clan]");
    if (btn?.dataset.clan !== "join" && btn?.dataset.clan !== "new") return;
    preferredClan = btn.dataset.clan;
    renderClanChoice();
  });
  const mapSizeSeg = document.getElementById("set-mapsize")!;
  mapSizeSeg.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-size]");
    const value = Number(btn?.dataset.size);
    if (!MAP_SIZES.includes(value)) return;
    preferredWorldSize = value;
    renderMapSizeChoice(value);
    try {
      localStorage.setItem(MAP_SIZE_PREF_KEY, String(value));
    } catch {
      /* private mode: setting just won't persist */
    }
  });
  difficultySeg.addEventListener("click", (e) => {
    // Read-only once the game is running: the world's difficulty is fixed until a restart.
    if (gameStarted) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-difficulty]");
    const value = btn?.dataset.difficulty;
    if (value !== "easy" && value !== "normal" && value !== "hard") return;
    preferredDifficulty = value;
    renderDifficultyChoice(value);
    try {
      localStorage.setItem(DIFFICULTY_PREF_KEY, value);
    } catch {
      /* private mode: setting just won't persist */
    }
  });

  const closeModal = () => {
    settingsModal.hidden = true;
  };
  const startGame = (loadSlot: SaveSlot | null, creative = preferredCreative, solo = false) => {
    pendingLoadSlot = loadSlot;
    preferredCreative = creative;
    preferredSolo = solo && !creative;
    enforceGameMode = loadSlot === null;
    sound.unlock();
    menu.hidden = true;
    gameStarted = true;
    // Hand the one settings panel over to the in-game modal.
    settingsModalScroll.appendChild(settingsPanel);
    settingsPanel.hidden = false;
    difficultySeg.classList.add("readonly");
    difficultySeg.setAttribute("aria-disabled", "true");
    difficultyNote.textContent = "Fixed for this world; a Restart uses your menu choice";
    document.getElementById("menu-back")!.textContent = "Close";
    if (activeDifficulty) renderDifficultyChoice(activeDifficulty);
    void main();
  };
  // New Game keeps the old Start behaviour (whatever world the server is running, menu difficulty).
  document.getElementById("menu-start")!.addEventListener("click", () => startGame(null));
  // Creative mode: a new creative world (infinite resources, instant build, the Creative panel).
  document.getElementById("menu-creative")!.addEventListener("click", () => startGame(null, true));
  document.getElementById("menu-solo")!.addEventListener("click", () => startGame(null, false, true));
  if (preferredCreative) document.getElementById("menu-start")!.textContent = "New Game (Creative)";
  document.getElementById("menu-continue")!.addEventListener("click", () => startGame("autosave"));
  const loadPanel = document.getElementById("menu-load-panel")!;
  document.getElementById("menu-load")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    loadPanel.hidden = false;
  });
  document.getElementById("menu-load-back")!.addEventListener("click", () => {
    loadPanel.hidden = true;
    mainPanel.hidden = false;
  });
  // Continue / Load Game only show once the server reports saves (silently absent if it's down).
  fetch(SAVES_URL)
    .then((res) => res.json() as Promise<{ saves: SaveInfo[] }>)
    .then(({ saves }) => {
      if (gameStarted) return;
      document.getElementById("menu-continue")!.hidden = !saves.some((sv) => sv.slot === "autosave");
      document.getElementById("menu-load")!.hidden = saves.length === 0;
      renderSaveRows(
        document.getElementById("menu-load-list")!,
        saves.map((sv) => ({
          slot: sv.slot,
          info: sv,
          buttons: [{ label: "Load", onClick: () => startGame(sv.slot) }],
        }))
      );
    })
    .catch(() => {
      /* server unreachable: New Game only */
    });
  document.getElementById("menu-settings")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    settingsPanel.hidden = false;
  });
  document.getElementById("menu-back")!.addEventListener("click", () => {
    if (gameStarted) {
      closeModal();
      return;
    }
    settingsPanel.hidden = true;
    mainPanel.hidden = false;
  });
  document.getElementById("settings-btn")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    settingsModal.hidden = !settingsModal.hidden;
  });
  // Backdrop click or Escape closes; keys typed into the panel (arrows on a slider) don't reach the
  // game's movement/hotkey handlers on window.
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeModal();
  });
  settingsModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    e.stopPropagation();
  });
  // Escape with focus outside the panel (e.g. right after opening it).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.hidden) closeModal();
  });
  document.getElementById("menu-exit")!.addEventListener("click", () => {
    // Browsers only let a script close a tab it opened; otherwise show a goodbye line.
    window.close();
    document.getElementById("menu-bye")!.hidden = false;
  });
  // The Menu button is a dropdown (Restart / Save / Settings / Return to menu). Choosing an item, clicking
  // elsewhere or pressing Escape closes it; "Return to menu" reloads back to the main menu as Menu used to.
  const menuBtn = document.getElementById("menu-btn") as HTMLButtonElement;
  const menuList = document.getElementById("menu-dropdown-list")!;
  const setMenuOpen = (open: boolean) => {
    menuList.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuBtn.blur();
    setMenuOpen(menuList.hidden);
  });
  menuList.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) setMenuOpen(false);
  });
  window.addEventListener("click", (e) => {
    if (!menuList.hidden && !(e.target as HTMLElement).closest("#menu-dropdown")) setMenuOpen(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuList.hidden) setMenuOpen(false);
  });
  document.getElementById("return-menu-btn")!.addEventListener("click", () => location.reload());
}

setupMainMenu();
