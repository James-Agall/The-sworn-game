#!/usr/bin/env node
// slice-rig-sheet.mjs: cut a generated part sheet (ChatGPT, SPRITES.md #106-#109) into the rig's part PNGs + manifest.json.
//
//   node scripts/slice-rig-sheet.mjs <sheet.png> <layout.json> [--out client/public/rig/parts/<set>] [--bg auto|none] [--merge] [--dry]
//
// For each cell named in the layout it: crops the cell -> removes an opaque background (flood fill from the cell edge, --bg auto) ->
// keeps the main blob plus any piece >= 8% of it (drops stray specks) -> trims -> rescales to the rig's expected height (painted art, so
// bilinear is fine) -> finds the joint pivot (modes below) -> writes <name>.png and a manifest entry. The first variant of each part
// is ALSO written under the bare part name (e.g. upperArm.cloth -> upperArm) so the rig needs no change. --merge adds to an existing
// manifest (so #106..#109 can be sliced one after another into the same set). --dry only prints the report.
//
// Pivot modes (per cell in the layout, default "topcap" for limbs):
//   topcap     limb hanging down: the joint cap is the widest part of the top 40%; pivot = cap centre (x centroid, y = top + width / 2)
//   cell       the anchor the brief asked for, [x, y] in cell px (`cellPivot`, default centred 20 px from the top), mapped through trim + scale. Use it
//              for families that must share an origin (head + hair + helm all anchor at the neck base; torso at the waist; foot at the ankle)
//   bottom     torso / pelvis-like: pivot at the bottom centre of the part (+ dy px)
//   frac       pivot at [fx, fy] of the trimmed bbox
// A cross-check against the `cell` pivot warns when the two differ by more than 6 px (the sheet probably ignored the layout).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readPNG, writePNG } from "./lib/png.mjs";

const args = process.argv.slice(2), [sheetPath, layoutPath] = args.splice(0, 2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const out = opt("--out", "client/public/rig/parts/sliced"), bgMode = opt("--bg", "auto"), merge = flag("--merge"), dry = flag("--dry");
if (!sheetPath || !layoutPath) { console.error("usage: node scripts/slice-rig-sheet.mjs <sheet.png> <layout.json> [--out dir] [--bg auto|none] [--merge] [--dry]"); process.exit(2); }
const sheet = readPNG(sheetPath), layout = JSON.parse(readFileSync(layoutPath, "utf8"));
const CW = layout.cellW ?? 128, CH = layout.cellH ?? 128, OX = layout.originX ?? 0, OY = layout.originY ?? 0;

// ---- helpers on {w,h,data} RGBA images
const mk = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });
const A = (im, x, y) => (x < 0 || y < 0 || x >= im.w || y >= im.h ? 0 : im.data[(y * im.w + x) * 4 + 3]);
function crop(im, x0, y0, w, h) { const o = mk(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x0 + x, sy = y0 + y; if (sx < 0 || sy < 0 || sx >= im.w || sy >= im.h) continue; for (let k = 0; k < 4; k++) o.data[(y * w + x) * 4 + k] = im.data[(sy * im.w + sx) * 4 + k]; } return o; }
// remove an opaque background: take the colour of the cell's corners, flood fill inward from the border where colour is close
function removeBg(im, tol = 38) {
  const corners = [[0, 0], [im.w - 1, 0], [0, im.h - 1], [im.w - 1, im.h - 1]].map(([x, y]) => [...im.data.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)]);
  if (corners.some((c) => c[3] < 250)) return { removed: 0, note: "already transparent" };
  const ref = corners[0], close = (i) => Math.hypot(im.data[i] - ref[0], im.data[i + 1] - ref[1], im.data[i + 2] - ref[2]) < tol, seen = new Uint8Array(im.w * im.h), st = [];
  for (let x = 0; x < im.w; x++) { st.push(x, (im.h - 1) * im.w + x); } for (let y = 0; y < im.h; y++) st.push(y * im.w, y * im.w + im.w - 1);
  let n = 0; while (st.length) { const p = st.pop(); if (seen[p]) continue; seen[p] = 1; if (!close(p * 4)) continue; im.data[p * 4 + 3] = 0; n++; const x = p % im.w, y = (p / im.w) | 0; if (x > 0) st.push(p - 1); if (x < im.w - 1) st.push(p + 1); if (y > 0) st.push(p - im.w); if (y < im.h - 1) st.push(p + im.w); }
  return { removed: n, note: `background ${ref.slice(0, 3).join(",")} removed` };
}
// connected components of solid pixels; keep the largest and any >= 8% of it
function keepMain(im) {
  const lab = new Int32Array(im.w * im.h), sizes = [0]; let nl = 0;
  for (let i = 0; i < im.w * im.h; i++) { if (lab[i] || im.data[i * 4 + 3] < 128) continue; nl++; sizes[nl] = 0; const st = [i]; lab[i] = nl; while (st.length) { const p = st.pop(); sizes[nl]++; const x = p % im.w, y = (p / im.w) | 0; for (const q of [x > 0 ? p - 1 : -1, x < im.w - 1 ? p + 1 : -1, y > 0 ? p - im.w : -1, y < im.h - 1 ? p + im.w : -1]) if (q >= 0 && !lab[q] && im.data[q * 4 + 3] >= 128) { lab[q] = nl; st.push(q); } } }
  const mx = Math.max(0, ...sizes), keep = sizes.map((s) => s >= mx * 0.08 && mx >= 25); let dropped = 0;       // a cell whose biggest blob is < 25 px is empty (specks only)
  // Keep a one-pixel antialiased fringe around retained solid components. Unlabelled
  // translucent specks used to survive cleanup and inflate the trim bounds.
  const mask = new Uint8Array(lab.length);
  for (let i = 0; i < lab.length; i++) if (lab[i] && keep[lab[i]]) {
    const x=i%im.w,y=(i/im.w)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<im.w&&y+dy>=0&&y+dy<im.h)mask[(y+dy)*im.w+x+dx]=1;
  }
  for (let i = 0; i < lab.length; i++) if (!mask[i] && im.data[i*4+3]) { im.data[i*4+3]=0; dropped++; }
  return { components: sizes.length - 1, dropped };
}
function bbox(im) { let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1; for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (A(im, x, y) >= 96) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
function resize(im, f) {            // bilinear, alpha-weighted (painted art)
  const w = Math.max(1, Math.round(im.w * f)), h = Math.max(1, Math.round(im.h * f)), o = mk(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / f - 0.5, v = (y + 0.5) / f - 0.5, ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy; let a = 0, r = 0, g = 0, b = 0;
    for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) { const sx = Math.min(im.w - 1, Math.max(0, ix + dx)), sy = Math.min(im.h - 1, Math.max(0, iy + dy)), i = (sy * im.w + sx) * 4, al = (im.data[i + 3] / 255) * wt; a += al; r += im.data[i] * al; g += im.data[i + 1] * al; b += im.data[i + 2] * al; }
    const o4 = (y * w + x) * 4; if (a > 0) { o.data[o4] = r / a; o.data[o4 + 1] = g / a; o.data[o4 + 2] = b / a; o.data[o4 + 3] = Math.round(a * 255); }
  }
  return o;
}
function topCapPivot(im) {          // the joint cap: widest of the top 40% of rows
  const bb = bbox(im); if (!bb) return null;
  const lim = Math.max(4, Math.round(bb.h * 0.4)), rows = [];
  for (let y = bb.y0; y < bb.y0 + lim; y++) { let l = im.w, r = -1; for (let x = 0; x < im.w; x++) if (A(im, x, y) >= 96) { l = Math.min(l, x); r = Math.max(r, x); } rows.push(r < 0 ? null : { y, l, r, w: r - l + 1 }); }
  const mxw = Math.max(...rows.filter(Boolean).map((r) => r.w)), capRows = rows.filter((r) => r && r.w >= mxw * 0.9);
  return [capRows.reduce((a, r) => a + (r.l + r.r) / 2, 0) / capRows.length + 0.5, bb.y0 + mxw / 2];
}

// ---- main
const report = [], manifest = merge && existsSync(out + "/manifest.json") ? JSON.parse(readFileSync(out + "/manifest.json", "utf8")) : { set: layout.set || "sliced", parts: {}, soleBelowAnkle: 11 };
if (!dry) mkdirSync(out, { recursive: true });
for (const cell of layout.cells) {
  const [x0,y0,cw,ch] = cell.rect ?? [OX + cell.col * CW, OY + cell.row * CH, CW, CH], notes = [];
  let im = crop(sheet, x0, y0, cw, ch);
  if (bgMode === "auto") { const r = removeBg(im); if (r.removed) notes.push(r.note); }
  const kept = keepMain(im); if (kept.dropped) notes.push(`dropped ${kept.dropped} stray px`);
  const bb0 = bbox(im);
  if (!bb0) { report.push({ name: cell.name, status: "EMPTY", notes: ["no solid pixels in the cell"] }); continue; }
  if (bb0.x0 <= 0 || bb0.y0 <= 0 || bb0.x1 >= cw - 1 || bb0.y1 >= ch - 1) notes.push("touches the cell edge (cropped?)");
  const PAD = 2; let t = crop(im, bb0.x0 - PAD, bb0.y0 - PAD, bb0.w + PAD * 2, bb0.h + PAD * 2);
  const expH = cell.expectH, f = expH ? expH / bb0.h : 1; if (expH) t = resize(t, f);
  // Preserve a safe transparent border after downscaling source sheets. Optional
  // rim adjustment matches an existing painted palette without changing the silhouette.
  const shade=layout.edgeShade ?? 1;
  if(shade!==1)for(let y=0;y<t.h;y++)for(let x=0;x<t.w;x++)if(A(t,x,y)>=192 && [A(t,x-1,y),A(t,x+1,y),A(t,x,y-1),A(t,x,y+1)].some(a=>a<192))for(let k=0;k<3;k++)t.data[(y*t.w+x)*4+k]*=shade;
  const outputPad=layout.outputPad ?? 0;
  if(outputPad)t=crop(t,-outputPad,-outputPad,t.w+outputPad*2,t.h+outputPad*2);
  const bb = bbox(t);
  // the brief's pivot (joint 20 px from the cell top, centred), mapped through the trim + scale
  const cp = cell.cellPivot || [CW / 2, cell.cellPivotY ?? 20], cellPivot = [(cp[0] - (bb0.x0 - PAD)) * f + outputPad, (cp[1] - (bb0.y0 - PAD)) * f + outputPad];
  let pivot, mode = cell.mode || "topcap";
  if (mode === "topcap") { pivot = topCapPivot(t); if (!pivot) { report.push({ name: cell.name, status: "EMPTY", notes: ["nothing left after cleanup"] }); continue; } }
  else if (mode === "bottom") pivot = [bb.x0 + bb.w / 2, bb.y0 + bb.h + (cell.dy ?? 0)];
  else if (mode === "frac") pivot = [bb.x0 + bb.w * (cell.fx ?? 0.5), bb.y0 + bb.h * (cell.fy ?? 0.5)];
  else pivot = cellPivot;
  if (mode === "topcap" && Math.hypot(pivot[0] - cellPivot[0], pivot[1] - cellPivot[1]) > 6) notes.push(`pivot from the cap (${pivot.map((v) => v.toFixed(1))}) differs from the brief's cell pivot (${cellPivot.map((v) => v.toFixed(1))})`);
  pivot = pivot.map((v) => Math.round(v * 2) / 2);
  const entry = { file: cell.name + ".png", pivot, len: cell.len ?? 0, joint: cell.joint || "", size: [t.w, t.h], scale: +f.toFixed(3), variant: cell.name.includes(".") ? cell.name.split(".").slice(1).join(".") : "" };
  report.push({ name: cell.name, status: notes.some((n) => /edge|differs/.test(n)) ? "CHECK" : "ok", size: `${t.w}x${t.h}`, scale: f.toFixed(2), pivot: pivot.join(","), notes });
  if (dry) continue;
  writePNG(`${out}/${cell.name}.png`, t); manifest.parts[cell.name] = entry;
  if (cell.default) { writePNG(`${out}/${cell.default}.png`, t); manifest.parts[cell.default] = { ...entry, file: cell.default + ".png" }; }
}
if (!dry) { writeFileSync(out + "/manifest.json", JSON.stringify(manifest, null, 1)); writeFileSync(out + "/slice-report.json", JSON.stringify(report, null, 1)); }
// alignment preview: every part on a 112 x 112 tile with its pivot on a fixed point (red cross), so a wrong pivot or a family that does not line up is obvious
if (!dry) {
  const TILE = 112, COLS = 6, rows = Math.ceil(report.filter((r) => r.pivot).length / COLS) || 1, pv = mk(COLS * TILE, rows * TILE); pv.data.fill(0); for (let i = 0; i < pv.w * pv.h; i++) { pv.data[i * 4] = 0x6f; pv.data[i * 4 + 1] = 0x8d; pv.data[i * 4 + 2] = 0x4e; pv.data[i * 4 + 3] = 255; }
  let n = 0;
  for (const r of report) { if (!r.pivot) continue; const im = readPNG(`${out}/${r.name}.png`), [px, py] = r.pivot.split(",").map(Number), tx = (n % COLS) * TILE + 56, ty = Math.floor(n / COLS) * TILE + 44;
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const dx = Math.round(tx + x - px), dy = Math.round(ty + y - py), sx = (y * im.w + x) * 4, a = im.data[sx + 3] / 255; if (dx < 0 || dy < 0 || dx >= pv.w || dy >= pv.h || !a) continue; for (let k = 0; k < 3; k++) pv.data[(dy * pv.w + dx) * 4 + k] = Math.round(im.data[sx + k] * a + pv.data[(dy * pv.w + dx) * 4 + k] * (1 - a)); }
    for (let k = -5; k <= 5; k++) for (const [cx, cy] of [[tx + k, ty], [tx, ty + k]]) { const o = (cy * pv.w + cx) * 4; pv.data[o] = 255; pv.data[o + 1] = 40; pv.data[o + 2] = 40; }
    n++; }
  writePNG(out + "/slice-preview.png", pv);
}
const pad = (s, n) => String(s).padEnd(n);
console.log(`${dry ? "DRY RUN " : ""}${sheetPath} + ${layoutPath} -> ${out}`);
for (const r of report) console.log(`${pad(r.status, 6)} ${pad(r.name, 18)} ${pad(r.size || "", 8)} x${pad(r.scale || "", 5)} pivot ${pad(r.pivot || "", 9)} ${(r.notes || []).join("; ")}`);
const bad = report.filter((r) => r.status !== "ok").length; console.log(`${report.length - bad} ok, ${bad} need a look`);
process.exit(bad && !dry ? 0 : 0);
