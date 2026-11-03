// Scripted test: the progression tree (ROADMAP "Progression tree — landed"). Needs a private server with
// COLONY_TEST_HOOKS=1, a scratch COLONY_SAVE_DIR, instant build, NOT COLONY_UNLOCK_ALL (scripts/run-tests.mjs gives
// all of that). Checks: a new game's kit and locks; a hand craft; placing a locked building is refused; a station
// upgrade needs its worker's next level (phase 2); a level-1 smith can't forge gear; the tier speed line; the tree
// survives save / load; old saves are grandfathered.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = { Empty: 0, Lumberjack: 3, Hunter: 50, Blacksmith: 26, KnightPost: 5, Barn: 16, Charcoal: 100, Bloomery: 101, Mill: 102, Bakery: 103 };
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
// A fresh normal game (no creative), raids off, daytime.
c.welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => c.welcome && c.snap, 30000);
await hook("setRaids", { enabled: false });
await hook("setCycleTick", { tick: 20 * 10 });
const tileAt = (x, y) => c.tiles[y * c.W + x];
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
// A placement is refused while someone stands on the tile (villagers wander): retry a few times when it should land.
const place = async (x, y, tile, want = tile, tries = want === tile ? 8 : 1) => {
  await tp(x - 1, y - 1);
  for (let i = 0; i < tries && tileAt(x, y) !== want; i++) {
    send({ type: "setTile", tileX: x, tileY: y, tile });
    await until(() => tileAt(x, y) === want, tries > 1 ? 400 : 1500);
  }
};
const info = async (x, y) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  await until(() => c.info !== undefined, 3000);
  return c.info;
};
const tc = c.snap.townCenters[0];
const B = { x: tc.x + 6, y: tc.y + 4 };
for (let y = B.y - 2; y <= B.y + 7; y++) for (let x = B.x - 2; x <= B.x + 10; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await hook("setStock", { stock: { wood: 500, rock: 500, iron: 500, grain: 500 } });

// 1. kit and locks
const r0 = await hook("progression", {});
const s0 = c.snap.progression;
result(!r0.open && r0.items.stoneAxe === 1 && r0.items.stonePick === 1, `new game: gates on, starter kit ${JSON.stringify(r0.items)}`);
result(!!s0 && (s0.locked[T.Hunter] ?? []).includes("Stone knife") && !s0.locked[T.Lumberjack], `snapshot locks: ${JSON.stringify(s0?.locked)}`);
result(s0.next.length > 0 && s0.crafts.some((r) => r.id === "stoneKnife" && r.ok), `next steps "${s0.next[0]}", ${s0.crafts.length} hand recipes`);

// 2. locked placement, craft, unlock
let ev = c.events.length;
await place(B.x, B.y, T.Hunter, T.Hunter);
result(tileAt(B.x, B.y) === T.Empty && c.events.slice(ev).some((e) => /Hunter's Hut needs: Stone knife/.test(e)), `locked Hunter's Hut refused: ${c.events.slice(ev).join(" | ")}`);
const woodBefore = c.snap.wood;
send({ type: "craftItem", recipe: "stoneKnife" });
await until(() => (c.snap.progression?.items?.stoneKnife?.[0] ?? 0) === 1, 3000);
result(c.snap.progression.items.stoneKnife?.[0] === 1 && c.snap.wood === woodBefore - 1, `knife crafted (wood ${woodBefore} -> ${c.snap.wood})`);
await place(B.x, B.y, T.Hunter);
result(tileAt(B.x, B.y) === T.Hunter, `Hunter's Hut built once the knife is in stock`);

// 3. upgrade-by-worker (phase 2)
const L = { x: B.x + 3, y: B.y };
await place(L.x, L.y, T.Lumberjack);
await until(() => c.snap.colonists.some((u) => u.kind === "lumberjack" && u.postX === L.x && u.postY === L.y), 5000);
ev = c.events.length;
send({ type: "upgradeBuilding", tileX: L.x, tileY: L.y });
await sleep(400);
let lvl = c.snap.buildingLevels?.[L.y * c.W + L.x];
const inf0 = await info(L.x, L.y);
result(c.events.slice(ev).some((e) => /needs: Woodcutter level 2/.test(e)) && (inf0.progression ?? []).some((l) => /Woodcutter L1/.test(l)),
  `lumberjack upgrade refused at worker L1: ${c.events.slice(ev).join(" | ")}; info ${JSON.stringify(inf0.progression)}`);
await hook("progression", { xpAt: { x: L.x, y: L.y, xp: 100 } });
send({ type: "upgradeBuilding", tileX: L.x, tileY: L.y });
await sleep(400);
const inf1 = await info(L.x, L.y);
result(inf1.level === 2 && (inf1.progression ?? []).some((l) => /tier 2 of 2: speed x1\.25/.test(l)), `upgraded with a level-2 woodcutter: level ${inf1.level}, ${JSON.stringify(inf1.progression)}`);

// 3b. the metal chain (phase 3): Charcoal Burner -> charcoal; bellows from hides; Bloomery -> anvil, hammer & tongs,
// blooms; then the Blacksmith unlocks. (Instant build also makes a station batch take one tick.)
const S = { x: B.x + 6, y: B.y };
ev = c.events.length;
await place(S.x, S.y, T.Blacksmith, T.Blacksmith);
result(tileAt(S.x, S.y) === T.Empty && c.events.slice(ev).some((e) => /Blacksmith needs: Anvil, Hammer & tongs, a Bloomery/.test(e)), `Blacksmith locked: ${c.events.slice(ev).join(" | ")}`);
const CB = { x: B.x, y: B.y + 3 };
const BL = { x: B.x + 3, y: B.y + 3 };
await place(CB.x, CB.y, T.Charcoal);
await until(() => c.snap.colonists.some((u) => u.kind === "artisan" && u.postX === CB.x && u.postY === CB.y), 5000);
// Fast-forward until the worker has walked over and burned a batch (walking takes sim ticks).
const items = () => c.snap.progression?.items ?? {};
for (let i = 0; i < 20 && (items().charcoal?.[0] ?? 0) < 6; i++) await hook("fastForward", { ticks: 100 }), await sleep(100);
result(tileAt(CB.x, CB.y) === T.Charcoal && (items().charcoal?.[0] ?? 0) >= 6, `Charcoal Burner burns charcoal: ${JSON.stringify(items().charcoal)}`);
ev = c.events.length;
await place(BL.x, BL.y, T.Bloomery, T.Bloomery);
result(tileAt(BL.x, BL.y) === T.Empty && c.events.slice(ev).some((e) => /Bloomery needs: Bellows/.test(e)), `Bloomery locked without bellows`);
await hook("progression", { items: { hide: 2 } });
send({ type: "craftItem", recipe: "bellows" });
await until(() => (items().bellows?.[0] ?? 0) === 1, 3000);
await place(BL.x, BL.y, T.Bloomery);
await until(() => c.snap.colonists.some((u) => u.kind === "artisan" && u.postX === BL.x && u.postY === BL.y), 5000);
for (let i = 0; i < 20 && !((items().anvil?.[0] ?? 0) === 1 && (items().smithTools?.[0] ?? 0) === 1); i++) await hook("fastForward", { ticks: 100 }), await sleep(100);
result((items().anvil?.[0] ?? 0) === 1 && (items().smithTools?.[0] ?? 0) === 1 && c.snap.iron < 500,
  `Bloomery: anvil ${items().anvil}, tools ${items().smithTools}, blooms ${items().ironBloom}, charcoal ${items().charcoal}, iron ${c.snap.iron}, smelter ${JSON.stringify(c.snap.colonists.filter((u) => u.postX === BL.x && u.postY === BL.y).map((u) => [u.kind, u.state, Math.round(u.x / 32), Math.round(u.y / 32)]))}`);
const blInfo = await info(BL.x, BL.y);
result((blInfo.progression ?? []).some((l) => /Smelter L1/.test(l)) && (blInfo.progression ?? []).some((l) => /Level 2 needs: a Blacksmith, Smelter level 2/.test(l)),
  `Bloomery info: ${JSON.stringify(blInfo.progression)}`);

// 4. smith training: a level-1 smith makes tools, not gear
await place(S.x, S.y, T.Blacksmith);
result(tileAt(S.x, S.y) === T.Blacksmith, "Blacksmith built once the anvil, hammer & tongs and a Bloomery exist");
await until(() => c.snap.colonists.some((u) => u.kind === "artisan" && u.postX === S.x && u.postY === S.y), 5000);
const f0 = (await info(S.x, S.y)).forge;
result(f0 && f0.options.every((o) => !o.enabled && /level-2 Smith/.test(o.reason)), `level-1 smith can't forge: ${f0?.options.map((o) => o.reason).join(" / ")}`);
await hook("progression", { xpAt: { x: S.x, y: S.y, xp: 100 } });
const f1 = (await info(S.x, S.y)).forge;
result(f1 && f1.options.some((o) => o.enabled), `level-2 smith can forge T1: ${f1?.options.map((o) => o.reason || "ok").join(" / ")}`);

// 4b. Blast furnace: with a Blacksmith and a level-2 smelter the Bloomery reaches level 2 and makes Good blooms
await hook("progression", { xpAt: { x: BL.x, y: BL.y, xp: 100 }, items: { ironBloom: -100 } });
ev = c.events.length;
send({ type: "upgradeBuilding", tileX: BL.x, tileY: BL.y });
await sleep(400);
const goodBefore = items().ironBloom?.[1] ?? 0;
for (let i = 0; i < 20 && (items().ironBloom?.[1] ?? 0) <= goodBefore; i++) await hook("fastForward", { ticks: 50 }), await sleep(100);
const blLevel = (await info(BL.x, BL.y)).level;
result(blLevel === 2 && (items().ironBloom?.[1] ?? 0) > goodBefore, `Blast furnace (level ${blLevel}) makes Good blooms: ${JSON.stringify(items().ironBloom)} ${c.events.slice(ev).join(" | ")}`);

// 4c. prospecting: needs pick + knife (both in stock); reports after the survey; deposits then show richness
ev = c.events.length;
await tp(tc.x + 1, tc.y + 1);
send({ type: "prospect" });
await sleep(200);
await hook("fastForward", { ticks: 40 });
await until(() => c.events.slice(ev).some((e) => /Prospector's report/.test(e)), 3000);
const pr = await hook("progression", {});
result(c.events.slice(ev).some((e) => /Prospector's report: \d+ rich/.test(e)) && pr.prospected?.length === 3, `prospecting: ${c.events.slice(ev).join(" | ")}`);

// 4d. food chain (phase 4): plow -> Barn; millstone -> Mill (flour); clay oven -> Bakery (flatbread); a level-2
// baker cultures the sourdough starter, then bakes bread; bread is eaten first at dawn.
const BA = { x: B.x, y: B.y + 6 };
const MI = { x: B.x + 3, y: B.y + 6 };
const BK = { x: B.x + 6, y: B.y + 6 };
ev = c.events.length;
await place(BA.x, BA.y, T.Barn, T.Barn);
const barnLocked = tileAt(BA.x, BA.y) === T.Empty && c.events.slice(ev).some((e) => /Barn needs: Wooden plow/.test(e));
send({ type: "craftItem", recipe: "woodenPlow" });
await until(() => (items().woodenPlow?.[0] ?? 0) === 1, 3000);
await place(BA.x, BA.y, T.Barn);
result(barnLocked && tileAt(BA.x, BA.y) === T.Barn, `Barn needs a wooden plow (craft by hand), then builds`);
send({ type: "craftItem", recipe: "millstone" });
send({ type: "craftItem", recipe: "clayOven" });
await until(() => (items().millstone?.[0] ?? 0) === 1 && (items().clayOven?.[0] ?? 0) === 1, 3000);
await place(MI.x, MI.y, T.Mill);
await place(BK.x, BK.y, T.Bakery);
for (let i = 0; i < 20 && (items().flatbread?.[0] ?? 0) < 2; i++) await hook("fastForward", { ticks: 100 }), await sleep(100);
result(tileAt(MI.x, MI.y) === T.Mill && tileAt(BK.x, BK.y) === T.Bakery && (items().flatbread?.[0] ?? 0) >= 2,
  `Mill + Bakery: flour ${items().flour}, flatbread ${items().flatbread}`);
await hook("progression", { xpAt: { x: BK.x, y: BK.y, xp: 100 } });
for (let i = 0; i < 30 && (items().bread?.[0] ?? 0) < 4; i++) await hook("fastForward", { ticks: 100 }), await sleep(100);
result((items().sourdoughStarter?.[0] ?? 0) === 1 && (items().bread?.[0] ?? 0) >= 4, `level-2 baker: starter ${items().sourdoughStarter} (kept), bread ${items().bread}`);
// Dawn: bread first. Mill and Bakery starved first (no grain, no flour) so only eating moves the counts.
await hook("setStock", { stock: { grain: 0, meat: 0, fruit: 0 } });
await hook("progression", { items: { flour: -100, flatbread: -100 } });
await hook("fastForward", { ticks: 5 });
await sleep(300);
const breadBefore = (items().bread ?? []).reduce((a, b) => a + b, 0);
const grainBefore = c.snap.grain;
await hook("setCycleTick", { tick: 20 * 375 - 3 });
await hook("fastForward", { ticks: 6 });
await sleep(300);
const breadAfter = (items().bread ?? []).reduce((a, b) => a + b, 0);
result(breadAfter < breadBefore && breadAfter > 0 && c.snap.grain === 0, `dawn eats bread first: bread ${breadBefore} -> ${breadAfter}, grain ${grainBefore} -> ${c.snap.grain}`);

// 5. the Hall of the Sworn opened with the Blacksmith (building gate)
result(!c.snap.progression.locked[T.KnightPost] || (await hook("progression", {})).snapshot.locked[T.KnightPost] === undefined, `Hall of the Sworn unlocked by the Blacksmith`);

// 6. save / load round trip, then grandfathering
await hook("progression", { items: { timberProps: 2 }, quality: 2 });
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await hook("progression", { reset: true });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 15000);
const r1 = await hook("progression", {});
result(r1.unlocked.includes(T.Hunter) && r1.items.stoneKnife === 1 && r1.snapshot.items.timberProps?.[1] === 2, `tree survives save/load: ${JSON.stringify(r1.items)} unlocked ${r1.unlocked}`);
const r2 = await hook("progression", { grandfather: true });
result(r2.unlocked.includes(T.Lumberjack) && r2.unlocked.includes(T.Hunter) && r2.items.stoneAxe === 1,
  `grandfathered: owned gated types unlocked ${r2.unlocked}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
