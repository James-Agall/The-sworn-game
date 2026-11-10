// settlementTemplates.ts: neutral human SETTLEMENT templates (hamlet / village / town), shared by the server (template
// store, world-gen stamper) and the client (creative settlement editor). A template is a ground grid (SETTLEMENT_LEGEND:
// roads, plaza, walls, gates, towers, the keep anchor, a well, farm plots, fences, props, ore / rock, market stalls and
// NPC slots) plus BUILDING REFERENCES: building templates (shared/src/buildingTemplates.ts) placed by id at a top-left
// offset with a transform. Exactly one keep "K" is the settlement's anchor (relations, trade, levy, vassal, the Elder's
// seat; the old site code keys on it). Metadata: tier, world-gen weight, min start distance, the behaviour profile (the
// old SITE_TEMPLATES entry whose workers / stock / trade / quests / noun it keeps) and the garrison. Built-ins live in
// server/data/settlements/*.json, the editor's saves in server/data/settlements/user/*.json.
import { TileType, isGateTile, isSolidTile } from "./protocol.js";
import { type BuildingTemplate, buildingCells } from "./buildingTemplates.js";

export type SettlementProfile = "hearthmoor" | "ironhold" | "riverwatch";
export const SETTLEMENT_PROFILES: SettlementProfile[] = ["hearthmoor", "ironhold", "riverwatch"];
export type SettlementGuard = "townGuard" | "townArcher" | "townKnight";
export const SETTLEMENT_GUARDS: SettlementGuard[] = ["townGuard", "townArcher", "townKnight"];
export const SETTLEMENT_TIER_LABEL = ["", "Hamlet", "Village", "Town"];
// Buildings per tier (inclusive): hamlet 3-5, village 8-12, town 15+.
export const SETTLEMENT_BUILDINGS_BY_TIER: [number, number][] = [[0, 0], [3, 5], [8, 12], [15, 40]];

export interface SettlementBuildingRef {
  // A building template id.
  ref: string;
  // Top-left of the transformed footprint in the grid.
  x: number;
  y: number;
  transform?: number;
}

export interface SettlementTemplate {
  id: string;
  name: string;
  // 1 hamlet, 2 village, 3 town.
  tier: number;
  weight: number;
  minStartDist: number;
  profile: SettlementProfile;
  garrison: Partial<Record<SettlementGuard, number>>;
  rows: string[];
  buildings: SettlementBuildingRef[];
  builtin?: boolean;
}

export type SettlementSlot = "trader" | "priest" | "villager" | "guard" | "quest";
export interface SettlementSymbol {
  label: string;
  tile?: TileType;
  slot?: SettlementSlot;
  color: string;
}

// "." open ground (cleared, left unowned). Every other cell is stamped and owned by the settlement.
export const SETTLEMENT_LEGEND: Record<string, SettlementSymbol> = {
  ".": { label: "Open ground", color: "#c9d6a0" },
  _: { label: "Dirt road", tile: TileType.Road, color: "#b89a68" },
  "=": { label: "Cobble road / plaza", tile: TileType.CobbleRoad, color: "#a8a8a0" },
  "#": { label: "Palisade (wood wall)", tile: TileType.Wall, color: "#7a5230" },
  "%": { label: "Stone wall", tile: TileType.StoneWall, color: "#6c6e73" },
  G: { label: "Gate", tile: TileType.Gate, color: "#604020" },
  T: { label: "Tower", tile: TileType.Tower, color: "#404040" },
  K: { label: "Keep / town hall (anchor, the Elder)", tile: TileType.SiteKeep, color: "#c02020" },
  o: { label: "Well", tile: TileType.Water, color: "#4080e0" },
  f: { label: "Farm plot", tile: TileType.FarmPlot, color: "#c8b060" },
  p: { label: "Fence", tile: TileType.PropFence, color: "#9a7040" },
  l: { label: "Lantern post", tile: TileType.PropLanternPost, color: "#f0c040" },
  x: { label: "Crate", tile: TileType.PropCrate, color: "#a87a3c" },
  b: { label: "Barrel", tile: TileType.PropBarrel, color: "#8a5a2a" },
  c: { label: "Cart", tile: TileType.PropCart, color: "#9b6b3b" },
  $: { label: "Market stall", tile: TileType.Market, color: "#e0b040" },
  M: { label: "Iron ore", tile: TileType.IronOre, color: "#704030" },
  R: { label: "Rock", tile: TileType.Rock, color: "#909090" },
  t: { label: "Trader slot", slot: "trader", color: "#2060c0" },
  r: { label: "Priest / Brother slot", slot: "priest", color: "#f0f0ff" },
  v: { label: "Villager slot", slot: "villager", color: "#20a060" },
  g: { label: "Guard slot", slot: "guard", color: "#c03030" },
  q: { label: "Quest giver slot", slot: "quest", color: "#a040c0" },
};

export const SETTLEMENT_SIZE_MIN = 9;
export const SETTLEMENT_SIZE_MAX = 31;
export const SETTLEMENT_GARRISON_MAX = 24;

export type BuildingLookup = (id: string) => BuildingTemplate | undefined;

export interface SettlementLayout {
  w: number;
  h: number;
  // Tile per cell (-1: nothing, open ground).
  tiles: Int16Array;
  // Cells covered by a building template (index into t.buildings), -1 elsewhere.
  buildingOf: Int16Array;
  keep: { x: number; y: number } | null;
  slots: { kind: SettlementSlot; x: number; y: number }[];
  // Beds of the buildings (villagers' homes) and NPC slots inside them.
  beds: { x: number; y: number }[];
  npcSlots: { x: number; y: number }[];
  errs: string[];
}

// The composed tile grid: the ground symbols, then every building ref's pieces (refs must sit on open ground, inside
// the grid, not on top of each other).
export function settlementLayout(t: Pick<SettlementTemplate, "rows" | "buildings">, lookup: BuildingLookup): SettlementLayout {
  const h = t.rows.length;
  const w = t.rows[0]?.length ?? 0;
  const tiles = new Int16Array(w * h).fill(-1);
  const buildingOf = new Int16Array(w * h).fill(-1);
  const errs: string[] = [];
  const slots: SettlementLayout["slots"] = [];
  const beds: SettlementLayout["beds"] = [];
  const npcSlots: SettlementLayout["npcSlots"] = [];
  let keep: SettlementLayout["keep"] = null;
  let keeps = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = SETTLEMENT_LEGEND[t.rows[y]?.[x] ?? "."];
    if (!s) continue;
    if (s.tile !== undefined) tiles[y * w + x] = s.tile;
    if (s.slot) slots.push({ kind: s.slot, x, y });
    if (s.tile === TileType.SiteKeep) {
      keeps++;
      keep = { x, y };
    }
  }
  if (keeps !== 1) errs.push(`exactly one keep K (has ${keeps})`);
  (t.buildings ?? []).forEach((b, k) => {
    const bt = lookup(b.ref);
    if (!bt) {
      errs.push(`building ${k + 1}: unknown template "${b.ref}"`);
      return;
    }
    const tf = Math.max(0, Math.min(7, Math.floor(b.transform ?? 0)));
    if ((!bt.rotate && (tf & 3) !== 0) || (!bt.mirror && (tf & 4) !== 0)) errs.push(`building ${k + 1} (${b.ref}): transform ${tf} not allowed`);
    const { w: bw, h: bh, cells } = buildingCells(bt, tf);
    if (!Number.isInteger(b.x) || !Number.isInteger(b.y) || b.x < 0 || b.y < 0 || b.x + bw > w || b.y + bh > h) {
      errs.push(`building ${k + 1} (${b.ref}) off the grid`);
      return;
    }
    for (let y = b.y; y < b.y + bh; y++) for (let x = b.x; x < b.x + bw; x++) {
      const i = y * w + x;
      if (buildingOf[i] >= 0) errs.push(`building ${k + 1} (${b.ref}) overlaps building ${buildingOf[i] + 1} at ${x},${y}`);
      else if (t.rows[y][x] !== ".") errs.push(`building ${k + 1} (${b.ref}) covers "${t.rows[y][x]}" at ${x},${y}`);
      buildingOf[i] = k;
    }
    for (const c of cells) {
      tiles[(b.y + c.y) * w + b.x + c.x] = c.tile;
      if (c.tile === TileType.Bed) beds.push({ x: b.x + c.x, y: b.y + c.y });
      if (c.ch === "&") npcSlots.push({ x: b.x + c.x, y: b.y + c.y });
    }
  });
  return { w, h, tiles, buildingOf, keep, slots, beds, npcSlots, errs };
}

export interface SettlementStats {
  w: number;
  h: number;
  buildings: number;
  beds: number;
  slots: Record<SettlementSlot, number>;
  guards: number;
}

export function settlementStats(t: SettlementTemplate, lookup: BuildingLookup): SettlementStats {
  const l = settlementLayout(t, lookup);
  const slots: Record<SettlementSlot, number> = { trader: 0, priest: 0, villager: 0, guard: 0, quest: 0 };
  for (const s of l.slots) slots[s.kind]++;
  const guards = Object.values(t.garrison ?? {}).reduce((a, v) => a + (v ?? 0), 0);
  return { w: l.w, h: l.h, buildings: (t.buildings ?? []).length, beds: l.beds.length, slots, guards };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const isRoad = (tile: number) => tile === TileType.Road || tile === TileType.CobbleRoad;
// Walkable for the folk (gates and doors pass).
const walkable = (tile: number) => tile < 0 || isGateTile(tile) || !isSolidTile(tile as TileType);

// Every problem with a template (empty: valid): the shape, the legend, the metadata, the composed layout (one keep,
// buildings on open ground), the roads (one connected network touching the keep and every gate), every building's
// outside door, the keep, every gate and every slot reachable from outside the grid, the slots (a trader, guard posts
// for the garrison) and the building count of its tier.
export function validateSettlementTemplate(t: unknown, lookup: BuildingLookup): string[] {
  const errs: string[] = [];
  const o = t as Partial<SettlementTemplate> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(o.id)) errs.push("id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  if (typeof o.name !== "string" || o.name.trim().length === 0 || o.name.length > 40) errs.push("name: 1-40 characters");
  if (!Number.isInteger(o.tier) || o.tier! < 1 || o.tier! > 3) errs.push("tier: 1 (hamlet), 2 (village) or 3 (town)");
  if (typeof o.weight !== "number" || !(o.weight >= 0 && o.weight <= 100)) errs.push("weight: 0-100");
  if (typeof o.minStartDist !== "number" || !(o.minStartDist >= 0 && o.minStartDist <= 400)) errs.push("minStartDist: 0-400");
  if (!SETTLEMENT_PROFILES.includes(o.profile as SettlementProfile)) errs.push(`profile: one of ${SETTLEMENT_PROFILES.join(", ")}`);
  const g = o.garrison;
  let guards = 0;
  if (!g || typeof g !== "object" || Object.entries(g).some(([k, v]) => !SETTLEMENT_GUARDS.includes(k as SettlementGuard) || !Number.isInteger(v) || (v as number) < 0)) {
    errs.push(`garrison: {${SETTLEMENT_GUARDS.join(", ")}: counts}`);
  } else {
    guards = Object.values(g).reduce((a: number, v) => a + (v as number), 0);
    if (guards < 1 || guards > SETTLEMENT_GARRISON_MAX) errs.push(`garrison: 1-${SETTLEMENT_GARRISON_MAX} guards (has ${guards})`);
  }
  if (!Array.isArray(o.buildings) || o.buildings.some((b) => !b || typeof b !== "object" || typeof b.ref !== "string")) errs.push("buildings: a list of {ref, x, y, transform?}");
  const rows = o.rows;
  if (!Array.isArray(rows) || rows.some((r) => typeof r !== "string")) return [...errs, "rows: a list of strings"];
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  if (h < SETTLEMENT_SIZE_MIN || h > SETTLEMENT_SIZE_MAX || w < SETTLEMENT_SIZE_MIN || w > SETTLEMENT_SIZE_MAX) errs.push(`size: ${SETTLEMENT_SIZE_MIN}-${SETTLEMENT_SIZE_MAX} each way (is ${w}x${h})`);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      errs.push(`row ${y}: ${rows[y].length} wide, not ${w}`);
      continue;
    }
    for (let x = 0; x < w; x++) if (!(rows[y][x] in SETTLEMENT_LEGEND)) errs.push(`unknown symbol "${rows[y][x]}" at ${x},${y}`);
  }
  if (errs.length > 0) return errs;
  const tt = o as SettlementTemplate;
  const l = settlementLayout(tt, lookup);
  errs.push(...l.errs);
  if (errs.length > 0) return errs;
  const [bMin, bMax] = SETTLEMENT_BUILDINGS_BY_TIER[tt.tier];
  if (tt.buildings.length < bMin || tt.buildings.length > bMax) errs.push(`a ${SETTLEMENT_TIER_LABEL[tt.tier].toLowerCase()} has ${bMin}-${bMax} buildings (has ${tt.buildings.length})`);
  const st = settlementStats(tt, lookup);
  if (st.slots.trader < 1) errs.push("at least one trader slot t");
  if (st.slots.guard < 1) errs.push("at least one guard slot g");
  if (st.beds < 1) errs.push("at least one bed (villagers' homes) in its buildings");
  // Roads: one connected network (gates join it) touching the keep and every gate.
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : l.tiles[y * w + x]);
  const roadSeen = new Uint8Array(w * h);
  let components = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isRoad(at(x, y)) || roadSeen[y * w + x]) continue;
    components++;
    const q = [y * w + x];
    roadSeen[y * w + x] = 1;
    while (q.length > 0) {
      const cur = q.pop()!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        const tile = at(nx, ny);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || roadSeen[ny * w + nx] || !(isRoad(tile) || tile === TileType.Gate)) continue;
        roadSeen[ny * w + nx] = 1;
        q.push(ny * w + nx);
      }
    }
  }
  if (components !== 1) errs.push(`roads: one connected network (has ${components})`);
  const touchesRoad = (x: number, y: number) => DIRS.some(([dx, dy]) => isRoad(at(x + dx, y + dy)));
  if (l.keep && !touchesRoad(l.keep.x, l.keep.y)) errs.push("the keep K must touch a road");
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === TileType.Gate && !touchesRoad(x, y)) errs.push(`gate at ${x},${y} touches no road`);
  // Reachability from outside the grid (folk pass gates and doors).
  const seen = new Uint8Array(w * h);
  const q: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && walkable(at(x, y))) {
      seen[y * w + x] = 1;
      q.push(y * w + x);
    }
  }
  while (q.length > 0) {
    const cur = q.pop()!;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !walkable(at(nx, ny))) continue;
      seen[ny * w + nx] = 1;
      q.push(ny * w + nx);
    }
  }
  const reachedSide = (x: number, y: number) => DIRS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] === 1;
  });
  if (l.keep && !reachedSide(l.keep.x, l.keep.y)) errs.push("the keep can't be reached from outside");
  for (const s of l.slots) if (!seen[s.y * w + s.x]) errs.push(`${s.kind} slot at ${s.x},${s.y} can't be reached`);
  for (const b of l.beds) if (!seen[b.y * w + b.x]) errs.push(`a bed at ${b.x},${b.y} can't be reached`);
  tt.buildings.forEach((b, k) => {
    const bt = lookup(b.ref)!;
    const { cells } = buildingCells(bt, b.transform ?? 0);
    const doors = cells.filter((c) => c.tile === TileType.WoodDoor || c.tile === TileType.StoneDoor);
    if (!doors.some((d) => seen[(b.y + d.y) * w + b.x + d.x])) errs.push(`building ${k + 1} (${b.ref}): its door can't be reached`);
  });
  if (guards > 0 && st.slots.guard > 0 && guards > st.slots.guard * 3) errs.push(`garrison ${guards} needs at least ${Math.ceil(guards / 3)} guard slots`);
  return errs;
}
