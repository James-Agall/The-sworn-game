# Roads across marsh water — 26 November 2026

Branch `road-causeway-fix` (off `c470a01`). Worldgen version 22 -> 23. New worlds only; version 22 worlds (and their
base caches) are generated exactly as before.

## What the player saw

Roads "sitting on water": a plain dirt `Road` tile (TileType 60; `CobbleRoad` 61 in principle) with water on both sides,
making a bare strip across a pond with no bridge art. A tile is never Road and Water at once. These were dirt
causeways.

Measured on version 22 (6 seeds 1, 7, 13, 42, 99, 2024). "Causeway" = Road / CobbleRoad tile with Water on two opposite
sides; "3+" = Road with Water on 3 or 4 sides.

| Size | Causeway tiles per world | 3+ water | Road tiles |
| --- | --- | --- | --- |
| 160 | 16 - 56 | 0 - 1 | ~1,200 |
| 512 | 279 - 524 | 0 - 4 | ~17,500 |
| 1024 | 1,610 - 1,862 (seed 42: 1,808) | 1 - 6 | ~71,000 |

## Root cause

`server/src/regionWorld.ts`, `generateRegionWorld`:

1. The regional road network is planned first (`road()` marks `roadTiles` / `roads`).
2. The per-region fill skips planned road tiles (`if(protectedTiles[i]||roadTiles[i])continue;`). For a marsh region
   (version >= 20) every other tile becomes `marshTile(...)`, which is Water inside the region's pond ellipses.
3. The final road loop turns a road tile that is Water into a `RiverBridge` (172) and anything else into `Road`. The
   planned road tiles inside a pond were never made Water (step 2 skipped them), so they became Road: a dirt causeway
   through the pond. Traced examples (seed 42, 1024): (102,14), (398,137), (187,306) go Empty -> Road in the final loop
   after their neighbours were set to Water by the marsh fill.

Two smaller leftovers:

- A region centre (local 16,16) of some marsh variants is a dry speck between two pond ellipses. With the fix the
  road either side of it is a bridge, so that speck would still be one Road tile with water on both sides.
- The few `RiverBridge` tiles on version 22 with no Water neighbour and no bridge neighbour over water (3-7 per 1024
  world, 0-2 per 512 world): a city gate connector (`road()` calls after the fill, `regionWorld.ts` "All exterior gates
  reach the centre...") runs straight through a marsh pond next to the region's own winding road. The connector tiles were
  filled with Water and bridged; the winding road beside them was left as dry Road (the main bug), so those bridge
  tiles had Road on one side and marsh ground on the other. With the fix the winding road is bridged too, giving a
  two-lane bridge.

## The fix (version 23 only)

1. Marsh fill (`regionWorld.ts`, fill loop): a planned road tile in a marsh region whose position is wet by
   `marshTile`'s pond test becomes Water (biome Swamp), so the existing final rule lays a `RiverBridge` there. The wet
   test does not use the roll, so no `Math.random` draw is added or moved. Planned road tiles next to protected ground
   (start circle, Abbey / Castle Ruin grounds) stay dry: those grounds are never flooded, so a bridge there would cross
   dry land.
2. Post-pass after the final road loop: an open-country Road tile laid by that loop (not inside a city footprint,
   not on landmark grounds, not owned, not the Town Center) with Water on opposite sides or on 3-4 sides becomes a
   `RiverBridge`. This catches the dry specks between ponds (0-3 tiles per 160 world, 2-10 per 512, 6-21 per 1024).
3. `WORLDGEN_VERSION = 23` (`worldbase.ts`), and the defaults of `generateWorld` / `generateRegionWorld` move to 23.

Why this design: the pond-under-the-road approach makes every crossing a continuous bridge from shore to shore (the
existing Water -> RiverBridge rule does the work, so roads stay connected and keep every tile), while the post-pass is a
narrow safety net. Neither step can touch town streets (city interiors are skipped by the final loop), gates, landmark
grounds or buildings (owned tiles and non-Empty/Tree/Rock/Ore/Water tiles are never restamped). A post-pass only
(no fill change) would leave road corners and edge tiles as dirt sticking into the pond.

Client (`client/src/main.ts`, `riverBridgeDeck`): the deck sprite was east-west whenever a road joined from either side.
The two-lane bridges above then drew their touching tiles as a block of east-west planks inside two north-south bridges.
The deck now follows the axis with more road / bridge neighbours; a tie keeps the old rule, so river bridges and
straight crossings look the same as before.

## Invariants and counts after (version 23)

From `npm test -- road-water` (6 seeds x 160 / 512 / 1024, version 22 vs 23 in matching runs):

- Road / CobbleRoad with Water on opposite sides: **0** everywhere (was 16-1,862 per world).
- Road with Water on 3-4 sides: **0** everywhere (was 0-6).
- RiverBridge without a Water neighbour: 0 at 160, 0-7 per 512 world, 9-21 per 1024 world. Each one is the second
  lane of a two-lane bridge, next to a bridge tile that does span water. Bridges with no water and no such neighbour:
  **0** (version 22: up to 7 per world).
- Road + bridge tile total: identical to version 22 for every seed and size (e.g. 1024 / 42: 72,049 both; bridges 320 ->
  3,764). Road network pieces and the size of the largest piece: identical. Settlements touching the main network:
  18/18 (512) and 73/73 (1024) before and after; start Town Center present and on the network in every world.
- World audit (`auditWorld`) 0 problems and tile-registry audit 0 mismatches in every generated world.
- Version 22 unchanged: FNV hash of tiles + biomes for the 18 worlds (6 seeds x 3 sizes) identical before and after
  the change (e.g. 1024 / 42 `6b35d6ba`, 512 / 42 `6e74e542`, 160 / 42 `45105bdc` in a 6-seed run).

## Files

- `server/src/regionWorld.ts` — fill rule and post-pass (version 23), default version 23.
- `server/src/worldbase.ts` — `WORLDGEN_VERSION = 23`.
- `server/src/worldgen.ts` — `generateWorld` default version 23.
- `client/src/main.ts` — `riverBridgeDeck` orientation.
- `server/road-water-test.mjs` + `server/road-water-regression.mts` — the invariant / comparison test.

## Tests

- `npm test -- road-water` PASS (18 s).
- `npx tsc --noEmit -p shared`, `-p server`, `-p client` pass.
- Region generation suites (`node_modules/.bin/tsx server/<name>-test.ts`, `COLONY_TEST_HOOKS=1`, scratch save dir):
  `regions`, `underground`, `cave-detail`, `hostile-scatter`, `town-life`, `organic-towns`, `compact-towns`, `ruin-rooms`
  PASS; `regions20` PASS at 512 and 1024; `regions22` PASS at 512 and 1024. At the default 160 size `regions20/21/22`
  fail, and `regions21` fails at 512 / 1024 ("hero attack hits inside"); all four failures happen the same way on
  `c470a01`.
- `npm test -- interior-refresh save-load` PASS; `COLONY_WORLD_SEED=13 npm test -- streaming-world`: the 3 known
  strife / chronicle failures, identical on `c470a01`; `npm run smoke` 35/35.

## Screenshots (headless Chromium, seed 42, 1024 world)

Saved in `/tmp/claude-1000/-home-james/e750a2dc-86fa-43ba-992d-dfa7a0e3a701/scratchpad/rw/shots/`:

- `before-causeway0.png`, `before-causeway1.png` (old code): a straight dirt strip through open pond water with water on
  both sides; it jogs at the bottom.
- `after2-causeway0.png`, `after2-causeway1.png`, same spots on this branch: a continuous north-south plank bridge
  from the marsh shore across the pond; at the jog in `after2-causeway1.png` the two corner tiles are east-west decks.
- `after2-longH.png`: a 3-tile east-west river bridge, unchanged.
- `after2-corner.png`, `after2-corner2.png`: a winding marsh road as a stair-stepping bridge. At each turn the
  corner tile shows an east-west deck (railings top and bottom), the straight tiles north-south decks.
- `after-wide.png` (old orientation rule) vs `after2-wide.png` (new): a two-lane bridge where a city gate connector
  runs beside the winding road. Before, the touching tiles were a block of east-west planks; now the straight lane
  is one continuous north-south deck.

## Open problems

- Corners: only `bridge-h` / `bridge-v` exist, so a road turning on a bridge draws a straight deck whose railing
  crosses the turn. A corner deck sprite would fix it.
- Two-lane bridges: where a city gate connector runs beside a winding marsh road, both are bridged side by side
  (9-21 such dry second-lane tiles per 1024 world). This is acceptable, but a single lane would be tidier (would
  need route merging in the connector code).
- Unrelated, pre-existing: generating several worlds in one process is order-dependent (for example, seed 7 v22 at 160 alone
  hashes `daa2e52b`, after seed 1 `285e60ac`), so some state is not reset between generations. A New Game in a running
  server may then not match a fresh boot with the same seed.
