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

## New requests (2026-10-28 batch) — cavalry, siege

For ROADMAP "Cavalry & siege" (2026-10-27): cavalry from the Stables, battering rams and catapults from the Siege
Workshop, the raids' own rams and catapults, and knights recast as shock troops. Everything below runs on
PLACEHOLDER art today (table at the end). Same convention as above: chunky 16-bit pixel art, thick black outline,
flat cel-shaded color, transparent background, one generation per block, an explicit **scale line** anchoring to an
existing sprite, "match the existing X sprite".

### 37. Cavalry rider — walk/gallop + attack + charge pose

The Stables' riders borrow the player's own ride cycle (tinted blue-grey), so they read as extra copies of the player.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A mounted cavalry soldier of the colony, clearly distinct from the existing mounted-knight player sprite (blue banner, lance, no tabard): an open-faced steel helm with a short plume, a heraldic blue-grey tabard with a pale gold chevron over mail, a kite shield on the left arm, a couched lance (gallop/charge) or a drawn sword (attack); the horse is barded in a matching blue-grey caparison with darker trim and a steel chanfron. No banner. Match the art style, outline weight and horse proportions of the existing playerWalk / playerAttack frames. **Scale: same horse-and-rider size as the player's playerWalk0 frame (about 50px tall on screen without the banner); identical in every frame.** In one image: Row 1 "Walk / Gallop" — 4 frames facing right, a brisk gallop. Row 2 "Attack" — 3 frames: sword raised, cut down past the horse's neck, recovery. Row 3 "Charge" — 1 frame: lance couched level, horse at full stretch, rider leaning forward. Transparent background, hooves on the bottom edge of a shared canvas, clean PNG. Files: `cavalryWalk0-3`, `cavalryAttack0-2`, `cavalryCharge0`.

### 38. Stables building

> Pixel art building sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, the same three-quarter iso-top-down view and muted palette as the existing Hall of the Sworn (barracks / castleLv2 / castleLv3) and Archery Range art. A long timber-and-stone stable barn: fieldstone lower walls, dark timber framing and a steep wooden-shingle roof, a row of open stalls along the front with two or three horse heads looking out, a hay rack and a water trough, a small blue-grey pennant flag on the roof ridge matching the cavalry tabards. **Scale: the same footprint and height as the existing barracks.png (one tile wide at the base, rising about two tiles); it must read clearly as a stable, not a castle.** Transparent background, building base on the bottom edge, clean PNG. Optional Lv2 / Lv3 variants (longer, a second stall row, a tack-room tower) in the same image, left to right. Files: `stables`, `stablesLv2`, `stablesLv3`.

### 39. Siege Workshop building

> Pixel art building sprite, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, the same three-quarter iso-top-down view and muted palette as the existing Blacksmith and Hall of the Sworn art. A siege engineers' workshop: an open-sided timber shed under a heavy plank roof, a half-built catapult frame and a stack of oak beams inside, a big treadwheel crane at one end, coils of rope, iron fittings and a work bench out front, wood chips on the ground. **Scale: the same footprint and height as the existing blacksmith.png.** Transparent background, building base on the bottom edge, clean PNG. File: `siegeWorkshop`.

### 40. Battering ram — player and mob variants

> Pixel art siege-engine animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette, viewed from the side facing right like the other unit sprites. TWO variants in one image, one per half. Top half "Colony ram": an iron-shod oak log slung on chains under a pitched wooden roof covered in wet hides, on four solid wooden wheels, two crew legs visible underneath pushing; neat carpentry, a small blue-grey pennant. Bottom half "Raider ram": the same idea built crudely by orcs and bandits — a rough tree trunk with a scrap-iron spike head, a lean-to roof of mismatched planks, rusted scrap metal and stitched animal hides, uneven wheels, a bone or skull charm. Match the outline weight and palette of the existing cart prop and the Ogre / Bandit sprites. **Scale: about 1.2x the existing cart.png prop (roughly 40px wide on screen), identical size in every frame.** For each variant: Row 1 "Move" — 4 frames, wheels turning. Row 2 "Swing" — 3 frames: log drawn back, swung forward, impact with a few splinters. Row 3 "Destroyed" — 1 frame: collapsed roof, broken wheel. Transparent background, wheels on the bottom edge of a shared canvas, clean PNG. Files: `batteringRamWalk0-3`, `batteringRamAttack0-2`, `batteringRamDestroyed`, and `mobBatteringRam...` for the raider variant.

### 41. Catapult — player and mob variants

> Pixel art siege-engine animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette, viewed from the side facing right. TWO variants in one image, one per half. Top half "Colony catapult": a torsion catapult on a four-wheeled oak frame, a long throwing arm with a rope-net sling and a twisted-rope skein, iron brackets, a small blue-grey pennant. Bottom half "Raider catapult": a crude orc/bandit build — a lashed-together frame of rough logs and scrap iron, a bent arm with a hide sling, a pile of jagged rocks, skull ornaments. Match the outline weight and palette of the existing cart and crate props. **Scale: about 1.2x the existing cart.png prop (roughly 40px wide on screen), identical size in every frame.** For each variant: Row 1 "Move" — 4 frames, wheels turning. Row 2 "Load" — 3 frames: arm winched down, boulder placed in the sling, ready. Row 3 "Fire" — 3 frames: arm released, arm at full swing with the boulder leaving, arm settling. Row 4 "Destroyed" — 1 frame: snapped arm, broken frame. Transparent background, wheels on the bottom edge of a shared canvas, clean PNG. Files: `catapultWalk0-3`, `catapultLoad0-2`, `catapultFire0-2`, `catapultDestroyed`, and `mobCatapult...` for the raider variant.

### 42. Boulder projectile + impact puff / debris VFX sheet

> Pixel art VFX sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, matching the existing fx-poof / fx-spark / fx-arrow effects. Row 1 "Boulder" — 4 frames of a rough grey-brown rock tumbling (rotation steps), about 12px across on screen (a bit smaller than the fx-spark sprite). Row 2 "Impact" — 4 frames: a burst of brown-grey dust, flying stone chips and wood splinters expanding then thinning out, about 40px across at its widest (a little bigger than fx-poof). Transparent background, each row on one shared canvas, clean PNG. Files: `fx-boulder0-3`, `fx-boulderImpact0-3`.

### 43. Cavalry charge dust trail VFX

> Pixel art VFX sprite sheet, chunky 16-bit retro style, thick black outline (thin on the wisps), flat cel-shaded coloring, matching the existing fx-poof effect. One row "Charge dust" — 4 frames of a low dust cloud kicked up behind galloping hooves, drifting back and fading, with a few clods of earth; about 24px wide on screen. Transparent background, one shared canvas, clean PNG. Files: `fx-chargeDust0-3`.

### 44. Knight shock-trooper — heavier-armour variant (walk + attack)

Knights are now shock troops (front centre); their art should look heavier than the militia line around them.
> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The existing Knight, upgraded to a heavy shock trooper: full plate with broad layered pauldrons, a great helm with a narrow visor slit, a tall tower shield with a painted colony sigil, a heavy arming sword or flanged mace, a short dark surcoat. Same character and palette as the existing knightWalk / knightAttack frames, just heavier. **Scale: the same body height as the existing knight frames (about 28px on screen); the tower shield may reach slightly above the shoulder.** In one image: Row 1 "Walk Cycle" — 4 frames facing right, a heavy measured step behind the shield. Row 2 "Attack Cycle" — 3 frames: shield braced, a shield-bash plus overhead cut, recovery. Transparent background, feet on the bottom edge of a shared canvas, clean PNG. Files: `knightShockWalk0-3`, `knightShockAttack0-2`.

### Placeholders in use (wire the real art here)

| Item | In game as | Placeholder now | Where to wire it |
|---|---|---|---|
| #37 Cavalry | colonist `cavalry` | player `playerWalk0-3` / `playerAttack0-1`, tinted `0xa8b8d8`, 50px tall | `COLONIST_OPTIONAL_ANIM_URLS.cavalry` already looks for `cavalryWalk0-3` / `cavalryAttack0-2` (loads them and drops the tint when present) |
| #38 Stables | `TileType.Stables` | `castleLv2.png`, tinted `0xd8c0a0` | `TILE_OPTIONAL_ART` already looks for `stables.png`; Lv2/3 via `TILE_LEVEL_ART` |
| #39 Siege Workshop | `TileType.SiegeWorkshop` | `blacksmith.png`, tinted `0xc8a888` | `TILE_OPTIONAL_ART` already looks for `siegeWorkshop.png` |
| #40 Ram (colony) | colonist `batteringRam` | `cart.png` (walk + action), tinted `0xc89a6a`, 30px | `COLONIST_ANIM_URLS.batteringRam` |
| #40 Ram (raider) | mob `batteringRam` | static `cart.png`, tinted `0xb07a4a` (`MOB_TINT`) | `MOB_SPRITE_URL_OVERRIDES` / add a `MOB_VARIANT_URLS` entry |
| #41 Catapult (colony) | colonist `catapult` | `crate.png`, tinted `0xb08a60`, 30px | `COLONIST_ANIM_URLS.catapult` |
| #41 Catapult (raider) | mob `catapult` | static `crate.png`, tinted `0x9a7048` (`MOB_TINT`) | `MOB_SPRITE_URL_OVERRIDES` / `MOB_VARIANT_URLS` |
| #42 Boulder + impact | `AttackEffect.boulder` | `fx-spark` tinted `0x7a5530` (arcing), `fx-poof` tinted `0xb09070` puff | `spawnEffect` (`e.boulder` branch) |
| #43 Charge dust | (not shown yet) | none | the server has no charge flag in snapshots yet; add one (or infer from cavalry speed) |
| #44 Knight shock | colonist `knight` | the existing knight frames | `COLONIST_ANIM_URLS.knight` (or an optional set) |

## New requests (2026-10-29 batch) — armour & weapon tiers

For ROADMAP "Armour & weapons" (2026-10-28): knights, spearmen, pikemen and cavalry now muster with armour and a
weapon of tier 1-3 from the colony's stock (forged at the Blacksmith, tier = its level; looted from armoured foes
and camps). Today the tier only shows as a thin ring at the unit's feet (table at the end). Same convention as
above: chunky 16-bit pixel art, thick black outline, flat cel-shaded color, transparent background, one generation
per block, an explicit **scale line** anchoring to an existing sprite.

**Tier progression (applies to every on-unit sheet below):** tier 1 "iron & leather" — plain, functional, dull
grey iron over brown leather, no ornament; tier 2 "steel" — brighter steel, coloured trim on the tabard / edges,
added pauldrons and a gorget; tier 3 "gilded plate" — full plate with gold edging and filigree, a plume or crest,
a faint warm glow on the weapon edge. The silhouette must stay the same unit at every tier (same pose, height and
feet position), only heavier and brighter, so the three rows read as one progression. Rarity colours used across
icons and UI: bronze `#cd7f32` (T1), silver `#c0c8d0` (T2), gold `#f2c94c` (T3) — the same colours as today's
placeholder rings.

### 45. Knight (shock) — armour tiers 1-3, walk + attack

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The existing Knight shock trooper (see #44: tower shield, arming sword) in THREE armour tiers, one tier per row pair: tier 1 iron mail and leather with a plain kettle helm and a plain wooden shield; tier 2 polished steel plate with pauldrons, a blue-grey tabard trim and a painted shield rim; tier 3 gilded full plate with gold filigree, a crested great helm with a plume, a gold-rimmed shield and a faintly glowing blade. Match the art style, proportions and palette of the existing knightWalk / knightAttack frames. **Scale: the same body height as the existing knight frames (about 28px on screen) in every frame and tier; the plume may rise a few pixels above the helm.** In one image, 6 rows: Rows 1-2 tier 1 "Walk" (4 frames facing right) and "Attack" (3 frames: shield braced, cut, recovery); rows 3-4 the same for tier 2; rows 5-6 for tier 3. Transparent background, feet on the bottom edge of each row's shared canvas, clean PNG. Files: `knightT1Walk0-3`, `knightT1Attack0-2`, `knightT2...`, `knightT3...`.

### 46. Spearman — armour & weapon tiers 1-3, walk + attack

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The existing Spearman in three tiers: tier 1 padded gambeson, leather cap, a plain ash spear with an iron head and a round wooden buckler; tier 2 a steel brigandine with small pauldrons, a steel kettle helm, a longer spear with a steel leaf head and coloured pennon; tier 3 gilded half-plate, a crested helm, a gold-banded spear with a gleaming head. Match the existing spearman sprite's art style, proportions and palette. **Scale: the same body height as the existing spearman sprite (about 26px on screen); the spear may extend past the frame edge by the same amount as today.** In one image, 6 rows: per tier a "Walk" row (4 frames facing right) and an "Attack" row (3 frames: spear drawn back, thrust, recovery), tier 1 at the top. Transparent background, feet on the bottom edge of each row, clean PNG. Files: `spearmanT1Walk0-3`, `spearmanT1Attack0-2`, `spearmanT2...`, `spearmanT3...`.

### 47. Pikeman — armour & weapon tiers 1-3, walk + attack

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The existing Pikeman in three tiers: tier 1 quilted jack and an open iron morion, a long plain pike; tier 2 a steel breastplate with tassets and pauldrons, a combed morion, a pike with a steel langet and a coloured tassel; tier 3 gilded breastplate and morion with a plume, a gold-banded pike with a polished head. Match the existing pikeman sprite's art style, proportions and palette. **Scale: the same body height as the existing pikeman sprite (about 26px on screen); the pike keeps today's length.** In one image, 6 rows: per tier a "Walk" row (4 frames facing right, pike shouldered) and an "Attack" row (3 frames: pike levelled, thrust, recovery), tier 1 at the top. Transparent background, feet on the bottom edge of each row, clean PNG. Files: `pikemanT1Walk0-3`, `pikemanT1Attack0-2`, `pikemanT2...`, `pikemanT3...`.

### 48. Cavalry rider — armour & weapon tiers 1-3, gallop + attack

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. The cavalry rider of #37 in three tiers, rider AND horse: tier 1 mail shirt, leather barding, a plain sabre and a plain wooden lance; tier 2 steel plate with pauldrons, a blue-grey caparison with darker trim and a steel chanfron, a steel sabre and a pennoned lance; tier 3 gilded plate with a plumed helm, a gold-trimmed caparison and a gilded chanfron, a gleaming sabre and a gold-banded lance. Match #37 (or, until it exists, the player's playerWalk frames) for horse proportions, art style and palette. **Scale: the same horse-and-rider size as the player's playerWalk0 frame (about 50px tall on screen) in every frame and tier.** In one image, 6 rows: per tier a "Gallop" row (4 frames facing right) and an "Attack" row (3 frames: sabre raised, cut past the horse's neck, recovery), tier 1 at the top. Transparent background, hooves on the bottom edge of each row, clean PNG. Files: `cavalryT1Walk0-3`, `cavalryT1Attack0-2`, `cavalryT2...`, `cavalryT3...`.

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

### 53. Blacksmith — forging animation (4 frames)

> Pixel art building animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, the same three-quarter iso-top-down view, footprint and palette as the existing blacksmith.png. The Blacksmith at work: the smith at the anvil out front with a hammer, the forge mouth glowing. One row, 4 frames: hammer raised, hammer striking with a burst of orange sparks, sparks scattering and the forge flaring, hammer lifting again. Only the smith, sparks and forge glow change between frames. **Scale: identical to the existing blacksmith.png in every frame.** Transparent background, building base on the bottom edge, clean PNG. Files: `blacksmithForge0-3`.

### 54. Blacksmith Lv2 / Lv3 upgraded art

> Pixel art building sprites, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, the same view and palette as the existing blacksmith.png. Two upgraded versions side by side: Lv2 "Smithy" — a larger stone forge with a tall brick chimney, a second anvil, a quenching trough and racks of steel blades and breastplates; Lv3 "Armoury" — a stone-and-timber hall with a double forge, a bellows wheel, a display of gilded plate on a stand and a gold-trimmed shield over the door. **Scale: Lv2 the same footprint as blacksmith.png and about 15% taller; Lv3 the same footprint and about 30% taller.** Transparent background, building base on the bottom edge, clean PNG. Files: `blacksmithLv2`, `blacksmithLv3`.

### 55. Player rider — visible-equipment overlay set (3 tiers + relic)

Paper-doll layers drawn over the player's existing mounted-knight frames (no new body).
> Pixel art equipment overlay sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, drawn to sit EXACTLY over the existing playerWalk0-3 and playerAttack0-1 frames (same canvas, same pixel positions; everything else transparent). Four layers: helm, chest (cuirass + pauldrons), cloak, weapon-in-hand (lance on walk, sword on attack). Four sets: tier 1 iron & leather, tier 2 steel with trim and pauldrons, tier 3 gilded plate with a plume and a faint glow, and a relic set (purple-teal rune light, matching #51). **Scale: identical to the player frames (about 68px tall with the banner); frame-for-frame registered.** Layout: one block per set (tier 1, tier 2, tier 3, relic), each block with a "Walk" row (4 frames) and an "Attack" row (3 frames — a 3-frame cut to replace the current 2-frame thrust), each row showing the four layers stacked as separate rows in fixed order (helm, chest, cloak, weapon). Transparent background, clean PNG. Files: `playerEquip{T1,T2,T3,Relic}{Helm,Chest,Cloak,Weapon}{Walk0-3,Attack0-2}`.

### 56. Generic HERO unit — base + visible-equipment overlay set

> Pixel art character animation sprite sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, muted desaturated medieval palette. A generic on-foot hero of the colony: a bareheaded figure in a plain linen tunic and boots, neutral pose, built as a paper-doll base. Then the same overlay layers as #55 — helm, chest, cloak, weapon-in-hand (sword) — in tier 1 / tier 2 / tier 3 / relic sets, drawn to register exactly over the base. Match the proportions and palette of the existing knight frames. **Scale: the same body height as the existing knight frames (about 28px on screen).** Rows: base "Walk" (4 frames facing right) and "Attack" (3 frames: raise, cut, recovery); then per set the four layers over the same 4 + 3 frames. Transparent background, feet on the bottom edge, clean PNG. Files: `heroWalk0-3`, `heroAttack0-2`, `heroEquip{T1,T2,T3,Relic}{Helm,Chest,Cloak,Weapon}{Walk0-3,Attack0-2}`.

### 57. Spell icons — 8 x 32x32 placeholder sheet

> Pixel art UI icon sheet, chunky 16-bit retro style, thick black outline, flat cel-shaded coloring, matching #50. A strict grid of 8 cells of 32x32 in one row, each icon inside the same consistent frame (a dark rounded square with a thin parchment-gold border): fire bolt (orange streak), heal (green cross with leaves), ward (pale blue rune circle, matching the Ward Stone's glow), thunder (white-blue lightning fork), frost (ice-crystal shard), summon (purple portal with a rising silhouette), rally / banner buff (a raised blue-grey banner with a gold chevron), curse (a sickly green-violet skull mark). **Scale: each symbol fills about 24px of its 32x32 cell; identical frames.** Transparent outside the frames, clean PNG. Files: `spellSheet.png` (`spell-fireBolt`, `spell-heal`, `spell-ward`, `spell-thunder`, `spell-frost`, `spell-summon`, `spell-rally`, `spell-curse`).

### 58. Character-sheet UI — parchment profile panel with slot sockets

> Pixel art UI panel, chunky 16-bit retro style, thick dark-ink outline, flat shading, matching the game's existing parchment UI skin (the Colony panel and building-info cards: aged cream parchment, dark brown ink borders, red wax-seal accents). A portrait-oriented profile panel: a framed portrait window at the top left, a name / title banner beside it, and empty square slot sockets (inset parchment wells with a thin inked rim, each with a faint silhouette glyph of what goes there): head, chest, legs, weapon, off-hand / shield, trinket x2, and a row of 4 spell slots at the bottom; a small stat block area on the right. Slots sized for the 32x32 icons of #50/#51/#57 plus a 3px rim. **Scale: about 320x420 px at 1x; slot sockets 38x38.** Transparent outside the panel, clean PNG, plus the empty socket as a separate 38x38 PNG. Files: `ui-characterSheet.png`, `ui-slotSocket.png`.

### Placeholders in use (wire the real art here)

| Item | In game as | Placeholder now | Where to wire it |
|---|---|---|---|
| #45-#48 tiered units | `ColonistSnapshot.armourTier` / `weaponTier` (knight, spearman, pikeman, cavalry) | the unit's normal sprite + a thin armour-tier ring inside the role ring (bronze `0xcd7f32` / silver `0xc0c8d0` / gold `0xf2c94c`, `ARMOUR_TIER_COLORS`); weapon tier not shown on the map | `drawRoleRings` (ring); swap the anim set by tier in the colonist sprite code (`COLONIST_ANIM_URLS` / an optional per-tier set) |
| #49 stock icons | Colony panel `#stat-equipment` | text only ("Armour T1/T2/T3: 2/0/1 · Weapons: 3/1/0", amber when a slot is empty) | `refreshEquipmentLine` |
| #50, #51, #55-#58 | (no hero, player gear, relics, spells or character sheet in the game yet) | none | future hero / character-sheet work |
| #52 loot sparkle | drops / camp loot (server toast only) | none (toast only) | needs a drop position in the snapshot or an `AttackEffect` flag |
| #53 forging | Blacksmith forge queue (`BuildingInfo.forge`) | static `blacksmith.png` | needs the forge-busy state per Blacksmith in the snapshot |
| #54 Blacksmith Lv2/Lv3 | `TileType.Blacksmith` levels 2-3 | `blacksmith.png` | `TILE_LEVEL_ART` |

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
