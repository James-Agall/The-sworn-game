// Scripted test: clans (ROADMAP "Clans — landed"; PLAN-forts-diplomacy-moats.md decision 1 / phase A2).
// Boots its own server (world 96, test hooks, scratch save dir) on PORT (default 22190).
//   A: two players in the default clan share one stock (no clan fields in a single-clan snapshot).
//   B: a third player with ?clan=new founds clan 1: own Town Center far away, starting stock, population,
//      goal track; the others' snapshot is unchanged and lists both clans.
//   C: separate stock (setStock in one clan does not touch the other).
//   D: a clan-1 building is recorded in clanTiles, completes clan 1's first goal only, and clan 0 can't
//      demolish it.
//   E: armies: each clan's regiments hold only its own units; another clan's units ignore your orders.
//   F: neutral: soldiers of the two clans side by side never hurt each other.
//   G: save / load keeps the clans; an old save (no clan fields) loads as one clan.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22190);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, House: 13 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "clans-test-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "96", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);

function client(query = "") {
  const c = { ws: null, welcome: null, welcomes: 0, snap: null, tiles: [], clanTiles: null, hook: new Map(), save: null, events: [] };
  c.open = async () => {
    for (let i = 0; i < 100; i++) {
      c.ws = new WebSocket(`ws://localhost:${PORT}/${query}`);
      try {
        await new Promise((res, rej) => {
          c.ws.on("open", res);
          c.ws.on("error", rej);
        });
        break;
      } catch {
        await sleep(300);
      }
    }
    c.ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "welcome") {
        c.welcome = m;
        c.welcomes++;
        c.tiles = [...m.tiles];
      } else if (m.type === "snapshot") {
        c.snap = m;
        if (m.clanTiles) c.clanTiles = m.clanTiles;
      } else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
      else if (m.type === "testHookResult") c.hook.set(m.op, m);
      else if (m.type === "saveResult") c.save = m;
      else if (m.type === "event") c.events.push(m.text);
    });
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  return c;
}
const waitFor = async (fn, ms = 3000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (fn()) return true;
    await sleep(25);
  }
  return fn();
};
const px = (t) => t * TILE + 16;
const unitOf = async (c, id) => (await c.hookCall("bodyState")).colonists.find((u) => u.id === id);

try {
  // ---- A: one clan, shared ----
  const A = client();
  await A.open();
  await A.hookCall("setRaids", { enabled: false });
  await A.hookCall("ignorePlayers", { value: true });
  await A.hookCall("setInstantBuild", { enabled: true });
  await A.hookCall("setCycleTick", { tick: 0 });
  const B = client("?clan=0");
  await B.open();
  await A.hookCall("setStock", { stock: { wood: 123 } });
  result(await waitFor(() => B.snap.wood === 123 && A.snap.wood === 123), `same clan shares the stock (A ${A.snap.wood}, B ${B.snap.wood})`);
  result(A.snap.clanId === undefined && A.snap.clans === undefined && !A.clanTiles, "single clan: no clan fields in the snapshot");
  const tc0 = A.snap.townCenters[0];

  // ---- B: founding a clan ----
  const C = client("?clan=new");
  await C.open();
  await waitFor(() => C.snap.clanId === 1 && A.snap.clanId === 0);
  result(C.snap.clanId === 1 && C.me()?.clan === 1, `?clan=new founds clan 1 (clanId ${C.snap.clanId})`);
  const tc1 = C.snap.townCenters[0];
  const dist = tc1 ? Math.hypot(tc1.x - tc0.x, tc1.y - tc0.y) : 0;
  result(C.snap.townCenters.length === 1 && dist >= 24, `clan 1 has its own Town Center ${dist.toFixed(1)} tiles from clan 0's`);
  result(C.snap.wood === 80 && C.snap.iron === 60 && C.snap.rock === 60, `clan 1 starts with the starting stock (wood ${C.snap.wood})`);
  result(C.snap.population === 1 && C.snap.populationCap === 12, `clan 1 population ${C.snap.population}/${C.snap.populationCap} (its own builder, own cap)`);
  result(C.snap.goal.index === 0, `clan 1 goal track from the start (${C.snap.goal.title})`);
  result(A.snap.clanId === 0 && A.snap.clans?.length === 2 && A.snap.wood === 123 && A.snap.townCenters.length === 1,
    `clan 0 unchanged: wood ${A.snap.wood}, ${A.snap.townCenters.length} Town Center, ${A.snap.clans?.length} clans listed`);
  const cp = C.me();
  result(Math.hypot(cp.x - px(tc1.x), cp.y - px(tc1.y)) < 3 * TILE, "the founder spawns at its new Town Center");

  // ---- C: separate stock ----
  await C.hookCall("setStock", { stock: { wood: 500 } });
  await waitFor(() => C.snap.wood === 500);
  await sleep(200);
  result(C.snap.wood === 500 && A.snap.wood === 123, `separate stock (clan 1 wood ${C.snap.wood}, clan 0 wood ${A.snap.wood})`);

  // ---- D: tiles, goals, edit refusal ----
  const W = C.welcome.worldTilesX;
  let spot = null;
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
    const x = tc1.x + dx, y = tc1.y + dy;
    if (C.tiles[y * W + x] === T.Empty) {
      spot = { x, y };
      break;
    }
  }
  result(!!spot, `found an empty tile beside clan 1's Town Center (${spot?.x},${spot?.y})`);
  await C.hookCall("teleportPlayer", { x: px(spot.x) + TILE, y: px(spot.y) });
  await sleep(100);
  C.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.House });
  result(await waitFor(() => C.tiles[spot.y * W + spot.x] === T.House), "clan 1 builds a House");
  const idx = spot.y * W + spot.x;
  const ownerOf = (flat, i) => {
    for (let k = 0; flat && k + 1 < flat.length; k += 2) if (flat[k] === i) return flat[k + 1];
    return undefined;
  };
  const ownerIn = (flat) => ownerOf(flat, idx);
  result(await waitFor(() => ownerIn(A.clanTiles) === 1), `clanTiles marks the House as clan 1's (${ownerIn(A.clanTiles)})`);
  const startIdx = ownerOf(A.clanTiles, tc0.y * W + tc0.x);
  result(startIdx === 0 || startIdx === undefined, "clan 0's Town Center is listed as clan 0's");
  result(await waitFor(() => C.snap.goal.index >= 1, 4000), `clan 1's "Place a building" completes (goal ${C.snap.goal.index})`);
  result(A.snap.goal.index === 0, `clan 0's goal track is untouched (goal ${A.snap.goal.index}: ${A.snap.goal.title})`);
  await A.hookCall("teleportPlayer", { x: px(spot.x) - TILE, y: px(spot.y) });
  await sleep(100);
  A.events.length = 0;
  A.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.Empty });
  await waitFor(() => A.events.length > 0, 1500);
  result(A.tiles[idx] === T.House && A.events.some((e) => /belongs to Clan 1/.test(e)), `clan 0 can't demolish clan 1's House (${A.events.join(" | ")})`);
  A.send({ type: "buildingInfo", tileX: spot.x, tileY: spot.y });

  // ---- E: armies ----
  const kC = (await C.hookCall("spawnSoldier", { kind: "knight", x: px(tc1.x + 3), y: px(tc1.y + 3), stance: "defensive" })).id;
  const kA = (await A.hookCall("spawnSoldier", { kind: "knight", x: px(tc0.x + 3), y: px(tc0.y + 3), stance: "defensive" })).id;
  const regHas = (c, id) => (c.snap.armyRegiments ?? []).some((r) => r.unitIds.includes(id));
  let sawC = false, sawA = false, leakC = false, leakA = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !(sawC && sawA)) {
    if (C.snap.armyRegiments) { sawC ||= regHas(C, kC); leakC ||= regHas(C, kA); }
    if (A.snap.armyRegiments) { sawA ||= regHas(A, kA); leakA ||= regHas(A, kC); }
    await sleep(25);
  }
  result(sawC && sawA && !leakC && !leakA, `each clan's regiments hold only its own knight (C ${sawC}/${leakC}, A ${sawA}/${leakA})`);
  const before = await unitOf(A, kC);
  A.send({ type: "commandMove", unitIds: [kC], x: before.x + 5 * TILE, y: before.y });
  await A.hookCall("fastForward", { ticks: 60 });
  const after = await unitOf(A, kC);
  result(Math.hypot(after.x - before.x, after.y - before.y) < TILE, `clan 0 can't order clan 1's knight (moved ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(0)} px)`);
  C.send({ type: "commandMove", unitIds: [kC], x: before.x + 4 * TILE, y: before.y });
  await C.hookCall("fastForward", { ticks: 120 });
  const moved = await unitOf(C, kC);
  result(Math.hypot(moved.x - before.x, moved.y - before.y) > 2 * TILE, `clan 1 orders its own knight (moved ${Math.hypot(moved.x - before.x, moved.y - before.y).toFixed(0)} px)`);

  // ---- F: neutral ----
  const nA = (await A.hookCall("spawnSoldier", { kind: "knight", x: px(tc0.x - 4), y: px(tc0.y - 4), stance: "aggressive" })).id;
  const nC = (await C.hookCall("spawnSoldier", { kind: "knight", x: px(tc0.x - 4) + 20, y: px(tc0.y - 4), stance: "aggressive" })).id;
  const hp0 = [(await unitOf(A, nA)).hp, (await unitOf(A, nC)).hp];
  await A.hookCall("fastForward", { ticks: 300 });
  const ua = await unitOf(A, nA);
  const uc = await unitOf(A, nC);
  result(ua && uc && ua.hp === hp0[0] && uc.hp === hp0[1] && !ua.targetMobId && !uc.targetMobId,
    `neutral clans: knights side by side never fight (hp ${hp0} -> ${ua?.hp},${uc?.hp})`);

  // ---- G: save / load ----
  A.save = null;
  A.send({ type: "saveGame", slot: "slot1" });
  await waitFor(() => A.save, 5000);
  result(A.save?.ok === true, `saved (${A.save?.error ?? "ok"})`);
  const file = JSON.parse(readFileSync(path.join(saveDir, "slot1.json"), "utf8"));
  result(file.state.clans?.length === 1 && file.state.clans[0].stock.wood > 0 && ownerIn(file.state.tileClans) === 1,
    `save carries clan 1 (${file.state.clans?.length} extra clan, wood ${file.state.clans?.[0]?.stock.wood}) and its tiles`);
  const wood1 = C.snap.wood;
  A.save = null;
  const wA = A.welcomes;
  A.send({ type: "loadGame", slot: "slot1" });
  await waitFor(() => A.save && A.welcomes > wA, 8000);
  await waitFor(() => A.snap.clans?.length === 2, 3000);
  result(A.save?.ok === true && A.snap.clans?.length === 2 && ownerIn(A.clanTiles) === 1, `load keeps both clans and clan 1's tiles (${A.snap.clans?.length} clans)`);
  result(file.state.clans[0].stock.wood === wood1, `clan 1's stock is saved (${file.state.clans[0].stock.wood} = ${wood1})`);

  // An old save: no clan fields anywhere -> one clan.
  delete file.state.clans;
  delete file.state.tileClans;
  for (const c of file.state.colonists) delete c.clan;
  for (const tc of file.state.townCenters) delete tc.clan;
  for (const q of file.state.respawnQueue) delete q.clan;
  writeFileSync(path.join(saveDir, "slot2.json"), JSON.stringify(file));
  A.save = null;
  const wA2 = A.welcomes;
  A.send({ type: "loadGame", slot: "slot2" });
  await waitFor(() => A.save && A.welcomes > wA2, 8000);
  await waitFor(() => A.snap.clanId === undefined && C.snap.clanId === undefined, 3000);
  await sleep(200);
  result(A.save?.ok === true && A.snap.clanId === undefined && A.snap.clans === undefined, "an old save loads as one clan (no clan fields)");
  result(A.snap.townCenters.length === 2 && C.snap.wood === A.snap.wood && C.me()?.clan === undefined,
    `every player shares it: ${A.snap.townCenters.length} Town Centers, wood ${A.snap.wood} / ${C.snap.wood}`);
} catch (err) {
  fails++;
  console.log(`FAIL exception: ${err?.stack ?? err}`);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL`);
killServer();
process.exit(fails === 0 ? 0 : 1);
