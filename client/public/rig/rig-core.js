/* rig-core.js: a small 2D skeletal-animation runtime for sprite-game characters (browser, no dependencies).
 *
 * Conventions (read SKILL.md before changing them):
 *  - Work at SOURCE resolution: for colony2d a person is ~98 px tall inside a 128 px frame; the game scales it down.
 *    Never author or judge at the on-screen size; judge with Rig.sheet() which shows both.
 *  - Angles are degrees measured from "straight down", positive toward FORWARD (+x, the way the character faces):
 *    0 = down, 90 = forward/horizontal, 180 = up, 270 = backward. Rig.dir(a) gives the unit vector (canvas y is down).
 *  - A "limb" part hangs down from its pivot (the joint) and is drawn rotated by -angle. An "upright" part (torso, head)
 *    points up from its pivot and is drawn rotated by +tilt (tilt forward = lean toward +x).
 *  - Everything is drawn facing right; mirror the whole character with Rig.facing(g, cx, left) for left.
 */
(function (root) {
  const R = {};
  const D = Math.PI / 180;
  R.D = D;
  R.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  R.lerp = (a, b, u) => a + (b - a) * u;
  R.smooth = (u) => u * u * (3 - 2 * u);
  R.easeIn = (u) => u * u * u;                    // slow start, fast end: the strike of an attack
  R.easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
  R.dir = (a) => [Math.sin(a * D), Math.cos(a * D)];
  R.rot = (x, y, a) => [x * Math.cos(a * D) - y * Math.sin(a * D), x * Math.sin(a * D) + y * Math.cos(a * D)];
  R.add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
  R.shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("");
  };

  // Keyframes: [[u, value, ease?], ...] with u in 0..1. Between keys it eases (default smoothstep; pass R.easeIn etc. as the 3rd
  // element of the TARGET key to change how it arrives there: anticipation slow / strike fast).
  R.kf = (keys, u) => {
    if (u <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const [u0, v0] = keys[i - 1], [u1, v1, ez] = keys[i];
        return R.lerp(v0, v1, (ez || R.smooth)((u - u0) / (u1 - u0)));
      }
    }
    return keys[keys.length - 1][1];
  };

  // Two-bone IK. S = root joint, T = target, l1 / l2 = bone lengths. bend +1 / -1 picks which side the middle joint
  // points to (human knee +1, elbow -1, horse fore knee +1, hind hock -1). Returns absolute bone angles and the joint.
  R.ik2 = (S, T, l1, l2, bend = -1) => {
    const dx = T[0] - S[0], dy = T[1] - S[1];
    const d = R.clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.05);
    const b = Math.atan2(dx, dy) / D;
    const al = Math.acos(R.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) / D;
    const a1 = b + bend * al, v = R.dir(a1), J = [S[0] + l1 * v[0], S[1] + l1 * v[1]];
    const a2 = Math.atan2(T[0] - J[0], T[1] - J[1]) / D, v2 = R.dir(a2);
    return { a1, a2, J, E: [J[0] + l2 * v2[0], J[1] + l2 * v2[1]] };
  };

  // ---------- painting parts ----------
  R.canvas = (w, h) => { const c = document.createElement("canvas"); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; };
  R.paint = (w, h, fn) => { const c = R.canvas(w, h), g = c.getContext("2d"); g.lineJoin = "round"; g.lineCap = "round"; fn(g, c); return c; };
  R.INK = "#241611";
  // Tapered round limb hanging down from its pivot: (len, w0 at the joint, w1 at the end). Outlined, shaded across its width
  // (light on the front / +x side, dark on the back) so it reads as a rounded form, not a flat bar.
  R.limb = (len, w0, w1, base, o = {}) => {
    const ink = o.ink || R.INK, lw = o.lw ?? 2, pad = Math.ceil(Math.max(w0, w1) / 2 + lw + 2);
    const cx = pad, W = pad * 2, H = len + pad * 2;
    const circles = (g, k, col) => { g.fillStyle = col; const n = Math.ceil(len * 1.5); for (let i = 0; i <= n; i++) { const t = i / n, r = (R.lerp(w0, w1, t) / 2) * k; g.beginPath(); g.arc(cx, pad + t * len, r, 0, 7); g.fill(); } };
    const c = R.paint(W, H, (g) => {
      const n = Math.ceil(len * 1.5);
      for (let i = 0; i <= n; i++) { const t = i / n, r = R.lerp(w0, w1, t) / 2 + lw; g.beginPath(); g.arc(cx, pad + t * len, r, 0, 7); g.fill(); }
      circles(g, 1, R.shade(base, 0.78));
      g.fillStyle = base; for (let i = 0; i <= n; i++) { const t = i / n, r = R.lerp(w0, w1, t) / 2; g.beginPath(); g.arc(cx + r * 0.22, pad + t * len, r * 0.72, 0, 7); g.fill(); }
      g.fillStyle = R.shade(base, 1.22); for (let i = 0; i <= n; i++) { const t = i / n, r = R.lerp(w0, w1, t) / 2; g.beginPath(); g.arc(cx + r * 0.42, pad + t * len, r * 0.28, 0, 7); g.fill(); }
      if (o.detail) o.detail(g, cx, pad, len);
    });
    return { c, px: cx, py: pad };
  };
  // Filled outlined polygon helper for hand-made shapes: pts in canvas px, with a flat fill and a lighter top-left highlight edge.
  R.shape = (g, pts, fill, o = {}) => {
    const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
    g.lineJoin = "round"; path(); g.lineWidth = (o.lw ?? 2) * 2; g.strokeStyle = o.ink || R.INK; g.stroke();
    path(); g.fillStyle = fill; g.fill();
    if (o.shadeBottom !== false) { g.save(); path(); g.clip(); const ys = pts.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys); const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, R.shade(fill, 1.18)); gr.addColorStop(0.55, "rgba(0,0,0,0)"); gr.addColorStop(1, R.shade(fill, 0.72)); g.fillStyle = gr; g.fillRect(0, y0, 1e4, y1 - y0 + 1); g.restore(); }
  };
  R.ellipse = (g, cx, cy, rx, ry, fill, o = {}) => {
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.lineWidth = (o.lw ?? 2) * 2; g.strokeStyle = o.ink || R.INK; g.stroke(); g.fillStyle = fill; g.fill();
    g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.clip();
    const gr = g.createLinearGradient(0, cy - ry, 0, cy + ry); gr.addColorStop(0, R.shade(fill, 1.2)); gr.addColorStop(0.6, "rgba(0,0,0,0)"); gr.addColorStop(1, R.shade(fill, 0.7)); g.fillStyle = gr; g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2); g.restore();
  };

  // ---------- drawing parts on the skeleton ----------
  // limb part: hangs from its pivot, swung forward by `angle` degrees
  R.limbAt = (g, part, x, y, angle) => { g.save(); g.translate(x, y); g.rotate(-angle * D); g.drawImage(part.c, -part.px, -part.py); g.restore(); };
  // upright part: tilted forward by `tilt` degrees about its pivot
  R.uprightAt = (g, part, x, y, tilt = 0) => { g.save(); g.translate(x, y); g.rotate(tilt * D); g.drawImage(part.c, -part.px, -part.py); g.restore(); };
  // run `fn` with the whole character mirrored about x = cx when `left`
  R.facing = (g, cx, left, fn) => { g.save(); if (left) { g.translate(cx, 0); g.scale(-1, 1); g.translate(-cx, 0); } fn(); g.restore(); };

  // ---------- locomotion ----------
  // Planted-foot walk. phase 0..1 per leg; returns the foot position relative to the hip's ground point: x along the
  // facing, lift (>=0) above the ground. Stance (half the cycle) slides back at ground speed, swing lifts and carries forward.
  R.foot = (phase, stride, lift, duty = 0.55) => {
    const p = ((phase % 1) + 1) % 1;
    if (p < duty) return { x: stride * (0.5 - p / duty), lift: 0, swing: false };
    const t = (p - duty) / (1 - duty);
    return { x: stride * (-0.5 + R.smooth(t)), lift: Math.sin(Math.PI * t) * lift, swing: true };
  };

  // ---------- review sheet ----------
  // frames: [{ canvas, label }]; draws each at `scale` with a label and, beside it, the same frame at the in-game size
  // (gameScale = onScreenBodyPx / sourceBodyPx, drawn nearest-neighbour like the game does) so both are judged at once.
  R.sheet = (frames, o = {}) => {
    const cols = o.cols || 4, scale = o.scale || 2, gs = o.gameScale || 0.255, pad = 6, lab = 16;
    const fw = frames[0].canvas.width, fh = frames[0].canvas.height;
    const cw = fw * scale + pad * 2, ch = fh * scale + lab + pad * 2, rows = Math.ceil(frames.length / cols);
    const sheet = R.canvas(cols * cw, rows * ch), g = sheet.getContext("2d");
    g.fillStyle = o.bg || "#6f8d4e"; g.fillRect(0, 0, sheet.width, sheet.height);
    frames.forEach((f, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      g.imageSmoothingEnabled = false;
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      g.drawImage(f.canvas, x + pad, y + pad + lab, fw * scale, fh * scale);
      g.fillStyle = "#fff"; g.font = "12px sans-serif"; g.fillText(f.label || String(i), x + pad, y + 13);
      // the same frame at the size the game draws it (nearest neighbour), top-right of the cell
      const gw = Math.max(1, Math.round(fw * gs)), gh = Math.max(1, Math.round(fh * gs));
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x + cw - gw - pad - 3, y + pad + lab, gw + 6, gh + 6);
      g.drawImage(f.canvas, x + cw - gw - pad, y + pad + lab + 3, gw, gh);
    });
    return sheet;
  };
  root.Rig = R;
})(typeof window !== "undefined" ? window : globalThis);
