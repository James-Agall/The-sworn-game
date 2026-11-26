// Atomic writes and backups. Every overwrite or delete first copies the old file to
// art-sources/lab/backups/<timestamp>/<relative path>; only the newest MAX_BACKUPS backup folders are kept.
import { copyFile, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { LAB_BASE, resolveWritable } from "./paths.ts";

export const MAX_BACKUPS = 30;
const BACKUP_REL = [...LAB_BASE, "backups"].join("/");

/** mkdir -p for an allow-listed folder, one checked level at a time. */
export async function ensureDir(realRoot: string, rel: string): Promise<string> {
  const segs = rel.split("/");
  let abs = realRoot;
  for (let i = 1; i <= segs.length; i++) {
    abs = await resolveWritable(realRoot, segs.slice(0, i).join("/"), "dir");
    await mkdir(abs).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
  }
  return abs;
}

/** Write via a temp file in the same folder, then rename over the target (readers never see a half-written file). */
export async function atomicWrite(realRoot: string, rel: string, data: string | Uint8Array): Promise<void> {
  const abs = await resolveWritable(realRoot, rel);
  await ensureDir(realRoot, path.posix.dirname(rel));
  const tmp = path.join(path.dirname(abs), `.lab-tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function readIfExists(abs: string): Promise<Buffer | null> {
  try { return await readFile(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}

let lastStamp = "";
function stamp(): string {
  let s = new Date().toISOString().replace(/[:.]/g, "-");
  if (s <= lastStamp) s = lastStamp + "x";   // two sessions in the same millisecond still sort in order
  lastStamp = s;
  return s;
}

/** A backup session: copies files (relative paths) once each, before they are overwritten or deleted. */
export class Backup {
  root: string;
  dirRel: string | null = null;
  saved = new Set<string>();
  constructor(realRoot: string) { this.root = realRoot; }
  async add(rel: string): Promise<void> {
    if (this.saved.has(rel)) return;
    const src = await resolveWritable(this.root, rel);
    if ((await readIfExists(src)) == null) return;
    if (!this.dirRel) this.dirRel = `${BACKUP_REL}/${stamp()}`;
    const dstRel = `${this.dirRel}/${rel}`;
    await ensureDir(this.root, path.posix.dirname(dstRel));
    await copyFile(src, await resolveWritable(this.root, dstRel));
    this.saved.add(rel);
  }
  /** Drop the oldest backup folders beyond MAX_BACKUPS. */
  async prune(): Promise<void> {
    if (!this.dirRel) return;
    const dir = await resolveWritable(this.root, BACKUP_REL, "dir");
    const names = (await readdir(dir)).filter((n) => /^\d{4}-\d\d-\d\dT[\dx-]+Z?[x]*$/.test(n)).sort();
    for (const n of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) await rm(path.join(dir, n), { recursive: true, force: true });
  }
}

/** Overwrite with backup. */
export async function writeWithBackup(realRoot: string, backup: Backup, rel: string, data: string | Uint8Array): Promise<void> {
  const abs = await resolveWritable(realRoot, rel), old = await readIfExists(abs);
  if (old && Buffer.compare(old, Buffer.from(data)) === 0) return;
  if (old) await backup.add(rel);
  await atomicWrite(realRoot, rel, data);
}

export async function deleteWithBackup(realRoot: string, backup: Backup, rel: string): Promise<void> {
  const abs = await resolveWritable(realRoot, rel);
  await backup.add(rel);
  await unlink(abs);
}
