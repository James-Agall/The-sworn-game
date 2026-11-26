// siteTemplates.ts: the fort / human-site template store (shared/src/siteTemplates.ts has the format, legend and
// validator). Built-ins: server/data/sites/<id>.json (read-only; a broken one fails at import, i.e. at boot); user
// templates: server/data/sites/user/*.json (COLONY_TEST_HOOKS=1: a sites-user folder in COLONY_SAVE_DIR;
// COLONY_SITE_USER_DIR overrides both), the same rules as the camp / building / settlement stores (templateStore.ts):
// a user template whose id is a built-in's is skipped with a warning. SITE_TEMPLATES is filled when this module loads
// (so every importer sees the built-ins, as when they were constants) and refilled by loadSiteTemplates at boot.
// Order: the built-ins the code names (BUILTIN_SITE_TEMPLATE_IDS, the old constant's order), other built-ins, then the
// user templates, by id. World-gen only places the built-in ids it names (generateForts: grakkar, thornwick; the
// settlement templates' `profile`); a user template can be stamped from the creative editor.
import { MOB_KIND_CONFIG } from "./constants.js";
import { makeTemplateStore } from "./templateStore.js";
import type { SiteTemplate, SiteTemplateId } from "./types.js";
import {
  type SiteTemplateFile, normaliseSiteTemplateFile, siteTemplateFromFile, validateSiteTemplate,
} from "@colony/shared/siteTemplates";

// Every built-in id the code refers to by name (forts at world-gen, warbands, creative, settlement profiles).
export const BUILTIN_SITE_TEMPLATE_IDS = ["thornwick", "grakkar", "hearthmoor", "ironhold", "riverwatch"] as const;

const store = makeTemplateStore<SiteTemplateFile>({
  kind: "sites",
  userEnv: "COLONY_SITE_USER_DIR",
  validate: (raw) => validateSiteTemplate(raw, { mobKinds: Object.keys(MOB_KIND_CONFIG) }),
  normalise: normaliseSiteTemplateFile,
});

export const SITE_TEMPLATES: Record<SiteTemplateId, SiteTemplate> = {};

function rebuild() {
  for (const k of Object.keys(SITE_TEMPLATES)) delete SITE_TEMPLATES[k];
  const all = store.all();
  const named = new Set<string>(BUILTIN_SITE_TEMPLATE_IDS);
  for (const id of BUILTIN_SITE_TEMPLATE_IDS) {
    const t = all.find((f) => f.id === id && f.builtin);
    if (!t) throw new Error(`site template ${id}: missing built-in server/data/sites/${id}.json`);
    SITE_TEMPLATES[id] = siteTemplateFromFile(t) as SiteTemplate;
  }
  for (const t of all) if (!named.has(t.id)) SITE_TEMPLATES[t.id] = siteTemplateFromFile(t) as SiteTemplate;
}
rebuild();

// Boot: reload (and validate) the built-ins and the user folder.
export function loadSiteTemplates() {
  const n = store.load();
  rebuild();
  console.log(`[sites] ${n.builtins} built-in + ${n.users} user site templates`);
}

export const isSiteTemplateId = (id: unknown): id is SiteTemplateId => typeof id === "string" && Object.prototype.hasOwnProperty.call(SITE_TEMPLATES, id);
// The files (TileType names in `symbols`, `builtin` set): for editors.
export const siteTemplateFiles = () => store.all();
export function saveUserSiteTemplate(raw: unknown): string | null {
  const err = store.save(raw);
  if (!err) rebuild();
  return err;
}
export function deleteUserSiteTemplate(id: string): string | null {
  const err = store.remove(id);
  if (!err) rebuild();
  return err;
}
export const userSiteTemplateDir = () => store.userDir();
