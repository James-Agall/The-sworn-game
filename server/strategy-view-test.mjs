// Scripted test: strategy mode phase 1 `setView` culling. Boots its OWN private server (tsx, port 20611 by
// default, PORT env to override) at COLONY_WORLD_SIZE=256 (culling only applies above 192) with
// COLONY_TEST_HOOKS=1 and a temp COLONY_SAVE_DIR. Run from server/: `node strategy-view-test.mjs`.
//   A mob far from the rider is culled; setView{strategy:true} over it brings it into the snapshot; an
//   oversized view is clamped (half extent <= 140 tiles + margin); malformed setView is ignored;
//   strategy:false drops the view again. Logs snapshot bytes with and without a wide view.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20611);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "256", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "sview-")) };
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
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, bytes: 0, waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      c.bytes = raw.length;
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

// Sends a setView (spaced past the server's 100 ms rate limit), then lets a few snapshots arrive.
async function view(c, v) {
  await sleep(150);
  c.send({ type: "setView", ...v });
  await sleep(300);
}

try {
  await waitForPort();
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcome || !c.snap) await sleep(20);
  c.send({ type: "join" });
  const ts = c.welcome.tileSize;
  await c.hook("ignorePlayers", { value: true });
  await c.hook("teleportPlayer", { x: 20 * ts, y: 20 * ts });
  const { id } = await c.hook("spawnMob", { kind: "goblin", tx: 230, ty: 230 });
  result(typeof id === "string", `spawned a far goblin (${id})`);
  await sleep(300);
  const has = () => c.snap.mobs.some((m) => m.id === id);
  result(!has(), "far mob culled without a view");
  const plainBytes = c.bytes;

  await view(c, { x: 230, y: 230, halfW: 20, halfH: 12, strategy: true });
  result(has(), "setView over the mob brings it into the snapshot");

  await view(c, { x: 5, y: 5, halfW: 1e6, halfH: 1e6, strategy: true });
  result(!has(), "oversized view clamped (mob 225 tiles from the view centre stays culled)");

  await view(c, { x: 128, y: 128, halfW: 140, halfH: 140, strategy: true });
  result(has(), "max-size view centred on the map includes the mob");
  const wideBytes = c.bytes;

  await view(c, { x: "a", y: 0, halfW: 10, halfH: 10, strategy: true });
  result(has(), "malformed setView ignored (previous view kept)");

  await view(c, { x: 0, y: 0, halfW: 0, halfH: 0, strategy: false });
  result(!has(), "strategy:false drops the view");

  console.log(`snapshot bytes: rider only ${plainBytes}, 140-tile view ${wideBytes} (mobs in view ${c.snap.mobs.length} after drop)`);
  c.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
