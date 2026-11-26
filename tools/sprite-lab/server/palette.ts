// Reads the hero skin / hair ramps and the recolour constants out of client/src/heroRig.ts (read-only).
// No fallback: if any expected piece of the formula is missing the extraction throws and the Lab shows the error,
// because a silent copy would drift from the game. test/palette.test.ts runs this against the real file.
import { readFile } from "node:fs/promises";
import type { HeroPalette } from "../shared/recolour.ts";

const num = String.raw`(\d*\.?\d+)`;
function need(text: string, re: RegExp, what: string): RegExpExecArray {
  const m = re.exec(text);
  if (!m) throw new Error(`heroRig.ts: cannot find ${what}; the recolour formula changed, update tools/sprite-lab/server/palette.ts and shared/recolour.ts`);
  return m;
}
const colours = (s: string) => {
  const a = JSON.parse(s) as unknown;
  if (!Array.isArray(a) || !a.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))) throw new Error("heroRig.ts: colour array is not a list of #rrggbb");
  return a as string[];
};

export function extractHeroPalette(text: string, source = "client/src/heroRig.ts"): HeroPalette {
  const skin = colours(need(text, /export const SKIN_COLORS = (\[[^\]]*\]);/, "SKIN_COLORS")[1]);
  const hair = colours(need(text, /export const HAIR_COLORS = (\[[^\]]*\]);/, "HAIR_COLORS")[1]);
  const body = need(text, /function colored\([\s\S]*?\n\}/, "function colored()")[0];
  const luma = need(body, new RegExp(String.raw`l = \(r \* ${num} \+ gg \* ${num} \+ b \* ${num}\)`), "luminance weights");
  const areas = need(body, new RegExp(String.raw`name\.startsWith\("head"\) \|\| name\.includes\("bare"\)\s*\|\| \(name\.startsWith\("foreArm"\) && y > c\.height \* ${num}\)\s*\|\| \(name\.startsWith\("torso"\) && y < c\.height \* ${num}\)`), "skin areas");
  const rule = need(body, new RegExp(String.raw`isHair = name\.startsWith\("hair"\), isSkin = skinArea && r > gg \* ${num} && gg > b \* ${num} && l > ${num}`), "skin rule");
  const hairM = need(body, new RegExp(String.raw`if \(isHair && l > ${num}\) \{\s*for \(let k = 0; k < 3; k\+\+\)\s*d\.data\[i \+ k\] = Math\.min\(255, hc\[k\] \* l / ${num}\);`), "hair formula");
  const skinM = need(body, new RegExp(String.raw`else if \(isSkin\) \{\s*for \(let k = 0; k < 3; k\+\+\)\s*d\.data\[i \+ k\] = Math\.min\(255, d\.data\[i \+ k\] \* sk\[k\] / \[(\d+), (\d+), (\d+)\]\[k\]\);`), "skin formula");
  const farM = need(body, new RegExp(String.raw`if \(far\)\s*for \(let k = 0; k < 3; k\+\+\)\s*d\.data\[i \+ k\] \*= ${num};`), "far-side factor");
  const n = (s: string) => Number(s);
  return {
    source, skin, hair,
    lumaWeights: [n(luma[1]), n(luma[2]), n(luma[3])],
    skinRef: [n(skinM[1]), n(skinM[2]), n(skinM[3])],
    hairDivisor: n(hairM[2]), hairMinLuma: n(hairM[1]),
    skinRule: { rg: n(rule[1]), gb: n(rule[2]), minLuma: n(rule[3]) },
    skinAreas: { foreArmBelow: n(areas[1]), torsoAbove: n(areas[2]) },
    farFactor: n(farM[1]),
  };
}

export async function readHeroPalette(heroRigPath: string): Promise<HeroPalette> {
  return extractHeroPalette(await readFile(heroRigPath, "utf8"));
}
