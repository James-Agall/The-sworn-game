import assert from 'node:assert/strict';
import {BOSS_PROFILES} from '../shared/src/adventure.js';
import {state} from './src/state.js';
import {stepBoss,bossHit,bossLive,bossMoveSpeed,stepBossStatuses,resetBossEffects,type BossAgent,type BossHooks} from './src/bossCombat.js';
import type {Player} from './src/types.js';
const map={w:14,h:14,cells:'.'.repeat(196),spawn:{x:1,y:1},exit:{x:1,y:12}} as any;
let profiles=0;
for(const [id,profile]of Object.entries(BOSS_PROFILES)){
 resetBossEffects();state.cycleTick+=200;
 const p={id:'boss-test',hp:100,dead:false,interior:{key:'test',x:4.1*32,y:3.5*32}} as unknown as Player;
 const m:BossAgent={id:'boss',specialId:id,kind:'skeleton',x:3,y:3,hp:100,maxHp:100,damage:10,speed:2,cd:0,cdTicks:20,face:'r',act:'idle',path:[]};
 let damage=0,spawned=0;const grid={map,solid:new Uint8Array(196)};
 const hooks:BossHooks={grid,players:[p],damage:(p,n)=>{damage+=n;p.hp-=n;},spawn:()=>{spawned++;return true;},clearSight:()=>true};
 const near=()=>({p,x:p.interior!.x/32-.5,y:p.interior!.y/32-.5,d:Math.hypot(m.x-(p.interior!.x/32-.5),m.y-(p.interior!.y/32-.5))});
 assert(stepBoss(m,near(),hooks));assert.equal(m.bossState!.phase,'windup',id);assert.equal(damage,0,'wind-up has no instant damage');assert(bossLive(m)?.name);
 state.cycleTick=m.bossState!.end-1;stepBoss(m,near(),hooks);assert.equal(damage,0);
 p.interior!.x=10.5*32;p.interior!.y=10.5*32;state.cycleTick++;stepBoss(m,near(),hooks);assert.equal(damage,0,id+' committed strike can be dodged');assert.equal(m.bossState!.phase,'recovery');
 state.cycleTick=m.bossState!.end;stepBoss(m,near(),hooks);m.x=3;m.y=3;m.cd=0;p.interior!.x=4.1*32;p.interior!.y=3.5*32;
 stepBoss(m,near(),hooks);state.cycleTick=m.bossState!.end;stepBoss(m,near(),hooks);assert(damage>0,id+' strike connects at impact');const once=damage;stepBoss(m,near(),hooks);assert.equal(damage,once,'recovery cannot repeat the same hit');assert.equal(bossHit(m,10,{x:4,y:3}),13.5,'recovery exposes the boss');
 if(profile.style==='spider'){assert.equal(bossMoveSpeed(p),.55);state.cycleTick+=120;assert.equal(bossMoveSpeed(p),1,'web slow expires');}
 if(id==='moth-black'){state.cycleTick+=20;stepBossStatuses([p],hooks.damage);assert(damage>once,'poison ticks after the arrow');}
 // Interrupting a committed attack cancels its damage, rather than leaving a ghost impact.
 m.x=3;m.y=3;m.bossState=undefined;m.cd=0;stepBoss(m,near(),hooks);const before=damage;if(profile.style!=='champion'){
  const hits=profile.style==='guardian'?3:2;for(let n=0;n<hits;n++)bossHit(m,4,{x:3,y:4});assert.equal(m.bossState!.phase,'recovery');assert(m.bossState!.interrupted);state.cycleTick=m.bossState!.end;stepBoss(m,near(),hooks);assert.equal(damage,before,'stagger cancels a strike');
 }else{m.bossState=undefined;m.cd=0;assert.equal(bossHit(m,10,{x:4,y:3}),4,'frontal guard');assert.equal(bossHit(m,10,{x:2,y:3}),10,'rear hit bypasses shield');}
 // Each caller gets one bounded rally, never an endless stream of summons.
 if(profile.summon){m.bossState=undefined;m.hp=40;m.rallyUsed=false;stepBoss(m,near(),hooks);assert(spawned<=2&&spawned>0);const n=spawned;for(let i=0;i<20;i++){state.cycleTick++;stepBoss(m,near(),hooks);}assert.equal(spawned,n,'one rally per boss');}
 // A wall blocks a new attack entirely.
 m.bossState=undefined;m.cd=0;m.x=3;m.y=3;hooks.clearSight=()=>false;const old=damage;assert(!stepBoss(m,near(),hooks));assert.equal(damage,old);profiles++;
}
console.log(`PASS ${profiles} boss profiles: warning/impact/recovery timing, dodging, interrupts, shield facing, exposure, webs, poison, bounded reinforcements and blocked sightlines`);
