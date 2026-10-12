# colony2d Sprite & Animation Tracker

> **Standing rule:** whenever a new character, unit, monster, building, or decorative object is
> added to the game, add it to this file — both to the "Already sourced" inventory once art
> exists, and to "Outstanding" (with a ready-to-use prompt) if it doesn't yet. This file should
> always reflect the true current state of game art, not just what existed when it was written.

All art is generated externally (ChatGPT image generation) and dropped into
`client/public/sprites/`. Style convention throughout: chunky 16-bit pixel art, thick black
outline, flat cel-shaded coloring, transparent background. There's no fixed pixel scale — raw
source image sizes vary and get normalized in code (`COLONIST_SPRITE_HEIGHT`,
`PLAYER_SPRITE_HEIGHT`, per-kind `MOB_VISUALS` sizing, the building-tier box-fit scaling in
`setTileSprite`) — so every prompt below anchors scale by saying "match the existing sprite"
rather than giving a pixel number.

---

## Already sourced (in `client/public/sprites/`)

**Colonists (static pose, 12):** lumberjack, farmer, knight, archer, ironMiner, rockMiner, bishop,
farmhand, artisan, militia, spearman, pikeman.

**Player:** player.png (mounted knight on horse, recolored per-player via a hue-shift shader on
the banner/barding).

**Monsters (static pose, 10):** goblin, wolf, goblinCrossbow, orc, skeleton, armoredOrc,
giantSpider, darkShaman, troll, ogre.

**Bandits (Encampment guardians, 3 MobKinds):** each kind has one fixed look with walk + attack
frames (`MOB_VARIANT_URLS` in `client/src/main.ts`). Encampments pick among them 5:3:1
(`ENCAMPMENT_GUARDIAN_WEIGHTS` in `server/src/index.ts`):
- `banditClubman` (melee, the rank-and-file guard), hooded clubman: `banditClubmanWalk0-4`,
  `banditClubmanAttack0-3` (idle = first walk frame).
- `banditElite` (melee mini-boss, rendered ~1.45x a regular bandit), masked axe bandit:
  `bandit.png` (static/idle), `banditWalk0-3`, `banditAttack0-2`.
- `banditArcher` (ranged, fires arrows), hooded archer: `banditArcherWalk0-3`, `banditArcherAttack0-2`. The source sheet was inconsistent
  (Walk0-1 hold a club, Attack1 is a spear throw), so the game only plays the bow frames: walk =
  Walk2 + Attack0, attack = Attack0 → Walk3 (arrow loosed) → Attack2. Walk0-1 and Attack1 are kept
  on disk but unused.

**Half-Latch (static pose, 5 variants):** `halfLatch0-4.png`: the same wisp-like shadow sliver in
five tints (charcoal, slate blue, violet, green, grey), picked per mob by a stable id hash.

**Buildings (30, all tiers):** woodWall, stoneWall, barracks, castleLv2, castleLv3, archeryRange,
archerTower, militiaCamp, militiaCamp2, militiaCamp3, cottage, bigCottage, cottageLv2, church,
lumberjackPost, farmPlot, barn, pasture, orchard, sheepPasture, hempField, ironMine, quarry,
tailorShop, blacksmith, jewelersWorkshop, brewery, bazaar, tradingPost, tavern.

**Environment / ground:** tree, rock, ironOre (+ ironOre2, ironOre3 variants), grassFloor1,
grassFloor2, hillsFloor, swampFloor, waterTile, dirtFloor, darkDirtFloor, sandFloor, snowFloor,
marshFloor, lavaFloor, voidFloor.

**Ruins decoration props:** bridge, stoneArch, ruinWall1, ruinWall2, statue, rubble.

**Encampment decoration props:** campfire, cart, barrel, crate, fence, cross, lanternPost, banner,
gravestone, gravestone2.

**Decorative nature scatter:** tallGrass, flowers1, bush3.

**Saint Wren's Abbey (world-gen landmark):** the hall is the dedicated `abbeyHall.png` (long stone
nave + bell tower, rendered at 2x the box fit), surrounded by existing statue, fence, cross,
lanternPost props.

**Ward Stone:** dedicated `wardStone.png` (carved grey obelisk with a gold sunburst, rune grooves
and candle stubs at the base). Keeps the existing 0.75 size factor, which renders it ~44px tall:
smaller than the Church (~53px), a little taller than the cross prop (~38px).

**Farm Plot growth states:** `farmPlotGrowing.png` (sprouts in tilled rows) and `farmPlotReady.png`
(mature golden wheat), driven by real server state. Each snapshot carries `readyFarmPlots` (the tile
indices of plots in the server's `"harvesting"` state), and the client swaps the tile texture
whenever a plot enters or leaves that set. With a staffed Barn, a plot shows sprouts for ~8s, then
ripe wheat for the ~2s harvest. A plot whose Barn is unstaffed or missing freezes on whichever art
it was showing. The original `farmPlot.png` is still on disk but no longer referenced.

**UI resource icons (13):** `icon-wood`, `icon-iron`, `icon-rock`, `icon-gold`, `icon-grain`,
`icon-meat`, `icon-fruit`, `icon-wool`, `icon-cotton`, `icon-clothes`, `icon-tools`,
`icon-luxuryItems`, `icon-alcohol`. They are shown at 15px (`.econ-icon`) before each label in
the Colony panel: the core-stats rows in `client/index.html` and the goods rows that
`GOODS_GROUPS` builds in `main.ts`. The Market / Gold Shop buttons still use text only.

**Combat effects (4):** `fx-slash`, `fx-spark`, `fx-poof`, `fx-arrow`, all client-side and
visual-only (the `activeEffects` system in `main.ts`):
- Melee hits (knight/militia line, melee mobs, and the player's own attack) flash a slash rotated
  along the attack direction at the target for 160ms. `AttackEffect` gained an optional `melee`
  flag, and the server now emits an effect for melee hits too. Before this, only ranged attacks
  produced one.
- Ranged attacks (archers, archer towers, goblin crossbowmen, bandit archers) fire an arrow that
  flies from attacker to target (60-260ms depending on distance) and ends in a small spark. A Dark
  Shaman instead fires a purple-tinted spark "bolt", detected client-side by matching the effect's
  origin to a darkShaman mob's position, since effects don't carry the attacker's kind.
- A grey poof (420ms, swelling, drifting up, fading) plays wherever a visible mob or colonist
  disappears from the snapshot. That also covers non-death removals, such as a worker dismissed
  when their post is demolished. It doesn't play for workers hidden inside their post, or for the
  mass wipe on a welcome/restart.

**Animations (one PNG per frame, `<kind><Cycle><n>.png`), all 12 colonist kinds:**
- Soldiers, walk + attack: knight (4 + 4), archer (4 + 6), militia, spearman, pikeman (4 + 3 each).
- Workers, walk + work cycle (4 + 3 each): lumberjack (`Chop`), farmer (`Harvest`), ironMiner and
  rockMiner (`Mine`), bishop (`Heal`), farmhand (`Tend`), artisan (`Craft`).
- Every row from this batch was normalized at extraction onto one shared canvas per row (feet on
  the bottom edge, centered on the body's mass centroid). The client renders each set at one
  constant scale with feet-pinned anchors, so bodies don't resize as weapons swing out.
- Source fixes: pikemanWalk1/3 had no pike in the source sheet, so frame 3's pike was grafted on.
  The neutral source frame (pike in the other hand) was dropped, and the cycle is ping-ponged.
  pikemanAttack2 still shows a stray second pike from the source.
- Militia/Spearman/Pikeman share one scale (derived from Militia's own un-inflated walk canvas,
  not each kind's own) since Pikeman/Spearman's raised polearm otherwise inflates their walk
  canvas height and under-scales their body.
- Idle (standing still) reuses each set's own walk-frame 0, not a separate static pose texture —
  using the independently-extracted static PNG there caused a visible size pop on every
  idle<->walk/action transition.
- All art is drawn facing right. Every unit, mob, and the player flip horizontally (`applyFacing`
  in `main.ts`) based on net horizontal movement direction, with a small dead zone so vertical-only
  movement doesn't snap back to a default facing.

---

## Outstanding — with ready-to-use prompts

### 3. Monster animations (walk + attack cycle, one image each)

Same combined-block pattern as the colonist walk/attack sheets (one image per kind, walk row +
attack row), each referencing its own already-made static sprite for consistency. Once sourced, wire
it up like the bandits (`MOB_VARIANT_URLS` in `client/src/main.ts`), which already infer
walk/attack client-side. Template (shown for Goblin, repeat per kind):

**Goblin**
> Pixel art monster animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark-fantasy palette. Match the exact art style, outline weight, color palette, and creature scale of the existing Goblin sprite you already made for me (small, scrawny, sickly green skin, ragged brown loincloth, rusty dagger). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame, a menacing scuttling gait. Row 2 "Attack Cycle" — 3 frames: dagger raised, dagger stabbed forward, recovery. Transparent background, clean PNG.

Repeat with the same structure for:
- **Wolf** — 4-legged lunging walk, bite attack
- **Goblin Crossbowman** — walk + draw/aim/fire
- **Orc** — walk + axe swing
- **Skeleton** — shambling walk + sword swing
- **Armoured Orc** — heavy walk + mace swing
- **Giant Spider** — 8-legged skitter + fang lunge
- **Dark Shaman** — float/glide walk + staff cast
- **Troll** — lumbering walk + club smash
- **Ogre** — heavy lumbering walk + huge club smash

### 11. Blood splatter (ground decal, one batched sheet)

For the combat-feedback plan (`ROADMAP.md` §7 Phase 2): a persistent ground stain at a hit/death
location, distinct from the existing `fx-*` effects (which are all short-lived and attached to the
attacker/target/death point, not left behind on the ground). Meant to be stamped onto the floor
layer and cleared the same way a future Gravestone would be (next day-cycle boundary), not faded
out in milliseconds like `fx-poof`.

> Pixel art ground decal sprite sheet, chunky 16-bit retro style, thick black outline where the splatter's edge is crisp, flat cel-shaded coloring, dark saturated red. Four variants of a blood splatter stain, each a different size and spray shape (a small spatter of a few drops, a medium splash with a few trailing droplets, a larger irregular pool, and an asymmetric directional spray as if flung sideways), each viewed top-down/angled to sit flat on the ground like the existing Farm Plot or floor tiles. Each on its own transparent square, consistent canvas scale across all four so any one can be picked at random. No outline around the whole square, only around the stain's own silhouette. Clean PNG with transparency.

Once sourced, extract the 4 variants (e.g. `bloodSplatter0-3.png`) and wire into `client/src/main.ts`:
stamp one (random variant, slight random rotation) into the floor/decor layer at a hit location
(reuse the melee-hit `AttackEffect` the combat-VFX work already added) and/or a death location,
and clear it at the same day-cycle boundary a future Gravestone feature would use.

### 12. Town Center — new dedicated building art (currently hand-drawn, not a sprite)

The Town Center is the one building left entirely without sourced art — it's drawn procedurally in
`drawTile()`/`gridGraphics` in `client/src/main.ts` (a grey stone keep wider than one tile, two
flanking towers, a crenellated roofline, a door, and a tall red-and-gold banner towering well above
the roof — see that function for the exact current shapes/colors if useful as a reference for what
to match or deliberately improve on).

> Pixel art building tile sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette matching the existing building roster (see Barracks, Castle Lv2/3, Church for reference). The colony's Town Center: a grand stone keep, noticeably wider than a single building tile, with two flanking corner towers, a crenellated roofline, a heavy wooden door at ground level, and — most importantly — a single tall banner pole rising well above the roofline flying a large, unmistakable red-and-gold banner, clearly the tallest and most prominent silhouette in the building roster so it reads instantly as the colony's seat from across the map. Single static building, slight 3/4 top-down angle, centered in frame, transparent background, no ground shadow. Clean PNG with transparency.

Once sourced, extract as `townCenter.png`, add `TileType.TownCenter` to `TILE_SPRITE_FILES` in
`main.ts`, and remove the `TileType.TownCenter` case from `drawTile()`/`gridGraphics` (along with
the now-dead "gridGraphics only draws Town Center" comments it leaves behind).

## Notes on process

- One generation per image block, not one frame per generation — frame-to-frame consistency
  (scale, proportions, camera angle) only holds up if related frames are generated together in a
  single image, same as the Knight/Archer animation sheets.
- Always point a new prompt at an existing sprite for the same character/kind when one exists —
  "match the existing X sprite" is the actual scale and style anchor, since there's no numeric
  pixel scale shared across prompts.
- After cropping/isolating new art, it goes in `client/public/sprites/` and gets wired into
  `client/src/main.ts` (and, for anything with gameplay meaning — new unit kinds, new tile types —
  `server/src/index.ts` and both `protocol.ts` copies).
