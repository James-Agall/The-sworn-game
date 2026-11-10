// Stardew phase 5a (docs/colony2d/PLAN-rimworld-stardew.md; server/src/herolife.ts useTool): the hero's tool hotbar.
// Nine slots (1-9 or Shift+wheel; gap closure G6 added shears, milk pail and manure as 7-9; the same key again puts the tool away, the seed bag's key toggles wheat / hemp; Esc
// puts it away): hoe, watering can, seed bag, scythe, axe, pickaxe. The hero faces the way it last moved, or the
// mouse when that moved last; the faced tile (one tile away) is highlighted, with a short hint. E uses the tool there
// when no NPC is in range (talking keeps priority, then the old gather / station rules); Space or a left click on
// that tile uses it without talking (Space attacks with no tool in hand). Digits stay build hotkeys while the Build
// panel is open. Icons: spriteRegistry iconUrl (tool_*); the frame is CSS (the staged hotbar art has 5 slots).
import { Graphics } from "pixi.js";
import { TileType } from "@colony/shared/protocol";
import { CROPS, CropStage, type CropId } from "@colony/shared/zones";
import { HERO_TOOLS, HERO_TOOL_ITEM, HERO_TOOL_LABEL, SEED_ITEM, WATER_CAN_CHARGES, type HeroLifeSnapshot, type HeroTool } from "@colony/shared/herolife";
import type { ItemId } from "@colony/shared/progression";
import { iconImg, iconUrl } from "./spriteRegistry";

export interface HeroToolsDeps {
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
  // A left click at world (x, y): true if it used a tool (main then skips its own click handling).
  click: (wx: number, wy: number) => boolean;
  mouse: (wx: number, wy: number) => void;
  // Shift+wheel on the canvas: true if it cycled the hotbar.
  wheel: (deltaY: number) => boolean;
}

const ICON: Record<HeroTool, string> = {
  hoe: iconUrl("tool_hoe"), wateringCan: iconUrl("tool_watering_can"), seeds: iconUrl("tool_seedbag"), scythe: iconUrl("tool_scythe"),
  axe: iconUrl("tool_axe"), pick: iconUrl("tool_pickaxe"),
  // Gap closure G6 stand-ins (SPRITES.md: shears / manure icons needed).
  shears: iconUrl("tool_scythe"), milkPail: iconUrl("item_milk_pail"), manure: iconUrl("item_hay_bale"),
};

const CSS = `
#hero-hotbar { position: fixed; left: 50%; bottom: 162px; transform: translateX(-50%); z-index: 9; display: none; flex-direction: column;
  align-items: center; gap: 3px; pointer-events: none; }
body.adventure-mode:not(.strategy-mode) #hero-hotbar { display: flex; }
#hero-hotbar .hh-slots { display: flex; gap: 3px; padding: 4px; background: #5a3a1c; border: 2px solid #2e1d0c; border-radius: 4px;
  box-shadow: inset 0 0 0 1px #8a6236, 0 3px 10px rgba(0,0,0,.55); pointer-events: auto; }
#hero-hotbar .hh-slot { position: relative; width: 36px; height: 36px; background: #3a3a34; border: 2px solid #7a5530; border-radius: 3px;
  display: flex; align-items: center; justify-content: center; cursor: pointer; }
#hero-hotbar .hh-slot.on { border-color: #f2b632; box-shadow: 0 0 6px rgba(242,182,50,.8); }
#hero-hotbar .hh-slot.none { opacity: .4; }
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
  const slotsEl = document.createElement("div");
  slotsEl.className = "hh-slots";
  root.append(hint, slotsEl, energyRow);
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
    const kbd = document.createElement("kbd");
    kbd.textContent = String(k + 1);
    const small = document.createElement("small");
    s.append(iconImg(ICON[t], 26, HERO_TOOL_LABEL[t]), kbd, small);
    s.addEventListener("pointerdown", (e) => e.stopPropagation());
    s.addEventListener("click", () => pick(k));
    slotsEl.appendChild(s);
    slotEls.push(s);
    countEls.push(small);
  });

  const tool = (): HeroTool | null => (armed >= 0 ? HERO_TOOLS[armed] : null);
  function pick(k: number) {
    if (k === armed && HERO_TOOLS[k] === "seeds") crop = CROPS[(CROPS.indexOf(crop) + 1) % CROPS.length];
    else armed = k === armed ? -1 : k;
    refreshSlots();
  }
  function refreshSlots() {
    HERO_TOOLS.forEach((t, k) => {
      const s = slotEls[k];
      s.classList.toggle("on", k === armed);
      const n = t === "seeds" ? deps.itemCount(SEED_ITEM[crop]) : deps.itemCount(HERO_TOOL_ITEM[t]);
      s.classList.toggle("none", !deps.gatesOpen() && n <= 0);
      countEls[k].textContent = t === "seeds" ? `${crop === "wheat" ? "W" : "H"}${n}` : t === "wateringCan" && life ? String(life.water) : t === "manure" ? String(n) : "";
      s.title = `${HERO_TOOL_LABEL[t]}${t === "seeds" ? ` (${crop}; press ${k + 1} again for ${crop === "wheat" ? "hemp" : "wheat"})` : ""}${!deps.gatesOpen() && n <= 0 ? ": none in your stores (craft by hand)" : ""}`;
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
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (!deps.active() || deps.talking()) return;
      if (e.key === "Escape" && armed >= 0) {
        armed = -1;
        refreshSlots();
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
    wheel(deltaY) {
      if (!deps.active() || deltaY === 0) return false;
      const n = HERO_TOOLS.length;
      armed = armed < 0 ? (deltaY > 0 ? 0 : n - 1) : (armed + (deltaY > 0 ? 1 : -1) + n) % n;
      refreshSlots();
      return true;
    },
  };
}
