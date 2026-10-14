// Scripted test: industrial cluster synergy (industrialSynergyMultiplier). Every OTHER industrial building
// within Chebyshev radius 5 of a building speeds its work cycle up by +5% (stacking): cycle ticks are
// divided by (1 + 0.05 * n). Measured deterministically on a Barn's farm plot: the plot's grow and harvest
// phases are timed to the exact tick from snapshots (readyFarmPlots + cycleProgress), and each phase length
// is compared with the server formula round(base * biome / (happinessMult * synergyMult)) using the
// happiness the snapshot reports for the tick the phase started on. Phases:
//   0: Barn alone (n=0)
//   1: + Lumberjack at Chebyshev distance 6 (must NOT count, n stays 0)
//   2: + Lumberjack at Chebyshev distance 5 (counts, n=1)
//   3: + 2 Lumberjacks at distance 2 (n=3)
// Each measured length must equal the prediction for the real n and differ from the prediction for the
// wrong n (e.g. phase 1 vs n=1), so a pass is exact, not statistical.
// Needs a fresh server with no other players; run with COLONY_WORLD_SIZE=80.
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
const T = {
  Empty: 0, Lumberjack: 3, FarmPlot: 4, KnightPost: 5, BarnPost: 16,
};
// Server INDUSTRIAL_TILES: Lumberjack, Barn, IronMine, RockMine, Pasture, Orchard, WoolFarm, CottonFarm,
// TailorShop, Blacksmith, LuxuryWorkshop, Brewery.
const INDUSTRIAL = new Set([3, 16, 9, 10, 21, 22, 23, 24, 25, 26, 27, 30]);
const TILE = 32;
const PLAINS = 0;
const FARM_GROW_TICKS = 160; // TICK_RATE * 8
const FARM_HARVEST_TICKS = 40; // TICK_RATE * 2
const CYCLE_TICKS = 2000; // (DAY 60s + NIGHT 40s) * 20 ticks/s

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tiles: [], tileUpdates: [], ticks: [] };
  let wraps = 0, lastMod = -1;
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const mod = Math.round(m.cycleProgress * CYCLE_TICKS);
      if (lastMod >= 0 && mod < lastMod - CYCLE_TICKS / 2) wraps++;
      lastMod = mod;
      m.tick = wraps * CYCLE_TICKS + mod;
      c.snap = m;
      if (c.plotIdx !== undefined) c.ticks.push({ tick: m.tick, ready: m.readyFarmPlots.includes(c.plotIdx), happiness: m.happiness });
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => c.inBounds(x, y) && (c.tileAt(x, y) === T.Empty || c.tileAt(x, y) === T.FarmPlot); // conservative: everything else may be solid
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

function bfs(c) {
  const start = c.meTile();
  const key = (x, y) => y * c.W() + x;
  const dist = new Map([[key(start.x, start.y), 0]]);
  const parent = new Map();
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!c.walkable(n.x, n.y) || dist.has(key(n.x, n.y))) continue;
      dist.set(key(n.x, n.y), dist.get(key(cur.x, cur.y)) + 1);
      parent.set(key(n.x, n.y), cur);
      q.push(n);
    }
  }
  return { start, dist, parent, key };
}

function pathTo(c, goal) {
  const { start, dist, parent, key } = bfs(c);
  if (!dist.has(key(goal.x, goal.y))) return null;
  const path = [];
  let cur = goal;
  while (!(cur.x === start.x && cur.y === start.y)) {
    path.unshift(cur);
    cur = parent.get(key(cur.x, cur.y));
  }
  return path;
}

async function walkPath(c, path, timeoutMs = 30000) {
  const since = Date.now();
  for (const wp of path) {
    const cx = wp.x * TILE + TILE / 2;
    const cy = wp.y * TILE + TILE / 2;
    for (;;) {
      if (Date.now() - since > timeoutMs) {
        c.send({ type: "input", dx: 0, dy: 0 });
        return false;
      }
      const me = c.me();
      const ex = cx - me.x;
      const ey = cy - me.y;
      let dx = 0, dy = 0;
      if (Math.abs(ex) > 4) dx = Math.sign(ex);
      else if (Math.abs(ey) > 4) dy = Math.sign(ey);
      else break;
      c.send({ type: "input", dx, dy });
      await sleep(25);
    }
  }
  c.send({ type: "input", dx: 0, dy: 0 });
  await sleep(150);
  return true;
}

async function ensureAt(c, s) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const t = c.meTile();
    const me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) {
      await sleep(500);
      continue;
    }
    await walkPath(c, path.length ? path : [s]);
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const colonistOnTile = (c, x, y) =>
  c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);

async function placeExpect(c, x, y, tile, tries = 8) {
  for (let i = 0; i < tries; i++) {
    for (let w = 0; w < 50 && colonistOnTile(c, x, y); w++) await sleep(100);
    const since = Date.now();
    c.send({ type: "setTile", tileX: x, tileY: y, tile });
    await sleep(400);
    if (c.tileUpdates.some((u) => u.at >= since && u.tileX === x && u.tileY === y && u.tile === tile)) return true;
    await sleep(300);
  }
  return false;
}

// Reachable standing tile s such that the rectangle [s.x+x0 .. s.x+x1] x [s.y+y0 .. s.y+y1] is all Empty
// and colonist-free, and no industrial building is within 7 tiles of it.
function findSite(c, x0, x1, y0, y1) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    let ok = true;
    for (let dx = x0; dx <= x1 && ok; dx++)
      for (let dy = y0; dy <= y1 && ok; dy++) {
        const tx = x + dx, ty = y + dy;
        if (!c.inBounds(tx, ty) || c.tileAt(tx, ty) !== T.Empty) ok = false;
        else if ((dx || dy) && colonistOnTile(c, tx, ty)) ok = false;
      }
    for (let dx = x0 - 7; dx <= x1 + 7 && ok; dx++)
      for (let dy = y0 - 7; dy <= y1 + 7 && ok; dy++)
        if (c.inBounds(x + dx, y + dy) && INDUSTRIAL.has(c.tileAt(x + dx, y + dy))) ok = false;
    if (ok && (!best || d < best.d)) best = { x, y, d };
  }
  return best;
}

// Server-equivalent float expression, so .5 rounding matches exactly.
function expectedTicks(base, biomeFactor, happiness, others) {
  return Math.max(1, Math.round((base * (1 - 0) * biomeFactor) / ((0.5 + (1 - 0.5) * (happiness / 100)) * (1 + others * 0.05))));
}

function industrialWithin5(c, bx, by) {
  let n = 0;
  for (let y = by - 5; y <= by + 5; y++)
    for (let x = bx - 5; x <= bx + 5; x++)
      if ((x !== bx || y !== by) && c.inBounds(x, y) && INDUSTRIAL.has(c.tileAt(x, y))) n++;
  return n;
}

// Wait for the first grow phase that STARTS after `afterTick` to complete, plus the harvest phase after
// it. Returns {growStart, grow, harvest, hGrow, hHarvest} from the recorded per-tick history.
async function measureCycle(c, afterTick, timeoutMs = 90000) {
  const since = Date.now();
  while (Date.now() - since < timeoutMs) {
    const tk = c.ticks;
    // find a ready->notReady edge after afterTick
    let gs = -1;
    for (let i = 1; i < tk.length; i++) if (tk[i].tick > afterTick && tk[i - 1].ready && !tk[i].ready) { gs = i; break; }
    if (gs >= 0) {
      let ge = -1;
      for (let i = gs + 1; i < tk.length; i++) if (tk[i].ready) { ge = i; break; }
      if (ge >= 0) {
        let he = -1;
        for (let i = ge + 1; i < tk.length; i++) if (!tk[i].ready) { he = i; break; }
        if (he >= 0) {
          let gaps = 0;
          for (let i = gs; i <= he; i++) if (tk[i].tick - tk[i - 1].tick !== 1) gaps++;
          return {
            growStart: tk[gs].tick,
            grow: tk[ge].tick - tk[gs].tick,
            harvest: tk[he].tick - tk[ge].tick,
            hGrow: tk[gs].happiness,
            hHarvest: tk[ge].happiness,
            gaps,
          };
        }
      }
    }
    await sleep(200);
  }
  return null;
}

const a = connect();
await a.ready();
info(`connected; wood=${a.snap.wood} iron=${a.snap.iron} rock=${a.snap.rock} cap=${a.snap.populationCap} tick=${a.snap.tick}`);

// Layout relative to the standing tile s. Barn B, its plot P (west of B), Near1/Near2 at Chebyshev 2,
// Far5 at Chebyshev 5 and Far6 at Chebyshev 6 from B (placed from a second standing tile s2).
const s = findSite(a, -3, 6, -3, 2);
if (!s) {
  result(false, "no suitable empty site found");
  process.exit(1);
}
const B = { x: s.x - 1, y: s.y - 1 };
const P = { x: s.x - 2, y: s.y - 1 };
const near = [{ x: s.x + 1, y: s.y - 1 }, { x: s.x + 1, y: s.y + 1 }];
const far5 = { x: B.x + 5, y: B.y + 1 };
const far6 = { x: B.x + 6, y: B.y };
const s2 = { x: s.x + 4, y: s.y + 1 };
// A Knight Post off to the south-west as mob bait (mobs target guards before players); not industrial.
const K = { x: s.x - 2, y: s.y + 1 };

result(await ensureAt(a, s), `walked to site (${s.x},${s.y}) [${s.d} tiles]`);
const biomeFactor = a.welcome.biomes[P.y * a.W() + P.x] === PLAINS ? 0.8 : 1;
info(`Barn (${B.x},${B.y}), plot (${P.x},${P.y}) biome=${a.welcome.biomes[P.y * a.W() + P.x]} -> factor ${biomeFactor}`);
result(await placeExpect(a, B.x, B.y, T.BarnPost), `Barn placed at (${B.x},${B.y})`);
a.plotIdx = P.y * a.W() + P.x;
result(await placeExpect(a, P.x, P.y, T.FarmPlot), `Farm plot placed at (${P.x},${P.y})`);
result(await placeExpect(a, K.x, K.y, T.KnightPost), `Knight Post (mob bait, not industrial) placed at (${K.x},${K.y})`);
await sleep(300);
info(`farmer present: ${a.snap.colonists.some((k) => k.kind === "farmer" && k.postX === B.x && k.postY === B.y)}`);

async function phase(label, others, wrongOthers, afterTick) {
  const nActual = industrialWithin5(a, B.x, B.y);
  result(nActual === others, `${label}: industrial buildings within Chebyshev 5 of the Barn (client count) = ${nActual} (expected ${others})`);
  const m = await measureCycle(a, afterTick);
  if (!m) {
    result(false, `${label}: no complete grow+harvest cycle observed`);
    return null;
  }
  const eG = expectedTicks(FARM_GROW_TICKS, biomeFactor, m.hGrow, others);
  const eH = expectedTicks(FARM_HARVEST_TICKS, biomeFactor, m.hHarvest, others);
  const wG = expectedTicks(FARM_GROW_TICKS, biomeFactor, m.hGrow, wrongOthers);
  const wH = expectedTicks(FARM_HARVEST_TICKS, biomeFactor, m.hHarvest, wrongOthers);
  info(`${label}: grow started tick ${m.growStart}; happiness ${m.hGrow}/${m.hHarvest}; tick gaps=${m.gaps}`);
  result(m.gaps === 0, `${label}: snapshot ticks contiguous over the measured cycle (gaps=${m.gaps})`);
  result(m.grow === eG && m.harvest === eH,
    `${label}: grow ${m.grow} ticks (expected ${eG} for n=${others}, x${(1 + others * 0.05).toFixed(2)}), harvest ${m.harvest} ticks (expected ${eH})`);
  result(m.grow !== wG,
    `${label}: grow ${m.grow} differs from the n=${wrongOthers} prediction ${wG} (harvest would be ${wH}) - the measurement discriminates`);
  return m;
}

// Phase 0: Barn alone. Skip the very first grow (it starts at the unscaled FARM_GROW_TICKS).
const m0 = await phase("(0) Barn alone", 0, 1, a.snap.tick);

// Phase 1: + Lumberjack at Chebyshev distance 6 (does not count).
result(await ensureAt(a, s2), `walked to second standing tile (${s2.x},${s2.y})`);
result(await placeExpect(a, far6.x, far6.y, T.Lumberjack), `Lumberjack placed at (${far6.x},${far6.y}), Chebyshev ${Math.max(Math.abs(far6.x - B.x), Math.abs(far6.y - B.y))} from the Barn`);
const m1 = await phase("(1) + Lumberjack 6 tiles away", 0, 1, a.snap.tick);

// Phase 2: + Lumberjack at Chebyshev distance 5 (counts).
result(await placeExpect(a, far5.x, far5.y, T.Lumberjack), `Lumberjack placed at (${far5.x},${far5.y}), Chebyshev ${Math.max(Math.abs(far5.x - B.x), Math.abs(far5.y - B.y))} from the Barn`);
const m2 = await phase("(2) + Lumberjack 5 tiles away", 1, 0, a.snap.tick);

// Phase 3: + 2 Lumberjacks close by (stacking to n=3).
result(await ensureAt(a, s), `walked back to (${s.x},${s.y})`);
let placedNear = 0;
for (const p of near) if (await placeExpect(a, p.x, p.y, T.Lumberjack)) placedNear++;
result(placedNear === 2, `2 Lumberjacks placed at Chebyshev 2 (${placedNear})`);
const m3 = await phase("(3) + 2 Lumberjacks 2 tiles away", 3, 2, a.snap.tick);

// Cross-phase sanity: same happiness -> strictly shorter cycles as n grows.
if (m0 && m3 && m0.hGrow === m3.hGrow) result(m3.grow < m0.grow, `(x) same happiness ${m0.hGrow}: grow n=0 ${m0.grow} > n=3 ${m3.grow}`);
info(`summary grow ticks: n0=${m0?.grow} n0+far6=${m1?.grow} n1=${m2?.grow} n3=${m3?.grow}; happiness ${m0?.hGrow},${m1?.hGrow},${m2?.hGrow},${m3?.hGrow}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
