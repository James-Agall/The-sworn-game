// Renderer equivalence (golden) test for the Rig tab.
//  1. Pixels: the Lab renderer (app/src/rig/render.ts + the built-in clips idle / walk / attack-sword) and the reference
//     client/public/rig/body.html render the same frames in the same headless Chromium through the same R.sheet() layout;
//     the PNGs must match (tolerance below). Covers several phases, a second walk loop, helm / shield variants.
//  2. Channels: body.html has no axe / spear / bow. Their clips come from client/public/rig/index.html's ATTACK tables, so
//     index.html's own drawn angles (recorded by wrapping Rig.limbAt / uprightAt) must equal the clip's channels, and its
//     off-hand IK (spear grip, bow hand, bow string) must equal the clip's IK rules solved with index.html's lengths.
// Results are printed and written to $LAB_SHOTS/rig-golden.json; diff images for any mismatch go there too.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startLab, type Lab } from "../server/lab.ts";
import { decodePNG, encodePNG, REPO_DIR } from "../server/png.ts";
import { scratchRoot } from "./helpers.ts";
import type { RigCore } from "../shared/clip.ts";

const SCRATCH = "/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad";
const PW_PKG = process.env.LAB_PLAYWRIGHT_PKG || "/home/james/projects/auto-loan-ff-release/package.json";
const CHROME = process.env.LAB_CHROME || `${SCRATCH}/pw-browsers/chromium-1234/chrome-linux64/chrome`;
const SHOTS = process.env.LAB_SHOTS || `${SCRATCH}/lab-shots`;
const PORT = 31862;
/** Strict: at most this many differing pixels per sheet, none differing by more than MAX_DELTA in any channel. */
const MAX_PIXELS = 0, MAX_DELTA = 0;

type Any = any;
let lab: Lab, root: string, browser: Any, lp: Any, bp: Any;
await import(pathToFileURL(path.join(REPO_DIR, "client/public/rig/rig-core.js")).href);
const R = (globalThis as unknown as { Rig: RigCore }).Rig;
const results: Record<string, unknown> = {};

before(async () => {
  assert.ok(existsSync(PW_PKG), `Playwright package not found at ${PW_PKG}`);
  assert.ok(existsSync(CHROME), `Chromium not found at ${CHROME}`);
  mkdirSync(SHOTS, { recursive: true });
  root = await scratchRoot({ sprites: true });
  lab = await startLab({ root, port: PORT, vite: true });
  const { chromium } = createRequire(PW_PKG)("playwright");
  browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  lp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await lp.goto(lab.url);
  await lp.waitForFunction(() => !!(window as Any).__labRig, null, { timeout: 30_000 });
  bp = await browser.newPage();
  await bp.goto(lab.url + "rig/body.html?parts=grounded-v2");
  await bp.waitForFunction(() => !!(window as Any).__rig?.sheet, null, { timeout: 30_000 });
});
after(async () => {
  writeFileSync(path.join(SHOTS, "rig-golden.json"), JSON.stringify(results, null, 1));
  await browser?.close();
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const png = (url: string) => decodePNG(Buffer.from(url.split(",")[1], "base64"));
function compare(name: string, a: { w: number; h: number; data: Uint8Array }, b: { w: number; h: number; data: Uint8Array }) {
  assert.equal(a.w, b.w, name + " width"); assert.equal(a.h, b.h, name + " height");
  let pixels = 0, maxDelta = 0;
  const diff = new Uint8Array(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.data[i + k] - b.data[i + k]));
    if (d) { pixels++; maxDelta = Math.max(maxDelta, d); diff.set([255, 0, 255, 255], i); } else diff.set([a.data[i] >> 2, a.data[i + 1] >> 2, a.data[i + 2] >> 2, 255], i);
  }
  if (pixels) writeFileSync(path.join(SHOTS, `golden-diff-${name}.png`), encodePNG({ w: a.w, h: a.h, data: diff }));
  return { pixels, maxDelta, total: a.w * a.h };
}

type Case = { name: string; clip: string; state: string; duration: number; times: number[]; look?: { helm?: number; shield?: number; hair?: number } };
async function goldenCase(c: Case) {
  const label = (t: number) => `${c.clip} t=${t.toFixed(3)}`;
  const look = { helm: 0, shield: 0, hair: 1, ...c.look };
  const lab = await lp.evaluate((spec: Any) => (window as Any).__labRig.sheet(spec), { frames: c.times.map((t) => ({ clip: c.clip, t, look: { ...look, weapon: "sword" }, label: label(t) })), cols: 4, scale: 1 });
  const ref = await bp.evaluate((spec: Any) => (window as Any).__rig.sheet(spec), { frames: c.times.map((t) => ({ cfg: { state: c.state, ...look }, t, label: label(t) })), cols: 4, scale: 1 });
  const r = compare(c.name, png(lab), png(ref));
  results[c.name] = { frames: c.times.length, ...r };
  writeFileSync(path.join(SHOTS, `golden-${c.name}.png`), Buffer.from(lab.split(",")[1], "base64"));
  return r;
}

const phases = (n: number, d: number) => Array.from({ length: n }, (_, i) => (i / n) * d);
const WALK = 1 / 1.15, IDLE = (2 * Math.PI) / 2.2, SWORD = 0.62;
const CASES: Case[] = [
  { name: "idle", clip: "idle", state: "idle", duration: IDLE, times: phases(8, IDLE) },
  { name: "idle-helm3", clip: "idle", state: "idle", duration: IDLE, times: [0.4, 3.1, 5.0], look: { helm: 3, shield: 1 } },
  { name: "walk", clip: "walk", state: "walk", duration: WALK, times: phases(8, WALK) },
  { name: "walk-loop2", clip: "walk", state: "walk", duration: WALK, times: [WALK + 0.05, 1.31, 1.9, 2.4] },
  { name: "walk-helm2-shield", clip: "walk", state: "walk", duration: WALK, times: phases(4, WALK), look: { helm: 2, shield: 1 } },
  { name: "walk-nohair", clip: "walk", state: "walk", duration: WALK, times: [0.1, 0.5], look: { hair: 0 } },
  { name: "attack-sword", clip: "attack-sword", state: "attack", duration: SWORD, times: [...phases(12, SWORD), SWORD] },
  { name: "attack-sword-trail", clip: "attack-sword", state: "attack", duration: SWORD, times: [0.32, 0.36, 0.4, 0.45, 0.47] },
  { name: "attack-sword-helm1-shield", clip: "attack-sword", state: "attack", duration: SWORD, times: phases(6, SWORD), look: { helm: 1, shield: 1 } },
];

test("pixels: the Lab renders idle / walk / sword attack exactly like body.html", { timeout: 120_000 }, async (t) => {
  for (const c of CASES) {
    const r = await goldenCase(c);
    t.diagnostic(`${c.name}: ${c.times.length} frames, ${r.pixels} of ${r.total} px differ, max channel delta ${r.maxDelta}`);
    assert.ok(r.pixels <= MAX_PIXELS && r.maxDelta <= MAX_DELTA, `${c.name}: ${r.pixels} px differ (max delta ${r.maxDelta}); see ${SHOTS}/golden-diff-${c.name}.png`);
  }
});

test("channels: axe / spear / bow clips equal index.html's ATTACK tables and off-hand IK", { timeout: 60_000 }, async (t) => {
  const ip = await browser.newPage();
  await ip.goto(lab.url + "rig/index.html");
  await ip.waitForFunction(() => !!(window as Any).__rig?.frame, null, { timeout: 30_000 });
  // record index.html's own draw calls for one frame
  const trace = (weapon: string, T: number) => ip.evaluate(([weapon, T]: [string, number]) => {
    const W = window as Any, Rg = W.Rig, calls: { k: string; x: number; y: number; a: number }[] = [];
    const L = Rg.limbAt, U = Rg.uprightAt;
    Rg.limbAt = (g: Any, p: Any, x: number, y: number, a: number) => { calls.push({ k: "L", x, y, a }); return L(g, p, x, y, a); };
    Rg.uprightAt = (g: Any, p: Any, x: number, y: number, a = 0) => { calls.push({ k: "U", x, y, a }); return U(g, p, x, y, a); };
    try { W.__rig.frame({ weapon, state: "attack", shield: 0, helm: 0, hair: 0, mounted: false, flip: false, speed: 1, build: 1, bones: false }, T); }
    finally { Rg.limbAt = L; Rg.uprightAt = U; }
    return calls;
  }, [weapon, T]);
  const IDX = { upper: 15, fore: 14 };
  const ikIdx = (T: number[]) => R.ik2([0, 0], T, IDX.upper, IDX.fore, -1);
  let worst = 0, n = 0;
  const eq = (a: number, b: number, what: string) => { const d = Math.abs(a - b); worst = Math.max(worst, d); n++; assert.ok(d < 1e-6, `${what}: index.html ${a} vs clip ${b}`); };
  for (const [weapon, dur] of [["axe", 0.8], ["spear", 0.66], ["bow", 1.2]] as const) {
    for (let i = 0; i <= 20; i++) {
      const u = i / 20, T = u * dur;
      const calls = await trace(weapon, T), ch = await lp.evaluate(([c, t]: [string, number]) => (window as Any).__labRig.channels(c, t), ["attack-" + weapon, T]);
      const torso = calls.find((c: Any) => c.k === "U")!, head = calls.filter((c: Any) => c.k === "U")[1];
      eq(torso.a, ch["spine.lean"], `${weapon} u=${u} lean`);
      eq(torso.x - 118, ch["root.x"], `${weapon} u=${u} lunge`);
      // the head tilt keys are lean * 0.4 (index.html); the clip adds body.html's idle wobble wave on top
      const wobble = Math.sin(T * 1.7) * 0.6;
      eq(head.a, ch["head.tilt"] - wobble, `${weapon} u=${u} head`);
      const Ls = calls.filter((c: Any) => c.k === "L");
      if (weapon === "axe") {
        const [ua, fe, w] = Ls.slice(-3);
        eq(ua.a, ch["armN.shoulder"], "axe ua"); eq(fe.a, ch["armN.shoulder"] + ch["armN.elbow"], "axe ua+fe"); eq(w.a, ch["armN.weapon"], "axe wa");
        eq(Ls[3].a, ch["armF.shoulder"], "axe uaF"); eq(Ls[4].a, ch["armF.shoulder"] + ch["armF.elbow"], "axe uaF+16");
      } else if (weapon === "spear") {
        const [ua, fe, w, foreF] = Ls.slice(-4);
        eq(ua.a, ch["armN.shoulder"], "spear ua"); eq(fe.a, ch["armN.shoulder"] + ch["armN.elbow"], "spear ua+fe"); eq(w.a, ch["armN.weapon"], "spear wa");
        // off hand: IK to the shaft 30 px from the weapon hand (clip limbs.armF = {ik, grip, along 30})
        const H = R.add(R.add([0, 0], R.dir(ch["armN.shoulder"]), IDX.upper), R.dir(ch["armN.shoulder"] + ch["armN.elbow"]), IDX.fore + 3);
        const k = ikIdx(R.add(H, R.dir(ch["armN.weapon"]), 30));
        eq(Ls[3].a, k.a1, "spear off-hand a1"); eq(Ls[4].a, k.a2, "spear off-hand a2"); eq(foreF.a, k.a2, "spear off-hand over the shaft");
      } else {
        // bow hand: IK to shoulder + (armF.ikX, armF.ikY); string hand: IK to lerp(bowHand - 4, shoulder + 3, draw)
        const bh = [ch["armF.ikX"], ch["armF.ikY"]], kF = ikIdx(bh);
        eq(Ls[3].a, kF.a1, "bow hand a1"); eq(Ls[4].a, kF.a2, "bow hand a2");
        const d = ch["weapon.draw"], kN = ikIdx([R.lerp(bh[0] - 4, 3, d), R.lerp(bh[1], 3, d)]);
        const near = Ls.slice(5);                                    // near thigh, shin, foot, then the string arm
        eq(near[3].a, kN.a1, `bow string arm a1 u=${u}`); eq(near[4].a, kN.a2, `bow string arm a2 u=${u}`);
      }
    }
  }
  results.channels = { comparisons: n, worstDifferenceDeg: worst };
  t.diagnostic(`axe / spear / bow: ${n} channel comparisons with index.html, worst difference ${worst.toExponential(2)}`);
  await ip.close();
});
