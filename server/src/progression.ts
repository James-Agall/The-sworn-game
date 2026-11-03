// Progression tree (docs/colony2d/PLAN-progression-tree.md; ROADMAP "Progression tree — landed"): the server side
// of shared/src/progression.ts. Clan items (per quality grade), the sticky unlocked set, placement / upgrade
// gates, hand crafting, the `progression` snapshot and old-save grandfathering.
import { TICK_RATE, TileType, type ProgressionSnapshot } from "@colony/shared/protocol";
import {
  type ItemId, type Profession, type ProgressContext, type Recipe, MAX_QUALITY, PROFESSION_LABEL, PROGRESSION,
  PROGRESSION_BUILDING_LABEL, QUALITY_GRADES, TIER_SPEED_BONUS, WORKER_XP_LEVELS, levelForXp, recipeById, recipeCostText,
  unmetRequirements, xpToNext,
} from "@colony/shared/progression";
import type { Colonist, Player, ResourceKey } from "./types.js";
import { type Clan, type ClanProgress, colonists, newClanProgress, state } from "./state.js";
import { getBuildingLevel, isNightNow, tileIndex } from "./tiles.js";
import { tileIndicesOf } from "./chunks.js";
import { clanById, clanIdAtIndex, withClan } from "./clans.js";
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
  return { open, items, locked, next, crafts };
}

// ---- saves ----
export function progressForSave(c: Clan): ClanProgress {
  return { items: Object.fromEntries(Object.entries(c.progress.items).map(([k, v]) => [k, [...(v ?? [])]])), unlocked: [...c.progress.unlocked] };
}

// Saves from before the tree are grandfathered: every gated building type the clan owns stays unlocked, and the
// starter kit is in the store.
export function restoreProgress(c: Clan, saved: ClanProgress | undefined) {
  snapshotCache.delete(c.id);
  if (saved) {
    c.progress = { items: {}, unlocked: [...(saved.unlocked ?? [])] };
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
}

// testHook "progression": the active clan's tree state.
export function progressionDebug() {
  return { open: gatesOpen(), unlocked: [...state.progress.unlocked], items: itemTotals(), ctx: progressContext() };
}
