// HUD panels fed by snapshots: event toasts, the equipment line, the settlement panel, the goal tracker and the
// boss / player bars. Split out of main.ts (2026-11-26).
import type { PlayerSnapshot, MobSnapshot, GameEventCategory, TownCenterSnapshot, GoalSnapshot, EquipmentStock } from "@colony/shared/protocol";
import { bossTitle, TileType, VISION_RADIUS_PLAYER } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface HudPanelsContext {
  setGoodCount: (key: string, n: number) => void;
  toolButtonEls: Map<TileType, HTMLButtonElement>;
  lastGoalIndex: number;
  readonly myId: string | null;
  readonly tileSize: number;
}

export function createHudPanels(game: HudPanelsContext) {
  const { setGoodCount, toolButtonEls } = game;
  const eventFeedEl = document.getElementById("event-feed")!;
  const TOAST_SHOW_MS = 5000;
  const TOAST_FADE_MS = 600;
  const TOAST_DROP_MS = 200;
  const MAX_TOASTS = 5;
  function removeToast(toast: HTMLElement, cls: "fading" | "dropped", fadeMs: number) {
    if (toast.classList.contains("dropped") || toast.classList.contains("fading")) return;
    toast.classList.add(cls);
    window.setTimeout(() => toast.remove(), fadeMs);
  }
  // ---- Armour & weapons: "Armour T1/T2/T3: 2/0/1 · Weapons: 3/1/0" (amber when a slot is empty) ----
  const statEquipmentEl = document.getElementById("stat-equipment")!;
  let equipmentLineKey = "";
  function refreshEquipmentLine(eq: EquipmentStock | undefined) {
    statEquipmentEl.hidden = !eq;
    if (!eq) return;
    for (let t = 1; t <= 3; t++) {
      setGoodCount(`gear:weapon:${t}`, eq.weapon[t - 1] ?? 0);
      setGoodCount(`gear:armour:${t}`, eq.armour[t - 1] ?? 0);
    }
    const key = `${eq.armour.join("/")}|${eq.weapon.join("/")}`;
    if (key === equipmentLineKey) return;
    equipmentLineKey = key;
    const part = (label: string, counts: number[]) => {
      const span = document.createElement("span");
      span.textContent = `${label}: ${counts.join("/")}`;
      if (counts.every((n) => n <= 0)) {
        span.className = "equip-empty";
        span.title = "None in stock: new soldiers muster without it";
      }
      return span;
    };
    statEquipmentEl.replaceChildren(part("Armour T1/T2/T3", eq.armour), " · ", part("Weapons", eq.weapon));
  }
  // ---- Settlement population (ROADMAP "Settlement population caps"): one Colony panel row per Town
  // Center ("Settlement 1: 9/12"), amber when full, red when over its cap; a toast (throttled per
  // settlement) when one reaches its cap. Rows are rebuilt only when the text changes.
  const statSettlementsEl = document.getElementById("stat-settlements")!;
  const SETTLEMENT_FULL_TOAST_THROTTLE_MS = 60000;
  const settlementWasFull = new Map<number, boolean>();
  const settlementToastAt = new Map<number, number>();
  let settlementPanelKey = "";
  function refreshSettlementPanel(tcs: TownCenterSnapshot[]) {
    // Grey the Keep tool until some Town Center is at level 2 (it stays selectable, the cost text says why).
    const keepBtn = toolButtonEls.get(TileType.Keep);
    if (keepBtn) {
      const keepReady = tcs.some((tc) => tc.level >= 2);
      keepBtn.style.opacity = keepReady ? "" : "0.5";
      keepBtn.title = keepReady ? "" : "Keep needs a Town Center at level 2";
    }
    const rows = tcs.map((tc, i) => ({
      n: i + 1,
      used: tc.population ?? 0,
      cap: tc.populationCap ?? 0,
      known: tc.populationCap !== undefined,
      // Barracks housing: soldiers live in their unit buildings, shown apart from the civilian count.
      troops: tc.troops,
      troopCap: tc.troopCap ?? 0,
    }));
    const key = rows.map((r) => `${r.n}:${r.used}/${r.cap}:${r.troops}/${r.troopCap}`).join("|");
    if (key !== settlementPanelKey) {
      settlementPanelKey = key;
      statSettlementsEl.replaceChildren();
      for (const r of rows) {
        if (!r.known) continue;
        const row = document.createElement("div");
        row.className = "econ-row";
        const label = document.createElement("span");
        label.textContent = `Settlement ${r.n}`;
        const count = document.createElement("span");
        count.textContent = `${r.used}/${r.cap}`;
        if (r.used > r.cap) count.className = "pop-over";
        else if (r.used === r.cap) count.className = "pop-full";
        row.append(label, count);
        statSettlementsEl.append(row);
        if (r.troops !== undefined && r.troopCap > 0) {
          const troopRow = document.createElement("div");
          troopRow.className = "econ-row";
          const troopLabel = document.createElement("span");
          troopLabel.textContent = `Settlement ${r.n} troops`;
          troopLabel.title = "Soldiers live in their unit buildings (each houses its tier headcount + 1 per adjacent house), not in settlement population";
          const troopCount = document.createElement("span");
          troopCount.textContent = `${r.troops}/${r.troopCap}`;
          troopRow.append(troopLabel, troopCount);
          statSettlementsEl.append(troopRow);
        }
      }
    }
    const now = performance.now();
    for (const r of rows) {
      const full = r.known && r.cap > 0 && r.used >= r.cap;
      if (full && !settlementWasFull.get(r.n) && now - (settlementToastAt.get(r.n) ?? -Infinity) >= SETTLEMENT_FULL_TOAST_THROTTLE_MS) {
        settlementToastAt.set(r.n, now);
        pushEventToast("build", `Settlement ${r.n} is at its population cap — upgrade its Town Center or build a Keep`);
      }
      settlementWasFull.set(r.n, full);
    }
  }
  // Newest on top. Past MAX_TOASTS the oldest still-live toast is dropped with a quick fade, so a
  // burst (a whole garrison dying at once) shows its latest few rather than flooding the screen.
  function pushEventToast(category: GameEventCategory, text: string) {
    const toast = document.createElement("div");
    toast.className = `event-toast event-${category}`;
    const icon = document.createElement("img");
    icon.className = "event-icon";
    // "raid" has no art of its own; it borrows the deserter icon (build/milestone the upgrade one, boss the death one).
    const iconName: Partial<Record<GameEventCategory, string>> = { raid: "deserter", build: "upgrade", milestone: "upgrade", boss: "death", morale: "deserter" };
    icon.src = `/sprites/icon-event-${iconName[category] ?? category}.png`;
    icon.alt = "";
    toast.append(icon, text);
    eventFeedEl.prepend(toast);
    const live = Array.from(eventFeedEl.children).filter(
      (el) => !el.classList.contains("dropped") && !el.classList.contains("fading")
    ) as HTMLElement[];
    for (const old of live.slice(MAX_TOASTS)) removeToast(old, "dropped", TOAST_DROP_MS);
    window.setTimeout(() => removeToast(toast, "fading", TOAST_FADE_MS), TOAST_SHOW_MS);
  }
  // ---- Goal tracker (top-right parchment card) and the Ogre Warlord's boss bar ----
  const goalTrackerEl = document.getElementById("goal-tracker")!;
  const goalStepEl = document.getElementById("goal-step")!;
  const goalTitleEl = document.getElementById("goal-title")!;
  const goalFillEl = document.getElementById("goal-progress-fill")!;
  const goalCountEl = document.getElementById("goal-progress-text")!;
  const GOAL_FLASH_MS = 1600;
  let latestGoal: GoalSnapshot | null = null;
  let goalFlashTimer = 0;
  function syncGoal(goal: GoalSnapshot | undefined) {
    latestGoal = goal ?? null;
    if (!goal) {
      goalTrackerEl.hidden = true;
      return;
    }
    goalTrackerEl.hidden = false;
    const done = goal.index >= goal.total;
    goalStepEl.textContent = done ? "Complete" : `${goal.index + 1} / ${goal.total}`;
    goalTitleEl.textContent = goal.title;
    goalFillEl.style.width = `${Math.round((Math.min(goal.progress, goal.target) / goal.target) * 100)}%`;
    goalCountEl.textContent = goal.target > 1 ? `${goal.progress} / ${goal.target}` : done ? "Victory" : "";
    goalTrackerEl.classList.toggle("goal-done", done);
    if (game.lastGoalIndex !== -1 && goal.index > game.lastGoalIndex) {
      goalTrackerEl.classList.remove("goal-flash");
      void goalTrackerEl.offsetWidth; // restart the animation
      goalTrackerEl.classList.add("goal-flash");
      window.clearTimeout(goalFlashTimer);
      goalFlashTimer = window.setTimeout(() => goalTrackerEl.classList.remove("goal-flash"), GOAL_FLASH_MS);
    }
    game.lastGoalIndex = goal.index;
  }
  const bossBarEl = document.getElementById("boss-bar")!;
  const bossBarNameEl = document.getElementById("boss-bar-name")!;
  const bossBarFillEl = document.getElementById("boss-bar-fill")!;
  // Shown while the Ogre Warlord is within this many tiles of the local player.
  const BOSS_BAR_RANGE_TILES = VISION_RADIUS_PLAYER * 1.5;
  // The player's own health bar at the top of the screen (unit bars over sprites are hidden).
  const playerBarEl = document.getElementById("player-bar")!;
  const playerBarLabelEl = document.getElementById("player-bar-label")!;
  const playerBarFillEl = document.getElementById("player-bar-fill")!;
  function syncPlayerBar(players: PlayerSnapshot[]) {
    const me = players.find((p) => p.id === game.myId);
    playerBarEl.hidden = !me || me.dead || me.maxHp <= 0;
    if (!me || me.dead || me.maxHp <= 0) return;
    const frac = Math.max(0, Math.min(1, me.hp / me.maxHp));
    playerBarLabelEl.textContent = `Health ${Math.ceil(me.hp)} / ${Math.ceil(me.maxHp)}`;
    playerBarFillEl.style.width = `${(frac * 100).toFixed(1)}%`;
    playerBarFillEl.className = frac <= 0.25 ? "crit" : frac <= 0.5 ? "low" : "";
  }
  function syncBossBar(mobs: MobSnapshot[], players: PlayerSnapshot[]) {
    const me = players.find((p) => p.id === game.myId);
    const warlord = mobs.find((m) => m.boss === "warlord");
    const near =
      !!me && !!warlord && Math.hypot(warlord.x - me.x, warlord.y - me.y) <= BOSS_BAR_RANGE_TILES * game.tileSize;
    bossBarEl.hidden = !near;
    if (!near || !warlord) return;
    bossBarNameEl.textContent = bossTitle(warlord.kind, "warlord");
    bossBarFillEl.style.width = `${Math.max(0, Math.min(100, (warlord.hp / warlord.maxHp) * 100)).toFixed(1)}%`;
  }
  return { pushEventToast, refreshEquipmentLine, refreshSettlementPanel, syncGoal, syncBossBar, syncPlayerBar, get latestGoal() { return latestGoal; } };
}
