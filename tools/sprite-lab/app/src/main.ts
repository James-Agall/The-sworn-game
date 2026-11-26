// Sprite Lab app shell: header (set, save, undo/redo, dirty dot), tabs, keyboard shortcuts.
import "./style.css";
import type { HeroPalette } from "../../shared/recolour.ts";
import { api } from "./api.ts";
import { project } from "./project.ts";
import { mountParts } from "./parts.ts";
import { mountDraw } from "./draw.ts";
import { mountCompare } from "./compare.ts";
import { el, toast } from "./ui.ts";
import { installHook } from "./rig/hook.ts";
import { mountRig } from "./rig/tab.ts";
import { mountArea } from "./area/tab.ts";

type TabId = "parts" | "draw" | "rig" | "area" | "compare";
const TABS: [TabId, string][] = [["parts", "Parts"], ["draw", "Draw (based on Piskel)"], ["rig", "Rig"], ["area", "Area"], ["compare", "Compare"]];
let active: TabId = "parts", palette: HeroPalette | null = null;

const app = document.getElementById("app")!;
const tabBar = el("nav", { class: "tabs", role: "tablist" });
const dirtyDot = el("span", { class: "dirty", id: "dirty", title: "Unsaved changes" });
const setName = el("span", { class: "setname", id: "header-set" });
const undoBtn = el("button", { id: "undo", text: "Undo", title: "Undo (Ctrl+Z)", onclick: () => (active === "rig" ? rig.undo() : active === "area" ? area.undo() : project.undo()) });
const redoBtn = el("button", { id: "redo", text: "Redo", title: "Redo (Ctrl+Shift+Z / Ctrl+Y)", onclick: () => (active === "rig" ? rig.redo() : active === "area" ? area.redo() : project.redo()) });
const saveBtn = el("button", { id: "save", class: "primary", text: "Save", title: "Save the set (Ctrl+S; Rig tab: the clip; Area tab: the template); overwritten files are backed up", onclick: () => (active === "rig" ? rig.save() : active === "area" ? area.save() : save()) });
const rootNote = el("span", { class: "rootnote", id: "root-note" });
const palNote = el("span", { class: "warn-text", id: "palette-note" });
const header = el("header", {}, el("strong", { class: "brand", text: "Sprite Lab" }), tabBar, el("span", { class: "grow" }), palNote, rootNote, setName, dirtyDot, undoBtn, redoBtn, saveBtn);
const panes = new Map<TabId, HTMLElement>();
for (const [id] of TABS) panes.set(id, el("main", { class: "pane", id: "pane-" + id, hidden: id !== active }));
app.append(header, ...panes.values());

const parts = mountParts(panes.get("parts")!, { palette: () => palette, openInDraw: (n) => { showTab("draw"); draw.open(n); }, isActive: () => active === "parts" });
const draw = mountDraw(panes.get("draw")!, { isActive: () => active === "draw", showParts: () => showTab("parts") });
const compare = mountCompare(panes.get("compare")!, { isActive: () => active === "compare" });
installHook();
const rig = mountRig(panes.get("rig")!, { isActive: () => active === "rig", onState: () => refreshHeader() });
const area = mountArea(panes.get("area")!, { isActive: () => active === "area", onState: () => refreshHeader() });
(window as unknown as { __area: typeof area }).__area = area;    // smoke-test hook (read-only state)

for (const [id, label] of TABS) {
  tabBar.append(el("button", { role: "tab", class: "tab" + (id === active ? " on" : ""), "data-tab": id, id: "tab-" + id, text: label, onclick: () => showTab(id) }));
}
function showTab(id: TabId) {
  active = id;
  for (const [k, p] of panes) p.hidden = k !== id;
  for (const b of tabBar.querySelectorAll<HTMLButtonElement>(".tab")) b.classList.toggle("on", b.dataset.tab === id);
  localStorage.setItem("lab.tab", id);
  if (id === "draw") draw.activate();
  if (id === "compare") compare.activate();
  if (id === "parts") parts.view.render();
  if (id === "rig") rig.activate();
  if (id === "area") area.activate();
  refreshHeader();
}

function refreshHeader() {
  const onRig = active === "rig", onArea = active === "area";
  dirtyDot.classList.toggle("on", project.dirty || rig.dirty || area.dirty);
  dirtyDot.title = [project.dirty ? "unsaved set" : "", rig.dirty ? "unsaved clip(s)" : "", area.dirty ? "unsaved template" : ""].filter(Boolean).join(", ") || "No unsaved changes";
  setName.textContent = onArea ? area.docLabel : project.set ? `set: ${project.set}` : "";
  undoBtn.disabled = onRig ? !rig.canUndo : onArea ? !area.canUndo : !project.history.canUndo;
  redoBtn.disabled = onRig ? !rig.canRedo : onArea ? !area.canRedo : !project.history.canRedo;
  document.title = (project.dirty || rig.dirty || area.dirty ? "* " : "") + "Sprite Lab" + (project.set ? " - " + project.set : "");
}
project.on(refreshHeader);
project.on((why) => { if (why === "saved") rig.refreshParts(); });
project.history.onChange = refreshHeader;

let saving = false;
async function save() {
  if (saving || !project.set) return;
  if (!project.dirty) { toast("Nothing to save", "info"); return; }
  saving = true; saveBtn.disabled = true;
  try {
    const backup = await project.save();
    toast(`Saved ${project.set}${backup ? "; previous files in " + backup : ""}`, "ok", 5000);
    parts.refreshSets();
  } catch (e) { toast("Save failed: " + (e as Error).message, "err"); }
  saving = false; saveBtn.disabled = false;
}

window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === "s") { e.preventDefault(); if (active === "rig") rig.save(); else if (active === "area") area.save(); else save(); return; }
  if (typing || document.querySelector(".modal-back")) return;
  if (active === "area" && !(e.altKey && /^[1-5]$/.test(e.key))) { if (area.onKey(e)) e.preventDefault(); return; }
  if (active === "rig" && !(e.altKey && /^[1-5]$/.test(e.key))) { if (rig.onKey(e)) e.preventDefault(); return; }
  if (active === "draw" && mod) return;    // inside Draw, undo belongs to the editor (focus it by clicking the canvas)
  if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); project.undo(); return; }
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); project.redo(); return; }
  if (mod) return;
  if (e.altKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); showTab(TABS[Number(e.key) - 1][0]); return; }
  if (active !== "parts") return;
  if (k === "+" || k === "=") parts.view.zoomAt(parts.view.zoom + 1);
  else if (k === "-") parts.view.zoomAt(parts.view.zoom - 1);
  else if (k === "0") parts.view.fit();
  else if (k === "g") { parts.view.grid = !parts.view.grid; parts.view.render(); }
  else if (k === "arrowdown" || k === "arrowup") {
    const i = project.order.indexOf(project.selected) + (k === "arrowdown" ? 1 : -1);
    if (i >= 0 && i < project.order.length) { e.preventDefault(); project.selected = project.order[i]; project.emit("select"); }
  }
});
window.addEventListener("keyup", (e) => { if (active === "area" && e.key === " ") area.onKey(e); });
window.addEventListener("beforeunload", (e) => { if (project.dirty || rig.dirty || area.dirty) { e.preventDefault(); e.returnValue = ""; } });

(async () => {
  try {
    const [info, pal] = await Promise.all([api.info(), api.palettes()]);
    palette = pal.hero;
    if (pal.heroError) palNote.textContent = "Recolour unavailable: " + pal.heroError;
    rootNote.textContent = info.sameRoot ? "" : "scratch root";
    rootNote.title = info.root;
    parts.paletteChanged();
    await Promise.all([parts.init(), compare.init(), rig.init(), area.init()]);
    const tab = localStorage.getItem("lab.tab") as TabId | null;
    if (tab && panes.has(tab)) showTab(tab);
    refreshHeader();
    document.body.dataset.ready = "1";
  } catch (e) {
    toast("Lab failed to start: " + (e as Error).message, "err", 20000);
  }
})();
