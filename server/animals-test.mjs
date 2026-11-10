// Scripted test: Stardew phase 5d, animals living in buildings (ROADMAP "Stardew layer — phase 5d"). Builds a Chicken
// Coop (instant build), refuses a new Pasture, buys hens + a rooster (gold, capacity), the hero fills the feeder /
// trough with E (hay), a daily step makes eggs, E collects them, a chick is born, slaughter (adult only) yields meat,
// winter eats x1.5, the "animals" work type (off: nobody tends; on: chores done), save / load keeps every animal, 100
// chickens tick cheaply.
// Needs a FRESH private server (80 map, instant build, unlock all): `npm test -- animals`.
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
const T = { Empty: 0, Pasture: 21, Water: 35, Moat: 75, Coop: 130 };
const TILE = 32;
const px = (t) => t * TILE + 16;
const DAY = 375 * 20;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0, info: null, tiles: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
  else if (m.type === "buildingInfo") c.info = m.info;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const ls = (args = {}) => hook("livestock", args);
const stand = (x, y) => hook("teleportPlayer", { x: px(x), y: px(y) });
const eventsSince = (n) => c.events.slice(n).join(" | ");
const items = async () => (await hook("progression", {})).items;
const stock = async (s = {}) => (await hook("setStock", { stock: s })).stock;
async function waitEvent(n, ms = 1500) {
  for (let i = 0; i < ms / 10 && c.events.length === n; i++) await sleep(10);
}
async function act(m) {
  const n = c.events.length;
  send({ type: "animalAction", ...m });
  await waitEvent(n);
  return eventsSince(n);
}
async function pressE() {
  const n = c.events.length;
  send({ type: "interact" });
  await waitEvent(n);
  return eventsSince(n);
}
async function info(x, y) {
  c.info = null;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  for (let i = 0; i < 300 && !c.info; i++) await sleep(10);
  return c.info;
}

while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
await hook("setRaids", { enabled: false });
const tc = (await hook("constructionState")).townCenters[0];
const tileAt = (x, y) => c.tiles[y * W + x];
const waterNear = (x, y, r) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ([T.Water, T.Moat].includes(tileAt(x + dx, y + dy))) return true;
  return false;
};
// A dry spot (no water within 7 tiles) near the Town Center, cleared.
let S = null;
for (const [dx, dy] of [[7, 5], [-7, 5], [7, -6], [-7, -6], [10, 0], [-10, 0], [0, 9], [0, -9], [12, 8], [-12, -8]]) {
  const x = tc.x + dx;
  const y = tc.y + dy;
  if (x > 8 && y > 8 && x < W - 8 && y < W - 8 && !waterNear(x, y, 7)) {
    S = { x, y };
    break;
  }
}
if (!S) S = { x: tc.x + 7, y: tc.y + 5 };
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) send({ type: "testHook", op: "setTileRaw", tx: S.x + dx, ty: S.y + dy, tile: T.Empty });
await hook("setTileRaw", { tx: S.x, ty: S.y, tile: T.Empty });
await stock({ gold: 1000, grain: 100 });

// 1. Animals work off for everyone (the keeper leaves; nobody tends) while the hero does it by hand.
const people = (await hook("workState")).tab.rows.map((r) => r.id);
send({ type: "workSet", ids: people, work: "animals", priority: 0 });
const tab = (await hook("workState", { assignments: true })).tab;
result(tab.rows.length > 0 && tab.rows.every((r) => r.pri[7] === 0), `work tab has the animals column, set off for ${tab.rows.length} people`);

// 2. A new Pasture is refused (retired); the Chicken Coop is built (instant).
await stand(S.x + 1, S.y + 1);
let n = c.events.length;
send({ type: "setTile", tileX: S.x + 2, tileY: S.y + 2, tile: T.Pasture });
await waitEvent(n);
result(tileAt(S.x + 2, S.y + 2) === T.Empty && /Pastures are retired/.test(eventsSince(n)), `new pasture refused (${eventsSince(n)})`);
await stand(S.x - 1, S.y - 1);
send({ type: "setTile", tileX: S.x, tileY: S.y, tile: T.Coop });
for (let i = 0; i < 200 && tileAt(S.x, S.y) !== T.Coop; i++) await sleep(10);
let L = await ls();
const key = `${S.x},${S.y}`;
let H = L.houses.find((h) => h.key === key);
result(tileAt(S.x, S.y) === T.Coop && H && H.kind === "coop" && H.capacity === 4 && !H.autoWater, `coop built: ${JSON.stringify(H && { kind: H.kind, cap: H.capacity, autoWater: H.autoWater })}`);

// 3. Buy two hens and a rooster (gold), the fifth is refused (capacity 4).
const g0 = (await stock()).gold;
await act({ tileX: S.x, tileY: S.y, op: "buy", species: "chicken", male: false });
await act({ tileX: S.x, tileY: S.y, op: "buy", species: "chicken", male: false });
await act({ tileX: S.x, tileY: S.y, op: "buy", species: "chicken", male: true });
const g1 = (await stock()).gold;
L = await ls();
let mine = L.animals.filter((a) => a.house === key);
result(mine.length === 3 && g0 - g1 === 45 && mine.filter((a) => a.male).length === 1 && mine.every((a) => !a.baby), `bought 2 hens + rooster for ${g0 - g1} gold`);
const cow = await act({ tileX: S.x, tileY: S.y, op: "buy", species: "cow", male: false });
result(/does not live here/.test(cow), `a cow refused in a coop (${cow})`);
let I = await info(S.x, S.y);
result(I?.animals?.animals.length === 3 && I.animals.capacity === 4 && I.animals.buy.length === 2, `panel: ${I?.animals?.animals.length}/${I?.animals?.capacity}, buy options ${I?.animals?.buy.length}`);

// 4. The hero tends the coop with E: hay into the feeder, the trough filled.
await hook("progression", { items: { hay: 20 } });
const hay0 = (await items()).hay ?? 0;
await stand(S.x, S.y + 1);
const e1 = await pressE();
L = await ls();
H = L.houses.find((h) => h.key === key);
const hay1 = (await items()).hay ?? 0;
result(H.feed > 0 && H.water === H.waterCap && hay1 < hay0, `E: ${e1} (feed ${H.feed}/${H.feedCap}, water ${H.water}, hay ${hay0} -> ${hay1})`);

// 5. A daily step: eggs (hens only), fed / watered; feed used = 2 x 0.5 + 0.5 (no grazing).
const feedBefore = H.feed;
L = await ls({ set: { daily: true } });
H = L.houses.find((h) => h.key === key);
const usedNormal = feedBefore - H.feed;
const eggs = (H.waiting.egg ?? []).reduce((a, b) => a + b, 0);
mine = L.animals.filter((a) => a.house === key);
result(eggs === 2 && Math.abs(usedNormal - 1.5) < 1e-6 && mine.every((a) => a.fed === 1 && a.watered === 1), `daily: ${eggs} eggs waiting, feed used ${usedNormal}`);

// 6. E collects the eggs into the stores.
const egg0 = (await items()).egg ?? 0;
const e2 = await pressE();
const egg1 = (await items()).egg ?? 0;
result(egg1 - egg0 === 2 && /collected 2 eggs/.test(e2), `collected: ${e2} (eggs ${egg0} -> ${egg1})`);

// 7. Breeding: happy, well-fed pair -> a chick within 40 days.
let born = false;
for (let d = 0; d < 40 && !born; d++) {
  for (const a of (await ls()).animals.filter((a) => a.house === key)) await ls({ set: { animal: a.id, happiness: 90 } });
  await ls({ set: { house: key, feed: 50, water: 50 } });
  L = await ls({ set: { daily: true } });
  born = L.animals.some((a) => a.house === key && a.baby);
}
mine = L.animals.filter((a) => a.house === key);
result(born && mine.length === 4, `a chick was born (${mine.length} animals: ${mine.map((a) => (a.baby ? "chick" : a.male ? "rooster" : "hen")).join(", ")})`);

// 8. Slaughter: a chick refused; the rooster gives 4 meat.
const chick = mine.find((a) => a.baby);
const rooster = mine.find((a) => a.male && !a.baby);
const s1 = chick ? await act({ tileX: S.x, tileY: S.y, op: "slaughter", id: chick.id }) : "";
const meat0 = (await stock()).meat;
const s2 = rooster ? await act({ tileX: S.x, tileY: S.y, op: "slaughter", id: rooster.id }) : "";
const meat1 = (await stock()).meat;
L = await ls();
result(/fully grown/.test(s1) && meat1 - meat0 === 4 && !L.animals.some((a) => a.id === rooster?.id), `slaughter: chick "${s1}", rooster "${s2}" (+${meat1 - meat0} meat)`);
const rn = await act({ tileX: S.x, tileY: S.y, op: "rename", id: mine.find((a) => !a.male && !a.baby).id, name: "Henrietta" });
result(/Henrietta/.test(rn) && (await ls()).animals.some((a) => a.name === "Henrietta"), `rename: ${rn}`);

// 9. Winter: x1.5 feed (same animals as a normal day).
await hook("calendar", { off: false, set: { season: 3, day: 2 } });
// (the calendar jump's bounded catch-up runs on the next tick)
await ff(2);
await ls({ set: { house: key, feed: 50, water: 50 } });
const preW = (await ls()).animals.filter((a) => a.house === key);
const expectNormal = preW.reduce((s, a) => s + 0.5 * (a.baby ? 0.5 : 1), 0);
L = await ls({ set: { daily: true } });
H = L.houses.find((h) => h.key === key);
const usedWinter = 50 - H.feed;
result(L.winter && Math.abs(usedWinter - expectNormal * 1.5) < 1e-6, `winter: feed used ${usedWinter} vs ${expectNormal} normal (x1.5)`);
await hook("calendar", { off: true });

// 10. Work priority: off -> nobody refills an empty feeder; on -> villagers / the keeper do it.
await ls({ set: { house: key, feed: 0, water: 0 } });
let cyc = (await hook("respawnState")).isNight;
if (cyc) for (let i = 0; i < 20 && (await hook("respawnState")).isNight; i++) await ff(400);
await ff(20 * 20);
H = (await ls()).houses.find((h) => h.key === key);
result(H.feed === 0 && H.water === 0, `animals off: feeder ${H.feed}, trough ${H.water} untouched`);
send({ type: "workSet", ids: people, work: "animals", priority: 1 });
await hook("workState", { assignments: true });
let tended = false;
let who = "";
for (let i = 0; i < 30 && !tended; i++) {
  await ff(20 * 10);
  L = await ls();
  H = L.houses.find((h) => h.key === key);
  tended = H.feed > 0 && H.water > 0;
  who = `jobs ${JSON.stringify(L.jobs)}, keeper ${H.keeper}`;
}
result(tended, `animals on: feeder ${H.feed}/${H.feedCap}, trough ${H.water} (${who})`);
const ws = await hook("workState");
result(ws.tab.rows.some((r) => r.xp[7] > 0) || !!H.keeper, `someone trained the Animal Keeper skill or holds the post`);

// 11. A natural day boundary runs the daily step (lastDay moves on).
const d0 = (await ls()).lastDay;
await ff(DAY);
const d1 = (await ls()).lastDay;
result(d1 === d0 + 1, `daily step at the calendar day boundary (${d0} -> ${d1})`);

// 12. Save / load keeps the animals, names and the feeder.
L = await ls();
const before = L.animals.filter((a) => a.house === key).map((a) => a.id).sort().join(",");
const feedSaved = L.houses.find((h) => h.key === key).feed;
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await act({ tileX: S.x, tileY: S.y, op: "buy", species: "chicken", male: true });
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
await sleep(200);
L = await ls();
const after = L.animals.filter((a) => a.house === key).map((a) => a.id).sort().join(",");
H = L.houses.find((h) => h.key === key);
result(before === after && Math.abs(H.feed - feedSaved) < 1e-6 && L.animals.some((a) => a.name === "Henrietta"), `loaded: animals ${after} (was ${before}), feed ${H.feed}`);

// 13. 100 chickens (25 coops) tick cheaply.
const t1 = Date.now();
await ff(400);
const base = Date.now() - t1;
await stock({ gold: 5000 });
let made = 0;
for (let k = 0; k < 25; k++) {
  const x = 4 + (k % 5) * 2;
  const y = 4 + Math.floor(k / 5) * 2;
  await hook("setTileRaw", { tx: x, ty: y, tile: T.Coop });
}
await ff(20);
for (let k = 0; k < 25; k++) {
  const x = 4 + (k % 5) * 2;
  const y = 4 + Math.floor(k / 5) * 2;
  for (let j = 0; j < 4; j++) send({ type: "animalAction", tileX: x, tileY: y, op: "buy", species: "chicken", male: j === 0 });
}
await sleep(500);
made = (await ls()).animals.length;
const t2 = Date.now();
await ff(400);
const withAnimals = Date.now() - t2;
const L2 = await ls({ set: { daily: true } });
result(made >= 100 && withAnimals < base * 3 + 400, `${made} animals: 400 ticks ${withAnimals} ms (vs ${base} ms without); daily ok ${L2.animals.length}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
