// Scripted test: Solo opening goals and a lone scout (ROADMAP "Solo opening goals and a lone scout").
// Self-booting: its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 21940) and a temp COLONY_SAVE_DIR.
// Run from server/: `node solo-opening-test.mjs`.
//   G a Solo start posts the Solo track (gather / shelter / hunt / found a camp), not the settlement one
//   P gathering 20 wood + 10 stone, a shelter and a hunt each advance the track
//   S no scout before day 2; on day 2 one lone bandit appears near the campless hero and no raid group forms
//   F founding the camp switches to the normal track (index 0, "Place a building" first)
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21940);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "soloopen-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "160", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);
setTimeout(() => {
  console.log("FAIL timeout");
  killServer();
  process.exit(1);
}, 120000).unref();

const c = { ws: null, welcome: null, snap: null, hook: new Map() };
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const freshSnap = async () => {
  const before = c.snap;
  for (let i = 0; i < 500 && c.snap === before; i++) await sleep(10);
  return c.snap;
};

try {
  for (let i = 0; i < 100 && !c.ws; i++) {
    const ws = new WebSocket(`ws://localhost:${PORT}/?profile=solo-open`);
    try {
      await new Promise((res, rej) => {
        ws.on("open", res);
        ws.on("error", rej);
      });
      c.ws = ws;
    } catch {
      await sleep(300);
    }
  }
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
  });
  for (let i = 0; i < 500 && !(c.welcome && c.snap); i++) await sleep(20);
  c.welcome = null;
  send({ type: "restart", difficulty: "normal", solo: true });
  for (let i = 0; i < 1500 && !(c.welcome && c.snap); i++) await sleep(20);
  await freshSnap();
  await hook("ignorePlayers", { value: true });

  // G
  let g = await hook("goalState");
  result(g.goalTitles.length === 4 && /wood/i.test(g.goalTitles[0]) && g.goalTitles[3] === "Found a camp" && g.goalIndex === 0, `G Solo track posted: ${g.goalTitles.join(" | ")}`);

  // P
  await hook("heroLife", { pack: { wood: 20, rock: 10 } });
  await hook("fastForward", { ticks: 40 });
  g = await hook("goalState");
  result(g.goalIndex === 1, `P gather goal done -> index ${g.goalIndex}`);
  await hook("heroLife", { pack: { wood: 30, rock: 10 } });
  await hook("heroLife", { action: "build", build: "leanTo" });
  await hook("fastForward", { ticks: 40 });
  g = await hook("goalState");
  result(g.goalIndex === 2, `P shelter goal done -> index ${g.goalIndex}`);
  await hook("heroLife", { skills: { hunting: 10 } });
  await hook("fastForward", { ticks: 40 });
  g = await hook("goalState");
  result(g.goalIndex === 3, `P hunt goal done -> index ${g.goalIndex} (${g.goal.title})`);

  // S
  const rs = await hook("raidState");
  const day = rs.cycleTick - (rs.cycleTick % (rs.dayTicks + rs.nightTicks));
  const gdt = rs.dayTicks + rs.nightTicks;
  const scouts = () => {
    const p = c.snap.players.find((q) => q.id === c.welcome.id);
    return (c.snap.mobs ?? []).filter((m) => m.kind === "banditClubman" && Math.hypot(m.x - p.x, m.y - p.y) / TILE < 12);
  };
  await hook("setCycleTick", { tick: gdt + Math.floor(rs.dayTicks * 0.6) });
  await hook("fastForward", { ticks: 5 });
  await freshSnap();
  result(scouts().length === 0, `S no scout on day 1 (${scouts().length})`);
  await hook("setCycleTick", { tick: 2 * gdt + Math.floor(rs.dayTicks * 0.6) });
  await hook("fastForward", { ticks: 5 });
  await freshSnap();
  const me = c.snap.players.find((p) => p.id === c.welcome.id);
  const sc = scouts();
  const dist = sc[0] ? Math.hypot(sc[0].x - me.x, sc[0].y - me.y) / TILE : 99;
  const groups = (await hook("raidState")).groups.length;
  result(sc.length === 1 && dist <= 8 && groups === 0, `S one scout ${dist.toFixed(1)} tiles away, raid groups ${groups}`);
  void day;

  // F
  await hook("heroLife", { pack: { wood: 40, rock: 20 } });
  await hook("heroLife", { action: "foundCamp" });
  await hook("fastForward", { ticks: 10 });
  g = await hook("goalState");
  result(g.goalIndex === 0 && g.goalTitles.length > 4 && g.goalTitles[0] === "Place a building", `F camp founded -> normal track (${g.goalTitles.length} goals, first "${g.goalTitles[0]}", index ${g.goalIndex})`);
} catch (e) {
  result(false, `exception ${e?.stack ?? e}`);
}
killServer();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
