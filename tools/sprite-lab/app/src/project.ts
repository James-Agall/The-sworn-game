// The open part set: manifest + draw order (lab.json sidecar) + part pixels, with undo/redo, a dirty flag and Save.
// Shared by every tab (Parts edits it, Draw sends pixels into it, Compare reads it; the Rig tab will read it too).
import type { Manifest, PartEntry } from "../../shared/manifest.ts";
import { variantOf } from "../../shared/names.ts";
import { api, type SetData } from "./api.ts";
import { encodePNG, fetchPNG, toBase64, type RGBA } from "./png.ts";
import { History } from "./undo.ts";

type Snap = { manifest: string; order: string[]; images: Map<string, RGBA> };

export class Project {
  set = "";
  hash = "none";
  manifest: Manifest = { parts: {} };
  order: string[] = [];
  /** pixels by FILE name (aliases like upperArm / upperArm.cloth have their own files) */
  images = new Map<string, RGBA>();
  files: string[] = [];
  history = new History<Snap>();
  private saved: Snap = { manifest: "", order: [], images: new Map() };
  private listeners = new Set<(why: string) => void>();
  selected = "";

  on(fn: (why: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(why: string) { for (const f of this.listeners) f(why); }

  async load(set: string, data?: SetData): Promise<void> {
    const d = data || (await api.getSet(set));
    const manifest: Manifest = d.manifestText ? JSON.parse(d.manifestText) : { set, parts: {} };
    const images = new Map<string, RGBA>();
    await Promise.all(Object.values(manifest.parts).map(async (p) => {
      if (images.has(p.file) || !d.files.includes(p.file)) return;
      try { images.set(p.file, await fetchPNG(`/rig/parts/${encodeURIComponent(set)}/${encodeURIComponent(p.file)}?t=${Date.now()}`)); } catch { /* reported by the validators */ }
    }));
    this.set = set; this.hash = d.hash; this.manifest = manifest; this.images = images; this.files = d.files;
    const names = Object.keys(manifest.parts), saved = (d.sidecar?.order || []).filter((n) => n in manifest.parts);
    this.order = [...saved, ...names.filter((n) => !saved.includes(n))];
    if (!(this.selected in manifest.parts)) this.selected = this.order[0] || "";
    this.saved = this.snap();
    this.history.clear();
    this.emit("load");
  }

  private snap(): Snap { return { manifest: JSON.stringify(this.manifest), order: [...this.order], images: new Map(this.images) }; }
  private restore(s: Snap) { this.manifest = JSON.parse(s.manifest); this.order = [...s.order]; this.images = new Map(s.images); if (!(this.selected in this.manifest.parts)) this.selected = this.order[0] || ""; }

  get dirty(): boolean {
    const s = this.saved;
    if (s.manifest !== JSON.stringify(this.manifest) || s.order.join("\n") !== this.order.join("\n")) return true;
    for (const [f, img] of this.images) if (s.images.get(f) !== img && this.usedFiles().has(f)) return true;
    return false;
  }
  usedFiles() { return new Set(Object.values(this.manifest.parts).map((p) => p.file)); }

  /** Apply a change as one undo step. */
  edit(why: string, fn: () => void): void {
    const before = this.snap();
    fn();
    if (before.manifest === JSON.stringify(this.manifest) && before.order.join() === this.order.join() && [...this.images].every(([k, v]) => before.images.get(k) === v) && before.images.size === this.images.size) return;
    this.history.push(before);
    this.emit(why);
  }
  /** Start of a drag: record one undo step now, then call live() for every move without recording. */
  begin(): void { this.history.push(this.snap()); }
  live(why: string, fn: () => void): void { fn(); this.emit(why); }

  undo() { const s = this.history.undo(this.snap()); if (s) { this.restore(s); this.emit("undo"); } }
  redo() { const s = this.history.redo(this.snap()); if (s) { this.restore(s); this.emit("redo"); } }

  part(name = this.selected): PartEntry | undefined { return this.manifest.parts[name]; }
  image(name = this.selected): RGBA | undefined { const p = this.part(name); return p ? this.images.get(p.file) : undefined; }

  /** Replace a part's pixels; size follows the image, pivot is kept. */
  setImage(name: string, img: RGBA) {
    const p = this.manifest.parts[name];
    if (!p) return;
    this.images.set(p.file, img);
    p.size = [img.w, img.h];
  }
  addPart(name: string, img: RGBA, entry: Partial<PartEntry> = {}) {
    const file = name + ".png";
    this.manifest.parts[name] = { file, pivot: [img.w / 2, img.h], len: 0, joint: "", size: [img.w, img.h], scale: 1, variant: variantOf(name), ...entry };
    this.images.set(file, img);
    if (!this.order.includes(name)) this.order.push(name);
    this.selected = name;
  }
  renamePart(from: string, to: string) {
    const parts: Record<string, PartEntry> = {};
    for (const [k, v] of Object.entries(this.manifest.parts)) {
      if (k !== from) { parts[k] = v; continue; }
      const img = this.images.get(v.file);
      const file = v.file === from + ".png" ? to + ".png" : v.file;
      parts[to] = { ...v, file, variant: v.variant !== undefined && v.variant === variantOf(from) ? variantOf(to) : v.variant };
      if (img) this.images.set(file, img);
    }
    this.manifest.parts = parts;
    this.order = this.order.map((n) => (n === from ? to : n));
    if (this.selected === from) this.selected = to;
  }
  deletePart(name: string) {
    delete this.manifest.parts[name];
    this.order = this.order.filter((n) => n !== name);
    if (this.selected === name) this.selected = this.order[0] || "";
  }

  async save(): Promise<string | null> {
    const used = this.usedFiles(), files: Record<string, string> = {};
    for (const f of used) {
      const img = this.images.get(f);
      if (img && (this.saved.images.get(f) !== img || !this.files.includes(f))) files[f] = toBase64(await encodePNG(img));
    }
    const savedUsed = new Set(Object.values((JSON.parse(this.saved.manifest || '{"parts":{}}') as Manifest).parts).map((p) => p.file));
    const deleteFiles = [...savedUsed].filter((f) => !used.has(f) && this.files.includes(f));
    const r = await api.save(this.set, { baseHash: this.hash, manifest: this.manifest, sidecar: { order: this.order }, files, deleteFiles });
    this.hash = r.hash; this.files = r.files;
    this.manifest = JSON.parse(r.manifestText!);
    this.saved = this.snap();
    this.emit("saved");
    return r.backup;
  }
}

export const project = new Project();
