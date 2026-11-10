# colony2d / "The Sworn Game" — handover for Codex (2026-11-10)

Owner: James. Repo: `/home/james/projects/colony2d`, remote `git@github.com:James-Agall/The-sworn-game.git`, branch `main`.
Up to now the work was done by Claude Code agents, one feature per agent. This document is everything a new agent needs to
(1) finish the remaining work and testing, and (2) recreate ALL sprites in one consistent style.

Read this file, then `README.md`, `ROADMAP.md` (history + design notes per feature), `MANUAL-TESTS.md` (browser checklists),
`SPRITES.md` (art requests, status, pipeline notes), and the plans in `/home/james/docs/colony2d/` (outside the repo):
`QUEUE.md` (live queue), `PLAN-*.md` (rimworld-stardew, village-life, progression-tree, solo-hero, family-and-succession,
large-battles, world-streaming, formation-march).

## 1. What the game is
A real-time colony/strategy game for 1-2 players: PixiJS client (flat top-down / 3/4 view, 32 px tiles), authoritative
Node + `ws` server at 20 TPS, shared TypeScript package. Features: colony building, villagers as persistent people (births,
immigrants, prisoners), progression tree (stone age -> metal -> food chains), battles with regiments/formations (1000v1000
tested), bandit camps/forts/clans/quests/diplomacy, a playable hero (solo start, skills, family/marriage/succession,
resurrection), world streaming up to 1024 tiles, and the RimWorld/Stardew layer (modular building, rooms, zones, work
priorities, hero tools, seasons/weather, interiors, animals in buildings, blueprint + settlement + camp templates).

## 2. Layout and commands
- `shared/src/` (`@colony/shared`): `protocol.ts` (snapshot/messages/tile enums), `buildings.ts`, `progression.ts`,
  `structures.ts`, `rooms.ts`, `zones.ts`, `work.ts`, `calendar.ts`, `animals.ts`, `interiors.ts`, `camps.ts`,
  `buildingTemplates.ts`, `settlementTemplates.ts`, `snapshotDelta.ts`, `herolife.ts`, ...
- `server/src/`: one module per domain, `index.ts` boots + routes messages, `sim.ts` is one tick, `testhooks.ts` exposes
  test-only hooks (needs `COLONY_TEST_HOOKS=1`). Data: `server/data/camps/`, `server/data/buildings/`,
  `server/data/settlements/` (JSON templates, `user/` subfolders for editor saves).
- `client/src/main.ts` (large; splitting it is an open cleanup), plus `adventure.ts`, `interior.ts`, `herotools.ts`,
  `zones.ts`, `work.ts`, `weather.ts`, `blueprints.ts`, `campEditor.ts`, `templateEditor.ts`, `structureArt.ts`,
  `spriteRegistry.ts`, `unitVisuals.ts`, `worldVisuals.ts`, `tools.ts`, ...
- `scripts/run-tests.mjs` (test runner, sets per-test env), `scripts/live.sh` (the user's always-on frozen copy: DO NOT RUN).
- Install/run: `npm install`, `npm run dev` (server :8080 + client :5173; do not use these ports for tests, see rules).
- Type check: `npx tsc --noEmit -p server`, `-p client`, `-p shared` (check each package's tsconfig). Build client:
  `npx vite build` inside `client` with an out-dir in a scratch folder (never overwrite `client/dist` used by live).

## 3. Hard rules (from the user; keep them)
1. NEVER touch port :8080, the user's live game, `~/colony2d-live`, or `server/saves/`. Every server you boot for tests must set
   `COLONY_SAVE_DIR` to a scratch dir and `COLONY_TEST_HOOKS=1`, and use a private port. Never run `scripts/live.sh`.
2. Never `pkill -f` anything; kill by PID. A node process on :32400 (scratch `/tmp/colony-stream-*`) belongs to someone else.
3. Never push unless the user says "push". Commit with explicit `git add <paths>` (never `git add -A` / `commit -a`):
   the working tree always has 6 intentionally uncommitted old test files that must stay untouched and unstaged:
   `server/cavalry-siege-test.mjs`, `halflatch-ward-lapse-test.mjs`, `happiness-militia-tavern-test.mjs`,
   `hunger-roads-test.mjs`, `shelter-overflow-test.mjs`, `warbands-test.mjs` (the user has not decided commit vs drop).
4. Old-save compatibility/migration: NOT needed (the user starts new games). Keep save/load of CURRENT-format state working.
5. Token/time economy: targeted tests only. Never run the full `npm test` in one go; use `npm run smoke` + specific suites
   (`npm test -- <name> <name>`). One agent at a time on the repo (parallel agents interleaved commits and hit rate limits).
6. The user tests visually/interactively in the browser themselves: write short concrete checklists in `MANUAL-TESTS.md`
   rather than building browser-automation suites. Headless Playwright screenshots are fine for your own sprite checks
   (chromium `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`; playwright module at
   `/home/james/projects/auto-loan-ff-release/node_modules/playwright`).
7. Commit messages: use your own attribution trailer. Earlier agents used
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and a `Claude-Session:` line; those are Claude-specific,
   do not copy them for Codex work.
8. A REQUIRED sprite file that is missing aborts the whole `Assets.load` in `client/src/main.ts` (this broke map loading
   once: missing `townPriest.png`). New art must be optional with a procedural/stand-in fallback.

## 4. Tests
- `npm run smoke` (`server/smoke-test.mjs`, ~35 checks, ~30 s). Fixed map via `COLONY_WORLD_SEED` (`SMOKE_SEED=n` to vary),
  `SMOKE_ONLY="substr"` to run a subset, `SMOKE_LOG`. Random private port 33000-37000.
- `npm test -- name1 name2` runs `server/<name>-test.mjs` via `scripts/run-tests.mjs`, which sets env per test:
  `COLONY_LEGACY_STAFF`, `COLONY_LEGACY_BUILD`, `COLONY_UNLOCK_ALL`, `COLONY_NO_SEASONS`, `COLONY_HERO_RESPAWN`,
  `COLONY_STREAMING`, `COLONY_TEST_MAX_WORLD_SIZE`, `COLONY_PATH_CACHE_VERIFY`. Logs in `/tmp/colony-test-logs`.
- Recently added suites (all passing when last run): `structures`, `rooms`, `zones`, `work-priorities`, `hero-tools`,
  `calendar`, `interiors`, `animals`, `camp-templates`, `building-templates`, `settlement-templates`, `snapshot-delta`.
- Known failing / flaky (not regressions): `abbey-ward` (written pre-village-life; part B flaky, part C stale),
  `streaming-abstract` ("save -> load keeps the abstract records" parked-mob drift 5 vs tolerance 2, 1 of 2 runs),
  `sites` and `streaming-world` (random-map flakes; fixed seeds 5 and 13 fix them), `upgrades-church` archer-hp check,
  `zones` once-off "animal area 9 tiles". Smoke is currently 35/35 on its fixed map.
- World generation is versioned: `WORLDGEN_VERSION` in `server/src/worldbase.ts` (now 8; bump when stamping/layout changes;
  base cache files are named per version).

## 5. State of the work (everything below is built; see ROADMAP.md for details)
All pushed up to `5ee4a97`; ~15 local commits after that are UNPUSHED (test-health fixes, G1-G8 gap closure, delta
snapshots, loading screen when it lands). Check `git log origin/main..HEAD`.
- Village life, progression tree, solo hero, family/succession, battle engine (delta snapshots: mid-battle 285 KB -> ~30 KB,
  opt-in per connection via `?delta=1`, browser client opts in; `?delta=0` disables), world streaming up to 1024.
- RimWorld/Stardew: phase 1 modular building, 2 rooms and quality, 3 zones, 4 work priorities, 5a hero tools/energy,
  5b seasons/calendar/weather, 5c interiors (3 layouts per type, living NPCs, taverns, stairs), 5d animals in buildings,
  6 balance. Gap closure G1-G8: hall/storeroom/chapel/infirmary rooms and 2-tile furniture, stockpile capacity, hand-assigned
  workers, seasonal day length + snow, horses/predators/selling/shears/pail/manure, quest giver NPC, rotating/mirroring
  settlements, modular keeps, animal yards, gate passages.
- Templates: 28 bandit camps (3 tiers), 55 building blueprints, 15 settlement templates (hamlet/village/town), editors in
  Creative mode (camp, building, settlement).
- An agent may be mid-task on the Vast-map loading screen (+ 2048 map profiling). Check `git status`/`git log`.

## 6. Open work for Codex (priority order)
A. Browser verification of everything unseen. Nothing from phases 1-6, G1-G8, delta snapshots, templates or editors has been
   looked at by a human or in a browser. Work through `MANUAL-TESTS.md` (it ends with a 15-step new-game checklist) using
   headless screenshots where practical and fix what is broken. Likely trouble spots: roof alpha/banding, hotbar placement
   (bottom ~162 px above the spell bar), Blueprints ghost and R/M keys, Work table, interiors (enter via the tile below the
   door), calendar/weather overlay, delta snapshot resync, keep/fence/gate-passage templates.
B. Remaining queue (see `/home/james/docs/colony2d/QUEUE.md`):
   - G9: retire old prefabs (old pastures/Farm Plots/Hemp Fields, prefab houses) ONLY after the user has played and says so.
   - G10: wire regenerated art (this document, section 7).
   - Mining: hazards (cave-in, bad air, flooding), Mine Foreman, crusher/stamp, coal, bronze, steel/flux (PLAN-progression-tree.md
     "Expansion: mining and ore types"); dairy/smokehouse chain; further food variety.
   - Cleanup: split the rest of `client/src/main.ts`, a headless World object so tests do not need a server.
   - Family extras: named heroes/clan leaders as spouses, NPC marriages and scandals, inheriting a settlement.
   - Early-game and raid tuning (undefended Town Center can fall to 3-4 raiders; soldiers need the Blacksmith chain).
   - Fix the remaining flaky/failing suites listed in section 4 (do not touch the 6 protected test files).
C. Known gaps (smaller): animals do not use yard fences; day length changes in one step per season; creative settlement
   "Stamp here" has no turn picker; NPCs in interiors walk through each other; the Keep/SiteKeep tiles now count as valid in rooms;
   `FurniturePart*` tiles back-point to a furniture anchor.

## 7. SPRITES: recreate everything in one consistent style
Problem: the 1000+ files in `client/public/sprites/` came from many different generations (several ChatGPT atlases over weeks,
some procedural stand-ins), so characters, proportions, outline weight, palette and camera angle differ. The newest
RimWorld/Stardew atlases (`art-sources/rimworld-stardew/`) are AI-painted ~60-110 px art, NOT on a pixel grid, with two
different villager characters. The user wants ALL sprites regenerated to a single style.

Suggested approach:
1. Write a one-page STYLE BIBLE first and get the user's OK before generating in bulk: pixel grid (32x32 tiles, 1 px
   outline in a darker shade of the sprite colour, no anti-aliasing, limited palette ~48 colours shared by all assets, fixed
   light direction top-left, 3/4 top-down camera with ~8 px visible front face on walls/buildings), proportions
   (colonist ~16x24 px, knight ~20x28 px, etc.: measure the current `knight`, `militia`, `farmer` sprites as anchors),
   transparent backgrounds, one asset class per sheet, aligned grids, no text.
2. Choose the canonical anchors from existing art (the existing knight/archer/colonist sheets and the 3/4 walls are what the
   user already likes: see `SPRITES.md` "Already sourced") and match everything else to them.
3. Generate sheet by sheet by category, slice and normalise with scripts (reuse `art-sources/rimworld-stardew/wire_sprites.py`
   which slices, downscales with nearest/box, pads, and removes backgrounds; PIL/numpy needed), keep the originals in
   `art-sources/`.
4. Verify with contact sheets and in-game screenshots (a creative-mode scene with a small house, zones, animals, a battle).
5. Wire in, keeping fallbacks.

Where sprites are wired:
- `client/public/sprites/` (files), `client/src/spriteRegistry.ts` (lazy registry of staged RimWorld/Stardew art),
  `client/src/structureArt.ts` (procedural stand-ins for modular pieces: doors, windows, floors, roofs, furniture),
  `client/src/worldVisuals.ts` (`TILE_OPTIONAL_ART`, `TILE_STANDIN_TINT`, autotile maps for roads/walls/moats),
  `client/src/unitVisuals.ts` (`MOB_SPRITE_URL_OVERRIDES`, `MOB_TINT`, unit sheets/animation rows), `client/src/main.ts`
  (initial `Assets.load` list: required vs optional art), `client/src/tools.ts` (toolbar icons).
- `SPRITES.md` is the authoritative request list: numbered entries #14-#105 with ready-to-use prompts, "Placeholders in use",
  "#90-#97 delivery status" (what the sliced atlases did/did not provide) and a "Regenerate" list. Replace stand-ins entry by entry
  and update the status there.

Asset categories to produce (see SPRITES.md for exact specs per number):
- Units: villagers/colonists (4 dirs x walk/idle + task animations: sow, water, harvest, haul, hammer, chop, mine, cook, sleep,
  eat, sit), hero + equipment overlays, soldiers (militia, archer, knight, cavalry, siege), bandits (3 tiers), goblins, monsters,
  bosses (Ogre Warlord), animals (chicken, rooster, chick, cow, calf, pig, piglet, sheep, lamb, horse, foal, dog, cat; walk/idle/eat/sleep),
  mounted hero, prisoner/captive, quest giver (`townHerald`), town NPCs (guard, archer, knight, farmer, miner, priest, elder, trader).
- Tiles/buildings: 16-piece connected wall sets (wood, palisade, stone, reinforced) + damaged/breach states, doors/windows (face-on
  and edge-on, open/closed/broken), gates + drawbridges, moats, roads/cobble, floors (dirt, wood, flagstone, cobble, rugs; 4 variants),
  roofs (thatch, shingle, clay tile, slate; ridge/eave/corner; faded cutaway), blueprint/scaffold overlays, furniture
  (bed 1x2, double bed, tables incl. long table, chairs, chests, shelves, wardrobe, hearth lit/unlit, lamps, rugs, statue, workbench,
  weapon rack, altar, medicine chest, well, banners, barrels, sacks, market stalls), stations (forge/anvil, oven, mill, loom, brew vat),
  production/military/religious buildings, modular keep pieces, yard fences, gate passage floor, camp sets (tents, palisades, carts,
  watch posts), settlement buildings.
- Farming/world: soil states, 5 growth stages per crop (wheat, hemp/flax, vegetables, berries, root) with seasonal variants and
  withered stage, trees/ground per season, frozen water, weather overlays (rain, snow, fog, storm; real transparency), puddle/snow
  overlays, zone overlays (6 colours, truly transparent), calendar/season/weather icons.
- UI/icons: item and resource icons (all progression items), tool icons (hoe, watering can, seed bags, scythe, axe, pick, shears,
  milk pail, manure), hotbar and stamina bar frames, room-role and room-stat icons, work-type and priority icons (11 types incl. animals),
  stockpile filter icons, need icons (hunger, thirst, happy, sick), hauler load icons, spell icons, minimap/HUD glyphs.
- VFX: swings, slashes, dust, sparkles, spell effects, flames (note: damaged hearth fire is intentionally NOT drawn).
- Interiors: floor/wall/exit-mat/stairs tiles per building type, cutaway walls, NPC poses (idle, walk, seated, sleeping), patrons.

## 8. How the user works (so you fit in)
- Short messages, delegates big features, tests manually in the browser, wants minimal token use, says "push" only when ready.
- They have asked for answers to be concise and honest: say what was NOT verified (e.g. "not checked in a browser").
- Use they/them if you ever refer to the user's or others' pronouns unknowingly.
- Plans/queue live outside the repo in `/home/james/docs/colony2d/`; update `QUEUE.md` there when you finish or start something.
