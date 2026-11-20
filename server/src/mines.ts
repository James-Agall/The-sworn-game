// mines.ts: Deep mines (docs/colony2d/PLAN-agri-industry-winter-mines.md phase 3; ROADMAP "Deep mines — landed";
// numbers in shared/src/mines.ts). One record per own mine tile (Quarry, Iron / Coal / Copper / Tin Mine): clear,
// infested or cleared, its encounter monsters (they live only inside the mine's interior, in interior tiles), its
// hazards (props worn out, a cave-in / flood closing it today). A mine is entered like a house (interiors.ts, template
// "mine", layout = depth); inside, a mine is a combat-enabled interior: the hero's swings hit the monsters (attack
// message) and the monsters bite the hero (damagePlayer with `indoors`). An infested mine's miners flee (colonists.ts
// shelters them) and it produces nothing (mineWorkMult 0) until every monster is dead: killed by the hero inside or by
// soldiers sent in (mineAssault, resolved at once). Infestation is rolled when a shaft reaches a level (a hash of the
// tile, level and world salt: fixed at world gen) and, for deep mines, re-rolled at dawn every few days (guards stop
// it; lamps, props and a Mine Foreman lower it; without a foreman a nest kills a miner). Records are saved (`mines`).
// Automatic rolls (dig, re-infestation, hazards) are off under COLONY_UNLOCK_ALL (older suites); a forced
// infestation (test hook) still works there.
// Layered mines (2026-11-19): the Quarry keeps the rules above (one layer: its depth). The Mine (IronMinePost) has one
// layer per level (layers[0..2]), each its own interior (variant = layer - 1) entered from the shaft on the layer above;
// every layer has its own status / monsters (danger by layer: MINE_LAYER_*), a new layer breaks into a nest, and the
// miners dig the resources of every clear / cleared open layer in turn (mineBatch). Under COLONY_UNLOCK_ALL a Mine digs
// iron ore like the old Iron Mine.
import { TICK_RATE, TILE_SIZE, TileType, HungerMark, type MobKind } from "@colony/shared/protocol";
import { buildInteriorMap, interiorSolidGrid, type InteriorMap } from "@colony/shared/interiors";
import {
  MINE_LAYER_ENCOUNTER, MINE_LAYER_INFEST_CHANCE, MINE_LAYER_MOB_MULT, MINE_LAYER_REINFEST_CHANCE, MINE_LAYER_YIELDS,
  MINE_RESOURCE_LABEL, isLayeredMine, mineLayerResourcesText, type MineResource,
  DEPOSIT_MINES, MINE_ASSAULT_MAX_ROUNDS, MINE_ASSAULT_MAX_SOLDIERS, MINE_ASSAULT_RADIUS_TILES, MINE_ATTACK_DEATHS,
  MINE_BAD_AIR_SPEED, MINE_CAVE_IN_CHANCE, MINE_CAVE_IN_HURT, MINE_CLEAR_GOLD, MINE_CLEAR_GRACE_DAYS, MINE_ENCOUNTER_BY_LEVEL,
  MINE_FLOOD_CHANCE, MINE_FOREMAN_LEVEL, MINE_GUARD_RADIUS_TILES, MINE_HERO_BOW_REACH_TILES, MINE_HERO_REACH_TILES,
  MINE_HERO_SPEAR_REACH_TILES, MINE_INFEST_CHANCE_BY_LEVEL, MINE_LABEL, MINE_LOOT_BONES_CHANCE, MINE_LOOT_GEM_CHANCE,
  MINE_LOOT_ORE, MINE_MOB_AGGRO_TILES, MINE_MOB_REACH_TILES, MINE_MOB_SEND_TICKS, MINE_MOB_STATS, MINE_MOB_WAKE_TILES,
  MINE_PROPS_WEAR_DAYS, MINE_REINFEST_CHANCE, MINE_REINFEST_EVERY_DAYS, MINE_REINFEST_FOREMAN_MULT, MINE_REINFEST_LIT_MULT,
  MINE_REINFEST_PROPPED_MULT, MINE_STATUS_LABEL, MINE_TILES, isMineTile, type MineInfo, type MineMobLive, type MineStatus,
  type MineView, MINE_LAYER_PICK, MINE_HERO_CAVE_IN_CHANCE, MINE_HERO_CAVE_IN_HURT, MINE_DANGER_LABEL, MINE_RISK_LABEL, mineRiskOf,
} from "@colony/shared/mines";
import type { ItemId } from "@colony/shared/progression";
import type { Colonist, Mob, Player } from "./types.js";
import { GAME_DAY_TICKS, dt } from "./constants.js";
import { colonists, players, state, type Clan } from "./state.js";
import { getBuildingLevel, inBounds, ownerAt, tileIndex } from "./tiles.js";
import { tileIndicesOf } from "./chunks.js";
import { clanById, clanIdAt, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { sendTo } from "./saves.js";
import { sendEvent } from "./construction.js";
import { damageColonist, damagePlayer } from "./combat.js";
import { heroProfileOf, heroRewardsForKill, playerAttackCooldownTicks, playerDamage, playerMaxHp } from "./heroes.js";
import { isSoldierKind, unitStats } from "./units.js";
import { addItem, bronzeToolMult, itemCount, takeItem, workerLevel } from "./progression.js";
import { exitInterior } from "./interiors.js";

interface MineMob {
  id: string;
  kind: MobKind;
  // Interior tiles (fractional; a whole number is a tile's centre, like the interior NPCs).
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  cdTicks: number;
  cd: number;
  awake: boolean;
  face: "l" | "r";
  act: MineMobLive["act"];
  path: { x: number; y: number }[];
  repathAt: number;
}
// One layer (the Quarry has one; a Mine one per open level). Game days: cleared on, last re-infestation roll.
interface LayerRec {
  status: MineStatus;
  mobs: MineMob[];
  clearedDay: number;
  rollDay: number;
}
interface MineRec {
  tx: number;
  ty: number;
  // The depth the record has seen (rolled up to).
  level: number;
  // A Mine (layers) or the Quarry (one layer, its depth = level).
  layered: boolean;
  layers: LayerRec[];
  // Game days (cycleTick / GAME_DAY_TICKS): last prop worn, closed (cave-in / flood) on.
  propsDay: number;
  closedDay: number;
  closedWhy: string;
  unpropped: boolean;
  // The Mine's production rotation.
  turn: number;
}
const mines = new Map<string, MineRec>();
// Old saves (no `mines`): the first scan records every standing mine as clear at its level (no roll).
let seedExisting = false;
// Test hook: every roll (infest / hazards / loot) returns this instead of Math.random (null: random).
let forcedRoll: number | null = null;
let nextMobId = 1;
// Per player: the last interiorMobs JSON sent.
const mobsSent = new Map<string, string>();

const keyOf = (x: number, y: number) => `${x},${y}`;
const today = () => Math.floor(state.cycleTick / GAME_DAY_TICKS);
const roll = () => forcedRoll ?? Math.random();
const gatesOff = () => state.testUnlockAll;
const clanAt = (r: MineRec): Clan => clanById(clanIdAt(r.tx, r.ty));
const itemsOf = (clan: Clan, id: ItemId) => (clan.progress.items[id] ?? []).reduce((a, b) => a + b, 0);
const aliveIn = (L: LayerRec | undefined) => (L ? L.mobs.filter((m) => m.hp > 0) : []);
const alive = (r: MineRec) => r.layers.flatMap(aliveIn);
const labelOf = (r: MineRec) => MINE_LABEL[state.tiles[tileIndex(r.tx, r.ty)]] ?? "Mine";
// "the Mine's level 2" / "the Quarry".
const layerLabel = (r: MineRec, li: number) => (r.layered ? `${labelOf(r)}'s level ${li + 1}` : labelOf(r));
// The danger depth of a layer (Quarry: its level) and its layout (interior variant).
const depthOf = (r: MineRec, li: number) => (r.layered ? li + 1 : Math.max(1, r.level));
const variantOf = (r: MineRec, li: number) => (r.layered ? li : Math.max(1, Math.min(3, r.level)) - 1);
const anyInfested = (r: MineRec) => r.layers.some((L) => L.status === "infested");
// The layers that produce (open, not infested).
const workable = (r: MineRec) => r.layers.filter((L, li) => li < Math.max(1, r.level) && L.status !== "infested");

function hash01(x: number, y: number, level: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (level * 83492791) ^ state.worldNoiseSalt;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The layout of a mine at a building level and variant (interiors.ts interiorTemplateAt) and its walls, cached.
const mapCache = new Map<string, { map: InteriorMap; solid: Uint8Array }>();
function mineMap(level: number, variant: number) {
  const l = Math.max(1, Math.min(3, level));
  const k = `${l}:${variant}`;
  let m = mapCache.get(k);
  if (!m) {
    const map = buildInteriorMap("mine", l, variant);
    mapCache.set(k, (m = { map, solid: interiorSolidGrid(map) }));
  }
  return m;
}
const layerMap = (r: MineRec, li: number) => mineMap(Math.max(1, r.level), variantOf(r, li));

// ---- records ----
export function mineRecAt(tx: number, ty: number): MineRec | undefined {
  return mines.get(keyOf(tx, ty));
}
// Any layer infested (the Quarry: infested).
export function isMineInfested(tx: number, ty: number): boolean {
  const r = mineRecAt(tx, ty);
  return !!r && anyInfested(r);
}

// The posted miners of a mine (people at work there).
function minersAt(r: MineRec): Colonist[] {
  return Array.from(colonists.values()).filter((c) => c.postX === r.tx && c.postY === r.ty && c.person && c.hp > 0 && !c.training && !c.callUp);
}
// A Mine Foreman: a posted miner of MINE_FOREMAN_LEVEL or more (the most experienced one).
function foremanOf(r: MineRec): Colonist | undefined {
  let best: Colonist | undefined;
  for (const c of minersAt(r)) if (workerLevel(c) >= MINE_FOREMAN_LEVEL && (!best || workerLevel(c) > workerLevel(best))) best = c;
  return best;
}
const hasForeman = (r: MineRec) => !!foremanOf(r);
// One of the clan's soldiers within MINE_GUARD_RADIUS_TILES of the mine.
function guardedBy(r: MineRec): Colonist | undefined {
  const cx = (r.tx + 0.5) * TILE_SIZE;
  const cy = (r.ty + 0.5) * TILE_SIZE;
  const clan = clanIdAt(r.tx, r.ty);
  for (const c of colonists.values()) {
    if (c.hp <= 0 || (c.clan ?? 0) !== clan || !isSoldierKind(c.kind)) continue;
    if (Math.hypot(c.x - cx, c.y - cy) <= MINE_GUARD_RADIUS_TILES * TILE_SIZE) return c;
  }
  return undefined;
}

function encounterOf(r: MineRec, li: number) {
  return r.layered ? MINE_LAYER_ENCOUNTER[Math.min(2, li)] : MINE_ENCOUNTER_BY_LEVEL[Math.max(1, Math.min(3, depthOf(r, li))) - 1];
}
function pickKind(r: MineRec, li: number): MobKind {
  const kinds = encounterOf(r, li).kinds;
  let x = Math.random() * kinds.reduce((a, k) => a + k.weight, 0);
  for (const k of kinds) if ((x -= k.weight) < 0) return k.kind;
  return kinds[0].kind;
}

function newMob(kind: MobKind, mult: number, x: number, y: number, hp?: number): MineMob | null {
  const st = MINE_MOB_STATS[kind];
  if (!st) return null;
  const maxHp = Math.round(st.hp * mult);
  return {
    id: `mm${nextMobId++}`, kind, x, y, hp: Math.max(1, Math.min(maxHp, hp ?? maxHp)), maxHp, damage: Math.round(st.damage * mult * 10) / 10, speed: st.speed,
    cdTicks: st.cooldownTicks, cd: 0, awake: false, face: "r", act: "sleep", path: [], repathAt: 0,
  };
}
const multOf = (r: MineRec, li: number) => (r.layered ? MINE_LAYER_MOB_MULT[Math.min(2, li)] : 1);

function spawnEncounter(r: MineRec, li: number, kinds?: MobKind[]) {
  const enc = encounterOf(r, li);
  const n = kinds?.length ?? enc.count[0] + Math.floor(Math.random() * (enc.count[1] - enc.count[0] + 1));
  const { map } = layerMap(r, li);
  const lairs = map.lairs ?? [map.spawn];
  const L = r.layers[li];
  L.mobs = [];
  for (let i = 0; i < n; i++) {
    const at = lairs[i % lairs.length];
    const m = newMob(kinds?.[i] ?? pickKind(r, li), multOf(r, li), at.x, at.y);
    if (!m) continue;
    m.face = i % 2 ? "l" : "r";
    L.mobs.push(m);
  }
}

// A layer becomes infested (why: "dug" a new depth, "returned" at dawn, "forced" by a test).
function infest(r: MineRec, li: number, why: "dug" | "returned" | "forced", kinds?: MobKind[]) {
  const L = r.layers[li];
  if (!L) return;
  L.status = "infested";
  spawnEncounter(r, li, kinds);
  const label = labelOf(r);
  const where = layerLabel(r, li);
  let deaths = 0;
  if (why === "returned" && !hasForeman(r)) {
    for (const c of minersAt(r).slice(0, MINE_ATTACK_DEATHS)) {
      damageColonist(c, c.hp + c.maxHp);
      deaths++;
    }
  }
  const what = L.mobs.length;
  const text = why === "dug"
    ? r.layered
      ? `Your miners broke into a nest opening the ${where}: ${what} monsters inside. It yields nothing until you clear it (E at the Mine's door, then down) or send soldiers in`
      : `Your miners broke into a nest digging the ${label} deeper: ${what} monsters inside. The miners fled; it yields nothing until you clear it (E at its door) or send soldiers in`
    : why === "returned"
      ? `Monsters crawled back into the ${r.layered ? where : `deep ${label}`}${deaths ? `: ${deaths} miner${deaths === 1 ? "" : "s"} killed` : hasForeman(r) ? ": the Mine Foreman got the miners out" : ""}. Clear it out (E at its door) or send soldiers in`
      : `The ${where} is infested: ${what} monsters inside`;
  withClan(clanAt(r), () => broadcastEvent("raid", text));
}

function clearLayer(r: MineRec, li: number, by: string) {
  const L = r.layers[li];
  L.status = "cleared";
  L.mobs = [];
  L.clearedDay = today();
  L.rollDay = today();
  withClan(clanAt(r), () => {
    state.stock.gold += MINE_CLEAR_GOLD;
    broadcastEvent("milestone", `The ${layerLabel(r, li)} is cleared${by ? ` by ${by}` : ""} (+${MINE_CLEAR_GOLD} gold): the miners ${r.layered ? `dig ${mineLayerResourcesText(li + 1)} there` : "go back to work"}`);
  });
}

const newLayer = (): LayerRec => ({ status: "clear", mobs: [], clearedDay: -1e9, rollDay: today() });

// When a shaft reaches a level: the depth's chance, from a hash fixed at world gen. A Mine opens a new layer (its
// own nest); the Quarry's one layer is re-rolled at its new depth.
function rollDepth(r: MineRec, level: number) {
  if (r.layered) {
    while (r.layers.length < level) r.layers.push(newLayer());
    const li = level - 1;
    if (gatesOff()) return;
    const chance = MINE_LAYER_INFEST_CHANCE[Math.min(2, li)] ?? 0;
    if (chance > 0 && (forcedRoll ?? hash01(r.tx, r.ty, level)) < chance) {
      r.level = level;
      infest(r, li, "dug");
    }
    return;
  }
  if (gatesOff() || r.layers[0].status === "infested") return;
  const chance = MINE_INFEST_CHANCE_BY_LEVEL[Math.max(1, Math.min(3, level)) - 1] ?? 0;
  if (chance > 0 && (forcedRoll ?? hash01(r.tx, r.ty, level)) < chance) {
    r.level = level;
    infest(r, 0, "dug");
  }
}

function newRec(tx: number, ty: number, level: number, layered: boolean): MineRec {
  const d = today();
  const layers = Array.from({ length: layered ? Math.max(0, level) : 1 }, newLayer);
  return { tx, ty, level, layered, layers, propsDay: d, closedDay: -1, closedWhy: "", unpropped: false, turn: 0 };
}

// Once a second: a record per own mine (new mines and deeper shafts roll), gone mines dropped.
function syncMines() {
  const seen = new Set<string>();
  for (const t of MINE_TILES) {
    for (const i of tileIndicesOf(t)) {
      if (ownerAt(i) !== 0) continue;
      const x = i % state.WORLD_TILES_X;
      const y = Math.floor(i / state.WORLD_TILES_X);
      const key = keyOf(x, y);
      seen.add(key);
      const level = Math.max(1, Math.min(3, getBuildingLevel(x, y)));
      const layered = isLayeredMine(t);
      let r = mines.get(key);
      if (r && r.layered !== layered) r = undefined;
      if (!r) mines.set(key, (r = newRec(x, y, seedExisting ? level : 0, layered)));
      while (r.level < level) {
        const next = r.level + 1;
        rollDepth(r, next);
        r.level = Math.max(r.level, next);
      }
      if (r.level > level) {
        r.level = level;
        if (r.layered) r.layers.length = level;
      }
    }
  }
  seedExisting = false;
  for (const k of mines.keys()) if (!seen.has(k)) mines.delete(k);
}

// ---- production (colonists.ts / progression.ts) ----
// Work speed at a mine post: 0 while infested (a Mine: every open layer) or closed today (cave-in / flood),
// MINE_BAD_AIR_SPEED in a deep shaft without a vent, else 1. Posts that are not mines: 1.
export function mineWorkMult(tx: number, ty: number): number {
  const r = mineRecAt(tx, ty);
  if (!r) return 1;
  if (workable(r).length === 0) return 0;
  if (gatesOff()) return 1;
  if (r.closedDay === today()) return 0;
  if (r.level >= 3 && itemsOf(clanAt(r), "mineVent") < 1) return MINE_BAD_AIR_SPEED;
  return 1;
}
// colonists.ts: a civilian posted at a mine with no layer to work flees (shelters) by day.
export function minerFlees(c: Colonist): boolean {
  const r = mineRecAt(c.postX, c.postY);
  return !!r && workable(r).length === 0;
}

function amountOf(res: MineResource): number {
  return res === "iron" ? state.stock.iron : itemCount(res);
}
// colonists.ts: one miner's batch at a Mine (in its clan): 1 + `extra` of the next resource of the clear / cleared
// open layers under its cap. False when this is not a gated Mine (the caller digs the legacy iron).
export function mineBatch(c: Colonist, extra: number): boolean {
  const r = mineRecAt(c.postX, c.postY);
  if (!r || !r.layered || gatesOff()) return false;
  const options: MineResource[] = [];
  r.layers.forEach((L, li) => {
    if (li >= r.level || L.status === "infested") return;
    for (const y of MINE_LAYER_YIELDS[li] ?? []) if (amountOf(y.res) < y.cap) options.push(y.res);
  });
  if (options.length === 0) return true;
  const res = options[r.turn++ % options.length];
  if (res === "iron") state.stock.iron += 1 + extra;
  else addItem(res, 1 + extra);
  return true;
}

// ---- the hero at a Mine's ore face (herolife.ts personal work; 2026-11-20) ----
// The resources the hero can dig on a layer: each with the layer's cap (the miners' cap) and the layer's pickaxe.
export function mineDigRows(tx: number, ty: number, layer: number): { res: MineResource; label: string; cap: number; pick: ItemId }[] {
  const r = mineRecAt(tx, ty);
  if (!r || !r.layered || layer < 1 || layer > r.layers.length) return [];
  return (MINE_LAYER_YIELDS[layer - 1] ?? []).map((y) => ({ res: y.res, label: MINE_RESOURCE_LABEL[y.res], cap: y.cap, pick: MINE_LAYER_PICK[layer - 1] }));
}
// Why the hero cannot dig on this layer now ("" = can): a nest, a cave-in / flood today.
export function mineDigBlock(tx: number, ty: number, layer: number): string {
  const r = mineRecAt(tx, ty);
  const L = r?.layers[layer - 1];
  if (!r || !L) return "This level is not open";
  if (L.status === "infested") return "Clear the nest on this level first";
  if (!gatesOff() && r.closedDay === today()) return r.closedWhy === "flood" ? "The Mine is flooded today (a Bucket pump keeps it dry)" : "Cave-in: the Mine is closed today (keep timber props in store)";
  return "";
}
// The hero's dig speed: bad air in a deep Mine without a vent; bronze tools in store (as the miners).
// Per hero: the tick its digging last ran (digging has its own cave-in roll; heroPresenceHazard is for standing).
const heroDigTick = new Map<string, number>();
export function mineHeroDigSpeed(tx: number, ty: number, p?: Player): number {
  if (p) heroDigTick.set(p.id, state.cycleTick);
  const r = mineRecAt(tx, ty);
  if (!r || gatesOff()) return 1;
  const air = r.level >= 3 && itemsOf(clanAt(r), "mineVent") < 1 ? MINE_BAD_AIR_SPEED : 1;
  return air * bronzeToolMult("hero");
}
// A finished batch in an unpropped shaft (layer 2+, no timber props in store) may bring the roof down: the hero is
// hurt, the batch is lost and the Mine closes for the day. Returns the toast ("" = no cave-in).
export function mineHeroCaveIn(p: Player, tx: number, ty: number, layer: number): string {
  const r = mineRecAt(tx, ty);
  if (!r || gatesOff() || layer < 2 || itemsOf(clanAt(r), "timberProps") > 0 || roll() >= MINE_HERO_CAVE_IN_CHANCE) return "";
  r.closedDay = today();
  r.closedWhy = "cave-in";
  p.hp = Math.max(1, p.hp - playerMaxHp(p) * MINE_HERO_CAVE_IN_HURT);
  return "Cave-in! No timber props in store to shore up the shaft: you are hurt, the batch is lost and the Mine is closed today";
}

// A hero merely standing inside (not digging): in an unpropped shaft (layer 2+, no timber props in store), or in a deep
// layer (3) without an Air vent in store, the first check of each game day rolls MINE_HERO_CAVE_IN_CHANCE. A cave-in
// hurts as the digging one does (never below 1 HP) and closes the Mine for the day; bad air hurts the same but leaves
// it open. One roll per hero per day (no double hit); nothing in a closed Mine or with the gates off.
const presenceDay = new Map<string, number>();
function heroPresenceHazard(r: MineRec, li: number, p: Player) {
  const d = today();
  if (gatesOff() || r.closedDay === d || presenceDay.get(p.id) === d || state.cycleTick - (heroDigTick.get(p.id) ?? -99) < TICK_RATE * 2) return;
  const clan = clanAt(r);
  const depth = depthOf(r, li);
  const caveIn = depth >= 2 && itemsOf(clan, "timberProps") < 1;
  const badAir = depth >= 3 && itemsOf(clan, "mineVent") < 1;
  if (!caveIn && !badAir) return;
  presenceDay.set(p.id, d);
  if (roll() >= MINE_HERO_CAVE_IN_CHANCE) return;
  p.hp = Math.max(1, p.hp - playerMaxHp(p) * MINE_HERO_CAVE_IN_HURT);
  if (caveIn) {
    r.closedDay = d;
    r.closedWhy = "cave-in";
  }
  sendEvent(p, "death", caveIn
    ? "Cave-in! No timber props in store to shore up the shaft: you are hurt and the Mine is closed today"
    : "Bad air! The deep shaft has no Air vent in store: you stagger, choking");
}

// ---- dawn: props wear (cave-ins), floods, re-infestation ----
export function minesDawn() {
  if (gatesOff()) return;
  const d = today();
  for (const r of mines.values()) {
    const clan = clanAt(r);
    const label = labelOf(r);
    withClan(clan, () => {
      for (const L of r.layers) if (L.status === "cleared" && d - L.clearedDay >= MINE_CLEAR_GRACE_DAYS) L.status = "clear";
      if (workable(r).length === 0) return;
      const worked = minersAt(r).length > 0;
      // Timber props wear out in a worked shaft; none to replace them: cave-ins.
      if (r.level >= 2 && worked && d - r.propsDay >= MINE_PROPS_WEAR_DAYS) {
        r.propsDay = d;
        r.unpropped = !takeItem("timberProps", 1);
      }
      if (r.level >= 2 && worked && r.unpropped && roll() < MINE_CAVE_IN_CHANCE) {
        r.closedDay = d;
        r.closedWhy = "cave-in";
        const hurt = minersAt(r)[0];
        if (hurt) hurt.hp = Math.max(1, hurt.hp - hurt.maxHp * MINE_CAVE_IN_HURT);
        broadcastEvent("death", `Cave-in at the ${label}: no timber props left to shore it up (craft more). Closed today${hurt ? `, ${hurt.person?.name ?? "a miner"} hurt` : ""}`);
      }
      if (r.level >= 3 && worked && r.closedDay !== d && itemsOf(clan, "minePump") < 1 && roll() < MINE_FLOOD_CHANCE) {
        r.closedDay = d;
        r.closedWhy = "flood";
        broadcastEvent("build", `The deep ${label} flooded overnight (no Bucket pump in store): closed today`);
      }
      // Nests come back now and then (guards stop it): the Quarry's deep shaft, a Mine's deeper layers.
      r.layers.forEach((L, li) => {
        const base = r.layered ? MINE_LAYER_REINFEST_CHANCE[Math.min(2, li)] ?? 0 : r.level >= 3 ? MINE_REINFEST_CHANCE : 0;
        if (base <= 0 || L.status !== "clear" || d - L.rollDay < MINE_REINFEST_EVERY_DAYS) return;
        L.rollDay = d;
        if (guardedBy(r)) return;
        if (roll() < reinfestChance(r, clan, li)) infest(r, li, "returned");
      });
    });
  }
}

function reinfestChance(r: MineRec, clan: Clan, li: number): number {
  let c = r.layered ? MINE_LAYER_REINFEST_CHANCE[Math.min(2, li)] ?? 0 : MINE_REINFEST_CHANCE;
  if (itemsOf(clan, "mineLamps") > 0) c *= MINE_REINFEST_LIT_MULT;
  if (itemsOf(clan, "timberProps") > 0) c *= MINE_REINFEST_PROPPED_MULT;
  if (hasForeman(r)) c *= MINE_REINFEST_FOREMAN_MULT;
  return c;
}

// ---- loot ----
function lootFor(r: MineRec, li: number, m: MineMob): string[] {
  const got: string[] = [];
  const tile = state.tiles[tileIndex(r.tx, r.ty)];
  if (r.layered) {
    // A Mine: one of the layer's own resources.
    const ys = MINE_LAYER_YIELDS[Math.min(2, li)];
    const res = ys[Math.min(ys.length - 1, Math.floor(roll() * ys.length))].res;
    if (res === "iron") state.stock.iron += MINE_LOOT_ORE;
    else addItem(res, MINE_LOOT_ORE);
    got.push(`${MINE_LOOT_ORE} ${MINE_RESOURCE_LABEL[res]}`);
  } else {
    const dep = DEPOSIT_MINES.find((q) => q.mine === tile);
    if (dep) addItem(dep.item, MINE_LOOT_ORE);
    else state.stock.rock += MINE_LOOT_ORE;
    got.push(`${MINE_LOOT_ORE} ${dep ? dep.item.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase()) : "rock"}`);
  }
  if (m.kind === "skeleton" || roll() < MINE_LOOT_BONES_CHANCE) {
    addItem("bones", 1);
    got.push("bones");
  }
  if (roll() < (MINE_LOOT_GEM_CHANCE[m.kind] ?? 0)) {
    addItem("gems", 1);
    got.push("a rough gem");
  }
  return got;
}

// A monster dies (by the hero `p`, or soldiers): loot to the mine's clan; the last one clears the layer.
function killMob(r: MineRec, li: number, m: MineMob, p: Player | null) {
  m.hp = 0;
  const got = withClan(clanAt(r), () => lootFor(r, li, m));
  if (p) {
    heroRewardsForKill({ kind: m.kind, mark: HungerMark.None, isDeserter: false, maxHp: m.maxHp, damage: m.damage } as unknown as Mob, "p:" + p.id);
    sendTo(p, { type: "event", category: "build", text: `${m.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase())} slain: ${got.join(", ")}` });
  }
  const L = r.layers[li];
  L.mobs = L.mobs.filter((q) => q.hp > 0);
  if (L.mobs.length === 0 && L.status === "infested") clearLayer(r, li, p ? "you" : "your soldiers");
}

// ---- inside: the hero's swing, the monsters' hunt ----
const heroTile = (p: Player) => ({ x: p.interior!.x / TILE_SIZE - 0.5, y: p.interior!.y / TILE_SIZE - 0.5 });
// The layer index the hero inside a mine is on (a Mine: its variant; the Quarry: 0).
const layerOfPlayer = (r: MineRec, p: Player) => (r.layered ? Math.max(0, Math.min(r.layers.length - 1, p.interior?.variant ?? 0)) : 0);
function wake(L: LayerRec, m: MineMob) {
  m.awake = true;
  for (const o of L.mobs) if (!o.awake && Math.hypot(o.x - m.x, o.y - m.y) <= MINE_MOB_WAKE_TILES) o.awake = true;
}

// index.ts: `attack` inside a mine. True when it was handled here (the hero is in a mine).
export function mineHeroAttack(p: Player): boolean {
  const I = p.interior;
  if (!I || I.templateId !== "mine") return false;
  if (p.dead || p.attackCooldownTicks > 0) return true;
  p.attackCooldownTicks = playerAttackCooldownTicks(p);
  const r = mineRecAt(I.tx, I.ty);
  if (!r) return true;
  const li = layerOfPlayer(r, p);
  const L = r.layers[li];
  if (!L || L.status !== "infested") return true;
  const weapon = heroProfileOf(p).equipment.weapon?.kind;
  const reach = weapon === "bow" ? MINE_HERO_BOW_REACH_TILES : weapon === "spear" ? MINE_HERO_SPEAR_REACH_TILES : MINE_HERO_REACH_TILES;
  const h = heroTile(p);
  let best: MineMob | null = null;
  let bestD = Infinity;
  for (const m of aliveIn(L)) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d <= reach && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  if (!best) return true;
  best.hp -= playerDamage(p);
  wake(L, best);
  if (best.hp <= 0) killMob(r, li, best, p);
  return true;
}

// Shortest 4-way path on a mine grid from a to b ([] when none or already there).
function pathOn(grid: { map: InteriorMap; solid: Uint8Array }, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const { map, solid } = grid;
  const { w, h } = map;
  const s = Math.round(from.y) * w + Math.round(from.x);
  const g = Math.round(to.y) * w + Math.round(to.x);
  if (s === g || s < 0 || g < 0 || s >= w * h || g >= w * h) return [];
  const prev = new Int32Array(w * h).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let qi = 0; qi < q.length && prev[g] < 0; qi++) {
    const i = q[qi];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (prev[j] >= 0 || solid[j]) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[g] < 0) return [];
  const out: { x: number; y: number }[] = [];
  for (let i = g; i !== s; i = prev[i]) out.push({ x: i % w, y: Math.floor(i / w) });
  return out.reverse();
}

function stepMobs(r: MineRec, li: number, inside: Player[]) {
  const L = r.layers[li];
  for (const m of aliveIn(L)) {
    let near: { p: Player; x: number; y: number; d: number } | null = null;
    for (const p of inside) {
      if (p.dead || !p.interior) continue;
      const h = heroTile(p);
      const d = Math.hypot(h.x - m.x, h.y - m.y);
      if (!near || d < near.d) near = { p, ...h, d };
    }
    if (m.cd > 0) m.cd--;
    if (!near) {
      m.act = m.awake ? "idle" : "sleep";
      continue;
    }
    if (!m.awake) {
      if (near.d > MINE_MOB_AGGRO_TILES) {
        m.act = "sleep";
        continue;
      }
      wake(L, m);
    }
    m.face = near.x < m.x ? "l" : near.x > m.x ? "r" : m.face;
    if (near.d <= MINE_MOB_REACH_TILES) {
      m.act = "attack";
      m.path = [];
      if (m.cd <= 0) {
        m.cd = m.cdTicks;
        biteHero(near.p, m.damage);
      }
      continue;
    }
    // Hunt: the grid path to the hero's tile, then straight at the hero.
    if (state.cycleTick >= m.repathAt || m.path.length === 0) {
      m.path = pathOn(layerMap(r, li), m, near);
      m.repathAt = state.cycleTick + 10;
    }
    const target = m.path.length > 0 ? m.path[0] : { x: near.x, y: near.y };
    const dx = target.x - m.x;
    const dy = target.y - m.y;
    const d = Math.hypot(dx, dy);
    const step = m.speed * dt;
    if (d <= step) {
      m.x = target.x;
      m.y = target.y;
      if (m.path.length > 0) m.path.shift();
    } else {
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
    }
    m.act = "walk";
  }
}

// A bite indoors. A hero who falls is put back in the world (the legacy instant respawn moves it to a Town Center;
// otherwise the heir rule marks it dead and updateInteriors puts it out at the door).
function biteHero(p: Player, damage: number) {
  const x = p.x;
  const y = p.y;
  damagePlayer(p, damage, true);
  if (p.interior && !p.dead && (p.x !== x || p.y !== y)) {
    const at = { x: p.x, y: p.y };
    exitInterior(p, "You fell in the mine and woke at a Town Center");
    p.x = at.x;
    p.y = at.y;
  }
}

const liveOf = (L: LayerRec | undefined): MineMobLive[] =>
  aliveIn(L).map((m) => ({ id: m.id, kind: m.kind, x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, hp: Math.ceil(m.hp), maxHp: m.maxHp, face: m.face, act: m.act }));

// sim.ts, once a tick: records (once a second), the monsters of every mine layer a hero is in, their positions out.
export function updateMines() {
  if (state.cycleTick % TICK_RATE === 0) syncMines();
  const inMine = new Map<string, { r: MineRec | undefined; li: number; ps: Player[] }>();
  for (const p of players.values()) {
    const I = p.interior;
    if (!I || I.templateId !== "mine" || p.dead) {
      mobsSent.delete(p.id);
      continue;
    }
    const r = mines.get(I.key);
    const li = r ? layerOfPlayer(r, p) : 0;
    const k = `${I.key}#${li}`;
    const g = inMine.get(k);
    if (g) g.ps.push(p);
    else inMine.set(k, { r, li, ps: [p] });
  }
  for (const { r, li, ps } of inMine.values()) {
    const L = r?.layers[li];
    if (r && L && L.status === "infested") stepMobs(r, li, ps);
    if (r && state.cycleTick % TICK_RATE === 0) for (const p of ps) heroPresenceHazard(r, li, p);
    if (state.cycleTick % MINE_MOB_SEND_TICKS !== 0) continue;
    const live = liveOf(L);
    const json = `${li}:${JSON.stringify(live)}`;
    for (const p of ps) {
      if (!p.interior || mobsSent.get(p.id) === json) continue;
      mobsSent.set(p.id, json);
      sendTo(p, { type: "interiorMobs", key: p.interior.key, mobs: live });
    }
  }
}

// ---- views ----
function hazardLines(r: MineRec, clan: Clan): string[] {
  const out: string[] = [];
  if (gatesOff()) return out;
  if (r.closedDay === today()) out.push(r.closedWhy === "flood" ? "Flooded: closed today (a Bucket pump keeps it dry)" : "Cave-in: closed today (keep timber props in store)");
  if (r.level >= 2 && r.unpropped) out.push("Unpropped: no timber props left in store, cave-ins likely");
  if (r.level >= 3 && itemsOf(clan, "mineVent") < 1) out.push(`Bad air: no Air vent in store (work at x${MINE_BAD_AIR_SPEED})`);
  if (r.level >= 3 && itemsOf(clan, "minePump") < 1) out.push("No Bucket pump in store: the shaft may flood");
  return out;
}

// interiors.ts viewFor: the mine line of the interior view (a Mine: the layer `variant` the hero is on).
export function mineView(tx: number, ty: number, variant = 0): MineView | undefined {
  const r = mineRecAt(tx, ty);
  if (!r) return undefined;
  const li = r.layered ? Math.max(0, Math.min(r.layers.length - 1, variant)) : 0;
  const L = r.layers[li];
  if (!L) return undefined;
  return {
    tile: state.tiles[tileIndex(tx, ty)], status: L.status, monsters: aliveIn(L).length, hazards: hazardLines(r, clanAt(r)),
    ...(r.layered ? { layer: li + 1, layers: r.layers.length, yields: mineLayerResourcesText(li + 1) } : {}),
  };
}

// interiors.ts: posted miners are not inside an infested layer (they fled or work another layer).
export function mineHidesMiners(tx: number, ty: number, variant = 0): boolean {
  const r = mineRecAt(tx, ty);
  if (!r) return false;
  return (r.layers[r.layered ? variant : 0]?.status ?? "clear") === "infested";
}

function soldiersNear(r: MineRec, clan: number): Colonist[] {
  const cx = (r.tx + 0.5) * TILE_SIZE;
  const cy = (r.ty + 0.5) * TILE_SIZE;
  return Array.from(colonists.values())
    .filter((c) => c.hp > 0 && (c.clan ?? 0) === clan && isSoldierKind(c.kind) && Math.hypot(c.x - cx, c.y - cy) <= MINE_ASSAULT_RADIUS_TILES * TILE_SIZE)
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
    .slice(0, MINE_ASSAULT_MAX_SOLDIERS);
}

// The overall status (any layer infested: infested; any cleared: cleared).
const overall = (r: MineRec): MineStatus => (anyInfested(r) ? "infested" : r.layers.some((L) => L.status === "cleared") ? "cleared" : "clear");

// construction.ts buildingInfo: your own mine's panel section.
export function mineInfo(tx: number, ty: number): MineInfo | undefined {
  const r = mineRecAt(tx, ty);
  if (!r || !isMineTile(state.tiles[tileIndex(tx, ty)])) return undefined;
  const clan = clanAt(r);
  const lines: string[] = [];
  const n = alive(r).length;
  if (r.layered) {
    r.layers.forEach((L, li) => {
      const m = aliveIn(L).length;
      const head = `Level ${li + 1} (${mineLayerResourcesText(li + 1)})`;
      if (L.status === "infested") lines.push(`${head}: Infested, ${m} monster${m === 1 ? "" : "s"}: yields nothing until cleared (E at the door, then down; or send soldiers)`);
      else if (L.status === "cleared") lines.push(`${head}: Cleared, worked; safe for ${Math.max(0, MINE_CLEAR_GRACE_DAYS - (today() - L.clearedDay))} more day(s)`);
      else lines.push(`${head}: Clear, worked`);
    });
    if (r.layers.length < 3) lines.push(`Upgrade the Mine to open level ${r.layers.length + 1} (${mineLayerResourcesText(r.layers.length + 1)}): a nest waits there`);
  } else {
    const L = r.layers[0];
    if (L.status === "infested") lines.push(`Infested: ${n} monster${n === 1 ? "" : "s"} inside. The miners have fled and it yields nothing until it is cleared (E at its door to go in, or send soldiers)`);
    else if (L.status === "cleared") lines.push(`Cleared: safe for ${Math.max(0, MINE_CLEAR_GRACE_DAYS - (today() - L.clearedDay))} more day(s)`);
    else lines.push(r.level >= 2 ? "Clear: no monsters in the shaft" : "Clear (a surface adit: never infested)");
  }
  lines.push(...hazardLines(r, clan));
  if (!gatesOff() && r.level >= 2) lines.push(`Timber props: one worn out every ${MINE_PROPS_WEAR_DAYS} days while worked (${itemsOf(clan, "timberProps")} in store)`);
  if (!gatesOff() && !anyInfested(r)) {
    const deep = r.layered ? r.layers.findIndex((_, li) => (MINE_LAYER_REINFEST_CHANCE[li] ?? 0) > 0 && li < r.layers.length) : r.level >= 3 ? 0 : -1;
    if (deep >= 0) {
      const guard = guardedBy(r);
      const pct = Math.round(reinfestChance(r, clan, r.layered ? r.layers.length - 1 : 0) * 100);
      lines.push(guard ? "Deep shaft: guarded by a soldier nearby: nests stay away" : `Deep shaft: nests may return (${pct}% every ${MINE_REINFEST_EVERY_DAYS} days; lamps, props, a Mine Foreman or a soldier within ${MINE_GUARD_RADIUS_TILES} tiles help)`);
    }
  }
  if (r.level >= 2) {
    const fm = foremanOf(r);
    lines.push(fm
      ? `Mine Foreman: ${fm.person?.name ?? "a miner"} (level-${workerLevel(fm)} miner): the miners get out alive when a nest breaks in; nests return half as often`
      : `No Mine Foreman (post a level-${MINE_FOREMAN_LEVEL} miner here): a nest breaking in kills a miner`);
  }
  const soldiers = soldiersNear(r, clan.id).length;
  const reason = !anyInfested(r) ? "Nothing to clear" : soldiers === 0 ? `No soldiers within ${MINE_ASSAULT_RADIUS_TILES} tiles` : "";
  const preview = riskPreview(r, soldiers);
  return { status: overall(r), monsters: n, lines, assault: { soldiers, reason }, ...(preview ? { preview } : {}) };
}

const KIND_PLURAL: Partial<Record<MobKind, string>> = { caveSpider: "cave spiders", caveBat: "cave bats", skeleton: "skeletons", giantSpider: "giant spiders" };
// The next depth's risk before the upgrade digs it (the Mine: its next layer; the Quarry: its next level). The chance
// is the depth's (the actual roll is fixed at world gen, so it stays a gamble); none at the bottom or with gates off.
function riskPreview(r: MineRec, soldiers: number): MineInfo["preview"] {
  const next = r.layered ? r.layers.length + 1 : Math.max(1, r.level) + 1;
  if (gatesOff() || next > 3) return undefined;
  const di = next - 1;
  const chance = r.layered ? MINE_LAYER_INFEST_CHANCE[di] ?? 0 : MINE_INFEST_CHANCE_BY_LEVEL[di] ?? 0;
  const enc = r.layered ? MINE_LAYER_ENCOUNTER[di] : MINE_ENCOUNTER_BY_LEVEL[di];
  const mult = r.layered ? MINE_LAYER_MOB_MULT[di] : 1;
  const risk = mineRiskOf(chance);
  const danger = MINE_DANGER_LABEL[di];
  const pct = Math.round(chance * 100);
  const kinds = enc.kinds.map((k) => KIND_PLURAL[k.kind] ?? k.kind).join(", ");
  const what = r.layered ? `Level ${next} (${mineLayerResourcesText(next)})` : `The ${labelOf(r)} at level ${next}`;
  const lines: string[] = [];
  lines.push(chance > 0
    ? `${what}: nest ${MINE_RISK_LABEL[risk].toLowerCase()} (${pct}%): ${enc.count[0]}-${enc.count[1]} ${kinds}; ${danger.toLowerCase()}${mult > 1 ? ` (hp and bite x${mult})` : ""}`
    : `${what}: no nest`);
  if (chance > 0) lines.push(r.layered ? "A nest there yields nothing until it is cleared (go down and fight, or send soldiers in)" : "A nest stops the miners until it is cleared (go in and fight, or send soldiers in)");
  const back = r.layered ? MINE_LAYER_REINFEST_CHANCE[di] ?? 0 : next >= 3 ? MINE_REINFEST_CHANCE : 0;
  if (back > 0) lines.push(`Once cleared, nests return (${Math.round(back * 100)}% every ${MINE_REINFEST_EVERY_DAYS} days) unless a soldier stands within ${MINE_GUARD_RADIUS_TILES} tiles; lamps, props and a Mine Foreman lower it`);
  if (next >= 2) lines.push(`Shaft: a timber prop wears out every ${MINE_PROPS_WEAR_DAYS} days while worked; with none in store, cave-ins (${Math.round(MINE_CAVE_IN_CHANCE * 100)}% a dawn)`);
  if (next >= 3) lines.push(`Deep: bad air without an Air vent (work x${MINE_BAD_AIR_SPEED}), floods without a Bucket pump (${Math.round(MINE_FLOOD_CHANCE * 100)}% a dawn)`);
  if (chance > 0) lines.push(soldiers > 0 ? `${soldiers} soldier${soldiers === 1 ? "" : "s"} within ${MINE_ASSAULT_RADIUS_TILES} tiles could be sent in` : `No soldiers within ${MINE_ASSAULT_RADIUS_TILES} tiles to send in: you would fight it yourself`);
  return { level: next, chance, risk, danger, lines };
}

// `mineAssault`: the soldiers near your infested mine go in (a Mine: its shallowest infested layer). Resolved at once
// in rounds of a second: each soldier strikes the first monster standing (its damage per cooldown), each monster bites a
// random soldier (soldiers can die). All monsters dead: cleared.
export function handleMineAssault(p: Player, tx: unknown, ty: unknown) {
  if (typeof tx !== "number" || typeof ty !== "number" || !inBounds(tx, ty)) return;
  const r = mineRecAt(tx, ty);
  if (!r || clanIdAt(tx, ty) !== (p.clan ?? 0)) return;
  const li = r.layers.findIndex((L) => L.status === "infested");
  if (li < 0) return sendEvent(p, "build", "Nothing to clear in that mine");
  const L = r.layers[li];
  const squad = soldiersNear(r, p.clan ?? 0);
  if (squad.length === 0) return sendEvent(p, "build", `No soldiers within ${MINE_ASSAULT_RADIUS_TILES} tiles of the mine`);
  const label = layerLabel(r, li);
  let killed = 0;
  withClan(clanAt(r), () => {
    for (let round = 0; round < MINE_ASSAULT_MAX_ROUNDS && aliveIn(L).length > 0; round++) {
      const up = squad.filter((c) => colonists.has(c.id) && c.hp > 0);
      if (up.length === 0) break;
      for (const c of up) {
        const m = aliveIn(L)[0];
        if (!m) break;
        const st = unitStats(c);
        m.hp -= (st.damage * TICK_RATE) / Math.max(1, st.cooldown);
        if (m.hp <= 0) {
          killed++;
          killMob(r, li, m, null);
        }
      }
      for (const m of aliveIn(L)) {
        const hit = squad.filter((c) => colonists.has(c.id) && c.hp > 0);
        if (hit.length === 0) break;
        damageColonist(hit[Math.floor(Math.random() * hit.length)], (m.damage * TICK_RATE) / Math.max(1, m.cdTicks));
      }
    }
    const lost = squad.filter((c) => !colonists.has(c.id) || c.hp <= 0).length;
    const left = aliveIn(L).length;
    const text = left === 0
      ? `Your ${squad.length} soldier${squad.length === 1 ? "" : "s"} cleared the ${label} (${killed} monsters slain${lost ? `, ${lost} fell` : ""})`
      : `Your soldiers were driven out of the ${label}: ${killed} slain, ${lost} fell, ${left} monsters remain`;
    sendEvent(p, left === 0 ? "milestone" : "death", text);
  });
}

// ---- saves / reset / tests ----
interface LayerSave {
  status: MineStatus;
  mobs: { kind: MobKind; x: number; y: number; hp: number }[];
  clearedDay: number;
  rollDay: number;
}
interface MineSave {
  key: string;
  level: number;
  layered: boolean;
  layers: LayerSave[];
  propsDay: number;
  closedDay: number;
  closedWhy: string;
  unpropped: boolean;
  turn: number;
}
export function minesForSave(): MineSave[] {
  return Array.from(mines.entries(), ([key, r]) => ({
    key, level: r.level, layered: r.layered,
    layers: r.layers.map((L) => ({ status: L.status, mobs: aliveIn(L).map((m) => ({ kind: m.kind, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp) })), clearedDay: L.clearedDay, rollDay: L.rollDay })),
    propsDay: r.propsDay, closedDay: r.closedDay, closedWhy: r.closedWhy, unpropped: r.unpropped, turn: r.turn,
  }));
}
export function restoreMines(data: unknown) {
  resetMines();
  // Older saves: every standing mine starts clear at its level (first scan, no roll).
  if (!Array.isArray(data)) {
    seedExisting = true;
    return;
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  for (const e of data as Partial<MineSave>[]) {
    if (!e || typeof e.key !== "string" || !/^\d+,\d+$/.test(e.key) || !Array.isArray(e.layers)) continue;
    const [tx, ty] = e.key.split(",").map(Number);
    const layered = e.layered === true;
    const r = newRec(tx, ty, Math.max(0, Math.min(3, num(e.level, 1))), layered);
    Object.assign(r, { propsDay: num(e.propsDay, r.propsDay), closedDay: num(e.closedDay, -1), closedWhy: typeof e.closedWhy === "string" ? e.closedWhy : "", unpropped: e.unpropped === true, turn: num(e.turn, 0) });
    r.layers = e.layers.slice(0, 3).map((s, li) => {
      const L = newLayer();
      L.status = s?.status === "infested" || s?.status === "cleared" ? s.status : "clear";
      L.clearedDay = num(s?.clearedDay, -1e9);
      L.rollDay = num(s?.rollDay, L.rollDay);
      for (const m of Array.isArray(s?.mobs) ? s.mobs : []) {
        const mob = newMob(m?.kind as MobKind, multOf(r, li), num(m?.x, 1), num(m?.y, 1), num(m?.hp, 1e9));
        if (mob) L.mobs.push(mob);
      }
      if (L.status === "infested" && L.mobs.length === 0) L.status = "cleared";
      return L;
    });
    if (r.layers.length === 0) r.layers.push(newLayer());
    mines.set(e.key, r);
  }
}
export function resetMines() {
  mines.clear();
  mobsSent.clear();
  presenceDay.clear();
  heroDigTick.clear();
  seedExisting = false;
}

// testHook "mine": {tx, ty} picks a mine and `layer` (1-3, default 1; the Quarry has one) a layer of it; `infest`
// (true, or a list of kinds) infests that layer now; `clear` kills its monsters; `roll` (0-1 / null) forces every
// roll; `dawn` runs the dawn step; `sync` scans now; `set` {status?, closedDay?, unpropped?, presenceReset?, heroHp?, propsDay?, rollDay?,
// clearedDay?, level?} edits the record (status / days: the layer's); `wakeAll` wakes its monsters; `place` {i, x, y}
// stands monster i there. Replies the record (status / mobs: the layer's; `layers` every layer) and every record.
export function mineDebug(msg: Record<string, unknown>) {
  if ("roll" in msg) forcedRoll = typeof msg.roll === "number" ? msg.roll : null;
  if (msg.sync === true) syncMines();
  const tx = msg.tx as number;
  const ty = msg.ty as number;
  const r = typeof tx === "number" && typeof ty === "number" ? mineRecAt(tx, ty) : undefined;
  const li = r ? Math.max(0, Math.min(r.layers.length - 1, (typeof msg.layer === "number" ? msg.layer : 1) - 1)) : 0;
  if (r) {
    const L = r.layers[li];
    if (msg.infest) infest(r, li, "forced", Array.isArray(msg.infest) ? (msg.infest as MobKind[]).filter((k) => MINE_MOB_STATS[k]) : undefined);
    if (msg.reinfest === true) infest(r, li, "returned");
    if (msg.clear === true) for (const m of aliveIn(L)) killMob(r, li, m, null);
    if (msg.set && typeof msg.set === "object") {
      const s = msg.set as Record<string, unknown>;
      for (const k of ["closedDay", "propsDay", "level"] as const) if (typeof s[k] === "number") r[k] = s[k] as number;
      for (const k of ["rollDay", "clearedDay"] as const) if (typeof s[k] === "number") L[k] = s[k] as number;
      if (typeof s.unpropped === "boolean") r.unpropped = s.unpropped;
      if (s.presenceReset === true) presenceDay.clear();
      if (typeof s.heroHp === "number") for (const p of players.values()) p.hp = s.heroHp;
      if (s.status === "clear" || s.status === "cleared") {
        L.status = s.status;
        L.mobs = [];
      }
    }
    if (msg.wakeAll === true) for (const m of L.mobs) m.awake = true;
    if (msg.place && typeof msg.place === "object") {
      const q = msg.place as { i?: number; x?: number; y?: number };
      const m = aliveIn(L)[q.i ?? 0];
      if (m && typeof q.x === "number" && typeof q.y === "number") Object.assign(m, { x: q.x, y: q.y, path: [] });
    }
  }
  if (msg.dawn === true) minesDawn();
  const rec = r ? mineRecAt(r.tx, r.ty) : undefined;
  const L = rec?.layers[li];
  return {
    mine: rec && L ? {
      tx: rec.tx, ty: rec.ty, level: rec.level, layered: rec.layered, layer: li + 1, status: L.status, mobs: liveOf(L), clearedDay: L.clearedDay, rollDay: L.rollDay,
      propsDay: rec.propsDay, closedDay: rec.closedDay, closedWhy: rec.closedWhy, unpropped: rec.unpropped,
      layers: rec.layers.map((q) => ({ status: q.status, mobs: aliveIn(q).length, maxHp: aliveIn(q).map((m) => m.maxHp), kinds: aliveIn(q).map((m) => m.kind) })),
      workMult: mineWorkMult(rec.tx, rec.ty), foreman: hasForeman(rec), guarded: !!guardedBy(rec), info: mineInfo(rec.tx, rec.ty), chance: reinfestChance(rec, clanAt(rec), li),
    } : null,
    all: Array.from(mines.values(), (q) => ({ key: `${q.tx},${q.ty}`, level: q.level, status: overall(q), mobs: alive(q).length, layered: q.layered })),
    day: today(),
    forcedRoll,
  };
}
