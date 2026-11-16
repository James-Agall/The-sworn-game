# Painted player parts

69 separately painted pieces, with 14 default aliases. Generated from the installed hero style reference using four transparent atlases.
The manifest stores each part's pivot and bone length. Hair neck pivots intentionally lie below the visible image.
Source atlas and complete prompts: `art-sources/character-creator-20261116/`. Never overwrite existing whole-character art.

Re-slice each source with its matching `scripts/rig-layouts/painted-*.json`, `--out client/public/rig/parts/painted-v1 --merge --bg none`.
These observed layouts include safe output margins and a 0.88 rim multiplier. Keep the manifest aliases and do not normalize per animation frame.
Runtime body height is 93 source pixels = 25 world pixels at the average build. Builds use .93 / 1 / 1.07 height, independent width adjustments.
Five horse coats reuse the four installed `animal-walks-c/horse-01..04.png` frames; animals themselves do not receive saddles or creator equipment.
