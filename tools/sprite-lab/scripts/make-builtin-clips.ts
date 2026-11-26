// Writes the built-in reference clips into client/public/rig/clips/ (repo, or --out <dir>):
//   idle, walk, attack-sword    from client/public/rig/body.html  (K, the walk / idle formulas in skeleton())
//   attack-axe / -spear / -bow  from client/public/rig/index.html (ATTACK.axe / .spear / .bow, off-hand IK rules)
// The numbers below are copied from those pages; test/rig-golden.test.ts proves the Lab renders idle / walk / sword
// pixel-identically to body.html and that the axe / spear / bow channels match index.html's drawn angles.
// Run: node tools/sprite-lab/scripts/make-builtin-clips.ts [--out dir]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_DIR } from "../server/png.ts";
import { CLIP_FORMAT, formatClip, validateClip, type Clip, type Ease, type Key, type Track, type Wave } from "../shared/clip.ts";

type K = [number, number, Ease?][];
const keys = (k: K, f = (v: number) => v): Key[] => k.map(([u, v, ease]) => (ease ? { u, v: f(v), ease } : { u, v: f(v) }));
const track = (k: K, waves?: Wave[], f?: (v: number) => number): Track => (waves ? { keys: keys(k, f), waves } : { keys: keys(k, f) });
const E_IN: Ease = "easeIn", E_OUT: Ease = "easeOut";
// body.html: idle bob Math.sin(T * 2.2) * 0.5, head wobble Math.sin(T * 1.7) * 0.6 (seconds, not tied to a cycle)
const IDLE_BOB: Wave = { fn: "sin", amp: 0.5, rate: 2.2, per: "second" };
const WOBBLE: Wave = { fn: "sin", amp: 0.6, rate: 1.7, per: "second" };
// body.html walk: sw = Math.sin(cyc * 6.283), cyc = T * 1.15 (cycles); note 6.283, not 2 pi
const SW = (amp: number): Wave => ({ fn: "sin", amp, rate: 6.283, per: "cycle" });
const base = (name: string, source: string, extra: Partial<Clip>): Clip => ({ format: CLIP_FORMAT, name, builtin: true, source, skeleton: "human", loop: true, duration: 1, fps: 24, phases: 8, tracks: {}, ...extra });
const stand = { legN: { mode: "ik" as const }, legF: { mode: "ik" as const } };

const clips: Clip[] = [];
clips.push(base("idle", "client/public/rig/body.html skeleton(), state idle", {
  duration: 2 * Math.PI / 2.2, fps: 12, phases: 8,
  tracks: { "root.y": { keys: [], waves: [IDLE_BOB] }, "head.tilt": { keys: [], waves: [WOBBLE] } },
  limbs: stand,
}));
const tilt = { above: 2, up: -14, down: 10 };
clips.push(base("walk", "client/public/rig/body.html skeleton(), state walk (planted feet: Rig.foot stride 22, lift 8, duty 0.58)", {
  duration: 1 / 1.15, fps: 24, phases: 8,
  tracks: {
    "root.y": { keys: [], waves: [{ fn: "abscos", amp: -2.5, rate: 6.283, per: "cycle" }] },
    "pelvis.tilt": { keys: [], waves: [SW(2)] },
    "spine.lean": track([[0, 2.5]]),
    "head.tilt": track([[0, 2.5 * 0.45]], [WOBBLE]),
    "armN.shoulder": track([[0, 14]], [SW(5)]),
    "armN.weapon": track([[0, 78]], [SW(5)]),
    "armF.shoulder": track([[0, -10]], [SW(-20)]),
  },
  limbs: {
    legN: { mode: "ik", gait: { stride: 22, lift: 8, duty: 0.58, phase: 0, tilt } },
    legF: { mode: "ik", gait: { stride: 22, lift: 8, duty: 0.58, phase: 0.5, tilt } },
  },
  events: [{ u: 0, type: "footdown", note: "near foot plants" }, { u: 0.5, type: "footdown", note: "far foot plants" }],
}));
// body.html K (the sword attack); u = t / 0.62, then 0.55 s of rest pose in body.html's own loop (not part of the clip)
const KS = {
  ua: [[0, 14], [0.3, 150, E_OUT], [0.42, 162], [0.62, 55, E_IN], [0.8, 30], [1, 14, E_OUT]] as K,
  fe: [[0, 34], [0.3, 22], [0.42, 18], [0.62, 8, E_IN], [0.8, 26], [1, 34]] as K,
  wa: [[0, 78], [0.3, 185, E_OUT], [0.42, 192], [0.62, 82, E_IN], [0.8, 56], [1, 78, E_OUT]] as K,
  lean: [[0, 0], [0.3, -9], [0.42, -9], [0.62, 12, E_IN], [1, 0]] as K,
  lunge: [[0, 0], [0.4, -3], [0.62, 7, E_IN], [1, 0]] as K,
};
clips.push(base("attack-sword", "client/public/rig/body.html K (dur 0.62, trail 0.5-0.78)", {
  loop: false, duration: 0.62, fps: 30, phases: 12,
  tracks: {
    "root.x": track(KS.lunge), "root.y": { keys: [], waves: [IDLE_BOB] },
    "spine.lean": track(KS.lean),
    // body.html: headTilt = lean * 0.45 + kf(K.lean) * -0.2 + wobble, with lean = kf(K.lean)
    "head.tilt": track(KS.lean, [WOBBLE], (v) => v * 0.45 + v * -0.2),
    "armN.shoulder": track(KS.ua), "armN.elbow": track(KS.fe), "armN.weapon": track(KS.wa),
  },
  limbs: stand,
  weapon: { kind: "sword", trail: { from: 0.5, to: 0.78, steps: 7, step: 0.018 } },
  events: [{ u: 0.3, type: "mark", note: "windup" }, { u: 0.62, type: "contact", note: "strike" }],
}));
// index.html ATTACK tables (axe / spear / bow); head tilt = lean * 0.4 there; bob / wobble / stance are body.html's
const A = {
  axe: { dur: 0.8, ua: [[0, 35], [0.4, 170, E_OUT], [0.52, 174], [0.72, 52, E_IN], [0.9, 40], [1, 35]] as K, fe: [[0, 50], [0.4, 10], [0.52, 8], [0.72, 6], [0.9, 30], [1, 50]] as K, wa: [[0, 120], [0.4, 200, E_OUT], [0.52, 205], [0.72, 60, E_IN], [0.9, 45], [1, 120]] as K, lean: [[0, 0], [0.4, -12], [0.52, -12], [0.72, 15, E_IN], [1, 0]] as K, lunge: [[0, 0], [0.5, -4], [0.72, 8, E_IN], [1, 0]] as K, uaF: [[0, -10], [0.5, -55], [0.72, 30], [1, -10]] as K, trail: [0.58, 0.86] },
  spear: { dur: 0.66, ua: [[0, 55], [0.3, 20, E_OUT], [0.44, 18], [0.58, 82, E_IN], [0.8, 70], [1, 55]] as K, fe: [[0, 40], [0.3, 92], [0.44, 96], [0.58, 4, E_IN], [0.8, 12], [1, 40]] as K, wa: [[0, 84], [0.3, 72], [0.44, 70], [0.58, 92], [0.8, 88], [1, 84]] as K, lean: [[0, 0], [0.3, -7], [0.44, -7], [0.58, 12, E_IN], [0.8, 5], [1, 0]] as K, lunge: [[0, 0], [0.4, -4], [0.58, 9, E_IN], [1, 0]] as K, trail: [0.5, 0.7] },
  bow: { dur: 1.2, lean: [[0, 0], [0.25, -3], [0.7, -4], [0.76, 2], [1, 0]] as K, draw: [[0, 0], [0.18, 0], [0.55, 1], [0.7, 1], [0.74, 0, E_IN], [1, 0]] as K },
};
const headOf = (lean: K) => track(lean, [WOBBLE], (v) => v * 0.4);
clips.push(base("attack-axe", "client/public/rig/index.html ATTACK.axe (dur 0.8, trail 0.58-0.86; far arm elbow 16)", {
  loop: false, duration: A.axe.dur, fps: 30, phases: 12,
  tracks: {
    "root.x": track(A.axe.lunge), "root.y": { keys: [], waves: [IDLE_BOB] }, "spine.lean": track(A.axe.lean), "head.tilt": headOf(A.axe.lean),
    "armN.shoulder": track(A.axe.ua), "armN.elbow": track(A.axe.fe), "armN.weapon": track(A.axe.wa),
    "armF.shoulder": track(A.axe.uaF), "armF.elbow": track([[0, 16]]),
  },
  limbs: stand,
  weapon: { kind: "axe", trail: { from: A.axe.trail[0], to: A.axe.trail[1], steps: 7, step: 0.018 } },
  events: [{ u: 0.4, type: "mark", note: "windup" }, { u: 0.72, type: "contact", note: "strike" }],
}));
clips.push(base("attack-spear", "client/public/rig/index.html ATTACK.spear (dur 0.66, trail 0.5-0.7; off hand IK to the shaft 30 px from the weapon hand)", {
  loop: false, duration: A.spear.dur, fps: 30, phases: 12,
  tracks: {
    "root.x": track(A.spear.lunge), "root.y": { keys: [], waves: [IDLE_BOB] }, "spine.lean": track(A.spear.lean), "head.tilt": headOf(A.spear.lean),
    "armN.shoulder": track(A.spear.ua), "armN.elbow": track(A.spear.fe), "armN.weapon": track(A.spear.wa),
  },
  limbs: { ...stand, armF: { mode: "ik", target: "grip", along: 30 } },
  weapon: { kind: "spear", trail: { from: A.spear.trail[0], to: A.spear.trail[1], steps: 7, step: 0.018 } },
  events: [{ u: 0.3, type: "mark", note: "pull back" }, { u: 0.58, type: "contact", note: "thrust" }],
}));
clips.push(base("attack-bow", "client/public/rig/index.html ATTACK.bow (dur 1.2, draw 0.18-0.55, release 0.74; bow hand IK to shoulder + (26, 2), string hand IK to the string)", {
  loop: false, duration: A.bow.dur, fps: 30, phases: 12,
  tracks: {
    "root.y": { keys: [], waves: [IDLE_BOB] }, "spine.lean": track(A.bow.lean), "head.tilt": headOf(A.bow.lean),
    "armF.ikX": track([[0, 26]]), "armF.ikY": track([[0, 2]]), "weapon.draw": track(A.bow.draw),
  },
  limbs: { ...stand, armN: { mode: "ik", target: "string" }, armF: { mode: "ik", target: "free" } },
  weapon: { kind: "bow", release: 0.74, shield: false },
  events: [{ u: 0.55, type: "mark", note: "full draw" }, { u: 0.74, type: "release", note: "arrow flies" }],
}));

const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(REPO_DIR, "client", "public", "rig", "clips");
mkdirSync(out, { recursive: true });
for (const c of clips) {
  const errs = validateClip(c, c.name);
  if (errs.length) throw new Error(`${c.name}: ${errs.join("; ")}`);
  writeFileSync(path.join(out, c.name + ".json"), formatClip(c));
  console.log("wrote " + path.join(out, c.name + ".json"));
}
