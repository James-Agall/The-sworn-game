# Autumn art audit tools (2026-11-11)

Repairs the Codex autumn export (see SPRITES.md "Autumn art audit"). Inputs live outside git:
`art-sources/autumn-style-v1/colony2d-autumn-complete.zip` (atlases + catalog) and `pre-autumn-runtime.zip`
(original runtime art). Extract each into its own scratch folder; run Python with `-I` (Pillow, numpy, scipy,
scikit-image).

Order (each step writes into `client/public/sprites`, or a staging dir copied over it):
1. `reextract.py <complete-root> <reex>`: cells cut from each atlas by connected components instead of the fixed
   grid (no neighbour pieces, no grid cuts). Touching sprites are split at their narrowest neck (distance-map
   watershed); detached bits go to the nearest main sprite. Tile / wall sheets keep the grid. ~5 min.
2. `normalize.py <reex> autumn-style-v1/autumn-runtime-map.json <stage>`: Python port of `normalize-autumn.ps1` for
   actor / prop / icon / effect / furniture art (runtime paths + `autumn/frames` library). Actors: centred on their
   opaque-mass centroid, feet on y=126 of a 128 px canvas; sheets showing one person on several rows (tiers, tool /
   task directions, workers, heroes, bandits) use ONE scale per sheet. Applies the wrong-slot OVERRIDES, skips the
   RESTORE list (copy those from `pre-autumn-runtime.zip`), builds `campfire0-3`, writes
   `autumn-runtime-map.fixed.json` (the map actually installed). Copy `<stage>` over `client/public/sprites`.
3. `tiles_fix.py <complete-root> <sprites> autumn-runtime-map.fixed.json`: roads / cobble / moat / shore masks without
   the dark frame each cell had, mask 3 (N+E) rebuilt from mask 9 mirrored (the sheet drew N+W twice).
4. `floor_fix.py <sprites> autumn-runtime-map.fixed.json`: water / ripple / roof tiles de-framed, floors opaque,
   grassFloor2 colour-matched. NOT idempotent (crops 3 px each run): run once on fresh Codex tiles.

Checks: `audit.py` (edge / cut / size / set / seam flags), `stray.py` (detached fragments), `triplets.py` and
`cmpsheet.py` (contact sheets orig | codex | new), `scene.mts` (in-game screenshots on a private server; the page's
ws://localhost:8080 is routed to it, never to the live port).
