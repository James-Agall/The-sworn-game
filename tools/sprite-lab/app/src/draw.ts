// Draw tab: the vendored Piskel editor (tools/sprite-lab/piskel-dist, served at /piskel/) in a same-origin iframe, driven
// through its Lab bridge (vendor/piskel/src/js/lab-bridge.ts). Open a part (optionally with a neighbour as a faint
// reference layer), draw, "Send back to Parts" writes the PNG into the set (size follows the image, pivot kept).
import { isPartName } from "../../shared/names.ts";
import { project } from "./project.ts";
import { blank, fetchPNG, toCanvas, type RGBA } from "./png.ts";
import { ask, confirmBox, el, toast } from "./ui.ts";

/** Body parts are drawn x1.08 into body.html's frame, which the game shows at 0.255 (98 px source body -> 25 px). */
export const PART_GAME_FACTOR = 1.08 * 0.255, SPRITE_GAME_FACTOR = 0.255;
const REF_SPRITE = "autumn/frames/heroes/base-05.png";

type Reply = { ok: boolean; error?: string; w?: number; h?: number; data?: Uint8ClampedArray };
type Editing = { name: string; isNew: boolean; w: number; h: number } | null;

export class DrawBridge {
  iframe: HTMLIFrameElement;
  ready: Promise<void>;
  private seq = 0;
  private waiting = new Map<number, (r: Reply) => void>();
  onChanged: () => void = () => {};
  constructor(parent: HTMLElement) {
    this.iframe = el("iframe", { class: "piskel", id: "piskel-frame", title: "Draw (based on Piskel)" });
    let markReady!: () => void;
    this.ready = new Promise((r) => (markReady = r));
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || e.source !== this.iframe.contentWindow) return;
      const m = e.data as { type: string; id?: number } & Reply;
      if (m.type === "lab:ready") markReady();
      else if (m.type === "lab:changed") this.onChanged();
      else if (m.type === "lab:reply" && m.id !== undefined) { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); }
    });
    parent.append(this.iframe);
  }
  load() { if (!this.iframe.src) this.iframe.src = "/piskel/index.html"; }
  async call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Reply> {
    this.load();
    await this.ready;
    const id = ++this.seq;
    const p = new Promise<Reply>((resolve, reject) => {
      this.waiting.set(id, resolve);
      setTimeout(() => { if (this.waiting.delete(id)) reject(new Error("the editor did not answer")); }, 8000);
    });
    this.iframe.contentWindow!.postMessage({ ...msg, id }, location.origin, transfer);
    const r = await p;
    if (!r.ok) throw new Error(r.error || "editor error");
    return r;
  }
  async open(name: string, img: RGBA, ref: RGBA | null) {
    const data = new Uint8ClampedArray(img.data), rd = ref ? new Uint8ClampedArray(ref.data) : null;
    await this.call({ type: "lab:open", name, w: img.w, h: img.h, data, ref: ref ? { w: ref.w, h: ref.h, data: rd } : null }, rd ? [data.buffer, rd.buffer] : [data.buffer]);
  }
  async get(): Promise<RGBA> { const r = await this.call({ type: "lab:get" }); return { w: r.w!, h: r.h!, data: r.data! }; }
  async setPreview(size: string) { await this.call({ type: "lab:set-preview", size }); }
}

/** Copy `ref` into a w x h image so that its pivot lands on `pivot` (neighbour parts line up at the joint). */
function alignRef(ref: RGBA, refPivot: [number, number], w: number, h: number, pivot: [number, number]): RGBA {
  const out = blank(w, h), dx = Math.round(pivot[0] - refPivot[0]), dy = Math.round(pivot[1] - refPivot[1]);
  for (let y = 0; y < ref.h; y++) for (let x = 0; x < ref.w; x++) {
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
    out.data.set(ref.data.subarray((y * ref.w + x) * 4, (y * ref.w + x) * 4 + 4), (ty * w + tx) * 4);
  }
  return out;
}

export function mountDraw(root: HTMLElement, ctx: { isActive: () => boolean; showParts: () => void }) {
  const partSel = el("select", { id: "draw-part", title: "Part of the open set" });
  const refSel = el("select", { id: "draw-ref", title: "Faint reference layer (aligned at the pivot), not saved" });
  const prevSel = el("select", { id: "draw-preview-size", title: "Size of the editor's own animated preview" },
    ...[["original", "preview 1:1"], ["best", "preview best fit"], ["full", "preview full"]].map(([v, t]) => el("option", { value: v, text: t })));
  const info = el("span", { class: "draw-info", id: "draw-info", text: "Nothing open: pick a part and press Edit." });
  const sendBtn = el("button", { class: "primary", id: "send-back", text: "Send back to Parts", title: "Write the drawing into the set (PNG + manifest size; pivot kept) and save", disabled: true, onclick: () => sendBack() });
  const toolbar = el("div", { class: "toolbar" },
    el("span", { class: "lbl", text: "Part" }), partSel,
    el("button", { id: "draw-edit", text: "Edit this part in Draw", onclick: () => open(partSel.value) }),
    el("span", { class: "lbl", text: "Reference" }), refSel,
    el("button", { id: "draw-new", text: "New part", title: "Blank canvas (default 32x32, pivot at centre-bottom)", onclick: () => newPart() }),
    el("span", { class: "sep" }), sendBtn, el("span", { class: "sep" }), prevSel, info);
  const frameBox = el("div", { class: "piskel-box" });
  const strip = el("canvas", { id: "draw-strip", class: "game-strip", width: 250, height: 560 });
  const side = el("aside", { class: "panel right narrow" }, el("h4", { text: "In-game size" }), strip,
    el("p", { class: "hint", text: `Part x${PART_GAME_FACTOR.toFixed(3)} (body.html x1.08, game x0.255) beside the hero sprite ${REF_SPRITE} at x0.255, on grass, at 1x / 2x / 4x.` }));
  root.append(el("div", { class: "draw-tab" }, el("section", { class: "center" }, toolbar, frameBox), side));
  const bridge = new DrawBridge(frameBox);
  let editing: Editing = null, changed = false, refSprite: RGBA | null = null;
  fetchPNG("/sprites/" + REF_SPRITE).then((r) => { refSprite = r; drawStrip(null); }).catch(() => {});

  function fillSelects() {
    const keep = partSel.value || project.selected, keepRef = refSel.value;
    partSel.replaceChildren(...project.order.map((n) => el("option", { value: n, text: n, selected: n === keep })));
    refSel.replaceChildren(el("option", { value: "", text: "none" }), ...project.order.map((n) => el("option", { value: n, text: n, selected: n === keepRef })));
  }
  project.on((why) => { if (why !== "pivot" && why !== "joint") fillSelects(); });
  prevSel.addEventListener("change", () => bridge.setPreview(prevSel.value).catch((e) => toast(e.message, "err")));
  bridge.onChanged = () => { if (editing) { changed = true; showInfo(); refreshStrip(); } };

  function showInfo() {
    info.textContent = editing ? `${editing.isNew ? "new part" : "editing"} ${editing.name} (${editing.w}x${editing.h})${changed ? ": changed, not sent back" : ""}` : "Nothing open.";
    sendBtn.disabled = !editing;
  }
  async function guard(): Promise<boolean> {
    return !(editing && changed) || confirmBox(`Discard the drawing of ${editing.name}? It was not sent back.`, "Discard");
  }
  async function open(name: string) {
    const p = project.part(name), img = project.image(name);
    if (!p || !img) return toast("pick a part of the open set first", "err");
    if (!(await guard())) return;
    try {
      const refName = refSel.value, rp = refName ? project.part(refName) : undefined, ri = refName ? project.image(refName) : undefined;
      const ref = rp && ri && refName !== name ? alignRef(ri, rp.pivot, img.w, img.h, p.pivot) : null;
      await bridge.open(name, img, ref);
      editing = { name, isNew: false, w: img.w, h: img.h }; changed = false;
      partSel.value = name;
      showInfo(); refreshStrip();
    } catch (e) { toast("Draw: " + (e as Error).message, "err"); }
  }
  async function newPart() {
    if (!project.set) return toast("open a set in the Parts tab first", "err");
    const v = await ask("New part (drawn in Draw)", [
      { key: "name", label: "Part name", hint: "family[.variant], e.g. foreArm.t4" },
      { key: "w", label: "Width", type: "number", value: 32 }, { key: "h", label: "Height", type: "number", value: 32 },
    ], "Create");
    if (!v) return;
    const name = String(v.name).trim(), w = Math.round(v.w), h = Math.round(v.h);
    if (!isPartName(name) || name in project.manifest.parts) return toast(`bad or existing name: ${name}`, "err");
    if (!(w >= 1 && h >= 1 && w <= 512 && h <= 512)) return toast("size must be 1..512", "err");
    if (!(await guard())) return;
    try { await bridge.open(name, blank(w, h), null); editing = { name, isNew: true, w, h }; changed = false; showInfo(); refreshStrip(); }
    catch (e) { toast("Draw: " + (e as Error).message, "err"); }
  }
  async function sendBack() {
    if (!editing) return;
    const ed = editing;
    try {
      const img = await bridge.get();
      if (ed.isNew) project.edit("add", () => project.addPart(ed.name, img, { pivot: [img.w / 2, img.h] }));
      else if (!project.part(ed.name)) throw new Error(`${ed.name} is no longer in the set`);
      else project.edit("image", () => project.setImage(ed.name, img));
      project.selected = ed.name;
      const backup = await project.save();
      editing = { ...ed, isNew: false, w: img.w, h: img.h }; changed = false; showInfo();
      toast(`Saved ${ed.name}.png into ${project.set}${backup ? " (old files in " + backup + ")" : ""}`, "ok", 5000);
    } catch (e) { toast("Send back failed: " + (e as Error).message, "err"); }
  }

  let stripBusy = false;
  async function refreshStrip() {
    if (stripBusy || !editing) return;
    stripBusy = true;
    try { drawStrip(await bridge.get()); } catch { /* editor busy */ }
    stripBusy = false;
  }
  function scaled(src: HTMLCanvasElement, f: number) {
    const c = el("canvas", { width: Math.max(1, Math.round(src.width * f)), height: Math.max(1, Math.round(src.height * f)) }), g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function drawStrip(img: RGBA | null) {
    const g = strip.getContext("2d")!;
    g.fillStyle = "#1b1e24"; g.fillRect(0, 0, strip.width, strip.height);
    const part = img ? scaled(toCanvas(img), PART_GAME_FACTOR) : null, hero = refSprite ? scaled(toCanvas(refSprite), SPRITE_GAME_FACTOR) : null;
    let y = 8;
    for (const z of [1, 2, 4]) {
      const ph = Math.max(part?.height || 0, hero?.height || 0) * z + 12;
      g.fillStyle = "#6f8d4e"; g.fillRect(4, y, strip.width - 8, ph);
      g.imageSmoothingEnabled = false;
      let x = 10;
      if (hero) { g.drawImage(hero, x, y + ph - 6 - hero.height * z, hero.width * z, hero.height * z); x += hero.width * z + 8; }
      if (part) g.drawImage(part, x, y + ph - 6 - part.height * z, part.width * z, part.height * z);
      g.fillStyle = "#fff"; g.font = "11px system-ui, sans-serif"; g.fillText(`${z}x`, strip.width - 26, y + 14);
      y += ph + 8;
    }
  }

  return {
    async open(name: string) { bridge.load(); fillSelects(); await open(name); },
    activate() { bridge.load(); fillSelects(); },
    bridge,
  };
}
