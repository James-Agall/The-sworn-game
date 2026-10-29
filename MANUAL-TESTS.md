# Things to try yourself

Start the game with `scripts/live.sh` (frozen copy that keeps running while code changes; `live.sh update` picks up new
code) or `npm run dev`. Open http://localhost:5173. Detailed step-by-step checklists live at the end of each
"landed" section in `ROADMAP.md`; this is the short version, in the order I would try them.

## 1. Quick sanity (5 minutes)
1. Game loads, no red errors in the browser console (F12). If something is broken, send me the console text.
2. Walk with WASD, swing with Space, place a house and a lumberjack. Houses should look ~30% bigger than before.
3. Pick a building tool while units are selected: the units should deselect (right-click then places, not orders).
4. Wait for night: raid arrives after nightfall, fights on instead of fleeing after the first losses.

## 2. Look and feel (new art and scale)
- Knights, spearmen, pikemen, cavalry change look with armour tier (forge gear at the Blacksmith, then spawn the unit).
- Blacksmith: animates while forging (level 1), Lv2 Smithy / Lv3 Armoury look different.
- Trolls and ogres noticeably bigger; orcs, goblins, wolves vary in size within a pack; goblin wolf riders show as a
  tinted wolf (placeholder) and charge then back off.
- Walls connect into corners / T / cross; known gaps at corners and front-on vertical gates (art to be redrawn).
- Character sheet (backquote key): new parchment frame, slots, spell icons in the spell bar.

## 3. Strategy mode (Tab, or the Command button)
1. Tab: camera lifts to a wide view; wheel zooms out to the whole map; WASD/edge/middle-drag pans; Esc or Tab returns.
2. Building and demolishing still work while zoomed out.
3. Cards bar at the bottom: one card per regiment (by town and unit type); click selects, Shift adds, double-click
   centres. Ctrl+1-9 assigns a control group, Alt+1-9 (or plain 1-9 if assigned) recalls.
4. Orders (soldiers selected): right-click = move; right-drag = line formation with a ghost preview; Ctrl+right-click
   or Shift+F = attack-move; Shift+H hold; Shift+R retreat; Shift+G follow; Shift+right-click queues waypoints.
5. Stances: Shift+C charge, Shift+B bombard, Shift+T hold fire, Shift+V skirmish, Alt+C cycle charge, Shift+Q shape.
6. Time: Shift+Space pause; Shift+[ and Shift+] slow / speed up (both players share it); orders work while paused.
7. Intel: enemy banners show Weak / Even / Strong / Deadly, "Massing", "Outflanked!"; fight icons at max zoom-out.
8. Morale: banners and cards show a morale bar; a regiment losing a fight goes Wavering then Routing and runs to the
   Town Center, then rallies after a quiet spell.

## 4. Economy and population
- House costs 20 wood + 5 rock; a settlement shows civilians N/cap and troops N/cap.
- Soldiers no longer use the civilian cap; a unit building holds its own troops, +1 slot per adjacent house.
- Wood should stay flat unless you build or craft (Blacksmith pauses at 30 tools).

## 5. Forts (phase A only: no forts exist in the world yet)
- With the game running: `node server/stamp-test-fort.mjs` drops a small test fort 12 tiles east of your Town Center
  (needs the test-hook server). Soldiers attack its gate, tower, walls; destroyed walls become rubble; the fort's
  tower shoots you; its own gate opens only for its bandits.

## Automated tests you can run
- `npm test` runs everything (about 80 minutes). `npm test -- <word> <word>` runs only test files whose name
  contains the word; `npm test -- --list` shows what a filter selects.
- Fast and reliable (under 1 minute each, expected to pass): `formation-test` (flaky until the formation bug is fixed),
  `gates-walls`, `goals-castle`, `battle-discipline`, `builders-farmers`, `day-respawn`, `fight-notifier`,
  `orders-test`, `regiment-groups`, `player-morale`, `scale-rider`, `time-intel`, `settlement-pop`, `raid-morale`,
  `tactics-test`, `strategy-view`.
- Known failing or flaky (do not worry): see `ROADMAP.md`, "Known failing tests" and "Full-suite run after the server
  split".
