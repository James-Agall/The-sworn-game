import { duelStyle, facingPoint, strikeContains, attackSpec, type CombatStrike, type DuelLive, type DuelStyle } from '@colony/shared/combatRules';
import type { MobKind } from '@colony/shared/protocol';
import { state } from './state.js';
import type { CombatDamageSource } from './playerCombat.js';

interface Enemy {kind:MobKind;x:number;y:number;hp:number;path:unknown[]}
interface Duel {
  style:DuelStyle;phase:'windup'|'recovery'|'stagger'|'guard';start:number;end:number;
  x:number;y:number;angle:number;reach:number;targetId:string;ready:number;scale:number;
}
let duels=new WeakMap<Enemy,Duel>();
export function clearDuel(e:Enemy){duels.delete(e);}
export function resetDuels(){duels=new WeakMap();}
interface DuelHooks {
  id:string;target:{x:number;y:number};range:number;ranged:boolean;ready:boolean;scale:number;
  clear:(a:{x:number;y:number},b:{x:number;y:number})=>boolean;
  hit:(source:CombatDamageSource)=>void;cooldown:()=>void;
  retreat?:()=>void;
}
export function staggerDuel(e:Enemy,ticks=7){const d=duels.get(e);if(!d)return;d.phase='stagger';d.start=state.spellTick;d.end=state.spellTick+ticks;d.ready=d.end+4;e.path=[];}
// Only actors duelling a player use this small state machine. It never requests a path.
export function stepDuel(e:Enemy,h:DuelHooks):boolean {
  const now=state.spellTick,style=duelStyle(e.kind,h.ranged),distance=Math.hypot(e.x-h.target.x,e.y-h.target.y);
  let d=duels.get(e);
  if(d&&d.targetId!==h.id){duels.delete(e);d=undefined;}
  if(d&&d.phase!=='guard'){
    e.path=[];
    if(now<d.end)return true;
    if(d.phase==='windup'){
      const s=attackSpec(style==='archer'?'bow':style==='keeper'?'spear':style==='defender'?'axe':'sword',false,false,d.angle);
      s.reach=d.reach;s.arc=style==='reckless'?1.6:1.2;s.width=style==='keeper'?8:6;
      const from={x:d.x,y:d.y},target={x:h.target.x*h.scale,y:h.target.y*h.scale};
      if(strikeContains(s,from,target,8)&&h.clear({x:d.x/h.scale,y:d.y/h.scale},h.target)){
        h.hit({x:d.x,y:d.y,heavy:style==='defender',parry:()=>staggerDuel(e)});
      }
      h.cooldown();
      if(duels.get(e)?.phase!=='stagger'){d.phase='recovery';d.start=now;d.end=now+(style==='defender'?13:style==='archer'?10:8);}
      return true;
    }
    duels.delete(e);return false;
  }
  if(distance>h.range||!h.clear(e,h.target)){if(d)duels.delete(e);return false;}
  const angle=Math.atan2(h.target.y-e.y,h.target.x-e.x);
  if(!h.ready){
    if(style==='defender')duels.set(e,{style,phase:'guard',start:now,end:now+1,x:e.x*h.scale,y:e.y*h.scale,angle,reach:h.range*h.scale,targetId:h.id,ready:0,scale:h.scale});
    if((style==='archer'||style==='keeper')&&distance<h.range*.55)h.retreat?.();
    return true;
  }
  const windup=style==='archer'?12:style==='defender'?12:style==='keeper'?10:8;
  duels.set(e,{style,phase:'windup',start:now,end:now+windup,x:e.x*h.scale,y:e.y*h.scale,angle,reach:h.range*h.scale,targetId:h.id,ready:0,scale:h.scale});
  e.path=[];return true;
}
export function enemyGuardMultiplier(e:Enemy,from:{x:number;y:number},s:CombatStrike):number {
  const d=duels.get(e);if(!d||d.style!=='defender'||d.phase!=='guard'||!facingPoint(d.angle,{x:d.x,y:d.y},from,1.2))return 1;
  if(s.guardBreak){staggerDuel(e,10);return 1.15;}
  return .4;
}
export function duelLive(e:Enemy):DuelLive|undefined {
  const d=duels.get(e);if(!d||e.hp<=0)return;
  return{phase:d.phase,style:d.style,x:d.x,y:d.y,angle:d.angle,reach:d.reach,progress:Math.max(0,Math.min(1,(state.spellTick-d.start)/Math.max(1,d.end-d.start)))};
}
