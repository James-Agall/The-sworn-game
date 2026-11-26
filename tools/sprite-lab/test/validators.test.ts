// Validators v1 on a good synthetic set, on deliberately bad fixtures, on the real grounded-v2 set and through the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSet, type Img, type SetInput } from "../shared/validators.ts";
import { extractHeroPalette } from "../server/palette.ts";
import { recolour } from "../shared/recolour.ts";
import { encodePNG } from "../server/png.ts";
import { REPO_DIR, scratchRoot } from "./helpers.ts";

/** A painted-looking blob: varied colours inside, a dark #191414-ish ring, a transparent border. */
function blob(w: number, h: number, opts: { rim?: number[]; flat?: boolean; specks?: number; edge?: boolean } = {}): Img {
  const data = new Uint8Array(w * h * 4), cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2 - (opts.edge ? 0 : 1.5), ry = h / 2 - (opts.edge ? 0 : 1.5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2, i = (y * w + x) * 4;
    if (d > 1) continue;
    const ring = d > 0.6;
    const c = ring ? (opts.rim || [25, 20, 20]) : opts.flat ? [150, 110, 80] : [100 + ((x * 37 + y * 11) % 120), 70 + ((x * 13 + y * 29) % 90), 40 + ((x * 7 + y * 17) % 70)];
    data.set([...c, 255], i);
  }
  for (let k = 0; k < (opts.specks || 0); k++) data.set([200, 200, 200, 40], (0 * w + k * 2) * 4);
  return { w, h, data };
}
function goodSet(): SetInput {
  const images: Record<string, Img> = { "upperArm.png": blob(16, 26), "head.png": blob(20, 22), "hair.png": blob(18, 14) };
  return {
    set: "good", files: [...Object.keys(images), "manifest.json"], images,
    manifest: { set: "good", parts: {
      upperArm: { file: "upperArm.png", pivot: [8, 5], len: 13, joint: "shoulder", size: [16, 26], scale: 0.13, variant: "" },
      head: { file: "head.png", pivot: [10, 21], len: 0, joint: "neck", size: [20, 22], scale: 0.12 },
      hair: { file: "hair.png", pivot: [9, 24], len: 0, joint: "neck (overlay)", size: [18, 14], scale: 0.12 },
    } },
  };
}
const level = (r: ReturnType<typeof validateSet>, id: string) => r.checks.find((c) => c.id === id)!.level;

test("a good set passes every check", () => {
  const r = validateSet(goodSet());
  assert.equal(r.level, "pass", JSON.stringify(r.checks.filter((c) => c.level !== "pass")));
  assert.equal(r.checks.length, 8);
});

test("bad fixtures fail or warn on the right check", () => {
  let s = goodSet(); s.files = s.files.filter((f) => f !== "head.png");
  assert.equal(level(validateSet(s), "entries"), "fail");
  s = goodSet(); s.files.push("orphan.png");
  assert.equal(level(validateSet(s), "entries"), "warn");
  s = goodSet(); s.images["head.png"] = "bad CRC";
  assert.equal(level(validateSet(s), "entries"), "fail");
  s = goodSet(); s.manifest.parts.upperArm.pivot = [30, 5];
  assert.equal(level(validateSet(s), "pivot"), "fail");
  s = goodSet(); s.manifest.parts.upperArm.size = [17, 26];
  assert.equal(level(validateSet(s), "size"), "fail");
  s = goodSet(); s.manifest.parts.upperArm.scale = -1;
  assert.equal(level(validateSet(s), "size"), "fail");
  s = goodSet(); s.images["head.png"] = blob(20, 22, { rim: [230, 220, 200] });
  assert.equal(level(validateSet(s), "rim"), "fail");
  s = goodSet(); s.images["head.png"] = blob(20, 22, { rim: [110, 100, 90] });
  assert.equal(level(validateSet(s), "rim"), "warn");
  s = goodSet(); s.images["head.png"] = blob(20, 22, { edge: true });
  assert.equal(level(validateSet(s), "border"), "warn");
  s = goodSet(); s.images["upperArm.png"] = blob(16, 26, { specks: 3 });
  assert.equal(level(validateSet(s), "specks"), "warn");
  s = goodSet(); s.images["upperArm.png"] = blob(16, 26, { flat: true });
  assert.equal(level(validateSet(s), "palette"), "warn");
  s = goodSet(); s.manifest.parts["bad name!"] = { ...s.manifest.parts.head };
  assert.equal(level(validateSet(s), "names"), "fail");
  s = goodSet(); s.manifest.parts.head.file = "../head.png";
  assert.equal(level(validateSet(s), "names"), "fail");
  s = goodSet(); s.manifest.set = "other";
  assert.equal(level(validateSet(s), "names"), "warn");
  s = goodSet(); s.manifest.parts.hair.pivot = [9, 200];
  assert.equal(level(validateSet(s), "pivot"), "warn", "an overlay anchor far away is suspicious");
});

const cli = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
  execFile(process.execPath, [path.join(REPO_DIR, "tools/sprite-lab/cli/validate.ts"), ...args], (err, stdout, stderr) => resolve({ code: err ? (err as { code: number }).code : 0, out: stdout + stderr }));
});

test("CLI: grounded-v2 (real repo, read-only) has no failures; a broken scratch set exits 1", async () => {
  const ok = await cli(["grounded-v2"]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /set grounded-v2: (PASS|WARN)/);
  const root = await scratchRoot();
  try {
    const dir = path.join(root, "client/public/rig/parts/broken");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "a.png"), encodePNG(blob(10, 10)));
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ set: "broken", parts: { a: { file: "a.png", pivot: [50, 50], size: [10, 10] }, b: { file: "b.png", pivot: [1, 1] } } }));
    const bad = await cli(["broken", "--root", root]);
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /\[FAIL\] Every part has a manifest entry and a PNG/);
    assert.match(bad.out, /\[FAIL\] Pivot inside the image/);
    assert.equal((await cli(["../etc", "--root", root])).code, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("palette + recolour formula are read from heroRig.ts (fails if the game's formula text drifts)", async () => {
  const text = await readFile(path.join(REPO_DIR, "client/src/heroRig.ts"), "utf8");
  const p = extractHeroPalette(text);
  assert.equal(p.skin.length, 5);
  assert.equal(p.hair.length, 6);
  assert.deepEqual(p.skinRef, [224, 173, 124]);
  assert.equal(p.hairDivisor, 115);
  assert.equal(p.farFactor, 0.78);
  assert.throws(() => extractHeroPalette(text.replace("hc[k] * l / 115", "hc[k] * l / 120 * 1")), /hair formula/);
  assert.throws(() => extractHeroPalette(text.replace("export const SKIN_COLORS", "export const SKIN")), /SKIN_COLORS/);
  // the recolour follows colored(): a skin pixel of the reference colour becomes the chosen skin colour
  const d = new Uint8ClampedArray([224, 173, 124, 255]);
  recolour(p, "head", d, 1, 1, 3, 0);
  assert.deepEqual([...d.slice(0, 3)], [0x80, 0x51, 0x35]);
  const far = new Uint8ClampedArray([100, 100, 100, 255]);
  recolour(p, "thigh", far, 1, 1, 0, 0, true);
  assert.deepEqual([...far.slice(0, 3)], [78, 78, 78]);
});
