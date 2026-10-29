// Scripted test: raid morale retune (ROADMAP "Raid morale retune — landed").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>, default world size.
// Pauses the world and works in a cleared arena well west of the Town Center (as tactics-test).
//
//   A raid group of 8 orcs (in contact formation) vs 8 defensive knights (a losing fight for it, ratio ~0.3):
//   1. once in contact, 2 orcs are killed: for the rest of the fight (up to 20 s) the raid never routs
//      while 3+ are still standing (old tuning: it broke ~4 s later, at morale 0, with 3 still alive);
//   2. then it is cut down to 2 of 8 (25%): crushed, it routs ("rout" tactics event) within a few seconds.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, hook: new Map() };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const tactics = () => hook("tacticsState");

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
const px = (tx) => tx * TILE + TILE / 2;

const A = { x: TCT.x - 34, y: TCT.y };
for (let dy = -12; dy <= 12; dy++) for (let dx = -20; dx <= 20; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: 0 });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: 0 });
const bs = await hook("bodyState");
for (const m of bs.mobs) {
  if (Math.abs(m.x - px(A.x)) <= 30 * TILE && Math.abs(m.y - px(A.y)) <= 24 * TILE) await hook("damageMob", { mobId: m.id, amount: 99999 });
}
for (const k of ["knight", "archer"]) await hook("killColonists", { kind: k });
await ff(2);

for (let i = 0; i < 8; i++) await hook("spawnSoldier", { kind: "knight", x: px(A.x - 2), y: px(A.y - 4 + i), stance: "defensive" });
await ff(2);
const g = await hook("spawnRaidGroup", { kinds: Array(8).fill("orc"), tx: A.x + 4, ty: A.y - 2 });
const reg = (ts) => ts.regiments.find((r) => r.id === g.id);
const alive = (ts) => ts.mobs.filter((m) => m.regiment === g.id);
const routed = (ts) => ts.events.some((e) => e.regiment === g.id && e.type === "rout");

// Wait for contact (the regiment sees the knights: a finite ratio).
let ts = await tactics();
for (let i = 0; i < 40 && reg(ts)?.ratio == null; i++) {
  await ff(5);
  ts = await tactics();
}
info(`contact: ${JSON.stringify(reg(ts))}, ${alive(ts).length} orcs`);
result(reg(ts)?.ratio != null, "contact made");

// 1. The first two casualties.
for (const m of alive(ts).slice(0, 2)) await hook("damageMob", { mobId: m.id, amount: 99999 });
let minMorale = 100;
let routWith = null;
const trace = [];
for (let i = 0; i < 20; i++) {
  await ff(20);
  ts = await tactics();
  const r = reg(ts);
  minMorale = Math.min(minMorale, r?.morale ?? 100);
  trace.push(`${alive(ts).length}:m${(r?.morale ?? 100).toFixed(0)}:r${r?.ratio?.toFixed(2)}`);
  if (routed(ts) && routWith === null) routWith = alive(ts).length;
  if (alive(ts).length <= 2) break;
}
info(`after 2 kills: ${trace.join(" ")} (alive:morale:ratio per second)`);
result(routWith === null || routWith <= 2, `8 orcs vs 8 knights: no rout after the first 2 casualties while 3+ stand (min morale ${minMorale.toFixed(1)}, rout with ${routWith ?? "-"} left)`);

// 2. Cut down to 2 of 8: crushed, it routs.
const left = alive(ts);
for (const m of left.slice(0, Math.max(0, left.length - 2))) await hook("damageMob", { mobId: m.id, amount: 99999 });
for (let i = 0; i < 10 && !routed(ts); i++) {
  await ff(10);
  ts = await tactics();
}
info(`crushed: ${JSON.stringify(reg(ts))}, events ${JSON.stringify(ts.events.filter((e) => e.regiment === g.id))}`);
result(routed(ts), `cut down to ${Math.min(2, alive(ts).length)} of 8: the raid routs`);

console.log(fails === 0 ? `\nALL PASS [${el()}]` : `\n${fails} FAIL(S) [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
