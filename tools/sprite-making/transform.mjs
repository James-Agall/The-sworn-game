#!/usr/bin/env node
// transform.mjs: rotate / scale / flip a PAINTED piece with smooth (bilinear) resampling. This is fine for the game's painted art
// (it is not 1-px pixel art), so a harvested blade can be turned to any angle and sized to fit.
//   node transform.mjs in.png out.png [--rot DEG] [--scale F] [--flip] [--pivot x,y]
// --rot rotates clockwise about --pivot (default centre) on a canvas grown to fit; positive = clockwise.
import { readPNG, writePNG } from "./png.mjs";
const args = process.argv.slice(2), [inp, outp] = args.splice(0, 2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const rot = Number(opt("--rot", 0)) * Math.PI / 180, sc = Number(opt("--scale", 1)), flip = flag("--flip"), pv = opt("--pivot", null);
const im = readPNG(inp), px = pv ? pv.split(",").map(Number) : [im.w / 2, im.h / 2];
const ca = Math.cos(rot), sa = Math.sin(rot), corners = [[0, 0], [im.w, 0], [0, im.h], [im.w, im.h]].map(([x, y]) => { let dx = (flip ? im.w - x : x) - px[0], dy = y - px[1]; dx *= sc; dy *= sc; return [dx * ca - dy * sa, dx * sa + dy * ca]; });
const x0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 1, y0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 1, W = Math.ceil(Math.max(...corners.map((c) => c[0]))) - x0 + 2, H = Math.ceil(Math.max(...corners.map((c) => c[1]))) - y0 + 2;
const out = new Uint8Array(W * H * 4);
const get = (x, y) => (x < 0 || y < 0 || x >= im.w || y >= im.h ? [0, 0, 0, 0] : [0, 1, 2, 3].map((k) => im.data[(y * im.w + x) * 4 + k]));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x0 + x + 0.5, dy = y0 + y + 0.5, sx = (dx * ca + dy * sa) / sc + px[0], sy = (-dx * sa + dy * ca) / sc + px[1], u = (flip ? im.w - sx : sx) - 0.5, v = sy - 0.5, ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
  const p = [get(ix, iy), get(ix + 1, iy), get(ix, iy + 1), get(ix + 1, iy + 1)], w4 = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let a = 0, r = 0, g = 0, b = 0; for (let i = 0; i < 4; i++) { const al = p[i][3] * w4[i]; a += al; r += p[i][0] * al; g += p[i][1] * al; b += p[i][2] * al; }
  const o = (y * W + x) * 4; if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = Math.round(a); }
}
writePNG(outp, { w: W, h: H, data: out }); console.log(`wrote ${outp} ${W}x${H}`);
