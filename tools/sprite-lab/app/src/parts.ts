// Parts tab: pick a set, list parts, edit pivot / joint (bone length) on a zoomed pixel view, edit the manifest fields,
// draw order (lab.json), recolour with the game's skin / hair ramps, import a PNG or a whole sheet (repo slicer),
// and see the assembled body from rig/body.html at the in-game size.
import type { HeroPalette } from "../../shared/recolour.ts";
import { recolour } from "../../shared/recolour.ts";
import { boneDir, isPartName } from "../../shared/names.ts";
import { api } from "./api.ts";
import { PixelView } from "./pixelview.ts";
import { project } from "./project.ts";
import { cloneImg, fileToImg, toBase64, toCanvas, type RGBA } from "./png.ts";
import { RigFrame, GAME_W, GAME_H, type Look } from "./rigframe.ts";
import { ask, confirmBox, el, toast } from "./ui.ts";

export type PartsCtx = { palette: () => HeroPalette | null; openInDraw: (name: string) => void; isActive: () => boolean };

export function mountParts(root: HTMLElement, ctx: PartsCtx) {
  const setSel = el("select", { id: "set-select", title: "Part set (client/public/rig/parts/<set>/)" });
  const list = el("ul", { class: "part-list", id: "part-list" });
  const btn = (text: string, title: string, fn: () => void, id?: string) => el("button", { text, title, onclick: fn, id });
  const left = el("aside", { class: "panel left" },
    el("div", { class: "row" }, el("label", { class: "grow" }, el("span", { class: "lbl", text: "Set" }), setSel), btn("New set", "Create a part set (blank or a copy)", () => newSet())),
    el("div", { class: "row wrap tight" },
      btn("Add", "Add a blank part", () => addPart()), btn("Duplicate", "Duplicate the selected part", () => duplicate()),
      btn("Rename", "Rename the selected part", () => rename()), btn("Delete", "Delete the selected part (its PNG is backed up on save)", () => del()),
      btn("Up", "Move earlier in the draw order (further back)", () => move(-1)), btn("Down", "Move later in the draw order (further front)", () => move(1))),
    el("div", { class: "row wrap tight" },
      btn("Import PNG", "Replace the selected part's pixels with a PNG (pivot kept)", () => importPng()),
      btn("Import sheet", "Slice a generated sheet with a layout from scripts/rig-layouts", () => importSheet())),
    el("p", { class: "hint", text: "Draw order (lab.json): first = back. Drag to reorder." }),
    list);

  // ---- centre: pixel view + tools
  const viewWrap = el("div", { class: "view-wrap" }), status = el("div", { class: "statusbar" });
  const zoomLbl = el("span", { class: "zoomlbl", text: "8x" });
  const gridChk = el("input", { type: "checkbox", checked: true, title: "Pixel grid (G)" });
  const skinRow = el("span", { class: "swatches", title: "Skin colour (heroRig.ts SKIN_COLORS)" }), hairRow = el("span", { class: "swatches", title: "Hair colour (heroRig.ts HAIR_COLORS)" });
  const farChk = el("input", { type: "checkbox", title: "Far-side darkening (x0.78)" }), prevChk = el("input", { type: "checkbox", id: "recolour-preview", title: "Show the recoloured part" });
  let skin = 1, hair = 1;
  const toolbar = el("div", { class: "toolbar" },
    btn("-", "Zoom out (-)", () => view.zoomAt(view.zoom - 1)), zoomLbl, btn("+", "Zoom in (+)", () => view.zoomAt(view.zoom + 1)), btn("Fit", "Fit (0)", () => view.fit()),
    el("label", { class: "check" }, gridChk, el("span", { text: "Grid" })),
    el("span", { class: "sep" }),
    el("span", { class: "lbl", text: "Recolour" }), el("span", { class: "lbl small", text: "skin" }), skinRow, el("span", { class: "lbl small", text: "hair" }), hairRow,
    el("label", { class: "check" }, farChk, el("span", { text: "far" })), el("label", { class: "check" }, prevChk, el("span", { text: "preview" })),
    btn("Bake", "Write the recoloured pixels into this part (undoable)", () => bake()),
    el("span", { class: "sep" }),
    btn("Edit this part in Draw", "Open the selected part in the Draw tab", () => project.selected && ctx.openInDraw(project.selected), "edit-in-draw"));
  const center = el("section", { class: "center" }, toolbar, viewWrap, status);
  const view = new PixelView(viewWrap);
  view.onZoom = (z) => (zoomLbl.textContent = z + "x");
  view.onHover = (x, y) => { const p = project.part(); status.textContent = p ? `x ${Math.floor(x)}  y ${Math.floor(y)}   |   pivot ${p.pivot.join(", ")}   len ${p.len ?? 0}   size ${(p.size || []).join("x")}   |   drag the red pivot / yellow joint (Alt+drag: the joint under the pivot; Shift: whole px); wheel zooms, drag empty space pans` : ""; };
  gridChk.addEventListener("change", () => { view.grid = gridChk.checked; view.render(); });

  // ---- right: fields + assembled preview
  const f = {
    name: el("input", { id: "f-name", title: "Part key: family[.variant]" }),
    file: el("input", { id: "f-file", readonly: true }),
    px: el("input", { id: "f-pivot-x", type: "number", step: "0.5" }), py: el("input", { id: "f-pivot-y", type: "number", step: "0.5" }),
    len: el("input", { id: "f-len", type: "number", step: "1", min: "0" }),
    joint: el("input", { id: "f-joint" }), variant: el("input", { id: "f-variant" }),
    scale: el("input", { id: "f-scale", type: "number", step: "0.001", min: "0" }),
    sw: el("input", { id: "f-size-w", type: "number", readonly: true }), sh: el("input", { id: "f-size-h", type: "number", readonly: true }),
  };
  const field = (label: string, ...inputs: HTMLElement[]) => el("label", { class: "field" }, el("span", { text: label }), el("span", { class: "inputs" }, ...inputs));
  const sizeNote = el("small", { class: "warn-text" });
  const form = el("div", { class: "fields" },
    field("Name", f.name), field("File", f.file), field("Pivot x / y", f.px, f.py), field("Bone length", f.len), field("Joint name", f.joint),
    field("Variant", f.variant), field("Scale", f.scale), field("Size (from PNG)", f.sw, f.sh), sizeNote);
  const strip = el("canvas", { class: "game-strip", id: "assembled-strip", width: 300, height: 200 });
  let stripZoom = 2;
  const zoomBtns = [1, 2, 4].map((z) => el("button", { text: z + "x", class: z === stripZoom ? "on" : "", onclick: (e: Event) => { stripZoom = z; zoomBtns.forEach((b) => b.classList.toggle("on", b === e.target)); } }));
  const stateSel = el("select", { title: "Pose" }, ...["walk", "idle", "attack", "walkattack"].map((s) => el("option", { value: s, text: s })));
  const rigBox = el("div", { class: "rig-box" });
  const rigErr = el("p", { class: "warn-text" });
  const right = el("aside", { class: "panel right" },
    el("h4", { text: "Part" }), form,
    el("h4", { text: "Assembled (saved files, rig/body.html)" }),
    el("div", { class: "row tight" }, ...zoomBtns, stateSel, btn("Reload", "Reload the rig page", () => loadRig())),
    strip, rigErr, rigBox);
  const rig = new RigFrame(rigBox);

  root.append(el("div", { class: "parts-tab" }, left, center, right));

  // ---- data -> UI
  function swatches() {
    const pal = ctx.palette();
    skinRow.replaceChildren(...(pal?.skin || []).map((c, i) => el("button", { class: "sw" + (i === skin ? " on" : ""), style: `background:${c}`, title: c, onclick: () => { skin = i; swatches(); showImage(); } })));
    hairRow.replaceChildren(...(pal?.hair || []).map((c, i) => el("button", { class: "sw" + (i === hair ? " on" : ""), style: `background:${c}`, title: c, onclick: () => { hair = i; swatches(); showImage(); } })));
  }
  farChk.addEventListener("change", () => showImage());
  prevChk.addEventListener("change", () => showImage());

  function recoloured(name: string, img: RGBA): RGBA | null {
    const pal = ctx.palette();
    if (!pal) return null;
    const out = cloneImg(img);
    recolour(pal, name, out.data, out.w, out.h, skin, hair, farChk.checked);
    return out;
  }
  function renderList() {
    list.replaceChildren(...project.order.map((name) => {
      const p = project.manifest.parts[name], img = project.images.get(p.file);
      const th = el("canvas", { width: 32, height: 32, class: "thumb" });
      if (img) { const g = th.getContext("2d")!, s = Math.min(32 / img.w, 32 / img.h, 2); g.imageSmoothingEnabled = false; g.drawImage(toCanvas(img), (32 - img.w * s) / 2, (32 - img.h * s) / 2, img.w * s, img.h * s); }
      const li = el("li", { class: name === project.selected ? "sel" : "", draggable: "true", "data-part": name, title: name },
        th, el("span", { class: "nm", text: name }), el("small", { text: img ? `${img.w}x${img.h}` : "missing" }));
      li.addEventListener("click", () => { project.selected = name; project.emit("select"); });
      li.addEventListener("dragstart", (e) => e.dataTransfer!.setData("text/plain", name));
      li.addEventListener("dragover", (e) => e.preventDefault());
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = e.dataTransfer!.getData("text/plain");
        if (!from || from === name) return;
        project.edit("order", () => { const o = project.order.filter((n) => n !== from); o.splice(o.indexOf(name), 0, from); project.order = o; });
      });
      return li;
    }));
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  }
  function renderFields() {
    const p = project.part(), img = project.image();
    for (const i of Object.values(f)) (i as HTMLInputElement).disabled = !p;
    if (!p) { for (const i of Object.values(f)) (i as HTMLInputElement).value = ""; return; }
    const set = (i: HTMLInputElement, v: unknown) => { if (document.activeElement !== i) i.value = v === undefined ? "" : String(v); };
    set(f.name, project.selected); set(f.file, p.file); set(f.px, p.pivot[0]); set(f.py, p.pivot[1]); set(f.len, p.len ?? 0);
    set(f.joint, p.joint ?? ""); set(f.variant, p.variant ?? ""); set(f.scale, p.scale ?? ""); set(f.sw, p.size?.[0]); set(f.sh, p.size?.[1]);
    sizeNote.textContent = img && p.size && (p.size[0] !== img.w || p.size[1] !== img.h) ? `manifest size ${p.size.join("x")} differs from the PNG ${img.w}x${img.h}` : "";
  }
  function showImage(refit = false) {
    const name = project.selected, img = project.image();
    const shown = img && prevChk.checked ? recoloured(name, img) : img;
    view.setImage(shown ? toCanvas(shown) : null, img?.w || 0, img?.h || 0, refit);
    setHandles();
  }
  function setHandles() {
    const name = project.selected, p = project.part();
    if (!p) { view.handles = []; view.overlay = null; view.render(); return; }
    const dir = boneDir(name), snap = (v: number, e: PointerEvent) => (e.shiftKey ? Math.round(v) : Math.round(v * 2) / 2);
    view.overlay = (g, sx, sy) => {
      const x = sx(p.pivot[0]), y = sy(p.pivot[1]), y2 = sy(p.pivot[1] + dir * (p.len || 0));
      g.strokeStyle = "#ffe030"; g.setLineDash([5, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y2); g.stroke(); g.setLineDash([]);
      g.strokeStyle = "rgba(255,48,48,0.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x + 14, y); g.moveTo(x, y - 14); g.lineTo(x, y + 14); g.stroke();
    };
    view.handles = [
      { id: "joint", x: p.pivot[0], y: p.pivot[1] + dir * (p.len || 0), color: "#ffe030", shape: "diamond", label: p.len ? `${p.joint || "joint"} (len ${p.len})` : undefined,
        start: () => project.begin(), drag: (_x, y) => project.live("joint", () => { p.len = Math.max(0, Math.round((y - p.pivot[1]) * dir)); }) },
      { id: "pivot", x: p.pivot[0], y: p.pivot[1], color: "#ff3030", label: p.len ? "pivot" : "pivot = joint (Alt+drag to pull the joint out)",
        start: () => project.begin(), drag: (x, y, e) => project.live("pivot", () => { p.pivot = [snap(x, e), snap(y, e)]; }) },
    ];
    view.render();
  }
  const num = (i: HTMLInputElement) => { const v = Number(i.value); return Number.isFinite(v) ? v : null; };
  f.px.addEventListener("change", () => { const v = num(f.px); if (v != null) project.edit("field", () => { project.part()!.pivot = [v, project.part()!.pivot[1]]; }); });
  f.py.addEventListener("change", () => { const v = num(f.py); if (v != null) project.edit("field", () => { project.part()!.pivot = [project.part()!.pivot[0], v]; }); });
  f.len.addEventListener("change", () => { const v = num(f.len); if (v != null && v >= 0) project.edit("field", () => { project.part()!.len = v; }); });
  f.scale.addEventListener("change", () => { const v = num(f.scale); if (v != null && v > 0) project.edit("field", () => { project.part()!.scale = v; }); });
  f.joint.addEventListener("change", () => project.edit("field", () => { project.part()!.joint = f.joint.value; }));
  f.variant.addEventListener("change", () => project.edit("field", () => { project.part()!.variant = f.variant.value; }));
  f.name.addEventListener("change", () => doRename(project.selected, f.name.value.trim()));

  project.on((why) => {
    if (why === "load" || why === "saved") { renderList(); renderFields(); showImage(true); loadRig(); return; }
    if (why === "pivot" || why === "joint") { renderFields(); setHandles(); return; }
    renderList(); renderFields(); showImage(why === "select");
  });

  // ---- actions
  async function refreshSets(select?: string) {
    const sets = await api.sets();
    setSel.replaceChildren(...sets.map((s) => el("option", { value: s.name, text: `${s.name} (${s.parts})`, selected: s.name === (select || project.set) })));
  }
  setSel.addEventListener("change", async () => {
    if (project.dirty && !(await confirmBox(`Discard unsaved changes in ${project.set}?`, "Discard"))) { setSel.value = project.set; return; }
    await openSet(setSel.value);
  });
  async function openSet(name: string) {
    try { await project.load(name); localStorage.setItem("lab.set", name); } catch (e) { toast(`Cannot open ${name}: ${(e as Error).message}`, "err"); }
  }
  async function newSet() {
    const sets = await api.sets();
    const v = await ask("New part set", [
      { key: "name", label: "Name", hint: "a-z 0-9 _ - (max 41), e.g. grounded-v3" },
      { key: "copyFrom", label: "Start from", type: "select", options: [["", "blank"], ...sets.map((s) => [s.name, "copy of " + s.name] as [string, string])] },
    ], "Create");
    if (!v) return;
    try { const d = await api.createSet(v.name, v.copyFrom || undefined); await refreshSets(d.set); await project.load(d.set, d); toast(`Created ${d.set}`, "ok"); }
    catch (e) { toast((e as Error).message, "err"); }
  }
  async function askName(title: string, value: string): Promise<string | null> {
    const v = await ask(title, [{ key: "name", label: "Part name", value, hint: "family[.variant], e.g. upperArm.t4" }]);
    if (!v) return null;
    const n = String(v.name).trim();
    if (!isPartName(n)) { toast(`"${n}" breaks the naming rule family[.variant]`, "err"); return null; }
    if (n in project.manifest.parts) { toast(`${n} exists already`, "err"); return null; }
    return n;
  }
  async function addPart() {
    const v = await ask("Add a blank part", [
      { key: "name", label: "Part name", hint: "family[.variant]" },
      { key: "w", label: "Width", type: "number", value: 32 }, { key: "h", label: "Height", type: "number", value: 32 },
    ], "Add");
    if (!v) return;
    const n = String(v.name).trim(), w = Math.round(v.w), h = Math.round(v.h);
    if (!isPartName(n) || n in project.manifest.parts) return toast(`bad or existing name: ${n}`, "err");
    if (!(w >= 1 && h >= 1 && w <= 512 && h <= 512)) return toast("size must be 1..512", "err");
    project.edit("add", () => project.addPart(n, { w, h, data: new Uint8ClampedArray(w * h * 4) }));
  }
  async function duplicate() {
    const p = project.part(), img = project.image();
    if (!p || !img) return;
    const n = await askName("Duplicate " + project.selected, project.selected + ".copy");
    if (n) project.edit("add", () => project.addPart(n, img, { ...structuredClone(p), file: n + ".png", variant: p.variant }));
  }
  async function rename() {
    if (!project.selected) return;
    const n = await askName("Rename " + project.selected, project.selected);
    if (n) doRename(project.selected, n);
  }
  function doRename(from: string, to: string) {
    if (from === to) return;
    if (!isPartName(to) || to in project.manifest.parts) { toast(`bad or existing name: ${to}`, "err"); renderFields(); return; }
    project.edit("rename", () => project.renamePart(from, to));
  }
  async function del() {
    if (!project.selected) return;
    if (await confirmBox(`Delete part ${project.selected}? (Undo works until you leave; saving backs up the PNG.)`, "Delete")) project.edit("delete", () => project.deletePart(project.selected));
  }
  function move(d: number) {
    const i = project.order.indexOf(project.selected), j = i + d;
    if (i < 0 || j < 0 || j >= project.order.length) return;
    project.edit("order", () => { const o = [...project.order]; [o[i], o[j]] = [o[j], o[i]]; project.order = o; });
  }
  async function importPng() {
    if (!project.selected) return toast("select a part first", "err");
    const v = await ask(`Import a PNG into ${project.selected}`, [{ key: "file", label: "Image", type: "file", accept: "image/png,image/*" }], "Import");
    if (!v?.file) return;
    try { const img = await fileToImg(v.file); if (img.w > 1024 || img.h > 1024) throw new Error("image larger than 1024 px"); project.edit("image", () => project.setImage(project.selected, img)); toast(`Imported ${img.w}x${img.h}; pivot kept`, "ok"); }
    catch (e) { toast((e as Error).message, "err"); }
  }
  async function importSheet() {
    const layouts = await api.layouts();
    const v = await ask("Import sheet (runs scripts/slice-rig-sheet.mjs)", [
      { key: "file", label: "Sheet PNG", type: "file", accept: "image/png" },
      { key: "layout", label: "Layout (scripts/rig-layouts)", type: "select", options: layouts.map((l) => [l.name, `${l.name} (${l.cells} cells${l.set ? ", set " + l.set : ""})`] as [string, string]) },
      { key: "set", label: "Into set", value: project.set },
      { key: "bg", label: "Background", type: "select", options: [["auto", "auto (remove an opaque background)"], ["none", "none"]] },
      { key: "merge", label: "Merge into the existing manifest", type: "checkbox", value: true, hint: "Note: a merge rewrites manifest.json with a 1-space indent (slicer behaviour)." },
    ], "Slice");
    if (!v?.file) return;
    if (v.set === project.set && project.dirty) return toast("Save or undo your changes in this set first: the slicer writes into the folder.", "err");
    try {
      const sheet = toBase64(new Uint8Array(await (v.file as File).arrayBuffer()));
      const r = await api.slice({ set: v.set, layout: v.layout, sheet, bg: v.bg, merge: !!v.merge });
      await refreshSets(r.set); await project.load(r.set, r);
      toast(`Sliced into ${r.set}${r.backup ? "; old files backed up in " + r.backup : ""}`, "ok", 6000);
    } catch (e) { toast((e as Error).message, "err"); }
  }
  function bake() {
    const img = project.image();
    if (!img) return;
    const out = recoloured(project.selected, img);
    if (!out) return toast("hero palette not available (see the header)", "err");
    project.edit("image", () => project.setImage(project.selected, out));
    prevChk.checked = false;
    showImage();
    toast("Recolour baked into " + project.selected, "ok");
  }

  // ---- assembled preview (saved files)
  async function loadRig() {
    if (!project.set) return;
    rigErr.textContent = "";
    try { await rig.load(project.set); } catch (e) { rigErr.textContent = "rig/body.html: " + (e as Error).message; }
  }
  let t = 0, busy = false;
  setInterval(async () => {
    if (!ctx.isActive() || busy || !project.set || document.hidden) return;
    busy = true;
    try {
      const look: Look = { state: stateSel.value as Look["state"], helm: 0, shield: 0, hair: 1 };
      const { game } = await rig.still(look, t);
      t = (t + 0.1) % 2.4;
      const g = strip.getContext("2d")!, z = stripZoom;
      strip.width = 300; strip.height = GAME_H * 4 + 16;
      g.fillStyle = "#6f8d4e"; g.fillRect(0, 0, strip.width, strip.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(game, 0, 0, GAME_W, GAME_H, 4, 4, GAME_W * z, GAME_H * z);
      g.drawImage(game, 0, 0, GAME_W, GAME_H, strip.width - GAME_W - 4, 4, GAME_W, GAME_H);
      g.fillStyle = "#fff"; g.font = "11px system-ui, sans-serif"; g.fillText(`${z}x`, 6, strip.height - 4); g.fillText("1x", strip.width - 20, GAME_H + 16);
    } catch { /* rigErr shows load errors */ }
    busy = false;
  }, 110);

  return {
    async init() {
      swatches();
      const want = localStorage.getItem("lab.set") || "grounded-v2";
      const sets = await api.sets();
      const first = sets.find((s) => s.name === want)?.name || sets[0]?.name;
      await refreshSets(first);
      if (first) await openSet(first);
    },
    view,
    refreshSets,
    paletteChanged: swatches,
  };
}
