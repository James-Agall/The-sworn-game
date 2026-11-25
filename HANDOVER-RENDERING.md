# Rendering depth and performance — 25 November 2026

## Changes

- Characters previously lived above the whole scenery layer. Units, their attached effects/labels and animals now share depth ordering with trees, buildings and walls. Depth follows interpolated ground/feet positions; X only breaks ties. Mounted presentation retains its current art, and wall-deck occupants sort above the wall face.
- The local hero gets a dark silhouette with a narrow neutral contour when behind opaque scenery. It follows the exact current animation texture and scale. Actual scenery alpha clips the overlay, so leaf gaps remain open and original sprites are never tinted. Up to four overlapping occluders are supported. Outlines are generated once per pose and held in a bounded 64-texture cache; no custom per-frame outline shader remains.
- Scenery and decorative ground props use a spatial index. Objects outside the viewport apron are parked outside the stage, reducing transform traversal and depth sorting. Large art is indexed by its full bounds across bucket edges. Newly created/changed art is registered immediately; world resets clear the index.
- Each static 16x16 grass/biome floor is baked into one cached texture instead of keeping 256 floor sprites. The floor cache targets 64 textures (retaining more only if the current viewport needs them), with a small construction budget per frame. Refresh visits camera chunks and cached chunks, not all 4096 potential chunks in a 1024-square world. Owned GPU textures are unloaded/released on invalidation and eviction; shared atlas textures are retained.
- Roads, riverbanks and bridges extract atlas frame/trim directly from source images/canvases, avoiding synchronous GPU readbacks for normal terrain. GPU-only/rotated textures keep a cached fallback.
- Incoming stream chunks are applied one per frame. Live tile edits override older queued chunk data, duplicate replies retain order, and world resets discard pending data.
- Roof rebuilds are triggered by room-boundary changes, use the existing loaded tile index instead of scanning a million empty cells, and exclude NPC settlement walls from player-room roof searches. NPC buildings already use exterior roof art. Player modular roofs and their fade rules remain.
- Cosmetic town pets now use the same ground depth. Offstage animated tiles skip frame swaps; overworld terrain/camera work pauses indoors. The optional `?perf=1` overlay now counts active scenery/cache sizes and hero occluders.

## Measured comparison

An unchanged client from commit `c806420` and the modified client were tested sequentially in the same in-app browser, at Hesta's town in the seed-42 1024-square world. Baseline: 27.1 ms average frame time (~37 fps), 50 ms average snapshot gap. Modified: 16.7 ms (~60 fps), 50 ms average snapshot gap. Unit counts were 35 and 36 respectively. These are local steady-state observations, not a universal performance guarantee. Raw readouts and screenshots are in workspace `outputs/rendering`.

In the pine/house scene the renderer kept about 650 of 17,668 scenery objects active and held around 60 fps. Wide strategy views also settled at 60 fps. First-time loading/zoom can still incur asset/geometry construction work; the change reduces ongoing work and spreads chunk arrivals, rather than promising zero loading hitches.

## Validation

- `node client/render-depth-test.mjs`: front/back order, interpolated feet, X tie breaks, large art across chunk boundaries, offstage parking/re-entry, ground decor, reset, chunk arrival order/duplicate responses/live edits/reset cancellation.
- Client/server type checks and production build.
- Existing interior-refresh, scale-rider, strategy-view and tile-sprites-roundtrip regressions. The last suite's seed-42 fixture attempted to place KnightPost on reserved settlement ground and timed out; the full unchanged suite passed with seed 7.
- 35 core smoke checks.
- Browser: actual alpha-masked outline behind a pine and house, ordinary art in front with zero occluders, movement, zoom/strategy transitions, stream arrival, warm frame timings. Screenshots: behind-tree, front-tree, behind-house, front-house, movement-final, baseline-town, optimized-town.

## Integration notes

- `client/src/sceneDepth.ts` owns spatial scenery/ground depth/outline caching; `client/src/chunkInbox.ts` owns deferred chunk arrivals.
- Always use `setTileSprite`, the wrapper that registers fitted art. `fitTileSprite` retains existing art fitting. Keep all unit depth based on snapshot ground coordinates plus interpolation, not sprite-top coordinates or attack-weapon bounds.
- The outline is local-hero guidance. Other units are normally occluded by scenery; the change does not draw hundreds of x-ray silhouettes in crowded fights.
- Preview modes in `adventurePreview.ts` are only available through the existing `COLONY_TEST_HOOKS` gate. Keep that flag disabled live. The diagnostic shader/select UI used during development was removed.
- No world schema or save format changed, no new artwork was required, and no remote push was performed.
