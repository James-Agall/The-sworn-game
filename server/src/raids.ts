// raids.ts: Raid waves: sizing, factions, spawning, formations, marching.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import { type MobKind, type SiegeKind, TILE_SIZE, TICK_RATE, SIEGE_KINDS, HungerMark } from "@colony/shared/protocol";
import type {
  Mob, RaidEdge, RaidFactionEntry, RaidFactionId, RaidFormationShape, RaidGroup, TileCoord,
} from "./types.js";
import {
  DAY_TICKS, DESERTER_ACTIVATION_TICKS, DESERTER_WAVE_CHANCE, DIFFICULTY_TUNING, HUNGER_MARK_RAIDERS_PER_MARK,
  MOB_KIND_CONFIG, MOB_MARK_DEFAULTS, MOB_REPATH_TICKS, MOB_SPEED, NIGHT_TICKS, RAID_ARRIVAL_WINDOW_FRACTION,
  RAID_BASE_SIZE, RAID_EDGE_BAND_TILES, RAID_ENGAGE_RANGE_TILES, RAID_FACTIONS, RAID_FOLLOWER_CATCHUP,
  RAID_FORMATION_SHAPE, RAID_FORMATION_SPACING_BODIES, RAID_GROUP_SIZE_MAX, RAID_GROUP_SIZE_MIN,
  RAID_HEADING_SMOOTHING, RAID_HORDE_SHARE_MAX, RAID_HORDE_SHARE_MIN, RAID_LOITER_CHANCE_PER_TICK,
  RAID_LOITER_RADIUS_TILES, RAID_MARCH_REPATH_TICKS, RAID_REACH_BUDGET, RAID_REACH_RADIUS, RAID_REAR_RANK_TILES,
  RAID_RELEASE_ROW_TICKS, RAID_SIZE_PER_DAY, RAID_SPAWN_DIST_STEPS, RAID_TRAVEL_MARGIN_TICKS, RAID_TRAVEL_SLACK,
  RAID_WEDGE_LOOSENESS,
} from "./constants.js";
import { colonists, mobs, players, raidGroups, state } from "./state.js";
import { biomeSpeedMultiplier, isNightNow, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findPath, isWalkableTile } from "./pathfinding.js";
import { randInt, randRange } from "./worldgen.js";
import { TOWN_CENTER_TILE, activeWardSources, isWarded, nearestTownCenter } from "./colonists.js";
import { isGuardOrMilitiaKind, isRearMob, isSiegeKind, mobRole } from "./units.js";
import { raidSiegeCap } from "./siege.js";
import {
  applyHungerMark, applyMobSize, buildingNearby, hungerMarkChance, hungerMarkLabel, mobBodyRadius, mobKindLabel,
  pickMobTarget, resolveTargetPosition,
} from "./mobs.js";
import { broadcastEvent } from "./index.js";

// ---- Raid waves ----
// spawnRaid runs once per day at the day's midpoint and puts the whole of tonight's raid on the map
// in passive groups. updateRaidGroups then drives every grouped mob (updateMob skips them):
//   passive  - loiter near their spawn; turn aggressive at the group's aggroTick (uniform between
//              spawn and nightfall), at nightfall at the latest, or as soon as any member is damaged.
//   marching - the group walks to the colony together: the slowest member leads along one shared
//              path at its own speed, the rest hold formation slots around it. Once the leader is
//              within RAID_ENGAGE_RANGE_TILES of the colony or a target, the group dissolves and each
//              member falls back to updateMob's normal per-mob targeting (as does a damaged group).

export function raidSizeForDay(dayIndex: number): number {
  const base = RAID_BASE_SIZE + RAID_SIZE_PER_DAY * dayIndex;
  return Math.max(1, Math.round(base * DIFFICULTY_TUNING[state.difficulty].spawnCount));
}
export function raidBox() {
  const c = state.townCenters[0] ?? TOWN_CENTER_TILE;
  return {
    x0: Math.max(0, c.x - state.raidSpawnDist),
    x1: Math.min(state.WORLD_TILES_X - 1, c.x + state.raidSpawnDist),
    y0: Math.max(0, c.y - state.raidSpawnDist),
    y1: Math.min(state.WORLD_TILES_Y - 1, c.y + state.raidSpawnDist),
  };
}
export function raidAnchorWithinPathBudget(anchor: TileCoord): boolean {
  const goals = state.townCenters.length > 0 ? state.townCenters : [TOWN_CENTER_TILE];
  const near = (t: TileCoord) => goals.some((c) => Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) <= RAID_REACH_RADIUS);
  const seen = new Set<number>([tileIndex(anchor.x, anchor.y)]);
  const queue: TileCoord[] = [anchor];
  for (let head = 0; head < queue.length; head++) {
    if (head > RAID_REACH_BUDGET) return false;
    const t = queue[head];
    if (near(t)) return true;
    for (const n of [{ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }]) {
      if (!isWalkableTile(n.x, n.y)) continue;
      const k = tileIndex(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}

export function isRaidEdgeTile(tx: number, ty: number): boolean {
  const b = raidBox();
  if (tx < b.x0 || tx > b.x1 || ty < b.y0 || ty > b.y1) return false;
  return Math.min(tx - b.x0, b.x1 - tx, ty - b.y0, b.y1 - ty) < RAID_EDGE_BAND_TILES;
}

export function randomRaidAnchor(): { tile: TileCoord; edge: RaidEdge } | null {
  // Try the full spawn distance first, then closer boxes, until an anchor can path to the colony in budget.
  for (const dist of RAID_SPAWN_DIST_STEPS) {
    state.raidSpawnDist = dist;
    const found = randomRaidAnchorInBox(true);
    if (found) return found;
  }
  state.raidSpawnDist = RAID_SPAWN_DIST_STEPS[RAID_SPAWN_DIST_STEPS.length - 1];
  return randomRaidAnchorInBox(false);
}

export function randomRaidAnchorInBox(requireBudget: boolean): { tile: TileCoord; edge: RaidEdge } | null {
  for (let attempt = 0; attempt < (requireBudget ? 16 : 40); attempt++) {
    const side = Math.floor(Math.random() * 4);
    const b = raidBox();
    const along = side < 2 ? randInt(b.x0, b.x1) : randInt(b.y0, b.y1);
    const tile =
      side === 0 ? { x: along, y: b.y0 }
      : side === 1 ? { x: along, y: b.y1 }
      : side === 2 ? { x: b.x0, y: along }
      : { x: b.x1, y: along };
    if (isWalkableTile(tile.x, tile.y) && (!requireBudget || raidAnchorWithinPathBudget(tile))) {
      const edge: RaidEdge = side === 0 ? "north" : side === 1 ? "south" : side === 2 ? "west" : "east";
      return { tile, edge };
    }
  }
  return null;
}

// `count` walkable edge-band tiles nearest the anchor (breadth-first), skipping tiles in `occupied`
// (and claiming the ones returned). Stacks on the tiles found only if there aren't enough free ones.
export function clusterRaidTiles(anchor: TileCoord, count: number, occupied: Set<number>): TileCoord[] {
  const result: TileCoord[] = [];
  const seen = new Set<number>([tileIndex(anchor.x, anchor.y)]);
  const queue: TileCoord[] = [anchor];
  const searchLimit = count * 8 + 64;
  for (let head = 0; head < queue.length && result.length < count && head < searchLimit; head++) {
    const t = queue[head];
    const idx = tileIndex(t.x, t.y);
    if (!occupied.has(idx)) {
      occupied.add(idx);
      result.push(t);
    }
    const neighbors = [
      { x: t.x + 1, y: t.y },
      { x: t.x - 1, y: t.y },
      { x: t.x, y: t.y + 1 },
      { x: t.x, y: t.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isWalkableTile(n.x, n.y) || !isRaidEdgeTile(n.x, n.y)) continue;
      const k = tileIndex(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  const pool = result.length > 0 ? result.slice() : [anchor];
  for (let i = 0; result.length < count; i++) result.push(pool[i % pool.length]);
  return result;
}

export function isRaidKindUnlocked(kind: MobKind, dayIndex: number): boolean {
  return MOB_KIND_CONFIG[kind].unlockDay <= dayIndex;
}

export function pickRaidFaction(dayIndex: number): RaidFactionId {
  const weighted = (Object.keys(RAID_FACTIONS) as RaidFactionId[])
    .filter((f) => !state.testForceRaidSiege || f === "banditBand" || f === "greenskinWarband")
    .map((f) => ({ f, w: RAID_FACTIONS[f].filter((e) => e.core && isRaidKindUnlocked(e.kind, dayIndex)).length }))
    .filter((x) => x.w > 0);
  let roll = Math.random() * weighted.reduce((sum, x) => sum + x.w, 0);
  for (const x of weighted) {
    roll -= x.w;
    if (roll < 0) return x.f;
  }
  return weighted[weighted.length - 1].f;
}

// `siegeLeft` (per raid): how many more of each siege kind the raid may still take (raidSiegeCap).
export function pickRaidFactionKind(faction: RaidFactionId, dayIndex: number, siegeLeft?: Partial<Record<SiegeKind, number>>): MobKind {
  const eligible = RAID_FACTIONS[faction].filter(
    (e) => isRaidKindUnlocked(e.kind, dayIndex) && (!isSiegeKind(e.kind) || (siegeLeft?.[e.kind] ?? 0) > 0)
  );
  const pick = pickWeightedRaidKind(eligible);
  if (siegeLeft && isSiegeKind(pick)) siegeLeft[pick]!--;
  return pick;
}

export function pickWeightedRaidKind(all: RaidFactionEntry[]): MobKind {
  const forced = state.testForceRaidSiege ? all.find((e) => isSiegeKind(e.kind)) : undefined;
  if (forced) return forced.kind;
  const eligible = all;
  let roll = Math.random() * eligible.reduce((sum, e) => sum + e.weight, 0);
  for (const e of eligible) {
    roll -= e.weight;
    if (roll < 0) return e.kind;
  }
  return eligible[eligible.length - 1].kind;
}

// Group sizes for a raid of `total`: the horde first, then random groups of
// RAID_GROUP_SIZE_MIN..MAX (a lone leftover mob joins the horde instead of standing alone).
export function splitRaidGroups(total: number, hordeSize: number): number[] {
  const sizes = [hordeSize];
  let rest = total - hordeSize;
  while (rest > 0) {
    if (rest < RAID_GROUP_SIZE_MIN) {
      sizes[0] += rest;
      break;
    }
    let size = Math.min(rest, randInt(RAID_GROUP_SIZE_MIN, RAID_GROUP_SIZE_MAX));
    if (rest - size > 0 && rest - size < RAID_GROUP_SIZE_MIN) {
      size = size < RAID_GROUP_SIZE_MAX ? size + 1 : size - 1;
    }
    sizes.push(size);
    rest -= size;
  }
  return sizes;
}

export function createRaidMob(kind: MobKind, tile: TileCoord, groupId: string, rollSize = true): Mob {
  const center = tileToPixelCenter(tile);
  const config = MOB_KIND_CONFIG[kind];
  const tuning = DIFFICULTY_TUNING[state.difficulty];
  const maxHp = Math.max(1, Math.round(config.maxHp * tuning.mobHp));
  const mob: Mob = {
    id: randomUUID(),
    kind,
    x: center.x,
    y: center.y,
    hp: maxHp,
    maxHp,
    path: [],
    repathCooldown: 0,
    targetType: null,
    targetId: null,
    attackCooldownTicks: 0,
    damage: Math.max(1, Math.round(config.damage * tuning.mobDamage)),
    speed: config.speed,
    range: config.range,
    melee: config.melee,
    lastDamagedTick: 0,
    healCooldownTicks: 0,
    isDeserter: false,
    deserterActive: false,
    deserterSinceTick: 0,
    siteId: null,
    siteKind: null,
    guardianActive: false,
    groupId,
    passive: true,
    ...MOB_MARK_DEFAULTS,
  };
  applyMobSize(mob, rollSize);
  mobs.set(mob.id, mob);
  return mob;
}

// On a deserter night (DESERTER_WAVE_CHANCE, once deserters have waited DESERTER_ACTIVATION_DAYS)
// every eligible deserter joins the horde where it stands, and fresh Bandit-band mobs fill the raid up
// to its normal size (none if the deserters alone already reach it).
// Departure tick for a group at `from`: a random arrival tick in [nightfall, nightfall + window] minus
// the estimated trip to the engage range of the first Town Center, but never before now.
export function raidDepartureTick(from: TileCoord, group: RaidGroup, nightfallTick: number): number {
  const tc = state.townCenters[0] ?? TOWN_CENTER_TILE;
  const route = findPath(from, tc);
  const routeTiles = route ? route.length : Math.hypot(tc.x - from.x, tc.y - from.y) * 1.5;
  const speeds = group.memberIds.map((id) => mobs.get(id)?.speed ?? MOB_SPEED);
  const slowest = Math.max(1, Math.min(...speeds));
  const px = Math.max(0, routeTiles - RAID_ENGAGE_RANGE_TILES) * TILE_SIZE;
  const travel = Math.ceil(((px * RAID_TRAVEL_SLACK) / slowest) * TICK_RATE) + RAID_TRAVEL_MARGIN_TICKS;
  const arrival = nightfallTick + Math.floor(Math.random() * NIGHT_TICKS * RAID_ARRIVAL_WINDOW_FRACTION);
  return Math.max(state.cycleTick, arrival - travel);
}

export function spawnRaid(dayIndex: number) {
  const nightfallTick = dayIndex * (DAY_TICKS + NIGHT_TICKS) + DAY_TICKS;
  const total = raidSizeForDay(dayIndex);
  const eligibleDeserters = Array.from(mobs.values()).filter(
    (m) =>
      m.isDeserter &&
      !m.deserterActive &&
      m.groupId === null &&
      state.cycleTick - m.deserterSinceTick >= DESERTER_ACTIVATION_TICKS
  );
  const deserterRoll = state.testForceDeserterRoll ?? Math.random() < DESERTER_WAVE_CHANCE;
  const deserters = eligibleDeserters.length > 0 && deserterRoll ? eligibleDeserters : [];
  const combined = Math.max(total, deserters.length);
  const hordeShare = randRange(RAID_HORDE_SHARE_MIN, RAID_HORDE_SHARE_MAX);
  const hordeSize = Math.max(deserters.length, Math.min(combined, Math.ceil(combined * hordeShare)));
  const sizes = splitRaidGroups(combined, hordeSize);

  const occupied = new Set<number>();
  for (const m of mobs.values()) {
    const t = tileOfPixel(m.x, m.y);
    occupied.add(tileIndex(t.x, t.y));
  }

  const siegeLeft: Partial<Record<SiegeKind, number>> = {};
  for (const k of SIEGE_KINDS) siegeLeft[k] = isRaidKindUnlocked(k, dayIndex) ? raidSiegeCap(dayIndex, k) : 0;
  const markChance = hungerMarkChance(dayIndex);
  let marksLeft = markChance > 0 ? Math.max(1, Math.floor(combined / HUNGER_MARK_RAIDERS_PER_MARK)) : 0;
  const marked: Mob[] = [];
  let announceEdge: RaidEdge | null = null;
  sizes.forEach((size, i) => {
    const isHorde = i === 0;
    const group: RaidGroup = {
      id: randomUUID(),
      faction: deserters.length > 0 ? "banditBand" : pickRaidFaction(dayIndex),
      isHorde,
      edge: null,
      memberIds: [],
      homes: new Map(),
      aggroTick: state.testHoldRaidAggro
        ? nightfallTick
        : state.cycleTick + Math.floor(Math.random() * Math.max(1, nightfallTick - state.cycleTick)),
      state: "passive",
      leaderId: null,
      offsets: new Map(),
      repathCooldown: 0,
    };
    let freshCount = size;
    if (isHorde) {
      for (const d of deserters) {
        d.groupId = group.id;
        d.passive = true;
        d.path = [];
        group.memberIds.push(d.id);
      }
      freshCount -= deserters.length;
    }
    const anchor = freshCount > 0 ? randomRaidAnchor() : null;
    if (anchor) {
      group.edge = anchor.edge;
      for (const tile of clusterRaidTiles(anchor.tile, freshCount, occupied)) {
        const mob = createRaidMob(pickRaidFactionKind(group.faction, dayIndex, siegeLeft), tile, group.id);
        if (marksLeft > 0 && Math.random() < markChance) {
          applyHungerMark(mob, randInt(HungerMark.Gorrath, HungerMark.Vhorrun) as HungerMark);
          marksLeft--;
          marked.push(mob);
        }
        group.memberIds.push(mob.id);
        group.homes.set(mob.id, tile);
      }
      if (announceEdge === null) announceEdge = anchor.edge;
    }
    if (group.memberIds.length > 0) {
      if (anchor && !state.testHoldRaidAggro) group.aggroTick = raidDepartureTick(anchor.tile, group, nightfallTick);
      raidGroups.set(group.id, group);
    }
  });
  if (announceEdge) broadcastEvent("raid", `Raiders gather at the ${announceEdge} edge`);
  // One toast: the first marked elite by name, the rest as a count.
  if (marked.length > 0) {
    const first = marked[0];
    const more = marked.length > 1 ? `, with ${marked.length - 1} more Hunger-marked` : "";
    broadcastEvent("raid", `A ${hungerMarkLabel(first.mark)}-marked ${mobKindLabel(first.kind)} leads the raid${more}`);
  }
}

// Returns true when `m` was a still-dormant deserter (so the caller can announce the turn).
export function releaseRaidMob(m: Mob): boolean {
  const turnedDeserter = m.isDeserter && !m.deserterActive;
  if (m.groupId) m.regimentId = m.groupId;
  m.groupId = null;
  m.passive = false;
  m.path = [];
  m.targetType = null;
  m.targetId = null;
  // Staggered so a whole horde breaking up doesn't pathfind on the same tick.
  m.repathCooldown = Math.floor(Math.random() * MOB_REPATH_TICKS);
  if (m.isDeserter) m.deserterActive = true;
  return turnedDeserter;
}

export function announceDeserterTurn(count: number) {
  if (count > 0) broadcastEvent("deserter", `The deserters have turned on the colony (${count})`);
}

export function raidGroupMembers(group: RaidGroup): Mob[] {
  const members: Mob[] = [];
  for (const id of group.memberIds) {
    const m = mobs.get(id);
    if (m && m.groupId === group.id) members.push(m);
  }
  if (members.length !== group.memberIds.length) group.memberIds = members.map((m) => m.id);
  return members;
}

// Contact: the group breaks up row by row (front row now, each further row RAID_RELEASE_ROW_TICKS
// later; see releaseRaidRows) instead of all at once. A group that never marched has no rows and is
// released whole.
export function engageRaidGroup(group: RaidGroup) {
  if (group.engagedTick !== undefined) return;
  const leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  const members = raidGroupMembers(group);
  const anchor = leader && leader.groupId === group.id ? leader : members[0];
  group.engagedTick = state.cycleTick;
  group.anchorX = anchor?.x ?? 0;
  group.anchorY = anchor?.y ?? 0;
  releaseRaidRows(group, 0);
}

export function raidMemberRow(group: RaidGroup, m: Mob): number {
  return group.state === "marching" ? (group.offsets.get(m.id)?.row ?? 0) : 0;
}

// Releases every member whose row is due; the rest hold their slot around the contact point. The
// group is deleted once everyone is out.
export function releaseRaidRows(group: RaidGroup, dt: number) {
  const due = Math.floor((state.cycleTick - (group.engagedTick ?? state.cycleTick)) / RAID_RELEASE_ROW_TICKS);
  let turned = 0;
  for (const m of raidGroupMembers(group)) {
    if (raidMemberRow(group, m) <= due) {
      if (releaseRaidMob(m)) turned++;
      continue;
    }
    const offset = group.offsets.get(m.id);
    if (offset && dt > 0) {
      const p = formationPoint(group, group.anchorX ?? m.x, group.anchorY ?? m.y, offset);
      stepRaidMobToward(m, p.x, p.y, m.speed, dt);
    }
  }
  announceDeserterTurn(turned);
  if (raidGroupMembers(group).length === 0) raidGroups.delete(group.id);
}

export function isHeavyMobKind(kind: MobKind): boolean {
  return kind === "troll" || kind === "ogre";
}

// Heading-relative slots for `count` members, front row first, each row's slots centre-out:
// x = lateral (right of the heading), y = distance behind the front row.
//   wedge  (wolves)               - row r holds r + 1 slots, loosely spaced (naturally staggered).
//   line   (bandits)              - wide rows, every other row shifted half a spacing.
//   column (greenskins, dark host) - narrow rows (2-4 wide), every other row shifted half a spacing.
export function raidFormationSlots(shape: RaidFormationShape, count: number, spacing: number): { x: number; y: number; row: number }[] {
  const slots: { x: number; y: number; row: number }[] = [];
  const width =
    shape === "line" ? Math.max(2, Math.ceil(Math.sqrt(count * 2.5)))
    : shape === "column" ? Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count / 2))))
    : 0;
  const gap = shape === "wedge" ? spacing * RAID_WEDGE_LOOSENESS : spacing;
  for (let row = 0; slots.length < count; row++) {
    const w = shape === "wedge" ? row + 1 : width;
    const shift = shape !== "wedge" && row % 2 === 1 ? gap / 2 : 0;
    const rowSlots: { x: number; y: number; row: number }[] = [];
    for (let i = 0; i < w; i++) rowSlots.push({ x: (i - (w - 1) / 2) * gap + shift, y: row * gap * 0.9, row });
    rowSlots.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    for (const slot of rowSlots) if (slots.length < count) slots.push(slot);
  }
  return slots;
}

// World position of a heading-relative formation offset from (ox, oy).
export function formationPoint(group: RaidGroup, ox: number, oy: number, offset: { x: number; y: number }): { x: number; y: number } {
  const fx = group.headingX ?? 1;
  const fy = group.headingY ?? 0;
  // Right of the heading in screen space (y down): (-fy, fx).
  return { x: ox - fy * offset.x - fx * offset.y, y: oy + fx * offset.x - fy * offset.y };
}
export function assignRaidLeader(group: RaidGroup): Mob | null {
  const members = raidGroupMembers(group);
  if (members.length === 0) return null;
  const front = members.filter((m) => !isRearMob(m));
  const rear = front.length > 0 ? members.filter((m) => isRearMob(m)) : [];
  const line = front.length > 0 ? front : members;
  const leader = line.reduce((slowest, m) => (m.speed < slowest.speed ? m : slowest));
  group.leaderId = leader.id;
  group.repathCooldown = 0;
  group.offsets.clear();
  const meanR = members.reduce((sum, m) => sum + mobBodyRadius(m), 0) / members.length;
  const spacing = RAID_FORMATION_SPACING_BODIES * 2 * Math.min(12, Math.max(7, meanR));
  const slots = raidFormationSlots(RAID_FORMATION_SHAPE[group.faction] ?? "column", line.length, spacing);
  const origin = slots[0];
  const free = slots.slice(1);
  const take = (m: Mob, slot: { x: number; y: number; row: number }) =>
    group.offsets.set(m.id, { x: slot.x - origin.x, y: slot.y - origin.y, row: slot.row });
  // Shock, heavies and the ram take the front-centre slots.
  const rank = (m: Mob) => (mobRole(m) === "shock" || mobRole(m) === "siege" || isHeavyMobKind(m.kind) ? 0 : m.melee ? 1 : 2);
  const followers = line.filter((m) => m !== leader);
  // Fast roles take the wing slots (widest first, front rows first); the rest fill in formation order.
  const wings = free.slice().sort((a, b) => Math.abs(b.x - origin.x) - Math.abs(a.x - origin.x) || a.row - b.row);
  const used = new Set<{ x: number; y: number; row: number }>();
  for (const m of followers.filter((f) => mobRole(f) === "fast")) {
    const slot = wings.find((w) => !used.has(w));
    if (!slot) break;
    used.add(slot);
    take(m, slot);
  }
  const rest = free.filter((sl) => !used.has(sl));
  followers
    .filter((f) => !group.offsets.has(f.id))
    .sort((a, b) => rank(a) - rank(b))
    .forEach((m, i) => take(m, rest[i]));
  if (rear.length > 0) {
    const frontWidth = slots.filter((sl) => sl.row === 0).length;
    const lastRow = slots.reduce((r, sl) => Math.max(r, sl.row), 0);
    const backY = slots.reduce((y, sl) => Math.max(y, sl.y), 0);
    const y0 = Math.max(backY + spacing, RAID_REAR_RANK_TILES * TILE_SIZE);
    const width = Math.min(rear.length, Math.max(2, frontWidth));
    rear.forEach((m, i) => {
      const r = Math.floor(i / width);
      const inRow = Math.min(width, rear.length - r * width);
      const k = i % width;
      // Centre-out within the row: 0, +1, -1, +2, ...
      const col = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
      const centre = inRow % 2 === 0 ? spacing / 2 : 0;
      group.offsets.set(m.id, { x: col * spacing - centre - origin.x, y: y0 + r * spacing - origin.y, row: lastRow + 1 + r });
    });
  }
  return leader;
}

export function startRaidGroupMarch(group: RaidGroup) {
  group.state = "marching";
  // Deserters are already inside the colony: they turn on it from where they stand.
  let turned = 0;
  for (const m of raidGroupMembers(group)) {
    if (m.isDeserter) {
      if (releaseRaidMob(m)) turned++;
    } else {
      m.passive = false;
      m.path = [];
    }
  }
  announceDeserterTurn(turned);
  if (raidGroupMembers(group).length === 0) {
    raidGroups.delete(group.id);
    return;
  }
  if (group.isHorde) broadcastEvent("raid", "The horde marches on the colony");
  assignRaidLeader(group);
}

export function loiterRaidMob(group: RaidGroup, m: Mob, members: Mob[], dt: number) {
  if (m.isDeserter) return;
  if (m.path.length > 0) {
    advanceAlongPath(m, dt, m.speed * 0.5);
    return;
  }
  if (Math.random() >= RAID_LOITER_CHANCE_PER_TICK) return;
  const home = group.homes.get(m.id);
  if (!home) return;
  const here = tileOfPixel(m.x, m.y);
  const dir = Math.floor(Math.random() * 4);
  const n = {
    x: here.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0),
    y: here.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0),
  };
  if (!isWalkableTile(n.x, n.y)) return;
  if (Math.max(Math.abs(n.x - home.x), Math.abs(n.y - home.y)) > RAID_LOITER_RADIUS_TILES) return;
  // Keep to one mob per tile: skip a tile a groupmate stands on or is stepping to.
  for (const other of members) {
    if (other === m) continue;
    const t = other.path.length > 0 ? other.path[0] : tileOfPixel(other.x, other.y);
    if (t.x === n.x && t.y === n.y) return;
  }
  m.path = [n];
}

// Where a marching group heads: the Town Center while it stands unwarded, otherwise whatever the
// leader would target on its own. null (nothing targetable, e.g. all warded) means hold position.
export function raidMarchGoal(leader: Mob): { x: number; y: number } | null {
  const nearest = nearestTownCenter(leader.x, leader.y);
  const tc = nearest ? resolveTargetPosition("townCenter", resourceKey(nearest.x, nearest.y)) : null;
  if (tc && !isWarded(tc.x, tc.y, activeWardSources())) return tc;
  const picked = pickMobTarget(leader);
  return picked ? resolveTargetPosition(picked.type, picked.id) : null;
}

export function raidGroupShouldEngage(leader: Mob, goal: { x: number; y: number }): boolean {
  const range = RAID_ENGAGE_RANGE_TILES * TILE_SIZE;
  if (Math.hypot(goal.x - leader.x, goal.y - leader.y) <= range) return true;
  const wards = activeWardSources();
  // Houses and other buildings met on the way are attacked first (see MOB_BUILDING_AGGRO_TILES).
  if (buildingNearby(leader.x, leader.y, Infinity, wards)) return true;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    if (Math.hypot(c.x - leader.x, c.y - leader.y) <= range && !isWarded(c.x, c.y, wards)) return true;
  }
  for (const p of players.values()) {
    if (p.dead) continue;
    if (Math.hypot(p.x - leader.x, p.y - leader.y) <= range && !isWarded(p.x, p.y, wards)) return true;
  }
  return false;
}

// Straight-line step toward (tx, ty); false (and no move) if the step would enter a solid tile.
export function stepRaidMobToward(m: { x: number; y: number }, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const step = Math.min(d, speed * biomeSpeedMultiplier(m.x, m.y) * dt);
  const nx = m.x + (dx / d) * step;
  const ny = m.y + (dy / d) * step;
  if (!isWalkableTile(Math.floor(nx / TILE_SIZE), Math.floor(ny / TILE_SIZE))) return false;
  m.x = nx;
  m.y = ny;
  return true;
}

// Followers don't pathfind while they can walk straight to their slot (or the leader); only a
// follower blocked both ways gets a short path to the leader, rate-limited by MOB_REPATH_TICKS.
export function moveRaidFollower(group: RaidGroup, m: Mob, leader: Mob, offset: { x: number; y: number }, pace: number, dt: number) {
  const speed = Math.min(m.speed, pace * RAID_FOLLOWER_CATCHUP);
  if (m.path.length > 0) {
    advanceAlongPath(m, dt, speed);
    return;
  }
  if (m.repathCooldown > 0) m.repathCooldown--;
  const slot = formationPoint(group, leader.x, leader.y, offset);
  if (stepRaidMobToward(m, slot.x, slot.y, speed, dt)) return;
  if (stepRaidMobToward(m, leader.x, leader.y, speed, dt)) return;
  if (m.repathCooldown <= 0) {
    m.path = findPath(tileOfPixel(m.x, m.y), tileOfPixel(leader.x, leader.y)) ?? [];
    m.repathCooldown = MOB_REPATH_TICKS;
  }
}

// Arrived before nightfall: stand in formation just outside contact range, passive (no attacking, not
// shot by towers or soldiers) until night falls; marchRaidGroup then engages. An attack engages at once.
export function holdRaidGroup(group: RaidGroup, leader: Mob, dt: number) {
  leader.path = [];
  for (const m of raidGroupMembers(group)) {
    m.passive = true;
    if (m === leader) continue;
    const offset = group.offsets.get(m.id);
    if (offset) {
      const p = formationPoint(group, leader.x, leader.y, offset);
      stepRaidMobToward(m, p.x, p.y, Math.min(m.speed, leader.speed * RAID_FOLLOWER_CATCHUP), dt);
    }
  }
}

export function marchRaidGroup(group: RaidGroup, dt: number) {
  let leader = group.leaderId ? mobs.get(group.leaderId) : undefined;
  if (!leader || leader.groupId !== group.id) leader = assignRaidLeader(group) ?? undefined;
  if (!leader) return;
  const goal = raidMarchGoal(leader);
  if (!goal) return;
  if (raidGroupShouldEngage(leader, goal)) {
    if (isNightNow()) engageRaidGroup(group);
    else holdRaidGroup(group, leader, dt);
    return;
  }
  if (leader.passive) for (const m of raidGroupMembers(group)) m.passive = false;
  if (leader.passive) for (const m of raidGroupMembers(group)) m.passive = false;
  if (group.repathCooldown > 0) group.repathCooldown--;
  // One shared path per group, refreshed every RAID_MARCH_REPATH_TICKS rather than every member
  // searching the map every second.
  if (leader.path.length === 0 && group.repathCooldown <= 0) {
    const route = findPath(tileOfPixel(leader.x, leader.y), tileOfPixel(goal.x, goal.y));
    // No route at all (a walled-in colony): the group breaks up and each mob picks its own target,
    // which breaches a wall when it has to (see pickBuildingTarget).
    if (!route) {
      if (isNightNow()) engageRaidGroup(group);
      else holdRaidGroup(group, leader, dt);
      return;
    }
    leader.path = route;
    group.repathCooldown = RAID_MARCH_REPATH_TICKS;
  }
  // Regiments: the whole group advances at its slowest member's pace (the leader is the slowest of the
  // front rank; a slower rear rank holds everyone back to it).
  const pace = raidGroupMembers(group).reduce((p, m) => Math.min(p, m.speed), leader.speed);
  const lx = leader.x;
  const ly = leader.y;
  if (group.headingX === undefined) {
    const d = Math.hypot(goal.x - lx, goal.y - ly) || 1;
    group.headingX = (goal.x - lx) / d;
    group.headingY = (goal.y - ly) / d;
  }
  advanceAlongPath(leader, dt, pace);
  const mx = leader.x - lx;
  const my = leader.y - ly;
  const moved = Math.hypot(mx, my);
  if (moved > 0.1) {
    const hx = (group.headingX ?? 1) * (1 - RAID_HEADING_SMOOTHING) + (mx / moved) * RAID_HEADING_SMOOTHING;
    const hy = (group.headingY ?? 0) * (1 - RAID_HEADING_SMOOTHING) + (my / moved) * RAID_HEADING_SMOOTHING;
    const h = Math.hypot(hx, hy) || 1;
    group.headingX = hx / h;
    group.headingY = hy / h;
  }
  for (const m of raidGroupMembers(group)) {
    if (m === leader) continue;
    const offset = group.offsets.get(m.id);
    if (offset) moveRaidFollower(group, m, leader, offset, pace, dt);
    else stepRaidMobToward(m, leader.x, leader.y, Math.min(m.speed, pace * RAID_FOLLOWER_CATCHUP), dt);
  }
}

export function updateRaidGroups(dt: number) {
  const night = isNightNow();
  for (const group of raidGroups.values()) {
    const members = raidGroupMembers(group);
    if (members.length === 0) {
      raidGroups.delete(group.id);
      continue;
    }
    if (group.engagedTick !== undefined) {
      releaseRaidRows(group, dt);
      continue;
    }
    if (group.state === "passive") {
      if (state.cycleTick < group.aggroTick && !night) {
        for (const m of members) loiterRaidMob(group, m, members, dt);
        continue;
      }
      startRaidGroupMarch(group);
      if (!raidGroups.has(group.id)) continue;
    }
    marchRaidGroup(group, dt);
  }
}
