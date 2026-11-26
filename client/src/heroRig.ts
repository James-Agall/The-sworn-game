import {loadNpcHero, npcHeroFrame} from "./npcHero";
import { Texture } from "pixi.js";
import { sanitizeHeroAppearance, type HeroVisual } from "@colony/shared/protocol";
export type HeroPose = {
    state: "idle" | "walk" | "attack" | "hurt";
    phase: number;
    facing?: number;
};
type Vec = [
    number,
    number
];
type Part = {
    image: HTMLImageElement | HTMLCanvasElement;
    pivot: Vec;
    len: number;
};
type PartSpec = {
    file: string;
    pivot: Vec;
    len: number;
};
const base = "/rig/parts/grounded-v2/", parts = new Map<string, Part>(), variants = new Map<string, Part>();

const cache = new Map<string, {
    canvas: HTMLCanvasElement;
    texture: Texture;
    bodyHeight: number;
    buildScale: number;
}>();
const scales = new WeakMap<Texture, number>();
export const SKIN_COLORS = ["#f3cda7", "#e0ad7c", "#b77c50", "#805135", "#51362b"];
export const HAIR_COLORS = ["#25221f", "#654430", "#b88443", "#994c31", "#b8b4a5", "#e4d5a7"];
let ready = false, loading: Promise<void> | undefined;
const make = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
// Proportions (2026-11-27): limbs, torso and boots are lengthened along their shaft at load, so joint caps, fists,
// collars and toes keep their painted pixels. Per part family: [axis, from, to, extra] in the PNG's own pixels.
const LENGTHEN: Record<string, [ "x" | "y", number, number, number ]> = {
    upperArm: ["y", 9, 17, 3], foreArm: ["y", 9, 17, 3], thigh: ["y", 11, 21, 4], shin: ["y", 9, 17, 5],
    torso: ["y", 14, 24, 2], torsoF: ["y", 14, 24, 2], foot: ["x", 9, 13, 2],
};
function lengthen(name: string, p: Part): Part {
    const spec = LENGTHEN[name.split(".")[0]];
    if (!spec) return p;
    const [axis, from, to, extra] = spec, img = p.image, w = img.width, h = img.height, y = axis === "y";
    const c = make(w + (y ? 0 : extra), h + (y ? extra : 0)), g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    if (y) {
        g.drawImage(img, 0, 0, w, from, 0, 0, w, from);
        g.drawImage(img, 0, from, w, to - from, 0, from, w, to - from + extra);
        g.drawImage(img, 0, to, w, h - to, 0, to + extra, w, h - to);
    } else {
        g.drawImage(img, 0, 0, from, h, 0, 0, from, h);
        g.drawImage(img, from, 0, to - from, h, from, 0, to - from + extra, h);
        g.drawImage(img, to, 0, w - to, h, to + extra, 0, w - to, h);
    }
    const i = y ? 1 : 0, pivot: Vec = [...p.pivot];
    if (pivot[i] >= to) pivot[i] += extra;
    return { image: c, pivot, len: p.len + (y ? extra : 0) };
}
const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
export function loadHeroRig(): Promise<void> {
    return loading ??= (async () => {
        await loadNpcHero();
        try {
            const response = await fetch(base + "manifest.json");
            if (!response.ok)
                return;
            const manifest = await response.json() as {
                parts: Record<string, PartSpec>;
            };
            await Promise.all(Object.entries(manifest.parts).map(async ([name, p]) => { try {
                parts.set(name, lengthen(name, { image: await load(base + p.file), pivot: p.pivot, len: p.len }));
            }
            catch { } }));
            ready = ["head.m_plain", "torso.tunic", "pelvis", "upperArm", "foreArm", "thigh", "shin", "foot"].every(n => parts.has(n));
        }
        catch {
            ready = false;
        }
    })();
}
export const heroRigReady = () => ready;
export const rigTextureScale = (t: Texture) => scales.get(t);
export const heroBuildFactor = (v: HeroVisual) => [.93, 1, 1.07][sanitizeHeroAppearance(v.appearance).build];
function colored(name: string, skin: number, hair: number, far = false): Part | undefined {
    const key = `${name}/${skin}/${hair}/${far}`;
    const old = variants.get(key);
    if (old)
        return old;
    const p = parts.get(name);
    if (!p)
        return undefined;
    const c = make(p.image.width, p.image.height), g = c.getContext("2d")!;
    g.drawImage(p.image, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), target = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const sk = target(SKIN_COLORS[skin]), hc = target(HAIR_COLORS[hair]);
    for (let i = 0; i < d.data.length; i += 4) {
        const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2], l = (r * .3 + gg * .59 + b * .11);
        if (!d.data[i + 3])
            continue;
        const y = Math.floor(i / 4 / c.width);
        const skinArea = name.startsWith("head") || name.includes("bare")
            || (name.startsWith("foreArm") && y > c.height * .70)
            || (name.startsWith("torso") && y < c.height * .20);
        const isHair = name.startsWith("hair"), isSkin = skinArea && r > gg * 1.12 && gg > b * 1.08 && l > 55;
        if (isHair && l > 35) {
            for (let k = 0; k < 3; k++)
                d.data[i + k] = Math.min(255, hc[k] * l / 115);
        }
        else if (isSkin) {
            for (let k = 0; k < 3; k++)
                d.data[i + k] = Math.min(255, d.data[i + k] * sk[k] / [224, 173, 124][k]);
        }
        if (far)
            for (let k = 0; k < 3; k++)
                d.data[i + k] *= .78;
    }
    g.putImageData(d, 0, 0);
    const out = { ...p, image: c };
    variants.set(key, out);
    return out;
}
const D = Math.PI / 180, dir = (a: number): Vec => [Math.sin(a * D), Math.cos(a * D)], add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];
const rot = (x: number, y: number, a: number): Vec => [x * Math.cos(a * D) - y * Math.sin(a * D), x * Math.sin(a * D) + y * Math.cos(a * D)];
function ik(s: Vec, t: Vec, l1: number, l2: number, bend = 1) { const d = Math.min(l1 + l2 - .05, Math.max(Math.abs(l1 - l2) + .5, Math.hypot(t[0] - s[0], t[1] - s[1]))), b = Math.atan2(t[0] - s[0], t[1] - s[1]) / D, a1 = b + bend * Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))) / D, j = add(s, dir(a1), l1), a2 = Math.atan2(t[0] - j[0], t[1] - j[1]) / D; return { a1, a2, j, end: add(j, dir(a2), l2) }; }
const keyframes = (keys: number[][], u: number) => { for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
        let t = Math.max(0, (u - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
        t = t * t * (3 - 2 * t);
        return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * t;
    }
} return keys.at(-1)![1]; };
// Cubic motion carries velocity through anticipation, strike and recovery instead of stopping at each key.
function motion(keys: number[][], u: number) {
    for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i], before = keys[Math.max(0, i - 2)], after = keys[Math.min(keys.length - 1, i + 1)];
        const span = b[0] - a[0], t = Math.max(0, (u - a[0]) / span), t2 = t * t, t3 = t2 * t;
        const m0 = i === 1 ? 0 : (b[1] - before[1]) / (b[0] - before[0]) * span;
        const m1 = i === keys.length - 1 ? 0 : (after[1] - a[1]) / (after[0] - a[0]) * span;
        return (2*t3-3*t2+1)*a[1] + (t3-2*t2+t)*m0 + (-2*t3+3*t2)*b[1] + (t3-t2)*m1;
    }
    return keys.at(-1)![1];
}
// One figure, one outline (2026-11-27). Every body part is drawn without its own painted rim; afterwards the outline is
// derived from the composited figure: the rim colour on edges against air or gear, a soft seam in the upper part's own
// shade where two body parts overlap, and nothing where they are one form across a joint (JOINS). Gear (head, hair,
// helm, weapons, shield, horse) keeps its painted outline so it still reads as a separate object.
type Layer = { name: string; part: Part; at: Vec; angle: number; limb: boolean; ws: number; hs: number; m: DOMMatrix };
const RIM = [25, 20, 20], BODY = /^(torso|pelvis|upperArm|foreArm|thigh|shin|foot|head)\b/;
// [layer, layer, joint, radius]: seamless pairs; with a joint only within that radius (bake px) of it.
const JOINS: [string, string, string?, number?][] = [
    ["pelvis", "thigh:near"], ["pelvis", "thigh:far"], ["pelvis", "torso"],
    ["thigh:near", "shin:near"], ["thigh:far", "shin:far"], ["upperArm:near", "foreArm:near"], ["upperArm:far", "foreArm:far"],
    ["torso", "upperArm:near", "shoulder:near", 7], ["torso", "upperArm:far", "shoulder:far", 7], ["torso", "head", "neck", 4],
];
const rimlessCache = new WeakMap<object, HTMLCanvasElement>(), solidCache = new WeakMap<object, Map<number, HTMLCanvasElement>>();
// The part with its dark rim (near-black pixels within 2 px of its own edge, from row `top` down) repainted from the
// neighbouring fill. Heads keep their painted face and only lose the rim around the neck.
function rimless(src: HTMLImageElement | HTMLCanvasElement, top = 0) {
    const old = rimlessCache.get(src);
    if (old) return old;
    const w = src.width, h = src.height, c = make(w, h), g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, w, h), d = im.data, state = new Uint8Array(w * h); // 0 fill, 1 rim, 2 repainted
    const alpha = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (y < top || !d[i + 3] || d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11 >= 60) continue;
        let edge = false;
        for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) if (alpha(x + dx, y + dy) < 64) { edge = true; break; }
        if (edge) state[y * w + x] = 1;
    }
    for (let pass = 0; pass < 4; pass++) {
        const done: number[] = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (state[y * w + x] !== 1) continue;
            const sum = [0, 0, 0];
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h || state[ny * w + nx] === 1 || alpha(nx, ny) < 64) continue;
                for (let k = 0; k < 3; k++) sum[k] += d[(ny * w + nx) * 4 + k];
                n++;
            }
            if (n) { for (let k = 0; k < 3; k++) d[(y * w + x) * 4 + k] = sum[k] / n; done.push(y * w + x); }
        }
        for (const i of done) state[i] = 2;
    }
    g.putImageData(im, 0, 0);
    rimlessCache.set(src, c);
    return c;
}
// Opaque silhouette of a part in the layer-id colour rgb(slot, 0, 0), cached per part image and slot.
function solid(src: HTMLImageElement | HTMLCanvasElement, slot: number) {
    const bySlot = solidCache.get(src) ?? new Map<number, HTMLCanvasElement>(), old = bySlot.get(slot);
    if (old) return old;
    const c = make(src.width, src.height), g = c.getContext("2d")!;
    g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = slot; im.data[i + 1] = im.data[i + 2] = 0; im.data[i + 3] = im.data[i + 3] >= 96 ? 255 : 0; }
    g.putImageData(im, 0, 0);
    solidCache.set(src, bySlot.set(slot, c));
    return c;
}
function place(g: CanvasRenderingContext2D, l: Layer, image: CanvasImageSource) {
    g.setTransform(l.m); g.translate(...l.at); g.rotate(l.angle * D * (l.limb ? -1 : 1)); g.scale(l.ws, l.hs); g.drawImage(image, -l.part.pivot[0], -l.part.pivot[1]);
}
function compose(g: CanvasRenderingContext2D, layers: Layer[], joints: Map<string, Vec>) {
    const W = g.canvas.width, H = g.canvas.height, keep = g.getTransform(), ids = make(W, H), ig = ids.getContext("2d", { willReadFrequently: true })!;
    ig.imageSmoothingEnabled = false;
    const body = layers.map(l => BODY.test(l.name)), slotOf = new Map(layers.map((l, k) => [l.name, k + 1]));
    layers.forEach((l, k) => {
        place(g, l, body[k] ? rimless(l.part.image, l.name === "head" ? Math.round(l.part.image.height * .66) : 0) : l.part.image);
        place(ig, l, solid(l.part.image, k + 1));
    });
    const joins = new Map<number, [Vec | undefined, number]>();
    for (const [a, b, joint, r] of JOINS) { const s = slotOf.get(a), t = slotOf.get(b); if (s && t) joins.set(s * 64 + t, [joint ? joints.get(joint) : undefined, r ?? 0]).set(t * 64 + s, [joint ? joints.get(joint) : undefined, r ?? 0]); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const im = g.getImageData(0, 0, W, H), d = im.data, src = d.slice(), id = ig.getImageData(0, 0, W, H).data;
    const slot = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || !id[(y * W + x) * 4 + 3] ? 0 : id[(y * W + x) * 4];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, a = src[i + 3];
        if (a < 8) continue;
        const s = slot(x, y) || slot(x - 1, y) || slot(x + 1, y) || slot(x, y - 1) || slot(x, y + 1);
        if (!s || !body[s - 1]) continue;
        let mode = a < 128 ? 2 : 0;
        for (const [nx, ny] of mode ? [] : [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || src[(ny * W + nx) * 4 + 3] < 128) { mode = 2; break; }
            const t = slot(nx, ny);
            if (!t || t >= s) continue;
            if (!body[t - 1]) { mode = 2; break; }
            const join = joins.get(s * 64 + t);
            if (!join || (join[0] && Math.hypot(x - join[0][0], y - join[0][1]) > join[1])) mode = 1;
        }
        if (mode) for (let k = 0; k < 3; k++) d[i + k] = src[i + k] + (RIM[k] - src[i + k]) * (mode === 2 ? 1 : .45);
    }
    g.putImageData(im, 0, 0);
    g.setTransform(keep);
}
// Skeleton (bake px). Legs ~47% of the height (hip joint 48 above the sole), arms reach mid-thigh, head ~1/5.5.
// ARM_K rescales the hand-space attack paths that were tuned for the old 13 + 16 px arm.
const THIGH = 20, SHIN = 19, HIP = 48, UPPER = 16, LOWER = 19, ARM_K = (UPPER + LOWER) / 29, HORSE_K = 101 / 89;
// Walk: main.ts advances the phase by 1 per 11 world px and the bake is 101 px per 25 world px, so a planted foot
// must travel 0.62 (stance) x 11 x 101 / 25 = 27.5 px backwards per stance to stay put on the ground.
const STRIDE = .62 * 11 * 101 / 25 / 2, REACH = (THIGH + SHIN) * .995, TOE: Vec = [12, 9.5], HEEL: Vec = [-4, 9.5];
// Attack footwork per weapon (on foot): the front (near) foot steps in, the rear foot stays planted.
// [windup u, strike u, step px, hip lunge back/forward px, dip px]
const FOOTWORK: Record<string, [number, number, number, number, number, number]> = {
    sword: [.28, .49, 8, -2, 4, 1.5], axe: [.36, .58, 7, -3, 4, 2], spear: [.27, .5, 10, -2, 6, 1.2], bow: [.3, .5, 0, 0, -1, .6], unarmed: [.3, .5, 5, -1, 2, 1],
};
// The NPC-style male sheets are the player art. The painted-part rig is drawn instead when a caller asks for it
// (allowRig: contact sheets, reviews) or the page was opened with `?rig=1` (James's in-game rig review).
const preferRig = typeof location !== "undefined" && new URLSearchParams(location.search).get("rig") === "1";
export function heroFrame(v: HeroVisual, pose: HeroPose, mounted = false, allowRig = false) {
    if (!(allowRig || preferRig) || !ready) {
        const authored = npcHeroFrame(v, pose, mounted);
        if (authored) scales.set(authored.texture, 25 / authored.bodyHeight);
        return authored;
    }
    const a = sanitizeHeroAppearance(v.appearance), phase = pose.state === "attack" ? Math.max(0, Math.min(1, pose.phase)) : ((pose.phase % 1) + 1) % 1;
    const n = pose.state === "attack" ? 36 : pose.state === "walk" ? 32 : 12, q = Math.round(phase * n) / n;
    const key = JSON.stringify([{ ...a, name: "", look: "wanderer" }, v.armour, v.weapon, v.weaponTier, v.helmTier, v.shieldTier, v.helmet, v.shield, pose.state, q, mounted, pose.facing ?? 1]);
    const old = cache.get(key);
    if (old)
        return old;
    const tier = Math.max(0, Math.min(3, v.armour)), material = tier ? `t${tier}` : "cloth", fore = tier ? `t${tier}` : "bracer";
    const get = (name: string, far = false) => colored(name, a.skin, a.hairColor, far);
    const torso = get(`${a.gender === "f" ? "torsoF" : "torso"}.${tier ? `t${tier}` : "tunic"}`), head = get(a.gender === "f" ? `headF.${["plain", "stern", "freckled"][a.face]}` : `head.${["m_plain", "m_stern", "m_beard"][a.face]}`);
    const required = [torso, head, get(`upperArm.${material}`), get(`foreArm.${fore}`), get("pelvis"), get("thigh"), get("shin"), get("foot")];
    const wt = Math.max(1, Math.min(3, v.weaponTier || 1)), weapon = v.weapon === "unarmed" ? undefined : get(`${v.weapon}.t${wt}`);
    const helm = v.helmet ? get(`helm.t${v.helmTier || 1}`) : undefined, shield = v.shield && v.weapon !== "bow" ? get(`shield.t${v.shieldTier || 1}`) : undefined;
    if (required.some(p => !p) || (v.helmet && !helm) || (v.shield && !shield && v.weapon !== "bow") || (v.weapon !== "unarmed" && !weapon))
        return undefined;
    const c = make(256, mounted ? 240 : 192), g = c.getContext("2d", { willReadFrequently: true })!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const moving = pose.state === "walk", attack = pose.state === "attack", sw = Math.sin(q * Math.PI * 2), u = attack ? q : 0;
    const horse = mounted ? parts.get(`horse.${a.horse}.${moving ? Math.floor(q * 4) % 4 : 0}`) : undefined;
    if (mounted && !horse) return undefined;
    const ground = mounted ? 211 : 163;
    const saddleHeight = horse ? (horse.image.height - horse.pivot[1] - 3) * HORSE_K : 0;
    const hipBase = mounted ? ground - saddleHeight : ground - HIP - 2;
    const idle = pose.state === "idle", hurt = pose.state === "hurt";
    // legFwd: +1 when the near foot is forward (heel strike at q = 0), -1 at its toe-off; hips and arms follow it.
    const legFwd = moving && !mounted ? Math.cos(2 * Math.PI * (q - .06)) : 0, breath = idle ? .45 * Math.sin(q * Math.PI * 2 + 1) : 0;
    const steps = FOOTWORK[v.weapon] ?? FOOTWORK.sword, [wind, strike, stepLen, back, lunge, dip] = steps;
    const hump = (u0: number, u1: number) => u > u0 && u < u1 ? Math.sin(Math.PI * (u - u0) / (u1 - u0)) : 0;
    const step = attack && !mounted ? motion([[0, 0], [wind, -1], [strike, stepLen], [.8, stepLen], [1, 0]], u) : 0;
    const stepLift = attack && !mounted && stepLen ? 3 * hump(wind * .6, strike) + 2 * hump(.8, 1) : 0;
    // Planted feet (ankle targets); the heel and toe roll keep the sole on the ground while the ankle moves.
    const roll = (x: number, tilt: number, about: Vec): Vec => { const r = rot(about[0], about[1], tilt); return [x + about[0] - r[0], ground - 10 + about[1] - r[1]]; };
    const footAt = (far: boolean): { ankle: Vec; tilt: number } => {
        if (!moving) {
            const x = 120 + (far ? -4 : 4) + (far ? 0 : step), lift = far ? 0 : stepLift;
            return { ankle: [x, ground - 10 - lift], tilt: lift > .3 ? -6 * lift / 3 : 0 };
        }
        const p = (q + (far ? .5 : 0)) % 1, base = 120 + (far ? -1 : 1);
        const stance = (pp: number) => {
            const x = base + STRIDE - 2 * STRIDE * pp / .62;
            if (pp < .08) return { ankle: roll(x, -10 * (1 - pp / .08), HEEL), tilt: -10 * (1 - pp / .08) };
            if (pp > .4) { const t = 24 * Math.min(1, (pp - .4) / .22) ** 1.5; return { ankle: roll(x, t, TOE), tilt: t }; }
            return { ankle: [x, ground - 10] as Vec, tilt: 0 };
        };
        if (p < .62) return stance(p);
        const t = (p - .62) / .38, from = stance(.62), to = stance(0), e = t * t * (3 - 2 * t);
        return { ankle: [from.ankle[0] + (to.ankle[0] - from.ankle[0]) * e, from.ankle[1] + (to.ankle[1] - from.ankle[1]) * t - 7 * Math.sin(Math.PI * t) ** 1.3], tilt: motion([[0, from.tilt], [.4, 4], [.8, -12], [1, to.tilt]], t) };
    };
    const feet = mounted ? undefined : [footAt(false), footAt(true)];
    const hipX = (far: boolean, x: number) => x + (far ? -1 : 1) * (moving ? 1 + 1.2 * legFwd : 2);
    let rootX = 120 + (attack && !mounted ? motion([[0, 0], [wind, back], [strike, lunge], [.8, lunge * .7], [1, 0]], u) : 0)
        + (hurt ? motion([[0, 0], [.18, -2.5], [.5, -1.5], [1, 0]], q) : 0) + (idle ? .6 * Math.sin(q * Math.PI * 2) : 0);
    let rootY = hipBase + (attack && !mounted ? motion([[0, 0], [wind, .5], [strike + .03, dip], [.8, dip * .6], [1, 0]], u) : 0) + (hurt ? motion([[0, 0], [.2, 1.5], [1, 0]], q) : 0);
    // The pelvis drops as far as needed for every planted foot to stay on the ground (heel strike / toe-off dip).
    if (feet) feet.forEach((f, i) => { const dx = f.ankle[0] - hipX(i === 1, rootX); rootY = Math.max(rootY, f.ankle[1] - Math.sqrt(Math.max(0, REACH * REACH - dx * dx)) - 2); });
    const lean = attack ? motion([[0, 0], [.30, -6], [.52, mounted ? 7 : 11], [.72, 5], [1, 0]], u) : pose.state === "hurt" ? motion([[0, 0], [.18, -10], [.42, -6], [.72, 2], [1, 0]], q) : moving ? 2 + Math.sin(q * Math.PI * 2 + .4) * (mounted ? 2 : 1.3) : sw * .6;
    const root: Vec = [rootX, rootY];
    if (pose.facing === -1) {
        g.translate(240, 0);
        g.scale(-1, 1);
    }
    // Authored coats keep leather/cloth colours intact. Every frame carries a fitted saddle pivot.
    const layers: Layer[] = [], joints = new Map<string, Vec>();
    const draw = (name: string, p: Part | undefined, at: Vec, angle = 0, limb = false, ws = 1, hs = 1) => { if (p) layers.push({ name, part: p, at, angle, limb, ws, hs, m: g.getTransform() }); };
    const mark = (name: string, at: Vec) => { const pt = g.getTransform().transformPoint(new DOMPoint(at[0], at[1])); joints.set(name, [pt.x, pt.y]); };
    if (horse) draw("horse", horse, [120, hipBase], 0, false, HORSE_K, HORSE_K);
    const factor = heroBuildFactor(v), width = [.88, 1, 1.16][a.build];
    g.save();
    g.translate(root[0], mounted ? root[1] : ground);
    g.scale(width, factor);
    g.translate(-root[0], -(mounted ? root[1] : ground));
    const waist: Vec = [root[0], root[1] - 1], up = (h: number, x = 0) => add(waist, rot(x, -h - breath, lean)), neck = up(30, 2);
    // The arm drawn behind the torso hangs from a shoulder 4 px further forward so it stays hidden behind the back.
    // Shoulders counter-rotate against the hips while walking (near shoulder back when the near leg is forward).
    const shoulder = up(28, (shield ? 1 : -3) + (shield ? 1 : -1) * legFwd), farShoulder = up(28, 1 + legFwd);
    let ua = 12, fe = 24, wa = 105;
    if (attack) {
        const axe = v.weapon === "axe", spear = v.weapon === "spear", bow = v.weapon === "bow";
        ua = keyframes(spear ? [[0, 10], [.35, -65], [.65, 88], [1, 10]] : bow ? [[0, 25], [.3, 90], [.75, 90], [1, 25]] : [[0, 12], [.3, axe ? 190 : 150], [.45, axe ? 195 : 160], [.65, 45], [1, 12]], u);
        fe = keyframes(spear ? [[0, 60], [.35, 120], [.65, 0], [1, 60]] : bow ? [[0, 20], [.35, 0], [.8, 0], [1, 20]] : [[0, 24], [.4, 20], [.65, 5], [1, 24]], u);
        wa = spear ? 90 : bow ? 0 : keyframes([[0, 105], [.3, 195], [.45, 200], [.65, 65], [1, 105]], u);
    }
    else if (moving) {
        ua += mounted ? sw * 4 : -17 * legFwd;
        fe += Math.sin(q * Math.PI * 2 + .6) * 7;
        wa += Math.sin(q * Math.PI * 2 - .35) * 8;
    }
    if (attack && (v.weapon === "sword" || v.weapon === "axe")) {
        const axe = v.weapon === "axe", windup = axe ? .36 : .28, strike = axe ? .58 : .49;
        ua = motion([[0, 12], [windup, axe ? 158 : 125], [strike, mounted ? 65 : 56], [.76, 28], [1, 12]], u);
        fe = motion([[0, 24], [windup, axe ? -38 : -24], [strike, 12], [.78, 32], [1, 24]], u);
        wa = motion([[0, 105], [windup, axe ? 222 : 198], [strike, mounted ? 64 : 48], [.78, 66], [1, 105]], u);
    }
    if (v.weapon === "bow" && !attack) {
        ua = 42;
        fe = 20;
        wa = 0;
    }
    const upper = UPPER, lower = LOWER;
    let elbow = add(shoulder, dir(ua), upper), hand = add(elbow, dir(ua + fe), lower);
    // Pose references supply readable guards; hand-space arcs keep elbow and wrist connected.
    if (attack && (v.weapon === "sword" || v.weapon === "axe")) {
        const axe = v.weapon === "axe", wind = axe ? .36 : .28, impact = axe ? .56 : .48;
        const rest = add(shoulder, add(dir(12), dir(36), lower / upper), upper);
        const x = motion([[0, rest[0]-shoulder[0]], [wind, (axe ? -3 : 4) * ARM_K], [impact, 26 * ARM_K], [.72, 18 * ARM_K], [1, rest[0]-shoulder[0]]], u);
        const y = motion([[0, rest[1]-shoulder[1]], [wind, (axe ? -23 : -18) * ARM_K], [impact, (mounted ? 5 : 1) * ARM_K], [.72, 18 * ARM_K], [1, rest[1]-shoulder[1]]], u);
        const swing = ik(shoulder, add(shoulder, [x, y]), upper, lower, -1);
        elbow = swing.j; hand = swing.end;
        wa = motion([[0, 105], [wind*.8, 165], [wind, axe ? 215 : 205], [impact, mounted ? 65 : 55], [.68, axe ? 25 : 35], [.86, 80], [1, 105]], u);
    }
    if (attack && (v.weapon === "spear" || v.weapon === "bow")) {
        const bow = v.weapon === "bow", rest = add(shoulder, add(dir(bow ? 42 : 12), dir(bow ? 62 : 36), lower/upper), upper);
        const x = motion(bow ? [[0, rest[0]-shoulder[0]], [.34, 26 * ARM_K], [.78, 26 * ARM_K], [1, rest[0]-shoulder[0]]] : [[0, rest[0]-shoulder[0]], [.27, 3 * ARM_K], [.5, 28 * ARM_K], [.68, 25 * ARM_K], [1, rest[0]-shoulder[0]]], u);
        const y = motion([[0, rest[1]-shoulder[1]], [.32, (bow ? -7 : 7) * ARM_K], [.72, (bow ? -7 : 5) * ARM_K], [1, rest[1]-shoulder[1]]], u);
        const reach = ik(shoulder, add(shoulder,[x,y]), upper, lower, -1); elbow=reach.j;hand=reach.end;
        wa = bow ? 0 : motion([[0,105],[.28,90],[.72,90],[1,105]],u);
    }
    const shieldShoulder = up(26, 5 - legFwd);
    const freeArm = 4 + (mounted ? -sw * 4 : 22 * legFwd) + (idle ? 2 * Math.sin(q * Math.PI * 2) : 0);
    let farElbow = add(farShoulder, dir(shield ? 40 : freeArm), upper), farHand = add(farElbow, dir(shield ? 95 : freeArm + 16), lower);
    if (v.weapon === "spear" && !shield) {
        // Two-handed spear: the free hand grips the shaft 13 px behind the leading hand.
        const grip = ik(farShoulder, add(hand, dir(wa), -10), upper, lower, -1);
        farElbow = grip.j;
        farHand = grip.end;
    }
    if (shield) {
        // Near (shield) arm: the upper arm hangs at the ribs, the forearm points forward across the body.
        farElbow = add(shieldShoulder, dir(10 + lean * .5 + (moving ? (mounted ? sw : -legFwd) * 4 : 0)), upper);
        farHand = add(farElbow, dir(100 + lean * .5), lower);
    }
    if (v.weapon === "bow" && attack) {
        const pull: Vec = [hand[0] - ARM_K * motion([[0, 5], [.34, 24], [.65, 24], [.74, 28], [.83, 18], [1, 5]], u), hand[1]];
        const arm = ik(farShoulder, pull, upper, lower, -1);
        farElbow = arm.j;
        farHand = arm.end;
    }
    const arm = (far: boolean, held?: () => void) => { const el = far ? farElbow : elbow, ha = far ? farHand : hand, origin = far ? (shield ? shieldShoulder : farShoulder) : shoulder, shaded = shield ? !far : far, side = far ? "far" : "near"; mark(`shoulder:${side}`, origin); draw(`upperArm:${side}`, get(`upperArm.${material}`, shaded), origin, Math.atan2(el[0] - origin[0], el[1] - origin[1]) / D, true); held?.(); draw(`foreArm:${side}`, get(`foreArm.${fore}`, shaded), el, Math.atan2(ha[0] - el[0], ha[1] - el[1]) / D, true); };
    const leg = (far: boolean) => {
        const hip: Vec = mounted ? [root[0] + (far ? -2 : 2), root[1] + 2] : [hipX(far, root[0]), root[1] + 2];
        let knee: Vec, end: Vec, a1: number, a2: number, tilt = 0;
        if (mounted) {
            a1 = (far ? 70 : 74) + (moving ? Math.sin(q*Math.PI*2 + (far ? Math.PI : 0))*2 : 0);
            a2 = -4 - (moving ? sw*2 : 0);
            knee = add(hip, dir(a1), THIGH);
            end = add(knee, dir(a2), SHIN);
        }
        else {
            const f = feet![far ? 1 : 0], solve = ik(hip, f.ankle, THIGH, SHIN);
            a1 = solve.a1;
            a2 = solve.a2;
            knee = solve.j;
            end = solve.end;
            tilt = f.tilt;
        }
        const side = far ? "far" : "near";
        draw(`thigh:${side}`, get(tier ? `thigh.t${tier}` : "thigh", far), hip, a1, true);
        draw(`shin:${side}`, get(tier ? `shin.t${tier}` : "shin", far), knee, a2, true);
        draw(`foot:${side}`, get(tier ? `foot.t${tier}` : "foot", far), end, tilt);
    };
    // Back to front: far (weapon) arm, far leg, pelvis, near leg, torso over both thigh tops, head over the collar, near
    // arm. A held weapon goes between the upper arm and the forearm so the fist closes over the grip; the shield is
    // strapped to the near forearm with the elbow showing behind it.
    const held = () => draw("weapon", weapon, hand, wa + (v.weapon === "axe" ? 180 : 0), true, v.weapon === "spear" ? .4 : v.weapon === "sword" ? .55 : 1);
    if (shield) arm(false, held);
    else arm(true);
    leg(true);
    draw("pelvis", get("pelvis"), root);
    leg(false);
    const hairName = ["", "short", "long", "ponytail"][a.hair];
    if (hairName && !helm && a.hair > 1)
        draw("hairBack", get(`hairBack.${hairName}`), neck, lean * .25);
    draw("torso", torso, waist, lean, false, (a.gender === "f" ? 22.5 : 25) / Math.max(1, torso!.image.width - 4));
    mark("neck", neck);
    draw("head", head, neck, lean * .25);
    if (hairName && !helm)
        draw("hair", get(`hair.${hairName}`), neck, lean * .25);
    if (helm)
        draw("helm", helm, neck, lean * .25);
    if (shield) {
        arm(true);
        const k = .5, fa = Math.atan2(farHand[0] - farElbow[0], farHand[1] - farElbow[1]) / D;
        draw("shield", shield, add(add(farElbow, [(farHand[0] - farElbow[0]) * k, (farHand[1] - farElbow[1]) * k]), dir(fa + 90), 1.5), lean - 5, false, (shield.image.height - 4) / (shield.image.width - 4), 1);
    }
    else arm(false, held);
    compose(g, layers, joints);
    if (v.weapon === "bow" && weapon) {
        g.strokeStyle = "#b3a48b";
        g.lineWidth = .65;
        const pull = attack && u < .7 ? farHand : [hand[0] - 3, hand[1]];
        g.beginPath();
        g.moveTo(hand[0] - 3, hand[1] - 24);
        g.lineTo(pull[0], pull[1]);
        g.lineTo(hand[0] - 3, hand[1] + 24);
        g.stroke();
    }
    g.restore();
    const texture = Texture.from(c);
    texture.source.scaleMode = "linear";
    // Idle is ~103 px from sole to hair top (91 before the 2026-11-27 proportions), so 25 px in game as before.
    const bodyHeight = 101;
    scales.set(texture, 25 / bodyHeight);
    const value = { canvas: c, texture, bodyHeight, buildScale: factor };
    cache.set(key, value);
    if (cache.size > 384) {
        const first = cache.keys().next().value!;
        cache.delete(first);
    } // Active scene sprites retain their textures; renderer GC reclaims unused sources.
    return value;
}
