// window.__labRig: the Lab renderer driven from outside (the golden test compares it with body.html's __rig.sheet()).
// Same arguments and the same R.sheet layout as body.html, but frames name a clip and a time instead of a state.
import type { Clip, Skeleton } from "../../../shared/clip.ts";
import { sampleClip } from "../../../shared/clip.ts";
import { loadBody, loadRigCore, loadSkeleton, sheet, type Body, type Look, type Rig } from "./render.ts";

type Spec = { set?: string; frames: { clip: string; t?: number; u?: number; look?: Partial<Look>; label?: string }[]; cols?: number; scale?: number };
let cache: { R: Rig; skel: Skeleton; bodies: Map<string, Body>; clips: Map<string, Clip> } | null = null;

async function ctx() {
  if (!cache) { const R = await loadRigCore(); cache = { R, skel: await loadSkeleton(), bodies: new Map(), clips: new Map() }; }
  return cache;
}
async function clip(name: string): Promise<Clip> {
  const c = await ctx();
  if (!c.clips.has(name)) {
    const r = await fetch("/api/clips/" + encodeURIComponent(name), { cache: "no-store" });
    if (!r.ok) throw new Error(`clip ${name}: HTTP ${r.status}`);
    c.clips.set(name, await r.json());
  }
  return c.clips.get(name)!;
}

export function installHook() {
  (window as unknown as { __labRig: unknown }).__labRig = {
    async sheet(spec: Spec): Promise<string> {
      const c = await ctx(), set = spec.set || "grounded-v2";
      if (!c.bodies.has(set)) c.bodies.set(set, await loadBody(c.R, set));
      const frames = await Promise.all(spec.frames.map(async (f) => ({ ...f, clip: await clip(f.clip) })));
      return sheet(c.R, c.bodies.get(set)!, c.skel, frames, { cols: spec.cols, scale: spec.scale }).toDataURL("image/png");
    },
    /** Channel values of a clip at time t (for the channel-level comparison with index.html). */
    async channels(name: string, t: number) {
      const c = await ctx(), cl = await clip(name);
      return sampleClip(c.R, cl, c.skel, t).ch;
    },
  };
}
