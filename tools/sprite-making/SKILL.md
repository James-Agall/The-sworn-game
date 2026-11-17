---
name: sprite-making
description: Make game sprite PIECES (helmets, armour, weapons, shields, props) that look like the existing art: harvest real pieces from the game's own frames, recolour (keeping shading), rotate / scale, composite onto frames, preview side by side at in-game size, validate. Code-painting only for small flats. Written for colony2d's painted style.
triggers:
  - "make a sprite"
  - "sprite piece"
  - "draw a sprite"
  - "create sprite art"
  - "equipment overlay"
  - "helmet sprite"
  - "armour overlay"
  - "build your own sprites"
---

# sprite-making

Lets you create sprite pieces yourself instead of waiting for generated art: harvest real pieces from the game's own art, recolour / rotate
them, compare with the real art, and drop them onto the game's existing frames. Node only (zlib built in), no packages, no browser.

## First fact: the game's art is PAINTED, not pixel art
Measured with `palette.mjs` on the hero, champion and militia frames: ~3,400 distinct colours per 1,000 pixels, smooth gradients,
soft anti-aliased edges (alpha ~254 body, partial alpha at the rim) and a near-black rim about 2 px thick
(`#191414` outermost, `#2a211e` next), then warm browns, light from the upper left. A person is ~98 px tall in a 128 px frame,
drawn at 25 px in the game. So: no small indexed palette, no hard 1 px outline, no dithering. Use gradients, rim and soft edges.
A piece that looks great zoomed but is pale at game size has too weak a rim or too little contrast.

## Files
- `png.mjs`: dependency-free PNG decode / encode (`readPNG`, `writePNG`).
- `harvest.mjs`, `recolor.mjs`, `transform.mjs`: lift real pieces out of existing art, change their material, rotate / scale / flip them (the CORE tools).
- `palette.mjs`: `node palette.mjs <png|dir>... [--out style.json]` measures a style: class (painted vs pixel art), rim colour by depth,
  clustered colours, light direction. Saved result for the hero art: `styles/colony2d-hero.json`.
- `paint.mjs`: the painter. `Canvas` draws at 4x supersampling; `shape(spec, material)` shades a mask from a rounded height map with a
  rim and mottling; `flat(spec, colour, alpha)` for highlights, seams, slits; `png()` box-filters down so edges come out soft.
  Shapes: poly, ellipse, capsule, rect (rounded), line, union, sub. Materials `M.metal / gold / leather / cloth / wood / skin / hair / paint`.
- `preview.mjs`: `node preview.mjs out.png --scale 6 ref.png:x,y,w,h mine.png ...` puts pieces beside real art, enlarged and at in-game size
  (x0.255 then x3). Read the PNG. Crop a region of a big frame with `file.png:x,y,w,h`.
- `validate.mjs`: `node validate.mjs piece.png [--size WxH] [--pivot-from piece.json]` checks solid body, soft edge, dark rim, colour
  richness, strays, sidecar pivot. Fails (exit 1) on a pale edge or flat fills.
- `compose.mjs`: `node compose.mjs out.png base.png piece.png@x,y ...` layers pieces onto an existing frame.
- `examples/helm.mjs`, `examples/sword.mjs` and `examples/out/`: two worked pieces and the image of the helmet on the hero next to the
  game's own champion, which is the quality bar reached so far.

## Core rule (learned the hard way): do NOT draw forms from nothing
Pieces painted from scratch in code (`paint.mjs`) came out as generic rounded blobs: a "helmet" with no real helmet features, a "sword" that
was a grey bar. Shape design needs references. So the skill works on a SOURCE LADDER; always take the highest rung that fits:
1. HARVEST a real piece from the game's own art (`harvest.mjs`): helmets (heroes/champion-*, heavy-soldiers-v4/knight-t1..3), swords
   (heroes/base-*), shields (champion), spears (infantry-v2/spearman, spear-pike-tiers), bows (infantry-v2/archer), axes
   (hero-tool-actions/axe-*), body armour (knight-t1..3 torsos). These already have the right shapes, details and style.
2. TRANSFORM it (`recolor.mjs` keeps the shading while changing the material: iron / steel / gold; `transform.mjs` rotates / scales / flips
   painted art with smooth resampling, which is fine because the art is painted; `compose.mjs --erase` removes what it replaces).
3. For things the game has no art for (a new hair style, a face, a gender body): get them GENERATED (ChatGPT, per SPRITES.md workflow)
   from a brief built off the nearest harvested piece, then run them through the same tools: scale to the 98 px person, match rim and
   colour (`palette.mjs` / `validate.mjs`), compose, preview. (Import and style-match tool for generated images is the next thing to build.)
4. Code-painting (`paint.mjs`) only for simple flats and additions to a harvested piece: highlights, seams, trim, glow, plain bars. Never
   for the main silhouette of a recognisable object.

## Workflow
1. Find the source: look at the frames (`grid` crops), pick the frame where the piece is clearest and least occluded.
2. `harvest.mjs src.png out.png --poly "x,y;..."` (outline it from a zoomed crop; `--erase` clears leftover pixels). It writes out.json
   with where the piece sat, so it can be put back exactly or offset for another body.
3. `recolor.mjs` for tiers / materials, `transform.mjs` to rotate / scale / flip.
4. `compose.mjs` onto the target frame (`--erase` first when the piece replaces something, e.g. the head under a helmet).
5. `preview.mjs` against the real equivalent (hero + harvested helm vs champion) and READ it. Judge the in-game-size row too.
6. `validate.mjs`, then show the user. Save into the game's sprite folder only when approved; never overwrite existing sprites.

## Proof (examples/out/)
`harvested-helm-tiers-on-hero.png`: the hero with the champion's real helmet in iron, steel and gold, beside the game's own champion. Worked
first try, recognisable helmets, in the game's style. Compare with `helm-on-hero-vs-reference.png`, the code-painted version, which does not read as a helmet.

## Known limits (say so to the user)
- A harvested piece is tied to the pose it was cut from. Helmets and shields barely change across frames, so one piece plus a per-frame
  offset works. Things that follow the arm (a sword in the hand, a bow draw) need per-frame cutting or transforming; body armour must
  match each frame's torso pose, so use the existing armoured frame rows (knight-t1..3) where they exist.
- Recolouring changes material, not form. Different shapes (a new helm type) need a new source or generated art.
- Pieces cut from a frame can carry slivers of neighbouring art; check the 8x crop and use `--erase`.
- Never claim a piece is good without the side-by-side at in-game size.

## For the colony2d character creator
Direction chosen 2026-11-16 after two rig prototypes failed to match the art: build the gear and look pieces ourselves in this style and
layer them onto the existing hero frames (per-frame overlays), not a skeleton rig. Order that proves it cheapest: helm (done as a
test), body armour overlay, sword, axe, spear, bow, shield, hair styles, then face and body variants. Plan: `~/docs/colony2d/PLAN-character-creator.md`.
