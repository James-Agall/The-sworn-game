# Home interiors and settlement artwork — 18 November 2026

## Player features
Enter an owned house or hall and choose **Decorate home**. Select one of ten styles: hill burrow, cottage, townhouse, longhouse, hunting lodge, farmhouse, watchtower, manor, gatehouse or keep. Changing style resets furnishings but preserves chest inventory. Choose floor/wall materials, furniture and its facing; click the room to place or remove items. Exit routes and access to furnishings must remain clear.

The styles redesign the existing prefab home interior and exterior; they do not grant new defensive stats. Ten matching modular house blueprints are also available through the existing building template system. Upper storeys retain their existing layouts.

Click nearby interior chests or use the existing interaction control. Owned modular chests outside use E and the storage dialogue. Inventory transfers retain carrying limits and recheck range and ownership. Home designs and chest inventory persist in saves.

## Art and templates
90 new transparent sprites: 10 exteriors, 32 directional furnishings including open chests, and 48 walk frames for four adult NPC appearances. Existing room templates share the redesigned furnishing renderer, consistent floor material, wall backing and corrected facing. Beds and wardrobes retain aspect ratio when spanning tiles.

Audited all 28 bandit camp and 25 settlement templates. Added missing camp watch/storage props and settlement storage where validated empty ground allowed it. Existing prop art is reused. Template changes affect newly generated or stamped sites, not already built settlements. Stronger camps are excluded from the beginner camp ring.

Source atlases were generated with the built-in image generation tool using existing game artwork as reference. Sources, slicer and template audit are in art-sources/interior-redesign-20261118. Run its slice.mjs from any directory, then scripts/pack-atlas.mjs to rebuild the atlas.

## Verification
Client and server TypeScript checks; production build; interiors, building-templates, settlement-templates, camp-templates and new home-design server tests. Browser checks cover all ten styles, materials, facing, furniture placement, blocked exits, interior/world chest storage, save/load and all 90 PNGs decoding. Tests use isolated ports and saves.


## Revision: furnished homes and sprite settlements
All ten default homes now group furniture by purpose, with sleeping areas, dining, themed storage, workshop / armoury pieces and floor accents. Existing user-placed furniture is retained; choosing the same base again applies its new furnishing preset. Plain house interiors now use a furnished preset matching the exterior house style.

Blueprint placement and the creative building editor entry are disabled. Building template source data remains for save compatibility. All 25 settlement layouts use prefab sprite anchors with connected branching roads, varied setbacks, trees, small crop patches and shared activity areas. Riverside, hillside and moat identities remain. The legacy forced-variant test hook still selects old room layouts for collision regression coverage.

On loading a save, neutral settlement buildings are converted only when the old template tiles match exactly. Captured, damaged or edited sites are preserved. Conversion keeps the site identity, keep, stock, quests and NPC home assignments and is idempotent. Previously generated sites retain their old roads; new settlement geography applies to new worlds.

Verification: all 25 layouts and allowed transforms validate; prefab entrances, villagers, trade and quests pass the settlement suite. Migration tested in all 8 orientations plus idempotence and preservation of edited/captured sites. Default furnished houses and all ten custom bases pass home storage/save tests. Production browser previews cover all ten bases and three settlement tiers.


## Keep scale and footprint
New buildable Keeps occupy a 3x3 tile footprint. Their artwork is fitted to three tiles wide, with the door at the centre of the south edge. Clicking/damaging/demolishing any part resolves to the anchor; construction reserves all nine tiles. Infantry and hero hearth attacks use the closest footprint point, and siege splash uses the same bounds. Ruined site keeps retain their parts; rebuilding a ruin into an outpost clears those parts before creating the Town Center.

Existing Keep / SiteKeep / RuinedKeep anchors expand on load or world generation only when a clear unoccupied 3x3 area and doorway are available. Neighbouring structures, roads and resources are never overwritten. Captured sites and cramped legacy keeps remain compact. HP and upgrade levels are preserved. This affects actual keep buildings; the house decorator's keep-style facade remains a house style, without granting defensive stats or altering its house footprint.

Tests: keep-footprints suite checks placement refusal, nine-tile collision, entrance/exit, save/load, outer-tile damage and demolition, construction cancellation and legacy expansion preserving HP. Interiors, fortifications and settlement template regression suites pass. Comparison gallery captures all ten default interiors against their exterior sprite artwork.


## Cosy wall / larger-building revision
Keep art is now 4.5 tiles wide, exactly 50% wider than the previous 3-tile rendering. New keep footprints reserve 5x5 whole grid tiles; old 3x3 keeps remain valid when safe expansion is blocked. Hall of the Sworn (KnightPost and both castle tiers) now occupies 3x3 with enlarged artwork. The safe-expansion helper preserves HP/levels and treats these halls as expandable buildings too.

House interiors use 12 new transparent timber-wall assets inspired by the supplied room reference: warm vertical panels, windows and pictures, framed plaster and cutaway trim. Wood floors run vertically. Small home presets gain bedroom partitions while existing custom furniture on those cells is preserved. Materials, furnishings and paths remain editable/validated.

Source atlas and reproducible slicing are under art-sources/cozy-walls-20261118. Tests cover 5x5 keeps, 3x3 hall placement and tier upgrades, old keep compatibility, entrances, pathfinding, outer-part damage/demolition, construction cancellation and save/load.

Stone material now uses an additional 8 transparent masonry sprites with recessed windows, framed pictures and stone cutaway rails, rather than plaster. Select Stone in Decorate home to apply it. The choice remains saved through the existing wall-material field.


## All-interior refresh (2026-11-18)
All nine interior categories and their upper floors now share the warm timber / stone cutaway renderer and vertical timber flooring. The ten furnished player-base presets use the same wall treatment. Public rooms gain up to six type-specific wall-side furnishings, admitted only if every floor tile, exit, furniture approach and NPC slot remains reachable. Upper rooms gain bedroom storage, lamps and rugs. Existing custom home designs and chest contents are preserved.

Opened blocked counter-side routes in tavern, smithy and shop templates, adjusted bakery/barn access, and moved the great-hall corner chest into an accessible position. The level-one Hall of the Sworn (KnightPost) now has the hall interior entrance, matching its upgraded tiers.

Verification: client/server type checks, production build, interior-refresh (108 combinations of type/level/variant/storey, access, facing and determinism), interiors and home-design suites. Production browser checks cover all nine room categories, all ten home styles, material/furniture editing, chests and save/load with no browser errors or missing images. Refresh uses existing generated wall/furniture assets; no new image generation is needed. Default rooms rebuild on entry after restart; saved custom furniture is never reset.


## In-game menu reformat (2026-11-18)
Applied the twelve annotated menu requests. Parchment treatment is shared by in-game panels and the character sheet; the top-right action strip is a stone tablet. Colony status, strategy, pause and time controls now live in an independent top-left bar. The former Colony drawer is Stockpile; equipment totals moved into the renamed Armoury group, retaining its fold preference. Next steps and Progression are within the top-right tablet. Hero controls clear the open Stockpile drawer, and tools sit at the bottom.

Progression and crafting share one dialog with two pages; search, recipes, keyboard shortcut Shift+C, Escape, chain states and live updates reuse their existing handlers. The duplicate top-level Craft/Hero buttons are hidden; the hero block's Pack opens the complete existing character/equipment/appearance/family sheet. Backquote and hero interactions remain available.

Verification: client typecheck, production build and isolated browser checks for all moved controls, folding Stockpile while keeping status visible, Pack/character access, merged progression/crafting pages, search, Escape and Shift+C. Desktop layout checks cover widths 2782, 1440 and 1000; no browser exceptions or missing sprite requests. No gameplay or save-format changes.
