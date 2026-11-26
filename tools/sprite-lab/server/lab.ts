// The Sprite Lab HTTP server: security gate, JSON API, read-only static files and (optionally) the Vite-served app.
// Binds 127.0.0.1 only. See README.md "Security model".
import http from "node:http";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkManifestShape, writeManifestText, type Manifest } from "../shared/manifest.ts";
import { formatClip, validateClip } from "../shared/clip.ts";
import { isDataName, isPngName, isSetName, NON_PART_PNGS, SIDECAR_FILE } from "../shared/names.ts";
import { HttpError, checkRel, resolveReadable, resolveWritable, CLIPS_BASE, LAB_BASE, PARTS_BASE, TEMPLATE_KINDS, isTemplateKind, templateUserBase } from "./paths.ts";
import { TEMPLATE_LIMITS, checkTemplate, deleteTemplate, duplicateTemplate, listTemplates, readTemplate, saveTemplate } from "./templates.ts";
import { realStamp } from "./stamp.ts";
import { INTERIOR_DIR, INTERIOR_LIMITS, interiorHead, listInteriors, readInterior, saveInterior } from "./interiors.ts";
import { Backup, atomicWrite, deleteWithBackup, ensureDir, writeWithBackup } from "./store.ts";
import { listSets, readManifest, setDir, setFiles, sha256, validateSetOnDisk } from "./sets.ts";
import { decodePNG, isPng, REPO_DIR } from "./png.ts";
import { readHeroPalette } from "./palette.ts";

export const CODE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(CODE_DIR, "app"), PISKEL_DIST = path.join(CODE_DIR, "piskel-dist");
const SLICER = path.join(REPO_DIR, "scripts", "slice-rig-sheet.mjs"), LAYOUTS = path.join(REPO_DIR, "scripts", "rig-layouts");
const HERO_RIG = path.join(REPO_DIR, "client", "src", "heroRig.ts");
const GAME_READ_DIRS = [path.join(REPO_DIR, "shared", "src"), path.join(REPO_DIR, "client", "src")];

export const LIMITS = { jsonBody: 1 << 20, saveBody: 24 << 20, png: 4 << 20, maxPngSide: 1024, exportPng: 16 << 20, maxExportSide: 8192, refs: 6000 };
const EXPORT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export type LabOptions = { root: string; port: number; vite?: boolean; log?: (s: string) => void };
export type Lab = { server: http.Server; url: string; root: string; close(): Promise<void> };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
  ".gif": "image/gif", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

function send(res: http.ServerResponse, status: number, body: string | Uint8Array, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(body);
}
const json = (res: http.ServerResponse, status: number, obj: unknown) => send(res, status, JSON.stringify(obj));

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw new HttpError(413, "body too large");
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new HttpError(413, "body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
async function readJson(req: http.IncomingMessage, limit = LIMITS.jsonBody): Promise<Record<string, unknown>> {
  const b = await readBody(req, limit);
  let v: unknown;
  try { v = JSON.parse(b.toString("utf8")); } catch { throw new HttpError(400, "bad JSON"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "JSON body must be an object");
  return v as Record<string, unknown>;
}
function pngFromB64(name: string, b64: unknown): Buffer {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, `${name}: PNG must be base64`);
  const buf = Buffer.from(b64, "base64");
  if (buf.length > LIMITS.png) throw new HttpError(413, `${name}: PNG too large`);
  if (!isPng(buf)) throw new HttpError(400, `${name}: not a PNG`);
  let img;
  try { img = decodePNG(buf); } catch (e) { throw new HttpError(400, `${name}: PNG does not decode (${(e as Error).message})`); }
  if (img.w < 1 || img.h < 1 || img.w > LIMITS.maxPngSide || img.h > LIMITS.maxPngSide) throw new HttpError(400, `${name}: PNG size ${img.w}x${img.h} not allowed`);
  return buf;
}
const stampName = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function startLab(opts: LabOptions): Promise<Lab> {
  const root = await realpath(opts.root), log = opts.log || (() => {});
  let origins: Set<string> = new Set(), hosts: Set<string> = new Set();
  let vite: import("vite").ViteDevServer | null = null;

  // ---------------- security gate
  function gate(req: http.IncomingMessage): void {
    const host = String(req.headers.host || "");
    if (!hosts.has(host)) throw new HttpError(403, "bad Host");
    if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "cross-site request refused");
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) throw new HttpError(403, "cross-origin request refused");
    const m = req.method || "GET";
    if (m === "GET" || m === "HEAD") return;
    if (m !== "POST" && m !== "PUT") throw new HttpError(405, "method not allowed");
    if (!origin) throw new HttpError(403, "writes need an Origin header");
    if (req.headers["x-lab"] !== "1") throw new HttpError(403, "writes need X-Lab: 1");
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "writes must be application/json");
  }

  // ---------------- API
  async function api(req: http.IncomingMessage, res: http.ServerResponse, segs: string[]): Promise<void> {
    const m = req.method || "GET";
    const [a, b, c] = segs;
    if (a === "info" && m === "GET") return json(res, 200, { root, repo: REPO_DIR, sameRoot: root === REPO_DIR, writable: [PARTS_BASE.join("/") + "/<set>/", CLIPS_BASE.join("/") + "/", LAB_BASE.join("/") + "/", ...TEMPLATE_KINDS.map((k) => templateUserBase(k).join("/") + "/"), INTERIOR_DIR + "/<the 9 building files> (BUILT-INS: edits the game)"] });
    if (a === "sets" && !b && m === "GET") return json(res, 200, await listSets(root));
    if (a === "sets" && !b && m === "POST") return json(res, 200, await createSet(await readJson(req)));
    if (a === "sets" && b && !c && m === "GET") return json(res, 200, await getSet(b));
    if (a === "sets" && b && c === "save" && m === "POST") return json(res, 200, await saveSet(b, await readJson(req, LIMITS.saveBody)));
    if (a === "palettes" && !b && m === "GET") return json(res, 200, await palettes());
    if (a === "palettes" && b && m === "PUT") return json(res, 200, await putData([...LAB_BASE, "palettes"].join("/"), b, await readJson(req)));
    if (a === "clips" && !b && m === "GET") return json(res, 200, await listData(CLIPS_BASE.join("/")));
    if (a === "clips" && b && m === "GET") return json(res, 200, await getData(CLIPS_BASE.join("/"), b));
    if (a === "clips" && b && !c && m === "PUT") return json(res, 200, await putClip(b, await readJson(req)));
    if (a === "clips" && b && c === "delete" && m === "POST") return json(res, 200, await deleteClip(b));
    if (a === "exports" && !b && m === "POST") return json(res, 200, await saveExport(await readJson(req, LIMITS.saveBody)));
    if (a === "refs" && m === "GET") return json(res, 200, await refs());
    if (a === "layouts" && m === "GET") return json(res, 200, await layouts());
    if (a === "slice" && m === "POST") return json(res, 200, await slice(await readJson(req, LIMITS.saveBody)));
    if (a === "validate" && b && m === "GET") return json(res, 200, await validateSetOnDisk(root, b));
    if (a === "templates") return templatesApi(req, res, segs.slice(1));
    if (a === "interiors" && !b && m === "GET") return json(res, 200, await listInteriors(root));
    if (a === "interiors" && b && !c && m === "GET") return json(res, 200, await readInterior(root, b));
    if (a === "interiors" && b && c === "head" && m === "GET") return json(res, 200, await interiorHead(root, b));
    if (a === "interiors" && b && c === "save" && m === "POST") {
      const r = await saveInterior(root, b, await readJson(req, INTERIOR_LIMITS.body));
      log(`BUILT-IN interior ${r.changed ? "written" : "unchanged"} ${r.path}${r.backup ? " (backup " + r.backup + ")" : ""}`);
      return json(res, 200, r);
    }
    if (a === "stamp" && !b && m === "POST") return json(res, 200, await realStamp(root, await readJson(req, TEMPLATE_LIMITS.body)));
    throw new HttpError(404, "no such API route");
  }

  // ---------------- Area tab: game templates (built-ins read-only, user/ writable), see templates.ts
  async function templatesApi(req: http.IncomingMessage, res: http.ServerResponse, segs: string[]): Promise<void> {
    const m = req.method || "GET";
    const [kind, b, c, d] = segs;
    if (!isTemplateKind(kind)) throw new HttpError(404, "template kind must be one of " + TEMPLATE_KINDS.join(", "));
    if (!b && m === "GET") return json(res, 200, await listTemplates(root, kind, (req.url || "").includes("full=1")));
    if ((b === "builtin" || b === "user") && c && !d && m === "GET") return json(res, 200, await readTemplate(root, kind, b, c));
    if (b && !c && m === "POST") {
      const body = await readJson(req, TEMPLATE_LIMITS.body);
      if (b === "save") { const r = await saveTemplate(root, kind, body); log(`template saved ${r.path}`); return json(res, 200, r); }
      if (b === "import") { const r = await saveTemplate(root, kind, { template: body.template }); log(`template imported ${r.path}`); return json(res, 200, r); }
      if (b === "duplicate") { const r = await duplicateTemplate(root, kind, body); log(`template duplicated ${r.path}`); return json(res, 200, r); }
      if (b === "delete") { const r = await deleteTemplate(root, kind, body); log(`template deleted ${r.path}`); return json(res, 200, r); }
      if (b === "validate") return json(res, 200, await checkTemplate(root, kind, body.template));
    }
    throw new HttpError(404, "no such template route");
  }

  async function getSet(set: string) {
    const dir = await setDir(root, set), { text, hash } = await readManifest(dir), files = await setFiles(dir);
    let sidecar: unknown = null;
    if (files.includes(SIDECAR_FILE)) { try { sidecar = JSON.parse(await readFile(path.join(dir, SIDECAR_FILE), "utf8")); } catch { sidecar = null; } }
    return { set, manifestText: text, hash, sidecar, files };
  }

  async function createSet(body: Record<string, unknown>) {
    const name = body.name, from = body.copyFrom;
    if (!isSetName(name)) throw new HttpError(400, "bad set name (a-z 0-9 _ -, max 41)");
    if (from !== undefined && from !== null && !isSetName(from)) throw new HttpError(400, "bad copyFrom");
    const rel = [...PARTS_BASE, name].join("/");
    const exists = await stat(path.join(root, ...PARTS_BASE, name)).then(() => true, () => false);
    if (exists) throw new HttpError(409, "set exists: " + name);
    await ensureDir(root, rel);
    if (from) {
      const src = await setDir(root, from as string);
      for (const f of await setFiles(src)) {
        if (!(isPngName(f) || f === SIDECAR_FILE || f === "manifest.json")) continue;
        let data: Buffer | string = await readFile(path.join(src, f));
        if (f === "manifest.json") { const t = data.toString("utf8"), mm = JSON.parse(t) as Manifest; if (mm.set !== undefined) mm.set = name; data = writeManifestText(t, mm); }
        await atomicWrite(root, `${rel}/${f}`, data);
      }
    } else {
      await atomicWrite(root, `${rel}/manifest.json`, JSON.stringify({ set: name, parts: {} }, null, 1) + "\n");
    }
    return getSet(name);
  }

  async function saveSet(set: string, body: Record<string, unknown>) {
    const dir = await setDir(root, set), rel = (f: string) => [...PARTS_BASE, set, f].join("/");
    const { text: oldText, hash } = await readManifest(dir);
    if (body.baseHash !== hash) throw new HttpError(409, "the manifest changed on disk since you loaded it; reload the set");
    const shapeErr = checkManifestShape(body.manifest);
    if (shapeErr) throw new HttpError(400, shapeErr);
    const manifest = body.manifest as Manifest;
    const files = (body.files ?? {}) as Record<string, unknown>, del = (body.deleteFiles ?? []) as unknown[];
    if (typeof files !== "object" || Array.isArray(files)) throw new HttpError(400, "files must be an object");
    if (!Array.isArray(del)) throw new HttpError(400, "deleteFiles must be a list");
    const pngs = new Map<string, Buffer>();
    for (const [f, b64] of Object.entries(files)) {
      if (!isPngName(f) || NON_PART_PNGS.has(f)) throw new HttpError(400, "bad PNG name: " + f);
      pngs.set(f, pngFromB64(f, b64));
    }
    const existing = new Set(await setFiles(dir));
    for (const f of del) {
      if (!isPngName(f) || !existing.has(f)) throw new HttpError(400, "cannot delete: " + String(f));
      if (pngs.has(f)) throw new HttpError(400, "file both written and deleted: " + f);
    }
    for (const [name, p] of Object.entries(manifest.parts)) {
      if (!isPngName(p.file)) throw new HttpError(400, `part ${name}: bad file name`);
      if (!pngs.has(p.file) && (!existing.has(p.file) || del.includes(p.file))) throw new HttpError(400, `part ${name}: ${p.file} would not exist`);
    }
    let sidecarText: string | null = null;
    if (body.sidecar !== undefined && body.sidecar !== null) {
      const sc = body.sidecar as { order?: unknown };
      if (typeof sc !== "object" || Array.isArray(sc)) throw new HttpError(400, "sidecar must be an object");
      if (sc.order !== undefined && !(Array.isArray(sc.order) && sc.order.every((n) => typeof n === "string"))) throw new HttpError(400, "sidecar.order must be a list of names");
      sidecarText = JSON.stringify(sc, null, 2) + "\n";
      if (sidecarText.length > LIMITS.jsonBody) throw new HttpError(413, "sidecar too large");
    }
    const newText = writeManifestText(oldText, manifest);
    const backup = new Backup(root), written: string[] = [];
    for (const [f, buf] of pngs) { await writeWithBackup(root, backup, rel(f), buf); written.push(f); }
    if (sidecarText != null) await writeWithBackup(root, backup, rel(SIDECAR_FILE), sidecarText);
    if (newText !== oldText) { await writeWithBackup(root, backup, rel("manifest.json"), newText); written.push("manifest.json"); }
    for (const f of del as string[]) await deleteWithBackup(root, backup, rel(f));
    await backup.prune();
    log(`saved ${set}: ${written.length} file(s), ${del.length} deleted${backup.dirRel ? ", backup " + backup.dirRel : ""}`);
    return { ...(await getSet(set)), backup: backup.dirRel, written, deleted: del };
  }

  async function palettes() {
    let hero: unknown = null, heroError: string | null = null;
    try { hero = await readHeroPalette(HERO_RIG); } catch (e) { heroError = (e as Error).message; }
    return { hero, heroError, lab: await listData([...LAB_BASE, "palettes"].join("/")) };
  }

  async function listData(relDir: string) {
    const dir = path.join(root, ...checkRel(relDir));
    let names: string[] = [];
    try { names = (await readdir(dir)).filter((n) => n.endsWith(".json") && isDataName(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort(); } catch { /* none yet */ }
    return names;
  }
  async function getData(relDir: string, name: string) {
    if (!isDataName(name)) throw new HttpError(400, "bad name");
    const p = await resolveReadable(root, `${relDir}/${name}.json`);
    if (!p) throw new HttpError(404, "not found");
    return JSON.parse(await readFile(p, "utf8"));
  }
  async function putData(relDir: string, name: string, body: Record<string, unknown>) {
    if (!isDataName(name)) throw new HttpError(400, "bad name");
    const backup = new Backup(root);
    await ensureDir(root, relDir);
    await writeWithBackup(root, backup, `${relDir}/${name}.json`, JSON.stringify(body, null, 1) + "\n");
    await backup.prune();
    return { ok: true, name, backup: backup.dirRel };
  }

  // ---------------- clips: validated with the shared schema, built-in reference clips are read-only
  async function clipIsBuiltin(name: string): Promise<boolean> {
    const p = await resolveReadable(root, `${CLIPS_BASE.join("/")}/${name}.json`);
    if (!p) return false;
    try { return JSON.parse(await readFile(p, "utf8")).builtin === true; } catch { return false; }
  }
  async function putClip(name: string, body: Record<string, unknown>) {
    if (!isDataName(name)) throw new HttpError(400, "bad name");
    const errs = validateClip(body, name);
    if (errs.length) throw new HttpError(400, "invalid clip: " + errs.slice(0, 12).join("; "));
    if (body.builtin === true) throw new HttpError(400, "only the generator script writes built-in clips (remove \"builtin\")");
    if (await clipIsBuiltin(name)) throw new HttpError(409, `${name} is a built-in reference clip (read-only); duplicate it to edit`);
    const relDir = CLIPS_BASE.join("/"), backup = new Backup(root);
    await ensureDir(root, relDir);
    await writeWithBackup(root, backup, `${relDir}/${name}.json`, formatClip(body));
    await backup.prune();
    log(`saved clip ${name}`);
    return { ok: true, name, backup: backup.dirRel };
  }
  async function deleteClip(name: string) {
    if (!isDataName(name)) throw new HttpError(400, "bad name");
    if (!(await resolveReadable(root, `${CLIPS_BASE.join("/")}/${name}.json`))) throw new HttpError(404, "not found");
    if (await clipIsBuiltin(name)) throw new HttpError(409, `${name} is a built-in reference clip (read-only)`);
    const backup = new Backup(root);
    await deleteWithBackup(root, backup, `${CLIPS_BASE.join("/")}/${name}.json`);
    await backup.prune();
    return { ok: true, name, backup: backup.dirRel };
  }
  // ---------------- exports (contact sheets, baked previews) under art-sources/lab/exports/
  async function saveExport(body: Record<string, unknown>) {
    const name = body.name;
    if (typeof name !== "string" || !EXPORT_NAME_RE.test(name)) throw new HttpError(400, "bad export name (a-z 0-9 _ -, max 81)");
    const b64 = body.png;
    if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, "png must be base64");
    const buf = Buffer.from(b64, "base64");
    if (buf.length > LIMITS.exportPng) throw new HttpError(413, "PNG too large");
    if (!isPng(buf)) throw new HttpError(400, "not a PNG");
    let img;
    try { img = decodePNG(buf); } catch (e) { throw new HttpError(400, `PNG does not decode (${(e as Error).message})`); }
    if (img.w < 1 || img.h < 1 || img.w > LIMITS.maxExportSide || img.h > LIMITS.maxExportSide) throw new HttpError(400, `PNG size ${img.w}x${img.h} not allowed`);
    const relDir = [...LAB_BASE, "exports"].join("/"), rel = `${relDir}/${name}.png`, backup = new Backup(root);
    await ensureDir(root, relDir);
    await writeWithBackup(root, backup, rel, buf);
    await backup.prune();
    log(`export ${rel}`);
    return { ok: true, path: rel, backup: backup.dirRel };
  }

  async function refs() {
    const base = path.join(root, "client", "public", "sprites"), out: string[] = [];
    async function walk(dir: string, rel: string, depth: number) {
      if (depth > 6 || out.length >= LIMITS.refs) return;
      let ents;
      try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents.sort((x, y) => x.name.localeCompare(y.name))) {
        if (e.isSymbolicLink() || e.name.startsWith(".")) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        try { checkRel(r); } catch { continue; }
        if (e.isDirectory()) await walk(path.join(dir, e.name), r, depth + 1);
        else if (e.isFile() && e.name.endsWith(".png")) out.push(r);
        if (out.length >= LIMITS.refs) return;
      }
    }
    await walk(base, "", 0);
    return out;
  }

  async function layouts() {
    const out: { name: string; set?: string; cells: number }[] = [];
    for (const f of (await readdir(LAYOUTS)).sort()) {
      if (!f.endsWith(".json") || !/^[a-z0-9][a-z0-9_-]{0,60}\.json$/.test(f)) continue;
      try { const j = JSON.parse(await readFile(path.join(LAYOUTS, f), "utf8")); if (Array.isArray(j.cells)) out.push({ name: f.slice(0, -5), set: j.set, cells: j.cells.length }); } catch { /* not a layout */ }
    }
    return out;
  }

  async function slice(body: Record<string, unknown>) {
    const { set, layout, bg = "auto", merge = false } = body as { set: unknown; layout: unknown; bg?: unknown; merge?: unknown };
    if (!isSetName(set)) throw new HttpError(400, "bad set name");
    if (typeof layout !== "string" || !(await layouts()).some((l) => l.name === layout)) throw new HttpError(400, "unknown layout");
    if (bg !== "auto" && bg !== "none") throw new HttpError(400, "bg must be auto or none");
    if (typeof merge !== "boolean") throw new HttpError(400, "merge must be true or false");
    const sheet = pngFromB64("sheet", body.sheet);
    const setRel = [...PARTS_BASE, set].join("/");
    const setAbs = path.join(root, ...PARTS_BASE, set);
    if (!(await stat(setAbs).then((s) => s.isDirectory(), () => false))) await ensureDir(root, setRel);
    const setReal = await resolveWritable(root, setRel, "dir");
    const sheetRel = `${LAB_BASE.join("/")}/sheets/${stampName()}-${set}.png`;
    await atomicWrite(root, sheetRel, sheet);
    // the slicer writes straight into the folder: back up everything it may overwrite first
    const backup = new Backup(root);
    for (const f of await setFiles(setReal)) if (isPngName(f) || f === "manifest.json" || f === "slice-report.json") await backup.add(`${setRel}/${f}`);
    await backup.prune();
    const args = [SLICER, await resolveWritable(root, sheetRel), path.join(LAYOUTS, layout + ".json"), "--out", setReal, "--bg", bg];
    if (merge) args.push("--merge");
    const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, args, { cwd: REPO_DIR, timeout: 120_000, maxBuffer: 8 << 20, shell: false, env: { PATH: process.env.PATH || "" } }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
    log(`slice ${layout} -> ${set}: exit ${r.code}`);
    if (r.code !== 0) throw new HttpError(500, `slicer failed (exit ${r.code}): ${r.stderr.slice(0, 2000)}`);
    return { ...(await getSet(set)), backup: backup.dirRel, sheet: sheetRel, stdout: r.stdout.slice(-8000) };
  }

  // ---------------- static (read-only)
  async function serveFile(res: http.ServerResponse, baseDir: string, rel: string, req: http.IncomingMessage) {
    const base = await realpath(baseDir).catch(() => null);
    if (!base) throw new HttpError(404, "not found");
    const p = await resolveReadable(base, rel);
    if (!p) throw new HttpError(404, "not found");
    const st = await stat(p);
    if (!st.isFile()) throw new HttpError(404, "not found");
    const type = TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
    if (req.method === "HEAD") return send(res, 200, "", type);
    send(res, 200, await readFile(p), type);
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) {
    try {
      gate(req);
      const rawPath = (req.url || "/").split("?")[0];
      if (rawPath.startsWith("/api/")) {
        const segs = rawPath.slice(5).split("/").map((s) => { const d = decodeURIComponent(s); if (/[%/\\\0]/.test(d) || d === "." || d === "..") throw new HttpError(400, "bad path"); return d; });
        return await api(req, res, segs);
      }
      const mount = (prefix: string) => rawPath.startsWith(prefix) ? decodeURIComponent(rawPath.slice(prefix.length)) : null;
      let rel: string | null;
      if ((rel = mount("/rig/")) !== null) return await serveFile(res, path.join(root, "client", "public", "rig"), rel || "index.html", req);
      if ((rel = mount("/sprites/")) !== null) return await serveFile(res, path.join(root, "client", "public", "sprites"), rel, req);
      if ((rel = mount("/piskel/")) !== null) return await serveFile(res, PISKEL_DIST, rel || "index.html", req);
      if (rawPath === "/piskel") { res.writeHead(302, { Location: "/piskel/" }); return res.end(); }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(404, "not found");
      next();
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof URIError ? 400 : 500;
      if (status === 500) log("error: " + ((e as Error).stack || e));
      // an unread body (413, early refusals) must not be parsed as the next request on a kept-alive socket
      if (!req.complete) res.setHeader("Connection", "close");
      if (!res.headersSent) json(res, status, { error: (e as Error).message || String(e) });
      else res.end();
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res, () => {
      if (vite) vite.middlewares(req, res, () => json(res, 404, { error: "not found" }));
      else json(res, 404, { error: "not found (app not served in this mode)" });
    });
  });
  server.requestTimeout = 120_000;
  // Vite's HMR websocket shares this server: refuse upgrades from foreign hosts / origins before Vite sees them
  server.prependListener("upgrade", (req, socket) => {
    try { gate({ ...req, method: "GET", headers: req.headers } as http.IncomingMessage); } catch { socket.destroy(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(opts.port, "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;
  origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (opts.vite !== false) {
    const { createServer } = await import("vite");
    vite = await createServer({
      configFile: false, root: APP_DIR, appType: "spa", logLevel: "warn", clearScreen: false,
      cacheDir: path.join(CODE_DIR, ".vite-cache"),
      server: { middlewareMode: true, hmr: { server }, fs: { strict: true, allow: [APP_DIR, path.join(CODE_DIR, "shared"), ...GAME_READ_DIRS] } },
      // Area tab: the game's shared code and its tile-art tables (client/src/worldVisuals.ts, spriteRegistry.ts) are
      // imported read-only. @colony/shared/* -> this repo's shared/src (not the node_modules link); pixi.js -> a stub
      // (the art tables' files import pixi for textures the Lab never creates).
      resolve: { alias: [
        { find: /^@colony\/shared\/(.+)$/, replacement: path.join(REPO_DIR, "shared", "src") + "/$1.ts" },
        { find: /^pixi\.js$/, replacement: path.join(APP_DIR, "src", "area", "pixi-stub.ts") },
      ] },
    });
  }
  return {
    server, root, url: `http://127.0.0.1:${port}/`,
    async close() { await vite?.close(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); },
  };
}
