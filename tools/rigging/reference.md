# rigging reference

## Angle convention (rig-core.js)
0 = straight down, positive toward the way the character faces (+x), 90 = forward horizontal, 180 = up, 270 = backward.
`Rig.dir(a)` = (sin a, cos a) in canvas coordinates (y down). Limb parts hang down and are drawn rotated by `-a`; upright
parts (torso, head) point up and are drawn rotated by `+tilt` (forward lean). Draw everything facing right and mirror the
whole character for left with `Rig.facing`.

## Proportions used by colony2d (source px, ~98 tall in a 128 px frame)
thigh 17, shin 17 (legs 34), torso 31, neck 4, head ~28 (chibi: the game's people are ~3.5 heads tall), upper arm 15,
forearm 14 (+ hand 3). Limb widths: thigh 13 -> 10.5, shin 10.5 -> 8, upper arm 11 -> 9.5, forearm 9.5 -> 8.5. Build scales
width (slim 0.86, average 1, broad 1.22) and total height (0.93, 1, 1.07: the decided +-8%). Female: torso 0.86 wide,
smaller jaw, lashes. Horse: withers ~86 px above ground (a person's head is above the horse's back when mounted).
Weapon lengths: sword ~70, axe haft ~70, spear ~100 (pivot 1/3 from the butt), bow ~90 tall, shield radius ~21.

## Walk cycle (what the prototype uses)
Cycle ~1.15 per second. Each leg has phase p and p + 0.5. `Rig.foot(phase, stride 34, lift 11, duty 0.55)`:
stance (55 %) the foot slides back at ground speed on y = ground, swing lifts and carries forward. Hip height =
ground - legLength * 0.95 + 3 * |cos(2 pi p)| (down at contact, up at passing). Feet targets go through `Rig.ik2(hip, foot, thigh, shin, +1)`
(knee forward). Far-side arm swings with the near leg, 20-25 degrees; the weapon arm swings 4 degrees only (it holds a weapon).
Torso leans ~3 degrees forward. Feet should not slide against the ground: if they do, the stride length or cycle speed
is wrong for the movement speed the game uses (check the game's px/s).

## Attack recipe (all weapons)
Normalised time u 0..1. Keys: rest -> anticipation (u 0.25-0.4, the arm goes AWAY from the target, torso leans back 7-12 degrees,
ease-out, so it settles slowly) -> hold 2 frames -> strike (u ~0.55-0.62, ease-in cubic, torso leans forward 10-15, hips
lunge 7-9 px) -> follow-through -> recovery (slow ease). Sword 0.55-0.65 s, axe 0.75-0.85 s (heavier: bigger windup, later
strike), spear 0.6 s (pull back with the elbow, extend straight, torso forward), bow 1.1-1.2 s (draw over 0.2-0.55, hold,
release at 0.74, arrow flies ~120 px and fades; the string follows the pulling hand). Weapon angle is keyed as an ABSOLUTE
angle (`wa`), the forearm as shoulder angle `ua` and elbow bend `fe`; compute the wrist from them. Swing trail: re-evaluate
the pose at u - 0.018 * i (i = 1..7) and draw the tip path as fading round-capped lines, only while the strike is fast.

## Riding
Horse: body centre fixed, hip joints at the rump and shoulder, planted-foot gait with a 4-beat offset (hind near 0, fore near
0.25, hind far 0.5, fore far 0.75), forelegs knee +1 and hind hocks -1 in `ik2`, head nods at twice the stride rate, body bob
~2 px at twice the stride rate, tail swings. Rider: hips at the saddle anchor, thighs ~70-74 degrees forward, shins ~4 degrees
back of vertical, torso upright and bobbing with the horse. Arms, weapon, attacks are the SAME code as on foot. Dismounted
and mounted bodies must use the same body parts so equipment never has to be redrawn.

## Pitfalls seen in practice
- Authoring at the on-screen size (25 px): everything looks like noise. Use source scale (see SKILL.md).
- Tunic, trousers and horse in similar browns: nothing reads. Pick distinct values and check the 25 px thumbnail.
- Helmets that cover the eye / face: keep the face readable; a tier-3 helm with a crest still shows the eye.
- Angles that look right in your head but are mirrored: always render and look. Weapon "pointing down at the start" almost always
  means the part's draw direction is not the convention (parts must extend along +y from the grip).
- A tail / mane angle of 200 means "up" in this convention (180 = up). Tail hanging down-back is about -20.
- IK joint on the wrong side: the sign of `bend` (human knee +1, elbow -1, horse fore knee +1, hind hock -1).
- Spear / bow off hand keyframed separately drifts off the weapon: always IK it to a grip point.
- Gaps at joints: parts must overlap at the pivot (limbs are capsules, so rotation never opens a gap); do not use rectangles.
- Judging in motion only: freeze at specific times (`t`) and read the sheet; motion problems show up as bad keyposes.

## Art brief for commissioning real parts (ChatGPT / artist), derived from the rig
One consistent style, transparent PNG per part, drawn at source scale facing right, 2 px dark outline, light from the top left,
a 3-tone shade. Each part is drawn straight (limbs hanging down, torso and head upright, weapons pointing down from the grip)
with its pivot named in a sidecar JSON (pixel x, y). Parts: head (per face, with ear and neck stub), hair front / back per style
(grey scale, tinted at runtime), torso per gender, upper arm, forearm + hand, thigh, shin, foot, body armour torso + sleeves
per tier (3), helm per tier (3), sword / axe / spear / bow / shield per tier, arrow, horse (body, neck, head, 2 leg segments,
tail), saddle. Skin and hair colour are runtime tints, so one body set serves every skin tone. A validator should overlay
each part on the skeleton and flag any whose pivot / outline breaks the contact points.

## Verification checklist before telling the user it is ready
[ ] sheet viewed: idle, walk x4, sword / axe / spear windup + strike + follow, bow draw + release, mounted walk + attack
[ ] male + female, slim + broad, no armour + tier 3, helm on + off
[ ] 25 px in-game inset readable: you can tell the weapon, the facing and the action
[ ] no page errors printed by sheet.mjs; bow + shield refused
[ ] told the user what was NOT checked (real-time smoothness in a browser, art quality of placeholders)

## Parts as files (manifest workflow), learned in the limb loops
- Parts live as PNGs plus a `manifest.json` ({ parts: { name: { file, pivot:[x,y], len } }, soleBelowAnkle }); the rig page reads it, so real art
  replaces placeholders by file name with no code change. Placeholder generator: `~/projects/colony2d/scripts/make-placeholder-rig-parts.mjs`
  (sprite-making painter). The page needs HTTP (fetch of the manifest), not file://: serve `client/public` with `python3 -m http.server`.
- Bone lengths MUST add up to the source body: this art's legs are ~31 px hip to ground, so thigh 14 + shin 10 + 7 below the ankle. Long legs
  (16 + 16 + 7.5) made the idle crouch because the hip cannot be 39 px above a 31 px floor. Check `thigh + shin + sole = hip height`.
- The FOOT is its own part with an ankle pivot so the sole stays flat while planted (tilt only in the swing); a foot baked into the shin tilts with it.
- No knee / elbow "balls": continue the trouser / sleeve across the joint and put the boot shaft / bracer below it; a differently coloured cap reads as a ball.
- Joint caps must be larger than the limb so a swing never opens a gap; the torso needs its arm sockets removed (erase the old sleeve) and the limb's
  shoulder cap covers the hole.
- Far-side limbs are the near parts darkened 0.78 at load, not separate art.

## Slicing generated part sheets (colony2d)
`node scripts/slice-rig-sheet.mjs <sheet.png> scripts/rig-layouts/sheet-10X-*.json --out client/public/rig/parts/<set> [--merge]` cuts a ChatGPT sheet
(SPRITES.md #106-#109) into parts + manifest.json + slice-report.json + slice-preview.png. Pivots come from the cell anchors the brief asks for (limbs also
cross-checked with the joint cap); background removal, speck removal and rescaling are automatic. Tested by `node scripts/test-slice-rig-sheet.mjs`
(round trip + a messy sheet). Always look at slice-preview.png and anything marked CHECK before trusting a set; then `rig/body.html?parts=<set>`.
