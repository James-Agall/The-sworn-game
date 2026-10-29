// Scripted test: save files. Self-contained: boots its OWN private servers (tsx, ports PORT_A/PORT_B,
// default 18931/18932) with COLONY_SAVE_DIR pointing at a temp dir, so the real server/saves/ and the
// shared :8080 world are never touched. Run from server/: `node save-load-test.mjs`.
//   A (80x80):   pause -> save slot1 -> mutate (tiles, building, stock, fast-forward) -> load slot1 ->
//                state restored (tiles, stock, colonists, cycleTick, building levels, construction
//                sites, town centers, a mob), sim keeps running, version / unsupported size refused,
//                GET /saves lists the slots.
//   B (160x160): a few days with raids + colonists, then a manual save: size + timings from the log;
//                dawn autosave fired; SIGTERM writes the autosave before exit.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT_A = Number(process.env.PORT_A ?? 18931);
const PORT_B = Number(process.env.PORT_B ?? 18932);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// npm workspaces hoist tsx to the repo root.
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const T = { Empty: 0, House: 13 };

function startServer(port, size, saveDir) {
  const proc = spawn(TSX, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), COLONY_WORLD_SIZE: String(size), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const s = { proc, log: "", exited: false };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  proc.on("exit", () => (s.exited = true));
  return s;
}

function connect(port) {
  const c = { ws: new WebSocket(`ws://localhost:${port}`), welcome: null, welcomes: 0, snap: null, tiles: [], waiters: [], events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
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
      const w = { pred, resolve };
      c.waiters.push(w);
      setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    });
  c.hook = (op, data = {}) => {
    const p = c.wait((m) => m.type === "testHookResult" && m.op === op, 120000);
    c.send({ type: "testHook", op, ...data });
    return p;
  };
  c.nextSnap = () => c.wait((m) => m.type === "snapshot");
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

// Wait until the port answers HTTP (the server is up) before opening the websocket.
async function waitForPort(port) {
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/saves`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${port} never came up`);
}

const STOCK_KEYS = ["wood", "iron", "rock", "grain", "meat", "fruit", "gold"];

async function capture(c) {
  const snap = await c.nextSnap();
  const raid = await c.hook("raidState");
  const cons = await c.hook("constructionState");
  return { snap, raid, cons, tiles: [...c.tiles] };
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// ---------------- A: 80x80 round trip ----------------
const dirA = mkdtempSync(path.join(tmpdir(), "colony-saves-a-"));
const A = startServer(PORT_A, 80, dirA);
try {
  await waitForPort(PORT_A);
  const c = connect(PORT_A);
  await c.ready();
  const W = c.welcome.worldTilesX;

  // A finished House next to the player (instant build) and a pending construction site (builders).
  await c.hook("setInstantBuild", { enabled: true });
  await c.hook("setStock", { stock: { wood: 500, rock: 500, iron: 500 } });
  const me = c.snap.players.find((p) => p.id === c.welcome.id);
  const ptx = Math.floor(me.x / TILE);
  const pty = Math.floor(me.y / TILE);
  const empties = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = ptx + dx;
      const y = pty + dy;
      if ((dx || dy) && c.tiles[y * W + x] === T.Empty) empties.push({ x, y });
    }
  const [houseAt, siteAt] = empties;
  c.send({ type: "setTile", tileX: houseAt.x, tileY: houseAt.y, tile: T.House });
  await sleep(300);
  const mobReply = await c.hook("spawnMob", { kind: "orc", tx: 5, ty: 5 });
  await c.hook("fastForward", { ticks: 500 });
  // Placed after the fast-forward so builders haven't finished it yet when we save.
  await c.hook("setInstantBuild", { enabled: false });
  c.send({ type: "setTile", tileX: siteAt.x, tileY: siteAt.y, tile: T.House });
  await sleep(300);
  await c.hook("setStock", { stock: { wood: 321, gold: 42, fruit: 17 } });

  // Pause so the captured state is exactly what gets saved.
  c.send({ type: "pause" });
  await sleep(200);
  const savedRes = c.wait((m) => m.type === "saveResult");
  c.send({ type: "saveGame", slot: "slot1" });
  const sr = await savedRes;
  result(sr.ok && sr.action === "save" && sr.slot === "slot1", `saveGame slot1 -> ok (${JSON.stringify(sr)})`);
  const before = await capture(c);
  result(before.snap.isPaused === true, "captured while paused");
  result(c.tiles[houseAt.y * W + houseAt.x] === T.House, "house placed before save");
  result(before.cons.sites.length > 0, `construction site pending before save (${before.cons.sites.length})`);
  const mobBefore = before.raid.mobs.find((m) => m.id === mobReply.id);
  result(!!mobBefore, `spawned mob ${mobReply.id} present before save`);
  const file = JSON.parse(readFileSync(path.join(dirA, "slot1.json"), "utf8"));
  result(
    file.version === 1 && file.worldSize === 80 && file.label === "Slot 1" && typeof file.savedAt === "string" && file.difficulty === before.snap.difficulty,
    `save metadata ${JSON.stringify({ v: file.version, size: file.worldSize, label: file.label, day: file.dayIndex, pop: file.population })}`
  );

  // Mutate everything we check.
  c.send({ type: "pause" });
  await c.hook("setStock", { stock: { wood: 1, gold: 999, fruit: 0 } });
  await c.hook("setTileRaw", { tx: houseAt.x, ty: houseAt.y, tile: T.Empty });
  await c.hook("setTileRaw", { tx: 2, ty: 2, tile: T.House });
  if (mobBefore) await c.hook("damageMob", { mobId: mobReply.id, amount: 99999 });
  await c.hook("killColonists", { kind: "builder" });
  await c.hook("damageTownCenter", { tx: before.cons.townCenters[0].x, ty: before.cons.townCenters[0].y, amount: 300 });
  await c.hook("fastForward", { ticks: 3000 });
  const mutated = await capture(c);
  result(
    mutated.snap.wood !== before.snap.wood && mutated.raid.cycleTick > before.raid.cycleTick + 2000 && mutated.tiles[houseAt.y * W + houseAt.x] !== T.House,
    "world mutated after save"
  );

  // Load.
  const welcomesBefore = c.welcomes;
  const loadRes = c.wait((m) => m.type === "saveResult");
  c.send({ type: "loadGame", slot: "slot1" });
  const lr = await loadRes;
  const after = await capture(c);
  result(lr.ok && lr.action === "load", `loadGame slot1 -> ok (${JSON.stringify(lr)})`);
  result(c.welcomes === welcomesBefore + 1, "fresh welcome broadcast after load");
  result(c.events.includes("Game loaded"), "'Game loaded' event toast");
  const tileDiffs = before.tiles.reduce((n, t, i) => n + (t !== after.tiles[i] ? 1 : 0), 0);
  result(tileDiffs === 0, `tiles restored (${tileDiffs} differ)`);
  result(JSON.stringify(c.welcome.biomes) !== undefined && c.welcome.explored.length > 0, "welcome carries biomes + explored");
  result(STOCK_KEYS.every((k) => near(after.snap[k], before.snap[k], 2)), `stock restored (wood ${before.snap.wood}->${after.snap.wood}, gold ${before.snap.gold}->${after.snap.gold})`);
  result(after.snap.colonists.length === before.snap.colonists.length, `colonist count ${before.snap.colonists.length} -> ${after.snap.colonists.length}`);
  result(near(after.raid.cycleTick, before.raid.cycleTick, 10) && after.raid.cycleTick >= before.raid.cycleTick, `cycleTick ${before.raid.cycleTick} -> ${after.raid.cycleTick}`);
  result(JSON.stringify(after.snap.buildingLevels) === JSON.stringify(before.snap.buildingLevels), "building levels restored");
  result(
    JSON.stringify(after.cons.sites.map((s) => [s.tx, s.ty, s.target])) === JSON.stringify(before.cons.sites.map((s) => [s.tx, s.ty, s.target])),
    "construction sites restored"
  );
  result(JSON.stringify(after.cons.townCenters) === JSON.stringify(before.cons.townCenters), `town centers restored ${JSON.stringify(after.cons.townCenters)}`);
  const mobAfter = after.raid.mobs.find((m) => m.id === mobReply.id);
  result(!!mobAfter && mobAfter.kind === mobBefore?.kind && mobAfter.hp === mobBefore?.hp, `mob restored (${mobAfter?.kind} hp ${mobAfter?.hp})`);
  result(after.raid.mobs.length === before.raid.mobs.length, `mob count ${before.raid.mobs.length} -> ${after.raid.mobs.length}`);
  result(after.snap.difficulty === before.snap.difficulty && after.snap.isPaused === false, "difficulty restored, sim unpaused");

  // Keeps running.
  const t1 = (await c.hook("raidState")).cycleTick;
  await sleep(1000);
  const t2 = (await c.hook("raidState")).cycleTick;
  result(t2 > t1 + 10, `sim ticks after load (${t1} -> ${t2})`);
  // 7100 ticks: with 300 s days (6000 + 1500 night ticks) this crosses the first dawn, so an autosave is written.
  await c.hook("fastForward", { ticks: 7100 });
  result(!A.exited, "server alive after 7100 ticks on the loaded world");

  // Guards.
  writeFileSync(path.join(dirA, "slot2.json"), JSON.stringify({ ...file, version: 999 }));
  // Saves bring their own world size now (a different supported size is loaded, resizing the world), so the
  // guard is against an unsupported size.
  writeFileSync(path.join(dirA, "slot3.json"), JSON.stringify({ ...file, worldSize: 999 }));
  const bad1 = c.wait((m) => m.type === "saveResult");
  c.send({ type: "loadGame", slot: "slot2" });
  const b1 = await bad1;
  result(!b1.ok && /version/i.test(b1.error ?? ""), `version mismatch refused: ${b1.error}`);
  const bad2 = c.wait((m) => m.type === "saveResult");
  c.send({ type: "loadGame", slot: "slot3" });
  const b2 = await bad2;
  result(!b2.ok && /unsupported world size \(999\)/.test(b2.error ?? ""), `unsupported world size refused: ${b2.error}`);
  const listed = await (await fetch(`http://localhost:${PORT_A}/saves`)).json();
  result(
    // The 7100-tick fast-forward crossed a dawn, so the autosave is listed too.
    listed.saves.map((s) => s.slot).join(",") === "autosave,slot1,slot2,slot3" && listed.saves[1].dayIndex === file.dayIndex,
    `GET /saves lists ${listed.saves.map((s) => s.slot).join(",")}`
  );
  const wsList = c.wait((m) => m.type === "saveList");
  c.send({ type: "listSaves" });
  result((await wsList).saves.length === 4, "listSaves over websocket");
  c.ws.close();
} catch (err) {
  result(false, `A crashed: ${err.stack}`);
} finally {
  // SIGTERM, not SIGKILL: tsx relays it to its node child (a SIGKILLed tsx orphans the server).
  A.proc.kill("SIGTERM");
  for (let i = 0; i < 100 && !A.exited; i++) await sleep(100);
}
const errLinesA = A.log.split("\n").filter((l) => /error|exception|TypeError/i.test(l) && !/\[save\]|\[load\]/.test(l));
result(errLinesA.length === 0, `no exceptions in server A log${errLinesA.length ? ": " + errLinesA.slice(0, 3).join(" | ") : ""}`);

// ---------------- B: 160x160 timings + autosave ----------------
const dirB = mkdtempSync(path.join(tmpdir(), "colony-saves-b-"));
const B = startServer(PORT_B, 160, dirB);
try {
  await waitForPort(PORT_B);
  const c = connect(PORT_B);
  await c.ready();
  // Past the first dawn (300 s days: 6000 day + 1500 night ticks), so a dawn autosave is written.
  await c.hook("fastForward", { ticks: 7600 });
  await sleep(500);
  const raid = await c.hook("raidState");
  const snap = await c.nextSnap();
  console.log(`  B world: day ${Math.floor(raid.cycleTick / (raid.dayTicks + raid.nightTicks)) + 1}, ${snap.colonists.length} colonists, ${raid.mobs.length} mobs, ${raid.groups.length} raid groups`);
  result(existsSync(path.join(dirB, "autosave.json")), "dawn autosave written");
  const res = c.wait((m) => m.type === "saveResult");
  c.send({ type: "saveGame", slot: "slot1" });
  result((await res).ok, "160x160 manual save ok");
  const line = B.log.split("\n").filter((l) => l.startsWith("[save] slot1"))[0];
  console.log(`  ${line}`);
  console.log(`  slot1.json ${(statSync(path.join(dirB, "slot1.json")).size / 1024).toFixed(1)} KiB`);
  const loadRes = c.wait((m) => m.type === "saveResult");
  c.send({ type: "loadGame", slot: "slot1" });
  result((await loadRes).ok, "160x160 load ok");
  console.log(`  ${B.log.split("\n").filter((l) => l.startsWith("[load]"))[0]}`);
  const before = statSync(path.join(dirB, "autosave.json")).mtimeMs;
  await sleep(50);
  B.proc.kill("SIGTERM");
  for (let i = 0; i < 100 && !B.exited; i++) await sleep(100);
  const shutdownLine = B.log.split("\n").find((l) => l.includes("autosave on SIGTERM"));
  result(!!shutdownLine && statSync(path.join(dirB, "autosave.json")).mtimeMs > before, `SIGTERM autosave: ${shutdownLine}`);
  c.ws.close();
} catch (err) {
  result(false, `B crashed: ${err.stack}`);
} finally {
  if (!B.exited) B.proc.kill("SIGTERM");
  for (let i = 0; i < 100 && !B.exited; i++) await sleep(100);
}
const errLinesB = B.log.split("\n").filter((l) => /error|exception|TypeError/i.test(l) && !/\[save\]|\[load\]/.test(l));
result(errLinesB.length === 0, `no exceptions in server B log${errLinesB.length ? ": " + errLinesB.slice(0, 3).join(" | ") : ""}`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
