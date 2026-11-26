// Area tab, stage B kinds: the metadata editors (every field the game's validators know) and the POI pool form.
// Ordered lists (names, garrison, centrepieces, extras, guardian weights, spawn fractions) keep their order and can be
// reordered by drag or the arrows: world-gen draws from them in order, so ORDER MATTERS (the panel says so).
// Each change goes through ctx.set (one undo step, a built-in asks to be duplicated first); the tab re-renders.
import * as A from "../../../shared/area.ts";
import { el } from "../ui.ts";
import { drawable, tileArt } from "./art.ts";
import { propArt } from "./interior.ts";

type O = Record<string, any>;
export type FormCtx = { kind: A.DataKind; t: O; layer: string; set: (fn: (o: O) => void) => void; readOnly: boolean };

const field = (label: string, input: HTMLElement, hint?: string) => el("label", { class: "area-field" }, el("span", { text: label }), input, hint ? el("small", { text: hint }) : null);
const sec = (title: string, ...kids: (HTMLElement | null)[]) => el("div", { class: "area-sub" }, el("h5", { text: title }), ...kids);
const note = (text: string, cls = "hint") => el("p", { class: cls, text });

function text(ctx: FormCtx, key: string, label: string, opts: { hint?: string; optional?: boolean; readonly?: boolean } = {}) {
  const i = el("input", { type: "text", value: String(ctx.t[key] ?? ""), "data-key": key, readonly: !!opts.readonly,
    onchange: () => ctx.set((o) => { const v = i.value.trim(); if (opts.optional && !v) delete o[key]; else o[key] = v; }) });
  return field(label, i, opts.hint);
}
function select(ctx: FormCtx, key: string, label: string, options: [string, string][], numeric = false, hint?: string) {
  const cur = String(ctx.t[key]);
  const s = el("select", { "data-key": key, onchange: () => ctx.set((o) => { o[key] = numeric ? Number(s.value) : s.value; }) },
    ...options.map(([v, l]) => el("option", { value: v, text: l, selected: v === cur })));
  return field(label, s, hint);
}
function pair(ctx: FormCtx, key: string, label: string, lo: number, hi: number, hint?: string) {
  const v = Array.isArray(ctx.t[key]) ? ctx.t[key] : [0, 0];
  const mk = (k: 0 | 1) => {
    const i = el("input", { type: "number", min: lo, max: hi, value: String(v[k]), "data-key": `${key}${k}`, onchange: () => ctx.set((o) => { o[key] = [...o[key]]; o[key][k] = Number(i.value); }) });
    return i;
  };
  return el("label", { class: "area-field" }, el("span", { text: label }), el("span", { class: "row tight" }, mk(0), "to", mk(1)), hint ? el("small", { text: hint }) : null);
}

/** Drag + arrows reordering of a list (the rows are `.area-li` with data-i). */
function orderable(list: HTMLElement, move: (from: number, to: number) => void) {
  let from = -1;
  list.addEventListener("dragstart", (e) => { const li = (e.target as HTMLElement).closest(".area-li") as HTMLElement | null; if (!li) return; from = Number(li.dataset.i); e.dataTransfer!.effectAllowed = "move"; e.dataTransfer!.setData("text/plain", String(from)); });
  list.addEventListener("dragover", (e) => { if (from >= 0) e.preventDefault(); });
  list.addEventListener("drop", (e) => {
    const li = (e.target as HTMLElement).closest(".area-li") as HTMLElement | null;
    if (!li || from < 0) return;
    e.preventDefault();
    const to = Number(li.dataset.i);
    if (to !== from) move(from, to);
    from = -1;
  });
}
const moved = <T>(a: T[], from: number, to: number) => { const b = a.slice(); const [x] = b.splice(from, 1); b.splice(to, 0, x); return b; };

function tileIcon(name: string): HTMLCanvasElement {
  const c = el("canvas", { width: 24, height: 24 }) as HTMLCanvasElement, g = c.getContext("2d")!;
  g.fillStyle = "#4d6338"; g.fillRect(0, 0, 24, 24);
  const t = A.tileByName(name), spec = t !== undefined ? tileArt(t) : null, src = spec && drawable(spec);
  if (src) g.drawImage(src, 0, 0, 24, 24);
  else { g.fillStyle = t === undefined ? "#ff3030" : A.swatchFor(name); g.fillRect(4, 4, 16, 16); }
  return c;
}
const tileList = el("datalist", { id: "area-tile-names" }, ...A.TILE_NAMES.map((n) => el("option", { value: n })));
document.body.append(tileList);

/** An ordered list of tile names (POI centrepieces / extras). */
function tileListEditor(ctx: FormCtx, key: string, title: string, hint: string) {
  const items: string[] = Array.isArray(ctx.t[key]) ? ctx.t[key] : [];
  const list = el("div", { class: "area-ol", "data-list": key });
  items.forEach((n, i) => list.append(el("div", { class: "area-li", draggable: "true", "data-i": String(i) },
    el("span", { class: "grip", text: "⋮⋮", title: "drag to reorder" }), el("span", { class: "ix", text: String(i + 1) }), tileIcon(n), el("code", { text: n }),
    el("span", { class: "grow" }),
    el("button", { text: "▲", title: "move up", disabled: i === 0, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i - 1); }) }),
    el("button", { text: "▼", title: "move down", disabled: i === items.length - 1, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i + 1); }) }),
    el("button", { text: "✕", title: "remove", "data-remove": String(i), onclick: () => ctx.set((o) => { o[key] = o[key].filter((_: string, k: number) => k !== i); }) }))));
  orderable(list, (a, b) => ctx.set((o) => { o[key] = moved(o[key], a, b); }));
  const add = el("input", { type: "text", list: "area-tile-names", placeholder: "TileType name, e.g. RuinStatue", "data-add": key });
  const addBtn = el("button", { text: "Add", onclick: () => { const v = add.value.trim(); if (v) ctx.set((o) => { o[key] = [...(o[key] ?? []), v]; }); } });
  return sec(title, note(hint), list, el("div", { class: "row tight" }, add, addBtn));
}

/** An ordered list of { kind, weight } (guardian weights). */
function weightedEditor(ctx: FormCtx, key: string, title: string) {
  const items: A.WeightedKind[] = Array.isArray(ctx.t[key]) ? ctx.t[key] : [];
  const total = items.reduce((a, g) => a + (Number(g.weight) || 0), 0);
  const list = el("div", { class: "area-ol", "data-list": key });
  items.forEach((g, i) => {
    const kind = el("select", { "data-key": `${key}.${i}.kind`, onchange: () => ctx.set((o) => { o[key] = o[key].map((x: A.WeightedKind, k: number) => (k === i ? { ...x, kind: kind.value } : x)); }) },
      ...[...new Set([g.kind, ...A.MOB_KINDS])].map((m) => el("option", { value: m, text: m, selected: m === g.kind })));
    const w = el("input", { type: "number", min: 0.1, max: 1000, step: 0.5, value: String(g.weight), "data-key": `${key}.${i}.weight`, onchange: () => ctx.set((o) => { o[key] = o[key].map((x: A.WeightedKind, k: number) => (k === i ? { ...x, weight: Number(w.value) } : x)); }) });
    list.append(el("div", { class: "area-li", draggable: "true", "data-i": String(i) },
      el("span", { class: "grip", text: "⋮⋮" }), el("span", { class: "ix", text: String(i + 1) }), kind, w,
      el("span", { class: "dim", text: total > 0 ? Math.round((100 * g.weight) / total) + "%" : "" }), el("span", { class: "grow" }),
      el("button", { text: "▲", disabled: i === 0, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i - 1); }) }),
      el("button", { text: "▼", disabled: i === items.length - 1, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i + 1); }) }),
      el("button", { text: "✕", onclick: () => ctx.set((o) => { o[key] = o[key].filter((_: unknown, k: number) => k !== i); }) })));
  });
  orderable(list, (a, b) => ctx.set((o) => { o[key] = moved(o[key], a, b); }));
  const add = el("select", { "data-add": key }, ...A.MOB_KINDS.map((m) => el("option", { value: m, text: m })));
  return sec(title, note("Weighted pick, tried in list order: the order is part of the seeded draw."), list,
    el("div", { class: "row tight" }, add, el("button", { text: "Add", onclick: () => ctx.set((o) => { o[key] = [...(o[key] ?? []), { kind: add.value, weight: 1 }]; }) })));
}

/** name -> count maps (garrison: mob kinds in spawn order; workers / stock / rebuild cost: fixed key sets). */
function countMapEditor(ctx: FormCtx, key: string, title: string, keys: readonly string[], opts: { ordered?: boolean; optional?: boolean; hint?: string } = {}) {
  const map: Record<string, number> = ctx.t[key] && typeof ctx.t[key] === "object" ? ctx.t[key] : {};
  const entries = Object.entries(map);
  const setMap = (fn: (e: [string, number][]) => [string, number][]) => ctx.set((o) => {
    const next = fn(Object.entries(o[key] ?? {}) as [string, number][]);
    if (opts.optional && next.length === 0) delete o[key]; else o[key] = Object.fromEntries(next);
  });
  const list = el("div", { class: "area-ol", "data-list": key });
  entries.forEach(([k, n], i) => {
    const num = el("input", { type: "number", min: 0, max: 10000, value: String(n), "data-key": `${key}.${k}`, onchange: () => setMap((e) => e.map(([a, b]) => [a, a === k ? Number(num.value) : b])) });
    list.append(el("div", { class: "area-li", draggable: opts.ordered ? "true" : false, "data-i": String(i) },
      opts.ordered ? el("span", { class: "grip", text: "⋮⋮" }) : null, el("code", { text: k }), el("span", { class: "grow" }), num,
      opts.ordered ? el("button", { text: "▲", disabled: i === 0, onclick: () => setMap((e) => moved(e, i, i - 1)) }) : null,
      opts.ordered ? el("button", { text: "▼", disabled: i === entries.length - 1, onclick: () => setMap((e) => moved(e, i, i + 1)) }) : null,
      el("button", { text: "✕", onclick: () => setMap((e) => e.filter(([a]) => a !== k)) })));
  });
  if (opts.ordered) orderable(list, (a, b) => setMap((e) => moved(e, a, b)));
  const free = keys.filter((k) => !(k in map));
  const add = el("select", { "data-add": key }, ...free.map((k) => el("option", { value: k, text: k })));
  return sec(title, opts.hint ? note(opts.hint) : null, list,
    free.length ? el("div", { class: "row tight" }, add, el("button", { text: "Add", onclick: () => setMap((e) => [...e, [add.value, 1]]) })) : null);
}

/** symbol -> TileType name (a site's own `symbols`, the castle's `tiles`). */
function symbolMapEditor(ctx: FormCtx, key: string, title: string, reserved: string[], opts: { optional?: boolean; hint?: string; preset?: [string, Record<string, string>] } = {}) {
  const map: Record<string, string> = ctx.t[key] && typeof ctx.t[key] === "object" ? ctx.t[key] : {};
  const setMap = (fn: (e: [string, string][]) => [string, string][]) => ctx.set((o) => {
    const next = fn(Object.entries(o[key] ?? {}) as [string, string][]);
    if (opts.optional && next.length === 0) delete o[key]; else o[key] = Object.fromEntries(next);
  });
  const list = el("div", { class: "area-ol", "data-list": key });
  for (const [c, name] of Object.entries(map)) {
    const i = el("input", { type: "text", list: "area-tile-names", value: name, "data-key": `${key}.${c}`, onchange: () => setMap((e) => e.map(([a, b]) => [a, a === c ? i.value.trim() : b])) });
    list.append(el("div", { class: "area-li" }, el("code", { class: "sym", text: c }), tileIcon(name), i, el("button", { text: "✕", onclick: () => setMap((e) => e.filter(([a]) => a !== c)) })));
  }
  const sym = el("input", { type: "text", maxlength: 1, placeholder: "symbol", style: "width:60px", "data-add-sym": key });
  const tile = el("input", { type: "text", list: "area-tile-names", placeholder: "TileType name", "data-add-tile": key });
  const add = el("button", { text: "Add", onclick: () => {
    const c = sym.value, n = tile.value.trim();
    if ([...c].length !== 1 || reserved.includes(c) || !n) return;
    setMap((e) => [...e.filter(([a]) => a !== c), [c, n]]);
  } });
  const preset = opts.preset ? el("button", { text: opts.preset[0], onclick: () => ctx.set((o) => { o[key] = { ...opts.preset![1] }; }) }) : null;
  return sec(title, opts.hint ? note(opts.hint) : null, list, el("div", { class: "row tight wrap" }, sym, tile, add, preset));
}

function numberList(ctx: FormCtx, key: string, title: string, hint: string) {
  const items: number[] = Array.isArray(ctx.t[key]) ? ctx.t[key] : [];
  const list = el("div", { class: "area-ol", "data-list": key });
  items.forEach((v, i) => {
    const n = el("input", { type: "number", min: 0.01, max: 0.99, step: 0.01, value: String(v), "data-key": `${key}.${i}`, onchange: () => ctx.set((o) => { o[key] = o[key].map((x: number, k: number) => (k === i ? Number(n.value) : x)); }) });
    list.append(el("div", { class: "area-li", draggable: "true", "data-i": String(i) }, el("span", { class: "grip", text: "⋮⋮" }), el("span", { class: "ix", text: String(i + 1) }), n, el("span", { class: "grow" }),
      el("button", { text: "▲", disabled: i === 0, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i - 1); }) }),
      el("button", { text: "▼", disabled: i === items.length - 1, onclick: () => ctx.set((o) => { o[key] = moved(o[key], i, i + 1); }) }),
      el("button", { text: "✕", onclick: () => ctx.set((o) => { o[key] = o[key].filter((_: number, k: number) => k !== i); }) })));
  });
  orderable(list, (a, b) => ctx.set((o) => { o[key] = moved(o[key], a, b); }));
  return sec(title, note(hint), list, el("button", { text: "Add", onclick: () => ctx.set((o) => { o[key] = [...(o[key] ?? []), 0.2]; }) }));
}

const HUMAN_PRESET: Record<string, string> = Object.fromEntries(Object.entries(A.HUMAN_SITE_SYMBOLS).map(([c, t]) => [c, A.TileType[t]]));

/** The right-panel metadata editor of a stage B document. */
export function dataMeta(ctx: FormCtx): HTMLElement[] {
  const t = ctx.t, out: HTMLElement[] = [];
  if (ctx.kind === "sites") {
    out.push(text(ctx, "id", "Id", { hint: "a-z 0-9 - _, max 48 = the file name" }));
    out.push(select(ctx, "faction", "Faction", A.SITE_FACTIONS.map((f) => [f, f])));
    out.push(text(ctx, "label", "Label", { hint: "\"Palisade\" / \"Stockade\": the site is \"<name> <label>\"; \"\" for human profiles" }));
    out.push(text(ctx, "noun", "Noun", { optional: true, hint: "the sighting toast (\"village\"); empty = none" }));
    const names = el("textarea", { rows: 4, "data-key": "names", onchange: () => ctx.set((o) => { o.names = names.value.split("\n").map((s) => s.trim()).filter(Boolean); }) });
    names.value = (Array.isArray(t.names) ? t.names : []).join("\n");
    out.push(field("Names", names, "one per line, in pick order (the first unused name is taken)"));
    const tiers: [string, string][] = Array.from({ length: A.SITE_MAX_TIER }, (_, k) => [String(k + 1), String(k + 1)]);
    out.push(select(ctx, "maxTier", "Max tier", tiers, true, "the grid shows the site at this tier"));
    out.push(select(ctx, "startTier", "Start tier", tiers, true, "1..max tier"));
    out.push(countMapEditor(ctx, "garrison", "Garrison (at the start tier)", A.MOB_KINDS, { ordered: true, hint: "mob kind -> count, spawned in this order (at least one)" }));
    out.push(countMapEditor(ctx, "workers", "Workers (cosmetic)", A.SITE_WORKER_ROLES, { optional: true }));
    out.push(countMapEditor(ctx, "stock", "Stock", A.SITE_RESOURCE_KEYS));
    out.push(countMapEditor(ctx, "rebuildCost", "Rebuild cost (the keep)", A.SITE_RESOURCE_KEYS));
    out.push(symbolMapEditor(ctx, "symbols", "Own symbols (over SITE_TEMPLATE_TILES)", ["."], { optional: true, hint: "symbol -> TileType name; human sites use the stone-wall / house set", preset: ["Human set", HUMAN_PRESET] }));
  } else if (ctx.kind === "castle-ruins") {
    out.push(text(ctx, "id", "Id", { hint: "a-z 0-9 - _, max 48 = the file name" }));
    out.push(select(ctx, "boss", "Boss", A.MOB_KINDS.map((m) => [m, m]), false, "spawns on \"B\" (the centre), the Ogre Warlord today"));
    out.push(pair(ctx, "guardians", "Guardians", 0, 48, "min-max, on the inner open cells"));
    out.push(numberList(ctx, "spawnDistFractions", "Spawn distances", "Minimum distance from the Town Center as a fraction of the map width (0-1), tried in this order."));
    out.push(weightedEditor(ctx, "guardianWeights", "Guardian weights"));
    out.push(symbolMapEditor(ctx, "tiles", "Tiles (symbol -> TileType)", [".", "B"], { hint: "\".\" open ground and \"B\" the boss are fixed" }));
  } else if (ctx.kind === "pois") {
    out.push(text(ctx, "id", "Id", { hint: "a-z 0-9 - _, max 48 = the file name" }));
    out.push(note("The pool is edited in the middle panel."));
  } else {
    const f = t as A.InteriorFile;
    out.push(text(ctx, "id", "Building type", { readonly: true, hint: "one file per building type (no new types: those need code)" }));
    const sleep = el("input", { type: "checkbox", "data-key": "sleep", onchange: () => ctx.set((o) => { o.sleep = sleep.checked; }) });
    sleep.checked = !!f.sleep;
    out.push(el("label", { class: "check area-check" }, sleep, "sleep: your own one is a bed you sleep in"));
    const req = new Set(Array.isArray(f.required) ? f.required : []);
    const box = el("div", { class: "area-props", "data-list": "required" });
    for (const p of A.INTERIOR_PROPS) {
      const locked = f.id === "hall" && (A.HALL_REQUIRED_PROPS as readonly string[]).includes(p);
      const c = el("input", { type: "checkbox", "data-prop": p, disabled: locked, onchange: () => ctx.set((o) => { o.required = c.checked ? [...o.required, p] : o.required.filter((x: string) => x !== p); }) });
      c.checked = req.has(p);
      box.append(el("label", { class: "check", title: locked ? "the Town Center hall keeps throne / table / chest" : "" }, c, p + (locked ? " (hall)" : "")));
    }
    out.push(sec("Required stations (every ground-floor layout)", f.id === "hall" ? note("Hall: throne, table and chest are locked (the Town Center hall's chest is its storage).", "warn-text") : null, box));
    const l = A.interiorLayout(f, ctx.layer);
    if (l) {
      const where = ctx.layer === "upper" ? "upstairs" : "variant " + Number(ctx.layer.slice(1));
      const setL = (fn: (x: O) => void) => ctx.set((o) => { const x = ctx.layer === "upper" ? o.upper : o.variants[Number(ctx.layer.slice(1))]; fn(x); });
      const label = el("input", { type: "text", value: l.label, "data-key": "layout.label", onchange: () => setL((x) => { x.label = label.value; }) });
      const floor = el("select", { "data-key": "layout.floor", onchange: () => setL((x) => { x.floor = floor.value; }) }, ...["wood", "stone", "dirt"].map((v) => el("option", { value: v, text: v, selected: v === l.floor })));
      const wall = el("select", { "data-key": "layout.wall", onchange: () => setL((x) => { x.wall = wall.value; }) }, ...["wood", "stone"].map((v) => el("option", { value: v, text: v, selected: v === l.wall })));
      out.push(sec("This layout (" + where + ")", field("Label", label), field("Floor", floor), field("Wall", wall)));
    }
  }
  return out;
}

/** The POI pool form (middle panel). */
export function poiForm(ctx: FormCtx): HTMLElement {
  return el("div", { class: "area-form", id: "area-poi-form" },
    el("p", { class: "warn-text area-order", text: "ORDER MATTERS: world-gen draws from these lists in order on the seeded stream (centrepiece, extra count, neighbours, extras, guardian count, spots, weighted kinds). Reordering a BUILT-IN pool would change every world." }),
    el("div", { class: "area-cols" },
      el("div", {},
        tileListEditor(ctx, "centerpieces", "Centrepieces", "The centre tile: one of these (with exactly one entry no random draw is made)."),
        tileListEditor(ctx, "extras", "Extras", "Decorations on the centre's 8 neighbours."),
        pair(ctx, "extraCount", "Extra count", 0, 8, "min-max (at most the 8 neighbours)")),
      el("div", {},
        pair(ctx, "guardianCount", "Guardian count", 0, 24, "min-max, dormant, next to the decorations"),
        weightedEditor(ctx, "guardians", "Guardians"),
        select(ctx, "footprintRadius", "Footprint radius", Array.from({ length: A.POI_FOOTPRINT_RADIUS_MAX }, (_, k) => [String(k + 1), String(k + 1)]), true, "the guardian ring (world-gen keeps radius 2 clear)"))));
}

/** A palette icon for an interior symbol (its prop's game art, or the swatch). */
export function interiorIcon(s: A.LegendSymbol, ch: string): HTMLCanvasElement {
  const c = el("canvas", { width: 28, height: 28 }) as HTMLCanvasElement, g = c.getContext("2d")!;
  g.fillStyle = ch === " " ? "#050505" : ch === "#" ? "#553319" : "#8f5f30"; g.fillRect(0, 0, 28, 28);
  const spec = s.prop ? propArt(s.prop) : null, src = spec && drawable(spec);
  if (src) { const iw = (src as HTMLImageElement).naturalWidth || 28, ih = (src as HTMLImageElement).naturalHeight || 28, k = Math.min(28 / iw, 28 / ih); g.drawImage(src, (28 - iw * k) / 2, 28 - ih * k, iw * k, ih * k); }
  else if (s.npc || ch === "E" || s.prop) { g.fillStyle = s.color; g.beginPath(); g.arc(14, 14, 9, 0, 7); g.fill(); }
  return c;
}
