// siege.ts: Cavalry charges, siege strikes, the Siege Workshop, and the raids' siege engines.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TILE_SIZE, type SiegeKind, type BuildingInfo, SIEGE_KINDS, TileType } from "@colony/shared/protocol";
import type { Mob, PickedTarget } from "./types.js";
import {
  CATAPULT_BUILDING_MULT, CATAPULT_MIN_RANGE, CATAPULT_RELOAD_TICKS, CATAPULT_SPLASH_PX,
  CAVALRY_CHARGE_COOLDOWN_TICKS, CAVALRY_CHARGE_IDLE_GRACE_TICKS, CAVALRY_CHARGE_MULT, CAVALRY_CHARGE_TILES,
  COLONIST_BODY_RADIUS, MOB_KIND_CONFIG, MOB_REPATH_TICKS, RAM_ATTACK_COOLDOWN_TICKS, RAM_GATE_SCAN_TILES,
  RAM_UNIT_MULT, RANGED_KITE_TILES, SIEGE_BUILDING_MULT, SIEGE_BUILD_TICKS, SIEGE_LABEL, SIEGE_POPULATION_COST,
  SIEGE_RETARGET_TICKS, SIEGE_UNIT_COST, SIEGE_WORKSHOP_CAP,
} from "./constants.js";
import {
  chargeRuns, colonists, gates, mobs, mobsAttackingThisTick, players, siegeEvents, siegeWorkshops, state,
} from "./state.js";
import { inBounds, ownerAt, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findPath } from "./pathfinding.js";
import { activeWardSources, isAbbeyClergy, isWarded, settlementBlocker, spawnColonistForPost } from "./colonists.js";
import { isSiegeKind, nearestMeleeSoldier } from "./units.js";
import {
  damageBuilding, damageColonist, damageMob, damagePlayer, gatePassable, isTowerTarget, isTowerTile, isWallTile,
  mobTargetNeedsRepick, structureHp,
} from "./combat.js";
import {
  keyToTile, pickBuildingTarget, regimentFrontDistance, resolveTargetPosition, routeToBuilding, stepMobAwayFrom,
} from "./mobs.js";
import { canAfford, formatCost, spend } from "./construction.js";
import { broadcastEvent, recordFightHit, recordMobStrike } from "./net.js";

// ---- Cavalry & siege (ROADMAP "Cavalry & siege"): the cavalry charge, siege strikes and the catapult's
// splash, Siege Workshop production, and the raids' siege engines (updateSiegeMob). ----

export function siegeEvent(type: string, id: string, amount?: number, detail?: string) {
  siegeEvents.push({ tick: state.cycleTick, type, id, amount, detail });
  if (siegeEvents.length > 200) siegeEvents.shift();
}

// Once per tick for a rider (before it moves): a stride turning more than 60 degrees off the run's line
// starts a new run where the turn was; standing still past the grace ends it.
export function trackCharge(c: { id: string; x: number; y: number }) {
  const run = chargeRuns.get(c.id);
  if (!run) {
    chargeRuns.set(c.id, { ax: c.x, ay: c.y, lx: c.x, ly: c.y, idle: 0, readyTick: 0 });
    return;
  }
  const sx = c.x - run.lx;
  const sy = c.y - run.ly;
  const step = Math.hypot(sx, sy);
  const rx = run.lx - run.ax;
  const ry = run.ly - run.ay;
  const rl = Math.hypot(rx, ry);
  if (step < 0.5) {
    if (++run.idle > CAVALRY_CHARGE_IDLE_GRACE_TICKS) {
      run.ax = c.x;
      run.ay = c.y;
    }
  } else {
    run.idle = 0;
    if (rl > 1 && (sx * rx + sy * ry) / (step * rl) < 0.5) {
      run.ax = run.lx;
      run.ay = run.ly;
    }
  }
  run.lx = c.x;
  run.ly = c.y;
}

// The damage multiplier of a rider's blow: x CAVALRY_CHARGE_MULT when it ends a straight run of
// CAVALRY_CHARGE_TILES+ off cooldown. Any blow ends the run.
export function takeChargeBonus(c: { id: string; x: number; y: number }): number {
  const run = chargeRuns.get(c.id);
  if (!run) return 1;
  const ok = state.cycleTick >= run.readyTick && Math.hypot(c.x - run.ax, c.y - run.ay) >= CAVALRY_CHARGE_TILES * TILE_SIZE;
  run.ax = c.x;
  run.ay = c.y;
  if (!ok) return 1;
  run.readyTick = state.cycleTick + CAVALRY_CHARGE_COOLDOWN_TICKS;
  return CAVALRY_CHARGE_MULT;
}

// A boulder from (fx, fy) landing at (tx, ty): `damage` to every unit of the other side within
// CATAPULT_SPLASH_PX, x CATAPULT_BUILDING_MULT to every building there (the raids' catapults only: the
// colony's never hit its own buildings, and monsters have none).
export function catapultImpact(fx: number, fy: number, tx: number, ty: number, damage: number, side: "colony" | "mob", attackerKey: string) {
  state.pendingEffects.push({ fromX: fx, fromY: fy, toX: tx, toY: ty, boulder: true });
  let hits = 0;
  if (side === "colony") {
    for (const m of Array.from(mobs.values())) {
      if (!isTowerTarget(m) || Math.hypot(m.x - tx, m.y - ty) > CATAPULT_SPLASH_PX) continue;
      damageMob(m, damage, attackerKey);
      hits++;
    }
    siegeEvent("boulder", attackerKey, damage, `units:${hits}`);
    return;
  }
  for (const c of Array.from(colonists.values())) {
    if (isAbbeyClergy(c) || Math.hypot(c.x - tx, c.y - ty) > CATAPULT_SPLASH_PX) continue;
    damageColonist(c, damage);
    hits++;
  }
  for (const p of players.values()) {
    if (p.dead || state.testPlayersIgnored || Math.hypot(p.x - tx, p.y - ty) > CATAPULT_SPLASH_PX) continue;
    damagePlayer(p, damage);
    hits++;
  }
  let buildings = 0;
  const c0 = tileOfPixel(tx, ty);
  const r = Math.ceil(CATAPULT_SPLASH_PX / TILE_SIZE);
  for (let y = c0.y - r; y <= c0.y + r; y++) {
    for (let x = c0.x - r; x <= c0.x + r; x++) {
      if (!inBounds(x, y) || !structureHp(x, y)) continue;
      const centre = tileToPixelCenter({ x, y });
      if (Math.hypot(centre.x - tx, centre.y - ty) > CATAPULT_SPLASH_PX + TILE_SIZE / 2) continue;
      damageBuilding(x, y, damage * CATAPULT_BUILDING_MULT);
      buildings++;
    }
  }
  siegeEvent("boulder", attackerKey, damage, `units:${hits},buildings:${buildings}`);
}

export function siegeUnitsAt(tx: number, ty: number): number {
  let n = 0;
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && isSiegeKind(c.kind)) n++;
  return n;
}

// Why the workshop at (tx, ty) can't start `kind` now ("" = it can).
export function siegeQueueBlocker(tx: number, ty: number, kind: SiegeKind): string {
  const state = siegeWorkshops.get(resourceKey(tx, ty));
  if (state?.building) return `Building a ${SIEGE_LABEL[state.building]}`;
  if (siegeUnitsAt(tx, ty) >= SIEGE_WORKSHOP_CAP) return `At most ${SIEGE_WORKSHOP_CAP} engines`;
  if (!canAfford(SIEGE_UNIT_COST[kind])) return "Not enough resources";
  const full = settlementBlocker(tx, ty, SIEGE_POPULATION_COST);
  if (full) return full;
  return "";
}

export function siegeWorkshopInfo(tx: number, ty: number): NonNullable<BuildingInfo["siege"]> {
  const state = siegeWorkshops.get(resourceKey(tx, ty));
  return {
    building: state?.building ?? null,
    progress: state?.building ? 1 - state.ticksLeft / SIEGE_BUILD_TICKS : null,
    units: siegeUnitsAt(tx, ty),
    cap: SIEGE_WORKSHOP_CAP,
    options: SIEGE_KINDS.map((kind) => {
      const reason = siegeQueueBlocker(tx, ty, kind);
      return { kind, label: SIEGE_LABEL[kind], cost: formatCost(SIEGE_UNIT_COST[kind]), enabled: reason === "", reason };
    }),
  };
}

export function handleQueueSiege(tx: number, ty: number, kind: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.SiegeWorkshop) return;
  if (kind !== "batteringRam" && kind !== "catapult") return;
  if (siegeQueueBlocker(tx, ty, kind) !== "") return;
  spend(SIEGE_UNIT_COST[kind]);
  siegeWorkshops.set(resourceKey(tx, ty), { building: kind, ticksLeft: state.instantBuild ? 1 : SIEGE_BUILD_TICKS });
}

// Once per tick: an engine under way rolls out when its timer runs down.
export function updateSiegeWorkshops() {
  for (const [key, localState] of siegeWorkshops) {
    if (!localState.building) continue;
    const tile = keyToTile(key);
    if (!tile || state.tiles[tileIndex(tile.x, tile.y)] !== TileType.SiegeWorkshop) {
      siegeWorkshops.delete(key);
      continue;
    }
    if (--localState.ticksLeft > 0) continue;
    const c = spawnColonistForPost(tile.x, tile.y, localState.building, 1);
    broadcastEvent("build", `A ${SIEGE_LABEL[localState.building].toLowerCase()} rolls out of the Siege Workshop`);
    siegeEvent("built", c.id, undefined, localState.building);
    localState.building = null;
  }
}
// Per raid, each siege kind is capped at raidSiegeCap(day): 1 from its unlock day, +1 every 6 days.
export function raidSiegeCap(dayIndex: number, kind: SiegeKind): number {
  return Math.max(0, 1 + Math.floor((dayIndex - MOB_KIND_CONFIG[kind].unlockDay) / 6));
}

export function pickRamTarget(mob: Mob): PickedTarget | null {
  const wards = activeWardSources();
  const start = tileOfPixel(mob.x, mob.y);
  const closed: { x: number; y: number; d: number }[] = [];
  for (const index of gates.keys()) {
    // Forts phase A: raid rams only ram the colony's gates.
    if (gatePassable(index, true) || ownerAt(index) !== 0) continue;
    const x = index % state.WORLD_TILES_X;
    const y = Math.floor(index / state.WORLD_TILES_X);
    const c = tileToPixelCenter({ x, y });
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d <= RAM_GATE_SCAN_TILES * TILE_SIZE && !isWarded(c.x, c.y, wards)) closed.push({ x, y, d });
  }
  closed.sort((a, b) => a.d - b.d);
  for (const g of closed.slice(0, 3)) {
    const route = routeToBuilding(start, g.x, g.y, 0);
    if (route) return { type: "building", id: resourceKey(g.x, g.y), approach: route.length > 0 ? route[route.length - 1] : start };
  }
  return pickBuildingTarget(mob, wards);
}

// The best catapult shot from where it stands, within [CATAPULT_MIN_RANGE, its range]: towers first,
// then walls / gates, then any other building or Town Center (nearest in each class), else the unit
// (colonist / player) with the most others within the splash. null: nothing in range.
export function pickCatapultShot(mob: Mob): { x: number; y: number } | null {
  const wards = activeWardSources();
  const here = tileOfPixel(mob.x, mob.y);
  const r = Math.ceil(mob.range / TILE_SIZE);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = here.y - r; y <= here.y + r; y++) {
    for (let x = here.x - r; x <= here.x + r; x++) {
      if (!inBounds(x, y) || !structureHp(x, y)) continue;
      const c = tileToPixelCenter({ x, y });
      const d = Math.hypot(c.x - mob.x, c.y - mob.y);
      if (d < CATAPULT_MIN_RANGE || d > mob.range || isWarded(c.x, c.y, wards)) continue;
      const t = state.tiles[tileIndex(x, y)] as TileType;
      const cls = isTowerTile(t) ? 0 : isWallTile(t) || t === TileType.Gate ? 1 : 2;
      const score = cls * 1e6 + d;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  if (best) return best;
  const units: { x: number; y: number }[] = [];
  for (const c of colonists.values()) if (!isAbbeyClergy(c) && !isWarded(c.x, c.y, wards)) units.push(c);
  for (const p of players.values()) if (!p.dead && !state.testPlayersIgnored && !isWarded(p.x, p.y, wards)) units.push(p);
  let bestCount = 0;
  for (const u of units) {
    const d = Math.hypot(u.x - mob.x, u.y - mob.y);
    if (d < CATAPULT_MIN_RANGE || d > mob.range) continue;
    const count = units.filter((o) => Math.hypot(o.x - u.x, o.y - u.y) <= CATAPULT_SPLASH_PX).length;
    if (count > bestCount || (count === bestCount && best && d < Math.hypot(best.x - mob.x, best.y - mob.y))) {
      bestCount = count;
      best = { x: u.x, y: u.y };
    }
  }
  return best;
}

// Walks a siege mob along a path to (x, y) (the shared mob pathing, MOB_REPATH_TICKS apart).
export function walkSiegeMob(mob: Mob, x: number, y: number, dt: number) {
  if (mob.path.length === 0 && mob.repathCooldown <= 0) {
    const path = findPath(tileOfPixel(mob.x, mob.y), tileOfPixel(x, y));
    mob.path = path ?? [];
    mob.repathCooldown = MOB_REPATH_TICKS;
  } else if (mob.repathCooldown > 0) {
    mob.repathCooldown--;
  }
  advanceAlongPath(mob, dt, mob.speed);
}

export function updateSiegeMob(mob: Mob, dt: number, hold: boolean) {
  if (mob.attackCooldownTicks > 0) mob.attackCooldownTicks--;
  if (mob.kind === "catapult") {
    const shot = pickCatapultShot(mob);
    if (shot) {
      mob.path = [];
      const threat = nearestMeleeSoldier(mob.x, mob.y, RANGED_KITE_TILES * TILE_SIZE);
      if (threat && !hold) stepMobAwayFrom(mob, threat.x, threat.y, dt);
      if (mob.attackCooldownTicks <= 0) {
        mob.attackCooldownTicks = CATAPULT_RELOAD_TICKS;
        mobsAttackingThisTick.add(mob.id);
        recordFightHit(mob, (mob.x + shot.x) / 2, (mob.y + shot.y) / 2, "b:siege", mob.damage);
        catapultImpact(mob.x, mob.y, shot.x, shot.y, mob.damage, "mob", "m:" + mob.id);
      }
      return;
    }
    if (hold) return;
    // Nothing in range: advance on the colony like any raider, but never past its regiment's front rank.
    if (!mob.targetType || state.cycleTick % SIEGE_RETARGET_TICKS === 0) {
      const picked = pickBuildingTarget(mob, activeWardSources());
      mob.targetType = picked?.type ?? null;
      mob.targetId = picked?.id ?? null;
      mob.approachFor = picked?.approach ? picked.id : null;
      mob.approachX = picked?.approach?.x ?? -1;
      mob.approachY = picked?.approach?.y ?? -1;
    }
    const goal = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
    if (!goal) return;
    const regiment = mob.regimentId ?? mob.siteId;
    const frontDist = regiment ? regimentFrontDistance(mob, regiment, goal) : Infinity;
    if (frontDist < Infinity && Math.hypot(goal.x - mob.x, goal.y - mob.y) <= frontDist + TILE_SIZE * 2) {
      mob.path = [];
      return;
    }
    walkSiegeMob(mob, goal.x, goal.y, dt);
    return;
  }
  // Battering ram.
  let targetPos = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
  const onGate = mob.targetType === "building" && mob.targetId !== null && (() => {
    const t = keyToTile(mob.targetId!);
    return !!t && state.tiles[tileIndex(t.x, t.y)] === TileType.Gate;
  })();
  if (targetPos && mobTargetNeedsRepick(mob)) targetPos = null;
  if (targetPos && !onGate && state.cycleTick % SIEGE_RETARGET_TICKS === 0) targetPos = null;
  if (!targetPos && !hold) {
    const picked = pickRamTarget(mob);
    if (picked && (picked.id !== mob.targetId || picked.type !== mob.targetType)) {
      mob.path = [];
      mob.repathCooldown = 0;
    }
    mob.targetType = picked?.type ?? null;
    mob.targetId = picked?.id ?? null;
    mob.approachFor = picked?.approach ? picked.id : null;
    mob.approachX = picked?.approach?.x ?? -1;
    mob.approachY = picked?.approach?.y ?? -1;
    targetPos = picked ? resolveTargetPosition(picked.type, picked.id, mob) : null;
  }
  // No building to hit: a unit standing right next to it.
  if (!targetPos) {
    const reach = mob.range + COLONIST_BODY_RADIUS;
    for (const c of colonists.values()) {
      if (!isAbbeyClergy(c) && Math.hypot(c.x - mob.x, c.y - mob.y) <= reach) {
        mob.targetType = "colonist";
        mob.targetId = c.id;
        targetPos = { x: c.x, y: c.y };
        break;
      }
    }
    if (!targetPos) return;
  }
  const dist = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
  if (dist > mob.range) {
    if (!hold) walkSiegeMob(mob, targetPos.x, targetPos.y, dt);
    return;
  }
  mob.path = [];
  mobsAttackingThisTick.add(mob.id);
  if (mob.attackCooldownTicks > 0) return;
  mob.attackCooldownTicks = RAM_ATTACK_COOLDOWN_TICKS;
  const struck = (mob.targetType === "building" || mob.targetType === "townCenter") && mob.targetId ? keyToTile(mob.targetId) : null;
  const hit = struck ? tileToPixelCenter(struck) : targetPos;
  state.pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: hit.x, toY: hit.y, melee: true });
  if (mob.targetId) recordMobStrike(mob, hit.x, hit.y);
  if (struck) {
    const amount = mob.damage * SIEGE_BUILDING_MULT;
    siegeEvent("ramHit", mob.id, amount, `building:${state.tiles[tileIndex(struck.x, struck.y)]}`);
    damageBuilding(struck.x, struck.y, amount);
  } else if (mob.targetType === "colonist" && mob.targetId) {
    const c = colonists.get(mob.targetId);
    if (c) {
      siegeEvent("ramHit", mob.id, mob.damage * RAM_UNIT_MULT, "unit");
      damageColonist(c, mob.damage * RAM_UNIT_MULT);
    }
    mob.targetType = null;
    mob.targetId = null;
  }
}
