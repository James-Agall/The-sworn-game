// World streaming phase 5: the chronicle panel (server `chronicle` messages), lifted verbatim from main.ts.
import type { ChronicleEntry, ClientMessage, GameEventCategory } from "@colony/shared/protocol";

export interface ChronicleDeps {
  send: (msg: ClientMessage) => void;
  pushEventToast: (category: GameEventCategory, text: string) => void;
}

export interface ChronicleUi {
  onChronicle(m: { entries: ChronicleEntry[]; since?: number; full?: boolean }): void;
}

export function setupChronicle(deps: ChronicleDeps): ChronicleUi {
  const sendMessage = deps.send;
  const pushEventToast = deps.pushEventToast;

  // ---- World streaming phase 5: the chronicle (server `chronicle` messages) ----
  const chroniclePanelEl = document.getElementById("chronicle-panel")!;
  const chronicleListEl = document.getElementById("cp-list")!;
  const chronicleEmptyEl = document.getElementById("cp-empty")!;
  const chronicleBtn = document.getElementById("chronicle-btn") as HTMLButtonElement;
  let chronicleEntries: ChronicleEntry[] = [];
  // Entries with an id above this arrived "while you were away" (the profile's read mark on the server).
  let chronicleAwaySince = 0;
  let chronicleRead = 0;
  function onChronicle(m: { entries: ChronicleEntry[]; since?: number; full?: boolean }) {
    if (m.full) {
      chronicleEntries = [...m.entries];
      chronicleAwaySince = chronicleRead = m.since ?? 0;
      const away = chronicleEntries.filter((e) => e.id > chronicleAwaySince).length;
      if (away > 0) pushEventToast("milestone", `While you were away: ${away} entr${away === 1 ? "y" : "ies"} in the Chronicle`);
    } else {
      chronicleEntries.push(...m.entries);
      if (chronicleEntries.length > 120) chronicleEntries.splice(0, chronicleEntries.length - 120);
    }
    renderChronicle();
  }
  function renderChronicle() {
    const open = !chroniclePanelEl.hidden;
    const last = chronicleEntries.length ? chronicleEntries[chronicleEntries.length - 1].id : 0;
    if (open && last > chronicleRead) {
      chronicleRead = last;
      sendMessage({ type: "chronicleSeen", id: last });
    }
    const unread = chronicleEntries.filter((e) => e.id > chronicleRead).length;
    chronicleBtn.textContent = unread > 0 ? `Chronicle (${unread})` : "Chronicle";
    chronicleBtn.classList.toggle("has-new", unread > 0);
    if (!open) return;
    chronicleEmptyEl.hidden = chronicleEntries.length > 0;
    chronicleListEl.replaceChildren();
    // House line list (heir successions), pinned above the feed, oldest first.
    const houseLines = chronicleEntries.filter((e) => e.kind === "house");
    if (houseLines.length) {
      const h = document.createElement("div");
      h.className = "cp-head";
      h.textContent = "The House";
      chronicleListEl.append(h);
      for (const e of houseLines) {
        const row = document.createElement("div");
        row.className = "cp-entry";
        row.textContent = e.text;
        chronicleListEl.append(row);
      }
    }
    // Newest first: the "while you were away" block, then the rest under "Earlier".
    type Section = "" | "away" | "earlier";
    let section = "" as Section;
    for (const e of [...chronicleEntries].reverse()) {
      const away = e.id > chronicleAwaySince;
      const want: Section = away ? "away" : section === "away" ? "earlier" : section;
      if (want !== section) {
        const h = document.createElement("div");
        h.className = "cp-head";
        h.textContent = want === "away" ? "While you were away" : "Earlier";
        chronicleListEl.append(h);
        section = want;
      }
      const row = document.createElement("div");
      row.className = `cp-entry${away ? " new" : ""}`;
      const day = document.createElement("span");
      day.className = "cp-day";
      day.textContent = `Day ${e.day}`;
      row.append(day, e.text);
      chronicleListEl.append(row);
    }
  }
  function setChroniclePanelOpen(open: boolean) {
    chroniclePanelEl.hidden = !open;
    // Closing it: what was read is no longer "while you were away".
    if (!open) chronicleAwaySince = chronicleRead;
    renderChronicle();
  }
  chronicleBtn.addEventListener("click", () => {
    chronicleBtn.blur();
    setChroniclePanelOpen(chroniclePanelEl.hidden);
  });
  document.getElementById("cp-close")!.addEventListener("click", () => setChroniclePanelOpen(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !chroniclePanelEl.hidden) setChroniclePanelOpen(false);
  });
  return { onChronicle };
}
