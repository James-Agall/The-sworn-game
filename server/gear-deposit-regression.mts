// Interior fixes 2026-11-27: armouryDepositOf (shared/src/protocol.ts), the rule both the server (`depositGear`) and the
// hero sheet's "Deposit to armoury" use. Run by gear-deposit-test.mjs (in-process, no network).
import assert from "node:assert/strict";
import { armouryDepositOf, type GearItem } from "@colony/shared/protocol";

let checked = 0;
const ok = (cond: boolean, msg: string) => { assert(cond, msg); checked++; console.log(`PASS ${msg}`); };
const item = (o: Partial<GearItem>): GearItem => ({ id: "x", slot: "weapon", name: "x", tier: 1, stats: {}, ...o });
const stock = (i: GearItem) => { const r = armouryDepositOf(i); return "refuse" in r ? `refuse:${r.refuse}` : `${r.stock}:${r.tier}`; };

ok(stock(item({ slot: "weapon", tier: 1, kind: "sword" })) === "weapon:1", "tier-1 sword -> weapon stock tier 1");
ok(stock(item({ slot: "weapon", tier: 3, kind: "bow" })) === "weapon:3", "tier-3 bow -> weapon stock tier 3 (kind not kept)");
ok(stock(item({ slot: "chest", tier: 2, kind: "cuirass" })) === "armour:2", "breastplate -> armour stock");
ok(stock(item({ slot: "head", tier: 1, kind: "helm" })) === "armour:1", "helm -> armour stock");
ok(stock(item({ slot: "offhand", tier: 3, kind: "shield" })) === "armour:3", "shield -> armour stock");
ok(stock(item({ slot: "legs", tier: 1, kind: "greaves" })).startsWith("refuse:Leg armour"), "leg armour refused (the armoury makes none)");
ok(stock(item({ tier: "relic", relicId: "swornOathblade" })).startsWith("refuse:Relics and special gear"), "relic refused");
ok(stock(item({ tier: 2, relicId: "odd" })).startsWith("refuse:Relics"), "a relicId on a tiered item is still refused");
ok(stock(item({ tier: 1, adventureTrait: "breach" as GearItem["adventureTrait"] })).startsWith("refuse:Relics"), "adventure gear refused");
ok(stock(item({ slot: "tome", tier: "relic", spellId: "heal" as GearItem["spellId"] })).startsWith("refuse:Relics"), "spell tome refused");
ok(stock(item({ slot: "trinket", tier: 1 })).startsWith("refuse:"), "a trinket refused");
ok(stock(item({ tier: 4 as unknown as 1 })).startsWith("refuse:"), "an out-of-range tier refused");
ok(stock(item({ tier: Number.NaN as unknown as 1 })).startsWith("refuse:"), "a NaN tier refused");
console.log(`gear-deposit-regression: ${checked} checks passed`);
