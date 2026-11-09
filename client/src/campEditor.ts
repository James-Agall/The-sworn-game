// campEditor.ts: the creative-mode camp editor (ROADMAP "Bandit camp templates"). A floating panel opened from the
// Creative panel's World tab: paint the template grid (tiles / props, guard / prisoner / loot slots, the hearth) in
// a 9x9 to 31x31 square, set its metadata (tier, weight, min start distance, guard range, entrance, rotate /
// mirror), rotate / mirror the draft, see its stats and validation live, then Save it as a user template, Load /
// Duplicate / Delete templates, or "Stamp here" (the draft, at the next map click) to test it. Messages:
// creativeSet campList / campSave / campDelete / campStamp (creative games only); answers come as creativeResult.
import {
  CAMP_LEGEND, type CampEntrance, type CampTemplate, campStats, transformEntrance, transformRows, validateCampTemplate,
} from "@colony/shared/camps";

export interface CampEditorDeps {
  send(msg: object): void;
  toast(ok: boolean, text: string): void;
  // Calls fn with the world px of the next left-click on the map.
  pickPoint(fn: (x: number, y: number) => void): void;
}

const SIZES = [9, 11, 13, 15, 17, 19, 21, 25, 31];
const CANVAS_PX = 434;

const CSS = `
#camp-editor { position: fixed; top: 52px; left: 12px; z-index: 61; width: 470px; max-height: calc(100vh - 80px); overflow-y: auto;
  background: #ead9b0; color: #3b2a14; border: 2px solid #7a5a2a; border-radius: 6px; box-shadow: 0 4px 18px rgba(0,0,0,.45);
  font: 13px/1.35 Georgia, serif; padding: 8px 10px; }
#camp-editor[hidden] { display: none; }
#camp-editor h3 { margin: 2px 0 6px; font-size: 15px; display: flex; justify-content: space-between; }
#camp-editor button { font: inherit; background: #d8c08a; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 4px; padding: 2px 7px; cursor: pointer; }
#camp-editor button:hover { background: #e9d39f; }
#camp-editor button.on { background: #7a5a2a; color: #f6ecd2; }
#camp-editor select, #camp-editor input { font: inherit; background: #f6ecd2; color: #3b2a14; border: 1px solid #7a5a2a; border-radius: 3px; }
#camp-editor input[type=number] { width: 52px; }
#camp-editor .ce-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
#camp-editor .ce-row > span:first-child { min-width: 58px; font-weight: bold; }
#camp-editor .ce-pal button { padding: 1px 5px; font-size: 12px; }
#camp-editor .ce-pal i { display: inline-block; width: 10px; height: 10px; margin-right: 3px; border: 1px solid #3b2a14; vertical-align: -1px; }
#camp-editor canvas { display: block; margin: 6px auto; background: #c9d6a0; cursor: crosshair; image-rendering: pixelated; }
#camp-editor .ce-errs { color: #9a1c1c; font-size: 12px; margin: 2px 0 0 16px; padding: 0; }
#camp-editor .ce-ok { color: #2a6a2a; font-size: 12px; }
`;

function blankRows(n: number): string[] {
  const rows = Array.from({ length: n }, () => ".".repeat(n));
  const c = n >> 1;
  rows[c] = rows[c].slice(0, c) + "H" + rows[c].slice(c + 1);
  return rows;
}

function newDraft(): CampTemplate {
  return { id: "my-camp", name: "My camp", tier: 1, weight: 2, minStartDist: 0, guards: [2, 3], entrance: "S", rotate: true, mirror: true, rows: blankRows(11) };
}

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

export function setupCampEditor(deps: CampEditorDeps) {
  let draft = newDraft();
  let templates: CampTemplate[] = [];
  let brush = "#";
  let painting: string | null = null;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const panel = document.createElement("div");
  panel.id = "camp-editor";
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
    const r = el("div", "", { class: "ce-row" });
    r.append(el("span", label), ...items);
    return r;
  };
  const num = (min: number, max: number) => el("input", "", { type: "number", min: String(min), max: String(max) });

  // ---- header + template list ----
  const title = el("h3");
  title.append(el("span", "Camp editor"), button("×", () => (panel.hidden = true)));
  const list = el("select");
  list.style.maxWidth = "270px";
  const refresh = () => deps.send({ type: "creativeSet", op: "campList", quiet: true });
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
      load({ ...t, id, name: `${t.name} (copy)`.slice(0, 40), builtin: undefined });
    }),
    button("Delete", () => {
      const t = selected();
      if (!t) return;
      if (t.builtin) return deps.toast(false, "Built-in templates can't be deleted");
      if (window.confirm(`Delete camp template "${t.name}" (${t.id})?`)) deps.send({ type: "creativeSet", op: "campDelete", id: t.id });
    }),
    button("New", () => load(newDraft())),
  ));

  // ---- metadata ----
  const idIn = el("input", "", { type: "text", size: "16" });
  const nameIn = el("input", "", { type: "text", size: "18", maxlength: "40" });
  const tierIn = el("select");
  for (const t of [1, 2, 3]) tierIn.append(el("option", `Tier ${t}`, { value: String(t) }));
  const weightIn = num(0, 100);
  const distIn = num(0, 400);
  const gMin = num(1, 24);
  const gMax = num(1, 24);
  const entIn = el("select");
  for (const e of ["N", "E", "S", "W"]) entIn.append(el("option", e, { value: e }));
  const rotIn = el("input", "", { type: "checkbox" });
  const mirIn = el("input", "", { type: "checkbox" });
  const sizeIn = el("select");
  for (const n of SIZES) sizeIn.append(el("option", `${n}x${n}`, { value: String(n) }));
  panel.append(
    row("Id", idIn, el("span", "Name"), nameIn),
    row("Tier", tierIn, el("span", "weight"), weightIn, el("span", "min dist"), distIn),
    row("Guards", gMin, el("span", "to"), gMax, el("span", "entrance"), entIn),
    row("World-gen", el("label", "may rotate "), rotIn, el("label", "may mirror "), mirIn),
  );
  const readMeta = () => {
    draft.id = idIn.value.trim();
    draft.name = nameIn.value;
    draft.tier = Number(tierIn.value);
    draft.weight = Number(weightIn.value);
    draft.minStartDist = Number(distIn.value);
    draft.guards = [Math.round(Number(gMin.value)), Math.round(Number(gMax.value))];
    draft.entrance = entIn.value as CampEntrance;
    draft.rotate = rotIn.checked;
    draft.mirror = mirIn.checked;
    redraw();
  };
  for (const i of [idIn, nameIn, weightIn, distIn, gMin, gMax]) i.addEventListener("input", readMeta);
  for (const i of [tierIn, entIn, rotIn, mirIn]) i.addEventListener("change", readMeta);
  const writeMeta = () => {
    idIn.value = draft.id;
    nameIn.value = draft.name;
    tierIn.value = String(draft.tier);
    weightIn.value = String(draft.weight);
    distIn.value = String(draft.minStartDist);
    gMin.value = String(draft.guards[0]);
    gMax.value = String(draft.guards[1]);
    entIn.value = draft.entrance;
    rotIn.checked = draft.rotate;
    mirIn.checked = draft.mirror;
    const n = Math.max(draft.rows.length, draft.rows[0]?.length ?? 0);
    if (!SIZES.includes(n)) sizeIn.append(el("option", `${n}x${n}`, { value: String(n) }));
    sizeIn.value = String(n);
  };

  // ---- grid tools ----
  const transform = (tf: number) => {
    draft.rows = transformRows(draft.rows, tf);
    draft.entrance = transformEntrance(draft.entrance, tf);
    entIn.value = draft.entrance;
    redraw();
  };
  sizeIn.addEventListener("change", () => {
    draft.rows = resizeRows(draft.rows, Number(sizeIn.value));
    redraw();
  });
  panel.append(row("Grid", sizeIn,
    button("Rotate ↻", () => transform(1), "Turn the draft a quarter clockwise"),
    button("Mirror ⇋", () => transform(4), "Flip the draft left-right"),
    button("Clear", () => {
      draft.rows = blankRows(Number(sizeIn.value));
      redraw();
    }),
  ));
  const pal = el("div", "", { class: "ce-row ce-pal" });
  const palBtns: HTMLButtonElement[] = [];
  for (const [ch, sym] of Object.entries(CAMP_LEGEND)) {
    const b = button("", () => {
      brush = ch;
      palBtns.forEach((o) => o.classList.toggle("on", o.dataset.ch === ch));
    }, `${sym.label} ("${ch}")`);
    b.dataset.ch = ch;
    const sw = el("i");
    sw.style.background = sym.color;
    b.append(sw, ch === "." ? "Erase" : sym.label.replace(/ \(.*\)$/, "").replace("Guard: ", ""));
    b.classList.toggle("on", ch === brush);
    palBtns.push(b);
    pal.append(b);
  }
  panel.append(pal, el("div", "Left-drag paints the chosen brush, right-drag erases. Placing H moves the hearth.", { class: "ce-row" }));

  const canvas = el("canvas");
  const ctx = canvas.getContext("2d")!;
  panel.append(canvas);
  const stats = el("div", "", { class: "ce-row" });
  const errs = el("ul", "", { class: "ce-errs" });
  panel.append(stats, errs);
  panel.append(row("",
    button("Save", () => {
      readMeta();
      const problems = validateCampTemplate(draft);
      if (problems.length > 0) return deps.toast(false, `Not saved: ${problems[0]}`);
      if (templates.some((t) => t.id === draft.id && t.builtin)) return deps.toast(false, "That id is a built-in: change the id (or Duplicate)");
      deps.send({ type: "creativeSet", op: "campSave", template: { ...draft, builtin: undefined } });
    }, "Save as a user template (server/data/camps/user/<id>.json)"),
    button("Stamp here", () => {
      readMeta();
      const problems = validateCampTemplate(draft);
      if (problems.length > 0) return deps.toast(false, `Can't stamp: ${problems[0]}`);
      const t = { ...draft, builtin: undefined };
      deps.pickPoint((x, y) => deps.send({ type: "creativeSet", op: "campStamp", template: t, x, y }));
    }, "Stamp the draft with its hearth on your next map click"),
  ));
  const where = el("div", "", { class: "ce-row" });
  where.style.fontSize = "12px";
  panel.append(where);

  const cellPx = () => Math.max(10, Math.min(28, Math.floor(CANVAS_PX / Math.max(draft.rows.length, draft.rows[0]?.length ?? 1))));
  function redraw() {
    const cs = cellPx();
    const h = draft.rows.length;
    const w = draft.rows[0]?.length ?? 0;
    // A 10px apron around the grid for the entrance marker.
    const pad = 10;
    canvas.width = w * cs + pad * 2;
    canvas.height = h * cs + pad * 2;
    ctx.fillStyle = "#ead9b0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${Math.max(8, cs - 6)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = draft.rows[y][x];
      const sym = CAMP_LEGEND[ch];
      ctx.fillStyle = sym?.color ?? "#ff00ff";
      ctx.fillRect(pad + x * cs, pad + y * cs, cs, cs);
      ctx.strokeStyle = "rgba(59,42,20,.25)";
      ctx.strokeRect(pad + x * cs + 0.5, pad + y * cs + 0.5, cs - 1, cs - 1);
      if (ch !== ".") {
        ctx.fillStyle = sym?.slot ? "#ffffff" : "#2a1d0c";
        ctx.fillText(ch, pad + x * cs + cs / 2, pad + y * cs + cs / 2 + 1);
      }
    }
    // Entrance arrow on the chosen side.
    ctx.fillStyle = "#7a1c1c";
    const ew = canvas.width;
    const eh = canvas.height;
    const tri = (pts: number[]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      ctx.lineTo(pts[2], pts[3]);
      ctx.lineTo(pts[4], pts[5]);
      ctx.fill();
    };
    if (draft.entrance === "N") tri([ew / 2 - 8, 0, ew / 2 + 8, 0, ew / 2, pad]);
    if (draft.entrance === "S") tri([ew / 2 - 8, eh, ew / 2 + 8, eh, ew / 2, eh - pad]);
    if (draft.entrance === "W") tri([0, eh / 2 - 8, 0, eh / 2 + 8, pad, eh / 2]);
    if (draft.entrance === "E") tri([ew, eh / 2 - 8, ew, eh / 2 + 8, ew - pad, eh / 2]);
    const st = campStats(draft);
    stats.textContent = `${st.w}x${st.h}, radius ${st.radius} · guard slots ${st.guardSlots} (stamps ${draft.guards[0]}-${Math.min(draft.guards[1], st.guardSlots)}) · prisoners ${st.prisonerSlots} · loot chests ${st.lootSlots}`;
    const problems = validateCampTemplate(draft);
    errs.replaceChildren(...problems.map((p) => el("li", p)));
    if (problems.length === 0) errs.replaceChildren(el("span", "Valid: ready to save / stamp", { class: "ce-ok" }));
  }

  const cellAt = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const cs = cellPx();
    const x = Math.floor((e.clientX - rect.left - 10) / cs);
    const y = Math.floor((e.clientY - rect.top - 10) / cs);
    return x >= 0 && y >= 0 && y < draft.rows.length && x < draft.rows[0].length ? { x, y } : null;
  };
  const paint = (e: MouseEvent) => {
    const c = cellAt(e);
    if (!c || painting === null) return;
    const set = (x: number, y: number, ch: string) => (draft.rows[y] = draft.rows[y].slice(0, x) + ch + draft.rows[y].slice(x + 1));
    if (draft.rows[c.y][c.x] === painting) return;
    if (painting === "H") draft.rows.forEach((r, y) => r.includes("H") && set(r.indexOf("H"), y, "."));
    set(c.x, c.y, painting);
    redraw();
  };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    painting = e.button === 2 ? "." : brush;
    paint(e);
  });
  canvas.addEventListener("mousemove", paint);
  window.addEventListener("mouseup", () => (painting = null));

  function load(t: CampTemplate) {
    draft = { ...t, guards: [t.guards[0], t.guards[1]], rows: t.rows.slice(), builtin: undefined };
    writeMeta();
    redraw();
  }

  function setList(next: CampTemplate[], select?: string) {
    templates = next;
    const keep = select ?? list.value;
    list.replaceChildren(...templates.map((t) => el("option", `${t.name} · T${t.tier} w${t.weight} ${t.builtin ? "[built-in]" : "[user]"}`, { value: t.id })));
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
    // creativeResult of a camp* op. True: the toast is not wanted (a quiet list refresh).
    onResult(m: { op: string; ok: boolean; text: string; templates?: unknown; userDir?: unknown; id?: unknown; quiet?: unknown }): boolean {
      if (Array.isArray(m.templates)) setList(m.templates as CampTemplate[], typeof m.id === "string" && m.op === "campSave" ? m.id : undefined);
      if (typeof m.userDir === "string") where.textContent = `User templates are saved to ${m.userDir}`;
      return m.op === "campList" && m.ok && m.quiet === true;
    },
  };
}
