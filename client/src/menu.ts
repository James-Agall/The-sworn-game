import { ADVENTURE_CAM_PREF, START_STRATEGY_PREF } from "./adventure";
import { DEFAULT_HERO_APPEARANCE, autosaveNumber, saveSlotLabel } from "@colony/shared/protocol";
import type { Difficulty, HeroAppearance, SaveInfo, SaveSlot } from "@colony/shared/protocol";
import { sound } from "./soundTriggers";

// State the main menu sets and main() reads (one shared object, read live, never copied).
export const menuPrefs: {
  // The menu choice: sent as setDifficulty after every welcome, and with an in-game Restart.
  preferredDifficulty: Difficulty;
  // Vast (1024) unless the player picked another size before (remembered in localStorage). The server's own default
  // (COLONY_WORLD_SIZE or 160) only applies to clients that send no size, such as the scripted tests.
  preferredWorldSize: number | undefined;
  // Main menu Continue / Load Game: the slot to load right after the first welcome (else null).
  pendingLoadSlot: SaveSlot | null;
  // Creative mode: the menu's game mode (Creative button / ?mode=creative), enforced on the first welcome after
  // New Game / Creative (never after Continue / Load: a save brings its own mode).
  preferredCreative: boolean;
  // Solo hero phase 4: the menu's "New Game (Solo)" (or ?mode=solo): start as the hero alone, no settlement.
  preferredSolo: boolean;
  enforceGameMode: boolean;
  pendingCreatorAppearance: HeroAppearance | null;
} = {
  preferredDifficulty: "normal",
  preferredWorldSize: 1024,
  pendingLoadSlot: null,
  preferredCreative: new URLSearchParams(location.search).get("mode") === "creative",
  preferredSolo: new URLSearchParams(location.search).get("mode") === "solo",
  enforceGameMode: false,
  pendingCreatorAppearance: null,
};

// Main menu: the game (and its server connection) only starts once Start is pressed. Settings are
// client-only prefs kept in localStorage, plus the Difficulty choice that's sent to the server on
// join. There is ONE settings panel: it lives in the main menu until Start, then moves into the
// in-game #settings-modal (opened by the Settings control button). "Menu" in-game reloads back here.
const DIFFICULTY_PREF_KEY = "sworn.difficulty";
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
// The menu choice: sent as setDifficulty after every welcome, and with an in-game Restart.
// Map size (tiles per side) chosen in the menu; New Game / Restart regenerate the world at it.
const MAP_SIZE_PREF_KEY = "sworn.mapSize";
// Clans: the main menu's Clan choice (sent as the ws URL's `?clan=`): join the clan already playing (clan 0)
// or found a new one. A page URL `?clan=new` / `?clan=<id>` overrides it (e.g. to join clan 2).
let preferredClan: "join" | "new" = "join";
export function clanParam(): string {
  const fromPage = new URLSearchParams(location.search).get("clan");
  if (fromPage && /^(new|\d{1,3})$/.test(fromPage)) return fromPage;
  return preferredClan === "new" ? "new" : "";
}
function renderClanChoice() {
  document.querySelectorAll<HTMLButtonElement>("#set-clan button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.clan === preferredClan));
  });
}
const MAP_SIZES = [64, 96, 160, 256, 384, 512, 768, 1024, 2048];
// Vast (1024) unless the player picked another size before (remembered in localStorage). The server's own default
// (COLONY_WORLD_SIZE or 160) only applies to clients that send no size, such as the scripted tests.
function renderMapSizeChoice(value: number | undefined) {
  document.querySelectorAll<HTMLButtonElement>("#set-mapsize button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(Number(btn.dataset.size) === (value ?? 1024)));
  });
  // 2048: long load, needs a strong PC.
  document.getElementById("set-mapsize-warn")!.hidden = value !== 2048;
}
let gameStarted = false;
// The world's active difficulty as the server reports it (null until the first welcome).
let activeDifficulty: Difficulty | null = null;

function renderDifficultyChoice(value: Difficulty) {
  document.querySelectorAll<HTMLButtonElement>("#set-difficulty button").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.difficulty === value));
  });
}

// Called from main() on every welcome/snapshot; cheap no-op unless the value changed.
export function setActiveDifficulty(value: Difficulty) {
  if (value === activeDifficulty) return;
  activeDifficulty = value;
  document.getElementById("stat-difficulty")!.textContent = `${DIFFICULTY_LABEL[value]} difficulty`;
  if (gameStarted) renderDifficultyChoice(value);
}

// "Slot 1", "Autosave 48", ... (one name per slot, shared with the server's save labels).
export { saveSlotLabel };

// Continue: the newest numbered autosave (listSaves lists those newest first), else an old single autosave file.
export function newestAutosave(saves: SaveInfo[]): SaveSlot | null {
  let best: SaveInfo | null = null;
  for (const sv of saves) {
    const n = autosaveNumber(sv.slot);
    if (n !== null && (best === null || n > (autosaveNumber(best.slot) ?? 0))) best = sv;
  }
  return best?.slot ?? saves.find((sv) => sv.slot === "autosave")?.slot ?? null;
}

export function describeSave(sv: SaveInfo): string {
  return `${sv.creative ? "Creative · " : ""}Day ${sv.dayIndex + 1} · ${sv.population} pop · ${DIFFICULTY_LABEL[sv.difficulty]}`;
}

// One parchment row per slot: name + day/population/difficulty + when, then its buttons.
export function renderSaveRows(
  container: HTMLElement,
  rows: { slot: SaveSlot; info?: SaveInfo; buttons: { label: string; secondary?: boolean; onClick: () => void }[] }[],
  emptyText?: string
) {
  container.replaceChildren();
  if (rows.length === 0 && emptyText) {
    const empty = document.createElement("div");
    empty.className = "save-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "save-row";
    const text = document.createElement("span");
    text.textContent = saveSlotLabel(row.slot);
    const note = document.createElement("small");
    note.textContent = row.info
      ? `${describeSave(row.info)} · ${new Date(row.info.savedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
      : "Empty";
    text.append(note);
    const btns = document.createElement("span");
    btns.className = "save-btns";
    for (const b of row.buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      if (b.secondary) btn.className = "secondary";
      btn.addEventListener("click", () => {
        btn.blur();
        b.onClick();
      });
      btns.append(btn);
    }
    el.append(text, btns);
    container.append(el);
  }
}

export function setupMainMenu(deps: { serverUrl: string; startGame: () => void }) {
  const QUIT_URL = `${deps.serverUrl.replace(/^ws/, "http")}/quit`;
  const SAVES_URL = `${deps.serverUrl.replace(/^ws/, "http")}/saves`;
  const menu = document.getElementById("main-menu")!;
  const mainPanel = document.getElementById("menu-main")!;
  const settingsPanel = document.getElementById("menu-settings-panel")!;
  const settingsModal = document.getElementById("settings-modal")!;
  const settingsModalScroll = document.getElementById("settings-modal-scroll")!;
  const minimapBox = document.getElementById("set-minimap") as HTMLInputElement;
  const eventsBox = document.getElementById("set-events") as HTMLInputElement;
  const difficultySeg = document.getElementById("set-difficulty")!;
  const difficultyNote = document.getElementById("set-difficulty-note")!;

  const load = (key: string): boolean => {
    try {
      return localStorage.getItem(key) !== "off";
    } catch {
      return true;
    }
  };
  const save = (key: string, on: boolean) => {
    try {
      localStorage.setItem(key, on ? "on" : "off");
    } catch {
      /* private mode: setting just won't persist */
    }
  };
  const apply = () => {
    document.body.classList.toggle("hide-minimap", !minimapBox.checked);
    document.body.classList.toggle("hide-events", !eventsBox.checked);
  };
  // Sound: sliders/mute edit sound.volumes live (persisted by SoundManager). The AudioContext is
  // created on the first menu click (a user gesture), at the latest on Start.
  const volumeInputs: { el: HTMLInputElement; key: "master" | "music" | "sfx" }[] = [
    { el: document.getElementById("set-vol-master") as HTMLInputElement, key: "master" },
    { el: document.getElementById("set-vol-music") as HTMLInputElement, key: "music" },
    { el: document.getElementById("set-vol-sfx") as HTMLInputElement, key: "sfx" },
  ];
  const muteBox = document.getElementById("set-mute") as HTMLInputElement;
  for (const { el, key } of volumeInputs) {
    el.value = String(Math.round(sound.volumes[key] * 100));
    el.addEventListener("input", () => sound.setVolumes({ [key]: Number(el.value) / 100 }));
    // A sample at the new level once the slider is released.
    if (key !== "music") el.addEventListener("change", () => sound.play("ui_click", { cooldownMs: 0 }));
  }
  muteBox.checked = sound.volumes.muted;
  muteBox.addEventListener("change", () => sound.setVolumes({ muted: muteBox.checked }));
  document.addEventListener(
    "pointerdown",
    () => {
      if (!sound.unlocked) sound.unlock();
    },
    { capture: true }
  );
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, #build-panel-toggle, #economy-panel-toggle")) sound.play("ui_click");
  });

  minimapBox.checked = load("sworn.minimap");
  // Village life phase 5: camera settings (read at page load by readAdventurePrefs, so they apply after a reload).
  const adventureCamBox = document.getElementById("set-adventure-cam") as HTMLInputElement;
  const startStrategyBox = document.getElementById("set-start-strategy") as HTMLInputElement;
  adventureCamBox.checked = load(ADVENTURE_CAM_PREF);
  try {
    startStrategyBox.checked = localStorage.getItem(START_STRATEGY_PREF) === "on";
  } catch {
    startStrategyBox.checked = false;
  }
  adventureCamBox.addEventListener("change", () => save(ADVENTURE_CAM_PREF, adventureCamBox.checked));
  startStrategyBox.addEventListener("change", () => save(START_STRATEGY_PREF, startStrategyBox.checked));
  eventsBox.checked = load("sworn.events");
  apply();
  minimapBox.addEventListener("change", () => {
    save("sworn.minimap", minimapBox.checked);
    apply();
  });
  eventsBox.addEventListener("change", () => {
    save("sworn.events", eventsBox.checked);
    apply();
  });

  try {
    const stored = localStorage.getItem(DIFFICULTY_PREF_KEY);
    if (stored === "easy" || stored === "normal" || stored === "hard") menuPrefs.preferredDifficulty = stored;
  } catch {
    /* default stays Normal */
  }
  renderDifficultyChoice(menuPrefs.preferredDifficulty);
  try {
    const storedSize = Number(localStorage.getItem(MAP_SIZE_PREF_KEY));
    if (MAP_SIZES.includes(storedSize)) menuPrefs.preferredWorldSize = storedSize;
  } catch {
    /* default stays Vast */
  }
  renderMapSizeChoice(menuPrefs.preferredWorldSize);
  renderClanChoice();
  document.getElementById("set-clan")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-clan]");
    if (btn?.dataset.clan !== "join" && btn?.dataset.clan !== "new") return;
    preferredClan = btn.dataset.clan;
    renderClanChoice();
  });
  const mapSizeSeg = document.getElementById("set-mapsize")!;
  mapSizeSeg.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-size]");
    const value = Number(btn?.dataset.size);
    if (!MAP_SIZES.includes(value)) return;
    menuPrefs.preferredWorldSize = value;
    renderMapSizeChoice(value);
    try {
      localStorage.setItem(MAP_SIZE_PREF_KEY, String(value));
    } catch {
      /* private mode: setting just won't persist */
    }
  });
  difficultySeg.addEventListener("click", (e) => {
    // Read-only once the game is running: the world's difficulty is fixed until a restart.
    if (gameStarted) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-difficulty]");
    const value = btn?.dataset.difficulty;
    if (value !== "easy" && value !== "normal" && value !== "hard") return;
    menuPrefs.preferredDifficulty = value;
    renderDifficultyChoice(value);
    try {
      localStorage.setItem(DIFFICULTY_PREF_KEY, value);
    } catch {
      /* private mode: setting just won't persist */
    }
  });

  const closeModal = () => {
    settingsModal.hidden = true;
  };
  let choosingCharacter = false;
  const startGame = async (loadSlot: SaveSlot | null, creative = menuPrefs.preferredCreative, solo = false) => {
    if (choosingCharacter) return;
    if (loadSlot === null) {
      // Appearance selection is intentionally disabled while only the fixed hero is supported.
      menuPrefs.pendingCreatorAppearance = { ...DEFAULT_HERO_APPEARANCE };
    }
    menuPrefs.pendingLoadSlot = loadSlot;
    menuPrefs.preferredCreative = creative;
    menuPrefs.preferredSolo = solo && !creative;
    menuPrefs.enforceGameMode = loadSlot === null;
    sound.unlock();
    menu.hidden = true;
    gameStarted = true;
    // Hand the one settings panel over to the in-game modal.
    settingsModalScroll.appendChild(settingsPanel);
    settingsPanel.hidden = false;
    difficultySeg.classList.add("readonly");
    difficultySeg.setAttribute("aria-disabled", "true");
    difficultyNote.textContent = "Fixed for this world; a Restart uses your menu choice";
    document.getElementById("menu-back")!.textContent = "Close";
    if (activeDifficulty) renderDifficultyChoice(activeDifficulty);
    deps.startGame();
  };
  // New Game keeps the old Start behaviour (whatever world the server is running, menu difficulty).
  document.getElementById("menu-start")!.addEventListener("click", () => startGame(null));
  // Creative mode: a new creative world (infinite resources, instant build, the Creative panel).
  document.getElementById("menu-creative")!.addEventListener("click", () => startGame(null, true));
  document.getElementById("menu-solo")!.addEventListener("click", () => startGame(null, false, true));
  if (menuPrefs.preferredCreative) document.getElementById("menu-start")!.textContent = "New Game (Creative)";
  let continueSlot: SaveSlot | null = null;
  document.getElementById("menu-continue")!.addEventListener("click", () => {
    if (continueSlot) startGame(continueSlot);
  });
  const loadPanel = document.getElementById("menu-load-panel")!;
  document.getElementById("menu-load")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    loadPanel.hidden = false;
  });
  document.getElementById("menu-load-back")!.addEventListener("click", () => {
    loadPanel.hidden = true;
    mainPanel.hidden = false;
  });
  // Continue / Load Game only show once the server reports saves (silently absent if it's down).
  fetch(SAVES_URL)
    .then((res) => res.json() as Promise<{ saves: SaveInfo[] }>)
    .then(({ saves }) => {
      if (gameStarted) return;
      continueSlot = newestAutosave(saves);
      document.getElementById("menu-continue")!.hidden = continueSlot === null;
      document.getElementById("menu-load")!.hidden = saves.length === 0;
      renderSaveRows(
        document.getElementById("menu-load-list")!,
        saves.map((sv) => ({
          slot: sv.slot,
          info: sv,
          buttons: [{ label: "Load", onClick: () => startGame(sv.slot) }],
        }))
      );
    })
    .catch(() => {
      /* server unreachable: New Game only */
    });
  document.getElementById("menu-settings")!.addEventListener("click", () => {
    mainPanel.hidden = true;
    settingsPanel.hidden = false;
  });
  document.getElementById("menu-back")!.addEventListener("click", () => {
    if (gameStarted) {
      closeModal();
      return;
    }
    settingsPanel.hidden = true;
    mainPanel.hidden = false;
  });
  document.getElementById("settings-btn")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    settingsModal.hidden = !settingsModal.hidden;
  });
  // Backdrop click or Escape closes; keys typed into the panel (arrows on a slider) don't reach the
  // game's movement/hotkey handlers on window.
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeModal();
  });
  settingsModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    e.stopPropagation();
  });
  // Escape with focus outside the panel (e.g. right after opening it).
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.hidden) closeModal();
  });
  document.getElementById("menu-exit")!.addEventListener("click", () => {
    // Stop the game server (it autosaves first; the page server of the live / launcher copies stops with it).
    fetch(QUIT_URL, { method: "POST", headers: { "X-Colony-Quit": "1" } }).catch(() => undefined);
    // Browsers only let a script close a tab it opened; otherwise show a goodbye line.
    window.close();
    document.getElementById("menu-bye")!.hidden = false;
  });
  // The Menu button is a dropdown (Restart / Save / Settings / Return to menu). Choosing an item, clicking
  // elsewhere or pressing Escape closes it; "Return to menu" reloads back to the main menu as Menu used to.
  const menuBtn = document.getElementById("menu-btn") as HTMLButtonElement;
  const menuList = document.getElementById("menu-dropdown-list")!;
  const setMenuOpen = (open: boolean) => {
    menuList.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuBtn.blur();
    setMenuOpen(menuList.hidden);
  });
  menuList.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) setMenuOpen(false);
  });
  window.addEventListener("click", (e) => {
    if (!menuList.hidden && !(e.target as HTMLElement).closest("#menu-dropdown")) setMenuOpen(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuList.hidden) setMenuOpen(false);
  });
  document.getElementById("return-menu-btn")!.addEventListener("click", () => location.reload());
}

