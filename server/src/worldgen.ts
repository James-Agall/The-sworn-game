// worldgen.ts: World size, world generation (biomes, ponds, resources, POI sites), the Abbey, the Castle Ruin and its bosses.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import {
  TileType, Biome, type MobKind, type BossTier, bossTitle, VISION_RADIUS_PLAYER, TILE_SIZE, VISION_RADIUS_COLONIST,
} from "@colony/shared/protocol";
import type { Mob, PoiSiteKind, ResourceKey, TileCoord } from "./types.js";
import {
  ABBEY_CLERGY_OFFSETS, ABBEY_FOOTPRINT_RADIUS, ABBEY_GROUNDS_RADIUS, ABBEY_LAYOUT, ABBEY_LAYOUT_TILES,
  ABBEY_MIN_SPAWN_DIST, BIOME_EDGE_JITTER_TILES, BIOME_NOISE_CELL_TILES, BIOME_SEED_MIN_SPACING,
  BIOME_SEED_RADIUS_MAX, BIOME_SEED_RADIUS_MIN, BOSS_EQUIP_LOOT, CASTLE_RUIN_FOOTPRINT_RADIUS,
  CASTLE_RUIN_GROUNDS_RADIUS, CASTLE_RUIN_GUARDIANS_MAX, CASTLE_RUIN_GUARDIANS_MIN, CASTLE_RUIN_GUARDIAN_WEIGHTS,
  CASTLE_RUIN_LAYOUT, CASTLE_RUIN_LAYOUT_TILES, CASTLE_RUIN_SPAWN_DIST_FRACTIONS, ELITE_DAMAGE_MULT, ELITE_HP_MULT,
  ELITE_REWARD, ENCAMPMENT_EXTRAS, ENCAMPMENT_GUARDIAN_WEIGHTS, MINI_BOSS_KINDS, MOB_KIND_CONFIG, MOB_MARK_DEFAULTS,
  NEIGHBORS_8, POI_SITE_FOOTPRINT_RADIUS, POI_SITE_MIN_SPACING, POI_SITE_WATER_CLEARANCE, POND_EDGE_JITTER_TILES,
  POND_MIN_SPACING, POND_NOISE_CELL_TILES, POND_RADIUS_MAX, POND_RADIUS_MIN, RUIN_CENTERPIECES, RUIN_EXTRAS,
  RUIN_GUARDIAN_WEIGHTS, SITE_KIND_HAS_HEARTH, SPAWN_CLEAR_RADIUS_TILES, SPAWN_PLAINS_RADIUS_TILES,
  WARLORD_DAMAGE_MULT, WARLORD_HP_MULT, WARLORD_REWARD, clampWorldSize,
} from "./constants.js";
import { colonists, hearths, mobs, players, scaledCount, scaledCountSub, state } from "./state.js";
import { clearOwners, inBounds, tileIndex, tileToPixelCenter } from "./tiles.js";
import { stock } from "./economy.js";
import { WILDLIFE_CONFIG, generateForage, spawnInitialWildlife } from "./wildlife.js";
import {
  TOWN_CENTER_TILE, isAbbeyClergy, spawnColonistForPost, topUpTownCenterBuilders, townCenterMaxHp,
} from "./colonists.js";
import { applyMobSize } from "./mobs.js";
import { registerHearth } from "./hearths.js";
import { evaluateGoals, resetGoals } from "./goals.js";
import { grantTieredEquipment } from "./heroes.js";
import { broadcastEvent, resetExplored } from "./net.js";

export function scatterResourceTiles(tileType: TileType, count: number) {
  const spawnTx = Math.floor(state.WORLD_TILES_X / 2);
  const spawnTy = Math.floor(state.WORLD_TILES_Y / 2);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < scaledCount(1000)) {
    attempts++;
    const tx = Math.floor(Math.random() * state.WORLD_TILES_X);
    const ty = Math.floor(Math.random() * state.WORLD_TILES_Y);
    if (tx === spawnTx && ty === spawnTy) continue;
    if (isInReservedGrounds(tx, ty)) continue;
    const idx = tileIndex(tx, ty);
    if (state.tiles[idx] === TileType.Empty) {
      state.tiles[idx] = tileType;
      placed++;
    }
  }
}

// ---- World generation: biomes, ponds, resource scatter, POI sites (ruins / encampments) ----

export function isInAbbeyGrounds(tx: number, ty: number): boolean {
  if (!state.abbeyCenter) return false;
  return Math.max(Math.abs(tx - state.abbeyCenter.x), Math.abs(ty - state.abbeyCenter.y)) <= ABBEY_GROUNDS_RADIUS;
}

// World-gen grounds that resource scatter, forage, wildlife and tree regrowth keep off: the Abbey's
// and the Castle Ruin's.
export function isInReservedGrounds(tx: number, ty: number): boolean {
  return isInAbbeyGrounds(tx, ty) || isInCastleRuinGrounds(tx, ty);
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function shuffled<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function latticeHash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1]: bilinear (smoothstepped) interpolation of a hashed lattice every
// `cellTiles` tiles, so neighboring tiles get similar jitter and edges wobble instead of speckling.
export function edgeJitter(tx: number, ty: number, cellTiles: number, salt: number): number {
  const fx = tx / cellTiles;
  const fy = ty / cellTiles;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const top = latticeHash(ix, iy, salt) * (1 - sx) + latticeHash(ix + 1, iy, salt) * sx;
  const bottom = latticeHash(ix, iy + 1, salt) * (1 - sx) + latticeHash(ix + 1, iy + 1, salt) * sx;
  return (top * (1 - sy) + bottom * sy) * 2 - 1;
}

export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Rejection sampling, same retry-until-attempts-run-out convention as scatterResourceTiles: a
// random tile at least minSpawnDist from the Town Center and minSpacing from every `avoid` point.
export function pickScatteredTile(
  minSpawnDist: number,
  minSpacing: number,
  avoid: TileCoord[],
  isValid?: (t: TileCoord) => boolean
): TileCoord | null {
  for (let attempts = 0; attempts < 1000; attempts++) {
    const t = { x: Math.floor(Math.random() * state.WORLD_TILES_X), y: Math.floor(Math.random() * state.WORLD_TILES_Y) };
    if (tileDistance(t, TOWN_CENTER_TILE) < minSpawnDist) continue;
    if (avoid.some((o) => tileDistance(o, t) < minSpacing)) continue;
    if (isValid && !isValid(t)) continue;
    return t;
  }
  return null;
}

export function generateBiomes() {
  const seeds: { x: number; y: number; radius: number; biome: Biome }[] = [];
  for (let i = 0; i < state.BIOME_SEEDS_PER_KIND * 2; i++) {
    // Alternate so a crowded map that runs out of room still gets both kinds.
    const biome = i % 2 === 0 ? Biome.Hills : Biome.Swamp;
    const radius = randRange(BIOME_SEED_RADIUS_MIN, BIOME_SEED_RADIUS_MAX);
    const minSpawnDist = Math.max(
      SPAWN_CLEAR_RADIUS_TILES,
      radius + BIOME_EDGE_JITTER_TILES + SPAWN_PLAINS_RADIUS_TILES
    );
    const spot = pickScatteredTile(minSpawnDist, BIOME_SEED_MIN_SPACING, seeds);
    if (spot) seeds.push({ x: spot.x, y: spot.y, radius, biome });
  }
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      let nearest: (typeof seeds)[number] | null = null;
      let nearestDist = Infinity;
      for (const seed of seeds) {
        const d = Math.hypot(seed.x - tx, seed.y - ty);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = seed;
        }
      }
      const jitter = edgeJitter(tx, ty, BIOME_NOISE_CELL_TILES, state.worldNoiseSalt) * BIOME_EDGE_JITTER_TILES;
      state.biomes[tileIndex(tx, ty)] =
        nearest && nearestDist <= nearest.radius + jitter ? nearest.biome : Biome.Plains;
    }
  }
}

export function generatePonds() {
  const count = randInt(state.POND_COUNT_MIN, state.POND_COUNT_MAX);
  const centers: TileCoord[] = [];
  for (let i = 0; i < count; i++) {
    const radius = randRange(POND_RADIUS_MIN, POND_RADIUS_MAX);
    const reach = Math.ceil(radius + POND_EDGE_JITTER_TILES);
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + reach,
      POND_MIN_SPACING,
      centers,
      (t) => state.tiles[tileIndex(t.x, t.y)] === TileType.Empty
    );
    if (!center) continue;
    centers.push(center);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const tx = center.x + dx;
        const ty = center.y + dy;
        if (!inBounds(tx, ty)) continue;
        const idx = tileIndex(tx, ty);
        if (state.tiles[idx] !== TileType.Empty) continue;
        const jitter = edgeJitter(tx, ty, POND_NOISE_CELL_TILES, state.worldNoiseSalt + 1) * POND_EDGE_JITTER_TILES;
        if (Math.hypot(dx, dy) <= radius + jitter) state.tiles[idx] = TileType.Water;
      }
    }
  }
}

export function poiSiteFootprintClear(
  center: TileCoord,
  footprintRadius = POI_SITE_FOOTPRINT_RADIUS,
  waterClearance = POI_SITE_WATER_CLEARANCE
): boolean {
  for (let dx = -waterClearance; dx <= waterClearance; dx++) {
    for (let dy = -waterClearance; dy <= waterClearance; dy++) {
      const tx = center.x + dx;
      const ty = center.y + dy;
      const inFootprint = Math.max(Math.abs(dx), Math.abs(dy)) <= footprintRadius;
      if (!inBounds(tx, ty)) {
        if (inFootprint) return false;
        continue;
      }
      const tile = state.tiles[tileIndex(tx, ty)] as TileType;
      if (tile === TileType.Water) return false;
      if (inFootprint && tile !== TileType.Empty) return false;
    }
  }
  return true;
}

export function spawnGuardian(kind: MobKind, tile: TileCoord, siteId: string, siteKind: PoiSiteKind, rollSize = true): Mob {
  const config = MOB_KIND_CONFIG[kind];
  const center = tileToPixelCenter(tile);
  const mob: Mob = {
    id: randomUUID(),
    kind,
    x: center.x,
    y: center.y,
    hp: config.maxHp,
    maxHp: config.maxHp,
    path: [],
    repathCooldown: 0,
    targetType: null,
    targetId: null,
    attackCooldownTicks: 0,
    damage: config.damage,
    speed: config.speed,
    range: config.range,
    melee: config.melee,
    lastDamagedTick: 0,
    healCooldownTicks: 0,
    isDeserter: false,
    deserterActive: false,
    deserterSinceTick: 0,
    siteId,
    siteKind,
    guardianActive: false,
    groupId: null,
    passive: false,
    ...MOB_MARK_DEFAULTS,
  };
  applyMobSize(mob, rollSize);
  mobs.set(mob.id, mob);
  return mob;
}

export function pickWeightedGuardianKind(weights: { kind: MobKind; weight: number }[]): MobKind {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll < 0) return w.kind;
  }
  return weights[0].kind;
}

export function pickRuinGuardianKind(): MobKind {
  return pickWeightedGuardianKind(RUIN_GUARDIAN_WEIGHTS);
}

export function pickEncampmentGuardianKind(): MobKind {
  return pickWeightedGuardianKind(ENCAMPMENT_GUARDIAN_WEIGHTS);
}

// One POI site: a centerpiece decoration tile, 0-3 extra decorations on its 8 neighbors, and a
// group of dormant guardians standing on free tiles next to that cluster, all sharing one siteId.
// Ruins and encampments differ only in the decoration tiles and guardian kinds.
export function placePoiSite(siteKind: "ruin" | "encampment", center: TileCoord) {
  const siteId = randomUUID();
  const centerpiece =
    siteKind === "ruin" ? RUIN_CENTERPIECES[randInt(0, RUIN_CENTERPIECES.length - 1)] : TileType.PropCampfire;
  const extraCount = siteKind === "ruin" ? randInt(0, 2) : randInt(1, 3);
  const extraPool = siteKind === "ruin" ? RUIN_EXTRAS : ENCAMPMENT_EXTRAS;
  const decorations: TileCoord[] = [center];
  state.tiles[tileIndex(center.x, center.y)] = centerpiece;
  for (const offset of shuffled(NEIGHBORS_8).slice(0, extraCount)) {
    const t = { x: center.x + offset.x, y: center.y + offset.y };
    state.tiles[tileIndex(t.x, t.y)] = extraPool[randInt(0, extraPool.length - 1)];
    decorations.push(t);
  }

  const guardianSpots: TileCoord[] = [];
  for (let dx = -POI_SITE_FOOTPRINT_RADIUS; dx <= POI_SITE_FOOTPRINT_RADIUS; dx++) {
    for (let dy = -POI_SITE_FOOTPRINT_RADIUS; dy <= POI_SITE_FOOTPRINT_RADIUS; dy++) {
      const t = { x: center.x + dx, y: center.y + dy };
      if (state.tiles[tileIndex(t.x, t.y)] !== TileType.Empty) continue;
      if (decorations.some((d) => Math.max(Math.abs(d.x - t.x), Math.abs(d.y - t.y)) === 1)) {
        guardianSpots.push(t);
      }
    }
  }
  const guardianCount = siteKind === "ruin" ? randInt(2, 3) : randInt(2, 4);
  const kinds: MobKind[] = [];
  for (const spot of shuffled(guardianSpots).slice(0, guardianCount)) {
    kinds.push(spawnGuardian(siteKind === "ruin" ? pickRuinGuardianKind() : pickEncampmentGuardianKind(), spot, siteId, siteKind).kind);
  }
  // Camp hearths: a site kind with `hasHearth` gets a destroyable hearth on its centrepiece.
  if (SITE_KIND_HAS_HEARTH[siteKind]?.hasHearth) registerHearth(siteId, siteKind, center, kinds);
}

export function generatePoiSites(siteKind: "ruin" | "encampment", count: number, placedSites: TileCoord[]) {
  for (let i = 0; i < count; i++) {
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + POI_SITE_FOOTPRINT_RADIUS,
      POI_SITE_MIN_SPACING,
      placedSites,
      poiSiteFootprintClear
    );
    if (!center) continue;
    placedSites.push(center);
    placePoiSite(siteKind, center);
  }
}

// Saint Wren's Abbey: lays out ABBEY_LAYOUT around a clear spot (grounds + apron all Empty, no
// water) and posts its three resident clergy at the hall. Runs before resources are scattered, so
// the 11x11 clear area is only ever contested by ponds; scatter and tree regrowth then skip the
// grounds (isInReservedGrounds). Adds the Abbey's center to placedSites so later POIs keep their spacing.
export function placeAbbey(placedSites: TileCoord[]) {
  const center = pickScatteredTile(ABBEY_MIN_SPAWN_DIST, POI_SITE_MIN_SPACING, placedSites, (t) =>
    poiSiteFootprintClear(t, ABBEY_GROUNDS_RADIUS, ABBEY_GROUNDS_RADIUS)
  );
  if (!center) return;
  state.abbeyCenter = center;
  placedSites.push(center);
  let hall: TileCoord | null = null;
  for (let ry = 0; ry < ABBEY_LAYOUT.length; ry++) {
    for (let rx = 0; rx < ABBEY_LAYOUT[ry].length; rx++) {
      const tile = ABBEY_LAYOUT_TILES[ABBEY_LAYOUT[ry][rx]];
      if (tile === undefined) continue;
      const t = { x: center.x + rx - ABBEY_FOOTPRINT_RADIUS, y: center.y + ry - ABBEY_FOOTPRINT_RADIUS };
      state.tiles[tileIndex(t.x, t.y)] = tile;
      if (tile === TileType.AbbeyHall) hall = t;
    }
  }
  if (!hall) return;
  for (const offset of ABBEY_CLERGY_OFFSETS) {
    const c = spawnColonistForPost(hall.x, hall.y, "bishop");
    const spot = tileToPixelCenter({ x: center.x + offset.x, y: center.y + offset.y });
    c.x = spot.x;
    c.y = spot.y;
  }
}

export function isInCastleRuinGrounds(tx: number, ty: number): boolean {
  if (!state.castleRuinCenter) return false;
  return Math.max(Math.abs(tx - state.castleRuinCenter.x), Math.abs(ty - state.castleRuinCenter.y)) <= CASTLE_RUIN_GROUNDS_RADIUS;
}

export function makeBoss(mob: Mob, tier: BossTier) {
  const hpMult = tier === "warlord" ? WARLORD_HP_MULT : ELITE_HP_MULT;
  const damageMult = tier === "warlord" ? WARLORD_DAMAGE_MULT : ELITE_DAMAGE_MULT;
  mob.maxHp = Math.round(mob.maxHp * hpMult);
  mob.hp = mob.maxHp;
  mob.damage = Math.round(mob.damage * damageMult);
  mob.boss = tier;
  mob.bossSighted = false;
}

export function formatReward(reward: Partial<Record<ResourceKey, number>>): string {
  return Object.entries(reward)
    .map(([key, n]) => `+${n} ${key}`)
    .join(", ");
}

export function grantReward(reward: Partial<Record<ResourceKey, number>>) {
  for (const [key, n] of Object.entries(reward)) stock[key as ResourceKey] += n ?? 0;
}

// Runs before resources are scattered (right after the Abbey), so the grounds are only contested by
// ponds and the Abbey; scatter and regrowth then skip them (isInReservedGrounds).
export function placeCastleRuin(placedSites: TileCoord[]) {
  const fits = (t: TileCoord) => poiSiteFootprintClear(t, CASTLE_RUIN_GROUNDS_RADIUS, CASTLE_RUIN_GROUNDS_RADIUS);
  const spacing = ABBEY_GROUNDS_RADIUS + CASTLE_RUIN_GROUNDS_RADIUS + 2;
  let center: TileCoord | null = null;
  for (const fraction of CASTLE_RUIN_SPAWN_DIST_FRACTIONS) {
    center = pickScatteredTile(Math.floor(state.WORLD_TILES_X * fraction), spacing, placedSites, fits);
    if (center) break;
  }
  center ??= pickScatteredTile(SPAWN_CLEAR_RADIUS_TILES + CASTLE_RUIN_GROUNDS_RADIUS, spacing, placedSites, fits);
  if (!center) return;
  state.castleRuinCenter = center;
  placedSites.push(center);
  const siteId = randomUUID();
  const open: TileCoord[] = [];
  for (let ry = 0; ry < CASTLE_RUIN_LAYOUT.length; ry++) {
    for (let rx = 0; rx < CASTLE_RUIN_LAYOUT[ry].length; rx++) {
      const t = { x: center.x + rx - CASTLE_RUIN_FOOTPRINT_RADIUS, y: center.y + ry - CASTLE_RUIN_FOOTPRINT_RADIUS };
      const tile = CASTLE_RUIN_LAYOUT_TILES[CASTLE_RUIN_LAYOUT[ry][rx]];
      if (tile !== undefined) state.tiles[tileIndex(t.x, t.y)] = tile;
      // Guardians stand on the open ground inside the walls (not in the gate gaps, not on the boss).
      else if (CASTLE_RUIN_LAYOUT[ry][rx] === "." && rx > 0 && ry > 0 && rx < CASTLE_RUIN_LAYOUT.length - 1 && ry < CASTLE_RUIN_LAYOUT.length - 1) open.push(t);
    }
  }
  makeBoss(spawnGuardian("ogre", center, siteId, "castleRuin", false), "warlord");
  const count = randInt(CASTLE_RUIN_GUARDIANS_MIN, CASTLE_RUIN_GUARDIANS_MAX);
  for (const spot of shuffled(open).slice(0, count)) {
    spawnGuardian(pickWeightedGuardianKind(CASTLE_RUIN_GUARDIAN_WEIGHTS), spot, siteId, "castleRuin");
  }
}

// After the ruins and encampments, same spacing rules. No decoration: just the pack, the elite on
// the centre tile and its followers on free neighbours.
export function generateMiniBossSites(count: number, placedSites: TileCoord[]) {
  for (let i = 0; i < count; i++) {
    const center = pickScatteredTile(
      SPAWN_CLEAR_RADIUS_TILES + POI_SITE_FOOTPRINT_RADIUS,
      POI_SITE_MIN_SPACING,
      placedSites,
      poiSiteFootprintClear
    );
    if (!center) continue;
    placedSites.push(center);
    const siteId = randomUUID();
    const kind = MINI_BOSS_KINDS[randInt(0, MINI_BOSS_KINDS.length - 1)];
    makeBoss(spawnGuardian(kind, center, siteId, "miniBoss", false), "elite");
    for (const offset of shuffled(NEIGHBORS_8).slice(0, randInt(2, 4))) {
      spawnGuardian(kind, { x: center.x + offset.x, y: center.y + offset.y }, siteId, "miniBoss");
    }
  }
}

export function onBossKilled(mob: Mob) {
  const title = bossTitle(mob.kind, mob.boss!);
  if (mob.boss === "warlord") {
    state.castleCleared = true;
    grantReward(WARLORD_REWARD);
    const gear = grantTieredEquipment(BOSS_EQUIP_LOOT.warlord, "warlord");
    broadcastEvent("boss", `The ${title} has fallen — the Castle Ruin is cleared! (${formatReward(WARLORD_REWARD)}, ${gear})`);
    evaluateGoals();
  } else {
    grantReward(ELITE_REWARD);
    const gear = grantTieredEquipment(BOSS_EQUIP_LOOT.elite, "elite");
    broadcastEvent("boss", `The ${title} is slain (${formatReward(ELITE_REWARD)}, ${gear})`);
  }
}

// Once per boss: the first time a player (vision radius VISION_RADIUS_PLAYER) or one of the colony's
// colonists (VISION_RADIUS_COLONIST) has it in live vision. Checked once a second.
export function checkBossSightings() {
  for (const mob of mobs.values()) {
    if (!mob.boss || mob.bossSighted) continue;
    const seen =
      Array.from(players.values()).some(
        (p) => !p.dead && Math.hypot(p.x - mob.x, p.y - mob.y) <= VISION_RADIUS_PLAYER * TILE_SIZE
      ) ||
      Array.from(colonists.values()).some(
        (c) => !isAbbeyClergy(c) && Math.hypot(c.x - mob.x, c.y - mob.y) <= VISION_RADIUS_COLONIST * TILE_SIZE
      );
    if (!seen) continue;
    mob.bossSighted = true;
    const title = bossTitle(mob.kind, mob.boss);
    broadcastEvent(
      "boss",
      mob.boss === "warlord" ? `The ${title} has been sighted at the Castle Ruin` : `A ${title} has been sighted`
    );
  }
}

// Full world regeneration (boot + restart). Callers must clear `mobs` and `colonists` first: this
// spawns the new world's POI guardians and Abbey clergy into them. Order: biomes (own layer) ->
// ponds -> Abbey -> Castle Ruin -> resources -> wild forage -> POI sites -> mini-boss packs -> wild game, each step only ever writing onto Empty tiles, so nothing
// lands on top of anything placed before it.
// Re-allocates every world-size-dependent module value for a new size (call before generateWorld, after
// clearing mobs/colonists). A no-op when the size is unchanged.
export function setWorldSize(size: number) {
  size = clampWorldSize(size);
  if (size === state.WORLD_TILES_X) return;
  state.WORLD_TILES_X = state.WORLD_TILES_Y = size;
  state.WORLD_AREA_SCALE = (size * size) / (80 * 80);
  state.worldWidth = size * TILE_SIZE;
  state.worldHeight = size * TILE_SIZE;
  const cells = size * size;
  state.tiles = new Uint8Array(cells).fill(TileType.Empty);
  state.biomes = new Uint8Array(cells).fill(Biome.Plains);
  state.explored = new Uint8Array(cells);
  state.cellHead = new Int32Array(cells);
  state.routeCost = new Float64Array(cells);
  state.routeParent = new Int32Array(cells);
  TOWN_CENTER_TILE.x = TOWN_CENTER_TILE.y = Math.floor(size / 2);
  state.TREE_COUNT = scaledCount(96);
  state.IRON_ORE_COUNT = scaledCount(56);
  state.ROCK_COUNT = scaledCount(64);
  state.MAX_TREES = scaledCount(200);
  state.BERRY_BUSH_COUNT = scaledCount(24);
  state.FRUIT_TREE_COUNT = scaledCount(12);
  state.MUSHROOM_PATCH_COUNT = scaledCount(10);
  state.WILDLIFE_RESPAWN_PER_DAY = Math.max(1, scaledCountSub(4));
  WILDLIFE_CONFIG.deer.cap = scaledCountSub(6);
  WILDLIFE_CONFIG.rabbit.cap = scaledCountSub(8);
  WILDLIFE_CONFIG.boar.cap = scaledCountSub(3);
  WILDLIFE_CONFIG.pheasant.cap = scaledCountSub(4);
  state.BIOME_SEEDS_PER_KIND = scaledCount(5);
  state.POND_COUNT_MIN = scaledCount(8);
  state.POND_COUNT_MAX = scaledCount(12);
  state.RUIN_SITE_COUNT_MIN = scaledCountSub(6);
  state.RUIN_SITE_COUNT_MAX = scaledCountSub(10);
  state.ENCAMPMENT_SITE_COUNT_MIN = scaledCountSub(6);
  state.ENCAMPMENT_SITE_COUNT_MAX = scaledCountSub(10);
  state.MINI_BOSS_SITE_COUNT_MIN = Math.max(1, scaledCountSub(0.75));
  state.MINI_BOSS_SITE_COUNT_MAX = Math.max(1, scaledCountSub(1.25));
}

export function generateWorld() {
  const genStart = performance.now();
  state.tiles.fill(TileType.Empty);
  state.biomes.fill(Biome.Plains);
  state.worldNoiseSalt = Math.floor(Math.random() * 0x7fffffff);
  state.abbeyCenter = null;
  state.castleRuinCenter = null;
  hearths.clear();
  clearOwners();
  resetGoals();
  state.tiles[tileIndex(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y)] = TileType.TownCenter;
  state.townCenters = [{ x: TOWN_CENTER_TILE.x, y: TOWN_CENTER_TILE.y, level: 1, hp: townCenterMaxHp(1) }];
  generateBiomes();
  generatePonds();
  const placedSites: TileCoord[] = [];
  placeAbbey(placedSites);
  placeCastleRuin(placedSites);
  scatterResourceTiles(TileType.Tree, state.TREE_COUNT);
  scatterResourceTiles(TileType.IronOre, state.IRON_ORE_COUNT);
  scatterResourceTiles(TileType.Rock, state.ROCK_COUNT);
  generateForage();
  generatePoiSites("ruin", randInt(state.RUIN_SITE_COUNT_MIN, state.RUIN_SITE_COUNT_MAX), placedSites);
  generatePoiSites("encampment", randInt(state.ENCAMPMENT_SITE_COUNT_MIN, state.ENCAMPMENT_SITE_COUNT_MAX), placedSites);
  generateMiniBossSites(randInt(state.MINI_BOSS_SITE_COUNT_MIN, state.MINI_BOSS_SITE_COUNT_MAX), placedSites);
  spawnInitialWildlife();
  resetExplored();
  topUpTownCenterBuilders(state.townCenters[0]);
  console.log(`[world] generated ${state.WORLD_TILES_X}x${state.WORLD_TILES_Y} in ${(performance.now() - genStart).toFixed(0)} ms`);
}
