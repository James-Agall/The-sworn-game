import {COMPANIONS,type CompanionRole} from '@colony/shared/expeditions';
import {SPECIAL_BY_ID} from '@colony/shared/specialCast';
import {TileType,TILE_SIZE,type ColonistKind} from '@colony/shared/protocol';
import type {JournalEntry} from '@colony/shared/adventure';
import type {InteriorNpcSnapshot,InteriorNpcLive} from '@colony/shared/interiors';
import {state,players,heroProfiles,colonists} from './state.js';
import type {Player,Colonist,HeroProfile} from './types.js';
import {heroProfileOf,playerMaxHp} from './heroes.js';
import {lifeOf,toast} from './herolife.js';
import {spawnSoldierAt} from './creative.js';
import {spawnColonistForPost} from './colonists.js';
import {specialResidences} from './specialCast.js';
import {withClan,clanOf} from './clans.js';
import {findAdjacentWalkable,isWalkableTile} from './pathfinding.js';
import {mineInteriorMap,clearSight,companionInteriorAttack} from './mines.js';
import {damageColonist} from './combat.js';
import {gameDay} from './diplomacy.js';
import {companionRoomGrid,refreshInteriorView} from './interiors.js';
export interface CompanionRecord {version:1;castId:string;role:CompanionRole;command:'follow'|'hold'|'retreat';actor:Colonist;injuredUntil?:number;inside?:{key:string;variant:number;storey:number;x:number;y:number;path:{x:number;y:number}[];repath:number;act:'idle'|'walk'|'work'}}
const record=(p:Player)=>heroProfileOf(p).companion;
function nearHome(p:Player,id:string){const h=specialResidences().find(h=>h.id===id);return h&&(p.interior?p.interior.tx===h.tx&&p.interior.ty===h.ty:Math.hypot(p.x/32-.5-h.tx,p.y/32-.5-h.ty)<=3);}
export function companionResidences<T extends {id:string}>(homes:T[]){const hired=new Set([...heroProfiles.values()].flatMap(p=>p.companion?[p.companion.castId]:[]));return hired.size?homes.filter(h=>!hired.has(h.id)):homes;}
export function companionEntries(p:Player):JournalEntry[]{
 if(!lifeOf(p).flags['adv:rescue-0:done'])return [];
 const r=record(p);if(r){const name=SPECIAL_BY_ID.get(r.castId)?.name??r.castId;return[{id:'party:companion',title:name+' — '+r.role,status:'active',text:r.injuredUntil!==undefined?`Injured. Recover at the forge after day ${r.injuredUntil}.`:`Health ${Math.ceil(r.actor.hp)} / ${r.actor.maxHp}. Orders: ${r.command}. One travelling companion at a time.`,objective:'Follow keeps pace with you. Hold guards the current point. Retreat stops attacks and follows you to safety.',reward:'Shared victories; injury and recovery instead of permanent death',choices:r.injuredUntil!==undefined?[{id:'party:recover',label:'Recover at Hesta’s forge (15 gold)'}]:[{id:'party:follow',label:'Follow'},{id:'party:hold',label:'Hold'},{id:'party:retreat',label:'Retreat'},{id:'party:refit',label:'Refit at forge: next armour and weapon tier'},{id:'party:dismiss',label:'Return to residence'}]}];}
 return COMPANIONS.map(d=>{const h=specialResidences().find(h=>h.id===d.id);return{id:'party:'+d.role,title:(SPECIAL_BY_ID.get(d.id)?.name??d.id)+' — '+d.label,status:'available',text:`Ask this resident to travel with you. Recruitment costs 50 shared gold. They use normal equipment and collision.`,objective:h?`Meet at ${h.place}.`:'This resident is unavailable in this world.',reward:d.role==='guard'?'Melee protection':d.role==='ranger'?'Ranged support':'Occasional healing',...(h?{marker:{x:h.tx,y:h.ty,label:SPECIAL_BY_ID.get(d.id)?.name??d.label},choices:[{id:'party:hire:'+d.role,label:'Recruit (50 gold)'}]}:{})} as JournalEntry;});
}
export function companionAction(p:Player,raw:string){if(!raw.startsWith('party:'))return false;if(p.dead||state.isPaused)return true;const[,op,arg]=raw.split(':'),prof=heroProfileOf(p),r=prof.companion;
 if(op==='hire'){
  const d=COMPANIONS.find(d=>d.role===arg);if(r||!d||!lifeOf(p).flags['adv:rescue-0:done'])return true;
  if([...heroProfiles.values()].some(q=>q.companion?.castId===d.id)){toast(p,'That person already travels with another hero.');return true;}
  if(!nearHome(p,d.id)){toast(p,'Meet this resident at their marked home to recruit them.');return true;}
  const at=findAdjacentWalkable(Math.floor(p.x/32),Math.floor(p.y/32));if(!at)return true;
  withClan(clanOf(p),()=>{if(state.stock.gold<50){toast(p,'You need 50 gold.');return;}let c:Colonist|null=d.role==='healer'?spawnColonistForPost(at.x,at.y,'bishop',1):spawnSoldierAt(d.kind as ColonistKind,(at.x+.5)*32,(at.y+.5)*32,p.clan,{gear:1});if(!c)return;state.stock.gold-=50;c.adventureOwner=prof.key;c.creativeSpawned=true;c.person=undefined;c.stance='defensive';c.armourTier=1;c.weaponTier=1;prof.companion={version:1,castId:d.id,role:d.role,command:'follow',actor:c};toast(p,`${SPECIAL_BY_ID.get(d.id)?.name} joins your journey.`);refreshInteriorView();});return true;
 }
 if(!r)return true;
 if(['follow','hold','retreat'].includes(op)){r.command=op as CompanionRecord['command'];if(op==='hold'){r.actor.rallyTileX=Math.floor(r.actor.x/32);r.actor.rallyTileY=Math.floor(r.actor.y/32);r.actor.rallyX=r.actor.x;r.actor.rallyY=r.actor.y;}r.actor.path=[];if(r.inside)r.inside.path=[];toast(p,'Companion order: '+op);return true;}
 if(op==='dismiss'){colonists.delete(r.actor.id);delete prof.companion;refreshInteriorView();toast(p,'Your companion returns to their residence.');return true;}
 const h=specialResidences().find(h=>h.id==='hesta-ironroot');if(!h||!(p.interior?p.interior.tx===h.tx&&p.interior.ty===h.ty:Math.hypot(p.x/32-.5-h.tx,p.y/32-.5-h.ty)<=3)){toast(p,'Return to Hesta’s forge for recovery or refitting.');return true;}
 withClan(clanOf(p),()=>{
  if(op==='recover'&&r.injuredUntil!==undefined){if(gameDay()<r.injuredUntil||state.stock.gold<15){toast(p,'Recovery needs a day of rest and 15 gold.');return;}state.stock.gold-=15;r.actor.hp=r.actor.maxHp;delete r.injuredUntil;r.command='follow';r.actor.x=p.x;r.actor.y=p.y;colonists.set(r.actor.id,r.actor);}
  if(op==='refit'&&r.injuredUntil===undefined){const tier=Math.min(3,(r.actor.armourTier??0)+1);if((r.actor.armourTier??0)>=3){toast(p,'Your companion already wears the highest armour tier.');return;}if(state.equipment.armour[tier-1]<1||state.equipment.weapon[tier-1]<1){toast(p,`Need one armour and one weapon of tier ${tier} in the armoury.`);return;}state.equipment.armour[tier-1]--;state.equipment.weapon[tier-1]--;r.actor.armourTier=tier;r.actor.weaponTier=tier;toast(p,`Companion equipped at tier ${tier}.`);}
 });return true;
}
export function companionDowned(c:Colonist){if(!c.adventureOwner)return false;const r=heroProfiles.get(c.adventureOwner)?.companion;if(!r||r.actor.id!==c.id)return false;r.actor=c;c.hp=0;r.injuredUntil=gameDay()+1;delete r.inside;colonists.delete(c.id);for(const p of players.values())if(p.profileKey===c.adventureOwner)toast(p,'Your companion is injured and withdraws. Recover at the forge after a day.');return true;}
export function restoreCompanion(raw:unknown,prof:HeroProfile){if(!raw||typeof raw!=='object')return;const r=raw as CompanionRecord,d=COMPANIONS.find(d=>d.id===r.castId&&d.role===r.role),c=r.actor;if(!d||r.version!==1||!c||typeof c.id!=='string'||!Number.isFinite(c.x)||!Number.isFinite(c.y)||!Number.isFinite(c.hp)||!Number.isFinite(c.maxHp))return;r.command=['follow','hold','retreat'].includes(r.command)?r.command:'follow';delete r.inside;c.adventureOwner=prof.key;c.creativeSpawned=true;c.path=[];c.targetMobId=null;c.hp=Math.max(0,Math.min(c.maxHp,c.hp));prof.companion=r;}
function roomPath(grid:{map:{w:number;h:number};solid:Uint8Array},from:{x:number;y:number},to:{x:number;y:number}){const{w,h}=grid.map,s=Math.round(from.y)*w+Math.round(from.x),g=Math.round(to.y)*w+Math.round(to.x);if(s<0||g<0||s>=w*h||g>=w*h||grid.solid[g])return [];const prev=new Int32Array(w*h).fill(-1),q=[s];prev[s]=s;for(let n=0;n<q.length&&n<2500;n++){const i=q[n];if(i===g)break;const x=i%w,y=Math.floor(i/w);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||grid.solid[j]||prev[j]>=0)continue;prev[j]=i;q.push(j);}}if(prev[g]<0)return [];const out:{x:number;y:number}[]=[];for(let i=g;i!==s;i=prev[i])out.push({x:i%w,y:Math.floor(i/w)});return out.reverse();}
export function stepCompanions(){
 const active=new Map<string,Player>();for(const p of players.values())if(!p.dead&&!active.has(p.profileKey))active.set(p.profileKey,p);
 for(const prof of heroProfiles.values()){
  const r=prof.companion;if(!r)continue;const p=active.get(prof.key),c=colonists.get(r.actor.id)??r.actor;r.actor=c;if(!p&&r.inside){delete r.inside;c.path=[];}if(r.injuredUntil!==undefined){colonists.delete(c.id);continue;}
  if(p?.interior){const I=p.interior,key=`${I.key}:${I.variant}:${I.storey}`;colonists.delete(c.id);if(!r.inside||`${r.inside.key}:${r.inside.variant}:${r.inside.storey}`!==key)r.inside={key:I.key,variant:I.variant,storey:I.storey,x:I.x/32-.5,y:I.y/32-.5,path:[],repath:0,act:'idle'};
   const a=r.inside,grid=companionRoomGrid(p);if(!grid){a.x=I.x/32-.5;a.y=I.y/32-.5;continue;}const goal={x:I.x/32-.5,y:I.y/32-.5},d=Math.hypot(a.x-goal.x,a.y-goal.y);a.act='idle';
   if(r.command!=='hold'&&d>1.3){if(state.spellTick>=a.repath){a.path=roomPath(grid,a,goal);a.repath=state.spellTick+10;}const next=a.path[0];if(next){const dx=next.x-a.x,dy=next.y-a.y,dist=Math.hypot(dx,dy),step=Math.min(dist,.15),x=a.x+dx/Math.max(.001,dist)*step,y=a.y+dy/Math.max(.001,dist)*step;if(clearSight(grid,a,{x,y})){a.x=x;a.y=y;a.act='walk';if(dist<.18)a.path.shift();}else a.path=[];}}
   if(c.attackCooldownTicks>0)c.attackCooldownTicks--;if(r.command!=='retreat'&&!p.adventureSneak&&c.attackCooldownTicks<=0){if(r.role==='healer'){if(d<4&&clearSight(grid,a,goal)&&p.hp<playerMaxHp(p)){p.hp=Math.min(playerMaxHp(p),p.hp+4);c.attackCooldownTicks=100;a.act='work';}}else if(companionInteriorAttack(p,a.x,a.y,r.role==='ranger'?5:1.5,(r.role==='ranger'?4:6)*(1+(c.weaponTier??0)*.15))){c.attackCooldownTicks=r.role==='ranger'?30:24;a.act='work';}}continue;
  }
  if(r.inside){delete r.inside;c.path=[];if(p){c.x=p.x;c.y=p.y;}}
  if(!colonists.has(c.id)){const at=isWalkableTile(Math.floor(c.x/32),Math.floor(c.y/32))?{x:Math.floor(c.x/32),y:Math.floor(c.y/32)}:findAdjacentWalkable(Math.floor(c.x/32),Math.floor(c.y/32));if(at){c.x=(at.x+.5)*32;c.y=(at.y+.5)*32;colonists.set(c.id,c);}}
  if(!p||r.command==='hold')continue;
  c.clan=p.clan;
  if(state.spellTick%5===0&&Math.hypot(c.x-p.x,c.y-p.y)>48){const at={x:Math.floor(p.x/32),y:Math.floor(p.y/32)};if(isWalkableTile(at.x,at.y)){c.rallyTileX=at.x;c.rallyTileY=at.y;c.rallyX=p.x;c.rallyY=p.y;c.postX=at.x;c.postY=at.y;}}
  c.adventureRetreat=r.command==='retreat';c.holdFire=r.command==='retreat';c.stance='defensive';if(r.command==='retreat'){c.targetMobId=null;c.targetResourceX=-1;c.targetResourceY=-1;}
 }
}
export function companionSnapshots(p:Player):InteriorNpcSnapshot[]{const I=p.interior;if(!I)return [];return [...heroProfiles.values()].flatMap(prof=>{const r=prof.companion,a=r?.inside;if(!r||!a||r.injuredUntil!==undefined||a.key!==I.key||a.variant!==I.variant||a.storey!==I.storey)return [];return[{id:'ally:'+r.actor.id,name:SPECIAL_BY_ID.get(r.castId)?.name??r.castId,roleLabel:r.role+' companion',x:a.x,y:a.y,color:0xd9cfac,kind:r.actor.kind,act:'resident' as const}];});}
export function companionLive(p:Player):InteriorNpcLive[]{return companionSnapshots(p).map(n=>{const r=[...heroProfiles.values()].find(prof=>'ally:'+prof.companion?.actor.id===n.id)!.companion!;return{id:n.id,x:n.x,y:n.y,face:'d',pose:r.inside?.act==='work'?'work':r.inside?.act==='walk'?'walk':'idle'};});}
export function companionTargets(inside:Player[]){const targets=[...inside],seen=new Set<string>();for(const p of inside){const r=record(p),a=r?.inside;if(!r||!a||r.injuredUntil!==undefined||seen.has(r.actor.id))continue;seen.add(r.actor.id);targets.push({...p,id:'ally:'+r.actor.id,adventureAllyId:r.actor.id,hp:r.actor.hp,interior:{...p.interior!,x:(a.x+.5)*32,y:(a.y+.5)*32}});}return targets;}
export function hurtCompanionProxy(p:Player,amount:number){if(!p.adventureAllyId)return false;const r=record(p);if(r?.actor.id===p.adventureAllyId){damageColonist(r.actor,amount);p.hp=r.actor.hp;p.dead=r.injuredUntil!==undefined;}return true;}
