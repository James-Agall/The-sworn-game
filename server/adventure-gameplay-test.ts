import assert from 'node:assert/strict';
import {SPECIAL_BY_ID} from '../shared/src/specialCast.js';
import {STORIES,STORY_RECIPES} from '../shared/src/stories.js';
import {sanitizeHeroLife} from '../shared/src/herolife.js';
import {interiorSolidGrid,interiorLayoutAccessible,type InteriorMap} from '../shared/src/interiors.js';
import {TileType} from '../shared/src/protocol.js';
import {generateWorld} from './src/worldgen.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {state,players} from './src/state.js';
import {specialResidences,resetSpecialResidences} from './src/specialCast.js';
import {enterInterior,exitInterior,handleInteriorUse,handleInteriorTalk} from './src/interiors.js';
import {ensureEnteredEncounter,mineRecAt,mineInteriorMap,minesForSave,restoreMines,mineHeroAttack,updateMines,specialCharacterDefeated} from './src/mines.js';
import {explorationView,explorationSave} from './src/adventureLoot.js';
import {journalSnapshot,storyDialogue} from './src/story.js';
import {lifeOf,handleDialogueChoice,playerStationRecipes,handlePersonalCraft,updateHeroLife,heroLifeDebug} from './src/herolife.js';
import {heroProfileOf,handleEquipItem} from './src/heroes.js';
import {addItem,itemCount} from './src/progression.js';
import type {Player} from './src/types.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();await generateWorld(42);resetSpecialResidences();
const messages:any[]=[],p={id:'adventure-test',profileKey:'adventure-test',clan:0,nickname:'Adventurer',x:0,y:0,hp:100,dead:false,attackCooldownTicks:0,input:{dx:0,dy:0},socket:{OPEN:1,readyState:1,send:(s:string)=>messages.push(JSON.parse(s))}} as unknown as Player;players.set(p.id,p);
const prof=heroProfileOf(p);const homes=specialResidences(),home=(id:string)=>homes.find(h=>h.id===id)!;
function enter(id:string){if(p.interior)exitInterior(p);const h=home(id);p.x=(h.tx+.5)*32;p.y=(h.ty+1.5)*32;p.dead=false;p.hp=100;assert.equal(enterInterior(p,h.tx,h.ty),'',id);view();return h;}
function view(){const v=messages.filter(m=>m.type==='interior'&&m.view).at(-1)!.view;if(v.exploration){const I=p.interior!,g=mineInteriorMap(I.tx,I.ty,1,I.variant);assert.deepEqual(v.map,g.map,'the renderer and hero movement use the same exploration map');}return v;}
function at(x:number,y:number){p.interior!.x=(x+.5)*32;p.interior!.y=(y+.5)*32;}
function beside(x:number,y:number){const I=p.interior!,grid=mineInteriorMap(I.tx,I.ty,1,I.variant);const a=[[0,1],[0,-1],[1,0],[-1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy})).find(a=>!grid.solid[a.y*grid.map.w+a.x]);assert(a);at(a.x,a.y);}
function choose(contains:string){const d=messages.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)?.dialogue;assert(d,'dialogue');const n=d.choices.findIndex((c:any)=>c.label.includes(contains));assert(n>=0,contains+' '+JSON.stringify(d.choices));assert(!d.choices[n].disabled,d.choices[n].disabled);handleDialogueChoice(p,n);}
function visit(id:string){enter(id);const n=view().npcs.find((n:any)=>n.specialId===id);assert(n,'named resident '+id);at(n.x,n.y);handleInteriorTalk(p,n.id);assert(messages.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)?.dialogue.npc.name===SPECIAL_BY_ID.get(id)!.name);}
// Real key and door interactions; full inventories leave remaining contents saved.
enter('king-rusk');let I=p.interior!,r=mineRecAt(I.tx,I.ty)!,ev=explorationView(p,false)!;const gate=ev.objects.find(o=>o.kind==='gate')!,key=ev.objects.find(o=>o.kind==='key')!,chest=ev.objects.find(o=>o.kind==='chest'&&o.locked)!;
beside(gate.x,gate.y);handleInteriorUse(p,gate.x,gate.y);assert(!explorationView(p,false)!.objects.find(o=>o.id===gate.id)!.opened,'a missing key cannot open a door');
at(key.x,key.y);handleInteriorUse(p,key.x,key.y);assert(lifeOf(p).flags[`keys:${I.key}`]);beside(gate.x,gate.y);handleInteriorUse(p,gate.x,gate.y);assert(!mineInteriorMap(I.tx,I.ty,1,I.variant).solid[gate.y*view().map.w+gate.x]);
assert(interiorLayoutAccessible(mineInteriorMap(I.tx,I.ty,1,I.variant).map));
// Keep the guards in valid distant floor cells while testing a quiet storeroom.
const grid=mineInteriorMap(I.tx,I.ty,1,I.variant),safe=[];for(let y=1;y<grid.map.h-1;y++)for(let x=1;x<grid.map.w-1;x++)if(!grid.solid[y*grid.map.w+x]&&Math.hypot(x-chest.x,y-chest.y)>5)safe.push({x,y});r.layers[0].mobs.forEach((m,n)=>Object.assign(m,safe[n%safe.length]));
lifeOf(p).pack={wood:40};prof.inventory=Array.from({length:40},(_,i)=>({id:`full${i}`,slot:'body',name:'Test item',tier:1,kind:'armour',stats:{}} as any));beside(chest.x,chest.y);const gold=state.stock.gold;handleInteriorUse(p,chest.x,chest.y);const openedGold=state.stock.gold;assert(openedGold>gold);assert(!explorationView(p,false)!.objects.find(o=>o.id===chest.id)!.empty,'full inventory keeps resource and relic loot');
const saved=JSON.parse(JSON.stringify(minesForSave()));restoreMines(saved);assert.deepEqual(JSON.parse(JSON.stringify(minesForSave())),saved,'exploration saves round-trip exactly');
mineInteriorMap(I.tx,I.ty,1,I.variant);lifeOf(p).pack={};prof.inventory=[];beside(chest.x,chest.y);handleInteriorUse(p,chest.x,chest.y);assert.equal(state.stock.gold,openedGold,'gold is claimed once');assert.equal(prof.inventory.length,1,'the retained relic is collected after making room');assert(explorationView(p,false)!.objects.find(o=>o.id===chest.id)!.empty);const pack=JSON.stringify(lifeOf(p).pack);handleInteriorUse(p,chest.x,chest.y);assert.equal(JSON.stringify(lifeOf(p).pack),pack,'an empty chest cannot duplicate resources');
const noChange=JSON.stringify(minesForSave());handleInteriorUse(p,-999,999);handleInteriorUse(p,NaN,NaN);assert.equal(JSON.stringify(minesForSave()),noChange,'malformed/far targets cannot alter loot');
// A native half-health rally stays bounded through leaving, saving and re-entering.
enter('king-rusk');let rallyRec=mineRecAt(p.interior!.tx,p.interior!.ty)!,rally=rallyRec.layers[0],captain=rally.mobs.find(m=>m.specialId==='king-rusk')!;
const rallyGrid=mineInteriorMap(rallyRec.tx,rallyRec.ty,1,0),area=[];for(let y=5;y<rallyGrid.map.h-5;y++)for(let x=5;x<rallyGrid.map.w-5;x++)if(!rallyGrid.solid[y*rallyGrid.map.w+x]&&[1,2,3,4].every(d=>!rallyGrid.solid[y*rallyGrid.map.w+x+d]&&!rallyGrid.solid[y*rallyGrid.map.w+x-d]))area.push({x,y});assert(area.length);const center=area[0];captain.x=center.x;captain.y=center.y;captain.hp=captain.maxHp*.45;captain.awake=true;at(center.x,center.y+1);state.cycleTick++;updateMines();assert(captain.rallyUsed);assert((rally.summonsSpawned??0)>0&&(rally.summonsSpawned??0)<=2);const count=rally.summonsSpawned;
captain.bossState={phase:'windup',start:state.cycleTick,end:state.cycleTick+10,x:center.x,y:center.y+1,fromX:center.x,fromY:center.y};exitInterior(p);for(let n=0;n<60;n++){state.cycleTick++;updateMines();}enter('king-rusk');const hpBefore=p.hp;state.cycleTick++;updateMines();assert.equal(p.hp,hpBefore,'returning cannot trigger a stale wind-up');assert.equal(captain.bossState,undefined);const summonSave=JSON.parse(JSON.stringify(minesForSave()));restoreMines(summonSave);rallyRec=mineRecAt(p.interior!.tx,p.interior!.ty)!;rally=rallyRec.layers[0];captain=rally.mobs.find(m=>m.specialId==='king-rusk')!;assert(captain.rallyUsed);assert.equal(rally.summonsSpawned,count);state.cycleTick++;updateMines();assert.equal(rally.summonsSpawned,count,'reload cannot repeat the rally');
const deadSave=JSON.stringify(minesForSave());p.dead=true;handleInteriorUse(p,key.x,key.y);assert.equal(JSON.stringify(minesForSave()),deadSave,'dead heroes cannot take exploration loot');p.dead=false;
// Exact NPC targeting, individual stories, all ten full quest chains and rewards.
let stages=0;
for(const story of STORIES){
 const giver=story.steps.find(s=>s.actor)!.actor!;visit(giver);choose('Story: '+story.title);choose('Take up this story');
 let guard=0;
 while(!lifeOf(p).flags[`story:${story.id}:done`]&&guard++<50){
  journalSnapshot(p);const index=(lifeOf(p).flags[`story:${story.id}:step`]??1)-1,step=story.steps[index];assert(step,story.id+' stage');
  if(step.kind==='talk'){visit(step.actor!);}
  else if(step.kind==='supply'||step.kind==='craft'||step.kind==='choice'){
   if(step.kind==='supply')(state.stock as any)[step.good!]=Math.max((state.stock as any)[step.good!]??0,step.count!);
   if(step.kind==='craft')addItem(step.item as any,step.count!);
   visit(step.actor!);choose('Story: '+story.title);
   if(step.kind==='supply'||step.kind==='craft')choose('Hand over');
   else choose(step.choices![0].label);
  }else{
   const h=enter(step.target!),rec=mineRecAt(h.tx,h.ty)!;
   if(step.kind==='hunt'){
    const m=rec.layers[0].mobs.find(m=>m.specialId===step.target);if(m){at(m.x,m.y);m.hp=1;p.attackCooldownTicks=0;mineHeroAttack(p);}assert(specialCharacterDefeated(step.target!),story.id+' named enemy defeated');
   }else if(step.kind==='clue'){
    const note=explorationView(p,false)!.objects.find(o=>o.kind==='note')!;at(note.x,note.y);handleInteriorUse(p,note.x,note.y);
   }else{
    const ev=explorationView(p,false)!,k=ev.objects.find(o=>o.kind==='key')!,cage=ev.objects.find(o=>o.kind==='cage')!;at(k.x,k.y);handleInteriorUse(p,k.x,k.y);
    const g=mineInteriorMap(h.tx,h.ty,1,p.interior!.variant),far=[];for(let y=1;y<g.map.h-1;y++)for(let x=1;x<g.map.w-1;x++)if(!g.solid[y*g.map.w+x]&&Math.hypot(x-cage.x,y-cage.y)>5)far.push({x,y});rec.layers[0].mobs.forEach((m,i)=>Object.assign(m,far[i%far.length]));beside(cage.x,cage.y);handleInteriorUse(p,cage.x,cage.y);
   }
  }
  stages++;
 }
 assert(lifeOf(p).flags[`story:${story.id}:done`],story.id+' completes');assert(lifeOf(p).flags[`recipe:${story.recipe}`]);
 const rewardGold=state.stock.gold;storyDialogue(p,giver,`story:${story.id}:choice:authority`);assert.equal(state.stock.gold,rewardGold,'completed stories do not pay twice');
}
const journal=journalSnapshot(p);assert.equal(journal.entries.filter(e=>e.status==='complete'&&!e.id.startsWith('favor:')).length,10);assert(journal.clues.length>0&&journal.keys.length>0);assert(journal.characters.length>=80);
const lifeSave=sanitizeHeroLife(JSON.parse(JSON.stringify(lifeOf(p))))!;for(const s of STORIES){assert(lifeSave.flags[`story:${s.id}:done`]);assert(lifeSave.flags[`recipe:${s.recipe}`]);}
const allSave=JSON.parse(JSON.stringify(minesForSave()));restoreMines(allSave);assert.deepEqual(JSON.parse(JSON.stringify(minesForSave())),allSave);for(const h of homes.filter(h=>h.hostile)){ensureEnteredEncounter(h.tx,h.ty);assert(specialCharacterDefeated(h.id),'named deaths remain saved: '+h.id);}
// Every unlocked recipe runs through the real public workstation and native output path.
for(const recipe of STORY_RECIPES){
 if(p.interior)exitInterior(p);const i=state.tiles.indexOf(recipe.station);assert(i>=0,recipe.label+' station exists');const tx=i%state.WORLD_TILES_X,ty=Math.floor(i/state.WORLD_TILES_X);p.x=(tx+.5)*32;p.y=(ty+1.5)*32;p.input={dx:0,dy:0};assert.equal(enterInterior(p,tx,ty),'',recipe.id+' station entry');const station=view().map.props.find((q:any)=>['anvil','forge','oven','workbench','counter','barrel'].includes(q.prop));assert(station);at(station.x,station.y);
 for(const [good,count]of Object.entries(recipe.stock??{}))(state.stock as any)[good]=Math.max(100,count!);
 lifeOf(p).food=lifeOf(p).rest=lifeOf(p).energy=100;
 const beforeStock={...state.stock},beforeItem=recipe.item?itemCount(recipe.item):0,beforeGear=prof.inventory.length;
 handlePersonalCraft(p,recipe.id);assert(heroLifeDebug(p).snap.work,'recipe starts: '+recipe.id);
 for(let n=0;n<recipe.seconds*20+5;n++){state.cycleTick++;updateHeroLife();}
 assert(!heroLifeDebug(p).snap.work,'recipe finishes: '+recipe.id);
 for(const [g,n]of Object.entries(recipe.stock??{}))assert.equal((state.stock as any)[g],(beforeStock as any)[g]-n!,'recipe pays inputs once: '+recipe.id);
 if(recipe.item)assert.equal(itemCount(recipe.item),beforeItem+recipe.amount);
 if(recipe.stockOutput)assert.equal(state.stock[recipe.stockOutput],beforeStock[recipe.stockOutput]+recipe.amount);
 if(recipe.questGear){assert.equal(prof.inventory.length,beforeGear+1);const shield=prof.inventory.at(-1)!;assert.equal(shield.kind,'shield');delete prof.equipment.weapon;handleEquipItem(p,shield.id,'offhand');assert.equal(prof.equipment.offhand?.id,shield.id,'quest shield equips through native armour slots');}
}
// No payment or output on interruption, and capacity is checked at start and completion.
enter('hesta-ironroot');const anvil=view().map.props.find((q:any)=>q.prop==='anvil'||q.prop==='forge')!;at(anvil.x,anvil.y);state.stock.iron=state.stock.wood=100;
const beforeInterrupted=prof.inventory.length;handlePersonalCraft(p,'hesta-shield');p.input={dx:1,dy:0};state.cycleTick++;updateHeroLife();p.input={dx:0,dy:0};assert(!heroLifeDebug(p).snap.work);assert.equal(state.stock.iron,100);assert.equal(prof.inventory.length,beforeInterrupted);
prof.inventory=Array.from({length:40},(_,i)=>({id:`capacity${i}`,slot:'body',name:'Test',tier:1,kind:'armour',stats:{}} as any));handlePersonalCraft(p,'hesta-shield');assert(!heroLifeDebug(p).snap.work);assert.equal(state.stock.iron,100);prof.inventory=[];handlePersonalCraft(p,'hesta-shield');assert(heroLifeDebug(p).snap.work);prof.inventory=Array.from({length:40},(_,i)=>({id:`capacity${i}`,slot:'body',name:'Test',tier:1,kind:'armour',stats:{}} as any));for(let n=0;n<710;n++){state.cycleTick++;updateHeroLife();}assert.equal(state.stock.iron,100);assert.equal(prof.inventory.length,40);prof.inventory=[];
// The alternative choice and earned services validate cost, actor, cooldown and persistence.
const choiceStory=STORIES[1],choice=choiceStory.steps.findIndex(s=>s.kind==='choice'),actor=choiceStory.steps[choice].actor!,flags2=lifeOf(p).flags;delete flags2[`story:${choiceStory.id}:done`];delete flags2[`story:${choiceStory.id}:choice`];flags2[`story:${choiceStory.id}:step`]=choice+1;const choiceGold=state.stock.gold;storyDialogue(p,actor,`story:${choiceStory.id}:choice:authority`);assert.equal(flags2[`story:${choiceStory.id}:choice`],2);assert(state.stock.gold>=choiceGold+30);const afterChoice=state.stock.gold;storyDialogue(p,actor,`story:${choiceStory.id}:choice:authority`);assert.equal(state.stock.gold,afterChoice);flags2[`story:${choiceStory.id}:done`]=1;
const serviceStory=STORIES[0],priest=serviceStory.members.find(id=>SPECIAL_BY_ID.get(id)!.group==='faith')!,inn=serviceStory.members.find(id=>SPECIAL_BY_ID.get(id)!.group==='commons')!;
state.stock.gold=20;lifeOf(p).food=lifeOf(p).rest=lifeOf(p).energy=1;p.hp=40;storyDialogue(p,priest,`story:${serviceStory.id}:treatment`);assert.equal(p.hp,75);assert.equal(lifeOf(p).rest,100);p.hp=40;storyDialogue(p,priest,`story:${serviceStory.id}:treatment`);assert.equal(p.hp,40,'daily treatment cannot repeat');storyDialogue(p,inn,`story:${serviceStory.id}:treatment`);assert.equal(p.hp,40,'wrong role cannot provide treatment');storyDialogue(p,inn,`story:${serviceStory.id}:lodging`);assert.equal(state.stock.gold,12);storyDialogue(p,inn,`story:${serviceStory.id}:lodging`);assert.equal(state.stock.gold,12,'lodging cost cannot repeat');storyDialogue(p,'hesta-ironroot',`story:${serviceStory.id}:training`);assert.equal(state.stock.gold,0);assert(lifeOf(p).skills.smithing!>0);storyDialogue(p,'hesta-ironroot',`story:${serviceStory.id}:training`);assert.equal(state.stock.gold,0);
console.log('PASS all ten real workstation recipes, equippable shields, interrupted and capacity-safe crafting, authority choice, role/cost/day-limited services');
// Dormant locations do not resume combat or manufacture new rewards.
if(p.interior)exitInterior(p);const dormant=JSON.stringify(minesForSave()),oldGold=state.stock.gold;for(let i=0;i<1200;i++){state.cycleTick++;updateMines();}assert.equal(JSON.stringify(minesForSave()),dormant);assert.equal(state.stock.gold,oldGold);
// A missing contact can be reported to a surviving participant instead of stranding a quest.
const s=STORIES[0],flags=lifeOf(p).flags;delete flags[`story:${s.id}:done`];flags[`story:${s.id}:step`]=1;const target=home(s.steps[0].actor!),idx=target.ty*state.WORLD_TILES_X+target.tx,oldTile=state.tiles[idx];state.tiles[idx]=TileType.Empty;const j=journalSnapshot(p).entries.find(e=>e.id===s.id)!;assert(j.blocked?.includes('unavailable'));const other=s.members.find(id=>!SPECIAL_BY_ID.get(id)!.hostile&&id!==s.steps[0].actor)!;storyDialogue(p,other,`story:${s.id}:report`);assert(flags[`story:${s.id}:step`]>1);state.tiles[idx]=oldTile;
console.log(`PASS saved keys/locks/partial loot/relic capacity, no duplicates, exact NPC interaction, ${stages} actual stages across all ten complete stories, recipes, choices, journal records, missing-contact recovery, saved named deaths and dormant long-session updates`);process.exit(0);
