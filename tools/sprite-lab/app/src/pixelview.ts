// Zoom / pan pixel canvas with an optional grid and draggable handles. Nearest-neighbour, integer zoom 1x-16x.
// Mouse: wheel zooms around the cursor, drag empty space (or middle / right button) pans, drag a handle moves it.
// Reused by the Parts tab now and meant for the Rig and Area tabs later.
export type Handle = { id: string; x: number; y: number; color: string; label?: string; shape?: "circle" | "diamond"; drag: (x: number, y: number, e: PointerEvent) => void; start?: () => void };

export class PixelView {
  canvas: HTMLCanvasElement;
  zoom = 8;
  panX = 0;
  panY = 0;
  grid = true;
  image: CanvasImageSource | null = null;
  imgW = 0;
  imgH = 0;
  handles: Handle[] = [];
  overlay: ((g: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number) => void) | null = null;
  onZoom: (z: number) => void = () => {};
  onHover: (x: number, y: number) => void = () => {};
  private drag: { kind: "pan" | "handle"; h?: Handle; x0: number; y0: number; px: number; py: number } | null = null;
  private ro: ResizeObserver;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pixelview";
    this.canvas.tabIndex = 0;
    parent.append(this.canvas);
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(parent);
    this.canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomAt(this.zoom + (e.deltaY < 0 ? 1 : -1) * (this.zoom >= 8 ? 2 : 1), e.offsetX, e.offsetY); }, { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => { this.drag = null; this.canvas.releasePointerCapture(e.pointerId); this.render(); });
  }

  setImage(img: CanvasImageSource | null, w: number, h: number, refit = false) {
    const changed = w !== this.imgW || h !== this.imgH;
    this.image = img; this.imgW = w; this.imgH = h;
    if (refit || changed) this.fit(); else this.render();
  }
  private pendingFit = false;
  fit() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    if (!r.width || !r.height) { this.pendingFit = true; return; }    // hidden tab: fit once it is shown
    this.pendingFit = false;
    if (this.imgW && r.width) this.zoom = Math.max(1, Math.min(16, Math.floor(Math.min((r.width - 80) / this.imgW, (r.height - 80) / this.imgH))));
    this.panX = Math.round((r.width - this.imgW * this.zoom) / 2);
    this.panY = Math.round((r.height - this.imgH * this.zoom) / 2);
    this.onZoom(this.zoom);
    this.render();
  }
  zoomAt(z: number, cx?: number, cy?: number) {
    z = Math.max(1, Math.min(16, Math.round(z)));
    if (z === this.zoom) return;
    const r = this.canvas.getBoundingClientRect();
    cx ??= r.width / 2; cy ??= r.height / 2;
    const ix = (cx - this.panX) / this.zoom, iy = (cy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = Math.round(cx - ix * z); this.panY = Math.round(cy - iy * z);
    this.onZoom(z);
    this.render();
  }
  toImage(e: { offsetX: number; offsetY: number }) { return { x: (e.offsetX - this.panX) / this.zoom, y: (e.offsetY - this.panY) / this.zoom }; }
  private hit(e: PointerEvent): Handle | undefined {
    // topmost handle wins; with Alt the bottom one does (to grab a handle hidden under another)
    for (const h of e.altKey ? this.handles : [...this.handles].reverse()) {
      const dx = e.offsetX - (this.panX + h.x * this.zoom), dy = e.offsetY - (this.panY + h.y * this.zoom);
      if (dx * dx + dy * dy <= 100) return h;
    }
    return undefined;
  }
  private down(e: PointerEvent) {
    this.canvas.focus();
    const h = e.button === 0 ? this.hit(e) : undefined;
    this.drag = { kind: h ? "handle" : "pan", h, x0: e.offsetX, y0: e.offsetY, px: this.panX, py: this.panY };
    if (h?.start) h.start();
    this.canvas.setPointerCapture(e.pointerId);
  }
  private move(e: PointerEvent) {
    const p = this.toImage(e);
    this.onHover(p.x, p.y);
    if (!this.drag) { this.canvas.style.cursor = this.hit(e) ? "grab" : "default"; return; }
    if (this.drag.kind === "pan") { this.panX = this.drag.px + e.offsetX - this.drag.x0; this.panY = this.drag.py + e.offsetY - this.drag.y0; this.render(); }
    else this.drag.h!.drag(p.x, p.y, e);
  }

  render() {
    const c = this.canvas, r = c.parentElement!.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (this.pendingFit && r.width && r.height) { this.fit(); return; }
    const W = Math.max(1, Math.floor(r.width)), H = Math.max(1, Math.floor(r.height));
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px"; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#15171c"; g.fillRect(0, 0, W, H);
    const z = this.zoom, x0 = this.panX, y0 = this.panY, w = this.imgW * z, h = this.imgH * z;
    if (this.imgW) {
      // checkerboard behind the image so transparency is visible
      const cs = Math.max(4, z);
      for (let y = 0; y < this.imgH * z; y += cs) for (let x = 0; x < w; x += cs) {
        g.fillStyle = ((x / cs + y / cs) & 1) ? "#3a3d45" : "#2c2f36";
        g.fillRect(x0 + x, y0 + y, Math.min(cs, w - x), Math.min(cs, h - y));
      }
      if (this.image) g.drawImage(this.image, x0, y0, w, h);
      if (this.grid && z >= 4) {
        g.strokeStyle = "rgba(255,255,255,0.09)"; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x <= this.imgW; x++) { g.moveTo(x0 + x * z + 0.5, y0); g.lineTo(x0 + x * z + 0.5, y0 + h); }
        for (let y = 0; y <= this.imgH; y++) { g.moveTo(x0, y0 + y * z + 0.5); g.lineTo(x0 + w, y0 + y * z + 0.5); }
        g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.35)"; g.strokeRect(x0 - 0.5, y0 - 0.5, w + 1, h + 1);
    }
    const sx = (x: number) => x0 + x * z, sy = (y: number) => y0 + y * z;
    this.overlay?.(g, sx, sy);
    for (const hd of this.handles) {
      const hx = sx(hd.x), hy = sy(hd.y);
      g.fillStyle = hd.color; g.strokeStyle = "#000"; g.lineWidth = 2;
      g.beginPath();
      if (hd.shape === "diamond") { g.moveTo(hx, hy - 7); g.lineTo(hx + 7, hy); g.lineTo(hx, hy + 7); g.lineTo(hx - 7, hy); g.closePath(); }
      else g.arc(hx, hy, 6, 0, Math.PI * 2);
      g.stroke(); g.fill();
      if (hd.label) { g.font = "12px system-ui, sans-serif"; g.fillStyle = "#000"; g.fillText(hd.label, hx + 10, hy + 5); g.fillStyle = "#fff"; g.fillText(hd.label, hx + 9, hy + 4); }
    }
  }
}
