// Scripted test: strategy mode phase 4 (`regimentSettings`, charge / bombard orders, shapes). Boots its OWN
// private server (tsx, port 20644 by default, PORT env to override) at COLONY_WORLD_SIZE=160 with
// COLONY_TEST_HOOKS=1 and a temp COLONY_SAVE_DIR; kills its process group after. Run from server/:
// `node stances-test.mjs`.
//   Hold-fire archers don't shoot a skeleton until ordered to attack it; skirmishers keep >= 2 tiles from a
//   skeleton while shooting it; a cycle-charging rider lands the x2 charge twice on one skeleton; a catapult
//   on a bombard order walks into range and shells an empty point; a wedge re-forms a finished line in
//   place (rows of 1, 2, 3); junk settings are ignored.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20644);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "160", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "stances-")) };
const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));
const kill = () => {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};
process.on("exit", kill);

async function waitForPort() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${PORT} never came up\n${log}`);
}

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") c.snap = m;
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hook = (op, data = {}) =>
    new Promise((resolve, reject) => {
      c.waiters.push({ pred: (m) => m.type === "testHookResult" && m.op === op, resolve });
      c.send({ type: "testHook", op, ...data });
      setTimeout(() => reject(new Error(`timeout on ${op}`)), 30000);
    });
  return c;
}

try {
  await waitForPort();
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcome || !c.snap) await sleep(20);
  c.send({ type: "join" });
  const ts = c.welcome.tileSize;
  await c.hook("setRaids", { enabled: false });
  await c.hook("ignorePlayers", { value: true });
  const tc = c.snap.townCenters[0];
  // A clear field east (or west) of the Town Center: tiles tc+4 .. tc+44, rows tc-9 .. tc+9.
  const dir = tc.x + 46 < 160 ? 1 : -1;
  for (let i = 4; i <= 44; i++) for (let dy = -9; dy <= 9; dy++) c.send({ type: "testHook", op: "setTileRaw", tx: tc.x + dir * i, ty: tc.y + dy, tile: 0 });
  await c.hook("setTileRaw", { tx: tc.x + dir * 4, ty: tc.y, tile: 0 });
  const px = (tilesOut, dyTiles) => ({ x: (tc.x + dir * tilesOut + 0.5) * ts, y: (tc.y + dyTiles + 0.5) * ts });
  const spawn1 = async (kind, at) => (await c.hook("spawnSoldier", { kind, ...at })).id;
  const mob = async (kind, tilesOut, dy) => (await c.hook("spawnMob", { kind, tx: tc.x + dir * tilesOut, ty: tc.y + dy })).id;
  const ff = (ticks) => c.hook("fastForward", { ticks });
  const state = () => c.hook("bodyState");
  const slay = (mobId) => c.hook("damageMob", { mobId, amount: 1e6 });
  // Every mob near the field (world guardians, leftovers) out of the way of the next scenario.
  const clearField = async () => {
    const lo = Math.min(tc.x, tc.x + dir * 50) * ts;
    const hi = Math.max(tc.x, tc.x + dir * 50) * ts;
    for (const m of (await state()).mobs) if (m.x >= lo && m.x <= hi && Math.abs(m.y - (tc.y + 0.5) * ts) <= 16 * ts) await slay(m.id);
    await ff(2);
  };
  const settings = (unitIds, s) => c.send({ type: "regimentSettings", unitIds, ...s });
  const order = (unitIds, o) => c.send({ type: "regimentOrder", unitIds, order: o });

  await clearField();
  // A: hold fire. Two archers, a skeleton 5 tiles off: no arrows until an attack order.
  const archers = [await spawn1("archer", px(8, -6)), await spawn1("archer", px(8, -5))];
  settings(archers, { holdFire: true });
  await ff(2);
  const skA = await mob("skeleton", 13, -6);
  await ff(50);
  let st = await state();
  const hpA0 = st.mobs.find((m) => m.id === skA)?.hp;
  result(hpA0 === 50 && st.colonists.filter((u) => archers.includes(u.id)).every((u) => !u.targetMobId), `hold fire: the skeleton is untouched (hp ${hpA0})`);
  await sleep(150);
  const snapFlag = c.snap.colonists.find((u) => u.id === archers[0])?.holdFire === true;
  result(snapFlag, "hold fire: the snapshot carries holdFire");
  order(archers, { kind: "attack", targetId: skA });
  await ff(60);
  st = await state();
  const hpA1 = st.mobs.find((m) => m.id === skA)?.hp ?? 0;
  result(hpA1 < 50, `hold fire: an attack order fires (hp ${hpA1})`);
  await clearField();

  // B: skirmish. Two fresh archers far from any front rank, a skeleton 3 tiles off (open field behind them).
  const sk = [await spawn1("archer", px(20, 0)), await spawn1("archer", px(20, 1))];
  settings(sk, { skirmish: true });
  await ff(2);
  const skB = await mob("skeleton", 17, 0);
  let minD = Infinity;
  let hpB = 50;
  for (let t = 0; t < 70; t += 2) {
    await ff(2);
    st = await state();
    const m = st.mobs.find((x) => x.id === skB);
    if (!m) break;
    hpB = m.hp;
    // Past the first second (the skeleton starts inside the kite radius).
    if (t >= 20) for (const u of st.colonists.filter((u) => sk.includes(u.id))) minD = Math.min(minD, Math.hypot(u.x - m.x, u.y - m.y) / ts);
  }
  result(minD >= 2, `skirmish: archers keep >= 2 tiles from the skeleton (min ${minD.toFixed(2)})`);
  result(hpB < 50, `skirmish: and shoot it while backing off (hp ${hpB})`);
  await clearField();
  // Out of the next scenario's way: no more uncommanded arrows.
  settings(sk, { holdFire: true });

  // C: cycle charge. A rider 10 tiles from a skeleton: charge, withdraw, charge again.
  const rider = await spawn1("cavalry", px(30, -6));
  settings([rider], { cycleCharge: true });
  await ff(2);
  const skC = await mob("skeleton", 40, -6);
  order([rider], { kind: "charge", targetId: skC });
  let charges = [];
  for (let t = 0; t < 800 && charges.length < 2; t += 20) {
    await ff(20);
    const ev = (await c.hook("siegeState")).events;
    charges = ev.filter((e) => e.type === "charge" && e.id === rider);
  }
  const hits = (await c.hook("siegeState")).events.filter((e) => e.type === "hit" && e.id === rider).length;
  result(charges.length >= 2, `charge: the x2 charge landed ${charges.length} times (plain hits between: ${hits})`);
  result(charges.length >= 2 && charges[1].tick - charges[0].tick >= 8 * 20, `charge: the second after the 8 s cooldown (${charges.length >= 2 ? (charges[1].tick - charges[0].tick) / 20 : "-"} s)`);

  await clearField();
  // D: bombard. A catapult 16 tiles from an empty point walks into its band and shells it.
  const cat = await spawn1("catapult", px(6, 8));
  const P = px(22, 8);
  order([cat], { kind: "bombard", ...P });
  let boulders = 0;
  for (let t = 0; t < 800 && boulders < 2; t += 20) {
    await ff(20);
    boulders = (await c.hook("siegeState")).events.filter((e) => e.type === "boulder" && e.id === "c:" + cat).length;
  }
  const cu = (await state()).colonists.find((u) => u.id === cat);
  const dP = cu ? Math.hypot(cu.x - P.x, cu.y - P.y) / ts : -1;
  result(boulders >= 2 && dP >= 3 && dP <= 11, `bombard: ${boulders} boulders on the point from ${dP.toFixed(1)} tiles`);

  // E: shape. Six knights formed in a line facing along dir, then wedge: rows of 1, 2, 3.
  const kn = [];
  for (let i = 0; i < 6; i++) kn.push(await spawn1("knight", px(12, -3 + i)));
  order(kn, { kind: "move", ...px(14, 0), facing: dir === 1 ? 0 : Math.PI, width: 6 });
  await ff(300);
  const rowsOf = async () => new Set((await state()).colonists.filter((u) => kn.includes(u.id)).map((u) => Math.round(u.rallyX))).size;
  const before = await rowsOf();
  settings(kn, { shape: "wedge" });
  // The re-form's staggered starts (up to 0.6 s).
  await ff(20);
  const after = await rowsOf();
  result(before === 1 && after === 3, `shape: line (${before} row) re-forms as a wedge (${after} rows)`);
  await sleep(150);
  const shapeFlag = c.snap.colonists.find((u) => u.id === kn[0])?.shape;
  settings(kn, { shape: "circle", holdFire: "yes" });
  await ff(2);
  result((await rowsOf()) === 3 && shapeFlag === "wedge", `junk settings are ignored (snapshot shape ${shapeFlag})`);
  c.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
