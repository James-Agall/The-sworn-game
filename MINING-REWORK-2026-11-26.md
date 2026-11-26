# Mining rework (2026-11-26)

Branch `mineral-mine-rework`. The map used to carry six deposit tiles (coal seam, copper ore, tin ore, limestone,
gold ore, lead ore) next to iron ore and plain rock, several drawn with the same grey `rock` art as plain Rock, so
players could not tell where a Quarry or a Mine would go. Now there is one mineral tile and the ores come from inside
the Mine.

## Design
- **One mineral tile.** `TileType.IronOre` is the only mineral on the map and fairly rare (region worlds: about 0.5% of
  open countryside, often cleared by farms; 80-tile worlds: the old scatter). World gen no longer makes the six
  deposit tiles; their enum ids stay as inert legacy, like the old Coal / Copper / Tin / Lime / Gold / Lead mine tiles.
  `WORLDGEN_VERSION` is 23.
- **Ore near the start.** `ensureStartOre` (server/src/worldgen.ts) runs last in world gen (after the countryside
  farms, roads and every other stamp that clears or claims ground). It guarantees at least **2** iron ore outcrops
  within **20** tiles (Euclidean) of the first Town Center, at least 4 tiles from it, each with all eight neighbours
  walkable (no solid tile, water or moat), reachable on foot from around the Town Center, off reserved grounds
  (`isInReservedGrounds`: abbey, castle ruin, forts, overgrown landmarks) and owned grounds (`ownerAt === 0`), never
  under a unit. Existing qualifying ore counts. Placement is a hash of the world salt (no shared RNG draws), so a
  streamed save regenerates the same base. Numbers: `START_ORE_*` in shared/src/mines.ts.
- **Placement.** The Mine goes only on `IronOre` (placing on your Mine still upgrades it); the Quarry only on `Rock`.
  Refusals say why: rock "takes a Quarry", ore "takes a Mine, not a Quarry", cave rock "cannot take a Quarry", empty
  ground needs an ore outcrop / grey stone. A demolished Mine gives its iron ore back, a Quarry its rock (the
  `minesPlacedOnOre` set is plain `x,y` keys again). The placement ghost, tool tooltips, minimap and stand-in sprite
  tables no longer know the deposits.
- **Mineral nodes in the Mine.** Each Mine level (layer) holds **3-5** "Mineral outcrop" nodes (`mineralNode`),
  placed by shared/src/underground.ts from a hash of the layout seed (tile, world salt) and the depth, one per chosen
  chamber, every node reachable. E at a node gives the hero **one** ore of that level's pool (`MINE_LAYER_YIELDS`:
  level 1 copper ore / tin ore / limestone, level 2 iron ore / coal, level 3 gold ore / lead ore): the ore the node
  shows; a new random ore of the pool is rolled for when it grows back. Iron ore is a carried good (pack; a full pack
  refuses and the node keeps its ore), the other ores go to the stores as every adventure find does. The level's pickaxe
  must be in store (stone / bronze / iron, as the dig at the ore face; off under COLONY_UNLOCK_ALL). Nothing while the
  level is infested or the Mine is closed today (cave-in / flood). A mined node is **worked out for one game day**
  (`MINE_NODE_RESPAWN_DAYS`, `GAME_DAY_TICKS`), drawn faded with "Worked out (back in N h)"; the timer and the node's
  ore are saved with the mine's layers (`mines[].layers[].nodes`). The Mine has no loose rock blocks any more.
- **Quarry.** Still its own mine on Rock with levels, timber props / vent / pump gates and infestation exactly as before,
  but stone only: 3-5 "Rock outcrop" nodes (`rockBlock`, "Chip stone") give **2 rock** (carried) with any pickaxe,
  same one-day regrowth and save; no mineral nodes; its chests / caches hold rock, no limestone; kill loot was already
  rock. Its rock miners produce as before.
- **Colonist miners** are unchanged: a Mine's miners rotate over the open clear / cleared levels' resources, the
  Quarry's make rock.
- **Art (no new art).** Nodes use the existing per-ore underground art (`/sprites/underground-v4/<ore>.png`), chosen by
  the ore each node holds now; worked-out nodes are drawn at 35% alpha. The Quarry has its own world sprite key
  **`quarry-pit`**, currently a **placeholder** byte copy of `quarry.png` (SPRITES.md #116: a real pit-mine sprite is
  still to be supplied; `quarry.png` itself is untouched because the Clay Pit, Cellar and legacy mines reuse it).
- **Text.** Stone pick description, mining chain comments and the Mine / Quarry tooltips describe the new rules.

## Deviations from the brief
- Mineral nodes use the existing per-ore underground sprites (`underground-v4/copperOre.png` etc.) instead of the
  surface `ironOre` sprite with a tint: those sprites already exist for every ore, are clearly not plain rock, and
  match what the ore faces inside already show. No new art either way.
- "One random ore" is rolled when a node is mined (for its next growth) and shown on the node, rather than hidden until
  the moment of harvest, so the art never lies about what E will give.

## Verification (2026-11-26)
- `npx tsc --noEmit -p shared`, `-p server`, `-p client`: clean.
- `cd server && npx tsx start-ore-test.ts` (new): 19 generated worlds at sizes 80 / 160 / 512 / 1024 over several seeds:
  no deposit tile, >= 2 reachable iron ore within 20 tiles of the Town Center off reserved / owned ground; one seed
  regenerates identical tiles.
- `npm test -- mines` (extended): world gen, Quarry / Mine placement and refusals (iron ore, cave rock, rock, empty, a
  retired deposit tile), demolish gives ore back, node counts and ores per level, refusal while infested / without the
  pickaxe / worked out / full pack, exactly one ore of the right pool, iron into the pack, respawn after a game day,
  Quarry stone-only nodes and rock miners, nodes' timers through save / load.
- `npm test -- industry-extra adventure-experience adventure-test save-load interiors`: pass.
- `cd server && npx tsx underground-test.ts` (3-5 nodes per Mine / Quarry level), `npx tsx hostile-scatter-test.ts`,
  `npx tsx interactions-test.ts`; from the repo root `npx tsx server/cave-detail-test.ts` (ore art exists for every
  node ore), `npx tsx server/cave-art-test.ts`: pass.
- `npm run smoke`: 35/35 (one earlier run had a single "solo hero: gather" miss, wood 0, which passed alone and in two
  further full runs; it does not touch mines).
- Browser check: see MANUAL-TESTS.md "Mining rework (2026-11-26)".
