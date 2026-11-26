// Scripted test: rotating autosaves (2026-11-26, server/src/autosaves.ts). Self-contained: boots its OWN private
// servers (tsx, port PORT_A, default 18941) on a 512 streamed world (COLONY_STREAMING=1) with a scratch
// COLONY_SAVE_DIR, so no real save is ever touched. Run from server/: `node autosave-rotation-test.mjs`.
//   1. the keep rule for n = 1..200 (against an independent definition, sequentially applied, the worked examples)
//   2. 62 forced autosaves on disk across three worlds: after each one the files are exactly the keep set
//   3. base cache files: a world's base goes once no kept save needs it, stays while a kept autosave does
//   4. listSaves: numbered autosaves newest first ("Autosave <n>", number, savedAt, day, population), then the old
//      single autosave ("Autosave (old)") and the slots; the newest autosave (Continue) leads the list
//   5. every kept autosave loads and restores its own state (a stock marker); a kept one from an older world too
//   6. autosave slots refuse manual saves; malformed / traversal slots are ignored
//   7. the counter continues across a restart (SIGTERM shutdown save included in the series)
//   8. unrelated files in the save dir (slots, the old autosave.json, look-alike names) are never deleted
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autosaveFilesToDelete, autosavesToKeep, highestAutosave } from "./src/autosaves.ts";

const PORT = Number(process.env.PORT_A ?? 18941);
const SIZE = 512;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------- 1. the keep rule ----------------
// Independent definition: every multiple of 10 up to n, n itself, and the latest multiple of 5 (not of 10) at or
// below n with no multiple of 10 after it.
function expectedKeep(n) {
  const keep = new Set([n]);
  for (let k = 10; k <= n; k += 10) keep.add(k);
  for (let k = n; k >= 1; k--) {
    if (k % 10 === 0) break;
    if (k % 5 === 0) {
      keep.add(k);
      break;
    }
  }
  return [...keep].sort((a, b) => a - b);
}
{
  let bad = [];
  for (let n = 1; n <= 200; n++) {
    const all = Array.from({ length: n - 1 }, (_, i) => i + 1);
    if (!same(autosavesToKeep(n, all), expectedKeep(n))) bad.push(n);
  }
  result(bad.length === 0, `autosavesToKeep(n, 1..n-1) matches the rule for n = 1..200${bad.length ? ` (wrong: ${bad.slice(0, 10)})` : ""}`);
  // Applied save by save (what the server does): the dir always holds exactly the keep set.
  const disk = new Set();
  bad = [];
  let maxFiles = 0;
  for (let n = 1; n <= 200; n++) {
    disk.add(n);
    for (const name of autosaveFilesToDelete(n, [...disk].map((k) => `autosave-${k}.json`))) disk.delete(Number(name.match(/\d+/)[0]));
    const now = [...disk].sort((a, b) => a - b);
    if (!same(now, expectedKeep(n))) bad.push(n);
    // At most two files besides the multiples of 10.
    maxFiles = Math.max(maxFiles, now.filter((k) => k % 10 !== 0).length);
  }
  result(bad.length === 0 && maxFiles <= 2, `rotation applied save by save keeps exactly the keep set for n = 1..200 (max ${maxFiles} non-tens)`);
  const ex = { 48: [10, 20, 30, 40, 45, 48], 50: [10, 20, 30, 40, 50], 55: [10, 20, 30, 40, 50, 55], 56: [10, 20, 30, 40, 50, 55, 56], 4: [4], 7: [5, 7], 10: [10], 13: [10, 13] };
  const exBad = Object.entries(ex).filter(([n, want]) => !same(autosavesToKeep(Number(n), Array.from({ length: Number(n) }, (_, i) => i + 1)), want));
  result(exBad.length === 0, `worked examples (48 -> 10 20 30 40 45 48, 50 -> 10..50, 55 -> 10..50 55, 56 -> 10..50 55 56)${exBad.length ? ` wrong: ${exBad.map(([n]) => n)}` : ""}`);
  const junk = ["autosave.json", "autosave-07.json", "autosave-3.json.tmp", "autosave-3.json.bak", "slot1.json", "creative.json", "autosave-x.json", "autosave--3.json", "myautosave-4.json", "notes.txt", "base-1-512-v22.bin.gz", "autosave-3.json"];
  result(same(autosaveFilesToDelete(10, junk), ["autosave-3.json"]), `only canonical autosave-<n>.json files are ever deleted (${autosaveFilesToDelete(10, junk)})`);
  result(same(autosaveFilesToDelete(5, ["autosave-9.json", "autosave-12.json"]), []), "autosaves newer than n are never deleted");
  result(highestAutosave(junk) === 3 && highestAutosave([]) === 0, "the counter resumes from the highest canonical autosave-<n>.json");
}

// ---------------- server helpers ----------------
function startServer(dir) {
  const proc = spawn(TSX, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: String(SIZE), COLONY_STREAMING: "1", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const s = { proc, log: "", exited: false };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  proc.on("close", () => (s.exited = true));
  return s;
}
async function stopServer(s) {
  // SIGTERM, not SIGKILL: tsx relays it to its node child (which writes the shutdown autosave).
  if (!s.exited) s.proc.kill("SIGTERM");
  for (let i = 0; i < 200 && !s.exited; i++) await sleep(100);
}
async function waitForPort() {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/saves`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${PORT} never came up`);
}
function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, waiters: [], saveResults: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "saveResult") c.saveResults.push(m);
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 120000) =>
    new Promise((resolve, reject) => {
      c.waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    });
  c.hook = (op, data = {}) => {
    const p = c.wait((m) => m.type === "testHookResult" && m.op === op);
    c.send({ type: "testHook", op, ...data });
    return p;
  };
  c.nextSnap = () => c.wait((m) => m.type === "snapshot");
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  // Paused, so the stock marker of each autosave is exactly what was set.
  c.pause = async () => {
    for (let i = 0; i < 3; i++) {
      const s = await c.nextSnap();
      if (s.isPaused) return true;
      c.send({ type: "pause" });
      await sleep(300);
    }
    return (await c.nextSnap()).isPaused;
  };
  return c;
}
const listSaves = async () => (await (await fetch(`http://localhost:${PORT}/saves`)).json()).saves;
// Canonical numbers only (the "autosave-07.json" decoy is not an autosave).
const autosavesOnDisk = (dir) => readdirSync(dir).map((f) => /^autosave-([1-9]\d*)\.json$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
const baseFiles = (dir) => readdirSync(dir).filter((f) => f.startsWith("base-") && f.endsWith(".bin.gz")).sort();
const baseOf = (seed) => (f) => f.startsWith(`base-${seed}-${SIZE}-`);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Forces autosave n with wood = 100 * n as its marker, then checks the dir holds exactly the keep set.
const badRotation = [];
async function autosave(c, dir, n) {
  await c.hook("setStock", { stock: { wood: 100 * n } });
  const r = await c.hook("forceAutosave");
  const disk = autosavesOnDisk(dir);
  if (!r.ok || !same(disk, expectedKeep(n))) badRotation.push(`${n}: ${JSON.stringify(r)} disk ${disk}`);
}
async function restartWorld(c) {
  const before = c.welcomes;
  c.send({ type: "restart", worldSize: SIZE });
  while (c.welcomes === before) await sleep(100);
  await c.nextSnap();
  await c.pause();
  return (await c.hook("tileHash")).seed;
}

// ---------------- 2-6: one server, three worlds ----------------
const dir = mkdtempSync(path.join(tmpdir(), "colony-autosave-rot-"));
// Look-alike and unrelated files: none may ever be deleted or changed.
const UNRELATED = { "notes.txt": "keep me", "autosave-07.json": "{}", "autosave-3.json.bak": "{}", "autosave-x.json": "{}", "myautosave-4.json": "{}" };
for (const [f, text] of Object.entries(UNRELATED)) writeFileSync(path.join(dir, f), text);
let S = startServer(dir);
const seeds = [];
try {
  await waitForPort();
  const c = connect();
  await c.ready();
  result(await c.pause(), "sim paused");
  seeds.push((await c.hook("tileHash")).seed);
  // The old single autosave file and a manual slot (full-array saves: they name no base cache file).
  await c.hook("writeFullSave", { slot: "autosave" });
  await c.hook("writeFullSave", { slot: "slot1" });
  const kept = { "autosave.json": readFileSync(path.join(dir, "autosave.json"), "utf8"), "slot1.json": readFileSync(path.join(dir, "slot1.json"), "utf8") };

  // World 1: autosaves 1-4.
  for (let n = 1; n <= 4; n++) await autosave(c, dir, n);
  const base1 = baseFiles(dir).filter(baseOf(seeds[0]));
  result(base1.length === 1, `world 1 (seed ${seeds[0]}) has its base cache file (${baseFiles(dir)})`);
  // World 2: autosave 5 drops autosave 4, the last save naming world 1's base -> that base goes.
  seeds.push(await restartWorld(c));
  await autosave(c, dir, 5);
  result(
    seeds[1] !== seeds[0] && !baseFiles(dir).some(baseOf(seeds[0])) && baseFiles(dir).some(baseOf(seeds[1])),
    `world 1's base pruned once no kept save needs it; world 2's kept (${baseFiles(dir)})`
  );
  for (let n = 6; n <= 20; n++) await autosave(c, dir, n);
  // World 3: autosaves 21-62. Autosaves 10 and 20 (world 2) are kept forever, so world 2's base stays.
  seeds.push(await restartWorld(c));
  const lists = {};
  for (let n = 21; n <= 62; n++) {
    await autosave(c, dir, n);
    if ([48, 50, 55, 56].includes(n)) lists[n] = autosavesOnDisk(dir);
  }
  result(badRotation.length === 0, `62 forced autosaves: after each the dir holds exactly the keep set${badRotation.length ? ` (${badRotation.slice(0, 3).join(" | ")})` : ""}`);
  result(
    same(lists[48], [10, 20, 30, 40, 45, 48]) && same(lists[50], [10, 20, 30, 40, 50]) && same(lists[55], [10, 20, 30, 40, 50, 55]) && same(lists[56], [10, 20, 30, 40, 50, 55, 56]),
    `on disk at 48 / 50 / 55 / 56: ${JSON.stringify(lists)}`
  );
  result(
    seeds[2] !== seeds[1] && baseFiles(dir).some(baseOf(seeds[1])) && baseFiles(dir).some(baseOf(seeds[2])) && baseFiles(dir).length === 2,
    `world 2's base kept while autosaves 10 / 20 need it, world 3's too, nothing else (${baseFiles(dir)})`
  );

  // 4. listSaves.
  const list = await listSaves();
  const numbered = list.filter((s) => s.autosave !== undefined);
  result(
    // At 62, 55 is gone (60 came after it).
    same(list.map((s) => s.slot), ["autosave-62", "autosave-60", "autosave-50", "autosave-40", "autosave-30", "autosave-20", "autosave-10", "autosave", "slot1"]),
    `listSaves order: ${list.map((s) => s.slot)}`
  );
  result(
    numbered.every((s) => s.slot === `autosave-${s.autosave}` && s.label === `Autosave ${s.autosave}` && typeof s.savedAt === "string" && Number.isInteger(s.dayIndex) && Number.isInteger(s.population)) &&
      list.find((s) => s.slot === "autosave")?.label === "Autosave (old)" && list.find((s) => s.slot === "slot1")?.label === "Slot 1",
    `labels / numbers / metadata (${numbered.slice(0, 2).map((s) => JSON.stringify(s)).join(" ")}; old: ${list.find((s) => s.slot === "autosave")?.label})`
  );
  // Continue (client newestAutosave): the highest-numbered autosave, which leads the list.
  const newest = numbered.reduce((a, b) => (b.autosave > a.autosave ? b : a));
  result(newest.slot === "autosave-62" && list[0] === list.find((s) => s.autosave !== undefined) && list[0].slot === newest.slot, `newest autosave (Continue) = ${newest.slot}, first in the list`);

  // 6. Manual saves into autosave slots are refused; malformed / traversal slots are ignored (no reply, no file).
  const m62 = statSync(path.join(dir, "autosave-62.json")).mtimeMs;
  const before = c.saveResults.length;
  for (const slot of ["autosave-62", "autosave-63", "autosave"]) c.send({ type: "saveGame", slot });
  for (const slot of ["../autosave-62", "autosave-062", "autosave-1/../../slot1", "autosave-62.json", "autosave-0", "autosave--1", "/etc/passwd"]) c.send({ type: "loadGame", slot });
  await sleep(2000);
  result(
    c.saveResults.length === before && statSync(path.join(dir, "autosave-62.json")).mtimeMs === m62 && !existsSync(path.join(dir, "autosave-63.json")),
    `manual saves to autosave slots refused, bad slots ignored (${c.saveResults.length - before} replies)`
  );

  // 5. Every kept autosave loads and restores its own marker (10 / 20 are world 2's: its base comes from the cache file).
  const loadBad = [];
  for (const n of [62, 60, 50, 40, 30, 20, 10]) {
    const res = c.wait((m) => m.type === "saveResult" && m.action === "load");
    c.send({ type: "loadGame", slot: `autosave-${n}` });
    const r = await res;
    await c.nextSnap();
    const snap = await c.nextSnap();
    const seed = (await c.hook("tileHash")).seed;
    const wantSeed = n <= 20 ? seeds[1] : seeds[2];
    if (!r.ok || r.slot !== `autosave-${n}` || !near(snap.wood, 100 * n, 50) || seed !== wantSeed) loadBad.push(`${n}: ok ${r.ok} ${r.error ?? ""} wood ${snap.wood} seed ${seed}/${wantSeed}`);
  }
  result(loadBad.length === 0, `every kept autosave loads with its own state and world${loadBad.length ? ` (${loadBad.join(" | ")})` : ""}`);
  await c.pause();
  result(same(autosavesOnDisk(dir), [10, 20, 30, 40, 50, 60, 62]), `loads write no autosave (${autosavesOnDisk(dir)})`);
  for (const [f, text] of Object.entries(kept)) result(readFileSync(path.join(dir, f), "utf8") === text, `${f} untouched`);
  c.ws.close();
} catch (err) {
  result(false, `server 1 crashed: ${err.stack}`);
} finally {
  await stopServer(S);
}
const shutdown1 = S.log.split("\n").find((l) => l.includes("autosave on SIGTERM"));
// 7. The shutdown save is autosave 63 (62 goes).
result(/autosave-63/.test(shutdown1 ?? "") && same(autosavesOnDisk(dir), [10, 20, 30, 40, 50, 60, 63]), `SIGTERM save joins the series: ${shutdown1}; disk ${autosavesOnDisk(dir)}`);
const errs1 = S.log.split("\n").filter((l) => /error|exception|TypeError/i.test(l) && !/\[save\]|\[load\]/.test(l));
result(errs1.length === 0, `no exceptions in server 1 log${errs1.length ? ": " + errs1.slice(0, 3).join(" | ") : ""}`);

// ---------------- 7. a restarted server continues the series ----------------
S = startServer(dir);
try {
  await waitForPort();
  const c = connect();
  await c.ready();
  await c.pause();
  await autosave(c, dir, 64);
  result(same(autosavesOnDisk(dir), [10, 20, 30, 40, 50, 60, 64]), `after a restart the next autosave is 64 (${autosavesOnDisk(dir)})`);
  const list = await listSaves();
  result(list[0]?.slot === "autosave-64" && list[1]?.slot === "autosave-60", `restarted server lists ${list.slice(0, 3).map((s) => s.slot)}`);
  const res = c.wait((m) => m.type === "saveResult" && m.action === "load");
  c.send({ type: "loadGame", slot: "autosave-30" });
  const r = await res;
  const snap = (await c.nextSnap(), await c.nextSnap());
  result(r.ok && near(snap.wood, 3000, 50), `restarted server loads autosave 30 (wood ${snap.wood})`);
  // Base files: each one on disk is named by a kept save or is the world in memory; every kept save's base exists.
  const names = new Set();
  for (const n of autosavesOnDisk(dir)) {
    const f = JSON.parse(readFileSync(path.join(dir, `autosave-${n}.json`), "utf8"));
    if (typeof f.state.seed === "number") names.add(`base-${f.state.seed}-${f.worldSize}-v${f.state.worldgenVersion}.bin.gz`);
  }
  const live = (await c.hook("tileHash")).seed;
  const orphans = baseFiles(dir).filter((f) => !names.has(f) && !baseOf(live)(f));
  result(orphans.length === 0 && [...names].every((f) => existsSync(path.join(dir, f))) && !baseFiles(dir).some(baseOf(seeds[0])), `base files: no orphans, none missing (${baseFiles(dir)})`);
  c.ws.close();
} catch (err) {
  result(false, `server 2 crashed: ${err.stack}`);
} finally {
  await stopServer(S);
}
const errs2 = S.log.split("\n").filter((l) => /error|exception|TypeError/i.test(l) && !/\[save\]|\[load\]/.test(l));
result(errs2.length === 0, `no exceptions in server 2 log${errs2.length ? ": " + errs2.slice(0, 3).join(" | ") : ""}`);

// 8. Unrelated files.
const changed = Object.entries(UNRELATED).filter(([f, text]) => !existsSync(path.join(dir, f)) || readFileSync(path.join(dir, f), "utf8") !== text);
result(changed.length === 0 && existsSync(path.join(dir, "autosave.json")) && existsSync(path.join(dir, "slot1.json")), `unrelated files never deleted or changed${changed.length ? ` (${changed.map(([f]) => f)})` : ""}`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
