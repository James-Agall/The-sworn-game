# Forest collision and army routing — 25 November 2026

## Player-facing changes

- Trees collide at their trunks rather than their entire 32px placement cell. Sapling, normal and large tree radii are 3, 5 and 8px. Appearance, harvest yield and chopping requirements are unchanged.
- Smaller physical bases for fruit trees (5px), barrels (7), crates (9), lantern posts (3), crosses (4), campfires (7), ruin statues (8), rubble (10), rocks and iron ore (11), and town quest boards (7).
- Buildings, walls, fences, water, moats and gate rules retain structural collision. The hero retains the existing 10px half-width body.
- Army movement detects dense scenery or restricted lanes and changes the existing order group into a file. Each soldier follows the actual movement trail of the soldier ahead, with 17px spacing. Infantry and archers retain their existing separate order groups.
- Files remain active through that march and reform on the original destination slots. They do not automatically widen at the first clearing. Combat and new orders release the file immediately.
- Soldiers can stop at physically clear points inside tree cells. A bounded half-tile route planner handles shared forest routes and local joins; normal open-ground formations remain in use.
- Combat approaches follow pixel goals in compact scenery, avoiding repeated searches for an impassable tree-cell centre. Attack timing, damage, population and AI update rates are unchanged.

## Validation

- 10,011 direct collision/determinism checks passed: compact bases, swept movement, hero clearance, tree-size consistency, full structural barriers and diagonal corners. Existing fortification suites cover gates and wall decks.
- Twelve real mixed soldiers crossed a nine-tile-deep forest and a one-tile stone choke, then reached their final formation slots in 278 ticks (13.9 simulated seconds). Zero physical obstacle penetration. The test also checks cancellation, combat interruption and an individual stopping point inside a tree cell.
- Private in-game check: all sixteen soldiers (12 infantry, 4 archers) completed the forest/choke march and reformed; no browser warnings/errors. Screenshot: forest-preview.jpg.
- Server and client TypeScript checks passed. Final fixed-seed smoke, save/load and both new regression suites passed (4/4).
- Existing pathfinding differential, fortification, wall/gate, moat, army-order, formation, regiment, regiment-group, battle-discipline, hero-tool, hunger/road, animal, paddock and spell suites passed during the work. Final fixed-seed combat-line, gate/wall and ownership suites passed (3/3).
- The existing walls-regrow fixture still fails its lumberjack placement/resource/regrowth scenario; the frozen previous release reproduces those same failures. Random-world combat/gate fixtures also exposed intermittent unrelated layout/timing failures; the final controlled seed-42 runs passed. This is not a claim that every unseeded suite is stable.

## Performance comparison

Private seed-42, unprofiled server windows, same benchmark harness as release 3c95698:

| Case | Previous mean / p95 | This release mean / p95 |
| --- | --- | --- |
| 1,000 marching soldiers | 10.23 / 15.36ms | 10.52 / 15.61ms |
| 300 vs 300 combat | 6.93 / 13.67ms | 9.28 / 18.32ms |

March cost was approximately unchanged. Combat is somewhat more expensive with the new physical movement and changed contact patterns; the two fights also had different surviving mob counts, so the comparison is not an isolated planner microbenchmark. The final compact-target fix reduced tile searches to 96,393 visited nodes / 16.3ms total in that fight window, versus 4,033,568 / 495ms in the first collision implementation. Do not claim a universal performance improvement or 100fps.

## Other fixes and boundaries

- Bounds-check castle-ruin entrance/decorations: a random test seed exposed an existing off-map tile-registry crash.
- Isolate the ownership/siege fixture from randomly generated guardians before it spawns its own two probe mobs. Production ownership and raid-rank rules are unchanged.
- Placement tiles and world generation design are unchanged. This deliberately makes forests more permeable to soldiers and pursuing enemies as well as the hero.
- Half-tile routes are sparse and bounded (18,000 nodes for a shared march; 1,800 for local file joins). New join searches have a per-tick count/time allowance; combat update cadence is unchanged. An unreachable destination can still fail, and a closed gate remains a barrier.
- Existing point-body movement outside the new column retains its old body model; the shared file planner uses 7px unit clearance. No new art assets or tinting.

## Deployment

The local live game is unchanged until deployment is recorded in deployment.json. Deployment retains the previous frozen source, built client and shutdown saves under /home/james/colony2d-backups, then briefly restarts the existing local game. The receipt records the committed revision, source comparison, HTTP response and live WebSocket snapshot.
