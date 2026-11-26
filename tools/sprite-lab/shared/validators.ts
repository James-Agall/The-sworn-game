// Validators v1 for a part set. Pure functions on already-decoded images, so the same code runs in the CLI
// (cli/validate.ts), the server (/api/validate) and the tests. Thresholds were tuned on grounded-v2 (2026-11-26);
// tools/sprite-making/validate.mjs was the starting point for the rim / richness / stray heuristics.
import type { Manifest } from "./manifest.ts";
import { boneDir, familyOf, isPartName, isPngName, NON_PART_PNGS, OVERLAY_FAMILIES, variantOf } from "./names.ts";

export type Img = { w: number; h: number; data: Uint8Array | Uint8ClampedArray };
export type Level = "pass" | "warn" | "fail";
export type Finding = { level: Exclude<Level, "pass">; part?: string; message: string };
export type CheckResult = { id: string; title: string; level: Level; findings: Finding[] };
export type Report = { set: string; level: Level; checks: CheckResult[]; counts: Record<Level, number> };
export type SetInput = {
  set: string;
  manifest: Manifest;
  /** every file name in the set folder */
  files: string[];
  /** decoded PNGs by file name; a string is a decode error */
  images: Record<string, Img | string>;
};

export const LIMITS = {
  rimMaxLuma: 75,        // mean luminance of the outer solid ring; game art ~25-45, grounded-v2 parts 20-60
  rimFailLuma: 130,      // a pale cut-out edge
  minRichness: 40,       // distinct colours per 1000 solid px; flat fills look foreign (painted art is far richer)
  maxSpecks: 0,          // faint pixels (alpha < 128) not touching any solid pixel
  familyScaleSpread: 1.3,
  rimColour: [0x19, 0x14, 0x14] as const,
};

const luma = (d: Img["data"], i: number) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
const alphaAt = (im: Img, x: number, y: number) => (x < 0 || y < 0 || x >= im.w || y >= im.h ? 0 : im.data[(y * im.w + x) * 4 + 3]);

/** Pixel statistics used by several checks (exported for the Compare tab and the tests). */
export function imageStats(im: Img) {
  let solid = 0, borderOpaque = 0, specks = 0, rimN = 0, rimSum = 0, rimDark = 0, bx0 = im.w, by0 = im.h, bx1 = -1, by1 = -1;
  const cols = new Set<number>();
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4, a = im.data[i + 3];
    if (!a) continue;
    if ((x === 0 || y === 0 || x === im.w - 1 || y === im.h - 1) && a >= 16) borderOpaque++;
    if (a >= 128) {
      solid++;
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
      cols.add(((im.data[i] >> 2) << 12) | ((im.data[i + 1] >> 2) << 6) | (im.data[i + 2] >> 2));
      if (alphaAt(im, x - 1, y) < 64 || alphaAt(im, x + 1, y) < 64 || alphaAt(im, x, y - 1) < 64 || alphaAt(im, x, y + 1) < 64) {
        const l = luma(im.data, i); rimN++; rimSum += l; if (l < 60) rimDark++;
      }
    } else {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && alphaAt(im, x + dx, y + dy) >= 128) { near = true; break; }
      if (!near) specks++;
    }
  }
  return {
    solid, borderOpaque, specks, colours: cols.size,
    richness: solid ? cols.size / (solid / 1000) : 0,
    rimLuma: rimN ? rimSum / rimN : 0, rimDarkShare: rimN ? rimDark / rimN : 0,
    bbox: bx1 < 0 ? null : { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 },
  };
}

export function validateSet(input: SetInput): Report {
  const { manifest, set } = input, parts = Object.entries(manifest.parts || {});
  const files = new Set(input.files), checks: CheckResult[] = [];
  const add = (id: string, title: string, findings: Finding[]) => checks.push({
    id, title, findings, level: findings.some((f) => f.level === "fail") ? "fail" : findings.length ? "warn" : "pass",
  });
  const img = (file: string): Img | null => { const v = input.images[file]; return v && typeof v !== "string" ? v : null; };

  // 1. every part has a manifest entry and a PNG
  const f1: Finding[] = [];
  for (const [name, p] of parts) {
    if (!files.has(p.file)) f1.push({ level: "fail", part: name, message: `PNG ${p.file} is missing` });
    else if (typeof input.images[p.file] === "string") f1.push({ level: "fail", part: name, message: `PNG ${p.file} does not decode: ${input.images[p.file]}` });
  }
  const used = new Set(parts.map(([, p]) => p.file));
  for (const f of input.files) if (f.endsWith(".png") && !NON_PART_PNGS.has(f) && !used.has(f)) f1.push({ level: "warn", message: `${f} has no manifest entry` });
  add("entries", "Every part has a manifest entry and a PNG", f1);

  // 2. naming rules
  const f2: Finding[] = [];
  if (manifest.set !== undefined && manifest.set !== set) f2.push({ level: "warn", message: `manifest "set" is ${JSON.stringify(manifest.set)}, folder is ${set}` });
  for (const [name, p] of parts) {
    if (!isPartName(name)) f2.push({ level: "fail", part: name, message: "part name breaks the naming rule family[.variant]" });
    if (!isPngName(p.file)) f2.push({ level: "fail", part: name, message: `file name ${JSON.stringify(p.file)} breaks the naming rule` });
    if (name.includes(".") && p.variant !== undefined && p.variant !== "" && p.variant !== variantOf(name)) f2.push({ level: "warn", part: name, message: `variant "${p.variant}" differs from the name's "${variantOf(name)}"` });
  }
  add("names", "Naming rules", f2);

  // 3. size / scale consistent with the manifest
  const f3: Finding[] = [], famScale = new Map<string, number[]>();
  for (const [name, p] of parts) {
    const im = img(p.file);
    if (im && p.size && (p.size[0] !== im.w || p.size[1] !== im.h)) f3.push({ level: "fail", part: name, message: `manifest size ${p.size.join("x")} but PNG is ${im.w}x${im.h}` });
    if (im && !p.size) f3.push({ level: "warn", part: name, message: "no size in the manifest" });
    if (p.scale !== undefined) {
      if (!(p.scale > 0 && p.scale <= 4)) f3.push({ level: "fail", part: name, message: `scale ${p.scale} out of range (0, 4]` });
      else { const fam = familyOf(name); famScale.set(fam, [...(famScale.get(fam) || []), p.scale]); }
    }
  }
  for (const [fam, s] of famScale) {
    const lo = Math.min(...s), hi = Math.max(...s);
    if (hi / lo > LIMITS.familyScaleSpread) f3.push({ level: "warn", part: fam, message: `scales in family ${fam} range ${lo}..${hi}` });
  }
  add("size", "Size and scale match the manifest", f3);

  // 4. pivot inside the image (and the bone end not far outside)
  const f4: Finding[] = [];
  for (const [name, p] of parts) {
    const im = img(p.file), w = im?.w ?? p.size?.[0], h = im?.h ?? p.size?.[1];
    if (w == null || h == null) continue;
    const [px, py] = p.pivot, outside = px < 0 || py < 0 || px > w || py > h, endY = py + boneDir(name) * (p.len || 0);
    if (outside && OVERLAY_FAMILIES.has(familyOf(name))) {
      // overlays (hair, helm) hang on the head's neck point below them; only a pivot far away is suspicious
      if (px < -w || px > 2 * w || py < -h || py > 2 * h) f4.push({ level: "warn", part: name, message: `overlay anchor ${px},${py} is far from the ${w}x${h} image` });
    } else if (outside) f4.push({ level: "fail", part: name, message: `pivot ${px},${py} outside the ${w}x${h} image` });
    else if (p.len && (endY > h + 4 || endY < -4)) f4.push({ level: "warn", part: name, message: `bone end y=${endY} is outside the image (len ${p.len})` });
  }
  add("pivot", "Pivot inside the image", f4);

  // 5-8. pixel checks
  const f5: Finding[] = [], f6: Finding[] = [], f7: Finding[] = [], f8: Finding[] = [];
  const seen = new Set<string>();
  for (const [name, p] of parts) {
    const im = img(p.file);
    if (!im || seen.has(p.file)) continue;
    seen.add(p.file);
    const s = imageStats(im);
    if (!s.solid) { f6.push({ level: "fail", part: name, message: "image has no solid pixels" }); continue; }
    if (s.borderOpaque) f5.push({ level: "warn", part: name, message: `${s.borderOpaque} visible pixel(s) on the outer edge (no transparent border)` });
    if (s.rimLuma > LIMITS.rimFailLuma) f6.push({ level: "fail", part: name, message: `pale rim: outer ring luminance ${s.rimLuma.toFixed(0)} (game art 25-45, rim colour #191414)` });
    else if (s.rimLuma > LIMITS.rimMaxLuma) f6.push({ level: "warn", part: name, message: `light rim: outer ring luminance ${s.rimLuma.toFixed(0)}, ${(s.rimDarkShare * 100).toFixed(0)}% dark` });
    if (s.solid >= 60 && s.richness < LIMITS.minRichness) f7.push({ level: "warn", part: name, message: `only ${s.colours} colours (${s.richness.toFixed(0)} per 1000 px): looks flat next to the painted art` });
    if (s.specks > LIMITS.maxSpecks) f8.push({ level: "warn", part: name, message: `${s.specks} faint noise speck(s) not touching the sprite` });
  }
  add("border", "Transparent border", f5);
  add("rim", "Dark rim on the outer edge", f6);
  add("palette", "Palette size sanity", f7);
  add("specks", "No semi-transparent noise specks", f8);

  const counts = { pass: 0, warn: 0, fail: 0 } as Record<Level, number>;
  for (const c of checks) counts[c.level]++;
  return { set, checks, counts, level: counts.fail ? "fail" : counts.warn ? "warn" : "pass" };
}

export function formatReport(r: Report): string {
  const out = [`Sprite Lab validators: set ${r.set}: ${r.level.toUpperCase()} (${r.counts.pass} pass, ${r.counts.warn} warn, ${r.counts.fail} fail)`];
  for (const c of r.checks) {
    out.push(`  [${c.level.toUpperCase()}] ${c.title}`);
    for (const f of c.findings.slice(0, 40)) out.push(`      ${f.level}: ${f.part ? f.part + ": " : ""}${f.message}`);
    if (c.findings.length > 40) out.push(`      ... ${c.findings.length - 40} more`);
  }
  return out.join("\n");
}
