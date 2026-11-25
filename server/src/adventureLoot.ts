import {explorationPlan,adventureHash,EXPLORATION_REACH,BOSS_PROFILES,type ExplorationKind,type ExplorationPlan,type ExplorationObject,type ExplorationView} from '@colony/shared/adventure';
import {interiorSolidGrid,type InteriorMap} from '@colony/shared/interiors';
import {PACK_CAP,PACK_WEIGHT,PACK_LABEL,type PackGood} from '@colony/shared/herolife';
import {TILE_SIZE} from '@colony/shared/protocol';
import {type ItemId} from '@colony/shared/progression';
import {encounterKind} from '@colony/shared/encounters';
import {SPECIAL_BY_ID} from '@colony/shared/specialCast';
import {state,players,hearths} from './state.js';
import type {Player} from './types.js';
import {lifeOf,packWeight,furnitureTalk,toast} from './herolife.js';
import {heroProfileOf,grantRelic,playerDamage,playerAttackCooldownTicks} from './heroes.js';
import {addItem} from './progression.js';
import {clanOf,withClan} from './clans.js';
import {refreshInteriorView} from './interiors.js';
import {specialAt} from './specialCast.js';
import {storyEvent,sendJournal} from './story.js';
import {rescuePrisoners} from './people.js';
import {landmarkHearth} from './mines.js';
interface Loot {goods:Partial<Record<PackGood,number>>;items:Partial<Record<ItemId,number>>;gold:number;relic:boolean}
interface ObjectState {hp?:number;opened?:boolean;loot?:Loot}
export interface ExplorationSave {version:1;objects:Record<string,ObjectState>}
interface Room {key:string;li:number;kind:ExplorationKind;base:InteriorMap;plan:ExplorationPlan;states:Record<string,ObjectState>;version:number;cache?:{version:number;map:InteriorMap;solid:Uint8Array}}
const rooms=new Map<string,Room>(),saved=new Map<string,ExplorationSave>();
const roomKey=(key:string,li:number)=>`${key}#${li}`;
function change(r:Room){r.version++;for(const p of players.values())if(p.interior?.key===r.key){p.interior.sent='';p.interior.nextRefresh=0;}refreshInteriorView(r.key);}
function stateOf(r:Room,o:ExplorationObject):ObjectState{return r.states[o.id]??={hp:o.maxHp};}
function empty(s:ObjectState){return !!s.opened&&(!s.loot||(!s.loot.relic&&!s.loot.gold&&!Object.values(s.loot.goods).some(n=>n!>0)&&!Object.values(s.loot.items).some(n=>n!>0)));}
export function explorationMap(key:string,li:number,base:{map:InteriorMap;solid:Uint8Array},kind?:ExplorationKind){
 if(!kind)return base;const id=roomKey(key,li);let r=rooms.get(id);
 if(!r){const plan=explorationPlan(base.map,kind,adventureHash(`${state.worldNoiseSalt}:${id}`));r={key,li,kind,base:base.map,plan,states:saved.get(id)?.objects??{},version:0};rooms.set(id,r);}
 // Mine upgrades add a native shaft to an already explored layer. Keep its saved
 // containers and carved storeroom, but refresh access props from the new base.
 if(r.base!==base.map){
  const access=new Set(['mineShaft','stairsUp','stairsDown']);
  r.plan.map={...r.plan.map,slots:base.map.slots,props:[...r.plan.map.props.filter(p=>!access.has(p.prop)),...base.map.props.filter(p=>access.has(p.prop))]};
  r.base=base.map;r.version++;
 }
 if(r.cache?.version===r.version)return r.cache;
 const props=r.plan.map.props.filter(p=>{
  const o=r!.plan.objects.find(o=>o.x===p.x&&o.y===p.y);if(!o)return true;const s=r!.states[o.id];
  return !(s?.opened&&(o.kind==='gate'||o.kind==='cage'||['crate','barrel','pot'].includes(o.kind))||o.kind==='cache'&&s&&empty(s));
 });
 const map={...r.plan.map,props};return r.cache={version:r.version,map,solid:interiorSolidGrid(map)};
}
function current(p:Player){const I=p.interior;return I?rooms.get(roomKey(I.key,encounterKind(I.tile)?0:I.variant)):undefined;}
function flag(r:Room,o:ExplorationObject){return `explore:${r.key}:${r.li}:${o.id}`;}
function prompt(p:Player,r:Room,o:ExplorationObject){const s=stateOf(r,o),flags=lifeOf(p).flags;if(o.kind==='note')return flags[flag(r,o)]?'Read again':'Read';if(o.kind==='key')return flags[`keys:${r.key}`]?'Keys collected':'Take keys';if(o.kind==='gate')return s.opened?'Open':'Unlock';if(o.kind==='cage')return s.opened?'Prisoners freed':'Free prisoners';if(empty(s))return 'Empty';if(['crate','barrel','pot'].includes(o.kind)&&!s.opened)return 'Break';if(o.kind==='cache'&&!s.opened)return 'Search';return o.locked&&!s.opened?'Unlock':'Loot';}
export function explorationView(p:Player,cleared:boolean):ExplorationView|undefined{
 const r=current(p);if(!r)return;const flags=lifeOf(p).flags;
 return{keys:flags[`keys:${r.key}`]?1:0,cleared,objects:r.plan.objects.map(o=>{const s=stateOf(r,o);return{...o,hp:s.hp,opened:!!s.opened,empty:empty(s),read:!!flags[flag(r,o)],available:!(empty(s)||['gate','cage'].includes(o.kind)&&s.opened||o.kind==='key'&&flags[`keys:${r.key}`]),prompt:prompt(p,r,o)};})};
}
function reach(p:Player,r:Room,o:ExplorationObject,max=EXPLORATION_REACH){
 const I=p.interior!,hx=I.x/TILE_SIZE-.5,hy=I.y/TILE_SIZE-.5,d=Math.hypot(hx-o.x,hy-o.y);if(d>max)return false;
 const grid=r.cache?.solid??interiorSolidGrid(r.plan.map),steps=Math.max(1,Math.ceil(d*5));
 for(let n=1;n<steps;n++){const x=Math.round(hx+(o.x-hx)*n/steps),y=Math.round(hy+(o.y-hy)*n/steps);if(x===o.x&&y===o.y)continue;if(grid[y*r.plan.map.w+x])return false;}return true;
}
function rollLoot(r:Room,o:ExplorationObject):Loot{
 const n=adventureHash(`${state.worldNoiseSalt}:${r.key}:${o.id}`),goods:Loot['goods']={},items:Loot['items']={};const treasure=o.kind==='chest',cache=o.kind==='cache';
 if(r.kind==='camp'){goods[n%2?'grain':'wood']=2+n%4;if(treasure)goods.iron=3+n%3;items.hide=cache?1:0;}
 else if(r.kind==='cave'||r.kind==='mine'){const depth=r.plan.map.underground?.depth??1;goods[r.plan.map.underground?.rockOnly?'rock':depth>=2?'iron':'rock']=2+n%4;if(treasure||cache)items[r.plan.map.underground?.rockOnly?'limestone':depth>=3?(n%2?'goldOre':'leadOre'):depth===2?'coal':'copperOre']=2+n%3;}
 else{goods.rock=1+n%3;if(treasure||cache)items[n%2?'bones':'gems']=1+n%2;}
 return{goods,items,gold:treasure?12+n%14:cache?5+n%7:n%4,relic:treasure&&!!o.locked};
}
function collect(p:Player,r:Room,o:ExplorationObject,s:ObjectState){
 const loot=s.loot??=rollLoot(r,o),life=lifeOf(p),got:string[]=[];
 withClan(clanOf(p),()=>{
  for(const g of Object.keys(loot.goods) as PackGood[]){const amount=loot.goods[g]??0,n=Math.min(amount,Math.max(0,Math.floor((PACK_CAP-packWeight(life)+1e-8)/PACK_WEIGHT[g])));if(n){life.pack[g]=(life.pack[g]??0)+n;loot.goods[g]=amount-n;got.push(`${n} ${PACK_LABEL[g]}`);}}
  for(const [id,n]of Object.entries(loot.items))if(n){addItem(id as ItemId,n);loot.items[id as ItemId]=0;got.push(`${n} ${id}`);}
  if(loot.gold){state.stock.gold+=loot.gold;got.push(`${loot.gold} gold`);loot.gold=0;}
  if(loot.relic){const prof=heroProfileOf(p);if(grantRelic(prof,`exploration:${r.key}:${o.id}`)){loot.relic=false;got.push('a relic');}else if(prof.inventory.length<40){loot.relic=false;state.stock.gold+=25;got.push('25 gold for a duplicate curio');}}
 });
 const remains=!empty(s);toast(p,got.length?`Found ${got.join(', ')}.${remains?' More remains here: make room and return.':''}`:remains?'Inventory full. The remaining loot is safe here.':'This container is empty.');
 storyEvent(p,'loot',r.key,o.id);change(r);sendJournal(p);
}
export interface ExplorationHooks {hostileNear:(x:number,y:number)=>boolean}
export function explorationInteract(p:Player,x?:number,y?:number,hooks?:ExplorationHooks){
 const r=current(p),I=p.interior;if(!r||!I||p.dead)return false;
 const targeted=x!==undefined&&y!==undefined;
 let o:ExplorationObject|undefined;
 if(targeted)o=r.plan.objects.find(o=>o.x===x&&o.y===y);
 else o=r.plan.objects.filter(o=>reach(p,r,o)&&!(['gate','cage'].includes(o.kind)&&stateOf(r,o).opened)&&!(o.kind==='key'&&lifeOf(p).flags[`keys:${r.key}`])&&!empty(stateOf(r,o))).sort((a,b)=>Math.hypot(a.x+.5-I.x/TILE_SIZE,a.y+.5-I.y/TILE_SIZE)-Math.hypot(b.x+.5-I.x/TILE_SIZE,b.y+.5-I.y/TILE_SIZE))[0];
 if(!o)return false;if(!reach(p,r,o)){toast(p,'Walk closer, with a clear path, to use that.');return true;}
 const s=stateOf(r,o),life=lifeOf(p);
 if(o.kind==='note'){
  life.flags[flag(r,o)]=1;life.flags[`clue:${r.key}`]=1;storyEvent(p,'clue',r.key,o.id);
  const [tx,ty]=r.key.split(',').map(Number),cast=specialAt(tx,ty,true);for(const c of cast){life.flags[`known:${c.id}`]=1;life.flags[`lore:${c.id}`]=1;}const hint=cast.map(c=>`${c.name}: ${BOSS_PROFILES[c.id]?.hint??c.hook}`).join('\n\n');
  furnitureTalk(p,o.label,`The writing describes ${r.kind==='camp'?'stolen supplies and captives':r.kind==='cave'?'a lost expedition and an iron-locked store':'burial records and a sealed treasury'}. A marked key opens the storeroom and its coffer.\n\n${hint}`,[],{key:I.key,x:I.x,y:I.y,anchor:{x:I.tx,y:I.ty}});sendJournal(p);return true;
 }
 if(o.kind==='key'){life.flags[`keys:${r.key}`]=1;life.flags[flag(r,o)]=1;toast(p,'Collected the iron key ring. It opens this locations locks.');change(r);sendJournal(p);return true;}
 if(o.locked&&!s.opened&&!life.flags[`keys:${r.key}`]){toast(p,'Locked. Search this location for its iron key ring.');return true;}
 if(o.kind==='gate'){if(!s.opened){s.opened=true;toast(p,'Unlocked the storeroom.');storyEvent(p,'unlock',r.key,o.id);change(r);}return true;}
 if(o.kind==='cage'){
  if(s.opened){toast(p,'The prisoners are already free.');return true;}
  if(hooks?.hostileNear(o.x,o.y)){toast(p,'Drive the nearby guards away before opening the cage.');return true;}
  freeCage(p,r,o,s);return true;
 }
 if(['crate','barrel','pot'].includes(o.kind)&&!s.opened){if(p.attackCooldownTicks>0)return true;p.attackCooldownTicks=playerAttackCooldownTicks(p);s.hp=Math.max(0,(s.hp??o.maxHp??1)-playerDamage(p));if(s.hp>0){toast(p,`${o.label}: ${Math.ceil(s.hp)} strength remaining`);change(r);return true;}s.opened=true;}
 else if(!s.opened){if(hooks?.hostileNear(o.x,o.y)){toast(p,'Enemies are too close to search safely.');return true;}s.opened=true;}
 collect(p,r,o,s);return true;
}
function freeCage(p:Player,r:Room,o:ExplorationObject,s:ObjectState,alreadyRescued=false){
 if(s.opened)return;s.opened=true;lifeOf(p).flags[`rescue:${r.key}`]=1;
 if(!alreadyRescued){const [x,y]=r.key.split(',').map(Number),h=hearths.get(`landmark:${x},${y}`)??landmarkHearth(x,y,true);h.prisoners=2;hearths.set(h.siteId,h);rescuePrisoners(h,'p:'+p.id);}
 const [rx,ry]=r.key.split(',').map(Number),waiting=hearths.get(`landmark:${rx},${ry}`);if(waiting&&(waiting.prisoners??0)>0){waiting.prisonersWaiting=(waiting.prisonersWaiting??0)+(waiting.prisoners??0);waiting.prisonersClan=p.clan??0;waiting.prisoners=0;}
 toast(p,'The captives are free. They will seek shelter with your people.');storyEvent(p,'rescue',r.key,o.id);change(r);sendJournal(p);
}
export function explorationRescued(key:string){const id=roomKey(key,0),r=rooms.get(id);return !!r?.plan.objects.some(o=>o.kind==='cage'&&r.states[o.id]?.opened)||Object.entries(saved.get(id)?.objects??{}).some(([id,s])=>id.startsWith('cage:')&&s.opened);}
export function explorationClear(key:string,p?:Player|null){
 const r=rooms.get(roomKey(key,0));if(!r)return;if(!p){if(r.kind==='camp'){for(const o of r.plan.objects.filter(o=>o.kind==='cage'))stateOf(r,o).opened=true;change(r);}return;}for(const o of r.plan.objects.filter(o=>o.kind==='cage'))freeCage(p,r,o,stateOf(r,o),r.kind==='camp');
}
export function explorationAttack(p:Player,reachTiles:number){const r=current(p);if(!r||p.dead)return false;const o=r.plan.objects.filter(o=>['crate','barrel','pot'].includes(o.kind)&&!stateOf(r,o).opened&&reach(p,r,o,reachTiles)).sort((a,b)=>Math.hypot(a.x+.5-p.interior!.x/TILE_SIZE,a.y+.5-p.interior!.y/TILE_SIZE)-Math.hypot(b.x+.5-p.interior!.x/TILE_SIZE,b.y+.5-p.interior!.y/TILE_SIZE))[0];if(!o)return false;const s=stateOf(r,o);s.hp=Math.max(0,(s.hp??o.maxHp??1)-playerDamage(p));if(s.hp<=0){s.opened=true;collect(p,r,o,s);}else change(r);return true;}
export function explorationSave(key:string,li:number):ExplorationSave|undefined{const id=roomKey(key,li),r=rooms.get(id);return r?{version:1,objects:Object.fromEntries(Object.entries(r.states).map(([id,s])=>[id,{opened:!!s.opened,...(typeof s.hp==='number'?{hp:s.hp}:{}),...(s.loot?{loot:structuredClone(s.loot)}:{})}]))}:saved.get(id);}
export function restoreExploration(key:string,li:number,raw:unknown){
 if(!raw||typeof raw!=='object')return;const d=raw as ExplorationSave;if(d.version!==1||!d.objects||typeof d.objects!=='object')return;
 const objects:Record<string,ObjectState>={};for(const [id,s]of Object.entries(d.objects).slice(0,100)){if(id.length>60||!s||typeof s!=='object')continue;const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(999,Math.floor(v))):0;const next:ObjectState={opened:s.opened===true,...(typeof s.hp==='number'?{hp:num(s.hp)}:{})};if(s.loot){next.loot={gold:num(s.loot.gold),relic:s.loot.relic===true,goods:{},items:{}};for(const [g,n]of Object.entries(s.loot.goods??{}))if(g in PACK_WEIGHT)next.loot.goods[g as PackGood]=num(n);for(const [g,n]of Object.entries(s.loot.items??{}))if(['hide','copperOre','coal','bones','gems','limestone','goldOre','leadOre'].includes(g))next.loot.items[g as ItemId]=num(n);}objects[id]=next;}
 saved.set(roomKey(key,li),{version:1,objects});
}
export function resetExploration(){rooms.clear();saved.clear();}
