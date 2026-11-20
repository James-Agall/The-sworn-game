#!/usr/bin/env node
// Formation-march benchmark (ROADMAP "Perf bench 2026-11-20"). Boots a private scratch server (COLONY_TEST_HOOKS=1,
// temp COLONY_SAVE_DIR, world 256, port BENCH_PORT default 20777), spawns N soldiers with the spawnSoldier hook,
// orders ONE regiment move with width 40, then reads tickStats after a settle. Usage: node scripts/bench-ticks.mjs [N...]
// (default 250 500 1000). Prints avg / p95 / max tick ms per N, one fresh server per N.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(ROOT, "node_modules/.bin/tsx")].find((p) => existsSync(p));
const PORT = Number(process.env.BENCH_PORT ?? 20777);
if ([8080, 5173, 5175].includes(PORT)) throw new Error("refusing a reserved port");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!sizes.length) sizes.push(250, 500, 1000);

async function bench(N) {
  const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "256", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "bench-ticks-")) };
  const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: "ignore", detached: true });
  const kill = () => {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  };
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`http://localhost:${PORT}/saves`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (i > 900) throw new Error("server never came up");
      await sleep(100);
    }
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const waiters = [];
    let welcome = null;
    let snap = null;
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "welcome") welcome = m;
      else if (m.type === "snapshot") snap = m;
      for (const w of waiters.slice()) {
        if (w.pred(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    await new Promise((r) => ws.on("open", r));
    while (!welcome || !snap) await sleep(20);
    const send = (m) => ws.send(JSON.stringify(m));
    const hook = (op, data = {}) =>
      new Promise((resolve, reject) => {
        waiters.push({ pred: (m) => m.type === "testHookResult" && m.op === op, resolve });
        send({ type: "testHook", op, ...data });
        setTimeout(() => reject(new Error(`timeout ${op}`)), 120000);
      });
    send({ type: "join" });
    const ts = welcome.tileSize;
    await hook("setRaids", { enabled: false });
    const tc = snap.townCenters[0];
    const ids = [];
    for (let k = 0; ids.length < N && k < N * 30; k++) {
      const r = await hook("spawnSoldier", {
        kind: k % 5 === 0 ? "archer" : "militia",
        x: (tc.x + 3 + (k % 40) + 0.5) * ts,
        y: (tc.y - 20 + (Math.floor(k / 40) % 40) + 0.5) * ts,
      });
      if (r.id) ids.push(r.id);
    }
    await hook("tickStats", { reset: true });
    send({ type: "regimentOrder", unitIds: ids, order: { kind: "move", x: (tc.x + 60) * ts, y: tc.y * ts, facing: 0, width: 40 } });
    await sleep(500);
    await hook("tickStats", { reset: true });
    await sleep(Number(process.env.BENCH_MS ?? 15000));
    const s = await hook("tickStats");
    console.log(`N=${ids.length} samples=${s.samples} avg=${s.avgMs.toFixed(2)}ms p95=${s.p95Ms.toFixed(2)}ms max=${s.maxMs.toFixed(2)}ms mobs=${s.mobs} systems=${JSON.stringify(s.systems)}`);
    ws.close();
  } finally {
    kill();
  }
}
for (const n of sizes) await bench(n);
