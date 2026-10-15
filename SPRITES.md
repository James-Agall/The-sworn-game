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

- `art-sources/Fantasy Game Effect Sprite Sheet.png` (in Downloads, not copied): a lower-quality duplicate of VFX
  sheet 2 with stray gate art. Ignored.

---

## Outstanding — with ready-to-use prompts

(#11, #13, #17-#23 were sourced on 2026-10-14 and #16, #24-#36 on 2026-10-15, and their prompts removed. See
"Already sourced" above. Still open: #14 and #15 below. Delivered but not yet in the game: the earlier Castle Ruin,
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

### 15. Ogre Warlord — Castle Ruin boss (static + walk + attack + slam)

For Phase 5's boss: "a bigger version of our most powerful mob." Needs its own look, not just an upscaled Ogre.
> Pixel art monster animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated dark-fantasy palette. A towering ogre warlord, a clear escalation of the existing Ogre sprite (same pinkish-brown skin, bald head, tusks, heavy build): add a jagged iron crown fused into the skull, rusted shoulder plates and a studded iron belt, red war-paint streaks across the face and chest, a tattered dark banner strapped to its back, and a huge spiked iron-and-stone maul. Should read instantly as "the boss". Match the existing Ogre's art style, outline weight and palette. **Scale: the same drawing style as the Ogre, but 1.6x larger in every dimension (the Ogre is about 51px tall on screen, so the Warlord is about 82px tall); keep it identical in size in every frame.** In one image: Row 1 "Walk Cycle" — 4 frames, facing right, a slow heavy stomp. Row 2 "Attack Cycle" — 3 frames: maul raised overhead, slammed down with debris, recovery. Row 3 "Roar" — 3 frames: head back, chest out, a shockwave ring, settle. Plus one centered static idle pose. Transparent background, feet on the bottom edge of a shared canvas, clean PNG.

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
