// battle.ts: Battle engine (docs PLAN-large-battles.md) - the regiment "central brain".
// Phase 1: a persistent regiment store (state.battleRegiments) that wraps what already exists with NO behaviour
// change: every player order group (id g<N>, orders.ts) and every mob regiment (tactics.ts, regimentKey; stored
// as "n:<key>") is a BattleRegiment. The brain runs at BRAIN_HZ, staggered across regiments (each has a phase),
// and is O(regiments): it reads the members' positions / hp, the group's current order (ORDER plumbing: the
// order is copied in when it starts, see noteRegimentOrder) and the morale models, and keeps the regiment's
// anchor, facing, strength, morale, STATE (the state machine of the plan, derived from what the existing
// per-unit code is doing) and nearest hostile regiment. Later phases move decisions up into this tick.
import { TICK_RATE, TILE_SIZE, type ArmyOrder } from "@colony/shared/protocol";
import type { BattleRegiment, BattleRegimentState, Colonist, Mob, OrderGroup } from "./types.js";
import { MORALE_MAX } from "./constants.js";
import {
  battleRegiments, colonists, mobs, moraleRegimentOfUnit, orderGroups, playerMorale, regiments, routedUnits, state,
} from "./state.js";
import { regimentKey } from "./tactics.js";

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
  for (const id of battleRegiments.keys()) if (!groupMembersOf.has(id) && !npcMembers.has(id)) battleRegiments.delete(id);
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
  } else {
    const members = (npcMembers.get(r.id) ?? []).filter((m) => mobs.has(m.id) && m.hp > 0);
    if (members.length === 0) return;
    r.memberIds = members.map((m) => m.id);
    summarise(r, members, (i) => members[i].damage);
    const reg = regiments.get(r.id.slice(2));
    r.morale = reg ? reg.morale : MORALE_MAX;
    setState(r, npcState(r, members));
  }
  r.targetRegimentId = nearestHostile(r);
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
  return Array.from(battleRegiments.values()).map(({ memberIds, ...r }) => ({ ...r, members: memberIds.length }));
}
