// Scripted test: houses/population cap, barns + farm plots, mine clustering, knight castle leveling,
// archer towers, plus a spawn-movement sanity check. Needs a FRESH server (starting stock 40/20/30/30,
// no structures built yet) with no other players connected.
// Run order is chosen for the resource budget: castle (all 30 iron) first, then houses (30 wood),
// lumberjacks to refill wood, mines, barn (15 wood), archer tower (11 wood).
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
  Barn: 16, Castle2: 17, Castle3: 18, ArcherTower: 19,
};
const SOLID = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
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
      // Track player deaths (hp resets to max + teleport to the TC) so a failed action can be explained.
      const prevMe = c.snap?.players.find((p) => p.id === c.welcome?.id);
      const nowMe = m.players.find((p) => p.id === c.welcome?.id);
      if (prevMe && nowMe && nowMe.hp > prevMe.hp && Math.hypot(nowMe.x - prevMe.x, nowMe.y - prevMe.y) > 40) {
        c.deaths = (c.deaths ?? 0) + 1;
        console.log(`info [${el()}] PLAYER DIED (hp ${prevMe.hp} -> respawned at ${Math.floor(nowMe.x / 32)},${Math.floor(nowMe.y / 32)}); mobs=${m.mobs.length} night=${m.isNight}`);
      }
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

const colonistOnTile = (c, x, y) =>
  c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);
const kinds = (c, kind) => c.snap.colonists.filter((k) => k.kind === kind);

// Send a setTile and collect every tileUpdate (anywhere) that arrives within waitMs.
async function act(c, x, y, tile, waitMs = 500) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.at >= since);
}

// Placement expected to succeed: retries a few times in case a walking colonist briefly blocks the tile.
async function placeExpectAt(c, x, y, tile, expectX, expectY, expectTile, tries = 6) {
  for (let i = 0; i < tries; i++) {
    while (colonistOnTile(c, x, y)) await sleep(100);
    const ups = await act(c, x, y, tile);
    const hit = ups.filter((u) => u.tileX === expectX && u.tileY === expectY);
    if (hit.length) return { ups, hit };
    await sleep(300);
  }
  return { ups: [], hit: [] };
}

// Find a reachable standing tile whose surrounding 5x5 box (Chebyshev radius 2) is entirely Empty and
// unoccupied, at least 7 tiles away from every previously used site.
function findSite(c, avoid) {
  const { dist, key } = bfs(c);
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

const a = connect();
await a.ready();
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };
info(`connected; players=${a.snap.players.length}; first snapshot stock wood=${a.firstSnap.wood} food=${a.firstSnap.food} iron=${a.firstSnap.iron} rock=${a.firstSnap.rock} pop=${a.firstSnap.population}/${a.firstSnap.populationCap} isNight=${a.firstSnap.isNight}`);

// Observe tree growth near lumberjack posts throughout the run.
const lumberjackPosts = [];

// ---------------- (a) spawn sanity ----------------
{
  const me = a.me();
  const t = a.meTile();
  result(!SOLID.has(a.tileAt(t.x, t.y)) && !(t.x === TC.x && t.y === TC.y),
    `(a) spawn tile (${t.x},${t.y}) is walkable (tile=${a.tileAt(t.x, t.y)}), not the TC tile (${TC.x},${TC.y})`);
  const before = { x: me.x, y: me.y };
  let moved = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    a.send({ type: "input", dx, dy });
    await sleep(400);
    a.send({ type: "input", dx: 0, dy: 0 });
    await sleep(100);
    const now = a.me();
    const d = Math.hypot(now.x - before.x, now.y - before.y);
    if (d > 20) {
      moved = { dx, dy, d };
      break;
    }
  }
  result(!!moved, `(a) player moved immediately after spawn: ${moved ? `dir (${moved.dx},${moved.dy}) moved ${moved.d.toFixed(1)}px` : "STUCK in every direction"}`);
  result(a.snap.population === 0 && a.snap.populationCap === 0,
    `(a) fresh server reports population=${a.snap.population} populationCap=${a.snap.populationCap} (expected 0/0)`);
}

// ---------------- (f) castle leveling ----------------
{
  const s = await gotoNewSite(a, "(f)");
  if (s) {
    const A = { x: s.x, y: s.y - 2 };
    const iron0 = a.snap.iron, rock0 = a.snap.rock;
    const knights0 = new Set(kinds(a, "knight").map((k) => k.id));
    const p1 = await placeExpectAt(a, A.x, A.y, T.KnightPost, A.x, A.y, T.KnightPost);
    await sleep(150);
    const newKnights = kinds(a, "knight").filter((k) => !knights0.has(k.id));
    const knight = newKnights[0];
    result(p1.hit.length === 1 && p1.hit[0].tile === T.KnightPost,
      `(f) KnightPost at (${A.x},${A.y}) -> tileUpdate ${JSON.stringify(p1.hit.map((u) => u.tile))} (expected [5])`);
    result(newKnights.length === 1 && knight.hp === 60 && knight.maxHp === 60,
      `(f) one new knight, hp/maxHp=${knight?.hp}/${knight?.maxHp} (expected 60/60)`);
    result(a.snap.iron === iron0 - 10 && a.snap.rock === rock0 - 5, `(f) 1st post cost: iron ${iron0}->${a.snap.iron}, rock ${rock0}->${a.snap.rock}`);

    const pickK2 = () => {
      const kn = a.snap.colonists.find((k) => k.id === knight?.id);
      const kt = kn ? { x: Math.floor(kn.x / TILE), y: Math.floor(kn.y / TILE) } : null;
      for (const n of [{ x: A.x - 1, y: A.y }, { x: A.x + 1, y: A.y }, { x: A.x, y: A.y + 1 }]) {
        if (kt && kt.x === n.x && kt.y === n.y) continue;
        if (n.x === s.x && n.y === s.y) continue;
        if (a.tileAt(n.x, n.y) === T.Empty && !colonistOnTile(a, n.x, n.y)) return n;
      }
      return null;
    };
    let K2 = pickK2();
    info(`(f) knight spawned at tile (${Math.floor(knight.x / TILE)},${Math.floor(knight.y / TILE)}); 2nd/3rd post tile K2=(${K2?.x},${K2?.y})`);
    const iron1 = a.snap.iron, rock1 = a.snap.rock;
    const p2 = await placeExpectAt(a, K2.x, K2.y, T.KnightPost, A.x, A.y, T.Castle2);
    await sleep(150);
    const k2 = a.snap.colonists.find((k) => k.id === knight.id);
    result(p2.hit.length === 1 && p2.hit[0].tile === T.Castle2 && a.tileAt(K2.x, K2.y) === T.Empty &&
      p2.ups.every((u) => !(u.tileX === K2.x && u.tileY === K2.y)),
      `(f) 2nd adjacent KnightPost: original (${A.x},${A.y}) -> ${a.tileAt(A.x, A.y)} (expected 17), new tile (${K2.x},${K2.y}) stays ${a.tileAt(K2.x, K2.y)} (expected 0, no update)`);
    result(k2 && k2.maxHp === 100 && k2.hp === 100 && kinds(a, "knight").length === knights0.size + 1,
      `(f) same knight upgraded in place: hp/maxHp=${k2?.hp}/${k2?.maxHp} (expected 100/100); knights=${kinds(a, "knight").length}`);
    result(a.snap.iron === iron1 - 10 && a.snap.rock === rock1 - 5, `(f) 2nd (combining) post still costs 10 iron + 5 rock: iron ${iron1}->${a.snap.iron}, rock ${rock1}->${a.snap.rock}`);

    if (a.tileAt(K2.x, K2.y) !== T.Empty || colonistOnTile(a, K2.x, K2.y)) K2 = pickK2();
    const p3 = await placeExpectAt(a, K2.x, K2.y, T.KnightPost, A.x, A.y, T.Castle3);
    await sleep(150);
    const k3 = a.snap.colonists.find((k) => k.id === knight.id);
    result(p3.hit.length === 1 && p3.hit[0].tile === T.Castle3 && a.tileAt(K2.x, K2.y) === T.Empty,
      `(f) 3rd adjacent KnightPost: original -> ${a.tileAt(A.x, A.y)} (expected 18), placed tile stays ${a.tileAt(K2.x, K2.y)}`);
    result(k3 && k3.maxHp === 160 && k3.hp === 160, `(f) knight now hp/maxHp=${k3?.hp}/${k3?.maxHp} (expected 160/160)`);
    info(`(f) stock after 3 knight posts: iron=${a.snap.iron} rock=${a.snap.rock}`);
  }
}

// ---------------- (b) house combining ----------------
let siteA = null;
const H1 = {}, H2 = {};
{
  siteA = await gotoNewSite(a, "(b)");
  if (siteA) {
    Object.assign(H1, { x: siteA.x, y: siteA.y - 2 });
    Object.assign(H2, { x: siteA.x + 1, y: siteA.y - 2 });
    const w0 = a.snap.wood;
    const p1 = await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y, T.House);
    await sleep(100);
    result(p1.hit.length === 1 && p1.hit[0].tile === T.House && a.snap.populationCap === 1,
      `(b) House at (${H1.x},${H1.y}) -> ${JSON.stringify(p1.hit.map((u) => u.tile))} (expected [13]); populationCap=${a.snap.populationCap} (expected 1); wood ${w0}->${a.snap.wood}`);
    const p2 = await placeExpectAt(a, H2.x, H2.y, T.House, H1.x, H1.y, T.BigHouse);
    await sleep(100);
    result(p2.hit.length === 1 && p2.hit[0].tile === T.BigHouse && a.tileAt(H2.x, H2.y) === T.Empty &&
      p2.ups.every((u) => !(u.tileX === H2.x && u.tileY === H2.y)),
      `(b) adjacent House at (${H2.x},${H2.y}): first tile -> ${a.tileAt(H1.x, H1.y)} (expected 14), second tile stays ${a.tileAt(H2.x, H2.y)} (expected 0); cap=${a.snap.populationCap} (expected 3)`);
    const p3 = await placeExpectAt(a, H2.x, H2.y, T.House, H1.x, H1.y, T.HouseLevel2);
    await sleep(100);
    result(p3.hit.length === 1 && p3.hit[0].tile === T.HouseLevel2 && a.tileAt(H2.x, H2.y) === T.Empty,
      `(b) third adjacent House: original tile -> ${a.tileAt(H1.x, H1.y)} (expected 15)`);
    result(a.snap.population === 0 && a.snap.populationCap === 5,
      `(b) population=${a.snap.population} populationCap=${a.snap.populationCap} (expected 0/5)`);
    result(a.snap.wood === w0 - 30, `(b) each House placement cost a flat 10 wood: wood ${w0}->${a.snap.wood} (expected -30)`);
    // A 4th House next to the HouseLevel2 must not combine further (capped) -> plain House. Only if affordable.
    info(`(b) wood left=${a.snap.wood}`);
  }
}

// ---------------- (c) population gating ----------------
const L = [];
let sixth = null;
{
  if (siteA && (await ensureAt(a, siteA))) {
    for (const [dx, dy] of [[-2, 0], [-2, 1], [-1, 2], [0, 2], [1, 2]]) L.push({ x: siteA.x + dx, y: siteA.y + dy });
    sixth = { x: siteA.x + 2, y: siteA.y + 1 };
    let okAll = true;
    for (const [i, p] of L.entries()) {
      const r = await placeExpectAt(a, p.x, p.y, T.Lumberjack, p.x, p.y, T.Lumberjack);
      await sleep(100);
      if (!(r.hit.length === 1 && r.hit[0].tile === T.Lumberjack)) okAll = false;
      info(`(c) lumberjack ${i + 1} at (${p.x},${p.y}): ${r.hit.length ? "placed" : "REJECTED"}; pop=${a.snap.population}/${a.snap.populationCap}`);
      lumberjackPosts.push(p);
    }
    result(okAll && a.snap.population === 5 && a.snap.populationCap === 5,
      `(c) 5 lumberjack posts placed; pop=${a.snap.population}/${a.snap.populationCap} (expected 5/5)`);
    while (colonistOnTile(a, sixth.x, sixth.y)) await sleep(100);
    const pre = a.tileAt(sixth.x, sixth.y);
    const rej = await act(a, sixth.x, sixth.y, T.Lumberjack, 800);
    result(pre === T.Empty && rej.filter((u) => u.tileX === sixth.x && u.tileY === sixth.y).length === 0 && a.snap.population === 5,
      `(c) 6th lumberjack at (${sixth.x},${sixth.y}) rejected at cap (updates there=${rej.filter((u) => u.tileX === sixth.x && u.tileY === sixth.y).length}, pop=${a.snap.population})`);
    // Also gated: Iron/Rock Mine and Barn at cap — Barn checked here (wood permitting) on an empty tile.
    const br = await act(a, siteA.x - 1, siteA.y - 2, T.Barn, 600);
    result(br.filter((u) => u.tileX === siteA.x - 1 && u.tileY === siteA.y - 2).length === 0,
      `(c) Barn also rejected at cap (wood=${a.snap.wood}; ${a.snap.wood >= 15 ? "affordable, so rejection is the pop gate" : "NOTE: also unaffordable, so not conclusive"})`);
    const brk = await act(a, L[0].x, L[0].y, T.Empty);
    await sleep(100);
    result(brk.some((u) => u.tileX === L[0].x && u.tileY === L[0].y && u.tile === T.Empty) && a.snap.population === 4,
      `(c) broke lumberjack at (${L[0].x},${L[0].y}); pop=${a.snap.population} (expected 4)`);
    lumberjackPosts.shift();
    const r6 = await placeExpectAt(a, sixth.x, sixth.y, T.Lumberjack, sixth.x, sixth.y, T.Lumberjack);
    await sleep(100);
    result(r6.hit.length === 1 && a.snap.population === 5, `(c) 6th lumberjack now accepted; pop=${a.snap.population}/${a.snap.populationCap}`);
    lumberjackPosts.push(sixth);
  }
}

// ---------------- (e) mine clustering (iron + rock) ----------------
{
  // Free 2 slots: break two lumberjacks.
  if (siteA && (await ensureAt(a, siteA))) {
    for (const p of [L[1], L[2]]) {
      await ensureAt(a, siteA);
      await act(a, p.x, p.y, T.Empty);
      const idx = lumberjackPosts.findIndex((q) => q.x === p.x && q.y === p.y);
      if (idx >= 0) lumberjackPosts.splice(idx, 1);
    }
    await sleep(100);
    info(`(e) freed two slots: pop=${a.snap.population}/${a.snap.populationCap}`);
  }
  for (const [label, ore, mine, kind] of [["Iron", T.IronOre, T.IronMine, "ironMiner"], ["Rock", T.Rock, T.RockMine, "rockMiner"]]) {
    const { dist, key } = bfs(a);
    let best = null;
    for (let y = 0; y < a.H(); y++)
      for (let x = 0; x < a.W(); x++) {
        if (a.tileAt(x, y) !== ore) continue;
        for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const E = { x: x + ex, y: y + ey };
          if (!a.inBounds(E.x, E.y) || a.tileAt(E.x, E.y) !== T.Empty) continue;
          // E must not already touch a mine of this type (none should exist yet anyway).
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([qx, qy]) => a.tileAt(E.x + qx, E.y + qy) === mine)) continue;
          for (let sx = x - 2; sx <= x + 2; sx++)
            for (let sy = y - 2; sy <= y + 2; sy++) {
              if (sx === E.x && sy === E.y) continue;
              const d = dist.get(key(sx, sy));
              if (d === undefined) continue;
              const r1 = Math.hypot((sx - x) * TILE, (sy - y) * TILE);
              const r2 = Math.hypot((sx - E.x) * TILE, (sy - E.y) * TILE);
              if (r1 > REACH - 4 || r2 > REACH - 4) continue;
              if (!best || d < best.d) best = { O: { x, y }, E, S: { x: sx, y: sy }, d };
            }
        }
      }
    if (!best) {
      result(false, `(e) no reachable ${label} ore with an empty neighbour`);
      continue;
    }
    const { O, E, S } = best;
    const walked = await ensureAt(a, S);
    result(walked, `(e) ${label}: walked to (${S.x},${S.y}); ore O=(${O.x},${O.y}), empty neighbour E=(${E.x},${E.y})`);
    while (colonistOnTile(a, E.x, E.y)) await sleep(100);
    const before = await act(a, E.x, E.y, mine, 600);
    result(before.filter((u) => u.tileX === E.x && u.tileY === E.y).length === 0 && a.tileAt(E.x, E.y) === T.Empty,
      `(e) ${label} Mine on empty E before any mine exists: rejected`);
    const m0 = kinds(a, kind).length;
    const p1 = await placeExpectAt(a, O.x, O.y, mine, O.x, O.y, mine);
    await sleep(150);
    result(p1.hit.length === 1 && p1.hit[0].tile === mine && p1.hit[0].prev === ore && kinds(a, kind).length === m0 + 1,
      `(e) ${label} Mine on ore O accepted (tile ${ore}->${a.tileAt(O.x, O.y)}); ${kind}s=${kinds(a, kind).length}`);
    const p2 = await placeExpectAt(a, E.x, E.y, mine, E.x, E.y, mine);
    await sleep(150);
    result(p2.hit.length === 1 && p2.hit[0].tile === mine && p2.hit[0].prev === T.Empty && kinds(a, kind).length === m0 + 2,
      `(e) ${label} Mine on empty E adjacent to mine accepted; ${kind}s=${kinds(a, kind).length} (expected ${m0 + 2}); pop=${a.snap.population}/${a.snap.populationCap}`);
    const b2 = await act(a, E.x, E.y, T.Empty);
    await sleep(150);
    const b2u = b2.filter((u) => u.tileX === E.x && u.tileY === E.y);
    result(b2u.length === 1 && b2u[0].tile === T.Empty && kinds(a, kind).length === m0 + 1,
      `(e) breaking adjacent-placed ${label} Mine reverts to ${JSON.stringify(b2u.map((u) => u.tile))} (expected [0], NOT ore); ${kind}s=${kinds(a, kind).length}`);
    const b1 = await act(a, O.x, O.y, T.Empty);
    await sleep(150);
    const b1u = b1.filter((u) => u.tileX === O.x && u.tileY === O.y);
    result(b1u.length === 1 && b1u[0].tile === ore && kinds(a, kind).length === m0,
      `(e) breaking on-ore ${label} Mine reverts to ${JSON.stringify(b1u.map((u) => u.tile))} (expected [${ore}]); ${kind}s=${kinds(a, kind).length}`);
  }
}

// ---------------- (d) barn + farm ----------------
{
  info(`(d) waiting for wood >= 15 for the Barn (wood=${a.snap.wood}, pop=${a.snap.population}/${a.snap.populationCap})`);
  const waitStart = Date.now();
  while (a.snap.wood < 15 && Date.now() - waitStart < 180000) await sleep(500);
  info(`(d) wood=${a.snap.wood} after ${((Date.now() - waitStart) / 1000).toFixed(0)}s`);
  const s = await gotoNewSite(a, "(d)");
  if (s) {
    const B = { x: s.x, y: s.y - 1 };
    const Fadj = { x: s.x + 1, y: s.y - 1 };
    const Fdiag = { x: s.x + 1, y: s.y - 2 };
    const Ffar = { x: s.x, y: s.y + 2 };
    const farmers0 = kinds(a, "farmer").length;
    const pop0 = a.snap.population;
    const w0 = a.snap.wood;
    // Farm before any barn nearby -> rejected.
    const pre = await act(a, Fadj.x, Fadj.y, T.FarmPlot, 600);
    result(pre.filter((u) => u.tileX === Fadj.x && u.tileY === Fadj.y).length === 0,
      `(d) Farm Plot with no Barn anywhere adjacent: rejected`);
    const pb = await placeExpectAt(a, B.x, B.y, T.Barn, B.x, B.y, T.Barn);
    await sleep(150);
    result(pb.hit.length === 1 && pb.hit[0].tile === T.Barn && kinds(a, "farmer").length === farmers0 + 1 && a.snap.population === pop0 + 1,
      `(d) Barn at (${B.x},${B.y}) -> ${JSON.stringify(pb.hit.map((u) => u.tile))} (expected [16]); farmers=${kinds(a, "farmer").length}; pop ${pop0}->${a.snap.population}; wood ${w0}->${a.snap.wood} (expected -15)`);
    const rf = await act(a, Ffar.x, Ffar.y, T.FarmPlot, 600);
    result(rf.filter((u) => u.tileX === Ffar.x && u.tileY === Ffar.y).length === 0,
      `(d) Farm Plot at (${Ffar.x},${Ffar.y}), not adjacent to the Barn: rejected`);
    const rd = await act(a, Fdiag.x, Fdiag.y, T.FarmPlot, 600);
    result(rd.filter((u) => u.tileX === Fdiag.x && u.tileY === Fdiag.y).length === 0,
      `(d) Farm Plot at (${Fdiag.x},${Fdiag.y}), only DIAGONAL to the Barn: rejected`);
    a.snaps = [];
    a.recordSnaps = true;
    const pf = await placeExpectAt(a, Fadj.x, Fadj.y, T.FarmPlot, Fadj.x, Fadj.y, T.FarmPlot);
    const placedAt = Date.now();
    result(pf.hit.length === 1 && pf.hit[0].tile === T.FarmPlot, `(d) Farm Plot adjacent to Barn at (${Fadj.x},${Fadj.y}) accepted (tile 4)`);
    result(kinds(a, "farmer").length === farmers0 + 1, `(d) Farm Plot spawned no colonist (farmers still ${kinds(a, "farmer").length})`);
    while (Date.now() - placedAt < 12500) await sleep(200);
    a.recordSnaps = false;
    const deltas = [];
    for (let i = 1; i < a.snaps.length; i++) {
      const d = a.snaps[i].food - a.snaps[i - 1].food;
      if (d !== 0) deltas.push({ d, t: ((a.snaps[i].at - placedAt) / 1000).toFixed(2), night: a.snaps[i].isNight });
    }
    result(deltas.some((x) => x.d === 3) && !deltas.some((x) => x.d === 1),
      `(d) food deltas in 12.5s after planting: ${JSON.stringify(deltas)} (expected a single-tick +3 at ~10s, no +1)`);
    // Freeze check: break the Barn, food must stop growing from this plot.
    await ensureAt(a, s);
    const bb = await act(a, B.x, B.y, T.Empty);
    await sleep(150);
    result(bb.some((u) => u.tileX === B.x && u.tileY === B.y && u.tile === T.Empty) && kinds(a, "farmer").length === farmers0 &&
      a.tileAt(Fadj.x, Fadj.y) === T.FarmPlot,
      `(d) broke Barn: farmer removed (farmers=${kinds(a, "farmer").length}), Farm Plot still present (tile=${a.tileAt(Fadj.x, Fadj.y)})`);
    a.snaps = [];
    a.recordSnaps = true;
    await sleep(11000);
    a.recordSnaps = false;
    const plus = [];
    for (let i = 1; i < a.snaps.length; i++) if (a.snaps[i].food - a.snaps[i - 1].food > 0) plus.push(a.snaps[i].food - a.snaps[i - 1].food);
    result(plus.length === 0, `(d) plot frozen with no Barn: food increases over 11s = ${JSON.stringify(plus)} (expected none)`);
    await ensureAt(a, s);
    const bf = await act(a, Fadj.x, Fadj.y, T.Empty);
    result(bf.some((u) => u.tileX === Fadj.x && u.tileY === Fadj.y && u.tile === T.Empty), `(d) Farm Plot breakable -> Empty`);
  }
}

// ---------------- (g) archer tower ----------------
{
  info(`(g) waiting for wood >= 11 (wood=${a.snap.wood})`);
  const waitStart = Date.now();
  while (a.snap.wood < 11 && Date.now() - waitStart < 180000) await sleep(500);
  const s = await gotoNewSite(a, "(g)");
  if (s) {
    const W = { x: s.x, y: s.y - 2 };
    const w0 = a.snap.wood;
    const pw = await placeExpectAt(a, W.x, W.y, T.Wall, W.x, W.y, T.Wall);
    await sleep(100);
    result(pw.hit.length === 1 && pw.hit[0].tile === T.Wall, `(g) Wood Wall at (${W.x},${W.y}) placed`);
    const archers0 = new Set(kinds(a, "archer").map((k) => k.id));
    const w1 = a.snap.wood;
    const pa = await placeExpectAt(a, W.x, W.y, T.ArcherPost, W.x, W.y, T.ArcherTower);
    await sleep(150);
    const archer = kinds(a, "archer").find((k) => !archers0.has(k.id));
    result(pa.hit.length === 1 && pa.hit[0].tile === T.ArcherTower && pa.hit[0].prev === T.Wall,
      `(g) Archer Post on the Wall -> ${JSON.stringify(pa.hit.map((u) => u.tile))} (expected [19], not 6); wood ${w1}->${a.snap.wood} (expected -10)`);
    result(archer && archer.maxHp === 50 && archer.hp === 50, `(g) tower archer hp/maxHp=${archer?.hp}/${archer?.maxHp} (expected 50/50)`);
    if (archer) {
      const p0 = { x: archer.x, y: archer.y };
      await sleep(3000);
      const now = a.snap.colonists.find((k) => k.id === archer.id);
      result(now && now.x === p0.x && now.y === p0.y, `(g) tower archer stationary over 3s: (${p0.x},${p0.y}) -> (${now?.x},${now?.y}) state=${now?.state}`);
    }
    const bt = await act(a, W.x, W.y, T.Empty);
    await sleep(150);
    const btu = bt.filter((u) => u.tileX === W.x && u.tileY === W.y);
    result(btu.length === 1 && btu[0].tile === T.Wall && !a.snap.colonists.some((k) => k.id === archer?.id),
      `(g) breaking the tower reverts to ${JSON.stringify(btu.map((u) => u.tile))} (expected [1] Wall), archer removed`);
    const bw = await act(a, W.x, W.y, T.Empty);
    info(`(g) cleanup: broke wall -> ${JSON.stringify(bw.filter((u) => u.tileX === W.x && u.tileY === W.y).map((u) => u.tile))}; wood=${a.snap.wood}`);
  }
}

// ---------------- lumberjack tree growth (observational) ----------------
{
  const growth = a.tileUpdates.filter((u) => u.tile === T.Tree);
  const near = growth.filter((u) => lumberjackPosts.some((p) => Math.max(Math.abs(p.x - u.tileX), Math.abs(p.y - u.tileY)) <= 2));
  const ringOk = near.every((u) => lumberjackPosts.every((p) => Math.abs(p.x - u.tileX) + Math.abs(p.y - u.tileY) > 1));
  info(`lumberjack growth: ${growth.length} tree tileUpdates total during run, ${near.length} within 2 tiles of a current lumberjack post ${JSON.stringify(near.map((u) => [u.tileX, u.tileY]))}; none orthogonally adjacent to a post: ${ringOk}`);
  result(near.length > 0 && ringOk, `(extra) trees grew within the 2-tile radius of lumberjack posts, never on the ring touching a post`);
}

// ---------------- breaking a HouseLevel2 (observational, end of run) ----------------
if (siteA && (await ensureAt(a, siteA))) {
  const pop0 = a.snap.population;
  const bh = await act(a, H1.x, H1.y, T.Empty);
  await sleep(150);
  const bhu = bh.filter((u) => u.tileX === H1.x && u.tileY === H1.y);
  result(bhu.length === 1 && bhu[0].tile === T.Empty && a.snap.populationCap === 0,
    `(extra) breaking HouseLevel2 reverts straight to Empty; populationCap=${a.snap.populationCap} (expected 0)`);
  info(`after losing all housing: population=${a.snap.population} (was ${pop0}) — existing civilians are NOT evicted (pop > cap)`);
}

info(`player deaths during run: ${a.deaths ?? 0}`);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
