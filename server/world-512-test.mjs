// Scripted test: variable world size / phase A of the 512 map. Boots its OWN private servers (tsx, ports
// 20600-20699 only; PORT_A default 20601, PORT_B 20602, PORT_C 20603) with COLONY_TEST_HOOKS=1 and a temp
// COLONY_SAVE_DIR. Run from server/: `node world-512-test.mjs`.
//   A (COLONY_WORLD_SIZE=512): world-gen time (< 15 s), entity counts, idle tick avg (< 25 ms) / max over ~20 s,
//                snapshot bytes per player.
//   B (default): boots at 160. setDifficulty{worldSize:64} regenerates live (no restart) -> 64x64 welcome;
//                restart{worldSize:256} -> 256; save, restart to 64, load -> back to 256 (size round-trips).
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT_A = Number(process.env.PORT_A ?? 20601);
const PORT_B = Number(process.env.PORT_B ?? 20602);
const t0 = Date.now();
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

function startServer(port, size) {
  const env = { ...process.env, PORT: String(port), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "w512-")) };
  if (size) env.COLONY_WORLD_SIZE = String(size);
  else delete env.COLONY_WORLD_SIZE;
  const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const s = { proc, log: "", startedAt: Date.now() };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  return s;
}

async function waitForPort(port) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${port} never came up`);
}

function connect(port) {
  const c = { ws: new WebSocket(`ws://localhost:${port}`), welcome: null, snap: null, snapBytes: [], waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      c.snapBytes.push(raw.length);
    }
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 60000) =>
    new Promise((resolve, reject) => {
      c.waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    });
  c.hook = (op, data = {}) => {
    const p = c.wait((m) => m.type === "testHookResult" && m.op === op);
    c.send({ type: "testHook", op, ...data });
    return p;
  };
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

// tsx runs the server in a child: kill the whole process group so no orphan keeps the port.
const kill = (s) => process.kill(-s.proc.pid, "SIGKILL");

async function phaseA() {
  const s = startServer(PORT_A, 512);
  try {
    await waitForPort(PORT_A);
    const bootS = ((Date.now() - s.startedAt) / 1000).toFixed(1);
    const gen = /generated 512x512 in (\d+) ms/.exec(s.log);
    const genMs = gen ? Number(gen[1]) : Infinity;
    result(genMs < 15000, `512 world-gen ${genMs} ms (< 15000); process boot to listening ${bootS}s`);
    const c = connect(PORT_A);
    await c.ready();
    result(c.welcome.worldTilesX === 512 && c.welcome.tiles.length === 512 * 512, `welcome is 512x512 (${c.welcome.tiles.length} tiles)`);
    c.send({ type: "join" });
    await c.hook("tickStats", { reset: true });
    c.snapBytes.length = 0;
    await sleep(20000);
    const st = await c.hook("tickStats", {});
    const bytes = c.snapBytes.slice().sort((a, b) => a - b);
    const avgBytes = Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length));
    const sn = c.snap;
    console.log(
      `entities: colonists=${sn.colonists.length} mobs(in view)=${sn.mobs.length} total mobs=${st.mobs} wildlife(in view)=${sn.wildlife.length / 5}`
    );
    console.log(`tick: samples=${st.samples} avg=${st.avgMs.toFixed(2)} ms p95=${st.p95Ms.toFixed(2)} ms max=${st.maxMs.toFixed(2)} ms`);
    console.log(`snapshot bytes/player: avg=${avgBytes} max=${bytes[bytes.length - 1]} (welcome carries ${JSON.stringify(c.welcome).length} bytes once)`);
    result(st.avgMs < 25, `idle tick avg ${st.avgMs.toFixed(2)} ms < 25`);
    // Save / load round trip at 512 (timings from the server log).
    let sr = c.wait((m) => m.type === "saveResult");
    c.send({ type: "saveGame", slot: "slot1" });
    result((await sr).ok, "512 save ok: " + (/\[save\][^\n]*/.exec(s.log)?.[0] ?? "(no timing logged)"));
    sr = c.wait((m) => m.type === "saveResult" && m.action === "load");
    c.send({ type: "loadGame", slot: "slot1" });
    result((await sr).ok, "512 load ok: " + (/\[load\][^\n]*/.exec(s.log)?.[0] ?? "(no timing logged)"));
    c.ws.close();
  } finally {
    kill(s);
  }
}

async function phaseB() {
  const s = startServer(PORT_B, 0);
  try {
    await waitForPort(PORT_B);
    const c = connect(PORT_B);
    await c.ready();
    result(c.welcome.worldTilesX === 160, `default boots at 160 (${c.welcome.worldTilesX})`);
    c.send({ type: "join" });
    // New Game with a different size on a fresh world: regenerates live.
    let w = c.wait((m) => m.type === "welcome" && m.worldTilesX === 64);
    c.send({ type: "setDifficulty", difficulty: "normal", worldSize: 64 });
    w = await w;
    result(w.tiles.length === 64 * 64 && w.biomes.length === 64 * 64, `setDifficulty{worldSize:64} regenerated live: ${w.tiles.length} tiles, no restart`);
    w = c.wait((m) => m.type === "welcome" && m.worldTilesX === 256);
    c.send({ type: "restart", difficulty: "normal", worldSize: 256 });
    w = await w;
    result(w.tiles.length === 256 * 256, `restart{worldSize:256}: ${w.tiles.length} tiles`);
    const sr = c.wait((m) => m.type === "saveResult");
    c.send({ type: "saveGame", slot: "slot1" });
    result((await sr).ok, "saved slot1 at 256");
    w = c.wait((m) => m.type === "welcome" && m.worldTilesX === 64);
    c.send({ type: "restart", difficulty: "normal", worldSize: 64 });
    await w;
    const lr = c.wait((m) => m.type === "saveResult" && m.action === "load");
    w = c.wait((m) => m.type === "welcome" && m.worldTilesX === 256);
    c.send({ type: "loadGame", slot: "slot1" });
    const [res, w2] = [await lr, await w];
    result(res.ok && w2.tiles.length === 256 * 256, `load restored size 256 from a 64 world (${JSON.stringify(res)})`);
    c.ws.close();
  } finally {
    kill(s);
  }
}

try {
  await phaseA();
  await phaseB();
} catch (err) {
  fails++;
  console.log("ERROR", err);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
