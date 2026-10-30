// orders.ts: Strategy-mode commands: move/attack/stance, order groups and regiment orders, enemy regiment intel.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import {
  TileType, type Stance, type ArmyOrderKind, TILE_SIZE, type ArmyOrder, ARMY_ORDER_QUEUE_MAX, TICK_RATE,
  FORMATION_SHAPES, type FormationShape, type ArmyOrderGroupSnapshot, type EnemyRegimentSnapshot, ENEMY_CELL_TILES,
  type CombatRole,
} from "@colony/shared/protocol";
import { planOrderFormation } from "@colony/shared/formation";
import type { Colonist, Mob, OrderGroup, Player } from "./types.js";
import {
  ARMY_ORDER_KINDS, ARMY_REGIMENT_REFRESH_TICKS, ATTACK_MOVE_RESUME_TICKS, CATAPULT_BUILDING_MULT,
  CATAPULT_MIN_RANGE, CATAPULT_RANGE, CATAPULT_SPLASH_PX, CHARGE_RECHARGE_GAP_TILES, CHARGE_WITHDRAW_MAX_TICKS,
  CHARGE_WITHDRAW_TILES, COMMANDABLE_KINDS, ENEMY_OUTFLANKED_SHOW_TICKS, FOLLOW_BEHIND_TILES, FOLLOW_REFORM_TILES,
  LINE_LEASH_TILES, ORDER_ARRIVE_GRACE_TICKS, ORDER_DISPATCH_MAX_SPREAD_MS, ORDER_DISPATCH_STEP_MS,
  ORDER_UPDATE_TICKS, ORDER_WIDTH_MAX_TILES, REGIMENT_ORDER_MAX_PER_S, RETREAT_TC_OFFSET_TILES, SQUAD_SETTLE_TILES,
  STANCES, STANCE_ALERT_RANGE_TILES, STRUCTURE_TARGET_PREFIX,
} from "./constants.js";
import {
  chargeCycle, chargeRuns, colonists, commandedTargets, hearths, mobs, orderGroupOfUnit, orderGroups, pendingRallies,
  clans, players, regiments, state, tileOwner,
} from "./state.js";
import { clamp, inBounds, isNightNow, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { armyDamageMultiplier } from "./economy.js";
import { isAbbeyClergy, isWardPriest, nearestTownCenter } from "./colonists.js";
import { inClan, townCentersOfClan } from "./clans.js";
import { armyRegimentsNow, colonistRole, dropGuardTarget, isGuardOrMilitiaKind, mobRole, unitStats } from "./units.js";
import { releaseSlot } from "./combat.js";
import { catapultImpact } from "./siege.js";
import { isDormantGuardian } from "./mobs.js";
import { isRoutedUnit, moraleDamageMult, regimentKey } from "./tactics.js";
import { attackObjectiveAt, damageHearth, nearestHostileStructure, sendAgainstHearth } from "./hearths.js";
import { weaponDamageMult } from "./heroes.js";
import { spellBuffDamageMult } from "./spells.js";
import { COLONIST_VISION_OFFSETS, PLAYER_VISION_OFFSETS, fightThreatOf } from "./net.js";

// Only a Church's bishop takes orders: the Ward Priest must keep his rounds for the wards to stand,
// and the Abbey's clergy aren't the colony's at all. Mirrored by the client's isCommandable (which
// sees the Ward Priest's post as a Ward Stone).
export function isCommandable(c: Colonist): boolean {
  if (!COMMANDABLE_KINDS.includes(c.kind)) return false;
  if (isWardPriest(c)) return false;
  return c.kind !== "bishop" || state.tiles[tileIndex(c.postX, c.postY)] === TileType.ChurchPost;
}

export function handleCommandMove(unitIds: string[], x: number, y: number, squad?: unknown) {
  const tile = tileOfPixel(x, y);
  if (!inBounds(tile.x, tile.y)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c) || isRoutedUnit(c.id)) continue;
    // A per-unit order takes the unit out of its regiment order group (strategy mode phase 3).
    leaveOrderGroup(c.id);
    rallyUnit(c, x, y, typeof squad === "string" && squad.length > 0 && squad.length <= 64 ? squad : null);
  }
}

// The move part of commandMove for one unit: its rally slot becomes (x, y) (in bounds), targets dropped.
export function rallyUnit(c: Colonist, x: number, y: number, squad: string | null) {
  const tile = tileOfPixel(x, y);
  c.squadId = squad;
  c.rallyTileX = tile.x;
  c.rallyTileY = tile.y;
  c.rallyX = x;
  c.rallyY = y;
  c.targetMobId = null;
  c.targetHearthId = null;
  commandedTargets.delete(c.id);
  c.healTargetType = null;
  c.healTargetId = null;
  c.path = [];
  c.repathCooldown = 0;
}

export function handleCommandAttack(unitIds: string[], mobId: string) {
  if (!mobs.has(mobId) || !Array.isArray(unitIds)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind) || isRoutedUnit(c.id)) continue;
    leaveOrderGroup(c.id);
    c.targetMobId = mobId;
    c.targetHearthId = null;
    commandedTargets.set(c.id, mobId);
    c.path = [];
    c.repathCooldown = 0;
  }
}

export function handleCommandStance(unitIds: string[], stance: Stance) {
  if (!STANCES.includes(stance)) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isCommandable(c)) continue;
    c.stance = stance;
  }
}

// A task force is also a manual regiment (strategy mode phase 2), so a unit is in at most one: assigning
// takes the units out of every other slot. Empty (or no valid unit) disbands the slot.
export function handleAssignTaskForce(slot: number, unitIds: string[]) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 9 || !Array.isArray(unitIds)) return;
  const valid = Array.from(new Set(unitIds)).filter((id) => {
    const c = typeof id === "string" ? colonists.get(id) : undefined;
    return c && isCommandable(c);
  });
  state.taskForces.delete(slot);
  state.taskForceMax.delete(slot);
  if (valid.length === 0) return;
  const taken = new Set(valid);
  for (const [other, ids] of state.taskForces) {
    const kept = ids.filter((id) => !taken.has(id));
    if (kept.length === ids.length) continue;
    if (kept.length === 0) {
      state.taskForces.delete(other);
      state.taskForceMax.delete(other);
    } else {
      state.taskForces.set(other, kept);
    }
  }
  state.taskForces.set(slot, valid);
  state.taskForceMax.set(slot, valid.length);
}
// ---- Regiment orders (strategy mode phase 3; docs PLAN-strategy-mode.md §4 "Order execution").
// Regiments are derived per snapshot (above), so order state lives on the UNITS: a regimentOrder makes
// the units it names an order group ("g<N>": the members of every regiment in the selection), holding the
// current order and a queue (Shift waypoints, ARMY_ORDER_QUEUE_MAX). A unit is in at most one group; a
// per-unit commandMove / commandAttack / commandAttackHearth (tactical mode) takes it out. Groups are not
// saved. The server forms the slots itself with formation.ts (the client's ghosts use the same code) and
// moves each unit through rallyUnit + its squad (squadId = group id, so updateSquadMarch paces it), with
// the client's old 0-0.6 s staggered start done here. Work per tick: the pending staggered starts only;
// groups are checked every ORDER_UPDATE_TICKS, formations solved per order / re-form only.
//   move        form at (x, y) with the given facing / width (or the group's last width), then done
//   attackMove  as move; a valid enemy within a member's stance alert range halts the group (shifted so
//               its nearest member can reach it) and battle discipline fights; resumes 3 s after clear
//   retreat     to (x, y) or in front of the nearest Town Center, targets dropped, +10% speed, fights
//               only an enemy within RETREAT_CORNERED_TILES
//   hold        stays where it is (or on its slots), leash HOLD_LEASH_TILES; lasts until the next order
//   follow      re-forms FOLLOW_BEHIND_TILES behind a colonist / player when it moves FOLLOW_REFORM_TILES
//   attack      a commanded attack on a mob (as commandAttack) until it is gone
// Phase 4:
//   charge      shock / fast members run at a mob at full speed (a commanded target: no leash, no squad
//               pace; the cavalry charge x2 lands as ever); with cycleCharge a rider whose charge landed
//               withdraws CHARGE_WITHDRAW_TILES and charges again once its charge cooldown is over. The
//               rest of the group stands. Until the mob is gone.
//   bombard     catapults shell the point each reload from within their 3-11 tile band (walking into it
//               first); a standing hearth under the splash takes building damage. Until the next order.
//   attackHearth  the group attacks a camp hearth (as commandAttackHearth) until it falls.

export function leaveOrderGroup(id: string) {
  pendingRallies.delete(id);
  chargeCycle.delete(id);
  const g = orderGroupOfUnit.get(id);
  if (!g) return;
  orderGroupOfUnit.delete(id);
  g.unitIds.delete(id);
  if (g.unitIds.size === 0) orderGroups.delete(g.id);
}

export function clearOrderGroups() {
  orderGroups.clear();
  orderGroupOfUnit.clear();
  pendingRallies.clear();
  chargeCycle.clear();
  state.orderGroupSignature = "";
}

// The kind of order the unit's group is carrying out (hold / retreat change updateGuardColonist).
export function unitOrderKind(c: Colonist): ArmyOrderKind | undefined {
  return orderGroupOfUnit.get(c.id)?.current?.kind;
}

// Alive commandable members; the dead / gone are dropped from the group.
export function groupMembers(g: OrderGroup): Colonist[] {
  const out: Colonist[] = [];
  for (const id of g.unitIds) {
    const c = colonists.get(id);
    if (c && isCommandable(c)) {
      out.push(c);
    } else {
      g.unitIds.delete(id);
      orderGroupOfUnit.delete(id);
      pendingRallies.delete(id);
      chargeCycle.delete(id);
    }
  }
  return out;
}

export function centroidOf(units: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / Math.max(1, units.length), y: y / Math.max(1, units.length) };
}

// Stop where it stands (the rally slot moves onto it); a fight in progress goes on.
export function haltUnit(c: Colonist, dx = 0, dy = 0) {
  pendingRallies.delete(c.id);
  const x = clamp(c.x + dx, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(c.y + dy, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  const t = tileOfPixel(x, y);
  Object.assign(c, { rallyTileX: t.x, rallyTileY: t.y, rallyX: x, rallyY: y, squadId: null });
  commandedTargets.delete(c.id);
  if (dx !== 0 || dy !== 0) c.path = [];
}

// Validated copy of a client order (null = rejected): known kind, finite in-bounds point, normalised
// facing, clamped width, a bounded target id.
export function sanitizeArmyOrder(raw: unknown): ArmyOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as ArmyOrderKind;
  if (!ARMY_ORDER_KINDS.includes(kind)) return null;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const order: ArmyOrder = { kind };
  if (num(o.x) && num(o.y)) {
    order.x = clamp(o.x, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
    order.y = clamp(o.y, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  } else if (kind === "move" || kind === "attackMove" || kind === "bombard") {
    return null;
  }
  if (num(o.facing)) order.facing = Math.atan2(Math.sin(o.facing), Math.cos(o.facing));
  if (num(o.width)) order.width = clamp(o.width, 0, ORDER_WIDTH_MAX_TILES);
  if (kind === "follow" || kind === "attack" || kind === "charge") {
    if (typeof o.targetId !== "string" || o.targetId.length === 0 || o.targetId.length > 80) return null;
    order.targetId = o.targetId;
  }
  if (kind === "attackHearth") {
    if (!Number.isInteger(o.tileX) || !Number.isInteger(o.tileY) || !inBounds(o.tileX as number, o.tileY as number)) return null;
    order.tileX = o.tileX as number;
    order.tileY = o.tileY as number;
  }
  return order;
}

// A follow target: "p:<playerId>" (alive) or a colonist id.
export function followTargetPos(targetId: string): { x: number; y: number } | null {
  if (targetId.startsWith("p:")) {
    const p = players.get(targetId.slice(2));
    return p && !p.dead ? p : null;
  }
  return colonists.get(targetId) ?? null;
}

// The commandable units a regimentOrder / regimentSettings names (regiment members + unit ids, capped).
export function orderedUnits(regimentIds: unknown, unitIds: unknown): Colonist[] {
  const ids = new Set<string>();
  if (Array.isArray(regimentIds) && regimentIds.length > 0) {
    const wanted = new Set(regimentIds.slice(0, 64).filter((r): r is string => typeof r === "string"));
    for (const r of armyRegimentsNow()) if (wanted.has(r.id)) for (const id of r.unitIds) ids.add(id);
  }
  if (Array.isArray(unitIds)) for (const id of unitIds.slice(0, 1000)) if (typeof id === "string") ids.add(id);
  const units: Colonist[] = [];
  for (const id of ids) {
    const c = colonists.get(id);
    if (c && isCommandable(c) && inClan(c)) units.push(c);
  }
  return units;
}

export function handleRegimentOrder(player: Player, msg: { regimentIds?: unknown; unitIds?: unknown; order?: unknown; queue?: unknown }) {
  if (state.simHeldForLoad) return;
  const now = Date.now();
  if (now - player.orderWindowAt >= 1000) {
    player.orderWindowAt = now;
    player.orderWindowCount = 0;
  }
  if (++player.orderWindowCount > REGIMENT_ORDER_MAX_PER_S) return;
  const order = sanitizeArmyOrder(msg.order);
  if (!order) return;
  // Phase 6: routed units take no orders until they rally.
  const units = orderedUnits(msg.regimentIds, msg.unitIds).filter((c) => !isRoutedUnit(c.id));
  if (units.length === 0) return;
  const ids = new Set(units.map((c) => c.id));
  if ((order.kind === "attack" || order.kind === "charge") && !mobs.has(order.targetId!)) return;
  if (order.kind === "attackHearth" && !attackObjectiveAt(order.tileX!, order.tileY!)) return;
  if (order.kind === "follow" && (!followTargetPos(order.targetId!) || ids.has(order.targetId!))) return;
  // The same units as an existing group: Shift appends to its queue (a hold / follow / finished order
  // gives way at once), a plain order replaces its orders but keeps its formation memory.
  const prev = orderGroupOfUnit.get(units[0].id);
  const same = !!prev && prev.unitIds.size === units.length && units.every((c) => orderGroupOfUnit.get(c.id) === prev);
  if (prev && same) {
    if (msg.queue === true && prev.current && prev.current.kind !== "hold" && prev.current.kind !== "follow" && prev.current.kind !== "bombard") {
      if (prev.queue.length < ARMY_ORDER_QUEUE_MAX) prev.queue.push(order);
      return;
    }
    if (msg.queue !== true) prev.queue = [];
    startArmyOrder(prev, order);
    return;
  }
  for (const c of units) leaveOrderGroup(c.id);
  const g: OrderGroup = {
    id: `g${state.nextOrderGroupId++}`, unitIds: new Set(units.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: state.cycleTick, engaged: false, clearSince: -1, followAt: null,
  };
  orderGroups.set(g.id, g);
  for (const c of units) orderGroupOfUnit.set(c.id, g);
  startArmyOrder(g, order);
}

// Forts phase E: a trader wagon's escort as one order group on a persistent follow order (no player, no
// rate limit). True when it (re)issued the order; nothing changes while they already follow that target.
export function ensureFollowGroup(units: Colonist[], targetId: string): boolean {
  if (units.length === 0) return false;
  const prev = orderGroupOfUnit.get(units[0].id);
  if (prev && prev.current?.kind === "follow" && prev.current.targetId === targetId && prev.unitIds.size === units.length && units.every((c) => orderGroupOfUnit.get(c.id) === prev)) return false;
  for (const c of units) leaveOrderGroup(c.id);
  const g: OrderGroup = {
    id: `g${state.nextOrderGroupId++}`, unitIds: new Set(units.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: state.cycleTick, engaged: false, clearSince: -1, followAt: null,
  };
  orderGroups.set(g.id, g);
  for (const c of units) orderGroupOfUnit.set(c.id, g);
  startArmyOrder(g, { kind: "follow", targetId });
  return true;
}

// Slots from formation.ts at (x, y); nearest-to-its-slot units start first, the rest staggered.
export function formGroupAt(g: OrderGroup, members: Colonist[], x: number, y: number, facing: number | undefined, width: number | undefined) {
  const plan = planOrderFormation(members, x, y, facing, width);
  g.facing = Math.atan2(plan.fy, plan.fx);
  g.width = width;
  g.lastAt = { x, y };
  const slots = Array.from(plan.targets.values());
  const c0 = centroidOf(slots);
  g.destX = c0.x;
  g.destY = c0.y;
  const toSlot = (c: Colonist) => {
    const s = plan.targets.get(c.id)!;
    return Math.hypot(s.x - c.x, s.y - c.y);
  };
  const order = members.slice().sort((a, b) => toSlot(a) - toSlot(b));
  const stepMs = order.length > 1 ? Math.min(ORDER_DISPATCH_STEP_MS, ORDER_DISPATCH_MAX_SPREAD_MS / (order.length - 1)) : 0;
  const squad = order.length > 1 ? g.id : null;
  order.forEach((c, i) => {
    const s = plan.targets.get(c.id)!;
    const sx = clamp(s.x, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
    const sy = clamp(s.y, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
    const delay = Math.round((i * stepMs * TICK_RATE) / 1000);
    if (delay === 0) {
      pendingRallies.delete(c.id);
      rallyUnit(c, sx, sy, squad);
    } else {
      pendingRallies.set(c.id, { at: state.cycleTick + delay, x: sx, y: sy, group: g.id, squad });
    }
  });
}

export function startArmyOrder(g: OrderGroup, order: ArmyOrder) {
  g.current = order;
  g.engaged = false;
  g.clearSince = -1;
  g.followAt = null;
  g.startedTick = state.cycleTick;
  const members = groupMembers(g);
  if (members.length === 0) return;
  for (const c of members) chargeCycle.delete(c.id);
  switch (order.kind) {
    case "move":
    case "attackMove":
    case "retreat": {
      if (order.x === undefined || order.y === undefined) {
        // Retreat: form RETREAT_TC_OFFSET_TILES in front of the nearest Town Center, facing out.
        const c0 = centroidOf(members);
        const tc = nearestTownCenter(c0.x, c0.y, townCentersOfClan(members[0].clan));
        if (!tc) {
          finishArmyOrder(g, members);
          return;
        }
        const tcx = (tc.x + 0.5) * TILE_SIZE;
        const tcy = (tc.y + 0.5) * TILE_SIZE;
        const d = Math.hypot(c0.x - tcx, c0.y - tcy);
        const dx = d >= 1 ? (c0.x - tcx) / d : 0;
        const dy = d >= 1 ? (c0.y - tcy) / d : 1;
        order.x = clamp(tcx + dx * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
        order.y = clamp(tcy + dy * RETREAT_TC_OFFSET_TILES * TILE_SIZE, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
        order.facing ??= Math.atan2(dy, dx);
      }
      // No facing given (a queued click): face the way it marches, at the group's last width.
      const width = order.width ?? (order.facing === undefined ? g.width : undefined);
      formGroupAt(g, members, order.x, order.y, order.facing, width);
      // Filled in, so the client's ghost of the current order matches the slots.
      order.facing = g.facing;
      if (width !== undefined) order.width = width;
      return;
    }
    case "hold":
      // Off the march: stop here; already on (or near) its slot: keep the slot.
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (Math.hypot(c.rallyX - c.x, c.rallyY - c.y) > TILE_SIZE) haltUnit(c);
        commandedTargets.delete(c.id);
        c.squadId = null;
      }
      return;
    case "follow":
      updateFollowOrder(g, members);
      return;
    case "attack": {
      const mob = mobs.get(order.targetId!);
      if (!mob) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (!isGuardOrMilitiaKind(c.kind)) continue;
        c.targetMobId = mob.id;
        c.targetHearthId = null;
        commandedTargets.set(c.id, mob.id);
        c.squadId = null;
        c.path = [];
        c.repathCooldown = 0;
      }
      return;
    }
    case "charge": {
      const mob = mobs.get(order.targetId!);
      if (!mob) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (canCharge(c)) chargeAt(c, mob);
      }
      return;
    }
    case "bombard":
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (c.kind === "catapult") bombardPosition(c, order.x!, order.y!);
      }
      return;
    case "attackHearth": {
      const h = attackObjectiveAt(order.tileX!, order.tileY!);
      if (!h) {
        finishArmyOrder(g, members);
        return;
      }
      for (const c of members) {
        pendingRallies.delete(c.id);
        if (isGuardOrMilitiaKind(c.kind)) sendAgainstHearth(c, h);
      }
      return;
    }
  }
}

// Phase 4, charge: knights / cavalry / champions (shock and fast roles).
export function canCharge(c: Colonist): boolean {
  const role = colonistRole(c);
  return role === "shock" || role === "fast";
}

// Off at the mob: a commanded target (no leash, no squad pace).
export function chargeAt(c: Colonist, mob: Mob) {
  c.targetMobId = mob.id;
  c.targetHearthId = null;
  commandedTargets.set(c.id, mob.id);
  c.squadId = null;
  c.path = [];
  c.repathCooldown = 0;
  chargeCycle.set(c.id, { phase: "in", readyTick: chargeRuns.get(c.id)?.readyTick ?? 0, since: state.cycleTick });
}

// Every ORDER_UPDATE_TICKS on a charge order: a cycling rider whose charge landed withdraws (straight away
// from the mob, re-aimed while the mob closes in) and turns again once its cooldown is over and it has
// room for a full run.
export function updateChargeOrder(g: OrderGroup, members: Colonist[]) {
  const mob = mobs.get(g.current!.targetId!);
  if (!mob || mob.hp <= 0) {
    finishArmyOrder(g, members);
    return;
  }
  for (const c of members) {
    const cyc = chargeCycle.get(c.id);
    if (!cyc) continue;
    const run = chargeRuns.get(c.id);
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (cyc.phase === "out") {
      const ready = !run || state.cycleTick >= run.readyTick;
      if (ready && (d >= CHARGE_RECHARGE_GAP_TILES * TILE_SIZE || state.cycleTick - cyc.since >= CHARGE_WITHDRAW_MAX_TICKS)) {
        // The attack cooldown only runs down while striking; out this long it is long over (else the rider
        // waits it out at the mob, sliding to its ring slot, which breaks the charge run).
        c.attackCooldownTicks = 0;
        chargeAt(c, mob);
      } else if (Math.hypot(c.rallyX - mob.x, c.rallyY - mob.y) < (CHARGE_WITHDRAW_TILES - 0.5) * TILE_SIZE) {
        withdrawFrom(c, mob, d);
      }
      continue;
    }
    if (c.cycleCharge && run && run.readyTick !== cyc.readyTick && run.readyTick > state.cycleTick) {
      chargeCycle.set(c.id, { phase: "out", readyTick: run.readyTick, since: state.cycleTick });
      withdrawFrom(c, mob, d);
    } else if (c.targetMobId !== mob.id) {
      chargeAt(c, mob);
    }
  }
}

export function withdrawFrom(c: Colonist, mob: Mob, d: number) {
  const ux = d >= 1 ? (c.x - mob.x) / d : 1;
  const uy = d >= 1 ? (c.y - mob.y) / d : 0;
  const x = clamp(mob.x + ux * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, state.WORLD_TILES_X * TILE_SIZE - TILE_SIZE);
  const y = clamp(mob.y + uy * CHARGE_WITHDRAW_TILES * TILE_SIZE, TILE_SIZE, state.WORLD_TILES_Y * TILE_SIZE - TILE_SIZE);
  rallyUnit(c, x, y, null);
  releaseSlot(c.id);
}

// Phase 4, bombard: a catapult outside its throw band walks to the band's middle on the line to the point.
export function bombardPosition(c: Colonist, x: number, y: number) {
  const d = Math.hypot(x - c.x, y - c.y);
  if (d >= CATAPULT_MIN_RANGE + TILE_SIZE / 2 && d <= CATAPULT_RANGE - TILE_SIZE / 2) {
    haltUnit(c);
    return;
  }
  const want = (CATAPULT_MIN_RANGE + CATAPULT_RANGE) / 2;
  const ux = d >= 1 ? (c.x - x) / d : 1;
  const uy = d >= 1 ? (c.y - y) / d : 0;
  rallyUnit(c, clamp(x + ux * want, 1, state.WORLD_TILES_X * TILE_SIZE - 1), clamp(y + uy * want, 1, state.WORLD_TILES_Y * TILE_SIZE - 1), null);
}

// The bombard point of a catapult whose group is on a bombard order (null otherwise).
export function bombardPoint(c: Colonist): { x: number; y: number } | null {
  const o = orderGroupOfUnit.get(c.id)?.current;
  return o && o.kind === "bombard" && o.x !== undefined && o.y !== undefined ? { x: o.x, y: o.y } : null;
}

// One bombard tick: inside the throw band it shells the point each reload (true = it acted).
export function bombardStep(c: Colonist, at: { x: number; y: number }, stats: { damage: number; cooldown: number }): boolean {
  const d = Math.hypot(at.x - c.x, at.y - c.y);
  if (d < CATAPULT_MIN_RANGE || d > CATAPULT_RANGE) return false;
  c.path = [];
  c.state = "attacking";
  if (c.attackCooldownTicks > 0) {
    c.attackCooldownTicks--;
    return true;
  }
  const damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
  catapultImpact(c.x, c.y, at.x, at.y, damage, "colony", "c:" + c.id);
  for (const h of hearths.values()) {
    if (h.destroyed) continue;
    const p = tileToPixelCenter(h);
    if (Math.hypot(p.x - at.x, p.y - at.y) <= CATAPULT_SPLASH_PX + TILE_SIZE / 2) damageHearth(h, damage * CATAPULT_BUILDING_MULT, "c:" + c.id);
  }
  c.attackCooldownTicks = stats.cooldown;
  return true;
}

// The current order is done: the next queued one starts, else the group stands (after an attack, where
// the fight left it).
export function finishArmyOrder(g: OrderGroup, members: Colonist[]) {
  const was = g.current?.kind;
  g.current = null;
  g.engaged = false;
  const next = g.queue.shift();
  if (next) {
    startArmyOrder(g, next);
    return;
  }
  if (was === "attack" || was === "charge") for (const c of members) if (!c.targetMobId) haltUnit(c);
}

// Formed = the centroid of the members still marching (not fighting) is within SQUAD_SETTLE_TILES of the
// slots' centroid.
export function groupArrived(g: OrderGroup, members: Colonist[]): boolean {
  if (state.cycleTick - g.startedTick < ORDER_ARRIVE_GRACE_TICKS) return false;
  const free = members.filter((c) => !c.targetMobId);
  const c0 = centroidOf(free.length > 0 ? free : members);
  return Math.hypot(c0.x - g.destX, c0.y - g.destY) <= SQUAD_SETTLE_TILES * TILE_SIZE;
}

// The nearest enemy an attack-move reacts to: awake, not routing / leaving (pursuit safety), within a
// member's stance alert range. `reach` = that member's leash + attack range.
export function attackMoveContact(members: Colonist[]): { mob: Mob; member: Colonist; d: number } | null {
  const c0 = centroidOf(members);
  let spread = 0;
  for (const c of members) spread = Math.max(spread, Math.abs(c.x - c0.x), Math.abs(c.y - c0.y));
  const box = spread + STANCE_ALERT_RANGE_TILES.aggressive * TILE_SIZE;
  let best: { mob: Mob; member: Colonist; d: number } | null = null;
  for (const m of mobs.values()) {
    if (Math.abs(m.x - c0.x) > box || Math.abs(m.y - c0.y) > box) continue;
    if (m.hp <= 0 || m.passive || isDormantGuardian(m) || m.tactic === "rout" || m.tactic === "leave") continue;
    for (const c of members) {
      const d = Math.hypot(m.x - c.x, m.y - c.y);
      if (d <= STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE && (!best || d < best.d)) best = { mob: m, member: c, d };
    }
  }
  return best;
}

export function updateAttackMove(g: OrderGroup, members: Colonist[]) {
  const contact = attackMoveContact(members);
  const fighting = members.some((c) => !!c.targetMobId && mobs.has(c.targetMobId));
  // Forts phase A: with no enemy in reach, a hostile site's structure within the alert range of the group
  // is attacked (walls on the way get breached); the march resumes once it falls, as after a fight.
  if (!contact && !fighting && tileOwner.size > 0) {
    let busy = members.some((c) => c.targetHearthId?.startsWith(STRUCTURE_TARGET_PREFIX));
    if (!busy) {
      const c0 = centroidOf(members);
      const s = nearestHostileStructure(c0.x, c0.y, STANCE_ALERT_RANGE_TILES.aggressive * TILE_SIZE);
      if (s) {
        for (const c of members) if (isGuardOrMilitiaKind(c.kind)) sendAgainstHearth(c, s);
        busy = true;
      }
    }
    if (busy) {
      g.engaged = true;
      g.clearSince = -1;
      return;
    }
  }
  if (!g.engaged && !contact) {
    if (groupArrived(g, members)) finishArmyOrder(g, members);
    return;
  }
  if (contact && !fighting && (!g.engaged || !members.some((c) => c.state === "returning"))) {
    // Halt (first contact) or close in: the whole group shifts toward the enemy until its nearest member
    // has it inside its slot's reach, keeping the formation's shape; then battle discipline fights.
    const reach = LINE_LEASH_TILES[contact.member.stance] * TILE_SIZE + unitStats(contact.member).range;
    const shift = Math.max(0, contact.d - reach * 0.8);
    const dx = ((contact.mob.x - contact.member.x) / (contact.d || 1)) * shift;
    const dy = ((contact.mob.y - contact.member.y) / (contact.d || 1)) * shift;
    if (!g.engaged || shift > TILE_SIZE / 2) for (const c of members) haltUnit(c, dx, dy);
  }
  g.engaged = true;
  if (contact || fighting) {
    g.clearSince = -1;
    return;
  }
  if (g.clearSince < 0) {
    g.clearSince = state.cycleTick;
  } else if (state.cycleTick - g.clearSince >= ATTACK_MOVE_RESUME_TICKS && g.current) {
    // Clear for 3 s: on to the same destination and formation (re-formed from here).
    startArmyOrder(g, g.current);
  }
}

export function updateFollowOrder(g: OrderGroup, members: Colonist[]) {
  const t = followTargetPos(g.current!.targetId!);
  if (!t) {
    finishArmyOrder(g, members);
    return;
  }
  const from = g.followAt ?? centroidOf(members);
  const moved = Math.hypot(t.x - from.x, t.y - from.y);
  if (g.followAt && moved <= FOLLOW_REFORM_TILES * TILE_SIZE) return;
  const dx = moved >= 1 ? (t.x - from.x) / moved : Math.cos(g.facing ?? 0);
  const dy = moved >= 1 ? (t.y - from.y) / moved : Math.sin(g.facing ?? 0);
  g.followAt = { x: t.x, y: t.y };
  const x = clamp(t.x - dx * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, state.WORLD_TILES_X * TILE_SIZE - 1);
  const y = clamp(t.y - dy * FOLLOW_BEHIND_TILES * TILE_SIZE, 1, state.WORLD_TILES_Y * TILE_SIZE - 1);
  formGroupAt(g, members, x, y, Math.atan2(dy, dx), g.width);
}

// Per tick: the staggered starts that are due. Every ORDER_UPDATE_TICKS: arrivals, attack-move contact,
// follow re-forms, attack targets, queue pops.
export function updateOrderGroups() {
  if (pendingRallies.size > 0) {
    for (const [id, p] of pendingRallies) {
      if (state.cycleTick < p.at) continue;
      pendingRallies.delete(id);
      const c = colonists.get(id);
      if (c && orderGroupOfUnit.get(id)?.id === p.group) rallyUnit(c, p.x, p.y, p.squad);
    }
  }
  if (state.cycleTick % ORDER_UPDATE_TICKS !== 0) return;
  for (const g of orderGroups.values()) {
    const members = groupMembers(g);
    if (members.length === 0) {
      orderGroups.delete(g.id);
      continue;
    }
    const o = g.current;
    if (!o) {
      const next = g.queue.shift();
      if (next) startArmyOrder(g, next);
      continue;
    }
    if (o.kind === "move" || o.kind === "retreat") {
      if (groupArrived(g, members)) finishArmyOrder(g, members);
    } else if (o.kind === "attackMove") {
      updateAttackMove(g, members);
    } else if (o.kind === "follow") {
      updateFollowOrder(g, members);
    } else if (o.kind === "attack") {
      const mob = mobs.get(o.targetId!);
      if (!mob || mob.hp <= 0) finishArmyOrder(g, members);
    } else if (o.kind === "charge") {
      updateChargeOrder(g, members);
    } else if (o.kind === "attackHearth") {
      if (!attackObjectiveAt(o.tileX!, o.tileY!)) finishArmyOrder(g, members);
    }
  }
}

// Strategy mode phase 4: per-unit settings for the named regiments' members and / or units. A shape
// change re-forms each affected order group where it stands (its destination while marching).
export function handleRegimentSettings(player: Player, msg: { regimentIds?: unknown; unitIds?: unknown; stance?: unknown; holdFire?: unknown; skirmish?: unknown; cycleCharge?: unknown; shape?: unknown }) {
  if (state.simHeldForLoad) return;
  const now = Date.now();
  if (now - player.orderWindowAt >= 1000) {
    player.orderWindowAt = now;
    player.orderWindowCount = 0;
  }
  if (++player.orderWindowCount > REGIMENT_ORDER_MAX_PER_S) return;
  const units = orderedUnits(msg.regimentIds, msg.unitIds);
  const stance = STANCES.includes(msg.stance as Stance) ? (msg.stance as Stance) : undefined;
  const shape = FORMATION_SHAPES.includes(msg.shape as FormationShape) ? (msg.shape as FormationShape) : undefined;
  const reform = new Set<OrderGroup>();
  for (const c of units) {
    if (stance) c.stance = stance;
    if (typeof msg.holdFire === "boolean") c.holdFire = msg.holdFire || undefined;
    if (typeof msg.skirmish === "boolean") c.skirmish = msg.skirmish || undefined;
    if (typeof msg.cycleCharge === "boolean") c.cycleCharge = msg.cycleCharge || undefined;
    if (shape && (c.shape ?? "line") !== shape) {
      c.shape = shape === "line" ? undefined : shape;
      const g = orderGroupOfUnit.get(c.id);
      if (g) reform.add(g);
    }
    // Hold fire drops an uncommanded target at once.
    if (msg.holdFire === true && c.targetMobId && commandedTargets.get(c.id) !== c.targetMobId && !unitStats(c).melee) dropGuardTarget(c);
  }
  for (const g of reform) {
    const o = g.current;
    if (o && (o.kind === "move" || o.kind === "attackMove" || o.kind === "retreat") && !g.engaged) {
      startArmyOrder(g, o);
    } else if ((!o || o.kind === "hold") && g.lastAt) {
      const members = groupMembers(g);
      if (members.length > 0) formGroupAt(g, members, g.lastAt.x, g.lastAt.y, g.facing, g.width);
    }
  }
}

// Sent when an order group changes, else every ARMY_REGIMENT_REFRESH_TICKS.
export function orderGroupsForSnapshot(): ArmyOrderGroupSnapshot[] | undefined {
  // Clans: only groups of the active clan's units (a group never mixes clans: orders take own units only).
  const groups = clans.length === 1 ? Array.from(orderGroups.values()) : Array.from(orderGroups.values()).filter((g) => {
    for (const id of g.unitIds) return (colonists.get(id)?.clan ?? 0) === state.clan.id;
    return false;
  });
  const list: ArmyOrderGroupSnapshot[] = groups.map((g) => ({
    id: g.id,
    unitIds: Array.from(g.unitIds),
    order: g.current,
    queue: g.queue,
    ...(g.facing !== undefined ? { facing: g.facing } : {}),
    ...(g.width !== undefined ? { width: g.width } : {}),
    ...(g.engaged ? { engaged: true } : {}),
  }));
  const signature = JSON.stringify(list);
  state.orderGroupTicks++;
  if (signature === state.orderGroupSignature && state.orderGroupTicks < ARMY_REGIMENT_REFRESH_TICKS) return undefined;
  state.orderGroupSignature = signature;
  state.orderGroupTicks = 0;
  return list;
}

// ---- Strategy mode phase 5: enemy regiment summaries (docs PLAN-strategy-mode.md §3 / §4) ----

export function stampLiveVision() {
  if (state.liveVisionGrid.length !== state.WORLD_TILES_X * state.WORLD_TILES_Y) {
    state.liveVisionGrid = new Uint16Array(state.WORLD_TILES_X * state.WORLD_TILES_Y);
    state.liveVisionStamp = 0;
  }
  state.liveVisionStamp = (state.liveVisionStamp % 65535) + 1;
  if (state.liveVisionStamp === 1) state.liveVisionGrid.fill(0);
  const stamp = (px: number, py: number, offsets: Array<[number, number]>) => {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    for (const [dx, dy] of offsets) {
      const x = tx + dx;
      const y = ty + dy;
      if (x >= 0 && y >= 0 && x < state.WORLD_TILES_X && y < state.WORLD_TILES_Y) state.liveVisionGrid[y * state.WORLD_TILES_X + x] = state.liveVisionStamp;
    }
  };
  for (const p of players.values()) stamp(p.x, p.y, PLAYER_VISION_OFFSETS);
  for (const c of colonists.values()) if (!isAbbeyClergy(c)) stamp(c.x, c.y, COLONIST_VISION_OFFSETS);
}

export function inLiveVision(px: number, py: number): boolean {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= state.WORLD_TILES_X || ty >= state.WORLD_TILES_Y) return false;
  return state.liveVisionGrid[ty * state.WORLD_TILES_X + tx] === state.liveVisionStamp;
}

export function enemyRegimentsNow(): EnemyRegimentSnapshot[] {
  stampLiveVision();
  const groups = new Map<string, { all: number; seen: Mob[] }>();
  for (const m of mobs.values()) {
    if (m.hp <= 0) continue;
    const key = regimentKey(m) ?? `c:${Math.floor(m.x / TILE_SIZE / ENEMY_CELL_TILES)},${Math.floor(m.y / TILE_SIZE / ENEMY_CELL_TILES)}`;
    let g = groups.get(key);
    if (!g) {
      g = { all: 0, seen: [] };
      groups.set(key, g);
    }
    g.all++;
    if (inLiveVision(m.x, m.y)) g.seen.push(m);
  }
  const night = isNightNow();
  const out: EnemyRegimentSnapshot[] = [];
  for (const [id, g] of groups) {
    const seen = g.seen;
    if (seen.length === 0) continue;
    let x = 0;
    let y = 0;
    let hp = 0;
    let maxHp = 0;
    let dmg = 0;
    let threat = fightThreatOf(seen[0]);
    const roles: Partial<Record<CombatRole, number>> = {};
    for (const m of seen) {
      x += m.x;
      y += m.y;
      hp += Math.max(0, m.hp);
      maxHp += m.maxHp;
      dmg += m.damage;
      const role = mobRole(m);
      roles[role] = (roles[role] ?? 0) + 1;
      const t = fightThreatOf(m);
      if (t.rank > threat.rank) threat = t;
    }
    const snap: EnemyRegimentSnapshot = {
      id,
      // Scale pass: a pack of nothing but wolf riders gets its own banner label.
      label: seen.every((m) => m.kind === "goblinRider") && threat.kind === "raid" ? "Goblin wolf riders" : threat.label,
      x: Math.round(x / seen.length),
      y: Math.round(y / seen.length),
      count: seen.length,
      roles,
      power: Math.round(hp * dmg),
      hpFrac: maxHp > 0 ? Math.round((hp / maxHp) * 100) / 100 : 0,
    };
    if (g.all > seen.length) snap.partial = true;
    if (!night && seen.some((m) => m.groupId !== null && m.passive)) snap.massing = true;
    const reg = regiments.get(id);
    if (reg?.routed) snap.routed = true;
    if (reg?.sheltering) snap.sheltering = true;
    // Phase 6: morale bar and "Outflanked!" on the enemy banner.
    if (reg) snap.morale = Math.round(reg.morale);
    if (reg?.outflankedTick !== undefined && state.cycleTick - reg.outflankedTick <= ENEMY_OUTFLANKED_SHOW_TICKS) snap.outflanked = true;
    const flankers = reg ? reg.flankIds.map((fid) => mobs.get(fid)).filter((m): m is Mob => !!m && m.tactic === "flank") : [];
    const end = flankers[0]?.flankWaypoints?.[flankers[0].flankWaypoints.length - 1];
    // Only a flank whose runners are in sight (the arc itself is the warning).
    if (end && flankers.some((m) => inLiveVision(m.x, m.y))) {
      snap.flank = {
        fromX: Math.round(flankers.reduce((s, m) => s + m.x, 0) / flankers.length),
        fromY: Math.round(flankers.reduce((s, m) => s + m.y, 0) / flankers.length),
        x: Math.round(end.x),
        y: Math.round(end.y),
        ...(flankers[0].flankTargetId ? { targetId: flankers[0].flankTargetId } : {}),
      };
    }
    out.push(snap);
  }
  return out;
}
