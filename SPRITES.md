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

**Bandit (Encampment guardian):** three purely cosmetic looks for the one `bandit` MobKind, picked
per mob client-side by a stable hash of its id (`MOB_VARIANT_URLS` in `client/src/main.ts`), each
with walk + attack frames:
- Masked axe bandit: `bandit.png` (static/idle), `banditWalk0-3`, `banditAttack0-2`.
- Hooded clubman: `banditClubmanWalk0-4`, `banditClubmanAttack0-3` (idle = first walk frame).
- Hooded archer: `banditArcherWalk0-3`, `banditArcherAttack0-2`. The source sheet was inconsistent
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

**Placeholder reuse:** Ward Stone renders cross until its own art exists (part 8).

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

---

## Outstanding — with ready-to-use prompts

### 3. Monster animations (walk + attack cycle, one image each)

Same combined-block pattern as the colonist walk/attack sheets (one image per kind, walk row +
attack row), each referencing its own already-made static sprite for consistency. Once sourced, wire
it up like the bandit variants (`MOB_VARIANT_URLS` in `client/src/main.ts`), which already infer
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

### 5. UI resource icons (one batched sheet)

> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, small and simple enough to read clearly at 16-20px display size. One icon each for: a wood log, an iron ingot, a rock/stone chunk, a gold coin, a wheat sheaf (grain), a cut of meat, a piece of fruit, a wool tuft, a cotton boll, a folded cloth (clothes), a hammer/wrench (tools), a gem (luxury items), a foaming mug (alcohol). Arrange as a clean grid, each icon on its own transparent square, consistent scale and outline weight across all of them. Clean PNG with transparency.

### 6. Combat effects (one batched sheet)

> Pixel art game effect sprite sheet, chunky 16-bit retro style, thick black outline where appropriate, bright saturated colors (effects should pop against the muted character/terrain palette). Include: a melee slash arc (a curved white/yellow swipe), an impact spark/hit flash (a small burst of light), a death poof (a dissipating grey cloud), and a simple arrow in flight (brown shaft, grey head, white fletching) viewed side-on. Each on its own transparent square, consistent scale. Clean PNG with transparency.

### 7. Farm Plot growth states (one batched sheet, 2 frames)

> Pixel art top-down/angled farm plot tile, chunky 16-bit retro style, thick black outline, matching the exact style and scale of the existing Farm Plot tile sprite you already made for me. Two versions side by side: "Growing" — tilled soil with small green sprouts just emerging in rows, and "Ready to Harvest" — the same plot with full, mature crop rows ready to cut. Transparent background, clean PNG.

### 8. Ward Stone — new dedicated building art (currently a placeholder reusing cross.png)

> Pixel art building tile sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A Ward Stone: a single waist-to-shoulder-height standing stone marker, a squat tapering grey obelisk on a small square plinth, its faces carved with rows of small runic ward-script and a simple sunburst/vigil-flame sigil at the top, the carved grooves faintly glowing pale gold. A few melted candle stubs and a little scattered wax at its base, as if someone has kept watch beside it for a long time. Should read as consecrated and protective, not pagan or menacing — clearly kin to the existing Church and cross art. Single static object, slight 3/4 top-down angle, centered in frame, transparent background, no ground shadow. Match the exact art style, outline weight, color palette and building scale of the existing Church and cross sprites you already made for me (smaller than the Church, a little taller than the cross). Clean PNG with transparency.

---

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
