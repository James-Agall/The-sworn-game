// Scripted test: RTS formation moves (client-side slot assignment + closest-first staggered dispatch, replicated here
// exactly as client/src/main.ts does it) and the server's rally/return-to-slot behaviour. Begins with a `restart`,
// so it must be the ONLY connected player (restart resets the world for everyone).
//
//   Setup: Barracks (1 knight) + Militia Camp (2 militia) + 2 Archery Ranges (2 archers) + Church (1 bishop) = a
//          6-unit, 3-rank group (rank 0: knight+militia, rank 1: archers, rank 2: bishop).
//   F1: formation move -> every unit stops ON its exact slot (not "within 1.5 tiles"); slots/positions never closer
//       than the slot spacing; the measured front (rank-0 centroid vs rear centroid) points along the facing.
//   F2: second order in a clearly different direction -> slot geometry rotates (front row axis + front direction
//       follow the new facing), not just translates.
//   F3: redirect mid-march (before the last staggered per-unit orders have gone out) -> the stale order tail is
//       dropped, the new plan is computed from live mid-march positions, and everyone ends on the NEW slots.
//   C:  commandAttack at the nearest (dormant POI guardian) mob -> units leave their slots, fight, and every survivor
//       walks back onto its own exact formation slot (rally persists through combat).
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
const T = { Empty: 0, KnightPost: 5, ArcherPost: 6, Church: 20, MilitiaPost: 32 };
const SOLID = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);
const TILE = 32;
const PLAYER_ATTACK_RANGE = TILE * 1.3;
const COMMANDABLE = new Set(["knight", "archer", "bishop", "militia", "spearman", "pikeman"]);
const FIGHTING = new Set(["engaging", "attacking", "approaching", "healing"]);

// ---- Exact replica of client/src/main.ts formation logic ----
const FORMATION_RANK = { knight: 0, militia: 0, spearman: 0, pikeman: 0, archer: 1, bishop: 2, artillery: 3 };
const FORMATION_MAX_ROW_WIDTH = 5;
const FORMATION_SPACING_TILES = 1.25;
const FORMATION_DISPATCH_STEP_MS = 80;
const FORMATION_DISPATCH_MAX_SPREAD_MS = 800;
const SPACING = TILE * FORMATION_SPACING_TILES;

function computeFormationTargets(units, destX, destY) {
  const result = new Map();
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;
  let fx = destX - cx, fy = destY - cy;
  const flen = Math.hypot(fx, fy);
  if (flen < 1) { fx = 1; fy = 0; } else { fx /= flen; fy /= flen; }
  const px = -fy, py = fx;
  const ranks = new Map();
  for (const u of units) {
    const rank = FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
    if (ranks.has(rank)) ranks.get(rank).push(u); else ranks.set(rank, [u]);
  }
  const sortedRanks = Array.from(ranks.keys()).sort((a, b) => a - b);
  let depthRows = 0;
  for (const rank of sortedRanks) {
    const members = ranks.get(rank);
    members.sort((a, b) => b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
    const n = members.length;
    const cols = Math.min(FORMATION_MAX_ROW_WIDTH, n);
    const rowCount = Math.ceil(n / cols);
    for (let row = 0; row < rowCount; row++) {
      const rowMembers = members.slice(row * cols, row * cols + cols).sort((a, b) => a.x * px + a.y * py - (b.x * px + b.y * py));
      const rowN = rowMembers.length;
      const depth = (depthRows + row) * SPACING;
      rowMembers.forEach((u, i) => {
        const lateral = (i - (rowN - 1) / 2) * SPACING;
        result.set(u.id, { x: destX - depth * fx + lateral * px, y: destY - depth * fy + lateral * py, rank });
      });
    }
    depthRows += rowCount;
  }
  return { targets: result, fx, fy, centroid: { x: cx, y: cy } };
}

let orderCounter = 0;
const unitOrder = new Map();
const sendLog = [];
function stampOrder(ids) {
  orderCounter++;
  for (const id of ids) unitOrder.set(id, orderCounter);
  return orderCounter;
}
function formationMove(c, units, destX, destY) {
  const order = stampOrder(units.map((u) => u.id));
  const plan = computeFormationTargets(units, destX, destY);
  const distToSlot = (u) => { const slot = plan.targets.get(u.id); return Math.hypot(slot.x - u.x, slot.y - u.y); };
  const queue = units.slice().sort((a, b) => distToSlot(a) - distToSlot(b));
  const step = Math.min(FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS / (queue.length - 1));
  queue.forEach((u, i) => {
    const send = () => {
      if (unitOrder.get(u.id) !== order) { sendLog.push({ order, id: u.id, dropped: true, at: Date.now() }); return; }
      const pos = plan.targets.get(u.id);
      sendLog.push({ order, id: u.id, dropped: false, at: Date.now() });
      c.send({ type: "commandMove", unitIds: [u.id], x: pos.x, y: pos.y });
    };
    if (i === 0) send(); else setTimeout(send, i * step);
  });
  plan.queue = queue.map((u, i) => `${u.kind}@${Math.round(i * step)}ms`).join(", ");
  return { plan, order };
}

// ---- Shared harness (same conventions as the other *-test.mjs files) ----
function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: [], tileUpdates: [], onSnap: null };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") { c.welcome = m; c.welcomes++; c.tiles = [...m.tiles]; }
    else if (m.type === "snapshot") { m.at = Date.now(); c.snap = m; if (c.onSnap) c.onSnap(m); }
    else if (m.type === "tileUpdate") { c.tileUpdates.push({ ...m, at: Date.now() }); c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile; }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => c.inBounds(x, y) && !SOLID.has(c.tileAt(x, y));
  c.ready = async () => { await new Promise((r) => c.ws.on("open", r)); while (!c.welcome || !c.snap) await sleep(20); };
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
  while (!(cur.x === start.x && cur.y === start.y)) { path.unshift(cur); cur = parent.get(key(cur.x, cur.y)); }
  return path;
}

async function walkPath(c, path, timeoutMs = 30000) {
  const since = Date.now();
  for (const wp of path) {
    const cx = wp.x * TILE + TILE / 2, cy = wp.y * TILE + TILE / 2;
    for (;;) {
      if (Date.now() - since > timeoutMs) { c.send({ type: "input", dx: 0, dy: 0 }); return false; }
      const me = c.me();
      const ex = cx - me.x, ey = cy - me.y;
      let dx = 0, dy = 0;
      if (Math.abs(ex) > 4) dx = Math.sign(ex); else if (Math.abs(ey) > 4) dy = Math.sign(ey); else break;
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
    const t = c.meTile(), me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) return false;
    await walkPath(c, path.length ? path : [s]);
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const colonistOnTile = (c, x, y) => c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);

async function placeExpectAt(c, x, y, tile, tries = 6) {
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

async function waitFor(c, pred, timeoutMs) {
  const since = Date.now();
  while (Date.now() - since < timeoutMs) { if (pred(c.snap)) return true; await sleep(50); }
  return pred(c.snap);
}

function findSite(c) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W(), y = Math.floor(k / c.W());
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

// ---- Formation helpers ----
const unitsById = (c, ids) => c.snap.colonists.filter((k) => ids.includes(k.id));
const tileKey = (p) => `${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`;

function minPairDist(points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
  return best;
}

// A destination whose every slot tile (for this group's live positions) is open ground, reachable, and well clear
// (> 9 tiles) of every mob — a dormant POI guardian inside a guard's 7-tile alert range would get auto-attacked.
function pickDestination(c, units, distTiles, angleFilter) {
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;
  for (const dist of distTiles) {
    for (let deg = 0; deg < 360; deg += 15) {
      if (angleFilter && !angleFilter(deg)) continue;
      const a = (deg * Math.PI) / 180;
      const dx = cx + Math.cos(a) * dist * TILE, dy = cy + Math.sin(a) * dist * TILE;
      const plan = computeFormationTargets(units.map((u) => ({ ...u })), dx, dy);
      const slots = [...plan.targets.values()];
      const clearOfMobs = (p) => c.snap.mobs.every((m) => Math.hypot(m.x - p.x, m.y - p.y) > 9 * TILE);
      const ok = slots.every((s) => c.walkable(Math.floor(s.x / TILE), Math.floor(s.y / TILE)) && clearOfMobs(s)) &&
        [0.25, 0.5, 0.75].every((f) => clearOfMobs({ x: cx + (dx - cx) * f, y: cy + (dy - cy) * f }));
      if (ok) return { x: dx, y: dy, deg };
    }
  }
  return null;
}

// Waits until every unit has stopped walking (no "returning"), after the last staggered rank went out.
async function waitSettled(c, ids, timeoutMs) {
  await sleep(FORMATION_DISPATCH_MAX_SPREAD_MS + 300);
  return waitFor(c, (s) => s.colonists.filter((k) => ids.includes(k.id)).every((k) => k.state === "idle"), timeoutMs);
}

// Server-side final geometry vs the plan: exact slot arrival, spacing, and the measured front direction.
function checkFormation(c, label, plan, ids) {
  const units = unitsById(c, ids);
  let maxErr = 0;
  for (const u of units) {
    const slot = plan.targets.get(u.id);
    maxErr = Math.max(maxErr, Math.hypot(u.x - slot.x, u.y - slot.y));
  }
  result(units.length === ids.length && maxErr <= 3,
    `${label} all ${units.length}/${ids.length} units stopped on their own slot: max |pos - slot| = ${maxErr.toFixed(2)}px (<= 3px; the old 1.5-tile rally leash stopped units up to 48px short)`);
  const slots = [...plan.targets.values()];
  const minSlot = minPairDist(slots), minPos = minPairDist(units);
  result(minSlot >= SPACING - 0.01 && minPos >= SPACING - 3,
    `${label} no overlap: min slot-to-slot ${minSlot.toFixed(1)}px, min unit-to-unit ${minPos.toFixed(1)}px (spacing ${SPACING}px)`);
  const tiles = new Map();
  for (const u of units) tiles.set(tileKey(u), (tiles.get(tileKey(u)) ?? 0) + 1);
  const shared = [...tiles.values()].filter((n) => n > 1).length;
  info(`${label} distinct tiles occupied: ${tiles.size}/${units.length} (${shared} tile(s) hold 2+ units; with exact-pixel slots that is only possible on non-axis-aligned facings and the units are still >= ${minPos.toFixed(1)}px apart)`);

  const centroid = (list) => ({ x: list.reduce((s, u) => s + u.x, 0) / list.length, y: list.reduce((s, u) => s + u.y, 0) / list.length });
  const front = units.filter((u) => plan.targets.get(u.id).rank === 0);
  const rear = units.filter((u) => plan.targets.get(u.id).rank > 0);
  const fc = centroid(front), rc = centroid(rear);
  const mlen = Math.hypot(fc.x - rc.x, fc.y - rc.y);
  const measured = { x: (fc.x - rc.x) / mlen, y: (fc.y - rc.y) / mlen };
  const cos = measured.x * plan.fx + measured.y * plan.fy;
  // Rank-0 row: same depth along the facing, spread along the perpendicular.
  const along = front.map((u) => u.x * plan.fx + u.y * plan.fy);
  const across = front.map((u) => u.x * -plan.fy + u.y * plan.fx);
  const depthSpread = Math.max(...along) - Math.min(...along);
  const width = Math.max(...across) - Math.min(...across);
  result(cos > 0.99 && depthSpread <= 3 && Math.abs(width - (front.length - 1) * SPACING) <= 3,
    `${label} measured front (rank-0 centroid minus rear centroid) at ${(Math.atan2(measured.y, measured.x) * 180 / Math.PI).toFixed(1)}deg vs facing ${(Math.atan2(plan.fy, plan.fx) * 180 / Math.PI).toFixed(1)}deg (cos ${cos.toFixed(4)}); front row depth spread ${depthSpread.toFixed(2)}px, width ${width.toFixed(1)}px (expect ${(front.length - 1) * SPACING})`);
  return { measured, frontAxis: { x: -plan.fy, y: plan.fx } };
}

// ---- Run ----
const a = connect();
await a.ready();
info(`connected; players=${a.snap.players.length}`);
if (a.snap.players.length !== 1) info("WARNING: other players connected; restart will affect them");

const defend = setInterval(() => {
  if (!a.snap) return;
  const me = a.me();
  if (!me) return;
  if (a.snap.mobs.some((m) => Math.hypot(m.x - me.x, m.y - me.y) <= PLAYER_ATTACK_RANGE)) a.send({ type: "attack" });
}, 100);

{
  const w0 = a.welcomes;
  a.send({ type: "restart" });
  await waitFor(a, () => a.welcomes > w0, 3000);
  await sleep(300);
  result(a.snap.colonists.length === 0 && !a.snap.isNight, `restart: fresh day-0 world, colonists=${a.snap.colonists.length}`);
}

// Setup
const s = findSite(a);
if (!s || !(await ensureAt(a, s))) {
  result(false, "no reachable 5x5 build site");
  process.exit(1);
}
info(`build site (${s.x},${s.y})`);
const builds = [
  [s.x - 2, s.y, T.KnightPost, "Barracks"],
  [s.x + 2, s.y, T.MilitiaPost, "Militia Camp"],
  [s.x, s.y - 2, T.ArcherPost, "Archery Range #1"],
  [s.x, s.y + 2, T.ArcherPost, "Archery Range #2"],
  [s.x - 1, s.y - 2, T.Church, "Church"],
];
for (const [x, y, tile, name] of builds) result(await placeExpectAt(a, x, y, tile), `placed ${name} at (${x},${y})`);
await sleep(500);
const group = a.snap.colonists.filter((k) => COMMANDABLE.has(k.kind));
const ids = group.map((k) => k.id);
const kindCounts = group.reduce((m, k) => ((m[k.kind] = (m[k.kind] ?? 0) + 1), m), {});
result(group.length === 6 && kindCounts.knight === 1 && kindCounts.militia === 2 && kindCounts.archer === 2 && kindCounts.bishop === 1,
  `group selected: ${JSON.stringify(kindCounts)} (3 ranks)`);

// Transit jostle metric: closest any two group members get while a formation order is executing.
let transitMin = Infinity;
let transitWho = "";
// Pair-snapshots (20/s) with two units < 20px apart, i.e. sprites substantially stacked: how LONG units overlap,
// which a single closest-approach number can't distinguish from a momentary pass-by.
let overlapTicks = 0;
let tracking = false;
let trackingSince = 0;
a.onSnap = (m) => {
  if (!tracking) return;
  const pts = m.colonists.filter((k) => ids.includes(k.id));
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 20) overlapTicks++;
      if (d < transitMin) {
        transitMin = d;
        transitWho = `${pts[i].kind}(${pts[i].state}) & ${pts[j].kind}(${pts[j].state}) at +${Date.now() - trackingSince}ms`;
      }
    }
};

// F1
let f1;
{
  const units = unitsById(a, ids);
  const dest = pickDestination(a, units, [7, 6, 8, 5]);
  if (!dest) { result(false, "(F1) no clear destination"); process.exit(1); }
  tracking = true; transitMin = Infinity; overlapTicks = 0; trackingSince = Date.now();
  const startedAt = Date.now();
  const { plan } = formationMove(a, units, dest.x, dest.y);
  info(`(F1) order to (${dest.x.toFixed(0)},${dest.y.toFixed(0)}), facing ${dest.deg}deg; dispatch order (closest-to-slot first): ${plan.queue}`);
  const settled = await waitSettled(a, ids, 15000);
  tracking = false;
  result(settled, `(F1) group settled (all idle) after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  info(`(F1) closest approach between any two units during the march (starting from the garrison clump): ${transitMin.toFixed(1)}px — ${transitWho}; stacked (<20px) pair-snapshots: ${overlapTicks} (= ${(overlapTicks / 20).toFixed(2)} pair-seconds)`);
  f1 = { plan, geo: checkFormation(a, "(F1)", plan, ids), deg: dest.deg };
}

// F2: a clearly different direction (>= 75deg off F1's facing)
let f2;
{
  const units = unitsById(a, ids);
  const angDiff = (d) => { const x = Math.abs(((d - f1.deg) % 360 + 360) % 360); return Math.min(x, 360 - x); };
  const dest = pickDestination(a, units, [6, 7, 5, 8], (d) => angDiff(d) >= 75);
  if (!dest) { result(false, "(F2) no clear destination"); process.exit(1); }
  tracking = true; transitMin = Infinity; overlapTicks = 0; trackingSince = Date.now();
  const { plan } = formationMove(a, units, dest.x, dest.y);
  info(`(F2) order to (${dest.x.toFixed(0)},${dest.y.toFixed(0)}), facing ${dest.deg}deg (F1 was ${f1.deg}deg)`);
  result(await waitSettled(a, ids, 15000), "(F2) group settled");
  tracking = false;
  info(`(F2) closest approach between any two units during a march from an already-formed block: ${transitMin.toFixed(1)}px — ${transitWho}; stacked (<20px) pair-snapshots: ${overlapTicks} (= ${(overlapTicks / 20).toFixed(2)} pair-seconds)`);
  f2 = { plan, geo: checkFormation(a, "(F2)", plan, ids), deg: dest.deg };
  const planned = Math.acos(Math.max(-1, Math.min(1, f1.plan.fx * f2.plan.fx + f1.plan.fy * f2.plan.fy))) * 180 / Math.PI;
  const measured = Math.acos(Math.max(-1, Math.min(1, f1.geo.measured.x * f2.geo.measured.x + f1.geo.measured.y * f2.geo.measured.y))) * 180 / Math.PI;
  const axis = Math.acos(Math.min(1, Math.abs(f1.geo.frontAxis.x * f2.geo.frontAxis.x + f1.geo.frontAxis.y * f2.geo.frontAxis.y))) * 180 / Math.PI;
  result(Math.abs(planned - measured) <= 1 && planned >= 74,
    `(F1->F2) formation ROTATED, not just translated: facing changed ${planned.toFixed(1)}deg, measured server-side front direction changed ${measured.toFixed(1)}deg, front-row axis turned ${axis.toFixed(1)}deg`);
}

// F3: redirect mid-march at 300ms, while the last per-unit orders (320ms, 400ms) are still pending
{
  const units = unitsById(a, ids);
  const destA = pickDestination(a, units, [7, 8, 6]);
  const { order: orderA } = formationMove(a, units, destA.x, destA.y);
  const startCentroid = { x: units.reduce((s, u) => s + u.x, 0) / units.length, y: units.reduce((s, u) => s + u.y, 0) / units.length };
  await sleep(300);
  const live = unitsById(a, ids);
  const marching = live.filter((u) => u.state === "returning").length;
  const angDiff = (d) => { const x = Math.abs(((d - destA.deg) % 360 + 360) % 360); return Math.min(x, 360 - x); };
  const destB = pickDestination(a, live, [6, 7, 5], (d) => angDiff(d) >= 90);
  const { plan: planB, order: orderB } = formationMove(a, live, destB.x, destB.y);
  info(`(F3) order A ${destA.deg}deg, redirected after 300ms (${marching}/${live.length} units mid-march) to B ${destB.deg}deg; plan B centroid moved ${Math.hypot(planB.centroid.x - startCentroid.x, planB.centroid.y - startCentroid.y).toFixed(1)}px from A's start (computed from live positions)`);
  result(await waitSettled(a, ids, 15000), "(F3) group settled");
  await sleep(200);
  const droppedA = sendLog.filter((e) => e.order === orderA && e.dropped).length;
  const sentA = sendLog.filter((e) => e.order === orderA && !e.dropped).length;
  result(droppedA >= 1, `(F3) stale tail of order A dropped: ${sentA} sent, ${droppedA} dropped (pending sends superseded by B)`);
  checkFormation(a, "(F3)", planB, ids);
  f2 = { plan: planB };
}

// C: rally persistence through combat
{
  const slots = new Map(unitsById(a, ids).map((u) => [u.id, { x: u.x, y: u.y }]));
  const fc = { x: [...slots.values()].reduce((s, p) => s + p.x, 0) / slots.size, y: [...slots.values()].reduce((s, p) => s + p.y, 0) / slots.size };
  const target = a.snap.mobs.slice().sort((m1, m2) => Math.hypot(m1.x - fc.x, m1.y - fc.y) - Math.hypot(m2.x - fc.x, m2.y - fc.y))[0];
  if (!target) { result(false, "(C) no mob to attack"); process.exit(1); }
  info(`(C) commandAttack -> ${target.kind} ${target.id.slice(0, 8)} ${(Math.hypot(target.x - fc.x, target.y - fc.y) / TILE).toFixed(1)} tiles away (a dormant POI guardian; hitting it wakes its whole site)`);
  stampOrder(ids);
  a.send({ type: "commandAttack", unitIds: ids, mobId: target.id });

  const maxAway = new Map(ids.map((id) => [id, 0]));
  const sawFight = new Set(), sawReturn = new Set();
  a.onSnap = (m) => {
    for (const k of m.colonists) {
      if (!slots.has(k.id)) continue;
      const sl = slots.get(k.id);
      maxAway.set(k.id, Math.max(maxAway.get(k.id), Math.hypot(k.x - sl.x, k.y - sl.y)));
      if (FIGHTING.has(k.state)) sawFight.add(k.id);
      if (k.state === "returning" && sawFight.has(k.id)) sawReturn.add(k.id);
    }
  };
  const fightStart = Date.now();
  await waitFor(a, (s) => s.colonists.some((k) => ids.includes(k.id) && (k.state === "attacking")), 20000);
  info(`(C) first strike after ${((Date.now() - fightStart) / 1000).toFixed(1)}s; isNight=${a.snap.isNight}`);
  // Done = every surviving original unit idle (fight over and walked home) for 1s straight.
  let idleSince = null;
  const done = await waitFor(a, (s) => {
    const alive = s.colonists.filter((k) => ids.includes(k.id));
    const allIdle = alive.length > 0 && alive.every((k) => k.state === "idle");
    if (!allIdle) { idleSince = null; return false; }
    idleSince ??= Date.now();
    return Date.now() - idleSince >= 1000;
  }, 60000);
  const alive = unitsById(a, ids);
  info(`(C) after ${((Date.now() - fightStart) / 1000).toFixed(1)}s: survivors ${alive.length}/${ids.length}, fought: ${sawFight.size}, walked back: ${sawReturn.size}, isNight=${a.snap.isNight}, mobs left=${a.snap.mobs.length}`);
  result(done, `(C) fight over and all survivors idle again`);
  for (const u of alive) {
    const sl = slots.get(u.id);
    const err = Math.hypot(u.x - sl.x, u.y - sl.y);
    result(err <= 3 && (maxAway.get(u.id) < TILE || sawReturn.has(u.id)),
      `(C) ${u.kind} ${u.id.slice(0, 8)}: went up to ${(maxAway.get(u.id) / TILE).toFixed(1)} tiles from its slot (${sawFight.has(u.id) ? "fought/healed" : "did not fight"}), now ${err.toFixed(2)}px from the exact slot`);
  }
  const fought = alive.filter((u) => maxAway.get(u.id) >= TILE).length;
  result(fought >= 1, `(C) ${fought} survivor(s) actually left their slot by >= 1 tile and came back`);
}

clearInterval(defend);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails ? 1 : 0);
