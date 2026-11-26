# Stage B: forts, POIs, the Castle Ruin and building interiors as data (2026-11-26)

Branch `data-templates` (off `main-split` c0d1c72). SPEC: `~/docs/colony2d/SPEC-sprite-lab.md` sections 9 / 9.1
("Stage B"). Goal: move game content that was hard-coded in TypeScript into JSON data files with loaders and strict
validators, so the Sprite Lab's Area tab can edit it later, WITHOUT changing the game: the same seed makes the same
world, every interior map is the same, saves are the same. The editing UI is a later step.

## 1. What moved where

| Content | Before (code) | Now (data) | Loader / store | Format + validator |
|---|---|---|---|---|
| Forts + human-site profiles (`thornwick`, `grakkar`, `hearthmoor`, `ironhold`, `riverwatch`) | `SITE_TEMPLATES` in `server/src/constants.ts` | `server/data/sites/<id>.json` + `server/data/sites/user/` | `server/src/siteTemplates.ts` | `shared/src/siteTemplates.ts` (`validateSiteTemplate`) |
| Site legends | `SITE_TEMPLATE_TILES`, `HUMAN_SITE_SYMBOLS` (constants.ts) | code in `shared/src/siteTemplates.ts` (like `CAMP_LEGEND`); each human file carries its own `symbols` map (tile NAMES) | - | - |
| Ruin / encampment POI pools | `RUIN_CENTERPIECES`, `RUIN_EXTRAS`, `ENCAMPMENT_EXTRAS`, `RUIN_GUARDIAN_WEIGHTS`, `ENCAMPMENT_GUARDIAN_WEIGHTS` (constants.ts) + the counts hard-coded in `placePoiSite` | `server/data/pois/ruin.json`, `server/data/pois/encampment.json` + `user/` | `server/src/poiTemplates.ts` | `shared/src/poiTemplates.ts` (`validatePoiTemplate`) |
| The Castle Ruin | `CASTLE_RUIN_*` (constants.ts) + the boss kind `"ogre"` in `placeCastleRuin` | `server/data/castle-ruins/castle-ruin.json` + `user/` | `server/src/poiTemplates.ts` | `shared/src/poiTemplates.ts` (`validateCastleRuin`) |
| Building interiors (house, tavern, church, smithy, bakery, shop, barracks, hall, barn + upper floors) | `INTERIOR_LEGEND`, `INTERIOR_TEMPLATES`, `INTERIOR_UPPER_TEMPLATES`, `INTERIOR_REQUIRED_PROPS`, `INTERIOR_SLEEP_TEMPLATES` in `shared/src/interiors.ts` | `shared/src/data/interiors/legend.json` + `<id>.json` (one per building type) | static JSON imports in `shared/src/interiors.ts` | `shared/src/interiors.ts` (`validateInteriorFile`, `validateInteriorTemplate`) |

Stayed in code (deliberately): the mine's three layouts (`MINE_TEMPLATES` in interiors.ts: the Deep mines' depth
layouts are encounter interiors, out of scope), `INTERIOR_TEMPLATE_BY_TILE` / `INTERIOR_FIXED_LEVEL` (they map
TileType numbers to building types: a data file cannot add tiles, and the mine tiles are in them),
`furnishInteriorEdges`' themes, `SITE_FORT_COUNT_AT_512` and the other world-gen counts, `SITE_KIND_HAS_HEARTH`, the
global POI placement numbers (`POI_SITE_FOOTPRINT_RADIUS` = the ground every scattered site keeps clear,
`POI_SITE_WATER_CLEARANCE`, `POI_SITE_MIN_SPACING`), mini-boss packs (spawn rules, no layout), every cave / mine /
ruin-room / camp encounter interior and the procedural underground.

## 2. Design decisions

- **Server-only data (A-C) follows the camps / buildings / settlements pattern** through the shared
  `makeTemplateStore` (server/src/templateStore.ts): built-ins in `server/data/<kind>/*.json` (read-only; a broken
  built-in throws), user files in `server/data/<kind>/user/*.json` (with `COLONY_TEST_HOOKS=1`: `<kind>-user` in
  `COLONY_SAVE_DIR`; env overrides `COLONY_SITE_USER_DIR`, `COLONY_POI_USER_DIR`, `COLONY_CASTLE_RUIN_USER_DIR`),
  a broken user file is skipped with a warning, a user file whose id is a built-in's is skipped ("shadows a built-in"),
  saving over or deleting a built-in is refused. Boot: `loadSiteTemplates()` and `loadPoiTemplates()` in index.ts after
  the other stores.
- **Loaded at import, not only at boot.** `SITE_TEMPLATES` and the POI / Castle Ruin tables were module constants used
  by many modules and by in-process test scripts that never call a boot loader. The stores therefore read the
  built-ins (and the user folder) when their module is first imported, so every importer sees exactly what it saw
  before; the boot loaders reload and log.
- **Same export names.** `SITE_TEMPLATES` (now in `server/src/siteTemplates.ts`), `RUIN_CENTERPIECES`, `RUIN_EXTRAS`,
  `ENCAMPMENT_EXTRAS`, `RUIN_GUARDIAN_WEIGHTS`, `ENCAMPMENT_GUARDIAN_WEIGHTS` and every `CASTLE_RUIN_*` (now in
  `server/src/poiTemplates.ts`) keep their names and values; only the module moved. `SITE_TEMPLATES`' key order is
  the old one (the built-ins the code names first, `BUILTIN_SITE_TEMPLATE_IDS`), then other built-ins and user
  templates by id.
- **`SiteTemplateId` is an open `string`.** Check at run time with `isSiteTemplateId(id)` (own property of
  `SITE_TEMPLATES`, so `"toString"` is not an id). Every built-in id the code names (`BUILTIN_SITE_TEMPLATE_IDS`) must
  exist or the module throws. World-gen still only places the ids it names (`generateForts`: grakkar, thornwick;
  settlement templates' `profile`: hearthmoor / ironhold / riverwatch); a user site template can be stamped from the
  creative editor / test hooks (`id in SITE_TEMPLATES`).
- **World-gen draws.** placePoiSite keeps its draw order: centrepiece (a random pick only when the pool has more than
  one entry: the ruin's 3 draw as before, the encampment's single campfire draws nothing as before), extra count,
  shuffled neighbours, extra picks, guardian count, shuffled spots, weighted kinds. The pools' entry ORDER is part of
  the world (see the mutation check in 4).
- **Tiles are NAMES in the files** (`"RuinWall1"`, `"StoneWall"`), turned into TileType numbers on load; the enum
  numbers never appear in data.
- **Interiors: static JSON imports in the shared module.** `shared/src/interiors.ts` imports its JSON with
  `import x from "./data/interiors/x.json" with { type: "json" }`. tsx / Node read the same files the client bundle
  (Vite) inlines at build time, so the server and the client can never hold different layouts. In fact the client
  does not build interior maps at all: it imports only constants and types from interiors.ts, and every map it draws
  comes from the server in the `interior` view message (`InteriorView.map`). A runtime `user/` folder would therefore
  also be safe for client/server agreement, but it was NOT added: a user interior would have to replace or add a
  variant, and `interiorVariantFor` picks a variant by its index (order and count are behaviour), so that semantics
  belongs with the editor stage. With static data the built-ins stay the only layouts, exactly as before.
  `resolveJsonModule` is on in the shared / server / client tsconfigs (needed to type the JSON imports).
- **Interiors: file per building type** `{ id, required, sleep, variants: [3 layouts], upper? }`, a layout
  `{ label, floor, wall, rows }`. At import only the shape is checked (cheap; throws on a malformed file in both server
  and client); the full walkability / station check is `validateInteriorFile` (and `validateAllInteriorTemplates`, as
  before), run by the tests. The Town Center invariant is enforced twice: the hall file's `required` must keep
  `throne`, `table`, `chest` (`HALL_REQUIRED_PROPS`), and every hall layout must contain them.
- **Key orders kept.** `INTERIOR_TEMPLATES` keeps `house ... hall, mine, barn`; `INTERIOR_REQUIRED_PROPS` keeps
  `house ... barn, mine`; `INTERIOR_SLEEP_TEMPLATES` is `house, hall` (from the files' `sleep` flags).

## 3. File formats and validators

### server/data/sites/<id>.json (`SiteTemplateFile`, shared/src/siteTemplates.ts)
Fields in this order: `id`, `faction` (bandit / orc / human), `label` ("Palisade"; "" for human profiles), `noun`?
(sighting toast), `names` (site name pool, in pick order), `rows` (ASCII grid at max tier), `tiers` (same size: digit
1..maxTier per non-"." cell, "." on "." cells), `maxTier` (1-4), `startTier`, `symbols`? (symbol -> TileType name over
`SITE_TEMPLATE_TILES`), `garrison` (mob kind -> count, in spawn order), `workers`? (farm / mine / priest / herald ->
count), `stock`, `rebuildCost` (resource -> amount). `validateSiteTemplate(raw, { mobKinds })` checks the id rule,
faction, label / noun / names, tier range, garrison (known kinds, at least one), workers roles, resources, symbol
characters and tile names, the grid shape (rectangular, tiers the same shape, max 64x64), every symbol known, a tier
digit on every non-"." cell, exactly one keep `K`. `siteTemplateFromFile` gives the game form (TileType numbers).

### server/data/pois/<id>.json (`PoiTemplateFile`, shared/src/poiTemplates.ts)
`id`, `centerpieces` (tile names; one entry = no draw), `extras` (tile names), `extraCount` [min, max] (<= 8),
`guardianCount` [min, max], `guardians` [{kind, weight}] (weighted pick, in order), `footprintRadius` (1-2: the
guardian ring; the scatter keeps radius 2 clear). `validatePoiTemplate(raw, { mobKinds })`.

### server/data/castle-ruins/<id>.json (`CastleRuinFile`)
`id`, `rows` (square, odd, 5-15; "." open ground, "B" the boss's spot: exactly one, the centre), `tiles` (symbol ->
tile name; not "." or "B"), `boss` (mob kind), `spawnDistFractions` (each in (0, 1), tried in order),
`guardians` [min, max], `guardianWeights`. Radius = floor(size / 2), grounds = radius + 1.
`validateCastleRuin(raw, { mobKinds })`.

### shared/src/data/interiors/legend.json and <id>.json
`legend.json` is `INTERIOR_LEGEND` as it was (symbol -> { label, prop?, npc?, minLevel? }), including the mine-only
symbols. `<id>.json` (`InteriorFile`): `id` (one of `BUILDING_INTERIOR_IDS`), `required` (the room role's stations),
`sleep` (your own one is a bed you sleep in), `variants` (exactly `INTERIOR_VARIANTS` = 3 layouts; index = variant),
`upper`? (the floor reached by the "U" stairs). `validateInteriorFile(raw)`: shape + `validateInteriorTemplate` on
every layout with the file's own `required` / upper floor (rectangular, known symbols, closed outline, one exit mat in
the bottom row / upstairs one "D" and no mat, everything reachable, beds / chests / NPC slots reachable, the stations,
a keeper slot except houses, a resident in houses, tavern seats, stairs up when there is an upper floor).
`normaliseInteriorFile` writes the known fields in this order.

## 4. Proof that nothing changed

`server/data-templates-test.mjs` (`npm test -- data-templates`; generation only, no game server) with
`server/data-templates-probe.mts` and the golden file `server/data-templates-golden.json`. The golden file was written
ONCE from the unmodified base code (commit 5778a78 = c0d1c72 + the harness only) with
`DATA_GOLDEN_WRITE=1 node server/data-templates-test.mjs`, then checked to reproduce on the base code three times.

- **Worlds**: one fresh process per world (several worlds in one process can be order-dependent). 36 worlds: seeds
  1, 7, 13, 42, 99, 2024 at sizes 160 / 512 / 1024 at worldgen version 23 (the region world), size 96 at 23 (the
  small-map path: scattered ruins, templated camps, the Castle Ruin) and sizes 160 / 512 at version 11 (the old path
  with `generateForts`, stamped human sites, `placePoiSite` ruins). Per world 10 values: counts (sites, hearths, mobs,
  owned tiles, seeded Math.random draws), sha256 of tiles, biomes, NPC tile owners, sites, hearths, mobs (kind,
  position, site kind, boss), the region plan, landmarks (Abbey / Castle Ruin centres, Town Centers) and the whole
  `snapshotWorld()` save state. Random UUIDs are replaced by their order of first appearance; a mob's size (scale and
  the hp / damage / speed / range it scales) is rolled from its random UUID (`rollMobSize`), is not seeded, differs
  run to run on the SAME code, and is left out of the save hash (kind, position, site and post are in).
- **Content**: the deep contents of every moved table (site templates + legends + fort counts, POI pools + global
  POI numbers + `SITE_KIND_HAS_HEARTH`, all `CASTLE_RUIN_*`, all interior tables incl. `INTERIOR_TEMPLATE_BY_TILE`,
  `INTERIOR_FIXED_LEVEL`, walkable props, variants), key order included.
- **Interiors**: sha256 of `buildInteriorMap(id, level 1-3, variant 0-2, storey 0 / 1 where there is an upper floor)`
  (tiles, props + facing, NPC slots, exit, spawn, stairs, lairs) and of `validateInteriorTemplate` per layout and
  `validateAllInteriorTemplates()`: 151 hashes.
- **Sensitivity check** (on the base code, reverted): swapping the two entries of `RUIN_EXTRAS` made 19 checks fail
  (all 6 size-96 worlds and all 12 version-11 worlds: tiles + save hashes, plus the content check), so the hashes do
  see a pool's order. (At version 23 on 160-1024 the region world's ruin rooms overwrite the extras: those worlds
  did not change, which is why the other two paths are in the matrix.)

Results after every migration commit: see 5.

## 5. Results

Commits (each one passes `npx tsc --noEmit -p shared`, `-p server`, `-p client` and `npm test -- data-templates`):
5778a78 harness + golden, 00dd37f site templates, 39de404 POI pools, 660d428 Castle Ruin, 5101214 interiors, then docs.

**data-templates (final tree)**: 36/36 worlds identical, 10/10 hashes each (160 / 512 / 1024 at v23: 6 seeds each;
96 at v23: 6; 160 / 512 at v11: 6 each); every content table identical; interior hashes 151/151 (house 12/12,
tavern 22/22, church 12/12, smithy 12/12, bakery 12/12, shop 12/12, barracks 22/22, hall 22/22, mine 12/12,
barn 12/12, validateAll 1/1); loaders / validators 124 checks pass.

**Suites** (final tree; each failure was re-run on the base code c0d1c72 in a scratch worktree and fails there too):
- PASS: data-templates, interiors, interior-refresh, hall-chest, inn, home-design, interior-interactions-wire,
  save-load, creative, sites, fortifications, post-castle-goals, houses-barns-castles; `npm run smoke` ALL PASS
  (35 checks). (There is no `furniture` suite file.)
- FAIL on base too (pre-existing): camp-hearth (1), camp-templates (4), goals-castle (12: 160 worlds use the region
  world, no Castle Ruin guardians as the test expects), keep-footprints ("clear legacy keep expands on load"),
  settlement-templates ("D tiers on 256 maps"), settlements and settlement-pop (random worlds: different lines fail
  from run to run on both trees), warbands (flaky: "M far again" on both).
- `.ts` suites (`COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch> tsx server/<name>-test.ts`), new vs base identical:
  underground, cave-detail, hostile-scatter, town-life, organic-towns, compact-towns, ruin-rooms, regions, start-ore
  pass; regions20 / 21 / 22 exit 1 on both (known at size 160).
- Client bundle (`vite build` to a scratch out-dir): builds; main chunk 983,322 -> 991,371 bytes (+8.0 KB, +0.8%;
  gzip 330.58 -> 332.87 kB): the interior JSON objects (the layouts were already in the bundle as code) and the
  file-shape check.

## 6. Exported symbols changed (for the Sprite Lab)

Moved (same name, new module):
- `SITE_TEMPLATES`: `server/src/constants.ts` -> `server/src/siteTemplates.ts`.
- `SITE_TEMPLATE_TILES`, `HUMAN_SITE_SYMBOLS`: `server/src/constants.ts` -> `shared/src/siteTemplates.ts`
  (`@colony/shared/siteTemplates`).
- `RUIN_CENTERPIECES`, `RUIN_EXTRAS`, `ENCAMPMENT_EXTRAS`, `RUIN_GUARDIAN_WEIGHTS`, `ENCAMPMENT_GUARDIAN_WEIGHTS`,
  `CASTLE_RUIN_LAYOUT`, `CASTLE_RUIN_LAYOUT_TILES`, `CASTLE_RUIN_FOOTPRINT_RADIUS`, `CASTLE_RUIN_GROUNDS_RADIUS`,
  `CASTLE_RUIN_SPAWN_DIST_FRACTIONS`, `CASTLE_RUIN_GUARDIANS_MIN`, `CASTLE_RUIN_GUARDIANS_MAX`,
  `CASTLE_RUIN_GUARDIAN_WEIGHTS`: `server/src/constants.ts` -> `server/src/poiTemplates.ts`.
Changed:
- `SiteTemplateId` (server/src/types.ts): the closed union -> `string`.
- `validateInteriorTemplate(t, upper)` gained an optional third parameter `role` (default: the loaded tables).
Removed: nothing else exported (the private `singleStage`, `HEARTHMOOR_ROWS`, `IRONHOLD_ROWS`, `RIVERWATCH_ROWS` and
`T` callers are gone; the human `tiers` grids are written out in the JSON).
New exports: `shared/src/siteTemplates.ts` (`SiteTemplateFile`, `SiteTemplateData`, `SITE_FACTIONS`,
`SITE_WORKER_ROLES`, `SITE_RESOURCE_KEYS`, `SITE_MAX_TIER`, `SITE_SIZE_MAX`, `validateSiteTemplate`,
`normaliseSiteTemplateFile`, `siteTemplateFromFile`, `siteTileName`), `shared/src/poiTemplates.ts` (`PoiTemplateFile`,
`CastleRuinFile`, `WeightedKind`, `validatePoiTemplate`, `validateCastleRuin`, `normalisePoiTemplateFile`,
`normaliseCastleRuinFile`, `poiTileByName`, `POI_FOOTPRINT_RADIUS_MAX`, `CASTLE_RUIN_SIZE_MIN` / `_MAX`),
`shared/src/interiors.ts` (`BUILDING_INTERIOR_IDS`, `BuildingInteriorId`, `InteriorFile`, `InteriorLayoutFile`,
`HALL_REQUIRED_PROPS`, `validateInteriorFile`, `normaliseInteriorFile`), `server/src/siteTemplates.ts`
(`BUILTIN_SITE_TEMPLATE_IDS`, `loadSiteTemplates`, `isSiteTemplateId`, `siteTemplateFiles`, `saveUserSiteTemplate`,
`deleteUserSiteTemplate`, `userSiteTemplateDir`), `server/src/poiTemplates.ts` (`PoiTemplate`, `RUIN_POI`,
`ENCAMPMENT_POI`, `CASTLE_RUIN_BOSS_KIND`, `loadPoiTemplates`, `poiTemplateFiles`, `castleRuinFiles`,
`saveUserPoiTemplate`, `deleteUserPoiTemplate`, `saveUserCastleRuin`, `deleteUserCastleRuin`, `userPoiDir`,
`userCastleRuinDir`).
For the Lab: new kinds `sites`, `pois`, `castle-ruins` for `TEMPLATE_KINDS` / `KINDS` (validators above, legends:
`SITE_TEMPLATE_TILES` + per-file `symbols`, tile names for POIs / the Castle Ruin); interiors are not a store kind (no
user folder yet). A Lab tsconfig that type-checks `shared/src/interiors.ts` needs `"resolveJsonModule": true`; its
stamper's resolve hook must let `.json` imports with `{ type: "json" }` through (Node 22 handles them natively).

## 7. How to add one as data

- **A fort / human site**: copy `server/data/sites/thornwick.json` (or a human one) to
  `server/data/sites/user/<new-id>.json`, change `id`, the grid, tiers, garrison... It loads at boot (check the log
  line `[sites] N built-in + M user site templates`; a broken file is skipped with the validator's message). Stamp it
  in creative mode / with the `stampSite` test hook. World-gen does not place user sites (generateForts names its
  ids; settlement `profile` is still the closed list hearthmoor / ironhold / riverwatch).
- **A POI pool / Castle Ruin variant**: `server/data/pois/user/<id>.json` / `server/data/castle-ruins/user/<id>.json`
  load and validate; world-gen reads only the built-in ids. Changing a BUILT-IN pool changes every world (the
  data-templates test will then fail on purpose: regenerate the golden file only for an intended world change, and
  bump WORLDGEN_VERSION if old worlds must regenerate as before).
- **An interior layout**: edit / add in `shared/src/data/interiors/<type>.json` (a type keeps exactly 3 variants; the
  order is the variant index). Run `npm test -- data-templates interiors interior-refresh hall-chest`. A new building
  TYPE needs code (TileType, `INTERIOR_TEMPLATE_BY_TILE`, the `InteriorTemplateId` union, `BUILDING_INTERIOR_IDS`).

## 8. Open problems / follow-ups

- User site templates cannot be settlement profiles yet (`SettlementProfile` is a closed list in
  shared/src/settlementTemplates.ts) and world-gen does not place them; user POI / Castle Ruin files are loaded but
  unused by world-gen. Which user data world-gen should use is an editor-stage decision.
- A save that names a site template that no longer exists (a deleted user template) would make `SITE_TEMPLATES[...]`
  undefined for that site; not guarded (old-save compatibility is not required; built-ins cannot be deleted).
- Interiors have no user folder (see 2); the editor stage must decide replace-a-variant vs add-a-variant semantics.
- Pre-existing, not changed here: a mob's size is rolled from its random UUID, so mob hp / damage / speed differ
  between two generations of the same seed.
