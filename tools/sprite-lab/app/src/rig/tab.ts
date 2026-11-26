// Rig tab: clips (client/public/rig/clips/*.json) on the human skeleton, played on the assembled body of a part set.
// Left: clip list + look. Centre: live canvas (onion skin, bones, gizmos, ground line, planted-foot markers, game-size
// inset), toolbar, timeline. Right: keyframe inspector, pose copy / paste / mirror, clip settings, limbs, events.
// Rendering is render.ts (body.html's placement on rig-core.js); edits are snapshots in the shared History.
import type { Channel, Clip, ClipEvent, Ease, LimbName, Skeleton, WeaponKind } from "../../../shared/clip.ts";
import { CHANNELS, CHANNEL_HELP, EASES, EVENT_TYPES, formatClip, newClip, phaseAt, sampleClip, validateClip, WEAPONS } from "../../../shared/clip.ts";
import { copyPose, keyedAt, mirrorClip, pastePose, removeKey, setKey, wavesAt } from "../../../shared/clipedit.ts";
import { isDataName } from "../../../shared/names.ts";
import { api } from "../api.ts";
import { project } from "../project.ts";
import { History } from "../undo.ts";
import { ask, confirmBox, el, toast } from "../ui.ts";
import { bakeAtlas, contactSheet, showExport, type Rows } from "./export.ts";
import { DEFAULT_LOOK, dimsOf, drawFrame, effectiveLook, frameXform, GAME_SCALE, loadBody, loadRigCore, loadSkeleton, withBg, type Body, type Look, type Rig } from "./render.ts";
import { Timeline, type Sel } from "./timeline.ts";

type Entry = { clip: Clip; saved: string | null };
type Handle = { id: string; at: number[]; color: string; hint: string };

export function mountRig(root: HTMLElement, ctx: { isActive: () => boolean; onState: () => void }) {
  let R: Rig | null = null, skel: Skeleton | null = null, body: Body | null = null, bodyErr = "";
  const clips = new Map<string, Entry>(), hist = new Map<string, History<string>>();
  let cur = "", t = 0, playing = false, last = 0, sel: Sel = null, clipboard: Partial<Record<Channel, number>> | null = null;
  let look: Look = { ...DEFAULT_LOOK }, hover: string | null = null;
  let drag: { id: string; started: boolean } | null = null;
  let view = { z: 3, ox: 0, oy: 0 };

  // ------------------------------------------------------------ DOM
  const opt = (v: string, text = v) => el("option", { value: v, text });
  const sel_ = (id: string, opts: [string, string][], value: string) => { const s = el("select", { id }); for (const [v, tx] of opts) s.append(el("option", { value: v, text: tx, selected: v === value })); return s; };
  const lbl = (text: string, input: HTMLElement) => el("label", { class: "field" }, el("span", { text }), input);
  const list = el("ul", { class: "part-list clip-list", id: "rig-clip-list" });
  const setSel = el("select", { id: "rig-set" });
  const weaponSel = sel_("rig-weapon", WEAPONS.map((w) => [w, w]), look.weapon);
  const helmSel = sel_("rig-helm", [["0", "none"], ["1", "1"], ["2", "2"], ["3", "3"]], "0");
  const shieldChk = el("input", { type: "checkbox", id: "rig-shield" }), hairChk = el("input", { type: "checkbox", id: "rig-hair", checked: true });
  const armourSel = sel_("rig-armour", [["0", "none (body.html)"], ["1", "tier 1"], ["2", "tier 2"], ["3", "tier 3"]], "0");
  const genderSel = sel_("rig-gender", [["m", "male"], ["f", "female"]], "m");
  const buildSel = sel_("rig-build", [["0", "slim"], ["1", "average"], ["2", "broad"]], "1");
  const left = el("aside", { class: "panel left rig-left" },
    el("h4", { text: "Clips" }), list,
    el("div", { class: "row wrap tight" },
      el("button", { id: "rig-new", text: "New", onclick: () => newClipUI() }),
      el("button", { id: "rig-dup", text: "Duplicate", onclick: () => duplicateUI() }),
      el("button", { id: "rig-rename", text: "Rename", onclick: () => renameUI() }),
      el("button", { id: "rig-delete", text: "Delete", onclick: () => deleteUI() })),
    el("p", { class: "hint", text: "ref = built-in reference clip converted from body.html / index.html (read-only: Duplicate to edit)." }),
    el("h4", { text: "Look" }),
    el("div", { class: "fields" }, lbl("Part set", setSel), lbl("Weapon", weaponSel), lbl("Helm", helmSel), lbl("Armour", armourSel), lbl("Gender", genderSel), lbl("Build", buildSel),
      el("div", { class: "row" }, el("label", { class: "check" }, shieldChk, el("span", { text: "shield" })), el("label", { class: "check" }, hairChk, el("span", { text: "hair" })))),
    el("p", { class: "hint", text: "Parts come from the SAVED set files (like rig/body.html). Sword, helm and shield are body.html's harvested pieces; axe / spear / bow are the set's parts." }));

  const playBtn = el("button", { id: "rig-play", text: "Play", title: "Play / pause (Space)", onclick: () => togglePlay() });
  const loopBtn = el("button", { id: "rig-loop-play", class: "on", text: "Loop", title: "Loop playback", onclick: () => { loopBtn.classList.toggle("on"); } });
  const speedSel = sel_("rig-speed", [["0.1", "0.1x"], ["0.25", "0.25x"], ["0.5", "0.5x"], ["1", "1x"], ["2", "2x"]], "1");
  const timeOut = el("span", { class: "zoomlbl rig-time", id: "rig-time" });
  const onionChk = el("input", { type: "checkbox", id: "rig-onion" }), bonesChk = el("input", { type: "checkbox", id: "rig-bones", checked: true });
  const zoomSel = sel_("rig-zoom", [["0", "fit"], ["1", "1x"], ["2", "2x"], ["3", "3x"], ["4", "4x"], ["5", "5x"]], "0");
  const dirtyDot = el("span", { class: "dirty", id: "rig-dirty", title: "Unsaved clip changes" });
  const saveBtn = el("button", { class: "primary", id: "rig-save", text: "Save clip", title: "Save the clip to client/public/rig/clips/<name>.json (Ctrl+S)", onclick: () => save() });
  const toolbar = el("div", { class: "toolbar" },
    playBtn, loopBtn, speedSel,
    el("button", { id: "rig-prev", text: "<", title: "Previous frame (Left)", onclick: () => step(-1) }),
    el("button", { id: "rig-next", text: ">", title: "Next frame (Right)", onclick: () => step(1) }),
    timeOut, el("span", { class: "sep" }),
    el("label", { class: "check" }, onionChk, el("span", { text: "onion" })), el("label", { class: "check" }, bonesChk, el("span", { text: "bones" })), zoomSel,
    el("span", { class: "sep" }),
    el("button", { id: "rig-export", text: "Export contact sheet", onclick: () => exportSheetUI() }),
    el("button", { id: "rig-bake", text: "Bake atlas preview", onclick: () => bakeUI() }),
    el("span", { class: "grow" }), dirtyDot, saveBtn);
  const canvas = el("canvas", { id: "rig-canvas", class: "rig-canvas", tabindex: "0" });
  const viewWrap = el("div", { class: "view-wrap rig-view" }, canvas);
  const tlWrap = el("div", { class: "timeline-wrap", id: "rig-timeline" });
  const status = el("div", { class: "statusbar", id: "rig-status" });

  const keyU = el("input", { type: "number", id: "rig-key-u", step: "0.01", min: "0", max: "1" });
  const keyV = el("input", { type: "number", id: "rig-key-v", step: "0.5" });
  const keyEase = sel_("rig-key-ease", EASES.map((e) => [e, e === "smooth" ? "smooth (cubic Hermite, rig-core default)" : e]), "smooth");
  const keyInfo = el("p", { class: "hint", id: "rig-key-info" });
  const chanSel = el("select", { id: "rig-channel" }, ...CHANNELS.map((c) => opt(c)));
  const loopChk = el("input", { type: "checkbox", id: "rig-clip-loop" });
  const durIn = el("input", { type: "number", id: "rig-clip-duration", step: "0.01", min: "0.05", max: "60" });
  const fpsIn = el("input", { type: "number", id: "rig-clip-fps", step: "1", min: "1", max: "120" });
  const phasesIn = el("input", { type: "number", id: "rig-clip-phases", step: "1", min: "1", max: "256" });
  const modeSels = Object.fromEntries((["armN", "armF", "legN", "legF"] as LimbName[]).map((l) => [l, sel_("rig-mode-" + l,
    l.startsWith("leg") ? [["fk", "FK (hip / knee)"], ["ik:free", "IK foot target"]] : l === "armN" ? [["fk", "FK (shoulder / elbow)"], ["ik:free", "IK hand target"], ["ik:string", "IK to bow string"]] : [["fk", "FK (shoulder / elbow)"], ["ik:free", "IK hand target"], ["ik:grip", "IK to weapon grip"]], "fk")])) as Record<LimbName, HTMLSelectElement>;
  const evType = sel_("rig-event-type", EVENT_TYPES.map((e) => [e, e]), "contact");
  const evList = el("div", { class: "ev-list", id: "rig-events" });
  const readout = el("pre", { class: "rig-readout", id: "rig-readout" });
  const right = el("aside", { class: "panel right rig-right" },
    el("h4", { text: "Keyframe" }),
    el("div", { class: "fields" }, lbl("Channel", chanSel), lbl("Phase u", keyU), lbl("Value", keyV), lbl("Ease (into key)", keyEase)), keyInfo,
    el("div", { class: "row wrap tight" },
      el("button", { id: "rig-key-add", text: "Key (K)", title: "Key the channel at the playhead (Shift+K: every animated channel)", onclick: () => keyChannel(chanSel.value as Channel) }),
      el("button", { id: "rig-key-del", text: "Delete key", title: "Delete the selected key (Delete)", onclick: () => deleteKey() })),
    el("h4", { text: "Pose" }),
    el("div", { class: "row wrap tight" },
      el("button", { id: "rig-copy", text: "Copy pose", title: "Copy every animated channel at the playhead (Ctrl+C)", onclick: () => copy() }),
      el("button", { id: "rig-paste", text: "Paste pose", title: "Key the copied pose at the playhead (Ctrl+V)", onclick: () => paste() }),
      el("button", { id: "rig-mirror", text: "Mirror L/R", title: "Swap near and far legs / arms (whole clip)", onclick: () => edit(() => { mirrorClip(clip()!); }, "mirrored") })),
    el("h4", { text: "Clip" }),
    el("div", { class: "fields" }, lbl("Duration (s)", durIn), lbl("FPS", fpsIn), lbl("Phases", phasesIn), el("label", { class: "check" }, loopChk, el("span", { text: "loops (clip data)" }))),
    el("h4", { text: "Limbs" }),
    el("div", { class: "fields" }, ...(["armN", "armF", "legN", "legF"] as LimbName[]).map((l) => lbl(l, modeSels[l]))),
    el("h4", { text: "Events" }), evList,
    el("div", { class: "row tight" }, evType, el("button", { id: "rig-event-add", text: "Add at playhead", onclick: () => addEvent() })),
    el("h4", { text: "Pose values" }), readout);
  root.append(el("div", { class: "rig-tab" }, left, el("section", { class: "center" }, toolbar, viewWrap, tlWrap, status), right));

  const timeline = new Timeline(tlWrap, {
    clip: () => clip(), u: () => u(), readOnly: () => readOnly(), rows: () => rows(),
    scrub: (uu) => { pause(); t = uu * (clip()?.duration || 1); render(); },
    select: (s) => { sel = s; if (s) chanSel.value = s.ch; inspector(); render(); },
    selected: () => sel,
    beginEdit: () => snapshot(),
    changed: () => { touched(); },
    addKey: (ch, uu) => { if (guard()) return; snapshot(); t = uu * clip()!.duration; const i = setKey(clip()!, ch, uu, keyedAt(R!, clip()!, skel!, ch, uu)); sel = { ch, i }; touched(); },
  });

  // ------------------------------------------------------------ state helpers
  const clip = () => clips.get(cur)?.clip ?? null;
  const readOnly = () => clip()?.builtin === true;
  const u = () => { const c = clip(); return c ? phaseAt(c, t) : 0; };
  const isDirty = (name = cur) => { const e = clips.get(name); return !!e && (e.saved === null || formatClip(e.clip) !== e.saved); };
  const anyDirty = () => [...clips.keys()].some((n) => isDirty(n));
  const history = () => { if (!hist.has(cur)) { const h = new History<string>(); h.onChange = () => ctx.onState(); hist.set(cur, h); } return hist.get(cur)!; };
  const rows = (): Channel[] => {
    const c = clip(); if (!c) return [];
    const used = CHANNELS.filter((ch) => c.tracks[ch]), mode = (l: LimbName) => c.limbs?.[l]?.mode ?? (l.startsWith("leg") ? "ik" : "fk");
    const rel = CHANNELS.filter((ch) => {
      if (c.tracks[ch]) return false;
      const [limb, j] = ch.split(".") as [string, string];
      if (limb === "armN" || limb === "armF" || limb === "legN" || limb === "legF") { const ik = mode(limb as LimbName) === "ik"; if (j === "ikX" || j === "ikY") return ik && (limb.startsWith("leg") || (c.limbs?.[limb as LimbName]?.target ?? "free") === "free"); if (j === "ankle" || j === "weapon") return true; return !ik; }
      if (ch === "weapon.draw") return look.weapon === "bow";
      return true;
    });
    return [...used, ...rel];
  };
  function guard(): boolean {
    if (!clip()) return true;
    if (readOnly()) { toast(`${cur} is a built-in reference clip (read-only). Duplicate it to edit.`, "info"); return true; }
    return false;
  }
  function snapshot() { history().push(formatClip(clip())); }
  function edit(fn: () => void, what = "") { if (guard()) return; snapshot(); fn(); touched(); if (what) toast(what, "info", 1200); }
  function touched() { refreshList(); inspector(); settingsToFields(); render(); ctx.onState(); }

  // ------------------------------------------------------------ loading
  async function init() {
    try {
      [R, skel] = await Promise.all([loadRigCore(), loadSkeleton()]);
      const names = await api.clips();
      for (const n of names) {
        try { const c = (await api.getClip(n)) as unknown as Clip; const errs = validateClip(c, n); if (errs.length) { toast(`clip ${n}: ${errs[0]}`, "err"); continue; } clips.set(n, { clip: c, saved: formatClip(c) }); }
        catch (e) { toast(`clip ${n}: ${(e as Error).message}`, "err"); }
      }
      const sets = await api.sets();
      const want = sets.some((s) => s.name === "grounded-v2") ? "grounded-v2" : project.set || sets[0]?.name || "";
      setSel.replaceChildren(...sets.filter((s) => s.hasManifest).map((s) => el("option", { value: s.name, text: s.name, selected: s.name === want })));
      await loadSet(setSel.value);
      select(clips.has("walk") ? "walk" : [...clips.keys()][0] || "");
    } catch (e) { status.textContent = "Rig failed to start: " + (e as Error).message; toast(status.textContent, "err"); }
  }
  async function loadSet(set: string) {
    if (!R || !set) return;
    try { body = await loadBody(R, set); bodyErr = ""; } catch (e) { body = null; bodyErr = (e as Error).message; }
    render();
  }
  function select(name: string) {
    if (!clips.has(name)) return;
    cur = name; sel = null; t = 0; pause();
    const k = clip()!.weapon?.kind;
    if (k && k !== look.weapon) { look.weapon = k; weaponSel.value = k; }
    refreshList(); settingsToFields(); inspector(); render(); ctx.onState();
  }
  function refreshList() {
    list.replaceChildren(...[...clips.keys()].sort().map((n) => {
      const e = clips.get(n)!;
      return el("li", { "data-clip": n, class: n === cur ? "sel" : "", onclick: () => select(n) },
        el("span", { class: "nm", text: (isDirty(n) ? "* " : "") + n }),
        e.clip.builtin ? el("small", { class: "badge ref", text: "ref", title: e.clip.source || "built-in" }) : null,
        el("small", { text: `${e.clip.loop ? "loop" : "once"} ${e.clip.duration.toFixed(2)}s` }));
    }));
    dirtyDot.classList.toggle("on", isDirty());
    saveBtn.disabled = !clip() || readOnly();
  }

  // ------------------------------------------------------------ clip list operations
  async function askName(title: string, value: string): Promise<string | null> {
    const r = await ask(title, [{ key: "name", label: "Clip name", value, hint: "a-z 0-9 _ - (max 41); saved as client/public/rig/clips/<name>.json" }]);
    if (!r) return null;
    const n = String(r.name).trim();
    if (!isDataName(n)) { toast("Bad name: use a-z 0-9 _ - (max 41)", "err"); return null; }
    if (clips.has(n)) { toast(`A clip called ${n} exists`, "err"); return null; }
    return n;
  }
  async function newClipUI() {
    const n = await askName("New clip", "my-clip"); if (!n) return;
    clips.set(n, { clip: newClip(n, { weapon: look.weapon !== "sword" ? { kind: look.weapon } : undefined }), saved: null });
    select(n);
  }
  async function duplicateUI() {
    const c = clip(); if (!c) return;
    const n = await askName(`Duplicate ${cur}`, cur.replace(/^(.*?)(-copy\d*)?$/, "$1-copy")); if (!n) return;
    const copy = JSON.parse(JSON.stringify(c)) as Clip;
    copy.name = n; delete copy.builtin; copy.source = `duplicated from ${cur}` + (c.source ? ` (${c.source})` : "");
    clips.set(n, { clip: copy, saved: null });
    select(n);
  }
  async function renameUI() {
    if (guard()) return;
    const old = cur, e = clips.get(old)!, n = await askName(`Rename ${old}`, old); if (!n) return;
    e.clip.name = n;
    try {
      if (e.saved !== null) { await api.putClip(n, e.clip); await api.deleteClip(old); e.saved = formatClip(e.clip); }
    } catch (err) { e.clip.name = old; toast("Rename failed: " + (err as Error).message, "err"); return; }
    clips.delete(old); clips.set(n, e);
    if (hist.has(old)) { hist.set(n, hist.get(old)!); hist.delete(old); }
    select(n); toast(`Renamed to ${n}`, "ok");
  }
  async function deleteUI() {
    if (guard()) return;
    const name = cur, e = clips.get(name)!;
    if (!(await confirmBox(`Delete clip ${name}? (the file is backed up first)`, "Delete"))) return;
    try { if (e.saved !== null) { const r = await api.deleteClip(name); toast(`Deleted ${name}; backup in ${r.backup}`, "ok", 5000); } }
    catch (err) { toast("Delete failed: " + (err as Error).message, "err"); return; }
    clips.delete(name); hist.delete(name);
    select(clips.has("walk") ? "walk" : [...clips.keys()][0] || "");
  }
  async function save() {
    const c = clip(); if (!c) return;
    if (readOnly()) { toast(`${cur} is a built-in reference clip (read-only). Duplicate it to edit.`, "info"); return; }
    const errs = validateClip(c, cur);
    if (errs.length) { toast("Not saved: " + errs.slice(0, 3).join("; "), "err", 8000); return; }
    try {
      const r = await api.putClip(cur, c);
      clips.get(cur)!.saved = formatClip(c);
      toast(`Saved client/public/rig/clips/${cur}.json${r.backup ? "; previous in " + r.backup : ""}`, "ok", 5000);
    } catch (e) { toast("Save failed: " + (e as Error).message, "err"); }
    refreshList(); ctx.onState();
  }

  // ------------------------------------------------------------ playback
  function togglePlay() { playing ? pause() : play(); }
  function play() { if (!clip()) return; playing = true; playBtn.textContent = "Pause"; playBtn.classList.add("on"); last = performance.now(); requestAnimationFrame(tick); }
  function pause() { playing = false; playBtn.textContent = "Play"; playBtn.classList.remove("on"); }
  function tick(now: number) {
    if (!playing) return;
    const c = clip(); if (!c) return pause();
    t += ((now - last) / 1000) * Number(speedSel.value); last = now;
    if (!c.loop && t >= c.duration) { if (loopBtn.classList.contains("on")) t = 0; else { t = c.duration; pause(); } }
    else if (c.loop && !loopBtn.classList.contains("on") && t >= c.duration) { t = c.duration * 0.99999; pause(); }
    render();
    if (playing) requestAnimationFrame(tick);
  }
  function step(d: number) {
    const c = clip(); if (!c) return;
    pause();
    const n = Math.max(1, Math.round(c.duration * c.fps)), f = Math.round(u() * n) + d;
    t = (c.loop ? ((f % n) + n) % n : Math.max(0, Math.min(n, f))) / n * c.duration;
    render();
  }

  // ------------------------------------------------------------ keys
  function keyValueNow(ch: Channel): number { return keyedAt(R!, clip()!, skel!, ch, u()); }
  function keyChannel(ch: Channel, v?: number) {
    if (guard()) return;
    snapshot();
    const i = setKey(clip()!, ch, u(), v ?? keyValueNow(ch));
    sel = { ch, i }; touched();
  }
  function keyAll() {
    if (guard()) return;
    const c = clip()!, chs = CHANNELS.filter((ch) => c.tracks[ch]?.keys.length);
    if (!chs.length) { toast("No animated channels yet: key one channel first (K)", "info"); return; }
    snapshot(); for (const ch of chs) setKey(c, ch, u(), keyValueNow(ch)); touched();
    toast(`Keyed ${chs.length} channels at u ${u().toFixed(3)}`, "info", 1500);
  }
  function deleteKey() {
    if (!sel || sel.i < 0 || guard()) return;
    snapshot(); removeKey(clip()!, sel.ch, sel.i); sel = { ch: sel.ch, i: -1 }; touched();
  }
  function copy() { const c = clip(); if (!c) return; clipboard = copyPose(R!, c, skel!, u()); toast(`Copied ${Object.keys(clipboard).length} channels`, "info", 1500); }
  function paste() { if (!clipboard) { toast("Nothing copied yet", "info"); return; } const cb = clipboard; edit(() => { pastePose(clip()!, cb, u()); }, "pasted pose"); }
  function addEvent() {
    const type = evType.value as ClipEvent["type"];
    edit(() => { const c = clip()!; (c.events ??= []).push({ u: Math.round(u() * 1e4) / 1e4, type }); c.events.sort((a, b) => a.u - b.u); });
  }
  function inspector() {
    const c = clip(), k = sel && sel.i >= 0 ? c?.tracks[sel.ch]?.keys[sel.i] : null;
    for (const i of [keyU, keyV, keyEase]) i.disabled = !k || readOnly();
    if (k) { keyU.value = String(k.u); keyV.value = String(k.v); keyEase.value = k.ease || "smooth"; }
    else { keyU.value = ""; keyV.value = ""; }
    const ch = (sel?.ch || chanSel.value) as Channel;
    keyInfo.textContent = `${ch}: ${CHANNEL_HELP[ch]}` + (c?.tracks[ch]?.waves?.length ? ` + ${c.tracks[ch]!.waves!.length} wave(s) added on top (data only)` : "");
    evList.replaceChildren(...(c?.events || []).map((ev, i) => el("div", { class: "row tight" },
      el("span", { class: "grow", text: `${ev.u.toFixed(3)} ${ev.type}${ev.note ? " - " + ev.note : ""}` }),
      el("button", { class: "ghost", text: "x", title: "Remove", onclick: () => edit(() => { clip()!.events!.splice(i, 1); if (!clip()!.events!.length) delete clip()!.events; }) }))));
  }
  function settingsToFields() {
    const c = clip(); if (!c) return;
    loopChk.checked = c.loop; durIn.value = String(c.duration); fpsIn.value = String(c.fps); phasesIn.value = String(c.phases ?? 8);
    for (const l of ["armN", "armF", "legN", "legF"] as LimbName[]) {
      const lm = c.limbs?.[l], m = lm?.mode ?? (l.startsWith("leg") ? "ik" : "fk");
      modeSels[l].value = m === "fk" ? "fk" : "ik:" + (lm?.target ?? "free");
      modeSels[l].disabled = readOnly();
    }
    for (const i of [loopChk, durIn, fpsIn, phasesIn]) i.disabled = readOnly();
  }
  keyU.addEventListener("change", () => { if (!sel || sel.i < 0) return; const v = Number(keyU.value); if (!(v >= 0 && v <= 1)) return inspector(); edit(() => { const ks = clip()!.tracks[sel!.ch]!.keys, k = ks[sel!.i]; ks.splice(sel!.i, 1); const i = setKey(clip()!, sel!.ch, v, k.v, k.ease); sel = { ch: sel!.ch, i }; }); });
  keyV.addEventListener("change", () => { if (!sel || sel.i < 0 || !Number.isFinite(Number(keyV.value))) return; edit(() => { clip()!.tracks[sel!.ch]!.keys[sel!.i].v = Number(keyV.value); }); });
  keyEase.addEventListener("change", () => { if (!sel || sel.i < 0) return; edit(() => { const k = clip()!.tracks[sel!.ch]!.keys[sel!.i]; if (keyEase.value === "smooth") delete k.ease; else k.ease = keyEase.value as Ease; }); });
  chanSel.addEventListener("change", () => { sel = { ch: chanSel.value as Channel, i: -1 }; inspector(); timeline.render(); });
  loopChk.addEventListener("change", () => edit(() => { clip()!.loop = loopChk.checked; }));
  const num = (inp: HTMLInputElement, key: "duration" | "fps" | "phases", ok: (v: number) => boolean) => inp.addEventListener("change", () => { const v = Number(inp.value); if (!ok(v)) { toast(`Bad ${key}`, "err"); settingsToFields(); return; } edit(() => { (clip() as Record<string, unknown>)[key] = v; }); });
  num(durIn, "duration", (v) => v > 0 && v <= 60); num(fpsIn, "fps", (v) => v >= 1 && v <= 120); num(phasesIn, "phases", (v) => Number.isInteger(v) && v >= 1 && v <= 256);
  for (const l of ["armN", "armF", "legN", "legF"] as LimbName[]) modeSels[l].addEventListener("change", () => edit(() => {
    const c = clip()!, [m, target] = modeSels[l].value.split(":"), limbs = (c.limbs ??= {}), prev = limbs[l] || { mode: "fk" as const };
    limbs[l] = m === "fk" ? { ...prev, mode: "fk", target: undefined } : { ...prev, mode: "ik", target: target as "free" | "grip" | "string" };
    if (limbs[l]!.target === undefined) delete limbs[l]!.target;
    if (target === "grip" && limbs[l]!.along === undefined) limbs[l]!.along = 30;
  }));

  // ------------------------------------------------------------ look
  const readLook = () => {
    look = { weapon: weaponSel.value as WeaponKind, helm: Number(helmSel.value), shield: shieldChk.checked ? 1 : 0, hair: hairChk.checked ? 1 : 0, armour: Number(armourSel.value), gender: genderSel.value as "m" | "f", build: Number(buildSel.value) };
    render();
  };
  for (const i of [weaponSel, helmSel, shieldChk, hairChk, armourSel, genderSel, buildSel]) i.addEventListener("change", readLook);
  setSel.addEventListener("change", () => loadSet(setSel.value));
  for (const i of [onionChk, bonesChk, zoomSel]) i.addEventListener("change", () => render());

  // ------------------------------------------------------------ canvas: render + gizmos
  function frameAt(tt: number) { return drawFrame(R!, body!, skel!, clip()!, look, tt); }
  function handles(p: ReturnType<typeof frameAt>["pose"]): Handle[] {
    const c = clip()!, eff = effectiveLook(c, look), dims = dimsOf(body!, skel!, eff.weapon), mode = (l: LimbName) => c.limbs?.[l]?.mode ?? (l.startsWith("leg") ? "ik" : "fk"), tgt = (l: LimbName) => c.limbs?.[l]?.target ?? "free";
    const hs: Handle[] = [
      { id: "root", at: p.root, color: "#ff5a4a", hint: "hips: drag = root.x / root.y" },
      { id: "lean", at: p.neck, color: "#ff8a5a", hint: "neck: drag = spine.lean" },
      { id: "head", at: R!.add(p.neck, R!.rot(0, -22, p.headTilt)), color: "#ffb070", hint: "head: drag = head.tilt" },
    ];
    if (eff.weapon !== "none" && eff.weapon !== "bow") hs.push({ id: "weapon", at: R!.add(p.armN.H, R!.dir(p.wa), dims.weaponLen), color: "#ffffff", hint: "weapon tip: drag = armN.weapon" });
    for (const l of ["armN", "armF"] as const) {
      const a = p[l], shieldHeld = l === "armF" && eff.shield && mode("armF") === "fk";
      if (shieldHeld || (mode(l) === "ik" && tgt(l) !== "free")) continue;
      hs.push({ id: l + ".hand", at: a.H, color: l === "armN" ? "#ffd84a" : "#5fe08a", hint: `${l} hand: drag = ${mode(l) === "ik" ? "IK target (ikX / ikY)" : "shoulder + elbow (solved)"}` });
      if (mode(l) === "fk") hs.push({ id: l + ".elbow", at: a.E, color: l === "armN" ? "#c9a830" : "#3fae66", hint: `${l} elbow: drag = shoulder angle` });
    }
    for (const [i, l] of [[1, "legN"], [0, "legF"]] as const) {
      const L = p.legs[i];
      hs.push({ id: l + ".foot", at: L.k.E, color: l === "legN" ? "#4ac8ff" : "#b07aff", hint: `${l} foot: drag = ${mode(l) === "ik" ? "IK target (ikX, lift ikY)" : "hip + knee (solved)"}` });
      if (mode(l) === "fk") hs.push({ id: l + ".knee", at: L.k.J, color: l === "legN" ? "#2a98c8" : "#8050d0", hint: `${l} knee: drag = hip angle` });
    }
    return hs;
  }
  let lastPose: ReturnType<typeof frameAt>["pose"] | null = null, lastHandles: Handle[] = [];
  function render() {
    timeOut.textContent = clip() ? `u ${u().toFixed(3)}  t ${(u() * clip()!.duration).toFixed(3)} s  f ${Math.round(u() * Math.max(1, Math.round(clip()!.duration * clip()!.fps)))}` : "";
    timeline.render();
    const wrap = viewWrap.getBoundingClientRect(), W = Math.max(200, Math.floor(wrap.width)), H = Math.max(160, Math.floor(wrap.height));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#101216"; g.fillRect(0, 0, W, H);
    if (!R || !skel || !clip()) return;
    if (!body) { g.fillStyle = "#e0a83a"; g.font = "14px system-ui"; g.fillText(bodyErr || "loading parts...", 16, 28); return; }
    const F = skel.frame, gw = Math.round(F.w * GAME_SCALE), gh = Math.round(F.h * GAME_SCALE), insetW = gw * 2 + 24;
    const zSel = Number(zoomSel.value), z = zSel || Math.max(1, Math.floor(Math.min((W - insetW - 16) / F.w, (H - 16) / F.h)));
    view = { z, ox: Math.max(8, Math.floor((W - insetW - F.w * z) / 2)), oy: Math.floor((H - F.h * z) / 2) };
    const { canvas: fr, pose } = frameAt(t);
    lastPose = pose;
    const comp = R.canvas(F.w, F.h), cg = comp.getContext("2d")!;
    if (onionChk.checked) {
      const c = clip()!, d = 1 / (c.phases || 8);
      for (const [du, col] of [[-d, "rgba(255,80,80,0.55)"], [d, "rgba(80,160,255,0.55)"]] as [number, string][]) {
        let uu = u() + du; if (c.loop) uu = ((uu % 1) + 1) % 1; else if (uu < 0 || uu > 1) continue;
        const gh = frameAt(uu * c.duration).canvas, gg = gh.getContext("2d")!;
        gg.globalCompositeOperation = "source-atop"; gg.fillStyle = col; gg.fillRect(0, 0, F.w, F.h);
        cg.globalAlpha = 0.35; cg.drawImage(gh, 0, 0); cg.globalAlpha = 1;
      }
    }
    cg.drawImage(fr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(withBg(R, skel, comp), view.ox, view.oy, F.w * z, F.h * z);
    // overlays in screen space
    const X = frameXform(skel, look), S = (p: number[]) => { const q = X.to(p); return [view.ox + q[0] * z, view.oy + q[1] * z]; };
    const gy = S([0, F.groundY])[1];
    g.strokeStyle = "rgba(255,255,255,0.5)"; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(view.ox, gy + 0.5); g.lineTo(view.ox + F.w * z, gy + 0.5); g.stroke(); g.setLineDash([]);
    const sole = body.sole, line = (a: number[], b: number[], col: string) => { const p = S(a), q = S(b); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.lineWidth = 1; };
    if (bonesChk.checked) {
      line(pose.root, pose.waist, "#f33"); line(pose.waist, pose.neck, "#f33");
      line(pose.shoulder, pose.armN.E, "#fd3"); line(pose.armN.E, pose.armN.H, "#fd3"); line(pose.shoulder, pose.armF.E, "#3f6"); line(pose.armF.E, pose.armF.H, "#3f6");
      for (const L of pose.legs) { line(L.hj, L.k.J, L.far ? "#a6f" : "#3cf"); line(L.k.J, L.k.E, L.far ? "#a6f" : "#3cf"); }
    }
    // planted-foot indicator + IK targets
    const c = clip()!, s = sampleClip(R, c, skel, t);
    readout.textContent = CHANNELS.filter((ch) => c.tracks[ch] || ch.startsWith("arm") || ch === "spine.lean").map((ch) => `${(c.tracks[ch] ? "* " : "  ") + ch.padEnd(14)} ${s.ch[ch].toFixed(2)}`).join("\n");
    pose.legs.forEach((L, i) => {
      const name = i ? "legN" : "legF", f = s.feet[name as "legN" | "legF"], onGround = Math.abs(L.k.E[1] - (F.groundY - sole)) < 0.6, planted = onGround && !(f && f.swing);
      const p = S([L.k.E[0], F.groundY]);
      g.fillStyle = planted ? "#5fe08a" : "rgba(255,176,112,0.9)";
      if (planted) g.fillRect(p[0] - 6, p[1] + 3, 12, 4); else { g.strokeStyle = g.fillStyle; g.strokeRect(p[0] - 5.5, p[1] + 3.5, 11, 3); }
      if (L.target && Math.hypot(L.target[0] - L.k.E[0], L.target[1] - L.k.E[1]) > 0.6) { const q = S(L.target); g.strokeStyle = "#ff5a4a"; g.beginPath(); g.moveTo(q[0] - 4, q[1] - 4); g.lineTo(q[0] + 4, q[1] + 4); g.moveTo(q[0] + 4, q[1] - 4); g.lineTo(q[0] - 4, q[1] + 4); g.stroke(); }
    });
    for (const a of [pose.armN, pose.armF]) if (a.target && Math.hypot(a.target[0] - a.H[0], a.target[1] - a.H[1]) > 0.6) { const q = S(a.target); g.strokeStyle = "#ff5a4a"; g.beginPath(); g.arc(q[0], q[1], 4, 0, 7); g.stroke(); }
    // gizmo handles
    lastHandles = readOnly() ? [] : handles(pose);
    for (const h of lastHandles) { const p = S(h.at), on = hover === h.id || drag?.id === h.id; g.fillStyle = h.color; g.strokeStyle = "#000"; g.beginPath(); g.arc(p[0], p[1], on ? 6 : 4.5, 0, 7); g.fill(); g.stroke(); }
    // game-size inset (x0.255 of the frame = x0.275 of a part), 1x and 3x nearest, like body.html's strip
    const plain = withBg(R, skel, fr), ix = W - insetW + 4;
    g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(ix - 6, 6, gw * 2 + 14, gh * 3 + 46);
    g.drawImage(plain, 0, 0, F.w, F.h, ix, 22, gw * 2, gh * 2); g.drawImage(plain, 0, 0, F.w, F.h, ix, 30 + gh * 2, gw, gh);
    g.fillStyle = "#e8e6e3"; g.font = "11px system-ui"; g.fillText("in-game size x2 / x1", ix, 16);
    g.fillText(`${cur}${readOnly() ? " (ref, read-only)" : ""}${isDirty() ? " *" : ""}`, 10, 16);
    const h = lastHandles.find((x) => x.id === (drag?.id || hover));
    status.textContent = h ? h.hint + "; the key goes at the playhead" : readOnly() ? `${cur}: built-in reference (${c.source || ""}); Duplicate to edit` : "Drag the coloured handles to pose (keys at the playhead). Space play, arrows step, K key, Shift+K key all, Delete, Ctrl+Z / Y / S.";
  }
  const toFrame = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left - view.ox) / view.z, y = (e.clientY - r.top - view.oy) / view.z; return frameXform(skel!, look).from([x, y]); };
  const hit = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, X = frameXform(skel!, look); let best: Handle | null = null, bd = 9; for (const h of lastHandles) { const q = X.to(h.at), d = Math.hypot(view.ox + q[0] * view.z - mx, view.oy + q[1] * view.z - my); if (d < bd) { bd = d; best = h; } } return best; };
  canvas.addEventListener("pointerdown", (e) => { canvas.focus(); const h = hit(e); if (!h || guard()) return; pause(); drag = { id: h.id, started: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) { const h = R && skel && body ? hit(e) : null; if ((h?.id || null) !== hover) { hover = h?.id || null; canvas.style.cursor = h ? "grab" : "default"; render(); } return; }
    if (!drag.started) { drag.started = true; snapshot(); }
    applyDrag(drag.id, toFrame(e)); touched();
  });
  canvas.addEventListener("pointerup", (e) => { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ } render(); });
  function applyDrag(id: string, m: number[]) {
    const c = clip()!, p = lastPose!, uu = u(), Rg = R!, k = (ch: Channel, v: number) => { const i = setKey(c, ch, uu, v - wavesAt(c, ch, t)); sel = { ch, i }; chanSel.value = ch; };
    const angTo = (a: number[], b: number[]) => Math.atan2(b[0] - a[0], b[1] - a[1]) / Rg.D;
    const dims = dimsOf(body!, skel!, effectiveLook(c, look).weapon), F = skel!.frame, s = sampleClip(Rg, c, skel!, t);
    if (id === "root") { k("root.x", m[0] - F.groundX); k("root.y", m[1] - (F.groundY - (dims.thigh + dims.shin + dims.sole))); return; }
    if (id === "lean") { k("spine.lean", Math.atan2(m[0] - p.waist[0], -(m[1] - p.waist[1])) / Rg.D); return; }
    if (id === "head") { k("head.tilt", Math.atan2(m[0] - p.neck[0], -(m[1] - p.neck[1])) / Rg.D); return; }
    if (id === "weapon") { k("armN.weapon", angTo(p.armN.H, m)); return; }
    const [limb, part] = id.split(".") as [LimbName, string], mode = c.limbs?.[limb]?.mode ?? (limb.startsWith("leg") ? "ik" : "fk");
    if (limb.startsWith("arm")) {
      const reach = dims.foreArm + skel!.handReach, bend = c.limbs?.[limb]?.bend ?? skel!.bend.arm;
      if (part === "elbow") { k(`${limb}.shoulder` as Channel, angTo(p.shoulder, m)); return; }
      if (mode === "ik") { k(`${limb}.ikX` as Channel, m[0] - p.shoulder[0]); k(`${limb}.ikY` as Channel, m[1] - p.shoulder[1]); return; }
      const r = Rg.ik2(p.shoulder, m, dims.upperArm, reach, bend); k(`${limb}.shoulder` as Channel, r.a1); k(`${limb}.elbow` as Channel, r.a2 - r.a1); return;
    }
    const L = p.legs[limb === "legN" ? 1 : 0], bend = c.limbs?.[limb]?.bend ?? skel!.bend.leg;
    if (part === "knee") { k(`${limb}.hip` as Channel, angTo(L.hj, m)); return; }
    if (mode === "ik") {
      const f = s.feet[limb as "legN" | "legF"] || { x: 0, lift: 0 };
      k(`${limb}.ikX` as Channel, m[0] - L.hj[0] - f.x); k(`${limb}.ikY` as Channel, Math.max(0, F.groundY - dims.sole - m[1] - f.lift)); return;
    }
    const r = Rg.ik2(L.hj, m, dims.thigh, dims.shin, bend); k(`${limb}.hip` as Channel, r.a1); k(`${limb}.knee` as Channel, r.a2 - r.a1);
  }
  new ResizeObserver(() => { if (ctx.isActive()) render(); }).observe(viewWrap);
  // for the smoke test and debugging: where each gizmo handle is on the page
  const hook = (window as unknown as { __labRig?: Record<string, unknown> }).__labRig;
  if (hook) hook.handles = () => { if (!skel) return {}; const r = canvas.getBoundingClientRect(), X = frameXform(skel, look), out: Record<string, number[]> = {}; for (const h of lastHandles) { const q = X.to(h.at); out[h.id] = [r.left + view.ox + q[0] * view.z, r.top + view.oy + q[1] * view.z]; } return out; };

  // ------------------------------------------------------------ exports
  async function exportSheetUI() {
    const c = clip(); if (!c || !body) return;
    const r = await ask(`Contact sheet: ${cur}`, [
      { key: "phases", label: "Phases", type: "number", value: c.phases || 8 },
      { key: "rows", label: "Rows", type: "select", value: "current", options: [["current", "this look"], ["armour", "armour / helm tiers 0-3"], ["body", "male / female x 3 builds"]] },
    ], "Render");
    if (!r) return;
    const n = Math.max(1, Math.min(32, Math.round(Number(r.phases) || 8)));
    showExport(`Contact sheet: ${cur} (${n} phases)`, contactSheet(R!, body, skel!, c, look, n, r.rows as Rows), `${cur}-contact`);
  }
  function bakeUI() {
    const c = clip(); if (!c || !body) return;
    const { atlas, frames } = bakeAtlas(R!, body, skel!, c, look);
    const fw = frames[0].width, fh = frames[0].height, prev = el("canvas", { id: "rig-bake-preview", class: "bake-preview", width: fw * 7 + 40, height: fh * 4 + 16 });
    const strip = R!.canvas(atlas.width * 2, atlas.height * 2 + 4), sg = strip.getContext("2d")!; sg.fillStyle = "#6f8d4e"; sg.fillRect(0, 0, strip.width, strip.height); sg.imageSmoothingEnabled = false; sg.drawImage(atlas, 0, 0, atlas.width * 2, atlas.height * 2);
    let i = 0, alive = true;
    const anim = () => {
      if (!alive) return;
      const g = prev.getContext("2d")!; g.fillStyle = "#6f8d4e"; g.fillRect(0, 0, prev.width, prev.height); g.imageSmoothingEnabled = false;
      const f = frames[i % frames.length]; g.drawImage(f, 8, 8); g.drawImage(f, 8 + fw + 8, 8, fw * 2, fh * 2); g.drawImage(f, 8 + fw * 3 + 16, 8, fw * 4, fh * 4);
      i++; setTimeout(anim, 1000 / c.fps / Math.max(0.1, Number(speedSel.value)));
    };
    anim();
    const info = el("p", { class: "hint", text: `${frames.length} frames of ${fw}x${fh} px (frame x${GAME_SCALE} = part x0.275, the Draw tab's in-game size), ${c.fps} fps. Animated at 1x / 2x / 4x; below, the whole atlas at 2x. The saved PNG is the 1x atlas (transparent).` });
    showExport(`Bake atlas preview: ${cur}`, atlas, `${cur}-atlas`, el("div", {}, info, prev, el("div", { class: "export-scroll strip-scroll" }, strip)), () => { alive = false; });
  }

  // ------------------------------------------------------------ keyboard (routed from main.ts while the tab is active)
  function onKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "s") { save(); return true; }
    if (mod && k === "z" && !e.shiftKey) { undo(); return true; }
    if (mod && (k === "y" || (k === "z" && e.shiftKey))) { redo(); return true; }
    if (mod && k === "c") { copy(); return true; }
    if (mod && k === "v") { paste(); return true; }
    if (mod) return false;
    if (k === " ") { togglePlay(); return true; }
    if (k === "arrowleft") { step(-1); return true; }
    if (k === "arrowright") { step(1); return true; }
    if (k === "k") { if (e.shiftKey) keyAll(); else keyChannel((sel?.ch || chanSel.value) as Channel); return true; }
    if (k === "delete" || k === "backspace") { deleteKey(); return true; }
    return false;
  }
  function undo() { const h = history(), c = clip(); if (!c || readOnly()) return; const s = h.undo(formatClip(c)); if (s !== null) { clips.get(cur)!.clip = JSON.parse(s); sel = null; touched(); } }
  function redo() { const h = history(), c = clip(); if (!c || readOnly()) return; const s = h.redo(formatClip(c)); if (s !== null) { clips.get(cur)!.clip = JSON.parse(s); sel = null; touched(); } }

  return {
    init, onKey, undo, redo, save,
    activate() { render(); canvas.focus(); },
    get dirty() { return anyDirty(); },
    get canUndo() { return !!clip() && history().canUndo; },
    get canRedo() { return !!clip() && history().canRedo; },
    refreshParts() { if (setSel.value) loadSet(setSel.value); },
  };
}
