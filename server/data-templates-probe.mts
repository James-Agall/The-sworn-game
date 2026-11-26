// Stage B data migration probe (STAGE-B-DATA-2026-11-26.md). Run by data-templates-test.mjs, ONE (seed, size,
// version) world per process (generating several worlds in one process can give order-dependent results).
//   DATA_PROBE=world   generate a world (DATA_SEED, COLONY_WORLD_SIZE, DATA_VERSION) and print "DATAHASH {json}":
//                      sha256 hashes of the tiles, biomes, NPC tile owners, sites, hearths, mobs (kind + position),
//                      the region plan, the castle ruin / abbey centres and the whole snapshotWorld() save state (less the
//                      UUID-rolled mob sizes),
//                      plus the number of seeded Math.random draws world-gen made.
//   DATA_PROBE=content print "DATACONTENT {json}": the deep contents of the site templates, POI pools, the Castle Ruin
//                      and every building interior table, and per interior template x variant x level x storey the
//                      sha256 of buildInteriorMap's output and of its validation result.
// Random ids (crypto randomUUID: site / mob / hearth ids) are not seeded, so the hashes replace every UUID by its
// order of first appearance.
import { createHash } from "node:crypto";
import { state, sites, hearths, mobs, tileOwner, ownerSiteIds } from "./src/state.js";

const mode = process.env.DATA_PROBE;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ids = new Map<string, number>();
const canon = (v: unknown): unknown => {
  if (v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, (u) => { if (!ids.has(u)) ids.set(u, ids.size); return `#${ids.get(u)}`; });
  if (typeof v !== "object" || v === null) return v;
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (v instanceof Map) return { $map: Array.from(v, ([k, x]) => [canon(k), canon(x)]) };
  if (v instanceof Set) return { $set: Array.from(v, canon) };
  if (Array.isArray(v)) return v.map(canon);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = canon(x);
  return o;
};
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(canon(v))).digest("hex").slice(0, 16);
const bytes = (a: ArrayBufferView) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex").slice(0, 16);

if (mode === "world") {
  const { generateWorld } = await import("./src/worldgen.js");
  const { loadBuildingTemplates } = await import("./src/buildingTemplates.js");
  const { loadSettlementTemplates } = await import("./src/settlementTemplates.js");
  const { loadCampTemplates } = await import("./src/camps.js");
  const { snapshotWorld } = await import("./src/saves.js");
  const boot = await import("./src/siteTemplates.js").catch(() => null);
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  let draws = 0;
  try {
    loadBuildingTemplates();
    loadSettlementTemplates();
    loadCampTemplates();
    boot?.loadSiteTemplates?.();
    boot?.loadPoiTemplates?.();
    const seed = Number(process.env.DATA_SEED);
    const version = Number(process.env.DATA_VERSION);
    // Count the seeded draws inside every world-gen stage (wrap runs each stage on the seeded stream).
    const wrap = (fn: () => void) => {
      const rng = Math.random;
      Math.random = () => { draws++; return rng(); };
      try { fn(); } finally { Math.random = rng; }
    };
    await generateWorld(seed, wrap, version);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const regionPlan = (await import("./src/regionWorld.js")).generatedRegionPlan;
  // A mob's size (scale and the hp / damage / speed / range it scales) is rolled from its random UUID (rollMobSize):
  // not seeded, so it differs run to run on the same code. Left out of the save hash (kind, position, site, post kept).
  const SIZED = new Set(["hp", "maxHp", "damage", "speed", "range", "scale"]);
  const stableSave = () => {
    const s = snapshotWorld() as unknown as { mobs: Record<string, unknown>[] };
    return { ...s, mobs: s.mobs.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !SIZED.has(k)))) };
  };
  const mobList = Array.from(mobs.values(), (m) => [m.kind, Math.round(m.x), Math.round(m.y), m.siteKind ?? null, m.boss ?? null]);
  const out = {
    size: state.WORLD_TILES_X, seed: Number(process.env.DATA_SEED), version: Number(process.env.DATA_VERSION),
    counts: { sites: sites.size, hearths: hearths.size, mobs: mobs.size, owned: tileOwner.size, draws },
    tiles: bytes(state.tiles), biomes: bytes(state.biomes),
    owners: sha([Array.from(tileOwner), ownerSiteIds]),
    sites: sha(Array.from(sites.values())),
    hearths: sha(Array.from(hearths.values())),
    mobs: sha(mobList),
    regionPlan: sha(regionPlan),
    landmarks: sha([state.abbeyCenter, state.castleRuinCenter, state.townCenters]),
    save: sha(stableSave()),
  };
  if (process.env.DATA_DUMP) (await import("node:fs")).writeFileSync(process.env.DATA_DUMP, JSON.stringify(canon(stableSave()), null, 1));
  log("DATAHASH " + JSON.stringify(out));
  process.exit(0);
}

if (mode === "content") {
  const c = await import("./src/constants.js");
  const I = await import("@colony/shared/interiors");
  const sitesMod = await import("./src/siteTemplates.js").catch(() => null);
  const poi = await import("./src/poiTemplates.js").catch(() => null);
  const src = { ...c, ...(sitesMod ?? {}), ...(poi ?? {}) } as Record<string, unknown>;
  const pick = (...names: string[]) => Object.fromEntries(names.map((n) => [n, src[n]]));
  const content = {
    sites: pick("SITE_TEMPLATES", "SITE_TEMPLATE_TILES", "HUMAN_SITE_SYMBOLS", "SITE_FORT_COUNT_AT_512"),
    pois: pick("RUIN_CENTERPIECES", "RUIN_EXTRAS", "ENCAMPMENT_EXTRAS", "RUIN_GUARDIAN_WEIGHTS", "ENCAMPMENT_GUARDIAN_WEIGHTS",
      "POI_SITE_FOOTPRINT_RADIUS", "POI_SITE_WATER_CLEARANCE", "POI_SITE_MIN_SPACING", "SITE_KIND_HAS_HEARTH"),
    castle: pick("CASTLE_RUIN_LAYOUT", "CASTLE_RUIN_LAYOUT_TILES", "CASTLE_RUIN_FOOTPRINT_RADIUS", "CASTLE_RUIN_GROUNDS_RADIUS",
      "CASTLE_RUIN_SPAWN_DIST_FRACTIONS", "CASTLE_RUIN_GUARDIANS_MIN", "CASTLE_RUIN_GUARDIANS_MAX", "CASTLE_RUIN_GUARDIAN_WEIGHTS"),
    interiors: {
      INTERIOR_LEGEND: I.INTERIOR_LEGEND, INTERIOR_TEMPLATES: I.INTERIOR_TEMPLATES, INTERIOR_UPPER_TEMPLATES: I.INTERIOR_UPPER_TEMPLATES,
      INTERIOR_REQUIRED_PROPS: I.INTERIOR_REQUIRED_PROPS, INTERIOR_SLEEP_TEMPLATES: I.INTERIOR_SLEEP_TEMPLATES,
      INTERIOR_TEMPLATE_BY_TILE: I.INTERIOR_TEMPLATE_BY_TILE, INTERIOR_FIXED_LEVEL: I.INTERIOR_FIXED_LEVEL,
      INTERIOR_VARIANTS: I.INTERIOR_VARIANTS, INTERIOR_WALKABLE_PROPS: I.INTERIOR_WALKABLE_PROPS,
      INTERIOR_TAVERN_MIN_SEATS: I.INTERIOR_TAVERN_MIN_SEATS,
    },
  };
  // Every interior template x variant x level 1-3 x storey: the built map and its validation.
  const maps: Record<string, string> = {};
  const ids2 = Object.keys(I.INTERIOR_TEMPLATES) as (keyof typeof I.INTERIOR_TEMPLATES)[];
  for (const id of ids2) {
    const n = I.INTERIOR_TEMPLATES[id].length;
    for (let v = 0; v < n; v++) {
      maps[`${id}/v${v}/valid`] = sha(I.validateInteriorTemplate(I.INTERIOR_TEMPLATES[id][v]));
      for (let level = 1; level <= 3; level++) {
        maps[`${id}/v${v}/L${level}/s0`] = sha(I.buildInteriorMap(id, level, v, 0));
        if (I.INTERIOR_UPPER_TEMPLATES[id]) maps[`${id}/v${v}/L${level}/s1`] = sha(I.buildInteriorMap(id, level, v, 1));
      }
    }
    const up = I.INTERIOR_UPPER_TEMPLATES[id];
    if (up) maps[`${id}/upper/valid`] = sha(I.validateInteriorTemplate(up, true));
  }
  maps["all/valid"] = sha(I.validateAllInteriorTemplates());
  console.log("DATACONTENT " + JSON.stringify({ content: canon(content), maps }));
  process.exit(0);
}
throw new Error("DATA_PROBE=world|content");
