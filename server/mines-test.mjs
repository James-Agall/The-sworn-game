// Scripted test: deep mines (ROADMAP "Deep mines — landed"; PLAN-agri-industry-winter-mines.md phase 3). Needs a
// private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80 and NOT COLONY_UNLOCK_ALL
// (scripts/run-tests.mjs gives all of that: `npm test -- mines`). Checks: coal / copper / tin deposits at world gen
// (veins, minimap markers via tiles); the new mines' gates and deposits (a Coal Mine only on a coal seam, demolished
// back to it; copper / tin need an Iron Mine), their miners dig coal / copper ore / tin ore; coal smelts iron blooms
// in the Bloomery without charcoal; every mine is an enterable interior (layout = depth); digging a shaft deeper can
// break into a nest (infested: monsters inside, miners flee, no production, panel status); inside, the hero fights:
// the monsters bite (indoor damage), the hero's swings kill them, loot (ore, bones, gems, gold), cleared -> the miners
// work again; a fallen hero is put back outside; soldiers sent in clear a mine; deep shafts: re-infestation at dawn
// (a miner killed; a Mine Foreman saves them; a cleared mine's grace; a soldier nearby guards it; lamps / props /
// foreman lower the odds), hazards (props wear out -> cave-in; no vent -> bad air; no pump -> flood); the level-3 gate
// (vent + pump); save / load keeps mines, monsters and deposits.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, IronOre: 7, Rock: 8, IronMine: 9, Quarry: 10, Blacksmith: 26, Bloomery: 101,
  CoalSeam: 149, CopperOre: 150, TinOre: 151, CoalMine: 152, CopperMine: 153, TinMine: 154,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), saves: [], info: undefined, mobs: null, view: undefined };
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const send = (m) => ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (await fn()) return true;
  return !!(await fn());
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
  else if (m.type === "interiorMobs") c.mobs = m;
  else if (m.type === "interior") c.view = m.view;
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
const info = async (x, y) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  await until(() => c.info !== undefined, 3000);
  return c.info;
};
const prog = (args = {}) => hook("progression", args);
const total = async (id) => (await prog()).items[id] ?? 0;
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const setItems = (it, quality = 1) => prog({ items: it, quality });
const setExact = async (id, n) => setItems({ [id]: n - ((await prog()).items[id] ?? 0) });
const runUntil = async (done, rounds = 40, ticks = 40) => {
  for (let i = 0; i < rounds && !(await done()); i++) await ff(ticks);
  return done();
};
const mine = (m, args = {}) => hook("mine", { tx: m.x, ty: m.y, ...args });
const workersAt = async (m) => (await hook("workState", {})).people.filter((p) => p.postX === m.x && p.postY === m.y);
const staffed = (m) => runUntil(async () => (await workersAt(m)).length > 0, 40, 20);
const me = () => c.snap.players.find((p) => p.id === c.welcome.id);
const interior = (args = {}) => hook("interior", args);

// 0. deposits at world gen (a fresh W80 world): veins of coal, copper and tin, off the start
const count = (t) => c.tiles.filter((x) => x === t).length;
result(count(T.CoalSeam) >= 2 && count(T.CopperOre) >= 2 && count(T.TinOre) >= 2,
  `world gen scatters deposits: coal ${count(T.CoalSeam)}, copper ${count(T.CopperOre)}, tin ${count(T.TinOre)} tiles`);

const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 24 < c.W - 2 ? tc.x + 6 : tc.x - 30;
const by = Math.max(6, Math.min(c.W - 20, tc.y + 4));
const B = { x: bx, y: by };
for (let y = B.y - 4; y <= B.y + 13; y++) for (let x = B.x - 4; x <= B.x + 22; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await hook("setStock", { stock: { wood: 3000, rock: 3000, iron: 800, grain: 800, meat: 80, fruit: 80, clothes: 20, tools: 20, gold: 100 } });
await hook("peopleState", { spawn: 12 });

// 1. gates: a Coal Mine needs only the pick; copper / tin an Iron Mine; a deep shaft a vent and a pump
const s0 = (await prog()).snapshot;
result(!s0.locked[T.CoalMine] && (s0.locked[T.CopperMine] ?? []).includes("an Iron Mine") && (s0.locked[T.TinMine] ?? []).includes("an Iron Mine"),
  `locks: Coal Mine ${JSON.stringify(s0.locked[T.CoalMine])}, Copper ${JSON.stringify(s0.locked[T.CopperMine])}, Tin ${JSON.stringify(s0.locked[T.TinMine])}`);
result(["mineLamps", "mineVent", "minePump"].every((id) => s0.crafts.some((r) => r.id === id)), "hand recipes: miner's lamps, air vent, bucket pump");

// 2. a Coal Mine only on a coal seam; demolished, the seam comes back; its miner digs coal
const COAL = { x: B.x + 3, y: B.y + 3 };
let ev = c.events.length;
await place(COAL.x, COAL.y, T.CoalMine, T.CoalMine, 1);
await until(() => c.events.length > ev, 1500);
result(tileAt(COAL.x, COAL.y) === T.Empty && /must be sunk on a coal seam/.test(evSince(ev)), `bare ground refused: ${evSince(ev)}`);
await raw(COAL.x, COAL.y, T.CoalSeam);
await place(COAL.x, COAL.y, T.CoalMine);
result(tileAt(COAL.x, COAL.y) === T.CoalMine, "Coal Mine sunk on a coal seam");
await place(COAL.x, COAL.y, T.Empty, T.CoalSeam);
result(tileAt(COAL.x, COAL.y) === T.CoalSeam, `demolished, the seam is back: ${tileAt(COAL.x, COAL.y)}`);
await place(COAL.x, COAL.y, T.CoalMine);
await staffed(COAL);
const coal0 = await total("coal");
await runUntil(async () => (await total("coal")) >= coal0 + 4);
const coalInfo = await info(COAL.x, COAL.y);
result((await total("coal")) >= coal0 + 4 && (coalInfo.progression ?? []).some((l) => /Miner L1/.test(l)) && (coalInfo.progression ?? []).some((l) => /Deposit:/.test(l)),
  `the miner digs coal (${await total("coal")}); panel ${JSON.stringify(coalInfo.progression)}`);
result(coalInfo.mine?.status === "clear" && /surface adit/.test(coalInfo.mine.lines.join(" ")), `level-1 mine is clear: ${JSON.stringify(coalInfo.mine)}`);

// 3. enterable: E at the door (an interior "mine", layout = depth)
await tp(COAL.x, COAL.y + 1);
let I = await interior({ enter: { tx: COAL.x, ty: COAL.y } });
result(I.why === "" && I.inside?.templateId === "mine" && I.inside.variant === 0 && I.view?.mine?.status === "clear" && /coal mine/.test(I.view.title) && I.templateErrors.length === 0,
  `enter the coal mine: ${I.why} ${I.inside?.templateId} v${I.inside?.variant} "${I.view?.title}" ${JSON.stringify(I.view?.mine)} errors ${I.templateErrors.length}`);
const npcs1 = I.view?.npcs ?? [];
result(npcs1.some((n) => n.act === "keeper"), `its miner works the face inside: ${npcs1.map((n) => n.name + ":" + n.act).join(", ")}`);
await interior({ exit: true });

// 4. digging deeper breaks into a nest (roll forced): infested, miners flee, nothing dug
await setItems({ timberProps: 6 });
await prog({ xpAt: { x: COAL.x, y: COAL.y, xp: 120 } });
await mine(COAL, { roll: 0, sync: true });
ev = c.events.length;
send({ type: "upgradeBuilding", tileX: COAL.x, tileY: COAL.y });
await sleep(300);
await ff(25);
let M = await mine(COAL, { sync: true });
const dug = M.mine;
result(dug?.level === 2 && dug.status === "infested" && dug.mobs.length >= 3 && dug.mobs.length <= 4 && dug.mobs.every((m) => ["caveSpider", "caveBat", "skeleton"].includes(m.kind)),
  `shaft dug (level ${dug?.level}): ${dug?.status}, ${dug?.mobs.map((m) => m.kind).join(", ")}`);
result(/broke into a nest/.test(evSince(ev)) && dug?.workMult === 0, `event and production stopped: ${evSince(ev)}; workMult ${dug?.workMult}`);
await mine(COAL, { roll: null });
const coalStuck = await total("coal");
await ff(300);
const w = (await workersAt(COAL))[0];
result((await total("coal")) === coalStuck, `an infested mine yields nothing: coal ${coalStuck} -> ${await total("coal")}`);
result(!!w && Math.hypot(w.x / TILE - 0.5 - COAL.x, w.y / TILE - 0.5 - COAL.y) > 1.5 && w.state !== "crafting",
  `its miner fled: ${w ? `${(w.x / TILE).toFixed(1)},${(w.y / TILE).toFixed(1)} ${w.state}` : "none"} (post ${COAL.x},${COAL.y})`);
const inf = await info(COAL.x, COAL.y);
result(inf.mine?.status === "infested" && /Infested: \d monsters? inside/.test(inf.mine.lines[0]) && inf.mine.assault.reason === "No soldiers within 12 tiles",
  `panel: ${JSON.stringify(inf.mine)}`);

// 5. inside the infested mine: no miners, the monsters (stand-ins) sleep at their lairs; a controlled encounter
await mine(COAL, { infest: ["caveSpider", "caveBat", "skeleton"] });
await tp(COAL.x, COAL.y + 1);
c.mobs = null;
I = await interior({ enter: { tx: COAL.x, ty: COAL.y } });
await ff(6);
await until(() => c.mobs && c.mobs.mobs.length === 3, 2000);
result(I.why === "" && I.inside?.variant === 1 && I.view?.mine?.status === "infested" && !(I.view?.npcs ?? []).some((n) => n.act === "keeper"),
  `entered the infested shaft (v${I.inside?.variant}): ${JSON.stringify(I.view?.mine)}, npcs ${(I.view?.npcs ?? []).length}`);
result(c.mobs?.key === `${COAL.x},${COAL.y}` && c.mobs.mobs.length === 3 && c.mobs.mobs.every((m) => m.act === "sleep"),
  `interiorMobs: ${JSON.stringify(c.mobs?.mobs.map((m) => `${m.kind}:${m.act}@${m.x},${m.y}`))}`);

// 6. the monsters bite (damage indoors), the hero's swings kill them; loot; cleared -> back to work
const heroAt = async () => {
  const d = await interior({});
  return { x: d.inside.x / TILE - 0.5, y: d.inside.y / TILE - 0.5 };
};
let h = await heroAt();
await mine(COAL, { place: { i: 0, x: h.x + 0.6, y: h.y }, wakeAll: false });
const hp0 = me().hp;
await ff(60);
await sleep(100);
const hp1 = me().hp;
result(hp1 < hp0, `a monster woke and bit the hero indoors: hp ${hp0} -> ${hp1}`);
const loot0 = { bones: await total("bones"), gems: await total("gems"), coal: await total("coal"), gold: (await stock()).gold };
await mine(COAL, { roll: 0 });
for (let guard = 0; guard < 80; guard++) {
  M = await mine(COAL);
  if (!M.mine || M.mine.status !== "infested") break;
  h = await heroAt();
  await mine(COAL, { place: { i: 0, x: h.x + 0.9, y: h.y } });
  send({ type: "attack" });
  await sleep(30);
  await ff(11);
}
await mine(COAL, { roll: null });
M = await mine(COAL);
const loot1 = { bones: await total("bones"), gems: await total("gems"), coal: await total("coal"), gold: (await stock()).gold };
result(M.mine?.status === "cleared" && M.mine.mobs.length === 0 && /cleared by you/.test(c.events.join(" | ")), `the hero cleared the mine: ${M.mine?.status}`);
result(loot1.coal >= loot0.coal + 6 && loot1.bones >= loot0.bones + 3 && loot1.gems >= loot0.gems + 3 && loot1.gold >= loot0.gold + 20,
  `loot: ${JSON.stringify(loot0)} -> ${JSON.stringify(loot1)}`);
await ff(6);
I = await interior({});
result(I.view?.mine?.status === "cleared", `the view says cleared: ${JSON.stringify(I.view?.mine)}`);
await interior({ exit: true });
const coalBack = await total("coal");
await runUntil(async () => (await total("coal")) > coalBack, 30, 40);
result((await total("coal")) > coalBack && (await mine(COAL)).mine.workMult === 1, `the miners dig again: coal ${coalBack} -> ${await total("coal")}`);

// 7. a hero who falls in a mine is put back outside (legacy respawn: at a Town Center)
await mine(COAL, { infest: ["skeleton", "skeleton"] });
await hook("damagePlayer", { amount: me().hp - 3 });
await tp(COAL.x, COAL.y + 1);
I = await interior({ enter: { tx: COAL.x, ty: COAL.y } });
h = await heroAt();
await mine(COAL, { place: { i: 0, x: h.x + 0.5, y: h.y }, wakeAll: true });
await ff(80);
I = await interior({});
await sleep(100);
result(I.inside === null && !me().dead, `fallen in the mine: back outside (inside ${JSON.stringify(I.inside)}, hp ${me().hp})`);

// 8. soldiers sent in clear a mine (some may fall)
await hook("spawnSoldier", { kind: "knight", x: (COAL.x + 2) * TILE + 16, y: (COAL.y + 2) * TILE + 16 });
await hook("spawnSoldier", { kind: "knight", x: (COAL.x + 3) * TILE + 16, y: (COAL.y + 2) * TILE + 16 });
const ainf = await info(COAL.x, COAL.y);
ev = c.events.length;
send({ type: "mineAssault", tileX: COAL.x, tileY: COAL.y });
await until(() => c.events.length > ev, 2000);
M = await mine(COAL);
result(ainf.mine?.assault.soldiers === 2 && ainf.mine.assault.reason === "" && M.mine?.status === "cleared" && /soldiers? cleared the Coal Mine/.test(evSince(ev)),
  `soldiers sent in: ${JSON.stringify(ainf.mine?.assault)} -> ${M.mine?.status}: ${evSince(ev)}`);

// 9. a deep shaft (level 3) needs an air vent and a bucket pump in store (and a Blacksmith)
await raw(B.x + 15, B.y + 10, T.Blacksmith);
await prog({ xpAt: { x: COAL.x, y: COAL.y, xp: 320 } });
await mine(COAL, { roll: 0.99 });
ev = c.events.length;
send({ type: "upgradeBuilding", tileX: COAL.x, tileY: COAL.y });
await sleep(300);
await ff(5);
const refused3 = evSince(ev);
const lvlA = (await info(COAL.x, COAL.y)).level;
send({ type: "craftItem", recipe: "mineVent" });
send({ type: "craftItem", recipe: "carpenterTools" });
await sleep(150);
send({ type: "craftItem", recipe: "minePump" });
await sleep(200);
send({ type: "upgradeBuilding", tileX: COAL.x, tileY: COAL.y });
await sleep(300);
await ff(25);
M = await mine(COAL, { sync: true });
result(lvlA === 2 && /Air vent|Bucket pump/.test(refused3) && M.mine?.level === 3 && M.mine.status !== "infested",
  `level 3 waits on the vent and pump (${refused3}), then goes deep: level ${M.mine?.level}, ${M.mine?.status}`);

// 10. re-infestation of the deep shaft at dawn: a miner killed without a foreman (the knights from 8 would guard it)
await hook("killColonists", { kind: "knight" });
await staffed(COAL);
await prog({ xpAt: { x: COAL.x, y: COAL.y, xp: 0 } });
const day = M.day;
const minersBefore = (await workersAt(COAL)).length;
ev = c.events.length;
M = await mine(COAL, { roll: 0, set: { status: "clear", rollDay: day - 5, propsDay: day, clearedDay: day - 10 }, dawn: true });
const minersAfter = (await workersAt(COAL)).length;
result(M.mine?.status === "infested" && minersBefore >= 1 && minersAfter === minersBefore - 1 && /crawled back into the deep Coal Mine: 1 miner killed/.test(evSince(ev)),
  `nest returned: ${M.mine?.status}, miners ${minersBefore} -> ${minersAfter}: ${evSince(ev)}`);
// Cleared: a grace period with no roll.
M = await mine(COAL, { clear: true });
M = await mine(COAL, { set: { rollDay: day - 5 }, dawn: true });
result(M.mine?.status === "cleared", `a cleared mine has a grace period: ${M.mine?.status}`);
// A Mine Foreman (level-3 miner) gets the miners out alive.
await staffed(COAL);
await prog({ xpAt: { x: COAL.x, y: COAL.y, xp: 700 } });
const fBefore = (await workersAt(COAL)).length;
ev = c.events.length;
M = await mine(COAL, { set: { clearedDay: day - 10, rollDay: day - 5 }, dawn: true });
result(M.mine?.status === "infested" && M.mine.foreman && (await workersAt(COAL)).length === fBefore && /Mine Foreman got the miners out/.test(evSince(ev)),
  `with a foreman nobody dies: ${M.mine?.status}, miners ${fBefore} -> ${(await workersAt(COAL)).length}: ${evSince(ev)}`);
// Odds: lamps, props and the foreman lower them.
await mine(COAL, { clear: true });
await setExact("mineLamps", 1);
await setExact("timberProps", 3);
M = await mine(COAL);
result(Math.abs(M.mine.chance - 0.4 * 0.5 * 0.6 * 0.5) < 1e-9 && M.mine.info.lines.some((l) => /nests may return \(6%/.test(l)),
  `lit + propped + foreman: chance ${M.mine.chance} ${JSON.stringify(M.mine.info.lines)}`);
// A soldier within 6 tiles guards it: no roll.
await hook("spawnSoldier", { kind: "militia", x: (COAL.x + 1) * TILE + 16, y: (COAL.y + 2) * TILE + 16 });
M = await mine(COAL, { set: { clearedDay: day - 10, rollDay: day - 5 }, dawn: true });
result(M.mine?.status === "clear" && M.mine.guarded, `guarded by a soldier: ${M.mine?.status} guarded ${M.mine?.guarded}`);

// 11. hazards: props wear out (taken from store; none left: cave-in), bad air without a vent, flood without a pump
const props0 = await total("timberProps");
M = await mine(COAL, { roll: 0.99, set: { propsDay: day - 5 }, dawn: true });
result((await total("timberProps")) === props0 - 1 && !M.mine.unpropped, `a worked shaft wears out a prop: ${props0} -> ${await total("timberProps")}`);
await setExact("timberProps", 0);
ev = c.events.length;
M = await mine(COAL, { roll: 0, set: { propsDay: day - 5 }, dawn: true });
result(M.mine.unpropped && M.mine.closedDay === M.day && M.mine.workMult === 0 && /Cave-in at the Coal Mine/.test(evSince(ev)),
  `no props left: cave-in, closed today (${evSince(ev)})`);
await setExact("mineVent", 0);
M = await mine(COAL, { roll: 0.99, set: { closedDay: -1 } });
result(M.mine.workMult === 0.5 && M.mine.info.lines.some((l) => /Bad air/.test(l)), `no air vent: bad air, x${M.mine.workMult}`);
await setExact("minePump", 0);
ev = c.events.length;
M = await mine(COAL, { roll: 0, set: { closedDay: -1, propsDay: day + 100, unpropped: false }, dawn: true });
result(M.mine.closedDay === M.day && M.mine.closedWhy === "flood" && /flooded/.test(evSince(ev)), `no pump: flooded (${M.mine.closedWhy}) ${evSince(ev)}`);
await mine(COAL, { roll: null, set: { closedDay: -1, unpropped: false } });
await setItems({ mineVent: 1, minePump: 1, timberProps: 4 });

// 12. coal smelts iron in the Bloomery without charcoal
await prog({ unlockAll: true });
const BLOOM = { x: B.x + 8, y: B.y + 1 };
await place(BLOOM.x, BLOOM.y, T.Bloomery);
await staffed(BLOOM);
await prog({ unlockAll: false });
await setExact("charcoal", 0);
await setItems({ coal: 10 });
const bloom0 = await total("ironBloom");
await runUntil(async () => (await total("ironBloom")) > bloom0, 40, 40);
result((await total("ironBloom")) > bloom0 && (await total("charcoal")) === 0, `a bloom smelted with coal (no charcoal in store): blooms ${bloom0} -> ${await total("ironBloom")}`);

// 13. copper and tin: an Iron Mine first, then the mines on their ores
const IRON = { x: B.x + 12, y: B.y + 3 };
await raw(IRON.x, IRON.y, T.IronOre);
await place(IRON.x, IRON.y, T.IronMine);
const CU = { x: B.x + 14, y: B.y + 6 };
const SN = { x: B.x + 17, y: B.y + 6 };
await raw(CU.x, CU.y, T.CopperOre);
await raw(SN.x, SN.y, T.TinOre);
await place(CU.x, CU.y, T.CopperMine);
await place(SN.x, SN.y, T.TinMine);
result(tileAt(IRON.x, IRON.y) === T.IronMine && tileAt(CU.x, CU.y) === T.CopperMine && tileAt(SN.x, SN.y) === T.TinMine, "Iron Mine, then the Copper and Tin Mines on their ores");
await staffed(CU);
await staffed(SN);
await runUntil(async () => (await total("copperOre")) >= 2 && (await total("tinOre")) >= 1, 40, 40);
result((await total("copperOre")) >= 2 && (await total("tinOre")) >= 1, `copper ore ${await total("copperOre")}, tin ore ${await total("tinOre")}`);
// Every mine (the Quarry / Iron Mine too) has a record and a way in.
M = await mine(IRON, { sync: true });
result(M.mine?.status === "clear" && M.all.length >= 4, `mine records: ${JSON.stringify(M.all)}`);

// 14. prospecting counts the new deposits
ev = c.events.length;
send({ type: "craftItem", recipe: "stoneKnife" });
await sleep(150);
send({ type: "prospect" });
await sleep(200);
await ff(40);
await until(() => /Prospector's report/.test(evSince(ev)), 2000);
const cInfo = await info(COAL.x, COAL.y);
result(/Prospector's report/.test(evSince(ev)) && (cInfo.progression ?? []).some((l) => /Deposit: (poor|fair|rich)/.test(l)), `prospected: ${(cInfo.progression ?? []).find((l) => /Deposit/.test(l))}`);

// 15. save / load keeps mines (status, monsters), deposits and the new items
await mine(COAL, { infest: ["caveSpider", "giantSpider"] });
const before = (await prog()).items;
const coalSeams = count(T.CoalSeam);
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await mine(COAL, { clear: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
await sleep(300);
M = await mine(COAL);
const after = (await prog()).items;
result(M.mine?.status === "infested" && M.mine.level === 3 && M.mine.mobs.map((m) => m.kind).sort().join() === "caveSpider,giantSpider" && tileAt(COAL.x, COAL.y) === T.CoalMine,
  `mine survives save/load: ${M.mine?.status} level ${M.mine?.level} ${M.mine?.mobs.map((m) => m.kind)}`);
// (Ores: at least as many; the mines keep digging while the load settles.)
result(["bones", "gems", "mineLamps", "mineVent", "minePump"].every((id) => after[id] === before[id]) && ["coal", "copperOre", "tinOre"].every((id) => after[id] >= before[id] && after[id] > 0)
  && count(T.CoalSeam) === coalSeams,
  `items and deposits survive: ${JSON.stringify(before)} -> ${JSON.stringify(after)}; coal seams ${coalSeams} -> ${count(T.CoalSeam)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
