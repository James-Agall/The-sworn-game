#!/usr/bin/env node
// harvest.mjs: lift a REAL piece out of existing art (a helmet from champion-01, a sword from base-05) as a transparent PNG.
//   node harvest.mjs src.png out.png --poly "x,y;x,y;..."   keep only pixels inside this polygon (source px)
//   node harvest.mjs src.png out.png --rect x,y,w,h          or a rectangle
//   [--erase "x,y,w,h;..."] clear rects afterwards   [--no-trim] keep the full crop   [--pad 1]
// Writes out.png and out.json ({ srcRect: [x, y, w, h] } = where the piece sat in the source, so it can be placed back exactly).
// Why: forms drawn from scratch look generic. The game's own art already contains correct helmets, blades, shields and bows.
import { writeFileSync } from "node:fs";
import { readPNG, writePNG } from "./png.mjs";
const args = process.argv.slice(2), [src, out] = args.splice(0, 2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const poly = opt("--poly", null), rect = opt("--rect", null), erase = opt("--erase", null), noTrim = flag("--no-trim"), pad = Number(opt("--pad", 1));
if (!src || !out || (!poly && !rect)) { console.error("usage: node harvest.mjs src.png out.png (--poly \"x,y;x,y;...\" | --rect x,y,w,h) [--erase \"x,y,w,h;...\"]"); process.exit(2); }
const im = readPNG(src);
const inside = (() => {
  if (rect) { const [x, y, w, h] = rect.split(",").map(Number); return (px, py) => px >= x && px < x + w && py >= y && py < y + h; }
  const pts = poly.split(";").map((p) => p.split(",").map(Number));
  return (px, py) => { let c = false; const x = px + 0.5, y = py + 0.5; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
})();
const er = (erase || "").split(";").filter(Boolean).map((r) => r.split(",").map(Number));
const keep = new Uint8Array(im.w * im.h);
let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
  if (!inside(x, y) || er.some(([ex, ey, ew, eh]) => x >= ex && x < ex + ew && y >= ey && y < ey + eh) || im.data[(y * im.w + x) * 4 + 3] === 0) continue;
  keep[y * im.w + x] = 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
}
if (x1 < 0) { console.error("nothing inside the selection"); process.exit(1); }
if (noTrim) { x0 = 0; y0 = 0; x1 = im.w - 1; y1 = im.h - 1; } else { x0 -= pad; y0 -= pad; x1 += pad; y1 += pad; }
const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h || !keep[sy * im.w + sx]) continue; for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = im.data[(sy * im.w + sx) * 4 + k]; }
writePNG(out, { w, h, data }); writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify({ srcRect: [x0, y0, w, h], source: src }));
console.log(`wrote ${out} ${w}x${h} (was at ${x0},${y0} in ${src})`);
