// Scripted test: Hunter's Hut / Forager's Hut, server wildlife and wild forage. Needs COLONY_TEST_HOOKS=1
// (wildlifeState, spawnWildlife, damageWildlife, clearWildlife, setWildlifeRespawn, setTileRaw, setStock,
// setRaids, fastForward, setCycleTick) and a private server with no other players:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=80 PORT=8097 npx tsx src/index.ts &   then
//   PORT=8097 node hunting-foraging-test.mjs
// Checks:
//   A) world-gen: wildlife in the snapshot (flattened, valid kinds, none near the Town Center) and wild
//      forage tiles on the map;
//   B) game flees when hurt (from anything: here a test-hook hit), directly away from the attacker;
//   C) Hunter's Hut: costs 15 wood, spawns a hunter; the hunter stalks a deer, shoots it (ranged effects
//      from the hunter), and the meat stock rises INSTANTLY by exactly the carcass value (deer 6) when
//      he gets home; a shot boar charges its hunter and still ends up as +8 meat;
//   D) Forager's Hut: the forager picks a ripe berry bush (tile -> picked), fruit rises instantly by 3 on
//      arrival; a fruit tree gives 5; a picked plant regrows to ripe after exactly FORAGE_REGROW_TICKS;
//   E) no hunting or foraging at night (workers shelter, game and plants untouched), work resumes at dawn;
//   F) placing a hut on itself upgrades it (level event, +1 worker, costs wood again);
//   G) game respawns a few animals a day and tops back up to (never past) its density caps.
// Runtime ~1-2 min.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`info [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
// Mirrors protocol.ts.
const T = {
  Empty: 0, Tree: 2, TownCenter: 12, HunterHut: 50, ForagerHut: 51,
  BerryBush: 52, BerryBushPicked: 53, FruitTree: 54, FruitTreePicked: 55, MushroomPatch: 56, MushroomPatchPicked: 57,
};
const FORAGE = new Set([52, 53, 54, 55, 56, 57]);
const WILDLIFE_KINDS = ["deer", "rabbit", "boar", "pheasant"];
const STRIDE = 5;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, hooks: [], events: [], tiles: [], W: 0, history: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcomes++;
    c.W = m.worldTilesX;
    c.tiles = m.tiles.slice();
  } else if (m.type === "snapshot") {
    c.snap = m;
    c.snapCount++;
    if (c.recording) c.history.push(m);
  } else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hooks.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const snaps = async (n) => {
  const start = c.snapCount;
  while (c.snapCount < start + n) await sleep(10);
};
const hook = async (op, args = {}) => {
  const before = c.hooks.length;
  send({ type: "testHook", op, ...args });
  const deadline = Date.now() + 60000;
  while (c.hooks.length === before) {
    if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}: is COLONY_TEST_HOOKS=1 set?`);
    await sleep(5);
  }
  return c.hooks[c.hooks.length - 1];
};
const restart = async () => {
  const w = c.welcomes;
  send({ type: "restart", difficulty: "normal" });
  while (c.welcomes === w) await sleep(10);
  await snaps(2);
};
const setPaused = async (paused) => {
  if (c.snap.isPaused !== paused) send({ type: "pause" });
  while (c.snap.isPaused !== paused) await sleep(10);
};
const ff = async (ticks) => (await hook("fastForward", { ticks })).cycleTick;
const place = async (tx, ty, tile) => {
  send({ type: "setTile", tileX: tx, tileY: ty, tile });
  const deadline = Date.now() + 2000;
  while (c.tiles[ty * c.W + tx] !== tile && Date.now() < deadline) await sleep(10);
  return c.tiles[ty * c.W + tx] === tile;
};
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const wild = () => hook("wildlifeState");
const tileAt = (tx, ty) => c.tiles[ty * c.W + tx];
const clearTile = (tx, ty) => hook("setTileRaw", { tx, ty, tile: T.Empty });
const waitUntil = async (pred, ms, stepMs = 50) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await sleep(stepMs);
  }
  return false;
};
// Every snapshot-to-snapshot change of one stock value while `fn` runs.
const watchStock = (key) => {
  const steps = [];
  let last = c.snap[key];
  const check = () => {
    if (c.snap[key] !== last) {
      steps.push(c.snap[key] - last);
      last = c.snap[key];
    }
  };
  const timer = setInterval(check, 5);
  // Final check on stop: the waiter that saw the change can resume before this interval fires again.
  return { steps, stop: () => { clearInterval(timer); check(); } };
};

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);
await restart();
await hook("setRaids", { enabled: false });
await hook("setStock", { stock: { wood: 200, grain: 2000, meat: 0, fruit: 0 } });
// Only the animals this test spawns exist after (B): no respawns wandering into the hunting ground.
await hook("setWildlifeRespawn", { enabled: false });

// ---- A) world-gen ----
{
  const flat = c.snap.wildlife;
  const W = c.W;
  const TC = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
  const animals = [];
  for (let i = 0; i + STRIDE <= flat.length; i += STRIDE) animals.push({ id: flat[i], kind: WILDLIFE_KINDS[flat[i + 1]], x: flat[i + 2], y: flat[i + 3], state: flat[i + 4] });
  const kinds = {};
  for (const a of animals) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  result(flat.length % STRIDE === 0 && animals.length > 0 && animals.every((a) => a.kind && Number.isInteger(a.x) && Number.isInteger(a.y)),
    `(A) snapshot wildlife: ${animals.length} animals as a flat ${STRIDE}-number list, kinds ${JSON.stringify(kinds)}`);
  const nearest = Math.min(...animals.map((a) => Math.hypot(a.x / TILE - (TC.x + 0.5), a.y / TILE - (TC.y + 0.5))));
  result(nearest >= 9, `(A) no game spawns near the Town Center (nearest ${nearest.toFixed(1)} tiles, minimum 10 minus wandering)`);
  const forage = {};
  for (const t of c.tiles) if (FORAGE.has(t)) forage[t] = (forage[t] ?? 0) + 1;
  result((forage[T.BerryBush] ?? 0) > 0 && (forage[T.FruitTree] ?? 0) > 0 && (forage[T.MushroomPatch] ?? 0) > 0 && !forage[T.BerryBushPicked],
    `(A) wild forage on the map, all ripe at world-gen: ${JSON.stringify(forage)} (52 bush, 54 fruit tree, 56 mushrooms)`);
}

const me = c.snap.players[0];
const P = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };
const H = { x: P.x, y: P.y - 2 };
const F = { x: P.x - 1, y: P.y - 2 };
info(`player tile (${P.x},${P.y}); hunter hut (${H.x},${H.y}); forager hut (${F.x},${F.y})`);
// A clear hunting ground east of the player, and the two hut sites; no stray forage near the forager.
for (let y = P.y - 5; y <= P.y + 5; y++) for (let x = P.x + 2; x <= P.x + 14; x++) if (tileAt(x, y) !== T.TownCenter) await clearTile(x, y);
for (const t of [H, F]) await clearTile(t.x, t.y);
for (let y = F.y - 26; y <= F.y + 26; y++)
  for (let x = F.x - 26; x <= F.x + 26; x++) if (x >= 0 && y >= 0 && x < c.W && y < c.W && FORAGE.has(tileAt(x, y))) await clearTile(x, y);
await hook("clearWildlife");
await snaps(2);

// ---- B) flee when hurt (paused: the clock only moves through fastForward) ----
await setPaused(true);
{
  const spot = { x: P.x + 9, y: P.y };
  const id = (await hook("spawnWildlife", { kind: "deer", tx: spot.x, ty: spot.y })).id;
  let a = (await wild()).animals.find((q) => q.id === id);
  const x0 = a.x;
  const hit = await hook("damageWildlife", { id, amount: 1, fromX: a.x - 64, fromY: a.y });
  a = (await wild()).animals.find((q) => q.id === id);
  result(hit.found && !hit.killed && a.mode === "flee" && a.hp === 17, `(B) a hurt deer flees at once (mode=${a.mode}, hp 18 -> ${a.hp})`);
  await ff(20);
  a = (await wild()).animals.find((q) => q.id === id);
  result(a.x - x0 > 2.5 * TILE, `(B) one second later it has bolted ${((a.x - x0) / TILE).toFixed(1)} tiles directly away from the attacker (expected > 2.5 at 115 px/s)`);
  await ff(80);
  a = (await wild()).animals.find((q) => q.id === id);
  result(a.mode !== "flee", `(B) after 4 s it stops fleeing (mode=${a.mode})`);
  await hook("damageWildlife", { id, amount: 100 });
  result(!(await wild()).animals.some((q) => q.id === id), `(B) a lethal hit removes it`);
}
await setPaused(false);

// Rewinds the clock to the start of the current day, so a real-time section gets a full 60 s of
// daylight (the workers shelter at night and would stall it).
const startOfDay = async () => {
  const st = await hook("raidState");
  const cycle = st.dayTicks + st.nightTicks;
  await hook("setCycleTick", { tick: st.cycleTick - (st.cycleTick % cycle) });
};

// ---- C) Hunter's Hut ----
{
  await startOfDay();
  const wood0 = c.snap.wood;
  result(await place(H.x, H.y, T.HunterHut), `(C) Hunter's Hut placed`);
  await snaps(3);
  const hunters = c.snap.colonists.filter((q) => q.kind === "hunter" && q.postX === H.x && q.postY === H.y);
  result(hunters.length === 1 && c.snap.wood === wood0 - 15, `(C) one hunter spawned, wood ${wood0} -> ${c.snap.wood} (-15)`);
  const deerId = (await hook("spawnWildlife", { kind: "deer", tx: P.x + 8, ty: P.y + 1 })).id;
  const meat = watchStock("meat");
  c.history = [];
  c.recording = true;
  const done = await waitUntil(async () => c.snap.meat > 0, 90000, 100);
  c.recording = false;
  meat.stop();
  const shots = c.history.flatMap((s) => {
    const h = s.colonists.find((q) => q.kind === "hunter");
    return h ? s.effects.filter((e) => !e.melee && Math.hypot(e.fromX - h.x, e.fromY - h.y) < 3) : [];
  });
  const states = new Set(c.history.map((s) => s.colonists.find((q) => q.kind === "hunter")?.state));
  info(`(C) hunter states seen: ${[...states].join(", ")}`);
  result(done && meat.steps.length === 1 && meat.steps[0] === 6, `(C) deer brought home: meat changes ${JSON.stringify(meat.steps)} (expected a single instant +6)`);
  result(shots.length >= 2, `(C) the hunter shot arrows at it: ${shots.length} ranged effects from the hunter's position (deer has 18 hp, arrows do 10)`);
  result(states.has("stalking") && states.has("hunting") && states.has("carrying"), `(C) hunter went stalking -> hunting -> carrying`);
  result(!(await wild()).animals.some((q) => q.id === deerId), `(C) the deer is gone`);

  // A boar charges the hunter who shoots it.
  const boarId = (await hook("spawnWildlife", { kind: "boar", tx: P.x + 7, ty: P.y - 1 })).id;
  const meat2 = watchStock("meat");
  let charged = false;
  const got = await waitUntil(async () => {
    const st = await wild();
    if (st.animals.find((q) => q.id === boarId)?.mode === "charge") charged = true;
    return c.snap.meat >= 14;
  }, 90000, 100);
  meat2.stop();
  result(charged, `(C) a shot boar charges its hunter`);
  result(got && meat2.steps.length === 1 && meat2.steps[0] === 8, `(C) boar brought home: meat changes ${JSON.stringify(meat2.steps)} (expected a single instant +8)`);
}

// ---- D) Forager's Hut ----
{
  const bush = { x: P.x + 4, y: P.y + 2 };
  const tree = { x: P.x + 5, y: P.y - 4 };
  await hook("setTileRaw", { tx: bush.x, ty: bush.y, tile: T.BerryBush });
  await snaps(2);
  await startOfDay();
  const wood0 = c.snap.wood;
  result(await place(F.x, F.y, T.ForagerHut), `(D) Forager's Hut placed`);
  await snaps(3);
  result(c.snap.colonists.filter((q) => q.kind === "forager").length === 1 && c.snap.wood === wood0 - 15, `(D) one forager spawned, wood -15`);
  const fruit = watchStock("fruit");
  c.history = [];
  c.recording = true;
  let pickedSeen = false;
  const ok = await waitUntil(async () => {
    if (tileAt(bush.x, bush.y) === T.BerryBushPicked) pickedSeen = true;
    return c.snap.fruit > 0;
  }, 60000, 50);
  c.recording = false;
  fruit.stop();
  const fStates = new Set(c.history.map((s) => s.colonists.find((q) => q.kind === "forager")?.state));
  info(`(D) forager states seen: ${[...fStates].join(", ")}`);
  result(pickedSeen && tileAt(bush.x, bush.y) === T.BerryBushPicked, `(D) the bush was picked (tile ${T.BerryBush} -> ${tileAt(bush.x, bush.y)})`);
  result(ok && fruit.steps.length === 1 && fruit.steps[0] === 3, `(D) berries brought home: fruit changes ${JSON.stringify(fruit.steps)} (expected a single instant +3)`);
  result(fStates.has("toForage") && fStates.has("foraging") && fStates.has("carrying"), `(D) forager went toForage -> foraging -> carrying`);

  info(`(D) fruit before the tree: ${c.snap.fruit}`);
  await hook("setTileRaw", { tx: tree.x, ty: tree.y, tile: T.FruitTree });
  info(`(D) tree planted; fruit ${c.snap.fruit}, tile ${tileAt(tree.x, tree.y)}`);
  const fruit2 = watchStock("fruit");
  const ok2 = await waitUntil(async () => c.snap.fruit >= 8, 60000, 50);
  fruit2.stop();
  info(`(D) tree wait: ok=${ok2} fruit=${c.snap.fruit} forager=${JSON.stringify(c.snap.colonists.find((q) => q.kind === "forager"))}`);
  result(ok2 && fruit2.steps.length === 1 && fruit2.steps[0] === 5 && tileAt(tree.x, tree.y) === T.FruitTreePicked,
    `(D) fruit tree: fruit changes ${JSON.stringify(fruit2.steps)} (expected +5), tree now picked`);

  // Regrowth, tick-exact while paused.
  await setPaused(true);
  const st = await wild();
  const entry = st.forage.regrow.find((r) => r.index === bush.y * c.W + bush.x);
  result(entry && entry.ticks <= st.forage.regrowTicks && st.forage.regrowTicks === 2000, `(D) picked bush regrows in ${entry?.ticks}t (FORAGE_REGROW_TICKS ${st.forage.regrowTicks} = 1 day)`);
  // Keep the forager from re-picking while we watch: night shelters him; the timer runs regardless.
  await ff(entry.ticks - 1);
  await snaps(2);
  const before = tileAt(bush.x, bush.y);
  await ff(1);
  await snaps(2);
  result(before === T.BerryBushPicked && tileAt(bush.x, bush.y) === T.BerryBush, `(D) still picked one tick before, ripe again on the tick (${before} -> ${tileAt(bush.x, bush.y)})`);
}

// ---- E) nobody hunts or forages at night ----
{
  const st0 = await hook("raidState");
  const DAY = st0.dayTicks;
  const CYCLE = st0.dayTicks + st0.nightTicks;
  let tick = await ff(0);
  // Into the next night, far enough that everyone has walked home.
  await ff(CYCLE - (tick % CYCLE) + DAY + 100);
  await hook("clearWildlife");
  const rabbitId = (await hook("spawnWildlife", { kind: "rabbit", tx: P.x + 5, ty: P.y })).id;
  const bush = { x: P.x + 3, y: P.y + 3 };
  await hook("setTileRaw", { tx: bush.x, ty: bush.y, tile: T.BerryBush });
  const s0 = await stock();
  const badStates = new Set();
  let allSheltering = true;
  for (let i = 0; i < 30; i++) {
    await ff(20);
    const w = await wild();
    for (const q of w.colonists) {
      if (["stalking", "hunting", "foraging", "toForage"].includes(q.state)) badStates.add(`${q.kind}:${q.state}`);
      if (!q.sheltering) allSheltering = false;
    }
  }
  const s1 = await stock();
  const w = await wild();
  const rabbit = w.animals.find((q) => q.id === rabbitId);
  await snaps(2);
  result(badStates.size === 0 && allSheltering, `(E) 30 s of night: hunters/foragers all sheltering, no work states (${[...badStates].join(", ") || "none"})`);
  result(rabbit && rabbit.hp === 6 && s1.meat === s0.meat, `(E) the rabbit is untouched (hp ${rabbit?.hp}) and meat unchanged (${s0.meat} -> ${s1.meat})`);
  result(tileAt(bush.x, bush.y) === T.BerryBush && s1.fruit === s0.fruit, `(E) the bush is still ripe and fruit unchanged (${s0.fruit} -> ${s1.fruit})`);
  // Dawn: work resumes (fast-forwarded so the morning walk back is included).
  tick = await ff(0);
  await ff(CYCLE - (tick % CYCLE) + 1);
  let resumed = false;
  for (let i = 0; i < 60 && !resumed; i++) {
    await ff(20);
    const s2 = await stock();
    resumed = s2.meat > s1.meat && s2.fruit > s1.fruit;
  }
  const s2 = await stock();
  result(resumed, `(E) after dawn both get back to work: meat ${s1.meat} -> ${s2.meat} (rabbit +2), fruit ${s1.fruit} -> ${s2.fruit} (bush +3)`);
}

// ---- F) upgrade in place ----
{
  await setPaused(false);
  const wood0 = c.snap.wood;
  const ev0 = c.events.length;
  const ok = await place(H.x, H.y, T.HunterHut);
  await snaps(4);
  const hunters = c.snap.colonists.filter((q) => q.kind === "hunter" && q.postX === H.x && q.postY === H.y);
  const ev = c.events.slice(ev0).find((e) => e.category === "upgrade");
  result(ok && hunters.length === 2 && c.snap.wood === wood0 - 15 && ev?.text === "Hunter's Hut upgraded to level 2",
    `(F) Hunter's Hut on itself: ${hunters.length} hunters, wood ${wood0} -> ${c.snap.wood}, event "${ev?.text}"`);
}

// ---- G) game tops back up slowly, never past the density caps ----
{
  await setPaused(true);
  await hook("clearWildlife");
  await hook("setWildlifeRespawn", { enabled: true });
  const caps = Object.fromEntries(Object.entries((await wild()).config).map(([k, v]) => [k, v.cap]));
  const capTotal = Object.values(caps).reduce((n, v) => n + v, 0);
  const count = async () => {
    const byKind = {};
    for (const q of (await wild()).animals) byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
    return byKind;
  };
  const total = (k) => Object.values(k).reduce((n, v) => n + v, 0);
  await ff(2000);
  const oneDay = await count();
  // Hunters keep working through the fast-forward, so a day's respawns are an upper bound here.
  result(total(oneDay) >= 1 && total(oneDay) <= 4, `(G) one day after the map was hunted out: ${total(oneDay)} animals back (respawn 4 a day on 80x80): ${JSON.stringify(oneDay)}`);
  // Park the hunters (demolish the hut) so the count isn't eaten while it climbs to the caps.
  await place(H.x, H.y, T.Empty);
  await ff(2000 * 8);
  const full = await count();
  result(total(full) === capTotal && Object.entries(full).every(([k, v]) => v <= caps[k]),
    `(G) after 8 more days the population is back at its caps and no further: ${JSON.stringify(full)} (caps ${JSON.stringify(caps)})`);
  await setPaused(false);
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
