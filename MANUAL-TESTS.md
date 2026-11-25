# Things to try yourself

Start the game with `scripts/live.sh` (frozen copy that keeps running while code changes; `live.sh update` picks up new
code) or `npm run dev`. Open http://localhost:5173. Detailed step-by-step checklists live at the end of each
"landed" section in `ROADMAP.md`; this is the short version, in the order I would try them.

## Post-Castle goals (2026-11-20)
After "Clear the Castle Ruin" the goal card should continue: Destroy 3 enemy camps, Take a vassal, Hold 600 gold, Survive
15 nights, each with a "Goal complete" toast and a small reward; only after the last does it read "Complete".

## Clay pit and pottery (2026-11-18)
New game (normal, creative off).
1. Build panel: Next steps / Progression list a **Clay & pottery** chain; the Clay Pit shows "Locked. Needs: Wooden
   shovel", the Kiln "Needs: a Clay Pit", the Bloomery now also "8 Bricks". Craft by hand: **Make a wooden shovel**
   (3 wood + 1 rock); **Build a clay oven** now costs 4 wood + 6 Bricks + 2 Clay (no rock).
2. Industry tab: **Clay Pit** on dry ground far from water: "A Clay Pit needs water within 3 tiles: a pond, a river or
   a dug Moat". Next to a pond it goes up (stand-in: the quarry sprite tinted clay-brown). Away from water, dig one
   Moat tile (Combat tab, 4 wood) within 3 tiles and it is allowed there too.
3. A villager takes the post: the info panel says "<name>: Digger L1 ...", Clay climbs in the Goods list (stops at 60).
4. **Kiln** (stand-in: the blacksmith tinted orange): a potter fires Bricks first (to 20), then Clay pots (25), Roof
   tiles (8), Tableware (12), each batch using clay + 1 wood. Set wood to 0 (or run out): the panel says "Idle: ...
   Bricks: short of wood".
5. Once the potter is level 2 (panel XP line), upgrade the Kiln: new ware comes out **Good**; with Charcoal in store
   the potter fires a **Crucible** (2 kept).
6. Bloomery: refused without 8 Bricks ("Bloomery needs: 8 Bricks"), built with them (bricks are kept, not used up;
   it now costs 10 wood + 15 rock). Its info panel: "Level 2 needs: Crucible, a Blacksmith, Smelter level 2".
   Bakery costs 10 wood + 8 rock now.
7. Stockpile zone: the zone list's capacity rises 1% per clay pot in store (40 per tile -> 50 at 25+ pots).
8. Happiness rises by about 3 once 4+ Tableware are in store (4-5 if some are Good / Fine).
9. Wooden House -> upgrade twice: the last tier refuses "Level 3 Wooden House needs: 4 Roof tiles" until the Kiln has
   fired them.
10. Hero: walk up to your Kiln (outside) and press E: "Craft at workstation" lists the five firing recipes; Fire
    tableware works at Pottery 1, the crucible says "Needs skill level 2". At the Clay Pit (stand on the side away from
    the water, else E fishes): Dig clay. The Character sheet shows a **Pottery** skill.
11. Save, load: pits, Kiln level, potter level and all the clay goods are back.
12. Opening still playable: from the kit, Lumberjack -> Charcoal Burner, shovel -> Clay Pit (pond or moat) -> Kiln ->
    bricks, hides -> bellows -> Bloomery -> anvil + tools -> Blacksmith.

## Animal paddocks (2026-11-18)
1. Build a Chicken Coop, paint an Animal area (Zones tab) next to it. Zone list: "Open (animals can't be kept)"; hover
   it for the reason. Buy a few hens: they wander round the coop as before.
2. Farming tab: **Fence** (2 wood), right-drag lines round the area (4-connected, no diagonal gaps); leave one gap and
   put a **Fence Gate** (4 wood) in it. Put the coop in the fence line. Fence pieces join up (horizontal / vertical rail
   art); the gate lies along the fence and opens when you walk up to it.
3. Zone list now says "Fenced (N tiles). Paddock: 3/N tiles, 3 animals · grass 100%"; a pale outline marks the fenced
   ground (fainter with the Zones tab closed). The coop panel shows **Paddock: Auto … using <name>** and a paddock note.
4. By day the hens come out next to the coop inside the fence and never cross it, even after several minutes.
5. Panel selector → None: the hens go in and come out at the coop door again; back to Auto: inside the fence again.
6. Overstock (e.g. many hens / a few cows in a small paddock) and let a few days pass: grass % drops, bare patches show
   as trampled earth; fewer animals and it slowly greens up again.
7. Demolish one fence piece: the zone flips to Open, the hens wander out as before. Rebuild it: fenced again.
8. Creative: spawn a wolf next to the fence of an occupied paddock (no soldiers near): it bites the fence until it breaks
   ("Fence destroyed"), the hens run inside. Save, load: paddock, selector choice and grass are kept.

## Character creator (2026-11-16)
1. New Game, Solo or Creative: change name/body/build/face/hair/colours/horse. Try idle, walk, attacks and mounted preview. Back/Escape returns to the menu. Preview gear grants no items.
2. Start: the same character appears at normal human scale. Move in both directions; feet, weapon grips and hair stay attached. Other humans keep their existing size.
3. Hero → Edit appearance: change a field, wait while the world ticks, then Save. The unfinished edit must not reset. Collapse the editor to access gear/inventory.
4. From existing armoury stock, withdraw a helmet, body armour, shield and sword/axe/spear/bow at each tier; equip them. Bow + shield is refused in both orders without losing items. Axe swings more slowly and hits harder.
5. Mount a real owned adult horse, move and attack, then dismount. Check the chosen coat and stable seat. Enter a house: the same identity and size remain. Join from a second browser/profile and check the first player's appearance/attacks.
6. Save/load (or Continue from an autosave): choices and gear remain; the creator is skipped. Get hit: crimson splash and brief recoil. Review animations during sustained play, particularly bow release and horse stepping.

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

## 6e. Vassals (phase F: fealty, call to arms, tribute)
Same server as §6 (`COLONY_TEST_HOOKS=1`, scratch `COLONY_SAVE_DIR`). Stamp or find a settlement and sight it.
Shortcuts: `PORT=<port> node stamp-site.mjs vassal <name>` (relation 100 + vassal, forced even with a weak army: it
then breaks free at the next dawn unless your power is at least its own), `node stamp-site.mjs tax <name>` (tribute
on + one collected now), `node stamp-site.mjs levy <name>` (the levy's day ends now and the cooldown is cleared),
`node stamp-site.mjs vassals` (liege, power, tribute, levy of every settlement).
1. **Fealty refused**: with no soldiers, `node stamp-site.mjs relation <name> 100`: toast "<name> would swear fealty,
   but your army is weaker than its garrison (power 0 vs ~3300)"; the panel shows "Allied" and "At relation 100 it
   swears fealty if your army's power is at least its own (yours N, theirs M)".
2. **Fealty**: build up soldiers (about 6-8 knights for a Hearthmoor) and wait for dawn (or set the relation again):
   toast "<name> swears fealty: it is now your vassal!". Minimap: its flag turns gold with a small crown; hover says
   "your vassal". Panel: "Relation 100: Vassal (sworn to you; free again below 70)" and the vassal block (power line,
   Call to arms, Levy status, Demand tribute: Off, Tribute: last never / next off).
3. **Call to arms (normal view)**: press Call to arms: toast "<name> answers your call to arms: 3 levies march out
   for 1.0 days ..."; half its guards leave the walls as YOUR spearmen / archers / knights and follow you. Population
   counter unchanged. Panel: "Levy: 3 on the field, 1.0 days left"; a second press is refused.
4. **Strategy mode**: Tab, select one of your regiments, open the vassal's panel, press Call to arms (after `levy
   <name>` to clear the cooldown): the levy follows the selected army. A "<name> Levy" regiment card appears; select
   it and give move / attack-move / follow / charge / hold orders: it obeys. Order it far away: it stops about 55
   tiles from its walls, toast "will not march beyond 60 tiles of its walls".
5. **Service ends**: press Dismiss levy (or `levy <name>`, or wait one game day): "it marches home"; the levy takes
   no orders, walks back into the yard and turns back into its guards ("The <name> levy is home"; garrison back to
   6/6 minus any that died). Panel: "Ready again in N days" (3 days from the call).
6. **Casualties**: let a levy die in a fight: relation -1 each; if all of them die, "You bled us dry" (-5 more).
7. **Tribute**: with a strong army (power at least 1.2x theirs) press Demand tribute: the estimate shows e.g. "51
   gold, 17 grain, 6 fruit (17% of their stock), relation -3.9"; at the next dawn (or `tax <name>`) toast "Tribute from
   <name>: ..." and your stock rises; the ledger line shows last / next (every 2 dawns) / total. A bigger army takes a
   bigger share (up to 40%) and costs more relation (up to 6). Without the army the button is disabled with "Your
   army is too weak"; if your army shrinks below 1.2x while it is on, the dawn toast is "<name> refuses tribute".
8. **Breaking free**: taxes / killed levies / hitting it lower the relation; below 70: "<name> breaks free: your
   relation fell below 70" (gold flag goes, tier Allied / Friendly, any levy marches home). Also at a dawn when its
   garrison outmatches your army: "breaks free: its garrison now outmatches your army".
9. **Liege hits**: attack your own vassal: it does NOT take up arms; toast "You struck your own vassal <name>!" and
   relation -15 (at most every 10 s), so repeated attacks break vassalage and the next hit makes it hostile.
10. **Still a settlement**: a vassal keeps posting quests (Quests panel) and trades at the best (Vassal) prices; a
   second clan (`?clan=new`) sees it as at most Allied ("Vassal of <clan>" in the panel, bronze minimap flag).
11. **Save / load** with a levy on the field and tribute on: still a vassal, tribute still on, the levy still yours.

## 6f. Creative mode (test environment)
Start the game as usual (server + client), then on the main menu press **Creative** (or open the client URL with
`?mode=creative`: New Game then reads "New Game (Creative)"). This restarts the world as a creative game for everyone
connected. A creative game saves (autosave and manual Save) ONLY to the "Creative" slot, so your normal Autosave /
Slot 1-3 are never touched; the Load list shows it as "Creative · Creative · Day N ...".
1. **Mode check**: top bar shows a **Creative** button (it is absent in a normal New Game). Stock line shows 999999
   of every good and gold; the armoury 9999 per tier. Place any building: it appears at once (no builders), stock
   stays 999999. Upgrade it: instant. Queue 20 forge items / a siege engine / recruit a hero: each done in a tick.
   The population counter reads x/9999 (no caps, no "garrison full").
2. **Panel**: press Creative. Tabs: Yours / Enemies / Neutrals / Armies / World / Tools; a Help list at the bottom.
   "Place: At centre" uses the camera centre; "At click" waits for your next left-click on the map (toast "Click on
   the map to place it"). Typing numbers in the panel must not trigger game hotkeys.
3. **Yours**: spawn 10 knights Level 3 Gear T3 in a line: 10 knights appear in a line, with T3 armour / weapon rings;
   select them and command them as usual. Try cavalry, rams, catapults and each hero class (hero sheet lists them).
   Spawned units never respawn and die without a toast.
4. **Enemies**: spawn every kind once (goblin wolf rider, troll, ogre, siege ram / catapult ...); Mark: rux on 10
   goblins (sigils show); Warlord on an ogre = Ogre Warlord (boss bar); Elite = mini-boss. "As site guardians" adds
   the kind to the fort / settlement nearest the point (stamp one first, World tab).
5. **Armies**: Faction greenskinWarband, size 500, Line: a raid group appears already engaged and marches / fights.
   "All goblin" + size 500 gives a pure goblin army.
6. **Neutrals**: Test clan soldier, knight x10, Dummy: grey-clan knights stand still. With soldiers selected,
   a plain right-click on one only moves them there. **Ctrl+right-click** it: your soldiers attack it (works with the toggle off;
   toast "N units attacking"). Tools > **Allow attacking neutrals: ON**: your soldiers now attack Test clan units on
   their own, and your rider's own attack hits them; Aggressive Test clan soldiers fight back. Turn it
   off: your units stop picking them (forced targets stay). Settlement folk (townGuard ...): Dummy ones stand still
   even when hit; Aggressive guards wake and fight when hit or while the toggle is on. Wildlife: Ctrl+right-click a
   deer to send soldiers after it. "Respawn last" clears the neutrals and spawns the last neutral batch again;
   "Clear neutrals" removes all.
7. **World**: Day 10 + "noon": the clock jumps (toast "Day 10, noon"); "midnight": night falls. "Raid now" day 15: a
   day-15 raid spawns at the edges and departs at once. Stamp each template (thornwick / grakkar forts, hearthmoor /
   ironhold / riverwatch settlements) at the centre: "Stamped <name>" or "No room: ..." (pan to open ground).
   "Trading Post + wagon" places a post with its wagon. Relation 100 / Vassalise / Free and Quest Post act on the
   human settlement nearest the point (toast names it; the settlement panel agrees).
8. **Tools**: Godmode ON: monsters hit you for nothing. Heal all: every unit, rider and Town Center full HP. Kill all
   monsters: every monster dies (settlement folk and neutrals stay). Clear wildlife. Tab = Command view (free camera).
9. **Saves**: Menu > Save: toast "Game saved to Creative". Settings shows only the Creative save row. Return to menu:
   the Load list shows your normal saves unchanged plus "Creative". Load the Creative save: creative again (button,
   999999). Then New Game (not Creative): a normal world, no Creative button, normal stock.
10. **Normal game guard**: in a normal game nothing creative exists (no button; the server refuses creative messages).

Quick scenarios (each takes under a minute):
- 500 goblins (Enemies, Line, Count 100 x5 or Armies "All goblin" 500) facing 500 of your soldiers (Yours, knights
  x100 x5, Line) 15 tiles apart: select yours, attack-move into them. (1000 vs 1000 works but the server slows to
  about 0.8x speed.)
- Stamp a thornwick fort, spawn 20 battering rams (Yours, Count 10 twice) and 100 knights next to it, order the rams
  onto its gate / walls, watch the breach and the guardians wake; add orc guardians with "As site guardians".
- Stamp hearthmoor, Vassalise it, open its panel and press Call to arms: the levy marches out as your units.
- Stamp riverwatch, Relation -100 (panel: Hostile), spawn 100 knights, attack it and take its keep.
- Test clan: 100 Aggressive knights in a Line vs 100 of yours with Allow attacking ON: a clan-vs-clan battle.
- Ogre Warlord + 10 rux-marked trolls vs 50 T3 knights and the three hero classes.
- Day 20 midnight + Raid now day 20: a full late-game night raid against your base.

## 6g. Batch 2 sprites (wagons, trading post, goblin rider, keeps, tents, UI icons)

- Creative mode makes this quick: follow ROADMAP.md "Delivered sprite sheets (batch 2) wired" (browser checklist).

## 6h. Warbands and camp growth (phase G)

Use a **Creative** game (§6f), 256 or 512 map. Normal games spawn warbands by themselves from day 2 (one every 3-4
days, cap 1 at 160 / 2 at 256 / 4 at 512); creative buttons make it instant.
1. **Spawn**: Creative > World > Warband "bandit" > **Spawn (camps at click)**, then click open ground 70+ tiles from
   your Town Center. Toast "A bandit warband (N tiles away) heads for the click". Nothing shows yet if it is far from
   all your units (it walks abstractly).
2. **On the move**: walk your hero towards the map edge nearest the click. Within ~96 tiles 5-9 bandits appear,
   walking in a loose pack along a route; within ~20 tiles the toast "A bandit warband is on the move to the ...".
   They do not attack you on their own. Walk away past ~100 tiles: they vanish (abstract again) and reappear further
   on when you come back.
3. **Turns to fight**: shoot one, or step within 5 tiles: toast "The bandit warband turns to fight!", they attack
   like normal raiders.
4. **Settle**: spawn another and wait (Day/time buttons or just a minute or two). On arrival a tier-1 camp is stamped:
   fence ring, tents, campfire, keep; toast "A warband has settled at <name> Palisade" if you saw it. It appears on
   the minimap once its keep is explored.
5. **Growth**: click **Grow camp** near it: tier 2 (wood walls, gate, tower), toast "<name> has grown (tier 2)";
   again: tier 3 (more towers/tents, more garrison, keep 550 HP). Orc ("orc" faction, Grakkar) camps go to tier 4 and
   dig the moat row before the south gate. Natural growth: Day + 5 (setTime) then walk near it: it catches up.
6. **Raids**: with a tier-3 camp within ~140 tiles of your Town Center, set the time to dawn and fast-play past noon (camp
   raids spawn at the raid hour with the normal raid; World > Raid now does NOT include them): toast "Raiders muster at <name>", a
   group of 9+ comes from the camp's side after nightfall.
7. **Quests**: a human settlement within 60 tiles of a tier-3 camp posts "Clear the camp" quests much more often.
8. **Clear**: raze the keep (normal fort rules). It stops growing. After 10 game days a later warband may re-settle
   the same spot (the ruin is replaced by a fresh tier-1 camp).
9. **Save / load** with a warband on the move: it is still there after loading (re-appears as bodies within 1 s if near).
Automated: `npm test -- warbands-test` (19 checks, ~1 min).

## Moats and drawbridges (phase H)

Use a **Creative** game (§6f: instant build, free stock) or a normal game with builders and wood / iron. Tools are in
the **Combat** tab: **Moat** (`,`) and **Drawbridge** (`/`).
1. **Dig**: pick Moat and right-drag a line near (not touching) your Town Center: every tile under the pointer gets
   dug, diagonal drags fill the corner tile too (no diagonal gaps). Normal games: a dig site per tile, 5 s each, 4
   wood (phase I; was 1). Art: connected moat water (moat_00-15; if a tile looks wrong / a piece faces the wrong way note the mask); a
   tile next to the Town Center is refused ("Too close to the Town Center for a moat").
2. **Drawbridge**: pick Drawbridge and right-click a moat tile (bare ground is refused: "A drawbridge goes on a moat
   tile"). 25 wood + 10 iron. It shows raised; walk a soldier up: it lowers (art "Lowered"), raises ~2 s after he
   leaves. Left-click it: the info panel has the gate Lock row (Auto / Locked open / Locked closed).
3. **Barrier**: drag a closed moat ring around a few buildings with one drawbridge, put a Tower inside. Raid now
   (Creative World > Raid now) or spawn enemies outside: they stop at the water and batter the drawbridge; the tower
   and archers shoot across. Soldiers ordered across walk over the lowered bridge. A ram breaks the drawbridge: the
   tile is water again (no rubble).
4. **No drawbridge**: demolish the drawbridge (it goes back to moat) so the ring is fully closed. Enemies pick a moat
   tile and "fill" it (takes a while), it turns into rubble and they walk in.
5. **Formation on the water**: select a few soldiers and right-click the middle of a moat: they line up on the bank
   they came from, not in / across the water.
6. **Fill**: Demolish on a moat tile fills it at once (bare ground).
7. **Forts**: Creative > grow an orc (Grakkar) camp to tier 4: the moat row before its south gate now has a real
   drawbridge (raised; your army must break or overrun it). Riverwatch settlements have moats N and S with
   drawbridges in front of both gates (open to you by day like its gates).
8. **Save / load**: moats, drawbridges and their lock survive.

Automated: `npm test -- moats-test` (18 checks).

## 6i. Tuning pass (phase I)

Short checks of the phase I numbers (ROADMAP "Phase I — landed"). A normal game is best (Creative hides costs).
1. **Moat cost**: the Moat tool's cost text reads "4 wood"; digging a tile takes 4 wood from the stock.
2. **Iron price**: at a Neutral settlement's trade panel iron costs about 2.5 gold to buy and sells for about 1.1
   (was 4.2 / 1.8). Buy 5 iron at your Trading Post (8 gold), sell it to a Friendly / Allied settlement: you get less
   than 8 gold back (no buy-at-the-post, sell-to-the-village profit).
3. **Settlement purse**: note a Hearthmoor / Ironhold settlement's gold in its trade panel, sleep past a dawn: it
   rises by about 20 (Riverwatch about 35; was 10 / 10 / 25), up to 600.

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
- Phase F: `vassals-test` (own server, ~1.5 min): fealty vs power, tribute amount / relation cost, call to arms,
  leash, return, cooldown, casualty, save / load, refused when weaker, breakaways.
- Known failing or flaky (do not worry): see `ROADMAP.md`, "Known failing tests" and "Full-suite run after the server
  split".
- No health bars except the red boss bar; fainter green selection rings; smaller banners (strategy mode).

## World streaming (phases 1-2, server-side; should look exactly as before)
1. 512 map, normal game: build houses, a tavern, towers, walls with a gate; population caps, happiness and tower
   fire behave as before; workers still walk to trees / ore / farms and back (paths are cached now).
2. Demolish a wall a worker walks around, or build a wall across a worker's route: the worker re-routes at once
   (no walking through the new wall, takes the shortcut through the gap).
3. Save, load, keep playing a day: houses still count toward the cap, towers still fire.
4. 512 map: wildlife far away still wanders when you walk up to it, forts / camps still wake when you approach and
   sleep when you leave (phase 2 freezing is off below 768 tiles; nothing should differ).

## World streaming phase 3 (abstract records; off below 768 tiles, so normal games look exactly as before)
To see it on a 512 map, start the server with `COLONY_TEST_HOOKS=1 COLONY_STREAMING=1 COLONY_WORLD_SIZE=512` (and a
scratch `COLONY_SAVE_DIR`), then open the client as usual.
1. Walk (or teleport in creative) 200+ tiles from the Town Center toward a far ruin / fort: the guardians, animals and
   any stray mobs there should be standing where they were when you arrive (no pop-in on screen, nothing missing).
2. Stay away a whole game day, then return to a far wood: a few animals more (or fewer) than before is expected;
   never a sudden herd. Picked berry bushes far away should have regrown on your return.
3. A warband marching far away: no bodies on the minimap / screen until you get within ~3 chunks; it should be
   further along its route, not back at the start.
4. A tier-3 founded camp 130+ tiles out raids at night: the raiders appear walking in from its direction (not at
   the camp) once they near your ACTIVE area; "Raiders muster at ..." toast as before.
5. A trader wagon on a 150-tile trip: it should arrive and come home as before, occasionally late, rarely with a
   "waylaid: half its goods are lost" toast. Its escort should still be with it when you meet it on the road.
6. Save far from home, load: the far world is still there (forts, animals) after the load.

## World streaming phase 4 (diff saves, chunked transfer, Vast 1024 maps)
Normal sizes (up to 512) should look and save exactly as before. For the new path pick **Vast** (1024) in the menu
(generation now takes about a second, behind the loading screen), or a 512 server with
`COLONY_TEST_HOOKS=1 COLONY_STREAMING=1` and a scratch `COLONY_SAVE_DIR`.
1. Vast map: the ground, trees, decor and buildings around the Town Center appear within a second of the welcome;
   walk / pan the camera: new ground fills in at the screen edge with no grass-then-swap flicker and no holes.
   Roads and walls that cross a 32-tile chunk edge join up (no broken autotile pieces at the seam).
2. Minimap on Vast: about 512 px across (one pixel per 2x2 tiles), fog clears as you explore; explored far-off
   areas show forests / water / forts even before you have been near them; buildings you place show up.
3. Strategy mode at Vast: zoom all the way out (Map band) - the summary map covers the whole world, lined up with the
   flags / Town Center markers; zoom back in anywhere: the ground there loads.
4. Save on Vast, load: the world comes back the same (your buildings, roads, cleared trees, explored fog). The save
   dir holds the slot plus one `base-<seed>-1024-v1.bin.gz`; the slot file should be well under the old size.
5. 512 normal game: save / load / restart behave as before (old full-array saves still load).

## Loading screen (Giant / Vast / Colossal maps)
Worldgen is now about 0.5 s at 1024 and 1.5 s at 2048 on the WSL box, so the screen may only flash on a fast PC; a
slower one (or Colossal) shows it longer.
1. Settings > Map size: **Vast**, New Game: a parchment loading screen ("Forging a new world", "Vast map, 1024 x 1024
   tiles") covers the old world at once, the bar moves forward (never back), the stage list ticks off Generating
   terrain, Placing settlements and forts, Planting forests ..., Placing camps ..., Releasing wildlife ..., Saving
   base cache, Sending map to your browser, Starting; it fades out on your hero with the ground already drawn.
2. Tips: a "Tip" line with a real game tip; on a slow load it changes every ~6 s with a short fade.
3. Map size **Colossal**: a red "Colossal: long load, needs a strong PC" note under Map size; New Game makes a
   2048 x 2048 world (sub line says so); the minimap / strategy Map band cover it; walking around stays smooth.
4. Cancel: start a Colossal New Game and press **Cancel** while the bar is in the generation stages (Back to menu once
   it is sending the map): you land back on the main menu; New Game again works. (A second browser tab connected
   to the same server instead gets the small stand-in world.)
5. Load Game of a Vast save: "Loading your world" with Reading the save -> Sending map -> Starting.
6. Medium / Large maps: no loading screen (too quick to need one).

## World streaming phase 5 (chronicle, abstract strife)
1. A **Chronicle** button sits next to Quests. Open it: newest first; "While you were away" heads entries that
   arrived since you last read it; closing it clears the badge. Reconnect (reload the page): a "While you were away:
   N entries" toast when something happened meanwhile.
2. Vast (or streamed 512) map, play a few days far from the edges: entries appear for far trader wagons (reached /
   held up / waylaid), raiders setting out, a warband settling (a "Rumour" if unseen), camps growing a tier.
3. Rare: "Raiders from X besiege Y; it begs the clans for help" + a Quests entry "Help Y: break X" (reward ~1.5x a
   normal camp quest, deadline 2 days). Break the camp in time: "The siege of Y is lifted". Ignore it: Y may fall
   ("Y has fallen ...", its keep a ruin on the map) or "held out". Walking near Y lifts the siege (never falls in
   front of you). A settlement that is your vassal is never raided this way.

## Battle engine phase 2 (formation march, strategy-mode orders)
1. Strategy mode: select a regiment of 20+ soldiers, order a move 10+ tiles away. The block should walk as one
   rectangle (no streaming / mixing), turn smoothly at corners, and form up on the target facing the drag direction.
2. Order the same regiment again (same width): each soldier should keep its place in the block (watch one unit).
3. Order a wide line through a gap between buildings or forest: it should narrow into strips and widen after the gap.
4. Attack-move into enemies: the block stops on contact and fights as before; a new order mid-march re-routes cleanly.
5. Retreat a marching regiment: it heads back to the Town Center at retreat speed.

## Battle engine phase 3 (contact lines, flank / rear)
1. Creative: two regiments of 15+ soldiers vs a camp / raid of 15+: the lines meet and each front soldier fights the
   enemy in front of it (no whole regiment piling on one mob); the rear ranks join as before.
2. Send a second regiment round the side of an enemy regiment that is fighting your first: its blows should land
   harder (the fight ends visibly faster than a frontal one).
3. A big battle (100+ per side, test hooks / creative): no long freezes while it is fighting; note any stutter when an
   enemy regiment breaks and flees (known: a rout of 100+ is a one-off spike).

## Battle engine phases 4-7 (cleanup, volleys, morale cascade, enemy commander, LOD)
1. A routing enemy regiment of 100+: no freeze when it breaks (was a 1-3 s spike); the fleeing mobs run straight away
   and slide round trees / walls instead of all stopping to think.
2. Select 200+ soldiers and drag a line: they should split into companies of up to 150 (two or more regiment cards),
   standing side by side as blocks along the line, not one 300-tile string. Order them again: the same companies
   keep their places.
3. Spearmen / pikemen behind a front rank: the second rank should strike over the front (strike effects from the
   second row), not stand idle.
4. 20+ archers in front of an enemy regiment: arrows spread over the enemy regiment (not all on one mob). Turn on
   Skirmish for an archer-only regiment standing still: when enemy melee closes in, the whole block steps back
   together (a few tiles at a time, at most 8 tiles from where you put it).
5. A goblin wolf rider charging a formed spear / pike regiment from the front: no doubled charge hit (watch the
   spearman's hp). From the side it still lands double.
6. Two or more enemy regiments side by side: when one breaks, the one next to it should waver / break sooner
   ("shaken"). A raid army that has lost about 70% of its strength should flee as a whole.
7. A routed regiment of yours, after it rallies at the Town Center: it should re-form into its old ranks / width.
8. A long fight (a minute or more): the regiments slow down a little and hit a little softer when winded (subtle).
9. Dot LOD (flagged): open the client with `?battleLod=1`, spawn 400+ units (creative / test hooks), zoom the
   strategy camera far out (below 0.6): every soldier / mob becomes a coloured dot (your clan's colour, red for
   enemies), hp bars hidden; zooming in brings the sprites back. Check the frame rate with and without the flag,
   and that workers and sheltered civilians are unaffected. Without the flag nothing should change.

## Delta snapshots (2026-11-10; the browser now gets unit changes per tick instead of full snapshots)
1. Large battle looks identical: creative, 1000 soldiers vs 1000 goblins (or `node snapshot-delta-test.mjs`'s setup);
   units walk, fight, take hp, die and leave gravestones exactly as before; regiment cards, task forces, selection
   and orders (click a regiment card, drag a line) all still work. Compare with `?delta=0` (old full snapshots) in a
   second tab if anything looks off. DevTools > Network > WS: mid-battle frames ~30-45 KB (were ~280-350 KB).
2. Reconnect resyncs: mid-battle, reload the page (or restart the dev server and let the page reconnect): the army,
   mobs, buildings, zones, animals, calendar and HUD come back complete on the first frame, no ghost units left over.
3. Load a save / restart a world mid-battle: the old world's units vanish at once and the new world's appear.
4. Quiet colony: workers, haulers, livestock, wildlife, interiors (walk into a tavern), day / night and the calendar
   behave as before.

## Village life phases 1-4 (people, growth, training, villagers build, levy, raids, beds)
1. New normal game: 10 people (1 builder + 9 villagers in farmer clothes idling around the Town Center); the HUD line
   under the population reads "Villagers: 9 free · 0 children · 0 training · 0 posts open".
2. Place a Lumberjack Post: a villager walks over and becomes the lumberjack (free count drops by 1). Place more
   workplaces than you have free villagers: the extras show as "posts open" and get staffed as villagers free up.
3. Let a worker die (raid): nobody respawns at dawn or dusk; another free villager takes the post if one exists.
4. Demolish a workplace: its worker turns back into a free villager.
5. Place a Militia Camp / Archery Range / Hall: no soldier appears. Click it: "Train ..." button, refused with "No free
   villager" or "Needs a T1 weapon and T1 armour". Forge a weapon + armour (Blacksmith), click Train: a villager walks
   to the building, the panel shows "1 in training"; about one day later (daylight) it becomes the soldier.
6. Place a House with no builder alive: the free villagers build it (slower than a builder).
7. Over several days with food and free beds: a child is born (smaller villager, toast with parents' names) and grows
   up 6 days later; with high happiness an immigrant arrives now and then (toast).
8. Destroy a bandit camp's hearth: 1-3 freed prisoners join (toast with names).
9. Load an old save: everyone is still there; workers and soldiers keep working; the HUD shows the villager line.
10. Creative mode: posts still fill instantly, Train unit is instant and free.
11. Phase 4 levy: click your Town Center: "Call to arms (N villagers)". Press it: every adult villager and worker of
    that settlement turns into militia (spears) around the Town Center; the button reads "Stand down (N)" with a
    countdown. Press Stand down (or wait half a day): survivors go back to the jobs they had; a killed one stays dead
    and its workplace shows a post open. Pressing again within a day is refused ("Called too recently").
12. Phase 4 raids: a fresh game's first nights bring only 2-5 raiders; a bigger town gets bigger raids.
13. Phase 4 beds: at nightfall each villager walks to its own house (or the Town Center / Keep it was given), not
    the nearest one.
14. Phase 4: a Trading Post's escorts and the Ward Priest are villagers taking the post (free count drops); with no
    free villager the escort roster / priest waits.

## Progression tree (phase 1: gates and the Next steps panel)
1. New normal game, open the Build panel: under the cost line a **Next steps** list, **Craft by hand** buttons and
   "Items: Stone axe 1, Stone pick 1".
2. Hunter's Hut, Hall of the Sworn, Stables, Siege Workshop show dashed with "(locked)"; selecting one says
   "Locked. Needs: ...". Placing it toasts "Hunter's Hut needs: Stone knife".
3. Click "Knap a stone knife (1 wood + 2 rock)": toast "Crafted: Stone knife", items list updates, the Hunter's Hut
   unlocks and can be built. Lumberjack, Wooden House, Quarry, Iron Mine work from the start (starter kit).
4. Build a Blacksmith: the Hall of the Sworn / Stables / Siege Workshop unlock.
5. Click a Quarry: its info lists "Level 2 needs: Timber props"; Upgrade is refused with that reason until you cut
   timber props by hand (8 wood).
6. Creative game: everything open; Creative panel > Tools > "Unlock all (tree): off" makes the gates apply.
7. Load an old save: everything you had built stays buildable.

## Progression tree (phase 2: worker levels)
1. Build a Lumberjack; click it: "Name: Woodcutter L1 (n XP, m to next)" and "Works at tier 1 of 1". The XP climbs
   about 1 a second by day.
2. Upgrade it straight away: refused, "Level 2 Lumberjack needs: Woodcutter level 2". After ~100 s of work (toast
   "Name is now a level-2 Woodcutter") the upgrade goes through; the panel then says "tier 2 of 2: speed x1.25".
3. Build a Blacksmith: Forge Armour / Weapon are greyed "Needs a level-2 Smith" while the new smith makes tools; once
   the smith reaches level 2 the T1 forge buttons work.
4. XP belongs to the person: demolish a workplace and the freed villager keeps its XP (shown again if it takes the
   same kind of job).

## Progression tree (phase 3: stone age and the metal chain)
1. New normal game: Blacksmith is locked ("Needs: Anvil, Hammer & tongs, a Bloomery"); Charcoal Burner (Industry, Z)
   needs a Lumberjack; Bloomery (X) needs Bellows, 2 Charcoal and a Charcoal Burner.
2. Build a Lumberjack, then a Charcoal Burner (dark campfire stand-in): its info shows "Making: Charcoal (n%)"; after
   ~90 s "Items: ... Charcoal 3".
3. Knap a stone knife, build a Hunter's Hut (or a Pasture): each kill brought home adds a Hide. With 2 hides, "Sew
   bellows (4 wood + 2 Hide)".
4. Build the Bloomery (reddish blacksmith stand-in): it casts an Anvil, then Hammer & tongs, then Iron blooms (uses
   iron + charcoal). The Blacksmith unlocks once anvil + tools are in the items list.
5. With the Blacksmith up and the smelter at level 2, upgrade the Bloomery: blooms now show "(n Good)" in the items.
6. "Send a prospector" in the Build panel (needs pick + knife): after ~150 s a report toast; click a Quarry / Iron Mine
   in range: "Deposit: rich (3/3), +100% yield" (or fair / poor); outside the survey "unknown".
7. Old save with a Blacksmith: it stays buildable (grandfathered), forging still works.

## Progression tree (phase 4: food)
1. New game: Barn is locked ("Needs: Wooden plow"); "Carve a wooden plow (6 wood + 2 rock)" unlocks it. Farm plots
   work as before once the Barn stands.
2. "Boil wheat gruel (3 grain + 1 wood)": Items shows Wheat gruel 3; the next dawn it is eaten first.
3. Dress a millstone (12 rock), build a Mill (Farming tab, pale barn stand-in): flour appears in Items. Build a clay
   oven (8 rock + 4 wood) and a Bakery (warm tavern stand-in): flatbread appears; happiness rises a few points.
4. Once the baker reaches level 2 (info panel), the Bakery spends ~3 game days on "Making: Sourdough starter"; then
   it bakes Bread (the starter stays in Items). Bread in store gives a bigger happiness bump; Good / Fine bread more.
5. At dawn with bread in store, bread goes down before grain.

## Village life: adventure view and heirs (phases 5-6)
1. New Game: the camera is close on your rider (houses fill a good part of the screen), follows smoothly while you
   walk with WASD, never scrolls at the screen edge. Pixel art stays crisp (no shimmer / blur while moving).
2. Wheel zooms a little in / out (not out to the map). Tab (or the top-bar "Strategy" button) eases out to the
   strategy view; Tab / "Adventure" eases back in to the close camera on the rider. Check the minimap, fog (strategy
   only) and that the floor has no holes at the screen edges at both zooms, also on a Huge / Giant map. Note any FPS
   drop at close zoom.
3. Hero bar bottom-left: level, green HP (drops when hit), yellow XP bar, Attack / Interact buttons. Walk next to the
   Town Center and press Enter: its info panel opens; away from buildings: "Nothing to interact with nearby".
4. Select 2-3 soldiers (creative spawn or trained): the command bar shows Follow me / Hold / Shape next to the
   stances. Follow me: they trail you; Hold: they stop; Shape cycles Line / Block / Wedge / Loose. Shift+G / H / Q do
   the same; with nothing selected G / H / Q still pick the Trading Post / Cottage / their build tool. Right-click
   ground / an enemy moves / attacks them.
5. Box-select 9+ soldiers: those buttons hide and "Large force: Tab for full regiment orders" shows.
6. Settings: untick "Close adventure camera", reload: the old wider camera and "Command" button are back. Tick
   "Start in strategy view", reload, New Game: the game opens in strategy view. Also try `?camera=classic` and
   `?view=strategy` in the URL.
7. Die (walk into a camp without godmode): "The Hero Has Fallen" lists your adults (name, job, age). Pick one: you
   rise where they stood, they are gone from the village (their job shows open), your level may drop (half the XP)
   and gold is halved. With no adults left (kill them in creative first), dying shows the game-over screen.
8. Creative mode > World > People: Immigrants adds adults at your Town Center, Children adds babies (Pop rises).
   Creative works the same in both views.

## Solo hero (phases 1-3): talk, gather, needs, skills
1. New Game (normal, not creative). Hero bar: Food / Rest meters and a load "0/40" under the XP bar, a **Pack**
   button. Pack opens a panel right of the hero bar (pack, Eat / Rest / Deposit, Build by hand, Skills).
2. Walk next to one of your villagers and press **E**: a dialogue panel (initial portrait, name, "Your people") with
   "How do you fare?" / "Farewell." Keys 1-2 pick; Esc closes. Walk away while it is open: it closes.
3. Next to a tree, **hold E**: a ring fills over the hero ("Chopping"); every ~3 s 2 wood go in the pack, it repeats
   while held, stops on release or moving. Same on a rock (stone), iron ore, a berry bush / fruit tree / mushrooms
   (fruit; the plant shows picked) and at a pond (fish). Pack panel counts go up; Skills shows Woodcutting etc.
4. Fill the pack past 20 weight: the hero walks slower ("Heavy load"); at 40 gathering refuses. Walk to the Town
   Center, Pack > Deposit: the stock panel's wood / rock go up.
5. Find a human settlement (Hearthmoor etc.), stand by its keep, E: the Elder greets you by relation tier. Try: Let's
   trade (trade panel opens), Do you need help (a quest is posted or "nothing new"), a gift (20 gold; relation up; the
   choice then shows "Already gave a gift today"), Who could teach me a trade (3 masters, 30 gold a level).
   E next to the settlement's walking folk: trader (Buy what I carry), villagers (news: the minimap reveals the camp /
   town named), the priest (quests: accept from the dialogue).
6. Pack > Build: Campfire / Lean-to / Storage chest appear next to you (wood from the pack or the stores). Rest next
   to the lean-to: Rest climbs fast. Deposit next to the chest works away from the Town Center.
7. Needs: after a game day without eating the Food meter drains; carry fruit / meat and it is eaten below half. Below a
   quarter "Hungry" / "Tired" show and you walk slower; HP no longer comes back on its own (it does when fed + rested).
8. Build a Mill (with grain in store), stand next to it, E: "You take up the work..."; the ring shows "Grind flour";
   flour appears in the items, Skills shows Milling. Moving stops it.
9. With a Church and gold, die (creative is easier: godmode off): the picker's first row is "Resurrect at the Church
   (N gold, skills -X%)"; you rise next to the Church with less gold and skills.
10. Creative world: the Food / Rest meters are greyed (needs off).

## Solo hero (phase 4): Solo start, found a camp
1. Main menu: **New Game (Solo)**. The world restarts; you stand alone a short walk from a human settlement (visible
   nearby). No Town Center, no villagers; the stock panel shows 30 gold, 3 meat, 3 fruit.
2. Walk into the settlement: talk to the Elder / trader / villagers (phase 1-3 checks work here too). Gather wood and
   stone (hold E) until the pack holds 20 wood + 10 stone.
3. Pack panel: **Found a camp** is listed; click it on open ground away from the settlement: a Town Center appears next
   to you and two settlers walk out; the button disappears. The first night after that a raid may come (none before).
4. Restart (Menu): still a Solo world. Save and load a Solo game before founding: still no Town Center, you spawn at
   the same start spot.

## Family: marriage, children, succession (phases 1-4)
1. New Game. Hero bar: a **Family** button next to Pack; it opens the hero sheet (family in the right column) ("Unwed", Succession list of your people).
2. Walk to one of your villagers, E: "Spend time with X" and "A gift for X (15 gold)" are listed; both raise the
   courtship (shown in the reply and the Family panel); each greys out for the rest of the day. "Will you marry me?"
   is greyed until 4.
3. Raise a settlement to Friendly (gifts / trade), E at its keep: "Speak of family." names the Elder's kin with the
   same three choices (bride gift 60 gold). After a proposal, talk to that settlement's priest (or your own Church's
   bishop): "Marry us" (10 gold). The kin appears at your Town Center; the Family panel shows the spouse "of <town>";
   the settlement is Allied and its trade prices drop; "Speak of family" now offers "Kin, we need your spears"
   (levies follow you).
4. Creative, World tab "Family": Spouse, then Hero child twice: the panel lists the spouse and two children.
5. Let the hero die (with an adult child: creative child + wait 6 days, or skip to the order check): the heir picker
   lists "(your child, the heir)" first, then the spouse. Pick the child: the Family panel title is the child's name
   "(generation 2)", the old spouse is under Parents.
6. Talk to your spouse: "We should part ways." An in-law spouse leaves and that settlement's relation drops sharply.

## Crafting, Next steps, Progression, Resources, hero sheet, prisoners (2026-11-06)
1. New Game. Top centre: a slim **Next** bar with the nearest goals (e.g. "Hunter's Hut: needs Stone knife (craft by
   hand)"); the health bar sits just below it, toasts below that. Narrow window (< 1400 px): the bar drops under the
   Menu buttons and nothing overlaps. Adventure view (close camera): the bar stays at the top, the hero bar and
   party commands stay at the bottom.
2. Click **Progression ▾** (or the bar's text): a dropdown lists Stone age, Mining & ore, Metal, Food (plow -> Barn ->
   gruel -> millstone -> Mill -> flour -> clay oven -> Bakery -> flatbread -> sourdough -> bread), Cloth, Military
   and Faith as arrow chains. Green = done, gold = available now, dashed = locked with "needs: ...". Knap a stone
   knife: its chip turns green and Hunter's Hut turns gold. Esc closes it.
3. **Craft** button (top right) or **Shift+C**: the Crafting panel lists every hand recipe with have/need per input
   (short ones in red), "needs: ..." under the ones you can't make, and a Craft button; crafting a knife updates the
   counts at once. The Build panel no longer has Next steps or Craft by hand; the prospector button is still there.
   Shift+C with soldiers selected in strategy view still means Charge; plain C is still the build tool.
4. Colony (left) panel: Food / Materials / Crafted & tools / Gear groups list every resource, every progression
   item (Hide, Bellows, Charcoal, Flour, Bread, ...) and armour / weapons per tier; empty rows are dimmed. Click a
   group header to fold it (stays folded after a reload); "Hide empty" hides the zero rows. Kill a deer with a
   Hunter's Hut working: Hide goes up in Materials.
5. Click your own hero (adventure or strategy view), the Hero button or the ` key: one sheet opens, pack and armoury
   on the left, equipment / stats / needs / spells / skills in the middle, family on the right. The hero bar's Pack
   and Family buttons open the same sheet; there are no separate floating panels any more.
6. Walk to a bandit camp: grey captives with a rope loop stand around its fire. Strike the fire with guards alive:
   "Defeat the guards first" and no damage. Kill
   the guards and walk up to the fire: the prisoners are freed ("Prisoners freed: ... join ..."); with no free
   beds the rest wait at the camp (pale, untied figures) and arrive at dawn once you build houses / a Keep.
7. A new world has 2-3 small camps 20-34 tiles from the start and noticeably more camps overall.
8. Militia Camp with no weapons or armour in stock: "Train militia (unarmed: no gear in stock, ...)" is enabled and
   takes one free adult; with a T1 weapon + armour in stock the button says "takes T1 weapon + armour" and uses them.
   Archery Range / Hall of the Sworn / higher militia tiers still need their tier's gear.
9. Kill a camp's guards and strike its fire a few times: only the HP bar above it drops; the fire itself looks the
   same (no second, growing flame on top of it, no soot tint) until it burns out to rubble.


## Night shelter, pasture animals, 2x2 orchards, couples (2026-11-06)
Automated: `cd server && node pastures-night-test.mjs` (own server on :22330, temp saves).
1. Night shelter: start a game, let dusk fall (or creative time skip). Every worker, free villager and child walks to
   its house / Town Center / Keep and disappears inside; nobody stands idle in the open all night. At dawn they come
   back out and the workers go back to their posts. A villager walled in (walls round it) still vanishes indoors.
2. Build menu, Farming: "Cow pasture" (p) and "Pig pasture" (no hotkey) are both 2x2; the Pig pasture shows the cow
   pasture art tinted pink (stand-in). Their info panels read "Cow Pasture" / "Pig Pasture" with "Each batch: 240
   meat + 2 hide" / "320 meat"; the Sheep Pasture "200 meat + 180 wool" (after the food balance, item 5). An old save's pastures are Cow Pastures.
3. Orchard: the ghost is 2x2, it costs 10 wood and its art spans the block (like the pastures); the info panel says
   "2x2 orchard: x4 produce per batch". An old save's 1x1 orchard reads "Old 1x1 orchard: x1".
4. Births: with room in the houses and 20+ food, several children can be born the same dawn in a big village (each
   couple 30% a dawn, at most one child per couple every 5 days); the toast names both parents. Births stop at the
   population cap.
5. Food balance (2026-11-06, FOOD_OUTPUT_MULT 0.5 / FOOD_TIME_MULT 2): a Farm Plot gives +12 grain after ~6 legacy
   days of growing; pastures / orchards deliver half the old batch ("Each batch: 240 meat + 2 hide" for cows) about
   twice as rarely; hunters, foragers and the Hemp Field are unchanged.
10. Select Demolish (Break) and click your own House / Barn / Gate etc.: a small "Demolish Wooden House?" box with
    **Confirm demolish Wooden House** and Cancel appears (bottom centre); Cancel or Esc keeps the building, Confirm
    demolishes it. Wood / stone walls, moats and roads (and trees, rocks) still go at once, no box. Creative too.

11. Spell cooldowns x2 + Spellcasting skill (2026-11-06): hover a spell in the spell bar / hero sheet: Fire Bolt now
    says "cooldown 8 s" (was 4) and a "Spellcasting L1: cast spells to train it" line. Cast spells (creative Hero
    skills sets it to level 4 too): at Spellcasting 2 a toast "Spellcasting is now level 2" shows, the skill appears
    in the hero sheet's Skills list and the Stats "Spellcasting" row, and tooltips show +8% effect / shorter cooldown
    per level (L4: Fire Bolt 37.2 damage, cooldown 6.8 s). Load an old save: Spellcasting starts untrained.
6. Farm labour (2026-11-06): pick the Barn tool: an 8-tile square follows the cursor; the Farm / Hemp tools show the
   squares of nearby Barns. A Farm or Hemp Field far from any Barn: its panel says "No barn in range" and it stays
   sown. Build a Barn: 2 farmers come (3 / 4 at levels 2 / 3) and walk out to the fields; the Barn panel reads
   "Farmers 2/2" and "... 8/8 fields (4 per farmer)"; a 9th field nearby says "Not tended". No field has a worker.
   Load an old save with Hemp Fields: their farmhands become free villagers and the fields grow once a Barn is near.
11. Batch training: a Militia Camp (level 1) with two Houses beside it and 3+ free adults: its panel shows x1 / x5 /
    x10 / **Max (3)** and **Cancel one**. x5 is refused ("Cannot train 5: room for 4, 3 free adults ..."); Max queues
    3: the state line reads "2 training (2 at a time), 1 waiting" with each trainee's percent; Cancel one sends the
    waiting one home (free adults +1, gear back). Archery Range / Hall of the Sworn take a tier weapon + armour per
    trainee up front. Save and load mid-training: the queue and the waiting trainee are kept.

## Gap closure G8: keeps, animal yards, gate passages (2026-11-10)
Automated: `node server/building-templates-test.mjs` (section G), `node server/settlement-templates-test.mjs`.
1. Normal game, Blueprints tab: "Keep (small)" and "Great keep with towers" show "Needs: a Town Center at level 2".
   With a level-1 Town Center the order is refused ("Keep needs a Town Center at level 2"); at level 2 the whole keep
   goes down as blueprints, the Keep tile in the middle of the hall. A second keep near the same Town Center is
   refused ("This settlement already has a Keep"). When built: the Keep panel works as for a prefab Keep, the hall
   room reads "hall".
2. "Chicken coop with yard" (and the sty / pen / livestock yard variants): turn it with R, place it: the fence pieces
   and the gate are blueprints too (2 wood a fence); built, the yard is fenced with the coop inside and the gate opens.
3. "Gatehouse (passage, two guard rooms)" and "Double gatehouse": the passage has a door at each end, the guard
   rooms open into it; the card shows "1 gate passage" / "2 gate passages". Walk through the passage.
4. Creative > building editor: paint a fence yard onto a house: the validator says only animal houses have yards;
   remove one end door of a gatehouse passage: it says the passage needs two outside doors.
5. A new world on a 256 / 512 map may have a **Citadel town**: the Elder is spoken to at the Keep inside the great
   keep's hall (walk in through its door).

## Gap closure G7: settlements turned, quest givers, more templates (2026-11-10)
Automated: `node server/settlement-templates-test.mjs` (sections V, T, S, Q, D).
1. New game on a 256 / 512 map: visit two or three settlements. Some are turned or mirrored (the keep / gates on a
   different side than the editor shows); roads still join the gates, every house door still opens onto ground.
2. In each settlement find the **quest giver** (gold-tinted artisan near the plaza / keep): a gold "!" bobs over
   it. E: a hamlet's is "Reeve X", a village's "Bailiff X", a town's "Herald X", each with its own greeting.
3. **Anything new on the board?**: a quest is posted (or "Nothing new yet"); **What work is posted?** lists it with
   "I'll do it". Accept it: the "!" disappears once nothing waits and the board is on cooldown (about a day).
4. The church's Brother still offers the same quests ("What needs doing?").
5. **Tell me about ...** gives a lore line by settlement type.
6. Look for the new layouts: a hamlet by a stream (mill, fields over the water), hillside hamlet / village (rocks,
   fenced terraces), a village with a stream through it (the road fords it), a moated town (moat ring with four
   drawbridges: walk across a lowered one by day), a market town (big square with stalls).
7. Creative > Settlement editor: the "may turn" / "may mirror" checkboxes save with a template.

## Gap closure G5: living interiors (2026-11-10)
Automated: `npm test -- interiors` (section 11).
1. Walk into two or three of your Houses (and a settlement's): the rooms differ (3 layouts per type); leaving and
   entering the same house again shows the same layout.
2. By day in a settlement's house: the villager strolls about the room, turning left / right as it walks; walk up to
   it: it stops, faces you and a speech bubble pops up ("Oh! Hello."). It does not walk through walls or furniture.
3. Late afternoon (dusk) the villager sits at the table; at night it is lying in a bed with "z z" over it.
4. A Blacksmith / Bakery (yours or a settlement's): the smith / baker stays at the station, swinging (action frames or a
   tilt); the greeting says "Mind the sparks!" / "Fresh loaves today!".
5. A Tavern by day: 2-3 patrons seated at the tables; at night 4-6 (in your own tavern most of them are your
   villagers, plus a traveller). E on a patron: **Heard any rumours?** names a camp / settlement / iron ore with a
   distance and direction (check the minimap reveal); **Buy yourself a drink (3 gold)**: gold -3, rest goes up, the
   happiness readout gains ~2 for a couple of minutes; the 4th drink of a day is refused. The barkeep offers the drink
   too.
6. Tavern / Barracks / Great hall: walk onto the stairs (drawn steps): "You climb the stairs", a small upper floor. At
   night the tavern's guest beds have sleeping travellers, the hall's Elder sleeps upstairs. Esc there: "Take the stairs
   down first"; walk onto the dark stairwell: back down beside the stairs. The chest upstairs is the same chest.

## Gap closure G6: animals (horses, predators, selling, tools, manure, herding) (2026-11-10)
Automated: `npm test -- animals` (sections 14-20).
1. Build a Livestock Barn, buy a stallion (80 gold), wait for day: stand next to it and press E (or **Ride** in the
   panel): "You mount ...". The hero moves ~1.6x as fast; the horse is drawn under the hero (stand-in). Space / a
   hotbar tool says "Dismount first (X)"; walking into a door does not enter. Press **X**: you dismount and the horse
   walks back. The horse's happiness bar drops a little after a long ride.
2. Build a Stables and buy a horse there; a Trading Post's wagon should now cover a trip noticeably faster (x1.25).
3. Panel **Call them in**: the house's animals walk to the door and vanish inside; the line reads "0 outdoors";
   **Let them out** (or the next dawn) sends them grazing again.
4. Craft **Shears** (needs a stone knife) and a **Milk pail** (needs carpenter's tools) by hand. Hotbar 8 (pail) next
   to a cow (or the barn): "+1 milk"; again: "nothing ready yet"; the next day's milk is skipped for that cow. Hotbar
   7 (shears) on a sheep the day before its wool is due: +3 wool. Sheep Pen / Barn chores run a bit faster.
5. After a day, the Barn panel's "Today" shows manure; E collects it (Resources: Manure). Hotbar 9 (manure) on a
   tilled / sown hero plot: "Fertilised" (one manure gone); it ripens ~25% sooner than its neighbour. Villagers sowing
   a growing zone use manure from the stores too.
6. Each animal row has **Sell (price)**: disabled with a hint until you build a Market (or stand near a settlement's
   trader): selling adds the gold to your stores. A trader (neutral or better) has **Sell animals.** in the dialogue.
7. Creative: spawn a wolf next to your coop by day: an animal it reaches dies ("A wolf killed a chicken ...", the
   record is gone); the rest run inside ("Danger near the Chicken Coop") and stay in ~20 s after it is gone.
8. Watch animals wander around walls / a building corner: they slide around it instead of freezing.

## Gap closure G4: season polish (2026-11-10)
Automated: `npm test -- calendar`.
1. Creative: Calendar to Summer 2, setTime noon. Watch the sundial: the day arc is larger than in spring; night comes
   late (about 345 s of daylight) and is short (30 s). Villagers shelter later.
2. Calendar to Winter 2: the day arc is smaller; night falls ~45 s earlier than in spring and lasts 120 s. Raids
   still march at nightfall; the dawn / dusk "next window" countdown matches the earlier dusk.
3. Winter with weather Snow: walk the hero across grass, then along a road, then into a roofed room: grass is a little
   slower (x0.9), the road and the room are not. Units and raiders also slow down in the snow.
4. (768+ map) Pick berry bushes far from home in late autumn, leave the area for a few winter days, come back: they
   are still mostly bare (winter regrowth is a quarter); in summer the same trip finds them ripe.

## Gap closure G3: hand-assign workers (2026-11-10)
Automated: `npm test -- work-priorities`.
1. Build a Hunter's Hut (or Lumber Camp) with 2+ free villagers. Click it: the panel has a **Workers** section: the
   worker (or "1 open post") and **Assign worker ▾**. Open it: free villagers with their hunting skill and what they
   do now. Pick one: they walk to the hut; the panel line reads "⚑ Name: Hunter, ... (assigned)".
2. Work tab: that person's Hunting cell has a ⚑ and the role says "(assigned)". In Manual priorities give them
   farming 1 with a growing zone waiting: after a minute they are still at the hut (a priority-placed worker would go).
3. Click **Unassign**: they go back to the village; someone else fills the hut, not them.
4. Click a free villager: the person card has **Assign to...**: nearby posts (with distance and skill) open for jobs
   they have on; "Replace" where the worker was placed by priorities. Pick one. Click a worker: **Unassign**.
5. Set the assigned person's Hunting off in the Work tab: they leave the hut. Save and load with someone assigned: the
   ⚑ is still there.

## Gap closure G2: stockpile capacity and overflow (2026-11-10)
Automated: `npm test -- zones`.
1. Paint a 1-tile food stockpile next to a wheat field and a bigger one farther away. Harvest: the zone list shows the
   small one's bar fill to 40 / 40 (red, "full"); the rest of the harvest goes to the bigger one.
2. Watch a hauler walk with a load: a sack (grain), a log (wood) or a crate floats above its head.
3. Spend grain (craft gruel, feed people overnight): the stockpiles' "Stored" counts go down (the oldest stockpile
   first). Spend the stock to 0: every tally reads 0.
4. A stockpile painted inside a storeroom (a room with a chest / shelf) holds 60 per tile instead of 40.

## Gap closure G1: room effects, 2-tile furniture, infirmary (2026-11-10)
Automated: `npm test -- rooms` and `cd server && node building-templates-test.mjs`.
1. Build tab: pick **Bed**: the ghost is 2 tiles tall; press **R**: 2 wide. Place one in a room on a floor; the art
   spans both tiles. Try a spot whose second tile is a wall: refused with a toast. Click the bed's second tile with
   demolish: the whole bed goes.
2. **Long Table** (2x1) + a Hearth in a room: Kitchen. **Wardrobe** (1x2) alone in a room: Storeroom.
3. A room with 2 beds + a **Medicine Chest**: the Room panel says **Infirmary**, "Heals ...% max HP / s". Population
   drops by those beds. Hurt a villager (fight a raid): it walks to an infirmary bed and its HP climbs. Craft
   "Dry healing herbs" by hand (3 fruit): herbs disappear while a patient heals (faster).
4. Rest with the hero (hero rest key) inside the infirmary after taking damage: HP climbs faster than in the open.
5. A storeroom (chest / shelf): the panel says "Protects N% of the stock". More chests: higher N.
6. A hall (30+ tiles with a table or rug): the panel shows the social bonus; near dusk villagers stroll into it.
7. A Church built inside a room: the panel says "No devotions"; add a statue or a lamp: faith / heal / resurrection
   lines appear. Die with gold: the resurrection price is lower than before.
8. Blueprints tab: **Hospital / apothecary** has two variants; place one and let the builders finish it.

## Settlement templates: neutral hamlets, villages, towns (2026-11-10)
Automated: `cd server && node settlement-templates-test.mjs` (in-process, no ports, scratch folders).
1. NEW normal game on a 256 or 512 map (older saves keep their old settlements). Scout to a few human settlements:
   they are no longer a keep in an empty yard. A **hamlet**: dirt roads, 3-5 houses (cottages, huts, a granary / barn
   or a chapel and smithy), a well, fields. A **village**: a wooden palisade with one gate, a cobbled green with the
   keep, a chapel, a smithy, a market shop with a stall, a tavern, houses, fields (or ore and rock for a mining
   village). A **town**: stone walls with two gates and corner towers, a cross of roads, a plaza with 4 market stalls
   and the keep, a barracks, a bakery / smithy / tailor / brewery, a tavern, a chapel and many houses.
2. By day the gate opens for you; walk the roads into a house: its roof fades, beds inside. At night the gates shut.
3. Talk (E) at the keep: the Elder answers as before (relation, trade, quests, lodging, family). The trader stands
   on the plaza / road near the keep, the Brother near the chapel. Trade, quests, gifts, vassal tribute, levy work as
   before. Villagers walk between their beds and the fields / ore.
4. Attack a guard: the settlement turns hostile as before; its guards come from posts by the gates.
5. Creative > World > Camps > **Settlement editor**: the list shows the 8 built-ins. Load **Village green**: the
   ground grid plus the buildings drawn over it (blue frames); the stats line reads "Village 27x25 · 9 buildings ·
   9 beds · slots ...". Pick a building in the Building list, **Place building**, click an open patch: it appears;
   right-click it: it goes. Put it on a road: the red list says "covers "_" at x,y". Remove the keep: "exactly one
   keep K". Change the tier to 3: "a town has 15-40 buildings".
6. **Duplicate**, **Save** (file in `server/data/settlements/user/`), **Stamp here** on open ground: a settlement
   appears there (neutral, its own name, garrison, Elder at the keep); on top of a fort / camp it is refused.

## Building templates: Blueprints tab + building editor (2026-11-10)
Automated: `cd server && node building-templates-test.mjs` (in-process, no ports, scratch folders).
1. Normal game, Build panel: a new **Blueprints** tab. Opening it shows a list on the right: 45 buildings with a small
   picture each (floors, beds, furniture, doors, windows drawn with the piece art; walls / stations as coloured
   blocks), "House · tier 1 · 5x5 · bedroom · 2 beds", "Cost: 74 wood", and a yellow "Needs: Stone axe" (or a Quarry
   for stone ones). The type filter at the top narrows the list.
2. Click **Cottage (2 beds)**: the tool switches to "Place blueprint"; a coloured ghost follows the cursor near the
   Town Center; over a tree / building its cells go red. **R** turns it (the door moves round), **M** mirrors it; R / M
   do not switch to the Brewery / Bazaar tools while the blueprint tool is armed.
3. Right-click on open ground: toast "Cottage (2 beds): 25 blueprints placed"; the stock drops by the cost at once;
   builders raise it piece by piece (floors / furniture, then doors, windows, walls). When done the roof appears;
   left-click inside: "Room: Bedroom", population cap +2.
4. Refusals (one toast, nothing placed): on a tree / building ("Something is in the way at x,y"), more than 40 tiles
   from the hero and every Town Center ("Too far"), without the materials ("Not enough materials: needs ..."), a
   stone building before a Quarry ("... needs: a Quarry").
5. Order **Blacksmith (small)** (needs the Bloomery chain; or in creative): accepted although no room stands yet; the
   forge goes up inside its own walls and the room reads "Workshop".
6. Cancel a wall blueprint of an ordered building (right-click a site > Cancel): its 3 wood come back. Order the same
   blueprint again on the same spot: only the missing wall goes down.
7. Creative game > Creative > World > Camps > **Building editor**: the list shows the 45 built-ins. Load one: its grid,
   type, tier, role, door side and boxes fill in; the line under the grid reads its size, rooms, beds, cost, needs;
   "Valid" in green. Paint: remove the door: the red list says "exactly one outside door (has 0)"; put a chest
   outside: "Chest at x,y is outside every room". Rotate / Mirror turn the grid and the door side.
8. **Duplicate**, edit, **Save**: it appears as [user] and in `server/data/buildings/user/<id>.json`; a built-in id is
   refused; **Delete** removes a user one. **Stamp here**, click open ground: the building appears at once, yours,
   roofed, with its stations staffed; on top of something it is refused with a reason.
9. The user template also appears in the Blueprints list after a page reload (the list is fetched once per session).

## New game smoke checklist (RimWorld / Stardew phase 6, 2026-11-10)
One pass over every new system in a fresh normal (non-creative) game, ~20 minutes. Details per system in the sections
below; ROADMAP "RimWorld/Stardew — phase 6" has what was tuned.
1. **Start**: top bar shows 10 people, about 70% happiness, and Grain 80 / Meat 20 / Fruit 40. Under the sundial:
   "Spring 1, Year 1". No red errors in the console (F12).
2. **Structures**: Build > Structure > Wood Room, right-drag a 5x4 room near the Town Center, Wood Door on a wall, Wood
   Floor inside, two Beds. Builders (and free villagers) raise it; a thatch roof appears; the hero walking in fades it.
3. **Rooms**: left-click inside: "Room: Bedroom" around 70/100 with a wood floor (a bare one ~53). Click the Town Center:
   the population cap went up by 2. Next dawn two people move into the beds (the Town Center is only a shelter now) and
   the happiness goes up a few points.
4. **Zones**: Build > Zones > Wheat field, right-drag a 4x3 area: villagers till, sow, tend; ripe tiles are harvested and
   carried to the Town Center (Grain rises in whole units). Add a Stockpile with Food ticked: the next harvest goes there.
5. **Food**: build a Forager's Hut early. Over the first 3 days nobody starves (no "has died" events) and the three food
   kinds do not drop to 0 one after another (people eat from every store in proportion now).
6. **Work tab**: top bar Work: a row per adult, all green checks. Click the Farm header: everyone off, the field work stops;
   click again: back on. Manual priorities on: number badges; a villager with Farm 1 works the field first.
7. **Hero tools**: adventure view, keys 1-6 = hoe, can, seeds, scythe, axe, pickaxe. Hoe + Space tills the faced tile,
   seeds sow (W8 -> W7), can waters (20 -> 19). Energy bar falls; at 0 work is half speed; resting refills it.
8. **Talking**: at a friendly settlement stand next to the Church priest (Brother ...) at the keep and press E: the
   priest answers, not the Elder. Stand right at the keep door: the Elder answers. Two people equally close: a "Who do
   you speak to?" choice.
9. **Calendar**: Creative game > World > Season Winter: the date reads "Winter 1", the ground tints blue-grey, outdoor crops
   die to frost (event), berry bushes regrow slowly (a quarter speed), not never. Rain waters outdoor crops.
10. **Interiors**: walk up into the Town Center from the tile below it: fade into the great hall with your people; E at one
    talks; walk onto the red mat to leave. A House has a bed (sleep until dawn at night) and a chest.
11. **Animals**: with gold (Trading Post), Build > Farming > Chicken Coop, buy 2 hens + a rooster in its panel. E next to
    the coop fills the feeder / trough; next dawn E collects eggs (Resources > Food).
12. **Save / load**: save, change a few things, load: rooms, zones and crops, work priorities, the calendar date, animals
    and the hero's energy come back.
13. **Blueprints** (2026-11-10): Build > Blueprints > Cottage (2 beds), right-click near the Town Center (R / M turn /
    mirror the ghost): every piece becomes a blueprint, the builders raise it; it becomes a roofed bedroom.
14. **Settlements** (2026-11-10): scout to the nearest human settlement: houses, roads, a well and fields round the keep
    (a village has a palisade and gate, a town stone walls and a plaza). The Elder still answers at the keep.
15. **Save / load again** with a blueprint half built and a settlement sighted: the sites, the settlement (name,
    relation, garrison) and its buildings come back.

## Stardew phase 5d: animals living in buildings (2026-11-10)
Normal (non-creative) game, near the Town Center. Have gold (Trading Post / Tavern) and some grain; craft Carpenter's
tools by hand (6 wood + 4 rock) for the bigger houses.
1. Build menu > Farming: **Chicken Coop**, **Livestock Barn**, **Pig Sty**, **Sheep Pen** are there (staged building art;
   tinted barn stand-in if missing). Cow / Pig / Sheep Pasture tools are gone outside creative; placing one in a normal
   game toasts "Pastures are retired".
2. Click the Coop: the panel has an **Animals 0/4** section, feed / water line, "Buy Hen / Buy Rooster (15 gold)". Buy two
   hens and a rooster: gold drops, list rows show Fed / Watered / Happiness / Health bars and the age in days.
3. By day the chickens walk around the coop (bob + flip while moving); paint an **Animal area** (Zones tab) within 12
   tiles: they graze there instead, the panel says "grazing". At night (and all winter) they are indoors (not drawn).
4. A hunger / thirst icon floats over the coop while the feeder / trough is low, an egg icon while eggs wait.
5. Stand next to the coop and press **E**: toast "feeder filled ...; trough filled" (hay first, then grain above 20).
   Next dawn (calendar day): eggs waiting; E again collects them; Resources tab > Food shows Eggs (Materials: Hay).
6. Work tab: a new **Animals** column (egg icon). Set it off for everyone: the Animal Keeper leaves, nothing refills.
   On again: the keeper post refills / collects (free villagers too); the keeper gains Animal Keeper XP.
7. Keep a happy, fed hen + rooster with room: within a few days "A chick was born" (chick sprite, smaller).
8. **Slaughter** a chick: refused; an adult: meat (cows / sheep / horses also hide). **Rename**: prompt, name shows.
9. Creative > World > Winter: animals stay in, feeder empties 1.5x faster, fewer eggs, no births.
10. Livestock Barn: cows (milk daily, Food), horses; Pig Sty: pigs (meat only); Sheep Pen: wool every 3 days. The cavalry
    **Stables** panel also has the animals section (horses only, no keeper post).
11. Taming: with a Pig Sty (room) within 30 tiles, stand by a wild boar with 5 fruit in store and press E: it becomes a
    pig (pheasant + 3 grain -> a chicken in a coop). (Known: the boar leaves a blood stain as if killed.)

## Stardew phase 5c: building interiors (2026-11-09)
Automated: `npm test -- interiors`.
1. New game, adventure view. Walk to the tile just below your Town Center (its door side) and keep walking up into it
   (or press E there with nobody close enough to talk to): a short fade to black, then a stone great hall: walls, floor,
   a long table, banners, hearths, a red mat at the bottom; a title "Your great hall" at the top; the world, the weather
   and your hero on the map are hidden. The hero walks with WASD; tables, hearths and walls block; chairs and rugs do not.
2. Your Town Center's people stand inside with name labels (its builder / workers by the high seat, the people who live
   there by the beds). Walk up to one and press E: the usual dialogue ("Show me the work here." opens the Town Center
   panel, "How do you fare?"). Tab does nothing but a toast ("Step outside ...").
3. Walk onto the red mat: fade, you stand at the door outside. Go in again, stand near the mat and press Esc: out. Esc in
   the middle of the room does not leave (the client only sends it near the mat).
4. Build a House, go in (walk north into it from the tile below it): a small wooden room with a bed, hearth, table and a
   chest. Pack something (gather wood), E at the chest: "Store everything" / "Take ..." choices; the chest keeps its
   goods. Save, load: the hero is outside, the chest still holds them.
5. E at the bed by day: "Sleep until dawn" is greyed ("It is still day"), "Lie down for a while": resting, the Rest and
   Energy bars fill fast. At night (Creative > Day + night, or wait) "Sleep until dawn": dawn breaks at once, Rest and
   Energy full (with a second player connected the night is not skipped).
6. Upgrade the House (House level 2 / Big House): more beds, lamps, rugs, a wardrobe appear inside.
7. A friendly settlement: its Market / Tavern / Smithy (trader at the counter: trade, buy what I carry), Church (Brother
   at the altar: quests), keep (Elder + trader), houses (a villager). No chest of yours there, no bed. A hostile
   settlement: "The door is barred to you".
8. Go into your house with a goblin or a raid near (Creative spawn a few tiles away): refused ("Enemies are too close").
   Inside when a raid comes close: a red "Raiders near the door!" bar; nothing can hurt you inside; the raid's event
   toasts still show. Leave to fight.
9. Two browsers: while one hero is inside, the other sees no rider at that door (minimap dot hidden too).
10. Player-built rooms (Structure tab walls + door) are NOT entered: they keep the roof cutaway as before.

## Stardew phase 5b: seasons, calendar, weather (2026-11-09)
Automated: `npm test -- calendar`.
1. New game: under the sundial a row reads "Spring 1, Year 1" with a spring emblem and "Clear". The grass has a light
   spring tint.
2. Creative game > Creative > World: **Season** Summer / Autumn / Winter: the date jumps (e.g. "Autumn 1, Year 1"), the
   emblem changes, the grass and trees tint (autumn: warm orange trees; winter: pale blue-grey). An event "Autumn
   begins (Year 1)" shows.
3. **Weather** rain: streaks fall over the screen with a light haze; storm: heavier slanted rain + occasional white
   flashes; snow: drifting flakes; fog: a grey veil that eases in. "auto" returns to the rolled weather. The row shows
   the word (only rain has an icon yet). Weather overlay: off hides the effect (stays off after a reload); switching
   to the strategy view (Tab) hides it too.
4. Spring: paint a Wheat field and a Hemp field; wheat sprouts and grows, hemp stays sown ("waits for summer").
   Hero: sow hemp with the seed bag in spring: toast "Sown, but hemp grows only summer ...".
5. Set weather rain: within a second every outdoor sown / growing tile darkens (watered). Next dawn (Creative Day +
   dawn, or wait): they are dry again and villagers go round tending.
6. Build a small wall room with a door over grass (Structure tab), stand inside and till + sow wheat there with the
   hoe. Set Winter: event "Frost: N growing crops died"; the outdoor fields go back to tilled soil, a ripe tile stays
   ripe, the crop inside the room survives and keeps growing slowly (about half speed); rain does not water it.
7. Winter, night (Creative Day + night), the hero standing in the open: the Rest need falls faster than on a summer
   night; resting beside a campfire / in a warm bedroom (Room panel warmth 50+) does not suffer. Colony happiness
   dips a few points on winter nights unless people have warm rooms / shelter.
8. Winter: picked berry bushes regrow at a quarter speed (phase 6; they used to stay picked); an Orchard's farmhand produces no fruit in spring / winter (Summer / Autumn
   it does).
9. Save, change the season, load: the date and a creative weather come back. An older save loads on the calendar day
   matching its day count (day 9 = Summer 2, Year 1).

## Stardew phase 5a: hero tools on tiles (2026-11-09)
Automated: `npm test -- hero-tools`.
1. New game, adventure view, Build panel closed. Above the spell bar: a 6-slot hotbar (hoe, can, seed bag, scythe, axe,
   pickaxe) with an Energy bar under it. Scythe is dim (none in stores); the seed slot reads W8, the can 20.
2. Press 1 (hoe): the slot glows gold. Walk a step: the tile in front of the hero gets a gold outline on grass ("Hoe: Till
   (E / Space / click)"); a white faint outline over a tree / building. Move the mouse around the hero: the outline follows
   the mouse. Press 1 again or Esc: tool away, no outline.
3. Hoe in hand, press Space on grass: a short ring "Tilling", then a tilled brown tile. Energy drops a little.
4. Press 3: seed bag (W). Space: seed dots appear; W8 -> W7. Press 3 again: H0 (hemp); Space on tilled soil: "No hemp
   seeds in your stores (craft them by hand)".
5. Press 2 (can): Space on the sown tile: the soil darkens (watered); the can count drops 20 -> 19. Walk to a river / lake,
   face the water: "Fill the can" -> back to 20.
6. Left-click a grass tile right next to the hero with the hoe: it tills that tile (a click farther away selects / does
   what it did before). With the Build panel open, digits still pick build tools.
7. Craft > Knap a scythe (2 wood + 3 stone). Creative fast-forward (or wait) until a plot is gold (ripe): scythe (4) + Space
   harvests quickly; with no tool in hand, E on a ripe tile harvests slowly. Grain appears in the Pack.
8. Spam tools until Energy is 0: the bar is red, status "Exhausted (half-speed work)", tools still work but the ring fills
   slower. Rest (Pack > Rest, by a campfire is faster) or eat: the bar refills.
9. Axe (5) facing a tree: Space chops once (2 wood) and stops; E held keeps chopping as before. Pick (6) facing a rock: one
   stone.
10. Paint a Wheat field, stand at its edge with the hoe: tilling inside the zone makes zone soil (villagers sow it, no seed
    used if you sow it). Tilled plots outside zones are never touched by villagers.
11. Next to an NPC, E still talks (the tool is not used). Save, reload: plots (stage, watered), energy and the can come back.

## Modular building phase 4: job priorities (2026-11-09)
Automated: `npm test -- work-priorities`.
1. New game. Top bar **Work**: a table of your adults (the child from a dawn birth is not in it). Default mode: every
   cell is a green check; the Town Center builder's Build cell has a green frame ("Builder at Town Center (assigned)").
   Hover a cell: "Woodcutting: on, skill level 1 ..." plus what the job covers. "Doing now" says Idle / Building ...
2. Paint a Wheat field (Build > Zones). Within a few seconds villagers walk over and till it; their "Doing now" reads
   "Farming: tilling". Click the **Farm** column header: everyone off: work on the field stops after the current job.
   Click it again: back on.
3. **Manual priorities: on**: the checks become number badges (3 for most, 1 on the builder's Build). Click a cell: 3 -> 4
   -> off -> 1 -> 2; right-click goes back. Give one villager Farm 1 and everyone else Farm off: only that villager works
   the field; after a while a superscript 1 (farming XP) appears in its Farm cell.
4. Place a few wall blueprints (Structure tab) and give villager A Build 1 / Farm 2, villager B Build 2 / Farm 1: A goes
   to the blueprints, B to the field.
5. Place a Hunter's Hut: the villager with the best Hunt priority (then the most hunter XP) takes it ("Hunter at Hunter's
   Hut"). Set that person's Hunt off: they walk back to the village and someone else with Hunt on takes the hut.
6. Set the builder's Build off: it goes back to the village (the Town Center's builder post is open; with nobody's Build on
   it stays empty, the blueprints wait). Old saves: workers already on posts stay until their job type is set off.
7. Fight off for everyone but one villager, then a Town Center's Call to arms: only that one takes up a spear. A unit
   building's Train shows "No free villager with Fighting on (Work tab)" when nobody has it on.
8. Click a villager in the world (not on a building): the person card (top right) shows name, role, "Doing now" and its
   jobs by priority; Work tab opens the table with that row highlighted. Esc closes.
9. Sort list: "Hunting skill" puts the best hunter first; Shift+click a column header does the same.
10. Save, change some priorities and switch Manual off, load: the manual mode and the numbers come back. An older save
    loads in default mode with everyone on.

## Modular building phase 3: zones (2026-11-09)
Automated: `npm test -- zones`.
1. New game (creative off). Farming tab: no Farm / Hemp Field tool any more (Barn still there). Build menu **Zones** tab:
   Wheat field, Hemp field, Stockpile, Home area, Animal area, Erase zone. Opening the tab shows the zone list panel
   (right) and the overlays.
2. Wheat field: right-drag a 4x3 rectangle on grass near the Town Center: a green translucent area with an edge; trees /
   buildings inside are skipped. The list shows "Wheat field 1, Growing zone, 12 tiles" (selected).
3. Close the menu and watch: free villagers walk over, the tiles turn to tilled soil (furrows), then seed dots, then green
   sprouts (a few minutes), then gold when ripe (~10 min real time at 1x; creative fast-forward helps).
4. Ripe tiles get harvested: a small yellow sack appears on the tile; a villager carries it off to the Town Center (no
   stockpile yet): Grain in the stock goes up by whole units.
5. Stockpile: right-drag a 3x3 area: amber overlay. In the list untick "Everything", tick Food: the next harvest is
   carried to the stockpile ("Stored: N grain") and the stock still counts it. Untick Food: haulers go to the Town Center
   (or the nearest Barn) again.
6. Shift + right-drag across part of the wheat field (or the Erase tool): those tiles leave the zone (crops gone).
   Rename / Delete in the list work. Switch the crop to Hemp: sown tiles go back to tilled; hemp ripens into dark green
   and its harvest adds Cotton (cloth).
7. Home area: paint a patch away from the Town Center: idle villagers wander there during the day. Animal area: paints,
   no effect (placeholder).
8. Barn: a Barn with no old fields: its farmers work the growing zone (faster than villagers). An old save with Farm Plots
   and Barns: the fields still grow and are tended as before; the Barn panel is unchanged.
9. Save, reload: zones, crop stages, sacks and stored counts come back. An older save loads with no zones.
10. Creative mode: the Farm / Hemp Field tools are back and place as before.

## Modular building phase 2: rooms and quality (2026-11-09)
Automated: `npm test -- rooms`.
1. New game. Build a Wood Room (5x4) with a door and a Bed. Left-click bare ground inside: the panel shows **Room:
   Bedroom, Decent (~51/100)** with Size / Beauty / Cleanliness / Warmth bars (hover a bar: what it counts), the
   contents ("1 Bed"), the effects ("Sleep quality ...", "A hero resting here ...") and tips (lay a floor, add a hearth).
2. Structure tab: Table, Chair, Chest, Shelf, Hearth (Quarry), Lamp (Iron Mine), Rug (Sheep Pasture; right-drag fills),
   Workbench, Statue (Quarry), Weapon Rack (Iron Mine). Each has stand-in art. Lay a Wood Floor, a Rug and a Lamp in the
   bedroom: Beauty and Warmth go up, the score climbs (re-click or keep the panel open: it refreshes every second).
3. Roles: a room with a Table + Hearth says **Kitchen / dining**; a Workbench makes it a **Workshop**; 3 beds + a Weapon
   Rack a **Barracks**; a Chest a **Storeroom**; a big room (>= 30 tiles inside) with a rug a **Hall**.
4. Bakery / Blacksmith (with creative off): placing one in the open says "needs a roofed room"; build a small room first
   and place it inside (on bare ground or a floor): it goes up and the room becomes a Workshop ("Station speed x...").
   An old save's Bakery / Blacksmith out in the open keeps working; upgrading it works as before.
5. Walk the hero in and out of a room for a while: its Cleanliness drops a little, then recovers when nobody is inside.
6. Happiness: with a kitchen standing, the colony happiness (top bar) is a few points higher than before it was built.
7. Hero: rest (heroAction rest) inside a nice bedroom: the rest bar fills faster than outside.
8. Save, reload: the room panel shows the same role / stats (dirt kept). An older save loads unchanged.
9. Creative mode: the Bakery / Blacksmith place anywhere.

## Modular building phase 1 (2026-11-09)
Automated: `npm test -- structures`.
1. New game. Build menu: a **Structure** tab holds Wood / Stone Wall (keys 1 / 2 still work), Wood / Stone Room,
   Wood / Stone Door, Wood / Stone Window, Wood / Stone Floor, Bed. Combat no longer lists the walls; nothing else moved.
2. Wood Room: right-drag a 5x4 rectangle a few tiles away (further than you could click before): a blue outline
   previews it; on release blueprints appear, wood leaves the stock, builders walk over and raise the walls.
3. Wood Door: right-click a wall tile of the room: the wall becomes a door blueprint, then a door. Walk into it: it
   opens (leaf swung) and closes behind you. Wood Floor: right-drag inside: planks fill the room. Bed: place 2 inside.
4. Once the walls and door stand, a thatch roof covers the room (units inside hidden under it). Walk the hero in:
   that roof fades out; walk out: it comes back. With any Structure tool selected all roofs are see-through.
5. Click the Town Center: the population cap went up by 2 (one per bed). Click a bed / wall: its info lists the room
   (size, roof, beds). A bed out in the open adds nothing ("Not in a roofed room").
6. Place a few blueprints, click one: **Priority: off** / **Cancel (refund ...)** buttons. Toggle priority (builders go
   there first), cancel one: it vanishes and the wood comes back.
7. Wood Window: cut one into a wall: the room keeps its roof. Stone Room + Stone Door (needs a Quarry): tile roof.
8. At night, wait for a raid: monsters do not walk through the closed door; they break it (or a window / wall) to get in.
   After it breaks the roof goes (the room is open); rebuild the door and the roof is back.
9. Old walls, gates, moats and drawbridges still place and work as before; a gate in a small empty walled square makes
   it a roofed room (expected).
10. Save, reload: rooms, roofs, doors, beds and the population cap are the same. Load an older save: it loads unchanged.
11. Creative mode: Structure pieces build at once, free; progression: in a normal new game Stone Door / Window / Floor
    show "Locked. Needs: Quarry" until one stands.

## Bandit camp templates + camp editor (2026-11-09)
Automated: `cd server && node camp-templates-test.mjs` (in-process, no ports, scratch folders).
1. New game (any size): walk / scout to a few bandit camps. They are no longer all a campfire with 1-3 props: you
   see tent circles, fenced captive pens, rubble-and-grave hideouts near the start; palisade rings with a lantern
   watch post, wagon laagers and crossroads camps further out; big stockades / twin palisades / warcamps far out
   (more guards, elites). Camps are often turned or mirrored. Every camp's hearth can be reached on foot.
2. Attack a camp: "Defeat the guards first" until its guards fall, then the hearth burns: the camp's crates,
   barrels, carts, fences, tents and watch posts within its footprint burn away (graves / rubble stay). A camp with
   a loot chest pays more gold (+25 per chest) in the plunder toast. Walk up to an unguarded hearth: its prisoners
   are freed (never more than the camp's prisoner slots).
3. Load an older save (made before this change): it loads; its camps keep their old look and burn as before.
4. Creative game > Creative > World > Camps: **Camp editor** opens a panel at the top left. The template list shows
   the 10 built-ins ("name · T1 w3 [built-in]"). Pick one, **Load**: its grid, tier, weight, min dist, guards,
   entrance arrow and rotate / mirror boxes fill in; the stats line reads its size, radius, guard / prisoner /
   loot slots; "Valid: ready to save / stamp" shows in green.
5. Paint: pick a brush (Palisade, Tent, Watch post, Crate, ..., Guard / clubman / archer / elite, Prisoner, Loot
   chest, Hearth), left-drag on the grid; right-drag erases. Placing a Hearth moves it. Wall the hearth in
   completely: the red list says "the hearth is walled in"; open a gap: it goes green again. Change Grid size
   (9x9 ... 31x31): the drawing stays centred. Rotate / Mirror turn the drawing and the entrance arrow.
6. **Duplicate** a built-in: id becomes "<id>-copy". Edit it, **Save**: toast "Camp template ... saved", it appears
   in the list as [user], and the file is in `server/data/camps/user/<id>.json` (the panel's last line names the
   folder). Saving under a built-in's id is refused. **Delete** asks to confirm and removes a user template;
   built-ins can't be deleted.
7. **Stamp here**, then click open ground: the drawn camp appears with its hearth on the click (trees / rocks in
   the way are cleared), guards stand on the guard slots; stamping on water, a building, a fort or another camp is
   refused with a reason. The stamped camp fights / burns / frees prisoners like a world-gen one.
8. A user template with weight > 0 is also placed by world-gen in NEW worlds (restart a game and look for it).


## RimWorld / Stardew structure art + HUD icons (2026-11-09)
Art made by `art-sources/rimworld-stardew/wire_sprites.py` into `client/public/sprites/{structure,icons}/` (registry:
`client/src/spriteRegistry.ts`). Creative game, Structure tab, near the Town Center:
1. Right-drag a **Wood Room** and a **Stone Room** (about 7x5). Walls look as before (unchanged autotiling).
2. Cut a **Wood Door** / **Stone Door** into a south (east-west) wall: a plank door (wood) / an arched door in a stone
   arch, drawn ON a wall straight at the same height as the neighbouring wall pieces, no gap. A door in a west / east
   (north-south) wall: the narrow column with a squashed door. Walk the hero through: it shows open (dark doorway
   with the leaf against the jamb for wood; the swung leaf for stone), then closed again.
3. **Wood Window** / **Stone Window** in both wall directions: a glazed window set into the wall piece.
4. **Wood Floor** / **Stone Floor** inside: plank / flagstone tiles, 3 variants mixed per tile, no obvious repeats.
5. Furniture inside each room: Bed, Table, Chair, Chest, Shelf (bookshelf), Hearth (lit fireplace), Lamp
   (candelabra), Rug (red rug with gold border, flat under everything), Workbench, Statue, Weapon Rack. Each sits on
   its tile, upright and bottom-aligned, about one tile wide; tall pieces (shelf, statue, lamp) poke up into the tile
   above like the walls do, never drift off their tile.
6. Roofs: wood rooms get thatch, stone rooms clay tile, fully solid with the Build panel shut (fixed 2026-11-09: they were
   always at 45%), the pattern running on across tiles (no per-tile banding); they fade while the Build panel is open with
   a Structure / Zones tool and almost vanish when the hero is inside.
7. Blueprints (non-creative game, or a cancelled-instant build): a planned door / floor / bed shows its new art
   faded + tinted (the code overlay), not a blue rectangle.
8. Click a floor inside a room: the Room panel heading has the role badge (bedroom: bed shield, kitchen, workshop,
   barracks, storeroom, hall, church; a plain "Room" has none); the Size / Beauty / Cleanliness / Warmth rows each
   have a small icon.
9. Zones tab > a stockpile zone: each filter checkbox has its icon (food, wood, stone, ore, metal, cloth, tools,
   weapons, armour; "Everything" / "Other goods" have none).
10. Resources panel: Stone axe / Stone pick / Hammer & tongs / Flour and the Gear rows (weapons, armour) show icons
    instead of the lettered chip.
11. Fallback: rename `client/public/sprites/structure/bed.png` (dev server): the bed falls back to the old
    procedural blue bed, nothing else breaks; restore it.


## Autumn art integration — 2026-11-11
Check new-game human scale, each troop tier walking/attacking, cardinal hero tools, mounted rider/horse alignment, crimson hit flashes, building damage/repair, H/V walls and doors, night interiors and livestock movement. Inspect /sprite-preview.html for cave walls and floor joins. Private browser smoke check passed without JavaScript or missing-image errors; individual poses still need normal gameplay review.


## Hero wardrobe and menu refresh — 2026-11-11
1. Open Hero: choose each of the six origins and a horse coat; confirm the two previews and world appearance update. Check at 900px width and navigate equipment with Tab/Enter.
2. Withdraw a weapon type and T1–T3 armour from the existing armoury stock, then equip from Pack. Confirm stats, icons, armour silhouette and attack animation update; unequip to revert.
3. Buy an adult horse in a Stables/Livestock Barn; use its Ride action nearby or interact with an outdoor horse. Confirm the chosen coat, single horse/rider, walking and attacking; X returns to the on-foot appearance and normal speed.
4. Use tools on foot, enter/leave an interior, take damage and confirm the existing crimson hurt effect. Mounted tools remain restricted by the original rules.
5. Bow: attack a hostile target up to five tiles away; an intact wall or closed gate blocks it. Spears have 1.5x the original melee reach; other weapons retain melee behavior. Gear tier still determines stats through the existing system.
6. Save/load and reconnect; verify wardrobe/equipment persist. A second client should see the same selected appearance. Horse coats are cosmetic riding appearances, not new livestock breeds or stat bonuses.

## Autumn art audit — 2026-11-11 (visual checklist)
1. New game, zoom in close: spearmen, pikemen and knights at T1 / T2 / T3 stand the same height as militia and
   workers; no floating feet or spear tips above anyone; children have no skirt hem above their heads.
2. Walk and swing with the hero (on foot): the body keeps its size through the swing and every tool (axe, pick, hoe,
   scythe, watering can, four directions).
3. Ride a horse: the rider sits on the saddle, not squashed; walking keeps rider and horse together.
4. Workers chopping / mining / building / harvesting: same size as when they walk; bandits and town folk the same
   size as your villagers (the bandit elite a little taller).
5. Lay a dirt road loop with a T and a cross, a cobble road, and a moat ring: no dark grid between tiles, all four
   corners turn the right way (bottom-left was wrong).
6. Ground: no light / dark checkerboard on grass; ponds and roofs show no tile grid.
7. Props: campfire is a stone ring with a flickering flame, Charcoal Burner a campfire, cross a stone cross, fence a
   rail fence, lantern post a hanging lantern, archer tower a tower (not a range). Pastures use the old art.
8. Wolves, spiders, goblin riders, deer, rabbits and boars: whole bodies, no ears / legs of another animal nearby.
9. Open /sprite-preview.html: pick a sheet and row, the animation plays with the feet on one line; the hero in the
   cave scene is not squashed.

## Performance plan — 2026-11-17 (browser checklist; plan in ~/docs/colony2d/PERF-PLAN.md)
Open the game with `?perf=1` (e.g. `http://localhost:5173/?perf=1`); a small readout shows frame ms, the gap between server
snapshots, parse time, main-thread stalls over 50 ms, and unit / display-object counts. P hides it.
1. Atlas / load time: `npm run dev` (or live.sh update) prints "atlas: 4540 sprites -> 5 sheet(s)". Open the browser Network
   tab: the page should load about 5 `/atlas/sheet-*.png` files and `manifest.json` instead of ~4,500 `/sprites/*.png`. Note
   the time from opening the page to the menu. Look at every screen for wrong or garbled sprites, a thin line at sprite
   edges, or a whole sheet drawn instead of one sprite (hero menu, creator, buildings, interiors, animals, wall / road
   tiles, UI icons). If anything is wrong: delete `client/public/atlas/` and reload; the game falls back to single files.
2. Culling: zoom out and pan over a big army or a busy village; nothing should pop in at the screen edge or vanish while
   still on screen. `display objects` in the readout stays high (they exist), but frame time should drop.
3. Dot view (now on by default above 400 units when zoomed out below 0.6): in a big fight the soldiers / goblins show as
   blue (your clan) and red dots; zooming in restores sprites and health bars. `?battleLod=0` turns it off. Report if the
   dots flicker, lag behind the units, or leave a ghost sprite after you zoom in.
4. Record numbers for a big battle (spawn one with creative mode, or a raid): frame avg / worst, snapshot gap avg / worst,
   long tasks. A steady snapshot gap near 50 ms with a bad frame time = client problem; a wobbling gap = server / network.

## Deep mines (2026-11-18)
1. New game: the minimap shows near-black (coal), orange (copper) and pale blue (tin) specks; on the map they are tinted
   rock / ore tiles. Build a Coal Mine on a coal seam (Industry tab): refused on bare ground; a miner digs coal.
2. Walk to any mine's door (below it) and press E: a dark tunnel room with ore faces (flecked in the ore's colour),
   timber props and lamps (level 2+); your miner works at the face. Walk onto the mat / Esc to leave.
3. Raise a Quarry / Iron / Coal Mine to level 2 (timber props, a level-2 miner) until one reports "broke into a nest"
   (35%; try several). Its panel says Infested; its miner walks off to shelter; nothing is dug.
4. Go in: red HUD line "Infested: N monsters left"; spiders / bats / skeletons (tinted stand-ins) sleep with "z z"
   and hp bars. Walk close: they wake and bite (your HP drops). Space swings (slash arc); they flash red, die; you get
   "slain: 2 coal, bones..." toasts. Last one: "cleared by you (+20 gold)", the miner comes back and digs.
5. Infest another, stand 2+ soldiers near it, open its panel: "Send soldiers in (N)"; press it: cleared or driven out.
6. Let a monster kill you inside (low HP): you end up outside, not stuck in the mine.
7. Level 3 needs Air vent + Bucket pump (Craft by hand) and a Blacksmith. Over several days watch for "Cave-in" when out
   of timber props and "flooded"/"Bad air" if you remove the vent/pump; deep mines may get monsters back at dawn.
8. Save, reload: an infested mine stays infested with the same monsters; deposits stay.
9. Art check: are the stand-ins (cave spider = small brown giant spider, bat = tinted half-latch, ore faces) readable?

## Winter: heating fuel and clothing (2026-11-19)
Use a normal (seasons on) game; Creative "set season / day" jumps the calendar.
1. Colony panel, under the calendar: a row "Fuel: N days (x/day)" and "Need clothes: N". Hover each: heat in store,
   homes, people dressed. Build a house or two: the x/day grows (House 1, Big House 2, Town Center 2).
2. Jump to Autumn: an event "Winter needs: ... more fuel ..., warm clothes for N people" and the same red line in the panel.
3. Jump to Winter 1 with wood in stock: wood drops by the x/day at dawn; no "Cold homes" event.
4. Sell / spend the wood (and coal / charcoal) down to 0, next winter dawn: "Cold homes: no fuel for N homes" event,
   the panel says "N cold homes" in red, Happiness drops ~10, villagers' hp drops a little. Click a villager: badge
   "Cold home: no fuel".
5. Put coal in store (Coal Mine) with little wood: coal goes first and lasts twice as long per unit.
6. Build a Tailor Shop with cloth + wool in store (and hides): its worker sews Winter coats / Boots / Wool tunics
   (building panel "Making: Winter coat"); they appear under Crafted & tools and are taken by villagers within seconds.
7. Click a villager: "Wears: Winter coat (Poor, 100%)" or a blue "Needs warm clothes" badge with the snow icon.
8. In winter, a villager without clothes out at work: badge "Freezing: needs warm clothes"; it walks visibly slower.
9. The hero: in winter with no garments in the stores, walk outside away from the houses: the status line shows
   "Freezing: no warm clothes" and you walk slower; once a coat is in the stores the hero takes it and the line goes away.
10. Save and reload in winter: cold homes, wardrobes and the panel row are unchanged.
11. Art check: is the snow-icon badge readable on the card? Is the panel row too long on a narrow window?

## Agriculture extras (2026-11-19)
Use a normal (seasons on) game; Creative "set season / day" jumps the calendar.
1. Colony panel, under the winter row: "Raw food spoils 5%/day" (red) and "Healthy". Hover: raw / fresh / dry rates and
   "no Cellar, no pots, no storeroom".
2. Fire 15+ clay pots at the Kiln: the rate drops to 3.5%. Build a Cellar (Farming tab, needs 6 bricks): it drops again;
   click the Cellar: "Cellar level 1: food spoils 30% slower"; upgrade it and the line / rate change.
3. Salt Works: try it on dry ground (refused: needs water within 2 tiles), then beside a pond with 2 clay pots in store;
   a salter boils Salt (Resources panel).
4. Smokehouse (needs a Hunter's Hut): with salt in store Salted meat appears, without salt Smoked meat; raw meat in the
   stock goes down. Food variety (happiness) does not drop when all the meat is smoked.
5. Dairy (needs a Livestock Barn) with hides and milk: Rennet, then Cheese.
6. Leave only raw meat to eat for a day or two: at dawn "N people fell sick from bad food"; click one: "Sick: bad food"
   badge; the panel says "Sick: N" in red; Happiness drops a little. They recover after 2 dawns on smoked meat / grain.
7. Bakery with a level-2 baker and a sourdough starter: remove the baker (or demolish the post's worker) for 3 days:
   "The sourdough starter is lost" event; the Bakery panel showed "untended N of 3 days" meanwhile.
8. Let bandits set a Bakery on fire (below half HP): the starter is lost.
9. Blacksmith with 2 iron blooms in store: "Making: Iron plow" in its panel, then an Iron plow under Crafted & tools;
   a Barn's panel says "Iron plow: fields grow +25% faster, yield +25%".
10. Paint a Growing zone and set its crop to "Hops (ale)" in the zone list (name "Hop field N"); in summer villagers
    sow / harvest it and Hops appear in the Resources panel. The hero's seed bag key cycles wheat / hemp / hops.
11. A Brewery with hops in store makes Ale; Happiness goes up a few points; ale goes down each dawn.
12. Plant a new Orchard: its panel says "Orchard age: 0 years: fruit x0.25"; an old save's orchard says 2 years, x1.
13. Save and reload: sick people, the starter, the orchard's age and the Cellar level are unchanged.
14. Art check: Salt Works (tinted campfire), Smokehouse (tinted tavern), Dairy (tinted barn), Cellar (tinted quarry), hop
    crops (tinted hemp): readable? Is the new Colony panel row too long on a narrow window?

## Industry extras (2026-11-19)
A normal game (gates on); Creative "Unlock all" off. The new buildings are in the Industry tab (button only).
1. Build menu: Foundry "needs: Crucible, a Copper Mine"; Stamp Mill "needs: Carpenter's tools, an Iron Mine"; Lime
   Quarry "needs: a Quarry"; Gold / Lead Mine "needs: an Iron Mine"; Glassworks "needs: a Kiln, a Stamp Mill"; Mint
   "needs: a Stamp Mill, a Blacksmith". Tooltips list inputs and outputs.
2. Minimap of a new world: off-white (limestone), yellow (gold) and slate (lead) specks besides coal / copper / tin. On
   the map the deposits are tinted rock / iron-ore tiles.
3. Lime Quarry / Gold Mine / Lead Mine: refused off their deposit ("must be sunk on a ... deposit"); built on one, a miner
   digs Limestone / Gold ore / Lead ore (Resources panel); press E on the mine: a mine interior with pale / gold / slate
   ore faces.
4. Foundry with copper and tin ore and charcoal: Bronze, then Bronze tools, Bronze weapons (no Bronze armour item since
   2026-11-19: tier-1 armour is forged from bronze at the Blacksmith, see "Bronze tier-1 armour" below).
   With bronze tools in store the hero chops / mines visibly faster.
5. With no iron weapons in the armoury, train a knight: click it: its stats show more damage than an unequipped one;
   Bronze weapons in the stores go down. Forge an iron weapon: the knight swaps (stores' bronze weapons go back up).
6. Stamp Mill: refused on dry ground; beside water: gold ore -> Gold dust, tin ore -> Washed tin, stone -> Sand. The
   Foundry's bronze from washed tin is 3 a batch.
7. Bloomery level 1 with a smelter, limestone and blooms: its panel says "Steel: needs a level-2 Bloomery"; upgrade to a
   Blast furnace (level-2 smelter): Steel appears (Good with a level-2 smelter).
8. Get Fine steel (level-3 furnace + level-3 smelter, or Creative): the Blacksmith's forge buttons read "T1 (T2 with Fine
   steel)"; forging uses one Fine steel and the armoury gets the better tier.
9. Glassworks with sand, limestone and charcoal: Glass, Window glass, Bottles. With 4+ window glass, open a room with
   windows (Room panel): warmth up, beauty up; the cold tip no longer says "fewer windows". With 4+ bottles and ale in
   store Happiness rises a little more.
10. Mint with gold dust and charcoal: the treasury (gold) goes up 20 per batch (more for better grades); no Coins pile.
11. Lead Mine + Foundry (no copper / tin): Lead; Kiln with clay and lead: tableware comes out Good from a level-1 potter.
12. Save and reload: the new buildings, items, bronze on soldiers and unlocks are unchanged.
13. Art check: Foundry / Glassworks (tinted blacksmith), Stamp Mill (tinted barn), Mint (tinted tavern), the three mines
    (tinted quarry / iron mine), the three deposits: readable and distinct enough?

## Tree felling (2026-11-19)
1. New game, hero with the stone axe: walk up to a tree and hold E (or use the axe, key 5): the progress ring reads
   "Chopping 1/5" (sapling 1/2, large tree 1/10) and counts up each swing; the pack's wood does NOT rise per swing.
2. Keep chopping: on the last chop the tree disappears and a toast says "Tree felled: +3 wood" (sapling +1, large +6);
   the pack shows the wood. Chopping stops by itself.
3. Chop a large tree 3 times, walk away for over a minute, come back: the ring restarts at 1/10 (progress decays).
4. Chop a tree twice, save, reload: the ring continues at 3/5 (progress is saved).
5. With a nearly full pack (e.g. 39/40 weight), chop a tree: the swings still count until the felling chop, which
   is refused with "Your pack is full" (the tree stays standing at N-1, ready to fell once there is room).
6. A Lumberjack post: watch the lumberjack: it stands at one tree for several chop cycles (longer for big trees) before
   the tree vanishes and it walks home; the wood stock rises only when it gets back (1 / 3 / 6 by tree size). Wood
   income from lumberjacks is noticeably slower than before.
7. Hero and lumberjack on the same tree: the swings add up; the tree falls once and only whoever lands the last chop
   gets the wood (no double payout).

## Bronze tier-1 armour (2026-11-19)
1. Blacksmith with a level-2 smith, no bronze in store: the building panel's armour button reads "Forge Bronze Armour T1",
   cost "3 bronze, 15s", disabled with "Not enough bronze (smelt it at a Foundry)". The weapon button still costs iron.
2. Smelt bronze at a Foundry (copper + tin + charcoal), then forge the armour: 3 bronze leave the stores (Items panel),
   iron is untouched; the armoury gains a tier-1 armour piece. Upgrade the Blacksmith to level 2: armour T2 costs iron
   (+ tools / wood) as before, no bronze.
3. Forge autocraft on a level-1 Blacksmith with no bronze: the status says "... or no bronze for armour"; weapons still get
   forged to target. Give it bronze: armour gets forged too.
4. Train a knight with tier-1 armour in the armoury: it takes it (less damage taken, as iron T1 used to be).
5. Character sheet -> take tier-1 armour from the armoury: the pack gets a "Bronze Cuirass" (chest, -15% damage taken);
   as head armour a "Bronze Helm", as off-hand a "Bronze Shield". Equip it: it shows on the hero and the stats apply.
6. Hero's own forge (walk up to your Blacksmith / anvil, E -> Craft): "Forge tier 1 bronze armour ×1 ... 3 bronze".
   Without bronze it says "Needs Bronze".
7. The Foundry no longer offers "Cast bronze armour"; its tooltip says bronze is what the Blacksmith forges tier-1 armour
   from. The Progression panel's Bronze chain ends at the Blacksmith.
8. Creative mode: forging tier-1 armour is free like other costs.
## Layered mines (2026-11-19)
1. New game: the build menu shows "Mine" and "Quarry" only (no Coal / Copper / Tin Mine, Lime Quarry, Gold / Lead Mine).
   The Mine says it needs a Quarry; build a Quarry on rock, then a Mine on iron ore or a coloured deposit. On grass it is
   refused ("must be sunk on ore ground"). Demolish one on a deposit: the deposit comes back.
2. The new Mine announces a nest; its panel reads "Level 1 (copper ore, tin ore, limestone): Infested". Walk to its door,
   E: the HUD reads "Level 1 of 1 (copper ore, tin ore, limestone) · Infested: n monsters". Fight them (Space): weak bats
   and spiders. Cleared: copper, tin and limestone start arriving (Items panel).
3. Foundry (crucible + the Mine): it casts a bronze Anvil and Hammer & tongs first. The Blacksmith then builds (no
   Bloomery needed); its panel shows "Anvil tier 1 (bronze: ...)". It forges a Bronze pickaxe from 3 bronze, never an Iron
   pickaxe at level 1.
4. Upgrade the Mine (timber props + bronze pickaxe in store): a new nest on level 2. Inside, level 1 now shows the Mine's
   sprite in the room: walk onto it to climb down (toast, HUD "Level 2 of 2"); the monsters here are tougher (skeletons,
   giant spiders). Walk onto the mat to come back up beside the sprite. Level 1 keeps producing meanwhile.
5. Clear level 2 (or "Send soldiers in" next to the Mine): iron ore and coal arrive too.
6. Upgrade the Blacksmith to level 2 (needs a Bloomery): it forges an Iron pickaxe from blooms. With the iron pickaxe,
   air vent and bucket pump, upgrade the Mine to level 3: the strongest nest (5-7 monsters); cleared, gold and lead ore.
7. Over a few days, level 2/3 may get monsters back (panel odds); level 1 never does. The Quarry behaves as before.
## One furnace, bronze tier-1 gear (2026-11-19; supersedes the Foundry steps above)
1. New game: no Foundry in the build menu. Bloomery tooltip lists bronze, iron bloom, lead and gold dust and says it needs
   2 Charcoal, 8 Bricks and a Charcoal Burner (no iron, no bellows). Upgrading it to level 2 (Blast furnace) asks for
   Bellows (sewn from 4 wood + 2 hides), a Crucible and a Blacksmith.
2. Mine level 1 cleared + Bloomery with charcoal: copper and tin turn into Bronze; the smelter casts Hammer & tongs,
   Bronze tools and a bronze Anvil from it (Items panel).
3. Blacksmith: "needs: Anvil, Hammer & tongs, a Bloomery"; its cost is wood + rock (no iron). Panel: "Anvil tier 1
   (bronze: bronze pickaxe, tier-1 (bronze) weapons and armour)". With a level-2 smith: "Forge Bronze Weapon T1" costs
   "1 wood, 2 bronze", "Forge Bronze Armour T1" "3 bronze"; with no bronze both are disabled with "Not enough bronze
   (smelt it at a Bloomery)". Iron in the stores does not change.
4. Soldiers in the Hall of the Sworn pick up the T1 weapon / armour from the armoury stock (Army panel); no "Bronze
   weapons" item appears anywhere (Items panel).
5. Hero: the workstation forge at a Blacksmith lists "Forge tier 1 bronze weapons / bronze armour" with bronze costs.
6. Mine level 2 (bronze pickaxe): iron ore and coal arrive, the Bloomery makes Iron blooms; the Blacksmith's level-2
   upgrade now asks for an Iron bloom in store. Mine level 3: lead ore becomes Lead at the Bloomery (Kiln glazes with it),
   gold ore becomes Gold dust there too (slower than the Stamp Mill).
7. Progression panel: the Mining & ore / Bronze / Metal chains go through the Bloomery; none shows the Foundry.
## Mining: risk preview, hero digging, Foreman, crafting caps (2026-11-20)
1. Risk preview: open a new Mine's panel (level 1 cleared). Under the Upgrade button a box reads "Digging to level 2:
   nest risk Certain (100%), strong nest" in red, with lines: 3-5 cave spiders, skeletons, giant spiders (hp and bite
   x1.3); nests return 25% every 2 days; timber props wear; how many soldiers could be sent in. At level 2 the box shows
   level 3 (Certain, deadly, x1.7, bad air / floods). At level 3 the box is gone.
2. Quarry panel at level 1: the box reads "nest risk Medium (35%)" in amber; at level 2 "High (65%)" in red.
3. Confirm step: with the box showing, click Upgrade once: nothing is dug, the button reads "Confirm: dig to level N"
   for about 6 s; click again within that time: the upgrade goes ahead (event about the nest). Wait 6 s instead: the
   button goes back to "Upgrade". Other buildings' Upgrade still works with one click.
4. Mine Foreman: a Mine at level 2+ with a level-3 miner posted shows "Mine Foreman: <name> (level-3 miner): ..."; without
   one "No Mine Foreman (post a level-3 miner here): ...".
5. Hero digging: go into a cleared Mine (E at the door), walk to an ore face (top row, the dark ore tiles) and use it (E /
   click): the workstation menu lists "Dig copper ore / tin ore / limestone x2 - 20s". Pick one, stand still: after 20 s
   "Dig copper ore complete: +2 to your stockpile" and the Mining skill rises. On level 2 (down the shaft) the face offers
   iron ore and coal (needs the Bronze pickaxe in store), level 3 gold and lead ore (Iron pickaxe).
6. Refusals: an infested level's face says "Clear the nest on this level first"; at the cap (e.g. 60 copper ore in store)
   "Copper ore: 60 in store (enough: the cap is 60)"; outside, standing next to the Mine, E still enters it (no menu).
7. Cave-in: with no timber props in store, dig on level 2 a few times: now and then (1 in 5) "Cave-in! ... you are hurt"
   (HP drops by a quarter), no ore, and the Mine is closed for the day (panel "Cave-in: closed today"; the face refuses).
8. Crafting caps (all workstations): with 20 Iron blooms in store, the Bloomery's workstation menu greys out "Iron bloom"
   with "Iron bloom: 20 in store (enough: the cap is 20)"; with 40 charcoal the Charcoal Burner's batch is greyed out the
   same way. A batch started at 19 that reaches the cap meanwhile ends with that message and no output (inputs kept).
9. Standing in a shaft (no digging): with no timber props in store, stand in a Mine's level 2 or deeper. Once per game
   day there is a 1 in 5 chance of "Cave-in! No timber props in store ... you are hurt and the Mine is closed today"
   (a quarter of max HP, never below 1 HP, never twice in a day). At level 3 with no Air vent in store the same roll
   may say "Bad air!" (same hurt, the Mine stays open). With props in store, with the Mine already closed today, or
   outside the Mine, nothing happens. Digging has its own roll (item 7) and the standing roll is skipped while you dig.
10. Crushed iron ore: at a Stamp Mill (water near) with iron ore in store the artisan crushes "Crush iron ore" (3 ore ->
   4 Crushed iron ore, 30 s, cap 20); the Bloomery then smelts blooms from it first (2 crushed + 1 charcoal or coal ->
   1 bloom, half the fuel). The Progression panel's Crushing & washing chain lists Crushed iron ore. Bronze still comes
   before iron; raw iron ore still smelts when there is no crushed ore.

## Named people in settlements: Elder, merchant, priest, smith, captain (2026-11-20)
Creative game is quickest (World tab: relation to a settlement, time of day; "Stamp here" a settlement template that
has a forge, e.g. Street village / Green village / any town). Hero on foot. Relation Neutral or better.
1. Elder at the keep (E): a new choice **Who's who in <name>?** lists the Elder, Merchant <name>, Brother <name>,
   Smith <name> (only with a forge), Captain <name> (a garrison guard) and the Reeve / Bailiff / Herald.
2. Walk up to the market trader outside: the dialogue header says **Merchant <name>**; enter the settlement's Market:
   the shop's second keeper is the same Merchant. The chapel priest outside and at the altar are the same **Brother**.
3. A garrison guard standing at ease: E offers **Captain <name>** (roleLabel "Captain of the watch"). With several
   people near, the "Who do you speak to?" chooser lists him.
4. Gold **"!"**: over the merchant, the priest and (when a camp is within 60 tiles, or at night) the captain while they
   have work for you; inside the forge the smith's name is gold with "! " in front.
5. Enter the forge (Blacksmith): the keeper is **Smith <name>**. "Need anything fetched for the forge?" posts his own
   quest (Quests panel title "Smith <name>: Deliver 20 iron to <site>"; a toast says the smith asks). Asking again does
   not add a second one. "I'll do it" accepts; with the goods in your stock, "Deliver" completes it from the dialogue.
6. Talk to him again: the greeting adds "Ha! The one who keeps my forge fed..."; **Could you forge me a few tools?**
   (greyed "Help the forge first" before) gives +2 tools, then greys "Not again today". Asking for work again: "I've
   enough to be going on with. Ask me again tomorrow."
7. Captain: no camp near -> "No camp within a day's march". Spawn / stamp a bandit camp within 60 tiles: he posts
   "Captain <name>: Clear the camp near <site>"; burn its hearth: paid, favour. **What do your scouts report?** then
   names the camp count and the nearest, and reveals them on the minimap.
8. Priest: "How can I help the poor here?" (grain / fruit / cloth alms); after delivering, **Bless me, Brother.**
   heals the hero and fills rest (once a day). Merchant: "Need anything fetched?" (wool / cloth / fruit / meat); after,
   **Anything put by for a friend?** hands you 5 of the settlement's most plentiful good.
9. The settlement's own board (Herald / Elder "Do you need help") still posts up to 2 quests; the named people's
   quests do not count against it.
10. Family extras: with a spouse (creative World tab "Family" row), E on your spouse: a spouse greeting ("There you
    are...") instead of "Yes?"; with a baby at home it adds "The little ones ask after you every night." A grown child /
    sibling / parent greets as kin; anyone else as before.

## Retired prefabs: creative-only (G9)
Normal game (not creative): Farming tab shows no Farm, Cow / Pig / Sheep pasture or Hemp Field buttons, and their
hotkeys (4, p, f, n) do nothing. Paint a Growing zone (Zones tab: wheat / hemp) and an Animal area, fence it, and use a
Chicken Coop / Livestock Barn / Pig Sty / Sheep Pen instead. Creative game: the four old tools are back and place; old
saves' existing plots and pastures keep working. The server refuses the old tiles in normal games too.

## Mine assault toast (B1)
Have an own Mine (or Quarry) with an infested level and 1+ soldiers within 12 tiles; open its panel and press **Send
soldiers in**. Expect a toast "Your N soldiers cleared the Mine's level X (K monsters slain...)" (or "were driven out of
...: K slain, L fell, R monsters remain" when repelled; losses are named in both) and a matching line in the chronicle
(news feed). The count N must match the "soldiers in reach" shown on the panel.

## Food days and Prepare for winter (2026-11-20)
1. Colony panel, under Happiness: a row "Food: N days (x/day)" with an up arrow when stock grew since the last dawn
   meal, a down arrow when it fell. Hover: stock, the dawn meal's need, change since the last dawn. It shows with
   seasons on and off.
2. Spend or sell the grain / meat / fruit down: the row turns amber under 3 days and red under 1. At the next dawn
   with under 3 days of food a single "Food is low: about N days of food left" toast appears (not twice the same day).
3. Feed the colony back above 3 days: the row goes back to normal and no toast the next dawn.
4. Jump to Autumn (Creative > World > Season): the goal card gains a dashed "Prepare for winter" block with
   "Fuel x / 5 days, N need warm clothes (reward: 20 wood)". It is not there in spring, summer or winter.
5. Stock wood until the fuel reads 5 days of the x/day burn: the block disappears, the toast "Goal complete: Prepare
   for winter (+20 wood)" shows and wood goes up by 20, once. The numbered main goal is unaffected.
6. Autumn of the next year: the block posts again. Save and reload after completing it in autumn: it stays done.
7. Does the dashed block read well under the goal bar at 210 px wide? Is amber distinct enough from red in the row?

Inn (rumour / rest): enter a settlement tavern and talk to the keeper. "Buy a rumour (10 gold)" takes exactly 10 gold and a place appears on the minimap; buy again and a different place appears. "Rest at the inn (5 gold)" fills the rest and energy bars. With under 5 / 10 gold the choices are greyed with "Needs N gold".

## Solo opening goals and a lone scout
New game, Solo: the goal card reads "Gather 20 wood and 10 stone", then "Build a shelter", "Hunt an animal", "Found a camp". Do
each; the card advances and pays a small reward. From day 2 a single bandit club-man appears near you around midday and chases you
(no raid group). Found a camp: the card switches to "Place a building" (the normal track) and the scout stops coming.

## Dusk raid forecast
Play to the middle of a day with a Town Center: a toast "Tonight: a small raid (wolves) from the north" appears once and a
red line stays under the top bar until the raiders make contact; it shows a size band, not a number, and the edge matches
where the raiders gather. Solo hero without a camp: no forecast. Hunger-marked elites stay a surprise.

- Heir epitaph: kill the hero (a family helps) and open the Chronicle: an epitaph line (name, gen, days, spouse, children, top deed) appears; pick an heir and a "The House" section lists "Gen 2, House <name>: ..." at the top of the panel. Run server/heir-epitaph-test.mjs for the server side.


## Adventure update — 25 November 2026

See the short play checklist in [HANDOVER-ADVENTURE.md](HANDOVER-ADVENTURE.md). Automated checks: `npm test -- adventure`.
