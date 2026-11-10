// interiors.ts: Stardew phase 5c (docs PLAN-rimworld-stardew.md 5c; ROADMAP "Stardew layer — phase 5c"). Building
// interiors: the hero steps through the door of a PREFAB building (house, tavern, church, smithy, bakery, shop,
// barracks, hall, barn) into a small separate tile map built from a per-building-type TEMPLATE below (an ASCII grid
// over INTERIOR_LEGEND, like the camp templates in camps.ts). Every interior number lives here (server + client).
// Player-built modular rooms (phases 1-2) are never entered (they keep the roof cutaway).
import { TICK_RATE, TileType } from "./protocol.js";
import type { PackGood } from "./herolife.js";

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
// Client: walk frame time, the idle bob (px, period), the work swing period (ms).
export const INTERIOR_WALK_FRAME_MS = 140;
export const INTERIOR_BOB_PX = 1.5;
export const INTERIOR_BOB_MS = 1400;
export const INTERIOR_WORK_MS = 520;

// ---- templates ----
export type InteriorTemplateId = "house" | "tavern" | "church" | "smithy" | "bakery" | "shop" | "barracks" | "hall" | "barn";
export type InteriorFloor = "wood" | "stone" | "dirt";
export type InteriorProp =
  | "bed" | "bedFine" | "chest" | "table" | "chair" | "hearth" | "lamp" | "rug" | "shelf" | "wardrobe" | "counter"
  | "altar" | "pew" | "anvil" | "oven" | "barrel" | "crates" | "sacks" | "hay" | "weaponRack" | "armourStand" | "banner"
  | "statue" | "throne" | "forge" | "stall" | "workbench" | "candelabra"
  // Gap closure G5 (d): stairs to the upper floor ("U") and back down ("D"); walked onto, not used with E.
  | "stairsUp" | "stairsDown";
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
// except INTERIOR_WALKABLE_PROPS.
export const INTERIOR_LEGEND: Record<string, InteriorSymbol> = {
  "#": { label: "Wall" },
  ".": { label: "Floor" },
  E: { label: "Exit mat" },
  b: { label: "Bed", prop: "bed" },
  q: { label: "Bed (level 2+)", prop: "bed", minLevel: 2 },
  Q: { label: "Fine bed (level 3)", prop: "bedFine", minLevel: 3 },
  c: { label: "Chest", prop: "chest" },
  t: { label: "Table", prop: "table" },
  h: { label: "Chair", prop: "chair" },
  H: { label: "Hearth", prop: "hearth" },
  l: { label: "Lamp (level 2+)", prop: "lamp", minLevel: 2 },
  r: { label: "Rug (level 2+)", prop: "rug", minLevel: 2 },
  s: { label: "Shelf", prop: "shelf" },
  w: { label: "Wardrobe (level 2+)", prop: "wardrobe", minLevel: 2 },
  K: { label: "Counter", prop: "counter" },
  A: { label: "Altar", prop: "altar" },
  p: { label: "Pew", prop: "pew" },
  n: { label: "Anvil", prop: "anvil" },
  o: { label: "Oven", prop: "oven" },
  x: { label: "Barrel", prop: "barrel" },
  X: { label: "Crates", prop: "crates" },
  k: { label: "Sacks", prop: "sacks" },
  y: { label: "Hay", prop: "hay" },
  R: { label: "Weapon rack", prop: "weaponRack" },
  a: { label: "Armour stand", prop: "armourStand" },
  B: { label: "Banner", prop: "banner" },
  S: { label: "Statue (level 3)", prop: "statue", minLevel: 3 },
  T: { label: "High seat", prop: "throne" },
  f: { label: "Forge", prop: "forge" },
  m: { label: "Market stall", prop: "stall" },
  W: { label: "Workbench", prop: "workbench" },
  C: { label: "Candelabra (level 2+)", prop: "candelabra", minLevel: 2 },
  "1": { label: "Keeper", npc: "1" },
  "2": { label: "Second keeper", npc: "2" },
  v: { label: "Resident / patron", npc: "v" },
  U: { label: "Stairs up", prop: "stairsUp" },
  D: { label: "Stairs down", prop: "stairsDown" },
};
export const INTERIOR_WALKABLE_PROPS: ReadonlySet<InteriorProp> = new Set(["rug", "chair", "stairsUp", "stairsDown"]);

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
export const INTERIOR_TEMPLATES: Record<InteriorTemplateId, InteriorTemplate[]> = {
  house: [
    T("house", "House", "wood", "wood", [
      "###########",
      "#b.qH..s.c#",
      "#v.v.....w#",
      "#...rr....#",
      "#..hth..x.#",
      "#l.......l#",
      "#####E#####",
    ]),
    T("house", "House", "wood", "wood", [
      "#########",
      "#b.H..sc#",
      "#v......#",
      "#q.v.ht.#",
      "#....hr.#",
      "#Q.....w#",
      "#l.x...l#",
      "####E####",
    ]),
    T("house", "House", "wood", "wood", [
      "############",
      "#bq..#.H..c#",
      "#v.v.#.....#",
      "#Q.........#",
      "#w...#..hth#",
      "#l...#.x..l#",
      "######E#####",
    ]),
  ],
  tavern: [
    T("tavern", "Tavern", "wood", "wood", [
      "#############",
      "#xX.1.H.s.xc#",
      "#KKKKK......#",
      "#....v..v...#",
      "#.hth..hth..#",
      "#......v....#",
      "#.hth..hth.l#",
      "#U.........C#",
      "######E######",
    ]),
    T("tavern", "Tavern", "wood", "wood", [
      "###########",
      "#H..s.xx.c#",
      "#.........#",
      "#hth.hth.U#",
      "#.........#",
      "#hth.hth..#",
      "#.........#",
      "#KK1K....l#",
      "#####E#####",
    ]),
    T("tavern", "Tavern", "wood", "wood", [
      "#############",
      "#c.x.H...U..#",
      "#K..........#",
      "#K1.hth..hth#",
      "#K..........#",
      "#K..hth..hth#",
      "#x..........#",
      "#s...l...x.C#",
      "######E######",
    ]),
  ],
  church: [
    T("church", "Church", "stone", "stone", [
      "###########",
      "#C..BAB..C#",
      "#....1....#",
      "#.........#",
      "#pp.....pp#",
      "#.........#",
      "#pp..v..pp#",
      "#.........#",
      "#pp..r..pp#",
      "#S.......S#",
      "#####E#####",
    ]),
    T("church", "Church", "stone", "stone", [
      "#########",
      "#C.BAB.C#",
      "#...1...#",
      "#.......#",
      "#pp...pp#",
      "#.......#",
      "#pp.v.pp#",
      "#..r.r..#",
      "#S.....S#",
      "####E####",
    ]),
    T("church", "Church", "stone", "stone", [
      "#############",
      "#S..C.A.C..S#",
      "#.....1.....#",
      "#.ppp...ppp.#",
      "#...........#",
      "#.ppp.v.ppp.#",
      "#...........#",
      "#B....r....B#",
      "######E######",
    ]),
  ],
  smithy: [
    T("smithy", "Smithy", "stone", "stone", [
      "###########",
      "#fn1R.a.xc#",
      "#KKK..W.l.#",
      "#.........#",
      "#..x...X..#",
      "#.........#",
      "#####E#####",
    ]),
    T("smithy", "Smithy", "stone", "stone", [
      "#########",
      "#ff.R.a.#",
      "#.n1....#",
      "#.......#",
      "#KKK.W.c#",
      "#x.....X#",
      "####E####",
    ]),
    T("smithy", "Smithy", "stone", "stone", [
      "###########",
      "#c.x#.ff..#",
      "#...#..n..#",
      "#.R.#..1..#",
      "#.a.......#",
      "#.....KKK.#",
      "#X.......x#",
      "#####E#####",
    ]),
  ],
  bakery: [
    T("bakery", "Bakery", "stone", "wood", [
      "#########",
      "#oo1.k.c#",
      "#KKK.x..#",
      "#.......#",
      "#.hth..l#",
      "#.......#",
      "####E####",
    ]),
    T("bakery", "Bakery", "stone", "wood", [
      "#########",
      "#c.k.oo.#",
      "#x...1..#",
      "#..KKKK.#",
      "#.......#",
      "#hth...l#",
      "####E####",
    ]),
    T("bakery", "Bakery", "stone", "wood", [
      "###########",
      "#o.1.o#k.c#",
      "#.....#x..#",
      "#KK.KK#...#",
      "#.........#",
      "#.hth..k..#",
      "#####E#####",
    ]),
  ],
  shop: [
    T("shop", "Shop", "wood", "wood", [
      "###########",
      "#sXs.1.sxc#",
      "#..KKKKK..#",
      "#.........#",
      "#m.......m#",
      "#..k...X..#",
      "#l.......l#",
      "#####E#####",
    ]),
    T("shop", "Shop", "wood", "wood", [
      "#########",
      "#s.s1s.c#",
      "#.KKKKK.#",
      "#.......#",
      "#m.....m#",
      "#X.k.x.X#",
      "####E####",
    ]),
    T("shop", "Shop", "wood", "wood", [
      "###########",
      "#sss.1.Xc.#",
      "#KKKK.KKK.#",
      "#.........#",
      "#..m...m..#",
      "#.........#",
      "#k.x...X.l#",
      "#####E#####",
    ]),
  ],
  barracks: [
    T("barracks", "Barracks", "wood", "wood", [
      "#############",
      "#bvb.bvb.RaR#",
      "#...........#",
      "#qvq.QvQ....#",
      "#...........#",
      "#.hth..B..xc#",
      "#l..1.....Ul#",
      "######E######",
    ]),
    T("barracks", "Barracks", "wood", "wood", [
      "###########",
      "#b.b.b.b.U#",
      "#v.v.v.v..#",
      "#.........#",
      "#q.q.Q.Q..#",
      "#.........#",
      "#RaR..hth.#",
      "#c..1...x.#",
      "#####E#####",
    ]),
    T("barracks", "Barracks", "wood", "wood", [
      "#############",
      "#bvb.#.RRa.U#",
      "#....#......#",
      "#qvq.......B#",
      "#....#..hth.#",
      "#QvQ.#.1..xc#",
      "#....#......#",
      "######E######",
    ]),
  ],
  hall: [
    T("hall", "Great hall", "stone", "stone", [
      "###############",
      "#B.S..BTB..S.B#",
      "#......1......#",
      "#.....rrr.....#",
      "#C....rrr....C#",
      "#..ttttttt....#",
      "#..hhhhhhh..2.#",
      "#.............#",
      "#H...........H#",
      "#x.bq....s.Ucx#",
      "#######E#######",
    ]),
    T("hall", "Great hall", "stone", "stone", [
      "#############",
      "#B..S.T.S..B#",
      "#.....1.....#",
      "#.....r.....#",
      "#.ttttt...2.#",
      "#.hhhhh.....#",
      "#C.........C#",
      "#H.........H#",
      "#c.x....bqU.#",
      "######E######",
    ]),
    T("hall", "Great hall", "stone", "stone", [
      "###############",
      "#B.S.BTB.S.B#U#",
      "#.....r1r...#.#",
      "#C..........#.#",
      "#..tttttt.....#",
      "#..hhhhhh...2.#",
      "#H...........H#",
      "#c.x.bq..s.x..#",
      "#######E#######",
    ]),
  ],
  barn: [
    T("barn", "Barn", "dirt", "wood", [
      "###########",
      "#yyy.k.XXc#",
      "#.........#",
      "#yy..1..kk#",
      "#.........#",
      "#xx.....xx#",
      "#####E#####",
    ]),
    T("barn", "Barn", "dirt", "wood", [
      "#########",
      "#yy.c.yy#",
      "#.......#",
      "#k..1..k#",
      "#.......#",
      "#xXy..Xx#",
      "####E####",
    ]),
    T("barn", "Barn", "dirt", "wood", [
      "###########",
      "#yyy#.kkXc#",
      "#yy.#.....#",
      "#...#..1..#",
      "#.........#",
      "#yy.....XX#",
      "#x.......x#",
      "#####E#####",
    ]),
  ],
};
// Gap closure G5 (d): the upper floor reached by the "U" stairs (guest rooms / the keepers' bedrooms).
export const INTERIOR_UPPER_TEMPLATES: Partial<Record<InteriorTemplateId, InteriorTemplate>> = {
  tavern: T("tavern", "Tavern, upstairs", "wood", "wood", [
    "###########",
    "#b.#b.#b.c#",
    "#v.#v.#v..#",
    "#.........#",
    "#.x....D.l#",
    "###########",
  ]),
  barracks: T("barracks", "Barracks, officers' rooms", "wood", "wood", [
    "###########",
    "#b.c.#.b.b#",
    "#v...#.v.v#",
    "#.R..#....#",
    "#..D......#",
    "###########",
  ]),
  hall: T("hall", "Great hall, the chambers", "stone", "stone", [
    "#############",
    "#bw.c.#.b.b.#",
    "#v....#.v.v.#",
    "#..r..#.....#",
    "#.H.......D.#",
    "#l.........l#",
    "#############",
  ]),
};
// The stations / furniture a layout must have for its room role (validateInteriorTemplate; upper floors: a bed).
export const INTERIOR_REQUIRED_PROPS: Record<InteriorTemplateId, InteriorProp[]> = {
  house: ["bed", "chest", "hearth"],
  tavern: ["counter", "table", "chair", "hearth", "chest"],
  church: ["altar", "pew"],
  smithy: ["forge", "anvil", "chest"],
  bakery: ["oven", "counter", "chest"],
  shop: ["counter", "chest"],
  barracks: ["bed", "weaponRack", "chest"],
  hall: ["throne", "table", "chest"],
  barn: ["hay", "chest"],
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
// tavern seats.
export function validateInteriorTemplate(t: InteriorTemplate, upper = false): string[] {
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
  for (const p of INTERIOR_REQUIRED_PROPS[t.id]) if (!has(p)) errs.push(`${t.id}: no ${p} (its room role needs one)`);
  if (t.id !== "house" && !m.slots.some((s) => s.slot === "1")) errs.push(`${t.id}: no keeper slot "1"`);
  if (t.id === "house" && !m.slots.some((s) => s.slot === "v")) errs.push(`house: no resident slot "v"`);
  if (t.id === "tavern" && interiorSeats(m).length < INTERIOR_TAVERN_MIN_SEATS) errs.push(`tavern: fewer than ${INTERIOR_TAVERN_MIN_SEATS} seats`);
  if (INTERIOR_UPPER_TEMPLATES[t.id] && !m.stairs) errs.push(`${t.id}: no stairs up to its upper floor`);
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
  [TileType.Market]: "shop",
  [TileType.GoldShop]: "shop",
  [TileType.MilitiaPost]: "barracks",
  [TileType.MilitiaCamp2]: "barracks",
  [TileType.MilitiaCamp3]: "barracks",
  [TileType.TownCenter]: "hall",
  [TileType.CastleLevel2]: "hall",
  [TileType.CastleLevel3]: "hall",
  [TileType.Keep]: "hall",
  [TileType.SiteKeep]: "hall",
  [TileType.BarnPost]: "barn",
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
export const INTERIOR_SLEEP_TEMPLATES: ReadonlySet<InteriorTemplateId> = new Set(["house", "hall"]);

// ---- the built map ----
// cells: one char per tile, row-major ("#" wall, "." floor, "E" exit, " " nothing).
export interface InteriorMap {
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
  props: { prop: InteriorProp; x: number; y: number }[];
  slots: { slot: InteriorNpcSlot; x: number; y: number }[];
  // Upstairs: the "D" stairs (no mat there; leaving needs the ground floor).
  exit: { x: number; y: number };
  // Where the hero appears: the tile just inside the exit mat (upstairs: beside the stairs down).
  spawn: { x: number; y: number };
  // The stairs on this floor ("U" on the ground floor, "D" upstairs), or null.
  stairs: { x: number; y: number } | null;
}

function buildFromTemplate(t: InteriorTemplate, level: number, variant: number, storey: number): InteriorMap {
  const h = t.rows.length;
  const w = t.rows[0].length;
  let cells = "";
  const props: InteriorMap["props"] = [];
  const slots: InteriorMap["slots"] = [];
  let exit = { x: Math.floor(w / 2), y: h - 1 };
  let stairs: InteriorMap["stairs"] = null;
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
  return { templateId: t.id, label: t.label, level, variant, storey, w, h, floor: t.floor, wall: t.wall, cells, props, slots, exit, spawn, stairs };
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
  key: string;
  tx: number;
  ty: number;
  map: InteriorMap;
  npcs: InteriorNpcSnapshot[];
  chest: Partial<Record<PackGood, number>> | null;
  chestCap: number;
  canSleep: boolean;
  threat: number;
  // The settlement / owner shown in the title ("Your House", "Tavern of Ashford", "Saint Wren's Abbey").
  title: string;
}
