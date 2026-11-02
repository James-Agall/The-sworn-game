// Scripted test: world streaming phases 4-5. ONE private server (256 by default) with COLONY_STREAMING=1, test
// hooks and a scratch save dir. Checks:
//  1. a streamed save stores seed + per-chunk tile diffs (no full arrays) and a base cache file
//  2. load from memory / the cache file / a regeneration from the seed gives the same tiles, biomes, explored
//  3. a full-array (old format) save still loads
//  4. a `?chunks=1` client gets a chunked welcome (no arrays, RLE explored, minimap summary) and chunks on request
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

const varints = (b64) => { const s = Buffer.from(b64, "base64"); const out = []; let n = 0, mul = 1; for (const b of s) { n += (b & 0x7f) * mul; if (b & 0x80) mul *= 128; else { out.push(n); n = 0; mul = 1; } } return out; };
await check("chunked client: chunked welcome + chunks on request match the full arrays", async () => {
  c.welcome = null;
  await hook("tileHash"); // settle
  // A full welcome on the main socket for reference (reconnect).
  c.ws.close();
  connect();
  await new Promise((res) => c.ws.once("open", res));
  await until(() => c.welcome, 60000);
  const full = c.welcome;
  const ws2 = new WebSocket(`ws://localhost:${PORT}/?chunks=1`);
  const got = { welcome: null, chunks: [] };
  ws2.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "welcome") got.welcome = m; else if (m.type === "chunks") got.chunks.push(...m.chunks); });
  await until(() => got.welcome, 60000);
  const w = got.welcome;
  const n = W * W;
  // Explored runs vs the full bitset.
  const bits = Buffer.from(full.explored, "base64");
  let i = 0, v = 0, bad = 0;
  for (const run of varints(w.chunked.exploredRuns)) { for (let k = 0; k < run; k++, i++) if (((bits[i >> 3] >> (i & 7)) & 1) !== v) bad++; v ^= 1; }
  const cx = Math.ceil(W / 32);
  const ids = [0, cx * cx - 1, Math.floor(tc.y / 32) * cx + Math.floor(tc.x / 32)];
  ws2.send(JSON.stringify({ type: "requestChunks", chunks: ids }));
  await until(() => got.chunks.length >= 3, 10000);
  let mism = 0;
  for (const ch of got.chunks) {
    const x0 = (ch.c % cx) * 32, y0 = Math.floor(ch.c / cx) * 32, cw = Math.min(32, W - x0);
    const t = Buffer.from(ch.tiles, "base64"), b = Buffer.from(ch.biomes, "base64");
    for (let k = 0; k < t.length; k++) { const j = (y0 + Math.floor(k / cw)) * W + x0 + (k % cw); if (t[k] !== full.tiles[j] || b[k] !== full.biomes[j]) mism++; }
  }
  const mm = varints(w.chunked.minimap);
  let cells = 0;
  for (let k = 0; k < mm.length; k += 2) cells += mm[k];
  const f = w.chunked.minimapFactor;
  ws2.close();
  const welcomeKb = (JSON.stringify(w).length / 1024).toFixed(1);
  const fullKb = (JSON.stringify(full).length / 1024).toFixed(1);
  return [w.tiles.length === 0 && w.explored === "" && i === n && bad === 0 && got.chunks.length === 3 && mism === 0 && cells === Math.ceil(W / f) ** 2,
    `explored runs cover ${i}/${n} (${bad} wrong), ${got.chunks.length} chunks (${mism} wrong tiles), minimap ${cells} cells at f=${f}; welcome ${welcomeKb} KiB vs full ${fullKb} KiB`];
});

console.log(`\n${passed} passed, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
