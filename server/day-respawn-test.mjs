// Scripted test: long days & vacancies (was dawn/dusk-only respawns) (ROADMAP "Long days & dawn/dusk respawns").
// Self-contained: boots its OWN private server (tsx, COLONY_TEST_HOOKS=1, COLONY_WORLD_SIZE=80,
// COLONY_SAVE_DIR = a temp dir) on PORT (default 19760). Run from server/: `node day-respawn-test.mjs`.
//   A) constants: 300 s day, 60-90 s night, upkeep 3.75 a day, rescaled night goals (1/2/4/7/10).
//   Village life (2026-11-03): the dawn/dusk respawn windows are gone; a dead worker leaves a vacancy.
//   B) a builder killed mid-day: its post is filled by a free villager within a second (no toast, no window).
//   C) one killed at night: the vacancy waits for dawn, then a villager takes it.
//   D) with no free villager the vacancy waits across a dusk and a dawn.
//   E) the queue survives save -> restart -> load; an old-format save (no dayTicks, old 1200+800
//      cycle) loads with its day number and night phase kept and its queue intact; a villager fills it at dawn.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 19760);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const TICK_RATE = 20;

const saveDir = mkdtempSync(path.join(tmpdir(), "colony-dayrespawn-"));
const srv = spawn(TSX, ["src/index.ts"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "80", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let log = "";
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));
const killServer = () => {
  try {
    process.kill(-srv.pid, "SIGKILL");
  } catch {
    /* gone */
  }
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (killServer(), process.exit(1)));

async function waitForPort() {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("server never came up");
}

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, waiters: [], events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") (c.welcome = m), c.welcomes++;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "event") c.events.push(m.text);
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 30000) =>
    new Promise((resolve, reject) => {
      c.waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    });
  c.hook = (op, data = {}) => {
    const p = c.wait((m) => m.type === "testHookResult" && m.op === op, 120000);
    c.send({ type: "testHook", op, ...data });
    return p;
  };
  c.nextSnap = () => c.wait((m) => m.type === "snapshot");
  return c;
}

try {
  await waitForPort();
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcome || !c.snap) await sleep(20);
  await c.hook("setRaids", { enabled: false });
  await c.hook("ignorePlayers", { value: true });
  await c.hook("setInstantBuild", { enabled: true });
  const pause = async (want) => {
    if (c.snap.isPaused !== want) c.send({ type: "pause" });
    while (c.snap.isPaused !== want) await sleep(10);
  };
  await pause(true);

  // ---- A) constants & goals
  let st = await c.hook("respawnState");
  const K = st.constants;
  const CYCLE = K.DAY_TICKS + K.NIGHT_TICKS;
  result(K.DAY_TICKS === 300 * TICK_RATE, `A: day = ${K.DAY_TICKS / TICK_RATE} s (300)`);
  result(K.NIGHT_TICKS >= 60 * TICK_RATE && K.NIGHT_TICKS <= 90 * TICK_RATE, `A: night = ${K.NIGHT_TICKS / TICK_RATE} s (60-90)`);
  result(Math.abs(K.FOOD_PER_COLONIST_PER_DAY - 3.75) < 1e-9, `A: upkeep ${K.FOOD_PER_COLONIST_PER_DAY}/colonist/day (= 1 per 100 s, as before)`);
  result(K.FARM_GROW_TICKS === 3 * (K.FOOD_TIME_MULT ?? 1) * (K.LEGACY_DAY_TICKS + K.LEGACY_NIGHT_TICKS), `A: farm grow stays ${K.FARM_GROW_TICKS / TICK_RATE} s of real time (x FOOD_TIME_MULT since 2026-11-06)`);
  const nightGoals = st.goalTitles.filter((t) => t.startsWith("Survive"));
  result(
    JSON.stringify(nightGoals) === JSON.stringify(["Survive the first night", "Survive 2 nights", "Survive 4 nights", "Survive 7 nights", "Survive 10 nights"]),
    `A: night goals ${JSON.stringify(nightGoals)}`
  );
  await c.hook("setStock", { stock: { grain: 500 } });

  const builders = () => st.colonists.filter((x) => x.kind === "builder").length;
  const ff = async (ticks) => (await c.hook("fastForward", { ticks })).cycleTick;

  // Village life (2026-11-03): no respawn windows any more. A dead worker's post is a vacancy that a free villager
  // fills by day (once a second); at night the vacancy waits for dawn; with no free villager it waits for good.
  const villagers = () => st.colonists.filter((x) => x.kind === "villager").length;
  // ---- B) killed mid-day -> refilled within a second by a free villager
  await c.hook("setCycleTick", { tick: CYCLE + 100 });
  st = await c.hook("respawnState");
  const startBuilders = builders();
  const v0 = villagers();
  const killed = (await c.hook("killColonists", { kind: "builder" })).killed;
  result(killed >= 1, `B: killed ${killed} builder(s)`);
  await ff(1);
  st = await c.hook("respawnState");
  result(st.queue.length === killed && builders() === 0, `B: queued ${st.queue.length}, none back after 1 tick`);
  await ff(TICK_RATE + 1);
  st = await c.hook("respawnState");
  result(st.queue.length === 0 && builders() === startBuilders && villagers() === v0 - killed, `B: a free villager took the post within 1 s (${builders()} builders, villagers ${v0} -> ${villagers()})`);

  // ---- C) killed at night -> filled at dawn
  let tick = (await c.hook("respawnState")).cycleTick;
  await ff(K.DAY_TICKS + 5 - (tick % CYCLE));
  st = await c.hook("respawnState");
  result(st.isNight, `C: night now (cycle tick ${st.cycleTick % CYCLE})`);
  await c.hook("killColonists", { kind: "builder" });
  tick = (await c.hook("respawnState")).cycleTick;
  await ff(CYCLE - (tick % CYCLE) - 1);
  st = await c.hook("respawnState");
  result(st.queue.length === killed && builders() === 0, `C: last night tick: still ${st.queue.length} queued`);
  await ff(TICK_RATE + 1);
  st = await c.hook("respawnState");
  result(st.queue.length === 0 && builders() === startBuilders, `C: filled at dawn (${st.cycleTick % CYCLE})`);

  // ---- D) no free villager: the vacancy waits across dusk and dawn, food or not
  await c.hook("killColonists", { kind: "villager" });
  await c.hook("killColonists", { kind: "builder" });
  tick = (await c.hook("respawnState")).cycleTick;
  await ff(CYCLE - (tick % CYCLE) + TICK_RATE * 2);
  st = await c.hook("respawnState");
  result(st.queue.length === killed && builders() === 0, `D: no villager: ${st.queue.length} still queued after a dusk and a dawn`);

  // ---- E) save / load
  await ff(TICK_RATE * 20);
  await c.hook("killColonists", { kind: "builder" });
  st = await c.hook("respawnState");
  const savedTick = st.cycleTick;
  c.send({ type: "saveGame", slot: "slot1" });
  result((await c.wait((m) => m.type === "saveResult" && m.action === "save")).ok, `E: saved slot1 with ${st.queue.length} queued`);
  const before = c.welcomes;
  c.send({ type: "restart" });
  while (c.welcomes === before) await sleep(20);
  st = await c.hook("respawnState");
  result(st.queue.length === 0, `E: restart empties the queue`);
  c.send({ type: "loadGame", slot: "slot1" });
  await c.wait((m) => m.type === "saveResult" && m.action === "load");
  await pause(true);
  st = await c.hook("respawnState");
  result(st.queue.length === killed && Math.abs(st.cycleTick - savedTick) < 40, `E: load restores the queue (${st.queue.length}) at cycle tick ${st.cycleTick} (saved ${savedTick})`);

  // Old-format save: the old 1200 + 800 cycle, no dayTicks/nightTicks, a ticksRemaining countdown.
  const file = JSON.parse(readFileSync(path.join(saveDir, "slot1.json"), "utf8"));
  delete file.state.dayTicks;
  delete file.state.nightTicks;
  const OLD_DAY = 1200, OLD_CYCLE = 2000;
  file.state.cycleTick = 3 * OLD_CYCLE + OLD_DAY + 400; // day 4, halfway through the old night
  file.state.wasNight = true;
  file.state.raidSpawnedForDay = 3;
  for (const q of file.state.respawnQueue) q.ticksRemaining = 100;
  writeFileSync(path.join(saveDir, "slot2.json"), JSON.stringify(file));
  c.send({ type: "loadGame", slot: "slot2" });
  const lr = await c.wait((m) => m.type === "saveResult" && m.action === "load");
  await pause(true);
  st = await c.hook("respawnState");
  const want = 3 * CYCLE + K.DAY_TICKS + Math.floor(K.NIGHT_TICKS / 2);
  result(lr.ok && Math.abs(st.cycleTick - want) < 40 && st.isNight, `E: old save loads at day 4 mid-night: cycle tick ${st.cycleTick} (~${want}), night ${st.isNight}`);
  result(st.queue.length === killed, `E: old save keeps its queue (${st.queue.length})`);
  await c.hook("peopleState", { spawn: killed });
  await ff(TICK_RATE * 2);
  st = await c.hook("respawnState");
  result(st.queue.length === killed, `E: night: the vacancy waits even with a free villager (${st.queue.length})`);
  await ff(CYCLE - (st.cycleTick % CYCLE) + TICK_RATE + 1);
  st = await c.hook("respawnState");
  result(st.queue.length === 0 && builders() === startBuilders, `E: the old save's vacancy is filled at dawn by the villager`);
  result(!/Error|TypeError/.test(log), `no exceptions in the server log`);
  c.ws.close();
} catch (err) {
  fails++;
  console.log(`FAIL [${el()}] ${err?.stack ?? err}`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
