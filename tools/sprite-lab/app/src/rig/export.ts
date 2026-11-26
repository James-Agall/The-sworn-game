// Rig tab exports: a contact sheet of N phases (the layout of scripts/character-rig-contact.mjs: one row per look, a
// labelled cell per pose with the frame at source scale and, beside it, the same frame at the in-game size) and a baked
// atlas preview (every frame of the clip at the in-game size, x0.255 of the frame = x0.275 of a part, like the Draw tab).
// Both can be downloaded or saved under art-sources/lab/exports/ through the Lab server.
import type { Clip, Skeleton } from "../../../shared/clip.ts";
import { api } from "../api.ts";
import { el, toast } from "../ui.ts";
import { drawFrame, GAME_SCALE, type Body, type Look, type Rig } from "./render.ts";

export type Rows = "current" | "armour" | "body";
export function rowLooks(look: Look, rows: Rows): { look: Look; label: string }[] {
  if (rows === "armour") return [0, 1, 2, 3].map((a) => ({ look: { ...look, armour: a, helm: a }, label: `armour ${a}` }));
  if (rows === "body") return (["m", "f"] as const).flatMap((gender) => [0, 1, 2].map((build) => ({ look: { ...look, gender, build }, label: `${gender} build ${build}` })));
  return [{ look, label: "" }];
}

/** Contact sheet: rows x phases cells of 160 x 150 like character-rig-contact.mjs (#cad0b1 paper, frame at k=0.8,
 * game-size copy at the right). */
export function contactSheet(R: Rig, B: Body, skel: Skeleton, clip: Clip, look: Look, phases: number, rows: Rows): HTMLCanvasElement {
  const looks = rowLooks(look, rows), CW = 160, CH = 150, F = skel.frame;
  const c = R.canvas(CW * phases, CH * looks.length + 24), g = c.getContext("2d")!;
  g.fillStyle = "#cad0b1"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#302b22"; g.font = "13px sans-serif";
  g.fillText(`${clip.name}: ${phases} phases of ${clip.duration.toFixed(3)} s${clip.loop ? " (loop)" : ""}, weapon ${look.weapon}; left x0.8 source, right in-game x${GAME_SCALE}`, 6, 16);
  looks.forEach(({ look: lk, label }, r) => {
    for (let i = 0; i < phases; i++) {
      const u = clip.loop ? i / phases : phases > 1 ? i / (phases - 1) : 0, x = i * CW, y = 24 + r * CH;
      const fr = drawFrame(R, B, skel, clip, lk, u * clip.duration).canvas;
      g.fillStyle = "#302b22"; g.fillText(`${label ? label + " " : ""}u ${u.toFixed(2)}`, x + 3, y + 14);
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 2, y + 130, CW - 4, 1);
      // source frame scaled so the ground point sits on the cell's ground line (y + 130)
      const k = 0.8; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(fr, x + 62 - F.groundX * k, y + 130 - F.groundY * k, F.w * k, F.h * k);
      const gw = Math.round(F.w * GAME_SCALE), gh = Math.round(F.h * GAME_SCALE);
      g.drawImage(gameSize(R, fr, skel), x + 137 - F.groundX * GAME_SCALE, y + 145 - F.groundY * GAME_SCALE, gw, gh);
    }
  });
  return c;
}

/** One frame at the in-game size (smooth downscale, like the Draw tab's strip). */
export function gameSize(R: Rig, frame: HTMLCanvasElement, skel: Skeleton): HTMLCanvasElement {
  const F = skel.frame, c = R.canvas(Math.round(F.w * GAME_SCALE), Math.round(F.h * GAME_SCALE)), g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(frame, 0, 0, c.width, c.height);
  return c;
}
/** The baked atlas: every frame (round(duration x fps)) at the in-game size, in one row, transparent. */
export function bakeAtlas(R: Rig, B: Body, skel: Skeleton, clip: Clip, look: Look): { atlas: HTMLCanvasElement; frames: HTMLCanvasElement[] } {
  const n = Math.max(1, Math.round(clip.duration * clip.fps)), frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < n; i++) {
    const u = clip.loop ? i / n : n > 1 ? i / (n - 1) : 0;
    frames.push(gameSize(R, drawFrame(R, B, skel, clip, look, u * clip.duration).canvas, skel));
  }
  const fw = frames[0].width, fh = frames[0].height, atlas = R.canvas(fw * n, fh), g = atlas.getContext("2d")!;
  frames.forEach((f, i) => g.drawImage(f, i * fw, 0));
  return { atlas, frames };
}

export function download(c: HTMLCanvasElement, name: string) {
  const a = el("a", { href: c.toDataURL("image/png"), download: name + ".png" });
  document.body.append(a); a.click(); a.remove();
}
export async function saveExport(c: HTMLCanvasElement, name: string): Promise<string> {
  const r = await api.exportPng(name, c.toDataURL("image/png").split(",")[1]);
  toast(`Saved ${r.path}${r.backup ? " (previous in " + r.backup + ")" : ""}`, "ok", 5000);
  return r.path;
}

/** A modal showing a canvas with Download / Save buttons; `extra` gets live content (the animated bake preview). */
export function showExport(title: string, canvas: HTMLCanvasElement, name: string, extra?: HTMLElement, onClose?: () => void) {
  const close = () => { back.remove(); onClose?.(); };
  canvas.classList.add("export-canvas");
  const box = el("div", { class: "modal-form export-box", id: "rig-export-box" },
    el("h3", { text: title }),
    extra || null,
    el("div", { class: "export-scroll" }, canvas),
    el("div", { class: "row end" },
      el("span", { class: "hint grow", text: `art-sources/lab/exports/${name}.png` }),
      el("button", { text: "Download PNG", id: "rig-export-download", onclick: () => download(canvas, name) }),
      el("button", { class: "primary", id: "rig-export-save", text: "Save to art-sources/lab", onclick: () => saveExport(canvas, name).catch((e) => toast("Export failed: " + e.message, "err")) }),
      el("button", { class: "ghost", id: "rig-export-close", text: "Close", onclick: close })));
  const back = el("div", { class: "modal-back", onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Escape") close(); } }, box);
  document.body.append(back);
  (box.querySelector("button.primary") as HTMLElement).focus();
  return close;
}
