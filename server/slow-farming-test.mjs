// Scripted test: the slow farming cycle. Needs COLONY_TEST_HOOKS=1 (fastForward, farmState, setStock,
// setRaids, setTileRaw) and a private server with no other players:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=80 PORT=8097 npx tsx src/index.ts &   then
//   PORT=8097 node slow-farming-test.mjs
// Checks:
//   A) a new Farm Plot is "sown" (snapshot sownFarmPlots) for the first third of its flat 3-day grow,
//      then "growing", then ripe (readyFarmPlots) exactly FARM_GROW_TICKS after planting;
//   B) each harvest adds exactly FARM_YIELD_PER_HARVEST grain in the tick it completes, and every
//      re-sowing uses the scaled grow time (level / biome / happiness / industrial synergy);
//   C) after FARM_HARVESTS_BEFORE_FALLOW harvests the plot goes fallow (fallowFarmPlots) for exactly
//      FARM_FALLOW_TICKS, then re-sows itself;
//   D) a Pasture delivers its whole batch (FARMHAND_YIELD_PER_CYCLE.meat) once per cycle of tending, its
//      cycle is the scaled FARMHAND_CYCLE_TICKS, tending only advances by day, and nothing lands early.
// Runtime ~30-60 s (fast-forwards ~20 game days).
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
// Mirrors protocol.ts TileType.
const T = { Empty: 0, FarmPlot: 4, BarnPost: 16, Pasture: 21, HunterHut: 50, ForagerHut: 51 };
// Mirrors the server's INDUSTRIAL_TILES (LumberjackPost, BarnPost, mines, farms, crafts, food huts).
const INDUSTRIAL = new Set([3, 16, 9, 10, 21, 22, 23, 24, 25, 26, 27, 30, 50, 51]);

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, hooks: [], tiles: [], W: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcomes++;
    c.W = m.worldTilesX;
    c.tiles = m.tiles.slice();
    c.biomes = m.biomes;
  } else if (m.type === "snapshot") {
    c.snap = m;
    c.snapCount++;
  } else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
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
const ff = async (ticks) => (await hook("fastForward", { ticks })).cycleTick;
const place = async (tx, ty, tile) => {
  send({ type: "setTile", tileX: tx, tileY: ty, tile });
  const deadline = Date.now() + 2000;
  while (c.tiles[ty * c.W + tx] !== tile && Date.now() < deadline) await sleep(10);
  return c.tiles[ty * c.W + tx] === tile;
};
const industrialSynergy = (tx, ty) => {
  let n = 0;
  for (let y = ty - 5; y <= ty + 5; y++)
    for (let x = tx - 5; x <= tx + 5; x++) {
      if ((x === tx && y === ty) || x < 0 || y < 0 || x >= c.W || y >= c.W) continue;
      if (INDUSTRIAL.has(c.tiles[y * c.W + x])) n++;
    }
  return 1 + n * 0.05;
};
const happinessMult = (h) => 0.5 + 0.5 * (h / 100);
// Plains (biome 0) farms run 20% shorter cycles; the spawn area is always Plains.
const biomeFactor = (tx, ty) => (c.biomes[ty * c.W + tx] === 0 ? 0.8 : 1);

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);
await restart();
await hook("setRaids", { enabled: false });
// Barns / plots are built by builders now: place them instantly.
await hook("setInstantBuild", { enabled: true });
// Plenty of everything, so starvation and building costs never interfere.
await hook("setStock", { stock: { wood: 500, grain: 5000, meat: 0, fruit: 0 } });

const me = c.snap.players[0];
const P = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };
const B = { x: P.x, y: P.y - 2 };
const plot = { x: P.x + 1, y: P.y - 2 };
const pasture = { x: P.x - 1, y: P.y - 2 };
for (const t of [B, plot, pasture]) await hook("setTileRaw", { tx: t.x, ty: t.y, tile: T.Empty });
await snaps(2);
result(await place(B.x, B.y, T.BarnPost), `setup: Barn placed at (${B.x},${B.y})`);
await snaps(2);
result(await place(plot.x, plot.y, T.FarmPlot), `setup: Farm Plot placed at (${plot.x},${plot.y})`);
await snaps(2);
// Freeze real-time ticks: from here on the clock only moves through fastForward, so tick-exact
// checks can't be skewed by a live tick sneaking in between two hook calls.
send({ type: "pause" });
while (!c.snap.isPaused) await sleep(10);
const plotIdx = plot.y * c.W + plot.x;
const plotKey = `${plot.x},${plot.y}`;
const farmState = async () => {
  const st = await hook("farmState");
  return { st, p: st.plots.find((q) => q.key === plotKey) };
};

let { st, p } = await farmState();
const K = st.constants;
info(`constants: grow ${K.FARM_GROW_TICKS}t harvest ${K.FARM_HARVEST_TICKS}t sown ${K.FARM_SOWN_FRACTION} fallow ${K.FARM_FALLOW_TICKS}t after ${K.FARM_HARVESTS_BEFORE_FALLOW} harvests, yield ${K.FARM_YIELD_PER_HARVEST}; farmhand cycle ${K.FARMHAND_CYCLE_TICKS}t yields ${JSON.stringify(K.FARMHAND_YIELD_PER_CYCLE)}`);
const DAY = K.DAY_TICKS + K.NIGHT_TICKS;
// Long days (2026-10-23): farm timers stay in real time, counted in legacy 100 s days.
const LDAY = (K.LEGACY_GAME_DAY_TICKS ?? DAY);
result(K.FARM_GROW_TICKS === 3 * LDAY && K.FARM_FALLOW_TICKS === 3 * LDAY && K.FARM_HARVESTS_BEFORE_FALLOW === 5,
  `constants: grow = 3 legacy days (${K.FARM_GROW_TICKS}t), fallow = 3 days (${K.FARM_FALLOW_TICKS}t), fallow after 5 harvests`);
result(K.FARM_YIELD_PER_HARVEST * K.FARM_HARVESTS_BEFORE_FALLOW / ((K.FARM_GROW_TICKS * K.FARM_HARVESTS_BEFORE_FALLOW + K.FARM_FALLOW_TICKS) / LDAY) === 10,
  `constants: long-run grain per plot-day = 5 x ${K.FARM_YIELD_PER_HARVEST} / 18 days = 10 (the old 8 s+2 s cycle's 10/day)`);

// ---- A) sown -> growing -> ripe on the flat first grow ----
result(p && p.state === "sown" && p.growTicksRemaining <= K.FARM_GROW_TICKS && p.growTicksTotal === K.FARM_GROW_TICKS,
  `(A) new plot is sown with the flat ${K.FARM_GROW_TICKS}t grow (state=${p?.state}, remaining=${p?.growTicksRemaining}, total=${p?.growTicksTotal})`);
result(c.snap.sownFarmPlots.includes(plotIdx) && !c.snap.readyFarmPlots.includes(plotIdx) && !c.snap.fallowFarmPlots.includes(plotIdx),
  `(A) snapshot lists the plot in sownFarmPlots only`);
// The server flips to growing once remaining <= total * (1 - FARM_SOWN_FRACTION).
const sownSplit = Math.floor(K.FARM_GROW_TICKS * (1 - K.FARM_SOWN_FRACTION));
await ff(p.growTicksRemaining - sownSplit - 1);
({ p } = await farmState());
result(p.state === "sown" && p.growTicksRemaining === sownSplit + 1, `(A) one tick before the sown/growing split: still sown (remaining ${p.growTicksRemaining})`);
await ff(1);
({ p } = await farmState());
await snaps(2);
result(p.state === "growing" && !c.snap.sownFarmPlots.includes(plotIdx) && !c.snap.readyFarmPlots.includes(plotIdx),
  `(A) at ${sownSplit}t left it is growing (state=${p.state}) and in neither snapshot list`);
await ff(p.growTicksRemaining - 1);
({ p } = await farmState());
result(p.state === "growing" && p.growTicksRemaining === 1, `(A) one tick before ripe: still growing`);
await ff(1);
({ st, p } = await farmState());
await snaps(2);
result(p.state === "harvesting" && c.snap.readyFarmPlots.includes(plotIdx),
  `(A) ripe exactly ${K.FARM_GROW_TICKS}t (3 days) after planting: state=${p.state}, in readyFarmPlots=${c.snap.readyFarmPlots.includes(plotIdx)}`);

// ---- B + C) five harvests, each exactly +yield, then fallow ----
const expectedTicks = (base, h) => Math.max(1, Math.round((base * biomeFactor(plot.x, plot.y)) / (happinessMult(h) * industrialSynergy(B.x, B.y))));
for (let harvest = 1; harvest <= K.FARM_HARVESTS_BEFORE_FALLOW; harvest++) {
  ({ st, p } = await farmState());
  if (p.state !== "harvesting") {
    // Grow to ripe first (scaled grow from the previous re-sowing).
    await ff(p.growTicksRemaining);
    ({ st, p } = await farmState());
  }
  result(p.state === "harvesting", `(B) harvest ${harvest}: plot is ripe before the cut (state=${p.state})`);
  const eH = expectedTicks(K.FARM_HARVEST_TICKS, st.happiness);
  if (harvest > 1) result(p.harvestTicksRemaining === eH, `(B) harvest ${harvest}: harvest phase ${p.harvestTicksRemaining}t == scaled ${eH}t (happiness ${st.happiness}, synergy x${industrialSynergy(B.x, B.y).toFixed(2)})`);
  await ff(p.harvestTicksRemaining - 1);
  const before = (await hook("setStock", { stock: {} })).stock.grain;
  await ff(1);
  const after = (await hook("setStock", { stock: {} })).stock.grain;
  ({ st, p } = await farmState());
  result(after - before === K.FARM_YIELD_PER_HARVEST, `(B) harvest ${harvest}: grain +${after - before} in the completing tick (expected +${K.FARM_YIELD_PER_HARVEST})`);
  if (harvest < K.FARM_HARVESTS_BEFORE_FALLOW) {
    const eG = expectedTicks(K.FARM_GROW_TICKS, st.happiness);
    result(p.state === "sown" && p.growTicksTotal === eG && p.harvestsSinceFallow === harvest,
      `(B) harvest ${harvest}: re-sown at once, grow ${p.growTicksTotal}t == scaled ${eG}t (${(eG / DAY).toFixed(2)} days), harvests so far ${p.harvestsSinceFallow}`);
  } else {
    await snaps(2);
    result(p.state === "fallow" && p.fallowTicksRemaining === K.FARM_FALLOW_TICKS && p.harvestsSinceFallow === 0,
      `(C) after harvest ${harvest} the plot lies fallow for ${p.fallowTicksRemaining}t (expected ${K.FARM_FALLOW_TICKS}t = 3 days)`);
    result(c.snap.fallowFarmPlots.includes(plotIdx) && !c.snap.sownFarmPlots.includes(plotIdx), `(C) snapshot lists the plot in fallowFarmPlots`);
  }
}
await ff(K.FARM_FALLOW_TICKS - 1);
({ st, p } = await farmState());
result(p.state === "fallow" && p.fallowTicksRemaining === 1, `(C) one tick before the rest ends: still fallow`);
await ff(1);
({ st, p } = await farmState());
result(p.state === "sown" && p.growTicksTotal === expectedTicks(K.FARM_GROW_TICKS, st.happiness),
  `(C) fallow over: re-sown automatically while the Barn is staffed (state=${p.state}, grow ${p.growTicksTotal}t)`);

// ---- D) Pasture: one big batch per 3-day tending cycle, daytime only ----
// Put the clock at the start of a day so the cycle's day/night split is predictable.
let tick = await ff(0);
await ff(DAY - (tick % DAY));
await hook("setStock", { stock: { meat: 0 } });
result(await place(pasture.x, pasture.y, T.Pasture), `(D) Pasture placed at (${pasture.x},${pasture.y})`);
await snaps(2);
({ st } = await farmState());
let fh = st.farmhands.find((f) => f.postX === pasture.x && f.postY === pasture.y);
const eCycle = Math.max(1, Math.round((K.FARMHAND_CYCLE_TICKS * biomeFactor(pasture.x, pasture.y)) / (happinessMult(st.happiness) * industrialSynergy(pasture.x, pasture.y))));
result(fh && fh.cycleTicksRemaining === eCycle,
  `(D) farmhand cycle ${fh?.cycleTicksRemaining}t ~= scaled ${K.FARMHAND_CYCLE_TICKS}t x plains/happiness/synergy = ${eCycle}t (${(eCycle / K.DAY_TICKS).toFixed(2)} days of tending)`);
// Through the next night the cycle must not advance.
tick = await ff(0);
await ff(K.DAY_TICKS - (tick % DAY) + 40);
({ st } = await farmState());
const atNight = st.farmhands.find((f) => f.id === fh.id).cycleTicksRemaining;
await ff(K.NIGHT_TICKS - 80);
({ st } = await farmState());
const laterNight = st.farmhands.find((f) => f.id === fh.id).cycleTicksRemaining;
result(atNight === laterNight, `(D) no tending at night: cycle ${atNight}t -> ${laterNight}t over ${K.NIGHT_TICKS - 80} night ticks`);
// Run until the batch lands, watching meat in 100-tick steps.
let meatSteps = [];
let lastMeat = (await hook("setStock", { stock: {} })).stock.meat;
let elapsed = 0;
while (elapsed < 6 * DAY) {
  await ff(100);
  elapsed += 100;
  const meat = (await hook("setStock", { stock: {} })).stock.meat;
  if (meat !== lastMeat) meatSteps.push({ at: elapsed, d: meat - lastMeat });
  lastMeat = meat;
  if (meatSteps.length >= 2) break;
}
info(`(D) meat deliveries (ticks after the first night, delta): ${JSON.stringify(meatSteps)}`);
result(meatSteps.length >= 1 && meatSteps[0].d === K.FARMHAND_YIELD_PER_CYCLE.meat,
  `(D) first delivery is the whole batch: +${meatSteps[0]?.d} meat (expected +${K.FARMHAND_YIELD_PER_CYCLE.meat})`);
// A cycle of eCycle daytime ticks spans eCycle / DAY_TICKS days on the clock (nights don't count).
const gapDays = meatSteps.length >= 2 ? (meatSteps[1].at - meatSteps[0].at) / DAY : NaN;
const cycleDays = eCycle / K.DAY_TICKS;
result(meatSteps.length >= 2 && meatSteps[1].d === K.FARMHAND_YIELD_PER_CYCLE.meat && Math.abs(gapDays - cycleDays) <= 0.5,
  `(D) next batch is another +${meatSteps[1]?.d} one cycle later: ${gapDays.toFixed(2)} days apart (cycle = ${cycleDays.toFixed(2)} days of tending), nothing in between`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
