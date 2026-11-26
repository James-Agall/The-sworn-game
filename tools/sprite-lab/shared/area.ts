// Area tab model shared by the Lab server, the browser app and the tests: the three template kinds of the game (bandit
// camps, building templates, settlements) on top of the GAME'S OWN shared code (legends, validators, transforms,
// layouts). Nothing here re-implements a game rule: validation, transforms and layout composition call the game's
// functions; this file only adds the editor's bookkeeping (kinds, defaults, file format, error-cell parsing, the
// stamp preview grids assembled from the game's functions, building placement problems for highlighting).
// The browser imports this file through Vite; Node (server, tests) through tsx's tsImport (server/game.ts), because the
// game's shared code uses enums and ".js" import specifiers that plain Node type stripping does not handle.
import { TileType } from "../../../shared/src/protocol.ts";
import {
  CAMP_LEGEND, CAMP_SIZE_MAX, CAMP_SIZE_MIN, type CampEntrance, type CampTemplate, campCells, campRadius, campStats, transformEntrance,
  transformRows, validateCampTemplate,
} from "../../../shared/src/camps.ts";
import {
  BUILDING_LEGEND, BUILDING_SIZE_MAX, BUILDING_SIZE_MIN, BUILDING_TYPES, BUILDING_TYPE_LABEL, type BuildingTemplate, buildingCells,
  buildingDoorSide, buildingPieceTiles, buildingStats, validateBuildingTemplate,
} from "../../../shared/src/buildingTemplates.ts";
import { ROOM_ROLE_LABEL } from "../../../shared/src/rooms.ts";
import {
  type CastleRuinFile, type DataKind, type InteriorFile, type LegendSymbolX, type PoiTemplateFile, type SiteTemplateFile,
  dataGrid, dataLayers, dataLegend, dataLinked, dataNormalise, dataSizeLimits, dataStatsLine, dataUnique, dataValidate, newDataTemplate,
  withDataGrid,
} from "./areaData.ts";
import {
  SETTLEMENT_GUARDS, SETTLEMENT_LEGEND, SETTLEMENT_PROFILES, SETTLEMENT_SIZE_MAX, SETTLEMENT_SIZE_MIN, SETTLEMENT_TIER_LABEL,
  type BuildingLookup, type SettlementTemplate, composeTransforms, settlementLayout, settlementStats, settlementTransforms,
  spriteBuildingCells, transformSettlement, validateSettlementTemplate,
} from "../../../shared/src/settlementTemplates.ts";

export {
  TileType, CAMP_LEGEND, BUILDING_LEGEND, SETTLEMENT_LEGEND, BUILDING_TYPES, BUILDING_TYPE_LABEL, SETTLEMENT_PROFILES, SETTLEMENT_GUARDS,
  SETTLEMENT_TIER_LABEL, transformRows, transformEntrance, transformSettlement, settlementTransforms, settlementLayout, settlementStats,
  composeTransforms, buildingCells, buildingDoorSide, buildingPieceTiles, buildingStats, campCells, campStats, campRadius, spriteBuildingCells,
  ROOM_ROLE_LABEL,
  validateCampTemplate, validateBuildingTemplate, validateSettlementTemplate,
};
export type { CampTemplate, BuildingTemplate, SettlementTemplate, BuildingLookup, CampEntrance };
export * from "./areaData.ts";

/** Stage A kinds (camps, buildings, settlements) and the stage B data kinds (areaData.ts). */
export const GRID_KINDS = ["camps", "buildings", "settlements"] as const;
export type GridKind = (typeof GRID_KINDS)[number];
export const KINDS = ["camps", "buildings", "settlements", "sites", "castle-ruins", "pois", "interiors"] as const;
export type Kind = (typeof KINDS)[number];
/** The kinds with a server/data/<kind>/ store (built-ins read-only + user/); interiors are shared/src/data/interiors. */
export const STORE_KINDS = ["camps", "buildings", "settlements", "sites", "pois", "castle-ruins"] as const;
export const isDataKind = (k: Kind): k is DataKind => !(GRID_KINDS as readonly string[]).includes(k);
export type DataTemplate = SiteTemplateFile | PoiTemplateFile | CastleRuinFile | InteriorFile;
export type AnyTemplate = CampTemplate | BuildingTemplate | SettlementTemplate | DataTemplate;
export const KIND_LABEL: Record<Kind, string> = {
  camps: "Bandit camps", buildings: "Buildings", settlements: "Settlements", sites: "Forts / sites", "castle-ruins": "Castle Ruin",
  pois: "POI pools", interiors: "Interiors",
};
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** Building template roles the game's validator accepts (every RoomRole but the role-less "room"). */
export const BUILDING_ROLES = Object.keys(ROOM_ROLE_LABEL).filter((r) => r !== "room");

export type LegendSymbol = { label: string; color: string; tile?: TileType; slot?: string; guard?: string; kind?: string; cells?: 2 } & Omit<LegendSymbolX, "tile">;
export function legendOf(kind: Kind): Record<string, LegendSymbol> {
  return (kind === "camps" ? CAMP_LEGEND : kind === "buildings" ? BUILDING_LEGEND : kind === "settlements" ? SETTLEMENT_LEGEND : {}) as Record<string, LegendSymbol>;
}
/** The legend of one grid of a document (stage B kinds: the file's own symbols / tiles; a site's tier grid: digits). */
export function legendFor(kind: Kind, t: AnyTemplate, layer: string): Record<string, LegendSymbol> {
  return (isDataKind(kind) ? dataLegend(kind, t, layer) : legendOf(kind)) as Record<string, LegendSymbol>;
}
export function sizeLimits(kind: Kind): [number, number] {
  if (isDataKind(kind)) return dataSizeLimits(kind);
  return kind === "camps" ? [CAMP_SIZE_MIN, CAMP_SIZE_MAX] : kind === "buildings" ? [BUILDING_SIZE_MIN, BUILDING_SIZE_MAX] : [SETTLEMENT_SIZE_MIN, SETTLEMENT_SIZE_MAX];
}
// ---- the grids of a document: "rows" for stage A kinds; areaData.ts for the others (sites rows + tiers, interior layouts)
export function layersOf(kind: Kind, t: AnyTemplate): string[] { return isDataKind(kind) ? dataLayers(kind, t) : ["rows"]; }
/** The grids that resize / turn / select together with `layer` (a site's tiles and tiers). */
export function linkedLayers(kind: Kind, layer: string): string[] { return isDataKind(kind) ? dataLinked(kind, layer) : ["rows"]; }
export function gridOf(kind: Kind, t: AnyTemplate, layer: string): string[] { return isDataKind(kind) ? dataGrid(kind, t, layer) : (t as CampTemplate).rows; }
export function withGrid(kind: Kind, t: AnyTemplate, layer: string, rows: string[]): AnyTemplate {
  return isDataKind(kind) ? withDataGrid(kind, t, layer, rows) : ({ ...t, rows } as AnyTemplate);
}
/** The single-instance symbol the pencil moves (camp hearth, settlement / site keep, castle boss, interior exit / stairs down). */
export function uniqueSymbol(kind: Kind, layer: string): string | undefined {
  return isDataKind(kind) ? dataUnique(kind, layer) : kind === "camps" ? "H" : kind === "settlements" ? "K" : undefined;
}
/** A display name (stage A templates have `name`). */
export const nameOf = (t: AnyTemplate): string => (typeof (t as { name?: unknown }).name === "string" ? (t as { name: string }).name : t.id);
/** The symbol the eraser / "clear" / resize padding uses: open ground. */
export const BLANK = ".";

// ---- the file format: the game stores' normalise() field lists (server/src/camps.ts, buildingTemplates.ts,
// settlementTemplates.ts) and their writer, JSON.stringify(t, null, 2) + "\n". test/area-loader.test.ts saves through
// the game's own store in a scratch folder and requires byte-identical files.
export function normalise(kind: Kind, raw: AnyTemplate): AnyTemplate {
  if (isDataKind(kind)) return dataNormalise(kind, raw) as AnyTemplate;
  if (kind === "camps") {
    const o = raw as CampTemplate;
    return {
      id: o.id, name: o.name, tier: o.tier, weight: o.weight, minStartDist: o.minStartDist, guards: [o.guards[0], o.guards[1]],
      entrance: o.entrance, rotate: o.rotate, mirror: o.mirror, rows: o.rows.slice(),
    };
  }
  if (kind === "buildings") {
    const o = raw as BuildingTemplate;
    return {
      id: o.id, name: o.name, buildingType: o.buildingType, tier: o.tier, doorSide: o.doorSide, rotate: o.rotate, mirror: o.mirror,
      role: o.role, rows: o.rows.slice(),
    };
  }
  const o = raw as SettlementTemplate;
  return {
    id: o.id, name: o.name, tier: o.tier, weight: o.weight, minStartDist: o.minStartDist, profile: o.profile,
    garrison: { ...o.garrison }, rows: o.rows.slice(),
    buildings: o.buildings.map((b) => ({ ref: b.ref, x: b.x, y: b.y, ...(b.transform ? { transform: b.transform } : {}) })),
    rotate: o.rotate !== false, mirror: o.mirror !== false, spriteBuildings: o.spriteBuildings === true,
  };
}
export const formatTemplate = (t: AnyTemplate) => JSON.stringify(t, null, 2) + "\n";

/** The game's validator for the kind (settlements need the building lookup). */
export function validate(kind: Kind, t: unknown, lookup: BuildingLookup): string[] {
  if (isDataKind(kind)) return dataValidate(kind, t);
  if (kind === "camps") return validateCampTemplate(t);
  if (kind === "buildings") return validateBuildingTemplate(t);
  return validateSettlementTemplate(t, lookup);
}

/** A new template, the same defaults as the in-game editors (campEditor.ts, buildingEditor.ts, settlementEditor.ts). */
export function newTemplate(kind: Kind): AnyTemplate {
  if (kind === "interiors") throw new Error("interiors are a fixed set of files: edit one");
  if (isDataKind(kind)) return newDataTemplate(kind) as unknown as AnyTemplate;
  if (kind === "camps") {
    const rows = Array.from({ length: 11 }, () => ".".repeat(11));
    rows[5] = rows[5].slice(0, 5) + "H" + rows[5].slice(6);
    return { id: "my-camp", name: "My camp", tier: 1, weight: 2, minStartDist: 0, guards: [2, 3], entrance: "S", rotate: true, mirror: true, rows };
  }
  if (kind === "buildings") {
    const rows = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => (y === 0 || x === 0 || x === 4 || y === 4 ? "#" : "=")).join(""));
    return { id: "my-house", name: "My house", buildingType: "house", tier: 1, doorSide: "S", rotate: true, mirror: true, role: "bedroom", rows };
  }
  const n = 17, c = n >> 1;
  const rows = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (x === c && y === c ? "K" : x === c && y > c ? "_" : ".")).join(""));
  return { id: "my-hamlet", name: "My hamlet", tier: 1, weight: 0, minStartDist: 0, profile: "hearthmoor", garrison: { townGuard: 2 }, rows, buildings: [], rotate: true, mirror: true };
}

/** A building lookup with the game store's rules: built-ins, then valid user templates whose id is not a built-in's. */
export function makeLookup(builtins: BuildingTemplate[], users: BuildingTemplate[]): BuildingLookup {
  const map = new Map<string, BuildingTemplate>();
  for (const b of builtins) map.set(b.id, b);
  for (const u of users) if (!map.has(u.id) && validateBuildingTemplate(u).length === 0) map.set(u.id, u);
  return (id) => map.get(id);
}

// ---- validation messages -> cells. The game's validators name a cell as "at x,y" (or "yard at x,y", "door at x,y").
export function errorCell(msg: string): { x: number; y: number } | null {
  // the interior validator also says "tile x,y cannot be reached"
  const m = /\bat (\d+),(\d+)\b/.exec(msg) ?? /\btile (\d+),(\d+)\b/.exec(msg);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
/** The building index a settlement message is about ("building 3 (house-hut) ..."), 0-based, or -1. */
export function errorBuilding(msg: string): number {
  const m = /^building (\d+)\b/.exec(msg);
  return m ? Number(m[1]) - 1 : -1;
}

// ---- transforms world-gen may use
/** Camps: pickCampTransform (server/src/camps.ts): quarter turns when `rotate`, the mirror bit when `mirror`. */
export function campTransforms(t: Pick<CampTemplate, "rotate" | "mirror">): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (t.rotate || (k & 3) === 0) && (t.mirror || (k & 4) === 0));
}
/** Buildings: the flags allow these placements (the player's ghost, a settlement's ref transform). */
export function buildingTransforms(t: Pick<BuildingTemplate, "rotate" | "mirror">): number[] {
  return campTransforms(t);
}
export const TRANSFORM_LABEL = ["0", "90", "180", "270", "M", "M+90", "M+180", "M+270"];

/** The footprint a settlement ref of `bt` covers (spriteBuildings settlements: the 3x3 prefab footprint). */
export function refFootprint(bt: BuildingTemplate, transform: number, sprite: boolean): { w: number; h: number } {
  const c = sprite ? spriteBuildingCells(bt) : buildingCells(bt, transform);
  return { w: c.w, h: c.h };
}

export type Placement = { index: number; x: number; y: number; w: number; h: number; ok: boolean; bad: { x: number; y: number }[]; unknown: boolean };
/**
 * Per building ref: its footprint and the cells that make settlementLayout complain (off the grid, on another building,
 * on a ground symbol), for the editor's collision highlight. The verdict itself is settlementLayout's (`errs`).
 */
export function placements(t: Pick<SettlementTemplate, "rows" | "buildings" | "spriteBuildings"> & { id?: string }, lookup: BuildingLookup): Placement[] {
  const h = t.rows.length, w = t.rows[0]?.length ?? 0;
  const owner = new Int16Array(w * h).fill(-1);
  const out: Placement[] = [];
  const roadException = (x: number, y: number, b: { y: number }) =>
    // settlementLayout's exception for district / organic ids: a road on the row under the prefab (y = b.y + 2)
    typeof t.id === "string" && (t.id.endsWith("-district") || /-organic[2345]?$/.test(t.id)) && y === b.y + 2 && ["_", "="].includes(t.rows[y][x]);
  t.buildings.forEach((b, index) => {
    const bt = lookup(b.ref);
    if (!bt) { out.push({ index, x: b.x, y: b.y, w: 1, h: 1, ok: false, bad: [{ x: b.x, y: b.y }], unknown: true }); return; }
    const tf = Math.max(0, Math.min(7, Math.floor(b.transform ?? 0)));
    const fp = refFootprint(bt, tf, !!t.spriteBuildings);
    const bad: { x: number; y: number }[] = [];
    for (let y = b.y; y < b.y + fp.h; y++) for (let x = b.x; x < b.x + fp.w; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) { bad.push({ x, y }); continue; }
      const i = y * w + x;
      if (owner[i] >= 0) bad.push({ x, y });
      else if (t.rows[y][x] !== "." && !roadException(x, y, b)) bad.push({ x, y });
      owner[i] = index;
    }
    const flagsOk = (bt.rotate || (tf & 3) === 0) && (bt.mirror || (tf & 4) === 0);
    out.push({ index, x: b.x, y: b.y, w: fp.w, h: fp.h, ok: bad.length === 0 && flagsOk, bad, unknown: false });
  });
  return out;
}

// ---- STAMP PREVIEW (shared code). Exactly the cells world-gen lays, from the same shared functions the server stamper
// uses: camps campCells(t, transform) around the hearth (server/src/camps.ts stampCamp), settlements
// transformSettlement + settlementLayout (server/src/settlementTemplates.ts generateSettlements / stampSettlement).
export type PreviewCell = { tile: number; owned: boolean; ch: string; building: number; slot?: string; guard?: string };
export type Preview = {
  kind: GridKind; transform: number; w: number; h: number;
  // grid origin in template-local coordinates (camps: the hearth is at (-ox, -oy) + ... see `hearth`)
  cells: PreviewCell[];
  apron: number;
  hearth?: { x: number; y: number };
  keep?: { x: number; y: number } | null;
  entrance?: CampEntrance;
  doorSide?: CampEntrance;
  slots: { kind: string; x: number; y: number; guard?: string }[];
  beds: { x: number; y: number }[];
  footprints: { x: number; y: number; w: number; h: number; ref: string }[];
  stats: Record<string, number | string>;
  // spriteBuildings settlements: each building is ONE prefab tile at the centre of its 3x3 footprint
  prefab?: boolean;
  source: "shared-code";
};

export function campPreview(t: CampTemplate, transform: number): Preview {
  const r = campRadius(t), n = 2 * r + 1;
  const cells: PreviewCell[] = Array.from({ length: n * n }, () => ({ tile: -1, owned: false, ch: ".", building: -1 }));
  const slots: Preview["slots"] = [];
  for (const c of campCells(t, transform)) {
    const x = c.dx + r, y = c.dy + r, s = CAMP_LEGEND[c.ch];
    cells[y * n + x] = { tile: s.tile ?? -1, owned: false, ch: c.ch, building: -1, slot: s.slot, guard: s.guard };
    if (s.slot) slots.push({ kind: s.slot, x, y, guard: s.guard });
  }
  const st = campStats(t);
  return {
    kind: "camps", transform, w: n, h: n, cells, apron: 0, hearth: { x: r, y: r }, entrance: transformEntrance(t.entrance, transform),
    slots, beds: [], footprints: [{ x: 0, y: 0, w: n, h: n, ref: t.id }],
    stats: { radius: r, guardSlots: st.guardSlots, prisonerSlots: st.prisonerSlots, lootSlots: st.lootSlots, guards: `${t.guards[0]}-${Math.min(t.guards[1], st.guardSlots)}` },
    source: "shared-code",
  };
}

export function buildingPreview(t: BuildingTemplate, transform: number): Preview {
  const { w, h, cells: bc } = buildingCells(t, transform);
  const rows = transform ? transformRows(t.rows, transform) : t.rows;
  const cells: PreviewCell[] = Array.from({ length: w * h }, (_, i) => ({ tile: -1, owned: false, ch: rows[Math.floor(i / w)][i % w], building: 0 }));
  const slots: Preview["slots"] = [];
  const beds: Preview["beds"] = [];
  for (const c of bc) {
    const s = BUILDING_LEGEND[c.ch];
    cells[c.y * w + c.x] = { tile: c.tile, owned: false, ch: c.ch, building: 0, slot: s.slot };
    if (s.slot) slots.push({ kind: s.slot, x: c.x, y: c.y });
    if (c.tile === TileType.Bed) beds.push({ x: c.x, y: c.y });
  }
  return { kind: "buildings", transform, w, h, cells, apron: 0, doorSide: buildingDoorSide(t, transform), slots, beds, footprints: [{ x: 0, y: 0, w, h, ref: t.id }], stats: {}, source: "shared-code" };
}

/** stampSettlement's apron rule (server/src/settlementTemplates.ts): 0 for -dense / -district / -organic ids, else 2. */
export function settlementApron(id: string): number {
  return id.endsWith("-dense") || id.endsWith("-district") || /-organic[2345]?$/.test(id) ? 0 : 2;
}

export function settlementPreview(t0: SettlementTemplate, transform: number, lookup: BuildingLookup): Preview {
  const t = transformSettlement(t0, transform, lookup);
  const l = settlementLayout(t, lookup);
  const a = settlementApron(t.id);
  const W = l.w + 2 * a, H = l.h + 2 * a;
  const cells: PreviewCell[] = Array.from({ length: W * H }, () => ({ tile: -1, owned: false, ch: ".", building: -1 }));
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
    const tile = l.tiles[y * l.w + x], ch = t.rows[y][x];
    // stampSettlement: a stamped tile is owned; an empty cell is owned unless it is "." (open ground stays unowned)
    cells[(y + a) * W + x + a] = { tile, owned: tile >= 0 || ch !== ".", ch, building: l.buildingOf[y * l.w + x], slot: SETTLEMENT_LEGEND[ch]?.slot };
  }
  const sh = (p: { x: number; y: number }) => ({ x: p.x + a, y: p.y + a });
  const st = settlementStats(t, lookup);
  return {
    kind: "settlements", transform, w: W, h: H, cells, apron: a, keep: l.keep ? sh(l.keep) : null,
    slots: [...l.slots.map((s) => ({ kind: s.kind, ...sh(s) })), ...l.npcSlots.map((s) => ({ kind: "npc", ...sh(s) }))],
    beds: l.beds.map(sh),
    footprints: t.buildings.map((b) => {
      const bt = lookup(b.ref);
      const fp = bt ? refFootprint(bt, b.transform ?? 0, !!t.spriteBuildings) : { w: 1, h: 1 };
      return { x: b.x + a, y: b.y + a, w: fp.w, h: fp.h, ref: b.ref };
    }),
    stats: { buildings: st.buildings, beds: st.beds, guards: st.guards, trader: st.slots.trader, priest: st.slots.priest, villager: st.slots.villager, guardSlots: st.slots.guard, quest: st.slots.quest },
    prefab: !!t.spriteBuildings, source: "shared-code",
  };
}

export function preview(kind: GridKind, t: AnyTemplate, transform: number, lookup: BuildingLookup): Preview {
  if (kind === "camps") return campPreview(t as CampTemplate, transform);
  if (kind === "buildings") return buildingPreview(t as BuildingTemplate, transform);
  return settlementPreview(t as SettlementTemplate, transform, lookup);
}
/** The transforms world-gen may stamp `t` with (buildings: the placements its flags allow). */
export function previewTransforms(kind: GridKind, t: AnyTemplate, lookup: BuildingLookup): number[] {
  if (kind === "settlements") return settlementTransforms(t as SettlementTemplate, lookup);
  return campTransforms(t as CampTemplate);
}

/** Short stats line for the editor (the game's own stats functions). */
export function statsLine(kind: Kind, t: AnyTemplate, lookup: BuildingLookup): string {
  if (isDataKind(kind)) return dataStatsLine(kind, t);
  try {
    if (kind === "camps") {
      const s = campStats(t as CampTemplate);
      return `${s.w}x${s.h} · radius ${s.radius} · ${s.guardSlots} guard / ${s.prisonerSlots} prisoner / ${s.lootSlots} loot slots`;
    }
    if (kind === "buildings") {
      const s = buildingStats(t as BuildingTemplate);
      return `${s.w}x${s.h} · rooms ${s.rooms.map((r) => r.role).join(" + ") || "none"} · ${s.beds} beds · ${s.workerSlots} worker / ${s.npcSlots} NPC slots`;
    }
    const st = t as SettlementTemplate, s = settlementStats(st, lookup);
    return `${SETTLEMENT_TIER_LABEL[st.tier] ?? "?"} ${s.w}x${s.h} · ${s.buildings} buildings · ${s.beds} beds · trader ${s.slots.trader}, priest ${s.slots.priest}, villager ${s.slots.villager}, guard ${s.slots.guard}, quest ${s.slots.quest} · ${s.guards} guards`;
  } catch (e) {
    return "stats unavailable: " + (e as Error).message;
  }
}
