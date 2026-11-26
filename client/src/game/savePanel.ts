// Save / load panel (Menu > Save): quick-save slot memory, the slot list and the load list. Split out of main.ts (2026-11-26).
import { renderSaveRows, describeSave, saveSlotLabel } from "../menu";
import { setupCreative } from "../creative";
import type { SaveInfo, SaveSlot } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface SavePanelContext {
  sendMessage: (msg: object) => void;
  creativeUi: ReturnType<typeof setupCreative>;
}

export function createSavePanel(game: SavePanelContext) {
  const { sendMessage, creativeUi } = game;
  // Quick-save button: saves to the slot you last saved to (Slot 1 the first time), no dialog.
  function getLastSaveSlot(): SaveSlot {
    try {
      const v = localStorage.getItem("sworn.lastSaveSlot");
      if (v === "slot1" || v === "slot2" || v === "slot3") return v;
    } catch {
      /* ignore */
    }
    return "slot1";
  }
  function setLastSaveSlot(slot: SaveSlot) {
    try {
      localStorage.setItem("sworn.lastSaveSlot", slot);
    } catch {
      /* ignore */
    }
  }
  document.getElementById("save-btn")!.addEventListener("click", () => {
    sendMessage({ type: "saveGame", slot: getLastSaveSlot() });
  });
  // In-game Save Game section (top of the Settings modal): 3 manual slots, plus Load for every save.
  let latestSaves: SaveInfo[] = [];
  function renderSavePanel(saves: SaveInfo[]) {
    latestSaves = saves;
    const bySlot = new Map(saves.map((sv) => [sv.slot, sv]));
    renderSaveRows(
      document.getElementById("save-slot-list")!,
      // Creative mode: a creative game saves only to its own slot.
      ((creativeUi.on ? ["creative"] : ["slot1", "slot2", "slot3"]) as SaveSlot[]).map((slot) => ({
        slot,
        info: bySlot.get(slot),
        buttons: [
          {
            label: "Save",
            onClick: () => {
              const existing = latestSaves.find((sv) => sv.slot === slot);
              if (existing && !window.confirm(`Overwrite ${saveSlotLabel(slot)} (${describeSave(existing)})?`)) return;
              setLastSaveSlot(slot);
              sendMessage({ type: "saveGame", slot });
            },
          },
        ],
      }))
    );
    renderSaveRows(
      document.getElementById("save-load-list")!,
      saves.map((sv) => ({
        slot: sv.slot,
        info: sv,
        buttons: [
          {
            label: "Load",
            secondary: true,
            onClick: () => {
              if (!window.confirm(`Load ${saveSlotLabel(sv.slot)} for everyone connected? Unsaved progress is lost.`)) return;
              sendMessage({ type: "loadGame", slot: sv.slot });
              document.getElementById("settings-modal")!.hidden = true;
            },
          },
        ],
      })),
      "No saves yet"
    );
  }
  return { renderSavePanel };
}
