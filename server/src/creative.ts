// creative.ts: Creative mode (QUEUE.md "CREATIVE MODE (test environment)" + addenda). A world flag set at new-game
// time (restart {creative: true}); while it is on: infinite stock (topUpCreative after every tick / message, and
// canAfford / spend in construction.ts), instant build (state.instantBuild), no population / garrison caps
// (colonists.ts settlementStatsAll), and the creative panel's commands (creativeSpawn / creativeSet, refused in
// normal games). Also home of the spawn / stamp helpers the COLONY_TEST_HOOKS handlers share (testhooks.ts).
import { randomUUID } from "node:crypto";
import {
  type ColonistKind, type HeroClass, HERO_CLASSES, HungerMark, type MobKind, type Stance, TILE_SIZE, TileType,
  type WildlifeKind, WILDLIFE_KINDS, TICK_RATE,
} from "@colony/shared/protocol";
import type { Colonist, Mob, Player, RaidFactionId, RaidGroup, SiteState, SiteTemplateId, TileCoord } from "./types.js";
import {
  DAY_TICKS, GAME_DAY_TICKS, MOB_KIND_CONFIG, NIGHT_TICKS, PLAYER_ATTACK_RANGE, RAID_FACTIONS, SITE_TEMPLATES,
  STANCES, STANCE_ALERT_RANGE_TILES, LINE_LEASH_TILES,
} from "./constants.js";
import {
  buildingLevel, clans, colonists, makeClan, mobs, players, raidGroups, sites, state, tradingPosts, wildlife,
  type Clan,
} from "./state.js";
import { inBounds, isNightNow, resourceKey, tileIndex, tileOfPixel, tileToPixelCenter } from "./tiles.js";
import { findAdjacentWalkable, isWalkableTile } from "./pathfinding.js";
import { releaseResourceReservation } from "./economy.js";
import { settlementKeyNear, spawnColonistForPost, townCenterMaxHp } from "./colonists.js";
import { isGuardOrMilitiaKind, pickGuardTarget, unitStats } from "./units.js";
import { approachGoal, damageColonist, damageMob, releaseSlot } from "./combat.js";
import { applyHungerMark } from "./mobs.js";
import { makeBoss, spawnGuardian } from "./worldgen.js";
import { createRaidMob, spawnRaid } from "./raids.js";
import { damageWildlife, spawnWildlifeAt } from "./wildlife.js";
import { adjustRelation, relationOf, siteFitProblem, stampSiteTemplate, templateSize } from "./sites.js";
import { forcePostQuest } from "./quests.js";
import { endVassalage } from "./vassals.js";
import { refreshTradingPost, scanTradingPosts } from "./wagons.js";
import { broadcastTileUpdate } from "./net.js";
import { pickHeroName, playerMaxHp, spawnHeroColonist, weaponDamageMult } from "./heroes.js";
import { clanById, withClan } from "./clans.js";

export const CREATIVE_STOCK = 999999;
export const CREATIVE_EQUIPMENT = 9999;
export const CREATIVE_CAP = 9999;
export const CREATIVE_MAX_COUNT = 1000;
export const TEST_CLAN_NAME = "Test clan";

// ---- Infinite resources ----

// Every clan's stock and armoury back to CREATIVE_STOCK / CREATIVE_EQUIPMENT (after every tick and message).
export function topUpCreative() {
  for (const c of clans) {
    for (const k of Object.keys(c.stock) as (keyof Clan["stock"])[]) c.stock[k] = CREATIVE_STOCK;
    c.equipment.armour = [CREATIVE_EQUIPMENT, CREATIVE_EQUIPMENT, CREATIVE_EQUIPMENT];
    c.equipment.weapon = [CREATIVE_EQUIPMENT, CREATIVE_EQUIPMENT, CREATIVE_EQUIPMENT];
  }
}

// ---- Shared spawn / stamp helpers (creative panel + test hooks) ----

// A soldier (any guard / militia kind, or a hero of heroClass) standing at pixel (x, y), its rally slot there
// (post = that tile, no building), of clan `clanId`. null when the kind or the tile is no good.
export function spawnSoldierAt(
  kind: ColonistKind, x: number, y: number, clanId: number,
  opts: { stance?: unknown; level?: number; gear?: number; heroClass?: HeroClass } = {},
): Colonist | null {
  const tile = tileOfPixel(x, y);
  if (!isGuardOrMilitiaKind(kind) || !inBounds(tile.x, tile.y) || !isWalkableTile(tile.x, tile.y)) return null;
  const c = withClan(clanById(clanId), () =>
    kind === "hero"
      ? spawnHeroColonist(randomUUID(), pickHeroName(), opts.heroClass ?? "champion", tile.x, tile.y)
      : spawnColonistForPost(tile.x, tile.y, kind, Math.max(1, Math.min(3, Math.round(Number(opts.level) || 1)))),
  );
  Object.assign(c, { x, y, rallyTileX: tile.x, rallyTileY: tile.y, rallyX: x, rallyY: y });
  if (clanId) Object.assign(c, { clan: clanId, settlementId: settlementKeyNear(tile.x, tile.y, clanId) });
  if (typeof opts.stance === "string" && STANCES.includes(opts.stance as Stance)) c.stance = opts.stance as Stance;
  const gear = Math.max(0, Math.min(3, Math.round(Number(opts.gear) || 0)));
  if (gear > 0 && kind !== "hero") {
    c.armourTier = gear;
    c.weaponTier = gear;
  }
  return c;
}

// An already-released (non-raid) mob at a tile, optionally Hunger-marked, a boss tier, in a regiment or an
// awake guardian of siteId. null for an unknown kind / tile.
export function spawnMobAt(
  kind: string, tx: number, ty: number,
  opts: { mark?: unknown; boss?: unknown; regimentId?: unknown; siteId?: unknown } = {},
): Mob | null {
  if (!(kind in MOB_KIND_CONFIG) || !inBounds(tx, ty)) return null;
  const isBoss = opts.boss === "warlord" || opts.boss === "elite";
  const mob = createRaidMob(kind as MobKind, { x: tx, y: ty }, "", !isBoss);
  mob.groupId = null;
  mob.passive = false;
  if (typeof opts.mark === "number" && opts.mark >= HungerMark.Gorrath && opts.mark <= HungerMark.Vhorrun) applyHungerMark(mob, opts.mark);
  if (typeof opts.regimentId === "string") mob.regimentId = opts.regimentId;
  if (typeof opts.siteId === "string") Object.assign(mob, { siteId: opts.siteId, siteKind: "encampment", guardianActive: true });
  if (opts.boss === "warlord" || opts.boss === "elite") makeBoss(mob, opts.boss);
  return mob;
}

// A raid group already in contact (engaged now). Member i stands at tiles[i] (default: a column down from
// (tx, ty)), on row rows[i] (default i), so the rows release one by one.
export function spawnRaidGroupAt(
  kinds: unknown[], tx: number, ty: number,
  opts: { faction?: RaidFactionId; tiles?: TileCoord[]; rows?: number[]; mark?: unknown } = {},
): RaidGroup {
  const id = randomUUID();
  const anchor = tileToPixelCenter({ x: tx, y: ty });
  const group: RaidGroup = {
    id, faction: opts.faction ?? "greenskinWarband", isHorde: false, edge: "west", memberIds: [], homes: new Map(), aggroTick: 0,
    state: "marching", leaderId: null, offsets: new Map(), repathCooldown: 0, headingX: 1, headingY: 0,
    engagedTick: state.cycleTick, anchorX: anchor.x, anchorY: anchor.y,
  };
  kinds.forEach((k, i) => {
    if (typeof k !== "string" || !(k in MOB_KIND_CONFIG)) return;
    const at = opts.tiles?.[i] ?? { x: tx, y: ty + i };
    const mob = createRaidMob(k as MobKind, at, id);
    mob.passive = false;
    if (typeof opts.mark === "number" && opts.mark >= HungerMark.Gorrath && opts.mark <= HungerMark.Vhorrun) applyHungerMark(mob, opts.mark);
    const p = tileToPixelCenter(at);
    group.memberIds.push(mob.id);
    group.offsets.set(mob.id, { x: p.x - anchor.x, y: p.y - anchor.y, row: opts.rows?.[i] ?? i });
  });
  group.leaderId = group.memberIds[0] ?? null;
  raidGroups.set(id, group);
  return group;
}

// A fort / settlement template stamped with its top-left at (x0, y0), else the nearest fitting top-left within
// `search` tiles (rings outward). Clears natural ground; refuses over buildings / other grounds.
export function stampSiteSearch(
  template: SiteTemplateId, x0: number, y0: number, search: number, opts: { tier?: number; name?: string } = {},
): { site: SiteState; problem: null } | { site: null; problem: string; x0: number; y0: number } {
  const t = SITE_TEMPLATES[template];
  let problem = siteFitProblem(t, x0, y0, true);
  for (let r = 1; problem && r <= Math.min(60, search); r++) {
    for (let dy = -r; dy <= r && problem; dy++) {
      for (let dx = -r; dx <= r && problem; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || siteFitProblem(t, x0 + dx, y0 + dy, true)) continue;
        x0 += dx;
        y0 += dy;
        problem = null;
      }
    }
  }
  if (problem) return { site: null, problem, x0, y0 };
  return { site: stampSiteTemplate(t.id, x0, y0, { ...opts, broadcast: true }), problem: null };
}

// A Trading Post at (tx, ty) (rule-free) at `level`, registered now and looked after once (roster + wagon).
export function placeTradingPost(tx: number, ty: number, level: number, auto?: unknown) {
  if (!inBounds(tx, ty)) return;
  state.tiles[tileIndex(tx, ty)] = TileType.GoldShop;
  broadcastTileUpdate(tx, ty, TileType.GoldShop);
  buildingLevel.set(resourceKey(tx, ty), level);
  scanTradingPosts();
  const post = tradingPosts.get(resourceKey(tx, ty));
  if (post && typeof auto === "boolean") post.auto = auto;
  refreshTradingPost(resourceKey(tx, ty));
}

// Makes `st` clan's vassal on the spot (no relation / power check); false ends its vassalage.
export function forceVassal(st: SiteState, clan: number, on: boolean) {
  if (on && st.vassalOf !== clan) {
    st.vassalOf = clan;
    st.vassal ??= { tax: false, nextTaxDay: 0, taxGoldTotal: 0, levyIds: [], levyUntilTick: 0, levyCooldownUntilTick: 0, levyCalled: 0 };
    state.relationsVersion++;
    state.ownerVersion++;
  } else if (!on && st.vassalOf != null) endVassalage(st, "creative");
}

// ---- Creative hostility (the first step toward clan-vs-clan combat) ----

// Two clans are hostile only in a creative game with "allow attacking neutral units" on.
export function clansHostile(a: number | undefined, b: number | undefined): boolean {
  return state.creative && state.creativeAllowAttack && (a ?? 0) !== (b ?? 0);
}

// A neutral creative mob that is standing down: soldiers / towers leave it alone until the toggle is on or it is hit.
export function isSleepingNeutral(m: Mob): boolean {
  return !!m.creativeNeutral && !m.creativeNeutral.awake && !state.creativeAllowAttack;
}

// damageMob: a hit wakes a non-dummy neutral (it fights back from now on).
export function wakeNeutral(m: Mob) {
  if (!m.creativeNeutral || m.creativeNeutral.dummy || m.creativeNeutral.awake) return;
  m.creativeNeutral.awake = true;
  m.passive = false;
}

// Per-tick spatial buckets of living colonists (CELL_TILES cells), for the hostile-colonist scans.
const CELL_TILES = 4;
let gridTick = -1;
const grid = new Map<number, Colonist[]>();
function cellKey(cx: number, cy: number) {
  return cy * 4096 + cx;
}
function colonistGrid() {
  if (gridTick === state.cycleTick) return grid;
  gridTick = state.cycleTick;
  grid.clear();
  const cell = CELL_TILES * TILE_SIZE;
  for (const c of colonists.values()) {
    if (c.hp <= 0) continue;
    const k = cellKey(Math.floor(c.x / cell), Math.floor(c.y / cell));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(c);
  }
  return grid;
}
function nearestHostileColonist(x: number, y: number, clan: number | undefined, radius: number, except?: string): Colonist | null {
  const cell = CELL_TILES * TILE_SIZE;
  const g = colonistGrid();
  const r = Math.ceil(radius / cell);
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  let best: Colonist | null = null;
  let bestD = radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const o of g.get(cellKey(cx + dx, cy + dy)) ?? []) {
        if (o.id === except || o.hp <= 0 || !clansHostile(clan, o.clan)) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
    }
  }
  return best;
}

function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// units.ts updateGuardColonist, first thing in a creative game: dummies stand; a forced target (force-attack) or,
// with the toggle on and no mob to fight, the nearest hostile-clan unit is fought here. true = handled this tick.
export function creativeFightStep(c: Colonist, dt: number): boolean {
  if (c.creativeDummy) {
    c.state = "idle";
    return true;
  }
  const stats = unitStats(c);
  let t = c.creativeTarget;
  let target: { x: number; y: number; hp: number } | undefined =
    t?.type === "c" ? colonists.get(t.id) : t?.type === "w" ? wildlife.get(Number(t.id)) : undefined;
  if (t && (!target || target.hp <= 0 || (!t.forced && (c.targetMobId !== null || !clansHostile(c.clan, (target as Colonist).clan))))) {
    c.creativeTarget = undefined;
    c.path = [];
    t = undefined;
    target = undefined;
  }
  if (!t) {
    if (c.targetMobId !== null || !state.creativeAllowAttack || stats.speed < 0) return false;
    // Scans are spread over 10 ticks (big battles).
    if ((state.cycleTick + hash01(c.id)) % 10 !== 0) return false;
    const alertPx = Math.max(STANCE_ALERT_RANGE_TILES[c.stance] * TILE_SIZE, stats.range);
    const found = nearestHostileColonist(c.x, c.y, c.clan, alertPx, c.id);
    if (!found) return false;
    t = c.creativeTarget = { type: "c", id: found.id, forced: false };
    target = found;
  } else if (!t.forced && state.cycleTick % TICK_RATE === 0 && pickGuardTarget(c, stats)) {
    // A monster turned up: monsters first.
    c.creativeTarget = undefined;
    return false;
  }
  const goal = target!;
  const dist = Math.hypot(goal.x - c.x, goal.y - c.y);
  if (!t.forced && Math.hypot(c.x - c.rallyX, c.y - c.rallyY) > LINE_LEASH_TILES[c.stance] * TILE_SIZE + stats.range + TILE_SIZE) {
    c.creativeTarget = undefined;
    return false;
  }
  if (dist <= stats.range + TILE_SIZE * 0.3) {
    c.state = "attacking";
    c.path = [];
    if (c.attackCooldownTicks > 0) {
      c.attackCooldownTicks--;
      return true;
    }
    const damage = stats.damage * weaponDamageMult(c);
    c.attackCooldownTicks = stats.cooldown;
    state.pendingEffects.push({ fromX: c.x, fromY: c.y, toX: goal.x, toY: goal.y, melee: stats.melee });
    if (t.type === "c") damageColonist(goal as Colonist, damage);
    else damageWildlife(goal as unknown as Parameters<typeof damageWildlife>[0], damage, c.x, c.y, null);
    return true;
  }
  if (stats.speed <= 0) {
    c.state = "idle";
    return true;
  }
  c.state = "engaging";
  approachGoal(c, goal, goal, stats.speed, dt);
  return true;
}

// combat.ts handlePlayerAttack: with the toggle on, a hostile-clan unit nearer than `within` (and in reach).
export function hostileColonistInReach(p: Player, within: number): Colonist | null {
  if (!state.creative || !state.creativeAllowAttack) return null;
  const found = nearestHostileColonist(p.x, p.y, p.clan, PLAYER_ATTACK_RANGE);
  return found && Math.hypot(found.x - p.x, found.y - p.y) < within ? found : null;
}

// ---- The creative panel's commands ----

function testClan(): Clan {
  let clan = clans.find((c) => c.name === TEST_CLAN_NAME);
  if (!clan) {
    clan = makeClan(clans.length, TEST_CLAN_NAME, 0x8a8f99, Math.floor(state.cycleTick / GAME_DAY_TICKS));
    clans.push(clan);
    state.clanTilesVersion++;
    state.relationsVersion++;
    if (state.creative) topUpCreative();
  }
  return clan;
}

export type CreativeFormation = "none" | "line" | "block" | "column";
// n points (px) centred on (cx, cy): a line (up to 50 wide, ranks behind), a square block, a 4-wide column,
// or a loose cluster; each on a walkable tile (snapped to the nearest one).
export function formationPoints(n: number, cx: number, cy: number, formation: CreativeFormation): { x: number; y: number }[] {
  const cols = formation === "line" ? Math.min(n, 50) : formation === "column" ? Math.min(n, 4) : Math.ceil(Math.sqrt(n));
  const gap = formation === "none" ? TILE_SIZE * 1.3 : TILE_SIZE * 0.85;
  const rows = Math.ceil(n / cols);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx = formation === "none" ? (Math.random() - 0.5) * TILE_SIZE * 0.6 : 0;
    const jy = formation === "none" ? (Math.random() - 0.5) * TILE_SIZE * 0.6 : 0;
    let x = cx + (col - (cols - 1) / 2) * gap + jx;
    let y = cy + (row - (rows - 1) / 2) * gap + jy;
    x = Math.max(TILE_SIZE / 2, Math.min(state.WORLD_TILES_X * TILE_SIZE - TILE_SIZE / 2, x));
    y = Math.max(TILE_SIZE / 2, Math.min(state.WORLD_TILES_Y * TILE_SIZE - TILE_SIZE / 2, y));
    const tile = tileOfPixel(x, y);
    if (!isWalkableTile(tile.x, tile.y)) {
      const near = findAdjacentWalkable(tile.x, tile.y);
      if (!near) continue;
      ({ x, y } = tileToPixelCenter(near));
    }
    out.push({ x, y });
  }
  return out;
}

function nearestSite(x: number, y: number, human: boolean): SiteState | undefined {
  let best: SiteState | undefined;
  let bestD = Infinity;
  for (const s of sites.values()) {
    if (human && s.faction !== "human") continue;
    const d = Math.hypot(s.keepX - x / TILE_SIZE, s.keepY - y / TILE_SIZE);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// Weighted pick of a raid faction's kinds (core and extras), `n` of them.
function factionKinds(faction: RaidFactionId, n: number): MobKind[] {
  const entries = RAID_FACTIONS[faction];
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const out: MobKind[] = [];
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total;
    const e = entries.find((en) => (r -= en.weight) < 0) ?? entries[0];
    out.push(e.kind);
  }
  return out;
}

const WORKER_KINDS: ColonistKind[] = ["lumberjack", "farmer", "builder", "ironMiner", "rockMiner", "hunter", "forager", "artisan", "farmhand", "wagon"];
const NEUTRAL_FOLK: MobKind[] = ["townGuard", "townArcher", "townKnight", "townFarmer", "townMiner", "townPriest"];
const NEUTRAL_FIGHTERS = new Set<MobKind>(["townGuard", "townArcher", "townKnight"]);

type Reply = (ok: boolean, text: string, data?: Record<string, unknown>) => void;

// creativeSpawn {side, kind, count, x, y (px), formation?, level?, gear?, heroClass?, stance?, mark?, boss?,
// faction?, aggressive?}. side: own | enemy | army | guardians | neutral (Test clan units) | folk (neutral
// settlement folk) | wildlife.
export function handleCreativeSpawn(player: Player, msg: Record<string, unknown>, reply: Reply) {
  const count = Math.max(1, Math.min(CREATIVE_MAX_COUNT, Math.floor(Number(msg.count) || 1)));
  const x = Number(msg.x);
  const y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return reply(false, "Bad spawn point");
  const formation: CreativeFormation = ["line", "block", "column"].includes(msg.formation as string) ? (msg.formation as CreativeFormation) : "none";
  const kind = String(msg.kind ?? "");
  const side = msg.side;
  const ids: string[] = [];
  const points = formationPoints(count, x, y, formation);
  const heroClass = HERO_CLASSES.includes(msg.heroClass as HeroClass) ? (msg.heroClass as HeroClass) : undefined;
  if (side === "own" || side === "neutral") {
    const clanId = side === "own" ? player.clan : testClan().id;
    const worker = WORKER_KINDS.includes(kind as ColonistKind);
    for (const p of points) {
      let c: Colonist | null;
      if (worker) {
        const tile = tileOfPixel(p.x, p.y);
        c = withClan(clanById(clanId), () => spawnColonistForPost(tile.x, tile.y, kind as ColonistKind));
        Object.assign(c, { x: p.x, y: p.y, clan: clanId || undefined });
      } else {
        c = spawnSoldierAt(kind as ColonistKind, p.x, p.y, clanId, { level: Number(msg.level), gear: Number(msg.gear), heroClass, stance: msg.stance });
      }
      if (!c) continue;
      c.creativeSpawned = true;
      // Workers of the Test clan (and wagons) are always dummies; its soldiers only when not aggressive.
      if (side === "neutral" && (worker || msg.aggressive !== true)) c.creativeDummy = true;
      ids.push(c.id);
    }
  } else if (side === "enemy" || side === "folk") {
    if (side === "folk" && !NEUTRAL_FOLK.includes(kind as MobKind)) return reply(false, "Not a settlement folk kind");
    for (const p of points) {
      const t = tileOfPixel(p.x, p.y);
      const m = spawnMobAt(kind, t.x, t.y, { mark: msg.mark, boss: msg.boss });
      if (!m) continue;
      m.x = p.x;
      m.y = p.y;
      if (side === "folk") {
        m.passive = true;
        m.creativeNeutral = { dummy: msg.aggressive !== true || !NEUTRAL_FIGHTERS.has(kind as MobKind), awake: false };
        if (state.creativeAllowAttack) wakeNeutral(m);
      }
      ids.push(m.id);
    }
  } else if (side === "army") {
    const faction = (msg.faction as string) in RAID_FACTIONS ? (msg.faction as RaidFactionId) : "greenskinWarband";
    const kinds = kind && kind in MOB_KIND_CONFIG ? Array(count).fill(kind) : factionKinds(faction, count);
    const tiles = points.map((p) => tileOfPixel(p.x, p.y));
    const cols = formation === "line" ? Math.min(count, 50) : formation === "column" ? Math.min(count, 4) : Math.ceil(Math.sqrt(count));
    const t0 = tiles[0] ?? tileOfPixel(x, y);
    const g = spawnRaidGroupAt(kinds.slice(0, tiles.length), t0.x, t0.y, { faction, tiles, rows: tiles.map((_, i) => Math.floor(i / cols)), mark: msg.mark });
    ids.push(...g.memberIds);
  } else if (side === "guardians") {
    const s = nearestSite(x, y, false);
    if (!s) return reply(false, "No fort or settlement on the map: stamp one first");
    for (let i = 0; i < count; i++) {
      const spot = findAdjacentWalkable(s.keepX + ((i % 7) - 3), s.keepY + 1 + Math.floor(i / 7) % 5) ?? { x: s.keepX, y: s.keepY + 1 };
      if (!(kind in MOB_KIND_CONFIG)) return reply(false, "Unknown kind");
      const m = spawnGuardian(kind as MobKind, spot, s.id, "fort");
      s.garrison.push(m.id);
      ids.push(m.id);
    }
    s.garrisonMax = Math.max(s.garrisonMax, s.garrison.length);
    return reply(true, `${ids.length} ${kind} guarding ${s.name}`, { ids });
  } else if (side === "wildlife") {
    if (!WILDLIFE_KINDS.includes(kind as WildlifeKind)) return reply(false, "Unknown animal");
    for (const p of points) {
      const t = tileOfPixel(p.x, p.y);
      ids.push(String(spawnWildlifeAt(kind as WildlifeKind, t.x, t.y).id));
    }
  } else {
    return reply(false, "Unknown spawn side");
  }
  reply(ids.length > 0, ids.length > 0 ? `Spawned ${ids.length} ${kind || "units"}` : `Could not spawn ${kind} there`, { ids });
}

// A function (not a const): this module may evaluate before constants.js in the import cycle.
const timePhases = (): Record<string, number> => ({ dawn: 1, noon: Math.floor(DAY_TICKS / 2), dusk: DAY_TICKS - TICK_RATE * 5, night: DAY_TICKS + 1, midnight: DAY_TICKS + Math.floor(NIGHT_TICKS / 2) });

// creativeSet {op, ...}: allowAttack {on} | godmode {on} | heal | killMobs | clearNeutrals | clearWildlife |
// setTime {day?, phase?} | raid {day?} | stamp {template, x, y} | tradingPost {x, y, level?} |
// relation {x, y, value?, vassal?} | quest {x, y, kind} | forceAttack {unitIds, targetType: "c" | "w", targetId}.
export function handleCreativeSet(player: Player, msg: Record<string, unknown>, reply: Reply) {
  const op = msg.op;
  const x = Number(msg.x);
  const y = Number(msg.y);
  if (op === "allowAttack") {
    state.creativeAllowAttack = msg.on === true;
    for (const m of mobs.values()) {
      if (!m.creativeNeutral || m.creativeNeutral.dummy) continue;
      if (state.creativeAllowAttack) wakeNeutral(m);
      else Object.assign(m, { passive: true, targetType: null, targetId: null, path: [] }, { creativeNeutral: { dummy: false, awake: false } });
    }
    if (!state.creativeAllowAttack) for (const c of colonists.values()) if (c.creativeTarget && !c.creativeTarget.forced) c.creativeTarget = undefined;
    reply(true, `Attacking neutral units ${state.creativeAllowAttack ? "ALLOWED (clans hostile)" : "off"}`, { on: state.creativeAllowAttack });
  } else if (op === "godmode") {
    player.creativeGod = msg.on === true;
    if (player.creativeGod) player.hp = playerMaxHp(player);
    reply(true, `Godmode ${player.creativeGod ? "on" : "off"}`, { on: player.creativeGod });
  } else if (op === "heal") {
    for (const c of colonists.values()) c.hp = c.maxHp;
    for (const p of players.values()) if (!p.dead) p.hp = playerMaxHp(p);
    for (const tc of state.townCenters) tc.hp = townCenterMaxHp(tc.level);
    reply(true, "Everyone healed");
  } else if (op === "killMobs") {
    // Every monster (raids, wanderers, enemy fort garrisons, bosses); human settlement folk and creative
    // neutrals stay.
    let n = 0;
    for (const m of Array.from(mobs.values())) {
      if (m.creativeNeutral || (m.siteId && sites.get(m.siteId)?.faction === "human")) continue;
      damageMob(m, 1e12);
      if (mobs.has(m.id)) damageMob(m, 1e12);
      n++;
    }
    reply(true, `Killed ${n} monsters`, { killed: n });
  } else if (op === "clearNeutrals") {
    const clan = clans.find((c) => c.name === TEST_CLAN_NAME);
    let n = 0;
    for (const c of Array.from(colonists.values())) {
      if (!clan || c.clan !== clan.id) continue;
      releaseResourceReservation(c);
      releaseSlot(c.id);
      colonists.delete(c.id);
      n++;
    }
    for (const m of Array.from(mobs.values())) if (m.creativeNeutral) (mobs.delete(m.id), n++);
    reply(true, `Cleared ${n} neutral units`, { cleared: n });
  } else if (op === "clearWildlife") {
    for (const c of colonists.values()) if (c.targetWildlifeId !== null) releaseResourceReservation(c);
    const n = wildlife.size;
    wildlife.clear();
    reply(true, `Cleared ${n} animals`);
  } else if (op === "setTime") {
    const day = Number.isFinite(Number(msg.day)) ? Math.max(0, Math.floor(Number(msg.day)) - 1) : Math.floor(state.cycleTick / GAME_DAY_TICKS);
    const phases = timePhases();
    const within = typeof msg.phase === "string" && msg.phase in phases ? phases[msg.phase] : state.cycleTick % GAME_DAY_TICKS;
    state.cycleTick = day * GAME_DAY_TICKS + within;
    state.wasNight = isNightNow();
    reply(true, `Day ${day + 1}, ${typeof msg.phase === "string" ? msg.phase : "same time"}`, { cycleTick: state.cycleTick });
  } else if (op === "raid") {
    const day = Number.isFinite(Number(msg.day)) ? Math.max(0, Math.floor(Number(msg.day)) - 1) : Math.floor(state.cycleTick / GAME_DAY_TICKS);
    const before = new Set(raidGroups.keys());
    spawnRaid(day);
    let n = 0;
    for (const [id, g] of raidGroups) if (!before.has(id)) (g.aggroTick = Math.min(g.aggroTick, state.cycleTick), n++);
    reply(n > 0, n > 0 ? `A day ${day + 1} raid (${n} group${n === 1 ? "" : "s"}) is on its way` : "No raid spawned", { groups: n });
  } else if (op === "stamp") {
    const id = msg.template as SiteTemplateId;
    if (!(id in SITE_TEMPLATES) || !Number.isFinite(x) || !Number.isFinite(y)) return reply(false, "Unknown template");
    const { w, h } = templateSize(SITE_TEMPLATES[id]);
    const tile = tileOfPixel(x, y);
    const r = stampSiteSearch(id, tile.x - (w >> 1), tile.y - (h >> 1), 30, { tier: typeof msg.tier === "number" ? msg.tier : undefined });
    if (!r.site) reply(false, `No room: ${r.problem}`);
    else reply(true, `Stamped ${r.site.name}`, { siteId: r.site.id });
  } else if (op === "tradingPost") {
    const tile = tileOfPixel(x, y);
    if (!inBounds(tile.x, tile.y)) return reply(false, "Off the map");
    withClan(clanById(player.clan), () => placeTradingPost(tile.x, tile.y, Math.max(1, Math.min(3, Number(msg.level) || 1))));
    reply(true, "Trading Post (with wagon) placed");
  } else if (op === "relation" || op === "quest") {
    const s = nearestSite(x, y, true);
    if (!s) return reply(false, "No human settlement on the map: stamp one first");
    if (op === "quest") {
      const r = forcePostQuest(s.id, player.clan, (["defend", "clearCamp", "deliver"].includes(msg.kind as string) ? msg.kind : "deliver") as "defend" | "clearCamp" | "deliver");
      return typeof r === "string" ? reply(false, `${s.name}: ${r}`) : reply(true, `${s.name} posts a ${r.kind} quest`);
    }
    if (typeof msg.value === "number") adjustRelation(player.clan, s.id, Math.max(-100, Math.min(100, msg.value)) - relationOf(player.clan, s.id));
    if (typeof msg.vassal === "boolean") forceVassal(s, player.clan, msg.vassal);
    reply(true, `${s.name}: relation ${relationOf(player.clan, s.id)}${s.vassalOf === player.clan ? ", your vassal" : ""}`, { siteId: s.id, relation: relationOf(player.clan, s.id), vassal: s.vassalOf === player.clan });
  } else if (op === "forceAttack") {
    const type = msg.targetType === "w" ? "w" : "c";
    const targetId = String(msg.targetId ?? "");
    const target = type === "c" ? colonists.get(targetId) : wildlife.get(Number(targetId));
    if (!target || (type === "c" && ((target as Colonist).clan ?? 0) === player.clan)) return reply(false, "Nothing to attack there");
    let n = 0;
    for (const id of Array.isArray(msg.unitIds) ? msg.unitIds : []) {
      const c = typeof id === "string" ? colonists.get(id) : undefined;
      if (!c || (c.clan ?? 0) !== player.clan || !isGuardOrMilitiaKind(c.kind)) continue;
      releaseSlot(c.id);
      c.targetMobId = null;
      c.path = [];
      c.creativeTarget = { type, id: targetId, forced: true };
      n++;
    }
    reply(n > 0, n > 0 ? `${n} unit${n === 1 ? "" : "s"} attacking` : "No soldiers selected", { units: n });
  } else {
    reply(false, "Unknown creative op");
  }
}
