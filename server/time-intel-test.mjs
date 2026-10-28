// Scripted test: strategy mode phase 5 (time controls + enemy regiment summaries). Boots its OWN private
// server (tsx, port 20653 by default, PORT env to override) at COLONY_WORLD_SIZE=256 with
// COLONY_TEST_HOOKS=1 and a temp COLONY_SAVE_DIR. Run from server/: `node time-intel-test.mjs`.
//   Pause is global (one socket pauses, the other sees it + who), freezes cycleTick; an order sent while
//   paused is accepted and waits; 1/2 speed halves sim ticks (and snapshots) per second, 2x doubles them;
//   a bad scale is ignored; enemyRegiments go only to strategy-view players, only for mobs in live vision
//   (also ones culled from `mobs`, far from the rider), with count / power.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20653);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "256", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "tintel-")) };
const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));
// tsx runs the server in a child: kill the whole process group so no orphan keeps the port.
const kill = () => {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};

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
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, snaps: 0, enemies: null, groups: [], waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      c.snaps++;
      if (m.enemyRegiments) c.enemies = m.enemyRegiments;
      if (m.orderGroups) c.groups = m.orderGroups;
    }
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

async function open() {
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcome || !c.snap) await sleep(20);
  c.send({ type: "join" });
  return c;
}

// A soldier on the first walkable spot near tile (tx, ty).
async function soldierNear(c, tx, ty, ts) {
  for (let r = 0; r < 6; r++) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const { id } = await c.hook("spawnSoldier", { kind: "knight", x: (tx + dx + 0.5) * ts, y: (ty + dy + 0.5) * ts });
      if (id) return id;
    }
  }
  return null;
}

const ticksOver = async (c, ms) => {
  const a = (await c.hook("bodyState")).cycleTick;
  const n0 = c.snaps;
  await sleep(ms);
  const b = (await c.hook("bodyState")).cycleTick;
  return { ticks: b - a, snaps: c.snaps - n0 };
};

try {
  await waitForPort();
  const a = await open();
  const b = await open();
  const ts = a.welcome.tileSize;
  await a.hook("ignorePlayers", { value: true });
  result(a.snap.timeScale === 1 && a.snap.isPaused === false, "starts unpaused at 1x");

  // Global pause, shown to the other player with who did it.
  a.send({ type: "pause", paused: true });
  await sleep(300);
  result(b.snap.isPaused === true && b.snap.pausedBy === a.welcome.id, "A's pause reaches B with pausedBy = A");
  const frozen = await ticksOver(a, 500);
  result(frozen.ticks === 0 && frozen.snaps >= 6, `paused: cycleTick frozen (${frozen.ticks}), snapshots still flow (${frozen.snaps} in 0.5 s)`);

  // An order while paused is accepted (order group exists) but the unit waits for the resume.
  const me = a.snap.players.find((p) => p.id === a.welcome.id);
  const ptx = Math.floor(me.x / ts);
  const pty = Math.floor(me.y / ts);
  const knight = await soldierNear(a, ptx + 2, pty, ts);
  result(!!knight, `spawned a knight (${knight})`);
  await sleep(200);
  const k0 = a.snap.colonists.find((c) => c.id === knight);
  a.send({ type: "regimentOrder", unitIds: [knight], order: { kind: "move", x: k0.x + 5 * ts, y: k0.y } });
  await sleep(500);
  const k1 = a.snap.colonists.find((c) => c.id === knight);
  const grouped = a.groups.some((g) => g.unitIds.includes(knight) && g.order?.kind === "move");
  result(grouped && Math.hypot(k1.x - k0.x, k1.y - k0.y) < 1, "order while paused: queued in an order group, unit has not moved");
  b.send({ type: "pause", paused: false });
  await sleep(1500);
  const k2 = a.snap.colonists.find((c) => c.id === knight);
  result(a.snap.isPaused === false && a.snap.pausedBy === b.welcome.id, "B resumes (pausedBy = B)");
  result(k2.x - k0.x > ts, `after resume the order runs (moved ${((k2.x - k0.x) / ts).toFixed(1)} tiles)`);

  // Time scale: global, with who set it; ticks and snapshots per second follow it.
  const base = await ticksOver(a, 1500);
  a.send({ type: "setTimeScale", scale: 0.5 });
  await sleep(300);
  result(b.snap.timeScale === 0.5 && b.snap.timeScaleBy === a.welcome.id, "A's 1/2 speed reaches B with timeScaleBy = A");
  const half = await ticksOver(a, 1500);
  const halfRatio = half.ticks / Math.max(1, base.ticks);
  result(halfRatio > 0.38 && halfRatio < 0.62, `1/2 speed: ${half.ticks} ticks vs ${base.ticks} at 1x (ratio ${halfRatio.toFixed(2)})`);
  result(half.snaps < base.snaps * 0.65, `1/2 speed sends only stepped snapshots (${half.snaps} vs ${base.snaps})`);
  b.send({ type: "setTimeScale", scale: 2 });
  await sleep(300);
  const dbl = await ticksOver(a, 1500);
  const dblRatio = dbl.ticks / Math.max(1, base.ticks);
  result(a.snap.timeScaleBy === b.welcome.id && dblRatio > 1.6 && dblRatio < 2.4, `2x speed (set by B): ${dbl.ticks} ticks (ratio ${dblRatio.toFixed(2)})`);
  a.send({ type: "setTimeScale", scale: 0.3 });
  a.send({ type: "setTimeScale", scale: "1" });
  await sleep(300);
  result(a.snap.timeScale === 2, "invalid scales ignored");
  a.send({ type: "setTimeScale", scale: 1 });
  await sleep(200);

  // Enemy summaries: a regiment of 2 goblins near the knight (in vision), a lone goblin far from anyone.
  for (const dx of [3, 4]) await a.hook("spawnMob", { kind: "goblin", tx: Math.floor(k2.x / ts) + dx, ty: Math.floor(k2.y / ts), regimentId: "rtest" });
  const { id: farId } = await a.hook("spawnMob", { kind: "goblin", tx: 230, ty: 230 });
  await sleep(150);
  a.send({ type: "setView", x: me.x / ts, y: me.y / ts, halfW: 20, halfH: 12, strategy: true });
  await sleep(900);
  const near = (a.enemies ?? []).find((e) => e.id === "rtest");
  result(!!near && near.count === 2 && near.power > 0 && near.roles.frontline >= 1, `strategy player gets the seen regiment (${JSON.stringify(near)})`);
  const farCell = (e) => e.id.startsWith("c:") && Math.hypot(e.x / ts - 230, e.y / ts - 230) < 8;
  result(!(a.enemies ?? []).some(farCell), "unseen far goblin not summarised");
  result(b.enemies === null, "a player not in strategy mode gets no enemyRegiments");
  const scout = await soldierNear(a, 228, 230, ts);
  await sleep(900);
  const far = (a.enemies ?? []).find(farCell);
  result(!!scout && !!far && far.count === 1 && !a.snap.mobs.some((m) => m.id === farId), `far goblin seen by a scout: summarised while culled from mobs (${far?.id})`);
  console.log(`enemyRegiments bytes: ${JSON.stringify(a.enemies).length} for ${a.enemies.length} regiments`);
  a.ws.close();
  b.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
