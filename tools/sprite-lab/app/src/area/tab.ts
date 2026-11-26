// Area tab: a full-screen editor for the game's ASCII-grid templates (bandit camps, building templates, settlements),
// the SAME JSON files the game loads and the in-game creative editors edit. Built-ins are read-only (open one, then
// "Duplicate to user"); saves go to server/data/<kind>/user/<id>.json through the Lab server, which validates them with
// the game's own validators again. Every rule (legend, validation, transforms, layout, stamping) is the game's shared
// code (shared/area.ts); this file is the UI.
import * as A from "../../../shared/area.ts";
import * as G from "../../../shared/grid.ts";
import type { AnyTemplate, BuildingTemplate, CampTemplate, Kind, SettlementTemplate } from "../../../shared/area.ts";
import { api, type TemplateEntry } from "../api.ts";
import { dataMeta, interiorIcon, poiForm, type FormCtx } from "./forms.ts";
import { ART as INTERIOR_ART, propArt, renderInteriorMap } from "./interior.ts";
import { diffHunks } from "../../../shared/textdiff.ts";
import { History } from "../undo.ts";
import { PixelView } from "../pixelview.ts";
import { ask, confirmBox, el, toast } from "../ui.ts";
import { coverage, drawable, setArtListener, setAvailable, tileArt, artPending } from "./art.ts";
import { cellSizeFor, renderBuildingThumb, renderStamp, renderTemplate, slotColor, viewFromPreview, type StampView } from "./render.ts";

type Tool = "pencil" | "line" | "rect" | "fill" | "pick" | "select" | "building";
type Src = "builtin" | "user" | "new";
// interiors: src "builtin" but WRITABLE (the game's own file; there is no user/ layer); `opened` = the file as read
type Doc = { kind: Kind; src: Src; origId: string | null; hash: string | null; t: AnyTemplate; path: string | null; opened?: string };
type Deps = { isActive: () => boolean; onState: () => void };

const TOOLS: [Tool, string, string][] = [
  ["pencil", "Pencil", "P"], ["line", "Line", "L"], ["rect", "Rectangle", "R"], ["fill", "Fill", "F"], ["pick", "Eyedropper", "I"],
  ["select", "Select", "S"], ["building", "Place building", "B"],
];
const DEFAULT_BRUSH: Record<Kind, string> = { camps: "#", buildings: "#", settlements: "_", sites: "#", "castle-ruins": "1", pois: ".", interiors: "#" };
const INTERIOR_BANNER = "This edits the game's built-in interiors (shared/src/data/interiors): client and server both read these files at build time; restart the server and rebuild the client; revert with git.";

export function mountArea(pane: HTMLElement, deps: Deps) {
  let kind: Kind = (localStorage.getItem("lab.area.kind") as Kind) || "camps";
  if (!A.KINDS.includes(kind)) kind = "camps";
  const entries = Object.fromEntries(A.KINDS.map((k) => [k, []])) as unknown as Record<Kind, TemplateEntry[]>;
  let buildings: BuildingTemplate[] = [];
  let lookup: A.BuildingLookup = () => undefined;
  let doc: Doc | null = null;
  // Unsaved = differs from the file as opened / last saved (a new / duplicated / imported draft always is).
  let savedSnap: string | null = null;
  const isDirty = () => !!doc && (doc.src === "new" || JSON.stringify(doc.t) !== savedSnap);
  const history = new History<string>();
  let tool: Tool = "pencil";
  let brush = DEFAULT_BRUSH[kind];
  let filled = false, mirrorH = false, mirrorV = false, showSymbols = false;
  let errors: string[] = [], warnings: string[] = [];
  // the errors whose cells are on the grid shown (an interior: this layout's validateInteriorTemplate messages)
  let cellErrors: string[] = [];
  let flash: { x: number; y: number; until: number } | null = null;
  let hover: { x: number; y: number } | null = null;
  let drag: { tool: Tool; x0: number; y0: number; x1: number; y1: number; erase: boolean; before: string; changed: boolean; last?: { x: number; y: number }; moveSel?: boolean; ref?: number; refX?: number; refY?: number } | null = null;
  let selection: G.Rect | null = null;
  let clipboard: string[] | null = null;
  let pasting = false;
  let pending: { ref: string; transform: number } | null = null;
  let selRef = -1;
  // stage B previews also use it: sites (the real stampSiteTemplate at `tier`), the castle ruin (shared code), interiors
  // (the game's buildInteriorMap at `level`), POI pools (world-gen's placePoiSite samples, `poi`)
  let preview: {
    tf: number; source: "shared-code" | "server-stamper"; real: StampView | null; seed: number; owned: boolean; running: boolean;
    tier?: number; level?: number; poi?: Record<string, any> | null;
  } | null = null;
  // the grid being edited ("rows"; a site's "tiers"; an interior's "v0".."vN" / "upper")
  let layer = "rows";

  // ---------------- DOM
  const kindBtns = A.KINDS.map((k) => el("button", { class: "kindbtn", "data-kind": k, text: A.KIND_LABEL[k], onclick: () => switchKind(k) }));
  const search = el("input", { type: "search", placeholder: "Search id / name", id: "area-search", oninput: () => renderList() });
  const tierSel = el("select", { id: "area-tier", onchange: () => renderList() }, el("option", { value: "", text: "All tiers" }), ...[1, 2, 3, 4].map((n) => el("option", { value: String(n), text: "Tier " + n })));
  const srcSel = el("select", { id: "area-src", onchange: () => renderList() }, el("option", { value: "", text: "Built-in + user" }), el("option", { value: "builtin", text: "Built-in" }), el("option", { value: "user", text: "User" }));
  const list = el("div", { class: "area-list", id: "area-list" });
  const left = el("aside", { class: "panel left area-left" },
    el("div", { class: "row tight kindrow" }, ...kindBtns),
    search, el("div", { class: "row tight" }, tierSel, srcSel), list,
    el("div", { class: "row wrap tight" },
      el("button", { text: "New", id: "area-new", title: "New template (the in-game editor's defaults)", onclick: () => newDoc() }),
      el("button", { text: "Duplicate", id: "area-dup", title: "Copy the open template to a new user id", onclick: () => duplicateDoc() }),
      el("button", { text: "Delete", id: "area-del", title: "Delete the open USER template (backed up)", onclick: () => deleteDoc() })),
    el("div", { class: "row wrap tight" },
      el("button", { text: "Import JSON", id: "area-import", onclick: () => importFile.click() }),
      el("button", { text: "Export JSON", id: "area-export", onclick: () => exportDoc() })));
  const importFile = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: () => importDoc() });
  left.append(importFile);

  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const [id, label, key] of TOOLS) toolBtns.set(id, el("button", { class: "toolbtn", "data-tool": id, text: label, title: `${label} (${key})`, onclick: () => setTool(id) }));
  const filledBox = el("input", { type: "checkbox", id: "area-filled", onchange: () => { filled = filledBox.checked; } });
  const mirHBox = el("input", { type: "checkbox", id: "area-mirror-h", onchange: () => { mirrorH = mirHBox.checked; view.render(); } });
  const mirVBox = el("input", { type: "checkbox", id: "area-mirror-v", onchange: () => { mirrorV = mirVBox.checked; view.render(); } });
  const symBox = el("input", { type: "checkbox", id: "area-symbols", onchange: () => { showSymbols = symBox.checked; view.render(); } });
  const zoomLbl = el("span", { class: "zoomlbl", text: "" });
  const previewBtn = el("button", { id: "area-preview", text: "Preview stamp", title: "Show what world-gen stamps (V)", onclick: () => togglePreview() });
  const editBar = el("div", { class: "toolbar area-toolbar" },
    ...toolBtns.values(),
    el("label", { class: "check", title: "Rectangles filled (Shift while dragging flips it)" }, filledBox, "filled"),
    el("span", { class: "sep" }),
    el("label", { class: "check", title: "Mirror painting left-right (M)" }, mirHBox, "mirror ↔"),
    el("label", { class: "check", title: "Mirror painting top-bottom (Shift+M)" }, mirVBox, "↕"),
    el("span", { class: "sep" }),
    el("button", { text: "⟳", title: "Rotate 90° clockwise (selection, else the whole template: the game's transformRows)", id: "area-rot", onclick: () => transformDoc(1) }),
    el("button", { text: "⟲", title: "Rotate 90° counter-clockwise", onclick: () => transformDoc(3) }),
    el("button", { text: "⇋", title: "Mirror left-right", id: "area-flip", onclick: () => transformDoc(4) }),
    el("button", { text: "⇵", title: "Flip top-bottom", onclick: () => transformDoc(6) }),
    el("button", { text: "Resize…", id: "area-resize", onclick: () => resizeDoc() }),
    el("button", { text: "Clear", onclick: () => clearDoc() }),
    el("span", { class: "sep" }),
    el("button", { text: "−", title: "Zoom out (-)", onclick: () => view.zoomAt(view.zoom - Math.max(1, Math.round(view.zoom * 0.2))) }), zoomLbl,
    el("button", { text: "+", title: "Zoom in (+)", onclick: () => view.zoomAt(view.zoom + Math.max(1, Math.round(view.zoom * 0.2))) }),
    el("button", { text: "Fit", title: "Fit (0)", onclick: () => view.fit() }),
    el("label", { class: "check", title: "Show the ASCII symbol on each cell" }, symBox, "symbols"),
    el("span", { class: "grow" }), previewBtn);
  const previewBar = el("div", { class: "toolbar area-previewbar", hidden: true });
  const layerBar = el("div", { class: "toolbar area-layerbar", id: "area-layers", hidden: true });
  const banner = el("div", { class: "area-banner", id: "area-banner", hidden: true });
  // stage B: the red interiors banner (always on for interiors) and the amber "not used by world-gen yet" note
  const dataBanner = el("div", { class: "area-databanner", id: "area-databanner", hidden: true });
  const canvasBox = el("div", { class: "area-canvas", id: "area-canvas" });
  const formBox = el("div", { class: "area-formbox", id: "area-formbox", hidden: true });
  const valList = el("div", { class: "area-val", id: "area-val" });
  const status = el("div", { class: "area-status", id: "area-status" });
  const statsLine = el("div", { class: "area-stats", id: "area-stats" });
  const center = el("section", { class: "center" }, editBar, previewBar, layerBar, dataBanner, banner, canvasBox, formBox,
    el("div", { class: "area-bottom" }, valList, el("div", { class: "area-side" }, statsLine, status)));

  const palette = el("div", { class: "area-palette", id: "area-palette" });
  const paletteNote = el("p", { class: "hint", id: "area-art-note" });
  const libSearch = el("input", { type: "search", placeholder: "Search buildings", oninput: () => renderLibrary() });
  const library = el("div", { class: "area-library", id: "area-library" });
  const libTools = el("div", { class: "row wrap tight" },
    el("button", { text: "Rotate (R)", id: "area-ref-rot", onclick: () => turnRef(1) }),
    el("button", { text: "Mirror (M)", id: "area-ref-mir", onclick: () => turnRef(4) }),
    el("button", { text: "Remove (Del)", id: "area-ref-del", onclick: () => removeRef() }),
    el("button", { text: "Edit template", title: "Open this building template in the Buildings editor", onclick: () => editRefTemplate() }));
  const refInfo = el("p", { class: "hint", id: "area-ref-info" });
  const libSection = el("section", { class: "area-sec", hidden: true }, el("h4", { text: "Building library" }), libSearch, libTools, refInfo, library);
  const meta = el("div", { class: "area-meta", id: "area-meta" });
  const savePath = el("p", { class: "hint", id: "area-path" });
  const saveBtn = el("button", { class: "primary", id: "area-save", text: "Save to user/", onclick: () => save() });
  const diffBtn = el("button", { id: "area-diff", text: "Show diff vs git HEAD", hidden: true, onclick: () => showDiff() });
  const paletteSec = el("section", { class: "area-sec" }, el("h4", { text: "Palette (left paint, right erase)" }));
  const right = el("aside", { class: "panel right area-right" },
    paletteSec,
    libSection,
    el("section", { class: "area-sec" }, el("h4", { text: "Template" }), meta),
    el("section", { class: "area-sec" }, el("h4", { text: "Save" }), savePath, el("div", { class: "row wrap" }, saveBtn, diffBtn)));
  paletteSec.append(palette, paletteNote);
  pane.append(el("div", { class: "area-tab" }, left, center, right));

  const view = new PixelView(canvasBox);
  view.minZoom = 3; view.maxZoom = 72; view.zoom = 24; view.smooth = true; view.cursor = "crosshair"; view.background = "#101215";
  view.onZoom = (z) => { zoomLbl.textContent = z + "px"; };
  view.onHover = (x, y) => {
    const c = { x: Math.floor(x), y: Math.floor(y) };
    if (!hover || hover.x !== c.x || hover.y !== c.y) { hover = c; updateStatus(); view.render(); }
  };
  canvasBox.addEventListener("pointerleave", () => { hover = null; updateStatus(); view.render(); });
  canvasBox.addEventListener("dragover", (e) => { if (doc?.kind === "settlements") { e.preventDefault(); const r = view.canvas.getBoundingClientRect(); const p = view.toImage({ offsetX: e.clientX - r.left, offsetY: e.clientY - r.top }); hover = { x: Math.floor(p.x), y: Math.floor(p.y) }; view.render(); } });
  canvasBox.addEventListener("drop", (e) => {
    const ref = e.dataTransfer?.getData("text/x-sworn-building");
    if (!ref || !doc || doc.kind !== "settlements") return;
    e.preventDefault();
    const r = view.canvas.getBoundingClientRect(), p = view.toImage({ offsetX: e.clientX - r.left, offsetY: e.clientY - r.top });
    pending = { ref, transform: pending?.ref === ref ? pending.transform : 0 };
    setTool("building");
    placeRef(Math.floor(p.x), Math.floor(p.y));
  });

  // ---------------- data
  const t = () => doc!.t;
  const rows = () => A.gridOf(doc!.kind, doc!.t, layer);
  const legend = () => A.legendFor(doc!.kind, doc!.t, layer);
  const snapshot = () => JSON.stringify(doc!.t);
  // interiors are the game's built-in files and are edited in place (the red banner); other built-ins are read-only
  const readOnly = () => doc?.src === "builtin" && doc.kind !== "interiors";
  const isGrid = () => !!doc && doc.kind !== "pois";
  /** `next` as the current grid; a site's tile edits keep its tier grid in step (a new cell joins at tier 1, "." clears). */
  function withRows(next: string[]): AnyTemplate {
    const d = doc!;
    let nt = A.withGrid(d.kind, d.t, layer, next);
    if (d.kind === "sites" && layer === "rows") {
      const tiers = A.gridOf("sites", d.t, "tiers");
      if (tiers.length === next.length && tiers.every((r, y) => r.length === next[y].length)) {
        const nt2 = tiers.map((r, y) => [...r].map((c, x) => (next[y][x] === "." ? "." : c === "." ? "1" : c)).join(""));
        nt = A.withGrid("sites", nt, "tiers", nt2);
      }
    }
    return nt;
  }
  /** Apply `fn` to every grid linked with the current one (a site's tiles + tiers turn / resize / clear together). */
  function mapLinked(fn: (g: string[], l: string) => string[]): AnyTemplate {
    let nt = doc!.t;
    for (const l of A.linkedLayers(doc!.kind, layer)) nt = A.withGrid(doc!.kind, nt, l, fn(A.gridOf(doc!.kind, nt, l), l));
    return nt;
  }

  async function loadLists(k?: Kind) {
    for (const kk of k ? [k] : A.KINDS) {
      if (kk !== "interiors") { entries[kk] = await api.templates(kk, kk === "buildings"); continue; }
      entries.interiors = (await api.interiors()).map((e) => ({ id: e.id, name: e.id[0].toUpperCase() + e.id.slice(1), file: e.id + ".json", src: "builtin" as const, path: e.path, w: 0, h: 0, errors: e.errors, variants: e.variants, upper: e.upper }) as TemplateEntry);
    }
    // the game store's rules: built-ins, then valid user templates that do not shadow one
    const bi = entries.buildings.filter((e) => e.src === "builtin" && e.template).map((e) => e.template as unknown as BuildingTemplate);
    const us = entries.buildings.filter((e) => e.src === "user" && e.template && !e.shadowed).map((e) => e.template as unknown as BuildingTemplate);
    lookup = A.makeLookup(bi, us);
    buildings = [...bi, ...us].filter((b) => lookup(b.id) === b);
  }

  function renderList() {
    const q = search.value.trim().toLowerCase(), tier = tierSel.value, src = srcSel.value;
    list.replaceChildren();
    const shown = entries[kind].filter((e) => (!q || e.id.includes(q) || e.name.toLowerCase().includes(q)) && (!tier || String(e.tier) === tier) && (!src || e.src === src));
    for (const e of shown) {
      const on = doc && doc.src !== "new" && doc.src === e.src && doc.origId === e.file.slice(0, -5);
      list.append(el("button", { class: "area-item" + (on ? " on" : ""), "data-id": e.id, "data-src": e.src, title: e.path, onclick: () => openEntry(e) },
        el("span", { class: "nm", text: e.name }),
        el("span", { class: "meta" },
          el("span", { class: "badge " + e.src, text: e.src === "builtin" ? "built-in" : "user" }),
          e.tier ? el("span", { class: "badge", text: "T" + e.tier }) : null,
          e.buildingType ? el("span", { class: "badge", text: e.buildingType }) : null,
          kind === "interiors" ? el("span", { class: "badge", text: `${(e as { variants?: number }).variants ?? "?"} variants${(e as { upper?: boolean }).upper ? " + up" : ""}` }) : null,
          kind === "interiors" ? el("span", { class: "badge bad", text: "edits the game", title: "the built-in file is written directly (no user/ layer)" }) : null,
          e.src === "user" && (kind === "sites" || kind === "pois" || kind === "castle-ruins") ? el("span", { class: "badge warn", text: "not in world-gen", title: A.WORLDGEN_NOTE[kind] }) : null,
          e.w ? el("span", { class: "dim", text: `${e.w}x${e.h}` }) : null,
          e.errors.length ? el("span", { class: "badge bad", text: "invalid", title: e.errors[0] }) : null,
          e.shadowed ? el("span", { class: "badge bad", text: "shadowed", title: "a built-in has this id: the game skips this user file" }) : null),
        el("span", { class: "id", text: e.id })));
    }
    if (!shown.length) list.append(el("p", { class: "hint", text: "No templates match." }));
    for (const b of kindBtns) b.classList.toggle("on", b.dataset.kind === kind);
  }

  // ---------------- documents
  async function guardDirty(): Promise<boolean> {
    if (!isDirty() || !doc) return true;
    return confirmBox(`Discard unsaved changes to "${doc.t.id}"?`, "Discard");
  }
  function setDoc(d: Doc | null, keepHistory = false) {
    doc = d;
    savedSnap = d && d.src !== "new" ? JSON.stringify(d.t) : null;
    if (d && d.kind === "interiors" && d.src !== "new") d.opened ??= JSON.stringify(d.t);
    if (!keepHistory) history.clear();
    selection = null; pasting = false; selRef = -1; pending = null; flash = null;
    if (preview) { preview = null; previewBar.hidden = true; }
    if (d && !A.layersOf(d.kind, d.t).includes(layer)) layer = A.layersOf(d.kind, d.t)[0] ?? "rows";
    if (d && !(brush in A.legendFor(d.kind, d.t, layer))) brush = DEFAULT_BRUSH[d.kind];
    layoutPanels();
    renderPalette(); renderMeta(); renderLibrary(); renderList(); renderLayerBar(); invalidate(true); validateSoon(0); updateBanner(); deps.onState();
  }
  /** Which panels a kind shows: POI pools are a form (no grid); the rest the grid editor. */
  function layoutPanels() {
    const form = doc?.kind === "pois";
    editBar.hidden = form || !!preview;
    canvasBox.hidden = form;
    formBox.hidden = !form;
    paletteSec.hidden = form;
    diffBtn.hidden = doc?.kind !== "interiors";
    previewBtn.hidden = form;
    toolBtns.get("building")!.hidden = doc?.kind !== "settlements";
  }
  async function openEntry(e: TemplateEntry) {
    if (!(await guardDirty())) return;
    try {
      if (kind === "interiors") {
        const r = await api.readInterior(e.id);
        layer = "v0";
        setDoc({ kind, src: "builtin", origId: e.id, hash: r.hash, t: r.file as unknown as AnyTemplate, path: r.path });
        return;
      }
      const r = await api.readTemplate(kind, e.src, e.file.slice(0, -5));
      if (doc?.kind !== kind || A.isDataKind(kind)) layer = A.layersOf(kind, r.template as unknown as AnyTemplate)[0] ?? "rows";
      setDoc({ kind, src: e.src, origId: e.file.slice(0, -5), hash: r.hash, t: r.template as unknown as AnyTemplate, path: r.path });
    } catch (err) { toast("Open failed: " + (err as Error).message, "err"); }
  }
  async function switchKind(k: Kind) {
    if (k === kind && doc?.kind === k) return;
    if (!(await guardDirty())) return;
    kind = k;
    localStorage.setItem("lab.area.kind", k);
    brush = DEFAULT_BRUSH[k];
    if (tool === "building" && k !== "settlements") setTool("pencil");
    setDoc(null);
    renderList();
    const first = entries[k][0];
    if (first) await openEntry(first);
  }
  const uniqueId = (base: string) => {
    const taken = new Set(entries[kind].map((e) => e.id));
    let id = base.slice(0, 48), n = 2;
    while (taken.has(id)) id = `${base.slice(0, 44)}-${n++}`;
    return id;
  };
  async function newDoc() {
    if (kind === "interiors") { toast("Interiors are the nine building files: open one and edit it (a new building type needs game code)", "info", 4500); return; }
    if (!(await guardDirty())) return;
    const nt = A.newTemplate(kind);
    nt.id = uniqueId(nt.id);
    setDoc({ kind, src: "new", origId: null, hash: null, t: nt, path: null });
    deps.onState();
  }
  /** Copy the open template (a built-in or user one) to a new user id: a local draft until Save. */
  async function duplicateDoc(): Promise<boolean> {
    if (!doc) return false;
    if (doc.kind === "interiors") { toast("Interiors have no user layer: edit the built-in file directly (see the red banner)", "info", 4500); return false; }
    const base = doc.t.id.replace(/-copy(-\d+)?$/, ""), named = !A.isDataKind(doc.kind);
    const v = await ask(doc.src === "builtin" ? `"${doc.t.id}" is a built-in (read-only). Duplicate it to a user template:` : `Duplicate "${doc.t.id}"`, [
      { key: "id", label: "New id", value: uniqueId(base + "-copy"), hint: "a-z 0-9 - _ (max 48); the file will be server/data/" + kind + "/user/<id>.json" },
      ...(named ? [{ key: "name", label: "Name", value: (A.nameOf(doc.t) + " (copy)").slice(0, 40) }] : []),
    ], "Duplicate");
    if (!v) return false;
    const id = String(v.id).trim(), name = named ? String(v.name).trim() : "";
    if (!A.ID_RE.test(id)) { toast("Bad id: 1-48 of a-z 0-9 - _ (starting with a letter / digit)", "err"); return false; }
    if (entries[kind].some((e) => e.id === id)) { toast(`"${id}" exists already (${entries[kind].find((e) => e.id === id)!.src}); pick another id`, "err"); return false; }
    const copy = { ...JSON.parse(JSON.stringify(doc.t)), id, ...(named ? { name: name || A.nameOf(doc.t) } : {}) } as AnyTemplate;
    delete (copy as { builtin?: boolean }).builtin;
    setDoc({ kind, src: "new", origId: null, hash: null, t: copy, path: null });
    deps.onState(); validateSoon(0);
    toast(`Editing the copy "${id}" (not saved yet)`, "info");
    return true;
  }
  async function deleteDoc() {
    if (!doc || doc.src !== "user") { toast(doc?.kind === "interiors" ? "Interior files can't be deleted (revert edits with git)" : "Only user templates can be deleted", "err"); return; }
    if (!(await confirmBox(`Delete ${doc.path}? (a backup is kept under art-sources/lab/backups/)`, "Delete"))) return;
    try {
      const r = await api.deleteTemplate(kind, doc.origId!);
      toast(`Deleted ${r.path}${r.backup ? "; backup in " + r.backup : ""}`, "ok");
      await loadLists(kind);
      setDoc(null);
    } catch (e) { toast("Delete failed: " + (e as Error).message, "err"); }
  }
  async function importDoc() {
    const f = importFile.files?.[0];
    importFile.value = "";
    if (!f || !(await guardDirty())) return;
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(await f.text()); } catch { toast("Not JSON: " + f.name, "err"); return; }
    if (!raw || typeof raw !== "object") { toast("Not a template", "err"); return; }
    const k: Kind = Array.isArray(raw.buildings) ? "settlements" : typeof raw.buildingType === "string" ? "buildings" : Array.isArray(raw.guards) ? "camps"
      : Array.isArray(raw.tiers) ? "sites" : typeof raw.boss === "string" ? "castle-ruins" : Array.isArray(raw.centerpieces) ? "pois" : Array.isArray(raw.variants) ? "interiors" : kind;
    if (k !== "pois" && k !== "interiors" && !Array.isArray(raw.rows)) { toast("Not a template (no rows)", "err"); return; }
    if (k === "interiors") {
      // an interior file replaces the open building's content (same id): a draft over the built-in until Save
      const e = entries.interiors.find((x) => x.id === raw.id);
      if (!e) { toast("Not one of the nine building interior files (id: " + String(raw.id) + ")", "err"); return; }
      kind = k; localStorage.setItem("lab.area.kind", k);
      const r = await api.readInterior(e.id);
      layer = "v0";
      setDoc({ kind: k, src: "builtin", origId: e.id, hash: r.hash, t: r.file as unknown as AnyTemplate, path: r.path, opened: JSON.stringify(r.file) });
      commit(raw as unknown as AnyTemplate, snapshot());
      renderMeta(); renderLayerBar(); renderPalette();
      toast(`Imported ${f.name} over ${r.path}; not saved yet`, "info");
      return;
    }
    if (k !== kind) { kind = k; localStorage.setItem("lab.area.kind", k); }
    delete raw.builtin;
    const t0 = raw as unknown as AnyTemplate;
    if (typeof t0.id !== "string" || entries[k].some((e) => e.id === t0.id)) t0.id = uniqueId(typeof t0.id === "string" && A.ID_RE.test(t0.id) ? t0.id + "-import" : "imported");
    setDoc({ kind: k, src: "new", origId: null, hash: null, t: t0, path: null });
    deps.onState();
    toast(`Imported ${f.name} as "${t0.id}" (${A.KIND_LABEL[k]}); not saved yet`, "info");
  }
  function exportDoc() {
    if (!doc) return;
    const text = A.formatTemplate(A.normalise(doc.kind, doc.t));
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: doc.t.id + ".json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------- editing
  function commit(next: AnyTemplate, before: string) {
    history.push(before);
    doc!.t = next;
    invalidate(); validateSoon(); deps.onState();
  }
  function setRowsLive(next: string[]) {
    if (!drag) return;
    if (next.join("\n") === rows().join("\n")) return;
    if (!drag.changed) { history.push(drag.before); drag.changed = true; }
    doc!.t = withRows(next);
    invalidate(); validateSoon(); deps.onState();
  }
  /** Paint `cells` (mirrored) with `ch`; a single-instance symbol (camp hearth H, settlement keep K) moves instead. */
  function paintRows(base: string[], cells: G.Cell[], ch: string): string[] {
    const w = G.gridW(base), h = base.length;
    const uniq = A.uniqueSymbol(doc!.kind, layer);
    if (uniq && ch === uniq) {
      const c = cells[cells.length - 1];
      const r = G.placeUnique(base, ch, c.x, c.y);
      if (r.moved.length) toast(`${ch} moved to ${c.x},${c.y} (there is exactly one)`, "info", 1800);
      if (doc!.kind === "castle-ruins" && (c.x !== w >> 1 || c.y !== h >> 1)) toast(`The boss "B" must be at the centre (${w >> 1},${h >> 1})`, "err", 2500);
      if (doc!.kind === "settlements" && (t() as SettlementTemplate).buildings.some((b) => lookup(b.ref)?.buildingType === "keep")) toast("This settlement has a keep building: its anchor is the keep, a ground K makes two", "err");
      return r.rows;
    }
    // painting over / erasing the only hearth or keep is allowed: the validator then says so
    return G.paint(base, G.mirrorCells(cells, w, h, mirrorH, mirrorV), ch);
  }
  const inBounds = (x: number, y: number) => doc && G.inGrid(rows(), x, y);

  view.tool = {
    down(x, y, e) {
      if (!doc || !isGrid()) return false;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (preview) return false;
      if (readOnly()) { void duplicateDoc(); return true; }
      const erase = e.button === 2;
      const before = snapshot();
      if (tool === "building" && doc.kind === "settlements") {
        const st = t() as SettlementTemplate;
        const at = refAt(cx, cy);
        if (erase) { if (at >= 0) { selRef = at; removeRef(); } return true; }
        if (pending && at < 0) { placeRef(cx, cy); return true; }
        selRef = at; pending = at >= 0 ? null : pending;
        renderLibrary();
        if (at >= 0) drag = { tool, x0: cx, y0: cy, x1: cx, y1: cy, erase, before, changed: false, ref: at, refX: st.buildings[at].x, refY: st.buildings[at].y };
        view.render();
        return true;
      }
      if (pasting && clipboard) {
        const nt = withRows(G.pasteBlock(rows(), clipboard, cx, cy));
        commit(nt, before);
        selection = { x: cx, y: cy, w: G.gridW(clipboard), h: clipboard.length };
        pasting = false;
        return true;
      }
      if (!inBounds(cx, cy)) return tool === "select";
      drag = { tool, x0: cx, y0: cy, x1: cx, y1: cy, erase, before, changed: false, last: { x: cx, y: cy } };
      const ch = erase ? A.BLANK : brush;
      if (tool === "pencil") setRowsLive(paintRows(rows(), [{ x: cx, y: cy }], ch));
      else if (tool === "fill") {
        const mir = G.mirrorCells([{ x: cx, y: cy }], G.gridW(rows()), rows().length, mirrorH, mirrorV);
        let r = rows();
        for (const c of mir) r = G.floodFill(r, c.x, c.y, ch);
        setRowsLive(r); drag = null;
      } else if (tool === "pick") {
        const s = rows()[cy][cx];
        if (s in legend()) { brush = s; renderPalette(); }
        drag = null;
      } else if (tool === "select") {
        if (selection && cx >= selection.x && cy >= selection.y && cx < selection.x + selection.w && cy < selection.y + selection.h && !erase) drag.moveSel = true;
        else selection = null;
      }
      view.render();
      return true;
    },
    move(x, y, e) {
      if (!drag || !doc) return;
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cx === drag.x1 && cy === drag.y1) return;
      drag.x1 = cx; drag.y1 = cy;
      if (drag.tool === "pencil") {
        const cells = G.lineCells(drag.last!.x, drag.last!.y, cx, cy);
        drag.last = { x: cx, y: cy };
        if (A.uniqueSymbol(doc.kind, layer) === brush && !drag.erase) setRowsLive(paintRows(rows(), [{ x: cx, y: cy }], brush));
        else setRowsLive(paintRows(rows(), cells, drag.erase ? A.BLANK : brush));
      } else if (drag.tool === "building" && drag.ref !== undefined && drag.ref >= 0) {
        const st = t() as SettlementTemplate;
        const b = st.buildings[drag.ref], nx = drag.refX! + cx - drag.x0, ny = drag.refY! + cy - drag.y0;
        if (b.x !== nx || b.y !== ny) {
          if (!drag.changed) { history.push(drag.before); drag.changed = true; }
          const bs = st.buildings.slice(); bs[drag.ref] = { ...b, x: nx, y: ny };
          doc.t = { ...st, buildings: bs }; invalidate(); validateSoon(); deps.onState();
        }
      }
      void e;
      view.render();
    },
    up(_x, _y, e) {
      if (!drag || !doc) { drag = null; return; }
      const d = drag;
      drag = null;
      if (d.tool === "line" || d.tool === "rect") {
        const cells = d.tool === "line" ? G.lineCells(d.x0, d.y0, d.x1, d.y1) : G.rectCells(d.x0, d.y0, d.x1, d.y1, filled !== e.shiftKey);
        const next = paintRows(rows(), cells, d.erase ? A.BLANK : brush);
        if (next.join("\n") !== rows().join("\n")) commit(withRows(next), d.before);
      } else if (d.tool === "select") {
        if (d.moveSel && selection) {
          const dx = d.x1 - d.x0, dy = d.y1 - d.y0;
          if (dx || dy) { commit(withRows(G.moveRect(rows(), selection, dx, dy, A.BLANK)), d.before); selection = { ...selection, x: selection.x + dx, y: selection.y + dy }; }
        } else {
          const r = G.normRect(d.x0, d.y0, Math.max(0, Math.min(G.gridW(rows()) - 1, d.x1)), Math.max(0, Math.min(rows().length - 1, d.y1)));
          selection = r.w * r.h > 1 || d.x0 === d.x1 ? r : null;
        }
      }
      view.render();
    },
  };

  function setTool(tl: Tool) {
    if (tl === "building" && doc?.kind !== "settlements") { toast("Place building: settlements only", "info"); return; }
    tool = tl;
    if (tl !== "building") { pending = null; selRef = -1; }
    if (tl !== "select") pasting = false;
    for (const [id, b] of toolBtns) b.classList.toggle("on", id === tool);
    renderLibrary(); view.render();
  }

  /** Whole-template rotate / mirror (the game's transformRows / transformSettlement), or the selection only. */
  function transformDoc(tf: number) {
    if (!doc) return;
    if (readOnly()) { void duplicateDoc(); return; }
    const before = snapshot();
    if (selection) {
      const block = A.transformRows(G.extract(rows(), selection), tf);
      const cleared = G.fillRect(rows(), selection, A.BLANK);
      commit(withRows(G.pasteBlock(cleared, block, selection.x, selection.y)), before);
      selection = { x: selection.x, y: selection.y, w: G.gridW(block), h: block.length };
      return;
    }
    if (doc.kind === "settlements") { commit(A.transformSettlement(t() as SettlementTemplate, tf, lookup), before); invalidate(true); return; }
    // stage B grids: the game's transformRows on the grid (a site's tiles and tiers together)
    if (A.isDataKind(doc.kind)) { commit(mapLinked((g) => A.transformRows(g, tf)), before); invalidate(true); return; }
    if (doc.kind === "camps") { const c = t() as CampTemplate; commit({ ...c, rows: A.transformRows(c.rows, tf), entrance: A.transformEntrance(c.entrance, tf) }, before); }
    else { const b = t() as BuildingTemplate; commit({ ...b, rows: A.transformRows(b.rows, tf), doorSide: A.transformEntrance(b.doorSide, tf) }, before); }
    invalidate(true); renderMeta();
  }
  async function resizeDoc() {
    if (!doc) return;
    if (readOnly()) { void duplicateDoc(); return; }
    const [lo, hi] = A.sizeLimits(doc.kind);
    const anchors: [string, string][] = [["0,0", "top-left"], ["1,0", "top"], ["2,0", "top-right"], ["0,1", "left"], ["1,1", "centre"], ["2,1", "right"], ["0,2", "bottom-left"], ["1,2", "bottom"], ["2,2", "bottom-right"]];
    const v = await ask(`Resize (${lo}-${hi} each way; new cells are open ground)`, [
      { key: "w", label: "Width", type: "number", value: G.gridW(rows()) },
      { key: "h", label: "Height", type: "number", value: rows().length },
      { key: "anchor", label: "Keep content at", type: "select", value: "1,1", options: anchors },
    ], "Resize");
    if (!v) return;
    const w = Math.round(v.w), h = Math.round(v.h);
    if (!(w >= 1 && h >= 1 && w <= 200 && h <= 200)) { toast("Size 1-200", "err"); return; }
    const [ax, ay] = String(v.anchor).split(",").map(Number) as [0 | 1 | 2, 0 | 1 | 2];
    const r = G.resize(rows(), w, h, { ax, ay });
    const before = snapshot();
    const next = A.isDataKind(doc.kind) ? mapLinked((g) => G.resize(g, w, h, { ax, ay }).rows) : ({ ...t(), rows: r.rows } as AnyTemplate);
    if (doc.kind === "settlements") (next as SettlementTemplate).buildings = (t() as SettlementTemplate).buildings.map((b) => ({ ...b, x: b.x + r.dx, y: b.y + r.dy }));
    commit(next, before);
    selection = null;
    invalidate(true);
    if (w < lo || h < lo || w > hi || h > hi) toast(`Outside the game's ${lo}-${hi} limit: the validator will refuse it`, "err");
  }
  async function clearDoc() {
    if (!doc) return;
    if (readOnly()) { void duplicateDoc(); return; }
    if (!(await confirmBox("Clear the whole grid" + (doc.kind === "settlements" ? " and remove every building" : "") + "?", "Clear"))) return;
    const w = G.gridW(rows()), h = rows().length, before = snapshot();
    if (doc.kind === "interiors") {
      // an empty room: the wall outline, floor inside and the exit mat (upstairs: the stairs down)
      let r = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? "#" : ".")).join(""));
      r = layer === "upper" ? G.paint(r, [{ x: w >> 1, y: h - 2 }], "D") : G.paint(r, [{ x: w >> 1, y: h - 1 }], "E");
      commit(A.withGrid("interiors", t(), layer, r), before);
      return;
    }
    let r = G.blankRows(w, h);
    const u = A.uniqueSymbol(doc.kind, "rows");
    if (u) r = G.paint(r, [{ x: w >> 1, y: h >> 1 }], u);
    if (A.isDataKind(doc.kind)) {
      // a site keeps its keep at tier 1
      commit(mapLinked((_g, l) => (l === "tiers" ? G.paint(G.blankRows(w, h), [{ x: w >> 1, y: h >> 1 }], "1") : r)), before);
      return;
    }
    commit({ ...t(), rows: r, ...(doc.kind === "settlements" ? { buildings: [] } : {}) } as AnyTemplate, before);
  }
  function undo() { if (!doc) return; const s = history.undo(snapshot()); if (s !== null) { doc.t = JSON.parse(s); afterRestore(); } }
  function redo() { if (!doc) return; const s = history.redo(snapshot()); if (s !== null) { doc.t = JSON.parse(s); afterRestore(); } }
  function afterRestore() {
    selection = null; selRef = -1;
    if (doc && !A.layersOf(doc.kind, doc.t).includes(layer)) layer = A.layersOf(doc.kind, doc.t)[0] ?? "rows";
    invalidate(true); renderMeta(); renderLibrary(); renderLayerBar(); renderPalette(); validateSoon(0); deps.onState();
  }

  // ---------------- settlement buildings
  function refAt(x: number, y: number): number {
    if (doc?.kind !== "settlements") return -1;
    const st = t() as SettlementTemplate;
    for (let i = st.buildings.length - 1; i >= 0; i--) {
      const b = st.buildings[i], bt = lookup(b.ref);
      const fp = bt ? A.refFootprint(bt, b.transform ?? 0, !!st.spriteBuildings) : { w: 1, h: 1 };
      if (x >= b.x && y >= b.y && x < b.x + fp.w && y < b.y + fp.h) return i;
    }
    return -1;
  }
  function pendingFootprint(cx: number, cy: number) {
    if (!pending) return null;
    const bt = lookup(pending.ref);
    if (!bt) return null;
    const fp = A.refFootprint(bt, pending.transform, !!(t() as SettlementTemplate).spriteBuildings);
    return { x: cx - (fp.w >> 1), y: cy - (fp.h >> 1), w: fp.w, h: fp.h };
  }
  function placeRef(cx: number, cy: number) {
    if (!doc || doc.kind !== "settlements" || !pending) return;
    if (readOnly()) { void duplicateDoc(); return; }
    const fp = pendingFootprint(cx, cy);
    if (!fp) return;
    const st = t() as SettlementTemplate, before = snapshot();
    commit({ ...st, buildings: [...st.buildings, { ref: pending.ref, x: fp.x, y: fp.y, ...(pending.transform ? { transform: pending.transform } : {}) }] }, before);
    selRef = st.buildings.length;
    const pl = A.placements(t() as SettlementTemplate, lookup)[selRef];
    if (pl && !pl.ok) toast(`${pending.ref} collides (${pl.bad.length} cells): move it (drag) or remove it`, "err", 2500);
    renderLibrary();
  }
  function turnRef(tf: number) {
    if (!doc || doc.kind !== "settlements") return;
    const target = selRef >= 0 ? (t() as SettlementTemplate).buildings[selRef] : pending;
    if (!target) { toast("Pick a building in the library, or click a placed one", "info"); return; }
    const bt = lookup(target.ref);
    if (!bt) return;
    const next = A.composeTransforms(tf, target.transform ?? 0);
    if ((!bt.rotate && (next & 3)) || (!bt.mirror && (next & 4))) { toast(`${bt.id} may not be ${tf === 4 ? "mirrored" : "turned"} (its template's flags)`, "err"); return; }
    if (selRef >= 0) {
      if (readOnly()) { void duplicateDoc(); return; }
      const st = t() as SettlementTemplate, before = snapshot(), bs = st.buildings.slice();
      const { transform: _old, ...rest } = bs[selRef];
      bs[selRef] = { ...rest, ...(next ? { transform: next } : {}) };
      commit({ ...st, buildings: bs }, before);
    } else pending = { ref: pending!.ref, transform: next };
    renderLibrary(); view.render();
  }
  function removeRef() {
    if (!doc || doc.kind !== "settlements" || selRef < 0) return;
    if (readOnly()) { void duplicateDoc(); return; }
    const st = t() as SettlementTemplate, before = snapshot();
    commit({ ...st, buildings: st.buildings.filter((_, i) => i !== selRef) }, before);
    selRef = -1; renderLibrary();
  }
  async function editRefTemplate() {
    const ref = selRef >= 0 ? (t() as SettlementTemplate).buildings[selRef]?.ref : pending?.ref;
    const e = ref && entries.buildings.find((x) => x.id === ref);
    if (!e) { toast("Pick a building first", "info"); return; }
    if (!(await guardDirty())) return;
    setDoc(null);                                            // discarded above: no second question
    await switchKind("buildings");
    await openEntry(e);
  }
  const thumbs = new Map<string, HTMLCanvasElement>();
  function thumb(bt: BuildingTemplate, tf: number, sprite: boolean): HTMLCanvasElement {
    const key = `${bt.id}/${tf}/${sprite}`;
    let c = thumbs.get(key);
    if (!c) {
      if (sprite) {
        const cells = A.spriteBuildingCells(bt).cells[0], spec = tileArt(cells.tile), src = spec && drawable(spec);
        c = el("canvas", { width: 48, height: 48 }) as HTMLCanvasElement;
        const g = c.getContext("2d")!; g.fillStyle = "#4d6338"; g.fillRect(0, 0, 48, 48);
        if (src) g.drawImage(src, 0, 0, 48, 48);
        if (!src) return c;                      // not cached until the art has loaded
      } else c = renderBuildingThumb(bt, tf, 8);
      if (artPending() === 0) thumbs.set(key, c);
    }
    return c;
  }
  function renderLibrary() {
    const on = doc?.kind === "settlements";
    libSection.hidden = !on;
    if (!on) return;
    const st = t() as SettlementTemplate, q = libSearch.value.trim().toLowerCase();
    library.replaceChildren();
    for (const bt of buildings.filter((b) => !q || b.id.includes(q) || b.name.toLowerCase().includes(q) || b.buildingType.toLowerCase().includes(q))) {
      const sprite = !!st.spriteBuildings;
      const fp = A.refFootprint(bt, 0, sprite);
      const item = el("div", { class: "area-lib" + (pending?.ref === bt.id ? " on" : ""), draggable: "true", "data-ref": bt.id, title: `${bt.id}: ${bt.buildingType}, ${fp.w}x${fp.h}${bt.rotate ? "" : ", no rotate"}${bt.mirror ? "" : ", no mirror"} (drag onto the map, or click then click the map)` },
        thumb(bt, pending?.ref === bt.id ? pending.transform : 0, sprite), el("span", { class: "nm", text: bt.name }), el("span", { class: "dim", text: `${A.BUILDING_TYPE_LABEL[bt.buildingType] ?? bt.buildingType} · ${fp.w}x${fp.h}` }));
      item.addEventListener("click", () => { pending = { ref: bt.id, transform: 0 }; selRef = -1; setTool("building"); });
      item.addEventListener("dragstart", (e) => { e.dataTransfer!.setData("text/x-sworn-building", bt.id); e.dataTransfer!.effectAllowed = "copy"; });
      library.append(item);
    }
    const sel = selRef >= 0 ? st.buildings[selRef] : null;
    const pl = sel ? A.placements(st, lookup)[selRef] : null;
    refInfo.textContent = sel ? `Selected: #${selRef + 1} ${sel.ref} at ${sel.x},${sel.y}, transform ${A.TRANSFORM_LABEL[sel.transform ?? 0]}, ${pl?.w}x${pl?.h}${pl && !pl.ok ? ` · COLLIDES at ${pl.bad.length} cells` : ""}`
      : pending ? `Placing ${pending.ref} (${A.TRANSFORM_LABEL[pending.transform]}): click the map. R rotates, M mirrors, Esc stops.`
      : `${st.buildings.length} buildings. Click one on the map to select / drag it.`;
  }

  // ---------------- panels
  const docCoverage = () => (doc ? coverage(legend(), doc.kind === "interiors" ? (p) => propArt(p) : undefined) : []);
  function renderPalette() {
    palette.replaceChildren();
    if (!doc || !isGrid()) return;
    const cov = docCoverage(), leg = legend();
    for (const c of cov) {
      const spec = c.tile !== null ? tileArt(c.tile) : null, src = spec && drawable(spec);
      let icon = el("canvas", { width: 28, height: 28 }) as HTMLCanvasElement;
      const g = icon.getContext("2d")!;
      g.fillStyle = "#4d6338"; g.fillRect(0, 0, 28, 28);
      const s = leg[c.ch];
      if (doc.kind === "interiors") icon = interiorIcon(s, c.ch);
      else if (s.tier) { g.fillStyle = s.color; g.fillRect(3, 3, 22, 22); g.fillStyle = "#fff"; g.font = "bold 16px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(c.ch, 14, 15); }
      else if (src) { g.imageSmoothingQuality = "high"; const iw = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width, ih = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height, k = Math.min(28 / iw, 28 / ih); g.drawImage(src, (28 - iw * k) / 2, 28 - ih * k, iw * k, ih * k); }
      else if (c.ch !== ".") { g.fillStyle = s.color; if (s.slot) { g.beginPath(); g.arc(14, 14, 9, 0, 7); g.fill(); } else g.fillRect(4, 4, 20, 20); }
      palette.append(el("button", { class: "area-sym" + (c.ch === brush ? " on" : ""), "data-ch": c.ch, title: `${c.label} ["${c.ch}"] · ${c.art ? "art: " + c.art.replace("/sprites/", "") : c.note}`, onclick: () => { brush = c.ch; if (tool === "pick" || tool === "select" || tool === "building") setTool("pencil"); renderPalette(); } },
        icon, el("code", { text: c.ch === " " ? "␠" : c.ch }), el("span", { text: c.label })));
    }
    if (doc.kind === "interiors") {
      const none = cov.filter((c) => leg[c.ch]?.prop && !c.art && !["stairsUp", "stairsDown"].includes(leg[c.ch].prop!)).map((c) => `"${c.ch}"`);
      paletteNote.textContent = (INTERIOR_ART.errors.length ? "ART TABLES NOT READ: " + INTERIOR_ART.errors.join("; ") + ". " : "")
        + "Furniture: the room renderer's tables (client/src/interior.ts). " + (none.length ? `Stand-in blocks (no art, as in the game): ${none.join(" ")}. ` : "")
        + "Stairs U / D are drawn in code. Gold \"2+\" / \"3+\": shown from that building level.";
      return;
    }
    if (doc.kind === "sites" && layer === "tiers") { paletteNote.textContent = "Tier grid: the tier (1..max tier) each cell joins at; \".\" on open ground. Below its tier a gate is a wall (tier 2+), a wall a fence (tier 1), anything else open."; return; }
    const none = cov.filter((c) => c.tile !== null && !c.art).map((c) => `"${c.ch}" ${c.label}`);
    const markers = cov.filter((c) => c.tile === null && c.ch !== ".").map((c) => `"${c.ch}"`);
    paletteNote.textContent = (none.length ? `Swatch only (no art): ${none.join(", ")}. ` : "Every tile symbol draws its game sprite. ") + (markers.length ? `Markers (slots / no tile): ${markers.join(" ")}.` : "")
      + (doc.kind === "sites" ? " Painting a new cell gives it tier 1 (the Tiers grid changes it)." : "");
  }

  // ---------------- layers (a site's tiles / tiers, an interior's variants + upstairs)
  function setLayer(l: string) {
    if (!doc || l === layer) return;
    layer = l; selection = null; pasting = false;
    if (!(brush in legend())) brush = DEFAULT_BRUSH[doc.kind];
    renderLayerBar(); renderPalette(); renderMeta(); invalidate(true); validateSoon(0);
  }
  function renderLayerBar() {
    layerBar.replaceChildren();
    const on = !!doc && (doc.kind === "sites" || doc.kind === "interiors") && !preview;
    layerBar.hidden = !on;
    if (!on || !doc) return;
    const btn = (l: string, label: string) => el("button", { class: "layerbtn" + (l === layer ? " on" : ""), "data-layer": l, text: label, onclick: () => setLayer(l) });
    if (doc.kind === "sites") { layerBar.append(el("span", { class: "lbl", text: "Grid:" }), btn("rows", "Tiles"), btn("tiers", "Tiers")); return; }
    const f = doc.t as A.InteriorFile;
    layerBar.append(el("span", { class: "lbl", text: "Layout:" }), ...f.variants.map((_, i) => btn("v" + i, "Variant " + (i + 1))));
    if (f.upper) layerBar.append(btn("upper", "Upstairs"));
    const vi = layer === "upper" ? -1 : Number(layer.slice(1));
    const edit = (fn: (o: A.InteriorFile) => void, warn?: string) => {
      const before = snapshot(), o = JSON.parse(before) as A.InteriorFile;
      fn(o);
      commit(o as unknown as AnyTemplate, before);
      if (!A.layersOf("interiors", o as unknown as AnyTemplate).includes(layer)) layer = "v0";
      renderLayerBar(); renderMeta(); invalidate(true);
      if (warn) toast(warn, "info", 6000);
    };
    const SEL = "interiorVariantFor picks a layout by its INDEX (building anchor + level): this changes which building gets which layout.";
    layerBar.append(el("span", { class: "sep" }),
      el("button", { text: "◀ Move", id: "area-var-left", disabled: vi <= 0, title: "Move this variant left (" + SEL + ")", onclick: () => edit((o) => { const [x] = o.variants.splice(vi, 1); o.variants.splice(vi - 1, 0, x); layer = "v" + (vi - 1); }, SEL) }),
      el("button", { text: "Move ▶", id: "area-var-right", disabled: vi < 0 || vi >= f.variants.length - 1, title: "Move this variant right", onclick: () => edit((o) => { const [x] = o.variants.splice(vi, 1); o.variants.splice(vi + 1, 0, x); layer = "v" + (vi + 1); }, SEL) }),
      el("button", { text: "+ Variant", id: "area-var-add", title: "Add a copy of this variant at the end", onclick: () => edit((o) => { o.variants.push(JSON.parse(JSON.stringify(o.variants[Math.max(0, vi)]))); layer = "v" + (o.variants.length - 1); }, `The game needs exactly ${A.INTERIOR_VARIANTS} variants (the validator refuses others): remove one before saving. ` + SEL) }),
      el("button", { text: "− Variant", id: "area-var-del", disabled: vi < 0 || f.variants.length <= 1, title: "Remove this variant", onclick: () => edit((o) => { o.variants.splice(vi, 1); layer = "v" + Math.max(0, vi - 1); }, `The game needs exactly ${A.INTERIOR_VARIANTS} variants. ` + SEL) }),
      f.upper ? el("button", { text: "− Upstairs", id: "area-upper-del", title: "Remove the upper floor (a ground floor \"U\" then has nowhere to go: remove the stairs too)", onclick: () => edit((o) => { delete o.upper; }) })
        : el("button", { text: "+ Upstairs", id: "area-upper-add", title: "Add an upper floor (reached by \"U\" stairs on every ground floor)", onclick: () => edit((o) => { o.upper = { label: "Upstairs", floor: "wood", wall: "wood", rows: ["#######", "#b...b#", "#.....#", "#..D..#", "#######"] }; layer = "upper"; }) }));
  }

  function renderMeta() {
    meta.replaceChildren();
    formBox.replaceChildren();
    if (!doc) { meta.append(el("p", { class: "hint", text: "Open a template from the list, or New." })); return; }
    const d = doc;
    if (A.isDataKind(d.kind)) {
      // stage B: the forms (forms.ts); every change is one undo step, then the panels re-render
      const ctx: FormCtx = {
        kind: d.kind, t: d.t as unknown as Record<string, any>, layer, readOnly: readOnly(),
        set: (fn) => {
          if (readOnly()) { void duplicateDoc().then((ok) => { if (!ok) renderMeta(); }); return; }
          const before = snapshot(), o = JSON.parse(before);
          fn(o);
          if (JSON.stringify(o) === before) return;
          commit(o, before);
          renderMeta(); renderPalette(); updateSavePath();
        },
      };
      meta.append(...dataMeta(ctx));
      if (d.kind === "pois") formBox.append(poiForm(ctx), poiPreviewBox());
      updateSavePath();
      return;
    }
    const field = (label: string, input: HTMLElement, hint?: string) => meta.append(el("label", { class: "area-field" }, el("span", { text: label }), input, hint ? el("small", { text: hint }) : null));
    const setField = (fn: (o: Record<string, unknown>) => void) => {
      if (readOnly()) { void duplicateDoc().then((ok) => { if (!ok) renderMeta(); }); return; }
      const before = snapshot(), o = JSON.parse(before);
      fn(o);
      commit(o, before);
      updateSavePath();
    };
    const text = (key: string, label: string, hint?: string) => {
      const i = el("input", { type: "text", value: String((d.t as unknown as Record<string, unknown>)[key] ?? ""), "data-key": key, onchange: () => setField((o) => { o[key] = i.value.trim(); }) });
      field(label, i, hint);
    };
    const num = (key: string, label: string, min: number, max: number, step = 1) => {
      const i = el("input", { type: "number", min, max, step, value: String((d.t as unknown as Record<string, unknown>)[key] ?? 0), "data-key": key, onchange: () => setField((o) => { o[key] = Number(i.value); }) });
      field(label, i);
    };
    const sel = (key: string, label: string, opts: [string, string][], numeric = false) => {
      const cur = String((d.t as unknown as Record<string, unknown>)[key]);
      const s = el("select", { "data-key": key, onchange: () => setField((o) => { o[key] = numeric ? Number(s.value) : s.value; }) }, ...opts.map(([v, l]) => el("option", { value: v, text: l, selected: v === cur })));
      field(label, s);
    };
    const check = (key: string, label: string, dflt = false) => {
      const v = (d.t as unknown as Record<string, unknown>)[key];
      const c = el("input", { type: "checkbox", "data-key": key, onchange: () => setField((o) => { o[key] = c.checked; }) });
      c.checked = v === undefined ? dflt : !!v;
      meta.append(el("label", { class: "check area-check" }, c, label));
    };
    text("id", "Id", "a-z 0-9 - _, max 48 = the file name");
    text("name", "Name");
    const sides: [string, string][] = ["N", "E", "S", "W"].map((s) => [s, s]);
    const tiers: [string, string][] = d.kind === "settlements" ? [["1", "1 hamlet"], ["2", "2 village"], ["3", "3 town"]] : [["1", "1"], ["2", "2"], ["3", "3"]];
    sel("tier", "Tier", tiers, true);
    if (d.kind === "camps") {
      const c = d.t as CampTemplate;
      num("weight", "World-gen weight", 0, 100, 0.5);
      num("minStartDist", "Min start distance", 0, 400);
      const gMin = el("input", { type: "number", min: 1, max: 24, value: String(c.guards[0]), "data-key": "guards0", onchange: () => setField((o) => { (o.guards as number[])[0] = Number(gMin.value); }) });
      const gMax = el("input", { type: "number", min: 1, max: 24, value: String(c.guards[1]), "data-key": "guards1", onchange: () => setField((o) => { (o.guards as number[])[1] = Number(gMax.value); }) });
      meta.append(el("label", { class: "area-field" }, el("span", { text: "Guards (min-max)" }), el("span", { class: "row tight" }, gMin, "to", gMax)));
      sel("entrance", "Entrance side", sides);
      check("rotate", "world-gen may rotate"); check("mirror", "world-gen may mirror");
    } else if (d.kind === "buildings") {
      sel("buildingType", "Building type", A.BUILDING_TYPES.map((b) => [b, A.BUILDING_TYPE_LABEL[b]]));
      sel("role", "Room role", A.BUILDING_ROLES.map((r) => [r, A.ROOM_ROLE_LABEL[r as keyof typeof A.ROOM_ROLE_LABEL]]));
      sel("doorSide", "Door side", sides);
      check("rotate", "may rotate"); check("mirror", "may mirror");
    } else {
      const s = d.t as SettlementTemplate;
      num("weight", "World-gen weight", 0, 100, 0.5);
      num("minStartDist", "Min start distance", 0, 400);
      sel("profile", "Behaviour profile", A.SETTLEMENT_PROFILES.map((p) => [p, p]));
      for (const g of A.SETTLEMENT_GUARDS) {
        const i = el("input", { type: "number", min: 0, max: 24, value: String(s.garrison?.[g] ?? 0), "data-key": "garrison." + g, onchange: () => setField((o) => { const gg = o.garrison as Record<string, number>; if (Number(i.value) > 0) gg[g] = Number(i.value); else delete gg[g]; }) });
        field("Garrison: " + g, i);
      }
      check("rotate", "world-gen may turn", true); check("mirror", "world-gen may mirror", true);
      check("spriteBuildings", "sprite buildings (3x3 prefabs)");
    }
    updateSavePath();
  }
  function updateSavePath() {
    if (!doc) { savePath.textContent = ""; saveBtn.disabled = true; return; }
    if (doc.kind === "interiors") {
      saveBtn.textContent = "Save the built-in file";
      savePath.replaceChildren(el("span", { class: "warn-text bad" }, "Writes the GAME'S built-in file ", el("code", { text: doc.path ?? "" }), " (a backup goes to art-sources/lab/backups/; refused if the file changed on disk since you opened it)."));
      saveBtn.disabled = errors.length > 0 || !isDirty();
      saveBtn.title = errors.length ? "Fix the validation errors first" : !isDirty() ? "No changes" : "Save (Ctrl+S): edits " + doc.path;
      return;
    }
    saveBtn.textContent = "Save to user/";
    const id = doc.t.id, target = `server/data/${doc.kind}/user/${id}.json`;
    const userExists = entries[doc.kind].some((e) => e.src === "user" && e.file === id + ".json");
    const isBuiltinId = entries[doc.kind].some((e) => e.src === "builtin" && e.id === id);
    savePath.replaceChildren(
      readOnly() ? el("span", { class: "warn-text", text: `Built-in ${doc.path} is read-only. Duplicate it to edit.` })
        : isBuiltinId ? el("span", { class: "warn-text", text: `"${id}" is a built-in's id: choose another id.` })
          : el("span", {}, "Writes ", el("code", { text: target }), userExists && doc.origId === id ? " (overwrites your user template; the old file is backed up)" : userExists ? " (a user template with this id exists: it will be refused)" : " (new file)"));
    saveBtn.disabled = readOnly() || errors.length > 0 || isBuiltinId;
    saveBtn.title = errors.length ? "Fix the validation errors first" : readOnly() ? "Built-ins are read-only" : "Save (Ctrl+S)";
  }

  // ---------------- validation (the game's validators, debounced)
  let valTimer = 0;
  function validateSoon(ms = 140) {
    clearTimeout(valTimer);
    valTimer = window.setTimeout(validateNow, ms);
  }
  function validateNow() {
    valList.replaceChildren();
    if (!doc) { errors = []; warnings = []; updateSavePath(); return; }
    try { errors = A.validate(doc.kind, doc.t, lookup); } catch (e) { errors = ["validator crashed: " + (e as Error).message]; }
    cellErrors = errors;
    if (doc.kind === "interiors") { try { cellErrors = A.interiorLayoutErrors(doc.t as A.InteriorFile, layer); } catch { cellErrors = []; } }
    warnings = [];
    const tt = doc.t as unknown as Record<string, unknown>;
    if (doc.src !== "builtin" && (doc.kind === "sites" || doc.kind === "pois" || doc.kind === "castle-ruins")) warnings.push("Not used by world-gen yet: " + A.WORLDGEN_NOTE[doc.kind]);
    if (doc.kind === "pois") warnings.push("ORDER MATTERS: world-gen draws from the lists in order (reordering a built-in pool would change every world).");
    if (doc.kind === "interiors" && doc.opened) {
      const o = JSON.parse(doc.opened) as A.InteriorFile, f = doc.t as A.InteriorFile;
      if (o.variants.length !== f.variants.length) warnings.push(`Variant COUNT changed (${o.variants.length} -> ${f.variants.length}): interiorVariantFor picks by index modulo ${A.INTERIOR_VARIANTS}; the game requires exactly ${A.INTERIOR_VARIANTS}.`);
      else {
        const moved = f.variants.map((l, i) => JSON.stringify(l) !== JSON.stringify(o.variants[i]) && o.variants.some((x, k) => k !== i && JSON.stringify(x) === JSON.stringify(l)));
        if (moved.some(Boolean)) warnings.push("Variant ORDER changed: interiorVariantFor picks a layout by its index, so existing buildings show a different layout.");
      }
      if (!!o.upper !== !!f.upper) warnings.push(f.upper ? "Upper floor added: every ground floor needs a \"U\" stairs (the validator checks)." : "Upper floor removed.");
    }
    if (doc.kind !== "buildings" && tt.weight === 0) warnings.push("weight 0: world-gen never places it (only creative \"Stamp here\")");
    if (entries[doc.kind].some((e) => e.src === "builtin" && e.id === doc!.t.id) && doc.src !== "builtin") warnings.push(`id "${doc.t.id}" is a built-in's: the game would skip this user file`);
    if (doc.kind === "settlements") {
      const bad = A.placements(doc.t as SettlementTemplate, lookup).filter((p) => !p.ok);
      if (bad.length) warnings.push(`${bad.length} building(s) collide or break their template's rotate / mirror flags (red)`);
    }
    statsLine.textContent = A.statsLine(doc.kind, doc.t, lookup);
    valList.append(el("div", { class: "val-head " + (errors.length ? "bad" : "ok"), id: "area-val-head", text: errors.length ? `${errors.length} error(s): Save is disabled` : "Valid (the game's validator)" }));
    if (doc.kind === "interiors" && cellErrors.length) valList.append(el("div", { class: "val-item dim", text: `This layout (${layer === "upper" ? "upstairs" : "variant " + (Number(layer.slice(1)) + 1)}): ${cellErrors.length} problem(s), outlined on the grid.` }));
    for (const e of errors) {
      const c = A.errorCell(e), b = A.errorBuilding(e);
      // an interior message names its layout ("(variant 2)", "upstairs"): jumping switches to it
      const lay = doc.kind === "interiors" ? (/\(variant (\d+)\)/.exec(e)?.[1] !== undefined ? "v" + /\(variant (\d+)\)/.exec(e)![1] : / upstairs/.test(e) ? "upper" : null) : null;
      valList.append(el("button", { class: "val-item bad" + (c || b >= 0 ? " jump" : ""), text: e, title: c ? `jump to ${c.x},${c.y}` : b >= 0 ? `select building ${b + 1}` : "", onclick: () => { if (lay && lay !== layer) setLayer(lay); jumpTo(c, b); } }));
    }
    for (const w of warnings) valList.append(el("div", { class: "val-item warn", text: w }));
    updateSavePath(); deps.onState(); view.render();
  }
  function jumpTo(c: { x: number; y: number } | null, b: number) {
    if (b >= 0 && doc?.kind === "settlements") {
      const ref = (t() as SettlementTemplate).buildings[b];
      if (ref) { selRef = b; setTool("building"); pending = null; c ??= { x: ref.x, y: ref.y }; renderLibrary(); }
    }
    if (!c) return;
    const r = canvasBox.getBoundingClientRect();
    view.panX = Math.round(r.width / 2 - (c.x + 0.5) * view.zoom);
    view.panY = Math.round(r.height / 2 - (c.y + 0.5) * view.zoom);
    flash = { ...c, until: performance.now() + 2200 };
    view.render();
    setTimeout(() => view.render(), 2300);
  }

  // ---------------- render
  let base: HTMLCanvasElement | null = null, baseCell = 24, raf = 0, refit = false;
  function invalidate(fit = false) {
    refit ||= fit;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!doc || !isGrid()) { base = null; view.setImage(null, 0, 0); return; }
      if (preview) { renderPreviewView(); return; }
      const w = G.gridW(rows()), h = rows().length;
      baseCell = cellSizeFor(w, h);
      base = renderTemplate(doc.kind, doc.t, lookup, baseCell, layer);
      const changed = view.imgW !== w || view.imgH !== h;
      view.setImage(base, w, h, refit || changed);
      refit = false;
    });
  }
  setArtListener(() => { invalidate(); renderPaletteSoon(); });
  let palTimer = 0;
  function renderPaletteSoon() { clearTimeout(palTimer); palTimer = window.setTimeout(() => { thumbs.clear(); renderPalette(); renderLibrary(); }, 250); }

  view.overlay = (g, sx, sy) => {
    if (!doc) return;
    const z = view.zoom;
    if (preview) { previewOverlay(g, sx, sy, z); return; }
    const w = G.gridW(rows()), h = rows().length;
    if (showSymbols && z >= 12) {
      g.font = `${Math.floor(z * 0.4)}px ui-monospace, monospace`; g.textAlign = "center"; g.textBaseline = "middle";
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = rows()[y][x]; if (ch === ".") continue; g.fillStyle = "rgba(0,0,0,0.7)"; g.fillText(ch, sx(x + 0.5) + 1, sy(y + 0.5) + 1); g.fillStyle = "#fff"; g.fillText(ch, sx(x + 0.5), sy(y + 0.5)); }
    }
    // error cells
    g.lineWidth = 2;
    for (const e of cellErrors) { const c = A.errorCell(e); if (c) { g.strokeStyle = "#ff4b3e"; g.strokeRect(sx(c.x) + 1, sy(c.y) + 1, z - 2, z - 2); } }
    if (doc.kind === "castle-ruins") { g.strokeStyle = "rgba(255,80,60,0.8)"; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.strokeRect(sx(w >> 1) + 3, sy(h >> 1) + 3, z - 6, z - 6); g.setLineDash([]); }
    // camp entrance / building door side
    const side = doc.kind === "camps" ? (t() as CampTemplate).entrance : doc.kind === "buildings" ? (t() as BuildingTemplate).doorSide : null;
    if (side) arrow(g, sx(0), sy(0), w * z, h * z, side, "#ffd84a", doc.kind === "camps" ? "entrance" : "door");
    // settlement buildings
    if (doc.kind === "settlements") {
      const pl = A.placements(t() as SettlementTemplate, lookup);
      for (const p of pl) {
        g.strokeStyle = p.ok ? "rgba(120,220,120,0.85)" : "#ff4b3e"; g.lineWidth = p.index === selRef ? 3 : 1.5;
        g.setLineDash(p.index === selRef ? [] : [5, 3]);
        g.strokeRect(sx(p.x) + 0.5, sy(p.y) + 0.5, p.w * z - 1, p.h * z - 1);
        g.setLineDash([]);
        g.fillStyle = "rgba(255,60,50,0.45)";
        for (const c of p.bad) g.fillRect(sx(c.x), sy(c.y), z, z);
      }
      if (pending && hover && tool === "building") {
        const fp = pendingFootprint(hover.x, hover.y), bt = lookup(pending.ref);
        if (fp && bt) {
          const test = A.placements({ ...(t() as SettlementTemplate), buildings: [...(t() as SettlementTemplate).buildings, { ref: pending.ref, x: fp.x, y: fp.y, transform: pending.transform }] }, lookup);
          const ok = test[test.length - 1].ok;
          g.globalAlpha = 0.75;
          g.drawImage(thumb(bt, pending.transform, !!(t() as SettlementTemplate).spriteBuildings), sx(fp.x), sy(fp.y), fp.w * z, fp.h * z);
          g.globalAlpha = 1;
          g.strokeStyle = ok ? "#7be07b" : "#ff4b3e"; g.lineWidth = 2; g.strokeRect(sx(fp.x), sy(fp.y), fp.w * z, fp.h * z);
        }
      }
    }
    // mirror axes
    g.strokeStyle = "rgba(90,200,255,0.7)"; g.lineWidth = 1; g.setLineDash([6, 4]);
    if (mirrorH) { g.beginPath(); g.moveTo(sx(w / 2), sy(0)); g.lineTo(sx(w / 2), sy(h)); g.stroke(); }
    if (mirrorV) { g.beginPath(); g.moveTo(sx(0), sy(h / 2)); g.lineTo(sx(w), sy(h / 2)); g.stroke(); }
    g.setLineDash([]);
    // tool previews
    if (drag && (drag.tool === "line" || drag.tool === "rect")) {
      const cells = drag.tool === "line" ? G.lineCells(drag.x0, drag.y0, drag.x1, drag.y1) : G.rectCells(drag.x0, drag.y0, drag.x1, drag.y1, filled);
      g.fillStyle = drag.erase ? "rgba(255,255,255,0.35)" : (legend()[brush]?.color ?? "#fff") + "aa";
      for (const c of G.mirrorCells(cells, w, h, mirrorH, mirrorV)) g.fillRect(sx(c.x) + 2, sy(c.y) + 2, z - 4, z - 4);
    }
    if (drag?.tool === "select" && !drag.moveSel) { const r = G.normRect(drag.x0, drag.y0, drag.x1, drag.y1); dashed(g, sx(r.x), sy(r.y), r.w * z, r.h * z, "#5ac8ff"); }
    if (selection) {
      let { x, y } = selection;
      if (drag?.tool === "select" && drag.moveSel) { x += drag.x1 - drag.x0; y += drag.y1 - drag.y0; }
      dashed(g, sx(x), sy(y), selection.w * z, selection.h * z, "#5ac8ff");
    }
    if (pasting && clipboard && hover) {
      g.fillStyle = "rgba(90,200,255,0.25)"; g.fillRect(sx(hover.x), sy(hover.y), G.gridW(clipboard) * z, clipboard.length * z);
      dashed(g, sx(hover.x), sy(hover.y), G.gridW(clipboard) * z, clipboard.length * z, "#5ac8ff");
    }
    if (hover && G.inGrid(rows(), hover.x, hover.y) && tool !== "building") { g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.5; g.strokeRect(sx(hover.x) + 0.5, sy(hover.y) + 0.5, z - 1, z - 1); }
    if (flash && performance.now() < flash.until) { g.strokeStyle = "#ffe14d"; g.lineWidth = 4; g.strokeRect(sx(flash.x) - 3, sy(flash.y) - 3, z + 6, z + 6); }
  };
  function dashed(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    g.strokeStyle = color; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); g.setLineDash([]);
  }
  function arrow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, side: string, color: string, label: string) {
    const m = 14, cx = x + w / 2, cy = y + h / 2;
    const [ax, ay, dx, dy] = side === "N" ? [cx, y - m, 0, -1] : side === "S" ? [cx, y + h + m, 0, 1] : side === "E" ? [x + w + m, cy, 1, 0] : [x - m, cy, -1, 0];
    g.fillStyle = color; g.beginPath();
    g.moveTo(ax + dx * 8, ay + dy * 8); g.lineTo(ax - dy * 8 - dx * 4, ay + dx * 8 - dy * 4); g.lineTo(ax + dy * 8 - dx * 4, ay - dx * 8 - dy * 4); g.closePath(); g.fill();
    g.font = "11px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, ax + dx * 24 + (dy ? 0 : 0), ay + dy * 20 + (dx ? -14 : 0));
  }

  function updateStatus() {
    if (!doc || !hover) { status.textContent = doc ? `${G.gridW(rows())}x${rows().length}` : ""; return; }
    if (preview) { status.textContent = `${hover.x},${hover.y}`; return; }
    const ch = rows()[hover.y]?.[hover.x];
    const s = ch !== undefined ? legend()[ch] : undefined;
    const r = refAt(hover.x, hover.y);
    const tierAt = doc.kind === "sites" ? A.gridOf("sites", doc.t, "tiers")[hover.y]?.[hover.x] : undefined;
    if (tierAt !== undefined && ch !== undefined) { status.textContent = `${hover.x},${hover.y}  "${A.gridOf("sites", doc.t, "rows")[hover.y][hover.x]}" ${A.siteLegend(doc.t as A.SiteTemplateFile)[A.gridOf("sites", doc.t, "rows")[hover.y][hover.x]]?.label ?? "?"} · tier ${tierAt}`; return; }
    status.textContent = ch === undefined ? `${hover.x},${hover.y} (outside)` : `${hover.x},${hover.y}  "${ch}" ${s?.label ?? "unknown symbol"}${r >= 0 ? `  · building #${r + 1} ${(t() as SettlementTemplate).buildings[r].ref}` : ""}`;
  }
  function updateBanner() {
    banner.hidden = !doc || (!readOnly() && doc.src !== "new" && !preview);
    banner.replaceChildren();
    dataBanner.replaceChildren();
    dataBanner.className = "area-databanner";
    dataBanner.hidden = !doc || !(doc.kind === "interiors" || (A.isDataKind(doc.kind) && doc.src !== "builtin"));
    if (doc?.kind === "interiors") { dataBanner.classList.add("red"); dataBanner.append(el("strong", { text: "Built-in game data. " }), INTERIOR_BANNER); }
    else if (doc && !dataBanner.hidden) { dataBanner.classList.add("amber"); dataBanner.append(el("strong", { text: "Not used by world-gen yet. " }), A.WORLDGEN_NOTE[doc.kind as "sites" | "pois" | "castle-ruins"]); }
    if (!doc) return;
    if (preview) {
      const real: Partial<Record<Kind, string>> = {
        camps: "camps.ts stampCamp", settlements: "settlementTemplates.ts stampSettlement", sites: "sites.ts stampSiteTemplate", pois: "worldgen.ts placePoiSite",
      };
      banner.append(el("span", {
        text: doc.kind === "interiors" ? "Preview: the game's own buildInteriorMap (shared/src/interiors.ts) for this file at the chosen building level, with the edge furnishings it adds."
          : doc.kind === "castle-ruins" ? "Preview: shared-code view of the file (tiles, the boss on B, the grounds ring). placeCastleRuin (server) reads only the built-in castle-ruin; it is not run here."
          : preview.source === "server-stamper" ? `Preview: the REAL server stamper (server/src ${real[doc.kind]}) on an empty scratch map.` : "Preview: shared-code composition (the same shared functions the server stamper uses).",
      }));
      return;
    }
    if (readOnly()) banner.append(el("span", { text: `Built-in (read-only): ${doc.path}. ` }), el("button", { class: "primary", id: "area-dup-banner", text: "Duplicate to user…", onclick: () => duplicateDoc() }));
    else if (doc.src === "new") banner.append(el("span", { text: `Unsaved new template: Save writes server/data/${doc.kind}/user/${doc.t.id}.json` }));
  }

  // ---------------- stamp preview
  function togglePreview() {
    if (!doc || doc.kind === "pois") return;
    if (preview) { preview = null; previewBar.hidden = true; editBar.hidden = false; previewBtn.classList.remove("on"); renderLayerBar(); updateBanner(); invalidate(true); return; }
    if (A.isDataKind(doc.kind)) {
      const site = doc.kind === "sites" ? (doc.t as A.SiteTemplateFile) : null;
      preview = { tf: 0, source: doc.kind === "sites" ? "server-stamper" : "shared-code", real: null, seed: 1, owned: true, running: false, tier: site ? site.startTier : 1, level: 3 };
      editBar.hidden = true; previewBar.hidden = false;
      renderLayerBar(); renderPreviewBar(); updateBanner(); invalidate(true);
      if (doc.kind === "sites") void runReal();
      return;
    }
    const tfs = A.previewTransforms(doc.kind as A.GridKind, doc.t, lookup);
    preview = { tf: tfs[0] ?? 0, source: "shared-code", real: null, seed: 1, owned: true, running: false };
    editBar.hidden = true; previewBar.hidden = false;
    renderPreviewBar(); updateBanner(); invalidate(true);
  }
  /** Stage B preview bars: site tiers (the real stamper), interior levels (buildInteriorMap), the castle (shared view). */
  function renderDataPreviewBar() {
    const p = preview!, d = doc!;
    if (d.kind === "sites") {
      const st = d.t as A.SiteTemplateFile;
      previewBar.append(el("span", { class: "lbl", text: "Tier:" }));
      for (let k = 1; k <= Math.max(1, Math.min(4, st.maxTier || 1)); k++) {
        previewBar.append(el("button", { class: "area-variant" + (p.tier === k ? " on" : ""), "data-tier": String(k), text: `Tier ${k}${k === st.startTier ? " (start)" : ""}`, onclick: () => { p.tier = k; p.real = null; renderPreviewBar(); void runReal(); } }));
      }
      const seed = el("input", { type: "number", min: 1, value: String(p.seed), title: "Seed for the stamper's picks (posts, site name)", onchange: () => { p.seed = Math.max(1, Math.round(Number(seed.value)) || 1); void runReal(); } });
      const own = el("input", { type: "checkbox", onchange: () => { p.owned = own.checked; view.render(); } }); own.checked = p.owned;
      previewBar.append(el("span", { class: "sep" }), el("label", { class: "check" }, "seed", seed), el("button", { text: "Re-run", onclick: () => runReal() }), el("label", { class: "check" }, own, "ownership"));
    } else if (d.kind === "interiors") {
      previewBar.append(el("span", { class: "lbl", text: `${layer === "upper" ? "Upstairs" : "Variant " + (Number(layer.slice(1)) + 1)}, building level:` }));
      for (const lv of [1, 2, 3]) previewBar.append(el("button", { class: "area-variant" + (p.level === lv ? " on" : ""), "data-level": String(lv), text: "Level " + lv, onclick: () => { p.level = lv; renderPreviewBar(); invalidate(true); } }));
    } else previewBar.append(el("span", { class: "lbl", text: "Castle Ruin: the layout as stamped, the boss on B, the grounds ring (radius + 1)" }));
    previewBar.append(el("span", { class: "grow" }), el("button", { class: "on", text: "Back to editing (V)", onclick: () => togglePreview() }));
  }
  function sharedView(tf: number): StampView | string {
    try {
      if (doc!.kind === "camps" && G.findAll(rows(), "H").length !== 1) return "a camp needs exactly one hearth H";
      return viewFromPreview(A.preview(doc!.kind as A.GridKind, doc!.t, tf, lookup));
    } catch (e) { return (e as Error).message; }
  }
  function renderPreviewBar() {
    if (!preview || !doc) return;
    previewBar.replaceChildren();
    if (A.isDataKind(doc.kind)) { renderDataPreviewBar(); return; }
    const tfs = A.previewTransforms(doc.kind, doc.t, lookup);
    previewBar.append(el("span", { class: "lbl", text: doc.kind === "buildings" ? "Placements:" : "World-gen variants:" }));
    for (const tf of tfs) {
      const v = sharedView(tf);
      const c = typeof v === "string" ? el("span", { text: "!" }) : renderStamp(v, Math.max(2, Math.floor(44 / Math.max(v.w, v.h))));
      previewBar.append(el("button", { class: "area-variant" + (tf === preview.tf ? " on" : ""), "data-tf": String(tf), title: "transform " + A.TRANSFORM_LABEL[tf], onclick: () => { preview!.tf = tf; preview!.real = null; renderPreviewBar(); invalidate(true); } }, c, el("small", { text: A.TRANSFORM_LABEL[tf] })));
    }
    previewBar.append(el("span", { class: "sep" }));
    const real = doc.kind === "camps" || doc.kind === "settlements";
    const srcSel = el("select", { id: "area-prev-src", disabled: !real, onchange: () => { preview!.source = srcSel.value as "shared-code" | "server-stamper"; preview!.real = null; updateBanner(); if (preview!.source === "server-stamper") void runReal(); else invalidate(); } },
      el("option", { value: "shared-code", text: "Shared code (instant)", selected: preview.source === "shared-code" }),
      el("option", { value: "server-stamper", text: "Real server stamper", selected: preview.source === "server-stamper" }));
    const seed = el("input", { type: "number", min: 1, value: String(preview.seed), title: "Seed for the stamper's random picks (guard count / kinds, names)", onchange: () => { preview!.seed = Math.max(1, Math.round(Number(seed.value)) || 1); if (preview!.source === "server-stamper") void runReal(); } });
    const own = el("input", { type: "checkbox", onchange: () => { preview!.owned = own.checked; view.render(); } }); own.checked = preview.owned;
    previewBar.append(srcSel, el("label", { class: "check" }, "seed", seed),
      el("button", { text: "Re-run", disabled: preview.source !== "server-stamper", onclick: () => runReal() }),
      el("label", { class: "check", title: "Tint the cells the settlement owns" }, own, "ownership"),
      el("span", { class: "grow" }), el("button", { class: "on", text: "Back to editing (V)", onclick: () => togglePreview() }));
  }
  async function runReal() {
    if (!preview || !doc || preview.running) return;
    if (errors.length) { toast("The real stamper needs a valid template: fix the errors first", "err"); statsLine.textContent = "Fix the validation errors to run the server stamper."; return; }
    const p = preview, d = doc;
    p.running = true; statsLine.textContent = "Running the server stamper…";
    try {
      const r = await api.stamp(d.kind, A.normalise(d.kind, d.t), p.tf, p.seed, d.kind === "sites" ? { tier: p.tier ?? 1 } : {});
      if (preview !== p || doc !== d) return;          // left the preview / switched template meanwhile
      if (!r.ok) { toast("Stamper refused: " + (r.errors as string[]).join("; "), "err"); return; }
      p.real = d.kind === "sites" ? siteView(r) : realView(r, p.tf);
      invalidate();
    } catch (e) { toast("Stamper failed: " + (e as Error).message, "err"); }
    finally { p.running = false; }
  }
  function realView(r: Record<string, any>, tf: number): StampView {
    const markers: StampView["markers"] = [];
    const shared = A.preview(doc!.kind as A.GridKind, doc!.t, tf, lookup);
    const d = doc!.kind === "settlements" ? r.margin - shared.apron : r.margin;
    for (const m of r.mobs as { kind: string; x: number; y: number }[]) markers.push({ x: m.x, y: m.y, kind: "mob", label: m.kind.replace(/^bandit|^town/, "")[0] ?? "?", color: slotColor("mob") });
    const info: string[] = [`server stamper, seed ${r.seed}, transform ${A.TRANSFORM_LABEL[r.transform]}`, `${r.mobs.length} guard(s) spawned (dormant)`];
    if (r.hearth) { markers.push({ x: r.hearth.x, y: r.hearth.y, kind: "hearth", label: "H", color: slotColor("hearth") }); info.push(`hearth hp ${r.hearth.hp}, prisoners ${r.hearth.prisoners}, chests ${r.hearth.chests}, radius ${r.hearth.radius}`); }
    if (r.site) {
      const s = r.site;
      markers.push({ ...s.keep, kind: "keep", label: "K", color: slotColor("keep") });
      for (const [k, p] of Object.entries(s.homes as Record<string, unknown>)) {
        if (k === "villagers") for (const v of p as { x: number; y: number }[]) markers.push({ ...v, kind: "villager", label: "v", color: slotColor("villager") });
        else if (p) markers.push({ ...(p as { x: number; y: number }), kind: k, label: k[0], color: slotColor(k) });
      }
      info.push(`site "${s.name}" (${s.profile}), apron ${s.apron}, ${s.homes.villagers.length} villager homes, ${s.posts.length} guard posts${r.fit ? ", fit problem: " + r.fit : ""}`);
    }
    return {
      w: r.w, h: r.h, tiles: r.tiles, owned: r.site ? r.owned : undefined, grounds: r.site ? r.grounds : undefined, markers,
      footprints: shared.footprints.map((f) => ({ x: f.x + d, y: f.y + d, w: f.w, h: f.h, label: f.ref })),
      arrow: shared.entrance ? { side: shared.entrance } : undefined, prefab: shared.prefab, info, source: "server-stamper",
    };
  }
  /** The real stampSiteTemplate result as a view (tiles, ownership, grounds, the garrison, the keep). */
  function siteView(r: Record<string, any>): StampView {
    const markers: StampView["markers"] = (r.mobs as { kind: string; x: number; y: number }[]).map((m) => ({ x: m.x, y: m.y, kind: "mob", label: m.kind.replace(/^bandit|^town/, "")[0] ?? "?", color: slotColor("mob") }));
    markers.push({ ...r.site.keep, kind: "keep", label: "K", color: slotColor("keep") });
    const st = doc!.t as A.SiteTemplateFile;
    return {
      w: r.w, h: r.h, tiles: r.tiles, owned: r.owned, grounds: r.grounds, markers,
      footprints: [{ x: r.margin, y: r.margin, w: st.rows[0].length, h: st.rows.length, label: st.id }],
      info: [`server stamper (stampSiteTemplate), tier ${r.site.tier}, seed ${r.seed}`, `"${r.site.name}"`, `${r.mobs.length} garrison spawned (dormant)`, `apron ${r.site.apron}`], source: "server-stamper",
    };
  }
  /** Shared-code views: the castle ruin's file as tiles (+ the boss, the grounds ring), an interior from buildInteriorMap. */
  function dataView(): StampView | string | HTMLCanvasElement {
    const d = doc!;
    if (d.kind === "interiors") {
      try {
        const m = A.interiorPreviewMap(d.t as A.InteriorFile, layer, preview!.level ?? 3);
        return renderInteriorMap(m, cellSizeFor(m.w, m.h));
      } catch (e) { return "buildInteriorMap failed: " + (e as Error).message; }
    }
    const c = d.t as A.CastleRuinFile, n = c.rows.length, g = 1;
    const tiles: number[] = [], legend2 = A.castleLegend(c), W = n + 2 * g;
    for (let y = -g; y < n + g; y++) for (let x = -g; x < n + g; x++) { const ch = c.rows[y]?.[x]; tiles.push(ch !== undefined ? legend2[ch]?.tile ?? -1 : -1); }
    const mid = n >> 1;
    return {
      w: W, h: W, tiles, markers: [{ x: mid + g, y: mid + g, kind: "keep", label: "B", color: "#c02020" }],
      footprints: [{ x: 0, y: 0, w: W, h: W, label: "grounds" }],
      info: [`radius ${mid}, grounds ${mid + 1}`, `boss ${c.boss} on B`, `guardians ${c.guardians?.[0]}-${c.guardians?.[1]} on the open ground inside the walls`], source: "shared-code",
    };
  }
  let previewView: StampView | null = null;
  function renderPreviewView() {
    if (!preview || !doc) return;
    let v: StampView | string;
    if (A.isDataKind(doc.kind) && doc.kind !== "sites") {
      const dv = dataView();
      if (dv instanceof HTMLCanvasElement) {
        previewView = null;
        const m = A.interiorPreviewMap(doc.t as A.InteriorFile, layer, preview.level ?? 3);
        view.setImage(dv, m.w, m.h, refit || view.imgW !== m.w || view.imgH !== m.h);
        refit = false;
        statsLine.textContent = `buildInteriorMap("${m.templateId}", level ${m.level}, variant ${m.variant}, storey ${m.storey}): ${m.w}x${m.h}, ${m.props.length} props (incl. edge furnishings), ${m.slots.length} NPC slots, exit ${m.exit.x},${m.exit.y}, spawn ${m.spawn.x},${m.spawn.y}${m.stairs ? `, stairs ${m.stairs.x},${m.stairs.y}` : ""}`;
        return;
      }
      v = dv;
    } else if (preview.source === "server-stamper") v = preview.real ?? (preview.running ? "Running the server stamper…" : statsLine.textContent || "Running the server stamper…");
    else v = sharedView(preview.tf);
    if (typeof v === "string") { previewView = null; statsLine.textContent = v; view.setImage(null, 1, 1); return; }
    previewView = v;
    const cell = cellSizeFor(v.w, v.h);
    view.setImage(renderStamp(v, cell), v.w, v.h, refit || view.imgW !== v.w || view.imgH !== v.h);
    refit = false;
    statsLine.textContent = v.info.join(" · ");
  }
  function previewOverlay(g: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, z: number) {
    const v = previewView;
    if (!v) return;
    if (v.owned && preview?.owned) { g.fillStyle = "rgba(80,150,255,0.32)"; for (let i = 0; i < v.owned.length; i++) if (v.owned[i]) g.fillRect(sx(i % v.w), sy(Math.floor(i / v.w)), z, z); }
    if (v.grounds) { g.fillStyle = "rgba(255,255,255,0.18)"; for (let i = 0; i < v.grounds.length; i++) if (v.grounds[i] && !v.owned?.[i]) g.fillRect(sx(i % v.w), sy(Math.floor(i / v.w)), z, z); }
    g.lineWidth = 1.5;
    for (const f of v.footprints) dashed(g, sx(f.x), sy(f.y), f.w * z, f.h * z, "rgba(255,255,255,0.6)");
    for (const m of v.markers) {
      const r = Math.max(4, z * 0.3);
      g.fillStyle = m.color; g.strokeStyle = "#000"; g.beginPath(); g.arc(sx(m.x + 0.5), sy(m.y + 0.5), r, 0, Math.PI * 2); g.fill(); g.stroke();
      if (z >= 14) { g.font = `bold ${Math.floor(r * 1.2)}px system-ui`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#000"; g.fillText(m.label, sx(m.x + 0.5), sy(m.y + 0.5)); }
    }
    if (v.arrow) arrow(g, sx(0), sy(0), v.w * z, v.h * z, v.arrow.side, "#ffd84a", doc?.kind === "buildings" ? "door" : "entrance");
  }

  // ---------------- POI pools: samples from world-gen's placePoiSite (the real server code, scratch process)
  let poiSamples: { seed: number; key: string; r: Record<string, any> } | null = null;
  let poiSeed = 1, poiRunning = false;
  function poiPreviewBox(): HTMLElement {
    const box = el("div", { class: "area-sub area-poiprev", id: "area-poi-preview" }, el("h5", { text: "Samples: world-gen's placePoiSite (server/src/worldgen.ts) with this pool" }));
    const seed = el("input", { type: "number", min: 1, value: String(poiSeed), onchange: () => { poiSeed = Math.max(1, Math.round(Number(seed.value)) || 1); } });
    box.append(el("div", { class: "row tight" }, el("button", { id: "area-poi-run", class: "primary", text: poiRunning ? "Running…" : "Run 6 samples", disabled: poiRunning, onclick: () => runPoi() }), el("label", { class: "check" }, "first seed", seed),
      el("span", { class: "dim", text: "each sample: an empty map, the seeded draw order world-gen uses (centrepiece, extras, guardians)" })));
    const key = doc ? JSON.stringify(doc.t) : "";
    if (poiSamples) {
      if (poiSamples.key !== key) box.append(el("p", { class: "warn-text", text: "The pool changed since these samples: run again." }));
      const grid = el("div", { class: "area-samples" });
      for (const smp of poiSamples.r.samples as Record<string, any>[]) {
        const v: StampView = {
          w: smp.w, h: smp.h, tiles: smp.tiles, markers: [], footprints: [], info: [], source: "server-stamper",
        };
        const c = renderStamp(v, 26), g = c.getContext("2d")!;
        for (const m of smp.mobs as { kind: string; x: number; y: number }[]) {
          g.fillStyle = slotColor("mob"); g.strokeStyle = "#000"; g.beginPath(); g.arc(m.x * 26 + 13, m.y * 26 + 13, 7, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = "#000"; g.font = "bold 9px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(m.kind.slice(0, 2), m.x * 26 + 13, m.y * 26 + 13);
        }
        g.strokeStyle = "rgba(255,255,255,0.5)"; g.setLineDash([4, 3]);
        const fr = (doc?.t as A.PoiTemplateFile | undefined)?.footprintRadius ?? 2, cx = poiSamples.r.centre.x;
        g.strokeRect((cx - fr) * 26 + 0.5, (cx - fr) * 26 + 0.5, (2 * fr + 1) * 26 - 1, (2 * fr + 1) * 26 - 1);
        grid.append(el("figure", { class: "area-sample" }, c, el("figcaption", { text: `seed ${smp.seed}: ${smp.mobs.map((m: { kind: string }) => m.kind).join(", ") || "no guardians"}` })));
      }
      box.append(grid);
    } else box.append(el("p", { class: "hint", text: "Not run yet. (The guardian ring is the dashed square: footprintRadius.)" }));
    return box;
  }
  async function runPoi() {
    if (!doc || doc.kind !== "pois" || poiRunning) return;
    validateNow();
    if (errors.length) { toast("Fix the validation errors first", "err"); return; }
    poiRunning = true; renderMeta();
    const d = doc, key = JSON.stringify(d.t);
    try {
      const r = await api.stamp("pois", A.normalise("pois", d.t), 0, poiSeed, { samples: 6 });
      if (doc !== d) return;
      if (!r.ok) { toast("Refused: " + (r.errors as string[]).join("; "), "err"); return; }
      poiSamples = { seed: poiSeed, key, r };
    } catch (e) { toast("Samples failed: " + (e as Error).message, "err"); }
    finally { poiRunning = false; if (doc === d) renderMeta(); }
  }

  // ---------------- interiors: diff vs git HEAD (the committed file, `git show`), the edit as the game's format
  async function showDiff() {
    if (!doc || doc.kind !== "interiors") return;
    const d = doc;
    let head: { head: string | null; error?: string };
    try { head = await api.interiorHead(d.origId!); } catch (e) { toast("git show failed: " + (e as Error).message, "err"); return; }
    const now = JSON.stringify(A.normaliseInteriorFile(d.t as A.InteriorFile), null, 2) + "\n";
    const body = el("div", { class: "area-diff", id: "area-diff-view" });
    if (head.head === null) body.append(el("p", { class: "warn-text", text: "No committed version: " + (head.error ?? "not a git checkout") }));
    else {
      const hunks = diffHunks(head.head, now);
      body.append(el("p", { class: "hint", text: `git HEAD:${d.path}  vs  the editor's content${isDirty() ? " (UNSAVED edits included)" : " (= the file on disk)"}` }));
      if (!hunks) body.append(el("p", { class: "ok-text", text: "No difference: the file is as committed." }));
      else for (const h of hunks) {
        const pre = el("pre", { class: "area-hunk" });
        for (const l of h) pre.append(el("span", { class: "dl " + (l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx"), text: `${l.op} ${l.text}\n` }));
        body.append(pre);
      }
    }
    const back = el("div", { class: "modal-back", onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Escape") back.remove(); } },
      el("div", { class: "modal-form area-diffbox" }, el("h3", { text: "Diff vs git HEAD: " + d.path }), body,
        el("div", { class: "row end" }, el("button", { class: "primary", id: "area-diff-close", text: "Close", onclick: () => back.remove() }))));
    document.body.append(back);
  }

  // ---------------- save
  let saving = false;
  async function save() {
    if (!doc || saving) return;
    if (readOnly()) { await duplicateDoc(); return; }
    validateNow();
    if (errors.length) { toast(`Not saved: ${errors.length} validation error(s)`, "err"); return; }
    if (doc.kind === "interiors") { await saveInteriorFile(); return; }
    saving = true; saveBtn.disabled = true;
    try {
      const overwrite = doc.src === "user" && doc.origId === doc.t.id;
      const r = await api.saveTemplate(doc.kind, A.normalise(doc.kind, doc.t), overwrite, overwrite ? doc.hash : null);
      toast(`Saved ${r.path}${r.backup ? "; previous file in " + r.backup : ""}`, "ok", 5000);
      const renamed = doc.src === "user" && doc.origId !== doc.t.id ? doc.origId : null;
      doc.src = "user"; doc.origId = r.id; doc.hash = r.hash; doc.path = r.path;
      savedSnap = JSON.stringify(doc.t);
      await loadLists(doc.kind);
      if (renamed) toast(`The old file user/${renamed}.json is still there (delete it if it was a rename)`, "info", 6000);
      renderList(); updateBanner(); updateSavePath(); deps.onState();
    } catch (e) { toast("Save failed: " + (e as Error).message, "err", 6000); }
    finally { saving = false; updateSavePath(); }
  }

  async function saveInteriorFile() {
    const d = doc!;
    if (!isDirty()) { toast("No changes to save", "info"); return; }
    if (!(await confirmBox(`Write the GAME'S built-in file ${d.path}? Client and server both read it at build time: restart the server and rebuild the client afterwards; revert with git. (The old file is backed up.)`, "Write the built-in file"))) return;
    saving = true; saveBtn.disabled = true;
    try {
      const r = await api.saveInterior(d.origId!, A.normalise("interiors", d.t), d.hash!);
      toast(`Wrote ${r.path}${r.backup ? "; the old file is in " + r.backup : ""}. Restart the game server and rebuild the client to see it.`, "ok", 8000);
      d.hash = r.hash; d.opened = JSON.stringify(d.t);
      savedSnap = JSON.stringify(d.t);
      await loadLists("interiors");
      renderList(); updateBanner(); updateSavePath(); validateNow(); deps.onState();
    } catch (e) { toast("Save failed: " + (e as Error).message, "err", 8000); }
    finally { saving = false; updateSavePath(); }
  }

  // ---------------- keys (main.ts forwards them while this tab is active)
  function onKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === " ") { view.spaceHeld = e.type === "keydown"; return true; }
    if (e.type !== "keydown") return false;
    if (mod && k === "z" && !e.shiftKey) { undo(); return true; }
    if (mod && (k === "y" || (k === "z" && e.shiftKey))) { redo(); return true; }
    if (mod && (k === "c" || k === "x") && selection && doc) {
      clipboard = G.extract(rows(), selection);
      if (k === "x" && !readOnly()) commit({ ...t(), rows: G.fillRect(rows(), selection, A.BLANK) }, snapshot());
      toast(`${k === "x" ? "Cut" : "Copied"} ${selection.w}x${selection.h}`, "info", 1200);
      return true;
    }
    if (mod && k === "v" && clipboard) { setTool("select"); pasting = true; view.render(); return true; }
    if (mod) return false;
    if (k === "v") { togglePreview(); return true; }
    if (preview) return false;
    if (tool === "building" && (k === "r" || k === "m")) { turnRef(k === "r" ? 1 : 4); return true; }
    if ((k === "delete" || k === "backspace") && tool === "building") { removeRef(); return true; }
    if ((k === "delete" || k === "backspace") && selection && doc && !readOnly()) { commit({ ...t(), rows: G.fillRect(rows(), selection, A.BLANK) }, snapshot()); return true; }
    if (k === "escape") { selection = null; pasting = false; pending = null; selRef = -1; renderLibrary(); view.render(); return true; }
    if (k === "m") { if (e.shiftKey) { mirrorV = !mirrorV; mirVBox.checked = mirrorV; } else { mirrorH = !mirrorH; mirHBox.checked = mirrorH; } view.render(); return true; }
    const tl = TOOLS.find(([, , key]) => key.toLowerCase() === k);
    if (tl) { setTool(tl[0]); return true; }
    if (k === "+" || k === "=") { view.zoomAt(view.zoom + Math.max(1, Math.round(view.zoom * 0.2))); return true; }
    if (k === "-") { view.zoomAt(view.zoom - Math.max(1, Math.round(view.zoom * 0.2))); return true; }
    if (k === "0") { view.fit(); return true; }
    if (k === "g") { view.grid = !view.grid; view.render(); return true; }
    return false;
  }

  for (const [id, b] of toolBtns) b.classList.toggle("on", id === tool);
  return {
    view,
    get dirty() { return isDirty(); },
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get docLabel() { return doc ? `${doc.kind}: ${doc.t.id}${readOnly() ? " (built-in)" : ""}` : ""; },
    undo, redo, save, onKey,
    activate() { if (!base || view.imgW === 0) invalidate(true); else view.render(); },
    async init() {
      try { setAvailable(await api.refs()); } catch { /* every url is tried then */ }
      await loadLists();
      renderList();
      const first = entries[kind][0];
      if (first) await openEntry(first); else setDoc(null);
    },
    // test hooks (smoke test)
    debug: () => ({
      kind, layer, doc: doc && { ...doc, t: JSON.parse(JSON.stringify(doc.t)) }, errors: errors.slice(), cellErrors: cellErrors.slice(), warnings: warnings.slice(), dirty: isDirty(), tool, brush,
      coverage: docCoverage(), zoom: view.zoom, panX: view.panX, panY: view.panY, preview: preview && { ...preview, real: !!preview.real }, poiSamples: poiSamples?.r.samples.length ?? 0, artErrors: INTERIOR_ART.errors,
    }),
  };
}
