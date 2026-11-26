// poiTemplates.ts: world-gen inputs of the scattered points of interest (ruins, the old non-template encampment) and
// of the Castle Ruin, as data (Stage B, 2026-11-26). Shared by the server (server/src/poiTemplates.ts: store + the
// world-gen placers placePoiSite / placeCastleRuin) and the Sprite Lab's editor. Built-ins: server/data/pois/<id>.json
// and server/data/castle-ruins/<id>.json (read-only); user files in their user/ folders load at boot (world-gen reads
// only the built-in ids "ruin", "encampment" and "castle-ruin"). Tiles are TileType NAMES in the files.
// World-gen draws on the seeded Math.random in a fixed order, so the ORDER of every list here is part of the world:
// reordering a pool changes the worlds of every seed.
import { TileType } from "./protocol.js";

export interface WeightedKind {
  kind: string;
  weight: number;
}

// A scattered POI site (placePoiSite): a centrepiece tile (one of `centerpieces`; with exactly one no random draw is
// made), extraCount [min, max] extra decorations from `extras` on the centre's 8 neighbours, then guardianCount
// [min, max] dormant guardians (weighted by `guardians`) on free tiles next to the decorations within
// footprintRadius (Chebyshev) of the centre.
export interface PoiTemplateFile {
  id: string;
  centerpieces: string[];
  extras: string[];
  extraCount: [number, number];
  guardianCount: [number, number];
  guardians: WeightedKind[];
  footprintRadius: number;
  builtin?: boolean;
}

// The Castle Ruin (placeCastleRuin): a square, odd-sized ASCII grid around its centre; `tiles` maps a symbol to a
// TileType name, "." is open ground (guardians stand on the inner "." cells, not in the outer ring's gaps), "B" the
// boss's spot (exactly one, the centre; the boss spawns there). spawnDistFractions: the preferred minimum distances
// from the Town Center as fractions of the map width, tried in order; guardians [min, max] weighted by
// guardianWeights.
export interface CastleRuinFile {
  id: string;
  rows: string[];
  tiles: Record<string, string>;
  boss: string;
  spawnDistFractions: number[];
  guardians: [number, number];
  guardianWeights: WeightedKind[];
  builtin?: boolean;
}

export const POI_FOOTPRINT_RADIUS_MAX = 2;
export const CASTLE_RUIN_SIZE_MIN = 5;
export const CASTLE_RUIN_SIZE_MAX = 15;

export function poiTileByName(name: unknown): TileType | undefined {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(TileType, name) && typeof (TileType as unknown as Record<string, unknown>)[name] === "number"
    ? (TileType as unknown as Record<string, TileType>)[name]
    : undefined;
}

export function normalisePoiTemplateFile(o: PoiTemplateFile): PoiTemplateFile {
  return {
    id: o.id, centerpieces: o.centerpieces.slice(), extras: o.extras.slice(), extraCount: [o.extraCount[0], o.extraCount[1]],
    guardianCount: [o.guardianCount[0], o.guardianCount[1]], guardians: o.guardians.map((g) => ({ kind: g.kind, weight: g.weight })),
    footprintRadius: o.footprintRadius,
  };
}

export function normaliseCastleRuinFile(o: CastleRuinFile): CastleRuinFile {
  return {
    id: o.id, rows: o.rows.slice(), tiles: { ...o.tiles }, boss: o.boss, spawnDistFractions: o.spawnDistFractions.slice(),
    guardians: [o.guardians[0], o.guardians[1]], guardianWeights: o.guardianWeights.map((g) => ({ kind: g.kind, weight: g.weight })),
  };
}

const idOk = (id: unknown) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(id);
const rangeOk = (r: unknown, lo: number, hi: number) =>
  Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= lo && r[0] <= r[1] && r[1] <= hi;
const tileList = (v: unknown, what: string, errs: string[], min: number) => {
  if (!Array.isArray(v) || v.length < min || v.length > 16) return void errs.push(`${what}: a list of ${min}-16 tile names`);
  for (const n of v) if (poiTileByName(n) === undefined) errs.push(`${what}: unknown tile "${String(n)}"`);
};
const weights = (v: unknown, what: string, mobKinds: readonly string[] | undefined, errs: string[]) => {
  if (!Array.isArray(v) || v.length === 0) return void errs.push(`${what}: a list of { kind, weight }`);
  for (const g of v as Partial<WeightedKind>[]) {
    if (!g || typeof g.kind !== "string" || (mobKinds && !mobKinds.includes(g.kind))) errs.push(`${what}: unknown kind "${String(g?.kind)}"`);
    if (!g || typeof g.weight !== "number" || !(g.weight > 0 && g.weight <= 1000)) errs.push(`${what}: weight of "${String(g?.kind)}" must be > 0`);
  }
};

// Every problem with a POI file (empty: valid). `mobKinds`: the server's mob kinds (guardian kinds).
export function validatePoiTemplate(raw: unknown, opts: { mobKinds?: readonly string[] } = {}): string[] {
  const errs: string[] = [];
  const o = raw as Partial<PoiTemplateFile> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["not an object"];
  if (!idOk(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  tileList(o.centerpieces, "centerpieces", errs, 1);
  tileList(o.extras, "extras", errs, 1);
  if (!rangeOk(o.extraCount, 0, 8)) errs.push("extraCount: [min, max], 0 <= min <= max <= 8 (the centre's neighbours)");
  if (!rangeOk(o.guardianCount, 0, 24)) errs.push("guardianCount: [min, max], 0 <= min <= max <= 24");
  weights(o.guardians, "guardians", opts.mobKinds, errs);
  if (!Number.isInteger(o.footprintRadius) || o.footprintRadius! < 1 || o.footprintRadius! > POI_FOOTPRINT_RADIUS_MAX) {
    errs.push(`footprintRadius: 1-${POI_FOOTPRINT_RADIUS_MAX} (world-gen keeps that much ground clear around a POI)`);
  }
  return errs;
}

// Every problem with a Castle Ruin file (empty: valid).
export function validateCastleRuin(raw: unknown, opts: { mobKinds?: readonly string[] } = {}): string[] {
  const errs: string[] = [];
  const o = raw as Partial<CastleRuinFile> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["not an object"];
  if (!idOk(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  const tiles = o.tiles;
  if (!tiles || typeof tiles !== "object" || Array.isArray(tiles)) errs.push("tiles: an object of symbol -> tile name");
  else for (const [c, name] of Object.entries(tiles)) {
    if ([...c].length !== 1 || c === "." || c === "B") errs.push(`tiles: "${c}" is not a symbol character (other than "." and "B")`);
    if (poiTileByName(name) === undefined) errs.push(`tiles.${c}: unknown tile "${String(name)}"`);
  }
  if (typeof o.boss !== "string" || (opts.mobKinds && !opts.mobKinds.includes(o.boss))) errs.push(`boss: unknown kind "${String(o.boss)}"`);
  const f = o.spawnDistFractions;
  if (!Array.isArray(f) || f.length === 0 || f.length > 8 || f.some((x) => typeof x !== "number" || !(x > 0 && x < 1))) errs.push("spawnDistFractions: 1-8 fractions of the map width, each in (0, 1)");
  if (!rangeOk(o.guardians, 0, 48)) errs.push("guardians: [min, max], 0 <= min <= max <= 48");
  weights(o.guardianWeights, "guardianWeights", opts.mobKinds, errs);
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) return [...errs, "rows: a list of strings"];
  const n = rows.length;
  if (n < CASTLE_RUIN_SIZE_MIN || n > CASTLE_RUIN_SIZE_MAX || n % 2 === 0) errs.push(`size: square and odd, ${CASTLE_RUIN_SIZE_MIN}-${CASTLE_RUIN_SIZE_MAX} (is ${n} rows)`);
  let bosses = 0;
  for (let y = 0; y < n; y++) {
    if (rows[y].length !== n) {
      errs.push(`row ${y}: ${rows[y].length} wide, not ${n} (square)`);
      continue;
    }
    for (let x = 0; x < n; x++) {
      const c = rows[y][x];
      if (c === "B") {
        bosses++;
        if (x !== (n >> 1) || y !== (n >> 1)) errs.push(`the boss "B" must be at the centre (is at ${x},${y})`);
      } else if (c !== "." && !(tiles && Object.prototype.hasOwnProperty.call(tiles, c))) errs.push(`unknown symbol "${c}" at ${x},${y}`);
    }
  }
  if (bosses !== 1) errs.push(`exactly one boss "B" (has ${bosses})`);
  return errs;
}
