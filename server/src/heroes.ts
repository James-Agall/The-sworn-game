// heroes.ts: Hero phases 1-4 support: equipment, hero profiles, items, relics, recruitable heroes, Blacksmith forging.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { randomUUID } from "node:crypto";
import {
  type ColonistKind, type EquipSlot, HungerMark, type Equipment, GEAR_SLOTS, PLAYER_MAX_HP, type HeroStats,
  type ItemStats, type GearItem, type HeroClass, SPELL_SLOT_COUNT, type HeroProfileSnapshot, type GameEventCategory,
  type GearSlot, type ItemSlotKind, HERO_CLASSES, type HeroSheetSnapshot, type BuildingInfo, HERO_CLASS_LABEL,
  TileType, TICK_RATE,
} from "@colony/shared/protocol";
import type { Colonist, Cost, HeroProfile, Mob, Player } from "./types.js";
import {
  ARMOUR_DAMAGE_TAKEN_MULT, EQUIPPED_KINDS, EQUIP_ARMOURED_KINDS, EQUIP_DROP_CHANCE, EQUIP_LOOT_TIER_WEIGHTS,
  EQUIP_SLOT_LABEL, EQUIP_TIERS, EQUIP_TOAST_THROTTLE_TICKS, FORGE_ARMOUR_IRON, FORGE_QUEUE_CAP, FORGE_TICKS,
  FORGE_WEAPON_IRON, FORGE_WEAPON_WOOD, HERO_CLASS_STATS, HERO_INVENTORY_CAP, HERO_KEY_PREFIX, HERO_LEVEL_DAMAGE_PCT,
  HERO_LEVEL_MAX_HP, HERO_LEVEL_XP, HERO_MAX_LEVEL, HERO_MAX_TOTAL, HERO_MIN_DAMAGE_TAKEN_MULT, HERO_MIN_SPEED_MULT,
  HERO_NAMES, HERO_POPULATION_COST, HERO_RECRUIT_COST, HERO_RECRUIT_TICKS, HERO_RESPAWN_FEE_BASE,
  HERO_RESPAWN_FEE_PER_LEVEL, HERO_XP_BOSS, HERO_XP_MARKED_MULT, HERO_XP_PER_KILL, PLAIN_GEAR,
  PLAYER_ATTACK_COOLDOWN_TICKS, PLAYER_ATTACK_DAMAGE, RELIC_CATALOGUE, RELIC_ELITE_MOB_CHANCE, RELIC_HEARTH_CHANCE,
  TEST_HOOKS, TOME_ELITE_CHANCE, TOME_HEARTH_CHANCE, WEAPON_DAMAGE_MULT,
} from "./constants.js";
import {
  colonists, equipEvents, forgeQueues, heroEvents, heroProfiles, heroRecruits, players, respawnQueue,
  state,
} from "./state.js";
import { getBuildingLevel, inBounds, resourceKey, tileIndex, tileOfPixel } from "./tiles.js";
import { settlementBlocker, settlementKeyNear, spawnColonistForPost } from "./colonists.js";
import { keyToTile } from "./mobs.js";
import { canAfford, formatCost, spend } from "./construction.js";
import {
  grantLevelSpells, grantTome, restoreSpellBook, spellBasePctFor, spellBookSnapshot, spellBuffDamageMult,
} from "./spells.js";
import { sendTo } from "./saves.js";
import { broadcastEvent } from "./net.js";

export function equipEvent(e: Omit<(typeof equipEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  equipEvents.push({ ...e, tick: state.cycleTick });
  if (equipEvents.length > 300) equipEvents.splice(0, equipEvents.length - 300);
}

export function resetEquipment() {
  state.equipment.armour = [0, 0, 0];
  state.equipment.weapon = [0, 0, 0];
  forgeQueues.clear();
  state.lastUnequippedToastTick = -Infinity;
  state.equipDropToasted = false;
  state.lastEquipDropToastTick = -Infinity;
}

export function isEquippedKind(kind: ColonistKind): boolean {
  return EQUIPPED_KINDS.includes(kind);
}

// Takes the highest tier in stock of `slot` (0 when the stock is empty).
export function takeBestEquipment(slot: EquipSlot): number {
  for (let tier = EQUIP_TIERS; tier >= 1; tier--) {
    if (state.equipment[slot][tier - 1] > 0) {
      state.equipment[slot][tier - 1]--;
      return tier;
    }
  }
  return 0;
}

// Called by spawnColonistForPost for every EQUIPPED_KINDS unit (posts, upgrades, respawns, house extras).
export function equipNewUnit(c: Colonist) {
  c.armourTier = takeBestEquipment("armour");
  c.weaponTier = takeBestEquipment("weapon");
  equipEvent({ type: "equip", id: c.id, detail: `${c.kind} armour ${c.armourTier} weapon ${c.weaponTier}` });
  if (c.armourTier > 0 && c.weaponTier > 0) return;
  equipEvent({ type: "unequipped", id: c.id, detail: `${c.armourTier === 0 ? "armour " : ""}${c.weaponTier === 0 ? "weapon" : ""}`.trim() });
  if (state.cycleTick - state.lastUnequippedToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  state.lastUnequippedToastTick = state.cycleTick;
  const missing = c.armourTier === 0 && c.weaponTier === 0 ? "armour or weapons" : c.armourTier === 0 ? "armour" : "a forged weapon";
  const name = c.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent("build", `A ${name} musters without ${missing} — the stock is empty (forge more at a Blacksmith)`);
}

export function weaponDamageMult(c: Colonist): number {
  return WEAPON_DAMAGE_MULT[c.weaponTier ?? 0] ?? 1;
}

export function armourDamageTakenMult(c: Colonist): number {
  return ARMOUR_DAMAGE_TAKEN_MULT[c.armourTier ?? 0] ?? 1;
}

export function rollLootTier(): number {
  let r = Math.random();
  for (let i = 0; i < EQUIP_LOOT_TIER_WEIGHTS.length; i++) {
    r -= EQUIP_LOOT_TIER_WEIGHTS[i];
    if (r < 0) return i + 1;
  }
  return 1;
}

// `count` pieces (armour or weapon at random) of a weighted random tier, straight into the stock.
// Returns the toast text, e.g. "2 armour (T1, T3), 1 weapon (T2)".
export function grantTieredEquipment(count: number, source: string): string {
  const got: Record<EquipSlot, number[]> = { armour: [], weapon: [] };
  for (let i = 0; i < count; i++) {
    const slot: EquipSlot = Math.random() < 0.5 ? "armour" : "weapon";
    const tier = rollLootTier();
    state.equipment[slot][tier - 1]++;
    got[slot].push(tier);
    equipEvent({ type: "loot", slot, tier, detail: source });
  }
  return (["armour", "weapon"] as EquipSlot[])
    .filter((slot) => got[slot].length > 0)
    .map((slot) => `${got[slot].length} ${EQUIP_SLOT_LABEL[slot]} (${got[slot].sort().map((t) => `T${t}`).join(", ")})`)
    .join(", ");
}

// From damageMob on a kill: armoured kinds drop a tier-1 piece EQUIP_DROP_CHANCE of the time, bosses /
// mini-boss elites / Hunger-marked mobs always. Deserters (former colonists) drop nothing.
export function dropEquipmentFor(mob: Mob) {
  if (mob.isDeserter) return;
  const guaranteed = !!mob.boss || mob.mark !== HungerMark.None;
  if (!guaranteed && !EQUIP_ARMOURED_KINDS.includes(mob.kind)) return;
  if (!guaranteed && Math.random() >= (state.testEquipDropChance ?? EQUIP_DROP_CHANCE)) return;
  const slot: EquipSlot = Math.random() < 0.5 ? "armour" : "weapon";
  state.equipment[slot][0]++;
  equipEvent({ type: "drop", id: mob.id, slot, tier: 1, detail: mob.kind });
  const first = !state.equipDropToasted;
  if (!first && state.cycleTick - state.lastEquipDropToastTick < EQUIP_TOAST_THROTTLE_TICKS) return;
  state.equipDropToasted = true;
  state.lastEquipDropToastTick = state.cycleTick;
  const name = mob.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
  broadcastEvent(
    first ? "milestone" : "build",
    `Salvaged a tier-1 ${EQUIP_SLOT_LABEL[slot]} from a fallen ${name}${first ? " — it goes to the colony's stock" : ""}`
  );
}
export function heroEvent(e: Omit<(typeof heroEvents)[number], "tick">) {
  if (!TEST_HOOKS) return;
  heroEvents.push({ ...e, tick: state.cycleTick });
  if (heroEvents.length > 300) heroEvents.splice(0, heroEvents.length - 300);
}

export function emptyEquipment(): Equipment {
  return Object.fromEntries(GEAR_SLOTS.map((s) => [s, null])) as Equipment;
}

export function heroLevelFor(xp: number): number {
  let level = 1;
  while (level < HERO_MAX_LEVEL && xp >= HERO_LEVEL_XP[level]) level++;
  return level;
}

export function computeHeroStats(equipment: Equipment, level: number, baseHp = PLAYER_MAX_HP, spellBasePct = 0): HeroStats {
  const sum: Required<ItemStats> = { damagePct: 0, damageTakenPct: 0, maxHp: 0, moveSpeedPct: 0, attackSpeedPct: 0, spellPowerPct: 0 };
  for (const slot of GEAR_SLOTS) {
    const item = equipment[slot];
    if (!item) continue;
    for (const k of Object.keys(sum) as (keyof ItemStats)[]) sum[k] += item.stats[k] ?? 0;
  }
  const lv = level - 1;
  return {
    maxHp: baseHp + sum.maxHp + Math.round((baseHp * HERO_LEVEL_MAX_HP * lv) / 100),
    damageMult: (1 + sum.damagePct / 100) * (1 + (HERO_LEVEL_DAMAGE_PCT * lv) / 100),
    damageTakenMult: Math.max(HERO_MIN_DAMAGE_TAKEN_MULT, 1 + sum.damageTakenPct / 100),
    moveSpeedMult: Math.max(HERO_MIN_SPEED_MULT, 1 + sum.moveSpeedPct / 100),
    attackSpeedMult: Math.max(HERO_MIN_SPEED_MULT, 1 + sum.attackSpeedPct / 100),
    spellPowerMult: 1 + (sum.spellPowerPct + spellBasePct) / 100,
  };
}

export function newHeroProfile(
  key: string, equipment = emptyEquipment(), inventory: GearItem[] = [], xp = 0, hero?: { heroClass: HeroClass; heroName: string }
): HeroProfile {
  const level = heroLevelFor(xp);
  const baseHp = hero ? HERO_CLASS_STATS[hero.heroClass].maxHp : PLAYER_MAX_HP;
  return {
    key, equipment, inventory, xp, level, version: ++state.heroProfileVersionCounter,
    stats: computeHeroStats(equipment, level, baseHp, spellBasePctFor(hero?.heroClass)), ...(hero ?? {}),
    spells: [], spellSlots: Array(SPELL_SLOT_COUNT).fill(null), spellAuto: true, spellGrants: 0,
  };
}

export function heroProfileFor(key: string): HeroProfile {
  let prof = heroProfiles.get(key);
  if (!prof) {
    prof = newHeroProfile(key);
    heroProfiles.set(key, prof);
  }
  return prof;
}

export function heroProfileOf(player: Player): HeroProfile {
  return heroProfileFor(player.profileKey);
}

// After any change to a profile: re-derive its modifiers, mark it for resending, and clamp the HP of
// every player playing it to the new max (a max-HP gain doesn't heal).
export function recomputeHeroProfile(prof: HeroProfile) {
  prof.level = heroLevelFor(prof.xp);
  prof.stats = computeHeroStats(prof.equipment, prof.level, prof.heroClass ? HERO_CLASS_STATS[prof.heroClass].maxHp : PLAYER_MAX_HP, spellBasePctFor(prof.heroClass));
  prof.version = ++state.heroProfileVersionCounter;
  for (const p of players.values()) {
    if (p.profileKey === prof.key && !p.dead) p.hp = Math.min(p.hp, prof.stats.maxHp);
  }
  // Hero phase 3: the living hero's max HP follows (a gain doesn't heal, a loss clamps).
  if (prof.heroClass) {
    state.heroRosterVersion++;
    const c = colonists.get(prof.key.slice(HERO_KEY_PREFIX.length));
    if (c) {
      c.maxHp = prof.stats.maxHp;
      c.hp = Math.min(c.hp, c.maxHp);
    }
  }
}

export function playerMaxHp(p: Player): number {
  return heroProfileOf(p).stats.maxHp;
}

export function playerDamage(p: Player): number {
  return PLAYER_ATTACK_DAMAGE * heroProfileOf(p).stats.damageMult * spellBuffDamageMult("p:" + p.id);
}

export function playerAttackCooldownTicks(p: Player): number {
  return Math.max(1, Math.round(PLAYER_ATTACK_COOLDOWN_TICKS / heroProfileOf(p).stats.attackSpeedMult));
}

export function heroProfileSnapshot(prof: HeroProfile): HeroProfileSnapshot {
  return {
    equipment: prof.equipment,
    inventory: prof.inventory,
    inventoryCap: HERO_INVENTORY_CAP,
    xp: prof.xp,
    level: prof.level,
    levelXp: HERO_LEVEL_XP[prof.level - 1],
    nextLevelXp: prof.level < HERO_MAX_LEVEL ? HERO_LEVEL_XP[prof.level] : null,
    stats: prof.stats,
    spells: spellBookSnapshot(prof),
  };
}

export function sendHeroEvent(prof: HeroProfile, category: GameEventCategory, text: string) {
  for (const p of players.values()) if (p.profileKey === prof.key) sendTo(p, { type: "event", category, text });
}

// Which slot kinds a gear slot accepts.
export function gearSlotKind(slot: GearSlot): ItemSlotKind {
  if (slot === "trinket1" || slot === "trinket2") return "trinket";
  if (slot.startsWith("spell")) return "spell";
  return slot as ItemSlotKind;
}

export function ownsRelic(prof: HeroProfile, relicId: string): boolean {
  const has = (p: HeroProfile) => p.inventory.some((i) => i.relicId === relicId) || GEAR_SLOTS.some((s) => p.equipment[s]?.relicId === relicId);
  // Hero phase 3: a relic worn by one of the colony's heroes counts as owned (heroes equip from the shared pack).
  return has(prof) || Array.from(heroProfiles.values()).some((p) => !!p.heroClass && has(p));
}

// A random relic this profile doesn't own yet (or `relicId`, if given and unowned) into its inventory.
// Returns the item, or null (all owned / unknown id / inventory full).
export function grantRelic(prof: HeroProfile, source: string, relicId?: string): GearItem | null {
  const pool = RELIC_CATALOGUE.filter((r) => !ownsRelic(prof, r.relicId) && (relicId === undefined || r.relicId === relicId));
  if (pool.length === 0) return null;
  if (prof.inventory.length >= HERO_INVENTORY_CAP) {
    sendHeroEvent(prof, "build", "A relic was found, but your pack is full (40 items)");
    return null;
  }
  const r = pool[Math.floor(Math.random() * pool.length)];
  const item: GearItem = { id: randomUUID(), slot: r.slot, name: r.name, tier: "relic", stats: { ...r.stats }, kind: r.kind, relicId: r.relicId, icon: r.icon };
  prof.inventory.push(item);
  recomputeHeroProfile(prof);
  heroEvent({ type: "relic", key: prof.key, detail: `${r.relicId} ${source}` });
  sendHeroEvent(prof, "milestone", `Relic found: ${item.name}`);
  return item;
}

// Who gets a kill's relic / XP: the player who struck the blow ("p:<id>"), else (soldiers, towers, test
// hooks) every connected player's profile (relics only; XP needs a player's own killing blow).
export function lootProfiles(attackerKey?: string): HeroProfile[] {
  if (attackerKey?.startsWith("p:")) {
    const p = players.get(attackerKey.slice(2));
    if (p) return [heroProfileOf(p)];
  }
  const keys = new Set(Array.from(players.values(), (p) => p.profileKey));
  return Array.from(keys, (k) => heroProfileFor(k));
}

// From damageMob on a kill: relics (bosses always, armoured / marked mobs RELIC_ELITE_MOB_CHANCE) and XP.
export function heroRewardsForKill(mob: Mob, attackerKey?: string) {
  if (attackerKey?.startsWith("p:")) {
    const p = players.get(attackerKey.slice(2));
    if (p) {
      const xp = mob.boss ? HERO_XP_BOSS[mob.boss] : HERO_XP_PER_KILL * (mob.mark !== HungerMark.None ? HERO_XP_MARKED_MULT : 1);
      const prof = heroProfileOf(p);
      const before = prof.level;
      prof.xp += xp;
      recomputeHeroProfile(prof);
      heroEvent({ type: "xp", key: prof.key, amount: xp, detail: mob.kind });
      if (prof.level > before) sendHeroEvent(prof, "milestone", `You reach level ${prof.level} (+${HERO_LEVEL_DAMAGE_PCT}% damage, +${HERO_LEVEL_MAX_HP} max HP)`);
      grantLevelSpells(prof, true);
    }
  }
  // Hero phase 3: a hero's killing blow (melee or its own arrow / bolt) earns that hero the XP; the relic
  // roll below still goes to the players' shared pack (lootProfiles: every connected player).
  if (attackerKey?.startsWith("c:")) {
    const hc = colonists.get(attackerKey.slice(2));
    if (hc?.kind === "hero") {
      const xp = mob.boss ? HERO_XP_BOSS[mob.boss] : HERO_XP_PER_KILL * (mob.mark !== HungerMark.None ? HERO_XP_MARKED_MULT : 1);
      const prof = heroProfileFor(heroKey(hc.id));
      const before = prof.level;
      prof.xp += xp;
      recomputeHeroProfile(prof);
      heroEvent({ type: "xp", key: prof.key, amount: xp, detail: mob.kind });
      if (prof.level > before) {
        broadcastEvent("milestone", `${hc.heroName ?? "A hero"} reaches level ${prof.level} (+${HERO_LEVEL_DAMAGE_PCT}% damage, +${HERO_LEVEL_MAX_HP}% max HP)`);
      }
      grantLevelSpells(prof, true);
    }
  }
  if (mob.isDeserter) return;
  // Hero phase 4: Spell Tomes (the Warlord always, a mini-boss elite TOME_ELITE_CHANCE).
  const tomeRoll = mob.boss === "warlord" ? 1 : mob.boss === "elite" ? (state.testTomeChance ?? TOME_ELITE_CHANCE) : 0;
  if (tomeRoll > 0 && Math.random() < tomeRoll) for (const prof of lootProfiles(attackerKey)) grantTome(prof, mob.boss ?? mob.kind);
  const roll = mob.boss ? 1 : mob.mark !== HungerMark.None || EQUIP_ARMOURED_KINDS.includes(mob.kind) ? (state.testRelicChance ?? RELIC_ELITE_MOB_CHANCE) : 0;
  if (roll <= 0 || Math.random() >= roll) return;
  for (const prof of lootProfiles(attackerKey)) grantRelic(prof, mob.boss ?? mob.kind);
}

export function heroRelicForHearth(attackerKey?: string) {
  if (Math.random() < (state.testTomeChance ?? TOME_HEARTH_CHANCE)) for (const prof of lootProfiles(attackerKey)) grantTome(prof, "hearth");
  if (Math.random() >= (state.testRelicChance ?? RELIC_HEARTH_CHANCE)) return;
  for (const prof of lootProfiles(attackerKey)) grantRelic(prof, "hearth");
}

export function refuseGear(player: Player, text: string) {
  heroEvent({ type: "refuse", key: player.profileKey, detail: text });
  sendTo(player, { type: "event", category: "build", text });
}

// Hero phase 3: the profile whose equipment an equip message targets: the player's own (no heroId), or the
// hero's ("hero:<id>"; any hero of the colony, alive or not). The pack is always the player's.
export function gearTarget(player: Player, heroId: unknown): HeroProfile | null {
  if (heroId === undefined || heroId === null || heroId === "") return heroProfileOf(player);
  if (typeof heroId !== "string") return null;
  const prof = heroProfiles.get(heroKey(heroId));
  return prof?.heroClass ? prof : null;
}

export function handleEquipItem(player: Player, itemId: unknown, slot: unknown, heroId?: unknown) {
  if (typeof itemId !== "string" || typeof slot !== "string" || !GEAR_SLOTS.includes(slot as GearSlot)) return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseGear(player, "No such hero");
  const idx = pack.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return refuseGear(player, "That item is not in your pack");
  const item = pack.inventory[idx];
  const gs = slot as GearSlot;
  if (gearSlotKind(gs) !== item.slot) return refuseGear(player, `${item.name} doesn't go in the ${gs} slot`);
  pack.inventory.splice(idx, 1);
  const old = prof.equipment[gs];
  if (old) pack.inventory.push(old);
  prof.equipment[gs] = item;
  recomputeHeroProfile(prof);
  if (prof !== pack) recomputeHeroProfile(pack);
  heroEvent({ type: "equip", key: prof.key, detail: `${gs} ${item.name}` });
}

export function handleUnequipItem(player: Player, slot: unknown, heroId?: unknown) {
  if (typeof slot !== "string" || !GEAR_SLOTS.includes(slot as GearSlot)) return;
  const pack = heroProfileOf(player);
  const prof = gearTarget(player, heroId);
  if (!prof) return refuseGear(player, "No such hero");
  const item = prof.equipment[slot as GearSlot];
  if (!item) return;
  if (pack.inventory.length >= HERO_INVENTORY_CAP) return refuseGear(player, "Your pack is full (40 items)");
  prof.equipment[slot as GearSlot] = null;
  pack.inventory.push(item);
  recomputeHeroProfile(prof);
  if (prof !== pack) recomputeHeroProfile(pack);
  heroEvent({ type: "unequip", key: prof.key, detail: `${slot} ${item.name}` });
}

// One plain tiered piece out of the colony stock into the player's pack (it no longer arms a soldier).
export function handleTakeFromArmoury(player: Player, slot: unknown, tier: unknown, heroId?: unknown) {
  if (slot !== "armour" && slot !== "weapon") return;
  if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > EQUIP_TIERS) return;
  const prof = heroProfileOf(player);
  if (state.equipment[slot][tier - 1] <= 0) return refuseGear(player, `No tier-${tier} ${EQUIP_SLOT_LABEL[slot]} in the colony's stock`);
  if (prof.inventory.length >= HERO_INVENTORY_CAP) return refuseGear(player, "Your pack is full (40 items)");
  state.equipment[slot][tier - 1]--;
  const def = PLAIN_GEAR[slot];
  const item: GearItem = { id: randomUUID(), slot: def.slot, name: def.names[tier - 1], tier: tier as 1 | 2 | 3, stats: def.stats(tier), kind: def.kind, icon: `icon-${slot}T${tier}` };
  prof.inventory.push(item);
  recomputeHeroProfile(prof);
  heroEvent({ type: "take", key: prof.key, detail: `${slot} ${tier}` });
  // Hero phase 3: taken for a hero's tab - straight onto that hero when its socket is free.
  const hero = heroId ? gearTarget(player, heroId) : null;
  if (hero && hero !== prof && !hero.equipment[def.slot as GearSlot]) handleEquipItem(player, item.id, def.slot, heroId);
}

// Save / load: profiles as plain data; anything malformed is dropped (old saves: none).
export function serializeHeroProfiles() {
  return Array.from(heroProfiles.values(), (p) => ({
    key: p.key, equipment: p.equipment, inventory: p.inventory, xp: p.xp,
    ...(p.heroClass ? { heroClass: p.heroClass, heroName: p.heroName } : {}),
    // Hero phase 4 (old saves: none learned; restore then grants the level-ups already earned).
    spells: p.spells, spellSlots: p.spellSlots, spellAuto: p.spellAuto, spellGrants: p.spellGrants,
  }));
}

export function restoreHeroProfiles(saved: unknown) {
  heroProfiles.clear();
  if (!Array.isArray(saved)) return;
  const validItem = (i: unknown): i is GearItem =>
    !!i && typeof i === "object" && typeof (i as GearItem).id === "string" && typeof (i as GearItem).name === "string" &&
    typeof (i as GearItem).slot === "string" && typeof (i as GearItem).stats === "object";
  for (const raw of saved as Record<string, unknown>[]) {
    if (!raw || typeof raw.key !== "string") continue;
    const eq = emptyEquipment();
    const savedEq = (raw.equipment ?? {}) as Record<string, unknown>;
    for (const slot of GEAR_SLOTS) if (validItem(savedEq[slot])) eq[slot] = savedEq[slot] as GearItem;
    const inv = Array.isArray(raw.inventory) ? raw.inventory.filter(validItem).slice(0, HERO_INVENTORY_CAP) : [];
    const xp = typeof raw.xp === "number" && raw.xp >= 0 ? raw.xp : 0;
    const hero = HERO_CLASSES.includes(raw.heroClass as HeroClass)
      ? { heroClass: raw.heroClass as HeroClass, heroName: typeof raw.heroName === "string" ? raw.heroName : "Hero" }
      : undefined;
    const prof = newHeroProfile(raw.key, eq, hero ? [] : inv, xp, hero);
    restoreSpellBook(prof, raw);
    heroProfiles.set(raw.key, prof);
  }
}

// Appended to this player's snapshot payload only when their profile changed since the last one sent.
export function withPlayerProfile(payload: string, player: Player): string {
  const prof = heroProfileOf(player);
  if (player.profileSentVersion === prof.version) return payload;
  player.profileSentVersion = prof.version;
  return payload.slice(0, -1) + ',"profile":' + JSON.stringify(heroProfileSnapshot(prof)) + "}";
}

export function heroKey(id: string): string {
  return HERO_KEY_PREFIX + id;
}

export function heroBaseStats(cls: HeroClass) {
  return { ...HERO_CLASS_STATS[cls] };
}

export function heroTestEvent(e: { type: string; id: string; amount?: number; detail?: string }) {
  heroEvent({ type: e.type, key: heroKey(e.id), amount: e.amount, detail: e.detail });
}

// The hero's profile, created (or given its class, e.g. after a lost profile) on demand.
export function ensureHeroProfile(id: string, heroClass: HeroClass, heroName: string): HeroProfile {
  let prof = heroProfiles.get(heroKey(id));
  if (!prof) {
    prof = newHeroProfile(heroKey(id), emptyEquipment(), [], 0, { heroClass, heroName });
    heroProfiles.set(prof.key, prof);
  } else if (!prof.heroClass) {
    prof.heroClass = heroClass;
    prof.heroName = heroName;
    recomputeHeroProfile(prof);
  }
  return prof;
}

// Class base + the SAME HeroStats as the player (computeHeroStats: level and equipment).
export function heroCombatStats(c: Colonist) {
  const cls = c.heroClass ?? "champion";
  const base = HERO_CLASS_STATS[cls];
  const s = ensureHeroProfile(c.id, cls, c.heroName ?? "Hero").stats;
  return {
    maxHp: s.maxHp,
    damage: base.damage * s.damageMult,
    range: base.range,
    cooldown: Math.max(1, Math.round(base.cooldown / s.attackSpeedMult)),
    speed: base.speed * s.moveSpeedMult,
    melee: base.melee,
  };
}

export function heroRespawnFee(id: string): number {
  return HERO_RESPAWN_FEE_BASE + HERO_RESPAWN_FEE_PER_LEVEL * (heroProfiles.get(heroKey(id))?.level ?? 1);
}

// Every hero of the colony with where it belongs: alive (posted at its Keep), being recruited, or fallen
// (queued for a window).
export function heroRoster(): { id: string; name: string; heroClass: HeroClass; tx: number; ty: number; status: HeroSheetSnapshot["status"] }[] {
  const out: ReturnType<typeof heroRoster> = [];
  for (const c of colonists.values()) {
    if (c.kind === "hero") out.push({ id: c.id, name: c.heroName ?? "Hero", heroClass: c.heroClass ?? "champion", tx: c.postX, ty: c.postY, status: "alive" });
  }
  for (const r of heroRecruits) out.push({ id: r.id, name: r.name, heroClass: r.heroClass, tx: r.tx, ty: r.ty, status: "recruiting" });
  for (const q of respawnQueue) if (q.hero) out.push({ ...q.hero, tx: q.tx, ty: q.ty, status: "fallen" });
  return out;
}

export function pickHeroName(): string {
  const used = new Set(heroRoster().map((h) => h.name));
  const free = HERO_NAMES.filter((n) => !used.has(n));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  for (let i = 2; ; i++) {
    const n = `${HERO_NAMES[Math.floor(Math.random() * HERO_NAMES.length)]} ${["", "", "II", "III", "IV", "V"][i] ?? i}`;
    if (!used.has(n)) return n;
  }
}

// Why the Keep at (tx, ty) can't recruit a `cls` now ("" = it can).
export function heroRecruitBlocker(tx: number, ty: number, cls: HeroClass): string {
  const level = getBuildingLevel(tx, ty);
  const roster = heroRoster();
  if (roster.filter((h) => h.tx === tx && h.ty === ty).length >= level) {
    return `Keep Lv ${level} holds ${level} hero${level === 1 ? "" : "es"}${level < 3 ? " (upgrade the Keep for more)" : ""}`;
  }
  if (roster.length >= HERO_MAX_TOTAL) return `At most ${HERO_MAX_TOTAL} heroes`;
  if (!canAfford(HERO_RECRUIT_COST[cls])) return "Not enough resources";
  // Heroes still being recruited for this settlement already hold their 2 population.
  const key = settlementKeyNear(tx, ty);
  const pending = heroRecruits.filter((r) => settlementKeyNear(r.tx, r.ty) === key).length;
  return settlementBlocker(tx, ty, HERO_POPULATION_COST * (1 + pending));
}

export function keepHeroInfo(tx: number, ty: number): NonNullable<BuildingInfo["heroes"]> {
  const here = heroRoster().filter((h) => h.tx === tx && h.ty === ty);
  return {
    count: here.length,
    cap: getBuildingLevel(tx, ty),
    options: HERO_CLASSES.map((heroClass) => {
      const reason = heroRecruitBlocker(tx, ty, heroClass);
      return { heroClass, label: HERO_CLASS_LABEL[heroClass], cost: formatCost(HERO_RECRUIT_COST[heroClass]), enabled: reason === "", reason };
    }),
    roster: here.map((h) => ({
      name: h.name,
      heroClass: h.heroClass,
      level: heroProfiles.get(heroKey(h.id))?.level ?? 1,
      status: h.status === "fallen" ? `fallen, back at dawn / dusk for ${heroRespawnFee(h.id)} gold` : h.status,
    })),
  };
}

export function handleRecruitHero(player: Player, tx: number, ty: number, cls: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Keep) return;
  if (!HERO_CLASSES.includes(cls as HeroClass)) return;
  const heroClass = cls as HeroClass;
  const reason = heroRecruitBlocker(tx, ty, heroClass);
  if (reason) {
    heroEvent({ type: "recruitRefused", key: player.profileKey, detail: reason });
    sendTo(player, { type: "event", category: "build", text: `Can't recruit: ${reason}` });
    return;
  }
  spend(HERO_RECRUIT_COST[heroClass]);
  const id = randomUUID();
  const name = pickHeroName();
  ensureHeroProfile(id, heroClass, name);
  heroRecruits.push({ id, name, heroClass, tx, ty, ticksLeft: state.instantBuild ? 1 : HERO_RECRUIT_TICKS });
  state.heroRosterVersion++;
  heroTestEvent({ type: "recruit", id, detail: heroClass });
  broadcastEvent("build", `${name} the ${HERO_CLASS_LABEL[heroClass]} answers the Keep's call (arrives in ${state.instantBuild ? 0 : HERO_RECRUIT_TICKS / TICK_RATE} s)`);
}

// Once per tick: a recruit's short muster runs down, then the hero walks out of the Keep.
export function updateHeroRecruits() {
  for (let i = heroRecruits.length - 1; i >= 0; i--) {
    const r = heroRecruits[i];
    if (--r.ticksLeft > 0) continue;
    heroRecruits.splice(i, 1);
    spawnHeroColonist(r.id, r.name, r.heroClass, r.tx, r.ty);
    broadcastEvent("milestone", `${r.name} the ${HERO_CLASS_LABEL[r.heroClass]} joins the colony`);
  }
}

// The hero (new or back from death) beside its Keep, holding the spot it stepped out on.
export function spawnHeroColonist(id: string, name: string, heroClass: HeroClass, tx: number, ty: number): Colonist {
  const c = spawnColonistForPost(tx, ty, "hero", 1);
  colonists.delete(c.id);
  c.id = id;
  c.heroClass = heroClass;
  c.heroName = name;
  colonists.set(id, c);
  const prof = ensureHeroProfile(id, heroClass, name);
  c.maxHp = prof.stats.maxHp;
  c.hp = c.maxHp;
  const t = tileOfPixel(c.x, c.y);
  Object.assign(c, { rallyTileX: t.x, rallyTileY: t.y, rallyX: c.x, rallyY: c.y });
  state.heroRosterVersion++;
  heroTestEvent({ type: "spawn", id, detail: heroClass });
  return c;
}

export function heroSheetsSnapshot(): HeroSheetSnapshot[] {
  return heroRoster().map((h) => {
    const prof = ensureHeroProfile(h.id, h.heroClass, h.name);
    return { id: h.id, name: h.name, heroClass: h.heroClass, status: h.status, respawnFee: heroRespawnFee(h.id), profile: heroProfileSnapshot(prof) };
  });
}

// Appended to a player's snapshot payload only when the hero roster changed since the last one sent.
export function withPlayerHeroes(payload: string, player: Player): string {
  if (player.heroesSentVersion === state.heroRosterVersion) return payload;
  player.heroesSentVersion = state.heroRosterVersion;
  return payload.slice(0, -1) + ',"heroes":' + JSON.stringify(heroSheetsSnapshot()) + "}";
}
// ---- Blacksmith forging: one item at a time per Blacksmith, FORGE_QUEUE_CAP queued (the first is in
// progress). Cost is paid when queued (no refund). Not saved: a load starts every forge empty.

export function forgeCost(slot: EquipSlot, tier: number): Cost {
  const i = Math.min(Math.max(tier, 1), EQUIP_TIERS) - 1;
  if (slot === "weapon") return { iron: FORGE_WEAPON_IRON[i], wood: FORGE_WEAPON_WOOD };
  const extra = tier - 1;
  if (extra <= 0) return { iron: FORGE_ARMOUR_IRON[i] };
  return state.stock.tools >= extra ? { iron: FORGE_ARMOUR_IRON[i], tools: extra } : { iron: FORGE_ARMOUR_IRON[i], wood: extra };
}

export function blacksmithStaffed(tx: number, ty: number): boolean {
  for (const c of colonists.values()) if (c.postX === tx && c.postY === ty && c.kind === "artisan") return true;
  return false;
}

// Why the Blacksmith at (tx, ty) can't queue `slot` now ("" = it can).
export function forgeQueueBlocker(tx: number, ty: number, slot: EquipSlot): string {
  if (!blacksmithStaffed(tx, ty)) return "No smith at work";
  if ((forgeQueues.get(resourceKey(tx, ty))?.queue.length ?? 0) >= FORGE_QUEUE_CAP) return `Queue full (${FORGE_QUEUE_CAP})`;
  if (!canAfford(forgeCost(slot, getBuildingLevel(tx, ty)))) return "Not enough resources";
  return "";
}

export function blacksmithForgeInfo(tx: number, ty: number): NonNullable<BuildingInfo["forge"]> {
  const state = forgeQueues.get(resourceKey(tx, ty));
  const tier = getBuildingLevel(tx, ty);
  const head = state?.queue[0];
  return {
    tier,
    queue: state ? state.queue.map((q) => ({ ...q })) : [],
    progress: head ? 1 - state!.ticksLeft / FORGE_TICKS[head.slot] : null,
    cap: FORGE_QUEUE_CAP,
    options: (["armour", "weapon"] as EquipSlot[]).map((slot) => {
      const reason = forgeQueueBlocker(tx, ty, slot);
      return {
        slot,
        label: `Forge ${slot === "armour" ? "Armour" : "Weapon"} T${tier}`,
        cost: `${formatCost(forgeCost(slot, tier))}, ${FORGE_TICKS[slot] / TICK_RATE}s`,
        enabled: reason === "",
        reason,
      };
    }),
  };
}

export function handleQueueForge(tx: number, ty: number, slot: unknown) {
  if (!inBounds(tx, ty) || state.tiles[tileIndex(tx, ty)] !== TileType.Blacksmith) return;
  if (slot !== "armour" && slot !== "weapon") return;
  if (forgeQueueBlocker(tx, ty, slot) !== "") return;
  const tier = getBuildingLevel(tx, ty);
  spend(forgeCost(slot, tier));
  const key = resourceKey(tx, ty);
  let localState = forgeQueues.get(key);
  if (!localState) {
    localState = { queue: [], ticksLeft: 0 };
    forgeQueues.set(key, localState);
  }
  localState.queue.push({ slot, tier });
  if (localState.queue.length === 1) localState.ticksLeft = state.instantBuild ? 1 : FORGE_TICKS[slot];
}

// Once per tick: each Blacksmith's first queued item counts down while a smith is posted there.
export function updateForges() {
  for (const [key, localState] of forgeQueues) {
    const tile = keyToTile(key);
    if (!tile || state.tiles[tileIndex(tile.x, tile.y)] !== TileType.Blacksmith) {
      forgeQueues.delete(key);
      continue;
    }
    const head = localState.queue[0];
    if (!head || !blacksmithStaffed(tile.x, tile.y)) continue;
    if (--localState.ticksLeft > 0) continue;
    state.equipment[head.slot][head.tier - 1]++;
    equipEvent({ type: "forged", slot: head.slot, tier: head.tier, detail: key });
    broadcastEvent("build", `The Blacksmith forged a tier-${head.tier} ${EQUIP_SLOT_LABEL[head.slot]}`);
    localState.queue.shift();
    const next = localState.queue[0];
    if (next) localState.ticksLeft = state.instantBuild ? 1 : FORGE_TICKS[next.slot];
    else forgeQueues.delete(key);
  }
}

// Snapshot `forgeBusy`: tile indices of the Blacksmiths whose queue head is counting down (the client
// plays the forging animation there).
export function forgeBusyForSnapshot(): number[] {
  const out: number[] = [];
  for (const [key, state] of forgeQueues) {
    const tile = keyToTile(key);
    if (tile && state.queue.length > 0 && blacksmithStaffed(tile.x, tile.y)) out.push(tileIndex(tile.x, tile.y));
  }
  return out;
}
