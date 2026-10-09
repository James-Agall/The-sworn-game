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

**Saint Wren's Abbey (world-gen landmark, no dedicated art yet):** assembled entirely from art
above — the hall is church (rendered 1.5x), plus statue, fence, cross, lanternPost. See part 9
under Outstanding.

**Placeholder reuse:** Ward Stone renders cross until its own art exists (part 8).

**Animations (walk + attack cycle, combined per-unit image):** knight, archer.

---

## Outstanding — with ready-to-use prompts

### 1. Remaining soldier animations (walk + attack cycle, one image each)

**Militia**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Character: light brown leather tunic, no helmet, holding a simple wooden club. Match the exact art style, outline weight, color palette, and character scale/proportions of the Knight and Archer walk/attack cycle sprite sheets you already made for me. In one image: Row 1 "Walk Cycle" — 4 equally-spaced frames, same scale and camera angle (slight 3/4 angle facing forward) in every frame, frame 1 the neutral standing pose, frames 2-4 a natural walk cycle with legs stepping and a slight body bob. Row 2 "Attack Cycle" — 3 frames, wind-up (club raised back), strike (club swung forward), recovery. Transparent background, no ground shadow, clean PNG.

**Spearman**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Character: leather armor reinforced with iron plates, open-face helmet, holding a spear. Match the exact art style, outline weight, color palette, and character scale/proportions of the Knight and Archer walk/attack cycle sprite sheets you already made for me. In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame, frame 1 neutral standing, frames 2-4 natural walk cycle. Row 2 "Attack Cycle" — 3 frames: spear drawn back for a thrust, spear thrust fully forward, recovery. Transparent background, no ground shadow, clean PNG.

**Pikeman**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Character: full iron plate armor, helmet with a small plume, holding a long pike taller than the character. Match the exact art style, outline weight, color palette, and character scale/proportions of the Knight and Archer walk/attack cycle sprite sheets you already made for me. In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame, frame 1 neutral standing, frames 2-4 natural walk cycle. Row 2 "Attack Cycle" — 3 frames: pike drawn back for a thrust, pike thrust fully forward, recovery. Transparent background, no ground shadow, clean PNG.

### 2. Civilian/worker animations (walk + work-action cycle, one image each)

**Lumberjack**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Lumberjack sprite you already made for me (rolled-sleeve brown tunic, suspenders, axe). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame, frame 1 neutral standing, frames 2-4 natural walk cycle. Row 2 "Chop Cycle" — 3 frames: axe raised overhead, axe swung down into a tree, recovery. Transparent background, clean PNG.

**Farmer**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Farmer sprite you already made for me (straw hat, green tunic, sickle). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame. Row 2 "Harvest Cycle" — 3 frames: sickle raised, sickle swung through crops, recovery. Transparent background, clean PNG.

**Iron Miner**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Iron Miner sprite you already made for me (mining helmet with lamp, pickaxe). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame. Row 2 "Mine Cycle" — 3 frames: pickaxe raised, pickaxe swung into rock, recovery. Transparent background, clean PNG.

**Rock Miner**
> Same as Iron Miner above, but match the existing Rock Miner sprite instead (cooler grey-toned mining gear).

**Bishop**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Bishop sprite you already made for me (cream and gold-trimmed robe, staff). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame. Row 2 "Heal Cycle" — 3 frames: staff raised, a glowing pulse released from the staff tip, recovery. Transparent background, clean PNG.

**Farmhand**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Farmhand sprite you already made for me (wide-brim hat, basket). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame. Row 2 "Tend Cycle" — 3 frames: bending to gather, holding up a gathered item, standing back up. Transparent background, clean PNG.

**Artisan**
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette, and character scale of the existing Artisan sprite you already made for me (dark purple apron, hammer). In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle in every frame. Row 2 "Craft Cycle" — 3 frames: hammer raised, hammer struck down on a workbench, recovery. Transparent background, clean PNG.

### 3. Monster animations (walk + attack cycle, one image each)

Same combined-block pattern as the soldiers above, each referencing its own already-made static
sprite for consistency. Template (shown for Goblin, repeat per kind):

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

### 4. Bandit — new dedicated art (static pose; currently a placeholder reusing militia.png)

> Pixel art character sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark palette. A rough bandit/raider: ragged dark leather, a cloth bandana or hood covering most of the face, holding a crude hand axe or curved dagger. Should read as clearly hostile and distinct from the friendly Militia unit (different silhouette, darker/dirtier color palette, no insignia or banner colors). Single static pose facing forward/slight 3/4 angle, centered in frame, transparent background, no ground shadow. Match the same canvas scale and outline weight as the existing 10-monster roster sheet you made for me. Clean PNG with transparency.

Once the static pose exists, prompt a walk+attack cycle for it the same way as section 3.

### 5. UI resource icons (one batched sheet)

> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, small and simple enough to read clearly at 16-20px display size. One icon each for: a wood log, an iron ingot, a rock/stone chunk, a gold coin, a wheat sheaf (grain), a cut of meat, a piece of fruit, a wool tuft, a cotton boll, a folded cloth (clothes), a hammer/wrench (tools), a gem (luxury items), a foaming mug (alcohol). Arrange as a clean grid, each icon on its own transparent square, consistent scale and outline weight across all of them. Clean PNG with transparency.

### 6. Combat effects (one batched sheet)

> Pixel art game effect sprite sheet, chunky 16-bit retro style, thick black outline where appropriate, bright saturated colors (effects should pop against the muted character/terrain palette). Include: a melee slash arc (a curved white/yellow swipe), an impact spark/hit flash (a small burst of light), a death poof (a dissipating grey cloud), and a simple arrow in flight (brown shaft, grey head, white fletching) viewed side-on. Each on its own transparent square, consistent scale. Clean PNG with transparency.

### 7. Farm Plot growth states (one batched sheet, 2 frames)

> Pixel art top-down/angled farm plot tile, chunky 16-bit retro style, thick black outline, matching the exact style and scale of the existing Farm Plot tile sprite you already made for me. Two versions side by side: "Growing" — tilled soil with small green sprouts just emerging in rows, and "Ready to Harvest" — the same plot with full, mature crop rows ready to cut. Transparent background, clean PNG.

### 8. Ward Stone — new dedicated building art (currently a placeholder reusing cross.png)

> Pixel art building tile sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A Ward Stone: a single waist-to-shoulder-height standing stone marker, a squat tapering grey obelisk on a small square plinth, its faces carved with rows of small runic ward-script and a simple sunburst/vigil-flame sigil at the top, the carved grooves faintly glowing pale gold. A few melted candle stubs and a little scattered wax at its base, as if someone has kept watch beside it for a long time. Should read as consecrated and protective, not pagan or menacing — clearly kin to the existing Church and cross art. Single static object, slight 3/4 top-down angle, centered in frame, transparent background, no ground shadow. Match the exact art style, outline weight, color palette and building scale of the existing Church and cross sprites you already made for me (smaller than the Church, a little taller than the cross). Clean PNG with transparency.

### 9. Saint Wren's Abbey — dedicated architecture (optional; currently assembled from existing art)

> Pixel art building tile sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The main church of a small, old monastic abbey: a long weathered grey-stone nave with a steep slate roof, a squat square bell tower at one end with an open belfry and a single bell, narrow arched windows, a heavy wooden door under a round arch, moss and lichen on the lower courses. Older, plainer and more fortress-like than the existing Church sprite — a working house of a cloistered order, not a village chapel. Single static building, slight 3/4 top-down angle, centered in frame, transparent background, no ground shadow. Match the exact art style, outline weight and color palette of the existing Church sprite you already made for me, but noticeably larger (roughly twice its footprint). Clean PNG with transparency.

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
