// Scripted test: forts phase D2, settlement help quests. Self-contained: boots its OWN 256x256 server with
// COLONY_TEST_HOOKS=1 on PORT (default 22150) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node quests-test.mjs`.
//   N no quests from a Hostile settlement (scan and forced post)
//   P posting rules: a scan posts, at most 2 open per settlement per clan; snapshot `quests` reaches the client
//   I ignoring (expiry unaccepted) costs relation
//   D deliver: accept, refused without the goods, delivered -> gold + relation, goods handed over
//   C clear the camp: accepted, the camp's keep falls to the clan -> gold
//   F failure: an accepted quest that expires costs more; abandoning costs relation; defend only at night
//   S save / load keeps open quests and their acceptance
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22150);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "quests-test-"));
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

const c = { ws: null, snap: null, events: [], hook: new Map(), saves: [], quests: null };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "snapshot") {
      c.snap = m;
      if (m.quests) c.quests = m.quests;
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
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
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

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
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });
await hook("setCycleTick", { tick: TICK * 10 });

let st = null;
let off = null;
for (const [dx, dy] of [[0, 60], [60, 0], [0, -60], [-60, 0], [60, 60], [-60, -60]]) {
  st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 25 });
  if (st?.site) {
    off = [dx, dy];
    break;
  }
}
const site = st?.site;
result(!!site, `stamped ${site?.name ?? st?.problem}`);
if (!site) process.exit(1);
const id = site.id;
const kx = site.keepX;
const ky = site.keepY;
const rel = (v) => hook("diploSet", { siteId: id, relation: v });
const relNow = async () => (await hook("diploSet", { siteId: id })).relation;
const qs = async () => (await hook("questState")).quests.filter((q) => q.siteId === id);
const expire = async (qid) => {
  await hook("questState", { id: qid, expiresTick: (await hook("questState")).cycleTick });
  await ff(2);
};
const msg = async (type, questId) => {
  const n = c.events.length;
  send({ type, questId });
  await sleep(150);
  return c.events.slice(n).join(" | ");
};
// A bandit fort near it for the clear-the-camp quest (stamped before the scans so camps exist).
const fort = await hook("stampSite", { template: "thornwick", dx: off[0] + (off[0] === 0 ? 40 : 0), dy: off[1] + (off[1] === 0 ? 40 : 0), search: 25 });
// Sight the settlement (keep tile explored), stand in trade range, keep the settlement short of wood.
await tp(kx, ky + 2);
await ff(40);
await tp(kx + 2, site.y1 + 3);
await hook("diploSet", { siteId: id, stock: { wood: 0, rock: 0, iron: 0, clothes: 0, tools: 0 } });

// ---- N: no quests from a Hostile settlement ----
await rel(-60);
let scan = await hook("questScan");
const forced = await hook("questPost", { siteId: id, kind: "deliver" });
result(scan.posted.filter((q) => q.siteId === id).length === 0 && forced.quest === null && /hostile/.test(forced.problem), `N hostile: scan posted ${scan.posted.filter((q) => q.siteId === id).length}, forced -> "${forced.problem}"`);

// ---- P: posting rules ----
await rel(0);
scan = await hook("questScan");
const first = scan.posted.filter((q) => q.siteId === id).length;
await hook("questScan");
await hook("questScan");
let open = await qs();
result(first === 1 && open.length === 2, `P scans post one at a time, cap 2 per settlement: first ${first}, open ${open.length} (${open.map((q) => q.kind).join(", ")})`);
await sleep(300);
const sq = (c.quests ?? []).filter((q) => q.siteNum === site.num);
result(sq.length === 2 && sq.every((q) => q.title && q.reward > 0 && q.ticksLeft > 0 && !q.accepted), `P snapshot quests: ${sq.map((q) => `"${q.title}" ${q.reward}g`).join(", ")}`);

// ---- I: ignoring costs relation ----
let n = c.events.length;
for (const q of open) await expire(q.id);
let r = await relNow();
result((await qs()).length === 0 && Math.abs(r - -6) < 0.01 && c.events.slice(n).some((e) => e.includes("You ignored")), `I two ignored quests: relation 0 -> ${r}`);

// ---- D: deliver ----
await rel(0);
let p = await hook("questPost", { siteId: id, kind: "deliver" });
const dq = p.quest;
result(!!dq && dq.good && dq.qty > 0 && dq.reward > 0, `D posted: deliver ${dq?.qty} ${dq?.good} for ${dq?.reward} gold`);
let txt = await msg("deliverQuest", dq.id);
result(txt.includes("Accept the quest first"), `D deliver before accepting refused: "${txt}"`);
txt = await msg("acceptQuest", dq.id);
result(txt.includes("Quest accepted") && (await qs()).find((q) => q.id === dq.id)?.accepted, `D accepted: "${txt}"`);
await hook("setStock", { stock: { [dq.good]: 3, gold: 0 } });
txt = await msg("deliverQuest", dq.id);
result(txt.includes("You have only 3"), `D refused without the goods: "${txt}"`);
await hook("setStock", { stock: { [dq.good]: dq.qty + 5 } });
const theirs0 = (await hook("diploSet", { siteId: id })).stock[dq.good] ?? 0;
txt = await msg("deliverQuest", dq.id);
let s0 = (await hook("setStock", { stock: {} })).stock;
let d = await hook("diploSet", { siteId: id });
result(txt.includes("Quest complete") && s0[dq.good] === 5 && s0.gold === dq.reward && d.stock[dq.good] === theirs0 + dq.qty, `D delivered: "${txt}" (stock ${s0[dq.good]} ${dq.good}, gold ${s0.gold}, theirs ${theirs0} -> ${d.stock[dq.good]})`);
result(Math.abs(d.relation - 6) < 0.01 && Math.abs(d.diplo.questGain - 6) < 0.01 && !(await qs()).some((q) => q.id === dq.id), `D relation +6 (questGain ${d.diplo.questGain}), quest closed`);

// ---- C: clear the camp ----
p = await hook("questPost", { siteId: id, kind: "clearCamp" });
const cq = p.quest;
result(!!cq?.targetId, `C posted: ${cq ? `camp ${cq.targetId} at ${cq.x},${cq.y} for ${cq.reward} gold` : p.problem} (stamped fort: ${fort?.site?.name ?? fort?.problem})`);
if (cq) {
  await msg("acceptQuest", cq.id);
  const gold0 = (await hook("setStock", { stock: {} })).stock.gold;
  n = c.events.length;
  await hook("damageHearth", { siteId: cq.targetId, amount: 999999 });
  await sleep(150);
  const gold1 = (await hook("setStock", { stock: {} })).stock.gold;
  result(gold1 - gold0 >= cq.reward && !(await qs()).some((q) => q.id === cq.id) && c.events.slice(n).some((e) => e.includes("Quest complete: Clear the camp")), `C camp cleared: gold ${gold0} -> ${gold1} (reward ${cq.reward}), ${c.events.slice(n).filter((e) => e.includes("Quest")).join(" | ")}`);
}

// ---- F: failure, abandon, defend by day ----
await rel(0);
p = await hook("questPost", { siteId: id, kind: "deliver" });
await msg("acceptQuest", p.quest.id);
n = c.events.length;
await expire(p.quest.id);
r = await relNow();
result(Math.abs(r - -8) < 0.01 && c.events.slice(n).some((e) => e.includes("Quest failed")), `F accepted quest expired: relation 0 -> ${r}`);
await rel(0);
p = await hook("questPost", { siteId: id, kind: "deliver" });
await msg("acceptQuest", p.quest.id);
txt = await msg("abandonQuest", p.quest.id);
r = await relNow();
result(Math.abs(r - -5) < 0.01 && txt.includes("abandoned") && !(await qs()).some((q) => q.id === p.quest.id), `F abandoned: relation 0 -> ${r} ("${txt}")`);
p = await hook("questPost", { siteId: id, kind: "defend" });
result(p.quest === null && /night/.test(p.problem), `F defend refused by day: "${p.problem}"`);

// ---- S: save / load ----
await rel(0);
p = await hook("questPost", { siteId: id, kind: "deliver" });
await msg("acceptQuest", p.quest.id);
const saved = (await qs()).map((q) => `${q.id}:${q.kind}:${q.accepted}`).sort().join(",");
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
await msg("abandonQuest", p.quest.id);
await hook("questPost", { siteId: id, kind: "deliver" });
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
await sleep(800);
const loaded = (await qs()).map((q) => `${q.id}:${q.kind}:${q.accepted}`).sort().join(",");
result(c.saves[0]?.ok && c.saves[1]?.ok && saved !== "" && loaded === saved, `S save / load: saved [${saved}] loaded [${loaded}]`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
