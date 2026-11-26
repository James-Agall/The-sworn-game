// Area tab, stage B part 2 (the content the game moved to JSON): the sites / POI pools / Castle Ruin stores (built-ins
// read-only, user/ writable, the game validators' reasons, 409s, backups, byte-identical round trips of every
// built-in) and the building interiors' special write path (the nine built-in files only, validation, hall invariant,
// optimistic concurrency, backup, the game's format, diff vs git HEAD), plus the model: grid operations on interior
// layouts, the preview = the game's buildInteriorMap, the art tables read from client/src/interior.ts, the mob kinds.
// Everything runs on scratch copies (LAB_ROOT); the repo is only read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { startLab, type Lab } from "../server/lab.ts";
import { INTERIOR_IDS, isWritable, resolveWritable } from "../server/paths.ts";
import { loadArea } from "../server/game.ts";
import { parseInteriorArt } from "../shared/interiorArt.ts";
import { diffHunks } from "../shared/textdiff.ts";
import * as G from "../shared/grid.ts";
import { DATA_DIRS, INTERIORS_REL, REPO_DIR, request, scratchRoot, write } from "./helpers.ts";

let lab: Lab, root: string, base: string;
const repoText = (rel: string) => readFile(path.join(REPO_DIR, rel), "utf8");
const builtinRel = (k: string, id: string) => `server/data/${k}/${id}.json`;
const save = (k: string, template: unknown, extra: Record<string, unknown> = {}) => write(base, `api/templates/${k}/save`, { template, ...extra });
const interiorRel = (id: string) => `${INTERIORS_REL}/${id}.json`;

before(async () => {
  root = await scratchRoot({ templates: true });
  lab = await startLab({ root, port: 31814, vite: false });
  base = lab.url;
});
after(async () => { await lab.close(); await rm(root, { recursive: true, force: true }); });

test("allow-list: sites / pois / castle-ruins user files; the nine interior files only (no legend, no new names, no traversal)", async () => {
  for (const k of DATA_DIRS) {
    assert.ok(isWritable(["server", "data", k, "user", "my-x.json"]), k);
    assert.equal(isWritable(["server", "data", k, "x.json"]), false, k + " built-in folder");
  }
  for (const id of INTERIOR_IDS) assert.ok(isWritable(["shared", "src", "data", "interiors", id + ".json"]), id);
  for (const segs of [
    ["shared", "src", "data", "interiors", "legend.json"],
    ["shared", "src", "data", "interiors", "mine.json"],
    ["shared", "src", "data", "interiors", "attic.json"],
    ["shared", "src", "data", "interiors", "user", "house.json"],
    ["shared", "src", "data", "interiors", "house.json.bak"],
    ["shared", "src", "data", "interiors", "House.json"],
    ["shared", "src", "interiors.ts"],
    ["shared", "src", "data", "house.json"],
  ]) assert.equal(isWritable(segs), false, segs.join("/"));
  await assert.rejects(resolveWritable(lab.root, `${INTERIORS_REL}/../interiors.ts`), /bad path/);
  await assert.rejects(resolveWritable(lab.root, `${INTERIORS_REL}/legend.json`), /not writable/);
  // the Lab's id list is the game's
  const A = await loadArea();
  assert.deepEqual([...INTERIOR_IDS], [...A.BUILDING_INTERIOR_IDS]);
});

test("lists / reads the stage B kinds; every built-in validates (the game's validators)", async () => {
  const want: Record<string, string[]> = {
    sites: ["grakkar", "hearthmoor", "ironhold", "riverwatch", "thornwick"], pois: ["encampment", "ruin"], "castle-ruins": ["castle-ruin"],
  };
  for (const k of DATA_DIRS) {
    const list = (await request(base + "api/templates/" + k)).json();
    assert.deepEqual(list.filter((e: { src: string }) => e.src === "builtin").map((e: { id: string }) => e.id).sort(), want[k], k);
    for (const e of list) { assert.deepEqual(e.errors, [], `${k}/${e.id}`); assert.ok(e.name, k); }
    const r = (await request(`${base}api/templates/${k}/builtin/${want[k][0]}`)).json();
    assert.deepEqual(r.template, JSON.parse(await repoText(builtinRel(k, want[k][0]))));
    assert.match(r.hash, /^[0-9a-f]{64}$/);
  }
  const sites = (await request(base + "api/templates/sites")).json();
  assert.equal(sites.find((e: { id: string }) => e.id === "grakkar").tier, 4, "sites list their maxTier");
});

test("every built-in site / POI / castle file round-trips byte-identically through the Lab's write path", async () => {
  const A = await loadArea();
  for (const k of DATA_DIRS) {
    for (const f of (await readdir(path.join(REPO_DIR, "server/data", k))).filter((n) => n.endsWith(".json"))) {
      const text = await repoText(`server/data/${k}/${f}`), raw = JSON.parse(text);
      assert.equal(A.formatTemplate(A.normalise(k as never, raw)), text, `${k}/${f}: normalise + format = the file`);
      // through the API as a user copy (a built-in's id is refused): the written bytes are the file with the new id
      const id = "rt-" + raw.id;
      const r = await save(k, { ...raw, id });
      assert.equal(r.status, 200, `${k}/${f}: ${r.body}`);
      assert.equal(await readFile(path.join(root, `server/data/${k}/user/${id}.json`), "utf8"), text.replace(`"id": "${raw.id}"`, `"id": "${id}"`), `${k}/${f}`);
    }
  }
});

test("built-ins of sites / pois / castle are never writable; invalid files are refused with the validator's reasons; 409 on change", async () => {
  for (const [k, id] of [["sites", "thornwick"], ["pois", "ruin"], ["castle-ruins", "castle-ruin"]]) {
    const raw = JSON.parse(await repoText(builtinRel(k, id)));
    const before = await readFile(path.join(root, builtinRel(k, id)));
    const r = await save(k, raw, { overwrite: true });
    assert.equal(r.status, 409, k); assert.match(r.json().error, /built-in/);
    assert.equal((await write(base, `api/templates/${k}/delete`, { id })).status, 409);
    assert.deepEqual(await readFile(path.join(root, builtinRel(k, id))), before);
  }
  // invalid: the game's own messages come back
  const site = JSON.parse(await repoText(builtinRel("sites", "thornwick")));
  let r = await save("sites", { ...site, id: "bad-site", rows: site.rows.map((x: string) => x.replace("K", ".")), garrison: { dragon: 2 } });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /exactly one keep K \(has 0\)/);
  assert.match(r.json().error, /garrison: unknown "dragon"/);
  const poi = JSON.parse(await repoText(builtinRel("pois", "ruin")));
  r = await save("pois", { ...poi, id: "bad-poi", extraCount: [3, 9], centerpieces: ["NoSuchTile"] });
  assert.equal(r.status, 400);
  assert.match(r.json().error, /extraCount/); assert.match(r.json().error, /unknown tile "NoSuchTile"/);
  const castle = JSON.parse(await repoText(builtinRel("castle-ruins", "castle-ruin")));
  const offCentre = castle.rows.map((row: string, y: number) => (y === 4 ? row.replace("B", ".") : y === 1 ? "2B......2" : row));
  r = await save("castle-ruins", { ...castle, id: "bad-castle", rows: offCentre });
  assert.equal(r.status, 400); assert.match(r.json().error, /must be at the centre/);
  r = await save("castle-ruins", { ...castle, id: "bad-castle", rows: castle.rows.slice(0, 8).map((x: string) => x.slice(0, 8)) });
  assert.equal(r.status, 400); assert.match(r.json().error, /square and odd/);
  // user file: overwrite with a stale hash = 409; with the right one = a backup of the old file
  const mine = { ...castle, id: "my-castle", guardians: [4, 6] };
  r = await save("castle-ruins", mine);
  assert.equal(r.status, 200);
  const h1 = r.json().hash;
  assert.equal((await save("castle-ruins", mine)).status, 409, "exists: needs overwrite");
  await writeFile(path.join(root, "server/data/castle-ruins/user/my-castle.json"), JSON.stringify(mine, null, 2) + "\n ");
  r = await save("castle-ruins", { ...mine, guardians: [5, 7] }, { overwrite: true, baseHash: h1 });
  assert.equal(r.status, 409); assert.match(r.json().error, /changed on disk/);
  const now = (await request(`${base}api/templates/castle-ruins/user/my-castle`)).json();
  r = await save("castle-ruins", { ...mine, guardians: [5, 7] }, { overwrite: true, baseHash: now.hash });
  assert.equal(r.status, 200);
  const bk = r.json().backup;
  assert.ok(bk, "backup made");
  assert.equal(await readFile(path.join(root, bk, "server/data/castle-ruins/user/my-castle.json"), "utf8"), JSON.stringify(mine, null, 2) + "\n ");
  // delete a user file (backed up), never a built-in
  r = await write(base, "api/templates/castle-ruins/delete", { id: "my-castle" });
  assert.equal(r.status, 200);
});

test("interiors API: list + read (all nine valid); refusals (unknown id, legend, id mismatch, no baseHash, invalid, hall invariant)", async () => {
  const list = (await request(base + "api/interiors")).json();
  assert.deepEqual(list.map((e: { id: string }) => e.id), [...INTERIOR_IDS]);
  for (const e of list) { assert.deepEqual(e.errors, [], e.id); assert.equal(e.variants, 3); }
  assert.deepEqual(list.filter((e: { upper: boolean }) => e.upper).map((e: { id: string }) => e.id), ["tavern", "barracks", "hall"]);
  const hall = (await request(base + "api/interiors/hall")).json();
  assert.deepEqual(hall.file, JSON.parse(await repoText(interiorRel("hall"))));
  for (const p of ["legend", "mine", "attic", "Hall"]) assert.equal((await request(base + "api/interiors/" + p)).status, 404, p);
  const before = await readFile(path.join(root, interiorRel("hall")));
  const post = (id: string, body: unknown) => write(base, `api/interiors/${id}/save`, body);
  assert.equal((await post("legend", { file: hall.file, baseHash: hall.hash })).status, 404);
  assert.equal((await post("tavern", { file: hall.file, baseHash: hall.hash })).status, 400, "id must name the file");
  assert.equal((await post("hall", { file: hall.file })).status, 400, "baseHash required");
  // hall invariant: required must keep throne / table / chest, and every layout must contain them
  let r = await post("hall", { file: { ...hall.file, required: ["throne", "table"] }, baseHash: hall.hash });
  assert.equal(r.status, 400); assert.match(r.json().error, /hall: required must keep "chest"/);
  const noChest = { ...hall.file, variants: hall.file.variants.map((l: { rows: string[] }, i: number) => (i === 1 ? { ...l, rows: l.rows.map((x) => x.replace(/c/g, ".")) } : l)) };
  r = await post("hall", { file: noChest, baseHash: hall.hash });
  assert.equal(r.status, 400); assert.match(r.json().error, /hall: no chest \(its room role needs one\) \(variant 1\)/);
  r = await post("hall", { file: { ...hall.file, variants: hall.file.variants.slice(0, 2) }, baseHash: hall.hash });
  assert.equal(r.status, 400); assert.match(r.json().error, /2 variants, wants 3/);
  assert.deepEqual(await readFile(path.join(root, interiorRel("hall"))), before, "refusals never write");
});

test("interiors save: unchanged = same bytes, an edit writes the game's format with a backup, stale hash = 409, missing file = 404", async () => {
  const A = await loadArea();
  const post = (id: string, body: unknown) => write(base, `api/interiors/${id}/save`, body);
  // every file: saving it unchanged keeps the exact bytes (normalise + the files' format)
  for (const id of INTERIOR_IDS) {
    const r0 = (await request(base + "api/interiors/" + id)).json();
    const text = await repoText(interiorRel(id));
    assert.equal(JSON.stringify(A.normaliseInteriorFile(r0.file), null, 2) + "\n", text, id + ": the game's format");
    const r = await post(id, { file: r0.file, baseHash: r0.hash });
    assert.equal(r.status, 200, id + ": " + r.body);
    assert.equal(r.json().changed, false);
    assert.equal(await readFile(path.join(root, interiorRel(id)), "utf8"), text, id);
  }
  // an edit: swap the house's variants 0 and 1 (valid), plus a note field the normaliser drops
  const h = (await request(base + "api/interiors/house")).json();
  const old = await readFile(path.join(root, interiorRel("house")), "utf8");
  const edited = { ...h.file, note: "dropped", variants: [h.file.variants[1], h.file.variants[0], h.file.variants[2]] };
  let r = await post("house", { file: edited, baseHash: h.hash });
  assert.equal(r.status, 200, String(r.body));
  const j = r.json();
  assert.equal(j.changed, true);
  const now = await readFile(path.join(root, interiorRel("house")), "utf8");
  assert.equal(now, JSON.stringify(A.normaliseInteriorFile(edited), null, 2) + "\n");
  assert.ok(!now.includes("dropped"));
  assert.equal(await readFile(path.join(root, j.backup, interiorRel("house")), "utf8"), old, "backup = the old file");
  // stale: the file changed on disk after the read
  r = await post("house", { file: h.file, baseHash: h.hash });
  assert.equal(r.status, 409); assert.match(r.json().error, /changed on disk/);
  assert.equal(await readFile(path.join(root, interiorRel("house")), "utf8"), now);
  // the Lab never creates an interior file
  const b = (await request(base + "api/interiors/barn")).json();
  await unlink(path.join(root, interiorRel("barn")));
  r = await post("barn", { file: b.file, baseHash: b.hash });
  assert.equal(r.status, 404);
  assert.ok(!(await readdir(path.join(root, INTERIORS_REL))).includes("barn.json"));
  await writeFile(path.join(root, interiorRel("barn")), await repoText(interiorRel("barn")));
});

test("interiors diff vs git HEAD: the committed text (git show) and a line diff of the change", async () => {
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe", env: { PATH: process.env.PATH || "", HOME: root, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  let r = (await request(base + "api/interiors/church/head")).json();
  assert.equal(r.head, null, "no git repo in the scratch root yet");
  git("init", "-q"); git("add", INTERIORS_REL); git("commit", "-q", "-m", "base");
  r = (await request(base + "api/interiors/church/head")).json();
  const committed = await readFile(path.join(root, interiorRel("church")), "utf8");
  assert.equal(r.head, committed);
  assert.equal(diffHunks(r.head, committed), null);
  const c = (await request(base + "api/interiors/church")).json();
  const f = { ...c.file, variants: c.file.variants.map((l: { label: string }, i: number) => (i === 2 ? { ...l, label: "Chapel (Lab)" } : l)) };
  assert.equal((await write(base, "api/interiors/church/save", { file: f, baseHash: c.hash })).status, 200);
  const hunks = diffHunks(r.head, await readFile(path.join(root, interiorRel("church")), "utf8"))!;
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0].filter((l) => l.op !== " ").map((l) => l.op + l.text.trim()), ['-"label": "' + c.file.variants[2].label + '",', '+"label": "Chapel (Lab)",']);
  assert.equal((await request(base + "api/interiors/legend/head")).status, 404);
});

test("interior grid operations touch one layout only; E / D move (exactly one); the hall invariant per layout", async () => {
  const A = await loadArea();
  const f = JSON.parse(await repoText(interiorRel("tavern")));
  assert.deepEqual(A.layersOf("interiors", f), ["v0", "v1", "v2", "upper"]);
  const v1 = A.gridOf("interiors", f, "v1");
  // paint a bed on a floor cell of variant 1
  const spot = G.findAll(v1, ".")[0];
  const g = A.withGrid("interiors", f, "v1", G.paint(v1, [spot], "b")) as typeof f;
  assert.equal(A.gridOf("interiors", g, "v1")[spot.y][spot.x], "b");
  for (const l of ["v0", "v2", "upper"]) assert.deepEqual(A.gridOf("interiors", g, l), A.gridOf("interiors", f, l), l + " untouched");
  assert.deepEqual(f.variants[1].rows, v1, "the input is not mutated");
  // the exit mat is unique on a ground floor, the stairs down upstairs
  assert.equal(A.uniqueSymbol("interiors", "v0"), "E"); assert.equal(A.uniqueSymbol("interiors", "upper"), "D");
  const e = G.findAll(v1, "E")[0];
  const moved = G.placeUnique(v1, "E", e.x - 1, e.y).rows;
  assert.equal(G.findAll(moved, "E").length, 1);
  // mirroring a layout with the game's transformRows keeps it valid (the tavern's layouts are mirror-safe)
  const mir = A.withGrid("interiors", f, "v0", A.transformRows(A.gridOf("interiors", f, "v0"), 4)) as typeof f;
  assert.deepEqual(A.interiorLayoutErrors(mir, "v0"), []);
  // per-layout errors name cells the editor can jump to
  const broken = A.withGrid("interiors", f, "v2", G.paint(A.gridOf("interiors", f, "v2"), [{ x: 0, y: 1 }], ".")) as typeof f;
  const errs = A.interiorLayoutErrors(broken, "v2");
  assert.ok(errs.some((m) => /open outline at 0,1/.test(m)), errs.join("; "));
  assert.deepEqual(A.errorCell(errs.find((m) => /open outline/.test(m))!), { x: 0, y: 1 });
  assert.deepEqual(A.errorCell("tavern: tile 3,4 cannot be reached"), { x: 3, y: 4 });
  // hall: every layout must keep throne / table / chest
  const hall = JSON.parse(await repoText(interiorRel("hall")));
  for (const [sym, prop] of [["T", "throne"], ["t", "table"], ["c", "chest"]]) {
    const leg = A.INTERIOR_LEGEND[sym];
    assert.equal(leg.prop, prop, `legend ${sym}`);
    for (const l of ["v0", "v1", "v2"]) {
      const rows = A.gridOf("interiors", hall, l).map((x: string) => x.split(sym).join("."));
      const errs2 = A.interiorLayoutErrors(A.withGrid("interiors", hall, l, rows) as typeof hall, l);
      assert.ok(errs2.some((m) => m.includes(`no ${prop}`)), `hall ${l} without ${prop}: ${errs2.join("; ")}`);
    }
  }
  assert.deepEqual(A.validateInteriorFile(hall), []);
  assert.ok(A.validateInteriorFile({ ...hall, required: ["table", "chest"] }).some((m) => /must keep "throne"/.test(m)));
});

test("interior preview = the game's buildInteriorMap for every file, layout and level; edited layouts preview, tables restored", async () => {
  const A = await loadArea();
  for (const id of INTERIOR_IDS) {
    const f = JSON.parse(await repoText(interiorRel(id)));
    for (const layer of A.layersOf("interiors", f)) for (const level of [1, 2, 3]) {
      const want = layer === "upper" ? A.buildInteriorMap(id, level, 0, 1) : A.buildInteriorMap(id, level, Number(layer.slice(1)), 0);
      assert.deepEqual(A.interiorPreviewMap(f, layer, level), want, `${id} ${layer} level ${level}`);
    }
  }
  // an edited (unsaved) layout is what the preview builds; the game's loaded tables are untouched afterwards
  const f = JSON.parse(await repoText(interiorRel("smithy")));
  const before = A.buildInteriorMap("smithy", 2, 1, 0);
  const rows = f.variants[1].rows.slice();
  const spot = G.findAll(rows, ".")[3];
  const g = A.withGrid("interiors", f, "v1", G.paint(rows, [spot], "b")) as typeof f;
  const p = A.interiorPreviewMap(g, "v1", 2);
  assert.ok(p.props.some((q: { prop: string; x: number; y: number }) => q.prop === "bed" && q.x === spot.x && q.y === spot.y));
  assert.deepEqual(A.buildInteriorMap("smithy", 2, 1, 0), before, "the loaded tables are restored");
  // level-gated beds: "q" is a bed from level 2
  const house = JSON.parse(await repoText(interiorRel("house")));
  const lay = A.layersOf("interiors", house).find((l: string) => A.gridOf("interiors", house, l).some((r: string) => r.includes("q")))!;
  const beds = (lv: number) => A.interiorPreviewMap(house, lay, lv).props.filter((q: { prop: string }) => q.prop === "bed").length;
  assert.ok(beds(2) > beds(1), "q beds appear at level 2");
});

test("the art tables are read from client/src/interior.ts (fails if its text drifts); the mob kinds are the server's", async () => {
  const t = parseInteriorArt(await repoText("client/src/interior.ts"));
  assert.deepEqual(t.errors, []);
  assert.equal(t.propTile.bed, "Bed");
  assert.equal(t.propExtra.throne, "throne");
  assert.ok(t.oriented.includes("chest") && t.rugUrl && t.floorColor.stone && t.wall.wood.face);
  const A = await loadArea();
  for (const [prop, tile] of Object.entries(t.propTile)) assert.equal(typeof A.tileByName(tile), "number", `${prop} -> TileType.${tile}`);
  for (const p of A.INTERIOR_PROPS) if (!["stairsUp", "stairsDown", "oreFace", "timberProp"].includes(p)) {
    assert.ok(t.propTile[p] || t.propExtra[p] || t.propColor[p] !== undefined || t.oriented.includes(p), `prop ${p} has art or a stand-in colour`);
  }
});
