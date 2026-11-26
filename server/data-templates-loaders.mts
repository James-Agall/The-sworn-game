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
