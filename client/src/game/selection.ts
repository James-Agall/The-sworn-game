// Unit selection: commandable check, role / selection rings, the selection HUD and command bar, order stamps
// and the formation marker / planned-move dispatch. Split out of main.ts (2026-11-27).
import { Application, Graphics } from "pixi.js";
import type { ColonistSnapshot, ColonistKind, MobSnapshot, Stance } from "@colony/shared/protocol";
import { TileType } from "@colony/shared/protocol";
import { MOB_ROLE, unitRole, HERO_CLASS_LABEL } from "@colony/shared/protocol";
import type { CombatRole } from "@colony/shared/protocol";
import { LINE_FACE_ENEMY_TILES, computeFormationTargets, computeLineFormationTargets as sharedLineFormation } from "@colony/shared/formation";
import type { FormationPlan } from "@colony/shared/formation";
import { StrategyCamera } from "../strategy/camera";
import type { ArmyOrderKind } from "@colony/shared/protocol";
import { COMMANDABLE_KINDS, SELECTION_COLOR, ROLE_COLORS, ROLE_LABEL, STANCE_LABEL, FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS, FORMATION_MARKER_MIN_MS, FORMATION_MARKER_MAX_MS, FORMATION_MARKER_FADE_MS } from "../unitVisuals";
import type { AnimSet, StrategySetting } from "./types";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface SelectionContext {
  roleRings: Graphics;
  colonistTierSet: (c: ColonistSnapshot) => AnimSet | undefined;
  selectionRings: Graphics;
  statSelectedEl: HTMLElement;
  strategyCam: StrategyCamera;
  sendMessage: (msg: object) => void;
  app: Application;
  readonly myClan: number;
  readonly tiles: number[];
  readonly worldTilesX: number;
  readonly latestColonists: ColonistSnapshot[];
  readonly clanColors: Map<number, number>;
  readonly latestMobs: MobSnapshot[];
  readonly strategySeesEnemy: (x: number, y: number) => boolean;
  selectedIds: Set<string>;
  readonly refreshSettingButtons: () => void;
  readonly issueOrder: (kind: ArmyOrderKind, queue: boolean) => void;
  readonly applyStrategySetting: (setting: StrategySetting) => void;
  readonly buildStrategyBanners: () => void;
  readonly redrawOrderMarkers: () => void;
  readonly tileSize: number;
}

export function createSelection(game: SelectionContext) {
  const { roleRings, colonistTierSet, selectionRings, statSelectedEl, strategyCam, sendMessage, app } = game;
  // Mirrors the server's isCommandable: of the bishops, only a Church's takes orders — the Ward
  // Priest (whose post is always the Ward Stone he's bound for) keeps his rounds, and Saint Wren's
  // Abbey clergy (posted at an AbbeyHall) aren't ours.
  function isCommandable(c: ColonistSnapshot): boolean {
    if (!COMMANDABLE_KINDS.has(c.kind)) return false;
    // Clans: another clan's units are neutral, never ours to command.
    if ((c.clan ?? 0) !== game.myClan) return false;
    return c.kind !== "bishop" || game.tiles[c.postY * game.worldTilesX + c.postX] === TileType.ChurchPost;
  }
  // Armour tier tint (T1 bronze, T2 silver, T3 gold).
  const ARMOUR_TIER_COLORS = [0xcd7f32, 0xc0c8d0, 0xf2c94c];
  // Regiments & roles: a thin role-tinted ring at the feet of every soldier and monster (ROLE_COLORS).
  function drawRoleRings() {
    roleRings.clear();
    const ring = (x: number, y: number, role: CombatRole | undefined, r: number) => {
      if (role) roleRings.ellipse(x, y + r * 0.8, r, r * 0.4).stroke({ width: 1.5, color: ROLE_COLORS[role], alpha: 0.65 });
    };
    for (const c of game.latestColonists) {
      const r = c.kind === "cavalry" || c.kind === "batteringRam" || c.kind === "catapult" ? 12 : 9;
      ring(c.x, c.y, unitRole(c.kind, c.heroClass), r);
      // Clans: another clan's unit wears a ring in its clan colour.
      if ((c.clan ?? 0) !== game.myClan) {
        roleRings.ellipse(c.x, c.y + r * 0.8, r + 2, (r + 2) * 0.4).stroke({ width: 2, color: game.clanColors.get(c.clan ?? 0) ?? 0xffffff, alpha: 0.9 });
      }
      // Armour & weapons: a thin bronze / silver / gold ring just inside the role ring shows the unit's
      // armour tier, only where its tier art (COLONIST_TIER_ANIMS) is missing.
      const tier = c.armourTier ?? 0;
      if (tier > 0 && !colonistTierSet(c)) roleRings.ellipse(c.x, c.y + r * 0.8, r - 2.5, (r - 2.5) * 0.4).stroke({ width: 1.5, color: ARMOUR_TIER_COLORS[tier - 1], alpha: 0.85 });
      // Hero phase 3: a gold ring outside the role ring with four pips on it.
      if (c.kind === "hero") {
        const hr = r + 3;
        roleRings.ellipse(c.x, c.y + r * 0.8, hr, hr * 0.4).stroke({ width: 2, color: 0xf2c94c, alpha: 0.95 });
        for (const [px, py] of [[hr, 0], [-hr, 0], [0, hr * 0.4], [0, -hr * 0.4]]) roleRings.circle(c.x + px, c.y + r * 0.8 + py, 1.8).fill(0xffe9a8);
      }
    }
    for (const m of game.latestMobs) if (game.strategySeesEnemy(m.x, m.y)) ring(m.x, m.y, MOB_ROLE[m.kind], 10);
  }
  function redrawSelectionRings() {
    selectionRings.clear();
    for (const c of game.latestColonists) {
      if (!game.selectedIds.has(c.id)) continue;
      selectionRings.circle(c.x, c.y, 12).stroke({ width: 2, color: 0x6fbf5a, alpha: 0.4 });
    }
  }
  // Stance is only meaningful for guard-tier units, so bishops are left out of the readout (and of
  // the formation-spacing vote in groupStance).
  function refreshSelectionHud() {
    statSelectedEl.hidden = game.selectedIds.size === 0;
    const stances = new Set(
      game.latestColonists.filter((c) => game.selectedIds.has(c.id) && c.kind !== "bishop").map((c) => c.stance)
    );
    const single = stances.size === 1 ? [...stances][0] : null;
    commandBarEl.hidden = stances.size === 0;
    for (const b of Array.from(commandBarEl.querySelectorAll<HTMLElement>(".cmd-btn[data-stance]"))) {
      b.classList.toggle("active", b.dataset.stance === single);
    }
    game.refreshSettingButtons();
    const stance = stances.size === 0 ? "" : single ? STANCE_LABEL[single] : "Mixed";
    // Regiments: the selection's roles, e.g. "6 Frontline, 4 Ranged".
    const roleCounts = new Map<CombatRole, number>();
    for (const c of game.latestColonists) {
      const role = game.selectedIds.has(c.id) ? unitRole(c.kind, c.heroClass) : undefined;
      if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
    const roles = Array.from(roleCounts, ([role, n]) => `${n} ${ROLE_LABEL[role]}`).join(", ");
    let count = roles ? `${game.selectedIds.size} (${roles})` : `${game.selectedIds.size}`;
    // Armour & weapons: a single selected knight / spearman / pikeman / cavalry shows its tiers.
    if (game.selectedIds.size === 1) {
      const u = game.latestColonists.find((c) => game.selectedIds.has(c.id));
      if (u?.kind === "hero") {
        count = `${HERO_CLASS_LABEL[u.heroClass ?? "champion"]} ${u.heroName ?? ""} Lv ${u.heroLevel ?? 1} (\` opens its sheet)`;
      } else if (u && EQUIPPED_KIND_LABEL[u.kind]) {
        const t = (n: number | undefined) => (n ? `T${n}` : "none");
        count = `${EQUIPPED_KIND_LABEL[u.kind]} (armour ${t(u.armourTier)}, weapon ${t(u.weaponTier)})`;
      }
    }
    const text = stance ? `Selected: ${count} · ${stance} (Z/X/E)` : `Selected: ${count}`;
    // Called every snapshot; only touch the DOM when the line actually changes.
    if (text === lastSelectionHudText) return;
    lastSelectionHudText = text;
    if (!single) {
      statSelectedEl.textContent = text;
      return;
    }
    const icon = document.createElement("img");
    icon.className = "econ-icon";
    icon.src = `/sprites/icon-stance-${single}.png`;
    icon.alt = "";
    statSelectedEl.replaceChildren(`Selected: ${count} · `, icon, ` ${stance} (Z/X/E)`);
  }
  let lastSelectionHudText = "";
  const EQUIPPED_KIND_LABEL: Partial<Record<ColonistKind, string>> = { knight: "Knight", spearman: "Spearman", pikeman: "Pikeman", cavalry: "Cavalry" };
  const commandBarEl = document.getElementById("command-bar")!;
  commandBarEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".cmd-btn");
    // Strategy mode phase 3: order buttons (Shift+click queues Hold / Retreat).
    const orderKind = btn?.dataset.order as ArmyOrderKind | undefined;
    if (orderKind && strategyCam.inStrategy && game.selectedIds.size > 0) game.issueOrder(orderKind, e.shiftKey);
    // Strategy mode phase 4: hold fire / skirmish / cycle charge toggles and the shape cycle.
    const setting = btn?.dataset.setting as StrategySetting | undefined;
    if (setting && strategyCam.inStrategy && game.selectedIds.size > 0) game.applyStrategySetting(setting);
    const stance = btn?.dataset.stance as Stance | undefined;
    if (stance && game.selectedIds.size > 0) sendMessage({ type: "commandStance", unitIds: Array.from(game.selectedIds), stance });
  });
  // Keep a click on the bar from starting a map selection drag / deselecting.
  commandBarEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  function setSelection(ids: Iterable<string>) {
    game.selectedIds = new Set(ids);
    redrawSelectionRings();
    refreshSelectionHud();
    // Banner borders / card highlights follow the selection without waiting for a snapshot.
    if (strategyCam.inStrategy) {
      game.buildStrategyBanners();
      game.redrawOrderMarkers();
    }
  }
  function findNearest<T extends { x: number; y: number }>(
    list: T[],
    x: number,
    y: number,
    radius: number
  ): T | null {
    let best: T | null = null;
    let bestDist = radius * radius;
    for (const item of list) {
      const d = (item.x - x) ** 2 + (item.y - y) ** 2;
      if (d <= bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }
  // Newest order number per unit. A rank's delayed commandMove is dropped for any unit that has
  // since been given another order (move or attack), so the tail of a staggered formation order
  // can never overwrite a quick re-order — while orders to other units are left alone.
  let orderCounter = 0;
  const unitOrder = new Map<string, number>();
  function stampOrder(ids: string[]): number {
    orderCounter++;
    for (const id of ids) unitOrder.set(id, orderCounter);
    return orderCounter;
  }
  // Ground marker at a formation's destination: a ring per slot, a line across the front row and
  // a chevron off its middle pointing the way the block will face. Drawn once per order; only its
  // alpha changes afterwards (see the ticker below).
  const formationMarker = new Graphics();
  let formationMarkerState: {
    ids: string[];
    shownAt: number;
    settleAfter: number;
    fadeFrom: number | null;
  } | null = null;
  function hideFormationMarker() {
    formationMarker.clear();
    formationMarkerState = null;
  }
  // A formation slot: a ring on the front rank, a square (ranged green) on the rear line.
  function drawSlot(g: Graphics, pos: { x: number; y: number; rear?: boolean }, alpha: number) {
    if (pos.rear) g.rect(pos.x - 3.5, pos.y - 3.5, 7, 7).stroke({ width: 1.5, color: ROLE_COLORS.ranged, alpha });
    else g.circle(pos.x, pos.y, 4).stroke({ width: 1.5, color: SELECTION_COLOR, alpha });
  }
  function showFormationMarker(plan: FormationPlan, destX: number, destY: number, dispatchMs: number) {
    const { fx, fy } = plan;
    const px = -fy;
    const py = fx;
    formationMarker.clear();
    formationMarker.alpha = 1;
    for (const pos of plan.targets.values()) drawSlot(formationMarker, pos, 0.6);
    // Front edge sits half a slot ahead of the front row's centers.
    const edgeX = destX + fx * plan.spacing * 0.5;
    const edgeY = destY + fy * plan.spacing * 0.5;
    const half = plan.frontHalfWidth + 10;
    formationMarker
      .moveTo(edgeX - px * half, edgeY - py * half)
      .lineTo(edgeX + px * half, edgeY + py * half)
      .stroke({ width: 3, color: SELECTION_COLOR, alpha: 0.85 });
    const at = (along: number, across: number) => [edgeX + fx * along + px * across, edgeY + fy * along + py * across];
    formationMarker
      .poly([...at(16, 0), ...at(2, 11), ...at(7, 0), ...at(2, -11)])
      .fill(SELECTION_COLOR)
      .stroke({ width: 1.5, color: 0x0a1a24 });
    const now = performance.now();
    formationMarkerState = {
      ids: Array.from(plan.targets.keys()),
      shownAt: now,
      // Units only start walking once their (staggered) order reaches the server, so "everyone has
      // stopped" means nothing until the last rank's order has had a couple of ticks to land.
      settleAfter: now + Math.max(FORMATION_MARKER_MIN_MS, dispatchMs + 250),
      fadeFrom: null,
    };
  }
  app.ticker.add(() => {
    const s = formationMarkerState;
    if (!s) return;
    const now = performance.now();
    if (s.fadeFrom === null) {
      const ids = new Set(s.ids);
      // Settled = not walking to its slot any more: arrived (idle) or busy fighting/healing.
      const stillMarching = game.latestColonists.some((c) => ids.has(c.id) && c.state === "returning");
      if ((now >= s.settleAfter && !stillMarching) || now - s.shownAt > FORMATION_MARKER_MAX_MS) {
        s.fadeFrom = now;
      }
    }
    if (s.fadeFrom !== null) {
      const t = (now - s.fadeFrom) / FORMATION_MARKER_FADE_MS;
      if (t >= 1) hideFormationMarker();
      else formationMarker.alpha = 1 - t;
    }
  });
  // Custom-width formation (formation.ts): the player dragged a line on the ground; the units face away
  // from their side of it, or toward the nearest enemy within LINE_FACE_ENEMY_TILES of its centre.
  function computeLineFormationTargets(units: ColonistSnapshot[], ax: number, ay: number, bx: number, by: number) {
    const foe = findNearest(game.latestMobs, (ax + bx) / 2, (ay + by) / 2, LINE_FACE_ENEMY_TILES * game.tileSize);
    return sharedLineFormation(units, ax, ay, bx, by, { foe });
  }
  function dispatchFormationMove(units: ColonistSnapshot[], destX: number, destY: number, order: number) {
    dispatchPlannedMove(units, computeFormationTargets(units, destX, destY), destX, destY, order);
  }
  function dispatchPlannedMove(units: ColonistSnapshot[], plan: FormationPlan, destX: number, destY: number, order: number) {
    const distToSlot = (u: ColonistSnapshot) => {
      const slot = plan.targets.get(u.id)!;
      return Math.hypot(slot.x - u.x, slot.y - u.y);
    };
    const queue = units.slice().sort((a, b) => distToSlot(a) - distToSlot(b));
    const step = Math.min(FORMATION_DISPATCH_STEP_MS, FORMATION_DISPATCH_MAX_SPREAD_MS / (queue.length - 1));
    queue.forEach((u, i) => {
      const send = () => {
        if (unitOrder.get(u.id) !== order) return;
        const pos = plan.targets.get(u.id)!;
        // One squad per formation order: the server marches its members at one pace.
        sendMessage({ type: "commandMove", unitIds: [u.id], x: pos.x, y: pos.y, squad: queue.length > 1 ? `o${order}` : undefined });
      };
      if (i === 0) send();
      else setTimeout(send, i * step);
    });
    showFormationMarker(plan, destX, destY, (queue.length - 1) * step);
  }
  return { setSelection, findNearest, formationMarker, drawRoleRings, isCommandable, redrawSelectionRings, refreshSelectionHud, commandBarEl, computeLineFormationTargets, stampOrder, hideFormationMarker, unitOrder, dispatchPlannedMove, dispatchFormationMove, drawSlot };
}
