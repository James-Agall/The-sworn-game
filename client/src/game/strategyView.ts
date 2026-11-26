// Strategy view: regiments, armed orders and order markers, banners, enemy intel, strategy fog / dots, the
// strategy camera and the setView sender. Split out of main.ts (2026-11-27).
import { Application, Container, Graphics, Sprite } from "pixi.js";
import { type InteriorUi } from "../interior";
import type { ClientMessage, PlayerSnapshot, ColonistSnapshot, ColonistKind, MobSnapshot, Stance, WildlifeKind, TownCenterSnapshot } from "@colony/shared/protocol";
import { unitRole } from "@colony/shared/protocol";
import { groupShape } from "@colony/shared/formation";
import type { FormationPlan } from "@colony/shared/formation";
import { EDGE_SCROLL_PX, PAN_SCREEN_PX_PER_S, StrategyCamera } from "../strategy/camera";
import { AdventureCamera, readAdventurePrefs } from "../adventure";
import { drawUnitDots, lodBand, StrategyBanners, StrategyFog } from "../strategy/lod";
import type { BannerGroup, LodBand, UnitDot, VisionSource } from "../strategy/lod";
import { RegimentCardBar } from "../strategy/cards";
import type { RegimentCard } from "../strategy/cards";
import type { ArmyRegimentSnapshot } from "@colony/shared/protocol";
import type { ArmyOrder, ArmyOrderGroupSnapshot, ArmyOrderKind, FormationShape } from "@colony/shared/protocol";
import { FORMATION_SHAPES } from "@colony/shared/protocol";
import { ORDER_LABEL, OrderMarkers } from "../strategy/orders";
import { BAND_COLORS, enemyBannerLabel, IntelOverlay, strengthBand } from "../strategy/intel";
import type { ObjectiveMarker, Threat } from "../strategy/intel";
import type { EnemyRegimentSnapshot } from "@colony/shared/protocol";
import { WORKER_KINDS, SELECTION_COLOR, UNIT_HIT_RADIUS, ROLE_COLORS, ROLE_LABEL, SHAPE_LABEL } from "../unitVisuals";
import { HERO_VISUAL_KIND, REGIMENT_ICON_KIND, type EntityVisual } from "../worldVisuals";
import type { ArmedOrder, StrategySetting } from "./types";
import { createFightArrows } from "./fightArrows";
import { createMinimap } from "./minimap";
import { createHudPanels } from "./hudPanels";
import type { GameEventCategory, FightSnapshot } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface StrategyViewContext {
  setSelection: (ids: Iterable<string>) => void;
  app: Application;
  commandBarEl: HTMLElement;
  sendMessage: (msg: object) => void;
  computeLineFormationTargets: (units: ColonistSnapshot[], ax: number, ay: number, bx: number, by: number) => FormationPlan & { cx: number; cy: number; };
  findNearest: <T extends { x: number; y: number }>(list: T[], x: number, y: number, radius: number) => T | null;
  strategyCam: StrategyCamera;
  isCommandable: (c: ColonistSnapshot) => boolean;
  pushEventToast: (category: GameEventCategory, text: string) => void;
  worldLayer: Container;
  cancelLeftPress: () => void;
  cancelOrderPress: () => void;
  placementGhost: Sprite;
  cursorHighlight: Graphics;
  currentInput: () => { dx: number; dy: number };
  decorSpriteLayer: Container;
  tileSpriteLayer: Container;
  strategicMapSprite: Sprite;
  roleRings: Graphics;
  strategyDots: Graphics;
  strategyFog: StrategyFog;
  strategyBanners: StrategyBanners;
  minimapApi: ReturnType<typeof createMinimap>;
  liveVisionSources: (players: PlayerSnapshot[], colonists: ColonistSnapshot[]) => VisionSource[];
  mobSprites: Map<string, EntityVisual>;
  wildlifeSprites: Map<number, { sprite: Sprite; kind: WildlifeKind; lastX: number; phase: number; }>;
  colonistSprites: Map<string, EntityVisual>;
  playerSprites: Map<string, EntityVisual>;
  hudPanelsApi: ReturnType<typeof createHudPanels>;
  fightArrowsApi: ReturnType<typeof createFightArrows>;
  fightIsOnScreen: (f: FightSnapshot) => boolean;
  fightWorldPos: (f: FightSnapshot) => { x: number; y: number; };
  advCam: AdventureCamera;
  interiorRef: { ui: InteriorUi | null };
  adventurePrefs: ReturnType<typeof readAdventurePrefs>;
  readonly selectedIds: Set<string>;
  panDrag: { pointerId: number; lastX: number; lastY: number } | null;
  canvasPointer: { x: number; y: number } | null;
  readonly tileSize: number;
  readonly latestColonists: ColonistSnapshot[];
  readonly camZoom: number;
  readonly latestPlayersForSpells: PlayerSnapshot[];
  readonly latestMobs: MobSnapshot[];
  fightPeek: { x: number; y: number; until: number } | null;
  fightPeekCam: { x: number; y: number } | null;
  readonly worldTilesX: number;
  readonly worldTilesY: number;
  strategyBand: LodBand;
  strategicMapDirty: boolean;
  readonly latestTownCenters: TownCenterSnapshot[];
  readonly myId: string | null;
  readonly castleRuinTile: { x: number; y: number } | null;
  readonly latestHearths: Set<number>;
  readonly latestTaskForces: Record<string, string[]>;
  pendingStartStrategy: boolean;
}

export function createStrategyView(game: StrategyViewContext) {
  const { setSelection, app, commandBarEl, sendMessage, computeLineFormationTargets, findNearest, strategyCam, isCommandable, pushEventToast, worldLayer, cancelLeftPress, cancelOrderPress, placementGhost, cursorHighlight, currentInput, decorSpriteLayer, tileSpriteLayer, strategicMapSprite, roleRings, strategyDots, strategyFog, strategyBanners, minimapApi, liveVisionSources, mobSprites, wildlifeSprites, colonistSprites, playerSprites, hudPanelsApi, fightArrowsApi, fightIsOnScreen, fightWorldPos, advCam, interiorRef, adventurePrefs } = game;
  // ---- Strategy mode phase 1 (docs PLAN-strategy-mode.md §1): Tab toggles a free bird's-eye camera
  // (strategy/camera.ts) with LOD bands, fog and stand-in banners (strategy/lod.ts). While it is on:
  // WASD / arrows / edge scroll / middle-drag pan, the wheel zooms about the cursor, a minimap click
  // jumps there, Home centres on the rider; building is off and the rider stands idle. The server gets
  // the view as `setView` so it sends the mobs inside it, not only those near the rider.
  const STRATEGY_HIT_SCREEN_PX = 6;
  // Phase 5: clicking a clash icon zooms here (the Field band).
  const STRATEGY_CLASH_ZOOM = 0.5;
  const STRATEGY_FOG_REFRESH_MS = 200;
  const SET_VIEW_INTERVAL_MS = 200;
  // World px the banner tip sits above its group's centroid (about half a unit's height).
  const BANNER_LIFT_PX = 18;
  // Strategy mode phase 2: the server's regiments (snapshot armyRegiments, kept until the next one) and
  // each unit's regiment. Tapping the same control-group digit twice within this window centres on it.
  const GROUP_DOUBLE_TAP_MS = 350;
  let armyRegiments: ArmyRegimentSnapshot[] = [];
  let regimentOfUnit = new Map<string, ArmyRegimentSnapshot>();
  let lastGroupTap = { slot: 0, at: -Infinity };
  const regimentCards = new RegimentCardBar(document.getElementById("regiment-cards")!, {
    select: (id, additive) => {
      const reg = armyRegiments.find((r) => r.id === id);
      if (!reg) return;
      if (!additive) {
        setSelection(reg.unitIds);
        return;
      }
      // Shift: toggle this regiment in / out of the selection.
      const next = new Set(game.selectedIds);
      const allIn = reg.unitIds.length > 0 && reg.unitIds.every((u) => next.has(u));
      for (const u of reg.unitIds) {
        if (allIn) next.delete(u);
        else next.add(u);
      }
      setSelection(next);
    },
    centre: (id) => {
      const reg = armyRegiments.find((r) => r.id === id);
      if (reg) centreOnUnits(reg.unitIds);
    },
  });
  const strategyBtn = document.getElementById("strategy-btn") as HTMLButtonElement;
  let lastPanAt = 0;
  let fogUpdatedAt = -Infinity;
  let dotsDirty = true;
  let dotsZoom = 0;
  let strategyWasActive = false;
  let viewSent: { x: number; y: number; halfW: number; halfH: number } | null = null;
  let viewSentAt = -Infinity;
  function cancelPanDrag() {
    if (game.panDrag && app.canvas.hasPointerCapture(game.panDrag.pointerId)) app.canvas.releasePointerCapture(game.panDrag.pointerId);
    game.panDrag = null;
  }
  app.canvas.addEventListener("pointerleave", () => {
    game.canvasPointer = null;
  });
  // ---- Strategy mode phase 3: regiment orders (strategy/orders.ts draws them). Right-click = move as the
  // formation stands (its last width / facing kept), right-drag = a line (width = drag length, facing away
  // from the units or toward a nearby enemy, Alt flips), Ctrl+right-click or Shift+F then right-click =
  // attack-move, right-click an enemy = attack, Shift+G then right-click a friend = follow, Shift+H hold,
  // Shift+R retreat; Shift on any of these queues it. Shift+letter so every build hotkey stays as it is.
  // Phase 4: Shift+C then right-click an enemy = charge, Shift+B then right-click = bombard that point;
  // right-clicking a camp hearth = attackHearth. Settings: Shift+T hold fire, Shift+V skirmish, Alt+C cycle
  // charge (toggles), Shift+Q cycles the shape.
  const ORDER_HOTKEYS: Record<string, ArmyOrderKind> = { f: "attackMove", g: "follow", h: "hold", r: "retreat", c: "charge", b: "bombard" };
  const SETTING_HOTKEYS: Record<string, StrategySetting> = { t: "holdFire", v: "skirmish", q: "shape" };
  let armedOrder: ArmedOrder | null = null;
  // Strategy mode phase 5: enemy summaries (snapshot enemyRegiments, kept until the next), their banners,
  // the intel overlay (strategy/intel.ts) and the own regiments under flank / rear threat.
  let enemyRegiments: EnemyRegimentSnapshot[] = [];
  const enemyBanners = new StrategyBanners();
  const intel = new IntelOverlay();
  let strategyThreats: Threat[] = [];
  // Rear threat: a visible enemy within this many tiles of a member and over a tile behind the facing line.
  const REAR_THREAT_TILES = 4;
  let orderGroups: ArmyOrderGroupSnapshot[] = [];
  let orderGroupOfUnit = new Map<string, ArmyOrderGroupSnapshot>();
  const orderMarkers = new OrderMarkers();
  function armOrder(kind: ArmedOrder | null) {
    armedOrder = kind;
    app.canvas.style.cursor = kind ? "crosshair" : "";
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-order]"))) b.classList.toggle("active", b.dataset.order === kind);
  }
  function sendRegimentOrder(order: ArmyOrder, queue: boolean) {
    if (game.selectedIds.size === 0) return;
    const msg: ClientMessage = { type: "regimentOrder", unitIds: Array.from(game.selectedIds), order, ...(queue ? { queue: true } : {}) };
    sendMessage(msg);
  }
  // A dragged line as an order: centre, facing (the shared line rule, Alt flips it) and width in tiles.
  function strategyLine(units: ColonistSnapshot[], ax: number, ay: number, bx: number, by: number, flip: boolean) {
    const plan = computeLineFormationTargets(units, ax, ay, bx, by);
    const facing = Math.atan2(flip ? -plan.fy : plan.fy, flip ? -plan.fx : plan.fx);
    return { x: plan.cx, y: plan.cy, facing, width: Math.hypot(bx - ax, by - ay) / game.tileSize };
  }
  // A plain click keeps the formation (facing + width) of the order group the selection exactly is; a
  // queued click leaves it to the server (it faces its march at the group's width).
  function keptFormation(queued: boolean): { facing?: number; width?: number } {
    if (queued) return {};
    const alive = game.latestColonists.filter((c) => game.selectedIds.has(c.id));
    const g = alive.length > 0 ? orderGroupOfUnit.get(alive[0].id) : undefined;
    if (!g || !alive.every((c) => orderGroupOfUnit.get(c.id) === g)) return {};
    const groupAlive = g.unitIds.filter((id) => game.latestColonists.some((c) => c.id === id)).length;
    if (groupAlive !== alive.length) return {};
    return { ...(g.facing !== undefined ? { facing: g.facing } : {}), ...(g.width !== undefined ? { width: g.width } : {}) };
  }
  // Follow target under the cursor: a colonist outside the selection, else a player ("p:<id>").
  function followTargetAt(x: number, y: number): string | null {
    const hit = Math.max(UNIT_HIT_RADIUS, STRATEGY_HIT_SCREEN_PX / game.camZoom);
    const unit = findNearest(game.latestColonists.filter((c) => !game.selectedIds.has(c.id)), x, y, hit);
    if (unit) return unit.id;
    const p = findNearest(game.latestPlayersForSpells.filter((pl) => !pl.dead), x, y, Math.max(hit, 14));
    return p ? `p:${p.id}` : null;
  }
  // Shift+F / G / H / R with soldiers selected in strategy mode (else the key is a build hotkey as ever).
  function strategyOrderKey(e: KeyboardEvent): ArmyOrderKind | null {
    if (!strategyCam.inStrategy || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
    const kind = ORDER_HOTKEYS[e.key.toLowerCase()];
    if (!kind || !game.latestColonists.some((c) => game.selectedIds.has(c.id) && isCommandable(c))) return null;
    return kind;
  }
  // Shift+T / V / Q, or Alt+C, with soldiers selected in strategy mode.
  function strategySettingKey(e: KeyboardEvent): StrategySetting | null {
    if (!strategyCam.inStrategy || e.ctrlKey || e.metaKey) return null;
    const key = e.key.toLowerCase();
    const setting = e.altKey && !e.shiftKey ? (e.code === "KeyC" ? "cycleCharge" : null) : e.shiftKey && !e.altKey ? SETTING_HOTKEYS[key] ?? null : null;
    if (!setting || !game.latestColonists.some((c) => game.selectedIds.has(c.id) && isCommandable(c))) return null;
    return setting;
  }
  function selectedCommandable(): ColonistSnapshot[] {
    return game.latestColonists.filter((c) => game.selectedIds.has(c.id) && isCommandable(c));
  }
  // A toggle turns on unless every selected unit already has it; the shape steps on from the selection's.
  function applyStrategySetting(setting: StrategySetting) {
    const units = selectedCommandable();
    if (units.length === 0) return;
    const unitIds = units.map((u) => u.id);
    if (setting === "shape") {
      const next = FORMATION_SHAPES[(FORMATION_SHAPES.indexOf(groupShape(units)) + 1) % FORMATION_SHAPES.length];
      sendMessage({ type: "regimentSettings", unitIds, shape: next });
      return;
    }
    const on = !units.every((u) => u[setting] === true);
    sendMessage({ type: "regimentSettings", unitIds, [setting]: on });
  }
  // Command bar: the setting toggles light up when every selected unit has them; Shape shows the shape.
  function refreshSettingButtons() {
    const units = selectedCommandable();
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-setting]"))) {
      const setting = b.dataset.setting as StrategySetting;
      if (setting === "shape") {
        const label = b.querySelector(".cmd-shape");
        const text = units.length > 0 ? SHAPE_LABEL[groupShape(units)] : "Shape";
        if (label && label.textContent !== text) label.textContent = text;
        continue;
      }
      b.classList.toggle("active", units.length > 0 && units.every((u) => u[setting] === true));
    }
  }
  // Order panel button / hotkey: attack-move, follow, charge and bombard wait for a right-click, hold /
  // retreat go now.
  function issueOrder(kind: ArmyOrderKind, queue: boolean) {
    if (kind === "attackMove" || kind === "follow" || kind === "charge" || kind === "bombard") {
      armOrder(armedOrder === kind ? null : kind);
      return;
    }
    sendRegimentOrder({ kind }, queue);
  }
  function setOrderGroups(groups: ArmyOrderGroupSnapshot[]) {
    orderGroups = groups;
    orderGroupOfUnit = new Map();
    for (const g of groups) for (const id of g.unitIds) orderGroupOfUnit.set(id, g);
  }
  function redrawOrderMarkers() {
    orderMarkers.layer.visible = strategyCam.active;
    if (!strategyCam.active) return;
    const units = colonistsById();
    orderMarkers.draw(orderGroups, {
      units,
      selected: game.selectedIds,
      zoom: game.camZoom,
      targetPos: (o) => {
        if (!o.targetId) return null;
        if (o.kind === "attack" || o.kind === "charge") {
          const m = game.latestMobs.find((mob) => mob.id === o.targetId);
          return m && strategySeesEnemy(m.x, m.y) ? m : null;
        }
        if (o.targetId.startsWith("p:")) return game.latestPlayersForSpells.find((p) => p.id === o.targetId!.slice(2)) ?? null;
        return units.get(o.targetId) ?? null;
      },
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && armedOrder) armOrder(null);
    const setting = strategySettingKey(e);
    if (setting) {
      e.preventDefault();
      if (!e.repeat) applyStrategySetting(setting);
      return;
    }
    const kind = strategyOrderKey(e);
    if (!kind) return;
    e.preventDefault();
    if (!e.repeat) issueOrder(kind, false);
  });
  function toggleStrategy() {
    // Stardew phase 5c: no strategy view from inside a building.
    if (interiorRef.ui?.active() && !strategyCam.inStrategy) {
      pushEventToast("build", "Step outside to use the strategy view");
      return;
    }
    const now = performance.now();
    armOrder(null);
    if (strategyCam.inStrategy) {
      strategyCam.exit(now);
      return;
    }
    // From wherever the camera is now (the rider, a fight peek, or mid exit transition).
    const focus = {
      x: (app.screen.width / 2 - worldLayer.position.x) / game.camZoom,
      y: (app.screen.height / 2 - worldLayer.position.y) / game.camZoom,
      zoom: game.camZoom,
    };
    game.fightPeek = null;
    game.fightPeekCam = null;
    cancelLeftPress();
    cancelOrderPress();
    placementGhost.visible = false;
    cursorHighlight.clear();
    strategyCam.enter(focus, now);
    enemyRegiments = [];
    refreshStrategyFog();
    buildStrategyBanners();
    dotsDirty = true;
  }
  // Camera ticker hook: pans from keys / screen edge, then the view to draw (null = follow the rider).
  function strategyCameraView(riderX: number, riderY: number): { x: number; y: number; zoom: number } | null {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastPanAt) / 1000));
    lastPanAt = now;
    strategyCam.setBounds(game.worldTilesX * game.tileSize, game.worldTilesY * game.tileSize, app.screen.width, app.screen.height);
    if (strategyCam.inStrategy && dt > 0) {
      let { dx, dy } = currentInput();
      if (game.canvasPointer && !game.panDrag) {
        if (game.canvasPointer.x <= EDGE_SCROLL_PX) dx = -1;
        else if (game.canvasPointer.x >= app.screen.width - EDGE_SCROLL_PX) dx = 1;
        if (game.canvasPointer.y <= EDGE_SCROLL_PX) dy = -1;
        else if (game.canvasPointer.y >= app.screen.height - EDGE_SCROLL_PX) dy = 1;
      }
      if (dx !== 0 || dy !== 0) {
        const step = (PAN_SCREEN_PX_PER_S * dt) / strategyCam.target.zoom / Math.hypot(dx, dy);
        strategyCam.pan(dx * step, dy * step);
      }
    }
    return strategyCam.view(now, { x: riderX, y: riderY });
  }
  // Camera ticker hook, after worldLayer is placed: LOD layer toggles, dots, banner scale, setView.
  function strategyAfterCamera() {
    const active = strategyCam.active;
    const band: LodBand = active ? lodBand(game.camZoom) : "tactical";
    const changed = band !== game.strategyBand || active !== strategyWasActive;
    game.strategyBand = band;
    const map = band === "map";
    decorSpriteLayer.visible = !map;
    tileSpriteLayer.visible = !map;
    strategicMapSprite.visible = map;
    roleRings.visible = !map;
    strategyDots.visible = map;
    strategyFog.sprite.visible = active;
    strategyBanners.layer.visible = active;
    enemyBanners.layer.visible = active;
    intel.layer.visible = active;
    orderMarkers.layer.visible = active;
    if (map && game.strategicMapDirty) {
      strategicMapSprite.texture.source.update();
      game.strategicMapDirty = false;
    }
    if (active) {
      strategyBanners.setZoom(game.camZoom);
      enemyBanners.setZoom(game.camZoom);
      drawIntel(map);
    }
    if (map && (dotsDirty || dotsZoom !== game.camZoom)) redrawStrategyDots();
    if (changed) {
      strategyWasActive = active;
      applyStrategyVisibility();
      document.body.classList.toggle("strategy-mode", active);
    }
    const label = strategyCam.inStrategy ? (adventurePrefs.on ? "Adventure" : "Exit") : adventurePrefs.on ? "Strategy" : "Command";
    if (strategyBtn.textContent !== label) strategyBtn.textContent = label;
    // Village life phase 5: adventure-view UI (hero bar, party command bar) via body.adventure-mode.
    const adventure = adventurePrefs.on && !active;
    if (document.body.classList.contains("adventure-mode") !== adventure) document.body.classList.toggle("adventure-mode", adventure);
    sendStrategyView();
  }
  // Enemies (and wildlife) are drawn in strategy mode only inside live vision.
  function strategySeesEnemy(x: number, y: number): boolean {
    return !strategyCam.active || strategyFog.sees(x, y);
  }
  function refreshStrategyFog() {
    strategyFog.update(minimapApi.explored, liveVisionSources(game.latestPlayersForSpells, game.latestColonists));
    fogUpdatedAt = performance.now();
  }
  function setEntityVisible(e: EntityVisual, visible: boolean) {
    e.sprite.visible = visible;
    e.hpBar.visible = visible;
    if (visible) return;
    for (const part of [e.marker, e.wound, e.aura, e.sigil, e.markLabel, e.bossLabel, e.heroLabel, e.questMark]) if (part) part.visible = false;
  }
  // After each snapshot's syncs (which reset colonist / player visibility) and on a band change. Showing
  // only touches sprite + HP bar; the wound / mark / boss parts follow the sprite on the next snapshot.
  function applyStrategyVisibility() {
    const on = strategyCam.active;
    const map = game.strategyBand === "map";
    const field = game.strategyBand === "field";
    for (const m of game.latestMobs) {
      const e = mobSprites.get(m.id);
      if (!e) continue;
      const show = !on || (!map && strategyFog.sees(m.x, m.y));
      if (show !== e.sprite.visible) setEntityVisible(e, show);
    }
    for (const w of wildlifeSprites.values()) w.sprite.visible = !on || strategyFog.sees(w.sprite.position.x, w.sprite.position.y);
    for (const c of game.latestColonists) {
      const e = colonistSprites.get(c.id);
      if (!e) continue;
      if (on && map) setEntityVisible(e, false);
      e.sprite.alpha = on && field && WORKER_KINDS.has(c.kind) ? 0.5 : 1;
    }
    if (on && map) for (const e of playerSprites.values()) setEntityVisible(e, false);
  }
  function redrawStrategyDots() {
    const dots: UnitDot[] = [];
    for (const tc of game.latestTownCenters) dots.push({ x: (tc.x + 0.5) * game.tileSize, y: (tc.y + 0.5) * game.tileSize, color: 0x7a1f1a, r: 5, square: true });
    for (const c of game.latestColonists) {
      if (!isCommandable(c)) continue;
      const role = unitRole(c.kind, c.heroClass);
      dots.push({ x: c.x, y: c.y, color: game.selectedIds.has(c.id) ? SELECTION_COLOR : role ? ROLE_COLORS[role] : 0xf3da98, r: 2 });
    }
    for (const m of game.latestMobs) if (strategyFog.sees(m.x, m.y)) dots.push({ x: m.x, y: m.y, color: 0xff3b2a, r: 2.5 });
    // Phase 5: every summarised enemy regiment (also those beyond the snapshot's mob cull).
    for (const e of enemyRegiments) dots.push({ x: e.x, y: e.y, color: 0xff3b2a, r: 3 + Math.min(4, Math.sqrt(e.count)), ring: true });
    for (const p of game.latestPlayersForSpells) {
      if (!p.dead && !p.inside) dots.push({ x: p.x, y: p.y, color: p.id === game.myId ? 0xffffff : p.color, r: 4, ring: true });
    }
    drawUnitDots(strategyDots, game.camZoom, dots);
    dotsZoom = game.camZoom;
    dotsDirty = false;
  }
  function colonistsById(): Map<string, ColonistSnapshot> {
    return new Map(game.latestColonists.map((c) => [c.id, c]));
  }
  // Centre of the alive units of the list (no-op if none is alive).
  function centreOnUnits(ids: string[]) {
    const byId = colonistsById();
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) continue;
      x += c.x;
      y += c.y;
      n++;
    }
    if (n > 0) strategyCam.jumpTo(x / n, y / n);
  }
  // Strategy mode selection widens a pick to whole regiments (Alt keeps single units, see pointerup).
  function wholeRegiments(ids: Iterable<string>): string[] {
    const out = new Set<string>();
    for (const id of ids) {
      const reg = regimentOfUnit.get(id);
      if (reg) for (const u of reg.unitIds) out.add(u);
      else out.add(id);
    }
    return Array.from(out);
  }
  // Banners over each regiment's alive units and the card bar, from the server regiments + live HP.
  function buildStrategyBanners() {
    const byId = colonistsById();
    const banners: BannerGroup[] = [];
    const cards: RegimentCard[] = [];
    for (const reg of armyRegiments) {
      let x = 0;
      let y = 0;
      let hp = 0;
      let maxHp = 0;
      let first: ColonistSnapshot | null = null;
      let stance: Stance | null | undefined;
      let holdFire = true;
      let skirmish = true;
      let cycle = true;
      let shape: FormationShape | null | undefined;
      let alive = 0;
      let selected = 0;
      for (const id of reg.unitIds) {
        const u = byId.get(id);
        if (!u) continue;
        first ??= u;
        stance = stance === undefined ? u.stance : stance === u.stance ? stance : null;
        holdFire &&= u.holdFire === true;
        skirmish &&= u.skirmish === true;
        cycle &&= u.cycleCharge === true;
        const us = u.shape ?? "line";
        shape = shape === undefined ? us : shape === us ? shape : null;
        alive++;
        if (game.selectedIds.has(id)) selected++;
        x += u.x;
        y += u.y;
        hp += Math.max(0, u.hp);
        maxHp += u.maxHp;
      }
      const hpFrac = maxHp > 0 ? hp / maxHp : alive === 0 ? 0 : reg.hpFrac;
      const roleColor = reg.role ? ROLE_COLORS[reg.role] : 0xd8a24a;
      const count = `${alive}/${Math.max(reg.maxCount, alive)}`;
      if (alive > 0) {
        // Phase 6: morale bar + state tag; a routing banner goes grey, a wavering one amber.
        const moraleColor = reg.moraleState === "routing" ? 0x8a8a8a : reg.moraleState === "wavering" ? 0xffb02e : roleColor;
        banners.push({
          key: reg.id,
          label: reg.name,
          count,
          hpFrac,
          color: selected > 0 ? SELECTION_COLOR : moraleColor,
          x: x / alive,
          y: y / alive - BANNER_LIFT_PX,
          ...(reg.morale !== undefined ? { morale: reg.morale / 100 } : {}),
          ...(reg.moraleState === "routing" ? { tag: "Routing" } : reg.moraleState === "wavering" ? { tag: "Wavering" } : reg.outflanked ? { tag: "Outflanked!" } : {}),
        });
      }
      const iconKind: ColonistKind = first
        ? first.kind === "hero" ? HERO_VISUAL_KIND[first.heroClass ?? "champion"] : first.kind
        : REGIMENT_ICON_KIND[reg.cls];
      cards.push({
        id: reg.id,
        name: reg.name,
        icon: `/sprites/${iconKind}Walk0.png`,
        count: alive,
        maxCount: Math.max(reg.maxCount, alive),
        hpFrac,
        role: reg.role,
        roleLabel: reg.cls === "clergy" ? "Healer" : reg.role ? ROLE_LABEL[reg.role] : "",
        roleColor: `#${roleColor.toString(16).padStart(6, "0")}`,
        hero: reg.cls === "hero",
        slot: reg.taskForce,
        stance: stance ?? undefined,
        order: regimentOrderLabel(reg),
        flags: alive > 0 ? [holdFire && "HF", skirmish && "Sk", cycle && "Cyc", shape && shape !== "line" && SHAPE_LABEL[shape]].filter(Boolean).join(" ") || undefined : undefined,
        morale: alive > 0 ? reg.morale : undefined,
        moraleState: alive > 0 ? reg.moraleState : undefined,
        outflanked: alive > 0 && reg.outflanked === true,
        selected: alive > 0 && selected === alive,
      });
    }
    strategyBanners.sync(banners);
    regimentCards.render(cards);
    buildEnemyIntel(byId, banners);
  }
  // Phase 5: the selection's (else the whole army's) Lanchester power: sum hp x sum damage, each regiment's
  // damage (snapshot ArmyRegimentSnapshot.dmg) prorated by its share of selected alive members.
  function ownPower(byId: Map<string, ColonistSnapshot>): number {
    const any = Array.from(game.selectedIds).some((id) => { const c = byId.get(id); return !!c && isCommandable(c); });
    let hp = 0;
    let dmg = 0;
    for (const reg of armyRegiments) {
      let alive = 0;
      let picked = 0;
      for (const id of reg.unitIds) {
        const u = byId.get(id);
        if (!u) continue;
        alive++;
        if (any && !game.selectedIds.has(id)) continue;
        picked++;
        hp += Math.max(0, u.hp);
      }
      if (alive > 0) dmg += ((reg.dmg ?? 0) * picked) / alive;
    }
    return hp * dmg;
  }
  // Enemy banners (strength band vs the selection / army) and the own regiments under threat: targeted by
  // a visible flank group, or a visible enemy behind the facing line of their order group.
  function buildEnemyIntel(byId: Map<string, ColonistSnapshot>, own: BannerGroup[]) {
    const power = ownPower(byId);
    const groups: BannerGroup[] = enemyRegiments.map((e) => {
      const band = strengthBand(e.power, power);
      return {
        key: `e:${e.id}`,
        label: enemyBannerLabel(e, band),
        count: `${e.count}${e.partial ? "+" : ""}`,
        hpFrac: e.hpFrac,
        color: e.routed ? 0x8a8a8a : BAND_COLORS[band],
        x: e.x,
        y: e.y - BANNER_LIFT_PX,
        // Phase 6: the enemy's morale bar, and "Outflanked!" when a rear attack is draining it.
        ...(e.morale !== undefined ? { morale: e.morale / 100 } : {}),
        ...(e.outflanked && !e.routed ? { tag: "Outflanked!" } : {}),
      };
    });
    enemyBanners.sync(groups);
    const ownPos = new Map(own.map((b) => [b.key, b]));
    const threats = new Map<string, Threat>();
    for (const e of enemyRegiments) {
      const reg = e.flank?.targetId ? regimentOfUnit.get(e.flank.targetId) : undefined;
      const b = reg ? ownPos.get(reg.id) : undefined;
      if (reg && b) threats.set(reg.id, { x: b.x, y: b.y, text: "Flank threatened" });
    }
    const near = REAR_THREAT_TILES * game.tileSize;
    const seen = game.latestMobs.filter((m) => strategySeesEnemy(m.x, m.y));
    for (const reg of armyRegiments) {
      const b = ownPos.get(reg.id);
      const g = reg.unitIds.length > 0 ? orderGroupOfUnit.get(reg.unitIds[0]) : undefined;
      if (!b || threats.has(reg.id) || g?.facing === undefined || seen.length === 0) continue;
      const fx = Math.cos(g.facing);
      const fy = Math.sin(g.facing);
      const members = reg.unitIds.map((id) => byId.get(id)).filter((u): u is ColonistSnapshot => !!u);
      const cx = members.reduce((sum, u) => sum + u.x, 0) / members.length;
      const cy = members.reduce((sum, u) => sum + u.y, 0) / members.length;
      const behind = seen.some(
        (m) => (m.x - cx) * fx + (m.y - cy) * fy < -game.tileSize && members.some((u) => Math.abs(u.x - m.x) <= near && Math.abs(u.y - m.y) <= near && Math.hypot(u.x - m.x, u.y - m.y) <= near)
      );
      if (behind) threats.set(reg.id, { x: b.x, y: b.y, text: "Rear threatened" });
    }
    strategyThreats = Array.from(threats.values());
  }
  // Every frame in strategy mode: flank arrows, threats, clash icons (Map band) and objective markers.
  function drawIntel(mapBand: boolean) {
    const objectives: ObjectiveMarker[] = [];
    const castleGoal = hudPanelsApi.latestGoal !== null && hudPanelsApi.latestGoal.index < hudPanelsApi.latestGoal.total && /castle ruin/i.test(hudPanelsApi.latestGoal.title);
    if (game.castleRuinTile && minimapApi.explored[game.castleRuinTile.y * game.worldTilesX + game.castleRuinTile.x]) {
      objectives.push({
        key: "castle", kind: "castle", label: castleGoal ? hudPanelsApi.latestGoal!.title : "Castle Ruin", objective: castleGoal,
        x: (game.castleRuinTile.x + 0.5) * game.tileSize, y: (game.castleRuinTile.y + 0.5) * game.tileSize,
      });
    }
    for (const index of game.latestHearths) {
      if (!minimapApi.explored[index]) continue;
      objectives.push({
        key: `h${index}`, kind: "camp", label: "Camp", objective: false,
        x: ((index % game.worldTilesX) + 0.5) * game.tileSize, y: (Math.floor(index / game.worldTilesX) + 0.5) * game.tileSize,
      });
    }
    intel.draw({
      zoom: game.camZoom,
      mapBand,
      enemies: enemyRegiments,
      clashes: mapBand ? fightArrowsApi.latestFights.filter(fightIsOnScreen).map((f) => ({ fight: f, ...fightWorldPos(f) })) : [],
      threats: strategyThreats,
      objectives,
      now: performance.now(),
    });
  }
  // The order glyph of a regiment whose members all share one order group ("Hold", "Move +2").
  function regimentOrderLabel(reg: ArmyRegimentSnapshot): string | undefined {
    const g = reg.unitIds.length > 0 ? orderGroupOfUnit.get(reg.unitIds[0]) : undefined;
    if (!g || !g.order || !reg.unitIds.every((id) => orderGroupOfUnit.get(id) === g)) return undefined;
    const label = g.engaged ? "Engaged" : ORDER_LABEL[g.order.kind];
    return g.queue.length > 0 ? `${label} +${g.queue.length}` : label;
  }
  function setArmyRegiments(regiments: ArmyRegimentSnapshot[]) {
    armyRegiments = regiments;
    regimentOfUnit = new Map();
    for (const reg of regiments) for (const id of reg.unitIds) regimentOfUnit.set(id, reg);
  }
  // Control groups (task forces): select slot N; a second tap of N within GROUP_DOUBLE_TAP_MS centres on it.
  function recallControlGroup(slot: number) {
    const ids = game.latestTaskForces[String(slot)] ?? [];
    setSelection(ids);
    const now = performance.now();
    if (strategyCam.inStrategy && lastGroupTap.slot === slot && now - lastGroupTap.at <= GROUP_DOUBLE_TAP_MS) centreOnUnits(ids);
    lastGroupTap = { slot, at: now };
  }
  // Strategy mode: a plain 1-9 recalls that control group when it has one (else it stays a build hotkey).
  function isStrategyGroupRecall(e: KeyboardEvent): number {
    if (!strategyCam.inStrategy || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return 0;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (!digit || !(game.latestTaskForces[digit[1]]?.length > 0)) return 0;
    return Number(digit[1]);
  }
  function strategyOnSnapshot(
    players: PlayerSnapshot[],
    regiments: ArmyRegimentSnapshot[] | undefined,
    groups: ArmyOrderGroupSnapshot[] | undefined,
    enemies: EnemyRegimentSnapshot[] | undefined
  ) {
    if (regiments) setArmyRegiments(regiments);
    if (enemies) enemyRegiments = enemies;
    if (groups) setOrderGroups(groups);
    redrawOrderMarkers();
    if (strategyCam.active) {
      if (performance.now() - fogUpdatedAt >= STRATEGY_FOG_REFRESH_MS) {
        strategyFog.update(minimapApi.explored, liveVisionSources(players, game.latestColonists));
        fogUpdatedAt = performance.now();
      }
      buildStrategyBanners();
      dotsDirty = true;
    }
    applyStrategyVisibility();
  }
  function strategyOnWelcome() {
    if (viewSent) {
      const off: ClientMessage = { type: "setView", x: 0, y: 0, halfW: 0, halfH: 0, strategy: false };
      sendMessage(off);
      viewSent = null;
    }
    strategyCam.reset();
    advCam.sync(NaN, NaN, performance.now());
    game.pendingStartStrategy = adventurePrefs.startStrategy;
    cancelPanDrag();
    strategyFog.reset(game.worldTilesX, game.worldTilesY, game.tileSize);
    strategyBanners.clear();
    setArmyRegiments([]);
    setOrderGroups([]);
    orderMarkers.clear();
    armOrder(null);
    regimentCards.render([]);
    strategyDots.clear();
    enemyRegiments = [];
    strategyThreats = [];
    enemyBanners.clear();
    intel.clear();
    worldLayer.addChild(strategyDots);
    worldLayer.addChild(orderMarkers.layer);
    worldLayer.addChild(intel.layer);
    worldLayer.addChild(enemyBanners.layer);
    worldLayer.addChild(strategyBanners.layer);
  }
  // At most every SET_VIEW_INTERVAL_MS and only when the target moved / resized by a tile or more; one
  // strategy:false when the mode ends.
  function sendStrategyView() {
    if (!strategyCam.inStrategy) {
      if (viewSent) {
        const off: ClientMessage = { type: "setView", x: 0, y: 0, halfW: 0, halfH: 0, strategy: false };
        sendMessage(off);
        viewSent = null;
      }
      return;
    }
    const now = performance.now();
    if (now - viewSentAt < SET_VIEW_INTERVAL_MS) return;
    const t = strategyCam.target;
    const round = (n: number) => Math.round(n * 10) / 10;
    const v = {
      x: round(t.x / game.tileSize),
      y: round(t.y / game.tileSize),
      halfW: round(app.screen.width / 2 / t.zoom / game.tileSize),
      halfH: round(app.screen.height / 2 / t.zoom / game.tileSize),
    };
    const prev = viewSent;
    if (prev && Math.abs(v.x - prev.x) < 1 && Math.abs(v.y - prev.y) < 1 && Math.abs(v.halfW - prev.halfW) < 1 && Math.abs(v.halfH - prev.halfH) < 1) return;
    const msg: ClientMessage = { type: "setView", ...v, strategy: true };
    sendMessage(msg);
    viewSent = v;
    viewSentAt = now;
  }
  return { toggleStrategy, strategyCameraView, strategyAfterCamera, strategyOrderKey, strategySeesEnemy, refreshSettingButtons, issueOrder, applyStrategySetting, buildStrategyBanners, redrawOrderMarkers, strategyOnWelcome, strategyOnSnapshot, isStrategyGroupRecall, strategySettingKey, recallControlGroup, selectedCommandable, sendRegimentOrder, strategyBtn, STRATEGY_HIT_SCREEN_PX, enemyBanners, armOrder, followTargetAt, strategyLine, keptFormation, cancelPanDrag, wholeRegiments, intel, STRATEGY_CLASH_ZOOM, get regimentOfUnit() { return regimentOfUnit; }, get enemyRegiments() { return enemyRegiments; }, get armedOrder() { return armedOrder; }, get armyRegiments() { return armyRegiments; } };
}
