// Compare tab (basic): the assembled body (rig/body.html, saved files) beside real in-game art at the in-game size,
// 1x / 2x / 4x, with a height ruler and grid, plus the validators v1 report for the set.
import type { Report } from "../../shared/validators.ts";
import { api } from "./api.ts";
import { fetchPNG, toCanvas, type RGBA } from "./png.ts";
import { project } from "./project.ts";
import { RigFrame, GAME_W, GAME_H, figureBox, type Look } from "./rigframe.ts";
import { el, toast } from "./ui.ts";
import type { Clip } from "../../shared/clip.ts";
import { DEFAULT_LOOK, drawFrame, loadBody, loadRigCore, loadSkeleton, type Body } from "./rig/render.ts";

const DEFAULT_REF = "autumn/frames/heroes/base-05.png";

export function mountCompare(root: HTMLElement, ctx: { isActive: () => boolean }) {
  const setSel = el("select", { id: "cmp-set" });
  const stateSel = el("select", { id: "cmp-state" }, ...["idle", "walk", "attack", "walkattack"].map((s) => el("option", { value: s, text: s })));
  const helmSel = el("select", { id: "cmp-helm" }, ...[0, 1, 2, 3].map((h) => el("option", { value: String(h), text: h ? "helm " + h : "no helm" })));
  const shieldChk = el("input", { type: "checkbox", id: "cmp-shield" }), hairChk = el("input", { type: "checkbox", id: "cmp-hair", checked: true });
  const timeIn = el("input", { type: "range", id: "cmp-time", min: "0", max: "2.4", step: "0.05", value: "0.3" });
  const clipSel = el("select", { id: "cmp-clip", title: "Pose from a clip (Lab renderer) instead of body.html's built-in states" }, el("option", { value: "", text: "body.html pose" }));
  const phaseIn = el("input", { type: "range", id: "cmp-phase", min: "0", max: "1", step: "0.01", value: "0.25", title: "Clip phase u" });
  const refIn = el("input", { id: "cmp-ref", class: "wide", list: "cmp-refs", value: DEFAULT_REF, title: "Reference sprite under client/public/sprites/" });
  const refList = el("datalist", { id: "cmp-refs" });
  const refScale = el("input", { type: "number", id: "cmp-ref-scale", value: "0.255", step: "0.005", min: "0.05", max: "2", title: "Game scale of the reference (hero frames: 0.255)" });
  const gridChk = el("input", { type: "checkbox", id: "cmp-grid", checked: true });
  const canvas = el("canvas", { id: "cmp-canvas", class: "cmp-canvas" });
  const results = el("div", { class: "validators", id: "validators" });
  const label = (t: string, ...k: HTMLElement[]) => el("label", { class: "inline" }, el("span", { class: "lbl", text: t }), ...k);
  const toolbar = el("div", { class: "toolbar wrap" },
    label("Set", setSel), label("Clip", clipSel), label("u", phaseIn), label("Pose", stateSel), helmSel, el("label", { class: "check" }, shieldChk, el("span", { text: "shield" })),
    el("label", { class: "check" }, hairChk, el("span", { text: "hair" })), label("time", timeIn),
    el("span", { class: "sep" }), label("Reference", refIn, refList), label("scale", refScale), el("label", { class: "check" }, gridChk, el("span", { text: "grid" })),
    el("button", { text: "Refresh", onclick: () => { loadSet(); } }));
  const rigBox = el("div", { class: "hidden-rig" });
  root.append(el("div", { class: "compare-tab" },
    el("section", { class: "center" }, toolbar, el("div", { class: "cmp-wrap" }, canvas), rigBox),
    el("aside", { class: "panel right" }, el("h4", { text: "Validators v1" }), el("p", { class: "hint", text: "Same library as npm run lab:validate (saved files)." }), results)));
  const rig = new RigFrame(rigBox, "rigframe offscreen");
  let ref: RGBA | null = null, refName = "", loadedSet = "";

  async function init() {
    try {
      const refs = await api.refs();
      refList.replaceChildren(...refs.map((r) => el("option", { value: r })));
    } catch (e) { toast("reference list: " + (e as Error).message, "err"); }
  }
  async function fillSets() {
    const sets = await api.sets(), want = setSel.value || project.set;
    setSel.replaceChildren(...sets.map((s) => el("option", { value: s.name, text: s.name, selected: s.name === want })));
  }
  async function loadSet() {
    const set = setSel.value || project.set;
    if (!set) return;
    loadedSet = set;
    bodies.clear();
    results.replaceChildren(el("p", { class: "hint", text: "running validators..." }));
    rig.load(set).then(render, (e) => toast("rig/body.html: " + e.message, "err"));
    try { showReport(await api.validate(set)); } catch (e) { results.replaceChildren(el("p", { class: "warn-text", text: (e as Error).message })); }
  }
  function showReport(r: Report) {
    results.replaceChildren(
      el("p", { class: "summary " + r.level, id: "validator-summary", text: `${r.set}: ${r.level.toUpperCase()}  (${r.counts.pass} pass, ${r.counts.warn} warn, ${r.counts.fail} fail)` }),
      ...r.checks.map((c) => {
        const d = el("details", { class: "check-" + c.level, open: c.level === "fail" },
          el("summary", {}, el("span", { class: "badge " + c.level, text: c.level }), " " + c.title + (c.findings.length ? ` (${c.findings.length})` : "")),
          ...c.findings.slice(0, 60).map((f) => el("div", { class: "finding " + f.level, text: (f.part ? f.part + ": " : "") + f.message })));
        return d;
      }));
  }
  async function loadRef() {
    const name = refIn.value.trim();
    if (name === refName) return;
    refName = name;
    try { ref = await fetchPNG("/sprites/" + name.split("/").map(encodeURIComponent).join("/")); } catch (e) { ref = null; toast("reference: " + (e as Error).message, "err"); }
  }
  let busy = false;
  async function render() {
    if (busy || !loadedSet) return;
    busy = true;
    try {
      await loadRef();
      const look: Look = { state: stateSel.value as Look["state"], helm: Number(helmSel.value), shield: shieldChk.checked ? 1 : 0, hair: hairChk.checked ? 1 : 0 };
      const { game, frame } = clipSel.value ? await clipStill(loadedSet, clipSel.value, Number(phaseIn.value), look) : await rig.still(look, Number(timeIn.value));
      draw(game, frame);
    } catch { /* rig not ready yet */ }
    busy = false;
  }
  function draw(game: HTMLCanvasElement, frame: HTMLCanvasElement) {
    const rs = Number(refScale.value) || 0.255;
    let refG: HTMLCanvasElement | null = null;
    if (ref) {
      refG = el("canvas", { width: Math.max(1, Math.round(ref.w * rs)), height: Math.max(1, Math.round(ref.h * rs)) });
      const g = refG.getContext("2d")!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(toCanvas(ref), 0, 0, refG.width, refG.height);
    }
    const box = figureBox(frame), gs = 0.255, bodyH = box ? (box.bottom - box.top + 1) * gs : 0;
    const refBox = refG ? alphaBox(refG) : null, refH = refBox ? refBox.bottom - refBox.top + 1 : 0;
    const zooms = [1, 2, 4], pad = 16, ruler = 34;
    const colW = zooms.map((z) => (GAME_W + (refG?.width || 0) + 12) * z + pad);
    const H = Math.max(GAME_H, refG?.height || 0) * 4 + 70;
    const wrap = canvas.parentElement!.getBoundingClientRect();
    canvas.width = Math.max(wrap.width - 4, ruler + colW.reduce((a, b) => a + b, 0) + pad);
    canvas.height = Math.max(H + 40, 300);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#1b1e24"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "12px system-ui, sans-serif";
    let x = ruler;
    const base = H - 20;    // ground line for every zoom
    for (const [i, z] of zooms.entries()) {
      const w = colW[i] - pad;
      g.fillStyle = "#6f8d4e"; g.fillRect(x, 24, w, base - 24 + 14);
      if (gridChk.checked && z >= 2) {
        g.strokeStyle = "rgba(0,0,0,0.16)"; g.lineWidth = 1; g.beginPath();
        for (let gx = x; gx <= x + w; gx += z) { g.moveTo(gx + 0.5, 24); g.lineTo(gx + 0.5, base + 14); }
        for (let gy = base; gy >= 24; gy -= z) { g.moveTo(x, gy + 0.5); g.lineTo(x + w, gy + 0.5); }
        g.stroke();
      }
      g.imageSmoothingEnabled = false;
      // assembled: body.html's ground (GY = 160 of 176) sits on our ground line
      const footY = Math.round(160 * gs);
      g.drawImage(game, 0, 0, GAME_W, GAME_H, x + 4 * z, base - footY * z, GAME_W * z, GAME_H * z);
      if (refG) {
        const rb = refBox ? refBox.bottom + 1 : refG.height;
        g.drawImage(refG, 0, 0, refG.width, refG.height, x + (GAME_W + 8) * z, base - rb * z, refG.width * z, refG.height * z);
      }
      g.fillStyle = "#e8e6e3"; g.fillText(`${z}x`, x + 2, 18);
      x += colW[i];
    }
    // ruler (in game pixels, at 4x the ticks are 4 screen px apart)
    g.strokeStyle = "#9aa3b2"; g.fillStyle = "#9aa3b2"; g.lineWidth = 1; g.beginPath();
    g.moveTo(ruler - 6.5, base); g.lineTo(ruler - 6.5, 24);
    for (let px = 0; px * 4 <= base - 24; px++) {
      const y = base - px * 4 + 0.5, long = px % 5 === 0;
      g.moveTo(ruler - (long ? 14 : 10), y); g.lineTo(ruler - 6, y);
      if (px % 10 === 0) g.fillText(String(px), 2, y + 4);
    }
    g.stroke();
    g.fillStyle = "#e8e6e3";
    g.fillText(`assembled ~${bodyH.toFixed(1)} px tall in game (target 25)   |   reference ${refName.split("/").pop()} ~${refH} px at x${rs}   |   ruler: game px (ticks at 4x)`, ruler, canvas.height - 10);
  }
  function alphaBox(c: HTMLCanvasElement) {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] >= 128) { if (top < 0) top = y; bottom = y; }
    return top < 0 ? null : { top, bottom };
  }
  for (const i of [stateSel, helmSel, shieldChk, hairChk, timeIn, refScale, gridChk, clipSel, phaseIn]) i.addEventListener("input", () => render());
  // a clip pose rendered by the Rig tab's renderer (same placement as body.html), at the in-game size like the sheet inset
  const bodies = new Map<string, Body>(), clipCache = new Map<string, Clip>();
  async function clipStill(set: string, name: string, u: number, lk: Look) {
    const [R, skel] = await Promise.all([loadRigCore(), loadSkeleton()]);
    if (!bodies.has(set)) bodies.set(set, await loadBody(R, set));
    if (!clipCache.has(name)) clipCache.set(name, (await api.getClip(name)) as unknown as Clip);
    const c = clipCache.get(name)!, frame = drawFrame(R, bodies.get(set)!, skel, c, { ...DEFAULT_LOOK, weapon: c.weapon?.kind || "sword", helm: lk.helm, shield: lk.shield, hair: lk.hair }, u * c.duration).canvas;
    const game = el("canvas", { width: GAME_W, height: GAME_H }), gg = game.getContext("2d")!;
    gg.imageSmoothingEnabled = false; gg.drawImage(frame, 0, 0, GAME_W, GAME_H);
    return { game, frame };
  }
  refIn.addEventListener("change", () => render());
  setSel.addEventListener("change", () => loadSet());
  project.on((why) => { if (why === "saved" && setSel.value === project.set && ctx.isActive()) loadSet(); });

  return {
    init,
    async activate() {
      await fillSets();
      if (!setSel.value && project.set) setSel.value = project.set;
      try { const names = await api.clips(), keep = clipSel.value; clipSel.replaceChildren(el("option", { value: "", text: "body.html pose" }), ...names.map((n) => el("option", { value: n, text: n, selected: n === keep }))); clipCache.clear(); } catch (e) { toast("clips: " + (e as Error).message, "err"); }
      if (setSel.value !== loadedSet) await loadSet(); else render();
    },
  };
}
