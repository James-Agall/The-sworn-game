// Strategy mode phase 3 (docs PLAN-strategy-mode.md §2 "Controls", §6 Phase 3): order markers on the map
// for the server's order groups (snapshot orderGroups): a path line from each group's centre through its
// current order and queued waypoints (numbered pips), a line to a followed / attacked target, a diamond
// over a holding group, and for the selected groups the formation slots of the current and queued
// orders (formation.ts, the same solve the server forms with). main.ts owns input; this only draws.
// Phase 4: charge / bombard / attackHearth markers, and range rings round the selected ranged / siege units.
import { Container, Graphics, Text } from "pixi.js";
import type { ArmyOrder, ArmyOrderGroupSnapshot, ArmyOrderKind, ColonistSnapshot } from "@colony/shared/protocol";
import { TILE_SIZE } from "@colony/shared/protocol";
import { planOrderFormation } from "@colony/shared/formation";

export const ORDER_COLORS: Record<ArmyOrderKind, number> = {
  move: 0x00e5ff,
  attackMove: 0xff7a3a,
  retreat: 0xf2c94c,
  hold: 0xe8e8e8,
  follow: 0x3bd16f,
  attack: 0xff3b2a,
  charge: 0xffb02e,
  bombard: 0xb36bff,
  attackHearth: 0xff3b2a,
};
export const ORDER_LABEL: Record<ArmyOrderKind, string> = {
  move: "Move",
  attackMove: "Atk-move",
  retreat: "Retreat",
  hold: "Hold",
  follow: "Follow",
  attack: "Attack",
  charge: "Charge",
  bombard: "Bombard",
  attackHearth: "Siege",
};
// Range rings (tiles; mirrors the server's ARCHER_ATTACK_RANGE, HERO_CLASS_STATS, CATAPULT_*): [max, min?].
const RANGE_RING_TILES: Partial<Record<string, [number, number?]>> = {
  archer: [4],
  catapult: [11, 3],
  marksman: [5],
  mage: [7],
};
const RANGE_RING_COLOR = 0x9fe0ff;
const RANGED_SLOT_COLOR = 0x58b85c;
const PIP_SCREEN_PX = 7;
const LINE_SCREEN_PX = 2;

export interface OrderDrawContext {
  units: Map<string, ColonistSnapshot>;
  selected: Set<string>;
  zoom: number;
  // Where a follow / attack target is now (null = gone or not visible).
  targetPos(order: ArmyOrder): { x: number; y: number } | null;
}

export class OrderMarkers {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly pips: Text[] = [];

  constructor() {
    this.layer.addChild(this.g);
  }

  clear() {
    this.g.clear();
    for (const t of this.pips) t.visible = false;
  }

  draw(groups: ArmyOrderGroupSnapshot[], ctx: OrderDrawContext) {
    const g = this.g;
    g.clear();
    const k = 1 / Math.max(0.05, ctx.zoom);
    let pipN = 0;
    for (const grp of groups) {
      const members: ColonistSnapshot[] = [];
      let sel = false;
      for (const id of grp.unitIds) {
        const u = ctx.units.get(id);
        if (!u) continue;
        members.push(u);
        if (ctx.selected.has(id)) sel = true;
      }
      if (members.length === 0) continue;
      let cx = 0;
      let cy = 0;
      for (const u of members) {
        cx += u.x;
        cy += u.y;
      }
      cx /= members.length;
      cy /= members.length;
      const alpha = sel ? 0.9 : 0.45;
      const chain = grp.order ? [grp.order, ...grp.queue] : grp.queue;
      let fromX = cx;
      let fromY = cy;
      let facing = grp.facing;
      let width = grp.width;
      chain.forEach((o, i) => {
        const color = ORDER_COLORS[o.kind];
        if (o.kind === "hold") {
          const r = 6 * k;
          g.poly([fromX, fromY - 18 * k - r, fromX + r, fromY - 18 * k, fromX, fromY - 18 * k + r, fromX - r, fromY - 18 * k])
            .fill({ color, alpha })
            .stroke({ width: k, color: 0x0a1a24, alpha });
          return;
        }
        if (o.kind === "attackHearth" && o.tileX !== undefined && o.tileY !== undefined) {
          const hx = (o.tileX + 0.5) * TILE_SIZE;
          const hy = (o.tileY + 0.5) * TILE_SIZE;
          g.moveTo(fromX, fromY).lineTo(hx, hy).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
          g.rect(hx - 12 * k, hy - 12 * k, 24 * k, 24 * k).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
          return;
        }
        if (o.kind === "bombard" && o.x !== undefined && o.y !== undefined) {
          // Crosshair + the boulder's splash (1.5 tiles).
          const r = TILE_SIZE * 1.5;
          g.moveTo(fromX, fromY).lineTo(o.x, o.y).stroke({ width: LINE_SCREEN_PX * k, color, alpha: alpha * 0.6 });
          g.circle(o.x, o.y, r).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
          g.moveTo(o.x - r, o.y).lineTo(o.x + r, o.y).moveTo(o.x, o.y - r).lineTo(o.x, o.y + r).stroke({ width: k, color, alpha });
          return;
        }
        if (o.kind === "follow" || o.kind === "attack" || o.kind === "charge") {
          const t = ctx.targetPos(o);
          if (!t) return;
          g.moveTo(fromX, fromY).lineTo(t.x, t.y).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
          g.circle(t.x, t.y, 9 * k).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
          return;
        }
        if (o.x === undefined || o.y === undefined) return;
        g.moveTo(fromX, fromY).lineTo(o.x, o.y).stroke({ width: LINE_SCREEN_PX * k, color, alpha });
        // Slot ghosts for the selected groups. The current order carries the facing the server formed
        // with; a queued one without a facing is approximated as the server will: facing its march.
        if (sel) {
          const f = o.facing ?? (i === 0 && grp.order === o ? undefined : Math.atan2(o.y - fromY, o.x - fromX));
          const w = o.width ?? (o.facing === undefined ? width : undefined);
          const plan = planOrderFormation(members, o.x, o.y, f ?? facing, w);
          for (const s of plan.targets.values()) {
            if (s.rear) g.rect(s.x - 3.5, s.y - 3.5, 7, 7).stroke({ width: 1.5, color: RANGED_SLOT_COLOR, alpha: 0.55 });
            else g.circle(s.x, s.y, 4).stroke({ width: 1.5, color, alpha: 0.55 });
          }
          facing = Math.atan2(plan.fy, plan.fx);
          width = w;
        }
        g.circle(o.x, o.y, PIP_SCREEN_PX * k).fill({ color, alpha }).stroke({ width: k, color: 0x0a1a24, alpha });
        const pip = this.pip(pipN++);
        pip.text = String(i + 1);
        pip.position.set(o.x, o.y);
        pip.scale.set(k);
        pip.alpha = alpha;
        fromX = o.x;
        fromY = o.y;
      });
    }
    for (let i = pipN; i < this.pips.length; i++) this.pips[i].visible = false;
    // Range rings for the selected ranged / siege units (catapults also show their minimum range).
    for (const id of ctx.selected) {
      const u = ctx.units.get(id);
      if (!u) continue;
      const ring = RANGE_RING_TILES[u.kind === "hero" ? u.heroClass ?? "" : u.kind];
      if (!ring) continue;
      g.circle(u.x, u.y, ring[0] * TILE_SIZE).stroke({ width: k, color: RANGE_RING_COLOR, alpha: 0.35 });
      if (ring[1]) g.circle(u.x, u.y, ring[1] * TILE_SIZE).stroke({ width: k, color: 0xff7a3a, alpha: 0.3 });
    }
  }

  private pip(i: number): Text {
    let t = this.pips[i];
    if (!t) {
      t = new Text({ text: "", style: { fontFamily: "monospace", fontSize: 10, fontWeight: "bold", fill: 0x0a1a24 } });
      t.anchor.set(0.5);
      this.pips.push(t);
      this.layer.addChild(t);
    }
    t.visible = true;
    return t;
  }
}
