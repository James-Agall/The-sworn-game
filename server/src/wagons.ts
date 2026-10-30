// wagons.ts: Forts phase E, trader wagons (PLAN-forts-diplomacy-moats.md §5 "Trader wagons", §10 "E").
// Each Trading Post (TileType.GoldShop, levels 1-3) owns ONE wagon (a colonist of kind "wagon", posted at the
// post, no population) and an escort roster by level (soldiers posted at the post: housed by it, never the
// civilian cap). By day the wagon carries the clan's surplus goods to a Friendly+ human settlement (prices by
// tier, diplomacy.ts daily caps / purse) or to one of the clan's other Town Centers (half value), and comes back
// with gold and goods. One route per trip (findPath + one detour round known hazards, scored by danger); the
// escort follows it as one order group (orders.ts follow). Nights: it camps where it is. Loss: the cargo is
// gone, the destination relation drops, a replacement is bought after a day at a dawn / dusk window.
import { TICK_RATE, TILE_SIZE, TRADE_GOODS, TileType, type BuildingInfo, type DangerBand, type TradeGood, type WagonSnapshot } from "@colony/shared/protocol";
import type { Colonist, ResourceKey, SiteState, TileCoord, TradingPostState } from "./types.js";
import {
  COLONIST_SPEED, DAY_TICKS, GAME_DAY_TICKS, RESPAWN_FOOD_COST, SETTLEMENT_GOLD_CAP, SETTLEMENT_STOCK_CAP, TRADE_BASE_PRICE,
  TRADE_DAILY_CAP_PER_GOOD, TRADE_GOLD_PER_RELATION, WAGON_CLAN_CAP, WAGON_DANGER_COST, WAGON_DANGER_DEADLY, WAGON_DANGER_RISKY,
  WAGON_DELIVERY_RELATION, WAGON_EXPORT_RESERVE, WAGON_HAZARD_BOSS, WAGON_HAZARD_CAMP, WAGON_HAZARD_RAID, WAGON_HAZARD_SITE,
  WAGON_INTERNAL_VALUE, WAGON_LEVELS, WAGON_LOSS_RELATION, WAGON_MAX_TRIP_TILES, WAGON_RAID_MEMORY_DAYS, WAGON_UNLOAD_TICKS,
  WAGON_ALERT_TICKS, dt,
} from "./constants.js";
import { colonists, hearths, mobs, sites, state, tradingPosts } from "./state.js";
import { getBuildingLevel, inBounds, isNightNow, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { advanceAlongPath, findPath, isWalkableTile } from "./pathfinding.js";
import { respawnWindowAt, settlementKeyNear, spawnColonistForPost, tilesOfType, trySpendFood } from "./colonists.js";
import { ensureFollowGroup, leaveOrderGroup, rallyUnit } from "./orders.js";
import { batchGold, diploOf, gainRelation, gameDay, standingTown, tierOf } from "./diplomacy.js";
import { adjustRelation } from "./sites.js";
import { clanById, clanIdAt, clanTownCenters, enterClan, resetClan, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { canAfford, formatCost, spend } from "./construction.js";

const SCAN_TICKS = 10 * TICK_RATE;
const TRIPS_PER_DAY_AUTO = 1;
const TRIPS_PER_DAY_MANUAL = 2;
// Auto-send only leaves in the first part of the day, so the trip can end by dusk.
const AUTO_DEPART_UNTIL = 0.4;

interface Hazard { x: number; y: number; r: number; w: number }
interface Dest { id: string; name: string; kind: "settlement" | "own"; dist: number; goal: TileCoord | null; site?: SiteState; ok: boolean; reason: string }
interface RoutePlan { day: number; route: TileCoord[]; danger: number }

// Raid anchors of recent nights (raids.ts spawnRaid), for the danger score. Saved.
let raidAnchors: { x: number; y: number; day: number }[] = [];
// "postKey|destId" -> today's route (one route per trip; the panel reads the cache).
const routeCache = new Map<string, RoutePlan>();
// Own Town Center destination id -> the game day it last took a delivery (one a day each).
const internalDay = new Map<string, number>();

export const levelOf = (tx: number, ty: number) => Math.min(3, Math.max(1, getBuildingLevel(tx, ty)));
const tier = (lv: number) => WAGON_LEVELS[Math.min(3, Math.max(1, lv)) - 1];
const keyXY = (key: string) => key.split(",").map(Number) as [number, number];
const isWagon = (c: Colonist | undefined): c is Colonist & { wagon: NonNullable<Colonist["wagon"]> } => !!c && c.kind === "wagon" && !!c.wagon;

export function noteRaidAnchor(x: number, y: number) {
  raidAnchors.push({ x, y, day: gameDay() });
  if (raidAnchors.length > 30) raidAnchors.splice(0, raidAnchors.length - 30);
}

export function wagonOfPost(post: TradingPostState): (Colonist & { wagon: NonNullable<Colonist["wagon"]> }) | undefined {
  const c = post.wagonId ? colonists.get(post.wagonId) : undefined;
  return isWagon(c) ? c : undefined;
}

function escortsAt(tx: number, ty: number): Colonist[] {
  const out: Colonist[] = [];
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && c.kind !== "wagon" && c.hp > 0) out.push(c);
  return out;
}

function postOfWagon(c: Colonist): TradingPostState | undefined {
  return tradingPosts.get(resourceKey(c.postX, c.postY));
}

// ---- Posts: discovery, wagon + escort roster ----

// Every SCAN_TICKS (and from tests): register new Trading Posts, drop demolished ones (and their units).
export function scanTradingPosts() {
  const found = new Set<string>();
  for (const t of tilesOfType(TileType.GoldShop)) {
    const key = resourceKey(t.x, t.y);
    found.add(key);
    if (!tradingPosts.has(key)) {
      tradingPosts.set(key, { auto: true, wagonId: null, rebuildAtTick: 0, lastTripDay: -1, tripsToday: 0, level: 0, clan: clanIdAt(t.x, t.y) });
    }
  }
  for (const [key, post] of tradingPosts) {
    if (found.has(key)) continue;
    const [tx, ty] = keyXY(key);
    for (const [id, c] of colonists) {
      if (c.postX !== tx || c.postY !== ty) continue;
      leaveOrderGroup(id);
      colonists.delete(id);
    }
    tradingPosts.delete(key);
    void post;
  }
}

function spawnWagon(post: TradingPostState, tx: number, ty: number, lv: number): Colonist | null {
  let n = 0;
  for (const c of colonists.values()) if (c.kind === "wagon" && (c.clan ?? 0) === post.clan) n++;
  if (n >= WAGON_CLAN_CAP) return null;
  const c = spawnColonistForPost(tx, ty, "wagon", lv);
  c.maxHp = c.hp = tier(lv).hp;
  c.wagon = { level: lv, leg: "home", dest: "", destName: "", route: [], danger: 0, cargo: {}, value: 0, proceeds: {}, waitUntil: 0 };
  post.wagonId = c.id;
  return c;
}

// Missing escorts of the roster: free on a new post / upgrade, else food per head (RESPAWN_FOOD_COST).
function topUpEscorts(tx: number, ty: number, lv: number, free: boolean): number {
  const have = escortsAt(tx, ty).map((c) => c.kind);
  let added = 0;
  for (const kind of tier(lv).escort) {
    const i = have.indexOf(kind);
    if (i >= 0) {
      have.splice(i, 1);
      continue;
    }
    if (!free && !trySpendFood(RESPAWN_FOOD_COST)) break;
    spawnColonistForPost(tx, ty, kind, lv);
    added++;
  }
  return added;
}

// A new post, or a level change while the wagon is home: the roster and the wagon follow the new level.
function reroster(post: TradingPostState, tx: number, ty: number, lv: number) {
  const roster = tier(lv).escort.slice();
  for (const c of escortsAt(tx, ty)) {
    const i = roster.indexOf(c.kind);
    if (i >= 0) roster.splice(i, 1);
    else {
      leaveOrderGroup(c.id);
      colonists.delete(c.id);
    }
  }
  topUpEscorts(tx, ty, lv, true);
  const w = wagonOfPost(post);
  if (w) {
    w.wagon.level = lv;
    w.maxHp = tier(lv).hp;
    w.hp = w.maxHp;
  } else if (post.rebuildAtTick === 0) spawnWagon(post, tx, ty, lv);
  post.level = lv;
}

// ---- Destinations, hazards, routes ----

function hazardsNow(): Hazard[] {
  const out: Hazard[] = [];
  for (const s of sites.values()) {
    if (s.faction === "human" || s.cleared || s.captured) continue;
    out.push({ x: s.keepX, y: s.keepY, r: WAGON_HAZARD_SITE.radius, w: WAGON_HAZARD_SITE.weight });
  }
  for (const h of hearths.values()) {
    if (h.destroyed || sites.has(h.siteId) || h.faction === "human") continue;
    out.push({ x: h.x, y: h.y, r: WAGON_HAZARD_CAMP.radius, w: WAGON_HAZARD_CAMP.weight });
  }
  const day = gameDay();
  for (const a of raidAnchors) if (day - a.day <= WAGON_RAID_MEMORY_DAYS) out.push({ x: a.x, y: a.y, r: WAGON_HAZARD_RAID.radius, w: WAGON_HAZARD_RAID.weight });
  for (const m of mobs.values()) if (m.boss && m.hp > 0) out.push({ x: m.x / TILE_SIZE, y: m.y / TILE_SIZE, r: WAGON_HAZARD_BOSS.radius, w: WAGON_HAZARD_BOSS.weight });
  return out;
}

export function dangerOf(route: TileCoord[], hz: Hazard[]): number {
  let score = 0;
  for (let i = 0; i < route.length; i += 2) {
    const t = route[i];
    for (const h of hz) if ((t.x - h.x) ** 2 + (t.y - h.y) ** 2 <= h.r * h.r) score += h.w;
  }
  return score;
}

export function dangerBand(score: number): DangerBand {
  return score <= WAGON_DANGER_RISKY ? "safe" : score <= WAGON_DANGER_DEADLY ? "risky" : "deadly";
}

// The direct path, or one detour with every hazard disc unwalkable for this search: lowest length + 4 x danger.
function planRoute(start: TileCoord, goal: TileCoord): { route: TileCoord[]; danger: number } | null {
  const direct = findPath(start, goal);
  if (!direct) return null;
  const hz = hazardsNow();
  let best = { route: [start, ...direct], danger: 0 };
  best.danger = dangerOf(best.route, hz);
  if (best.danger > 0) {
    const blocked = new Set<number>();
    for (const h of hz) {
      for (let y = Math.floor(h.y - h.r); y <= h.y + h.r; y++) {
        for (let x = Math.floor(h.x - h.r); x <= h.x + h.r; x++) {
          if (inBounds(x, y) && (x - h.x) ** 2 + (y - h.y) ** 2 <= h.r * h.r) blocked.add(tileIndex(x, y));
        }
      }
    }
    const detour = findPath(start, goal, (x, y) => blocked.has(tileIndex(x, y)));
    if (detour) {
      const cand = { route: [start, ...detour], danger: 0 };
      cand.danger = dangerOf(cand.route, hz);
      if (cand.route.length + WAGON_DANGER_COST * cand.danger < best.route.length + WAGON_DANGER_COST * best.danger) best = cand;
    }
  }
  return best;
}

// The walkable tile nearest `from` on a ring 2-4 tiles outside the rectangle.
function walkableOutside(x0: number, y0: number, x1: number, y1: number, from: TileCoord): TileCoord | null {
  for (let pad = 2; pad <= 4; pad++) {
    let best: TileCoord | null = null;
    let bestD = Infinity;
    for (let y = y0 - pad; y <= y1 + pad; y++) {
      for (let x = x0 - pad; x <= x1 + pad; x++) {
        if (x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad) continue;
        if (!isWalkableTile(x, y)) continue;
        const d = (x - from.x) ** 2 + (y - from.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// Runs in the post's clan context.
function destinationsFor(tx: number, ty: number): Dest[] {
  const clanId = state.clan.id;
  const from = { x: tx, y: ty };
  const out: Dest[] = [];
  for (const s of sites.values()) {
    if (!standingTown(s) || !s.sighted) continue;
    const dist = Math.round(Math.hypot(s.keepX - tx, s.keepY - ty));
    const t = tierOf(clanId, s);
    let reason = "";
    if (s.provoked && s.hostileClans?.includes(clanId)) reason = "Up in arms against you";
    else if (t !== "friendly" && t !== "allied" && t !== "vassal") reason = "Needs Friendly relations";
    else if (dist > WAGON_MAX_TRIP_TILES) reason = "Too far";
    out.push({ id: `s:${s.id}`, name: s.name, kind: "settlement", dist, goal: reason ? null : walkableOutside(s.x0, s.y0, s.x1, s.y1, from), site: s, ok: reason === "", reason });
  }
  const home = settlementKeyNear(tx, ty, clanId);
  const day = gameDay();
  clanTownCenters().forEach((tc, i) => {
    const id = `t:${tc.x},${tc.y}`;
    if (resourceKey(tc.x, tc.y) === home) return;
    const dist = Math.round(Math.hypot(tc.x - tx, tc.y - ty));
    const reason = dist > WAGON_MAX_TRIP_TILES ? "Too far" : internalDay.get(id) === day ? "Supplied today" : "";
    out.push({ id, name: tc.name ?? `Settlement ${i + 1}`, kind: "own", dist, goal: reason ? null : walkableOutside(tc.x, tc.y, tc.x, tc.y, from), ok: reason === "", reason });
  });
  return out;
}

function cachedRoute(postKey: string, d: Dest, start: TileCoord, compute: boolean): RoutePlan | null {
  const k = `${postKey}|${d.id}`;
  const c = routeCache.get(k);
  if (c && c.day === gameDay()) return c;
  if (!compute || !d.goal) return null;
  const r = planRoute(start, d.goal);
  const plan = { day: gameDay(), route: r?.route ?? [], danger: r?.danger ?? 0 };
  routeCache.set(k, plan);
  return plan;
}

// ---- Cargo and prices ----

// Up to the level's cargo value of the clan's 2 most-stocked trade goods, keeping WAGON_EXPORT_RESERVE of each.
function planCargo(lv: number): { cargo: Partial<Record<TradeGood, number>>; value: number } {
  const budget = tier(lv).cargo;
  const goods = TRADE_GOODS.filter((g) => (state.stock[g] ?? 0) > WAGON_EXPORT_RESERVE)
    .sort((a, b) => (state.stock[b] ?? 0) * TRADE_BASE_PRICE[b] - (state.stock[a] ?? 0) * TRADE_BASE_PRICE[a])
    .slice(0, 2);
  const cargo: Partial<Record<TradeGood, number>> = {};
  let value = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const g of goods) {
      const left = budget - value;
      const share = pass === 0 ? budget / goods.length : left;
      const spare = Math.floor((state.stock[g] ?? 0) - WAGON_EXPORT_RESERVE) - (cargo[g] ?? 0);
      const qty = Math.max(0, Math.min(Math.floor(Math.min(share, left) / TRADE_BASE_PRICE[g]), spare));
      if (qty <= 0) continue;
      cargo[g] = (cargo[g] ?? 0) + qty;
      value += qty * TRADE_BASE_PRICE[g];
    }
  }
  return { cargo, value };
}

// What a settlement pays for the cargo today (diplomacy.ts sell prices, daily caps, its stock room and purse);
// gold = what its purse pays (the level's profit factor comes on top).
function quoteSale(s: SiteState, clanId: number, cargo: Partial<Record<ResourceKey, number>>): { gold: number; sold: Partial<Record<TradeGood, number>> } {
  const t = tierOf(clanId, s);
  const d = diploOf(s, clanId);
  let purse = Math.floor(s.stock.gold ?? 0);
  let gold = 0;
  const sold: Partial<Record<TradeGood, number>> = {};
  for (const g of TRADE_GOODS) {
    const have = Math.floor(cargo[g] ?? 0);
    if (have <= 0) continue;
    const n0 = d.sold[g] ?? 0;
    let qty = Math.min(have, TRADE_DAILY_CAP_PER_GOOD - n0, SETTLEMENT_STOCK_CAP - Math.floor(s.stock[g] ?? 0));
    let g1 = qty > 0 ? batchGold(g, "sell", t, n0, qty) : 0;
    while (qty > 0 && g1 > purse) g1 = batchGold(g, "sell", t, n0, --qty);
    if (qty <= 0) continue;
    sold[g] = qty;
    gold += g1;
    purse -= g1;
  }
  return { gold, sold };
}

function expectedProfit(d: Dest, lv: number): number {
  const { cargo, value } = planCargo(lv);
  if (value <= 0) return 0;
  const f = tier(lv).profit;
  if (d.kind === "own") return Math.floor(value * WAGON_INTERNAL_VALUE * f);
  return d.site ? Math.floor(quoteSale(d.site, state.clan.id, cargo).gold * f) : 0;
}

// ---- Trips ----

// Why the post's wagon cannot leave now ("" = it left). Runs in the post's clan context.
export function sendWagon(postKey: string, destId: string, manual: boolean, ignoreLimits = false): string {
  const post = tradingPosts.get(postKey);
  if (!post) return "No Trading Post here";
  const [tx, ty] = keyXY(postKey);
  const w = wagonOfPost(post);
  if (!w) return post.rebuildAtTick > 0 ? "The wagon is being replaced" : "No wagon";
  if (w.wagon.leg !== "home") return "The wagon is already on the road";
  if (isNightNow()) return "No travel at night: it leaves at dawn";
  const day = gameDay();
  const trips = post.lastTripDay === day ? post.tripsToday : 0;
  if (!ignoreLimits && trips >= (manual ? TRIPS_PER_DAY_MANUAL : TRIPS_PER_DAY_AUTO)) return "No more trips today";
  const lv = levelOf(tx, ty);
  if (!manual && escortsAt(tx, ty).length < tier(lv).escort.length) return "Waiting for its full escort";
  const { cargo, value } = planCargo(lv);
  if (value <= 0) return `Nothing to sell (it keeps ${WAGON_EXPORT_RESERVE} of every good)`;
  const start = tileOfPixel(w.x, w.y);
  const dests = destinationsFor(tx, ty).filter((d) => d.ok);
  let pick: { d: Dest; plan: RoutePlan } | null = null;
  if (destId !== "auto") {
    const d = destinationsFor(tx, ty).find((o) => o.id === destId);
    if (!d) return "Unknown destination";
    if (!d.ok) return `${d.name}: ${d.reason}`;
    const plan = cachedRoute(postKey, d, start, true);
    if (!plan || plan.route.length === 0) return `No road to ${d.name}`;
    pick = { d, plan };
  } else {
    let bestScore = 0;
    for (const d of dests) {
      const plan = cachedRoute(postKey, d, start, true);
      if (!plan || plan.route.length === 0) continue;
      const profit = expectedProfit(d, lv);
      const score = profit / (1 + plan.danger / 20) / (1 + plan.route.length / 200);
      if (profit > 0 && score > bestScore) {
        bestScore = score;
        pick = { d, plan };
      }
    }
    if (!pick) return dests.length === 0 ? "No Friendly settlement or other Town Center to trade with" : "No profitable destination reachable today";
  }
  for (const [g, q] of Object.entries(cargo)) state.stock[g as ResourceKey] -= q ?? 0;
  const route = pick.plan.route;
  Object.assign(w.wagon, {
    level: lv, leg: "out", dest: pick.d.id, destName: pick.d.name, route: route.slice(), danger: pick.plan.danger,
    cargo: { ...cargo }, value, proceeds: {}, waitUntil: 0, resume: undefined, fleeing: undefined,
  });
  w.path = route.slice(1);
  post.lastTripDay = day;
  post.tripsToday = trips + 1;
  ensureFollowGroup(escortsAt(tx, ty), w.id);
  broadcastEvent("build", `Trader wagon leaves for ${pick.d.name} with ${value} gold of goods (road: ${dangerBand(pick.plan.danger)})`);
  return "";
}

// Turn for home from wherever it is (keeps its cargo / proceeds).
export function recallWagon(w: Colonist, why = ""): boolean {
  const wg = w.wagon;
  if (!wg || wg.leg === "home" || wg.leg === "back" || (wg.leg === "camp" && wg.resume === "back")) return false;
  const reached = wg.leg === "unload" ? wg.route.length - 1 : Math.max(0, wg.route.length - 1 - w.path.length);
  w.path = wg.route.slice(0, reached).reverse();
  if (wg.leg === "camp") wg.resume = "back";
  else wg.leg = "back";
  if (why) broadcastEvent("raid", why);
  return true;
}

function completeTrade(w: Colonist, post: TradingPostState) {
  const wg = w.wagon!;
  const f = tier(wg.level).profit;
  const clanId = post.clan;
  let gold = 0;
  let bought: Partial<Record<ResourceKey, number>> = {};
  let sold: Partial<Record<ResourceKey, number>> = {};
  let relation = 0;
  if (wg.dest.startsWith("t:")) {
    gold = Math.floor(wg.value * WAGON_INTERNAL_VALUE * f);
    sold = { ...wg.cargo };
    wg.cargo = {};
    internalDay.set(wg.dest, gameDay());
  } else {
    const s = sites.get(wg.dest.slice(2));
    const t = s ? tierOf(clanId, s) : "hostile";
    if (!s || !standingTown(s) || (t !== "friendly" && t !== "allied" && t !== "vassal") || (s.provoked && s.hostileClans?.includes(clanId))) {
      broadcastEvent("raid", `${wg.destName} turned our trader wagon away: it comes back with its goods`);
      return;
    }
    const d = diploOf(s, clanId);
    const q = quoteSale(s, clanId, wg.cargo);
    for (const [g, n] of Object.entries(q.sold) as [TradeGood, number][]) {
      d.sold[g] = (d.sold[g] ?? 0) + n;
      s.stock[g] = Math.floor(s.stock[g] ?? 0) + n;
      wg.cargo[g] = (wg.cargo[g] ?? 0) - n;
      if ((wg.cargo[g] ?? 0) <= 0) delete wg.cargo[g];
    }
    s.stock.gold = Math.floor(s.stock.gold ?? 0) - q.gold;
    sold = q.sold;
    gold = Math.floor(q.gold * f);
    // Half the takings buy its most-stocked good we did not bring (within its daily sell cap and stock).
    const budget = Math.floor(gold / 2);
    const g = TRADE_GOODS.filter((x) => !(x in q.sold) && Math.floor(s.stock[x] ?? 0) > 0).sort((a, b) => (s.stock[b] ?? 0) - (s.stock[a] ?? 0))[0];
    let cost = 0;
    if (g && budget > 0) {
      const n0 = d.bought[g] ?? 0;
      const max = Math.min(Math.floor(s.stock[g] ?? 0), TRADE_DAILY_CAP_PER_GOOD - n0);
      let n = 0;
      while (n < max && batchGold(g, "buy", t, n0, n + 1) <= budget) n++;
      if (n > 0) {
        cost = batchGold(g, "buy", t, n0, n);
        d.bought[g] = n0 + n;
        s.stock[g] = Math.floor(s.stock[g] ?? 0) - n;
        s.stock.gold = Math.min(SETTLEMENT_GOLD_CAP, Math.floor(s.stock.gold ?? 0) + cost);
        bought = { [g]: n };
        gold -= cost;
      }
    }
    relation = gainRelation(clanId, s, WAGON_DELIVERY_RELATION + (q.gold + cost) / TRADE_GOLD_PER_RELATION, "trade");
  }
  wg.proceeds = { ...bought, gold };
  post.lastTrip = { dest: wg.destName, sold, gold, bought, relation: Math.round(relation * 100) / 100 };
  const goods = Object.entries(bought).map(([k, n]) => `${n} ${k}`).join(", ");
  broadcastEvent("build", `Trader wagon sold its goods at ${wg.destName}: ${gold} gold${goods ? ` + ${goods}` : ""}${relation >= 0.05 ? ` (relation +${relation.toFixed(1)})` : ""}, heading home`);
}

function arriveHome(w: Colonist, post: TradingPostState) {
  const wg = w.wagon!;
  const gains: string[] = [];
  for (const src of [wg.proceeds, wg.cargo]) {
    for (const [k, n] of Object.entries(src)) {
      if (!n) continue;
      state.stock[k as ResourceKey] = (state.stock[k as ResourceKey] ?? 0) + n;
      gains.push(`${n} ${k}`);
    }
  }
  broadcastEvent("build", `Trader wagon is home from ${wg.destName || "the road"}${gains.length ? `: +${gains.join(", +")}` : ""}`);
  Object.assign(wg, { leg: "home", route: [], cargo: {}, value: 0, proceeds: {}, resume: undefined, fleeing: undefined });
  w.path = [];
  releaseEscorts(w.postX, w.postY);
  void post;
}

function releaseEscorts(tx: number, ty: number) {
  const home = tileToPixelCenter({ x: tx, y: ty });
  for (const e of escortsAt(tx, ty)) {
    leaveOrderGroup(e.id);
    rallyUnit(e, home.x, home.y, null);
  }
}

// combat.ts damageColonist: a blow on a wagon (toast at most every WAGON_ALERT_TICKS).
export function noteWagonHit(w: Colonist) {
  const wg = w.wagon;
  if (!wg) return;
  if (wg.alertTick !== undefined && state.cycleTick - wg.alertTick < WAGON_ALERT_TICKS) return;
  wg.alertTick = state.cycleTick;
  withClan(clanById(w.clan ?? 0), () => broadcastEvent("raid", "Trader wagon under attack!"));
}

function nearestPlaceName(tx: number, ty: number): string {
  let best = "";
  let bestD = Infinity;
  for (const s of sites.values()) {
    const d = Math.hypot(s.keepX - tx, s.keepY - ty);
    if (d < bestD) {
      bestD = d;
      best = s.name;
    }
  }
  return best && bestD < 60 ? `near ${best}` : "on the road";
}

// combat.ts damageColonist: the wagon is destroyed (the caller removes it). Cargo and proceeds are lost; goods
// that never reached a settlement cost relation; a replacement can be bought after a day.
export function onWagonDestroyed(w: Colonist) {
  const wg = w.wagon;
  const post = postOfWagon(w);
  withClan(clanById(w.clan ?? 0), () => {
    const where = nearestPlaceName(Math.floor(w.x / TILE_SIZE), Math.floor(w.y / TILE_SIZE));
    broadcastEvent("death", `Our trader wagon was plundered ${where}: its ${wg?.value ?? 0} gold of goods are lost`);
    const outbound = wg && (wg.leg === "out" || wg.leg === "unload" || (wg.leg === "camp" && wg.resume === "out"));
    if (outbound && wg.dest.startsWith("s:") && sites.has(wg.dest.slice(2))) {
      adjustRelation(w.clan ?? 0, wg.dest.slice(2), -WAGON_LOSS_RELATION);
      broadcastEvent("raid", `${wg.destName}: the goods never arrived (relation -${WAGON_LOSS_RELATION})`);
    }
  });
  if (post) {
    post.wagonId = null;
    post.rebuildAtTick = state.cycleTick + GAME_DAY_TICKS;
  }
  releaseEscorts(w.postX, w.postY);
}

// ---- Per tick ----

function moveWagon(w: Colonist & { wagon: NonNullable<Colonist["wagon"]> }, post: TradingPostState) {
  const wg = w.wagon;
  if (wg.leg === "camp") {
    if (!isNightNow()) wg.leg = wg.resume ?? "back";
    return;
  }
  if (wg.leg === "unload") {
    if (state.cycleTick >= wg.waitUntil) {
      completeTrade(w, post);
      wg.leg = "back";
      w.path = wg.route.slice(0, -1).reverse();
    }
    return;
  }
  if (wg.leg !== "out" && wg.leg !== "back") return;
  if (isNightNow()) {
    wg.resume = wg.leg;
    wg.leg = "camp";
    w.state = "idle";
    return;
  }
  const goal = wg.leg === "out" ? wg.route[wg.route.length - 1] : wg.route[0] ?? { x: w.postX, y: w.postY };
  if (w.path.length > 0) {
    w.state = "walking";
    advanceAlongPath(w, dt, COLONIST_SPEED * tier(wg.level).speed * (wg.fleeing ? 1.3 : 1));
    return;
  }
  const at = tileOfPixel(w.x, w.y);
  if (!goal || Math.abs(at.x - goal.x) + Math.abs(at.y - goal.y) <= 1) {
    w.state = "idle";
    if (wg.leg === "out") {
      wg.leg = "unload";
      wg.waitUntil = state.cycleTick + WAGON_UNLOAD_TICKS;
    } else arriveHome(w, post);
    return;
  }
  // A gate closed on the planned road (advanceAlongPath dropped it): one new path, at most every 2 s.
  if (w.repathCooldown > 0) {
    w.repathCooldown--;
    return;
  }
  w.repathCooldown = 2 * TICK_RATE;
  const p = findPath(at, goal);
  if (p) w.path = p;
  else if (wg.leg === "out") recallWagon(w, `Trader wagon found no road to ${wg.destName}: it turns back`);
  else {
    const home = tileToPixelCenter({ x: w.postX, y: w.postY });
    w.x = home.x;
    w.y = home.y;
  }
}

function updatePost(key: string, post: TradingPostState, windowNow: boolean) {
  const [tx, ty] = keyXY(key);
  const lv = levelOf(tx, ty);
  let w = wagonOfPost(post);
  if (!w) post.wagonId = null;
  const home = !w || w.wagon.leg === "home";
  if (post.level !== lv && home) {
    reroster(post, tx, ty, lv);
    w = wagonOfPost(post);
  }
  const night = isNightNow();
  // A lost wagon: replaced at a dawn / dusk window once a day has passed, for its level's cost.
  if (!w && post.rebuildAtTick > 0 && windowNow && state.cycleTick >= post.rebuildAtTick) {
    const cost = tier(lv).rebuild;
    if (canAfford(cost)) {
      spend(cost);
      post.rebuildAtTick = 0;
      if (spawnWagon(post, tx, ty, lv)) broadcastEvent("build", `A new trader wagon is ready at the Trading Post (${formatCost(cost)})`);
      w = wagonOfPost(post);
    }
  }
  if (windowNow && home) {
    const added = topUpEscorts(tx, ty, lv, false);
    if (added > 0) broadcastEvent("build", `${added} escort${added === 1 ? "" : "s"} back on duty at the Trading Post`);
  }
  if (!w) return;
  const wg = w.wagon;
  if (wg.leg === "home") {
    if (w.hp < w.maxHp) w.hp = Math.min(w.maxHp, w.hp + w.maxHp * 0.02);
    if (post.auto && !night && state.cycleTick % GAME_DAY_TICKS < DAY_TICKS * AUTO_DEPART_UNTIL) sendWagon(key, "auto", false);
    return;
  }
  // On the road: keep the escort on its follow order (respawned / loaded / re-ordered units rejoin it).
  const escorts = escortsAt(tx, ty);
  if (escorts.length > 0) ensureFollowGroup(escorts, w.id);
  else if (tier(wg.level).escort.length > 0 && !wg.fleeing && (wg.leg === "out" || wg.leg === "unload")) {
    wg.fleeing = true;
    recallWagon(w, "Trader wagon lost its escort: it flees home");
  }
}

// Test hook wagonPost: look after one post now (roster + wagon) instead of at the next second.
export function refreshTradingPost(key: string) {
  const post = tradingPosts.get(key);
  if (!post) return;
  withClan(clanById(post.clan), () => updatePost(key, post, false));
}

// sim.ts, every tick: wagons move; posts are looked after once a second and at the dawn / dusk windows.
export function updateWagons() {
  if (state.cycleTick % SCAN_TICKS === 0) scanTradingPosts();
  if (tradingPosts.size === 0) return;
  const windowNow = !isNightNow() && respawnWindowAt(state.cycleTick) !== null;
  const slow = windowNow || state.cycleTick % TICK_RATE === 0;
  for (const [key, post] of tradingPosts) {
    enterClan(post.clan);
    const w = wagonOfPost(post);
    if (w) moveWagon(w, post);
    if (slow) updatePost(key, post, windowNow);
  }
  resetClan();
}

// ---- Snapshot, panel, commands, saves ----

export function wagonSnapshot(c: Colonist): WagonSnapshot | undefined {
  const wg = c.wagon;
  if (!wg) return undefined;
  const travelling = wg.leg === "out" || wg.leg === "back" || wg.leg === "camp";
  let route: number[] | undefined;
  if (travelling && c.path.length > 0) {
    route = [];
    for (let i = 0; i < c.path.length; i += 4) route.push(c.path[i].x, c.path[i].y);
    const last = c.path[c.path.length - 1];
    route.push(last.x, last.y);
  }
  return {
    level: wg.level, leg: wg.leg, dest: wg.destName, cargo: wg.leg === "back" ? wg.proceeds.gold ?? 0 : wg.value,
    danger: dangerBand(wg.danger), escorts: escortsAt(c.postX, c.postY).length, ...(route ? { route } : {}),
  };
}

const LEG_TEXT = { home: "At home", out: "On the way to", unload: "Trading at", back: "Coming home from", camp: "Camped for the night, bound for" } as const;

// BuildingInfo.tradingPost (runs in the requesting player's clan context). Computes at most one missing route.
export function tradingPostInfo(tx: number, ty: number): BuildingInfo["tradingPost"] | undefined {
  const key = resourceKey(tx, ty);
  if (!tradingPosts.has(key)) scanTradingPosts();
  const post = tradingPosts.get(key);
  if (!post) return undefined;
  const lv = levelOf(tx, ty);
  const w = wagonOfPost(post);
  const alive = escortsAt(tx, ty).map((c) => c.kind);
  const escorts = tier(lv).escort.map((kind) => {
    const i = alive.indexOf(kind);
    if (i >= 0) alive.splice(i, 1);
    return { kind, alive: i >= 0 };
  });
  const start = w ? tileOfPixel(w.x, w.y) : { x: tx, y: ty };
  let budget = 1;
  const destinations = destinationsFor(tx, ty).map((d) => {
    let plan = cachedRoute(key, d, start, false);
    if (!plan && d.ok && budget > 0) {
      budget--;
      plan = cachedRoute(key, d, start, true);
    }
    const noRoad = !!plan && plan.route.length === 0;
    return {
      id: d.id, name: d.name, kind: d.kind, dist: d.dist, danger: plan && !noRoad ? dangerBand(plan.danger) : null,
      profit: d.ok ? expectedProfit(d, lv) : 0, ok: d.ok && !noRoad, reason: noRoad ? "No road" : d.reason,
    };
  });
  let status: string;
  if (!w) {
    const left = Math.max(0, post.rebuildAtTick - state.cycleTick);
    status = post.rebuildAtTick > 0
      ? `Wagon lost: a new one (${formatCost(tier(lv).rebuild)}) at the first dawn / dusk ${left > 0 ? `after ${Math.ceil(left / TICK_RATE)}s` : "window"}`
      : "No wagon (clan limit reached)";
  } else if (w.wagon.leg === "home") {
    const last = post.lastTrip;
    status = `At home${last ? ` · last trip: ${last.gold} gold from ${last.dest}${last.relation > 0 ? `, relation +${last.relation}` : ""}` : ""}`;
  } else status = `${LEG_TEXT[w.wagon.leg]} ${w.wagon.destName} (${w.wagon.value} gold of goods, road ${dangerBand(w.wagon.danger)})`;
  const why = w ? sendProblem(post, w, lv) : "No wagon";
  return {
    level: lv, auto: post.auto, status,
    wagon: w ? { id: w.id, hp: Math.ceil(w.hp), maxHp: w.maxHp, leg: w.wagon.leg, dest: w.wagon.destName, cargo: w.wagon.value } : null,
    escorts, destinations, canSend: why === "", sendReason: why,
    canRecall: !!w && (w.wagon.leg === "out" || w.wagon.leg === "unload" || (w.wagon.leg === "camp" && w.wagon.resume === "out")),
  };
}

function sendProblem(post: TradingPostState, w: Colonist & { wagon: NonNullable<Colonist["wagon"]> }, lv: number): string {
  if (w.wagon.leg !== "home") return "On the road";
  if (isNightNow()) return "No travel at night";
  if ((post.lastTripDay === gameDay() ? post.tripsToday : 0) >= TRIPS_PER_DAY_MANUAL) return "No more trips today";
  if (planCargo(lv).value <= 0) return `Nothing to sell (keeps ${WAGON_EXPORT_RESERVE} of each good)`;
  return "";
}

// index.ts wagonCommand (sender's clan context). Returns a refusal / confirmation for the sender.
export function handleWagonCommand(tx: number, ty: number, cmd: unknown, dest: unknown, value: unknown): string {
  const key = resourceKey(tx, ty);
  if (!tradingPosts.has(key)) scanTradingPosts();
  const post = tradingPosts.get(key);
  if (!post || post.clan !== state.clan.id) return "No Trading Post of yours here";
  if (cmd === "auto") {
    post.auto = value === true;
    return `Auto-send ${post.auto ? "on: the wagon leaves each morning" : "off"}`;
  }
  if (cmd === "sendNow") return sendWagon(key, typeof dest === "string" && dest.length < 80 ? dest : "auto", true);
  if (cmd === "recall") {
    const w = wagonOfPost(post);
    return w && recallWagon(w) ? "Trader wagon turns for home" : "The wagon is not heading out";
  }
  return "Unknown command";
}

export function wagonsForSave() {
  return { posts: Array.from(tradingPosts, ([k, p]) => [k, { ...p }] as [string, TradingPostState]), raidAnchors: raidAnchors.map((a) => ({ ...a })) };
}

export function restoreWagons(saved: ReturnType<typeof wagonsForSave> | undefined) {
  tradingPosts.clear();
  routeCache.clear();
  internalDay.clear();
  for (const [k, p] of saved?.posts ?? []) tradingPosts.set(k, { ...p });
  raidAnchors = (saved?.raidAnchors ?? []).map((a) => ({ ...a }));
}

// Test hook wagonState: posts with their wagon + escorts.
export function wagonDebugState() {
  return Array.from(tradingPosts, ([key, post]) => {
    const [tx, ty] = keyXY(key);
    const w = wagonOfPost(post);
    return {
      key, ...post, levelNow: levelOf(tx, ty),
      wagon: w ? { id: w.id, x: w.x, y: w.y, hp: w.hp, maxHp: w.maxHp, pathLeft: w.path.length, ...w.wagon, route: w.wagon.route.length } : null,
      escorts: escortsAt(tx, ty).map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, hp: c.hp, state: c.state })),
      attackers: w ? Array.from(mobs.values()).filter((m) => m.targetType === "colonist" && m.targetId === w.id).map((m) => m.id) : [],
    };
  });
}
