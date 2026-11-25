# Adventure systems — 25 November 2026

Approved scope: exploration loot, distinctive named enemies, connected stories, and journal/interaction polish (items 1–3 and 5). The first-hour balance pass and world expansion were outside this update.

## Implemented

- Camps, caves, ruins and working mines contain individually interactive crates, barrels, jars, treasure, concealed caches, notes, key rings and locked storerooms. Keys, notes, damage, opened doors and remaining loot persist. Working-mine storage chests remain storage.
- Gold and manufactured items use existing clan stores. Raw resources stay carried, as requested. Equipment uses the native inventory. Full bags preserve the remainder; reopening cannot repeat previously claimed rewards.
- Prisoner cages require the key and a safe immediate area. Existing rescue logic handles shelter or waiting prisoners without paying twice on a camp clear.
- Twenty named opponents use timed warning/impact/recovery attacks. Existing character animations provide anticipation, impact and recovery poses. Mechanics include frontal guards, interruptible attacks, committed charges, aimed arrows, poison, slowing webs and limited reinforcements. Rushes and damage respect walls. No sprite tinting was added.
- Ten authored questlines connect all 100 special characters. They include individual witness replies, supplies, clues, rescues, hunts, workstation commissions, two choices per story, reputation, skill experience, recipes, changed conversations and persistent room improvements.
- Earned daily services: sanctuary treatment, meals/rest, and adult master lessons. The server checks role, completed story, gold and daily limit. Missing contacts can be reported to surviving participants.
- Ten recipe rewards use real workstation jobs. The two shields are real equippable off-hand items; other recipes produce native food, lamps, supports and linen/clothes. Friendly-town workshop interiors are usable with the player's own supplies. Tailors use the existing shop interior.
- Journal (J): stories, original settlement quests, known people search, notes/keys, tracking, map focus, destination markers and distance/bearing. Clear interior notices and per-object prompts. E uses the highlighted exploration object. Compact journal scrolls within the viewport.
- Empty interiors keep their AI dormant. Re-entry cancels stale attacks; reinforcement use/count and deaths survive save/load. World construction remains grid-based and deterministic.

## Important integration details

- `shared/src/adventure.ts` defines deterministic object placement, a genuine locked annex, boss profiles and journal data. Original exits, enemy lairs and work slots remain reachable while the annex is locked.
- `server/src/adventureLoot.ts` stores per-room/per-layer state inside the existing mine save. Native mine upgrades refresh shaft props without moving saved containers or annexes.
- All hostile interior rendering and movement now use `mineInteriorMap`. Previously camps and ruins bypassed that wrapper and drew the base layout; the gameplay test now checks view/map equality.
- `server/src/bossCombat.ts` handles named enemies only. Native common monsters and encounter rewards remain in `mines.ts`. Reinforcements are once per summoning boss, at most two per rally and four per encounter.
- `server/src/story.ts` uses saved hero-life flags and the existing dialogue/crafting/reputation pipelines. Story room improvements defer while an occupant stands where a new prop would appear.
- `shared/src/stories.ts` contains the editable authored content and recipes. `client/src/adventureJournal.ts` owns the journal and tracker.
- Client defaults to ws://localhost:8080. `VITE_SERVER_URL` can point isolated UI tests elsewhere. `COLONY_HOST` defaults to the existing 0.0.0.0 server binding; private preview used 127.0.0.1.
- `server/src/adventurePreview.ts` is behind the existing `COLONY_TEST_HOOKS=1` gate. Never enable this on a public game. Its long guardian wind-up and extra health are visual-test fixtures, not normal gameplay settings.

## Verification

Passed:

- `npm test -- adventure`: 40 layout cases; all 20 named attack profiles; every cast member has a story role; full native story, loot, key/lock, save, re-entry and crafting flows on a 512×512 world.
- The gameplay suite completed 120 actual stages across all ten stories in its 512×512 fixture, with previously found clues/kills satisfying some later stages automatically. It crafted all ten recipes, equipped both shields, checked interrupted/capacity-safe jobs, both outcome branches, role/cost/day-limited services, death restrictions, no duplicate rewards, saved reinforcements and 1,200 dormant update ticks.
- Existing suites: character-sheet, interior-refresh, interiors, mines, player-workstations, save-load, spells. One shutdown-autosave timing check failed during the combined run; the whole save-load suite passed when rerun alone. No test assertion was weakened.
- Existing regions21, underground, cave-detail, ruin-rooms and hostile-scatter checks, using their expected 512×512 region world.
- Basic smoke suite: all 35 checks.
- Server and client TypeScript checks and production client build.
- Browser: journal J/Escape, filters/search, notes/keys, map focus, key collection, treasure claim/open-door artwork, clear named-enemy warning, compact journal bounds, no console errors. Screenshots are from an isolated test world; the guardian warning was deliberately held longer to capture it.

## Artwork

Four transparent 96×96 pixel-art props (key ring, note, clay jar, loot pouch) are in `client/public/sprites/adventure`. The built-in image generator produced the source sheet; prompt/settings and extraction manifest are archived in `art-sources/adventure`. All other artwork is reused from the current game.

## Manual checks for the next play session

1. Speak to Hesta or any other named resident; choose their Story option. Follow the journal's objective and use Show on map.
2. Enter a camp, cave or ruin. Read its note, collect its keys, unlock its side room and loot containers. Fill the bag, return and verify the remainder is still there.
3. Fight a named opponent: leave the warning area, attack during recovery, and test a shield from front/rear. Leave during a wind-up and re-enter.
4. Complete a story, use the unlocked recipe at its proper station, then equip a crafted shield. Confirm changes after saving/loading.

Deployment uses the existing frozen live copy at http://localhost:5173. A release backup and exact revision are recorded in the deployment receipt. No remote push is part of this update.
