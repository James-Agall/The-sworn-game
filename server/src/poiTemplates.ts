// poiTemplates.ts: the stores of the scattered POI pools (server/data/pois/<id>.json) and the Castle Ruin
// (server/data/castle-ruins/<id>.json); format and validators in shared/src/poiTemplates.ts. Built-ins are read-only
// and loaded when this module loads (a broken one throws, i.e. fails the boot); user files (server/data/<kind>/user/,
// COLONY_TEST_HOOKS=1: a <kind>-user folder in COLONY_SAVE_DIR; COLONY_POI_USER_DIR / COLONY_CASTLE_RUIN_USER_DIR
// override) load at boot by the templateStore rules (an id equal to a built-in's is skipped). World-gen uses the
// built-in ids "ruin" / "encampment" (placePoiSite) and "castle-ruin" (placeCastleRuin) only, through the tables
// below (the names they had as constants). Their ORDER is part of the world: world-gen draws on the seeded stream.
import type { MobKind } from "@colony/shared/protocol";
import { TileType } from "@colony/shared/protocol";
import {
  type CastleRuinFile, type PoiTemplateFile, normaliseCastleRuinFile, normalisePoiTemplateFile, poiTileByName,
  validateCastleRuin, validatePoiTemplate,
} from "@colony/shared/poiTemplates";
import { MOB_KIND_CONFIG } from "./constants.js";
import { makeTemplateStore } from "./templateStore.js";

const mobKinds = () => Object.keys(MOB_KIND_CONFIG);
const poiStore = makeTemplateStore<PoiTemplateFile>({
  kind: "pois",
  userEnv: "COLONY_POI_USER_DIR",
  validate: (raw) => validatePoiTemplate(raw, { mobKinds: mobKinds() }),
  normalise: normalisePoiTemplateFile,
});
const castleStore = makeTemplateStore<CastleRuinFile>({
  kind: "castle-ruins",
  userEnv: "COLONY_CASTLE_RUIN_USER_DIR",
  validate: (raw) => validateCastleRuin(raw, { mobKinds: mobKinds() }),
  normalise: normaliseCastleRuinFile,
});

function builtin<T extends { id: string; builtin?: boolean }>(all: T[], id: string, kind: string): T {
  const t = all.find((f) => f.id === id && f.builtin);
  if (!t) throw new Error(`${kind}: missing built-in server/data/${kind}/${id}.json`);
  return t;
}
const tiles = (names: string[]) => names.map((n) => poiTileByName(n)!);
const weighted = (list: { kind: string; weight: number }[]) => list.map((g) => ({ kind: g.kind as MobKind, weight: g.weight }));

// The game's form of a POI pool (TileType numbers, MobKind weights).
export interface PoiTemplate {
  id: string;
  centerpieces: TileType[];
  extras: TileType[];
  extraCount: [number, number];
  guardianCount: [number, number];
  guardians: { kind: MobKind; weight: number }[];
  footprintRadius: number;
}
const poiFromFile = (f: PoiTemplateFile): PoiTemplate => ({
  id: f.id, centerpieces: tiles(f.centerpieces), extras: tiles(f.extras), extraCount: [f.extraCount[0], f.extraCount[1]],
  guardianCount: [f.guardianCount[0], f.guardianCount[1]], guardians: weighted(f.guardians), footprintRadius: f.footprintRadius,
});

const pois = poiStore.all();
export const RUIN_POI: PoiTemplate = poiFromFile(builtin(pois, "ruin", "pois"));
export const ENCAMPMENT_POI: PoiTemplate = poiFromFile(builtin(pois, "encampment", "pois"));
// The old constants' names (constants.ts before Stage B).
export const RUIN_CENTERPIECES = RUIN_POI.centerpieces;
export const RUIN_EXTRAS = RUIN_POI.extras;
export const ENCAMPMENT_EXTRAS = ENCAMPMENT_POI.extras;
// Skeleton is the most thematic ruin guardian: 60% skeleton, 20% darkShaman, 20% orc.
export const RUIN_GUARDIAN_WEIGHTS = RUIN_POI.guardians;
// Clubman is the rank-and-file guard, Archer the support, Elite a rare mini-boss.
export const ENCAMPMENT_GUARDIAN_WEIGHTS = ENCAMPMENT_POI.guardians;

// The Castle Ruin: exactly one per world, placed as far from the starting Town Center as world-gen can manage. Gaps in
// the middle of each wall let units in and out. Its guardians stand inside, dormant; the boss (the Ogre Warlord) holds
// the centre ("B").
const castle = builtin(castleStore.all(), "castle-ruin", "castle-ruins");
export const CASTLE_RUIN_LAYOUT: string[] = castle.rows.slice();
export const CASTLE_RUIN_LAYOUT_TILES: Record<string, TileType> = Object.fromEntries(Object.entries(castle.tiles).map(([c, n]) => [c, poiTileByName(n)!]));
export const CASTLE_RUIN_BOSS_KIND = castle.boss as MobKind;
export const CASTLE_RUIN_FOOTPRINT_RADIUS = Math.floor(CASTLE_RUIN_LAYOUT.length / 2);
// The footprint plus a one-tile apron kept clear (like the Abbey's), so the gates are never blocked.
export const CASTLE_RUIN_GROUNDS_RADIUS = CASTLE_RUIN_FOOTPRINT_RADIUS + 1;
// Preferred minimum distances from the Town Center, as fractions of the map width, tried in order (a crowded or small
// map falls back to the next); last resort is just clear of the spawn area.
export const CASTLE_RUIN_SPAWN_DIST_FRACTIONS: number[] = castle.spawnDistFractions.slice();
export const CASTLE_RUIN_GUARDIANS_MIN = castle.guardians[0];
export const CASTLE_RUIN_GUARDIANS_MAX = castle.guardians[1];
// Ruin-weighted, with heavier hitters than an ordinary ruin.
export const CASTLE_RUIN_GUARDIAN_WEIGHTS = weighted(castle.guardianWeights);

// Boot: reload and validate both stores (user files are listed for editors; world-gen keeps the built-ins above).
export function loadPoiTemplates() {
  const a = poiStore.load();
  const b = castleStore.load();
  console.log(`[pois] ${a.builtins} built-in + ${a.users} user POI pools, ${b.builtins} built-in + ${b.users} user castle ruins`);
}
export const poiTemplateFiles = () => poiStore.all();
export const castleRuinFiles = () => castleStore.all();
export const saveUserPoiTemplate = (raw: unknown) => poiStore.save(raw);
export const deleteUserPoiTemplate = (id: string) => poiStore.remove(id);
export const saveUserCastleRuin = (raw: unknown) => castleStore.save(raw);
export const deleteUserCastleRuin = (id: string) => castleStore.remove(id);
export const userPoiDir = () => poiStore.userDir();
export const userCastleRuinDir = () => castleStore.userDir();
