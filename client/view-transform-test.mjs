// Unit test (plain node, no server, no browser): the rotated/zoomed view maths in
// client/src/viewTransform.ts (world <-> screen round trips, panning vectors, culling bounds, depth order).
// Run: node client/view-transform-test.mjs   (node >= 22.18 strips the .ts types itself)
import {
  ROTATED_VIEW_ANGLE,
  ROTATED_VIEW_SCALE,
  cameraPosition,
  depthKey,
  rotateVector,
  screenRectToWorldQuad,
  screenToWorld,
  viewSettingsFor,
  visibleWorldBounds,
  worldToScreen,
} from "./src/viewTransform.ts";

let fails = 0;
let passes = 0;
const result = (ok, msg) => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const ANGLES = [0, Math.PI / 4, Math.PI / 2];
const ZOOMS = [1, 1.3, 1.95, 3];
const W = 1200;
const H = 800;

// Settings: rotated by default, Classic = the original view.
{
  const def = viewSettingsFor(null);
  result(def.angle === ROTATED_VIEW_ANGLE && def.scale === ROTATED_VIEW_SCALE, "unset pref -> rotated 45deg, 1.5x");
  const classic = viewSettingsFor("classic");
  result(classic.angle === 0 && classic.scale === 1, "classic pref -> angle 0, scale 1");
  result(viewSettingsFor("rotated").angle === Math.PI / 4, "rotated pref -> 45deg");
}

// Round trips at several angles / zooms / camera offsets.
for (const angle of ANGLES) {
  for (const zoom of ZOOMS) {
    const v = { angle, zoom, x: 123.5, y: -456.25 };
    let worst = 0;
    for (const [wx, wy] of [[0, 0], [100, 50], [-30, 777], [5120, 5120], [16.5, 3]]) {
      const s = worldToScreen(v, wx, wy);
      const back = screenToWorld(v, s.x, s.y);
      worst = Math.max(worst, Math.abs(back.x - wx), Math.abs(back.y - wy));
    }
    for (const [sx, sy] of [[0, 0], [W, H], [600, 400], [-50, 900]]) {
      const w = screenToWorld(v, sx, sy);
      const back = worldToScreen(v, w.x, w.y);
      worst = Math.max(worst, Math.abs(back.x - sx), Math.abs(back.y - sy));
    }
    result(worst < 1e-6, `round trip angle ${((angle * 180) / Math.PI).toFixed(0)} zoom ${zoom} (max err ${worst.toExponential(1)})`);
  }
}

// Classic (angle 0) is exactly the old maths: screen = pos + world * zoom.
{
  const v = { angle: 0, zoom: 1.3, x: 17, y: -9 };
  const s = worldToScreen(v, 100, 200);
  result(s.x === 17 + 100 * 1.3 && s.y === -9 + 200 * 1.3, "angle 0 worldToScreen == pos + w * zoom (exact)");
  const w = screenToWorld(v, 300, 400);
  result(w.x === (300 - 17) / 1.3 && w.y === (400 + 9) / 1.3, "angle 0 screenToWorld == (s - pos) / zoom (exact)");
}

// 45deg: world east (+x) shows down-right, world north (-y) shows up-right (a diamond grid).
{
  const v = { angle: Math.PI / 4, zoom: 1, x: 0, y: 0 };
  const e = worldToScreen(v, 1, 0);
  result(near(e.x, Math.SQRT1_2) && near(e.y, Math.SQRT1_2), "45deg: world east -> screen down-right");
  const n = worldToScreen(v, 0, -1);
  result(near(n.x, Math.SQRT1_2) && near(n.y, -Math.SQRT1_2), "45deg: world north -> screen up-right");
}

// rotateVector: identity at 0, length preserved, inverse by -angle, 90deg turns right->down.
{
  const r0 = rotateVector(0, 3, -4);
  result(r0.x === 3 && r0.y === -4, "rotateVector angle 0 is identity");
  const r90 = rotateVector(Math.PI / 2, 1, 0);
  result(near(r90.x, 0) && near(r90.y, 1), "rotateVector 90deg: right -> down");
  for (const angle of ANGLES) {
    const r = rotateVector(angle, 3, -4);
    const back = rotateVector(-angle, r.x, r.y);
    result(near(Math.hypot(r.x, r.y), 5) && near(back.x, 3) && near(back.y, -4), `rotateVector ${((angle * 180) / Math.PI).toFixed(0)}deg keeps length, -angle inverts`);
  }
  // Panning: the "W" key (screen up) moves the player in the world direction that shows as screen up.
  const angle = Math.PI / 4;
  const w = rotateVector(-angle, 0, -1);
  const v = { angle, zoom: 1.95, x: 0, y: 0 };
  const a = worldToScreen(v, 0, 0);
  const b = worldToScreen(v, w.x, w.y);
  result(near(b.x - a.x, 0) && b.y < a.y, "screen-up key -> world move that shows straight up on screen");
}

// Camera: the focus point lands on the screen centre.
for (const angle of ANGLES) {
  const zoom = 1.95;
  const pos = cameraPosition(angle, zoom, W / 2, H / 2, 2500, 1300);
  const s = worldToScreen({ angle, zoom, x: pos.x, y: pos.y }, 2500, 1300);
  result(near(s.x, W / 2) && near(s.y, H / 2), `cameraPosition centres the focus at ${((angle * 180) / Math.PI).toFixed(0)}deg`);
}

// Culling: the world bounding box of the screen rect contains every screen corner's world point (and
// points sampled along the screen edges), and is tight (each bound is touched by a corner).
for (const angle of ANGLES) {
  for (const zoom of [1.3, 1.95]) {
    const pos = cameraPosition(angle, zoom, W / 2, H / 2, 3000, 2000);
    const v = { angle, zoom, x: pos.x, y: pos.y };
    const b = visibleWorldBounds(v, 0, 0, W, H);
    let inside = true;
    for (let i = 0; i <= 10; i++) {
      for (const [sx, sy] of [[(W * i) / 10, 0], [(W * i) / 10, H], [0, (H * i) / 10], [W, (H * i) / 10]]) {
        const w = screenToWorld(v, sx, sy);
        if (w.x < b.minX - 1e-6 || w.x > b.maxX + 1e-6 || w.y < b.minY - 1e-6 || w.y > b.maxY + 1e-6) inside = false;
      }
    }
    const q = screenRectToWorldQuad(v, 0, 0, W, H);
    const tight =
      q.some((p) => near(p.x, b.minX)) && q.some((p) => near(p.x, b.maxX)) && q.some((p) => near(p.y, b.minY)) && q.some((p) => near(p.y, b.maxY));
    result(inside && tight, `visibleWorldBounds contains the screen rect at ${((angle * 180) / Math.PI).toFixed(0)}deg zoom ${zoom}`);
  }
  // Classic: exactly the old rectangle (-pos / zoom) .. ((screen - pos) / zoom).
  if (angle === 0) {
    const v = { angle: 0, zoom: 1.3, x: -400, y: -250 };
    const b = visibleWorldBounds(v, 0, 0, W, H);
    result(near(b.minX, 400 / 1.3) && near(b.maxX, (W + 400) / 1.3) && near(b.minY, 250 / 1.3) && near(b.maxY, (H + 250) / 1.3), "angle 0 bounds == old camera rectangle");
  }
}

// Depth: tiles sort by screen y (ties by screen x), neighbours >= 1 apart, Classic == row-major index.
{
  const N = 24;
  {
    let same = true;
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) if (depthKey(0, tx, ty, N) !== ty * N + tx) same = false;
    result(same, "depthKey angle 0 == row-major index");
  }
  for (const angle of ANGLES) {
    const v = { angle, zoom: 1, x: 0, y: 0 };
    const cells = [];
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) cells.push({ k: depthKey(angle, tx, ty, N), s: worldToScreen(v, tx, ty) });
    cells.sort((a, b) => a.k - b.k);
    let monotonic = true;
    let minGap = Infinity;
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      if (b.s.y < a.s.y - 1e-9) monotonic = false;
      if (near(b.s.y, a.s.y, 1e-9) && b.s.x < a.s.x - 1e-9) monotonic = false;
      minGap = Math.min(minGap, b.k - a.k);
    }
    const positive = cells[0].k >= 0;
    result(monotonic && minGap >= 1 - 1e-9 && positive, `depthKey ${((angle * 180) / Math.PI).toFixed(0)}deg monotonic with screen y (min gap ${minGap.toFixed(2)}, all >= 0)`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
if (fails > 0) process.exit(1);
