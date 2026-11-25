import { TileType, TILE_SIZE, isGateTile, isSolidTile } from '@colony/shared/protocol';
import { fortAnchor } from '@colony/shared/fortifications';
import { sceneryRadius } from '@colony/shared/sceneryCollision';
import { strikeContains, type CombatStrike } from '@colony/shared/combatRules';
import { players, mobs, wildlife, hearths, gates, state } from './state.js';
import type { Player } from './types.js';
import { damagePlayer, damageMob, damageColonist } from './combat.js';
import { playerDamage, heroEvent } from './heroes.js';
import { damageWildlife } from './wildlife.js';
import { WILDLIFE_CONFIG } from './wildlife.js';
import { damageHearth } from './hearths.js';
import { footprintHitPoint, inBounds, tileIndex } from './tiles.js';
import { hostileColonistInReach } from './creative.js';
import { addItem } from './progression.js';
import { noteHeroHunt } from './herolife.js';
import { enemyGuardMultiplier } from './duelCombat.js';

export function worldCombatSight(a:{x:number;y:number},b:{x:number;y:number}):boolean {
  const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/4));
  for(let k=1;k<n;k++){
    const x=a.x+(b.x-a.x)*k/n,y=a.y+(b.y-a.y)*k/n,tx=Math.floor(x/TILE_SIZE),ty=Math.floor(y/TILE_SIZE);
    if(!inBounds(tx,ty))return false;
    const tile=state.tiles[tileIndex(tx,ty)],radius=sceneryRadius(tile,tx,ty);
    if(radius){if(Math.hypot(x-(tx+.5)*TILE_SIZE,y-(ty+.5)*TILE_SIZE)<radius)return false;continue;}
    if(isGateTile(tile)){const a=fortAnchor((x,y)=>inBounds(x,y)?state.tiles[tileIndex(x,y)]:-1,tx,ty),g=gates.get(tileIndex(a.x,a.y));if(!g?.open&&!g?.overrun)return false;continue;}
    if(isSolidTile(tile)&&tile!==TileType.Water&&tile!==TileType.Moat)return false;
  }
  return true;
}
export function resolvePlayerStrike(p:Player,s:CombatStrike,mult:number){
  if(p.dead||p.interior)return;
  const damage=playerDamage(p)*mult;
  const targets:{x:number;y:number;radius:number;hit:()=>void}[]=[];
  const nearby=(e:{x:number;y:number})=>Math.abs(e.x-p.x)<=s.reach+24&&Math.abs(e.y-p.y)<=s.reach+24;
  const effect=(at:{x:number;y:number})=>state.pendingEffects.push({fromX:p.x,fromY:p.y,toX:at.x,toY:at.y,melee:!s.ranged});
  for(const other of players.values())if(other!==p&&!other.dead&&!other.interior&&nearby(other))targets.push({...other,radius:10,hit:()=>{effect(other);damagePlayer(other,damage,false,{x:p.x,y:p.y,heavy:s.guardBreak});}});
  for(const m of mobs.values()){
    if(m.hp<=0||!nearby(m)||['townFarmer','townMiner','townPriest','townHerald'].includes(m.kind))continue;
    targets.push({x:m.x,y:m.y,radius:9,hit:()=>{effect(m);const guarded=enemyGuardMultiplier(m,p,s);heroEvent({type:'hit',key:p.profileKey,amount:damage*guarded,detail:m.id});damageMob(m,damage*guarded,'p:'+p.id);}});
  }
  for(const a of wildlife.values())if(nearby(a))targets.push({x:a.x,y:a.y,radius:7,hit:()=>{effect(a);if(damageWildlife(a,damage,p.x,p.y,null)){state.stock.meat+=WILDLIFE_CONFIG[a.kind].meat;addItem('hide',1);noteHeroHunt(p);}}});
  const hostile=hostileColonistInReach(p,Infinity,s.reach);
  if(hostile)targets.push({x:hostile.x,y:hostile.y,radius:7,hit:()=>{effect(hostile);damageColonist(hostile,damage);}});
  const hits=targets.filter(t=>strikeContains(s,p,t,t.radius)&&worldCombatSight(p,t)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)).slice(0,s.maxTargets);
  if(hits.length){for(const t of hits)t.hit();return;}
  for(const h of hearths.values()){
    if(h.destroyed)continue;const at=footprintHitPoint(h.x,h.y,p.x,p.y);
    if(strikeContains(s,p,at,8)&&worldCombatSight(p,at)){effect(at);damageHearth(h,damage,'p:'+p.id);return;}
  }
}
