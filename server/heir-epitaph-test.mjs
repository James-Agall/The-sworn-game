// Heir epitaph + house chronicle (hooks only, one boot): death writes an epitaph chronicle entry from real data; succession adds a house line.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, openSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const TILE = 32;
const TICK = 20;
const DAY = TICK * 300;
const T = { Empty: 0, Wall: 1, LumberjackPost: 3, KnightPost: 5, House: 13, MilitiaPost: 32, Pasture: 21, Gate: 70, Moat: 75, Drawbridge: 76 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

// ---- one private server ----
const portFree = (port) =>
  new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(false));
    s.listen(port, () => s.close(() => res(true)));
  });
// A random start (it was always 31900): fewer port races between smoke runs started at once on this machine.
let PORT = 33000 + Math.floor(Math.random() * 4000);
while (!(await portFree(PORT))) PORT++;
const saveDir = mkdtempSync(path.join(tmpdir(), "colony-heir-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  // COLONY_UNLOCK_ALL: the checks below predate the progression tree (its own check switches the unlock off).
  // COLONY_WORLD_SEED: one fixed map layout (SMOKE_SEED=<n> tries another), so the checks never meet a random map.
  env: { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir, COLONY_UNLOCK_ALL: "1", COLONY_WORLD_SEED: process.env.SMOKE_SEED ?? "20261110" },
  // SMOKE_LOG=<file>: the server's stdout / stderr go there (debugging a failed run).
  stdio: process.env.SMOKE_LOG ? ["ignore", openSync(process.env.SMOKE_LOG, "w"), openSync(process.env.SMOKE_LOG, "a")] : "ignore",
  detached: true,
});
const cleanup = () => {
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
  try { rmSync(saveDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

// ---- client ----
const c = { ws: null, welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), results: [], saves: [], saveList: null, info: undefined, dialogues: [], life: null };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.snap = null;
      c.W = m.worldTilesX;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
    else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hooks.set(m.op, m);
    else if (m.type === "creativeResult") c.results.push(m);
    else if (m.type === "saveResult") c.saves.push(m);
    else if (m.type === "saveList") c.saveList = m.saves;
    else if (m.type === "buildingInfo") c.info = m.info;
    else if (m.type === "dialogue") c.dialogues.push(m);
    if (m.type === "snapshot" && m.life) c.life = m.life;
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(15)) if (fn()) return true;
  return !!fn();
};
const hook = async (op, args = {}) => {
  c.hooks.delete(op);
  send({ type: "testHook", op, ...args });
  await until(() => c.hooks.has(op), 5000);
  return c.hooks.get(op);
};
const creative = async (msg) => {
  const n = c.results.length;
  send(msg);
  await until(() => c.results.length > n, 3000);
  return c.results[n] ?? null;
};
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const raw = (tx, ty, tile) => hook("setTileRaw", { tx, ty, tile });
const tileAt = (x, y) => c.tiles[y * c.W + x];
const stock = () => hook("setStock", { stock: {} }).then((r) => r.stock);
const snapNow = async () => {
  const s = c.snap;
  await until(() => c.snap !== s, 2000);
  return c.snap;
};
const place = async (x, y, tile, want = tile) => {
  await tp(x - 1, y - 1);
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await until(() => tileAt(x, y) === want, 1500);
};
// Bare ground in a (2r+1) square, fast (fire and forget, then one awaited hook to flush).
const clearBox = async (cx, cy, r) => {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
  await raw(cx, cy, T.Empty);
};
const events = (from) => c.events.slice(from).join(" | ");

// ---- check harness ----
let passed = 0;
const failed = [];
// SMOKE_ONLY=<text>: run only the checks whose name contains it (debugging one system).
const check = async (name, fn) => {
  if (process.env.SMOKE_ONLY && !name.includes(process.env.SMOKE_ONLY)) return;
  const t = Date.now();
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    ok = r === true || (Array.isArray(r) && r[0] === true);
    detail = Array.isArray(r) ? r[1] ?? "" : r === true ? "" : String(r);
  } catch (e) {
    detail = `threw ${e?.message ?? e}`;
  }
  if (ok) passed++;
  else failed.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${detail ? ` - ${detail}` : ""}`);
};

// ---- connect (the server needs a moment to boot) ----
for (let i = 0; i < 240 && !c.snap; i++) {
  try {
    connect();
    await new Promise((res, rej) => { c.ws.once("open", res); c.ws.once("error", rej); });
    break;
  } catch { await sleep(250); }
}
let bootOk = await until(() => c.welcome && c.snap, 30000);
if (bootOk) {
  // Creative mode: infinite stock, instant building (a plain restart is a normal game).
  c.welcome = null;
  send({ type: "restart", difficulty: "normal", creative: true });
  bootOk = await until(() => c.welcome && c.snap?.creative, 30000);
}

if (!bootOk) {
  console.log("FAIL boot: server did not come up in creative mode");
  process.exit(1);
}
const bootPeople = { ...(c.snap.people ?? {}), persons: (c.snap.colonists ?? []).filter((u) => u.name).length };
send({ type: "pause", paused: true });
const me = () => c.snap.players.find((p) => p.id === c.welcome.id);
const chron = async () => (await hook("chronicle")).entries;
await check("epitaph: death with a family and deeds, then heir adds a house line", async () => {
  await hook("peopleState", { creative: true });
  await hook("heroLife", { flagsClear: true, familyReset: true });
  const cr = await creative({ type: "creativeSet", op: "family", count: 1 });
  const [spId, kidId] = cr?.ids ?? [];
  await hook("heroLife", { growChildren: true });
  await hook("peopleState", { creative: false });
  const sid = (await hook("sitesState")).sites?.[0]?.id;
  await hook("diploSet", { siteId: sid, deeds: { quests: 4, defended: 1 } });
  await hook("setCycleTick", { tick: DAY * 3 });
  const before = (await chron()).length;
  await hook("heroDeath", { legacy: false });
  await hook("damagePlayer", { amount: 1e6 });
  await snapNow();
  const ep = (await chron()).slice(before).find((e) => e.kind === "epitaph");
  send({ type: "chooseHeir", id: kidId });
  await until(() => me()?.dead === false, 3000);
  const lines = (await chron()).filter((e) => e.kind === "house");
  const okEp = !!ep && /gen 1/.test(ep.text) && /wed to /.test(ep.text) && /1 child\b/.test(ep.text) && /finished 4 quests/.test(ep.text) && /after [1-9]\d* days/.test(ep.text);
  const okHouse = lines.length === 1 && /^Gen 2, House /.test(lines[0].text) && lines[0].text.includes((await hook("heroLife", {})).family?.name ?? "?");
  return [okEp && okHouse && !!spId, `epitaph "${ep?.text}"; house "${lines[0]?.text}"`];
});
await check("epitaph: heirless death still writes an epitaph", async () => {
  await hook("heroDeath", { clan: 77 });
  const before = (await chron()).length;
  await hook("damagePlayer", { amount: 1e6 });
  await snapNow();
  const ep = (await chron()).slice(before).find((e) => e.kind === "epitaph");
  await hook("heroDeath", { clan: 0, revive: true });
  return [!!ep && /fell after/.test(ep.text), `"${ep?.text}"`];
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(failed.length === 0 ? `ALL PASS (${passed} checks, ${secs}s)` : `${failed.length} FAILED (${failed.join("; ")}), ${passed} passed, ${secs}s`);
c.ws.close();
process.exit(failed.length === 0 ? 0 : 1);
