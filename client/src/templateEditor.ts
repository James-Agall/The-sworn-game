// templateEditor.ts: a creative-mode grid template editor, the camp editor's (campEditor.ts) layout and behaviour made
// generic: a floating panel with the template list (Load / Duplicate / Delete / New), metadata fields, a paintable
// ASCII grid (left-drag paints the brush, right-drag erases), rotate / mirror, live stats and validation, Save (user
// template) and "Stamp here" (the next map click). Used for building templates (buildingEditor.ts) and settlement
// templates (settlementEditor.ts). Messages: creativeSet <key>List / <key>Save / <key>Delete / <key>Stamp (creative
// games only); answers come as creativeResult.
export interface EditorDeps {
  send(msg: object): void;
  toast(ok: boolean, text: string): void;
  // Calls fn with the world px of the next left-click on the map.
  pickPoint(fn: (x: number, y: number) => void, hint: string): void;
}

export interface EditorField {
  key: string;
  label: string;
  kind: "text" | "number" | "select" | "check" | "json";
  options?: string[];
  min?: number;
  max?: number;
}

export interface EditorTemplate {
  id: string;
  name: string;
  rows: string[];
  builtin?: boolean;
}

export interface EditorHooks<T extends EditorTemplate> {
  // Extra controls under the palette (e.g. the settlement editor's building picker); `redraw` repaints.
  controls?(api: EditorApi<T>): HTMLElement[];
  // A grid click / drag cell; true = handled (no symbol painted). `button` 0 left, 2 right.
  cell?(d: T, x: number, y: number, button: number, start: boolean): boolean;
  // Drawn over the grid cells.
  drawOver?(ctx: CanvasRenderingContext2D, d: T, cs: number, pad: number): void;
  // Every creativeResult the editor sees (e.g. the building list the settlement picker needs).
  result?(m: Record<string, unknown>): void;
}

export interface EditorApi<T> {
  draft(): T;
  redraw(): void;
  el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs?: Record<string, string>): HTMLElementTagNameMap[K];
  button(text: string, onClick: () => void, title?: string): HTMLButtonElement;
  setBrush(ch: string): void;
  brush(): string;
}

export interface EditorConfig<T extends EditorTemplate> {
  // Op prefix ("building" -> buildingList / buildingSave / ...) and panel id suffix.
  key: string;
  title: string;
  legend: Record<string, { label: string; color: string; slot?: unknown }>;
  sizes: number[];
  brush: string;
  fields: EditorField[];
  newDraft(): T;
  blankRows(n: number): string[];
  validate(d: T): string[];
  stats(d: T): string;
  // Rotate / mirror the draft's rows (and fix its metadata, e.g. the door side); omit to hide the buttons.
  transform?(d: T, tf: number): void;
  listLabel(t: T): string;
  stampHint: string;
  hooks?: EditorHooks<T>;
}

const CANVAS_PX = 434;

let cssDone = false;
const CSS = `
.tpl-editor { position: fixed; top: 52px; left: 12px; z-index: 61; width: 470px; max-height: calc(100vh - 80px); overflow-y: auto;
  background: #ead9b0; color: #3b2a14; border: 2px solid #7a5a2a; border-radius: 6px; box-shadow: 0 4px 18px rgba(0,0,0,.45);
  font: 13px/1.35 Georgia, serif; padding: 8px 10px; }
.tpl-editor[hidden] { display: none; }
.tpl-editor h3 { margin: 2px 0 6px; font-size: 15px; display: flex; justify-content: space-between; }
.tpl-editor button { font: inherit; background: #d8c08a; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 4px; padding: 2px 7px; cursor: pointer; }
.tpl-editor button:hover { background: #e9d39f; }
.tpl-editor button.on { background: #7a5a2a; color: #f6ecd2; }
.tpl-editor select, .tpl-editor input { font: inherit; background: #f6ecd2; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 3px; }
.tpl-editor input[type=number] { width: 52px; }
.tpl-editor .te-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
.tpl-editor .te-row > span:first-child { min-width: 58px; font-weight: bold; }
.tpl-editor .te-pal button { padding: 1px 5px; font-size: 12px; }
.tpl-editor .te-pal i { display: inline-block; width: 10px; height: 10px; margin-right: 3px; border: 1px solid #3b2a14; vertical-align: -1px; }
.tpl-editor canvas { display: block; margin: 6px auto; background: #c9d6a0; cursor: crosshair; image-rendering: pixelated; }
.tpl-editor .te-errs { color: #9a1c1c; font-size: 12px; margin: 2px 0 0 16px; padding: 0; }
.tpl-editor .te-ok { color: #2a6a2a; font-size: 12px; }
`;

// The rows padded / cropped to n x n around the grid's centre.
function resizeRows(rows: string[], n: number): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const ox = (n - w) >> 1;
  const oy = (n - h) >> 1;
  const out: string[] = [];
  for (let y = 0; y < n; y++) {
    let r = "";
    for (let x = 0; x < n; x++) r += rows[y - oy]?.[x - ox] ?? ".";
    out.push(r);
  }
  return out;
}

export function setupTemplateEditor<T extends EditorTemplate>(cfg: EditorConfig<T>, deps: EditorDeps) {
  let draft = cfg.newDraft();
  let templates: T[] = [];
  let brush = cfg.brush;
  let painting: string | null = null;
  let paintButton = 0;

  if (!cssDone) {
    cssDone = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
  }
  const panel = document.createElement("div");
  panel.className = "tpl-editor";
  panel.id = `${cfg.key}-editor`;
  panel.hidden = true;
  document.body.append(panel);
  panel.addEventListener("keydown", (e) => e.stopPropagation());

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const button = (text: string, onClick: () => void, title = "") => {
    const b = el("button", text, { type: "button", ...(title ? { title } : {}) });
    b.addEventListener("click", () => {
      b.blur();
      onClick();
    });
    return b;
  };
  const row = (label: string, ...items: HTMLElement[]) => {
    const r = el("div", "", { class: "te-row" });
    r.append(el("span", label), ...items);
    return r;
  };
  const op = (name: string) => `${cfg.key}${name}`;
  const clean = (t: T): T => ({ ...JSON.parse(JSON.stringify(t)), builtin: undefined });

  // ---- header + template list ----
  const title = el("h3");
  title.append(el("span", cfg.title), button("×", () => (panel.hidden = true)));
  const list = el("select");
  list.style.maxWidth = "290px";
  const refresh = () => deps.send({ type: "creativeSet", op: op("List"), quiet: true });
  const selected = () => templates.find((t) => t.id === list.value);
  panel.append(title, row("Templates", list, button("↻", refresh, "Refresh the list")));
  panel.append(row("",
    button("Load", () => {
      const t = selected();
      if (t) load(t);
    }),
    button("Duplicate", () => {
      const t = selected();
      if (!t) return;
      let id = `${t.id}-copy`;
      for (let i = 2; templates.some((o) => o.id === id); i++) id = `${t.id}-copy${i}`;
      load({ ...clean(t), id, name: `${t.name} (copy)`.slice(0, 40) });
    }),
    button("Delete", () => {
      const t = selected();
      if (!t) return;
      if (t.builtin) return deps.toast(false, "Built-in templates can't be deleted");
      if (window.confirm(`Delete template "${t.name}" (${t.id})?`)) deps.send({ type: "creativeSet", op: op("Delete"), id: t.id });
    }),
    button("New", () => load(cfg.newDraft())),
  ));

  // ---- metadata ----
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const rec = () => draft as unknown as Record<string, unknown>;
  let metaRow: HTMLElement[] = [];
  for (const f of cfg.fields) {
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.kind === "select") {
      input = el("select");
      for (const o of f.options ?? []) input.append(el("option", o, { value: o }));
    } else if (f.kind === "check") input = el("input", "", { type: "checkbox" });
    else if (f.kind === "number") input = el("input", "", { type: "number", ...(f.min !== undefined ? { min: String(f.min) } : {}), ...(f.max !== undefined ? { max: String(f.max) } : {}) });
    else input = el("input", "", { type: "text", size: f.kind === "json" ? "34" : "16" });
    inputs.set(f.key, input);
    input.addEventListener(f.kind === "select" || f.kind === "check" ? "change" : "input", () => readMeta());
    metaRow.push(el("span", f.label), input);
    if (metaRow.length >= 6 || f.kind === "json") {
      panel.append(row("", ...metaRow));
      metaRow = [];
    }
  }
  if (metaRow.length) panel.append(row("", ...metaRow));
  const readMeta = () => {
    for (const f of cfg.fields) {
      const i = inputs.get(f.key)!;
      if (f.kind === "check") rec()[f.key] = (i as HTMLInputElement).checked;
      else if (f.kind === "number") rec()[f.key] = Number(i.value);
      else if (f.kind === "json") {
        try {
          rec()[f.key] = JSON.parse(i.value);
        } catch {
          // Keep the last good value until the text parses.
        }
      } else rec()[f.key] = f.key === "id" ? i.value.trim() : i.value;
    }
    redraw();
  };
  const sizeIn = el("select");
  for (const n of cfg.sizes) sizeIn.append(el("option", `${n}x${n}`, { value: String(n) }));
  const writeMeta = () => {
    for (const f of cfg.fields) {
      const i = inputs.get(f.key)!;
      const v = rec()[f.key];
      if (f.kind === "check") (i as HTMLInputElement).checked = v === true;
      else if (f.kind === "json") i.value = JSON.stringify(v ?? null);
      else i.value = String(v ?? "");
    }
    const n = Math.max(draft.rows.length, draft.rows[0]?.length ?? 0);
    if (!Array.from(sizeIn.options).some((o) => o.value === String(n))) sizeIn.append(el("option", `${n}x${n}`, { value: String(n) }));
    sizeIn.value = String(n);
  };

  // ---- grid tools ----
  sizeIn.addEventListener("change", () => {
    draft.rows = resizeRows(draft.rows, Number(sizeIn.value));
    redraw();
  });
  const gridTools: HTMLElement[] = [sizeIn];
  if (cfg.transform) {
    const tf = (k: number) => {
      cfg.transform!(draft, k);
      writeMeta();
      redraw();
    };
    gridTools.push(button("Rotate ↻", () => tf(1), "Turn the draft a quarter clockwise"), button("Mirror ⇋", () => tf(4), "Flip the draft left-right"));
  }
  gridTools.push(button("Clear", () => {
    draft.rows = cfg.blankRows(Number(sizeIn.value));
    redraw();
  }));
  panel.append(row("Grid", ...gridTools));
  const pal = el("div", "", { class: "te-row te-pal" });
  const palBtns: HTMLButtonElement[] = [];
  const setBrush = (ch: string) => {
    brush = ch;
    palBtns.forEach((o) => o.classList.toggle("on", o.dataset.ch === ch));
  };
  for (const [ch, sym] of Object.entries(cfg.legend)) {
    const b = button("", () => setBrush(ch), `${sym.label} ("${ch}")`);
    b.dataset.ch = ch;
    const sw = el("i");
    sw.style.background = sym.color;
    b.append(sw, ch === "." ? "Erase" : sym.label.replace(/ \(.*\)$/, ""));
    b.classList.toggle("on", ch === brush);
    palBtns.push(b);
    pal.append(b);
  }
  panel.append(pal, el("div", "Left-drag paints the chosen brush, right-drag erases.", { class: "te-row" }));
  const api: EditorApi<T> = { draft: () => draft, redraw: () => redraw(), el, button, setBrush, brush: () => brush };
  for (const c of cfg.hooks?.controls?.(api) ?? []) panel.append(c);

  const canvas = el("canvas");
  const ctx = canvas.getContext("2d")!;
  panel.append(canvas);
  const stats = el("div", "", { class: "te-row" });
  const errs = el("ul", "", { class: "te-errs" });
  panel.append(stats, errs);
  panel.append(row("",
    button("Save", () => {
      readMeta();
      const problems = cfg.validate(draft);
      if (problems.length > 0) return deps.toast(false, `Not saved: ${problems[0]}`);
      if (templates.some((t) => t.id === draft.id && t.builtin)) return deps.toast(false, "That id is a built-in: change the id (or Duplicate)");
      deps.send({ type: "creativeSet", op: op("Save"), template: clean(draft) });
    }, `Save as a user template`),
    button("Stamp here", () => {
      readMeta();
      const problems = cfg.validate(draft);
      if (problems.length > 0) return deps.toast(false, `Can't stamp: ${problems[0]}`);
      const t = clean(draft);
      deps.pickPoint((x, y) => deps.send({ type: "creativeSet", op: op("Stamp"), template: t, x, y }), cfg.stampHint);
    }, cfg.stampHint),
  ));
  const where = el("div", "", { class: "te-row" });
  where.style.fontSize = "12px";
  panel.append(where);

  const cellPx = () => Math.max(10, Math.min(28, Math.floor(CANVAS_PX / Math.max(draft.rows.length, draft.rows[0]?.length ?? 1))));
  const PAD = 6;
  function redraw() {
    const cs = cellPx();
    const h = draft.rows.length;
    const w = draft.rows[0]?.length ?? 0;
    canvas.width = w * cs + PAD * 2;
    canvas.height = h * cs + PAD * 2;
    ctx.fillStyle = "#ead9b0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${Math.max(8, cs - 6)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = draft.rows[y][x];
      const sym = cfg.legend[ch];
      ctx.fillStyle = sym?.color ?? "#ff00ff";
      ctx.fillRect(PAD + x * cs, PAD + y * cs, cs, cs);
      ctx.strokeStyle = "rgba(59,42,20,.25)";
      ctx.strokeRect(PAD + x * cs + 0.5, PAD + y * cs + 0.5, cs - 1, cs - 1);
      if (ch !== ".") {
        ctx.fillStyle = sym?.slot ? "#ffffff" : "#2a1d0c";
        ctx.fillText(ch, PAD + x * cs + cs / 2, PAD + y * cs + cs / 2 + 1);
      }
    }
    cfg.hooks?.drawOver?.(ctx, draft, cs, PAD);
    stats.textContent = cfg.stats(draft);
    const problems = cfg.validate(draft);
    errs.replaceChildren(...problems.slice(0, 8).map((p) => el("li", p)));
    if (problems.length === 0) errs.replaceChildren(el("span", "Valid: ready to save / stamp", { class: "te-ok" }));
  }

  const cellAt = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const cs = cellPx();
    const x = Math.floor((e.clientX - rect.left - PAD) / cs);
    const y = Math.floor((e.clientY - rect.top - PAD) / cs);
    return x >= 0 && y >= 0 && y < draft.rows.length && x < draft.rows[0].length ? { x, y } : null;
  };
  const paint = (e: MouseEvent, start: boolean) => {
    const c = cellAt(e);
    if (!c || painting === null) return;
    if (cfg.hooks?.cell?.(draft, c.x, c.y, paintButton, start)) {
      redraw();
      return;
    }
    if (draft.rows[c.y][c.x] === painting) return;
    draft.rows[c.y] = draft.rows[c.y].slice(0, c.x) + painting + draft.rows[c.y].slice(c.x + 1);
    redraw();
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    paintButton = e.button;
    painting = e.button === 2 ? "." : brush;
    paint(e, true);
  });
  canvas.addEventListener("mousemove", (e) => paint(e, false));
  window.addEventListener("mouseup", () => (painting = null));

  function load(t: T) {
    draft = clean(t);
    writeMeta();
    redraw();
  }

  function setList(next: T[], select?: string) {
    templates = next;
    const keep = select ?? list.value;
    list.replaceChildren(...templates.map((t) => el("option", `${cfg.listLabel(t)} ${t.builtin ? "[built-in]" : "[user]"}`, { value: t.id })));
    if (templates.some((t) => t.id === keep)) list.value = keep;
  }

  load(draft);

  return {
    open() {
      panel.hidden = false;
      refresh();
    },
    hide() {
      panel.hidden = true;
    },
    // creativeResult of one of this editor's ops. True: the toast is not wanted (a quiet list refresh).
    onResult(m: Record<string, unknown> & { op: string; ok: boolean }): boolean {
      cfg.hooks?.result?.(m);
      if (!m.op.startsWith(cfg.key)) return false;
      if (Array.isArray(m.templates)) setList(m.templates as T[], typeof m.id === "string" && m.op === op("Save") ? m.id : undefined);
      if (typeof m.userDir === "string") where.textContent = `User templates are saved to ${m.userDir}`;
      return m.op === op("List") && m.ok && m.quiet === true;
    },
  };
}
