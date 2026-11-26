// Typed wrapper around the repo's dependency-free PNG codec (scripts/lib/png.mjs), so the Lab decodes PNGs exactly like the slicer.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { Img } from "../shared/validators.ts";

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
type PngLib = { decodePNG(buf: Uint8Array): Img; encodePNG(img: Img): Buffer };
const lib = (await import(pathToFileURL(path.join(REPO_DIR, "scripts/lib/png.mjs")).href)) as PngLib;

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = (b: Uint8Array) => b.length > 8 && SIG.every((v, i) => b[i] === v);
export const decodePNG = (b: Uint8Array): Img => lib.decodePNG(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
export const encodePNG = (img: Img): Buffer => lib.encodePNG(img);
