// Scripted test: industry extras (ROADMAP "Industry extras — landed"; PLAN-agri-industry-winter-mines.md phase 6).
// Needs a private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80 and NOT
// COLONY_UNLOCK_ALL (scripts/run-tests.mjs gives all of that: `npm test -- industry-extra`). Checks: the Foundry's gates,
// bronze smelting (charcoal, coal), bronze tools (hero / worker speed) and bronze gear (soldiers with no iron piece wear
// it; an iron piece replaces it); COLONY_UNLOCK_ALL switches the effects off; save / load keeps it all.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, CopperMine: 153, TinMine: 154, Foundry: 159,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), saves: [], info: undefined };
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const send = (m) => ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (fn()) return true;
  return !!fn();
};
const hook = async (op, args = {}) => {
  c.hooks.delete(op);
  send({ type: "testHook", op, ...args });
  await until(() => c.hooks.has(op), 5000);
  return c.hooks.get(op);
};
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.snap = null;
    c.W = m.worldTilesX;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hooks.set(m.op, m);
  else if (m.type === "saveResult") c.saves.push(m);
  else if (m.type === "buildingInfo") c.info = m.info;
});
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await until(() => c.welcome && c.snap, 20000);
c.welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => c.welcome && c.snap, 30000);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("setCycleTick", { tick: 20 * 10 });
const tileAt = (x, y) => c.tiles[y * c.W + x];
const raw = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const evSince = (n) => c.events.slice(n).join(" | ");
const place = async (x, y, tile, want = tile, tries = want === tile ? 6 : 1) => {
  await tp(x - 1, y - 1);
  for (let i = 0; i < tries && tileAt(x, y) !== want; i++) {
    send({ type: "setTile", tileX: x, tileY: y, tile });
    await until(() => tileAt(x, y) === want, 400);
    if (tileAt(x, y) !== want && tries > 1) await ff(10);
  }
};
const tryPlace = async (x, y, tile) => {
  await tp(x - 1, y - 1);
  const n = c.events.length;
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await until(() => c.events.length > n, 1500);
};
const demolish = async (x, y) => {
  await tp(x - 1, y - 1);
  send({ type: "setTile", tileX: x, tileY: y, tile: T.Empty });
  await until(() => tileAt(x, y) === T.Empty, 1500);
  await ff(5);
};
const info = async (x, y) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  await until(() => c.info !== undefined, 3000);
  return c.info;
};
const prog = (args = {}) => hook("progression", args);
const total = async (id) => (await prog()).items[id] ?? 0;
const grades = async (id) => (await prog()).snapshot.items[id] ?? [0, 0, 0];
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const setStock = (s) => hook("setStock", { stock: s });
const setItems = (it, quality = 1) => prog({ items: it, quality });
const setExact = async (id, n) => setItems({ [id]: n - ((await prog()).items[id] ?? 0) });
const industry = (args = {}) => hook("industry", args);
const runUntil = async (done, rounds = 40, ticks = 40) => {
  for (let i = 0; i < rounds && !(await done()); i++) await ff(ticks);
  return done();
};
const staffed = (x, y, kind = "artisan") => runUntil(async () => { await sleep(80); return c.snap.colonists.some((u) => u.kind === kind && u.postX === x && u.postY === y); }, 30, 20);

const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 24 < c.W - 2 ? tc.x + 6 : tc.x - 30;
const by = Math.max(6, Math.min(c.W - 20, tc.y + 4));
const B = { x: bx, y: by };
for (let y = B.y - 4; y <= B.y + 13; y++) for (let x = B.x - 4; x <= B.x + 22; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await setStock({ wood: 3000, rock: 3000, iron: 500, grain: 500, meat: 200, fruit: 200, clothes: 20, tools: 20 });

// 1. locks in a new game
const s0 = (await prog()).snapshot;
const lk = (t) => JSON.stringify(s0.locked[t] ?? []);
result((s0.locked[T.Foundry] ?? []).includes("Crucible") && (s0.locked[T.Foundry] ?? []).includes("a Copper Mine"), `locks: Foundry ${lk(T.Foundry)}`);

// 2. the Foundry: a crucible and a Copper Mine
const FO = { x: B.x + 1, y: B.y + 1 };
let ev = c.events.length;
await tryPlace(FO.x, FO.y, T.Foundry);
result(tileAt(FO.x, FO.y) === T.Empty && /Foundry needs: Crucible, a Copper Mine/.test(evSince(ev)), `Foundry locked: ${evSince(ev)}`);
await setExact("crucible", 1);
await raw(B.x + 20, B.y + 1, T.CopperMine);
await place(FO.x, FO.y, T.Foundry);
result(tileAt(FO.x, FO.y) === T.Foundry, "Foundry built with a crucible in store and a Copper Mine standing");

// 3. bronze: copper + tin + charcoal, then tools first, then weapons / armour; coal when there is no charcoal
for (const id of ["bronze", "bronzeTools", "bronzeWeapon", "bronzeArmour"]) await setExact(id, 0);
await setExact("copperOre", 6);
await setExact("tinOre", 4);
await setExact("charcoal", 2);
await setExact("coal", 0);
await staffed(FO.x, FO.y);
await runUntil(async () => (await total("bronzeTools")) >= 1 && (await total("bronzeWeapon")) >= 1);
let it = (await prog()).items;
result(it.bronzeTools === 1 && it.bronzeWeapon === 1 && (it.copperOre ?? 0) === 0 && (it.tinOre ?? 0) === 0 && (it.charcoal ?? 0) === 0 && (it.bronze ?? 0) === 0,
  `2 smelts (6 copper, 4 tin, 2 charcoal -> 4 bronze) cast 1 bronze tools then 1 bronze weapon: ${JSON.stringify({ t: it.bronzeTools, w: it.bronzeWeapon, cu: it.copperOre, sn: it.tinOre, ch: it.charcoal, b: it.bronze })}`);
await setExact("copperOre", 3);
await setExact("tinOre", 2);
await setExact("coal", 1);
await setExact("hide", 1);
await setExact("bronze", 1);
await setExact("bronzeWeapon", 10); // at its cap: the founder casts armour next
await runUntil(async () => (await total("bronzeArmour")) >= 1);
it = (await prog()).items;
await setExact("bronzeWeapon", 1);
result(it.bronzeArmour === 1 && (it.coal ?? 0) === 0 && (it.hide ?? 0) === 0 && (it.bronze ?? 0) === 0, `coal smelts bronze; 3 bronze + 1 hide cast bronze armour: ${JSON.stringify({ a: it.bronzeArmour, coal: it.coal, hide: it.hide, b: it.bronze })}`);
const foInfo = await info(FO.x, FO.y);
result((foInfo.progression ?? []).some((l) => /Founder L1/.test(l)), `the founder trains: ${JSON.stringify(foInfo.progression)}`);

// 4. bronze tools: x1.2 for the hero, woodcutters and miners (not smiths); none in store, x1
let ind = await industry();
result(ind.tools.hero === 1.2 && ind.tools.miner === 1.2 && ind.tools.woodcutter === 1.2 && ind.tools.smith === 1, `bronze tools in store: ${JSON.stringify(ind.tools)}`);
await setExact("bronzeTools", 0);
ind = await industry();
result(ind.tools.hero === 1 && ind.tools.miner === 1, `no bronze tools: ${JSON.stringify(ind.tools)}`);
await setExact("bronzeTools", 1);
await demolish(FO.x, FO.y);

// 5. bronze gear: a soldier with no iron piece wears bronze; an iron piece (gear pickup) replaces it, the bronze goes back
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
await setExact("bronzeWeapon", 1);
await setExact("bronzeArmour", 1);
const SP = { x: B.x + 10, y: B.y + 8 };
const knightId = (await hook("spawnSoldier", { kind: "knight", x: SP.x * TILE + 16, y: SP.y * TILE + 16 })).id;
ind = await industry({ unit: knightId });
it = (await prog()).items;
result(ind.unit?.bronzeWeapon && ind.unit?.bronzeArmour && ind.unit.weapon === 1.1 && ind.unit.armour === 0.92 && (it.bronzeWeapon ?? 0) === 0 && (it.bronzeArmour ?? 0) === 0,
  `a knight musters in bronze (none iron in stock): ${JSON.stringify(ind.unit)}; stores weapon ${it.bronzeWeapon ?? 0} armour ${it.bronzeArmour ?? 0}`);
const knight2 = (await hook("spawnSoldier", { kind: "knight", x: (SP.x + 2) * TILE + 16, y: SP.y * TILE + 16 })).id;
ind = await industry({ unit: knight2 });
result(!ind.unit?.bronzeWeapon && ind.unit.weapon === 1 && ind.unit.armour === 1, `a second knight finds no bronze left: ${JSON.stringify(ind.unit)}`);
await setExact("bronzeWeapon", 1);
await runUntil(async () => (await industry({ unit: knight2 })).unit?.bronzeWeapon === true, 6, 20 * 3);
ind = await industry({ unit: knight2 });
result(ind.unit?.bronzeWeapon === true && ind.unit.weapon === 1.1 && (await total("bronzeWeapon")) === 0, `an idle unarmed knight picks up bronze from the stores: ${JSON.stringify(ind.unit)}`);
await hook("setEquipment", { armour: [2, 0, 0], weapon: [0, 0, 0] });
await ff(20 * 3 + 2);
const eq = await hook("equipState");
const k1 = eq.units.find((u) => u.id === knightId);
it = (await prog()).items;
result(k1?.armourTier === 1 && k1.bronzeArmour === false && it.bronzeArmour === 1, `an iron T1 cuirass replaces the bronze armour, which goes back to the stores: ${JSON.stringify(k1)}; stores ${it.bronzeArmour}`);

// 6. COLONY_UNLOCK_ALL: the effects are off (older suites)
await prog({ unlockAll: true });
ind = await industry({ unit: knight2 });
const offTools = ind.tools.hero === 1 && ind.tools.miner === 1;
const k3 = (await hook("spawnSoldier", { kind: "knight", x: (SP.x + 4) * TILE + 16, y: SP.y * TILE + 16 })).id;
await setExact("bronzeWeapon", 1);
const ind3 = await industry({ unit: k3 });
await prog({ unlockAll: false });
result(offTools && !ind3.unit?.bronzeWeapon && !ind3.unit?.bronzeArmour, `COLONY_UNLOCK_ALL: bronze tools x${ind.tools.hero}, a new knight takes no bronze: ${JSON.stringify(ind3.unit)}`);

// 7. save / load
const before = (await prog()).items;
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await prog({ reset: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
await sleep(300);
const after = await prog();
ind = await industry({ unit: knight2 });
result(["bronze", "bronzeTools", "bronzeWeapon", "bronzeArmour", "copperOre", "crucible"].every((id) => after.items[id] === before[id]) && after.unlocked.includes(T.Foundry),
  `items and unlocks survive: ${JSON.stringify(after.items)}`);
result(ind.unit?.bronzeWeapon === true && ind.unit.weapon === 1.1, `a knight's bronze weapon survives: ${JSON.stringify(ind.unit)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
