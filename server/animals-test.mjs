// Scripted test: Stardew phase 5d, animals living in buildings (ROADMAP "Stardew layer — phase 5d"). Builds a Chicken
// Coop (instant build), refuses a new Pasture, buys hens + a rooster (gold, capacity), the hero fills the feeder /
// trough with E (hay), a daily step makes eggs, E collects them, a chick is born, slaughter (adult only) yields meat,
// winter eats x1.5, the "animals" work type (off: nobody tends; on: chores done), save / load keeps every animal, 100
// chickens tick cheaply. Gap closure G6: horse cart x1.25, riding (x1.6, no tools, happiness drain, dismount), "Call
// them in", milk pail / shears (x1.25 when due), manure + fertilise (+25% growth), selling at a Market, a hostile mob
// killing an outdoor animal while the rest flee inside.
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

// ---- Gap closure G6 ----
const T6 = { Barn: 131, Pen: 133, Stables: 71, Market: 28 };
const dayNow = async () => {
  for (let i = 0; i < 30 && (await hook("respawnState")).isNight; i++) await ff(400);
};
const hero = (args = {}) => hook("heroLife", args);
await dayNow();
await stock({ gold: 2000, grain: 200 });
const bk = `${S.x + 2},${S.y}`;
const pk = `${S.x - 2},${S.y}`;
const sk = `${S.x - 2},${S.y + 2}`;
await hook("setTileRaw", { tx: S.x + 2, ty: S.y, tile: T6.Barn });
await hook("setTileRaw", { tx: S.x - 2, ty: S.y, tile: T6.Pen });
await hook("setTileRaw", { tx: S.x - 2, ty: S.y + 2, tile: T6.Stables });
await ff(25);
await act({ tileX: S.x + 2, tileY: S.y, op: "buy", species: "cow", male: false });
await act({ tileX: S.x + 2, tileY: S.y, op: "buy", species: "horse", male: true });
await act({ tileX: S.x - 2, tileY: S.y, op: "buy", species: "sheep", male: false });
for (const k of [bk, pk, sk]) await ls({ set: { house: k, feed: 50, water: 50 } });
L = await ls();
const clan = L.houses.find((h) => h.key === bk)?.clan ?? 0;
const cowA = L.animals.find((a) => a.house === bk && a.species === "cow");
const horseA = L.animals.find((a) => a.house === bk && a.species === "horse");
const sheepA = L.animals.find((a) => a.house === pk && a.species === "sheep");
result(!!cowA && !!horseA && !!sheepA, `G6 setup: barn cow ${cowA?.id}, horse ${horseA?.id}, pen sheep ${sheepA?.id}`);

// 14. Horse cart: x1.25 for wagons only with a Stables holding a horse.
const cart0 = L.cartMult[clan];
await act({ tileX: S.x - 2, tileY: S.y + 2, op: "buy", species: "horse", male: false });
const cart1 = (await ls()).cartMult[clan];
result(cart0 === 1 && cart1 === 1.25, `cart: no stable horse x${cart0}, with one x${cart1}`);

// 15. Riding from the Livestock Barn panel: x1.6 speed, the snapshot flag, no tools, happiness drains, dismount.
await stand(S.x + 2, S.y + 1);
const sp0 = (await hero()).speed;
const far = await act({ tileX: S.x - 2, tileY: S.y + 2, op: "ride", id: (await ls()).animals.find((a) => a.house === sk).id });
const r1 = await act({ tileX: S.x + 2, tileY: S.y, op: "ride", id: horseA.id });
let H6 = await hero();
await sleep(250);
const meSnap = c.snap.players.find((p) => p.id === c.welcome.playerId || p.id === c.welcome.id) ?? c.snap.players[0];
result(/Stand next to/.test(far) && /You mount/.test(r1) && Math.abs(H6.speed / sp0 - 1.6) < 1e-6 && meSnap?.mounted === true,
  `ride: far "${far}", "${r1}", speed ${sp0} -> ${H6.speed}, snapshot mounted ${meSnap?.mounted}`);
n = c.events.length;
await hero({ use: { tool: "hoe", tx: S.x + 3, ty: S.y + 1 } });
await waitEvent(n);
const noTool = eventsSince(n);
const happy0 = (await ls()).animals.find((a) => a.id === horseA.id).happiness;
await ff(20 * 10);
const happy1 = (await ls()).animals.find((a) => a.id === horseA.id).happiness;
H6 = await hero({ action: "dismount" });
L = await ls();
result(/Dismount first/.test(noTool) && happy1 < happy0 && Object.keys(L.riders).length === 0 && Math.abs(H6.speed - sp0) < 1e-6,
  `mounted: "${noTool}", horse happiness ${happy0.toFixed(2)} -> ${happy1.toFixed(2)}, dismounted speed ${H6.speed}`);

// 16. "Call them in": the barn's and pen's animals walk inside and stay.
await act({ tileX: S.x + 2, tileY: S.y, op: "herd", on: true });
await act({ tileX: S.x - 2, tileY: S.y, op: "herd", on: true });
let inside = false;
for (let i = 0; i < 30 && !inside; i++) {
  await ff(20);
  inside = (await ls()).animals.filter((a) => a.house === bk || a.house === pk).every((a) => !a.outdoors);
}
I = await info(S.x + 2, S.y);
result(inside && I?.animals?.penned === true && I.animals.outdoors === 0, `called in: all inside ${inside}, panel penned ${I?.animals?.penned}`);

// 17. Milk pail / shears (this suite's gates are open: no tool item needed): x1.25 when due, once per product, the
// daily step then skips it.
await stand(S.x + 1, S.y + 1);
await hook("progression", { items: { milkPail: 1, shears: 1 } });
const milk0 = (await items()).milk ?? 0;
n = c.events.length;
await hero({ use: { tool: "milkPail", tx: S.x + 2, ty: S.y + 1 } });
await waitEvent(n);
const pail1 = eventsSince(n);
const milk1 = (await items()).milk ?? 0;
n = c.events.length;
await hero({ use: { tool: "milkPail", tx: S.x + 2, ty: S.y + 1 } });
await waitEvent(n);
const pail2 = eventsSince(n);
result(milk1 - milk0 === 1 && /With the milk pail/.test(pail1) && /nothing ready/.test(pail2),
  `pail: "${pail1}" (milk ${milk0} -> ${milk1}) / again "${pail2}"`);
await stand(S.x - 1, S.y + 1);
n = c.events.length;
await hero({ use: { tool: "shears", tx: S.x - 2, ty: S.y + 1 } });
await waitEvent(n);
const notDue = eventsSince(n);
await ls({ set: { animal: sheepA.id, productDays: 2 } });
const wool0 = (await stock()).wool;
n = c.events.length;
await hero({ use: { tool: "shears", tx: S.x - 2, ty: S.y + 1 } });
await waitEvent(n);
const shorn = eventsSince(n);
const wool1 = (await stock()).wool;
result(/nothing ready/.test(notDue) && wool1 - wool0 === 3 && /shears/.test(shorn), `shears: not due "${notDue}", shorn "${shorn}" (wool +${wool1 - wool0})`);
for (const k of [bk, pk]) await ls({ set: { house: k, feed: 50, water: 50 } });
const milkWait0 = ((await ls()).houses.find((h) => h.key === bk).waiting.milk ?? [0, 0, 0]).reduce((a, b) => a + b, 0);
L = await ls({ set: { daily: true } });
H = L.houses.find((h) => h.key === bk);
const milkWait1 = (H.waiting.milk ?? [0, 0, 0]).reduce((a, b) => a + b, 0);
const coopTicks = L.houses.find((h) => h.key === key).choreTicks;
result(milkWait1 === milkWait0 && !L.animals.find((a) => a.id === cowA.id).handDone && H.choreTicks === coopTicks * 0.75,
  `daily after milking: milk waiting ${milkWait0} -> ${milkWait1}; chores barn ${H.choreTicks} vs coop ${coopTicks} ticks`);

// 18. Manure: the barn's cow + horse make 1 a day; the hero fertilises a plot (+25% growth, one manure each).
const dung = (H.waiting.manure ?? [0])[0];
result(dung >= 1 && H.today.manure === 1, `manure waiting at the barn: ${dung} (today ${JSON.stringify(H.today)})`);
await hook("progression", { items: { hoe: 1, wheatSeeds: 4, manure: 2 } });
await stand(S.x, S.y - 2);
const pa = { x: S.x - 1, y: S.y - 2 };
const pb = { x: S.x + 1, y: S.y - 2 };
for (const t of [pa, pb]) {
  await hero({ use: { tool: "hoe", tx: t.x, ty: t.y } });
  await ff(40);
  await hero({ use: { tool: "seeds", tx: t.x, ty: t.y, crop: "wheat" } });
  await ff(30);
}
const man0 = (await items()).manure ?? 0;
n = c.events.length;
await hero({ use: { tool: "manure", tx: pa.x, ty: pa.y } });
await waitEvent(n);
const fert1 = eventsSince(n);
n = c.events.length;
await hero({ use: { tool: "manure", tx: pa.x, ty: pa.y } });
await waitEvent(n);
const fert2 = eventsSince(n);
const man1 = (await items()).manure ?? 0;
for (const t of [pa, pb]) await hook("zoneState", { setCropAt: { x: t.x, y: t.y, stage: 2, progress: 0, tended: false } });
const Z = await hook("zoneState", { tickZones: true });
const plotA = Z.plots.find((q) => q.x === pa.x && q.y === pa.y);
const plotB = Z.plots.find((q) => q.x === pb.x && q.y === pb.y);
result(/Fertilised/.test(fert1) && /Already/.test(fert2) && man0 - man1 === 1 && plotA?.fert && !plotB?.fert && plotB?.progress > 0 && Math.abs(plotA.progress / plotB.progress - 1.25) < 1e-6,
  `fertilise: "${fert1}" / "${fert2}", manure ${man0} -> ${man1}, growth ${plotA?.progress} vs ${plotB?.progress}`);

// 19. Selling: refused with no Market / trader near; price = base x 0.6 x happiness / health factors; gold to stores.
const cowNow = (await ls()).animals.find((a) => a.id === cowA.id);
const expect = Math.max(1, Math.round(60 * 0.6 * (0.6 + 0.4 * Math.min(100, cowNow.happiness) / 100) * (0.5 + 0.5 * cowNow.health / 100)));
const noVenue = await act({ tileX: S.x + 2, tileY: S.y, op: "sell", id: cowA.id });
await hook("setTileRaw", { tx: S.x + 2, ty: S.y + 2, tile: T6.Market });
await ff(2);
I = await info(S.x + 2, S.y);
const panelPrice = I?.animals?.animals.find((a) => a.id === cowA.id)?.price;
const gold0 = (await stock()).gold;
const sold = await act({ tileX: S.x + 2, tileY: S.y, op: "sell", id: cowA.id });
const gold1 = (await stock()).gold;
L = await ls();
result(/To sell/.test(noVenue) && I?.animals?.sellVenue === "your Market" && panelPrice === expect && cowNow.price === expect && gold1 - gold0 === expect && !L.animals.some((a) => a.id === cowA.id),
  `sell: "${noVenue}"; at ${I?.animals?.sellVenue}: price ${panelPrice} (expect ${expect}), "${sold}", gold +${gold1 - gold0}`);

// 20. A hostile mob: kills an animal it reaches outdoors (message, record gone); the house's others flee inside.
await act({ tileX: S.x + 2, tileY: S.y, op: "herd", on: false });
await ls({ set: { threat: false } });
await dayNow();
await stand(S.x + 10, S.y + 10);
let prey = null;
for (let i = 0; i < 60 && !prey; i++) {
  await ff(20);
  prey = (await ls()).animals.find((a) => a.outdoors && a.house === key);
}
let killed = false;
let mobId = null;
let others = [];
if (prey) {
  n = c.events.length;
  mobId = (await hook("spawnMob", { kind: "wolf", tx: Math.floor(prey.x / TILE), ty: Math.floor(prey.y / TILE) })).id;
  await ff(6);
  await waitEvent(n);
  L = await ls();
  killed = !L.animals.some((a) => a.id === prey.id) && /killed a/.test(eventsSince(n));
  for (let i = 0; i < 20; i++) {
    await ff(20);
    L = await ls();
    others = L.animals.filter((a) => a.house === key && a.outdoors);
    if (others.length === 0) break;
  }
}
const thr = L.houses.find((h) => h.key === key)?.threatened;
result(!!prey && killed && others.length === 0 && thr === true, `predator: prey ${prey?.id} killed ${killed}, coop animals still outdoors ${others.length}, threatened ${thr} (${eventsSince(n).slice(0, 160)})`);
if (mobId) await hook("damageMob", { mobId, amount: 99999 });
await ls({ set: { threat: false } });

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
