// hearths.ts: Camp hearths: POI hearth structures, their damage and destruction, attacking them.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import { type MobKind, TileType, TILE_SIZE } from "@colony/shared/protocol";
import type { AttackObjective, Colonist, HearthState, Mob, PoiSiteKind, TileCoord } from "./types.js";
import {
  BREACH_WALL_COST, CATAPULT_BUILDING_MULT, ENCAMPMENT_EXTRAS, HEARTH_AUTO_TARGET_TILES, HEARTH_DEFAULT_HP,
  HEARTH_LOOT_PER_GUARDIAN, LINE_LEASH_TILES, NEIGHBORS_8, POI_SITE_FOOTPRINT_RADIUS, RAID_LEAVE_MAX_TICKS,
  SIEGE_BUILDING_MULT, SITE_KIND_HAS_HEARTH, STRUCTURE_TARGET_PREFIX, TACTICS_SCAN_TILES,
} from "./constants.js";
import {
  colonists, commandedTargets, hearthEvents, hearths, mobs, ownerSiteIds, regiments, state, structureBreach,
  tileOwner,
} from "./state.js";
import { inBounds, isHostileOwner, ownerAt, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { armyDamageMultiplier } from "./economy.js";
import { isGuardOrMilitiaKind } from "./units.js";
import { damageBuilding, isColonyBreachObstacle, structureHp } from "./combat.js";
import { activateGuardianSite, routeToBuilding } from "./mobs.js";
import {
  clearMobTarget, fleeEdgePoint, isRoutedUnit, moraleDamageMult, playerForceNear, startRout,
} from "./tactics.js";
import { stepRaidMobToward } from "./raids.js";
import { grantTieredEquipment, heroRelicForHearth, weaponDamageMult } from "./heroes.js";
import { spellBuffDamageMult } from "./spells.js";
import { leaveOrderGroup } from "./orders.js";
import { broadcastEvent, broadcastTileUpdate } from "./net.js";
import { noteSettlementAttacked, onFortKeepDestroyed, plunderSiteStock, siteIdNeutral, siteName, siteNumNeutral } from "./sites.js";
import { noteCampCleared } from "./diplomacy.js";

export function hearthEvent(siteId: string, type: string, detail?: string) {
  hearthEvents.push({ tick: state.cycleTick, type, siteId, detail });
  if (hearthEvents.length > 100) hearthEvents.shift();
}

export function campFaction(kinds: MobKind[]): string {
  if (kinds.some((k) => k.startsWith("bandit"))) return "bandit";
  if (kinds.some((k) => k === "orc" || k === "armoredOrc" || k.startsWith("goblin"))) return "orc";
  return "enemy";
}

export function registerHearth(siteId: string, siteKind: PoiSiteKind, center: TileCoord, kinds: MobKind[]) {
  const maxHp = SITE_KIND_HAS_HEARTH[siteKind]?.hp ?? HEARTH_DEFAULT_HP;
  hearths.set(siteId, {
    siteId, siteKind, x: center.x, y: center.y, hp: maxHp, maxHp, destroyed: false, faction: campFaction(kinds), garrison: kinds.length,
  });
}

export function standingHearthAt(tx: number, ty: number): HearthState | undefined {
  for (const h of hearths.values()) if (!h.destroyed && h.x === tx && h.y === ty) return h;
  return undefined;
}

export function hostileStructureAt(index: number): boolean {
  if (!isHostileOwner(ownerAt(index))) return false;
  return structureHp(index % state.WORLD_TILES_X, Math.floor(index / state.WORLD_TILES_X)) !== null;
}

export function attackObjectiveAt(tx: number, ty: number): AttackObjective | null {
  if (!inBounds(tx, ty)) return null;
  const h = standingHearthAt(tx, ty);
  if (h) return { id: h.siteId, x: h.x, y: h.y };
  const index = tileIndex(tx, ty);
  return hostileStructureAt(index) ? { id: STRUCTURE_TARGET_PREFIX + index, x: tx, y: ty } : null;
}

// The nearest hostile NPC structure within maxPx of (px, py) and within zonePx of (zx, zy); null if none.
export function nearestHostileStructure(px: number, py: number, maxPx: number, zx = px, zy = py, zonePx = Infinity): AttackObjective | null {
  let best: AttackObjective | null = null;
  let bestD = maxPx;
  for (const index of tileOwner.keys()) {
    const x = index % state.WORLD_TILES_X;
    const y = Math.floor(index / state.WORLD_TILES_X);
    const c = tileToPixelCenter({ x, y });
    if (Math.abs(c.x - px) > bestD || Math.abs(c.y - py) > bestD) continue;
    const d = Math.hypot(c.x - px, c.y - py);
    if (d > bestD || Math.hypot(c.x - zx, c.y - zy) > zonePx || !hostileStructureAt(index)) continue;
    // Forts phase C: a neutral settlement is never an automatic target (only an explicit order).
    if (siteNumNeutral(ownerAt(index))) continue;
    bestD = d;
    best = { id: STRUCTURE_TARGET_PREFIX + index, x, y };
  }
  return best;
}

// Old saves (no hearth records) and sites missing one: a full-HP hearth on the campfire nearest each
// hearth-kind site's guardians; a campfire left with no guardians gets one too (it only leaves loot).
export function backfillHearths() {
  const claimed = new Set<number>();
  for (const h of hearths.values()) claimed.add(tileIndex(h.x, h.y));
  const sites = new Map<string, Mob[]>();
  for (const m of mobs.values()) {
    if (!m.siteId || !m.siteKind || !SITE_KIND_HAS_HEARTH[m.siteKind]?.hasHearth || hearths.has(m.siteId)) continue;
    const list = sites.get(m.siteId);
    if (list) list.push(m);
    else sites.set(m.siteId, [m]);
  }
  const campfires: TileCoord[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    // Forts phase B: a fort's campfires are decor (its hearth is the keep, saved with the site).
    if (state.tiles[i] === TileType.PropCampfire && !claimed.has(i) && !tileOwner.has(i)) campfires.push({ x: i % state.WORLD_TILES_X, y: Math.floor(i / state.WORLD_TILES_X) });
  }
  for (const [siteId, members] of sites) {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length / TILE_SIZE;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length / TILE_SIZE;
    let best: TileCoord | null = null;
    let bestD = POI_SITE_FOOTPRINT_RADIUS + 8;
    for (const f of campfires) {
      const d = Math.hypot(f.x + 0.5 - cx, f.y + 0.5 - cy);
      if (!claimed.has(tileIndex(f.x, f.y)) && d <= bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) continue;
    claimed.add(tileIndex(best.x, best.y));
    registerHearth(siteId, members[0].siteKind!, best, members.map((m) => m.kind));
  }
  for (const f of campfires) {
    if (claimed.has(tileIndex(f.x, f.y))) continue;
    registerHearth(randomUUID(), "encampment", f, ["banditClubman", "banditClubman"]);
  }
}

// Damage to a hearth from the colony's side; wakes its guardians (they defend it).
export function damageHearth(h: HearthState, amount: number, attackerKey?: string) {
  if (h.destroyed || amount <= 0) return;
  noteSettlementAttacked(h.siteId, attackerKey);
  activateGuardianSite(h.siteId);
  h.hp -= amount;
  hearthEvent(h.siteId, "hit", `${amount.toFixed(1)} ${attackerKey ?? ""}`.trim());
  if (h.hp <= 0) destroyHearth(h, attackerKey);
}

export function destroyHearth(h: HearthState, attackerKey?: string) {
  h.destroyed = true;
  h.hp = 0;
  state.campsDestroyed++;
  // Forts phase D: settlements near a fallen bandit / orc camp or fort are grateful.
  noteCampCleared(h, attackerKey);
  const centre = tileToPixelCenter(h);
  state.pendingEffects.push({ fromX: centre.x, fromY: centre.y, toX: centre.x, toY: centre.y, boulder: true });
  // Forts phase B: a fort's keep falls to a RuinedKeep (the site is cleared; its other tiles stand).
  if (h.siteKind === "fort") onFortKeepDestroyed(h.siteId);
  else {
    // The fire burns out: the hearth tile becomes scorched rubble, the camp's props around it burn away.
    state.tiles[tileIndex(h.x, h.y)] = TileType.RuinRubble;
    broadcastTileUpdate(h.x, h.y, TileType.RuinRubble);
    for (const o of NEIGHBORS_8) {
      const x = h.x + o.x;
      const y = h.y + o.y;
      if (!inBounds(x, y) || !ENCAMPMENT_EXTRAS.includes(state.tiles[tileIndex(x, y)] as TileType)) continue;
      state.tiles[tileIndex(x, y)] = TileType.Empty;
      broadcastTileUpdate(x, y, TileType.Empty);
      const p = tileToPixelCenter({ x, y });
      state.pendingEffects.push({ fromX: p.x, fromY: p.y, toX: p.x, toY: p.y, boulder: true });
    }
  }
  // Every guardian of the site breaks: a "leave" rout away from the attackers (or the hearth).
  const members = Array.from(mobs.values()).filter((m) => m.siteId === h.siteId);
  if (members.length > 0) {
    for (const m of members) m.guardianActive = true;
    let reg = regiments.get(h.siteId);
    if (!reg) {
      reg = {
        id: h.siteId, morale: 0, peak: members.length, routed: false, raid: true, homeX: centre.x, homeY: centre.y,
        lastContactTick: state.cycleTick, firstContactTick: state.cycleTick, hadAnchor: false, pendingLoss: 0, hadFront: false, sheltering: false, posts: new Map(), flankIds: [], ratio: 0,
      };
      regiments.set(h.siteId, reg);
    }
    reg.raid = true;
    reg.morale = 0;
    const enemy = playerForceNear(centre.x, centre.y, TACTICS_SCAN_TILES * TILE_SIZE);
    const ex = enemy.units.length > 0 ? enemy.units.reduce((s, u) => s + u.x, 0) / enemy.units.length : centre.x;
    const ey = enemy.units.length > 0 ? enemy.units.reduce((s, u) => s + u.y, 0) / enemy.units.length : centre.y;
    startRout(reg, members, ex, ey, false);
    // A broken camp has no anchor: its bosses / marked leaders flee with the rest.
    for (const m of members) {
      if (m.tactic === "leave") continue;
      clearMobTarget(m);
      m.tactic = "leave";
      m.flanker = false;
      const edge = fleeEdgePoint(m, ex, ey);
      m.fleeX = edge.x;
      m.fleeY = edge.y;
      m.leaveUntilTick = state.cycleTick + RAID_LEAVE_MAX_TICKS;
    }
  }
  const g = Math.max(1, h.garrison);
  const loot: Record<string, number> = {
    gold: HEARTH_LOOT_PER_GUARDIAN.gold * g,
    wood: HEARTH_LOOT_PER_GUARDIAN.wood * g,
    rock: HEARTH_LOOT_PER_GUARDIAN.rock * g,
    iron: HEARTH_LOOT_PER_GUARDIAN.iron * g,
  };
  state.stock.gold += loot.gold;
  state.stock.wood += loot.wood;
  state.stock.rock += loot.rock;
  state.stock.iron += loot.iron;
  // Forts phase B: a fort's keep also yields SITE_LOOT_STOCK_SHARE of its stockpile, and the toast names it.
  const fortName = h.siteKind === "fort" ? siteName(h.siteId) : undefined;
  if (h.siteKind === "fort") {
    for (const [k, v] of Object.entries(plunderSiteStock(h.siteId))) loot[k] = (loot[k] ?? 0) + (v ?? 0);
  }
  // Armour & weapons: 1 + floor(garrison / 2) pieces of a weighted random tier.
  const gear = grantTieredEquipment(1 + Math.floor(g / 2), "hearth");
  hearthEvent(h.siteId, "destroyed", `${members.length} routed; loot ${JSON.stringify(loot)}; gear ${gear}`);
  const extra = Object.entries(loot).filter(([k]) => !["gold", "wood", "rock", "iron"].includes(k)).map(([k, v]) => `, ${v} ${k}`).join("");
  broadcastEvent(
    "milestone",
    `${fortName ? `${fortName} falls!` : `The ${h.faction} camp breaks and scatters!`} Plundered ${loot.gold} gold, ${loot.wood} wood, ${loot.rock} rock, ${loot.iron} iron${extra}, ${gear}`
  );
  // Hero phases 1-2: RELIC_HEARTH_CHANCE of a relic (after the plunder toast).
  heroRelicForHearth(attackerKey);
}

// Flattened [tile index, hp permille] per standing hearth (snapshot `hearths`, HEARTH_SNAPSHOT_STRIDE).
export function hearthsForSnapshot(): number[] {
  const out: number[] = [];
  for (const h of hearths.values()) {
    if (!h.destroyed) out.push(tileIndex(h.x, h.y), Math.max(0, Math.floor((h.hp / h.maxHp) * 1000)));
  }
  return out;
}

// The orthogonal walkable neighbour of a hearth nearest (px, py), else any walkable neighbour.
export function hearthApproachTile(h: { x: number; y: number }, px: number, py: number): TileCoord | null {
  let best: TileCoord | null = null;
  let bestD = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = { x: h.x + dx, y: h.y + dy };
    if (!isWalkableTile(t.x, t.y)) continue;
    const p = tileToPixelCenter(t);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ?? findAdjacentWalkable(h.x, h.y);
}

// Commanded attack on a hearth: the units' rally moves to the hearth (so they defend that spot
// against its guardians, and hold there once it falls).
export function handleCommandAttackHearth(unitIds: string[], tx: number, ty: number) {
  const h = attackObjectiveAt(tx, ty);
  if (!h) return;
  for (const id of unitIds) {
    const c = colonists.get(id);
    if (!c || !isGuardOrMilitiaKind(c.kind) || isRoutedUnit(c.id)) continue;
    if (!hearthApproachTile(h, c.x, c.y)) continue;
    leaveOrderGroup(c.id);
    sendAgainstHearth(c, h);
  }
}

// The unit's rally moves to the hearth's approach tile and it attacks the hearth (no-op without one).
export function sendAgainstHearth(c: Colonist, h: AttackObjective) {
  const approach = hearthApproachTile(h, c.x, c.y);
  if (!approach) return;
  const p = tileToPixelCenter(approach);
  structureBreach.delete(c.id);
  c.targetHearthId = h.id;
  c.targetMobId = null;
  commandedTargets.delete(c.id);
  c.squadId = null;
  c.rallyTileX = approach.x;
  c.rallyTileY = approach.y;
  c.rallyX = p.x;
  c.rallyY = p.y;
  c.path = [];
  c.repathCooldown = 0;
}

// A soldier with no mob target: works on its hearth target (commanded, or picked on an aggressive stance
// when one stands within HEARTH_AUTO_TARGET_TILES and inside the unit's zone). True when it acted.
export function hearthStep(c: Colonist, stats: { damage: number; cooldown: number; melee: boolean; range: number; speed: number }, dt: number): boolean {
  if (c.targetHearthId?.startsWith(STRUCTURE_TARGET_PREFIX)) return structureStep(c, stats, dt);
  let h = c.targetHearthId ? hearths.get(c.targetHearthId) : undefined;
  if (c.targetHearthId && (!h || h.destroyed)) {
    c.targetHearthId = null;
    c.path = [];
    h = undefined;
  }
  if (!h && c.stance === "aggressive" && !(c.holdFire && !stats.melee)) {
    const zone = LINE_LEASH_TILES[c.stance] * TILE_SIZE + stats.range + TILE_SIZE;
    let bestD = HEARTH_AUTO_TARGET_TILES * TILE_SIZE;
    for (const cand of hearths.values()) {
      if (cand.destroyed || siteIdNeutral(cand.siteId)) continue;
      const p = tileToPixelCenter(cand);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= bestD && Math.hypot(p.x - c.rallyX, p.y - c.rallyY) <= zone) {
        bestD = d;
        h = cand;
      }
    }
    if (h) c.targetHearthId = h.siteId;
    // Forts phase A: else a hostile site's structure in the same reach (scanned a few times a second).
    if (!h && tileOwner.size > 0 && state.cycleTick % 5 === 0) {
      const s = nearestHostileStructure(c.x, c.y, HEARTH_AUTO_TARGET_TILES * TILE_SIZE, c.rallyX, c.rallyY, zone);
      if (s) {
        c.targetHearthId = s.id;
        return structureStep(c, stats, dt);
      }
    }
  }
  if (!h) return false;
  const p = tileToPixelCenter(h);
  const dist = Math.hypot(p.x - c.x, p.y - c.y);
  const reach = Math.max(stats.range + TILE_SIZE * 0.5, TILE_SIZE * 1.5);
  if (dist <= reach) {
    c.path = [];
    c.state = "attacking";
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
      return true;
    }
    let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
    if (c.kind === "batteringRam") damage *= SIEGE_BUILDING_MULT;
    else if (c.kind === "catapult") damage *= CATAPULT_BUILDING_MULT;
    c.attackCooldownTicks = stats.cooldown;
    state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: p.x, toY: p.y, melee: stats.melee, ...(c.kind === "catapult" ? { boulder: true } : {}) });
    damageHearth(h, damage, "c:" + c.id);
    if (h.destroyed) c.targetHearthId = null;
    return true;
  }
  if (stats.speed === 0) return false;
  if (c.path.length === 0) {
    const approach = hearthApproachTile(h, c.x, c.y);
    const route = approach ? findPath(tileOfPixel(c.x, c.y), approach) : null;
    if (!route) {
      c.targetHearthId = null;
      return false;
    }
    c.path = route;
    if (route.length === 0) stepRaidMobToward(c, p.x, p.y, stats.speed, dt);
  }
  if (c.path.length > 0) advanceAlongPath(c, dt, stats.speed);
  c.state = "engaging";
  return true;
}

// Forts phase A: hearthStep for a structure target (a hostile site's wall / gate / tower / building).
// Walled off: breaks through the first site wall / gate on the cheapest route (structureBreach) first.
export function structureStep(c: Colonist, stats: { damage: number; cooldown: number; melee: boolean; range: number; speed: number }, dt: number): boolean {
  const goal = Number(c.targetHearthId!.slice(STRUCTURE_TARGET_PREFIX.length));
  if (!Number.isInteger(goal) || goal < 0 || goal >= state.tiles.length || !hostileStructureAt(goal)) {
    c.targetHearthId = null;
    structureBreach.delete(c.id);
    c.path = [];
    return false;
  }
  let at = goal;
  const breach = structureBreach.get(c.id);
  if (breach !== undefined) {
    if (hostileStructureAt(breach)) at = breach;
    else {
      structureBreach.delete(c.id);
      c.path = [];
    }
  }
  const tx = at % state.WORLD_TILES_X;
  const ty = Math.floor(at / state.WORLD_TILES_X);
  const p = tileToPixelCenter({ x: tx, y: ty });
  const dist = Math.hypot(p.x - c.x, p.y - c.y);
  const reach = Math.max(stats.range + TILE_SIZE * 0.5, TILE_SIZE * 1.5);
  if (dist <= reach) {
    c.path = [];
    c.state = "attacking";
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
      return true;
    }
    let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
    if (c.kind === "batteringRam") damage *= SIEGE_BUILDING_MULT;
    else if (c.kind === "catapult") damage *= CATAPULT_BUILDING_MULT;
    c.attackCooldownTicks = stats.cooldown;
    state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: p.x, toY: p.y, melee: stats.melee, ...(c.kind === "catapult" ? { boulder: true } : {}) });
    // Hitting a site's building wakes its guardians (they defend it).
    const siteId = ownerSiteIds[ownerAt(at) - 1];
    if (siteId) activateGuardianSite(siteId);
    damageBuilding(tx, ty, damage);
    if (!hostileStructureAt(at)) {
      if (at === goal) c.targetHearthId = null;
      structureBreach.delete(c.id);
      c.path = [];
    }
    return true;
  }
  if (stats.speed === 0) return false;
  if (c.path.length === 0) {
    const start = tileOfPixel(c.x, c.y);
    const approach = hearthApproachTile({ x: tx, y: ty }, c.x, c.y);
    let route = approach ? findPath(start, approach) : null;
    if (!route && at === goal) {
      const via = routeToBuilding(start, tx, ty, BREACH_WALL_COST, true);
      const wallAt = via ? via.findIndex((t) => isColonyBreachObstacle(t.x, t.y)) : -1;
      if (via && wallAt >= 0) {
        structureBreach.set(c.id, tileIndex(via[wallAt].x, via[wallAt].y));
        route = via.slice(0, wallAt);
      }
    }
    if (!route) {
      c.targetHearthId = null;
      structureBreach.delete(c.id);
      return false;
    }
    c.path = route;
    if (route.length === 0) stepRaidMobToward(c, p.x, p.y, stats.speed, dt);
  }
  if (c.path.length > 0) advanceAlongPath(c, dt, stats.speed);
  c.state = "engaging";
  return true;
}
