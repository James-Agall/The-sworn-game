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
