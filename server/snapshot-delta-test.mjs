// Scripted test + benchmark: delta snapshots (shared/src/snapshotDelta.ts) in a 1000 vs 1000 battle. Boots its OWN
// private server (tsx, PORT default 20712, COLONY_WORLD_SIZE=256 or DELTA_WORLD, COLONY_TEST_HOOKS=1, a temp COLONY_SAVE_DIR).
// Run from server/: `node snapshot-delta-test.mjs`.
//   Two clients stand on the same spot: D (`?delta=1`, decoded with the client's own applySnapshotDelta) and F
//   (full snapshots, as before). 1000 militia in 8 regiments attack-move into 1000 goblins in 8 regiments.
//   - Every D snapshot rebuilt from deltas equals F's snapshot of the same tick (colonists, mobs and every shared
//     section; checksums compared per tick).
//   - D's snapshots stay under 250 KB mid-battle (keyframes included); sizes and the tick's snapshot ms printed.
//   - A dropped snapshot (sequence gap) asks for a resync; the keyframe that follows matches again.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const PORT = Number(process.env.PORT ?? 20712);
const LIMIT_KB = 250;
const t0 = Date.now();
let fails = 0;
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const { applySnapshotDelta, newDeltaClientState } = await tsImport(
  pathToFileURL(path.join(SERVER_DIR, "../shared/src/snapshotDelta.ts")).href,
  import.meta.url,
);
const TILE = 32;

const saveDir = mkdtempSync(path.join(tmpdir(), "delta-"));
const proc = spawn(TSX, ["src/index.ts"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir, COLONY_WORLD_SIZE: process.env.DELTA_WORLD ?? "256" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
proc.stdout.on("data", (d) => (serverLog += d));
proc.stderr.on("data", (d) => (serverLog += d));
const stop = () => {
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    /* gone */
  }
  rmSync(saveDir, { recursive: true, force: true });
};

for (let i = 0; i < 600; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/saves`)).ok) break;
  } catch {
    /* not up yet */
  }
  await sleep(100);
}

// Sections that are per player (only when changed / differ between the two clients) or keep-last on the client.
const NOT_COMPARED = new Set(["type", "ud", "fights", "profile", "heroes", "life", "siteTiles", "sites", "relations", "quests",
  "zones", "livestock", "clanTiles", "enemyRegiments"]);
// Sent only when changed (and every 10th tick to full clients): compared on ticks both clients got them.
const KEEP_LAST = new Set(["armyRegiments", "orderGroups"]);
const sortById = (list) => list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const hash = (v) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 12);
const checksum = (snap) => {
  const out = { colonists: hash(sortById(snap.colonists)), mobs: hash(sortById(snap.mobs)) };
  for (const k of Object.keys(snap).sort()) if (!NOT_COMPARED.has(k) && k !== "colonists" && k !== "mobs") out[k] = hash(snap[k]);
  return out;
};
// The tick a snapshot belongs to (identical in both clients' copies of one broadcast).
const tickKey = (s) => `${s.calendar?.day ?? ""}:${s.cycleProgress}`;

function client(delta) {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}/${delta ? "?delta=1" : ""}`), welcome: null, snap: null, hook: new Map(), sizes: [], rec: false };
  c.st = delta ? newDeltaClientState() : null;
  c.byTick = new Map();
  c.resyncs = 0;
  c.keyframes = 0;
  c.dropNext = false;
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      const isKey = !!m.ud?.f;
      if (c.rec) c.sizes.push({ bytes: raw.length, key: isKey });
      if (c.dropNext) {
        c.dropNext = false;
        return;
      }
      if (isKey) c.keyframes++;
      if (c.st && applySnapshotDelta(c.st, m)) {
        c.resyncs++;
        c.ws.send(JSON.stringify({ type: "resync" }));
      }
      c.snap = m;
      if (!c.st || !c.st.awaitingKeyframe) {
        c.byTick.set(tickKey(m), checksum(m));
        if (c.byTick.size > 200) c.byTick.delete(c.byTick.keys().next().value);
      }
    } else if (m.type === "testHookResult") c.hook.set(m.op, m);
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 6000 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  return c;
}

// Compares every tick both clients hold; returns [matched, mismatched, first mismatch].
function compare(D, F) {
  let ok = 0;
  let bad = 0;
  let first = null;
  for (const [k, d] of D.byTick) {
    const f = F.byTick.get(k);
    if (!f) continue;
    const diff = Object.keys({ ...d, ...f }).filter((key) => d[key] !== f[key] && !(KEEP_LAST.has(key) && (!d[key] || !f[key])));
    if (diff.length) {
      bad++;
      first ??= `${k}: ${diff.join(",")}`;
    } else ok++;
  }
  return [ok, bad, first];
}

const kb = (b) => (b / 1024).toFixed(1);
function sizeLine(c) {
  const all = c.sizes.map((s) => s.bytes);
  const deltas = c.sizes.filter((s) => !s.key).map((s) => s.bytes);
  const keys = c.sizes.filter((s) => s.key).map((s) => s.bytes);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { n: all.length, avg: avg(all), max: Math.max(0, ...all), deltaAvg: avg(deltas), deltaMax: Math.max(0, ...deltas), keyMax: Math.max(0, ...keys) };
}

try {
  const D = client(true);
  const F = client(false);
  await Promise.all([D, F].map((c) => new Promise((r) => c.ws.on("open", r))));
  while (!D.welcome || !D.snap || !F.welcome || !F.snap) await sleep(20);
  result(D.keyframes >= 1, `delta client's first snapshot is a keyframe (${D.keyframes})`);
  const W = D.welcome.worldTilesX;
  const TC = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
  await D.hookCall("setRaids", { enabled: false });
  await D.hookCall("ignorePlayers", { value: true });
  const bx = TC.x - 40;
  const by = TC.y + 30;
  await D.hookCall("teleportPlayer", { x: (bx + 15) * TILE, y: by * TILE });
  await F.hookCall("teleportPlayer", { x: (bx + 15) * TILE, y: by * TILE });

  // Peace time first: the steady-state snapshot of a quiet colony.
  D.byTick.clear();
  F.byTick.clear();
  D.sizes = [];
  F.sizes = [];
  D.rec = F.rec = true;
  await sleep(2000);
  D.rec = F.rec = false;
  const quietD = sizeLine(D);
  const quietF = sizeLine(F);
  info(`quiet colony: full avg ${kb(quietF.avg)} KB, delta avg ${kb(quietD.deltaAvg)} KB (max ${kb(quietD.deltaMax)})`);
  let [ok, bad, first] = compare(D, F);
  result(ok >= 20 && bad === 0, `quiet: delta-rebuilt snapshots match full ones (${ok} ticks, ${bad} mismatched${first ? `, first ${first}` : ""})`);

  const ids = [];
  for (let r = 0; r < 8; r++) {
    const rid = [];
    for (let i = 0; i < 125; i++) {
      const res = await D.hookCall("spawnSoldier", { kind: "militia", x: (bx + (i % 5)) * TILE + 16, y: (by - 40 + r * 10 + Math.floor(i / 5) * 0.4) * TILE });
      if (res?.id) rid.push(res.id);
    }
    ids.push(rid);
  }
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 125; i++) {
      D.send({ type: "testHook", op: "spawnMob", kind: "goblin", tx: bx + 30 + (i % 5), ty: by - 40 + r * 10 + Math.floor(i / 25), regimentId: `bench${r}` });
    }
  }
  await D.hookCall("tickStats", { reset: true });
  for (let r = 0; r < 8; r++) D.send({ type: "regimentOrder", unitIds: ids[r], order: { kind: "attackMove", x: (bx + 32) * TILE, y: (by - 40 + r * 10) * TILE } });
  info(`spawned ${ids.flat().length} militia, 1000 goblins; battle running`);
  await sleep(3000);

  for (const label of ["battle t+3s", "battle t+7s"]) {
    D.byTick.clear();
    F.byTick.clear();
    D.sizes = [];
    F.sizes = [];
    D.rec = F.rec = true;
    // One keyframe inside each window (as on join / resync / every 30 s).
    setTimeout(() => D.send({ type: "resync" }), 1500);
    await D.hookCall("tickStats", { reset: true });
    await sleep(3000);
    D.rec = F.rec = false;
    const st = await D.hookCall("tickStats");
    const d = sizeLine(D);
    const f = sizeLine(F);
    info(`${label}: colonists ${D.snap.colonists.length}, mobs in view ${D.snap.mobs.length}; full avg ${kb(f.avg)} KB max ${kb(f.max)}; ` +
      `delta avg ${kb(d.deltaAvg)} KB max ${kb(d.deltaMax)}, keyframe ${kb(d.keyMax)} KB; tick avg ${st.avgMs.toFixed(1)} ms ` +
      `p95 ${st.p95Ms.toFixed(1)}, snapshot ${st.systems.snapshot} ms (both clients)`);
    result(d.max < LIMIT_KB * 1024, `${label}: every delta-client snapshot < ${LIMIT_KB} KB (max ${kb(d.max)} KB, keyframe ${kb(d.keyMax)} KB)`);
    [ok, bad, first] = compare(D, F);
    result(ok >= 20 && bad === 0, `${label}: delta-rebuilt snapshots match full ones (${ok} ticks, ${bad} mismatched${first ? `, first ${first}` : ""})`);
  }

  // A dropped snapshot: the client sees the gap, asks for a resync, and the keyframe brings it back in step.
  const resyncsBefore = D.resyncs;
  const keysBefore = D.keyframes;
  D.dropNext = true;
  await sleep(1500);
  result(D.resyncs === resyncsBefore + 1 && D.keyframes > keysBefore, `a sequence gap asks for one resync and gets a keyframe (resyncs ${D.resyncs - resyncsBefore}, keyframes ${D.keyframes - keysBefore})`);
  D.byTick.clear();
  F.byTick.clear();
  await sleep(1500);
  [ok, bad, first] = compare(D, F);
  result(ok >= 10 && bad === 0, `after the resync: delta-rebuilt snapshots match full ones (${ok} ticks, ${bad} mismatched${first ? `, first ${first}` : ""})`);

  // Snapshot cost with only the delta client vs only a full client connected.
  F.ws.close();
  await sleep(500);
  await D.hookCall("tickStats", { reset: true });
  await sleep(2000);
  const onlyD = await D.hookCall("tickStats");
  const F2 = client(false);
  await new Promise((r) => F2.ws.on("open", r));
  while (!F2.snap) await sleep(20);
  await F2.hookCall("teleportPlayer", { x: (bx + 15) * TILE, y: by * TILE });
  D.ws.close();
  await sleep(500);
  await F2.hookCall("tickStats", { reset: true });
  await sleep(2000);
  const onlyF = await F2.hookCall("tickStats");
  info(`snapshot ms per tick: delta client only ${onlyD.systems.snapshot}, full client only ${onlyF.systems.snapshot} (tick avg ${onlyD.avgMs.toFixed(1)} / ${onlyF.avgMs.toFixed(1)})`);
  F2.ws.close();
} catch (err) {
  result(false, `error: ${err?.stack ?? err}`);
  console.log(serverLog.slice(-3000));
}
stop();
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
