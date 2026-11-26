// Scripted test: industry extras (ROADMAP "Industry extras — landed"; PLAN-agri-industry-winter-mines.md phase 6).
// Needs a private server with COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, W80 and NOT
// COLONY_UNLOCK_ALL (scripts/run-tests.mjs gives all of that: `npm test -- industry-extra`). Checks: one furnace
// (2026-11-19): the Foundry is retired (not placeable) and the Bloomery smelts bronze (charcoal, coal), casts bronze tools
// (hero / worker speed); tier-1 weapons and armour are forged from bronze at the Blacksmith (no iron; soldiers take them
// from the armoury stock, there is no separate bronze weapon item); no deposit tiles at world gen any more (mining rework 2026-11-26; layered
// mines 2026-11-19: the Lime Quarry / Gold / Lead Mine are no longer buildable, a Mine digs those ores by level); the Stamp Mill
// (water, gates; gold dust, washed tin, sand) and bronze from washed tin; steel only at a Blast furnace (Bloomery 2+)
// with limestone flux, Fine steel forging a tier better; the Glassworks (glass, window glass glazing rooms' windows,
// bottles for ale); the Mint (coins into the treasury); lead (Bloomery) and lead-glazed tableware (Kiln); COLONY_UNLOCK_ALL switches the effects off; save / load keeps
// it all.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = {
  Empty: 0, Wall: 1, IronMinePost: 9, WoodDoor: 110, WoodWindow: 112, Bed: 116, ClayPit: 147, Kiln: 148, Glassworks: 165, Mint: 166, Blacksmith: 26, CharcoalBurner: 100, Bloomery: 101, RockMinePost: 10, Water: 35, CopperMine: 153, TinMine: 154, Foundry: 159, StampMill: 160,
  Limestone: 161, GoldOre: 162, LimeQuarry: 163, GoldMine: 164, LeadOre: 167, LeadMine: 168,
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

// 1. locks in a new game; no deposit tiles on the map (mining rework)
const s0 = (await prog()).snapshot;
const lk = (t) => JSON.stringify(s0.locked[t] ?? []);
result((s0.locked[T.Bloomery] ?? []).includes("8 Bricks") && !(s0.locked[T.Bloomery] ?? []).some((l) => /Bellows|Blacksmith|Iron|Hide/.test(l))
  && (s0.locked[T.StampMill] ?? []).includes("Carpenter's tools") && (s0.locked[T.StampMill] ?? []).includes("a Mine")
  && (s0.locked[T.Glassworks] ?? []).includes("a Kiln") && (s0.locked[T.Glassworks] ?? []).includes("a Stamp Mill")
  && (s0.locked[T.Mint] ?? []).includes("a Stamp Mill") && (s0.locked[T.Mint] ?? []).includes("a Blacksmith"),
  `locks: Bloomery ${lk(T.Bloomery)}, Stamp Mill ${lk(T.StampMill)}, Glassworks ${lk(T.Glassworks)}, Mint ${lk(T.Mint)}`);
const count = (t) => c.tiles.filter((v) => v === t).length;
// Mining rework (2026-11-26): the deposit tiles are retired; limestone, gold and lead ore come from the Mine's layers.
result(count(T.Limestone) === 0 && count(T.GoldOre) === 0 && count(T.LeadOre) === 0, `world gen makes no deposit veins: limestone ${count(T.Limestone)}, gold ore ${count(T.GoldOre)}, lead ore ${count(T.LeadOre)}`);

// 2. one furnace: the Foundry is retired (not placeable); the Bloomery (charcoal, bricks, a Charcoal Burner; no bellows,
// iron or Blacksmith) smelts bronze
const FO = { x: B.x + 1, y: B.y + 1 };
await setExact("crucible", 1);
await raw(B.x + 20, B.y + 1, T.IronMinePost);
await tryPlace(FO.x, FO.y, T.Foundry);
result(tileAt(FO.x, FO.y) === T.Empty, `the Foundry can no longer be built (tile ${tileAt(FO.x, FO.y)})`);
let ev = c.events.length;
await tryPlace(FO.x, FO.y, T.Bloomery);
result(tileAt(FO.x, FO.y) === T.Empty && /Bloomery needs: 2 Charcoal, 8 Bricks, a Charcoal Burner/.test(evSince(ev)), `Bloomery locked: ${evSince(ev)}`);
await setExact("bellows", 0);
await setExact("bricks", 8);
await setExact("charcoal", 2);
await raw(B.x + 20, B.y + 5, T.CharcoalBurner);
await place(FO.x, FO.y, T.Bloomery);
result(tileAt(FO.x, FO.y) === T.Bloomery, "Bloomery built with no bellows, iron or Blacksmith");

// 3. bronze at the Bloomery: copper + tin + charcoal, the tools cast as soon as there is bronze; coal when there is no
// charcoal (the bronze anvil and hammer & tongs, cast first, are in store already: mines-test covers them). No iron
// ore in store, so no blooms get in the way.
await setStock({ iron: 0 });
for (const id of ["bronze", "bronzeTools"]) await setExact(id, 0);
await setExact("anvil", 1);
await setExact("smithTools", 1);
await setExact("copperOre", 6);
await setExact("tinOre", 4);
await setExact("charcoal", 2);
await setExact("coal", 0);
await staffed(FO.x, FO.y);
await runUntil(async () => (await total("bronzeTools")) >= 1 && (await total("copperOre")) === 0);
await ff(20 * 45);
let it = (await prog()).items;
result(it.bronzeTools === 1 && (it.copperOre ?? 0) === 0 && (it.tinOre ?? 0) === 0 && (it.charcoal ?? 0) === 0 && it.bronze === 2,
  `2 smelts (6 copper, 4 tin, 2 charcoal -> 4 bronze) cast 1 bronze tools, 2 bronze kept: ${JSON.stringify({ t: it.bronzeTools, cu: it.copperOre, sn: it.tinOre, ch: it.charcoal, b: it.bronze })}`);
await setExact("copperOre", 3);
await setExact("tinOre", 2);
await setExact("coal", 1);
await setExact("bronze", 0);
await runUntil(async () => (await total("bronze")) >= 2);
await ff(20 * 45);
it = (await prog()).items;
result(it.bronze === 2 && (it.coal ?? 0) === 0 && it.bronzeWeapon === undefined, `coal smelts bronze; no bronze weapon item: ${JSON.stringify({ coal: it.coal, b: it.bronze, w: it.bronzeWeapon })}`);
const foInfo = await info(FO.x, FO.y);
result((foInfo.progression ?? []).some((l) => /Smelter L1/.test(l)), `the smelter trains: ${JSON.stringify(foInfo.progression)}`);
await setStock({ iron: 500 });

// 4. bronze tools: x1.2 for the hero, woodcutters and miners (not smiths); none in store, x1
let ind = await industry();
result(ind.tools.hero === 1.2 && ind.tools.miner === 1.2 && ind.tools.woodcutter === 1.2 && ind.tools.smith === 1, `bronze tools in store: ${JSON.stringify(ind.tools)}`);
await setExact("bronzeTools", 0);
ind = await industry();
result(ind.tools.hero === 1 && ind.tools.miner === 1, `no bronze tools: ${JSON.stringify(ind.tools)}`);
await setExact("bronzeTools", 1);
await demolish(FO.x, FO.y);

// 5. tier-1 gear IS bronze: soldiers muster unarmed with an empty armoury, then take the tier-1 (bronze) weapon and
// cuirass from the armoury stock. No monsters about (the knights would go hunting them).
for (const m of c.snap.mobs ?? []) send({ type: "testHook", op: "damageMob", mobId: m.id, amount: 100000 });
await ff(5);
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
const SP = { x: B.x + 10, y: B.y + 8 };
const knightId = (await hook("spawnSoldier", { kind: "knight", x: SP.x * TILE + 16, y: SP.y * TILE + 16, stance: "defensive" })).id;
const knight2 = (await hook("spawnSoldier", { kind: "knight", x: (SP.x + 2) * TILE + 16, y: SP.y * TILE + 16, stance: "defensive" })).id;
ind = await industry({ unit: knightId });
result(ind.unit?.weapon === 1 && ind.unit.armour === 1 && ind.unit.bronzeWeapon === undefined, `a knight musters with an empty armoury: ${JSON.stringify(ind.unit)}`);
await hook("setEquipment", { armour: [2, 0, 0], weapon: [2, 0, 0] });
await runUntil(async () => (await hook("equipState")).equipment.weapon[0] === 0, 6, 20 * 3);
const eq = await hook("equipState");
const k1 = eq.units.find((u) => u.id === knightId);
ind = await industry({ unit: knight2 });
result(k1?.armourTier === 1 && k1.weaponTier === 1 && ind.unit?.weaponTier === 1 && ind.unit.weapon === 1.2 && ind.unit.armour === 0.85,
  `idle knights take the tier-1 (bronze) weapon and cuirass from the armoury stock: ${JSON.stringify(k1)}, ${JSON.stringify(ind.unit)}`);

// 6. the old deposit mines are no longer buildable (a Mine digs limestone, gold and lead ore by level)
const LQ = { x: B.x + 4, y: B.y + 4 };
await raw(B.x + 20, B.y + 3, T.RockMinePost);
await raw(LQ.x, LQ.y, T.Limestone);
await tryPlace(LQ.x, LQ.y, T.LimeQuarry);
const GM = { x: B.x + 7, y: B.y + 4 };
await raw(GM.x, GM.y, T.GoldOre);
await tryPlace(GM.x, GM.y, T.GoldMine);
result(tileAt(LQ.x, LQ.y) === T.Limestone && tileAt(GM.x, GM.y) === T.GoldOre, `Lime Quarry / Gold Mine no longer placeable: tiles ${tileAt(LQ.x, LQ.y)}, ${tileAt(GM.x, GM.y)}`);

// 7. the Stamp Mill: water near, carpenter's tools; gold dust, washed tin, sand
const SM = { x: B.x + 14, y: B.y + 8 };
ev = c.events.length;
await tryPlace(SM.x, SM.y, T.StampMill);
result(tileAt(SM.x, SM.y) === T.Empty && /Stamp Mill needs water within 3 tiles/.test(evSince(ev)), `dry ground refused: ${evSince(ev)}`);
await raw(SM.x, SM.y + 3, T.Water);
await setExact("carpenterTools", 0);
ev = c.events.length;
await tryPlace(SM.x, SM.y, T.StampMill);
result(tileAt(SM.x, SM.y) === T.Empty && /Stamp Mill needs: Carpenter's tools/.test(evSince(ev)), `the tools gate: ${evSince(ev)}`);
await setExact("carpenterTools", 1);
await place(SM.x, SM.y, T.StampMill);
result(tileAt(SM.x, SM.y) === T.StampMill, "Stamp Mill built beside water");
for (const id of ["goldDust", "washedTin", "sand"]) await setExact(id, 0);
await setExact("goldOre", 3);
await setExact("tinOre", 2);
const rock0 = (await stock()).rock;
await staffed(SM.x, SM.y);
await runUntil(async () => (await total("sand")) >= 2);
it = (await prog()).items;
const rock1 = (await stock()).rock;
result(it.goldDust === 1 && it.washedTin === 3 && (it.goldOre ?? 0) === 0 && (it.tinOre ?? 0) === 0 && it.sand >= 2 && rock1 <= rock0 - 3,
  `gold first (3 ore -> ${it.goldDust} dust), tin (2 ore -> ${it.washedTin} washed), then sand (${it.sand}; stone ${rock0} -> ${rock1})`);
// iron ore is crushed too (3 ore -> 4 crushed iron), stone or no stone
await setExact("crushedIron", 0);
const stock0 = await stock();
// ...but never below the lamp / pump reserve (6 iron): 8 in store crushes nothing, 9 crushes one batch and keeps 6
await setStock({ iron: 8, rock: 0 });
await runUntil(async () => (await total("crushedIron")) >= 4, 6, 40);
result((await total("crushedIron")) === 0 && (await stock()).iron === 8, `iron at 8 (reserve 6 + 3 needed = 9): nothing crushed (${await total("crushedIron")} crushed, iron ${(await stock()).iron})`);
await setStock({ iron: 9, rock: 0 });
await runUntil(async () => (await total("crushedIron")) >= 4);
result((await total("crushedIron")) === 4 && (await stock()).iron === 6, `the Stamp Mill crushes iron ore down to the reserve: 3 ore -> ${await total("crushedIron")} crushed (iron ${(await stock()).iron}, kept 6 for lamps / pumps)`);
await setStock({ iron: stock0.iron, rock: stock0.rock });
await setExact("crushedIron", 0);
const smInfo = await info(SM.x, SM.y);
result((smInfo.progression ?? []).some((l) => /Ore washer L1/.test(l)), `the ore washer trains: ${JSON.stringify(smInfo.progression)}`);
await demolish(SM.x, SM.y);
// washed tin makes more bronze at the Bloomery
await place(FO.x, FO.y, T.Bloomery);
await setStock({ iron: 0 });
for (const id of ["bronze", "tinOre", "coal"]) await setExact(id, 0);
await setExact("copperOre", 3);
await setExact("washedTin", 2);
await setExact("charcoal", 1);
await staffed(FO.x, FO.y);
await runUntil(async () => (await total("bronze")) >= 3);
it = (await prog()).items;
result(it.bronze === 3 && (it.washedTin ?? 0) === 0 && (it.copperOre ?? 0) === 0, `3 copper + 2 washed tin + 1 charcoal -> ${it.bronze} bronze (ore tin: 2 bronze)`);
await demolish(FO.x, FO.y);
await setStock({ iron: 500 });

// 8. steel: only at a Blast furnace (Bloomery level 2+) with a level-2 smelter; blooms + limestone flux + charcoal
const BL = { x: B.x + 4, y: B.y + 11 };
await raw(B.x + 20, B.y + 7, T.CharcoalBurner);
await setItems({ bellows: 1, bricks: 8, anvil: 1, smithTools: 1 });
await setExact("charcoal", 2);
await place(BL.x, BL.y, T.Bloomery);
result(tileAt(BL.x, BL.y) === T.Bloomery, "Bloomery built");
await setStock({ iron: 0 });
for (const id of ["copperOre", "tinOre", "washedTin", "leadOre", "goldOre", "bronze"]) await setExact(id, 0);
await setExact("steel", 0);
await setExact("ironBloom", 2);
await setExact("limestone", 1);
await staffed(BL.x, BL.y);
await prog({ xpAt: { x: BL.x, y: BL.y, xp: 100 } });
await ff(20 * 70);
let blInfo = await info(BL.x, BL.y);
result((await total("steel")) === 0 && (blInfo.progression ?? []).some((l) => /Steel: needs a level-2 Bloomery/.test(l)), `no steel in a level-1 Bloomery: ${JSON.stringify(blInfo.progression)}`);
const BS = { x: B.x + 8, y: B.y + 11 };
ev = c.events.length;
// One furnace: the Blacksmith needs a Bloomery (and its bronze anvil, hammer & tongs) and no iron, not even to build.
await place(BS.x, BS.y, T.Blacksmith);
result(tileAt(BS.x, BS.y) === T.Blacksmith, `Blacksmith built: ${evSince(ev)}`);
await setExact("crucible", 1);
await tp(BL.x - 1, BL.y - 1);
send({ type: "upgradeBuilding", tileX: BL.x, tileY: BL.y });
await sleep(400);
await runUntil(async () => (await total("steel")) >= 1, 30, 40);
blInfo = await info(BL.x, BL.y);
const steelG = await grades("steel");
it = (await prog()).items;
result(blInfo.level === 2 && steelG[1] === 1 && (it.ironBloom ?? 0) === 0 && (it.limestone ?? 0) === 0 && (it.charcoal ?? 0) === 0,
  `the Blast furnace (level ${blInfo.level}) with a level-2 smelter makes Good steel: ${JSON.stringify(steelG)}; blooms ${it.ironBloom}, limestone ${it.limestone}, charcoal ${it.charcoal}`);
await demolish(BL.x, BL.y);

// Fine steel at the forge: each piece a tier better (one Fine steel each); Good steel counts for nothing
await setStock({ iron: 200, wood: 2000 });
await hook("gearPickupConfig", { enabled: false }); // the knights would take the new pieces
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
await staffed(BS.x, BS.y);
await prog({ xpAt: { x: BS.x, y: BS.y, xp: 100 } });
await setItems({ steel: 1 }, 3);
await setExact("bronze", 0);
let wOpt = (await info(BS.x, BS.y)).forge?.options.find((o) => o.slot === "weapon");
result(/2 bronze/.test(wOpt?.cost ?? "") && !/iron/.test(wOpt?.cost ?? "") && wOpt?.enabled === false && /bronze/i.test(wOpt?.reason ?? ""),
  `T1 weapons cost bronze, refused without it: ${wOpt?.cost} (${wOpt?.reason})`);
await setExact("bronze", 4);
const ironW = (await stock()).iron;
wOpt = (await info(BS.x, BS.y)).forge?.options.find((o) => o.slot === "weapon");
result(/Bronze Weapon T1 \(T2 with Fine steel\)/.test(wOpt?.label ?? ""), `forge label: ${wOpt?.label} (${wOpt?.reason || "ok"})`);
send({ type: "queueForge", tileX: BS.x, tileY: BS.y, slot: "weapon" });
await runUntil(async () => { const e = (await hook("equipState")).equipment; return e.weapon[0] + e.weapon[1] > 0; }, 20, 20);
let eqs = (await hook("equipState")).equipment;
let sg = await grades("steel");
result(eqs.weapon[1] === 1 && eqs.weapon[0] === 0 && sg[2] === 0 && sg[1] === 1, `a level-1 forge with Fine steel made a T2 weapon: weapons ${JSON.stringify(eqs.weapon)}, steel ${JSON.stringify(sg)}`);
send({ type: "queueForge", tileX: BS.x, tileY: BS.y, slot: "weapon" });
await runUntil(async () => (await hook("equipState")).equipment.weapon[0] > 0, 20, 20);
eqs = (await hook("equipState")).equipment;
sg = await grades("steel");
result(eqs.weapon[0] === 1 && eqs.weapon[1] === 1 && sg[1] === 1, `no Fine steel left: a plain T1 weapon, the Good steel kept: weapons ${JSON.stringify(eqs.weapon)}, steel ${JSON.stringify(sg)}`);
result((await total("bronze")) === 0 && (await stock()).iron === ironW, `two T1 weapons took 4 bronze and no iron (iron ${ironW} -> ${(await stock()).iron})`);
// Tier-1 armour is bronze (2026-11-19): 3 bronze and no iron; refused with no bronze in store
await setExact("bronze", 0);
let aOpt = (await info(BS.x, BS.y)).forge?.options.find((o) => o.slot === "armour");
result(/3 bronze/.test(aOpt?.cost ?? "") && !/iron/.test(aOpt?.cost ?? "") && aOpt?.enabled === false && /bronze/i.test(aOpt?.reason ?? ""),
  `T1 armour costs bronze, refused without it: ${aOpt?.cost} (${aOpt?.reason})`);
await setExact("bronze", 3);
const ironBefore = (await stock()).iron;
send({ type: "queueForge", tileX: BS.x, tileY: BS.y, slot: "armour" });
await runUntil(async () => (await hook("equipState")).equipment.armour[0] > 0, 20, 20);
eqs = (await hook("equipState")).equipment;
result(eqs.armour[0] === 1 && (await total("bronze")) === 0 && (await stock()).iron === ironBefore,
  `a T1 (bronze) cuirass forged from 3 bronze, no iron: armour ${JSON.stringify(eqs.armour)}, iron ${ironBefore} -> ${(await stock()).iron}`);
// The hero wears it: taken from the armoury it is a Bronze Cuirass (and a Bronze Helm as head armour), equipped.
send({ type: "takeFromArmoury", slot: "armour", tier: 1 });
await sleep(300);
let hs = await hook("heroState");
const cuirass = hs.profile.inventory.find((i) => i.tier === 1 && i.slot === "chest");
send({ type: "equipItem", itemId: cuirass?.id, slot: "chest" });
await sleep(300);
hs = await hook("heroState");
result(cuirass?.name === "Bronze Cuirass" && hs.profile.equipment.chest?.name === "Bronze Cuirass" && cuirass.stats.damageTakenPct === -15 && (await hook("equipState")).equipment.armour[0] === 0,
  `the hero wears the tier-1 bronze armour: ${JSON.stringify(cuirass)}; equipped ${hs.profile.equipment.chest?.name}`);
await hook("setEquipment", { armour: [1, 0, 0], weapon: [0, 0, 0] });
send({ type: "takeFromArmoury", slot: "armour", tier: 1, armourPart: "head" });
await sleep(300);
hs = await hook("heroState");
result(hs.profile.inventory.some((i) => i.name === "Bronze Helm" && i.slot === "head"), `tier-1 head armour is a Bronze Helm: ${JSON.stringify(hs.profile.inventory.map((i) => i.name))}`);
await demolish(BS.x, BS.y);
await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
await hook("gearPickupConfig", { enabled: true });

// 9. the Glassworks: a Kiln and a Stamp Mill; glass from sand + limestone, then window glass, then bottles
const GW = { x: B.x + 17, y: B.y + 11 };
ev = c.events.length;
await tryPlace(GW.x, GW.y, T.Glassworks);
result(tileAt(GW.x, GW.y) === T.Empty && /Glassworks needs: a Kiln, a Stamp Mill/.test(evSince(ev)), `Glassworks locked: ${evSince(ev)}`);
await raw(B.x + 20, B.y + 9, T.Kiln);
await raw(B.x + 20, B.y + 11, T.StampMill);
await place(GW.x, GW.y, T.Glassworks);
result(tileAt(GW.x, GW.y) === T.Glassworks, "Glassworks built once a Kiln and a Stamp Mill stand");
for (const id of ["glass", "glassPanes", "bottles", "coal"]) await setExact(id, 0);
await setExact("sand", 4);
await setExact("limestone", 2);
await setExact("charcoal", 2);
await staffed(GW.x, GW.y);
await runUntil(async () => (await total("glassPanes")) >= 4);
it = (await prog()).items;
result(it.glassPanes === 4 && (it.glass ?? 0) === 0 && (it.sand ?? 0) === 0 && (it.limestone ?? 0) === 0, `2 melts (4 sand, 2 limestone) -> 4 glass -> 4 window glass: ${JSON.stringify({ panes: it.glassPanes, glass: it.glass, sand: it.sand, lime: it.limestone })}`);
await setExact("glassPanes", 20);
await setExact("glass", 2);
await runUntil(async () => (await total("bottles")) >= 4);
it = (await prog()).items;
result(it.bottles === 4 && (it.glass ?? 0) === 0, `window glass at its cap: 2 glass -> ${it.bottles} bottles`);
const gwInfo = await info(GW.x, GW.y);
result((gwInfo.progression ?? []).some((l) => /Glassblower L1/.test(l)), `the glassblower trains: ${JSON.stringify(gwInfo.progression)}`);
await demolish(GW.x, GW.y);

// window glass in store glazes the rooms' windows: no heat lost, more beauty
const R = { x0: B.x, y0: B.y + 4, x1: B.x + 4, y1: B.y + 7 };
for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) {
  const edge = x === R.x0 || x === R.x1 || y === R.y0 || y === R.y1;
  await raw(x, y, edge ? T.Wall : T.Empty);
}
await raw(R.x0 + 2, R.y1, T.WoodDoor);
await raw(R.x0 + 1, R.y0, T.WoodWindow);
await raw(R.x0 + 3, R.y0, T.WoodWindow);
await raw(R.x0 + 1, R.y0 + 1, T.Bed);
const inside = { x: R.x0 + 1, y: R.y0 + 1 };
const roomAt = async () => {
  const st = await hook("roomState", { tickRooms: true, fullRecompute: true });
  return st.rooms.find((q) => inside.x >= q.x0 && inside.x <= q.x1 && inside.y >= q.y0 && inside.y <= q.y1);
};
await setExact("glassPanes", 0);
const plain = await roomAt();
await setExact("glassPanes", 4);
const glazed = await roomAt();
result(!!plain && !!glazed && glazed.warmth === plain.warmth + 8 && glazed.beauty > plain.beauty,
  `2 windows: plain warmth ${plain?.warmth} beauty ${plain?.beauty}; glazed warmth ${glazed?.warmth} beauty ${glazed?.beauty}`);

// bottles in store with ale: the ale's happiness bonus is higher
await setExact("ale", 2);
await setExact("bottles", 0);
const aleBare = (await hook("agri")).ale;
await setExact("bottles", 4);
const aleBottled = (await hook("agri")).ale;
result(aleBottled === aleBare + 2 && aleBare > 0, `ale happiness: ${aleBare} without bottles, ${aleBottled} with 4 bottles`);

// 10. the Mint: a Stamp Mill and a Blacksmith; coins straight into the treasury
const MT = { x: B.x + 17, y: B.y + 1 };
ev = c.events.length;
await tryPlace(MT.x, MT.y, T.Mint);
result(tileAt(MT.x, MT.y) === T.Empty && /Mint needs: a Blacksmith/.test(evSince(ev)), `Mint locked (no Blacksmith standing): ${evSince(ev)}`);
await raw(B.x + 20, B.y + 13, T.Blacksmith);
await place(MT.x, MT.y, T.Mint);
result(tileAt(MT.x, MT.y) === T.Mint, "Mint built once a Stamp Mill and a Blacksmith stand");
await setExact("goldDust", 4);
await setExact("charcoal", 2);
await setExact("coal", 0);
const gold0 = (await stock()).gold;
await staffed(MT.x, MT.y);
await runUntil(async () => (await total("goldDust")) === 0 && (await stock()).gold >= gold0 + 40);
const gold1 = (await stock()).gold;
result((await total("goldDust")) === 0 && gold1 - gold0 === 40 && (await total("coins")) === 0, `2 strikes (4 gold dust) -> 10 Poor coins -> +${gold1 - gold0} gold (expected 40), no coins kept as items`);
const mtInfo = await info(MT.x, MT.y);
result((mtInfo.progression ?? []).some((l) => /Minter L1/.test(l)), `the minter trains: ${JSON.stringify(mtInfo.progression)}`);
await demolish(MT.x, MT.y);

// lead: the Bloomery smelts it when there is no bronze or iron to make; the Kiln glazes tableware with it (a grade better)
await place(FO.x, FO.y, T.Bloomery);
await setStock({ iron: 0 });
for (const id of ["lead", "copperOre", "tinOre", "washedTin", "bronze", "goldOre", "coal"]) await setExact(id, 0);
await setExact("leadOre", 2);
await setExact("charcoal", 1);
await staffed(FO.x, FO.y);
await runUntil(async () => (await total("lead")) >= 2);
it = (await prog()).items;
result(it.lead === 2 && (it.leadOre ?? 0) === 0 && (it.charcoal ?? 0) === 0, `2 lead ore + 1 charcoal -> ${it.lead} lead`);
// gold: the Bloomery smelts gold dust too (4 ore -> 1)
await setExact("goldDust", 0);
await setExact("goldOre", 4);
await setExact("charcoal", 1);
await runUntil(async () => (await total("goldDust")) >= 1);
it = (await prog()).items;
result(it.goldDust === 1 && (it.goldOre ?? 0) === 0, `4 gold ore + 1 charcoal -> ${it.goldDust} gold dust at the Bloomery`);
await demolish(FO.x, FO.y);
await setStock({ iron: 500 });
const KI = { x: B.x + 17, y: B.y + 4 };
await raw(B.x + 20, B.y + 12, T.ClayPit);
await place(KI.x, KI.y, T.Kiln);
await setExact("tableware", 0);
await setExact("lead", 1);
await setExact("clay", 2);
for (const [id, n] of [["bricks", 20], ["clayPot", 25], ["roofTiles", 8], ["crucible", 2]]) await setExact(id, n);
await staffed(KI.x, KI.y);
await runUntil(async () => (await total("tableware")) >= 2);
const tw = await grades("tableware");
result(tw[0] === 0 && tw[1] === 2 && (await total("lead")) === 0, `a level-1 potter fires lead-glazed tableware a grade better: ${JSON.stringify(tw)}`);
await demolish(KI.x, KI.y);

// 11. COLONY_UNLOCK_ALL: the effects are off (older suites)
await prog({ unlockAll: true });
ind = await industry({ unit: knight2 });
const offTools = ind.tools.hero === 1 && ind.tools.miner === 1;
const offForge = (await info(B.x + 20, B.y + 13)).forge?.options ?? [];
const glazedOff = await roomAt();
await prog({ unlockAll: false });
result(glazedOff?.warmth === plain?.warmth, `COLONY_UNLOCK_ALL: windows not glazed (warmth ${glazedOff?.warmth})`);
result(offTools && offForge.length === 2 && offForge.every((o) => /iron/.test(o.cost) && !/bronze/.test(o.cost)),
  `COLONY_UNLOCK_ALL: bronze tools x${ind.tools.hero}, T1 forging costs the old iron: ${offForge.map((o) => o.cost).join(" / ")}`);

// 12. save / load
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
result(["bronze", "bronzeTools", "copperOre", "crucible", "limestone", "goldDust", "washedTin", "sand", "steel", "glass", "glassPanes", "bottles", "lead", "tableware"].every((id) => after.items[id] === before[id]) && after.unlocked.includes(T.Bloomery) && !after.unlocked.includes(T.Foundry) && after.unlocked.includes(T.StampMill) && after.unlocked.includes(T.Glassworks) && after.unlocked.includes(T.Mint),
  `items and unlocks survive: ${JSON.stringify(after.items)}`);
result(ind.unit?.weaponTier === 1 && ind.unit.weapon === 1.2, `a knight's tier-1 (bronze) weapon survives: ${JSON.stringify(ind.unit)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
