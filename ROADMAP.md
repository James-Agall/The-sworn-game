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

- **Role table** lives in `protocol.ts` (shared, byte-identical): `CombatRole`, `MOB_ROLE`, `COLONIST_ROLE`,
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
