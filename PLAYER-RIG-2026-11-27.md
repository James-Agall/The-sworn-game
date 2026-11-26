# Player rig fix (27 November 2026, branch `player-rig-fix`)

James: "His joints look fucked and he looks like he's been sewn together like a toddler." This round fixes the
APPLICATION of the existing painted parts (client/src/heroRig.ts); no new art, no asset file changed.

Important: the in-game player still uses the NPC hero sheets by default (commit 40b28c7). The rig is drawn when a
caller passes `allowRig` (contact sheets) or the page is opened with `?rig=1` (review in game: player, other players,
interiors, creator preview). Before this round `allowRig` was ignored whenever the NPC sheets had loaded, so
`scripts/character-rig-contact.mjs` silently rendered the NPC art; it now renders the rig.

## Diagnosis (measured on the baked frames, 256x192 canvas, ground at y 163)

| | before | after |
|---|---|---|
| height, sole to hair top | 91 px (bodyHeight 89) | 102 px (bodyHeight 101): still ~25 px in game |
| head (hair top to chin) / height | 18 px, 1/5.1 | 18 px, 1/5.7 (4.5 px in game instead of 5.1) |
| legs: hip joint above the sole | 38 px, 42% | 48 px, 47% (idle knees nearly straight; before they were bent into a crouch) |
| torso waist to neck / torso art | 29 / 31 px | 30 / 33 px |
| torso width (shoulders), male / female | 23 / 21 px | 25 / 22.5 px |
| arm bones (upper + fore, + fist) | 13 + 16 (+3) | 16 + 19 (+3): hands at mid-thigh, spear/bow reach |
| boots | painted length | 2 px longer toe |
| walk: stance samples grounded | 97.3% (worst 0.6 px), but the planted foot slid 16 px while the ground moved 24 px (feet skated 34%) | 100%, 0 px hover; planted foot travels 27.6 px = ground travel |
| shield | 1.15x, centred on the chest, covering the torso | 1.0x, strapped to the forearm in front of the chest |
| uncached bake | 0.4 ms / frame | 1.9 ms / frame (headless; cached frames unchanged) |

The Sprite Lab's 75% / 3.4 px hover figure is body.html's walk on the same bones; heroRig's own walk hovered
little but skated. Other defects seen at 4x and 1x before: an outline around every part (belt, hips, knees, shoulders,
neck) so the body read as stitched; the head drawn behind the torso, floating on a dark collar line; the far arm
swinging 15 degrees backwards out of the back (a "backpack" lump); the weapon drawn over the fist; the spear's free hand
hanging; the shield IK pushing the elbow out of the back; crouched idle and attack legs; no step into attacks.

## What changed (commits on player-rig-fix)

1. `2eb1679` `allowRig` forces the rig, `?rig=1` review switch; contact script renders the rig again.
2. `97c53f5` Proportions: limbs, torso and boots are lengthened ALONG THEIR SHAFT at load (`LENGTHEN`: rows of the
   PNG between the joint caps are stretched, so caps, fists, collars and toes keep their painted pixels); skeleton
   constants `THIGH 20, SHIN 19, HIP 48, UPPER 16, LOWER 19`; torso width 25 / 22.5 px; bodyHeight 101 so the in-game
   height stays 25 px; horses scale by 101/89 so they keep their in-game size; hand-space attack paths scale with the
   arm length (`ARM_K`). The head and gear art are not resampled.
3. `37af10f` One outline: body parts (torso, pelvis, arms, legs, boots; the head's neck rows) are drawn with their rim
   repainted from the neighbouring fill (`rimless`), a layer-id map of the frame gives the outline afterwards (`compose`):
   rim colour against air or gear, a soft seam (45% toward the rim in the part's own shade) where one body part
   overlaps another, nothing where two parts are one form (`JOINS`: hips, knees, elbows, belt, shoulder within 7 px,
   neck within 4 px). Head, hair, helm, weapons, shield and horse keep their painted outlines.
4. `17d109c` Joints: head after the torso and 1 px lower (chin over the collar), torso hem over both thigh tops,
   weapon between the upper arm and the forearm (the fist closes over the grip), spear free hand IK to the shaft,
   shield arm FK (upper arm at the ribs, forearm forward) with the shield strapped at the forearm, the arm behind the
   body hung 4 px further forward and resting at 4 degrees.
5. `aaaa504` Motion: walk with heel strike / flat / heel-off rolling about heel and toe, 7 px swing lift, the pelvis
   dropping just enough for both planted feet to reach, hips +-1.2 px and counter-rotating shoulders, arm counter-swing;
   idle breathing and weight shift; attacks with a per-weapon step of the front foot (`FOOTWORK`), planted rear foot,
   hip lunge back/forward and dip; spear thrust at chest height; hurt recoil of the hips. Phase quantisation
   (36 / 32 / 12) and cache keys unchanged.
6. `595b852` Bake speed: id silhouettes cached per part and slot, `willReadFrequently` canvases.
7. (this commit) `scripts/player-rig-sheets.mjs`, MANUAL-TESTS.md section, this note.

## Regenerating the sheets

```
(cd client && npx vite --port 31940 --strictPort --host 127.0.0.1) &      # private port, kill by PID afterwards
PW_MODULE_FROM=<package.json with playwright> PW_CHROME=<chromium> node scripts/player-rig-sheets.mjs <out> 31940
```
Writes `w-<weapon>[-shield].png` (idle, hurt, mounted, walk x8, attack x8), `variants.png` (armour 0-3, builds,
genders), `all-1x-ingame.png` / `variants-2x-ingame.png` (true in-game size), `joints-zoom.png`, `motion-zoom.png`
and `metrics.json` (idle top/bottom row, lowest row per walk phase). For a before/after pair, run it once on a
worktree of the older commit (its own Vite on another port). `scripts/character-rig-contact.mjs` (the older,
larger matrix) works too.

## Remaining flaws (honest)

- Painted art limits: the T1 leather torso has a dark far-shoulder patch painted on its back that still reads a bit
  like a pack; the knee is a straight overlap of two tubes (no bending mesh), visible at strong knee bends; the head is
  still a little large for a "heroic" 1/6 because the head art is not resampled (1/5.7 now).
- Attacks still bend the knees noticeably (a lunge stance with 1.2-2 px dip); the spear windup bunches the free arm
  behind the head; the bow has no step.
- Weapons and the shield are the same art pixels on a taller body, so in game they are ~11% smaller than before.
- The soft seams are a fixed 45% darkening; on light tunics they can look slightly heavy, on dark armour faint.
- An uncached frame bakes ~4.5x slower than before (1.9 ms, once per pose/gear combination; 384-frame LRU cache).
- `client/public/rig/body.html` and `rig-core.js` were NOT changed (the Sprite Lab's golden test compares against
  them): they are now stale relative to the game's runtime rig (old proportions, per-part outlines, old walk).
- Front/back views do not exist; only the side view.

## Next steps

1. Move heroRig's hard-coded motion onto clips (Sprite Lab README, "How the game will use clips"): skeleton JSON,
   `sampleClip` / `solvePose`, one clip per HeroPose state, golden sheets before/after with the script above. Carry
   over this round's extras as skeleton rules: LENGTHEN, the outline pass and JOINS, FOOTWORK, the walk's planted
   heel-toe solver and pelvis drop.
2. New clips (SPEC-sprite-lab section 6): guard (shield up), sidestep dodge, heavy swing with hold, perfect-block
   counter, directional hit reaction; work (chop, mine, hammer, till, water, carry); rest (sit, sleep); death.
3. Then front/back views; and decide whether the rig replaces the NPC sheets as the default player art.
