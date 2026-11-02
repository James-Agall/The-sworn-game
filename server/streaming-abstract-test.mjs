// Scripted test: world streaming phase 3 (abstract records + catch-up). ONE private server at 512 with
// COLONY_STREAMING=1 (streaming forced on below 768), test hooks and a scratch save dir. Checks:
//  1. far COLD chunks park mobs / animals (auditWorld: each entity in exactly one form)
//  2. teleporting into a COLD corner wakes it (records gone, entities back, audit clean)
//  3. after a game day away, a woken chunk's animals are caught up (born / died) within the caps
//  4. save -> load keeps the abstract counts (parked animals / mobs) and the audit clean
//  5. warbands / camp raids (phase 3b) and wagons (3c) — see the checks below
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const TILE = 32;
const DAY = 20 * 375; // a whole game day (day + night)
const SIZE = Number(process.env.STREAM_TEST_SIZE ?? 512);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portFree = (port) => new Promise((res) => { const s = net.createServer(); s.once("error", () => res(false)); s.listen(port, () => s.close(() => res(true))); });
let PORT = 32400;
while (!(await portFree(PORT))) PORT++;
const saveDir = mkdtempSync(path.join(tmpdir(), "colony-stream-"));
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
const home = { x: tc.x, y: tc.y + 3 };
await tp(home.x, home.y);
await ff(60);
// The middle of the COLD chunk furthest from the Town Center (re-picked per check).
const corner = { x: 0, y: 0 };
const pickCorner = async () => {
  const cs = await hook("chunkState", { list: true });
  let best = -1;
  for (const i of cs.coldList) {
    const x = (i % cs.chunksX) * 32 + 16;
    const y = Math.floor(i / cs.chunksX) * 32 + 16;
    const d = Math.max(Math.abs(x - tc.x), Math.abs(y - tc.y));
    if (d > best) [best, corner.x, corner.y] = [d, x, y];
  }
};
const fmt = (r) => `${r?.problems?.length ?? "?"} problems${r?.problems?.length ? " (" + r.problems.slice(0, 3).join("; ") + ")" : ""}`;

await check("COLD chunks park mobs and animals; audit clean", async () => {
  await pickCorner();
  const cs = await hook("chunkState", { x: corner.x * TILE, y: corner.y * TILE });
  const r = await audit();
  return [cs.on && cs.cold > 0 && cs.at === 0 && r.ok && r.counts.parkedMobs > 0 && r.counts.parkedWildlife > 0,
    `${cs.active}/${cs.warm}/${cs.cold} chunks, corner ${cs.at}; ${fmt(r)}; parked ${r.counts.parkedMobs} mobs / ${r.counts.parkedWildlife} animals, live ${r.counts.liveMobs} / ${r.counts.liveWildlife}`];
});

await check("waking a COLD corner restores its entities (audit clean)", async () => {
  await pickCorner();
  const before = (await audit()).counts;
  await tp(corner.x, corner.y);
  await ff(25);
  const cs = await hook("chunkState", { x: corner.x * TILE, y: corner.y * TILE });
  const r = await audit();
  const woke = r.counts.chunksWoken - before.chunksWoken;
  return [cs.at === 2 && r.ok && woke > 0 && r.counts.mobsUnparked + r.counts.wildUnparked > before.mobsUnparked + before.wildUnparked,
    `corner ${cs.at}, ${woke} chunks woken, unparked mobs ${r.counts.mobsUnparked - before.mobsUnparked}, animals ${r.counts.wildUnparked - before.wildUnparked}; ${fmt(r)}`];
});

await check("a day away: woken animals are caught up within the caps", async () => {
  await tp(home.x, home.y);
  // Room under the caps for births: no respawn, the live animals gone (the parked counts stay).
  await hook("setWildlifeRespawn", { enabled: false });
  await ff(300);
  await hook("clearWildlife");
  await ff(DAY + 400);
  await pickCorner();
  const before = (await audit()).counts;
  await tp(corner.x, corner.y);
  await ff(25);
  const r = await audit();
  const born = r.counts.wildBorn - before.wildBorn;
  const died = r.counts.wildDied - before.wildDied;
  return [r.ok && born + died > 0, `born ${born}, died ${died}, lost ${r.counts.wildLost - before.wildLost}; ${fmt(r)}`];
});

await check("save -> load keeps the abstract records (audit clean)", async () => {
  await tp(home.x, home.y);
  await ff(DAY / 4);
  const before = (await audit()).counts;
  c.saves.length = 0;
  send({ type: "saveGame", slot: "slot1" });
  await until(() => c.saves.length > 0, 30000);
  if (!c.saves[0]?.ok) return `save failed: ${JSON.stringify(c.saves[0])}`;
  c.welcome = null;
  send({ type: "loadGame", slot: c.saves[0].slot });
  await until(() => c.welcome, 60000);
  send({ type: "pause", paused: true });
  await ff(5);
  const r = await audit();
  return [r.ok && r.counts.parkedWildlife === before.parkedWildlife && Math.abs(r.counts.parkedMobs - before.parkedMobs) <= 2,
    `parked animals ${before.parkedWildlife} -> ${r.counts.parkedWildlife}, mobs ${before.parkedMobs} -> ${r.counts.parkedMobs}; ${fmt(r)}`];
});

// ---- phase 3b: warbands and camp raids ----
await check("warband: abstract while COLD, bodies when its chunk is ACTIVE, abstract again after", async () => {
  await tp(home.x, home.y);
  await ff(300);
  await pickCorner();
  const sp = await hook("spawnWarband", { faction: "bandit", x0: corner.x - 6, y0: corner.y - 6, atX: corner.x, atY: corner.y, size: 4 });
  const w0 = sp?.warband;
  if (!w0) return `spawn failed: ${sp?.problem}`;
  await ff(25);
  const a = (await hook("warbandsState")).warbands.find((w) => w.id === w0.id);
  await tp(a.tile.x, a.tile.y);
  await ff(25);
  const b = (await hook("warbandsState")).warbands.find((w) => w.id === w0.id);
  await tp(home.x, home.y);
  await ff(260);
  const d = (await hook("warbandsState")).warbands.find((w) => w.id === w0.id);
  const r = await audit();
  return [a && !a.materialised && b?.materialised && b.members === 4 && d && !d.materialised && r.ok,
    `COLD ${a?.materialised}, ACTIVE ${b?.materialised} (${b?.members} bodies), back home ${d?.materialised}; ${fmt(r)}`];
});

await check("camp raid mustering outside ACTIVE chunks is abstract, materialises in an ACTIVE chunk", async () => {
  await tp(home.x, home.y);
  await ff(25);
  let site = null;
  let muster = null;
  for (const [dx, dy] of [[136, 0], [-136, 0], [0, 136], [0, -136]]) {
    const st = await hook("stampSite", { template: "thornwick", dx, dy, search: 8, tier: 1 });
    if (!st?.site) continue;
    const s = st.site;
    const dist = Math.hypot(tc.x - s.keepX, tc.y - s.keepY);
    const m = { x: Math.round(s.keepX + ((tc.x - s.keepX) / dist) * 14), y: Math.round(s.keepY + ((tc.y - s.keepY) / dist) * 14) };
    const cs = await hook("chunkState", { x: m.x * TILE, y: m.y * TILE });
    if (dist <= 140 && cs.at !== 2) {
      site = s;
      muster = m;
      break;
    }
  }
  if (!site) return "no camp spot whose muster point is outside the ACTIVE chunks";
  await hook("growSite", { siteId: site.id, found: true, tiers: 3 });
  const before = (await audit()).counts;
  const cr = await hook("campRaids", { day: 4 });
  const mid = (await audit()).counts;
  await tp(muster.x, muster.y);
  await ff(25);
  const r = await audit();
  return [cr.groups.length === 0 && mid.abstractRaids === before.abstractRaids + 1 && r.counts.abstractRaids === before.abstractRaids && r.counts.raidsMaterialised === before.raidsMaterialised + 1 && r.ok,
    `${site.name} at ${Math.round(Math.hypot(tc.x - site.keepX, tc.y - site.keepY))} tiles: real groups ${cr.groups.length}, abstract ${before.abstractRaids} -> ${mid.abstractRaids} -> ${r.counts.abstractRaids}, materialised ${r.counts.raidsMaterialised - before.raidsMaterialised}; ${fmt(r)}`];
});

console.log(failed.length === 0 ? `ALL PASS (${passed} checks)` : `${failed.length} FAILED (${failed.join("; ")}), ${passed} passed`);
c.ws.close();
process.exit(failed.length === 0 ? 0 : 1);
