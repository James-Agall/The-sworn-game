// Progression tree (docs/colony2d/PLAN-progression-tree.md; ROADMAP "Progression tree — landed"): the server side
// of shared/src/progression.ts. Clan items (per quality grade), the sticky unlocked set, placement / upgrade
// gates, hand crafting, the `progression` snapshot and old-save grandfathering.
import { TICK_RATE, TileType, type ProgressionSnapshot } from "@colony/shared/protocol";
import {
  type ItemId, type ProgressContext, type Recipe, MAX_QUALITY, PROGRESSION, PROGRESSION_BUILDING_LABEL, recipeById,
  recipeCostText, unmetRequirements,
} from "@colony/shared/progression";
import type { Player, ResourceKey } from "./types.js";
import { type Clan, type ClanProgress, newClanProgress, state } from "./state.js";
import { tileIndicesOf } from "./chunks.js";
import { clanIdAtIndex } from "./clans.js";
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
  if (!row) return "";
  if (!upgradeInPlace) {
    if (!row.requires || state.progress.unlocked.includes(tile)) return "";
    const unmet = unmetRequirements(row.requires, progressContext());
    return unmet.length > 0 ? `${buildingLabel(tile)} needs: ${unmet.join(", ")}` : "";
  }
  const next = currentBuildingLevel(tx, ty, current) + 1;
  const req = row.levels?.[next as 2 | 3];
  const unmet = unmetRequirements(req, progressContext());
  return unmet.length > 0 ? `Level ${next} ${buildingLabel(tile)} needs: ${unmet.join(", ")}` : "";
}

// Building info lines (null: nothing to show): the tree gate on the next level.
export function progressionInfo(tx: number, ty: number, t: TileType): string[] | null {
  const row = PROGRESSION.buildings[t];
  if (!row?.levels || gatesOpen()) return null;
  const next = currentBuildingLevel(tx, ty, t) + 1;
  const unmet = unmetRequirements(row.levels[next as 2 | 3], progressContext());
  return unmet.length > 0 ? [`Level ${next} needs: ${unmet.join(", ")}`] : null;
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
    rows.sort((a, b) => a.unmet.length - b.unmet.length);
    const handLabels = new Set(PROGRESSION.recipes.filter((r) => r.station === "hand").map((r) => PROGRESSION.items[r.output].label));
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
