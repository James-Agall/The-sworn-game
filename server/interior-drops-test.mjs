// Scripted test: Interior fixes 2026-11-27 (server/src/groundItems.ts + interiors.ts hostileInteriorScope). Dropping
// goods and gear inside HOSTILE interiors (a cave, a ruin, a bandit camp, an own mine) on a free tile of the interior's
// own grid, merging, the dropper delay, pickup by message and by E (interior coordinates, 1.5 tiles), the snapshot's
// in-interior `ground` list (marked `in`, only in that instance), isolation (interior A vs B vs the overworld), a
// peaceful house still refusing, the shared 300 cap, despawn after 3 game days, save / load of interior stacks.
// Needs a FRESH private server: `npm test -- interior-drops`.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, IronOre: 7, Mine: 9, House: 13, CampEntrance: 174, CaveEntrance: 175, RuinEntrance: 176 };
const TILE = 32;
const px = (t) => t * TILE + 16;

const c = { ws: new WebSocket(`ws://localhost:${PORT}/?profile=interior-drops`), welcome: null, welcomes: 0, snap: null, life: null, ground: null, events: [], hook: new Map(), saves: [], dialogue: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") { c.welcome = m; c.welcomes++; c.ground = null; }
  else if (m.type === "snapshot") { c.snap = m; if (m.life) c.life = m.life; if (m.ground) c.ground = m.ground; }
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.saves.push(m);
  else if (m.type === "dialogue") c.dialogue = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}, waitMs = 60000) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < waitMs / 10 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ins = (args = {}) => hook("interior", args);
const gi = (args = {}) => hook("groundItems", args);
const ground = async () => (await gi()).items;
const pack = async () => (await hook("heroLife")).life.pack;
const since = (n) => c.events.slice(n).join(" | ");
const ff = (ticks) => hook("fastForward", { ticks });
async function act(m) {
  const n = c.events.length;
  send(m);
  for (let i = 0; i < 50 && c.events.length === n; i++) await sleep(10);
  await sleep(40);
  return since(n);
}
// Snapshots come while paused too; wait for a fresh `ground` list matching `pred`.
async function groundWhere(pred, ms = 2000) {
  for (let i = 0; i < ms / 20; i++) {
    if (c.ground && pred(c.ground)) return c.ground;
    await sleep(20);
  }
  return c.ground;
}

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("heroLife", { needs: false, pack: {} });
const tc = (await hook("constructionState")).townCenters[0];
const W = c.welcome.worldTilesX, H = c.welcome.worldTilesY ?? W;
const clampX = (x) => Math.max(4, Math.min(W - 5, x)), clampY = (y) => Math.max(4, Math.min(H - 5, y));
const dir = tc.x < W / 2 ? 1 : -1;
const site = (dx, dy) => ({ x: clampX(tc.x + dir * dx), y: clampY(tc.y + dy) });
const CAVE = site(14, 0), RUIN = site(14, 8), CAMP = site(22, 0), MINE = site(22, 8), HOUSE = site(6, 8);
for (const [s, t] of [[CAVE, T.CaveEntrance], [RUIN, T.RuinEntrance], [CAMP, T.CampEntrance], [HOUSE, T.House]]) {
  for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) await hook("setTileRaw", { tx: s.x + dx, ty: s.y + dy, tile: T.Empty });
  await hook("setTileRaw", { tx: s.x, ty: s.y, tile: t });
}
for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) await hook("setTileRaw", { tx: MINE.x + dx, ty: MINE.y + dy, tile: T.Empty });
await hook("setTileRaw", { tx: MINE.x, ty: MINE.y, tile: T.IronOre });
await hook("teleportPlayer", { x: px(MINE.x - 1), y: px(MINE.y - 1) });
for (let i = 0; i < 6 && c.snap.tiles?.[MINE.y * W + MINE.x] !== T.Mine; i++) {
  send({ type: "setTile", tileX: MINE.x, tileY: MINE.y, tile: T.Mine });
  await sleep(300);
  if ((await ins({ find: T.Mine })).found?.some((f) => f.tx === MINE.x && f.ty === MINE.y)) break;
  await ff(10);
}
const mineThere = (await ins({ find: T.Mine })).found?.some((f) => f.tx === MINE.x && f.ty === MINE.y);
result(!!mineThere, `a Mine stands on iron ore at ${MINE.x},${MINE.y}`);
await gi({ clear: true });

// A free floor cell of the interior, away from the exit, props and walls (the hero stands there to drop).
function freeCell(map, avoid = []) {
  const bad = (x, y) => x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1 || map.cells[y * map.w + x] !== "." || map.props.some((q) => Math.abs(q.x - x) <= 2 && Math.abs(q.y - y) <= 2);
  const cands = [];
  for (let y = 2; y < map.h - 2; y++) for (let x = 2; x < map.w - 2; x++) {
    if ([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => bad(x + dx, y + dy))) continue;
    if (Math.hypot(x - map.exit.x, y - map.exit.y) < 4 || avoid.some((a) => Math.hypot(a.x - x, a.y - y) < 4)) continue;
    cands.push({ x, y });
  }
  return cands[Math.floor(cands.length / 2)];
}
async function enter(s, label) {
  await ins({ exit: true });
  await hook("teleportPlayer", { x: px(s.x), y: px(s.y + 1) });
  const I = await ins({ enter: { tx: s.x, ty: s.y } });
  result(I?.why === "" && I.inside, `entered the ${label} (${I?.why || I?.view?.title})`);
  return I;
}
const isFree = (map, it) => {
  const x = Math.floor(it.x / TILE), y = Math.floor(it.y / TILE);
  return x >= 0 && y >= 0 && x < map.w && y < map.h && map.cells[y * map.w + x] === "." && !map.props.some((q) => q.x === x && q.y === y) && Math.abs(it.x - px(x)) < 1 && Math.abs(it.y - px(y)) < 1;
};

// 1. A cave: drop goods, merge, drop gear; the stacks carry the interior scope and lie on free interior tiles.
let I = await enter(CAVE, "cave");
const caveMap = I.view.map;
const caveSpot = freeCell(caveMap);
await ins({ at: { x: px(caveSpot.x), y: px(caveSpot.y) } });
await hook("heroLife", { pack: { wood: 6, rock: 2 } });
let ev = await act({ type: "dropGood", good: "wood", qty: 2 });
let G = await ground();
const caveScope = (await gi()).scope;
result(/You drop 2 wood/.test(ev) && G.length === 1 && G[0].scope === caveScope && /:0:v\d+$/.test(caveScope ?? "") && isFree(caveMap, G[0]) && Math.hypot(G[0].x - px(caveSpot.x), G[0].y - px(caveSpot.y)) <= 1.5 * TILE,
  `cave drop: "${ev}", stack scope ${G[0]?.scope} at interior (${G[0]?.x}, ${G[0]?.y}) on a free tile near the hero (${caveSpot.x}, ${caveSpot.y})`);
ev = await act({ type: "dropGood", good: "wood", qty: 1 });
G = await ground();
result(G.length === 1 && G[0].qty === 3, `same good, same tile: merged into one stack of ${G[0]?.qty}`);
const sword = { id: "drop-sword", slot: "weapon", tier: 1, name: "Cave Sword", kind: "sword", stats: { damagePct: 20 } };
await hook("packGear", { item: sword });
ev = await act({ type: "dropGear", itemId: sword.id });
G = await ground();
result(/You drop Cave Sword/.test(ev) && G.some((i) => i.kind === "gear" && i.gear.id === sword.id && i.scope === caveScope), `cave gear drop: "${ev}"`);
let list = await groundWhere((l) => l.length === 2 && l.every((s) => s.in === 1));
result(list?.length === 2 && list.every((s) => s.in === 1) && list.some((s) => s.k === "e" && s.name === "Cave Sword"), `snapshot ground inside the cave: ${JSON.stringify(list)}`);

// 2. Pickup inside: the dropper's delay, then by message (interior reach) and by E.
const woodId = G.find((i) => i.kind === "good").id;
ev = await act({ type: "pickupGround", id: woodId });
result(/You just put that down/.test(ev), `dropper's own delay indoors: "${ev}"`);
await ff(40);
await ins({ at: { x: px(caveSpot.x + 4), y: px(caveSpot.y) } });
ev = await act({ type: "pickupGround", id: woodId });
result(/Walk closer to pick that up/.test(ev), `4 tiles away (interior coords): "${ev}"`);
await ins({ at: { x: px(caveSpot.x), y: px(caveSpot.y) } });
ev = await act({ type: "pickupGround", id: woodId });
let P = await pack();
result(/You pick up 3 wood/.test(ev) && P.wood === 6 && !(await ground()).some((i) => i.id === woodId), `pickup by message inside the cave: "${ev}", pack wood ${P.wood}`);
ev = await act({ type: "interact" });
G = await ground();
const invNow = (await hook("packGear")).inventory;
result(/You pick up Cave Sword/.test(ev) && G.length === 0 && invNow.some((i) => i.id === sword.id), `E inside the cave picks up the nearest stack: "${ev}"`);
await sleep(1100);
await act({ type: "dropGood", good: "rock", qty: 2 });
const caveRock = (await ground())[0];

// 3. Isolation: overworld and another interior never see / take the cave's stack.
await ins({ exit: true });
await hook("teleportPlayer", { x: px(CAVE.x), y: px(CAVE.y + 2) });
list = await groundWhere((l) => !l.some((s) => s.in));
result(Array.isArray(list) && !list.some((s) => s.in || s.id === caveRock.id), `outside, the snapshot has no interior stacks (${JSON.stringify(list)})`);
await ff(40);
ev = await act({ type: "pickupGround", id: caveRock.id });
result((await ground()).some((i) => i.id === caveRock.id), `pickup of the cave's stack from the overworld does nothing (${ev || "no event"})`);
send({ type: "interact" });
await sleep(150);
result((await ground()).some((i) => i.id === caveRock.id), "E outside does not take the cave's stack");
await hook("heroLife", { pack: { wood: 3 } });
await sleep(1100);
await act({ type: "dropGood", good: "wood", qty: 1 });
const outside = (await ground()).find((i) => !i.scope);
result(!!outside && outside.x === px(Math.floor(outside.x / TILE)), `an overworld drop is still plain world (${outside?.x}, ${outside?.y})`);

I = await enter(RUIN, "ruin");
const ruinMap = I.view.map;
const ruinSpot = freeCell(ruinMap);
await ins({ at: { x: caveRock.x, y: caveRock.y } });
list = await groundWhere((l) => l.length === 0);
result(Array.isArray(list) && list.length === 0, `inside the ruin, the ground list is empty (${JSON.stringify(list)})`);
ev = await act({ type: "pickupGround", id: caveRock.id });
send({ type: "interact" });
await sleep(150);
result((await ground()).some((i) => i.id === caveRock.id && i.scope === caveScope), `the cave's stack cannot be taken from the ruin (by id or E) (${ev || "no event"})`);
await ins({ at: { x: px(ruinSpot.x), y: px(ruinSpot.y) } });
await sleep(1100);
ev = await act({ type: "dropGood", good: "wood", qty: 1 });
const ruinScope = (await gi()).scope;
const ruinStack = (await ground()).find((i) => i.scope === ruinScope);
result(/You drop 1 wood/.test(ev) && !!ruinStack && ruinScope !== caveScope && isFree(ruinMap, ruinStack), `ruin drop: scope ${ruinScope}, on a free ruin tile`);
list = await groundWhere((l) => l.length === 1 && l[0].id === ruinStack?.id);
result(list?.length === 1 && list[0].in === 1, `the ruin's list holds only its own stack (${JSON.stringify(list)})`);

// 4. A bandit camp and an own mine also take drops.
I = await enter(CAMP, "bandit camp");
const campSpot = freeCell(I.view.map);
await ins({ at: { x: px(campSpot.x), y: px(campSpot.y) } });
await hook("heroLife", { pack: { grain: 2 } });
await sleep(1100);
ev = await act({ type: "dropGood", good: "grain", qty: 2 });
const campScope = (await gi()).scope;
result(/You drop 2 grain/.test(ev) && (await ground()).some((i) => i.scope === campScope && i.good === "grain"), `camp drop: "${ev}" (scope ${campScope})`);
if (mineThere) {
  I = await enter(MINE, "mine");
  const mineSpot = freeCell(I.view.map);
  await ins({ at: { x: px(mineSpot.x), y: px(mineSpot.y) } });
  await hook("heroLife", { pack: { rock: 1 } });
  await sleep(1100);
  ev = await act({ type: "dropGood", good: "rock", qty: 1 });
  const mineScope = (await gi()).scope;
  result(/You drop 1 (rock|stone)/.test(ev) && (await ground()).some((i) => i.scope === mineScope && i.good === "rock"), `mine drop: "${ev}" (scope ${mineScope})`);
}

// 5. A peaceful house still refuses.
I = await enter(HOUSE, "house");
await hook("heroLife", { pack: { wood: 2 } });
await sleep(1100);
const n0 = (await ground()).length;
ev = await act({ type: "dropGood", good: "wood", qty: 1 });
result(/You can't drop things indoors: step outside first/.test(ev) && (await ground()).length === n0 && (await gi()).scope === null, `peaceful house: "${ev}"`);
list = await groundWhere((l) => l.length === 0);
result(Array.isArray(list) && list.length === 0, "inside the house the ground list is empty");

// 6. Save / load keeps interior stacks with their scope and interior coordinates.
await ins({ exit: true });
const saved = (await ground()).filter((i) => i.scope);
c.saves.length = 0;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 1000 && !c.saves.length; i++) await sleep(20);
const sres = c.saves[0];
await gi({ clear: true });
c.saves.length = 0;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 1500 && !c.saves.length; i++) await sleep(20);
for (let i = 0; i < 500 && c.welcomes === w0; i++) await sleep(20);
await sleep(300);
send({ type: "pause", paused: true });
const pick = (l) => JSON.stringify(l.filter((i) => i.scope).map((i) => [i.id, i.scope, i.kind, i.good, i.qty, i.x, i.y, i.droppedAtTick]));
const loaded = await ground();
result(sres?.ok && c.saves[0]?.ok && saved.length >= 3 && pick(loaded) === pick(saved), `save / load keeps the ${saved.length} interior stacks (${pick(loaded).slice(0, 200)})`);
I = await enter(CAVE, "cave (after load)");
list = await groundWhere((l) => l.some((s) => s.id === caveRock.id));
result(list?.length === 1 && list[0].id === caveRock.id && list[0].in === 1, `after the load the cave still shows its own stack only (${JSON.stringify(list)})`);

// 7. Caps: interior stacks share the 300 cap (oldest out), and the cave's list is only its own.
const info = await gi();
await gi({ spawn: { n: info.max, good: "wood", x: px(caveSpot.x), y: px(caveSpot.y), scope: (await gi()).scope } });
G = await ground();
result(G.length === info.max && G.every((i) => i.scope === caveScope), `cap ${info.max}: ${G.length} stacks, the older ones (ruin, camp, overworld) evicted`);
list = await groundWhere((l) => l.length === info.max);
result(list?.length === info.max && list.every((s) => s.in === 1), `the cave's list has the ${list?.length} cave stacks`);

// 8. Despawn after 3 game days, in interior scope too (the hero waits outside).
await ins({ exit: true });
await gi({ clear: true });
I = await enter(CAVE, "cave (despawn)");
await ins({ at: { x: px(caveSpot.x), y: px(caveSpot.y) } });
await hook("heroLife", { pack: { wood: 1 } });
await sleep(1100);
await act({ type: "dropGood", good: "wood", qty: 1 });
await ins({ exit: true });
let left = info.despawnTicks - 60;
while (left > 0) {
  const n = Math.min(5000, left);
  await ff(n);
  left -= n;
}
const mid = (await ground()).length;
await ff(80);
result(mid === 1 && (await ground()).length === 0, `interior stack despawns after ${info.despawnTicks} ticks (still there 60 short: ${mid})`);

c.ws.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll interior-drops checks passed");
process.exit(fails ? 1 : 0);
