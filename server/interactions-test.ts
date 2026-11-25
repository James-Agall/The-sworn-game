import assert from 'node:assert/strict';
import {TileType, SPELL_IDS, type SpellId} from '../shared/src/protocol.js';
import {interiorSolidGrid,type InteriorMap} from '../shared/src/interiors.js';
import {generateWorld} from './src/worldgen.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {state,players,spellCooldowns,mobs} from './src/state.js';
import {specialResidences,resetSpecialResidences} from './src/specialCast.js';
import {enterInterior,exitInterior,handleInteriorUse,interiorInteract} from './src/interiors.js';
import {mineRecAt,mineInteriorMap,updateMines,clearSight} from './src/mines.js';
import {lifeOf,handleDialogueChoice} from './src/herolife.js';
import {heroProfileOf,handleEquipItem} from './src/heroes.js';
import {castSpellNow,playerCaster} from './src/spells.js';
import {useFurniture,furnitureSave,restoreFurniture,furnitureView,furnitureRoomMap,resetFurniture} from './src/furniture.js';
import {snapshotWorld,applyWorld} from './src/saves.js';
import {journalSnapshot} from './src/story.js';
import {handleSetTile} from './src/construction.js';
import {addItem} from './src/progression.js';
import type {Player} from './src/types.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();await generateWorld(42);resetSpecialResidences();
const msgs:any[]=[],otherMsgs:any[]=[],outsideMsgs:any[]=[];
function player(id:string,out:any[]){const p={id,profileKey:id,clan:0,nickname:id,x:0,y:0,hp:100,dead:false,attackCooldownTicks:0,input:{dx:0,dy:0},socket:{OPEN:1,readyState:1,send:(s:string)=>out.push(JSON.parse(s))}} as unknown as Player;players.set(id,p);return p;}
const p=player('interactions',msgs),friend=player('room-friend',otherMsgs),outside=player('outside',outsideMsgs),prof=heroProfileOf(p);
function enter(id:string){if(p.interior)exitInterior(p);const h=specialResidences().find(h=>h.id===id)!;p.x=(h.tx+.5)*32;p.y=(h.ty+1.5)*32;assert.equal(enterInterior(p,h.tx,h.ty),'');return h;}
function at(x:number,y:number){p.interior!.x=(x+.5)*32;p.interior!.y=(y+.5)*32;}
function choose(text:string){const d=msgs.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)?.dialogue;assert(d);const i=d.choices.findIndex((q:any)=>q.label.includes(text));assert(i>=0,text+' '+JSON.stringify(d));assert(!d.choices[i].disabled,d.choices[i].disabled);handleDialogueChoice(p,i);}
enter('king-rusk');const I=p.interior!,r=mineRecAt(I.tx,I.ty)!,L=r.layers[0],grid=mineInteriorMap(I.tx,I.ty,1,I.variant);
const center=[];for(let y=3;y<grid.map.h-3;y++)for(let x=3;x<grid.map.w-3;x++)if(!grid.solid[y*grid.map.w+x]&&[1,2].every(d=>!grid.solid[y*grid.map.w+x+d]&&!grid.solid[(y+1)*grid.map.w+x+d]))center.push({x,y});assert(center.length);const c=center[0];at(c.x,c.y);
const target=L.mobs.find(m=>!m.specialId)??L.mobs[0];L.mobs=[target];Object.assign(target,{x:c.x+2,y:c.y,hp:1000,maxHp:1000,specialId:undefined,cd:1000,speed:0});friend.interior={...I};friend.hp=50;outside.hp=50;
prof.spells=[...SPELL_IDS];prof.spellSlots=['fireBolt','frost','curse','thunder'];
const cast=(id:SpellId,t:any)=>{spellCooldowns.clear();return castSpellNow(playerCaster(p),id,t);};
assert.equal(cast('fireBolt',{targetId:target.id}),'');assert(target.hp<1000&&target.spell?.burnPower);assert(otherMsgs.some(m=>m.type==='interiorSpell'));assert(!outsideMsgs.some(m=>m.type==='interiorSpell'));const firstHp=target.hp;
// The first tick of a reactivated room must keep a newly applied burn.
delete L.lastActiveTick;state.cycleTick++;state.spellTick+=20;updateMines();assert(target.hp<firstHp,'burn survives first room tick');
assert.equal(cast('curse',{targetId:target.id}),'');assert(target.spell?.curse);assert.equal(cast('frost',{x:(target.x+.5)*32,y:(target.y+.5)*32}),'');assert(target.spell?.slow);
assert.equal(cast('thunder',{x:(target.x+.5)*32,y:(target.y+.5)*32}),'');
assert(cast('fireBolt',{targetId:'outdoor-mob-id'}));assert(!spellCooldowns.get(prof.key)?.fireBolt,'invalid targets spend no cooldown');
const savePos={x:I.x,y:I.y};let blocked=false;for(let y=1;y<grid.map.h-1&&!blocked;y++)for(let x=1;x<grid.map.w-1&&!blocked;x++)if(!grid.solid[y*grid.map.w+x]&&Math.hypot(x-c.x,y-c.y)<6&&!clearSight(grid,c,{x,y})){Object.assign(target,{x,y});assert(cast('fireBolt',{targetId:target.id}).includes('blocks'));blocked=true;}assert(blocked,'fixture includes a nearby wall blocking spells');
Object.assign(target,{x:c.x+2,y:c.y});assert.equal(cast('heal',{targetId:friend.id}),'');assert(friend.hp>50);assert(cast('heal',{targetId:outside.id}));assert.equal(outside.hp,50);friend.interior!.variant++;assert(cast('ward',{targetId:friend.id}));friend.interior!.variant--;
assert.equal(cast('rallyBanner',{x:I.x,y:I.y}),'');assert(cast('summon',{x:I.x,y:I.y}));assert(!spellCooldowns.get(prof.key)?.summon);
target.hp=1;assert.equal(cast('fireBolt',{targetId:target.id}),'');assert(target.hp<=0,'spell uses native interior death path');
console.log('PASS indoor fire/burn/curse/frost/thunder/heal/ward/rally, first-tick statuses, room-scoped effects, blocked walls, native death, invalid targets and cooldowns');
// Exercise an actual room rack through the same dialogue messages as the client.
const v=msgs.filter(m=>m.type==='interior'&&m.view).at(-1)!.view;const rack=v.map.props.find((q:any)=>q.prop==='weaponRack');
if(rack){const near=[[0,1],[1,0],[-1,0],[0,-1]].map(([dx,dy])=>({x:rack.x+dx,y:rack.y+dy})).find(q=>!grid.solid[q.y*grid.map.w+q.x])!;assert(near);at(near.x,near.y);interiorInteract(p);handleInteriorUse(p,rack.x,rack.y);choose('Take tier 1 sword');assert(prof.inventory.some(g=>g.kind==='sword'));handleEquipItem(p,prof.inventory.at(-1)!.id,'weapon');assert(prof.equipment.weapon);}
// A compact room permits exhaustive capacity, ownership and saved-object checks.
const map={w:9,h:9,cells:Array(81).fill('.'),spawn:{x:4,y:5},exit:{x:4,y:8},props:[]} as unknown as InteriorMap;
at(4,5);const q:any={x:4,y:4,prop:'weaponRack'};map.props=[q];let refreshed=0;const ctx={map,own:false,hostile:true,refresh:()=>refreshed++,work:()=>false};
resetFurniture();prof.inventory=[];I.level=2;I.key='test-room';I.variant=20;I.storey=0;
for(const kind of ['sword','spear','axe'])useFurniture(p,q,ctx,'take',kind+':2');assert.equal(prof.inventory.length,3);useFurniture(p,q,ctx,'take','bow:2');assert.equal(prof.inventory.length,3,'finite hostile racks');assert(furnitureView(p,map,false)[0].empty);
q.x=3;prof.inventory=Array.from({length:40},(_,n)=>({id:''+n,stats:{}} as any));const full=furnitureSave();useFurniture(p,q,ctx,'take','bow:2');assert.deepEqual(furnitureSave(),full,'full inventory preserves rack');prof.inventory=[];useFurniture(p,q,ctx,'take','bow:2');assert.equal(prof.inventory[0].kind,'bow');
q.x=5;q.prop='armourStand';for(const part of ['head','chest','offhand']){resetFurniture();useFurniture(p,q,ctx,'take',part+':2');assert(prof.inventory.at(-1));}
q.x=4;q.prop='weaponRack';resetFurniture();state.stock.gold=100;const friendly={...ctx,hostile:false};const before=prof.inventory.length;useFurniture(p,q,friendly,'take','spear:2');assert.equal(state.stock.gold,60);assert.equal(prof.inventory.length,before+1);state.stock.gold=0;useFurniture(p,q,friendly,'take','axe:2');assert.equal(prof.inventory.length,before+1,'cannot steal from friendly household');
state.equipment.weapon=[1,0,0];useFurniture(p,q,{...ctx,own:true},'take','sword:1');assert.equal(state.equipment.weapon[0],0);const n=prof.inventory.length;useFurniture(p,q,{...ctx,own:true},'take','sword:1');assert.equal(prof.inventory.length,n,'decorating cannot mint gear');
q.prop='lamp';useFurniture(p,q,ctx,'toggle');assert(furnitureView(p,map,false)[0].off);const lit=furnitureSave();restoreFurniture(JSON.parse(JSON.stringify(lit)));assert.deepEqual(furnitureSave(),lit);
q.prop='shelf';useFurniture(p,q,ctx);assert(journalSnapshot(p).clues.length>0,'world lore appears in journal');
q.prop='ruinRubble';p.attackCooldownTicks=0;lifeOf(p).pack={wood:40};useFurniture(p,q,ctx);assert(!furnitureView(p,map,false)[0].cleared,'full pack preserves rock');lifeOf(p).pack={};useFurniture(p,q,ctx);const altered=furnitureRoomMap(I.key,I.variant,I.storey,{map,solid:interiorSolidGrid(map)});assert(!altered.map.props.length);assert.equal(altered.solid[4*9+4],0,'removed objects unblock the same map used for combat and movement');
const savedFurniture=JSON.parse(JSON.stringify(furnitureSave())),world=snapshotWorld();assert.deepEqual(JSON.parse(JSON.stringify(world.furniture)),savedFurniture);resetFurniture();applyWorld(world);assert.deepEqual(furnitureSave(),savedFurniture,'native world save restores furniture');
console.log('PASS finite racks, all four weapons and three armour parts, ownership, capacity, native equipping, light persistence, world lore, clearing and full world save/load');
// Placement through real construction gates; no progression bypass.
delete p.interior;p.x=20.5*32;p.y=20.5*32;p.dead=false;p.attackCooldownTicks=0;addItem('stonePick',1);state.instantBuild=true;
const idx=(x:number,y:number)=>y*state.WORLD_TILES_X+x;state.tiles[idx(21,20)]=TileType.Rock;handleSetTile(p,21,20,TileType.RockMinePost);assert.equal(state.tiles[idx(21,20)],TileType.RockMinePost,'quarry places on stone with a pick');
state.tiles[idx(22,20)]=TileType.IronOre;handleSetTile(p,22,20,TileType.IronMinePost);assert.equal(state.tiles[idx(22,20)],TileType.IronMinePost,'mine places on ore after a quarry');
state.tiles[idx(21,21)]=TileType.Empty;handleSetTile(p,21,21,TileType.RockMinePost);assert(msgs.some(m=>m.type==='event'&&m.text.includes('stone outcrop')));handleSetTile(p,50,50,TileType.IronMinePost);assert(msgs.some(m=>m.type==='event'&&m.text.includes('Walk within 2 tiles')));
console.log('PASS real quarry/mine progression and ground placement, clear wrong-ground and distance feedback');process.exit(0);
