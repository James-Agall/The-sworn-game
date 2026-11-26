// Safe path handling for the Lab server.
//
// Every file the server touches is named by a path RELATIVE to the Lab root (the repo, or LAB_ROOT / --root for tests).
// checkRel() refuses anything odd before it reaches the file system; resolveWritable() additionally requires the path to
// sit in the write allow-list and to contain no symlink at all below the root; resolveReadable() requires the real path to
// stay inside the root. The allow-list is the only place that decides where the Lab may write.
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isDataName, isSetName, SIDECAR_FILE, isPngName } from "../shared/names.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$/;

/** Split a relative path into segments, refusing NUL, backslashes, absolute paths, %, empty / . / .. segments and odd names. */
export function checkRel(rel: string): string[] {
  if (typeof rel !== "string" || !rel || rel.length > 400) throw new HttpError(400, "bad path");
  if (/[\0\\%:]/.test(rel) || rel.startsWith("/") || path.isAbsolute(rel)) throw new HttpError(400, "bad path");
  const segs = rel.split("/");
  for (const s of segs) {
    if (!s || s === "." || s === ".." || s.includes("..") || !SEG_RE.test(s)) throw new HttpError(400, "bad path segment");
  }
  return segs;
}

export const PARTS_BASE = ["client", "public", "rig", "parts"];
export const CLIPS_BASE = ["client", "public", "rig", "clips"];
export const LAB_BASE = ["art-sources", "lab"];
/** Area tab: the game's template kinds. Only their `user/` folders are writable; the built-ins beside them never are. */
export const TEMPLATE_KINDS = ["camps", "buildings", "settlements"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const isTemplateKind = (k: unknown): k is TemplateKind => typeof k === "string" && (TEMPLATE_KINDS as readonly string[]).includes(k);
export const TEMPLATE_FILE_RE = /^[a-z0-9][a-z0-9_-]{0,60}\.json$/;
export const templateBase = (kind: TemplateKind) => ["server", "data", kind];
export const templateUserBase = (kind: TemplateKind) => ["server", "data", kind, "user"];

/** The write allow-list. Paths are segment arrays relative to the Lab root. */
export function isWritable(segs: string[]): boolean {
  const eq = (base: string[]) => base.every((b, i) => segs[i] === b);
  if (segs.length === 5 && segs[0] === "server" && segs[1] === "data" && isTemplateKind(segs[2]) && segs[3] === "user") return TEMPLATE_FILE_RE.test(segs[4]);
  if (eq(PARTS_BASE) && segs.length === PARTS_BASE.length + 2) {
    const [set, file] = segs.slice(PARTS_BASE.length);
    return isSetName(set) && (isPngName(file) || file === "manifest.json" || file === SIDECAR_FILE || file === "slice-report.json");
  }
  if (eq(CLIPS_BASE) && segs.length === CLIPS_BASE.length + 1) {
    const f = segs[CLIPS_BASE.length];
    return f.endsWith(".json") && isDataName(f.slice(0, -5));
  }
  if (eq(LAB_BASE) && segs.length > LAB_BASE.length && segs.length <= LAB_BASE.length + 8) return true;
  return false;
}
/** A set folder itself (for mkdir). */
export function isWritableDir(segs: string[]): boolean {
  const eq = (base: string[]) => segs.length >= base.length && base.every((b, i) => segs[i] === b);
  // server, server/data, server/data/<kind> (existing folders on the way) and server/data/<kind>/user
  if (segs[0] === "server" && segs.length <= 4) {
    if (segs.length === 1) return true;
    if (segs[1] !== "data") return false;
    if (segs.length === 2) return true;
    return isTemplateKind(segs[2]) && (segs.length === 3 || segs[3] === "user");
  }
  if (eq(PARTS_BASE)) return segs.length === PARTS_BASE.length || (segs.length === PARTS_BASE.length + 1 && isSetName(segs[PARTS_BASE.length]));
  if (eq(CLIPS_BASE)) return segs.length === CLIPS_BASE.length;
  if (eq(LAB_BASE)) return segs.length <= LAB_BASE.length + 7;
  return segs.length < LAB_BASE.length && LAB_BASE.slice(0, segs.length).every((b, i) => segs[i] === b)
    || segs.length < PARTS_BASE.length && PARTS_BASE.slice(0, segs.length).every((b, i) => segs[i] === b);
}

async function exists(p: string) { try { await lstat(p); return true; } catch { return false; } }

/**
 * Absolute path for a write. Throws unless the path is allow-listed, no existing component below the root is a symlink
 * (realpath of the deepest existing ancestor must equal its plain path) and an existing target is a regular file.
 */
export async function resolveWritable(realRoot: string, rel: string, kind: "file" | "dir" = "file"): Promise<string> {
  const segs = checkRel(rel);
  if (kind === "file" ? !isWritable(segs) : !isWritableDir(segs)) throw new HttpError(403, "path not writable: " + rel);
  const abs = path.join(realRoot, ...segs);
  let i = segs.length;
  while (i > 0 && !(await exists(path.join(realRoot, ...segs.slice(0, i))))) i--;
  const anc = path.join(realRoot, ...segs.slice(0, i));
  if ((await realpath(anc)) !== anc) throw new HttpError(403, "symlink in path: " + rel);
  if (i === segs.length) {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) throw new HttpError(403, "target is a symlink: " + rel);
    if (kind === "file" && !st.isFile()) throw new HttpError(403, "target is not a file: " + rel);
    if (kind === "dir" && !st.isDirectory()) throw new HttpError(403, "target is not a folder: " + rel);
  }
  return abs;
}

/** Absolute path for a read; the real path must stay inside `realBase`. Returns null when the file does not exist. */
export async function resolveReadable(realBase: string, rel: string): Promise<string | null> {
  const segs = checkRel(rel), abs = path.join(realBase, ...segs);
  let real: string;
  try { real = await realpath(abs); } catch { return null; }
  if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new HttpError(403, "outside the root");
  return real;
}
