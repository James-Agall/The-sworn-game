// Progression tree (docs/colony2d/PLAN-progression-tree.md; ROADMAP "Progression tree — landed"): the server side
// of shared/src/progression.ts. Clan items (per quality grade), the sticky unlocked set, placement / upgrade
// gates, hand crafting, the `progression` snapshot and old-save grandfathering.
import { TICK_RATE, TileType, type ProgressionSnapshot } from "@colony/shared/protocol";
import {
  type ItemId, type Profession, type ProgressContext, type Recipe, MAX_QUALITY, PROFESSION_LABEL, PROGRESSION,
  PROGRESSION_BUILDING_LABEL, QUALITY_GRADES, TIER_SPEED_BONUS, WORKER_XP_LEVELS, levelForXp, recipeById, recipeCostText,
  FOOD_ITEMS, stationRecipes, unmetRequirements, xpToNext,
} from "@colony/shared/progression";
import type { Colonist, Player, ResourceKey } from "./types.js";
import { type Clan, type ClanProgress, colonists, newClanProgress, state } from "./state.js";
import { getBuildingLevel, isNightNow, tileIndex, tileOfPixel } from "./tiles.js";
import { tileIndicesOf } from "./chunks.js";
import { clanById, clanIdAtIndex, forEachClan, townCentersOfClan, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { GAME_DAY_TICKS, UPGRADE_NAMES } from "./constants.js";
import { currentBuildingLevel, sendEvent } from "./construction.js";

// True when no gate applies: creative with "Unlock all" on, or the test-only unlock (COLONY_UNLOCK_ALL).
export function gatesOpen(): boolean {
  return state.testUnlockAll || (state.creative && state.creativeUnlockAll);
}

// ---- items ----
export function itemCount(id: ItemId): number {
  return (state.progress.items[id] ?? []).reduce((a, b) => a + b, 0);
}

export function addItem(id: ItemId, n: number, quality = 1) {
  const q = Math.min(Math.max(Math.round(quality), 1), MAX_QUALITY);
  const grades = (state.progress.items[id] ??= [0, 0, 0]);
  grades[q - 1] += n;
  snapshotDirty.add(state.clan.id);
}

// Takes n of `id`, poorest grade first. False (nothing taken) when the stock is short.
export function takeItem(id: ItemId, n: number): boolean {
  if (itemCount(id) < n) return false;
  const grades = state.progress.items[id]!;
  for (let q = 0; q < grades.length && n > 0; q++) {
    const take = Math.min(grades[q], n);
    grades[q] -= take;
    n -= take;
  }
  snapshotDirty.add(state.clan.id);
  return true;
}

function itemTotals(): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const id of Object.keys(state.progress.items) as ItemId[]) out[id] = itemCount(id);
  return out;
}

// ---- context ----
// Building types the table's `buildings` gates name (only these are counted).
const GATE_TILES: TileType[] = (() => {
  const set = new Set<TileType>();
  for (const row of Object.values(PROGRESSION.buildings)) {
    for (const req of [row?.requires, ...Object.values(row?.levels ?? {})]) for (const b of req?.buildings ?? []) set.add(b.tile);
  }
  return [...set];
})();

function standingLevels(): Partial<Record<number, number>> {
  const out: Partial<Record<number, number>> = {};
  const W = state.WORLD_TILES_X;
  for (const t of GATE_TILES) {
    let best = 0;
    for (const i of tileIndicesOf(t)) {
      if (clanIdAtIndex(i) !== state.clan.id) continue;
      best = Math.max(best, currentBuildingLevel(i % W, Math.floor(i / W), t));
    }
    if (best > 0) out[t] = best;
  }
  return out;
}

export function progressContext(): ProgressContext {
  return {
    items: itemTotals(),
    buildings: standingLevels(),
    day: Math.max(0, Math.floor(state.cycleTick / GAME_DAY_TICKS) - state.clan.foundedDay),
  };
}

function buildingLabel(tile: TileType): string {
  return PROGRESSION_BUILDING_LABEL[tile] ?? UPGRADE_NAMES[tile] ?? "That";
}

// ---- gates ----
// Why placing `tile` on `current` at (tx, ty) is refused by the tree ("" = allowed). upgradeInPlace: a level-up.
export function progressionBlocker(tile: TileType, current: TileType, tx: number, ty: number, upgradeInPlace: boolean): string {
  if (gatesOpen()) return "";
  const row = PROGRESSION.buildings[tile];
  if (!upgradeInPlace) {
    if (!row) return "";
    if (!row.requires || state.progress.unlocked.includes(tile)) return "";
    const unmet = unmetRequirements(row.requires, progressContext());
    return unmet.length > 0 ? `${buildingLabel(tile)} needs: ${unmet.join(", ")}` : "";
  }
  const next = currentBuildingLevel(tx, ty, current) + 1;
  const unmet = unmetUpgrade(tx, ty, current, next);
  return unmet.length > 0 ? `Level ${next} ${buildingLabel(tile)} needs: ${unmet.join(", ")}` : "";
}

// Unmet gates for raising the station at (tx, ty) to `next`: the table's `levels` row, and (phase 2) the
// upgrade-by-worker rule: a staffed station's best worker must already be level `next`.
function unmetUpgrade(tx: number, ty: number, t: TileType, next: number): string[] {
  const prof = PROGRESSION.stations[t];
  const ctx = { ...progressContext(), workerLevel: prof ? workerLevelAt(tx, ty) : undefined };
  const req = { ...(PROGRESSION.buildings[t]?.levels?.[next as 2 | 3] ?? {}), ...(prof ? { workerLevel: next } : {}) };
  return unmetRequirements(req, ctx, prof ? PROFESSION_LABEL[prof] : "Worker");
}

// Building info lines (null: nothing to show): each worker's profession level and XP, the tier the station works
// at (speed, quality), and the tree gates on the next level.
export function progressionInfo(tx: number, ty: number, t: TileType): string[] | null {
  const prof = PROGRESSION.stations[t];
  const lines: string[] = [];
  const level = currentBuildingLevel(tx, ty, t);
  if (prof) {
    const workers = workersAt(tx, ty);
    for (const c of workers) {
      const xp = Math.floor(c.person!.xp?.[prof] ?? 0);
      const toNext = xpToNext(xp);
      lines.push(`${c.person!.name}: ${PROFESSION_LABEL[prof]} L${levelForXp(xp)} (${xp} XP${toNext === null ? ", master" : `, ${toNext} to next`})`);
    }
    const tier = Math.min(level, workerLevelAt(tx, ty));
    for (const c of workers) {
      const job = stationJobs.get(c.id);
      if (job) lines.push(`Making: ${PROGRESSION.items[job.recipe.output].label} (${Math.round(100 * (1 - job.left / job.total))}%)`);
    }
    if (workers.length > 0 && stationRecipes(t).length > 0 && ![...workers].some((c) => stationJobs.has(c.id))) lines.push(`Idle: ${stationIdleReason(t)}`);
    if (t === TileType.IronMinePost || t === TileType.RockMinePost) lines.push(depositLine(tx, ty));
    if (workers.length > 0) lines.push(`Works at tier ${tier} of ${level}: speed x${tierSpeed(tier).toFixed(2)}, quality ${QUALITY_GRADES[Math.min(tier, MAX_QUALITY) - 1].label}`);
  }
  if (!gatesOpen() && level < 3 && (prof || PROGRESSION.buildings[t]?.levels)) {
    const unmet = unmetUpgrade(tx, ty, t, level + 1);
    if (unmet.length > 0) lines.push(`Level ${level + 1} needs: ${unmet.join(", ")}`);
  }
  return lines.length > 0 ? lines : null;
}

// ---- workers (phase 2): XP per profession, levels, the tier a station works at ----
function workersAt(tx: number, ty: number): Colonist[] {
  const out: Colonist[] = [];
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && c.person && !c.training && !c.callUp) out.push(c);
  return out;
}

export function professionOf(c: Colonist): Profession | undefined {
  if (c.postX < 0 || c.postY < 0 || c.postX >= state.WORLD_TILES_X || c.postY >= state.WORLD_TILES_Y) return undefined;
  return PROGRESSION.stations[state.tiles[tileIndex(c.postX, c.postY)] as TileType];
}

export function workerLevel(c: Colonist): number {
  const prof = professionOf(c);
  return prof ? levelForXp(c.person?.xp?.[prof] ?? 0) : 1;
}

// The best level among the station's workers (0: nobody posted).
export function workerLevelAt(tx: number, ty: number): number {
  let best = 0;
  for (const c of workersAt(tx, ty)) best = Math.max(best, workerLevel(c));
  return best;
}

function tierSpeed(tier: number): number {
  return 1 + TIER_SPEED_BONUS * (Math.max(1, tier) - 1);
}

// The tier a worker runs its station at: min(station level, worker level), capped at 3 (= its output quality).
export function effectiveTier(c: Colonist): number {
  return Math.min(getBuildingLevel(c.postX, c.postY), workerLevel(c), MAX_QUALITY);
}

// Work-timer step per tick (1 = as before the tree): +25% per effective tier above 1. Off with COLONY_UNLOCK_ALL.
export function workSpeed(c: Colonist): number {
  if (state.testUnlockAll || !c.person) return 1;
  return tierSpeed(effectiveTier(c));
}

// Once a second: every person working a station gains 1 XP in its profession (not at night, sheltering, a child,
// a trainee or levied). A level-up toasts the clan.
export function updateWorkerXp() {
  if (isNightNow()) return;
  for (const c of colonists.values()) {
    if (!c.person || c.person.child || c.training || c.callUp || c.sheltering || c.state === "idle") continue;
    const prof = professionOf(c);
    if (!prof) continue;
    const xp = (c.person.xp ??= {});
    const before = levelForXp(xp[prof] ?? 0);
    xp[prof] = (xp[prof] ?? 0) + 1;
    const after = levelForXp(xp[prof]!);
    if (after > before) {
      const name = c.person.name;
      withClan(clanById(c.clan ?? 0), () => broadcastEvent("build", `${name} is now a level-${after} ${PROFESSION_LABEL[prof]}`));
    }
  }
}

// ---- station recipes (phase 3): an artisan at a tree station works the first recipe it can ----
interface StationJob { recipe: Recipe; left: number; total: number }
// Colonist id -> its job in progress (not saved: a load restarts every station's current batch).
const stationJobs = new Map<string, StationJob>();

export function recipeReady(r: Recipe): boolean {
  if (r.cap !== undefined && itemCount(r.output) >= r.cap) return false;
  if (!state.creative) for (const [k, n] of Object.entries(r.stock ?? {})) if (state.stock[k as ResourceKey] < (n ?? 0)) return false;
  for (const [id, n] of Object.entries({ ...(r.items ?? {}), ...(r.needs ?? {}) }) as [ItemId, number][]) if (itemCount(id) < n) return false;
  return true;
}

// "Iron bloom: short of Charcoal; Anvil: 1 in store (enough)".
export function stationIdleReason(t: TileType): string {
  const parts = stationRecipes(t).map((r) => {
    const name = PROGRESSION.items[r.output].label;
    if (r.cap !== undefined && itemCount(r.output) >= r.cap) return `${name}: ${itemCount(r.output)} in store (enough)`;
    const short = Object.entries(r.stock ?? {}).filter(([k, n]) => !state.creative && state.stock[k as ResourceKey] < (n ?? 0)).map(([k]) => k);
    for (const [id, n] of Object.entries({ ...(r.items ?? {}), ...(r.needs ?? {}) }) as [ItemId, number][]) if (itemCount(id) < n) short.push(PROGRESSION.items[id].label);
    return short.length > 0 ? `${name}: short of ${short.join(", ")}` : `${name}: ready`;
  });
  return parts.join("; ");
}

// Called by updateArtisan; false when the post is not a tree station (the old CRAFT_RECIPES path runs).
export function updateStationWork(c: Colonist): boolean {
  const recipes = stationRecipes(state.tiles[tileIndex(c.postX, c.postY)]);
  if (recipes.length === 0) return false;
  c.state = "crafting";
  let job = stationJobs.get(c.id);
  if (!job) {
    const r = recipes.find((rc) => (rc.workerLevel ?? 1) <= workerLevel(c) && recipeReady(rc));
    if (!r) {
      c.state = "idle";
      return true;
    }
    // Inputs are taken when the batch starts.
    if (!state.creative) for (const [k, n] of Object.entries(r.stock ?? {})) state.stock[k as ResourceKey] -= n ?? 0;
    for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) takeItem(id, n);
    const total = state.instantBuild ? 1 : Math.max(1, Math.round((r.seconds ?? 30) * TICK_RATE));
    job = { recipe: r, left: total, total };
    stationJobs.set(c.id, job);
  }
  job.left -= workSpeed(c);
  if (job.left <= 0) {
    stationJobs.delete(c.id);
    // Output grade = the tier the station works at (a Blast furnace with a level-2 smelter makes Good blooms).
    addItem(job.recipe.output, job.recipe.amount, effectiveTier(c));
  }
  return true;
}

// ---- food (phase 4) ----
// Dawn: food items are eaten before grain / meat / fruit, best first. Returns the food units still needed.
export function eatFoodItems(needed: number): number {
  for (const f of FOOD_ITEMS) {
    while (needed > 0 && itemCount(f.id) > 0) {
      takeItem(f.id, 1);
      needed -= f.food;
    }
  }
  return Math.max(0, Math.ceil(needed));
}

// Colony happiness bonus from baked food in store (a variety bonus on top of grain / meat / fruit): bread +8
// (+2 per grade above Poor of the best bread), flatbread +3. 0 with COLONY_UNLOCK_ALL.
export function foodHappinessBonus(): number {
  if (state.testUnlockAll) return 0;
  let bonus = 0;
  for (const f of FOOD_ITEMS) if (itemCount(f.id) > 0) bonus = Math.max(bonus, f.happiness);
  const bread = state.progress.items.bread ?? [];
  const best = bread[2] > 0 ? 3 : bread[1] > 0 ? 2 : 1;
  if (itemCount("bread") > 0) bonus += (best - 1) * 2;
  return bonus;
}

// ---- deposits and prospecting (phase 3) ----
// Every ore / stone deposit has a richness 1-3 (a stable hash of its tile; 50% poor, 35% fair, 15% rich), hidden
// until a prospector has surveyed it. A known fair / rich deposit yields +50% / +100% to its mine.
export const PROSPECT_RADIUS_TILES = 16;
export const PROSPECT_TICKS = TICK_RATE * 150;
const RICHNESS_LABEL = ["poor", "fair", "rich"];

export function depositRichness(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + state.worldNoiseSalt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const u = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  return u < 0.5 ? 1 : u < 0.85 ? 2 : 3;
}

export function depositKnown(x: number, y: number): boolean {
  const p = state.progress.prospected ?? [];
  for (let i = 0; i + 2 < p.length; i += 3) if (Math.hypot(p[i] - x, p[i + 1] - y) <= p[i + 2]) return true;
  return false;
}

function depositLine(tx: number, ty: number): string {
  if (!depositKnown(tx, ty)) return "Deposit: unknown (send a prospector from the Build panel)";
  const r = depositRichness(tx, ty);
  return `Deposit: ${RICHNESS_LABEL[r - 1]} (${r}/3)${r > 1 ? `, +${(r - 1) * 50}% yield` : ""}`;
}

// Mine yield bonus: called after each load a miner delivers; a known fair deposit adds 1 every 2nd load, a rich one
// 1 every load.
const richCarry = new Map<string, number>();
export function depositBonus(c: Colonist, resource: "iron" | "rock") {
  if (!depositKnown(c.postX, c.postY)) return;
  const extra = (richCarry.get(c.id) ?? 0) + (depositRichness(c.postX, c.postY) - 1) * 0.5;
  const whole = Math.floor(extra);
  richCarry.set(c.id, extra - whole);
  state.stock[resource] += whole;
}

function prospectShort(): string {
  if (state.progress.prospecting) return "A prospector is already out";
  if (!gatesOpen() && (itemCount("stonePick") < 1 || itemCount("stoneKnife") < 1)) return "Needs a Stone pick and a Stone knife";
  if (townCentersOfClan(state.clan.id).length === 0) return "No Town Center";
  return "";
}

// `prospect` message: a prospector surveys PROSPECT_RADIUS_TILES around the player's nearest Town Center for
// PROSPECT_TICKS; then every deposit there shows its richness.
export function handleProspect(player: Player) {
  const why = prospectShort();
  if (why) {
    sendEvent(player, "build", why);
    return;
  }
  const at = tileOfPixel(player.x, player.y);
  const tc = townCentersOfClan(state.clan.id).sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
  state.progress.prospecting = { x: tc.x, y: tc.y, untilTick: state.cycleTick + (state.instantBuild ? TICK_RATE : PROSPECT_TICKS) };
  snapshotDirty.add(state.clan.id);
  sendEvent(player, "build", `A prospector sets out from ${tc.name ?? "the Town Center"}`);
}

// Once a second: a prospector whose survey is done reports.
export function updateProspecting() {
  forEachClan(() => {
    const job = state.progress.prospecting;
    if (!job || state.cycleTick < job.untilTick) return;
    state.progress.prospecting = undefined;
    (state.progress.prospected ??= []).push(job.x, job.y, PROSPECT_RADIUS_TILES);
    const counts = [0, 0, 0];
    for (const t of [TileType.IronOre, TileType.Rock, TileType.IronMinePost, TileType.RockMinePost]) {
      for (const i of tileIndicesOf(t)) {
        const x = i % state.WORLD_TILES_X;
        const y = Math.floor(i / state.WORLD_TILES_X);
        if (Math.hypot(x - job.x, y - job.y) <= PROSPECT_RADIUS_TILES) counts[depositRichness(x, y) - 1]++;
      }
    }
    snapshotDirty.add(state.clan.id);
    broadcastEvent("build", `Prospector's report: ${counts[2]} rich, ${counts[1]} fair, ${counts[0]} poor deposits nearby (click a mine to see its richness)`);
  });
}

// Old saves (grandfathering): a worker with no XP in its profession gets the XP of its station's level, so every
// station keeps working at the tier it had.
function grandfatherWorkers(clanId: number) {
  for (const c of colonists.values()) {
    if ((c.clan ?? 0) !== clanId || !c.person) continue;
    const prof = professionOf(c);
    if (!prof || c.person.xp?.[prof] !== undefined) continue;
    (c.person.xp ??= {})[prof] = WORKER_XP_LEVELS[Math.min(getBuildingLevel(c.postX, c.postY), WORKER_XP_LEVELS.length) - 1];
  }
}

// An accepted placement: the building type stays unlocked from now on.
export function markUnlocked(tile: TileType) {
  if (!PROGRESSION.buildings[tile]?.requires || state.progress.unlocked.includes(tile)) return;
  state.progress.unlocked.push(tile);
  snapshotDirty.add(state.clan.id);
}

// ---- hand crafting (the knapping spot: no building, instant) ----
function recipeShort(r: Recipe): string {
  if (!state.creative) {
    for (const [k, n] of Object.entries(r.stock ?? {})) if (state.stock[k as ResourceKey] < (n ?? 0)) return `Not enough ${k}`;
  }
  for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) if (itemCount(id) < n) return `Needs ${n} ${PROGRESSION.items[id].label}`;
  return "";
}

export function handleCraftItem(player: Player, recipeId: unknown) {
  const r = typeof recipeId === "string" ? recipeById(recipeId) : undefined;
  if (!r || r.station !== "hand") return;
  const why = recipeShort(r);
  if (why) {
    sendEvent(player, "build", why);
    return;
  }
  if (!state.creative) for (const [k, n] of Object.entries(r.stock ?? {})) state.stock[k as ResourceKey] -= n ?? 0;
  for (const [id, n] of Object.entries(r.items ?? {}) as [ItemId, number][]) takeItem(id, n);
  addItem(r.output, r.amount, 1);
  sendEvent(player, "build", `Crafted: ${PROGRESSION.items[r.output].label}${r.amount > 1 ? ` x${r.amount}` : ""}`);
}

// ---- snapshot (recomputed once a second per clan, or at once after a change) ----
const snapshotCache = new Map<number, { tick: number; snap: ProgressionSnapshot }>();
const snapshotDirty = new Set<number>();

export function progressionSnapshot(): ProgressionSnapshot {
  const id = state.clan.id;
  const hit = snapshotCache.get(id);
  if (hit && !snapshotDirty.has(id) && Math.abs(state.cycleTick - hit.tick) < TICK_RATE) return hit.snap;
  snapshotDirty.delete(id);
  const snap = buildSnapshot();
  snapshotCache.set(id, { tick: state.cycleTick, snap });
  return snap;
}

function buildSnapshot(): ProgressionSnapshot {
  const open = gatesOpen();
  const items: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(state.progress.items)) if (v && v.some((n) => n > 0)) items[k] = [...v];
  const locked: Record<number, string[]> = {};
  const next: string[] = [];
  if (!open) {
    const ctx = progressContext();
    const rows: { tile: TileType; unmet: string[] }[] = [];
    for (const [key, row] of Object.entries(PROGRESSION.buildings)) {
      const tile = Number(key) as TileType;
      if (!row?.requires || state.progress.unlocked.includes(tile)) continue;
      const unmet = unmetRequirements(row.requires, ctx);
      if (unmet.length > 0) {
        locked[tile] = unmet;
        rows.push({ tile, unmet });
      }
    }
    const handLabels = new Set(PROGRESSION.recipes.filter((r) => r.station === "hand").map((r) => PROGRESSION.items[r.output].label));
    // Nearest first: fewest unmet gates; a gate you can craft by hand right now counts half.
    const distance = (r: { unmet: string[] }) => r.unmet.reduce((n, u) => n + (handLabels.has(u) ? 0.5 : 1), 0);
    rows.sort((a, b) => distance(a) - distance(b));
    for (const row of rows.slice(0, 4)) {
      const how = row.unmet.map((u) => (handLabels.has(u) ? `${u} (craft by hand)` : u));
      next.push(`${buildingLabel(row.tile)}: needs ${how.join(", ")}`);
    }
    if (rows.length === 0) next.push("Every building in the tree is open. Train your workers to raise station tiers.");
  }
  const crafts = PROGRESSION.recipes
    .filter((r) => r.station === "hand")
    .map((r) => ({ id: r.id, label: r.label, cost: recipeCostText(r), ok: recipeShort(r) === "" }));
  const why = prospectShort();
  const prospect = { label: state.progress.prospecting ? "Prospector out surveying" : "Send a prospector (stone pick + knife)", ok: why === "", reason: why };
  return { open, items, locked, next, crafts, prospect };
}

// ---- saves ----
export function progressForSave(c: Clan): ClanProgress {
  return {
    items: Object.fromEntries(Object.entries(c.progress.items).map(([k, v]) => [k, [...(v ?? [])]])),
    unlocked: [...c.progress.unlocked],
    prospected: [...(c.progress.prospected ?? [])],
    ...(c.progress.prospecting ? { prospecting: { ...c.progress.prospecting } } : {}),
  };
}

// Saves from before the tree are grandfathered: every gated building type the clan owns stays unlocked, and the
// starter kit is in the store.
export function restoreProgress(c: Clan, saved: ClanProgress | undefined) {
  snapshotCache.delete(c.id);
  if (saved) {
    c.progress = { items: {}, unlocked: [...(saved.unlocked ?? [])], prospected: [...(saved.prospected ?? [])], prospecting: saved.prospecting };
    for (const [k, v] of Object.entries(saved.items ?? {})) c.progress.items[k as ItemId] = [0, 1, 2].map((i) => v?.[i] ?? 0);
    return;
  }
  c.progress = newClanProgress();
  grandfatherWorkers(c.id);
  for (const key of Object.keys(PROGRESSION.buildings)) {
    const tile = Number(key) as TileType;
    if (tileIndicesOf(tile).some((i) => clanIdAtIndex(i) === c.id)) c.progress.unlocked.push(tile);
  }
}

export function resetProgressCache() {
  snapshotCache.clear();
  snapshotDirty.clear();
  stationJobs.clear();
  richCarry.clear();
}

// testHook "progression": the active clan's tree state.
export function progressionDebug() {
  return { open: gatesOpen(), unlocked: [...state.progress.unlocked], items: itemTotals(), ctx: progressContext(), prospected: [...(state.progress.prospected ?? [])] };
}
