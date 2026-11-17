// Phase 0 of the perf plan (~/docs/colony2d/PERF-PLAN.md): a small on-screen readout, only with `?perf=1`.
// It answers "is the jitter the server or the client?":
//   frame   - average / worst frame time over the last 120 frames (16.7 ms = 60 fps)
//   snap    - time between snapshots (server tick delivery; steady 50 ms = smooth, spikes = server / network jitter)
//   parse   - JSON.parse + delta rebuild per snapshot, and its size in KB
//   long    - main-thread tasks over 50 ms in the last 10 s (count / worst): hitches the player feels
//   scene   - sprites in the scene vs on screen units
// Press P to hide / show. Costs almost nothing when off (one URL check, nothing registered).
import type { Application } from "pixi.js";

export interface PerfProbe {
  onSnapshot(bytes: number, parseMs: number): void;
  setScene(units: number, children: number): void;
}

const NOOP: PerfProbe = { onSnapshot() {}, setScene() {} };

export function initPerfOverlay(app: Application): PerfProbe {
  if (new URLSearchParams(location.search).get("perf") !== "1") return NOOP;

  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;left:6px;top:6px;z-index:99999;margin:0;padding:6px 8px;background:rgba(0,0,0,.72);color:#9f9;" +
    "font:11px/1.35 monospace;pointer-events:none;white-space:pre;border-radius:4px";
  document.body.appendChild(el);
  window.addEventListener("keydown", (e) => {
    if (e.key === "p" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) el.hidden = !el.hidden;
  });

  const frames: number[] = [];
  const gaps: number[] = [];
  const parses: number[] = [];
  const sizes: number[] = [];
  let lastSnapAt = 0;
  let units = 0;
  let children = 0;
  const longTasks: { at: number; ms: number }[] = [];

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ at: performance.now(), ms: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask not supported: the line shows n/a */
  }

  const push = (a: number[], v: number, max: number) => {
    a.push(v);
    if (a.length > max) a.shift();
  };
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const max = (a: number[]) => (a.length ? Math.max(...a) : 0);

  app.ticker.add((ticker) => push(frames, ticker.deltaMS, 120));

  setInterval(() => {
    const now = performance.now();
    while (longTasks.length && now - longTasks[0].at > 10000) longTasks.shift();
    const fa = avg(frames);
    el.textContent =
      `frame ${fa.toFixed(1)} ms avg (${fa > 0 ? (1000 / fa).toFixed(0) : "-"} fps)  worst ${max(frames).toFixed(0)} ms\n` +
      `snap  gap ${avg(gaps).toFixed(0)} ms avg  worst ${max(gaps).toFixed(0)} ms  (server tick 50)\n` +
      `parse ${avg(parses).toFixed(1)} ms avg  worst ${max(parses).toFixed(1)}  size ${(avg(sizes) / 1024).toFixed(0)} KB\n` +
      `long  ${longTasks.length} tasks >50 ms / 10 s  worst ${max(longTasks.map((t) => t.ms)).toFixed(0)} ms\n` +
      `scene ${units} units  ${children} display objects`;
  }, 500);

  return {
    onSnapshot(bytes, parseMs) {
      const now = performance.now();
      if (lastSnapAt) push(gaps, now - lastSnapAt, 60);
      lastSnapAt = now;
      push(parses, parseMs, 60);
      push(sizes, bytes, 60);
    },
    setScene(u, c) {
      units = u;
      children = c;
    },
  };
}
