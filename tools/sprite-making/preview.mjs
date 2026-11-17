#!/usr/bin/env node
// preview.mjs: put new pieces beside the game's existing art, enlarged AND at in-game size, in one PNG you can Read.
//   node preview.mjs out.png [--scale 4] [--game 0.255] [--bg #6f8d4e] item item ...
//   item = file.png  |  file.png:x,y,w,h   (crop a region of a bigger frame, e.g. the helmet of champion-01)
//          file.png@2 scales that item by an extra integer factor (a small piece next to a big one)
// Top row: each item enlarged by --scale (nearest). Bottom row: the same items scaled by --game (the game draws a ~98 px person at
// 25 px, so 0.255) then shown x3 nearest so you can see what the player actually sees. Items are listed left to right in the order
// given. Compare YOUR piece to the REFERENCE in both rows: form, rim darkness, shading, colour, edge softness.
import { writePNG, readPNG } from "./png.mjs";

const args = process.argv.slice(2), out = args.shift();
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const scale = Number(opt("--scale", 4)), game = Number(opt("--game", 0.255)), bg = opt("--bg", "#6f8d4e"), items = args;
if (!out || !items.length) { console.error("usage: node preview.mjs out.png [--scale 4] [--game 0.255] [--bg #hex] item..."); process.exit(2); }
const B = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));

function load(spec) {
  const m = spec.match(/^(.*?)(?::(\d+),(\d+),(\d+),(\d+))?(?:@(\d+))?$/), path = m[1], extra = Number(m[6] || 1), img = readPNG(path);
  if (!m[2]) return { img, extra };
  const [x0, y0, w, h] = [m[2], m[3], m[4], m[5]].map(Number), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x0 + x, sy = y0 + y; if (sx < img.w && sy < img.h) for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = img.data[(sy * img.w + sx) * 4 + k]; }
  return { img: { w, h, data }, extra };
}
// nearest-neighbour resize by a real factor (up or down); alpha is kept as is
function resize(img, f) {
  const w = Math.max(1, Math.round(img.w * f)), h = Math.max(1, Math.round(img.h * f)), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(img.w - 1, Math.floor((x + 0.5) / f)), sy = Math.min(img.h - 1, Math.floor((y + 0.5) / f)); for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = img.data[(sy * img.w + sx) * 4 + k]; }
  return { w, h, data };
}
// area-average downscale (what a smooth scaler does); used for the in-game row so thin parts do not just vanish
function shrink(img, f) {
  const w = Math.max(1, Math.round(img.w * f)), h = Math.max(1, Math.round(img.h * f)), data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x / f, x1 = (x + 1) / f, y0 = y / f, y1 = (y + 1) / f; let r = 0, g = 0, b = 0, a = 0, wt = 0;
    for (let sy = Math.floor(y0); sy < Math.min(img.h, Math.ceil(y1)); sy++) for (let sx = Math.floor(x0); sx < Math.min(img.w, Math.ceil(x1)); sx++) { const o = (sy * img.w + sx) * 4, al = img.data[o + 3] / 255; r += img.data[o] * al; g += img.data[o + 1] * al; b += img.data[o + 2] * al; a += al; wt++; }
    const o = (y * w + x) * 4; if (a > 0) { data[o] = r / a; data[o + 1] = g / a; data[o + 2] = b / a; data[o + 3] = Math.min(255, (a / wt) * 255); }
  }
  return { w, h, data };
}
const loaded = items.map(load), pad = 10;
const rows = [
  loaded.map(({ img, extra }) => resize(img, scale * extra)),
  loaded.map(({ img, extra }) => resize(shrink(img, game * extra), 3)),
];
const W = Math.max(...rows.map((r) => r.reduce((a, i) => a + i.w + pad, pad))), rowH = rows.map((r) => Math.max(...r.map((i) => i.h)) + pad * 2), H = rowH.reduce((a, b) => a + b, 0);
const data = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { data[i * 4] = B[0]; data[i * 4 + 1] = B[1]; data[i * 4 + 2] = B[2]; data[i * 4 + 3] = 255; }
let y0 = 0;
rows.forEach((r, ri) => { let x0 = pad; for (const im of r) { const oy = y0 + pad + (rowH[ri] - pad * 2 - im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const s = (y * im.w + x) * 4, a = im.data[s + 3] / 255, d = ((oy + y) * W + x0 + x) * 4; if (a > 0) for (let k = 0; k < 3; k++) data[d + k] = Math.round(im.data[s + k] * a + data[d + k] * (1 - a)); } x0 += im.w + pad; } y0 += rowH[ri]; });
writePNG(out, { w: W, h: H, data });
console.log(`wrote ${out} (${W}x${H}); order left to right: ${items.join("  |  ")}`);
