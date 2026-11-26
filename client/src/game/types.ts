// Client-side types shared by main.ts and the modules split out of it (2026-11-26, SPLIT-PLAN-2026-11-26.md).
// They used to be declared inside main()'s closure.
import type { Graphics, Sprite, Texture } from "pixi.js";
import type { FightSnapshot } from "@colony/shared/protocol";
import type { WILDLIFE } from "../worldVisuals";

// Frames within one set come from one source sheet, so they share a pixel scale: one constant
// `scale` per set (sized from the first walk frame) keeps the body the same size while weapons
// swing out, instead of re-fitting every frame's canvas to a fixed height.
export interface AnimSet {
  walk: Texture[];
  action: Texture[];
  // Optional carry-home walk (hunter/forager); falls back to `walk`.
  carry?: Texture[];
  scale: number;
  refHeight: number;
}

export type FacingMap = Map<string, { lastX: number; facingRight: boolean }>;

export interface MobVariant {
  idle: Texture;
  idleScale: number;
  anim: AnimSet | null;
  // Ogre Warlord only: a standing pose shown instead of walk frame 0, and the roar frames.
  idlePose?: Texture;
  roar?: Texture[];
}

export type AnimMode = "walk" | "action" | "carry" | null;
export interface AnimState {
  mode: AnimMode;
  frame: number;
  ticksInFrame: number;
  lastX: number;
  lastY: number;
}

export interface SiteView {
  target: number;
  progress: number;
  upgrade: boolean;
  builders: number;
}

export interface FireOverlay {
  flame: Sprite;
  bar: Graphics;
  tier: number;
  phase: number;
  nextSmokeAt: number;
}

export type CritterKind = keyof typeof WILDLIFE;
export interface Critter {
  kind: CritterKind;
  sprite: Sprite;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  moving: boolean;
  moveMs: number;
  elapsedMs: number;
  restMs: number;
  phase: number;
}

export interface WildlifeSet {
  walk: Texture[];
  idle: Texture[];
  run: Texture[];
  tint: number;
}

// Client-only, short-lived combat VFX. `update` gets progress 0..1 each frame; `onEnd` can chain
// a follow-up effect (an arrow's impact spark).
export interface ActiveEffect {
  sprite: Sprite;
  startedAt: number;
  durationMs: number;
  update: (sprite: Sprite, t: number) => void;
  onEnd?: () => void;
}

export interface FightArrow {
  fight: FightSnapshot;
  el: HTMLButtonElement;
  chevron: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  goneAt: number;
}

export type ArmedOrder = "attackMove" | "follow" | "charge" | "bombard";

export type StrategySetting = "holdFire" | "skirmish" | "cycleCharge" | "shape";

// Left button is resolved on pointerup (it may become a drag-select); other buttons act on down.
export interface LeftPress {
  pointerId: number;
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  dragging: boolean;
}

// Right-button order in progress for a multi-unit selection (see computeLineFormationTargets).
export interface OrderPress {
  pointerId: number;
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  dragging: boolean;
  order: number;
  // Strategy mode: the regiment order a release sends (Shift at press = queue it).
  kind?: "move" | "attackMove";
  queue?: boolean;
}
