import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'outputs'
catalog={}
for pack in ['autumn-art-pack','building-wall-kit','remaining-and-caves']:
 for a in json.loads((OUT/pack/'catalog.json').read_text(encoding='utf-8-sig')):
  a['pack']=pack;catalog[a['name']]=a
files=json.loads((ROOT/'work/sprite-files.json').read_text(encoding='utf-8-sig'))
mapping={}
def put(name,sheet,row,col=0,mode='prop'):
 name=name if name.endswith('.png') else name+'.png'
 a=catalog[sheet]; f=next(f for f in a['frames'] if f['row']==row and f['column']==col)
 mapping[name]={'sheet':sheet,'row':row,'column':col,'source':a['pack']+'/'+f['file'],'mode':mode}
units={
 'farmer':('workers-a-transparent',0),'farmhand':('workers-a-transparent',1),'lumberjack':('workers-a-transparent',2),
 'ironMiner':('workers-b',0),'rockMiner':('workers-b',1),'builder':('workers-b',2),
 'hunter':('workers-c',0),'forager':('workers-c',1),'artisan':('workers-c',2),
 'bishop':('specialists-npcs',0),'townPriest':('specialists-npcs',0),'townHerald':('specialists-npcs',2),
 'militia':('infantry-v2',0),'archer':('infantry-v2',1),'spearman':('spear-pike-tiers',0),'pikeman':('spear-pike-tiers',3),
 'knight':('heavy-soldiers-v4',0),'shockKnight':('heavy-soldiers-v4',3),'cavalry':('mounted-units-v2',0),'player':('mounted-units-v2',3),
 'banditClubman':('bandits',0),'banditArcher':('bandits',1),'banditElite':('bandits',2),'bandit':('bandits',2),
 'goblin':('small-monsters',0),'goblinCrossbow':('small-monsters',1),'skeleton':('small-monsters',2),'giantSpider':('small-monsters',3),'darkShaman':('small-monsters',4),'halfLatch':('small-monsters',5),
 'orc':('large-monsters',0),'armoredOrc':('large-monsters',1),'troll':('large-monsters',2),'ogre':('large-monsters',3),'ogreWarlord':('large-monsters',4),
 'deer':('wildlife-v2',0),'rabbit':('wildlife-v2',1),'boar':('wildlife-v2',2),'pheasant':('wildlife-v2',3),'wolf':('wildlife-v2',4),'goblinRider':('wildlife-v2',5),'goblinRiderVet':('wildlife-v2',5),
 'batteringRam':('young-animals-transport',4),'mobBatteringRam':('young-animals-transport',4),'catapult':('young-animals-transport',5),'mobCatapult':('young-animals-transport',5),
 'traderWagon1':('wagons-riders',0),'traderWagon2':('wagons-riders',1),'traderWagon3':('wagons-riders',2)}
for kind in ['knight','cavalry','spearman','pikeman']:
 for t in range(1,4):
  sheet,row=units[kind];units[kind+'T'+str(t)]=(sheet,row+t-1)
for file in files:
 stem=file.removesuffix('.png')
 for kind in sorted(units,key=len,reverse=True):
  if not stem.startswith(kind):continue
  suffix=stem[len(kind):]
  if not re.fullmatch(r'(?:Walk|Attack|Chop|Mine|Heal|Harvest|Tend|Craft|Build|Carry|Hunt|Forage|Run|Graze|Flap|Idle|Ready|Charge|Death|Roar|Load|Fire|Hit|Destroyed|Fallen|Battered|Pristine)?\d*',suffix):continue
  sheet,row=units[kind];cols=catalog[sheet]['cols'];m=re.search(r'(\d+)$',suffix);i=int(m[1]) if m else 0
  col=i%4 if suffix.startswith(('Walk','Run')) else 4+i%3 if suffix.startswith(('Attack','Chop','Mine','Heal','Harvest','Tend','Craft','Build','Hunt','Forage','Fire','Load','Roar')) else 4+i%2 if suffix.startswith(('Graze','Flap')) else 7+i%2 if suffix.startswith('Carry') else 8 if suffix.startswith(('Death','Destroyed','Fallen')) else 7 if suffix.startswith(('Hit','Battered')) else 0
  put(file,sheet,row,min(col,cols-1),'actor');break
# Existing required frame counts are retained; extra frames deliberately reuse the recovery pose.
buildings={'townCenter':('civic-buildings',1,0),'townCenterLv1':('civic-buildings',1,1),'townCenterLv2':('civic-buildings',1,2),'townCenterKeep':('civic-buildings',1,3),'cottage':('civic-buildings',0,0),'bigCottage':('civic-buildings',0,3),'cottageLv2':('civic-buildings',0,1),'tavern':('civic-buildings',2,0),'church':('civic-buildings',3,0),'abbeyHall':('civic-buildings',3,3),'abbeyGrounds':('civic-buildings',3,2),'bazaar':('civic-buildings',4,0),'tradingPost':('civic-buildings',4,1),'tradingPostLv2':('civic-buildings',4,2),'tradingPostLv3':('civic-buildings',4,3),
 'lumberjackPost':('production-buildings',0,0),'ironMine':('production-buildings',1,0),'quarry':('production-buildings',1,1),'blacksmith':('production-buildings',2,0),'blacksmithLv2':('production-buildings',2,1),'blacksmithLv3':('production-buildings',2,2),'tailorShop':('production-buildings',4,0),'brewery':('production-buildings',5,0),'mill':('production-buildings',3,2),'bakery':('production-buildings',3,0),
 'barracks':('military-animal-buildings',0,1),'militiaCamp':('military-animal-buildings',0,0),'militiaCamp2':('military-animal-buildings',0,1),'militiaCamp3':('military-animal-buildings',0,2),'archeryRange':('military-animal-buildings',1,0),'archerTower':('military-animal-buildings',1,1),'castleKeep':('military-animal-buildings',2,0),'castleLv2':('military-animal-buildings',2,1),'castleLv3':('military-animal-buildings',2,2),'stables':('military-animal-buildings',3,0),'stablesLv2':('military-animal-buildings',3,1),'stablesLv3':('military-animal-buildings',3,2),'siegeWorkshop':('production-buildings',2,3),'barn':('animal-building-states',1,0)}
for n,r in [('hunterHut',0),('foragerHut',1),('buildersGuild',2),('jewelersWorkshop',3)]:
 for t in range(3):buildings[n+('Lv'+str(t+1) if t else '')]=('specialist-building-tiers',r,t*4)
for n,v in buildings.items():put(n,*v)
for n,r in [('building_chicken_coop',0),('building_barn_cows',1),('building_pig_sty',2),('building_sheep_pen',3)]:put('animals/'+n,'animal-building-states',r,3)
for f in files:
 m=re.fullmatch(r'(wood|stone)Wall(Dmg)?(B2)?_(\d+)\.png',f)
 if m:put(f,'exterior-walls-damaged' if m[2] else 'walls-doors',(2 if m[1]=='stone' else 0)+int(m[4])//8,int(m[4])%8,'wall')
 m=re.fullmatch(r'moat_(\d+)\.png',f)
 if m:put(f,'terrain-connections',4+int(m[1])//8,int(m[1])%8,'tile')
 m=re.fullmatch(r'drawbridge(Wood|Iron)(H|V)(Lowered|Raised|Damaged|Destroyed)\.png',f)
 if m:put(f,'bridges-water-roofs',int(m[1]=='Iron'),int(m[2]=='V')*4+['Lowered','Raised','Damaged','Destroyed'].index(m[3]),'tile')
 m=re.fullmatch(r'gate(Wood|Stone)(.*)\.png',f)
 if m:put(f,'wall-kit-doors',int(m[1]=='Stone'),(4 if 'V' in m[2] else 0)+(3 if any(x in m[2] for x in ['Damaged','Breached','Overrun']) else 1 if 'Open' in m[2] else 0),'wall')
 m=re.fullmatch(r'structure/(door|window)_(wood|stone)_(h|v)(?:_(open|closed))?\.png',f)
 if m:put(f,'wall-kit-doors' if m[1]=='door' else 'wall-kit-windows',int(m[2]=='stone'),int(m[3]=='v')*4+int(m[4]=='open'),'wall')
for name,mask in {'isolated':0,'deadEndT':1,'deadEndR':2,'deadEndB':4,'deadEndL':8,'straightV':5,'straightH':10,'cornerTL':6,'cornerTR':12,'cornerBL':3,'cornerBR':9,'tJunctionR':14,'tJunctionL':11,'tJunctionB':7,'tJunctionT':13,'cross':15}.items():put('road-'+name,'terrain-connections',mask//8,mask%8,'tile')
put('cobbleRoad','terrain-connections',2,5,'tile');put('cobblePlaza','terrain-connections',3,7,'tile')
for n,r,c in [('woodWall',0,2),('stoneWall',2,2)]:put(n,'walls-doors',r,c,'wall')
for f in files:
 if 'WallBreached' in f:put(f,'exterior-walls-damaged',2 if f.startswith('stone') else 0,5 if 'V' in f else 2,'wall')
furniture={'bed':(0,0),'table':(0,7),'chair':(0,4),'chest':(1,1),'shelf':(1,2),'hearth':(2,0),'lamp':(2,3),'rug':(4,6),'workbench':(1,0),'statue':(2,7),'weapon_rack':(1,5)}
for n,rc in furniture.items():put('structure/'+n,'furniture-stations',*rc,'tile' if n=='rug' else 'furniture')
for f in files:
 m=re.search(r'structure/(?:extra/)?floor_(wood|stone|dirt)(?:_b)?_(\d)',f)
 if m:put(f,'square-terrain',2 if m[1]!='dirt' else 0,(int(m[2])-1)+(4 if m[1]=='stone' else 4 if m[1]=='dirt' else 0),'tile')
 if f.startswith('structure/') and '/roof_' in f:
  mat='slate' if 'slate' in f else 'tile' if any(n in f for n in ['tile','clay']) else 'thatch';put(f,'bridges-water-roofs',{'thatch':3,'tile':5,'slate':6}[mat],1 if 'ridge' in f else 0,'tile')
extras={'altar_candles':(2,5),'armor_stand':(1,6),'barrel':(4,1),'bed_blue_double':(0,1),'bed_red_single':(0,0),'bed_straw':(0,2),'bench':(0,6),'chest_locked':(1,1),'fireplace_lit_b':(2,1),'hay_pile_crate':(4,4),'lantern':(2,3),'oven_round':(3,2),'sacks_pile':(4,2),'signpost_hanging':(5,5),'stool':(0,5),'table_long':(1,0),'wardrobe':(1,3),'well_stone':(4,0),'banner_blue':(4,5),'banner_red':(4,5),'banner_post_blue':(4,5),'stove_iron':(3,0),'stall_market_red':(5,6),'stall_market_blue':(5,6)}
for n,rc in extras.items():put('structure/extra/'+n,'furniture-stations',*rc,'furniture')
for f in files:
 if not f.startswith('structure/extra/') or f in mapping:continue
 n=Path(f).stem
 if n.startswith('door_'):put(f,'wall-kit-doors',1 if 'stone' in n else 0,1 if 'open' in n else 0,'wall')
 elif n.startswith('window_'):put(f,'wall-kit-windows',1 if 'stone' in n else 0,0,'wall')
 elif n.startswith('rug_'):put(f,'furniture-stations',4,7 if 'blue' in n else 6,'tile')
 elif n.startswith('candelabra'):put(f,'furniture-stations',2,5,'furniture')
terrain={'grassFloor1':(0,0),'grassFloor2':(0,1),'dirtFloor':(0,4),'darkDirtFloor':(0,5),'sandFloor':(0,6),'snowFloor':(1,0),'hillsFloor':(1,2),'marshFloor':(0,7),'swampFloor':(0,7),'lavaFloor':(1,4),'voidFloor':(1,5)}
for n,rc in terrain.items():put(n,'square-terrain',*rc,'tile')
nature={'tree':(2,2),'appleTreeRipe':(3,0),'appleTreePicked':(3,1),'pearTreeRipe':(3,0),'pearTreePicked':(3,1),'berryBushRipe':(3,2),'berryBushPicked':(3,3),'mushroomRipe':(3,4),'mushroomPicked':(3,5),'flowers1':(5,1),'tallGrass':(5,0),'bush3':(3,7),'rock':(4,0),'ironOre':(4,3),'ironOre2':(4,4),'ironOre3':(4,5),'stoneArch':(1,0),'ruinWall1':(1,1),'ruinWall2':(1,2),'rubble':(1,5),'gravestone':(1,3),'gravestone2':(1,4),'crate':(1,6),'cart':(0,6),'fence':(5,7),'campfire':(0,7)}
for n,rc in nature.items():put(n,'camps-nature',*rc)
for n,rc in {'barrel':(4,1),'cross':(2,4),'statue':(2,7),'lanternPost':(2,3),'banner':(4,5)}.items():put(n,'furniture-stations',*rc)
for f in files:
 if f.startswith('tent'):put(f,'camps-nature',0,2 if 'green' in f else 1 if 'red' in f else 0)
 if f.startswith(('keepRuin','castleRuin')):put(f,'military-animal-buildings',2,6)
 if f.startswith(('keepScaffold','campFounding')):put(f,'military-animal-buildings',2,7)
 if f.startswith('rubbleWood'):put(f,'wall-kit-construction',0,4)
 if f.startswith('rubbleStone'):put(f,'wall-kit-construction',1,4)
 if f.startswith('blacksmithForge'):put(f,'production-buildings',2,0)
 m=re.fullmatch(r'(waterTile|moatRipple|campfire|torch|lanternPost)(\d*)\.png',f)
 if m:
  i=int(m[2] or 0)%4
  if m[1] in ['waterTile','moatRipple']:put(f,'bridges-water-roofs',2,i+(4 if m[1]=='moatRipple' else 0),'tile')
  else:put(f,'cave-props',7,i if m[1]!='lanternPost' else 5)
# Crop stages and seasonal ground/trees.
for f in files:
 if f.startswith(('farmPlot','hempField')):
  states=['Fallow','Sown','Sprouting','Growing','Ready','Harvested'];c=next((i for i,s in enumerate(states) if s in f),3);put(f,'crops',1 if f.startswith('hemp') else 0,c,'tile')
 if f.startswith('orchard'):put(f,'camps-nature',3,1 if 'Blossom' in f else 0)
 if f.startswith(('pasture','sheepPasture','pigPasture')):put(f,'animal-building-states',3 if f.startswith('sheep') else 2 if f.startswith('pig') else 1,3)
 if f.startswith('seasons/tree_'):put(f,'camps-nature',2,next(i for i,n in enumerate(['spring','summer','autumn','winter']) if n in f))
 if f.startswith('seasons/ground_'):put(f,'square-terrain',1 if 'winter' in f else 0,0 if 'winter' in f else 2 if 'autumn' in f else 0,'tile')
 if f=='seasons/tile_water_frozen_or_water.png':put(f,'square-terrain',1,1,'tile')
 if f.startswith('crops/crop_'):
  row=1 if 'flax' in f else 2 if 'veg' in f else 3 if 'berry' in f else 4 if 'root' in f else 0;m=re.search('stage(\d)',f);col=int(m[1])-1 if m else 6 if 'wither' in f else 7 if 'frost' in f else 1 if any(s in f for s in ['young','seedling']) else 4;put(f,'crops',row,col,'tile')
# Human tasks, correct observed facing order of the life sheet is E,S,N.
tasks={'sow':('human-tasks-directions-a',0),'water':('human-tasks-directions-a',1),'harvest':('human-tasks-directions-a',2),'haul_sack':('human-tasks-directions-a',3),'hammer':('human-tasks-directions-b',0),'chop':('human-tasks-directions-b',1),'mine':('human-tasks-directions-b',2),'cook':('human-tasks-directions-b',3),'eat_table_a':('human-life-directions',0),'eat_table_b':('human-life-directions',0),'sit':('human-life-directions',1),'sleep_bed':('human-life-directions',2),'farmer_haul_a':('human-life-directions',3),'farmer_haul_b':('human-life-directions',3),'bowl_carry':('human-tasks-directions-a',3)}
for f in files:
 m=re.fullmatch(r'villager/(.+)_(\d+)\.png',f)
 if m and m[1] in tasks:put(f,*tasks[m[1]],(int(m[2])-1)%4,'actor')
animals={'animal_chicken_hen':('animal-walks-a',0),'animal_chicken_rooster':('animal-walks-a',1),'animal_chick_a':('animal-walks-a',2),'animal_chick_b':('animal-walks-a',2),'animal_cow':('animal-walks-a',3),'animal_foal_or_calf':('animal-walks-a',4),'animal_pig':('animal-walks-b',0),'animal_sheep_a':('animal-walks-b',2),'animal_sheep_b':('animal-walks-b',3),'animal_horse_brown':('animal-walks-c',0),'animal_horse_gray':('animal-walks-c',0),'animal_pony_brown':('animal-walks-c',1),'animal_dog_brown':('animal-walks-c',2),'animal_dog_gray':('animal-walks-c',2),'animal_cat_dark':('animal-walks-c',3),'animal_cat_orange':('animal-walks-c',3)}
for n,rc in animals.items():put('animals/'+n,*rc,0,'actor')
for f in files:
 if f.startswith(('bloodSplatter','wound')):put(f,'shared-hit-effects',1 if f.startswith('wound') else 0,(2 if 'Heavy' in f else 1 if 'Bleeding' in f else int(re.search(r'\d+',f)[0])%8 if re.search(r'\d+',f) else 0),'effect')
 m=re.fullmatch(r'fx-(build|upgrade|heal|poison|wardPulse|wardLapse)(\d)\.png',f)
 if m:
  row,base={'build':(2,0),'upgrade':(2,4),'heal':(0,0),'poison':(0,4),'wardPulse':(3,0),'wardLapse':(3,4)}[m[1]];put(f,'magic-world-effects',row,base+int(m[2]),'effect')
 m=re.fullmatch(r'fx-(boulderImpact|boulder)(\d)\.png',f)
 if m:put(f,'projectiles-faction-effects',6 if m[1]=='boulder' else 7,4+int(m[2])%4 if m[1]=='boulder' else int(m[2]),'effect')
 if f.startswith(('sigil-','aura-')):
  names=['gorrath','gunne','morvain','nemri','rux','vhorrun'];put(f,'projectiles-faction-effects',names.index(f.split('-')[1].split('.')[0]),1 if f.startswith('aura') else 0,'effect')
for n,r,c in [('fx-dust0',5,4),('fx-poof',5,4),('fx-slash',4,0),('fx-spark',4,5)]:put(n,'magic-world-effects',r,c,'effect')
# Explicit icon row tables keep semantic mapping reviewable.
ui1=[['icons/room_'+n for n in ['bedroom','kitchen','workshop','hall','barracks','storeroom','hospital','church']],['icons/stat_size','icons/stat_beauty','icons/stat_cleanliness','icons/stat_warmth','icons/stat_wealth','icons/room_castle','icons/festival','ui-slotSocket'],['icons/stock_'+n for n in ['food','wood','stone','ore','metal','cloth','tools','weapons']],['icons/stock_armour','icons/stock_medicine','icons/stock_all','icons/work_woodcutting','icons/work_hunting','icons/work_cooking','icons/work_doctor','icons/work_research'],['icons/work_'+n for n in ['farming','hauling','building','crafting','mining','harvest','fighting']]+['icons/priority_off'],['icon-order-move','icon-order-attack','icon-order-rally','icon-order-attackMove','ui-orderHold','ui-orderRetreat','ui-orderCharge','ui-orderSkirmish'],['ui-orderBombard','ui-orderHoldFire','ui-orderCycle','ui-callToArms','ui-regimentBanner','ui-regimentCard','ui-relation','ui-reward'],['ui-roleInfantry','ui-roleArchers','ui-roleKnights','ui-roleCavalry','ui-roleSiege','ui-roleClergy','ui-roleHeroes','ui-warband']]
ui2=[['icon-stance-aggressive','icon-stance-normal','icon-stance-defensive','ui-shapeLine','ui-shapeBlock','ui-shapeWedge','ui-shapeLoose','ui-tradeAlert'],['ui-tradeProfit','ui-tradeRoute','ui-tribute','ui-vassal','ui-questNew','ui-questActive','ui-questDone','ui-questFailed'],['ui-questEntry','ui-questPanel','ui-characterSheet','ui/hotbar_a','ui/hotbar_b','ui/stamina_bar','ui-regimentFlag0','ui-regimentFlag1'],['ui-regimentFlag2']+['ui-rel'+str(i) for i in range(6)]+['clanBanner0'],['ui-spell'+str(i) for i in range(8)],['clanEmblem'+str(i) for i in range(6)]+['icon-event-dawn','icon-event-night'],['icon-event-death','icon-event-deserter','icon-event-upgrade','icon-event-ward','icons/need_hungry','icons/need_thirst','icons/need_tired','icons/need_happy'],['icons/need_sick','icons/need_heart','icon-luxuryItems','icon-alcohol','icon-cotton','icon-clothes','icon-hemp','icon-wool']]
for s,rows in [('ui-roles-orders',ui1),('ui-events-quests',ui2)]:
 for r,row in enumerate(rows):
  for c,n in enumerate(row):put(n,s,r,c,'icon')
for n,r,c in [('wood',0,0),('rock',0,1),('iron',0,7),('gold',0,9),('grain',1,0),('meat',1,3),('fruit',1,7),('tools',4,9)]:put('icon-'+n,'resources-tools',r,c,'icon')
for n,r,c in [('tool_axe',3,0),('tool_pickaxe',3,1),('tool_hoe',3,2),('tool_scythe',3,4),('tool_watering_can',3,7),('tool_seedbag',4,0),('item_shears',3,8),('item_milk_pail',3,9),('item_milk_bucket',3,9),('item_egg',1,6),('item_hay_bale',2,7),('item_water_trough',2,9),('item_wool_bundle',2,4)]:put('icons/'+n,'resources-tools',r,c,'icon')
for i in range(1,5):put('icons/priority_'+str(i),'resources-tools',5,i+4,'icon')
for f in files:
 if re.fullmatch(r'crow\d.png',f):put(f,'finishing-details',0,int(f[4]),'effect')
 if re.fullmatch(r'frog\d.png',f):put(f,'finishing-details',0,4+int(f[4]),'effect')
 if f.startswith('icons/season_'):put(f,'finishing-details',2,next(i for i,n in enumerate(['spring','summer','autumn','winter']) if n in f),'icon')
 if f=='icons/weather_rain.png':put(f,'finishing-details',2,4,'icon')
 if f.startswith('weather/weather_'):put(f,'finishing-details',5,{'rain':0,'snow':2,'fog':4,'storm':6}[Path(f).stem.split('_')[1]],'effect')
 if f.startswith('crops/soil_'):put(f,'finishing-details',3,4 if 'frost' in f else 1 if 'tilled' in f else 2 if 'watered' in f else 0,'tile')
for n,r,c in [('fx-arrow',1,1),('wardStone',1,4),('crops/scarecrow',4,0),('crops/prop_hat_posts',4,0),('crops/sprinkler',4,1),('crops/fence_gate_wood',4,2),('crops/fence_post_wood',4,3),('structure/extra/jar_clay',4,5),('structure/extra/plant_pot',4,6),('structure/extra/cauldron',4,7),('structure/extra/campfire_cauldron',4,7),('structure/extra/brazier_pot',4,7)]:put(n,'finishing-details',r,c,'effect' if n=='fx-arrow' else 'prop')
for n,s,r,c in [('bridge','bridges-water-roofs',0,0),('moatDigging','finishing-details',3,1),('townCenterMarker','ui-events-quests',3,7),('clanBanner1','ui-events-quests',5,1),('clanBanner2','ui-events-quests',5,2),('ui-orderAttackMove','ui-roles-orders',5,3),('animals/animal_cow_and_calf_pair','animal-walks-a',3,0),('structure/extra/cart_produce','camps-nature',0,6),('structure/extra/crates_barrels_stack','camps-nature',1,6),('structure/extra/frame_hut_wood','animal-building-states',0,7),('structure/extra/market_crates_small','camps-nature',1,6),('structure/extra/scaffold_frame','animal-building-states',0,7),('structure/extra/storage_rack_fence','furniture-stations',1,2)]:put(n,s,r,c)
# The player is on foot unless the server marks them mounted. Mounted art is selected by the renderer.
for i in range(4):
 put('campfire'+str(i),'magic-world-effects',1,i,'effect')
 put('torch'+str(i),'magic-world-effects',1,i,'effect')
 put('lanternPost'+str(i),'furniture-stations',2,3)
for f in files:
 if re.fullmatch(r'player(?:Walk|Attack|Idle)?\d*\.png',f):
  m=re.search(r'\d+',f);i=int(m[0]) if m else 0;put(f,'heroes',0,4+i%3 if 'Attack' in f else i%4,'actor')
report={'mappedExisting':sum(f in files for f in mapping),'additionalNamed':sum(f not in files for f in mapping),'legacyRetained':[f for f in files if f.endswith('.png') and f not in mapping]}
(OUT/'autumn-runtime-map.json').write_text(json.dumps(mapping,indent=2))
(OUT/'autumn-runtime-coverage.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
