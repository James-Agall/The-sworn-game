// Area tab server API: template list / read / save / delete / duplicate / import, the allow-list (user/ only, built-ins
// read-only), bad ids and paths, the game validators' reasons on refusal, size limits, atomic writes and backups, and
// round trips of every built-in (load -> validate -> edit-free save as a user copy = the same content).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile, mkdir, symlink, stat } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { resolveWritable, isWritable } from "../server/paths.ts";
import { loadArea } from "../server/game.ts";
import { request, scratchRoot, write, REPO_DIR, TEMPLATE_DIRS } from "./helpers.ts";

let lab: Lab, root: string, base: string;
const userDir = (k: string) => path.join(root, "server/data", k, "user");
const builtin = async (k: string, id: string) => JSON.parse(await readFile(path.join(REPO_DIR, "server/data", k, id + ".json"), "utf8"));
const save = (k: string, template: unknown, extra: Record<string, unknown> = {}) => write(base, `api/templates/${k}/save`, { template, ...extra });

before(async () => {
  root = await scratchRoot({ templates: true });
  lab = await startLab({ root, port: 31812, vite: false });
  base = lab.url;
});
after(async () => { await lab.close(); await rm(root, { recursive: true, force: true }); });

test("allow-list: only server/data/<kind>/user/<name>.json is writable", async () => {
  assert.ok(isWritable(["server", "data", "camps", "user", "my-camp.json"]));
  assert.ok(isWritable(["server", "data", "settlements", "user", "a_b-1.json"]));
  for (const segs of [
    ["server", "data", "camps", "t1-forest-camp.json"],          // a built-in
    ["server", "data", "camps", "user", "Bad.json"],              // upper case
    ["server", "data", "camps", "user", "-x.json"],
    ["server", "data", "camps", "user", "x.txt"],
    ["server", "data", "camps", "user", "x".repeat(62) + ".json"],
    ["server", "data", "settlements-legacy", "user", "x.json"],
    ["server", "data", "forts", "user", "x.json"],
    ["server", "data", "camps", "user", "sub", "x.json"],
    ["server", "src", "camps.ts"],
    ["server", "saves", "x.json"],
  ]) assert.equal(isWritable(segs), false, segs.join("/"));
  await assert.rejects(resolveWritable(lab.root, "server/data/camps/t1-forest-camp.json"), /not writable/);
  await assert.rejects(resolveWritable(lab.root, "server/data/camps/user/../t1-forest-camp.json"), /bad path/);
  await assert.rejects(resolveWritable(lab.root, "server/data/camps/user/%2e%2e.json"), /bad path/);
});

test("lists built-ins and user templates of each kind with metadata", async () => {
  for (const k of TEMPLATE_DIRS) {
    const list = (await request(base + "api/templates/" + k)).json();
    const files = (await readdir(path.join(REPO_DIR, "server/data", k))).filter((f) => f.endsWith(".json"));
    assert.equal(list.filter((e: { src: string }) => e.src === "builtin").length, files.length, k);
    for (const e of list) {
      assert.equal(e.errors.length, 0, `${k}/${e.id}: ${e.errors[0]}`);
      assert.ok(e.w > 0 && e.h > 0 && e.name && e.path.startsWith(`server/data/${k}/`));
    }
  }
  assert.equal((await request(base + "api/templates/forts")).status, 404);
});

test("reads a template with its hash; refuses bad ids / sources / traversal", async () => {
  const r = (await request(base + "api/templates/camps/builtin/t1-forest-camp")).json();
  assert.deepEqual(r.template, await builtin("camps", "t1-forest-camp"));
  assert.match(r.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.errors, []);
  assert.equal((await request(base + "api/templates/camps/user/t1-forest-camp")).status, 404);
  assert.equal((await request(base + "api/templates/camps/builtin/Bad_Id")).status, 400);
  assert.equal((await request(base + "api/templates/camps/elsewhere/t1-forest-camp")).status, 404);
  assert.equal((await request(base + "api/templates/camps/builtin/..%2F..%2Fsrc")).status, 400);
  assert.equal((await request(base + "x", { rawPath: "/api/templates/camps/builtin/%2e%2e" })).status, 400);
});

test("never writes a built-in: its id is refused, delete refused, file untouched", async () => {
  const before = await readFile(path.join(root, "server/data/camps/t1-forest-camp.json"));
  const t = await builtin("camps", "t1-forest-camp");
  const r = await save("camps", { ...t, name: "Changed" }, { overwrite: true });
  assert.equal(r.status, 409);
  assert.match(r.json().error, /built-in/);
  const d = await write(base, "api/templates/camps/delete", { id: "t1-forest-camp" });
  assert.equal(d.status, 409);
  assert.deepEqual(await readFile(path.join(root, "server/data/camps/t1-forest-camp.json")), before);
  assert.equal((await readdir(userDir("camps"))).filter((f) => f.endsWith(".json")).length, 0);
});

test("invalid templates are refused with the game validator's reasons", async () => {
  const t = await builtin("camps", "t1-forest-camp");
  const two = t.rows.map((r: string, y: number) => (y === 0 ? "H" + r.slice(1) : r));
  let r = await save("camps", { ...t, id: "two-hearths", rows: two });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /exactly one hearth H \(has 2\)/);
  r = await save("buildings", { ...(await builtin("buildings", "house-hut")), id: "no-door", rows: ["###", "#=#", "###"] });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /outside door/);
  const ham = await builtin("settlements", "hamlet-chapel");
  r = await save("settlements", { ...ham, id: "bad-ref", buildings: [...ham.buildings, { ref: "no-such-building", x: 0, y: 0 }] });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /unknown template "no-such-building"/);
  r = await save("camps", { ...t, id: "Bad Id" });
  assert.equal(r.status, 400);
  r = await save("camps", "not an object");
  assert.equal(r.status, 400);
  const v = (await write(base, "api/templates/camps/validate", { template: { ...t, rows: two } })).json();
  assert.ok(v.errors.some((e: string) => /hearth/.test(e)));
});

test("save writes user/<id>.json atomically in the game's format, overwrite needs the flag, changes are backed up", async () => {
  const A = await loadArea();
  const t = { ...(await builtin("camps", "t2-longhouse")), id: "lab-copy", name: "Lab copy", builtin: true, note: "dropped" };
  let r = await save("camps", t);
  assert.equal(r.status, 200, r.body.toString());
  const file = path.join(userDir("camps"), "lab-copy.json");
  const text = await readFile(file, "utf8");
  assert.equal(text, A.formatTemplate(A.normalise("camps", t)));
  assert.equal(r.json().path, "server/data/camps/user/lab-copy.json");
  assert.ok(!("builtin" in JSON.parse(text)) && !("note" in JSON.parse(text)));
  // no temp files left
  assert.deepEqual((await readdir(userDir("camps"))).filter((f) => f.startsWith(".lab-tmp")), []);
  r = await save("camps", { ...t, name: "Second" });
  assert.equal(r.status, 409);
  const read = (await request(base + "api/templates/camps/user/lab-copy")).json();
  r = await save("camps", { ...t, name: "Second" }, { overwrite: true, baseHash: read.hash });
  assert.equal(r.status, 200);
  const bk = r.json().backup as string;
  assert.ok(bk && bk.startsWith("art-sources/lab/backups/"));
  assert.equal(await readFile(path.join(root, bk, "server/data/camps/user/lab-copy.json"), "utf8"), text);
  // stale hash (someone else saved meanwhile) is refused
  r = await save("camps", { ...t, name: "Third" }, { overwrite: true, baseHash: read.hash });
  assert.equal(r.status, 409);
  assert.match(r.json().error, /changed on disk/);
  const del = await write(base, "api/templates/camps/delete", { id: "lab-copy" });
  assert.equal(del.status, 200);
  assert.ok(del.json().backup);
  await assert.rejects(stat(file));
  assert.equal((await write(base, "api/templates/camps/delete", { id: "lab-copy" })).status, 404);
});

test("duplicate to user: new id, collision rules", async () => {
  let r = await write(base, "api/templates/settlements/duplicate", { src: "builtin", from: "hamlet-chapel", id: "my-chapel", name: "My chapel" });
  assert.equal(r.status, 200, r.body.toString());
  const saved = JSON.parse(await readFile(path.join(userDir("settlements"), "my-chapel.json"), "utf8"));
  assert.equal(saved.id, "my-chapel");
  assert.equal(saved.name, "My chapel");
  assert.deepEqual(saved.rows, (await builtin("settlements", "hamlet-chapel")).rows);
  r = await write(base, "api/templates/settlements/duplicate", { src: "builtin", from: "hamlet-chapel", id: "my-chapel" });
  assert.equal(r.status, 409, "existing user id");
  r = await write(base, "api/templates/settlements/duplicate", { src: "builtin", from: "hamlet-chapel", id: "hamlet-farmstead" });
  assert.equal(r.status, 409, "a built-in id");
  r = await write(base, "api/templates/settlements/duplicate", { src: "builtin", from: "hamlet-chapel", id: "../x" });
  assert.equal(r.status, 400);
  r = await write(base, "api/templates/settlements/duplicate", { src: "user", from: "my-chapel", id: "my-chapel-2", name: "x".repeat(41) });
  assert.equal(r.status, 400);
  r = await write(base, "api/templates/settlements/import", { template: { ...saved, id: "imported" } });
  assert.equal(r.status, 200);
  r = await write(base, "api/templates/settlements/import", { template: { ...saved, id: "imported" } });
  assert.equal(r.status, 409, "import never overwrites");
  const list = (await request(base + "api/templates/settlements")).json();
  assert.ok(list.some((e: { id: string; src: string }) => e.id === "imported" && e.src === "user"));
});

test("a settlement may reference a user building; a user file that shadows a built-in is flagged", async () => {
  const hut = await builtin("buildings", "house-hut");
  assert.equal((await save("buildings", { ...hut, id: "lab-hut", name: "Lab hut" })).status, 200);
  const ham = await builtin("settlements", "hamlet-chapel");
  const r = await save("settlements", { ...ham, id: "uses-user-hut", buildings: ham.buildings.map((b: { ref: string }, i: number) => (i === 0 && b.ref === "house-hut" ? { ...b, ref: "lab-hut" } : b)) });
  assert.equal(r.status, 200, r.body.toString());
  await writeFile(path.join(userDir("camps"), "t1-forest-camp.json"), JSON.stringify(await builtin("camps", "t1-forest-camp")));
  const list = (await request(base + "api/templates/camps")).json();
  assert.ok(list.some((e: { id: string; src: string; shadowed?: boolean }) => e.id === "t1-forest-camp" && e.src === "user" && e.shadowed));
  await rm(path.join(userDir("camps"), "t1-forest-camp.json"));
});

test("size limit and write gate apply to template routes", async () => {
  const big = { id: "big", rows: ["x".repeat(600_000)] };
  const r = await save("camps", big);
  assert.equal(r.status, 413);
  const u = new URL(base);
  const noLab = await request(base + "api/templates/camps/save", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: u.origin } });
  assert.equal(noLab.status, 403);
  const foreign = await request(base + "api/templates/camps/save", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: "http://evil.example", "X-Lab": "1" } });
  assert.equal(foreign.status, 403);
});

test("a symlinked user folder is refused", async () => {
  const outside = path.join(root, "outside");
  await mkdir(outside, { recursive: true });
  await rm(userDir("buildings"), { recursive: true, force: true });
  await symlink(outside, userDir("buildings"));
  const r = await save("buildings", { ...(await builtin("buildings", "house-hut")), id: "via-link" });
  assert.equal(r.status, 403);
  assert.deepEqual(await readdir(outside), []);
  await rm(userDir("buildings"));
  await mkdir(userDir("buildings"));
});

test("round trip: every built-in loads, validates, and saves as a user copy with the same content", async () => {
  const A = await loadArea();
  let n = 0, expected = 0, sameBytes = 0;
  for (const k of TEMPLATE_DIRS) {
    for (const f of (await readdir(path.join(REPO_DIR, "server/data", k))).filter((x) => x.endsWith(".json"))) {
      const id = f.slice(0, -5);
      const got = (await request(base + `api/templates/${k}/builtin/${id}`)).json();
      assert.deepEqual(got.errors, [], `${k}/${id}`);
      const copyId = ("rt-" + id).slice(0, 48);
      const r = await save(k, { ...got.template, id: copyId });
      assert.equal(r.status, 200, `${k}/${id}: ${r.body.toString()}`);
      const out = JSON.parse(await readFile(path.join(userDir(k), copyId + ".json"), "utf8"));
      // same content as the built-in file (only the id differs); the game's normalise may add defaulted flags
      const want = A.normalise(k as "camps", { ...got.template, id: copyId });
      assert.deepEqual(out, want, `${k}/${id}`);
      const orig = await builtin(k, id);
      for (const key of Object.keys(orig)) if (key !== "id") assert.deepEqual((out as unknown as Record<string, unknown>)[key], orig[key], `${k}/${id}.${key}`);
      // byte for byte: the built-in file with only its id line changed, wherever the built-in lists its keys in the
      // order the game's store writes them (some settlement built-ins list spriteBuildings before rotate / mirror;
      // the game's own store, and so the in-game editor and the Lab, write it last: same content, other key order)
      const origText = await readFile(path.join(REPO_DIR, "server/data", k, f), "utf8");
      const sameOrder = Object.keys(orig).join() === Object.keys(out).join();
      if (k !== "settlements") assert.ok(sameOrder, `${k}/${id}: key order`);
      if (sameOrder) {
        assert.equal(await readFile(path.join(userDir(k), copyId + ".json"), "utf8"), origText.replace(`"id": "${id}"`, `"id": "${copyId}"`), `${k}/${id} bytes`);
        sameBytes++;
      }
      n++;
    }
    expected += (await readdir(path.join(REPO_DIR, "server/data", k))).filter((x) => x.endsWith(".json")).length;
  }
  assert.equal(n, expected);
  // every camp and building, and the settlements whose built-in lists the keys in the store's order
  assert.ok(sameBytes >= 99, `${sameBytes} of ${n} byte-identical`);
});
