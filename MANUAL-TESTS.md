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
(generation takes one to several minutes; the page waits on the welcome), or a 512 server with
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
