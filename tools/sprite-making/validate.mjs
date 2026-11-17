#!/usr/bin/env node
// validate.mjs: sanity checks for a new piece against the game's painted style.
//   node validate.mjs piece.png [--style style.json] [--size WxH] [--pivot-from piece.json]
// Checks: size, soft anti-aliased edge present, solid body (alpha), dark rim (outermost solid ring is dark like the art), colour richness,
// stray pixels (1 px islands), and that a sidecar json with a pivot exists when asked. Exit code 1 on any FAIL. Warnings do not fail.
import { existsSync, readFileSync } from "node:fs";
import { readPNG } from "./png.mjs";
const args = process.argv.slice(2), file = args.shift();
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const styleFile = opt("--style", null), size = opt("--size", null), side = opt("--pivot-from", null);
if (!file) { console.error("usage: node validate.mjs piece.png [--style style.json] [--size WxH] [--pivot-from piece.json]"); process.exit(2); }
const { w, h, data } = readPNG(file);
const style = styleFile ? JSON.parse(readFileSync(styleFile, "utf8")) : null;
let fails = 0; const ok = (c, m) => console.log(`${c ? "PASS" : "FAIL"} ${m}`), warn = (m) => console.log(`WARN ${m}`);
const chk = (c, m) => { if (!c) fails++; ok(c, m); };
const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
let solid = 0, soft = 0, x0 = w, x1 = -1, y0 = h, y1 = -1; const cols = new Set();
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const al = a(x, y); if (!al) continue; if (al >= 192) { solid++; cols.add(((data[(y * w + x) * 4] >> 2) << 12) | ((data[(y * w + x) * 4 + 1] >> 2) << 6) | (data[(y * w + x) * 4 + 2] >> 2)); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } else soft++; }
console.log(`${file}: ${w}x${h}, solid ${solid}, soft-edge ${soft}, bbox ${x1 - x0 + 1}x${y1 - y0 + 1}`);
if (size) { const [sw, sh] = size.split("x").map(Number); chk(w === sw && h === sh, `canvas ${w}x${h} equals the required ${size}`); }
chk(solid > 20, "has a solid body");
chk(x0 > 0 && y0 > 0 && x1 < w - 1 && y1 < h - 1, "does not touch the canvas edge (nothing cropped)");
chk(soft > solid * 0.02, `soft anti-aliased edge present (${soft} edge px): the art is not hard-edged pixel art`);
const per = cols.size / (solid / 1000); chk(per > 60, `colour richness ${per.toFixed(0)} per 1000 solid px (the game's painted art has 500+; flat fills look foreign)`);
// rim: mean luminance of the outermost solid ring
let rs = 0, rn = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (a(x, y) < 192) continue; if (a(x - 1, y) < 192 || a(x + 1, y) < 192 || a(x, y - 1) < 192 || a(x, y + 1) < 192) { const o = (y * w + x) * 4; rs += (data[o] * 3 + data[o + 1] * 6 + data[o + 2]) / 10; rn++; } }
const rim = rn ? rs / rn : 255; chk(rim < 60, `dark rim: outer ring luminance ${rim.toFixed(0)} (game art ~25-45; a pale edge looks cut out)`);
// strays
let strays = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a(x, y) >= 192 && a(x - 1, y) < 64 && a(x + 1, y) < 64 && a(x, y - 1) < 64 && a(x, y + 1) < 64) strays++;
strays ? warn(`${strays} isolated pixel(s)`) : ok(true, "no isolated pixels");
if (style) { const gl = style.rim?.[0]; if (gl) ok(true, `style rim colour reference ${gl}`); }
if (side) { const sc = existsSync(side) ? JSON.parse(readFileSync(side, "utf8")) : null; chk(!!(sc && Array.isArray(sc.pivot)), `sidecar ${side} has a pivot [x, y]`); }
process.exit(fails ? 1 : 0);
