// Scripted test: the autumn "Prepare for winter" goal (DESIGN-REVIEW-nov20 gap G-B; numbers in shared/src/winter.ts
// WINTER_PREP_*; server/src/goals.ts evaluateWinterPrep + winter.ts winterPrepStatus). Needs a private server WITH
// seasons, test hooks, instant build and W80 (`npm test -- winter-prep-goal` gives that). Checks: the goal is absent in
// summer and winter, present in autumn with fuel days / clothes needs in the winter snapshot; it does not complete while
// the fuel covers fewer than WINTER_PREP_FUEL_DAYS days of the homes' burn; it completes once, pays WINTER_PREP_REWARD
// once and leaves the linear goal track alone; it comes back the next autumn; with seasons off it never posts or pays.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = { Empty: 0, House: 13, BigHouse: 14, TailorShop: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), saves: [], workTab: null };
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
  await until(() => c.hooks.has(op), 8000);
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
  else if (m.type === "workTab") c.workTab = m.tab;
});
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await until(() => c.welcome && c.snap, 20000);
c.welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => c.welcome && c.snap, 30000);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 20 * 10 });

const tileAt = (x, y) => c.tiles[y * c.W + x];
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const evSince = (n) => c.events.slice(n).join(" | ");
const cal = (args = {}) => hook("calendar", args);
// Jump to (season, day) of this year and run the calendar's day change (the winter dawn) now.
const goTo = (season, day = 1) => cal({ set: { season, day }, update: true });
const win = (args = {}) => hook("winter", args);
const prog = (args = {}) => hook("progression", args);
const items = async () => (await prog()).items;
const setStock = (stock) => hook("setStock", { stock });
const stock = async () => (await setStock({})).stock;
// Sets an item to exactly n (Poor grade added when short).
const setExact = async (id, n) => {
  const have = (await items())[id] ?? 0;
  if (n !== have) await prog({ items: { [id]: n - have } });
  const now = (await items())[id] ?? 0;
  if (now !== n) console.log(`  (setExact ${id}: wanted ${n}, have ${now})`);
};
const place = async (x, y, tile) => {
  await tp(x - 1, y - 1);
  for (let i = 0; i < 6 && tileAt(x, y) !== tile; i++) {
    send({ type: "setTile", tileX: x, tileY: y, tile });
    await until(() => tileAt(x, y) === tile, 400);
    if (tileAt(x, y) !== tile) await ff(10);
  }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// Back to early morning of the current day (villagers are out working, not sheltering for the night).
const GAME_DAY = 20 * (300 + 75);
const morning = async () => {
  const t = (await ff(0)).cycleTick;
  await hook("setCycleTick", { tick: Math.floor(t / GAME_DAY) * GAME_DAY + 400 });
};


const GOAL_FUEL_DAYS = 5;
const REWARD_WOOD = 20;
let S;
await ff(5);
const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 14 < c.W - 2 ? tc.x + 6 : tc.x - 20;
const by = Math.max(6, Math.min(c.W - 12, tc.y - 3));
for (let y = by - 2; y <= by + 8; y++) for (let x = bx - 2; x <= bx + 12; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await setStock({ wood: 500, rock: 500, iron: 100, grain: 500, meat: 100, fruit: 100, clothes: 0, wool: 0, cotton: 0 });
for (const id of ["coal", "charcoal", "coat", "boots", "tunic", "hide"]) await setExact(id, 0);
// Park the linear goal track on its last goal (Castle Ruin: no payout) so its wood rewards do not muddy the stock checks.
await hook("setGoalIndex", { index: 8 });
await place(bx, by, T.House);
await place(bx + 3, by, T.House);
await hook("assignHomes");
await cal({ update: true });
let W = await win({ update: true });
const burn = W.units.reduce((n, u) => n + u.need, 0);
result(burn > 0, `homes burn ${burn} heat a winter day`);
// Wait for a snapshot newer than the last change (the winter snapshot is cached a second of wall time).
const prepNow = async () => {
  await sleep(1200);
  await ff(1);
  await sleep(1200);
  return c.snap?.winter?.prep;
};

// 1. last summer day: no goal.
await setStock({ wood: 2 });
await goTo(1, 7);
result((await prepNow()) === undefined, `summer: no winter-prep goal`);

// Heat the clan still carries over from fractional burns counts toward the goal: size the wood by it.
const woodFor = async (days) => Math.ceil(burn * days - ((await win()).state?.carry ?? 0));
// 2. autumn: the goal posts with fuel days and clothes needs; short of fuel it does not complete.
await goTo(2, 1);
let prep = await prepNow();
result(!!prep && prep.target === GOAL_FUEL_DAYS && prep.needClothes > 0 && prep.fuelDays < 1 && prep.reward === `${REWARD_WOOD} wood`, `autumn: goal posts ${JSON.stringify(prep)}`);
const full = await woodFor(GOAL_FUEL_DAYS);
await setStock({ wood: full - 1 });
await ff(30);
prep = await prepNow();
S = await stock();
result(!!prep && prep.fuelDays < GOAL_FUEL_DAYS && S.wood === full - 1, `just short (${prep?.fuelDays} of ${GOAL_FUEL_DAYS} days): not complete, no payout (wood ${S.wood})`);

// 3. fuel covers the first cold stretch: completes once and pays once.
let ev = c.events.length;
const goalIdx = (await hook("goalState")).goalIndex;
await setStock({ wood: full });
await ff(30);
S = await stock();
result(S.wood === full + REWARD_WOOD && /Prepare for winter/.test(evSince(ev)), `fuel for ${GOAL_FUEL_DAYS} days: paid ${REWARD_WOOD} wood once (wood ${S.wood}); event "${evSince(ev)}"`);
await ff(60);
S = await stock();
result(S.wood === full + REWARD_WOOD, `no second payout (wood ${S.wood})`);
result((await prepNow()) === undefined, `goal gone from the snapshot once done`);
const goalAfter = (await hook("goalState")).goalIndex;
result(goalAfter === goalIdx, `the linear goal track is untouched by it (index ${goalIdx} -> ${goalAfter})`);

// 4. winter: no goal; next autumn: it posts again and pays again.
await goTo(3, 1);
result((await prepNow()) === undefined, `winter: no goal`);
await cal({ set: { year: 2, season: 2, day: 2 }, update: true });
await setStock({ wood: 5 });
prep = await prepNow();
result(!!prep, `next year's autumn: the goal posts again`);
const full2 = await woodFor(GOAL_FUEL_DAYS);
await setStock({ wood: full2 });
await ff(30);
S = await stock();
result(S.wood === full2 + REWARD_WOOD, `next year: pays once more (wood ${S.wood})`);

// 5. seasons off: it never posts, nothing is paid.
await cal({ off: true });
await goTo(2, 1);
await setStock({ wood: burn * 20 });
await ff(30);
await sleep(1200);
S = await stock();
result(!c.snap.winter && S.wood === burn * 20, `seasons off: no goal, no payout (wood ${S.wood})`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
