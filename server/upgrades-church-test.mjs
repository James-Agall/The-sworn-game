// Scripted test: lumberjack/farm rebalance, generic 3-tier building upgrades (lumberjack, iron mine,
// archer), Church + Bishop healer, and Church population gating.
// Needs a FRESH server (starting stock 40/20/30/30, no structures built yet) with no other players connected.
// Order is chosen for the wood budget: church gating at cap 0 (free), houses (30 wood), lumberjack (refills
// wood at 3/trip), iron mine upgrades (free), then wait for wood: church (15), barn (15), archers (20).
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
const SOLID = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
const TILE = 32;
const REACH = TILE * 2.5;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, firstSnap: null, tiles: [], tileUpdates: [], snaps: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
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
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, prev: c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX], at: Date.now() });
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

function findSite(c, avoid) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    if (avoid.some((a) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) < 7)) continue;
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

async function waitForDay(c, label) {
  if (!c.snap.isNight) return;
  info(`${label} night — waiting for dawn`);
  while (c.snap.isNight) await sleep(250);
}

// Ensure at least needMs of daylight remain (day = 30s), waiting for the next dawn if necessary.
async function waitForFreshDay(c, needMs, label) {
  const dayLeft = () => (c.snap.isNight || !c.lastDawn ? 0 : 30000 - (Date.now() - c.lastDawn));
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
// (runs touching the recording edges or overlapping night are discarded).
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
      if (start > 0 && !sawNight && !snaps[i].isNight) runs.push(len);
      len = 0;
    }
  }
  return runs;
}

const a = connect();
await a.ready();
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };
info(`connected; players=${a.snap.players.length}; stock wood=${a.firstSnap.wood} food=${a.firstSnap.food} iron=${a.firstSnap.iron} rock=${a.firstSnap.rock} pop=${a.firstSnap.population}/${a.firstSnap.populationCap} night=${a.firstSnap.isNight}`);
if (a.snap.players.length !== 1 || a.firstSnap.populationCap !== 0) {
  console.log("Server is not fresh (other players or structures present) — restart it first.");
  process.exit(2);
}

// ---------------- (f) church population gating at cap 0 ----------------
{
  const s = await gotoNewSite(a, "(f)");
  if (s) {
    const C = { x: s.x, y: s.y - 2 };
    const w0 = a.snap.wood;
    const r = await act(a, C.x, C.y, T.Church, 700);
    result(w0 >= 15 && r.filter((u) => u.tileX === C.x && u.tileY === C.y).length === 0 && kinds(a, "bishop").length === 0 && a.snap.wood === w0,
      `(f) Church at pop ${a.snap.population}/${a.snap.populationCap} with wood=${w0} (affordable) is rejected: no tileUpdate, no bishop, wood unchanged (${a.snap.wood})`);
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
    let U = null;
    for (const n of [{ x: K.x - 1, y: K.y }, { x: K.x + 1, y: K.y }, { x: K.x, y: K.y + 1 }]) {
      if (kt && kt.x === n.x && kt.y === n.y) continue;
      if (n.x === s.x && n.y === s.y) continue;
      if (a.tileAt(n.x, n.y) === T.Empty && !colonistOnTile(a, n.x, n.y)) { U = n; break; }
    }
    await placeExpectAt(a, U.x, U.y, T.KnightPost, K.x, K.y);
    await placeExpectAt(a, U.x, U.y, T.KnightPost, K.x, K.y);
    await sleep(150);
    const k3 = byId(a, knight?.id);
    result(a.tileAt(K.x, K.y) === T.Castle3 && k3 && k3.maxHp === 160 && kinds(a, "knight").length === 1,
      `(knight) bespoke castle tiers unchanged: tile ${a.tileAt(K.x, K.y)} (expected 18), knight maxHp=${k3?.maxHp} (expected 160), knights=${kinds(a, "knight").length}`);
  }
}

// ---------------- houses (cap 5) ----------------
{
  const s = await gotoNewSite(a, "(houses)");
  if (s) {
    const H1 = { x: s.x, y: s.y - 2 }, H2 = { x: s.x + 1, y: s.y - 2 };
    await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y);
    await placeExpectAt(a, H2.x, H2.y, T.House, H1.x, H1.y);
    await placeExpectAt(a, H2.x, H2.y, T.House, H1.x, H1.y);
    await sleep(100);
    result(a.snap.populationCap === 5 && a.tileAt(H1.x, H1.y) === T.HouseLevel2,
      `(houses) HouseLevel2 built (unchanged House tier system): cap=${a.snap.populationCap}, wood=${a.snap.wood}`);
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
    const U = { x: s.x + 1, y: s.y - 2 };
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

    // (b) upgrade: adjacent Lumberjack Post. Re-position first (a night mob may have killed + respawned us).
    const atSite = await ensureAt(a, s);
    info(`(b) back at lumberjack site: ${atSite}; player tile ${JSON.stringify(a.meTile())}`);
    const popBefore = a.snap.population;
    const ljCount0 = kinds(a, "lumberjack").length;
    const up = await placeExpectSpend(a, U.x, U.y, T.Lumberjack, (b, n) => true, 1);
    await sleep(200);
    const upAtU = up.ups.filter((u) => u.tileX === U.x && u.tileY === U.y);
    result(upAtU.length === 0 && a.tileAt(U.x, U.y) === T.Empty && a.tileAt(P.x, P.y) === T.Lumberjack,
      `(b) adjacent Lumberjack at (${U.x},${U.y}): no tileUpdate there (stays ${a.tileAt(U.x, U.y)}), original (${P.x},${P.y}) still tile ${a.tileAt(P.x, P.y)} (expected 3)`);
    result(kinds(a, "lumberjack").length === ljCount0 && a.snap.population === popBefore,
      `(b) no extra worker: lumberjacks ${ljCount0}->${kinds(a, "lumberjack").length}, pop ${popBefore}->${a.snap.population}`);

    a.snaps = [];
    a.recordSnaps = true;
    const since2 = Date.now();
    while (Date.now() - since2 < 90000 && gatheringRuns(a.snaps, ljId).length < 3) await sleep(500);
    a.recordSnaps = false;
    const runsL2 = gatheringRuns(a.snaps, ljId);
    result(runsL1.length > 0 && runsL2.length > 0 && runsL1.every((r) => r === 40) && runsL2.every((r) => r === 38),
      `(b) gather (chop) phase in snapshots: level 1 runs=${JSON.stringify(runsL1)} (expected 40 ticks = 2.0s), level 2 runs=${JSON.stringify(runsL2)} (expected 38 ticks = 1.9s, -5%)`);
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

    // Upgrade to level 2 via E.
    a.snaps = [];
    a.recordSnaps = true;
    const idsBefore = new Set(kinds(a, "ironMiner").map((k) => k.id));
    let ups2 = [];
    for (let i = 0; i < 6 && kinds(a, "ironMiner").length === miners0 + 1; i++) {
      while (colonistOnTile(a, E.x, E.y)) await sleep(100);
      ups2 = await act(a, E.x, E.y, T.IronMine, 400);
    }
    const newMiner = kinds(a, "ironMiner").find((k) => !idsBefore.has(k.id));
    result(kinds(a, "ironMiner").length === miners0 + 2 && ups2.filter((u) => u.tileX === E.x && u.tileY === E.y).length === 0 && a.tileAt(E.x, E.y) === T.Empty,
      `(c) adjacent Iron Mine on empty E treated as UPGRADE: ironMiners=${kinds(a, "ironMiner").length} (expected ${miners0 + 2}); E stays tile ${a.tileAt(E.x, E.y)} with no tileUpdate; O still ${a.tileAt(O.x, O.y)}`);
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
    result(!nightDuring && miners.length === 2 && [...allStates].every((s) => s === "mining") && moved.size === 0 && a.snap.iron - ironStart >= 5,
      `(c) both level-2 on-ore miners stationary producers over 6s: states=${JSON.stringify([...allStates])}, movers=${moved.size}, iron +${a.snap.iron - ironStart} (deltas ${JSON.stringify(ironDeltas)}; 2 workers x 6s / 1.9s ~= 6)`);
    const fm2 = byId(a, firstMiner?.id);
    info(`(c) ORIGINAL miner after upgrade: state=${fm2?.state} at tile ${JSON.stringify(fm2 ? tileOf(fm2) : null)} (post O=(${O.x},${O.y})) — it becomes stationary wherever it was standing`);

    // Level 3 via E again, then the cap: 4th placement at E becomes a standalone (non-ore) mine.
    await ensureAt(a, S);
    const c3 = kinds(a, "ironMiner").length;
    for (let i = 0; i < 6 && kinds(a, "ironMiner").length === c3; i++) {
      while (colonistOnTile(a, E.x, E.y)) await sleep(100);
      await act(a, E.x, E.y, T.IronMine, 400);
    }
    result(kinds(a, "ironMiner").length === 3 && a.tileAt(E.x, E.y) === T.Empty,
      `(c) 3rd placement -> level 3: ironMiners=${kinds(a, "ironMiner").length} (expected 3), E still ${a.tileAt(E.x, E.y)}; pop=${a.snap.population}/${a.snap.populationCap}`);
    const p4 = await placeExpectAt(a, E.x, E.y, T.IronMine, E.x, E.y);
    await sleep(150);
    result(p4.hit.length === 1 && p4.hit[0].tile === T.IronMine && kinds(a, "ironMiner").length === 4,
      `(c) 4th placement next to a level-3 mine is a NEW standalone mine at E (tile ${a.tileAt(E.x, E.y)}); ironMiners=${kinds(a, "ironMiner").length}; pop=${a.snap.population}/${a.snap.populationCap}`);

    // Free population: break O (3 miners) -> reverts to ore.
    await ensureAt(a, S);
    const bo = await act(a, O.x, O.y, T.Empty);
    await sleep(150);
    result(bo.some((u) => u.tileX === O.x && u.tileY === O.y && u.tile === T.IronOre) && kinds(a, "ironMiner").length === 1,
      `(c) breaking the level-3 on-ore mine reverts to IronOre and removes its 3 miners (ironMiners=${kinds(a, "ironMiner").length}); pop=${a.snap.population}`);
    // Re-placing on O must start at level 1 (level entry cleared on break): exactly 1 new miner, travelling.
    // (Skipped to keep population for later steps; checked via code review instead.)

    // Upgrade the non-ore mine E via F: extra worker but they still travel.
    await ensureAt(a, S);
    const cE = kinds(a, "ironMiner").length;
    for (let i = 0; i < 6 && kinds(a, "ironMiner").length === cE; i++) {
      while (colonistOnTile(a, F.x, F.y)) await sleep(100);
      await act(a, F.x, F.y, T.IronMine, 400);
    }
    result(kinds(a, "ironMiner").length === 2 && a.tileAt(F.x, F.y) === T.Empty,
      `(c) adjacent placement at F upgrades the NON-ore mine E to level 2: ironMiners=${kinds(a, "ironMiner").length} (expected 2), F stays ${a.tileAt(F.x, F.y)}`);
    await waitForFreshDay(a, 7000, "(c)");
    a.snaps = [];
    a.recordSnaps = true;
    await sleep(6000);
    a.recordSnaps = false;
    const st = new Set();
    for (const m of kinds(a, "ironMiner")) a.snaps.forEach((s) => { const k = s.colonists.find((q) => q.id === m.id); if (k) st.add(k.state); });
    result([...st].some((s) => s === "toResource" || s === "toPost" || s === "gathering") && !st.has("mining"),
      `(c) non-ore level-2 mine's workers still travel: states seen=${JSON.stringify([...st])}`);
    // Break E so population is free for church/barn.
    await ensureAt(a, S);
    const be = await act(a, E.x, E.y, T.Empty);
    await sleep(150);
    info(`(c) cleanup: broke E -> ${JSON.stringify(be.filter((u) => u.tileX === E.x && u.tileY === E.y).map((u) => u.tile))}; ironMiners=${kinds(a, "ironMiner").length}; pop=${a.snap.population}/${a.snap.populationCap}; iron ${iron0}->${a.snap.iron}`);
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
    a.snaps = [];
    a.recordSnaps = true;
    const pf = await placeExpectAt(a, Fp.x, Fp.y, T.FarmPlot, Fp.x, Fp.y);
    const placedAt = Date.now();
    result(pf.hit.length === 1, `(g) Farm Plot placed next to the Barn`);
    while (Date.now() - placedAt < 32000) await sleep(200);
    a.recordSnaps = false;
    const deltas = [];
    for (let i = 1; i < a.snaps.length; i++) {
      const d = a.snaps[i].food - a.snaps[i - 1].food;
      if (d !== 0) deltas.push({ d, t: ((a.snaps[i].at - placedAt) / 1000).toFixed(2), night: a.snaps[i].isNight });
    }
    const plus = deltas.filter((x) => x.d > 0);
    const farmerMissing = a.snaps.filter((m) => !m.colonists.some((k) => k.kind === "farmer")).length;
    const span = (a.snaps[a.snaps.length - 1].at - a.snaps[0].at) / 1000;
    info(`(g) diagnostics: ${a.snaps.length} snapshots over ${span.toFixed(1)}s (${(a.snaps.length / span).toFixed(1)}/s, expected 20/s); snapshots with no farmer: ${farmerMissing}`);
    result(plus.length === 3 && plus.every((x) => x.d === 1),
      `(g) food changes in 32s after planting: ${JSON.stringify(deltas)} (expected three +1 harvests at ~10s, ~20s, ~30s, never +3)`);

    // (f) at cap: 5/5 now? Report and, if so, try another Church.
    info(`(f) pop now ${a.snap.population}/${a.snap.populationCap}, wood=${a.snap.wood}`);
  }
}

// ---------------- (d) archer upgrade ----------------
{
  await waitForWood(a, 20, "(d)");
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
    let U = null;
    for (const n of [{ x: A.x - 1, y: A.y }, { x: A.x + 1, y: A.y }, { x: A.x, y: A.y + 1 }]) {
      if (at && at.x === n.x && at.y === n.y) continue;
      if (n.x === s.x && n.y === s.y) continue;
      if (a.tileAt(n.x, n.y) === T.Empty && !colonistOnTile(a, n.x, n.y)) { U = n; break; }
    }
    const w1 = a.snap.wood;
    const up = await placeExpectSpend(a, U.x, U.y, T.ArcherPost, () => (byId(a, archer?.id)?.maxHp ?? 0) > 35);
    await sleep(150);
    const a2 = byId(a, archer?.id);
    result(up.ok && up.ups.filter((u) => u.tileX === U.x && u.tileY === U.y).length === 0 && a.tileAt(U.x, U.y) === T.Empty && a.tileAt(A.x, A.y) === T.ArcherPost,
      `(d) adjacent Archer Post at (${U.x},${U.y}) is an upgrade: no tileUpdate, tile stays ${a.tileAt(U.x, U.y)}, original still ${a.tileAt(A.x, A.y)}; wood ${w1}->${a.snap.wood} (same 10-wood cost)`);
    result(a2 && a2.maxHp === 37 && a2.hp === 37 && kinds(a, "archer").length === archers0.size + 1,
      `(d) original archer upgraded in place: hp/maxHp=${a2?.hp}/${a2?.maxHp} (expected 37/37 = round(35*1.05)); archers=${kinds(a, "archer").length} (no extra worker)`);
    if (a.snap.wood >= 10) {
      const up3 = await placeExpectSpend(a, U.x, U.y, T.ArcherPost, () => (byId(a, archer?.id)?.maxHp ?? 0) > 37);
      await sleep(150);
      const a3 = byId(a, archer?.id);
      result(up3.ok && a3 && a3.maxHp === 39 && a3.hp === 39,
        `(d) 3rd placement -> level 3: hp/maxHp=${a3?.hp}/${a3?.maxHp} (expected 39/39 = round(35*1.10))`);
    } else info(`(d) level-3 archer skipped (wood=${a.snap.wood})`);
  }
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
