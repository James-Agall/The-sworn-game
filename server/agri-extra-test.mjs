// Scripted test: agriculture extras (ROADMAP "Agriculture extras — landed"; PLAN-agri-industry-winter-mines.md phase 5).
// Needs a private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80, seasons ON and NOT
// COLONY_UNLOCK_ALL (scripts/run-tests.mjs gives all of that: `npm test -- agri-extra`). Checks: the new gates; the
// spoilage classes and what keeps food (clay pots, a Cellar by level); the Salt Works (water + pots gates, salt), the
// Smokehouse (salted meat first, smoked meat without salt), the Dairy (rennet from hides, cheese); preserved food eaten
// only after the grain / meat / fruit; sickness from raw meat and spoiled stores (hp, happiness, recovery); the
// sourdough starter going bad untended, kept while tended, lost when the Bakery burns; the Blacksmith's iron plow (field
// growth and yield); hops on a hero plot and a hop field, ale at the Brewery (grades, happiness, drunk at dawn); orchard
// years (yield by age); seasons off / COLONY_UNLOCK_ALL switch the new rules off; save / load keeps it all.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, Orchard: 22, Blacksmith: 26, Brewery: 30, Water: 35, HunterHut: 50, Bloomery: 101, Mill: 102, Bakery: 103,
  LivestockBarn: 131, SaltWorks: 155, Smokehouse: 156, Dairy: 157, Cellar: 158,
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
// Demolish a station (frees its worker for the next one).
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
const grades = async (id) => (await prog()).snapshot.items[id] ?? [0, 0, 0];
const total = async (id) => (await prog()).items[id] ?? 0;
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const setStock = (s) => hook("setStock", { stock: s });
const setItems = (it, quality = 1) => prog({ items: it, quality });
const setExact = async (id, n) => setItems({ [id]: n - ((await prog()).items[id] ?? 0) });
const agri = (args = {}) => hook("agri", args);
const runUntil = async (done, rounds = 40, ticks = 40) => {
  for (let i = 0; i < rounds && !(await done()); i++) await ff(ticks);
  return done();
};
const staffed = (x, y, kind = "artisan") => runUntil(async () => { await sleep(80); return c.snap.colonists.some((u) => u.kind === kind && u.postX === x && u.postY === y); }, 30, 20);
const FOOD_ITEMS = ["bread", "flatbread", "gruel", "milk", "egg", "cheese", "smokedMeat", "saltedMeat", "flour", "ale"];
const clearFoodItems = async () => { for (const id of FOOD_ITEMS) await setExact(id, 0); };

// Summer (hops and orchards in season); the calendar jump's dawn (spoilage, the starter) runs in the first ticks.
await hook("calendar", { set: { season: 1, day: 2 } });
await ff(3);
const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 24 < c.W - 2 ? tc.x + 6 : tc.x - 30;
const by = Math.max(6, Math.min(c.W - 20, tc.y + 4));
const B = { x: bx, y: by };
for (let y = B.y - 4; y <= B.y + 13; y++) for (let x = B.x - 4; x <= B.x + 22; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await setStock({ wood: 3000, rock: 3000, iron: 500, grain: 500, meat: 200, fruit: 200, clothes: 20, tools: 20 });

// 1. locks in a new game
const s0 = (await prog()).snapshot;
const lk = (t) => JSON.stringify(s0.locked[t] ?? []);
result((s0.locked[T.SaltWorks] ?? []).includes("2 Clay pots") && (s0.locked[T.Smokehouse] ?? []).includes("a Hunter's Hut")
  && (s0.locked[T.Dairy] ?? []).includes("a Livestock Barn") && (s0.locked[T.Cellar] ?? []).includes("6 Bricks"),
  `locks: Salt Works ${lk(T.SaltWorks)}, Smokehouse ${lk(T.Smokehouse)}, Dairy ${lk(T.Dairy)}, Cellar ${lk(T.Cellar)}`);
let a = await agri();
result(a.on === true && a.keep === 1 && a.snapshot?.raw === 0.05 && c.snap.agri?.raw === 0.05, `agri rules on (seasons on, gates on); raw food spoils ${a.snapshot?.raw}/day, snapshot ${JSON.stringify(c.snap.agri)}`);

// 2. spoilage classes; clay pots keep food
await clearFoodItems();
await setStock({ meat: 1000, fruit: 1000, grain: 1000 });
await setItems({ milk: 100, cheese: 50, smokedMeat: 50, saltedMeat: 50, flour: 100 });
await setExact("clayPot", 0);
await agri({ set: { carry: null } });
a = await agri({ spoil: true });
let sp = a.spoiled ?? {};
result(sp.meat === 50 && sp.fruit === 30 && sp.grain === 10 && sp.milk === 5 && sp.flour === 1 && !sp.cheese && !sp.smokedMeat && !sp.saltedMeat && a.stock.meat === 950,
  `classes: raw 5%, fresh 3%, dry 1%, preserved 0: ${JSON.stringify(sp)}`);
result(a.state.spoiled === 96, `the day's spoiled food is noted for sickness: ${a.state.spoiled}`);
await setExact("clayPot", 15);
await setStock({ meat: 1000 });
await agri({ set: { carry: null } });
a = await agri({ spoil: true });
result(Math.abs(a.keep - 0.7) < 1e-9 && a.spoiled.meat === 35, `15 clay pots cut spoilage 30%: keep ${a.keep}, meat lost ${a.spoiled.meat}`);
await setExact("clayPot", 60);
a = await agri();
result(Math.abs(a.pots - 0.3) < 1e-9, `pot cut capped at 30%: ${a.pots}`);
// A small store spoils too (the remainder carries to the next dawn).
await setExact("clayPot", 0);
await clearFoodItems();
await setItems({ milk: 10 });
await agri({ set: { carry: null } });
await agri({ spoil: true });
await agri({ spoil: true });
const milk2 = await total("milk");
result(milk2 === 9, `10 milk lose half a unit a day: 1 gone after two dawns (${milk2} left)`);

// 3. Salt Works: water near (brine), then the pots gate; the salter boils salt from wood
const SW = { x: B.x + 1, y: B.y + 1 };
let ev = c.events.length;
await tryPlace(SW.x, SW.y, T.SaltWorks);
result(tileAt(SW.x, SW.y) === T.Empty && /Salt Works needs water within 2 tiles/.test(evSince(ev)), `dry ground refused: ${evSince(ev)}`);
await raw(SW.x, SW.y + 2, T.Water);
ev = c.events.length;
await tryPlace(SW.x, SW.y, T.SaltWorks);
result(tileAt(SW.x, SW.y) === T.Empty && /Salt Works needs: 2 Clay pots/.test(evSince(ev)), `the pots gate: ${evSince(ev)}`);
await setExact("clayPot", 2);
await place(SW.x, SW.y, T.SaltWorks);
result(tileAt(SW.x, SW.y) === T.SaltWorks, "Salt Works built beside water with 2 clay pots in store");
await staffed(SW.x, SW.y);
await runUntil(async () => (await total("salt")) >= 4);
const swInfo = await info(SW.x, SW.y);
result((await total("salt")) >= 4 && (swInfo.progression ?? []).some((l) => /Salter L1/.test(l)), `the salter boils salt: ${await total("salt")}; ${JSON.stringify(swInfo.progression)}`);
await demolish(SW.x, SW.y);

// 4. Smokehouse: needs a Hunter's Hut; cures with salt first, smokes without
const SM = { x: B.x + 5, y: B.y + 1 };
ev = c.events.length;
await tryPlace(SM.x, SM.y, T.Smokehouse);
result(tileAt(SM.x, SM.y) === T.Empty && /Smokehouse needs: a Hunter's Hut/.test(evSince(ev)), `Smokehouse locked: ${evSince(ev)}`);
await raw(B.x + 9, B.y + 1, T.HunterHut);
await place(SM.x, SM.y, T.Smokehouse);
result(tileAt(SM.x, SM.y) === T.Smokehouse, "Smokehouse built once a Hunter's Hut stands");
await setExact("salt", 2);
await setExact("saltedMeat", 0);
await setExact("smokedMeat", 0);
await setStock({ meat: 100 });
await staffed(SM.x, SM.y);
await runUntil(async () => (await total("saltedMeat")) >= 8);
const salted = await total("saltedMeat");
const saltLeft = await total("salt");
await runUntil(async () => (await total("smokedMeat")) >= 4);
const smoked = await total("smokedMeat");
const meatLeft = (await stock()).meat;
result(salted === 8 && saltLeft === 0 && smoked >= 4 && meatLeft === 100 - salted - smoked, `salt cures first (${salted} salted, salt ${saltLeft}), then smoke (${smoked} smoked); meat 100 -> ${meatLeft}`);
await setStock({ meat: 0, grain: 100, fruit: 100 });
a = await agri();
result(Math.abs(a.parts.foodVariety - 40) < 1e-9, `smoked / salted meat counts as meat for food variety: ${a.parts.foodVariety}`);
await demolish(SM.x, SM.y);

// 5. Dairy: needs a Livestock Barn; rennet from hides, cheese from milk + rennet
const DY = { x: B.x + 1, y: B.y + 5 };
ev = c.events.length;
await tryPlace(DY.x, DY.y, T.Dairy);
result(tileAt(DY.x, DY.y) === T.Empty && /Dairy needs: a Livestock Barn/.test(evSince(ev)), `Dairy locked: ${evSince(ev)}`);
await raw(B.x + 14, B.y + 1, T.LivestockBarn);
await place(DY.x, DY.y, T.Dairy);
result(tileAt(DY.x, DY.y) === T.Dairy, "Dairy built once a Livestock Barn stands");
await setExact("hide", 2);
await setExact("milk", 8);
await setExact("rennet", 0);
await setExact("cheese", 0);
await staffed(DY.x, DY.y);
await runUntil(async () => (await total("cheese")) >= 4);
const it5 = (await prog()).items;
result(it5.cheese === 4 && !it5.milk && !it5.hide && it5.rennet === 2, `rennet from 2 hides (4), then 2 cheese x2 from 8 milk: cheese ${it5.cheese}, rennet ${it5.rennet}, milk ${it5.milk ?? 0}, hide ${it5.hide ?? 0}`);
await demolish(DY.x, DY.y);

// 6. Cellar: needs bricks; no worker; food keeps longer by its level
const CE = { x: B.x + 5, y: B.y + 5 };
ev = c.events.length;
await tryPlace(CE.x, CE.y, T.Cellar);
result(tileAt(CE.x, CE.y) === T.Empty && /Cellar needs: 6 Bricks/.test(evSince(ev)), `Cellar locked: ${evSince(ev)}`);
await setExact("bricks", 6);
await setExact("clayPot", 0);
await place(CE.x, CE.y, T.Cellar);
await ff(40);
const ceInfo = await info(CE.x, CE.y);
a = await agri();
result(tileAt(CE.x, CE.y) === T.Cellar && !c.snap.colonists.some((u) => u.postX === CE.x && u.postY === CE.y) && Math.abs(a.keep - 0.7) < 1e-9
  && (ceInfo.progression ?? []).some((l) => /Cellar level 1: food spoils 30% slower/.test(l)), `Cellar level 1, no worker, keep ${a.keep}: ${JSON.stringify(ceInfo.progression)}`);
send({ type: "upgradeBuilding", tileX: CE.x, tileY: CE.y });
await sleep(300);
await ff(2);
a = await agri();
result((await info(CE.x, CE.y)).level === 2 && a.cellarLevel === 2 && Math.abs(a.keep - 0.55) < 1e-9, `Cellar level 2: keep ${a.keep}`);
await setExact("clayPot", 15);
await setStock({ meat: 1000 });
await agri({ set: { carry: null } });
a = await agri({ spoil: true });
result(Math.abs(a.keep - 0.385) < 1e-9 && a.spoiled.meat === 19 && a.snapshot.cellar === 0.45 && a.snapshot.pots === 0.3,
  `pots and the Cellar multiply: keep ${a.keep}, 1000 meat lose ${a.spoiled.meat}; snapshot ${JSON.stringify(a.snapshot)}`);

// 7. preserved foods are eaten only after the grain / meat / fruit
await clearFoodItems();
await agri({ set: { sick: null, spoiled: 0 } });
await setItems({ cheese: 10 });
await setStock({ grain: 1000, meat: 0, fruit: 0 });
await agri({ eat: true });
const cheeseA = await total("cheese");
const grainA = (await stock()).grain;
await setStock({ grain: 0 });
await agri({ eat: true });
const cheeseB = await total("cheese");
result(cheeseA === 10 && grainA < 1000 && cheeseB < 10, `grain eaten first (cheese ${cheeseA}, grain ${grainA}); none left: cheese eaten (${cheeseB})`);

// 8. sickness: raw meat, then spoiled stores; hp and happiness; recovery
await clearFoodItems();
await agri({ set: { sick: null, spoiled: 0 } });
await setStock({ meat: 1000, grain: 0, fruit: 0 });
for (const p of (await agri()).persons) await hook("setColonistHp", { id: p.id, hp: p.maxHp });
a = await agri({ eat: true });
const n = a.persons.length;
const sick1 = a.persons.filter((p) => p.sick > 0);
result(n > 0 && sick1.length === Math.round(n * 0.2) && sick1.every((p) => p.hp === p.maxHp - 10) && Math.abs(a.parts.sickness - (12 * sick1.length) / n) < 1e-9,
  `raw meat only: ${sick1.length} of ${n} sick (hp ${sick1.map((p) => `${p.hp}/${p.maxHp}`).join(", ")}), happiness -${a.parts.sickness}`);
await agri({ set: { spoiled: 1000 } });
await setStock({ meat: 0, grain: 1000 });
a = await agri({ eat: true });
const sick2 = a.persons.filter((p) => p.sick > 0).length;
result(sick2 === Math.round(n * 0.6), `spoiled stores: ${sick2} of ${n} sick (target ${Math.round(n * 0.6)})`);
await setStock({ grain: 0 });
await setItems({ smokedMeat: 500 });
a = await agri({ eat: true });
const sick3 = a.persons.filter((p) => p.sick > 0).length;
a = await agri({ eat: true });
a = await agri({ eat: true });
const sick4 = a.persons.filter((p) => p.sick > 0).length;
result(sick3 > 0 && sick4 === 0 && a.parts.sickness === 0, `smoked meat is safe: nobody new falls sick; all recover (${sick3} -> ${sick4})`);
await clearFoodItems();

// 9. the sourdough starter: lost untended; kept while a baker tends it; lost when the Bakery burns
await setExact("sourdoughStarter", 1);
await agri({ set: { untended: 0 } });
await agri({ dawn: true });
await agri({ dawn: true });
const kept2 = await total("sourdoughStarter");
ev = c.events.length;
a = await agri({ dawn: true });
const lost3 = await total("sourdoughStarter");
result(kept2 === 1 && lost3 === 0 && /sourdough starter is lost: no baker tended the Bakery for 3 days/.test(evSince(ev)), `untended 3 days: kept after 2 (${kept2}), lost after 3: ${evSince(ev)}`);
await setExact("clayOven", 1);
await raw(B.x + 14, B.y + 5, T.Mill);
const BK = { x: B.x + 9, y: B.y + 5 };
await place(BK.x, BK.y, T.Bakery);
await staffed(BK.x, BK.y);
await setExact("flour", 0);
await setExact("sourdoughStarter", 1);
await agri({ set: { untended: 2 } });
a = await agri({ dawn: true });
const bkInfo = await info(BK.x, BK.y);
result(tileAt(BK.x, BK.y) === T.Bakery && (await total("sourdoughStarter")) === 1 && a.state.untended === 0 && (bkInfo.progression ?? []).some((l) => /Sourdough starter: kept/.test(l)),
  `a baker at the Bakery tends it: untended ${a.state.untended}; ${JSON.stringify(bkInfo.progression)}`);
const hp0 = (await hook("damageBuilding", { tx: BK.x, ty: BK.y })).structure;
await hook("damageBuilding", { tx: BK.x, ty: BK.y, amount: Math.ceil(hp0.max * 0.3) });
const keptHit = await total("sourdoughStarter");
ev = c.events.length;
await hook("damageBuilding", { tx: BK.x, ty: BK.y, amount: Math.ceil(hp0.max * 0.3) });
result(keptHit === 1 && (await total("sourdoughStarter")) === 0 && /starter is lost: the Bakery burned/.test(evSince(ev)), `a scratch keeps it (${keptHit}); a fire below half HP loses it: ${evSince(ev)}`);

// 10. the iron plow: the Blacksmith forges one from 2 iron blooms
await setExact("anvil", 1);
await setExact("smithTools", 1);
await raw(B.x + 18, B.y + 5, T.Bloomery);
await demolish(BK.x, BK.y);
const BS = { x: B.x + 1, y: B.y + 9 };
await place(BS.x, BS.y, T.Blacksmith);
await staffed(BS.x, BS.y);
await setExact("ironPlow", 0);
await setExact("ironBloom", 2);
await runUntil(async () => (await total("ironPlow")) >= 1);
const it10 = (await prog()).items;
a = await agri();
result(it10.ironPlow === 1 && !it10.ironBloom && a.plow.growth === 1.25 && a.plow.yield === 1.25, `iron plow forged (blooms ${it10.ironBloom ?? 0}): plow ${JSON.stringify(a.plow)}`);
await setExact("ironBloom", 10);
await ff(80);
result((await total("ironPlow")) === 1, "one plow is enough (cap 1)");
await demolish(BS.x, BS.y);

// 11. hops on a hero plot (seed bag), the plow's growth and yield; a hop field zone
const P = { x: B.x + 10, y: B.y + 10 };
const zs = (args = {}) => hook("zoneState", args);
const plotAt = (s, x, y) => s.plots.find((p) => p.x === x && p.y === y);
await hook("heroLife", { needs: false, energy: 100, water: 20, pack: {} });
await tp(P.x - 1, P.y);
await hook("heroLife", { use: { tool: "hoe", tx: P.x, ty: P.y } });
await ff(25);
await setExact("hopSeeds", 2);
await hook("heroLife", { use: { tool: "seeds", tx: P.x, ty: P.y, crop: "hops" } });
await ff(15);
let zsv = await zs();
result(plotAt(zsv, P.x, P.y)?.stage === 2 && plotAt(zsv, P.x, P.y)?.crop === "hops" && (await total("hopSeeds")) === 1, `hops sown on a hero plot (a hop cutting used): ${JSON.stringify(plotAt(zsv, P.x, P.y))}`);
await setExact("ironPlow", 0);
await zs({ setCropAt: { x: P.x, y: P.y, tended: true, progress: 0 } });
await zs({ tickZones: true });
const g0 = plotAt(await zs(), P.x, P.y).progress;
await setExact("ironPlow", 1);
await zs({ setCropAt: { x: P.x, y: P.y, tended: true, progress: 0 } });
await zs({ tickZones: true });
const g1 = plotAt(await zs(), P.x, P.y).progress;
result(g0 > 0 && Math.abs(g1 / g0 - 1.25) < 1e-9, `the iron plow grows fields 25% faster: ${g0} -> ${g1}`);
await zs({ setCropAt: { x: P.x, y: P.y, stage: 4 } });
const hops0 = await total("hops");
ev = c.events.length;
await setExact("scythe", 1);
await hook("heroLife", { use: { tool: "scythe", tx: P.x, ty: P.y } });
await ff(20);
const hops1 = await total("hops");
result(hops1 - hops0 === 3, `hops harvested straight into the stores, x1.25 with the plow (2 -> 3): ${hops0} -> ${hops1} ${evSince(ev)}`);
const HZ = { x: B.x + 14, y: B.y + 10 };
await tp(HZ.x - 1, HZ.y);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "hops", tiles: [HZ.x, HZ.y, HZ.x + 1, HZ.y] });
await ff(1);
zsv = await zs();
const hz = zsv.zones.find((z) => z.crop === "hops");
result(!!hz && /^Hop field/.test(hz.name) && hz.size === 2, `a hop field zone: ${JSON.stringify(hz)}`);

// 12. ale: the Brewery brews hopped ale; happiness by grade; drunk at dawn
const BR = { x: B.x + 5, y: B.y + 9 };
await place(BR.x, BR.y, T.Brewery);
await staffed(BR.x, BR.y);
await setExact("ale", 0);
await setExact("hops", 2);
await setStock({ grain: 500 });
await runUntil(async () => (await total("ale")) >= 4);
const aleG = await grades("ale");
a = await agri();
result(aleG[0] === 4 && !(await total("hops")) && a.parts.ale === 3, `2 hops -> 4 Poor ale ${JSON.stringify(aleG)}: happiness +${a.parts.ale}`);
await setItems({ ale: 1 }, 3);
a = await agri();
result(a.parts.ale === 8, `a Fine ale in store: +${a.parts.ale}`);
await clearFoodItems();
await setItems({ ale: 20 });
await setStock({ grain: 1000 });
const people = (await agri()).persons.length;
await agri({ eat: true });
result((await total("ale")) === 20 - Math.ceil(people / 4), `dawn: ${people} people drink ${Math.ceil(people / 4)} ale (left ${await total("ale")})`);
await demolish(BR.x, BR.y);

// 13. orchard years: a sapling bears little; yield by age
const OR = { x: B.x + 18, y: B.y + 9 };
await place(OR.x, OR.y, T.Orchard);
await staffed(OR.x, OR.y, "farmhand");
a = await agri();
const orch = a.orchards.find((o) => o.x === OR.x && o.y === OR.y);
let orInfo = await info(OR.x, OR.y);
result(tileAt(OR.x, OR.y) === T.Orchard && !!orch && (orInfo.progression ?? []).some((l) => /Orchard age: 0 years: fruit x0.25; x0.6 at 1 year/.test(l)),
  `a new orchard is a sapling (planted day ${orch?.day}): ${JSON.stringify(orInfo.progression)}`);
const batch = async () => {
  const f0 = (await stock()).fruit;
  let f1 = f0;
  for (let i = 0; i < 30 && f1 === f0; i++) {
    await agri({ ripenAt: OR });
    await ff(10);
    f1 = (await stock()).fruit;
  }
  return f1 - f0;
};
const y0 = await batch();
await agri({ orchard: { x: OR.x, y: OR.y, daysAgo: 3 * 28 } });
orInfo = await info(OR.x, OR.y);
const y3 = await batch();
result(y0 > 0 && y3 > 0 && Math.abs(y3 / y0 - 1.2 / 0.25) < 0.5 && (orInfo.progression ?? []).some((l) => /Orchard age: 3 years: fruit x1.2 \(mature\)/.test(l)),
  `fruit per batch: sapling ${y0}, 3 years ${y3} (x${(y3 / y0).toFixed(2)}); ${JSON.stringify(orInfo.progression)}`);

// 14. seasons off / COLONY_UNLOCK_ALL: the new rules are off (older suites)
await hook("calendar", { off: true });
a = await agri();
const offSeasons = a.on === false && a.snapshot === null && a.sickPenalty === 0;
await hook("calendar", { off: false });
await prog({ unlockAll: true });
a = await agri();
const offUnlock = a.on === false && a.ale === 0;
await prog({ unlockAll: false });
result(offSeasons && offUnlock, `seasons off: rules off (${offSeasons}); COLONY_UNLOCK_ALL: off (${offUnlock})`);

// 15. save / load
await setExact("cheese", 7);
await setExact("salt", 3);
await setItems({ ale: 2 }, 2);
const someone = (await agri()).persons[0].id;
await agri({ set: { untended: 1, sick: { [someone]: 2 } } });
const before = (await prog()).items;
const orchBefore = (await agri()).orchards.find((o) => o.x === OR.x && o.y === OR.y);
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await prog({ reset: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
await sleep(300);
const after = await prog();
a = await agri();
const orchAfter = a.orchards.find((o) => o.x === OR.x && o.y === OR.y);
result(["cheese", "salt", "ale", "ironPlow", "hops", "bricks"].every((id) => after.items[id] === before[id]) && after.snapshot.items.ale?.[1] === 2
  && after.unlocked.includes(T.SaltWorks) && after.unlocked.includes(T.Cellar), `items and unlocks survive: ${JSON.stringify(after.items)}`);
result(a.state?.untended === 1 && a.state?.sick?.[someone] === 2 && orchAfter?.day === orchBefore?.day && a.cellarLevel === 2 && tileAt(CE.x, CE.y) === T.Cellar,
  `agri state, the orchard's planting day (${orchAfter?.day}) and the level-2 Cellar survive: ${JSON.stringify(a.state)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
