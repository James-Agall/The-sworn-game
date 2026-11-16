// paint.mjs: a painter for the PAINTED sprite style used by colony2d (soft-shaded forms with a dark rim, ~1500 colours per
// sprite, anti-aliased edges), not limited-palette pixel art. Measure a style first with palette.mjs.
//
// How it works: everything is drawn at ss x resolution (default 4), each SHAPE is a mask + a MATERIAL. A shape is shaded from a rounded
// height map built from its own silhouette (distance to the edge -> a pillow-like bulge), lit from the upper left, with a dark rim
// along the edge, optional gradient, and low-amplitude mottling. The result is box-filtered down to 1x, so edges come out soft (alpha
// 0..255 by coverage) exactly like the existing art.
//
//   import { Canvas, M } from "./paint.mjs";
//   const c = new Canvas(48, 40);
//   c.shape({ ellipse: [24, 20, 14, 15] }, M.skin());                      // shape + material
//   c.shape({ poly: [[x, y], ...] }, { ...M.metal(), round: 4 });
//   c.flat({ line: [x0, y0, x1, y1, 1.2] }, "#ffffff", 0.7);               // thin highlight / seam, no shading
//   writePNG("piece.png", c.png());
//
// Shape specs (output px, floats ok): { poly:[[x,y]..] } { ellipse:[cx,cy,rx,ry,rotDeg?] } { capsule:[x0,y0,x1,y1,r0,r1] }
//   { rect:[x,y,w,h,cornerRadius?] } { line:[x0,y0,x1,y1,width] } { union:[spec..] } { sub:[spec, spec..] } (first minus the rest)
// Materials: see M. Fields: base, light, dark (colours), rimColor, rim (px of dark edge), round (px of bevel radius), contrast,
//   noise (mottling 0..0.1), gradient [topMul, bottomMul], light dir via c.light = [lx, ly].
import { writePNG } from "./png.mjs";

const hex2 = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1; };
const vnoise = (x, y, cell) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy, s = (t) => t * t * (3 - 2 * t); const a = hash(gx, gy), b = hash(gx + 1, gy), c = hash(gx, gy + 1), d = hash(gx + 1, gy + 1); return (a + (b - a) * s(fx)) + ((c + (d - c) * s(fx)) - (a + (b - a) * s(fx))) * s(fy); };

// colour helpers: a material from one base colour (light / dark derived by lightness steps, hue shifted warm / cool like the art)
export function ramp(base, o = {}) {
  const c = hex2(base), lighten = (k) => mix(c, [255, 244, 214], k), darken = (k) => mix(c, [24, 18, 40], k);
  const toHex = (v) => "#" + v.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, "0")).join("");
  return { base, light: toHex(lighten(o.lightK ?? 0.42)), dark: toHex(darken(o.darkK ?? 0.5)) };
}
const RIM = "#1a1414";            // measured: depth-0 rim of the hero art is #191414, depth-1 #2a211e
export const M = {
  // generic painted material from a base colour
  paint: (base, o = {}) => ({ ...ramp(base, o), rimColor: RIM, rim: 2.2, round: 5, contrast: 1.0, noise: 0.035, ...o }),
  skin: (base = "#e8b98d") => M.paint(base, { lightK: 0.38, darkK: 0.42, round: 7 }),
  cloth: (base = "#8a6a4a") => M.paint(base, { noise: 0.05, round: 4, contrast: 0.8 }),
  leather: (base = "#7a4a2c") => M.paint(base, { noise: 0.05, round: 3, contrast: 0.9 }),
  metal: (base = "#9aa3ad") => M.paint(base, { lightK: 0.6, darkK: 0.55, round: 5, contrast: 1.3, noise: 0.02 }),
  gold: (base = "#d9a83a") => M.paint(base, { lightK: 0.55, darkK: 0.5, round: 4, contrast: 1.2, noise: 0.02 }),
  wood: (base = "#8a5a30") => M.paint(base, { noise: 0.06, round: 3, contrast: 0.8 }),
  hair: (base = "#5a3a22") => M.paint(base, { noise: 0.07, round: 6, contrast: 1.1 }),
};

export class Canvas {
  constructor(w, h, { ss = 4, light = [-0.55, -0.6] } = {}) {
    this.w = w; this.h = h; this.ss = ss; this.W = w * ss; this.H = h * ss; this.light = light;
    this.px = new Float32Array(this.W * this.H * 4);                       // premultiplied-free RGBA at ss x
  }
  // ---- masks
  mask(spec) {
    const { W, H, ss } = this, m = new Uint8Array(W * H);
    if (spec.union) { for (const s of spec.union) { const mm = this.mask(s); for (let i = 0; i < m.length; i++) if (mm[i]) m[i] = 1; } return m; }
    if (spec.sub) { const base = this.mask(spec.sub[0]); m.set(base); for (const s of spec.sub.slice(1)) { const mm = this.mask(s); for (let i = 0; i < m.length; i++) if (mm[i]) m[i] = 0; } return m; }
    if (spec.poly) {
      const pts = spec.poly.map(([x, y]) => [x * ss, y * ss]);
      let y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
      for (let y = y0; y <= y1; y++) {
        const xs = [], yc = y + 0.5;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) m[y * W + x] = 1;
      }
      return m;
    }
    const each = (bx0, by0, bx1, by1, inside) => { for (let y = Math.max(0, Math.floor(by0)); y <= Math.min(H - 1, Math.ceil(by1)); y++) for (let x = Math.max(0, Math.floor(bx0)); x <= Math.min(W - 1, Math.ceil(bx1)); x++) if (inside(x + 0.5, y + 0.5)) m[y * W + x] = 1; };
    if (spec.ellipse) {
      const [cx, cy, rx, ry, rot = 0] = spec.ellipse, a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), R = Math.max(rx, ry) * ss;
      each(cx * ss - R, cy * ss - R, cx * ss + R, cy * ss + R, (x, y) => { const dx = x - cx * ss, dy = y - cy * ss, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; return (u / (rx * ss)) ** 2 + (v / (ry * ss)) ** 2 <= 1; });
    } else if (spec.capsule || spec.line) {
      const [x0, y0, x1, y1, r0, r1 = r0] = spec.capsule || [...spec.line.slice(0, 4), spec.line[4] / 2], vx = (x1 - x0) * ss, vy = (y1 - y0) * ss, L2 = vx * vx + vy * vy || 1, R = Math.max(r0, r1) * ss;
      each(Math.min(x0, x1) * ss - R, Math.min(y0, y1) * ss - R, Math.max(x0, x1) * ss + R, Math.max(y0, y1) * ss + R, (x, y) => { const t = clamp(((x - x0 * ss) * vx + (y - y0 * ss) * vy) / L2, 0, 1), px = x0 * ss + vx * t, py = y0 * ss + vy * t; return Math.hypot(x - px, y - py) <= (r0 + (r1 - r0) * t) * ss; });
    } else if (spec.rect) {
      const [x, y, w, h, r = 0] = spec.rect, X0 = x * ss, Y0 = y * ss, X1 = (x + w) * ss, Y1 = (y + h) * ss, rr = r * ss;
      each(X0, Y0, X1, Y1, (px, py) => { if (px < X0 || px > X1 || py < Y0 || py > Y1) return false; const dx = Math.max(X0 + rr - px, 0, px - (X1 - rr)), dy = Math.max(Y0 + rr - py, 0, py - (Y1 - rr)); return dx * dx + dy * dy <= rr * rr; });
    } else throw new Error("unknown shape " + JSON.stringify(spec));
    return m;
  }
  // chamfer distance from each inside px to the nearest outside px (hi-res px)
  dist(m) {
    const { W, H } = this, d = new Float32Array(W * H), INF = 1e6;
    for (let i = 0; i < d.length; i++) d[i] = m[i] ? INF : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!m[i]) continue; let v = d[i]; if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1.414); } d[i] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!m[i]) continue; let v = d[i]; if (x < W - 1) v = Math.min(v, d[i + 1] + 1); if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, d[i + W - 1] + 1.414); } d[i] = v; }
    return d;
  }
  // a shaded shape
  shape(spec, mat) {
    const { W, H, ss } = this, m = this.mask(spec), d = this.dist(m), R = (mat.round ?? 5) * ss, rimW = (mat.rim ?? 1.5) * ss, mm = Object.assign({}, M.paint(mat.base), mat);
    const base = hex2(mm.base), lite = hex2(mm.light), dark = hex2(mm.dark), rimC = hex2(mm.rimColor), [lx, ly] = this.light, lz = 0.6, ln = Math.hypot(lx, ly, lz), L = [lx / ln, ly / ln, lz / ln];
    let y0 = H, y1 = -1; for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) if (m[y * W + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); break; } }
    for (let y = Math.max(1, y0); y <= Math.min(H - 2, y1); y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (!m[i]) continue;
      const t = clamp(d[i] / R, 0, 1);
      // surface normal of a rounded bulge: slope falls off from the edge to the plateau; direction = gradient of the distance field
      const gx = d[i + 1] - d[i - 1], gy = d[i + W] - d[i - W], gl = Math.hypot(gx, gy) || 1, slope = (1 - t) ** 1.2 * (mm.contrast ?? 1) * 1.6;
      const nx = (-gx / gl) * slope, ny = (-gy / gl) * slope, nz = 1;       // the bulge tilts OUTWARD at its edge (grad d points inward)
      const lam = (nx * L[0] + ny * L[1] + nz * L[2]) / Math.hypot(nx, ny, nz);
      let s = clamp(0.5 + (lam - 0.55) * 1.7, 0, 1);
      let col = s < 0.5 ? mix(dark, base, s * 2) : mix(base, lite, (s - 0.5) * 2);
      if (mm.noise) { const n = hash(x, y) * 0.5 + vnoise(x, y, 3 * ss) * 0.5; col = col.map((c) => c * (1 + n * mm.noise * 2)); }
      const q = d[i] / rimW, e = q < 0.5 ? 1 : clamp(1 - (q - 0.5) / 0.5, 0, 1) ** 1.2;   // dark rim along the silhouette: solid, then a soft step into the body
      if (e > 0) col = mix(col, rimC, e * (mm.rimStrength ?? 1));
      const o = i * 4; this.px[o] = col[0]; this.px[o + 1] = col[1]; this.px[o + 2] = col[2]; this.px[o + 3] = 1;
    }
    return this;
  }
  // flat colour (highlights, seams, stitching, eye whites): no shading, optional alpha
  flat(spec, colour, alpha = 1) {
    const m = this.mask(spec), c = hex2(colour); const { W, H } = this;
    for (let i = 0; i < W * H; i++) if (m[i]) { const o = i * 4, a = this.px[o + 3] * (1 - alpha) ; this.px[o] = this.px[o] * a + c[0] * alpha; this.px[o + 1] = this.px[o + 1] * a + c[1] * alpha; this.px[o + 2] = this.px[o + 2] * a + c[2] * alpha; this.px[o + 3] = Math.max(this.px[o + 3], alpha); }
    return this;
  }
  // box-filter down to 1x: edge pixels get partial alpha (coverage), like the game's art
  png() {
    const { w, h, ss, W } = this, out = new Uint8Array(w * h * 4), n = ss * ss;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) { const o = ((y * ss + sy) * W + x * ss + sx) * 4, al = this.px[o + 3]; r += this.px[o] * al; g += this.px[o + 1] * al; b += this.px[o + 2] * al; a += al; }
      const o = (y * w + x) * 4; if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / n) * 255); }
    }
    return { w, h, data: out };
  }
  save(path) { writePNG(path, this.png()); return path; }
}
