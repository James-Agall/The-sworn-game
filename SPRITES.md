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

**Player (walk + attack animated):** `playerWalk0-3` (mounted knight with banner) and
`playerAttack0-1` (lance thrust, no banner), cut from `art-sources/Mounted Knight Pixel Art Sprite
Sheet.png`. Wired as `PLAYER_ANIM_URLS` in `client/src/main.ts`: walk while moving, idle = walk
frame 0, and the thrust plays once on the local Space press or when a melee effect originates at a
player's position (so other players' attacks animate too). Both rows are centered on the horse's
body (bottom 130px), not the banner or lance, so the feet-pinned row swap doesn't hop. The blue
banner/barding hues match the old art (99.8% of blue pixels fully inside the recolor shader's hue
gate), so the per-player hue shift still works. `PLAYER_SPRITE_HEIGHT` went 64 -> 68 so the horse
keeps its old ~40px on-screen width under the taller banner. `player.png` stays as the fallback
if any frame fails to load. `playerIdle.png` (the banner standing frame) is extracted but unused,
per the idle = walk-frame-0 convention.

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

**Fire and water loops (4 frames each):** `campfire0-3`, `lanternPost0-3`, `waterTile0-3`, from
`art-sources/Pixel Art Fire and Water Sprite Sheet.png` (flood-filled off its light vignette; the
water tiles are straight square crops resized to 64x64). Wired via `TILE_ANIM` in `main.ts`: one
shared clock steps every animated tile slot (no per-sprite timers), campfire 140ms/frame, lantern
200ms, water 450ms. Fires are phase-offset per tile by a stable hash; water stays in sync so
neighbours line up. Each loop shares one canvas, so the box-fit scale from frame 0 holds for every
frame. The static `campfire.png`/`lanternPost.png`/`waterTile.png` stay as fallbacks.

**Blood splatters (6):** `bloodSplatter0-5` (small blob, medium splash, large splash, streak, pool,
faded pool), from `art-sources/Pixel Art Blood Splatter Sprite Sheet.png` (saturated-red mask
plus the dark outline hugging it). Client-only: 35% of melee hits stamp a small one (0/1/3, 12px),
and every new gravestone (i.e. every death) stamps a large one (2/4/5, 22px). They sit at 60% alpha
in the bottom of the decor layer, with a random flip. The oldest is dropped past 80, and all are
cleared when the snapshot flips from night to day (the same dawn at which the server clears the
gravestones) and on any welcome/restart.

**Wildlife:** `deerWalk0-3` + `deerGraze0-1` (one shared canvas), `crow0-3` (perch + 3 flap frames),
`frog0-2` (sit, leap, sit), from `art-sources/Pixel Wildlife and Wound Overlay Sheet.png`.
- Deer are no longer client-only: since 2026-10-14 they are real server game (snapshot `wildlife`, see
  "Hunting, foraging and slow farming: stand-ins" below), drawn by `syncWildlife` in `main.ts`: walk
  frames while walking, graze frames while standing, the walk cycle at double speed while fleeing.
- Crows and frogs stay ambient and client-only (`WILDLIFE` in `main.ts`): rolled per client on every
  welcome, frogs on Swamp or next to Water, crows on any Empty tile, counts scaling with the eligible area
  and capped (16/14). They wander near their spawn point and only ever target a tile that is Empty at
  that moment, never reach the server, and have no gameplay effect. Crows flap to a new perch on an arc,
  drawn over everything while flying. Frogs hop with a small arc. All wildlife is depth-sorted in the
  tile layer by the tile it stands on, so buildings in front hide it, and the night overlay dims it.

**Event toast icons (6):** `icon-event-night/dawn/upgrade/death/ward/deserter`, from
`art-sources/Pixel Art Icon Sheet_ Events and Orders.png`, labels masked. Shown at 18px
(`.event-icon`) at the start of each toast in the event feed, picked by the event's category.

**Stance icons (3):** `icon-stance-defensive/normal/aggressive` (same sheet). Shown at 15px in the
"Selected: N · <stance> (Z/X/E)" HUD line when the selection shares one stance. "Mixed" keeps text
only.

**Town Center:** dedicated `townCenter.png`, a plaza scene with a ring of timber buildings,
a central statue fountain, market stalls and its own cobble/grass ground patch. It is cut from
`art-sources/Isometric Medieval Landmark Collection.png`. It replaces the old procedural
`drawTile()`/`gridGraphics` keep, and that layer was deleted. It skips the building box fit: it
renders 3.5 tiles wide (`TOWN_CENTER_WIDTH_TILES`, 112x72px), and the anchor
(`TOWN_CENTER_ANCHOR`, 0.51/0.67) puts the patch's diamond center, the statue, on the tile center.
The HP bar sits just above the art's flag, about 54px above the tile center (it used to be 24px).

**Sourced but not wired (design calls pending):**
- `castleRuin.png` (`art-sources/Isometric Castle Ruin and Gate Sprite Sheet.png`): the Phase 5
  Castle Ruin landmark, a collapsed keep with toppled towers on its own ground patch. Needs its
  own size/anchor like the Town Center when Phase 5 lands.
- `gateWoodClosed/Open/Damaged.png` and `gateStoneClosed/Open/Damaged.png` (same sheet): the full
  state sets for the gates below, cut tight per state (not a shared canvas yet; align them when
  wired). `art-sources/Medieval Gate Sprite Sheet.png` is a second, lower-quality painterly gate
  set and was not extracted.
- `torch0-3.png` (fire/water sheet): a 4-frame wall torch loop. There's no torch prop or wall-mount
  spot yet; it's meant for gates and castle walls.
- `icon-order-move/attack/rally.png` (icon sheet): command icons. No existing UI spot shows them
  (move/attack orders draw a Graphics marker), so they're staged for a future cursor or command bar.
- `playerIdle.png`: see Player above.
- `woundLight/Bleeding/Heavy.png` + `...Large.png`: the source sheet drew the wound overlays as
  pre-baked example units (a front-facing humanoid and ogre), not clean decals. These are just the
  red pixels lifted off those units: rough, front-facing, positioned for that body. They're not good
  enough to overlay on our side-facing units, so they're staged only (prompt #24 still stands).
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

**Farm Plot growth states:** `farmPlot.png` (bare tilled soil), `farmPlotGrowing.png` (sprouts in
tilled rows) and `farmPlotReady.png` (mature golden wheat), driven by real server state. Since slow farming
(2026-10-14) each snapshot carries `readyFarmPlots` (ripe, being harvested), `sownFarmPlots` (the first
third of the 3-day grow) and `fallowFarmPlots` (resting after 5 harvests); any other plot is growing. The
client swaps the tile texture when a plot changes state: sown = `farmPlot.png`, growing =
`farmPlotGrowing.png`, ripe = `farmPlotReady.png`, fallow = `farmPlot.png` tinted pale yellow. A plot whose
Barn is unstaffed or missing freezes on whichever art it was showing (a fallow plot still finishes resting).
Optional hooks for #34: `farmPlotSown.png` and `farmPlotFallow.png` replace the stand-ins (and the fallow
tint) as soon as they exist.

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

**Hunting, foraging and slow farming: stand-ins in use (2026-10-14).** Everything below renders today with
borrowed art. Each hook is loaded optionally (`loadOptionalTextures` in `main.ts`): drop a PNG with exactly
this name into `client/public/sprites/` and it replaces the stand-in (and its tint) on the next page load;
a missing file just keeps the stand-in. For animation sets the whole set must be present.
- Hunter worker (#28): stand-in = the archer's `archerWalk0-3` / `archerAttack0-5`, tinted green. Hooks:
  `hunterWalk0-3` (walk, also used while carrying a carcass home) and `hunterHunt0-2` (the shooting
  cycle). Static fallback pose: `archer.png`. A carry row (#28 row 3) has no hook yet.
- Forager worker (#29): stand-in = `farmhandWalk0-3` / `farmhandTend0-2`, tinted warm. Hooks:
  `foragerWalk0-3`, `foragerForage0-2`. Static fallback: `farmhand.png`.
- Hunter's Hut (#30): stand-in = `lumberjackPost.png`, tinted green. Hook: `hunterHut.png`. Forager's Hut
  (#31): stand-in = `orchard.png`, tinted warm. Hook: `foragerHut.png`. Huts level up in place (1-3) but
  the client doesn't know building levels, so only one image per hut is wired for now.
- Wild forage (#32), server tiles with a ripe and a picked state: berry bush = `bush3.png` tinted red
  (ripe) / grey-green (picked); fruit tree = `tree.png` tinted orange (ripe) / grey (picked); mushroom
  patch = `flowers1.png` tinted brown (ripe) / `tallGrass.png` tinted grey (picked). Hooks:
  `berryBushRipe`, `berryBushPicked`, `appleTreeRipe`, `appleTreePicked`, `mushroomRipe`,
  `mushroomPicked` (.png). The pear/plum row of #32 has no tile yet.
- Huntable game (#33): rabbit, boar and pheasant are the deer frames, scaled (rendered width 12 / 24 /
  11 px vs the deer's 26) and tinted. Hooks: `rabbitWalk0-3` + `rabbitIdle0-1`, `boarWalk0-3` +
  `boarGraze0-1`, `pheasantWalk0-3` + `pheasantFlap0-2` (the flee cycle), and for the deer `deerRun0-3`
  (flee). The deer's FALLEN pose has no hook: a killed animal just vanishes and leaves a small blood stain.
- Field and pasture states (#34): see Farm Plot growth states above. Pasture / Sheep / Orchard / Hemp
  "ready" states have no hooks: their produce lands in one batch and is not shown on the map.

---

## Outstanding — with ready-to-use prompts

(#11, #13, #17-#23 were sourced on 2026-10-14 and removed. See "Already sourced" above.)

---

## New requests (2026-10-12 batch) — for upcoming phases and polish

Each prompt follows the file's convention: chunky 16-bit pixel art, thick black outline, flat
cel-shaded color, transparent background, one generation per block, and an explicit **scale line**
anchoring size to an existing sprite. Grouped by the feature they unlock.

### Combat feedback & world life

### 14. Ward Priest — dedicated sprite + walk/tend cycle

The Ward Priest currently reuses the Church bishop art, so the two are indistinguishable.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A wandering ward-keeper priest, clearly distinct from the existing Bishop sprite (which wears a tall cream-and-gold mitre): plain undyed grey-and-ash robes with a deep hood, a rope belt, a hand lantern with a warm candle glow in one hand and a short iron-shod staff in the other, a few pale wax drips on the sleeve. Humble and weathered, not ceremonial. Match the art style, outline weight and palette of the existing Bishop and Farmhand sprites. **Scale: same body height as the existing colonist sprites (Bishop, Farmer) — about 28px tall on screen; lantern and staff may extend slightly beyond that.** In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle facing right, lantern swinging slightly. Row 2 "Tend Cycle" — 3 frames: kneeling or bending to the stone with the lantern lowered, raising the lantern so its light flares, standing back up. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

### 15. Ogre Warlord — Castle Ruin boss (static + walk + attack + slam)

For Phase 5's boss: "a bigger version of our most powerful mob." Needs its own look, not just an upscaled Ogre.
> Pixel art monster animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark-fantasy palette. A towering ogre warlord, a clear escalation of the existing Ogre sprite (same pinkish-brown skin, bald head, tusks, heavy build): add a jagged iron crown fused into the skull, rusted shoulder plates and a studded iron belt, red war-paint streaks across the face and chest, a tattered dark banner strapped to its back, and a huge spiked iron-and-stone maul. Should read instantly as "the boss". Match the existing Ogre's art style, outline weight and palette. **Scale: the same drawing style as the Ogre, but 1.6x larger in every dimension (the Ogre is about 51px tall on screen, so the Warlord is about 82px tall); keep it identical in size in every frame.** In one image: Row 1 "Walk Cycle" — 4 frames, facing right, a slow heavy stomp. Row 2 "Attack Cycle" — 3 frames: maul raised overhead, slammed down with debris, recovery. Row 3 "Roar" — 3 frames: head back, chest out, a shockwave ring, settle. Plus one centered static idle pose. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

### 16. Hunger-mark sigils (6 icons + 6 ground auras)

For Phase 6's Hunger-marked elites (`my_novel/lore/bestiary.md`). Each mark needs a small glyph shown above the monster plus a faint aura ring decal drawn on the ground under it.
> Pixel art icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, small and simple enough to read at 14-18px display size. Six sinister sigils, each a distinct silhouette and a distinct glowing color so they can be told apart at a glance: **Gorrath** (destruction) — a jagged red-black flame with a shattered blade through it; **Nemri** (trespass) — a hollow doorway with a keyhole, cold teal; **Rux** (false authority) — a smiling theatre mask under a broken crown, sickly yellow; **Morvain** (concealment) — a half-veiled eye that is mostly smoke, violet; **Gunne** (what is lost) — an empty cradle or a single falling tear, pale blue-grey; **Vhorrun** (the unclosed debt) — a loose chain looped around itself, never joined, dull bone-white. Arrange as a clean grid, each on its own transparent square, consistent outline weight. **Scale: each glyph about 18x18px, the same icon scale as the resource icons (icon-wood etc.).** Then a second row of six matching ground-aura ring decals: a flat elliptical glowing ring in the same color with faint matching rune ticks, semi-transparent, drawn as if lying on the ground, each about 56x28px (about 2x as wide as a Troll). Clean PNG with transparency.

### Polish, animation and UI

### 24. Wound overlays (for the future visual-health system)

The 2026-10-14 sheet (`Pixel Wildlife and Wound Overlay Sheet.png`) drew these as pre-baked example
units instead of decals, so this prompt is still open. Stress "decals only, no character" when you
regenerate it.

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

## Hunting, foraging and slow farming (2026-10-14 batch)

For the Hunter's Hut, Forager's Hut, wild animals to hunt, wild food to forage, and the slower
farming cycle (fields now take days: sown -> growing -> ready, and rest fallow after 5 harvests).
Same house style as everything above (chunky 16-bit pixel art, thick black outline, flat cel-shaded
colour, muted desaturated medieval palette, transparent background, all creatures and people facing
right). Each prompt anchors scale to an existing sprite. One generation per block.

### 28. Hunter worker (walk + hunt cycle)
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, outline weight, proportions and size of the existing worker sprites (lumberjack, farmer, archer). A woodland HUNTER: green-brown hooded cloak, leather jerkin, short bow on his back, a quiver at the hip, a skinned rabbit hanging from his belt. Row 1: a 4-frame WALK cycle. Row 2: a 3-frame HUNT cycle (draw bow, loose arrow, lower bow). Row 3: a 2-frame CARRY walk with a deer carcass slung over his shoulders. All facing right, same canvas size per frame, feet on the same baseline.

### 29. Forager worker (walk + forage cycle)
> Pixel art character animation sprite sheet, same style, outline weight and scale as the existing worker sprites. A FORAGER: plain linen smock, straw hat, a woven wicker basket on one arm, sleeves rolled. Row 1: a 4-frame WALK cycle. Row 2: a 3-frame FORAGE cycle (stoop, pluck berries from a bush into the basket, stand). Row 3: a 2-frame CARRY walk with a full basket of berries and apples. All facing right, same canvas size per frame, feet on one baseline.

### 30. Hunter's Hut (building, 3 tiers)
> Pixel art isometric building sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the exact art style, camera angle and footprint of the existing cottage.png / cottageLv2.png. Three tiers of a HUNTER'S HUT, left to right: Level 1 a small log lean-to cabin with a thatch roof, a rack of drying pelts and a pair of antlers over the door; Level 2 a larger timber lodge with a stone chimney, a hanging deer carcass, and a fur-covered fence; Level 3 a big hunting lodge with two rooms, stacked firewood, a skinning table, a trophy of antlers and boar tusks on the gable, a hound sleeping outside. Each tier on its own small grass patch like the other buildings.

### 31. Forager's Hut (building, 3 tiers)
> Pixel art isometric building sprite sheet, same style, camera angle and footprint as the existing cottage sprites. Three tiers of a FORAGER'S HUT, left to right: Level 1 a small round wattle-and-daub hut with a mossy thatch roof, baskets by the door and bundles of herbs hanging; Level 2 a larger cottage with a herb garden, drying racks of mushrooms and berries, a stack of wicker baskets; Level 3 a large cosy lodge with a covered porch, a preserves shed with jars, bunches of drying flowers and a little vegetable patch. Each tier on its own small grass patch.

### 32. Wild food: berry bush, fruit tree, mushrooms (full and picked states)
These are world props the forager harvests; each needs a ripe and a picked-bare state (the bare state regrows).
> Pixel art environment prop sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, natural palette matching the existing bush3.png, tallGrass.png and tree.png. Row 1: a BERRY BUSH, ripe (round dark green bush covered in bright red berries) then picked (same bush with only leaves, a few stray berries). Row 2: a wild APPLE TREE, ripe (red apples in the canopy) then picked (bare canopy, a few fallen apples on the ground); match the size of tree.png. Row 3: a WILD PEAR/PLUM TREE variant, ripe then picked. Row 4: a MUSHROOM PATCH, ripe (cluster of brown and red-capped mushrooms) then picked (bare moss patch). Each prop on its own transparent background, centred, same ground contact point.

### 33. Huntable animals: rabbit, wild boar, pheasant, plus deer extras
Needed as real entities (hunters can kill them). Deer already exists (deerWalk0-3, deerGraze0-1); these are additions.
> Pixel art animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted natural palette, matching the style and scale of the existing deer sprites (deerWalk0-3). Row 1: a WILD RABBIT, a 4-frame hop cycle plus a 2-frame sit/nibble. Row 2: a WILD BOAR (bristly dark brown, tusks, roughly deer-sized but stockier), a 4-frame trot cycle plus a 2-frame snuffle/graze. Row 3: a PHEASANT with bright plumage, a 4-frame walk cycle plus a 3-frame flap-and-take-off. Row 4: a DEER being hunted: a 4-frame fast RUN (flee) cycle and a single FALLEN pose. All facing right, same baseline.

### 34. Field and pasture states for the slow farming cycle
Fields now take days, so each plot/pasture needs to read at a glance which phase it is in. Current art: farmPlot.png (bare), farmPlotGrowing.png (sprouts), farmPlotReady.png (ripe wheat).
> Pixel art isometric tile sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, matching the exact footprint, camera angle and style of the existing farmPlotGrowing.png. Row 1, grain FIELD stages: SOWN (freshly tilled dark soil with tiny seed dots), SPROUTING (short green shoots), GROWING (knee-high green wheat), RIPE (golden wheat, matching farmPlotReady.png), HARVESTED (stubble and sheaves), FALLOW (resting field: untilled, overgrown with weeds and wildflowers, pale grass). Row 2, hemp field: SOWN, GROWING, RIPE. Row 3, PASTURE (cattle): animals thin and grazing = growing; FAT and ready (plump cattle, a full trough). Row 4, SHEEP PASTURE: woolly and ready to shear; freshly sheared (pink-bare sheep). Row 5, ORCHARD: blossoming, then fruiting (ripe).

### 35. Builder worker (walk + build cycle) and Builders' Guild (building, 3 tiers)
Builders are required to construct buildings. For now they reuse the lumberjack worker sprites and the lumberjack post building art as stand-ins (`lumberjack*` frames and `lumberjackPost.png`); real art is needed.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the style, outline weight and size of the existing worker sprites (lumberjack, ironMiner). A BUILDER: leather apron, rolled sleeves, a cloth cap, a wooden mallet in one hand and a plumb line at the belt. Row 1: a 4-frame WALK cycle. Row 2: a 4-frame BUILD cycle (hammering a plank, then stepping back). Row 3: a 2-frame CARRY walk with a plank of wood on the shoulder. All facing right, same canvas, feet on one baseline.
> Pixel art isometric building sprite sheet, same style, camera angle and footprint as the existing lumberjackPost.png and cottage sprites. Three tiers of a BUILDERS' GUILD, left to right: Level 1 an open timber workshop with a sawhorse, stacked planks and a half-framed wall; Level 2 a larger guildhall with a crane and a guild banner, stone footings; Level 3 a grand guild house with scaffolding, a stone-and-timber facade, a carved set-square-and-hammer emblem over the door.

### 36. Town Center tiers and the Keep (Town Center Lv1 / Lv2 / Lv3-Keep) and a placeable Town Center marker
The Town Center becomes upgradeable (Lv3 = a Keep) and placeable. Current art: townCenter.png (plaza). Castle Lv3 art (castleLv3.png) or the staged castleKeep.png can stand in for the Keep.
> Pixel art isometric building sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. Match the camera angle, footprint (3.5 tiles wide) and style of the existing townCenter.png. Three tiers of the TOWN CENTER, left to right: Level 1 the existing plaza (timber buildings, statue fountain, market stalls); Level 2 the same plaza grown richer, with a stone town hall, a bell tower and a larger market; Level 3 a fortified KEEP: a square stone keep with four corner towers, curtain walls, a gatehouse, banners and a courtyard. Also a ghosted placement outline of the Level 1 plaza (semi-transparent) for building previews.

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
