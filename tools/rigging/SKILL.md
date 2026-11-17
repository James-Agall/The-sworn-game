---
name: rigging
description: Build, tune and VERIFY 2D skeletal (paper-doll) character rigs for sprite games: parts on a shared skeleton, planted-foot walking, weapon attacks with anticipation and trails, riding, builds / genders / gear as swappable parts. Ships a runtime (rig-core.js) and a headless contact-sheet harness (sheet.mjs) so you can SEE every pose before showing the user.
triggers:
  - "rig"
  - "rigging"
  - "rigged"
  - "skeleton animation"
  - "paper doll"
  - "character creator animation"
  - "animate a character with parts"
---

# rigging

Use for any task that animates a character from separate parts (head, torso, limbs, weapon, shield, horse) on one
skeleton instead of hand-drawn frames: character creators, gear that must show on the body, riding, many bodies sharing
one animation set. Built for colony2d (`~/projects/colony2d`, plan: `~/docs/colony2d/PLAN-character-creator.md`) but the
runtime is generic.

## The rule that decides everything: author at SOURCE resolution
The game's people are ~98 px tall inside a 128 px frame and are shown at ~25 px on screen. A rig authored at 25 px
(1 px parts, rotated) looks like broken blocks, which is what the first prototype did. Author parts at the source scale
(thigh 17, shin 17, torso 31, upper arm 15, forearm 14, head ~28), render frames at that scale, and judge them with the
in-game-size inset that `Rig.sheet` draws next to every frame. If it only looks good enlarged, it is wrong.

## Files
- `rig-core.js`: the runtime. Math (angle convention), keyframes with easing, 2-bone IK, shaded outlined limb / shape /
  ellipse painters, part placement, planted-foot walk (`Rig.foot`), `Rig.sheet` (labelled contact sheet + in-game-size inset).
- `sheet.mjs`: `node ~/.claude/skills/rigging/sheet.mjs <page.html> '<spec json>' <out.png>` renders a sheet headlessly
  and prints page errors. The page must expose `window.__rig.sheet(spec)` (see the reference page below).
- `reference.md`: animation recipes (walk, strike timing, bow draw, riding), proportions, layer order, the pitfalls list, the
  art brief for commissioning real parts.
- Reference implementation: `~/projects/colony2d/client/public/rig/index.html` (a complete rig page: parts, attacks,
  mounted horse, UI, `__rig.sheet`). Copy its structure for a new rig; serve it with
  `python3 -m http.server <port> --directory ~/projects/colony2d/client/public` (the prototype lives at `/rig/index.html`).

## Workflow (do it in this order; the loop is the point)
1. Skeleton and units first: lengths, pivots, the angle convention (0 = down, + = forward, 180 = up). Copy `rig-core.js`
   next to the page (`<script src="rig-core.js">`); keep the skill copy canonical, re-copy after changes.
2. Parts (procedural placeholders are fine): limbs hang from their pivot, upright parts point up from theirs; every part
   outlined and shaded across its width so it reads as a form. Same parts for every gender / build / gear; only dimensions
   and colours change.
3. Pose function: joints from time `T` and a state (idle, walk, attack, mounted). Keyframe tables for attacks, `Rig.foot`
   plus IK for legs, FK for the weapon arm, IK for a hand that must hold something (second hand on a spear, bow hand).
4. Render a contact sheet and LOOK at it (`Read` the PNG). Poses to include every time: idle, walk x4 phases, each
   weapon's windup / strike / follow-through, mounted walk + attack, bow draw, slim / broad, male / female, with and
   without armour. Fix what you see, re-render. Do not hand the user a rig you have not viewed.
5. Only then give the user the live page and say what you checked and what you did not.

## Hard-won rules (details in reference.md)
- Looks bad? Check scale first, then contrast (tunic vs pants vs horse), then silhouette (can you read the weapon and the
  pose in a 25 px thumbnail?), then timing.
- Walk: planted feet via IK to a foot path, hip bobs down at contact, arms counter-swing. Sine-wave thigh angles skate.
- Attacks: anticipation (slow, opposite direction), fast strike (ease-in), hold 1-2 frames, slow recovery, lean and lunge
  with it, a swing trail on the strike frames. Without these it feels like a stiff puppet.
- Two-handed things (spear, bow): the off hand is IK to a grip point on the weapon, never separately keyframed.
- Never rotate 1 px art. Rotate at source resolution, then scale down; do not snap rotation to 15 degrees at source scale.
- Mounted: seat anchor on the horse, thighs fixed, the horse has its own planted-foot gait (diagonal 4-beat) and head nod.
- Layer order back to front: back hair, far leg, far arm, torso, shield, head, hair front, helm, near leg, near arm, weapon.
- Keep the rules the user set: bow cannot be used with a shield, all humans the same size except the player's build range
  (about +-8% height), gear limited to body armour, head armour, sword, axe, spear, shield, bow.
