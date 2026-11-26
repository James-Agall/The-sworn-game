import {FURNITURE,WORLD_LORE,type FurnitureLive} from '@colony/shared/interactables';
import {interiorSolidGrid,type InteriorMap,type InteriorProp} from '@colony/shared/interiors';
import {TILE_SIZE} from '@colony/shared/protocol';
import {PACK_CAP,PACK_WEIGHT,PACK_LABEL,type PackGood} from '@colony/shared/herolife';
import {type ItemId} from '@colony/shared/progression';
import {adventureHash} from '@colony/shared/adventure';
import {state,sites} from './state.js';
import type {Player} from './types.js';
import {lifeOf,packWeight,furnitureTalk,toast,closeTalk,handleHeroAction,type ChoiceRt} from './herolife.js';
import {heroProfileOf,handleTakeFromArmoury,grantFoundEquipment} from './heroes.js';
import {itemCount,addItem} from './progression.js';
import {clanOf,withClan} from './clans.js';
import {clearSight,interiorEnemiesNear,mineNodeHarvest,mineNodeLive} from './mines.js';
import {sendTo} from './saves.js';
import {gameDay} from './diplomacy.js';
import {sendJournal} from './story.js';
interface ObjectState {remaining?:number;off?:boolean;cleared?:boolean;goods?:Partial<Record<PackGood,number>>;itemTaken?:boolean}
const objects=new Map<string,ObjectState>();
export interface FurnitureContext {map:InteriorMap;own:boolean;hostile:boolean;siteId?:string;refresh:()=>void;work:()=>boolean}
const room=(p:Player)=>`${p.interior!.key}#${p.interior!.variant}#${p.interior!.storey}`;
const key=(p:Player,q:{x:number;y:number;prop:InteriorProp})=>`${room(p)}:${q.x},${q.y}:${q.prop}`;
const count=(s:ObjectState|undefined,prop:InteriorProp)=>s?.remaining??(prop==='weaponRack'?3:1);
function loreFor(p:Player,prop:InteriorProp){const I=p.interior!;if(prop==='banner')return WORLD_LORE[6];if(prop==='statue'||prop==='altar')return WORLD_LORE[(I.tx+I.ty)%2?1:5];if(prop==='ruinColumn'||prop==='sarcophagus')return WORLD_LORE[7];return WORLD_LORE[adventureHash(`${I.key}:${prop}`)%WORLD_LORE.length];}
export function furnitureView(p:Player,map:InteriorMap,own:boolean,excluded:{x:number;y:number}[]=[]):FurnitureLive[]{
 return map.props.filter(q=>FURNITURE[q.prop]&&!excluded.some(o=>o.x===q.x&&o.y===q.y)).map(q=>{const d=FURNITURE[q.prop]!,s=objects.get(key(p,q));
  // Mining rework: a mineral / rock node of your own Mine or Quarry (mines.ts): its ore, worked out or not.
  const node=d.action==='mine'?mineNodeLive(p,q.x,q.y,q.prop):undefined;if(node)return{...q,label:node.label,action:d.action,prompt:node.prompt,empty:node.empty,...(node.ore?{ore:node.ore}:{})};
  const empty=d.action==='equipment'?(own?withClan(clanOf(p),()=>state.equipment[q.prop==='weaponRack'?'weapon':'armour'].every(n=>n<=0)):count(s,q.prop)<=0):s?.itemTaken===true;return{...q,label:d.label,action:d.action,prompt:empty?'Examine empty storage':d.prompt,empty,off:!!s?.off,cleared:!!s?.cleared};});
}
export function useFurniture(p:Player,q:InteriorMap['props'][number],ctx:FurnitureContext,op='',arg=''){
 const I=p.interior,d=FURNITURE[q.prop];if(!I||p.dead||!d)return false;
 const hx=I.x/TILE_SIZE-.5,hy=I.y/TILE_SIZE-.5,solid=interiorSolidGrid(ctx.map);solid[q.y*ctx.map.w+q.x]=0;
 if(Math.hypot(hx-q.x,hy-q.y)>1.65||!clearSight({map:ctx.map,solid},{x:hx,y:hy},q)){toast(p,'Walk closer, with a clear path, to use that.');return true;}
 const id=key(p,q),s=objects.get(id)??{},at={key:I.key,x:(q.x+.5)*TILE_SIZE,y:(q.y+.5)*TILE_SIZE,anchor:{x:I.tx,y:I.ty}};
 const save=()=>{objects.set(id,s);furnitureVersion++;ctx.refresh();};
 const choice=(label:string,action:string,value='',disabled?:string):ChoiceRt=>({label,action:'interiorObject' as any,arg:JSON.stringify({x:q.x,y:q.y,op:action,arg:value}),disabled});
 const show=(text:string,choices:ChoiceRt[]=[])=>furnitureTalk(p,d.label,text,choices,at);
 const safe=()=>!ctx.hostile||!interiorEnemiesNear(p,q.x,q.y,4);
 const reveal=()=>{const lore=loreFor(p,q.prop);lifeOf(p).flags[`worldLore:${lore.id}`]=1;sendJournal(p);return `${lore.title}\n\n${lore.text}`;};
 if(op==='inventory'){closeTalk(p);sendTo(p,{type:'interiorPanel',panel:'inventory'});return true;}
 if(op==='stockpile'){closeTalk(p);sendTo(p,{type:'interiorPanel',panel:'stockpile'});return true;}
 if(d.action==='equipment'){
  const weapon=q.prop==='weaponRack',slot=weapon?'weapon':'armour',tier=Math.min(3,Math.max(1,I.level)) as 1|2|3,price=(weapon?20:30)*tier;
  if(op==='take'){
   if(!safe()){toast(p,'Drive the nearby enemies away before taking equipment.');return true;}
   const parts=arg.split(':'),kind=parts[0],chosenTier=Number(parts[1]);
   if(!['sword','spear','axe','bow','head','chest','offhand'].includes(kind)||!Number.isInteger(chosenTier)||chosenTier<1||chosenTier>3||weapon!==['sword','spear','axe','bow'].includes(kind))return true;
   if(heroProfileOf(p).inventory.length>=40){toast(p,'Your equipment inventory is full. The equipment stays here.');return true;}
   if(ctx.own){withClan(clanOf(p),()=>handleTakeFromArmoury(p,slot,chosenTier,undefined,weapon?kind:undefined,weapon?undefined:kind));ctx.refresh();}
   else{
    if(count(s,q.prop)<=0){toast(p,'The stand is empty.');return true;}
    if(chosenTier!==tier)return true;
    const paid=ctx.hostile?0:price;
    if(withClan(clanOf(p),()=>state.stock.gold)<paid){toast(p,`The owner asks ${paid} gold. Nothing has been taken.`);return true;}
    const item=grantFoundEquipment(p,weapon?'weapon':kind==='head'?'head':kind==='offhand'?'offhand':'chest',tier,weapon?kind:undefined);
    if(!item)return true;
    withClan(clanOf(p),()=>{state.stock.gold-=paid;});const owner=ctx.siteId?sites.get(ctx.siteId):undefined;if(owner)owner.stock.gold=(owner.stock.gold??0)+paid;
    s.remaining=count(s,q.prop)-1;save();toast(p,`${paid?'Bought':'Collected'} ${item.name}. Added to your inventory.`);
   }
  }
  const left=ctx.own?withClan(clanOf(p),()=>state.equipment[slot].reduce((a,b)=>a+b,0)):count(s,q.prop),rows:ChoiceRt[]=[];
  for(const t of ctx.own?[1,2,3]:[tier])for(const part of weapon?['sword','spear','axe','bow']:['chest','head','offhand']){
   const name=part==='chest'?'body armour':part==='head'?'helmet':part==='offhand'?'shield':part;
   rows.push(choice(`${ctx.own?'Withdraw':ctx.hostile?'Take':'Buy'} tier ${t} ${name}${!ctx.own&&!ctx.hostile?` (${price} gold)`:''}`,'take',`${part}:${t}`,left<=0?'Empty':ctx.own&&withClan(clanOf(p),()=>state.equipment[slot][t-1])<=0?'None in your armoury':undefined));
  }
  rows.push(choice('Open inventory','inventory'));
  show(ctx.own?`This stand draws from your shared armoury (${left} pieces). It creates no equipment; stock one by forging or looting.`:`${left} pieces remain. ${ctx.hostile?'These are abandoned or captured supplies.':'These belong to the household. The owner will sell a piece for the listed price.'}`,rows);return true;
 }
 if(d.action==='light'||d.action==='fire'){
  if(op==='toggle'){
   if(!ctx.own&&!ctx.hostile){show('The household tends this light. Ask before changing its fire.');return true;}
   if(s.off&&d.action==='fire'){
    const life=lifeOf(p);if((life.pack.wood??0)>0)life.pack.wood!--;else if(!withClan(clanOf(p),()=>{if(state.stock.wood<1)return false;state.stock.wood--;return true;})){toast(p,'You need one wood to rekindle the hearth.');return true;}
   }
   s.off=!s.off;save();toast(p,s.off?'The flame is out.':'The flame catches.');
  }
  if(op==='rest'){if(s.off){toast(p,'Light the hearth before resting beside it.');return true;}withClan(clanOf(p),()=>handleHeroAction(p,'rest',undefined));return true;}
  show(s.off?'The flame has been put out.':d.action==='fire'?'A tended hearth offers warmth and a place to recover.':'A small flame makes this corner easier to see.',[choice(s.off?'Light it'+(d.action==='fire'?' (1 wood)':''):'Extinguish it','toggle'),...(d.action==='fire'?[choice('Rest beside the fire','rest')]:[])]);return true;
 }
 if(d.action==='rest'||d.action==='meal'){
  if(q.prop==='throne'&&!ctx.own&&!ctx.hostile){show('This is the lord’s seat. There are benches for visitors.');return true;}
  if(op==='rest'){withClan(clanOf(p),()=>handleHeroAction(p,'rest',undefined));return true;}
  if(op==='eat'){withClan(clanOf(p),()=>handleHeroAction(p,'eat',undefined));return true;}
  show(d.action==='meal'?'Set down your own provisions here. Eating uses the food you already carry or own.':'Take a quiet rest. Moving gets you back to work.',[choice(d.action==='meal'?'Eat your provisions':'Rest here',d.action==='meal'?'eat':'rest')]);return true;
 }
 if(d.action==='read'||d.action==='altar'){
  if(op==='pray'){const f=lifeOf(p).flags,k='quietPrayerDay';if(f[k]===gameDay()+1){show('You have already kept a quiet vigil today.');return true;}f[k]=gameDay()+1;lifeOf(p).rest=Math.min(100,lifeOf(p).rest+8);show('A little stillness steadies you. The prayer promises neither wealth nor an easy undoing of loss.');return true;}
  if(op==='alms'){const f=lifeOf(p).flags,k='almsDay';if(f[k]===gameDay()+1){show('Your gift is already being shared today.');return true;}if(!withClan(clanOf(p),()=>{if(state.stock.grain<2)return false;state.stock.grain-=2;return true;})){show('Two grain are needed for the alms basket. Nothing has been taken.');return true;}f[k]=gameDay()+1;show('Two grain go to the parish kitchen. The clerk records a gift made freely.');return true;}
  if(op==='search'&&ctx.hostile){return supply();}
  show(reveal(),[...(d.action==='altar'?[choice('Keep a quiet prayer','pray'),choice('Give 2 grain to the poor','alms')]:[]),...(ctx.hostile&&q.prop==='shelf'?[choice(s.itemTaken?'Shelf searched':'Search the drawers','search',undefined,s.itemTaken?'Already searched':undefined)]:[])]);return true;
 }
 if(d.action==='wardrobe'){
  if(ctx.own){sendTo(p,{type:'interiorPanel',panel:'inventory'});return true;}
  if(ctx.hostile)return supply();show('These clothes belong to the household. Ask the tailor about buying equipment.');return true;
 }
 if(d.action==='supplies'){
  if(ctx.own){sendTo(p,{type:'interiorPanel',panel:'stockpile'});return true;}
  if(!ctx.hostile){show('These supplies belong to this household. Use the market or ask its keeper for trade.');return true;}
  return supply();
 }
 function supply(){
  if(!safe()){toast(p,'Enemies are too close to search safely.');return true;}
  if(s.itemTaken){show('You have already searched this.');return true;}
  const bones=['skullBones','fallenSkeleton','sarcophagus'].includes(q.prop),wardrobe=q.prop==='wardrobe';
  s.goods??=bones||wardrobe||q.prop==='hay'?{}:{[q.prop==='sacks'?'grain':'wood']:2};
  for(const good of Object.keys(s.goods) as PackGood[]){const n=Math.min(s.goods[good]??0,Math.max(0,Math.floor((PACK_CAP-packWeight(lifeOf(p)))/PACK_WEIGHT[good])));if(n){lifeOf(p).pack[good]=(lifeOf(p).pack[good]??0)+n;s.goods[good]!-=n;toast(p,`Collected ${n} ${PACK_LABEL[good].toLowerCase()}.`);}}
  if(Object.values(s.goods).some(n=>n!>0)){save();toast(p,'Your pack is full. The remaining supplies stay here.');return true;}
  withClan(clanOf(p),()=>{if(bones)addItem('bones',1);else if(wardrobe)state.stock.clothes++;else if(q.prop==='hay')addItem('hay',2);});
  s.itemTaken=true;save();show(bones?'You recover a few old bones and leave the remains respectfully arranged.':wardrobe?'You recover one serviceable set of clothes for the stockpile.':'The useful supplies have been collected.');return true;
 }
 // Mining rework: the nodes of your own Mine / Quarry respawn and yield by its rules (mines.ts mineNodeHarvest).
 if(d.action==='mine'&&mineNodeHarvest(p,q.x,q.y,q.prop))return true;
 if(d.action==='clear'||d.action==='mine'){
  if(s.cleared){show('The loose material has already been cleared.');return true;}
  if(!safe()){toast(p,'Clear the nearby enemies before working here.');return true;}
  if(d.action==='mine'&&!withClan(clanOf(p),()=>itemCount('stonePick')+itemCount('bronzePick')+itemCount('ironPick')>0)){toast(p,'You need a pickaxe in your stores to work this rock.');return true;}
  const good:PackGood=q.prop==='overgrowth'?'wood':'rock',n=q.prop==='cobweb'?0:2;
  if(n&&packWeight(lifeOf(p))+n*PACK_WEIGHT[good]>PACK_CAP){toast(p,'Make room in your carried resources first.');return true;}
  if(p.attackCooldownTicks>0)return true;p.attackCooldownTicks=15;
  if(n)lifeOf(p).pack[good]=(lifeOf(p).pack[good]??0)+n;
  if(q.prop==='mineralNode')withClan(clanOf(p),()=>addItem((I.variant>=2?'goldOre':I.variant===1?'coal':'copperOre') as ItemId,1));
  s.cleared=true;save();toast(p,q.prop==='cobweb'?'Cleared the web.':`Cleared the loose material: +${n} ${PACK_LABEL[good].toLowerCase()}.`);return true;
 }
 if(d.action==='work'){if(ctx.work())return true;show('This station is incomplete or no longer serviceable. A sound workshop needs its working fittings.');return true;}
 if(d.action==='travel'){show('Step onto the stairs or shaft opening to travel.');return true;}
 show(q.prop==='timberProp'?'This timber is carrying the roof. Pulling it out would risk a collapse.':q.prop==='banditTower'?'The platform commands the approach. Its ropes and supports are fixed in place.':'The workmanship is worn but still useful. It belongs to this place.');return true;
}
let furnitureVersion=0;
const mapCache=new WeakMap<InteriorMap,Map<string,{version:number;map:InteriorMap;solid:Uint8Array}>>();
export function furnitureRoomMap(roomKey:string,variant:number,storey:number,base:{map:InteriorMap;solid:Uint8Array}):{map:InteriorMap;solid:Uint8Array}{
 const id=`${roomKey}#${variant}#${storey}`,cache=mapCache.get(base.map)??new Map();mapCache.set(base.map,cache);const hit=cache.get(id);if(hit?.version===furnitureVersion)return hit;
 const props=base.map.props.filter(q=>!objects.get(`${id}:${q.x},${q.y}:${q.prop}`)?.cleared);if(props.length===base.map.props.length)return base;const map={...base.map,props},entry={version:furnitureVersion,map,solid:interiorSolidGrid(map)};cache.set(id,entry);return entry;
}
export function furnitureSave(){return [...objects.entries()].map(([k,s])=>[k,structuredClone(s)]);}
export function restoreFurniture(raw:unknown){objects.clear();furnitureVersion++;if(!Array.isArray(raw))return;for(const row of raw.slice(0,20000)){if(!Array.isArray(row)||typeof row[0]!=='string'||row[0].length>100||!row[1]||typeof row[1]!=='object')continue;const o=row[1],s:ObjectState={};if(typeof o.remaining==='number'&&Number.isFinite(o.remaining))s.remaining=Math.max(0,Math.min(3,Math.floor(o.remaining)));for(const k of ['off','cleared','itemTaken'] as const)if(o[k]===true)s[k]=true;if(o.goods&&typeof o.goods==='object'){s.goods={};for(const [g,n]of Object.entries(o.goods))if(g in PACK_WEIGHT&&typeof n==='number'&&Number.isFinite(n)&&n>0)s.goods[g as PackGood]=Math.min(10,Math.floor(n));}objects.set(row[0],s);}}
export function resetFurniture(){objects.clear();furnitureVersion++;}
