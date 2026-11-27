import assert from "node:assert/strict";
import { heroProfiles, players, colonists } from "./src/state.js";
import { heroProfileOf, serializeHeroProfiles, restoreHeroProfiles, ensureStarterWeapon, newHeroProfile } from "./src/heroes.js";
import { HERO_KEY_PREFIX } from "./src/constants.js";
import type { Player } from "./src/types.js";

const mk = (key: string) => ({ id: key, profileKey: key, dead: false, hp: 100 }) as unknown as Player;
let checked = 0;
const ok = (cond: boolean, msg: string) => { assert(cond, msg); checked++; console.log(`PASS ${msg}`); };

players.clear(); colonists.clear(); heroProfiles.clear();

// 1. A brand-new player profile starts with an equipped plain tier-1 sword.
const a = heroProfileOf(mk("newbie"));
const sword = a.equipment.weapon;
ok(!!sword && sword.kind === "sword" && sword.tier === 1 && sword.slot === "weapon", "a new player starts with a tier-1 sword equipped");
ok(a.inventory.length === 0, "the starter sword is equipped, not in the pack");
ok((a.stats.damageMult ?? 1) > 1, `the starter sword counts in the stats (damage x${a.stats.damageMult.toFixed(2)})`);
ok(a.starterWeapon === true, "the profile is flagged");

// 2. Idempotent: asking again never grants another or replaces it.
const again = heroProfileOf(mk("newbie"));
ok(again === a && again.equipment.weapon?.id === sword!.id && again.inventory.length === 0, "asking again keeps the same sword");

// 3. Dropped / sold / unequipped for good: never granted again (live, and through save + load).
a.equipment.weapon = null;
ok(heroProfileOf(mk("newbie")).equipment.weapon === null, "a player who got rid of the sword is not given another");
const saved = JSON.parse(JSON.stringify(serializeHeroProfiles()));
ok(saved.find((p: { key: string; starterWeapon?: boolean }) => p.key === "newbie")?.starterWeapon === true, "the flag is saved");
heroProfiles.clear();
restoreHeroProfiles(saved);
ok(heroProfileOf(mk("newbie")).equipment.weapon === null, "still not granted again after save and load");

// 4. Old saves (no flag) with no weapon at all get the sword on next use, once.
heroProfiles.clear();
restoreHeroProfiles([{ key: "oldsave", equipment: {}, inventory: [], xp: 0 }]);
const old = heroProfileOf(mk("oldsave"));
ok(old.equipment.weapon?.kind === "sword" && old.equipment.weapon.tier === 1, "an old save with no weapon gets the starter sword");

// 5. A weapon in the pack counts: nothing is granted (and nothing is equipped for them).
heroProfiles.clear();
const axe = { id: "axe1", slot: "weapon", name: "Steel Axe", tier: 2, stats: { damagePct: 30 }, kind: "axe" };
restoreHeroProfiles([{ key: "packer", equipment: {}, inventory: [axe], xp: 0 }]);
const packer = heroProfileOf(mk("packer"));
ok(packer.equipment.weapon === null && packer.inventory.length === 1 && packer.inventory[0].id === "axe1", "a player with a pack weapon is not given a sword");

// 6. An equipped weapon is never replaced.
heroProfiles.clear();
restoreHeroProfiles([{ key: "armed", equipment: { weapon: axe }, inventory: [], xp: 0 }]);
ok(heroProfileOf(mk("armed")).equipment.weapon?.id === "axe1", "an equipped weapon is kept");

// 7. Heroes ("hero:<id>") are not players: they never get one.
heroProfiles.clear();
const hero = newHeroProfile(`${HERO_KEY_PREFIX}abc`, undefined, [], 0, { heroClass: "champion", heroName: "Ser Test" });
ensureStarterWeapon(hero);
ok(hero.equipment.weapon === null && !hero.starterWeapon, "a recruited hero is not given the starter sword");

console.log(`starter-weapon: ALL PASS (${checked} checks)`);
