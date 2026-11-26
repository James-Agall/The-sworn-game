// Lab server: security gate, allow-list, traversal, symlinks, sizes, atomic writes, backups, save transaction, slicer.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, rm, symlink, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { resolveWritable } from "../server/paths.ts";
import { atomicWrite, Backup, MAX_BACKUPS, writeWithBackup } from "../server/store.ts";
import { encodePNG } from "../server/png.ts";
import { request, scratchRoot, write, PUBLIC } from "./helpers.ts";

let lab: Lab, root: string, base: string;
const SET_DIR = () => path.join(root, "client/public/rig/parts/grounded-v2");
const png = (w: number, h: number, rgba = [25, 20, 20, 255]) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return encodePNG({ w, h, data });
};

before(async () => {
  root = await scratchRoot();
  lab = await startLab({ root, port: 31811, vite: false });
  base = lab.url;
});
after(async () => { await lab.close(); await rm(root, { recursive: true, force: true }); });

test("binds 127.0.0.1 only", () => {
  assert.equal((lab.server.address() as { address: string }).address, "127.0.0.1");
});

test("lists sets and reads a set with its manifest hash", async () => {
  const sets = (await request(base + "api/sets")).json();
  assert.ok(sets.some((s: { name: string }) => s.name === "grounded-v2"));
  const g = (await request(base + "api/sets/grounded-v2")).json();
  assert.equal(g.manifestText, await readFile(path.join(SET_DIR(), "manifest.json"), "utf8"));
  assert.match(g.hash, /^[0-9a-f]{64}$/);
  assert.ok(g.files.includes("head.png"));
});

test("refuses a foreign Host header (DNS rebinding)", async () => {
  const r = await request(base + "api/sets", { headers: { Host: "evil.example:31811" } });
  assert.equal(r.status, 403);
  const r2 = await request(base + "rig/body.html", { headers: { Host: "evil.example" } });
  assert.equal(r2.status, 403);
});

test("refuses cross-origin reads and writes, and writes without Origin / X-Lab / JSON type", async () => {
  assert.equal((await request(base + "api/sets", { headers: { Origin: "http://evil.example" } })).status, 403);
  assert.equal((await request(base + "api/sets", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  const body = JSON.stringify({ name: "x1" });
  assert.equal((await request(base + "api/sets", { method: "POST", body, headers: { "Content-Type": "application/json", Origin: "http://evil.example", "X-Lab": "1" } })).status, 403);
  assert.equal((await request(base + "api/sets", { method: "POST", body, headers: { "Content-Type": "application/json", "X-Lab": "1" } })).status, 403);
  assert.equal((await request(base + "api/sets", { method: "POST", body, headers: { "Content-Type": "application/json", Origin: new URL(base).origin } })).status, 403);
  assert.equal((await request(base + "api/sets", { method: "POST", body, headers: { "Content-Type": "text/plain", Origin: new URL(base).origin, "X-Lab": "1" } })).status, 415);
  assert.equal((await request(base + "api/sets", { method: "DELETE", headers: { Origin: new URL(base).origin, "X-Lab": "1" } })).status, 405);
  const opt = await request(base + "api/sets", { method: "OPTIONS", headers: { Origin: "http://evil.example" } });
  assert.equal(opt.status, 403);
  assert.equal(opt.headers["access-control-allow-origin"], undefined);
  await assert.rejects(stat(path.join(root, "client/public/rig/parts/x1")));
});

test("refuses traversal: .., encoded dots, encoded slashes, double encoding, backslashes, absolute paths", async () => {
  for (const p of ["/rig/../../package.json", "/rig/%2e%2e/%2e%2e/package.json", "/rig/..%2f..%2fpackage.json", "/rig/%252e%252e/x",
    "/rig/..\\..\\package.json", "/sprites//etc/passwd", "/rig/parts/grounded-v2/%00.png", "/api/sets/..", "/api/sets/%2e%2e", "/api/sets/a%2fb",
    "/api/validate/..%2F..%2Fetc"]) {
    const r = await request(base, { rawPath: p });
    assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.toString().includes('"workspaces"'), `${p} leaked package.json`);
  }
  await assert.rejects(resolveWritable(root, "/etc/passwd"), /bad path/);
  await assert.rejects(resolveWritable(root, "client/public/rig/parts/grounded-v2/../../../x.png"), /bad path/);
  await assert.rejects(resolveWritable(root, "client/public/rig/parts/grounded-v2/a\\b.png"), /bad path/);
});

test("allow-list: only parts/<set>/, clips/ and art-sources/lab/ are writable; odd names refused", async () => {
  assert.ok(await resolveWritable(root, "client/public/rig/parts/grounded-v2/head.png"));
  assert.ok(await resolveWritable(root, "client/public/rig/clips/walk.json"));
  assert.ok(await resolveWritable(root, "art-sources/lab/palettes/x.json"));
  for (const bad of ["client/public/rig/body.html", "client/src/heroRig.ts", "client/public/rig/parts/grounded-v2/head.js", "package.json",
    "client/public/rig/parts/Bad_Set/head.png", "client/public/rig/parts/-x/head.png", "client/public/rig/parts/grounded-v2/sub/head.png",
    "client/public/rig/clips/Walk.json", "server/saves/x.json", "art-sources/other/x.png"]) {
    await assert.rejects(resolveWritable(root, bad), /not writable|bad path/, bad);
  }
  for (const name of ["Bad", "../x", "a/b", "", "x".repeat(60), "-a", ".hidden"]) {
    const r = await write(base, "api/sets", { name });
    assert.equal(r.status, 400, `set name ${JSON.stringify(name)}`);
  }
});

test("symlinks escaping the root (or anywhere in the path) are refused", async () => {
  const outside = path.join(root, "..", path.basename(root) + "-outside");
  await mkdir(outside, { recursive: true });
  try {
    await symlink(outside, path.join(root, "client/public/rig/parts/linked"));
    await assert.rejects(resolveWritable(root, "client/public/rig/parts/linked/head.png"), /symlink/);
    const r = await write(base, "api/sets/linked/save", { baseHash: "none", manifest: { parts: {} } });
    assert.equal(r.status, 404);
    await writeFile(path.join(outside, "secret.png"), "x");
    await symlink(path.join(outside, "secret.png"), path.join(SET_DIR(), "evil.png"));
    await assert.rejects(resolveWritable(root, "client/public/rig/parts/grounded-v2/evil.png"), /symlink/);
    const r2 = await request(base + "rig/parts/grounded-v2/evil.png");
    assert.equal(r2.status, 403);
    await symlink(outside, path.join(root, "client/public/rig/escape"));
    assert.equal((await request(base + "rig/escape/secret.png")).status, 403);
  } finally {
    await rm(path.join(root, "client/public/rig/parts/linked"), { force: true });
    await rm(path.join(SET_DIR(), "evil.png"), { force: true });
    await rm(path.join(root, "client/public/rig/escape"), { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("oversize bodies are refused with 413", async () => {
  const big = JSON.stringify({ name: "x".repeat(2 << 20) });
  const r = await request(base + "api/sets", { method: "POST", body: big, headers: { "Content-Type": "application/json", Origin: new URL(base).origin, "X-Lab": "1" } });
  assert.equal(r.status, 413);
});

test("save transaction: stale hash is 409; writes PNG + manifest atomically with a backup; untouched entries byte-identical", async () => {
  const g = (await request(base + "api/sets/grounded-v2")).json();
  const m = JSON.parse(g.manifestText);
  assert.equal((await write(base, "api/sets/grounded-v2/save", { baseHash: "0".repeat(64), manifest: m })).status, 409);
  m.parts.head.pivot = [9, 30];
  const newPng = png(m.parts.head.size[0], m.parts.head.size[1]);
  const r = await write(base, "api/sets/grounded-v2/save", { baseHash: g.hash, manifest: m, files: { "head.png": newPng.toString("base64") }, sidecar: { order: ["head", "torso"] } });
  assert.equal(r.status, 200, r.body.toString());
  const out = r.json();
  assert.deepEqual(await readFile(path.join(SET_DIR(), "head.png")), newPng);
  const text = await readFile(path.join(SET_DIR(), "manifest.json"), "utf8");
  assert.deepEqual(JSON.parse(text).parts.head.pivot, [9, 30]);
  // only the head entry changed
  const oldLines = g.manifestText.split("\n"), newLines = text.split("\n");
  assert.equal(oldLines.length, newLines.length);
  const diff = oldLines.filter((l: string, i: number) => l !== newLines[i]);
  assert.ok(diff.length <= 2 && diff.length > 0, `changed lines: ${diff.length}`);
  assert.deepEqual(JSON.parse(await readFile(path.join(SET_DIR(), "lab.json"), "utf8")), { order: ["head", "torso"] });
  // backups of the old head.png and the old manifest
  assert.ok(out.backup);
  const bdir = path.join(root, out.backup, "client/public/rig/parts/grounded-v2");
  assert.equal(await readFile(path.join(bdir, "manifest.json"), "utf8"), g.manifestText);
  assert.deepEqual(await readFile(path.join(bdir, "head.png")), await readFile(path.join(PUBLIC, "rig/parts/grounded-v2/head.png")));
  // no temp files left behind
  assert.deepEqual((await readdir(SET_DIR())).filter((f) => f.startsWith(".")), []);
});

test("save refuses bad PNGs, bad names, missing files and odd manifests", async () => {
  const g = (await request(base + "api/sets/grounded-v2")).json(), m = JSON.parse(g.manifestText);
  const s = (body: object) => write(base, "api/sets/grounded-v2/save", { baseHash: g.hash, manifest: m, ...body });
  assert.equal((await s({ files: { "head.png": Buffer.from("not a png").toString("base64") } })).status, 400);
  assert.equal((await s({ files: { "../head.png": png(2, 2).toString("base64") } })).status, 400);
  assert.equal((await s({ files: { "head.exe": png(2, 2).toString("base64") } })).status, 400);
  assert.equal((await s({ files: { "big.png": png(1100, 2).toString("base64") } })).status, 400);
  assert.equal((await s({ deleteFiles: ["head.png"] })).status, 400, "deleting a file the manifest still uses");
  assert.equal((await s({ deleteFiles: ["../manifest.json"] })).status, 400);
  assert.equal((await write(base, "api/sets/grounded-v2/save", { baseHash: g.hash, manifest: { parts: { x: { file: "x.png" } } } })).status, 400);
  assert.equal((await write(base, "api/sets/grounded-v2/save", { baseHash: g.hash, manifest: { parts: { x: { file: "nope.png", pivot: [1, 1] } } } })).status, 400);
  assert.equal((await s({ sidecar: { order: [1, 2] } })).status, 400);
});

test("create set (blank and copy), delete a part file with backup", async () => {
  const r = await write(base, "api/sets", { name: "lab-copy", copyFrom: "bodyset" });
  assert.equal(r.status, 200, r.body.toString());
  assert.equal((await write(base, "api/sets", { name: "lab-copy" })).status, 409);
  const s = r.json(), m = JSON.parse(s.manifestText);
  assert.ok(m.parts.head);
  delete m.parts.hair;
  const r2 = await write(base, "api/sets/lab-copy/save", { baseHash: s.hash, manifest: m, deleteFiles: ["hair.png"] });
  assert.equal(r2.status, 200, r2.body.toString());
  await assert.rejects(stat(path.join(root, "client/public/rig/parts/lab-copy/hair.png")));
  assert.ok(await stat(path.join(root, r2.json().backup, "client/public/rig/parts/lab-copy/hair.png")));
  const blank = (await write(base, "api/sets", { name: "lab-blank" })).json();
  assert.deepEqual(JSON.parse(blank.manifestText), { set: "lab-blank", parts: {} });
});

test("atomic write leaves the old file intact when the write fails, backups are bounded", async () => {
  const rel = "art-sources/lab/notes/a.json";
  await atomicWrite(root, rel, "one");
  assert.equal(await readFile(path.join(root, rel), "utf8"), "one");
  await assert.rejects(atomicWrite(root, rel, undefined as unknown as string));
  assert.equal(await readFile(path.join(root, rel), "utf8"), "one");
  for (let i = 0; i < MAX_BACKUPS + 5; i++) {
    const b = new Backup(root);
    await writeWithBackup(root, b, rel, "v" + i);
    await b.prune();
  }
  const dirs = await readdir(path.join(root, "art-sources/lab/backups"));
  assert.equal(dirs.length, MAX_BACKUPS);
  assert.equal(await readFile(path.join(root, rel), "utf8"), "v" + (MAX_BACKUPS + 4));
});

test("palettes come from heroRig.ts; clips and lab palettes round-trip; layouts listed", async () => {
  const p = (await request(base + "api/palettes")).json();
  assert.equal(p.heroError, null);
  assert.equal(p.hero.skin.length, 5);
  assert.equal(p.hero.hair.length, 6);
  assert.equal((await write(base, "api/clips/walk-test", { loop: true, keys: [] }, "PUT")).status, 200);
  assert.deepEqual((await request(base + "api/clips/walk-test")).json(), { loop: true, keys: [] });
  assert.deepEqual((await request(base + "api/clips")).json(), ["walk-test"]);
  assert.equal((await write(base, "api/clips/Bad.Name", {}, "PUT")).status, 400);
  assert.equal((await write(base, "api/palettes/mine", { skin: ["#000000"] }, "PUT")).status, 200);
  assert.deepEqual((await request(base + "api/palettes")).json().lab, ["mine"]);
  const layouts = (await request(base + "api/layouts")).json();
  assert.ok(layouts.some((l: { name: string }) => l.name === "grounded-body-parts"));
  assert.ok(!layouts.some((l: { name: string }) => l.name === "painted-generation-prompts"));
});

test("slice: runs the repo slicer on a scratch set with validated args, backs up first", async () => {
  // a 2x2-cell sheet for the placeholder layout is overkill; use the real layout with a synthetic sheet of its size
  const layout = JSON.parse(await readFile(path.join(PUBLIC, "../../scripts/rig-layouts/placeholder-sheet.json"), "utf8"));
  const cols = Math.max(...layout.cells.map((c: { col: number }) => c.col)) + 1, rows = Math.max(...layout.cells.map((c: { row: number }) => c.row)) + 1;
  const w = cols * layout.cellW, h = rows * layout.cellH, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x % layout.cellW, cy = y % layout.cellH, inside = cx > layout.cellW * 0.3 && cx < layout.cellW * 0.7 && cy > layout.cellH * 0.2 && cy < layout.cellH * 0.8;
    data.set(inside ? [120, 90, 60, 255] : [255, 255, 255, 255], (y * w + x) * 4);
  }
  const sheet = encodePNG({ w, h, data }).toString("base64");
  assert.equal((await write(base, "api/slice", { set: "sliced-demo", layout: "../x", sheet })).status, 400);
  assert.equal((await write(base, "api/slice", { set: "sliced-demo", layout: "placeholder-sheet", sheet, bg: "--merge" })).status, 400);
  assert.equal((await write(base, "api/slice", { set: "../x", layout: "placeholder-sheet", sheet })).status, 400);
  const before = await readFile(path.join(root, "client/public/rig/parts/sliced-demo/manifest.json"), "utf8");
  const r = await write(base, "api/slice", { set: "sliced-demo", layout: "placeholder-sheet", sheet, bg: "auto" });
  assert.equal(r.status, 200, r.body.toString());
  const out = r.json();
  assert.ok(out.backup);
  assert.equal(await readFile(path.join(root, out.backup, "client/public/rig/parts/sliced-demo/manifest.json"), "utf8"), before);
  assert.ok(Object.keys(JSON.parse(out.manifestText).parts).length > 0);
  assert.ok(await stat(path.join(root, out.sheet)));
});

test("the real repo was not touched by these tests", async () => {
  assert.ok(!root.startsWith(path.resolve(PUBLIC, "../..")));
  await assert.rejects(stat(path.join(PUBLIC, "rig/parts/lab-copy")));
});
