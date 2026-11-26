// Sprite Lab bridge (added by The Sworn Game's Sprite Lab; not part of upstream Piskel; see tools/sprite-lab/NOTICE.md).
//
// A small postMessage API so the Lab page that embeds this editor in a SAME-ORIGIN iframe can open a part and take it back.
// Only messages from window.parent with our own origin are accepted. Pixels travel as raw straight-alpha RGBA
// (Uint8ClampedArray, w, h), which maps 1:1 onto Frame.pixels (Uint32, little-endian RGBA bytes), so nothing is lost.
//
// Lab -> editor                                        editor -> Lab
//   {type:"lab:open", id, name, w, h, data, ref?}        {type:"lab:ready"}                       once, when the editor is up
//   {type:"lab:get", id}                                 {type:"lab:reply", id, ok, w?, h?, data?, error?}
//   {type:"lab:set-preview", id, size}                   {type:"lab:changed"}                     debounced, after edits / undo
//   ref = {w, h, data} drawn as a "Reference" layer at 35% opacity (never returned by lab:get)
import { Events } from "./Events";
import { app } from "./app";
import { Frame } from "./model/Frame";
import { Layer } from "./model/Layer";
import { Piskel } from "./model/Piskel";
import { Descriptor } from "./model/piskel/Descriptor";
import { UserSettings } from "./utils/UserSettings";

const REFERENCE = "Reference";
type Pixels = { w: number; h: number; data: Uint8ClampedArray };
type Msg = { type: string; id?: number; name?: string; w?: number; h?: number; data?: Uint8ClampedArray; ref?: Pixels | null; size?: string };

function frameFrom(p: Pixels): Frame {
  const f = new Frame(p.w, p.h);
  f.pixels = new Uint32Array(new Uint8ClampedArray(p.data).buffer);
  return f;
}

function open(m: Msg): void {
  const w = m.w as number, h = m.h as number;
  if (!(w > 0 && h > 0 && w <= 1024 && h <= 1024) || !m.data || m.data.length !== w * h * 4) throw new Error("bad image");
  const layers: Layer[] = [];
  if (m.ref && m.ref.w === w && m.ref.h === h && m.ref.data.length === w * h * 4) {
    const ref = Layer.fromFrames(REFERENCE, [frameFrom(m.ref)]);
    ref.setOpacity(0.35);
    layers.push(ref);
  }
  layers.push(Layer.fromFrames("Part", [frameFrom({ w, h, data: m.data })]));
  const piskel = Piskel.fromLayers(layers, 12, new Descriptor(String(m.name || "part"), "Sprite Lab part"));
  const pc = app.piskelController!;
  pc.setPiskel(piskel);
  pc.getWrappedPiskelController().setCurrentLayerIndex(layers.length - 1);
  $.publish(Events.PISKEL_SAVED);   // freshly opened = clean: no "unsaved changes" prompt on reload
}

/** The current frame of every layer except Reference, composited (source-over, straight alpha, layer opacity applied). */
function current(): Pixels {
  const pc = app.piskelController!, w = pc.getWidth(), h = pc.getHeight(), index = pc.getCurrentFrameIndex();
  const layers = pc.getLayers().filter((l) => l.getName() !== REFERENCE);
  const out = new Uint8ClampedArray(w * h * 4);
  if (layers.length === 1 && layers[0].getOpacity() === 1) {
    out.set(new Uint8ClampedArray(new Uint32Array(layers[0].getFrameAt(index).pixels).buffer));
    return { w, h, data: out };
  }
  const acc = new Float64Array(w * h * 4);
  for (const l of layers) {
    const src = new Uint8Array(new Uint32Array(l.getFrameAt(index).pixels).buffer), op = l.getOpacity();
    for (let i = 0; i < w * h * 4; i += 4) {
      const a = (src[i + 3] / 255) * op;
      if (!a) continue;
      const da = acc[i + 3], oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) acc[i + k] = (src[i + k] * a + acc[i + k] * da * (1 - a)) / oa;
      acc[i + 3] = oa;
    }
  }
  for (let i = 0; i < acc.length; i += 4) { for (let k = 0; k < 3; k++) out[i + k] = Math.round(acc[i + k]); out[i + 3] = Math.round(acc[i + 3] * 255); }
  return { w, h, data: out };
}

function reply(id: number | undefined, body: Record<string, unknown>, transfer: Transferable[] = []): void {
  window.parent.postMessage({ type: "lab:reply", id, ...body }, location.origin, transfer);
}

if (window.parent !== window) {
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const m = e.data as Msg;
    if (!m || typeof m.type !== "string" || !m.type.startsWith("lab:")) return;
    try {
      if (!app.piskelController) throw new Error("editor not ready");
      if (m.type === "lab:open") { open(m); reply(m.id, { ok: true }); }
      else if (m.type === "lab:get") { const p = current(); reply(m.id, { ok: true, ...p }, [p.data.buffer]); }
      else if (m.type === "lab:set-preview") {
        if (m.size !== "original" && m.size !== "best" && m.size !== "full") throw new Error("size must be original, best or full");
        UserSettings.set(UserSettings.PREVIEW_SIZE, m.size);
        reply(m.id, { ok: true });
      }
    } catch (err) {
      reply(m.id, { ok: false, error: String((err as Error).message || err) });
    }
  });
  let timer = 0;
  const changed = () => { clearTimeout(timer); timer = window.setTimeout(() => window.parent.postMessage({ type: "lab:changed" }, location.origin), 150); };
  const wait = window.setInterval(() => {
    if (!app.piskelController) return;
    clearInterval(wait);
    $.subscribe(Events.PISKEL_SAVE_STATE, changed);
    $.subscribe(Events.HISTORY_STATE_LOADED, changed);
    $.subscribe(Events.TOOL_RELEASED, changed);
    window.parent.postMessage({ type: "lab:ready" }, location.origin);
  }, 50);
}
