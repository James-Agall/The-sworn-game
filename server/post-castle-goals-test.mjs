// Scripted test: post-Castle goal chain ("The Sworn Years", DESIGN-REVIEW-nov20 #6). Boots its OWN private server
// (COLONY_TEST_HOOKS=1, scratch COLONY_SAVE_DIR) on PORT (default 18981). Run from server/: `node post-castle-goals-test.mjs`.
//   A: the track ends with camps -> vassal -> gold -> 15 nights after "Clear the Castle Ruin"; snapshot total matches.
//   B: each predicate: partial progress shows in snapshot.goal, completion pays the reward and toasts, order is enforced.
//   C: mid-chain progress survives save -> restart -> load; finishing the last goal reports "Every goal complete".
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 18981);
const t0 = Date.now();
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
// Mirrors of shared/src/endgame.ts.
const CAMPS = 3, GOLD = 600, NIGHTS = 15, CASTLE = 8;
const REWARD = { camps: { gold: 120, iron: 40 }, vassal: { gold: 150, wood: 60, rock: 60 }, gold: { iron: 80, wood: 80, rock: 80 }, nights: { gold: 250, iron: 100, wood: 100, rock: 100 } };

const proc = spawn(TSX, ["src/index.ts"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "160", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "colony-postcastle-")) },
  stdio: ["ignore", "ignore", "ignore"],
  detached: true,
});
const killServer = () => { try { process.kill(-proc.pid, "SIGKILL"); } catch { /* gone */ } };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { killServer(); process.exit(1); });

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, waiters: [], events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcomes++;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "event") c.events.push(m);
    for (const w of c.waiters.slice()) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 20000) => new Promise((resolve, reject) => { c.waiters.push({ pred, resolve }); setTimeout(() => reject(new Error("timeout")), ms); });
  c.hook = (op, data = {}) => { const p = c.wait((m) => m.type === "testHookResult" && m.op === op); c.send({ type: "testHook", op, ...data }); return p; };
  c.nextSnap = () => c.wait((m) => m.type === "snapshot");
  return c;
}
async function waitGoal(c, pred, ms = 6000) {
  const end = Date.now() + ms;
  let st = await c.hook("goalState");
  while (!pred(st) && Date.now() < end) { await sleep(150); st = await c.hook("goalState"); }
  return st;
}
const milestones = (c) => c.events.filter((e) => e.category === "milestone").map((e) => e.text);

try {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://localhost:${PORT}/saves`)).ok) break; } catch { /* not up */ } await sleep(100); }
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcomes || !c.snap) await sleep(20);
  await c.hook("setRaids", { enabled: false });
  await c.hook("ignorePlayers", { value: true });

  // A
  let st = await c.hook("goalState");
  const titles = st.goalTitles;
  result(titles[CASTLE] === "Clear the Castle Ruin" && titles.slice(CASTLE + 1).join("|") === `Destroy ${CAMPS} enemy camps|Take a vassal|Hold ${GOLD} gold|Survive ${NIGHTS} nights`, `A: chain after the Castle: ${titles.slice(CASTLE).join(" -> ")}`);
  await c.hook("setGoalIndex", { index: CASTLE });
  await c.nextSnap();
  result(c.snap.goal.total === titles.length && c.snap.goal.index === CASTLE, `A: snapshot.goal ${c.snap.goal.index + 1}/${c.snap.goal.total}`);

  // B1: camps goal shows partial progress, then pays
  await c.hook("setStock", { stock: { gold: 0, iron: 0, wood: 0, rock: 0 } });
  c.events.length = 0;
  await c.hook("setCampsDestroyed", { count: 0 });
  await c.hook("setGoalIndex", { index: CASTLE + 1 });
  await c.hook("setCampsDestroyed", { count: 2 });
  st = await waitGoal(c, (s) => s.goal.progress === 2);
  result(st.goalIndex === CASTLE + 1 && st.goal.progress === 2 && st.goal.target === CAMPS, `B1: 2 camps -> ${st.goal.progress}/${st.goal.target}, not complete`);
  await c.hook("setCampsDestroyed", { count: CAMPS });
  st = await waitGoal(c, (s) => s.goalIndex >= CASTLE + 2);
  result(st.goalIndex === CASTLE + 2 && st.stock.gold === REWARD.camps.gold && st.stock.iron === REWARD.camps.iron && milestones(c).some((t) => t.startsWith(`Goal complete: Destroy ${CAMPS} enemy camps`)), `B1: camps goal paid ${JSON.stringify(REWARD.camps)} + toast (gold ${st.stock.gold}, iron ${st.stock.iron})`);

  // B2: vassal
  const stamped = await c.hook("stampSite", { template: "hearthmoor", dx: 20, dy: 0, search: 40 });
  const sites = (await c.hook("sitesState")).sites;
  const site = sites.find((s) => !s.vassalOf) ?? sites[0];
  result(!!site, `B2: a settlement exists to vassalise (${sites.length} sites)`);
  await sleep(600);
  st = await c.hook("goalState");
  result(st.goalIndex === CASTLE + 2, `B2: no vassal yet -> still on "Take a vassal"`);
  const gold0 = st.stock.gold, wood0 = st.stock.wood;
  c.events.length = 0;
  await c.hook("vassalSet", { siteId: site.id, clan: 0, vassal: true });
  st = await waitGoal(c, (s) => s.goalIndex >= CASTLE + 3);
  result(st.goalIndex === CASTLE + 3 && st.stock.gold - gold0 === REWARD.vassal.gold && st.stock.wood - wood0 === REWARD.vassal.wood, `B2: vassal goal paid +${st.stock.gold - gold0} gold +${st.stock.wood - wood0} wood`);

  // C: save mid-chain at "Hold gold", restart, load
  await c.hook("setStock", { stock: { gold: 450 } });
  st = await waitGoal(c, (s) => s.goal.progress === 450);
  result(st.goalIndex === CASTLE + 3 && st.goal.target === GOLD, `C: 450 gold -> ${st.goal.progress}/${st.goal.target}`);
  c.send({ type: "saveGame", slot: "slot1" });
  result((await c.wait((m) => m.type === "saveResult")).ok, "C: saved mid-chain");
  const before = c.welcomes;
  c.send({ type: "restart" });
  while (c.welcomes === before) await sleep(20);
  await c.nextSnap();
  st = await c.hook("goalState");
  result(st.goalIndex === 0, "C: restart resets the track");
  c.send({ type: "loadGame", slot: "slot1" });
  await c.wait((m) => m.type === "saveResult" && m.action === "load");
  await c.nextSnap();
  await c.hook("setRaids", { enabled: false });
  st = await c.hook("goalState");
  result(st.goalIndex === CASTLE + 3 && st.campsDestroyed === CAMPS, `C: load restored goal ${st.goalIndex + 1} and campsDestroyed ${st.campsDestroyed}`);

  // B3: gold (index CASTLE+3 is "Hold gold", CASTLE+4 "Survive 15 nights")
  const iron0 = st.stock.iron;
  await c.hook("setStock", { stock: { gold: GOLD } });
  st = await waitGoal(c, (s) => s.goalIndex >= CASTLE + 4);
  result(st.goalIndex === CASTLE + 4 && st.stock.iron - iron0 === REWARD.gold.iron, `B3: ${GOLD} gold completes "Hold gold", iron +${st.stock.iron - iron0}`);

  // B4: nights, final goal
  let tick = 0, nights = 0;
  while (nights < NIGHTS - 1) { tick += 1500; await c.hook("setCycleTick", { tick }); nights = (await c.hook("goalState")).nightsSurvived; }
  st = await waitGoal(c, (s) => s.goal.progress === NIGHTS - 1);
  result(st.goalIndex === CASTLE + 4 && st.goal.progress === NIGHTS - 1 && st.goal.target === NIGHTS, `B4: ${st.goal.progress}/${st.goal.target} nights (idx ${st.goalIndex}, nights ${nights}), not complete`);
  const g1 = st.stock.gold;
  c.events.length = 0;
  while (nights < NIGHTS) { tick += 500; await c.hook("setCycleTick", { tick }); nights = (await c.hook("goalState")).nightsSurvived; }
  st = await waitGoal(c, (s) => s.goalIndex >= CASTLE + 5);
  result(st.goalIndex === titles.length && st.goal.title === "Every goal complete" && st.stock.gold - g1 === REWARD.nights.gold, `B4: final goal complete, +${st.stock.gold - g1} gold`);
  result(milestones(c).some((t) => t.startsWith("Final goal complete")), `B4: final toast: ${JSON.stringify(milestones(c))}`);
} catch (e) {
  fails++;
  console.log(`FAIL exception: ${e.stack || e}`);
} finally {
  killServer();
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
