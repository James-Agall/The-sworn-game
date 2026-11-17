#!/usr/bin/env node
// compose.mjs: layer pieces onto a base frame (normal alpha-over, nearest, no scaling).
//   node compose.mjs out.png base.png piece.png@x,y [piece2.png@x,y ...] [--erase "x,y,w,h;..."]  (erase clears base pixels first)
// x,y = where the piece's top-left lands on the base, in base px (can be negative). Use it to try a helmet on a hero frame, then
// read the PNG. Per-frame overlays for an animation: run once per frame with that frame's offset (find it by eye with grid, or by
// the head's top-left in each frame) and list the results.
import { writePNG, readPNG } from "./png.mjs";
const argv = process.argv.slice(2); const ei = argv.indexOf("--erase"); const eraseSpec = ei >= 0 ? argv.splice(ei, 2)[1] : null;
const [out, basePath, ...layers] = argv;
if (!out || !basePath || !layers.length) { console.error("usage: node compose.mjs out.png base.png piece.png@x,y ..."); process.exit(2); }
const base = readPNG(basePath), data = new Uint8Array(base.data);
for (const r of (eraseSpec || "").split(";").filter(Boolean)) { const [ex, ey, ew, eh] = r.split(",").map(Number); for (let y = ey; y < ey + eh; y++) for (let x = ex; x < ex + ew; x++) if (x >= 0 && y >= 0 && x < base.w && y < base.h) data[(y * base.w + x) * 4 + 3] = 0; }
for (const l of layers) {
  const m = l.match(/^(.*)@(-?\d+),(-?\d+)$/); if (!m) { console.error("layer needs @x,y: " + l); process.exit(2); }
  const p = readPNG(m[1]), ox = +m[2], oy = +m[3];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const bx = ox + x, by = oy + y; if (bx < 0 || by < 0 || bx >= base.w || by >= base.h) continue;
    const s = (y * p.w + x) * 4, d = (by * base.w + bx) * 4, sa = p.data[s + 3] / 255, da = data[d + 3] / 255, oa = sa + da * (1 - sa);
    if (!oa) continue;
    for (let k = 0; k < 3; k++) data[d + k] = Math.round((p.data[s + k] * sa + data[d + k] * da * (1 - sa)) / oa);
    data[d + 3] = Math.round(oa * 255);
  }
}
writePNG(out, { w: base.w, h: base.h, data }); console.log("wrote " + out);
