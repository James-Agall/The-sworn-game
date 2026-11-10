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

**Buildings (30, all tiers, plus the tiered Builders' Guild / huts / Town Center below):** woodWall, stoneWall, barracks, castleLv2, castleLv3, archeryRange,
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
The same `campfire0-3` frames double as **burning-building flames** (client `syncDamagedBuildings`):
one pooled overlay per damaged building, 12/18/26px wide below 75/50/25% HP, on the shared clock,
plus a soot tint on the building and a dark-tinted `fx-poof` smoke puff below 50%. No new art.

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

**Town Center tiers (wired 2026-10-15):** Town Centers have levels now (snapshot `buildingLevels`), and the art
follows them via `TILE_LEVEL_ART`: Lv1 `townCenterLv1.png`, Lv2 `townCenterLv2.png`, Lv3 `townCenterKeep.png`.
Each skips the box fit with its own `TOWN_CENTER_LEVEL_FIT` width/anchor in `main.ts` (3 / 3 / 3.2 tiles wide,
anchored on the plaza's statue / the keep's court), and the per-Town-Center HP bar sits above whichever art is
shown. `townCenterMarker.png` is the placement ghost while the Town Center tool (key `0`) is selected.
`townCenter.png` below stays as the fallback if a tier file is missing.

**Town Center (fallback):** dedicated `townCenter.png`, a plaza scene with a ring of timber buildings,
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

**Farm Plot growth states:** driven by real server state, the snapshot's `farmStages` since 2026-10-15
(`readyFarmPlots` / `sownFarmPlots` / `fallowFarmPlots` are still sent but the client no longer reads them):
`farmPlotSown.png` (first third of the 3-day grow), `farmPlotSprouting.png` (second third), `farmPlotGrowing.png`
(last third), `farmPlotReady.png` (ripe, being cut), `farmPlotHarvested.png` (stubble for 8 s after each
harvest), `farmPlotFallow.png` (resting after 5 harvests). Since 2026-10-15 all four
come from one matched set (`art-sources/Medieval Farming Game Asset Atlas.png`, #34); the old
`farmPlotGrowing`/`farmPlotReady` art was overwritten (still in git history) so the four states read as one
style. Every stage file is optional: a missing one falls back to `farmPlotGrowing.png`. A plot whose Barn is
unstaffed or missing freezes on whichever art it was showing.

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

**Hunting, foraging and slow farming (wired 2026-10-15).** From `art-sources/Medieval Fantasy Worker and Hut
Sprite Sheet.png` (#28-#31) and `art-sources/Medieval Farming Game Asset Atlas.png` (#32-#34). Each hook is still
loaded optionally (`loadOptionalTextures` in `main.ts`): if a file goes missing, the old tinted stand-in comes back.
- Hunter worker: `hunterWalk0-3`, `hunterHunt0-2` (draw, loose, lower), `hunterCarry0-1` (deer carcass on the
  shoulders). Forager: `foragerWalk0-3`, `foragerForage0-2` (includes the berry bush she picks from),
  `foragerCarry0-1` (full basket). The carry cycle plays in the server's `carrying` state (walking the load
  home); `AnimSet.carry` is optional and falls back to walk. Each row is on one shared canvas, feet on the bottom
  edge, centred on the mass centroid. Static fallbacks stay `archer.png` / `farmhand.png`.
- Hunter's Hut / Forager's Hut: all three tiers wired (`hunterHut`, `hunterHutLv2/Lv3`, `foragerHut`,
  `foragerHutLv2/Lv3`) through `TILE_LEVEL_ART`, driven by the snapshot's `buildingLevels` (since 2026-10-15). A
  higher tier never renders smaller than the one before (`TILE_LEVEL_MIN_HEIGHT`).
- Wild forage: `berryBushRipe/Picked`, `appleTreeRipe/Picked`, `mushroomRipe/Picked`. The pear/plum row
  (`pearTreeRipe/Picked.png`) is wired as a look variant: about half of all fruit trees (stable tile-position
  hash, `TILE_OPTIONAL_ALT_ART`) use it, in both the ripe and the picked state.
- Huntable game: `rabbitWalk0-3` + `rabbitIdle0-1` (sit/nibble), `boarWalk0-3` + `boarGraze0-1`,
  `pheasantWalk0-3` + `pheasantFlap0-2` (take-off, the flee cycle), and `deerRun0-3` (flee). Each kind's frames
  share one pixel scale; rendered width still comes from `WILDLIFE_ART.size` (first walk frame). `deerRun` was
  resampled 1.8x so it matches the older `deerWalk` pixel density (the client scales every deer frame by the walk
  frame's width). `deerFallen.png` (wired 2026-10-15, client-only): a killed deer lies at its death spot for
  2.6 s, fading out over the last quarter, then leaves its blood stain (`spawnFallenDeer`); other game just
  leaves the stain.
- Field and pasture states (wired 2026-10-15) via `FARM_STAGE_ART`, driven by the snapshot's `farmStages`
  (the server's 0..1 progress through the farmhand's 3-day cycle): Hemp Field `hempFieldSown` (first third) /
  `hempFieldGrowing` / `hempFieldRipe` (last third); Pasture `pastureGrowing` / `pastureFat` (last 30%); Sheep
  Pasture `sheepPastureSheared` (first 25%, right after the wool lands) / `sheepPastureWoolly` /
  `sheepPastureReady` (last 20%); Orchard `orchardBlossoming` (first 35%) / plain `orchard` / `orchardFruiting`
  (last 35%). An unstaffed farm shows its plain art.

**Gameplay VFX sheet 2 (#26, wired 2026-10-15):** `fx-build0-3`, `fx-upgrade0-3`, `fx-heal0-3`, `fx-poison0-3`,
`fx-wardPulse0-3`, `fx-wardLapse0-3`, from `art-sources/Medieval Fantasy Strategy Sprite Sheet.png` (glow fringe
recovered by colour-to-alpha against the light checker; each set on one shared canvas). Played by `spawnFxAnim`
(4 frames over the effect's life, fade in the last quarter), all client-side, from existing data only:
- Build / upgrade: when our own placement is confirmed by a `tileUpdate` (bare ground = build; a building that
  turned into a different tile, e.g. House -> Big House, = upgrade), and for in-place level-ups (no tileUpdate)
  when the server's `upgrade` event arrives while we have a recent pending placement on that same building.
  Other players' builds don't play it.
- Heal: once per 0.9s at a Bishop in the `healing` state.
- Poison: at the target of a melee hit whose origin is a Giant Spider (the server's poison source).
- Ward pulse: once per 1.8s at the Ward Stone a priest is tending (`warding` state, post = the stone).
- Ward lapse: at a Ward Stone when a Half-Latch first appears on or next to it (the server spawns one at the
  stone on a lapse). The ward rings are drawn in the tile layer just beneath the stone so the sheet's own baked-in
  obelisk is hidden behind `wardStone.png`.

**Wound overlays (#24, wired 2026-10-15):** `woundLight/Bleeding/Heavy.png` (small) and `...Large.png`, from
`art-sources/Pixel Art Sigils, Auras, and Wound Overlays.png` (real alpha; these replace the rough decals lifted
off example units in the 2026-10-14 batch). Drawn over colonists and mobs as hp drops (`updateWound`): light below
66% hp, bleeding below 40%, heavy below 20%. Colonists use the small set at 14px; mobs use 0.55x their rendered
size, with the Large set for orc, armoredOrc, troll and ogre. One sprite per unit, created on its first damaged
snapshot and then only moved/retextured (hidden while healthy or hidden at a post).

**Builders and construction (#35, wired 2026-10-15):** `builderWalk0-3`, `builderBuild0-3` (the action cycle while
hammering at a site), `builderCarry0-1` (plank on the shoulder, played in the `carrying` state while hauling to a
site), loaded optionally (`COLONIST_OPTIONAL_ANIM_URLS`; the tinted lumberjack set is the stand-in). Builders'
Guild tiers `buildersGuild.png`, `buildersGuildLv2.png`, `buildersGuildLv3.png` follow the building's level.
Construction sites have no art of their own: the target building's sprite is drawn at 45% alpha with a warm tint,
under a Graphics scaffold and a progress bar; an in-place upgrade shows a small yellow up-arrow badge and bar.

**Hunger marks (#16, wired 2026-10-15):** `sigil-gorrath/nemri/rux/morvain/gunne/vhorrun.png` drawn 16px above a
marked mob's hp bar with a tinted name label over it, and `aura-<same names>.png` 40px wide on the ground under it
(decor layer, alpha pulsing 0.35-0.85). Marked mobs render 1.25x. The server sends `mark` (HungerMark) in MobSnapshot.

**Battered armor (#25, wired 2026-10-15):** below 50% hp an idle (not walking/attacking) pikeman colonist or armoured
orc shows `pikemanBattered.png` / `armoredOrcBattered.png` instead of the idle frame, sized to the unit's normal
height with its feet where the idle frame puts them. The animated sets keep playing while moving/attacking (the wound
overlays show the damage there). `knightBattered.png` is not used: the knight's walk/attack set is drawn in a much
chunkier style, so the detailed pose read as a different unit; a hurt knight (and any of the three while animating
or if its pose art is missing) is tinted darker (0x9a948c) instead. The `...Pristine.png` poses are unused.

**Roads (#27, wired 2026-10-15):** Road and Cobble Road tiles, autotiled on the client from their 4 orthogonal road
neighbours (the two types connect to each other). The delivered `road-*` files mostly don't match their names
(measured: `straightH` and `tJunctionB` are vertical straights, `tJunctionT` is a cross, `deadEndB/L/R` and
`cornerBL/BR` have extra stubs), so only the pieces that match are used and rotated for the rest: `road-deadEndT`
(N), `road-straightV` (N+S), `road-cornerTL` (E+S), `road-cornerTR` (S+W), `road-tJunctionR` (E+S+W),
`road-tJunctionL` (N+E+W), `road-cross`, `road-isolated`. Cobble Road: `cobbleRoad.png` (vertical strip, rotated for
E-W) on straight runs and dead ends, `cobblePlaza.png` everywhere else. Unused: `road-straightH`, `road-tJunctionT/B`,
`road-deadEndB/L/R`, `road-cornerBL/BR` (a redraw with the names' connections would let them in).

**Cavalry, siege, Ogre Warlord, boulder VFX (#15, #37-#42, wired 2026-10-28).** From
`art-sources/Pixel Art Ogre and Cavalry Sprite Sheets.png`, `art-sources/Medieval Isometric Siege Sprite Sheet.png` and
`art-sources/Medieval Pixel Art Combat Sprite Sheet.png`. Kept at source resolution (4px padding) like the other sets;
the client scales. Every file loads optionally: a missing one brings back the old tinted stand-in.
- Cavalry: `cavalryWalk0-3`, `cavalryAttack0-2` (`COLONIST_OPTIONAL_ANIM_URLS.cavalry`, 50px tall; the blue-grey tint is
  gone), `cavalryCharge0`: client-inferred charge (no server flag): after `CAVALRY_CHARGE_TILES` (5) of straight riding
  the lance pose replaces the gallop and `fx-dust0` puffs trail the hooves every 200ms (`cavalryChargeRun`). Rows are
  centred on the horse's legs, not the sword/lance.
- Stables `stables` / `stablesLv2` / `stablesLv3` (`TILE_OPTIONAL_ART` + `TILE_LEVEL_ART`), Siege Workshop
  `siegeWorkshop`, both box-fit like the Blacksmith.
- Colony engines (`COLONIST_OPTIONAL_ANIM_URLS`): `batteringRamWalk0-3` + `batteringRamAttack0-2` (40px tall incl.
  pennant), `catapultWalk0-3` + action `catapultLoad0-2` then `catapultFire0-2` on one canvas (38px tall). Raider
  engines (`MOB_OPTIONAL_VARIANT_URLS`): `mobBatteringRamWalk0-1` (the sheet's third move "frame" is two frames drawn
  overlapping, so only two are used) + `mobBatteringRamAttack0-2`, `mobCatapultWalk0-3` + `mobCatapultLoad/Fire0-2`
  (attack cycle plays at the server's 11-tile range). `MOB_TINT` now only applies to the fallback props.
  `...Destroyed.png` (all four): a destroyed engine leaves its wreck for 4s at its last spot (`dropSiegeWrecks`),
  same pixel scale as its set. The rams were drawn facing left and are mirrored; catapults face right as drawn.
- Ogre Warlord (`WARLORD_URLS`, the ogre with boss `warlord`): `ogreWarlordWalk0-3` + `ogreWarlordIdle` (one canvas),
  `ogreWarlordAttack0-2`, `ogreWarlordRoar0-2`. Standing still it shows the idle pose and roars when first seen, then
  every ~9-12s (`warlordIdleFrame`). `WARLORD_ANIM_SIZE` 64 x `BOSS_RENDER_SCALE` 1.6 puts the body (without the
  banner) at ~82px. Mini-boss elite ogres keep the scaled ogre set.
- Boulder: `fx-boulder0-4` (one random rock per shot, tumbling arc) and `fx-boulderImpact0-3` (dust burst, large to
  small, 40px wide, feet-anchored) in `spawnEffect`'s `e.boulder` branch.
- Not wired: `shockKnightReady0-2` (guard, sword draw, raised) and `shockKnightAttack0-2` (guard, thrust, recovery),
  one shared canvas. The sheet has no walk cycle, and mixing these with the old knightWalk frames would swap art styles
  mid-step, so knights keep their old set until a matching walk row exists (see #44).

**Connected walls & oriented gates (#59-#62, wired 2026-10-28).** From
`art-sources/Pixel Art Wall and Gate Tileset Atlas.png` (a labelled poster on a blurred grey background, cut by
flood-filling the background up to each sprite's black outline; captions and the outer blur halo dropped). Kept at
source resolution, each set on one shared canvas with a bottom-centre anchor; the client draws every piece and gate at
one scale (`WALL_ART_PX_PER_TILE` = 68 atlas px per tile, so a horizontal straight spans ~1.2 tiles and overlaps its
neighbours). Everything loads optionally (`WALL_ART_URLS`): an incomplete wall set or a missing gate file brings back
`woodWall` / `stoneWall` / `gateWoodClosed` / `gateWoodOpen`.
- `woodWall_00..15`, `stoneWall_00..15`: piece = 4-bit mask of the orthogonal neighbours (N=1, E=2, S=4, W=8) that are
  the same wall material or a Gate (`wallArtFor`). Wood and stone walls do not connect to each other.
- `woodWallDmg_00..15`, `stoneWallDmg_00..15` (#62 "Damaged"; no "Breached" sheet was delivered): shown below 50% HP
  (`WALL_DAMAGED_PERMILLE`, the fire-tier-2 line), soot tint as before.
- Gates `gate{Wood,Stone}{H,V}{Closed,Open,Damaged,Overrun}`: H when a wall/gate is east or west, V when only north/south,
  H when alone; stone when stone-wall neighbours outnumber wood ones (there is one Gate tile type); state from the
  snapshot flags (overrun > open > damaged below 50% HP > closed). The old `gateWood*` / `gateStone*` files stay as fallback.
- Art problems found while cutting (redraw candidates; contact sheets in the session scratchpad, `walls/out/cs_*.png`):
  - The "vertical" gates (rows 2 and 4) are drawn front-on exactly like the horizontal ones (two posts left and right,
    door facing the camera), so a gate in a north-south wall does not read as turned; it needs a side-on redraw.
  - Corner, T and cross pieces are compact log/pillar clusters narrower than a tile, so there is a visible gap between
    them and the straights that join them. Straights do not meet the tile edge at the same height on every side as the
    request asked; vertical straights (#5) are two posts / one pillar and a N-S run reads as a column of separate posts.
  - Mask conventions are hard to read from the art: wood #1 and #8 (N / W end caps) are the same single log as the
    post #0, and nothing in the end caps or corners points toward the connected side. Stone #6 (SE corner) and #7
    (T N+E+S) look alike, as do stone #11 (T N+E+W) and #12 (SW corner).
  - A few pixels of the blurred background halo survive on `gateWoodHOverrun` (top right), `gateWoodVOpen` and
    `gateWoodVOverrun` (between the posts), and `gateStoneVDamaged` has a see-through slit in the broken door (the
    source shows background through it).

**Armour tiers, Blacksmith, spell icons, character sheet (#45-#48, #53, #54, #57, #58, wired 2026-10-29).** From
`art-sources/Medieval Knight and Cavalry Sprite Sheet.png`, `art-sources/Spearman and Pikeman Animation Sheets.png` and
`art-sources/Medieval Pixel Art Blacksmith Asset Sheet.png` (labelled posters: the background was flood-filled away from
the region border up to each sprite's outline (the spear sheet by its alpha), enclosed near-white gaps dropped, captions
excluded by crop bands, frames split by connected figure so overlapping spears/lances stay with their owner).
- `{knight,spearman,pikeman,cavalry}T{1,2,3}Walk0-3` + `...T{n}Attack0-2` (84 PNGs; cavalry walk = the gallop row).
  Resampled per kind (one factor from tier 1) to the base set's pixel scale (body height feet-to-head, cavalry by
  horse length), each row on one shared canvas with the feet 4px above the bottom edge and the body centred. Wired as
  `COLONIST_TIER_ANIM_URLS` (optional): `ColonistSnapshot.armourTier` 1-3 picks the set with the base set's `scale`;
  0 / missing files keep the base set plus the armour-tier ring. Tier sets skip the cavalry couched-lance pose and the
  battered pose (base-set art). Heroes keep their class art.
- `blacksmithForge0-3` (#53, one shared canvas, aligned on the ground patch): looped (180 ms) while the snapshot's
  `forgeBusy` lists the Blacksmith (forge queue not empty and a smith posted), only at level 1 (or when the level's art
  is missing). `blacksmithLv2` (Smithy), `blacksmithLv3` (Armoury) (#54) via `TILE_LEVEL_ART`.
- `ui-spell0-7` (#57, 64x64): in `SPELLS` table order (fire bolt, thunder, frost, heal, ward, rally banner, summon,
  curse; `SpellDef.icon`), drawn in the spell bar, the sheet's spell slots and spell book, and on Spell Tomes.
- `ui-characterSheet.png` (#58, the full 712x458 panel with its baked placeholder labels) is used only as the hero
  sheet's 18px 9-slice `border-image` frame (the labels sit inside the ring, hidden); `ui-slotSocket.png` (76x76; its
  baked helmet is hidden the same way) is the 10px-slice rim of every `.hs-socket`. The DOM slots are unchanged.

### Batch 2 (2026-10-30 sheets, wired 2026-10-30)

Cut from five poster sheets (copied to `art-sources/`): background flood-filled away, captions excluded, each set
normalised to one canvas per animation row with a bottom-centre anchor, kept at source pixel scale (like every other
sprite; the code scales). `effectsd/Parchment Heraldry Icon Grid-1.png` is painted, not pixel art: not used.

- `Medieval Caravan Sprite Sheet.png` (#63-#65): `traderWagon{1,2,3}Walk0-5` (6 move frames), `Hit0`, `Destroyed`,
  one canvas per level; `Idle` = a copy of Walk1 (the sheet has no idle; Walk0 is drawn slightly smaller than the
  rest). Wired via `WAGON_ART_URLS` (walk / hit counts follow the arrays). `Destroyed` is staged only (wagons have no
  wreck hook yet).
- `Medieval Trading Post Pixel Art Assets.png`: `tradingPostLv2`, `tradingPostLv3` (#66, `TILE_LEVEL_ART`), and the
  #67 icons `ui-tradeRoute` (wagon status line; `ui-tradeAlert` instead while the wagon is below full HP),
  `ui-tradeProfit` (staged), `ui-relation` (settlement Trade line when trade is refused). 64x64 like `ui-spell*`.
- `Fantasy Pixel-Art Camp Asset Sprite Sheet.png`: `keepRuinWood/Orc/Stone` (#77; a RuinedKeep tile drawn by its
  site's faction: bandit / orc / human), `keepScaffold` (shown instead of the faded Town Center while a razed keep is
  rebuilt to capture it), `tentVertical`, `tentHorizontal` + `_green` / `_red` (part of #74; Tent tiles by faction:
  bandit beige, orc green, human red, upright or long by position hash). Staged only (no hook yet): `clanEmblem0-5`,
  `clanBanner0-2` (#78, greyscale for tinting), `ui-warband`, `campFounding0-3` (#79).
- `Pixel Fantasy Game UI and Goblin Rider Sprite Sheet-2.png`: goblin wolf rider (#83) `goblinRiderWalk0-3`,
  `Attack0-2` (wired via `MOB_OPTIONAL_VARIANT_URLS`), `Death0-2` (Death2, the wolf down, is left as a fading wreck
  like the siege engines), `goblinRiderVetWalk0-3` / `VetAttack0-2` (Hunger-marked riders); staged: `Charge0-2`,
  `Idle` (= Walk0), `Hit`, `VetDeath0-1`. #80: `ui-rel0-5` (hostile..vassal; trade panel relation line and the
  settlement Trade line), `ui-tribute` / `ui-callToArms` / `ui-vassal` (vassal rows). #81: `ui-questNew` /
  `ui-questActive` (quest list seal and minimap marker), `ui-reward` (quest reward line); staged `ui-questPanel`,
  `ui-questEntry`. #82: `ui-role{Infantry,Archers,Cavalry,Knights,Siege,Clergy,Heroes}` on the regiment cards;
  staged `ui-order{AttackMove,Hold,Retreat,Charge,Bombard,HoldFire,Skirmish,Cycle}`, `ui-shape{Line,Block,Wedge,
  Loose}`, `ui-regimentFlag0-2`, `ui-regimentBanner`, `ui-regimentCard`.
- `Fantasy Wall and Moat Tileset Atlas.png`: `rubbleWood0-2` / `rubbleStone0-2` (#71; fallen NPC walls, wood at
  bandit / orc forts, stone at human settlements) wired. Staged under their final names (phase H): `moat_00-15`,
  `moatRipple0-2`, `moatDigging` (#72), `drawbridge{Wood,Iron}{H,V}{Lowered,Raised,Damaged,Destroyed}` (#73); staged
  for later: `{wood,stone}WallBreached{H,V,Corner}`, `gate{Wood,Stone}Breached`. NOT used (see below):
  `{wood,stone}Wall{,Dmg}B2_00-15`, `gate{Wood,WoodDmg,Stone,StoneDmg}VSide{Closed,Open,Damaged,Overrun}`.

- `art-sources/Fantasy Game Effect Sprite Sheet.png` (in Downloads, not copied): a lower-quality duplicate of VFX
  sheet 2 with stray gate art. Ignored.

---

## Outstanding — with ready-to-use prompts

(#11, #13, #17-#23 were sourced on 2026-10-14, #16, #24-#36 on 2026-10-15 and #15, #37-#42 on 2026-10-28, and their
prompts removed. See "Already sourced" above. Still open: #14 below, and #43/#44 (partly delivered). Delivered but not yet in the game: the earlier Castle Ruin,
gate and torch art under "Sourced but not wired".)

---

## New requests (2026-10-12 batch) — for upcoming phases and polish

Each prompt follows the file's convention: chunky 16-bit pixel art, thick black outline, flat
cel-shaded color, transparent background, one generation per block, and an explicit **scale line**
anchoring size to an existing sprite. Grouped by the feature they unlock.

### Combat feedback & world life

### 14. Ward Priest — dedicated sprite + walk/tend cycle

The Ward Priest currently reuses the Church bishop art, so the two are indistinguishable.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A wandering ward-keeper priest, clearly distinct from the existing Bishop sprite (which wears a tall cream-and-gold mitre): plain undyed grey-and-ash robes with a deep hood, a rope belt, a hand lantern with a warm candle glow in one hand and a short iron-shod staff in the other, a few pale wax drips on the sleeve. Humble and weathered, not ceremonial. Match the art style, outline weight and palette of the existing Bishop and Farmhand sprites. **Scale: same body height as the existing colonist sprites (Bishop, Farmer) — about 28px tall on screen; lantern and staff may extend slightly beyond that.** In one image: Row 1 "Walk Cycle" — 4 frames, same scale and camera angle facing right, lantern swinging slightly. Row 2 "Tend Cycle" — 3 frames: kneeling or bending to the stone with the lantern lowered, raising the lantern so its light flares, standing back up. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

## New requests (2026-10-28 batch) — cavalry, siege

For ROADMAP "Cavalry & siege" (2026-10-27): cavalry from the Stables, battering rams and catapults from the Siege
Workshop, the raids' own rams and catapults, and knights recast as shock troops. #37-#42 are wired now (see
"Already sourced"); #43/#44 are partly delivered (table at the end). Same convention as above: chunky 16-bit pixel art, thick black outline,
flat cel-shaded color, transparent background, one generation per block, an explicit **scale line** anchoring to an
existing sprite, "match the existing X sprite".

(#37-#42 were delivered and wired on 2026-10-28; see "Already sourced".)

### 43. Cavalry charge dust trail VFX

Partly delivered: the combat sheet had one dust puff (`fx-dust0`), which the charge trail uses, drifting and fading. A 4-frame loop would still read better.
> Pixel art VFX sprite sheet, chunky 16-bit retro style, thick black outline (thin on the wisps), flat cel-shaded coloring, matching the existing fx-poof effect. One row "Charge dust" — 4 frames of a low dust cloud kicked up behind galloping hooves, drifting back and fading, with a few clods of earth; about 24px wide on screen. Transparent background, one shared canvas, clean PNG. Files: `fx-chargeDust0-3`.

### 44. Knight shock-trooper — heavier-armour variant (walk + attack)

Knights are now shock troops (front centre); their art should look heavier than the militia line around them.
Partly delivered: `shockKnightReady0-2` / `shockKnightAttack0-2` (standing guard/draw/strike poses, no walk), on disk but not wired. Still needed: the walk row, in that same style.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The existing Knight, upgraded to a heavy shock trooper: full plate with broad layered pauldrons, a great helm with a narrow visor slit, a tall tower shield with a painted colony sigil, a heavy arming sword or flanged mace, a short dark surcoat. Same character and palette as the existing knightWalk / knightAttack frames, just heavier. **Scale: the same body height as the existing knight frames (about 28px on screen); the tower shield may reach slightly above the shoulder.** In one image: Row 1 "Walk Cycle" — 4 frames facing right, a heavy measured step behind the shield. Row 2 "Attack Cycle" — 3 frames: shield braced, a shield-bash plus overhead cut, recovery. Transparent background, feet on the bottom edge of a shared canvas, clean PNG. Files: `knightShockWalk0-3`, `knightShockAttack0-2`.

### Placeholders in use (wire the real art here)

| Item | In game as | Placeholder now | Where to wire it |
|---|---|---|---|
| #43 Charge dust | cavalry charge (client-inferred) | single `fx-dust0` puff, drifted and faded | `spawnChargeDust`; a 4-frame `fx-chargeDust0-3` would replace the single puff |
| #44 Knight shock | colonist `knight` | the existing knight frames (`shockKnight*` poses on disk, unwired: no walk row) | `COLONIST_ANIM_URLS.knight` (or an optional set) once a matching walk row exists |

## New requests (2026-10-29 batch) — armour & weapon tiers

For ROADMAP "Armour & weapons" (2026-10-28): knights, spearmen, pikemen and cavalry now muster with armour and a
weapon of tier 1-3 from the colony's stock (forged at the Blacksmith, tier = its level; looted from armoured foes
and camps). #45-#48, #53, #54, #57 and #58 were delivered and wired on 2026-10-29 (see "Already sourced"; prompts
removed); #49-#52, #55 and #56 need regenerating (see "Regenerate" below). Same convention as
above: chunky 16-bit pixel art, thick black outline, flat cel-shaded color, transparent background, one generation
per block, an explicit **scale line** anchoring to an existing sprite.

**Tier progression (applies to every on-unit sheet below):** tier 1 "iron & leather" — plain, functional, dull
grey iron over brown leather, no ornament; tier 2 "steel" — brighter steel, coloured trim on the tabard / edges,
added pauldrons and a gorget; tier 3 "gilded plate" — full plate with gold edging and filigree, a plume or crest,
a faint warm glow on the weapon edge. The silhouette must stay the same unit at every tier (same pose, height and
feet position), only heavier and brighter, so the three rows read as one progression. Rarity colours used across
icons and UI: bronze `#cd7f32` (T1), silver `#c0c8d0` (T2), gold `#f2c94c` (T3) — the same colours as today's
placeholder rings.

### 49. Equipment stock icons — armour / weapon x 3 tiers (Colony panel)

> Pixel art UI icon set, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, matching the existing resource icons (icon-iron, icon-tools, icon-clothes). Six small inventory icons in one row, left to right: armour T1 (an iron-and-leather cuirass, bronze rim), armour T2 (a steel breastplate with pauldrons, silver rim), armour T3 (a gilded breastplate, gold rim), weapon T1 (a plain iron sword, bronze rim), weapon T2 (a steel sword with a coloured grip, silver rim), weapon T3 (a gilded sword with a faint glow, gold rim). **Scale: the same size as the existing icon-iron.png (about 16x16 on screen); identical canvas per icon.** Transparent background, evenly spaced, clean PNG. Files: `icon-armourT1-3`, `icon-weaponT1-3`.

### 50. Per-family armour & weapon icons — 2 sheets (armour, weapon), 6 icons x 3 tiers, 32x32

For a later unit/equipment panel (and the hero/character sheet in #57). One sheet per slot on a shared 32x32 grid.
> Pixel art UI icon sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted medieval palette, matching the existing resource icons. A strict grid of 32x32 cells, 6 columns x 3 rows; row 1 tier 1 (iron & leather) with a bronze `#cd7f32` square rarity border, row 2 tier 2 (steel, trim) with a silver `#c0c8d0` border, row 3 tier 3 (gilded plate) with a gold `#f2c94c` border and a soft glow. ARMOUR sheet columns: knight plate cuirass, knight tower shield, spearman brigandine, pikeman breastplate + morion, cavalry rider plate, cavalry horse barding (chanfron + caparison). WEAPON sheet columns: knight arming sword, knight flanged mace, spearman spear, pikeman pike, cavalry lance, cavalry sabre. Each item centred in its cell, the same pose across tiers so the tiers read as upgrades of one item. **Scale: each icon fills about 26px of its 32x32 cell; every cell the same size.** Transparent background, clean PNG. Files: `equipArmourSheet.png`, `equipWeaponSheet.png` (cells addressed by column, tier).

### 51. Relic set — unique armour & weapon icons (32x32)

For hero and player equipment (not in the game yet; see Notes).
> Pixel art UI icon sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring. A named relic set, "the Sworn Relics", 8 icons on a strict 32x32 grid in one row, each in a purple-to-teal gradient "relic" border with a soft teal glow and a few sparkle pixels: armour — helm (a crowned great helm), chest (an engraved cuirass with a glowing sigil), legs (greaves with rune bands), shield-or-cloak (a heater shield with the colony sigil, or a star-flecked cloak); weapons — sword (a rune-etched longsword), spear (a winged spear), bow (a recurve bow with glowing string), staff (a gnarled staff with a floating teal crystal). Pale steel and old gold, with teal rune light. Match the style and outline weight of #50. **Scale: each icon fills about 26px of its 32x32 cell.** Transparent background, clean PNG. Files: `relicHelm`, `relicChest`, `relicLegs`, `relicShield`, `relicSword`, `relicSpear`, `relicBow`, `relicStaff` (or one `relicSheet.png`).

### 52. Loot pickup sparkle VFX

> Pixel art VFX sprite sheet, chunky 16-bit retro style, thick black outline (thin on the sparkles), flat cel-shaded coloring, matching the existing fx-spark / fx-poof effects. One row "Loot sparkle" — 4 frames: a small burst of gold and white star glints rising from the ground with a faint ring, peaking then fading upward; about 20px across on screen (a bit larger than fx-spark). Optional row 2: the same in teal for relics. Transparent background, one shared canvas per row, clean PNG. Files: `fx-loot0-3` (`fx-lootRelic0-3`).

### 55. Player rider — visible-equipment overlay set (3 tiers + relic)

Paper-doll layers drawn over the player's existing mounted-knight frames (no new body).
> Pixel art equipment overlay sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, drawn to sit EXACTLY over the existing playerWalk0-3 and playerAttack0-1 frames (same canvas, same pixel positions; everything else transparent). Four layers: helm, chest (cuirass + pauldrons), cloak, weapon-in-hand (lance on walk, sword on attack). Four sets: tier 1 iron & leather, tier 2 steel with trim and pauldrons, tier 3 gilded plate with a plume and a faint glow, and a relic set (purple-teal rune light, matching #51). **Scale: identical to the player frames (about 68px tall with the banner); frame-for-frame registered.** Layout: one block per set (tier 1, tier 2, tier 3, relic), each block with a "Walk" row (4 frames) and an "Attack" row (3 frames — a 3-frame cut to replace the current 2-frame thrust), each row showing the four layers stacked as separate rows in fixed order (helm, chest, cloak, weapon). Transparent background, clean PNG. Files: `playerEquip{T1,T2,T3,Relic}{Helm,Chest,Cloak,Weapon}{Walk0-3,Attack0-2}`.

### 56. Generic HERO unit — base + visible-equipment overlay set

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A generic on-foot hero of the colony: a bareheaded figure in a plain linen tunic and boots, neutral pose, built as a paper-doll base. Then the same overlay layers as #55 — helm, chest, cloak, weapon-in-hand (sword) — in tier 1 / tier 2 / tier 3 / relic sets, drawn to register exactly over the base. Match the proportions and palette of the existing knight frames. **Scale: the same body height as the existing knight frames (about 28px on screen).** Rows: base "Walk" (4 frames facing right) and "Attack" (3 frames: raise, cut, recovery); then per set the four layers over the same 4 + 3 frames. Transparent background, feet on the bottom edge, clean PNG. Files: `heroWalk0-3`, `heroAttack0-2`, `heroEquip{T1,T2,T3,Relic}{Helm,Chest,Cloak,Weapon}{Walk0-3,Attack0-2}`.

### Placeholders in use (wire the real art here)

| Item | In game as | Placeholder now | Where to wire it |
|---|---|---|---|
| #49 stock icons | Colony panel `#stat-equipment` | text only ("Armour T1/T2/T3: 2/0/1 · Weapons: 3/1/0", amber when a slot is empty) | `refreshEquipmentLine` |
| #50, #51, #55, #56 | hero / player gear and relics on the character sheet | placeholder icons (coloured square + glyph, rarity border); no gear drawn on the units | `itemIcon` (icons, `/sprites/<item.icon>.png`); unit overlays: future work |
| #52 loot sparkle | drops / camp loot (server toast only) | none (toast only) | needs a drop position in the snapshot or an `AttackEffect` flag |

## New requests (2026-10-30 batch) — connected walls & oriented gates

#59-#62 were delivered and wired on 2026-10-28 (see "Already sourced"; their prompts are removed). Still wanted:
side-on "vertical" gates (the delivered ones are front-on), wider corner/T/cross pieces that reach the tile edges on
their connected sides, and the #62 "Breached" (~15% HP) sheets.

## New requests (2026-10-30 batch) — trader wagons & Trading Post levels

#63-#67 were delivered and wired on 2026-10-30 (see "Already sourced", Batch 2); prompts removed.

## New requests (2026-10-30 batch) — everything else the roadmap needs

Grouped by feature. All pixel art in the game's existing chunky 16-bit style (thick dark-ink outline, flat shading,
3/4 top-down view), transparent PNGs, no text, and each prompt should be pointed at the named existing sprite for
scale. Until each arrives the client keeps its current placeholder (tinted or drawn shapes); nothing here blocks play.

### Unit & FX leftovers

### 68. Shock knight — walk row (and idle)
> Match the delivered `shockKnightReady0-2` / `shockKnightAttack0-2` poses exactly (same armour, shield and lance).
> Add the missing rows on one sheet: **walk 4 frames** facing RIGHT (heavy plated stride, lance carried upright,
> shield on the arm), **idle 1 frame**. **Same frame size as the delivered knight poses.** Files:
> `shockKnightWalk0-3.png`, `shockKnightIdle.png`. Wires up the unwired #44.

### 69. Charge dust trail — 4 frames
> Match the single delivered `fx-dust0` puff. A cavalry-charge dust cloud kicked up behind galloping hooves: 4 frames,
> puff grows, spreads and fades, soft pixel clusters in dusty tan with lighter highlights. **About 32x24 px per
> frame.** Files: `fx-chargeDust0-3.png`. Replaces the single-frame placeholder (#43).

### Walls, moats and drawbridges

> **Batch 2 review (2026-10-30):** the delivered #70 redraw is WORSE than the 2026-10-28 atlas and is not used:
> the pieces are ~30-40 px compact posts and clumps at a smaller scale than the current set, the masks don't follow
> the N=1/E=2/S=4/W=8 order (1 and 2 are horizontal runs, 5 and 10 are lone posts), and the corner / T / cross
> pieces don't reach the tile edges, so neither runs nor junctions would connect. The side-on gates are the right
> idea but at the same smaller scale, so they would not meet the current walls. Staged as `*B2_NN` /
> `gate*VSide*` only. Still wanted: everything in #70 below, drawn at the current atlas scale (~84x95 per piece).
> #71 breached pieces share that scale (staged); #71 rubble, #72 and #73 were delivered (moat masks are unverified
> until phase H wires them). Still missing: #74 camp props other than the tents (and the camp-stage emblems),
> #75 the whole orc set, #76 the settlement buildings, #68, #69.

### 70. Wall piece redraws (fixes the delivered atlas)
> Match the delivered `woodWall_00..15` / `stoneWall_00..15` atlas look. Redraw only what is wrong: (1) corner,
> T-junction and cross pieces (indices 3, 6, 7, 9, 11-15) must be full tile width on every connected side so
> neighbouring pieces touch with no gap; (2) the vertical straight (5) must tile seamlessly top-to-bottom as a
> continuous wall, not a pair of loose posts; (3) end caps (1, 2, 4, 8) must visibly point away from the open side
> and differ from the lone post (0); (4) side-on **vertical gates** for wood and stone (closed / open / damaged /
> overrun) drawn edge-on, door facing sideways, not front-on. Same canvas size and bottom-centre anchor as the
> delivered set. Files: `woodWall_00..15.png`, `stoneWall_00..15.png`, `woodWallDmg_00..15.png`,
> `stoneWallDmg_00..15.png`, `gate{Wood,Stone}V{Closed,Open,Damaged,Overrun}.png`.

### 71. Wall breached and rubble states
> Match #70. For wood and stone: a **breached** (~15% HP) version of the straight (horizontal + vertical), corner and
> gate pieces, and **rubble** tiles for a destroyed wall (3 variants each: scattered logs and splinters for wood,
> tumbled stone blocks for stone) that read as walkable ground. Files: `woodWallBreached{H,V,Corner}.png`,
> `stoneWallBreached{H,V,Corner}.png`, `gateWoodBreached.png`, `gateStoneBreached.png`, `rubbleWood0-2.png`,
> `rubbleStone0-2.png`.

### 72. Moat — connected water tiles (16-piece mask set)
> A dug moat in the same piece order as the walls (N=1, E=2, S=4, W=8; 0 isolated pond, 5 vertical, 10 horizontal,
> 15 cross, and the end caps / corners / T pieces): dark blue-green still water inside a dirt-and-grass bank with a
> thin lighter ripple line, edges meeting seamlessly with neighbours. Same tile size as the ground tiles. Also: a
> **3-frame ripple** loop for the water, and a **"being dug" construction state** (raw earth trench with a shovel
> and spoil heap). Files: `moat_00..15.png`, `moatRipple0-2.png`, `moatDigging.png`.

### 73. Drawbridge — wood and reinforced
> Spans one moat tile. Match the wood and stone wall palettes. For each of **wood** and **iron-banded**, horizontal
> (spans a north-south moat) and vertical (spans an east-west moat): **lowered** (walkable plank deck with rope
> rails), **raised** (deck standing upright as a gate, chains taut), **damaged**, **destroyed** (broken planks
> floating in the water). Files: `drawbridge{Wood,Iron}{H,V}{Lowered,Raised,Damaged,Destroyed}.png` (16 files).

### Forts, camps and growth

### 74. Bandit camp set with growth stages
> Match the existing bandit mob and wood-wall art. Camp pieces, each about one tile except where noted: **small tent**,
> **big tent** (2x2), **lean-to**, **log watchtower platform**, **cooking fire with pot**, **loot cart**, **weapon
> rack**, **trophy pole** (skull and rags), **ragged banner**, **supply crates and barrels**. Plus four **camp
> stage** emblems for the minimap and growth readout (tier 1 campfire, tier 2 palisade, tier 3 watchtowers, tier 4
> war hall). Files: `banditTent.png`, `banditTentBig.png`, `banditLeanTo.png`, `banditWatchtower.png`,
> `banditFire.png`, `banditCart.png`, `banditRack.png`, `banditTrophy.png`, `banditBanner.png`, `banditCrates.png`,
> `campTier1-4.png`.

### 75. Orc stockade set
> Match the existing orc mob art. Crude, heavier, green-grey: **hide tent**, **big war tent** (2x2), **war drum**,
> **boar pen** (fenced, with a boar), **crude iron forge with anvil**, **iron-ore stockpile**, **skull trophy poles**,
> **tusk gate** (wood gate variant, horizontal and vertical, closed/open/damaged/overrun), **chieftain's hall**
> (3x3), **orc war banner**. Files: `orcTent.png`, `orcTentBig.png`, `orcDrum.png`, `orcPen.png`, `orcForge.png`,
> `orcOre.png`, `orcTrophy.png`, `orcGate{H,V}{Closed,Open,Damaged,Overrun}.png`, `orcHall.png`, `orcBanner.png`.

### 76. Human settlement buildings
> Match the existing house, barn, church and castle sprites. Neutral human village and town pieces: **market stall**,
> **inn / tavern**, **windmill / mill**, **town hall** (2x2), **guardhouse** (gate-side), **well**, **signpost**,
> **quest notice board**, **smithy**, **fenced farmstead**, **riverside dock** with a small boat, and a large
> **town keep** (3x3) for the Riverwatch garrison town. Files: `settleMarket.png`, `settleInn.png`,
> `settleMill.png`, `settleHall.png`, `settleGuardhouse.png`, `settleWell.png`, `settleSign.png`,
> `settleBoard.png`, `settleSmithy.png`, `settleFarm.png`, `settleDock.png`, `settleKeep.png`.

### 84. Progression tree stations and items (2026-11-03)
> Match the existing blacksmith and lumberjack post art. **Charcoal burner** (a turf-covered earth clamp with smoke
> and a stack of logs; levels 1-3 bigger), **bloomery** (squat clay-and-stone shaft furnace with bellows; level 2-3
> a taller stone **blast furnace** with a chimney). Item icons for the Build panel (32 px): stone axe, stone pick,
> stone knife, timber props, hide, bellows, charcoal, iron bloom, anvil, hammer & tongs. Files:
> `charcoalBurner.png`, `bloomery.png`, `blastFurnace.png`, `item{StoneAxe,StonePick,StoneKnife,TimberProps,Hide,
> Bellows,Charcoal,IronBloom,Anvil,SmithTools}.png`. Stand-ins now: the campfire prop tinted dark brown and the
> blacksmith tinted red (`client/src/worldVisuals.ts` TILE_STANDIN_TINT); items are text only.
> Phase 4 (food): **mill** (timber watermill / post windmill, levels 1-3), **bakery** (cottage with a domed clay
> oven and chimney smoke), item icons wooden plow, millstone, clay oven, flour sack, gruel bowl, flatbread, sourdough
> crock, bread loaf. Files: `mill.png`, `bakery.png`, `item{WoodenPlow,Millstone,ClayOven,Flour,Gruel,Flatbread,
> SourdoughStarter,Bread}.png`. Stand-ins: the barn tinted pale (mill) and the tavern tinted warm (bakery).

### 85. Prisoner / captive (2026-11-06)
> Match the existing villager / farmer art (28 px tall, feet at the bottom edge). A **captive villager** kneeling or
> standing with wrists bound by a rope (idle: 2 frames, a slow sway; no walk row needed: captives stand at camp
> hearths until freed), plus a **freed** pose (standing, rope gone, 1 frame) for the ones waiting at a burnt camp.
> Files: `prisoner.png`, `prisonerIdle0-1.png`, `prisonerFreed.png`. Stand-in now: the villager sprite
> (`farmer.png`) tinted grey with a drawn rope loop at the wrists (`client/src/main.ts` syncCaptives); the freed ones
> are the villager tinted pale, untied.

### 86. Pasture animals: cow, pig and sheep pastures (2026-11-06)
> Match the existing `pasture` / `pastureFat` / `sheepPasture*` art (same fenced 2x2 paddock, drawn on one canvas
> and scaled across the 2x2 block like the other pastures). **Cow pasture**: the current Pasture art already shows
> brown-and-white cows and stays as the Cow pasture (`pasture`, `pastureGrowing`, `pastureFat`); optional
> cow-specific redraws `cowPasture.png` / `cowPastureGrowing.png` / `cowPastureFat.png` (2-3 cows, a hide drying
> on the fence). **Pig pasture** (new, TileType.PigPasture = 104): muddy pen with a wallow, a trough and a lean-to
> sty, 3-4 pink pigs; states like the cow pasture: `pigPasture.png` (empty pen), `pigPastureGrowing.png` (piglets),
> `pigPastureFat.png` (fat pigs, last 30% of the cycle). Optional unit loop for later: pigs rooting, 2 frames of
> 32x24 (`pigRoot0-1.png`). **Sheep pasture** now also gives meat (wool + meat): no new art needed; optional
> `sheepPastureReady` variant with a shearing stool. Stand-in now: the Pig pasture uses `pastureFat` tinted pink
> (`client/src/worldVisuals.ts` TILE_STANDIN_TINT 0xffa8b8); a `pigPasture.png` dropped in `client/public/sprites/`
> replaces it automatically (TILE_OPTIONAL_ART). The 2x2 Orchard reuses the `orchard*` art scaled across the block.

### RimWorld / Stardew systems (PLAN-rimworld-stardew.md, 2026-11-09)
> View is flat top-down / 3/4, art tile-aligned on the 32px grid (NOT isometric). Everything below is drawn in code as
> procedural stand-ins first (coloured blocks, edge shading); these are the real-art requests. Match the existing
> Stardew-like palette of the roads/walls. Numbers #90+ so they do not collide with parallel entries.

### 90. Modular structure tiles (phase 1) — 32x32 each, autotiled
> **Walls** (wood plank, wood palisade, stone block, reinforced stone): 16-piece connection mask set each (isolated,
> end x4, straight x2, corner x4, T x4, cross), top-down with a visible front face (~8px) so they read as 3/4.
> **Damaged/breached** states (50% cracked, rubble) per material. **Doors** (wood, iron-bound): closed, open, broken,
> both orientations. **Windows** (shutters, glass): in wall, both orientations. **Floors**: packed dirt, wood planks,
> flagstone, cobble, carpet/rug (red, blue); 4 variants each to avoid tiling. **Roofs**: thatch, wood shingle, clay
> tile, slate; seamless, with a ridge line variant and an eave edge piece; plus a 50% faded cutaway version used when
> the hero is inside. **Blueprint ghosts**: translucent blue overlay for planned wall/floor/door/window/roof, and a
> scaffold/construction-in-progress overlay (2 frames).

> **Phase 1 stand-ins in use (2026-11-09, `client/src/structureArt.ts`, all procedural 32x32, pending the art above):**
> wood / stone floor; wood / stone window (horizontal + vertical); wood / stone door (horizontal + vertical, open +
> closed); bed; thatch roof and clay-tile roof (plain tile, no ridge / eave pieces yet, faded by alpha when inside).
> Walls keep their existing 16-piece art; doors and windows join it. Still missing entirely: door broken state,
> window damaged state, blueprint ghost tiles (a construction site shows the faded piece), roof ridge / eave pieces.
> **2026-11-09: doors, windows, floors, rug, roofs and furniture now use the sliced atlas art; see "#90-#97 delivery
> status" below (the stand-ins remain as automatic fallbacks).**

### 91. Furniture and room items (phase 2) — 32x32 or 32x64 (2 tiles)
> Bed (single, double; wood, straw pallet), table (small, long), chair/stool, bench, chest, shelf, wardrobe, hearth/fireplace
> (lit/unlit), lamp/candle stand (lit/unlit), rug, banner, statue/trophy (beauty), workbench, cooking pot/stove, barrel,
> sack pile, weapon rack, armour stand, altar, well. Each with a 2-frame idle where it has fire/light. Room-quality
> HUD icons (16px): room size, beauty, cleanliness, warmth, wealth; room-role badges: bedroom, kitchen, workshop, hall,
> barracks, storeroom, hospital, church.

> **Phase 2 stand-ins in use (2026-11-09, `client/src/structureArt.ts` furnitureTex, procedural 32x32, pending the art
> above):** table, chair, chest, shelf, hearth (lit, no animation), lamp (with a glow disc), rug (one tile, tiles side by
> side), workbench, statue, weapon rack. The Room panel draws its stats as plain coloured bars (no icons / role badges yet).

### 92. Zones, hauling and job priorities (phases 3-4) — UI + overlays
> Zone overlay tiles (32x32 translucent, edge-tiled, 6 colours): growing zone, stockpile zone, home area, pasture/animal
> area, no-go/forbidden; zone placement cursor icons. Stockpile filter icons (16px): food, wood, stone, ore, metal,
> cloth, tools, weapons, armour, medicine, everything. Work-priority table icons (24px): farming, hauling, building,
> crafting, mining, woodcutting, hunting, cooking, doctor, fighting, research/learning, plus priority number badges 1-4
> and an 'off' mark. Hauling carry sprites: villager carrying a sack/crate/log/stone (4 dirs, 2 frames).

> **Phase 3 stand-ins in use (2026-11-09, `client/src/zones.ts`, drawn with Graphics):** zone overlays are flat
> translucent fills + 2 px edge lines in 4 colours (growing green, stockpile amber, home blue, animal purple); loose goods
> are a rounded square "sack" tinted per good; the Zones tab uses text buttons (no icons); haulers show no carried load.

> **Phase 4 in use (2026-11-09, `client/src/work.ts`, `spriteRegistry.ts WORK_ICON`):** the Work tab uses the staged
> `icons/priority_1..4` / `priority_off` badges and `work_building / work_farming / work_mining / work_crafting /
> work_hauling`. Still pending (substitutes in use): **woodcutting** (`tool_axe`), **hunting** (`stock_food`), **cooking**
> (`work_harvest`), **fighting** (`stock_weapons`); doctor / research are not game systems yet. Default mode shows a
> text check mark for "on".

### 93. Farming tiles and crops by season (phase 3 + 5) — 32x32
> Soil: untilled grass, tilled, tilled+watered (dark), tilled in frost. Crop growth stages (5 each: seed, sprout, young,
> mature, ready) for wheat, flax/hemp, vegetables, berries, root crop, with spring/summer/autumn variants and a
> withered/dead stage. Seed bag item icon, watering can/hoe/axe/pickaxe/scythe tool icons (hero tools), tool-use swing
> animation for the hero (4 dirs x 3 frames per tool). Scarecrow, sprinkler, fence post/gate (wood).

> **Phase 3 stand-ins in use (2026-11-09, `client/src/zones.ts` draw):** tilled soil = brown tile with 4 furrow lines;
> sown = pale seed dots; growing = green sprout bars; ripe = gold (wheat) / dark green (hemp) blocks. One look for both
> crops until ripe; no watered / withered / seasonal variants yet.

### 94. Seasons and weather (phase 5b)
> Four ground/tree tint sets or separate tile variants (spring blossom, summer green, autumn orange/red leaves, winter
> snow-covered grass, trees, rocks, roofs). Weather overlays: rain (streak particles + puddle ripples), snow, fog,
> storm flash; calendar HUD icons (season emblem x4, weather x4, festival marker). Day-of-season strip. Frozen water tile.

### 95. Interiors (phase 5c) — tile sets 32x32
> Interior floor + back-wall + side-wall pieces for: house/cottage, tavern, shop, church, barracks, smithy, bakery,
> barn, castle hall; door-in-wall and 'exit mat' tile; interior lighting overlay (warm vignette); stairs up/down.
> Cutaway wall pieces so a room can be seen into from the front.

### 96. Animals living in buildings (phase 5d)
> Buildings: chicken coop, barn (cow/horse), pig sty, sheep pen, stable, each with empty/occupied states and door
> open/closed. Animal sprites (idle 2f, walk 4f x 4 dirs, eat/graze 2f, sleep 1f): chicken, rooster, chick, cow, calf,
> pig, piglet, sheep (shorn/woolly), lamb, horse, foal, dog, cat. Items/icons: egg, milk bucket, wool bundle, hay bale,
> feed trough, water trough, shearing shears, milk pail. Needs icons (hunger, thirst, happy, sick).
> **Wired 2026-11-10 (phase 5d)**: one pose each (hen, rooster, chick, cow, calf/foal, pig, sheep a/b, horse brown/grey,
> pony), the four occupied-state buildings (coop, cow barn, sty, pen), icons egg / hay bale / milk pail and the four need
> icons. **Still needed**: walk (4 dirs), graze / eat and sleep frames per animal; piglet, lamb, shorn sheep, separate
> calf; empty vs occupied building states and door open / closed; a Stables animal variant; dog / cat (staged, unused).

### 97. Hero and villager life (phases 4-5)
> Villager task animations (4 dirs x 4 frames): sowing, watering, harvesting, hauling, building (hammer), chopping,
> mining, cooking, sleeping in bed (top-down lying), eating at table, sitting. Hero stamina/energy bar and tool
> hotbar UI frame, inventory slot frames, 'tired' and 'hungry' status icons.

### 98. Building blueprints (building templates, 2026-11-10)
> The Blueprints tab's thumbnails and ghost (`client/src/blueprints.ts`) draw floors, beds, furniture, doors and
> windows with the #90 / #91 piece art; everything else is a stand-in colour block from the legend
> (`shared/src/buildingTemplates.ts` BUILDING_LEGEND): **walls** (no single-tile wall art outside the autotiler),
> **stations** standing in a room (forge, oven, mill stone, loom, brew vat, inn counter, altar, jeweller's bench: today
> the whole prefab building sprite is drawn on that one tile) and **annexes** (market stall, barn, stables, coop, ...).
> Wanted: 32x32 top-down **station pieces** that read as furniture inside a room (an anvil + forge hearth, a clay oven,
> a millstone on a frame, a loom, a brew vat, a tavern counter with kegs, an altar, a jeweller's bench), so a modular
> Blacksmith reads as a room with a forge rather than a house sprite inside a house; a small **wall icon** per wall
> material for the thumbnails; and an optional **blueprint ghost** tint / hatch overlay. Files:
> `station{Forge,Oven,Millstone,Loom,BrewVat,Counter,Altar,Jeweller}.png`, `thumbWall{Wood,Stone}.png`.

### 99. Settlement templates (2026-11-10)
> Neutral settlements are now built from the modular building templates (#98), so the #76 settlement sprites are
> needed less: houses, taverns, chapels, smithies are walls / floors / furniture with roofs. Still wanted / stand-ins
> now: a **well** (today a single Water tile), a **village palisade gate** that matches the wood wall (the stone
> `Gate` art is used), **market stalls** for a plaza (the Bazaar prefab sprite stands in, #76 `settleMarket.png`),
> a **town keep / town hall** for the anchor tile (the SiteKeep stand-in; #76 `settleHall.png` / `settleKeep.png`),
> **signpost / notice board** props for the trader / quest slots (#76), and **lantern posts / fences** in a town
> palette. No new tile types were added.

### #90-#97 delivery status (2026-11-09: sliced ChatGPT atlases, `art-sources/rimworld-stardew/`)
> Processed by `art-sources/rimworld-stardew/wire_sprites.py` into `client/public/sprites/<group>/`; registry and
> loaders in `client/src/spriteRegistry.ts`. Every wired file is optional: a missing png falls back to the procedural
> stand-in (structureArt.ts) or hides its icon. The art is AI-painted (~60-110 px native, not a pixel grid); it was
> box-downscaled to 64 px per tile (2x the 32 px grid) / 32 px icons with hard alpha and despecked.
>
> **Wired:**
> - #90: wood / stone **doors** (closed + open, H + V) and **windows** (H + V), baked onto the EXISTING wall straights
>   (`woodWall_10/05`, `stoneWall_10/05`) so they sit in a wall run at the walls' 68 px/tile scale. Wood closed =
>   `door_wood_plank_closed_a`, wood open = derived doorway (dark opening + leaf), stone = `door_wood_stonearch_closed`
>   / `_open_a`; windows = `window_wood_glass_a` / `window_stone_arch_a`; V = squashed into the column (edge-on
>   stand-in). **Floors**: wood (`floor_wood_a_1-3`) and stone (`floor_flagstone_1-3`), 3 variants by tile hash.
>   **Roofs**: thatch (wood rooms), clay tile (stone rooms), cropped from the slope pieces (one plain tile, no ridge /
>   eave yet); the cutaway keeps the code alpha fade (the atlas `*_faded` roofs are too rough). Blueprint ghosts keep
>   the code overlay (faded + tinted piece; the atlas ghosts are opaque blue rectangles).
> - #91: bed, table, chair, chest, shelf (bookshelf), hearth (lit fireplace), lamp (candelabra), rug, workbench,
>   statue, weapon rack. Room panel: role badges (bedroom, barracks, kitchen, workshop, hall, storeroom, church) and
>   stat icons (size, beauty, cleanliness, warmth).
> - #92: stockpile filter icons in the Zones panel. Resources panel: tool / gear icons (axe, pickaxe, hammer & tongs,
>   flour sack, weapons, armour). Zone overlays stay Graphics (the atlas zones are opaque baked rectangles).
>
> **Staged only** (copied, not used yet): `structure/extra/` (double / red / straw beds, long table, stool, bench,
> wardrobe, stove, cauldron, oven, braziers, candelabras, lantern, banners, armour stand, altar, well, barrel, sacks,
> crates, stalls, cart, iron / barred doors, shutters, stained glass, roof corner / ridge / peak pieces, dirt floors,
> rug variants, scaffold), `structure/roof_slate.png`; `icons/` work types (6), priority 1-4 + off, hero tools (axe,
> hoe, pickaxe, scythe, seed bag, watering can), item icons (egg, milk, wool, hay, shears, trough), needs (happy,
> heart, sick, thirst, hungry, tired), season emblems (small + large), rain icon, festival, room wealth / hospital /
> castle; `seasons/` (4 trees, 4 ground tiles, water), `weather/` (opaque overlays, reference only), `crops/`,
> `animals/` (17 animals, 4 occupied buildings), `villager/` (task animations: sow, water, harvest, haul sack,
> hammer, chop, mine, cook, sleep in bed, eat, sit, bowl carry; plus the hat farmer's 2 haul sets), `ui/` (stamina
> bar, hotbars). The villager animations are NOT wired: they are a different character (curly-haired, ~100 px,
> one facing) from the colonist sprites, so hauling / building / sleeping frames would visibly swap the person.
>
> **Still needed (regenerate in ChatGPT).** Prompt rules for every request: "pixel art on a strict 32x32 px grid
> (1 art pixel = 1 px, no anti-aliasing, no painterly shading), 1 px dark outline, TRANSPARENT background (no
> vignette, no checkerboard, no glow backing), ONE asset class per image, laid out on a labelled grid with 8 px
> gaps, top-down 3/4 view matching the attached wall / colonist sprites":
> 1. **Wall connection sets** (#90): wood palisade, wood plank, stone block, reinforced stone; all 16 neighbour-mask
>    pieces each in mask order N=1 E=2 S=4 W=8, plus damaged variants. (Walls currently keep the old art.)
> 2. **Doors / windows in walls** (#90): per material (wood, stone, iron-bound) a 32x40 piece for H (east-west wall,
>    face-on) and V (north-south wall, edge-on), states closed / open / broken; windows H / V intact / damaged.
> 3. **Seamless roofs** (#90): thatch, wood shingle, clay tile, slate as 32x32 seamlessly tiling fills + ridge line,
>    eave edge (4 sides) and corner pieces; a semi-transparent cutaway version with clean edges.
> 4. **Floors** (#90): dirt, wood planks, flagstone, cobble, carpet red / blue / green, 4 seamless variants each.
> 5. **Furniture** (#91): unlit + 2-frame lit idle for hearth / lamp / candle; double bed; crate shelf; hospital
>    bed; 16 px room HUD icons as flat glyphs (not 60 px shields).
> 6. **Zone overlays** (#92): truly translucent 32x32 edge-tile sets (fill + 4 edges + 4 corners) per zone colour,
>    zone cursor icons, stockpile "everything" icon, the 5 missing work icons (woodcutting, hunting, cooking,
>    doctor, fighting, research).
> 7. **Hauling / task animations** (#92 / #97) drawn ON THE EXISTING COLONIST SPRITE (same character, size and
>    palette), 4 directions x 4 frames: carry sack / crate / log / stone, hammer, sow, water, harvest, chop, mine,
>    cook, sleep in bed (top-down lying), eat, sit.
> 8. **Crops** (#93): 5 stages for wheat, flax, vegetables, berries, root, with season variants; untilled grass.
> 9. **Seasons / weather** (#94): snow-covered rocks / roofs, weather as transparent particle frames (rain streaks,
>    snowflakes, fog wisps, lightning flash), small sun / snow / storm icons.
> 10. **Interiors** (#95): modular back-wall / side-wall / cutaway pieces per building type, exit mat, lighting
>     overlays on transparency.
> 11. **Animals** (#96): idle 2f, walk 4 dirs x 4f, eat / sleep for each animal; piglet, lamb, shorn sheep, calf;
>     buildings empty + occupied, stable; feed trough.

> **Stardew phase 5a (hero tools, 2026-11-09) wiring:** the hotbar uses the staged `icons/tool_*` (hoe, watering can,
> seed bag, scythe, axe, pickaxe) and the Resources panel shows them for the new items. Not used: `ui/hotbar_a.png` /
> `hotbar_b.png` (5 slots, one with a baked-in pickaxe / highlight; the hotbar needs 6) and `ui/stamina_bar.png` (fill
> baked in) - the frame and the energy bar are CSS stand-ins. Tilled / watered soil and hero-plot crops are the Graphics
> stand-ins of the zones layer (watered = darker soil). **Still needed for 5a:** hero tool swing animations on the
> EXISTING hero sprite, 4 directions x 3-4 frames each: hoe swing, watering can pour, sowing (scatter), scythe sweep,
> axe chop, pickaxe strike (today the sword swing stands in on Space / click, plus the progress ring); a 6-slot empty hotbar frame + selected-slot frame
> (32x32 slots, transparent between slots); an empty stamina bar frame + separate fill strip; a faced-tile cursor
> (32x32 corner brackets); seed bag icons per crop (wheat, hemp).

> **Stardew phase 5b (seasons / weather, 2026-11-09) wiring:** the calendar row under the sundial uses the staged
> `icons/season_<season>.png` (32x32 at 18 px) and `icons/weather_rain.png`; the other weather kinds hide their icon and
> show the word. Seasons are TINTS (shared/src/calendar.ts SEASON_GROUND_TINT / SEASON_TREE_TINT on the grass floor /
> scatter containers and on tree sprites); the staged `seasons/` tree / ground pngs are not used (single opaque tiles
> that do not match the floor's two-texture variety or the tree art's size). Weather is a procedural screen overlay
> (rain / storm streaks, snow dots, fog veil, storm flash); the staged `weather/` pngs are opaque baked tiles (reference
> only). **Still needed for 5b:** weather icons 32x32 for clear (sun), storm, snow, fog (matching `weather_rain`);
> seasonal floor variants (2 textures each for spring flowers, autumn leaves, winter snow) at the grass floor's size;
> seasonal tree variants (blossom / autumn / bare+snow) for every tree texture (same canvas and anchor as the current
> trees); a frozen water tile set; a withered / frost-killed crop stage; optional puddle and snow-cover ground overlays
> (transparent 32x32, 2-3 variants each); a soft transparent rain-streak / snowflake particle sprite (8x16 / 8x8).

> **Stardew phase 5c (interiors, 2026-11-09) wiring:** `client/src/interior.ts` tiles each room procedurally: floors are
> the wired `structure/floor_wood_*` / `floor_stone_*` (dirt = a flat stand-in colour), walls are drawn in code (a top
> cap, a plank / stone-course face toward the room), the exit mat is a drawn red rug, the warm vignette is a canvas
> radial gradient. Furniture uses the wired furniture pngs (bed, chest, table, chair, lamp, rug, shelf, statue, weapon
> rack, workbench) and, loaded on demand, the extra atlas pieces (`structure/extra/`: fireplace_lit_b, wardrobe,
> altar_candles, bench as pews, oven_round, barrel, crates_barrels_stack, sacks_pile, hay_pile_crate, armor_stand,
> banner_red, stove_iron as the forge, stall_market_red, candelabra_b, bed_blue_double), each scaled into one tile.
> Counter, anvil and high seat are coloured stand-in blocks. NPCs reuse the colonist sprites (settlement NPCs: the
> villager / bishop art). The staged whole-room paintings (`art-sources/rimworld-stardew/normalised/builder/
> interior_room_*`) do not fit the template grids: not used. **Still needed for 5c (#95):** per building type, 32x32
> interior wall sets on transparency (back wall with a face, side walls / caps, inner corners, a door-in-wall for the
> exit, wood / stone / plaster variants for house, tavern, shop, church, barracks, smithy, bakery, barn, great hall);
> an exit mat / threshold tile; a dirt floor tile (2-3 variants) matching the wood / stone floors; a shop counter
> (1x1 pieces: end, middle, corner), an anvil, a high seat / throne, a church pew and altar sized to one tile; a
> transparent warm lighting overlay (vignette + window light shafts); stairs up / down (later).

#77-#83 were delivered on 2026-10-30 (see "Already sourced", Batch 2); prompts removed. Still missing from those
prompts: #82 the Follow order icon, the state glyphs (wavering / routing / outflanked) and the time-control icons;
#83 has no veteran attack row (the veteran charge row stands in) and no separate idle frame.

## Regenerate (2026-10-29 delivery review)

Delivered 2026-10-29 and good: #45-#48 (knight, cavalry, spearman, pikeman tiers), #53, #54, #57, #58, wired
2026-10-29 (see "Already sourced"). These two sheets came back unusable and need regenerating:

- **#49-#52 equipment, per-family armour and weapon icons, relics, loot sparkle** (`Medieval Pixel Art Equipment and
  Relics.png`): the icons are blurry painted images, not clean pixel art; tier labels repeat or are wrong (T2 twice in
  a row, two rows both titled weapon); the sparkles are faint. Redo as crisp 32x32 pixel icons with a metal-coloured
  frame per tier (bronze / silver / gold) and a distinct silhouette per family, one clearly labelled row each.
- **#55-#56 rider and hero equipment overlays** (`Medieval Knight Equipment Sprite Atlas.png`): blurry, garbled titles,
  and the pieces are scattered rather than laid out per animation frame. Redo as a clean grid, one row per slot (head,
  chest, legs, weapon, cloak) per frame of the base walk/attack animation, each piece pre-positioned to overlay the base
  sprite frame exactly (same canvas size as the base frames), per tier T1-T3 plus a relic tint.

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
