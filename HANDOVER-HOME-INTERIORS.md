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
