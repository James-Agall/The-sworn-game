import {BOSS_PROFILES,type BossProfile,type BossAttackLive} from '@colony/shared/adventure';
import {TILE_SIZE,type MobKind} from '@colony/shared/protocol';
import type {InteriorMap} from '@colony/shared/interiors';
import type {Player} from './types.js';
import {state} from './state.js';
import {dt} from './constants.js';
export interface BossState {phase:'windup'|'recovery';start:number;end:number;x:number;y:number;fromX:number;fromY:number;interrupted?:boolean}
export interface BossAgent {id:string;specialId?:string;kind:MobKind;x:number;y:number;hp:number;maxHp:number;damage:number;speed:number;cd:number;cdTicks:number;face:'l'|'r';act:'sleep'|'idle'|'walk'|'attack';path:{x:number;y:number}[];bossState?:BossState;rallyUsed?:boolean;stagger?:number;hazard?:{x:number;y:number;radius:number;until:number}}
interface Near {p:Player;x:number;y:number;d:number}
export interface BossHooks {grid:{map:InteriorMap;solid:Uint8Array};players:Player[];damage:(p:Player,n:number)=>void;spawn:(kind:MobKind,x:number,y:number)=>boolean;clearSight:(a:{x:number;y:number},b:{x:number;y:number})=>boolean}
const effects=new Map<string,{key:string;slowUntil:number;poisonUntil:number;lastPoison:number}>();
export function bossMoveSpeed(p:Player){const e=effects.get(p.id);if(!e||e.key!==p.interior?.key)return 1;return e.slowUntil>state.cycleTick ? .55 : 1;}
export function resetBossEffects(){effects.clear();}
function floor(h:BossHooks,x:number,y:number){return [[-.23,-.23],[.23,-.23],[-.23,.23],[.23,.23]].every(([dx,dy])=>{const xx=Math.round(x+dx),yy=Math.round(y+dy);return xx>=0&&yy>=0&&xx<h.grid.map.w&&yy<h.grid.map.h&&!h.grid.solid[yy*h.grid.map.w+xx];});}
function clipped(h:BossHooks,a:{x:number;y:number},b:{x:number;y:number}){const d=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(d*8));let end={x:a.x,y:a.y};for(let n=1;n<=steps;n++){const x=a.x+(b.x-a.x)*n/steps,y=a.y+(b.y-a.y)*n/steps;if(!floor(h,x,y)||!h.clearSight(end,{x,y}))break;end={x,y};}return end;}
function segmentDistance(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number}){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
const rush=(p:BossProfile)=>['assassin','beast','swoop'].includes(p.style);
function status(p:Player,kind:'web'|'poison'){const e=effects.get(p.id)??{key:p.interior!.key,slowUntil:0,poisonUntil:0,lastPoison:state.cycleTick};e.key=p.interior!.key;if(kind==='web')e.slowUntil=Math.max(e.slowUntil,state.cycleTick+40);else e.poisonUntil=Math.max(e.poisonUntil,state.cycleTick+80);effects.set(p.id,e);}
export function stepBossStatuses(ps:Player[],damage:(p:Player,n:number)=>void){for(const p of ps){const e=effects.get(p.id);if(!e)continue;if(p.dead||e.key!==p.interior?.key||Math.max(e.slowUntil,e.poisonUntil)<=state.cycleTick){effects.delete(p.id);continue;}if(e.poisonUntil>state.cycleTick&&state.cycleTick-e.lastPoison>=20){e.lastPoison=state.cycleTick;damage(p,1);}}}
export function bossHit(m:BossAgent,damage:number,h:{x:number;y:number}){
 const profile=m.specialId?BOSS_PROFILES[m.specialId]:undefined;if(!profile)return damage;
 if(m.bossState?.phase==='recovery')return damage*1.35;
 const frontal=(h.x-m.x)*(m.face==='r'?1:-1)>.15&&Math.abs(h.x-m.x)>Math.abs(h.y-m.y)*.65;
 if(profile.style==='champion'&&frontal&&m.cd<=0)return damage*.4;
 if(m.bossState?.phase==='windup'){
  m.stagger=(m.stagger??0)+1;
  if(m.stagger>=(profile.style==='guardian'?3:2)){m.bossState={...m.bossState,phase:'recovery',start:state.cycleTick,end:state.cycleTick+profile.recovery+8,interrupted:true};m.cd=profile.cooldown;m.act='idle';}
 }
 return damage;
}
export function stepBoss(m:BossAgent,near:Near,h:BossHooks){
 const p=m.specialId?BOSS_PROFILES[m.specialId]:undefined;if(!p)return false;
 if(m.hazard){if(m.hazard.until<=state.cycleTick)m.hazard=undefined;else for(const player of h.players){if(!player.interior||player.dead)continue;const pos={x:player.interior.x/TILE_SIZE-.5,y:player.interior.y/TILE_SIZE-.5};if(Math.hypot(pos.x-m.hazard.x,pos.y-m.hazard.y)<=m.hazard.radius&&h.clearSight(m.hazard,pos))status(player,'web');}}
 if(p.summon&&!m.rallyUsed&&m.hp<=m.maxHp*.5){
  m.rallyUsed=true;let n=0;
  for(let r=2;r<=4&&n<2;r++)for(const [dx,dy]of [[r,0],[-r,0],[0,r],[0,-r]]){
   const x=Math.round(m.x+dx),y=Math.round(m.y+dy);if(!floor(h,x,y)||!h.clearSight(m,{x,y})||h.players.some(p=>p.interior&&Math.hypot(p.interior.x/TILE_SIZE-.5-x,p.interior.y/TILE_SIZE-.5-y)<1.5)||Math.hypot(x-h.grid.map.spawn.x,y-h.grid.map.spawn.y)<4||Math.hypot(x-h.grid.map.exit.x,y-h.grid.map.exit.y)<4)continue;
   if(h.spawn(p.style==='spider'?'caveSpider':'banditClubman',x,y))n++;if(n>=2)break;
  }
 }
 const a=m.bossState;
 if(a){
  m.path=[];m.act=a.phase==='windup'?'attack':'idle';
  if(state.cycleTick<a.end)return true;
  if(a.phase==='recovery'){m.bossState=undefined;return true;}
  const origin={x:a.fromX,y:a.fromY},target=clipped(h,origin,{x:a.x,y:a.y});
  if(rush(p)){m.x=target.x;m.y=target.y;}
  for(const player of h.players){if(player.dead||!player.interior)continue;const pos={x:player.interior.x/TILE_SIZE-.5,y:player.interior.y/TILE_SIZE-.5};const hit=(rush(p)||p.style==='archer'?segmentDistance(pos,origin,target)<=p.radius:Math.hypot(pos.x-a.x,pos.y-a.y)<=p.radius)&&h.clearSight(origin,pos)&&h.clearSight(target,pos);if(hit){h.damage(player,m.damage*p.damage);if(p.style==='spider')status(player,'web');if(m.specialId==='moth-black')status(player,'poison');}}
  if(p.style==='spider')m.hazard={x:target.x,y:target.y,radius:p.radius,until:state.cycleTick+60};
  m.bossState={...a,phase:'recovery',start:state.cycleTick,end:state.cycleTick+p.recovery};m.cd=p.cooldown;m.act='attack';return true;
 }
 // Archers keep a little space without running an additional path search.
 if(p.style==='archer'&&near.d<2&&m.cd>0){const d=Math.max(.01,near.d),x=m.x+(m.x-near.x)/d*m.speed*dt,y=m.y+(m.y-near.y)/d*m.speed*dt;if(floor(h,x,y)){m.x=x;m.y=y;m.act='walk';return true;}}
 if(m.cd>0||near.d>p.range||!h.clearSight(m,near))return false;
 const d=Math.max(.01,near.d),length=Math.min(near.d,p.range),target=clipped(h,m,{x:m.x+(near.x-m.x)/d*length,y:m.y+(near.y-m.y)/d*length});
 m.bossState={phase:'windup',start:state.cycleTick,end:state.cycleTick+p.windup,x:target.x,y:target.y,fromX:m.x,fromY:m.y};m.stagger=0;m.path=[];m.act='attack';return true;
}
export function bossLive(m:BossAgent):BossAttackLive|undefined{const s=m.bossState,p=m.specialId?BOSS_PROFILES[m.specialId]:undefined;if(!s||!p)return;return{phase:s.phase,name:s.interrupted?'Staggered':p.attack,style:p.style,x:s.x,y:s.y,fromX:s.fromX,fromY:s.fromY,radius:p.radius,progress:Math.max(0,Math.min(1,(state.cycleTick-s.start)/Math.max(1,s.end-s.start)))};}
