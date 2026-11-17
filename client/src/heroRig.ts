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
const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
export function loadHeroRig(): Promise<void> {
    return loading ??= (async () => {
        try {
            const response = await fetch(base + "manifest.json");
            if (!response.ok)
                return;
            const manifest = await response.json() as {
                parts: Record<string, PartSpec>;
            };
            await Promise.all(Object.entries(manifest.parts).map(async ([name, p]) => { try {
                parts.set(name, { image: await load(base + p.file), pivot: p.pivot, len: p.len });
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
function draw(g: CanvasRenderingContext2D, p: Part | undefined, at: Vec, angle = 0, limb = false, widthScale = 1, heightScale = 1) { if (!p)
    return; g.save(); g.translate(...at); g.rotate(angle * D * (limb ? -1 : 1)); g.scale(widthScale, heightScale); g.drawImage(p.image, -p.pivot[0], -p.pivot[1]); g.restore(); }
export function heroFrame(v: HeroVisual, pose: HeroPose, mounted = false) {
    if (!ready)
        return undefined;
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
    const c = make(256, mounted ? 240 : 192), g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const moving = pose.state === "walk", attack = pose.state === "attack", sw = Math.sin(q * Math.PI * 2), u = attack ? q : 0;
    const horse = mounted ? parts.get(`horse.${a.horse}.${moving ? Math.floor(q * 4) % 4 : 0}`) : undefined;
    if (mounted && !horse) return undefined;
    const ground = mounted ? 211 : 163;
    const saddleHeight = horse ? horse.image.height - horse.pivot[1] - 3 : 0;
    const hipBase = mounted ? ground - saddleHeight : ground - 39;
    const bob = mounted ? 0 : moving ? Math.cos(q * Math.PI * 4) * .8 : Math.sin(q * Math.PI * 2) * .5;
    const lean = attack ? motion([[0, 0], [.30, -6], [.52, mounted ? 7 : 11], [.72, 5], [1, 0]], u) : pose.state === "hurt" ? -8 : moving ? 2 + sw * (mounted ? 1.2 : 1.8) : 0;
    const root: Vec = [120 + (attack && !mounted ? motion([[0, 0], [.3, -1.5], [.54, 2.5], [1, 0]], u) : 0), hipBase + bob];
    if (pose.facing === -1) {
        g.translate(240, 0);
        g.scale(-1, 1);
    }
    // Authored coats keep leather/cloth colours intact. Every frame carries a fitted saddle pivot.
    if (horse) draw(g, horse, [120, hipBase]);
    const factor = heroBuildFactor(v), width = [.88, 1, 1.16][a.build];
    g.save();
    g.translate(root[0], mounted ? root[1] : ground);
    g.scale(width, factor);
    g.translate(-root[0], -(mounted ? root[1] : ground));
    const waist: Vec = [root[0], root[1] - 1], up = (h: number, x = 0) => add(waist, rot(x, -h, lean)), neck = up(29, 2), shoulder = up(25, -4);
    let ua = 12, fe = 24, wa = 105;
    if (attack) {
        const axe = v.weapon === "axe", spear = v.weapon === "spear", bow = v.weapon === "bow";
        ua = keyframes(spear ? [[0, 10], [.35, -65], [.65, 88], [1, 10]] : bow ? [[0, 25], [.3, 90], [.75, 90], [1, 25]] : [[0, 12], [.3, axe ? 190 : 150], [.45, axe ? 195 : 160], [.65, 45], [1, 12]], u);
        fe = keyframes(spear ? [[0, 60], [.35, 120], [.65, 0], [1, 60]] : bow ? [[0, 20], [.35, 0], [.8, 0], [1, 20]] : [[0, 24], [.4, 20], [.65, 5], [1, 24]], u);
        wa = spear ? 90 : bow ? 0 : keyframes([[0, 105], [.3, 195], [.45, 200], [.65, 65], [1, 105]], u);
    }
    else if (moving) {
        ua += sw * (mounted ? 4 : 17);
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
    const upper = 13, lower = 16, elbow = add(shoulder, dir(ua), upper), hand = add(elbow, dir(ua + fe), lower);
    const shieldShoulder = up(24, 5);
    let farElbow = add(shoulder, dir(shield ? 40 : -15 - sw * (moving ? 22 : 0)), upper), farHand = add(farElbow, dir(shield ? 95 : 10), lower);
    if (shield) {
        // Right (near) arm: elbow at the ribs, forearm tucked across the body.
        const guard = ik(shieldShoulder, up(10, 7 + (moving ? sw : 0)), upper, lower, -1);
        farElbow = guard.j;
        farHand = guard.end;
    }
    if (v.weapon === "bow" && attack) {
        const pull: Vec = [hand[0] - keyframes([[0, 2], [.35, 19], [.72, 20], [.8, 1], [1, 2]], u), hand[1]];
        const arm = ik(shoulder, pull, upper, lower, -1);
        farElbow = arm.j;
        farHand = arm.end;
    }
    const arm = (far: boolean) => { const el = far ? farElbow : elbow, ha = far ? farHand : hand, origin = far && shield ? shieldShoulder : shoulder, shaded = shield ? !far : far; draw(g, get(`upperArm.${material}`, shaded), origin, Math.atan2(el[0] - origin[0], el[1] - origin[1]) / D, true); draw(g, get(`foreArm.${fore}`, shaded), el, Math.atan2(ha[0] - el[0], ha[1] - el[1]) / D, true); };
    const leg = (far: boolean) => {
        const hip: Vec = [root[0] + (far ? -2 : 2), root[1] + 2];
        let knee: Vec, end: Vec, a1: number, a2: number, tilt = 0;
        if (mounted) {
            a1 = far ? 70 : 74;
            a2 = -4;
            knee = add(hip, dir(a1), 16);
            end = add(knee, dir(a2), 14);
        }
        else {
            const p = (q + (far ? .5 : 0)) % 1, stance = p < .62, swing = (p - .62) / .38;
            const t = Math.max(0, swing), t2 = t*t, t3 = t2*t;
            // Matching velocity at toe-off/heel-strike avoids the old abrupt direction changes.
            const f = !moving ? 0 : stance ? 8 - 16*p/.62 : (2*t3-3*t2+1)*-8 + (-2*t3+3*t2)*8 + (2*t3-3*t2+t)*(-16/.62*.38);
            const lift = moving && !stance ? 5.5 * Math.sin(t * Math.PI) ** 2 : 0;
            const solve = ik(hip, [hip[0] + (far ? -3 : 3) + f, ground - 10 - lift], 16, 14);
            a1 = solve.a1;
            a2 = solve.a2;
            knee = solve.j;
            end = solve.end;
            tilt = !moving ? 0 : stance ? 8 * Math.sin(p/.62 * Math.PI*2) : -15 * Math.sin(t * Math.PI);
        }
        draw(g, get(tier ? `thigh.t${tier}` : "thigh", far), hip, a1, true);
        draw(g, get(tier ? `shin.t${tier}` : "shin", far), knee, a2, true);
        draw(g, get(tier ? `foot.t${tier}` : "foot", far), end, tilt);
    };
    // Weapon in the left/far hand; the right shield arm is drawn over the torso.
    if (shield) { arm(false); draw(g, weapon, hand, wa + (v.weapon === "axe" ? 180 : 0), true, v.weapon === "spear" ? .4 : v.weapon === "sword" ? .55 : 1); }
    else arm(true);
    leg(true);
    draw(g, get("pelvis"), root);
    const hairName = ["", "short", "long", "ponytail"][a.hair];
    if (hairName && !helm && a.hair > 1)
        draw(g, get(`hairBack.${hairName}`), neck, lean * .4);
    draw(g, head, neck, lean * .4);
    if (hairName && !helm)
        draw(g, get(`hair.${hairName}`), neck, lean * .4);
    if (helm)
        draw(g, helm, neck, lean * .4);
    draw(g, torso, waist, lean, false, Math.min(1, (a.gender === "f" ? 21 : 23) / Math.max(1, torso!.image.width - 4)));
    leg(false);
    if (shield) {
        arm(true);
        draw(g, shield, [(farElbow[0]+farHand[0])*.5, (farElbow[1]+farHand[1])*.5], lean - 5, false, 1.15 * (shield.image.height - 4) / (shield.image.width - 4), 1.15);
    } else {
        arm(false);
        draw(g, weapon, hand, wa + (v.weapon === "axe" ? 180 : 0), true, v.weapon === "spear" ? .4 : v.weapon === "sword" ? .55 : 1);
    }
    if (v.weapon === "bow" && weapon) {
        g.strokeStyle = "#b3a48b";
        g.lineWidth = .65;
        const pull = attack ? farHand : [hand[0] - 5, hand[1]];
        g.beginPath();
        g.moveTo(hand[0] - 3, hand[1] - 24);
        g.lineTo(pull[0], pull[1]);
        g.lineTo(hand[0] - 3, hand[1] + 24);
        g.stroke();
    }
    g.restore();
    const texture = Texture.from(c);
    texture.source.scaleMode = "linear";
    const bodyHeight = 89;
    scales.set(texture, 25 / bodyHeight);
    const value = { canvas: c, texture, bodyHeight, buildScale: factor };
    cache.set(key, value);
    if (cache.size > 384) {
        const first = cache.keys().next().value!;
        cache.delete(first);
    } // Active scene sprites retain their textures; renderer GC reclaims unused sources.
    return value;
}
