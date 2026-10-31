// quests.ts: Forts phase D2 (PLAN-forts-diplomacy-moats.md "Decisions" 6): help quests a human settlement posts
// to a clan (per clan: each clan sees, accepts and is paid for its own). Kinds: defend (night, hostile mobs near
// its walls), clearCamp (a bandit / orc camp or fort keep near it), deliver (a good it is short of). Posted on a
// schedule from game state only (never by the player), not by Hostile settlements or ones up in arms against the
// clan, at most QUEST_MAX_PER_SITE open per settlement per clan, with a per-settlement cooldown. Completion pays
// gold (from nowhere: the settlement's purse pays what it can) and gains relation under the daily quest cap;
// failure / abandoning / ignoring it costs relation. Saved (additive `quests`).
import { TILE_SIZE, TRADE_GOODS, type QuestKind, type QuestSnapshot, type TradeGood } from "@colony/shared/protocol";
import type { HearthState, Mob, Player, SiteState } from "./types.js";
import {
  DAY_TICKS, NIGHT_TICKS, QUEST_ABANDON_PENALTY, QUEST_CAMP_RANGE_TILES, QUEST_COOLDOWN_TICKS, QUEST_DEFEND_MAX_NEED,
  QUEST_DEFEND_MIN_MOBS, QUEST_DEFEND_RANGE_TILES, QUEST_DELIVER_QTY, QUEST_DELIVER_SHORT, QUEST_EXPIRE_TICKS,
  CAMP_QUEST_CHANCE_MULT, QUEST_FAIL_PENALTY, QUEST_IGNORE_PENALTY, QUEST_MAX_PER_SITE, QUEST_POST_CHANCE, QUEST_RELATION_GAIN, QUEST_SCAN_TICKS,
  QUEST_TIER_REWARD, SETTLEMENT_PRODUCTION, SETTLEMENT_STOCK_CAP, TRADE_BASE_PRICE, TRADE_RANGE_TILES,
} from "./constants.js";
import { clans, hearths, mobs, sites, state } from "./state.js";
import { adjustRelation, attackerClan, overgrownCampNear } from "./sites.js";
import { clanById, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { isNightNow } from "./tiles.js";
import { clanInRange, diploOf, gainRelation, standingTown, tierOf, tilesToWalls } from "./diplomacy.js";

export interface Quest {
  id: number;
  clan: number;
  siteId: string;
  kind: QuestKind;
  postedTick: number;
  expiresTick: number;
  reward: number;
  relation: number;
  accepted: boolean;
  x: number;
  y: number;
  // clearCamp: the target hearth's siteId.
  targetId?: string;
  good?: TradeGood;
  qty?: number;
  kills?: number;
  need?: number;
}

export const quests: Quest[] = [];
let nextQuestId = 1;
export let questsVersion = 0;
const bump = () => questsVersion++;

const GOOD_LABEL: Record<TradeGood, string> = {
  grain: "grain", meat: "meat", fruit: "fruit", wool: "wool", wood: "wood", rock: "stone", iron: "iron", clothes: "cloth", tools: "tools",
};

function toClan(clanId: number, category: "milestone" | "raid" | "build", text: string) {
  withClan(clanById(clanId), () => broadcastEvent(category, text));
}

const openFor = (clanId: number, siteId: string) => quests.filter((q) => q.clan === clanId && q.siteId === siteId);
const nextDawnTick = () => {
  const cycle = DAY_TICKS + NIGHT_TICKS;
  return (Math.floor(state.cycleTick / cycle) + 1) * cycle;
};

// Why this settlement cannot post this clan a quest at all ("" = it can).
function postBlock(s: SiteState | undefined, clanId: number): string {
  if (!standingTown(s)) return "not a standing settlement";
  if (tierOf(clanId, s) === "hostile") return "hostile to the clan";
  if (s.provoked && s.hostileClans?.includes(clanId)) return "up in arms against the clan";
  return "";
}

function hostileMobsNear(s: SiteState, range: number): Mob[] {
  const out: Mob[] = [];
  for (const m of mobs.values()) {
    if (m.hp <= 0 || m.siteId) continue;
    if (tilesToWalls(s, Math.floor(m.x / TILE_SIZE), Math.floor(m.y / TILE_SIZE)) <= range) out.push(m);
  }
  return out;
}

function campNear(s: SiteState, clanId: number): HearthState | undefined {
  let best: HearthState | undefined;
  let bestD = Infinity;
  for (const h of hearths.values()) {
    if (h.destroyed || sites.get(h.siteId)?.faction === "human") continue;
    if (quests.some((q) => q.clan === clanId && q.targetId === h.siteId)) continue;
    const d = Math.hypot(h.x - s.keepX, h.y - s.keepY);
    if (d <= QUEST_CAMP_RANGE_TILES && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

function shortGood(s: SiteState, clanId: number): TradeGood | undefined {
  const made = SETTLEMENT_PRODUCTION[s.template] ?? {};
  const taken = new Set(openFor(clanId, s.id).map((q) => q.good));
  const short = TRADE_GOODS.filter((g) => !made[g] && (s.stock[g] ?? 0) < QUEST_DELIVER_SHORT && !taken.has(g));
  return short.length ? short[Math.floor(Math.random() * short.length)] : undefined;
}

// Builds (and posts) a quest of `kind` from s to clanId, or returns why it can't.
function postQuest(s: SiteState, clanId: number, kind: QuestKind): Quest | string {
  const factor = QUEST_TIER_REWARD[tierOf(clanId, s)];
  const now = state.cycleTick;
  const base = { id: nextQuestId, clan: clanId, siteId: s.id, kind, postedTick: now, expiresTick: now + QUEST_EXPIRE_TICKS, accepted: false, relation: QUEST_RELATION_GAIN[kind], x: s.keepX, y: s.keepY };
  let q: Quest;
  if (kind === "defend") {
    if (!isNightNow()) return "defend quests are posted at night";
    if (openFor(clanId, s.id).some((o) => o.kind === "defend")) return "already asked for defence tonight";
    const near = hostileMobsNear(s, QUEST_DEFEND_RANGE_TILES).length;
    if (near < QUEST_DEFEND_MIN_MOBS) return `only ${near} hostile mobs near it`;
    const need = Math.min(near, QUEST_DEFEND_MAX_NEED);
    q = { ...base, expiresTick: nextDawnTick(), reward: Math.round(20 * need * factor), kills: 0, need };
  } else if (kind === "clearCamp") {
    const h = campNear(s, clanId);
    if (!h) return `no camp within ${QUEST_CAMP_RANGE_TILES} tiles`;
    q = { ...base, x: h.x, y: h.y, targetId: h.siteId, reward: Math.round((60 + 6 * h.garrison) * factor) };
  } else {
    const good = shortGood(s, clanId);
    if (!good) return "it lacks nothing";
    const qty = QUEST_DELIVER_QTY[s.template] ?? 20;
    q = { ...base, good, qty, reward: Math.round(2 * TRADE_BASE_PRICE[good] * qty * factor) };
  }
  nextQuestId++;
  quests.push(q);
  diploOf(s, clanId).questNextTick = now + QUEST_COOLDOWN_TICKS;
  bump();
  toClan(clanId, "milestone", `${s.name} asks for help: ${questTitle(q, s)} (${q.reward} gold). Open Quests to accept`);
  return q;
}

function questTitle(q: Quest, s: SiteState): string {
  if (q.kind === "defend") return `Defend ${s.name} tonight`;
  if (q.kind === "clearCamp") return `Clear the camp near ${s.name}`;
  return `Deliver ${q.qty} ${GOOD_LABEL[q.good ?? "grain"]} to ${s.name}`;
}

function questText(q: Quest, s: SiteState): string {
  if (q.kind === "defend") return `Raiders prowl near ${s.name}. Kill ${q.need} hostile creatures within ${QUEST_DEFEND_RANGE_TILES} tiles of its walls before dawn, and keep its keep standing.`;
  if (q.kind === "clearCamp") {
    const h = q.targetId ? hearths.get(q.targetId) : undefined;
    const d = h ? Math.round(Math.hypot(h.x - s.keepX, h.y - s.keepY)) : 0;
    return `A ${h?.faction ?? "bandit"} ${h?.siteKind === "fort" ? "fort" : "camp"} lies ${d} tiles from ${s.name}. Destroy its ${h?.siteKind === "fort" ? "keep" : "hearth"} with your own folk.`;
  }
  return `${s.name} is short of ${GOOD_LABEL[q.good ?? "grain"]}. Bring ${q.qty} from your stock: stand within ${TRADE_RANGE_TILES} tiles of its walls and press Deliver.`;
}

function closeQuest(q: Quest) {
  const i = quests.indexOf(q);
  if (i >= 0) quests.splice(i, 1);
  bump();
}

function completeQuest(q: Quest, s: SiteState) {
  closeQuest(q);
  const clan = clanById(q.clan);
  clan.stock.gold = (clan.stock.gold ?? 0) + q.reward;
  s.stock.gold = Math.max(0, (s.stock.gold ?? 0) - q.reward);
  const gained = gainRelation(q.clan, s, q.relation, "quest");
  toClan(q.clan, "milestone", `Quest complete: ${questTitle(q, s)}. +${q.reward} gold${gained >= 0.05 ? `, relation +${gained.toFixed(1)}` : ""}`);
}

function failQuest(q: Quest, s: SiteState, why: string, penalty: number) {
  closeQuest(q);
  adjustRelation(q.clan, s.id, -penalty);
  toClan(q.clan, "raid", `Quest failed: ${questTitle(q, s)} (${why}). Relation -${penalty}`);
}

// One scan: every standing, sighted settlement may post each eligible clan one quest. force: always roll a
// post and ignore the cooldown (test hook questScan).
export function scanQuests(force = false): Quest[] {
  const posted: Quest[] = [];
  for (const s of sites.values()) {
    if (!standingTown(s) || !s.sighted) continue;
    for (const clan of clans) {
      if (postBlock(s, clan.id) || openFor(clan.id, s.id).length >= QUEST_MAX_PER_SITE) continue;
      // Forts phase G: an overgrown camp nearby: posts more often, and asks for the camp first.
      const hot = !!overgrownCampNear(s);
      const chance = QUEST_POST_CHANCE * (hot ? CAMP_QUEST_CHANCE_MULT : 1);
      if (!force && ((s.diplo?.[clan.id]?.questNextTick ?? 0) > state.cycleTick || Math.random() >= chance)) continue;
      // Defence first when it is needed tonight; else a camp or a shortage, in random order.
      const kinds: QuestKind[] = hot || Math.random() < 0.5 ? ["clearCamp", "deliver"] : ["deliver", "clearCamp"];
      if (isNightNow()) kinds.unshift("defend");
      for (const kind of kinds) {
        const q = postQuest(s, clan.id, kind);
        if (typeof q !== "string") {
          posted.push(q);
          break;
        }
      }
    }
  }
  return posted;
}

// Test hook questPost: post one quest of `kind` now (ignores chance, cooldown and the per-settlement cap).
export function forcePostQuest(siteId: string, clanId: number, kind: QuestKind): Quest | string {
  const s = sites.get(siteId);
  const block = postBlock(s, clanId);
  return block || postQuest(s!, clanId, kind);
}

// sim.ts every tick: expiry, defend success at dawn, settlements that fell / turned hostile, the scan.
export function updateQuests() {
  const now = state.cycleTick;
  for (const q of [...quests]) {
    const s = sites.get(q.siteId);
    if (!standingTown(s) || postBlock(s, q.clan)) {
      closeQuest(q);
      if (s) toClan(q.clan, "build", `${s.name} withdrew its request: ${questTitle(q, s)}`);
      continue;
    }
    if (q.kind === "defend" && q.accepted && hearths.get(s.id)?.destroyed) {
      failQuest(q, s, "its keep fell", QUEST_FAIL_PENALTY);
      continue;
    }
    if (q.kind === "clearCamp" && (!q.targetId || hearths.get(q.targetId)?.destroyed !== false)) {
      closeQuest(q);
      toClan(q.clan, "build", `${questTitle(q, s)}: the camp is gone`);
      continue;
    }
    if (now < q.expiresTick) continue;
    if (q.kind === "defend" && q.accepted && (q.kills ?? 0) >= (q.need ?? 0)) completeQuest(q, s);
    else if (q.accepted) failQuest(q, s, q.kind === "defend" ? `only ${q.kills ?? 0} of ${q.need} slain by dawn` : "time ran out", QUEST_FAIL_PENALTY);
    else {
      closeQuest(q);
      adjustRelation(q.clan, s.id, -QUEST_IGNORE_PENALTY);
      toClan(q.clan, "raid", `You ignored ${s.name}'s plea: ${questTitle(q, s)}. Relation -${QUEST_IGNORE_PENALTY}`);
    }
  }
  if (now % QUEST_SCAN_TICKS === 0) scanQuests();
}

// combat.ts damageMob: a clan unit killed a mob (no site) near a settlement with an accepted defend quest.
export function noteQuestKill(mob: Mob, attackerKey?: string) {
  if (mob.siteId || !attackerKey || !(attackerKey.startsWith("p:") || attackerKey.startsWith("c:"))) return;
  if (!quests.some((q) => q.kind === "defend" && q.accepted)) return;
  const clanId = attackerClan(attackerKey);
  const tx = Math.floor(mob.x / TILE_SIZE);
  const ty = Math.floor(mob.y / TILE_SIZE);
  for (const q of quests) {
    const s = sites.get(q.siteId);
    if (q.kind !== "defend" || !q.accepted || q.clan !== clanId || !s || tilesToWalls(s, tx, ty) > QUEST_DEFEND_RANGE_TILES) continue;
    q.kills = (q.kills ?? 0) + 1;
    bump();
    if (q.kills === q.need) toClan(clanId, "milestone", `${s.name}: enough raiders slain. Hold until dawn for your reward`);
  }
}

// hearths.ts destroyHearth: an accepted clearCamp quest on this hearth is done by its clan (others' close in
// updateQuests: "the camp is gone").
export function noteQuestCampCleared(h: HearthState, attackerKey?: string) {
  const clanId = attackerClan(attackerKey);
  for (const q of [...quests]) {
    const s = sites.get(q.siteId);
    if (q.kind === "clearCamp" && q.targetId === h.siteId && q.accepted && q.clan === clanId && standingTown(s)) completeQuest(q, s);
  }
}

// Messages (index.ts, in the sender's clan context). Returns a refusal text, or "" when done (toasts sent).
export function handleQuestMessage(player: Player | undefined, type: "acceptQuest" | "abandonQuest" | "deliverQuest", questId: unknown): string {
  const clanId = state.clan.id;
  const q = quests.find((o) => o.id === questId && o.clan === clanId);
  const s = q ? sites.get(q.siteId) : undefined;
  if (!q || !standingTown(s)) return "That quest is no longer open";
  if (type === "acceptQuest") {
    if (q.accepted) return "Already accepted";
    q.accepted = true;
    bump();
    toClan(clanId, "build", `Quest accepted: ${questTitle(q, s)}`);
    return "";
  }
  if (type === "abandonQuest") {
    if (!q.accepted) return "Not accepted";
    failQuest(q, s, "abandoned", QUEST_ABANDON_PENALTY);
    return "";
  }
  if (q.kind !== "deliver" || !q.good || !q.qty) return "Nothing to deliver";
  if (!q.accepted) return "Accept the quest first";
  if (!clanInRange(s, clanId, player)) return `Walk up to ${s.name}'s walls (within ${TRADE_RANGE_TILES} tiles)`;
  const have = Math.floor(state.stock[q.good] ?? 0);
  if (have < q.qty) return `You have only ${have} ${GOOD_LABEL[q.good]} (${q.qty} needed)`;
  state.stock[q.good] = have - q.qty;
  s.stock[q.good] = Math.min(SETTLEMENT_STOCK_CAP, (s.stock[q.good] ?? 0) + q.qty);
  completeQuest(q, s);
  return "";
}

// Snapshot `quests` for one clan.
export function questsForSnapshot(clanId: number): QuestSnapshot[] {
  const out: QuestSnapshot[] = [];
  for (const q of quests) {
    const s = sites.get(q.siteId);
    if (q.clan !== clanId || !s) continue;
    out.push({
      id: q.id, kind: q.kind, siteNum: s.num, siteName: s.name, title: questTitle(q, s), text: questText(q, s),
      reward: q.reward, relation: q.relation, penalty: q.accepted ? QUEST_FAIL_PENALTY : QUEST_IGNORE_PENALTY,
      ticksLeft: Math.max(0, q.expiresTick - state.cycleTick), accepted: q.accepted, x: q.x, y: q.y,
      ...(q.good ? { good: q.good, qty: q.qty } : {}), ...(q.kind === "defend" ? { progress: q.kills ?? 0, need: q.need } : {}),
    });
  }
  return out;
}

export function hasQuestsFor(clanId: number): boolean {
  return quests.some((q) => q.clan === clanId);
}

export function questsForSave() {
  return { nextId: nextQuestId, list: quests.map((q) => ({ ...q })) };
}

export function restoreQuests(saved: { nextId?: number; list?: Quest[] } | undefined) {
  quests.length = 0;
  for (const q of saved?.list ?? []) if (sites.has(q.siteId) && q.clan < clans.length) quests.push({ ...q });
  nextQuestId = Math.max(saved?.nextId ?? 1, ...quests.map((q) => q.id + 1));
  bump();
}
