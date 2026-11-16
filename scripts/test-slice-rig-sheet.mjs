#!/usr/bin/env node
// Round-trip test for slice-rig-sheet.mjs: slice the placeholder parts-sheet.png back into parts and check each one lines up with its original
// when both are placed by their pivot (alpha-mask overlap, IoU), so a pivot found by the slicer is as good as the one the generator wrote.
//   node scripts/test-slice-rig-sheet.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { readPNG } from "./lib/png.mjs";
const dir = mkdtempSync(tmpdir() + "/slice-test-"), src = new URL("../client/public/rig/parts/bodyset/", import.meta.url).pathname;
const orig = JSON.parse(readFileSync(src + "manifest.json", "utf8"));
const alphaAt = (im, x, y) => (x < 0 || y < 0 || x >= im.w || y >= im.h ? 0 : im.data[(y * im.w + x) * 4 + 3] >= 128 ? 1 : 0);
let fails = 0;
const run = (layout, only) => execFileSync("node", [new URL("./slice-rig-sheet.mjs", import.meta.url).pathname, sheetFile, new URL("./rig-layouts/" + layout, import.meta.url).pathname, "--out", dir + "/" + layout], { stdio: "pipe" });
function compare(layout, tag, thr) {
  const got = JSON.parse(readFileSync(dir + "/" + layout + "/manifest.json", "utf8"));
  for (const name of Object.keys(orig.parts)) {
    if (!got.parts[name]) continue;
    const a = readPNG(src + orig.parts[name].file), b = readPNG(dir + "/" + layout + "/" + got.parts[name].file), pa = orig.parts[name].pivot, pb = got.parts[name].pivot;
    let inter = 0, uni = 0;
    for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) { const A = alphaAt(a, Math.round(pa[0] + x), Math.round(pa[1] + y)), B = alphaAt(b, Math.round(pb[0] + x), Math.round(pb[1] + y)); if (A && B) inter++; if (A || B) uni++; }
    const iou = inter / uni, ok = iou > thr; if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} [${tag}] ${name.padEnd(9)} aligned-by-pivot overlap ${(iou * 100).toFixed(1)}%  (orig pivot ${pa}, sliced ${pb})`);
  }
}
const sheetFile = src + "parts-sheet.png";
run("placeholder-sheet.json"); compare("placeholder-sheet.json", "cell anchors", 0.97);
run("placeholder-sheet-topcap.json"); const gt = JSON.parse(readFileSync(dir + "/placeholder-sheet-topcap.json/manifest.json", "utf8"));
for (const name of ["upperArm", "foreArm", "thigh", "shin"]) { const a = readPNG(src + orig.parts[name].file), b = readPNG(dir + "/placeholder-sheet-topcap.json/" + gt.parts[name].file), pa = orig.parts[name].pivot, pb = gt.parts[name].pivot; let i2 = 0, u2 = 0; for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) { const A = alphaAt(a, Math.round(pa[0] + x), Math.round(pa[1] + y)), B = alphaAt(b, Math.round(pb[0] + x), Math.round(pb[1] + y)); if (A && B) i2++; if (A || B) u2++; } const iou = i2 / u2, ok = iou > 0.85; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} [cap rule]     ${name.padEnd(9)} overlap ${(iou * 100).toFixed(1)}%`); }

// ---- messy sheet: opaque background, specks, parts scaled 0.8-1.4x and shifted up to 10 px (what a generated sheet really looks like)
{
  const { writeFileSync } = await import("node:fs"), { writePNG } = await import("./lib/png.mjs");
  const limbs = ["upperArm", "foreArm", "thigh", "shin"], CELL = 128, W = limbs.length * CELL, H = CELL, data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 0x3b; data[i * 4 + 1] = 0x6a; data[i * 4 + 2] = 0x3f; data[i * 4 + 3] = 255; }
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cells = [];
  limbs.forEach((name, ci) => {
    const im = readPNG(src + orig.parts[name].file), f = 0.8 + rnd() * 0.6, ox = Math.round((rnd() - 0.5) * 20), oy = Math.round((rnd() - 0.5) * 16);
    let y0 = im.h, y1 = 0; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3] > 128) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const expectH = y1 - y0 + 1;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {       // inverse-map nearest into this cell
      const sx = Math.floor((x - 64 - ox) / f + orig.parts[name].pivot[0]), sy = Math.floor((y - 20 - oy) / f + orig.parts[name].pivot[1]);
      if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h) continue; const si = (sy * im.w + sx) * 4; if (im.data[si + 3] < 128) continue; const di = (y * W + ci * CELL + x) * 4; for (let k = 0; k < 3; k++) data[di + k] = im.data[si + k];
    }
    for (let k = 0; k < 6; k++) { const x = ci * CELL + 2 + Math.floor(rnd() * 124), y = 2 + Math.floor(rnd() * 124), di = (y * W + x) * 4; if (data[di] === 0x3b) { data[di] = 250; data[di + 1] = 250; data[di + 2] = 60; } }
    cells.push({ name, row: 0, col: ci, mode: "topcap", expectH, len: orig.parts[name].len, joint: orig.parts[name].joint });
  });
  writePNG(dir + "/messy.png", { w: W, h: H, data }); writeFileSync(dir + "/messy.json", JSON.stringify({ set: "messy", cellW: 128, cellH: 128, cells }));
  let outTxt = ""; try { outTxt = execFileSync("node", [new URL("./slice-rig-sheet.mjs", import.meta.url).pathname, dir + "/messy.png", dir + "/messy.json", "--out", dir + "/messy"], { stdio: "pipe" }).toString(); } catch (e) { console.log("slicer failed:", String(e.stderr).split("\n").slice(0, 8).join("\n")); process.exit(1); }
  const gm = JSON.parse(readFileSync(dir + "/messy/manifest.json", "utf8"));
  for (const name of limbs) {
    const a = readPNG(src + orig.parts[name].file), b = readPNG(dir + "/messy/" + gm.parts[name].file), pa = orig.parts[name].pivot, pb = gm.parts[name].pivot; let i2 = 0, u2 = 0;
    for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) { const A = alphaAt(a, Math.round(pa[0] + x), Math.round(pa[1] + y)), B = alphaAt(b, Math.round(pb[0] + x), Math.round(pb[1] + y)); if (A && B) i2++; if (A || B) u2++; }
    const iou = i2 / u2, ok = iou > 0.8; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} [messy sheet]  ${name.padEnd(9)} overlap ${(iou * 100).toFixed(1)}% after bg removal, speck removal, rescale and shift`);
  }
  const bgOk = /background 59,106,63 removed/.test(outTxt), speckOk = /dropped \d+ stray px/.test(outTxt); if (!bgOk) fails++; if (!speckOk) fails++;
  console.log(`${bgOk ? "PASS" : "FAIL"} [messy sheet]  opaque background detected and removed`); console.log(`${speckOk ? "PASS" : "FAIL"} [messy sheet]  stray specks dropped`);
}
console.log(fails ? `${fails} FAILED` : "all parts line up with their originals");
process.exit(fails ? 1 : 0);
