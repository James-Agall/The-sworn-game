// Scripted test: the single roaming Ward Priest who tends every Ward Stone.
//   A) Setup: a Lumberjack + 2 Blacksmiths stock 20 tools and enough wood (smiths then demolished).
//   B) Church gate: with no Church anywhere, a Ward Stone placement is a silent no-op (tile stays
//      Empty, no wood/tools spent).
//   C) Never-tended stone isn't warded: Church + Ward Stone S1 -> a Ward Priest (bishop, post = S1)
//      spawns next to the Church, not at the stone. The Church is demolished before he can finish a
//      10s tending, which dismisses him (no Church). S1 was never tended, so it was never warded:
//      no halfLatch for 65s (> the 60s grace). No priest reappears and S2 can't be placed meanwhile.
//   D) Rebuilt Church -> exactly one priest again, at the Church. S2 placed apart from S1: still one
//      priest (only the Church bishop besides him). Over ~50s he alternates S1 <-> S2: "patrolling"
//      between them, "warding" within 1.5 tiles of a stone for ~10s (WARD_TEND_TICKS = 200 ticks)
//      before moving on. Not commandable: a live commandMove is ignored.
//   E) Neglect lapse: demolish the Church -> the priest is dismissed, and each stone lapses exactly
//      WARD_GRACE_TICKS (1200) ticks after he last finished tending it: one halfLatch at its tile
//      center, at that tick, and never a second one.
// Sends "restart" first, which resets the world for every connected client. Runs ~5-7 minutes.
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
const TICK_RATE = 20;
const WARD_TEND_TICKS = TICK_RATE * 10;
const WARD_GRACE_TICKS = TICK_RATE * 60;

// Mirrors of protocol.ts values used here.
const T = { Empty: 0, LumberjackPost: 3, ChurchPost: 20, Blacksmith: 26, WardStone: 49 };

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
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
const W = () => a.welcome.worldTilesX;
const H = () => a.welcome.worldTilesY;
const tileAt = (x, y) => a.tiles[y * W() + x];
const inB = (x, y) => x >= 0 && y >= 0 && x < W() && y < H();
const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
const center = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const same = (p, q) => p.x === q.x && p.y === q.y;
const adj8 = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) <= 1;
const setTile = (t, tile) => a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile });
const waitFor = async (pred, ms) => {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await sleep(50);
  return pred();
};

{
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.nextSnap();
  await a.nextSnap();
  if (a.snap.isPaused) a.send({ type: "pause" });
  a.send({ type: "input", dx: 0, dy: 0 });
}
const guardianIds = new Set(a.snap.mobs.map((m) => m.id));

// Every snapshot is one server tick; snapIndex is our tick clock.
let snapIndex = 0;
const halfLatchSeen = new Map(); // id -> { snapIndex, x, y }
a.listeners.push((s) => {
  snapIndex++;
  for (const m of s.mobs) {
    if (m.kind === "halfLatch" && !guardianIds.has(m.id) && !halfLatchSeen.has(m.id)) {
      halfLatchSeen.set(m.id, { snapIndex, x: m.x, y: m.y });
    }
  }
});
const bishops = (s = a.snap) => s.colonists.filter((k) => k.kind === "bishop" && tileAt(k.postX, k.postY) !== 46);
const priests = (s = a.snap) => bishops(s).filter((k) => tileAt(k.postX, k.postY) !== T.ChurchPost);

// ---------------------------------------------------------------- A: setup
const meT = tileOf(a.me());
const mePx = a.me();
const reach = [];
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
  const t = { x: meT.x + dx, y: meT.y + dy };
  if ((dx === 0 && dy === 0) || !inB(t.x, t.y) || tileAt(t.x, t.y) !== T.Empty) continue;
  if (dist(center(t), mePx) > TILE * 2.4) continue;
  reach.push(t);
}
// Two stones as far apart as reach allows, then church/lumberjack/smiths on non-adjacent leftovers.
let s1 = null, s2 = null;
for (const p of reach) for (const q of reach) if (!s1 || dist(center(p), center(q)) > dist(center(s1), center(s2))) { s1 = p; s2 = q; }
// The Church keeps clear of both stones (so "spawned at the Church, not the stone" is meaningful);
// the two Blacksmiths must not touch (an adjacent one would upgrade instead of being a second shop).
const free = reach.filter((t) => !same(t, s1) && !same(t, s2));
const church = free.find((t) => !adj8(t, s1) && !adj8(t, s2));
const rest = free.filter((t) => church && !same(t, church));
const smithA = rest[0];
const smithB = rest.find((t) => smithA && !adj8(t, smithA));
const lumber = rest.find((t) => !same(t, smithA) && !(smithB && same(t, smithB)));
if (!church || !smithA || !smithB || !lumber) {
  result(false, `A: not enough free tiles in reach (church=${!!church} smiths=${!!smithA},${!!smithB} lumber=${!!lumber})`);
  process.exit(1);
}
info(`layout: S1 (${s1.x},${s1.y}) S2 (${s2.x},${s2.y}) ${(dist(center(s1), center(s2)) / TILE).toFixed(1)} tiles apart; church (${church.x},${church.y})`);

setTile(lumber, T.LumberjackPost);
setTile(smithA, T.Blacksmith);
setTile(smithB, T.Blacksmith);
await sleep(400);
const NEED_WOOD = 15 + 20 + 15 + 20;
const stocked = await waitFor(() => a.snap.tools >= 20 && a.snap.wood >= NEED_WOOD + 10, 5 * 60000);
setTile(smithA, T.Empty);
setTile(smithB, T.Empty);
await sleep(400);
result(stocked || (a.snap.tools >= 20 && a.snap.wood >= NEED_WOOD),
  `A: stocked tools=${a.snap.tools} wood=${a.snap.wood} (need 20 tools, ${NEED_WOOD} wood); smiths demolished`);

// ---------------------------------------------------------------- B: church gate
{
  const before = { wood: a.snap.wood, tools: a.snap.tools, bishops: bishops().length };
  setTile(s1, T.WardStone);
  await sleep(500);
  result(tileAt(s1.x, s1.y) === T.Empty && a.snap.wood === before.wood && a.snap.tools === before.tools && bishops().length === 0,
    `B: no Church -> Ward Stone refused silently (tile ${tileAt(s1.x, s1.y)}, wood ${before.wood}->${a.snap.wood}, tools ${before.tools}->${a.snap.tools}, bishops ${bishops().length})`);
}

// ---------------------------------------------------------------- C: never-tended stone
setTile(church, T.ChurchPost);
await sleep(300);
const churchBishop0 = bishops().find((k) => same({ x: k.postX, y: k.postY }, church));
setTile(s1, T.WardStone);
await a.nextSnap();
await a.nextSnap();
{
  const ps = priests();
  const p = ps[0];
  result(tileAt(s1.x, s1.y) === T.WardStone && ps.length === 1 && p && same({ x: p.postX, y: p.postY }, s1),
    `C: Church + S1 -> ${ps.length} Ward Priest, post (${p?.postX},${p?.postY}); church bishop present: ${!!churchBishop0}`);
  if (p) {
    result(dist(p, center(church)) <= TILE * 1.6 && dist(p, center(s1)) > dist(p, center(church)),
      `C: he spawned at the Church (${(dist(p, center(church)) / TILE).toFixed(2)} tiles from it, ${(dist(p, center(s1)) / TILE).toFixed(2)} from S1)`);
  }
}
await sleep(2000);
setTile(church, T.Empty);
await a.nextSnap();
await a.nextSnap();
result(priests().length === 0 && bishops().length === 0, `C: Church demolished after ~2s (< 10s tend) -> priest dismissed (${priests().length} priests, ${bishops().length} bishops)`);
{
  const before = a.snap.tools;
  setTile(s2, T.WardStone);
  await sleep(500);
  result(tileAt(s2.x, s2.y) === T.Empty && a.snap.tools === before, `C: S2 refused while no Church stands`);
}
{
  const hlBefore = halfLatchSeen.size;
  let priestSnaps = 0;
  const fn = (s) => { if (priests(s).length > 0) priestSnaps++; };
  a.listeners.push(fn);
  await sleep(65000);
  a.listeners.splice(a.listeners.indexOf(fn), 1);
  result(halfLatchSeen.size === hlBefore && priestSnaps === 0,
    `C: 65s (> 60s grace) with never-tended S1 and no priest: ${halfLatchSeen.size - hlBefore} halfLatch spawned (S1 was never warded), ${priestSnaps} snapshots with a priest`);
}

// ---------------------------------------------------------------- D: one priest, patrolling
setTile(church, T.ChurchPost);
await a.nextSnap();
await a.nextSnap();
{
  const ps = priests();
  result(ps.length === 1 && dist(ps[0], center(church)) <= TILE * 1.6,
    `D: Church rebuilt -> ${ps.length} priest, ${ps[0] ? (dist(ps[0], center(church)) / TILE).toFixed(2) : "?"} tiles from the Church`);
}
setTile(s2, T.WardStone);
await sleep(500);
result(tileAt(s2.x, s2.y) === T.WardStone && priests().length === 1 && bishops().length === 2,
  `D: S2 placed -> still ${priests().length} Ward Priest (${bishops().length} bishops incl. the Church's)`);
const priestId = priests()[0]?.id;

// Per-tick trace of the priest.
const trace = []; // { snapIndex, post, state, dPost }
let maxPriests = 0;
const traceFn = (s) => {
  maxPriests = Math.max(maxPriests, priests(s).length);
  const p = s.colonists.find((k) => k.id === priestId);
  if (p) trace.push({ snapIndex, post: `${p.postX},${p.postY}`, state: p.state, dPost: dist(p, center({ x: p.postX, y: p.postY })) / TILE, x: p.x, y: p.y });
};
a.listeners.push(traceFn);

// A live commandMove must be ignored.
{
  const p0 = a.snap.colonists.find((k) => k.id === priestId);
  a.send({ type: "commandMove", unitIds: [priestId], x: mePx.x + TILE * 6, y: mePx.y + TILE * 6 });
  await sleep(1500);
  const p1 = a.snap.colonists.find((k) => k.id === priestId);
  result(p1 && dist(p1, center({ x: p1.postX, y: p1.postY })) <= dist(p0, center({ x: p0.postX, y: p0.postY })) + TILE * 0.5,
    `D: commandMove ignored (still heading for/at his stone, ${(dist(p1, center({ x: p1.postX, y: p1.postY })) / TILE).toFixed(2)} tiles from it)`);
}

await sleep(50000);

// Summarise the trace into visits: runs of the same post.
const visits = [];
for (const e of trace) {
  const v = visits[visits.length - 1];
  if (!v || v.post !== e.post) visits.push({ post: e.post, start: e.snapIndex, end: e.snapIndex, warding: 0, patrolling: 0, wardFar: 0 });
  const cur = visits[visits.length - 1];
  cur.end = e.snapIndex;
  if (e.state === "warding") { cur.warding++; if (e.dPost > 1.5) cur.wardFar++; }
  if (e.state === "patrolling") cur.patrolling++;
}
info(`visits: ${visits.map((v) => `${v.post}[walk ${v.patrolling}t, ward ${v.warding}t]`).join(" -> ")}`);
const k1 = `${s1.x},${s1.y}`;
const k2 = `${s2.x},${s2.y}`;
const complete = visits.slice(0, -1);
result(maxPriests === 1, `D: never more than one Ward Priest at once (max ${maxPriests})`);
result(complete.length >= 3 && complete.every((v, i) => [k1, k2].includes(v.post) && (i === 0 || v.post !== complete[i - 1].post)),
  `D: alternates between S1 and S2 (${complete.length} completed visits)`);
result(complete.every((v) => v.warding >= WARD_TEND_TICKS - 2 && v.warding <= WARD_TEND_TICKS + 2 && v.wardFar === 0),
  `D: each completed visit tends ${WARD_TEND_TICKS} ticks within 1.5 tiles (${complete.map((v) => v.warding).join(", ")})`);
result(complete.slice(1).every((v) => v.patrolling > 0),
  `D: walks ("patrolling") between stones (${complete.map((v) => v.patrolling).join(", ")} ticks)`);
{
  const xs = trace.map((e) => e.x);
  const ys = trace.map((e) => e.y);
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / TILE;
  result(span >= 2, `D: he actually moved around: ${span.toFixed(1)} tiles bounding-box diagonal`);
}

// ---------------------------------------------------------------- E: neglect lapse
// A completed tend retargets him on the same tick, so a visit's last snapshot is the tick before its
// stone's tend completed. The final visit is still in progress and doesn't count.
const lastTended = {};
for (const v of visits.slice(0, -1)) if (v.warding >= WARD_TEND_TICKS - 2) lastTended[v.post] = v.end;
const hlBefore = halfLatchSeen.size;
setTile(church, T.Empty);
await a.nextSnap();
await a.nextSnap();
a.listeners.splice(a.listeners.indexOf(traceFn), 1);
result(priests().length === 0, `E: Church demolished -> priest dismissed`);
info(`E: last tended at tick ${JSON.stringify(lastTended)}, now ${snapIndex}`);
const lapseDeadline = Math.max(...Object.values(lastTended)) + WARD_GRACE_TICKS;
await waitFor(() => snapIndex > lapseDeadline + 100, 90000);
const newHl = [...halfLatchSeen.values()].slice(hlBefore);
for (const [key, tick] of Object.entries(lastTended)) {
  const [tx, ty] = key.split(",").map(Number);
  const c = center({ x: tx, y: ty });
  const at = newHl.filter((h) => h.x === c.x && h.y === c.y);
  const delta = at[0] ? at[0].snapIndex - tick : null;
  result(at.length === 1 && Math.abs(delta - WARD_GRACE_TICKS) <= 3 && delta >= WARD_GRACE_TICKS,
    `E: stone (${key}) lapsed ${at.length}x, ${delta} ticks after its last tend (expect ${WARD_GRACE_TICKS} +-3)`);
}
result(newHl.length === Object.keys(lastTended).length, `E: ${newHl.length} halfLatches in total, one per tended stone`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
