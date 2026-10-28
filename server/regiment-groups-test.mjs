// Scripted test: strategy mode phase 2 regiment grouping (snapshot `armyRegiments`). Boots its OWN private
// server (tsx, port 20623 by default, PORT env to override) at COLONY_WORLD_SIZE=160 with COLONY_TEST_HOOKS=1
// and a temp COLONY_SAVE_DIR; kills its process group after. Run from server/: `node regiment-groups-test.mjs`.
//   By settlement + class: knights / archers / cavalry each together, militia + spearman + pikeman one
//   infantry regiment, a hero alone, the same classes at a second Town Center separate; a task force
//   (assignTaskForce) merges units of several regiments and takes them out of their auto ones; reassigning
//   a unit to another slot moves it; an empty assign disbands the slot; a death keeps the max (respawn queue).
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 20623);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

const env = { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_WORLD_SIZE: "160", COLONY_SAVE_DIR: mkdtempSync(path.join(tmpdir(), "reggroups-")) };
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
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, regiments: null, waiters: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.armyRegiments) c.regiments = m.armyRegiments;
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
  const tc1 = c.snap.townCenters[0];
  // A second settlement 30 tiles west (no placement rules via the hook).
  const tc2 = { x: tc1.x - 30, y: tc1.y };
  await c.hook("setTileRaw", { tx: tc2.x, ty: tc2.y, tile: 0 });
  const { townCenters } = await c.hook("placeTownCenter", { tx: tc2.x, ty: tc2.y });
  result(townCenters.length === 2, "second Town Center placed");

  // Soldiers posted on walkable tiles near each Town Center (spawnSoldier: the post is that tile).
  const spawnNear = async (tc, kind, i) => {
    for (let k = 0; k < 40; k++) {
      const dx = 3 + ((i * 7 + k) % 6);
      const dy = -4 + (((i * 3 + k) * 5) % 9);
      const r = await c.hook("spawnSoldier", { kind, x: (tc.x + dx + 0.5) * ts, y: (tc.y + dy + 0.5) * ts });
      if (r.id) return r.id;
    }
    throw new Error(`no spot for ${kind}`);
  };
  const ids = {};
  const kinds = ["knight", "knight", "archer", "militia", "spearman", "pikeman", "cavalry"];
  for (const [i, kind] of kinds.entries()) (ids[kind] ??= []).push(await spawnNear(tc1, kind, i));
  const k2 = await spawnNear(tc2, "knight", 0);
  const m2 = await spawnNear(tc2, "militia", 1);
  const hero = (await c.hook("spawnHero", { heroClass: "champion", x: (tc1.x + 2.5) * ts, y: (tc1.y + 3.5) * ts })).id;

  const fresh = async () => {
    c.regiments = null;
    for (let i = 0; i < 100 && !c.regiments; i++) await sleep(20);
    return c.regiments ?? [];
  };
  const regOf = (regs, id) => regs.find((r) => r.unitIds.includes(id));
  let regs = await fresh();
  const knights = regOf(regs, ids.knight[0]);
  result(!!knights && knights.cls === "knights" && knights.unitIds.includes(ids.knight[1]) && knights.unitIds.length === 2 && knights.role === "shock",
    `two knights at settlement 1 share one regiment (${knights?.name})`);
  const inf = regOf(regs, ids.militia[0]);
  result(!!inf && inf.cls === "infantry" && ids.spearman.concat(ids.pikeman).every((id) => inf.unitIds.includes(id)) && inf.unitIds.length === 3,
    `militia + spearman + pikeman form one infantry regiment (${inf?.name})`);
  result(regOf(regs, ids.archer[0])?.cls === "archers" && regOf(regs, ids.cavalry[0])?.cls === "cavalry" && regOf(regs, ids.archer[0]) !== knights,
    "archers and cavalry have their own regiments");
  const heroReg = regOf(regs, hero);
  result(!!heroReg && heroReg.cls === "hero" && heroReg.unitIds.length === 1 && heroReg.id === `h:${hero}`, `hero alone (${heroReg?.name})`);
  const knights2 = regOf(regs, k2);
  result(!!knights2 && knights2.id !== knights.id && knights2.settlement === 2 && knights.settlement === 1 && regOf(regs, m2).id !== inf.id,
    `settlement 2 has its own knights / infantry (${knights2?.name} vs ${knights.name})`);
  const every = regs.flatMap((r) => r.unitIds);
  result(every.length === new Set(every).size, "each unit is in exactly one regiment");

  // Merge: a knight + the archer into task force 2.
  c.send({ type: "assignTaskForce", slot: 2, unitIds: [ids.knight[0], ids.archer[0]] });
  regs = await fresh();
  const tf2 = regs.find((r) => r.id === "tf2");
  result(!!tf2 && tf2.cls === "mixed" && tf2.unitIds.length === 2 && tf2.taskForce === 2 && regOf(regs, ids.knight[1]).unitIds.length === 1 && !regOf(regs, ids.archer[0]).id.startsWith("a:"),
    "task force 2 merges a knight and the archer, out of their auto regiments");
  // Reassign the knight to slot 3: it leaves slot 2.
  c.send({ type: "assignTaskForce", slot: 3, unitIds: [ids.knight[0]] });
  regs = await fresh();
  result(regOf(regs, ids.knight[0])?.id === "tf3" && regs.find((r) => r.id === "tf2")?.unitIds.length === 1, "a unit moved to slot 3 leaves slot 2");
  // Disband slot 3: the knight is back with the other knight.
  c.send({ type: "assignTaskForce", slot: 3, unitIds: [] });
  regs = await fresh();
  result(regOf(regs, ids.knight[0])?.id === knights.id && regOf(regs, ids.knight[0]).unitIds.length === 2, "empty assign disbands slot 3 (knight back in its auto regiment)");

  // A death: the cavalry card keeps its max (the rider waits in the respawn queue). At night, since by day
  // the queue drops this test rider at once (its post tile is no Stables).
  const { constants } = await c.hook("respawnState");
  await c.hook("setCycleTick", { tick: constants.DAY_TICKS + 20 });
  await c.hook("killColonists", { kind: "cavalry" });
  regs = await fresh();
  const cav = regs.find((r) => r.cls === "cavalry" && r.settlement === 1);
  result(!!cav && cav.unitIds.length === 0 && cav.maxCount === 1, `dead rider: cavalry regiment 0/${cav?.maxCount}`);
  c.ws.close();
} catch (e) {
  fails++;
  console.log("FAIL", e.message);
} finally {
  kill();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
