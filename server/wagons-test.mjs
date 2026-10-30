// Scripted test: forts phase E, trader wagons. Self-contained: boots its OWN 256x256 server with
// COLONY_TEST_HOOKS=1 on PORT (default 22160) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node wagons-test.mjs`.
//   E spawn: a Lv1 post gets its wagon (120 HP) + 2 militia + 1 spearman; no civilian population used;
//     Lv2 -> 4 spearmen (220 HP), Lv3 -> 4 pikemen + 1 cavalry (400 HP)
//   T trip: auto-send picks the Friendly settlement, escorts follow (within 8 tiles), it trades at the
//     friendly sell prices (profit formula) and relation +2 + value, then comes home with the gold
//   A attack: a bandit goes for the wagon; the wagon destroyed on the way out -> cargo lost, relation -3,
//     a replacement after a day at a window, for its cost
//   S save / load keeps a wagon on the road (leg, destination, cargo) and its escort follows again
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22160);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const DAY = TICK * 300;
const CYCLE = TICK * 375;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "wagons-test-"));
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

const c = { ws: null, snap: null, events: [], hook: new Map(), saves: [] };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "snapshot") c.snap = m;
    else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 6000 && !c.hook.has(op); i++) await sleep(10);
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
await hook("setCycleTick", { tick: TICK * 5 });

let st = null;
for (const [dx, dy] of [[0, 50], [50, 0], [0, -50], [-50, 0], [50, 50], [-50, -50]]) {
  st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 25 });
  if (st?.site) break;
}
const site = st?.site;
result(!!site, `stamped ${site?.name ?? st?.problem}`);
if (!site) process.exit(1);
const sid = site.id;
await tp(site.keepX, site.keepY + 2);
await ff(40);
const tc = c.snap.townCenters[0];
await tp(tc.x, tc.y + 2);
await hook("diploSet", { siteId: sid, relation: 30, stock: { gold: 600, grain: 0, meat: 0, fruit: 0, wool: 0, wood: 0, rock: 0, iron: 0, clothes: 0, tools: 0 } });
const zero = { grain: 0, meat: 0, fruit: 0, wool: 0, rock: 0, iron: 0, clothes: 0, tools: 0 };
await hook("setStock", { stock: { ...zero, wood: 200, gold: 0 } });
await sleep(150);

// The map's wild mobs / camp guardians would ambush the test wagon: clear all but the settlement's own folk.
const clearMobs = async () => {
  const keep = new Set((await hook("sitesState")).sites.filter((x) => x.id === sid).flatMap((x) => x.alive.map((m) => m.id)));
  await sleep(100);
  for (const m of c.snap.mobs) if (!keep.has(m.id)) await hook("damageMob", { mobId: m.id, amount: 1e7 });
};
await clearMobs();

// ---- E: spawn by level ----
const pop0 = c.snap.population;
// A clear spot next to the Town Center for the post (all 4 neighbours walkable is not required).
const px = tc.x + 4;
const py = tc.y + 4;
let r = await hook("wagonPost", { tx: px, ty: py, level: 1, auto: false });
await ff(TICK + 1);
const postState = async () => (await hook("wagonState")).posts.find((p) => p.key === `${px},${py}`);
let p = await postState();
const kinds = (q) => q.escorts.map((e) => e.kind).sort().join(",");
await sleep(150);
result(p?.wagon?.maxHp === 120 && kinds(p) === "militia,militia,spearman" && c.snap.population === pop0, `E Lv1: wagon ${p?.wagon?.maxHp} HP, escort [${p && kinds(p)}], population ${pop0} -> ${c.snap.population}`);
const wagonSnap = c.snap.colonists.find((u) => u.kind === "wagon");
result(wagonSnap?.wagon?.level === 1 && wagonSnap.wagon.leg === "home" && wagonSnap.wagon.escorts === 3, `E snapshot wagon ${JSON.stringify(wagonSnap?.wagon)}`);
await hook("wagonPost", { tx: px, ty: py, level: 2 });
await ff(TICK + 1);
p = await postState();
const lv2 = p?.wagon?.maxHp === 220 && kinds(p) === "spearman,spearman,spearman,spearman";
await hook("wagonPost", { tx: px, ty: py, level: 3 });
await ff(TICK + 1);
p = await postState();
result(lv2 && p?.wagon?.maxHp === 400 && kinds(p) === "cavalry,pikeman,pikeman,pikeman,pikeman", `E Lv2 220 HP 4 spearmen: ${lv2}; Lv3: ${p?.wagon?.maxHp} HP [${p && kinds(p)}]`);
await hook("wagonPost", { tx: px, ty: py, level: 1 });
await ff(TICK + 1);

// ---- T: a trip to the Friendly settlement ----
await clearMobs();
await hook("setStock", { stock: { ...zero, wood: 200, gold: 0 } });
r = await hook("wagonSend", { tx: px, ty: py, dest: "auto" });
p = r.posts.find((q) => q.key === `${px},${py}`);
const cargo = p?.wagon?.cargo ?? {};
result(r.problem === "" && p.wagon.leg === "out" && p.wagon.dest === `s:${sid}` && (cargo.wood ?? 0) > 0 && p.wagon.value <= 80, `T leaves: problem "${r.problem}", leg ${p?.wagon?.leg}, dest ${p?.wagon?.dest}, cargo ${JSON.stringify(cargo)} value ${p?.wagon?.value}`);
let maxEscortGap = 0;
let samples = 0;
for (let i = 0; i < 80; i++) {
  await ff(TICK * 2);
  p = await postState();
  if (!p?.wagon) break;
  if (p.wagon.leg === "out" && i >= 1) {
    samples++;
    for (const e of p.escorts) maxEscortGap = Math.max(maxEscortGap, Math.hypot(e.x - p.wagon.x, e.y - p.wagon.y) / TILE);
  }
  if (p.wagon.leg === "back") break;
}
result(p?.wagon?.leg === "back" && samples > 0 && maxEscortGap <= 8, `T escorts followed (max gap ${maxEscortGap.toFixed(1)} tiles over ${samples} samples), leg now ${p?.wagon?.leg}`);
// Friendly sell price: base x 0.6 x (2 - 0.85) x (1 - 0.01 n), floor 0.3 base; level 1 profit x1.
const sold = p?.lastTrip?.sold ?? {};
let expect = 0;
for (const [g, n] of Object.entries(sold)) {
  const base = { wood: 1, rock: 1.5, iron: 3, grain: 2, meat: 3, fruit: 3, wool: 2, clothes: 6, tools: 8 }[g] ?? 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.max(base * 0.3, base * 0.6 * 1.15 * (1 - 0.01 * i));
  expect += Math.floor(sum);
}
const rel1 = (await hook("diploSet", { siteId: sid })).relation;
const wantRel = 30 + Math.min(6, 2 + expect / 20);
result(expect > 0 && p.lastTrip.gold === expect && Object.keys(p.lastTrip.bought).length === 0 && Math.abs(rel1 - wantRel) < 0.05, `T trade: sold ${JSON.stringify(sold)} for ${p?.lastTrip?.gold} gold (formula ${expect}), relation 30 -> ${rel1} (want ${wantRel.toFixed(2)})`);
const gold0 = (await hook("setStock", { stock: {} })).stock.gold;
for (let i = 0; i < 80 && p?.wagon?.leg !== "home"; i++) {
  await ff(TICK * 2);
  p = await postState();
}
const gold1 = (await hook("setStock", { stock: {} })).stock.gold;
result(p?.wagon?.leg === "home" && gold1 - gold0 === expect && c.events.some((e) => e.includes("Trader wagon is home")), `T home: leg ${p?.wagon?.leg}, gold ${gold0} -> ${gold1}`);

// ---- A: attacked on the way out, then destroyed ----
await clearMobs();
await hook("setStock", { stock: { ...zero, wood: 200 } });
r = await hook("wagonSend", { tx: px, ty: py, dest: `s:${sid}` });
await ff(TICK * 4);
p = await postState();
const w = p.wagon;
const bandit = await hook("spawnMob", { kind: "banditClubman", tx: Math.floor(w.x / TILE) + 7, ty: Math.floor(w.y / TILE) });
await ff(TICK);
p = await postState();
const targeted = p.attackers.includes(bandit.id);
await ff(TICK * 4);
p = await postState();
const fighting = p.escorts.some((e) => e.state === "attacking" || e.state === "chasing" || e.state === "returning");
result(targeted, `A bandit picks the wagon (attackers ${JSON.stringify(p.attackers)}), escort states ${p.escorts.map((e) => e.state).join(",")} ${fighting}`);
const relA = (await hook("diploSet", { siteId: sid })).relation;
let n = c.events.length;
await hook("damageColonist", { id: w.id, amount: 99999 });
await sleep(150);
p = await postState();
const relB = (await hook("diploSet", { siteId: sid })).relation;
const now = (await hook("wagonState")).cycleTick;
result(!p.wagon && Math.abs(relA - 3 - relB) < 0.01 && p.rebuildAtTick >= now + CYCLE - 5 && c.events.slice(n).some((e) => e.includes("plundered")), `A destroyed: relation ${relA} -> ${relB}, rebuild at ${p.rebuildAtTick} (now ${now}), "${c.events.slice(n).join(" | ")}"`);
// Next window after the rebuild time: dawn of the next cycle.
const dawn = Math.ceil(p.rebuildAtTick / CYCLE) * CYCLE;
await hook("setStock", { stock: { wood: 100 } });
await hook("setCycleTick", { tick: dawn - 2 });
await ff(4);
p = await postState();
const wood = (await hook("setStock", { stock: {} })).stock.wood;
result(!!p.wagon && p.wagon.leg === "home" && wood === 80, `A replacement at dawn: wagon ${!!p.wagon}, wood 100 -> ${wood}`);

// ---- S: save / load with the wagon on the road ----
await hook("setStock", { stock: { ...zero, wood: 200 } });
r = await hook("wagonSend", { tx: px, ty: py, dest: `s:${sid}` });
await ff(TICK);
p = await postState();
const before = `${p.wagon.leg}|${p.wagon.dest}|${JSON.stringify(p.wagon.cargo)}`;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
await hook("wagonRecall", { id: p.wagon.id });
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
await sleep(800);
await ff(1);
p = await postState();
const after = p?.wagon ? `${p.wagon.leg}|${p.wagon.dest}|${JSON.stringify(p.wagon.cargo)}` : "none";
await ff(TICK * 4);
p = await postState();
const gap = p?.wagon ? Math.max(...p.escorts.map((e) => Math.hypot(e.x - p.wagon.x, e.y - p.wagon.y) / TILE)) : 99;
result(c.saves[0]?.ok && c.saves[1]?.ok && after === before && gap <= 8, `S save / load: [${before}] -> [${after}], escort gap ${gap.toFixed(1)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
