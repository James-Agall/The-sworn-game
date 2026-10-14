// Scripted test: 80x80 map, biomes (+ gameplay effects), water, ruins, encampments, guardians.
//   A) static world-gen checks on a fresh world (restart): size, biome mix + Plains spawn area,
//      water, ruin/encampment sites with their dormant guardians (kinds, counts, placement), and
//      that every guardian stays put (dormant) for a few seconds.
//   B) Plains farming bonus: a Pasture placed next to spawn (always Plains) gets a tending cycle of
//      round(FARMHAND_CYCLE_TICKS * 0.8 / happinessMult) ticks, and delivers its batch of meat when that
//      runs out (paused + testHook fastForward: the cycle is 3 days of daylight). Needs COLONY_TEST_HOOKS=1.
//   C) Swamp speed penalty: walk the player to a swamp tile and measure per-tick displacement
//      (150px/s * 0.75 / 20 = 5.625px) vs. on Plains (7.5px).
//   D) Hills mining bonus: walk to an Iron Ore / Rock tile on Hills, place a mine on it, measure
//      ticks between resource increments vs. round(CHOP_TICKS * 0.8 / happinessMult).
//   E) Guardian group activation: walk to the nearest site, hit one guardian, step away, and check
//      EVERY guardian of that site moved (woke up) while another site's guardians stayed put.
//   F) restart regenerates biomes / water / ruins / encampments / guardians.
//   G) the player can't walk into Water (live server collision).
// Each section starts with a "restart" (day 0, fresh world) so it runs in daylight. Note: this
// resets the world for every connected client. Select sections with ONLY=A,B,... (default all).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "A,B,C,D,E,F,G").split(","));
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const CHOP_TICKS = 40;

// Mirrors of protocol.ts values used here.
const T = {
  Empty: 0, Wall: 1, Tree: 2, IronOre: 7, Rock: 8, IronMinePost: 9, RockMinePost: 10, TownCenter: 12,
  Pasture: 21, Water: 35, RuinWall1: 36, RuinWall2: 37, RuinArch: 38, RuinStatue: 39, RuinRubble: 40,
  PropCampfire: 41, PropCart: 42, PropBarrel: 43, PropCrate: 44, PropFence: 45,
};
const RUIN_CENTER = new Set([T.RuinWall1, T.RuinWall2, T.RuinArch]);
const RUIN_EXTRA = new Set([T.RuinStatue, T.RuinRubble]);
const ENC_EXTRA = new Set([T.PropCart, T.PropBarrel, T.PropCrate, T.PropFence]);
const BIOME = { Plains: 0, Hills: 1, Swamp: 2 };
// Mirror of protocol.ts isSolidTile: every TileType except Empty (0), FarmPlot (4), berry bushes (52/53) and
// mushroom patches (56/57).
const SOLID = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 54, 55]);

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [], hooks: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "testHookResult") {
      c.hooks.push(m);
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      for (const fn of c.listeners) fn(m, prev);
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hook = async (op, args = {}) => {
    const before = c.hooks.length;
    c.send({ type: "testHook", op, ...args });
    const deadline = Date.now() + 60000;
    while (c.hooks.length === before) {
      if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}: is COLONY_TEST_HOOKS=1 set?`);
      await sleep(5);
    }
    return c.hooks[c.hooks.length - 1];
  };
  c.me = (s = c.snap) => s.players.find((p) => p.id === c.welcome.id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.nextSnap = () => new Promise((r) => { const fn = (s) => { c.listeners.splice(c.listeners.indexOf(fn), 1); r(s); }; c.listeners.push(fn); });
  return c;
}

const a = connect();
await a.ready();
const W = () => a.welcome.worldTilesX;
const H = () => a.welcome.worldTilesY;
const idx = (x, y) => y * W() + x;
const tileAt = (x, y) => a.tiles[idx(x, y)];
const biomeAt = (x, y) => a.welcome.biomes[idx(x, y)];
const inB = (x, y) => x >= 0 && y >= 0 && x < W() && y < H();
const walkable = (x, y) => inB(x, y) && !SOLID.has(tileAt(x, y));
const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
const center = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

async function restart() {
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.nextSnap();
  await a.nextSnap();
  if (a.snap.isPaused) a.send({ type: "pause" });
  a.send({ type: "input", dx: 0, dy: 0 });
}

// 4-connected BFS over walkable tiles (same rule as the server's findPath).
function bfs(start, goalFn) {
  const prev = new Map([[idx(start.x, start.y), null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (goalFn(cur)) {
      const path = [];
      let k = idx(cur.x, cur.y);
      let t = cur;
      while (t) { path.unshift(t); t = prev.get(idx(t.x, t.y)); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!walkable(n.x, n.y) || prev.has(idx(n.x, n.y))) continue;
      prev.set(idx(n.x, n.y), cur);
      q.push(n);
    }
  }
  return null;
}

// Steers the player along a tile path (tile centers), one input per snapshot.
async function followPath(path, { stopWhen, timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let i = 1;
  let lastProgress = Date.now();
  let lastPos = a.me();
  while (Date.now() < deadline) {
    const s = await a.nextSnap();
    const me = a.me(s);
    if (stopWhen && stopWhen(me, s)) break;
    if (i >= path.length) break;
    const target = center(path[i]);
    const ddx = target.x - me.x;
    const ddy = target.y - me.y;
    if (Math.abs(ddx) <= 4 && Math.abs(ddy) <= 4) {
      i++;
      continue;
    }
    if (dist(me, lastPos) > 1) { lastProgress = Date.now(); lastPos = me; }
    if (Date.now() - lastProgress > 1500) {
      // Stuck on a corner: re-plan from the current tile to the same final tile.
      const goal = path[path.length - 1];
      const re = bfs(tileOf(me), (t) => t.x === goal.x && t.y === goal.y);
      if (!re) break;
      path = re;
      i = 1;
      lastProgress = Date.now();
      continue;
    }
    a.send({ type: "input", dx: Math.abs(ddx) > 4 ? Math.sign(ddx) : 0, dy: Math.abs(ddy) > 4 ? Math.sign(ddy) : 0 });
  }
  a.send({ type: "input", dx: 0, dy: 0 });
  await a.nextSnap();
  await a.nextSnap();
  return a.me();
}

// Groups the world's POI sites: each centerpiece tile (ruin wall/arch, campfire) + its extras +
// the mobs whose nearest centerpiece it is.
function readSites(s = a.snap) {
  const sites = [];
  for (let y = 0; y < H(); y++) {
    for (let x = 0; x < W(); x++) {
      const t = tileAt(x, y);
      if (RUIN_CENTER.has(t)) sites.push({ kind: "ruin", x, y, tile: t, mobs: [], extras: [] });
      else if (t === T.PropCampfire) sites.push({ kind: "encampment", x, y, tile: t, mobs: [], extras: [] });
    }
  }
  for (const site of sites) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = tileAt(site.x + dx, site.y + dy);
      if ((site.kind === "ruin" ? RUIN_EXTRA : ENC_EXTRA).has(t)) site.extras.push(t);
    }
  }
  for (const m of s.mobs) {
    let best = null;
    let bd = Infinity;
    for (const site of sites) {
      const d = dist(m, center(site));
      if (d < bd) { bd = d; best = site; }
    }
    if (best) best.mobs.push({ ...m, dTiles: bd / TILE });
  }
  return sites;
}

const TC = () => ({ x: Math.floor(W() / 2), y: Math.floor(H() / 2) });
const happinessMult = (h) => 0.5 + 0.5 * (h / 100);

// Watches a stock key; returns [{ interval, happinessAtStart }] between consecutive increments.
async function measureIntervals(key, count, timeoutMs) {
  const out = [];
  let lastTick = null;
  let lastHappiness = null;
  let tick = 0;
  let prevVal = a.snap[key];
  const deadline = Date.now() + timeoutMs;
  while (out.length < count && Date.now() < deadline) {
    const s = await a.nextSnap();
    tick++;
    if (s[key] > prevVal) {
      if (lastTick !== null) out.push({ interval: tick - lastTick, happiness: lastHappiness });
      lastTick = tick;
      lastHappiness = s.happiness;
    }
    prevVal = s[key];
  }
  return out;
}

// ---------------------------------------------------------------- A: static world-gen
if (ONLY.has("A")) {
  await restart();
  const w = a.welcome;
  result(w.worldTilesX === 80 && w.worldTilesY === 80 && w.tiles.length === 6400,
    `world is 80x80: worldTilesX=${w.worldTilesX} worldTilesY=${w.worldTilesY} tiles.length=${w.tiles.length}`);
  result(Array.isArray(w.biomes) && w.biomes.length === 6400, `welcome.biomes length=${w.biomes?.length}`);
  const counts = [0, 0, 0];
  for (const b of w.biomes) counts[b]++;
  result(counts[0] > 0 && counts[1] > 0 && counts[2] > 0,
    `biome mix: Plains=${counts[0]} (${(counts[0] / 64).toFixed(1)}%) Hills=${counts[1]} (${(counts[1] / 64).toFixed(1)}%) Swamp=${counts[2]} (${(counts[2] / 64).toFixed(1)}%)`);
  let nonPlainsNearTC = 0;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    if (Math.hypot(dx, dy) <= 6 && biomeAt(TC().x + dx, TC().y + dy) !== BIOME.Plains) nonPlainsNearTC++;
  }
  result(nonPlainsNearTC === 0, `every tile within 6 of the Town Center (${TC().x},${TC().y}) is Plains (non-Plains: ${nonPlainsNearTC})`);
  result(tileAt(TC().x, TC().y) === T.TownCenter, `Town Center tile still at map center`);

  const resourceCounts = { tree: 0, ore: 0, rock: 0, water: 0 };
  let waterNearTC = 0;
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    const t = tileAt(x, y);
    if (t === T.Tree) resourceCounts.tree++;
    if (t === T.IronOre) resourceCounts.ore++;
    if (t === T.Rock) resourceCounts.rock++;
    if (t === T.Water) {
      resourceCounts.water++;
      if (Math.hypot(x - TC().x, y - TC().y) < 15) waterNearTC++;
    }
  }
  console.log(`[${el()}] scatter: trees=${resourceCounts.tree} ironOre=${resourceCounts.ore} rock=${resourceCounts.rock} water=${resourceCounts.water}`);
  result(resourceCounts.tree === 96 && resourceCounts.ore === 56 && resourceCounts.rock === 64,
    `resource counts scaled ~4x (expect 96/56/64)`);
  result(resourceCounts.water > 0, `water tiles exist (${resourceCounts.water})`);
  result(waterNearTC === 0, `no water within 15 tiles of the Town Center (${waterNearTC})`);

  const sites = readSites();
  const ruins = sites.filter((s) => s.kind === "ruin");
  const encs = sites.filter((s) => s.kind === "encampment");
  console.log(`[${el()}] sites: ruins=${ruins.length} encampments=${encs.length}`);
  for (const s of sites) {
    console.log(`    ${s.kind.padEnd(10)} @(${s.x},${s.y}) center=${s.tile} extras=[${s.extras.join(",")}] guardians=[${s.mobs.map((m) => `${m.kind}@${m.dTiles.toFixed(1)}t`).join(", ")}]`);
  }
  result(ruins.length >= 6 && ruins.length <= 10, `6-10 ruin sites (${ruins.length})`);
  result(encs.length >= 6 && encs.length <= 10, `6-10 encampment sites (${encs.length})`);
  result(ruins.every((s) => s.extras.length <= 2), `every ruin has 0-2 statue/rubble extras around its centerpiece`);
  result(encs.every((s) => s.extras.length >= 1 && s.extras.length <= 3), `every encampment has 1-3 cart/barrel/crate/fence extras around its campfire`);
  result(ruins.every((s) => s.mobs.length >= 2 && s.mobs.length <= 3), `every ruin has 2-3 guardians: [${ruins.map((s) => s.mobs.length).join(",")}]`);
  result(encs.every((s) => s.mobs.length >= 2 && s.mobs.length <= 4), `every encampment has 2-4 guardians: [${encs.map((s) => s.mobs.length).join(",")}]`);
  const ruinKinds = new Set(ruins.flatMap((s) => s.mobs.map((m) => m.kind)));
  result([...ruinKinds].every((k) => ["skeleton", "darkShaman", "orc"].includes(k)), `ruin guardian kinds ⊆ {skeleton, darkShaman, orc}: {${[...ruinKinds].join(", ")}}`);
  const encKinds = new Set(encs.flatMap((s) => s.mobs.map((m) => m.kind)));
  const BANDIT_MAX_HP = { banditClubman: 30, banditArcher: 25, banditElite: 70 };
  result([...encKinds].every((k) => k in BANDIT_MAX_HP), `encampment guardian kinds ⊆ {banditClubman, banditArcher, banditElite}: {${[...encKinds].join(", ")}}`);
  result(encKinds.size >= 2, `encampments field a mix of bandit kinds (${encKinds.size} distinct)`);
  const bandits = a.snap.mobs.filter((m) => m.kind in BANDIT_MAX_HP);
  const banditCounts = Object.fromEntries(Object.keys(BANDIT_MAX_HP).map((k) => [k, bandits.filter((m) => m.kind === k).length]));
  result(bandits.every((m) => m.maxHp === BANDIT_MAX_HP[m.kind] && m.hp === m.maxHp), `bandit maxHp matches kind (clubman 30 / archer 25 / elite 70): ${JSON.stringify(banditCounts)}`);
  result(sites.flatMap((s) => s.mobs).every((m) => m.dTiles <= 2 * Math.SQRT2 + 0.01), `every guardian stands within its site's 5x5 footprint`);
  const allMobTilesWalkable = a.snap.mobs.every((m) => walkable(tileOf(m).x, tileOf(m).y));
  result(allMobTilesWalkable, `every guardian stands on a walkable tile`);
  result(!a.snap.isNight && a.snap.mobs.length > 0, `${a.snap.mobs.length} mobs present at world load in daytime (none night-spawned yet)`);

  const startPos = new Map(a.snap.mobs.map((m) => [m.id, { x: m.x, y: m.y }]));
  await sleep(3000);
  const moved = a.snap.mobs.filter((m) => dist(m, startPos.get(m.id)) > 0.01);
  result(moved.length === 0 && a.snap.mobs.length === startPos.size, `all guardians dormant for 3s (moved: ${moved.length}, count ${a.snap.mobs.length}/${startPos.size})`);
}

// ---------------------------------------------------------------- B: Plains farming bonus
if (ONLY.has("B")) {
  await restart();
  const me = tileOf(a.me());
  let placed = null;
  for (const [dx, dy] of [[0, 2], [2, 0], [0, -2], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const t = { x: me.x + dx, y: me.y + dy };
    if (tileAt(t.x, t.y) === T.Empty && biomeAt(t.x, t.y) === BIOME.Plains) { placed = t; break; }
  }
  if (!placed) {
    result(false, "B: no empty Plains tile next to spawn for a Pasture");
  } else {
    // Freeze real time first, so the cycle the farmhand is given on placement is read untouched.
    a.send({ type: "pause" });
    while (!a.snap.isPaused) await sleep(10);
    await a.hook("setRaids", { enabled: false });
    a.send({ type: "setTile", tileX: placed.x, tileY: placed.y, tile: T.Pasture });
    await sleep(300);
    result(tileAt(placed.x, placed.y) === T.Pasture, `B: Pasture placed on Plains at (${placed.x},${placed.y})`);
    const st = await a.hook("farmState");
    const fh = st.farmhands.find((f) => f.postX === placed.x && f.postY === placed.y);
    const K = st.constants;
    const plainsExpect = Math.max(1, Math.round((K.FARMHAND_CYCLE_TICKS * 0.8) / happinessMult(st.happiness)));
    const noBonus = Math.max(1, Math.round(K.FARMHAND_CYCLE_TICKS / happinessMult(st.happiness)));
    result(fh && fh.cycleTicksRemaining === plainsExpect && plainsExpect !== noBonus,
      `B: Plains Pasture cycle ${fh?.cycleTicksRemaining}t == round(${K.FARMHAND_CYCLE_TICKS}*0.8/happinessMult(${st.happiness})) = ${plainsExpect}t (no-bonus would be ${noBonus}t)`);
    // Tending only advances by day, so run whole days until the batch lands.
    const meat0 = a.snap.meat;
    let delivered = false;
    for (let i = 0; i < 12 && !delivered; i++) {
      await a.hook("fastForward", { ticks: 1000 });
      const now = (await a.hook("farmState")).farmhands.find((f) => f.id === fh.id);
      await a.nextSnap();
      delivered = a.snap.meat > meat0;
      if (delivered) result(a.snap.meat - meat0 === K.FARMHAND_YIELD_PER_CYCLE.meat, `B: the cycle delivered +${a.snap.meat - meat0} meat in one batch (expected +${K.FARMHAND_YIELD_PER_CYCLE.meat}); next cycle ${now.cycleTicksRemaining}t`);
    }
    if (!delivered) result(false, `B: no meat after 6 game days`);
    a.send({ type: "pause" });
    while (a.snap.isPaused) await sleep(10);
    await a.hook("setRaids", { enabled: true });
  }
}

// ---------------------------------------------------------------- C: Swamp speed penalty
async function measureStep(dx, dy = 0) {
  const steps = [];
  a.send({ type: "input", dx, dy });
  let prev = (await a.nextSnap(), a.me());
  for (let i = 0; i < 6; i++) {
    const s = await a.nextSnap();
    const me = a.me(s);
    steps.push({ step: Math.abs(me.x - prev.x) + Math.abs(me.y - prev.y), biome: biomeAt(tileOf(prev).x, tileOf(prev).y) });
    prev = me;
  }
  a.send({ type: "input", dx: 0, dy: 0 });
  await a.nextSnap();
  return steps;
}

if (ONLY.has("C")) {
  await restart();
  // Plains baseline: walk along a free horizontal run next to spawn.
  const me0 = tileOf(a.me());
  const dirPlains = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => [1, 2, 3].every((k) => walkable(me0.x + dx * k, me0.y + dy * k)));
  const plainsSteps = dirPlains ? (await measureStep(...dirPlains)).filter((s) => s.biome === BIOME.Plains && s.step > 0) : [];
  const plainsMax = Math.max(...plainsSteps.map((s) => s.step));
  result(plainsSteps.length > 0 && Math.abs(plainsMax - 7.5) < 0.01, `C: Plains step = ${plainsMax.toFixed(3)}px/tick (expect 150/20=7.5)`);
  // Find a swamp tile with 4 walkable swamp tiles in a row to its right (or left).
  const runOk = (t, d) => [0, 1, 2, 3, 4].every((k) => walkable(t.x + d * k, t.y) && biomeAt(t.x + d * k, t.y) === BIOME.Swamp);
  let runDir = 1;
  const path = bfs(tileOf(a.me()), (t) => {
    if (runOk(t, 1)) { runDir = 1; return true; }
    if (runOk(t, -1)) { runDir = -1; return true; }
    return false;
  });
  if (!path) {
    result(false, "C: no reachable swamp run found");
  } else {
    const goal = path[path.length - 1];
    const me = await followPath(path);
    const at = tileOf(me);
    console.log(`[${el()}] C: walked ${path.length - 1} tiles to swamp (${goal.x},${goal.y}), now at (${at.x},${at.y}) biome=${biomeAt(at.x, at.y)}`);
    const steps = await measureStep(runDir);
    const swampSteps = steps.filter((s) => s.biome === BIOME.Swamp && s.step > 0);
    const swampMax = Math.max(...swampSteps.map((s) => s.step));
    result(swampSteps.length >= 3 && Math.abs(swampMax - 5.625) < 0.01, `C: Swamp step = ${swampSteps.map((s) => s.step.toFixed(3)).join(",")} px/tick (expect 150*0.75/20=5.625)`);
  }
}

// ---------------------------------------------------------------- D: Hills mining bonus
if (ONLY.has("D")) {
  await restart();
  const isHillsOre = (x, y) => inB(x, y) && (tileAt(x, y) === T.IronOre || tileAt(x, y) === T.Rock) && biomeAt(x, y) === BIOME.Hills;
  let ore = null;
  const path = bfs(tileOf(a.me()), (t) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isHillsOre(t.x + dx, t.y + dy)) { ore = { x: t.x + dx, y: t.y + dy }; return true; }
    }
    return false;
  });
  if (!path) {
    result(false, "D: no reachable Iron Ore / Rock on Hills this world (re-run to reroll)");
  } else {
    await followPath(path);
    const oreType = tileAt(ore.x, ore.y);
    const mineType = oreType === T.IronOre ? T.IronMinePost : T.RockMinePost;
    const key = oreType === T.IronOre ? "iron" : "rock";
    a.send({ type: "setTile", tileX: ore.x, tileY: ore.y, tile: mineType });
    await sleep(300);
    result(tileAt(ore.x, ore.y) === mineType, `D: ${key} mine placed on Hills ore at (${ore.x},${ore.y}) after walking ${path.length - 1} tiles`);
    const intervals = await measureIntervals(key, 3, 15000);
    const ok = intervals.length >= 2 && intervals.every((iv) => iv.interval === Math.max(1, Math.round((CHOP_TICKS * 0.8) / happinessMult(iv.happiness))));
    result(ok, `D: Hills mine ${key} interval == round(40*0.8/happinessMult): ${intervals.map((iv) => `${iv.interval}t (h=${iv.happiness}, hills-expect=${Math.round(32 / happinessMult(iv.happiness))}, no-bonus=${Math.round(40 / happinessMult(iv.happiness))})`).join("; ")}`);
  }
}

// ---------------------------------------------------------------- E: guardian group activation
if (ONLY.has("E")) {
  await restart();
  const sites = readSites();
  const guardianTiles = new Map();
  for (const site of sites) for (const m of site.mobs) guardianTiles.set(idx(tileOf(m).x, tileOf(m).y), site);
  let targetSite = null;
  const path = bfs(tileOf(a.me()), (t) => {
    const s = guardianTiles.get(idx(t.x, t.y));
    if (s) { targetSite = s; return true; }
    return false;
  });
  if (!path) {
    result(false, "E: no reachable guardian");
  } else {
    const initial = new Map(a.snap.mobs.map((m) => [m.id, { x: m.x, y: m.y }]));
    const siteIds = new Set(targetSite.mobs.map((m) => m.id));
    const others = sites.filter((s) => s !== targetSite).flatMap((s) => s.mobs.map((m) => m.id));
    console.log(`[${el()}] E: walking ${path.length - 1} tiles to the ${targetSite.kind} at (${targetSite.x},${targetSite.y}) with ${siteIds.size} guardians`);
    const nearest = () => targetSite.mobs.map((m) => a.snap.mobs.find((x) => x.id === m.id)).filter(Boolean).reduce((b, m) => (!b || dist(m, a.me()) < dist(b, a.me()) ? m : b), null);
    await followPath(path, { stopWhen: (me) => { const n = nearest(); return n && dist(n, me) <= 34; } });
    const preMoved = a.snap.mobs.filter((m) => siteIds.has(m.id) && dist(m, initial.get(m.id)) > 0.01);
    result(preMoved.length === 0, `E: site guardians still dormant on arrival (moved: ${preMoved.length})`);
    // A woken ranged guardian (darkShaman, 5-tile range) may just shoot from where it stands, so
    // "awake" = moved OR fired an attack effect from its own position. Dormant mobs do neither.
    const fired = new Set();
    a.listeners.push((s) => {
      for (const e of s.effects) {
        const shooter = s.mobs.find((m) => siteIds.has(m.id) && Math.abs(m.x - e.fromX) < 0.01 && Math.abs(m.y - e.fromY) < 0.01);
        if (shooter) fired.add(shooter.id);
      }
    });
    const hpBefore = new Map(a.snap.mobs.map((m) => [m.id, m.hp]));
    a.send({ type: "attack" });
    await a.nextSnap();
    await a.nextSnap();
    const hit = a.snap.mobs.filter((m) => (hpBefore.get(m.id) ?? m.hp) > m.hp);
    // A darkShaman in the site wakes with its heal off cooldown and heals the just-hit guardian
    // for 15 (== PLAYER_ATTACK_DAMAGE) in the same tick, so the hp drop can be invisible there.
    const hasShaman = targetSite.mobs.some((m) => m.kind === "darkShaman");
    result((hit.length === 1 && siteIds.has(hit[0].id)) || (hit.length === 0 && hasShaman),
      `E: the hit landed on one guardian of this site: ${hit.length ? hit.map((m) => `${m.kind} ${hpBefore.get(m.id)}->${m.hp}`).join(", ") : "no visible hp drop (site has a darkShaman that heals 15 on wake)"}`);
    // Step back toward spawn ~3 tiles so even guardians already in melee range must move to follow.
    const back = path.slice(Math.max(0, path.length - 5)).reverse();
    await followPath(back, { timeoutMs: 4000 });
    await sleep(2500);
    const live = a.snap.mobs.filter((m) => siteIds.has(m.id));
    const awake = live.filter((m) => dist(m, initial.get(m.id)) > TILE * 0.75 || fired.has(m.id));
    result(live.length === siteIds.size && awake.length === live.length,
      `E: ALL ${live.length}/${siteIds.size} guardians of the hit site woke (moved or attacked): ${live.map((m) => `${m.kind} moved ${(dist(m, initial.get(m.id)) / TILE).toFixed(1)}t${fired.has(m.id) ? " +fired" : ""}`).join(", ")}`);
    const otherMoved = a.snap.mobs.filter((m) => others.includes(m.id) && dist(m, initial.get(m.id)) > 0.01);
    result(otherMoved.length === 0, `E: guardians of the other ${sites.length - 1} sites stayed dormant (moved: ${otherMoved.length}/${others.length})`);
  }
}

// ---------------------------------------------------------------- G: water blocks movement
// Live check of the server's collision against Water (collidesAt and the pathfinder's
// isWalkableTile both go through the same protocol isSolidTile).
if (ONLY.has("G")) {
  await restart();
  let dir = null;
  const path = bfs(tileOf(a.me()), (t) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inB(t.x + dx, t.y + dy) && tileAt(t.x + dx, t.y + dy) === T.Water) { dir = { dx, dy }; return true; }
    }
    return false;
  });
  if (!path) {
    result(false, "G: no reachable water");
  } else {
    const shore = path[path.length - 1];
    await followPath(path);
    a.send({ type: "input", dx: dir.dx, dy: dir.dy });
    await sleep(1500);
    a.send({ type: "input", dx: 0, dy: 0 });
    await a.nextSnap();
    const me = a.me();
    const at = tileOf(me);
    const water = { x: shore.x + dir.dx, y: shore.y + dir.dy };
    const shoreCenter = center(shore);
    // How far past the shore tile's center the player got toward the water (max 16 - 10 = 6px
    // before its 10px half-size box would touch the water tile).
    const pushed = (me.x - shoreCenter.x) * dir.dx + (me.y - shoreCenter.y) * dir.dy;
    result(tileAt(at.x, at.y) !== T.Water && pushed <= 6.01,
      `G: pushing into water at (${water.x},${water.y}) for 1.5s from shore (${shore.x},${shore.y}) stops at the edge: now at tile (${at.x},${at.y}), ${pushed.toFixed(1)}px past shore center`);
  }
}

// ---------------------------------------------------------------- F: restart regenerates
if (ONLY.has("F")) {
  await restart();
  const w1 = a.welcome;
  const mobs1 = new Set(a.snap.mobs.map((m) => m.id));
  const sites1 = readSites().map((s) => `${s.kind}@${s.x},${s.y}`).sort().join(" ");
  await restart();
  const w2 = a.welcome;
  const mobs2 = a.snap.mobs.map((m) => m.id);
  const sites2 = readSites().map((s) => `${s.kind}@${s.x},${s.y}`).sort().join(" ");
  const biomeDiff = w1.biomes.filter((b, i) => b !== w2.biomes[i]).length;
  const water1 = w1.tiles.map((t, i) => (t === T.Water ? i : -1)).filter((i) => i >= 0).join(",");
  const water2 = w2.tiles.map((t, i) => (t === T.Water ? i : -1)).filter((i) => i >= 0).join(",");
  result(biomeDiff > 0, `F: biomes regenerated (${biomeDiff} tiles changed)`);
  result(water1 !== water2, `F: ponds regenerated`);
  result(sites1 !== sites2, `F: ruin/encampment sites regenerated`);
  result(mobs2.length > 0 && mobs2.every((id) => !mobs1.has(id)), `F: guardians regenerated (${mobs2.length} new, 0 carried over)`);
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
