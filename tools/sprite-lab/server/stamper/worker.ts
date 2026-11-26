// The REAL server stamper, headless: run by server/stamp.ts as
//   node --import tsx --import ./alias.mjs worker.ts   (cwd: <repo>/server, COLONY_SAVE_DIR = a scratch folder)
// It imports the game's own server modules (server/src/camps.ts stampCamp, settlementTemplates.ts stampSettlement and
// the template stores), lays the template on an empty in-memory map exactly as world-gen / creative "Stamp here" do,
// then prints the stamped window as JSON: tiles, ownership, site grounds, spawned guards, the hearth / site record.
// Nothing is saved: no game server boots, no port is opened, the save folder is a scratch folder that stamp.ts deletes.
// Input (stdin JSON): { kind: "camps" | "settlements" | "sites" | "pois", template, transform, seed, tier? (sites), samples? (pois) }.
// Sites: server/src/sites.ts stampSiteTemplate at the chosen tier; POI pools: server/src/worldgen.ts placePoiSite("ruin").
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
// Runtime URLs (not static imports) so the Lab's type check does not pull the whole game server in.
const mod = (rel: string) => import(pathToFileURL(path.join(REPO, rel)).href) as Promise<any>;

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Deterministic Math.random for the stamper's picks (guard count, guard kinds, slot shuffle, site name): world-gen runs
// on a seeded Math.random too, so a seed here is one possible world-gen outcome.
function seedRandom(seed: number) {
  let s = seed >>> 0 || 1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const input = JSON.parse(await stdin()) as { kind: string; template: any; transform: number; seed: number; tier?: number; samples?: number };
  seedRandom(Number(input.seed) || 1);
  const { TileType, TILE_SIZE } = await mod("shared/src/protocol.ts");
  const { state, mobs, hearths, gates, sites } = await mod("server/src/state.ts");
  const { markTileRegistryStale } = await mod("server/src/chunks.ts");
  const tiles = await mod("server/src/tiles.ts");
  const sitesMod = await mod("server/src/sites.ts");
  const W = state.WORLD_TILES_X;
  const reset = () => {
    state.tiles.fill(TileType.Empty);
    markTileRegistryStale();
    mobs.clear(); hearths.clear(); gates.clear();
    tiles.clearOwners(); sitesMod.clearSites();
  };
  const tf = Math.max(0, Math.min(7, Math.floor(Number(input.transform) || 0)));
  const window = (x0: number, y0: number, w: number, h: number, siteNum: number) => {
    const out = { x0, y0, w, h, tiles: [] as number[], owned: [] as number[], grounds: [] as number[] };
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = y * W + x;
      out.tiles.push(state.tiles[i]);
      out.owned.push(siteNum > 0 && tiles.ownerAt(i) === siteNum ? 1 : 0);
      out.grounds.push(sitesMod.isInSiteGrounds(x, y) ? 1 : 0);
    }
    return out;
  };
  const mobList = (ids: string[] | null, x0: number, y0: number) => [...mobs.values()]
    .filter((m: any) => !ids || ids.includes(m.id))
    .map((m: any) => ({ kind: m.kind, x: Math.floor(m.x / TILE_SIZE) - x0, y: Math.floor(m.y / TILE_SIZE) - y0, dormant: !m.guardianActive }));

  if (input.kind === "camps") {
    const camps = await mod("server/src/camps.ts");
    const { validateCampTemplate, campRadius } = await mod("shared/src/camps.ts");
    const errs = validateCampTemplate(input.template);
    if (errs.length) return { ok: false, errors: errs };
    reset();
    const C = { x: W >> 1, y: W >> 1 }, r = campRadius(input.template), m = 1;
    const camp = camps.stampCamp(input.template, C, tf);
    const x0 = C.x - r - m, y0 = C.y - r - m, n = 2 * (r + m) + 1;
    const h = hearths.get(camp.siteId);
    return {
      ok: true, kind: "camps", transform: tf, seed: input.seed, ...window(x0, y0, n, n, 0), margin: m,
      hearth: h && { x: h.x - x0, y: h.y - y0, hp: h.maxHp, prisoners: h.prisoners, chests: h.campChests, radius: h.campRadius, tier: h.campTier, garrison: h.garrison },
      mobs: mobList(null, x0, y0),
    };
  }
  if (input.kind === "settlements") {
    const bt = await mod("server/src/buildingTemplates.ts");
    const stt = await mod("server/src/settlementTemplates.ts");
    const ST = await mod("shared/src/settlementTemplates.ts");
    bt.loadBuildingTemplates();
    const lookup = bt.buildingTemplateById;
    const errs = ST.validateSettlementTemplate(input.template, lookup);
    if (errs.length) return { ok: false, errors: errs };
    const t = ST.transformSettlement(input.template, tf, lookup);
    reset();
    const l = ST.settlementLayout(t, lookup);
    const x0 = Math.max(4, (W - l.w) >> 1), y0 = Math.max(4, (W - l.h) >> 1);
    const fit = sitesMod.siteFitProblem(t, x0, y0);
    const site = stt.stampSettlement(t, x0, y0);
    const m = site.apron + 1, wx = x0 - m, wy = y0 - m;
    const at = (i: number) => ({ x: (i % W) - wx, y: Math.floor(i / W) - wy });
    return {
      ok: true, kind: "settlements", transform: tf, seed: input.seed, fit, ...window(wx, wy, l.w + 2 * m, l.h + 2 * m, site.num), margin: m,
      site: {
        name: site.name, profile: site.template, layout: site.layout, apron: site.apron, keep: { x: site.keepX - wx, y: site.keepY - wy },
        garrisonRoster: site.garrisonRoster, posts: site.posts.map(at), stock: site.stock,
        homes: {
          trader: site.homes.trader !== undefined ? at(site.homes.trader) : null, priest: site.homes.priest !== undefined ? at(site.homes.priest) : null,
          quest: site.homes.quest !== undefined ? at(site.homes.quest) : null, villagers: site.homes.villagers.map(at),
        },
      },
      mobs: mobList(site.garrison, wx, wy),
      sites: sites.size,
    };
  }
  if (input.kind === "sites") {
    // Site templates: the game's stampSiteTemplate(id, x0, y0, { tier }) reads SITE_TEMPLATES[id], so the edited file
    // goes in under its id first (this scratch process only), turned into the game's form by siteTemplateFromFile.
    const ST = await mod("shared/src/siteTemplates.ts");
    const { MOB_KIND_CONFIG, SITE_APRON_TILES } = await mod("server/src/constants.ts");
    const { SITE_TEMPLATES } = await mod("server/src/siteTemplates.ts");
    const errs = ST.validateSiteTemplate(input.template, { mobKinds: Object.keys(MOB_KIND_CONFIG) });
    if (errs.length) return { ok: false, errors: errs };
    SITE_TEMPLATES[input.template.id] = ST.siteTemplateFromFile(input.template);
    reset();
    const t = input.template, w = t.rows[0].length, h = t.rows.length;
    const x0 = (W - w) >> 1, y0 = (W - h) >> 1;
    const site = sitesMod.stampSiteTemplate(t.id, x0, y0, { tier: input.tier });
    const m = SITE_APRON_TILES + 1, wx = x0 - m, wy = y0 - m;
    return {
      ok: true, kind: "sites", tier: site.tier, seed: input.seed, ...window(wx, wy, w + 2 * m, h + 2 * m, site.num), margin: m,
      site: { name: site.name, faction: site.faction, tier: site.tier, apron: site.apron, keep: { x: site.keepX - wx, y: site.keepY - wy }, garrisonRoster: site.garrisonRoster, stock: site.stock },
      mobs: mobList(site.garrison, wx, wy),
    };
  }
  if (input.kind === "pois") {
    // POI pools: world-gen's own placePoiSite("ruin", centre) with the edited pool in RUIN_POI's fields (this scratch
    // process only). One sample per seed, each on an empty map: the same draw order world-gen uses.
    const PT = await mod("shared/src/poiTemplates.ts");
    const { MOB_KIND_CONFIG } = await mod("server/src/constants.ts");
    const P = await mod("server/src/poiTemplates.ts");
    const wg = await mod("server/src/worldgen.ts");
    const errs = PT.validatePoiTemplate(input.template, { mobKinds: Object.keys(MOB_KIND_CONFIG) });
    if (errs.length) return { ok: false, errors: errs };
    const f = input.template;
    Object.assign(P.RUIN_POI, {
      centerpieces: f.centerpieces.map((n: string) => PT.poiTileByName(n)), extras: f.extras.map((n: string) => PT.poiTileByName(n)),
      extraCount: [f.extraCount[0], f.extraCount[1]], guardianCount: [f.guardianCount[0], f.guardianCount[1]],
      guardians: f.guardians.map((g: { kind: string; weight: number }) => ({ kind: g.kind, weight: g.weight })), footprintRadius: f.footprintRadius,
    });
    const samples = [];
    const n = Math.max(1, Math.min(12, Number(input.samples) || 6)), r = 3;
    for (let k = 0; k < n; k++) {
      seedRandom((Number(input.seed) || 1) + k);
      reset();
      const C = { x: W >> 1, y: W >> 1 };
      wg.placePoiSite("ruin", C);
      samples.push({ seed: (Number(input.seed) || 1) + k, ...window(C.x - r, C.y - r, 2 * r + 1, 2 * r + 1, 0), mobs: mobList(null, C.x - r, C.y - r) });
    }
    return { ok: true, kind: "pois", seed: input.seed, centre: { x: r, y: r }, samples };
  }
  return { ok: false, errors: ["kind must be camps, settlements, sites or pois"] };
}

// Game modules may leave timers behind: exit once the result is written.
// sharedFrom: where the server modules' "@colony/shared/protocol" resolved (this repo's shared/src, see alias-hooks.mjs).
const done = (r: object) => process.stdout.write("\n@@RESULT@@" + JSON.stringify({ ...r, sharedFrom: import.meta.resolve("@colony/shared/protocol") }) + "\n", () => process.exit(0));
main().then(done, (e) => done({ ok: false, errors: ["stamper failed: " + ((e as Error)?.stack || e)] }));
