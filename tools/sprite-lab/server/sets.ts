// Reading part sets from disk (read-only helpers shared by the API and the CLI).
import { lstat, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { isSetName } from "../shared/names.ts";
import type { Manifest } from "../shared/manifest.ts";
import { validateSet, type Img, type Report } from "../shared/validators.ts";
import { decodePNG } from "./png.ts";
import { HttpError, PARTS_BASE } from "./paths.ts";

export const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
export const partsDir = (root: string) => path.join(root, ...PARTS_BASE);

export async function listSets(root: string): Promise<{ name: string; parts: number; hasManifest: boolean }[]> {
  let names: string[] = [];
  try { names = await readdir(partsDir(root)); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (!isSetName(name)) continue;
    const st = await lstat(path.join(partsDir(root), name));
    if (!st.isDirectory()) continue;
    let parts = 0, hasManifest = false;
    try { parts = Object.keys((JSON.parse(await readFile(path.join(partsDir(root), name, "manifest.json"), "utf8")) as Manifest).parts || {}).length; hasManifest = true; } catch { /* no or bad manifest */ }
    out.push({ name, parts, hasManifest });
  }
  return out;
}

export async function setDir(root: string, set: string): Promise<string> {
  if (!isSetName(set)) throw new HttpError(400, "bad set name");
  const dir = path.join(partsDir(root), set);
  const st = await lstat(dir).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) throw new HttpError(404, "no such set: " + set);
  return dir;
}

/** Regular (non-symlink, non-hidden) files in a set folder. */
export async function setFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) if (e.isFile() && !e.name.startsWith(".")) out.push(e.name);
  return out.sort();
}

export async function readManifest(dir: string): Promise<{ text: string | null; manifest: Manifest | null; hash: string }> {
  let text: string | null = null;
  try { text = await readFile(path.join(dir, "manifest.json"), "utf8"); } catch { /* none yet */ }
  return { text, manifest: text ? (JSON.parse(text) as Manifest) : null, hash: text == null ? "none" : sha256(text) };
}

export async function validateSetOnDisk(root: string, set: string): Promise<Report> {
  const dir = await setDir(root, set), files = await setFiles(dir), { manifest } = await readManifest(dir);
  const images: Record<string, Img | string> = {};
  for (const f of files) if (f.endsWith(".png")) {
    try { images[f] = decodePNG(await readFile(path.join(dir, f))); } catch (e) { images[f] = String((e as Error).message || e); }
  }
  return validateSet({ set, manifest: manifest || { parts: {} }, files, images });
}
