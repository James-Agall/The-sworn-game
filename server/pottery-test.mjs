// Scripted test: clay pit and pottery (ROADMAP "Clay pit and pottery — landed"; PLAN-agri-industry-winter-mines.md
// phase 2). Needs a private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80 and NOT
// COLONY_UNLOCK_ALL (scripts/run-tests.mjs gives all of that: `npm test -- pottery`). Checks: the Clay Pit's shovel and
// water gates (a dug Moat counts) and its digger's clay; the Kiln (needs a Clay Pit): bricks / pots / roof tiles /
// tableware for wood, idle without fuel, Good grades at level 2 with a level-2 potter, the crucible (level-2 potter,
// charcoal); bricks gate the Bloomery and build the clay oven (Bakery); the Blast furnace needs a crucible; the top
// house tier needs roof tiles; clay pots raise stockpile capacity (capped); tableware adds happiness; personal crafting
// at the Kiln and the Clay Pit; save / load keeps it all.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, Lumberjack: 3, House: 13, BigHouse: 14, HouseLevel2: 15, Water: 35, Moat: 75,
  Charcoal: 100, Bloomery: 101, ClayPit: 147, Kiln: 148,
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
// The sim is paused (snapshots still flow): it only runs in fastForward steps, so station workers can't race the
// exact counts below. Items / stock are read from hooks (fresh), tiles from tileUpdate messages.
const tileAt = (x, y) => c.tiles[y * c.W + x];
const raw = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const evSince = (n) => c.events.slice(n).join(" | ");
// A placement is refused while someone stands on the tile (villagers wander): retry a few times when it should land.
const place = async (x, y, tile, want = tile, tries = want === tile ? 6 : 1) => {
  await tp(x - 1, y - 1);
  for (let i = 0; i < tries && tileAt(x, y) !== want; i++) {
    send({ type: "setTile", tileX: x, tileY: y, tile });
    await until(() => tileAt(x, y) === want, 400);
    if (tileAt(x, y) !== want && tries > 1) await ff(10);
  }
};
// One placement that should be refused (the tile stays as it is).
const tryPlace = async (x, y, tile) => {
  await tp(x - 1, y - 1);
  const n = c.events.length;
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await until(() => c.events.length > n, 1500);
};
const info = async (x, y) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  await until(() => c.info !== undefined, 3000);
  return c.info;
};
const prog = (args = {}) => hook("progression", args);
const grades = async (id) => (await prog()).snapshot.items[id] ?? [0, 0, 0];
const total = async (id) => (await prog()).items[id] ?? 0;
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const setItems = (it, quality = 1) => prog({ items: it, quality });
// Sets an item to exactly n (Poor grade added when short).
const setExact = async (id, n) => setItems({ [id]: n - ((await prog()).items[id] ?? 0) });
const runUntil = async (done, rounds = 40, ticks = 40) => {
  for (let i = 0; i < rounds && !(await done()); i++) await ff(ticks);
  return done();
};
const staffed = (x, y) => runUntil(async () => { await sleep(80); return c.snap.colonists.some((u) => u.kind === "artisan" && u.postX === x && u.postY === y); }, 30, 20);

const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 24 < c.W - 2 ? tc.x + 6 : tc.x - 30;
const by = Math.max(6, Math.min(c.W - 20, tc.y + 4));
const B = { x: bx, y: by };
for (let y = B.y - 4; y <= B.y + 13; y++) for (let x = B.x - 4; x <= B.x + 22; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await hook("setStock", { stock: { wood: 2000, rock: 2000, iron: 500, grain: 500, meat: 50, fruit: 50, clothes: 20, tools: 20, luxuryItems: 5 } });

// 1. locks in a new game
const s0 = (await prog()).snapshot;
result((s0.locked[T.ClayPit] ?? []).includes("Wooden shovel") && (s0.locked[T.Kiln] ?? []).includes("a Clay Pit") && (s0.locked[T.Bloomery] ?? []).includes("8 Bricks"),
  `locks: Clay Pit ${JSON.stringify(s0.locked[T.ClayPit])}, Kiln ${JSON.stringify(s0.locked[T.Kiln])}, Bloomery ${JSON.stringify(s0.locked[T.Bloomery])}`);
const ovenCraft = s0.crafts.find((r) => r.id === "clayOven");
result(!!ovenCraft && /6 Bricks/.test(ovenCraft.cost) && /2 Clay/.test(ovenCraft.cost) && !/rock/.test(ovenCraft.cost) && !ovenCraft.ok,
  `clay oven is built from bricks + clay now: ${ovenCraft?.cost} (${ovenCraft?.why})`);
result(s0.crafts.some((r) => r.id === "woodenShovel" && r.ok), "wooden shovel is a hand recipe you can make at once");

// 2. Clay Pit gates: water first (a dug Moat counts), then the shovel
const PIT = { x: B.x + 1, y: B.y + 1 };
let ev = c.events.length;
await tryPlace(PIT.x, PIT.y, T.ClayPit);
result(tileAt(PIT.x, PIT.y) === T.Empty && /Clay Pit needs water within 3 tiles/.test(evSince(ev)), `dry ground refused: ${evSince(ev)}`);
await raw(PIT.x, PIT.y + 3, T.Moat);
ev = c.events.length;
await tryPlace(PIT.x, PIT.y, T.ClayPit);
result(tileAt(PIT.x, PIT.y) === T.Empty && /Clay Pit needs: Wooden shovel/.test(evSince(ev)), `with a moat near, the shovel gate: ${evSince(ev)}`);
const woodBefore = (await stock()).wood;
send({ type: "craftItem", recipe: "woodenShovel" });
await sleep(200);
const woodAfter = (await stock()).wood;
result((await total("woodenShovel")) === 1 && woodAfter === woodBefore - 3, `shovel crafted (wood ${woodBefore} -> ${woodAfter})`);
await place(PIT.x, PIT.y, T.ClayPit);
result(tileAt(PIT.x, PIT.y) === T.ClayPit, "Clay Pit built beside a dug Moat once the shovel is in stock");
// A pond / river tile counts too.
const PIT2 = { x: B.x + 18, y: B.y + 10 };
await raw(PIT2.x + 2, PIT2.y + 2, T.Water);
await place(PIT2.x, PIT2.y, T.ClayPit);
result(tileAt(PIT2.x, PIT2.y) === T.ClayPit, "a second Clay Pit beside a pond tile");

// 3. the digger digs clay
await staffed(PIT.x, PIT.y);
await runUntil(async () => (await total("clay")) >= 4);
const clayG = await grades("clay");
const pitInfo = await info(PIT.x, PIT.y);
result(clayG[0] >= 4 && (pitInfo.progression ?? []).some((l) => /Digger L1/.test(l)), `digger digs clay: ${JSON.stringify(clayG)}; info ${JSON.stringify(pitInfo.progression)}`);

// 4. the Kiln: needs a Clay Pit (now standing); fires bricks first, then pots, roof tiles, tableware
const KILN = { x: B.x + 5, y: B.y + 1 };
await place(KILN.x, KILN.y, T.Kiln);
result(tileAt(KILN.x, KILN.y) === T.Kiln, "Kiln built once a Clay Pit stands");
await staffed(KILN.x, KILN.y);
await setItems({ clay: 200 });
const wood0 = (await stock()).wood;
const fired = async () => {
  const it = (await prog()).items;
  return (it.bricks ?? 0) >= 20 && (it.clayPot ?? 0) >= 2 && (it.roofTiles ?? 0) >= 3 && (it.tableware ?? 0) >= 2;
};
await runUntil(fired, 60);
const it4 = (await prog()).items;
const wood1 = (await stock()).wood;
result((await fired()) && wood1 < wood0, `Kiln fires bricks ${it4.bricks}, pots ${it4.clayPot}, roof tiles ${it4.roofTiles}, tableware ${it4.tableware} (wood ${wood0} -> ${wood1})`);
result(!it4.crucible, "a level-1 potter fires no crucible");
// No fuel: idle, and the panel says why.
await hook("setStock", { stock: { wood: 0 } });
await setItems({ bricks: -100, clayPot: -100, roofTiles: -100, tableware: -100 });
await ff(20);
const idleInfo = await info(KILN.x, KILN.y);
result((idleInfo.progression ?? []).some((l) => /Idle: .*Bricks: short of wood/.test(l)) && (idleInfo.progression ?? []).some((l) => /Potter L1/.test(l)) && (await total("bricks")) === 0,
  `no wood, no firing: ${JSON.stringify(idleInfo.progression)}`);
await hook("setStock", { stock: { wood: 2000 } });

// 5. grades: a level-2 potter on a level-2 Kiln fires Good ware, and a crucible from charcoal
await prog({ xpAt: { x: KILN.x, y: KILN.y, xp: 100 } });
ev = c.events.length;
send({ type: "upgradeBuilding", tileX: KILN.x, tileY: KILN.y });
await sleep(300);
await ff(2);
const kLevel = (await info(KILN.x, KILN.y)).level;
await setItems({ charcoal: 4 });
await runUntil(async () => (await grades("crucible"))[1] >= 1 && (await grades("bricks"))[1] >= 4);
const cruG = await grades("crucible");
const brickG = await grades("bricks");
result(kLevel === 2 && cruG[1] >= 1 && brickG[1] >= 4 && brickG[0] === 0, `level-2 Kiln + potter: crucible ${JSON.stringify(cruG)}, bricks ${JSON.stringify(brickG)} ${evSince(ev)}`);

// 6. bricks gate the Bloomery; the clay oven is made of them (no rock)
const LJ = { x: B.x + 1, y: B.y + 6 };
const CB = { x: B.x + 4, y: B.y + 6 };
const BL = { x: B.x + 7, y: B.y + 6 };
await place(LJ.x, LJ.y, T.Lumberjack);
await place(CB.x, CB.y, T.Charcoal);
await setItems({ charcoal: 10 }); // bellows: wood and stone (no hide since 2026-11-19)
send({ type: "craftItem", recipe: "bellows" });
await sleep(200);
await setExact("bricks", 0);
ev = c.events.length;
await tryPlace(BL.x, BL.y, T.Bloomery);
result(tileAt(BL.x, BL.y) === T.Empty && /Bloomery needs: 8 Bricks/.test(evSince(ev)), `Bloomery without bricks refused: ${evSince(ev)}`);
await setItems({ bricks: 8 });
const rock0 = (await stock()).rock;
await place(BL.x, BL.y, T.Bloomery);
const rockB = (await stock()).rock;
result(tileAt(BL.x, BL.y) === T.Bloomery && (await total("bricks")) === 8 && rockB === rock0 - 15,
  `Bloomery built with 8 bricks in store (kept: ${await total("bricks")}; rock ${rock0} -> ${rockB})`);
await setItems({ crucible: -10 });
const blInfo = await info(BL.x, BL.y);
result((blInfo.progression ?? []).some((l) => /Level 2 needs: Crucible, a Blacksmith/.test(l)), `Blast furnace needs a crucible: ${JSON.stringify(blInfo.progression)}`);
await setExact("clay", 2);
const rock1 = (await stock()).rock;
send({ type: "craftItem", recipe: "clayOven" });
await sleep(200);
const it6 = (await prog()).items;
const rock2 = (await stock()).rock;
result(it6.clayOven === 1 && it6.bricks === 2 && !it6.clay && rock2 === rock1, `clay oven from 6 bricks + 2 clay: bricks ${it6.bricks}, clay ${it6.clay ?? 0}, rock ${rock1} -> ${rock2}`);

// 7. the top house tier needs roof tiles
const H = { x: B.x + 10, y: B.y + 6 };
await place(H.x, H.y, T.House);
await place(H.x, H.y, T.House, T.BigHouse, 4);
await setExact("roofTiles", 0);
ev = c.events.length;
await tryPlace(H.x, H.y, T.House);
const refusedHouse = tileAt(H.x, H.y) === T.BigHouse && /needs: 4 Roof tiles/.test(evSince(ev));
const houseEv = evSince(ev);
await setItems({ roofTiles: 4 });
await place(H.x, H.y, T.House, T.HouseLevel2, 4);
result(refusedHouse && tileAt(H.x, H.y) === T.HouseLevel2, `house level 3 waits on roof tiles (${houseEv}), then goes up: tile ${tileAt(H.x, H.y)}`);

// 8. clay pots: every stockpile holds 1% more per pot, up to +25%
const SP = { x: B.x + 14, y: B.y + 10 };
await tp(SP.x - 1, SP.y - 1);
send({ type: "zoneEdit", op: "paint", kind: "stockpile", tiles: [SP.x, SP.y] });
await ff(1);
const pile = async () => (await hook("zoneState", {})).zones.find((z) => z.kind === "stockpile" && z.size === 1);
await setExact("clayPot", 0);
const cap0 = (await pile())?.capacity;
await setExact("clayPot", 10);
const cap10 = (await pile())?.capacity;
await setExact("clayPot", 60);
const cap60 = (await pile())?.capacity;
result(cap0 === 40 && Math.abs(cap10 - 44) < 1e-6 && Math.abs(cap60 - 50) < 1e-6, `stockpile capacity with 0 / 10 / 60 pots: ${cap0} / ${cap10} / ${cap60}`);

// 9. tableware: 4+ in store adds happiness, more for Fine
await setItems({ tableware: -1000 });
await setItems({ tableware: 3 });
const h3 = (await hook("balanceState", {})).parts.tableware;
await setExact("tableware", 4);
const h4 = (await hook("balanceState", {})).parts.tableware;
await setItems({ tableware: 1 }, 3);
const hFine = (await hook("balanceState", {})).parts.tableware;
result(h3 === 0 && h4 === 3 && hFine === 5, `tableware happiness with 3 / 4 Poor / + a Fine piece: ${h3} / ${h4} / ${hFine}`);

// 10. personal crafting: the hero works an unstaffed Kiln and the Clay Pit (skill gates, XP, output to the stores).
// Every Kiln output and the clay are at their caps first, so the station workers idle and the counts are exact.
await setExact("bricks", 20);
await setExact("clayPot", 25);
await setExact("roofTiles", 8);
await setExact("tableware", 12);
await setExact("crucible", 2);
await setExact("clay", 60);
const RK = { x: B.x + 14, y: B.y + 3 };
await raw(RK.x, RK.y, T.Kiln);
await tp(RK.x, RK.y + 1);
await hook("heroLife", { needs: false, pack: {}, skills: { pottery: 0, mining: 0 } });
send({ type: "heroCraft", recipe: "crucible" });
let life = await hook("heroLife", {});
result(!life.snap.work, "a crucible needs Pottery level 2 at the workstation");
send({ type: "heroCraft", recipe: "tableware" });
life = await hook("heroLife", {});
result(!!life.snap.work, `the hero starts a tableware batch at the Kiln: ${JSON.stringify(life.snap.work)}`);
await ff(25 * 20 + 100);
life = await hook("heroLife", {});
const tw = await total("tableware");
result(!life.snap.work && life.life.skills.pottery === 25 && tw === 14, `personal tableware done: pottery XP ${life.life.skills.pottery}, tableware 12 -> ${tw}`);
await hook("heroLife", { skills: { pottery: 400, mining: 0 } });
send({ type: "heroCraft", recipe: "crucible" });
life = await hook("heroLife", {});
result(!!life.snap.work, "Pottery level 2: the hero may fire a crucible");
send({ type: "heroAction", action: "stopWork" });
await hook("heroLife", {});
// The Clay Pit: the digger idles at its cap, the hero still digs 2 clay.
await setExact("clay", 60);
await tp(PIT.x + 1, PIT.y);
send({ type: "heroCraft", recipe: "clay" });
life = await hook("heroLife", {});
const digging = !!life.snap.work;
await ff(20 * 20 + 100);
life = await hook("heroLife", {});
const clayNow = await total("clay");
result(digging && clayNow === 62 && life.life.skills.mining === 20, `the hero digs clay at the pit: clay ${clayNow}, mining XP ${life.life.skills.mining}`);

// 11. save / load
await setItems({ roofTiles: 2 }, 2);
const before = (await prog()).items;
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await prog({ reset: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
await sleep(300);
const after = await prog();
const kInfo = await info(KILN.x, KILN.y);
result(tileAt(KILN.x, KILN.y) === T.Kiln && tileAt(PIT.x, PIT.y) === T.ClayPit && kInfo.level === 2 && (kInfo.progression ?? []).some((l) => /Potter L2/.test(l)),
  `Kiln (level ${kInfo.level}), Clay Pit and the potter survive save/load: ${JSON.stringify(kInfo.progression)}`);
result(["clay", "bricks", "clayPot", "tableware", "woodenShovel", "clayOven", "crucible"].every((id) => after.items[id] === before[id]) && after.snapshot.items.roofTiles?.[1] === 2
  && after.unlocked.includes(T.ClayPit) && after.unlocked.includes(T.Kiln),
  `items and unlocks survive: ${JSON.stringify(after.items)} unlocked ${after.unlocked}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
