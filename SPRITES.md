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

**Monsters (10 kinds, walk + attack animated):** goblin, wolf, goblinCrossbow, orc, skeleton,
armoredOrc, giantSpider, darkShaman, troll, ogre. Each kind has `<kind>Walk0-3` + `<kind>Attack0-2`
(70 PNGs), wired as a one-look entry in `MOB_VARIANT_URLS` in `client/src/main.ts`, so they use the
bandits' client-side walk/attack inference. The static `<kind>.png` files stay on disk as the
fallback texture only.
- Sources (in `art-sources/`): `Pixel Art Monster Sprite Sheets.png` (goblin, wolf, crossbowman,
  orc), `Pixel Fantasy Monster Animation Sprite Sheet.png` (skeleton, armoured orc, giant spider,
  dark shaman), `Pixel Art Troll and Ogre Cycles.png` (troll, ogre). All three sheets are drawn
  facing right, so no frames were mirrored.
- Extraction: the first sheet carries a real silhouette alpha, which was used directly. The other two
  are opaque, so their dark vignette backgrounds were flood-filled away from the border, stopping at
  the black outline. Outline gaps that leaked into dark-shaded interiors were re-filled. Label pills
  and the grid divider lines were dropped. Detached frame parts stay with their frame: the
  crossbow bolt, the troll and ogre debris, and the Dark Shaman's orb glow. Each row is normalized
  onto one shared canvas with the same convention as the colonist sets: feet on the bottom edge,
  centered on the mass centroid.
- Ranged kinds play their attack cycle at stand-off range (`MOB_ATTACK_ANIM_RANGE_OVERRIDES_PX`).
  That is goblinCrossbow at `TILE_SIZE * 4 + 16` and darkShaman at `TILE_SIZE * 5 + 16`, each
  matching its server range plus slack, like banditArcher.
- Scale: the set's size is still `radius * MOB_SPRITE_SIZE_PER_RADIUS`. Wolf and giantSpider
  (`MOB_ANIM_FIT_LONGER_SIDE`) fit it along the first walk frame's longer side, as the static
  textures did, so they don't balloon horizontally. Every other kind fits it by height, because a
  walk canvas is widened around the centroid for weapon reach. Rendered body heights land within
  0.93-1.00x of the old static art, from goblin ~23px up to ogre ~51px.

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

**Encampment decoration props:** campfire, cart, barrel, crate, fence, cross, lanternPost, banner.

**Gravestones (transient death markers):** `gravestone.png` and `gravestone2.png`, no longer
unused: every colonist, soldier or monster death drops one (random variant) at the death spot, rendered ~20px tall
(`GRAVESTONE_HEIGHT`) in the ground decoration layer under units. Driven by the snapshot's
`gravestones` list; the server clears them all at the next dawn.

**Decorative nature scatter:** tallGrass, flowers1, bush3.

**Town Center:** dedicated `townCenter.png`, a plaza scene with a ring of timber buildings,
a central statue fountain, market stalls and its own cobble/grass ground patch. It is cut from
`art-sources/Isometric Medieval Landmark Collection.png`. It replaces the old procedural
`drawTile()`/`gridGraphics` keep, and that layer was deleted. It skips the building box fit: it
renders 3.5 tiles wide (`TOWN_CENTER_WIDTH_TILES`, 112x72px), and the anchor
(`TOWN_CENTER_ANCHOR`, 0.51/0.67) puts the patch's diamond center, the statue, on the tile center.
The HP bar sits just above the art's flag, about 54px above the tile center (it used to be 24px).

**Sourced but not wired (design calls pending):**
- `castleKeep.png` (same landmark sheet): a walled castle with four towers and a gatehouse ramp.
  A possible Castle Lv3 look, but it would replace `castleLv3.png` and needs its own size/anchor
  like the Town Center. Its ground patch touches the right edge of the source image.
- `abbeyGrounds.png` (same sheet): the abbey with its fenced graveyard, trees and statues as one
  scene. It would duplicate the props world-gen already places around `abbeyHall.png`, so using it
  means retiring those props for a single multi-tile landmark sprite.
- `gateWood.png` / `gateStone.png` (`art-sources/Wooden and Stone Medieval Gates.png`): a palisade
  gate with two watchtowers, and a stone gatehouse with a portcullis. They need a new buildable
  gate tile type with its own rules (passable for colonists/units, blocking for mobs?) in the
  server and both `protocol.ts` copies.

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

---

## New requests (2026-10-12 batch) — for upcoming phases and polish

Each prompt follows the file's convention: chunky 16-bit pixel art, thick black outline, flat
cel-shaded color, transparent background, one generation per block, and an explicit **scale line**
anchoring size to an existing sprite. Grouped by the feature they unlock.

### Combat feedback & world life

### 13. Player (mounted knight) walk + attack cycle

`player.png` is a single static pose; the player is the only unit that still glides without animating.
The blue banner and horse barding are recolored per player by a hue-shift shader, so keep those parts
a flat saturated blue and everything else (armor, horse, tack) neutral.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, color palette and rider-plus-horse proportions of the existing player.png (armored knight on a grey horse carrying a tall blue banner). **Scale: identical to player.png (the whole mounted figure, banner included, is about 64px tall on screen, roughly 2.3x the height of a foot soldier); keep the horse and rider the same size in every frame.** In one image: Row 1 "Walk Cycle" — 4 frames, same scale and 3/4 camera angle facing right in every frame, horse in a steady walk with a slight rider bob and the banner swaying. Row 2 "Attack Cycle" — 3 frames: lance or sword raised and wound back, strike forward, recovery. Keep the banner flat saturated blue. Transparent background, feet/hooves on the bottom edge of a shared canvas, clean PNG.

### 14. Ward Priest — dedicated sprite + walk/tend cycle

The Ward Priest currently reuses the Church bishop art, so the two are indistinguishable.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A wandering ward-keeper priest, clearly distinct from the existing Bishop sprite (which wears a tall cream-and-gold mitre): plain undyed grey-and-ash robes with a deep hood, a rope belt, a hand lantern with a warm candle glow in one hand and a short iron-shod staff in the other, a few pale wax drips on the sleeve. Humble and weathered, not ceremonial. Match the art style, outline weight and palette of the existing Bishop and Farmhand sprites. **Scale: same body height as the existing colonist sprites (Bishop, Farmer) — about 28px tall on screen; lantern and staff may extend slightly beyond that.** In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle facing right, lantern swinging slightly. Row 2 "Tend Cycle" — 3 frames: kneeling or bending to the stone with the lantern lowered, raising the lantern so its light flares, standing back up. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

### 15. Ogre Warlord — Castle Ruin boss (static + walk + attack + slam)

For Phase 5's boss: "a bigger version of our most powerful mob." Needs its own look, not just an upscaled Ogre.
> Pixel art monster animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark-fantasy palette. A towering ogre warlord, a clear escalation of the existing Ogre sprite (same pinkish-brown skin, bald head, tusks, heavy build): add a jagged iron crown fused into the skull, rusted shoulder plates and a studded iron belt, red war-paint streaks across the face and chest, a tattered dark banner strapped to its back, and a huge spiked iron-and-stone maul. Should read instantly as "the boss". Match the existing Ogre's art style, outline weight and palette. **Scale: the same drawing style as the Ogre, but 1.6x larger in every dimension (the Ogre is about 51px tall on screen, so the Warlord is about 82px tall); keep it identical in size in every frame.** In one image: Row 1 "Walk Cycle" — 4 frames, facing right, a slow heavy stomp. Row 2 "Attack Cycle" — 3 frames: maul raised overhead, slammed down with debris, recovery. Row 3 "Roar" — 3 frames: head back, chest out, a shockwave ring, settle. Plus one centered static idle pose. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

### 16. Hunger-mark sigils (6 icons + 6 ground auras)

For Phase 6's Hunger-marked elites (`my_novel/lore/bestiary.md`). Each mark needs a small glyph shown above the monster plus a faint aura ring decal drawn on the ground under it.
> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, small and simple enough to read at 14-18px display size. Six sinister sigils, each a distinct silhouette and a distinct glowing color so they can be told apart at a glance: **Gorrath** (destruction) — a jagged red-black flame with a shattered blade through it; **Nemri** (trespass) — a hollow doorway with a keyhole, cold teal; **Rux** (false authority) — a smiling theatre mask under a broken crown, sickly yellow; **Morvain** (concealment) — a half-veiled eye that is mostly smoke, violet; **Gunne** (what is lost) — an empty cradle or a single falling tear, pale blue-grey; **Vhorrun** (the unclosed debt) — a loose chain looped around itself, never joined, dull bone-white. Arrange as a clean grid, each on its own transparent square, consistent outline weight. **Scale: each glyph about 18x18px, the same icon scale as the resource icons (icon-wood etc.).** Then a second row of six matching ground-aura ring decals: a flat elliptical glowing ring in the same color with faint matching rune ticks, semi-transparent, drawn as if lying on the ground, each about 56x28px (about 2x as wide as a Troll). Clean PNG with transparency.

### 17. Castle Ruin — large ruined castle POI (Phase 5 objective)

> Pixel art isometric building sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark palette. A collapsed, overgrown ruin of the same grand castle shown in the existing Castle Keep sprite: the central keep with a broken, half-fallen top and exposed floors, two of the corner towers toppled into rubble, cracked curtain walls with big breaches, a sagging gatehouse with a torn dark banner, ivy and weeds on the stone, scattered stone blocks and bone piles in the courtyard, a faint cold green-grey glow in the windows suggesting something lives inside. Dark, menacing, clearly the same architecture as the intact Keep but long abandoned. Include its own ground patch, like the other landmark sprites. Match the exact style, outline weight, color palette and lighting of the existing Castle Keep and Town Center landmark sprites. **Scale: about the same footprint as the Castle Keep landmark (roughly 4-5 tiles wide on screen, far larger than a normal Ruin prop, which is about one tile).** Single static scene, transparent background, clean PNG.

### 18. Gate open / closed / damaged states (for the unwired `gateWood` / `gateStone`)

Only needed once Gates exist as a buildable.
> Pixel art isometric building sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art, proportions and palette of the existing gateWood and gateStone sprites. For EACH of the two gates provide three states, laid out as two rows (wood on top, stone below) with columns "Closed", "Open", "Damaged": Closed = as in the existing sprite; Open = the same gate with the wooden doors swung fully open (or the stone portcullis raised), path clearly visible through it; Damaged = closed but splintered/cracked, a door hanging from one hinge or the portcullis bent, scorch marks. **Scale: identical to the existing gateWood and gateStone sprites in every state (same canvas size and ground patch), so the states can be swapped in place without the building appearing to move.** Transparent background, clean PNG.

### Polish, animation and UI

### 19. Fire and light flicker (campfire, lantern post, torch)

> Pixel art animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, warm saturated flame colors. Match the exact art and scale of the existing campfire.png and lanternPost.png sprites. Three rows, each 4 frames of a looping flicker, same canvas and camera angle in every frame so only the flame/glow changes: Row 1 the campfire (ring of stones, flames licking up and shifting), Row 2 the lantern post (lantern flame wavering, a faint glow), Row 3 a wall torch (a new small prop: iron bracket with a flaming torch, the same style) for gates and castle walls. **Scale: campfire and lantern post identical to their existing sprites (about one tile wide on screen); the torch about 12x24px.** Transparent background, clean PNG.

### 20. Water ripple (4-frame tile loop)

> Pixel art tile animation, chunky 16-bit retro style, flat cel-shaded coloring. Match the exact style and size of the existing waterTile.png (a flat top-down/angled water tile). Four frames of a seamless looping ripple: subtle lighter-blue highlight lines and a few tiny sparkles shifting position each frame, base color unchanged, edges identical in every frame so adjacent tiles never show seams. **Scale: each frame exactly the same canvas size as waterTile.png (one tile).** Arranged in a single row, clean PNG.

### 21. Event toast icons (6)

For the Phase 2 notification feed, one small icon per event category.
> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, readable at 16px. Same style, outline weight and polish as the existing resource icons (icon-wood, icon-gold, icon-tools). Six icons: **night** — a crescent moon with a star; **dawn** — a low sun rising over a horizon line; **upgrade** — a hammer over an upward arrow; **death** — a small gravestone with a cross; **ward** — a standing stone with a glowing rune; **deserter** — a torn banner dragged on the ground. Each on its own transparent square, consistent scale. **Scale: each icon about 16x16px, the same as the existing resource icons.** Clean PNG with transparency.

### 22. Stance and order icons (3 stances + 3 cursors)

For the stance HUD line (Defensive / Normal / Aggressive, keys Z / X / E) and command cursors.
> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, readable at 16px, matching the existing resource icons. Row 1, three stance icons: **Defensive** — a heater shield; **Normal** — a plain sword point-up; **Aggressive** — two crossed swords with a small flame. Row 2, three cursor icons about 24px: **Move** — a boot print / chevron arrow; **Attack** — a sword with a small red target ring; **Rally** — a small blue pennant on a pole. **Scale: stance icons 16x16px (same as the resource icons); cursors 24x24px.** Each on its own transparent square. Clean PNG with transparency.

### 23. Ambient wildlife (deer, crow, frog)

Small non-hostile decoration that makes the map feel alive; wanders, never attacks.
> Pixel art animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted natural palette matching the grass and swamp floor tiles. Three creatures, each with a short loop, all facing right and sharing one canvas per row with feet on the bottom edge: a **deer** (4-frame walk, plus 2-frame head-down graze), a **crow** (4-frame flap), a **frog** (a 3-frame hop). Match the existing monster roster's outline weight and desaturated palette, but friendlier and calm. **Scale: the deer about 22px long, comparable to the Wolf (about 24px wide on screen); the crow about 8px; the frog about 6px.** Transparent background, clean PNG.

### 24. Wound overlays (for the future visual-health system)

For the "bleed and armor deteriorates with health" feature: drawn over any unit sprite as health drops.
> Pixel art overlay decal sheet, chunky 16-bit retro style, flat cel-shaded coloring, transparent background. Three escalating wound overlays sized to sit on a small humanoid unit sprite: **Light** — two or three small dark-red scratches and a few drops; **Bleeding** — a dark-red stain across the torso with drips running down; **Heavy** — a large dark-red stain, torn cloth edges and several spatters. Semi-transparent in the middle, crisp dark edges, no outline around the whole square. **Scale: each overlay 28x28px, the same height as a colonist sprite (28px), so it can be centered directly on a unit; also provide a 2x larger version of each (56x56px) for big monsters like the Troll and Ogre.** Clean PNG with transparency.

### 25. Battered-armor variants (Knight, Pikeman, Armoured Orc — static)

Also for visual health: the armored units show dents and missing plates at low health.
> Pixel art character sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring. Three static pose pairs, each a "Pristine" next to a "Battered" version: the **Knight** (grey plate, helm, round shield, sword), the **Pikeman** (full plate with red plume, long pike) and the **Armoured Orc** (spiked iron plate, spiked mace). The Battered version keeps the exact same pose, proportions and palette but shows dented, scratched and cracked plates, a missing shoulder plate or a snapped plume, and scuffs of dirt and dried blood. Match the exact style, outline weight and palette of the existing sprites for each. **Scale: identical to the existing Knight, Pikeman and Armoured Orc sprites (the colonists about 28px tall on screen, the Armoured Orc about 36px); the Battered version must have the same canvas size and body position as its Pristine twin so the two can be swapped in place.** Transparent background, clean PNG.

### 26. Gameplay VFX sheet 2 (build, upgrade, heal, poison, ward)

Extends the combat-effects sheet (`fx-slash/spark/poof/arrow`) to the systems that landed since.
> Pixel art game effect sprite sheet, chunky 16-bit retro style, bright saturated colors that pop against the muted terrain, thick black outline where appropriate. Match the style, outline weight and polish of the existing fx-slash, fx-spark and fx-poof sprites. Each effect as a short animation, 4 frames in a row, same canvas size per effect: **Build** — a puff of tan dust with a few flying wood chips; **Upgrade** — a gold ring of sparkles rising and fading with a small arrow; **Heal** — a soft green-white pulse ring with rising plus signs; **Poison** — a sickly green cloud with bubbles drifting up; **Ward pulse** — a pale gold ring expanding outward with faint rune marks (for a Ward Stone being tended); **Ward lapse** — the same ring flickering, cracking and fading to grey. **Scale: Build/Upgrade/Heal/Poison about 32x32px (one tile, like fx-poof); the Ward pulse and Ward lapse rings about 96x48px, wide enough to read as a flat expanding ring around a stone.** Transparent background, clean PNG.

### 27. Road and path tiles (autotile set) + cobble plaza

For roads between buildings and to blend with the new Town Center plaza art.
> Pixel art ground tile set, chunky 16-bit retro style, flat cel-shaded coloring, matching the exact style, size and palette of the existing dirtFloor.png, grassFloor1.png and sandFloor.png tiles. A dirt road autotile set with grass-blended edges: straight (horizontal and vertical), four corners, four T-junctions, a four-way cross, four dead-ends and a single isolated patch (14 tiles), plus one cobblestone plaza tile with a worn-stone pattern and a matching cobble straight road. All tiles seamless and with matching edge pixels so any neighbors connect cleanly. **Scale: every tile exactly the same size as the existing floor tiles (one tile).** Arranged in a clean labeled grid, transparent corners where the grass shows through, clean PNG.

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
