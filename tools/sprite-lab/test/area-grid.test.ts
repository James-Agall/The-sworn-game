// Area tab model: grid painting operations, flip / rotate vs the game's transformRows, the hearth / keep single-anchor
// rules against the game's validators, settlement building placement / collision vs the game's settlementLayout, the
// shared-code stamp preview vs the game's campCells / settlementLayout / transformPoint, error-cell parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as G from "../shared/grid.ts";
import { loadArea } from "../server/game.ts";
import { REPO_DIR } from "./helpers.ts";

const A = await loadArea();
const builtin = async (k: string, id: string) => JSON.parse(await readFile(path.join(REPO_DIR, "server/data", k, id + ".json"), "utf8"));
const allBuildings = async () => Promise.all((await readdir(path.join(REPO_DIR, "server/data/buildings"))).filter((f) => f.endsWith(".json")).map((f) => builtin("buildings", f.slice(0, -5))));
const lookup = A.makeLookup(await allBuildings(), []);

test("pencil / line / rect / flood fill", () => {
  const g = G.blankRows(6, 4);
  assert.deepEqual(G.paint(g, [{ x: 1, y: 1 }, { x: 9, y: 9 }], "#"), ["......", ".#....", "......", "......"]);
  assert.deepEqual(G.lineCells(0, 0, 3, 1), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 1 }]);
  assert.deepEqual(G.lineCells(2, 2, 2, 0).map((c) => c.y), [2, 1, 0]);
  assert.deepEqual(G.paint(g, G.rectCells(4, 3, 1, 0, false), "#"), [".####.", ".#..#.", ".#..#.", ".####."]);
  assert.equal(G.rectCells(0, 0, 2, 2, true).length, 9);
  const walled = G.paint(g, G.rectCells(1, 0, 4, 3, false), "#");
  assert.deepEqual(G.floodFill(walled, 2, 1, "="), [".####.", ".#==#.", ".#==#.", ".####."]);
  assert.deepEqual(G.floodFill(walled, 0, 0, "_"), ["_####.", "_#..#.", "_#..#.", "_####."], "4-way only, walls stop it");
  assert.deepEqual(G.floodFill(walled, 1, 0, "#"), walled, "same symbol: no change");
});

test("mirror painting reflects across the grid centre", () => {
  const cells = G.mirrorCells([{ x: 0, y: 1 }], 5, 4, true, true);
  assert.deepEqual(cells, [{ x: 0, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 2 }, { x: 4, y: 2 }]);
  assert.equal(G.mirrorCells([{ x: 2, y: 0 }], 5, 4, true, false).length, 1, "the centre column maps onto itself");
});

test("select / copy / cut / paste / move", () => {
  const g = ["abc.", "def.", "...."];
  const r = { x: 0, y: 0, w: 2, h: 2 };
  assert.deepEqual(G.extract(g, r), ["ab", "de"]);
  assert.deepEqual(G.fillRect(g, r, "."), ["..c.", "..f.", "...."]);
  assert.deepEqual(G.pasteBlock(g, ["xy"], 3, 2), ["abc.", "def.", "...x"], "clipped at the edge");
  assert.deepEqual(G.pasteBlock(g, [".z"], 0, 0, "."), ["azc.", "def.", "...."], "transparent symbol");
  assert.deepEqual(G.moveRect(g, r, 1, 1, "."), ["..c.", ".ab.", ".de."]);
  assert.deepEqual(G.moveRect(g, r, 0, 0, "."), g);
});

test("flip / rotate match the game's transformRows (all 8 transforms, non-square)", () => {
  const g = ["abc", "def"];
  const lab = (tf: number) => {
    let out = tf & 4 ? G.flipH(g) : g.slice();
    for (let k = 0; k < (tf & 3); k++) out = G.rotateCW(out);
    return out;
  };
  for (let tf = 0; tf < 8; tf++) assert.deepEqual(lab(tf), A.transformRows(g, tf), `transform ${tf}`);
  assert.deepEqual(G.flipV(g), A.transformRows(g, 6), "vertical flip = mirror + half turn");
});

test("whole-template rotate / mirror of real camps keeps them valid (game's transformRows + validator)", async () => {
  for (const id of ["t3-iron-keep", "t2-bridge-toll", "t1-captive-pen"]) {
    const t = await builtin("camps", id);
    for (let tf = 1; tf < 8; tf++) {
      const rows = A.transformRows(t.rows, tf);
      assert.deepEqual(A.validateCampTemplate({ ...t, rows }), [], `${id}/${tf}`);
      assert.equal(A.campCells({ rows }).length, A.campCells(t).length);
    }
  }
});

test("resize with anchors; offsets let placed buildings follow", () => {
  const g = ["ab", "cd"];
  assert.deepEqual(G.resize(g, 4, 3, { ax: 0, ay: 0 }), { rows: ["ab..", "cd..", "...."], dx: 0, dy: 0 });
  assert.deepEqual(G.resize(g, 4, 4, { ax: 1, ay: 1 }), { rows: ["....", ".ab.", ".cd.", "...."], dx: 1, dy: 1 });
  assert.deepEqual(G.resize(g, 3, 2, { ax: 2, ay: 2 }), { rows: [".ab", ".cd"], dx: 1, dy: 0 });
  assert.deepEqual(G.resize(g, 1, 1, { ax: 2, ay: 2 }), { rows: ["d"], dx: -1, dy: -1 }, "crop keeps the anchored corner");
});

test("camp hearth rule: painting H moves it (exactly one, the game's validator agrees)", async () => {
  const t = await builtin("camps", "t1-forest-camp");
  const h0 = G.findAll(t.rows, "H")[0];
  const twice = G.paint(t.rows, [{ x: 1, y: 1 }], "H");
  assert.match(A.validateCampTemplate({ ...t, rows: twice }).join(), /exactly one hearth H \(has 2\)/);
  const { rows, moved } = G.placeUnique(t.rows, "H", h0.x + 1, h0.y);
  assert.deepEqual(moved, [h0]);
  assert.equal(G.findAll(rows, "H").length, 1);
  assert.match(A.validateCampTemplate({ ...t, rows: G.paint(t.rows, [h0], ".") }).join(), /has 0/);
});

test("settlement keep rule: one K (or a keep building's anchor), the game's validator agrees", async () => {
  const t = await builtin("settlements", "village-green");
  const k = G.findAll(t.rows, "K");
  assert.equal(k.length, 1);
  const free = G.findAll(t.rows, ".").find((c) => A.placements({ ...t, rows: G.paint(t.rows, [c], "K") }, lookup).every((p) => p.ok));
  assert.ok(free);
  const two = G.paint(t.rows, [free!], "K");
  assert.ok(A.validateSettlementTemplate({ ...t, rows: two }, lookup).some((e) => /exactly one keep/.test(e)));
  const moved = G.placeUnique(t.rows, "K", free!.x, free!.y);
  assert.equal(G.findAll(moved.rows, "K").length, 1);
  assert.ok(!A.validateSettlementTemplate({ ...t, rows: moved.rows }, lookup).some((e) => /exactly one keep/.test(e)));
  const citadel = await builtin("settlements", "town-citadel");
  assert.equal(G.findAll(citadel.rows, "K").length, 0, "its keep is a keep building's anchor");
  assert.ok(A.settlementLayout(citadel, lookup).keepInBuilding);
});

test("building placement / collision agrees with the game's settlementLayout", async () => {
  for (const id of ["hamlet-chapel", "village-street", "town-citadel"]) {
    const t = await builtin("settlements", id);
    assert.ok(A.placements(t, lookup).every((p) => p.ok), `${id}: every built-in placement ok`);
    const b0 = t.buildings[0];
    // move building 0 onto building 1: the Lab flags both cells, the game reports an overlap
    const onTop = { ...t, buildings: [b0, { ...t.buildings[1], x: b0.x, y: b0.y }, ...t.buildings.slice(2)] };
    const p = A.placements(onTop, lookup);
    assert.equal(p[1].ok, false);
    assert.ok(p[1].bad.length > 0);
    assert.ok(A.settlementLayout(onTop, lookup).errs.some((e) => /overlaps/.test(e)), id);
    const off = { ...t, buildings: [{ ...b0, x: t.rows[0].length - 1 }, ...t.buildings.slice(1)] };
    assert.equal(A.placements(off, lookup)[0].ok, false);
    assert.ok(A.settlementLayout(off, lookup).errs.some((e) => /off the grid/.test(e)), id);
    const road = G.findAll(t.rows, "_")[0] ?? G.findAll(t.rows, "=")[0];
    const onRoad = { ...t, buildings: [{ ...b0, x: road.x, y: road.y }, ...t.buildings.slice(1)] };
    const pr = A.placements(onRoad, lookup)[0];
    const lay = A.settlementLayout(onRoad, lookup).errs;
    assert.equal(pr.ok, !lay.some((e) => /^building 1 /.test(e)), `${id}: Lab verdict = game verdict for building 1 on a road`);
  }
  const t = await builtin("settlements", "village-street");
  const unknown = A.placements({ ...t, buildings: [{ ref: "nope", x: 0, y: 0 }] }, lookup);
  assert.equal(unknown[0].unknown, true);
});

test("a placed building's own transform: footprint follows buildingCells; flags are the template's", async () => {
  const bt = lookup("house-cottage")!;
  for (const tf of A.buildingTransforms(bt)) {
    const fp = A.refFootprint(bt, tf, false), c = A.buildingCells(bt, tf);
    assert.deepEqual(fp, { w: c.w, h: c.h });
  }
  assert.deepEqual(A.refFootprint(bt, 1, true), { w: 3, h: 3 }, "spriteBuildings: the 3x3 prefab");
  const fixed = (await allBuildings()).find((b) => !b.rotate);
  if (fixed) assert.ok(A.buildingTransforms(fixed).every((k) => (k & 3) === 0));
});

test("stamp preview (shared code) = campCells around the hearth, for every allowed transform", async () => {
  for (const f of (await readdir(path.join(REPO_DIR, "server/data/camps"))).filter((x) => x.endsWith(".json"))) {
    const t = await builtin("camps", f.slice(0, -5));
    for (const tf of A.campTransforms(t)) {
      const p = A.campPreview(t, tf), r = A.campRadius(t);
      assert.deepEqual(p.hearth, { x: r, y: r });
      const cells = A.campCells(t, tf);
      assert.equal(p.cells.filter((c) => c.ch !== ".").length, cells.length);
      for (const c of cells) assert.equal(p.cells[(c.dy + r) * p.w + c.dx + r].ch, c.ch);
      assert.equal(p.entrance, A.transformEntrance(t.entrance, tf));
    }
  }
});

test("stamp preview (shared code) = settlementLayout of the transformed template; tiles follow transformPoint", async () => {
  for (const id of ["hamlet-riverside", "village-mill", "town-moat"]) {
    const t = await builtin("settlements", id);
    const base = A.settlementPreview(t, 0, lookup);
    for (const tf of A.settlementTransforms(t, lookup)) {
      const p = A.settlementPreview(t, tf, lookup), l = A.settlementLayout(A.transformSettlement(t, tf, lookup), lookup);
      assert.deepEqual(l.errs, []);
      const a = p.apron;
      for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) assert.equal(p.cells[(y + a) * p.w + x + a].tile, l.tiles[y * l.w + x]);
      assert.equal(p.footprints.length, t.buildings.length);
      assert.equal(p.slots.length, base.slots.length);
      assert.equal(p.beds.length, base.beds.length);
    }
  }
  assert.equal(A.settlementApron("town-x-district"), 0);
  assert.equal(A.settlementApron("hamlet-chapel"), 2);
});

test("error messages name cells / buildings the editor can jump to", async () => {
  const t = await builtin("buildings", "house-cottage");
  const errs = A.validateBuildingTemplate({ ...t, rows: G.paint(t.rows, [{ x: 0, y: 0 }], "F") });
  const withCell = errs.map(A.errorCell).filter(Boolean);
  assert.ok(withCell.length > 0, errs.join(" | "));
  assert.deepEqual(A.errorCell("unknown symbol \"?\" at 3,4"), { x: 3, y: 4 });
  assert.equal(A.errorCell("exactly one hearth H (has 2)"), null);
  assert.equal(A.errorBuilding("building 3 (house-hut) overlaps building 1 at 4,5"), 2);
});

test("new templates (the in-game editors' defaults) and every built-in are valid; normalise keeps the game's fields", async () => {
  assert.ok(A.validateCampTemplate(A.newTemplate("camps")).every((e) => /guard/.test(e)), "a blank camp only lacks guard slots");
  assert.deepEqual(A.validateBuildingTemplate(A.newTemplate("buildings")).filter((e) => !/door|room/.test(e)), []);
  const n = A.normalise("settlements", { ...(A.newTemplate("settlements") as object), builtin: true } as never) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(n), ["id", "name", "tier", "weight", "minStartDist", "profile", "garrison", "rows", "buildings", "rotate", "mirror", "spriteBuildings"]);
});
