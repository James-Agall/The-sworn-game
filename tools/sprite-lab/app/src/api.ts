// Client for the Lab's local save server (server/lab.ts). Writes carry X-Lab: 1 and JSON; the browser adds Origin.
import type { HeroPalette } from "../../shared/recolour.ts";
import type { Report } from "../../shared/validators.ts";

export type SetInfo = { name: string; parts: number; hasManifest: boolean };
export type SetData = { set: string; manifestText: string | null; hash: string; sidecar: { order?: string[] } | null; files: string[] };
export type SaveResult = SetData & { backup: string | null; written: string[]; deleted: string[] };
export type Layout = { name: string; set?: string; cells: number };
/** Area tab: one template file (server/templates.ts Entry). */
export type TemplateEntry = {
  id: string; name: string; file: string; src: "builtin" | "user"; path: string; tier?: number; w: number; h: number;
  buildingType?: string; weight?: number; errors: string[]; shadowed?: boolean; template?: Record<string, unknown>;
};
export type TemplateRead = { kind: string; src: "builtin" | "user"; id: string; path: string; hash: string; template: Record<string, unknown>; errors: string[] };
export type TemplateSaved = { ok: true; kind: string; id: string; path: string; hash: string; backup: string | null };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/" + path, {
    method, cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Lab": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error || `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  info: () => call<{ root: string; sameRoot: boolean; writable: string[] }>("GET", "info"),
  sets: () => call<SetInfo[]>("GET", "sets"),
  createSet: (name: string, copyFrom?: string) => call<SetData>("POST", "sets", { name, copyFrom }),
  getSet: (set: string) => call<SetData>("GET", "sets/" + encodeURIComponent(set)),
  save: (set: string, body: { baseHash: string; manifest: unknown; sidecar?: unknown; files?: Record<string, string>; deleteFiles?: string[] }) =>
    call<SaveResult>("POST", `sets/${encodeURIComponent(set)}/save`, body),
  palettes: () => call<{ hero: HeroPalette | null; heroError: string | null; lab: string[] }>("GET", "palettes"),
  refs: () => call<string[]>("GET", "refs"),
  layouts: () => call<Layout[]>("GET", "layouts"),
  slice: (body: { set: string; layout: string; sheet: string; bg: "auto" | "none"; merge: boolean }) => call<SaveResult & { stdout: string; sheet: string }>("POST", "slice", body),
  validate: (set: string) => call<Report>("GET", "validate/" + encodeURIComponent(set)),
  clips: () => call<string[]>("GET", "clips"),
  getClip: (name: string) => call<Record<string, unknown>>("GET", "clips/" + encodeURIComponent(name)),
  putClip: (name: string, clip: unknown) => call<{ ok: true; backup: string | null }>("PUT", "clips/" + encodeURIComponent(name), clip),
  deleteClip: (name: string) => call<{ ok: true; backup: string | null }>("POST", `clips/${encodeURIComponent(name)}/delete`, {}),
  templates: (kind: string, full = false) => call<TemplateEntry[]>("GET", `templates/${kind}${full ? "?full=1" : ""}`),
  readTemplate: (kind: string, src: string, id: string) => call<TemplateRead>("GET", `templates/${kind}/${src}/${encodeURIComponent(id)}`),
  saveTemplate: (kind: string, template: unknown, overwrite: boolean, baseHash?: string | null) =>
    call<TemplateSaved>("POST", `templates/${kind}/save`, { template, overwrite, ...(baseHash ? { baseHash } : {}) }),
  deleteTemplate: (kind: string, id: string) => call<TemplateSaved>("POST", `templates/${kind}/delete`, { id }),
  stamp: (kind: string, template: unknown, transform: number, seed: number) => call<Record<string, any>>("POST", "stamp", { kind, template, transform, seed }),
  exportPng: (name: string, png: string) => call<{ ok: true; path: string; backup: string | null }>("POST", "exports", { name, png }),
};
