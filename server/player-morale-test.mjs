// Scripted test: strategy mode phase 6 (player regiment morale). Boots its OWN private server (tsx, port
// 20651 by default, PORT env to override) at COLONY_WORLD_SIZE=160 with COLONY_TEST_HOOKS=1 and a temp
// COLONY_SAVE_DIR; kills its process group after. Run from server/: `node player-morale-test.mjs`.
//   A 5-militia regiment carries morale in the snapshot; driven low in contact with orcs far from the Town
//   Center it routs (toast, "routing" state, units flee toward the Town Center and ignore a move order),
//   then rallies once the field is clear; two knights (a regiment under 3) never rout or show morale.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20651);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "160", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "pmorale-")) };
const proc = spawn(TSX, ["src/index.ts"], { cwd: SERVER_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
proc.stdout.on("data", (d) => (log += d));
proc.stderr.on("data", (d) => (log += d));
const kill = () => {
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};
process.on("exit", kill);

async function waitForPort() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${PORT} never came up\n${log}`);
}

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, waiters: [], events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.armyRegiments) c.army = m.armyRegiments;
    } else if (m.type === "event") c.events.push(m);
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hook = (op, data = {}) =>
    new Promise((resolve, reject) => {
      c.waiters.push({ pred: (m) => m.type === "testHookResult" && m.op === op, resolve });
      c.send({ type: "testHook", op, ...data });
      setTimeout(() => reject(new Error(`timeout on ${op}`)), 30000);
    });
  return c;
}

try {
  await waitForPort();
  const c = connect();
  await new Promise((r) => c.ws.on("open", r));
  while (!c.welcome || !c.snap) await sleep(20);
  c.send({ type: "join" });
  const ts = c.welcome.tileSize;
  await c.hook("setRaids", { enabled: false });
  await c.hook("ignorePlayers", { value: true });
  const tc = c.snap.townCenters[0];
  const tcPx = { x: (tc.x + 0.5) * ts, y: (tc.y + 0.5) * ts };
  // A clear field east (or west) of the Town Center, out to 44 tiles (beyond the 12-tile TC bonus).
  const dir = tc.x + 46 < 160 ? 1 : -1;
  for (let i = 4; i <= 44; i++) for (let dy = -9; dy <= 9; dy++) c.send({ type: "testHook", op: "setTileRaw", tx: tc.x + dir * i, ty: tc.y + dy, tile: 0 });
  await c.hook("setTileRaw", { tx: tc.x + dir * 4, ty: tc.y, tile: 0 });
  const px = (tilesOut, dyTiles) => ({ x: (tc.x + dir * tilesOut + 0.5) * ts, y: (tc.y + dyTiles + 0.5) * ts });
  const spawn1 = async (kind, at) => (await c.hook("spawnSoldier", { kind, ...at })).id;
  const mob = async (kind, tilesOut, dy) => (await c.hook("spawnMob", { kind, tx: tc.x + dir * tilesOut, ty: tc.y + dy })).id;
  const ff = (ticks) => c.hook("fastForward", { ticks });
  const state = () => c.hook("bodyState");
  const morale = (data = {}) => c.hook("playerMoraleState", data);

  // Militia 34 tiles out, two knights 30 tiles out on another row (separate regiments by class).
  const mil = [];
  for (let i = 0; i < 5; i++) mil.push(await spawn1("militia", px(34, -2 + i)));
  const kn = [await spawn1("knight", px(26, 6)), await spawn1("knight", px(26, 7))];
  await ff(25);
  let ms = await morale();
  const milReg = ms.unitRegiment[mil[0]];
  const knReg = ms.unitRegiment[kn[0]];
  await sleep(700);
  const snapMil = (c.army ?? []).find((r) => r.id === milReg);
  const snapKn = (c.army ?? []).find((r) => r.id === knReg);
  result(!!milReg && snapMil?.morale === 100, `militia regiment ${milReg} shows morale ${snapMil?.morale}`);
  result(!!knReg && snapKn && snapKn.morale === undefined, `2-knight regiment ${knReg} carries no morale (${snapKn?.morale})`);

  // Contact: a pack of orcs beside the militia (and the knights), morale forced near the rout line.
  const orcs = [];
  for (let i = 0; i < 6; i++) orcs.push(await mob("orc", 38, -2 + i));
  const orcsK = [await mob("orc", 29, 6), await mob("orc", 29, 7)];
  const set = {};
  // 12: even a winning +2 / s keeps it under the rout line (15) at the next evaluation in contact.
  set[milReg] = 12;
  set[knReg] = 0;
  await morale({ setMorale: set });
  let routed = false;
  for (let t = 0; t < 400 && !routed; t += 20) {
    await ff(20);
    ms = await morale();
    routed = ms.regiments.find((r) => r.id === milReg)?.routed === true;
  }
  result(routed, `militia routs (morale ${ms.regiments.find((r) => r.id === milReg)?.morale.toFixed(1)})`);
  await sleep(700);
  result((c.army ?? []).find((r) => r.id === milReg)?.moraleState === "routing", "snapshot moraleState = routing");
  result(c.events.some((e) => e.category === "morale" && /routing!/.test(e.text)), `rout toast: ${c.events.filter((e) => e.category === "morale").map((e) => e.text).join(" / ")}`);
  result(!ms.regiments.find((r) => r.id === knReg)?.routed && !ms.routedUnits.some((id) => kn.includes(id)), "two knights never rout");

  // Order lock: a move order away from the Town Center is ignored; the units close on the Town Center.
  const dTc = (u) => Math.hypot(u.x - tcPx.x, u.y - tcPx.y) / ts;
  let st = await state();
  const before = st.colonists.filter((u) => mil.includes(u.id)).map(dTc);
  c.send({ type: "regimentOrder", unitIds: mil, order: { kind: "move", ...px(44, 0) } });
  c.send({ type: "commandMove", unitIds: mil, x: px(44, 0).x, y: px(44, 0).y });
  await ff(100);
  st = await state();
  const after = st.colonists.filter((u) => mil.includes(u.id)).map(dTc);
  const farRally = st.colonists.filter((u) => mil.includes(u.id)).some((u) => Math.abs(u.rallyX - px(44, 0).x) < ts);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  result(!farRally && avg(after) < avg(before) - 3, `routed units ignore orders and flee toward the TC (${avg(before).toFixed(1)} -> ${avg(after).toFixed(1)} tiles)`);

  // Clear the field: they rally (quiet + morale, or the 25 s cap).
  for (const id of [...orcs, ...orcsK]) await c.hook("damageMob", { mobId: id, amount: 1e6 });
  let rallied = false;
  for (let t = 0; t < 700 && !rallied; t += 20) {
    await ff(20);
    ms = await morale();
    rallied = ms.regiments.find((r) => r.id === milReg)?.routed === false && ms.routedUnits.length === 0;
  }
  result(rallied, `militia rallies (morale ${ms.regiments.find((r) => r.id === milReg)?.morale.toFixed(1)})`);
  result(c.events.some((e) => e.category === "morale" && /rallies/.test(e.text)), "rally toast");
  c.send({ type: "regimentOrder", unitIds: mil, order: { kind: "move", ...px(10, 0) } });
  await ff(10);
  st = await state();
  const obey = st.colonists.filter((u) => mil.includes(u.id)).some((u) => Math.abs(u.rallyX - px(10, 0).x) < 3 * ts);
  result(obey, "after the rally the regiment takes orders again");
  c.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
