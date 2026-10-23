// Scripted test: battle discipline (ROADMAP "Battle discipline — landed 2026-10-23").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir> (any world size).
// Does not restart the world; it pauses it and works in a cleared arena well west of the Town Center.
//
//   L: line-drag minimum frontage (exact replica of client computeLineFormationTargets): a short drag never
//      gives more than LINE_MAX_DEPTH_ROWS rows (no single file), a long drag never opens gaps wider than
//      LINE_MAX_GAP x spacing; then a 9-unit short-drag line is sent to the server and every unit ends on
//      its slot.
//   S: skirmish - a 3x3 knight block (slots 1.05 tiles apart) meets 6 goblins dropped in front of it. Measured
//      every 5 ticks: furthest any knight gets from its own slot (<= leash 3 + strike range), melee attackers
//      on one goblin (<= cap 3), distinct goblins being fought while >= 3 are alive (> 1: no single shared
//      target), knight pairs stacked within 6 px (0 after separation). Afterwards every survivor is back on
//      its slot.
//      ("distinct goblins" is sampled while >= 3 goblins are alive and >= 3 knights have a target.)
//   M: mob queue - 9 goblins dropped on one tile in front of a 3-knight line: no knight ever has more than 3
//      goblin slot claims, at least 2 knights get attacked, and goblins never stack within 6 px.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "L,S,M").split(","));
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
const T = { Empty: 0 };

// ---- Exact replica of client/src/main.ts computeLineFormationTargets (normal stance) ----
const FORMATION_RANK = { knight: 0, militia: 0, spearman: 0, pikeman: 0, archer: 1, bishop: 2, artillery: 3 };
const SPACING = TILE * 1.05;
const LINE_MAX_DEPTH_ROWS = 3;
const LINE_MAX_GAP = 1.5;
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
  for (const u of units) {
    const rank = FORMATION_RANK[u.kind] ?? FORMATION_RANK.bishop;
    if (ranks.has(rank)) ranks.get(rank).push(u); else ranks.set(rank, [u]);
  }
  const targets = new Map();
  let depthRows = 0;
  for (const rank of Array.from(ranks.keys()).sort((a, b) => a - b)) {
    const members = ranks.get(rank);
    members.sort((a, b) => b.x * fx + b.y * fy - (a.x * fx + a.y * fy));
    const rowCount = Math.ceil(members.length / cols);
    for (let row = 0; row < rowCount; row++) {
      const rowMembers = members.slice(row * cols, row * cols + cols).sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy));
      const depth = (depthRows + row) * spacing;
      rowMembers.forEach((u, i) => {
        const lateral = (i - (rowMembers.length - 1) / 2) * step;
        targets.set(u.id, { x: cx - depth * fx + lateral * ux, y: cy - depth * fy + lateral * uy, row: depthRows + row });
      });
    }
    depthRows += rowCount;
  }
  return { targets, rows: depthRows, cols, step };
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

// A cleared 25x25 arena west of the Town Center, emptied of every mob already in or near it.
const A = { x: TCT.x - 28, y: TCT.y };
for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: T.Empty });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: T.Empty });
async function clearArenaMobs() {
  const bs = await body();
  for (const m of bs.mobs) {
    if (Math.abs(m.x - px(A.x)) <= 24 * TILE && Math.abs(m.y - px(A.y)) <= 24 * TILE) await hook("damageMob", { mobId: m.id, amount: 99999 });
  }
}
await clearArenaMobs();

// ---------------------------------------------------------------- L: minimum frontage
if (ONLY.has("L")) {
  for (const n of [4, 6, 9, 12, 20]) {
    const units = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, kind: "knight", x: 100 + (i % 5) * 30, y: 400 + Math.floor(i / 5) * 30 }));
    const short = computeLineFormationTargets(units, 300, 100, 310, 100); // a 10 px drag
    const long = computeLineFormationTargets(units, 0, 100, 2000, 100); // a 2000 px drag
    const minCols = Math.min(n, Math.max(2, Math.ceil(n / LINE_MAX_DEPTH_ROWS)));
    const front = Array.from(short.targets.values()).filter((t) => t.row === 0);
    const frontage = front.length > 1 ? Math.max(...front.map((t) => t.x)) - Math.min(...front.map((t) => t.x)) : 0;
    result(short.rows <= LINE_MAX_DEPTH_ROWS && short.cols >= minCols && frontage >= (minCols - 1) * SPACING - 0.01,
      `L: ${n} units, 10 px drag -> ${short.cols} wide x ${short.rows} deep, frontage ${(frontage / TILE).toFixed(2)} tiles (min ${(((minCols - 1) * SPACING) / TILE).toFixed(2)}), never single file`);
    result(long.step <= SPACING * LINE_MAX_GAP + 0.01 && long.rows === 1,
      `L: ${n} units, 2000 px drag -> 1 row, slot gap ${(long.step / TILE).toFixed(2)} tiles (<= ${((SPACING * LINE_MAX_GAP) / TILE).toFixed(2)})`);
  }
  // Live: 9 knights in a clump, a short drag in front of them, everyone ends on its slot.
  const ids = [];
  for (let i = 0; i < 9; i++) ids.push((await hook("spawnSoldier", { kind: "knight", x: px(A.x - 6) + (i % 3) * 20, y: px(A.y) + Math.floor(i / 3) * 20 })).id);
  await ff(5);
  let bs = await body();
  const units = bs.colonists.filter((u) => ids.includes(u.id));
  const plan = computeLineFormationTargets(units, px(A.x + 2), px(A.y) - 4, px(A.x + 2), px(A.y) + 4);
  for (const [id, p] of plan.targets) send({ type: "commandMove", unitIds: [id], x: p.x, y: p.y });
  await sleep(200);
  for (let i = 0; i < 20; i++) {
    await ff(20);
    if (process.env.DEBUG) {
      const b = await body();
      info(`t${i}: ` + b.colonists.filter((u) => ids.includes(u.id)).map((u) => `${u.x.toFixed(0)},${u.y.toFixed(0)}${u.state[0]}`).join(" "));
    }
  }
  bs = await body();
  let worst = 0;
  for (const [id, p] of plan.targets) {
    const u = bs.colonists.find((x) => x.id === id);
    worst = Math.max(worst, u ? Math.hypot(u.x - p.x, u.y - p.y) : Infinity);
    if (process.env.DEBUG) info(`L live ${id.slice(0, 6)}: at ${u?.x.toFixed(0)},${u?.y.toFixed(0)} ${u?.state} rally ${u?.rallyX.toFixed(0)},${u?.rallyY.toFixed(0)} slot ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
  }
  if (process.env.DEBUG) info(`L live: mobs near the line: ${bs.mobs.filter((m) => Math.hypot(m.x - px(A.x + 2), m.y - px(A.y)) < 300).map((m) => `${m.kind}@${m.x.toFixed(0)},${m.y.toFixed(0)}`).join(" ")}`);
  result(plan.rows <= 3 && worst <= 3, `L live: 9 knights, 8 px drag -> ${plan.cols} wide x ${plan.rows} deep; furthest from its slot ${worst.toFixed(1)} px`);
  await hook("killColonists", { kind: "knight" });
}

// ---------------------------------------------------------------- S: skirmish keeps the block
if (ONLY.has("S")) {
  await clearArenaMobs();
  const slots = new Map();
  const ids = [];
  const sp = TILE * 1.05;
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) {
      const x = px(A.x - 2) - r * sp;
      const y = px(A.y) + (k - 1) * sp;
      const id = (await hook("spawnSoldier", { kind: "knight", x, y, stance: "normal" })).id;
      ids.push(id);
      slots.set(id, { x, y });
    }
  }
  const gobs = [];
  for (let i = 0; i < 6; i++) gobs.push((await hook("spawnMob", { kind: "goblin", tx: A.x + 2, ty: A.y - 2 + (i % 5) })).id);
  let maxOut = 0;
  let maxOnOne = 0;
  let stackedSamples = 0;
  let samples = 0;
  let spreadSamples = 0;
  let spreadOk = 0;
  for (let i = 0; i < 60; i++) {
    await ff(5);
    const bs = await body();
    const ks = bs.colonists.filter((u) => ids.includes(u.id));
    const alive = bs.mobs.filter((m) => gobs.includes(m.id));
    if (alive.length === 0 && ks.every((u) => u.state === "idle")) break;
    samples++;
    if (process.env.DEBUG) info(`S${i}: gobs ${alive.map((m) => `${m.id.slice(0, 4)}@${(m.x / TILE).toFixed(1)},${(m.y / TILE).toFixed(1)}`).join(" ")} | knights ${ks.map((u) => `${u.state[0]}${u.targetMobId ? u.targetMobId.slice(0, 4) : "-"}@${((u.x - slots.get(u.id).x) / TILE).toFixed(1)},${((u.y - slots.get(u.id).y) / TILE).toFixed(1)}`).join(" ")}`);
    for (const u of ks) {
      const s = slots.get(u.id);
      maxOut = Math.max(maxOut, Math.hypot(u.x - s.x, u.y - s.y) / TILE);
    }
    const per = new Map();
    for (const [aid, s] of bs.slots) if (ids.includes(aid)) per.set(s.key, (per.get(s.key) ?? 0) + 1);
    for (const v of per.values()) maxOnOne = Math.max(maxOnOne, v);
    let stacked = 0;
    for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) if (Math.hypot(ks[a].x - ks[b].x, ks[a].y - ks[b].y) < 6) stacked++;
    if (stacked > 0) stackedSamples++;
    const engaged = ks.filter((u) => u.targetMobId);
    if (alive.length >= 3 && engaged.length >= 3) {
      const fighting = new Set(engaged.map((u) => u.targetMobId));
      spreadSamples++;
      if (fighting.size > 1) spreadOk++;
    }
  }
  const bs = await body();
  const left = bs.mobs.filter((m) => gobs.includes(m.id)).length;
  await ff(200);
  const end = await body();
  let worstHome = 0;
  let survivors = 0;
  for (const u of end.colonists.filter((x) => ids.includes(x.id))) {
    survivors++;
    const s = slots.get(u.id);
    worstHome = Math.max(worstHome, Math.hypot(u.x - s.x, u.y - s.y));
    if (process.env.DEBUG && Math.hypot(u.x - s.x, u.y - s.y) > 3) info(`S end: ${u.id.slice(0, 6)} ${u.state} at ${u.x.toFixed(0)},${u.y.toFixed(0)} slot ${s.x.toFixed(0)},${s.y.toFixed(0)} rally ${u.rallyX.toFixed(0)},${u.rallyY.toFixed(0)} target ${u.targetMobId}`);
  }
  info(`S: ${samples} samples, goblins left ${left}, survivors ${survivors}/9`);
  result(left === 0, `S: the block killed all 6 goblins (${left} left)`);
  result(maxOut <= 3 + 1.3 + 0.5, `S: furthest any knight got from its own slot: ${maxOut.toFixed(2)} tiles (leash 3 + strike range)`);
  result(maxOnOne <= 3, `S: most knights holding slots on one goblin: ${maxOnOne} (cap 3)`);
  result(spreadSamples === 0 || spreadOk / spreadSamples >= 0.8, `S: >1 distinct goblin being fought in ${spreadOk}/${spreadSamples} samples with >= 3 goblins alive and >= 3 knights engaged`);
  result(stackedSamples === 0, `S: knights stacked within 6 px in ${stackedSamples}/${samples} samples`);
  result(survivors > 0 && worstHome <= 3, `S: every survivor back on its slot (worst ${worstHome.toFixed(1)} px)`);
  await hook("killColonists", { kind: "knight" });
}

// ---------------------------------------------------------------- M: mobs queue on a line
if (ONLY.has("M")) {
  await clearArenaMobs();
  const ids = [];
  for (let k = 0; k < 3; k++) {
    ids.push((await hook("spawnSoldier", { kind: "knight", x: px(A.x - 2), y: px(A.y) + (k - 1) * TILE * 1.05, stance: "defensive" })).id);
  }
  // Tough enough that the knights don't cut them down before the queue forms.
  for (const id of ids) await hook("setColonistHp", { id, hp: 9999 });
  const gobs = [];
  for (let i = 0; i < 9; i++) gobs.push((await hook("spawnMob", { kind: "goblin", tx: A.x + 3, ty: A.y })).id);
  let maxOnKnight = 0;
  let mobStacked = 0;
  let samples = 0;
  const attacked = new Set();
  for (let i = 0; i < 24; i++) {
    await ff(5);
    const bs = await body();
    const per = new Map();
    for (const [aid, s] of bs.slots) if (gobs.includes(aid)) per.set(s.key, (per.get(s.key) ?? 0) + 1);
    for (const [key, v] of per) {
      maxOnKnight = Math.max(maxOnKnight, v);
      attacked.add(key);
    }
    const gm = bs.mobs.filter((m) => gobs.includes(m.id));
    if (i >= 6) {
      samples++;
      let st = 0;
      for (let a = 0; a < gm.length; a++) for (let b = a + 1; b < gm.length; b++) if (Math.hypot(gm[a].x - gm[b].x, gm[a].y - gm[b].y) < 6) st++;
      if (st > 0) mobStacked++;
    }
  }
  result(maxOnKnight <= 3, `M: most goblin slot claims on one knight: ${maxOnKnight} (cap 3)`);
  result(attacked.size >= 2, `M: knights attacked by the goblin pack: ${attacked.size}/3 (they spread along the line)`);
  result(mobStacked === 0, `M: goblins stacked within 6 px in ${mobStacked}/${samples} samples`);
  for (const id of gobs) await hook("damageMob", { mobId: id, amount: 99999 });
  await hook("killColonists", { kind: "knight" });
}

console.log(fails === 0 ? `\nALL PASS [${el()}]` : `\n${fails} FAIL(S) [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
