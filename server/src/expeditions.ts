import {companionEntries,companionAction} from "./companions.js";
import {horseAdventureEntries,trainAdventureHorse} from "./animals.js";
import {randomUUID} from 'node:crypto';
import {TileType,TILE_SIZE,type GearItem} from '@colony/shared/protocol';
import {CONTRACTS,CONTRACT_BY_ID,ADVENTURE_GEAR,adventureGear,type AdventureGearId,type ContractDefinition} from '@colony/shared/expeditions';
import {adventureHash,type JournalEntry} from '@colony/shared/adventure';
import {interiorLayoutAccessible,type InteriorMap,type InteriorProp} from '@colony/shared/interiors';
import {state,players,heroProfiles,sites} from './state.js';
import type {Player} from './types.js';
import {lifeOf,toast,gainSkill} from './herolife.js';
import {heroProfileOf,recomputeHeroProfile} from './heroes.js';
import {specialResidences,type SpecialResidence} from './specialCast.js';
import {explorationSave,explorationRescued} from './adventureLoot.js';
import {mineView} from './mines.js';
import {tileIndicesOf,setTile} from './chunks.js';
import {tileIndex,inBounds,ownerAt} from './tiles.js';
import {withClan,clanOf,clanIdAt} from './clans.js';
import {adjustRelation} from './sites.js';
import {revealAround,circleOffsets,broadcastTileUpdate} from './net.js';
import {refreshInteriorView} from './interiors.js';
const prefix=(id:string)=>`adv:${id}:`;
const fact=(key:string)=>[...heroProfiles.values()].some(p=>!!p.life?.flags[key]);
export const adventureWorldFact=fact;
const flag=(p:Player,id:string,key:string)=>lifeOf(p).flags[prefix(id)+key]??0;
function point(p:Player,id:string,which:'target'|'issuer') {const f=lifeOf(p).flags,k=prefix(id)+which;return f[k+':set']?{x:f[k+':x'],y:f[k+':y']}:undefined;}
function savePoint(p:Player,id:string,which:string,at:{x:number;y:number}) {const f=lifeOf(p).flags,k=prefix(id)+which;f[k+':set']=1;f[k+':x']=at.x;f[k+':y']=at.y;}
function issuer(){const h=specialResidences().find(h=>h.id==='hesta-ironroot');return h?{x:h.tx,y:h.ty}:undefined;}
function targetExists(at:{x:number;y:number},c:ContractDefinition){if(!inBounds(at.x,at.y))return false;const t=state.tiles[tileIndex(at.x,at.y)];return c.kind==='mine'?mineTiles.includes(t):t===({camp:TileType.CampEntrance,cave:TileType.CaveEntrance,ruin:TileType.RuinEntrance}[c.kind]);}
const mineTiles=[TileType.IronMinePost,TileType.RockMinePost,TileType.CopperMine,TileType.CoalMine,TileType.TinMine,TileType.GoldMine,TileType.LeadMine,TileType.LimeQuarry];
function bindTarget(p:Player,c:ContractDefinition){
 const old=point(p,c.id,'target');if(old&&targetExists(old,c))return old;
 const start=issuer();if(!start)return;
 const used=new Set(CONTRACTS.filter(q=>q.id!==c.id&&q.family===c.family&&flag(p,q.id,'accepted')).map(q=>point(p,q.id,'target')).filter(Boolean).map(q=>`${q!.x},${q!.y}`));
 const candidates=c.kind==='mine'?mineTiles.flatMap(t=>[...tileIndicesOf(t)].map(i=>({x:i%state.WORLD_TILES_X,y:Math.floor(i/state.WORLD_TILES_X)}))):[...new Map(specialResidences().filter(h=>h.hostile&&h.venue===c.kind).map(h=>[`${h.tx},${h.ty}`,{x:h.tx,y:h.ty}])).values()];
 if(c.kind==='mine')for(let n=candidates.length-1;n>=0;n--)if(!['infested','cleared'].includes(mineView(candidates[n].x,candidates[n].y)?.status??''))candidates.splice(n,1);
 candidates.sort((a,b)=>Math.hypot(a.x-start.x,a.y-start.y)-Math.hypot(b.x-start.x,b.y-start.y));return candidates.find(q=>!used.has(`${q.x},${q.y}`)&&targetExists(q,c));
}
function near(p:Player,at:{x:number;y:number}){return p.interior?p.interior.tx===at.x&&p.interior.ty===at.y:Math.hypot(p.x/TILE_SIZE-.5-at.x,p.y/TILE_SIZE-.5-at.y)<=3;}
function ready(p:Player,c:ContractDefinition){const at=point(p,c.id,'target');if(!at)return false;const k=`${at.x},${at.y}`;return !!flag(p,c.id,'main')||(c.family==='rescue'&&explorationRescued(k))||(c.family==='investigation'&&fact(`clue:${k}`))||(['hunt','restoration'].includes(c.family)&&mineView(at.x,at.y)?.status==='cleared');}
function change(){refreshInteriorView();for(const p of players.values())if(p.interior){p.interior.sent='';p.interior.nextRefresh=0;}}
export function expeditionEvent(p:Player,type:string,key:string,id=''){
 const f=lifeOf(p).flags;
 // Durable world evidence also makes late-accepted leads and reconnects safe.
 if(['clear','unlock','rescue','clue','alarm','sabotage'].includes(type)||type==='loot'&&id.startsWith('chest:'))f[`adv:evidence:${type}:${key}`]=1;
 for(const prof of heroProfiles.values()){
  const flags=prof.life?.flags;if(!flags)continue;
  for(const c of CONTRACTS){if(!flags[prefix(c.id)+'accepted']||flags[prefix(c.id)+'done'])continue;const x=flags[prefix(c.id)+'target:x'],y=flags[prefix(c.id)+'target:y'];if(`${x},${y}`!==key)continue;
   if(type==='rescue'&&c.family==='rescue'||type==='loot'&&id.startsWith('chest:')&&c.family==='recovery'||type==='clear'&&['hunt','restoration'].includes(c.family)||type==='clue'&&c.family==='investigation'||type==='sabotage'&&c.family==='sabotage')flags[prefix(c.id)+'main']=1;
   if(c.family==='rescue'&&type==='loot'&&id.startsWith('chest:')||['recovery','hunt','restoration'].includes(c.family)&&type==='clue'||c.family==='investigation'&&type==='unlock')flags[prefix(c.id)+'bonus']=1;
   if(c.family==='sabotage'&&type==='alarm')flags[prefix(c.id)+'alarmed']=1;
  }
 }
}
function retrospective(p:Player,c:ContractDefinition,at:{x:number;y:number}){const k=`${at.x},${at.y}`,f=lifeOf(p).flags,main=c.family==='rescue'?'rescue':c.family==='recovery'?'loot':c.family==='sabotage'?'sabotage':c.family==='investigation'?'clue':'clear';if(fact(`adv:evidence:${main}:${k}`)||c.family==='recovery'&&Object.entries(explorationSave(k,0)?.objects??{}).some(([id,s])=>id.startsWith('chest:')&&s.opened))f[prefix(c.id)+'main']=1;}
export function expeditionEntries(p:Player):JournalEntry[]{
 const entries:JournalEntry[]=p.interior?.templateId==='mine'?[{id:'exp:stealth',title:'A quiet approach',status:'active',text:'Sneaking slows movement. Walls and darkness hide you from sleeping enemies; attacking reveals you. Lamps can be extinguished. Alert enemies do not immediately forget you.',objective:p.adventureSneak?'Sneaking':'Visible',reward:'Avoid unnecessary fights',choices:[{id:'exp:sneak',label:p.adventureSneak?'Stand up':'Sneak'}]}]:[],f=lifeOf(p).flags,origin=issuer();if(!origin)return entries;
 entries.push(...companionEntries(p),...horseAdventureEntries(p));
 for(const c of CONTRACTS){
  const accepted=!!flag(p,c.id,'accepted'),done=!!flag(p,c.id,'done');
  // Each family's variations unlock in order. No endless stream of identical jobs.
  const variation=Number(c.id.split('-')[1]);if(!accepted&&variation>0&&!flag(p,`${c.family}-${variation-1}`,'done'))continue;
  const at=accepted?point(p,c.id,'target'):bindTarget(p,c);if(!at&&!accepted)continue;
  const isReady=accepted&&!done&&ready(p,c),report=point(p,c.id,'issuer')??origin,valid=!!at&&targetExists(at,c);
  const bonus=!!flag(p,c.id,'bonus')||c.family==='sabotage'&&!!flag(p,c.id,'main')&&!flag(p,c.id,'alarmed');
  const choices:NonNullable<JournalEntry['choices']>=[];
  if(!accepted)choices.push({id:`exp:accept:${c.id}`,label:'Accept and track'});
  else if(!done&&isReady)for(const[id,d]of Object.entries(ADVENTURE_GEAR))choices.push({id:`exp:claim:${c.id}:${id}`,label:`Choose ${d.name} — ${d.benefit} Tradeoff: ${d.cost}`});
  if(accepted&&!done&&!valid)choices.push({id:`exp:retarget:${c.id}`,label:'Find another valid location'});
  entries.push({id:'exp:'+c.id,title:c.title,status:done?'complete':accepted?'active':'available',text:c.brief,objective:done?c.id==='rescue-0'?'Wren now works at Hesta’s forge. Your commission recipes and the town projects are available.':'The issuer remembers your help.':isReady?`Return to Hesta’s forge (${report.x}, ${report.y}) and choose your reward.`:c.objective,progress:done?'Reported':`${isReady?'Objective complete':'Expedition'} · Optional: ${c.optional} ${bonus?'✓':''}`,reward:`${c.gold} shared gold${bonus?' + 15 optional gold':''}; choose one practical item; learn its commission recipe`,blocked:accepted&&!valid?'The location has changed; choose a replacement.':isReady&&!near(p,report)?'Return to the issuer to receive this reward.':undefined,marker:{...(isReady||done?report:at??report),label:isReady?'Hesta’s forge':c.title},choices});
 }
 if(f[prefix('rescue-0')+'done']){
  for(const[id,title,cost,text]of [['forge','Rebuild the apprentice’s bench','12 iron, 15 wood','Adds a working bench and unlocks commissions for everyone who helped.'],['road','Repair the approach road','20 rock, 10 wood','Replaces up to 20 existing dirt-road tiles by the forge with cobbles.']])entries.push({id:'project:'+id,title,status:fact('adv:project:'+id)?'complete':'available',text,objective:`Return to Hesta’s forge. Contribute ${cost}.`,reward:'Visible improvement; +5 local relation',choices:fact('adv:project:'+id)?[]:[{id:'exp:project:'+id,label:'Contribute materials'}],marker:{...origin,label:'Hesta’s forge'}});
 }
 const completed=CONTRACTS.filter(c=>flag(p,c.id,'done')).length;
 if(completed)entries.push({id:'goals:adventure',title:completed>=6?'Title earned: Friend of the roads':completed>=3?'Title earned: Proven wayfarer':'Title earned: Apprentice’s ally',status:'active',text:`${completed} expeditions reported. Home trophies become available after your first adventure.`,objective:'Display your adventure trophy in an owned home. Train a horse at a stable. Travel with one companion.',reward:'A furnished home and a personal travelling party',choices:[{id:'exp:trophy',label:'Display a trophy in this home'}]});
 return entries;
}
export function grantAdventureGear(p:Player,id:AdventureGearId){const prof=heroProfileOf(p);if(prof.inventory.length>=40)return false;const base=id==='steady'?{}:id==='wayfarer'?{}:{damagePct:8};prof.inventory.push(adventureGear(id,randomUUID(),1,base));recomputeHeroProfile(prof);return true;}
export function expeditionAction(p:Player,raw:string):boolean{
 if(!raw.startsWith('exp:'))return false;if(p.dead||state.isPaused)return true;
 const[,op,id,gear]=raw.split(':'),c=CONTRACT_BY_ID.get(id),f=lifeOf(p).flags;
 if((op==='accept'||op==='retarget')&&c){
  if(flag(p,id,'done'))return true;
  const idx=Number(id.split('-')[1]);if(idx>0&&!flag(p,`${c.family}-${idx-1}`,'done'))return true;
  if(op==='retarget'&&(!flag(p,id,'accepted')||targetExists(point(p,id,'target')??{x:-1,y:-1},c)))return true;
  if(op==='accept'&&flag(p,id,'accepted'))return true;
  const target=bindTarget(p,c),home=issuer();if(!target||!home){toast(p,'No suitable reachable location is available in this world.');return true;}
  savePoint(p,id,'target',target);savePoint(p,id,'issuer',home);f[prefix(id)+'accepted']=1;f['adv:version']=1;retrospective(p,c,target);revealAround(target.x,target.y,circleOffsets(3));
  for(const k of Object.keys(f))if(k.startsWith('journal:track:'))delete f[k];f[`journal:track:exp:${id}`]=1;toast(p,`${c.title}: destination marked. No time limit.`);return true;
 }
 if(op==='claim'&&c){
  const at=point(p,id,'issuer');if(!at||!flag(p,id,'accepted')||flag(p,id,'done')||!ready(p,c)||!Object.hasOwn(ADVENTURE_GEAR,gear))return true;
  if(!near(p,at)){toast(p,'Return to the issuer’s forge to report.');return true;}
  if(!grantAdventureGear(p,gear as AdventureGearId)){toast(p,'Your inventory is full. The reward remains pending; make room and return.');return true;}
  f[prefix(id)+'done']=1;f[`recipe:adventure-${gear}`]=1;const shared=`adv:paid:${p.clan}:${id}`;
  if(!fact(shared)){withClan(clanOf(p),()=>state.stock.gold+=c.gold+(flag(p,id,'bonus')||c.family==='sabotage'&&!flag(p,id,'alarmed')?15:0));f[shared]=1;}
  gainSkill(p,'speech',12);const s=[...sites.values()].find(s=>s.num===ownerAt(tileIndex(at.x,at.y)));if(s)adjustRelation(p.clan,s.id,5);
  toast(p,id==='rescue-0'?'Wren returns to Hesta’s forge. Your chosen item and its recipe are ready.':'Expedition reported. Your reward and commission recipe are ready.');change();return true;
 }
 if(op==='project'&&['forge','road'].includes(id)){
  const at=issuer();if(!at||!f[prefix('rescue-0')+'done']||fact('adv:project:'+id))return true;
  if(!near(p,at)){toast(p,'Return to Hesta’s forge to contribute.');return true;}
  const cost=id==='forge'?{iron:12,wood:15,rock:0}:{iron:0,wood:10,rock:20};
  withClan(clanOf(p),()=>{if(state.stock.iron<cost.iron||state.stock.wood<cost.wood||state.stock.rock<cost.rock){toast(p,'The stockpile lacks the listed materials. Nothing was spent.');return;}
   const roads:number[]=[];if(id==='road'){const todo=[tileIndex(at.x,at.y)],seen=new Set<number>();while(todo.length&&seen.size<400&&roads.length<20){const i=todo.shift()!;if(seen.has(i))continue;seen.add(i);const x=i%state.WORLD_TILES_X,y=Math.floor(i/state.WORLD_TILES_X);if(Math.hypot(x-at.x,y-at.y)>10)continue;if(state.tiles[i]===TileType.Road)roads.push(i);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(inBounds(x+dx,y+dy))todo.push(tileIndex(x+dx,y+dy));}if(!roads.length){toast(p,'There is no dirt approach road left to repair. Nothing was spent.');return;}}
   state.stock.iron-=cost.iron;state.stock.wood-=cost.wood;state.stock.rock-=cost.rock;for(const i of roads){setTile(i,TileType.CobbleRoad);broadcastTileUpdate(i%state.WORLD_TILES_X,Math.floor(i/state.WORLD_TILES_X),TileType.CobbleRoad);}f['adv:project:'+id]=1;
   const s=[...sites.values()].find(s=>s.num===ownerAt(tileIndex(at.x,at.y)));if(s)adjustRelation(p.clan,s.id,5);toast(p,id==='forge'?'The apprentice’s commission bench is restored.':'The approach road is now cobbled.');change();});return true;
 }
 if(op==='sneak'){if(p.interior?.templateId==='mine'){p.adventureSneak=!p.adventureSneak;toast(p,p.adventureSneak?'Sneaking. Darkness reduces detection; enemies already alerted keep searching.':'Standing.');}return true;}
 if(op==='trophy'){const I=p.interior;if(!I||!['house','hall'].includes(I.templateId)||ownerAt(tileIndex(I.tx,I.ty))!==0||clanIdAt(I.tx,I.ty)!==p.clan||!CONTRACTS.some(c=>flag(p,c.id,'done'))){toast(p,'Enter your own home after completing an expedition.');return true;}f[`adv:trophy:${I.key}`]=1;change();return true;}
 return true;
}
export function expeditionResidences(homes:SpecialResidence[]){
 const rescued=fact(prefix('rescue-0')+'done'),h=homes.find(h=>h.id==='hesta-ironroot');if(!rescued||!h)return fact(prefix('rescue-0')+'accepted')?homes.filter(q=>q.id!=='wren-ironroot'):homes;
 return homes.map(q=>q.id==='wren-ironroot'?{...q,tx:h.tx,ty:h.ty,venue:h.venue,place:h.place}:q);
}
const roomCache=new WeakMap<InteriorMap,Map<string,InteriorMap>>();
export function expeditionRoomMap(tx:number,ty:number,map:InteriorMap){
 const home=issuer(),forge=home?.x===tx&&home.y===ty&&fact('adv:project:forge'),trophy=fact(`adv:trophy:${tx},${ty}`);if(!forge&&!trophy)return map;
 const key=`${forge}:${trophy}`,cache=roomCache.get(map)??new Map<string,InteriorMap>();roomCache.set(map,cache);const old=cache.get(key);if(old)return old;
 const next={...map,props:map.props.map(q=>({...q}))};for(const prop of [forge?'workbench':undefined,trophy?'banner':undefined].filter(Boolean) as InteriorProp[]){outer:for(let y=1;y<map.h-1;y++)for(let x=1;x<map.w-1;x++){if(map.cells[y*map.w+x]!=='.'||map.slots.some(q=>q.x===x&&q.y===y)||next.props.some(q=>Math.hypot(q.x-x,q.y-y)<2)||Math.hypot(x-map.spawn.x,y-map.spawn.y)<3||Math.hypot(x-map.exit.x,y-map.exit.y)<3)continue;if([...players.values()].some(p=>p.interior?.tx===tx&&p.interior.ty===ty&&Math.hypot(p.interior.x/32-.5-x,p.interior.y/32-.5-y)<1))continue;next.props.push({prop,x,y,facing:'s'});if(interiorLayoutAccessible(next))break outer;next.props.pop();}}
 cache.set(key,next);return next;
}
export function adventureRecipes(p:Player,tile:TileType){if(tile!==TileType.Blacksmith)return [];return (Object.keys(ADVENTURE_GEAR) as AdventureGearId[]).filter(id=>lifeOf(p).flags[`recipe:adventure-${id}`]||fact('adv:project:forge')).map(id=>({id:'adventure-'+id,label:`Commission ${ADVENTURE_GEAR[id].name}`,amount:1,seconds:25,level:2,stationLevel:1,stock:{iron:8,wood:6},adventureGear:id}));}
