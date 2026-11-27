// Stardew phase 5a (docs/colony2d/PLAN-rimworld-stardew.md; server/src/herolife.ts useTool): the hero's tool hotbar.
// Nine slots (1-9 or Shift+wheel; gap closure G6 added shears, milk pail and manure as 7-9; the same key again puts the tool away, the seed bag's key toggles wheat / hemp; Esc
// puts it away): hoe, watering can, seed bag, scythe, axe, pickaxe. The hero faces the way it last moved, or the
// mouse when that moved last; the faced tile (one tile away) is highlighted, with a short hint. E uses the tool there
// when no NPC is in range (talking keeps priority, then the old gather / station rules); Space or a left click on
// that tile uses it without talking (Space attacks with no tool in hand). Digits stay build hotkeys while the Build
// panel is open. Weapons (the wielded one plus those in the pack) get slots after the tools: click one to wield it, 0 cycles them,
// Shift+wheel runs through tools then weapons; with a weapon wielded and no tool armed Space attacks. Icons: spriteRegistry iconUrl (tool_*); the frame is CSS (the staged hotbar art has 5 slots).
// Unified hotbar (2026-11-27): two stacked rows. TOP: WEAPONS (Shift+5..9 wield the first five; 0 cycles; dashed
// placeholders pad it to three) | SPELLS (main moves the existing #spell-bar, buttons and all, into `spellHost`:
// Shift+1..4 / F1..F4 as before; unlearnt slots show as dashed placeholders). BOTTOM: TOOLS (1-9), Energy under it.
// The top row always shows in adventure view so nothing jumps when gear or spells arrive.
// Shift+5..9 were free: bare / Ctrl / Alt digits, Shift+1..4, F1..F4 and every letter are taken (MANUAL-TESTS.md).
// Outside adventure view (strategy / classic command view) only the spell group shows, where the old spell bar sat.
// Interior fixes 2026-11-27: inside a HOSTILE interior (cave, ruin, bandit camp, mine / quarry) the hotbar shows
// (interior.ts body.interior-hostile); weapons and spells work, the tool slots are dimmed ("Not usable in here": the
// server refuses every tool indoors) and cannot be armed, so Space always attacks there (deps.toolsOff).
import { Graphics } from "pixi.js";
import { TileType, type GearItem } from "@colony/shared/protocol";
import { CROPS, CropStage, type CropId } from "@colony/shared/zones";
import { HERO_TOOLS, HERO_TOOL_ITEM, HERO_TOOL_LABEL, SEED_ITEM, WATER_CAN_CHARGES, type HeroLifeSnapshot, type HeroTool } from "@colony/shared/herolife";
import type { ItemId } from "@colony/shared/progression";
import { iconImg, iconUrl } from "./spriteRegistry";

export interface HeroToolsDeps {
  onUse?: (tool: HeroTool, tx: number, ty: number) => void;
  send: (msg: object) => void;
  // Adventure play: a living hero, not strategy view, no modal.
  active: () => boolean;
  // The Build panel is open: plain digits stay build hotkeys.
  buildOpen: () => boolean;
  // A dialogue is up: its 1-6 choose.
  talking: () => boolean;
  hero: () => { x: number; y: number } | null;
  tileSize: () => number;
  worldTilesX: () => number;
  worldTilesY: () => number;
  tileAt: (i: number) => number;
  cropAt: (i: number) => { stage: number; watered: boolean } | null;
  // Clan items in the stores (all grades).
  itemCount: (id: ItemId) => number;
  // Gates open (creative unlock / test unlock-all): tools needn't be in the stores.
  gatesOpen: () => boolean;
  // Weapons the hero carries (equipped one included), in a stable order; the hotbar shows one slot each.
  weapons: () => GearItem[];
  equippedWeaponId: () => string | null;
  // Equip that weapon from the pack (swapping the old one back in).
  equipWeapon: (id: string) => void;
  weaponIcon: (item: GearItem) => HTMLElement;
  // A shield is worn: a bow can't be wielded (the server refuses with its message; the slot is dimmed).
  offhandWorn: () => boolean;
  // The inventory's item tooltip (name, tier, stat lines) with a footer hint; hideTip hides it.
  weaponTip: (e: MouseEvent, item: GearItem, hint: string) => void;
  hideTip: () => void;
  // Interior fixes 2026-11-27: inside a hostile interior: no tool can be used (slots dimmed, never armed).
  toolsOff?: () => boolean;
}

export interface HeroToolsUi {
  // World-space target highlight (main adds it to the world layer).
  highlight: Graphics;
  frame: (now: number) => void;
  onLife: (l: HeroLifeSnapshot) => void;
  // E: the extra interact fields (the tool in hand and the faced tile), {} with nothing faced.
  interactFields: () => object;
  // Space: true if a tool took it (else Space attacks).
  useKey: () => boolean;
  combatReady: () => boolean;
  // A left click at world (x, y): true if it used a tool (main then skips its own click handling).
  click: (wx: number, wy: number) => boolean;
  mouse: (wx: number, wy: number) => void;
  // Shift+wheel on the canvas: true if it cycled the hotbar.
  wheel: (deltaY: number) => boolean;
  // The hero's weapons changed (profile snapshot): redraw the weapon slots.
  refreshWeapons: () => void;
  // Esc (weapon ready, main.ts): put the hotbar tool away so Space attacks; true if one was in hand.
  disarm: () => boolean;
  // The weapon last seen wielded (this session), for Esc to wield it again when the weapon slot is empty.
  lastWeaponId: () => string | null;
  // The SPELLS group's place in the hotbar (main appends #spell-bar here).
  spellHost: HTMLElement;
}

const ICON: Record<HeroTool, string> = {
  hoe: iconUrl("tool_hoe"), wateringCan: iconUrl("tool_watering_can"), seeds: iconUrl("tool_seedbag"), scythe: iconUrl("tool_scythe"),
  axe: iconUrl("tool_axe"), pick: iconUrl("tool_pickaxe"),
  // Gap closure G6 stand-ins (SPRITES.md: shears / manure icons needed).
  shears: iconUrl("tool_scythe"), milkPail: iconUrl("item_milk_pail"), manure: iconUrl("item_hay_bale"),
};

const CSS = `
#hero-hotbar { position: fixed; left: 50%; bottom: 162px; transform: translateX(-50%); z-index: 9; display: flex; flex-direction: column;
  align-items: center; gap: 3px; pointer-events: none; }
/* Strategy / classic view: only the spell group, where the old standalone spell bar sat (index.html styles #spell-bar;
   these beat menuSkin.css's adventure placement). In adventure view placeBar() below positions the hotbar. */
body:not(.adventure-mode) #hero-hotbar { bottom: 96px !important; left: 50% !important; right: auto !important; transform: translateX(-50%) !important; }
body.strategy-mode #hero-hotbar { bottom: 216px !important; }
body:not(.adventure-mode) #hero-hotbar .hh-top { display: contents; }
body:not(.adventure-mode) #hero-hotbar :is(.hh-hint, .hh-energy, .hh-bottom, .hh-weapons) { display: none; }
#hero-hotbar #spell-bar { position: static; transform: none; pointer-events: auto; }
body.adventure-mode #hero-hotbar #spell-bar { gap: 3px; margin-left: 4px; padding: 0 0 0 6px; background: none; border: 0; border-left: 2px solid #2e1d0c;
  border-radius: 0; box-shadow: none; }
/* Placeholders: empty weapon slots and unlearnt spell slots (faint dashed frames, hotkey label kept). */
#hero-hotbar .hh-slot.hh-ph, body.adventure-mode #hero-hotbar .spell-btn:disabled { background: rgba(0,0,0,.18) !important; border-style: dashed !important;
  opacity: .55; cursor: default; box-shadow: none; }
body.adventure-mode #hero-hotbar .spell-btn { width: 40px; height: 40px; padding: 2px; background: #3a3a34; border: 2px solid #7a5530; }
body.adventure-mode #hero-hotbar .spell-btn kbd { left: 2px; top: 0; right: auto; bottom: auto; }
#hero-hotbar .hh-tools { display: flex; gap: 3px; }
#hero-hotbar .hh-slots { display: flex; gap: 3px; padding: 4px; background: #5a3a1c; border: 2px solid #2e1d0c; border-radius: 4px;
  box-shadow: inset 0 0 0 1px #8a6236, 0 3px 10px rgba(0,0,0,.55); pointer-events: auto; }
#hero-hotbar .hh-slot { position: relative; width: 36px; height: 36px; background: #3a3a34; border: 2px solid #7a5530; border-radius: 3px;
  display: flex; align-items: center; justify-content: center; cursor: pointer; }
#hero-hotbar .hh-weapons { display: flex; gap: 3px; }
#hero-hotbar .hh-slot .hs-item { width: 26px; height: 26px; margin: 0; pointer-events: none; }
#hero-hotbar .hh-slot.on { border-color: #f2b632; box-shadow: 0 0 6px rgba(242,182,50,.8); }
#hero-hotbar .hh-slot.none { opacity: .4; }
#hero-hotbar .hh-slot.off { opacity: .3; filter: grayscale(1); cursor: not-allowed; }
#hero-hotbar .hh-slot:focus-visible, #hero-hotbar .spell-btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
/* placeBar(), per row: smaller slots when the row doesn't fit; wrapping as the last resort. */
#hero-hotbar .hh-slots.compact .hh-slot { width: 30px; height: 30px; }
#hero-hotbar .hh-slots.compact .hh-slot .hs-item { width: 22px; height: 22px; }
body.adventure-mode #hero-hotbar .hh-slots.compact .spell-btn { width: 34px; height: 34px; }
#hero-hotbar .hh-slots.wrap, #hero-hotbar .hh-slots.wrap :is(.hh-tools, .hh-weapons, #spell-bar) { flex-wrap: wrap; justify-content: center; overflow-x: visible !important; }
#hero-hotbar .hh-slot kbd { position: absolute; left: 2px; top: 0; font-size: 9px; color: #fff; text-shadow: 0 0 2px #000; }
#hero-hotbar .hh-slot small { position: absolute; right: 2px; bottom: 0; font-size: 9px; color: #fff; text-shadow: 0 0 2px #000; }
#hero-hotbar .hh-hint { font-size: 11px; color: #fff; text-shadow: 0 0 3px #000; white-space: nowrap; min-height: 14px; }
#hero-hotbar .hh-energy { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #fff; text-shadow: 0 0 2px #000; }
#hero-hotbar .hh-energy .hh-meter { width: 120px; height: 7px; background: rgba(0,0,0,.45); border: 1px solid #2e1d0c; border-radius: 2px; overflow: hidden; }
#hero-hotbar .hh-energy .hh-fill { height: 100%; width: 100%; background: #5cc34a; }
`;

export function setupHeroTools(deps: HeroToolsDeps): HeroToolsUi {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "hero-hotbar";
  const energyRow = document.createElement("div");
  energyRow.className = "hh-energy";
  energyRow.title = "Energy: each tool use costs some; rest (faster by a fire, lean-to, home or bed) or eat to recover. At 0 you work at half speed";
  const meter = document.createElement("div");
  meter.className = "hh-meter";
  const fill = document.createElement("div");
  fill.className = "hh-fill";
  meter.appendChild(fill);
  const energyText = document.createElement("span");
  energyRow.append(document.createTextNode("Energy"), meter, energyText);
  const hint = document.createElement("div");
  hint.className = "hh-hint";
  // Top row: weapons | spells. Bottom row (slotsEl): the tools.
  const topEl = document.createElement("div");
  topEl.className = "hh-slots hh-top";
  const slotsEl = document.createElement("div");
  slotsEl.className = "hh-slots hh-bottom";
  const toolsEl = document.createElement("div");
  toolsEl.className = "hh-tools";
  toolsEl.setAttribute("role", "group");
  toolsEl.setAttribute("aria-label", "Tools (1-9)");
  slotsEl.appendChild(toolsEl);
  root.append(hint, topEl, slotsEl, energyRow);
  document.body.appendChild(root);

  let armed = -1;
  let crop: CropId = "wheat";
  let life: HeroLifeSnapshot | null = null;
  // Facing (tile offset, never 0,0) and what set it last.
  let face = { dx: 0, dy: 1 };
  let last: { x: number; y: number } | null = null;
  let mouseAt = { x: 0, y: 0, t: -1 };
  let moveT = 0;
  const highlight = new Graphics();
  const slotEls: HTMLElement[] = [];
  const countEls: HTMLElement[] = [];
  HERO_TOOLS.forEach((t, k) => {
    const s = document.createElement("div");
    s.className = "hh-slot";
    s.setAttribute("role", "button");
    s.setAttribute("aria-label", `${HERO_TOOL_LABEL[t]} (${k + 1})`);
    const kbd = document.createElement("kbd");
    kbd.textContent = String(k + 1);
    const small = document.createElement("small");
    s.append(iconImg(ICON[t], 26, HERO_TOOL_LABEL[t]), kbd, small);
    s.addEventListener("pointerdown", (e) => e.stopPropagation());
    s.addEventListener("click", () => pick(k));
    toolsEl.appendChild(s);
    slotEls.push(s);
    countEls.push(small);
  });

  // Weapon slots follow the tool slots: picking one puts any tool away, equips that weapon and Space attacks with it.
  const weaponsEl = document.createElement("div");
  weaponsEl.className = "hh-weapons";
  weaponsEl.setAttribute("role", "group");
  weaponsEl.setAttribute("aria-label", "Weapons (Shift+5 to Shift+9, 0 cycles)");
  topEl.appendChild(weaponsEl);
  const spellHost = topEl;
  const WEAPON_PLACEHOLDERS = 3;
  const WEAPON_KEYS = 5;
  const blocked = (w: GearItem) => w.kind === "bow" && deps.offhandWorn();
  let weaponSig = "";
  let lastWeapon: string | null = null;
  function refreshWeapons() {
    const ws = deps.weapons();
    const eq = deps.equippedWeaponId();
    if (eq) lastWeapon = eq;
    const sig = `${ws.map((w) => w.id).join(",")}|${eq}|${armed}|${deps.offhandWorn()}`;
    if (sig === weaponSig) return;
    weaponSig = sig;
    weaponsEl.replaceChildren();
    ws.forEach((w, i) => {
      const s = document.createElement("div");
      s.className = "hh-slot";
      s.classList.toggle("on", armed < 0 && w.id === eq);
      s.classList.toggle("none", blocked(w));
      const key = i < WEAPON_KEYS ? `Shift+${i + 5}` : "";
      const hint = `${blocked(w) ? "A bow needs both hands: take the shield off first · " : ""}Click${key ? ` or ${key}` : ""}: wield · 0 cycles weapons · Space attacks`;
      s.tabIndex = 0;
      s.setAttribute("role", "button");
      s.setAttribute("aria-label", `${w.name}${w.id === eq ? " (wielded)" : ""}${key ? ` (${key})` : ""}`);
      s.appendChild(deps.weaponIcon(w));
      if (key) {
        const kbd = document.createElement("kbd");
        kbd.textContent = `⇧${i + 5}`;
        s.appendChild(kbd);
      }
      s.addEventListener("pointerdown", (e) => e.stopPropagation());
      s.addEventListener("click", () => {
        s.blur();
        pickWeapon(w.id);
      });
      s.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        s.click();
      });
      s.addEventListener("mousemove", (e) => deps.weaponTip(e, w, hint));
      s.addEventListener("mouseleave", deps.hideTip);
      weaponsEl.appendChild(s);
    });
    // Placeholders up to three slots: not focusable, clicks do nothing; they fill in as weapons arrive.
    for (let i = ws.length; i < WEAPON_PLACEHOLDERS; i++) {
      const s = document.createElement("div");
      s.className = "hh-slot hh-ph";
      s.title = `No weapon${i < WEAPON_KEYS ? ` (Shift+${i + 5} once you carry one)` : ""}`;
      s.setAttribute("aria-hidden", "true");
      const kbd = document.createElement("kbd");
      kbd.textContent = `⇧${i + 5}`;
      s.appendChild(kbd);
      s.addEventListener("pointerdown", (e) => e.stopPropagation());
      weaponsEl.appendChild(s);
    }
  }
  // Adventure view placement. Candidate spots, best first: the bottom edge between the hero bar and the minimap, then
  // just above the minimap, just above the hero bar, above both. At each, try full-size then compact slots and take the
  // free horizontal stretch (clear of the hero bar, minimap, top header / controls, goal card, open side panels and
  // their tabs) nearest the screen centre. Nothing fits: above both, rows compacted / wrapped. The combat key guide
  // (#combat-guide, bottom centre) is moved just above the hotbar when they would meet. Inline !important beats
  // menuSkin.css's fixed placement. Re-run on a timer: panels open / close and slots change.
  let placed = "";
  const rows = [topEl, slotsEl];
  const OBSTACLES = ["hero-bar", "minimap-frame", "colony-header", "control-buttons", "goal-tracker", "economy-panel-toggle", "build-panel-toggle"];
  const box = (id: string) => {
    const e = document.getElementById(id);
    const r = e?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 && getComputedStyle(e!).visibility !== "hidden" ? r : null;
  };
  // Each row on its own: full size, else compact, else wrapped; returns the wider row.
  function fit(room: number) {
    let w = 0;
    for (const r of rows) {
      r.classList.remove("compact", "wrap");
      let rw = r.scrollWidth + 4;
      if (rw > room) {
        r.classList.add("compact");
        rw = r.scrollWidth + 4;
      }
      if (rw > room) {
        r.classList.add("wrap");
        rw = room;
      }
      w = Math.max(w, rw);
    }
    return w;
  }
  function placeBar() {
    const st = root.style;
    const guide = document.getElementById("combat-guide");
    if (!document.body.classList.contains("adventure-mode") || getComputedStyle(root).display === "none") {
      if (placed) {
        for (const k of ["left", "right", "bottom", "transform", "max-width"]) st.removeProperty(k);
        for (const r of rows) r.classList.remove("compact", "wrap");
        guide?.style.removeProperty("bottom");
        document.getElementById("interior-use-hint")?.style.removeProperty("bottom");
      }
      placed = "";
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hb = box("hero-bar");
    const mm = box("minimap-frame");
    const obstacles = OBSTACLES.map(box).filter((r): r is DOMRect => !!r);
    for (const id of ["economy-panel", "build-panel"]) {
      const r = document.getElementById(id)?.classList.contains("collapsed") === false ? box(id) : null;
      if (r) obstacles.push(r);
    }
    const bottoms = [10, mm ? vh - mm.top + 6 : 0, hb ? vh - hb.top + 6 : 0, vh - Math.min(hb ? hb.top : vh, mm ? mm.top : vh) + 6].filter((b, i, all) => b > 0 && all.indexOf(b) === i);
    let pick: { bottom: number; cx: number; compact: boolean; room: number } | null = null;
    for (const bottom of bottoms) {
      for (const compact of [false, true]) {
        for (const r of rows) {
          r.classList.toggle("compact", compact);
          r.classList.remove("wrap");
        }
        const w = Math.max(...rows.map((r) => r.scrollWidth + 4));
        const top = vh - bottom - root.offsetHeight;
        if (top < 0) continue;
        // Free stretches of the band [top, vh - bottom] between the obstacles that cross it.
        const cuts = obstacles.filter((o) => o.top < vh - bottom && o.bottom > top).map((o) => [o.left - 8, o.right + 8]).sort((x, y) => x[0] - y[0]);
        let from = 8;
        for (const [l, r] of [...cuts, [vw - 8, vw - 8]]) {
          if (l - from >= w) {
            const cx = Math.max(from + w / 2, Math.min(l - w / 2, vw / 2));
            if (!pick || pick.bottom === bottom && Math.abs(cx - vw / 2) < Math.abs(pick.cx - vw / 2)) pick = { bottom, cx, compact, room: l - from };
          }
          from = Math.max(from, r);
        }
        if (pick) break;
      }
      if (pick) break;
    }
    if (pick) for (const r of rows) r.classList.toggle("compact", pick.compact);
    else {
      const bottom = bottoms[bottoms.length - 1];
      const w = fit(vw - 16);
      pick = { bottom, cx: Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, vw / 2)), compact: true, room: vw - 16 };
    }
    const w = Math.max(...rows.map((r) => r.scrollWidth + 4));
    const sig = `${Math.round(pick.cx)}|${Math.round(pick.bottom)}|${rows.map((r) => r.className).join()}|${Math.round(pick.room)}`;
    if (sig !== placed) {
      placed = sig;
      st.setProperty("left", `${Math.round(pick.cx)}px`, "important");
      st.setProperty("right", "auto", "important");
      st.setProperty("bottom", `${Math.round(pick.bottom)}px`, "important");
      st.setProperty("transform", "translateX(-50%)", "important");
      st.setProperty("max-width", `${Math.max(120, Math.round(pick.room))}px`, "important");
    }
    // The combat key guide sits at bottom 92px, centred: lift it over the hotbar when they would meet.
    if (guide) {
      const g = guide.getBoundingClientRect();
      const meets = g.width > 0 && Math.abs(g.left + g.width / 2 - pick.cx) < (g.width + w) / 2 && pick.bottom < 92 + g.height;
      const want = meets ? `${Math.round(pick.bottom + root.offsetHeight + 4)}px` : "";
      if (guide.style.bottom !== want) want ? guide.style.setProperty("bottom", want) : guide.style.removeProperty("bottom");
    }
    // Interior fixes 2026-11-27: inside a hostile interior the use hint (#interior-use-hint, bottom 115px, centred,
    // shown / hidden every frame) sits above whatever is at the bottom centre: the hotbar, the lifted combat guide and
    // the hero bar.
    const useHint = document.getElementById("interior-use-hint");
    if (useHint) {
      let want = "";
      if (document.body.classList.contains("interior-hostile")) {
        const tops = [vh - pick.bottom - root.offsetHeight];
        const g = guide?.getBoundingClientRect();
        if (g && g.width > 0) tops.push(g.top);
        if (hb) tops.push(hb.top);
        const need = vh - Math.min(...tops) + 6;
        if (need > 115) want = `${Math.round(need)}px`;
      }
      if (useHint.style.bottom !== want) want ? useHint.style.setProperty("bottom", want) : useHint.style.removeProperty("bottom");
    }
  }
  window.setInterval(placeBar, 250);
  window.addEventListener("resize", placeBar);
  function pickWeapon(id: string) {
    // A bow with a shield worn: the server refuses it with its message; keep the tool in hand.
    const w = deps.weapons().find((x) => x.id === id);
    if (w && blocked(w)) return deps.equipWeapon(id);
    armed = -1;
    if (deps.equippedWeaponId() !== id) deps.equipWeapon(id);
    refreshSlots();
  }
  // Key 0: wield the next weapon (the first when none is wielded; a bow is skipped while a shield is worn); with a
  // tool in hand, puts the tool away and keeps the wielded weapon.
  function cycleWeapon() {
    const ws = deps.weapons();
    if (!ws.length) return;
    const eq = deps.equippedWeaponId();
    const i = ws.findIndex((w) => w.id === eq);
    if (armed >= 0 && i >= 0) return pickWeapon(ws[i].id);
    for (let k = 1; k <= ws.length; k++) {
      const w = ws[(i + k + ws.length) % ws.length];
      if (!blocked(w)) return pickWeapon(w.id);
    }
  }

  const tool = (): HeroTool | null => (armed >= 0 ? HERO_TOOLS[armed] : null);
  let toolsOff = false;
  function pick(k: number) {
    if (toolsOff) return;
    if (k === armed && HERO_TOOLS[k] === "seeds") crop = CROPS[(CROPS.indexOf(crop) + 1) % CROPS.length];
    else armed = k === armed ? -1 : k;
    refreshSlots();
  }
  function refreshSlots() {
    refreshWeapons();
    HERO_TOOLS.forEach((t, k) => {
      const s = slotEls[k];
      s.classList.toggle("on", k === armed);
      s.classList.toggle("off", toolsOff);
      s.setAttribute("aria-disabled", String(toolsOff));
      const n = t === "seeds" ? deps.itemCount(SEED_ITEM[crop]) : deps.itemCount(HERO_TOOL_ITEM[t]);
      s.classList.toggle("none", !deps.gatesOpen() && n <= 0);
      countEls[k].textContent = t === "seeds" ? `${crop === "wheat" ? "W" : "H"}${n}` : t === "wateringCan" && life ? String(life.water) : t === "manure" ? String(n) : "";
      if (toolsOff) {
        s.title = `${HERO_TOOL_LABEL[t]}: Not usable in here`;
        return;
      }
      s.title = `${HERO_TOOL_LABEL[t]}${t === "seeds" ? ` (${crop}; press ${k + 1} again for ${CROPS[(CROPS.indexOf(crop) + 1) % CROPS.length]})` : ""}${!deps.gatesOpen() && n <= 0 ? ": none in your stores (craft by hand)" : ""}`;
    });
  }

  // The faced tile (one tile from the hero's), or null with no hero.
  function target(): { tx: number; ty: number } | null {
    const h = deps.hero();
    if (!h) return null;
    const ts = deps.tileSize();
    const tx = Math.floor(h.x / ts) + face.dx;
    const ty = Math.floor(h.y / ts) + face.dy;
    if (tx < 0 || ty < 0 || tx >= deps.worldTilesX() || ty >= deps.worldTilesY()) return null;
    return { tx, ty };
  }

  // What the tool in hand would do on the faced tile ("" = nothing).
  function actionHint(t: HeroTool | null, tx: number, ty: number): string {
    const i = ty * deps.worldTilesX() + tx;
    const tile = deps.tileAt(i);
    const c = deps.cropAt(i);
    const stage = c?.stage ?? CropStage.Untilled;
    if (stage === CropStage.Ripe && t !== "axe" && t !== "pick" && t !== "hoe") return "Harvest";
    switch (t) {
      case "hoe":
        return tile === TileType.Empty && !c ? "Till" : "";
      case "wateringCan":
        if (tile === TileType.Water) return life && life.water < WATER_CAN_CHARGES ? "Fill the can" : "";
        return c && !c.watered && stage < CropStage.Ripe ? (life?.water ? "Water" : "The can is empty: fill it at water") : "";
      case "seeds":
        return stage === CropStage.Tilled ? `Sow ${crop}` : "";
      case "axe":
        return tile === TileType.Tree ? "Chop" : "";
      case "pick":
        return tile === TileType.Rock || tile === TileType.IronOre ? "Mine" : "";
      case "manure":
        return c && stage >= CropStage.Tilled && stage < CropStage.Ripe ? "Fertilise" : "";
      default:
        return "";
    }
  }

  let hintSig = "";
  function frame(now: number) {
    highlight.clear();
    const off = !!deps.toolsOff?.();
    if (off !== toolsOff) {
      toolsOff = off;
      if (off) armed = -1;
      refreshSlots();
    }
    const h = deps.active() ? deps.hero() : null;
    if (!h) {
      last = null;
      return;
    }
    // Facing: the last movement, or the mouse when it moved later.
    if (last && Math.hypot(h.x - last.x, h.y - last.y) > 0.4) {
      const dx = h.x - last.x;
      const dy = h.y - last.y;
      const a = Math.atan2(dy, dx);
      face = { dx: Math.round(Math.cos(a)), dy: Math.round(Math.sin(a)) };
      moveT = now;
    } else if (mouseAt.t > moveT) {
      const ts = deps.tileSize();
      const dx = Math.floor(mouseAt.x / ts) - Math.floor(h.x / ts);
      const dy = Math.floor(mouseAt.y / ts) - Math.floor(h.y / ts);
      if (dx !== 0 || dy !== 0) {
        const a = Math.atan2(dy, dx);
        face = { dx: Math.round(Math.cos(a)), dy: Math.round(Math.sin(a)) };
      }
    }
    last = { x: h.x, y: h.y };
    const tg = target();
    const t = tool();
    const what = tg ? actionHint(t, tg.tx, tg.ty) : "";
    if (tg && (t || what)) {
      const ts = deps.tileSize();
      highlight.rect(tg.tx * ts + 1, tg.ty * ts + 1, ts - 2, ts - 2).stroke({ width: 2, color: what ? 0xf2c94c : 0xffffff, alpha: what ? 0.95 : 0.35 });
    }
    const text = t ? `${HERO_TOOL_LABEL[t]}${what ? `: ${what} (E / Space / click)` : ""}` : what ? `${what} (E)` : "";
    if (text !== hintSig) {
      hintSig = text;
      hint.textContent = text;
    }
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (!deps.active() || deps.talking()) return;
      if (e.shiftKey) {
        // Shift+5..9: wield the first five weapon slots. Not stopImmediatePropagation: playerCombat must still see a
        // Shift chord so it is not taken for a dodge double-tap.
        const w = /^Digit([5-9])$/.exec(e.code);
        if (!w) return;
        e.preventDefault();
        const item = deps.weapons()[Number(w[1]) - 5];
        if (item) pickWeapon(item.id);
        return;
      }
      if (e.code === "Digit0" && !deps.buildOpen()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cycleWeapon();
        return;
      }
      const d = /^Digit([1-9])$/.exec(e.code);
      if (!d || deps.buildOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(Number(d[1]) - 1);
    },
    true,
  );

  function send(type: "heroTool") {
    const t = tool();
    const tg = target();
    if (!t || !tg) return false;
    deps.send({ type, tool: t, tx: tg.tx, ty: tg.ty, ...(t === "seeds" ? { crop } : {}) });
    deps.onUse?.(t, tg.tx, tg.ty);
    return true;
  }

  return {
    highlight,
    frame,
    onLife(l) {
      life = l;
      const pct = Math.max(0, Math.min(100, l.energy));
      fill.style.width = `${pct}%`;
      fill.style.background = pct <= 0 ? "#c0392b" : pct < 25 ? "#e6a23c" : "#5cc34a";
      energyText.textContent = l.needs ? `${Math.round(l.energy)}` : "off";
      energyRow.style.opacity = l.needs ? "1" : "0.5";
      refreshSlots();
    },
    interactFields() {
      const tg = deps.active() ? target() : null;
      if (!tg) return {};
      const t = tool();
      return { tx: tg.tx, ty: tg.ty, ...(t ? { tool: t } : {}), ...(t === "seeds" ? { crop } : {}) };
    },
    combatReady:()=>!tool(),
    useKey() {
      return deps.active() && send("heroTool");
    },
    click(wx, wy) {
      const h = deps.active() ? deps.hero() : null;
      if (!h || !tool()) return false;
      const ts = deps.tileSize();
      const dx = Math.floor(wx / ts) - Math.floor(h.x / ts);
      const dy = Math.floor(wy / ts) - Math.floor(h.y / ts);
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
      face = { dx, dy };
      mouseAt = { x: wx, y: wy, t: performance.now() };
      return send("heroTool");
    },
    mouse(wx, wy) {
      mouseAt = { x: wx, y: wy, t: performance.now() };
    },
    refreshWeapons,
    disarm() {
      if (armed < 0) return false;
      armed = -1;
      refreshSlots();
      return true;
    },
    lastWeaponId: () => lastWeapon,
    spellHost,
    wheel(deltaY) {
      if (!deps.active() || deltaY === 0) return false;
      // In a hostile interior the tools are off: the ring is the weapons only.
      const n = toolsOff ? 0 : HERO_TOOLS.length;
      // One ring: the tools, then the weapons; the hand with no tool sits on the wielded weapon.
      const ws = deps.weapons();
      const total = n + ws.length;
      if (!total) return true;
      const eqI = ws.findIndex((w) => w.id === deps.equippedWeaponId());
      const cur = armed >= 0 ? armed : eqI >= 0 ? n + eqI : -1;
      const next = cur < 0 ? (deltaY > 0 ? 0 : total - 1) : (cur + (deltaY > 0 ? 1 : -1) + total) % total;
      if (next < n) armed = next;
      else pickWeapon(ws[next - n].id);
      refreshSlots();
      return true;
    },
  };
}
