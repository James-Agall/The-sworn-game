#!/usr/bin/env node
// Test runner: `npm test` (from the repo root) runs every server/*-test.mjs and client/*-test.mjs one at a time,
// prints PASS/FAIL per file and a summary, and exits non-zero if any file failed.
//
//   npm test                      all tests
//   npm test -- town hero         only files whose name contains "town" or "hero"
//   npm test -- --timeout 300     per-test timeout in seconds (default: per-test table below, else 900)
//   npm test -- --list            print the selected files and exit
//
// Every test gets a private block of 10 ports (from 31000 up, checked free first; never 8080). Tests that boot their
// own server (they spawn src/index.ts themselves) get PORT / PORT_A / PORT_B / PORT_C inside the block. For the
// others the runner boots a fresh server on the block's first port with COLONY_TEST_HOOKS=1, a scratch
// COLONY_SAVE_DIR and the world size / env the test needs (SERVER_ENV below), then runs the test against it.
// Cleanup after each file: the test's and the server's process groups are killed, then anything still listening
// on the block's ports (servers a test spawned detached) is killed by PID. Logs: <tmp>/colony-test-logs/<name>.log.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, createWriteStream } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "server");
const CLIENT_DIR = path.join(ROOT, "client");
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(ROOT, "node_modules/.bin/tsx")].find((p) =>
  existsSync(p),
);
const LOG_DIR = path.join(os.tmpdir(), "colony-test-logs");
const PORT_BASE = 31000;
const PORT_BLOCK = 10;
const NEVER_PORTS = new Set([8080, 5173, 5175]);
const DEFAULT_TIMEOUT_S = 900;

// Env for the server the runner boots (tests that don't spawn their own); it is passed to the test process too.
// World 160 is the server default. INSTANT: the older suites that place buildings and expect them at once
// (COLONY_INSTANT_BUILD=1, see ROADMAP "Builders, construction ..."); the builder suites test construction itself.
const W80 = { COLONY_WORLD_SIZE: "80" };
const INSTANT = { COLONY_INSTANT_BUILD: "1" };
const SERVER_ENV = {
  "abbey-ward": INSTANT,
  "army-damage": { ...W80, ...INSTANT },
  "builders-farmers": W80,
  "builders-towncenter": W80,
  "building-damage": { ...W80, ...INSTANT },
  difficulty: W80,
  economy: INSTANT,
  "economy-goods": { ...W80, ...INSTANT },
  "gates-walls": W80,
  "gravestone-events": INSTANT,
  "halflatch-ward-lapse": INSTANT,
  "happiness-militia-tavern": { ...W80, ...INSTANT },
  "houses-barns-castles": { ...W80, ...INSTANT },
  "hunger-roads": W80,
  "hunting-foraging": { ...W80, ...INSTANT },
  "industrial-synergy": { ...W80, ...INSTANT },
  "pause-restart": INSTANT,
  "raid-waves": W80,
  "shelter-overflow": { ...W80, ...INSTANT },
  "slow-farming": W80,
  "starting-stock": INSTANT,
  synergies: { ...W80, ...INSTANT },
  "tile-sprites-roundtrip": INSTANT,
  "towers-farms": W80,
  "town-center": INSTANT,
  "upgrades-church": { ...W80, ...INSTANT },
  "walls-regrow": INSTANT,
  "ward-priest-patrol": INSTANT,
  "world-gen-poi": W80,
};
// Per-test timeouts (seconds) for the long ones; --timeout overrides all.
const TIMEOUT_S = {
  "abbey-ward": 1200,
  "army-damage": 1000,
  "halflatch-ward-lapse": 1200,
  "gravestone-events": 900,
  "ward-priest-patrol": 900,
};

const args = process.argv.slice(2);
let timeoutOverride = null;
let listOnly = false;
const filters = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--timeout") timeoutOverride = Number(args[++i]);
  else if (args[i] === "--list") listOnly = true;
  else filters.push(args[i]);
}

const collect = (dir, label) =>
  readdirSync(dir)
    .filter((f) => f.endsWith("-test.mjs"))
    .sort()
    .map((f) => ({ file: path.join(dir, f), dir, label: `${label}/${f}`, name: f.replace(/-test\.mjs$/, "") }));
const all = [...collect(SERVER_DIR, "server"), ...collect(CLIENT_DIR, "client")];
const selected = filters.length ? all.filter((t) => filters.some((f) => t.label.includes(f))) : all;
if (listOnly || !selected.length) {
  for (const t of selected) console.log(t.label);
  if (!selected.length) console.log(`No test matches ${filters.join(", ")}`);
  process.exit(selected.length ? 0 : 1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
const portOpen = (port) =>
  new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });

let nextBlock = PORT_BASE;
async function allocBlock() {
  for (;;) {
    const base = nextBlock;
    nextBlock += PORT_BLOCK;
    const ports = Array.from({ length: PORT_BLOCK }, (_, i) => base + i);
    if (ports.some((p) => NEVER_PORTS.has(p))) continue;
    const free = await Promise.all(ports.map(portFree));
    if (free.every(Boolean)) return base;
  }
}

function killGroup(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
    // The leader may be gone while its group lives on; try the group anyway.
    if (proc?.pid) try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    return;
  }
  try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(-proc.pid, "SIGKILL"); } catch {} }, 2000).unref();
}

// PIDs listening on a port (ss output: users:(("node",pid=123,fd=20))).
function listeners(port) {
  try {
    const out = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  } catch {
    return [];
  }
}
async function sweepBlock(base) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pids = new Set();
    for (let p = base; p < base + PORT_BLOCK; p++) if (!NEVER_PORTS.has(p)) for (const pid of listeners(p)) pids.add(pid);
    if (!pids.size) return;
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try { process.kill(pid, attempt < 3 ? "SIGTERM" : "SIGKILL"); } catch {}
    }
    await sleep(500);
  }
}

const started = new Set();
const cleanupAll = () => { for (const p of started) killGroup(p); };
process.on("SIGINT", () => { cleanupAll(); process.exit(130); });
process.on("SIGTERM", () => { cleanupAll(); process.exit(143); });

async function bootServer(port, env, log) {
  const proc = spawn(TSX, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), COLONY_TEST_HOOKS: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  started.add(proc);
  proc.stdout.on("data", (d) => log.write(`[server] ${d}`));
  proc.stderr.on("data", (d) => log.write(`[server] ${d}`));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited early (code ${proc.exitCode})`);
    if (await portOpen(port)) return proc;
    await sleep(250);
  }
  throw new Error("server did not start listening within 60 s");
}

mkdirSync(LOG_DIR, { recursive: true });
const results = [];
const tAll = Date.now();
console.log(`Running ${selected.length} test file(s); logs in ${LOG_DIR}`);
for (const t of selected) {
  const base = await allocBlock();
  const logPath = path.join(LOG_DIR, `${t.label.replace("/", "__")}.log`);
  const log = createWriteStream(logPath);
  const src = readFileSync(t.file, "utf8");
  const selfServer = /\bspawn\(/.test(src);
  const isServerTest = t.dir === SERVER_DIR;
  const timeoutS = timeoutOverride ?? TIMEOUT_S[t.name] ?? DEFAULT_TIMEOUT_S;
  const saveDir = mkdtempSync(path.join(os.tmpdir(), "colony-test-save-"));
  const t0 = Date.now();
  let server = null;
  let status = "FAIL";
  let note = "";
  let tail = [];
  try {
    const env = { ...process.env, PORT: String(base), PORT_A: String(base), PORT_B: String(base + 1), PORT_C: String(base + 2) };
    if (isServerTest && !selfServer) {
      Object.assign(env, SERVER_ENV[t.name] ?? {});
      server = await bootServer(base, { COLONY_SAVE_DIR: saveDir, ...(SERVER_ENV[t.name] ?? {}) }, log);
    }
    const proc = spawn(process.execPath, [t.file], { cwd: t.dir, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    started.add(proc);
    let out = "";
    const onData = (d) => {
      log.write(d);
      out += d;
      if (out.length > 200000) out = out.slice(-100000);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killGroup(proc); }, timeoutS * 1000);
    const code = await new Promise((r) => proc.on("close", (c) => r(c)));
    clearTimeout(timer);
    killGroup(proc);
    started.delete(proc);
    const lines = out.split("\n").filter(Boolean);
    const failLines = lines.filter((l) => /^\s*FAIL\b/.test(l));
    if (timedOut) note = `timed out after ${timeoutS}s`;
    else if (code === 0) status = "PASS";
    else note = `exit ${code}${failLines.length ? `, ${failLines.length} FAIL line(s)` : ""}`;
    tail = failLines.length ? failLines.slice(0, 12) : lines.slice(-8);
  } catch (e) {
    note = String(e.message ?? e);
  } finally {
    if (server) { killGroup(server); started.delete(server); }
    await sweepBlock(base);
    log.end();
    rmSync(saveDir, { recursive: true, force: true });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  results.push({ label: t.label, status, note, secs });
  console.log(`${status} ${t.label} (${secs}s)${note ? ` - ${note}` : ""}`);
  if (status !== "PASS") for (const l of tail) console.log(`    ${l}`);
}

const failed = results.filter((r) => r.status !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - tAll) / 60000).toFixed(1)} min`);
if (failed.length) {
  console.log("Failed:");
  for (const r of failed) console.log(`  ${r.label}${r.note ? ` (${r.note})` : ""}`);
}
process.exit(failed.length ? 1 : 0);
