import type {RuinPlan} from './ruins.js';
// interiors.ts: Stardew phase 5c (docs PLAN-rimworld-stardew.md 5c; ROADMAP "Stardew layer — phase 5c"). Building
// interiors: the hero steps through the door of a PREFAB building (house, tavern, church, smithy, bakery, shop,
// barracks, hall, barn) into a small separate tile map built from a per-building-type TEMPLATE below (an ASCII grid
// over INTERIOR_LEGEND, like the camp templates in camps.ts). Every interior number lives here (server + client).
// Player-built modular rooms (phases 1-2) are never entered (they keep the roof cutaway).
import { TICK_RATE, TileType } from "./protocol.js";
import type { PackGood } from "./herolife.js";
// Stage B (2026-11-26): the building interiors' legend and layouts are data (shared/src/data/interiors/*.json),
// imported statically so the server (tsx / Node) and the client bundle (Vite) always hold the same layouts.
import legendJson from "./data/interiors/legend.json" with { type: "json" };
import houseJson from "./data/interiors/house.json" with { type: "json" };
import tavernJson from "./data/interiors/tavern.json" with { type: "json" };
import churchJson from "./data/interiors/church.json" with { type: "json" };
import smithyJson from "./data/interiors/smithy.json" with { type: "json" };
import bakeryJson from "./data/interiors/bakery.json" with { type: "json" };
import shopJson from "./data/interiors/shop.json" with { type: "json" };
import barracksJson from "./data/interiors/barracks.json" with { type: "json" };
import hallJson from "./data/interiors/hall.json" with { type: "json" };
import barnJson from "./data/interiors/barn.json" with { type: "json" };

// ---- constants ----
// Interior tiles are world-sized (32 px), so hero / NPC art keeps its scale.
export const INTERIOR_TILE_PX = 32;
// E enters when the hero's centre is within this many tiles of the door tile's centre (the tile just below the
// building: its door side); walking north into the building from the door tile enters too (bump).
export const INTERIOR_DOOR_REACH_TILES = 0.9;
// Entering is refused while a hostile mob is within this many tiles of the door.
export const INTERIOR_ENEMY_BLOCK_TILES = 6;
// Inside: hostile mobs within this many tiles of the door raise the HUD warning ("Raiders near the door").
export const INTERIOR_THREAT_ALERT_TILES = 12;
// Hero speed indoors (x PLAYER_SPEED x the usual needs / load multiplier).
export const INTERIOR_SPEED_MULT = 0.75;
// E reaches a bed / chest / the exit mat within this many tiles (centre to centre); NPCs use TALK_RANGE_TILES.
export const INTERIOR_USE_RANGE_TILES = 1.6;
// Esc leaves when the hero is within this many tiles of the exit mat.
export const INTERIOR_ESC_EXIT_TILES = 2.2;
// A bump-enter / refusal is retried at most this often (ticks); a fresh exit ignores bumps this long.
export const INTERIOR_BUMP_COOLDOWN_TICKS = 30;
// Chest capacity in pack weight units (PACK_WEIGHT); a Barn's storage holds more.
export const INTERIOR_CHEST_CAP = 200;
export const INTERIOR_BARN_CHEST_CAP = 600;
// Resting in your own bed (daytime nap): rest / energy gain multiplier, like the home shelter.
export const INTERIOR_BED_REST_MULT = 3;
// NPCs, threat and chest are refreshed this often (ticks) while someone is inside.
export const INTERIOR_REFRESH_TICKS = 20;
// Client: the fade between world and interior (ms), the lighting vignette strength, the camera zoom indoors.
export const INTERIOR_FADE_MS = 260;
export const INTERIOR_VIGNETTE_ALPHA = 0.6;
export const INTERIOR_ZOOM = 2.4;

// ---- gap closure G5: living interiors ----
// NPCs walk at this many tiles a second; a wanderer waits INTERIOR_NPC_WAIT_MIN..MAX ticks between walks to a tile
// at most INTERIOR_NPC_WANDER_TILES away (path on the interior grid).
export const INTERIOR_NPC_SPEED_TILES = 1.4;
export const INTERIOR_NPC_WAIT_MIN_TICKS = 40;
export const INTERIOR_NPC_WAIT_MAX_TICKS = 140;
export const INTERIOR_NPC_WANDER_TILES = 4;
// An NPC stops and turns to a hero this close (tiles).
export const INTERIOR_NPC_STOP_TILES = 1.3;
// NPC positions / poses go to the heroes inside every this many ticks (only when they changed).
export const INTERIOR_NPC_SEND_TICKS = 3;
// Greeting bubble: said when a hero comes within this many tiles, shown this long, not again for the cooldown.
export const INTERIOR_GREET_RANGE_TILES = 2.5;
export const INTERIOR_SAY_TICKS = 60;
export const INTERIOR_GREET_COOLDOWN_TICKS = 600;
// Tavern patrons seated at once by time of day (min, max; capped by the seats): day / dusk / night.
export const INTERIOR_PATRONS_DAY: [number, number] = [2, 3];
export const INTERIOR_PATRONS_DUSK: [number, number] = [3, 5];
export const INTERIOR_PATRONS_NIGHT: [number, number] = [4, 6];
// Tavern "buy a drink": gold, rest gained, colony happiness for TAVERN_DRINK_CHEER_TICKS, drinks a game day.
export const TAVERN_DRINK_GOLD = 3;
export const TAVERN_DRINK_REST = 12;
export const TAVERN_DRINK_HAPPINESS = 2;
export const TAVERN_DRINK_CHEER_TICKS = TICK_RATE * 120;
export const TAVERN_DRINKS_PER_DAY = 3;
// Innkeeper (tavern keeper): buy a rumour (reveals one real place on the minimap, a different one each time) and rest the
// night at the inn (rest and energy to full, some food).
export const INN_RUMOUR_GOLD = 10;
export const INN_REST_GOLD = 5;
export const INN_REST_FOOD = 20;
// Client: walk frame time, the idle bob (px, period), the work swing period (ms).
export const INTERIOR_WALK_FRAME_MS = 140;
export const INTERIOR_BOB_PX = 1.5;
export const INTERIOR_BOB_MS = 1400;
export const INTERIOR_WORK_MS = 520;

// ---- templates ----
export type InteriorTemplateId = "house" | "tavern" | "church" | "smithy" | "bakery" | "shop" | "barracks" | "hall" | "barn"
  // Deep mines (shared/src/mines.ts): every mine; its layout (variant) is its depth (level 1 adit, 2 shaft, 3 deep).
  | "mine";
export type InteriorFloor = "wood" | "stone" | "dirt";
export type InteriorProp =
  | "adventureNote" | "adventureKey" | "adventurePot" | "adventureCache" | "adventureGate"
  | "bed" | "bedFine" | "chest" | "table" | "chair" | "hearth" | "lamp" | "rug" | "shelf" | "wardrobe" | "counter"
  | "altar" | "pew" | "anvil" | "oven" | "barrel" | "crates" | "sacks" | "hay" | "weaponRack" | "armourStand" | "banner"
  | "statue" | "throne" | "forge" | "stall" | "workbench" | "candelabra"
  // Gap closure G5 (d): stairs to the upper floor ("U") and back down ("D"); walked onto, not used with E.
  | "stairsUp" | "stairsDown"
  // Deep mines: the ore face the miners work and the timber props holding the roof.
  | "oreFace" | "timberProp"
  // Layered mines: the way down to the Mine's next layer (walked onto; drawn with the Mine's own sprite for now).
  | "mineShaft" | "campTent" | "prisonCage" | "rockBlock" | "ruinRubble" | "skullBones" | "fallenSkeleton" | "cobweb" | "overgrowth" | "banditTower" | "mineralNode" | "stalagmite" | "sarcophagus" | "ruinColumn";
// NPC slots: "1" the building's keeper (smith, baker, trader, priest, elder), "2" a second (a hall's trader),
// "v" residents / patrons / soldiers (beside the beds and tables).
export type InteriorNpcSlot = "1" | "2" | "v";

export interface InteriorSymbol {
  label: string;
  prop?: InteriorProp;
  npc?: InteriorNpcSlot;
  // Shown only from this building level (below it the cell is plain floor).
  minLevel?: number;
}
// "#" wall, "." floor, "E" exit mat (exactly one, in the bottom wall), " " nothing. Solid: walls and every prop
// except INTERIOR_WALKABLE_PROPS. Data: shared/src/data/interiors/legend.json (also the mine-only symbols O P Z N M).
export const INTERIOR_LEGEND: Record<string, InteriorSymbol> = legendJson as Record<string, InteriorSymbol>;
export const INTERIOR_WALKABLE_PROPS: ReadonlySet<InteriorProp> = new Set(["adventureNote", "adventureKey", "adventureCache", "skullBones", "fallenSkeleton", "cobweb", "overgrowth", "rug", "chair", "stairsUp", "stairsDown", "mineShaft"]);

export interface InteriorTemplate {
  id: InteriorTemplateId;
  label: string;
  floor: InteriorFloor;
  wall: "wood" | "stone";
  rows: string[];
}

// Gap closure G5: INTERIOR_VARIANTS layouts per building type (index 0 is the phase 5c layout), picked by
// interiorVariantFor (building anchor + level). Every one passes validateInteriorTemplate (ROOM role: the type's
// real stations are INTERIOR_REQUIRED_PROPS). "U" stairs up: the tavern / barracks / hall have an upper floor
// (INTERIOR_UPPER_TEMPLATES, "D" stairs down, no exit mat).
export const INTERIOR_VARIANTS = 3;
const T = (id: InteriorTemplateId, label: string, floor: InteriorFloor, wall: "wood" | "stone", rows: string[]): InteriorTemplate => ({ id, label, floor, wall, rows });

// The building types whose interiors are data (one file each: shared/src/data/interiors/<id>.json). The mine's
// layouts are the Deep mines' (its variant is its depth) and stay in code below.
export const BUILDING_INTERIOR_IDS = ["house", "tavern", "church", "smithy", "bakery", "shop", "barracks", "hall", "barn"] as const;
export type BuildingInteriorId = (typeof BUILDING_INTERIOR_IDS)[number];
export interface InteriorLayoutFile {
  label: string;
  floor: InteriorFloor;
  wall: "wood" | "stone";
  rows: string[];
}
// One building type's interiors: its room role's stations (`required`), whether your own one is a bed you sleep in
// (`sleep`: INTERIOR_SLEEP_TEMPLATES), INTERIOR_VARIANTS ground-floor layouts in order (the index is the variant
// interiorVariantFor picks: order and count are part of the game) and the optional upper floor (reached by "U").
export interface InteriorFile {
  id: BuildingInteriorId;
  required: InteriorProp[];
  sleep: boolean;
  variants: InteriorLayoutFile[];
  upper?: InteriorLayoutFile;
}
// The Town Center hall (and every hall) must keep these stations: the hall chest is the Town Center's storage.
export const HALL_REQUIRED_PROPS: readonly InteriorProp[] = ["throne", "table", "chest"];
const FLOORS: readonly string[] = ["wood", "stone", "dirt"];
const WALLS: readonly string[] = ["wood", "stone"];

// The file's shape (not the layouts' walkability: validateInteriorFile checks those too).
function interiorFileShape(raw: unknown): string[] {
  const o = raw as Partial<InteriorFile> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["not an object"];
  const errs: string[] = [];
  const id = String(o.id);
  if (!BUILDING_INTERIOR_IDS.includes(o.id as BuildingInteriorId)) errs.push(`id: one of ${BUILDING_INTERIOR_IDS.join(", ")}`);
  if (!Array.isArray(o.required) || o.required.length === 0 || o.required.some((p) => typeof p !== "string")) errs.push(`${id}: required: a list of props`);
  else if (o.id === "hall") for (const p of HALL_REQUIRED_PROPS) if (!o.required.includes(p)) errs.push(`hall: required must keep "${p}" (the Town Center hall)`);
  if (typeof o.sleep !== "boolean") errs.push(`${id}: sleep: true or false`);
  const layout = (l: Partial<InteriorLayoutFile> | undefined, what: string) => {
    if (!l || typeof l !== "object") return void errs.push(`${id} ${what}: not an object`);
    if (typeof l.label !== "string" || l.label.trim().length === 0 || l.label.length > 40) errs.push(`${id} ${what}: label 1-40 characters`);
    if (!FLOORS.includes(l.floor as string)) errs.push(`${id} ${what}: floor one of ${FLOORS.join(", ")}`);
    if (!WALLS.includes(l.wall as string)) errs.push(`${id} ${what}: wall one of ${WALLS.join(", ")}`);
    if (!Array.isArray(l.rows) || l.rows.length === 0 || l.rows.some((r) => typeof r !== "string")) errs.push(`${id} ${what}: rows: a list of strings`);
  };
  if (!Array.isArray(o.variants) || o.variants.length !== INTERIOR_VARIANTS) errs.push(`${id}: ${Array.isArray(o.variants) ? o.variants.length : 0} variants, wants ${INTERIOR_VARIANTS}`);
  else o.variants.forEach((l, i) => layout(l, `variant ${i}`));
  if (o.upper !== undefined) layout(o.upper, "upstairs");
  return errs;
}
// Only the known fields, in the file's order (what an editor writes).
export function normaliseInteriorFile(o: InteriorFile): InteriorFile {
  const lay = (l: InteriorLayoutFile): InteriorLayoutFile => ({ label: l.label, floor: l.floor, wall: l.wall, rows: l.rows.slice() });
  return { id: o.id, required: o.required.slice(), sleep: o.sleep, variants: o.variants.map(lay), ...(o.upper ? { upper: lay(o.upper) } : {}) };
}
const layoutOf = (id: InteriorTemplateId, l: InteriorLayoutFile): InteriorTemplate => T(id, l.label, l.floor, l.wall, l.rows.slice());
const FILES: InteriorFile[] = [houseJson, tavernJson, churchJson, smithyJson, bakeryJson, shopJson, barracksJson, hallJson, barnJson].map((raw, k) => {
  const errs = interiorFileShape(raw);
  if (errs.length || (raw as { id?: string }).id !== BUILDING_INTERIOR_IDS[k]) throw new Error(`interior data ${BUILDING_INTERIOR_IDS[k]}.json: ${errs.join("; ") || "wrong id"}`);
  return raw as InteriorFile;
});
const FILE_BY_ID = Object.fromEntries(FILES.map((f) => [f.id, f])) as Record<BuildingInteriorId, InteriorFile>;
const layoutsOf = (id: BuildingInteriorId) => FILE_BY_ID[id].variants.map((l) => layoutOf(id, l));

// Deep mines (shared/src/mines.ts): variant = depth (interiorTemplateAt), not a hash: 0 the level-1 adit, 1 the
// level-2 shaft, 2 the deep level-3 workings. "1" the foreman at the face, "v" miners, "Z" lairs.
const MINE_TEMPLATES: InteriorTemplate[] = [
  T("mine", "Mine", "dirt", "stone", [
    "###########",
    "#OO..1..OO#",
    "#.v.....v.#",
    "#P...Z...P#",
    "#..X...lN.#",
    "#P.......P#",
    "#####E#####",
  ]),
  T("mine", "Mine", "dirt", "stone", [
    "###############",
    "#OO1.#####.OOO#",
    "#.v..#.Z.#..v.#",
    "#PZ..#...#...P#",
    "#....P...P....#",
    "#.....M......x#",
    "#P...#####...P#",
    "#X.l.......lZ.#",
    "#######E#######",
  ]),
  T("mine", "Mine", "dirt", "stone", [
    "#################",
    "#OOO.1.###.OOOO.#",
    "#..v...#Z#..v...#",
    "#P.....#.#.....P#",
    "#...Z..P.P..Z...#",
    "#.......Z.......#",
    "#P..###...###..P#",
    "#...#OO...OO#...#",
    "#.Z.#..v.v..#.Z.#",
    "#P..##.....##..P#",
    "#x....l...l....X#",
    "########E########",
  ]),
];

// Gap closure G5: INTERIOR_VARIANTS layouts per building type (index 0 is the phase 5c layout), picked by
// interiorVariantFor (building anchor + level). Every one passes validateInteriorTemplate (ROOM role: the type's
// real stations are INTERIOR_REQUIRED_PROPS). "U" stairs up: the tavern / barracks / hall have an upper floor
// (INTERIOR_UPPER_TEMPLATES, "D" stairs down, no exit mat). Key order as before the move (mine before barn).
export const INTERIOR_TEMPLATES: Record<InteriorTemplateId, InteriorTemplate[]> = {
  house: layoutsOf("house"), tavern: layoutsOf("tavern"), church: layoutsOf("church"), smithy: layoutsOf("smithy"),
  bakery: layoutsOf("bakery"), shop: layoutsOf("shop"), barracks: layoutsOf("barracks"), hall: layoutsOf("hall"),
  mine: MINE_TEMPLATES, barn: layoutsOf("barn"),
};
// Gap closure G5 (d): the upper floor reached by the "U" stairs (guest rooms / the keepers' bedrooms).
export const INTERIOR_UPPER_TEMPLATES: Partial<Record<InteriorTemplateId, InteriorTemplate>> = Object.fromEntries(
  FILES.filter((f) => f.upper).map((f) => [f.id, layoutOf(f.id, f.upper!)]),
);
// The stations / furniture a layout must have for its room role (validateInteriorTemplate; upper floors: a bed).
export const INTERIOR_REQUIRED_PROPS: Record<InteriorTemplateId, InteriorProp[]> = {
  house: FILE_BY_ID.house.required, tavern: FILE_BY_ID.tavern.required, church: FILE_BY_ID.church.required,
  smithy: FILE_BY_ID.smithy.required, bakery: FILE_BY_ID.bakery.required, shop: FILE_BY_ID.shop.required,
  barracks: FILE_BY_ID.barracks.required, hall: FILE_BY_ID.hall.required, barn: FILE_BY_ID.barn.required,
  mine: ["oreFace", "timberProp"],
};
// A tavern layout seats at least this many patrons (chairs beside a table).
export const INTERIOR_TAVERN_MIN_SEATS = 6;

// Deterministic layout pick: the same building (anchor) at the same level always gets the same variant.
export function interiorVariantFor(tx: number, ty: number, level: number): number {
  let h = 2166136261;
  for (const n of [tx, ty, level]) h = Math.imul(h ^ (n & 0xffff), 16777619) ^ (n >>> 16);
  return ((h >>> 0) % 7919) % INTERIOR_VARIANTS;
}

// Every problem with a layout ([] = valid): rectangular, known symbols, a closed outline, exactly one exit mat in the
// bottom row (upper floors: one "D" and no mat), every walkable tile reachable from the spawn at level 3 (the most
// furniture), beds / chests / NPC slots next to a reachable tile, the type's stations, a keeper slot (not houses),
// tavern seats. `role`: the type's stations and whether it has an upper floor (default: the loaded tables; an editor
// checking a file passes the file's own).
export function validateInteriorTemplate(
  t: InteriorTemplate, upper = false,
  role: { required: readonly InteriorProp[]; hasUpper: boolean } = { required: INTERIOR_REQUIRED_PROPS[t.id], hasUpper: !!INTERIOR_UPPER_TEMPLATES[t.id] },
): string[] {
  const errs: string[] = [];
  const h = t.rows.length;
  const w = t.rows[0]?.length ?? 0;
  if (h < 4 || w < 4) return [`${t.id}: too small`];
  if (t.rows.some((r) => r.length !== w)) errs.push(`${t.id}: rows differ in length`);
  for (const r of t.rows) for (const ch of r) if (ch !== " " && !INTERIOR_LEGEND[ch]) errs.push(`${t.id}: unknown symbol "${ch}"`);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = t.rows[y][x];
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (edge && ch !== "#" && ch !== " " && !(ch === "E" && y === h - 1)) errs.push(`${t.id}: open outline at ${x},${y}`);
    }
  }
  const count = (c: string) => t.rows.join("").split(c).length - 1;
  if (upper) {
    if (count("E") !== 0) errs.push(`${t.id} upstairs: has an exit mat`);
    if (count("D") !== 1) errs.push(`${t.id} upstairs: needs exactly one "D"`);
  } else {
    if (count("E") !== 1) errs.push(`${t.id}: needs exactly one exit mat`);
    if (count("D") !== 0) errs.push(`${t.id}: "D" only upstairs`);
    if (count("U") > 1) errs.push(`${t.id}: more than one stairs up`);
  }
  if (errs.length) return errs;
  const m = buildFromTemplate(t, 3, 0, upper ? 1 : 0);
  const solid = interiorSolidGrid(m);
  const start = m.spawn.y * w + m.spawn.x;
  if (solid[start]) errs.push(`${t.id}: the spawn tile is blocked`);
  // `seen`: where the hero can walk; `behind`: also through counters (the keeper's side of the counter).
  const counter = new Set(m.props.filter((p) => p.prop === "counter").map((p) => p.y * w + p.x));
  const flood = (through: (j: number) => boolean) => {
    const out = new Uint8Array(w * h);
    const q = [start];
    out[start] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (out[j] || (solid[j] && !through(j))) continue;
        out[j] = 1;
        q.push(j);
      }
    }
    return out;
  };
  const seen = flood(() => false);
  const behind = flood((j) => counter.has(j));
  for (let i = 0; i < w * h; i++) if (!solid[i] && !behind[i]) errs.push(`${t.id}: tile ${i % w},${Math.floor(i / w)} cannot be reached`);
  // An NPC slot must be in talking range (2 tiles) of where the hero can stand.
  const talkable = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (Math.hypot(dx, dy) <= 2 && nx >= 0 && ny >= 0 && nx < w && ny < h && seen[ny * w + nx]) return true;
    }
    return false;
  };
  const reachNear = (x: number, y: number) =>
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && seen[ny * w + nx] === 1;
    });
  for (const p of m.props) if ((p.prop === "bed" || p.prop === "bedFine" || p.prop === "chest") && !reachNear(p.x, p.y)) errs.push(`${t.id}: ${p.prop} at ${p.x},${p.y} cannot be reached`);
  for (const s of m.slots) if (!behind[s.y * w + s.x] || !talkable(s.x, s.y)) errs.push(`${t.id}: NPC slot at ${s.x},${s.y} cannot be reached`);
  if (m.stairs && !reachNear(m.stairs.x, m.stairs.y)) errs.push(`${t.id}: stairs cannot be reached`);
  const has = (p: InteriorProp) => m.props.some((q2) => q2.prop === p || (p === "bed" && q2.prop === "bedFine"));
  if (upper) {
    if (!has("bed")) errs.push(`${t.id} upstairs: no bed`);
    return errs;
  }
  for (const p of role.required) if (!has(p)) errs.push(`${t.id}: no ${p} (its room role needs one)`);
  if (t.id !== "house" && !m.slots.some((s) => s.slot === "1")) errs.push(`${t.id}: no keeper slot "1"`);
  if (t.id === "house" && !m.slots.some((s) => s.slot === "v")) errs.push(`house: no resident slot "v"`);
  if (t.id === "mine" && !(m.lairs ?? []).length) errs.push(`mine: no monster lair "Z"`);
  for (const q of m.lairs ?? []) if (!seen[q.y * w + q.x]) errs.push(`${t.id}: lair at ${q.x},${q.y} cannot be reached`);
  if (t.id === "tavern" && interiorSeats(m).length < INTERIOR_TAVERN_MIN_SEATS) errs.push(`tavern: fewer than ${INTERIOR_TAVERN_MIN_SEATS} seats`);
  if (role.hasUpper && !m.stairs) errs.push(`${t.id}: no stairs up to its upper floor`);
  return errs;
}

// Every problem with a building's interior file (shared/src/data/interiors/<id>.json; [] = valid): its shape (known
// id, INTERIOR_VARIANTS layouts, floors / walls, the hall keeps throne / table / chest) and every layout by
// validateInteriorTemplate with the file's own stations and upper floor.
export function validateInteriorFile(raw: unknown): string[] {
  const errs = interiorFileShape(raw);
  if (errs.length) return errs;
  const f = raw as InteriorFile;
  const role = { required: f.required, hasUpper: !!f.upper };
  f.variants.forEach((l, i) => errs.push(...validateInteriorTemplate(layoutOf(f.id, l), false, role).map((e) => `${e} (variant ${i})`)));
  if (f.upper) errs.push(...validateInteriorTemplate(layoutOf(f.id, f.upper), true, role));
  return errs;
}

// Every problem with every layout (the interiors test asserts []).
export function validateAllInteriorTemplates(): string[] {
  const out: string[] = [];
  for (const id of Object.keys(INTERIOR_TEMPLATES) as InteriorTemplateId[]) {
    const list = INTERIOR_TEMPLATES[id];
    if (list.length !== INTERIOR_VARIANTS) out.push(`${id}: ${list.length} variants, wants ${INTERIOR_VARIANTS}`);
    list.forEach((t, i) => out.push(...validateInteriorTemplate(t).map((e) => `${e} (variant ${i})`)));
    const up = INTERIOR_UPPER_TEMPLATES[id];
    if (up) out.push(...validateInteriorTemplate(up, true));
  }
  return out;
}

// Which prefab buildings have an interior (and its level: the tile's own level, or fixed by the tile).
export const INTERIOR_TEMPLATE_BY_TILE: Partial<Record<TileType, InteriorTemplateId>> = {
  [TileType.House]: "house",
  [TileType.HouseLevel2]: "house",
  [TileType.BigHouse]: "house",
  [TileType.Tavern]: "tavern",
  [TileType.ChurchPost]: "church",
  [TileType.AbbeyHall]: "church",
  [TileType.Blacksmith]: "smithy",
  [TileType.Bakery]: "bakery",
  [TileType.TailorShop]: "shop",
  [TileType.Market]: "shop",
  [TileType.GoldShop]: "shop",
  [TileType.MilitiaPost]: "barracks",
  [TileType.MilitiaCamp2]: "barracks",
  [TileType.MilitiaCamp3]: "barracks",
  [TileType.TownCenter]: "hall",
  [TileType.KnightPost]: "hall",
  [TileType.CastleLevel2]: "hall",
  [TileType.CastleLevel3]: "hall",
  [TileType.Keep]: "hall",
  [TileType.SiteKeep]: "hall",
  [TileType.BarnPost]: "barn",
  [TileType.RockMinePost]: "mine",
  // Layered mines: the Mine's layers are its variants (0-2), the Quarry's variant its depth.
  [TileType.IronMinePost]: "mine",
};
// Tiles whose level is the tile itself (House tiers, militia camps, castles, the Abbey).
export const INTERIOR_FIXED_LEVEL: Partial<Record<TileType, number>> = {
  [TileType.House]: 1,
  [TileType.HouseLevel2]: 2,
  [TileType.BigHouse]: 3,
  [TileType.MilitiaPost]: 1,
  [TileType.MilitiaCamp2]: 2,
  [TileType.MilitiaCamp3]: 3,
  [TileType.CastleLevel2]: 2,
  [TileType.CastleLevel3]: 3,
  [TileType.AbbeyHall]: 3,
};
// Your own bed: a house or your hall (Town Center / Keep). Chests open only in your own buildings.
export const INTERIOR_SLEEP_TEMPLATES: ReadonlySet<InteriorTemplateId> = new Set(FILES.filter((f) => f.sleep).map((f) => f.id));

// ---- the built map ----
// cells: one char per tile, row-major ("#" wall, "." floor, "E" exit, " " nothing).
export interface InteriorMap {
  ruin?:RuinPlan;
  underground?:{version:2;kind:'mine'|'cave';seed:number;depth:number;rockOnly?:boolean;landmarks:{id:number;role:string;x:number;y:number}[];tracks:{x:number;y:number;mask:number}[]};
  templateId: InteriorTemplateId;
  label: string;
  level: number;
  // Gap closure G5: the layout (INTERIOR_TEMPLATES[templateId][variant]) and the storey (0 ground, 1 upstairs).
  variant: number;
  storey: number;
  w: number;
  h: number;
  floor: InteriorFloor;
  wall: "wood" | "stone";
  cells: string;
  props: { prop: InteriorProp; x: number; y: number; facing?: "n"|"e"|"s"|"w" }[];
  slots: { slot: InteriorNpcSlot; x: number; y: number }[];
  // Upstairs: the "D" stairs (no mat there; leaving needs the ground floor).
  exit: { x: number; y: number };
  // Where the hero appears: the tile just inside the exit mat (upstairs: beside the stairs down).
  spawn: { x: number; y: number };
  // The stairs on this floor ("U" on the ground floor, "D" upstairs), or null.
  stairs: { x: number; y: number } | null;
  // Deep mines: the "Z" lairs (floor tiles) where an infested mine's monsters start.
  lairs?: { x: number; y: number }[];
}

function buildFromTemplate(t: InteriorTemplate, level: number, variant: number, storey: number): InteriorMap {
  const h = t.rows.length;
  const w = t.rows[0].length;
  let cells = "";
  const props: InteriorMap["props"] = [];
  const slots: InteriorMap["slots"] = [];
  let exit = { x: Math.floor(w / 2), y: h - 1 };
  let stairs: InteriorMap["stairs"] = null;
  const lairs: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = t.rows[y][x] ?? " ";
      if (ch === "#" || ch === " ") {
        cells += ch;
        continue;
      }
      if (ch === "E") {
        exit = { x, y };
        cells += "E";
        continue;
      }
      cells += ".";
      if (ch === "Z") lairs.push({ x, y });
      const sym = INTERIOR_LEGEND[ch];
      if (!sym || (sym.minLevel ?? 1) > level) continue;
      if (sym.prop) props.push({ prop: sym.prop, x, y });
      if (sym.npc) slots.push({ slot: sym.npc, x, y });
      if (ch === "U" || ch === "D") stairs = { x, y };
    }
  }
  let spawn = { x: exit.x, y: exit.y - 1 };
  if (storey > 0 && stairs) {
    exit = { ...stairs };
    const free = (x: number, y: number) => {
      const ch = t.rows[y]?.[x];
      return ch !== undefined && ch !== "#" && ch !== " " && ch !== "D" && (!INTERIOR_LEGEND[ch]?.prop || INTERIOR_WALKABLE_PROPS.has(INTERIOR_LEGEND[ch].prop!));
    };
    const s = stairs;
    spawn = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).find((q) => free(q.x, q.y)) ?? { ...s };
  }
  for(const p of props){
    const table=props.find(q=>q.prop==='table'&&Math.abs(q.x-p.x)+Math.abs(q.y-p.y)===1);
    p.facing=p.prop==='chair'&&table?(table.x>p.x?'e':table.x<p.x?'w':table.y>p.y?'s':'n'):(p.x===1?'e':p.x===w-2?'w':p.y>=h-2?'n':'s');
    if(p.prop==='bed'||p.prop==='bedFine')p.facing='n';
  }
  const map:InteriorMap={ templateId: t.id, label: t.label, level, variant, storey, w, h, floor: t.floor, wall: t.wall, cells, props, slots, exit, spawn, stairs, ...(lairs.length ? { lairs } : {}) };
  furnishInteriorEdges(map);
  return map;
}

// Refresh every public interior and upstairs room with its own wall-side furnishings.
// The player-home presets have their own furnishing system; saved custom rooms are never rewritten here.
function furnishInteriorEdges(m:InteriorMap){
 if(m.templateId==='house')return;
 const themes:Record<InteriorTemplateId,InteriorProp[]>={house:[],tavern:['barrel','shelf','lamp','rug'],church:['candelabra','banner','statue','rug'],smithy:['weaponRack','crates','workbench','lamp'],bakery:['sacks','shelf','barrel','lamp'],shop:['shelf','crates','counter','lamp'],barracks:['armourStand','weaponRack','banner','lamp'],hall:['banner','statue','candelabra','rug'],barn:['sacks','barrel','crates','hay'],mine:['timberProp','crates','barrel','lamp']};
 const theme=m.storey>0?(['wardrobe','shelf','lamp','rug'] as InteriorProp[]):themes[m.templateId];
 const candidates:{x:number;y:number}[]=[];
 for(let y=1;y<m.h-1;y++)for(let x=1;x<m.w-1;x++){
  if(m.cells[y*m.w+x]!=='.'||m.props.some(p=>p.x===x&&p.y===y)||m.slots.some(p=>p.x===x&&p.y===y)||m.lairs?.some(p=>p.x===x&&p.y===y)||Math.abs(x-m.spawn.x)+Math.abs(y-m.spawn.y)<=1||m.stairs&&Math.abs(x-m.stairs.x)+Math.abs(y-m.stairs.y)<=1)continue;
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>m.cells[(y+dy)*m.w+x+dx]==='#'))candidates.push({x,y});
 }
 let count=0;
 for(const q of candidates){
  if(count>=6)break;
  const prop=theme[(count+m.variant)%theme.length];
  m.props.push({...q,prop,facing:q.x===1?'e':q.x===m.w-2?'w':'s'});
  if(interiorLayoutAccessible(m))count++;else m.props.pop();
 }
}
export function interiorLayoutAccessible(m:InteriorMap):boolean{
 const solid=interiorSolidGrid(m),start=m.spawn.y*m.w+m.spawn.x;if(solid[start])return false;
 const seen=new Set([start]),queue=[start];
 for(let k=0;k<queue.length;k++){const i=queue[k];for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const x=i%m.w+dx,y=Math.floor(i/m.w)+dy,j=y*m.w+x;if(x<0||y<0||x>=m.w||y>=m.h||solid[j]||seen.has(j))continue;seen.add(j);queue.push(j);}}
 for(let i=0;i<solid.length;i++)if(!solid[i]&&!seen.has(i))return false;
 const approach=(p:{x:number;y:number})=>seen.has(p.y*m.w+p.x)||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const x=p.x+dx,y=p.y+dy;return x>=0&&y>=0&&x<m.w&&y<m.h&&seen.has(y*m.w+x);});
 return seen.has(m.exit.y*m.w+m.exit.x)&&m.props.every(approach)&&m.slots.every(approach);
}

// Pure: the same template + level + variant + storey always gives the same map (generated lazily, never saved).
export function buildInteriorMap(id: InteriorTemplateId, level: number, variant = 0, storey = 0): InteriorMap {
  const list = INTERIOR_TEMPLATES[id];
  const v = Math.max(0, Math.min(list.length - 1, variant));
  const up = storey > 0 ? INTERIOR_UPPER_TEMPLATES[id] : undefined;
  return buildFromTemplate(up ?? list[v], level, v, up ? 1 : 0);
}

// Gap closure G5: the seats of a map (chairs beside a table) and the way a seated NPC faces (toward the table).
export function interiorSeats(m: InteriorMap): { x: number; y: number; face: InteriorFacing }[] {
  const table = new Set(m.props.filter((p) => p.prop === "table").map((p) => p.y * m.w + p.x));
  const out: { x: number; y: number; face: InteriorFacing }[] = [];
  for (const p of m.props) {
    if (p.prop !== "chair") continue;
    const dir = ([[1, 0, "r"], [-1, 0, "l"], [0, 1, "d"], [0, -1, "u"]] as const).find(([dx, dy]) => table.has((p.y + dy) * m.w + p.x + dx));
    if (dir) out.push({ x: p.x, y: p.y, face: dir[2] });
  }
  return out;
}

// Solid cells of a built map (walls, nothing, solid props); the exit mat is walkable.
export function interiorSolidGrid(m: InteriorMap): Uint8Array {
  const g = new Uint8Array(m.w * m.h);
  for (let i = 0; i < g.length; i++) g[i] = m.cells[i] === "#" || m.cells[i] === " " ? 1 : 0;
  for (const p of m.props) if (!INTERIOR_WALKABLE_PROPS.has(p.prop)) g[p.y * m.w + p.x] = 1;
  return g;
}

// ---- wire ----
// One NPC drawn inside (bound by the server to a colonist / a settlement's role). x / y: where it starts (tiles);
// it moves by `interiorNpcs` (InteriorNpcLive).
export interface InteriorNpcSnapshot {
  specialId?: string;
  id: string;
  name: string;
  roleLabel: string;
  x: number;
  y: number;
  color: number;
  // Art: a colonist kind ("bishop", "villager", ...).
  kind: string;
  // Gap closure G5: keeper (stays at the station), resident (day wander / dusk table / night bed), patron (seated),
  // sleeper (in bed).
  act: InteriorNpcAct;
  // Named roles: this named person has work for you (the client marks the name with a gold "!").
  quest?: boolean;
}
export type InteriorNpcAct = "keeper" | "resident" | "patron" | "sleeper";
export type InteriorFacing = "l" | "r" | "u" | "d";
export type InteriorNpcPose = "idle" | "walk" | "work" | "sit" | "sleep";
// Message `interiorNpcs`: every NPC's live position (tiles, fractional), facing, pose and greeting bubble.
export interface InteriorNpcLive {
  id: string;
  x: number;
  y: number;
  face: InteriorFacing;
  pose: InteriorNpcPose;
  say?: string;
}
// Message `interior` view: the map (tiles), its NPCs, the chest (own buildings: contents; null: not yours / none),
// whether the bed is yours to sleep in, and how many hostiles are near the door.
export interface InteriorView {
  instanceVariant?:number;
  exploration?:import("./adventure.js").ExplorationView;
  furniture?:import("./interactables.js").FurnitureLive[];
  key: string;
  tx: number;
  ty: number;
  map: InteriorMap;
  npcs: InteriorNpcSnapshot[];
  chest: Partial<Record<PackGood, number>> | null;
  chestCap: number;
  editable?: boolean;
  homeDesign?: import("./playerBases.js").HomeDesign;
  canSleep: boolean;
  threat: number;
  // The settlement / owner shown in the title ("Your House", "Tavern of Ashford", "Saint Wren's Abbey").
  title: string;
  // Deep mines: a mine's status (clear / infested / cleared), monsters left and hazards now.
  mine?: import("./mines.js").MineView;
}
