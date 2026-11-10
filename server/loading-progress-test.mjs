// Scripted test: the loading screen's server side (worldgen.ts worldJob, `loadProgress` / `cancelLoad`). Boots its
// OWN private server (tsx, PORT default 22410) with COLONY_TEST_HOOKS=1 and a temp COLONY_SAVE_DIR. Run from server/:
// `node loading-progress-test.mjs`.
//   1. restart{worldSize:256}: loadProgress messages arrive before the welcome, stages in LOAD_STAGES order, pct never
//      goes back, the last one is "starting" at 100; the game ticks on afterwards.
//   2. restart{worldSize:1024} + cancelLoad on the first cancellable message: "cancelled", then a stand-in world's
//      welcome (the previous 256 size), and the server keeps ticking and answering.
//   3. a message sent mid-generation waits for the new world (answered after its welcome).
//   4. save + load of a 512 world: kind "load" progress reaches 100 before the welcome.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22410);
const STAGES = ["read", "terrain", "settlements", "resources", "camps", "wildlife", "cache", "starting"];
const t0 = Date.now();
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "loadprog-")) };
delete env.COLONY_WORLD_SIZE;
const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));
const kill = () => process.kill(-proc.pid, "SIGKILL");

async function waitForPort() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("server never came up");
}

const c = { ws: null, msgs: [], waiters: [] };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type !== "snapshot") c.msgs.push(m);
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  return new Promise((r) => c.ws.on("open", r));
}
const send = (m) => c.ws.send(JSON.stringify(m));
const wait = (pred, ms = 60000) =>
  new Promise((resolve, reject) => {
    c.waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error("timeout waiting for message")), ms);
  });

// The loadProgress messages since `from`, up to the first welcome after them.
function progressBefore(from) {
  const out = [];
  for (const m of c.msgs.slice(from)) {
    if (m.type === "welcome") break;
    if (m.type === "loadProgress") out.push(m);
  }
  return out;
}
function inOrder(list) {
  for (let i = 1; i < list.length; i++) {
    if (list[i].pct < list[i - 1].pct || STAGES.indexOf(list[i].stage) < STAGES.indexOf(list[i - 1].stage)) return false;
  }
  return true;
}

try {
  await waitForPort();
  await connect();
  await wait((m) => m.type === "welcome");
  await wait((m) => m.type === "snapshot");

  // 1. A 256 restart.
  let from = c.msgs.length;
  send({ type: "restart", worldSize: 256 });
  let welcome = await wait((m) => m.type === "welcome");
  let prog = progressBefore(from);
  result(prog.length >= 5, `256 restart: ${prog.length} loadProgress messages before the welcome (${prog.map((m) => `${m.stage}:${m.pct}`).join(" ")})`);
  result(inOrder(prog), "256 restart: stages in order, pct never goes back");
  result(prog.at(-1)?.stage === "starting" && prog.at(-1)?.pct === 100, "256 restart: the last one is starting at 100");
  result(prog.every((m) => m.size === 256 && m.kind === "new" && !m.cancellable), "256 restart: size 256, kind new, not cancellable");
  result(welcome.worldTilesX === 256, `256 restart: welcome is ${welcome.worldTilesX}`);
  await wait((m) => m.type === "snapshot");
  result(true, "256 restart: snapshots go on");

  // 2. Cancel a 1024 generation.
  from = c.msgs.length;
  let cancelSent = false;
  const firstCancellable = wait((m) => m.type === "loadProgress" && m.cancellable === true);
  send({ type: "restart", worldSize: 1024 });
  // 3. Sent mid-generation: must wait for the world (a listSaves reply only after the next welcome).
  firstCancellable.then(() => {
    send({ type: "listSaves" });
    send({ type: "cancelLoad" });
    cancelSent = true;
  });
  const cancelled = await wait((m) => m.type === "loadProgress" && m.stage === "cancelled");
  welcome = await wait((m) => m.type === "welcome");
  result(cancelSent && cancelled.size === 1024, `cancel: "cancelled" after cancelLoad (at ${cancelled.pct}%)`);
  result(welcome.worldTilesX === 256, `cancel: the stand-in world is the previous size (${welcome.worldTilesX})`);
  if (!c.msgs.slice(from).some((m) => m.type === "saveList")) await wait((m) => m.type === "saveList");
  const after = c.msgs.slice(from);
  const wi = after.findIndex((m) => m.type === "welcome");
  const li = after.findIndex((m) => m.type === "saveList");
  result(wi >= 0 && li > wi, `mid-generation message (listSaves) answered after the new world's welcome (${li} > ${wi})`);
  await wait((m) => m.type === "snapshot");
  result(!/Error|TypeError|unhandled/i.test(log), "cancel: no server error logged");

  // 4. Save + load of a 512 world.
  send({ type: "restart", worldSize: 512 });
  welcome = await wait((m) => m.type === "welcome");
  await wait((m) => m.type === "snapshot");
  send({ type: "saveGame", slot: "slot1" });
  const saved = await wait((m) => m.type === "saveResult");
  result(saved.ok, "512 world saved");
  from = c.msgs.length;
  send({ type: "loadGame", slot: "slot1" });
  welcome = await wait((m) => m.type === "welcome");
  prog = progressBefore(from);
  result(welcome.worldTilesX === 512 && prog.length >= 2 && inOrder(prog) && prog.every((m) => m.kind === "load" && m.size === 512) && prog.at(-1).stage === "starting" && prog.at(-1).pct === 100,
    `512 load: ${prog.map((m) => `${m.stage}:${m.pct}`).join(" ")}`);
  await wait((m) => m.type === "snapshot");
} catch (err) {
  result(false, `threw: ${err.message}`);
  console.log(log.slice(-3000));
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
