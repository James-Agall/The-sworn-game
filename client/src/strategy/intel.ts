// Strategy mode phase 5 (docs PLAN-strategy-mode.md §3 "Tactical aids"): battlefield intel drawn over the
// map: strength bands for the server's enemy regiment summaries (snapshot enemyRegiments), flank arrows,
// "flank / rear threatened" warnings over own regiments, clash icons for fights in the Map band, and
// objective markers (Castle Ruin, camp hearths). main.ts owns the data and input; this only draws.
import { Container, Graphics, Text } from "pixi.js";
import type { EnemyRegimentSnapshot, FightSnapshot } from "../protocol";

export type StrengthBand = "Weak" | "Even" | "Strong" | "Deadly";
const BANDS: StrengthBand[] = ["Weak", "Even", "Strong", "Deadly"];
export const BAND_COLORS: Record<StrengthBand, number> = { Weak: 0x3bd16f, Even: 0xf2c94c, Strong: 0xff7a3a, Deadly: 0xff3b2a };

// Enemy power / own power (both Lanchester: sum hp x sum damage): < 0.5 Weak, < 1.5 Even, < 3 Strong.
export function strengthBand(enemyPower: number, ownPower: number): StrengthBand {
  if (ownPower <= 0) return enemyPower > 0 ? "Deadly" : "Even";
  const r = enemyPower / ownPower;
  return r < 0.5 ? "Weak" : r < 1.5 ? "Even" : r < 3 ? "Strong" : "Deadly";
}

// A partly seen regiment is a lower bound: shown as a range one band up ("Even-Strong").
export function bandText(band: StrengthBand, partial: boolean): string {
  if (!partial) return band;
  const i = BANDS.indexOf(band);
  return i < BANDS.length - 1 ? `${band}-${BANDS[i + 1]}` : `${band}?`;
}

export function enemyBannerLabel(e: EnemyRegimentSnapshot, band: StrengthBand): string {
  const state = e.routed ? " · fleeing" : e.sheltering ? " · behind walls" : "";
  return `${e.massing ? "Massing: " : ""}${e.label} · ${bandText(band, e.partial === true)}${state}`;
}

export interface Threat {
  x: number;
  y: number;
  text: string;
}

export interface ObjectiveMarker {
  key: string;
  x: number;
  y: number;
  label: string;
  kind: "castle" | "camp";
  objective: boolean;
}

export interface IntelDrawContext {
  zoom: number;
  mapBand: boolean;
  enemies: EnemyRegimentSnapshot[];
  // On-screen fights (drawn as clash icons in the Map band; world px centre).
  clashes: { fight: FightSnapshot; x: number; y: number }[];
  threats: Threat[];
  objectives: ObjectiveMarker[];
  now: number;
}

const FLANK_COLOR = 0xff9f1a;
const LABEL_STYLE = { fontFamily: "Palatino Linotype, Palatino, Georgia, serif", fontSize: 11, fontWeight: "bold" as const, fill: 0xfbecc8, stroke: { color: 0x1a0f06, width: 3 } };

export class IntelOverlay {
  readonly layer = new Container();
  private g = new Graphics();
  private labels = new Map<string, Text>();
  private labelColors = new Map<string, number>();
  private clashes: { x: number; y: number; r: number }[] = [];

  constructor() {
    this.layer.addChild(this.g);
  }

  clear() {
    this.g.clear();
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
    this.labelColors.clear();
    this.clashes = [];
  }

  private label(key: string, text: string, x: number, y: number, zoom: number, color: number) {
    let t = this.labels.get(key);
    if (!t) {
      t = new Text({ text, style: { ...LABEL_STYLE } });
      t.anchor.set(0.5, 1);
      this.layer.addChild(t);
      this.labels.set(key, t);
    }
    if (t.text !== text) t.text = text;
    if (this.labelColors.get(key) !== color) {
      this.labelColors.set(key, color);
      t.style.fill = color;
    }
    t.position.set(x, y);
    t.scale.set(1 / zoom);
    return t;
  }

  // Redrawn every frame while strategy mode is active (a handful of shapes; the pulses need it).
  draw(ctx: IntelDrawContext) {
    const { zoom, now } = ctx;
    const k = 1 / zoom;
    const g = this.g;
    g.clear();
    const used = new Set<string>();
    const pulse = 0.55 + 0.45 * Math.sin(now / 160);

    // Flank arrows: a curve from the flank group round to its point behind the line.
    for (const e of ctx.enemies) {
      const f = e.flank;
      if (!f) continue;
      const dx = f.x - f.fromX;
      const dy = f.y - f.fromY;
      const len = Math.hypot(dx, dy) || 1;
      // Bow outwards, away from the regiment's centroid.
      const side = Math.sign((e.x - f.fromX) * -dy + (e.y - f.fromY) * dx) || 1;
      const cx = (f.fromX + f.x) / 2 - (dy / len) * len * 0.3 * side;
      const cy = (f.fromY + f.y) / 2 + (dx / len) * len * 0.3 * side;
      g.moveTo(f.fromX, f.fromY).quadraticCurveTo(cx, cy, f.x, f.y).stroke({ width: 3 * k, color: FLANK_COLOR, alpha: 0.9 });
      const ax = f.x - cx;
      const ay = f.y - cy;
      const al = Math.hypot(ax, ay) || 1;
      const ux = ax / al;
      const uy = ay / al;
      const h = 12 * k;
      g.moveTo(f.x, f.y)
        .lineTo(f.x - ux * h - uy * h * 0.6, f.y - uy * h + ux * h * 0.6)
        .lineTo(f.x - ux * h + uy * h * 0.6, f.y - uy * h - ux * h * 0.6)
        .closePath()
        .fill(FLANK_COLOR);
    }

    // Own regiments in danger: a pulsing warning triangle + text above the banner pin.
    ctx.threats.forEach((t, i) => {
      const s = 9 * k;
      const y = t.y - 40 * k;
      g.moveTo(t.x, y - s).lineTo(t.x + s, y + s * 0.8).lineTo(t.x - s, y + s * 0.8).closePath()
        .fill({ color: FLANK_COLOR, alpha: pulse }).stroke({ width: 1.5 * k, color: 0x1a0f06 });
      const key = `t${i}`;
      used.add(key);
      this.label(key, t.text, t.x, y - s - 2 * k, zoom, FLANK_COLOR).alpha = pulse;
    });

    // Clash icons (Map band only): crossed swords, bigger and faster the fiercer the fight.
    this.clashes = [];
    if (ctx.mapBand) {
      for (const c of ctx.clashes) {
        const i = c.fight.intensity;
        const r = (8 + 3 * i) * k;
        const a = 0.6 + 0.4 * Math.sin(now / (i >= 3 ? 110 : i === 2 ? 160 : 220));
        g.circle(c.x, c.y, r * 1.35).fill({ color: 0x1a0505, alpha: 0.75 }).stroke({ width: 2 * k, color: 0xff3b2a, alpha: a });
        g.moveTo(c.x - r, c.y - r).lineTo(c.x + r, c.y + r).moveTo(c.x + r, c.y - r).lineTo(c.x - r, c.y + r)
          .stroke({ width: 3 * k, color: 0xe8e8e8, alpha: a });
        this.clashes.push({ x: c.x, y: c.y, r: r * 1.5 });
      }
    }

    // Objectives: the Castle Ruin (gold while it is the current goal) and scouted camp hearths.
    for (const o of ctx.objectives) {
      const color = o.objective ? 0xf2c94c : o.kind === "castle" ? 0xd8cfbf : 0xff7a1a;
      const s = (o.kind === "castle" ? 9 : 6) * k;
      if (o.kind === "castle") {
        g.rect(o.x - s, o.y - s, 2 * s, 2 * s).fill({ color: 0x1a0f06, alpha: 0.8 }).stroke({ width: 2 * k, color });
        g.rect(o.x - s * 0.4, o.y - s * 0.4, s * 0.8, s * 0.8).fill(0xa8321e);
      } else {
        g.moveTo(o.x, o.y - s).lineTo(o.x + s, o.y).lineTo(o.x, o.y + s).lineTo(o.x - s, o.y).closePath()
          .fill({ color: 0x1a0f06, alpha: 0.8 }).stroke({ width: 2 * k, color });
      }
      if (o.objective) g.circle(o.x, o.y, s * (2 + pulse * 0.6)).stroke({ width: 2 * k, color, alpha: 0.8 });
      // Camp labels only zoomed out far enough that the camp itself is small.
      if (o.kind === "camp" && !ctx.mapBand && !o.objective) continue;
      used.add(o.key);
      this.label(o.key, o.objective ? `Objective: ${o.label}` : o.label, o.x, o.y - s - 3 * k, zoom, color);
    }

    for (const [key, t] of this.labels) {
      if (used.has(key)) continue;
      t.destroy();
      this.labels.delete(key);
      this.labelColors.delete(key);
    }
  }

  // The clash icon under the world point (px), as of the last draw.
  hitClash(x: number, y: number): { x: number; y: number } | null {
    for (const c of this.clashes) if (Math.hypot(x - c.x, y - c.y) <= c.r) return { x: c.x, y: c.y };
    return null;
  }
}
