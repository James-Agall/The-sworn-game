#!/usr/bin/env node
// recolor.mjs: re-material a painted piece while KEEPING its shading, so one harvested helmet / blade becomes iron, steel, gold, ...
//   node recolor.mjs in.png out.png --to "#6f86a8" [--select grey|all|warm] [--sat 0.3] [--keep-rim 0.18] [--light 1.0]
// Each selected pixel's luminance is mapped through a 3-stop ramp built from --to (dark -> base -> light), so highlights, shadows,
// mottling and the dark rim survive. --select grey (default) touches only low-saturation pixels (metal), leaving leather, skin, gems.
import { readPNG, writePNG } from "./png.mjs";
const args = process.argv.slice(2), [inp, outp] = args.splice(0, 2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const to = opt("--to", null), select = opt("--select", "grey"), satMax = Number(opt("--sat", 0.3)), keepRim = Number(opt("--keep-rim", 0.16)), lightK = Number(opt("--light", 1));
if (!inp || !outp || !to) { console.error("usage: node recolor.mjs in.png out.png --to #hex [--select grey|all|warm] [--sat 0.3] [--keep-rim 0.16] [--light 1]"); process.exit(2); }
const T = [1, 3, 5].map((i) => parseInt(to.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), lum = (r, g, b) => (r * 0.3 + g * 0.59 + b * 0.11) / 255;
const dark = mix(T, [18, 14, 28], 0.62), light = mix(T, [255, 246, 226], 0.7);
const { w, h, data } = readPNG(inp), o = new Uint8Array(data);
for (let i = 0; i < w * h; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3]; if (a < 8) continue;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, L = lum(r, g, b);
  if (L < keepRim) continue;                                                // the near-black rim stays
  if (select === "grey" && sat > satMax) continue; if (select === "warm" && sat <= satMax) continue;
  const t = Math.min(1, Math.max(0, ((L - keepRim) / (0.95 - keepRim)) * lightK)), c = t < 0.5 ? mix(dark, T, t * 2) : mix(T, light, (t - 0.5) * 2);
  o[i * 4] = Math.round(c[0]); o[i * 4 + 1] = Math.round(c[1]); o[i * 4 + 2] = Math.round(c[2]);
}
writePNG(outp, { w, h, data: o }); console.log(`wrote ${outp}`);
