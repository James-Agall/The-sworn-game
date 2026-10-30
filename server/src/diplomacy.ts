// diplomacy.ts: Forts phase D (PLAN-forts-diplomacy-moats.md §4, §5 direct trade): relation tiers per clan per
// human settlement, relation gains with daily caps / diminishing returns, drift toward neutral, settlement
// production at dawn, and direct trade (prices by tier, stock / purse / daily caps). Relation storage stays the
// phase C hook (sites.ts relationOf / adjustRelation over Clan.relations); per-day counters live in
// SiteState.diplo (saved with the site).
import { TILE_SIZE, TRADE_GOODS, RELATION_TIER_NAMES, type BuildingInfo, type RelationTier, type SiteRelationSnapshot, type TradeGood } from "@colony/shared/protocol";
import type { HearthState, Mob, Player, SiteDiplo, SiteState } from "./types.js";
import {
  DAY_TICKS, NIGHT_TICKS, RELATION_ALLIED_MIN, RELATION_CAMP_FAR_BONUS, RELATION_CAMP_FAR_TILES, RELATION_CAMP_NEAR_BONUS,
  RELATION_CAMP_NEAR_TILES, RELATION_DEFEND_DAILY_CAP, RELATION_DEFEND_RANGE_TILES, RELATION_DIMINISH_FLOOR,
  RELATION_DRIFT_PER_DAY, RELATION_FRIENDLY_MIN, RELATION_IDLE_DAYS, RELATION_MAX, RELATION_NEUTRAL, RELATION_NEUTRAL_MIN,
  RELATION_TRADE_DAILY_CAP, RELATION_VASSAL_KEEP, RELATION_WARY_MIN, SETTLEMENT_CONSUME_FRACTION, SETTLEMENT_GOLD_CAP,
  SETTLEMENT_PRODUCTION, SETTLEMENT_STOCK_CAP, TRADE_BASE_PRICE, TRADE_BUY_MARKUP, TRADE_DAILY_CAP_PER_GOOD, TRADE_DAY_STEP,
  TRADE_GOLD_PER_RELATION, TRADE_MAX_QTY, TRADE_RANGE_TILES, TRADE_SELL_FACTOR, TRADE_SELL_FLOOR, TRADE_TIER_DISCOUNT,
} from "./constants.js";
import { clans, colonists, sites, state } from "./state.js";
import { adjustRelation, attackerClan, relationOf } from "./sites.js";
import { clanById, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";

export function gameDay(): number {
  return Math.floor(state.cycleTick / (DAY_TICKS + NIGHT_TICKS));
}

const standingTown = (s: SiteState | undefined): s is SiteState => !!s && s.faction === "human" && !s.cleared && !s.captured;

export function relationTier(value: number, vassal?: boolean): RelationTier {
  if (vassal) return "vassal";
  if (value >= RELATION_ALLIED_MIN) return "allied";
  if (value >= RELATION_FRIENDLY_MIN) return "friendly";
  if (value >= RELATION_NEUTRAL_MIN) return "neutral";
  if (value >= RELATION_WARY_MIN) return "wary";
  return "hostile";
}

// One clan's bookkeeping at a settlement; counters reset on a new game day.
export function diploOf(s: SiteState, clanId: number): SiteDiplo {
  s.diplo ??= {};
  const day = gameDay();
  let d = s.diplo[clanId];
  if (!d) d = s.diplo[clanId] = { day, bought: {}, sold: {}, tradeGain: 0, defendGain: 0, lastGainDay: 0 };
  if (d.day !== day) Object.assign(d, { day, bought: {}, sold: {}, tradeGain: 0, defendGain: 0 });
  return d;
}

export function tierOf(clanId: number, s: SiteState): RelationTier {
  return relationTier(relationOf(clanId, s.id), s.diplo?.[clanId]?.vassal);
}

// sites.ts adjustRelation: the snapshot is resent, the vassal flag kept (100 sets it, < 70 breaks it), a
// tier change toasts the clan.
export function onRelationChanged(clanId: number, s: SiteState, before: number, after: number) {
  state.relationsVersion++;
  if (s.faction !== "human") return;
  const d = s.diplo?.[clanId];
  const wasVassal = !!d?.vassal;
  const t0 = relationTier(before, wasVassal);
  let vassal = wasVassal;
  if (after >= RELATION_MAX) vassal = true;
  else if (after < RELATION_VASSAL_KEEP) vassal = false;
  if (vassal !== wasVassal) diploOf(s, clanId).vassal = vassal;
  const t1 = relationTier(after, vassal);
  if (t0 === t1) return;
  const order: RelationTier[] = ["hostile", "wary", "neutral", "friendly", "allied", "vassal"];
  const up = order.indexOf(t1) > order.indexOf(t0);
  const extra = t1 === "vassal" ? ": they would swear fealty to you" : t1 === "hostile" ? ": they refuse to trade" : t1 === "wary" ? ": no trade until you mend relations" : up ? ": better prices" : "";
  withClan(clanById(clanId), () => broadcastEvent(up ? "milestone" : "raid", `${s.name} is now ${RELATION_TIER_NAMES[t1]} toward you (${Math.round(after)})${extra}`));
}

// A capped, diminishing gain (trade / defence). None from Hostile or while the settlement is up in arms
// against this clan.
function gainRelation(clanId: number, s: SiteState, raw: number, kind: "trade" | "defend"): number {
  if (!standingTown(s) || raw <= 0) return 0;
  if (relationTier(relationOf(clanId, s.id)) === "hostile") return 0;
  if (s.provoked && s.hostileClans?.includes(clanId)) return 0;
  const d = diploOf(s, clanId);
  const cap = kind === "trade" ? RELATION_TRADE_DAILY_CAP : RELATION_DEFEND_DAILY_CAP;
  const used = kind === "trade" ? d.tradeGain : d.defendGain;
  const g = Math.min(cap - used, raw * Math.max(RELATION_DIMINISH_FLOOR, 1 - used / cap));
  if (g <= 0) return 0;
  if (kind === "trade") d.tradeGain += g;
  else d.defendGain += g;
  d.lastGainDay = d.day;
  adjustRelation(clanId, s.id, g);
  return g;
}

// Tiles from (tx, ty) to the settlement's rectangle (0 inside).
function tilesToWalls(s: SiteState, tx: number, ty: number): number {
  return Math.max(s.x0 - tx, 0, tx - s.x1, s.y0 - ty, ty - s.y1);
}

// combat.ts damageMob: a clan unit killed a hostile mob (anything but a settlement's own folk) near a
// settlement's walls: it defended them.
export function noteHostileKill(mob: Mob, attackerKey?: string) {
  if (!attackerKey || !(attackerKey.startsWith("p:") || attackerKey.startsWith("c:"))) return;
  if (mob.siteId && sites.get(mob.siteId)?.faction === "human") return;
  const tx = mob.x / TILE_SIZE;
  const ty = mob.y / TILE_SIZE;
  let clan: number | null = null;
  for (const s of sites.values()) {
    if (!standingTown(s) || tilesToWalls(s, tx, ty) > RELATION_DEFEND_RANGE_TILES) continue;
    clan ??= attackerClan(attackerKey);
    gainRelation(clan, s, 1, "defend");
  }
}

// hearths.ts destroyHearth: a bandit / orc camp or fort keep fell; nearby settlements are grateful.
export function noteCampCleared(h: HearthState, attackerKey?: string) {
  if (sites.get(h.siteId)?.faction === "human") return;
  const clan = attackerClan(attackerKey);
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const d = Math.hypot(s.keepX - h.x, s.keepY - h.y);
    const bonus = d <= RELATION_CAMP_NEAR_TILES ? RELATION_CAMP_NEAR_BONUS : d <= RELATION_CAMP_FAR_TILES ? RELATION_CAMP_FAR_BONUS : 0;
    if (bonus === 0) continue;
    diploOf(s, clan).lastGainDay = gameDay();
    adjustRelation(clan, s.id, bonus);
    withClan(clanById(clan), () => broadcastEvent("milestone", `${s.name} thanks you for clearing the camp (relation +${bonus})`));
  }
}

// sim.ts at dawn: every standing settlement produces its daily goods and uses up some of the rest; every
// clan's relation drifts 1 toward neutral when it has gained nothing for RELATION_IDLE_DAYS.
export function settlementsDawn() {
  const day = gameDay();
  for (const s of sites.values()) {
    if (!standingTown(s)) continue;
    const made = SETTLEMENT_PRODUCTION[s.template] ?? {};
    for (const good of TRADE_GOODS) {
      const have = s.stock[good] ?? 0;
      const add = made[good] ?? 0;
      s.stock[good] = add > 0 ? Math.min(SETTLEMENT_STOCK_CAP, have + add) : Math.floor(have * (1 - SETTLEMENT_CONSUME_FRACTION));
    }
    s.stock.gold = Math.min(SETTLEMENT_GOLD_CAP, (s.stock.gold ?? 0) + (made.gold ?? 0));
    for (const clan of clans) {
      const v = clan.relations[s.num];
      if (v === undefined || v === RELATION_NEUTRAL) continue;
      const last = s.diplo?.[clan.id]?.lastGainDay ?? 0;
      if (day - last < RELATION_IDLE_DAYS) continue;
      const step = Math.min(RELATION_DRIFT_PER_DAY, Math.abs(v - RELATION_NEUTRAL));
      adjustRelation(clan.id, s.id, v > RELATION_NEUTRAL ? -step : step);
    }
  }
}

function discountOf(tier: RelationTier): number {
  return tier === "vassal" || tier === "allied" || tier === "friendly" ? TRADE_TIER_DISCOUNT[tier] : TRADE_TIER_DISCOUNT.neutral;
}

// Gold per unit for the n-th unit traded today (n = units of that good already bought / sold today).
export function unitPrice(good: TradeGood, side: "buy" | "sell", tier: RelationTier, n: number): number {
  const base = TRADE_BASE_PRICE[good];
  const disc = discountOf(tier);
  if (side === "buy") return base * TRADE_BUY_MARKUP * disc * (1 + TRADE_DAY_STEP * n);
  return Math.max(base * TRADE_SELL_FLOOR, base * TRADE_SELL_FACTOR * (2 - disc) * (1 - TRADE_DAY_STEP * n));
}

function batchGold(good: TradeGood, side: "buy" | "sell", tier: RelationTier, n0: number, qty: number): number {
  let sum = 0;
  for (let i = 0; i < qty; i++) sum += unitPrice(good, side, tier, n0 + i);
  return side === "buy" ? Math.ceil(sum) : Math.floor(sum);
}

// The player (or one of the clan's living colonists) within TRADE_RANGE_TILES of the walls.
function clanInRange(s: SiteState, clanId: number, player?: Player): boolean {
  const near = (x: number, y: number) => tilesToWalls(s, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)) <= TRADE_RANGE_TILES;
  if (player && !player.dead && near(player.x, player.y)) return true;
  for (const u of colonists.values()) if ((u.clan ?? 0) === clanId && u.hp > 0 && near(u.x, u.y)) return true;
  return false;
}

// Why the clan cannot trade here now ("" = it can).
function tradeProblem(s: SiteState, clanId: number, player?: Player): string {
  if (!standingTown(s)) return "Nobody left to trade with";
  if (s.provoked) return "Up in arms: they refuse to trade";
  const tier = tierOf(clanId, s);
  if (tier === "hostile") return "Hostile: they refuse to trade";
  if (tier === "wary") return "Wary: no trade until relations reach Neutral";
  if (!clanInRange(s, clanId, player)) return `Walk up to the walls (within ${TRADE_RANGE_TILES} tiles)`;
  return "";
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function tradeInfoFor(s: SiteState, player?: Player): BuildingInfo["trade"] | undefined {
  if (!standingTown(s)) return undefined;
  const clanId = player?.clan ?? 0;
  const tier = tierOf(clanId, s);
  const d = diploOf(s, clanId);
  const reason = tradeProblem(s, clanId, player);
  return {
    siteName: s.name, relation: Math.round(relationOf(clanId, s.id)), tier, discount: discountOf(tier),
    gold: Math.floor(s.stock.gold ?? 0), canTrade: reason === "", reason,
    goods: TRADE_GOODS.map((good) => {
      const stock = Math.floor(s.stock[good] ?? 0);
      return {
        good, stock, cap: SETTLEMENT_STOCK_CAP,
        buy: round2(unitPrice(good, "buy", tier, d.bought[good] ?? 0)),
        sell: round2(unitPrice(good, "sell", tier, d.sold[good] ?? 0)),
        buyLeft: Math.max(0, Math.min(stock, TRADE_DAILY_CAP_PER_GOOD - (d.bought[good] ?? 0))),
        sellLeft: Math.max(0, Math.min(SETTLEMENT_STOCK_CAP - stock, TRADE_DAILY_CAP_PER_GOOD - (d.sold[good] ?? 0))),
      };
    }),
  };
}

// Runs in the sender's clan context (index.ts handleMessage): state.stock is that clan's stock.
// Returns the toast text (also sent to the clan) or the refusal reason.
export function handleTradeWithSite(player: Player | undefined, s: SiteState | undefined, good: unknown, qtyIn: unknown, side: unknown): { ok: boolean; text: string } {
  const clanId = state.clan.id;
  if (!s || !TRADE_GOODS.includes(good as TradeGood) || (side !== "buy" && side !== "sell")) return { ok: false, text: "Bad trade" };
  if (typeof qtyIn !== "number" || !Number.isInteger(qtyIn) || qtyIn < 1 || qtyIn > TRADE_MAX_QTY) return { ok: false, text: `Trade 1-${TRADE_MAX_QTY} units` };
  const g = good as TradeGood;
  const problem = tradeProblem(s, clanId, player);
  if (problem) return { ok: false, text: problem };
  const tier = tierOf(clanId, s);
  const d = diploOf(s, clanId);
  const theirs = Math.floor(s.stock[g] ?? 0);
  let qty: number;
  let gold: number;
  if (side === "buy") {
    const n0 = d.bought[g] ?? 0;
    qty = Math.min(qtyIn, theirs, TRADE_DAILY_CAP_PER_GOOD - n0);
    if (qty <= 0) return { ok: false, text: theirs <= 0 ? `${s.name} has no ${g} left` : `${s.name} sells no more ${g} today` };
    gold = batchGold(g, "buy", tier, n0, qty);
    if ((state.stock.gold ?? 0) < gold) return { ok: false, text: `Not enough gold (${gold} needed)` };
    state.stock.gold -= gold;
    state.stock[g] = (state.stock[g] ?? 0) + qty;
    s.stock[g] = theirs - qty;
    s.stock.gold = Math.min(SETTLEMENT_GOLD_CAP, (s.stock.gold ?? 0) + gold);
    d.bought[g] = n0 + qty;
  } else {
    const n0 = d.sold[g] ?? 0;
    qty = Math.min(qtyIn, Math.floor(state.stock[g] ?? 0), TRADE_DAILY_CAP_PER_GOOD - n0, SETTLEMENT_STOCK_CAP - theirs);
    if (qty <= 0) return { ok: false, text: (state.stock[g] ?? 0) < 1 ? `You have no ${g}` : `${s.name} buys no more ${g} today` };
    const purse = Math.floor(s.stock.gold ?? 0);
    gold = batchGold(g, "sell", tier, n0, qty);
    while (qty > 0 && gold > purse) gold = batchGold(g, "sell", tier, n0, --qty);
    if (qty <= 0) return { ok: false, text: `${s.name} cannot afford it (purse ${purse} gold)` };
    if (gold <= 0) return { ok: false, text: "Too little to be worth it: sell more at once" };
    state.stock[g] -= qty;
    state.stock.gold = (state.stock.gold ?? 0) + gold;
    s.stock[g] = theirs + qty;
    s.stock.gold = purse - gold;
    d.sold[g] = n0 + qty;
  }
  const gained = gainRelation(clanId, s, gold / TRADE_GOLD_PER_RELATION, "trade");
  const text = `${side === "buy" ? "Bought" : "Sold"} ${qty} ${g} ${side === "buy" ? "from" : "to"} ${s.name} for ${gold} gold${gained >= 0.05 ? ` (relation +${gained.toFixed(1)})` : ""}`;
  broadcastEvent("build", text);
  return { ok: true, text };
}

// Snapshot `relations` for one clan: every sighted standing settlement.
export function relationsForSnapshot(clanId: number): SiteRelationSnapshot[] {
  const out: SiteRelationSnapshot[] = [];
  for (const s of sites.values()) {
    if (!standingTown(s) || !s.sighted) continue;
    out.push({ num: s.num, value: Math.round(relationOf(clanId, s.id)), tier: tierOf(clanId, s) });
  }
  return out;
}
