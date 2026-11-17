#!/usr/bin/env node
// pack-atlas.mjs: pack every client/public/sprites/**/*.png (4,500+ files) into a few big sheets + a manifest, so the
// browser makes a handful of requests instead of thousands (perf plan phase 4, ~/docs/colony2d/PERF-PLAN.md).
//
//   node scripts/pack-atlas.mjs [--force]
//
// Output (git-ignored, regenerated): client/public/atlas/sheet-<n>.png and client/public/atlas/manifest.json
//   { sig, sheets: ["/atlas/sheet-0.png", ...], frames: { "/sprites/foo.png": [sheet, x, y, w, h], ... } }
// Rules:
//  - the frame key is the file's own URL, so client code asks for the same "/sprites/..." string as before;
//  - images larger than MAX_SIDE stay individual files (the client falls back to a normal load for any URL not in the manifest);
//  - every frame gets PAD px of edge-replicated border (nearest-neighbour sampling at fractional camera zoom would otherwise
//    bleed neighbouring sprites into the edges);
//  - a signature of the file list (path, size, mtime) is stored; an unchanged tree is a no-op.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./lib/png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPRITES = path.join(ROOT, "client/public/sprites");
const OUT = path.join(ROOT, "client/public/atlas");
const SHEET = 4096;
const PAD = 2;
const MAX_SIDE = 1024;
const force = process.argv.includes("--force");

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.toLowerCase().endsWith(".png")) out.push(p);
  }
  return out.sort();
}

const files = walk(SPRITES);
const sig = createHash("sha1")
  .update(files.map((f) => { const s = statSync(f); return `${f}:${s.size}:${Math.floor(s.mtimeMs)}`; }).join("\n") + `|${SHEET}|${PAD}|${MAX_SIDE}`)
  .digest("hex");
const manifestPath = path.join(OUT, "manifest.json");
if (!force && existsSync(manifestPath)) {
  try {
    if (JSON.parse(readFileSync(manifestPath, "utf8")).sig === sig) {
      console.log(`atlas up to date (${files.length} sprites)`);
      process.exit(0);
    }
  } catch { /* rebuild */ }
}

const t0 = Date.now();
const items = [];
let skipped = 0;
for (const f of files) {
  let img;
  try { img = decodePNG(readFileSync(f)); } catch (e) { console.warn(`skip ${f}: ${e.message}`); skipped++; continue; }
  if (img.w > MAX_SIDE || img.h > MAX_SIDE) { skipped++; continue; }
  items.push({ url: "/sprites/" + path.relative(SPRITES, f).split(path.sep).join("/"), img });
}
// Tall first, so each shelf is filled tightly.
items.sort((a, b) => b.img.h - a.img.h || b.img.w - a.img.w);

const sheets = [];
const newSheet = () => { const s = { data: new Uint8Array(SHEET * SHEET * 4), x: 0, y: 0, shelfH: 0, usedH: 0 }; sheets.push(s); return s; };
let cur = newSheet();
const frames = {};
for (const { url, img } of items) {
  const bw = img.w + PAD * 2;
  const bh = img.h + PAD * 2;
  if (cur.x + bw > SHEET) { cur.y += cur.shelfH; cur.x = 0; cur.shelfH = 0; }
  if (cur.y + bh > SHEET) { cur = newSheet(); }
  if (cur.shelfH === 0) cur.shelfH = bh;
  const ox = cur.x + PAD;
  const oy = cur.y + PAD;
  // Blit with an edge-replicated border.
  for (let y = -PAD; y < img.h + PAD; y++) {
    const sy = Math.min(img.h - 1, Math.max(0, y));
    for (let x = -PAD; x < img.w + PAD; x++) {
      const sx = Math.min(img.w - 1, Math.max(0, x));
      const s = (sy * img.w + sx) * 4;
      const d = ((oy + y) * SHEET + (ox + x)) * 4;
      cur.data[d] = img.data[s]; cur.data[d + 1] = img.data[s + 1]; cur.data[d + 2] = img.data[s + 2]; cur.data[d + 3] = img.data[s + 3];
    }
  }
  cur.x += bw;
  cur.usedH = Math.max(cur.usedH, cur.y + bh);
  frames[url] = [sheets.length - 1, ox, oy, img.w, img.h];
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const sheetUrls = [];
sheets.forEach((s, i) => {
  // Crop the empty bottom of the last sheet.
  const h = Math.min(SHEET, Math.max(1, s.usedH));
  writeFileSync(path.join(OUT, `sheet-${i}.png`), encodePNG({ w: SHEET, h, data: s.data.subarray(0, SHEET * h * 4) }));
  sheetUrls.push(`/atlas/sheet-${i}.png`);
});
writeFileSync(manifestPath, JSON.stringify({ sig, sheets: sheetUrls, frames }));
const kb = (f) => Math.round(statSync(path.join(OUT, f)).size / 1024);
console.log(`atlas: ${items.length} sprites -> ${sheets.length} sheet(s) (${sheetUrls.map((u, i) => kb(`sheet-${i}.png`) + " KB").join(", ")}), ${skipped} left as files, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
