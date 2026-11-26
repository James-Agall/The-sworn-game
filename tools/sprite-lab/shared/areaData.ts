// Area tab, stage B part 2: the content the game moved from TypeScript to JSON data (STAGE-B-DATA-2026-11-26.md):
// site templates (forts + human-site profiles, kind "sites"), POI pools ("pois"), the Castle Ruin ("castle-ruins") and
// the building interiors ("interiors", shared/src/data/interiors/<id>.json, no user/ layer). As in area.ts, every rule
// is the GAME'S shared code (imported, never re-implemented): validateSiteTemplate / validatePoiTemplate /
// validateCastleRuin / validateInteriorFile / validateInteriorTemplate, the normalise* functions, the legends
// (SITE_TEMPLATE_TILES + a file's own `symbols`, the castle file's `tiles`, INTERIOR_LEGEND) and buildInteriorMap.
// This file adds the editor's bookkeeping only: which grids a document has, swatch colours, defaults for "New".
import { MOB_ROLE, TileType } from "../../../shared/src/protocol.ts";
import {
  HUMAN_SITE_SYMBOLS, SITE_FACTIONS, SITE_MAX_TIER, SITE_RESOURCE_KEYS, SITE_SIZE_MAX, SITE_TEMPLATE_TILES, SITE_WORKER_ROLES,
  type SiteTemplateFile, normaliseSiteTemplateFile, validateSiteTemplate,
} from "../../../shared/src/siteTemplates.ts";
import {
  CASTLE_RUIN_SIZE_MAX, CASTLE_RUIN_SIZE_MIN, POI_FOOTPRINT_RADIUS_MAX, type CastleRuinFile, type PoiTemplateFile, type WeightedKind,
  normaliseCastleRuinFile, normalisePoiTemplateFile, poiTileByName, validateCastleRuin, validatePoiTemplate,
} from "../../../shared/src/poiTemplates.ts";
import {
  BUILDING_INTERIOR_IDS, HALL_REQUIRED_PROPS, INTERIOR_LEGEND, INTERIOR_TEMPLATES, INTERIOR_UPPER_TEMPLATES, INTERIOR_VARIANTS,
  type BuildingInteriorId, type InteriorFile, type InteriorLayoutFile, type InteriorMap, type InteriorProp, type InteriorTemplate,
  buildInteriorMap, interiorVariantFor, normaliseInteriorFile, validateInteriorFile, validateInteriorTemplate,
} from "../../../shared/src/interiors.ts";

export {
  SITE_TEMPLATE_TILES, HUMAN_SITE_SYMBOLS, SITE_FACTIONS, SITE_WORKER_ROLES, SITE_RESOURCE_KEYS, SITE_MAX_TIER, SITE_SIZE_MAX,
  CASTLE_RUIN_SIZE_MIN, CASTLE_RUIN_SIZE_MAX, POI_FOOTPRINT_RADIUS_MAX, BUILDING_INTERIOR_IDS, HALL_REQUIRED_PROPS, INTERIOR_LEGEND,
  INTERIOR_VARIANTS, buildInteriorMap, interiorVariantFor, poiTileByName,
  validateSiteTemplate, validatePoiTemplate, validateCastleRuin, validateInteriorFile, validateInteriorTemplate,
  normaliseSiteTemplateFile, normalisePoiTemplateFile, normaliseCastleRuinFile, normaliseInteriorFile,
};
export type { SiteTemplateFile, PoiTemplateFile, CastleRuinFile, WeightedKind, InteriorFile, InteriorLayoutFile, InteriorMap, InteriorProp, BuildingInteriorId };

/**
 * The mob kinds the game's validators accept (the server passes Object.keys(MOB_KIND_CONFIG)). The browser cannot import
 * server constants, so the Lab uses the keys of shared MOB_ROLE (also a Record<MobKind, ...>, so the same key set);
 * test/area-data.test.ts asserts the two lists are equal.
 */
export const MOB_KINDS: string[] = Object.keys(MOB_ROLE);
export const mobOpts = { mobKinds: MOB_KINDS } as const;
/** Every TileType name (what the files store in `symbols` / `tiles` / the POI pools). */
export const TILE_NAMES: string[] = Object.keys(TileType).filter((k) => Number.isNaN(Number(k)) && typeof (TileType as unknown as Record<string, unknown>)[k] === "number");
export const tileByName = (n: string): number | undefined => poiTileByName(n);

// ---- swatch colours (the editor's; not game data)
const HUES = ["#c0703a", "#6f8fc0", "#c0b040", "#8a5ac0", "#40a080", "#c04a6a", "#5a9a40", "#a07850", "#4a8ab0", "#b06030"];
export const swatchFor = (key: string) => HUES[[...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];
export const TIER_COLOR = ["#888", "#3fae5a", "#3f8fd8", "#d8a23f", "#d8503f"];

export type LegendSymbolX = {
  label: string; color: string; tile?: number; slot?: string; prop?: InteriorProp; npc?: string; minLevel?: number; tier?: number;
};

// ---- sites: the legend is SITE_TEMPLATE_TILES with the file's own `symbols` on top (validateSiteTemplate's rule)
export function siteLegend(t: Pick<SiteTemplateFile, "symbols">): Record<string, LegendSymbolX> {
  const out: Record<string, LegendSymbolX> = { ".": { label: "Open ground", color: "#4d6338" } };
  const own = t.symbols && typeof t.symbols === "object" ? t.symbols : {};
  for (const [c, tile] of Object.entries(SITE_TEMPLATE_TILES)) if (!(c in own)) out[c] = { label: TileType[tile] + (c === "K" ? " (the keep: exactly one)" : ""), color: swatchFor(c), tile };
  for (const [c, name] of Object.entries(own)) {
    const tile = tileByName(String(name));
    out[c] = { label: `${name} (own symbol)${c === "K" ? " (the keep)" : ""}`, color: swatchFor(c), tile };
  }
  return out;
}
export function tierLegend(maxTier: number): Record<string, LegendSymbolX> {
  const out: Record<string, LegendSymbolX> = { ".": { label: "Open ground (\".\" cells)", color: "#4d6338" } };
  const n = Math.max(1, Math.min(SITE_MAX_TIER, Math.floor(maxTier) || 1));
  for (let k = 1; k <= n; k++) out[String(k)] = { label: `Joins at tier ${k}`, color: TIER_COLOR[k], tier: k };
  return out;
}

// ---- castle ruin: "." open ground, "B" the boss's spot, the file's `tiles`
export function castleLegend(t: Pick<CastleRuinFile, "tiles">): Record<string, LegendSymbolX> {
  const out: Record<string, LegendSymbolX> = { ".": { label: "Open ground", color: "#4d6338" }, B: { label: "Boss spot (exactly one, the centre)", color: "#c02020", slot: "boss" } };
  for (const [c, name] of Object.entries(t.tiles && typeof t.tiles === "object" ? t.tiles : {})) out[c] = { label: String(name), color: swatchFor(c), tile: tileByName(String(name)) };
  return out;
}

// ---- interiors: INTERIOR_LEGEND (+ " " nothing). Swatch colours by role.
const NPC_COLOR: Record<string, string> = { "1": "#2060c0", "2": "#a040c0", v: "#20a060" };
export function interiorLegend(): Record<string, LegendSymbolX> {
  const out: Record<string, LegendSymbolX> = {};
  for (const [c, s] of Object.entries(INTERIOR_LEGEND)) {
    out[c] = {
      label: s.label + (s.minLevel && !/level/i.test(s.label) ? ` (level ${s.minLevel}+)` : ""), prop: s.prop, npc: s.npc, minLevel: s.minLevel,
      color: s.npc ? NPC_COLOR[s.npc] ?? "#20a060" : c === "#" ? "#3a2a1c" : c === "." ? "#8f5f30" : c === "E" ? "#e0c040" : swatchFor(s.prop ?? c),
      slot: s.npc ? "npc" : undefined,
    };
  }
  out[" "] = { label: "Nothing (outside the room)", color: "#000000" };
  return out;
}
/** The props a layout can hold (the legend's), for the "required stations" editor. */
export const INTERIOR_PROPS: InteriorProp[] = [...new Set(Object.values(INTERIOR_LEGEND).map((s) => s.prop).filter((p): p is InteriorProp => !!p))];

// ---- the grids of a document ("layers"). Sites: the tile grid and the same-size tier grid (they move together);
// interiors: one grid per layout (variants v0..vN, the upper floor), each on its own; the others: their rows.
export type DataKind = "sites" | "pois" | "castle-ruins" | "interiors";
export function dataLayers(kind: DataKind, t: unknown): string[] {
  if (kind === "sites") return ["rows", "tiers"];
  if (kind === "pois") return [];
  if (kind === "castle-ruins") return ["rows"];
  const f = t as InteriorFile;
  return [...(Array.isArray(f.variants) ? f.variants.map((_, i) => "v" + i) : []), ...(f.upper ? ["upper"] : [])];
}
export function dataLinked(kind: DataKind, layer: string): string[] {
  return kind === "sites" ? ["rows", "tiers"] : [layer];
}
export function interiorLayout(f: InteriorFile, layer: string): InteriorLayoutFile | undefined {
  if (layer === "upper") return f.upper;
  const m = /^v(\d+)$/.exec(layer);
  return m ? f.variants?.[Number(m[1])] : undefined;
}
export function dataGrid(kind: DataKind, t: unknown, layer: string): string[] {
  if (kind === "interiors") return interiorLayout(t as InteriorFile, layer)?.rows ?? [];
  const o = t as Record<string, unknown>;
  const g = o[layer === "tiers" ? "tiers" : "rows"];
  return Array.isArray(g) ? (g as string[]) : [];
}
export function withDataGrid<T>(kind: DataKind, t: T, layer: string, rows: string[]): T {
  if (kind === "interiors") {
    const f = t as unknown as InteriorFile;
    if (layer === "upper") return { ...f, upper: { ...f.upper!, rows } } as unknown as T;
    const i = Number(layer.slice(1));
    return { ...f, variants: f.variants.map((l, k) => (k === i ? { ...l, rows } : l)) } as unknown as T;
  }
  return { ...t, [layer === "tiers" ? "tiers" : "rows"]: rows } as T;
}
export function dataLegend(kind: DataKind, t: unknown, layer: string): Record<string, LegendSymbolX> {
  if (kind === "sites") return layer === "tiers" ? tierLegend((t as SiteTemplateFile).maxTier) : siteLegend(t as SiteTemplateFile);
  if (kind === "castle-ruins") return castleLegend(t as CastleRuinFile);
  if (kind === "interiors") return interiorLegend();
  return {};
}
/** The one-per-grid symbol the pencil MOVES instead of adding (the validators want exactly one). */
export function dataUnique(kind: DataKind, layer: string): string | undefined {
  if (kind === "sites") return layer === "rows" ? "K" : undefined;
  if (kind === "castle-ruins") return "B";
  if (kind === "interiors") return layer === "upper" ? "D" : "E";
  return undefined;
}
export function dataSizeLimits(kind: DataKind): [number, number] {
  if (kind === "sites") return [1, SITE_SIZE_MAX];
  if (kind === "castle-ruins") return [CASTLE_RUIN_SIZE_MIN, CASTLE_RUIN_SIZE_MAX];
  return [4, 40];
}

// ---- validate / normalise / format: the game's
export function dataValidate(kind: DataKind, t: unknown): string[] {
  if (kind === "sites") return validateSiteTemplate(t, mobOpts);
  if (kind === "pois") return validatePoiTemplate(t, mobOpts);
  if (kind === "castle-ruins") return validateCastleRuin(t, mobOpts);
  return validateInteriorFile(t);
}
export function dataNormalise(kind: DataKind, t: unknown): unknown {
  if (kind === "sites") return normaliseSiteTemplateFile(t as SiteTemplateFile);
  if (kind === "pois") return normalisePoiTemplateFile(t as PoiTemplateFile);
  if (kind === "castle-ruins") return normaliseCastleRuinFile(t as CastleRuinFile);
  return normaliseInteriorFile(t as InteriorFile);
}

/** One interior layout as the game's InteriorTemplate (the shape interiors.ts builds from a file's layout). */
export const layoutTemplate = (id: BuildingInteriorId, l: InteriorLayoutFile): InteriorTemplate => ({ id, label: l.label, floor: l.floor, wall: l.wall, rows: l.rows.slice() });
/** The game's validateInteriorTemplate for one layout of a file, with the file's own stations / upper floor. */
export function interiorLayoutErrors(f: InteriorFile, layer: string): string[] {
  const l = interiorLayout(f, layer);
  if (!l || !Array.isArray(l.rows) || l.rows.some((r) => typeof r !== "string")) return ["no such layout"];
  return validateInteriorTemplate(layoutTemplate(f.id, l), layer === "upper", { required: Array.isArray(f.required) ? f.required : [], hasUpper: !!f.upper });
}

/**
 * The interior map the GAME builds for this file: buildInteriorMap(id, level, variant, storey) itself, run with the
 * file's layouts in place of the loaded ones (INTERIOR_TEMPLATES[id] / INTERIOR_UPPER_TEMPLATES[id] are swapped for the
 * call and restored right after, synchronously: buildInteriorMap reads those tables; its builder is private).
 */
export function interiorPreviewMap(f: InteriorFile, layer: string, level: number): InteriorMap {
  const id = f.id;
  const T = INTERIOR_TEMPLATES as Record<string, InteriorTemplate[]>;
  const U = INTERIOR_UPPER_TEMPLATES as Record<string, InteriorTemplate | undefined>;
  const oldT = T[id], hadU = Object.prototype.hasOwnProperty.call(U, id), oldU = U[id];
  T[id] = f.variants.map((l) => layoutTemplate(id, l));
  if (f.upper) U[id] = layoutTemplate(id, f.upper); else delete U[id];
  try {
    return layer === "upper" ? buildInteriorMap(id, level, 0, 1) : buildInteriorMap(id, level, Number(layer.slice(1)) || 0, 0);
  } finally {
    T[id] = oldT;
    if (hadU) U[id] = oldU; else delete U[id];
  }
}

// ---- metadata for lists / stats
export function dataEntryName(kind: DataKind, raw: unknown): string {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (kind === "sites") {
    const names = Array.isArray(o.names) ? o.names : [];
    return `${names[0] ?? o.id}${o.label ? " " + o.label : ""} (${o.faction})`;
  }
  if (kind === "pois") return `${o.id} pool`;
  if (kind === "castle-ruins") return `Castle Ruin ${o.id}`;
  return String(o.id);
}
export function dataStatsLine(kind: DataKind, t: unknown): string {
  try {
    if (kind === "sites") {
      const s = t as SiteTemplateFile, g = Object.values(s.garrison ?? {}).reduce((a, b) => a + b, 0);
      return `${s.rows[0]?.length ?? 0}x${s.rows.length} · ${s.faction} · tiers ${s.startTier}..${s.maxTier} · garrison ${g} · ${s.names?.length ?? 0} names`;
    }
    if (kind === "pois") {
      const p = t as PoiTemplateFile;
      return `${p.centerpieces.length} centrepieces · ${p.extras.length} extras (${p.extraCount[0]}-${p.extraCount[1]}) · guardians ${p.guardianCount[0]}-${p.guardianCount[1]} · radius ${p.footprintRadius}`;
    }
    if (kind === "castle-ruins") {
      const c = t as CastleRuinFile, n = c.rows.length, r = Math.floor(n / 2);
      return `${n}x${n} · radius ${r}, grounds ${r + 1} · boss ${c.boss} · guardians ${c.guardians[0]}-${c.guardians[1]} · spawn ${c.spawnDistFractions.join(" / ")} of the map width`;
    }
    const f = t as InteriorFile;
    return `${f.id} · ${f.variants.length} variants${f.upper ? " + upstairs" : ""} · required ${f.required.join(", ")} · ${f.sleep ? "your own one is a bed you sleep in" : "no sleeping"}`;
  } catch (e) {
    return "stats unavailable: " + (e as Error).message;
  }
}

// ---- "New" (sites / POIs / castle ruins; interiors are a fixed set of files)
export function newDataTemplate(kind: Exclude<DataKind, "interiors">): Record<string, unknown> {
  if (kind === "sites") {
    const rows = ["###G###", "#.....#", "#.H.H.#", "#..K..#", "#.s.C.#", "#.....#", "#######"];
    return {
      id: "my-fort", faction: "bandit", label: "Palisade", names: ["Newmoor"], rows, tiers: rows.map((r) => r.replace(/[^.]/g, "1")), maxTier: 1, startTier: 1,
      garrison: { banditClubman: 2 }, stock: { gold: 20 }, rebuildCost: { wood: 40 },
    };
  }
  if (kind === "pois") {
    return { id: "my-ruin", centerpieces: ["RuinWall1"], extras: ["RuinRubble"], extraCount: [0, 2], guardianCount: [1, 2], guardians: [{ kind: "skeleton", weight: 1 }], footprintRadius: 2 };
  }
  const rows = ["1111.1111", "1.......1", "1.......1", "1.......1", "....B....", "1.......1", "1.......1", "1.......1", "1111.1111"];
  return { id: "my-castle-ruin", rows, tiles: { "1": "RuinWall1" }, boss: "ogre", spawnDistFractions: [0.4, 0.25], guardians: [4, 6], guardianWeights: [{ kind: "skeleton", weight: 1 }] };
}

/** World-gen use of each kind's files (shown in the UI and the README): what the game does with a USER file today. */
export const WORLDGEN_NOTE: Record<Exclude<DataKind, "interiors">, string> = {
  sites: "User site templates load at boot (server/src/siteTemplates.ts: SITE_TEMPLATES) and can be stamped from the creative editor / the stampSite test hook, "
    + "but world-gen does NOT place them yet: generateForts names its ids (grakkar, thornwick) and a settlement's `profile` is the closed list hearthmoor / ironhold / riverwatch.",
  pois: "User POI pools load and validate at boot (server/src/poiTemplates.ts: poiTemplateFiles), but world-gen does NOT use them: placePoiSite reads only the built-in "
    + "\"ruin\" pool (RUIN_POI); for \"encampment\" it stamps a tier-1 camp template instead of the pool (the encampment pool's extras are still the camp-hearth burnable tiles, hearths.ts).",
  "castle-ruins": "User Castle Ruin files load and validate at boot (server/src/poiTemplates.ts: castleRuinFiles), but world-gen does NOT use them: placeCastleRuin reads only the built-in \"castle-ruin\".",
};
