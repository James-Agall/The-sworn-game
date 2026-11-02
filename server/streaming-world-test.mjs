// Scripted test: world streaming phases 4-5. ONE private server (256 by default) with COLONY_STREAMING=1, test
// hooks and a scratch save dir. Checks:
//  1. a streamed save stores seed + per-chunk tile diffs (no full arrays) and a base cache file
//  2. load from memory / the cache file / a regeneration from the seed gives the same tiles, biomes, explored
//  3. a full-array (old format) save still loads
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const TILE = 32;
const DAY = 20 * 375; // a whole game day (day + night)
const SIZE = Number(process.env.STREAM_TEST_SIZE ?? 256);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) => new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(port, () => s.close(() => res(true))); });
let PORT = 32600;
while (!(await portFree(PORT))) PORT++;
const saveDir = mkdtempSync(path.join(tmpdir(), "colony-stream4-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_STREAMING: "1", COLONY_SAVE_DIR: saveDir, COLONY_WORLD_SIZE: String(SIZE), COLONY_TEST_MAX_WORLD_SIZE: "2048" },
  stdio: "ignore",
  detached: true,
});
const cleanup = () => {
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
  try { rmSync(saveDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

const c = { ws: null, welcome: null, snap: null, hooks: new Map(), saves: [], events: [] };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "testHookResult") c.hooks.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
    else if (m.type === "event") c.events.push(m.text);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(15)) if (fn()) return true; return !!fn(); };
const hook = async (op, args = {}, ms = 120000) => { c.hooks.delete(op); send({ type: "testHook", op, ...args }); await until(() => c.hooks.has(op), ms); return c.hooks.get(op); };
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const audit = () => hook("auditWorld");

let passed = 0;
const failed = [];
const check = async (name, fn) => {
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    ok = r === true || (Array.isArray(r) && r[0] === true);
    detail = Array.isArray(r) ? r[1] ?? "" : r === true ? "" : String(r);
  } catch (e) { detail = `threw ${e?.message ?? e}`; }
  if (ok) passed++;
  else failed.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

for (let i = 0; i < 240; i++) {
  try {
    connect();
    await new Promise((res, rej) => { c.ws.once("open", res); c.ws.once("error", rej); });
    break;
  } catch { await sleep(250); }
}
if (!(await until(() => c.welcome && c.snap, 120000))) { console.log("FAIL boot"); process.exit(1); }
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
const W = c.welcome.worldTilesX;
const tc = c.snap.townCenters[0];
const saveFile = (slot) => JSON.parse(readFileSync(path.join(saveDir, `${slot}.json`), "utf8"));
const save = async (slot) => { c.saves.length = 0; send({ type: "saveGame", slot }); await until(() => c.saves.length > 0, 60000); return c.saves[0]; };
const load = async (slot) => { c.saves.length = 0; c.welcome = null; send({ type: "loadGame", slot }); await until(() => c.saves.length > 0 && c.welcome, 180000); return c.saves[0]; };

let before = null;
await check("streamed save: seed + tile diffs, no full arrays, base cache file", async () => {
  // A few edits in two chunks (a cleared strip and a tree in the corner).
  for (let i = 0; i < 6; i++) await hook("setTileRaw", { tx: tc.x + 4 + i, ty: tc.y + 6, tile: 0 });
  await hook("setTileRaw", { tx: 5, ty: 5, tile: 2 });
  before = await hook("tileHash");
  const r = await save("slot1");
  if (!r?.ok) return `save failed: ${JSON.stringify(r)}`;
  const s = saveFile("slot1").state;
  const bases = readdirSync(saveDir).filter((f) => f.startsWith("base-"));
  return [s.tiles === undefined && s.biomes === undefined && typeof s.exploredZ === "string" && s.seed === before.seed && Array.isArray(s.tileDiffs) && bases.length === 1,
    `seed ${s.seed}, ${s.tileDiffs?.length} diff chunks, tiles ${typeof s.tiles}, base files ${bases.join(",")}, ${(readFileSync(path.join(saveDir, "slot1.json")).length / 1024).toFixed(0)} KiB`];
});

const same = (a, b) => a.tiles === b.tiles && a.biomes === b.biomes && a.explored === b.explored;
await check("diff load: memory, cache file and regeneration all rebuild the same world", async () => {
  await hook("setTileRaw", { tx: tc.x + 4, ty: tc.y + 8, tile: 2 });
  const r1 = await load("slot1");
  const h1 = await hook("tileHash");
  await hook("dropBaseCache");
  await save("slot1"); // rewrites the cache file from the loaded base
  const r2 = await load("slot1");
  const h2 = await hook("tileHash");
  await hook("dropBaseCache");
  const r3 = await load("slot1");
  const h3 = await hook("tileHash");
  const a = await audit();
  return [r1?.ok && r2?.ok && r3?.ok && same(before, h1) && same(before, h2) && same(before, h3) && a.ok,
    `loads ${r1?.ok}/${r2?.ok}/${r3?.ok} ${r3?.error ?? ""}; hashes ${[h1, h2, h3].map((h) => same(before, h)).join("/")}; audit ${a.ok}`];
});

await check("an old full-array save still loads", async () => {
  // slot2 written in the old format: the same world with the arrays expanded by hand is not possible here, so
  // write a fresh unseeded-style file by dropping the diff fields from a full snapshot.
  const r = await hook("writeFullSave", { slot: "slot2" });
  const f = saveFile("slot2").state;
  const l = await load("slot2");
  const h = await hook("tileHash");
  return [r?.ok && typeof f.tiles === "string" && l?.ok && same(before, h) && h.seed === null,
    `full tiles ${typeof f.tiles}, load ${l?.ok} ${l?.error ?? ""}, same ${same(before, h)}, seed after ${h.seed}`];
});

console.log(`\n${passed} passed, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
