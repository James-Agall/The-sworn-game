// The GAME'S interior furniture art tables, read from client/src/interior.ts (the room renderer): PROP_TILE (prop ->
// a furniture TileType, drawn with STRUCTURE_FURNITURE_ART), PROP_EXTRA (prop -> an extra atlas piece / url),
// PROP_COLOR (stand-in block colours), PROP_HEIGHT_PX, the props with oriented interiors-v2 art (<prop>_<facing>.png),
// the rug's art, FLOOR_COLOR and WALL. Those are module-private constants of a pixi-bound file the Lab cannot import,
// so they are EXTRACTED FROM ITS TEXT (the same approach as the hero palette from heroRig.ts) with no fallback: any table
// that cannot be read is reported (the Area tab shows the error; test/area-data.test.ts fails if the text drifts).
// The browser reads the text through Vite's ?raw import, Node from the file.

export type InteriorArtTables = {
  propTile: Record<string, string>;          // prop -> TileType NAME
  propExtra: Record<string, string>;         // prop -> "name" (structure/extra/<name>.png) or "/sprites/..." url
  propColor: Record<string, number>;
  propHeight: Record<string, number>;
  oriented: string[];                        // props drawn with /sprites/interiors-v2/<prop>_<facing>.png
  rugUrl: string | null;
  floorColor: Record<string, number>;
  wall: Record<string, { top: number; face: number; line: number }>;
  errors: string[];
};

function block(src: string, name: string, errors: string[]): string {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(src) ?? new RegExp(`const ${name}\\b[^=]*=\\s*\\{([^\\n]*?)\\};`).exec(src);
  if (!m) { errors.push(`client/src/interior.ts: table ${name} not found`); return ""; }
  return m[1].replace(/\/\/[^\n]*/g, "");
}
const unq = (v: string) => v.replace(/^["'`]|["'`]$/g, "");

/** Parse the tables out of client/src/interior.ts's source text. */
export function parseInteriorArt(src: string): InteriorArtTables {
  const errors: string[] = [];
  const pairs = (body: string) => [...body.matchAll(/([A-Za-z_]\w*)\s*:\s*("[^"]*"|'[^']*'|TileType\.\w+|0x[0-9a-fA-F]+|\d+(?:\.\d+)?)/g)].map((m) => [m[1], m[2]] as const);
  const propTile: Record<string, string> = {};
  for (const [k, v] of pairs(block(src, "PROP_TILE", errors))) if (v.startsWith("TileType.")) propTile[k] = v.slice(9);
  const propExtra: Record<string, string> = {};
  for (const [k, v] of pairs(block(src, "PROP_EXTRA", errors))) if (/^["']/.test(v)) propExtra[k] = unq(v);
  const propColor: Record<string, number> = {};
  for (const [k, v] of pairs(block(src, "PROP_COLOR", errors))) propColor[k] = Number(v);
  const propHeight: Record<string, number> = {};
  for (const [k, v] of pairs(block(src, "PROP_HEIGHT_PX", errors))) propHeight[k] = Number(v);
  const fc = /const FLOOR_COLOR\s*=\s*\{([^}]*)\}/.exec(src);
  const floorColor: Record<string, number> = {};
  if (fc) for (const [k, v] of pairs(fc[1])) floorColor[k] = Number(v); else errors.push("client/src/interior.ts: FLOOR_COLOR not found");
  const wall: InteriorArtTables["wall"] = {};
  const wm = /const WALL\s*=\s*\{(.*)\};/.exec(src);
  if (wm) for (const m of wm[1].matchAll(/(\w+)\s*:\s*\{([^}]*)\}/g)) { const o = Object.fromEntries(pairs(m[2]).map(([k, v]) => [k, Number(v)])); wall[m[1]] = o as { top: number; face: number; line: number }; }
  else errors.push("client/src/interior.ts: WALL not found");
  const om = /\[([^\]]*)\]\.includes\(prop\)\?extraTexture\(`\/sprites\/interiors-v2\//.exec(src);
  const oriented = om ? [...om[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  if (!om) errors.push("client/src/interior.ts: the oriented interiors-v2 prop list not found");
  const rm = /prop==='rug'\?extraTexture\('([^']+)'\)/.exec(src);
  if (!rm) errors.push("client/src/interior.ts: the rug's art not found");
  for (const [name, t] of [["PROP_TILE", propTile], ["PROP_EXTRA", propExtra], ["PROP_COLOR", propColor], ["PROP_HEIGHT_PX", propHeight]] as const) {
    if (Object.keys(t).length === 0) errors.push(`client/src/interior.ts: ${name} is empty`);
  }
  return { propTile, propExtra, propColor, propHeight, oriented, rugUrl: rm ? rm[1] : null, floorColor, wall, errors };
}

/** The art urls for a prop in the order the room renderer tries them (oriented / rug, furniture tile, extra piece). */
export function propArtUrls(t: InteriorArtTables, prop: string, facing: string, furnitureUrl: (tileName: string) => string | undefined): string[] {
  const out: string[] = [];
  if (prop === "rug" && t.rugUrl) out.push(t.rugUrl);
  if (t.oriented.includes(prop)) out.push(`/sprites/interiors-v2/${prop}_${facing}.png`);
  const tile = t.propTile[prop];
  const f = tile ? furnitureUrl(tile) : undefined;
  if (f) out.push(f);
  const e = t.propExtra[prop];
  if (e) out.push(e.startsWith("/") ? e : `/sprites/structure/extra/${e}.png`);
  return out;
}
