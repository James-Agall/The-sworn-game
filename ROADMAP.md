# colony2d — Balance Review & Roadmap

A full pass over everything built this session: what's solid, what's rough, what's unbalanced,
and where the game could go from here. Written as a planning document, not a task list to execute
blindly — the "Open questions" section at the end needs your input before some of this gets
prioritized.

---

## 1. Current state (what actually exists today)

**Economy:** wood/iron/rock gathering, grain/meat/fruit farming (two separate production
pipelines — Barn+FarmPlot for grain, farmhand-staffed Pasture/Orchard/Wool/Cotton farms for
everything else), Tailor/Blacksmith/Jeweler crafting chains, Market (resource exchange),
Trading Post (gold shop), Brewery→Tavern (grain→alcohol→gold), Bazaar.

**Population:** Town Center grants a flat +10 cap; Houses stack on top (House→Big
House→House Lv2).

**Military:** Knight (Barracks→Castle Lv2→Lv3), Archer (Archery Range/Tower), Militia→Spearman→
Pikeman (double garrison, weaker per-unit), Bishop (healer). Full RTS layer: drag-select,
move/attack orders, task forces, Age-of-Empires-style box formations.

**Happiness:** colony-wide 0-100 score from food variety + scenery (tree density) + tavern
coverage, multiplies all production speed, drives desertion (<35, 15% nightly chance per soldier)
and mutiny (<15, whole garrison deserts). Deserters become a dormant hostile mob at the spot they
deserted. After 10 days, a deserter night (25% roll per day) makes them the core of that night's
raid, with fresh bandits filling it up (see "Raid waves" in §7).

**Monsters:** 10 kinds (Goblin → ... → Ogre) plus bandits. Night raids grow by day with no cap and
are built from day-gated factions (see "Raid waves" in §7). There are 3 special mechanics: Troll
regen, Giant Spider poison, and Dark Shaman heals nearby wounded mobs.

**World (landed):** map expanded to 80x80 (6400 tiles). 3-biome system (Plains ~51%, Hills ~24%,
Swamp ~24%) with real gameplay effects — Swamp -25% movement speed, Hills +20% mining speed,
Plains +20% farming speed. Impassable water ponds (8-12 per map, kept clear of spawn). Ruins
(undead-themed: skeleton/dark shaman/orc) and Encampments (bandit-guarded, bandit is currently
placeholder art reusing the Militia sprite) — both are world-gen POIs with dormant guardians that
only aggro when one of them is attacked, at which point the whole site wakes together. Deterministic
decorative nature scatter (grass/flowers/bushes) on Plains tiles.

**Known rough edges from this round, worth knowing:**
- Guards auto-engage anything within 7 tiles, so building military near a Ruin/Encampment will
  wake it without you choosing to.
- Water renders filling its tile exactly, under other tile art (a deliberate deviation from the
  normal building box-fit scaling, which would have made it spill into neighboring tiles).
- All Ruin/Encampment decoration tiles (including campfires, statues, rubble) block movement —
  a deliberate "one consistent rule" choice, easy to loosen later if some should be walkable.
- Trees can occasionally regrow on a tile a dormant guardian is standing on (cosmetic only — it
  walks out once woken).
- Welcome payload grew to ~26KB (tiles + biomes) and snapshots carry ~40 more world-gen mobs;
  noted as likely fine but not load-tested.

**Art:** every colonist, the player, every monster, and every building has real sprite art.
Knight and Archer have walk/attack animations; everything else is still a static pose (full
outstanding list + prompts in `SPRITES.md`).

---

## 2. Known bugs/gaps already identified but not yet fixed

These surfaced during this session's own testing and were explicitly flagged by the
implementing agents or caught in review, but deliberately left as-is at the time (out of scope
for whatever round was running, or waiting on a decision):

- **Town Center z-order:** a building placed in the row directly above the Town Center can draw
  over its banner. Cosmetic, only matters if you build right there.
- **Deserters never respawn into their post** — a post that loses a unit to desertion stays
  short-handed until its next tier upgrade refills it. Knights already behave this way (a
  pre-existing gap, not new).
- **Happiness reads 100 for exactly one tick after a restart**, then immediately recomputes down
  to whatever a fresh world's food-variety/scenery/tavern score actually is (currently ~43 on a
  totally fresh map with no farms built yet). Cosmetic, but worth knowing the "100" never really
  means anything.
- **A knight/archer/militia respawn that lands the same tick as a tier upgrade can overshoot by
  one unit** (the upgrade tops the garrison up to its new target count, then the queued respawn
  adds one more). Edge case, low impact.
- **`abbey-ward-test.mjs` section B is flaky**, surfaced while verifying the Ward Priest rework
  (2026-10-12): night mobs sometimes head for the player instead of the Town Center even though
  only the Abbey's always-on ward is in play (no Ward Stones placed), which that section didn't
  touch or change. Not investigated yet; may be a pre-existing mob-targeting race, not a Ward
  Priest regression - the player took no damage either run.

## 3. Balance concerns worth a deliberate pass (not bugs — design choices that haven't been
stress-tested)

- **Flat gold-per-kill (5) regardless of monster tier.** A Goblin and an Ogre currently pay out
  identically. Once the monster roster is actually played across a full day-progression, this
  will probably feel wrong — killing an Ogre should pay meaningfully more than a Goblin.
  Suggest scaling reward with the monster's own `maxHp`/`damage` (similar to how deserter damage
  was derived from the deserting unit's own stats) rather than hand-picking 10 numbers.
- **Fresh-colony happiness baseline (~43%) means ~28% slower production from minute one**, before
  you've had a chance to build a single farm. This was flagged once already mid-session and never
  resolved either way — still an open call on whether that's intended "early pressure" or just
  friction. See open questions below.
- **Tavern happiness-coverage radius (6 tiles)** was tuned against a compact 40x40 colony. Once
  the map expands to 80x80 and colonies plausibly sprawl further, a single Tavern may struggle to
  cover a whole base, making happiness harder to sustain than intended purely as a side effect of
  map size, not a deliberate difficulty choice.
- **Biome bonuses (Hills +20% mining, Plains +20% farming, Swamp -25% speed)** are designed but
  completely unplayed — these numbers are a first guess, not a tuned result.
- **Ruins/Encampment risk-vs-reward is unset.** Dormant guardians pay the same flat 5 gold per
  kill as any other mob once provoked — there's currently no reason to specifically seek out and
  clear a site beyond curiosity, since nothing marks them as more rewarding than an ordinary
  night-wave kill.
- **Formation system was just rewritten to proper AoE-style blocks but never played with a large
  mixed army** — worth confirming it actually reads well at 15-20+ units before trusting it's
  "done."
- **Militia-line's "double garrison, half stats" curve** was designed by halving Knight's numbers
  cleanly, not from any playtesting — reasonable as a first pass, unconfirmed as a good one.

## 4. Rough edges / incomplete systems

- Only Knight and Archer have movement/attack animations; everyone else still teleport-glides
  between static poses. (Tracked in `SPRITES.md`.)
- No combat VFX beyond a plain line for ranged attacks — no slash, hit-spark, or death effect.
- Farm Plot has no visual distinction between "growing" and "ready to harvest."
- No UI resource icons — the Colony panel is text-only.
- "Mutiny" was deliberately scoped down to "whole garrison deserts" rather than "soldiers turn
  hostile and fight you" — a disclosed simplification from when the happiness system was built,
  not a bug, but worth remembering it's not what the word usually implies.
- No persistence — the world is entirely in-memory and resets completely on restart or server
  reboot. Fine for a 2-player local session, a real limitation for anything longer-lived.
- No win condition or progression milestones — the game is pure endless survival. May be
  intentional for this project, may not be.

---

## 5. Proposed near-term plan

1. ~~Finish what's in flight: map expansion, biomes, water, Ruins/Encampments.~~ **Landed** —
   biome ratio corrected to ~51% Plains after launch (was ~30% before a quick follow-up fix).
   Worth an actual in-browser look before trusting the rest of this list, since nothing about it
   has been seen visually yet (built and tested entirely without a browser).
2. **Fix the Town Center z-order bug** — small, isolated, clearly a bug not a design choice.
3. **Gold-per-kill scaling by monster tier** — small, mechanical, clearly an improvement over a
   flat number now that the full roster (plus Ruin/Encampment guardians) is in regular use.
4. **A real playtest pass** now that the map/biome work has landed: build a colony, let a few
   in-game days pass, see how happiness/production/military/biome bonuses actually feel at normal
   play speed, before tuning any more numbers blind.
5. **Keep working through `SPRITES.md`** as art comes back from chat — animations for the
   remaining soldiers/civilians/monsters, the Bandit's own dedicated art (replacing the Militia
   placeholder), UI icons, combat VFX, farm growth states.

## 6. Where this could go longer-term (needs your direction, not a default I should assume)

- **Persistence** — save/load world state, so a colony survives a server restart.
- **A win condition or progression structure** — milestones, a final boss wave, a "you've
  survived N days" framing, something to play toward rather than pure endless survival.
- **More than 2 players** — nothing in the current architecture hard-blocks it, but it's never
  been tested with 3+, and the player-color palette currently has 5 entries (red/blue/green/
  yellow/purple), so that's the practical ceiling as it stands.
- **Deeper Ruins/Encampment rewards** — right now they're just "a fight with extra steps"; could
  gain their own loot table, a unique resource, or a cosmetic reward for clearing them.
- **Biome-specific building variants or decorations** beyond the ground texture (e.g. a
  snow-biome building reskin), if biomes prove to be a system worth investing further in rather
  than just a visual/bonus layer.

---

## Open questions (need your call, not mine)

- Is the harsh early-game happiness penalty (~43% baseline, ~28% slower production from the
  start) intended pressure, or should it be softened?
- Is "endless survival" the intended shape of the game, or do you want a progression/win
  structure eventually?
- Is persistence (saving a colony across restarts) something you actually want, given this is a
  2-player local session game, or is in-memory-only fine indefinitely?
- Any appetite for more than 2 players, or is this staying a 2-player game?

---

## 7. Content & Feel Expansion Plan (2026-10-09)

A large batch requested in one go. Grouped into sequential phases — mostly because nearly
everything below touches the same three monolith files (`server/src/index.ts`,
`protocol.ts`, `client/src/main.ts`), so true parallel dispatch risks collision (this bit us
once already this session, with the Half-Latch/Stance dispatches). Phases run one at a time,
each verified and committed before the next starts. Numbers marked **(judgment call)** are a
reasonable first pass, not something confirmed with you — flag if they feel wrong once played.

### Phase 1 — Foundation (map, camera, clock)
- **Map → 160x160.** `WORLD_TILES_X/Y` become overridable (env var or test-only override) so the
  existing `server/*.mjs` test suite keeps running at 80x80 while real play defaults to 160x160.
  World-gen density (POI counts, tree/resource scatter, water ponds) scales with area (~4x) to
  avoid a 4x-emptier-feeling map.
- **Zoom in 30%.** `worldLayer.scale.set(1.3)`, camera-follow math adjusted to account for the
  new scale.
- **Day/night cycle extended. (judgment call)** Currently 30s day / 20s night (50s/cycle).
  Proposing 60s day / 40s night (2x, same 60/40 ratio) — easy to retune once it's playable.
- **Sundial clock HUD.** CSS/SVG dial (no new art dependency) whose gnomon shadow rotates with
  cycle progress; swaps to a moon/star look at night.

### Phase 2 — Combat feedback & notifications
**Landed 2026-10-12.** Gravestones are wired (snapshot `gravestones`, cleared at dawn) and the
`event` feed is live for nightfall, dawn, tier upgrades, colonist deaths, ward lapses and deserter
waves. Milestone and boss-sighted events landed with Phase 5 (`milestone` / `boss` categories).
- **Gravestones.** `gravestone.png`/`gravestone2.png` already exist in `client/public/sprites/`
  but are unused — wire them up now. On a colonist/soldier death, drop one (random variant) as a
  transient decor entity (not a tile, so it doesn't collide with buildable-tile logic) at the
  death position; auto-removed at the next day-cycle boundary.
  Visual health (bleeding, armor deterioration) — explicitly deferred, "in future," per your
  note. Health bars stay as-is for now.
- **Event notification feed.** New `ServerMessage` type (`event`), toast-style stacked DOM
  feed, auto-fades. Triggers: night falling/survived, building tier-upgraded, colonist died,
  ward lapsed, deserter wave, boss/mini-boss sighted, milestone reached.

### Phase 3 — Old-fashioned UI skin
- Parchment/aged-paper background for the build panel and economy panel (derived from the scroll
  reference image you provided), serif heading font (system serif fallback, no external font
  fetch), carved/aged border treatment via CSS. Scoped to the two main panels first; toggle
  buttons and HUD chrome follow if it reads well.

### Phase 4 — Fog of war minimap
**Landed 2026-10-12.** Server-authoritative explored set shared by all players (cleared on restart).
Radii are `VISION_RADIUS_*` in `protocol.ts`: players 10, colonists 6 (not the Abbey's clergy),
placed buildings 5 (walls don't count), start area 12 around the Town Center. `welcome.explored`
carries a base64 bitset; new tiles arrive as a batched `explored` message (4 Hz, only when
non-empty). The minimap sits bottom-right (it slides left of the Build panel when that opens) and
shows mobs only within a player's/colonist's live vision radius. The main view isn't fogged.
Test: `server/minimap-fog-test.mjs`.
- Explored-tile tracking (radius around players/colonists/buildings, persists once seen — not
  live line-of-sight, this is co-op not competitive), small corner minimap canvas: dimmed
  unexplored, terrain-tinted explored, live dots for players/colonists/mobs/buildings in current
  vision range. More load-bearing once the map is 160x160.

### Phase 5 — Short-term goals & the Castle Ruin — landed 2026-10-16 (uncommitted)
Server: the "Castle Ruin, its Ogre Warlord, and mini-boss packs" and "Goal track" blocks just above
the fog-of-war code in `server/src/index.ts` (`CASTLE_RUIN_*`, `WARLORD_*`, `MINI_BOSS_*`, `ELITE_*`,
`GOALS`). Protocol changes are additive only: `MobSnapshot.boss` ("warlord" | "elite"), snapshot
`goal` (`GoalSnapshot`), `welcome.castleRuin`, event categories `milestone` and `boss`, plus
`BOSS_RENDER_SCALE` / `bossTitle` (shared by server toasts and client labels).
- **Goal track:** one shared, ordered track per world. Place a building → Assign a worker → Arm a
  unit → Survive the first night → Survive 3 / 7 / 14 / 21 nights → Clear the Castle Ruin. Only the
  current goal is checked, once a second (and straight after the Warlord dies); several can complete
  in one check. Nights survived = dawns since the world began. Each goal pays a small reward
  (wood/rock/iron early, 15-150 gold plus materials for the night milestones, 100 gold for the final)
  and posts a `milestone` toast. **(judgment call)** rewards. Saved (`goals` in the save state); a
  pre-Phase-5 save loads with its track caught up silently (no toasts, no rewards).
- **Castle Ruin:** exactly one per world, a 9x9 walled ruin built from the existing ruin tiles
  (walls, arches, statues, rubble; a gate gap in the middle of each side) plus a one-tile apron that
  scatter, forage, wildlife and tree regrowth keep off (`isInReservedGrounds`). Placed right after
  the Abbey, at least 40% / 33% / 25% of the map width from the Town Center (first that fits), with
  8-12 dormant guardians inside (skeleton 4 : orc 2 : armoured orc 2 : dark shaman 2), all on one
  wake group with the Warlord (siteKind `castleRuin`). Fits at 160, 80 and 64; also placed at 48 in
  testing, where mini-boss packs sometimes don't fit.
- **Ogre Warlord:** an ogre at the ruin's centre, 4.5x HP (990), 2x damage (56). On death: the usual
  gold-per-kill plus 250 gold, 150 wood, 150 rock, 100 iron, a `boss` toast, the Castle Ruin is
  cleared and the final goal completes. Never respawns.
- **Mini-bosses:** `scaledCount(0.75)`-`scaledCount(1.25)` packs (3-5 at 160x160, 1 at 80x80), placed
  after the encampments with the same spacing rules and no decoration: one elite at 2.5x HP / 1.5x
  damage (Dire Wolf Alpha, Orc Chieftain, Skeleton Lord, Spider Matriarch, Orc Warchief or Troll
  Elder) and 2-4 ordinary mobs of its kind (siteKind `miniBoss`, same wake mechanic). The elite pays
  60 gold, 40 wood and 30 iron and posts a toast.
- **Sightings:** the first time a boss or mini-boss comes within a player's or colonist's live vision
  radius, a `boss` toast goes out (once per boss, saved as `bossSighted`). Being seen doesn't wake it.
- **Client:** a parchment goal card sits top-right under the control buttons. It shows the step, the
  title, a progress bar (with an N / M count for the night goals) and a gold flash when a goal
  completes, and it slides left of the Build panel like the minimap. Bosses are drawn bigger (Warlord
  1.6x, elites 1.3x, no new art) with a serif name label and a 2x / 1.5x hp bar. The Warlord's
  parchment boss bar shows above the command bar while he's within 15 tiles of you. The minimap
  outlines the Castle Ruin (9x9, with a red keep) once its centre tile is explored. Toasts: `milestone`
  uses the upgrade icon and sound, `boss` uses the death icon.
- **Tests:** `server/goals-castle-test.mjs` starts its own private servers (PORT base, default 18961;
  sizes 80/160/64) and covers world-gen, the goal order, toasts and rewards, sightings, save / restart
  / load, old-save compatibility and the kills. `world-gen-poi-test.mjs` now leaves the Castle Ruin
  and mini-boss packs out of its ruin / encampment counts.

### Phase 6 — Hunger-marked elites — Landed 2026-10-15 (uncommitted)
Rare marked variants of night-raid mobs, one behavior modifier per Hunger (from
`my_novel/lore/bestiary.md`, translated to gameplay). Server: `Mob.mark` (HungerMark 1-6), constants
`HUNGER_*` / per-Hunger ones beside `goldForKill`; behaviours live in `pickMobTarget` / `updateMob` /
`damageMob` / `findNearestMobInRange` / `updateGuardColonist`.
- **Spawn:** each fresh raider (never deserters) rolls at raid spawn: 0% before dayIndex 3, then
  3% rising linearly to 15% at dayIndex 30 (flat after); at most max(1, floor(raid size / 5)) marks
  per raid; Hunger picked uniformly. Marked: hp x1.5, damage x1.25, gold on kill x3. One `raid`
  toast per raid: "A Gorrath-marked goblin leads the raid[, with N more Hunger-marked]".
- **Gorrath-marked** — the first blow that would kill it leaves it at 20% max hp and starts a 4 s
  wounded fury taking 50% damage (once per mob). Targets the highest-current-hp guard/militia/player
  within 8 tiles (else normal targeting), re-checked every second.
- **Nemri-marked** — ignores guards and players and heads for the nearest unwarded Town Center
  (normal targeting if none). Fights back only by hitting the Town Center.
- **Rux-marked** — feint: the first time it reaches attack range on a new target it backs straight
  off for 1.5 s without striking, then returns and commits (one feint per target).
- **Morvain-marked** — guards only acquire it within 50% of their stance alert range, and a guard
  chasing it drops the lock once it's further than that reduced range.
- **Gunne-marked** — targets the guard/militia/player with the lowest hp% within 10 tiles, as long
  as one is below full hp (else normal targeting), re-checked every second.
- **Vhorrun-marked** — after a hit that leaves its colonist/player target below 40% hp it drops the
  target and backs away for 6 s, then picks a target afresh.
- **Client:** sigil (16px) + tinted name label above the mob, pulsing aura (40px) on the ground under
  it, marked mobs drawn 1.25x. Test: `server/hunger-roads-test.mjs` (also covers roads).

### Phase 7 — Sound — Landed 2026-10-14 (uncommitted)
- **`client/src/sound.ts` `SoundManager`:** uses the Web Audio API. The AudioContext is created on
  the first menu click and resumed on Start. Sounds come from `/audio/manifest.json`
  (`{sfx:{key:[variants]}, music:{day,night}}`). Each sound picks a random variant with a slight
  pitch change. Decoded clips are cached. A missing manifest, key or file stays silent.
- **Proximity:** positional sounds play at full volume within 2 tiles of the local player and fade
  to silence by 14 tiles, with mild stereo pan. The engine plays at most 12 one-shots at once, and
  each key has a cooldown. Tunables are at the top of `sound.ts`.
- **Triggers:** all client-side, with no server changes.
  - Work: chop, mine, farm, craft (louder at the Blacksmith) and bishop heal. Each worker plays
    once per work cycle, on its own phase. Farm plots sound when they ripen or are harvested.
  - Combat: melee hits and the player's own swing. Archers have bow and arrow-impact sounds.
  - Deaths: colonist and monster deaths, on the same logic as the poof.
  - Player: a hurt sound when hp drops. A gallop loop plays while you move, with cadence tied to
    speed, and the odd whinny when you set off.
  - Monsters: the odd growl when a monster first comes within 10 tiles.
  - Ambient: water and campfire loops by distance.
  - Building and UI: UI clicks, your own building placement, and upgrade toasts.
  - Day and night: a sting at nightfall, and a chime plus church bell at dawn. Trigger tunables are
    the constants above `main()` in `main.ts`.
- **Music:** a calm day track and a tense night track, crossfading over 3 s at the day/night
  switch. Music starts only after Start. Everything suspends while the tab is hidden.
- **Settings:** Master, Music and Effects sliders plus Mute, saved in localStorage
  (`sworn.sound`). One settings panel serves both the main menu and the new in-game **Settings**
  button, which opens it as a modal.
- **Difficulty (shipped with this phase):** Easy, Normal or Hard on the menu (`sworn.difficulty`).
  The client sends it as `setDifficulty`, and welcome and snapshot carry the world's value. It
  scales raid-wave mobs only. Hard is damage x1.35, hp x1.3 and raid size x1.35. Easy is
  0.75 / 0.8 / 0.75. The multipliers are the `DIFFICULTY_*` constants in `server/src/index.ts`.
  The first claim after a fresh world or restart wins. A solo player may re-pick on day 1, and
  Restart sends the restarter's choice. In-game the setting is read-only, and the Colony panel
  shows it.
- Tests: `server/difficulty-test.mjs` (private port) and `node client/sound-test.mjs` (falloff,
  manifest and volume parsing, missing-audio handling, on-disk manifest files).

### Art batch — landed 2026-10-14 (client-only, uncommitted)
Seven new source sheets, wired client-side. The server and `protocol.ts` are unchanged. Details are
in `SPRITES.md`.
- **Player animation:** the mounted knight now walks, and plays a lance thrust on Space or when a
  melee effect starts at a player. The per-player hue shader still applies.
- **Icons:** each event toast shows a per-category icon, and the stance HUD line shows the stance icon.
- **Loops:** campfire, lantern post and water tiles animate on one shared clock.
- **Blood (Phase 2 combat feedback):** some melee hits and every death leave a ground stain. Stains
  are capped at 80 and cleared at dawn with the gravestones.
- **Ambient wildlife:** deer, crows and frogs wander client-side with no gameplay effect.
- **Staged, not wired:** the Castle Ruin art (Phase 5 shipped with the existing ruin tiles instead), the six gate states (gate passability is still
  undecided), the wall torch loop, the move/attack/rally order icons, `playerIdle`, and rough wound
  decals. Visual health stays deferred: the wound sheet came back as pre-baked units rather than
  usable decals.

### Raid waves — landed 2026-10-14 (uncommitted)
This replaces the old night trickle spawner (one mob every 3 s up to a cap of 8 + 1 per 2 days, at
most 24).
- **Size:** tonight's raid is `5 + 2 x dayIndex` mobs (5 on the first day, 7 on day 1, 45 on day 20,
  105 on day 50), times the difficulty multiplier, rounded, with a minimum of 1. There is no cap,
  and survivors from earlier nights stay and stay aggressive.
- **Timing:** the whole raid spawns at once at the midpoint of the day phase, on walkable tiles
  within 3 tiles of the map edge, one mob per tile where possible.
- **Groups:** at least half of the raid forms one horde at one edge spot (a 50-70% share, rounded
  up). The rest split into random groups of 2-6, each at its own edge spot.
- **Passive, then aggressive:** groups start passive. They loiter within 3 tiles of their spawn
  and target nothing. Each group gets a random aggro time between spawning and nightfall, and any
  group still passive at nightfall turns aggressive then. Damaging any member turns its whole group
  aggressive at once.
- **March:** an aggressive group marches as one. Its slowest member leads along a single shared
  path at its own speed, and the others hold golden-angle formation slots around it. Once the
  leader is within 8 tiles of the Town Center or of a guard or player it could target, the group
  breaks up into normal per-mob targeting. A damaged group breaks up straight away.
- **Factions:** each group comes from one faction (`RAID_FACTIONS` in `server/src/index.ts`):
  Wolf pack, Bandit band, Greenskin warband or Dark host. A faction is eligible once one of its
  core kinds is unlocked, weighted by how many are. Bandits now raid from the first day (the
  Elite from day 3); encampment guardians are unchanged.
- **Deserter nights:** these keep the 25% roll after 10 days, now rolled at the midday spawn. Every
  eligible deserter joins the horde where it stands. Fresh Bandit-band mobs fill the raid up to its
  normal size, and none spawn if the deserters alone reach it. The deserters turn on the colony
  when their group goes aggressive, with the existing event.
- **Events:** "Raiders gather at the {edge} edge" fires on spawn and "The horde marches on the
  colony" when the horde turns aggressive. Both use the new `raid` category, which borrows the
  deserter icon.
- **Tests:** `server/raid-waves-test.mjs` needs `COLONY_TEST_HOOKS=1`, which enables a test-only
  `testHook` message for time travel, state dumps, direct damage and tick stats. Run it with
  `PERF=1` for tick timings.

### Slow farming, hunting and foraging — landed 2026-10-14 (uncommitted)
Every number is a named constant at the top of its block in `server/src/index.ts` (`FARM_*`/`FARMHAND_*`
after `LUMBERJACK_WOOD_PER_TRIP`; `HUNTER_*`, `FORAGE*`, `WILDLIFE_*`, `BOAR_*` in the "Hunting & foraging"
section). One game day = 60 s day + 40 s night = 2000 ticks.
- **Grain fields:** a Farm Plot is sown, grows for 3 days (the first third reads as "sown"), ripens for the
  existing 2 s harvest and yields 36 grain. After 5 harvests it lies fallow for 3 days, then re-sows itself
  while its Barn is staffed. Grow and harvest still scale with Barn level, Plains, happiness and industrial
  synergy; fallow doesn't. 5 x 36 grain over 18 days = 10 grain per plot-day, the same as the old 8 s + 2 s
  cycle. The snapshot gained `sownFarmPlots` and `fallowFarmPlots` next to `readyFarmPlots`.
- **Pasture, Orchard, Sheep Pasture, Hemp Field:** the farmhand still tends all day, but the produce lands as
  one batch of 90 per 3 days of tending (3 x 1200 daytime ticks, scaled like the old 2 s unit timer).
  That's the old 30 a day, delivered every 3 days.
- **Economy:** starting grain is 60 (was 40), so a ~20-consumer colony gets through the 3 dawns before the
  first harvest. Everything else is unchanged: 1 food per colonist per dawn (Abbey clergy excluded),
  starvation 10 hp, respawn 5 food. Hunters and foragers are the early food (and early food variety for
  happiness) while the fields and herds grow.
- **Hunter's Hut / Forager's Hut** (Farming tab, keys `q` / `y`, 15 wood each, industrial, population-gated):
  each placement spawns one worker, and placing the hut on itself levels it up (to 3) and adds another.
  Hunters stalk the nearest unreserved game within 25 tiles of the hut, shoot from 4 tiles (10 damage,
  1.2 s), carry the carcass home and deposit meat on arrival (deer 6, boar 8, rabbit 2, pheasant 2).
  Foragers pick the nearest ripe plant within 25 tiles for 3 s and carry the fruit home (berry bush 3,
  fruit tree 5, mushrooms 2). The plant regrows after 1 day. Both work by day only and sleep in houses.
- **Wildlife** (server entities, snapshot `wildlife` as a flat 5-number list): per 80x80 there are 6 deer,
  8 rabbits, 3 boar and 4 pheasants (scaled by area: 84 animals on 160x160), never within 10 tiles of
  the Town Center. Up to 4 a day (16 on 160x160) respawn back up to those caps. Animals wander slowly,
  with no pathfinding. Anything that hurts one (hunter, player lance, test hook) makes it flee for 4 s.
  A boar shot by a hunter charges him instead (4 damage/s, up to 6 s). A player's kill gives its meat
  straight away. The client-only deer are gone; crows and frogs stay cosmetic.
- **Wild forage** (world-gen tiles, ripe/picked variants): per 80x80 there are 24 berry bushes, 12 fruit
  trees and 10 mushroom patches, none within 5 tiles of the Town Center. Bushes and mushrooms are walkable,
  fruit trees are solid. All of them can be demolished.
- **Art:** stand-ins everywhere, with the hook names listed in `SPRITES.md` ("stand-ins in use").
- **Tests:** `server/slow-farming-test.mjs` and `server/hunting-foraging-test.mjs` (both need
  `COLONY_TEST_HOOKS=1`). New test hooks: `fastForward`, `setRaids`, `setStock`, `farmState`, `wildlifeState`,
  `spawnWildlife`, `clearWildlife`, `damageWildlife` and `setTileRaw`. The farming tests that timed the
  old 8 s cycle now pause the world and fast-forward.

### Builders, construction, building info and placeable Town Centers — landed 2026-10-15 (uncommitted)

- **Builders** (`builder` colonist, civilian: uses population, eats, works by day, shelters at night). The
  colony starts and restarts with 1 posted at the Town Center; each Town Center keeps one builder per
  level (1/2/3, topped up when it is built or upgraded; they respawn there). The **Builders' Guild** (key `i`, Civic, 15 wood, industrial-synergy
  member, population-gated) adds one builder per level, upgradeable in place to Lv3.
- **Construction**: every placement except Farm Plots (still instant) and Demolish is charged at once and
  becomes a solid `ConstructionSite` tile (in-place upgrades keep the building running and show an
  "upgrading" badge). Idle builders haul materials to the nearest site (max 2 per site), work it
  ("building"), and on completion the old `resolve*Placement` logic runs unchanged. Build time: wall 4 s,
  house 10 s, default 12 s, big buildings (barracks, church, tavern, workshops, shops, Ward Stone) 20 s,
  Town Center 40 s, times the level being built, shared by the builders, scaled by happiness and the
  Town Center bonus (Guild builders also get their Guild's level and synergy). Unreachable sites wait;
  demolishing a site refunds nothing. With no builder alive placements are refused ("No builders
  available"). `COLONY_INSTANT_BUILD=1` / testHook `setInstantBuild` restores instant placement.
- **Building info** (left-click a building with any tool but Demolish): name, level, staff, HP (Town
  Centers), server-computed bonuses, construction progress, and an Upgrade button (no reach limit).
- **Town Centers** are a list: placeable (key `0`, 60 wood + 30 rock + 20 iron, 12+ tiles from other Town
  Centers and POIs), upgradeable to Lv2 (80/60/40 wood/rock/iron) and Lv3 (120/100/80 + 10 tools). (Lv3 was once called "the Keep"; the Keep is now a separate building, see Settlement population caps.)
  The highest level gives +5%/+10% productivity and unit damage, +5 population per level; HP 1000/1500/2000.
  Population base is 10 for the first and +5 per extra. A destroyed one is removed; mobs target the nearest.
  A killed player respawns at the nearest standing one; with none, they stay dead (Game Over overlay with
  Restart) until a new one is placed, which is built instantly when none stands or no builder lives.
- **Art data**: snapshot `buildingLevels` (tier art for huts, Guild, Town Center), `farmStages` (grain
  sprouting/harvested, hemp, pasture, sheep, orchard stages), `constructionSites`, `townCenters`.
- **Test:** `server/builders-towncenter-test.mjs`. Older suites that place buildings need
  `COLONY_INSTANT_BUILD=1`, and some counting colonists/population/food must allow for the starting builder
  (1 since the building-HP work below; it was 2).

### Save files — landed 2026-10-15 (uncommitted)

- **Slots**: `server/saves/{autosave,slot1,slot2,slot3}.json` (gitignored; `COLONY_SAVE_DIR` overrides the
  directory), versioned JSON `{version: 1, savedAt, dayIndex, population, difficulty, worldSize, label,
  state}`, ~220-240 KiB on a 160x160 day-4 world. Load refuses another `version` or a different world size
  (clear error toast to the requester).
- **What's saved**: everything that defines the world (`snapshotWorld` / `applyWorld` in
  `server/src/index.ts`): tiles, biomes, fog, noise salt, Abbey centre, stock, flags, happiness, day/night
  tick, raid schedule + groups, colonists, mobs (guardians, deserters, marks), wildlife, respawn queue, farm
  plots, forage regrow, building levels, construction sites, Town Centers, Ward Stones + priest, task
  forces, reservations, gravestones and the test flags. Not saved: players (everyone connected respawns at
  a Town Center, like a restart), per-tick transients, client-only blood. Loading broadcasts a fresh
  welcome + "Game loaded" to everyone; the loaded world keeps its own difficulty.
- **Autosave**: each dawn (flagged in `stepSimulation`, written by the tick loop, debounced), and on
  SIGINT/SIGTERM (sync write, then exit; also on `tsx watch` restarts). Only after a player has connected
  since boot, so an unattended fresh server never overwrites the last real autosave; with
  `COLONY_TEST_HOOKS=1` only when the test sets its own `COLONY_SAVE_DIR`. Snapshot+stringify blocks the
  tick ~1.5 ms on 160x160, the write is async.
- **UI**: main menu Continue (autosave) / New Game / Load Game, listed via `GET /saves` on the server port;
  in-game Settings has Save Game (3 slots, overwrite confirm) and a Load list.
- **Protocol**: `saveGame`, `loadGame`, `listSaves` / `saveList`, `saveResult`.
- **Test:** `server/save-load-test.mjs` (boots its own private servers, no external server needed).

### Building HP, mob attacks on buildings, fire, repair — landed 2026-10-15 (uncommitted)

- **HP** (`server/src/index.ts`, constants at the top): wood wall 60, houses / huts / archer post 120,
  workplaces 180, big buildings (barracks, church, tavern, workshops, shops, Ward Stone), castles, archer
  towers, Lv3 militia camp and stone walls 250; x1 / 1.4 / 1.8 by level. Town Centers keep their own HP.
  Damage is stored only for damaged buildings (`buildingHp`), saved / loaded (old saves load at full HP).
- **Mob targeting**: guards / militia first, then players (unchanged); with neither targetable, the nearest
  unwarded building (Town Centers included, walls never as a goal). Walls are breached only when the
  building has no route or the route exceeds `BREACH_DETOUR_FACTOR` (3) x the straight distance (and
  `BREACH_MIN_ROUTE_TILES`, 12): the mob then attacks the first wall on the cheapest route through walls.
  A mob on a building turns on any guard / player that becomes targetable (checked once a second). A raid
  group with no route to the colony breaks up so its mobs can breach. Mobs hit buildings with their
  normal damage; at 0 HP the building is demolished like a player demolish (workers, level, site, HP) with
  an "X destroyed" toast.
- **Repair**: idle builders by day (construction sites first) take manual Repair requests, then the most
  damaged building; skip jobs with a mob within 8 tiles; heal max HP over 60 s per builder (builder rate);
  cost `REPAIR_COST_FRACTION` 0.3 x placement cost x level, pro rata to the HP missing, rounded up per
  resource ("Not enough materials to repair" otherwise). Building info shows HP for every damageable
  building and a **Repair** button (pays now, queues first).
- **Client**: pooled campfire-loop flames by damage tier (<75% / <50% / <25%), soot tint, smoke puffs below
  50%, HP bar while damaged (Town Centers keep their own bar).
- **Protocol**: snapshot `damagedBuildings` ([tile index, hp permille]), `BuildingInfo.repair`,
  `repairBuilding` message.
- **Test:** `server/building-damage-test.mjs` (test hooks `ignorePlayers`, `damageBuilding`, `buildingState`).

### Cavalry & siege — landed 2026-10-27

Knights become shock troops; a new cavalry unit; battering rams and catapults for both the colony and the raids.
New art is all PLACEHOLDER (SPRITES.md "New requests (2026-10-28 batch)", #37-#44, with a wiring table).

| Unit | Role / slot | HP | Damage | Speed | Notes |
|---|---|---|---|---|---|
| Knight | shock: front row, centre | 60/100/160 | 12/20/32 | 110 | unchanged stats; was frontline |
| Cavalry | fast: wings | 60/100/160 (= knight per Stables level) | 12/20/32 | 176 (1.6x) | charge: first blow after >= 5 tiles in a straight line x2, 8 s cooldown |
| Battering ram | siege, front centre | 240 (4x knight) | 12 base: x4 vs buildings / walls / gates (48), x0.3 vs units (3.6) | 55 (0.5x) | every 2 s; gates first, then walls / buildings; units only when adjacent with nothing else to hit |
| Catapult | siege, rear line | 70 (2x archer) | 18 boulder, splash 1.5 tiles, x3 vs buildings (54) | 50 | range 3-11 tiles, reload 4 s; towers > walls / gates > buildings, else the densest unit cluster |

- **Roles**: `CombatRole` gains `siege`; `COLONIST_ROLE` knight `shock`, cavalry `fast`, batteringRam / catapult `siege`;
  `MOB_ROLE` batteringRam / catapult `siege`. `isRearRole(role, kind?)` now takes the unit's kind: a siege role is rear
  only for the catapult (server `isRearColonist` / `isRearMob`). Morale weights: ram 2 (as shock), catapult 0.8 (as
  ranged); siege mobs never join a flank detachment. Client formations (`centreShock`): shock units and rams lead
  rank 0 and take the front row's centre slots; cavalry the wings (`placeFastOnWings`); catapults join the archers'
  rear line. Role ring colour siege = brown (`0x8b5a2b`); the selection readout lists "Siege".
- **Stables** (`TileType.Stables` = 71, hotkey `;`): 20 wood + 10 rock + 10 iron (Lv2 30/20/20, Lv3 45/30/30), builders
  required, big-building HP, a military tile (army synergy, house bonus +1 rider per adjacent house, spawn-space
  rule). Garrisons 1 / 2 / 3 cavalry per level through the usual post mechanism (`syncGuardBonusAt`,
  `resolveStablesPlacement`, respawn queue at dawn / dusk with the Stables' level). Population: 1 per rider since 2026-10-28 (see "Camp hearths, soldier population, settlement spacing").
  Building info: level line; click-select via `GARRISON_TILES`.
- **Siege Workshop** (`TileType.SiegeWorkshop` = 72, hotkey `'`): 30 wood + 15 iron + 15 rock, builders required, max
  level 1. Its info panel has "Build Battering Ram" (30 wood + 10 iron) and "Build Catapult" (25 wood + 15 iron)
  buttons (`queueSiege` message, `BuildingInfo.siege`): one engine at a time, 30 s each (`SIEGE_BUILD_TICKS`), at most
  `SIEGE_WORKSHOP_CAP` (2) alive per workshop, 2 population each (counted in `civilianPopulationUsed`). Engines are
  commandable soldiers (squads, stances, formations) and are never respawned: a destroyed engine is rebuilt at the
  workshop. The player's ram only takes on a mob next to it (or a commanded target); the catapult never fires inside
  3 tiles and splashes mobs only. (Monsters own no buildings, so the colony's x4 / x3 building damage has no target yet.)
- **Raids** (`MOB_KIND_CONFIG` batteringRam unlockDay 10, catapult 14; both non-core extras, weight 1, in
  `greenskinWarband` and `banditBand`): each raid takes at most `raidSiegeCap(day, kind)` = 1 + 1 per 6 days past the
  unlock of each. In formation the ram ranks with the shock troops (front centre; often the leader, being slowest),
  the catapult on the rear rank (released last). Released, both run `updateSiegeMob` (after `mobTactic`, so routs /
  shelter still apply): the ram `pickRamTarget` (nearest closed gate within 25 tiles it can walk up to, else
  `pickBuildingTarget`'s breach / building pick), the catapult `pickCatapultShot` from where it stands, else it
  advances on `pickBuildingTarget` but never past its regiment's front rank (`regimentFrontDistance`). Boulders:
  `catapultImpact` (splash on colonists, players, buildings / Town Centers) + `AttackEffect.boulder`. Siege mobs pay x2
  gold. Note: a lone ram at an undefended gate simply overruns it (Walls & gates item 5); rams matter where towers /
  defenders hold the gate.
- **Client**: placeholder sprites (cavalry = the player's ride cycle tinted blue-grey, 50 px; rams / catapults = the
  cart / crate props tinted; Stables = castleLv2, Siege Workshop = blacksmith, both tinted; optional real art loads
  over them); the boulder flies in an arc (spark tinted brown) and ends in a dust puff (poof tinted); army readout
  adds Cavalry / Siege.
- **Not saved**: charge runs and Siege Workshop jobs in progress (a load drops a half-built engine; built engines and
  riders are ordinary saved colonists).
- **Test hooks**: `siegeState` (events: charge / hit / ramHit / boulder / built; units; roles; population),
  `forceRaidSiege` {value}, `spawnRaidNow` {dayIndex}.
- **Test:** `server/cavalry-siege-test.mjs` (160 world): S Stables garrisons 1 rider (2 at Lv2), speed 176, role tables;
  C a 10-tile ride: the first blow is the only charge (24 = 2 x 12); W the workshop rolls out a ram (+2 population),
  x0.3 vs a skeleton; G a mob ram goes for a locked gate (tower behind it) and hits it for 48; K a mob catapult 8 tiles
  out hits a house for 54 and splashes both knights beside it; R no siege before day 10, a ram on day 10, ram +
  catapult on day 14, ram front row centre, catapult rear row. `regiment-test.mjs` and `tactics-test.mjs` re-run:
  all pass unchanged.

### Monster tactics — landed 2026-10-27

Step 2 of 2 toward Total War-style battles (step 1: Regiments & roles, below). Server only; the protocol and
client are untouched (one toast). All of it lives in the "Monster tactics" block after `updateMob`.

- **Regiments**: every mob sharing `regimentKey(m)` = `groupId ?? regimentId ?? siteId` (a raid group,
  before and after it breaks up, or a POI site; future horde / fort sites just set a shared `siteId` or
  `regimentId`). `updateRegiments` (once a second, inside `withHostileMover`, before `updateRaidGroups`)
  keeps a `RegimentState` per key (morale, routed, sheltering, shelter posts, flank group, last strength
  ratio, home = where it was first seen) and evaluates every regiment with awake, non-passive members.
  Not saved: a loaded world starts every regiment at morale 100. `mobTactic(mob)` (from `updateMob`, after
  the raid-group return) moves flanking / routing / leaving / sheltering mobs.
- **Strength**: Lanchester-style `sum HP x sum damage` of the members vs the player's forces within
  `TACTICS_SCAN_TILES` (10) of the centroid (+ the regiment's spread, max 8): soldiers (damage per mob attack
  interval), players (unless `ignorePlayers`), standing towers (`livingTowersNear`, tower HP and rate).
  The product (not a plain sum of HP x damage) so five goblins aren't "outnumbered" by one rider.
- **Flanking** (`tryFlank`): when a front-rank member is closing on (within reach + `FLANK_CONTACT_TILES` 6)
  a soldier, the enemy line (soldiers near) is >= 2 tiles wide and wider than the melee contact, and no
  member is already past it, the regiment's fast units (wolves, spiders; or, with none, `FLANK_DETACH_FRACTION`
  20% of a >= 5-strong front line, its outermost on that side) walk an arc: out `FLANK_ARC_TILES` (7) beyond
  the line's end on their own side, level with the line, then `FLANK_BEHIND_TILES` (3) behind it - the side
  whose probe tiles are all walkable (open flank). Target: the enemy archer nearest the arc's end, else the
  line's end unit; within `FLANK_ENGAGE_TILES` (3) of it (past the first waypoint) or at the end it becomes
  an ordinary colonist target (slots / attacker caps / queueing as usual). One flank group per regiment
  (`flankIds`); a mob that flanked once (`flanker`) is never sent again; `FLANK_MAX_TICKS` 20 s cap.
- **Wall cover**: only regiments that own walls - `walledSites` (ids) / `SITE_KIND_WALLED` (per site kind,
  empty today: ruins / encampments have none; fences don't count) - or whose members already stand inside a
  walled enclosure (`walledEnclosure`: 4-way flood fill of mob-walkable tiles, closed gates solid, that closes
  within `COVER_ENCLOSURE_TILES` (8) and touches a wall / gate). Outnumbered (ratio < 0.6) with an intact
  shelter: `sheltering`; posts inside (ranged / casters on the wall-side tiles nearest the enemy, melee on the
  tiles nearest a gate). Sheltering mobs walk to their post and only fight a unit already in reach
  (ranged fire over the wall; melee hold the gate), never advance, never breach. Out again when the ratio
  passes 1.0, or on a breach: a gap / open or overrun gate (the fill leaks) or any bordering wall / gate
  under 50% HP. No outnumbered morale drain while sheltering; a sheltering regiment doesn't rout.
- **Morale** 0-100 per regiment, start 100, only changes in contact (else +3/s): casualties
  `MORALE_CASUALTY` (50) x role weight (frontline 1, shock 2, ranged 0.8, caster 1, fast 0.8, boss /
  Hunger-marked 3) / peak size; front line lost (no non-rear member left) -8/s; outflanked (an enemy 1+ tile
  behind the centroid within 4 tiles of a member) -4/s; outnumbered -20/s x (1 - ratio / 0.6); winning (ratio
  > 1.5) +3/s. Losses x0.5 while a morale anchor (`boss` or Hunger mark) lives.
- **Rout** below 25: site regiments flee home (`tactic = "rout"`, +20% speed, no targets); cornered (soldier
  within 1.2 tiles and no route / already home) they fight back. They rally above 50 after 10 s without
  contact. Raid regiments leave instead (`tactic = "leave"`): a group still in formation is released and
  deleted from `raidGroups` at once; members walk to the map edge straight away from the enemy
  (`fleeEdgePoint`) and despawn there or after 60 s (`despawnMob`: no gold, slots released). Toast "The
  raiders break and flee!" (raid event, once per 30 s). Morale anchors never rout or leave while alive.
- **Player side (minimal)**: no morale. Pursuit safety in `pickGuardTarget`: a routing / leaving mob is
  only fought inside a soldier's attack range, never chased, so a broken enemy doesn't drag the line apart.
- **Test hooks**: `spawnMob` takes `regimentId` / `siteId` (awake guardian); `spawnRaidGroup` {kinds, tx, ty}
  (an engaged group, one row per member); `setRegimentWalled` {id, value}; `tacticsConfig` {freezeMorale};
  `tacticsState` (regiments, events: flank / flankStrike / cover / coverEnd / rout / rally / despawn).
- **Test:** `server/tactics-test.mjs` (160 world): F wolf of a 6 armoured orc + 2 orc + wolf regiment flanks a
  5-knight line (+2 archers, morale frozen) and strikes an archer while the front is still engaged; R a 2-goblin
  raid group vs 8 knights routs, toasts, moves off and is gone (group, regiment, mobs; despawned at the edge);
  W 4 walled-site mobs in a 5x5 walled enclosure vs 8 knights take cover and stay inside 15 s, a gate under
  half HP ends it.
- **Hooks for the horde phases**: give each horde / fort site a shared `siteId` (or `regimentId`) and add it
  to `walledSites` (or its kind to `SITE_KIND_WALLED`) when it has walls; `RegimentState.home*` is the
  anchor routs fall back to; `tacticsEvent` is the place to hang horde-level reactions (e.g. a rout spreading
  morale loss to neighbouring regiments); `startRout` / `evaluateRegiment` are where horde-wide morale or a
  warlord's rally would plug in.

### Regiments & roles — landed 2026-10-27

Step 1 of 2 toward Total War-style battles (step 2: monster flanking, retreat behind walls, morale). Units now
fight as regiments with roles: a melee front line, a ranged rank behind it, flankers on the wings.

| Role | Kinds | Formation place | Behaviour |
|---|---|---|---|
| frontline | militia, spearman, pikeman; goblin, orc, armored orc, skeleton, bandit clubman, half-latch | front rank(s) | engages the enemy nearest its slot, holds the leash (Battle discipline) |
| shock | knight (since Cavalry & siege); troll, ogre, bandit elite | front rank, centre (placed first) | as frontline |
| ranged | archer; goblin crossbow, bandit archer | rear line behind the front | holds the rear, fires over the line, kites |
| caster | dark shaman | rear line (as ranged) | as ranged (+ its heal) |
| fast | cavalry (since Cavalry & siege); wolf, giant spider | wings (outermost front slots / ends of the front row) | as frontline |
| siege | battering ram (front, centre with shock), catapult (rear line) - both sides | see "Cavalry & siege" | rams hit buildings, catapults shell from range |

- **Role table** lives in `protocol.ts` (shared): `CombatRole`, `MOB_ROLE`, `COLONIST_ROLE`,
  `isRearRole`. Server helpers `colonistRole(c)`, `mobRole(m)` (a deserter's own `melee` flag wins).
- **Player formations** (client `computeFormationTargets` / `computeLineFormationTargets`, shared
  `formationRanks` / `placeFastOnWings`): with a front rank in the order, the archers form a second line
  `REAR_LINE_OFFSET_TILES` (2.5) behind the front row (or one spacing behind a deeper front), at most
  `REAR_LINE_WIDTH` (0.7) x the front's columns; fast roles take the front row's ends. A line drag faces away
  from the units' side, or toward the nearest mob within `LINE_FACE_ENEMY_TILES` (12) of the line's centre.
  Archers-only orders keep the old layout. Plan slots carry `rear` (drawn as green squares in the line guide
  and the destination marker).
- **Ranged discipline (soldiers)**, `updateGuardColonist`: an uncommanded archer with a friendly front-rank
  soldier within `ARCHER_FRONT_RANK_SCAN_TILES` (6) (`hasFriendlyFrontline`) never leaves its slot to close
  on a target - it fires at whatever is in bow range (`pickGuardTarget` ranks in-range enemies first, those
  fighting a front-rank soldier (`engagedWithFrontline`) before the rest; once a second it switches to one in
  range) and, with an enemy melee mob within `RANGED_KITE_TILES` (2), takes one kite step (`kiteStep`: back
  onto its slot if that is further from the threat, else a tile straight away, within the leash) while
  still firing. No front rank, or a commanded target: the old behaviour. (Replaces `behindFrontRank`.)
- **Ranged discipline (mobs)**, `updateMob`: a ranged / caster mob keeps its regiment (`Mob.regimentId`, the
  raid group it marched in, set in `releaseRaidMob`; POI guardians use `siteId`). While a front-rank mate is
  within 6 tiles (`regimentFrontDistance`) it never closes on a unit target past that mate's own distance
  (it waits once in front of it), fires once in range, and steps away (`stepMobAwayFrom`) from a soldier
  (`nearestMeleeSoldier`) within 2 tiles.
- **Raid formations** (`assignRaidLeader`): the front ranks use the faction shape for the melee roles only -
  shock first, then frontline, fast roles on the widest slots; ranged / casters form a centred rear rank
  `RAID_REAR_RANK_TILES` (3.5) behind the front row (or a spacing behind a deeper front), on later rows, so
  `releaseRaidRows` lets them go last. The leader is the slowest front-rank member; the march goes at the
  slowest member's pace (`marchRaidGroup`). An all-ranged group keeps the old layout.
- **Advance together** (`updateSquadMarch`, per tick before colonists update): the client tags each formation
  order's moves with `commandMove.squad` (optional, additive; `o<order>`), stored as `Colonist.squadId`. Squad
  members walking to their slots (no target) march at the slowest member's speed; one more than
  `SQUAD_LEAD_TOLERANCE_TILES` (1) ahead of its place in the formation slows to `SQUAD_AHEAD_SPEED_FACTOR`
  (0.25) x, one that far behind catches up at its own speed. Within `SQUAD_SETTLE_TILES` (2.5) of the
  destination everyone settles alone; a member over `SQUAD_BROKEN_TILES` (6) out of place means the line is
  broken and nobody waits. Applies in every stance.
- **Client**: role rings (thin tinted ellipse at the feet: frontline amber, shock red, ranged green, caster
  purple, fast blue; `drawRoleRings`) under every soldier and monster; the selection readout lists roles
  ("Selected: 10 (6 Frontline, 4 Ranged) · Normal"). There is no separate unit info panel.
- Untouched: towers, gates (mob gate logic, overrun), fight notifiers, dawn/dusk respawns, dormant POI
  guardians (dormancy returns before the ranged code), save/load (new fields optional).
- **Hooks for step 2** (flanking / retreat / morale): `mobRole(m) === "fast"` + the wing offsets in
  `group.offsets` (largest |x|) are the flankers to send round a line; `Mob.regimentId` groups a broken-up raid
  for regiment-level morale (count living members, rout together); `Colonist.squadId` +
  `updateSquadMarch` (per-squad centroid / slot centroid already computed) is where a squad-wide retreat order
  or morale check plugs in; `hasFriendlyFrontline` / `regimentFrontDistance` tell when a rear rank has lost its
  front (a natural morale trigger); `kiteStep` / `stepMobAwayFrom` are the step-back primitives.
- **Test:** `server/regiment-test.mjs` (new; default 160 world): F two-line slots (archers >= 2 tiles behind
  the front, rear line narrower) + live arrival; C 3 goblins + 2 orcs vs the line, archers stay >= 2 tiles
  behind the knights' mean front while >= 3 knights stand; A 6 militia + 4 archers march 15 tiles as a squad:
  nobody > 1.5 tiles out of formation, pace = the archers' 100 px/s, settles on its slots.
  `battle-discipline-test.mjs` and `raid-waves-test.mjs` re-run: all pass, unchanged. The raid rear-rank
  layout itself is not covered by a test yet.

### Battle discipline — landed 2026-10-23

User report: "battles are still clumping together and not seeming realistic". Units now hold their place in
the formation and fight what is in front of them; surplus attackers queue instead of piling onto one body.

- **Fight what is in front of your slot** (`pickGuardTarget`): an uncommanded soldier picks the enemy nearest
  to its own rally slot (not to wherever the scrum pushed it), within its alert range and the slot's reach
  (leash + strike range). Once a second, while not trading blows, it switches to an enemy nearer its slot
  than `SLOT_RETARGET_FACTOR` (0.7) x the current one's distance; after a kill / when the target leaves the
  leash it walks back onto its exact slot (as before). Leash tightened: normal 4 -> 3, aggressive 8 -> 6
  tiles (defensive 1.5).
- **Attacker cap + queue** (`meleeAttackerCap`, `targetHasRoom`, `claimSlot` cap): at most 3 melee attackers
  on a soldier-sized body (radius < 9), 4 on an orc-sized one, 6 on a troll / ogre (players are exempt). A
  soldier skips enemies that are full; if every enemy in reach is full it holds its own slot (the queue) and
  rescans; a commanded soldier on a full target waits `QUEUE_STANDOFF_PX` (1.2 tiles) outside strike range.
- **Mobs too** (`pickMobTarget`, `updateMob`): a melee mob prefers the nearest soldier with room when it is at
  most `MOB_ROOM_DETOUR_PX` (4 tiles) further than the nearest one, so a raid spreads along the defenders'
  line; a mob with no slot on its target stands off just outside strike range and re-picks once a second.
- **Close in near strike range** (`SLOT_CLOSE_IN_PX`, half a tile): an attacker that close goes straight for
  the target and slides round to its ring slot while fighting (a far-side slot used to wedge it behind the
  attackers already there).
- **Path knots fixed** (`PATH_WAYPOINT_TOLERANCE_PX` 10, `returnToRally`): an intermediate waypoint within
  10 px counts as reached, and a unit on / edge-adjacent to its rally tile steers straight in. Bodies pushing
  each other apart could never all stand on one tile centre, so squads used to orbit a waypoint forever or
  freeze a few px short of their slots (the "clump" after a formation move).
- **Tighter formations**: client `FORMATION_SPACING_TILES` defensive 0.9 -> 0.8, normal 1.25 -> 1.05,
  aggressive 1.5 -> 1.3 (bodies are 14 px; 0.8 tiles = 25.6 px never overlaps). Raid formations
  `RAID_FORMATION_SPACING_BODIES` 1.6 -> 1.35; `RAID_FOLLOWER_CATCHUP` 1.25 -> 1.5 so followers form up early
  in the march.
- **Line-drag minimum frontage** (client `computeLineFormationTargets`): never more than
  `LINE_MAX_DEPTH_ROWS` (3) rows deep, so a short drag can't string the group out in single file:
  `minCols = min(n, max(2, ceil(n / 3)))`, `minLength = (minCols - 1) * spacing` (n = selected units); a drag
  shorter than that is widened about its midpoint. A long drag spreads the front row along it, but slots are
  never more than `LINE_MAX_GAP` (1.5) x spacing apart (the row stays centred on the line), so a thin line
  doesn't open gaps.
- **Test:** `server/battle-discipline-test.mjs` (new; line frontage, a 3x3 block vs 6 goblins: max distance from
  slot, attackers per goblin, distinct targets, stacked bodies, return to slot; 9 goblins on a 3-knight line:
  claims per knight, knights attacked, stacked mobs). `formation-test.mjs` replica updated to the new spacing
  (and now uses `setInstantBuild`). Stale tests fixed alongside: `mob-kinds-test.mjs` checks the 98th-percentile
  per-tick step (body separation can shove a mob past its own speed on the odd tick; the raw max is reported),
  `world-gen-poi-test.mjs` D ignores the first (start-up) mining interval.

### Towers & farms — landed 2026-10-23

- **Archery kept** (user's call): the Archery Range (`ArcherPost`), and
  archer training / respawn / garrison levels are unchanged from c2440e3, except the wall-mounted Archer Tower upgrade is removed (`TileType.ArcherTower` = 19 stays
  reserved in the protocol; an old save's tile loads as an Archery Range). The Tower is a separate building.
- **Tower** (`TileType.Tower` = 62, build key `[`, `archerTower.png` art): free-standing 1x1, solid, no workers,
  no population slot, not a military tile (no unit spawns / army synergy). `updateTowers` (each tick, after
  mobs move) shoots the nearest hostile mob in range (never dormant guardians, passive raid groups or
  unturned deserters) with the ranged arrow VFX; damage is flat. Levels via the normal in-place upgrade:
  L1 8 dmg / 1.5 s / 7 tiles, L2 12 / 1.1 s / 7.5, L3 18 / 0.8 s / 8 (`TOWER_STATS`); cost 20w+15r, then
  30w+30r, 45w+50r (`TOWER_COSTS`). HP: big-building class, 250 / 350 / 450. Helpers `isTowerTile(tile)` (matches only
  `TileType.Tower`, not the Archery Range) and `livingTowersNear(tx, ty, radiusTiles)` (exported, for the gate logic).
- **Barns**: a Farm Plot may go anywhere within `BARN_FARM_RADIUS_TILES` 2 (Chebyshev) of a Barn with fewer than
  `BARN_MAX_FARM_PLOTS` 8 plots (was: orthogonally adjacent, so 4); it joins the nearest such Barn.
  `FARM_YIELD_PER_HARVEST` 36 -> 24: 6.67 grain per plot-day (was 10), a full Barn ~53/day (was 40).
- **Test:** `server/towers-farms-test.mjs` (new; hook `towerState`). `slow-farming-test.mjs` constant check
  updated (not re-run this round).

### Walls & gates — landed 2026-10-23

- **Walls** (§8 item 2): wood wall 3 wood (was 1), HP 200 (was 60); stone wall 3 rock (was 1), HP 900 (was 250).
  Full repair (0.3 x cost) is 1 wood / 1 rock.
- **Gate** (item 3): new `TileType.Gate` (= 70, numbered apart to avoid colliding with parallel tile additions),
  Combat tab, key `]` (`[` is the Tower), 10 wood + 5 rock, 8 s build, 450 HP, one material (wood-gate art `gateWoodClosed/Open`).
  Not in `isSolidTile`; per-tile server state `gates` (open, lock, overrun). Lock "auto" opens while a player or
  any colonist is within 1.5 tiles and closes 2 s after the last leaves (never on a body standing in it); the
  building info panel cycles Auto / Locked open / Locked closed (`setGateLock`; locked closed blocks the
  colony's units too). Open = passable for everyone; closed = solid for mobs and wildlife. Implemented in
  `isWalkableTile` from the mover's side (`hostileMover`, set by `withHostileMover` around raid groups, mob
  updates and wildlife; body separation uses the body's side); `advanceAlongPath` drops a path whose next
  tile is a gate that closed. Snapshot `gates` ([index, GATE_FLAG_*] pairs), `BuildingInfo.gate`, minimap
  draws gates as walls, saved / loaded (`gates`, old saves unaffected).
- **Mob gate vs wall** (item 4): `pickBuildingTarget` still takes an ordinary route within
  `BREACH_DETOUR_FACTOR` (open / overrun gates count as ground). Otherwise the breach search crosses walls
  and closed gates at `breachStepCost = 1 + round(hp / 25) + 12 x living towers within 8 tiles` (full HP:
  wood wall 9, gate 19, stone wall 37) and attacks the first obstacle on the cheapest route. A mob storming
  a gate re-picks once it opens / is overrun, and one whose path search failed re-picks once a second.
- **Gate overrun** (item 5): once a second per gate, if the summed current HP of awake mobs within 6 tiles
  beats the defenders' (guard / militia colonists + towers in that range) and no living tower
  (`livingTowersNear`, i.e. a `TileType.Tower`)
  stands within 8 tiles, the gate is passable for mobs (drawn open) until that majority is lost; toast
  "Gate overrun".
- **Test:** `server/gates-walls-test.mjs` (16 checks; test hook `gateState` with `checkOverrun`). Other suites
  not re-run this round: building-damage-test's breach step now chews through a 200 HP wall (was 60).

### Long days & dawn/dusk respawns — landed 2026-10-23

PLAN-512-map-and-forts.md §5. **Day 300 s, night 75 s** (`DAY_TICKS` / `NIGHT_TICKS`, was 60 s + 40 s): a game
day is 375 s, `DAY_LENGTH_SCALE` 3.75 x the old cycle, `DAYLIGHT_SCALE` 5 x the old daylight. The night stays
short so raids stay tense. Principle: the **economy runs per real second** (income per second unchanged, so a
long day means more to do between raids, not less income); only day-phase events stay per game day. Rates
that must not slow down are written against `LEGACY_DAY_TICKS` / `LEGACY_NIGHT_TICKS` (the old cycle).

| Rate | Was | Now | Basis |
|---|---|---|---|
| Farm Plot grow / fallow (`FARM_GROW_TICKS`, `FARM_FALLOW_TICKS`) | 3 / 3 days of 100 s | 3 / 3 legacy days (300 s each, ~0.8 long day) | per second: grain/plot/s, the 60-grain opening bridge and farm tests unchanged |
| Farm yield per harvest | 36 | 36 | per second |
| Farmhand cycle (`FARMHAND_CYCLE_TICKS`) | 3 x 60 s of tending | 3 x 60 s of tending, yield 90 | per second (1 unit per 2 s of tending) |
| Forage regrow (`FORAGE_REGROW_TICKS`) | 1 day (100 s) | 100 s | per second |
| Wildlife respawn (`WILDLIFE_RESPAWN_INTERVAL_TICKS`) | 4 per day (one per 25 s) | one per 25 s (~15 per long day) | per second |
| Tree regrowth (`TREE_RESPAWN_INTERVAL_TICKS`, lumberjack regrow) | 8 s / 10 s | unchanged | already per second |
| Worker production (chop / mine / craft / hunt / forage trips) | per tick | unchanged | per second (workers now work 80% of the cycle vs 60%) |
| Food upkeep (`FOOD_PER_COLONIST_PER_DAY`, at dawn) | 1 per colonist per day | 3.75 per colonist per day (colony total rounded up) | per second: still 1 per 100 s |
| Starvation damage, morale/desertion check, gravestone wipe, dawn autosave | each dawn | each dawn | per game day (fewer per hour) |
| Raid spawn (`RAID_SPAWN_CYCLE_TICK`) | day midpoint (30 s) | day midpoint (150 s) | per game day |
| Raid size / kind unlocks / Hunger-mark chance | per day index | per day index | per raid (one raid per night; see caveat) |
| Deserter activation (`DESERTER_ACTIVATION_DAYS`) | 10 days (~17 min) | 3 days (~19 min) | ~real time |
| Ward grace (`WARD_GRACE_TICKS` 60 s), repair toasts, combat timers | per tick | unchanged | per second |
| Goal track night counts | 1 / 3 / 7 / 14 / 21 | 1 / 2 / 4 / 7 / 10 | rescaled (6 / 12.5 / 25 / 44 / 62.5 min) |
| Respawn delay (`RESPAWN_DELAY_TICKS` 5 s) | 5 s, day only | removed: dawn / dusk windows | per game day |
| Client sundial / clock / music | from snapshot `cycleProgress` / `dayFraction` / `isNight` | unchanged | server-driven, nothing hard-coded |

- **Respawn windows** (`respawnWindowAt`, `nextRespawnWindow`, `processRespawnQueue`): the dead wait in
  `respawnQueue` and come back in one batch at **dawn** (cycle tick 0) or **dusk** (`DUSK_RESPAWN_CYCLE_TICK` =
  `DAY_TICKS - 1`, the last daylight tick, so "day-only respawns" still holds). Each unit still costs
  `RESPAWN_FOOD_COST` (5); one the batch can't feed or fit under the population cap waits for the next window.
  Builders whose Town Center fell are re-homed, invalid posts / staffed barns still drop their entry. A fallen
  Ward Priest follows the same windows (`wardPriestRespawnTicks` >= 0 = waiting). One toast per batch:
  "Reinforcements arrive at dawn/dusk: N units back on duty" (category `build`).
- **Client**: snapshot `respawn` (`RespawnWindowSnapshot`: waiting, nextWindow, ticksToWindow, dayTicks,
  nightTicks) drives `#stat-respawn` under the builders line in the Colony panel: "Reinforcements: 3 waiting ·
  dusk in 2:15" (or "Next respawn window: …").
- **Saves**: the queue was already saved; the world state now also stores `dayTicks` / `nightTicks`. A save in
  another cycle length (all older saves: 1200 + 800) loads via `migrateSaveDayLength`: same day number, same
  fraction through the day or night; absolute tick stamps (mob fury / feint / withdraw / last-damaged /
  deserter age, raid-group aggro / engaged, ward-stone tend times) move by the same delta.
- **Test**: `server/day-respawn-test.mjs` (new, self-contained, PORT default 19760, ~3 s): constants, goal
  rescale, mid-day death -> dusk batch + toast, night death -> dawn batch + toast, no-food window skipped,
  queue across save/restart/load, an old-format save migrated. `goals-castle-test.mjs` titles/night counts and
  `slow-farming-test.mjs` (legacy-day farm constants, `setInstantBuild`) updated but not re-run this round.
- **Caveat (balance)**: raids still ramp per raid while income per raid rises ~5x (5x the daylight), so raids
  are relatively easier and come 3.75x less often per hour; revisit `RAID_SIZE_PER_DAY` / unlock days after a
  playtest.

### Off-screen fight notifiers — landed 2026-10-23

- **Server:** every blow between a mob and the other side is logged: a soldier or player hitting a mob
  (`damageMob` gets an optional attacker key; test-hook and other blows without one don't count), and a
  mob hitting a colonist, player, building or Town Center. Every 0.5 s `scanFights` keeps the last
  `FIGHT_WINDOW_SECONDS` (3 s) of hits, clusters them by proximity (`FIGHT_CLUSTER_TILES` 8, merged when
  centroids drift together) and keeps each fight's id stable from scan to scan. Each fight records its
  centre tile, distinct combatants, dps, intensity 1-3, whether the colony's units / buildings / which
  players are in it, and a label from the fiercest attacker (Ogre Warlord > Castle Ruin > mini-boss >
  Ruin guardians / Bandit camp > Deserters > Bandit raid / Wolf pack / Dark host / Greenskin raid > Half-Latch).
- **Protocol (additive):** `FightSnapshot`, `FIGHT_*` constants, `snapshot.fights?`. It is per player:
  the server adds it to the shared snapshot JSON for each socket, and leaves it out when there are none.
  Relevant = the player is in it, or the (shared) colony's units/buildings are, or it's within
  `FIGHT_RELEVANCE_TILES` (48). Fights you're in come first, then by intensity, then nearest, at most 8.
- **Client:** `client/src/fightArrows.ts` (pure: rim clamping + angle, compass name, fade). Each fight
  outside the view gets a parchment arrow on the screen edge (tinted amber / red / seal by intensity,
  pulsing, "Bandit raid · north" / "Under attack · east" plus distance in tiles). It fades over the last
  second of the window and for 0.6 s once the fight is dropped. Clicking an arrow pans the camera there
  for 4 s (any movement key snaps it back). The minimap shows pulsing rings at every listed fight. The
  first time a fight starts off-screen there's one toast ("Greenskin raid to the west (31 tiles)"),
  at most one every 20 s.
- **Tests:** `server/fight-notifier-test.mjs` (clustering, centre, direction via the client helper, id
  stability, expiry, relevance across two players, building-only fight, cap of 8). `client/fight-arrows-test.mjs`
  (plain `node`, no server).
- **Manual browser check (user):**
  1. Leave soldiers fighting a raid somewhere off-screen: an arrow sits on the screen edge pointing at it,
     with a label and distance, and it rotates and slides along the rim as you walk around.
  2. Walk until the fight is on screen: its arrow goes away. Walk off again: it comes back.
  3. Kill the last raider: the arrow fades about 3 s later.
  4. Click an arrow: the camera glides to the fight, comes back by itself after ~4 s, or at once on WASD.
  5. The minimap shows a pulsing red ring where the fight is. A bigger battle pulses faster and redder
     (seal border on the arrow).
  6. One toast like "Bandit raid to the north (40 tiles)" when a new fight starts off-screen, and no
     second toast for another fight within 20 s.
  7. Arrows don't sit under the top buttons or toasts, or the bottom command bar. Hovering an arrow
     thickens its ring.

Execution order above is my default sequencing (foundation first since map/zoom/clock touch
everything downstream); say the word if you want a different item first.

## 8. Strategy plan 2026-10-23

The user's plan for the next round, in order. Three sequential agents: (1) battle discipline, (2) walls and
gates, (3) towers and farms. Each lands its own "— landed" section in §7's style and ticks its item here.

1. **Battle discipline / formations** — units keep formation, each fights the enemy nearest its own slot,
   attackers queue instead of clumping, tighter formations, a minimum line-drag frontage. **Landed
   2026-10-23** (see "Battle discipline" above).
2. **Walls costlier, much higher HP.** **Landed 2026-10-23** (see "Walls & gates" above).
3. **Gates** with an open / closed state: open for friendly units; when open, ANY unit (friend or foe) may
   pass. **Landed 2026-10-23.**
4. **Mob decision gate vs wall**: a mob chooses between going for a gate and breaching a wall. **Landed 2026-10-23.**
5. **Monsters with majority strength near a gate and no living towers pass through freely** (the gate no
   longer holds them). **Landed 2026-10-23.**
6. **Replace archery with a new "Tower" building**: no workers; upgradeable for rate of fire and damage.
   **Landed 2026-10-23** as a building of its own; the Archery Range stays (see "Towers & farms" above).
7. **Barns hold more farms, each farm less productive.** **Landed 2026-10-23** (see "Towers & farms" above).

## 512 map (phase A) — landed 2026-10-23

Plan: `~/docs/colony2d/PLAN-512-map-and-forts.md` §1 (no forts/camps/settlements yet).

- **Map size is a per-world choice**: Tiny 64, Small 96, Medium 160 (default), Large 256, Huge 384, Giant 512 (main-menu
  "Map size", stored in `localStorage` `sworn.mapSize`; the client only sends it once chosen). New Game (`setDifficulty`
  with `worldSize`, same claim rules as difficulty) and Restart (`restart` with `worldSize`) regenerate the world live at the
  new size (`setWorldSize` re-allocates tiles/biomes/explored/route buffers and the size-scaled counts) — no server restart.
  `COLONY_WORLD_SIZE` is only the boot default. Saves store `worldSize`; loading one resizes the world to it.
- **Counts**: trees/ore/ponds/forage/biomes scale by area; wildlife, ruins, encampments and mini-bosses use `scaledCountSub`
  (area up to 160, then the 4th root: ~1.8x a 160 map at 512). Castle Ruin still placed by a fraction of the map size.
- **Dormancy**: wildlife with no living player/colonist within 64 tiles only ticks its cooldown. POI guardians/deserters were
  already dormant; raid mobs are never dormant.
- **Snapshots**: worlds > 192 send each player only mobs/wildlife within 60 tiles (smaller worlds unchanged). Fog was already
  incremental (`explored` deltas); `welcome` still carries the whole map once (~1.1 MB at 512).
- **Pathfinding/raids**: `findPath` has a 60k-node budget (BFS head index instead of `shift`), `routeToBuilding` 120k settled
  nodes. Raids spawn on the edge of a box at most 110 tiles from the first Town Center (the whole map at <= 220).
- **Client**: floor sprites are built per 16x16 chunk, lazily, and hidden off screen (262k sprites at 512 otherwise).
- Test: `server/world-512-test.mjs` (512 gen time, tick time, snapshot bytes, save/load; live resize 160 -> 64 -> 256 and size
  round-trip through a save). 512 measured: gen ~2.1 s, idle tick avg ~4 ms, ~3.1 KB/snapshot, save 980 KiB / ~9 ms.
- Not done: chunked A*/hierarchical routing, camp/settlement sites, min POI spacing is the existing 10 tiles.

## Builders spread, farmers tend plots, wall repair — landed 2026-10-24

- Builders: `planBuildSite` / `planRepair` now sort candidates by builders already assigned (fewest first), then nearest (sites) or manual request / lowest HP fraction (repairs). `BUILDER_MAX_PER_SITE` stays 2, so several damaged buildings or sites get different builders at once.
- Farmers: a Barn farmer (`updateFarmer`) walks to each of its Barn's Farm Plots in turn, works ~6 s at each (state `farming`), skips unreachable plots, and shelters / returns to the Barn at night as before. Movement only: `updateFarmPlots` growth and yield are untouched. Farmhand posts without plots (Pasture, Orchard, ...) stay put.
- Wall repair: auto-repair already covered every damageable building (Wall, StoneWall, Gate via `structureHp`); repair cost is `ceil(placement cost * 0.3 * level * hp fraction)` so a wall is never free (min 1 wood / rock). Unaffordable jobs keep the "Not enough materials to repair" toast.
- Test hooks: `damageBuilding` (tx, ty, amount; 0 = just read HP), `farmers` in `constructionState`. Test: `server/builders-farmers-test.mjs`.

### Raid arrival timing — landed 2026-10-24
Every edge-spawned raid group now ARRIVES after nightfall and before 2/3 of the way into the night
(`RAID_ARRIVAL_WINDOW_FRACTION`). At spawn (`raidDepartureTick`) a random arrival tick in that window minus the
estimated trip (path length to the first Town Center minus the engage range, x `RAID_TRAVEL_SLACK`, over the
slowest member's speed, plus `RAID_TRAVEL_MARGIN_TICKS`) becomes the group's `aggroTick` (departure), never
earlier than the spawn (too-long trips leave at once). A group that reaches contact range before nightfall
`holdRaidGroup`s: stays in formation, members `passive` (towers/soldiers ignore them, nothing attacks), and engages
when night falls or the moment it is attacked. Paused groups keep `groupId`, so dormancy/respawn logic still treats
them as raid mobs. Deserter-only groups are unchanged. `holdRaidAggro` still pins departure to nightfall. New test
hook `raidDepartNow`; test: `server/raid-timing-test.mjs`.

## Settlement population caps — landed 2026-10-28

Population is now counted and capped per settlement (= per Town Center) instead of colony-wide.

- **Tier ceiling** (`SETTLEMENT_POP_CAP_BY_TIER` in server/src/index.ts): Town Center Lv1 = 20, Lv2 = 30, Lv3 = 40 (retuned 2026-10-28 from 12/24/40). Housing still reaches the ceiling at sensible building (Lv1: base 10 + ten Cottages, or four Big Cottages; Lv3: base 20 + four Lv3 houses), so the housing formula is unchanged.
- **Effective cap** of a settlement = `min(housing capacity, tier ceiling)`. Housing capacity keeps the old mechanics, attributed per settlement: 10 base (+5 for every Town Center after the first, +5 per level of that Town Center) + houses (1/3/5) and neighbourhood-synergy bonus of the houses nearest that Town Center. The colony-wide `populationCap` is the sum of the settlement caps.
- **Membership**: every unit that costs population (civilians, builders, bishops, siege engines at `SIEGE_POPULATION_COST`; Abbey clergy excluded) carries `settlementId` ("x,y" of the nearest Town Center to its post at spawn). Saved with the colonist; old saves get it on load (nearest Town Center to the post, never rejected; a settlement already over its cap just can't grow). If a unit's Town Center falls, it is lazily re-attached to the nearest remaining one (`settlementOf`), whether or not that one has room (nobody despawns; it just can't grow).
- **Gates**: new worker posts, upgrades that add a slot, siege queueing and respawns (dawn/dusk batch, Ward Priest) check the settlement nearest the post. A refused placement sends the event "Settlement 1 full (12/12) — upgrade the Town Center or build a Keep" ("build more houses" when housing, not the tier, is the limit). A respawn that doesn't fit keeps waiting for the next window; queued worker slots of construction sites count.
- **UI**: Town Center info shows `Population 9/12` and the upgrade button shows `(max pop 24)`; the Colony panel lists `Settlement N  used/cap` under the total (amber at cap, red over); a toast (once per 60 s per settlement) when one reaches its cap.
- **Protocol (additive)**: `TownCenterSnapshot.population?`, `populationCap?`, `populationTierCap?`, `populationKeepBonus?`; `TileType.Keep = 73`.
- **Test**: `server/settlement-pop-test.mjs` (self-booting, ports 21400+).
- Caveats: `town-center-test.mjs` is stale (expects the old 40x40 world / 300 HP Town Center) and fails independently of this change. Settlement numbers are the Town Center's position in the list, so they renumber when an earlier one is destroyed.

### Keep — separate building, 2026-10-28

The Town Center no longer upgrades "toward a Keep": its Lv3 used to be the Keep (art `townCenterKeep.png`); the tiers stay numeric 1/2/3 (caps 20/30/40, HP, costs unchanged, so old saves load as they are) and Lv3 now reuses the Lv2 plaza art. The keep art is now the new building.

- **Keep** (`TileType.Keep = 73`, sprite `castleKeep.png`, build menu Civic, hotkey `.`, big-building HP, builder required). Per settlement (nearest Town Center, like other posts), **one per settlement** (built or queued). A new Keep is refused unless that settlement's Town Center is Lv2+: "Keep needs a Town Center at level 2" (the build button is greyed until some Town Center is Lv2). Cost 60 wood + 40 rock + 20 iron; upgrades (generic building-level store, `KEEP_COSTS`) to Lv2 90/70/40 and Lv3 130/100/70 + 10 tools.
- **Effect**: each Keep level adds +10 to the settlement's tier ceiling AND +10 housing capacity (so the bonus is real whichever was limiting): cap = `min(housing + 10N, tierCap + 10N)`; max +30 at Lv3. Demolished or destroyed: the bonus goes (units over the cap stay, the settlement just can't grow).
- **UI**: Keep panel shows "Keep Lv N: +10N population" and the settlement's `Population used/cap`; the Town Center panel's cap line and the Colony panel include the bonus (`populationKeepBonus` in the snapshot).
- **Cap table** (tier ceiling + Keep): Lv1 20 / 30 / 40 / 50; Lv2 30 / 40 / 50 / 60; Lv3 40 / 50 / 60 / 70 (Keep none / Lv1 / Lv2 / Lv3).
- **Test**: `server/settlement-pop-test.mjs` (tier caps, Keep refusal/allow, Lv1-3 +10/20/30, second Keep refused, save/load, demolish).

## Camp hearths, soldier population, settlement spacing — landed 2026-10-28

- **Soldiers count toward the settlement cap.** `consumesPopulation` now covers every soldier (knight, archer, militia / spearman / pikeman, cavalry) on top of civilians, builders and priests; siege engines still count `SIEGE_POPULATION_COST` (2); Abbey clergy and wildlife never count. So the Colony / Town Center / Keep panels (all fed by `settlementStats`) include them. Military posts are gated like worker posts via `garrisonGain(tile, current)` (new post or in-place upgrade = base headcount after minus before: Knight Post 1 -> Hall 3 -> Castle 5, Militia 2 / 6 / 10, Archery Range 1 / 3 / 5, Stables 1 / 2 / 3): placement and the upgrade button are refused with the usual "Settlement N full (used/cap) — ..." when the gain doesn't fit, queued military construction counts as pending. Dawn / dusk respawns of soldiers wait for room (the cap check now runs only at a window tick, which is also cheaper), and house-bonus extras (`syncGuardBonusAt`) stop spawning while the settlement is full. Old saves: nobody is removed; a settlement already over its cap just can't grow. Note the starting colony (cap 10 at Lv1 with base housing) now fills after ~9 knight posts.
- **Settlements further apart**: `TOWN_CENTER_MIN_SPACING_TILES` 12 -> 24 (from every Town Center and queued one). A placement inside it gets "A new Town Center must stand at least 24 tiles from another" (it used to fail silently). World-gen has a single start Town Center, so nothing else changed. `settlement-pop-test.mjs`'s second-settlement search now starts at 26 tiles.
- **Camp hearths**: every site kind flagged in `SITE_KIND_HAS_HEARTH` (`{ hasHearth, hp }`; today only `encampment`, HP 150; ruins / Castle Ruin / mini-boss packs have none) gets a `HearthState` on its centre tile when the stamper (`placePoiSite`) lays it out, so a future fort / human-settlement kind only needs the flag (and an HP; scale by tier there). The hearth is the camp's existing PropCampfire tile with HP (no new art): a damaged hearth is listed in `damagedBuildings`, so it gets the usual HP bar and flames.
  - **Attacking it**: right-click a hearth with soldiers selected (`commandAttackHearth` {unitIds, tileX, tileY}; the units' rally moves to the hearth's approach tile), the player's attack when nothing else is in reach, or an aggressive-stance soldier with no enemy in reach and a standing hearth within `HEARTH_AUTO_TARGET_TILES` (8) inside its zone. Units fight guardians first (the hearth is only worked on when `pickGuardTarget` finds no mob). Siege x-multipliers as vs buildings: ram x4 (`SIEGE_BUILDING_MULT`), catapult x3. Every hit wakes the site's guardians (`activateGuardianSite`), so they defend it.
  - **Destroyed** (0 HP, `destroyHearth`): the camp breaks. Every guardian of the siteId routs through `startRout` with the regiment forced to a raid-style `leave` (morale 0; anchors too): they flee to the map edge away from the attackers and despawn there or after 60 s, no chasing. The campfire tile becomes `RuinRubble` (scorched remains), the camp props next to it burn away (Empty), with puffs. Loot to the stockpile: `HEARTH_LOOT_PER_GUARDIAN` (15 gold, 10 wood, 5 rock, 5 iron) x the camp's original garrison (2-4), also when its guardians are already dead. Toast (milestone): "The bandit camp breaks and scatters! Plundered ...". `campsDestroyed` counter in the goal state (saved under `goals`, reported by `goalState`); no goal uses it yet. A destroyed hearth stays in the save (`destroyed: true`): never respawned or re-woken.
  - **Saves**: `hearths` (all, destroyed included). Old saves / sites without a record get a full-HP hearth on load (`backfillHearths`: the campfire nearest each hearth-kind site's guardians; a campfire with no guardians left still gets one, garrison 2 for loot).
  - **Client**: right-click order; minimap ember marker for standing hearths on explored tiles only (snapshot `hearths`).
  - **Player settlements** are unchanged: their Town Centers already act as the centre (destroyable, game over at the last one).
- **Protocol (additive)**: `ClientMessage` `commandAttackHearth`; snapshot `hearths?` ([tile index, hp permille], `HEARTH_SNAPSHOT_STRIDE`).
- **Test hooks**: `hearthState` (hearths + their guardians, `campsDestroyed`, events), `damageHearth` {siteId, amount}.
- **Test**: `server/camp-hearth-test.mjs` (self-booting 160 world, port 21610): 9 knight posts fill settlement 1 (each +1), the next is refused "Settlement 1 full (10/10)", a Hall upgrade too; a Town Center 20 tiles away refused with the 24-tile message, one at 28 accepted; knights ordered at a bandit hearth hit it (138/150), it's in `damagedBuildings`; destroyed -> all guardians `leave` (tactics `rout` event), rubble tile, loot 15 x garrison gold, toast, `campsDestroyed` 1, guardians gone after 65 s; save/load keeps the destroyed flag and every hearth. `settlement-pop-test.mjs` (default port now 21620) and `tactics-test.mjs` re-run: all pass.
- Caveats: hearths are encampment-only (all bandit camps today; orc faction wording is ready). Mobs never target their own hearth, towers ignore it. The hearth has no info panel (no building info on decor tiles). Soldiers posted by the `spawnSoldier` test hook count toward population like any soldier.

## Armour & weapons — landed 2026-10-28

A colony-wide stock of armour and weapons, tier 1-3, worn by the line troops. All constants sit in one block in
server/src/index.ts (`EQUIP_*`, `FORGE_*`, `WEAPON_DAMAGE_MULT`, `ARMOUR_DAMAGE_TAKEN_MULT`).

| Tier | Weapon: damage dealt | Armour: damage taken | Forge armour | Forge weapon |
|---|---|---|---|---|
| 0 (unequipped) | x1.0 | x1.0 | - | - |
| 1 | x1.2 | x0.85 | 3 iron, 15 s | 2 iron + 1 wood, 10 s |
| 2 | x1.4 | x0.7 | 5 iron + 1 tool (or + 1 wood without tools), 15 s | 4 iron + 1 wood, 10 s |
| 3 | x1.7 | x0.55 | 8 iron + 2 tools (or + 2 wood), 15 s | 6 iron + 1 wood, 10 s |

- **Stock**: `equipment` {armour[3], weapon[3]} (index = tier - 1). Saved (`equipment`; old saves: zeros), sent in
  every snapshot (`equipment?`), shown in the Colony panel as "Armour T1/T2/T3: 2/0/1 · Weapons: 3/1/0", each half
  amber when it is all zeros.
- **Who wears it**: knight, spearman, pikeman, cavalry (`EQUIPPED_KINDS`; not militia, archers, siege engines,
  civilians). `spawnColonistForPost` calls `equipNewUnit` for those kinds, so it covers new posts, upgrade-added
  slots, dawn / dusk respawns, house-bonus extras and the `spawnSoldier` test hook: each slot takes the highest
  tier in stock (independently). With none in stock the unit still spawns, at tier 0 for that slot, and a toast
  ("A knight musters without armour ... forge more at a Blacksmith") fires at most once per 60 s. Tiers are stored on
  the colonist (`armourTier` / `weaponTier`, saved with it; old saves: missing = 0) and sent as optional
  `ColonistSnapshot.armourTier` / `weaponTier` (omitted at 0). A militia camp upgrade converts its existing militia
  to spearmen / pikemen in place: they are not spawns and keep tier 0 (only the extra slots muster equipped).
- **Effects**: the weapon multiplier is applied in `guardStrike` (every blow at a mob, before the cavalry charge x2,
  so it stacks multiplicatively) and on hearth blows; the armour multiplier in `damageColonist` (the single place a
  colonist loses HP, so every mob blow, boulder, poison tick is reduced). Max HP is unchanged by armour.
- **Blacksmith forging**: the Blacksmith info panel gets "Forge Armour Tn" / "Forge Weapon Tn" buttons (`queueForge`
  {tileX, tileY, slot}; `BuildingInfo.forge`: tier, queue, progress, cap, options with cost + reason). Tier = the
  Blacksmith's level at queue time. Cost paid when queued, no refund. Each Blacksmith has its own queue, one item at a
  time, `FORGE_QUEUE_CAP` 5 queued (incl. the one in progress); progress only runs while its artisan (the smith) is
  alive and posted there ("No smith at work" otherwise). Done items go to the stock with a toast. The smith's usual
  tools production is unchanged (forging is extra, not exclusive). **Queues are not saved**: a load starts every
  Blacksmith idle (what was paid for in-flight items is lost).
- **Drops**: a kill (`damageMob` death, so soldiers, towers, siege and players all count; deserters never drop) of an
  armoured kind (`EQUIP_ARMOURED_KINDS`: armored orc, bandit elite) drops one tier-1 piece (armour / weapon 50/50)
  with `EQUIP_DROP_CHANCE` 35%; bosses (Ogre Warlord, mini-boss elites) and Hunger-marked mobs always drop one.
  Toast the first time ("Salvaged a tier-1 armour from a fallen armored orc"), then at most once per 60 s.
- **Camp / boss loot**: a destroyed camp hearth adds 1 + floor(garrison / 2) pieces (armour / weapon at random, tier
  1/2/3 weighted 50/35/15%, `EQUIP_LOOT_TIER_WEIGHTS`), listed in the "Plundered ..." toast. The Ogre Warlord adds
  4 such pieces and a mini-boss elite 2 (`BOSS_EQUIP_LOOT`), named in their "fallen" / "slain" toasts (on top of
  the guaranteed tier-1 drop).
- **Client**: forge row in the building panel (cost, time and tier on the buttons; "Forging: Armour T2 40% · queue
  2/5"); Colony panel stock line; a single selected knight / spearman / pikeman / cavalry reads "Selected: Knight
  (armour T2, weapon T1) · Normal"; a thin bronze / silver / gold ring inside the role ring shows the armour tier
  (PLACEHOLDER, see SPRITES.md "New requests (2026-10-29 batch)", #45-#58).
- **Protocol (additive)**: `EquipSlot`, `EquipmentStock`, `ColonistSnapshot.armourTier?` / `weaponTier?`, snapshot
  `equipment?`, `BuildingInfo.forge?`, `ClientMessage` `queueForge`.
- **Test hooks**: `equipState` (stock, forge queues, equipped units, events equip / unequipped / forged / drop / loot /
  hit / taken), `setEquipment` {armour, weapon}, `equipConfig` {dropChance}, `damageColonist` {id, amount}.
- **Test**: `server/equipment-test.mjs` (self-booting 160 world, port 21710): forge at Blacksmith Lv1 and Lv2 (tier =
  level, exact iron / wood / tool costs, tool -> wood substitution), queue cap; a knight takes the highest tiers and
  the stock drops; an empty stock gives a tier-0 knight + toast; archers are not equipped; weapon T3 blow = base x1.7,
  armour T3 takes 11 of 20; armoured-orc kill drops a tier-1 piece, a goblin nothing, a marked goblin always; a
  destroyed hearth pays 1 + floor(garrison / 2) tiered pieces + toast; save/load keeps stock and every unit's tiers.
  `camp-hearth-test.mjs` re-run: all pass unchanged. `cavalry-siege-test.mjs`: K failed once (the two splash
  knights spawned wearing T2 / T1 armour looted from earlier kills in the same run, taking 15.3 instead of 18); the
  test now empties the stock before spawning them (logs the stock) - all pass.
- Caveats: equipment is never returned to the stock when a unit dies (each respawn takes fresh gear); weapon tier is
  not drawn on the map; deserters keep no gear; the forge has no dedicated art or busy state on the map.

## Hero phases 1-2: items, inventory, character sheet — landed 2026-10-28

Phases 1-2 of `~/docs/colony2d/PLAN-hero-character-sheet.md`, for the PLAYER only. Server block "Hero phases 1-2"
in server/src/index.ts (`HERO_*`, `RELIC_*`, `PLAIN_GEAR`, `RELIC_CATALOGUE`, `HeroProfile`); client block
"Hero phases 1-2: Character sheet" in client/src/main.ts plus `#hero-modal` in client/index.html.

- **Model**: `GearItem` {id, slot kind, name, tier 1|2|3|'relic', stats, kind?, relicId?, icon?}; stats are additive:
  damagePct, damageTakenPct (negative = better), maxHp, moveSpeedPct, attackSpeedPct, spellPowerPct. `Equipment` =
  {head, chest, legs, weapon, offhand, trinket1, trinket2, spell1-4}. A `HeroProfile` {key, equipment, inventory (cap
  40, unequipped items only), xp} is keyed by the ws URL's `?profile=` (the client keeps a random id in localStorage
  `sworn.profileId`; no key = "default"), saved with the world (`heroProfiles`; old saves: none, so everyone starts
  empty at level 1), cleared by Restart, never touched by death / respawn / load-respawn.
- **Derived (recomputed on every change, cached)**: damage x(1 + sum damagePct)(1 + 4% x (level - 1)) on every player
  blow (mobs, players, wildlife, hearths; also the tactics force estimate); damage taken x max(0.25, 1 + sum
  damageTakenPct) in `damagePlayer` (every blow and poison tick); max HP = 100 + sum maxHp + 6 x (level - 1) (current
  HP clamped down, gains don't heal; respawns / bishop heals / mob targeting use it); move speed x max(0.5, 1 + pct);
  attack cooldown = 10 ticks / (1 + attackSpeedPct); spell power is stored only (spells are phase 4).
- **Plain tiered pieces** (chest and weapon only, same strength as the soldiers' tier multipliers, which are unchanged):

  | Tier | Weapon (sword) | Chest armour |
  |---|---|---|
  | 1 | Iron Arming Sword, +20% damage | Iron & Leather Cuirass, -15% damage taken |
  | 2 | Steel Arming Sword, +40% | Steel Breastplate, -30% |
  | 3 | Gilded Arming Sword, +70% | Gilded Breastplate, -45% |

  Got only by "Take from armoury" on the sheet (`takeFromArmoury` {slot armour|weapon, tier}): one piece leaves the
  colony stock (so a soldier won't muster with it). Drops / loot still go to the colony stock as before.
- **The Sworn Relics** (unique per profile; a drop picks a random one not owned or equipped, none once all 8 are):

  | Relic | Slot | Stats |
  |---|---|---|
  | Oathkeeper's Helm | head | -15% damage taken, +20 max HP |
  | Gorrath's Hide | chest | -40% damage taken, +30 max HP |
  | Vhorrun's Stride | legs | +15% move speed, -10% damage taken |
  | Aegis of the Ward Stone | off-hand (shield) | -20% damage taken, +15 max HP |
  | The Sworn Oathblade | weapon (sword) | +60% damage, +10% attack speed |
  | Gunne's Tooth | weapon (spear) | +55% damage, +10% move speed |
  | Morvain's Whisper | weapon (bow) | +40% damage, +30% attack speed |
  | Abbey Emberstaff | weapon (staff) | +35% damage, +40% spell power |

  Sources: the Ogre Warlord and every mini-boss elite always; a destroyed camp hearth 15%; an armoured kind (armored
  orc, bandit elite) or Hunger-marked mob 8% (read "armoured elites or Hunger-marked"). Goes to the killer if a player
  struck the killing blow, else to every connected player's profile. Toast to that player only: "Relic found: <name>".
  Pack full: "A relic was found, but your pack is full".
- **XP**: only the player's own killing blows: 10 per mob, x3 Hunger-marked, 60 a mini-boss elite, 250 the Warlord.
  Levels 1-10 start at 0 / 40 / 100 / 180 / 280 / 400 / 550 / 730 / 940 / 1200 XP; level-up toast.
- **Equip rules** (`equipItem` {itemId, slot} swaps any occupant back to the pack; `unequipItem` {slot}; any time):
  the item's slot kind must match (trinket -> trinket1/2; spell slots have no items yet); refused ones toast the
  reason to that player. Unequip / take refuse when the pack is full.
- **Protocol (additive)**: `GearSlot`, `GEAR_SLOTS`, `ItemSlotKind`, `ItemTier`, `ItemStats`, `GearItem`, `Equipment`,
  `HeroStats`, `HeroProfileSnapshot`; messages `equipItem`, `unequipItem`, `takeFromArmoury`; snapshot `profile?`,
  appended per player (like `fights`) only when that profile's version changed (and after every welcome), so the
  shared snapshot doesn't grow. `PlayerSnapshot.maxHp` is now the derived max.
- **Client**: **` (Backquote)** toggles the sheet (C is the Church tool; every letter is bound), plus a **Hero** button
  in the top-right controls; Escape / backdrop / x closes. Paper-doll (trinket / head / trinket, weapon / chest /
  off-hand, legs, 4 greyed spell sockets "coming soon"), level + XP bar, stat summary (HP, damage, damage taken, move
  speed, attack speed, spell power, green = better), pack grid, six "Chest armour / Weapon T1-T3 (n)" armoury
  buttons. Icons are placeholders: slot-coloured square + glyph, border bronze / silver / gold / purple-teal relic;
  `/sprites/<item.icon>.png` (SPRITES.md #49 `icon-armourT1-3` / `icon-weaponT1-3`, #51 `relicHelm` ... `relicStaff`)
  is drawn over it once it exists (a missing file is tried once per session). Tooltip: name, tier/relic + slot, stat
  lines, +/- deltas vs the item in the target slot.
- **Test hooks**: `heroState` (profile, hp, cooldown, keys, events hit / taken / relic / xp / equip / unequip / take /
  refuse), `grantRelic` {relicId?}, `heroConfig` {relicChance}; `spawnMob` takes `boss` ("warlord" | "elite"),
  `damageMob` takes `byPlayer: true`.
- **Test**: `server/character-sheet-test.mjs` (self-booting 160 world, port 21810): 28 checks, all pass (grant, wrong
  slot refused, blow 15 x1.6 = 24, Hide x0.6 / 130 HP, clamp on unequip, armoury take T3 / refuse empty T2, swap,
  XP/level 2 = x1.04 / +6 HP, elite / Warlord / forced hearth relics, save/load, death keeps gear).
  `equipment-test.mjs` re-run: all pass unchanged.
- **Phase 3 hooks**: give each hero a `HeroProfile` (key e.g. `hero:<colonistId>`, same save list); apply
  `computeHeroStats(prof.equipment, prof.level)` in `guardStrike` / `damageColonist` / its maxHp; route its kills to
  it in `heroRewardsForKill`; the sheet needs a tab list and a `heroId` on the equip messages (default = the player).
- Caveats: no unequip-to-armoury (plain gear can't go back to the stock); bow / staff relics still swing the
  player's melee blow; equipment isn't drawn on the rider (SPRITES.md #55).

**Manual browser check (the sheet)**
1. Press ` (or click Hero): the sheet opens; level 1, 0 / 40 XP, Health 100 / 100, every multiplier x1.00, empty pack.
2. Forge (or have) armour / weapons in stock: the armoury buttons show the counts; click "Weapon T1": it leaves the
   Colony panel stock line and appears in the pack with a bronze border.
3. Hover it: tooltip "Iron Arming Sword, Tier 1 · Weapon, +20% damage (+20%)". Click it: it moves to the Weapon
   socket, Damage reads x1.20 in green. Click the socket: back to the pack.
4. Kill 4 mobs yourself (Space): a "You reach level 2" toast; the bar and Damage x1.04 / Health max 106 update.
5. Kill a mini-boss elite: "Relic found: ..." toast; the relic has the purple-teal border; equip it, hover another
   weapon to see red / green deltas.
6. Die and respawn: gear and pack are unchanged. Save, reload the page (same browser), load the save: same sheet.
7. Esc, the x and a backdrop click close it; WASD still moves while it's open.

## Hero phase 3: heroes — landed 2026-10-28

Phase 3 of `~/docs/colony2d/PLAN-hero-character-sheet.md`. Server: `HERO_CLASS_STATS` / `HERO_POPULATION_COST` next to
the siege constants, the rest in the "Hero phase 3: heroes" block after "Hero phases 1-2"; client: Keep row
(`bp-heroes-row`), sheet tabs (`hs-tabs`), hero visuals in `upsertColonist` / `drawRoleRings`.

| Class | Role | HP | Damage | Range | Attack | Speed | Recruit cost |
|---|---|---|---|---|---|---|---|
| Champion | shock (front centre) | 160 | 26 | melee (knight's) | 0.8 s | 110 | 120 gold + 20 iron |
| Marksman | ranged (rear line) | 90 | 16 arrow | 5 tiles (archer + 1) | 1.2 s | 100 | 100 gold + 30 wood |
| Mage | caster (rear line) | 80 | 14 magic bolt (shaman bolt art) | 7 tiles | 1.5 s | 95 | 140 gold + 20 rock |

- **Unit**: `ColonistKind` `"hero"` with `heroClass` / `heroName` on the colonist (saved with it). The colonist id
  is the hero's stable id; its `HeroProfile` `hero:<id>` (same `heroProfiles` list / save as the players', now
  with `heroClass` / `heroName`) holds XP, level and equipment. Stats = class base through the SAME
  `computeHeroStats(equipment, level, baseHp)` as the player: damage x(1 + gear %)(1 + 4% per level), max HP =
  base + gear + 6% of base per level (the player's base is 100, so still +6 HP), damage taken (in
  `damageColonist`), move / attack speed. `unitStats(c)` replaces `guardStats(kind, level)` wherever a live
  unit's stats are read (guard update, squad pace, tactics force). Heroes are soldiers (`isGuardOrMilitiaKind`,
  commandable, squads / formations / stances / attack / hearth orders, guard targeting, ranged discipline for
  marksman / mage), never desert (`isSoldierKind` excludes them), take no armour-tier stock, and never despawn
  (a demolished Keep leaves them posted at its tile). Role: `unitRole(kind, heroClass)` (protocol;
  `HERO_CLASS_ROLE`), used by server `colonistRole` and every client role lookup.
- **Recruiting** (`recruitHero` {tx, ty, class}, Keep panel buttons): heroes per Keep <= Keep level (1-3), <= 9 in
  the colony, cost paid at once, 2 population in the Keep's settlement (`settlementBlocker(tx, ty, 2 x (1 +
  recruits pending there))`). Refusals toast "Can't recruit: Keep Lv 1 holds 1 hero (upgrade the Keep for more)" /
  "Settlement 1 full (19/20) — ..." / "Not enough resources". The hero arrives after 10 s (`HERO_RECRUIT_TICKS`;
  1 tick with instant build) beside the Keep, rallying where it stepped out. Names: random from `HERO_NAMES` (20),
  unique in the colony. Pending recruits are saved (`heroRecruits`).
- **Death / respawn**: the respawn queue entry carries `hero` {id, name, heroClass}; it is never dropped. At a
  dawn / dusk window it comes back (same id, name, level, gear, full HP) if the settlement has room for 2 and
  the stock has the fee 50 + 25 x level gold (paid then, no food); otherwise "X waits for N gold ..." and it
  waits for the next window.
- **XP / loot**: a kill whose attacker key is `c:<hero id>` (melee blow or its arrow / bolt) gives that hero
  the XP of `heroRewardsForKill` (10 / x3 marked / 60 elite / 250 Warlord); toast "<Name> reaches level N". Relic
  rolls are unchanged and go to the connected players' packs. A relic worn by any hero counts as owned.
- **Sheet**: tabs "Player | <hero> Lv N ..." (up to 9; fallen / recruiting ones in italics); a hero tab shows its
  sockets, stats, level / XP, HP (or "fallen: back at dawn / dusk for N gold") over the player's shared pack.
  `equipItem` / `unequipItem` / `takeFromArmoury` take an optional `heroId` (take: the piece goes to the pack
  and straight onto that hero if the socket is free). Opening the sheet (` or Hero) with one hero selected opens
  its tab; the selection line reads "Champion Hild Lv 2 (` opens its sheet)".
- **Client art (PLACEHOLDER)**: champion = knight set, marksman = archer set, mage = bishop set, tinted pale
  gold; "Name · Lv N" label; a gold ring with four pips outside the role ring; mage bolts drawn as the shaman's.
  Colony panel army line adds "Heroes N".
- **Protocol (additive)**: `HeroClass`, `HERO_CLASSES`, `HERO_CLASS_ROLE`, `HERO_CLASS_LABEL`, `unitRole`,
  `HeroSheetSnapshot`; `ColonistSnapshot.heroName? / heroClass? / heroLevel?`; snapshot `heroes?` (appended per
  player when `heroRosterVersion` changed); `BuildingInfo.heroes?`; messages `recruitHero`, `heroId?` on the
  three gear messages.
- **Test hooks**: `heroUnitState` (sheets, live units with stats / role, recruits, queued respawns, gold, hero
  events spawn / recruit / hit / xp / respawn / respawnWait); `damageMob` takes `byColonist`.
- **Test**: `server/hero-test.mjs` (self-booting 160 world, port 21910): 24 checks, all pass. `character-sheet-test.mjs`
  and `settlement-pop-test.mjs` re-run: all pass unchanged.
- **Caveats**: heroes use borrowed art; the hero list is colony-wide (every player sees every hero's tab and can
  equip it from their own pack); a hero whose Keep is gone still counts toward that Keep's tile (it respawns
  beside the empty tile and a new Keep elsewhere starts its count at 0); the marksman's / mage's projectile
  damage is instant like the archers'; mages have no spells yet.
- **Phase 4 (spells) hooks**: `HeroProfile.stats.spellPowerMult` is already derived for heroes; `spell1-4`
  sockets exist on every hero profile; `heroCombatStats(c)` is where a cooldown / auto-cast hook can read the
  class (mage = caster) and level; `guardStrike`'s hero branch (`heroTestEvent "hit"`) is the place to swap a
  basic bolt for a cast; the sheet's disabled spell sockets take `heroArg` like the gear sockets.

**Manual browser check (heroes)**
1. Upgrade a Town Center to Lv2, build a Keep, click it: three "Recruit ..." buttons with costs, "Heroes 0/1".
2. Recruit a Champion: toast, 10 s later a gold-tinted knight with "Name · Lv 1" and a gold pip ring beside the
   Keep; the Keep panel reads "Heroes 1/1" and the buttons grey out; Settlement population +2.
3. Click the hero: "Selected: Champion Name Lv 1 (` opens its sheet)"; move / attack orders work; in a box
   select with knights and archers it takes the front centre.
4. Press `: the sheet opens on the hero's tab (Player | Name Lv 1); equip a relic from the pack: its stats
   change, the Player tab's pack loses it; unequip: back in the pack.
5. Upgrade the Keep, recruit a Marksman and a Mage: they hold the rear line; the mage throws purple bolts.
6. Let a hero die: toast with its fee; its tab shows "fallen"; it returns at the next dawn / dusk window and the
   gold drops by 50 + 25 x level. Save, reload, load: heroes, names, levels and gear are back.

## Hero phase 4: spells — landed 2026-10-28

Phase 4 of `~/docs/colony2d/PLAN-hero-character-sheet.md`. Spell table `SPELLS` in `protocol.ts` (shared, so the
client's tooltips use the server's numbers); server block "Hero phase 4: spells" after "Hero phase 3: heroes"
(`SPELL_*`, `TOME_*`, `CHURCH_SPELL_PRICES`, statuses, casting, hero auto-cast); client: spell bar (`#spell-bar`),
sheet spell slots / spell book (`hs-spellbook`, `hs-spell-auto`), Church row (`bp-spells-row`), `spawnSpellEffect`.

| Spell | Target | Range | Cooldown | Effect (bold = scaled by spell power) |
|---|---|---|---|---|
| Fire Bolt | enemy | 8 | 4 s | **30** damage + burn **3**/s for 3 s |
| Thunder | ground | 7 | 12 s | **40** damage to every enemy within 2 tiles |
| Frost | ground | 7 | 14 s | **15** damage + 50% slow for 4 s, radius 2.5 |
| Heal | ally / self | 6 | 8 s | heals **45** |
| Ward | ally / self | 6 | 18 s | shield absorbing **60** damage for 8 s |
| Rally Banner | ground | 5 | 30 s | friendly soldiers + players within 4 tiles: +25% damage, +15% speed for 10 s |
| Summon | ground | 4 | 45 s | 2 skeleton militia (0 population, aggressive) for 40 s, then they crumble |
| Curse | enemy | 8 | 16 s | +30% damage taken from every source for 8 s |

- **Spell power** = `HeroStats.spellPowerMult` (gear `spellPowerPct`; a mage gets +25% base, `SPELL_MAGE_BASE_PCT`,
  folded into its stats so the sheet shows x1.25). Any profile can learn / cast any spell.
- **Book** (per `HeroProfile`, saved with it; old saves: none): `spells` (learned ids), `spellSlots` (4 spell ids),
  `spellAuto` (heroes; default on), `spellGrants`. The 4 slots are spell ids in `spellSlots`, NOT
  `Equipment.spell1-4` (those sockets hold `GearItem`s and stay null; keeps the protocol additive). A newly learned
  spell drops into the first free slot. Snapshot: `HeroProfileSnapshot.spells?` {learned, slots, auto, cooldowns
  (ticks left at send time)}; the profile is resent on every cast (version bump) so cooldowns arrive then.
- **Learning**: (a) levels 2 / 4 / 6 / 8 / 10 each auto-learn the next unlearned spell of a fixed order (player:
  Fire Bolt, Heal, Ward, Thunder, Rally Banner; champion: Rally Banner, Ward, Curse, Thunder, Heal; marksman:
  Fire Bolt, Curse, Frost, Thunder, Rally Banner; mage: Fire Bolt, Frost, Thunder, Heal, Curse, Summon), toast
  "You learn Fire Bolt (spell slot 1)" / "<Hero> learns ...". On load, a level-N profile with fewer grants gets
  the missing ones silently (so old saves catch up). (b) **Spell Tomes**: `GearItem` slot `"tome"`, tier "relic"
  (purple border), `spellId`; the Warlord always, a mini-boss elite 50%, a destroyed camp hearth 10% (killer, else
  every connected player, like relics); teaches a spell the receiver doesn't know. Pack click = `useTome`
  {itemId, heroId?} (the open tab's profile learns it, tome consumed). (c) **Church** info panel: "Learn Heal (80
  gold)" / "Learn Ward (120 gold)" (`BuildingInfo.spellShop`, `learnSpell` {spellId, tileX, tileY}; player only,
  colony gold).
- **Casting** (`castSpell` {slot, targetId? | x, y, heroId?}): validated server-side: learned, slotted, cooldown
  (per spell per caster profile), range (+ half a tile slack), caster alive, target kind. Refusals toast the
  reason ("Fire Bolt is on cooldown (4 s)", "Out of range (8 tiles)"). Kills credit the caster (`p:` / `c:` key: XP,
  relics, tomes). Effects go out as `AttackEffect.spell`.
- **Statuses** (`spellStatuses`, transient, not saved): burn ticks in `updateSpellStatuses`; curse in `damageMob`;
  ward shield in `damagePlayer` / `damageColonist` (after armour / gear); rally damage in `guardStrike`, hearth blows
  and `playerDamage`, rally speed in `unitStats` and the player's move; frost scales `mob.speed` and restores it on
  expiry (`snapshotWorld` saves the unslowed speed). Summons (`summonedUntil`) aren't saved, cost 0 population,
  never respawn or leave graves; `ColonistSnapshot.summoned?`.
- **Hero Auto** (`heroAutoCast`, from `updateGuardColonist`, every 5 ticks): first slotted ready spell whose rule
  holds: Fire Bolt / Thunder / Frost at the current or nearest awake enemy in range; Curse on a boss / shock-role
  enemy not already cursed; Heal the most wounded friendly below 60% in range; Ward a friendly hurt in the last 2 s
  without a shield; Rally Banner with 4+ soldiers attacking / engaging within 4 tiles; Summon when awake enemies
  within 6 tiles outnumber friendly soldiers (and are 2+). Sheet hero tabs: "Auto-cast: On/Off" (`setSpellAuto`).
  The player never auto-casts.
- **Client**: spell bar above the command bar (shown once a spell is learned; parchment; icon, hotkey, dark
  cooldown overlay with seconds). **Keys: Shift+1..4 or F1..F4** (every letter, bare digit and Ctrl / Alt + digit
  were taken). A targeted spell then waits for a left click (yellow range ring round the rider, crosshair): enemy =
  click a monster; ally = click a friendly unit / player, empty ground = yourself (or press the key again);
  ground = the spot. Right click / Escape cancels. Sheet: 4 spell sockets (pick a spell in the spell book, then
  click a socket; click a filled socket to empty it), spell tooltips with the scaled numbers, Learn on tomes.
  Placeholder icons: coloured square + glyph, `/sprites/spell-<id>.png` (SPRITES.md #57: `spell-fireBolt`,
  `spell-thunder`, `spell-frost`, `spell-heal`, `spell-ward`, `spell-rally`, `spell-summon`, `spell-curse`) drawn
  over it once present. Cast art (PLACEHOLDER): fire bolt = orange shaman bolt, thunder = blue sparks + poof,
  frost = blue poof, heal = heal sparks, ward = ward pulse, rally = red poof + gold spark, summon = grey poof,
  curse = purple poof; summons = militia art tinted bone-grey.
- **Protocol (additive)**: `SpellId`, `SpellTargeting`, `SpellDef`, `SPELLS`, `SPELL_IDS`, `SPELL_SLOT_COUNT`,
  `SpellBookSnapshot`, `HeroProfileSnapshot.spells?`, `ItemSlotKind` "tome", `GearItem.spellId?`,
  `AttackEffect.spell?`, `ColonistSnapshot.summoned?`, `BuildingInfo.spellShop?`; messages `setSpellSlot`,
  `useTome`, `learnSpell`, `castSpell`, `setSpellAuto`.
- **Test hooks**: `spellState`, `grantSpell` {spellId, heroId?}, `grantTome` {spellId?}, `spellConfig`
  {tomeChance, resetCooldowns}, `spawnHero` {heroClass, x, y, stance?}.
- **Test**: `server/spells-test.mjs` (self-booting 160 world, port 22010): 28 checks, all pass (level-2 Fire Bolt,
  tome learn + consume, Church -200 gold, setSpellSlot validation, Fire Bolt 30 + burn 9, cooldown refusal, range
  refusal, x1.4 staff = 42, Thunder hits 2 trolls, Frost slow + expiry, Curse x1.3, Heal +45, Ward absorbs 50, Rally
  buffs, Summon 2 at 0 population then crumble, mage Auto Heal 56.25, Auto toggle, save/load). `hero-test.mjs`: all
  pass unchanged. `character-sheet-test.mjs`: its relic counter now excludes tomes (the elite / Warlord kills also
  drop tomes, tier "relic") - all pass.
- **Caveats**: cooldowns / statuses / summons reset on load; the player can't cast for a hero from the bar (the
  server accepts `castSpell.heroId`, no UI); spells ignore line of sight and walls; summons are plain militia
  (stance aggressive, chase anything); several sessions on one profile share its cooldowns; spell icons and cast
  art are placeholders; no mana / gold cost per cast.

**Manual browser check (spells)**
1. Kill 4 mobs yourself (Space): "You reach level 2" and "You learn Fire Bolt (spell slot 1)"; a spell bar
   appears above the command bar with Fire Bolt and "⇧1".
2. Press Shift+1 (or F1): crosshair + a yellow range ring round you; click a monster in range: an orange bolt
   flies, its HP drops 30 then a little more for 3 s; the button greys with a 4..1 countdown. Shift+1 again at
   once: "on cooldown" toast. Click a monster outside the ring: "Out of range" toast. Right click cancels an aim.
3. Build / click a Church: "Learn Heal (80 gold)" / "Learn Ward (120 gold)"; click both: gold drops, they land
   in slots 2-3. F2 then click a wounded soldier: green sparks, it heals. F3 twice: a ward pulse on you; take a
   hit: no HP lost until 60 is soaked.
4. Press `: the sheet's 4 spell sockets show the icons; the Spells list shows every learned spell; hover:
   tooltip with range / cooldown / numbers. Click a spell, then a socket: it moves there; click a filled
   socket: it empties (the bar follows).
5. Kill a mini-boss or the Warlord (or a camp): a "Spell tome found" toast and a purple-bordered tome in the
   pack; click it: "You learn ..."; it's gone from the pack. On a hero tab, the tome teaches that hero.
6. Recruit a Mage, open its tab: Spell power x1.25, "Auto-cast: On". Give it Heal (tome or level 2+); wound a
   soldier near it in a fight: it heals on its own. Toggle Auto off: it stops.
7. Save, reload, load: learned spells, slots and Auto settings are back (cooldowns reset).

## Walls connectors & oriented gates — landed 2026-10-28 (client-only)

- Art: SPRITES.md #59-#62 from `art-sources/Pixel Art Wall and Gate Tileset Atlas.png` (see "Already sourced" there for
  file names and the art problems found: front-on "vertical" gates, narrow corner/T pieces leaving gaps).
- `wallArtFor` (client/src/main.ts): a Wall / Stone Wall picks piece 0-15 from the 4-bit mask of its N/E/S/W neighbours
  that are the same material or a Gate, and the `...Dmg` set below 50% HP. A Gate is horizontal with a wall/gate east
  or west, vertical with them only north/south, stone when stone walls outnumber wood around it, and shows
  Overrun > Open > Damaged (below 50% HP) > Closed. `setTileLocal` redraws wall/gate neighbours when a tile changes;
  `syncGates` now also redraws on open <-> overrun. All drawn at one scale (`WALL_ART_PX_PER_TILE`). Optional load:
  missing files fall back to the old single sprites. No protocol / server change.

**Manual browser check (walls)**
1. Build a long east-west wood wall: one continuous palisade (straights overlap, ends show the end caps). Same north-south.
2. Close it into a rectangle and add an inner cross wall: corners, T-junctions and a 4-way cross each show a different
   cluster piece. Note any gap between a corner/T and the straight next to it.
3. Repeat with stone walls; wood and stone touching do not connect.
4. Place a Gate in the east-west wall: horizontal gate; in a north-south wall: the "vertical" art. Next to stone walls
   it is the stone gatehouse.
5. Walk a colonist through it: it switches Closed -> Open -> Closed. Lock it open / closed from its panel.
6. Let a raid batter a wall and a gate below half HP: the damaged pieces / Damaged gate appear (with the soot tint);
   repair it: intact art comes back. A raid overrunning a gate shows the Overrun (broken) gate.
7. Demolish a wall tile in the middle of a run: both neighbours switch to end caps.

## Strategy mode phase 1 — landed 2026-10-28

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 1 (camera, zoom, LOD, fog; one small server change).

- **Camera** (`client/src/strategy/camera.ts`): Tab (or the new top-bar "Command" button) eases 350 ms from the
  rider to zoom 0.5; Tab again / Esc (when no spell aim, panel, modal or selection is open: the first Esc still
  clears a selection) eases back to the rider at 1.3. `const ZOOM` is now `let camZoom` everywhere (pointer maths,
  floor-chunk culling, minimap view rect, fight arrows). Pan: WASD / arrows, 12 px edge scroll, middle-drag; wheel
  zooms about the cursor (floor = the whole map fits on screen, min 0.05); minimap click / drag jumps there; Home
  centres on the rider; a fight-arrow click jumps the strategy view instead of peeking.
- **Strategy mode rules**: rider sends `input {0,0}` (stands idle, can be attacked), Space doesn't swing. Building
  and demolishing stay available (build panel, hotkeys, right-click place, left-click demolish all work as in the
  normal view). Selection, box select and orders work as before.
- **LOD** (`client/src/strategy/lod.ts`): Tactical >= 0.75 as today; Field 0.35-0.75 civilians at 50% alpha; Map
  < 0.35 hides the floor, decor and tile layers (floor chunks aren't even built) and shows the minimap's 1 px/tile
  canvas as a nearest-scaled "strategic map" sprite, units as role-tinted screen-size dots (selected = cyan, mobs
  red, riders rings, Town Centers squares). Stand-in banners (name + count + HP bar, constant screen size) over each
  group of commandable units sharing a post (heroes alone) until Phase 2's server regiments.
- **Fog** (strategy mode only; tactical stays unfogged): unexplored black, explored-but-not-in-live-vision dimmed 45%
  (same sources as the minimap's live vision), rebuilt at most every 200 ms. Mobs, their role rings, wildlife and
  right-click attack targets only inside live vision.
- **Server / protocol (additive, both copies byte-identical)**: `ClientMessage` `setView {x, y, halfW, halfH,
  strategy}` in tiles. `handleSetView` validates (finite numbers), clamps the centre into the map and half extents to
  [1, 140] tiles (+4 tile margin), accepts at most one per 100 ms per socket (client sends <= 5/s, only on a >= 1 tile
  change), `strategy:false` clears it. Big-world (> 192) snapshot culling keeps mobs / wildlife near the avatar OR
  inside the view rect. Dormancy, raids and fights still key off the rider only.
- **Floor chunks**: beyond 256 built chunks, off-screen ones are freed (strategy panning would otherwise build all
  1024 chunks of a 512 map).
- **Test**: `server/strategy-view-test.mjs` (own server, port 20611, world 256): far mob culled without a view; in
  the snapshot with a view over it; oversized view clamped; 140-tile view includes it; malformed setView ignored;
  `strategy:false` drops it. 6/6 pass. Snapshot bytes at 256 with ~40 mobs: rider-only ~6.6 KB, 140-tile view ~33 KB.
- **Caveats**: in the Map band on 512 the server view cap (140 tiles) is smaller than the screen, so mobs farther than
  ~144 tiles from the view centre are not sent (Phase 5's `enemyRegiments` summaries cover that); buildings in the Map
  band are only the map's tan pixels plus Town Center squares; attack VFX (arrows, slashes) of fights outside vision
  still draw; no walk-anim freeze in the Field band; banners are client-derived, not regiments yet.

**Manual browser check (strategy mode phase 1)**
1. Press Tab: the camera zooms out smoothly from the rider to a wider view; Tab again returns to the rider at the old
   zoom. The "Command" button does the same; Esc (nothing selected) exits too.
2. In strategy mode, the wheel zooms toward the cursor; on a 512 map zoom all the way out: the whole map fits on
   screen, soldiers become coloured dots, the ground becomes the minimap-style map.
3. WASD / arrows pan, the mouse at a screen edge pans, middle-drag pans; the rider doesn't move. Home recentres on him.
4. Building and demolishing still work while zoomed out: the build panel stays, right-click places the selected
   tool, left-click on bare ground demolishes, clicking a building opens its panel.
5. Unexplored ground is black, explored ground outside your units' sight is dimmed; monsters are hidden outside sight
   (walk a soldier toward one and it appears). Tab back: no fog, as before.
6. Zoomed all the way out on 512, panning / zooming stays smooth (no FPS drop).
7. Click / drag on the minimap: the view jumps there. On a 256/512 map, monsters near that spot (far from the rider)
   show up once your units see them.
8. Banners float over each garrison's soldiers (e.g. "Knights 4" with an HP bar) at any zoom, same size on screen.

## Strategy mode phase 2 — landed 2026-10-28

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 2 (regiments, card bar, control groups) with the user's
2026-10-28 grouping decision.

- **Server regiments** (`server/src/index.ts` "Army regiments", after `handleAssignTaskForce`): derived from state at
  every snapshot, never stored. Each commandable unit is in exactly one: task force N -> "Task Force N" (`tf<N>`); a
  hero -> alone (`h:<id>`, its name); else by settlement (`settlementOf`) and class (`a:<x,y>:<class>`): Knights,
  Infantry (militia + spearmen + pikemen), Archers, Cavalry, Rams, Catapults, Clergy (the Church bishop), named
  with the settlement number ("Knights I", "Infantry II"). Max = alive + queued respawns (task force: the size it was
  assigned at), so a card reads 3/5 after deaths and refills at dawn. Respawned units (new ids) rejoin their
  post's auto regiment. Save / load needs nothing new (task forces and settlements were already saved). Mob
  regiments (`RegimentState`, raids / POI sites) untouched.
- **Merge / split = the existing task forces**: Ctrl+N with a selection makes it task force N, which is now also a
  manual regiment: those units leave their auto regiment and any other task force (task forces no longer overlap).
  Ctrl+N with nothing selected disbands N (its units go back to their auto regiments). No new grouping UI.
- **Protocol (additive, both copies byte-identical)**: `RegimentClass`, `ArmyRegimentSnapshot {id, name, unitIds,
  cls, role?, maxCount, hpFrac, settlement?, taskForce?}`; snapshot `armyRegiments?` sent when membership / names /
  max change and every 10th tick otherwise (the client keeps the last one and reads live HP from the colonists).
- **Client** (`client/src/strategy/cards.ts`, hooks in main.ts, CSS in index.html): strategy-mode card bar along the
  bottom (left edge to the minimap; the command / spell / boss bars step up above it): unit icon, name, alive/max,
  role, stance icon (when uniform), HP bar, control-group badge; role tabs All / Melee / Ranged / Cavalry / Siege /
  Heroes. Click = select the regiment, Shift+click toggles it in / out, double-click centres the camera on it.
  Banners (replacing phase 1's per-post stand-ins) show "name alive/max" + HP bar per regiment, cyan border when
  selected; clicking a banner selects its regiment.
- **Strategy-mode selection**: clicking a unit selects its whole regiment, Alt+click just that unit; box select takes
  whole regiments of anything inside (Alt+box: just the boxed units); Shift adds. Tactical mode is unchanged.
- **Control groups**: Ctrl+1-9 assign (as before), Alt+1-9 recall (as before, any mode), and in strategy mode plain 1-9
  recalls a group; tapping the same digit twice within 350 ms centres on it.
- **Test**: `server/regiment-groups-test.mjs` (own server, port 20623, world 160, new test hook `placeTownCenter`):
  per-class grouping, infantry merge, hero alone, second settlement separate, one regiment per unit, task force
  merge / move between slots / disband, dead rider keeps 0/1. 11/11 pass.
- **Deviations from the plan**: grouping is per settlement + class (user decision), not per garrison post; siege
  engines group per settlement by kind, not one per workshop; merge / split goes through task forces instead of a
  `regimentEdit` message and a Split button; no rename yet; regiments are derived, not an `ArmyRegiment` store with
  stance / orders (Phase 3 adds per-regiment order state keyed by these ids); plain 1-9 recalls only an
  *assigned* group because building stays on in strategy mode (an unassigned digit still picks its build tool);
  no hero spell slots on cards, no "You" rider card, no double-click-a-unit-selects-its-kind; morale not shown
  (user decision: health only until Phase 6).
- **Caveats**: Ctrl+N with nothing selected now disbands N in tactical mode too; a task force that loses every unit
  disappears (its respawns rejoin their auto regiments); browsers may keep Ctrl+1-9 for tab switching (as before).

**Manual browser check (strategy mode phase 2)**
1. Tab into strategy mode: a card bar appears at the bottom with one card per class per Town Center (e.g. "Knights I",
   "Infantry I" holding militia, spearmen and pikemen together, "Archers I") plus one per hero; Tab out hides it.
2. Banners over each regiment read "Knights I 4/5" with an HP bar; with a second Town Center its soldiers get their
   own "... II" cards and banners.
3. Let a soldier die: its card count drops (e.g. 3/4), the card dims at 0, and it refills at dawn.
4. Click a card: the whole regiment is selected (cyan rings, card and banner highlighted); Shift+click another card
   adds it; double-click a card: the camera centres on that regiment.
5. Click one soldier on the map: its whole regiment is selected; Alt+click selects just him; drag a box over part of a
   regiment: the whole regiment is selected (Alt+drag: only the boxed units).
6. Select two regiments, Ctrl+3: one "Task Force 3" card (badge 3) replaces them. Alt+click one unit, Ctrl+4: it
   splits off into "Task Force 4". Press 3: task force 3 is selected; press 3 twice quickly: the camera centres on it.
   Deselect (Esc), Ctrl+3: task force 3 disbands and its units return to their original cards.
7. In strategy mode with no group 1 assigned, 1 still picks the Wood Wall build tool; building, demolishing and
   building panels still work. The command / spell bars sit above the card bar, not under it.

## Strategy mode phase 3 — landed 2026-10-28

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 3 (regiment orders, formations, waypoints).

- **Shared formation code**: `formationRanks`, `placeFastOnWings`, `computeFormationTargets`,
  `computeLineFormationTargets` and their constants moved out of main.ts into `formation.ts`, byte-identical in
  `client/src/` and `server/src/` (`cmp` them, like protocol.ts), plus `planOrderFormation(units, x, y, facing?,
  width?)`. Tactical-mode right-click / right-drag call the same code as before (behaviour unchanged).
- **Server-authoritative orders** (`server/src/index.ts` "Regiment orders", after `armyRegimentsForSnapshot`):
  `regimentOrder {regimentIds?, unitIds?, order, queue?}` makes its units an **order group** (`g<N>`). Phase 2
  regiments are derived per snapshot, so order state lives on the units (a unit is in at most one group), not on
  the `tf<N>` / `h:<id>` / `a:...` ids. The server forms the slots with formation.ts and moves each unit with the
  body of commandMove (`rallyUnit`), squad = group id (so `updateSquadMarch` paces it), with the old 0-0.6 s
  staggered start done server-side. Kinds: move, attackMove (halts on contact in a member's stance alert range,
  closes in keeping its shape, battle discipline fights, resumes 3 s after clear), retreat (to the point or 3
  tiles in front of the nearest Town Center, targets dropped, +10% speed, fights only within 1.2 tiles), hold
  (leash 0.5 tile until the next order), follow (a colonist or `p:<playerId>`; re-forms 2.5 tiles behind it when
  it moves 2 tiles), attack (a commanded attack until the mob is gone). Shift queues up to 8; a queued order on a
  holding / following / idle group starts at once. A per-unit commandMove / commandAttack / commandAttackHearth
  takes the unit out of its group. Validation: known kind, finite in-bounds point, facing normalised, width
  clamped 0-64 tiles, target id checked (no following your own member), commandable units only, 20 orders/s per
  socket, ignored while a load holds the sim. Groups are not saved. Per tick: only the pending staggered starts;
  groups are checked every 5 ticks; formations are solved per order / re-form.
- **Protocol (additive, both copies byte-identical)**: `ArmyOrderKind`, `ArmyOrder {kind, x?, y?, facing? (radians),
  width? (tiles), targetId?}`, `ARMY_ORDER_QUEUE_MAX`, `ArmyOrderGroupSnapshot {id, unitIds, order, queue,
  facing?, width?, engaged?}`, ClientMessage `regimentOrder`, snapshot `orderGroups?` (on change + every 10th tick).
- **Client** (`client/src/strategy/orders.ts` markers, hooks in main.ts, buttons in index.html), strategy mode only:
  right-click = move keeping the group's last facing / width (translated); right-drag = a line, width = drag
  length, facing away from the units or toward an enemy within 12 tiles, Alt while releasing flips it; the ghost
  slots + facing arrow while dragging are the exact server solve. Ctrl+right-click or Shift+F (then right-click /
  drag) = attack-move; right-click an enemy = attack; Shift+G then right-click a friendly unit / the rider =
  follow; Shift+H hold; Shift+R retreat; Shift on any right-click queues a waypoint. Order buttons
  (Atk-move / Hold / Retreat / Follow) on the command bar in strategy mode; Shift+click Hold / Retreat queues.
  Esc disarms a pending Shift+F / Shift+G. Map markers: path line from each group through its current order and
  numbered waypoint pips (colour per kind), a line to a followed / attacked target, a diamond over a holding
  group, slot ghosts of the current + queued orders for selected groups. Cards show the order ("Hold", "Move +2",
  "Engaged").
- **Hotkeys / conflicts**: every plain letter stays a build hotkey (building and demolishing stay on in strategy
  mode), so the order keys are Shift+F / G / H / R, active only in strategy mode with soldiers selected (the build
  tool handler skips them); Shift+1-4 stays the spell bar, Z / X / E stances, Ctrl / Alt+1-9 groups as before.
- **Test**: `server/orders-test.mjs` (own server, port 20633, world 160): line formation exactly the formation.ts
  slots (front 192 px, rear line 80 px behind, units on their slots), 3-waypoint queue in order and formed at the
  last, attack-move halts / fights / resumes, retreat ignores a goblin and rallies by the Town Center, commandMove
  leaves the group, follow re-forms by the rider, junk orders ignored. 14/14 pass.
- **Deviations from the plan**: order state is on units (order groups), not on stored regiments; the group list is
  its own snapshot field (`orderGroups`) instead of fields on `ArmyRegimentSnapshot`; `width` is in tiles (not
  units); order hotkeys are Shift+letter (plan: plain F / H / G / R, which are build hotkeys); no `by` (player name)
  on orders; no re-form after casualties / reinforcements mid-hold (a new order re-forms); attack takes one mob
  (no attack-an-enemy-banner spread: enemy banners come in phase 5); the plan's `formation-test` /
  `regiment-test` / `battle-discipline-test` re-runs were skipped (minimal-testing instruction).
- **Caveats**: queued-waypoint ghosts are approximated client-side (facing the march from the previous waypoint)
  until that order starts; Alt held during a right-drag may focus the browser menu bar in some browsers; a group
  blocked on its path keeps its order until given another.

**Manual browser check (strategy mode phase 3)**
1. Tab into strategy mode, select a regiment card, right-drag a line: ghost slots + a facing arrow follow the
   cursor; release: a path line + pip "1" shows, the units march and stop exactly on the ghost slots (the marker
   goes once they have formed).
   Drag the other way / hold Alt while releasing: they face the other side.
2. Right-click elsewhere: the block moves without reshaping (same width, same facing).
3. Shift+right-click three points: numbered pips 1-2-3 joined by lines; they march them in order and end formed at 3.
4. Shift+F (or the Atk-move button, or Ctrl+right-click) toward a raid / monster: the regiment halts at contact,
   fights (card reads "Engaged"), then carries on to the point 3 s after it is clear.
5. Shift+R: the regiment heads for the Town Center, running past monsters, and forms up in front of it.
6. Shift+H next to monsters: the regiment stays put (card "Hold"), only striking what comes into reach.
7. Shift+G then right-click your rider: green line to the rider; Tab out, ride off, Tab back: the regiment has
   followed and formed up behind you.
8. Right-click a monster: the regiment attacks it (red line to the target).
9. With nothing selected, F / H / G / R still pick their build tools; building and demolishing still work.
   Tactical mode (Tab out): right-click / right-drag formations behave exactly as before.

## Strategy mode phase 4 — landed 2026-10-28

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 4 (stances, fire control, charge, siege).

- **Stances reconciled**: the existing defensive / normal / aggressive stance (Z / X / E, `commandStance`) stays
  the stance; hold fire and skirmish are per-unit toggles on top of it (`regimentSettings` also takes `stance`).
  - **Hold fire**: ranged units / catapults pick no targets of their own (`pickGuardTarget`), don't auto-attack
    hearths, heroes don't auto-cast; an attack / charge / bombard order still fires. Turning it on drops an
    uncommanded target at once.
  - **Skirmish**: ranged units kite from melee within 4 tiles with or without a front rank (`kiteStep`, normally 2
    tiles behind a front rank), also while holding fire; their slot leash is at least 8 tiles (room to kite).
    Melee units ignore it (plan: also fast roles; cavalry is melee here).
  - **Formation shape** (per unit, the group's most common wins, `formation.ts` `groupShape` / `reshapePlan`):
    line (the phase 3 layout, default), block (ceil(sqrt n) columns, ignores a dragged width), wedge (rows 1, 2,
    3 ... from the apex along the facing), loose (line layout x1.6 spacing). `planOrderFormation` applies it, so
    server forming and client ghosts (drag ghost + order ghosts) match. Changing the shape re-forms the group in
    place (its destination while marching, its last formation spot when idle / holding).
- **New order kinds** (`regimentOrder`, server "Regiment orders" block): `charge {targetId}` (knights, cavalry,
  champions run at the mob as a commanded target: no leash, no squad pace, the existing cavalry x2 lands; the
  rest of the group stands; with **cycle charge** on, a rider whose charge landed withdraws 11 tiles (re-aimed
  while the enemy closes), waits out the 8 s charge cooldown and charges again from >= 9 tiles out, or after
  12 s out); `bombard {x, y}` (catapults walk into their 3-11 tile band and shell the point every reload, splash
  as ever, a standing camp hearth under the splash takes x3 building damage; while bombarding they pick no other
  targets; lasts until the next order, like hold); `attackHearth {tileX, tileY}` (the group attacks a camp hearth
  as commandAttackHearth does, but stays an order group; done when it falls).
- **Protocol (additive, both copies byte-identical)**: `ArmyOrderKind` + charge / bombard / attackHearth,
  `ArmyOrder.tileX? / tileY?`, `FormationShape`, `FORMATION_SHAPES`, ColonistSnapshot `holdFire? / skirmish? /
  cycleCharge? / shape?` (sent only when set), ClientMessage `regimentSettings {regimentIds?, unitIds?, stance?,
  holdFire?, skirmish?, cycleCharge?, shape?}` (validated, shares the 20/s order rate limit, ignored during a
  load). `formation.ts` (byte-identical): `FormationUnit.shape?`, `LOOSE_SPACING_MULT`, `groupShape`,
  `planOrderFormation(..., shape = groupShape(units))`.
- **Client** (strategy mode only): command bar adds Charge (Shift+C, then right-click an enemy or near one),
  Bombard (Shift+B, then right-click the ground), Hold fire (Shift+T), Skirmish (Shift+V), Cycle (Alt+C) and Shape
  (Shift+Q cycles Line / Block / Wedge / Loose; the button shows the selection's shape). Toggles light up when
  every selected unit has them. Right-clicking a camp hearth in strategy mode sends `attackHearth` (tactical mode
  still sends commandAttackHearth). Map: charge line + ring on the target, bombard crosshair + splash ring,
  siege square on the hearth; range rings round each selected archer (4), marksman (5), mage (7) and catapult
  (11, plus the 3-tile minimum in orange). Cards: stance icon as before plus flags "HF" / "Sk" / "Cyc" / shape.
- **Test**: `server/stances-test.mjs` (own server, port 20644, world 160): hold-fire archers leave a skeleton
  untouched until an attack order; skirmishers stay >= 2 tiles from a skeleton while shooting it; a cycle-charging
  rider lands x2 twice (second after the cooldown); a catapult walks into range and shells an empty point; a
  finished line re-forms as a wedge (1 / 2 / 3 rows); junk settings ignored. 10/10 pass (6 runs in a row).
- **Deviations from the plan**: plain T / V / Q / C / B are build hotkeys, so the keys are Shift+T / V / Q / C / B
  and Alt+C (cycle charge); withdraw distance 11 tiles, not 6 (with 6 the run was too short to land x2 against an
  advancing enemy); skirmish only for ranged units (not cavalry); rams use the attackHearth order (there are no
  enemy gates / walls to ram); range rings are per unit at its position (not per slot ghost; no tower rings); no
  re-run of the formation / regiment / battle-discipline / orders tests (minimal-testing instruction). The
  re-charging rider's attack cooldown is reset when it turns (the cooldown only runs down while striking).
- **Caveats**: settings live on the units and persist after leaving strategy mode (hold-fire archers stay
  hold-fire in tactical mode, where the toggles are not shown); settings are not saved; a charge ordered on the
  ground with no visible enemy within 3 tiles of the click does nothing; Alt+C may focus the browser menu bar in
  some browsers (use the Cycle button).

**Manual browser check (strategy mode phase 4)**
1. Tab into strategy mode, select an archer regiment: blue range rings show round each archer. Shift+T: the
   Hold fire button lights, the card shows "HF", and the archers stop shooting at a nearby monster; right-click
   the monster: they shoot it. Shift+T again: they fire at will.
2. Shift+V on archers near goblins / skeletons: they back off as melee closes and shoot while backing (card "Sk").
3. Select cavalry, Alt+C (or the Cycle button, card "Cyc"), Shift+C then right-click a monster: the riders charge
   (orange line), hit, ride off, wait, and charge again.
4. Select a catapult, Shift+B then right-click the ground: purple crosshair; the catapult moves into range and
   lobs boulders at that spot every few seconds. Its rings show 3 and 11 tiles.
5. Select a regiment, Shift+Q a few times: the button reads Block / Wedge / Loose / Line, the card shows the shape,
   the regiment re-forms in place, and a right-drag ghost has the new shape (the units stop on it).
6. Right-click a camp hearth with a ram / regiment selected: red square on the hearth, they attack it.
7. Z / X / E stances, Shift+1-4 spells, Shift+F / G / H / R orders still work; plain T / V / Q / C / B behave as
   before (build hotkeys); tactical mode right-click / right-drag unchanged.

## Strategy mode phase 5 — landed 2026-10-28

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 5 (time controls and battlefield intel).

- **Global time controls** (user decision: one player's choice applies to both, no handshake / auto-resume):
  `pause` toggles as before or takes `paused: boolean`; new `setTimeScale {scale}` (0.25 / 0.5 / 1 / 2, anything
  else ignored, both ignored while a load holds the sim). The tick loop adds the scale to an accumulator and runs
  `stepSimulation` once per whole unit: 1/2 and 1/4 step every 2nd / 4th tick and only those ticks broadcast
  (the client interpolates across the gap), 2x steps twice a tick. Everything sim-side (day / night, raids,
  respawn windows, AI, construction, fights) runs inside `stepSimulation`, so it pauses / slows / speeds as one;
  vision, autosave scheduling and the order / setView handlers stay outside, so orders given while paused are
  accepted at once (order groups + ghosts show) and start on resume. Paused ticks still send snapshots.
  Restart / load reset pause and speed. Snapshot: `pausedBy?`, `timeScale`, `timeScaleBy?` (player ids).
- **Client time UI**: top-right ¼ / ½ / 1x / 2x buttons next to Pause; a status line under the buttons
  ("Paused by you · ½ speed (set by Player 2)"), the PAUSED banner names who paused. Keys: **Shift+Space** pause /
  resume, **Shift+[** slower, **Shift+]** faster (plain Space = attack, plain [ ] = build hotkeys, unchanged).
- **Interpolation**: players, colonists and mobs (with their HP bars, labels, wounds, auras) glide from where
  they were drawn to each new snapshot position over the measured snapshot interval (50 ms at 1x, 100 / 200 ms
  in slow motion); jumps over 3 tiles snap. Also smooths normal play; the camera follows the drawn rider.
- **Enemy regiment summaries** (`enemyRegiments`, strategy-view players only, every 10 ticks): one per mob
  regiment (raid group / site, `regimentKey`) or per 16-tile cell for loose mobs, only from members in the
  colony's live vision (players 10 tiles, colonists 6, Abbey clergy excluded; a per-tile stamp grid), anywhere on
  the map, so far fights beyond the 140-tile setView cap on 512 maps still show. Fields: label (fight labels:
  "Bandit raid", "Ruin guardians", "Ogre Warlord"...), centroid, seen count + roles, power (sum hp x sum damage),
  hpFrac, partial (some members unseen), routed, sheltering, massing (a raid held until nightfall), flank (the
  flank group's centroid -> its point behind the line, + target unit). ArmyRegimentSnapshot gets `dmg?`.
- **Strength bands**: enemy power / own power (the selection's, else the whole army's; regiment damage prorated by
  selected members) -> Weak < 0.5, Even < 1.5, Strong < 3, else Deadly; a partly seen regiment shows a range one
  band up ("Even-Strong", count "5+"). Enemy banners (strategy mode): "Massing: Bandit raid · Strong · behind
  walls", border coloured by band (grey when fleeing), HP bar. Right-click an enemy banner = attack the visible
  member nearest its centre. Map band: a red ring per summary (also for mobs culled from the snapshot).
- **Intel overlay** (`client/src/strategy/intel.ts`): orange curved flank arrows; "Flank threatened" over the own
  banner a flank group targets, "Rear threatened" when a visible enemy is within 4 tiles of a member and over a
  tile behind the order group's facing; Map band: crossed-swords clash icons for on-screen fights (size / pulse
  by intensity; click zooms to the Field band there); markers for the Castle Ruin (gold "Objective: Clear the
  Castle Ruin" ring while it is the current goal) and explored camp hearths ("Camp" label in the Map band).
- **Test**: `server/time-intel-test.mjs` (own server, port 20653, world 256, two sockets): pause from A reaches B
  with pausedBy, cycleTick frozen, snapshots flow; an order while paused is grouped and waits, runs after B
  resumes; 1/2 speed = 0.50x ticks and snapshots, 2x = 2.00x; bad scales ignored; a seen 2-goblin regiment is
  summarised with power / roles; an unseen far goblin is not; a non-strategy player gets none; a scout next to
  the far goblin makes it appear while it is culled from `mobs`. 16/16 (4 runs in a row).
- **Deviations from the plan**: no consent vote / 60 s auto-resume (user decision: global); speeds 1/4 / 1/2 / 1x
  / 2x (2x added: "speed-up"); keys Shift+Space / Shift+[ / Shift+] (Space attacks, [ ] build); no enemy morale
  bars or "Outflanked!" (morale is phase 6); fuzziness comes from partial sight, not the "> 15 tiles" rule (live
  vision is at most 10 tiles); bands show on every enemy banner, not just on hover; no "last seen" ghosts; no
  horde "wake the Host" rings (no hordes yet); goals without a place (nights survived) get no marker.
- **Caveats**: projectiles / effects play at real speed in slow motion; summaries refresh at 2 Hz (wall time), so
  a banner lags its regiment by up to 0.5 s; the rider (and everyone's input) also slows / stops with the sim.

**Manual browser check (strategy mode phase 5)**
1. Shift+Space (or Pause): PAUSED banner says "by you", status line "Paused by you"; units / monsters / the
   sundial freeze. Tab in, select a regiment, Shift-queue 3 right-clicks: ghosts + pips appear and nobody moves;
   Shift+Space again: they march through the queue.
2. Click ½ then ¼ (or Shift+[): everything moves slower and smoothly (no stutter / teleporting), the status line
   says "¼ speed (set by you)"; Shift+] back to 1x, then 2x: day passes twice as fast. 1x normal play looks
   smoother than before (no 20 Hz jitter), the camera stays locked on the rider.
3. Second browser tab: pausing / changing speed in one tab shows in the other with "by Player N".
4. In strategy mode near a raid / monsters: an enemy banner "Greenskin raid · Even" (border colour by band);
   select a small regiment vs the whole army and the band changes; a raid gathering by day reads "Massing: ...".
5. A wolf pack / raid flanking your line: orange curved arrow, "Flank threatened" over your banner.
6. Zoom all the way out during a fight: a crossed-swords icon pulses; click it: the camera zooms in there.
   Explored Castle Ruin and camps show markers; with "Clear the Castle Ruin" as the goal it reads "Objective".
7. Right-click an enemy banner with soldiers selected: they attack that regiment. Plain Space still attacks,
   plain [ ] still pick build tools.

## Pop cap rework + wood drain — landed 2026-10-29

- **Barracks housing** (supersedes "soldiers count toward the settlement cap" of 2026-10-28). Soldiers (knight,
  archer, militia / spearman / pikeman, cavalry) no longer use settlement population (`consumesPopulation`
  is civilians + bishops again; heroes 2 and siege engines 2 still count). Every unit building houses its own
  troops (`unitBuildingSlots`): **cap = its tier headcount + 1 per adjacent house** (8 neighbours incl.
  diagonals, any house tier: the existing `adjacentHouseCount` / neighbourhood convention, max 7). Base
  headcounts unchanged: Militia 2 / 6 / 10, Hall of the Sworn 1 / 3 / 5, Archery Range 1 / 3 / 5, Stables
  1 / 2 / 3. `syncGuardBonusAt` fields up to the cap (no settlement check any more); a dead soldier's
  respawn is dropped if its building has no free slot (a neighbour house was demolished).
- **Garrison ceiling** gates new unit buildings and their upgrades instead: the base headcounts of a
  settlement's unit buildings (built + queued, `garrisonGain`) may total at most
  `SETTLEMENT_GARRISON_CAP_BY_TIER` 12 / 24 / 40 (Town Center level) + `KEEP_GARRISON_PER_LEVEL` 5 per Keep
  level. Refusal: "Settlement N garrison full (12/12 soldiers) — upgrade the Town Center or build a Keep".
  House extras ride on top of the ceiling. Old saves: nobody is removed; an over-ceiling settlement just
  can't add unit buildings.
- **Houses costlier**: Cottage 10 wood -> 20 wood + 5 rock; Cottage->Big 20 wood + 10 rock + the old goods
  (1 grain/meat/fruit, 2 clothes); Big->Lv3 30 wood + 15 rock + the old goods (2/2/2, 3 clothes, 2 tools,
  1 luxury). Houses still give civilian housing (+1/+3/+5) and neighbourhood pairs as before.
- **Starting settlement**: `TOWN_CENTER_BASE_POPULATION` 10 -> 12, and its soldiers are off the civilian count.
- **UI**: Colony panel shows "Settlement N troops x/y" under each settlement's population row; unit building
  info panel: "Troops n/cap", base + house breakdown, the settlement's garrison x/y; Town Center info adds a
  troops / garrison line; house info names the unit buildings it feeds; Keep info shows +garrison.
- **Protocol (additive)**: `TownCenterSnapshot` `troops?`, `troopCap?`, `garrisonBase?`, `garrisonCap?`.
- **Wood drain** ("why is my wood slowly depleting"): reproduced headlessly with a temporary wood ledger on
  `spend()` / artisan inputs. A default world with no buildings loses nothing; with one Blacksmith the
  artisan crafted 1 iron + 1 wood -> 1 tool every 4 s by day with **no stock cap**, ~10-11 wood (+ as much
  iron) per game minute, forever, while tools are only spent on a few upgrades. One Lv1 lumberjack brings
  ~24-27 wood per game minute by day, so a Blacksmith (more at Lv2/3 or with industrial synergy) eats half
  of it or more. Fix: `CraftRecipe.stockCap`; the Blacksmith idles at `BLACKSMITH_TOOLS_STOCK_CAP` 30 tools
  (verified: tools stop at 30, wood flat afterwards). Other sinks are player-driven (construction,
  upgrades, repairs after raid damage, forging, market).
- **Tests**: `settlement-pop-test.mjs` extended (base 12; 6 Militia Camps fill a level-1 garrison, the 7th
  is refused; soldiers leave population unchanged; an adjacent house adds a 3rd militiaman); all pass.
  `regiment-groups-test.mjs`, `cavalry-siege-test.mjs` re-run: all pass. Not re-run, expected stale: `economy-goods-test`
  and `upgrades-church-test` assert the old 10-wood house; `camp-hearth-test` asserts knight posts filling
  the settlement.

**Manual browser check (pop cap rework)**
1. New game: Colony panel "Settlement 1 1/12". Build a Militia Camp: a "Settlement 1 troops 2/2" row appears,
   population stays the same.
2. Place a Cottage diagonally next to the camp (20 wood + 5 rock): a 3rd militiaman walks out, troops 3/3;
   the camp's info panel says "Troops 3/3" and "2 at Lv1 + 1 from adjacent house".
3. Keep adding camps / posts: the one that would push the garrison past 12 is refused with the
   "garrison full" toast; its upgrade button shows the same reason.
4. Build a Blacksmith: tools climb to 30 and stop; wood stops dropping. Its info panel says it idles at 30.

## Raid morale retune — landed 2026-10-29

"Enemy night raids flee too easily": a raid regiment (`reg.raid`, no `siteId`) at full morale hit the rout
line in ~7 s once outnumbered, one death cost 8-17 morale in a 6-man group, and a routed raid never rallies
(it leaves by the map edge). Server only; site regiments (camp guardians, hordes, forts) keep the shared
`MORALE_*` numbers unchanged. New `RAID_MORALE_*` constants in the Monster tactics block:

| | shared (sites) | raid |
|---|---|---|
| rout line | `MORALE_ROUT` 25 | `RAID_MORALE_ROUT` 10 |
| casualty (x weight / peak) | 50 | 25 |
| outnumbered drain at ratio 0 (/s) | 20 | 10 |
| front line lost (/s) | 8 | 4 |
| outflanked (/s) | 4 | 2 |
| losses while an anchor lives | x0.5 | x0.25 |
| contact grace | none | `RAID_MORALE_GRACE_TICKS` first 10 s of contact: no morale loss |

- **Crushed**: a raid in contact also routs (whatever its morale) once at most `RAID_CRUSHED_FRACTION` 25%
  of its peak strength is left, or when the boss / Hunger-marked anchor it had is dead. Not under
  `tacticsConfig {freezeMorale}`.
- Unchanged: recovery (+3/s), wall cover (sheltering still blocks rout), flanking, the rout itself
  (leave by the edge, toast, no rally for raids).
- Effect: in an 8 orcs vs 8 knights fight (ratio ~0.3) the old raid broke at morale 0 with 3 still standing
  ~5 s after contact; now it fights until 2 are left. Most raid fights are decided inside the 10 s grace, so
  in practice raids now break on being crushed rather than on morale.
- **Tests**: new `raid-morale-test.mjs` (8 orcs vs 8 knights: 2 killed at contact, no rout while 3+ stand;
  cut to 2 of 8: routs) - passes, and fails its rout-with-3-left check on the old tuning. `tactics-test.mjs`
  R case updated (2 goblins vs 8 knights no longer routs: now 4 goblins, 3 killed at contact -> crushed
  rout, toast, leave, despawn); F / R / W all pass on a fresh server.

**Manual browser check (raid morale)**
1. Play into the first night with a modest garrison (a few knights / militia) and wait for a raid to reach it.
2. Watch the melee: the raiders keep fighting as their first members fall - no "The raiders break and flee!"
   toast after the first one or two deaths.
3. Keep cutting them down: once only a quarter or so are left (or their boss dies) the toast appears and the
   survivors run for the map edge.

## Strategy mode phase 6 — landed 2026-10-29

Plan: `~/docs/colony2d/PLAN-strategy-mode.md` §6 Phase 6 (player morale). Morale for the player's own regiments,
the mob model (`evaluateRegiment`) re-tuned gentler as `PLAYER_MORALE_*` constants; supersedes "health only until
Phase 6" (phase 2 deviations above).

- **Who has morale**: the derived regiments (`tf<N>` / `a:<settlement>:<class>`) with 3+ fighting units (no
  heroes, no rams / catapults: those never rout). A lone rider, workers, heroes and regiments of 1-2 soldiers never
  rout; their morale only recovers and is not shown. State is keyed on the regiment id (a regrouped task force
  starts at 100), evaluated once a second (`updatePlayerMorale`, before `updateOrderGroups`).
- **Drains (in contact, enemies within 8 tiles + spread)**: casualties 35 x role weight / max(3, peak); outnumbered
  (own side = the colony's whole force near it incl. towers and players, vs awake non-routing mobs; Lanchester
  ratio < 0.6) up to 8/s; outflanked (an enemy beyond its far side within 4 tiles of a member, or a flank group
  running at a member) 3/s; front rank lost 4/s. The first 5 s of a new fight drain nothing but casualties.
  Winning (ratio > 1.5) +2/s; out of contact +4/s (x2 within 12 tiles of a Town Center).
- **Anchors / bonuses** (drain multipliers, stacking, floor 0.3): a hero, a player or a knight within 6 tiles (a
  knight regiment always) x0.6; a standing tower within 8 tiles x0.75; a wall / gate within 4 tiles x0.85; a Town
  Center within 12 tiles x0.6.
- **States**: < 40 **Wavering** (amber banner / card outline, "Infantry I is wavering" toast, 20 s cooldown, -15%
  damage); < 15 in contact **Routing**: "Infantry I is routing!" toast + the night sting sound, the units become
  one order group on a phase 3 retreat to the nearest Town Center (fight only when cornered) at x1.25 speed, and
  `regimentOrder` / `commandMove` / `commandAttack` / `commandAttackHearth` ignore them. **Rally**: morale >= 45
  after 4 s out of contact and 6 s fleeing, or at the latest after 25 s; "Infantry I rallies" toast, morale set to
  at least 45. A regiment that had an order group keeps standing at the Town Center; one that had none (tactical
  garrison) walks back to the rally slot it held before the rout.
- **Snapshot (additive)**: `ArmyRegimentSnapshot.morale? / moraleState? ("wavering" | "routing") / outflanked?`
  (sent at once on a state change, else at the 2 Hz refresh); `EnemyRegimentSnapshot.morale? / outflanked?`
  (outflanked = the mob regiment's last 3 s); event category `"morale"`. Test hook `playerMoraleState`
  (optional `setMorale {regimentId: value}`).
- **Client**: banners get a morale bar under the HP bar (blue / amber < 40 / red < 15) and a "· Wavering" /
  "· Routing" / "· Outflanked!" tag (routing banner grey, wavering amber); cards a morale bar, a state label, an
  amber outline when wavering and a pulsing red one when routing, the tooltip explains it. Enemy banners show
  their morale bar and "Outflanked!" while a rear attack drains them. Toast colour for `morale`. No new hotkeys.
- **Test**: `server/player-morale-test.mjs` (own server, port 20651, world 160): a 5-militia regiment shows
  morale 100, two knights show none; forced to 12 next to 6 orcs it routs (state, toast), ignores a move order
  and flees toward the Town Center; the knights never rout; with the field cleared it rallies (toast) and takes
  orders again. 10/10 (4 runs). No other suites re-run (minimal-testing instruction).
- **Deviations from the plan**: rout at 15 (plan: "no rout below 25, Wavering = -20% damage, holds formation"):
  the user asked for routs, so they exist but with a low line, grace, anchors and a hard 25 s cap; wavering is
  -15%. Morale lives on the derived regiment ids (no stored ArmyRegiment). The rear-charge x1.25 bonus stays off.
- **Caveats**: the outnumbered ratio counts every colony unit near the regiment, so a routed neighbour still adds
  strength; moving a routed unit into a task force does not rally it (it stays routed until its old regiment
  rallies or vanishes); a regiment of 3 losing one member mid-rout keeps routing until it rallies.

**Manual browser check (strategy mode phase 6)**
1. Tab into strategy mode: every regiment of 3+ soldiers shows a blue morale bar under its HP bar on the banner
   and the card; heroes, siege engines and 1-2 unit groups show none.
2. Send a small regiment (e.g. 4 militia) far from the Town Center into a much bigger raid: after a few seconds
   the bar drops, turns amber, the banner reads "· Wavering" and a toast says so.
3. Keep it there: it turns grey "· Routing", the card pulses red, a toast + the night sting play, and the units
   run to the Town Center; right-clicks / orders on them do nothing until "... rallies" (at most ~25 s).
4. The same fight next to the Town Center / a tower / with a hero or knights nearby: morale drops much more
   slowly (usually no rout).
5. Tactical mode: a garrison militia camp that routs walks back to its post after rallying; the rider alone, a
   pair of knights and workers never rout.
6. Hit a mob regiment from behind with cavalry: its enemy banner shows a morale bar and "· Outflanked!".

## Forts phase A — landed 2026-10-29

Plan: `~/docs/colony2d/PLAN-forts-diplomacy-moats.md` §1 + §10 "A" (tile owner map). Groundwork for NPC forts: nothing
stamps owned tiles at world-gen yet (that is phase B's stamper); only the test hooks / helper below do.

- **Owner map**: `tileOwner` (sparse tile index -> site number >= 1) + `ownerSiteIds` (site number n = the mobs'
  `siteId` at n - 1). Missing = the colony's / unowned, so old saves load unchanged. `ownerAt`, `siteNumber`,
  `setOwner`, `isHostileOwner` (v1: every site is hostile to the colony). Saved as optional `owners` (flattened
  [index, site]) + `ownerSites`; no SAVE_VERSION bump. Cleared on a new world.
- **Mover side**: `hostileMover` stays; `moverOwner` (site number of the mob moving / pathing, set per mob in the mob
  loop and in `nudgeBody`) sits beside it.
- **Gates**: an NPC gate is passable only for its own site's mobs (they open it within 1.5 tiles), never for other
  mobs / wildlife; closed to players and colonists unless overrun (colony soldiers + players near it beat the site's
  mobs + towers, and no site tower within 8). No gate lock on NPC gates. Snapshot `GATE_FLAG_FOREIGN` (16).
- **Towers**: an NPC tower shoots the nearest player or colonist in range (same stats as a colony tower) instead of
  mobs. Colony tower checks that matter for the colony (gate overrun, mob morale's colony strength, player morale's
  tower anchor) count colony towers only (`livingTowersNear(..., owner)`).
- **Breach / pathing**: mobs only breach colony (owner 0) walls / gates and only target colony buildings; raid rams
  only ram colony gates. `routeToBuilding(..., colony = true)` is the colony's mirror (breaches hostile site walls).
- **Player attack**: the `attackHearth` regiment order and `commandAttackHearth` now take any hostile site tile with
  HP too (`attackObjectiveAt`; `targetHearthId = "tile:<index>"`). A walled-off target (a tower inside the ring) makes
  the unit breach the cheapest site wall / gate on the way first (`structureBreach`). Hits wake the site's
  guardians; rams / catapults get their building multipliers. Aggressive stance auto-picks a site structure within
  `HEARTH_AUTO_TARGET_TILES` after hearths; **attack-move** engages a site structure within the aggressive alert
  range of the group. Camp hearths behave as before.
- **Rubble**: a destroyed NPC wall / gate becomes `TileType.Rubble = 74` (walkable, a breach gap) and loses its owner;
  the player can demolish rubble to Empty. Player walls still fall to Empty as before.
- **Refusals**: no build / upgrade / demolish on an NPC tile ("That belongs to an enemy fort"), no manual repair,
  builders never auto-repair them. Building info shows "Enemy fort: Wall" with no upgrade / repair / lock.
- **Snapshot (additive)**: per player `siteTiles?` (flattened [index, site], full list, sent only when the owner map
  changed since that player's last one). `protocol.ts` copies byte-identical (`cmp`).
- **Client**: NPC tiles tinted salmon (`FOREIGN_TINT`), red on the minimap; right-click a site tile with soldiers
  selected = attack it (tactical: `commandAttackHearth`; strategy: `attackHearth` order). Rubble = the ruin-rubble
  art, smaller and greyed.
- **Test hooks**: `stampTestSite {cx, cy, siteId?, stone?, tower?}` (5x5 owned wood ring, gate west, tower centre),
  `setOwner {tx, ty, siteId|null}`, `ownerState` (owners, sites, recent site-tower shots). Helper
  `server/stamp-test-fort.mjs` (`PORT=<port> node stamp-test-fort.mjs [dx dy]`) stamps one 12 tiles east of the
  Town Center with two bandit clubmen of the site.
- **Tests**: new `server/owner-map-test.mjs` (own server, port 22110, world 80): gate shut for a knight + FOREIGN flag,
  the site's mob walks out through its gate (gate opens), a foreign mob stays walled in, site tower shoots a knight,
  no demolish, siteTiles reach the client, a ram ordered at the tower breaches a wall -> Rubble (owner cleared), walks
  in and destroys the tower, a raid mob still breaches a colony wood ring, save / load keeps owners. 17/17.
  `gates-walls-test.mjs` 16/16 unchanged. No other suites (minimal-testing instruction).
- **Deviations**: sparse Map + site-id list instead of `owner: Uint16Array` / `SiteState` (phase B); no `moverSide`
  type (boolean + `moverOwner`); order names kept (`attackHearth`, no `attackStructure` alias, no protocol change);
  Rubble only for NPC walls (player walls unchanged) and no "Rebuild wall" / builder clear job; NPC towers always
  fire (no dormancy yet) and hit civilians too; `siteTiles` not fog-filtered; no reserved-footprint build refusal
  (needs sites); catapult bombard splash does not damage site structures.
- **Caveats**: attack-move keeps engaging site structures in range one after another (it razes the fort before
  marching on); aggressive soldiers posted near a fort will start hitting its walls.

**Manual browser check (forts phase A)** — run the server with `COLONY_TEST_HOOKS=1`, then
`cd server && PORT=<port> node stamp-test-fort.mjs` (a test fort 12 tiles east of the Town Center).
1. The fort's walls / gate / tower are tinted salmon, and red on the minimap; clicking a wall shows "Enemy fort: Wall"
   with no upgrade / repair / lock buttons. Demolish on it is refused with a toast.
2. The two bandits walk out through the fort's gate (it opens for them) and come for your town.
3. Walk your player up to the gate: it stays shut and you can't pass. Stand within ~7 tiles of the tower: it shoots
   you (and any soldier near it).
4. Select a battering ram (or knights), right-click the tower: they break through a wall first, the wall becomes
   grey rubble, they walk through the gap and destroy the tower. A catapult shells the tower over the wall from range.
5. Walk your player through the rubble gap; demolish the rubble (it clears to grass).
6. Strategy mode: give a regiment an attack-move order past the fort: it stops and attacks the fort's structures.
7. Save, load: the fort is still tinted and its gate still shut to you.

## Shared package — landed 2026-10-29
- `protocol.ts` and `formation.ts` now live once, in the `shared/` npm workspace (`@colony/shared`,
  `shared/src/{protocol,formation,index}.ts`). Server and client import `@colony/shared/protocol` /
  `@colony/shared/formation` (or everything from `@colony/shared`). The old byte-identical copies in
  `server/src/` and `client/src/` are gone, and so is the "keep them byte-identical, `cmp` them" rule: older
  entries above that mention both copies / `cmp` are history. Edit `shared/src/` once.
- No build step: the package `exports` point at the `.ts` sources. tsx (server), Vite (client) and
  `tsc --noEmit` (moduleResolution Bundler) all follow `node_modules/@colony/shared` (a workspace symlink to
  `shared/`) and compile/type-check the sources directly. `cd shared && npx tsc --noEmit` checks it alone.
- `scripts/live.sh` snapshots `shared/` too; the live dir's `node_modules` is now a dir of symlinks into the
  repo's, with `@colony/shared` pointing at the snapshot's own `shared/`, so repo edits never reach the live copy.
- No behaviour change.
