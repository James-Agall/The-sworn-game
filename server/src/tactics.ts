// tactics.ts: Monster tactics (regiments, flanking, cover, morale, routs) and player regiment morale.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { HungerMark, TILE_SIZE, TileType } from "@colony/shared/protocol";
import type {
  Colonist, EnemyUnit, Mob, MobTargetType, OrderGroup, PlayerMoraleState, RegimentState, TileCoord,
} from "./types.js";
import {
  BUILDING_HP_BIG, COVER_BREACH_HP_FRACTION, COVER_ENCLOSURE_TILES, COVER_REENGAGE_RATIO, FLANK_ARC_TILES,
  FLANK_BEHIND_TILES, FLANK_CONTACT_TILES, FLANK_DETACH_FRACTION, FLANK_ENGAGE_TILES, FLANK_MAX_TICKS,
  FLANK_MIN_FRONT_FOR_DETACH, FLANK_WAYPOINT_REACH_PX, MOB_ATTACK_COOLDOWN_TICKS, MOB_REPATH_TICKS,
  MORALE_ANCHOR_RESIST, MORALE_CASUALTY, MORALE_FRONT_LOST_PER_SEC, MORALE_LEADER_WEIGHT, MORALE_MAX,
  MORALE_OUTFLANKED_PER_SEC, MORALE_OUTNUMBERED_PER_SEC, MORALE_RALLY, MORALE_RALLY_QUIET_TICKS,
  MORALE_RECOVER_PER_SEC, MORALE_ROLE_WEIGHT, MORALE_ROUT, MORALE_WINNING_RATIO, PLAYER_MORALE_ANCHOR_RESIST,
  PLAYER_MORALE_ANCHOR_TILES, PLAYER_MORALE_CASUALTY, PLAYER_MORALE_FRONT_LOST_PER_SEC, PLAYER_MORALE_GRACE_TICKS,
  PLAYER_MORALE_MIN_UNITS, PLAYER_MORALE_NEW_FIGHT_TICKS, PLAYER_MORALE_OUTFLANKED_PER_SEC,
  PLAYER_MORALE_OUTNUMBERED_PER_SEC, PLAYER_MORALE_RALLY, PLAYER_MORALE_RECOVER_PER_SEC, PLAYER_MORALE_RESIST_FLOOR,
  PLAYER_MORALE_ROUT, PLAYER_MORALE_SCAN_TILES, PLAYER_MORALE_TC_RECOVER_MULT, PLAYER_MORALE_TC_RESIST,
  PLAYER_MORALE_TC_TILES, PLAYER_MORALE_TOAST_COOLDOWN_TICKS, PLAYER_MORALE_TOWER_RESIST, PLAYER_MORALE_TOWER_TILES,
  PLAYER_MORALE_WALL_RESIST, PLAYER_MORALE_WALL_TILES, PLAYER_MORALE_WAVER, PLAYER_MORALE_WAVERING_DAMAGE,
  PLAYER_MORALE_WINNING_PER_SEC, PLAYER_ROUT_MAX_TICKS, PLAYER_ROUT_MIN_TICKS, PLAYER_ROUT_QUIET_TICKS,
  RAID_CRUSHED_FRACTION, RAID_LEAVE_MAX_TICKS, RAID_MORALE_ANCHOR_RESIST, RAID_MORALE_CASUALTY,
  RAID_MORALE_FRONT_LOST_PER_SEC, RAID_MORALE_GRACE_TICKS, RAID_MORALE_OUTFLANKED_PER_SEC,
  RAID_MORALE_OUTNUMBERED_PER_SEC, RAID_MORALE_ROUT, ROUT_SPEED_FACTOR, ROUT_TOAST_COOLDOWN_TICKS, SITE_KIND_WALLED,
  TACTICS_EVAL_TICKS, TACTICS_OUTNUMBERED_RATIO, TACTICS_SCAN_TILES, TACTICS_SPREAD_CAP_TILES,
} from "./constants.js";
import {
  colonists, mobs, mobsWithoutRoute, moraleRegimentOfUnit, orderGroupOfUnit, orderGroups, playerMorale, players,
  raidGroups, regiments, routedUnits, state, tacticsEvents, walledSites,
} from "./state.js";
import { inBounds, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findPath, isWalkableTile } from "./pathfinding.js";
import { tileDistance } from "./worldgen.js";
import { nearestTownCenter } from "./colonists.js";
import { forEachClan, moraleKey } from "./clans.js";
import {
  armyRegimentsNow, colonistRole, dropGuardTarget, isGuardOrMilitiaKind, isRearColonist, isRearMob, isSiegeKind,
  mobRole, nearestMeleeSoldier, unitStats,
} from "./units.js";
import {
  isWallTile, livingTowersNear, releaseSlot, structureHp, towerCooldownTicks, towerStatsForLevel,
} from "./combat.js";
import { isDormantGuardian } from "./mobs.js";
import { raidGroupMembers, releaseRaidMob, stepRaidMobToward } from "./raids.js";
import { playerDamage } from "./heroes.js";
import { centroidOf, leaveOrderGroup, rallyUnit, startArmyOrder } from "./orders.js";
import { broadcastEvent } from "./net.js";

export function regimentKey(m: Mob): string | null {
  return m.groupId ?? m.regimentId ?? m.siteId ?? null;
}

export function tacticsEvent(regiment: string, type: string, detail?: string) {
  tacticsEvents.push({ tick: state.cycleTick, type, regiment, detail });
  if (tacticsEvents.length > 200) tacticsEvents.shift();
}

// Bosses and Hunger-marked leaders: morale resistance for their regiment, and they never rout.
export function isMoraleAnchor(m: Mob): boolean {
  return !!m.boss || m.mark !== HungerMark.None;
}

export function noteRegimentCasualty(m: Mob) {
  const key = regimentKey(m);
  const reg = key ? regiments.get(key) : undefined;
  if (!reg) return;
  const weight = isMoraleAnchor(m) ? MORALE_LEADER_WEIGHT : m.kind === "catapult" ? MORALE_ROLE_WEIGHT.ranged : MORALE_ROLE_WEIGHT[mobRole(m)];
  reg.pendingLoss += ((reg.raid ? RAID_MORALE_CASUALTY : MORALE_CASUALTY) * weight) / Math.max(3, reg.peak);
}

// The player's forces within radiusPx of (cx, cy): summed HP and damage per mob attack interval.
export function playerForceNear(cx: number, cy: number, radiusPx: number): { hp: number; dmg: number; units: EnemyUnit[] } {
  let hp = 0;
  let dmg = 0;
  const units: EnemyUnit[] = [];
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind) || c.hp <= 0) continue;
    if (Math.abs(c.x - cx) > radiusPx || Math.abs(c.y - cy) > radiusPx || Math.hypot(c.x - cx, c.y - cy) > radiusPx) continue;
    const stats = unitStats(c);
    hp += c.hp;
    dmg += (stats.damage * MOB_ATTACK_COOLDOWN_TICKS) / Math.max(1, stats.cooldown);
    units.push({ type: "colonist", id: c.id, x: c.x, y: c.y, rear: isRearColonist(c) });
  }
  if (!state.testPlayersIgnored) {
    for (const p of players.values()) {
      if (p.dead || Math.hypot(p.x - cx, p.y - cy) > radiusPx) continue;
      hp += p.hp;
      dmg += playerDamage(p);
      units.push({ type: "player", id: p.id, x: p.x, y: p.y, rear: false });
    }
  }
  const t = tileOfPixel(cx, cy);
  for (const tw of livingTowersNear(t.x, t.y, radiusPx / TILE_SIZE, 0)) {
    hp += structureHp(tw.x, tw.y)?.hp ?? BUILDING_HP_BIG;
    dmg += (towerStatsForLevel(tw.level).damage * MOB_ATTACK_COOLDOWN_TICKS) / towerCooldownTicks(tw.level);
  }
  return { hp, dmg, units };
}

// The walkable tiles (mob's view: closed gates solid) reachable from `start` without passing
// COVER_ENCLOSURE_TILES from it, if they are closed off and at least one wall / gate closes them;
// barriers are the wall / gate tiles bordering them. null: open ground, or a gap / open gate (a breach).
export function walledEnclosure(start: TileCoord): { tiles: TileCoord[]; barriers: TileCoord[] } | null {
  if (!isWalkableTile(start.x, start.y)) return null;
  const seen = new Set<number>([tileIndex(start.x, start.y)]);
  const barrierSeen = new Set<number>();
  const tilesOut: TileCoord[] = [start];
  const barriers: TileCoord[] = [];
  for (let i = 0; i < tilesOut.length; i++) {
    const t = tilesOut[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: t.x + dx, y: t.y + dy };
      if (!inBounds(n.x, n.y)) continue;
      const idx = tileIndex(n.x, n.y);
      if (seen.has(idx) || barrierSeen.has(idx)) continue;
      if (isWalkableTile(n.x, n.y)) {
        if (Math.max(Math.abs(n.x - start.x), Math.abs(n.y - start.y)) > COVER_ENCLOSURE_TILES) return null;
        seen.add(idx);
        tilesOut.push(n);
      } else {
        barrierSeen.add(idx);
        const tt = state.tiles[idx] as TileType;
        if (isWallTile(tt) || tt === TileType.Gate) barriers.push(n);
      }
    }
  }
  return barriers.length > 0 ? { tiles: tilesOut, barriers } : null;
}

export function enclosureBreached(e: { barriers: TileCoord[] }): boolean {
  return e.barriers.some((b) => {
    const s = structureHp(b.x, b.y);
    return !!s && s.hp < s.max * COVER_BREACH_HP_FRACTION;
  });
}

// Where the regiment shelters: from its walled site's home, else (mobs already inside walls) from the
// member nearest its centroid. Only regiments that own walls (walledSites / SITE_KIND_WALLED) or stand
// inside a walled enclosure get one.
export function regimentShelter(reg: RegimentState, members: Mob[], cx: number, cy: number) {
  const site = members.find((m) => m.siteId)?.siteKind ?? null;
  if (walledSites.has(reg.id) || (site && SITE_KIND_WALLED[site])) {
    const e = walledEnclosure(tileOfPixel(reg.homeX, reg.homeY));
    if (e) return e;
  }
  const near = members.reduce((b, m) => (Math.hypot(m.x - cx, m.y - cy) < Math.hypot(b.x - cx, b.y - cy) ? m : b));
  return walledEnclosure(tileOfPixel(near.x, near.y));
}

// Posts inside the shelter: ranged / casters on the wall-side tiles nearest the enemy (fire over the
// wall), melee on the tiles nearest a gate (or the enemy, with no gate) to hold the way in.
export function assignShelterPosts(reg: RegimentState, members: Mob[], e: { tiles: TileCoord[]; barriers: TileCoord[] }, ex: number, ey: number) {
  reg.posts.clear();
  const used = new Set<string>();
  const barrierKeys = new Set(e.barriers.map((b) => resourceKey(b.x, b.y)));
  const gatesIn = e.barriers.filter((b) => state.tiles[tileIndex(b.x, b.y)] === TileType.Gate);
  const enemyTile = { x: ex / TILE_SIZE, y: ey / TILE_SIZE };
  const byWall = e.tiles
    .filter((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => barrierKeys.has(resourceKey(t.x + dx, t.y + dy))))
    .sort((a, b) => tileDistance(a, enemyTile) - tileDistance(b, enemyTile));
  const toward = gatesIn.length > 0 ? gatesIn : [{ x: Math.floor(enemyTile.x), y: Math.floor(enemyTile.y) }];
  const byGate = e.tiles
    .slice()
    .sort((a, b) => Math.min(...toward.map((g) => tileDistance(a, g))) - Math.min(...toward.map((g) => tileDistance(b, g))));
  for (const m of members) {
    const list = m.melee ? byGate : byWall.length > 0 ? byWall : byGate;
    const post = list.find((t) => !used.has(resourceKey(t.x, t.y)));
    if (!post) continue;
    used.add(resourceKey(post.x, post.y));
    reg.posts.set(m.id, post);
  }
}

// A point on the map edge straight away from (ax, ay) as seen from the mob (the nearest edge when
// they coincide); a walkable tile near it when there is one.
export function fleeEdgePoint(m: Mob, ax: number, ay: number): { x: number; y: number } {
  const t = tileOfPixel(m.x, m.y);
  let vx = m.x - ax;
  let vy = m.y - ay;
  if (Math.hypot(vx, vy) < 1) {
    const dW = t.x;
    const dE = state.WORLD_TILES_X - 1 - t.x;
    const dN = t.y;
    const dS = state.WORLD_TILES_Y - 1 - t.y;
    const min = Math.min(dW, dE, dN, dS);
    vx = min === dW ? -1 : min === dE ? 1 : 0;
    vy = vx !== 0 ? 0 : min === dN ? -1 : 1;
  }
  const maxX = state.WORLD_TILES_X - 1;
  const maxY = state.WORLD_TILES_Y - 1;
  const tx = vx > 0 ? (maxX - t.x) / vx : vx < 0 ? -t.x / vx : Infinity;
  const ty = vy > 0 ? (maxY - t.y) / vy : vy < 0 ? -t.y / vy : Infinity;
  const k = Math.min(tx, ty);
  const e = {
    x: Math.min(maxX, Math.max(0, Math.round(t.x + vx * k))),
    y: Math.min(maxY, Math.max(0, Math.round(t.y + vy * k))),
  };
  const alongX = tx > ty; // hit the north / south edge: search along x
  for (let d = 0; d <= 10; d++) {
    for (const s of [d, -d]) {
      const x = alongX ? Math.min(maxX, Math.max(0, e.x + s)) : e.x;
      const y = alongX ? e.y : Math.min(maxY, Math.max(0, e.y + s));
      if (isWalkableTile(x, y)) return tileToPixelCenter({ x, y });
    }
  }
  return tileToPixelCenter(e);
}

export function despawnMob(m: Mob) {
  mobs.delete(m.id);
  releaseSlot(m.id);
  mobsWithoutRoute.delete(m.id);
}

export function clearMobTarget(m: Mob) {
  m.targetType = null;
  m.targetId = null;
  m.path = [];
  releaseSlot(m.id);
}

export function startRout(reg: RegimentState, members: Mob[], ex: number, ey: number, toast = true) {
  reg.routed = true;
  reg.sheltering = false;
  reg.flankIds = [];
  tacticsEvent(reg.id, "rout", `morale ${reg.morale.toFixed(0)}`);
  // A raid group still (partly) in formation breaks up at once; the raid's bookkeeping drops it.
  const group = raidGroups.get(reg.id);
  if (group) {
    for (const m of raidGroupMembers(group)) releaseRaidMob(m);
    raidGroups.delete(group.id);
  }
  for (const m of members) {
    if (isMoraleAnchor(m)) continue;
    clearMobTarget(m);
    m.tactic = reg.raid ? "leave" : "rout";
    m.flanker = false;
    if (reg.raid) {
      const edge = fleeEdgePoint(m, ex, ey);
      m.fleeX = edge.x;
      m.fleeY = edge.y;
      m.leaveUntilTick = state.cycleTick + RAID_LEAVE_MAX_TICKS;
    }
  }
  if (toast && reg.raid && state.cycleTick - state.lastRoutToastTick >= ROUT_TOAST_COOLDOWN_TICKS) {
    state.lastRoutToastTick = state.cycleTick;
    broadcastEvent("raid", "The raiders break and flee!");
  }
}

// Flank group: the regiment's fast units (or a detachment of its front line's wing) go round the end of
// an enemy line that is wider than the fight, to its archers (else the line's end unit).
export function tryFlank(reg: RegimentState, members: Mob[], units: EnemyUnit[], cx: number, cy: number) {
  reg.flankIds = reg.flankIds.filter((id) => mobs.get(id)?.tactic === "flank");
  if (reg.flankIds.length > 0) return;
  const soldiers = units.filter((u) => u.type === "colonist");
  if (soldiers.length < 2) return;
  // A mob that already flanked once stays in the fight it was delivered to.
  const free = members.filter((m) => m.groupId === null && !m.tactic && !m.flanker);
  const engaged = free.filter((m) => {
    if (isRearMob(m) || m.targetType !== "colonist" || !m.targetId) return false;
    const c = colonists.get(m.targetId);
    return !!c && Math.hypot(c.x - m.x, c.y - m.y) <= m.range + FLANK_CONTACT_TILES * TILE_SIZE;
  });
  // Someone has to hold the front while the flank goes round (a pure wolf pack doesn't flank).
  if (engaged.length === 0 || !members.some((m) => !isRearMob(m) && mobRole(m) !== "fast")) return;
  const ex = soldiers.reduce((s, u) => s + u.x, 0) / soldiers.length;
  const ey = soldiers.reduce((s, u) => s + u.y, 0) / soldiers.length;
  const dl = Math.hypot(ex - cx, ey - cy) || 1;
  const dx = (ex - cx) / dl;
  const dy = (ey - cy) / dl;
  const lx = -dy;
  const ly = dx;
  const lat = (p: { x: number; y: number }) => (p.x - ex) * lx + (p.y - ey) * ly;
  const dep = (p: { x: number; y: number }) => (p.x - ex) * dx + (p.y - ey) * dy;
  const lo = Math.min(...soldiers.map(lat));
  const hi = Math.max(...soldiers.map(lat));
  // The fight's width: the front-rank members already trading blows (none yet: 0).
  const inMelee = engaged.filter((m) => {
    const c = colonists.get(m.targetId!);
    return mobRole(m) !== "fast" && !!c && Math.hypot(c.x - m.x, c.y - m.y) <= m.range + TILE_SIZE * 0.5;
  });
  const elo = inMelee.length > 0 ? Math.min(...inMelee.map(lat)) : 0;
  const ehi = inMelee.length > 0 ? Math.max(...inMelee.map(lat)) : 0;
  // The line must be a line, and wider than the fight; a regiment already past it is surrounding it.
  if (hi - lo < 2 * TILE_SIZE || hi - lo <= ehi - elo) return;
  if (members.some((m) => dep(m) > TILE_SIZE)) return;
  const back = Math.max(...soldiers.map(dep));
  const fast = free.filter((m) => mobRole(m) === "fast" && !isMoraleAnchor(m));
  // Siege engines never go round a flank.
  const front = free.filter((m) => !isRearMob(m) && mobRole(m) !== "fast" && mobRole(m) !== "siege" && !isMoraleAnchor(m));
  const prefer = fast.length > 0 ? Math.sign(fast.reduce((s, m) => s + lat(m), 0)) || 1 : 1;
  for (const s of [prefer, -prefer]) {
    const end = s > 0 ? hi : lo;
    const out = end + s * FLANK_ARC_TILES * TILE_SIZE;
    // Out to the side on its own side of the line first, then level with the line, then behind it.
    const ahead = Math.min(dl, 4 * TILE_SIZE);
    const w0 = { x: ex + lx * out - dx * ahead, y: ey + ly * out - dy * ahead };
    const w1 = { x: ex + lx * out, y: ey + ly * out };
    const along = end + s * FLANK_ARC_TILES * TILE_SIZE * 0.5;
    const behind = back + FLANK_BEHIND_TILES * TILE_SIZE;
    const w2 = { x: ex + lx * along + dx * behind, y: ey + ly * along + dy * behind };
    // Open flank: the arc's points and the ground between them are walkable and on the map.
    const probes = [w0, w1, w2, { x: (w1.x + w2.x) / 2, y: (w1.y + w2.y) / 2 }, { x: ex + lx * (end + s * TILE_SIZE * 3), y: ey + ly * (end + s * TILE_SIZE * 3) }];
    if (!probes.every((p) => { const t = tileOfPixel(p.x, p.y); return isWalkableTile(t.x, t.y); })) continue;
    let flankers = fast;
    if (flankers.length === 0) {
      if (front.length < FLANK_MIN_FRONT_FOR_DETACH) return;
      const n = Math.max(1, Math.round(front.length * FLANK_DETACH_FRACTION));
      flankers = front.slice().sort((a, b) => s * lat(b) - s * lat(a)).slice(0, n);
    }
    const rear = soldiers.filter((u) => u.rear);
    const pool = rear.length > 0 ? rear : soldiers;
    const target = rear.length > 0
      ? pool.reduce((b, u) => (Math.hypot(u.x - w2.x, u.y - w2.y) < Math.hypot(b.x - w2.x, b.y - w2.y) ? u : b))
      : pool.reduce((b, u) => (s * lat(u) > s * lat(b) ? u : b));
    for (const m of flankers) {
      clearMobTarget(m);
      m.tactic = "flank";
      m.flankWaypoints = [w0, w1, w2];
      m.flankTargetId = target.id;
      m.flankUntilTick = state.cycleTick + FLANK_MAX_TICKS;
      m.repathCooldown = 0;
      reg.flankIds.push(m.id);
    }
    tacticsEvent(reg.id, "flank", `${flankers.length} (${flankers.map((m) => m.kind).join(",")}) side ${s}`);
    return;
  }
}

export function evaluateRegiment(reg: RegimentState, members: Mob[]) {
  let cx = 0;
  let cy = 0;
  for (const m of members) {
    cx += m.x / members.length;
    cy += m.y / members.length;
  }
  reg.peak = Math.max(reg.peak, members.length);
  const spread = Math.min(TACTICS_SPREAD_CAP_TILES * TILE_SIZE, Math.max(...members.map((m) => Math.hypot(m.x - cx, m.y - cy))));
  const enemy = playerForceNear(cx, cy, TACTICS_SCAN_TILES * TILE_SIZE + spread);
  const hp = members.reduce((s, m) => s + Math.max(0, m.hp), 0);
  const dmg = members.reduce((s, m) => s + m.damage, 0);
  // Lanchester-style strength (summed HP x summed damage), so numbers count as they do in a melee.
  const enemyPower = enemy.hp * enemy.dmg;
  const contact = enemyPower > 0;
  reg.ratio = contact ? (hp * dmg) / enemyPower : Infinity;
  let ex = cx;
  let ey = cy;
  if (enemy.units.length > 0) {
    ex = enemy.units.reduce((s, u) => s + u.x, 0) / enemy.units.length;
    ey = enemy.units.reduce((s, u) => s + u.y, 0) / enemy.units.length;
  }

  // Morale.
  const anchored = members.some(isMoraleAnchor);
  if (anchored) reg.hadAnchor = true;
  if (contact && reg.firstContactTick === -Infinity) reg.firstContactTick = state.cycleTick;
  if (!state.testMoraleFrozen) {
    let delta = 0;
    if (contact) {
      reg.lastContactTick = state.cycleTick;
      delta -= reg.pendingLoss;
      if (members.some((m) => !isRearMob(m))) reg.hadFront = true;
      else if (reg.hadFront) delta -= reg.raid ? RAID_MORALE_FRONT_LOST_PER_SEC : MORALE_FRONT_LOST_PER_SEC;
      // Outflanked: an enemy within 4 tiles of a member on the far side of the regiment.
      const dl = Math.hypot(ex - cx, ey - cy) || 1;
      const outflanked = enemy.units.some(
        (u) => ((u.x - cx) * (ex - cx) + (u.y - cy) * (ey - cy)) / dl < -TILE_SIZE &&
          members.some((m) => Math.hypot(m.x - u.x, m.y - u.y) <= 4 * TILE_SIZE)
      );
      if (outflanked) {
        delta -= reg.raid ? RAID_MORALE_OUTFLANKED_PER_SEC : MORALE_OUTFLANKED_PER_SEC;
        reg.outflankedTick = state.cycleTick;
      }
      if (reg.ratio < TACTICS_OUTNUMBERED_RATIO && !reg.sheltering) {
        delta -= (reg.raid ? RAID_MORALE_OUTNUMBERED_PER_SEC : MORALE_OUTNUMBERED_PER_SEC) * (1 - reg.ratio / TACTICS_OUTNUMBERED_RATIO);
      } else if (reg.ratio > MORALE_WINNING_RATIO) delta += MORALE_RECOVER_PER_SEC;
      if (delta < 0 && anchored) delta *= reg.raid ? RAID_MORALE_ANCHOR_RESIST : MORALE_ANCHOR_RESIST;
      // A raid's first seconds of contact cost no morale.
      if (reg.raid && state.cycleTick - reg.firstContactTick < RAID_MORALE_GRACE_TICKS) delta = Math.max(0, delta);
    } else {
      delta += MORALE_RECOVER_PER_SEC;
    }
    reg.morale = Math.max(0, Math.min(MORALE_MAX, reg.morale + delta));
  }
  reg.pendingLoss = 0;

  // Wall cover: shelter while clearly outnumbered and the walls hold; out again when the odds flip
  // or the walls are breached.
  if (reg.sheltering) {
    const e = regimentShelter(reg, members, cx, cy);
    if (!e || enclosureBreached(e) || reg.ratio > COVER_REENGAGE_RATIO) {
      reg.sheltering = false;
      reg.posts.clear();
      tacticsEvent(reg.id, "coverEnd", !e || enclosureBreached(e) ? "breach" : "odds");
    } else assignShelterPosts(reg, members, e, ex, ey);
  } else if (!reg.routed && contact && reg.ratio < TACTICS_OUTNUMBERED_RATIO) {
    const e = regimentShelter(reg, members, cx, cy);
    if (e && !enclosureBreached(e)) {
      reg.sheltering = true;
      for (const m of members) if (m.tactic === "flank") m.tactic = null;
      reg.flankIds = [];
      assignShelterPosts(reg, members, e, ex, ey);
      tacticsEvent(reg.id, "cover", `${e.tiles.length} tiles`);
    }
  }

  // Rout / rally.
  // A raid breaks on morale only below its lower line, or once crushed (few left / its anchor dead).
  const crushed = reg.raid && contact && !state.testMoraleFrozen && (members.length <= RAID_CRUSHED_FRACTION * reg.peak || (reg.hadAnchor && !anchored));
  if (!reg.routed && !reg.sheltering && (reg.morale < (reg.raid ? RAID_MORALE_ROUT : MORALE_ROUT) || crushed)) startRout(reg, members, ex, ey);
  else if (reg.routed && !reg.raid && reg.morale > MORALE_RALLY && state.cycleTick - reg.lastContactTick >= MORALE_RALLY_QUIET_TICKS) {
    reg.routed = false;
    tacticsEvent(reg.id, "rally", `morale ${reg.morale.toFixed(0)}`);
  }
  for (const m of members) {
    if (!reg.routed && m.tactic === "rout") m.tactic = null;
    else if (reg.routed && !reg.raid && !m.tactic && !isMoraleAnchor(m) && m.groupId === null) {
      clearMobTarget(m);
      m.tactic = "rout";
    }
  }

  if (!reg.routed && !reg.sheltering && contact) tryFlank(reg, members, enemy.units, cx, cy);
}

export function updateRegiments() {
  if (state.cycleTick % TACTICS_EVAL_TICKS !== 0) return;
  const byReg = new Map<string, Mob[]>();
  const seen = new Set<string>();
  for (const m of mobs.values()) {
    const key = regimentKey(m);
    if (!key) continue;
    seen.add(key);
    let reg = regiments.get(key);
    if (!reg) {
      reg = {
        id: key, morale: MORALE_MAX, peak: 0, routed: false, raid: !m.siteId, homeX: m.x, homeY: m.y,
        lastContactTick: -Infinity, firstContactTick: -Infinity, hadAnchor: false, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: Infinity,
      };
      regiments.set(key, reg);
    }
    if (isDormantGuardian(m) || m.passive || (m.isDeserter && !m.deserterActive)) continue;
    const list = byReg.get(key);
    if (list) list.push(m);
    else byReg.set(key, [m]);
  }
  for (const id of regiments.keys()) if (!seen.has(id)) regiments.delete(id);
  for (const [id, members] of byReg) evaluateRegiment(regiments.get(id)!, members);
}
// ---- Player regiment morale (strategy mode phase 6; docs PLAN-strategy-mode.md Phase 6). The mob model
// above, tuned gentler: the player's derived regiments (armyRegimentsNow ids) of PLAYER_MORALE_MIN_UNITS+
// fighting units (no heroes, no siege engines) lose morale in contact for casualties, being outnumbered
// (the colony's whole force near them counts, towers included), being outflanked (an enemy behind them, or
// a flank group running at a member) and losing their front rank, and get it back out of contact (faster
// near a Town Center) or while clearly winning. Drains are scaled down by anchors: a hero, a player or a
// knight near the centroid, a tower, walls and the Town Center. Below PLAYER_MORALE_WAVER the regiment is
// Wavering (warning toast, PLAYER_MORALE_WAVERING_DAMAGE); below PLAYER_MORALE_ROUT it routs: its units
// are put on a retreat to the nearest Town Center (phase 3 retreat: fights only when cornered) at rout
// speed and refuse orders until it rallies (PLAYER_MORALE_RALLY after PLAYER_ROUT_QUIET_TICKS quiet and
// PLAYER_ROUT_MIN_TICKS fleeing, or at the latest after PLAYER_ROUT_MAX_TICKS). Evaluated once a second.

export function isRoutedUnit(id: string): boolean {
  return routedUnits.has(id);
}

export function clearPlayerMorale() {
  playerMorale.clear();
  moraleRegimentOfUnit.clear();
  routedUnits.clear();
}

// Units whose morale counts: fighting soldiers, not heroes (solo, anchors) or siege engines.
export function moraleUnit(c: Colonist): boolean {
  return c.hp > 0 && isGuardOrMilitiaKind(c.kind) && c.kind !== "hero" && !isSiegeKind(c.kind);
}

export function notePlayerCasualty(c: Colonist) {
  const reg = playerMorale.get(moraleRegimentOfUnit.get(c.id) ?? "");
  if (!reg || !isGuardOrMilitiaKind(c.kind) || c.kind === "hero" || isSiegeKind(c.kind)) return;
  const role = colonistRole(c) ?? "frontline";
  reg.pendingLoss += (PLAYER_MORALE_CASUALTY * MORALE_ROLE_WEIGHT[role]) / Math.max(3, reg.peak);
}

export function moraleDamageMult(c: Colonist): number {
  const reg = playerMorale.get(moraleRegimentOfUnit.get(c.id) ?? "");
  return reg && reg.active && !reg.routed && reg.morale < PLAYER_MORALE_WAVER ? PLAYER_MORALE_WAVERING_DAMAGE : 1;
}

// Awake hostile mobs (not routing / leaving) within radiusPx: summed hp and damage per attack interval.
export function mobForceNear(cx: number, cy: number, radiusPx: number): { hp: number; dmg: number; units: Mob[] } {
  let hp = 0;
  let dmg = 0;
  const units: Mob[] = [];
  for (const m of mobs.values()) {
    if (Math.abs(m.x - cx) > radiusPx || Math.abs(m.y - cy) > radiusPx) continue;
    if (m.hp <= 0 || m.passive || isDormantGuardian(m) || m.tactic === "rout" || m.tactic === "leave" || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - cx, m.y - cy) > radiusPx) continue;
    hp += m.hp;
    dmg += m.damage;
    units.push(m);
  }
  return { hp, dmg, units };
}

// The product of the drain multipliers that apply at (cx, cy) for this regiment.
export function playerMoraleResist(members: Colonist[], cx: number, cy: number): number {
  let k = 1;
  const anchorPx = PLAYER_MORALE_ANCHOR_TILES * TILE_SIZE;
  let anchored = members.some((c) => c.kind === "knight");
  if (!anchored && !state.testPlayersIgnored) {
    for (const p of players.values()) if (!p.dead && Math.hypot(p.x - cx, p.y - cy) <= anchorPx) anchored = true;
  }
  if (!anchored) {
    for (const c of colonists.values()) {
      if ((c.kind === "hero" || c.kind === "knight") && c.hp > 0 && Math.abs(c.x - cx) <= anchorPx && Math.abs(c.y - cy) <= anchorPx && Math.hypot(c.x - cx, c.y - cy) <= anchorPx) {
        anchored = true;
        break;
      }
    }
  }
  if (anchored) k *= PLAYER_MORALE_ANCHOR_RESIST;
  const t = tileOfPixel(cx, cy);
  if (livingTowersNear(t.x, t.y, PLAYER_MORALE_TOWER_TILES, 0).length > 0) k *= PLAYER_MORALE_TOWER_RESIST;
  let walls = false;
  for (let dy = -PLAYER_MORALE_WALL_TILES; dy <= PLAYER_MORALE_WALL_TILES && !walls; dy++) {
    for (let dx = -PLAYER_MORALE_WALL_TILES; dx <= PLAYER_MORALE_WALL_TILES; dx++) {
      if (!inBounds(t.x + dx, t.y + dy)) continue;
      const tt = state.tiles[tileIndex(t.x + dx, t.y + dy)] as TileType;
      if (isWallTile(tt) || tt === TileType.Gate) {
        walls = true;
        break;
      }
    }
  }
  if (walls) k *= PLAYER_MORALE_WALL_RESIST;
  if (nearTownCenter(cx, cy)) k *= PLAYER_MORALE_TC_RESIST;
  return Math.max(PLAYER_MORALE_RESIST_FLOOR, k);
}

export function nearTownCenter(x: number, y: number): boolean {
  const tc = nearestTownCenter(x, y);
  if (!tc) return false;
  const p = tileToPixelCenter(tc);
  return Math.hypot(p.x - x, p.y - y) <= PLAYER_MORALE_TC_TILES * TILE_SIZE;
}

export function moraleToast(reg: PlayerMoraleState, text: string, force = false) {
  if (!force && state.cycleTick - reg.lastWarnTick < PLAYER_MORALE_TOAST_COOLDOWN_TICKS) return;
  reg.lastWarnTick = state.cycleTick;
  broadcastEvent("morale", text);
}

// The regiment breaks: every member retreats to the nearest Town Center as one order group.
export function startPlayerRout(reg: PlayerMoraleState, members: Colonist[]) {
  reg.routed = true;
  reg.routedTick = state.cycleTick;
  tacticsEvent(reg.id, "playerRout", `morale ${reg.morale.toFixed(0)}`);
  moraleToast(reg, `${reg.name} is routing!`, true);
  for (const c of members) {
    routedUnits.set(c.id, { reg: reg.id, hadGroup: orderGroupOfUnit.has(c.id), rallyX: c.rallyX, rallyY: c.rallyY });
    leaveOrderGroup(c.id);
    dropGuardTarget(c);
  }
  const g: OrderGroup = {
    id: `g${state.nextOrderGroupId++}`, unitIds: new Set(members.map((c) => c.id)), current: null, queue: [],
    destX: 0, destY: 0, startedTick: state.cycleTick, engaged: false, clearSince: -1, followAt: null,
  };
  orderGroups.set(g.id, g);
  for (const c of members) orderGroupOfUnit.set(c.id, g);
  startArmyOrder(g, { kind: "retreat" });
}

export function releaseRoutedUnit(id: string, r: { hadGroup: boolean; rallyX: number; rallyY: number }) {
  routedUnits.delete(id);
  if (r.hadGroup) return;
  leaveOrderGroup(id);
  const c = colonists.get(id);
  if (c) rallyUnit(c, r.rallyX, r.rallyY, null);
}

export function evaluatePlayerRegiment(reg: PlayerMoraleState, members: Colonist[]) {
  const c0 = centroidOf(members);
  let spread = 0;
  for (const c of members) spread = Math.max(spread, Math.hypot(c.x - c0.x, c.y - c0.y));
  spread = Math.min(TACTICS_SPREAD_CAP_TILES * TILE_SIZE, spread);
  const radius = PLAYER_MORALE_SCAN_TILES * TILE_SIZE + spread;
  const enemy = mobForceNear(c0.x, c0.y, radius);
  const enemyPower = enemy.hp * enemy.dmg;
  const contact = enemyPower > 0;
  reg.outflanked = false;
  let delta = 0;
  if (contact) {
    if (state.cycleTick - reg.lastContactTick > PLAYER_MORALE_NEW_FIGHT_TICKS) reg.fightStartTick = state.cycleTick;
    reg.lastContactTick = state.cycleTick;
    if (!reg.routed) {
      const friend = playerForceNear(c0.x, c0.y, radius);
      const ratio = (friend.hp * friend.dmg) / enemyPower;
      reg.ratio = ratio;
      if (members.some((c) => !isRearColonist(c))) reg.hadFront = true;
      else if (reg.hadFront) delta -= PLAYER_MORALE_FRONT_LOST_PER_SEC;
      // Outflanked: an enemy beyond the regiment's far side (from the enemy centroid) within 4 tiles of a
      // member, or a flank group running at one of its members.
      const ex = enemy.units.reduce((s, m) => s + m.x, 0) / enemy.units.length;
      const ey = enemy.units.reduce((s, m) => s + m.y, 0) / enemy.units.length;
      const dl = Math.hypot(ex - c0.x, ey - c0.y) || 1;
      const ids = new Set(members.map((c) => c.id));
      reg.outflanked = enemy.units.some(
        (m) => (m.tactic === "flank" && !!m.flankTargetId && ids.has(m.flankTargetId)) ||
          (((m.x - c0.x) * (ex - c0.x) + (m.y - c0.y) * (ey - c0.y)) / dl < -TILE_SIZE &&
            members.some((c) => Math.abs(c.x - m.x) <= 4 * TILE_SIZE && Math.abs(c.y - m.y) <= 4 * TILE_SIZE && Math.hypot(c.x - m.x, c.y - m.y) <= 4 * TILE_SIZE))
      );
      if (reg.outflanked) delta -= PLAYER_MORALE_OUTFLANKED_PER_SEC;
      if (ratio < TACTICS_OUTNUMBERED_RATIO) delta -= PLAYER_MORALE_OUTNUMBERED_PER_SEC * (1 - ratio / TACTICS_OUTNUMBERED_RATIO);
      else if (ratio > MORALE_WINNING_RATIO) delta += PLAYER_MORALE_WINNING_PER_SEC;
      if (state.cycleTick - reg.fightStartTick < PLAYER_MORALE_GRACE_TICKS) delta = Math.max(0, delta);
      delta -= reg.pendingLoss;
      if (delta < 0) delta *= playerMoraleResist(members, c0.x, c0.y);
    }
  } else {
    delta += PLAYER_MORALE_RECOVER_PER_SEC * (nearTownCenter(c0.x, c0.y) ? PLAYER_MORALE_TC_RECOVER_MULT : 1);
  }
  reg.pendingLoss = 0;
  if (!state.testMoraleFrozen) reg.morale = Math.max(0, Math.min(MORALE_MAX, reg.morale + delta));

  if (!reg.routed) {
    if (reg.morale < PLAYER_MORALE_ROUT && contact && members.length >= PLAYER_MORALE_MIN_UNITS) {
      startPlayerRout(reg, members);
    } else if (reg.morale < PLAYER_MORALE_WAVER && delta < 0) {
      moraleToast(reg, `${reg.name} is wavering`);
    }
    return;
  }
  const fled = state.cycleTick - reg.routedTick;
  const quiet = state.cycleTick - reg.lastContactTick >= PLAYER_ROUT_QUIET_TICKS;
  if ((reg.morale >= PLAYER_MORALE_RALLY && quiet && fled >= PLAYER_ROUT_MIN_TICKS) || fled >= PLAYER_ROUT_MAX_TICKS) {
    reg.routed = false;
    reg.morale = Math.max(reg.morale, PLAYER_MORALE_RALLY);
    reg.hadFront = false;
    tacticsEvent(reg.id, "playerRally", `morale ${reg.morale.toFixed(0)}`);
    moraleToast(reg, `${reg.name} rallies`, true);
    for (const [id, r] of routedUnits) if (r.reg === reg.id) releaseRoutedUnit(id, r);
  }
}

export function updatePlayerMorale() {
  if (state.cycleTick % TACTICS_EVAL_TICKS !== 0) return;
  moraleRegimentOfUnit.clear();
  const seen = new Set<string>();
  // Clans: every clan's regiments, keyed per clan (moraleKey).
  const all: ReturnType<typeof armyRegimentsNow> = [];
  forEachClan(() => {
    for (const r of armyRegimentsNow()) all.push(state.clan.id === 0 ? r : { ...r, id: moraleKey(r.id) });
  });
  for (const r of all) {
    if (r.cls === "hero" || r.cls === "rams" || r.cls === "catapults") continue;
    const members: Colonist[] = [];
    for (const id of r.unitIds) {
      const c = colonists.get(id);
      if (c && moraleUnit(c)) members.push(c);
    }
    if (members.length === 0) continue;
    seen.add(r.id);
    let reg = playerMorale.get(r.id);
    if (!reg) {
      reg = {
        id: r.id, name: r.name, morale: MORALE_MAX, peak: 0, active: false, routed: false, routedTick: -Infinity,
        lastContactTick: -Infinity, fightStartTick: -Infinity, pendingLoss: 0, hadFront: false, outflanked: false, lastWarnTick: -Infinity, ratio: Infinity,
      };
      playerMorale.set(r.id, reg);
    }
    reg.name = r.name;
    for (const c of members) moraleRegimentOfUnit.set(c.id, r.id);
    reg.active = members.length >= PLAYER_MORALE_MIN_UNITS || reg.routed;
    if (!reg.active) {
      // Too small to break: morale only recovers.
      reg.pendingLoss = 0;
      reg.outflanked = false;
      reg.morale = Math.min(MORALE_MAX, reg.morale + PLAYER_MORALE_RECOVER_PER_SEC);
      continue;
    }
    reg.peak = Math.max(reg.peak, members.length);
    evaluatePlayerRegiment(reg, members);
  }
  for (const id of playerMorale.keys()) if (!seen.has(id)) playerMorale.delete(id);
  // Routed units whose regiment is gone / rallied (or who are dead) are released.
  for (const [id, r] of routedUnits) {
    const c = colonists.get(id);
    if (!c) routedUnits.delete(id);
    else if (!playerMorale.get(r.reg)?.routed) releaseRoutedUnit(id, r);
  }
}

// Walks `mob` to (gx, gy) along a path (repathed every MOB_REPATH_TICKS); false when no route exists.
export function walkMobTo(mob: Mob, gx: number, gy: number, speed: number, dt: number): boolean {
  if (mob.path.length === 0) {
    if (mob.repathCooldown > 0) {
      mob.repathCooldown--;
      return true;
    }
    mob.repathCooldown = MOB_REPATH_TICKS;
    const route = findPath(tileOfPixel(mob.x, mob.y), tileOfPixel(gx, gy));
    if (!route) return false;
    mob.path = route;
    if (route.length === 0) stepRaidMobToward(mob, gx, gy, speed, dt);
  }
  advanceAlongPath(mob, dt, speed);
  return true;
}

export function nearestPlayerUnitWithin(mob: Mob, radiusPx: number): { type: MobTargetType; id: string } | null {
  let best: { type: MobTargetType; id: string } | null = null;
  let bestD = radiusPx;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind)) continue;
    const d = Math.hypot(c.x - mob.x, c.y - mob.y);
    if (d <= bestD) {
      bestD = d;
      best = { type: "colonist", id: c.id };
    }
  }
  if (!state.testPlayersIgnored) {
    for (const p of players.values()) {
      const d = Math.hypot(p.x - mob.x, p.y - mob.y);
      if (!p.dead && d <= bestD) {
        bestD = d;
        best = { type: "player", id: p.id };
      }
    }
  }
  return best;
}

// Per-mob tactics step, from updateMob. "handled": it moved the mob this tick; "hold": sheltering, a
// unit target in reach is set (updateMob fights it but never moves); null: ordinary behaviour.
export function mobTactic(mob: Mob, dt: number): "handled" | "hold" | null {
  const key = regimentKey(mob);
  const reg = key ? regiments.get(key) : undefined;
  if (mob.tactic === "leave") {
    const t = tileOfPixel(mob.x, mob.y);
    const onEdge = t.x <= 0 || t.y <= 0 || t.x >= state.WORLD_TILES_X - 1 || t.y >= state.WORLD_TILES_Y - 1;
    const gx = mob.fleeX ?? mob.x;
    const gy = mob.fleeY ?? mob.y;
    if (onEdge || state.cycleTick >= (mob.leaveUntilTick ?? 0) || Math.hypot(gx - mob.x, gy - mob.y) < TILE_SIZE * 0.75) {
      despawnMob(mob);
      if (key) tacticsEvent(key, "despawn", mob.kind);
      return "handled";
    }
    if (!walkMobTo(mob, gx, gy, mob.speed * ROUT_SPEED_FACTOR, dt)) {
      const threat = nearestMeleeSoldier(mob.x, mob.y, TILE_SIZE * 1.2);
      if (threat) return null;
      stepRaidMobToward(mob, gx, gy, mob.speed * ROUT_SPEED_FACTOR, dt);
    }
    return "handled";
  }
  if (mob.tactic === "rout") {
    if (!reg || !reg.routed) {
      mob.tactic = null;
      return null;
    }
    const threat = nearestMeleeSoldier(mob.x, mob.y, TILE_SIZE * 1.2);
    const home = Math.hypot(reg.homeX - mob.x, reg.homeY - mob.y) <= TILE_SIZE * 1.5;
    // Cornered (an attacker on it and nowhere left to run): it fights back.
    if (home) return threat ? null : "handled";
    if (!walkMobTo(mob, reg.homeX, reg.homeY, mob.speed * ROUT_SPEED_FACTOR, dt)) {
      if (threat) return null;
      mob.tactic = null;
    }
    return "handled";
  }
  if (mob.tactic === "flank") {
    const target = mob.flankTargetId ? colonists.get(mob.flankTargetId) : undefined;
    const wps = mob.flankWaypoints ?? [];
    if (!target || state.cycleTick > (mob.flankUntilTick ?? 0) || (reg && (reg.routed || reg.sheltering))) {
      mob.tactic = null;
      return null;
    }
    if (wps.length === 0 || (wps.length < 3 && Math.hypot(target.x - mob.x, target.y - mob.y) <= FLANK_ENGAGE_TILES * TILE_SIZE)) {
      mob.tactic = null;
      mob.flanker = true;
      mob.targetType = "colonist";
      mob.targetId = target.id;
      mob.path = [];
      mob.repathCooldown = 0;
      return null;
    }
    const wp = wps[0];
    if (Math.hypot(wp.x - mob.x, wp.y - mob.y) <= FLANK_WAYPOINT_REACH_PX) {
      wps.shift();
      mob.path = [];
      mob.repathCooldown = 0;
      return "handled";
    }
    if (!walkMobTo(mob, wp.x, wp.y, mob.speed, dt)) {
      wps.shift();
      mob.repathCooldown = 0;
    }
    return "handled";
  }
  if (reg?.sheltering) {
    const post = reg.posts.get(mob.id);
    const foe = nearestPlayerUnitWithin(mob, mob.range + (mob.melee ? TILE_SIZE * 0.5 : 0));
    if (foe) {
      if (mob.targetId !== foe.id) {
        clearMobTarget(mob);
        mob.targetType = foe.type;
        mob.targetId = foe.id;
      }
      return "hold";
    }
    if (mob.targetType) clearMobTarget(mob);
    if (post) {
      const p = tileToPixelCenter(post);
      if (Math.hypot(p.x - mob.x, p.y - mob.y) > TILE_SIZE * 0.4 && !walkMobTo(mob, p.x, p.y, mob.speed, dt)) {
        stepRaidMobToward(mob, p.x, p.y, mob.speed, dt);
      }
    }
    return "handled";
  }
  return null;
}
