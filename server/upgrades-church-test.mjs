// Scripted test: lumberjack/farm rebalance, generic 3-tier building upgrades (lumberjack, iron mine,
// archer), Church + Bishop healer, and Church population gating.
// Needs a FRESH server (starting stock wood 80 / iron 60 / rock 60 / grain 60, no structures built yet) with no
// other players connected; run it with COLONY_WORLD_SIZE=80.
// Church gating first: the Town Center alone gives a population cap of 10, so the cap is filled with free
// Lumberjack Posts at a separate site, the Church is refused, then the fillers are broken again.
// Saint Wren's Abbey clergy (world-gen bishops posted at the AbbeyHall) are not the colony's: they are
// filtered out of every snapshot's `colonists` (kept in `clergy`), exactly as the server's population does.
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
  Empty: 0, Wall: 1, Tree: 2, Lumberjack: 3, FarmPlot: 4, KnightPost: 5, ArcherPost: 6, IronOre: 7, Rock: 8,
  IronMine: 9, RockMine: 10, StoneWall: 11, TownCenter: 12, House: 13, BigHouse: 14, HouseLevel2: 15,
  Barn: 16, Castle2: 17, Castle3: 18, ArcherTower: 19, Church: 20,
};
const ABBEY_HALL = 46;
// Every tile type the server treats as solid (protocol.ts isSolidTile): 1..49 except FarmPlot (4),
// which includes world-gen water, ruins, encampment props, the Abbey and Ward Stones.
// + 50/51 (Hunter's/Forager's Hut) and 54/55 (fruit tree, ripe/picked); berry bushes and mushrooms are walkable.
const SOLID = new Set([...Array.from({ length: 49 }, (_, i) => i + 1).filter((t) => t !== 4), 50, 51, 54, 55]);
const TILE = 32;
const REACH = TILE * 2.5;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, firstSnap: null, tiles: [], tileUpdates: [], snaps: [], hooks: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const isClergy = (k) => c.tiles[k.postY * c.welcome.worldTilesX + k.postX] === ABBEY_HALL;
      m.clergy = m.colonists.filter(isClergy);
      m.colonists = m.colonists.filter((k) => !isClergy(k));
      if (!c.firstSnap) c.firstSnap = m;
      m.at = Date.now();
      const prevMe = c.snap?.players.find((p) => p.id === c.welcome?.id);
      const nowMe = m.players.find((p) => p.id === c.welcome?.id);
      if (prevMe && nowMe && nowMe.hp > prevMe.hp && Math.hypot(nowMe.x - prevMe.x, nowMe.y - prevMe.y) > 40) {
        c.deaths = (c.deaths ?? 0) + 1;
        console.log(`info [${el()}] PLAYER DIED (hp ${prevMe.hp} -> respawned at ${Math.floor(nowMe.x / 32)},${Math.floor(nowMe.y / 32)}); mobs=${m.mobs.length} night=${m.isNight}`);
      }
      if (c.snap && c.snap.isNight && !m.isNight) c.lastDawn = Date.now();
      c.snap = m;
      if (c.recordSnaps) c.snaps.push(m);
    } else if (m.type === "testHookResult") {
      c.hooks.push(m);
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, prev: c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX], at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
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
  c.setPaused = async (paused) => {
    if (c.snap.isPaused !== paused) c.send({ type: "pause" });
    while (c.snap.isPaused !== paused) await sleep(10);
  };
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => c.inBounds(x, y) && !SOLID.has(c.tileAt(x, y));
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = c.meTile();
    const me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) return false;
    await walkPath(c, path.length ? path : [s]);
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const tileOf = (k) => ({ x: Math.floor(k.x / TILE), y: Math.floor(k.y / TILE) });
const colonistOnTile = (c, x, y) => c.snap.colonists.some((k) => { const t = tileOf(k); return t.x === x && t.y === y; });
const kinds = (c, kind) => c.snap.colonists.filter((k) => k.kind === kind);
const byId = (c, id) => c.snap.colonists.find((k) => k.id === id);

async function act(c, x, y, tile, waitMs = 500) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.at >= since);
}

async function placeExpectAt(c, x, y, tile, expectX, expectY, tries = 6) {
  for (let i = 0; i < tries; i++) {
    while (colonistOnTile(c, x, y)) await sleep(100);
    const ups = await act(c, x, y, tile);
    const hit = ups.filter((u) => u.tileX === expectX && u.tileY === expectY);
    if (hit.length) return { ups, hit };
    await sleep(300);
  }
  return { ups: [], hit: [] };
}

// Upgrade placements produce no tileUpdate; success is detected by the resource being spent.
async function placeExpectSpend(c, x, y, tile, spentFn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    while (colonistOnTile(c, x, y)) await sleep(100);
    const before = { ...c.snap };
    const ups = await act(c, x, y, tile);
    if (spentFn(before, c.snap)) return { ok: true, ups };
    await sleep(300);
  }
  return { ok: false, ups: [] };
}

function findSite(c, avoid, minDist = 7) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    if (avoid.some((a) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) < minDist)) continue;
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++)
      for (let dy = -2; dy <= 2 && ok; dy++) {
        const tx = x + dx, ty = y + dy;
        if (!c.inBounds(tx, ty) || c.tileAt(tx, ty) !== T.Empty) ok = false;
        else if ((dx || dy) && colonistOnTile(c, tx, ty)) ok = false;
      }
    if (ok && (!best || d < best.d)) best = { x, y, d };
  }
  return best;
}

const usedSites = [];
async function gotoNewSite(c, label) {
  const s = findSite(c, usedSites);
  if (!s) {
    result(false, `${label} no 5x5 empty site reachable`);
    return null;
  }
  usedSites.push(s);
  const ok = await ensureAt(c, s);
  result(ok, `${label} walked to site (${s.x},${s.y}) [${s.d} tiles away]`);
  return ok ? s : null;
}

// ---- server formulas replicated client-side (server/src/index.ts) ----
const INDUSTRIAL = new Set([T.Lumberjack, T.Barn, T.IronMine, T.RockMine, 21, 22, 23, 24, 25, 26, 27, 30]);
// industrialSynergyMultiplier: +5% per other industrial building within 5 tiles (Chebyshev).
function industrialSynergy(c, x, y) {
  let n = 0;
  for (let ty = y - 5; ty <= y + 5; ty++)
    for (let tx = x - 5; tx <= x + 5; tx++)
      if ((tx !== x || ty !== y) && c.inBounds(tx, ty) && INDUSTRIAL.has(c.tileAt(tx, ty))) n++;
  return 1 + n * 0.05;
}
// effectiveChopTicks: CHOP_TICKS (2s) x level bonus x biome / (happiness speed x industrial synergy).
function expectedChopTicks(level, happiness, synergy, biomeFactor = 1) {
  const happyMult = 0.5 + (1 - 0.5) * (happiness / 100);
  const lb = (Math.min(Math.max(level, 1), 3) - 1) * 0.05;
  return Math.max(1, Math.round((40 * (1 - lb) * biomeFactor) / (happyMult * synergy)));
}
const biomeAt = (c, x, y) => c.welcome.biomes[y * c.W() + x]; // 0 Plains, 1 Hills, 2 Swamp

// ---- population filler ----
// The Town Center alone gives a population cap of 10, so a "cap reached" check needs real civilians.
// Walks to fresh 5x5 sites well away (>= minDist, Chebyshev) from `avoid` and places free Lumberjack Posts in
// reach until population == cap, never sealing the player in and never waiting on a blocked tile.
const RING = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && Math.hypot(dx, dy) <= 2.5) RING.push([dx, dy]);
function reachableCount(c, from, blockedKey, limit) {
  const key = (x, y) => y * c.W() + x;
  const seen = new Set([key(from.x, from.y)]);
  const q = [from];
  while (q.length && seen.size < limit) {
    const cur = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      const k = key(n.x, n.y);
      if (seen.has(k) || k === blockedKey || !c.walkable(n.x, n.y)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen.size;
}
async function fillPopulationToCap(c, label, avoid, minDist = 10) {
  const posts = [];
  for (let round = 0; round < 3 && c.snap.population < c.snap.populationCap; round++) {
    const s = findSite(c, [...avoid, ...posts.map((p) => p.site)], minDist);
    if (!s || !(await ensureAt(c, s))) break;
    for (let pass = 0; pass < 2; pass++)
      for (const [dx, dy] of RING) {
        if (c.snap.population >= c.snap.populationCap) break;
        const p = { x: s.x + dx, y: s.y + dy, site: s };
        if (c.tileAt(p.x, p.y) !== T.Empty || colonistOnTile(c, p.x, p.y)) continue;
        if (reachableCount(c, s, p.y * c.W() + p.x, 80) < 80) continue;
        await act(c, p.x, p.y, T.Lumberjack, 250);
        if (c.tileAt(p.x, p.y) === T.Lumberjack) posts.push(p);
      }
  }
  info(`${label} filled population with ${posts.length} filler Lumberjack Posts: pop=${c.snap.population}/${c.snap.populationCap}`);
  return posts;
}
// Breaks the filler posts, walking to a reachable standing tile within reach of each one when needed.
async function clearFillers(c, posts) {
  for (const p of posts) {
    for (let attempt = 0; attempt < 3 && c.tileAt(p.x, p.y) === T.Lumberjack; attempt++) {
      const me = c.me();
      if (Math.hypot(me.x - (p.x * TILE + 16), me.y - (p.y * TILE + 16)) > TILE * 2.25) {
        const { dist, key } = bfs(c);
        let best = null;
        for (let sy = p.y - 2; sy <= p.y + 2; sy++)
          for (let sx = p.x - 2; sx <= p.x + 2; sx++) {
            const d = dist.get(key(sx, sy));
            if (d !== undefined && Math.hypot(sx - p.x, sy - p.y) <= 2.25 && (!best || d < best.d)) best = { x: sx, y: sy, d };
          }
        if (!best || !(await ensureAt(c, best))) break;
      }
      await act(c, p.x, p.y, T.Empty, 200);
    }
  }
  await sleep(200);
  const left = posts.filter((p) => c.tileAt(p.x, p.y) === T.Lumberjack).length;
  if (left) info(`clearFillers: ${left} filler post(s) could not be reached and remain`);
}

async function waitForDay(c, label) {
  if (!c.snap.isNight) return;
  info(`${label} night — waiting for dawn`);
  while (c.snap.isNight) await sleep(250);
}

// Ensure at least needMs of daylight remain, waiting for the next dawn if necessary. Day = 60s, night = 40s
// (DAY_TICKS / NIGHT_TICKS); cycleProgress/dayFraction from the snapshot give the remaining day directly.
async function waitForFreshDay(c, needMs, label) {
  const dayLeft = () => (c.snap.isNight ? 0 : (c.snap.dayFraction - c.snap.cycleProgress) * 100000);
  if (dayLeft() >= needMs) return;
  info(`${label} waiting for a fresh day (need ${needMs / 1000}s of daylight)`);
  while (!c.snap.isNight) await sleep(250);
  while (c.snap.isNight) await sleep(250);
}

async function waitForWood(c, need, label) {
  info(`${label} waiting for wood >= ${need} (wood=${c.snap.wood})`);
  const since = Date.now();
  while (c.snap.wood < need && Date.now() - since < 300000) await sleep(500);
  info(`${label} wood=${c.snap.wood} after ${((Date.now() - since) / 1000).toFixed(0)}s`);
  return c.snap.wood >= need;
}

// Lengths of complete consecutive "gathering" runs for one colonist across recorded snapshots
// (runs touching the recording edges or overlapping night are discarded). Each run carries the colony
// happiness of its first snapshot: the server sets the chop timer from that tick's happiness.
function gatheringRuns(snaps, id) {
  const runs = [];
  let len = 0, start = -1, sawNight = false;
  for (let i = 0; i < snaps.length; i++) {
    const k = snaps[i].colonists.find((q) => q.id === id);
    const g = k && k.state === "gathering";
    if (g) {
      if (len === 0) { start = i; sawNight = false; }
      len++;
      if (snaps[i].isNight) sawNight = true;
    } else if (len > 0) {
      // Also discard a run cut short by nightfall (shelter flips the state to idle on the first night tick).
      if (start > 0 && !sawNight && !snaps[i].isNight) runs.push({ len, h: snaps[start].happiness });
      len = 0;
    }
  }
  return runs;
}

const a = connect();
await a.ready();
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };
info(`connected; players=${a.snap.players.length}; stock wood=${a.firstSnap.wood} grain=${a.firstSnap.grain} iron=${a.firstSnap.iron} rock=${a.firstSnap.rock} pop=${a.firstSnap.population}/${a.firstSnap.populationCap} night=${a.firstSnap.isNight}`);
// A fresh colony: TOWN_CENTER_BASE_POPULATION 12 and the starting builder.
if (a.snap.players.length !== 1 || a.firstSnap.populationCap > 12 || a.firstSnap.population > 1) {
  console.log("Server is not fresh (other players or structures present) — restart it first.");
  process.exit(2);
}

// ---------------- (f) church population gating at a full cap ----------------
{
  const s = await gotoNewSite(a, "(f)");
  if (s) {
    const C = { x: s.x, y: s.y - 2 };
    // The Town Center's base cap is 10: fill it with filler Lumberjack Posts at a separate site first.
    const fillers = await fillPopulationToCap(a, "(f)", usedSites);
    for (const site of new Set(fillers.map((p) => p.site))) usedSites.push(site);
    const full = a.snap.population === a.snap.populationCap && a.snap.population > 0;
    await ensureAt(a, s);
    const w0 = a.snap.wood;
    const r = await act(a, C.x, C.y, T.Church, 700);
    // A filler's +3 wood deposit may land in the window, so "unchanged" means no -15 Church charge.
    const dw = a.snap.wood - w0;
    result(full && w0 >= 15 && r.filter((u) => u.tileX === C.x && u.tileY === C.y).length === 0 && kinds(a, "bishop").length === 0 && dw >= 0 && dw % 3 === 0,
      `(f) Church at full pop ${a.snap.population}/${a.snap.populationCap} with wood=${w0} (affordable) is rejected: no tileUpdate, no bishop, no Church charge (wood ${w0}->${a.snap.wood})`);
    await clearFillers(a, fillers);
    // Only the starting builder is left.
    result(a.snap.population === 1 && kinds(a, "lumberjack").length === 0,
      `(f) breaking the ${fillers.length} filler posts frees the population again: pop=${a.snap.population}/${a.snap.populationCap} (expected 1: the starting builder)`);
  }
}

// ---------------- knight castle (draws mobs off the player; checks knight tiers unchanged) ----------------
{
  const s = await gotoNewSite(a, "(knight)");
  if (s) {
    const K = { x: s.x, y: s.y - 2 };
    await placeExpectAt(a, K.x, K.y, T.KnightPost, K.x, K.y);
    await sleep(150);
    const knight = kinds(a, "knight")[0];
    const kt = knight ? tileOf(knight) : null;
    // Upgrades happen by placing the KnightPost ON the existing post (castle 2, then castle 3).
    await placeExpectAt(a, K.x, K.y, T.KnightPost, K.x, K.y);
    await placeExpectAt(a, K.x, K.y, T.KnightPost, K.x, K.y);
    await sleep(150);
    const k3 = byId(a, knight?.id);
    // Castle tiers also garrison more knights: 1 / 3 / 5 (guardCountForLevel; no houses adjacent here).
    result(a.tileAt(K.x, K.y) === T.Castle3 && k3 && k3.maxHp === 160 && kinds(a, "knight").length === 5,
      `(knight) bespoke castle tiers unchanged: tile ${a.tileAt(K.x, K.y)} (expected 18), knight maxHp=${k3?.maxHp} (expected 160), knights=${kinds(a, "knight").length} (expected 5 at castle 3)`);
  }
}

// ---------------- houses (cap 5) ----------------
{
  const s = await gotoNewSite(a, "(houses)");
  if (s) {
    const H1 = { x: s.x, y: s.y - 2 }, H2 = { x: s.x + 1, y: s.y - 2 };
    await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y);
    const cap1 = a.snap.populationCap;
    const w1 = a.snap.wood;
    // House on House needs goods (grain/meat/fruit/clothes); a fresh server has none, so the click is rejected.
    // Only updates at H1 matter: trees grow (and get chopped) elsewhere at any time.
    const rej = (await act(a, H1.x, H1.y, T.House, 600)).filter((u) => u.tileX === H1.x && u.tileY === H1.y);
    // A House next to a House is a new standalone House (+1 cap), not an upgrade.
    const nb = await placeExpectAt(a, H2.x, H2.y, T.House, H2.x, H2.y);
    await sleep(100);
    result(rej.length === 0 && a.tileAt(H1.x, H1.y) === T.House && nb.hit.length === 1 && a.tileAt(H2.x, H2.y) === T.House &&
      a.snap.populationCap === cap1 + 2 && a.snap.wood === w1 - 20,
      `(houses) House on House w/o goods rejected (H1 stays ${a.tileAt(H1.x, H1.y)}, updates=${rej.length}); adjacent House is standalone (tile ${a.tileAt(H2.x, H2.y)}); cap ${cap1}->${a.snap.populationCap} (expected +2: house + adjacency pair), wood ${w1}->${a.snap.wood} (expected -20: a Cottage is 20 wood + 5 rock)`);
  }
}

// ---------------- (a) + (b) lumberjack rebalance and upgrade ----------------
let ljId = null;
let ljSite = null;
{
  ljSite = await gotoNewSite(a, "(a)");
  const s = ljSite;
  if (s) {
    const P = { x: s.x, y: s.y - 2 };
    const pop0 = a.snap.population;
    a.snaps = [];
    a.recordSnaps = true;
    const p = await placeExpectAt(a, P.x, P.y, T.Lumberjack, P.x, P.y);
    await sleep(150);
    const lj = kinds(a, "lumberjack")[0];
    ljId = lj?.id;
    result(p.hit.length === 1 && p.hit[0].tile === T.Lumberjack && kinds(a, "lumberjack").length === 1 && a.snap.population === pop0 + 1,
      `(a) Lumberjack Post at (${P.x},${P.y}) placed; lumberjacks=${kinds(a, "lumberjack").length}; pop ${pop0}->${a.snap.population}`);

    // Observe the level-1 lumberjack for ~3 complete gather runs and >=2 deposits.
    const since = Date.now();
    while (Date.now() - since < 90000) {
      const runs = gatheringRuns(a.snaps, ljId);
      const deposits = a.snaps.slice(1).filter((m, i) => m.wood > a.snaps[i].wood).length;
      if (runs.length >= 3 && deposits >= 2) break;
      await sleep(500);
    }
    const preSnaps = a.snaps;
    a.recordSnaps = false;
    const woodDeltas = [];
    for (let i = 1; i < preSnaps.length; i++) {
      const d = preSnaps[i].wood - preSnaps[i - 1].wood;
      if (d !== 0) woodDeltas.push(d);
    }
    const runsL1 = gatheringRuns(preSnaps, ljId);
    result(woodDeltas.length >= 2 && woodDeltas.every((d) => d === 3),
      `(a) every wood change while only the lumberjack is working is exactly +3: ${JSON.stringify(woodDeltas)}`);

    // (b) upgrade: Lumberjack Post placed ON the existing post. Re-position first (a night mob may have killed + respawned us).
    const atSite = await ensureAt(a, s);
    info(`(b) back at lumberjack site: ${atSite}; player tile ${JSON.stringify(a.meTile())}`);
    const popBefore = a.snap.population;
    const ljCount0 = kinds(a, "lumberjack").length;
    const up = await placeExpectSpend(a, P.x, P.y, T.Lumberjack, (b, n) => true, 1);
    await sleep(200);
    const upAtP = up.ups.filter((u) => u.tileX === P.x && u.tileY === P.y);
    result(upAtP.length === 0 && a.tileAt(P.x, P.y) === T.Lumberjack,
      `(b) Lumberjack placed on (${P.x},${P.y}): level-only upgrade, no tileUpdate there (${upAtP.length}), tile stays ${a.tileAt(P.x, P.y)} (expected 3)`);
    result(kinds(a, "lumberjack").length === ljCount0 && a.snap.population === popBefore,
      `(b) no extra worker: lumberjacks ${ljCount0}->${kinds(a, "lumberjack").length}, pop ${popBefore}->${a.snap.population}`);

    a.snaps = [];
    a.recordSnaps = true;
    const since2 = Date.now();
    while (Date.now() - since2 < 90000 && gatheringRuns(a.snaps, ljId).length < 3) await sleep(500);
    a.recordSnaps = false;
    const runsL2 = gatheringRuns(a.snaps, ljId);
    // Chop time is CHOP_TICKS (40) x (1 - 5% per level) scaled by happiness speed and industrial synergy, so
    // check each run against that formula at its own happiness, and that level 2 is the faster of the two.
    const syn = industrialSynergy(a, P.x, P.y);
    const exp1 = runsL1.map((r) => expectedChopTicks(1, r.h, syn));
    const exp2 = runsL2.map((r) => expectedChopTicks(2, r.h, syn));
    const sameH = runsL1.length && runsL2.length && runsL1[0].h === runsL2[0].h;
    result(runsL1.length > 0 && runsL2.length > 0 && runsL1.every((r, i) => r.len === exp1[i]) && runsL2.every((r, i) => r.len === exp2[i]) &&
      (!sameH || runsL2[0].len < runsL1[0].len),
      `(b) gather (chop) phase in snapshots: level 1 runs=${JSON.stringify(runsL1.map((r) => r.len))} (expected ${JSON.stringify(exp1)} at happiness ${JSON.stringify(runsL1.map((r) => r.h))}), level 2 runs=${JSON.stringify(runsL2.map((r) => r.len))} (expected ${JSON.stringify(exp2)}, -5% level bonus); synergy x${syn}`);
  }
}

// ---------------- (c) iron mine upgrades ----------------
{
  await waitForFreshDay(a, 25000, "(c)");
  // Find ore O, empty neighbour E (upgrade tile), empty neighbour F of E (not O) and a standing tile S
  // within reach of all three.
  const { dist, key } = bfs(a);
  let best = null;
  for (let y = 0; y < a.H(); y++)
    for (let x = 0; x < a.W(); x++) {
      if (a.tileAt(x, y) !== T.IronOre) continue;
      for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const E = { x: x + ex, y: y + ey };
        if (!a.inBounds(E.x, E.y) || a.tileAt(E.x, E.y) !== T.Empty) continue;
        for (const [fx, fy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const F = { x: E.x + fx, y: E.y + fy };
          if ((F.x === x && F.y === y) || !a.inBounds(F.x, F.y) || a.tileAt(F.x, F.y) !== T.Empty) continue;
          // F must not touch O (so the F placement can only see E as a neighbouring mine).
          if (Math.abs(F.x - x) + Math.abs(F.y - y) === 1) continue;
          for (let sx = x - 3; sx <= x + 3; sx++)
            for (let sy = y - 3; sy <= y + 3; sy++) {
              if ((sx === E.x && sy === E.y) || (sx === F.x && sy === F.y)) continue;
              const d = dist.get(key(sx, sy));
              if (d === undefined) continue;
              const r = (p) => Math.hypot((sx - p.x) * TILE, (sy - p.y) * TILE);
              if (r({ x, y }) > REACH - 4 || r(E) > REACH - 4 || r(F) > REACH - 4) continue;
              if (!best || d < best.d) best = { O: { x, y }, E, F, S: { x: sx, y: sy }, d };
            }
        }
      }
    }
  if (!best) {
    result(false, `(c) no reachable IronOre with the needed empty neighbours`);
  } else {
    const { O, E, F, S } = best;
    const walked = await ensureAt(a, S);
    result(walked, `(c) walked to (${S.x},${S.y}); ore O=(${O.x},${O.y}), upgrade tile E=(${E.x},${E.y}), F=(${F.x},${F.y})`);
    const pop0 = a.snap.population;
    const iron0 = a.snap.iron;
    const miners0 = kinds(a, "ironMiner").length;
    const p1 = await placeExpectAt(a, O.x, O.y, T.IronMine, O.x, O.y);
    await sleep(100);
    const firstMiner = kinds(a, "ironMiner")[0];
    result(p1.hit.length === 1 && p1.hit[0].tile === T.IronMine && p1.hit[0].prev === T.IronOre && kinds(a, "ironMiner").length === miners0 + 1,
      `(c) Iron Mine on ore O accepted; ironMiners=${kinds(a, "ironMiner").length}; pop ${pop0}->${a.snap.population}`);
    await sleep(600);
    const fm = byId(a, firstMiner?.id);
    info(`(c) first miner before upgrade: state=${fm?.state} tile=${JSON.stringify(fm ? tileOf(fm) : null)}`);

    // Upgrade to level 2 by placing the mine ON O (in place; E stays empty).
    a.snaps = [];
    a.recordSnaps = true;
    const idsBefore = new Set(kinds(a, "ironMiner").map((k) => k.id));
    let ups2 = [];
    for (let i = 0; i < 6 && kinds(a, "ironMiner").length === miners0 + 1; i++) {
      ups2 = await act(a, O.x, O.y, T.IronMine, 400);
    }
    const newMiner = kinds(a, "ironMiner").find((k) => !idsBefore.has(k.id));
    result(kinds(a, "ironMiner").length === miners0 + 2 && ups2.filter((u) => u.tileX === O.x && u.tileY === O.y).length === 0 && a.tileAt(O.x, O.y) === T.IronMine,
      `(c) Iron Mine placed ON O is an UPGRADE: ironMiners=${kinds(a, "ironMiner").length} (expected ${miners0 + 2}); no tileUpdate at O; O still ${a.tileAt(O.x, O.y)}`);
    // New rule: a mine on an EMPTY tile next to a mine is rejected.
    const adjRej = await act(a, E.x, E.y, T.IronMine, 700);
    result(adjRej.filter((u) => u.tileX === E.x && u.tileY === E.y).length === 0 && a.tileAt(E.x, E.y) === T.Empty && kinds(a, "ironMiner").length === miners0 + 2,
      `(c) Iron Mine on empty E adjacent to a mine is REJECTED: E stays ${a.tileAt(E.x, E.y)} (expected 0), ironMiners=${kinds(a, "ironMiner").length} (expected ${miners0 + 2})`);
    result(a.snap.population === pop0 + 2, `(c) population ${pop0}->${a.snap.population} (expected +2: initial miner + upgrade-spawned miner)`);
    if (newMiner) {
      const firstSeen = a.snaps.map((m) => m.colonists.find((k) => k.id === newMiner.id)).filter(Boolean);
      const states = [...new Set(firstSeen.map((k) => k.state))];
      const posSet = new Set(firstSeen.map((k) => `${k.x},${k.y}`));
      const oc = { x: O.x * TILE + 16, y: O.y * TILE + 16 };
      result(states.length === 1 && states[0] === "mining" && posSet.size === 1 && newMiner.x === oc.x && newMiner.y === oc.y,
        `(c) upgrade-spawned miner is stationary from its FIRST snapshot: states=${JSON.stringify(states)}, positions=${JSON.stringify([...posSet])} (post O centre ${oc.x},${oc.y})`);
    }

    // Watch both workers for 6s (daytime).
    await waitForFreshDay(a, 7000, "(c)");
    a.snaps = [];
    a.recordSnaps = true;
    const ironStart = a.snap.iron;
    await sleep(6000);
    a.recordSnaps = false;
    const miners = kinds(a, "ironMiner");
    const nightDuring = a.snaps.some((m) => m.isNight);
    const allStates = new Set();
    const moved = new Set();
    for (const m of miners) {
      const seen = a.snaps.map((s) => s.colonists.find((k) => k.id === m.id)).filter(Boolean);
      seen.forEach((k) => allStates.add(k.state));
      if (new Set(seen.map((k) => `${k.x},${k.y}`)).size > 1) moved.add(m.id);
    }
    const ironDeltas = [];
    for (let i = 1; i < a.snaps.length; i++) if (a.snaps[i].iron !== a.snaps[i - 1].iron) ironDeltas.push(a.snaps[i].iron - a.snaps[i - 1].iron);
    // Each miner yields 1 iron per effectiveChopTicks (level 2, Hills -20%, happiness, synergy), so over N
    // recorded ticks two miners yield at least 2 x floor(N / period).
    const period = expectedChopTicks(2, a.snaps[0]?.happiness ?? a.snap.happiness, industrialSynergy(a, O.x, O.y), biomeAt(a, O.x, O.y) === 1 ? 0.8 : 1);
    const minIron = 2 * Math.floor((a.snaps.length - 1) / period);
    result(!nightDuring && miners.length === 2 && [...allStates].every((s) => s === "mining") && moved.size === 0 && minIron >= 2 && a.snap.iron - ironStart >= minIron,
      `(c) both level-2 on-ore miners stationary producers over 6s: states=${JSON.stringify([...allStates])}, movers=${moved.size}, iron +${a.snap.iron - ironStart} (deltas ${JSON.stringify(ironDeltas)}; expected >= ${minIron}: 2 workers x ${a.snaps.length - 1} ticks / ${period}-tick cycle)`);
    const fm2 = byId(a, firstMiner?.id);
    info(`(c) ORIGINAL miner after upgrade: state=${fm2?.state} at tile ${JSON.stringify(fm2 ? tileOf(fm2) : null)} (post O=(${O.x},${O.y})) — it becomes stationary wherever it was standing`);

    // Level 3 by placing ON O again, then the cap: a 4th click on the level-3 mine is rejected.
    await ensureAt(a, S);
    const c3 = kinds(a, "ironMiner").length;
    for (let i = 0; i < 6 && kinds(a, "ironMiner").length === c3; i++) {
      await act(a, O.x, O.y, T.IronMine, 400);
    }
    result(kinds(a, "ironMiner").length === 3 && a.tileAt(O.x, O.y) === T.IronMine,
      `(c) 3rd placement on O -> level 3: ironMiners=${kinds(a, "ironMiner").length} (expected 3); pop=${a.snap.population}/${a.snap.populationCap}`);
    const p4 = await act(a, O.x, O.y, T.IronMine, 700);
    result(p4.filter((u) => u.tileX === O.x && u.tileY === O.y).length === 0 && kinds(a, "ironMiner").length === 3 && a.tileAt(O.x, O.y) === T.IronMine,
      `(c) 4th placement on the level-3 mine is rejected: ironMiners=${kinds(a, "ironMiner").length} (expected 3)`);

    // Free population: break O (3 miners) -> reverts to ore.
    await ensureAt(a, S);
    const bo = await act(a, O.x, O.y, T.Empty);
    await sleep(150);
    result(bo.some((u) => u.tileX === O.x && u.tileY === O.y && u.tile === T.IronOre) && kinds(a, "ironMiner").length === miners0,
      `(c) breaking the level-3 on-ore mine reverts to IronOre and removes its 3 miners (ironMiners=${kinds(a, "ironMiner").length}, expected ${miners0}); pop=${a.snap.population}`);
    // Non-ore mines can no longer exist (a mine only goes on ore), so the old "upgrade the non-ore mine" check is gone.
    info(`(c) cleanup done; ironMiners=${kinds(a, "ironMiner").length}; pop=${a.snap.population}/${a.snap.populationCap}; iron ${iron0}->${a.snap.iron}`);
  }
}

// ---------------- (e) church + bishop ----------------
let churchSite = null;
let b = null;
{
  await waitForWood(a, 15, "(e)");
  churchSite = await gotoNewSite(a, "(e)");
  const s = churchSite;
  if (s) {
    const C = { x: s.x, y: s.y - 2 };
    const pop0 = a.snap.population;
    const w0 = a.snap.wood;
    const p = await placeExpectAt(a, C.x, C.y, T.Church, C.x, C.y);
    await sleep(150);
    const bishop = kinds(a, "bishop")[0];
    result(p.hit.length === 1 && p.hit[0].tile === T.Church && kinds(a, "bishop").length === 1 && bishop.maxHp === 25 && bishop.hp === 25,
      `(e) Church at (${C.x},${C.y}) -> tile ${a.tileAt(C.x, C.y)}; bishops=${kinds(a, "bishop").length}, hp/maxHp=${bishop?.hp}/${bishop?.maxHp} (expected 25/25)`);
    // A +3 lumberjack deposit can land inside the placement window, so allow w0 - 15 + 3k.
    const spent = w0 - a.snap.wood;
    result(a.snap.population === pop0 + 1 && spent <= 15 && (15 - spent) % 3 === 0 && spent > 0,
      `(e) Church cost 15 wood (${w0}->${a.snap.wood}) and bishop uses population (${pop0}->${a.snap.population})`);
    await sleep(1000);
    info(`(e) bishop with nobody injured: state=${byId(a, bishop.id)?.state}`);

    // Second player: walk next to A at a spot ~4 tiles from the church (inside 7-tile alert range, outside 2-tile heal range).
    b = connect();
    await b.ready();
    const spot = { x: s.x, y: s.y + 2 };
    const spotB = { x: s.x + 1, y: s.y + 2 };
    await ensureAt(a, spot);
    // Let the bishop top A up to full first (A may already be hurt by mobs), then wait for it to settle.
    const settle = Date.now();
    const mobNear = () => a.snap.mobs.some((m) => Math.hypot(m.x - a.me().x, m.y - a.me().y) < TILE * 8);
    while (Date.now() - settle < 30000) {
      const bs = byId(a, bishop.id)?.state;
      if (a.me().hp === 100 && bs === "idle" && !mobNear()) break;
      if (a.me().hp < 100 && bs === "idle") await ensureAt(a, { x: s.x, y: s.y - 1 }); // walk into heal range
      await sleep(200);
    }
    await ensureAt(a, spot);
    info(`(e) settled: A hp=${a.me().hp}, bishop state=${byId(a, bishop.id)?.state}, mobs within 8 tiles: ${mobNear()}`);
    // B walks over; its tiles view is fresh from welcome + updates.
    const okB = await ensureAt(b, spotB);
    info(`(e) B at ${JSON.stringify(b.meTile())} (ok=${okB}), A at ${JSON.stringify(a.meTile())}; A hp=${a.me().hp}`);
    a.snaps = [];
    a.recordSnaps = true;
    const hpBefore = a.me().hp;
    b.send({ type: "attack" });
    await sleep(300);
    const hpHit = a.me().hp;
    result(hpHit === hpBefore - 15, `(e) B's melee hit A (friendly fire): A hp ${hpBefore}->${hpHit}; mobs within 8 tiles: ${mobNear()}`);
    const since = Date.now();
    while (Date.now() - since < 15000 && a.me().hp < 100) await sleep(100);
    await sleep(1500);
    a.recordSnaps = false;
    const bStates = [];
    const aHps = [];
    for (const m of a.snaps) {
      const k = m.colonists.find((q) => q.id === bishop.id);
      if (k && bStates[bStates.length - 1] !== k.state) bStates.push(k.state);
      const me = m.players.find((pp) => pp.id === a.welcome.id);
      if (me && aHps[aHps.length - 1] !== me.hp) aHps.push(me.hp);
    }
    result(bStates.includes("approaching") && bStates.includes("healing"),
      `(e) bishop state sequence while A was injured: ${JSON.stringify(bStates)} (expected approaching -> healing)`);
    result(aHps.length >= 3 && aHps[aHps.length - 1] === 100 && aHps.slice(1).every((h, i) => h > aHps[i] || i === 0),
      `(e) A's hp over time: ${JSON.stringify(aHps)} (expected 85 -> 95 -> 100, base heal 10, capped at max)`);
    info(`(e) bishop final state=${byId(a, bishop.id)?.state}, at tile ${JSON.stringify(tileOf(byId(a, bishop.id)))} (church ${C.x},${C.y})`);
    b.ws.close();
    await sleep(300);
  }
}

// ---------------- (g) farm yield ----------------
{
  await waitForWood(a, 15, "(g)");
  const s = await gotoNewSite(a, "(g)");
  if (s) {
    const B = { x: s.x, y: s.y - 1 };
    const Fp = { x: s.x + 1, y: s.y - 1 };
    const pb = await placeExpectAt(a, B.x, B.y, T.Barn, B.x, B.y);
    await sleep(150);
    result(pb.hit.length === 1 && kinds(a, "farmer").length === 1, `(g) Barn placed; farmers=${kinds(a, "farmer").length}; pop=${a.snap.population}/${a.snap.populationCap}`);
    // Slow farming: paused before planting and moved on with testHook fastForward (raids off while days
    // are skipped). A harvest yields FARM_YIELD_PER_HARVEST grain at once; the first grow phase is the flat
    // FARM_GROW_TICKS (3 days), every later grow + harvest phase is scaled by the plot's biome (Plains
    // -20%), happiness speed and the Barn's industrial synergy.
    await a.setPaused(true);
    await a.hook("setRaids", { enabled: false });
    // Skipped days still eat at every dawn: a deep grain store keeps the colony from starving meanwhile,
    // and the real stock is put back afterwards.
    const keepGrain = (await a.hook("setStock", { stock: {} })).stock.grain;
    await a.hook("setStock", { stock: { grain: 5000 } });
    const pf = await placeExpectAt(a, Fp.x, Fp.y, T.FarmPlot, Fp.x, Fp.y);
    result(pf.hit.length === 1, `(g) Farm Plot placed next to the Barn`);
    const plotKey = `${Fp.x},${Fp.y}`;
    const plotNow = async () => {
      const st = await a.hook("farmState");
      return { st, p: st.plots.find((q) => q.key === plotKey) };
    };
    const grain = async () => (await a.hook("setStock", { stock: {} })).stock.grain;
    const bf = biomeAt(a, Fp.x, Fp.y) === 0 ? 0.8 : 1;
    const syn = industrialSynergy(a, B.x, B.y);
    const scaled = (base, h) => Math.max(1, Math.round((base * bf) / ((0.5 + 0.5 * (h / 100)) * syn)));
    let { st, p } = await plotNow();
    const K = st.constants;
    result(p.growTicksTotal === K.FARM_GROW_TICKS, `(g) first grow is the flat ${K.FARM_GROW_TICKS}t (got ${p.growTicksTotal})`);
    const harvests = [];
    for (let n = 0; n < 2; n++) {
      await a.hook("fastForward", { ticks: p.growTicksRemaining });
      ({ st, p } = await plotNow());
      const eH = scaled(K.FARM_HARVEST_TICKS, st.happiness);
      await a.hook("fastForward", { ticks: p.harvestTicksRemaining - 1 });
      const g0 = await grain();
      await a.hook("fastForward", { ticks: 1 });
      const g1 = await grain();
      const harvestT = p.harvestTicksRemaining;
      ({ st, p } = await plotNow());
      harvests.push({ d: g1 - g0, harvestT, eH, grow: p.growTicksTotal, eG: scaled(K.FARM_GROW_TICKS, st.happiness), h: st.happiness });
    }
    info(`(g) harvests: ${JSON.stringify(harvests)}`);
    result(harvests.every((x) => x.d === K.FARM_YIELD_PER_HARVEST && x.harvestT === x.eH && x.grow === x.eG),
      `(g) two harvests of +${K.FARM_YIELD_PER_HARVEST} grain each, with scaled harvest and re-sow times (biome x${bf}, synergy x${syn})`);
    await a.hook("setStock", { stock: { grain: keepGrain } });
    await a.hook("setRaids", { enabled: true });
    await a.setPaused(false);

    // Population report only (the full-cap Church gate is checked in (f) at the start).
    info(`(f) pop now ${a.snap.population}/${a.snap.populationCap}, wood=${a.snap.wood}`);
  }
}

// ---------------- (d) archer upgrade ----------------
{
  await waitForWood(a, 20, "(d)");
  // Upgrades refill hp; daylight keeps night mobs from chipping the archer before its hp is read. Raids now
  // spawn by day and hold near the colony until nightfall (ROADMAP "Raid arrival timing"), so raids are off here.
  await a.hook("setRaids", { enabled: false });
  await waitForFreshDay(a, 20000, "(d)");
  const s = await gotoNewSite(a, "(d)");
  if (s) {
    const A = { x: s.x, y: s.y - 2 };
    const archers0 = new Set(kinds(a, "archer").map((k) => k.id));
    const w0 = a.snap.wood;
    const p1 = await placeExpectAt(a, A.x, A.y, T.ArcherPost, A.x, A.y);
    await sleep(150);
    const archer = kinds(a, "archer").find((k) => !archers0.has(k.id));
    result(p1.hit.length === 1 && archer && archer.maxHp === 35 && archer.hp === 35,
      `(d) Archer Post placed; archer hp/maxHp=${archer?.hp}/${archer?.maxHp} (expected 35/35); wood ${w0}->${a.snap.wood}`);
    const at = archer ? tileOf(archer) : null;
    const w1 = a.snap.wood;
    const up = await placeExpectSpend(a, A.x, A.y, T.ArcherPost, () => (byId(a, archer?.id)?.maxHp ?? 0) > 35);
    await sleep(150);
    const a2 = byId(a, archer?.id);
    result(up.ok && up.ups.filter((u) => u.tileX === A.x && u.tileY === A.y).length === 0 && a.tileAt(A.x, A.y) === T.ArcherPost,
      `(d) Archer Post placed ON the post (${A.x},${A.y}) is an upgrade: no tileUpdate there, tile stays ${a.tileAt(A.x, A.y)}; wood ${w1}->${a.snap.wood} (same 10-wood cost)`);
    // A level-2 archer post garrisons 3 archers (guardCountForLevel); no houses are adjacent here.
    const lvl2 = kinds(a, "archer").filter((k) => !archers0.has(k.id));
    result(a2 && a2.maxHp === 37 && a2.hp === 37 && lvl2.length === 3 && lvl2.every((k) => k.maxHp === 37),
      `(d) original archer upgraded in place: hp/maxHp=${a2?.hp}/${a2?.maxHp} (expected 37/37 = round(35*1.05)); post archers=${lvl2.length} (expected 3 at level 2, all ${JSON.stringify(lvl2.map((k) => k.maxHp))} maxHp 37)`);
    if (a.snap.wood >= 10) {
      const up3 = await placeExpectSpend(a, A.x, A.y, T.ArcherPost, () => (byId(a, archer?.id)?.maxHp ?? 0) > 37);
      await sleep(150);
      const a3 = byId(a, archer?.id);
      result(up3.ok && a3 && a3.maxHp === 39 && a3.hp === 39,
        `(d) 3rd placement -> level 3: hp/maxHp=${a3?.hp}/${a3?.maxHp} (expected 39/39 = round(35*1.10))`);
    } else info(`(d) level-3 archer skipped (wood=${a.snap.wood})`);
  }
  await a.hook("setRaids", { enabled: true });
}

// ---------------- (f) church gating at a non-zero cap ----------------
{
  info(`(f) end state: pop=${a.snap.population}/${a.snap.populationCap} wood=${a.snap.wood}`);
}

// ---------------- bishop / lumberjack night behaviour (observational) ----------------
{
  const bishop = kinds(a, "bishop")[0];
  if (bishop && churchSite) {
    if (!a.snap.isNight) {
      info(`waiting for night to observe the bishop (no shelter expected)...`);
      const since = Date.now();
      while (!a.snap.isNight && Date.now() - since < 60000) await sleep(250);
    }
    if (a.snap.isNight) {
      await sleep(4000);
      const k = byId(a, bishop.id);
      const kt = k ? tileOf(k) : null;
      const distTC = kt ? Math.abs(kt.x - TC.x) + Math.abs(kt.y - TC.y) : null;
      const distChurch = kt ? Math.abs(kt.x - churchSite.x) + Math.abs(kt.y - (churchSite.y - 2)) : null;
      const lj = byId(a, ljId);
      const ljt = lj ? tileOf(lj) : null;
      result(k && (distChurch <= 2 || k.state === "healing" || k.state === "approaching") && !(distTC <= 1 && k.state === "idle"),
        `(e) at night the bishop does not shelter (at church or out healing) (state=${k?.state}, tile ${JSON.stringify(kt)}, ${distChurch} from church, ${distTC} from TC); lumberjack for contrast at ${JSON.stringify(ljt)} (${ljt ? Math.abs(ljt.x - TC.x) + Math.abs(ljt.y - TC.y) : "?"} from TC)`);
      const mobTargets = a.snap.mobs.length;
      info(`(e) mobs alive at night: ${mobTargets}; bishop hp=${k?.hp}/${k?.maxHp}`);
    }
  }
}

info(`player deaths during run: ${a.deaths ?? 0}`);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
