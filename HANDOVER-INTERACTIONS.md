# Indoor spells and practical interactions — 25 November 2026

User direction: adapt the novel's world freely, preserve sandbox play and existing questlines, and defer earned Grace. No novel files changed.

## Shipped behaviour

- Fire indoors had three blockers: client clicks bypassed targeting, the server dispatcher discarded interior spell commands, and spells targeted only overworld actors. Interior clicks now target actual room actors; spell validation, damage, native deaths/rewards, burn/slow/curse and effects use the same room, layer, coordinates and collision map as melee.
- Fire Bolt, Curse, Frost, Thunder, Heal, Ward and Rally Banner support interiors. Range, wall/solid-object sightlines and room boundaries are authoritative; rejected casts consume no cooldown. Summon still requires outdoors and explicitly explains that restriction.
- Interior weapon racks and armour stands offer swords, spears, axes, bows, helmets, body armour and shields. Captured/abandoned stands have finite supplies, friendly households sell theirs, and owned stands withdraw from the existing armoury. Capacity is checked before payment or removal; nearby enemies prevent looting. Equipment uses the native inventory/equip/rendering path.
- Other interior actions: rest at seats and hearths; eat your own provisions at tables; tend owned/captured lights; search abandoned sacks, shelves, wardrobes, barrels and remains; clear loose rubble/webs/growth; pickaxe loose stone/mineral nodes; use native workstations; inspect supports, stairs and fixed architecture. Structural walls remain intact. Existing chests, beds, cages, locks, quest notices and building entrances keep their native systems.
- States persist in the normal save. Clearing updates the same collision map for rendering, hero movement, monster movement and spells. Empty racks and extinguished fixtures have separate drawings rather than sprite tinting. Changing prop type at a coordinate does not inherit another prop's state.
- Eight discoverable world accounts introduce the Vigil, Saint Wren, Sworn/Wardens, ward upkeep, Ashwick, parish care, rival houses and dangerous bargains. They appear in the journal as learned. Existing ten questlines remain; no earned-Grace system or forced novel plot was added.
- Quarry description corrected: grey stone outcrops, stone pickaxe in Stockpile. Mine: ore/deposit, stone pickaxe and built Quarry. Both use the established right-click placement within 2.5 tiles. Invalid ground and excessive distance now give actionable messages; the placement outline warns on wrong ground or range. Settlement ownership messages no longer call all households enemy forts.

## Validation

- `node server/interactions-test.mjs`: native spell/status/LOS/room/cooldown/death checks; finite equipment, ownership/capacity/equipping, prop persistence, lore, collision clearing, full native world save round-trip and real quarry/mine construction rules.
- `npm test -- interior-interactions-wire`: actual WebSocket cast command, room FX, cooldown refusal, rack interaction and dialogue pickup, with existing test hooks only. Also exercised against a separate scratch preview.
- Adventure suite: 40 layouts, 20 boss profiles, 120 actual quest stages, all ten real workstation recipes, saved loot and dormant locations.
- Existing mines, spells, interiors, player-workstations and save-load suites; 35 smoke checks; server/client type checks and production build.
- Browser verified indoor aiming/fire effect, rack dialogue, sword collection and native equipping. Screenshot in workspace `outputs/interactions/collected-sword.jpg`.
- The older save-load suite had timing/random-fixture failures during initial runs. Waiting for process `close` drains shutdown output, and a repeatable seed (`COLONY_WORLD_SEED=42 npm test -- save-load`) passed the full suite, including shutdown autosave.

## Scope and follow-on

This pass primarily covers interior props. Decorative outdoor fixtures are not all interactive yet. Summons remain outdoor-only; seats invoke native rest without a new sitting pose; lights change their fixture art but do not simulate room light propagation. Loose outcrops use saved finite interactions, not a destructible structural-wall system. More book locations/factions/quests can be added incrementally after these mechanics are played.

Private preview additions remain behind `COLONY_TEST_HOOKS`; keep that flag off in live deployments. No remote push.
