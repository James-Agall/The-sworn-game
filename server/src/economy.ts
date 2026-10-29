// economy.ts: Stock, gathering, tree growth, synergies, crafting recipes, farms and farm stages, markets.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TileType, type ColonistKind, FarmStage } from "@colony/shared/protocol";
import type { Colonist, FarmPlotState, ResourceKey, TileCoord } from "./types.js";
import {
  ARMY_SYNERGY_PER_NEIGHBOUR, BARN_FARM_RADIUS_TILES, BARN_MAX_FARM_PLOTS, CHOP_TICKS, CRAFT_TICKS, EXCHANGE_RATES,
  FARMHAND_CYCLE_TICKS, FARM_FALLOW_TICKS, FARM_GROW_TICKS, FARM_HARVESTED_SHOW_TICKS, FARM_HARVESTS_BEFORE_FALLOW,
  FARM_HARVEST_TICKS, FARM_SOWN_FRACTION, FARM_SPROUTING_FRACTION, FARM_YIELD_PER_HARVEST, GOLD_SHOP_PRICES,
  HEMP_GROWING_FROM, HEMP_RIPE_FROM, INDUSTRIAL_SYNERGY_PER_BUILDING, INDUSTRIAL_SYNERGY_RADIUS, INDUSTRIAL_TILES,
  LUMBERJACK_TREE_RADIUS, LUMBERJACK_WOOD_PER_TRIP, NEIGHBOURS_8, ORCHARD_BLOSSOM_UNTIL, ORCHARD_FRUITING_FROM,
  PASTURE_FAT_FROM, POST_TILE_TYPES, SHEEP_READY_FROM, SHEEP_WOOLLY_FROM, STARTING_GRAIN, STARTING_IRON,
  STARTING_ROCK, STARTING_WOOD,
} from "./constants.js";
import { colonists, farmPlots, players, reservedResourceTiles, state, wildlife } from "./state.js";
import {
  biomeProductionFactor, getBuildingLevel, inBounds, levelBonus, resourceKey, tileIndex, tileOccupiedByEntity,
  tileOfPixel,
} from "./tiles.js";
import { isInReservedGrounds } from "./worldgen.js";
import { countTilesOfType, isMilitaryTile, productionSpeedMultiplier, townCenterBonus } from "./colonists.js";
import { broadcastTileUpdate } from "./net.js";
import { clanById, clanIdAt } from "./clans.js";

export function initialStock(): Record<ResourceKey, number> {
  return {
    wood: STARTING_WOOD,
    iron: STARTING_IRON,
    rock: STARTING_ROCK,
    grain: STARTING_GRAIN,
    meat: 0,
    fruit: 0,
    wool: 0,
    cotton: 0,
    clothes: 0,
    tools: 0,
    luxuryItems: 0,
    gold: 0,
    alcohol: 0,
  };
}

// Clan 0's starting stock (state.stock forwards to the active clan, see state.ts ClanFields).
state.stock = initialStock();

export function releaseResourceReservation(c: Colonist) {
  // A builder leaving its site (night shelter, death, desertion) frees its slot there; the site stays.
  c.buildSiteKey = null;
  c.repairKey = null;
  if (c.targetWildlifeId !== null) {
    const animal = wildlife.get(c.targetWildlifeId);
    if (animal && animal.reservedBy === c.id) animal.reservedBy = null;
    c.targetWildlifeId = null;
  }
  if (c.targetResourceX < 0 || c.targetResourceY < 0) return;
  const key = resourceKey(c.targetResourceX, c.targetResourceY);
  if (reservedResourceTiles.get(key) === c.id) {
    reservedResourceTiles.delete(key);
  }
}

export function isAdjacentToPlayerOrPost(tx: number, ty: number): boolean {
  for (const p of players.values()) {
    const t = tileOfPixel(p.x, p.y);
    if (Math.abs(t.x - tx) + Math.abs(t.y - ty) <= 1) return true;
  }
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  for (const n of neighbors) {
    if (!inBounds(n.x, n.y)) continue;
    if (POST_TILE_TYPES.includes(state.tiles[tileIndex(n.x, n.y)] as TileType)) return true;
  }
  return false;
}

export function tryGrowTree() {
  if (countTilesOfType(TileType.Tree) >= state.MAX_TREES) return;
  const candidates: TileCoord[] = [];
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      if (
        state.tiles[tileIndex(tx, ty)] === TileType.Empty &&
        !tileOccupiedByEntity(tx, ty) &&
        !isAdjacentToPlayerOrPost(tx, ty) &&
        !isInReservedGrounds(tx, ty)
      ) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }
  if (candidates.length === 0) return;
  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  state.tiles[tileIndex(spot.x, spot.y)] = TileType.Tree;
  broadcastTileUpdate(spot.x, spot.y, TileType.Tree);
}

export function tryGrowTreesNearLumberjackPosts() {
  if (countTilesOfType(TileType.Tree) >= state.MAX_TREES) return;
  const posts: TileCoord[] = [];
  for (let tx = 0; tx < state.WORLD_TILES_X; tx++) {
    for (let ty = 0; ty < state.WORLD_TILES_Y; ty++) {
      if (state.tiles[tileIndex(tx, ty)] === TileType.LumberjackPost) posts.push({ x: tx, y: ty });
    }
  }
  for (const post of posts) {
    if (countTilesOfType(TileType.Tree) >= state.MAX_TREES) return;
    const candidates: TileCoord[] = [];
    for (let dx = -LUMBERJACK_TREE_RADIUS; dx <= LUMBERJACK_TREE_RADIUS; dx++) {
      for (let dy = -LUMBERJACK_TREE_RADIUS; dy <= LUMBERJACK_TREE_RADIUS; dy++) {
        const tx = post.x + dx;
        const ty = post.y + dy;
        if (!inBounds(tx, ty)) continue;
        if (state.tiles[tileIndex(tx, ty)] !== TileType.Empty) continue;
        if (tileOccupiedByEntity(tx, ty)) continue;
        if (isAdjacentToPlayerOrPost(tx, ty)) continue;
        if (isInReservedGrounds(tx, ty)) continue;
        candidates.push({ x: tx, y: ty });
      }
    }
    if (candidates.length === 0) continue;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    state.tiles[tileIndex(spot.x, spot.y)] = TileType.Tree;
    broadcastTileUpdate(spot.x, spot.y, TileType.Tree);
  }
}

export function depositGatheredResource(kind: ColonistKind) {
  if (kind === "lumberjack") state.stock.wood += LUMBERJACK_WOOD_PER_TRIP;
  else if (kind === "ironMiner") state.stock.iron += 1;
  else if (kind === "rockMiner") state.stock.rock += 1;
}

export function industrialSynergyMultiplier(tx: number, ty: number): number {
  if (!INDUSTRIAL_TILES.includes(state.tiles[tileIndex(tx, ty)] as TileType)) return 1;
  let others = 0;
  for (let y = ty - INDUSTRIAL_SYNERGY_RADIUS; y <= ty + INDUSTRIAL_SYNERGY_RADIUS; y++) {
    for (let x = tx - INDUSTRIAL_SYNERGY_RADIUS; x <= tx + INDUSTRIAL_SYNERGY_RADIUS; x++) {
      if ((x === tx && y === ty) || !inBounds(x, y)) continue;
      if (INDUSTRIAL_TILES.includes(state.tiles[tileIndex(x, y)] as TileType)) others++;
    }
  }
  return 1 + others * INDUSTRIAL_SYNERGY_PER_BUILDING;
}

export function armyDamageMultiplier(tx: number, ty: number): number {
  let bonus = 0;
  for (const [dx, dy] of NEIGHBOURS_8) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inBounds(nx, ny)) continue;
    const t = state.tiles[tileIndex(nx, ny)] as TileType;
    if (isMilitaryTile(t) || t === TileType.Blacksmith) bonus += ARMY_SYNERGY_PER_NEIGHBOUR;
  }
  return 1 + bonus + townCenterBonus();
}

export function effectiveChopTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((CHOP_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

// Same multipliers as effectiveChopTicks, on the farmhand's multi-day cycle.
export function effectiveFarmhandCycleTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(
    1,
    Math.round((FARMHAND_CYCLE_TICKS * (1 - levelBonus(level)) * biomeProductionFactor(tx, ty)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty)))
  );
}

export function effectiveCraftTicks(tx: number, ty: number): number {
  const level = getBuildingLevel(tx, ty);
  return Math.max(1, Math.round((CRAFT_TICKS * (1 - levelBonus(level))) / (productionSpeedMultiplier() * industrialSynergyMultiplier(tx, ty))));
}

export function isBarnStaffed(bx: number, by: number): boolean {
  for (const c of colonists.values()) {
    if (c.kind === "farmer" && c.postX === bx && c.postY === by) return true;
  }
  return false;
}

export function farmPlotCountForBarn(bx: number, by: number): number {
  let n = 0;
  for (const plot of farmPlots.values()) if (plot.barnX === bx && plot.barnY === by) n++;
  return n;
}

// The Barn a new Farm Plot at (tx, ty) would belong to: the nearest one within BARN_FARM_RADIUS_TILES
// that still has room (fewer than BARN_MAX_FARM_PLOTS plots), else null (the plot can't go there).
export function barnForNewFarmPlot(tx: number, ty: number): TileCoord | null {
  let best: TileCoord | null = null;
  let bestD = Infinity;
  for (let y = ty - BARN_FARM_RADIUS_TILES; y <= ty + BARN_FARM_RADIUS_TILES; y++) {
    for (let x = tx - BARN_FARM_RADIUS_TILES; x <= tx + BARN_FARM_RADIUS_TILES; x++) {
      if (!inBounds(x, y) || state.tiles[tileIndex(x, y)] !== TileType.BarnPost) continue;
      const d = Math.hypot(x - tx, y - ty);
      if (d >= bestD || farmPlotCountForBarn(x, y) >= BARN_MAX_FARM_PLOTS) continue;
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

export function farmPlotIndices(state: FarmPlotState["state"]): number[] {
  const result: number[] = [];
  for (const [plotKey, plot] of farmPlots) {
    if (plot.state !== state) continue;
    const [plotX, plotY] = plotKey.split(",").map(Number);
    result.push(tileIndex(plotX, plotY));
  }
  return result;
}

// Grow / harvest phase length for a plot, scaled by its Barn's level and synergy, its own biome and
// colony happiness (fallow is never scaled).
export function effectiveFarmPlotTicks(base: number, plotX: number, plotY: number, plot: FarmPlotState): number {
  const bonus = levelBonus(getBuildingLevel(plot.barnX, plot.barnY));
  return Math.max(
    1,
    Math.round(
      (base * (1 - bonus) * biomeProductionFactor(plotX, plotY)) /
        (productionSpeedMultiplier() * industrialSynergyMultiplier(plot.barnX, plot.barnY))
    )
  );
}

export function sowFarmPlot(plot: FarmPlotState, ticks: number) {
  plot.state = "sown";
  plot.growTicksRemaining = ticks;
  plot.growTicksTotal = ticks;
}

export function newFarmPlot(barnX: number, barnY: number): FarmPlotState {
  const plot: FarmPlotState = {
    barnX,
    barnY,
    growTicksRemaining: 0,
    growTicksTotal: 0,
    harvestTicksRemaining: 0,
    harvestsSinceFallow: 0,
    fallowTicksRemaining: 0,
    harvestedTicksRemaining: 0,
    state: "sown",
  };
  // The first sowing is the flat FARM_GROW_TICKS (as before: the plot's multipliers apply from the
  // second cycle on).
  sowFarmPlot(plot, FARM_GROW_TICKS);
  return plot;
}

export function updateFarmPlots() {
  for (const [plotKey, plot] of farmPlots) {
    // A resting field recovers on its own; only re-sowing it needs the farmer.
    if (plot.state === "fallow" && plot.fallowTicksRemaining > 0) plot.fallowTicksRemaining--;
    if (plot.harvestedTicksRemaining > 0) plot.harvestedTicksRemaining--;
    if (state.tiles[tileIndex(plot.barnX, plot.barnY)] !== TileType.BarnPost) continue;
    if (!isBarnStaffed(plot.barnX, plot.barnY)) continue;
    const [plotX, plotY] = plotKey.split(",").map(Number);
    if (plot.state === "fallow") {
      if (plot.fallowTicksRemaining <= 0) sowFarmPlot(plot, effectiveFarmPlotTicks(FARM_GROW_TICKS, plotX, plotY, plot));
    } else if (plot.state === "harvesting") {
      plot.harvestTicksRemaining--;
      if (plot.harvestTicksRemaining <= 0) {
        // Clans: the barn's clan gets the grain.
        clanById(clanIdAt(plot.barnX, plot.barnY)).stock.grain += FARM_YIELD_PER_HARVEST;
        plot.harvestsSinceFallow++;
        plot.harvestedTicksRemaining = FARM_HARVESTED_SHOW_TICKS;
        if (plot.harvestsSinceFallow >= FARM_HARVESTS_BEFORE_FALLOW) {
          plot.harvestsSinceFallow = 0;
          plot.state = "fallow";
          plot.fallowTicksRemaining = FARM_FALLOW_TICKS;
        } else {
          sowFarmPlot(plot, effectiveFarmPlotTicks(FARM_GROW_TICKS, plotX, plotY, plot));
        }
      }
    } else {
      plot.growTicksRemaining--;
      if (plot.state === "sown" && plot.growTicksRemaining <= plot.growTicksTotal * (1 - FARM_SOWN_FRACTION)) {
        plot.state = "growing";
      }
      if (plot.growTicksRemaining <= 0) {
        plot.state = "harvesting";
        plot.harvestTicksRemaining = effectiveFarmPlotTicks(FARM_HARVEST_TICKS, plotX, plotY, plot);
      }
    }
  }
}

// 0..1 through the plot's current grow phase (1 while ripe/fallow).
export function farmPlotProgress(plot: FarmPlotState): number {
  if (plot.state === "harvesting" || plot.state === "fallow") return 1;
  return plot.growTicksTotal > 0 ? 1 - plot.growTicksRemaining / plot.growTicksTotal : 0;
}

export function farmPlotStage(plot: FarmPlotState): FarmStage {
  if (plot.state === "harvesting") return FarmStage.Ripe;
  if (plot.state === "fallow") return FarmStage.Fallow;
  if (plot.harvestedTicksRemaining > 0) return FarmStage.Harvested;
  const p = farmPlotProgress(plot);
  if (p < FARM_SOWN_FRACTION) return FarmStage.Sown;
  return p < FARM_SPROUTING_FRACTION ? FarmStage.Sprouting : FarmStage.Growing;
}

// 0..1 through a farmhand's current produce cycle (the batch lands at 1).
export function farmhandProgress(c: Colonist): number {
  return c.cycleTicksTotal > 0 ? Math.min(1, Math.max(0, 1 - c.chopTicksRemaining / c.cycleTicksTotal)) : 0;
}

export function farmhandFarmStage(tile: TileType, p: number): FarmStage | null {
  if (tile === TileType.CottonFarm) return p < HEMP_GROWING_FROM ? FarmStage.Sown : p < HEMP_RIPE_FROM ? FarmStage.Growing : FarmStage.Ripe;
  if (tile === TileType.Pasture) return p < PASTURE_FAT_FROM ? FarmStage.Growing : FarmStage.Fat;
  if (tile === TileType.WoolFarm) return p < SHEEP_WOOLLY_FROM ? FarmStage.Sheared : p < SHEEP_READY_FROM ? FarmStage.Woolly : FarmStage.Ripe;
  if (tile === TileType.Orchard) {
    return p < ORCHARD_BLOSSOM_UNTIL ? FarmStage.Blossoming : p < ORCHARD_FRUITING_FROM ? FarmStage.Growing : FarmStage.Fruiting;
  }
  return null;
}

// Flattened [tile index, FarmStage] for every grain plot and every staffed animal/orchard/hemp farm.
export function farmStagesForSnapshot(): number[] {
  const out: number[] = [];
  for (const [plotKey, plot] of farmPlots) {
    const [plotX, plotY] = plotKey.split(",").map(Number);
    out.push(tileIndex(plotX, plotY), farmPlotStage(plot));
  }
  const seen = new Set<number>();
  for (const c of colonists.values()) {
    if (c.kind !== "farmhand") continue;
    const index = tileIndex(c.postX, c.postY);
    if (seen.has(index)) continue;
    const stage = farmhandFarmStage(state.tiles[index] as TileType, farmhandProgress(c));
    if (stage === null) continue;
    seen.add(index);
    out.push(index, stage);
  }
  return out;
}

export function handleExchangeResource(from: "wood" | "iron" | "rock", to: "wood" | "iron" | "rock") {
  if (!state.marketBuilt || from === to) return;
  const rate = EXCHANGE_RATES[from]?.[to];
  if (!rate) return;
  if (state.stock[from] < rate.give) return;
  state.stock[from] -= rate.give;
  state.stock[to] += rate.get;
}

export function handleBuyWithGold(item: "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock") {
  if (!state.goldShopBuilt) return;
  const price = GOLD_SHOP_PRICES[item];
  if (!price) return;
  if (state.stock.gold < price.cost) return;
  state.stock.gold -= price.cost;
  (state.stock as Record<string, number>)[item] += price.amount;
}
