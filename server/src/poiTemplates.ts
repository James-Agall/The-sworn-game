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
  type PoiTemplateFile, normalisePoiTemplateFile, poiTileByName, validatePoiTemplate,
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

// Boot: reload and validate the store (user files are listed for editors; world-gen keeps the built-ins above).
export function loadPoiTemplates() {
  const a = poiStore.load();
  console.log(`[pois] ${a.builtins} built-in + ${a.users} user POI pools`);
}
export const poiTemplateFiles = () => poiStore.all();
export const saveUserPoiTemplate = (raw: unknown) => poiStore.save(raw);
export const deleteUserPoiTemplate = (id: string) => poiStore.remove(id);
export const userPoiDir = () => poiStore.userDir();
