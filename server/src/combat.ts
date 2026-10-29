// combat.ts: Damage (mobs, players, colonists, buildings), engagement slots, attack effects, player attacks, walls & gates, towers.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import {
  TILE_SIZE, HungerMark, TileType, isSolidTile, PLAYER_HALF_SIZE, TICK_RATE, GATE_FLAG_OPEN, GATE_FLAG_LOCK_OPEN,
  GATE_FLAG_LOCK_CLOSED, GATE_FLAG_OVERRUN, GATE_FLAG_FOREIGN,
} from "@colony/shared/protocol";
import type { Colonist, Cost, GateState, Mob, Player, TileCoord, TownCenter, Wildlife } from "./types.js";
import {
  BIG_BUILD_TILES, BREACH_HP_PER_TILE, BREACH_TOWER_PENALTY_TILES, BREAKABLE_TILES, BUILDING_HP_BIG,
  BUILDING_HP_GATE, BUILDING_HP_LEVEL_MULT, BUILDING_HP_SMALL, BUILDING_HP_STONE_WALL, BUILDING_HP_WALL,
  BUILDING_HP_WORKPLACE, BUILDING_NAMES, FORAGE_TILES, GATE_CLOSE_DELAY_TICKS, GATE_OPEN_RANGE_PX,
  GATE_OVERRUN_RANGE_TILES, GATE_TOWER_RANGE_TILES, GOBLIN_RIDER_DAMAGE_TAKEN, GORRATH_FURY_DAMAGE_TAKEN,
  GORRATH_FURY_HP_FRACTION, GORRATH_FURY_TICKS, MOB_REPATH_TICKS, PLAYER_ATTACK_RANGE, RING_8, TOWER_COSTS,
  TOWER_STATS,
} from "./constants.js";
import {
  attackerSlots, buildingHp, chargeRuns, colonists, gates, gravestones, hearths, mobs, mobsWithoutRoute, players,
  raidGroups, slotClaims, state, summonedUntil, towerCooldowns, towerEvents, wildlife,
} from "./state.js";
import {
  getBuildingLevel, inBounds, isHostileOwner, ownerAt, resourceKey, setOwner, siteNumber, tileIndex, tileOfPixel,
  tileToPixelCenter,
} from "./tiles.js";
import { advanceAlongPath, findPath, isWalkableTile } from "./pathfinding.js";
import { releaseResourceReservation, stock } from "./economy.js";
import { onBossKilled } from "./worldgen.js";
import { WILDLIFE_CONFIG, damageWildlife, isWalkablePixel } from "./wildlife.js";
import {
  findTownCenterAt, isHouseTile, isWardPriest, queueRespawn, spawnPointNearTownCenter, townCenterMaxHp,
} from "./colonists.js";
import { isGuardOrMilitiaKind, isSiegeKind } from "./units.js";
import { activateGuardianSite, goldForKill, isDormantGuardian, keyToTile } from "./mobs.js";
import {
  currentBuildingLevel, demolishTile, destroyTownCenter, syncGuardBonusesAround, tryLevelUpInPlace,
} from "./construction.js";
import { notePlayerCasualty, noteRegimentCasualty } from "./tactics.js";
import { engageRaidGroup, stepRaidMobToward } from "./raids.js";
import { damageHearth } from "./hearths.js";
import {
  armourDamageTakenMult, dropEquipmentFor, equipEvent, heroEvent, heroKey, heroProfileFor, heroProfileOf,
  heroRespawnFee, heroRewardsForKill, playerAttackCooldownTicks, playerDamage, playerMaxHp,
} from "./heroes.js";
import { absorbWithWard, isSummoned, spellDamageTakenMult } from "./spells.js";
import { broadcastEvent, broadcastTileUpdate, recordFightHit } from "./net.js";

export function getMobById(id: string): Mob | undefined {
  return mobs.get(id);
}

export function releaseSlot(attackerId: string) {
  const claim = attackerSlots.get(attackerId);
  if (!claim) return;
  attackerSlots.delete(attackerId);
  const claims = slotClaims.get(claim.key);
  if (claims && claims.get(claim.slot) === attackerId) {
    claims.delete(claim.slot);
    if (claims.size === 0) slotClaims.delete(claim.key);
  }
}

// How many melee attackers may fight one unit target at once, by its body radius: 3 on a soldier-sized
// body, 4 on an orc-sized one, 6 on a troll / ogre.
export function meleeAttackerCap(targetRadius: number): number {
  return targetRadius >= 12 ? 6 : targetRadius >= 9 ? 4 : 3;
}

// True when `attackerId` already fights `key` from a slot, or `key` has fewer than `cap` attackers.
export function targetHasRoom(attackerId: string, key: string, cap: number): boolean {
  const held = attackerSlots.get(attackerId);
  if (held && held.key === key) return true;
  return (slotClaims.get(key)?.size ?? 0) < cap;
}

// Keeps the attacker's slot on `key` while it is still usable (finite score), else claims the free
// slot with the lowest score. -1 when every usable slot is taken, or `cap` attackers already hold one
// (the attacker then queues: see updateGuardColonist / updateMob).
export function claimSlot(attackerId: string, key: string, count: number, score: (slot: number) => number, cap = Infinity): number {
  const held = attackerSlots.get(attackerId);
  if (held && held.key === key && held.slot < count && score(held.slot) !== Infinity) return held.slot;
  releaseSlot(attackerId);
  let claims = slotClaims.get(key);
  if ((claims?.size ?? 0) >= cap) return -1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < count; i++) {
    if (claims?.has(i)) continue;
    const s = score(i);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  if (best < 0) return -1;
  if (!claims) {
    claims = new Map();
    slotClaims.set(key, claims);
  }
  claims.set(best, attackerId);
  attackerSlots.set(attackerId, { key, slot: best });
  return best;
}

export function mobSlotKey(mob: Mob): string | null {
  if (!mob.targetType || mob.targetId === null) return null;
  if (mob.targetType === "colonist") return `c:${mob.targetId}`;
  if (mob.targetType === "player") return `p:${mob.targetId}`;
  return `b:${mob.targetId}`;
}

// Once a second: frees slots of dead attackers and of attackers that have moved on to another target.
export function pruneSlotClaims() {
  for (const [id, claim] of attackerSlots) {
    const mob = mobs.get(id);
    const c = mob ? undefined : colonists.get(id);
    const current = mob ? (mob.melee ? mobSlotKey(mob) : null) : c && c.targetMobId ? `m:${c.targetMobId}` : null;
    if (current !== claim.key) releaseSlot(id);
  }
}

// The point a melee attacker (at ax, ay, body ar, attack range `range`) should fight `key` from: a ring
// slot around the target at (tx, ty) with body radius tr. null: no free slot (or `cap` reached).
export function unitSlotPoint(
  attackerId: string, ax: number, ay: number, ar: number, range: number,
  key: string, tx: number, ty: number, tr: number, cap = Infinity
): { x: number; y: number } | null {
  const n = tr >= 12 ? 10 : tr >= 9 ? 8 : 6;
  const radius = Math.min(range - 0.5, Math.max(range * 0.9, tr + ar + 1));
  const a0 = Math.atan2(ay - ty, ax - tx);
  const point = (i: number) => {
    const a = (2 * Math.PI * i) / n;
    return { x: tx + Math.cos(a) * radius, y: ty + Math.sin(a) * radius };
  };
  const slot = claimSlot(attackerId, key, n, (i) => {
    const p = point(i);
    if (!isWalkablePixel(p.x, p.y)) return Infinity;
    const da = Math.abs(((((2 * Math.PI * i) / n - a0) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    return da;
  }, cap);
  return slot < 0 ? null : point(slot);
}

// The ring tile a mob attacks building (bx, by) from: the walkable strip of the building's 8-ring that
// contains `approach` (so it is reachable), nearest free tile first. null without an approach tile.
export function buildingSlotTile(mob: Mob, key: string, bx: number, by: number, approach: TileCoord | null): TileCoord | null {
  if (!approach) return null;
  const start = RING_8.findIndex(([dx, dy]) => bx + dx === approach.x && by + dy === approach.y);
  if (start < 0) return approach;
  const reachable = new Array<boolean>(8).fill(false);
  reachable[start] = true;
  for (const dir of [1, 7]) {
    for (let k = 1; k < 8; k++) {
      const i = (start + dir * k) % 8;
      if (!isWalkableTile(bx + RING_8[i][0], by + RING_8[i][1])) break;
      reachable[i] = true;
    }
  }
  const slot = claimSlot(mob.id, key, 8, (i) => {
    if (!reachable[i]) return Infinity;
    const c = tileToPixelCenter({ x: bx + RING_8[i][0], y: by + RING_8[i][1] });
    return Math.hypot(c.x - mob.x, c.y - mob.y);
  });
  return slot < 0 ? approach : { x: bx + RING_8[slot][0], y: by + RING_8[slot][1] };
}

// Moves a melee attacker toward `goal` (its slot, or the target itself) when out of attack range:
// close in straight once within 1.5 tiles, otherwise follow a path to the goal's tile (rate-limited).
export function approachGoal(
  e: { x: number; y: number; path: TileCoord[]; repathCooldown: number },
  goal: { x: number; y: number },
  fallback: { x: number; y: number },
  speed: number,
  dt: number
) {
  if (Math.hypot(goal.x - e.x, goal.y - e.y) <= TILE_SIZE * 1.5) {
    e.path = [];
    if (stepRaidMobToward(e, goal.x, goal.y, speed, dt)) return;
    goal = fallback;
  }
  if (e.path.length === 0 && e.repathCooldown <= 0) {
    const goalTile = isWalkablePixel(goal.x, goal.y) ? tileOfPixel(goal.x, goal.y) : tileOfPixel(fallback.x, fallback.y);
    e.path = findPath(tileOfPixel(e.x, e.y), goalTile) ?? [];
    e.repathCooldown = MOB_REPATH_TICKS;
  } else if (e.repathCooldown > 0) {
    e.repathCooldown--;
  }
  advanceAlongPath(e, dt, speed);
}

// attackerKey ("p:<playerId>" / "c:<colonistId>") marks a blow for the fight notifiers; blows without
// one (test hooks, untracked sources) aren't counted as fighting.
export function damageMob(mob: Mob, amount: number, attackerKey?: string) {
  if (attackerKey) recordFightHit(mob, mob.x, mob.y, attackerKey, amount);
  if (isDormantGuardian(mob)) activateGuardianSite(mob.siteId!);
  // Hitting any member of a raid group (passive or marching) turns the whole group on its attackers.
  if (mob.groupId !== null) {
    const group = raidGroups.get(mob.groupId);
    if (group) engageRaidGroup(group);
  }
  // Hero phase 4: a cursed mob takes more from every source.
  amount *= spellDamageTakenMult(mob);
  // Goblin wolf riders: pikemen / spearmen are their bane.
  if (mob.kind === "goblinRider" && attackerKey?.startsWith("c:")) {
    const by = colonists.get(attackerKey.slice(2));
    amount *= (by && GOBLIN_RIDER_DAMAGE_TAKEN[by.kind]) || 1;
  }
  mob.hp -= mob.mark === HungerMark.Gorrath && state.cycleTick < mob.furyUntilTick ? amount * GORRATH_FURY_DAMAGE_TAKEN : amount;
  mob.lastDamagedTick = state.cycleTick;
  // Gorrath's frenzy: the first lethal blow is shrugged off into a short wounded fury.
  if (mob.hp <= 0 && mob.mark === HungerMark.Gorrath && mob.furyUntilTick === 0) {
    mob.hp = Math.max(1, Math.round(mob.maxHp * GORRATH_FURY_HP_FRACTION));
    mob.furyUntilTick = state.cycleTick + GORRATH_FURY_TICKS;
  }
  if (mob.hp <= 0) {
    gravestones.push({ x: mob.x, y: mob.y, variant: Math.random() < 0.5 ? 0 : 1 });
    mobs.delete(mob.id);
    chargeRuns.delete(mob.id);
    noteRegimentCasualty(mob);
    stock.gold += goldForKill(mob);
    dropEquipmentFor(mob);
    heroRewardsForKill(mob, attackerKey);
    if (mob.boss) onBossKilled(mob);
  }
}

// A killed player respawns at the standing Town Center nearest where they fell. With none standing
// they stay dead (game over for them) until someone builds one: see respawnDeadPlayers.
export function damagePlayer(player: Player, amount: number) {
  if (player.dead) return;
  // Hero gear: every blow / poison tick the player takes is scaled (equipment survives death).
  const mult = heroProfileOf(player).stats.damageTakenMult;
  if (mult !== 1) heroEvent({ type: "taken", key: player.profileKey, amount: amount * mult, detail: String(amount) });
  // Hero phase 4: a ward shield soaks it first.
  player.hp -= absorbWithWard("p:" + player.id, amount * mult);
  if (player.hp <= 0) {
    player.poisonTicksRemaining = 0;
    if (state.townCenters.length > 0) {
      player.hp = playerMaxHp(player);
      const spawn = spawnPointNearTownCenter(player);
      player.x = spawn.x;
      player.y = spawn.y;
    } else {
      player.hp = 0;
      player.dead = true;
      player.input = { dx: 0, dy: 0 };
      broadcastEvent("death", "A rider has fallen, and no Town Center stands to rise again at");
    }
  }
}

export function respawnDeadPlayers() {
  if (state.townCenters.length === 0) return;
  for (const p of players.values()) {
    if (!p.dead) continue;
    p.dead = false;
    p.hp = playerMaxHp(p);
    const spawn = spawnPointNearTownCenter(p);
    p.x = spawn.x;
    p.y = spawn.y;
  }
}

export function colonistDeathText(c: Colonist): string {
  if (isWardPriest(c)) return "The Ward Priest has died";
  if (c.kind === "hero") return `${c.heroName ?? "A hero"} has fallen: back at the next dawn or dusk for ${heroRespawnFee(c.id)} gold`;
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  return `${/^[aeiou]/.test(name) ? "An" : "A"} ${name} has died`;
}

export function damageColonist(colonist: Colonist, amount: number) {
  // Armour & weapons: armour scales every blow taken (max HP is unchanged).
  if ((colonist.armourTier ?? 0) > 0) {
    const raw = amount;
    amount *= armourDamageTakenMult(colonist);
    equipEvent({ type: "taken", id: colonist.id, tier: colonist.armourTier, amount, detail: String(raw) });
  }
  // Hero phase 3: a hero's own gear + level (the same HeroStats as the player).
  if (colonist.kind === "hero") amount *= heroProfileFor(heroKey(colonist.id)).stats.damageTakenMult;
  // Hero phase 4: a ward shield soaks it first.
  colonist.hp -= absorbWithWard("c:" + colonist.id, amount);
  if (colonist.hp <= 0 && isSummoned(colonist)) {
    // A summoned skeleton crumbles: no grave, toast or respawn.
    summonedUntil.delete(colonist.id);
    releaseResourceReservation(colonist);
    colonists.delete(colonist.id);
    return;
  }
  if (colonist.hp <= 0) {
    gravestones.push({ x: colonist.x, y: colonist.y, variant: Math.random() < 0.5 ? 0 : 1 });
    broadcastEvent("death", colonistDeathText(colonist));
    notePlayerCasualty(colonist);
    releaseResourceReservation(colonist);
    // Siege engines are rebuilt at their workshop, never respawned.
    if (!isWardPriest(colonist) && !isSiegeKind(colonist.kind)) queueRespawn(colonist);
    colonists.delete(colonist.id);
    chargeRuns.delete(colonist.id);
    if (colonist.kind === "hero") state.heroRosterVersion++;
  }
}

export function handlePlayerAttack(attacker: Player) {
  if (attacker.dead || attacker.attackCooldownTicks > 0) return;
  attacker.attackCooldownTicks = playerAttackCooldownTicks(attacker);
  const damage = playerDamage(attacker);

  let bestType: "player" | "mob" | null = null;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const p of players.values()) {
    if (p.id === attacker.id || p.dead) continue;
    const d = Math.hypot(p.x - attacker.x, p.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestType = "player";
      bestId = p.id;
    }
  }
  for (const m of mobs.values()) {
    const d = Math.hypot(m.x - attacker.x, m.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestType = "mob";
      bestId = m.id;
    }
  }

  let bestAnimal: Wildlife | null = null;
  for (const a of wildlife.values()) {
    const d = Math.hypot(a.x - attacker.x, a.y - attacker.y);
    if (d <= PLAYER_ATTACK_RANGE && d < bestDist) {
      bestDist = d;
      bestAnimal = a;
    }
  }
  if (bestAnimal) {
    // A player's kill is dressed on the spot: the meat goes straight to the stockpile.
    state.pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: bestAnimal.x, toY: bestAnimal.y, melee: true });
    const meat = WILDLIFE_CONFIG[bestAnimal.kind].meat;
    if (damageWildlife(bestAnimal, damage, attacker.x, attacker.y, null)) stock.meat += meat;
    return;
  }

  if (!bestType || !bestId) {
    // Camp hearths: with nothing else in reach, the player can strike a hearth next to them.
    for (const h of hearths.values()) {
      if (h.destroyed) continue;
      const p = tileToPixelCenter(h);
      if (Math.hypot(p.x - attacker.x, p.y - attacker.y) > PLAYER_ATTACK_RANGE + TILE_SIZE / 2) continue;
      state.pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: p.x, toY: p.y, melee: true });
      damageHearth(h, damage, "p:" + attacker.id);
      return;
    }
    return;
  }
  if (bestType === "player") {
    const target = players.get(bestId);
    if (target) {
      state.pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      damagePlayer(target, damage);
    }
  } else {
    const target = mobs.get(bestId);
    if (target) {
      state.pendingEffects.push({ fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, melee: true });
      heroEvent({ type: "hit", key: attacker.profileKey, amount: damage, detail: target.id });
      damageMob(target, damage, "p:" + attacker.id);
    }
  }
}

export function damageTownCenter(tc: TownCenter, amount: number) {
  tc.hp -= amount;
  if (tc.hp <= 0) destroyTownCenter(tc);
}

export function isWallTile(t: TileType): boolean {
  return t === TileType.Wall || t === TileType.StoneWall;
}
export function isDamageableBuilding(t: TileType): boolean {
  if (!state.damageableLut) {
    state.damageableLut = new Uint8Array(256);
    for (const b of BREAKABLE_TILES) {
      if (b !== TileType.ConstructionSite && isSolidTile(b) && !FORAGE_TILES.includes(b)) state.damageableLut[b] = 1;
    }
    // Gates aren't solid tiles (their passability is gate state) but take damage like a wall.
    state.damageableLut[TileType.Gate] = 1;
  }
  return state.damageableLut[t] === 1;
}

export function buildingBaseHp(t: TileType): number {
  if (t === TileType.Wall) return BUILDING_HP_WALL;
  if (t === TileType.StoneWall) return BUILDING_HP_STONE_WALL;
  if (t === TileType.Gate) return BUILDING_HP_GATE;
  if (
    BIG_BUILD_TILES.has(t) || t === TileType.CastleLevel2 || t === TileType.CastleLevel3 || t === TileType.Stables ||
    isTowerTile(t) || t === TileType.MilitiaCamp3
  )
    return BUILDING_HP_BIG;
  if (isHouseTile(t) || t === TileType.HunterHut || t === TileType.ForagerHut || t === TileType.ArcherPost) return BUILDING_HP_SMALL;
  return BUILDING_HP_WORKPLACE;
}

export function buildingMaxHp(tx: number, ty: number, t: TileType): number {
  const level = Math.min(Math.max(currentBuildingLevel(tx, ty, t), 1), 3);
  return Math.round(buildingBaseHp(t) * BUILDING_HP_LEVEL_MULT[level - 1]);
}

// HP of the building / Town Center at a tile (null: nothing damageable there).
export function structureHp(tx: number, ty: number): { hp: number; max: number } | null {
  if (!inBounds(tx, ty)) return null;
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  if (t === TileType.TownCenter) {
    const tc = findTownCenterAt(tx, ty);
    return tc ? { hp: Math.max(0, tc.hp), max: townCenterMaxHp(tc.level) } : null;
  }
  if (!isDamageableBuilding(t)) return null;
  const max = buildingMaxHp(tx, ty, t);
  return { hp: Math.min(max, buildingHp.get(resourceKey(tx, ty)) ?? max), max };
}

export function healStructure(tx: number, ty: number, amount: number) {
  const key = resourceKey(tx, ty);
  const tc = findTownCenterAt(tx, ty);
  if (tc && state.tiles[tileIndex(tx, ty)] === TileType.TownCenter) {
    tc.hp = Math.min(townCenterMaxHp(tc.level), tc.hp + amount);
    return;
  }
  const s = structureHp(tx, ty);
  if (!s) return;
  if (s.hp + amount >= s.max) buildingHp.delete(key);
  else buildingHp.set(key, s.hp + amount);
}

// Mob damage to the building (or Town Center) at a tile; at 0 HP it is destroyed.
export function damageBuilding(tx: number, ty: number, amount: number) {
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  if (t === TileType.TownCenter) {
    const tc = findTownCenterAt(tx, ty);
    if (tc) damageTownCenter(tc, amount);
    return;
  }
  const s = structureHp(tx, ty);
  if (!s) return;
  const hp = s.hp - amount;
  if (hp > 0) {
    buildingHp.set(resourceKey(tx, ty), hp);
    return;
  }
  // Destroyed: the same clean-up as a player demolishing it (posted workers, level, site, HP).
  const index = tileIndex(tx, ty);
  const owner = ownerAt(index);
  demolishTile(tx, ty, t);
  if (owner !== 0) {
    // Forts phase A: an NPC site's wall / gate leaves walkable Rubble (a breach gap); whatever it was,
    // the ground is nobody's now.
    setOwner(index, 0);
    if (isWallTile(t) || t === TileType.Gate) {
      state.tiles[index] = TileType.Rubble;
      broadcastTileUpdate(tx, ty, TileType.Rubble);
    }
  }
  syncGuardBonusesAround(tx, ty);
  broadcastEvent("death", `${BUILDING_NAMES[t] ?? "A building"} destroyed`);
}

// Flattened [tile index, hp permille] per damaged building and Town Center (see damagedBuildings).
export function damagedBuildingsForSnapshot(): number[] {
  const out: number[] = [];
  for (const key of Array.from(buildingHp.keys())) {
    const tile = keyToTile(key);
    const s = tile ? structureHp(tile.x, tile.y) : null;
    // The building is gone (or became something undamageable) some other way: drop the record.
    if (!tile || !s || state.tiles[tileIndex(tile.x, tile.y)] === TileType.TownCenter) {
      buildingHp.delete(key);
      continue;
    }
    if (s.hp < s.max) out.push(tileIndex(tile.x, tile.y), Math.floor((s.hp / s.max) * 1000));
  }
  for (const tc of state.townCenters) {
    const max = townCenterMaxHp(tc.level);
    if (tc.hp < max) out.push(tileIndex(tc.x, tc.y), Math.max(0, Math.floor((tc.hp / max) * 1000)));
  }
  // Camp hearths: a damaged one gets the same HP bar / flames as a damaged building.
  for (const h of hearths.values()) {
    if (!h.destroyed && h.hp < h.maxHp) out.push(tileIndex(h.x, h.y), Math.max(0, Math.floor((h.hp / h.maxHp) * 1000)));
  }
  return out;
}

// Runs `fn` with isWalkableTile answering for mobs (closed gates solid).
export function withHostileMover<T>(fn: () => T): T {
  const prev = state.hostileMover;
  state.hostileMover = true;
  try {
    return fn();
  } finally {
    state.hostileMover = prev;
  }
}

export function gateAt(index: number): GateState {
  let g = gates.get(index);
  if (!g) {
    g = { open: false, lock: "auto", clearTicks: GATE_CLOSE_DELAY_TICKS, overrun: false };
    gates.set(index, g);
  }
  return g;
}

// A gate tile with no record yet (just placed by a test, or a fresh load) counts as closed, auto.
// Forts phase A: an NPC-owned gate is passable only for its own site's mobs (moverOwner), and for the
// colony only while overrun; other mobs and wildlife never pass it.
export function gatePassable(index: number, hostile: boolean): boolean {
  const g = gates.get(index);
  const own = ownerAt(index);
  if (own !== 0) return hostile ? state.moverOwner === own : !!g && g.overrun;
  if (hostile) return !!g && (g.open || g.overrun);
  return !g || g.open || g.lock !== "closed";
}

// A wall or a gate mobs can't walk through right now (the breach search's obstacles).
// Forts phase A: mobs only breach the colony's walls / gates (owner 0); NPC-owned ones are solid to them.
export function isBreachObstacle(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  if (ownerAt(tileIndex(tx, ty)) !== 0) return false;
  return isWallTile(t) || (t === TileType.Gate && !gatePassable(tileIndex(tx, ty), true));
}

// Forts phase A: the colony's breach obstacles: walls / gates of a hostile site.
export function isColonyBreachObstacle(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const i = tileIndex(tx, ty);
  const t = state.tiles[i] as TileType;
  return isHostileOwner(ownerAt(i)) && (isWallTile(t) || (t === TileType.Gate && !gatePassable(i, false)));
}

// Route cost of breaking through the wall / closed gate at a tile (integer: routeToBuilding's heap needs it).
export function breachStepCost(tx: number, ty: number): number {
  const hp = structureHp(tx, ty)?.hp ?? 0;
  // Towers of the wall's owner defend it (the colony's for a colony wall, the site's for a site wall).
  const owner = ownerAt(tileIndex(tx, ty));
  return 1 + Math.round(hp / BREACH_HP_PER_TILE) + BREACH_TOWER_PENALTY_TILES * livingTowersNear(tx, ty, GATE_TOWER_RANGE_TILES, owner).length;
}

// updateMob's once-a-second check for a mob on a building target.
export function mobTargetNeedsRepick(mob: Mob): boolean {
  if (mobsWithoutRoute.has(mob.id) && mob.path.length === 0) {
    mobsWithoutRoute.delete(mob.id);
    return true;
  }
  const tile = mob.targetType === "building" && mob.targetId ? keyToTile(mob.targetId) : null;
  return !!tile && state.tiles[tileIndex(tile.x, tile.y)] === TileType.Gate && gatePassable(tileIndex(tile.x, tile.y), true);
}

export function friendlyNearGate(cx: number, cy: number, owner = 0): boolean {
  // Forts phase A: an NPC gate opens for its own site's awake mobs only.
  if (owner !== 0) {
    for (const m of mobs.values()) {
      if (Math.abs(m.x - cx) > GATE_OPEN_RANGE_PX || Math.abs(m.y - cy) > GATE_OPEN_RANGE_PX) continue;
      if (Math.hypot(m.x - cx, m.y - cy) <= GATE_OPEN_RANGE_PX && siteNumber(m.siteId) === owner) return true;
    }
    return false;
  }
  for (const p of players.values()) {
    if (!p.dead && Math.hypot(p.x - cx, p.y - cy) <= GATE_OPEN_RANGE_PX) return true;
  }
  for (const c of colonists.values()) {
    if (Math.hypot(c.x - cx, c.y - cy) <= GATE_OPEN_RANGE_PX) return true;
  }
  return false;
}

// Anything standing in the gate's tile (a player's box overlapping it): the gate can't close on it.
export function gateOccupied(tx: number, ty: number): boolean {
  const inTile = (x: number, y: number) => Math.floor(x / TILE_SIZE) === tx && Math.floor(y / TILE_SIZE) === ty;
  const x0 = tx * TILE_SIZE;
  const y0 = ty * TILE_SIZE;
  for (const p of players.values()) {
    if (p.dead) continue;
    if (p.x + PLAYER_HALF_SIZE > x0 && p.x - PLAYER_HALF_SIZE < x0 + TILE_SIZE && p.y + PLAYER_HALF_SIZE > y0 && p.y - PLAYER_HALF_SIZE < y0 + TILE_SIZE) return true;
  }
  for (const c of colonists.values()) if (inTile(c.x, c.y)) return true;
  for (const m of mobs.values()) if (inTile(m.x, m.y)) return true;
  for (const a of wildlife.values()) if (inTile(a.x, a.y)) return true;
  return false;
}

export function evaluateGateOverrun(index: number, g: GateState) {
  const tx = index % state.WORLD_TILES_X;
  const ty = Math.floor(index / state.WORLD_TILES_X);
  const c = tileToPixelCenter({ x: tx, y: ty });
  const range = GATE_OVERRUN_RANGE_TILES * TILE_SIZE;
  const owner = ownerAt(index);
  if (owner !== 0) {
    // Forts phase A, an NPC gate: the colony's soldiers and players near it against the site's mobs and
    // towers there; overrun only with no living tower of the site within GATE_TOWER_RANGE_TILES.
    let attackers = 0;
    let defenders = 0;
    for (const col of colonists.values()) {
      if (isGuardOrMilitiaKind(col.kind) && Math.hypot(col.x - c.x, col.y - c.y) <= range) attackers += Math.max(0, col.hp);
    }
    for (const p of players.values()) if (!p.dead && Math.hypot(p.x - c.x, p.y - c.y) <= range) attackers += Math.max(0, p.hp);
    for (const m of mobs.values()) {
      if (siteNumber(m.siteId) === owner && Math.hypot(m.x - c.x, m.y - c.y) <= range) defenders += Math.max(0, m.hp);
    }
    for (const t of livingTowersNear(tx, ty, GATE_OVERRUN_RANGE_TILES, owner)) defenders += structureHp(t.x, t.y)?.hp ?? 0;
    g.overrun = attackers > 0 && attackers > defenders && livingTowersNear(tx, ty, GATE_TOWER_RANGE_TILES, owner).length === 0;
    return;
  }
  let hostile = 0;
  for (const m of mobs.values()) {
    if (m.passive || isDormantGuardian(m) || (m.isDeserter && !m.deserterActive)) continue;
    if (Math.hypot(m.x - c.x, m.y - c.y) <= range) hostile += Math.max(0, m.hp);
  }
  let defence = 0;
  for (const col of colonists.values()) {
    if (isGuardOrMilitiaKind(col.kind) && Math.hypot(col.x - c.x, col.y - c.y) <= range) defence += Math.max(0, col.hp);
  }
  for (const t of livingTowersNear(tx, ty, GATE_OVERRUN_RANGE_TILES, 0)) defence += structureHp(t.x, t.y)?.hp ?? 0;
  const overrun = hostile > 0 && hostile > defence && livingTowersNear(tx, ty, GATE_TOWER_RANGE_TILES, 0).length === 0;
  if (overrun && !g.overrun) broadcastEvent("raid", "Gate overrun");
  g.overrun = overrun;
}

// Once per tick: registry upkeep, auto open / close, and (once a second) the overrun check.
export function updateGates(forceOverrunCheck = false) {
  if (state.gateTilesDirty) {
    for (let i = 0; i < state.tiles.length; i++) if (state.tiles[i] === TileType.Gate) gateAt(i);
    for (const index of Array.from(gates.keys())) if (state.tiles[index] !== TileType.Gate) gates.delete(index);
    state.gateTilesDirty = false;
  }
  if (state.cycleTick % TICK_RATE === 0) {
    for (const id of Array.from(mobsWithoutRoute)) if (!mobs.has(id)) mobsWithoutRoute.delete(id);
  }
  for (const [index, g] of gates) {
    const tx = index % state.WORLD_TILES_X;
    const ty = Math.floor(index / state.WORLD_TILES_X);
    const c = tileToPixelCenter({ x: tx, y: ty });
    if (g.lock === "open") {
      g.open = true;
    } else if (g.lock === "auto" && friendlyNearGate(c.x, c.y, ownerAt(index))) {
      g.open = true;
      g.clearTicks = 0;
    } else {
      if (g.lock === "auto") g.clearTicks++;
      const shouldClose = g.lock === "closed" || g.clearTicks >= GATE_CLOSE_DELAY_TICKS;
      if (g.open && shouldClose && !gateOccupied(tx, ty)) g.open = false;
    }
    if (forceOverrunCheck || state.cycleTick % TICK_RATE === 0) evaluateGateOverrun(index, g);
  }
}

export function gatesForSnapshot(): number[] {
  const out: number[] = [];
  for (const [index, g] of gates) {
    out.push(
      index,
      (g.open ? GATE_FLAG_OPEN : 0) |
        (g.lock === "open" ? GATE_FLAG_LOCK_OPEN : 0) |
        (g.lock === "closed" ? GATE_FLAG_LOCK_CLOSED : 0) |
        (g.overrun ? GATE_FLAG_OVERRUN : 0) |
        (ownerAt(index) !== 0 ? GATE_FLAG_FOREIGN : 0)
    );
  }
  return out;
}

export function handleSetGateLock(tx: number, ty: number, lock: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Gate || ownerAt(tileIndex(tx, ty)) !== 0) return;
  if (lock !== "auto" && lock !== "open" && lock !== "closed") return;
  const g = gateAt(tileIndex(tx, ty));
  g.lock = lock;
  if (lock === "open") g.open = true;
  // Auto: start the close countdown now; the next tick re-opens it for anyone still near.
  if (lock === "auto") g.clearTicks = GATE_CLOSE_DELAY_TICKS;
}

// The one place that says what a Tower tile is (the gate logic asks it too).
export function isTowerTile(tile: TileType): boolean {
  return tile === TileType.Tower;
}

export function towerStatsForLevel(level: number) {
  return TOWER_STATS[Math.min(Math.max(level, 1), 3) - 1];
}

export function towerCostForLevel(level: number): Cost {
  return TOWER_COSTS[Math.min(Math.max(level, 1), 3) - 1];
}

export function towerCooldownTicks(level: number): number {
  return Math.max(1, Math.round(towerStatsForLevel(level).cooldownSeconds * TICK_RATE));
}

// Every standing Tower within radiusTiles (Euclidean, tile units) of tile (tx, ty). A Tower tile only
// exists while the building stands (destroyed -> demolished to Empty; unfinished -> ConstructionSite),
// so every one found is alive. A Tower whose upgrade is under way keeps shooting and counts.
// Forts phase A: `owner` given = only that owner's towers (0 = the colony's); omitted = every tower.
export function livingTowersNear(tx: number, ty: number, radiusTiles: number, owner?: number): Array<{ x: number; y: number; level: number }> {
  const out: Array<{ x: number; y: number; level: number }> = [];
  const r = Math.ceil(radiusTiles);
  for (let y = Math.max(0, ty - r); y <= Math.min(state.WORLD_TILES_Y - 1, ty + r); y++) {
    for (let x = Math.max(0, tx - r); x <= Math.min(state.WORLD_TILES_X - 1, tx + r); x++) {
      if (!isTowerTile(state.tiles[tileIndex(x, y)] as TileType)) continue;
      if (owner !== undefined && ownerAt(tileIndex(x, y)) !== owner) continue;
      if (Math.hypot(x - tx, y - ty) <= radiusTiles) out.push({ x, y, level: getBuildingLevel(x, y) });
    }
  }
  return out;
}

export function resolveTowerPlacement(tx: number, ty: number) {
  if (isTowerTile(state.tiles[tileIndex(tx, ty)] as TileType)) {
    tryLevelUpInPlace(tx, ty, [TileType.Tower]);
    return;
  }
  state.tiles[tileIndex(tx, ty)] = TileType.Tower;
  broadcastTileUpdate(tx, ty, TileType.Tower);
  towerCooldowns.delete(resourceKey(tx, ty));
}

// Mobs a Tower may shoot: never a dormant guardian (that would wake its site), a passive raid group
// still loitering at the edge, or a deserter that hasn't turned yet.
export function isTowerTarget(m: Mob): boolean {
  return !isDormantGuardian(m) && !m.passive && !(m.isDeserter && !m.deserterActive);
}

// Once per tick, after the mobs have moved.
export function updateTowers() {
  for (let i = 0; i < state.tiles.length; i++) {
    if (!isTowerTile(state.tiles[i] as TileType)) continue;
    const tx = i % state.WORLD_TILES_X;
    const ty = Math.floor(i / state.WORLD_TILES_X);
    const key = resourceKey(tx, ty);
    const cooldown = towerCooldowns.get(key) ?? 0;
    if (cooldown > 1) {
      towerCooldowns.set(key, cooldown - 1);
      continue;
    }
    const level = getBuildingLevel(tx, ty);
    const stats = towerStatsForLevel(level);
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = ty * TILE_SIZE + TILE_SIZE / 2;
    // Forts phase A: an NPC site's tower shoots the colony (players and colonists) instead of mobs.
    if (isHostileOwner(ownerAt(i))) {
      if (siteTowerShot(key, cx, cy, stats.rangeTiles * TILE_SIZE, stats.damage)) towerCooldowns.set(key, towerCooldownTicks(level));
      else towerCooldowns.set(key, 0);
      continue;
    }
    let best: Mob | null = null;
    let bestD = stats.rangeTiles * TILE_SIZE;
    for (const m of mobs.values()) {
      if (!isTowerTarget(m)) continue;
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d <= bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) {
      towerCooldowns.set(key, 0);
      continue;
    }
    // Shot from the top of the tower art.
    state.pendingEffects.push({ fromX: cx, fromY: cy - TILE_SIZE / 3, toX: best.x, toY: best.y });
    damageMob(best, stats.damage, "b:" + key);
    towerCooldowns.set(key, towerCooldownTicks(level));
  }
}

// One shot of a site tower at the nearest player or colonist in range; false when nobody is in range.
export function siteTowerShot(key: string, cx: number, cy: number, range: number, damage: number): boolean {
  let bestD = range;
  let player: Player | null = null;
  let colonist: Colonist | null = null;
  if (!state.testPlayersIgnored) {
    for (const p of players.values()) {
      const d = p.dead ? Infinity : Math.hypot(p.x - cx, p.y - cy);
      if (d <= bestD) {
        bestD = d;
        player = p;
      }
    }
  }
  for (const c of colonists.values()) {
    if (Math.abs(c.x - cx) > bestD || Math.abs(c.y - cy) > bestD) continue;
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d <= bestD) {
      bestD = d;
      colonist = c;
      player = null;
    }
  }
  const target = colonist ?? player;
  if (!target) return false;
  state.pendingEffects.push({ fromX: cx, fromY: cy - TILE_SIZE / 3, toX: target.x, toY: target.y });
  if (colonist) damageColonist(colonist, damage);
  else damagePlayer(player!, damage);
  towerEvents.push({ tick: state.cycleTick, tower: key, target: colonist ? "c:" + colonist.id : "p:" + player!.id, damage });
  if (towerEvents.length > 50) towerEvents.shift();
  return true;
}

export function towerInfoLines(level: number): string[] {
  const line = (l: number) => {
    const s = towerStatsForLevel(l);
    return `${s.damage} damage every ${s.cooldownSeconds}s, range ${s.rangeTiles} tiles`;
  };
  const lines = [`Lv${level}: shoots the nearest monster: ${line(level)}`];
  if (level < 3) lines.push(`Next level: ${line(level + 1)}`);
  lines.push("No workers or population needed");
  return lines;
}
