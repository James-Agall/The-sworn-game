// Area tab, building interiors: the game's BUILT-IN files shared/src/data/interiors/<id>.json. There is no user/
// layer (stage B design: shared/src/interiors.ts imports these files statically, client and server both), so a save
// EDITS THE GAME'S FILE. Safeguards: the allow-list names only the nine existing BUILDING_INTERIOR_IDS files (never
// legend.json, never a new name: the file must already exist); the game's validateInteriorFile must pass (incl. the
// hall's throne / table / chest); optimistic concurrency (the hash the editor read must still be the file on disk,
// else 409); the game's normaliseInteriorFile + the files' own format (JSON.stringify(f, null, 2) + "\n", so git diffs
// stay minimal); a backup of the old file under art-sources/lab/backups/<time>/; an atomic write. "Diff vs git HEAD"
// reads the committed version with `git show HEAD:./<path>` (execFile, fixed arguments, no shell).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { HttpError, INTERIOR_BASE, INTERIOR_IDS, isInteriorId, resolveReadable } from "./paths.ts";
import { Backup, writeWithBackup } from "./store.ts";
import { sha256 } from "./sets.ts";
import { loadArea } from "./game.ts";

export const INTERIOR_LIMITS = { body: 256 << 10 };
const relOf = (id: string) => [...INTERIOR_BASE, id + ".json"].join("/");
export const INTERIOR_DIR = INTERIOR_BASE.join("/");

async function readText(root: string, rel: string): Promise<string | null> {
  const p = await resolveReadable(root, rel);
  if (!p) return null;
  return readFile(p, "utf8");
}

export async function listInteriors(root: string) {
  const A = await loadArea();
  const out = [];
  for (const id of INTERIOR_IDS) {
    const rel = relOf(id), text = await readText(root, rel);
    if (text === null) { out.push({ id, path: rel, missing: true, errors: ["file missing"] }); continue; }
    let raw: unknown = null, errors: string[];
    try { raw = JSON.parse(text); errors = A.validateInteriorFile(raw); } catch (e) { errors = ["bad JSON: " + (e as Error).message]; }
    const f = raw as { variants?: unknown[]; upper?: unknown } | null;
    out.push({ id, path: rel, hash: sha256(text), errors, variants: Array.isArray(f?.variants) ? f!.variants.length : 0, upper: !!f?.upper });
  }
  return out;
}

export async function readInterior(root: string, id: string) {
  if (!isInteriorId(id)) throw new HttpError(404, `no building interior "${id}" (one of ${INTERIOR_IDS.join(", ")})`);
  const A = await loadArea();
  const rel = relOf(id), text = await readText(root, rel);
  if (text === null) throw new HttpError(404, `${rel} is missing`);
  let file: unknown;
  try { file = JSON.parse(text); } catch { throw new HttpError(422, `${rel}: bad JSON`); }
  return { id, path: rel, hash: sha256(text), file, errors: A.validateInteriorFile(file) };
}

/** body: {file, baseHash}. Writes the BUILT-IN file (see the header). */
export async function saveInterior(root: string, id: string, body: Record<string, unknown>) {
  if (!isInteriorId(id)) throw new HttpError(404, `no building interior "${id}": the Lab never creates interior files`);
  const A = await loadArea();
  const f = body.file;
  if (!f || typeof f !== "object" || Array.isArray(f)) throw new HttpError(400, "file must be an object");
  if ((f as { id?: unknown }).id !== id) throw new HttpError(400, `the file's id must be "${id}" (it names the file)`);
  const errs = A.validateInteriorFile(f);
  if (errs.length) throw new HttpError(400, "invalid interior file: " + errs.slice(0, 20).join("; "));
  if (typeof body.baseHash !== "string") throw new HttpError(400, "baseHash (the hash you opened) is required");
  const rel = relOf(id), now = await readText(root, rel);
  if (now === null) throw new HttpError(404, `${rel} is missing: the Lab only edits the existing files`);
  if (sha256(now) !== body.baseHash) throw new HttpError(409, `${rel} changed on disk since you opened it (git checkout? another editor?): reload it`);
  const text = JSON.stringify(A.normaliseInteriorFile(f as Parameters<typeof A.normaliseInteriorFile>[0]), null, 2) + "\n";
  if (text.length > INTERIOR_LIMITS.body) throw new HttpError(413, "interior file too large");
  const backup = new Backup(root);
  await writeWithBackup(root, backup, rel, text);
  await backup.prune();
  return { ok: true, id, path: rel, hash: sha256(text), changed: text !== now, backup: backup.dirRel };
}

/** The committed version (git HEAD) of the file, for the diff view; `head: null` with a reason when there is none. */
export async function interiorHead(root: string, id: string): Promise<{ id: string; path: string; head: string | null; error?: string }> {
  if (!isInteriorId(id)) throw new HttpError(404, `no building interior "${id}"`);
  const rel = relOf(id);
  return new Promise((resolve) => {
    execFile("git", ["-C", root, "show", `HEAD:./${rel}`], { timeout: 10_000, maxBuffer: 4 << 20, shell: false, env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", LC_ALL: "C" } },
      (err, stdout, stderr) => resolve(err ? { id, path: rel, head: null, error: (String(stderr).trim() || err.message).slice(0, 300) } : { id, path: rel, head: String(stdout) }));
  });
}
