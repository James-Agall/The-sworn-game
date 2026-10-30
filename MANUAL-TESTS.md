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
- Hemp fields / 2x2 pastures / gear pickup / forge autocraft (2026-10-30): walk over a Hemp Field; a new Pasture or
  Sheep Pasture shows a 2x2 ghost (red when blocked) and fills 2x2 tiles; idle soldiers re-arm when the stock gets
  gear ("N soldiers equipped" toast); Blacksmith panel has Autocraft On/Off and a target -/+. Full list: ROADMAP.md
  "Hemp, pastures, gear pickup, forge autocraft — landed".

## 5. Forts phase B (sleeping forts, leash, loot, capture)
The client always connects to :8080, so close your normal game first, then start the dev copy with test hooks and a
scratch save dir (never your real saves) from the repo root:
`COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=/tmp/colony-forts COLONY_WORLD_SIZE=256 npm run dev`, open http://localhost:5173.
World-gen already places forts on maps of 160+ (256: about 4 orc stockades + 5 bandit palisades, at least 50 tiles from
your start).
1. **Find one.** `cd server && node stamp-site.mjs list` prints every fort, its keep tile and distance from your Town
   Center. To get one close by: `node stamp-site.mjs thornwick 30 0` (or `grakkar`; dx dy = tiles from the Town
   Center). Walk towards it.
2. **Sighted.** When the keep comes into view: toast "<name> sighted (bandit palisade)" and a small flag on the
   minimap at the keep (orange = bandit, olive = orc). The flag stays after you leave.
3. **Asleep vs awake.** From far away nothing at the fort moves or shoots. Walk up: within 12 tiles of the keep (or 3 of
   the walls) the whole garrison wakes at once and comes at you through the gate; the tower shoots.
4. **Leash.** Back off slowly. The defenders chase you only to about 16 tiles from the keep, then turn round and walk
   home (a bit faster than normal). Wait out of sight about 5 s: the hurt ones heal at home; after 20 s calm they stand
   still again (asleep). Raid waves at night are NOT leashed (they still come all the way).
5. **Anti-kite.** Shoot defenders from beyond the leash ring with archers 3 times: toast "<name> sallies out against
   the skirmishers!" and for 8 s the melee defenders keep chasing past the leash, the tower reaches 2 tiles further.
6. **Fort info.** Left-click any fort tile (wall, gate, tower, tent, keep): the panel says "<fort>: Wall" (or Keep with
   its HP), the faction / tier and "Garrison n/8" ("(asleep)" while nobody is near).
7. **Clear + loot.** Break in (ram or knights through a wall) and destroy the keep: toast "<fort> falls! Plundered ...
   " with more than a camp gives (it includes half the fort's stockpile, e.g. grain); the keep becomes a ruined keep,
   the garrison routs; the minimap flag turns grey. The fort's gates now let your units through.
8. **Capture.** Left-click the ruined keep: "Rebuild keep: 40 wood + 20 rock". It is disabled with "Defenders still hold
   the fort" while any of its mobs is inside the walls, "Walk up to the keep" when you are far. Click Rebuild: builders
   walk over and build a Town Center there (toast "<fort> Outpost stands: the fort is yours"). Then: the Town Center
   panel is named "<fort> Outpost" with its own population cap; the walls / gates / tower are yours (no salmon tint;
   your towers shoot monsters; the gate opens for your units, lock buttons work); you can build inside the old fort;
   the minimap flag takes your colour.
9. **Save / load** at any point (asleep, cleared, captured): everything comes back as it was.
With 2+ clans: a second player's clan can capture a fort too; it becomes that clan's outpost (their colour).

## 6. Human settlements (phase C: neutral villages, attack -> hostile, relation hook)
Start a server with `COLONY_TEST_HOOKS=1` and a scratch `COLONY_SAVE_DIR` (`COLONY_WORLD_SIZE=256` or `512` gives
world-gen settlements: 256 has 2-4, 512 about 10).
1. **Find one**: `cd server && PORT=<port> node stamp-site.mjs list` prints every site; human ones say
   `(human, tier 1, hearthmoor|ironhold|riverwatch, neutral, relation 0)` with dx / dy from your Town Center. Or stamp one
   near you: `node stamp-site.mjs hearthmoor 0 60` (also `ironhold`, `riverwatch`; a 160 map is often too crowded for
   Riverwatch, use 256).
2. **Look**: walk over. Grey stone walls (pale blue-white tint, not the salmon of enemy forts), corner towers, a dark keep
   in the middle, houses, a market, church, inn, mill, a one-tile well; Hearthmoor has farm plots in a ring OUTSIDE the
   wall with barns, Ironhold an ore / rock field outside its east gate, Riverwatch two water strips (moat stand-in) N and
   S. Toast "You sight the village of <name>" (mining outpost / town for the others). Minimap: a WHITE flag with a green
   edge on its keep.
3. **Neutral**: walk (with soldiers on aggressive stance) up to and through the gate by DAY: the gate opens for you, the
   blue-tinted guards stand still, the towers do not shoot, your soldiers do not attack walls / keep / guards on their
   own. Click any of its buildings: "Neutral settlement: <name>", "Relation 0", "Neutral: gates open by day ...".
4. **Workers**: farmers (farmer art, pale) walk out to the farm plots and back, the priest to the church; at Ironhold
   miners walk to the ore. At night everyone goes inside and the gate stays shut for you (stand next to it at night: it
   does not open; it still opens for its own folk).
5. **Attack**: right-click one guard (or a wall) with soldiers selected. Toast "<name> takes up arms ...", the whole
   garrison comes for you (they turn back at the leash ~16 tiles from the keep, heal, then stand down again after 20 s
   calm), towers shoot you, the gate is shut. Panel now "Hostile settlement: <name>", "Relation -15"; hitting more does not
   lower it further this spell; the minimap flag turns red. `stamp-site.mjs list` shows HOSTILE.
6. **Calm**: after 2 game days with no more damage it lays down its arms (toast), flag white again, gates open by day.
   (Quick check: leave it alone; no hook needed beyond time, or see settlements-test K.)
7. **Raze**: break in (ram / knights) and destroy the keep: plunder toast, workers and guards rout, then "You attacked a
   settlement: <name> will not forget (relation -55 or so)". The ruined keep can be rebuilt as your outpost like a fort
   (cost 80 wood + 80 rock + 20 iron); afterwards every OTHER settlement's relation drops 25 (see their panels).
8. **Save / load** with a settlement hostile and one razed: both come back the same (workers reappear when you get near).

## 6b. Relations and trade (phase D)
Same server as §6 (`COLONY_TEST_HOOKS=1`, scratch `COLONY_SAVE_DIR`, a settlement found or stamped with
`node stamp-site.mjs hearthmoor 0 60`). `node stamp-site.mjs relation <name> <value>` sets your clan's relation to it.
1. **Tier shown**: click any building of the settlement. Bonuses read "Relation 0: Neutral". Hover its flag on the
   minimap: "<name>: Neutral (relation 0)". The flag is white at Neutral.
2. **Trade panel**: walk to within ~6 tiles of its walls (or inside). The panel has a "Trade" button ("Neutral prices");
   click it: a second parchment panel opens to its left with Grain / Meat / Fruit / Wool / Wood / Rock / Iron / Cloth /
   Tools, their stock (e.g. Grain 80/200), the buy price, +1 / +10 buttons, the sell price, -1 / -10 buttons, and their
   purse. Walk away (beyond ~6 tiles): the buttons grey out and the panel says "Walk up to the walls".
3. **Buy**: with gold in stock press Grain +10: toast "Bought 10 grain from <name> for 30 gold (relation +1.5)", your
   grain +10, their stock 70/200, the grain buy price ticks up a little. Press +10 four more times: after 40 units that day
   the button greys ("0 more today"). Sell -10 grain back: you get less gold than you paid (sell price < buy price).
4. **Relation cap**: keep trading big lots: the relation climbs about +6 in a game day at most (later trades show
   smaller "+0.x" gains, then none). Watch the relation in the panel header.
5. **Better prices**: `node stamp-site.mjs relation <name> 30` -> toast "<name> is now Friendly toward you (30): better
   prices", the flag turns light green, Grain buy 2.38 (was 2.80), sell up from 1.20 to 1.38, header "15% better
   prices". At 70: "Allied", flag blue, buy 1.96 / sell 1.56. At 100: toast "... Vassal-ready ...: they would swear
   fealty", flag gold; set 80: still Vassal-ready; set 65: back to Allied (hysteresis at 70).
6. **Refusals**: set -30: "Wary", flag orange, panel "Wary: no trade until relations reach Neutral", all buttons grey.
   Set -60: "Hostile: they refuse to trade", flag red. Attack a guard (it takes up arms): "Up in arms: they refuse to trade".
7. **Production**: note their Grain stock, wait for dawn: Hearthmoor +20 grain (+8 fruit, +6 meat, +4 wool, +10 gold),
   Ironhold +8 iron / +15 rock / +1 tools, Riverwatch a bit of everything; goods they do not make (e.g. wood you sold to
   Hearthmoor) drop ~10% a dawn.
8. **Defend / clear camps**: with relation at Neutral, kill night raiders or goblins within ~20 tiles of its walls:
   relation creeps up (+1 a kill, at most ~8 a day). Destroy a bandit / orc camp or fort keep within ~60 tiles of it:
   toast "<name> thanks you for clearing the camp (relation +15)" (+5 for settlements up to ~120 tiles away). This also
   works while Hostile (the way back).
9. **Drift**: set 20 and leave it alone for 3+ game days: it slides 1 a dawn back toward 0 (negative values recover the
   same way).
10. **Save / load**: trade a bit, set a relation, save to slot 1, change things, load: relation, tier flag, their stock
    and today's remaining caps come back as saved.

## 6c. Settlement quests (phase D2)
Same server as §6 (`COLONY_TEST_HOOKS=1`, scratch `COLONY_SAVE_DIR`). Stamp or find a settlement (`node stamp-site.mjs
hearthmoor 0 60`) and walk up to it so you have sighted it (toast "You sight the village of <name>"). Force a quest with
`PORT=<port> node stamp-site.mjs quest <name> deliver` (or `clearCamp`, `defend`); `node stamp-site.mjs quests` lists
open ones. Left alone, sighted settlements post quests on their own now and then (every 30 s a 1-in-5 chance, then a
day's pause per settlement).
1. **Posted**: toast "<name> asks for help: Deliver 20 ... (N gold). Open Quests to accept". The top bar's "Quests"
   button (next to Hero) reads "Quests (1)" with a gold ring; a gold diamond appears on the minimap (on the keep for
   deliver / defend, on the camp for clearCamp).
2. **Panel**: click Quests: a parchment panel lists the quest with its text, "Reward N gold, relation +6 · ignore -3",
   the settlement and time left (e.g. "3.0 days left", counting down). The gold ring goes away once you have looked.
   Escape or x closes it.
3. **Accept**: press Accept: toast "Quest accepted: ...", the entry shows a tick, "fail -8", and Deliver / Abandon
   buttons; the minimap diamond turns green.
4. **Deliver**: far from the walls press Deliver: "Walk up to <name>'s walls". Without the goods: "You have only N ...".
   Get the goods (make them, or buy them at another settlement), stand within ~6 tiles of its walls, press Deliver: toast
   "Quest complete: ... +N gold, relation +6.0"; your stock loses the goods, gold goes up, the quest disappears.
5. **Clear the camp**: `quest <name> clearCamp` (needs a bandit / orc camp or fort within ~60 tiles: stamp one with
   `node stamp-site.mjs thornwick <dx> <dy>` close to the settlement if it says "no camp"). Accept, then destroy that
   camp's hearth / keep: "Quest complete: Clear the camp near <name>. +N gold, relation +..." (on top of the usual
   "thanks you for clearing the camp (relation +15)").
6. **Defend tonight**: `quest <name> defend` (jumps to nightfall and spawns 4 goblins just west of its walls). Accept,
   kill them near the walls: the entry counts "slain 1 / 4" ...; at 4 toast "enough raiders slain. Hold until dawn".
   At dawn: "Quest complete: Defend <name> tonight". If you accept and do not kill enough by dawn: "Quest failed ...
   Relation -8". By day the helper says "defend quests are posted at night" unless it set the clock (it does).
7. **Abandon / ignore**: Abandon an accepted quest: "Quest failed: ... (abandoned). Relation -5". Leave an unaccepted
   quest for 3 game days (or 2x speed): "You ignored <name>'s plea ... Relation -3".
8. **No quests from enemies**: `node stamp-site.mjs relation <name> -60` (Hostile): its open quests are withdrawn ("<name>
   withdrew its request") and `quest <name> deliver` answers "would not post deliver: hostile to the clan". Attacking a
   guard (up in arms) does the same.
9. **Not farmable**: complete two or three quests at one settlement on the same day: the relation gain shrinks and stops
   at +12 a day; the settlement will not post you a new one for a game day after each post (the helper bypasses this).
10. **Save / load**: accept a quest, save to slot 1, abandon it, load slot 1: the quest is back, still accepted, with
    its time left.

## 6d. Trader wagons (phase E)
Same server as §6 (`COLONY_TEST_HOOKS=1`, scratch `COLONY_SAVE_DIR`). Stamp or find a settlement, sight it, and make it
Friendly: `PORT=<port> node stamp-site.mjs relation <name> 30`. Keep more than 20 of some good (wood, grain...).
Shortcuts: `node stamp-site.mjs tradingpost [1|2|3]` places a Trading Post 4 tiles SE of the Town Center at that
level; `node stamp-site.mjs wagon [<name>|auto]` sends the first post's wagon now (by day, no trip cap);
`node stamp-site.mjs wagons` prints every post, wagon leg / destination / cargo and escort. The top-bar time controls
(2x / 4x) speed the trip up.
1. **Build + panel**: build a Trading Post (or the helper). Within a second a cart (brown tint, "Trader Lv1 · 3
   escorts") and 2 militia + 1 spearman stand by it; the population counter does not change. Click the post: the
   panel shows "Wagon HP 120/120 · At home", "Escort: Militia, Militia, Spearman", a destination list (name, tiles,
   safe / risky / deadly, ~gold) and Send trader now / Recall / Auto-send: On.
2. **Upgrade**: Upgrade to Lv2 (60 wood + 40 rock + 30 gold) then Lv3 (100 wood + 80 rock + 20 iron + 60 gold): the
   cart gets bigger and greener / iron-grey (art #63-#66 replaces it when delivered), HP 220 / 400, escort 4 spearmen /
   4 pikemen + 1 cavalry.
3. **Trip**: press Send trader now (or wait for the morning with Auto-send on): toast "Trader wagon leaves for <name>
   with N gold of goods (road: safe)", a dashed route line in green / orange / red, a gold dot on the minimap, the
   escort walks with it. At the walls it waits ~20 s, toasts "sold its goods ... N gold (relation +x)", turns home
   and on arrival "Trader wagon is home from <name>: +N gold ...". The settlement's relation rose (Trade panel).
4. **Recall**: send it again, press Recall halfway: it turns back with its cargo (goods return to stock).
5. **Night**: send it late in the day: at nightfall it stops ("camped," in its label) and goes on at dawn.
6. **Attack**: stamp a bandit camp on the route (`node stamp-site.mjs thornwick <dx> <dy>`) or spawn bandits near the
   moving cart: toast "Trader wagon under attack!", the fight notifier / minimap alert fires, the escort fights.
   Let it die: "Our trader wagon was plundered near ..." and "<name>: the goods never arrived (relation -3)"; the
   panel says when a new one comes (first dawn / dusk after a day, for 20 wood at Lv1).
7. **Save / load** with the wagon on the road: it is still on the road with the same cargo, the escort follows again.

## 7. Units settling on their slots (fix 9ee5a7f)
1. Select a mixed squad (knights + archers), right-drag a line next to troops already standing idle on their slots.
   Every unit should walk round the idle ones and stop exactly on its slot; nobody left a tile or two short in
   "returning" while the rest have stopped.
2. Repeat with the line crossing the idle troops (the order sends units through them), and once in a tight spot
   (between buildings or walls): units must not cut corners onto solid tiles while stepping round someone.
3. After a fight, the survivors should all walk back onto their slots.

## 8. Flaky automated checks to look at (not caused by recent work)
- `combat-line-test` fails some runs on old and new code: "marching followers on their heading-relative slots",
  "5 goblins on one player ... closest pair", "knight fought ... back on slot". If you see these in the game
  (followers trailing a marching group, goblins bunching on you), note what happened.
- `battle-discipline` "S: >1 distinct goblin being fought" fails about 1 run in 15 on old and new code (knights
  sometimes all pile onto one goblin).

## Automated tests you can run
- `npm test` runs everything (about 80 minutes). `npm test -- <word> <word>` runs only test files whose name
  contains the word; `npm test -- --list` shows what a filter selects.
- Fast and reliable (under 1 minute each, expected to pass): `formation-test`, `regiment-test`,
  `gates-walls`, `goals-castle`, `battle-discipline`, `builders-farmers`, `day-respawn`, `fight-notifier`,
  `orders-test`, `regiment-groups`, `player-morale`, `scale-rider`, `time-intel`, `settlement-pop`, `raid-morale`,
  `tactics-test`, `strategy-view`.
- Known failing or flaky (do not worry): see `ROADMAP.md`, "Known failing tests" and "Full-suite run after the server
  split".
- No health bars except the red boss bar; fainter green selection rings; smaller banners (strategy mode).
