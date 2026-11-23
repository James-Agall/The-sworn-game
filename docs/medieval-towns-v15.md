# Medieval town variations — generator 15

There are three existing settlement cultures (Hearthmoor, Ironhold, Riverwatch), with ten new street/neighbourhood grammars per culture: Market green, Bending high street, Church close, Forked lanes, Burgage rows, Courtyard clusters, Crescent ward, Twin greens, Gate market, Winding commons. Each supports all four legacy footprints, giving 120 validated templates; new world allocation still uses only 1x1, 1x2 and one 2x2 where space permits.

## Historical references and interpretation

- [English Heritage: Wharram Percy description](https://www.english-heritage.org.uk/visit/places/wharram-percy-deserted-medieval-village/history/description): houses, barns and outbuildings on tofts/crofts; planned rows and less regular plots; cruck-framed longhouses. This informs rural roofs, uneven frontage and open commons.
- [York Archaeological Trust: Medieval Urbanism in Coppergate](https://collections.yorkarchaeologicaltrust.co.uk/s/publications/item/74473): excavated medieval tenement plots and their changing development. This informs narrow street-facing dwellings, service lanes and incremental infill.
- [UNESCO: Provins](https://whc.unesco.org/en/list/873/): merchant houses, storage, outdoor trading spaces, religious buildings and defences linked to fairs. This informs market spaces, church closes and differentiated service areas.

These are design inspirations, not exact reconstructions. Medieval settlements included planned rows and regular streets as well as irregular growth. The game retains cardinal grid collision while rounding the rendered road connectors and varying actual lane geometry.

## Integration

shared/src/organicTowns.ts caches deterministic composed templates by ID: region-city-W-H-V-organic, V 0-29 (culture=floor(V/10), grammar=V%10). Fixed regional sockets join bent internal streets. Closed cardinal wall chains vary their curvature and bulges. The five civic services, blacksmith, tailor and barn are real building references; bloomery/charcoal/carpentry, farm plots, orchard and pasture use existing entities. Houses use nonuniform seed-ranked plots. Each doorway gets a connected road at template creation; there is no added per-resident routing cost. Commons reserve space from infill; civic services prefer market, farm, gate or church-close positions.

Generator 15 preserves generator 12/13/14 IDs and regeneration paths. Saves retain their original layouts and base versions. Fresh world plans select 30 organic choices without changing the previously requested city-size quota or chunk separation. Do not restamp existing towns automatically: player state and saved layouts are preserved.

Twelve new house PNGs (four per culture) and four road surface PNGs live under client/public/sprites/towns-v2. They were produced with the built-in image generation tool, sliced to aligned transparent 192x192 house frames, with four 128x128 road materials. Sources, slicing manifest and complete prompts are saved in the Windows workspace outputs/town-variations. Assets are included by the existing atlas packer and optional art loader.

SiteSnapshot.townStyle derives from the existing saved behaviour profile. It selects artwork for uncaptured neutral town houses; captured/custom player homes retain their existing design system. Damage artwork remains in use when buildings are damaged. Road textures preserve source colours and use cached rounded cardinal masks, varying surface orientation by a stable five-cell patch. Dirt, gravel, cobble and limestone-sett surfaces share proper gate connectivity. No extra live entities or AI were introduced.

## Validation

server/organic-towns-test.ts validates all 120 combinations, unique grammar variants, geometry caching, connected roads/gates, every south-facing doorway, all eight required service buildings, NPC access, farms/trades, fully sealed wall boundaries when gates are closed, and unchanged scarce-city allocation. The region suite additionally checks full world generation, real entities, actual entrance reachability, one settlement identity per chunk and size quotas. Town-life regression verifies cached traffic, guards, conversations and horse buying. Smoke suite covers save/load and core gameplay. TypeScript and production build are checked before deployment.

The comparison sheets render actual template data with the new house/road sprites and existing game assets. They omit moving inhabitants, lighting, renderer effects and clear-ground keep footprint expansion; they are layout previews, not in-game screenshots.

Final checks passed: all 120 composed templates; a 1024-cell world generated 1 large, 2 double and 70 single settlements in 578 ms; region entrances and chunk identities passed; town-life integration passed; all 35 smoke checks passed in 20 seconds; both TypeScript checks and the production build passed. New house interiors are seeded to a compatible existing base for their exterior silhouette.

## Generator 16 revision

New -organic2 layouts move the smithy, tailor, bloomery, charcoal burner and carpentry yard inside the closed wall boundary. They share an inner working quarter. Every town reserves an unobstructed 5x3 paved square and retains connected streets and entrances. The barn sits in the northern agricultural belt, with more real farm plots, orchards and pasture outside the walls. Houses with tile/slate roofs fit their visible opaque bounds at 2.35 tile widths; rural thatched houses use 2 tile widths. Feet remain on the same grid baseline. Existing generator-15 templates remain unchanged for save regeneration. New layout geometry applies to fresh worlds; house scaling applies immediately to existing towns. The test suite covers both old and new layouts (240 combinations), including enclosed industry, squares and expanded external fields.
