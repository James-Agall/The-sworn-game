// Unit test (plain node, no server, no browser): the off-screen fight arrows' placement maths in
// client/src/fightArrows.ts (viewport-rim clamping, rotation, compass names, fade).
// Run: node client/fight-arrows-test.mjs   (node >= 22.18 strips the .ts types itself)
import { placeEdgeArrow, compassDirection, fightArrowAlpha } from "./src/fightArrows.ts";

let fails = 0;
let passes = 0;
const result = (ok, msg) => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const deg = (r) => (r * 180) / Math.PI;

const W = 1200;
const H = 800;
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const IN = { top: 60, right: 30, bottom: 40, left: 30 };

// On screen: no arrow.
for (const [x, y] of [[600, 400], [0, 0], [W, H], [1, 799]]) {
  result(placeEdgeArrow(W, H, x, y, IN).onScreen === true, `on-screen point (${x},${y}) -> onScreen`);
}
for (const [x, y] of [[-1, 400], [W + 1, 400], [600, -1], [600, H + 1]]) {
  result(placeEdgeArrow(W, H, x, y, IN).onScreen === false, `off-screen point (${x},${y}) -> arrow`);
}

// Straight off each edge (no insets): arrow on that edge's midpoint, pointing outwards.
{
  const e = placeEdgeArrow(W, H, 5000, 400, ZERO);
  result(near(e.x, W) && near(e.y, 400) && near(e.angle, 0), `east target -> (${e.x},${e.y}) angle ${deg(e.angle)}`);
  const w = placeEdgeArrow(W, H, -5000, 400, ZERO);
  result(near(w.x, 0) && near(w.y, 400) && near(Math.abs(w.angle), Math.PI), `west target -> (${w.x},${w.y}) angle ${deg(w.angle)}`);
  const n = placeEdgeArrow(W, H, 600, -5000, ZERO);
  result(near(n.x, 600) && near(n.y, 0) && near(n.angle, -Math.PI / 2), `north target -> (${n.x},${n.y}) angle ${deg(n.angle)}`);
  const s = placeEdgeArrow(W, H, 600, 9000, ZERO);
  result(near(s.x, 600) && near(s.y, H) && near(s.angle, Math.PI / 2), `south target -> (${s.x},${s.y}) angle ${deg(s.angle)}`);
}

// Diagonals: the ray from the centre hits whichever edge comes first; the point stays on the ray.
{
  const p = placeEdgeArrow(W, H, 600 + 1000, 400 - 1000, ZERO); // 45 deg up-right: top edge (H/2 < W/2)
  result(near(p.y, 0) && near(p.x, 600 + 400) && near(p.angle, -Math.PI / 4), `NE 45deg target clamps to the top edge at x=${p.x}`);
  const q = placeEdgeArrow(W, H, 600 + 3000, 400 + 500, ZERO); // shallow: right edge
  result(near(q.x, W) && near(q.y, 400 + 500 * (600 / 3000)), `shallow ESE target clamps to the right edge at y=${q.y.toFixed(1)}`);
}

// Insets: arrows stay inside the inset rectangle, on its border, for targets all round the screen.
{
  let inside = true;
  let onBorder = true;
  let onRay = true;
  for (let a = 0; a < 360; a += 7.5) {
    const r = (a * Math.PI) / 180;
    const sx = 600 + Math.cos(r) * 5000;
    const sy = 400 + Math.sin(r) * 5000;
    const p = placeEdgeArrow(W, H, sx, sy, IN);
    const L = IN.left, R = W - IN.right, T = IN.top, B = H - IN.bottom;
    if (p.x < L - 1e-6 || p.x > R + 1e-6 || p.y < T - 1e-6 || p.y > B + 1e-6) inside = false;
    if (!(near(p.x, L) || near(p.x, R) || near(p.y, T) || near(p.y, B))) onBorder = false;
    // Angle points from the arrow's rectangle centre to the target.
    const cx = (L + R) / 2, cy = (T + B) / 2;
    if (!near(p.angle, Math.atan2(sy - cy, sx - cx))) onRay = false;
  }
  result(inside, "insets: every arrow inside the inset rim");
  result(onBorder, "insets: every arrow on the inset rim's border");
  result(onRay, "insets: every arrow's angle points at its target");
}

// A target just off-screen but inside the inset band still gets an arrow, clamped no further than the target.
{
  const p = placeEdgeArrow(W, H, W + 5, 400, IN);
  result(!p.onScreen && p.x <= W - IN.right + 1e-6, `just off the right edge -> arrow at x=${p.x} (rim ${W - IN.right})`);
}

// Degenerate insets bigger than the viewport don't produce NaN.
{
  const p = placeEdgeArrow(100, 80, -500, -500, { top: 200, right: 200, bottom: 200, left: 200 });
  result(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle), `oversized insets stay finite (${p.x},${p.y})`);
}

// Compass names (screen y down).
const dirs = [
  [[0, -1], "north"], [[1, -1], "north-east"], [[1, 0], "east"], [[1, 1], "south-east"],
  [[0, 1], "south"], [[-1, 1], "south-west"], [[-1, 0], "west"], [[-1, -1], "north-west"],
  [[10, -1], "east"], [[-1, -10], "north"], [[0, 0], "here"],
];
for (const [[dx, dy], want] of dirs) {
  const got = compassDirection(dx, dy);
  result(got === want, `compassDirection(${dx},${dy}) = ${got} (want ${want})`);
}

// Fade.
result(fightArrowAlpha(0, 3, 0, 500) === 1, "alpha 1 while blows are landing");
result(near(fightArrowAlpha(2.5, 3, 0, 500), 0.5), "alpha eases during the last second of the window");
result(fightArrowAlpha(3, 3, 0, 500) === 0.25, "alpha floors at 0.25 while the server still lists it");
result(near(fightArrowAlpha(0, 3, 250, 500), 0.5), "alpha halves halfway through the client fade-out");
result(fightArrowAlpha(0, 3, 600, 500) === 0, "alpha 0 once the fade-out is over");

console.log(fails === 0 ? `\nALL PASS (${passes})` : `\n${fails} FAILURE(S), ${passes} passed`);
process.exit(fails === 0 ? 0 : 1);
