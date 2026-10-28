// Scripted test: strategy mode phase 3 regiment orders (`regimentOrder`, snapshot `orderGroups`). Boots its
// OWN private server (tsx, port 20633 by default, PORT env to override) at COLONY_WORLD_SIZE=160 with
// COLONY_TEST_HOOKS=1 and a temp COLONY_SAVE_DIR; kills its process group after. Run from server/:
// `node orders-test.mjs`.
//   A dragged line (facing + width) forms exactly the formation.ts slots, every unit standing on its slot;
//   a 3-waypoint queue is marched in order and ends formed at the last; attack-move halts on contact,
//   fights and resumes to its destination; retreat ignores a goblin 3 tiles off and heads for the Town
//   Center; a per-unit commandMove takes that unit out of its order group; follow re-forms behind the rider;
//   a junk order (NaN, unknown kind) is ignored.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20633);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "160", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "orders-")) };
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
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, groups: null, waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.orderGroups) c.groups = m.orderGroups;
    }
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
  // A clear field east (or west) of the Town Center: tiles tc+4 .. tc+30, rows tc-9 .. tc+9.
  const dir = tc.x + 32 < 160 ? 1 : -1;
  for (let i = 4; i <= 30; i++) for (let dy = -9; dy <= 9; dy++) c.send({ type: "testHook", op: "setTileRaw", tx: tc.x + dir * i, ty: tc.y + dy, tile: 0 });
  await c.hook("setTileRaw", { tx: tc.x + dir * 4, ty: tc.y, tile: 0 });
  const px = (tilesOut, dyTiles) => ({ x: (tc.x + dir * tilesOut + 0.5) * ts, y: (tc.y + dyTiles + 0.5) * ts });

  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await c.hook("spawnSoldier", { kind: "knight", ...px(6, -3 + i) })).id);
  for (let i = 0; i < 3; i++) ids.push((await c.hook("spawnSoldier", { kind: "archer", ...px(5, -1 + i) })).id);
  result(ids.every(Boolean), `spawned ${ids.length} soldiers`);
  const knights = ids.slice(0, 6);
  const archers = ids.slice(6);
  const body = async () => (await c.hook("bodyState")).colonists.filter((u) => ids.includes(u.id));
  const groups = async () => {
    c.groups = null;
    for (let i = 0; i < 100 && !c.groups; i++) await sleep(20);
    return c.groups ?? [];
  };
  const groupOf = (gs, id) => gs.find((g) => g.unitIds.includes(id));
  // Polls fresh orderGroups until pred holds (a snapshot already on its way may predate the last message).
  const groupsUntil = async (pred) => {
    let gs = [];
    for (let i = 0; i < 10; i++) {
      gs = await groups();
      if (pred(gs)) break;
    }
    return gs;
  };
  const order = (o, queue, unitIds = ids) => c.send({ type: "regimentOrder", unitIds, order: o, ...(queue ? { queue: true } : {}) });
  const ff = (ticks) => c.hook("fastForward", { ticks });
  const centroid = (list, kx = "x", ky = "y") => ({ x: list.reduce((s, u) => s + u[kx], 0) / list.length, y: list.reduce((s, u) => s + u[ky], 0) / list.length });

  // A: a dragged line, facing east (0 rad), 6 tiles wide, at 14 tiles out.
  const facing = dir === 1 ? 0 : Math.PI;
  const A = px(14, 0);
  order({ kind: "move", ...A, facing, width: 6 });
  await ff(400);
  let units = await body();
  const kn = units.filter((u) => knights.includes(u.id));
  const ar = units.filter((u) => archers.includes(u.id));
  const ys = kn.map((u) => u.rallyY);
  const span = Math.max(...ys) - Math.min(...ys);
  // formation.ts for 9 units, normal stance (33.6 px spacing): 6 front cols 38.4 px apart (192 px), archers
  // a 5-wide rear line 2.5 tiles (80 px) behind.
  result(kn.every((u) => Math.abs(u.rallyX - A.x) < 0.5) && Math.abs(span - 192) < 1, `line: knights on the front line, 192 px wide (span ${span.toFixed(1)})`);
  result(ar.every((u) => Math.abs(u.rallyX - (A.x - dir * 80)) < 0.5), "line: archers on the rear line 80 px behind");
  result(units.every((u) => Math.hypot(u.x - u.rallyX, u.y - u.rallyY) < 4), "line: every unit stands on its slot");
  let gs = await groups();
  const g0 = groupOf(gs, ids[0]);
  result(!!g0 && g0.unitIds.length === 9 && g0.order === null && Math.abs(g0.facing - facing) < 1e-9 && g0.width === 6, `one order group, done, facing / width kept (${g0?.id})`);

  // B: a 3-waypoint queue (plain click, then two Shift-clicks).
  const W = [px(24, 0), px(24, 6), px(12, 6)];
  order({ kind: "move", ...W[0] });
  order({ kind: "move", ...W[1] }, true);
  order({ kind: "move", ...W[2] }, true);
  const seen = [];
  for (let t = 0; t < 2400; t += 20) {
    await ff(20);
    const r = centroid(await body(), "rallyX", "rallyY");
    const near = W.findIndex((w) => Math.hypot(w.x - r.x, w.y - r.y) < 4 * ts);
    if (near >= 0 && seen[seen.length - 1] !== near) seen.push(near);
    if (near === 2 && (await body()).every((u) => Math.hypot(u.x - u.rallyX, u.y - u.rallyY) < 4)) break;
  }
  units = await body();
  gs = await groups();
  result(seen.join(",") === "0,1,2", `queue: waypoints marched in order (${seen.join(",")})`);
  result(units.every((u) => Math.hypot(u.x - u.rallyX, u.y - u.rallyY) < 4) && Math.hypot(centroid(units).x - W[2].x, centroid(units).y - W[2].y) < 3 * ts,
    "queue: ends formed at the last waypoint");
  result(groupOf(gs, ids[0])?.queue.length === 0, "queue: empty at the end");

  // C: attack-move through an armoured orc standing on the path.
  const dest = px(26, 6);
  const orc = (await c.hook("spawnMob", { kind: "armoredOrc", tx: tc.x + dir * 19, ty: tc.y + 6 })).id;
  order({ kind: "attackMove", ...dest });
  let halted = false;
  let fought = false;
  for (let t = 0; t < 600 && !(halted && fought); t += 5) {
    await ff(5);
    units = await body();
    const r = centroid(units, "rallyX", "rallyY");
    if (Math.hypot(r.x - dest.x, r.y - dest.y) > 3 * ts) halted = true;
    if (units.some((u) => u.targetMobId === orc)) fought = true;
  }
  result(halted && fought, `attack-move: halts on contact and fights (halted ${halted}, fought ${fought})`);
  let orcGone = false;
  for (let t = 0; t < 2400; t += 20) {
    await ff(20);
    const st = await c.hook("bodyState");
    orcGone = !st.mobs.some((m) => m.id === orc);
    units = st.colonists.filter((u) => ids.includes(u.id));
    if (orcGone && Math.hypot(centroid(units).x - dest.x, centroid(units).y - dest.y) < 3 * ts) break;
  }
  result(orcGone && Math.hypot(centroid(units).x - dest.x, centroid(units).y - dest.y) < 3 * ts, "attack-move: resumes to its destination once clear");

  // D: retreat with a goblin 3 tiles away: no unit takes it on while it is not cornering them.
  units = await body();
  const here = centroid(units);
  const gob = (await c.hook("spawnMob", { kind: "goblin", tx: Math.floor(here.x / ts) + dir * 3, ty: Math.floor(here.y / ts) })).id;
  order({ kind: "retreat" });
  await ff(20);
  let st = await c.hook("bodyState");
  const gm = st.mobs.find((m) => m.id === gob);
  units = st.colonists.filter((u) => ids.includes(u.id));
  const ignoring = units.every((u) => u.targetMobId !== gob || (gm && Math.hypot(gm.x - u.x, gm.y - u.y) <= 1.2 * ts + 40));
  const tcPx = { x: (tc.x + 0.5) * ts, y: (tc.y + 0.5) * ts };
  const rr = centroid(units, "rallyX", "rallyY");
  result(ignoring && Math.hypot(rr.x - tcPx.x, rr.y - tcPx.y) < 6 * ts, `retreat: ignores the goblin, rallies by the Town Center (${(Math.hypot(rr.x - tcPx.x, rr.y - tcPx.y) / ts).toFixed(1)} tiles)`);
  await ff(800);

  // E: a per-unit commandMove takes that unit out of its order group.
  c.send({ type: "commandMove", unitIds: [ids[0]], x: px(8, -6).x, y: px(8, -6).y });
  gs = await groupsUntil((list) => !groupOf(list, ids[0]));
  result(!groupOf(gs, ids[0]) && !!groupOf(gs, ids[1]), "commandMove takes a unit out of its order group");

  // F: follow the rider: the group re-forms behind it after it moves.
  const rest = ids.slice(1);
  order({ kind: "follow", targetId: `p:${c.welcome.id}` }, false, rest);
  const rider = px(16, -6);
  await c.hook("teleportPlayer", rider);
  await ff(600);
  units = (await body()).filter((u) => rest.includes(u.id));
  const fc = centroid(units);
  result(Math.hypot(fc.x - rider.x, fc.y - rider.y) < 6 * ts, `follow: re-formed near the rider (${(Math.hypot(fc.x - rider.x, fc.y - rider.y) / ts).toFixed(1)} tiles)`);

  // G: junk is ignored.
  gs = await groups();
  const before = JSON.stringify(groupOf(gs, ids[1])?.order);
  order({ kind: "move", x: NaN, y: 5 }, false, rest);
  order({ kind: "teleport", x: 5, y: 5 }, false, rest);
  order({ kind: "follow", targetId: ids[1] }, false, rest);
  gs = await groups();
  result(JSON.stringify(groupOf(gs, ids[1])?.order) === before, "invalid orders are ignored");
  c.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
