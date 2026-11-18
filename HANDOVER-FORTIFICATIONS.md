# Farms, crafting and fortifications — 18 November 2026

## Scope and implementation
1. Audit inventory and build icons; add matching transparent artwork.
2. Check every existing crop state and render animal-zone boundaries.
3. Add tile-wide ramparts, access ladders, two-cell gates and drawbridges in both axes.
4. Verify construction, collision, combat, persistence and browser rendering before backed-up deployment.

## Using the additions
- Build > Combat: Rampart, Wall Ladder, Large Gate H/V and Wide Drawbridge H/V.
- A rampart occupies one entire tile. Place a ladder beside it, or enter via a large gate. Units can travel between connected ramparts and across the large gate deck, including when its ground-level doors are locked.
- H spans two columns; V spans two rows. Both cells must be clear. A wide drawbridge needs two moat cells. Lock, damage, repair and demolish either half as one structure. Destruction/cancellation restores the moat beneath bridges.
- Build > Zones > Animal area: paint grazing land beside an animal building. Small rails follow horizontal and vertical outside edges, with one access opening. The existing animal purchase, keeper, feeding, watering, breeding and production systems remain in use. Animals grazing within an area cannot take shortcuts outside it; fleeing and returning home remain possible. These are grazing boundaries, not combat barricades.
- Craft lists hand recipes and automatic workstation recipes, each with an icon and ingredients, searchable by recipe/workstation. Progression shows illustrated steps and requirements.
- Both currently playable crops (wheat and hemp) have tilled, sown, growing and ripe states, including watered variants. Legacy wheat/hemp field stage mappings remain supported. No new crop economy was invented.

## Art and implementation
52 new transparent assets, from three grouped source sheets in art-sources/fortifications-20261118. Run `node art-sources/fortifications-20261118/slice-art.mjs --ramparts`, then `node scripts/pack-atlas.mjs` to reproduce the exports/atlas.
16 rampart masks use N=1/E=2/S=4/W=8. Existing wall/window/door/gate joins and moat/bridge joins share the same connection rules. Terrain remains aligned with X/Y axes.
New TileType IDs 136–145 are append-only. Paired pieces use fixed orientation and an anchor/part link; no save-format migration is required. Rampart movement is checked in pathfinding, player collision, direct unit movement and body separation. The deck is a tile-based elevation abstraction, not two independently occupiable floors on one tile.

## Validation
- Client/server TypeScript checks and production build.
- New isolated fortifications suite: placement, blocked-footprint atomicity, H/V pairs, ladder access, wall-side collision, closed gate deck crossing, locks through either half, destruction, normal unfinished construction cancellation, save/load.
- Existing animals, zones, progression, structures, gates/walls and moat suites. The moat test needed its independent scenario restored: the preceding ram fast-forward had already destroyed its target house. No assertions were removed.
- Browser checks: all 31 progression item icons, all build tool icons, recipe search, progression panel, 96 connection-mask combinations, actual keyboard ladder ascent and wall collision, rectangular/irregular/erased fences, all 16 wet/dry growing-zone crop combinations, no uncaught errors.
- PNG/atlas audit covers all 4,616 sprite files: valid/nonempty, all planned paths present and exact atlas pixels.

Deployment backs up live code and saves before gracefully restarting the frozen live copy. Browser test worlds use private ports and temporary saves; the player's world is never used as a test fixture.
