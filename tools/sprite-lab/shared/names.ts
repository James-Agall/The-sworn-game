// Name rules shared by the Lab server, the browser app and the validators.
// The server refuses anything that does not match these; the validators report parts that break the naming convention.

/** A part set folder under client/public/rig/parts/. */
export const SET_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
/** A part key in manifest.json: `family[.variant[.more]]`, e.g. `upperArm`, `upperArm.t1`, `head.m_beard`, `horse.bay.0`. */
export const PART_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}(?:\.[A-Za-z0-9_-]{1,24}){0,3}$/;
/** A PNG file inside a set folder (no path separators, no leading dot, no `..`). */
export const PNG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}(?:\.[A-Za-z0-9_-]{1,24}){0,3}\.png$/;
/** Palettes (art-sources/lab/palettes/<name>.json) and clips (client/public/rig/clips/<name>.json). */
export const DATA_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
/** Files in a set folder that are not parts (written by the slicer or the placeholder painter). */
export const NON_PART_PNGS = new Set(["slice-preview.png", "parts-sheet.png"]);
/** The Lab's per-set sidecar (draw order and other Lab-only metadata; the game ignores it). */
export const SIDECAR_FILE = "lab.json";

export const isSetName = (s: unknown): s is string => typeof s === "string" && SET_RE.test(s);
export const isPartName = (s: unknown): s is string => typeof s === "string" && PART_RE.test(s);
export const isPngName = (s: unknown): s is string => typeof s === "string" && PNG_RE.test(s) && !s.includes("..");
export const isDataName = (s: unknown): s is string => typeof s === "string" && DATA_NAME_RE.test(s);

/** The variant the slicer derives from a part name: everything after the first dot (`upperArm.t1` -> `t1`). */
export const variantOf = (name: string): string => (name.includes(".") ? name.split(".").slice(1).join(".") : "");
/** The family of a part: the text before the first dot. */
export const familyOf = (name: string): string => name.split(".")[0];
