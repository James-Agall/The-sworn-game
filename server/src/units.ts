// units.ts: Soldiers: unit stats, posts and garrisons, rally/return, guard AI, bishops, task forces, army regiment derivation.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import {
  type SiegeKind, type ColonistKind, TileType, type ArmyRegimentSnapshot, type RegimentClass, type CombatRole,
  unitRole, HERO_CLASS_ROLE, TILE_SIZE, TICK_RATE, HungerMark, isRearRole, MOB_ROLE,
} from "@colony/shared/protocol";
import type { Colonist, Mob } from "./types.js";
import {
  ARCHER_ATTACK_COOLDOWN_TICKS, ARCHER_ATTACK_RANGE, ARCHER_DAMAGE, ARCHER_FRONT_RANK_SCAN_TILES, ARCHER_MAX_HP,
  ARCHER_SPEED, ARMY_REGIMENT_REFRESH_TICKS, BISHOP_HEAL_AMOUNT, BISHOP_HEAL_COOLDOWN_TICKS, BISHOP_HEAL_RANGE,
  BISHOP_SPEED, CATAPULT_DAMAGE, CATAPULT_MAX_HP, CATAPULT_MIN_RANGE, CATAPULT_RANGE, CATAPULT_RELOAD_TICKS,
  CATAPULT_SPEED, CAVALRY_SPEED, CHURCH_HEAL_BONUS_PER_STEP, COLONIST_BODY_RADIUS, GARRISON_LOITER_PX,
  GUARD_ALERT_RANGE_TILES, HOLD_LEASH_TILES, KNIGHT_ATTACK_COOLDOWN_TICKS, KNIGHT_ATTACK_RANGE, KNIGHT_LEVEL_STATS,
  KNIGHT_SPEED, LINE_LEASH_TILES, MILITIA_LEVEL_STATS, MILITIA_SPEED, MOB_ATTACK_COOLDOWN_TICKS, MOB_REPATH_TICKS,
  MORVAIN_DETECTION_FACTOR, ORDER_UPDATE_TICKS, PLAYER_MORALE_WAVER, PLAYER_ROUT_SPEED_FACTOR, QUEUE_STANDOFF_PX,
  RALLY_ARRIVE_PX, RAM_ATTACK_COOLDOWN_TICKS, RAM_DAMAGE, RAM_MAX_HP, RAM_SPEED, RAM_UNIT_MULT, RANGED_KITE_TILES,
  REGIMENT_CLASS_LABEL, REGIMENT_CLASS_OF, REGIMENT_CLASS_ORDER, RETREAT_CORNERED_TILES, RETREAT_SPEED_FACTOR,
  SETTLEMENT_GARRISON_CAP_BY_TIER, SKIRMISH_DRIFT_TILES, SKIRMISH_KITE_TILES, SLOT_CLOSE_IN_PX, SLOT_RETARGET_FACTOR,
  SQUAD_AHEAD_SPEED_FACTOR, SQUAD_BROKEN_TILES, SQUAD_LEAD_TOLERANCE_TILES, SQUAD_SETTLE_TILES,
  STANCE_ALERT_RANGE_TILES,
} from "./constants.js";
import {
  chargeCycle, colonists, commandedTargets, mobs, playerMorale, players, respawnQueue, squadMarchSpeed, state,
  } from "./state.js";
import {
  biomeSpeedMultiplier, getBuildingLevel, levelBonus, resourceKey, roadSpeedMultiplier, tileIndex, tileOfPixel,
  tileToPixelCenter,
} from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { armyDamageMultiplier } from "./economy.js";
import {
  castleLevelForTile, guardCountForLevel, isMilitaryTile, settlementKeyNear, settlementOf,
} from "./colonists.js";
import {
  approachGoal, damageMob, getMobById, meleeAttackerCap, releaseSlot, targetHasRoom, unitSlotPoint,
} from "./combat.js";
import { catapultImpact, siegeEvent, takeChargeBonus, trackCharge } from "./siege.js";
import { isDormantGuardian, mobBodyRadius, mobHitBonus } from "./mobs.js";
import { adjacentHouseCount, cavalryCountForLevel } from "./construction.js";
import { isRoutedUnit, moraleDamageMult } from "./tactics.js";
import { stepRaidMobToward } from "./raids.js";
import { hearthStep } from "./hearths.js";
import { equipEvent, heroBaseStats, heroCombatStats, heroTestEvent, playerMaxHp, weaponDamageMult } from "./heroes.js";
import { heroAutoCast, spellBuffDamageMult, spellBuffSpeedMult } from "./spells.js";
import { bombardPoint, bombardStep, isCommandable, unitOrderKind } from "./orders.js";
import { clanIdAt, clanTownCenters, inClan, moraleKey } from "./clans.js";
import { levyRegimentName } from "./vassals.js";
import { siteIdNeutral } from "./sites.js";
import { creativeFightStep, isSleepingNeutral } from "./creative.js";

export function pruneTaskForces() {
  for (const [slot, unitIds] of state.taskForces) {
    const alive = unitIds.filter((id) => colonists.has(id));
    if (alive.length === 0) {
      state.taskForces.delete(slot);
      state.taskForceMax.delete(slot);
    } else if (alive.length !== unitIds.length) {
      state.taskForces.set(slot, alive);
    }
  }
}

export function taskForcesForSnapshot(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [slot, unitIds] of state.taskForces) {
    result[String(slot)] = unitIds;
  }
  return result;
}

export function isSiegeKind(kind: string): kind is SiegeKind {
  return kind === "batteringRam" || kind === "catapult";
}

export function guardStats(kind: ColonistKind, level: number) {
  // Heroes: class base stats (unitStats adds level + equipment); champion as the class-less fallback.
  if (kind === "hero") return heroBaseStats("champion");
  if (kind === "cavalry") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = KNIGHT_LEVEL_STATS[lvl];
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - levelBonus(level))),
      speed: CAVALRY_SPEED,
      melee: true,
    };
  }
  if (kind === "batteringRam") {
    return { maxHp: RAM_MAX_HP, damage: RAM_DAMAGE, range: KNIGHT_ATTACK_RANGE, cooldown: RAM_ATTACK_COOLDOWN_TICKS, speed: RAM_SPEED, melee: true };
  }
  if (kind === "catapult") {
    return { maxHp: CATAPULT_MAX_HP, damage: CATAPULT_DAMAGE, range: CATAPULT_RANGE, cooldown: CATAPULT_RELOAD_TICKS, speed: CATAPULT_SPEED, melee: false };
  }
  if (kind === "knight") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = KNIGHT_LEVEL_STATS[lvl];
    const speedBonus = levelBonus(level);
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - speedBonus)),
      speed: KNIGHT_SPEED,
      melee: true,
    };
  }
  if (kind === "militia" || kind === "spearman" || kind === "pikeman") {
    const lvl = Math.min(Math.max(level, 1), 3) - 1;
    const tierStats = MILITIA_LEVEL_STATS[lvl];
    const speedBonus = levelBonus(level);
    return {
      maxHp: tierStats.maxHp,
      damage: tierStats.damage,
      range: KNIGHT_ATTACK_RANGE,
      cooldown: Math.round(KNIGHT_ATTACK_COOLDOWN_TICKS * (1 - speedBonus)),
      speed: MILITIA_SPEED,
      melee: true,
    };
  }
  const bonus = levelBonus(level);
  return {
    maxHp: Math.round(ARCHER_MAX_HP * (1 + bonus)),
    damage: Math.ceil(ARCHER_DAMAGE * (1 + bonus)),
    range: ARCHER_ATTACK_RANGE,
    cooldown: Math.round(ARCHER_ATTACK_COOLDOWN_TICKS * (1 - bonus)),
    speed: ARCHER_SPEED,
    melee: false,
  };
}

export function militiaCountForLevel(level: number): number {
  if (level >= 3) return 10;
  if (level >= 2) return 6;
  return 2;
}

export function militiaKindForLevel(level: number): ColonistKind {
  if (level >= 3) return "pikeman";
  if (level >= 2) return "spearman";
  return "militia";
}

export function militiaLevelForTile(t: TileType): number {
  if (t === TileType.MilitiaCamp2) return 2;
  if (t === TileType.MilitiaCamp3) return 3;
  return 1;
}

export function isMilitiaLineKind(kind: ColonistKind): boolean {
  return kind === "militia" || kind === "spearman" || kind === "pikeman";
}

export function isGuardOrMilitiaKind(kind: ColonistKind) {
  return kind === "knight" || kind === "archer" || kind === "cavalry" || kind === "hero" || isSiegeKind(kind) || isMilitiaLineKind(kind);
}

// Soldiers that can desert (siege engines and heroes can't; heroes count population via populationCostOf).
export function isSoldierKind(kind: ColonistKind): boolean {
  return isGuardOrMilitiaKind(kind) && !isSiegeKind(kind) && kind !== "hero";
}

// Combat stats of a living soldier: heroes derive theirs from class + level + equipment (heroCombatStats).
export function unitStats(c: Colonist) {
  const s = c.kind === "hero" ? heroCombatStats(c) : guardStats(c.kind, c.castleLevel);
  // Hero phase 4: a Rally Banner buff speeds the unit up.
  const buff = spellBuffSpeedMult("c:" + c.id);
  return buff === 1 ? s : { ...s, speed: s.speed * buff };
}

export function settlementGarrisonTierCap(level: number): number {
  return SETTLEMENT_GARRISON_CAP_BY_TIER[Math.min(Math.max(level, 1), SETTLEMENT_GARRISON_CAP_BY_TIER.length) - 1];
}

// The unit building at a tile: the kind it fields, its level, tier headcount and own troop capacity.
export function unitBuildingSlots(tx: number, ty: number): { kind: ColonistKind; level: number; base: number; cap: number } | null {
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  if (!isMilitaryTile(t)) return null;
  let kind: ColonistKind;
  let level: number;
  let base: number;
  if (t === TileType.KnightPost || t === TileType.CastleLevel2 || t === TileType.CastleLevel3) {
    kind = "knight";
    level = castleLevelForTile(t);
    base = guardCountForLevel(level);
  } else if (t === TileType.ArcherPost) {
    kind = "archer";
    level = getBuildingLevel(tx, ty);
    base = guardCountForLevel(level);
  } else if (t === TileType.Stables) {
    kind = "cavalry";
    level = getBuildingLevel(tx, ty);
    base = cavalryCountForLevel(level);
  } else {
    level = militiaLevelForTile(t);
    kind = militiaKindForLevel(level);
    base = militiaCountForLevel(level);
  }
  return { kind, level, base, cap: base + adjacentHouseCount(tx, ty) };
}

// Living soldiers posted at a unit building (any militia-line kind counts for a Militia Camp).
export function troopsAtPost(tx: number, ty: number, kind: ColonistKind): number {
  let n = 0;
  for (const c of colonists.values()) {
    if (c.postX === tx && c.postY === ty && (c.kind === kind || (isMilitiaLineKind(kind) && isMilitiaLineKind(c.kind)))) n++;
  }
  return n;
}

// Soldiers a military placement adds to its garrison (the post's base headcount after minus before:
// a new post or an in-place upgrade); 0 for anything else. Checked against the settlement's garrison
// ceiling (garrisonBlocker: handleSetTileInner, upgrade button) and counted while under construction.
export function garrisonGain(tile: TileType, current: TileType, tx: number, ty: number): number {
  let before = 0;
  let after = 0;
  if (tile === TileType.KnightPost) {
    const lv = current === TileType.KnightPost ? 1 : current === TileType.CastleLevel2 ? 2 : current === TileType.CastleLevel3 ? 3 : 0;
    if (lv >= 3) return 0;
    before = lv ? guardCountForLevel(lv) : 0;
    after = guardCountForLevel(lv + 1);
  } else if (tile === TileType.MilitiaPost) {
    const lv = current === TileType.MilitiaPost ? 1 : current === TileType.MilitiaCamp2 ? 2 : current === TileType.MilitiaCamp3 ? 3 : 0;
    if (lv >= 3) return 0;
    before = lv ? militiaCountForLevel(lv) : 0;
    after = militiaCountForLevel(lv + 1);
  } else if (tile === TileType.ArcherPost || tile === TileType.Stables) {
    const lv = current === tile ? getBuildingLevel(tx, ty) : 0;
    if (lv >= 3) return 0;
    const count = tile === TileType.ArcherPost ? guardCountForLevel : cavalryCountForLevel;
    before = lv ? count(lv) : 0;
    after = count(lv + 1);
  }
  return Math.max(0, after - before);
}
// ---- Army regiments (strategy mode phase 2; docs PLAN-strategy-mode.md §4 and the user's 2026-10-28
// grouping decision). Derived from state at every snapshot, never stored: each commandable unit is in
// exactly one regiment —
//   task force N (assignTaskForce)  "tf<N>": the manual merge / split (select units, Ctrl+N)
//   a hero                          "h:<id>": alone
//   everything else                 "a:<settlement>:<class>": by Town Center (settlementOf) and class
// Respawned units get new ids, so they rejoin their post's auto regiment (a hero its own). Task forces and
// settlements are already saved, so save / load needs nothing new. Mob regiments (RegimentState) are separate.

export function romanNumeral(n: number): string {
  const table: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) for (; n >= v; n -= v) out += s;
  return out;
}

export function armyRegimentsNow(): ArmyRegimentSnapshot[] {
  // Clans: only the active clan's units, numbered by its own settlements.
  const settlementNumber = new Map(clanTownCenters().map((tc, i) => [resourceKey(tc.x, tc.y), i + 1]));
  const inTaskForce = new Map<string, number>();
  for (const [slot, ids] of state.taskForces) for (const id of ids) inTaskForce.set(id, slot);
  interface Draft { snap: ArmyRegimentSnapshot; members: Colonist[]; pending: number; order: number }
  const drafts = new Map<string, Draft>();
  const draftFor = (id: string, make: () => Omit<Draft, "members" | "pending">): Draft => {
    let d = drafts.get(id);
    if (!d) {
      d = { ...make(), members: [], pending: 0 };
      drafts.set(id, d);
    }
    return d;
  };
  const autoDraft = (key: string, cls: RegimentClass) => {
    const n = settlementNumber.get(key);
    return draftFor(`a:${key}:${cls}`, () => ({
      snap: {
        id: `a:${key}:${cls}`, name: n ? `${REGIMENT_CLASS_LABEL[cls]} ${romanNumeral(n)}` : REGIMENT_CLASS_LABEL[cls],
        unitIds: [], cls, maxCount: 0, hpFrac: 0, ...(n ? { settlement: n } : {}),
      },
      order: 1000 + (n ?? 99) * 20 + REGIMENT_CLASS_ORDER.indexOf(cls),
    }));
  };
  const heroDraft = (id: string, name: string) =>
    draftFor(`h:${id}`, () => ({ snap: { id: `h:${id}`, name, unitIds: [], cls: "hero", maxCount: 0, hpFrac: 0 }, order: 5000 }));

  for (const c of colonists.values()) {
    const cls = REGIMENT_CLASS_OF[c.kind];
    if (!cls || !isCommandable(c) || !inClan(c)) continue;
    const slot = inTaskForce.get(c.id);
    let d: Draft;
    if (slot !== undefined) {
      d = draftFor(`tf${slot}`, () => ({
        snap: { id: `tf${slot}`, name: `Task Force ${slot}`, unitIds: [], cls, maxCount: 0, hpFrac: 0, taskForce: slot },
        order: slot,
      }));
      if (d.snap.cls !== cls) d.snap.cls = "mixed";
    } else if (c.kind === "hero") {
      d = heroDraft(c.id, c.heroName ?? "Hero");
    } else if (c.levyOf) {
      // Forts phase F: a vassal's levy is its own regiment card ("Hearthmoor Levy", id v:<siteId>).
      d = draftFor(`v:${c.levyOf}`, () => ({ snap: { id: `v:${c.levyOf}`, name: levyRegimentName(c), unitIds: [], cls, maxCount: 0, hpFrac: 0 }, order: 4000 }));
      if (d.snap.cls !== cls) d.snap.cls = "mixed";
    } else {
      settlementOf(c);
      d = autoDraft(c.settlementId, cls);
    }
    d.members.push(c);
  }
  // The dead waiting for the dawn respawn count toward the regiment they come back into.
  for (const q of respawnQueue) {
    if ((q.clan ?? clanIdAt(q.tx, q.ty)) !== state.clan.id) continue;
    if (q.hero) {
      heroDraft(q.hero.id, q.hero.name).pending++;
      continue;
    }
    const cls = REGIMENT_CLASS_OF[q.kind];
    if (!cls || (q.kind === "bishop" && state.tiles[tileIndex(q.tx, q.ty)] !== TileType.ChurchPost)) continue;
    autoDraft(settlementKeyNear(q.tx, q.ty), cls).pending++;
  }

  const result: Draft[] = Array.from(drafts.values());
  for (const d of result) {
    const roleCount = new Map<CombatRole, number>();
    let hp = 0;
    let maxHp = 0;
    let dmg = 0;
    for (const c of d.members) {
      d.snap.unitIds.push(c.id);
      hp += Math.max(0, c.hp);
      maxHp += c.maxHp;
      // As playerForceNear counts it (phase 5 strength estimates).
      if (isGuardOrMilitiaKind(c.kind) && c.hp > 0) {
        const stats = unitStats(c);
        dmg += (stats.damage * MOB_ATTACK_COOLDOWN_TICKS) / Math.max(1, stats.cooldown);
      }
      const role = unitRole(c.kind, c.heroClass);
      if (role) roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
    }
    let best = 0;
    for (const [role, n] of roleCount) {
      if (n > best) {
        best = n;
        d.snap.role = role;
      }
    }
    if (!d.snap.role && d.snap.cls === "hero") {
      // A dead hero: its class role, from the respawn entry.
      const q = respawnQueue.find((r) => r.hero && `h:${r.hero.id}` === d.snap.id);
      if (q?.hero) d.snap.role = HERO_CLASS_ROLE[q.hero.heroClass];
    }
    d.snap.hpFrac = maxHp > 0 ? Math.round((hp / maxHp) * 1000) / 1000 : 0;
    if (dmg > 0) d.snap.dmg = Math.round(dmg * 10) / 10;
    // Phase 6: morale (updatePlayerMorale, 1 Hz).
    const ms = playerMorale.get(moraleKey(d.snap.id));
    if (ms?.active) {
      d.snap.morale = Math.round(ms.morale);
      if (ms.routed) d.snap.moraleState = "routing";
      else if (ms.morale < PLAYER_MORALE_WAVER) d.snap.moraleState = "wavering";
      if (ms.outflanked) d.snap.outflanked = true;
    }
    const tf = d.snap.taskForce;
    d.snap.maxCount = tf !== undefined ? Math.max(state.taskForceMax.get(tf) ?? 0, d.members.length) : d.members.length + d.pending;
  }
  result.sort((a, b) => a.order - b.order || a.snap.name.localeCompare(b.snap.name));
  return result.map((d) => d.snap);
}

// Sent when membership / names / max change, else every ARMY_REGIMENT_REFRESH_TICKS (HP drifts in between;
// the client reads live HP from the colonists anyway).
export function armyRegimentsForSnapshot(): ArmyRegimentSnapshot[] | undefined {
  const regiments = armyRegimentsNow();
  const signature = JSON.stringify(regiments.map((r) => [r.id, r.name, r.cls, r.maxCount, r.unitIds, r.moraleState, r.outflanked]));
  state.armyRegimentTicks++;
  if (signature === state.armyRegimentSignature && state.armyRegimentTicks < ARMY_REGIMENT_REFRESH_TICKS) return undefined;
  state.armyRegimentSignature = signature;
  state.armyRegimentTicks = 0;
  return regiments;
}

// Walks an idle (no target) commandable unit back to its rally point; shared by guards and bishops.
// A walkable rally tile is a commanded point (a formation slot): path to that tile, then steer
// straight onto the exact rallyX/rallyY and stop there, so slots keep their exact spacing instead
// of every unit halting wherever it first comes within 1.5 tiles. A solid rally tile is the unit's
// own building (the spawn default): keep the garrison behaviour of loitering within 1.5 tiles of it.
export function returnToRally(c: Colonist, dt: number, speed: number) {
  const rallyTile = { x: c.rallyTileX, y: c.rallyTileY };
  const here = tileOfPixel(c.x, c.y);

  if (!isWalkableTile(rallyTile.x, rallyTile.y)) {
    const rallyCenter = tileToPixelCenter(rallyTile);
    if (Math.hypot(c.x - rallyCenter.x, c.y - rallyCenter.y) <= GARRISON_LOITER_PX) {
      c.path = [];
      c.state = "idle";
      return;
    }
    if (c.path.length === 0) {
      const approach = findAdjacentWalkable(rallyTile.x, rallyTile.y);
      c.path = (approach && findPath(here, approach)) || [];
    }
    if (c.path.length === 0) {
      c.state = "idle";
      return;
    }
    advanceAlongPath(c, dt, speed);
    c.state = "returning";
    return;
  }

  const dist = Math.hypot(c.rallyX - c.x, c.rallyY - c.y);
  if (dist <= RALLY_ARRIVE_PX) {
    c.x = c.rallyX;
    c.y = c.rallyY;
    c.path = [];
    c.state = "idle";
    return;
  }
  // On (or edge-adjacent to) the rally tile: steer straight in (the final leg: a straight line from an
  // edge-adjacent tile to any point in the rally tile stays on those two walkable tiles). A path left
  // over from the march may still lead through this tile's centre, which a squadmate's body can hold
  // the unit off forever (it froze a few px short of its slot).
  // A diagonal neighbour counts too when both tiles between are walkable (the line stays in that 2x2
  // block): otherwise a unit veering round a squadmate (below) on a tile border flipped between path and
  // straight-in modes every tick and never got past.
  const ddx = Math.abs(here.x - rallyTile.x);
  const ddy = Math.abs(here.y - rallyTile.y);
  const nextToRally = ddx + ddy <= 1
    || (ddx === 1 && ddy === 1 && isWalkableTile(here.x, rallyTile.y) && isWalkableTile(rallyTile.x, here.y));
  if (nextToRally) c.path = [];
  if (c.path.length === 0 && !nextToRally) {
    c.path = findPath(here, rallyTile) ?? [];
    if (c.path.length === 0) {
      c.state = "idle";
      return;
    }
  }
  // Already inside the next waypoint's tile: head for the one after. A squadmate idling on its own slot
  // near that tile's centre holds this unit's body further off than the waypoint tolerance, which froze
  // it there for good (a knight stuck 68 px short of its slot). The straight line from anywhere in this
  // tile to the next (edge-adjacent) tile centre stays on those two walkable tiles.
  while (c.path.length > 1 && c.path[0].x === here.x && c.path[0].y === here.y) c.path.shift();
  if (c.path.length > 0) {
    advanceAlongPath(c, dt, speed);
  } else {
    const step = speed * biomeSpeedMultiplier(c.x, c.y) * roadSpeedMultiplier(c.x, c.y) * dt;
    if (dist <= step) {
      c.x = c.rallyX;
      c.y = c.rallyY;
    } else {
      let ux = (c.rallyX - c.x) / dist;
      let uy = (c.rallyY - c.y) / dist;
      // A squadmate idling on its own slot right across this straight line is a wall: separation pushes
      // this unit straight back (the idle one snaps back onto its slot), so it froze 40-70 px short of
      // its slot for good. Veer 45deg to the side away from that body so it slides round it.
      const reach = COLONIST_BODY_RADIUS * 2;
      for (const o of colonists.values()) {
        if (o === c || o.state !== "idle" || !isGuardOrMilitiaKind(o.kind)) continue;
        const ox = o.x - c.x;
        const oy = o.y - c.y;
        const along = ox * ux + oy * uy;
        const across = ux * oy - uy * ox;
        if (along <= 0 || along >= dist || Math.abs(across) >= reach || Math.hypot(ox, oy) > reach + step * 2) continue;
        const side = across > 0 ? -1 : 1;
        const vx = (ux - side * uy) / Math.SQRT2;
        const vy = (uy + side * ux) / Math.SQRT2;
        const to = tileOfPixel(c.x + vx * step, c.y + vy * step);
        if (isWalkableTile(to.x, to.y)) {
          ux = vx;
          uy = vy;
        }
        break;
      }
      c.x += ux * step;
      c.y += uy * step;
    }
  }
  c.state = "returning";
}

export function updateGuardColonist(c: Colonist, dt: number) {
  // Hero phase 4: heroes auto-cast their slotted spells (when Auto is on).
  if (c.kind === "hero") heroAutoCast(c);
  // Creative mode: forced / clan-vs-clan targets (creative.ts).
  if (state.creative && creativeFightStep(c, dt)) return;
  let stats = unitStats(c);
  if (c.kind === "cavalry") trackCharge(c);

  let target = c.targetMobId ? getMobById(c.targetMobId) : undefined;
  if (c.targetMobId && !target) {
    c.targetMobId = null;
    // The chase path leads to where the (now dead/gone) target was; without this the unit would
    // finish walking it before returnToRally plans the route back to its slot.
    c.path = [];
  }
  // Strategy mode phase 3: a retreating unit only fights what corners it (RETREAT_CORNERED_TILES); so
  // does a rider withdrawing between charges (phase 4).
  // Phase 6: so does a routed unit (all the way to the Town Center and while it stands there).
  const routed = isRoutedUnit(c.id);
  const retreating = routed || unitOrderKind(c) === "retreat" || chargeCycle.get(c.id)?.phase === "out";
  if (retreating && target && Math.hypot(target.x - c.x, target.y - c.y) > RETREAT_CORNERED_TILES * TILE_SIZE + stats.range) {
    c.targetMobId = null;
    c.path = [];
    releaseSlot(c.id);
    target = undefined;
  }
  // Phase 4: a catapult on a bombard order shells its point (a commanded target comes first).
  if (c.kind === "catapult" && !(target && commandedTargets.get(c.id) === target.id)) {
    const at = bombardPoint(c);
    if (at && bombardStep(c, at, stats)) return;
  }

  if (!target) {
    if (c.repathCooldown > 0) {
      c.repathCooldown--;
    } else {
      const found = retreating ? corneringMob(c) : pickGuardTarget(c, stats);
      if (found) {
        c.targetMobId = found.id;
        target = found;
      } else {
        c.repathCooldown = retreating ? ORDER_UPDATE_TICKS : MOB_REPATH_TICKS;
      }
    }
  }

  if (!target) {
    // Phase 4, skirmish: a ranged unit backs off from melee within SKIRMISH_KITE_TILES (hold fire too).
    if (c.skirmish && !stats.melee && stats.speed > 0) {
      const threat = nearestMeleeMob(c.x, c.y, SKIRMISH_KITE_TILES * TILE_SIZE);
      if (threat) {
        kiteStep(c, threat, guardLeashTiles(c) * TILE_SIZE, stats.speed, dt);
        c.state = "engaging";
        return;
      }
    }
    // Camp hearths: no enemy in reach (guardians are fought first, picked above), so the hearth.
    if (!retreating && hearthStep(c, stats, dt)) return;
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    returnToRally(c, dt, (squadMarchSpeed.get(c.id) ?? stats.speed) * (routed ? PLAYER_ROUT_SPEED_FACTOR : retreating ? RETREAT_SPEED_FACTOR : 1));
    return;
  }

  // Scale pass: a grown mob (troll / ogre / a big roll) is struck from further out, its bigger body.
  const hitBonus = stats.melee ? mobHitBonus(target) : 0;
  if (hitBonus > 0) stats = { ...stats, range: stats.range + hitBonus };
  const commanded = commandedTargets.get(c.id) === target.id;
  const leashPx = guardLeashTiles(c) * TILE_SIZE;
  // The target has left the zone this unit holds (its slot's leash + attack range): let it go.
  if (!commanded && Math.hypot(target.x - c.rallyX, target.y - c.rallyY) > leashPx + stats.range + TILE_SIZE) {
    dropGuardTarget(c);
    if (stats.speed === 0) c.state = "idle";
    else returnToRally(c, dt, stats.speed);
    return;
  }

  let dist = Math.hypot(target.x - c.x, target.y - c.y);
  // Stickiness with a slot leash: once a second, while not trading blows, switch to an enemy clearly
  // nearer this unit's own slot (the line fights what is in front of each man, not one shared target).
  // A ranged unit switches to any enemy that is within bow range (pickGuardTarget ranks those first).
  if (!commanded && dist > stats.range && state.cycleTick % TICK_RATE === 0) {
    const better = pickGuardTarget(c, stats);
    const cur = Math.hypot(target.x - c.rallyX, target.y - c.rallyY);
    const switchTo = !better || better === target ? false
      : stats.melee ? Math.hypot(better.x - c.rallyX, better.y - c.rallyY) < cur * SLOT_RETARGET_FACTOR
      : Math.hypot(better.x - c.x, better.y - c.y) <= stats.range;
    if (better && switchTo) {
      releaseSlot(c.id);
      c.path = [];
      c.targetMobId = better.id;
      target = better;
      dist = Math.hypot(target.x - c.x, target.y - c.y);
    }
  }
  // Regiments: a ranged unit with a friendly front rank near it holds its rear slot - it fires at what
  // comes into bow range, never walks out toward the enemy line, and kites a step back (toward its slot
  // where that is away from the threat) from an enemy melee unit within RANGED_KITE_TILES. No front
  // rank (archers on their own) or a commanded target: the ordinary behaviour below. Phase 4: a
  // skirmisher does this with or without a front rank, from SKIRMISH_KITE_TILES.
  if (!stats.melee && stats.speed > 0 && !commanded && (c.skirmish || hasFriendlyFrontline(c))) {
    const threat = nearestMeleeMob(c.x, c.y, (c.skirmish ? SKIRMISH_KITE_TILES : RANGED_KITE_TILES) * TILE_SIZE);
    if (threat) {
      kiteStep(c, threat, leashPx, stats.speed, dt);
      dist = Math.hypot(target.x - c.x, target.y - c.y);
    }
    if (dist <= stats.range) {
      if (!threat) c.path = [];
      c.state = "attacking";
      guardStrike(c, target, stats);
    } else if (threat) {
      c.state = "engaging";
    } else {
      returnToRally(c, dt, stats.speed);
    }
    return;
  }
  // Melee fights from a ring slot around the target (see unitSlotPoint); ranged keeps its stand-off.
  const targetR = mobBodyRadius(target);
  const meleeMover = stats.melee && stats.speed > 0;
  const slot = meleeMover
    ? unitSlotPoint(c.id, c.x, c.y, COLONIST_BODY_RADIUS, stats.range, `m:${target.id}`, target.x, target.y, targetR, meleeAttackerCap(targetR))
    : null;
  if (meleeMover && !slot && dist > stats.range) {
    // Queue: the target already has its share of attackers. Uncommanded, give it up and hold this
    // unit's own slot (rescanned after the repath cooldown); commanded, close to a stand-off behind
    // the fighters and wait there for a place to free.
    if (!commanded) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    c.state = "engaging";
    if (dist > stats.range + QUEUE_STANDOFF_PX) approachGoal(c, target, target, stats.speed, dt);
    else c.path = [];
    return;
  }
  if (dist <= stats.range) {
    c.state = "attacking";
    c.path = [];
    // Slide round to the claimed slot while trading blows.
    if (slot && Math.hypot(slot.x - c.x, slot.y - c.y) > 2) stepRaidMobToward(c, slot.x, slot.y, stats.speed * 0.5, dt);
    guardStrike(c, target, stats);
  } else {
    if (stats.speed === 0) {
      c.state = "idle";
      return;
    }
    // Chase leash: only checked while closing on an out-of-range target (an exchange already in
    // attack range above is never interrupted). Past the leash, drop the target and head home this
    // tick; the repath cooldown holds off the next scan for a beat so the unit actually turns back
    // instead of re-acquiring the same target next tick and jittering on the leash edge.
    if (!commanded && Math.hypot(c.x - c.rallyX, c.y - c.rallyY) > leashPx) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    // A Morvain-marked mob slips away once it's past the reduced range guards can track it at.
    if (target.mark === HungerMark.Morvain && dist > STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE * MORVAIN_DETECTION_FACTOR) {
      dropGuardTarget(c);
      returnToRally(c, dt, stats.speed);
      return;
    }
    c.state = "engaging";
    // Within half a tile of strike range, close straight in (then slide round to the slot while fighting,
    // above): a slot on the far side of the target can't be walked to through the attackers already there.
    approachGoal(c, slot && dist > stats.range + SLOT_CLOSE_IN_PX ? slot : target, target, stats.speed, dt);
  }
}

// One blow / arrow at `target` when the cooldown allows.
export function guardStrike(c: Colonist, target: Mob, stats: { damage: number; cooldown: number; melee: boolean }) {
  if (c.attackCooldownTicks > 0) {
    c.attackCooldownTicks--;
    return;
  }
  // Armour & weapons: the weapon tier multiplies every blow (charge x2 etc. stack on top).
  let damage = stats.damage * armyDamageMultiplier(c.postX, c.postY) * weaponDamageMult(c) * spellBuffDamageMult("c:" + c.id) * moraleDamageMult(c);
  if ((c.weaponTier ?? 0) > 0) equipEvent({ type: "hit", id: c.id, tier: c.weaponTier, amount: damage, detail: String(damage / weaponDamageMult(c)) });
  // Cavalry & siege: the catapult lobs a splashing boulder (never inside its minimum range), the ram
  // barely scratches units, a rider's charge doubles its first blow.
  if (c.kind === "catapult") {
    if (Math.hypot(target.x - c.x, target.y - c.y) < CATAPULT_MIN_RANGE) return;
    catapultImpact(c.x, c.y, target.x, target.y, damage, "colony", "c:" + c.id);
    c.attackCooldownTicks = stats.cooldown;
    if (target.hp <= 0) c.targetMobId = null;
    return;
  }
  if (c.kind === "batteringRam") {
    damage *= RAM_UNIT_MULT;
    siegeEvent("ramHit", c.id, damage, "unit");
  }
  if (c.kind === "cavalry") {
    const mult = takeChargeBonus(c);
    if (mult > 1) siegeEvent("charge", c.id, damage * mult);
    else siegeEvent("hit", c.id, damage);
    damage *= mult;
  }
  if (c.kind === "hero") heroTestEvent({ type: "hit", id: c.id, amount: damage, detail: target.id });
  damageMob(target, damage, "c:" + c.id);
  c.attackCooldownTicks = stats.cooldown;
  state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: target.x, toY: target.y, melee: stats.melee });
  if (target.hp <= 0) c.targetMobId = null;
}

// Regiments: the combat role of a soldier (COLONIST_ROLE) or a mob (MOB_ROLE, corrected by the mob's
// own melee flag: a deserter takes its stats from the colonist it was).
export function colonistRole(c: Colonist): CombatRole | undefined {
  return unitRole(c.kind, c.heroClass);
}
// isRearRole for a unit (the catapult is a rear siege role, the ram a front one).
export function isRearColonist(c: Colonist): boolean {
  return isRearRole(colonistRole(c) ?? "frontline", c.kind);
}
export function isRearMob(m: Mob): boolean {
  return isRearRole(mobRole(m), m.kind);
}
export function mobRole(m: Mob): CombatRole {
  const role = MOB_ROLE[m.kind] ?? "frontline";
  if (role === "siege") return role;
  if (!m.melee) return isRearRole(role) ? role : "ranged";
  return isRearRole(role) ? "frontline" : role;
}

// True while a friendly front-rank soldier (any non-rear role) stands within ARCHER_FRONT_RANK_SCAN_TILES
// of the ranged soldier `c`: then `c` holds the rear (see updateGuardColonist).
export function hasFriendlyFrontline(c: Colonist): boolean {
  const scanPx = ARCHER_FRONT_RANK_SCAN_TILES * TILE_SIZE;
  for (const o of colonists.values()) {
    if (o === c) continue;
    const role = colonistRole(o);
    if (!role || isRearColonist(o)) continue;
    if (Math.abs(o.x - c.x) <= scanPx && Math.abs(o.y - c.y) <= scanPx) return true;
  }
  return false;
}

// The nearest awake melee mob within radiusPx of (x, y), or null.
export function nearestMeleeMob(x: number, y: number, radiusPx: number): Mob | null {
  let best: Mob | null = null;
  let bestD = radiusPx;
  for (const m of mobs.values()) {
    if (!m.melee || m.passive || isDormantGuardian(m)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

// The nearest guard / militia melee soldier within radiusPx of (x, y), or null (a ranged mob's kite threat).
export function nearestMeleeSoldier(x: number, y: number, radiusPx: number): Colonist | null {
  let best: Colonist | null = null;
  let bestD = radiusPx;
  for (const c of colonists.values()) {
    const role = colonistRole(c);
    if (!role || isRearColonist(c)) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// One kite step for a ranged soldier: back onto its rear slot when that lies further from the threat,
// otherwise a tile straight away from it (never past its leash from the slot).
export function kiteStep(c: Colonist, threat: { x: number; y: number }, leashPx: number, speed: number, dt: number) {
  c.path = [];
  const dThreat = Math.hypot(threat.x - c.x, threat.y - c.y) || 1;
  const toSlot = Math.hypot(c.rallyX - c.x, c.rallyY - c.y);
  if (toSlot > RALLY_ARRIVE_PX && Math.hypot(c.rallyX - threat.x, c.rallyY - threat.y) > dThreat) {
    stepRaidMobToward(c, c.rallyX, c.rallyY, speed, dt);
    return;
  }
  const ax = c.x + ((c.x - threat.x) / dThreat) * TILE_SIZE;
  const ay = c.y + ((c.y - threat.y) / dThreat) * TILE_SIZE;
  if (Math.hypot(ax - c.rallyX, ay - c.rallyY) <= leashPx) stepRaidMobToward(c, ax, ay, speed, dt);
}

// True when the mob is fighting a front-rank soldier (a ranged unit's preferred target).
export function engagedWithFrontline(m: Mob): boolean {
  if (m.targetType !== "colonist" || !m.targetId) return false;
  const c = colonists.get(m.targetId);
  const role = c ? colonistRole(c) : undefined;
  return !!c && !!role && !isRearColonist(c);
}
export function updateSquadMarch() {
  squadMarchSpeed.clear();
  const squads = new Map<string, Colonist[]>();
  for (const c of colonists.values()) {
    if (!c.squadId || c.targetMobId || !isGuardOrMilitiaKind(c.kind)) continue;
    const list = squads.get(c.squadId);
    if (list) list.push(c);
    else squads.set(c.squadId, [c]);
  }
  for (const members of squads.values()) {
    if (members.length < 2) continue;
    let pcx = 0, pcy = 0, rcx = 0, rcy = 0;
    let pace = Infinity;
    for (const m of members) {
      pcx += m.x; pcy += m.y; rcx += m.rallyX; rcy += m.rallyY;
      pace = Math.min(pace, unitStats(m).speed);
    }
    const n = members.length;
    pcx /= n; pcy /= n; rcx /= n; rcy /= n;
    const togo = Math.hypot(rcx - pcx, rcy - pcy);
    if (togo <= SQUAD_SETTLE_TILES * TILE_SIZE || pace <= 0) continue;
    const dx = (rcx - pcx) / togo;
    const dy = (rcy - pcy) / togo;
    // Lead: how far along the march direction a member is ahead of its own place in the formation.
    const leads = members.map((m) => (m.x - pcx - (m.rallyX - rcx)) * dx + (m.y - pcy - (m.rallyY - rcy)) * dy);
    const broken = leads.some((l) => Math.abs(l) > SQUAD_BROKEN_TILES * TILE_SIZE);
    const tol = SQUAD_LEAD_TOLERANCE_TILES * TILE_SIZE;
    members.forEach((m, i) => {
      const own = unitStats(m).speed;
      const lead = leads[i];
      squadMarchSpeed.set(m.id, lead < -tol ? own : lead > tol && !broken ? pace * SQUAD_AHEAD_SPEED_FACTOR : pace);
    });
  }
}

// The enemy a soldier should take on: within its alert range (from where it stands) and within its
// slot's reach (leash + attack range of the rally point - anything further it would only walk out to,
// give up on and re-acquire forever, e.g. a dormant POI guardian), NEAREST TO ITS SLOT. A melee soldier
// skips enemies that already have their share of attackers (meleeAttackerCap), so a line spreads over
// the enemies in front of it; with none left it holds its slot (the queue).
export function pickGuardTarget(c: Colonist, stats: { range: number; melee: boolean; speed: number }): Mob | null {
  // Phase 4, hold fire: a ranged unit / catapult only shoots a commanded target; a catapult on a bombard
  // order only its point.
  if (!stats.melee && (c.holdFire || (c.kind === "catapult" && bombardPoint(c)))) return null;
  // A catapult sees as far as it throws; a ram only takes on what is right next to it.
  const alertPx = c.kind === "batteringRam" ? stats.range + COLONIST_BODY_RADIUS * 2
    : Math.max(STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE, c.kind === "catapult" ? stats.range : 0);
  const reachPx = guardLeashTiles(c) * TILE_SIZE + stats.range;
  const queues = stats.melee && stats.speed > 0;
  // Regiments: a ranged soldier behind a front rank ranks enemies already in bow range first (those
  // fighting a front-rank soldier before the rest, nearest to the archer first), then the slot rule.
  const rearRank = !stats.melee && hasFriendlyFrontline(c);
  let best: Mob | null = null;
  let bestDist = Infinity;
  for (const m of mobs.values()) {
    const du = Math.hypot(m.x - c.x, m.y - c.y);
    if (du > (m.mark === HungerMark.Morvain ? alertPx * MORVAIN_DETECTION_FACTOR : alertPx)) continue;
    // Monster tactics, pursuit safety: a routed / leaving mob is only fought within attack range, never
    // chased, so a broken enemy doesn't pull the line apart.
    if ((m.tactic === "rout" || m.tactic === "leave") && du > stats.range) continue;
    const ds = Math.hypot(m.x - c.rallyX, m.y - c.rallyY);
    if (ds > reachPx) continue;
    // Forts phase F: never a neutral settlement's own folk (a vassal's levy marches out among them).
    if (m.siteId !== null && siteIdNeutral(m.siteId)) continue;
    if (isSleepingNeutral(m)) continue;
    const score = rearRank && du <= stats.range ? du - (engagedWithFrontline(m) ? 2e6 : 1e6) : ds;
    if (score >= bestDist) continue;
    if (queues && !targetHasRoom(c.id, `m:${m.id}`, meleeAttackerCap(mobBodyRadius(m)))) continue;
    best = m;
    bestDist = score;
  }
  return best;
}

// The slot leash (LINE_LEASH_TILES by stance; a regiment on a Hold order: HOLD_LEASH_TILES; a ranged
// skirmisher: at least SKIRMISH_DRIFT_TILES, the room it kites in).
export function guardLeashTiles(c: Colonist): number {
  if (unitOrderKind(c) === "hold") return HOLD_LEASH_TILES;
  if (c.skirmish && !unitStats(c).melee) return Math.max(LINE_LEASH_TILES[c.stance], SKIRMISH_DRIFT_TILES);
  return LINE_LEASH_TILES[c.stance];
}

// A retreating unit's only target: an awake enemy within RETREAT_CORNERED_TILES of it.
export function corneringMob(c: Colonist): Mob | null {
  let best: Mob | null = null;
  let bestD = RETREAT_CORNERED_TILES * TILE_SIZE;
  for (const m of mobs.values()) {
    if (m.passive || isDormantGuardian(m)) continue;
    const d = Math.hypot(m.x - c.x, m.y - c.y);
    if (d <= bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

export function dropGuardTarget(c: Colonist) {
  c.targetMobId = null;
  c.path = [];
  c.repathCooldown = MOB_REPATH_TICKS;
  releaseSlot(c.id);
}

export function findNearestInjured(
  fromX: number,
  fromY: number,
  maxRangeTiles: number,
  excludeId: string
): { kind: "player" | "colonist"; id: string; x: number; y: number } | null {
  let best: { kind: "player" | "colonist"; id: string; x: number; y: number } | null = null;
  let bestDist = Infinity;
  const maxRangePx = maxRangeTiles * TILE_SIZE;
  for (const p of players.values()) {
    if (p.hp >= playerMaxHp(p) || p.dead) continue;
    const d = Math.hypot(p.x - fromX, p.y - fromY);
    if (d <= maxRangePx && d < bestDist) {
      bestDist = d;
      best = { kind: "player", id: p.id, x: p.x, y: p.y };
    }
  }
  for (const c of colonists.values()) {
    if (c.id === excludeId) continue;
    if (c.hp >= c.maxHp) continue;
    const d = Math.hypot(c.x - fromX, c.y - fromY);
    if (d <= maxRangePx && d < bestDist) {
      bestDist = d;
      best = { kind: "colonist", id: c.id, x: c.x, y: c.y };
    }
  }
  return best;
}

export function healAmountFor(churchX: number, churchY: number): number {
  const level = getBuildingLevel(churchX, churchY);
  return Math.round(BISHOP_HEAL_AMOUNT * (1 + (level - 1) * CHURCH_HEAL_BONUS_PER_STEP));
}

export function updateBishopColonist(c: Colonist, dt: number) {
  let targetPos: { x: number; y: number } | null = null;

  if (c.healTargetType === "player" && c.healTargetId) {
    const p = players.get(c.healTargetId);
    if (p && p.hp < playerMaxHp(p)) targetPos = { x: p.x, y: p.y };
  } else if (c.healTargetType === "colonist" && c.healTargetId) {
    const other = colonists.get(c.healTargetId);
    if (other && other.hp < other.maxHp) targetPos = { x: other.x, y: other.y };
  }

  if (!targetPos) {
    // Same as guards: a route toward a healed/gone patient is stale once they no longer need it.
    if (c.healTargetId) c.path = [];
    c.healTargetType = null;
    c.healTargetId = null;
    const found = findNearestInjured(c.x, c.y, GUARD_ALERT_RANGE_TILES, c.id);
    if (found) {
      c.healTargetType = found.kind;
      c.healTargetId = found.id;
      targetPos = { x: found.x, y: found.y };
    }
  }

  if (!targetPos) {
    // Rally starts as the church (same loiter-by-the-post behaviour as before) and becomes the
    // bishop's formation slot after a move order; this used to ignore the rally and walk home.
    returnToRally(c, dt, BISHOP_SPEED);
    return;
  }

  const dist = Math.hypot(targetPos.x - c.x, targetPos.y - c.y);
  if (dist <= BISHOP_HEAL_RANGE) {
    c.state = "healing";
    c.path = [];
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
    } else {
      c.attackCooldownTicks = BISHOP_HEAL_COOLDOWN_TICKS;
      const amount = healAmountFor(c.postX, c.postY);
      if (c.healTargetType === "player" && c.healTargetId) {
        const p = players.get(c.healTargetId);
        if (p) p.hp = Math.min(playerMaxHp(p), p.hp + amount);
      } else if (c.healTargetType === "colonist" && c.healTargetId) {
        const other = colonists.get(c.healTargetId);
        if (other) other.hp = Math.min(other.maxHp, other.hp + amount);
      }
    }
  } else {
    c.state = "approaching";
    if (c.path.length === 0 && c.repathCooldown <= 0) {
      const start = tileOfPixel(c.x, c.y);
      const goalTile = tileOfPixel(targetPos.x, targetPos.y);
      const path = findPath(start, goalTile);
      if (path === null) {
        c.healTargetType = null;
        c.healTargetId = null;
        c.repathCooldown = MOB_REPATH_TICKS;
        return;
      }
      c.path = path;
      c.repathCooldown = MOB_REPATH_TICKS;
    } else if (c.repathCooldown > 0) {
      c.repathCooldown--;
    }
    advanceAlongPath(c, dt, BISHOP_SPEED);
  }
}
