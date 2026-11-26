// Clip editing operations used by the Rig tab (pure functions on a clip object; the tab snapshots for undo).
import type { Channel, Clip, Ease, Key, LimbName, RigCore, Skeleton } from "./clip.ts";
import { CHANNELS, keysAt, waveAt } from "./clip.ts";

/** Keys closer than this (in phase) count as the same key when keying at the playhead. */
export const SAME_KEY = 1e-4;
const round = (v: number, d = 1e4) => Math.round(v * d) / d;

/** Sum of the track's waves at clip time t (keys hold the value without them). */
export function wavesAt(clip: Clip, ch: Channel, t: number): number {
  let s = 0;
  for (const w of clip.tracks[ch]?.waves || []) s += waveAt(w, t, clip.duration);
  return s;
}
/** The keyed part of a channel at phase u (no waves), or the skeleton rest when the track has no keys. */
export function keyedAt(R: RigCore, clip: Clip, skel: Pick<Skeleton, "rest">, ch: Channel, u: number): number {
  const tr = clip.tracks[ch];
  return tr && tr.keys.length ? keysAt(R, tr.keys, u, clip.loop) : skel.rest[ch] ?? 0;
}

/** Set (or insert) the key of `ch` at phase u to value v. Returns the key index. Values / phases are rounded to 1e-4. */
export function setKey(clip: Clip, ch: Channel, u: number, v: number, ease?: Ease): number {
  u = Math.max(0, Math.min(1, round(u))); v = round(v);
  const tr = (clip.tracks[ch] ??= { keys: [] });
  const i = tr.keys.findIndex((k) => Math.abs(k.u - u) < SAME_KEY);
  if (i >= 0) { tr.keys[i].v = v; if (ease) tr.keys[i].ease = ease; return i; }
  const k: Key = ease && ease !== "smooth" ? { u, v, ease } : { u, v };
  let j = tr.keys.findIndex((x) => x.u > u);
  if (j < 0) j = tr.keys.length;
  tr.keys.splice(j, 0, k);
  return j;
}
/** Remove a key; an empty track without waves is removed so the clip stays valid. */
export function removeKey(clip: Clip, ch: Channel, i: number): void {
  const tr = clip.tracks[ch];
  if (!tr || !tr.keys[i]) return;
  tr.keys.splice(i, 1);
  if (!tr.keys.length && !(tr.waves && tr.waves.length)) delete clip.tracks[ch];
}
/** Move key i to phase u, kept strictly between its neighbours. Returns the phase it landed on. */
export function moveKey(clip: Clip, ch: Channel, i: number, u: number): number {
  const ks = clip.tracks[ch]?.keys;
  if (!ks || !ks[i]) return u;
  const lo = i > 0 ? ks[i - 1].u + 0.001 : 0, hi = i < ks.length - 1 ? ks[i + 1].u - 0.001 : 1;
  ks[i].u = round(Math.max(lo, Math.min(hi, u)));
  return ks[i].u;
}

/** Swap near and far sides: legN <-> legF (all channels and limb settings) and the arms' shoulder / elbow / IK
 * channels (the weapon stays in the near hand). Gait phases move with their leg. */
export function mirrorClip(clip: Clip): void {
  const swap = (a: Channel, b: Channel) => { const ta = clip.tracks[a], tb = clip.tracks[b]; delete clip.tracks[a]; delete clip.tracks[b]; if (tb) clip.tracks[a] = tb; if (ta) clip.tracks[b] = ta; };
  for (const j of ["hip", "knee", "ankle", "ikX", "ikY"]) swap(`legN.${j}` as Channel, `legF.${j}` as Channel);
  for (const j of ["shoulder", "elbow", "ikX", "ikY"]) swap(`armN.${j}` as Channel, `armF.${j}` as Channel);
  if (clip.limbs) {
    const l = clip.limbs, sw = (a: LimbName, b: LimbName) => { const x = l[a], y = l[b]; delete l[a]; delete l[b]; if (y) l[a] = y; if (x) l[b] = x; };
    sw("legN", "legF");
    // IK targets are side-specific (grip = off hand, string = near hand): only plain modes swap for arms
    const armN = l.armN, armF = l.armF;
    if ((!armN || !armN.target || armN.target === "free") && (!armF || !armF.target || armF.target === "free")) sw("armN", "armF");
  }
}

/** A pose: the keyed values (no waves) of every channel that has a track, at phase u. */
export function copyPose(R: RigCore, clip: Clip, skel: Pick<Skeleton, "rest">, u: number): Partial<Record<Channel, number>> {
  const out: Partial<Record<Channel, number>> = {};
  for (const ch of CHANNELS) if (clip.tracks[ch]?.keys.length) out[ch] = keyedAt(R, clip, skel, ch, u);
  return out;
}
export function pastePose(clip: Clip, pose: Partial<Record<Channel, number>>, u: number): number {
  let n = 0;
  for (const [ch, v] of Object.entries(pose)) if ((CHANNELS as readonly string[]).includes(ch) && typeof v === "number") { setKey(clip, ch as Channel, u, v); n++; }
  return n;
}
