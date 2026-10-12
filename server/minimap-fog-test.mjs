// Scripted test: the fog-of-war minimap's server side (explored tiles + the `explored` message).
//   A) Start: after a restart, welcome's packed `explored` bitset is exactly the starting disk (radius
//      VISION_RADIUS_START around the Town Center, clipped to the map): non-empty, contains the TC
//      and every tile within the radius, nothing else. In particular the Abbey (its clergy are not a
//      vision source) and the far corners are unexplored.
//   B) Walking: the player walks 15+ tiles out of the explored area. `explored` messages arrive, are
//      never empty, only hold in-range indices, and come at most ~4/s (>= ~200ms apart). Every tile
//      within VISION_RADIUS_PLAYER of each tile the player stood on (sampled each snapshot) ends up
//      explored, and tiles far from anything stay unexplored.
//   C) Never shrinks / server-authoritative: a second client connecting now gets a welcome whose
//      bitset is a superset of everything the first client accumulated (a page refresh keeps it).
//   D) Restart: a fresh welcome's bitset is back to exactly the starting disk.
// Sends "restart", which resets the world for every connected client: run it against a private
// server, e.g. `PORT=8091 npx tsx src/index.ts` in server/, then `PORT=8091 node minimap-fog-test.mjs`.
// Works at any world size (try COLONY_WORLD_SIZE=80 on the private server too). Runs ~30s.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`     [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;

// Mirrors of protocol.ts values used here.
const VISION_RADIUS_PLAYER = 10;
const VISION_RADIUS_START = 12;
const T = { AbbeyHall: 46 };

function unpack(b64, count) {
  const bytes = Buffer.from(b64, "base64");
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

function connect() {
  const c = {
    ws: new WebSocket(`ws://localhost:${PORT}`),
    welcome: null, welcomes: 0, welcomeBytes: 0, snap: null, tiles: null, explored: null,
    exploredMsgs: [], listeners: [],
  };
  c.ws.on("message", (raw) => {
    const text = raw.toString();
    const m = JSON.parse(text);
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomeBytes = text.length;
      c.tiles = m.tiles.slice();
      c.explored = unpack(m.explored, m.worldTilesX * m.worldTilesY);
      c.welcomeExplored = c.explored.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    } else if (m.type === "explored") {
      c.exploredMsgs.push({ at: Date.now(), tiles: m.tiles, bytes: text.length });
      for (const i of m.tiles) if (i >= 0 && i < c.explored.length) c.explored[i] = 1;
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      for (const fn of c.listeners.slice()) fn(m, prev);
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
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
const W = a.welcome.worldTilesX;
const H = a.welcome.worldTilesY;
const N = W * H;
const tc = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
const count = (set) => set.reduce((n, v) => n + v, 0);

function diskSet(cx, cy, r) {
  const out = new Uint8Array(N);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > r * r) continue;
    out[y * W + x] = 1;
  }
  return out;
}
const startDisk = diskSet(tc.x, tc.y, VISION_RADIUS_START);
const sameSet = (p, q) => p.every((v, i) => v === q[i]);

async function restart(c) {
  const before = c.welcomes;
  c.send({ type: "restart" });
  while (c.welcomes === before) await sleep(20);
  await c.nextSnap();
  await c.nextSnap();
  if (c.snap.isPaused) c.send({ type: "pause" });
  c.send({ type: "input", dx: 0, dy: 0 });
}

info(`world ${W}x${H}; packed bitset ${a.welcome.explored.length} chars (${Math.ceil(N / 8)} bytes raw), welcome ${a.welcomeBytes} chars total`);

// ---------------------------------------------------------------- A: start
await restart(a);
{
  const ex = a.welcomeExplored;
  result(count(ex) > 0, `A: welcome explored set is non-empty (${count(ex)} tiles)`);
  result(ex[tc.y * W + tc.x] === 1, `A: Town Center tile (${tc.x},${tc.y}) is explored`);
  result(sameSet(ex, startDisk), `A: welcome explored set is exactly the radius-${VISION_RADIUS_START} disk around the TC (${count(startDisk)} tiles)`);
  const corners = [0, W - 1, (H - 1) * W, N - 1];
  result(corners.every((i) => ex[i] === 0), "A: all four map corners unexplored");
  const hall = a.tiles.findIndex((t) => t === T.AbbeyHall);
  if (hall >= 0) {
    const hx = hall % W, hy = Math.floor(hall / W);
    const far = Math.hypot(hx - tc.x, hy - tc.y) > VISION_RADIUS_START + 2;
    result(!far || ex[hall] === 0, `A: Abbey hall (${hx},${hy}) unexplored at start (its clergy aren't vision sources)`);
  } else info("A: no Abbey on this map, skipped the clergy check");
}

// Let the player's own spawn vision flush, then start counting messages from a clean slate.
await sleep(600);
a.exploredMsgs.length = 0;

// ---------------------------------------------------------------- B: walking
const visited = new Map(); // tile index -> {x,y}
a.listeners.push((s) => {
  const t = tileOf(a.me(s));
  visited.set(t.y * W + t.x, t);
});

// Walk straight away from the TC; when blocked (tree, pond, building), sidestep at 90 degrees for a
// moment, alternating sides, then resume.
const distFromTc = () => { const t = tileOf(a.me()); return Math.hypot(t.x - tc.x, t.y - tc.y); };
const target = Math.min(VISION_RADIUS_START + 15, Math.min(W, H) / 2 - 3); // 15+ tiles past the start disk
let away = [1, 0.37]; // initial heading; replaced by "away from the TC" once we've left it
let lastPos = a.me();
let side = 1;
let sidestepUntil = 0;
const walkDeadline = Date.now() + 40000;
while (distFromTc() < target && Date.now() < walkDeadline) {
  const p = a.me();
  const vx = p.x - (tc.x + 0.5) * TILE, vy = p.y - (tc.y + 0.5) * TILE;
  const len = Math.hypot(vx, vy);
  if (len > TILE * 3) away = [vx / len, vy / len];
  let dir = away;
  if (Date.now() < sidestepUntil) dir = [-away[1] * side, away[0] * side];
  a.send({ type: "input", dx: dir[0], dy: dir[1] });
  await sleep(200);
  const q = a.me();
  if (Date.now() >= sidestepUntil && Math.hypot(q.x - lastPos.x, q.y - lastPos.y) < 3) {
    sidestepUntil = Date.now() + 700;
    side = -side;
  }
  lastPos = q;
}
a.send({ type: "input", dx: 0, dy: 0 });
await sleep(700); // > one flush period
const endT = tileOf(a.me());
result(distFromTc() >= target, `B: player walked to (${endT.x},${endT.y}), ${distFromTc().toFixed(1)} tiles from the TC (target ${target})`);

const msgs = a.exploredMsgs;
result(msgs.length > 0, `B: received ${msgs.length} explored messages while walking`);
result(msgs.every((m) => m.tiles.length > 0), "B: no empty explored message");
result(msgs.every((m) => m.tiles.every((i) => Number.isInteger(i) && i >= 0 && i < N)), "B: every explored index is in range");
const gaps = msgs.slice(1).map((m, i) => m.at - msgs[i].at);
const minGap = gaps.length ? Math.min(...gaps) : Infinity;
result(minGap >= 150, `B: explored messages batched (min gap ${minGap}ms, ~4/s expected)`);
let missing = 0;
for (const t of visited.values()) {
  const d = diskSet(t.x, t.y, VISION_RADIUS_PLAYER);
  for (let i = 0; i < N; i++) if (d[i] && !a.explored[i]) missing++;
}
result(missing === 0, `B: every tile within ${VISION_RADIUS_PLAYER} of all ${visited.size} visited tiles is explored (${missing} missing)`);
const endDisk = diskSet(endT.x, endT.y, VISION_RADIUS_PLAYER);
const newNearEnd = endDisk.reduce((n, v, i) => n + (v && !startDisk[i] ? 1 : 0), 0);
result(newNearEnd > 0 && endDisk.every((v, i) => !v || a.explored[i]), `B: ${newNearEnd} tiles around the end point, outside the start disk, are now explored`);
// A tile far from the TC, the walk, and every colonist (none exist besides the Abbey's) stays dark.
let farTile = -1;
for (let i = 0; i < N && farTile < 0; i++) {
  const x = i % W, y = Math.floor(i / W);
  if (Math.hypot(x - tc.x, y - tc.y) < VISION_RADIUS_START + 5) continue;
  if ([...visited.values()].some((t) => Math.hypot(x - t.x, y - t.y) < VISION_RADIUS_PLAYER + 5)) continue;
  farTile = i;
}
result(farTile >= 0 && a.explored[farTile] === 0, `B: far tile (${farTile % W},${Math.floor(farTile / W)}) stays unexplored`);
const bytes = msgs.map((m) => m.bytes);
info(`explored msgs: ${msgs.length}, ${msgs.reduce((n, m) => n + m.tiles.length, 0)} tiles, avg ${(bytes.reduce((x, y) => x + y, 0) / Math.max(1, bytes.length)).toFixed(0)} chars, max ${Math.max(0, ...bytes)} chars`);

// ---------------------------------------------------------------- C: persistence across a reconnect
{
  const b = connect();
  await b.ready();
  let lost = 0;
  for (let i = 0; i < N; i++) if (a.explored[i] && !b.welcomeExplored[i]) lost++;
  result(lost === 0, `C: a fresh connection's welcome holds every tile client A saw explored (${count(b.welcomeExplored)} >= ${count(a.explored)}, ${lost} lost)`);
  b.ws.close();
}

// ---------------------------------------------------------------- D: restart
await restart(a);
result(sameSet(a.welcomeExplored, startDisk), `D: after restart the welcome explored set is back to the starting disk (${count(a.welcomeExplored)} tiles)`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
