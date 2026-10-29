# colony2d

A 2D multiplayer Colony-Survival-like, built incrementally. A PixiJS client renders players as colored squares on a tile grid; an authoritative Node/ws server runs a tick-based game loop and broadcasts snapshots to every connected client.

## Quick start

```bash
npm install
npm run dev
```

This installs the npm workspaces (`shared`, `server`, `client`) and starts the server (ws://localhost:8080) and client (http://localhost:5173) together via `concurrently`.

Save files live in `server/saves/` (autosave each dawn and on server shutdown, plus 3 manual slots from in-game Settings); the main menu's Continue loads the autosave. See ROADMAP.md "Save files".

Open http://localhost:5173 in two separate browser windows or tabs to simulate two players. Move with WASD or the arrow keys. Use the toolbar at the bottom of the screen (an HTML overlay, or press 1-9 / h / b / c) to pick a tool: Wood Wall (1), Stone Wall (2), Lumberjack Post (3), Farm (4), Knight Post (5), Archer Post (6), Iron Mine (7), Rock Mine (8), Break (9), House (h), Barn (b), or Church (c). Every toolbar button shows its cost or placement condition next to its label, plus "upgradeable" for buildings that level up (e.g. "Knight Post (5) — 10 iron + 5 rock (upgradeable)", "Farm (4) — Free, needs adjacent Barn"). Right-click places the selected tool; left-click always breaks (see "Breaking" below for what each tile reverts to). Press Space to attack (see Combat below).

The world is 40x40 tiles, which no longer fits on screen at once, so the camera follows your own player: the world scrolls to keep you centered, while the HUD stays fixed in the top-left. Clicks are converted from screen to world coordinates through the camera offset, so placing/breaking works anywhere on the visible part of the map.

The HUD in the top-left shows the shared colony stockpiles (wood, food, iron, rock), the civilian population against the housing cap (`Pop: used/cap`), and whether it's currently day or night. The Town Center has its own HP bar drawn above it in the world.

The world renders as a checkered grass floor with a distinct procedurally drawn icon for each structure/resource (trees, ore, rock, walls, posts, farm plots, houses at each size, barns, churches, castles at each level, archer towers, the Town Center) instead of flat color tiles.

## Tests

```bash
npm test                    # every server/*-test.mjs and client/*-test.mjs, one at a time
npm test -- town hero       # only files whose name contains "town" or "hero"
npm test -- --timeout 300   # per-test timeout in seconds (default 900; a few long suites have more)
npm test -- --list          # print the files a filter selects
```

`scripts/run-tests.mjs` prints PASS/FAIL per file (with the first FAIL lines of a failing one) and a summary, and exits
non-zero if anything failed. Each test gets a private block of 10 ports from 31000 up (checked free first; never 8080, so
a running dev server is untouched). Tests that boot their own server get `PORT` / `PORT_A` / `PORT_B` / `PORT_C` in that
block; for the rest the runner boots a fresh server with `COLONY_TEST_HOOKS=1`, a scratch `COLONY_SAVE_DIR` and the world
size / `COLONY_INSTANT_BUILD` the test needs (the `SERVER_ENV` table in the script). After each file every process it
started is killed (process groups, then anything still listening on its ports). Full logs:
`/tmp/colony-test-logs/<file>.log`. The whole suite takes about an hour (several suites play through real-time days);
known failures are listed in ROADMAP.md "Known failing tests".

## Colony rules

- **Starting stockpile:** the colony starts with 80 wood, 40 grain, 60 iron, and 60 rock (raised for the bigger map, since the first resource nodes are a longer walk away), so several starter buildings can go up immediately without waiting on gathering.
- **Placement costs:** Wood Wall costs 1 wood per tile, Stone Wall costs 1 rock per tile, Archer Post costs 10 wood (same whether it becomes a plain post or an Archer Tower), Knight Post costs 10 iron + 5 rock (a castle costs both iron and stone — every placement, including ones that combine into a castle upgrade), House costs 10 wood (every placement, including ones that combine), Barn costs 15 wood, and Church costs 15 wood. Every placement costs the same whether it builds something new or upgrades an existing building (see Building upgrades). If the colony can't afford it, the server silently rejects the placement. Lumberjack Posts, Farm Plots and mines are free (but see their placement conditions below).
- **Walls:** Wood Wall and Stone Wall are plain solid tiles that block movement and pathing; they behave identically and differ only in cost and color — except that either one can be turned into an Archer Tower (see below).

### Houses and population

- **Population cap:** civilian colonists (lumberjack, farmer, iron miner, rock miner) and bishops count toward population, 1 each. Knights, archers and the militia line (militia/spearman/pikeman) are exempt and never need housing. The Town Center itself grants a flat +10 base population cap, so the colony can place several worker buildings before ever building a House; that +10 is lost if the Town Center is destroyed, and Houses still stack on top of it as usual.
- **Houses:** a House (10 wood) adds +1 to the cap. Placing a House next to (orthogonally adjacent to) an existing House combines the two into a single **Big House** (+3) on the existing House's tile — the newly-clicked tile stays Empty. Placing a House next to an existing Big House combines into a **Level 2 House** (+5), again on the existing tile. Level 2 is the top tier: a House placed next to a Level 2 House is just a new plain House. Every House placement costs a flat 10 wood, so a Level 2 House is 30 wood for 5 population versus 30 wood for 3 population as three separate Houses.
- **Gating:** placing a Lumberjack Post, Barn, Iron Mine, Rock Mine or Church is rejected while population is already at the cap — including a placement that would only upgrade an existing building (see Building upgrades). A queued civilian or bishop respawn (see Respawns) also waits while the colony is at the cap.
- Breaking any house tier (House, Big House, Level 2 House) reverts it straight to Empty — no refund, no partial de-leveling. Civilians already alive are not evicted if this drops the cap below the current population; new civilians just can't be added until there's room again.

### Production

- **Lumberjack Posts** spawn one lumberjack each that chops the nearest tree and carries **3 wood** back per trip (up from 1, which left lumberjacks far weaker than Barn-shared farmers). Each Lumberjack Post also grows trees: every 10s, it plants one new tree at a random Empty, unoccupied tile within 2 tiles of the post (a 5x5 box centered on it), never on a tile next to a player or any post — so the ring immediately touching the post stays clear and the trees appear 2 tiles out.
- **Trees regrow globally too:** independently of Lumberjack Posts, every 8s one new tree grows at a random empty tile anywhere on the map — never on a tile a player or colonist is standing on, and never on a tile next to a player, a post (including houses, barns and castles), or the Town Center. Both kinds of growth stop while the world already has 50 Tree tiles. Wood is a renewable resource.
- **Barns and Farm Plots:** a Barn (15 wood) spawns exactly one farmer, who works every Farm Plot linked to that Barn. A Farm Plot can only be placed on an Empty tile orthogonally adjacent to an existing Barn (diagonal doesn't count); it links to that Barn and spawns no colonist of its own. Each plot runs its own grow/harvest timer (8s grow + 2s harvest) and yields **1 food** per harvest (down from 3 — one Barn already multiplies output across every plot it staffs, so 3 per plot was far too strong), and it keeps running day and night — the farmer still shelters at the Town Center overnight like every civilian, but production only requires that the plot's Barn still exists and that its farmer is alive, not that the farmer is standing at the Barn. If the Barn is broken or its farmer is dead, its plots are paused (not destroyed) and resume from where they left off once the Barn is rebuilt on the same tile and staffed again. Breaking a Farm Plot discards its timer.
- **Mines:** an Iron Mine can be placed either directly on an Iron Ore deposit tile (converting it), or on an Empty tile next to an existing Iron Mine. The same goes for Rock Mines with Rock deposits / existing Rock Mines. Mines never go on the other ore type. A mine placed next to an existing mine of the same type **upgrades that mine** instead of building a second one (see Building upgrades); only once the neighbour is at level 3 does the placement build a new, separate mine. A level-1 mine has one miner, who walks to the nearest unreserved Iron Ore / Rock deposit, mines it, and carries 1 iron / 1 rock back to the post. Breaking a mine that was built on a deposit reverts it to that deposit; breaking one that was built on empty ground reverts it to Empty.
- **Ore never depletes:** Iron and rock ore deposits never deplete — mining one leaves the tile intact forever. Only trees are destroyed on harvest, and they regrow (see above). The world seeds 24 trees, 14 Iron Ore and 16 Rock deposits at server start; no new ore deposits ever spawn (none are needed, since existing ones never run out).

### Building upgrades

- **How to upgrade:** placing a Lumberjack Post, Iron Mine, Rock Mine, Barn, Archer Post, or Church next to (orthogonally adjacent to) an existing building of the same type upgrades the existing one by one level instead of building a new one. The building stays on its original tile and keeps its tile type; the newly-clicked tile is never written to, so it stays whatever it was (normally Empty — or, in edge cases, an untouched ore deposit or wall, so nothing is wasted). Archer Posts and Archer Towers count as the same family for this. Levels are capped at 3: once the neighbour is at level 3, the placement just builds a new level-1 building as normal. Every placement costs the normal price whether it upgrades or not.
- **Bonus:** each level above 1 adds **+5%**:
  - **Lumberjack Post:** chops 5% faster per level (2.0s → 1.9s → 1.8s). Never gains extra lumberjacks.
  - **Iron / Rock Mine:** mines 5% faster per level, **and each upgrade adds one more miner** (level 2 = 2 miners, level 3 = 3; each uses 1 population). If the mine was built directly on a deposit, from level 2 its miners stop travelling altogether and produce right at the post (1 iron / 1 rock every 1.9s at level 2, 1.8s at level 3, per miner). A mine built on empty ground next to another mine has no deposit underneath, so its extra miners still walk to the nearest deposit like a level-1 miner — just faster.
  - **Barn:** every Farm Plot linked to it grows and harvests 5% faster per level. Never gains extra farmers.
  - **Archer Post / Archer Tower:** +5% max HP and damage and 5% faster shooting per level, on top of the base 35 HP / 8 damage (50 HP / 14 damage for a tower) — e.g. a level-2 Archer Post archer has 37 HP. The archer is upgraded in place and fully healed to the new max HP. Never gains extra archers.
  - **Church:** a bespoke **+10% heal amount** per level instead (10 → 11 → 12 HP per heal). Never gains extra bishops.
- **Knight Posts and Houses** keep their own tier systems (castle levels and House → Big House → Level 2 House, below/above) and are not part of this generic system — except that a castle's knight also attacks 5% faster per castle level, on top of its castle HP/damage table.
- Breaking a building resets it: its level is forgotten, so a new building later placed on that tile starts at level 1.

### Guards

- **Knight Post castle leveling:** placing a Knight Post next to an existing Knight Post combines them into a **Level 2 Castle** on the existing post's tile (the newly-clicked tile stays Empty, and no second knight is spawned). Placing a Knight Post next to a Level 2 Castle combines into a **Level 3 Castle**; Level 3 is the top tier. The castle's knight is upgraded in place and fully healed to the new stats: Level 1 (plain Knight Post) 60 HP / 12 damage, Level 2 100 HP / 20 damage, Level 3 160 HP / 32 damage. Each castle level above 1 also makes the knight attack 5% faster. Every Knight Post placement costs the normal 10 iron + 5 rock.
- **Archer Towers:** placing an Archer Post directly on top of a Wood Wall or Stone Wall (not next to it — on it) converts that wall into an **Archer Tower** instead of a plain Archer Post (same 10 wood). Its archer has 50 HP / 14 damage (vs 35 HP / 8 damage for a normal archer) but never moves: it stands where it spawned and fires at anything that comes within its normal 4-tile range, without chasing or repositioning. Archer Posts and Towers level up through the generic upgrade system (see Building upgrades), not castle-style tile changes.
- Breaking a castle at any level reverts it straight to Empty (no de-leveling, no refund). Breaking an Archer Tower reverts it to the wall it was built on (Wood Wall or Stone Wall).

### Church and bishops

- **Church** (15 wood, needs an Empty tile like any normal building) spawns one **bishop**, a healer. The bishop looks for the nearest injured player or colonist (below max HP, not itself) within 7 tiles, walks toward it, and once within 2 tiles heals it for 10 HP every 0.8s (+10% per Church level) until it's back to full; with nobody injured nearby it walks back to its Church and waits. There's no visual effect for a heal — watch the target's HP bar.
- Bishops **don't shelter at night**: they keep healing through raids, since patching up hurt guards during combat is the point.
- Bishops are never mob targets (mobs still only pick knights/archers, then players, then the Town Center), but they do use population like a civilian and eat food like every colonist.

### Upkeep and respawns

- **Food upkeep:** once per full day/night cycle (at dawn) the colony eats 1 food per living colonist (guards included). If there isn't enough food, the stockpile drops to 0 and every colonist takes 10 starvation damage instead.
- **Respawns:** when a colonist dies (combat or starvation), a respawn is queued at the same post. After a 5s delay, if the colony has at least 5 food, it's spent and a new colonist of the same kind spawns there automatically (otherwise it waits until food is available). Civilian and bishop respawns also wait while population is at the cap. A respawned knight comes back at whatever level its castle is at the moment it respawns (an upgrade bought while the knight was dead still counts); a respawned archer likewise comes back at its post's current level, and an Archer Tower archer comes back as a stationary tower archer. Each miner of an upgraded mine respawns separately. Breaking the post cancels any pending respawn.

### Breaking

Left-click breaks any player-built tile: walls, houses (any tier), Barns, Farm Plots, Lumberjack Posts, Knight Posts / castles (any level), Archer Posts / Archer Towers, mines, and Churches. Breaking a post removes its colonist (all of them, for an upgraded mine) and forgets its upgrade level. Most tiles revert to Empty; the exceptions are a mine built on a deposit (back to the deposit) and an Archer Tower (back to its wall). Nothing is ever refunded.

## Town Center

- A permanent, solid structure that exists from server start at the exact center of the map (tile 20,20). It has 300 HP, broadcast to every client each tick.
- Players can't place or break it — it isn't in the placeable tile list, so any setTile aimed at it (or trying to place a new one) is rejected.
- **Night shelter:** the instant night falls, every civilian colonist (lumberjack, farmer, iron miner, rock miner — not knights/archers, who keep fighting, nor bishops, who keep healing) drops its job, abandons any resource it had reserved, walks to a tile next to the Town Center, and stays there until dawn. At dawn gatherers restart from a clean idle state, and a farmer walks back to its Barn. Farm Plot production doesn't pause for the night (see Barns and Farm Plots).
- If its HP reaches 0 it's destroyed: the tile clears to Empty, and mobs stop targeting it.

## Combat

- **Mob target priority:** each mob picks, in strict order: (1) the nearest knight/archer anywhere on the map, no range limit; else (2) the nearest player; else (3) the Town Center, if it's still standing. Mobs targeting the Town Center path to a tile next to it and attack from there.
- **Player melee:** Space triggers a fixed, built-in melee attack — 15 damage to whichever is nearest within ~1.3 tiles among every other player and every mob, with a 0.5s cooldown per player (extra presses during the cooldown are ignored). Other players are valid targets: friendly fire is real. There are no items, tools, weapons, or inventory of any kind. Melee hits have no visual effect line (only archer shots do).

## Next steps

Phases are ordered so the game stays playable after each one:

1. ~~Block placement/breaking on the tile grid~~ (done)
2. ~~One resource job (lumberjack) + colonist pathing~~ (done); farmer job (Farm Plot, in-place grow/harvest into a food stockpile) added as a second production chain
3. ~~A night mob wave + one guard job block~~ (done) — day/night cycle, edge-spawning mobs, Knight Post/Archer Post guards that auto-engage via the shared BFS pathfinder, HP bars on players/guards/mobs; now also a Town Center that civilians shelter at overnight, strict mob target priority, and player melee with friendly fire
4. More production chains/trading (partially done) — ~~iron + rock mining chains~~ (done; Iron Mine/Rock Mine posts built on top of their ore deposits or clustered next to an existing mine, iron + rock gate Knight Posts, wood gates Archer Posts; Wood/Stone Walls; regrowing trees, Lumberjack Posts that plant trees around themselves, and inexhaustible iron/rock deposits; colony starts with a stockpile), daily food upkeep + food-funded colonist respawns, Houses with a civilian population cap, Barns that staff any number of adjacent Farm Plots, Knight Post castle leveling and Archer Towers, a generic 3-level upgrade system for Lumberjack Posts, mines, Barns, Archer Posts and Churches, and Church bishops that heal players and colonists; no trading between players yet
5. Biomes/gear progression (the world is now 40x40 with a follow camera)

## Known deferred work

- The Town Center has no player-facing warning when it's under attack (only its HP bar drops)
- No win/lose condition: if the Town Center is destroyed the tile just clears and the game continues as before (civilians still shelter next to the empty tile at night)
- Mob targeting is "sticky": once a mob has a live target it never re-evaluates priority, even if a closer or higher-priority target appears later (e.g. a mob already heading for the Town Center ignores a player who joins, and one chasing a player ignores a new Knight Post) — the same caveat already applies to guard targeting
- A gatherer carrying a resource back to its post when night falls drops that load (it resets to idle and shelters)
- Every sheltering civilian heads for the same tile next to the Town Center, so they stack on one spot
- A mine built on a deposit converts it, so that deposit no longer counts as minable ore; a level-1 miner walks to another deposit of the same type (and has nothing to mine if every deposit of that type has a mine on it). Mines built on empty ground next to an existing mine (only possible once that mine is level 3) don't consume a deposit, but their miners still walk to the nearest free deposit rather than working "their" vein
- Chunked world loading
- A pathfinding budget/cache
- Tile rendering does a full grid redraw on every single tile change; that's now 1600 tiles at 40x40, and will need patching to a per-tile sprite/mesh approach (and culling to the camera view) for a much larger world
- No dynamic obstacle avoidance in pathfinding (colonists path through tiles players/other colonists are currently standing on — fine at this scale)
- Pathfinding has no request budget/cache yet (plain BFS per request; the grid is now 40x40, so revisit if colonist/mob counts grow significantly, per the earlier performance plan)
- The toolbar (`client/src/main.ts`) is a flat data-driven list (`TOOLS`) — adding a new placeable tool is just one more entry, no other code changes needed
- Only one basic mob stat-block exists so far (no distinct orc vs goblin variants yet)
- Mobs don't despawn at dawn — they remain until killed, even into the next day
- Mobs never target civilian (lumberjack/farmer/miner) colonists or bishops, only guards, players and the Town Center — civilians and bishops can currently only die from starvation, so a bishop walking into a raid to heal is risk-free
- Iron/rock deposit counts are fixed at server start (no new deposits ever spawn); fine since mining never depletes them, but a crowded map has only 14/16 nodes for miners to share
- Walls have no HP/durability, and there's no gameplay difference between Wood Wall and Stone Wall yet — it's purely a visual/resource-cost distinction
- Tree regrowth has no visual "growing" animation; a new tree just appears
- No UI indicator for a pending respawn countdown, and no feedback when a placement is rejected for any reason — insufficient wood/iron/rock, population at cap, a Farm Plot with no adjacent Barn, a mine not on matching ore or next to a matching mine, out of reach — the click just silently does nothing, so "no population" and "no resources" look identical
- No visual indicator of which Barn a Farm Plot is linked to, or whether a plot is currently growing, harvesting, or paused
- A Farm Plot stays linked to the Barn tile it was placed next to; if that Barn is broken and a new Barn is built on a different tile (even one adjacent to the plot), the plot stays paused until a Barn is rebuilt on the original tile
- No partial refund when breaking any structure, including upgraded ones (a Level 3 Castle is 30 iron + 15 rock, a Level 2 House 30 wood — all lost on break), and no de-leveling
- A pending civilian respawn doesn't reserve its population slot: if a new civilian post is placed while one is dead and queued, the queued respawn waits until population drops below the cap again
- Breaking houses never evicts civilians, so population can sit above the cap until colonists die
- Combining a House or Knight Post, and upgrading any building in the generic upgrade system, only ever upgrades the first matching neighbour found (in a fixed right/left/down/up order); there's no player choice of which one when a placement touches two. For Archer Posts, a plain Archer Post neighbour is always checked before an Archer Tower neighbour — if that Archer Post is already level 3, the placement builds a new post rather than falling through to upgrade a lower-level adjacent Tower
- An Archer Tower archer locks on to the nearest mob within its 7-tile alert range like every guard, but can't move to close the gap — if that mob stays beyond its 4-tile shooting range, the tower keeps that target (and doesn't shoot other mobs that walk into range) until the mob dies or comes closer
- No hit/damage feedback for player melee beyond HP bars
- Starvation damages every colonist equally — nothing prioritizes or spares any kind (e.g. farmers or guards)
- No "stockpile at risk" warning before the dawn food tick
- No visual effect for a bishop's heal (deliberately — reusing the archer's shot line would read as an attack); only the target's HP bar shows it
- A bishop's heal target is "sticky" like guard targeting: once it picks someone it follows them until they're fully healed or gone, even beyond the 7-tile alert range, and doesn't switch to a closer or more badly hurt target. It also paths to the target's own tile, so a target standing on a solid tile (a farmer that hasn't left its Barn tile since it spawned, or a stationary miner sitting on its mine) can't be reached unless it's already within 2 tiles — the bishop then stalls in "approaching" until that target dies
- No visual indicator of a building's upgrade level for the generic system (a level-3 Lumberjack Post looks identical to a level-1 one), and no indicator of which neighbour a placement will upgrade
- Upgrading a Lumberjack Post, Barn or Church is still population-gated like a new placement, even though those upgrades never add a worker — at the population cap you can't upgrade them
- When an on-ore mine reaches level 2, its original miner becomes a stationary producer wherever it happens to be standing (possibly mid-walk, away from the post), and any deposit it had reserved stays reserved until nightfall. Stationary miners still shelter at night like every civilian, and at dawn they resume producing from the shelter spot next to the Town Center rather than walking back to the post (production is unaffected; it just looks odd)
- Stat bonuses are rounded to whole numbers, so a plain Archer Post's damage doesn't change at level 2 (8 × 1.05 = 8.4 → 8) and only reaches 9 at level 3
- Placing a mine directly on a deposit next to an existing, not-yet-level-3 mine of the same type upgrades the neighbour and leaves that deposit untouched (deliberate: nothing is wasted, but the deposit isn't claimed)

These are deliberately deferred until a later phase actually needs them.
