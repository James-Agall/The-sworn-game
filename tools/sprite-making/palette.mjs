#!/usr/bin/env node
// palette.mjs: measure the STYLE of reference sprites so new pieces can match it.
//   node palette.mjs <png|dir> [more...] [--top 40] [--out style.json]
// Prints: sprite size / opaque bbox, how many distinct colours, the OUTLINE colour (most common colour on the silhouette edge),
// whether edges are hard (alpha 0/255 only) or anti-aliased, the dominant colours grouped into hue families sorted dark -> light
// (these are the shading ramps), and the light direction (does the left or the top carry the brighter pixels).
// With --out it writes style.json = { outline, hardAlpha, colours:[{hex,share}], ramps:[[hex...]] } for validate.mjs / pxl.mjs.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPNG } from "./png.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const top = Number(opt("--top", 40)), out = opt("--out", null);
const files = [];
for (const a of args) { const s = statSync(a); if (s.isDirectory()) for (const f of readdirSync(a)) { if (f.endsWith(".png")) files.push(join(a, f)); } else files.push(a); }
if (!files.length) { console.error("usage: node palette.mjs <png|dir>... [--top N] [--out style.json]"); process.exit(2); }

const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; let h = 0, s = 0; if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, s, l]; };
const counts = new Map(), edge = new Map(), samples = [], depthSum = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
let opaque = 0, semi = 0, nearOpaque = 0, edgeSoft = 0, edgeAll = 0, lightLeft = 0, lightRight = 0, lightTop = 0, lightBottom = 0, sprites = 0;
for (const f of files) {
  const { w, h, data } = readPNG(f); sprites++;
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3] >= 192 ? 255 : 0);
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, a = data[o + 3]; if (a === 0) continue;
    if (a < 192) { semi++; continue; }                     // real soft edge pixels
    if (a < 255) nearOpaque++;                             // alpha 192..254: the art is effectively solid but not exactly 255
    opaque++;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    const k = hex(data[o], data[o + 1], data[o + 2]); counts.set(k, (counts.get(k) || 0) + 1);
    if (((x * 7 + y * 13) & 3) === 0) samples.push([data[o], data[o + 1], data[o + 2]]);
    { let d = 0; for (; d < 4; d++) { const r = d + 1; if (!A(x - r, y) || !A(x + r, y) || !A(x, y - r) || !A(x, y + r)) break; } if (d < 4) { depthSum[d][0] += data[o]; depthSum[d][1] += data[o + 1]; depthSum[d][2] += data[o + 2]; depthSum[d][3]++; } }
    if (!A(x - 1, y) || !A(x + 1, y) || !A(x, y - 1) || !A(x, y + 1)) edge.set(k, (edge.get(k) || 0) + 1);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = (y * w + x) * 4; if (data[o + 3] < 255) continue; const l = (data[o] * 3 + data[o + 1] * 6 + data[o + 2]) / 10; if (x < cx) lightLeft += l; else lightRight += l; if (y < cy) lightTop += l; else lightBottom += l; }
  if (files.length <= 3) console.log(`${f}: ${w}x${h}, body bbox x ${x0}..${x1} y ${y0}..${y1} (${x1 - x0 + 1}x${y1 - y0 + 1})`);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const outline = [...edge.entries()].sort((a, b) => b[1] - a[1])[0];
const perK = counts.size / (total / sprites / 1000);
console.log(`\n${sprites} sprite(s), ${counts.size} distinct solid colours (${perK.toFixed(0)} per 1000 px), soft edge pixels (alpha < 192): ${semi}, alpha 192..254: ${nearOpaque} of ${opaque}`);
console.log(`style class: ${perK > 150 ? "PAINTED / continuous colour (many colours, smooth gradients). Do NOT use a small indexed palette; use gradients + noise." : "limited-palette PIXEL ART (use ramps, no gradients)"}; edges: ${semi > opaque * 0.02 ? "soft anti-aliased" : "hard"}`);
console.log(`outline colour (most common on the silhouette edge): ${outline ? outline[0] : "?"}  (${outline ? Math.round((outline[1] / [...edge.values()].reduce((a, b) => a + b, 0)) * 100) : 0}% of edge pixels)`);
console.log(`light: brighter on the ${lightLeft > lightRight ? "LEFT" : "RIGHT"} (${(lightLeft / lightRight).toFixed(2)}x), brighter on the ${lightTop > lightBottom ? "TOP" : "BOTTOM"} (${(lightTop / lightBottom).toFixed(2)}x)`);
// hue families: bucket the top colours by hue (30 deg) / near-grey, sort each by lightness = a ramp
const fam = new Map(), cols = sorted.slice(0, top).map(([k, n]) => { const r = parseInt(k.slice(1, 3), 16), g = parseInt(k.slice(3, 5), 16), b = parseInt(k.slice(5, 7), 16); return { hex: k, n, hsl: hsl(r, g, b) }; });
for (const c of cols) { const key = c.hsl[1] < 0.12 ? "grey" : "h" + String(Math.floor(c.hsl[0] / 30) * 30).padStart(3, "0"); (fam.get(key) || fam.set(key, []).get(key)).push(c); }
console.log("\nshading ramps (dark -> light), share of opaque pixels:");
const ramps = [];
for (const [key, list] of [...fam.entries()].sort((a, b) => b[1].reduce((s, c) => s + c.n, 0) - a[1].reduce((s, c) => s + c.n, 0))) {
  list.sort((a, b) => a.hsl[2] - b.hsl[2]); ramps.push(list.map((c) => c.hex));
  console.log(`  ${key.padEnd(5)} ${list.map((c) => `${c.hex}(${(c.n / total * 100).toFixed(1)}%)`).join(" ")}`);
}

// painted art: the outline is a DARK RIM of a few px, not a palette entry. Mean colour by distance from the silhouette edge (0 = outermost solid px).
console.log("\nrim colour by depth from the silhouette edge (px 0 = outermost):");
const rim = depthSum.map((d, i) => { const n = d[3] || 1, c = [d[0] / n, d[1] / n, d[2] / n].map(Math.round); console.log(`  depth ${i}: ${hex(...c)}  (${d[3]} px)`); return hex(...c); });
// k-means (k = 20) over the solid colours: the working palette of the painting
function kmeans(pts, k, it = 12) { let cs = Array.from({ length: k }, (_, i) => pts[Math.floor((i + 0.5) * pts.length / k)].slice()); for (let n = 0; n < it; n++) { const sum = cs.map(() => [0, 0, 0, 0]); for (const p of pts) { let b = 0, bd = 1e9; for (let i = 0; i < k; i++) { const d = (p[0] - cs[i][0]) ** 2 + (p[1] - cs[i][1]) ** 2 + (p[2] - cs[i][2]) ** 2; if (d < bd) { bd = d; b = i; } } sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; sum[b][3]++; } cs = sum.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cs[i])); const cnt = sum.map((s) => s[3]); cs.cnt = cnt; } return cs; }
const km = kmeans(samples, 20), kmHex = km.map((c, i) => ({ hex: hex(...c.map(Math.round)), n: km.cnt[i], l: hsl(...c)[2] })).sort((a, b) => a.l - b.l);
console.log("\nclustered colours (20), dark -> light, share:\n  " + kmHex.map((c) => `${c.hex}(${(c.n / samples.length * 100).toFixed(0)}%)`).join(" "));
if (out) { writeFileSync(out, JSON.stringify({ outline: rim[0], rim, clusters: kmHex.map((c) => c.hex), hardAlpha: semi === 0, colours: cols.map((c) => ({ hex: c.hex, share: +(c.n / total).toFixed(4) })), ramps }, null, 1)); console.log(`\nwrote ${out}`); }
