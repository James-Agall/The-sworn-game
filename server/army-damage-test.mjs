// Scripted test: army cluster synergy (armyDamageMultiplier). A guard's hit deals
// base damage x (1 + 0.05 per army building or Blacksmith in the 8 tiles around its own post).
// Black-box measurement: every snapshot's attack effects are matched exactly to their attacker (a colonist
// standing at effect.from) and target (the mob that stood at effect.to in the previous snapshot, since
// colonists act before mobs move within a tick). For every mob hit exactly once in a tick and still alive
// afterwards, the hp drop is that single hit's damage. Each measured hit is compared with
// base(kind) x multiplier(post) computed from the tiles around the attacker's post.
// Layout (s = standing tile; every guard post keeps its east side open, where its units spawn):
//   L  lone Knight Post at (s.x+2, s.y+1): no army building / Blacksmith adjacent -> x1.00 (12 dmg)
//   M  Militia Post (s.x-1, s.y-2), K Knight Post (s.x-1, s.y-1), A Archer Post (s.x-1, s.y) in a column,
//   Bs Blacksmith (s.x-2, s.y-1) west of K.  K: M + A + Bs -> x1.15 (13.8 dmg);
//   M: K + Bs (diagonal) -> x1.10; A: K + Bs (diagonal) -> x1.10.
// Runs through the first night (and the second if too few hits were measured).
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
const T = { Empty: 0, FarmPlot: 4, KnightPost: 5, ArcherPost: 6, Blacksmith: 26, MilitiaPost: 32 };
// Server isMilitaryTile: KnightPost, CastleLevel2/3, ArcherPost, MilitiaPost, MilitiaCamp2/3.
const MILITARY = new Set([5, 17, 18, 6, 32, 33, 34]);
const TILE = 32;
const BASE_DAMAGE = { knight: 12, militia: 6, archer: 8 }; // level-1 stats (KNIGHT_LEVEL_STATS[0], MILITIA_LEVEL_STATS[0], ARCHER_DAMAGE)

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, prev: null, tiles: [], tileUpdates: [], onSnap: null };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      c.prev = c.snap;
      c.snap = m;
      if (c.onSnap && c.prev) c.onSnap(c.prev, m);
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
  c.walkable = (x, y) => c.inBounds(x, y) && (c.tileAt(x, y) === T.Empty || c.tileAt(x, y) === T.FarmPlot);
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

// Nearest reachable tile whose 5x5 box is Empty, with no army building / Blacksmith within 4 tiles.
function findSite(c) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++)
      for (let dy = -2; dy <= 2 && ok; dy++) {
        const tx = x + dx, ty = y + dy;
        if (!c.inBounds(tx, ty) || c.tileAt(tx, ty) !== T.Empty) ok = false;
        else if ((dx || dy) && colonistOnTile(c, tx, ty)) ok = false;
      }
    for (let dx = -4; dx <= 4 && ok; dx++)
      for (let dy = -4; dy <= 4 && ok; dy++) {
        const t = c.inBounds(x + dx, y + dy) ? c.tileAt(x + dx, y + dy) : 0;
        if (MILITARY.has(t) || t === T.Blacksmith) ok = false;
      }
    if (ok && (!best || d < best.d)) best = { x, y, d };
  }
  return best;
}

// Server-equivalent: bonus accumulated with += 0.05 per qualifying neighbour, then 1 + bonus.
function armyMult(c, tx, ty) {
  let bonus = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (!c.inBounds(tx + dx, ty + dy)) continue;
    const t = c.tileAt(tx + dx, ty + dy);
    if (MILITARY.has(t) || t === T.Blacksmith) bonus += 0.05;
  }
  return 1 + bonus;
}

const kindClass = (k) => (k === "knight" ? "knight" : k === "archer" ? "archer" : k === "militia" ? "militia" : null);

const a = connect();
await a.ready();
info(`connected; wood=${a.snap.wood} iron=${a.snap.iron} rock=${a.snap.rock} mobs=${a.snap.mobs.length} night=${a.snap.isNight}`);

const s = findSite(a);
if (!s) {
  result(false, "no suitable empty site found");
  process.exit(1);
}
result(await ensureAt(a, s), `walked to site (${s.x},${s.y}) [${s.d} tiles]`);
const L = { x: s.x + 2, y: s.y + 1 };
const M = { x: s.x - 1, y: s.y - 2 };
const K = { x: s.x - 1, y: s.y - 1 };
const A = { x: s.x - 1, y: s.y };
const Bs = { x: s.x - 2, y: s.y - 1 };
result(await placeExpect(a, Bs.x, Bs.y, T.Blacksmith), `Blacksmith at (${Bs.x},${Bs.y})`);
result(await placeExpect(a, K.x, K.y, T.KnightPost), `clustered Knight Post K at (${K.x},${K.y})`);
result(await placeExpect(a, A.x, A.y, T.ArcherPost), `Archer Post A at (${A.x},${A.y})`);
result(await placeExpect(a, M.x, M.y, T.MilitiaPost), `Militia Post M at (${M.x},${M.y})`);
result(await placeExpect(a, L.x, L.y, T.KnightPost), `lone Knight Post L at (${L.x},${L.y})`);
await sleep(300);

const posts = { L, M, K, A };
const mults = Object.fromEntries(Object.entries(posts).map(([n, p]) => [n, armyMult(a, p.x, p.y)]));
info(`multipliers from tiles: ${Object.entries(mults).map(([n, m]) => `${n}=${m.toFixed(2)}`).join(" ")}`);
result(Math.abs(mults.L - 1) < 1e-9 && Math.abs(mults.K - 1.15) < 1e-9 && Math.abs(mults.M - 1.1) < 1e-9 && Math.abs(mults.A - 1.1) < 1e-9,
  `layout gives L x1.00, K x1.15 (2 army + Blacksmith), M x1.10, A x1.10`);
const postName = (px, py) => Object.entries(posts).find(([, p]) => p.x === px && p.y === py)?.[0] ?? null;

// ---- measure hits ----
const hits = []; // {post, kind, drop, expected, base}
const unmatched = { noAttacker: 0, noTarget: 0, multi: 0, killed: 0, foreign: 0, ambiguousTick: 0 };
a.onSnap = (prev, cur) => {
  if (!cur.effects?.length) return;
  const byMob = new Map();
  let ambiguousTick = false;
  for (const e of cur.effects) {
    const targets = prev.mobs.filter((m) => m.x === e.toX && m.y === e.toY);
    const fromColonist = cur.colonists.some((k) => k.x === e.fromX && k.y === e.fromY);
    // Mob attacks also produce effects (towards a colonist/player); only guard effects matter here. A guard
    // effect that can't be pinned to exactly one mob makes the whole tick ambiguous: skip it.
    if (targets.length !== 1) {
      unmatched.noTarget++;
      if (fromColonist) ambiguousTick = true;
      continue;
    }
    const target = targets[0];
    if (!byMob.has(target.id)) byMob.set(target.id, []);
    byMob.get(target.id).push(e);
  }
  if (ambiguousTick) { unmatched.ambiguousTick++; return; }
  for (const [mobId, effs] of byMob) {
    if (effs.length !== 1) { unmatched.multi++; continue; }
    const e = effs[0];
    // Exactly one colonist must stand at effect.from: units of different posts can overlap exactly.
    const attackers = cur.colonists.filter((k) => k.x === e.fromX && k.y === e.fromY);
    if (attackers.length !== 1) { unmatched.noAttacker++; continue; }
    const attacker = attackers[0];
    const post = postName(attacker.postX, attacker.postY);
    const cls = kindClass(attacker.kind);
    if (!post || !cls) { unmatched.foreign++; continue; }
    const before = prev.mobs.find((m) => m.id === mobId);
    const after = cur.mobs.find((m) => m.id === mobId);
    if (!after) { unmatched.killed++; continue; }
    const drop = before.hp - after.hp;
    const mult = armyMult(a, attacker.postX, attacker.postY);
    hits.push({ post, kind: attacker.kind, mob: before.kind, drop, base: BASE_DAMAGE[cls], expected: BASE_DAMAGE[cls] * mult, mult });
    if (Math.abs(drop - BASE_DAMAGE[cls] * mult) > 1e-6)
      info(`MISMATCH detail: effects=${JSON.stringify(cur.effects)} prevMobs@pos=${JSON.stringify(prev.mobs.filter((m) => Math.hypot(m.x - before.x, m.y - before.y) < 40))} curMob=${JSON.stringify(after)} attackers=${JSON.stringify(cur.colonists.filter((k) => cur.effects.some((e) => e.fromX === k.x && e.fromY === k.y)))}`);
  }
};

const enough = () => ["L", "K"].every((p) => hits.filter((h) => h.post === p && h.kind === "knight").length >= 3);
// Days are 300 s + 75 s nights now: skip (testHook setCycleTick, needs COLONY_TEST_HOOKS=1) to just before the
// day's midpoint, when the raid spawns; it then marches in to arrive at nightfall.
{
  const rs = await new Promise((resolve) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "testHookResult" && m.op === "raidState") { a.ws.off("message", onMsg); resolve(m); }
    };
    a.ws.on("message", onMsg);
    a.ws.send(JSON.stringify({ type: "testHook", op: "raidState" }));
  });
  if (rs.cycleTick < rs.dayTicks / 2 - 10) a.ws.send(JSON.stringify({ type: "testHook", op: "setCycleTick", tick: rs.dayTicks / 2 - 10 }));
}
const deadline = Date.now() + 700000;
for (let night = 1; night <= 2 && !enough() && Date.now() < deadline; night++) {
  while (!a.snap.isNight && Date.now() < deadline) await sleep(250);
  info(`night ${night} fell; mobs=${a.snap.mobs.length}`);
  while (a.snap.isNight && !enough() && Date.now() < deadline) await sleep(250);
  info(`night ${night} done/enough: hits so far ${hits.length}; per post ${JSON.stringify(Object.fromEntries(Object.keys(posts).map((p) => [p, hits.filter((h) => h.post === p).length])))}`);
}
a.onSnap = null;

for (const h of hits) info(`hit ${h.post} ${h.kind} -> ${h.mob}: drop ${h.drop.toFixed(4)} (expected ${h.expected.toFixed(4)} = ${h.base} x ${h.mult.toFixed(2)})`);
info(`skipped effects: ${JSON.stringify(unmatched)}`);
const bad = hits.filter((h) => Math.abs(h.drop - h.expected) > 1e-6);
result(hits.length > 0 && bad.length === 0, `all ${hits.length} isolated hits dealt exactly base x multiplier (mismatches: ${bad.length}${bad.length ? " " + JSON.stringify(bad.slice(0, 5)) : ""})`);
const lHits = hits.filter((h) => h.post === "L" && h.kind === "knight");
const kHits = hits.filter((h) => h.post === "K" && h.kind === "knight");
result(lHits.length > 0 && lHits.every((h) => Math.abs(h.drop - 12) < 1e-6), `lone knight (no army neighbours): ${lHits.length} hits, all 12 (${[...new Set(lHits.map((h) => +h.drop.toFixed(4)))]})`);
result(kHits.length > 0 && kHits.every((h) => Math.abs(h.drop - 13.8) < 1e-6), `clustered knight (Militia + Archer + Blacksmith adjacent): ${kHits.length} hits, all 13.8 = 12 x 1.15 (${[...new Set(kHits.map((h) => +h.drop.toFixed(4)))]})`);
const others = hits.filter((h) => h.post === "M" || h.post === "A");
if (others.length) info(`militia/archer hits: ${others.map((h) => `${h.post}:${+h.drop.toFixed(4)}`).join(" ")} (expected M 6.6, A 8.8)`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
