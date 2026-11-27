// Interior fixes 2026-11-27: armouryDepositOf (shared/src/protocol.ts), the rule both the server (`depositGear`) and the
// hero sheet's "Deposit to armoury" use. Run by gear-deposit-test.mjs (in-process, no network).
// Gear deposit tiers 2026-11-27: every weapon has a deposit tier; special weapons (relics, adventure gear, stronger than
// plain) are boosted a tier (cap 3). The old "relics / adventure gear are refused" checks were deliberately rewritten:
// relic and adventure WEAPONS now deposit; relic / adventure ARMOUR is still refused.
import assert from "node:assert/strict";
import {
  GEAR_POWER_WEIGHTS, PLAIN_WEAPON_DAMAGE_PCT, PLAIN_WEAPON_POWER, armouryDepositLabel, armouryDepositOf, gearPowerScore, plainWeaponTierFor, plainArmourTierFor,
  type ArmouryDeposit, type GearItem,
} from "@colony/shared/protocol";
import { ADVENTURE_GEAR, adventureGear, type AdventureGearId } from "@colony/shared/expeditions";
import { PLAIN_GEAR, RELIC_CATALOGUE } from "./src/constants.ts";

let checked = 0;
const ok = (cond: boolean, msg: string) => { assert(cond, msg); checked++; console.log(`PASS ${msg}`); };
const item = (o: Partial<GearItem>): GearItem => ({ id: "x", slot: "weapon", name: "x", tier: 1, stats: {}, ...o });
const dep = (i: GearItem) => armouryDepositOf(i);
const stock = (i: GearItem) => { const r = dep(i); return "refuse" in r ? `refuse:${r.refuse}` : `${r.stock}:${r.tier}${r.boosted ? "+" : ""}`; };

// Plain weapon table matches the server's PLAIN_GEAR (the armoury Take / found racks / the starter sword).
for (const t of [1, 2, 3]) ok(PLAIN_GEAR.weapon.stats(t).damagePct === PLAIN_WEAPON_DAMAGE_PCT[t - 1], `plain tier-${t} weapon damage ${PLAIN_WEAPON_DAMAGE_PCT[t - 1]}% = PLAIN_GEAR`);
ok(PLAIN_WEAPON_POWER.join() === "20,40,70", `plain weapon power per tier [${PLAIN_WEAPON_POWER}]`);
ok(Object.keys(GEAR_POWER_WEIGHTS).length === 6, "every ItemStats field has a power weight");

// Power score and its mapping.
ok(gearPowerScore({ damagePct: 60, attackSpeedPct: 10 }) === 70, "score: 60% damage + 10% attack speed = 70");
ok(gearPowerScore({ damagePct: 35, spellPowerPct: 40 }) === 55, "score: spell power counts half");
ok(gearPowerScore({ maxHp: 20, damageTakenPct: -15 }) === 17, "score: 20 HP = 2, -15% damage taken = +15");
ok(gearPowerScore({ damagePct: Number.NaN, moveSpeedPct: 10 }) === 10, "score ignores a NaN stat");
ok(gearPowerScore(undefined) === 0, "score of no stats = 0");
for (const [score, want] of [[-5, 1], [0, 1], [19, 1], [20, 1], [39, 1], [40, 2], [69, 2], [70, 3], [500, 3]] as const) {
  ok(plainWeaponTierFor(score) === want, `power ${score} -> plain tier ${want}`);
}

// Plain weapons: their own tier, not boosted.
ok(stock(item({ slot: "weapon", tier: 1, kind: "sword", stats: { damagePct: 20 } })) === "weapon:1", "plain tier-1 sword -> weapon tier 1");
ok(stock(item({ slot: "weapon", tier: 2, kind: "axe", stats: { damagePct: 40 } })) === "weapon:2", "plain tier-2 axe -> weapon tier 2");
ok(stock(item({ slot: "weapon", tier: 3, kind: "bow", stats: { damagePct: 70 } })) === "weapon:3", "tier-3 bow -> weapon stock tier 3 (kind not kept)");
ok(stock(item({ slot: "weapon", tier: 1, kind: "club", stats: { damagePct: 20 } })) === "weapon:1", "a club deposits like any weapon");
ok(stock(item({ slot: "weapon", tier: 2, kind: "spear", stats: { damagePct: 5 } })) === "weapon:2", "a weaker-than-plain tier-2 spear stays tier 2 (not boosted)");
const pl = dep(item({ tier: 2, stats: { damagePct: 40 } })) as ArmouryDeposit;
ok(pl.boosted === false && pl.baseTier === 2 && pl.why === "tier 2" && armouryDepositLabel(pl) === "a tier 2 weapon", `plain label "${armouryDepositLabel(pl)}" / why "${pl.why}"`);

// Special weapons: boosted a tier, capped at 3.
ok(stock(item({ tier: 1, stats: { damagePct: 45 } })) === "weapon:2+", "a tier-1 weapon stronger than plain is special: tier 1 +1 = 2");
ok(stock(item({ tier: 4 as unknown as 1, stats: { damagePct: 45 } })) === "weapon:3+", "an out-of-range tier: base from stats (45 -> 2) +1 = 3");
ok(stock(item({ tier: Number.NaN as unknown as 1, stats: {} })) === "weapon:2+", "a NaN tier with no stats: base 1 +1 = 2");
ok(stock(item({ tier: "relic", relicId: "x", stats: { damagePct: 10 } })) === "weapon:2+", "a weak relic weapon (power 10 -> base 1) deposits as tier 2");
ok(stock(item({ tier: "relic", relicId: "x", stats: { damagePct: 45 } })) === "weapon:3+", "a relic weapon scoring like plain tier 2 deposits as tier 3");
ok(stock(item({ tier: 2, relicId: "odd", stats: { damagePct: 40 } })) === "weapon:3+", "a relicId on a tiered weapon: tier 2 +1 = 3");
const capped = dep(item({ tier: 3, adventureTrait: "breach" as AdventureGearId, kind: "axe", stats: { damagePct: 8 } })) as ArmouryDeposit;
ok(capped.tier === 3 && capped.boosted && capped.baseTier === 3 && /capped at tier 3/.test(capped.why) && armouryDepositLabel(capped) === "a tier 3 weapon (special: +1 tier, capped at 3)",
  `tier-3 special capped at 3: "${capped.why}" / "${armouryDepositLabel(capped)}"`);

// Every relic WEAPON in the catalogue (built exactly as grantRelic does) deposits as a boosted tier 1-3.
const table: string[] = [];
for (const r of RELIC_CATALOGUE) {
  const it: GearItem = { id: r.relicId, slot: r.slot, name: r.name, tier: "relic", stats: { ...r.stats }, kind: r.kind, relicId: r.relicId, icon: r.icon };
  const to = dep(it);
  if (r.slot === "weapon") {
    ok(!("refuse" in to) && to.stock === "weapon" && [1, 2, 3].includes(to.tier) && to.boosted && to.baseTier === plainWeaponTierFor(gearPowerScore(r.stats)),
      `relic ${r.name} (power ${gearPowerScore(r.stats)}) -> ${"refuse" in to ? to.refuse : `${to.why} = tier ${to.tier}`}`);
    if (!("refuse" in to)) table.push(`${r.name}: power ${gearPowerScore(r.stats)} -> base ${to.baseTier} -> tier ${to.tier}`);
  } else {
    ok(!("refuse" in to) && to.stock === "armour" && to.boosted && to.baseTier === plainArmourTierFor(gearPowerScore(r.stats)) && to.tier === Math.min(3, to.baseTier + 1),
      `relic armour ${r.name} (${r.slot}, power ${gearPowerScore(r.stats)}) -> ${"refuse" in to ? to.refuse : `${to.why} = tier ${to.tier}`}`);
  }
}
ok(table.length === RELIC_CATALOGUE.filter((r) => r.slot === "weapon").length && table.length >= 4, `relic weapons covered: ${table.length}`);

// Every adventure gear id (built as grantAdventureGear does): weapons boosted 1-3, armour refused.
for (const id of Object.keys(ADVENTURE_GEAR) as AdventureGearId[]) {
  const def = ADVENTURE_GEAR[id];
  for (const t of [1, 2, 3] as const) {
    const it = adventureGear(id, `adv-${id}-${t}`, t, def.slot === "weapon" ? { damagePct: 8 } : {});
    const to = dep(it);
    if (def.slot === "weapon") {
      ok(!("refuse" in to) && to.stock === "weapon" && to.tier === Math.min(3, t + 1) && to.boosted && to.baseTier === t, `adventure ${def.name} tier ${t} -> ${"refuse" in to ? to.refuse : `${to.why} = tier ${to.tier}`}`);
      if (t === 1 && !("refuse" in to)) table.push(`${def.name} (adventure, tier 1): power ${gearPowerScore(it.stats)} -> base 1 -> tier ${to.tier}`);
    } else {
      ok(!("refuse" in to) && to.stock === "armour" && to.boosted && to.baseTier === t && to.tier === Math.min(3, t + 1), `adventure armour ${def.name} (${def.slot}) T${t} -> ${"refuse" in to ? to.refuse : `${to.why} = tier ${to.tier}`}`);
    }
  }
}
console.log("Deposit tier table:\n  " + table.join("\n  "));

// Armour: head / body / legs / shield each count as one armour piece; plain keeps its tier, special is boosted a tier.
ok(stock(item({ slot: "chest", tier: 2, kind: "cuirass" })) === "armour:2", "breastplate -> armour stock");
ok(stock(item({ slot: "head", tier: 1, kind: "helm" })) === "armour:1", "helm -> armour stock");
ok(stock(item({ slot: "offhand", tier: 3, kind: "shield" })) === "armour:3", "shield -> armour stock");
ok(armouryDepositLabel(dep(item({ slot: "offhand", tier: 3, kind: "shield" })) as ArmouryDeposit) === "tier 3 armour", "armour label");
ok(stock(item({ slot: "legs", tier: 1, kind: "greaves" })) === "armour:1", "leg armour counts as a full armour piece (tier 1)");
ok(stock(item({ slot: "legs", tier: 3, kind: "greaves" })) === "armour:3", "tier 3 leg armour -> armour tier 3");
ok(stock(item({ slot: "head", tier: "relic", relicId: "oathkeeperHelm", stats: { damageTakenPct: -15, maxHp: 20 } })) === "armour:2+", "relic helm boosted to tier 2");
ok(stock(item({ slot: "chest", tier: "relic", relicId: "gorrathHide", stats: { damageTakenPct: -40, maxHp: 30 } })) === "armour:3+", "relic body armour boosted to tier 3");
ok(stock(item({ slot: "offhand", tier: 1, kind: "shield", adventureTrait: "steady" as AdventureGearId })) === "armour:2+", "adventure shield boosted +1 tier");
ok(stock(item({ slot: "legs", tier: 1, kind: "greaves", stats: { damageTakenPct: -30 } })) === "armour:2+", "a leg piece stronger than plain tier 1 counts as special (+1)");
ok(stock(item({ slot: "chest", tier: 4 as unknown as 1, stats: { damageTakenPct: -30 } })) === "armour:3+", "out-of-range armour tier: base from its power (tier 2), +1");
ok(stock(item({ slot: "tome", tier: "relic", spellId: "heal" as GearItem["spellId"] })).startsWith("refuse:Spell tomes"), "spell tome refused");
ok(stock(item({ slot: "weapon", tier: 1, spellId: "heal" as GearItem["spellId"] })).startsWith("refuse:Spell tomes"), "a spellId item is a tome even in the weapon slot");
ok(stock(item({ slot: "trinket", tier: 1 })).startsWith("refuse:Trinkets"), "a trinket refused");
ok(stock(item({ slot: "spell", tier: 1 })).startsWith("refuse:Trinkets and spell items"), "a spell-slot item refused");
console.log(`gear-deposit-regression: ${checked} checks passed`);
