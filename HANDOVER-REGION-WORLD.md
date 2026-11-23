# Region world generator, version 12

New worlds of 128 cells or larger use 32 × 32 regions. Smaller legacy worlds retain their compact generator. The full world is generated upfront and uses the existing chunk streaming, activation and distant simulation engine. The streaming threshold is now 128 cells. Existing saved terrain loads through the existing cache/diff mechanism. Missing-cache regeneration passes the saved generator version to preserve the version-11 generation path.

Shared definitions and layout generation live in shared/src/regions.ts. Server composition is server/src/regionWorld.ts. City layouts are resolved by ID through settlementTemplateById, including after save/load and capture/rebuild. Region plans are included in snapshots saved to disk. City shapes include 1×1, 2×1, 1×2 and 2×2, with six style variants. One SiteState and civic anchor own the whole city. Streets cross interior seams and perimeter gates connect to the regional network.

Buildings, guards, traders, quest NPCs, interiors, terrain, cave creatures and camp hearths use existing types and spawners. City services include market, bakery, smithy, tavern, barn and church, with houses placed around accessible lanes. Existing NPC-town economic rules remain in effect. Persisted house designs select cottage, townhouse, farmhouse, longhouse, hunting lodge, hill burrow and manor assets. The region generator reuses existing artwork.

Forests vary density, countryside includes small cultivated patches, marshes include pools, and a river has traversable drawbridge cells. Camps reuse the existing guarded/prisoner/loot templates and are surrounded by road bypasses. Fort regions use fortified settlement layouts. Ruins reuse encounter spawning. Cave regions currently provide rocky outdoor encounters with cave spiders and bats. They do not introduce a new underground-map travel system. Unique Abbey and castle-ruin landmarks are retained and protected during composition.

Basic validation commands, from repository root with Node on PATH:
- COLONY_WORLD_SIZE=256 node_modules/.bin/tsx server/regions-test.ts
- COLONY_WORLD_SIZE=1024 node_modules/.bin/tsx server/regions-test.ts
- node server/smoke-test.mjs
- node_modules/.bin/tsc -p server --noEmit
- node_modules/.bin/tsc -p client --noEmit
- cd client && ../node_modules/.bin/vite build

Validated 24 city template combinations, deterministic connected region graphs at four sizes and three seeds, real entity generation, and actual settlement entrance reachability from the player's start. All 35 smoke checks passed, including save/load and registry/entity audits. Production build and TypeScript checks passed. The visual sheets remain concept references, rather than an exact asset-by-asset reproduction. Runtime browser visual review remains follow-up work.


## Follow-up — natural terrain and settlement density

Generator 13 adds winding inter-region road segments, a meandering river and grouped marsh pools. Client terrainTextures.ts provides cached rounded water masks and muted dirt-road connectors. The decorative yellow road border is replaced for dirt roads. Ownership, season, damage and character recolouring were removed from artwork. Separate combat/spell effect layers remain.

New cities use versioned -dense template IDs, with 15/31/63 buildings for one/two/four-region footprints. Existing IDs keep their layouts for save compatibility. New city house plots include storage decorations. Actual settlement workers scale with homes, capped at 32 requested residents. Region settlements activate within 12 cells of their bounds, replacing their previous 96-cell keep radius. Forts reserve regions through the same city planner, with a full-region buffer between settlement identities. Generated template stamping does not clear an apron into another chunk.

Older neutral region towns gain houses only on vacant unowned 3×3 plots when loaded, capped by area. Captured and cleared towns are excluded. Existing street geometry and settlement spacing are retained in those saves. Save loading explicitly retains generator 12 for regeneration. New spacing, denser composed layouts and winding terrain require a new world.

Checked both 24 legacy and 24 denser city templates, deterministic plans, actual entrance reachability and one settlement identity per chunk. Generated a 1024-cell world successfully. TypeScript and production build passed. Smoke suite passed all 35 checks on retry, after one first-run family-dialogue failure. Browser screenshot automation encountered environment/Chrome issues, so live visual review of rounded water remains necessary.


## Generator 14 — scarce large cities and working-district layouts

New region plans allocate one 2×2 city first, then a seeded target of 1–3 vertical 1×2 cities, then fill remaining settlement slots with 1×1 towns. Small maps place only layouts that fit safely away from the starting area. Existing world plans retain their saved layouts and versioned regeneration paths. Landmark placement temporarily reserves city footprints so it cannot consume the rare large-city slots.

New -district template IDs preserve the old legacy and -dense definitions. They contain rounded stepped wall outlines with connected corner cells, stone/palisade variants, accessible gates, housing and civic/market areas, northern crop plots/pasture/orchards, and a southern industrial yard outside the walls. The yard groups the actual Bloomery, CharcoalBurner, Blacksmith, BuildersGuild carpentry yard, tailor and barn types. Services and house plots use real building references. House plots may share their front approach row with a road. Validation permits that only for these new layouts. Large cities cap at 128 buildings and distribute houses across the available plots. The single-region sample has 10 homes, compared with 9 in the prior dense template.

The existing settlement NPC/production/trade systems remain in use. Industry is represented by actual station types and their existing interactions, rather than a newly introduced neutral-city manufacturing simulation. Resident activation remains capped and proximity-based as in generator 13.

Validation completed for 72 city template combinations, connected regional road graphs, actual entrance reachability, non-overlapping settlement identities per chunk and city-size quotas. The 1024-cell test seed creates 1 four-region, 2 double-region and 70 single-region settlements. The 160-cell fallback generates a single town. TypeScript and production builds pass. All 35 smoke checks pass. The smoke dialogue assertion now accepts additional valid Elder choices while still testing gift/work actions.

Layout previews are exported under the Windows workspace outputs/world-regions/town-districts.html and town-districts.png. They use actual template data and game sprite images, with dynamic inhabitants and renderer effects omitted.


## Town life — cached traffic, pets, guard posts, dialogue and horses

server/src/townLife.ts builds one adjacent-cell road tour and one road/perimeter patrol tour per settlement, cached by the SiteState object. Ordinary residents follow shared tours with staggered pauses. Individual movement does not run A*. Priests, heralds and the trader retain their dedicated roles. Conversations pause the speaker. Civilian IDs now derive from settlement, role and resident index, preserving names/trades/stories over sleep/wake cycles.

Human garrisons get stationary posts beside gates and by the keep, plus two patrol places. Capacity additions occur once; subsequent casualties use the existing refill rules. Sleeping/unprovoked guards bypass updateMob and target/path selection. They follow their scripted patrol or hold position. A guard hit activates the garrison. Civilian/property damage no longer triggers guard activation under this requested rule. The existing hostility timeout stands the garrison down again. Routes reinitialize after combat so returning actors do not follow stale off-road segments.

Site snapshots optionally provide up to 128 cached road cells for two cosmetic pets per awake town. client/src/townPets.ts reuses native dog/cat artwork and interpolates them locally. Pets have no server entities or per-frame network updates. They are culled with town activity/proximity and hidden during town hostility and interiors/strategic views.

Left-clicking town farmer/miner/priest/herald sprites sends a targeted interact request before tools/combat. The server validates the exact target and talk distance, then opens the existing popup dialogue. Villagers offer actual shop/workshop directions with bearings, map reveals and a daily speech reward. Personal backstories are available from neutral villagers. Existing weather/day/trade/gossip/quest content remains integrated.

Army building panels list nearby owned Stables. Opening Stables exposes the existing actual horse market, with mare/stallion buying, gold costs, capacity checks and mounting. No separate horse inventory or currency was introduced. The animal panel heading identifies riding horses.

Validation: server/town-life-test.ts covers shared route cache reuse, adjacent road segments, patrol movement, fixed posts, held/resumed conversation, targeted villager popup/directions, army-to-Stables links, actual adult horse purchase/payment/ownership/insufficient funds, and whole-garrison activation after a guard hit. Existing animal suite passed (horse buying/riding included). All 35 smoke checks passed. TypeScript and production builds passed. The smoke suite exposed keep-anchor relocation on region save/load; region-world loads now retain generation-resolved footprints, while older non-region saves still receive the legacy footprint migration.

Apply this update to existing worlds by refreshing/reloading the game. New guard posts are prepared once when their town activates, including loaded active towns. Live visual verification was not performed in this task.


## Generator 15 — researched town variation and new artwork

shared/src/organicTowns.ts caches deterministic composed templates by ID: region-city-W-H-V-organic, V 0-29 (culture=floor(V/10), grammar=V%10). Fixed regional sockets join bent internal streets. Closed cardinal wall chains vary their curvature and bulges. The five civic services, blacksmith, tailor and barn are real building references; bloomery/charcoal/carpentry, farm plots, orchard and pasture use existing entities. Houses use nonuniform seed-ranked plots. Each doorway gets a connected road at template creation; there is no added per-resident routing cost. Commons reserve space from infill; civic services prefer market, farm, gate or church-close positions.

Generator 15 preserves generator 12/13/14 IDs and regeneration paths. Saves retain their original layouts and base versions. Fresh world plans select 30 organic choices without changing the previously requested city-size quota or chunk separation. Do not restamp existing towns automatically: player state and saved layouts are preserved.

Twelve new house PNGs (four per culture) and four road surface PNGs live under client/public/sprites/towns-v2. They were produced with the built-in image generation tool, sliced to aligned transparent 192x192 house frames, with four 128x128 road materials. Sources, slicing manifest and complete prompts are saved in the Windows workspace outputs/town-variations. Assets are included by the existing atlas packer and optional art loader.

SiteSnapshot.townStyle derives from the existing saved behaviour profile. It selects artwork for uncaptured neutral town houses; captured/custom player homes retain their existing design system. Damage artwork remains in use when buildings are damaged. Road textures preserve source colours and use cached rounded cardinal masks, varying surface orientation by a stable five-cell patch. Dirt, gravel, cobble and limestone-sett surfaces share proper gate connectivity. No extra live entities or AI were introduced.


See docs/medieval-towns-v15.md for historical sources and verification details.


Generator 16: -organic2 templates move industry inside walls, reserve a paved 5x3 town square and increase outside farming. Tile/slate houses scale to visible bounds at 2.35 tile widths. Existing organic IDs are preserved for saved worlds. See docs/medieval-towns-v15.md.


Generator 17: organic3 adds grouped fields, orchard rows, a separate fenced real NPC animal zone, trees, lights, square stalls and an interactable town quest board. New stone/slate smithy and charcoal clamp sprites replace stand-ins. See docs/medieval-towns-v15.md.
