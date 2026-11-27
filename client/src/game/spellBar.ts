// Spell bar: slot buttons, cooldowns, aiming (range ring, click to cast) and the spell hotkeys.
// Split out of main.ts (2026-11-26).
import { Application, Container, Graphics } from "pixi.js";
import { type InteriorUi } from "../interior";
import type { PlayerSnapshot, ColonistSnapshot, MobSnapshot, GameEventCategory } from "@colony/shared/protocol";
import { TICK_RATE } from "@colony/shared/protocol";
import { spellCooldownSeconds } from "@colony/shared/herolife";
import { TILE_SIZE } from "@colony/shared/protocol";
import { SPELLS, SPELL_SLOT_COUNT } from "@colony/shared/protocol";
import type { SpellId } from "@colony/shared/protocol";
import { UNIT_HIT_RADIUS, mobHitRadius } from "../unitVisuals";
import { mobRenderScale } from "../worldVisuals";
import { createHeroSheet } from "./heroSheet";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface SpellBarContext {
  heroSheetApi: ReturnType<typeof createHeroSheet>;
  spellIcon: (id: SpellId) => HTMLElement;
  showSpellTip: (e: MouseEvent, id: SpellId, spellPower: number, hint: string, castLevel?: number) => void;
  hideItemTip: () => void;
  app: Application;
  sendMessage: (msg: object) => void;
  pushEventToast: (category: GameEventCategory, text: string) => void;
  findNearest: <T extends { x: number; y: number }>(list: T[], x: number, y: number, radius: number) => T | null;
  worldLayer: Container;
  interiorRef: { ui: InteriorUi | null };
  readonly spellCdAt: number;
  readonly latestMobs: MobSnapshot[];
  readonly latestColonists: ColonistSnapshot[];
  readonly latestPlayersForSpells: PlayerSnapshot[];
  readonly myId: string | null;
}

export function createSpellBar(game: SpellBarContext) {
  const { heroSheetApi, spellIcon, showSpellTip, hideItemTip, app, sendMessage, pushEventToast, findNearest, worldLayer, interiorRef } = game;
  // ---- Hero phase 4: the player's spell bar (bottom centre, above the command bar) ----
  // Hotkeys Shift+1..4 or F1..F4 (every letter, every bare digit and Ctrl / Alt + digit are taken). A
  // targeted spell then waits for a left click: enemy = a monster, ally = a friendly unit / player (empty
  // ground = yourself), ground = the spot; right click or Escape cancels; the same key again casts an
  // ally spell on yourself. Cooldowns are drawn as a dark overlay with the seconds left.
  const spellBarEl = document.getElementById("spell-bar")!;
  let spellAim: { slot: number; spell: SpellId } | null = null;
  const spellBtns: HTMLButtonElement[] = [];
  const SPELL_KEY_LABEL = ["⇧1", "⇧2", "⇧3", "⇧4"];
  for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
    const b = document.createElement("button");
    b.className = "spell-btn";
    b.addEventListener("click", () => {
      b.blur();
      useSpellSlot(i);
    });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    spellBarEl.append(b);
    spellBtns.push(b);
  }
  const spellRangeRing = new Graphics();
  let spellBarKey = "";
  function spellCooldownMs(id: SpellId): number {
    const ticks = heroSheetApi.heroProfile?.spells?.cooldowns[id] ?? 0;
    return Math.max(0, (ticks / TICK_RATE) * 1000 - (performance.now() - game.spellCdAt));
  }
  function renderSpellBar() {
    const book = heroSheetApi.heroProfile?.spells;
    spellBarEl.hidden = !book || book.learned.length === 0;
    if (!book) return;
    const key = JSON.stringify([book.slots, spellAim, heroSheetApi.heroProfile?.stats.spellPowerMult, book.castLevel]);
    if (key !== spellBarKey) {
      spellBarKey = key;
      book.slots.forEach((id, i) => {
        const b = spellBtns[i];
        b.replaceChildren();
        b.classList.toggle("aiming", spellAim?.slot === i);
        b.disabled = !id;
        if (id) b.setAttribute("aria-label", `${SPELLS[id].name} (Shift+${i + 1} or F${i + 1})`);
        else b.removeAttribute("aria-label");
        if (id) b.append(spellIcon(id));
        const k = document.createElement("kbd");
        k.textContent = SPELL_KEY_LABEL[i];
        const cd = document.createElement("div");
        cd.className = "spell-cd";
        b.append(k, cd);
        b.onmousemove = id ? (e) => showSpellTip(e, id, heroSheetApi.heroProfile?.stats.spellPowerMult ?? 1, `Shift+${i + 1} or F${i + 1}`, book.castLevel) : null;
        b.onmouseleave = hideItemTip;
      });
    }
    book.slots.forEach((id, i) => {
      const cd = spellBtns[i].querySelector<HTMLElement>(".spell-cd");
      if (!cd) return;
      const left = id ? spellCooldownMs(id) : 0;
      const height=id && left > 0 ? `${Math.min(100, (left / (spellCooldownSeconds(id, book.castLevel ?? 1) * 1000)) * 100)}%` : "0%";
      const text=left > 0 ? String(Math.ceil(left / 1000)) : "";
      if(cd.style.height!==height)cd.style.height=height;
      if(cd.textContent!==text)cd.textContent=text;
    });
  }
  window.setInterval(renderSpellBar, 100);
  function setSpellAim(aim: typeof spellAim) {
    spellAim = aim;
    app.canvas.style.cursor = aim ? "crosshair" : "";
    spellRangeRing.clear();
    renderSpellBar();
  }
  function castSlot(slot: number, target: { targetId?: string; x?: number; y?: number }) {
    sendMessage({ type: "castSpell", slot, ...target });
    setSpellAim(null);
  }
  function useSpellSlot(slot: number) {
    const id = heroSheetApi.heroProfile?.spells?.slots[slot];
    if (!id) return;
    const def = SPELLS[id];
    if (spellCooldownMs(id) > 0) {
      pushEventToast("build", `${def.name}: ${Math.ceil(spellCooldownMs(id) / 1000)} s cooldown`);
      return;
    }
    // Pressing an ally spell's key again while aiming casts it on yourself.
    if (def.targeting === "self" || (def.targeting === "ally" && spellAim?.slot === slot)) return castSlot(slot, {});
    setSpellAim(spellAim?.slot === slot ? null : { slot, spell: id });
  }
  // A left click while aiming: true when it was used for the spell.
  function spellAimClick(x: number, y: number): boolean {
    if (!spellAim) return false;
    const def = SPELLS[spellAim.spell];
    if (def.targeting === "enemy") {
      const mob = findNearest(game.latestMobs.filter((m) => (m.x - x) ** 2 + (m.y - y) ** 2 <= (mobHitRadius(m.kind, mobRenderScale(m)) + 6) ** 2), x, y, Infinity);
      if (!mob) {
        pushEventToast("build", `${def.name}: click on an enemy (right click cancels)`);
        return true;
      }
      castSlot(spellAim.slot, { targetId: mob.id });
    } else if (def.targeting === "ally") {
      const friends = [...game.latestColonists, ...(game.latestPlayersForSpells.filter((p) => !p.dead) as { id: string; x: number; y: number }[])];
      const ally = findNearest(friends, x, y, UNIT_HIT_RADIUS + 4);
      castSlot(spellAim.slot, ally && ally.id !== game.myId ? { targetId: ally.id } : {});
    } else {
      castSlot(spellAim.slot, { x, y });
    }
    return true;
  }
  app.ticker.add(() => {
    if (!spellAim || !game.myId) return;
    if(interiorRef.ui?.active()){spellRangeRing.clear();return;}
    const me = game.latestPlayersForSpells.find((p) => p.id === game.myId);
    spellRangeRing.clear();
    if (!me) return;
    spellRangeRing.circle(me.x, me.y, SPELLS[spellAim.spell].range * TILE_SIZE).stroke({ width: 2, color: 0xf2c94c, alpha: 0.6 });
    if (spellRangeRing.parent !== worldLayer) worldLayer.addChild(spellRangeRing);
  });
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const digit = /^Digit([1-4])$/.exec(e.code);
    const fkey = /^F([1-4])$/.exec(e.code);
    if (digit && e.shiftKey) {
      e.preventDefault();
      useSpellSlot(Number(digit[1]) - 1);
    } else if (fkey) {
      e.preventDefault();
      useSpellSlot(Number(fkey[1]) - 1);
    } else if (e.key === "Escape" && spellAim) {
      setSpellAim(null);
    }
  });
  return { renderSpellBar, castSlot, setSpellAim, spellAimClick, get spellAim() { return spellAim; } };
}
