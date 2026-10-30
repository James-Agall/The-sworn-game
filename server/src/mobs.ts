// mobs.ts: Mob kinds, sizes, hunger marks, difficulty, targeting, building routing and the mob tick.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import {
  mobSizeScale, HungerMark, HUNGER_MARK_NAMES, type MobKind, type Difficulty, MOB_SIZE_RANGE, TILE_SIZE, TileType,
  TICK_RATE, isSolidTile,
} from "@colony/shared/protocol";
import type { Colonist, Mob, MobTargetType, PickedTarget, Player, TileCoord } from "./types.js";
import {
  ARCHER_FRONT_RANK_SCAN_TILES, BREACH_DETOUR_FACTOR, BREACH_MIN_ROUTE_TILES, BREACH_WALL_COST,
  BUILDING_TARGET_CANDIDATES, COLONIST_BODY_RADIUS, DARK_SHAMAN_HEAL_AMOUNT, DARK_SHAMAN_HEAL_COOLDOWN_TICKS,
  DARK_SHAMAN_HEAL_RANGE, DAY_TICKS, GOBLIN_RIDER_WITHDRAW_TICKS, GOLD_PER_KILL_BASE_DIVISOR, GOLD_PER_KILL_MIN,
  GORRATH_SCAN_RANGE_TILES, GUNNE_SCAN_RANGE_TILES, HUNGER_MARK_CHANCE_MAX, HUNGER_MARK_CHANCE_MAX_DAY,
  HUNGER_MARK_CHANCE_START, HUNGER_MARK_DAMAGE_MULT, HUNGER_MARK_GOLD_MULT, HUNGER_MARK_HP_MULT, HUNGER_MARK_MIN_DAY,
  MARK_RETARGET_TICKS, MOB_AGGRO_DROP_FACTOR, MOB_AGGRO_RANGE_GUARD_TILES, MOB_AGGRO_RANGE_PLAYER_TILES,
  MOB_ATTACK_COOLDOWN_TICKS, MOB_BODY_RADIUS, MOB_BODY_RADIUS_MAX, MOB_BUILDING_AGGRO_TILES, MOB_KIND_CONFIG,
  MOB_REPATH_TICKS, MOB_ROOM_DETOUR_PX, MOB_SIZE_DAMAGE_PER_SCALE, MOB_SIZE_HP_PER_SCALE, MOB_SIZE_SPEED_PER_SCALE,
  PLAYER_BODY_RADIUS, POISON_DAMAGE_PER_TICK, POISON_DURATION_TICKS, QUEUE_STANDOFF_PX, RANGED_KITE_TILES,
  ROUTE_NODE_BUDGET, RUX_FEINT_TICKS, SIEGE_GOLD_MULT, SITE_CALM_SCAN_TILES, SITE_CHASE_EXTRA_TILES,
  SITE_HEAL_CALM_TICKS, SITE_HEAL_PER_SEC, SITE_HEAL_RADIUS_TILES, SITE_RESET_CALM_TICKS, SITE_RETURN_IGNORE_TICKS,
  SITE_RETURN_SPEED_MULT, SLOT_CLOSE_IN_PX, TROLL_REGEN_DELAY_TICKS,
  TROLL_REGEN_PER_TICK, VHORRUN_WITHDRAW_TARGET_HP, VHORRUN_WITHDRAW_TICKS, clampWorldSize,
} from "./constants.js";
import {
  attackerSlots, colonists, mobs, mobsAttackingThisTick, mobsWithoutRoute, players, state, tileOwner,
} from "./state.js";
import { inBounds, isHostileOwner, ownerAt, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { activeWardSources, isWarded } from "./colonists.js";
import { isGuardOrMilitiaKind, isRearColonist, isRearMob, isSiegeKind, nearestMeleeSoldier } from "./units.js";
import {
  approachGoal, breachStepCost, buildingSlotTile, damageBuilding, damageColonist, damagePlayer, damageTownCenter,
  gatePassable, isBreachObstacle, isDamageableBuilding, isWallTile, meleeAttackerCap, mobSlotKey,
  mobTargetNeedsRepick, releaseSlot, targetHasRoom, unitSlotPoint,
} from "./combat.js";
import { siegeEvent, takeChargeBonus, trackCharge, updateSiegeMob } from "./siege.js";
import { clearMobTarget, mobTactic, regimentKey, tacticsEvent } from "./tactics.js";
import { siteLeash, type SiteLeash } from "./sites.js";
import { stepRaidMobToward } from "./raids.js";
import { playerMaxHp } from "./heroes.js";
import { resetWorld } from "./saves.js";
import { recordMobStrike } from "./net.js";

export function mobBodyRadius(m: Mob): number {
  return Math.min(MOB_BODY_RADIUS_MAX, (MOB_BODY_RADIUS[m.kind] ?? 8) * mobSizeScale(m));
}
// How much further a melee soldier reaches a grown mob from (its hit area): the extra body radius.
export function mobHitBonus(m: Mob): number {
  return Math.max(0, mobBodyRadius(m) - (MOB_BODY_RADIUS[m.kind] ?? 8));
}
export function goldForKill(mob: Mob): number {
  const raw = Math.max(GOLD_PER_KILL_MIN, Math.round((mob.maxHp + mob.damage * 2) / GOLD_PER_KILL_BASE_DIVISOR));
  const base = isSiegeKind(mob.kind) ? raw * SIEGE_GOLD_MULT : raw;
  return mob.mark !== HungerMark.None ? base * HUNGER_MARK_GOLD_MULT : base;
}

export function hungerMarkChance(dayIndex: number): number {
  if (state.testForceMarkChance !== null) return state.testForceMarkChance;
  if (dayIndex < HUNGER_MARK_MIN_DAY) return 0;
  const t = Math.min(1, (dayIndex - HUNGER_MARK_MIN_DAY) / (HUNGER_MARK_CHANCE_MAX_DAY - HUNGER_MARK_MIN_DAY));
  return HUNGER_MARK_CHANCE_START + (HUNGER_MARK_CHANCE_MAX - HUNGER_MARK_CHANCE_START) * t;
}

export function applyHungerMark(mob: Mob, mark: HungerMark) {
  mob.mark = mark;
  mob.maxHp = Math.max(1, Math.round(mob.maxHp * HUNGER_MARK_HP_MULT));
  mob.hp = mob.maxHp;
  mob.damage = Math.max(1, Math.round(mob.damage * HUNGER_MARK_DAMAGE_MULT));
}

export function hungerMarkLabel(mark: HungerMark): string {
  const name = HUNGER_MARK_NAMES[mark] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// "armoredOrc" -> "armored orc", for event text.
export function mobKindLabel(kind: MobKind): string {
  if (kind === "goblinRider") return "goblin wolf rider";
  return kind.replace(/([A-Z])/g, " $1").toLowerCase();
}
export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}
export function handleSetDifficulty(value: unknown, worldSize?: unknown) {
  if (!isDifficulty(value)) return;
  const soloFirstDay = players.size <= 1 && state.cycleTick < DAY_TICKS;
  if (state.difficultyClaimed && !soloFirstDay) return;
  // New Game with a different map size: regenerate the (still unclaimed / first-day solo) world at it.
  if (typeof worldSize === "number" && Number.isFinite(worldSize) && clampWorldSize(worldSize) !== state.WORLD_TILES_X) {
    resetWorld(value, worldSize);
    return;
  }
  state.difficulty = value;
  state.difficultyClaimed = true;
}
export function hashString01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
export function rollMobSize(kind: MobKind, id: string): number {
  const range = MOB_SIZE_RANGE[kind];
  if (!range) return 1;
  const u = hashString01(id + ":size");
  const s = u < 0.5 ? range[0] + (1 - range[0]) * (u * 2) : 1 + (range[1] - 1) * ((u - 0.5) * 2);
  return Math.round(s * 100) / 100;
}
// Applies the size roll and the kind scale (MOB_KIND_SCALE: trolls / ogres reach further) to a freshly
// built mob (createRaidMob / spawnGuardian). Bosses (rollSize false: makeBoss runs next) take no roll,
// their size is their tier's BOSS_RENDER_SCALE.
export function applyMobSize(mob: Mob, rollSize = true) {
  const s = rollSize ? rollMobSize(mob.kind, mob.id) : 1;
  if (s !== 1) {
    mob.scale = s;
    mob.maxHp = Math.max(1, Math.round(mob.maxHp * (1 + (s - 1) * MOB_SIZE_HP_PER_SCALE)));
    mob.hp = mob.maxHp;
    mob.damage = Math.max(1, Math.round(mob.damage * (1 + (s - 1) * MOB_SIZE_DAMAGE_PER_SCALE) * 10) / 10);
    mob.speed = mob.speed * (1 + (s - 1) * MOB_SIZE_SPEED_PER_SCALE);
  }
  if (mob.melee) mob.range = MOB_KIND_CONFIG[mob.kind].range * mobSizeScale({ kind: mob.kind, scale: mob.scale });
}

export function isDormantGuardian(mob: Mob): boolean {
  return mob.siteId !== null && !mob.guardianActive;
}

// Wakes every guardian sharing siteId, permanently (no re-dormancy). A human settlement's workers
// (forts phase C) never fight: they stay "dormant" and run to shelter instead (updateSiteWorker).
export function activateGuardianSite(siteId: string) {
  for (const m of mobs.values()) {
    if (m.siteId === siteId && !m.siteWorker) m.guardianActive = true;
  }
}

// Candidates under an active ward are skipped. If that leaves nothing, returns null and updateMob
// leaves the mob standing where it is until something targetable turns up (same as before when
// there was simply nothing to attack).
// The nearest unwarded Town Center as a mob target, or null.
export function nearestUnwardedTownCenterTarget(mob: Mob, wards: TileCoord[]): { type: MobTargetType; id: string } | null {
  const byDistance = state.townCenters
    .map((tc) => ({ tc, pos: tileToPixelCenter(tc) }))
    .sort((a, b) => Math.hypot(a.pos.x - mob.x, a.pos.y - mob.y) - Math.hypot(b.pos.x - mob.x, b.pos.y - mob.y));
  for (const { tc } of byDistance) {
    const id = resourceKey(tc.x, tc.y);
    const pos = resolveTargetPosition("townCenter", id);
    if (pos && !isWarded(pos.x, pos.y, wards)) return { type: "townCenter", id };
  }
  return null;
}

// Gunne: the most wounded (lowest hp fraction, below full) guard / militia / player in range.
// Gorrath: the healthiest (highest current hp) one in range. null falls back to ordinary targeting.
export function pickMarkedUnitTarget(mob: Mob, wards: TileCoord[]): { type: MobTargetType; id: string } | null {
  const gunne = mob.mark === HungerMark.Gunne;
  const rangePx = (gunne ? GUNNE_SCAN_RANGE_TILES : GORRATH_SCAN_RANGE_TILES) * TILE_SIZE;
  let best: { type: MobTargetType; id: string } | null = null;
  let bestScore = -Infinity;
  const consider = (type: MobTargetType, id: string, x: number, y: number, hp: number, maxHp: number) => {
    if (Math.hypot(x - mob.x, y - mob.y) > rangePx || isWarded(x, y, wards)) return;
    const ratio = hp / Math.max(1, maxHp);
    if (gunne && ratio >= 1) return;
    const score = gunne ? -ratio : hp;
    if (score > bestScore) {
      bestScore = score;
      best = { type, id };
    }
  };
  for (const c of colonists.values()) {
    if (isGuardOrMilitiaKind(c.kind)) consider("colonist", c.id, c.x, c.y, c.hp, c.maxHp);
  }
  for (const p of players.values()) {
    if (!p.dead) consider("player", p.id, p.x, p.y, p.hp, playerMaxHp(p));
  }
  return best;
}

export function pickMobTarget(mob: Mob): PickedTarget | null {
  const wards = activeWardSources();
  if (mob.mark === HungerMark.Nemri) {
    const tc = nearestUnwardedTownCenterTarget(mob, wards);
    if (tc) return tc;
  } else if (mob.mark === HungerMark.Gunne || mob.mark === HungerMark.Gorrath) {
    const picked = pickMarkedUnitTarget(mob, wards);
    if (picked) return picked;
  }
  // Guards / players only draw a mob within its aggro range; beyond that it goes for buildings.
  // Battle discipline: a melee mob prefers the nearest soldier that still has room for another attacker
  // (meleeAttackerCap) when it is at most MOB_ROOM_DETOUR_PX further than the nearest one, so a raid
  // spreads along the defenders' line instead of piling onto the first man; otherwise it queues on the
  // nearest (see updateMob).
  let bestGuard: Colonist | null = null;
  let bestGuardDist = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  let roomGuard: Colonist | null = null;
  let roomGuardDist = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  const guardCap = meleeAttackerCap(COLONIST_BODY_RADIUS);
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (isWarded(c.x, c.y, wards)) continue;
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d < bestGuardDist) {
      bestGuardDist = d;
      bestGuard = c;
    }
    if (mob.melee && d < roomGuardDist && targetHasRoom(mob.id, `c:${c.id}`, guardCap)) {
      roomGuardDist = d;
      roomGuard = c;
    }
  }
  if (roomGuard && roomGuardDist <= bestGuardDist + MOB_ROOM_DETOUR_PX) return { type: "colonist", id: roomGuard.id };
  if (bestGuard) return { type: "colonist", id: bestGuard.id };

  let bestPlayer: Player | null = null;
  let bestPlayerDist = MOB_AGGRO_RANGE_PLAYER_TILES * TILE_SIZE;
  for (const p of players.values()) {
    if (p.dead || state.testPlayersIgnored || isWarded(p.x, p.y, wards)) continue;
    const d = Math.hypot(p.x - mob.x, p.y - mob.y);
    if (d < bestPlayerDist) {
      bestPlayerDist = d;
      bestPlayer = p;
    }
  }
  if (bestPlayer) return { type: "player", id: bestPlayer.id };

  // No guard / player to fight: the nearest unwarded building (Town Centers included).
  return pickBuildingTarget(mob, wards);
}

// True while a guard / militia / player is targetable (unwarded) within the mob's aggro range: a mob on
// a building drops it then.
export function unitInAggroRange(mob: Mob, wards: TileCoord[]): boolean {
  const guardPx = MOB_AGGRO_RANGE_GUARD_TILES * TILE_SIZE;
  const playerPx = MOB_AGGRO_RANGE_PLAYER_TILES * TILE_SIZE;
  for (const c of colonists.values()) {
    if (isGuardOrMilitiaKind(c.kind) && Math.hypot(c.x - mob.x, c.y - mob.y) <= guardPx && !isWarded(c.x, c.y, wards)) return true;
  }
  for (const p of players.values()) {
    if (!p.dead && !state.testPlayersIgnored && Math.hypot(p.x - mob.x, p.y - mob.y) <= playerPx && !isWarded(p.x, p.y, wards)) return true;
  }
  return false;
}

// True when an unwarded non-wall building lies within MOB_BUILDING_AGGRO_TILES of (x, y) and nearer than
// `than` px (a mob heading for a Town Center turns on houses it passes). Scans the cached candidates.
export function buildingNearby(x: number, y: number, than: number, wards: TileCoord[]): boolean {
  const limit = Math.min(than, MOB_BUILDING_AGGRO_TILES * TILE_SIZE);
  for (const b of buildingTargetCandidates()) {
    const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = b.y * TILE_SIZE + TILE_SIZE / 2;
    if (Math.abs(cx - x) > limit || Math.abs(cy - y) > limit) continue;
    if (Math.hypot(cx - x, cy - y) < limit && !isWarded(cx, cy, wards)) return true;
  }
  return false;
}

// `mob` (optional) lets a building / Town Center target resolve to the approach tile its pick chose.
export function resolveTargetPosition(
  targetType: MobTargetType,
  targetId: string | null,
  mob?: Mob
): { x: number; y: number } | null {
  if (targetType === "colonist") {
    if (!targetId) return null;
    const c = colonists.get(targetId);
    return c ? { x: c.x, y: c.y } : null;
  }
  if (targetType === "player") {
    if (!targetId) return null;
    const p = players.get(targetId);
    return p && !p.dead ? { x: p.x, y: p.y } : null;
  }
  if (targetType === "building") {
    const tile = targetId ? keyToTile(targetId) : null;
    if (!tile || !isDamageableBuilding(state.tiles[tileIndex(tile.x, tile.y)] as TileType)) return null;
    return tileToPixelCenter(mobApproach(mob, targetId) ?? findAdjacentWalkable(tile.x, tile.y) ?? tile);
  }
  // Town Center targets are keyed by the Town Center's tile ("x,y").
  const tc = targetId ? state.townCenters.find((t) => resourceKey(t.x, t.y) === targetId) : undefined;
  if (!tc) return null;
  const approach = mobApproach(mob, targetId) ?? findAdjacentWalkable(tc.x, tc.y);
  return tileToPixelCenter(approach ?? tc);
}

export function keyToTile(key: string): TileCoord | null {
  const [x, y] = key.split(",").map(Number);
  return Number.isInteger(x) && Number.isInteger(y) && inBounds(x, y) ? { x, y } : null;
}

// The approach tile `mob`'s pick chose for `targetId`, while it is still walkable.
export function mobApproach(mob: Mob | undefined, targetId: string | null): TileCoord | null {
  if (!mob || targetId === null || mob.approachFor !== targetId) return null;
  const x = mob.approachX ?? -1;
  const y = mob.approachY ?? -1;
  return isWalkableTile(x, y) ? { x, y } : null;
}
export function buildingTargetCandidates(): TileCoord[] {
  // Also rebuilt every few seconds, in case some code path changed a tile without a tileUpdate.
  if (state.buildingTargetsDirty || state.cycleTick - state.buildingTargetsBuiltTick > TICK_RATE * 5 || state.cycleTick < state.buildingTargetsBuiltTick) {
    state.buildingTargetTiles = [];
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i] as TileType;
      // Forts phase A: mobs never go for an NPC site's buildings (no NPC-vs-NPC fighting in v1).
      if (isDamageableBuilding(t) && !isWallTile(t) && t !== TileType.Gate && ownerAt(i) === 0) state.buildingTargetTiles.push({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) });
    }
    state.buildingTargetsDirty = false;
    state.buildingTargetsBuiltTick = state.cycleTick;
  }
  return state.buildingTargetTiles;
}
// colony = true (forts phase A): the colony's side: gates by gatePassable(_, false), and only a hostile
// site's walls / gates are breachable; false: the mobs' side, only the colony's (owner 0) are.
export function routeToBuilding(start: TileCoord, gx: number, gy: number, wallCost: number, colony = false): TileCoord[] | null {
  const n = state.tiles.length;
  const s = tileIndex(start.x, start.y);
  const isGoal = (i: number) => Math.abs((i % state.WORLD_TILES_X) - gx) + Math.abs(Math.floor(i / state.WORLD_TILES_X) - gy) === 1;
  if (isGoal(s)) return [];
  state.routeCost.fill(Infinity);
  state.routeCost[s] = 0;
  const heap: number[] = [s];
  const push = (v: number) => {
    let i = heap.push(v) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p] <= heap[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  // Settled-node budget (see PATH_NODE_BUDGET); a 160 map has only 25.6k tiles, so it never bites there.
  let settled = 0;
  while (heap.length > 0) {
    if (++settled > ROUTE_NODE_BUDGET) return null;
    const v = pop();
    const idx = v % n;
    const cost = (v - idx) / n;
    if (cost > state.routeCost[idx]) continue;
    if (idx !== s && isGoal(idx)) {
      const path: TileCoord[] = [];
      for (let i = idx; i !== s; i = state.routeParent[i]) path.unshift({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) });
      return path;
    }
    const x = idx % state.WORLD_TILES_X;
    const y = Math.floor(idx / state.WORLD_TILES_X);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inBounds(nx, ny)) continue;
      const ni = tileIndex(nx, ny);
      const t = state.tiles[ni] as TileType;
      // Gates: an open (or overrun) gate is ground; a closed one is solid, or a breach obstacle like a wall.
      const own = tileOwner.size === 0 ? 0 : ownerAt(ni);
      const breachable = wallCost > 0 && (colony ? isHostileOwner(own) : own === 0);
      const step =
        t === TileType.Gate
          ? gatePassable(ni, !colony) ? 1 : breachable ? breachStepCost(nx, ny) : 0
          : !isSolidTile(t) ? 1 : breachable && isWallTile(t) ? breachStepCost(nx, ny) : 0;
      if (step === 0) continue;
      const next = cost + step;
      if (next >= state.routeCost[ni]) continue;
      state.routeCost[ni] = next;
      state.routeParent[ni] = idx;
      push(next * n + ni);
    }
  }
  return null;
}

// The nearest unwarded building or Town Center the mob can reach. A target that is walled off (no
// route, or a detour past BREACH_DETOUR_FACTOR) makes the target the first wall on the cheapest route
// through the walls instead, attacked from the tile before it.
export function pickBuildingTarget(mob: Mob, wards: TileCoord[]): PickedTarget | null {
  const candidates: { x: number; y: number; type: MobTargetType; d: number }[] = [];
  const consider = (x: number, y: number, type: MobTargetType) => {
    const c = tileToPixelCenter({ x, y });
    if (!isWarded(c.x, c.y, wards)) candidates.push({ x, y, type, d: Math.hypot(c.x - mob.x, c.y - mob.y) });
  };
  for (const tc of state.townCenters) consider(tc.x, tc.y, "townCenter");
  for (const b of buildingTargetCandidates()) consider(b.x, b.y, "building");
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(mob.x, mob.y);
  for (const cand of candidates.slice(0, BUILDING_TARGET_CANDIDATES)) {
    const id = resourceKey(cand.x, cand.y);
    const straight = Math.hypot(cand.x - start.x, cand.y - start.y);
    const route = routeToBuilding(start, cand.x, cand.y, 0);
    const approachOf = (r: TileCoord[]) => (r.length > 0 ? r[r.length - 1] : start);
    if (route && (route.length <= BREACH_MIN_ROUTE_TILES || route.length <= BREACH_DETOUR_FACTOR * straight)) {
      return { type: cand.type, id, approach: approachOf(route) };
    }
    const breach = routeToBuilding(start, cand.x, cand.y, BREACH_WALL_COST);
    const wallAt = breach ? breach.findIndex((t) => isBreachObstacle(t.x, t.y)) : -1;
    if (breach && wallAt >= 0) {
      const wall = breach[wallAt];
      return { type: "building", id: resourceKey(wall.x, wall.y), approach: wallAt > 0 ? breach[wallAt - 1] : start };
    }
    if (route) return { type: cand.type, id, approach: approachOf(route) };
  }
  return null;
}

// One straight step directly away from (fx, fy); stays put if that would enter a solid tile.
export function stepMobAwayFrom(mob: Mob, fx: number, fy: number, dt: number) {
  mob.path = [];
  const dx = mob.x - fx;
  const dy = mob.y - fy;
  const d = Math.hypot(dx, dy) || 1;
  stepRaidMobToward(mob, mob.x + (dx / d) * TILE_SIZE, mob.y + (dy / d) * TILE_SIZE, mob.speed, dt);
}

// Distance to `target` of the nearest front-rank (non-rear role) mob of the same regiment within
// ARCHER_FRONT_RANK_SCAN_TILES of `mob`; Infinity when it has no front rank left near it.
export function regimentFrontDistance(mob: Mob, regiment: string, target: { x: number; y: number }): number {
  const scanPx = ARCHER_FRONT_RANK_SCAN_TILES * TILE_SIZE;
  let best = Infinity;
  for (const o of mobs.values()) {
    if (o === mob || (o.regimentId ?? o.siteId) !== regiment || o.groupId !== null || isRearMob(o)) continue;
    if (Math.abs(o.x - mob.x) > scanPx || Math.abs(o.y - mob.y) > scanPx) continue;
    best = Math.min(best, Math.hypot(target.x - o.x, target.y - o.y));
  }
  return best;
}

export function startVhorrunWithdraw(mob: Mob, from: { x: number; y: number }) {
  mob.withdrawUntilTick = state.cycleTick + VHORRUN_WITHDRAW_TICKS;
  mob.withdrawFromX = from.x;
  mob.withdrawFromY = from.y;
  mob.targetType = null;
  mob.targetId = null;
  mob.path = [];
}

export function updateMob(mob: Mob, dt: number) {
  if (mob.isDeserter && !mob.deserterActive) return;
  if (isDormantGuardian(mob)) return;
  // Goblin wolf rider: its straight run (also while marching in its raid group) arms the charge.
  if (mob.kind === "goblinRider") trackCharge(mob);

  if (
    mob.kind === "troll" &&
    mob.hp < mob.maxHp &&
    state.cycleTick - mob.lastDamagedTick >= TROLL_REGEN_DELAY_TICKS
  ) {
    mob.hp = Math.min(mob.maxHp, mob.hp + TROLL_REGEN_PER_TICK);
  }

  // Runs ahead of target resolution (not after it) so the `if (!targetPos) return` below can't
  // skip it; it's independent of the shaman's own attack either way.
  if (mob.kind === "darkShaman") {
    if (mob.healCooldownTicks > 0) {
      mob.healCooldownTicks--;
    } else {
      let healTarget: Mob | null = null;
      let lowestRatio = Infinity;
      for (const other of mobs.values()) {
        if (other.id === mob.id) continue;
        if (other.isDeserter && !other.deserterActive) continue;
        if (isDormantGuardian(other)) continue;
        if (other.hp >= other.maxHp) continue;
        if (Math.hypot(other.x - mob.x, other.y - mob.y) > DARK_SHAMAN_HEAL_RANGE) continue;
        const ratio = other.hp / other.maxHp;
        if (ratio < lowestRatio) {
          lowestRatio = ratio;
          healTarget = other;
        }
      }
      if (healTarget) healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + DARK_SHAMAN_HEAL_AMOUNT);
      mob.healCooldownTicks = DARK_SHAMAN_HEAL_COOLDOWN_TICKS;
    }
  }

  // Raid-group members are moved by updateRaidGroups until their group breaks up.
  if (mob.groupId !== null) return;

  // Monster tactics: flanking / routing / leaving mobs are moved by mobTactic; a sheltering one holds
  // its post behind the walls and only fights what is in reach ("hold").
  const tactic = mobTactic(mob, dt);
  if (tactic === "handled") return;
  const hold = tactic === "hold";

  // Cavalry & siege: rams and catapults pick and hit their own targets (see updateSiegeMob).
  if (isSiegeKind(mob.kind)) {
    updateSiegeMob(mob, dt, hold);
    return;
  }

  // Forts phase B: a site guardian keeps to a short leash round its home (walk back, heal, fall asleep).
  const leash = siteLeash(mob);
  if (leash && leashStep(mob, leash, dt)) return;

  // Vhorrun withdrawing after winning an exchange: back away from where the fight was, then return.
  // A goblin wolf rider after its charge landed: rides off (hit and run), then comes back at its target.
  if ((mob.mark === HungerMark.Vhorrun || mob.kind === "goblinRider") && state.cycleTick < mob.withdrawUntilTick) {
    stepMobAwayFrom(mob, mob.withdrawFromX, mob.withdrawFromY, dt);
    return;
  }

  let targetPos = mob.targetType ? resolveTargetPosition(mob.targetType, mob.targetId, mob) : null;
  // A target that has since moved under (or been covered by) an active ward is dropped and re-picked.
  if (targetPos && isWarded(targetPos.x, targetPos.y, activeWardSources())) targetPos = null;
  // Once a second (Nemri keeps to its Town Center): a mob on a building / Town Center turns on any
  // guard or player that comes within aggro range; one heading for a Town Center turns on a nearer
  // building it passes; one chasing a unit gives up once it is well past aggro range.
  if (targetPos && mob.mark !== HungerMark.Nemri && state.cycleTick % TICK_RATE === 0) {
    const wards = activeWardSources();
    if (mob.targetType === "building" || mob.targetType === "townCenter") {
      if (unitInAggroRange(mob, wards)) targetPos = null;
      // Walls & gates: a gate it was storming opened / was overrun, or its route closed: re-pick.
      else if (mobTargetNeedsRepick(mob)) targetPos = null;
      else if (mob.targetType === "townCenter" && buildingNearby(mob.x, mob.y, Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y), wards)) targetPos = null;
    } else if (mob.mark === HungerMark.None) {
      const aggro = mob.targetType === "player" ? MOB_AGGRO_RANGE_PLAYER_TILES : MOB_AGGRO_RANGE_GUARD_TILES;
      if (Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y) > aggro * TILE_SIZE * MOB_AGGRO_DROP_FACTOR) targetPos = null;
      // Queued (no engagement slot on its soldier): look again for one with room.
      else if (mob.melee && mob.targetType === "colonist" && !attackerSlots.has(mob.id)) targetPos = null;
    }
  }
  // Gunne / Gorrath keep re-checking for a weaker / stronger victim.
  if ((mob.mark === HungerMark.Gunne || mob.mark === HungerMark.Gorrath) && state.cycleTick % MARK_RETARGET_TICKS === 0) targetPos = null;

  // Leash: a target beyond leash + SITE_CHASE_EXTRA_TILES of home is dropped; new picks (once a second)
  // only within the leash.
  if (leash && targetPos && Math.hypot(targetPos.x - leash.cx, targetPos.y - leash.cy) > leash.leashPx + SITE_CHASE_EXTRA_TILES * TILE_SIZE) targetPos = null;
  if (!targetPos && hold) return;
  if (!targetPos) {
    let picked = leash && state.cycleTick % TICK_RATE !== 0 ? null : pickMobTarget(mob);
    if (picked && leash) {
      const at = resolveTargetPosition(picked.type, picked.id, mob);
      if (!at || Math.hypot(at.x - leash.cx, at.y - leash.cy) > leash.leashPx) picked = null;
    }
    releaseSlot(mob.id);
    if (picked) {
      mob.targetType = picked.type;
      mob.targetId = picked.id;
      mob.approachFor = picked.approach ? picked.id : null;
      mob.approachX = picked.approach?.x ?? -1;
      mob.approachY = picked.approach?.y ?? -1;
      // A fresh building route starts now (the old path led to the previous target; a leashed guardian's
      // path led home).
      if (picked.approach || leash) {
        mob.path = [];
        mob.repathCooldown = 0;
      }
      targetPos = resolveTargetPosition(picked.type, picked.id, mob);
    } else {
      mob.targetType = null;
      mob.targetId = null;
    }
  }

  if (!targetPos) {
    if (leash && Math.hypot(leash.px - mob.x, leash.py - mob.y) > TILE_SIZE * 0.5) walkMobTo(mob, leash.px, leash.py, mob.speed * SITE_RETURN_SPEED_MULT, dt);
    return;
  }

  // Rux mid-feint: falls back from the target it just closed on.
  if (mob.mark === HungerMark.Rux && state.cycleTick < mob.feintUntilTick) {
    stepMobAwayFrom(mob, targetPos.x, targetPos.y, dt);
    return;
  }

  // Regiments: a ranged / caster mob whose regiment (raid group, or POI site) still has a front rank near
  // it stays behind that front: it never closes on a unit target past the front's own distance to it,
  // fires once in range, and kites a step back from a soldier's melee within RANGED_KITE_TILES.
  if (!mob.melee && (mob.targetType === "colonist" || mob.targetType === "player")) {
    const regiment = mob.regimentId ?? mob.siteId;
    const frontDist = regiment ? regimentFrontDistance(mob, regiment, targetPos) : Infinity;
    if (frontDist < Infinity) {
      const threat = nearestMeleeSoldier(mob.x, mob.y, RANGED_KITE_TILES * TILE_SIZE);
      const d = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
      if (threat) {
        stepMobAwayFrom(mob, threat.x, threat.y, dt);
        if (Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y) > mob.range) return;
      } else if (d > mob.range && d <= frontDist + TILE_SIZE * 0.5) {
        mob.path = [];
        return;
      }
    }
  }

  // Melee engagement slot: a unit target gives a ring point to fight from; a building / Town Center
  // gives a free tile of its walkable ring, which becomes the spot to stand on.
  let slot: { x: number; y: number } | null = null;
  const slotKey = mob.melee ? mobSlotKey(mob) : null;
  if (slotKey && mob.targetId !== null) {
    if (mob.targetType === "building" || mob.targetType === "townCenter") {
      const b = keyToTile(mob.targetId);
      const ringTile = b ? buildingSlotTile(mob, slotKey, b.x, b.y, mobApproach(mob, mob.targetId)) : null;
      if (ringTile) targetPos = tileToPixelCenter(ringTile);
    } else {
      const tr = mob.targetType === "colonist" ? COLONIST_BODY_RADIUS : PLAYER_BODY_RADIUS;
      const cap = mob.targetType === "colonist" ? meleeAttackerCap(tr) : Infinity;
      slot = unitSlotPoint(mob.id, mob.x, mob.y, mobBodyRadius(mob), mob.range, slotKey, targetPos.x, targetPos.y, tr, cap);
    }
  }

  const dist = Math.hypot(targetPos.x - mob.x, targetPos.y - mob.y);
  if (hold && dist > mob.range) return;
  // Queue: a melee mob with no slot on its unit target stands off behind the fighters instead of
  // shoving into the scrum (it re-picks a target with room once a second, see above).
  if (
    slotKey && !slot && dist > mob.range && dist <= mob.range + QUEUE_STANDOFF_PX &&
    (mob.targetType === "colonist" || mob.targetType === "player")
  ) {
    mob.path = [];
    return;
  }
  if (dist <= mob.range) {
    mob.path = [];
    mobsAttackingThisTick.add(mob.id);
    if (slot && Math.hypot(slot.x - mob.x, slot.y - mob.y) > 2) stepRaidMobToward(mob, slot.x, slot.y, mob.speed * 0.5, dt);
    if (mob.mark === HungerMark.Rux && mob.feintTargetId !== mob.targetId) {
      mob.feintTargetId = mob.targetId;
      mob.feintUntilTick = state.cycleTick + RUX_FEINT_TICKS;
      return;
    }
    if (mob.attackCooldownTicks > 0) {
      mob.attackCooldownTicks--;
    } else {
      mob.attackCooldownTicks = MOB_ATTACK_COOLDOWN_TICKS;
      // Building hits land on the building itself, not the tile the mob attacks it from.
      const struck = (mob.targetType === "building" || mob.targetType === "townCenter") && mob.targetId ? keyToTile(mob.targetId) : null;
      const hit = struck ? tileToPixelCenter(struck) : targetPos;
      state.pendingEffects.push({ fromX: mob.x, fromY: mob.y, toX: hit.x, toY: hit.y, melee: mob.melee });
      if (mob.targetId) recordMobStrike(mob, hit.x, hit.y);
      // Goblin wolf rider: a charge (a straight run of CAVALRY_CHARGE_TILES) doubles its first blow on a
      // unit, and it then withdraws for GOBLIN_RIDER_WITHDRAW_TICKS before riding in again.
      let blow = mob.damage;
      if (mob.kind === "goblinRider" && (mob.targetType === "colonist" || mob.targetType === "player")) {
        const mult = takeChargeBonus(mob);
        siegeEvent(mult > 1 ? "riderCharge" : "riderHit", mob.id, blow * mult);
        if (mult > 1) {
          blow *= mult;
          mob.withdrawUntilTick = state.cycleTick + GOBLIN_RIDER_WITHDRAW_TICKS;
          mob.withdrawFromX = targetPos.x;
          mob.withdrawFromY = targetPos.y;
          mob.path = [];
        }
      }
      if (mob.targetType === "colonist" && mob.targetId) {
        const c = colonists.get(mob.targetId);
        if (c) {
          if (mob.flanker && isRearColonist(c)) {
            tacticsEvent(regimentKey(mob) ?? "", "flankStrike", `${mob.kind}->${c.kind}`);
          }
          if (mob.kind === "giantSpider") {
            c.poisonTicksRemaining = POISON_DURATION_TICKS;
            c.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damageColonist(c, blow);
          if (mob.mark === HungerMark.Vhorrun && c.hp > 0 && c.hp < c.maxHp * VHORRUN_WITHDRAW_TARGET_HP) {
            startVhorrunWithdraw(mob, targetPos);
          }
        }
      } else if (mob.targetType === "player" && mob.targetId) {
        const p = players.get(mob.targetId);
        if (p) {
          if (mob.kind === "giantSpider") {
            p.poisonTicksRemaining = POISON_DURATION_TICKS;
            p.poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
          }
          damagePlayer(p, blow);
          if (mob.mark === HungerMark.Vhorrun && !p.dead && p.hp < playerMaxHp(p) * VHORRUN_WITHDRAW_TARGET_HP) {
            startVhorrunWithdraw(mob, targetPos);
          }
        }
      } else if (mob.targetType === "townCenter" && mob.targetId) {
        const tc = state.townCenters.find((t) => resourceKey(t.x, t.y) === mob.targetId);
        if (tc) damageTownCenter(tc, mob.damage);
      } else if (mob.targetType === "building" && struck) {
        damageBuilding(struck.x, struck.y, mob.damage);
      }
    }
  } else if (slot) {
    approachGoal(mob, dist > mob.range + SLOT_CLOSE_IN_PX ? slot : targetPos, targetPos, mob.speed, dt);
  } else {
    if (mob.path.length === 0 && mob.repathCooldown <= 0) {
      const start = tileOfPixel(mob.x, mob.y);
      const goalTile = tileOfPixel(targetPos.x, targetPos.y);
      const path = findPath(start, goalTile);
      mob.path = path ?? [];
      mob.repathCooldown = MOB_REPATH_TICKS;
      if (path) mobsWithoutRoute.delete(mob.id);
      else mobsWithoutRoute.add(mob.id);
    } else if (mob.repathCooldown > 0) {
      mob.repathCooldown--;
    }
    advanceAlongPath(mob, dt, mob.speed);
  }
}

// ---- Forts phase B stage 2: the site-guardian leash ----

function colonyUnitNear(x: number, y: number, r: number): boolean {
  for (const p of players.values()) if (!p.dead && !state.testPlayersIgnored && Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r && Math.hypot(p.x - x, p.y - y) <= r) return true;
  for (const c of colonists.values()) if (c.hp > 0 && Math.abs(c.x - x) <= r && Math.abs(c.y - y) <= r && Math.hypot(c.x - x, c.y - y) <= r) return true;
  return false;
}

// Path-follows to (x, y) (straight steps for the last tile).
export function walkMobTo(mob: Mob, x: number, y: number, speed: number, dt: number) {
  if (Math.hypot(x - mob.x, y - mob.y) <= TILE_SIZE * 1.5) {
    mob.path = [];
    stepRaidMobToward(mob, x, y, speed, dt);
    return;
  }
  if (mob.path.length === 0 && mob.repathCooldown <= 0) {
    mob.path = findPath(tileOfPixel(mob.x, mob.y), tileOfPixel(x, y)) ?? [];
    mob.repathCooldown = MOB_REPATH_TICKS;
  } else if (mob.repathCooldown > 0) {
    mob.repathCooldown--;
  }
  advanceAlongPath(mob, dt, speed);
}

// The leash part of updateMob for a site guardian; true = it handled the mob this tick. Once a second:
// heal SITE_HEAL_PER_SEC near home after SITE_HEAL_CALM_TICKS with no hostile within SITE_CALM_SCAN_TILES
// and no damage, and fall dormant again after SITE_RESET_CALM_TICKS of that. Past leash +
// SITE_CHASE_EXTRA_TILES + 1 (unless `free`): drop the target and walk home, ignoring targets for
// SITE_RETURN_IGNORE_TICKS.
function leashStep(mob: Mob, leash: SiteLeash, dt: number): boolean {
  const now = state.cycleTick;
  const atHome = Math.min(Math.hypot(mob.x - leash.px, mob.y - leash.py), Math.hypot(mob.x - leash.cx, mob.y - leash.cy)) <= SITE_HEAL_RADIUS_TILES * TILE_SIZE;
  if (now % TICK_RATE === 0) {
    if (mob.leashCalmSinceTick === undefined || colonyUnitNear(mob.x, mob.y, SITE_CALM_SCAN_TILES * TILE_SIZE)) mob.leashCalmSinceTick = now;
    const calm = now - Math.max(mob.leashCalmSinceTick, mob.lastDamagedTick);
    if (atHome && calm >= SITE_HEAL_CALM_TICKS && mob.hp < mob.maxHp) mob.hp = Math.min(mob.maxHp, mob.hp + mob.maxHp * SITE_HEAL_PER_SEC);
    if (atHome && calm >= SITE_RESET_CALM_TICKS && mob.leashReturnUntilTick === undefined && mob.targetType !== "building" && mob.targetType !== "townCenter") {
      clearMobTarget(mob);
      mob.guardianActive = false;
      mob.leashCalmSinceTick = undefined;
      return true;
    }
  }
  if (mob.leashReturnUntilTick !== undefined) {
    if (now < mob.leashReturnUntilTick && Math.hypot(leash.px - mob.x, leash.py - mob.y) > TILE_SIZE) {
      walkMobTo(mob, leash.px, leash.py, mob.speed * SITE_RETURN_SPEED_MULT, dt);
      return true;
    }
    mob.leashReturnUntilTick = undefined;
  }
  if (!leash.free && Math.hypot(mob.x - leash.cx, mob.y - leash.cy) > leash.leashPx + (SITE_CHASE_EXTRA_TILES + 1) * TILE_SIZE) {
    clearMobTarget(mob);
    mob.repathCooldown = 0;
    mob.leashReturnUntilTick = now + SITE_RETURN_IGNORE_TICKS;
    walkMobTo(mob, leash.px, leash.py, mob.speed * SITE_RETURN_SPEED_MULT, dt);
    return true;
  }
  return false;
}
