// The hero recolour, parametrised by the constants the server extracts from client/src/heroRig.ts.
//
// SINGLE SOURCE OF TRUTH: client/src/heroRig.ts (SKIN_COLORS, HAIR_COLORS and the body of colored()). The Lab does not keep
// its own copy of the ramps or numbers: server/palette.ts reads them out of that file on every request and refuses to answer
// if the formula text changed (test/palette.test.ts fails too), so a change in the game is never silently ignored here.
// What this file mirrors is only the SHAPE of colored(); the numbers all come from HeroPalette.

export type HeroPalette = {
  source: string;
  skin: string[];
  hair: string[];
  lumaWeights: [number, number, number];
  skinRef: [number, number, number];
  hairDivisor: number;
  hairMinLuma: number;
  skinRule: { rg: number; gb: number; minLuma: number };
  skinAreas: { foreArmBelow: number; torsoAbove: number };
  farFactor: number;
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** In-place recolour of RGBA pixels of part `name` (same rules as heroRig.ts colored()). */
export function recolour(pal: HeroPalette, name: string, data: Uint8ClampedArray | Uint8Array, w: number, h: number, skin: number, hair: number, far = false): void {
  const sk = rgb(pal.skin[skin] ?? pal.skin[0]), hc = rgb(pal.hair[hair] ?? pal.hair[0]), [wr, wg, wb] = pal.lumaWeights;
  const isHair = name.startsWith("hair");
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], l = r * wr + g * wg + b * wb;
    if (!data[i + 3]) continue;
    const y = Math.floor(i / 4 / w);
    const skinArea = name.startsWith("head") || name.includes("bare")
      || (name.startsWith("foreArm") && y > h * pal.skinAreas.foreArmBelow)
      || (name.startsWith("torso") && y < h * pal.skinAreas.torsoAbove);
    const isSkin = skinArea && r > g * pal.skinRule.rg && g > b * pal.skinRule.gb && l > pal.skinRule.minLuma;
    if (isHair && l > pal.hairMinLuma) {
      for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, hc[k] * l / pal.hairDivisor);
    } else if (isSkin) {
      for (let k = 0; k < 3; k++) data[i + k] = Math.min(255, data[i + k] * sk[k] / pal.skinRef[k]);
    }
    if (far) for (let k = 0; k < 3; k++) data[i + k] *= pal.farFactor;
  }
}
