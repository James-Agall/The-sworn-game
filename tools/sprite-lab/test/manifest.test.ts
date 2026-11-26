// Manifest writer: untouched manifests come back byte-for-byte, a one-part edit changes only that entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { writeManifestText, checkManifestShape, detectIndent, type Manifest } from "../shared/manifest.ts";
import { PUBLIC } from "./helpers.ts";

const PARTS = path.join(PUBLIC, "rig", "parts");
const sets = (await readdir(PARTS)).filter((s) => !s.startsWith(".")).sort();

test("all real sets are present", () => {
  for (const s of ["bodyset", "grounded-v2", "painted-v1", "placeholder", "sliced-demo"]) assert.ok(sets.includes(s), s);
});

for (const set of sets) {
  const text = await readFile(path.join(PARTS, set, "manifest.json"), "utf8").catch(() => null);
  if (text == null) continue;

  test(`${set}: untouched manifest round-trips byte-for-byte`, () => {
    assert.equal(writeManifestText(text, JSON.parse(text)), text);
    assert.equal(checkManifestShape(JSON.parse(text)), null);
  });

  test(`${set}: a one-part edit changes only that entry`, () => {
    const m = JSON.parse(text) as Manifest, names = Object.keys(m.parts), target = names[Math.floor(names.length / 2)];
    m.parts[target] = { ...m.parts[target], pivot: [m.parts[target].pivot[0] + 1, m.parts[target].pivot[1]] };
    const out = writeManifestText(text, m);
    assert.deepEqual(JSON.parse(out), m);
    // every other entry is copied verbatim: removing the edited entry from both texts leaves identical texts
    const strip = (t: string) => {
      const start = t.indexOf(JSON.stringify(target) + ":"), next = names[names.indexOf(target) + 1];
      const end = next ? t.indexOf(JSON.stringify(next) + ":", start) : t.lastIndexOf("}", t.lastIndexOf("}") - 1);
      return t.slice(0, start) + t.slice(end);
    };
    assert.equal(strip(out), strip(text));
    assert.equal(detectIndent(out), detectIndent(text));
  });

  test(`${set}: add and delete parts, top-level keys kept`, () => {
    const m = JSON.parse(text) as Manifest, first = Object.keys(m.parts)[0];
    delete m.parts[first];
    m.parts["newPart.lab"] = { file: "newPart.lab.png", pivot: [16, 32], len: 0, joint: "", size: [32, 32], scale: 1, variant: "lab" };
    const out = writeManifestText(text, m);
    assert.deepEqual(JSON.parse(out), m);
    const back = JSON.parse(out) as Manifest;
    for (const k of Object.keys(JSON.parse(text))) if (k !== "parts") assert.ok(k in back, k);
    // untouched entries still appear verbatim
    const other = Object.keys(m.parts)[1], orig = JSON.parse(text) as Manifest;
    const entryText = JSON.stringify(orig.parts[other], null, detectIndent(text));
    const firstLine = entryText.split("\n")[1];
    assert.ok(out.includes(firstLine));
  });
}

test("a new manifest is written like the slicer writes it", () => {
  const m: Manifest = { set: "x", parts: { a: { file: "a.png", pivot: [1, 2] } } };
  assert.equal(writeManifestText(null, m), JSON.stringify(m, null, 1));
});

test("checkManifestShape refuses odd input", () => {
  assert.ok(checkManifestShape(null));
  assert.ok(checkManifestShape({ parts: [] }));
  assert.ok(checkManifestShape({ parts: { a: { file: 1, pivot: [0, 0] } } }));
  assert.ok(checkManifestShape({ parts: { a: { file: "a.png", pivot: [0] } } }));
  assert.ok(checkManifestShape({ parts: { a: { file: "a.png", pivot: [0, 0], size: [0, 5] } } }));
  assert.ok(checkManifestShape({ parts: { a: { file: "a.png", pivot: [0, 0], len: "3" } } }));
  assert.equal(checkManifestShape({ parts: { a: { file: "a.png", pivot: [0, 0], extra: { kept: true } } } }), null);
});
