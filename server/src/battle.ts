// battle.ts: Battle engine (docs PLAN-large-battles.md) - the regiment "central brain".
// Phase 1: a persistent regiment store (state.battleRegiments) that wraps what already exists with NO behaviour
// change: every player order group (id g<N>, orders.ts) and every mob regiment (tactics.ts, regimentKey; stored
// as "n:<key>") is a BattleRegiment. The brain runs at BRAIN_HZ, staggered across regiments (each has a phase),
// and is O(regiments): it reads the members' positions / hp, the group's current order (ORDER plumbing: the
// order is copied in when it starts, see noteRegimentOrder) and the morale models, and keeps the regiment's
// anchor, facing, strength, morale, STATE (the state machine of the plan, derived from what the existing
// per-unit code is doing) and nearest hostile regiment. Later phases move decisions up into this tick.
import { TICK_RATE, TILE_SIZE, type ArmyOrder } from "@colony/shared/protocol";
import type { BattleRegiment, BattleRegimentState, Colonist, FormationMarch, Mob, OrderGroup } from "./types.js";
import { COLONIST_BODY_RADIUS, MORALE_MAX, RETREAT_SPEED_FACTOR, dt } from "./constants.js";
import {
  battleRegiments, colonists, commandedTargets, mobs, moraleRegimentOfUnit, orderGroupOfUnit, orderGroups, playerMorale,
  regiments, routedUnits, squadMarchSpeed, state,
} from "./state.js";
import { regimentKey } from "./tactics.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { clamp, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { unitStats } from "./units.js";
import { rallyUnit } from "./orders.js";

// Brain ticks per second (4 Hz at TICK_RATE 20) and the scan radius for the nearest hostile regiment.
export const BRAIN_TICKS = Math.max(1, Math.round(TICK_RATE / 4));
const BRAIN_SCAN_TILES = 30;
// A mob regiment that had contact this recently is ENGAGED.
const NPC_CONTACT_TICKS = TICK_RATE * 2;

let nextPhase = 0;

function newRegiment(id: string, owner: BattleRegiment["owner"]): BattleRegiment {
  return {
    id, owner, memberIds: [], anchorX: 0, anchorY: 0, facing: 0, shape: "line", order: null, state: "idle",
    stateSince: state.cycleTick, morale: MORALE_MAX, strength: 0, targetRegimentId: null,
    phase: nextPhase++ % BRAIN_TICKS, lastBrainTick: -1,
  };
}

function setState(r: BattleRegiment, s: BattleRegimentState) {
  if (r.state === s) return;
  r.state = s;
  r.stateSince = state.cycleTick;
}

// ORDER plumbing: the order an order group starts (orders.ts startArmyOrder) becomes its regiment's ORDER.
export function noteRegimentOrder(g: OrderGroup, order: ArmyOrder | null) {
  let r = battleRegiments.get(g.id);
  if (!r) {
    const first = colonists.get(g.unitIds.values().next().value ?? "");
    r = newRegiment(g.id, { kind: "clan", clan: first?.clan ?? 0 });
    battleRegiments.set(g.id, r);
  }
  r.order = order;
}

// The state a player order group is in, from its order and what its members do.
function groupState(g: OrderGroup, members: Colonist[]): BattleRegimentState {
  if (members.some((c) => routedUnits.has(c.id))) return "routing";
  const reg = playerMorale.get(moraleRegimentOfUnit.get(members[0].id) ?? "");
  const o = g.current;
  const fighting = members.some((c) => !!c.targetMobId);
  if (!o) return fighting ? "engaged" : "idle";
  switch (o.kind) {
    case "hold": return fighting ? "engaged" : "hold";
    case "move": case "follow": case "retreat": return "march";
    case "attackMove": return g.engaged || fighting ? "engaged" : reg && reg.morale < MORALE_MAX * 0.4 ? "wavering" : "advance";
    case "attack": case "attackHearth": return fighting ? "engaged" : "advance";
    case "charge": return "charge";
    case "bombard": return "siege";
  }
  return "idle";
}

function npcState(r: BattleRegiment, members: Mob[]): BattleRegimentState {
  const reg = regiments.get(r.id.slice(2));
  if (reg?.routed) return "routing";
  if (reg?.sheltering) return "shelter";
  if (members.some((m) => m.tactic === "flank")) return "flank";
  if (reg && state.cycleTick - reg.lastContactTick <= NPC_CONTACT_TICKS) return "engaged";
  if (members.some((m) => m.targetId !== null)) return "advance";
  return members[0].siteId ? "garrison" : members.some((m) => m.groupId !== null && !m.passive) ? "march" : "idle";
}

// Members' centroid as the anchor, power as strength.
function summarise(r: BattleRegiment, members: Array<{ x: number; y: number; hp: number; damage?: number }>, dmg: (i: number) => number) {
  let x = 0, y = 0, power = 0;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    x += m.x;
    y += m.y;
    power += Math.max(0, m.hp) * dmg(i);
  }
  r.anchorX = x / members.length;
  r.anchorY = y / members.length;
  r.strength = Math.round(power);
}

// Per tick: membership is synced every BRAIN_TICKS (one pass over the order groups and the mobs); each regiment's
// brain runs on its own phase of that cycle.
const npcMembers = new Map<string, Mob[]>();
const groupMembersOf = new Map<string, Colonist[]>();
export function updateBattleBrains() {
  const phase = state.cycleTick % BRAIN_TICKS;
  if (phase === 0) syncRegiments();
  for (const r of battleRegiments.values()) {
    if (r.phase !== phase) continue;
    brainTick(r);
  }
}

function syncRegiments() {
  groupMembersOf.clear();
  for (const g of orderGroups.values()) {
    const members: Colonist[] = [];
    for (const id of g.unitIds) {
      const c = colonists.get(id);
      if (c) members.push(c);
    }
    if (members.length === 0) continue;
    groupMembersOf.set(g.id, members);
    let r = battleRegiments.get(g.id);
    if (!r) {
      r = newRegiment(g.id, { kind: "clan", clan: members[0].clan ?? 0 });
      r.order = g.current;
      battleRegiments.set(g.id, r);
    }
  }
  npcMembers.clear();
  for (const m of mobs.values()) {
    if (m.hp <= 0) continue;
    const key = regimentKey(m);
    if (!key) continue;
    const id = "n:" + key;
    const list = npcMembers.get(id);
    if (list) list.push(m);
    else npcMembers.set(id, [m]);
  }
  for (const [id, members] of npcMembers) {
    if (!battleRegiments.has(id)) battleRegiments.set(id, newRegiment(id, { kind: "npc", siteId: members[0].siteId }));
  }
  for (const id of battleRegiments.keys()) {
    if (groupMembersOf.has(id) || npcMembers.has(id)) continue;
    battleRegiments.delete(id);
    for (const u of pairsOf.get(id) ?? []) pairedTarget.delete(u);
    pairsOf.delete(id);
  }
}

function brainTick(r: BattleRegiment) {
  r.lastBrainTick = state.cycleTick;
  if (r.owner.kind === "clan") {
    const g = orderGroups.get(r.id);
    const members = (groupMembersOf.get(r.id) ?? []).filter((c) => colonists.has(c.id));
    if (!g || members.length === 0) return;
    r.memberIds = members.map((c) => c.id);
    r.order = g.current;
    if (g.facing !== undefined) r.facing = g.facing;
    r.width = g.width;
    r.shape = members[0].shape ?? "line";
    summarise(r, members, () => 1);
    const mreg = playerMorale.get(moraleRegimentOfUnit.get(members[0].id) ?? "");
    r.morale = mreg ? mreg.morale : MORALE_MAX;
    setState(r, groupState(g, members));
    r.targetRegimentId = nearestHostile(r);
    clanEdge(r, members);
  } else {
    const members = (npcMembers.get(r.id) ?? []).filter((m) => mobs.has(m.id) && m.hp > 0);
    if (members.length === 0) return;
    r.memberIds = members.map((m) => m.id);
    summarise(r, members, (i) => members[i].damage);
    const reg = regiments.get(r.id.slice(2));
    r.morale = reg ? reg.morale : MORALE_MAX;
    setState(r, npcState(r, members));
    r.targetRegimentId = nearestHostile(r);
    // Phase 3: a mob regiment faces the regiment it is going for (its flanks / rear are the other sides).
    const o = r.targetRegimentId ? battleRegiments.get(r.targetRegimentId) : undefined;
    if (o) r.facing = Math.atan2(o.anchorY - r.anchorY, o.anchorX - r.anchorX);
    npcEdge(r, members);
  }
}

// O(regiments): the nearest regiment of the other side (clan vs npc; clan vs another clan) within the scan.
function nearestHostile(r: BattleRegiment): string | null {
  let best: string | null = null;
  let bestD = BRAIN_SCAN_TILES * TILE_SIZE;
  for (const o of battleRegiments.values()) {
    if (o === r || o.memberIds.length === 0) continue;
    const hostile = r.owner.kind === "npc" ? o.owner.kind === "clan" : o.owner.kind === "npc" || o.owner.clan !== r.owner.clan;
    if (!hostile) continue;
    const d = Math.hypot(o.anchorX - r.anchorX, o.anchorY - r.anchorY);
    if (d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

// testHook "battleRegiments": the store, members as counts.
export function battleRegimentsForTest() {
  return Array.from(battleRegiments.values()).map(({ memberIds, ...r }) => {
    const m = orderGroups.get(r.id)?.march;
    const march = m ? { ax: m.ax, ay: m.ay, heading: m.heading, fold: m.fold, corners: m.path.length, lagging: m.lagging, waiting: m.waiting } : null;
    return { ...r, members: memberIds.length, march };
  });
}

// ---- Phase 2: formation march (docs PLAN-formation-march.md phases 1-2) ----
// A march = anchor + heading + slot table. The anchor (the formation's front centre) follows ONE route per group
// (findPath once, string-pulled); every member steers straight at anchor + R(heading) * its own offset (no per-unit
// pathing; a member whose straight step is blocked falls back to its own path, throttled). The block moves at the
// slowest member's speed x 0.95 and waits while more than MARCH_WAIT_FRACTION of its non-stragglers lag; a member
// lagging for MARCH_STRAGGLE_TICKS is a straggler and no longer holds the block back. Turns wheel at
// MARCH_TURN_RAD_PER_S (the anchor halts while the heading is off by more than MARCH_HALT_TURN_RAD). In a corridor
// narrower than the block the files fold into strips one behind another (same slots, derived offsets) and widen
// again after the choke. At the destination each member gets its final (bank-snapped) slot and the old arrival
// logic takes over. Offsets are kept on the group (slotTable), so the next order to the same group with the same
// width / shape re-uses each member's slot (the block does not mix up again).
const MARCH_MIN_TILES = 4;
const MARCH_SPEED_FACTOR = 0.95;
const MARCH_CATCHUP_FACTOR = 1.25;
const MARCH_AHEAD_FACTOR = 0.8;
const MARCH_TOL_PX = COLONIST_BODY_RADIUS * 2 * 1.5;
const MARCH_LAG_PX = TILE_SIZE * 1.5;
const MARCH_STRAGGLER_PX = TILE_SIZE * 4;
const MARCH_STRAGGLE_TICKS = TICK_RATE * 6;
const MARCH_WAIT_FRACTION = 0.2;
const MARCH_TURN_RAD_PER_S = Math.PI / 2;
const MARCH_HALT_TURN_RAD = Math.PI / 3;
const MARCH_REPATH_TICKS = TICK_RATE / 2;
const MARCH_FOLD_TICKS = TICK_RATE / 2;
const MARCH_WIDEN_TICKS = TICK_RATE * 3;
const MARCH_WIDEN_MAX_TICKS = TICK_RATE * 8;
const MARCH_LOOKAHEAD_TILES = [0, 2, 4];
// After the anchor arrives, members still steer (no per-unit path) to their final slots; one within
// MARCH_SETTLE_PX of it, or everyone after MARCH_SETTLE_TICKS, is handed to the old rally / arrival logic.
const MARCH_SETTLE_PX = TILE_SIZE;
const MARCH_SETTLE_TICKS = TICK_RATE * 10;
const MARCH_LAG_SLOW_FACTOR = 0.4;
const MARCH_FORM_MAX_TICKS = TICK_RATE * 5;

// Units steering in a march this tick -> their moving slot (returnToRally steers them straight at it; their rally
// point stays the final slot, so everything reading rallyX / rallyY sees the destination as before), and their
// per-unit repath throttle.
export const marchSteer = new Map<string, { x: number; y: number }>();
const marchRepathAt = new Map<string, number>();

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function walkablePx(x: number, y: number): boolean {
  return isWalkableTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}
function lineWalkable(ax: number, ay: number, bx: number, by: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.ceil(d / (TILE_SIZE / 3));
  for (let i = 1; i <= n; i++) if (!walkablePx(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
  return true;
}

// Local offsets of the slots: ox across (left of the facing), oy along it (forward), relative to (x, y).
export function slotOffsets(targets: Map<string, { x: number; y: number }>, x: number, y: number, facing: number) {
  const fx = Math.cos(facing), fy = Math.sin(facing);
  const out = new Map<string, { ox: number; oy: number }>();
  for (const [id, s] of targets) {
    const dx = s.x - x, dy = s.y - y;
    out.set(id, { ox: dx * -fy + dy * fx, oy: dx * fx + dy * fy });
  }
  return out;
}
export function slotPoint(o: { ox: number; oy: number }, x: number, y: number, facing: number) {
  const fx = Math.cos(facing), fy = Math.sin(facing);
  return { x: x - fy * o.ox + fx * o.oy, y: y + fx * o.ox + fy * o.oy };
}

export function stopFormationMarch(g: OrderGroup) {
  g.march = undefined;
}

// Starts the march of `members` to their slots `targets` (raw) / `finals` (bank-snapped) formed at (x, y) facing
// `facing`. False = too short / too few: the caller dispatches the old way.
export function startFormationMarch(g: OrderGroup, members: Colonist[], targets: Map<string, { x: number; y: number }>, finals: Map<string, { x: number; y: number }>, x: number, y: number, facing: number): boolean {
  g.march = undefined;
  // A routed regiment flees as individuals.
  if (members.length < 2 || members.some((c) => routedUnits.has(c.id))) return false;
  let cx = 0, cy = 0, speed = Infinity;
  for (const c of members) {
    cx += c.x;
    cy += c.y;
    speed = Math.min(speed, unitStats(c).speed);
  }
  cx /= members.length;
  cy /= members.length;
  if (!(speed > 0)) return false;
  const offsets = slotOffsets(targets, x, y, facing);
  let mox = 0, moy = 0;
  for (const o of offsets.values()) {
    mox += o.ox;
    moy += o.oy;
  }
  mox /= offsets.size;
  moy /= offsets.size;
  // The start anchor: where the block's centre is now, heading for the destination.
  const heading = Math.atan2(y - cy, x - cx);
  const s0 = slotPoint({ ox: -mox, oy: -moy }, cx, cy, heading);
  if (Math.hypot(x - s0.x, y - s0.y) < MARCH_MIN_TILES * TILE_SIZE) return false;
  // One route for the anchor (from a walkable tile near the centre), string-pulled to its corners.
  const startTile = walkablePx(s0.x, s0.y) ? tileOfPixel(s0.x, s0.y) : walkablePx(cx, cy) ? tileOfPixel(cx, cy) : tileOfPixel(members[0].x, members[0].y);
  const route = findPath(startTile, tileOfPixel(x, y));
  const pts: { x: number; y: number }[] = route ? route.map((t) => tileToPixelCenter(t)) : [];
  pts.push({ x, y });
  const path: { x: number; y: number }[] = [];
  let from = { x: s0.x, y: s0.y };
  for (let i = 0; i < pts.length; i++) {
    if (i === pts.length - 1 || !lineWalkable(from.x, from.y, pts[i + 1].x, pts[i + 1].y)) {
      path.push(pts[i]);
      from = pts[i];
    }
  }
  g.march = {
    offsets, finals, path, ax: s0.x, ay: s0.y, heading, facing, fold: 1, formed: false, since: state.cycleTick, foldWant: 1, foldSince: state.cycleTick,
    // A retreat runs RETREAT_SPEED_FACTOR faster (its members' speed is scaled the same in updateGuardColonist).
    speed: speed * MARCH_SPEED_FACTOR * (g.current?.kind === "retreat" ? RETREAT_SPEED_FACTOR : 1),
    lagSince: new Map(), halfWidth: Math.max(TILE_SIZE, ...Array.from(offsets.values(), (o) => Math.abs(o.ox))),
    depth: Math.max(TILE_SIZE, ...Array.from(offsets.values(), (o) => Math.abs(o.oy - moy) * 2)),
  };
  return true;
}

// The corridor half-width (px) across the heading at the anchor, up to `max`: out to the first run of
// MARCH_WALL_TILES blocked tiles on either side (a lone tree or post is stepped round, not a choke).
const MARCH_WALL_TILES = 3;
function corridorHalfWidth(ax: number, ay: number, heading: number, max: number): number {
  const lx = -Math.sin(heading), ly = Math.cos(heading);
  const stepPx = TILE_SIZE / 2;
  let half = max;
  for (const side of [1, -1]) {
    let run = 0;
    for (let d = stepPx; d <= max + MARCH_WALL_TILES * TILE_SIZE; d += stepPx) {
      if (walkablePx(ax + lx * d * side, ay + ly * d * side)) {
        run = 0;
      } else if (++run >= MARCH_WALL_TILES * 2) {
        half = Math.min(half, d - run * stepPx);
        break;
      }
    }
  }
  return Math.max(TILE_SIZE / 2, half);
}

// The offset of a slot with the block folded into `fold` strips (strip j of the files walks j depths behind).
function foldedOffset(o: { ox: number; oy: number }, fold: number, halfWidth: number, depth: number) {
  if (fold <= 1) return o;
  const strip = (2 * halfWidth) / fold;
  const j = Math.min(fold - 1, Math.max(0, Math.floor((o.ox + halfWidth) / strip)));
  return { ox: o.ox + halfWidth - j * strip - strip / 2, oy: o.oy - j * (depth + TILE_SIZE / 2) };
}

// Per tick, after updateSquadMarch: moves every marching group's anchor and its members' slot targets.
export function updateFormationMarch() {
  marchSteer.clear();
  for (const g of orderGroups.values()) {
    const m = g.march;
    if (!m) continue;
    const members: Colonist[] = [];
    for (const id of g.unitIds) {
      const c = colonists.get(id);
      if (c && m.offsets.has(id)) members.push(c);
    }
    if (members.length === 0) {
      g.march = undefined;
      continue;
    }
    if (m.settleSince !== undefined) {
      settleMarch(g, m, members);
      continue;
    }
    // Heading: toward the next corner; over the last two tiles, the final facing.
    const wp = m.path[0];
    const toGo = Math.hypot(wp.x - m.ax, wp.y - m.ay);
    const last = m.path.length === 1;
    const want = last && toGo < TILE_SIZE * 2 ? m.facing : toGo > 0.5 ? Math.atan2(wp.y - m.ay, wp.x - m.ax) : m.heading;
    const off = angleDiff(want, m.heading);
    const turn = MARCH_TURN_RAD_PER_S * dt;
    m.heading = Math.abs(off) <= turn ? want : m.heading + Math.sign(off) * turn;
    // Narrowing: fold the files into strips when the corridor (at the anchor and MARCH_LOOKAHEAD_TILES ahead) is
    // narrower than the block. Folding applies once wanted for MARCH_FOLD_TICKS; widening only once wanted for as
    // long as the folded column takes to clear the choke (MARCH_WIDEN_TICKS to MARCH_WIDEN_MAX_TICKS), so a ragged forest edge does not
    // re-shuffle the block every second. Over the window the least change wanted is the one applied.
    let corridor = Infinity;
    const hx0 = Math.cos(m.heading), hy0 = Math.sin(m.heading);
    for (const ahead of MARCH_LOOKAHEAD_TILES) {
      corridor = Math.min(corridor, corridorHalfWidth(m.ax + hx0 * ahead * TILE_SIZE, m.ay + hy0 * ahead * TILE_SIZE, m.heading, m.halfWidth + TILE_SIZE / 2));
    }
    const fold = Math.max(1, Math.min(8, Math.ceil(m.halfWidth / Math.max(TILE_SIZE / 2, corridor))));
    if (fold === m.fold || (fold > m.fold) !== (m.foldWant > m.fold)) {
      m.foldWant = fold;
      m.foldSince = state.cycleTick;
    } else {
      m.foldWant = fold > m.fold ? Math.min(m.foldWant, fold) : Math.max(m.foldWant, fold);
      const column = ((m.fold - 1) * (m.depth + TILE_SIZE / 2)) / Math.max(1, m.speed);
      const need = fold > m.fold ? MARCH_FOLD_TICKS : Math.min(MARCH_WIDEN_MAX_TICKS, Math.max(MARCH_WIDEN_TICKS, column * TICK_RATE));
      if (state.cycleTick - m.foldSince >= need) {
        m.fold = m.foldWant;
        m.foldSince = state.cycleTick;
      }
    }
    // Lag: who is behind its slot (stragglers excluded after MARCH_STRAGGLE_TICKS).
    let lagging = 0, counted = 0;
    const targets: { c: Colonist; x: number; y: number; d: number }[] = [];
    for (const c of members) {
      const p = slotPoint(foldedOffset(m.offsets.get(c.id)!, m.fold, m.halfWidth, m.depth), m.ax, m.ay, m.heading);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      targets.push({ c, x: p.x, y: p.y, d });
      if (c.targetMobId) continue;
      const since = m.lagSince.get(c.id);
      if (d > MARCH_LAG_PX) {
        if (since === undefined) m.lagSince.set(c.id, state.cycleTick);
        else if (state.cycleTick - since >= MARCH_STRAGGLE_TICKS && d > MARCH_STRAGGLER_PX) continue;
        lagging++;
      } else if (since !== undefined) {
        m.lagSince.delete(c.id);
      }
      counted++;
    }
    // Not yet formed up: the anchor waits for the block; formed, a lagging block only slows it (a re-fold or a
    // choke must not freeze the march).
    const lag = lagging > Math.max(0, counted * MARCH_WAIT_FRACTION);
    // A block that cannot form up (members stuck between the lag and straggler distances) goes after MARCH_FORM_MAX_TICKS.
    if (!lag || state.cycleTick - m.since >= MARCH_FORM_MAX_TICKS) m.formed = true;
    const wait = (lag && !m.formed) || Math.abs(angleDiff(want, m.heading)) > MARCH_HALT_TURN_RAD;
    m.lagging = lagging;
    m.waiting = wait;
    if (!wait) {
      let step = m.speed * dt * (lag ? MARCH_LAG_SLOW_FACTOR : 1);
      while (step > 0 && m.path.length > 0) {
        const p = m.path[0];
        const d = Math.hypot(p.x - m.ax, p.y - m.ay);
        if (d <= step) {
          m.ax = p.x;
          m.ay = p.y;
          step -= d;
          if (m.path.length === 1) break;
          m.path.shift();
        } else {
          m.ax += ((p.x - m.ax) / d) * step;
          m.ay += ((p.y - m.ay) / d) * step;
          step = 0;
        }
      }
    }
    const dest = m.path[m.path.length - 1];
    if (m.path.length === 1 && Math.hypot(dest.x - m.ax, dest.y - m.ay) < 0.5 && Math.abs(angleDiff(m.facing, m.heading)) < 0.01) {
      // Arrived: the members settle into their final slots (settleMarch), then the old arrival logic takes over.
      m.settleSince = state.cycleTick;
      settleMarch(g, m, members);
      continue;
    }
    const hx = Math.cos(m.heading), hy = Math.sin(m.heading);
    for (const t of targets) {
      const c = t.c;
      const x = clamp(t.x, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
      const y = clamp(t.y, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
      c.squadId = null;
      marchSteer.set(c.id, { x, y });
      // Catch-up: behind its slot runs at +25%, ahead slows, else block speed.
      const along = (c.x - x) * hx + (c.y - y) * hy;
      const f = t.d > MARCH_TOL_PX ? (along < 0 ? MARCH_CATCHUP_FACTOR : MARCH_AHEAD_FACTOR) : 1;
      squadMarchSpeed.set(c.id, m.speed * f);
    }
  }
}

// The anchor has arrived: members steer straight at their final (bank-snapped) slots; a member within
// MARCH_SETTLE_PX (or everyone after MARCH_SETTLE_TICKS) is handed to the old rally logic (a short straight-in, no
// path search for 1000 units in one tick).
function settleMarch(g: OrderGroup, m: FormationMarch, members: Colonist[]) {
  const timeUp = state.cycleTick - m.settleSince! >= MARCH_SETTLE_TICKS;
  for (const c of members) {
    const s = m.finals.get(c.id);
    if (!s || timeUp || Math.hypot(s.x - c.x, s.y - c.y) <= MARCH_SETTLE_PX) {
      m.offsets.delete(c.id);
      marchRepathAt.delete(c.id);
      if (s) rallyUnit(c, s.x, s.y, g.id);
      continue;
    }
    c.squadId = null;
    marchSteer.set(c.id, s);
    squadMarchSpeed.set(c.id, m.speed);
  }
  if (m.offsets.size === 0) g.march = undefined;
}

// returnToRally for a marching member: straight at its moving slot (true = handled). A blocked straight step falls
// back to the member's own path (re-planned at most every MARCH_REPATH_TICKS).
export function marchSteerStep(c: Colonist, dt: number, speed: number): boolean {
  const t = marchSteer.get(c.id);
  if (!t) return false;
  const dx = t.x - c.x, dy = t.y - c.y;
  const dist = Math.hypot(dx, dy);
  const step = speed * dt;
  if (dist <= step) {
    if (walkablePx(t.x, t.y)) {
      c.x = t.x;
      c.y = t.y;
      c.path = [];
    }
    c.state = "returning";
    return true;
  }
  // Straight, else sliding along one axis (round a lone tree / corner), else its own path.
  const sx = (dx / dist) * step, sy = (dy / dist) * step;
  for (const [mx, my] of [[sx, sy], [Math.sign(sx) * Math.min(step, Math.abs(dx)), 0], [0, Math.sign(sy) * Math.min(step, Math.abs(dy))]]) {
    if ((mx === 0 && my === 0) || !walkablePx(c.x + mx, c.y + my)) continue;
    c.x += mx;
    c.y += my;
    c.path = [];
    c.state = "returning";
    return true;
  }
  if (c.path.length === 0 && state.cycleTick >= (marchRepathAt.get(c.id) ?? 0)) {
    marchRepathAt.set(c.id, state.cycleTick + MARCH_REPATH_TICKS);
    const goal = walkablePx(t.x, t.y) ? tileOfPixel(t.x, t.y) : findAdjacentWalkable(Math.floor(t.x / TILE_SIZE), Math.floor(t.y / TILE_SIZE));
    c.path = (goal && findPath(tileOfPixel(c.x, c.y), goal)) || [];
  }
  if (c.path.length > 0) advanceAlongPath(c, dt, speed);
  c.state = "returning";
  return true;
}

// ---- Phase 3: contact lines (docs PLAN-large-battles.md §3) ----
// Spatial buckets of mobs and soldiers (GRID_CELL_PX), rebuilt lazily once per tick: target scans read the cells
// near them instead of every unit on the map. A query returns a superset (GRID_SLACK_PX covers movement since the
// rebuild); callers keep their exact distance tests, so results only differ on exact ties.
const GRID_CELL_PX = TILE_SIZE * 4;
const GRID_SLACK_PX = TILE_SIZE;
type Grid<T> = { tick: number; cells: Map<number, T[]> };
const mobGrid: Grid<Mob> = { tick: -1, cells: new Map() };
const colonistGrid: Grid<Colonist> = { tick: -1, cells: new Map() };
const cellKey = (cx: number, cy: number) => (cy + 1) * 65536 + (cx + 1);
function rebuild<T extends { x: number; y: number }>(g: Grid<T>, all: Iterable<T>) {
  g.tick = state.cycleTick;
  g.cells.clear();
  for (const u of all) {
    const k = cellKey(Math.floor(u.x / GRID_CELL_PX), Math.floor(u.y / GRID_CELL_PX));
    const list = g.cells.get(k);
    if (list) list.push(u);
    else g.cells.set(k, [u]);
  }
}
function near<T extends { id: string; x: number; y: number }>(g: Grid<T>, live: Map<string, T>, x: number, y: number, r: number): T[] {
  if (g.tick !== state.cycleTick) rebuild(g, live.values());
  const out: T[] = [];
  const rr = r + GRID_SLACK_PX;
  const x0 = Math.floor((x - rr) / GRID_CELL_PX), x1 = Math.floor((x + rr) / GRID_CELL_PX);
  const y0 = Math.floor((y - rr) / GRID_CELL_PX), y1 = Math.floor((y + rr) / GRID_CELL_PX);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const list = g.cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (const u of list) if (live.get(u.id) === u) out.push(u);
    }
  }
  return out;
}
// Mobs / colonists within about `r` px of (x, y) (a superset: filter by exact distance).
export const mobsNear = (x: number, y: number, r: number) => near(mobGrid, mobs, x, y, r);
export const colonistsNear = (x: number, y: number, r: number) => near(colonistGrid, colonists, x, y, r);

// ENGAGEMENT EDGES. Per brain tick, a regiment of at least EDGE_MIN_MEMBERS whose nearest hostile regiment's front
// is within EDGE_CONTACT_TILES of its own front gets an edge (midpoint + normal toward the enemy) and pairs its
// melee front rank (within FRONT_DEPTH_PX of the front-most member) with the opposing front rank: each soldier to
// the nearest foe on the edge that has fewer than EDGE_PAIR_CAP partners. pickGuardTarget / pickMobTarget take the
// pair when it is still valid (O(1)) and only scan otherwise. Small skirmishes (below EDGE_MIN_MEMBERS) are unchanged.
const EDGE_MIN_MEMBERS = 12;
const EDGE_CONTACT_TILES = 6;
const FRONT_DEPTH_PX = TILE_SIZE * 1.25;
const EDGE_PAIR_CAP = 2;
// unit id (colonist or mob) -> its paired foe's id; per regiment, the ids it paired (cleared on its next tick).
const pairedTarget = new Map<string, string>();
const pairsOf = new Map<string, string[]>();
export const pairedTargetOf = (id: string) => pairedTarget.get(id);

type Body = { id: string; x: number; y: number };
function updateEdge<A extends Body, B extends Body>(r: BattleRegiment, own: A[], foes: B[], frontOk: (a: A) => boolean, foeOk: (b: B) => boolean) {
  for (const id of pairsOf.get(r.id) ?? []) pairedTarget.delete(id);
  pairsOf.delete(r.id);
  r.edge = null;
  const o = r.targetRegimentId ? battleRegiments.get(r.targetRegimentId) : undefined;
  if (!o || own.length < EDGE_MIN_MEMBERS || foes.length === 0) return;
  let nx = o.anchorX - r.anchorX, ny = o.anchorY - r.anchorY;
  const d = Math.hypot(nx, ny);
  if (d < 1) return;
  nx /= d;
  ny /= d;
  const proj = (u: Body) => u.x * nx + u.y * ny;
  let ownFront = -Infinity, foeFront = Infinity;
  for (const a of own) ownFront = Math.max(ownFront, proj(a));
  for (const b of foes) foeFront = Math.min(foeFront, proj(b));
  if (foeFront - ownFront > EDGE_CONTACT_TILES * TILE_SIZE) return;
  const mid = (ownFront + foeFront) / 2;
  // The edge point: the regiment's anchor moved onto the midline.
  const ap = proj({ id: "", x: r.anchorX, y: r.anchorY });
  r.edge = { x: r.anchorX + nx * (mid - ap), y: r.anchorY + ny * (mid - ap), nx, ny, foe: o.id, pairs: 0 };
  const front = own.filter((a) => proj(a) >= ownFront - FRONT_DEPTH_PX && frontOk(a));
  const theirs = foes.filter((b) => proj(b) <= foeFront + FRONT_DEPTH_PX && foeOk(b));
  if (front.length === 0 || theirs.length === 0) return;
  const load = new Array<number>(theirs.length).fill(0);
  const ids: string[] = [];
  for (const a of front) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < theirs.length; i++) {
      if (load[i] >= EDGE_PAIR_CAP) continue;
      const dd = Math.hypot(theirs[i].x - a.x, theirs[i].y - a.y);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    if (best < 0) break;
    load[best]++;
    pairedTarget.set(a.id, theirs[best].id);
    ids.push(a.id);
  }
  pairsOf.set(r.id, ids);
  r.edge.pairs = ids.length;
}

// Called from brainTick: player regiments pair their melee soldiers, mob regiments their melee mobs.
function clanEdge(r: BattleRegiment, members: Colonist[]) {
  const foes = r.targetRegimentId ? (npcMembers.get(r.targetRegimentId) ?? []).filter((m) => mobs.has(m.id) && m.hp > 0) : [];
  updateEdge(r, members, foes,
    (c) => unitStats(c).melee && !routedUnits.has(c.id) && !commandedTargets.has(c.id),
    (m) => !m.passive && m.tactic !== "rout" && m.tactic !== "leave");
}
function npcEdge(r: BattleRegiment, members: Mob[]) {
  const o = r.targetRegimentId ? battleRegiments.get(r.targetRegimentId) : undefined;
  const foes = o && o.owner.kind === "clan" ? (groupMembersOf.get(o.id) ?? []).filter((c) => colonists.has(c.id)) : [];
  updateEdge(r, members, foes, (m) => m.melee && !m.passive, (c) => !routedUnits.has(c.id));
}

// FLANK / REAR. A blow on a member of a formed regiment (at least FLANK_MIN_MEMBERS, not routing) from outside its
// front arc hits harder: front (within 60 deg of its facing) x1, flank x1.25, rear (beyond 120 deg) x1.5.
const FLANK_MIN_MEMBERS = 6;
export const FLANK_MULT = 1.25;
export const REAR_MULT = 1.5;
const COS_60 = 0.5;
function regimentFacing(id: string | null | undefined): number | null {
  const r = id ? battleRegiments.get(id) : undefined;
  if (!r || r.memberIds.length < FLANK_MIN_MEMBERS || r.state === "routing") return null;
  return r.facing;
}
export function directionMult(fromX: number, fromY: number, def: { x: number; y: number }, facing: number | null): number {
  if (facing === null) return 1;
  const dx = fromX - def.x, dy = fromY - def.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return 1;
  const cos = (dx * Math.cos(facing) + dy * Math.sin(facing)) / d;
  return cos >= COS_60 ? 1 : cos <= -COS_60 ? REAR_MULT : FLANK_MULT;
}
// The multiplier for a blow from (fromX, fromY) on a soldier / on a mob.
export function directionMultOnColonist(fromX: number, fromY: number, c: Colonist): number {
  return directionMult(fromX, fromY, c, regimentFacing(orderGroupOfUnit.get(c.id)?.id));
}
export function directionMultOnMob(fromX: number, fromY: number, m: Mob): number {
  const key = regimentKey(m);
  return directionMult(fromX, fromY, m, regimentFacing(key ? "n:" + key : null));
}
