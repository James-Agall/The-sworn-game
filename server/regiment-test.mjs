// Scripted test: regiments & roles (ROADMAP "Regiments & roles — landed 2026-10-27").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>, default world size
// (160; on small worlds the arena overlaps a ward and nothing fights). Pauses the world and works in a cleared arena well west of the Town Center (as battle-discipline-test).
//
//   F: formation - 6 knights + 4 archers, line-drag (replica of client computeLineFormationTargets with the
//      two-line layout): every archer slot is >= 2 tiles behind the front row along the facing and the rear
//      line is no wider than the front; sent to the server as one squad, everyone ends on its slot.
//   C: clash - 3 goblins + 2 orcs dropped in front of that line. While the front holds (>= 3 knights alive)
//      every archer stays >= 2 tiles behind the knights' mean front (along the facing); the regiment wins.
//   A: advance together - 6 militia (speed 120) + 4 archers (100) given a 15-tile formation move as one
//      squad: while marching, no member strays more than 1.5 tiles from its place in the formation
//      (position - squad centroid vs slot - slot centroid), and the squad keeps the archers' pace.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "F,C,A").split(","));
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;

// ---- Replica of client/src/main.ts computeLineFormationTargets (normal stance, no enemy nearby) ----
const FORMATION_RANK = { knight: 0, militia: 0, spearman: 0, pikeman: 0, archer: 1, bishop: 2 };
const REAR = new Set(["archer"]);
const SPACING = TILE * 1.05;
const LINE_MAX_DEPTH_ROWS = 3;
const LINE_MAX_GAP = 1.5;
const REAR_LINE_OFFSET_TILES = 2.5;
const REAR_LINE_WIDTH = 0.7;
function computeLineFormationTargets(units, ax, ay, bx, by) {
  const spacing = SPACING;
  const dragLen = Math.hypot(bx - ax, by - ay);
  const ux = dragLen >= 1 ? (bx - ax) / dragLen : 1;
  const uy = dragLen >= 1 ? (by - ay) / dragLen : 0;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const minCols = Math.min(units.length, Math.max(2, Math.ceil(units.length / LINE_MAX_DEPTH_ROWS)));
  const L = Math.max(dragLen, (minCols - 1) * spacing, 1);
  let ucx = 0;
  let ucy = 0;
  for (const u of units) { ucx += u.x; ucy += u.y; }
  ucx /= units.length;
  ucy /= units.length;
  let fx = -uy;
  let fy = ux;
  if ((cx - ucx) * fx + (cy - ucy) * fy < 0) { fx = -fx; fy = -fy; }
  const cols = Math.max(minCols, Math.min(units.length, Math.floor(L / spacing) + 1));
  const step = cols > 1 ? Math.min(L / (cols - 1), spacing * LINE_MAX_GAP) : 0;
  const ranks = new Map();
  const hasFront = units.some((u) => !REAR.has(u.kind));
  for (const u of units) {
    const rank = FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
    if (ranks.has(rank)) ranks.get(rank).push(u); else ranks.set(rank, [u]);
  }
  const targets = new Map();
  let depth = 0;
  for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
    const members = ranks.get(rank);
    const rear = hasFront && depth > 0 && REAR.has(members[0].kind);
    const rankCols = rear ? Math.max(1, Math.min(members.length, Math.ceil(cols * REAR_LINE_WIDTH))) : cols;
    if (rear) depth = Math.max(depth, REAR_LINE_OFFSET_TILES * TILE);
    members.sort((a, b) => b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
    const rowCount = Math.ceil(members.length / rankCols);
    for (let row = 0; row < rowCount; row++) {
      const rowMembers = members.slice(row * rankCols, row * rankCols + rankCols).sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy));
      rowMembers.forEach((u, i) => {
        const lateral = (i - (rowMembers.length - 1) / 2) * step;
        targets.set(u.id, { x: cx - depth * fx + lateral * ux, y: cy - depth * fy + lateral * uy, rear, depth, lateral });
      });
      depth += spacing;
    }
  }
  return { targets, fx, fy, cols, step };
}

// ---- Connection + hooks ----
const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, hook: new Map() };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const body = () => hook("bodyState");

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
const px = (tx) => tx * TILE + TILE / 2;

// A cleared 41x25 arena west of the Town Center, emptied of every mob in or near it.
const A = { x: TCT.x - 34, y: TCT.y };
for (let dy = -12; dy <= 12; dy++) for (let dx = -20; dx <= 20; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: 0 });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: 0 });
async function clearArenaMobs() {
  const bs = await body();
  for (const m of bs.mobs) {
    if (Math.abs(m.x - px(A.x)) <= 30 * TILE && Math.abs(m.y - px(A.y)) <= 24 * TILE) await hook("damageMob", { mobId: m.id, amount: 99999 });
  }
}
await clearArenaMobs();

async function spawnSquad(kinds, x0, y0) {
  const ids = [];
  for (let i = 0; i < kinds.length; i++) {
    ids.push((await hook("spawnSoldier", { kind: kinds[i], x: x0 + (i % 4) * 22, y: y0 + Math.floor(i / 4) * 22 - 22, stance: "normal" })).id);
  }
  await ff(2);
  return ids;
}
async function order(ids, plan, squad) {
  for (const [id, p] of plan.targets) if (ids.includes(id)) send({ type: "commandMove", unitIds: [id], x: p.x, y: p.y, squad });
  await sleep(150);
}

let lineIds = [];
let linePlan = null;
// ---------------------------------------------------------------- F: two-line formation
if (ONLY.has("F") || ONLY.has("C")) {
  const kinds = [...Array(6).fill("knight"), ...Array(4).fill("archer")];
  lineIds = await spawnSquad(kinds, px(A.x - 8), px(A.y));
  const bs = await body();
  const units = bs.colonists.filter((u) => lineIds.includes(u.id));
  // A 5-tile vertical drag east of the squad: front faces east (+x).
  linePlan = computeLineFormationTargets(units, px(A.x), px(A.y) - 2.5 * TILE, px(A.x), px(A.y) + 2.5 * TILE);
  const kind = new Map(units.map((u) => [u.id, u.kind]));
  const front = [...linePlan.targets].filter(([id]) => kind.get(id) === "knight").map(([, t]) => t);
  const rear = [...linePlan.targets].filter(([id]) => kind.get(id) === "archer").map(([, t]) => t);
  const frontX = Math.min(...front.filter((t) => t.depth === 0).map((t) => t.x));
  const minBehind = Math.min(...rear.map((t) => (frontX - t.x) / TILE));
  const width = (ts) => (Math.max(...ts.map((t) => t.lateral)) - Math.min(...ts.map((t) => t.lateral))) / TILE;
  if (ONLY.has("F")) {
    result(rear.every((t) => t.rear) && minBehind >= 2, `F: 4 archer slots on the rear line, >= ${minBehind.toFixed(2)} tiles behind the front row (need >= 2)`);
    result(width(rear) <= width(front.filter((t) => t.depth === 0)) + 0.01, `F: rear line ${width(rear).toFixed(2)} tiles wide <= front ${width(front.filter((t) => t.depth === 0)).toFixed(2)}`);
  }
  await order(lineIds, linePlan, "squad-F");
  await ff(300);
  const end = await body();
  let worst = 0;
  for (const [id, p] of linePlan.targets) {
    const u = end.colonists.find((x) => x.id === id);
    worst = Math.max(worst, u ? Math.hypot(u.x - p.x, u.y - p.y) : Infinity);
  }
  if (ONLY.has("F")) result(worst <= 3, `F live: 6 knights + 4 archers on their two-line slots (furthest ${worst.toFixed(1)} px)`);
}

// ---------------------------------------------------------------- C: the clash, archers stay behind
if (ONLY.has("C")) {
  await clearArenaMobs();
  const kindOf = new Map((await body()).colonists.map((u) => [u.id, u.kind]));
  const knights = lineIds.filter((id) => kindOf.get(id) === "knight");
  const archers = lineIds.filter((id) => kindOf.get(id) === "archer");
  const foes = [];
  for (let i = 0; i < 3; i++) foes.push((await hook("spawnMob", { kind: "goblin", tx: A.x + 6, ty: A.y - 2 + i * 2 })).id);
  for (let i = 0; i < 2; i++) foes.push((await hook("spawnMob", { kind: "orc", tx: A.x + 7, ty: A.y - 1 + i * 2 })).id);
  let worstGap = Infinity;
  let heldSamples = 0;
  for (let i = 0; i < 80; i++) {
    await ff(5);
    const bs = await body();
    const ks = bs.colonists.filter((u) => knights.includes(u.id));
    const as = bs.colonists.filter((u) => archers.includes(u.id));
    const alive = bs.mobs.filter((m) => foes.includes(m.id));
    if (alive.length === 0) break;
    if (process.env.DEBUG) info(`C${i}: foes ${alive.map((m) => `${m.kind[0]}@${(m.x / TILE - A.x).toFixed(1)},${(m.y / TILE - A.y).toFixed(1)}`).join(" ")} | archers ${as.map((u) => `${u.state[0]}@${(u.x / TILE - A.x).toFixed(1)}`).join(" ")} | knights ${ks.map((u) => `${(u.x / TILE - A.x).toFixed(1)}`).join(" ")}`);
    if (ks.length < 3 || as.length === 0) continue; // the front broke: no longer measured
    heldSamples++;
    const front = ks.reduce((s, u) => s + u.x, 0) / ks.length;
    for (const a of as) worstGap = Math.min(worstGap, (front - a.x) / TILE);
  }
  const end = await body();
  const left = end.mobs.filter((m) => foes.includes(m.id)).length;
  info(`C: ${heldSamples} samples with the front holding, foes left ${left}`);
  result(heldSamples > 5 && worstGap >= 2, `C: archers never closer than ${worstGap.toFixed(2)} tiles behind the knights' mean front (need >= 2)`);
  result(left === 0, `C: the regiment beat 3 goblins + 2 orcs (${left} left)`);
  await hook("killColonists", { kind: "knight" });
  await hook("killColonists", { kind: "archer" });
}

// ---------------------------------------------------------------- A: advance together
if (ONLY.has("A")) {
  await clearArenaMobs();
  const kinds = [...Array(6).fill("militia"), ...Array(4).fill("archer")];
  const ids = await spawnSquad(kinds, px(A.x - 16), px(A.y));
  let bs = await body();
  const units = bs.colonists.filter((u) => ids.includes(u.id));
  // First form up on a line, then march 15 tiles east as one squad.
  const plan0 = computeLineFormationTargets(units, px(A.x - 14), px(A.y) - 2 * TILE, px(A.x - 14), px(A.y) + 2 * TILE);
  await order(ids, plan0, "squad-A0");
  await ff(300);
  bs = await body();
  const formed = bs.colonists.filter((u) => ids.includes(u.id));
  const plan = computeLineFormationTargets(formed, px(A.x + 1), px(A.y) - 2 * TILE, px(A.x + 1), px(A.y) + 2 * TILE);
  await order(ids, plan, "squad-A1");
  const slotC = { x: 0, y: 0 };
  for (const p of plan.targets.values()) { slotC.x += p.x / plan.targets.size; slotC.y += p.y / plan.targets.size; }
  let worst = 0;
  let marching = 0;
  let ticks = 0;
  let startC = null;
  let lastC = null;
  for (let i = 0; i < 120; i++) {
    await ff(5);
    ticks += 5;
    bs = await body();
    const ms = bs.colonists.filter((u) => ids.includes(u.id));
    const cx = ms.reduce((s, u) => s + u.x, 0) / ms.length;
    const cy = ms.reduce((s, u) => s + u.y, 0) / ms.length;
    if (!startC) startC = { x: cx, y: cy, ticks };
    if (Math.hypot(slotC.x - cx, slotC.y - cy) <= 3 * TILE) break;
    marching++;
    lastC = { x: cx, y: cy, ticks };
    for (const u of ms) {
      const p = plan.targets.get(u.id);
      worst = Math.max(worst, Math.hypot(u.x - cx - (p.x - slotC.x), u.y - cy - (p.y - slotC.y)) / TILE);
    }
  }
  const tickRate = 20;
  const pace = lastC && lastC.ticks > startC.ticks ? (Math.hypot(lastC.x - startC.x, lastC.y - startC.y) / (lastC.ticks - startC.ticks)) * tickRate : 0;
  info(`A: ${marching} marching samples, squad pace ${pace.toFixed(0)} px/s (archers 100, militia 120)`);
  result(marching >= 10 && worst <= 1.5, `A: while marching no member strayed more than ${worst.toFixed(2)} tiles from its place in the formation (<= 1.5)`);
  result(pace > 0 && pace <= 108, `A: the squad advances at its slowest member's pace (${pace.toFixed(0)} px/s <= ~100 + biome/road slack)`);
  await ff(300);
  bs = await body();
  let home = 0;
  for (const [id, p] of plan.targets) {
    const u = bs.colonists.find((x) => x.id === id);
    home = Math.max(home, u ? Math.hypot(u.x - p.x, u.y - p.y) : Infinity);
  }
  result(home <= 3, `A: the squad settles on its slots afterwards (furthest ${home.toFixed(1)} px)`);
  await hook("killColonists", { kind: "militia" });
  await hook("killColonists", { kind: "archer" });
}

console.log(fails === 0 ? `\nALL PASS [${el()}]` : `\n${fails} FAIL(S) [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
