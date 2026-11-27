// Scripted test: Interior fixes 2026-11-27, `depositGear` (plain tiered pack gear into the colony armoury stock).
// Weapons -> state.equipment.weapon[tier-1], helms / breastplates / shields -> armour[tier-1], the item leaves the pack;
// equipped pieces, relics, adventure gear, tomes and leg armour are refused; away from any own store refused; malformed
// messages ignored; `all` deposits every eligible piece and keeps the rest; round trip (deposit then the armoury Take
// gives back a plain piece of that tier); the stock survives save / load; the Town Center hall chest offers it.
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
result(E.weapon.join() === "0,1,0" && !inv.some((i) => i.id === spear.id) && /Deposited Test weapon T2 to the armoury \(tier 2 weapons: 1\)/.test(ev), `tier-2 weapon -> weapon stock [${E.weapon}], gone from the pack; "${ev}"`);
for (const [slot, tier, want] of [["head", 1, "1,0,0"], ["chest", 3, "1,0,1"], ["offhand", 1, "2,0,1"]]) {
  const it = plain(slot, tier);
  await put(it);
  ev = await deposit({ itemId: it.id });
  E = await eq();
  inv = await pack();
  result(E.armour.join() === want && !inv.some((i) => i.id === it.id) && /armour:/.test(ev), `${slot} T${tier} -> armour stock [${E.armour}] (want ${want}); "${ev}"`);
}

// 2. Refusals: equipped, relic, adventure gear, tome, leg armour; nothing moves.
const before = JSON.stringify(await eq());
const hs = await hook("heroState");
const equipped = hs.profile.equipment.weapon;
ev = await deposit({ itemId: equipped?.id });
result(!!equipped && /Unequip that first to deposit it in the armoury/.test(ev) && JSON.stringify(await eq()) === before, `equipped weapon (${equipped?.name}) refused: "${ev}"`);
const relic = (await hook("grantRelic", { relicId: "swornOathblade" })).item;
ev = await deposit({ itemId: relic?.id });
result(!!relic && /Relics and special gear can't go into the armoury: keep or drop them/.test(ev) && (await pack()).some((i) => i.id === relic.id), `relic (${relic?.name}) refused and kept: "${ev}"`);
const adv = plain("weapon", 1, { adventureTrait: "breach", name: "Breaching Axe" });
await put(adv);
ev = await deposit({ itemId: adv.id });
result(/Relics and special gear/.test(ev) && (await pack()).some((i) => i.id === adv.id), `adventure gear refused and kept: "${ev}"`);
const tome = (await hook("grantTome", {})).item;
ev = await deposit({ itemId: tome?.id });
result(!!tome && /Relics and special gear/.test(ev) && (await pack()).some((i) => i.id === tome.id), `spell tome refused and kept: "${ev}"`);
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

// 5. `all` next to the Town Center: every plain piece goes, the relic / adventure gear / tome / legs stay.
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
await put(plain("chest", 2));
ev = await deposit({ all: true });
E = await eq();
inv = await pack();
const left = inv.map((i) => i.id).sort().join();
const keep = [relic.id, adv.id, tome.id, legs.id].sort().join();
result(E.weapon.join() === "1,1,0" && E.armour.join() === "2,1,1" && left === keep && /Deposited 2 pieces of gear to the armoury/.test(ev), `deposit all: weapons [${E.weapon}], armour [${E.armour}], pack keeps only the special pieces (${inv.map((i) => i.name).join(", ")}); "${ev}"`);
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
result(/tier 3 weapons: 1/.test(ev) && (await eq()).weapon[2] === e1.weapon[2] + 1, `depositGear inside the hall: "${ev}"`);
const hallA = plain("offhand", 2), hallB = plain("weapon", 1);
await put(hallA);
await put(hallB);
c.dialogue = null;
send({ type: "interact" });
for (let i = 0; i < 100 && !c.dialogue; i++) await sleep(10);
const dlg = () => c.dialogue?.dialogue;
const idx = (re) => dlg()?.choices.findIndex((x) => re.test(x.label)) ?? -1;
result(dlg()?.npc?.name === "Hall chest" && idx(/Deposit all plain gear \(2\) into the armoury/) >= 0 && idx(/Deposit Test weapon T1 \(goes in as a tier-1 weapon; you pick the kind when you take one\)/) >= 0,
  `hall chest panel offers gear: [${dlg()?.choices?.map((x) => x.label).join(" | ")}]`);
const e2 = await eq();
await hook("heroLife", { choice: idx(/Deposit all plain gear/) });
await sleep(100);
const e3 = await eq();
inv = await pack();
result(e3.weapon[0] === e2.weapon[0] + 1 && e3.armour[1] === e2.armour[1] + 1 && !inv.some((i) => i.id === hallA.id || i.id === hallB.id) && dlg()?.npc?.name === "Hall chest" && idx(/Deposit all plain gear/) < 0,
  `hall chest "Deposit all plain gear": weapons [${e2.weapon}] -> [${e3.weapon}], armour [${e2.armour}] -> [${e3.armour}]; panel refreshed without the gear rows`);
await ins({ exit: true });

c.ws.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll gear-deposit checks passed");
process.exit(fails ? 1 : 0);
