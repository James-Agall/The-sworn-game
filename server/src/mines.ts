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
import { TICK_RATE, TILE_SIZE, TileType, HungerMark, type MobKind } from "@colony/shared/protocol";
import { buildInteriorMap, interiorSolidGrid, type InteriorMap } from "@colony/shared/interiors";
import {
  DEPOSIT_MINES, MINE_ASSAULT_MAX_ROUNDS, MINE_ASSAULT_MAX_SOLDIERS, MINE_ASSAULT_RADIUS_TILES, MINE_ATTACK_DEATHS,
  MINE_BAD_AIR_SPEED, MINE_CAVE_IN_CHANCE, MINE_CAVE_IN_HURT, MINE_CLEAR_GOLD, MINE_CLEAR_GRACE_DAYS, MINE_ENCOUNTER_BY_LEVEL,
  MINE_FLOOD_CHANCE, MINE_FOREMAN_LEVEL, MINE_GUARD_RADIUS_TILES, MINE_HERO_BOW_REACH_TILES, MINE_HERO_REACH_TILES,
  MINE_HERO_SPEAR_REACH_TILES, MINE_INFEST_CHANCE_BY_LEVEL, MINE_LABEL, MINE_LOOT_BONES_CHANCE, MINE_LOOT_GEM_CHANCE,
  MINE_LOOT_ORE, MINE_MOB_AGGRO_TILES, MINE_MOB_REACH_TILES, MINE_MOB_SEND_TICKS, MINE_MOB_STATS, MINE_MOB_WAKE_TILES,
  MINE_PROPS_WEAR_DAYS, MINE_REINFEST_CHANCE, MINE_REINFEST_EVERY_DAYS, MINE_REINFEST_FOREMAN_MULT, MINE_REINFEST_LIT_MULT,
  MINE_REINFEST_PROPPED_MULT, MINE_STATUS_LABEL, MINE_TILES, isMineTile, type MineInfo, type MineMobLive, type MineStatus,
  type MineView,
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
import { heroProfileOf, heroRewardsForKill, playerAttackCooldownTicks, playerDamage } from "./heroes.js";
import { isSoldierKind, unitStats } from "./units.js";
import { addItem, takeItem, workerLevel } from "./progression.js";
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
interface MineRec {
  tx: number;
  ty: number;
  // The depth the record has seen (rolled up to).
  level: number;
  status: MineStatus;
  mobs: MineMob[];
  // Game days (cycleTick / GAME_DAY_TICKS): cleared on, last re-infestation roll, last prop worn, closed (cave-in /
  // flood) on.
  clearedDay: number;
  rollDay: number;
  propsDay: number;
  closedDay: number;
  closedWhy: string;
  unpropped: boolean;
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
const alive = (r: MineRec) => r.mobs.filter((m) => m.hp > 0);
const labelOf = (r: MineRec) => MINE_LABEL[state.tiles[tileIndex(r.tx, r.ty)]] ?? "Mine";

function hash01(x: number, y: number, level: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (level * 83492791) ^ state.worldNoiseSalt;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The layout of a mine at a level (variant = depth: interiors.ts interiorTemplateAt) and its walls, cached.
const mapCache = new Map<number, { map: InteriorMap; solid: Uint8Array }>();
function mineMap(level: number) {
  const l = Math.max(1, Math.min(3, level));
  let m = mapCache.get(l);
  if (!m) {
    const map = buildInteriorMap("mine", l, l - 1);
    mapCache.set(l, (m = { map, solid: interiorSolidGrid(map) }));
  }
  return m;
}

// ---- records ----
export function mineRecAt(tx: number, ty: number): MineRec | undefined {
  return mines.get(keyOf(tx, ty));
}
export function isMineInfested(tx: number, ty: number): boolean {
  return mineRecAt(tx, ty)?.status === "infested";
}

// The posted miners of a mine (people at work there).
function minersAt(r: MineRec): Colonist[] {
  return Array.from(colonists.values()).filter((c) => c.postX === r.tx && c.postY === r.ty && c.person && c.hp > 0 && !c.training && !c.callUp);
}
// A Mine Foreman: a posted miner of MINE_FOREMAN_LEVEL or more.
function hasForeman(r: MineRec): boolean {
  return minersAt(r).some((c) => workerLevel(c) >= MINE_FOREMAN_LEVEL);
}
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

function pickKind(level: number): MobKind {
  const kinds = MINE_ENCOUNTER_BY_LEVEL[Math.max(1, Math.min(3, level)) - 1].kinds;
  let x = Math.random() * kinds.reduce((a, k) => a + k.weight, 0);
  for (const k of kinds) if ((x -= k.weight) < 0) return k.kind;
  return kinds[0].kind;
}

function spawnEncounter(r: MineRec, kinds?: MobKind[]) {
  const level = Math.max(1, r.level);
  const enc = MINE_ENCOUNTER_BY_LEVEL[level - 1];
  const n = kinds?.length ?? enc.count[0] + Math.floor(Math.random() * (enc.count[1] - enc.count[0] + 1));
  const lairs = mineMap(level).map.lairs ?? [mineMap(level).map.spawn];
  r.mobs = [];
  for (let i = 0; i < n; i++) {
    const kind = kinds?.[i] ?? pickKind(level);
    const st = MINE_MOB_STATS[kind] ?? MINE_MOB_STATS.caveSpider!;
    const at = lairs[i % lairs.length];
    r.mobs.push({
      id: `mm${nextMobId++}`, kind, x: at.x, y: at.y, hp: st.hp, maxHp: st.hp, damage: st.damage, speed: st.speed, cdTicks: st.cooldownTicks,
      cd: 0, awake: false, face: i % 2 ? "l" : "r", act: "sleep", path: [], repathAt: 0,
    });
  }
}

// The mine becomes infested (why: "dug" a new depth, "returned" at dawn, "forced" by a test).
function infest(r: MineRec, why: "dug" | "returned" | "forced", kinds?: MobKind[]) {
  r.status = "infested";
  spawnEncounter(r, kinds);
  const label = labelOf(r);
  let deaths = 0;
  if (why === "returned" && !hasForeman(r)) {
    for (const c of minersAt(r).slice(0, MINE_ATTACK_DEATHS)) {
      damageColonist(c, c.hp + c.maxHp);
      deaths++;
    }
  }
  const what = r.mobs.length;
  const text = why === "dug"
    ? `Your miners broke into a nest digging the ${label} deeper: ${what} monsters inside. The miners fled; it yields nothing until you clear it (E at its door) or send soldiers in`
    : why === "returned"
      ? `Monsters crawled back into the deep ${label}${deaths ? `: ${deaths} miner${deaths === 1 ? "" : "s"} killed` : hasForeman(r) ? ": the Mine Foreman got the miners out" : ""}. Clear it out (E at its door) or send soldiers in`
      : `The ${label} is infested: ${what} monsters inside`;
  withClan(clanAt(r), () => broadcastEvent("raid", text));
}

function clearMine(r: MineRec, by: string) {
  r.status = "cleared";
  r.mobs = [];
  r.clearedDay = today();
  r.rollDay = today();
  withClan(clanAt(r), () => {
    state.stock.gold += MINE_CLEAR_GOLD;
    broadcastEvent("milestone", `The ${labelOf(r)} is cleared${by ? ` by ${by}` : ""} (+${MINE_CLEAR_GOLD} gold): the miners go back to work`);
  });
}

// When a shaft reaches a level: the depth's chance, from a hash fixed at world gen.
function rollDepth(r: MineRec, level: number) {
  if (gatesOff() || r.status === "infested") return;
  const chance = MINE_INFEST_CHANCE_BY_LEVEL[Math.max(1, Math.min(3, level)) - 1] ?? 0;
  if (chance > 0 && (forcedRoll ?? hash01(r.tx, r.ty, level)) < chance) {
    r.level = level;
    infest(r, "dug");
  }
}

function newRec(tx: number, ty: number, level: number): MineRec {
  const d = today();
  return { tx, ty, level, status: "clear", mobs: [], clearedDay: -1e9, rollDay: d, propsDay: d, closedDay: -1, closedWhy: "", unpropped: false };
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
      let r = mines.get(key);
      if (!r) mines.set(key, (r = newRec(x, y, seedExisting ? level : 0)));
      while (r.level < level) {
        const next = r.level + 1;
        rollDepth(r, next);
        r.level = Math.max(r.level, next);
      }
      if (r.level > level) r.level = level;
    }
  }
  seedExisting = false;
  for (const k of mines.keys()) if (!seen.has(k)) mines.delete(k);
}

// ---- production (colonists.ts / progression.ts) ----
// Work speed at a mine post: 0 while infested or closed today (cave-in / flood), MINE_BAD_AIR_SPEED in a deep shaft
// without a vent, else 1. Posts that are not mines: 1.
export function mineWorkMult(tx: number, ty: number): number {
  const r = mineRecAt(tx, ty);
  if (!r) return 1;
  if (r.status === "infested") return 0;
  if (gatesOff()) return 1;
  if (r.closedDay === today()) return 0;
  if (r.level >= 3 && itemsOf(clanAt(r), "mineVent") < 1) return MINE_BAD_AIR_SPEED;
  return 1;
}
// colonists.ts: a civilian posted at an infested mine flees (shelters) by day.
export function minerFlees(c: Colonist): boolean {
  return isMineInfested(c.postX, c.postY);
}

// ---- dawn: props wear (cave-ins), floods, re-infestation ----
export function minesDawn() {
  if (gatesOff()) return;
  const d = today();
  for (const r of mines.values()) {
    const clan = clanAt(r);
    const label = labelOf(r);
    withClan(clan, () => {
      if (r.status === "cleared" && d - r.clearedDay >= MINE_CLEAR_GRACE_DAYS) r.status = "clear";
      if (r.status === "infested") return;
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
      // Deep shafts: nests come back now and then (guards stop it).
      if (r.level >= 3 && r.status === "clear" && d - r.rollDay >= MINE_REINFEST_EVERY_DAYS) {
        r.rollDay = d;
        if (guardedBy(r)) return;
        if (roll() < reinfestChance(r, clan)) infest(r, "returned");
      }
    });
  }
}

function reinfestChance(r: MineRec, clan: Clan): number {
  let c = MINE_REINFEST_CHANCE;
  if (itemsOf(clan, "mineLamps") > 0) c *= MINE_REINFEST_LIT_MULT;
  if (itemsOf(clan, "timberProps") > 0) c *= MINE_REINFEST_PROPPED_MULT;
  if (hasForeman(r)) c *= MINE_REINFEST_FOREMAN_MULT;
  return c;
}

// ---- loot ----
function lootFor(r: MineRec, m: MineMob): string[] {
  const got: string[] = [];
  const tile = state.tiles[tileIndex(r.tx, r.ty)];
  const dep = DEPOSIT_MINES.find((q) => q.mine === tile);
  if (dep) addItem(dep.item, MINE_LOOT_ORE);
  else if (tile === TileType.IronMinePost) state.stock.iron += MINE_LOOT_ORE;
  else state.stock.rock += MINE_LOOT_ORE;
  got.push(`${MINE_LOOT_ORE} ${dep ? dep.item.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase()) : tile === TileType.IronMinePost ? "iron" : "rock"}`);
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

// A monster dies (by the hero `p`, or soldiers): loot to the mine's clan; the last one clears the mine.
function killMob(r: MineRec, m: MineMob, p: Player | null) {
  m.hp = 0;
  const got = withClan(clanAt(r), () => lootFor(r, m));
  if (p) {
    heroRewardsForKill({ kind: m.kind, mark: HungerMark.None, isDeserter: false, maxHp: m.maxHp, damage: m.damage } as unknown as Mob, "p:" + p.id);
    sendTo(p, { type: "event", category: "build", text: `${m.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase())} slain: ${got.join(", ")}` });
  }
  r.mobs = r.mobs.filter((q) => q.hp > 0);
  if (r.mobs.length === 0 && r.status === "infested") clearMine(r, p ? "you" : "your soldiers");
}

// ---- inside: the hero's swing, the monsters' hunt ----
const heroTile = (p: Player) => ({ x: p.interior!.x / TILE_SIZE - 0.5, y: p.interior!.y / TILE_SIZE - 0.5 });
function wake(r: MineRec, m: MineMob) {
  m.awake = true;
  for (const o of r.mobs) if (!o.awake && Math.hypot(o.x - m.x, o.y - m.y) <= MINE_MOB_WAKE_TILES) o.awake = true;
}

// index.ts: `attack` inside a mine. True when it was handled here (the hero is in a mine).
export function mineHeroAttack(p: Player): boolean {
  const I = p.interior;
  if (!I || I.templateId !== "mine") return false;
  if (p.dead || p.attackCooldownTicks > 0) return true;
  p.attackCooldownTicks = playerAttackCooldownTicks(p);
  const r = mineRecAt(I.tx, I.ty);
  if (!r || r.status !== "infested") return true;
  const weapon = heroProfileOf(p).equipment.weapon?.kind;
  const reach = weapon === "bow" ? MINE_HERO_BOW_REACH_TILES : weapon === "spear" ? MINE_HERO_SPEAR_REACH_TILES : MINE_HERO_REACH_TILES;
  const h = heroTile(p);
  let best: MineMob | null = null;
  let bestD = Infinity;
  for (const m of alive(r)) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d <= reach && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  if (!best) return true;
  best.hp -= playerDamage(p);
  wake(r, best);
  if (best.hp <= 0) killMob(r, best, p);
  return true;
}

// Shortest 4-way path on the mine grid from a to b ([] when none or already there).
function pathOn(level: number, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const { map, solid } = mineMap(level);
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

function stepMobs(r: MineRec, inside: Player[]) {
  for (const m of alive(r)) {
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
      wake(r, m);
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
      m.path = pathOn(r.level, m, near);
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

const liveOf = (r: MineRec): MineMobLive[] =>
  alive(r).map((m) => ({ id: m.id, kind: m.kind, x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, hp: Math.ceil(m.hp), maxHp: m.maxHp, face: m.face, act: m.act }));

// sim.ts, once a tick: records (once a second), the monsters of every mine a hero is in, their positions out.
export function updateMines() {
  if (state.cycleTick % TICK_RATE === 0) syncMines();
  const inMine = new Map<string, Player[]>();
  for (const p of players.values()) {
    const I = p.interior;
    if (!I || I.templateId !== "mine" || p.dead) {
      mobsSent.delete(p.id);
      continue;
    }
    const list = inMine.get(I.key);
    if (list) list.push(p);
    else inMine.set(I.key, [p]);
  }
  for (const [key, ps] of inMine) {
    const r = mines.get(key);
    if (r && r.status === "infested") stepMobs(r, ps);
    if (state.cycleTick % MINE_MOB_SEND_TICKS !== 0) continue;
    const live = r ? liveOf(r) : [];
    const json = JSON.stringify(live);
    for (const p of ps) {
      if (!p.interior || mobsSent.get(p.id) === json) continue;
      mobsSent.set(p.id, json);
      sendTo(p, { type: "interiorMobs", key, mobs: live });
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

// interiors.ts viewFor: the mine line of the interior view.
export function mineView(tx: number, ty: number): MineView | undefined {
  const r = mineRecAt(tx, ty);
  if (!r) return undefined;
  return { tile: state.tiles[tileIndex(tx, ty)], status: r.status, monsters: alive(r).length, hazards: hazardLines(r, clanAt(r)) };
}

// interiors.ts: posted miners are not inside an infested mine (they fled).
export function mineHidesMiners(tx: number, ty: number): boolean {
  return isMineInfested(tx, ty);
}

function soldiersNear(r: MineRec, clan: number): Colonist[] {
  const cx = (r.tx + 0.5) * TILE_SIZE;
  const cy = (r.ty + 0.5) * TILE_SIZE;
  return Array.from(colonists.values())
    .filter((c) => c.hp > 0 && (c.clan ?? 0) === clan && isSoldierKind(c.kind) && Math.hypot(c.x - cx, c.y - cy) <= MINE_ASSAULT_RADIUS_TILES * TILE_SIZE)
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
    .slice(0, MINE_ASSAULT_MAX_SOLDIERS);
}

// construction.ts buildingInfo: your own mine's panel section.
export function mineInfo(tx: number, ty: number): MineInfo | undefined {
  const r = mineRecAt(tx, ty);
  if (!r || !isMineTile(state.tiles[tileIndex(tx, ty)])) return undefined;
  const clan = clanAt(r);
  const lines: string[] = [];
  const n = alive(r).length;
  if (r.status === "infested") lines.push(`Infested: ${n} monster${n === 1 ? "" : "s"} inside. The miners have fled and it yields nothing until it is cleared (E at its door to go in, or send soldiers)`);
  else if (r.status === "cleared") lines.push(`Cleared: safe for ${Math.max(0, MINE_CLEAR_GRACE_DAYS - (today() - r.clearedDay))} more day(s)`);
  else lines.push(r.level >= 2 ? "Clear: no monsters in the shaft" : "Clear (a surface adit: never infested)");
  lines.push(...hazardLines(r, clan));
  if (!gatesOff() && r.level >= 2) lines.push(`Timber props: one worn out every ${MINE_PROPS_WEAR_DAYS} days while worked (${itemsOf(clan, "timberProps")} in store)`);
  if (!gatesOff() && r.level >= 3 && r.status !== "infested") {
    const guard = guardedBy(r);
    const pct = Math.round(reinfestChance(r, clan) * 100);
    lines.push(guard ? "Deep shaft: guarded by a soldier nearby: nests stay away" : `Deep shaft: nests may return (${pct}% every ${MINE_REINFEST_EVERY_DAYS} days; lamps, props, a Mine Foreman or a soldier within ${MINE_GUARD_RADIUS_TILES} tiles help)`);
  }
  if (r.level >= 2) lines.push(hasForeman(r) ? "Mine Foreman posted: the miners get out alive when a nest breaks in" : `No Mine Foreman (a level-${MINE_FOREMAN_LEVEL} miner): a nest breaking in kills a miner`);
  const soldiers = soldiersNear(r, clan.id).length;
  const reason = r.status !== "infested" ? "Nothing to clear" : soldiers === 0 ? `No soldiers within ${MINE_ASSAULT_RADIUS_TILES} tiles` : "";
  return { status: r.status, monsters: n, lines, assault: { soldiers, reason } };
}

// `mineAssault`: the soldiers near your infested mine go in. Resolved at once in rounds of a second: each soldier
// strikes the first monster standing (its damage per cooldown), each monster bites a random soldier (soldiers can
// die). All monsters dead: cleared.
export function handleMineAssault(p: Player, tx: unknown, ty: unknown) {
  if (typeof tx !== "number" || typeof ty !== "number" || !inBounds(tx, ty)) return;
  const r = mineRecAt(tx, ty);
  if (!r || clanIdAt(tx, ty) !== (p.clan ?? 0)) return;
  if (r.status !== "infested") return sendEvent(p, "build", "Nothing to clear in that mine");
  const squad = soldiersNear(r, p.clan ?? 0);
  if (squad.length === 0) return sendEvent(p, "build", `No soldiers within ${MINE_ASSAULT_RADIUS_TILES} tiles of the mine`);
  const label = labelOf(r);
  let killed = 0;
  withClan(clanAt(r), () => {
    for (let round = 0; round < MINE_ASSAULT_MAX_ROUNDS && alive(r).length > 0; round++) {
      const up = squad.filter((c) => colonists.has(c.id) && c.hp > 0);
      if (up.length === 0) break;
      for (const c of up) {
        const m = alive(r)[0];
        if (!m) break;
        const st = unitStats(c);
        m.hp -= (st.damage * TICK_RATE) / Math.max(1, st.cooldown);
        if (m.hp <= 0) {
          killed++;
          killMob(r, m, null);
        }
      }
      for (const m of alive(r)) {
        const hit = squad.filter((c) => colonists.has(c.id) && c.hp > 0);
        if (hit.length === 0) break;
        damageColonist(hit[Math.floor(Math.random() * hit.length)], (m.damage * TICK_RATE) / Math.max(1, m.cdTicks));
      }
    }
    const lost = squad.filter((c) => !colonists.has(c.id) || c.hp <= 0).length;
    const left = alive(r).length;
    const text = left === 0
      ? `Your ${squad.length} soldier${squad.length === 1 ? "" : "s"} cleared the ${label} (${killed} monsters slain${lost ? `, ${lost} fell` : ""})`
      : `Your soldiers were driven out of the ${label}: ${killed} slain, ${lost} fell, ${left} monsters remain`;
    sendEvent(p, left === 0 ? "milestone" : "death", text);
  });
}

// ---- saves / reset / tests ----
interface MineSave {
  key: string;
  level: number;
  status: MineStatus;
  mobs: { kind: MobKind; x: number; y: number; hp: number }[];
  clearedDay: number;
  rollDay: number;
  propsDay: number;
  closedDay: number;
  closedWhy: string;
  unpropped: boolean;
}
export function minesForSave(): MineSave[] {
  return Array.from(mines.entries(), ([key, r]) => ({
    key, level: r.level, status: r.status, mobs: alive(r).map((m) => ({ kind: m.kind, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp) })),
    clearedDay: r.clearedDay, rollDay: r.rollDay, propsDay: r.propsDay, closedDay: r.closedDay, closedWhy: r.closedWhy, unpropped: r.unpropped,
  }));
}
export function restoreMines(data: unknown) {
  resetMines();
  // Older saves: every standing mine starts clear at its level (first scan, no roll).
  if (!Array.isArray(data)) {
    seedExisting = true;
    return;
  }
  for (const e of data as Partial<MineSave>[]) {
    if (!e || typeof e.key !== "string" || !/^\d+,\d+$/.test(e.key)) continue;
    const [tx, ty] = e.key.split(",").map(Number);
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const r = newRec(tx, ty, Math.max(0, Math.min(3, num(e.level, 1))));
    r.status = e.status === "infested" || e.status === "cleared" ? e.status : "clear";
    Object.assign(r, { clearedDay: num(e.clearedDay, -1e9), rollDay: num(e.rollDay, r.rollDay), propsDay: num(e.propsDay, r.propsDay), closedDay: num(e.closedDay, -1), closedWhy: typeof e.closedWhy === "string" ? e.closedWhy : "", unpropped: e.unpropped === true });
    for (const m of Array.isArray(e.mobs) ? e.mobs : []) {
      const st = MINE_MOB_STATS[m?.kind as MobKind];
      if (!st) continue;
      r.mobs.push({
        id: `mm${nextMobId++}`, kind: m.kind, x: num(m.x, 1), y: num(m.y, 1), hp: Math.max(1, Math.min(st.hp, num(m.hp, st.hp))), maxHp: st.hp, damage: st.damage,
        speed: st.speed, cdTicks: st.cooldownTicks, cd: 0, awake: false, face: "r", act: "sleep", path: [], repathAt: 0,
      });
    }
    if (r.status === "infested" && r.mobs.length === 0) r.status = "cleared";
    mines.set(e.key, r);
  }
}
export function resetMines() {
  mines.clear();
  mobsSent.clear();
  seedExisting = false;
}

// testHook "mine": {tx, ty} picks a mine; `infest` (true, or a list of kinds) infests it now; `clear` kills every
// monster; `roll` (0-1 / null) forces every roll; `dawn` runs the dawn step; `sync` scans now; `set` {status?,
// closedDay?, unpropped?, propsDay?, rollDay?, clearedDay?} edits the record; `wakeAll` wakes its monsters; `place`
// {i, x, y} stands monster i there. Replies the record (and every record's key / status).
export function mineDebug(msg: Record<string, unknown>) {
  if ("roll" in msg) forcedRoll = typeof msg.roll === "number" ? msg.roll : null;
  if (msg.sync === true) syncMines();
  const tx = msg.tx as number;
  const ty = msg.ty as number;
  const r = typeof tx === "number" && typeof ty === "number" ? mineRecAt(tx, ty) : undefined;
  if (r) {
    if (msg.infest) infest(r, "forced", Array.isArray(msg.infest) ? (msg.infest as MobKind[]).filter((k) => MINE_MOB_STATS[k]) : undefined);
    if (msg.reinfest === true) infest(r, "returned");
    if (msg.clear === true) for (const m of alive(r)) killMob(r, m, null);
    if (msg.set && typeof msg.set === "object") {
      const s = msg.set as Record<string, unknown>;
      for (const k of ["closedDay", "propsDay", "rollDay", "clearedDay", "level"] as const) if (typeof s[k] === "number") r[k] = s[k] as number;
      if (typeof s.unpropped === "boolean") r.unpropped = s.unpropped;
      if (s.status === "clear" || s.status === "cleared") r.status = s.status;
    }
    if (msg.wakeAll === true) for (const m of r.mobs) m.awake = true;
    if (msg.place && typeof msg.place === "object") {
      const q = msg.place as { i?: number; x?: number; y?: number };
      const m = alive(r)[q.i ?? 0];
      if (m && typeof q.x === "number" && typeof q.y === "number") Object.assign(m, { x: q.x, y: q.y, path: [] });
    }
  }
  if (msg.dawn === true) minesDawn();
  const rec = r ? mineRecAt(r.tx, r.ty) : undefined;
  return {
    mine: rec ? { ...rec, mobs: liveOf(rec), workMult: mineWorkMult(rec.tx, rec.ty), foreman: hasForeman(rec), guarded: !!guardedBy(rec), info: mineInfo(rec.tx, rec.ty), chance: reinfestChance(rec, clanAt(rec)) } : null,
    all: Array.from(mines.values(), (q) => ({ key: `${q.tx},${q.ty}`, level: q.level, status: q.status, mobs: alive(q).length })),
    day: today(),
    forcedRoll,
  };
}
