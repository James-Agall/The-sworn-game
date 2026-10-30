// Scripted test: forts phase C, human settlements. Self-contained: boots its OWN 256x256 server with
// COLONY_TEST_HOOKS=1 on PORT (default 22130) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node settlements-test.mjs`.
//   G world-gen: 2-4 settlements at 256 (Hearthmoor / Ironhold / Riverwatch), >= 80 apart, >= 50 from the start
//   N a stamped Hearthmoor ignores a player standing in its yard (guards dormant, towers silent), workers walk
//   O its gate opens for the player by day, stays shut at night
//   A hitting one guard: the whole garrison wakes, the site is hostile, relation -15 once (not per hit)
//   K the hostile spell runs out: neutral again, guards stand down
//   R razing the keep: cleared, "You attacked a settlement" toast, relation -40 more
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22130);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const GATE_FLAG_OPEN = 1;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "settlements-test-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "256", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
process.on("exit", () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
});

const c = { ws: null, welcome: null, snap: null, events: [], hook: new Map() };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "buildingInfo") c.info = m.info;
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const siteOf = async (id) => (await hook("sitesState")).sites.find((s) => s.id === id);
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const info = async (tx, ty) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: tx, tileY: ty });
  for (let i = 0; i < 300 && c.info === undefined; i++) await sleep(10);
  return c.info;
};
const gateFlags = (index) => {
  const g = c.snap.gates ?? [];
  for (let i = 0; i + 1 < g.length; i += 2) if (g[i] === index) return g[i + 1];
  return undefined;
};

for (let i = 0; i < 200; i++) {
  try {
    connect();
    await new Promise((res, rej) => {
      c.ws.once("open", res);
      c.ws.once("error", rej);
    });
    break;
  } catch {
    await sleep(250);
  }
}
while (!c.snap) await sleep(20);
const tc = c.snap.townCenters[0];
const W = c.welcome.worldTilesX;
send({ type: "pause", paused: true });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });

// ---- G: world-gen ----
const all = (await hook("sitesState")).sites;
const towns = all.filter((s) => s.faction === "human");
result(towns.length >= 2 && towns.length <= 4, `G ${towns.length} settlements at 256: ${towns.map((s) => `${s.name} (${s.template})`).join(", ")}`);
let minApart = Infinity;
for (const a of towns) for (const b of towns) if (a !== b) minApart = Math.min(minApart, Math.hypot(a.keepX - b.keepX, a.keepY - b.keepY));
const minTc = Math.min(...towns.map((s) => Math.hypot(s.keepX - tc.x, s.keepY - tc.y)));
result(minApart >= 80 && minTc >= 50 - 3, `G spacing: ${minApart.toFixed(0)} apart (>= 80), ${minTc.toFixed(0)} from the start (>= ~50)`);
result(towns.every((s) => s.alive.some((m) => m.kind.startsWith("town")) && !s.provoked), "G garrisons are town guards, nobody provoked");

// ---- N: neutral toward a player in the yard ----
await hook("setCycleTick", { tick: TICK * 10 });
let st = null;
for (const [dx, dy] of [[0, 60], [60, 0], [0, -60], [-60, 0], [60, 60], [-60, -60]]) {
  st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 25 });
  if (st?.site) break;
}
const site0 = st?.site;
result(!!site0, `stamped ${site0?.name ?? st?.problem} (keep ${site0?.keepX}, ${site0?.keepY})`);
if (!site0) process.exit(1);
const id = site0.id;
const guardsOf = (s) => s.alive.filter((m) => !s.workerMobs.some((w) => w.id === m.id));
await tp(site0.keepX + 2, site0.keepY + 2);
const hp0 = c.snap.players.find((p) => p.id === c.welcome.playerId)?.hp ?? c.snap.players[0].hp;
await ff(TICK * 6);
await sleep(100);
let s = await siteOf(id);
const me = () => c.snap.players.find((p) => p.id === c.welcome.playerId) ?? c.snap.players[0];
result(s.awake && !s.provoked && guardsOf(s).every((m) => !m.active), `N player in the yard: awake ${s.awake}, provoked ${s.provoked}, ${guardsOf(s).filter((m) => m.active).length} guards active`);
result(me().hp >= hp0, `N towers hold fire (hp ${hp0} -> ${me().hp})`);
const w0 = s.workerMobs;
result(w0.length === 5 && w0.every((w) => !w.active), `N 5 workers spawned (${w0.map((w) => w.role).join(", ")}), none fighting`);
await ff(TICK * 15);
s = await siteOf(id);
const moved = s.workerMobs.filter((w) => {
  const o = w0.find((x) => x.id === w.id);
  return o && Math.hypot(o.x - w.x, o.y - w.y) > TILE * 2;
}).length;
result(moved >= 2, `N workers walk their loops (${moved}/${s.workerMobs.length} moved > 2 tiles in 15 s)`);
let ki = await info(site0.keepX, site0.keepY);
result(ki?.name === `Neutral settlement: ${site0.name}`, `N keep panel "${ki?.name}" (${ki?.bonuses?.join(" | ")})`);

// ---- O: gate open for the player by day, shut at night ----
const gx = site0.x0 + 15;
const gy = site0.y0 + 2;
const gi = gy * W + gx;
await tp(gx, gy - 1);
await ff(TICK);
await sleep(150);
result(((gateFlags(gi) ?? 0) & GATE_FLAG_OPEN) !== 0, `O north gate opens for the player by day (flags ${gateFlags(gi)})`);
const raid = await hook("raidState");
await hook("setCycleTick", { tick: raid.dayTicks + TICK * 5 });
await tp(gx, gy - 3);
await ff(TICK * 3);
await tp(gx, gy - 1);
await ff(TICK);
await sleep(150);
result(((gateFlags(gi) ?? 0) & GATE_FLAG_OPEN) === 0, `O ... and stays shut at night (flags ${gateFlags(gi)})`);
await hook("setCycleTick", { tick: TICK * 20 });

// ---- A: attack wakes the garrison, relation hook ----
await tp(site0.keepX + 2, site0.keepY + 2);
await ff(TICK);
s = await siteOf(id);
const rel0 = s.relation;
const g0 = guardsOf(s)[0];
await hook("damageMob", { mobId: g0.id, amount: 1 });
await ff(2);
s = await siteOf(id);
result(s.provoked && guardsOf(s).every((m) => m.active), `A one hit: hostile ${s.provoked}, ${guardsOf(s).filter((m) => m.active).length}/${guardsOf(s).length} guards awake`);
result(s.workerMobs.every((w) => !w.active), "A the workers do not fight");
result(rel0 === 0 && s.relation === -15, `A relation hook ${rel0} -> ${s.relation}`);
await hook("damageMob", { mobId: g0.id, amount: 1 });
await ff(2);
s = await siteOf(id);
result(s.relation === -15, `A a second hit in the same spell costs nothing more (${s.relation})`);
result(!!c.events.find((e) => e.includes(`${site0.name} takes up arms`)), "A toast: takes up arms");
ki = await info(site0.keepX, site0.keepY);
result(ki?.name === `Hostile settlement: ${site0.name}`, `A keep panel "${ki?.name}"`);

// ---- K: calm down ----
await tp(tc.x, tc.y + 2);
await hook("siteSet", { siteId: id, fields: { hostileUntilTick: 1 } });
await ff(TICK * 2);
s = await siteOf(id);
result(!s.provoked && guardsOf(s).every((m) => !m.active), `K hostile spell over: provoked ${s.provoked}, ${guardsOf(s).filter((m) => m.active).length} guards still active`);

// ---- R: raze the keep ----
await tp(site0.keepX + 2, site0.keepY + 2);
await ff(TICK);
await hook("damageHearth", { siteId: id, amount: 99999 });
await ff(2);
s = await siteOf(id);
result(s.cleared, `R keep razed: cleared ${s.cleared}`);
result(s.relation === -15 - 15 - 40, `R relation after a new attack + the raze: ${s.relation} (expected -70)`);
result(!!c.events.find((e) => e.startsWith("You attacked a settlement")), `R toast: ${c.events.find((e) => e.startsWith("You attacked")) ?? c.events.slice(-3).join(" | ")}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
