// Scripted test: houses/population cap, barns + farm plots, mine clustering, knight castle leveling,
// the Archery Range (rejected on a wall), plus a spawn-movement sanity check. Needs a FRESH server (starting stock wood 80 / iron 60 /
// rock 60 / grain 60, no structures built yet) with no other players connected; run it with COLONY_WORLD_SIZE=80.
// The Town Center alone gives a population cap of 12 (plus +1 per house/house or house/workplace neighbour pair),
// so the population-gating phase fills the cap with Lumberjack Posts at a separate site.
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
  Barn: 16, Castle2: 17, Castle3: 18, ArcherTower: 19,
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
      c.welcomeTiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const isClergy = (k) => c.tiles[k.postY * c.welcome.worldTilesX + k.postX] === ABBEY_HALL;
      m.clergy = m.colonists.filter(isClergy);
      m.colonists = m.colonists.filter((k) => !isClergy(k));
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
function findSite(c, avoid, minDist = 7) {
  const { dist, key } = bfs(c);
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

// populationCap(): Town Center base 12 + 1/3/5 per House/BigHouse/HouseLevel2 + neighbourhood bonus (+1 per
// 8-neighbour pair of house/house, counted once, or house/workplace-or-unit building).
const HOUSE_CAP = { 13: 1, 14: 3, 15: 5 };
const SYNERGY_BUILDINGS = new Set([3, 16, 9, 10, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 49, 5, 17, 18, 6, 19, 32, 33, 34]);
function expectedCap(c) {
  let cap = 12; // TOWN_CENTER_BASE_POPULATION
  for (let y = 0; y < c.H(); y++)
    for (let x = 0; x < c.W(); x++) {
      const t = c.tileAt(x, y);
      if (!HOUSE_CAP[t]) continue;
      cap += HOUSE_CAP[t];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (!c.inBounds(x + dx, y + dy)) continue;
        const n = c.tileAt(x + dx, y + dy);
        if (SYNERGY_BUILDINGS.has(n)) cap++;
        else if (HOUSE_CAP[n] && (dy > 0 || (dy === 0 && dx > 0))) cap++;
      }
    }
  return cap;
}

const a = connect();
await a.ready();
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };
info(`connected; players=${a.snap.players.length}; first snapshot stock wood=${a.firstSnap.wood} grain=${a.firstSnap.grain} iron=${a.firstSnap.iron} rock=${a.firstSnap.rock} pop=${a.firstSnap.population}/${a.firstSnap.populationCap} isNight=${a.firstSnap.isNight}`);

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
  // The Town Center alone houses 12 (TOWN_CENTER_BASE_POPULATION); the starting builder is its only
  // resident; the Abbey clergy don't count.
  result(a.snap.population === 1 && a.snap.populationCap === 12,
    `(a) fresh server reports population=${a.snap.population} populationCap=${a.snap.populationCap} (expected 1/12: the starting builder, Town Center base)`);
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

    const iron1 = a.snap.iron, rock1 = a.snap.rock;
    const p2 = await placeExpectAt(a, A.x, A.y, T.KnightPost, A.x, A.y, T.Castle2);
    await sleep(150);
    const k2 = a.snap.colonists.find((k) => k.id === knight.id);
    result(p2.hit.length === 1 && p2.hit[0].tile === T.Castle2 && a.tileAt(A.x, A.y) === T.Castle2 &&
      p2.ups.every((u) => u.tileX === A.x && u.tileY === A.y),
      `(f) KnightPost placed ON the post (${A.x},${A.y}) -> ${a.tileAt(A.x, A.y)} (expected 17), no other tile updated`);
    result(k2 && k2.maxHp === 100 && k2.hp === 100 && kinds(a, "knight").length === knights0.size + 3,
      `(f) same knight upgraded in place: hp/maxHp=${k2?.hp}/${k2?.maxHp} (expected 100/100); knights=${kinds(a, "knight").length}`);
    result(a.snap.iron === iron1 - 10 && a.snap.rock === rock1 - 5, `(f) 2nd (in-place) post still costs 10 iron + 5 rock: iron ${iron1}->${a.snap.iron}, rock ${rock1}->${a.snap.rock}`);

    const p3 = await placeExpectAt(a, A.x, A.y, T.KnightPost, A.x, A.y, T.Castle3);
    await sleep(150);
    const k3 = a.snap.colonists.find((k) => k.id === knight.id);
    result(p3.hit.length === 1 && p3.hit[0].tile === T.Castle3 && p3.ups.every((u) => u.tileX === A.x && u.tileY === A.y),
      `(f) 3rd KnightPost on the castle: tile -> ${a.tileAt(A.x, A.y)} (expected 18), no other tile updated`);
    result(k3 && k3.maxHp === 160 && k3.hp === 160, `(f) knight now hp/maxHp=${k3?.hp}/${k3?.maxHp} (expected 160/160)`);
    // A KnightPost on an empty tile ADJACENT to the castle is just a new standalone post.
    const adj = [{ x: A.x - 1, y: A.y }, { x: A.x + 1, y: A.y }].find((n) => a.tileAt(n.x, n.y) === T.Empty && !colonistOnTile(a, n.x, n.y));
    if (adj) {
      const p4 = await placeExpectAt(a, adj.x, adj.y, T.KnightPost, adj.x, adj.y, T.KnightPost);
      await sleep(150);
      result(p4.hit.length === 1 && a.tileAt(A.x, A.y) === T.Castle3 && a.tileAt(adj.x, adj.y) === T.KnightPost &&
        kinds(a, "knight").length === knights0.size + 6,
        `(f) KnightPost next to a castle is a new post: castle stays ${a.tileAt(A.x, A.y)} (18), new tile ${a.tileAt(adj.x, adj.y)} (5), knights=${kinds(a, "knight").length}`);
    }
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
    const cap0 = a.snap.populationCap;
    const p1 = await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y, T.House);
    await sleep(100);
    result(p1.hit.length === 1 && p1.hit[0].tile === T.House && a.snap.populationCap === cap0 + 1,
      `(b) House at (${H1.x},${H1.y}) -> ${JSON.stringify(p1.hit.map((u) => u.tile))} (expected [13]); populationCap=${a.snap.populationCap} (expected ${cap0 + 1}); wood ${w0}->${a.snap.wood}`);
    // Upgrading needs goods in stock; the test server starts without them, so a House on a House is rejected.
    // Only updates at H1 matter: trees grow (and get chopped) elsewhere at any time.
    const rejU = (await act(a, H1.x, H1.y, T.House, 600)).filter((u) => u.tileX === H1.x && u.tileY === H1.y);
    // A Cottage costs 20 wood + 5 rock (ROADMAP "Pop cap rework": was 10 wood).
    result(rejU.length === 0 && a.tileAt(H1.x, H1.y) === T.House && a.snap.wood === w0 - 20,
      `(b) House on House with no goods is rejected: tile=${a.tileAt(H1.x, H1.y)} (expected 13), updates=${rejU.length}, wood ${w0}->${a.snap.wood} (expected -20 only)`);
    const p2 = await placeExpectAt(a, H2.x, H2.y, T.House, H2.x, H2.y, T.House);
    await sleep(100);
    result(p2.hit.length === 1 && p2.hit[0].tile === T.House && a.tileAt(H1.x, H1.y) === T.House && a.snap.populationCap === cap0 + 3,
      `(b) adjacent House at (${H2.x},${H2.y}) is a new standalone House: first tile ${a.tileAt(H1.x, H1.y)} (expected 13), cap=${a.snap.populationCap} (expected ${cap0 + 3}: 2 houses + 1 adjacency pair)`);
    result(a.snap.wood === w0 - 40, `(b) each House placement cost a flat 20 wood: wood ${w0}->${a.snap.wood} (expected -40)`);
    // The in-place success path is only exercised if the stock happens to hold the goods.
    if (a.snap.grain >= 3 && a.snap.meat >= 3 && a.snap.fruit >= 3 && a.snap.clothes >= 5 && a.snap.tools >= 2 && a.snap.luxuryItems >= 1) {
      const u1 = await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y, T.BigHouse);
      result(u1.hit.length === 1 && u1.ups.every((u) => u.tileX === H1.x && u.tileY === H1.y), `(b) House on House -> BigHouse in place`);
      const u2 = await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y, T.HouseLevel2);
      result(u2.hit.length === 1 && u2.ups.every((u) => u.tileX === H1.x && u.tileY === H1.y), `(b) House on BigHouse -> HouseLevel2 in place`);
    } else {
      info(`(b) in-place House upgrade success path not exercised: server has no goods stock (see economy-goods-test (d))`);
    }
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
    // Trees can regrow on the planned extra tile while the cap is being filled; fall back to another empty
    // in-reach tile that touches no house (so placing it later can't change the cap).
    const houseNear = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => a.tileAt(x + dx, y + dy) === T.House);
    const freeExtra = (p) => a.tileAt(p.x, p.y) === T.Empty && !colonistOnTile(a, p.x, p.y) && !houseNear(p.x, p.y);
    const pickSixth = () => (freeExtra(sixth) ? sixth : RING.map(([dx, dy]) => ({ x: siteA.x + dx, y: siteA.y + dy })).find(freeExtra) ?? sixth);
    let okAll = true;
    for (const [i, p] of L.entries()) {
      const r = await placeExpectAt(a, p.x, p.y, T.Lumberjack, p.x, p.y, T.Lumberjack);
      await sleep(100);
      if (!(r.hit.length === 1 && r.hit[0].tile === T.Lumberjack)) okAll = false;
      info(`(c) lumberjack ${i + 1} at (${p.x},${p.y}): ${r.hit.length ? "placed" : "REJECTED"}; pop=${a.snap.population}/${a.snap.populationCap}`);
      lumberjackPosts.push(p);
    }
    // + the starting builder.
    result(okAll && a.snap.population === 6,
      `(c) 5 lumberjack posts placed; pop=${a.snap.population}/${a.snap.populationCap} (expected 6: 5 + the starting builder)`);
    // The cap is no longer just the houses: Town Center base 12 + houses + neighbourhood pairs. Check it against
    // the formula, then fill the remaining slots with filler Lumberjack Posts at a separate site.
    const capNow = expectedCap(a);
    result(a.snap.populationCap === capNow,
      `(c) populationCap=${a.snap.populationCap} matches TC base 12 + houses + neighbourhood pairs = ${capNow}`);
    const fillers = await fillPopulationToCap(a, "(c)", [...usedSites, siteA]);
    for (const site of new Set(fillers.map((p) => p.site))) usedSites.push(site);
    const cap = a.snap.populationCap;
    result(a.snap.population === cap, `(c) population filled to the cap: ${a.snap.population}/${cap} (5 here + ${fillers.length} fillers)`);
    await ensureAt(a, siteA);
    sixth = pickSixth();
    while (colonistOnTile(a, sixth.x, sixth.y)) await sleep(100);
    const pre = a.tileAt(sixth.x, sixth.y);
    const rej = await act(a, sixth.x, sixth.y, T.Lumberjack, 800);
    result(pre === T.Empty && rej.filter((u) => u.tileX === sixth.x && u.tileY === sixth.y && u.tile === T.Lumberjack).length === 0 && a.snap.population === cap,
      `(c) extra lumberjack at (${sixth.x},${sixth.y}) rejected at cap (updates there=${rej.filter((u) => u.tileX === sixth.x && u.tileY === sixth.y && u.tile === T.Lumberjack).length}, pop=${a.snap.population}/${cap})`);
    // Also gated: Iron/Rock Mine and Barn at cap — Barn checked here (wood permitting) on an empty tile.
    const br = await act(a, siteA.x - 1, siteA.y - 2, T.Barn, 600);
    result(br.filter((u) => u.tileX === siteA.x - 1 && u.tileY === siteA.y - 2).length === 0,
      `(c) Barn also rejected at cap (wood=${a.snap.wood}; ${a.snap.wood >= 15 ? "affordable, so rejection is the pop gate" : "NOTE: also unaffordable, so not conclusive"})`);
    const brk = await act(a, L[0].x, L[0].y, T.Empty);
    await sleep(100);
    result(brk.some((u) => u.tileX === L[0].x && u.tileY === L[0].y && u.tile === T.Empty) && a.snap.population === cap - 1,
      `(c) broke lumberjack at (${L[0].x},${L[0].y}); pop=${a.snap.population} (expected ${cap - 1})`);
    lumberjackPosts.shift();
    sixth = pickSixth();
    const r6 = await placeExpectAt(a, sixth.x, sixth.y, T.Lumberjack, sixth.x, sixth.y, T.Lumberjack);
    await sleep(100);
    result(r6.hit.length === 1 && a.snap.population === cap, `(c) extra lumberjack now accepted; pop=${a.snap.population}/${a.snap.populationCap}`);
    lumberjackPosts.push(sixth);
    // Fillers done: break them so the rest of the run sees only this site's 5 lumberjacks.
    await clearFillers(a, fillers);
    info(`(c) fillers broken: pop=${a.snap.population}/${a.snap.populationCap}`);
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
    // New rule: a mine on an EMPTY tile next to a mine is rejected (only on ore, or on the mine itself to upgrade).
    while (colonistOnTile(a, E.x, E.y)) await sleep(100);
    const p2 = await act(a, E.x, E.y, mine, 700);
    result(p2.filter((u) => u.tileX === E.x && u.tileY === E.y).length === 0 && a.tileAt(E.x, E.y) === T.Empty && kinds(a, kind).length === m0 + 1,
      `(e) ${label} Mine on empty E adjacent to a mine is rejected (tile=${a.tileAt(E.x, E.y)} expected 0); ${kind}s=${kinds(a, kind).length} (expected ${m0 + 1})`);
    const p3 = await act(a, O.x, O.y, mine, 700);
    await sleep(150);
    result(p3.filter((u) => u.tileX === O.x && u.tileY === O.y).length === 0 && a.tileAt(O.x, O.y) === mine && kinds(a, kind).length === m0 + 2,
      `(e) ${label} Mine placed ON the mine upgrades in place (no tileUpdate, tile stays ${a.tileAt(O.x, O.y)}); ${kind}s=${kinds(a, kind).length} (expected ${m0 + 2})`);
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
      `(d) Farm Plot at (${Ffar.x},${Ffar.y}), 3 tiles from the Barn (outside its radius): rejected`);
    // Plots may go anywhere within BARN_FARM_RADIUS_TILES 2 (Chebyshev) of a Barn (was: orthogonally adjacent).
    const rd = await act(a, Fdiag.x, Fdiag.y, T.FarmPlot, 600);
    result(rd.some((u) => u.tileX === Fdiag.x && u.tileY === Fdiag.y && u.tile === T.FarmPlot),
      `(d) Farm Plot at (${Fdiag.x},${Fdiag.y}), DIAGONAL to the Barn (within its radius): accepted`);
    // Slow farming: the world is paused before planting and moved on with testHook fastForward, so the
    // plot's 3-day grow and its harvest are checked tick-exactly (raids off while days are skipped).
    await a.setPaused(true);
    await a.hook("setRaids", { enabled: false });
    // Skipped days still eat at every dawn: a deep grain store keeps the colony from starving meanwhile,
    // and the real stock is put back afterwards.
    const keepGrain = (await a.hook("setStock", { stock: {} })).stock.grain;
    await a.hook("setStock", { stock: { grain: 5000 } });
    const pf = await placeExpectAt(a, Fadj.x, Fadj.y, T.FarmPlot, Fadj.x, Fadj.y, T.FarmPlot);
    result(pf.hit.length === 1 && pf.hit[0].tile === T.FarmPlot, `(d) Farm Plot adjacent to Barn at (${Fadj.x},${Fadj.y}) accepted (tile 4)`);
    result(kinds(a, "farmer").length === farmers0 + 1, `(d) Farm Plot spawned no colonist (farmers still ${kinds(a, "farmer").length})`);
    // The first grow phase is the flat FARM_GROW_TICKS (3 days); the harvest phase is scaled by the plot's
    // biome (Plains -20%), happiness speed and the Barn's industrial synergy; a harvest yields
    // FARM_YIELD_PER_HARVEST grain at once.
    const plotKey = `${Fadj.x},${Fadj.y}`;
    let fst = await a.hook("farmState");
    let plot = fst.plots.find((q) => q.key === plotKey);
    const K = fst.constants;
    result(plot?.state === "sown" && plot.growTicksRemaining === K.FARM_GROW_TICKS,
      `(d) new plot sown with the flat ${K.FARM_GROW_TICKS}t grow (state=${plot?.state}, remaining=${plot?.growTicksRemaining})`);
    await a.hook("fastForward", { ticks: plot.growTicksRemaining });
    fst = await a.hook("farmState");
    plot = fst.plots.find((q) => q.key === plotKey);
    const hm = 0.5 + 0.5 * (fst.happiness / 100);
    const plotBiome = biomeAt(a, Fadj.x, Fadj.y) === 0 ? 0.8 : 1;
    const harvestT = Math.max(1, Math.round((K.FARM_HARVEST_TICKS * plotBiome) / (hm * industrialSynergy(a, B.x, B.y))));
    result(plot.state === "harvesting" && plot.harvestTicksRemaining === harvestT,
      `(d) ripe after exactly ${K.FARM_GROW_TICKS}t; harvest phase ${plot.harvestTicksRemaining}t (expected ${harvestT}t)`);
    await a.hook("fastForward", { ticks: plot.harvestTicksRemaining - 1 });
    const g0 = (await a.hook("setStock", { stock: {} })).stock.grain;
    await a.hook("fastForward", { ticks: 1 });
    const g1 = (await a.hook("setStock", { stock: {} })).stock.grain;
    result(g1 - g0 === K.FARM_YIELD_PER_HARVEST, `(d) the harvest's last tick adds +${g1 - g0} grain (expected +${K.FARM_YIELD_PER_HARVEST})`);
    await a.setPaused(false);
    // Freeze check: break the Barn, the plot must stop growing.
    await ensureAt(a, s);
    const bb = await act(a, B.x, B.y, T.Empty);
    await sleep(150);
    result(bb.some((u) => u.tileX === B.x && u.tileY === B.y && u.tile === T.Empty) && kinds(a, "farmer").length === farmers0 &&
      a.tileAt(Fadj.x, Fadj.y) === T.FarmPlot,
      `(d) broke Barn: farmer removed (farmers=${kinds(a, "farmer").length}), Farm Plot still present (tile=${a.tileAt(Fadj.x, Fadj.y)})`);
    await a.setPaused(true);
    const frozen0 = (await a.hook("farmState")).plots.find((q) => q.key === plotKey);
    await a.hook("fastForward", { ticks: K.FARM_GROW_TICKS + K.FARM_HARVEST_TICKS });
    const frozen1 = (await a.hook("farmState")).plots.find((q) => q.key === plotKey);
    result(frozen0.state === frozen1.state && frozen0.growTicksRemaining === frozen1.growTicksRemaining,
      `(d) plot frozen with no Barn over a whole grow: ${frozen0.state} ${frozen0.growTicksRemaining}t -> ${frozen1.state} ${frozen1.growTicksRemaining}t`);
    await a.hook("setStock", { stock: { grain: keepGrain } });
    await a.hook("setRaids", { enabled: true });
    await a.setPaused(false);
    await ensureAt(a, s);
    const bf = await act(a, Fadj.x, Fadj.y, T.Empty);
    result(bf.some((u) => u.tileX === Fadj.x && u.tileY === Fadj.y && u.tile === T.Empty), `(d) Farm Plot breakable -> Empty`);
  }
}

// ---------------- (g) Archery Range cannot be placed on a wall ----------------
{
  info(`(g) waiting for wood >= 11 (wood=${a.snap.wood})`);
  const waitStart = Date.now();
  while (a.snap.wood < 11 && Date.now() - waitStart < 180000) await sleep(500);
  const s = await gotoNewSite(a, "(g)");
  if (s) {
    const W = { x: s.x, y: s.y - 2 };
    const pw = await placeExpectAt(a, W.x, W.y, T.Wall, W.x, W.y, T.Wall);
    await sleep(100);
    result(pw.hit.length === 1 && pw.hit[0].tile === T.Wall, `(g) Wood Wall at (${W.x},${W.y}) placed`);
    const w1 = a.snap.wood;
    const pa = await placeExpectAt(a, W.x, W.y, T.ArcherPost, W.x, W.y, T.ArcherPost);
    await sleep(150);
    result(pa.hit.length === 0 && a.snap.wood >= w1,
      `(g) Archery Range on the Wall rejected: ${JSON.stringify(pa.hit.map((u) => u.tile))} (expected none); wood ${w1}->${a.snap.wood}`);
    const bw = await act(a, W.x, W.y, T.Empty);
    info(`(g) cleanup: broke wall -> ${JSON.stringify(bw.filter((u) => u.tileX === W.x && u.tileY === W.y).map((u) => u.tile))}; wood=${a.snap.wood}`);
  }
}

// ---------------- lumberjack tree growth (observational) ----------------
{
  // Replay the tile updates over the welcome map so each grown tree is judged against the posts that
  // stood at that moment (posts are placed and broken during the run).
  const POST_TILES = new Set([3, 4, 5, 6, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, ...Array.from({ length: 15 }, (_, i) => 20 + i), 49]);
  const replay = [...a.welcomeTiles];
  const W = a.W();
  const growth = [];
  const near = [];
  let ringOk = true;
  for (const u of a.tileUpdates) {
    if (u.tile === T.Tree) {
      growth.push(u);
      let nearPost = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (a.inBounds(u.tileX + dx, u.tileY + dy) && replay[(u.tileY + dy) * W + u.tileX + dx] === T.Lumberjack) nearPost = true;
      if (nearPost) {
        near.push(u);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (a.inBounds(u.tileX + dx, u.tileY + dy) && POST_TILES.has(replay[(u.tileY + dy) * W + u.tileX + dx])) ringOk = false;
      }
    }
    replay[u.tileY * W + u.tileX] = u.tile;
  }
  info(`lumberjack growth: ${growth.length} tree tileUpdates total during run, ${near.length} within 2 tiles of a lumberjack post standing at the time ${JSON.stringify(near.map((u) => [u.tileX, u.tileY]))}; none orthogonally adjacent to a then-standing post: ${ringOk}`);
  result(near.length > 0 && ringOk, `(extra) trees grew within the 2-tile radius of lumberjack posts, never on the ring touching a post`);
}

// ---------------- breaking the houses (observational, end of run) ----------------
if (siteA && (await ensureAt(a, siteA))) {
  const pop0 = a.snap.population;
  for (const H of [H1, H2]) {
    const bh = await act(a, H.x, H.y, T.Empty);
    await sleep(150);
    const bhu = bh.filter((u) => u.tileX === H.x && u.tileY === H.y);
    result(bhu.length === 1 && bhu[0].tile === T.Empty, `(extra) breaking the house at (${H.x},${H.y}) reverts straight to Empty`);
  }
  result(a.snap.populationCap === a.firstSnap.populationCap,
    `(extra) after breaking all houses populationCap=${a.snap.populationCap} (expected the Town Center base ${a.firstSnap.populationCap})`);
  info(`after losing all housing: population=${a.snap.population} (was ${pop0}) — existing civilians are NOT evicted (pop > cap)`);
}

info(`player deaths during run: ${a.deaths ?? 0}`);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
