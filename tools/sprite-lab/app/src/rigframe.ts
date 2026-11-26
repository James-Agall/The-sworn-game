// The assembled body, rendered by the game-side rig page client/public/rig/body.html?parts=<set> in a same-origin iframe
// (so the Lab never copies rig code). body.html exposes window.__rig.sheet({frames:[{cfg,t}],cols,scale}) -> PNG data URL.
// With scale 2 a sheet cell holds the frame at (6,22) size 512x352 and, top-right, the same frame at the in-game size
// (gameScale 0.255 -> 65x45 px) at (453,25); both are read from one call.
export type Look = { state: "idle" | "walk" | "attack" | "walkattack"; helm: number; shield: number; hair: number };
export const GAME_W = 65, GAME_H = 45, FRAME_W = 256, FRAME_H = 176;
type RigWin = Window & { __rig?: { freeze: number | null; total?: number; sheet?: (spec: unknown) => string } };

export class RigFrame {
  iframe: HTMLIFrameElement;
  set = "";
  private ready: Promise<void> | null = null;
  constructor(parent: HTMLElement, cls = "rigframe") {
    this.iframe = document.createElement("iframe");
    this.iframe.className = cls;
    this.iframe.title = "assembled body (rig/body.html)";
    parent.append(this.iframe);
  }
  load(set: string): Promise<void> {
    this.set = set;
    this.iframe.src = `/rig/body.html?parts=${encodeURIComponent(set)}&t=${Date.now()}`;
    return (this.ready = new Promise((resolve, reject) => {
      const t0 = performance.now();
      const poll = () => {
        const w = this.iframe.contentWindow as RigWin | null;
        if (w?.__rig?.sheet) return resolve();
        const info = w?.document?.getElementById("info")?.textContent || "";
        if (/error|load /i.test(info) && !/^loading/.test(info)) return reject(new Error(info));
        if (performance.now() - t0 > 20000) return reject(new Error("rig/body.html did not load in 20 s"));
        setTimeout(poll, 100);
      };
      this.iframe.addEventListener("load", () => poll(), { once: true });
    }));
  }
  async whenReady() { if (!this.ready) throw new Error("no set loaded"); await this.ready; }
  /** One still: { game: in-game size canvas 65x45, frame: full 256x176 canvas }. */
  async still(look: Look, t: number): Promise<{ game: HTMLCanvasElement; frame: HTMLCanvasElement }> {
    await this.whenReady();
    const w = this.iframe.contentWindow as RigWin;
    const url = w.__rig!.sheet!({ frames: [{ cfg: { ...look }, t }], cols: 1, scale: 2 });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const game = document.createElement("canvas"); game.width = GAME_W; game.height = GAME_H;
    const gg = game.getContext("2d")!;
    gg.drawImage(img, 453, 25, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);
    // body.html paints its own grass (#6f8d4e) and ground (#5f7e41); make them transparent so the Lab's backdrop shows
    const d = gg.getImageData(0, 0, GAME_W, GAME_H);
    for (let i = 0; i < d.data.length; i += 4) {
      const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
      if ((Math.abs(r - 0x6f) < 3 && Math.abs(g - 0x8d) < 3 && Math.abs(b - 0x4e) < 3) || (Math.abs(r - 0x5f) < 3 && Math.abs(g - 0x7e) < 3 && Math.abs(b - 0x41) < 3)) d.data[i + 3] = 0;
    }
    gg.putImageData(d, 0, 0);
    const frame = document.createElement("canvas"); frame.width = FRAME_W; frame.height = FRAME_H;
    const g = frame.getContext("2d")!; g.imageSmoothingEnabled = false;
    g.drawImage(img, 6, 22, FRAME_W * 2, FRAME_H * 2, 0, 0, FRAME_W, FRAME_H);
    return { game, frame };
  }
  get total(): number { return (this.iframe.contentWindow as RigWin | null)?.__rig?.total || 10.6; }
}

/** Draw a canvas nearest-neighbour at an integer zoom. */
export function blit(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, z: number) {
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, sw, sh, x, y, sw * z, sh * z);
}

/** Opaque-pixel height of a character drawn on body.html's grass background (approximate: skips grass and shadow). */
export function figureBox(c: HTMLCanvasElement): { top: number; bottom: number; left: number; right: number } | null {
  const g = c.getContext("2d")!, d = g.getImageData(0, 0, c.width, c.height).data;
  const isBg = (i: number) => { const r = d[i], gg = d[i + 1], b = d[i + 2]; return gg > r * 1.1 && gg > b * 1.2 && r > 50 && r < 125; };
  let top = -1, bottom = -1, left = c.width, right = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (x > c.width * 0.86 && y < c.height * 0.15) continue;    // the sheet's game-size overlay corner
    const i = (y * c.width + x) * 4;
    if (d[i + 3] < 128 || isBg(i)) continue;
    if (top < 0) top = y;
    bottom = y; left = Math.min(left, x); right = Math.max(right, x);
  }
  return top < 0 ? null : { top, bottom, left, right };
}
