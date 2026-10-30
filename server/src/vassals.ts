// vassals.ts: Forts phase F (PLAN-forts-diplomacy-moats.md §6, ROADMAP "Forts phase F — landed"): a human
// settlement whose relation with a clan reaches RELATION_MAX swears fealty (SiteState.vassalOf = that clan) if
// the clan's power is at least its own; it stays a vassal while relation >= RELATION_VASSAL_KEEP and it is not
// stronger than its liege (checked at dawn). The liege can call its troops to arms (a levy of its garrison
// guards, turned into the clan's colonists for a game day, flagged levyOf) and demand tribute (a share of its
// stock every TAX_INTERVAL_DAYS, scaled by the power ratio, costing relation).
//
// Power, as used everywhere here:
//   clan power  = sum over the clan's living fighters (isGuardOrMilitiaKind; levies excluded) of hp x damage
//                 per hit (unitStats) + POWER_PER_TOWER_LEVEL x level of each of its towers + POWER_PER_WALL
//                 per wall / gate tile it owns;
//   settlement  = sum over its living garrison mobs of hp x damage + POWER_PER_TOWER_LEVEL per tower +
//                 POWER_PER_WALL per wall / gate tile it owns.
// Per-tick cost: updateVassals runs at 1 Hz and only touches settlements with a levy on the field; clan power
// is a map scan cached POWER_CACHE_TICKS and only computed for panels, calls and the dawn pass.
import { TILE_SIZE, TRADE_GOODS, TileType, type ArmyOrder, type BuildingInfo } from "@colony/shared/protocol";
import type { Colonist, Mob, Player, ResourceKey, SiteState, VassalState } from "./types.js";
import {
  GAME_DAY_TICKS, LEVY_COOLDOWN_TICKS, LEVY_DEATH_RELATION, LEVY_DURATION_TICKS, LEVY_KIND, LEVY_MAX_TILES, LEVY_MIN,
  LEVY_RETURN_TIMEOUT_TICKS, LEVY_SHARE, LEVY_WIPE_RELATION, POWER_CACHE_TICKS, POWER_PER_TOWER_LEVEL, POWER_PER_WALL,
  RELATION_ATTACK_PENALTY, RELATION_MAX, RELATION_VASSAL_KEEP, TAX_INTERVAL_DAYS, TAX_POWER_MIN, TAX_RELATION_COST,
  TAX_SHARE_BASE, TAX_SHARE_MAX, VASSAL_HIT_COOLDOWN_TICKS, WALL_TILES,
} from "./constants.js";
import { clans, colonists, mobs, sites, state } from "./state.js";
import { getBuildingLevel, ownerAt, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { clanById, clanIdAtIndex, withClan } from "./clans.js";
import { broadcastEvent } from "./net.js";
import { adjustRelation, relationOf } from "./sites.js";
import { gameDay, standingTown } from "./diplomacy.js";
import { spawnColonistForPost } from "./colonists.js";
import { followTargetPos, leaveOrderGroup, rallyUnit, startGroupOrder } from "./orders.js";
import { isGuardOrMilitiaKind, unitStats } from "./units.js";
import { isTowerTile, releaseSlot } from "./combat.js";
import { spawnGuardian } from "./worldgen.js";
import { releaseResourceReservation } from "./economy.js";

const WALLISH = new Set<number>([...WALL_TILES, TileType.Gate]);
const days = (ticks: number) => `${(Math.max(0, ticks) / GAME_DAY_TICKS).toFixed(1)} days`;

function vstate(s: SiteState): VassalState {
  s.vassal ??= { tax: false, nextTaxDay: 0, taxGoldTotal: 0, levyIds: [], levyUntilTick: 0, levyCooldownUntilTick: 0, levyCalled: 0 };
  return s.vassal;
}

const isLevy = (c: Colonist | undefined): c is Colonist => !!c?.levyOf;

// ---- Power ----

let powerCacheTick = -Infinity;
const powerCache = new Map<number, number>();

export function clanPower(clanId: number): number {
  if (state.cycleTick - powerCacheTick >= POWER_CACHE_TICKS || state.cycleTick < powerCacheTick) {
    powerCache.clear();
    powerCacheTick = state.cycleTick;
    const add = (clan: number, v: number) => powerCache.set(clan, (powerCache.get(clan) ?? 0) + v);
    for (const c of colonists.values()) {
      if (c.hp <= 0 || c.levyOf || c.kind === "wagon" || !isGuardOrMilitiaKind(c.kind)) continue;
      add(c.clan ?? 0, c.hp * unitStats(c).damage);
    }
    const W = state.WORLD_TILES_X;
    for (let i = 0; i < state.tiles.length; i++) {
      const t = state.tiles[i] as TileType;
      const tower = isTowerTile(t);
      if (!tower && !WALLISH.has(t)) continue;
      if (ownerAt(i) !== 0) continue;
      add(clanIdAtIndex(i), tower ? POWER_PER_TOWER_LEVEL * Math.max(1, getBuildingLevel(i % W, Math.floor(i / W))) : POWER_PER_WALL);
    }
  }
  return Math.round(powerCache.get(clanId) ?? 0);
}

export function sitePower(s: SiteState): number {
  let p = 0;
  for (const id of s.garrison) {
    const m = mobs.get(id);
    if (m && m.hp > 0) p += m.hp * m.damage;
  }
  for (let y = s.y0; y <= s.y1; y++) {
    for (let x = s.x0; x <= s.x1; x++) {
      const i = tileIndex(x, y);
      if (ownerAt(i) !== s.num) continue;
      const t = state.tiles[i] as TileType;
      if (isTowerTile(t)) p += POWER_PER_TOWER_LEVEL;
      else if (WALLISH.has(t)) p += POWER_PER_WALL;
    }
  }
  return Math.round(p);
}

export function powerRatio(clanId: number, s: SiteState): number {
  return clanPower(clanId) / Math.max(1, sitePower(s));
}

export const taxShare = (ratio: number) => Math.min(TAX_SHARE_MAX, TAX_SHARE_BASE * ratio);
export const taxRelationCost = (share: number) => Math.round(TAX_RELATION_COST * Math.sqrt(share / TAX_SHARE_MAX) * 10) / 10;

// ---- Becoming one / breaking free ----

// Relation reached RELATION_MAX (diplomacy.ts onRelationChanged, or the dawn re-check): the settlement swears
// fealty to clanId unless it already serves another clan, is up in arms, or outmatches the clan's army.
export function tryVassalise(clanId: number, s: SiteState): boolean {
  if (!standingTown(s) || s.provoked || (s.vassalOf != null && s.vassalOf !== clanId)) return false;
  if (s.vassalOf === clanId) return true;
  const v = vstate(s);
  const pc = clanPower(clanId);
  const pv = sitePower(s);
  if (pc < pv) {
    if (v.refusedDay !== gameDay()) {
      v.refusedDay = gameDay();
      withClan(clanById(clanId), () => broadcastEvent("build", `${s.name} would swear fealty, but your army is weaker than its garrison (power ${pc} vs ${pv})`));
    }
    return false;
  }
  s.vassalOf = clanId;
  Object.assign(v, { tax: false, nextTaxDay: gameDay() + 1, levyIds: [], levyUntilTick: 0, levyReturnByTick: undefined });
  state.relationsVersion++;
  state.ownerVersion++;
  withClan(clanById(clanId), () => broadcastEvent("milestone", `${s.name} swears fealty: it is now your vassal! Open its panel to call its troops to arms or demand tribute`));
  return true;
}

// Relation fell below RELATION_VASSAL_KEEP, the vassal grew stronger than its liege, or it fell: vassalage
// ends, tribute stops and any levy on the field marches home at once.
export function endVassalage(s: SiteState, why: string) {
  const clanId = s.vassalOf;
  if (clanId == null) return;
  s.vassalOf = null;
  const v = vstate(s);
  v.tax = false;
  sendLevyHome(s);
  state.relationsVersion++;
  state.ownerVersion++;
  withClan(clanById(clanId), () => broadcastEvent("raid", `${s.name} breaks free: ${why}. It is no longer your vassal`));
}

// sites.ts noteSettlementAttacked: the liege hit its own vassal. It does not take up arms (vassals never fight
// their liege) but the relation drops RELATION_ATTACK_PENALTY at most every VASSAL_HIT_COOLDOWN_TICKS.
export function noteLiegeHit(s: SiteState, clanId: number, attackerKey?: string) {
  const v = vstate(s);
  v.lastHitBy = attackerKey ?? "";
  if (v.lastHitTick !== undefined && state.cycleTick - v.lastHitTick < VASSAL_HIT_COOLDOWN_TICKS) return;
  v.lastHitTick = state.cycleTick;
  withClan(clanById(clanId), () => broadcastEvent("raid", `You struck your own vassal ${s.name}!`));
  adjustRelation(clanId, s.id, -RELATION_ATTACK_PENALTY);
}

// ---- Tribute ----

function tributeQuote(s: SiteState, share: number): { gold: number; goods: Partial<Record<ResourceKey, number>> } {
  const goods: Partial<Record<ResourceKey, number>> = {};
  for (const g of TRADE_GOODS) {
    const n = Math.floor((s.stock[g] ?? 0) * share);
    if (n > 0) goods[g] = n;
  }
  return { gold: Math.floor((s.stock.gold ?? 0) * share), goods };
}

const describe = (q: { gold: number; goods: Partial<Record<ResourceKey, number>> }) =>
  [`${q.gold} gold`, ...Object.entries(q.goods).map(([k, n]) => `${n} ${k}`)].join(", ");

function collectTribute(s: SiteState, clanId: number, ratio: number) {
  const v = vstate(s);
  const share = taxShare(ratio);
  const q = tributeQuote(s, share);
  for (const [k, n] of Object.entries(q.goods)) s.stock[k as ResourceKey] = (s.stock[k as ResourceKey] ?? 0) - (n ?? 0);
  s.stock.gold = (s.stock.gold ?? 0) - q.gold;
  const cost = taxRelationCost(share);
  withClan(clanById(clanId), () => {
    for (const [k, n] of Object.entries(q.goods)) state.stock[k as ResourceKey] = (state.stock[k as ResourceKey] ?? 0) + (n ?? 0);
    state.stock.gold = (state.stock.gold ?? 0) + q.gold;
    broadcastEvent("build", `Tribute from ${s.name}: ${describe(q)} (relation -${cost})`);
  });
  v.lastTax = { day: gameDay(), gold: q.gold, goods: q.goods, relation: cost };
  v.taxGoldTotal += q.gold;
  v.nextTaxDay = gameDay() + TAX_INTERVAL_DAYS;
  adjustRelation(clanId, s.id, -cost);
}

// sim.ts at dawn, after settlementsDawn (so tribute comes out of the fresh production): vassalise any settlement
// at RELATION_MAX, end vassalage of fallen / stronger vassals, collect due tribute.
export function vassalsDawn() {
  const day = gameDay();
  for (const s of sites.values()) {
    if (s.faction !== "human") continue;
    if (s.cleared || s.captured) {
      if (s.vassalOf != null) endVassalage(s, "it has fallen");
      continue;
    }
    if (s.vassalOf == null) {
      for (const clan of clans) if (relationOf(clan.id, s.id) >= RELATION_MAX && tryVassalise(clan.id, s)) break;
      continue;
    }
    const clanId = s.vassalOf;
    const ratio = powerRatio(clanId, s);
    if (ratio < 1) {
      endVassalage(s, `its garrison now outmatches your army (power ${sitePower(s)} vs ${clanPower(clanId)})`);
      continue;
    }
    const v = vstate(s);
    if (!v.tax || day < v.nextTaxDay) continue;
    if (ratio < TAX_POWER_MIN) {
      v.nextTaxDay = day + 1;
      withClan(clanById(clanId), () => broadcastEvent("raid", `${s.name} refuses tribute: your army is too small (power ${clanPower(clanId)} vs ${sitePower(s)}, need ${TAX_POWER_MIN}x)`));
      continue;
    }
    collectTribute(s, clanId, ratio);
  }
}

// Runs in the sender's clan context (index.ts).
export function handleSetTax(s: SiteState | undefined, on: unknown): string {
  const clanId = state.clan.id;
  if (!s || s.vassalOf !== clanId) return "Not your vassal";
  const v = vstate(s);
  if (on === true) {
    const ratio = powerRatio(clanId, s);
    if (ratio < TAX_POWER_MIN) return `Your army is too weak to demand tribute (power ${clanPower(clanId)} vs ${sitePower(s)}, need ${TAX_POWER_MIN}x)`;
    v.tax = true;
    v.nextTaxDay = Math.max(v.nextTaxDay, gameDay() + 1);
    broadcastEvent("build", `You demand tribute from ${s.name}: about ${describe(tributeQuote(s, taxShare(ratio)))} every ${TAX_INTERVAL_DAYS} days`);
  } else {
    v.tax = false;
    broadcastEvent("build", `You no longer demand tribute from ${s.name}`);
  }
  return "";
}

// ---- Call to arms ----

// Living guards, kinds interleaved (guard, archer, knight, guard, ...) so a levy is a cross-section.
function levyCandidates(s: SiteState): Mob[] {
  const rank = new Map<string, number>();
  const out: { m: Mob; r: number }[] = [];
  for (const id of s.garrison) {
    const m = mobs.get(id);
    if (!m || m.hp <= 0 || !LEVY_KIND[m.kind]) continue;
    const r = rank.get(m.kind) ?? 0;
    rank.set(m.kind, r + 1);
    out.push({ m, r });
  }
  return out.sort((a, b) => a.r - b.r).map((e) => e.m);
}

export function levySize(s: SiteState): number {
  const n = levyCandidates(s).length;
  return Math.min(n, Math.max(LEVY_MIN, Math.ceil(n * LEVY_SHARE)));
}

// The garrison mob becomes a colonist of the clan (matching kind, no population, no respawn, no armoury gear).
function spawnLevy(s: SiteState, m: Mob, clanId: number): Colonist {
  const toastTick = state.lastUnequippedToastTick;
  state.lastUnequippedToastTick = state.cycleTick;
  const c = withClan(clanById(clanId), () => {
    const u = spawnColonistForPost(s.keepX, s.keepY, LEVY_KIND[m.kind]!, 1);
    // Levies bring their own arms: give back anything the spawn took from the clan's armoury.
    if ((u.armourTier ?? 0) > 0) state.equipment.armour[u.armourTier! - 1]++;
    if ((u.weaponTier ?? 0) > 0) state.equipment.weapon[u.weaponTier! - 1]++;
    return u;
  });
  state.lastUnequippedToastTick = toastTick;
  Object.assign(c, { x: m.x, y: m.y, armourTier: 0, weaponTier: 0, settlementId: "", levyOf: s.id, levyKind: m.kind, stance: "aggressive" });
  if (clanId) c.clan = clanId;
  else delete c.clan;
  return c;
}

function clampToLeash(s: SiteState, x: number, y: number, maxTiles: number): { x: number; y: number } {
  const k = tileToPixelCenter({ x: s.keepX, y: s.keepY });
  const d = Math.hypot(x - k.x, y - k.y);
  const max = maxTiles * TILE_SIZE;
  return d <= max ? { x, y } : { x: k.x + ((x - k.x) / d) * max, y: k.y + ((y - k.y) / d) * max };
}

function callProblem(s: SiteState, clanId: number): string {
  if (s.vassalOf !== clanId) return "Not your vassal";
  const v = vstate(s);
  if (v.levyIds.length > 0) return v.levyReturnByTick ? "The levy is marching home" : "The levy is already on the field";
  if (state.cycleTick < v.levyCooldownUntilTick) return `Called too recently: ready in ${days(v.levyCooldownUntilTick - state.cycleTick)}`;
  if (s.provoked) return "Up in arms: they will not march";
  if (levyCandidates(s).length === 0) return "No guards to spare";
  return "";
}

// Runs in the sender's clan context (index.ts). Returns "" or the refusal.
export function handleCallToArms(player: Player | undefined, s: SiteState | undefined, msg: { followId?: unknown; x?: unknown; y?: unknown; dismiss?: unknown }): string {
  const clanId = state.clan.id;
  if (!s) return "Not your vassal";
  const v = vstate(s);
  if (msg.dismiss === true) {
    if (s.vassalOf !== clanId || v.levyIds.length === 0 || v.levyReturnByTick) return "No levy on the field";
    sendLevyHome(s);
    broadcastEvent("build", `You dismiss the ${s.name} levy: it marches home`);
    return "";
  }
  const problem = callProblem(s, clanId);
  if (problem) return problem;
  const picked = levyCandidates(s).slice(0, levySize(s));
  const units: Colonist[] = [];
  for (const m of picked) {
    units.push(spawnLevy(s, m, clanId));
    mobs.delete(m.id);
    releaseSlot(m.id);
  }
  const gone = new Set(picked.map((m) => m.id));
  s.garrison = s.garrison.filter((id) => !gone.has(id));
  Object.assign(v, {
    levyIds: units.map((c) => c.id), levyUntilTick: state.cycleTick + LEVY_DURATION_TICKS,
    levyCooldownUntilTick: state.cycleTick + LEVY_COOLDOWN_TICKS, levyCalled: units.length, levyLost: 0, levyReturnByTick: undefined,
  });
  const follow = typeof msg.followId === "string" && msg.followId.length <= 80 ? msg.followId : null;
  const followOk = (id: string) => {
    if (!followTargetPos(id)) return false;
    if (id.startsWith("p:")) return true;
    const t = colonists.get(id);
    return !!t && (t.clan ?? 0) === clanId && !isLevy(t);
  };
  let order: ArmyOrder;
  if (follow && followOk(follow)) order = { kind: "follow", targetId: follow };
  else if (typeof msg.x === "number" && typeof msg.y === "number" && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
    const p = clampToLeash(s, msg.x, msg.y, LEVY_MAX_TILES - 2);
    order = { kind: "attackMove", x: p.x, y: p.y };
  } else if (player && !player.dead) order = { kind: "follow", targetId: `p:${player.id}` };
  else {
    const k = tileToPixelCenter({ x: s.homeX, y: s.homeY });
    order = { kind: "hold", x: k.x, y: k.y };
  }
  startGroupOrder(units, order);
  broadcastEvent("milestone", `${s.name} answers your call to arms: ${units.length} levies march out for ${days(LEVY_DURATION_TICKS)} (never beyond ${LEVY_MAX_TILES} tiles of their walls)`);
  return "";
}

// Duration up, dismissed or vassalage ended: the levy takes no more orders and walks back to the yard.
function sendLevyHome(s: SiteState) {
  const v = vstate(s);
  if (v.levyIds.length === 0 || v.levyReturnByTick) return;
  v.levyReturnByTick = state.cycleTick + LEVY_RETURN_TIMEOUT_TICKS;
  const home = tileToPixelCenter({ x: s.homeX, y: s.homeY });
  for (const id of v.levyIds) {
    const c = colonists.get(id);
    if (!c) continue;
    leaveOrderGroup(id);
    c.levyHome = true;
    rallyUnit(c, home.x, home.y, null);
  }
}

// Back at the yard (or out of time): the colonist turns back into a garrison mob.
function retireLevy(s: SiteState | undefined, c: Colonist) {
  leaveOrderGroup(c.id);
  releaseResourceReservation(c);
  releaseSlot(c.id);
  colonists.delete(c.id);
  if (s && standingTown(s) && c.levyKind) s.garrison.push(spawnGuardian(c.levyKind, { x: s.homeX, y: s.homeY }, s.id, "fort").id);
}

// combat.ts damageColonist: a levy fell (no respawn; the garrison regrows on its own).
export function noteLevyDied(c: Colonist) {
  const s = c.levyOf ? sites.get(c.levyOf) : undefined;
  if (!s?.vassal) return;
  const v = s.vassal;
  const before = v.levyIds.length;
  v.levyIds = v.levyIds.filter((id) => id !== c.id);
  if (v.levyIds.length === before) return;
  const clanId = c.clan ?? 0;
  v.levyLost = (v.levyLost ?? 0) + 1;
  adjustRelation(clanId, s.id, -LEVY_DEATH_RELATION);
  if (v.levyIds.length === 0) {
    v.levyReturnByTick = undefined;
    withClan(clanById(clanId), () => broadcastEvent("raid", `Every levy of ${s.name} has fallen: "You bled us dry" (relation -${LEVY_WIPE_RELATION})`));
    adjustRelation(clanId, s.id, -LEVY_WIPE_RELATION);
  }
}

// sim.ts, once a second: levies past their day go home, strays are pulled back inside the leash, those home
// rejoin the garrison.
export function updateVassals() {
  for (const s of sites.values()) {
    const v = s.vassal;
    if (!v || v.levyIds.length === 0) continue;
    const alive = v.levyIds.filter((id) => colonists.has(id));
    v.levyIds = alive;
    if (alive.length === 0) {
      v.levyReturnByTick = undefined;
      continue;
    }
    const home = tileToPixelCenter({ x: s.homeX, y: s.homeY });
    const keep = tileToPixelCenter({ x: s.keepX, y: s.keepY });
    if (!standingTown(s)) {
      for (const id of alive) retireLevy(undefined, colonists.get(id)!);
      v.levyIds = [];
      continue;
    }
    if (!v.levyReturnByTick && (state.cycleTick >= v.levyUntilTick || s.vassalOf == null)) {
      sendLevyHome(s);
      if (s.vassalOf != null) withClan(clanById(s.vassalOf), () => broadcastEvent("build", `The ${s.name} levy's service is over: it marches home`));
    }
    const late = v.levyReturnByTick !== undefined && state.cycleTick >= v.levyReturnByTick;
    for (const id of alive) {
      const c = colonists.get(id)!;
      if (c.levyHome) {
        if (late || Math.hypot(c.x - home.x, c.y - home.y) <= 2 * TILE_SIZE) retireLevy(s, c);
        continue;
      }
      // Checked once a second, so the pull-back starts 5 tiles inside the hard limit.
      if (Math.hypot(c.x - keep.x, c.y - keep.y) <= (LEVY_MAX_TILES - 5) * TILE_SIZE) continue;
      leaveOrderGroup(c.id);
      const p = clampToLeash(s, c.x, c.y, LEVY_MAX_TILES - 10);
      rallyUnit(c, p.x, p.y, null);
      if (s.vassalOf != null && (v.leashToastTick === undefined || state.cycleTick - v.leashToastTick > 30 * 20)) {
        v.leashToastTick = state.cycleTick;
        withClan(clanById(s.vassalOf), () => broadcastEvent("build", `The ${s.name} levy will not march beyond ${LEVY_MAX_TILES} tiles of its walls`));
      }
    }
    v.levyIds = v.levyIds.filter((id) => colonists.has(id));
    if (v.levyIds.length === 0) {
      v.levyReturnByTick = undefined;
      if (s.vassalOf != null) withClan(clanById(s.vassalOf), () => broadcastEvent("build", `The ${s.name} levy is home`));
    }
  }
}

// ---- Panel / snapshot ----

export function vassalInfoFor(s: SiteState, player?: Player): BuildingInfo["vassal"] | undefined {
  const clanId = player?.clan ?? 0;
  if (!standingTown(s) || s.vassalOf !== clanId) return undefined;
  const v = vstate(s);
  const pc = clanPower(clanId);
  const pv = sitePower(s);
  const ratio = pc / Math.max(1, pv);
  const canTax = ratio >= TAX_POWER_MIN;
  const share = taxShare(ratio);
  const lt = v.lastTax;
  const callReason = callProblem(s, clanId);
  const day = gameDay();
  const returning = v.levyReturnByTick !== undefined;
  return {
    siteName: s.name, clanPower: pc, sitePower: pv, tax: v.tax, canTax,
    taxReason: canTax ? "" : `Your army is too weak (power ${pc} vs ${pv}, need ${TAX_POWER_MIN}x)`,
    estimate: canTax ? `${describe(tributeQuote(s, share))} (${Math.round(share * 100)}% of their stock), relation -${taxRelationCost(share)}` : "none",
    lastTax: lt ? `day ${lt.day + 1}: ${describe(lt)} (relation -${lt.relation})` : "never",
    nextTax: !v.tax ? "off" : v.nextTaxDay <= day ? "next dawn" : `in ${v.nextTaxDay - day} dawn${v.nextTaxDay - day === 1 ? "" : "s"} (day ${v.nextTaxDay + 1})`,
    taxGoldTotal: v.taxGoldTotal,
    levyOnField: v.levyIds.length, levyReturning: returning,
    levyStatus: v.levyIds.length === 0
      ? state.cycleTick < v.levyCooldownUntilTick ? `Ready again in ${days(v.levyCooldownUntilTick - state.cycleTick)}` : "Ready"
      : `${returning ? `${v.levyIds.length} marching home` : `${v.levyIds.length} on the field, ${days(v.levyUntilTick - state.cycleTick)} left`}${v.levyLost ? `, ${v.levyLost} fell` : ""}`,
    levySize: levySize(s), canCall: callReason === "", callReason,
  };
}

// The vassal regiment name for army cards (units.ts armyRegimentsNow).
export function levyRegimentName(c: Colonist): string {
  return `${sites.get(c.levyOf ?? "")?.name ?? "Vassal"} Levy`;
}

export function vassalDebugState(s: SiteState, clanId: number) {
  return {
    vassalOf: s.vassalOf ?? null, vassal: s.vassal ? { ...s.vassal } : null, clanPower: clanPower(clanId), sitePower: sitePower(s),
    garrison: s.garrison.length, levySize: levySize(s),
    levies: (s.vassal?.levyIds ?? []).map((id) => colonists.get(id)).filter(isLevy)
      .map((c) => ({ id: c.id, kind: c.kind, levyKind: c.levyKind, x: c.x, y: c.y, hp: c.hp, clan: c.clan ?? 0, home: !!c.levyHome, tile: tileOfPixel(c.x, c.y) })),
  };
}
