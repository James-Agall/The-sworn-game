// Pose solver: clip sample -> every joint position and angle of the human skeleton, in frame pixels before the draw
// scale. This mirrors `skeleton()` in client/public/rig/body.html line for line (same rig-core calls, same order of
// arithmetic) so the Lab renders a converted clip pixel-identically; the extra modes (FK legs, IK arms, the spear
// off-hand grip, the bow string) follow client/public/rig/index.html. Pure maths: runs in Node tests and the browser.
import type { Channel, Clip, LimbName, RigCore, Sample, Skeleton, WeaponKind } from "./clip.ts";
import { sampleClip } from "./clip.ts";

export type Dims = { thigh: number; shin: number; upperArm: number; foreArm: number; sole: number; weaponLen: number };
export type Look = { shield: number; weapon: WeaponKind };
type P2 = number[];
export type LegPose = { hj: P2; k: { a1: number; a2: number; J: P2; E: P2 }; far: boolean; tilt: number; target: P2 | null };
export type ArmPose = { a1: number; a2: number; E: P2; H: P2; target: P2 | null };
export type Pose = {
  u: number; lunge: number; root: P2; waist: P2; neck: P2; shoulder: P2; lean: number; headTilt: number; pelvisTilt: number;
  legs: [LegPose, LegPose]; armN: ArmPose; armF: ArmPose; wa: number; draw: number; ground: number;
};

export function limbMode(clip: Clip, limb: LimbName): "fk" | "ik" {
  return clip.limbs?.[limb]?.mode ?? (limb.startsWith("leg") ? "ik" : "fk");
}

/** Solve a pose from channel values (sample.ch) and gait feet (sample.feet). */
export function solvePose(R: RigCore, skel: Skeleton, dims: Dims, clip: Clip, s: Sample, look: Look): Pose {
  const ch = s.ch, F = skel.frame, GX = F.groundX, GY = F.groundY;
  const legH = dims.thigh + dims.shin + dims.sole;
  const lean = ch["spine.lean"];
  const root = [GX + ch["root.x"], GY - legH + ch["root.y"]], pelvisTilt = ch["pelvis.tilt"];
  const waist = [root[0], root[1] - skel.waistUp], up = (h: number, x = 0) => { const v = R.rot(x, -h, lean); return [waist[0] + v[0], waist[1] + v[1]]; };
  const neck = up(skel.neckUp), shoulder = up(-skel.shoulder[1], skel.shoulder[0]), headTilt = ch["head.tilt"];
  // legs: hips under the pelvis; IK to the foot target (+ planted-foot gait), or FK from the hip / knee channels
  const hipsAt = (d: number[]) => [root[0] + d[0], root[1] + d[1]];
  const leg = (name: "legN" | "legF", far: boolean): LegPose => {
    const hj = hipsAt(far ? skel.hips.far : skel.hips.near), c = (k: string) => ch[`${name}.${k}` as Channel];
    if (limbMode(clip, name) === "fk") {
      const a1 = c("hip"), a2 = a1 + c("knee"), J = R.add(hj, R.dir(a1), dims.thigh), E = R.add(J, R.dir(a2), dims.shin);
      return { hj, k: { a1, a2, J, E }, far, tilt: c("ankle"), target: null };
    }
    const f = s.feet[name] || { x: 0, lift: 0, swing: false }, g = clip.limbs?.[name]?.gait;
    const lift = c("ikY") ? c("ikY") + f.lift : f.lift;
    const ankleT = [hj[0] + c("ikX") + f.x, GY - dims.sole - lift];
    const k = R.ik2(hj, ankleT, dims.thigh, dims.shin, clip.limbs?.[name]?.bend ?? skel.bend.leg);
    const tl = g?.tilt, tilt = f.swing && tl ? (f.lift > tl.above ? tl.up : tl.down) : c("ankle");
    return { hj, k, far, tilt, target: ankleT };
  };
  const legs: [LegPose, LegPose] = [leg("legF", true), leg("legN", false)];
  // arms: FK (shoulder angle + elbow bend) or two-bone IK to a target
  const reach = dims.foreArm + skel.handReach;
  const fk = (a: number, b: number): ArmPose => { const E = R.add(shoulder, R.dir(a), dims.upperArm), H = R.add(E, R.dir(a + b), reach); return { a1: a, a2: a + b, E, H, target: null }; };
  const ik = (T: P2, name: LimbName): ArmPose => { const k = R.ik2(shoulder, T, dims.upperArm, reach, clip.limbs?.[name]?.bend ?? skel.bend.arm); return { a1: k.a1, a2: k.a2, E: k.J, H: k.E, target: T }; };
  const free = (n: "armN" | "armF") => [shoulder[0] + ch[`${n}.ikX`], shoulder[1] + ch[`${n}.ikY`]];
  const wa = ch["armN.weapon"], draw = ch["weapon.draw"];
  const nMode = limbMode(clip, "armN"), nTarget = clip.limbs?.armN?.target ?? "free";
  const fMode = limbMode(clip, "armF"), fTarget = clip.limbs?.armF?.target ?? "free";
  // far arm first (the bow string hangs from it)
  let armF: ArmPose;
  const holdsShield = look.shield && look.weapon !== "bow" && fMode === "fk";
  if (holdsShield) armF = fk(skel.shieldPose.shoulder, skel.shieldPose.elbow);
  else if (fMode === "fk" || fTarget === "grip") armF = fk(ch["armF.shoulder"], ch["armF.elbow"]);
  else armF = ik(free("armF"), "armF");
  let armN: ArmPose;
  if (nMode === "ik" && nTarget === "string") {
    const st = skel.weapons.bow?.string, from = st ? st.from : [-4, 0], to = st ? st.to : [3, 3];
    armN = ik([R.lerp(armF.H[0] + from[0], shoulder[0] + to[0], draw), R.lerp(armF.H[1] + from[1], shoulder[1] + to[1], draw)], "armN");
  } else if (nMode === "ik") armN = ik(free("armN"), "armN");
  else armN = fk(ch["armN.shoulder"], ch["armN.elbow"]);
  // the spear's off hand grips the shaft `along` px from the weapon hand
  if (!holdsShield && fMode === "ik" && fTarget === "grip") armF = ik(R.add(armN.H, R.dir(wa), clip.limbs?.armF?.along ?? 30), "armF");
  return { u: s.u, lunge: ch["root.x"], root, waist, neck, shoulder, lean, headTilt, pelvisTilt, legs, armN, armF, wa, draw, ground: GY };
}

/** Sample + solve at clip time t. */
export function poseAt(R: RigCore, skel: Skeleton, dims: Dims, clip: Clip, t: number, look: Look, u?: number): Pose {
  return solvePose(R, skel, dims, clip, sampleClip(R, clip, skel, t, u), look);
}

/** The weapon tip at phase uu, the way body.html's swing trail computes it: the pose at uu but the current bob and root. */
export function weaponTip(R: RigCore, skel: Skeleton, dims: Dims, clip: Clip, cur: Pose, uu: number): P2 {
  const s = sampleClip(R, clip, skel, uu * clip.duration, clip.loop ? ((uu % 1) + 1) % 1 : uu);
  const v = R.rot(skel.shoulder[0], skel.shoulder[1], s.ch["spine.lean"]);
  const sh = [cur.root[0] - cur.lunge + s.ch["root.x"] + v[0], cur.waist[1] + v[1]];
  const a = s.ch["armN.shoulder"], el = R.add(sh, R.dir(a), dims.upperArm), ha = R.add(el, R.dir(a + s.ch["armN.elbow"]), dims.foreArm + skel.handReach);
  return R.add(ha, R.dir(s.ch["armN.weapon"]), dims.weaponLen);
}
