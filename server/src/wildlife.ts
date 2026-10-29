// wildlife.ts: Hunting & foraging: Hunter's / Forager's Hut workers, wild game, wild forage.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { type WildlifeKind, WILDLIFE_KINDS, TileType, Biome, TILE_SIZE } from "@colony/shared/protocol";
import type { Colonist, TileCoord, Wildlife, WildlifeConfig } from "./types.js";
import {
  BOAR_ATTACK_COOLDOWN_TICKS, BOAR_ATTACK_RANGE, BOAR_CHARGE_SPEED, BOAR_CHARGE_TICKS, BOAR_DAMAGE, COLONIST_SPEED,
  DORMANCY_RADIUS_TILES, FOOD_WORKER_IDLE_RETRY_TICKS, FOOD_WORKER_ROUTE_CANDIDATES, FORAGER_WORK_RADIUS_TILES,
  FORAGE_FRUIT_YIELD, FORAGE_MIN_TOWN_CENTER_DIST_TILES, FORAGE_PICKED_TO_RIPE, FORAGE_REGROW_TICKS,
  FORAGE_RIPE_TO_PICKED, FORAGE_TICKS, HUNTER_ARROW_DAMAGE, HUNTER_BOW_RANGE, HUNTER_CHASE_LEASH_TILES,
  HUNTER_REPATH_TICKS, HUNTER_SHOT_COOLDOWN_TICKS, HUNTER_WORK_RADIUS_TILES, LEGACY_DAY_TICKS, LEGACY_NIGHT_TICKS,
  WILDLIFE_FLEE_TICKS, WILDLIFE_MIN_TOWN_CENTER_DIST_TILES, WILDLIFE_PLAYER_CLEARANCE_TILES, WILDLIFE_REST_MAX_TICKS,
  WILDLIFE_REST_MIN_TICKS, WILDLIFE_STATE_CODE, WILDLIFE_WANDER_RADIUS_TILES,
} from "./constants.js";
import {
  colonists, forageRegrow, players, reservedResourceTiles, scaledCount, scaledCountSub, state, wildlife,
} from "./state.js";
import {
  biomeAt, biomeSpeedMultiplier, clamp, getBuildingLevel, inBounds, levelBonus, resourceKey, tileIndex, tileOfPixel,
  tileToPixelCenter,
} from "./tiles.js";
import { advanceAlongPath, findAdjacentWalkable, findPath, isWalkableTile } from "./pathfinding.js";
import { industrialSynergyMultiplier, releaseResourceReservation, stock } from "./economy.js";
import { isInReservedGrounds, randInt } from "./worldgen.js";
import { TOWN_CENTER_TILE, productionSpeedMultiplier } from "./colonists.js";
import { damageColonist } from "./combat.js";
import { broadcastTileUpdate } from "./net.js";

// ---- Hunting & foraging: Hunter's Hut / Forager's Hut workers, wild game, wild forage ----
// Every tunable lives here. Hunters and foragers are civilians: they only work by day and shelter in
// houses at night like everyone else (updateColonist). Their hut's level adds workers (one per level,
// see resolveFoodHutPlacement) and, with happiness and industrial synergy, speeds their work timers.

export const WILDLIFE_CONFIG: Record<WildlifeKind, WildlifeConfig> = {
  deer: { maxHp: 18, speed: 28, fleeSpeed: 115, meat: 6, cap: scaledCountSub(6) },
  rabbit: { maxHp: 6, speed: 30, fleeSpeed: 125, meat: 2, cap: scaledCountSub(8) },
  boar: { maxHp: 30, speed: 24, fleeSpeed: 100, meat: 8, cap: scaledCountSub(3) },
  pheasant: { maxHp: 6, speed: 22, fleeSpeed: 120, meat: 2, cap: scaledCountSub(4) },
};
// Long days: the interval stays in real time (4 per legacy 100 s day = one every 25 s on 80x80), so a
// long day tops up ~15 animals and hunting income per second is unchanged.
export const WILDLIFE_RESPAWN_INTERVAL_TICKS = Math.round((LEGACY_DAY_TICKS + LEGACY_NIGHT_TICKS) / state.WILDLIFE_RESPAWN_PER_DAY);
state.wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;

export function wildlifeForSnapshot(): number[] {
  const out: number[] = [];
  for (const a of wildlife.values()) {
    out.push(a.id, WILDLIFE_KINDS.indexOf(a.kind), Math.round(a.x), Math.round(a.y), WILDLIFE_STATE_CODE[a.mode]);
  }
  return out;
}

export function hasTreeNear(tx: number, ty: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (inBounds(tx + dx, ty + dy) && state.tiles[tileIndex(tx + dx, ty + dy)] === TileType.Tree) return true;
    }
  }
  return false;
}

// Deer and rabbits on Plains; boar on Plains/Hills with a tree within 2 tiles (forest edges); pheasant
// on Plains/Hills. Always an Empty tile.
export function wildlifeTileOk(kind: WildlifeKind, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Empty) return false;
  if (isInReservedGrounds(tx, ty)) return false;
  if (Math.hypot(tx - TOWN_CENTER_TILE.x, ty - TOWN_CENTER_TILE.y) < WILDLIFE_MIN_TOWN_CENTER_DIST_TILES) return false;
  const biome = biomeAt(tx, ty);
  if (kind === "deer" || kind === "rabbit") return biome === Biome.Plains;
  if (kind === "boar") return biome !== Biome.Swamp && hasTreeNear(tx, ty, 2);
  return biome !== Biome.Swamp;
}

export function spawnWildlifeAt(kind: WildlifeKind, tx: number, ty: number): Wildlife {
  const center = tileToPixelCenter({ x: tx, y: ty });
  const animal: Wildlife = {
    id: state.nextWildlifeId++,
    kind,
    x: center.x,
    y: center.y,
    hp: WILDLIFE_CONFIG[kind].maxHp,
    homeX: center.x,
    homeY: center.y,
    mode: "idle",
    targetX: center.x,
    targetY: center.y,
    restTicks: randInt(0, WILDLIFE_REST_MAX_TICKS),
    modeTicks: 0,
    fleeDirX: 0,
    fleeDirY: 0,
    reservedBy: null,
    chargeTargetId: null,
    attackCooldownTicks: 0,
  };
  wildlife.set(animal.id, animal);
  return animal;
}

// Rejection-samples a spawn tile for `kind`; null if none found (crowded map).
export function pickWildlifeSpawnTile(kind: WildlifeKind, avoidPlayers: boolean): TileCoord | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const tx = Math.floor(Math.random() * state.WORLD_TILES_X);
    const ty = Math.floor(Math.random() * state.WORLD_TILES_Y);
    if (!wildlifeTileOk(kind, tx, ty)) continue;
    if (avoidPlayers) {
      const center = tileToPixelCenter({ x: tx, y: ty });
      let tooClose = false;
      for (const p of players.values()) {
        if (Math.hypot(p.x - center.x, p.y - center.y) < WILDLIFE_PLAYER_CLEARANCE_TILES * TILE_SIZE) tooClose = true;
      }
      if (tooClose) continue;
    }
    return { x: tx, y: ty };
  }
  return null;
}

export function spawnInitialWildlife() {
  wildlife.clear();
  state.nextWildlifeId = 1;
  state.wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;
  for (const kind of WILDLIFE_KINDS) {
    for (let i = 0; i < WILDLIFE_CONFIG[kind].cap; i++) {
      const tile = pickWildlifeSpawnTile(kind, false);
      if (tile) spawnWildlifeAt(kind, tile.x, tile.y);
    }
  }
}

// One animal every WILDLIFE_RESPAWN_INTERVAL_TICKS, of the kind furthest below its cap (by ratio).
export function updateWildlifeRespawn() {
  if (state.testWildlifeRespawnDisabled) return;
  if (state.wildlifeRespawnCooldown > 0) {
    state.wildlifeRespawnCooldown--;
    return;
  }
  state.wildlifeRespawnCooldown = WILDLIFE_RESPAWN_INTERVAL_TICKS;
  const counts: Record<WildlifeKind, number> = { deer: 0, rabbit: 0, boar: 0, pheasant: 0 };
  for (const a of wildlife.values()) counts[a.kind]++;
  let best: WildlifeKind | null = null;
  let bestRatio = 1;
  for (const kind of WILDLIFE_KINDS) {
    const cap = WILDLIFE_CONFIG[kind].cap;
    if (cap <= 0) continue;
    const ratio = counts[kind] / cap;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = kind;
    }
  }
  if (!best) return;
  const tile = pickWildlifeSpawnTile(best, true);
  if (tile) spawnWildlifeAt(best, tile.x, tile.y);
}

export function isWalkablePixel(px: number, py: number): boolean {
  const t = tileOfPixel(px, py);
  return isWalkableTile(t.x, t.y);
}

// Straight-line step toward (tx, ty), never onto a solid tile (slides along one axis if blocked).
// Returns false when it couldn't move at all. Wildlife never pathfinds: it only takes short hops.
export function stepWildlife(a: Wildlife, dirX: number, dirY: number, speed: number, dt: number): boolean {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return false;
  const step = speed * biomeSpeedMultiplier(a.x, a.y) * dt;
  const nx = a.x + (dirX / len) * step;
  const ny = a.y + (dirY / len) * step;
  const clampX = clamp(nx, TILE_SIZE / 2, state.worldWidth - TILE_SIZE / 2);
  const clampY = clamp(ny, TILE_SIZE / 2, state.worldHeight - TILE_SIZE / 2);
  if (isWalkablePixel(clampX, clampY)) {
    a.x = clampX;
    a.y = clampY;
    return true;
  }
  if (isWalkablePixel(clampX, a.y)) {
    a.x = clampX;
    return true;
  }
  if (isWalkablePixel(a.x, clampY)) {
    a.y = clampY;
    return true;
  }
  return false;
}

export function startWildlifeFlee(a: Wildlife, fromX: number, fromY: number) {
  let dx = a.x - fromX;
  let dy = a.y - fromY;
  if (Math.hypot(dx, dy) < 1) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  a.mode = "flee";
  a.modeTicks = WILDLIFE_FLEE_TICKS;
  a.fleeDirX = dx;
  a.fleeDirY = dy;
  a.chargeTargetId = null;
}

// Damage from anything (hunter arrow, player lance, test hook). Returns true if it killed the animal.
// A boar hit by a hunter charges him; everything else (and a boar hit by anyone else) flees.
export function damageWildlife(a: Wildlife, amount: number, fromX: number, fromY: number, hunterId: string | null): boolean {
  a.hp -= amount;
  if (a.hp <= 0) {
    wildlife.delete(a.id);
    return true;
  }
  if (a.kind === "boar" && hunterId !== null && a.mode !== "charge" && colonists.has(hunterId)) {
    a.mode = "charge";
    a.modeTicks = BOAR_CHARGE_TICKS;
    a.chargeTargetId = hunterId;
  } else if (a.mode !== "charge") {
    startWildlifeFlee(a, fromX, fromY);
  }
  return false;
}
export function updateWildlife(dt: number) {
  const anchors: { x: number; y: number }[] = [];
  for (const p of players.values()) if (!p.dead) anchors.push(p);
  for (const c of colonists.values()) anchors.push(c);
  const dormantDist = DORMANCY_RADIUS_TILES * TILE_SIZE;
  for (const a of wildlife.values()) {
    const config = WILDLIFE_CONFIG[a.kind];
    if (a.attackCooldownTicks > 0) a.attackCooldownTicks--;
    if (!anchors.some((p) => Math.abs(p.x - a.x) < dormantDist && Math.abs(p.y - a.y) < dormantDist)) continue;
    // Something was built on top of it (placement only checks players/colonists): step off.
    const here = tileOfPixel(a.x, a.y);
    if (!isWalkableTile(here.x, here.y)) {
      const out = findAdjacentWalkable(here.x, here.y);
      if (out) {
        const center = tileToPixelCenter(out);
        a.x = a.homeX = a.targetX = center.x;
        a.y = a.homeY = a.targetY = center.y;
      }
    }
    if (a.mode === "flee") {
      if (!stepWildlife(a, a.fleeDirX, a.fleeDirY, config.fleeSpeed, dt)) {
        // Cornered: bolt off at a new random angle.
        const angle = Math.random() * Math.PI * 2;
        a.fleeDirX = Math.cos(angle);
        a.fleeDirY = Math.sin(angle);
      }
      if (--a.modeTicks <= 0) {
        a.mode = "idle";
        a.homeX = a.x;
        a.homeY = a.y;
        a.restTicks = randInt(WILDLIFE_REST_MIN_TICKS, WILDLIFE_REST_MAX_TICKS);
      }
      continue;
    }
    if (a.mode === "charge") {
      const target = a.chargeTargetId ? colonists.get(a.chargeTargetId) : undefined;
      if (!target || --a.modeTicks <= 0) {
        startWildlifeFlee(a, target?.x ?? a.x, target?.y ?? a.y);
        continue;
      }
      const dist = Math.hypot(target.x - a.x, target.y - a.y);
      if (dist <= BOAR_ATTACK_RANGE) {
        if (a.attackCooldownTicks <= 0) {
          a.attackCooldownTicks = BOAR_ATTACK_COOLDOWN_TICKS;
          state.pendingEffects.push({ fromX: a.x, fromY: a.y, toX: target.x, toY: target.y, melee: true });
          damageColonist(target, BOAR_DAMAGE);
        }
      } else {
        stepWildlife(a, target.x - a.x, target.y - a.y, BOAR_CHARGE_SPEED, dt);
      }
      continue;
    }
    if (a.mode === "walk") {
      const dist = Math.hypot(a.targetX - a.x, a.targetY - a.y);
      const step = config.speed * dt;
      if (dist <= step || !stepWildlife(a, a.targetX - a.x, a.targetY - a.y, config.speed, dt)) {
        if (dist <= step) {
          a.x = a.targetX;
          a.y = a.targetY;
        }
        a.mode = "idle";
        a.restTicks = randInt(WILDLIFE_REST_MIN_TICKS, WILDLIFE_REST_MAX_TICKS);
      }
      continue;
    }
    if (--a.restTicks > 0) continue;
    const home = tileOfPixel(a.homeX, a.homeY);
    const tx = home.x + randInt(-WILDLIFE_WANDER_RADIUS_TILES, WILDLIFE_WANDER_RADIUS_TILES);
    const ty = home.y + randInt(-WILDLIFE_WANDER_RADIUS_TILES, WILDLIFE_WANDER_RADIUS_TILES);
    if (isWalkableTile(tx, ty)) {
      a.targetX = tx * TILE_SIZE + TILE_SIZE * (0.25 + Math.random() * 0.5);
      a.targetY = ty * TILE_SIZE + TILE_SIZE * (0.25 + Math.random() * 0.5);
      a.mode = "walk";
    } else {
      a.restTicks = WILDLIFE_REST_MIN_TICKS;
    }
  }
}

export function scatterForage(tile: TileType, count: number, isValid: (tx: number, ty: number) => boolean) {
  let placed = 0;
  for (let attempts = 0; placed < count && attempts < scaledCount(2000); attempts++) {
    const tx = Math.floor(Math.random() * state.WORLD_TILES_X);
    const ty = Math.floor(Math.random() * state.WORLD_TILES_Y);
    if (state.tiles[tileIndex(tx, ty)] !== TileType.Empty) continue;
    if (isInReservedGrounds(tx, ty)) continue;
    if (Math.hypot(tx - TOWN_CENTER_TILE.x, ty - TOWN_CENTER_TILE.y) < FORAGE_MIN_TOWN_CENTER_DIST_TILES) continue;
    if (!isValid(tx, ty)) continue;
    state.tiles[tileIndex(tx, ty)] = tile;
    placed++;
  }
}

export function generateForage() {
  forageRegrow.clear();
  scatterForage(TileType.BerryBush, state.BERRY_BUSH_COUNT, (tx, ty) => biomeAt(tx, ty) === Biome.Plains);
  scatterForage(TileType.FruitTree, state.FRUIT_TREE_COUNT, (tx, ty) => biomeAt(tx, ty) === Biome.Plains);
  scatterForage(
    TileType.MushroomPatch,
    state.MUSHROOM_PATCH_COUNT,
    (tx, ty) => biomeAt(tx, ty) === Biome.Swamp || hasTreeNear(tx, ty, 1)
  );
}

// Picked plants count down to ripe; an entry whose tile was cleared (demolished) is dropped.
export function updateForageRegrow() {
  for (const [index, ticks] of forageRegrow) {
    const tile = state.tiles[index] as TileType;
    const ripe = FORAGE_PICKED_TO_RIPE[tile];
    if (ripe === undefined) {
      forageRegrow.delete(index);
      continue;
    }
    if (ticks > 1) {
      forageRegrow.set(index, ticks - 1);
      continue;
    }
    forageRegrow.delete(index);
    state.tiles[index] = ripe;
    broadcastTileUpdate(index % state.WORLD_TILES_X, Math.floor(index / state.WORLD_TILES_X), ripe);
  }
}

// Hunter/forager work timers: hut level, happiness and industrial synergy (no biome factor).
export function effectiveFoodHutTicks(base: number, tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((base * (1 - levelBonus(level))) / (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

export function hutDistanceTiles(c: Colonist, px: number, py: number): number {
  const hut = tileToPixelCenter({ x: c.postX, y: c.postY });
  return Math.hypot(px - hut.x, py - hut.y) / TILE_SIZE;
}

// Path home to the hut's doorstep; the worker deposits when it arrives (state "carrying").
export function startCarryingHome(c: Colonist) {
  const approach = findAdjacentWalkable(c.postX, c.postY);
  const path = approach ? findPath(tileOfPixel(c.x, c.y), approach) : null;
  c.path = path ?? [];
  c.state = "carrying";
}

export function depositCarried(c: Colonist, resource: "meat" | "fruit") {
  stock[resource] += c.carryAmount;
  c.carryAmount = 0;
  c.state = "idle";
}

export function planHunt(c: Colonist): { animal: Wildlife; path: TileCoord[] } | null {
  const candidates: { animal: Wildlife; d: number }[] = [];
  for (const a of wildlife.values()) {
    if (a.reservedBy !== null && a.reservedBy !== c.id) continue;
    if (hutDistanceTiles(c, a.x, a.y) > HUNTER_WORK_RADIUS_TILES) continue;
    candidates.push({ animal: a, d: Math.hypot(a.x - c.x, a.y - c.y) });
  }
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(c.x, c.y);
  for (const { animal } of candidates.slice(0, FOOD_WORKER_ROUTE_CANDIDATES)) {
    const path = findPath(start, tileOfPixel(animal.x, animal.y));
    if (path) return { animal, path };
  }
  return null;
}

// States: idle -> stalking (walk to bow range) -> hunting (shoot) -> collecting (walk to the carcass)
// -> carrying (walk home, deposit meat) -> idle. A carcass load survives the night (carried home at
// dawn); the reservation on a live animal doesn't (released when the hunter goes to shelter).
export function updateHunter(c: Colonist, dt: number) {
  switch (c.state) {
    case "stalking":
    case "hunting": {
      const animal = c.targetWildlifeId !== null ? wildlife.get(c.targetWildlifeId) : undefined;
      if (!animal || hutDistanceTiles(c, animal.x, animal.y) > HUNTER_CHASE_LEASH_TILES) {
        releaseResourceReservation(c);
        c.path = [];
        c.state = "idle";
        c.idleCooldown = 0;
        return;
      }
      if (c.attackCooldownTicks > 0) c.attackCooldownTicks--;
      const dist = Math.hypot(animal.x - c.x, animal.y - c.y);
      if (dist > HUNTER_BOW_RANGE) {
        c.state = "stalking";
        if (c.repathCooldown > 0) c.repathCooldown--;
        if (c.path.length === 0 || c.repathCooldown <= 0) {
          c.path = findPath(tileOfPixel(c.x, c.y), tileOfPixel(animal.x, animal.y)) ?? [];
          c.repathCooldown = HUNTER_REPATH_TICKS;
        }
        advanceAlongPath(c, dt, COLONIST_SPEED);
        return;
      }
      c.state = "hunting";
      c.path = [];
      if (c.attackCooldownTicks > 0) return;
      c.attackCooldownTicks = effectiveFoodHutTicks(HUNTER_SHOT_COOLDOWN_TICKS, c.postX, c.postY);
      state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: animal.x, toY: animal.y });
      const carcass = { x: animal.x, y: animal.y };
      if (damageWildlife(animal, HUNTER_ARROW_DAMAGE, c.x, c.y, c.id)) {
        c.targetWildlifeId = null;
        c.carryAmount += WILDLIFE_CONFIG[animal.kind].meat;
        c.path = findPath(tileOfPixel(c.x, c.y), tileOfPixel(carcass.x, carcass.y)) ?? [];
        c.state = "collecting";
      }
      return;
    }
    case "collecting":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) startCarryingHome(c);
      return;
    case "carrying":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) depositCarried(c, "meat");
      return;
    default: {
      // "idle" (and anything left over from sheltering).
      c.state = "idle";
      if (c.carryAmount > 0) {
        startCarryingHome(c);
        return;
      }
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        return;
      }
      const plan = planHunt(c);
      if (!plan) {
        c.idleCooldown = FOOD_WORKER_IDLE_RETRY_TICKS;
        return;
      }
      plan.animal.reservedBy = c.id;
      c.targetWildlifeId = plan.animal.id;
      c.path = plan.path;
      c.repathCooldown = HUNTER_REPATH_TICKS;
      c.state = "stalking";
    }
  }
}

// Approach tile for a forage plant: walkable ones (bush, mushrooms) are stood on, a fruit tree from
// beside it.
export function forageApproach(tx: number, ty: number): TileCoord | null {
  return isWalkableTile(tx, ty) ? { x: tx, y: ty } : findAdjacentWalkable(tx, ty);
}

export function planForage(c: Colonist): { tx: number; ty: number; path: TileCoord[] } | null {
  const hut = { x: c.postX, y: c.postY };
  const r = FORAGER_WORK_RADIUS_TILES;
  const candidates: { tx: number; ty: number; d: number }[] = [];
  for (let ty = Math.max(0, hut.y - r); ty <= Math.min(state.WORLD_TILES_Y - 1, hut.y + r); ty++) {
    for (let tx = Math.max(0, hut.x - r); tx <= Math.min(state.WORLD_TILES_X - 1, hut.x + r); tx++) {
      if (FORAGE_RIPE_TO_PICKED[state.tiles[tileIndex(tx, ty)] as TileType] === undefined) continue;
      if (Math.hypot(tx - hut.x, ty - hut.y) > r) continue;
      if (reservedResourceTiles.has(resourceKey(tx, ty))) continue;
      candidates.push({ tx, ty, d: (tx + 0.5 - c.x / TILE_SIZE) ** 2 + (ty + 0.5 - c.y / TILE_SIZE) ** 2 });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const start = tileOfPixel(c.x, c.y);
  for (const cand of candidates.slice(0, FOOD_WORKER_ROUTE_CANDIDATES)) {
    const approach = forageApproach(cand.tx, cand.ty);
    if (!approach) continue;
    const path = findPath(start, approach);
    if (path) return { tx: cand.tx, ty: cand.ty, path };
  }
  return null;
}

// States: idle -> toForage (walk) -> foraging (pick for FORAGE_TICKS) -> carrying (walk home, deposit
// fruit) -> idle. The target plant is reserved in reservedResourceTiles like a lumberjack's tree.
export function updateForager(c: Colonist, dt: number) {
  const targetRipe = () =>
    c.targetResourceX >= 0 &&
    FORAGE_RIPE_TO_PICKED[state.tiles[tileIndex(c.targetResourceX, c.targetResourceY)] as TileType] !== undefined;
  switch (c.state) {
    case "toForage":
      if (!targetRipe()) {
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
        c.path = [];
        c.state = "idle";
        return;
      }
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) {
        c.state = "foraging";
        c.chopTicksRemaining = effectiveFoodHutTicks(FORAGE_TICKS, c.postX, c.postY);
      }
      return;
    case "foraging": {
      if (!targetRipe()) {
        releaseResourceReservation(c);
        c.targetResourceX = -1;
        c.targetResourceY = -1;
        c.state = "idle";
        return;
      }
      if (--c.chopTicksRemaining > 0) return;
      const index = tileIndex(c.targetResourceX, c.targetResourceY);
      const ripe = state.tiles[index] as TileType;
      const picked = FORAGE_RIPE_TO_PICKED[ripe]!;
      state.tiles[index] = picked;
      broadcastTileUpdate(c.targetResourceX, c.targetResourceY, picked);
      forageRegrow.set(index, FORAGE_REGROW_TICKS);
      c.carryAmount += FORAGE_FRUIT_YIELD[ripe] ?? 0;
      releaseResourceReservation(c);
      c.targetResourceX = -1;
      c.targetResourceY = -1;
      startCarryingHome(c);
      return;
    }
    case "carrying":
      advanceAlongPath(c, dt, COLONIST_SPEED);
      if (c.path.length === 0) depositCarried(c, "fruit");
      return;
    default: {
      c.state = "idle";
      if (c.carryAmount > 0) {
        startCarryingHome(c);
        return;
      }
      if (c.idleCooldown > 0) {
        c.idleCooldown--;
        return;
      }
      const plan = planForage(c);
      if (!plan) {
        c.idleCooldown = FOOD_WORKER_IDLE_RETRY_TICKS;
        return;
      }
      reservedResourceTiles.set(resourceKey(plan.tx, plan.ty), c.id);
      c.targetResourceX = plan.tx;
      c.targetResourceY = plan.ty;
      c.path = plan.path;
      c.state = "toForage";
    }
  }
}
