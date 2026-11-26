// Clips: animation as data (client/public/rig/clips/<name>.json) for the human player skeleton
// (client/public/rig/skeletons/human.json). Shared by the Lab server (validation on save), the Lab app (editing, playback)
// and the tests. The maths is rig-core.js's own (R.kf, R.foot, R.ik2...): the caller passes the loaded `Rig` object in,
// so nothing here forks rig-core. Format reference: tools/sprite-lab/README.md "Clip format".
//
// Angles follow rig-core: degrees, 0 = straight down, positive = toward the facing (+x), 180 = up.
// Time: a clip runs for `duration` seconds per loop; the phase u = t / duration (wrapped for loops, clamped otherwise).
import { isDataName } from "./names.ts";

/** The parts of rig-core.js the clip maths uses (window.Rig in the browser, globalThis.Rig after importing it in Node). */
export type RigCore = {
  kf(keys: [number, number, ((u: number) => number)?][], u: number): number;
  smooth(u: number): number; easeIn(u: number): number; easeOut(u: number): number;
  lerp(a: number, b: number, u: number): number;
  foot(phase: number, stride: number, lift: number, duty?: number): { x: number; lift: number; swing: boolean };
  ik2(S: number[], T: number[], l1: number, l2: number, bend?: number): { a1: number; a2: number; J: number[]; E: number[] };
  dir(a: number): number[]; rot(x: number, y: number, a: number): number[]; add(p: number[], v: number[], k?: number): number[];
  clamp(v: number, a: number, b: number): number;
};

export const CLIP_FORMAT = "sworn-clip/1";
export const SKELETON_FORMAT = "sworn-skeleton/1";

/** Every animatable channel of the human skeleton. Units: degrees for angles, source px for offsets, 0..1 for draw. */
export const CHANNELS = [
  "root.x", "root.y", "pelvis.tilt", "spine.lean", "head.tilt",
  "armN.shoulder", "armN.elbow", "armN.ikX", "armN.ikY", "armN.weapon",
  "armF.shoulder", "armF.elbow", "armF.ikX", "armF.ikY",
  "legN.hip", "legN.knee", "legN.ankle", "legN.ikX", "legN.ikY",
  "legF.hip", "legF.knee", "legF.ankle", "legF.ikX", "legF.ikY",
  "weapon.draw",
] as const;
export type Channel = typeof CHANNELS[number];
export const CHANNEL_HELP: Record<Channel, string> = {
  "root.x": "hips forward (+) / back, px (lunge)", "root.y": "hips down (+) / up, px (bob)", "pelvis.tilt": "pelvis tilt, deg",
  "spine.lean": "torso lean forward, deg", "head.tilt": "head tilt forward, deg",
  "armN.shoulder": "near (weapon) arm: upper arm angle, deg", "armN.elbow": "near arm: elbow bend (forearm relative), deg",
  "armN.ikX": "near arm IK target x from the shoulder, px", "armN.ikY": "near arm IK target y from the shoulder (+ down), px",
  "armN.weapon": "weapon angle (absolute), deg",
  "armF.shoulder": "far arm: upper arm angle, deg", "armF.elbow": "far arm: elbow bend, deg",
  "armF.ikX": "far arm IK target x from the shoulder, px", "armF.ikY": "far arm IK target y from the shoulder (+ down), px",
  "legN.hip": "near leg FK: thigh angle, deg", "legN.knee": "near leg FK: knee bend (shin relative), deg", "legN.ankle": "near foot tilt, deg",
  "legN.ikX": "near foot target x from the hip, px", "legN.ikY": "near foot lift above the ground, px",
  "legF.hip": "far leg FK: thigh angle, deg", "legF.knee": "far leg FK: knee bend, deg", "legF.ankle": "far foot tilt, deg",
  "legF.ikX": "far foot target x from the hip, px", "legF.ikY": "far foot lift above the ground, px",
  "weapon.draw": "bow draw 0..1 (string pulled to the shoulder)",
};
export const EASES = ["smooth", "linear", "easeIn", "easeOut", "step"] as const;
export type Ease = typeof EASES[number];
export const LIMBS = ["armN", "armF", "legN", "legF"] as const;
export type LimbName = typeof LIMBS[number];
export const WAVE_FNS = ["sin", "cos", "abssin", "abscos"] as const;
export const IK_TARGETS = ["free", "grip", "string"] as const;
export const WEAPONS = ["none", "sword", "axe", "spear", "bow"] as const;
export type WeaponKind = typeof WEAPONS[number];
export const EVENT_TYPES = ["contact", "release", "footdown", "sound", "mark"] as const;

export type Key = { u: number; v: number; ease?: Ease; [extra: string]: unknown };
/** An additive oscillator: amp * fn(rate * x + phase), x = loop count (per "cycle", unwrapped) or seconds (per "second"). */
export type Wave = { fn: typeof WAVE_FNS[number]; amp: number; rate: number; per: "cycle" | "second"; phase?: number; [extra: string]: unknown };
export type Track = { keys: Key[]; waves?: Wave[]; [extra: string]: unknown };
/** rig-core R.foot planted-foot generator, added to the IK foot target (x along the facing, lift up). */
export type Gait = { stride: number; lift: number; duty: number; phase: number; cycles?: number; tilt?: { above: number; up: number; down: number }; [extra: string]: unknown };
export type Limb = { mode: "fk" | "ik"; target?: typeof IK_TARGETS[number]; along?: number; bend?: 1 | -1; gait?: Gait; [extra: string]: unknown };
export type ClipEvent = { u: number; type: typeof EVENT_TYPES[number]; note?: string; [extra: string]: unknown };
export type ClipWeapon = { kind?: WeaponKind; trail?: { from: number; to: number; steps?: number; step?: number }; release?: number; shield?: boolean; [extra: string]: unknown };
export type Clip = {
  format: string; name: string; skeleton: string; loop: boolean; duration: number; fps: number; phases?: number;
  builtin?: boolean; source?: string; note?: string;
  tracks: Partial<Record<Channel, Track>>;
  limbs?: Partial<Record<LimbName, Limb>>;
  weapon?: ClipWeapon;
  events?: ClipEvent[];
  [extra: string]: unknown;
};

// ------------------------------------------------------------------ validation
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Strict check of every known field; unknown fields are allowed and left untouched (so newer files survive a round trip). */
export function validateClip(c: unknown, expectName?: string): string[] {
  const e: string[] = [];
  if (!isObj(c)) return ["a clip must be a JSON object"];
  if (c.format !== CLIP_FORMAT) e.push(`format must be "${CLIP_FORMAT}"`);
  if (!isDataName(c.name)) e.push("name must match ^[a-z0-9][a-z0-9_-]{0,40}$");
  else if (expectName !== undefined && c.name !== expectName) e.push(`name "${c.name}" does not match the file name "${expectName}"`);
  if (typeof c.skeleton !== "string" || !isDataName(c.skeleton)) e.push("skeleton must be a skeleton name (e.g. \"human\")");
  if (typeof c.loop !== "boolean") e.push("loop must be true or false");
  if (!num(c.duration) || c.duration <= 0 || c.duration > 60) e.push("duration must be seconds, 0 < d <= 60");
  if (!num(c.fps) || c.fps < 1 || c.fps > 120) e.push("fps must be 1..120");
  if (c.phases !== undefined && (!Number.isInteger(c.phases) || (c.phases as number) < 1 || (c.phases as number) > 256)) e.push("phases must be an integer 1..256");
  for (const k of ["builtin"] as const) if (c[k] !== undefined && typeof c[k] !== "boolean") e.push(`${k} must be true or false`);
  for (const k of ["source", "note"] as const) if (c[k] !== undefined && typeof c[k] !== "string") e.push(`${k} must be text`);
  if (!isObj(c.tracks)) e.push("tracks must be an object { channel: { keys: [...] } }");
  else for (const [ch, t] of Object.entries(c.tracks)) {
    const at = `tracks["${ch}"]`;
    if (!(CHANNELS as readonly string[]).includes(ch)) { e.push(`${at}: unknown channel (known: ${CHANNELS.join(", ")})`); continue; }
    if (!isObj(t)) { e.push(`${at} must be an object`); continue; }
    if (!Array.isArray(t.keys)) { e.push(`${at}.keys must be a list`); continue; }
    let prev = -Infinity;
    t.keys.forEach((k: unknown, i: number) => {
      if (!isObj(k)) { e.push(`${at}.keys[${i}] must be an object {u, v, ease?}`); return; }
      if (!num(k.u) || k.u < 0 || k.u > 1) e.push(`${at}.keys[${i}].u must be 0..1`);
      else if (k.u <= prev) e.push(`${at}.keys[${i}].u must be greater than the previous key's`);
      else prev = k.u;
      if (!num(k.v) || Math.abs(k.v) > 1e5) e.push(`${at}.keys[${i}].v must be a finite number`);
      if (k.ease !== undefined && !(EASES as readonly string[]).includes(k.ease as string)) e.push(`${at}.keys[${i}].ease must be one of ${EASES.join(", ")}`);
    });
    if (t.waves !== undefined) {
      if (!Array.isArray(t.waves)) e.push(`${at}.waves must be a list`);
      else t.waves.forEach((w: unknown, i: number) => {
        const wa = `${at}.waves[${i}]`;
        if (!isObj(w)) { e.push(`${wa} must be an object`); return; }
        if (!(WAVE_FNS as readonly string[]).includes(w.fn as string)) e.push(`${wa}.fn must be one of ${WAVE_FNS.join(", ")}`);
        if (!num(w.amp) || !num(w.rate)) e.push(`${wa}: amp and rate must be numbers`);
        if (w.per !== "cycle" && w.per !== "second") e.push(`${wa}.per must be "cycle" or "second"`);
        if (w.phase !== undefined && !num(w.phase)) e.push(`${wa}.phase must be a number`);
      });
    }
    if (t.keys.length === 0 && !(Array.isArray(t.waves) && t.waves.length)) e.push(`${at} has no keys and no waves (delete the track instead)`);
  }
  if (c.limbs !== undefined) {
    if (!isObj(c.limbs)) e.push("limbs must be an object");
    else for (const [n, l] of Object.entries(c.limbs)) {
      const at = `limbs.${n}`;
      if (!(LIMBS as readonly string[]).includes(n)) { e.push(`${at}: unknown limb (known: ${LIMBS.join(", ")})`); continue; }
      if (!isObj(l)) { e.push(`${at} must be an object`); continue; }
      if (l.mode !== "fk" && l.mode !== "ik") e.push(`${at}.mode must be "fk" or "ik"`);
      if (l.target !== undefined && !(IK_TARGETS as readonly string[]).includes(l.target as string)) e.push(`${at}.target must be one of ${IK_TARGETS.join(", ")}`);
      if (l.target !== undefined && n.startsWith("leg") && l.target !== "free") e.push(`${at}.target: legs only take "free"`);
      if (l.target === "grip" && n !== "armF") e.push(`${at}.target "grip" is for the far (off-hand) arm`);
      if (l.target === "string" && n !== "armN") e.push(`${at}.target "string" is for the near arm (the bow is in the far hand)`);
      if (l.along !== undefined && !num(l.along)) e.push(`${at}.along must be a number (px along the weapon)`);
      if (l.bend !== undefined && l.bend !== 1 && l.bend !== -1) e.push(`${at}.bend must be 1 or -1`);
      if (l.gait !== undefined) {
        const g = l.gait;
        if (!n.startsWith("leg")) e.push(`${at}.gait is for legs`);
        if (!isObj(g)) e.push(`${at}.gait must be an object`);
        else {
          for (const k of ["stride", "lift", "duty", "phase"]) if (!num(g[k])) e.push(`${at}.gait.${k} must be a number`);
          if (num(g.duty) && (g.duty <= 0 || g.duty >= 1)) e.push(`${at}.gait.duty must be between 0 and 1`);
          if (g.cycles !== undefined && (!num(g.cycles) || g.cycles <= 0)) e.push(`${at}.gait.cycles must be > 0`);
          if (g.tilt !== undefined && !(isObj(g.tilt) && num(g.tilt.above) && num(g.tilt.up) && num(g.tilt.down))) e.push(`${at}.gait.tilt must be {above, up, down}`);
        }
      }
    }
  }
  if (c.weapon !== undefined) {
    const w = c.weapon;
    if (!isObj(w)) e.push("weapon must be an object");
    else {
      if (w.kind !== undefined && !(WEAPONS as readonly string[]).includes(w.kind as string)) e.push(`weapon.kind must be one of ${WEAPONS.join(", ")}`);
      if (w.trail !== undefined && !(isObj(w.trail) && num(w.trail.from) && num(w.trail.to) && w.trail.from < w.trail.to)) e.push("weapon.trail must be {from, to} with from < to");
      if (isObj(w.trail) && ((w.trail.steps !== undefined && !(Number.isInteger(w.trail.steps) && (w.trail.steps as number) >= 1 && (w.trail.steps as number) <= 30)) || (w.trail.step !== undefined && !num(w.trail.step)))) e.push("weapon.trail.steps must be 1..30 and step a number");
      if (w.release !== undefined && !(num(w.release) && w.release >= 0 && w.release <= 1)) e.push("weapon.release must be 0..1");
      if (w.shield !== undefined && typeof w.shield !== "boolean") e.push("weapon.shield must be true or false");
    }
  }
  if (c.events !== undefined) {
    if (!Array.isArray(c.events)) e.push("events must be a list");
    else c.events.forEach((ev: unknown, i: number) => {
      if (!isObj(ev) || !num(ev.u) || ev.u < 0 || ev.u > 1 || !(EVENT_TYPES as readonly string[]).includes(ev.type as string)) e.push(`events[${i}] must be {u: 0..1, type: ${EVENT_TYPES.join("|")}}`);
    });
  }
  return e;
}

export type Skeleton = {
  format: string; name: string;
  frame: { w: number; h: number; groundX: number; groundY: number; drawScale: number };
  waistUp: number; neckUp: number; shoulder: [number, number]; headAt: [number, number]; helmAt: [number, number];
  hips: { near: [number, number]; far: [number, number] }; handReach: number;
  rest: Partial<Record<Channel, number>>; bend: { arm: 1 | -1; leg: 1 | -1 };
  shieldPose: { shoulder: number; elbow: number; at: [number, number] };
  weapons: Record<string, { part?: string; angle?: number; length?: number; width?: number; at?: [number, number]; string?: { from: [number, number]; to: [number, number]; top: [number, number]; bottom: [number, number] } }>;
  bones: { name: string; parent: string | null; [k: string]: unknown }[];
  [extra: string]: unknown;
};
export function validateSkeleton(s: unknown): string[] {
  const e: string[] = [];
  if (!isObj(s)) return ["a skeleton must be a JSON object"];
  if (s.format !== SKELETON_FORMAT) e.push(`format must be "${SKELETON_FORMAT}"`);
  const f = s.frame as Record<string, unknown> | undefined;
  if (!isObj(f) || !["w", "h", "groundX", "groundY", "drawScale"].every((k) => num(f[k]))) e.push("frame must be {w, h, groundX, groundY, drawScale}");
  for (const k of ["waistUp", "neckUp", "handReach"]) if (!num(s[k])) e.push(`${k} must be a number`);
  const pt = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(num);
  for (const k of ["shoulder", "headAt", "helmAt"]) if (!pt(s[k])) e.push(`${k} must be [x, y]`);
  if (!isObj(s.hips) || !pt(s.hips.near) || !pt(s.hips.far)) e.push("hips must be {near:[x,y], far:[x,y]}");
  if (!isObj(s.rest)) e.push("rest must be an object");
  else for (const [k, v] of Object.entries(s.rest)) if (!(CHANNELS as readonly string[]).includes(k) || !num(v)) e.push(`rest.${k}: unknown channel or not a number`);
  if (!isObj(s.bend)) e.push("bend must be {arm, leg}");
  if (!isObj(s.shieldPose)) e.push("shieldPose must be an object");
  if (!isObj(s.weapons)) e.push("weapons must be an object");
  if (!Array.isArray(s.bones)) e.push("bones must be a list");
  else {
    const names = new Set<string>();
    for (const b of s.bones as Record<string, unknown>[]) {
      if (!isObj(b) || typeof b.name !== "string") { e.push("every bone needs a name"); continue; }
      if (b.parent !== null && !names.has(b.parent as string)) e.push(`bone ${b.name}: parent ${String(b.parent)} must come earlier`);
      names.add(b.name);
    }
  }
  return e;
}

// ------------------------------------------------------------------ evaluation
export function easeFn(R: RigCore, e: Ease | undefined): (u: number) => number {
  switch (e) {
    case undefined: case "smooth": return R.smooth;
    case "linear": return (u) => u;
    case "easeIn": return R.easeIn;
    case "easeOut": return R.easeOut;
    case "step": return () => 0;
  }
  return R.smooth;
}

/** The phase u for clip time t (seconds). Loops wrap; one-shots clamp to 0..1. */
export function phaseAt(clip: Pick<Clip, "loop" | "duration">, t: number): number {
  const x = t / clip.duration;
  return clip.loop ? ((x % 1) + 1) % 1 : Math.max(0, Math.min(1, x));
}

/** Keyframe value at u with rig-core's R.kf (ease on the TARGET key). Loops also interpolate across the seam. */
export function keysAt(R: RigCore, keys: Key[], u: number, loop: boolean): number {
  const arr: [number, number, (u: number) => number][] = keys.map((k) => [k.u, k.v, easeFn(R, k.ease)]);
  if (loop && keys.length > 1) {
    const first = keys[0], last = keys[keys.length - 1];
    if (first.u > 0) arr.unshift([last.u - 1, last.v, easeFn(R, last.ease)]);
    if (last.u < 1) arr.push([first.u + 1, first.v, easeFn(R, first.ease)]);
  }
  return R.kf(arr, u);
}

export function waveAt(w: Wave, t: number, duration: number): number {
  const x = w.per === "cycle" ? t / duration : t;
  const a = w.phase ? w.rate * x + w.phase : w.rate * x;
  switch (w.fn) {
    case "sin": return Math.sin(a) * w.amp;
    case "cos": return Math.cos(a) * w.amp;
    case "abssin": return Math.abs(Math.sin(a)) * w.amp;
    case "abscos": return Math.abs(Math.cos(a)) * w.amp;
  }
  return 0;
}

/** One channel at clip time t. No track: the skeleton's rest value (or 0). Keys + waves are added. */
export function channelAt(R: RigCore, clip: Clip, skel: Pick<Skeleton, "rest">, ch: Channel, t: number, u = phaseAt(clip, t)): number {
  const tr = clip.tracks[ch], rest = skel.rest[ch] ?? 0;
  if (!tr) return rest;
  let v = tr.keys.length ? keysAt(R, tr.keys, u, clip.loop) : rest;
  for (const w of tr.waves || []) v = v + waveAt(w, t, clip.duration);
  return v;
}

export type Sample = { t: number; u: number; ch: Record<Channel, number>; feet: Partial<Record<"legN" | "legF", { x: number; lift: number; swing: boolean }>> };

/** Every channel plus the gait feet for clip time t. `u` may be given to evaluate keys at a phase other than t's (trails). */
export function sampleClip(R: RigCore, clip: Clip, skel: Pick<Skeleton, "rest">, t: number, u = phaseAt(clip, t)): Sample {
  const ch = {} as Record<Channel, number>;
  for (const c of CHANNELS) ch[c] = channelAt(R, clip, skel, c, t, u);
  const feet: Sample["feet"] = {};
  for (const leg of ["legN", "legF"] as const) {
    const g = clip.limbs?.[leg]?.gait;
    if (g && clip.limbs?.[leg]?.mode === "ik") feet[leg] = R.foot((g.cycles ?? 1) * (t / clip.duration) + g.phase, g.stride, g.lift, g.duty);
  }
  return { t, u, ch, feet };
}

/** A new clip with sensible defaults (used by "New clip"). */
export function newClip(name: string, base?: Partial<Clip>): Clip {
  return { format: CLIP_FORMAT, name, skeleton: "human", loop: true, duration: 1, fps: 24, phases: 8, tracks: {}, limbs: { legN: { mode: "ik" }, legF: { mode: "ik" } }, ...base };
}

/** Clip JSON text: 1-space indent like the other rig data, but small leaf objects ({u, v, ease}, waves) on one line so a
 * keyframe edit is a one-line git diff. Key order is kept, so unknown fields survive in place. */
export function formatClip(c: unknown): string {
  const leaf = (v: unknown) => !!v && typeof v === "object" && Object.values(v as object).every((x) => x === null || typeof x !== "object");
  const out = (v: unknown, ind: string): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (leaf(v) && JSON.stringify(v).length <= 100) return Array.isArray(v) ? JSON.stringify(v) : "{" + Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => JSON.stringify(k) + ": " + JSON.stringify(x)).join(", ") + "}";
    const next = ind + " ";
    if (Array.isArray(v)) return v.length ? "[\n" + v.map((x) => next + out(x, next)).join(",\n") + "\n" + ind + "]" : "[]";
    const ents = Object.entries(v as object).filter(([, x]) => x !== undefined);
    return ents.length ? "{\n" + ents.map(([k, x]) => next + JSON.stringify(k) + ": " + out(x, next)).join(",\n") + "\n" + ind + "}" : "{}";
  };
  return out(c, "") + "\n";
}
