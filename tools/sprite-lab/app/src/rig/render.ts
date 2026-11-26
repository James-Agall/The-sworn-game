// The Lab's body renderer. It LOADS client/public/rig/rig-core.js (never a copy) and mirrors the part placement of
// client/public/rig/body.html (build(), drawFrame(), withBg(), __rig.sheet()) with the hard-coded motion replaced by a clip.
// test/rig-golden.test.ts renders idle / walk / sword attack with both and requires identical pixels, so keep every
// call below in body.html's order. Additions that body.html does not have (armour tiers, gender heads / torsos, build
// scale, axe / spear / bow from the set, the bow string and arrow from index.html) only run when those options are set.
import type { Clip, RigCore, Skeleton, WeaponKind } from "../../../shared/clip.ts";
import { sampleClip, phaseAt } from "../../../shared/clip.ts";
import { solvePose, weaponTip, type Dims, type Pose } from "../../../shared/pose.ts";

type Cv = HTMLCanvasElement;
export type Part = { c: Cv; px: number; py: number; native: number; len?: number };
export type Rig = RigCore & {
  D: number; INK: string;
  canvas(w: number, h: number): Cv;
  paint(w: number, h: number, fn: (g: CanvasRenderingContext2D, c: Cv) => void): Cv;
  shade(hex: string, k: number): string;
  shape(g: CanvasRenderingContext2D, pts: number[][], fill: string, o?: { lw?: number; ink?: string; shadeBottom?: boolean }): void;
  limbAt(g: CanvasRenderingContext2D, p: Part, x: number, y: number, a: number): void;
  uprightAt(g: CanvasRenderingContext2D, p: Part, x: number, y: number, tilt?: number): void;
  sheet(frames: { canvas: Cv; label?: string }[], o?: { cols?: number; scale?: number; gameScale?: number; bg?: string }): Cv;
};
export type Look = { weapon: WeaponKind; helm: number; shield: number; hair: number; armour: number; gender: "m" | "f"; build: number };
export const DEFAULT_LOOK: Look = { weapon: "sword", helm: 0, shield: 0, hair: 1, armour: 0, gender: "m", build: 1 };
/** heroRig.ts heroBuildFactor (height) and its width factors, applied as one scale about the ground point. */
export const BUILD_SCALE: [number, number][] = [[0.88, 0.93], [1, 1], [1.16, 1.07]];
export const GAME_SCALE = 0.255;

let corePromise: Promise<Rig> | null = null;
/** Load /rig/rig-core.js once (a classic script that sets window.Rig). */
export function loadRigCore(): Promise<Rig> {
  const w = window as unknown as { Rig?: Rig };
  if (w.Rig) return Promise.resolve(w.Rig);
  return (corePromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/rig/rig-core.js";
    s.onload = () => (w.Rig ? resolve(w.Rig) : reject(new Error("rig-core.js did not define Rig")));
    s.onerror = () => reject(new Error("could not load /rig/rig-core.js"));
    document.head.append(s);
  }));
}
export async function loadSkeleton(name = "human"): Promise<Skeleton> {
  const r = await fetch(`/rig/skeletons/${name}.json`, { cache: "no-store" });
  if (!r.ok) throw new Error(`skeleton ${name}: HTTP ${r.status}`);
  return r.json();
}
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("load " + src)); i.src = src; });

// ---------------------------------------------------------------- body.html build() (cut / tint / darker copied as is)
function cut(R: Rig, img: HTMLImageElement, o: { r: number[]; pivot: number[]; native?: number; poly?: number[][]; erase?: number[][] }): Part {
  const [x, y, w, h] = o.r, c = R.canvas(w, h), g = c.getContext("2d")!; g.imageSmoothingEnabled = false; g.save();
  if (o.poly) { g.beginPath(); o.poly.forEach(([px, py], i) => (i ? g.lineTo(px - x, py - y) : g.moveTo(px - x, py - y))); g.closePath(); g.clip(); }
  g.drawImage(img, x, y, w, h, 0, 0, w, h); g.restore(); for (const [ex, ey, ew, eh] of o.erase || []) g.clearRect(ex - x, ey - y, ew, eh);
  return { c, px: o.pivot[0] - x, py: o.pivot[1] - y, native: o.native || 0 };
}
function tint(R: Rig, part: Part, hex: string, keepRim = 0.16): Part {
  const c = R.canvas(part.c.width, part.c.height), g = c.getContext("2d")!; g.drawImage(part.c, 0, 0); const d = g.getImageData(0, 0, c.width, c.height), T = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t), dark = mix(T, [18, 14, 28], 0.62), light = mix(T, [255, 246, 226], 0.7);
  for (let i = 0; i < d.data.length; i += 4) { const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2]; if (d.data[i + 3] < 8) continue; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0, L = (r * 0.3 + gg * 0.59 + b * 0.11) / 255; if (L < keepRim || sat > 0.3) continue; const t = Math.min(1, Math.max(0, (L - keepRim) / 0.79)), col = t < 0.5 ? mix(dark, T, t * 2) : mix(T, light, (t - 0.5) * 2); d.data[i] = col[0]; d.data[i + 1] = col[1]; d.data[i + 2] = col[2]; }
  g.putImageData(d, 0, 0); return { ...part, c };
}
function darker(R: Rig, p: Part, k = 0.78): Part { const c = R.canvas(p.c.width, p.c.height), g = c.getContext("2d")!; g.drawImage(p.c, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); for (let i = 0; i < d.data.length; i += 4) { d.data[i] *= k; d.data[i + 1] *= k; d.data[i + 2] *= k; } g.putImageData(d, 0, 0); return { ...p, c }; }
const ang = (R: Rig, a: number[], b: number[]) => Math.atan2(b[0] - a[0], b[1] - a[1]) / R.D, dst = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export type Manifest = { parts: Record<string, { file: string; pivot: number[]; len?: number }>; soleBelowAnkle?: number; [k: string]: unknown };
export type Body = {
  set: string; M: Manifest; P: Record<string, Part>; sole: number; swordLen: number; helm: (Part | null)[]; shield: Part; sword: Part;
  far: Map<string, Part>; arrow: Part;
};

/** Load a part set from the saved files (like body.html) plus the two hero frames body.html harvests gear from. */
export async function loadBody(R: Rig, set: string): Promise<Body> {
  const PB = `/rig/parts/${encodeURIComponent(set)}/`, FR = "/sprites/autumn/frames/heroes/";
  const [M, A, C] = await Promise.all([fetch(PB + "manifest.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(`${set}/manifest.json: HTTP ${r.status}`); return r.json() as Promise<Manifest>; }), loadImg(FR + "base-05.png"), loadImg(FR + "champion-01.png")]);
  const IMG: Record<string, HTMLImageElement> = {};
  const bust = "?v=" + Date.now();
  await Promise.all(Object.entries(M.parts).map(async ([k, v]) => { IMG[k] = await loadImg(PB + v.file + bust); }));
  const P: Record<string, Part> = {};
  for (const n of Object.keys(M.parts)) P[n] = { c: IMG[n] as unknown as Cv, px: M.parts[n].pivot[0], py: M.parts[n].pivot[1], native: 0, len: M.parts[n].len };
  for (const n of ["upperArm", "foreArm", "thigh", "shin", "foot", "torso", "head", "pelvis"]) if (!P[n]) throw new Error(`set ${set} has no "${n}" part (the rig needs upperArm, foreArm, thigh, shin, foot, torso, head, pelvis)`);
  const far = new Map<string, Part>();
  for (const n of ["upperArm", "foreArm", "thigh", "shin", "foot"]) far.set(n, darker(R, P[n]));
  const GA = [55, 37];
  const sword = cut(R, A, { r: [44, 6, 48, 42], pivot: GA, native: ang(R, GA, [88, 11]), poly: [[47, 30], [56, 26], [90, 7], [92, 16], [64, 40], [60, 47], [50, 45], [46, 38]] });
  const helm = cut(R, C, { r: [64, 30, 30, 31], pivot: [79, 45], poly: [[66, 36], [70, 32], [76, 30], [84, 30], [90, 34], [93, 40], [93, 52], [92, 57], [88, 60], [80, 60], [74, 58], [70, 56], [67, 52], [65, 44]], erase: [[64, 53, 9, 9]] });
  const SH: number[][] = []; for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; SH.push([102 + Math.cos(a) * 11.5, 77 + Math.sin(a) * 20]); }
  const shield = cut(R, C, { r: [88, 54, 28, 46], pivot: [102, 77], poly: SH });
  // index.html's arrow (procedural, painted with rig-core's own shape helper)
  const arrow: Part = { c: R.paint(60, 10, (g) => { R.shape(g, [[2, 4], [48, 4], [48, 6], [2, 6]], "#d6c08c", { lw: 1.2 }); R.shape(g, [[48, 1], [58, 5], [48, 9]], "#d4dbe2", { lw: 1.2 }); R.shape(g, [[2, 1], [10, 4], [2, 5]], "#b04a3a", { lw: 1 }); }), px: 30, py: 5, native: 0 };
  return { set, M, P, sole: M.soleBelowAnkle ?? 0, swordLen: dst(GA, [88, 11]), sword, helm: [null, helm, tint(R, helm, "#7f93b4"), tint(R, helm, "#d8a838")], shield, far, arrow };
}

/** The part used for a body slot under the look (armour tier / gender variants when the set has them). */
export function partFor(R: Rig, B: Body, slot: string, look: Look, farSide = false): Part {
  let name = slot;
  const has = (n: string) => !!B.P[n];
  if (slot === "torso" && look.gender === "f") name = look.armour && has(`torsoF.t${look.armour}`) ? `torsoF.t${look.armour}` : has("torsoF.tunic") ? "torsoF.tunic" : "torso";
  else if (slot === "head" && look.gender === "f") name = has("headF.plain") ? "headF.plain" : "head";
  else if (look.armour && ["upperArm", "foreArm", "thigh", "shin", "foot", "torso"].includes(slot) && has(`${slot}.t${look.armour}`)) name = `${slot}.t${look.armour}`;
  if (!farSide) return B.P[name];
  const key = name;
  if (!B.far.has(key)) B.far.set(key, darker(R, B.P[name]));
  return B.far.get(key)!;
}
export function dimsOf(B: Body, skel: Skeleton, weapon: WeaponKind): Dims {
  const len = (n: string) => B.P[n].len ?? 0;
  return { thigh: len("thigh"), shin: len("shin"), upperArm: len("upperArm"), foreArm: len("foreArm"), sole: B.sole, weaponLen: weapon === "sword" || weapon === "none" ? B.swordLen : skel.weapons[weapon]?.length ?? B.swordLen };
}
function weaponPart(B: Body, look: Look): Part | null {
  if (look.weapon === "none") return null;
  if (look.weapon === "sword") return B.sword;
  const n = look.armour && B.P[`${look.weapon}.t${look.armour}`] ? `${look.weapon}.t${look.armour}` : look.weapon;
  return B.P[n] || null;
}
export function effectiveLook(clip: Clip, look: Look): Look {
  return look.weapon === "bow" || clip.weapon?.shield === false ? { ...look, shield: 0 } : look;
}

/** The pose and the frame (256x176, transparent) for clip time t: body.html drawFrame() with the clip as the motion. */
export function drawFrame(R: Rig, B: Body, skel: Skeleton, clip: Clip, look0: Look, t: number): { canvas: Cv; pose: Pose } {
  const look = effectiveLook(clip, look0), F = skel.frame, GX = F.groundX, GY = F.groundY;
  const canvas = R.canvas(F.w, F.h), g = canvas.getContext("2d")!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  const dims = dimsOf(B, skel, look.weapon);
  const s = sampleClip(R, clip, skel, t), S = solvePose(R, skel, dims, clip, s, { shield: look.shield, weapon: look.weapon }), u = S.u;
  const [bw, bh] = BUILD_SCALE[look.build] || [1, 1];
  g.save(); g.translate(GX, GY); g.scale(F.drawScale * bw, F.drawScale * bh); g.translate(-GX, -GY);
  const part = (n: string, far = false) => partFor(R, B, n, look, far);
  const leg = (L: Pose["legs"][number], far: boolean) => { R.limbAt(g, part("thigh", far), L.hj[0], L.hj[1], L.k.a1); R.limbAt(g, part("shin", far), L.k.J[0], L.k.J[1], L.k.a2); R.uprightAt(g, part("foot", far), L.k.E[0], L.k.E[1], L.tilt); };
  // back to front: far arm, far leg, pelvis, head + neck, torso, near leg, near arm, weapon
  R.limbAt(g, part("upperArm", true), S.shoulder[0], S.shoulder[1], S.armF.a1); R.limbAt(g, part("foreArm", true), S.armF.E[0], S.armF.E[1], S.armF.a2);
  leg(S.legs[0], true);
  R.uprightAt(g, B.P.pelvis, S.root[0], S.root[1], S.pelvisTilt);
  const hx = S.neck[0] + skel.headAt[0], hy = S.neck[1] + skel.headAt[1];
  R.uprightAt(g, part("head"), hx, hy, S.headTilt);
  if (look.hair && !look.helm && B.P.hair) R.uprightAt(g, B.P.hair, hx, hy, S.headTilt);
  if (look.helm && B.helm[look.helm]) { const v = R.rot(skel.helmAt[0], skel.helmAt[1], S.headTilt); R.uprightAt(g, B.helm[look.helm]!, hx + v[0], hy + v[1], S.headTilt); }
  R.uprightAt(g, part("torso"), S.waist[0], S.waist[1], S.lean);
  if (look.shield) R.uprightAt(g, B.shield, S.armF.H[0] + skel.shieldPose.at[0], S.armF.H[1] + skel.shieldPose.at[1], 0);
  leg(S.legs[1], false);
  const tr = clip.weapon?.trail, wp = weaponPart(B, look);
  if (look.weapon !== "bow" && wp && tr && u > tr.from && u < tr.to) {
    const n = tr.steps ?? 7, step = tr.step ?? 0.018, tipAt = (uu: number) => weaponTip(R, skel, dims, clip, S, uu);
    for (let i = 1; i <= n; i++) { const a = tipAt(u - i * step), b = tipAt(u - (i - 1) * step); g.strokeStyle = `rgba(255,255,255,${0.55 - i * 0.07})`; g.lineWidth = 9 - i; g.lineCap = "round"; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  }
  R.limbAt(g, part("upperArm"), S.shoulder[0], S.shoulder[1], S.armN.a1); R.limbAt(g, part("foreArm"), S.armN.E[0], S.armN.E[1], S.armN.a2);
  if (look.weapon === "bow" && wp) {
    const bw0 = skel.weapons.bow, at = bw0?.at || [6, 0], bx = S.armF.H[0] + at[0], by = S.armF.H[1] + at[1];
    R.uprightAt(g, wp, bx, by, 0);
    const st = bw0?.string, top = [bx + (st?.top[0] ?? -6), by + (st?.top[1] ?? -27)], bot = [bx + (st?.bottom[0] ?? -6), by + (st?.bottom[1] ?? 27)];
    g.strokeStyle = "#efe6cc"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(top[0], top[1]); g.lineTo(S.armN.H[0], S.armN.H[1]); g.lineTo(bot[0], bot[1]); g.stroke();
    const rel = clip.weapon?.release ?? 1;
    if (u < rel && S.draw > 0.04) R.limbAt(g, B.arrow, S.armN.H[0] + 22, S.armN.H[1], 0);
    else if (u >= rel && rel < 1) { const f = (u - rel) / (1 - rel); g.globalAlpha = 1 - f * f; R.limbAt(g, B.arrow, S.armF.H[0] + 36 + f * 120, S.armF.H[1], 0); g.globalAlpha = 1; }
  } else if (wp) {
    if (look.weapon === "sword") R.limbAt(g, wp, S.armN.H[0], S.armN.H[1], S.wa - wp.native);
    else {
      // heroRig.ts draws the set's weapons narrowed (spear 0.4 wide): rig-core's limbAt with a width scale
      const ws = skel.weapons[look.weapon], a = S.wa + (ws?.angle ?? 0);
      g.save(); g.translate(S.armN.H[0], S.armN.H[1]); g.rotate(-a * R.D); g.scale(ws?.width ?? 1, 1); g.drawImage(wp.c, -wp.px, -wp.py); g.restore();
    }
    // index.html: the spear's off hand closes over the shaft
    if (clip.limbs?.armF?.target === "grip" && clip.limbs.armF.mode === "ik" && !look.shield) R.limbAt(g, part("foreArm", true), S.armF.E[0], S.armF.E[1], S.armF.a2);
  }
  g.restore();
  return { canvas, pose: S };
}

/** body.html withBg(): grass, ground strip, contact shadow, then the frame. */
export function withBg(R: Rig, skel: Skeleton, cv: Cv): Cv {
  const F = skel.frame, b = R.canvas(F.w, F.h), g = b.getContext("2d")!;
  g.fillStyle = "#6f8d4e"; g.fillRect(0, 0, F.w, F.h); g.fillStyle = "#5f7e41"; g.fillRect(0, F.groundY + 1, F.w, F.h); g.fillStyle = "rgba(0,0,0,0.2)"; g.beginPath(); g.ellipse(F.groundX, F.groundY + 2, 26, 5, 0, 0, 7); g.fill(); g.drawImage(cv, 0, 0);
  return b;
}

/** Frame-space point -> point on the drawn frame (the draw scale about the ground point). */
export function frameXform(skel: Skeleton, look: Look) {
  const F = skel.frame, [bw, bh] = BUILD_SCALE[look.build] || [1, 1], sx = F.drawScale * bw, sy = F.drawScale * bh;
  return {
    to: (p: number[]) => [F.groundX + (p[0] - F.groundX) * sx, F.groundY + (p[1] - F.groundY) * sy],
    from: (p: number[]) => [F.groundX + (p[0] - F.groundX) / sx, F.groundY + (p[1] - F.groundY) / sy],
  };
}

export type SheetFrame = { clip: Clip; look?: Partial<Look>; t?: number; u?: number; label?: string };
/** Same layout and code as body.html's __rig.sheet(): R.sheet over withBg frames (scale default 1.2, game scale 0.255). */
export function sheet(R: Rig, B: Body, skel: Skeleton, frames: SheetFrame[], o: { cols?: number; scale?: number } = {}): Cv {
  return R.sheet(frames.map((f) => {
    const t = f.t ?? (f.u ?? 0) * f.clip.duration;
    return { canvas: withBg(R, skel, drawFrame(R, B, skel, f.clip, { ...DEFAULT_LOOK, ...f.look }, t).canvas), label: f.label };
  }), { cols: o.cols || 4, scale: o.scale || 1.2, gameScale: GAME_SCALE });
}
export { phaseAt };
