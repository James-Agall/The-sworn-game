// manifest.json model + a formatting-preserving writer.
//
// The game, rig/body.html and scripts/slice-rig-sheet.mjs read client/public/rig/parts/<set>/manifest.json:
//   { "set": "...", "parts": { "<name>": { file, pivot: [x, y], len, joint, size: [w, h], scale, variant, ...unknown } }, "soleBelowAnkle": n, ... }
// The Lab reads and writes exactly that format. writeManifestText() rewrites only what changed: every untouched part entry,
// every untouched top-level key and all whitespace between them are copied byte-for-byte from the old file, so a diff of a Lab
// save shows only the parts that were edited. Unknown fields are kept because the Lab edits whole entry objects it got from the file.

export type Vec2 = [number, number];
export type PartEntry = {
  file: string;
  pivot: Vec2;
  len?: number;
  joint?: string;
  size?: Vec2;
  scale?: number;
  variant?: string;
  [extra: string]: unknown;
};
export type Manifest = {
  set?: string;
  parts: Record<string, PartEntry>;
  [extra: string]: unknown;
};

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  // key order matters for byte preservation: {a,b} and {b,a} serialise differently
  return ka.every((k, i) => k === kb[i] && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ---- a tiny JSON scanner that records where each member of an object sits in the text
type Member = { key: string; keyStart: number; valueStart: number; valueEnd: number };
type ObjSpan = { start: number; end: number; members: Member[] };

const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
function skipWs(t: string, i: number): number { while (i < t.length && isWs(t[i])) i++; return i; }
function stringEnd(t: string, i: number): number {
  if (t[i] !== '"') throw new Error(`manifest: expected a string at ${i}`);
  for (let j = i + 1; j < t.length; j++) { if (t[j] === "\\") { j++; continue; } if (t[j] === '"') return j + 1; }
  throw new Error("manifest: unterminated string");
}
function valueEnd(t: string, i: number): number {
  const c = t[i];
  if (c === '"') return stringEnd(t, i);
  if (c === "{" || c === "[") {
    const close = c === "{" ? "}" : "]";
    let j = skipWs(t, i + 1);
    if (t[j] === close) return j + 1;
    for (;;) {
      if (c === "{") { j = skipWs(t, stringEnd(t, j)); if (t[j] !== ":") throw new Error(`manifest: expected ':' at ${j}`); j = skipWs(t, j + 1); }
      j = skipWs(t, valueEnd(t, j));
      if (t[j] === ",") { j = skipWs(t, j + 1); continue; }
      if (t[j] === close) return j + 1;
      throw new Error(`manifest: unexpected '${t[j]}' at ${j}`);
    }
  }
  let j = i; while (j < t.length && !isWs(t[j]) && !",}]".includes(t[j])) j++;
  if (j === i) throw new Error(`manifest: unexpected '${c}' at ${i}`);
  return j;
}
function scanObject(t: string, start: number): ObjSpan {
  if (t[start] !== "{") throw new Error("manifest: expected an object");
  const members: Member[] = [];
  let j = skipWs(t, start + 1);
  if (t[j] === "}") return { start, end: j + 1, members };
  for (;;) {
    const keyStart = j, ke = stringEnd(t, j), key = JSON.parse(t.slice(j, ke)) as string;
    j = skipWs(t, ke); if (t[j] !== ":") throw new Error(`manifest: expected ':' at ${j}`);
    const valueStart = skipWs(t, j + 1), ve = valueEnd(t, valueStart);
    members.push({ key, keyStart, valueStart, valueEnd: ve });
    j = skipWs(t, ve);
    if (t[j] === ",") { j = skipWs(t, j + 1); continue; }
    if (t[j] === "}") return { start, end: j + 1, members };
    throw new Error(`manifest: unexpected '${t[j]}' at ${j}`);
  }
}

/** Indent unit of a JSON text written by JSON.stringify (" " for the slicer's files, "  " for others). */
export function detectIndent(text: string): string {
  const m = /\{\r?\n([ \t]+)"/.exec(text);
  return m ? m[1] : " ";
}

type Layout = { open: string; sep: string; close: string; colon: string };
function layoutOf(t: string, span: ObjSpan, depthIndent: string, unit: string, nl: string): Layout {
  const m = span.members;
  if (!m.length) return { open: nl + depthIndent + unit, sep: "," + nl + depthIndent + unit, close: nl + depthIndent, colon: ": " };
  const first = m[0], last = m[m.length - 1];
  const colon = t.slice(stringEnd(t, first.keyStart), first.valueStart);
  const sep = m.length > 1 ? t.slice(first.valueEnd, m[1].keyStart) : "," + nl + depthIndent + unit;
  return { open: t.slice(span.start + 1, first.keyStart), sep, close: t.slice(last.valueEnd, span.end - 1), colon };
}
/** JSON.stringify(v, null, unit) with every line after the first shifted right by `depthIndent`. */
function fresh(v: unknown, unit: string, depthIndent: string, nl: string): string {
  return JSON.stringify(v, null, unit).split("\n").join(nl + depthIndent);
}

/**
 * Serialise `next` as the new text of a manifest whose current text is `oldText` (null for a new file).
 * Untouched entries keep their exact bytes; changed or new entries are written the way JSON.stringify would, in the file's own indent.
 */
export function writeManifestText(oldText: string | null, next: Manifest): string {
  if (oldText == null || !oldText.trim()) return JSON.stringify(next, null, 1);
  const old = JSON.parse(oldText) as Manifest;
  if (deepEqual(old, next)) return oldText;
  const unit = detectIndent(oldText), nl = oldText.includes("\r\n") ? "\r\n" : "\n";
  const topStart = skipWs(oldText, 0), top = scanObject(oldText, topStart);
  const topLay = layoutOf(oldText, top, "", unit, nl), oldTop = new Map(top.members.map((m) => [m.key, m]));
  const topParts: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const m = oldTop.get(key), oldValue = (old as Record<string, unknown>)[key];
    if (m && deepEqual(oldValue, value)) { topParts.push(oldText.slice(m.keyStart, m.valueEnd)); continue; }
    const keyText = JSON.stringify(key) + topLay.colon;
    if (key === "parts" && m && oldText[m.valueStart] === "{" && value && typeof value === "object") {
      topParts.push(keyText + writeParts(oldText, scanObject(oldText, m.valueStart), old.parts || {}, value as Record<string, PartEntry>, unit, nl));
    } else {
      topParts.push(keyText + fresh(value, unit, unit, nl));
    }
  }
  return oldText.slice(0, top.start) + "{" + topLay.open + topParts.join(topLay.sep) + topLay.close + "}" + oldText.slice(top.end);
}

function writeParts(t: string, span: ObjSpan, oldParts: Record<string, PartEntry>, next: Record<string, PartEntry>, unit: string, nl: string): string {
  const lay = layoutOf(t, span, unit, unit, nl), byKey = new Map(span.members.map((m) => [m.key, m]));
  const out: string[] = [];
  for (const [name, entry] of Object.entries(next)) {
    const m = byKey.get(name);
    if (m && deepEqual(oldParts[name], entry)) out.push(t.slice(m.keyStart, m.valueEnd));
    else out.push(JSON.stringify(name) + lay.colon + fresh(entry, unit, unit + unit, nl));
  }
  if (!out.length) return "{}";
  return "{" + lay.open + out.join(lay.sep) + lay.close + "}";
}

/** Light structural check of a manifest object received from a client. Returns an error text or null. */
export function checkManifestShape(m: unknown): string | null {
  if (!m || typeof m !== "object" || Array.isArray(m)) return "manifest must be an object";
  const parts = (m as Manifest).parts;
  if (!parts || typeof parts !== "object" || Array.isArray(parts)) return "manifest.parts must be an object";
  for (const [name, e] of Object.entries(parts)) {
    if (!e || typeof e !== "object") return `part ${name}: entry must be an object`;
    if (typeof e.file !== "string") return `part ${name}: file must be a string`;
    if (!Array.isArray(e.pivot) || e.pivot.length !== 2 || !e.pivot.every((v) => typeof v === "number" && Number.isFinite(v))) return `part ${name}: pivot must be [x, y]`;
    if (e.size !== undefined && (!Array.isArray(e.size) || e.size.length !== 2 || !e.size.every((v) => Number.isInteger(v) && v > 0 && v <= 4096))) return `part ${name}: size must be [w, h]`;
    for (const k of ["len", "scale"] as const) if (e[k] !== undefined && (typeof e[k] !== "number" || !Number.isFinite(e[k]))) return `part ${name}: ${k} must be a number`;
    for (const k of ["joint", "variant"] as const) if (e[k] !== undefined && typeof e[k] !== "string") return `part ${name}: ${k} must be a string`;
  }
  return null;
}
