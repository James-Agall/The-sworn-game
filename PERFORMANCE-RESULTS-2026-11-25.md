# Performance implementation results

25 November 2026

The behaviour-preserving performance pass is implemented. The measured 1000-soldier marching server tick fell from 26.71 ms to 11.06 ms on average (about 59% less work). Its slowest 5% fell from 66–77 ms to 16–18 ms, below the initial 25 ms server target. This does not mean the renderer runs at 100 fps.

## Changes

- Pathfinding keeps breadth-first search, east/west/south/north ties and the existing 60,000-node budget. Searches reuse typed queues, parent indices and generation-stamped visitation buffers. Cache dependencies are collected while visiting, including adjacent chunk boundaries. Nested custom-blocker searches use separate workspace slots. Cached routes own their data. The rampart helper no longer creates a function per step, and reconstruction appends/reverses instead of repeatedly inserting at the front.
- Static walkability and room-relevance tables replace repeated predicates. Dynamic gates, hostile/friendly movement, ladders, decks and unfinished fortification parts retain their checks.
- Housing adjacency and pasture enclosure geometry are cached until their inputs change. Clan changes and bulk world resets invalidate them. Actual population, jobs, gate state, combat decisions and needs continue to update at the same cadence. Guard post lookup reuses a still-valid slot, and settlement statistics reuse local center indexes.
- Snapshot construction avoids intermediate arrays and duplicate hauling, raid forecast, carried-weight and family calculations. No message frequency or resource/combat rules changed.
- Regional generation reuses protected-ground and road masks and avoids repeating validation for already-checked scatter cells. Random-number consumption and placement order are unchanged. Tile writes still update all registry/version/room bookkeeping; no unsafe bulk bypass was introduced.
- Streamed artwork yields in small batches under a nominal 2 ms frame budget. Live edits supersede queued snapshots; active work reads live tiles. A chunk becomes ready only after its artwork completes. Duplicate requests and old-world jobs are suppressed. Floor texture construction also checks elapsed time between textures. A single graphics/texture operation cannot be preempted, so this is not a hard 2 ms guarantee.
- Sprite bounds avoid temporary corner arrays; outline queries reuse collection storage and keep only the nearest four covers in stable depth order. A hero's shadow pose is looked up once per update. Unchanged HUD labels, vital-meter attributes, widths and cooldown text are left alone.
- `?perf=1` now reports p50/p95/p99 frame intervals, ticker CPU time, draw time, asynchronous GPU timings where supported, complete snapshot application time, phase timings and chunk queue length. Diagnostics stay dormant normally. GPU results are read only after availability, without a synchronous readback. Server test timing reports include p50/p99 and path work/cache counters.

## Server measurements

Private servers, temporary saves, seed 42, normal 20 Hz simulation, unprofiled 6.5-second windows. The 1000-unit case was repeated three times; the other cases once. Actual entity positions evolve during each live run, so this is not an identical-tick replay. Results are diagnostic rather than a universal hardware guarantee.

| Scenario | Before average | After average | Before p95 range | After p95 range |
|---|---:|---:|---:|---:|
| town-1024 | 4.29 ms | 3.75 ms | 13.2–13.2 ms | 7.2–7.2 ms |
| march-300 | 5.81 ms | 4.96 ms | 9.4–9.4 ms | 8.5–8.5 ms |
| march-1000 | 26.71 ms | 11.06 ms | 66.3–77.4 ms | 15.8–18.0 ms |
| battle-300 | 10.87 ms | 8.40 ms | 15.4–15.4 ms | 13.1–13.1 ms |

The worst observed 1000-unit marching tick fell from 120.2 ms to 22.6 ms. Mean process RSS across those runs fell from about 181 MB to 150 MB; the reusable search buffers are bounded by world size and nesting depth. Keep observing memory in long sessions.

The isolated 256-square path benchmark measured a long uncached route at 1.83 ms versus 41.29 ms in the original audit, and an unreachable goal at 3.79 ms versus 65.26 ms. Warm routes remain around 0.01 ms. Both path runs used CPU profiling; do not use tiny warm-cache differences as evidence of an improvement.

## Generation identity and timing

Seed 7 and seed 42 at 160, 512 and 1024 square sizes produced identical terrain hashes, biome hashes, ownership, settlement layouts/counts, colonist positions/kinds, monsters and wildlife positions/kinds. Random UUIDs were excluded from identity comparisons.

Three alternating baseline/current runs at 1024 square, seed 42 averaged 1.411 s before and 1.237 s after, a reduction of 12.3%. These world-build timings exclude initial module compilation/import and client asset loading. The earlier concurrent-compiler timings were noisy and are retained in the raw receipts, rather than presented as an improvement.

## Browser checks and the 100 fps target

The private built preview loaded a solo world, switched to a wider town view, completed its chunk queue and produced no console errors/warnings in the checks. Warm wider-view ticker CPU work measured about 3.75 ms average / 5.10 ms p95, and GPU work about 1.30 ms. There were no tasks over 50 ms in the sampled warm ten-second window.

A stress placement requested 1000 soldiers and successfully spawned 841 (solid/occupied terrain rejected the others). With 867 total rendered unit records, the crowded view measured about 8.53 ms average / 13.70 ms p95 ticker CPU, 7.35 ms draw and 1.63 ms GPU. This is a stress view, not a normal generated settlement. Its private server averaged 7.48 ms / 11.42 ms p95 in that sample. The screenshot is `crowd-preview.jpg`.

The preview continues to display 60 fps / 16.7 ms because of browser/display pacing. **100 fps has not been achieved or verified.** Crowded drawing still exceeds the 10 ms target on some frames. Ticker CPU excludes message processing outside the ticker, which is why the separate snapshot-application measurement was added before release. Next measured work should focus on unit draw/transform/instruction cost, snapshot application and cold graphics preparation, then repeat on a verified high-refresh display path. Actor-root/renderer restructuring is conditional on that profiling; no speculative rewrite or art-quality reduction was shipped.

## Validation

- 66,996 transition/path/cache comparisons against the original logic, including randomized obstacles, gates, hostile/friendly movers, blocked destinations, map edits, invalid goals, nested searches and returned-route ownership.
- 200 housing-layout/clan edits, original callback ordering, warm-cache reuse and bulk-reset checks.
- Rendering tests cover front/back depth, flipped/rotated bounds, viewport re-entry, chunk-edge art, active job cancellation, newer live edits and time-budget resumption.
- Both client and server type checks pass; the built private preview passes.
- Twenty distinct affected native suites pass: animals, clans, fortifications, gates-walls, loading-progress, paddocks, performance-path, save-load, snapshot-delta, synergies, render-depth, character-sheet, hero-tools, player-workstations, settlement-pop, formation, moats, owner-map, rooms and smoke.
- The legacy `streaming-world` suite passes its four save/regeneration/old-save/chunk checks. Its three siege/chronicle checks fail because the modern generated world has no legacy overworld bandit-camp entity. The untouched baseline reproduces the same three failures; `baseline-streaming-test.log` records that comparison. No siege or encounter mechanics were changed to satisfy that outdated fixture.

## Deployment and rollback

The deployment receipt records the code revision, backup location, source-snapshot equality and HTTP/WebSocket checks after release. The frozen live snapshot and shutdown saves are backed up before replacement. The current 20 Hz simulation, AI reaction cadence, combat, population/spawn rules, movement choices, collision, resource yields, quest rules and world version remain unchanged.

Raw runs, CPU profiles, generation fingerprints, screenshots, baseline failure evidence and `results-summary.json` live beside this report in `outputs/performance-implementation` in the Codex workspace.
