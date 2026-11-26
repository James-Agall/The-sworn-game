// Rig tab timeline: a ruler in phases (clip.phases) and frames (fps x duration), one row per channel with its keys as
// diamonds, events on the ruler, the playhead. Click / drag the ruler to scrub; click a key to select it, drag it to
// move it (snaps to frames, Alt = free); click a row to select the channel; double-click a row to add a key there.
import type { Channel, Clip } from "../../../shared/clip.ts";
import { CHANNEL_HELP } from "../../../shared/clip.ts";
import { moveKey } from "../../../shared/clipedit.ts";

export type Sel = { ch: Channel; i: number } | null;
export type TimelineHost = {
  clip(): Clip | null; u(): number; rows(): Channel[]; readOnly(): boolean;
  scrub(u: number): void; select(s: Sel): void; selected(): Sel;
  beginEdit(): void; changed(): void; addKey(ch: Channel, u: number): void;
};
const LABEL = 128, RULER = 26, ROW = 16, PAD_R = 12;

export class Timeline {
  canvas: HTMLCanvasElement;
  private host: TimelineHost;
  private drag: { kind: "scrub" } | { kind: "key"; ch: Channel; i: number; started: boolean; x0: number } | null = null;
  constructor(parent: HTMLElement, host: TimelineHost) {
    this.host = host;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "rig-timeline-canvas";
    this.canvas.className = "timeline-canvas";
    parent.append(this.canvas);
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("dblclick", (e) => this.dbl(e));
  }
  private width() { return Math.max(300, (this.canvas.parentElement?.clientWidth || 600) - 2); }
  /** x of phase u */
  xOf(u: number) { return LABEL + u * (this.width() - LABEL - PAD_R); }
  uOf(x: number) { return Math.max(0, Math.min(1, (x - LABEL) / (this.width() - LABEL - PAD_R))); }
  private rowAt(y: number): Channel | null { const i = Math.floor((y - RULER) / ROW), rows = this.host.rows(); return y >= RULER && i >= 0 && i < rows.length ? rows[i] : null; }
  private keyAt(x: number, y: number): { ch: Channel; i: number } | null {
    const ch = this.rowAt(y), c = this.host.clip();
    if (!ch || !c) return null;
    const ks = c.tracks[ch]?.keys || [];
    let best = -1, bd = 7;
    ks.forEach((k, i) => { const d = Math.abs(this.xOf(k.u) - x); if (d < bd) { bd = d; best = i; } });
    return best >= 0 ? { ch, i: best } : null;
  }
  private pos(e: PointerEvent | MouseEvent) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  private down(e: PointerEvent) {
    const [x, y] = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (y < RULER || x < LABEL && !this.rowAt(y)) { this.drag = { kind: "scrub" }; this.host.scrub(this.uOf(x)); return; }
    const k = x >= LABEL - 6 ? this.keyAt(x, y) : null;
    if (k) { this.host.select(k); this.drag = { kind: "key", ch: k.ch, i: k.i, started: false, x0: x }; return; }
    const ch = this.rowAt(y);
    if (ch) { this.host.select({ ch, i: -1 }); if (x >= LABEL) { this.drag = { kind: "scrub" }; this.host.scrub(this.uOf(x)); } }
  }
  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d) { const [x, y] = this.pos(e); this.canvas.style.cursor = y < RULER ? "col-resize" : this.keyAt(x, y) ? "ew-resize" : "default"; return; }
    const [x] = this.pos(e);
    if (d.kind === "scrub") { this.host.scrub(this.uOf(x)); return; }
    const c = this.host.clip();
    if (!c || this.host.readOnly()) return;
    if (!d.started) { if (Math.abs(x - d.x0) < 3) return; d.started = true; this.host.beginEdit(); }
    let u = this.uOf(x);
    const n = Math.max(1, Math.round(c.duration * c.fps));
    if (!e.altKey) u = Math.round(u * n) / n;
    moveKey(c, d.ch, d.i, u);
    this.host.changed();
  }
  private up(e: PointerEvent) {
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  }
  private dbl(e: MouseEvent) {
    const [x, y] = this.pos(e), ch = this.rowAt(y);
    if (!ch || x < LABEL || this.host.readOnly() || this.keyAt(x, y)) return;
    const c = this.host.clip()!, n = Math.max(1, Math.round(c.duration * c.fps));
    this.host.addKey(ch, Math.round(this.uOf(x) * n) / n);
  }

  render() {
    const c = this.host.clip(), rows = this.host.rows(), W = this.width(), H = RULER + rows.length * ROW + 4;
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    const g = this.canvas.getContext("2d")!;
    g.fillStyle = "#15181d"; g.fillRect(0, 0, W, H);
    g.font = "11px system-ui, sans-serif"; g.textBaseline = "middle";
    if (!c) return;
    const sel = this.host.selected(), frames = Math.max(1, Math.round(c.duration * c.fps)), phases = c.phases || 8;
    // ruler: frame ticks, phase ticks + labels, events
    g.fillStyle = "#1b1e24"; g.fillRect(0, 0, W, RULER);
    g.strokeStyle = "#3a404b"; g.beginPath();
    for (let f = 0; f <= frames; f++) { const x = Math.round(this.xOf(f / frames)) + 0.5; g.moveTo(x, RULER - 5); g.lineTo(x, RULER); }
    g.stroke();
    g.strokeStyle = "#69727f"; g.fillStyle = "#9aa3b2"; g.beginPath();
    for (let p = 0; p <= phases; p++) { const x = Math.round(this.xOf(p / phases)) + 0.5; g.moveTo(x, 12); g.lineTo(x, RULER); if (p < phases) g.fillText(String(p), x + 3, 7); }
    g.stroke();
    g.fillStyle = "#1b1e24"; g.fillRect(0, 0, LABEL - 1, RULER);
    g.fillStyle = "#9aa3b2"; g.fillText(`${phases} ph, ${frames} fr, ${c.fps} fps`, 6, 8);
    g.fillText(`${c.loop ? "loop" : "one-shot"} ${c.duration.toFixed(3)} s`, 6, 19);
    for (const ev of c.events || []) {
      const x = this.xOf(ev.u);
      g.fillStyle = ev.type === "contact" ? "#e0574a" : ev.type === "release" ? "#5fb3e0" : ev.type === "footdown" ? "#5fb36b" : "#d9a441";
      g.beginPath(); g.moveTo(x - 4, RULER - 9); g.lineTo(x + 4, RULER - 9); g.lineTo(x, RULER - 2); g.closePath(); g.fill();
    }
    // rows
    rows.forEach((ch, r) => {
      const y = RULER + r * ROW, tr = c.tracks[ch];
      g.fillStyle = sel?.ch === ch ? "#2b2619" : r % 2 ? "#181b20" : "#1c2026"; g.fillRect(0, y, W, ROW);
      g.fillStyle = tr ? "#e8e6e3" : "#6b7380";
      g.fillText(ch + (tr?.waves?.length ? " ~" : ""), 6, y + ROW / 2);
      if (!tr) return;
      if (tr.waves?.length) { g.strokeStyle = "rgba(120,160,220,0.35)"; g.beginPath(); for (let x = LABEL; x < W - PAD_R; x += 2) { const yy = y + ROW / 2 + Math.sin((x - LABEL) / 7) * 3; if (x === LABEL) g.moveTo(x, yy); else g.lineTo(x, yy); } g.stroke(); }
      if (tr.keys.length > 1) { g.strokeStyle = "#4a515d"; g.beginPath(); g.moveTo(this.xOf(tr.keys[0].u), y + ROW / 2); g.lineTo(this.xOf(tr.keys[tr.keys.length - 1].u), y + ROW / 2); g.stroke(); }
      tr.keys.forEach((k, i) => {
        const x = this.xOf(k.u), on = sel && sel.ch === ch && sel.i === i, s = on ? 6 : 5;
        g.fillStyle = on ? "#f0c060" : k.ease === "linear" ? "#8fb3d9" : k.ease === "easeIn" ? "#e08a5a" : k.ease === "easeOut" ? "#7cc28a" : k.ease === "step" ? "#b08ad9" : "#d9a441";
        g.beginPath(); g.moveTo(x, y + ROW / 2 - s); g.lineTo(x + s, y + ROW / 2); g.lineTo(x, y + ROW / 2 + s); g.lineTo(x - s, y + ROW / 2); g.closePath(); g.fill();
        if (on) { g.strokeStyle = "#fff"; g.stroke(); }
      });
    });
    g.strokeStyle = "#2f343d"; g.beginPath(); g.moveTo(LABEL - 0.5, 0); g.lineTo(LABEL - 0.5, H); g.stroke();
    const px = Math.round(this.xOf(this.host.u())) + 0.5;
    g.strokeStyle = "#ff5a4a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.lineWidth = 1;
    g.fillStyle = "#ff5a4a"; g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.closePath(); g.fill();
    this.canvas.title = sel ? `${sel.ch}: ${CHANNEL_HELP[sel.ch]}` : "Drag the ruler to scrub; drag keys; double-click a row to add a key";
  }
}
