// Clip format + maths: schema validation (good / bad), unknown fields preserved, keyframe interpolation and easing,
// loop wrap, waves, IK sanity, pose solving (planted feet, shield pose, spear grip, bow string). rig-core.js is LOADED
// from the repo (the same file the browser uses), never copied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_DIR } from "./helpers.ts";
import { CHANNELS, formatClip, keysAt, newClip, phaseAt, sampleClip, validateClip, validateSkeleton, waveAt, channelAt, type Clip, type RigCore, type Skeleton } from "../shared/clip.ts";
import { poseAt, solvePose, type Dims } from "../shared/pose.ts";

await import(pathToFileURL(path.join(REPO_DIR, "client/public/rig/rig-core.js")).href);
const R = (globalThis as unknown as { Rig: RigCore }).Rig;
const CLIPS = path.join(REPO_DIR, "client/public/rig/clips");
const skel: Skeleton = JSON.parse(await readFile(path.join(REPO_DIR, "client/public/rig/skeletons/human.json"), "utf8"));
const loadClip = async (n: string): Promise<Clip> => JSON.parse(await readFile(path.join(CLIPS, n + ".json"), "utf8"));
const dims: Dims = { thigh: 14, shin: 14, upperArm: 13, foreArm: 16, sole: 10, weaponLen: 40 };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("the skeleton and every built-in clip validate; built-ins are marked read-only", async () => {
  assert.deepEqual(validateSkeleton(skel), []);
  const names = (await readdir(CLIPS)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(names, ["attack-axe", "attack-bow", "attack-spear", "attack-sword", "idle", "walk"]);
  for (const n of names) {
    const c = await loadClip(n);
    assert.deepEqual(validateClip(c, n), [], n);
    assert.equal(c.builtin, true, n);
    assert.equal(await readFile(path.join(CLIPS, n + ".json"), "utf8"), formatClip(c), `${n}.json is in the canonical format`);
  }
});

test("validation refuses bad clips with a readable reason", () => {
  const good = newClip("demo");
  assert.deepEqual(validateClip(good, "demo"), []);
  const bad = (patch: Record<string, unknown>, re: RegExp) => {
    const errs = validateClip({ ...good, ...patch }, "demo");
    assert.ok(errs.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(errs)}`);
  };
  bad({ format: "x" }, /format/);
  bad({ name: "Bad Name" }, /name must match/);
  bad({ name: "other" }, /does not match the file name/);
  bad({ loop: "yes" }, /loop/);
  bad({ duration: 0 }, /duration/);
  bad({ fps: 500 }, /fps/);
  bad({ phases: 1.5 }, /phases/);
  bad({ tracks: { "arm.shoulder": { keys: [{ u: 0, v: 1 }] } } }, /unknown channel/);
  bad({ tracks: { "spine.lean": { keys: [{ u: 0.5, v: 1 }, { u: 0.5, v: 2 }] } } }, /greater than the previous/);
  bad({ tracks: { "spine.lean": { keys: [{ u: 1.5, v: 1 }] } } }, /u must be 0\.\.1/);
  bad({ tracks: { "spine.lean": { keys: [{ u: 0, v: "1" }] } } }, /finite number/);
  bad({ tracks: { "spine.lean": { keys: [{ u: 0, v: 1, ease: "bounce" }] } } }, /ease must be one of/);
  bad({ tracks: { "spine.lean": { keys: [] } } }, /no keys and no waves/);
  bad({ tracks: { "root.y": { keys: [], waves: [{ fn: "tan", amp: 1, rate: 1, per: "cycle" }] } } }, /fn must be/);
  bad({ limbs: { tail: { mode: "fk" } } }, /unknown limb/);
  bad({ limbs: { armN: { mode: "ik", target: "grip" } } }, /far \(off-hand\) arm/);
  bad({ limbs: { armF: { mode: "fk", gait: { stride: 1, lift: 1, duty: 0.5, phase: 0 } } } }, /gait is for legs/);
  bad({ limbs: { legN: { mode: "ik", gait: { stride: 1, lift: 1, duty: 1.5, phase: 0 } } } }, /duty/);
  bad({ weapon: { kind: "mace" } }, /weapon.kind/);
  bad({ weapon: { trail: { from: 0.8, to: 0.2 } } }, /trail/);
  bad({ events: [{ u: 2, type: "contact" }] }, /events\[0\]/);
  assert.deepEqual(validateClip([]), ["a clip must be a JSON object"]);
});

test("unknown fields are allowed and survive a format round trip in place", () => {
  const c = { ...newClip("demo"), futureField: { a: [1, 2] }, tracks: { "spine.lean": { keys: [{ u: 0, v: 1, x_note: "keep" }], custom: true } } } as unknown as Clip;
  assert.deepEqual(validateClip(c, "demo"), []);
  const back = JSON.parse(formatClip(c));
  assert.deepEqual(back, JSON.parse(JSON.stringify(c)));
  assert.deepEqual(Object.keys(back), Object.keys(c), "key order kept");
});

test("interpolation uses rig-core's kf: smooth by default, ease on the target key, clamped one-shots", () => {
  const ks = [{ u: 0, v: 0 }, { u: 0.5, v: 10 }, { u: 1, v: 0 }];
  near(keysAt(R, ks, 0.25, false), R.kf([[0, 0], [0.5, 10], [1, 0]], 0.25));
  near(keysAt(R, ks, 0.25, false), 5);                                       // smoothstep(0.5) = 0.5
  near(keysAt(R, ks, 0.1, false), 10 * R.smooth(0.2));
  near(keysAt(R, [{ u: 0, v: 0 }, { u: 1, v: 10, ease: "linear" }], 0.3, false), 3);
  near(keysAt(R, [{ u: 0, v: 0 }, { u: 1, v: 10, ease: "easeIn" }], 0.5, false), 10 * 0.125);
  near(keysAt(R, [{ u: 0, v: 0 }, { u: 1, v: 10, ease: "easeOut" }], 0.5, false), 10 * (1 - 0.125));
  near(keysAt(R, [{ u: 0, v: 0 }, { u: 1, v: 10, ease: "step" }], 0.99, false), 0);
  near(keysAt(R, [{ u: 0.2, v: 4 }, { u: 0.8, v: 8 }], 0.05, false), 4);     // before the first key: hold
  near(keysAt(R, [{ u: 0.2, v: 4 }, { u: 0.8, v: 8 }], 0.95, false), 8);
  near(keysAt(R, [{ u: 0.5, v: 7 }], 0.1, true), 7);                         // a single key is a constant
});

test("loops interpolate across the seam (wrap) and phaseAt wraps / clamps", () => {
  const ks = [{ u: 0.25, v: 0 }, { u: 0.75, v: 10, ease: "linear" as const }];
  // seam segment: from (0.75, 10) to (1.25, 0) with the first key's ease (smooth)
  near(keysAt(R, ks, 0.0, true), R.lerp(10, 0, R.smooth(0.5)));
  near(keysAt(R, ks, 1.0, true), keysAt(R, ks, 0.0, true));
  near(keysAt(R, ks, 0.9, true), R.lerp(10, 0, R.smooth(0.3)));
  near(keysAt(R, ks, 0.1, true), R.lerp(10, 0, R.smooth(0.7)));
  near(keysAt(R, ks, 0.5, true), 5);
  near(phaseAt({ loop: true, duration: 2 }, 5), 0.5);
  near(phaseAt({ loop: true, duration: 2 }, -1), 0.5);
  near(phaseAt({ loop: false, duration: 2 }, 5), 1);
  near(phaseAt({ loop: false, duration: 2 }, -1), 0);
});

test("waves: per cycle runs on unwrapped loops, per second on seconds; added to keys; no track = rest", () => {
  near(waveAt({ fn: "sin", amp: 2, rate: Math.PI / 2, per: "cycle" }, 1, 1), 2);
  near(waveAt({ fn: "abscos", amp: -2.5, rate: Math.PI, per: "cycle" }, 1, 1), -2.5);
  near(waveAt({ fn: "sin", amp: 0.5, rate: 2.2, per: "second" }, 3, 99), Math.sin(3 * 2.2) * 0.5);
  near(waveAt({ fn: "cos", amp: 1, rate: 1, per: "second", phase: Math.PI }, 0, 1), -1);
  const c = newClip("w", { tracks: { "armN.shoulder": { keys: [{ u: 0, v: 14 }], waves: [{ fn: "sin", amp: 5, rate: 6.283, per: "cycle" }] } } });
  near(channelAt(R, c, skel, "armN.shoulder", 0.3), 14 + Math.sin(6.283 * 0.3) * 5);
  near(channelAt(R, c, skel, "armN.elbow", 0.3), 34, 0);                    // skeleton rest
  near(channelAt(R, c, skel, "spine.lean", 0.3), 0, 0);
  const s = sampleClip(R, c, skel, 0.3);
  assert.deepEqual(Object.keys(s.ch).sort(), [...CHANNELS].sort());
});

test("IK sanity: reaches a reachable target exactly, clamps an unreachable one, bend picks the side", () => {
  const S = [0, 0], l1 = 14, l2 = 14;
  const r = R.ik2(S, [6, 20], l1, l2, 1);
  near(Math.hypot(r.J[0] - S[0], r.J[1] - S[1]), l1, 1e-9);
  near(Math.hypot(r.E[0] - r.J[0], r.E[1] - r.J[1]), l2, 1e-9);
  near(r.E[0], 6, 1e-9); near(r.E[1], 20, 1e-9);
  const far = R.ik2(S, [0, 100], l1, l2, 1);                                 // out of reach: a straight limb aimed at it
  assert.ok(Math.hypot(far.E[0], far.E[1]) <= l1 + l2 + 1e-9 && Math.hypot(far.E[0], far.E[1]) > l1 + l2 - 0.1);
  near(far.a1, 0, 5); near(far.a2, 0, 1);                                    // 0.05 px short of straight: a slight bend
  const close = R.ik2(S, [0, 0.1], l1, l2, 1);                               // too close: clamped, still finite
  assert.ok([close.a1, close.a2, ...close.J, ...close.E].every(Number.isFinite));
  near(Math.hypot(close.J[0], close.J[1]), l1, 1e-9);
  const knee = R.ik2(S, [0, 20], l1, l2, 1), elbow = R.ik2(S, [0, 20], l1, l2, -1);
  assert.ok(knee.J[0] > 0 && elbow.J[0] < 0, "knee forward (+1), elbow back (-1)");
});

test("walk: stance feet stay on the ground and slide at a constant speed (planted), swing feet lift", async () => {
  const walk = await loadClip("walk"), look = { shield: 0, weapon: "sword" as const };
  const GY = skel.frame.groundY, sole = dims.sole;
  let stance = 0, swing = 0;
  const xs: number[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * walk.duration, p = poseAt(R, skel, dims, walk, t, look), L = p.legs[1];
    const f = sampleClip(R, walk, skel, t).feet.legN!;
    if (!f.swing) {
      stance++; near(L.target![1], GY - sole, 1e-9); near(L.tilt, 0, 0); xs.push(L.target![0] - L.hj[0]);
      const reach = Math.hypot(L.target![0] - L.hj[0], L.target![1] - L.hj[1]);
      if (reach < dims.thigh + dims.shin - 0.05) { near(L.k.E[0], L.target![0], 1e-6); near(L.k.E[1], L.target![1], 1e-6); }
    }
    else { swing++; assert.ok(L.k.E[1] <= GY - sole + 1e-6); }
  }
  assert.ok(stance > 30 && swing > 20, `stance ${stance} swing ${swing}`);
  const d = xs.slice(1).map((x, i) => x - xs[i]).filter((v) => v < 0);      // within one stance phase: equal steps back
  for (const v of d) near(v, d[0], 1e-6);
});

test("pose modes: shield pose, FK legs, spear grip IK and bow string IK", async () => {
  const idle = await loadClip("idle");
  const withShield = poseAt(R, skel, dims, idle, 0, { shield: 1, weapon: "sword" });
  near(withShield.armF.a1, 42, 0); near(withShield.armF.a2, 104, 0);
  const fkLeg = newClip("fk", { limbs: { legN: { mode: "fk" } }, tracks: { "legN.hip": { keys: [{ u: 0, v: 30 }] }, "legN.knee": { keys: [{ u: 0, v: -40 }] } } });
  const p = poseAt(R, skel, dims, fkLeg, 0, { shield: 0, weapon: "sword" });
  near(p.legs[1].k.a1, 30); near(p.legs[1].k.a2, -10);
  near(Math.hypot(p.legs[1].k.J[0] - p.legs[1].hj[0], p.legs[1].k.J[1] - p.legs[1].hj[1]), dims.thigh);
  const spear = await loadClip("attack-spear");
  for (const u of [0, 0.3, 0.58, 0.9]) {
    const q = poseAt(R, skel, dims, spear, u * spear.duration, { shield: 0, weapon: "spear" });
    const grip = R.add(q.armN.H, R.dir(q.wa), 30);
    assert.ok(Math.hypot(q.armF.H[0] - grip[0], q.armF.H[1] - grip[1]) < 1e-6 || Math.hypot(q.armF.H[0] - q.shoulder[0], q.armF.H[1] - q.shoulder[1]) > dims.upperArm + dims.foreArm + 3 - 0.1, `off hand on the shaft at u=${u}`);
  }
  const bow = await loadClip("attack-bow");
  const full = poseAt(R, skel, dims, bow, 0.6 * bow.duration, { shield: 0, weapon: "bow" });
  near(full.draw, 1); near(full.armN.target![0], full.shoulder[0] + 3, 1e-9); near(full.armN.target![1], full.shoulder[1] + 3, 1e-9);
  const rest = poseAt(R, skel, dims, bow, 0, { shield: 0, weapon: "bow" });
  near(rest.armN.target![0], rest.armF.H[0] - 4, 1e-9);
  near(rest.armF.H[0], rest.shoulder[0] + 26, 1e-6); near(rest.armF.H[1], rest.shoulder[1] + 2, 1e-6);
  void solvePose;
});
