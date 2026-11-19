// Scripted test: layered mines (2026-11-19; ROADMAP "Layered mines — landed", before it "Deep mines — landed"). Needs a
// private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80 and NOT COLONY_UNLOCK_ALL
// (scripts/run-tests.mjs gives all of that: `npm test -- mines`). Checks: deposits at world gen; only the Quarry and the
// Mine are buildable (the old Coal / Copper / Tin mines are inert legacy); a Mine needs a Quarry and ore ground (iron
// ore or any deposit, given back when demolished); each level of a Mine is a layer: a new layer breaks into a nest
// (danger by layer: more, stronger monsters deeper), must be cleared before it produces; level 1 digs copper, tin and
// limestone; the Bloomery (one furnace: the Foundry is retired) casts the bronze anvil and hammer & tongs, so a Blacksmith
// needs no iron (not even to build); its level is the
// anvil tier (a tier-1 anvil forges the bronze pickaxe, not the iron one; panel text); level 2 needs the bronze pickaxe
// and digs iron ore and coal; level 3 the iron pickaxe (+ vent, pump) and digs gold and lead; inside, the old mine head
// on a level leads down to the next and the mat back up; the hero fights per layer (bites, kills, loot, cleared), a
// fallen hero is put outside; soldiers clear the shallowest infested layer; re-infestation by layer at dawn (a miner
// killed; the foreman; guards; odds); hazards; the Quarry is unchanged; save / load keeps every layer.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, IronOre: 7, Rock: 8, Mine: 9, Quarry: 10, Blacksmith: 26, Bloomery: 101,
  CoalSeam: 149, CopperOre: 150, TinOre: 151, CoalMine: 152, CopperMine: 153, TinMine: 154, Foundry: 159,
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
const staffed = (m, kind) => runUntil(async () => (await workersAt(m)).length > 0 && (!kind || c.snap.colonists.some((u) => u.kind === kind && u.postX === m.x && u.postY === m.y)), 40, 20);
const me = () => c.snap.players.find((p) => p.id === c.welcome.id);
const interior = (args = {}) => hook("interior", args);
const upgrade = async (m, xp) => {
  await prog({ xpAt: { x: m.x, y: m.y, xp } });
  const ev = c.events.length;
  send({ type: "upgradeBuilding", tileX: m.x, tileY: m.y });
  await sleep(300);
  await ff(25);
  return evSince(ev);
};
const heroAt = async () => {
  const d = await interior({});
  return { x: d.inside.x / TILE - 0.5, y: d.inside.y / TILE - 0.5 };
};
// The hero fights every monster of `layer` (placing them one by one beside it); true when that layer is cleared.
const fightLayer = async (m, layer) => {
  await mine(m, { roll: 0 });
  for (let guard = 0; guard < 120; guard++) {
    const M = await mine(m, { layer });
    if (!M.mine || M.mine.status !== "infested") break;
    const h = await heroAt();
    await mine(m, { layer, place: { i: 0, x: h.x + 0.9, y: h.y } });
    send({ type: "attack" });
    await sleep(30);
    await ff(11);
  }
  await mine(m, { roll: null });
  return (await mine(m, { layer })).mine?.status === "cleared";
};

// 0. deposits at world gen (a fresh W80 world)
const count = (t) => c.tiles.filter((x) => x === t).length;
result(count(T.CoalSeam) >= 2 && count(T.CopperOre) >= 2 && count(T.TinOre) >= 2,
  `world gen scatters deposits: coal ${count(T.CoalSeam)}, copper ${count(T.CopperOre)}, tin ${count(T.TinOre)} tiles`);

const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 24 < c.W - 2 ? tc.x + 6 : tc.x - 30;
const by = Math.max(6, Math.min(c.W - 20, tc.y + 4));
const B = { x: bx, y: by };
for (let y = B.y - 4; y <= B.y + 13; y++) for (let x = B.x - 4; x <= B.x + 22; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await hook("setStock", { stock: { wood: 3000, rock: 3000, iron: 200, grain: 800, meat: 80, fruit: 80, clothes: 20, tools: 20, gold: 100 } });
await hook("peopleState", { spawn: 14 });

// 1. gates: the Mine needs a Quarry; the old deposit mines are not buildable
const s0 = (await prog()).snapshot;
result((s0.locked[T.Mine] ?? []).includes("a Quarry") && ["mineLamps", "mineVent", "minePump"].every((id) => s0.crafts.some((r) => r.id === id)),
  `Mine locked behind a Quarry: ${JSON.stringify(s0.locked[T.Mine])}; fitting recipes by hand`);
const OLD = { x: B.x + 1, y: B.y + 10 };
await raw(OLD.x, OLD.y, T.CoalSeam);
await place(OLD.x, OLD.y, T.CoalMine, T.CoalMine, 1);
result(tileAt(OLD.x, OLD.y) === T.CoalSeam, `the old Coal Mine is no longer placeable: tile ${tileAt(OLD.x, OLD.y)}`);
const Q = { x: B.x + 18, y: B.y + 10 };
await raw(Q.x, Q.y, T.Rock);
await place(Q.x, Q.y, T.Quarry);
result(tileAt(Q.x, Q.y) === T.Quarry, "Quarry dug on rock");

// 2. a Mine only on ore ground; a deposit is given back when it is demolished
const MN = { x: B.x + 3, y: B.y + 3 };
let ev = c.events.length;
await place(MN.x, MN.y, T.Mine, T.Mine, 1);
await until(() => c.events.length > ev, 1500);
result(tileAt(MN.x, MN.y) === T.Empty && /must be sunk on ore ground/.test(evSince(ev)), `bare ground refused: ${evSince(ev)}`);
await raw(MN.x, MN.y, T.CopperOre);
await place(MN.x, MN.y, T.Mine);
result(tileAt(MN.x, MN.y) === T.Mine, "Mine sunk on a copper deposit");
await place(MN.x, MN.y, T.Empty, T.CopperOre);
result(tileAt(MN.x, MN.y) === T.CopperOre, `demolished, the deposit is back: ${tileAt(MN.x, MN.y)}`);
await raw(MN.x, MN.y, T.IronOre);
await place(MN.x, MN.y, T.Mine);
await staffed(MN, "ironMiner");

// 3. level 1 opens with a nest of weak monsters: nothing dug until it is cleared
let M = await mine(MN, { sync: true });
const L1 = M.mine;
result(L1?.layered && L1.level === 1 && L1.status === "infested" && L1.mobs.length >= 2 && L1.mobs.length <= 3 && L1.mobs.every((m) => ["caveBat", "caveSpider"].includes(m.kind)) && L1.workMult === 0,
  `a new Mine's level 1 holds a weak nest: ${L1?.status} ${L1?.mobs.map((m) => `${m.kind}/${m.maxHp}`).join(", ")}, workMult ${L1?.workMult}`);
const cu0 = await total("copperOre");
await ff(300);
result((await total("copperOre")) === cu0, `an infested level yields nothing: copper ${cu0} -> ${await total("copperOre")}`);
const pi1 = await info(MN.x, MN.y);
result(pi1.mine?.status === "infested" && /Level 1 \(copper ore, tin ore, limestone\): Infested/.test(pi1.mine.lines[0]) && /open level 2 \(iron ore, coal\)/.test(pi1.mine.lines.join(" ")),
  `panel: ${JSON.stringify(pi1.mine?.lines)}`);

// 4. enter: the Mine's level 1 (no way down yet); the hero clears it; loot is the level's ore
await tp(MN.x, MN.y + 1);
let I = await interior({ enter: { tx: MN.x, ty: MN.y } });
result(I.why === "" && I.inside?.templateId === "mine" && I.inside.variant === 0 && I.view?.mine?.layer === 1 && /level 1/.test(I.view.title)
  && !I.view.map.props.some((p) => p.prop === "mineShaft") && I.templateErrors.length === 0,
  `inside level 1: "${I.view?.title}" ${JSON.stringify(I.view?.mine)}, shaft ${I.view?.map.props.some((p) => p.prop === "mineShaft")}, errors ${I.templateErrors.length}`);
const loot0 = { cu: await total("copperOre"), sn: await total("tinOre"), lime: await total("limestone"), gold: (await stock()).gold };
const cleared1 = await fightLayer(MN, 1);
const loot1 = { cu: await total("copperOre"), sn: await total("tinOre"), lime: await total("limestone"), gold: (await stock()).gold };
result(cleared1 && /level 1 is cleared by you/.test(c.events.join(" | ")), `the hero cleared level 1: ${(await mine(MN)).mine?.status}`);
result(loot1.cu + loot1.sn + loot1.lime >= loot0.cu + loot0.sn + loot0.lime + 4 && loot1.gold >= loot0.gold + 20, `loot (level-1 ore, gold): ${JSON.stringify(loot0)} -> ${JSON.stringify(loot1)}`);
await interior({ exit: true });

// 5. level 1 digs copper, tin and limestone
await runUntil(async () => (await total("copperOre")) > loot1.cu && (await total("tinOre")) > loot1.sn && (await total("limestone")) > loot1.lime, 40, 40);
result((await total("copperOre")) > loot1.cu && (await total("tinOre")) > loot1.sn && (await total("limestone")) > loot1.lime && (await stock()).iron <= 200,
  `level 1 yields copper ${await total("copperOre")}, tin ${await total("tinOre")}, limestone ${await total("limestone")} (no iron: ${(await stock()).iron})`);

// 6. bronze work without iron: the Bloomery casts the bronze anvil and hammer & tongs; the Blacksmith needs a Bloomery
// and no iron; its level is the anvil tier: a tier-1 anvil forges the bronze pickaxe, not the iron one
await prog({ unlockAll: true });
const FO = { x: B.x + 8, y: B.y + 1 };
await place(FO.x, FO.y, T.Bloomery);
await prog({ unlockAll: false });
await staffed(FO, "artisan");
await setItems({ bronze: 6 });
await runUntil(async () => (await total("anvil")) >= 1 && (await total("smithTools")) >= 1, 40, 40);
result((await total("anvil")) === 1 && (await total("smithTools")) === 1, `the Bloomery cast a bronze anvil and hammer & tongs: anvil ${await total("anvil")}, tools ${await total("smithTools")}`);
const BS = { x: B.x + 12, y: B.y + 1 };
const sl = (await prog()).snapshot.locked[T.Blacksmith] ?? [];
const ironBS = (await stock()).iron;
await place(BS.x, BS.y, T.Blacksmith);
result(!sl.some((l) => /Iron|Foundry/.test(l)) && tileAt(BS.x, BS.y) === T.Blacksmith && (await stock()).iron === ironBS,
  `the Blacksmith needs no iron, not even to build (locks before: ${JSON.stringify(sl)}; iron ${ironBS} -> ${(await stock()).iron})`);
await staffed(BS, "artisan");
// (The Bloomery's own casts are at their caps, so the bronze waits for the smith.)
await setExact("bronzeTools", 1);
await setExact("bronze", 3);
const bsInfo0 = await info(BS.x, BS.y);
await setExact("ironBloom", 5);
await runUntil(async () => (await total("bronzePick")) >= 1, 40, 40);
await ff(400);
const bsInfo = await info(BS.x, BS.y);
result((await total("bronzePick")) === 1 && (await total("ironPick")) === 0 && (await total("ironBloom")) === 5,
  `a tier-1 anvil forged the bronze pickaxe but not the iron one (${await total("ironPick")}; blooms kept ${await total("ironBloom")})`);
result((bsInfo.bonuses ?? []).some((l) => /Anvil tier 1 \(bronze/.test(l)) && (bsInfo0.progression ?? []).some((l) => /Level 2 needs: .*Iron bloom/.test(l)),
  `Blacksmith panel: ${JSON.stringify(bsInfo.bonuses)} ${JSON.stringify(bsInfo0.progression)}`);

// The Bloomery would smelt the level-2 iron ore and coal into blooms below: take it away (the Blacksmith stays unlocked).
await raw(FO.x, FO.y, T.Empty);

// 7. level 2 needs the bronze pickaxe; the new layer's nest is stronger; level 1 keeps digging
await setExact("bronzePick", 0);
await setItems({ timberProps: 6 });
let why = await upgrade(MN, 120);
result((await mine(MN)).mine.level === 1 && /Bronze pickaxe/.test(why), `level 2 refused without a bronze pickaxe: ${why}`);
await setExact("bronzePick", 1);
why = await upgrade(MN, 120);
M = await mine(MN, { sync: true, layer: 2 });
const L2 = M.mine;
result(L2?.level === 2 && L2.status === "infested" && L2.mobs.length >= 3 && L2.mobs.length <= 5 && L2.mobs.every((m) => ["caveSpider", "skeleton", "giantSpider"].includes(m.kind))
  && L2.layers[0].status !== "infested" && L2.workMult > 0,
  `level 2 opened: ${L2?.status} ${L2?.mobs.map((m) => `${m.kind}/${m.maxHp}`).join(", ")}; level 1 ${L2?.layers[0].status}, workMult ${L2?.workMult} ${why}`);
const skel2 = L2?.mobs.find((m) => m.kind === "skeleton" || m.kind === "caveSpider");
result(!!skel2 && skel2.maxHp > (skel2.kind === "skeleton" ? 50 : 20), `level-2 monsters are tougher: ${skel2?.kind} ${skel2?.maxHp} hp`);
const iron2 = (await stock()).iron;
const cu2 = await total("copperOre");
await runUntil(async () => (await total("copperOre")) > cu2, 30, 40);
result((await total("copperOre")) > cu2 && (await stock()).iron <= iron2, `level 1 still digs while level 2 is infested (iron ${iron2} -> ${(await stock()).iron})`);

// 8. inside: the old mine head on level 1 leads down; the mat of level 2 back up
await tp(MN.x, MN.y + 1);
I = await interior({ enter: { tx: MN.x, ty: MN.y } });
const shaft = I.view?.map.props.find((p) => p.prop === "mineShaft");
result(I.inside?.variant === 0 && !!shaft, `level 1 now has the way down at ${JSON.stringify(shaft)}`);
await ff(40);
c.mobs = null;
await interior({ at: { x: (shaft.x + 0.5) * TILE, y: (shaft.y + 0.5) * TILE } });
await ff(4);
I = await interior({});
await ff(6);
await until(() => c.mobs && c.mobs.mobs.length === L2.mobs.length, 2000);
result(I.inside?.variant === 1 && I.view?.mine?.layer === 2 && I.view.mine.status === "infested" && /level 2/.test(I.view.title) && c.mobs?.mobs.length === L2.mobs.length,
  `down the shaft: variant ${I.inside?.variant}, ${JSON.stringify(I.view?.mine)}, monsters sent ${c.mobs?.mobs.length}`);
// The monsters bite indoors.
let h = await heroAt();
await mine(MN, { layer: 2, place: { i: 0, x: h.x + 0.6, y: h.y } });
const hp0 = me().hp;
await ff(60);
await sleep(100);
result(me().hp < hp0, `a level-2 monster bit the hero: hp ${hp0} -> ${me().hp}`);
await mine(MN, { layer: 2, clear: true });
await mine(MN, { layer: 2, infest: ["skeleton"] });
const mat = I.view.map.exit;
await ff(40);
await interior({ at: { x: (mat.x + 0.5) * TILE, y: (mat.y + 0.5) * TILE } });
await ff(4);
I = await interior({});
result(I.inside?.variant === 0 && Math.hypot(I.inside.x / TILE - 0.5 - shaft.x, I.inside.y / TILE - 0.5 - shaft.y) <= 1.01,
  `the mat of level 2 leads back up beside the shaft: variant ${I.inside?.variant} at ${(I.inside?.x / TILE - 0.5).toFixed(1)},${(I.inside?.y / TILE - 0.5).toFixed(1)}`);
await interior({ exit: true });

// 9. soldiers clear the shallowest infested level; level 2 then digs iron ore and coal
await hook("spawnSoldier", { kind: "knight", x: (MN.x + 2) * TILE + 16, y: (MN.y + 2) * TILE + 16 });
await hook("spawnSoldier", { kind: "knight", x: (MN.x + 3) * TILE + 16, y: (MN.y + 2) * TILE + 16 });
const ainf = await info(MN.x, MN.y);
ev = c.events.length;
send({ type: "mineAssault", tileX: MN.x, tileY: MN.y });
await until(() => c.events.length > ev, 2000);
M = await mine(MN, { layer: 2 });
result(ainf.mine?.assault.soldiers === 2 && M.mine?.status === "cleared" && /cleared the Mine's level 2/.test(evSince(ev)), `soldiers cleared level 2: ${evSince(ev)}`);
await hook("killColonists", { kind: "knight" });
const iron3 = (await stock()).iron;
const coal3 = await total("coal");
await runUntil(async () => (await stock()).iron > iron3 && (await total("coal")) > coal3, 40, 40);
result((await stock()).iron > iron3 && (await total("coal")) > coal3, `level 2 yields iron ore ${iron3} -> ${(await stock()).iron}, coal ${coal3} -> ${await total("coal")}`);

// 10. level 3 needs the iron pickaxe (+ vent, pump); the strongest nest; then gold and lead
await setItems({ mineVent: 1, minePump: 1 });
why = await upgrade(MN, 320);
result((await mine(MN)).mine.level === 2 && /Iron pickaxe/.test(why), `level 3 refused without an iron pickaxe: ${why}`);
await setItems({ ironPick: 1 });
why = await upgrade(MN, 320);
M = await mine(MN, { sync: true, layer: 3 });
const L3 = M.mine;
result(L3?.level === 3 && L3.status === "infested" && L3.mobs.length >= 5 && L3.mobs.length <= 7 && L3.mobs.every((m) => ["skeleton", "giantSpider", "caveSpider"].includes(m.kind)),
  `level 3 opened: ${L3?.mobs.map((m) => `${m.kind}/${m.maxHp}`).join(", ")} ${why}`);
const sk3 = L3?.mobs.find((m) => m.kind === "skeleton" || m.kind === "giantSpider");
const base = { skeleton: 50, giantSpider: 35 };
result(!!sk3 && sk3.maxHp === Math.round(base[sk3.kind] * 1.7), `level-3 monsters are the strongest (x1.7): ${sk3?.kind} ${sk3?.maxHp}`);
await mine(MN, { layer: 3, clear: true });
const g0 = await total("goldOre");
const pb0 = await total("leadOre");
await runUntil(async () => (await total("goldOre")) > g0 && (await total("leadOre")) > pb0, 50, 40);
result((await total("goldOre")) > g0 && (await total("leadOre")) > pb0, `level 3 yields gold ore ${await total("goldOre")}, lead ore ${await total("leadOre")}`);
const pi3 = await info(MN.x, MN.y);
result(pi3.mine.lines.filter((l) => /^Level [123] \(/.test(l)).length === 3, `panel lists the three levels: ${JSON.stringify(pi3.mine.lines)}`);

// 11. a fallen hero is put back outside
await mine(MN, { layer: 1, infest: ["skeleton", "skeleton"] });
await hook("damagePlayer", { amount: me().hp - 3 });
await tp(MN.x, MN.y + 1);
I = await interior({ enter: { tx: MN.x, ty: MN.y } });
h = await heroAt();
await mine(MN, { layer: 1, place: { i: 0, x: h.x + 0.5, y: h.y }, wakeAll: true });
await ff(80);
I = await interior({});
await sleep(100);
result(I.inside === null && !me().dead, `fallen in the mine: back outside (inside ${JSON.stringify(I.inside)}, hp ${me().hp})`);
await mine(MN, { layer: 1, clear: true });

// 12. re-infestation by layer at dawn: level 1 never, level 3 at 40% (a miner killed); foreman, guards, odds
const day = M.day;
await staffed(MN);
await prog({ xpAt: { x: MN.x, y: MN.y, xp: 0 } });
M = await mine(MN, { layer: 1, roll: 0, set: { status: "clear", rollDay: day - 5, clearedDay: day - 10 }, dawn: true });
result(M.mine.status === "clear", `level 1 never re-infests: ${M.mine.status}`);
const minersBefore = (await workersAt(MN)).length;
ev = c.events.length;
M = await mine(MN, { layer: 3, roll: 0, set: { status: "clear", rollDay: day - 5, clearedDay: day - 10, propsDay: day + 100 }, dawn: true });
const minersAfter = (await workersAt(MN)).length;
result(M.mine.status === "infested" && minersAfter === minersBefore - 1 && /crawled back into the Mine's level 3: 1 miner killed/.test(evSince(ev)),
  `level 3 re-infested: miners ${minersBefore} -> ${minersAfter}: ${evSince(ev)}`);
await mine(MN, { layer: 3, clear: true });
await staffed(MN);
await prog({ xpAt: { x: MN.x, y: MN.y, xp: 700 } });
await setExact("mineLamps", 1);
await setExact("timberProps", 3);
M = await mine(MN, { layer: 3 });
const M2 = await mine(MN, { layer: 2 });
result(Math.abs(M.mine.chance - 0.4 * 0.5 * 0.6 * 0.5) < 1e-9 && Math.abs(M2.mine.chance - 0.25 * 0.5 * 0.6 * 0.5) < 1e-9,
  `odds by level (lit, propped, foreman): level 2 ${M2.mine.chance}, level 3 ${M.mine.chance}`);
await hook("spawnSoldier", { kind: "militia", x: (MN.x + 1) * TILE + 16, y: (MN.y + 2) * TILE + 16 });
M = await mine(MN, { layer: 3, roll: 0, set: { clearedDay: day - 10, rollDay: day - 5 }, dawn: true });
result(M.mine.status !== "infested" && M.mine.guarded, `guarded by a soldier: ${M.mine.status} guarded ${M.mine.guarded}`);
await hook("killColonists", { kind: "militia" });

// 13. hazards: props wear out -> cave-in, bad air without a vent, flood without a pump
await setExact("timberProps", 0);
ev = c.events.length;
M = await mine(MN, { roll: 0, set: { propsDay: day - 5, unpropped: false }, dawn: true });
result(M.mine.unpropped && M.mine.closedDay === M.day && M.mine.workMult === 0 && /Cave-in at the Mine/.test(evSince(ev)), `no props left: cave-in (${evSince(ev)})`);
await setExact("mineVent", 0);
M = await mine(MN, { roll: 0.99, set: { closedDay: -1 } });
result(M.mine.workMult === 0.5 && M.mine.info.lines.some((l) => /Bad air/.test(l)), `no air vent: bad air, x${M.mine.workMult}`);
await setExact("minePump", 0);
ev = c.events.length;
M = await mine(MN, { roll: 0, set: { closedDay: -1, propsDay: day + 100, unpropped: false }, dawn: true });
result(M.mine.closedWhy === "flood" && /flooded/.test(evSince(ev)), `no pump: flooded ${evSince(ev)}`);
await mine(MN, { roll: null, set: { closedDay: -1, unpropped: false } });
await setItems({ mineVent: 1, minePump: 1, timberProps: 4 });
for (const l of [1, 2, 3]) await mine(MN, { layer: l, set: { status: "clear" } });

// 14. the Quarry is unchanged: one interior (layout = depth), a surface adit never infested, digging deeper may be
await staffed(Q);
let QM = await mine(Q, { sync: true });
const qi = await info(Q.x, Q.y);
result(QM.mine && !QM.mine.layered && QM.mine.status === "clear" && /surface adit/.test(qi.mine?.lines.join(" ")), `Quarry level 1: ${QM.mine?.status} ${JSON.stringify(qi.mine?.lines)}`);
await mine(Q, { roll: 0 });
why = await upgrade(Q, 120);
QM = await mine(Q, { sync: true });
await mine(Q, { roll: null });
result(QM.mine.level === 2 && QM.mine.status === "infested" && QM.mine.mobs.every((m) => ["caveSpider", "caveBat", "skeleton"].includes(m.kind) && m.maxHp === { caveSpider: 20, caveBat: 10, skeleton: 50 }[m.kind]),
  `Quarry shaft as before: ${QM.mine.status} ${QM.mine.mobs.map((m) => `${m.kind}/${m.maxHp}`).join(", ")} ${why}`);
await tp(Q.x, Q.y + 1);
I = await interior({ enter: { tx: Q.x, ty: Q.y } });
result(I.inside?.variant === 1 && /quarry \(shaft\)/.test(I.view?.title ?? ""), `Quarry interior: v${I.inside?.variant} "${I.view?.title}"`);
await interior({ exit: true });
await mine(Q, { clear: true });

// 15. save / load keeps every layer (status, monsters) and the ground
await mine(MN, { layer: 2, infest: ["caveSpider", "giantSpider"] });
const before = (await prog()).items;
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await mine(MN, { layer: 2, clear: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
await sleep(300);
M = await mine(MN, { layer: 2 });
const after = (await prog()).items;
result(M.mine?.layered && M.mine.level === 3 && M.mine.status === "infested" && M.mine.mobs.map((m) => m.kind).sort().join() === "caveSpider,giantSpider"
  && M.mine.mobs.find((m) => m.kind === "giantSpider")?.maxHp === Math.round(35 * 1.3) && M.mine.layers.length === 3 && tileAt(MN.x, MN.y) === T.Mine,
  `layers survive save/load: level ${M.mine?.level} ${JSON.stringify(M.mine?.layers)}`);
result(["bronzePick", "ironPick", "mineVent", "minePump"].every((id) => after[id] === before[id]), `items survive: ${JSON.stringify(after)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
