// Builders / respawn status lines, the game-over overlay and the heir picker. Split out of main.ts (2026-11-26).
import { menuPrefs } from "../menu";
import { setupCreative } from "../creative";
import type { PlayerSnapshot, ColonistSnapshot } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface GameOverContext {
  sendMessage: (msg: object) => void;
  creativeUi: ReturnType<typeof setupCreative>;
}

export function createGameOver(game: GameOverContext) {
  const { sendMessage, creativeUi } = game;
  // ---- Builders counter and game over ----
  const statBuildersEl = document.getElementById("stat-builders")!;
  const statRespawnEl = document.getElementById("stat-respawn")!;
  function refreshBuilderCount(colonists: ColonistSnapshot[], isNight: boolean) {
    let total = 0;
    let working = 0;
    for (const c of colonists) {
      if (c.kind !== "builder") continue;
      total++;
      if (!isNight && (c.state === "building" || c.state === "carrying" || c.state === "repairing" || c.state === "toRepair")) working++;
    }
    statBuildersEl.textContent = `Builders  ${working}/${total} working`;
  }
  const gameOverEl = document.getElementById("game-over")!;
  // Village life phase 5: a dead rider with `heirs` picks one (heir picker); dead without heirs is game over.
  const heirPickerEl = document.getElementById("heir-picker")!;
  const heirListEl = document.getElementById("heir-list")!;
  let heirListKey = "";
  function refreshGameOver(me: PlayerSnapshot | undefined) {
    const heirs = me?.dead ? me.heirs ?? [] : [];
    gameOverEl.hidden = !(me?.dead && heirs.length === 0);
    heirPickerEl.hidden = heirs.length === 0;
    const key = JSON.stringify(heirs);
    if (key === heirListKey) return;
    heirListKey = key;
    heirListEl.replaceChildren(
      ...heirs.map((h) => {
        const b = document.createElement("button");
        b.className = "menu-btn secondary heir-btn";
        const role = h.kind.replace(/[A-Z]/g, (ch) => " " + ch.toLowerCase());
        b.textContent = h.id === "church" ? h.name : `${h.name}: ${role}${h.heroLevel ? `, level ${h.heroLevel}` : ""}${h.ageDays !== undefined ? `, ${h.ageDays} days old` : ""}`;
        b.addEventListener("click", () => {
          b.blur();
          sendMessage({ type: "chooseHeir", id: h.id });
        });
        return b;
      })
    );
  }
  document.getElementById("game-over-restart")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    sendMessage({ type: "restart", difficulty: menuPrefs.preferredDifficulty, worldSize: menuPrefs.preferredWorldSize, creative: creativeUi.on, solo: menuPrefs.preferredSolo && !creativeUi.on });
  });
  return { refreshGameOver, refreshBuilderCount, statRespawnEl };
}
