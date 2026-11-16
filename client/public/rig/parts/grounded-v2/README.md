# Grounded character rig v2

Transparent generated artwork following the user's simple knight / medieval caravan references, 2026-11-16.
79 unique pieces: 30 body parts, 29 heads/hair/gear, 20 horse frames. 14 manifest aliases; 93 entries total.
Plain cloth, leather and iron/steel; no gilding. Smaller heads and longer-legged adult horses.
The body atlas was corrected to cover elbow/knee caps with the appropriate clothing instead of bare joint circles.

Source archive: art-sources/character-restyle-20261116/{body-parts,heads-gear,horse-walks}.png.
Layouts and exact prompts: scripts/rig-layouts/grounded-*.json. Example intake:
`node scripts/slice-rig-sheet.mjs art-sources/character-restyle-20261116/body-parts.png scripts/rig-layouts/grounded-body-parts.json --out client/public/rig/parts/grounded-v2 --bg none --merge`
Repeat with heads-gear and horse-walks. Manifest bodyHeight=89, soleBelowAnkle=10.
Runtime: heroRig.ts draws these parts on the shared skeleton and scales to the existing 25 px human height.
Torso/weapon widths are fitted in the renderer; horse pivots attach the rider to the saddle across frames.
The palomino source row approaches its bottom cell edge; the sliced hoof silhouettes were inspected and receive transparent padding.
