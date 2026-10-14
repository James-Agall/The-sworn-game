// Scripted test: food-variety farms, crafting buildings, Market, Gold Shop, gold-from-kills, house-tier goods gates,
// and restart reset of all new state. Self-contained: every phase begins with a `restart`, so it does not need a
// fresh server, but it does need to be the ONLY connected player (restart resets the world for everyone).
//
//   A: 4 houses (incl. gate-before: House next to House stays a fresh House), 4 farms -> meat/fruit/wool/cotton,
//      pop-gate rejection at full pop, same-type placement ON the building upgrades in place at full pop.
//   B: Market (exchange rejected before, accepted after), Blacksmith artisan: tools +1 / iron -1 / wood -1 atomically,
//      stalls with wood=0 (state stays "crafting", tools frozen), resumes after replenishing via the Market.
//   C: night mob kills -> gold per kill = goldForKill(mob); buy rejected before Gold Shop; buy after; buy rejected on insufficient gold.
//   D: lumberjacks for wood over day 1, then Barn+plot (grain), 4 farms, Tailor (clothes), House -> BigHouse upgrade
//      with exact goods deduction.
//   Final: restart clears everything.
// Current-server notes: restart stock is wood 80 / iron 60 / rock 60 / grain 40; the Town Center alone gives a
// population cap of 10 (+ houses + neighbourhood pairs), so "full population" is reached with filler Lumberjack
// Posts at a separate site; gold per kill scales with the mob (goldForKill). Saint Wren's Abbey clergy
// (world-gen bishops posted at the AbbeyHall) are not the colony's: they are filtered out of every snapshot's
// `colonists` (kept in `clergy`), exactly as the server's population does. Run with COLONY_WORLD_SIZE=80.
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
  Pasture: 21, Orchard: 22, WoolFarm: 23, CottonFarm: 24, TailorShop: 25, Blacksmith: 26, LuxuryWorkshop: 27,
  Market: 28, GoldShop: 29,
};
const ABBEY_HALL = 46;
// Every tile type the server treats as solid (protocol.ts isSolidTile): 1..49 except FarmPlot (4),
// which includes world-gen water, ruins, encampment props, the Abbey and Ward Stones.
const SOLID = new Set(Array.from({ length: 49 }, (_, i) => i + 1).filter((t) => t !== 4));
const TILE = 32;
const PLAYER_ATTACK_RANGE = TILE * 1.3;
const RES_KEYS = ["wood", "iron", "rock", "grain", "meat", "fruit", "wool", "cotton", "clothes", "tools", "luxuryItems", "gold"];
const RESET_VALUES = { wood: 80, iron: 60, rock: 60, grain: 40, meat: 0, fruit: 0, wool: 0, cotton: 0, clothes: 0, tools: 0, luxuryItems: 0, gold: 0 };

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: [], tileUpdates: [], events: [], onSnap: null };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const isClergy = (k) => c.tiles[k.postY * c.welcome.worldTilesX + k.postX] === ABBEY_HALL;
      m.clergy = m.colonists.filter(isClergy);
      m.colonists = m.colonists.filter((k) => !isClergy(k));
      m.at = Date.now();
      const prev = c.snap;
      c.snap = m;
      if (c.onSnap && prev) c.onSnap(prev, m);
    } else if (m.type === "event") {
      c.events.push({ ...m, at: Date.now() });
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
const atPost = (c, kind, p) => c.snap.colonists.filter((k) => k.kind === kind && k.postX === p.x && k.postY === p.y);

async function act(c, x, y, tile, waitMs = 400) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.at >= since);
}

// Placement expected to produce a tileUpdate at (expectX, expectY); retries while a walking colonist blocks the tile.
async function placeExpectAt(c, x, y, tile, expectX = x, expectY = y, tries = 6) {
  for (let i = 0; i < tries; i++) {
    for (let w = 0; w < 50 && colonistOnTile(c, x, y); w++) await sleep(100);
    const ups = await act(c, x, y, tile);
    const hit = ups.filter((u) => u.tileX === expectX && u.tileY === expectY);
    if (hit.length) return { ups, hit };
    await sleep(300);
  }
  return { ups: [], hit: [] };
}

async function waitFor(c, pred, timeoutMs) {
  const since = Date.now();
  while (Date.now() - since < timeoutMs) {
    if (pred(c.snap)) return true;
    await sleep(50);
  }
  return pred(c.snap);
}

// Standing tile whose 5x5 box is entirely Empty and unoccupied (gives 16 placeable in-reach tiles that are not
// orthogonally adjacent to the player).
function findSite(c, avoid = [], minDist = 0) {
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

async function gotoSite(c, label) {
  const s = findSite(c);
  if (!s) {
    result(false, `${label} no 5x5 empty site reachable`);
    return null;
  }
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

// populationCap(): Town Center base 10 + 1/3/5 per House/BigHouse/HouseLevel2 + neighbourhood bonus (+1 per
// 8-neighbour pair of house/house, counted once, or house/workplace-or-unit building).
const HOUSE_CAP = { 13: 1, 14: 3, 15: 5 };
const SYNERGY_BUILDINGS = new Set([3, 16, 9, 10, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 49, 5, 17, 18, 6, 19, 32, 33, 34]);
function expectedCap(c) {
  let cap = 10;
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

// First tile in `list` that is currently Empty with no colonist on it.
const pickEmpty = (c, list) => list.find((p) => c.tileAt(p.x, p.y) === T.Empty && !colonistOnTile(c, p.x, p.y));

const fmt = (s) => RES_KEYS.map((k) => `${k}=${s[k]}`).join(" ");

async function restartAndCheck(c, label) {
  const w0 = c.welcomes;
  c.send({ type: "restart" });
  await waitFor(c, () => c.welcomes > w0, 3000);
  await sleep(300); // a few post-restart snapshots
  const s = c.snap;
  const bad = RES_KEYS.filter((k) => s[k] !== RESET_VALUES[k]);
  result(bad.length === 0, `${label} restart resets all 12 resources (${fmt(s)})${bad.length ? " MISMATCH: " + bad.join(",") : ""}`);
  result(s.marketBuilt === false && s.goldShopBuilt === false, `${label} restart resets marketBuilt=${s.marketBuilt} goldShopBuilt=${s.goldShopBuilt}`);
  const fa = s.colonists.filter((k) => k.kind === "farmhand" || k.kind === "artisan");
  result(s.colonists.length === 0 && fa.length === 0, `${label} restart leaves no colony colonists (total=${s.colonists.length}, farmhand/artisan=${fa.length})`);
  // The only colonists a fresh world has are Saint Wren's Abbey's three world-gen clergy (none if no Abbey fit).
  const hasAbbey = c.tiles.includes(ABBEY_HALL);
  result(s.clergy.length === (hasAbbey ? 3 : 0) && s.clergy.every((k) => k.kind === "bishop"),
    `${label} restart: only the Abbey's world-gen clergy remain (${s.clergy.length} bishops at the AbbeyHall, expected ${hasAbbey ? 3 : 0})`);
  result(s.food === undefined, `${label} snapshot no longer carries retired 'food' field (food=${s.food})`);
}

const a = connect();
await a.ready();
info(`connected; players=${a.snap.players.length}`);
if (a.snap.players.length !== 1) info("WARNING: other players connected; restart will affect them");

// Auto-defend: whenever a mob is within melee range, swing. Runs for the whole test (mobs only exist at night).
const defend = setInterval(() => {
  if (!a.snap) return;
  const me = a.me();
  if (!me) return;
  if (a.snap.mobs.some((m) => Math.hypot(m.x - me.x, m.y - me.y) <= PLAYER_ATTACK_RANGE)) a.send({ type: "attack" });
}, 100);

// =============== Phase A: farms ===============
await restartAndCheck(a, "(A0)");
{
  const s = await gotoSite(a, "(A)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    const H1 = P(-2, 0), H2 = P(-2, -1), H3 = P(2, 0), H4 = P(2, -1);
    let r = await placeExpectAt(a, H1.x, H1.y, T.House);
    result(r.hit[0]?.tile === T.House, `(A) House H1 placed at (${H1.x},${H1.y})`);
    // (d) gate BEFORE: no goods -> adjacent House is a fresh standalone House; H1 stays a House.
    const woodBefore = a.snap.wood;
    r = await placeExpectAt(a, H2.x, H2.y, T.House);
    const h1Changed = r.ups.some((u) => u.tileX === H1.x && u.tileY === H1.y);
    result(r.hit[0]?.tile === T.House && !h1Changed && a.tileAt(H1.x, H1.y) === T.House,
      `(d-before) House placed next to House with 0 goods -> fresh House at (${H2.x},${H2.y}); H1 still House (tile=${a.tileAt(H1.x, H1.y)}); wood ${woodBefore}->${a.snap.wood}`);
    await placeExpectAt(a, H3.x, H3.y, T.House);
    await placeExpectAt(a, H4.x, H4.y, T.House);
    await sleep(150);
    // Cap = Town Center base 10 + 4 houses + neighbourhood pairs (H1/H2 and H3/H4 touch); 4 x 10 wood spent.
    result(a.snap.populationCap === expectedCap(a) && a.snap.populationCap === 16 && a.snap.wood === 80 - 40,
      `(A) 4 houses: popCap=${a.snap.populationCap} (expected ${expectedCap(a)} = 10 + 4 + 2 house pairs) wood=${a.snap.wood} (expected 40)`);

    const farms = [
      { name: "Pasture", tile: T.Pasture, pos: P(0, -2), res: "meat" },
      { name: "Orchard", tile: T.Orchard, pos: P(0, 2), res: "fruit" },
      { name: "WoolFarm", tile: T.WoolFarm, pos: P(-1, 1), res: "wool" },
      { name: "CottonFarm", tile: T.CottonFarm, pos: P(1, 1), res: "cotton" },
    ];
    const firstChange = {};
    a.onSnap = (prev, next) => {
      for (const f of farms) {
        if (firstChange[f.res] === undefined && next[f.res] !== prev[f.res]) firstChange[f.res] = { from: prev[f.res], to: next[f.res], at: Date.now() };
      }
    };
    const placedAt = {};
    for (const f of farms) {
      const rr = await placeExpectAt(a, f.pos.x, f.pos.y, f.tile);
      placedAt[f.res] = Date.now();
      await sleep(100);
      const fh = atPost(a, "farmhand", f.pos);
      const onPost = fh[0] && Math.floor(fh[0].x / TILE) === f.pos.x && Math.floor(fh[0].y / TILE) === f.pos.y;
      result(rr.hit[0]?.tile === f.tile && fh.length === 1 && onPost,
        `(a/b) ${f.name} placed -> ${fh.length} farmhand at its post, standing on post tile=${!!onPost}, state=${fh[0]?.state}`);
    }
    const allProduced = await waitFor(a, (sn) => farms.every((f) => sn[f.res] >= 1), 8000);
    for (const f of farms) {
      const fc = firstChange[f.res];
      const dt = fc ? ((fc.at - placedAt[f.res]) / 1000).toFixed(2) : "n/a";
      result(!!fc && fc.from === 0 && fc.to === 1, `(a/b) ${f.name} -> ${f.res} first increment ${fc?.from}->${fc?.to} after ${dt}s (CHOP_TICKS=2s)`);
    }
    result(allProduced, `(a/b) all four farm resources produced: ${farms.map((f) => `${f.res}=${a.snap[f.res]}`).join(" ")}`);
    a.onSnap = null;
    const states = kinds(a, "farmhand").map((k) => k.state);
    result(states.length === 4 && states.every((st) => st === "farming"), `(a/b) farmhand states: ${states.join(",")}`);
    result(a.snap.population === 4 && a.snap.populationCap === expectedCap(a),
      `(A) population ${a.snap.population}/${a.snap.populationCap} (expected 4 / ${expectedCap(a)}: farms beside houses add neighbourhood pairs)`);

    // Reach full population: fill the remaining slots with filler Lumberjack Posts at a separate site.
    const fillers = await fillPopulationToCap(a, "(A)", [s], 12);
    const fullPop = a.snap.population;
    result(fullPop === a.snap.populationCap && kinds(a, "farmhand").length === 4,
      `(A) population filled to the cap: ${fullPop}/${a.snap.populationCap} (4 farmhands + ${fillers.length} fillers)`);
    await ensureAt(a, s);

    // Pop gate: a 5th non-adjacent farm at full population is rejected.
    const X = P(1, -1);
    let ups = await act(a, X.x, X.y, T.Orchard);
    result(!ups.some((u) => u.tileX === X.x && u.tileY === X.y) && kinds(a, "farmhand").length === 4,
      `(A) population-gated: 5th farm (Orchard at (${X.x},${X.y}), not next to an Orchard) rejected at full pop`);
    // Same-type placement ON the existing building at full pop upgrades it in place (no tileUpdate, no new worker).
    const U = P(0, -2); // the Pasture itself
    const evSince = Date.now();
    ups = await act(a, U.x, U.y, T.Pasture);
    const upEv = a.events.filter((e) => e.at >= evSince && e.category === "upgrade").map((e) => e.text);
    result(!ups.some((u) => u.tileX === U.x && u.tileY === U.y) && a.tileAt(U.x, U.y) === T.Pasture && kinds(a, "farmhand").length === 4 && a.snap.population === fullPop &&
      upEv.includes("Pasture upgraded to level 2"),
      `(A) Pasture placed ON the Pasture at full pop -> in-place upgrade (tile ${a.tileAt(U.x, U.y)}, farmhands=${kinds(a, "farmhand").length}, pop=${a.snap.population}, events=${JSON.stringify(upEv)})`);
    // Placed on an empty tile next to a Pasture it is a new standalone building, so it is population-gated.
    const N = P(1, -2);
    ups = await act(a, N.x, N.y, T.Pasture);
    result(!ups.some((u) => u.tileX === N.x && u.tileY === N.y) && kinds(a, "farmhand").length === 4,
      `(A) Pasture on an empty tile next to a Pasture at full pop is a new building and rejected (farmhands=${kinds(a, "farmhand").length})`);
  }
}

// =============== Phase B: Market + Blacksmith ===============
await restartAndCheck(a, "(B0)");
{
  const s = await gotoSite(a, "(B)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    // (f) exchange before Market exists -> rejected.
    let w0 = a.snap.wood, i0 = a.snap.iron;
    a.send({ type: "exchangeResource", from: "wood", to: "iron" });
    await sleep(300);
    result(a.snap.wood === w0 && a.snap.iron === i0 && !a.snap.marketBuilt,
      `(f) exchange before Market rejected (wood ${w0}->${a.snap.wood}, iron ${i0}->${a.snap.iron})`);

    await placeExpectAt(a, s.x - 2, s.y, T.House);
    const M = P(2, 0);
    w0 = a.snap.wood;
    let r = await placeExpectAt(a, M.x, M.y, T.Market);
    await sleep(100);
    result(r.hit[0]?.tile === T.Market && a.snap.marketBuilt === true && a.snap.wood === w0 - 15 && a.snap.colonists.length === 0,
      `(f) Market placed: marketBuilt=${a.snap.marketBuilt}, wood ${w0}->${a.snap.wood} (-15), no worker spawned (colonists=${a.snap.colonists.length}), pop=${a.snap.population}`);

    w0 = a.snap.wood; i0 = a.snap.iron;
    a.send({ type: "exchangeResource", from: "wood", to: "iron" });
    await sleep(300);
    result(a.snap.wood === w0 - 3 && a.snap.iron === i0 + 1, `(f) exchange wood->iron: wood ${w0}->${a.snap.wood} (-3), iron ${i0}->${a.snap.iron} (+1)`);
    let k0 = a.snap.rock; i0 = a.snap.iron;
    a.send({ type: "exchangeResource", from: "iron", to: "rock" });
    await sleep(300);
    result(a.snap.iron === i0 - 2 && a.snap.rock === k0 + 1, `(f) exchange iron->rock: iron ${i0}->${a.snap.iron} (-2), rock ${k0}->${a.snap.rock} (+1)`);
    i0 = a.snap.iron;
    a.send({ type: "exchangeResource", from: "wood", to: "wood" });
    await sleep(300);
    result(a.snap.iron === i0, `(f) exchange wood->wood rejected`);

    // (c) Blacksmith. Restart wood is 80 now: trade it down at the Market (3 wood -> 1 iron) to 12-14 so the
    // Blacksmith (10 wood) leaves only a few wood to craft with and the stall can be observed.
    while (a.snap.wood >= 15) {
      const wb = a.snap.wood;
      a.send({ type: "exchangeResource", from: "wood", to: "iron" });
      if (!(await waitFor(a, (sn) => sn.wood !== wb, 2000))) break;
    }
    info(`(c) traded wood down to ${a.snap.wood} (iron ${a.snap.iron}) before building the Blacksmith`);
    const B = P(0, -2);
    w0 = a.snap.wood; i0 = a.snap.iron;
    const toolEvents = [];
    a.onSnap = (prev, next) => {
      if (next.tools !== prev.tools) toolEvents.push({ dTools: next.tools - prev.tools, dWood: next.wood - prev.wood, dIron: next.iron - prev.iron, at: Date.now() });
    };
    r = await placeExpectAt(a, B.x, B.y, T.Blacksmith);
    const placedAt = Date.now();
    await sleep(100);
    const art = atPost(a, "artisan", B);
    result(r.hit[0]?.tile === T.Blacksmith && art.length === 1 && a.snap.population === 1,
      `(c) Blacksmith placed: artisan spawned=${art.length} state=${art[0]?.state} pop=${a.snap.population}; cost wood ${w0}->${a.snap.wood} iron ${i0}->${a.snap.iron}`);
    result(a.snap.wood === w0 - 10 && a.snap.iron === i0 - 5, `(c) Blacksmith cost exactly 10 wood + 5 iron`);
    const woodAfterBuild = a.snap.wood; // expected 2-4 -> makes that many tools then stalls
    info(`(c) wood after build = ${woodAfterBuild}, iron = ${a.snap.iron}, isNight=${a.snap.isNight}`);
    const gotFirst = await waitFor(a, (sn) => sn.tools >= 1, 12000);
    const e1 = toolEvents[0];
    result(gotFirst && e1 && e1.dTools === 1 && e1.dWood === -1 && e1.dIron === -1,
      `(c) first tool after ${e1 ? ((e1.at - placedAt) / 1000).toFixed(2) : "n/a"}s (CRAFT_TICKS=4s): in ONE snapshot tools +${e1?.dTools}, wood ${e1?.dWood}, iron ${e1?.dIron}`);
    await waitFor(a, (sn) => sn.wood === 0, 30000);
    await sleep(200);
    const toolsAtStall = a.snap.tools;
    result(a.snap.wood === 0 && toolsAtStall === woodAfterBuild && toolEvents.every((e) => e.dTools === 1 && e.dWood === -1 && e.dIron === -1),
      `(c) wood drained to 0 by crafting; tools=${toolsAtStall}; every tool event was atomic +1/-1/-1 (${toolEvents.length} events)`);
    // Exchange with insufficient wood is rejected.
    i0 = a.snap.iron;
    a.send({ type: "exchangeResource", from: "wood", to: "iron" });
    await sleep(200);
    result(a.snap.wood === 0 && a.snap.iron === i0, `(f) exchange wood->iron with wood=0 rejected (iron ${i0}->${a.snap.iron})`);
    // Stall window: > CRAFT_TICKS with no tools change, artisan stays at post in "crafting".
    const stallStates = new Set();
    let nightDuringStall = false;
    const stallEnd = Date.now() + 6000;
    while (Date.now() < stallEnd) {
      const ar = atPost(a, "artisan", B)[0];
      if (ar) stallStates.add(ar.state);
      if (a.snap.isNight) nightDuringStall = true;
      await sleep(100);
    }
    result(a.snap.tools === toolsAtStall && [...stallStates].join() === "crafting" && !nightDuringStall,
      `(c) stalled 6s (> CRAFT_TICKS) with wood=0: tools ${toolsAtStall}->${a.snap.tools}, artisan states=${[...stallStates].join(",")}, night during window=${nightDuringStall}`);
    // Replenish wood via the Market (iron->wood 3:1) -> artisan resumes.
    i0 = a.snap.iron;
    const nEvents = toolEvents.length;
    a.send({ type: "exchangeResource", from: "iron", to: "wood" });
    await sleep(300);
    result(a.snap.wood === 1 && a.snap.iron === i0 - 3, `(f) exchange iron->wood: iron ${i0}->${a.snap.iron} (-3), wood 0->${a.snap.wood}`);
    const resumed = await waitFor(a, (sn) => sn.tools === toolsAtStall + 1, 12000);
    const eR = toolEvents[nEvents];
    result(resumed && eR && eR.dTools === 1 && eR.dWood === -1 && eR.dIron === -1 && a.snap.wood === 0,
      `(c) after replenish: tools ${toolsAtStall}->${a.snap.tools} (+1, wood ${eR?.dWood}, iron ${eR?.dIron}), wood back to ${a.snap.wood}`);
    a.onSnap = null;
  }
}

// =============== Phase C: gold from kills + Gold Shop ===============
await restartAndCheck(a, "(C0)");
{
  const s = await gotoSite(a, "(C)");
  if (s) {
    // Gold per kill is no longer a flat 5: goldForKill = max(3, round((maxHp + 2 x damage) / 8)), from the
    // mob's maxHp (in the snapshot) and its kind's damage (MOB_KIND_CONFIG).
    const MOB_DAMAGE = {
      goblin: 4, wolf: 6, goblinCrossbow: 6, orc: 10, skeleton: 8, armoredOrc: 14, giantSpider: 7, darkShaman: 12,
      troll: 16, ogre: 28, banditClubman: 7, banditArcher: 8, banditElite: 14, halfLatch: 3,
    };
    const goldFor = (m) => Math.max(3, Math.round((m.maxHp + 2 * MOB_DAMAGE[m.kind]) / 8));
    let kills = 0, goldGained = 0, goldExpected = 0, mismatches = 0;
    a.onSnap = (prev, next) => {
      const ids = new Set(next.mobs.map((m) => m.id));
      const died = prev.mobs.filter((m) => !ids.has(m.id));
      const dGold = next.gold - prev.gold;
      const exp = died.reduce((sum, m) => sum + goldFor(m), 0);
      kills += died.length;
      goldGained += dGold;
      goldExpected += exp;
      if (dGold !== exp) mismatches++;
    };
    info(`(e) waiting for night + mob kills (isNight=${a.snap.isNight})...`);
    // Day is 60s, night 40s: allow up to two nights of kills.
    const gotGold = await waitFor(a, (sn) => sn.gold >= 15, 200000);
    await sleep(200);
    a.onSnap = null;
    result(gotGold && kills > 0 && goldGained === goldExpected && mismatches === 0,
      `(e) live kills: ${kills} mobs died, gold +${goldGained} (expected +${goldExpected} = sum of max(3, round((maxHp + 2 x damage) / 8))); per-snapshot mismatches=${mismatches}`);

    // (g) buy before Gold Shop exists (with enough gold) -> rejected.
    let g0 = a.snap.gold, t0_ = a.snap.tools;
    a.send({ type: "buyWithGold", item: "tools" });
    await sleep(300);
    result(a.snap.gold === g0 && a.snap.tools === t0_ && !a.snap.goldShopBuilt,
      `(g) buyWithGold before Gold Shop rejected with gold=${g0} (gold ->${a.snap.gold}, tools ->${a.snap.tools})`);

    // Re-centre if a fight moved us, then build the shop.
    await ensureAt(a, s);
    const G = { x: s.x + 2, y: s.y };
    const w0 = a.snap.wood;
    const r = await placeExpectAt(a, G.x, G.y, T.GoldShop);
    await sleep(100);
    result(r.hit[0]?.tile === T.GoldShop && a.snap.goldShopBuilt === true && a.snap.wood === w0 - 15,
      `(g) Gold Shop placed: goldShopBuilt=${a.snap.goldShopBuilt}, wood ${w0}->${a.snap.wood} (-15), pop=${a.snap.population}`);

    // Pause so a stray kill can't move gold during the exact-delta checks (pause doesn't block message handlers).
    a.send({ type: "pause" });
    await waitFor(a, (sn) => sn.isPaused, 2000);
    g0 = a.snap.gold; t0_ = a.snap.tools;
    a.send({ type: "buyWithGold", item: "tools" });
    await sleep(300);
    result(a.snap.gold === g0 - 10 && a.snap.tools === t0_ + 1, `(g) buy tools: gold ${g0}->${a.snap.gold} (-10), tools ${t0_}->${a.snap.tools} (+1)`);
    // Spend down with wood (5 gold -> 5 wood) until gold < 5, then confirm the next buy is rejected.
    while (a.snap.gold >= 5) {
      const gb = a.snap.gold, wb = a.snap.wood;
      a.send({ type: "buyWithGold", item: "wood" });
      await sleep(250);
      if (a.snap.gold !== gb - 5 || a.snap.wood !== wb + 5) {
        result(false, `(g) buy wood: gold ${gb}->${a.snap.gold}, wood ${wb}->${a.snap.wood}`);
        break;
      }
    }
    result(true, `(g) bought wood until gold=${a.snap.gold} (each buy exactly -5 gold / +5 wood)`);
    g0 = a.snap.gold;
    const wb = a.snap.wood;
    a.send({ type: "buyWithGold", item: "wood" });
    a.send({ type: "buyWithGold", item: "luxuryItems" });
    await sleep(300);
    result(a.snap.gold === g0 && a.snap.wood === wb && a.snap.luxuryItems === 0,
      `(g) buy with insufficient gold (${g0}) rejected for wood and luxuryItems`);
    a.send({ type: "pause" });
    await waitFor(a, (sn) => !sn.isPaused, 2000);
  }
}

// =============== Phase D: House -> BigHouse with goods ===============
await restartAndCheck(a, "(D0)");
{
  const s = await gotoSite(a, "(D)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    const H1 = P(-2, 0), H2 = P(-2, -1);
    const L1 = P(0, -2), L2 = P(0, 2);
    const spare = [P(2, 0), P(2, 1), P(2, -1), P(1, 1), P(-1, 1), P(1, -1), P(-1, -1), P(1, 2), P(-1, 2), P(2, 2)];
    await placeExpectAt(a, H1.x, H1.y, T.House);
    await placeExpectAt(a, H2.x, H2.y, T.House);
    await placeExpectAt(a, L1.x, L1.y, T.Lumberjack);
    await placeExpectAt(a, L2.x, L2.y, T.Lumberjack);
    info(`(D) 2 houses + 2 lumberjacks; wood=${a.snap.wood}; banking wood (need 45) — spans a night`);
    const enoughWood = await waitFor(a, (sn) => sn.wood >= 45 && !sn.isNight, 110000);
    info(`(D) wood=${a.snap.wood} isNight=${a.snap.isNight} enough=${enoughWood}`);
    await ensureAt(a, s);
    await placeExpectAt(a, L1.x, L1.y, T.Empty);
    await placeExpectAt(a, L2.x, L2.y, T.Empty);
    const H3 = pickEmpty(a, spare);
    await placeExpectAt(a, H3.x, H3.y, T.House); // goods still 0 -> plain cap house
    const Barn = P(0, -2), Plot = P(1, -2);
    await placeExpectAt(a, Barn.x, Barn.y, T.Barn);
    await placeExpectAt(a, Plot.x, Plot.y, T.FarmPlot);
    info(`(D) pop ${a.snap.population}/${a.snap.populationCap}, wood=${a.snap.wood}`);
    // Pasture + Orchard in the two free slots.
    const F1 = P(0, 2), F2 = pickEmpty(a, spare.filter((p) => !(p.x === H3.x && p.y === H3.y)));
    info(`(D) H3=(${H3.x},${H3.y}) F2=(${F2.x},${F2.y}) pop ${a.snap.population}/${a.snap.populationCap}`);
    await placeExpectAt(a, F1.x, F1.y, T.Pasture);
    await placeExpectAt(a, F2.x, F2.y, T.Orchard);
    await waitFor(a, (sn) => sn.meat >= 2 && sn.fruit >= 2, 60000);
    await placeExpectAt(a, F1.x, F1.y, T.Empty);
    await placeExpectAt(a, F2.x, F2.y, T.Empty);
    await placeExpectAt(a, F1.x, F1.y, T.WoolFarm);
    await placeExpectAt(a, F2.x, F2.y, T.CottonFarm);
    await waitFor(a, (sn) => sn.wool >= 2 && sn.cotton >= 2, 60000);
    await placeExpectAt(a, F1.x, F1.y, T.Empty);
    await placeExpectAt(a, F2.x, F2.y, T.Empty);
    const wool0 = a.snap.wool, cotton0 = a.snap.cotton;
    const clothEvents = [];
    a.onSnap = (prev, next) => {
      if (next.clothes !== prev.clothes) clothEvents.push({ d: next.clothes - prev.clothes, dW: next.wool - prev.wool, dC: next.cotton - prev.cotton });
    };
    const r = await placeExpectAt(a, F1.x, F1.y, T.TailorShop);
    await sleep(100);
    result(r.hit[0]?.tile === T.TailorShop && atPost(a, "artisan", F1).length === 1, `(D) Tailor Shop placed, artisan spawned`);
    await waitFor(a, (sn) => sn.clothes >= 2 && sn.grain >= 1, 60000);
    a.onSnap = null;
    result(clothEvents.length >= 2 && clothEvents.every((e) => e.d === 1 && e.dW === -1 && e.dC === -1),
      `(D) Tailor: ${clothEvents.length} clothes made, each atomic +1 clothes / -1 wool / -1 cotton (wool ${wool0}->${a.snap.wool}, cotton ${cotton0}->${a.snap.cotton})`);
    // Freeze the world so grain/clothes/consumption can't move between the before/after reads.
    a.send({ type: "pause" });
    await waitFor(a, (sn) => sn.isPaused, 2000);
    const b = { ...a.snap };
    info(`(d) goods before upgrade: grain=${b.grain} meat=${b.meat} fruit=${b.fruit} clothes=${b.clothes} wood=${b.wood} isNight=${b.isNight}`);
    const ups = await act(a, H1.x, H1.y, T.House, 400);
    const up = ups.find((u) => u.tile === T.BigHouse);
    const nAfter = a.snap;
    result(!!up && up.tileX === H1.x && up.tileY === H1.y && !ups.some((u) => u.tile === T.House),
      `(d-after) House placed ON H1 with goods -> H1 (${H1.x},${H1.y}) upgraded to BigHouse in place; no new House tile written`);
    result(nAfter.grain === b.grain - 1 && nAfter.meat === b.meat - 1 && nAfter.fruit === b.fruit - 1 && nAfter.clothes === b.clothes - 2 && nAfter.wood === b.wood - 10,
      `(d-after) deductions: grain ${b.grain}->${nAfter.grain} (-1), meat ${b.meat}->${nAfter.meat} (-1), fruit ${b.fruit}->${nAfter.fruit} (-1), clothes ${b.clothes}->${nAfter.clothes} (-2), wood ${b.wood}->${nAfter.wood} (-10 flat House cost)`);
    a.send({ type: "pause" });
    await waitFor(a, (sn) => !sn.isPaused, 2000);
    // Leave a farmhand alive for the final reset check.
    await placeExpectAt(a, F2.x, F2.y, T.Pasture);
    await sleep(200);
    info(`(D) end state: ${fmt(a.snap)} marketBuilt=${a.snap.marketBuilt} goldShopBuilt=${a.snap.goldShopBuilt} farmhands=${kinds(a, "farmhand").length} artisans=${kinds(a, "artisan").length}`);
  }
}

// =============== Final: restart clears everything ===============
await restartAndCheck(a, "(h)");

clearInterval(defend);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
