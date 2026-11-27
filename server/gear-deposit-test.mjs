// Scripted test: Interior fixes 2026-11-27, `depositGear` (pack gear into the colony armoury stock).
// Weapons -> state.equipment.weapon[tier-1], helms / breastplates / shields -> armour[tier-1], the item leaves the pack;
// equipped pieces, special (relic / adventure) armour, tomes and leg armour are refused; away from any own store
// refused; malformed messages ignored; `all` deposits every PLAIN eligible piece and keeps the rest; round trip (deposit
// then the armoury Take gives back a plain piece of that tier); the stock survives save / load; the Town Center hall
// chest offers it. Gear deposit tiers 2026-11-27: special WEAPONS (relics, adventure gear) deposit boosted a tier (the
// old "relic / adventure weapon refused" checks were deliberately rewritten: they now deposit); a deposited relic can
// drop again; `itemIds` multi-select (mixed / duplicate / too many / malformed / not in the pack / another player's /
// equipped ids, partial success, one toast, rate-limited per message); the hall chest lists special weapons and asks first.
// The pure eligibility rules are also run in-process (gear-deposit-regression.mts). Needs a FRESH private server:
// `npm test -- gear-deposit`.
import WebSocket from "ws";
import { spawnSync } from "node:child_process";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const px = (t) => t * TILE + 16;

// 0. The pure rules, in-process (no network).
const pure = spawnSync(process.execPath, ["--import", "tsx", "gear-deposit-regression.mts"], { cwd: import.meta.dirname, env: { ...process.env, COLONY_TEST_HOOKS: "1" }, encoding: "utf8" });
process.stdout.write(pure.stdout ?? "");
result(pure.status === 0, `eligibility rules (gear-deposit-regression.mts) ${pure.status === 0 ? "pass" : "FAILED: " + (pure.stderr ?? "").slice(0, 400)}`);

const c = { ws: new WebSocket(`ws://localhost:${PORT}/?profile=gear-deposit`), welcome: null, welcomes: 0, snap: null, events: [], hook: new Map(), dialogue: null, saves: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") { c.welcome = m; c.welcomes++; }
  else if (m.type === "snapshot") { c.snap = m; if (m.life) c.life = m.life; }
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "dialogue") c.dialogue = m;
  else if (m.type === "saveResult") c.saves.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ins = (args = {}) => hook("interior", args);
const eq = async () => (await hook("equipState")).equipment;
const pack = async () => (await hook("packGear")).inventory;
const since = (n) => c.events.slice(n).join(" | ");
const put = (item) => hook("packGear", { item });
// 6 messages per player per real second ("Slow down"): checks are paced.
async function deposit(m) {
  await sleep(180);
  const n = c.events.length;
  send({ type: "depositGear", ...m });
  for (let i = 0; i < 50 && c.events.length === n; i++) await sleep(10);
  await sleep(30);
  return since(n);
}
let uid = 0;
const plain = (slot, tier, extra = {}) => ({ id: `t-${++uid}`, slot, tier, name: `Test ${slot} T${tier}`, kind: slot === "weapon" ? "spear" : slot === "head" ? "helm" : slot === "offhand" ? "shield" : slot === "legs" ? "greaves" : "cuirass", stats: { damagePct: 5 }, ...extra });

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("heroLife", { needs: false, pack: {} });
const tc = (await hook("constructionState")).townCenters[0];
const W = c.welcome.worldTilesX;
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
for (let i = 0; i < 40 && !c.life?.atStore; i++) await sleep(20);
result(c.life?.atStore === true, `next to the Town Center the life snapshot says atStore (${c.life?.atStore})`);

// 1. Weapon and armour pieces go into the right counters and leave the pack.
const spear = plain("weapon", 2);
await put(spear);
let ev = await deposit({ itemId: spear.id });
let E = await eq();
let inv = await pack();
result(E.weapon.join() === "0,1,0" && !inv.some((i) => i.id === spear.id) && /Deposited Test weapon T2 to the armoury as a tier 2 weapon \(tier 2 weapons: 1\)/.test(ev), `tier-2 weapon -> weapon stock [${E.weapon}], gone from the pack; "${ev}"`);
for (const [slot, tier, want] of [["head", 1, "1,0,0"], ["chest", 3, "1,0,1"], ["offhand", 1, "2,0,1"]]) {
  const it = plain(slot, tier);
  await put(it);
  ev = await deposit({ itemId: it.id });
  E = await eq();
  inv = await pack();
  result(E.armour.join() === want && !inv.some((i) => i.id === it.id) && /armour:/.test(ev), `${slot} T${tier} -> armour stock [${E.armour}] (want ${want}); "${ev}"`);
}

// 2. Refusals: equipped, relic armour, adventure armour, tome, leg armour; nothing moves. (A relic / adventure WEAPON
// deposits now: section 6b.)
const before = JSON.stringify(await eq());
const hs = await hook("heroState");
const equipped = hs.profile.equipment.weapon;
ev = await deposit({ itemId: equipped?.id });
result(!!equipped && /Unequip that first to deposit it in the armoury/.test(ev) && JSON.stringify(await eq()) === before, `equipped weapon (${equipped?.name}) refused: "${ev}"`);
const relic = (await hook("grantRelic", { relicId: "oathkeeperHelm" })).item;
ev = await deposit({ itemId: relic?.id });
result(!!relic && /Special armour \(relics, adventure gear\) can't go into the armoury/.test(ev) && (await pack()).some((i) => i.id === relic.id), `relic armour (${relic?.name}) refused and kept: "${ev}"`);
const adv = { id: `t-${++uid}`, slot: "offhand", tier: 1, kind: "shield", name: "Steady round shield", adventureTrait: "steady", stats: { damageTakenPct: -6, moveSpeedPct: -4 } };
await put(adv);
ev = await deposit({ itemId: adv.id });
result(/Special armour/.test(ev) && (await pack()).some((i) => i.id === adv.id), `adventure armour refused and kept: "${ev}"`);
const tome = (await hook("grantTome", {})).item;
ev = await deposit({ itemId: tome?.id });
result(!!tome && /Spell tomes can't go into the armoury/.test(ev) && (await pack()).some((i) => i.id === tome.id), `spell tome refused and kept: "${ev}"`);
const trinket = { id: `t-${++uid}`, slot: "trinket", tier: 1, name: "Test trinket", stats: { maxHp: 5 } };
await put(trinket);
ev = await deposit({ itemId: trinket.id });
result(/Trinkets and spell items can't go into the armoury/.test(ev) && (await pack()).some((i) => i.id === trinket.id), `trinket refused and kept: "${ev}"`);
// A special weapon stays in the pack through "all" (section 5): it goes in only by id.
const advW = plain("weapon", 1, { adventureTrait: "breach", kind: "axe", name: "Breaching axe", stats: { damagePct: 8 } });
await put(advW);
const legs = plain("legs", 1);
await put(legs);
ev = await deposit({ itemId: legs.id });
result(/Leg armour can't go into the armoury/.test(ev) && (await pack()).some((i) => i.id === legs.id), `leg armour refused (cannot round-trip): "${ev}"`);
ev = await deposit({ itemId: "no-such-item" });
result(/That item is not in your pack/.test(ev), `unknown id: "${ev}"`);
result(JSON.stringify(await eq()) === before, "no refusal changed the stock");

// 3. Malformed messages are ignored (no event, no change, server alive).
const n0 = c.events.length;
const inv0 = JSON.stringify(await pack());
for (const m of [{ itemId: 5 }, { itemId: null }, {}, { all: "yes" }, { itemId: { id: "x" } }, { itemId: "x".repeat(500) }, { all: 1 }]) send({ type: "depositGear", ...m });
await sleep(200);
result(c.events.length === n0 && JSON.stringify(await eq()) === before && JSON.stringify(await pack()) === inv0, `malformed depositGear ignored (${since(n0) || "no events"})`);

// 3b. Rate limit: a burst of 8 gets "Slow down" (6 per real second).
await sleep(1100);
const nb = c.events.length;
for (let i = 0; i < 8; i++) send({ type: "depositGear", itemId: "no-such-item" });
await sleep(200);
result(/Slow down/.test(since(nb)), `a burst of 8 deposits is rate-limited (${since(nb).slice(0, 160)})`);
await sleep(1100);

// 4. Away from any own store: refused, the item stays.
const far = { x: Math.max(3, Math.min(W - 4, tc.x + (tc.x < W / 2 ? 25 : -25))), y: tc.y };
await hook("teleportPlayer", { x: px(far.x), y: px(far.y) });
const sword = plain("weapon", 1);
await put(sword);
ev = await deposit({ itemId: sword.id });
result(/Stand next to your Town Center or a storage chest to deposit/.test(ev) && (await pack()).some((i) => i.id === sword.id) && JSON.stringify(await eq()) === before, `25 tiles away refused, item kept: "${ev}"`);
for (let i = 0; i < 40 && c.life?.atStore; i++) await sleep(20);
result(!c.life?.atStore, `away from stores atStore is off (${c.life?.atStore})`);

// 5. `all` next to the Town Center: every plain piece goes; relic / adventure armour, the special weapon, tome,
// trinket and legs stay.
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
await put(plain("chest", 2));
ev = await deposit({ all: true });
E = await eq();
inv = await pack();
const left = inv.map((i) => i.id).sort().join();
const keep = [relic.id, adv.id, tome.id, legs.id, trinket.id, advW.id].sort().join();
result(E.weapon.join() === "1,1,0" && E.armour.join() === "2,1,1" && left === keep && /Deposited 2 items to the armoury \(tier 1 weapons: 1, tier 2 armour: 1\)$/.test(ev), `deposit all: weapons [${E.weapon}], armour [${E.armour}], pack keeps only the special pieces (${inv.map((i) => i.name).join(", ")}); "${ev}"`);
ev = await deposit({ all: true });
result(/No plain weapons or armour in your pack/.test(ev), `deposit all with nothing eligible: "${ev}"`);

// 6. Round trip: the armoury Take gives a plain piece of that tier back (the kind is picked on Take).
send({ type: "takeFromArmoury", slot: "weapon", tier: 2, weaponKind: "spear" });
send({ type: "takeFromArmoury", slot: "armour", tier: 3, armourPart: "head" });
await sleep(150);
inv = await pack();
E = await eq();
const back = inv.find((i) => i.slot === "weapon" && i.tier === 2 && !i.relicId && !i.adventureTrait);
const helm = inv.find((i) => i.slot === "head" && i.tier === 3);
result(back?.kind === "spear" && helm?.kind === "helm" && E.weapon.join() === "1,0,0" && E.armour.join() === "2,1,0", `round trip: took ${back?.name} and ${helm?.name}; stock weapons [${E.weapon}], armour [${E.armour}]`);
ev = await deposit({ itemId: back.id });
result(/tier 2 weapons: 1/.test(ev) && (await eq()).weapon.join() === "1,1,0", `the taken spear deposits again: "${ev}"`);
ev = await deposit({ itemId: helm.id });
result(/tier 3 armour: 1/.test(ev) && (await eq()).armour.join() === "2,1,1", `the taken helm deposits again: "${ev}"`);

// 6b. Special weapons: boosted a tier (cap 3), the stock counter at that tier moves by exactly 1; a deposited relic
// is no longer owned, so it can drop again (grantRelic offers it again).
const delta = (a, b) => [0, 1, 2].map((k) => b.weapon[k] - a.weapon[k]).join() + "|" + [0, 1, 2].map((k) => b.armour[k] - a.armour[k]).join();
let s0 = await eq();
ev = await deposit({ itemId: advW.id });
let s1 = await eq();
result(delta(s0, s1) === "0,1,0|0,0,0" && !(await pack()).some((i) => i.id === advW.id) && /Deposited Breaching axe to the armoury as a tier 2 weapon \(tier 2 weapons: \d+\)/.test(ev),
  `adventure axe (tier 1, special) -> tier 2: delta ${delta(s0, s1)}; "${ev}"`);
const blade = (await hook("grantRelic", { relicId: "swornOathblade" })).item;
result(!!blade && blade.tier === "relic", `granted ${blade?.name}`);
s0 = await eq();
ev = await deposit({ itemId: blade.id });
s1 = await eq();
result(delta(s0, s1) === "0,0,1|0,0,0" && !(await pack()).some((i) => i.id === blade.id) && /Deposited The Sworn Oathblade to the armoury as a tier 3 weapon \(tier 3 weapons: \d+\)/.test(ev),
  `relic Oathblade (power 70 -> base 3, capped) -> tier 3: delta ${delta(s0, s1)}; "${ev}"`);
const again = (await hook("grantRelic", { relicId: "swornOathblade" })).item;
result(!!again && again.relicId === "swornOathblade" && again.id !== blade.id, `after the deposit the Oathblade can be found again (${again?.id})`);
const tooth = (await hook("grantRelic", { relicId: "gunneTooth" })).item;
s0 = await eq();
ev = await deposit({ itemId: tooth.id });
s1 = await eq();
result(delta(s0, s1) === "0,0,1|0,0,0" && /as a tier 3 weapon/.test(ev), `relic Gunne's Tooth (power 65 -> base 2) +1 -> tier 3: delta ${delta(s0, s1)}; "${ev}"`);
// The boosted weapon comes back plain: Take tier 3 gives an ordinary tier-3 weapon.
send({ type: "takeFromArmoury", slot: "weapon", tier: 3, weaponKind: "axe" });
await sleep(150);
const plain3 = (await pack()).find((i) => i.slot === "weapon" && i.tier === 3 && i.kind === "axe");
result(!!plain3 && !plain3.relicId && !plain3.adventureTrait && plain3.stats.damagePct === 70 && Object.keys(plain3.stats).length === 1, `Take tier 3 after a relic deposit: plain ${plain3?.name} ${JSON.stringify(plain3?.stats)}`);
ev = await deposit({ itemId: plain3.id });
result(/as a tier 3 weapon/.test(ev), `the plain tier-3 axe goes back in as tier 3 (not boosted): "${ev}"`);

// 6c. Multi-select `itemIds`: mixed valid / invalid / duplicate / equipped / another player's ids, partial success,
// one aggregated toast; rate-limited per MESSAGE (a 10-item message is one).
const other = new WebSocket(`ws://localhost:${PORT}/?profile=gear-deposit-other`);
const oHook = new Map();
other.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "testHookResult") oHook.set(m.op, m); });
await new Promise((r) => other.on("open", r));
const theirs = plain("weapon", 1, { name: "Their sword" });
other.send(JSON.stringify({ type: "testHook", op: "packGear", item: theirs }));
for (let i = 0; i < 300 && !oHook.has("packGear"); i++) await sleep(10);
result(oHook.get("packGear")?.inventory?.some((i) => i.id === theirs.id), "the other player has their own sword");
const mA = plain("weapon", 1), mB = plain("weapon", 2), mC = plain("head", 1), mD = plain("legs", 1);
const mRelic = (await hook("grantRelic", { relicId: "morvainWhisper" })).item;
for (const it of [mA, mB, mC, mD]) await put(it);
const worn = (await hook("heroState")).profile.equipment.weapon;
s0 = await eq();
ev = await deposit({ itemIds: [mA.id, mB.id, mA.id, mC.id, mD.id, mRelic.id, "no-such", theirs.id, worn.id, mB.id] });
s1 = await eq();
inv = await pack();
result(delta(s0, s1) === "1,1,1|1,0,0" && ![mA, mB, mC, mRelic].some((x) => inv.some((i) => i.id === x.id)) && inv.some((i) => i.id === mD.id) && inv.some((i) => i.id === tome.id),
  `mixed itemIds: 4 deposited (duplicates once), delta ${delta(s0, s1)}; legs kept`);
result(new RegExp(`^Deposited 4 items to the armoury \\(tier 1 weapons: ${s1.weapon[0]}, tier 2 weapons: ${s1.weapon[1]}, tier 3 weapons: ${s1.weapon[2]}, tier 1 armour: ${s1.armour[0]}\\)\\. Skipped 4: Test legs T1: Leg armour`).test(ev), `aggregated toast: "${ev}"`);
oHook.delete("packGear");
other.send(JSON.stringify({ type: "testHook", op: "packGear" }));
for (let i = 0; i < 300 && !oHook.has("packGear"); i++) await sleep(10);
result(oHook.get("packGear")?.inventory?.some((i) => i.id === theirs.id) && (await hook("heroState")).profile.equipment.weapon?.id === worn.id, "another player's item and the equipped weapon were not touched");
other.close();
ev = await deposit({ itemIds: [worn.id] });
result(/^Nothing deposited\. Skipped 1: .+ is equipped: unequip it first/.test(ev), `only an equipped id: "${ev}"`);
ev = await deposit({ itemIds: ["no-such", theirs.id] });
result(/^Nothing deposited\. Skipped 2: an item is not in your pack/.test(ev), `ids not in the pack (incl. another player's): "${ev}"`);
const many = Array.from({ length: 41 }, (_, k) => `id-${k}`);
s0 = await eq();
ev = await deposit({ itemIds: [...many, mD.id] });
result(/Select at most 40 items/.test(ev) && JSON.stringify(await eq()) === JSON.stringify(s0), `42 unique ids refused: "${ev}"`);
ev = await deposit({ itemIds: [...Array(50).fill(mD.id)] });
result(/^Nothing deposited\. Skipped 1: Test legs T1/.test(ev), `50 copies of one id = 1 unique id: "${ev}"`);
const nM = c.events.length;
const invM = JSON.stringify(await pack());
await sleep(1100);
for (const m of [{ itemIds: [] }, { itemIds: "abc" }, { itemIds: [5] }, { itemIds: [null] }, { itemIds: [""] }, { itemIds: ["x".repeat(101)] }, { itemIds: { 0: "a" } }, { itemIds: Array(201).fill("a") }, { itemIds: null }]) send({ type: "depositGear", ...m });
await sleep(250);
result(c.events.length === nM && JSON.stringify(await pack()) === invM && JSON.stringify(await eq()) === JSON.stringify(s0), `malformed itemIds ignored (${since(nM) || "no events"})`);
// Per-message rate limit: 10 items in one message all go in.
await sleep(1100);
const ten = Array.from({ length: 10 }, (_, k) => plain(k % 2 ? "weapon" : "chest", 1 + (k % 3)));
for (const it of ten) await put(it);
s0 = await eq();
ev = await deposit({ itemIds: ten.map((x) => x.id) });
s1 = await eq();
const moved = [0, 1, 2].reduce((n, k) => n + s1.weapon[k] - s0.weapon[k] + s1.armour[k] - s0.armour[k], 0);
result(moved === 10 && /^Deposited 10 items to the armoury/.test(ev) && !/Slow down/.test(ev), `one 10-item message deposits all 10 (moved ${moved}); "${ev}"`);
// Away from a store: the multi-select is refused, nothing moves.
await hook("teleportPlayer", { x: px(far.x), y: px(far.y) });
const awayIt = plain("weapon", 2);
await put(awayIt);
s0 = await eq();
ev = await deposit({ itemIds: [awayIt.id] });
result(/Stand next to your Town Center/.test(ev) && (await pack()).some((i) => i.id === awayIt.id) && JSON.stringify(await eq()) === JSON.stringify(s0), `itemIds away from a store refused: "${ev}"`);
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
for (let i = 0; i < 40 && !c.life?.atStore; i++) await sleep(20);
ev = await deposit({ itemIds: [awayIt.id] });
result(/^Deposited Test weapon T\d+ to the armoury as a tier 2 weapon/.test(ev), `back at the store, a 1-item itemIds uses the single toast: "${ev}"`);

// 7. Save / load keeps the stock (current format).
const savedEq = JSON.stringify(await eq());
c.saves.length = 0;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 1000 && !c.saves.length; i++) await sleep(20);
const sres = c.saves[0];
await hook("setEquipment", { armour: [9, 9, 9], weapon: [9, 9, 9] });
c.saves.length = 0;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 1500 && !c.saves.length; i++) await sleep(20);
for (let i = 0; i < 500 && c.welcomes === w0; i++) await sleep(20);
await sleep(300);
send({ type: "pause", paused: true });
const loadedEq = JSON.stringify(await eq());
result(sres?.ok && c.saves[0]?.ok && loadedEq === savedEq, `save / load keeps the armoury stock (${savedEq} -> ${loadedEq})`);

// 8. Inside the Town Center's Great hall: the depositGear message works, and the hall chest panel offers it.
await hook("heroLife", { needs: false, pack: {} });
await ins({ variant: 0 });
const I = await ins({ enter: { tx: tc.x, ty: tc.y } });
const map = I.view?.map;
const chest = map?.props.find((q) => q.prop === "chest");
const spot = chest && [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [chest.x + dx, chest.y + dy]).find(([x, y]) => map.cells[y * map.w + x] !== "#" && !map.props.some((q) => q.x === x && q.y === y));
await ins({ at: { x: px(spot[0]), y: px(spot[1]) } });
const e1 = await eq();
const inHall = plain("weapon", 3);
await put(inHall);
ev = await deposit({ itemId: inHall.id });
result(/as a tier 3 weapon \(tier 3 weapons: \d+\)/.test(ev) && (await eq()).weapon[2] === e1.weapon[2] + 1, `depositGear inside the hall: "${ev}"`);
const hallA = plain("offhand", 2), hallB = plain("weapon", 1);
await put(hallA);
await put(hallB);
c.dialogue = null;
send({ type: "interact" });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
const dlg = () => c.dialogue?.dialogue;
const idx = (re) => dlg()?.choices.findIndex((x) => re.test(x.label)) ?? -1;
result(dlg()?.npc?.name === "Hall chest" && idx(/Deposit all plain gear \(2\) into the armoury/) >= 0 && idx(/Deposit Test weapon T1 \(goes in as a tier 1 weapon; you pick the kind when you take one\)/) >= 0,
  `hall chest panel offers gear: [${dlg()?.choices?.map((x) => x.label).join(" | ")}]`);
const e2 = await eq();
await hook("heroLife", { choice: idx(/Deposit all plain gear/) });
await sleep(100);
const e3 = await eq();
inv = await pack();
result(e3.weapon[0] === e2.weapon[0] + 1 && e3.armour[1] === e2.armour[1] + 1 && !inv.some((i) => i.id === hallA.id || i.id === hallB.id) && dlg()?.npc?.name === "Hall chest" && idx(/Deposit all plain gear/) < 0,
  `hall chest "Deposit all plain gear": weapons [${e2.weapon}] -> [${e3.weapon}], armour [${e2.armour}] -> [${e3.armour}]; panel refreshed without the gear rows`);
// 8b. The hall chest lists a special weapon at its boosted tier and asks before depositing it.
const hallRelic = (await hook("grantRelic", { relicId: "abbeyEmberstaff" })).item;
c.dialogue = null;
send({ type: "interact" });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
const relicRow = idx(/Deposit Abbey Emberstaff \(goes in as a tier 3 weapon \(special: \+1 tier\); it comes back as a plain weapon\)/);
result(relicRow >= 0, `hall chest lists the relic staff at its boosted tier: [${dlg()?.choices?.map((x) => x.label).join(" | ")}]`);
const e4 = await eq();
c.dialogue = null;
await hook("heroLife", { choice: relicRow });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
result(/comes back as a plain tier-3 weapon: its unique stats and relic status are lost/.test(c.dialogue?.dialogue?.text ?? "") && idx(/^Yes: deposit Abbey Emberstaff/) >= 0 && idx(/^No, keep it/) >= 0 && JSON.stringify(await eq()) === JSON.stringify(e4) && (await pack()).some((i) => i.id === hallRelic.id),
  `a special row asks first (nothing moved): "${c.dialogue?.dialogue?.text}" [${dlg()?.choices?.map((x) => x.label).join(" | ")}]`);
let pick = idx(/^No, keep it/);
c.dialogue = null;
await hook("heroLife", { choice: pick });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
result(idx(/Deposit Abbey Emberstaff/) >= 0 && (await pack()).some((i) => i.id === hallRelic.id), "No, keep it: back to the chest panel, relic kept");
await sleep(200);
pick = idx(/Deposit Abbey Emberstaff/);
c.dialogue = null;
await hook("heroLife", { choice: pick });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
pick = idx(/^Yes: deposit Abbey Emberstaff/);
c.dialogue = null;
await hook("heroLife", { choice: pick });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
const e5 = await eq();
result(delta(e4, e5) === "0,0,1|0,0,0" && !(await pack()).some((i) => i.id === hallRelic.id) && idx(/Deposit Abbey Emberstaff/) < 0, `Yes: the relic staff goes in as tier 3 (delta ${delta(e4, e5)})`);
await ins({ exit: true });

c.ws.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll gear-deposit checks passed");
process.exit(fails ? 1 : 0);
