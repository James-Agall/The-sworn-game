import { attackSpec, combatWeapon, facingPoint, COMBAT_BUFFER_TICKS, COMBAT_CHARGE_TICKS, COMBAT_MAX_CHARGE_TICKS,
  COMBAT_DODGE_TICKS, COMBAT_DODGE_COOLDOWN, type CombatLive, type CombatStrike } from '@colony/shared/combatRules';
import { PLAYER_SPEED, TILE_SIZE, type ClientMessage } from '@colony/shared/protocol';
import type { Player } from './types.js';
import { state } from './state.js';
import { heroProfileOf } from './heroes.js';
import { isMounted } from './animals.js';
import { resolvePlayerStrike } from './worldPlayerStrike.js';
import { mineHeroAttack } from './mines.js';
import { withClan, clanOf } from './clans.js';

import {adventureStrike,hasAdventureTrait} from "@colony/shared/expeditions";
interface Attack { spec:CombatStrike; start:number; contact:number; end:number; hit:boolean; weaponId:string; damageMult:number }
interface Runtime {
  context:string; angle:number; aimAt:number; chargeAt?:number; chargeWeapon?:string; attack?:Attack;
  guard:boolean; guardAt:number; parryReady:number; dodgeUntil:number; dodgeReady:number; dodgeX:number; dodgeY:number;
  counterUntil:number; buffered?:{heavy:boolean;angle:number;until:number}; feedback?:CombatLive['feedback']; feedbackUntil:number;
  lastX:number;lastY:number;velocityX:number;velocityY:number;
}
let runtime=new WeakMap<Player,Runtime>();
const clock=()=>state.spellTick;
const context=(p:Player)=>p.interior?`${p.interior.key}:${p.interior.variant}:${p.interior.storey}`:'world';
const position=(p:Player)=>p.interior??p;
const weaponId=(p:Player)=>heroProfileOf(p).equipment.weapon?.id??'unarmed';
function get(p:Player):Runtime {
  const key=context(p);let s=runtime.get(p);
  if(!s||s.context!==key){p.adventureSneak=false;const at=position(p);s={context:key,angle:0,aimAt:-100,guard:false,guardAt:-100,parryReady:0,dodgeUntil:0,dodgeReady:0,dodgeX:0,dodgeY:0,counterUntil:0,feedbackUntil:0,lastX:at.x,lastY:at.y,velocityX:0,velocityY:0};runtime.set(p,s);}
  return s;
}
export function resetPlayerCombat(){runtime=new WeakMap();}
export function combatAim(p:Player,angle:unknown){if(typeof angle==='number'&&Number.isFinite(angle)){const s=get(p);s.angle=Math.atan2(Math.sin(angle),Math.cos(angle));s.aimAt=clock();}}
export function queuePlayerAttack(p:Player,heavy=false,angle?:number):boolean {
  if(p.dead)return false;
  p.adventureSneak=false;const s=get(p),now=clock();if(angle!==undefined)combatAim(p,angle);
  if(s.dodgeUntil>now)return false;
  if(s.attack||p.attackCooldownTicks>0){
    const left=s.attack?s.attack.end-now:p.attackCooldownTicks;
    if(left<=COMBAT_BUFFER_TICKS)s.buffered={heavy,angle:s.angle,until:now+COMBAT_BUFFER_TICKS+1};
    return false;
  }
  const prof=heroProfileOf(p),weapon=combatWeapon(prof.equipment.weapon?.kind),mounted=!p.interior&&isMounted(p);
  if(mounted&&Math.hypot(s.velocityX,s.velocityY)>40){
    const heading=Math.atan2(s.velocityY,s.velocityX),delta=Math.atan2(Math.sin(s.angle-heading),Math.cos(s.angle-heading));
    const limit=weapon==='spear'?.6:1.4;s.angle=heading+Math.max(-limit,Math.min(limit,delta));
  }
  const spec=adventureStrike(prof.equipment,attackSpec(weapon,heavy,mounted,s.angle,prof.stats.attackSpeedMult));
  const forward=s.velocityX*Math.cos(s.angle)+s.velocityY*Math.sin(s.angle);
  const bonus=mounted&&weapon!=='bow'?1+Math.min(.25,Math.max(0,forward-PLAYER_SPEED*.5)/(PLAYER_SPEED*4)):1;
  const counter=s.counterUntil>now?1.25:1;s.counterUntil=0;s.guard=false;s.chargeAt=undefined;
  s.attack={spec,start:now,contact:now+spec.windup,end:now+spec.windup+spec.recovery,hit:false,weaponId:weaponId(p),damageMult:spec.damageMult*bonus*counter};
  p.attackCooldownTicks=spec.windup+spec.recovery;
  return true;
}
export function handleCombatInput(p:Player,msg:Extract<ClientMessage,{type:'combat'}>){
  if(p.dead)return;const s=get(p),now=clock();combatAim(p,msg.angle);
  if(msg.action==='cancel'){s.guard=false;s.chargeAt=undefined;s.buffered=undefined;return;}
  if(msg.action==='guard'&&msg.on===false){s.guard=false;return;}
  if(state.isPaused){if(msg.action==='release')s.chargeAt=undefined;return;}
  if(msg.action==='aim')return;
  if(msg.action==='press'){
    if(s.chargeAt!==undefined||s.dodgeUntil>now||s.attack&&s.attack.end-now>COMBAT_BUFFER_TICKS)return;
    s.guard=false;s.chargeAt=now;s.chargeWeapon=weaponId(p);
  }else if(msg.action==='release'){
    if(s.chargeAt===undefined)return;
    const heavy=now-s.chargeAt>=COMBAT_CHARGE_TICKS,valid=s.chargeWeapon===weaponId(p);s.chargeAt=undefined;
    if(valid)queuePlayerAttack(p,heavy,s.angle);
  }else if(msg.action==='guard'){
    if(msg.on===false){s.guard=false;return;}
    if(s.attack||s.dodgeUntil>now||heroProfileOf(p).equipment.offhand?.kind!=='shield')return;
    if(!s.guard){s.guard=true;s.chargeAt=undefined;s.guardAt=now;if(s.parryReady<=now)s.parryReady=now+16;else s.guardAt=-100;}
  }else if(msg.action==='dodge'){
    if(!p.interior&&isMounted(p)||s.dodgeReady>now||s.attack||s.chargeAt!==undefined)return;
    const d=Math.hypot(p.input.dx,p.input.dy),a=d?Math.atan2(p.input.dy,p.input.dx):s.angle+Math.PI/2;
    s.dodgeX=Math.cos(a);s.dodgeY=Math.sin(a);s.dodgeUntil=now+COMBAT_DODGE_TICKS;s.dodgeReady=now+COMBAT_DODGE_COOLDOWN-(hasAdventureTrait(heroProfileOf(p).equipment,"wayfarer")?4:0);s.guard=false;
  }
}
export function stepPlayerCombat(p:Player){
  const s=get(p),now=clock(),at=position(p);
  s.velocityX=(at.x-s.lastX)*20;s.velocityY=(at.y-s.lastY)*20;s.lastX=at.x;s.lastY=at.y;
  if(p.dead){s.attack=undefined;s.guard=false;s.chargeAt=undefined;s.buffered=undefined;return;}
  if(s.aimAt<0&&Math.hypot(p.input.dx,p.input.dy)>.1)s.angle=Math.atan2(p.input.dy,p.input.dx);
  if(s.guard&&heroProfileOf(p).equipment.offhand?.kind!=='shield')s.guard=false;
  if(s.chargeAt!==undefined&&now-s.chargeAt>=COMBAT_MAX_CHARGE_TICKS){const valid=s.chargeWeapon===weaponId(p);s.chargeAt=undefined;if(valid)queuePlayerAttack(p,true,s.angle);}
  const a=s.attack;
  if(a){
    if(a.weaponId!==weaponId(p)||a.spec.mounted!==(!p.interior&&isMounted(p))){s.attack=undefined;p.attackCooldownTicks=Math.max(p.attackCooldownTicks,4);}
    else{
      if(!a.hit&&now>=a.contact){a.hit=true;withClan(clanOf(p),()=>{if(!mineHeroAttack(p,a.spec,a.damageMult))resolvePlayerStrike(p,a.spec,a.damageMult);});}
      if(now>=a.end)s.attack=undefined;
    }
  }
  if(!s.attack&&s.buffered){const b=s.buffered;s.buffered=undefined;if(now<=b.until)queuePlayerAttack(p,b.heavy,b.angle);}
}
export function combatMotion(p:Player):{dx:number;dy:number;mult:number}{
  const s=get(p);if(s.dodgeUntil>clock())return{dx:s.dodgeX,dy:s.dodgeY,mult:2.5};
  return{...p.input,mult:(p.adventureSneak&&p.interior?.templateId==='mine'?.55:1)*(s.guard?.48:s.chargeAt!==undefined?.65:s.attack?(s.attack.spec.mounted?.88:.72):1)};
}
export interface CombatDamageSource {x:number;y:number;heavy?:boolean;parry?:()=>void;unblockable?:boolean}
export function defendPlayer(p:Player,amount:number,source?:CombatDamageSource):number {
  if(!source||source.unblockable)return amount;
  const s=get(p),now=clock();
  if(!s.guard||heroProfileOf(p).equipment.offhand?.kind!=='shield'||!facingPoint(s.angle,position(p),source,1.15))return amount;
  s.feedbackUntil=now+6;
  if(source.heavy){s.guard=false;s.feedback='guardBreak';p.attackCooldownTicks=Math.max(p.attackCooldownTicks,6);return amount*.8;}
  if(now-s.guardAt<=4+(hasAdventureTrait(heroProfileOf(p).equipment,"steady")?1:0)){s.feedback='parry';s.counterUntil=now+(hasAdventureTrait(heroProfileOf(p).equipment,'counter')?26:18);source.parry?.();return 0;}
  s.feedback='block';return amount*.4;
}
export function playerCombatLive(p:Player):CombatLive|undefined {
  const s=runtime.get(p);if(!s||s.context!==context(p)||p.dead)return;const now=clock(),a=s.attack;
  const phase=a?(now<a.contact?'windup':'recovery'):s.chargeAt!==undefined?'charge':s.dodgeUntil>now?'dodge':s.guard?'guard':'ready';
  if(phase==='ready'&&s.dodgeReady<=now&&s.feedbackUntil<=now&&s.counterUntil<=now)return;
  const progress=a?(now<a.contact?(now-a.start)/Math.max(1,a.contact-a.start):(now-a.contact)/Math.max(1,a.end-a.contact)):s.chargeAt!==undefined?Math.min(1,(now-s.chargeAt)/COMBAT_CHARGE_TICKS):0;
  return{phase,angle:a?.spec.angle??s.angle,progress:Math.max(0,Math.min(1,progress)),heavy:a?.spec.heavy??(s.chargeAt!==undefined&&now-s.chargeAt>=COMBAT_CHARGE_TICKS),weapon:a?.spec.weapon??combatWeapon(heroProfileOf(p).equipment.weapon?.kind),dodgeCooldown:Math.max(0,s.dodgeReady-now),...(s.counterUntil>now?{counter:true}:{}),...(s.feedbackUntil>now?{feedback:s.feedback}:{})};
}
export function preparePlayerSpell(p:Player):boolean {const s=get(p);if(s.attack||s.dodgeUntil>clock())return false;s.guard=false;s.chargeAt=undefined;s.buffered=undefined;return true;}
