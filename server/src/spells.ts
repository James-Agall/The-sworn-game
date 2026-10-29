// spells.ts: Hero spells: spell book, status effects, casting, auto-cast.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import {
  type HeroClass, type SpellId, SPELL_IDS, type SpellBookSnapshot, SPELLS, SPELL_SLOT_COUNT, type GearItem,
  type BuildingInfo, TileType, TICK_RATE, TILE_SIZE, unitRole, type Stance,
} from "@colony/shared/protocol";
import type {
  Colonist, FriendlyUnit, HeroProfile, Mob, Player, SpellCaster, SpellStatus, SpellTarget,
} from "./types.js";
import {
  CHURCH_SPELL_PRICES, HERO_INVENTORY_CAP, SPELL_AUTO_EVERY_TICKS, SPELL_AUTO_HEAL_BELOW, SPELL_AUTO_RALLY_ENGAGED,
  SPELL_AUTO_SUMMON_SCAN_TILES, SPELL_AUTO_WARD_HURT_TICKS, SPELL_GRANT_LEVELS, SPELL_LEARN_ORDER,
  SPELL_MAGE_BASE_PCT, SPELL_RANGE_SLACK_PX, TEST_HOOKS,
} from "./constants.js";
import {
  colonists, heroProfiles, lastHurtTick, mobs, players, spellCooldowns, spellEvents, spellStatuses, state,
  summonedUntil,
} from "./state.js";
import { inBounds, tileIndex, tileOfPixel } from "./tiles.js";
import { isWalkableTile } from "./pathfinding.js";
import { releaseResourceReservation, stock } from "./economy.js";
import { isAbbeyClergy, spawnColonistForPost } from "./colonists.js";
import { mobRole } from "./units.js";
import { damageMob, releaseSlot } from "./combat.js";
import { isDormantGuardian } from "./mobs.js";
import { gearTarget, heroKey, heroProfileFor, heroProfileOf, playerMaxHp, sendHeroEvent } from "./heroes.js";
import { broadcastEvent, sendTo } from "./index.js";

export function spellEvent(e: Omit<(typeof spellEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  spellEvents.push({ ...e, tick: state.spellTick });
  if (spellEvents.length > 400) spellEvents.splice(0, spellEvents.length - 400);
}

export function spellBasePctFor(cls: HeroClass | undefined): number {
  return cls === "mage" ? SPELL_MAGE_BASE_PCT : 0;
}

export function isSpellId(v: unknown): v is SpellId {
  return typeof v === "string" && (SPELL_IDS as string[]).includes(v);
}

export function spellBookSnapshot(prof: HeroProfile): SpellBookSnapshot {
  const cooldowns: Partial<Record<SpellId, number>> = {};
  const cd = spellCooldowns.get(prof.key);
  if (cd) for (const id of SPELL_IDS) if ((cd[id] ?? 0) > state.spellTick) cooldowns[id] = cd[id]! - state.spellTick;
  return { learned: [...prof.spells], slots: [...prof.spellSlots], auto: !!prof.heroClass && prof.spellAuto, cooldowns };
}

// Marks a profile for resending (spell book / cooldown changes) without re-deriving its stats.
export function touchSpellProfile(prof: HeroProfile) {
  prof.version = ++state.heroProfileVersionCounter;
  if (prof.heroClass) state.heroRosterVersion++;
}

export function profileLabel(prof: HeroProfile): string {
  return prof.heroClass ? prof.heroName ?? "A hero" : "You";
}

// Teaches `id` (no-op if known) and puts it in the first free slot. Toasts to the player(s) of that
// profile, or everyone for a hero.
export function learnSpell(prof: HeroProfile, id: SpellId, source: string, announce = true): boolean {
  if (prof.spells.includes(id)) return false;
  prof.spells.push(id);
  const free = prof.spellSlots.indexOf(null);
  if (free >= 0) prof.spellSlots[free] = id;
  touchSpellProfile(prof);
  spellEvent({ type: "learn", key: prof.key, spell: id, detail: source });
  if (announce) {
    const text = `${profileLabel(prof)} learn${prof.heroClass ? "s" : ""} ${SPELLS[id].name}${free >= 0 ? ` (spell slot ${free + 1})` : ""}`;
    if (prof.heroClass) broadcastEvent("milestone", text);
    else sendHeroEvent(prof, "milestone", text);
  }
  return true;
}

// Level-up grants: one spell per SPELL_GRANT_LEVELS level reached, the first unlearned one of the class
// order (then any unlearned spell). Also run on load, so an old save's level-N profile gets its spells.
export function grantLevelSpells(prof: HeroProfile, announce: boolean) {
  const earned = SPELL_GRANT_LEVELS.filter((l) => prof.level >= l).length;
  while (prof.spellGrants < earned) {
    prof.spellGrants++;
    const order = SPELL_LEARN_ORDER[prof.heroClass ?? "player"];
    const next = order.find((s) => !prof.spells.includes(s)) ?? SPELL_IDS.find((s) => !prof.spells.includes(s));
    if (next) learnSpell(prof, next, `level ${prof.level}`, announce);
  }
}

export function restoreSpellBook(prof: HeroProfile, raw: Record<string, unknown>) {
  const learned = Array.isArray(raw.spells) ? (raw.spells as unknown[]).filter(isSpellId) : [];
  prof.spells = Array.from(new Set(learned));
  const slots = Array.isArray(raw.spellSlots) ? (raw.spellSlots as unknown[]) : [];
  prof.spellSlots = Array.from({ length: SPELL_SLOT_COUNT }, (_, i) => (isSpellId(slots[i]) && prof.spells.includes(slots[i] as SpellId) ? (slots[i] as SpellId) : null));
  prof.spellAuto = raw.spellAuto !== false;
  prof.spellGrants = typeof raw.spellGrants === "number" && raw.spellGrants >= 0 ? Math.floor(raw.spellGrants) : 0;
  grantLevelSpells(prof, false);
}

// A Spell Tome into the profile's pack: `spellId`, else a random spell it hasn't learned (any once all are).
export function grantTome(prof: HeroProfile, source: string, spellId?: SpellId): GearItem | null {
  if (prof.inventory.length >= HERO_INVENTORY_CAP) {
    sendHeroEvent(prof, "build", "A spell tome was found, but your pack is full (40 items)");
    return null;
  }
  const unknown = SPELL_IDS.filter((s) => !prof.spells.includes(s));
  const pool = unknown.length > 0 ? unknown : SPELL_IDS;
  const id = spellId ?? pool[Math.floor(Math.random() * pool.length)];
  const item: GearItem = { id: randomUUID(), slot: "tome", name: `Tome of ${SPELLS[id].name}`, tier: "relic", stats: {}, kind: "tome", spellId: id, icon: SPELLS[id].icon };
  prof.inventory.push(item);
  touchSpellProfile(prof);
  spellEvent({ type: "tome", key: prof.key, spell: id, detail: source });
  sendHeroEvent(prof, "milestone", `Spell tome found: ${item.name} (Learn it from the Hero sheet)`);
  return item;
}

export function refuseSpell(player: Player, text: string) {
  spellEvent({ type: "refuse", key: player.profileKey, detail: text });
  sendTo(player, { type: "event", category: "build", text });
}

export function handleUseTome(player: Player, itemId: unknown, heroId?: unknown) {
  if (typeof itemId !== "string") return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseSpell(player, "No such hero");
  const idx = pack.inventory.findIndex((i) => i.id === itemId && i.slot === "tome");
  if (idx < 0) return refuseSpell(player, "That tome is not in your pack");
  const tome = pack.inventory[idx];
  if (!isSpellId(tome.spellId)) return refuseSpell(player, "That tome is unreadable");
  if (prof.spells.includes(tome.spellId)) return refuseSpell(player, `${profileLabel(prof) === "You" ? "You already know" : `${profileLabel(prof)} already knows`} ${SPELLS[tome.spellId].name}`);
  pack.inventory.splice(idx, 1);
  touchSpellProfile(pack);
  learnSpell(prof, tome.spellId, "tome");
}

export function churchSpellShop(player: Player | undefined): NonNullable<BuildingInfo["spellShop"]> {
  const prof = player ? heroProfileOf(player) : null;
  return (Object.keys(CHURCH_SPELL_PRICES) as SpellId[]).map((spellId) => {
    const gold = CHURCH_SPELL_PRICES[spellId]!;
    const reason = prof?.spells.includes(spellId) ? "Already learned" : stock.gold < gold ? "Not enough gold" : "";
    return { spellId, label: SPELLS[spellId].name, gold, enabled: reason === "", reason };
  });
}

export function handleLearnSpell(player: Player, spellId: unknown, tx: unknown, ty: unknown) {
  if (!isSpellId(spellId) || typeof tx !== "number" || typeof ty !== "number" || !inBounds(tx, ty)) return;
  if (state.tiles[tileIndex(tx, ty)] !== TileType.ChurchPost) return refuseSpell(player, "Spells are taught at a Church");
  const price = CHURCH_SPELL_PRICES[spellId];
  if (price === undefined) return refuseSpell(player, `The Church doesn't teach ${SPELLS[spellId].name}`);
  const prof = heroProfileOf(player);
  if (prof.spells.includes(spellId)) return refuseSpell(player, `You already know ${SPELLS[spellId].name}`);
  if (stock.gold < price) return refuseSpell(player, `Not enough gold (${SPELLS[spellId].name} costs ${price})`);
  stock.gold -= price;
  learnSpell(prof, spellId, "church");
}

export function handleSetSpellSlot(player: Player, slot: unknown, spellId: unknown, heroId?: unknown) {
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPELL_SLOT_COUNT) return;
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseSpell(player, "No such hero");
  if (spellId === null) {
    prof.spellSlots[slot] = null;
  } else {
    if (!isSpellId(spellId)) return refuseSpell(player, "Unknown spell");
    if (!prof.spells.includes(spellId)) return refuseSpell(player, `${SPELLS[spellId].name} isn't learned yet`);
    // A spell sits in one slot at most: setting it elsewhere moves it.
    const was = prof.spellSlots.indexOf(spellId);
    if (was >= 0) prof.spellSlots[was] = null;
    prof.spellSlots[slot] = spellId;
  }
  touchSpellProfile(prof);
  spellEvent({ type: "slot", key: prof.key, spell: spellId ?? undefined, amount: slot });
}

export function handleSetSpellAuto(player: Player, heroId: unknown, auto: unknown) {
  if (typeof heroId !== "string" || typeof auto !== "boolean") return;
  const prof = gearTarget(player, heroId);
  if (!prof || !prof.heroClass) return;
  prof.spellAuto = auto;
  touchSpellProfile(prof);
}

// ---- Status effects (single damage / speed code paths read them) ----
export function statusAt(key: string): SpellStatus {
  let s = spellStatuses.get(key);
  if (!s) {
    s = {};
    spellStatuses.set(key, s);
  }
  return s;
}

// damageMob: +curseBonus damage taken while cursed.
export function spellDamageTakenMult(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.curseUntil !== undefined && s.curseUntil > state.spellTick ? 1 + (s.curseBonus ?? 0) : 1;
}

// damagePlayer / damageColonist: a ward shield soaks the blow first. Returns what gets through.
export function absorbWithWard(key: string, amount: number): number {
  lastHurtTick.set(key, state.spellTick);
  const s = spellStatuses.get(key);
  if (!s?.shield || (s.shieldUntil ?? 0) <= state.spellTick) return amount;
  const soaked = Math.min(s.shield, amount);
  s.shield -= soaked;
  spellEvent({ type: "absorb", key, amount: soaked, detail: String(amount) });
  return amount - soaked;
}

export function spellBuffDamageMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > state.spellTick ? 1 + (s.buffDamage ?? 0) : 1;
}

export function spellBuffSpeedMult(key: string): number {
  const s = spellStatuses.get(key);
  return s?.buffUntil !== undefined && s.buffUntil > state.spellTick ? 1 + (s.buffSpeed ?? 0) : 1;
}

// A mob's speed is read in many places, so a slow scales `mob.speed` itself and restores it on expiry
// (snapshotWorld saves the unslowed speed).
export function slowMob(mob: Mob, fraction: number, ticks: number) {
  const s = statusAt("m:" + mob.id);
  if (s.slowUntil === undefined || s.slowUntil <= state.spellTick || s.baseSpeed === undefined) {
    s.baseSpeed = mob.speed;
    mob.speed = mob.speed * (1 - fraction);
  }
  s.slowUntil = state.spellTick + ticks;
}

export function unslowedSpeed(mob: Mob): number {
  const s = spellStatuses.get("m:" + mob.id);
  return s?.baseSpeed !== undefined && (s.slowUntil ?? 0) > state.spellTick ? s.baseSpeed : mob.speed;
}

// Once per tick: burn ticks, expiries, summon despawns.
export function updateSpellStatuses() {
  state.spellTick++;
  for (const [key, s] of Array.from(spellStatuses)) {
    const mob = key.startsWith("m:") ? mobs.get(key.slice(2)) : undefined;
    const alive = mob || (key.startsWith("c:") ? colonists.has(key.slice(2)) : players.has(key.slice(2)));
    if (!alive) {
      spellStatuses.delete(key);
      continue;
    }
    if (mob && s.burnUntil !== undefined) {
      if (s.burnNext !== undefined && state.spellTick >= s.burnNext && s.burnNext <= s.burnUntil) {
        s.burnNext += TICK_RATE;
        spellEvent({ type: "burn", key, amount: s.burnPerSec });
        damageMob(mob, s.burnPerSec ?? 0, s.burnBy);
      }
      if (state.spellTick > s.burnUntil) s.burnUntil = s.burnNext = s.burnPerSec = s.burnBy = undefined;
    }
    if (mob && s.slowUntil !== undefined && state.spellTick >= s.slowUntil) {
      if (s.baseSpeed !== undefined && mobs.has(mob.id)) mob.speed = s.baseSpeed;
      s.slowUntil = s.baseSpeed = undefined;
    }
    if (s.curseUntil !== undefined && state.spellTick >= s.curseUntil) s.curseUntil = s.curseBonus = undefined;
    if (s.shieldUntil !== undefined && (state.spellTick >= s.shieldUntil || (s.shield ?? 0) <= 0)) s.shield = s.shieldUntil = undefined;
    if (s.buffUntil !== undefined && state.spellTick >= s.buffUntil) s.buffUntil = s.buffDamage = s.buffSpeed = undefined;
    if (Object.values(s).every((v) => v === undefined)) spellStatuses.delete(key);
  }
  for (const [id, until] of summonedUntil) {
    const c = colonists.get(id);
    if (!c) {
      summonedUntil.delete(id);
      continue;
    }
    if (state.spellTick < until) continue;
    summonedUntil.delete(id);
    releaseResourceReservation(c);
    releaseSlot(c.id);
    colonists.delete(id);
    spellEvent({ type: "expire", key: "c:" + id });
  }
  if (state.spellTick % (5 * TICK_RATE) === 0) {
    for (const [k, t] of lastHurtTick) if (state.spellTick - t > 5 * TICK_RATE) lastHurtTick.delete(k);
  }
}

export function clearSpellState() {
  spellStatuses.clear();
  spellCooldowns.clear();
  summonedUntil.clear();
  lastHurtTick.clear();
}

export function isSummoned(c: Colonist): boolean {
  return summonedUntil.has(c.id);
}

export function friendlyPos(f: FriendlyUnit) {
  return f.type === "player" ? { x: f.p.x, y: f.p.y } : { x: f.c.x, y: f.c.y };
}
export function friendlyKey(f: FriendlyUnit) {
  return f.type === "player" ? "p:" + f.p.id : "c:" + f.c.id;
}
export function friendlyHp(f: FriendlyUnit) {
  return f.type === "player" ? { hp: f.p.hp, max: playerMaxHp(f.p) } : { hp: f.c.hp, max: f.c.maxHp };
}

export function resolveFriendly(caster: SpellCaster, targetId: string | undefined): FriendlyUnit | null {
  if (!targetId) return caster.self;
  const p = players.get(targetId);
  if (p) return p.dead ? null : { type: "player", p };
  const c = colonists.get(targetId);
  return c && !isAbbeyClergy(c) ? { type: "colonist", c } : null;
}

export function spellScaled(caster: SpellCaster, base: number): number {
  return base * caster.prof.stats.spellPowerMult;
}

export function spellCooldownLeft(prof: HeroProfile, id: SpellId): number {
  return Math.max(0, (spellCooldowns.get(prof.key)?.[id] ?? 0) - state.spellTick);
}

// Validates and casts. Returns "" on success, else the reason (nothing happened).
export function castSpellNow(caster: SpellCaster, id: SpellId, target: SpellTarget): string {
  const def = SPELLS[id];
  if (!caster.prof.spells.includes(id)) return `${def.name} isn't learned`;
  const left = spellCooldownLeft(caster.prof, id);
  if (left > 0) return `${def.name} is on cooldown (${Math.ceil(left / TICK_RATE)} s)`;
  const rangePx = def.range * TILE_SIZE + SPELL_RANGE_SLACK_PX;
  const inRange = (x: number, y: number) => Math.hypot(x - caster.x, y - caster.y) <= rangePx;
  const sp = caster.prof.stats.spellPowerMult;
  const ticks = (s?: number) => Math.round((s ?? 0) * TICK_RATE);
  let fx: { x: number; y: number };
  if (def.targeting === "enemy") {
    const mob = target.targetId ? mobs.get(target.targetId) : undefined;
    if (!mob) return "No enemy targeted";
    if (!inRange(mob.x, mob.y)) return `Out of range (${def.range} tiles)`;
    fx = { x: mob.x, y: mob.y };
    if (id === "fireBolt") {
      damageMob(mob, def.power * sp, caster.attackerKey);
      if (mobs.has(mob.id)) {
        const s = statusAt("m:" + mob.id);
        s.burnUntil = state.spellTick + ticks(def.duration);
        s.burnNext = state.spellTick + TICK_RATE;
        s.burnPerSec = (def.burnPerSec ?? 0) * sp;
        s.burnBy = caster.attackerKey;
      }
    } else if (id === "curse") {
      const s = statusAt("m:" + mob.id);
      s.curseUntil = state.spellTick + ticks(def.duration);
      s.curseBonus = def.damageTakenBonus ?? 0;
    }
  } else if (def.targeting === "ally" || def.targeting === "self") {
    const ally = def.targeting === "self" ? caster.self : resolveFriendly(caster, target.targetId);
    if (!ally) return "No friendly target";
    const pos = friendlyPos(ally);
    if (!inRange(pos.x, pos.y)) return `Out of range (${def.range} tiles)`;
    fx = pos;
    if (id === "heal") {
      const amount = def.power * sp;
      if (ally.type === "player") ally.p.hp = Math.min(playerMaxHp(ally.p), ally.p.hp + amount);
      else ally.c.hp = Math.min(ally.c.maxHp, ally.c.hp + amount);
    } else if (id === "ward") {
      const s = statusAt(friendlyKey(ally));
      s.shield = def.power * sp;
      s.shieldUntil = state.spellTick + ticks(def.duration);
    }
  } else {
    if (typeof target.x !== "number" || typeof target.y !== "number" || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return "No spot targeted";
    if (!inRange(target.x, target.y)) return `Out of range (${def.range} tiles)`;
    fx = { x: target.x, y: target.y };
    const radiusPx = (def.radius ?? 0) * TILE_SIZE;
    if (id === "thunder" || id === "frost") {
      const hit = Array.from(mobs.values()).filter((m) => Math.hypot(m.x - fx.x, m.y - fx.y) <= radiusPx);
      for (const m of hit) {
        damageMob(m, def.power * sp, caster.attackerKey);
        if (id === "frost" && mobs.has(m.id)) slowMob(m, def.slow ?? 0, ticks(def.duration));
      }
      spellEvent({ type: "aoe", key: caster.prof.key, spell: id, amount: hit.length });
    } else if (id === "rallyBanner") {
      const buff = (key: string) => {
        const s = statusAt(key);
        s.buffUntil = state.spellTick + ticks(def.duration);
        s.buffDamage = def.buffDamage ?? 0;
        s.buffSpeed = def.buffSpeed ?? 0;
      };
      let n = 0;
      for (const c of colonists.values()) {
        if (unitRole(c.kind, c.heroClass) === undefined || Math.hypot(c.x - fx.x, c.y - fx.y) > radiusPx) continue;
        buff("c:" + c.id);
        n++;
      }
      for (const p of players.values()) {
        if (p.dead || Math.hypot(p.x - fx.x, p.y - fx.y) > radiusPx) continue;
        buff("p:" + p.id);
        n++;
      }
      spellEvent({ type: "rally", key: caster.prof.key, amount: n });
    } else if (id === "summon") {
      const t = tileOfPixel(fx.x, fx.y);
      const tile = isWalkableTile(t.x, t.y) ? t : tileOfPixel(caster.x, caster.y);
      for (let i = 0; i < (def.summonCount ?? 0); i++) {
        const c = spawnColonistForPost(tile.x, tile.y, "militia", 1);
        const p = { x: fx.x + (i === 0 ? -8 : 8), y: fx.y };
        if (isWalkableTile(tileOfPixel(p.x, p.y).x, tileOfPixel(p.x, p.y).y)) Object.assign(c, { x: p.x, y: p.y });
        Object.assign(c, { rallyTileX: tile.x, rallyTileY: tile.y, rallyX: c.x, rallyY: c.y, stance: "aggressive" as Stance });
        summonedUntil.set(c.id, state.spellTick + ticks(def.duration));
        spellEvent({ type: "summon", key: "c:" + c.id });
      }
    }
  }
  let cd = spellCooldowns.get(caster.prof.key);
  if (!cd) {
    cd = {};
    spellCooldowns.set(caster.prof.key, cd);
  }
  cd[id] = state.spellTick + ticks(def.cooldown);
  touchSpellProfile(caster.prof);
  state.pendingEffects.push({ fromX: caster.x, fromY: caster.y, toX: fx.x, toY: fx.y, spell: id });
  spellEvent({ type: "cast", key: caster.prof.key, spell: id, amount: def.power * sp, detail: target.targetId ?? (target.x !== undefined ? `${Math.round(target.x)},${Math.round(target.y ?? 0)}` : "self") });
  return "";
}

export function playerCaster(p: Player): SpellCaster {
  return { prof: heroProfileOf(p), x: p.x, y: p.y, attackerKey: "p:" + p.id, self: { type: "player", p } };
}

export function heroCaster(c: Colonist): SpellCaster {
  return { prof: heroProfileFor(heroKey(c.id)), x: c.x, y: c.y, attackerKey: "c:" + c.id, self: { type: "colonist", c } };
}

export function handleCastSpell(player: Player, msg: Record<string, unknown>) {
  const slot = msg.slot;
  if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= SPELL_SLOT_COUNT) return;
  let caster: SpellCaster;
  if (msg.heroId !== undefined && msg.heroId !== null && msg.heroId !== "") {
    const c = typeof msg.heroId === "string" ? colonists.get(msg.heroId) : undefined;
    if (!c || c.kind !== "hero") return refuseSpell(player, "That hero can't cast now");
    caster = heroCaster(c);
  } else {
    if (player.dead) return refuseSpell(player, "You can't cast while fallen");
    caster = playerCaster(player);
  }
  const id = caster.prof.spellSlots[slot];
  if (!id) return refuseSpell(player, `Spell slot ${slot + 1} is empty`);
  const reason = castSpellNow(caster, id, {
    targetId: typeof msg.targetId === "string" ? msg.targetId : undefined,
    x: typeof msg.x === "number" ? msg.x : undefined,
    y: typeof msg.y === "number" ? msg.y : undefined,
  });
  if (reason) refuseSpell(player, reason);
}

// ---- Hero auto-cast: each slotted, ready spell whose condition holds (first match casts) ----
export function autoEnemyInRange(c: Colonist, rangePx: number, want?: (m: Mob) => boolean): Mob | null {
  const ok = (m: Mob) => !m.passive && !isDormantGuardian(m) && Math.hypot(m.x - c.x, m.y - c.y) <= rangePx && (!want || want(m));
  const cur = c.targetMobId ? mobs.get(c.targetMobId) : undefined;
  if (cur && ok(cur)) return cur;
  let best: Mob | null = null;
  let bestD = Infinity;
  for (const m of mobs.values()) {
    if (!ok(m)) continue;
    const d = Math.hypot(m.x - c.x, m.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function friendliesNear(x: number, y: number, rangePx: number): FriendlyUnit[] {
  const out: FriendlyUnit[] = [];
  for (const o of colonists.values()) {
    if (isAbbeyClergy(o) || Math.hypot(o.x - x, o.y - y) > rangePx) continue;
    out.push({ type: "colonist", c: o });
  }
  for (const p of players.values()) if (!p.dead && Math.hypot(p.x - x, p.y - y) <= rangePx) out.push({ type: "player", p });
  return out;
}

export function autoSpellTarget(c: Colonist, id: SpellId): SpellTarget | null {
  const def = SPELLS[id];
  const rangePx = def.range * TILE_SIZE;
  const idOf = (f: FriendlyUnit) => (f.type === "player" ? f.p.id : f.c.id);
  if (id === "fireBolt") {
    const m = autoEnemyInRange(c, rangePx);
    return m ? { targetId: m.id } : null;
  }
  if (id === "thunder" || id === "frost") {
    const m = autoEnemyInRange(c, rangePx);
    return m ? { x: m.x, y: m.y } : null;
  }
  if (id === "curse") {
    const m = autoEnemyInRange(c, rangePx, (mm) => !!mm.boss || mobRole(mm) === "shock");
    return m && spellDamageTakenMult(m) === 1 ? { targetId: m.id } : null;
  }
  if (id === "heal") {
    let best: FriendlyUnit | null = null;
    let bestFrac = SPELL_AUTO_HEAL_BELOW;
    for (const f of friendliesNear(c.x, c.y, rangePx)) {
      const { hp, max } = friendlyHp(f);
      if (max > 0 && hp / max < bestFrac) {
        bestFrac = hp / max;
        best = f;
      }
    }
    return best ? { targetId: idOf(best) } : null;
  }
  if (id === "ward") {
    let best: FriendlyUnit | null = null;
    let bestFrac = Infinity;
    for (const f of friendliesNear(c.x, c.y, rangePx)) {
      const key = friendlyKey(f);
      const hurt = lastHurtTick.get(key);
      if (hurt === undefined || state.spellTick - hurt > SPELL_AUTO_WARD_HURT_TICKS) continue;
      const s = spellStatuses.get(key);
      if (s?.shield && (s.shieldUntil ?? 0) > state.spellTick) continue;
      const { hp, max } = friendlyHp(f);
      if (hp / max < bestFrac) {
        bestFrac = hp / max;
        best = f;
      }
    }
    return best ? { targetId: idOf(best) } : null;
  }
  if (id === "rallyBanner") {
    const radiusPx = (def.radius ?? 0) * TILE_SIZE;
    let engaged = 0;
    for (const o of colonists.values()) {
      if (unitRole(o.kind, o.heroClass) === undefined || Math.hypot(o.x - c.x, o.y - c.y) > radiusPx) continue;
      if (o.state === "attacking" || o.state === "engaging") engaged++;
    }
    return engaged >= SPELL_AUTO_RALLY_ENGAGED ? { x: c.x, y: c.y } : null;
  }
  if (id === "summon") {
    const scan = SPELL_AUTO_SUMMON_SCAN_TILES * TILE_SIZE;
    let foes = 0;
    for (const m of mobs.values()) if (!m.passive && !isDormantGuardian(m) && Math.hypot(m.x - c.x, m.y - c.y) <= scan) foes++;
    let friends = 0;
    for (const o of colonists.values()) if (unitRole(o.kind, o.heroClass) !== undefined && Math.hypot(o.x - c.x, o.y - c.y) <= scan) friends++;
    return foes >= 2 && foes > friends ? { x: c.x, y: c.y } : null;
  }
  return null;
}

export function heroAutoCast(c: Colonist) {
  // Strategy mode phase 4: hold fire also holds a hero's auto-spells.
  if (c.holdFire) return;
  if ((state.spellTick + c.id.charCodeAt(0)) % SPELL_AUTO_EVERY_TICKS !== 0) return;
  const prof = heroProfiles.get(heroKey(c.id));
  if (!prof || !prof.spellAuto) return;
  for (const id of prof.spellSlots) {
    if (!id || spellCooldownLeft(prof, id) > 0) continue;
    const t = autoSpellTarget(c, id);
    if (t && castSpellNow(heroCaster(c), id, t) === "") return;
  }
}
