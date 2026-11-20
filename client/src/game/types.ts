// Types that lived inside main()'s setup closure (client main.ts split).
import type { Texture, Sprite, Graphics } from "pixi.js";
import type { WILDLIFE } from "../worldVisuals";
import type { FightSnapshot } from "@colony/shared/protocol";

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

// All art is drawn facing right; flip horizontally (negate scale.x, since every sprite is
// center-anchored) when net horizontal movement is leftward. Tracked per entity id in one of
// three category maps (colonist/mob/player ids aren't guaranteed disjoint, so a single shared
// map risks one category's prune deleting another's live entry), independent of any animation
// state so it applies equally to animated and single-pose sprites. A small dead zone (the same
// >0.5px threshold used for walk-vs-idle elsewhere) avoids flicker from sub-pixel jitter while
// genuinely stationary; moving purely vertically keeps the last facing instead of snapping back
// to a default.
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

// ---- Ambient critters (see WILDLIFE) ----
// Frogs sit and hop around swamp and water edges; crows perch anywhere and flap off to a new perch. Each critter only ever targets a tile
// that's Empty right now, so it doesn't stroll into a building that already exists; one ticker
// moves all of them and one shared clock picks their animation frames.
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

// ---- Server wildlife (huntable game; see WILDLIFE_ART) ----
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

// ---- Economy panel (DOM): goods stockpile + Market / Gold Shop, left side ----
// The canvas HUD keeps the core numbers (wood/iron/rock/gold/pop/time); everything else lives here.

export type GoodKey =
  | "wood"
  | "iron"
  | "rock"
  | "gold"
  | "grain"
  | "meat"
  | "fruit"
  | "wool"
  | "cotton"
  | "clothes"
  | "tools"
  | "luxuryItems"
  | "alcohol";

// Mirrors the server's EXCHANGE_RATES / GOLD_SHOP_PRICES; the server re-validates every request.
export type BaseResource = "wood" | "iron" | "rock";

export type ShopItem = "tools" | "clothes" | "luxuryItems" | "wood" | "iron" | "rock";

// ---- Strategy mode phase 3: regiment orders (strategy/orders.ts draws them). Right-click = move as the
// formation stands (its last width / facing kept), right-drag = a line (width = drag length, facing away
// from the units or toward a nearby enemy, Alt flips), Ctrl+right-click or Shift+F then right-click =
// attack-move, right-click an enemy = attack, Shift+G then right-click a friend = follow, Shift+H hold,
// Shift+R retreat; Shift on any of these queues it. Shift+letter so every build hotkey stays as it is.
// Phase 4: Shift+C then right-click an enemy = charge, Shift+B then right-click = bombard that point;
// right-clicking a camp hearth = attackHearth. Settings: Shift+T hold fire, Shift+V skirmish, Alt+C cycle
// charge (toggles), Shift+Q cycles the shape.
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
