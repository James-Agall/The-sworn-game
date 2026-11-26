// Pause / restart buttons, time-scale buttons and keys, and the 'paused by / speed set by' status line.
// Split out of main.ts (2026-11-26).
import { menuPrefs } from "../menu";
import { Text } from "pixi.js";
import { setupCreative } from "../creative";
import type { PlayerSnapshot } from "@colony/shared/protocol";
import { TIME_SCALES } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface TimeControlsContext {
  socket: WebSocket;
  pausedBanner: Text;
  creativeUi: ReturnType<typeof setupCreative>;
  readonly myId: string | null;
}

export function createTimeControls(game: TimeControlsContext) {
  const { socket, pausedBanner, creativeUi } = game;
  const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
  const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
  pauseBtn.addEventListener("click", () => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "pause" }));
    }
    pauseBtn.blur();
  });
  // ---- Strategy mode phase 5: global time controls. Pause and speed are the server's, for everyone (no
  // handshake: whoever changes them last wins); the status line says who it was. Shift+Space pauses /
  // resumes, Shift+[ / Shift+] step the speed down / up (plain [ ] stay build hotkeys).
  const timeControlsEl = document.getElementById("time-controls")!;
  const timeStatusEl = document.getElementById("time-status")!;
  let currentTimeScale = 1;
  let currentPaused = false;
  function sendTimeScale(scale: number) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "setTimeScale", scale }));
  }
  for (const b of Array.from(timeControlsEl.querySelectorAll<HTMLButtonElement>("button[data-scale]"))) {
    b.addEventListener("click", () => {
      b.blur();
      sendTimeScale(Number(b.dataset.scale));
    });
  }
  window.addEventListener("keydown", (e) => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "pause", paused: !currentPaused }));
      return;
    }
    const step = e.code === "BracketLeft" ? -1 : e.code === "BracketRight" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    if (e.repeat) return;
    const scales = TIME_SCALES as readonly number[];
    const i = Math.max(0, scales.indexOf(currentTimeScale));
    const next = scales[Math.max(0, Math.min(scales.length - 1, i + step))];
    if (next !== currentTimeScale) sendTimeScale(next);
  });
  function whoLabel(id: string | undefined, players: PlayerSnapshot[]): string {
    if (!id) return "";
    if (id === game.myId) return "you";
    const i = players.findIndex((p) => p.id === id);
    return i >= 0 ? `Player ${i + 1}` : "a player who left";
  }
  function syncTimeControls(paused: boolean, pausedBy: string | undefined, scale: number, scaleBy: string | undefined, players: PlayerSnapshot[]) {
    currentPaused = paused;
    currentTimeScale = scale;
    for (const b of Array.from(timeControlsEl.querySelectorAll<HTMLButtonElement>("button[data-scale]"))) {
      b.classList.toggle("active", Number(b.dataset.scale) === scale);
    }
    const speed = scale === 1 ? "" : `${scale === 0.25 ? "¼" : scale === 0.5 ? "½" : `${scale}x`} speed`;
    const parts: string[] = [];
    if (paused) parts.push(`Paused${pausedBy ? ` by ${whoLabel(pausedBy, players)}` : ""}`);
    if (speed) parts.push(`${speed}${scaleBy ? ` (set by ${whoLabel(scaleBy, players)})` : ""}`);
    const text = parts.join(" · ");
    timeStatusEl.hidden = text === "";
    if (timeStatusEl.textContent !== text) timeStatusEl.textContent = text;
    const banner = paused && pausedBy ? `PAUSED by ${whoLabel(pausedBy, players)}` : "PAUSED";
    if (pausedBanner.text !== banner) pausedBanner.text = banner;
  }
  restartBtn.addEventListener("click", () => {
    restartBtn.blur();
    if (!window.confirm("Restart the world for everyone connected?")) return;
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "restart", difficulty: menuPrefs.preferredDifficulty, worldSize: menuPrefs.preferredWorldSize, creative: creativeUi.on, solo: menuPrefs.preferredSolo && !creativeUi.on }));
    }
  });
  return { pauseBtn, syncTimeControls, get currentPaused() { return currentPaused; } };
}
