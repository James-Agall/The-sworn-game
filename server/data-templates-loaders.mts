// Stage B loaders / validators (run by data-templates-test.mjs in its own process; prints "DATALOADERS {json}").
// Every built-in JSON round-trips load -> validate -> normalise -> serialise byte for byte; the validators reject bad
// fixtures; user folders load like the camp / building / settlement stores (a user id equal to a built-in's is
// skipped, a broken user file is skipped, built-ins can't be saved over or deleted); the older stores still load.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passes = 0;
let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const rejects = (errs: string[], what: string, needle: RegExp) =>
  check(errs.some((e) => needle.test(e)), `rejects ${what} (${errs.find((e) => needle.test(e)) ?? (errs.join("; ") || "accepted")})`);
const DATA = fileURLToPath(new URL("./data/", import.meta.url));
const builtinFiles = (kind: string) => readdirSync(path.join(DATA, kind)).filter((f) => f.endsWith(".json")).sort();
const readJson = (kind: string, f: string) => JSON.parse(readFileSync(path.join(DATA, kind, f), "utf8"));
const text = (kind: string, f: string) => readFileSync(path.join(DATA, kind, f), "utf8");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const scratch = mkdtempSync(path.join(os.tmpdir(), "colony-data-loaders-"));
const log = console.log;
const quiet = <T,>(fn: () => T): T => {
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
};

// ---- A. site templates ----
{
  const S = await import("@colony/shared/siteTemplates");
  const store = await import("./src/siteTemplates.js");
  const { MOB_KIND_CONFIG } = await import("./src/constants.js");
  const mobKinds = Object.keys(MOB_KIND_CONFIG);
  const files = builtinFiles("sites");
  check(files.length === 5, `sites: 5 built-in files (${files.join(", ")})`);
  for (const f of files) {
    const raw = readJson("sites", f);
    const errs = S.validateSiteTemplate(raw, { mobKinds });
    check(errs.length === 0 && raw.id === f.replace(/\.json$/, ""), `sites/${f}: valid, id matches the file name ${errs.join("; ")}`);
    check(JSON.stringify(S.normaliseSiteTemplateFile(raw), null, 2) + "\n" === text("sites", f), `sites/${f}: round-trips byte for byte`);
    const back = S.siteTemplateFromFile(raw);
    check(JSON.stringify(back) === JSON.stringify(store.SITE_TEMPLATES[raw.id]), `sites/${f}: SITE_TEMPLATES.${raw.id} is the file's game form`);
  }
  for (const id of store.BUILTIN_SITE_TEMPLATE_IDS) check(store.isSiteTemplateId(id), `sites: built-in id ${id} resolves`);
  check(!store.isSiteTemplateId("nope") && !store.isSiteTemplateId("toString"), "sites: unknown ids (and Object.prototype names) do not resolve");
  for (const id of ["hearthmoor", "ironhold", "riverwatch"]) {
    const t = store.SITE_TEMPLATES[id];
    check(JSON.stringify(t.symbols) === JSON.stringify(S.HUMAN_SITE_SYMBOLS) && !!t.noun && !!t.workers, `sites: ${id} keeps the human symbols, noun and workers`);
  }
  const good = readJson("sites", "thornwick.json");
  const bad = (edit: (o: any) => void) => { const o = clone(good); edit(o); return S.validateSiteTemplate(o, { mobKinds }); };
  rejects(bad((o) => { o.rows[6] = o.rows[6].replace("K", "s"); }), "a site with no keep", /keep/);
  rejects(bad((o) => { o.rows[4] = o.rows[4].replace("C", "K"); }), "a site with two keeps", /keep/);
  rejects(bad((o) => { o.rows[2] = o.rows[2].replace("H", "?"); }), "an unknown site symbol", /unknown symbol "\?"/);
  rejects(bad((o) => { o.rows[3] += "."; }), "a site row of the wrong width", /row 3: 22 wide/);
  rejects(bad((o) => { o.tiers.pop(); }), "a tiers grid of the wrong height", /tiers: 12 rows/);
  rejects(bad((o) => { o.tiers[0] = o.tiers[0].replace(/^2/, "5"); }), "a tier above maxTier", /no tier/);
  rejects(bad((o) => { o.garrison.dragon = 1; }), "an unknown garrison kind", /garrison: unknown "dragon"/);
  rejects(bad((o) => { o.garrison = {}; }), "an empty garrison", /garrison: at least one/);
  rejects(bad((o) => { o.stock.diamonds = 3; }), "an unknown stock resource", /stock: unknown "diamonds"/);
  rejects(bad((o) => { o.symbols = { "#": "NoSuchTile" }; }), "an unknown symbol tile name", /unknown tile "NoSuchTile"/);
  rejects(bad((o) => { o.faction = "elf"; }), "an unknown faction", /faction/);
  rejects(bad((o) => { o.id = "Bad Id"; }), "a bad id", /^id:/);
  rejects(bad((o) => { o.startTier = 4; }), "startTier above maxTier", /startTier/);
  // User folder.
  const userDir = path.join(scratch, "sites-user");
  process.env.COLONY_SITE_USER_DIR = userDir;
  rmSync(userDir, { recursive: true, force: true });
  const mine = { ...clone(good), id: "my-fort", label: "Hold" };
  check(store.saveUserSiteTemplate(mine) === null, "sites: a user template saves");
  check(/built-in/.test(store.saveUserSiteTemplate({ ...clone(good), label: "Shadow" }) ?? ""), "sites: saving over a built-in id is refused");
  writeFileSync(path.join(userDir, "thornwick.json"), JSON.stringify({ ...clone(good), label: "Shadow" }));
  writeFileSync(path.join(userDir, "broken.json"), JSON.stringify({ ...clone(good), id: "broken", rows: ["K"] }));
  quiet(() => store.loadSiteTemplates());
  check(store.isSiteTemplateId("my-fort") && store.SITE_TEMPLATES["my-fort"].label === "Hold", "sites: the user template loads at boot");
  check(store.SITE_TEMPLATES.thornwick.label === "Palisade", "sites: a user file with a built-in's id is skipped (the built-in wins)");
  check(!store.isSiteTemplateId("broken"), "sites: a broken user file is skipped");
  check(Object.keys(store.SITE_TEMPLATES).slice(0, 5).join() === store.BUILTIN_SITE_TEMPLATE_IDS.join(), "sites: the built-ins come first, in the old order");
  check(/can't be deleted/.test(store.deleteUserSiteTemplate("thornwick") ?? ""), "sites: a built-in can't be deleted");
  check(store.deleteUserSiteTemplate("my-fort") === null && !store.isSiteTemplateId("my-fort"), "sites: a user template deletes");
  rmSync(userDir, { recursive: true, force: true });
  quiet(() => store.loadSiteTemplates());
}

// ---- B. POI pools ----
{
  const P = await import("@colony/shared/poiTemplates");
  const store = await import("./src/poiTemplates.js");
  const { MOB_KIND_CONFIG } = await import("./src/constants.js");
  const mobKinds = Object.keys(MOB_KIND_CONFIG);
  const files = builtinFiles("pois");
  check(files.join() === "encampment.json,ruin.json", `pois: the built-in files (${files.join(", ")})`);
  for (const f of files) {
    const raw = readJson("pois", f);
    const errs = P.validatePoiTemplate(raw, { mobKinds });
    check(errs.length === 0 && raw.id === f.replace(/\.json$/, ""), `pois/${f}: valid, id matches the file name ${errs.join("; ")}`);
    check(JSON.stringify(P.normalisePoiTemplateFile(raw), null, 2) + "\n" === text("pois", f), `pois/${f}: round-trips byte for byte`);
  }
  check(JSON.stringify(store.RUIN_POI.centerpieces) === JSON.stringify(store.RUIN_CENTERPIECES) && store.RUIN_POI.extraCount.join() === "0,2" && store.RUIN_POI.guardianCount.join() === "2,3", "pois: the ruin pool and its counts");
  const good = readJson("pois", "ruin.json");
  const bad = (edit: (o: any) => void) => { const o = clone(good); edit(o); return P.validatePoiTemplate(o, { mobKinds }); };
  rejects(bad((o) => { o.extras.push("NoSuchTile"); }), "an unknown POI tile", /unknown tile "NoSuchTile"/);
  rejects(bad((o) => { o.centerpieces = []; }), "an empty centrepiece pool", /centerpieces/);
  rejects(bad((o) => { o.extraCount = [3, 1]; }), "an inverted extra count", /extraCount/);
  rejects(bad((o) => { o.extraCount = [0, 9]; }), "more extras than neighbours", /extraCount/);
  rejects(bad((o) => { o.guardians[0].kind = "dragon"; }), "an unknown guardian kind", /unknown kind "dragon"/);
  rejects(bad((o) => { o.guardians[0].weight = 0; }), "a zero guardian weight", /weight/);
  rejects(bad((o) => { o.footprintRadius = 3; }), "a footprint beyond the cleared ground", /footprintRadius/);
  const userDir = path.join(scratch, "pois-user");
  process.env.COLONY_POI_USER_DIR = userDir;
  check(store.saveUserPoiTemplate({ ...clone(good), id: "my-ruin" }) === null, "pois: a user pool saves");
  check(/built-in/.test(store.saveUserPoiTemplate(clone(good)) ?? ""), "pois: saving over a built-in id is refused");
  writeFileSync(path.join(userDir, "ruin.json"), JSON.stringify({ ...clone(good), extras: ["Rock"] }));
  quiet(() => store.loadPoiTemplates());
  const ids = store.poiTemplateFiles().map((t) => t.id);
  check(ids.includes("my-ruin") && store.poiTemplateFiles().find((t) => t.id === "ruin")!.builtin === true && store.RUIN_EXTRAS.length === 2, "pois: user pools load; a user ruin.json is skipped (world-gen keeps the built-in)");
  check(store.deleteUserPoiTemplate("my-ruin") === null, "pois: a user pool deletes");
  rmSync(userDir, { recursive: true, force: true });
}

// ---- C. the Castle Ruin ----
{
  const P = await import("@colony/shared/poiTemplates");
  const store = await import("./src/poiTemplates.js");
  const { MOB_KIND_CONFIG } = await import("./src/constants.js");
  const mobKinds = Object.keys(MOB_KIND_CONFIG);
  const files = builtinFiles("castle-ruins");
  check(files.join() === "castle-ruin.json", `castle-ruins: the built-in file (${files.join(", ")})`);
  const raw = readJson("castle-ruins", "castle-ruin.json");
  const errs = P.validateCastleRuin(raw, { mobKinds });
  check(errs.length === 0, `castle-ruins/castle-ruin.json: valid ${errs.join("; ")}`);
  check(JSON.stringify(P.normaliseCastleRuinFile(raw), null, 2) + "\n" === text("castle-ruins", "castle-ruin.json"), "castle-ruins/castle-ruin.json: round-trips byte for byte");
  check(store.CASTLE_RUIN_LAYOUT.length === 9 && store.CASTLE_RUIN_FOOTPRINT_RADIUS === 4 && store.CASTLE_RUIN_GROUNDS_RADIUS === 5 && store.CASTLE_RUIN_BOSS_KIND === "ogre", "castle-ruins: 9x9, radius 4 / grounds 5, the Ogre Warlord");
  const bad = (edit: (o: any) => void) => { const o = clone(raw); edit(o); return P.validateCastleRuin(o, { mobKinds }); };
  rejects(bad((o) => { o.rows[4] = o.rows[4].replace("B", "."); }), "a Castle Ruin without the boss spot", /exactly one boss/);
  rejects(bad((o) => { o.rows[1] = "2B.....2".padEnd(9, "2"); }), "a boss spot off the centre", /centre/);
  rejects(bad((o) => { o.rows[2] = o.rows[2].replace("R", "?"); }), "an unknown Castle Ruin symbol", /unknown symbol "\?"/);
  rejects(bad((o) => { o.rows[3] += "."; }), "a Castle Ruin row of the wrong width", /row 3: 10 wide/);
  rejects(bad((o) => { o.rows = o.rows.slice(0, 8).map((r: string) => r.slice(0, 8)); }), "an even-sized Castle Ruin", /odd/);
  rejects(bad((o) => { o.tiles.A = "NoSuchTile"; }), "an unknown Castle Ruin tile", /unknown tile "NoSuchTile"/);
  rejects(bad((o) => { o.boss = "dragon"; }), "an unknown boss kind", /boss/);
  rejects(bad((o) => { o.guardians = [12, 8]; }), "an inverted guardian count", /guardians/);
  rejects(bad((o) => { o.spawnDistFractions = [1.5]; }), "a spawn distance beyond the map", /spawnDistFractions/);
  const userDir = path.join(scratch, "castle-user");
  process.env.COLONY_CASTLE_RUIN_USER_DIR = userDir;
  check(store.saveUserCastleRuin({ ...clone(raw), id: "my-castle" }) === null, "castle-ruins: a user layout saves");
  check(/built-in/.test(store.saveUserCastleRuin(clone(raw)) ?? ""), "castle-ruins: saving over the built-in is refused");
  quiet(() => store.loadPoiTemplates());
  check(store.castleRuinFiles().map((t) => t.id).join() === "castle-ruin,my-castle", "castle-ruins: the user layout loads beside the built-in");
  check(store.deleteUserCastleRuin("my-castle") === null, "castle-ruins: a user layout deletes");
  rmSync(userDir, { recursive: true, force: true });
}

// ---- D. building interiors (static data in shared/src/data/interiors, bundled into the client too) ----
{
  const I = await import("@colony/shared/interiors");
  const dir = fileURLToPath(new URL("../shared/src/data/interiors/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  check(files.length === 10 && files.includes("legend.json"), `interiors: legend + 9 building files (${files.join(", ")})`);
  check(JSON.stringify(I.INTERIOR_LEGEND, null, 2) + "\n" === readFileSync(path.join(dir, "legend.json"), "utf8"), "interiors/legend.json: round-trips byte for byte");
  for (const id of I.BUILDING_INTERIOR_IDS) {
    const src = readFileSync(path.join(dir, `${id}.json`), "utf8");
    const raw = JSON.parse(src);
    const errs = I.validateInteriorFile(raw);
    check(errs.length === 0, `interiors/${id}.json: valid (shape + every layout) ${errs.join("; ")}`);
    check(JSON.stringify(I.normaliseInteriorFile(raw), null, 2) + "\n" === src, `interiors/${id}.json: round-trips byte for byte`);
    check(I.INTERIOR_TEMPLATES[id].length === I.INTERIOR_VARIANTS && I.INTERIOR_TEMPLATES[id].every((t, v) => t.id === id && JSON.stringify(t.rows) === JSON.stringify(raw.variants[v].rows)), `interiors: INTERIOR_TEMPLATES.${id} is the file's variants in order`);
  }
  check(I.validateAllInteriorTemplates().length === 0, "interiors: validateAllInteriorTemplates() is clean");
  const hall = JSON.parse(readFileSync(path.join(dir, "hall.json"), "utf8"));
  const bad = (edit: (o: any) => void) => { const o = clone(hall); edit(o); return I.validateInteriorFile(o); };
  rejects(bad((o) => { o.variants[1].rows = o.variants[1].rows.map((r: string) => r.replace("c", ".")); }), "a hall layout without its chest", /hall: no chest .*variant 1/);
  rejects(bad((o) => { o.required = ["throne", "table"]; }), "a hall whose required props drop the chest", /hall: required must keep "chest"/);
  rejects(bad((o) => { o.variants[0].rows = o.variants[0].rows.map((r: string) => r.replace("T", ".")); }), "a hall layout without its high seat", /no throne/);
  rejects(bad((o) => { o.variants[0].rows[3] += "#"; }), "an interior row of the wrong width", /rows differ in length/);
  rejects(bad((o) => { o.variants[2].rows[2] = o.variants[2].rows[2].replace(".", "?"); }), "an unknown interior symbol", /unknown symbol "\?"/);
  rejects(bad((o) => { o.variants[0].rows[1] = o.variants[0].rows[1].replace(".", "E"); }), "two exit mats", /exactly one exit mat/);
  rejects(bad((o) => { o.variants.pop(); }), "a type with 2 variants", /2 variants, wants 3/);
  rejects(bad((o) => { o.variants[0].floor = "marble"; }), "an unknown floor", /floor one of/);
  rejects(bad((o) => { o.upper.rows[4] = o.upper.rows[4].replace("D", "."); }), "an upper floor without stairs down", /upstairs: needs exactly one "D"/);
  rejects(bad((o) => { o.variants[0].rows = o.variants[0].rows.map((r: string) => r.replace("U", ".")); }), "a hall with an upper floor but no stairs up", /no stairs up/);
  rejects(bad((o) => { o.id = "castle"; }), "an unknown building type", /^id: one of/);
  check(I.INTERIOR_SLEEP_TEMPLATES.has("house") && I.INTERIOR_SLEEP_TEMPLATES.has("hall") && I.INTERIOR_SLEEP_TEMPLATES.size === 2, "interiors: you sleep in your house and your hall only");
}

// ---- the older template stores still load; every settlement profile is a site template ----
{
  const { loadCampTemplates } = await import("./src/camps.js");
  const { loadBuildingTemplates } = await import("./src/buildingTemplates.js");
  const { loadSettlementTemplates, settlementTemplates } = await import("./src/settlementTemplates.js");
  const { SITE_TEMPLATES } = await import("./src/siteTemplates.js");
  let err = "";
  try { quiet(() => { loadCampTemplates(); loadBuildingTemplates(); loadSettlementTemplates(); }); } catch (e) { err = (e as Error).message; }
  check(err === "", `camps, buildings and settlements still load ${err}`);
  const profiles = new Set(settlementTemplates().map((t) => t.profile));
  check([...profiles].every((p) => p in SITE_TEMPLATES) && profiles.size === 3, `settlement profiles resolve to site templates (${[...profiles].join(", ")})`);
}

rmSync(scratch, { recursive: true, force: true });
console.log("DATALOADERS " + JSON.stringify({ passes, fails }));
process.exit(0);
