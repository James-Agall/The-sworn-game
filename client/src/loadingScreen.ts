// loadingScreen.ts: the loading screen for big worlds (2026-11-10). Shown while the server makes or loads a world of
// LOADING_SCREEN_MIN_WORLD_TILES+ (its `loadProgress` messages: named stages, a percent that never goes back), then
// while this browser fetches the map around the hero (chunk transfer, or the one full welcome below 768 tiles), then
// "Starting" until the first snapshot. Server work fills the bar to SERVER_SHARE %, the map transfer the rest.
// Cancel (only while the server says the job is cancellable) asks the server to stop; the server then makes a small
// stand-in world and this browser goes back to the main menu. Tips rotate every TIP_MS.
import { LOAD_STAGES, LOADING_SCREEN_MIN_WORLD_TILES, type LoadStageId } from "@colony/shared/streaming";
import type { ServerMessage } from "@colony/shared/protocol";

type LoadProgress = Extract<ServerMessage, { type: "loadProgress" }>;
type ShownStage = LoadStageId | "map";

const SERVER_SHARE = 85;
const TIP_MS = 6000;
const HIDE_AFTER_MS = 450;
const MAP_STAGE_MAX_MS = 20000;
const LABEL: Record<ShownStage, string> = {
  ...(Object.fromEntries(LOAD_STAGES.map((s) => [s.id, s.label])) as Record<LoadStageId, string>),
  map: "Sending map to your browser",
};
const GEN_STAGES: LoadStageId[] = ["terrain", "settlements", "resources", "camps", "wildlife"];
const SIZE_NAME: Record<number, string> = { 512: "Giant", 1024: "Vast", 2048: "Colossal" };

// Real tips from the newer systems (keys and numbers as the game has them).
const TIPS = [
  "Tab switches to the bird's-eye strategy view; Shift+Space pauses the world for everyone.",
  "Shift+[ and Shift+] step the game speed down and up (a quarter to double speed).",
  "A year is four seasons of seven days. Wheat grows from spring to mid-autumn, hemp only in summer; nothing grows outdoors in winter.",
  "The Work tab sets each villager's job priorities: 1 is done first, 4 last, an empty cell never.",
  "Paint growing zones for wheat or hemp, and stockpile zones for your haulers to fill.",
  "Every settlement has a quest giver (a Reeve, Bailiff or Herald). Look for the \"!\" over their head.",
  "Bandit camps keep prisoners. Clear a camp to set them free.",
  "Press E next to your own adult horse to ride it (faster outdoors); X gets you off.",
  "A Stables horse nobody rides pulls your trade wagons a quarter faster.",
  "The Ogre Warlord holds the Castle Ruin. Elite mini-boss packs roam the wilds too.",
  "Far regions of a Vast map run on their own: camps there raid and besiege settlements. The Chronicle tells you what happened.",
  "Hostile monsters kill animals left outdoors. Animal houses call their animals in when a threat comes near.",
  "Each day rolls its own weather: rain, storms and morning fog, snow in winter.",
];

export interface LoadingScreen {
  // Every loadProgress from the server.
  onProgress(m: LoadProgress): void;
  // A welcome arrived: true when the screen is up (the map transfer stage starts).
  onWelcome(worldTiles: number, chunked: boolean): boolean;
  // Map transfer progress: chunks of the hero's surroundings loaded / wanted (chunked worlds), checked every frame.
  onMapProgress(loaded: number, wanted: number, snapshotSeen: boolean): void;
  active(): boolean;
}

export function createLoadingScreen(opts: { onCancel: () => void; onBackToMenu: () => void }): LoadingScreen {
  const root = document.getElementById("loading-screen")!;
  const titleEl = document.getElementById("loading-title")!;
  const subEl = document.getElementById("loading-sub")!;
  const fillEl = document.getElementById("loading-fill")!;
  const barEl = document.getElementById("loading-bar")!;
  const pctEl = document.getElementById("loading-pct")!;
  const stageEl = document.getElementById("loading-stage")!;
  const listEl = document.getElementById("loading-stages")!;
  const tipEl = document.getElementById("loading-tip")!;
  const cancelBtn = document.getElementById("loading-cancel") as HTMLButtonElement;

  let shown = false;
  let phase: "server" | "map" | "done" = "server";
  let stages: ShownStage[] = [];
  let current: ShownStage = "terrain";
  let pct = 0;
  let cancellable = false;
  let cancelAsked = false;
  let tipIndex = Math.floor(Math.random() * TIPS.length);
  let tipTimer = 0;
  let hideTimer = 0;
  let listKey = "";

  function showTip() {
    tipEl.classList.remove("tip-in");
    // Restart the fade-in.
    void tipEl.offsetWidth;
    tipEl.textContent = TIPS[tipIndex % TIPS.length];
    tipEl.classList.add("tip-in");
    tipIndex++;
  }

  function render() {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    fillEl.style.width = `${p}%`;
    barEl.setAttribute("aria-valuenow", String(p));
    pctEl.textContent = `${p}%`;
    stageEl.textContent = `${LABEL[current]}…`;
    const at = stages.indexOf(current);
    const key = `${phase}|${current}|${stages.join(",")}|${cancellable}|${cancelAsked}`;
    if (key === listKey) return;
    listKey = key;
    listEl.replaceChildren(
      ...stages.map((s, i) => {
        const li = document.createElement("li");
        li.textContent = LABEL[s];
        li.className = phase === "done" || i < at ? "done" : i === at ? "active" : "";
        return li;
      })
    );
    cancelBtn.hidden = phase === "done";
    cancelBtn.textContent = phase === "server" && cancellable ? (cancelAsked ? "Cancelling…" : "Cancel") : "Back to menu";
    cancelBtn.disabled = cancelAsked;
  }

  function show(m: LoadProgress) {
    window.clearTimeout(hideTimer);
    shown = true;
    phase = "server";
    pct = 0;
    cancelAsked = false;
    const name = SIZE_NAME[m.size] ? `${SIZE_NAME[m.size]} map, ` : "";
    titleEl.textContent = m.kind === "load" ? "Loading your world" : "Forging a new world";
    subEl.textContent = `${name}${m.size} x ${m.size} tiles`;
    stages = m.kind === "load" ? ["read"] : [...GEN_STAGES];
    if (m.kind === "new" && m.size >= 768) stages.push("cache");
    stages.push("map", "starting");
    root.hidden = false;
    root.setAttribute("aria-busy", "true");
    showTip();
    window.clearInterval(tipTimer);
    tipTimer = window.setInterval(showTip, TIP_MS);
  }

  function hide() {
    shown = false;
    phase = "done";
    window.clearInterval(tipTimer);
    root.hidden = true;
    root.setAttribute("aria-busy", "false");
  }

  function finish() {
    phase = "done";
    current = "starting";
    pct = 100;
    render();
    hideTimer = window.setTimeout(hide, HIDE_AFTER_MS);
  }

  cancelBtn.addEventListener("click", () => {
    cancelBtn.blur();
    if (phase === "server" && cancellable) {
      cancelAsked = true;
      render();
      opts.onCancel();
    } else {
      opts.onBackToMenu();
    }
  });

  return {
    onProgress(m) {
      if (m.stage === "cancelled") {
        if (shown && cancelAsked) opts.onBackToMenu();
        else if (shown) hide();
        return;
      }
      if (m.size < LOADING_SCREEN_MIN_WORLD_TILES) return;
      if (!shown || phase !== "server") show(m);
      if (m.stage !== "starting") {
        // A load that has to rebuild its base world from the seed: its generation stages join the list.
        if (!stages.includes(m.stage)) {
          const order = LOAD_STAGES.map((s) => s.id as ShownStage);
          stages = [...stages.filter((s) => s !== "map" && s !== "starting"), m.stage].sort((a, b) => order.indexOf(a) - order.indexOf(b));
          stages.push("map", "starting");
        }
        current = m.stage;
      }
      cancellable = m.cancellable === true;
      pct = Math.max(pct, (m.pct * SERVER_SHARE) / 100);
      render();
    },
    onWelcome(_worldTiles, chunked) {
      if (!shown || phase !== "server") return false;
      phase = "map";
      current = "map";
      pct = Math.max(pct, SERVER_SHARE);
      cancellable = false;
      render();
      // A full welcome brought the whole map at once.
      if (!chunked) pct = 98;
      // Never stuck: whatever the chunks do, the world is there.
      window.setTimeout(() => {
        if (phase === "map") finish();
      }, MAP_STAGE_MAX_MS);
      return true;
    },
    onMapProgress(loaded, wanted, snapshotSeen) {
      if (!shown || phase !== "map") return;
      const frac = wanted > 0 ? Math.min(1, loaded / wanted) : 1;
      pct = Math.max(pct, SERVER_SHARE + (98 - SERVER_SHARE) * frac);
      if (frac >= 1 && snapshotSeen) {
        current = "starting";
        finish();
        return;
      }
      render();
    },
    active: () => shown,
  };
}
