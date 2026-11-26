// Area tab API: the game's camp / building / settlement templates under <root>/server/data/<kind>/.
// Built-ins (<kind>/*.json) are READ-ONLY. User templates live in <kind>/user/<id>.json, the folder the game's template
// stores load at boot and the in-game creative editors save to. Every save is validated server-side with the game's own
// validate* functions (shared/area.ts -> shared/src), refuses a built-in's id, writes atomically with a backup of the
// file it replaces, and uses the game store's file format (normalise + JSON.stringify(t, null, 2) + "\n").
import { readdir, readFile } from "node:fs/promises";
import { HttpError, TEMPLATE_FILE_RE, resolveReadable, templateBase, templateUserBase, type TemplateKind } from "./paths.ts";
import { Backup, deleteWithBackup, ensureDir, writeWithBackup } from "./store.ts";
import { sha256 } from "./sets.ts";
import { loadArea } from "./game.ts";
import type { AnyTemplate, BuildingTemplate } from "../shared/area.ts";

export const TEMPLATE_LIMITS = { body: 512 << 10, files: 2000 };

export type Src = "builtin" | "user";
export type Entry = {
  id: string; name: string; file: string; src: Src; path: string; tier?: number; w: number; h: number;
  buildingType?: string; weight?: number; errors: string[]; shadowed?: boolean; template?: AnyTemplate;
};

type Loaded = { file: string; text: string; raw: unknown; parseError?: string };

async function readFolder(root: string, rel: string[]): Promise<Loaded[]> {
  const dir = await resolveReadable(root, rel.join("/")).catch(() => null);
  if (!dir) return [];
  let names: string[];
  try { names = (await readdir(dir)).filter((n) => TEMPLATE_FILE_RE.test(n)).sort().slice(0, TEMPLATE_LIMITS.files); } catch { return []; }
  const out: Loaded[] = [];
  for (const file of names) {
    const p = await resolveReadable(root, [...rel, file].join("/")).catch(() => null);
    if (!p) continue;
    let text: string;
    try { text = await readFile(p, "utf8"); } catch { continue; }
    try { out.push({ file, text, raw: JSON.parse(text) }); } catch (e) { out.push({ file, text, raw: null, parseError: "bad JSON: " + (e as Error).message }); }
  }
  return out;
}

/** The building lookup the game's settlement store uses: built-ins + valid user templates that do not shadow one. */
export async function buildingLookup(root: string) {
  const A = await loadArea();
  const b = (await readFolder(root, templateBase("buildings"))).filter((l) => l.raw && typeof l.raw === "object").map((l) => l.raw as BuildingTemplate);
  const u = (await readFolder(root, templateUserBase("buildings"))).filter((l) => l.raw && typeof l.raw === "object").map((l) => l.raw as BuildingTemplate);
  return A.makeLookup(b, u);
}

const idOf = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "");

export async function listTemplates(root: string, kind: TemplateKind, withTemplates = false): Promise<Entry[]> {
  const A = await loadArea();
  const lookup = kind === "settlements" ? await buildingLookup(root) : () => undefined;
  const builtins = await readFolder(root, templateBase(kind));
  const users = await readFolder(root, templateUserBase(kind));
  const builtinIds = new Set(builtins.map((l) => idOf(l.raw)));
  const entry = (l: Loaded, src: Src): Entry => {
    const o = (l.raw ?? {}) as Partial<AnyTemplate> & { rows?: unknown };
    const rows = Array.isArray(o.rows) ? (o.rows as string[]) : [];
    const errors = l.parseError ? [l.parseError] : A.validate(kind, l.raw, lookup);
    const id = idOf(l.raw) || l.file.slice(0, -5);
    const e: Entry = {
      id, name: typeof o.name === "string" ? o.name : id, file: l.file, src,
      path: [...(src === "builtin" ? templateBase(kind) : templateUserBase(kind)), l.file].join("/"),
      tier: typeof (o as { tier?: unknown }).tier === "number" ? (o as { tier: number }).tier : undefined,
      w: typeof rows[0] === "string" ? rows[0].length : 0, h: rows.length, errors,
    };
    if (kind === "buildings") e.buildingType = (o as Partial<BuildingTemplate>).buildingType;
    if (kind !== "buildings" && typeof (o as { weight?: unknown }).weight === "number") e.weight = (o as { weight: number }).weight;
    if (src === "user" && builtinIds.has(id)) e.shadowed = true;
    if (withTemplates && !l.parseError) e.template = l.raw as AnyTemplate;
    return e;
  };
  return [...builtins.map((l) => entry(l, "builtin")), ...users.map((l) => entry(l, "user"))];
}

export async function readTemplate(root: string, kind: TemplateKind, src: string, id: string) {
  const A = await loadArea();
  if (src !== "builtin" && src !== "user") throw new HttpError(400, "source must be builtin or user");
  if (!A.ID_RE.test(id)) throw new HttpError(400, "bad template id");
  const rel = [...(src === "builtin" ? templateBase(kind) : templateUserBase(kind)), id + ".json"].join("/");
  const p = await resolveReadable(root, rel);
  if (!p) throw new HttpError(404, `no ${src} ${kind} template "${id}"`);
  const text = await readFile(p, "utf8");
  let template: unknown;
  try { template = JSON.parse(text); } catch { throw new HttpError(422, `${rel}: bad JSON`); }
  const lookup = kind === "settlements" ? await buildingLookup(root) : () => undefined;
  return { kind, src, id, path: rel, hash: sha256(text), template, errors: A.validate(kind, template, lookup) };
}

/** Validate a template body with the game's validator (and the Lab's id / collision rules). */
export async function checkTemplate(root: string, kind: TemplateKind, template: unknown) {
  const A = await loadArea();
  if (!template || typeof template !== "object" || Array.isArray(template)) throw new HttpError(400, "template must be an object");
  const lookup = kind === "settlements" ? await buildingLookup(root) : () => undefined;
  return { errors: A.validate(kind, template, lookup), stats: A.statsLine(kind, template as AnyTemplate, lookup) };
}

async function ids(root: string, kind: TemplateKind) {
  const b = new Set((await readFolder(root, templateBase(kind))).map((l) => idOf(l.raw)).filter(Boolean));
  const uFiles = new Set((await readFolder(root, templateUserBase(kind))).map((l) => l.file.slice(0, -5)));
  return { builtins: b, userFiles: uFiles };
}

/**
 * Save a USER template. body: {template, overwrite?: boolean, baseHash?: string}. Refuses invalid templates (400 with the
 * game validator's reasons), a built-in's id (409), an existing user file unless `overwrite` (409), and a changed file
 * when `baseHash` (from the read) no longer matches (409: e.g. the in-game editor saved it meanwhile).
 */
export async function saveTemplate(root: string, kind: TemplateKind, body: Record<string, unknown>) {
  const A = await loadArea();
  const t = body.template;
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new HttpError(400, "template must be an object");
  const id = idOf(t);
  if (!A.ID_RE.test(id)) throw new HttpError(400, "invalid template: id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)");
  const file = id + ".json";
  if (!TEMPLATE_FILE_RE.test(file)) throw new HttpError(400, "bad file name");
  const lookup = kind === "settlements" ? await buildingLookup(root) : () => undefined;
  const errs = A.validate(kind, t, lookup);
  if (errs.length) throw new HttpError(400, "invalid template: " + errs.slice(0, 20).join("; "));
  const { builtins, userFiles } = await ids(root, kind);
  if (builtins.has(id)) throw new HttpError(409, `"${id}" is a built-in template (read-only): save it under another id`);
  const relDir = templateUserBase(kind).join("/"), rel = `${relDir}/${file}`;
  if (userFiles.has(id)) {
    if (body.overwrite !== true) throw new HttpError(409, `a user template "${id}" exists: choose another id (or overwrite it)`);
    if (typeof body.baseHash === "string") {
      const p = await resolveReadable(root, rel);
      const now = p ? sha256(await readFile(p)) : "";
      if (now !== body.baseHash) throw new HttpError(409, `${rel} changed on disk since you opened it (the in-game editor?): reload it`);
    }
  }
  const text = A.formatTemplate(A.normalise(kind, t as AnyTemplate));
  if (text.length > TEMPLATE_LIMITS.body) throw new HttpError(413, "template too large");
  const backup = new Backup(root);
  await ensureDir(root, relDir);
  await writeWithBackup(root, backup, rel, text);
  await backup.prune();
  return { ok: true, kind, id, path: rel, hash: sha256(text), backup: backup.dirRel };
}

export async function deleteTemplate(root: string, kind: TemplateKind, body: Record<string, unknown>) {
  const A = await loadArea();
  const id = body.id;
  if (typeof id !== "string" || !A.ID_RE.test(id)) throw new HttpError(400, "bad template id");
  const { builtins, userFiles } = await ids(root, kind);
  if (!userFiles.has(id)) throw new HttpError(builtins.has(id) ? 409 : 404, builtins.has(id) ? "built-in templates can't be deleted" : `no user template "${id}"`);
  const rel = `${templateUserBase(kind).join("/")}/${id}.json`, backup = new Backup(root);
  await deleteWithBackup(root, backup, rel);
  await backup.prune();
  return { ok: true, kind, id, path: rel, backup: backup.dirRel };
}

/** Copy a template (built-in or user) to a new USER id. body: {src, from, id, name?}. */
export async function duplicateTemplate(root: string, kind: TemplateKind, body: Record<string, unknown>) {
  const A = await loadArea();
  const { src, from, id, name } = body as { src?: unknown; from?: unknown; id?: unknown; name?: unknown };
  if (typeof from !== "string" || typeof src !== "string") throw new HttpError(400, "src and from are required");
  if (typeof id !== "string" || !A.ID_RE.test(id)) throw new HttpError(400, "bad new id (1-48 of a-z 0-9 - _, starting with a letter / digit)");
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 40)) throw new HttpError(400, "name: 1-40 characters");
  const orig = await readTemplate(root, kind, src, from);
  const t = { ...(orig.template as AnyTemplate), id, ...(typeof name === "string" ? { name } : {}) };
  return saveTemplate(root, kind, { template: t });
}
