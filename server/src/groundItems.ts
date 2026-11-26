// groundItems.ts: Inventory 2026-11-26 (INVENTORY-2026-11-26.md). The hero drops carried goods (a quantity of one
// good) or one pack gear item at their feet; the stack lies on the ground until anyone near picks it up, or it rots
// away after GROUND_DESPAWN_TICKS. Overworld only (never inside an interior). One global, bounded map (insertion
// order = age, so the oldest goes first past GROUND_MAX_ITEMS); nothing here scans the world or the chunks, so cold
// chunks and world streaming are untouched. Saved in the current save format (saves.ts `groundItems`).
import { GEAR_SLOTS, TICK_RATE, TILE_SIZE, type GearItem, type GroundItemSnapshot } from "@colony/shared/protocol";
import { PACK_CAP, PACK_GOODS, PACK_LABEL, PACK_WEIGHT, type PackGood } from "@colony/shared/herolife";
import { GAME_DAY_TICKS, HERO_INVENTORY_CAP, SNAPSHOT_VIEW_TILES } from "./constants.js";
import { state } from "./state.js";
import type { Player } from "./types.js";
import { inBounds } from "./tiles.js";
import { isWalkableTile } from "./pathfinding.js";
import { lifeOf, packWeight, toast } from "./herolife.js";
import { heroProfileOf, recomputeHeroProfile, refuseGear } from "./heroes.js";

export interface GroundItem {
  id: string;
  // World px (the centre of the tile it lies on).
  x: number;
  y: number;
  kind: "good" | "gear";
  good?: PackGood;
  qty?: number;
  gear?: GearItem;
  droppedAtTick: number;
  // Profile key of whoever dropped (or last added to) it: that hero waits GROUND_DROPPER_DELAY_TICKS to take it back.
  dropperKey: string;
}

export const GROUND_MAX_ITEMS = 300;
export const GROUND_REACH_TILES = 1.5;
export const GROUND_DESPAWN_TICKS = 3 * GAME_DAY_TICKS;
export const GROUND_DROPPER_DELAY_TICKS = Math.round(1.5 * TICK_RATE);
// Drops per player per real second (messages arrive while paused too, so this is wall-clock).
export const GROUND_DROPS_PER_SECOND = 6;
const PACK_FULL = "Your pack is full: deposit it at a Town Center or chest, or sell it";
const GEAR_PACK_FULL = `Your pack is full (${HERO_INVENTORY_CAP} items)`;

const items = new Map<string, GroundItem>();
let nextId = 1;
// Bumped on every change; a player's list is rebuilt only when this (or where they stand / look) changed.
let version = 0;
const dropTimes = new Map<string, number[]>();

const tileOf = (v: number) => Math.floor(v / TILE_SIZE);
const centre = (t: number) => (t + 0.5) * TILE_SIZE;

function rateLimited(p: Player): boolean {
  const now = Date.now();
  const recent = (dropTimes.get(p.id) ?? []).filter((t) => now - t < 1000);
  if (recent.length >= GROUND_DROPS_PER_SECOND) {
    dropTimes.set(p.id, recent);
    return true;
  }
  recent.push(now);
  dropTimes.set(p.id, recent);
  return false;
}

// "" = the hero may drop here, else why not.
function dropBlock(p: Player): string {
  if (p.interior) return "You can't drop things indoors: step outside first";
  return "";
}

// The walkable tile nearest the hero's feet within GROUND_REACH_TILES (their own tile first), or null.
function dropSpot(p: Player): { x: number; y: number } | null {
  const mx = tileOf(p.x), my = tileOf(p.y);
  let best: { x: number; y: number; d: number } | null = null;
  for (let ty = my - 1; ty <= my + 1; ty++) {
    for (let tx = mx - 1; tx <= mx + 1; tx++) {
      if (!inBounds(tx, ty) || !isWalkableTile(tx, ty)) continue;
      const d = Math.hypot(centre(tx) - p.x, centre(ty) - p.y) / TILE_SIZE;
      if (d <= GROUND_REACH_TILES && (!best || d < best.d)) best = { x: tx, y: ty, d };
    }
  }
  return best ? { x: centre(best.x), y: centre(best.y) } : null;
}

function add(item: GroundItem) {
  while (items.size >= GROUND_MAX_ITEMS) items.delete(items.keys().next().value!);
  items.set(item.id, item);
  version++;
}

export function handleDropGood(p: Player, good: unknown, qty: unknown) {
  if (p.dead) return;
  if (!(PACK_GOODS as unknown[]).includes(good)) return;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) return toast(p, "Choose how many to drop");
  const why = dropBlock(p);
  if (why) return toast(p, why);
  const g = good as PackGood;
  const life = lifeOf(p);
  const have = life.pack[g] ?? 0;
  if (have <= 0) return toast(p, `You carry no ${PACK_LABEL[g].toLowerCase()}`);
  const spot = dropSpot(p);
  if (!spot) return toast(p, "No clear ground here to drop that");
  if (rateLimited(p)) return toast(p, "Slow down: you can drop only a few things a second");
  const n = Math.min(qty, have);
  life.pack[g] = have - n;
  if (!life.pack[g]) delete life.pack[g];
  // Same good on the same tile: one stack (moved to the back of the age order, its timer restarted).
  let merged: GroundItem | undefined;
  for (const it of items.values()) {
    if (it.kind === "good" && it.good === g && tileOf(it.x) === tileOf(spot.x) && tileOf(it.y) === tileOf(spot.y)) {
      merged = it;
      break;
    }
  }
  if (merged) {
    items.delete(merged.id);
    Object.assign(merged, { qty: (merged.qty ?? 0) + n, droppedAtTick: state.cycleTick, dropperKey: p.profileKey });
    add(merged);
  } else add({ id: `g${nextId++}`, ...spot, kind: "good", good: g, qty: n, droppedAtTick: state.cycleTick, dropperKey: p.profileKey });
  toast(p, `You drop ${n} ${PACK_LABEL[g].toLowerCase()}`);
}

export function handleDropGear(p: Player, itemId: unknown) {
  if (p.dead || typeof itemId !== "string" || itemId.length > 100) return;
  const prof = heroProfileOf(p);
  const idx = prof.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) {
    if (GEAR_SLOTS.some((s) => prof.equipment[s]?.id === itemId)) return refuseGear(p, "Unequip that first to drop it");
    return refuseGear(p, "That item is not in your pack");
  }
  const why = dropBlock(p);
  if (why) return toast(p, why);
  const spot = dropSpot(p);
  if (!spot) return toast(p, "No clear ground here to drop that");
  if (rateLimited(p)) return toast(p, "Slow down: you can drop only a few things a second");
  const [gear] = prof.inventory.splice(idx, 1);
  recomputeHeroProfile(prof);
  add({ id: `g${nextId++}`, ...spot, kind: "gear", gear, droppedAtTick: state.cycleTick, dropperKey: p.profileKey });
  toast(p, `You drop ${gear.name}`);
}

const nameOf = (it: GroundItem) => (it.kind === "gear" ? it.gear!.name : `${it.qty} ${PACK_LABEL[it.good!].toLowerCase()}`);

export function handlePickupGround(p: Player, id: unknown) {
  if (p.dead || typeof id !== "string" || id.length > 20) return;
  const it = items.get(id);
  if (!it) return toast(p, "That is no longer there");
  if (p.interior) return;
  if (Math.hypot(it.x - p.x, it.y - p.y) / TILE_SIZE > GROUND_REACH_TILES) return toast(p, "Walk closer to pick that up");
  pickUp(p, it);
}

function pickUp(p: Player, it: GroundItem) {
  if (it.dropperKey === p.profileKey && state.cycleTick - it.droppedAtTick < GROUND_DROPPER_DELAY_TICKS && state.cycleTick >= it.droppedAtTick) {
    return toast(p, "You just put that down");
  }
  if (it.kind === "gear") {
    const prof = heroProfileOf(p);
    if (prof.inventory.length >= HERO_INVENTORY_CAP) return refuseGear(p, GEAR_PACK_FULL);
    prof.inventory.push(it.gear!);
    recomputeHeroProfile(prof);
    items.delete(it.id);
    version++;
    return toast(p, `You pick up ${it.gear!.name}`);
  }
  const g = it.good!;
  const life = lifeOf(p);
  const room = Math.floor((PACK_CAP - packWeight(life) + 1e-9) / PACK_WEIGHT[g]);
  const n = Math.min(it.qty ?? 0, Math.max(0, room));
  if (n <= 0) return toast(p, PACK_FULL);
  life.pack[g] = (life.pack[g] ?? 0) + n;
  it.qty = (it.qty ?? 0) - n;
  if (it.qty <= 0) items.delete(it.id);
  version++;
  toast(p, `You pick up ${n} ${PACK_LABEL[g].toLowerCase()}${it.qty > 0 ? ` (${it.qty} left on the ground: your pack is full)` : ""}`);
}

// E (herolife.ts handleInteract, after talking): the nearest stack within reach, if any. True if one was there.
export function tryPickupNearest(p: Player): boolean {
  if (p.dead || p.interior || items.size === 0) return false;
  let best: GroundItem | null = null;
  let bestD = Infinity;
  for (const it of items.values()) {
    const d = Math.hypot(it.x - p.x, it.y - p.y) / TILE_SIZE;
    if (d <= GROUND_REACH_TILES && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  if (!best) return false;
  pickUp(p, best);
  return true;
}

// Once a second: stacks older than GROUND_DESPAWN_TICKS rot away.
export function updateGroundItems() {
  if (items.size === 0 || state.cycleTick % TICK_RATE !== 0) return;
  for (const it of items.values()) {
    if (it.droppedAtTick > state.cycleTick) it.droppedAtTick = state.cycleTick;
    if (state.cycleTick - it.droppedAtTick >= GROUND_DESPAWN_TICKS) {
      items.delete(it.id);
      version++;
    }
  }
}

const snapOf = (it: GroundItem): GroundItemSnapshot =>
  it.kind === "good"
    ? { id: it.id, x: it.x, y: it.y, k: "g", good: it.good, qty: it.qty }
    : { id: it.id, x: it.x, y: it.y, k: "e", name: it.gear!.name, tier: it.gear!.tier, slot: it.gear!.slot, ...(it.gear!.kind ? { kind: it.gear!.kind } : {}), ...(it.gear!.icon ? { icon: it.gear!.icon } : {}) };

// The snapshot's `ground` for this player: the stacks within the snapshot view distance (or the strategy view rect),
// none indoors. JSON, only when the list changed since the last one sent to them; otherwise null.
export function groundPayloadFor(p: Player): string | null {
  if (items.size === 0 && (p.groundSent === undefined || p.groundSent === "[]")) return null;
  const key = `${version}|${p.interior ? 1 : 0}|${tileOf(p.x) >> 2}|${tileOf(p.y) >> 2}|${p.viewSetAt}`;
  if (key === p.groundKey) return null;
  p.groundKey = key;
  const limit = SNAPSHOT_VIEW_TILES * TILE_SIZE;
  const view = p.view;
  const out: GroundItemSnapshot[] = [];
  if (!p.interior) {
    for (const it of items.values()) {
      const near = (Math.abs(it.x - p.x) < limit && Math.abs(it.y - p.y) < limit) || (!!view && Math.abs(it.x - view.x) < view.halfW && Math.abs(it.y - view.y) < view.halfH);
      if (near) out.push(snapOf(it));
    }
  }
  const json = JSON.stringify(out);
  if (json === p.groundSent) return null;
  p.groundSent = json;
  return json;
}

// ---- saves / reset / tests ----
export interface GroundItemsSave {
  items: GroundItem[];
}
export function groundItemsForSave(): GroundItemsSave | undefined {
  return items.size ? { items: Array.from(items.values(), (it) => structuredClone(it)) } : undefined;
}
const validGear = (i: unknown): i is GearItem =>
  !!i && typeof i === "object" && typeof (i as GearItem).id === "string" && typeof (i as GearItem).name === "string" &&
  typeof (i as GearItem).slot === "string" && !!(i as GearItem).stats && typeof (i as GearItem).stats === "object";
export function restoreGroundItems(raw: unknown) {
  resetGroundItems();
  const list = raw && typeof raw === "object" && Array.isArray((raw as GroundItemsSave).items) ? (raw as GroundItemsSave).items : [];
  for (const r of list.slice(-GROUND_MAX_ITEMS) as unknown as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^g\d{1,9}$/.test(r.id)) continue;
    const x = Number(r.x), y = Number(r.y), tick = Number(r.droppedAtTick);
    if (![x, y, tick].every(Number.isFinite) || !inBounds(tileOf(x), tileOf(y))) continue;
    const base = { id: r.id, x, y, droppedAtTick: tick, dropperKey: typeof r.dropperKey === "string" ? r.dropperKey.slice(0, 64) : "" };
    if (r.kind === "good") {
      const qty = Math.floor(Number(r.qty));
      if (!(PACK_GOODS as unknown[]).includes(r.good) || !Number.isFinite(qty) || qty <= 0) continue;
      items.set(r.id, { ...base, kind: "good", good: r.good as PackGood, qty: Math.min(qty, 100000) });
    } else if (r.kind === "gear" && validGear(r.gear)) items.set(r.id, { ...base, kind: "gear", gear: r.gear });
    else continue;
    nextId = Math.max(nextId, Number(r.id.slice(1)) + 1);
  }
}
export function resetGroundItems() {
  items.clear();
  dropTimes.clear();
  nextId = 1;
  version++;
}
// Test hook `groundItems`: the list; `spawn` adds n stacks of 1 `good` at (x, y) px without any rule (cap tests).
export function groundDebug(spawn?: { n: number; good: PackGood; x: number; y: number }) {
  if (spawn) for (let i = 0; i < spawn.n; i++) add({ id: `g${nextId++}`, x: spawn.x, y: spawn.y, kind: "good", good: spawn.good, qty: 1, droppedAtTick: state.cycleTick, dropperKey: "" });
  return { items: Array.from(items.values(), (it) => structuredClone(it)), max: GROUND_MAX_ITEMS, despawnTicks: GROUND_DESPAWN_TICKS, dropperDelayTicks: GROUND_DROPPER_DELAY_TICKS };
}
