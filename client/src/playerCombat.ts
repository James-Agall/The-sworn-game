import { Graphics } from 'pixi.js';
import { attackSpec, type CombatLive, type DuelLive } from '@colony/shared/combatRules';
import type { PlayerSnapshot } from '@colony/shared/protocol';

export function combatPose(c?:CombatLive):{state:'attack'|'idle';phase:number}|undefined {
  if(!c)return;
  if(c.phase==='charge')return{state:'attack',phase:.08+c.progress*.18};
  if(c.phase==='windup')return{state:'attack',phase:.26+c.progress*.22};
  if(c.phase==='recovery')return{state:'attack',phase:.48+c.progress*.52};
  if(c.phase==='guard')return{state:'idle',phase:0};
}
export function drawPlayerCombat(g:Graphics,at:{x:number;y:number},c?:CombatLive){
  if(!c)return;const x=at.x,y=at.y-6,angle=c.angle;
  if(c.phase==='guard'||c.feedback){
    const color=c.feedback==='parry'?0xffe5a0:c.feedback==='guardBreak'?0xc95742:0xbdbeb5;
    g.arc(x,y,18,angle-1.1,angle+1.1).stroke({width:c.feedback?3:2,color,alpha:.8});
    if(c.feedback)for(let n=-2;n<=2;n++){const a=angle+n*.23;g.moveTo(x+Math.cos(a)*20,y+Math.sin(a)*20).lineTo(x+Math.cos(a)*26,y+Math.sin(a)*26).stroke({width:1.5,color});}
  }
  if(c.phase==='charge'){
    g.arc(x,y,12,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.max(.02,c.progress)).stroke({width:2,color:c.heavy?0xe4b86c:0xd8d4bf,alpha:.8});
  }
  if(c.phase==='windup'||c.phase==='recovery'&&c.progress<.3){
    const s=attackSpec(c.weapon,c.heavy,false,angle),r=Math.min(s.reach,c.weapon==='bow'?65:48),alpha=c.phase==='windup'?.25:Math.max(0,.8-c.progress*2);
    if(c.weapon==='spear'||c.weapon==='bow')g.moveTo(x,y).lineTo(x+Math.cos(angle)*r,y+Math.sin(angle)*r).stroke({width:c.phase==='windup'?1:3,color:0xe8e1c9,alpha});
    else g.arc(x,y,r*.75,angle-s.arc/2,angle+s.arc/2).stroke({width:c.phase==='windup'?1:3,color:0xe8e1c9,alpha});
  }
  if(c.phase==='dodge')for(const n of [-1,1])g.moveTo(x-8,y+n*5).lineTo(x-15,y+n*7).stroke({width:1,color:0xc9bfa7,alpha:.55});
}
export function drawDuelCue(g:Graphics,d?:DuelLive,offset=0){
  if(!d)return;const x=d.x+offset,y=d.y+offset;
  if(d.phase==='windup'){
    const endX=x+Math.cos(d.angle)*d.reach,endY=y+Math.sin(d.angle)*d.reach;
    if(d.style==='archer'||d.style==='keeper'){
      const w=d.style==='keeper'?9:6,dx=-Math.sin(d.angle)*w,dy=Math.cos(d.angle)*w;
      g.poly([x+dx,y+dy,endX+dx,endY+dy,endX-dx,endY-dy,x-dx,y-dy]).stroke({width:1.2,color:0xe7bd79,alpha:.65});
    }else g.arc(x,y,d.reach,d.angle-.8,d.angle+.8).stroke({width:1.5,color:0xe7bd79,alpha:.75});
    g.circle(x,y,5+d.progress*3).stroke({width:1,color:0xe7bd79,alpha:.65});
  }else if(d.phase==='stagger')g.circle(x,y-28,5).stroke({width:1.5,color:0xeee2c0});
  else if(d.phase==='guard')g.arc(x,y-5,15,d.angle-1,d.angle+1).stroke({width:1.5,color:0xb7bbb8,alpha:.65});
}
interface CombatDeps {
  send:(m:object)=>void;
  context:()=>{enabled:boolean;me:PlayerSnapshot|undefined;inside:boolean};
  swing:()=>void;
}
export function setupPlayerCombat(deps:CombatDeps){
  let held=false,guarding=false,angle:number|undefined,lastAim=0,inside=false;
  const guide=document.createElement('div');guide.id='combat-guide';guide.hidden=true;document.body.append(guide);
  const css=document.createElement('style');css.textContent=`#combat-guide{position:fixed;bottom:92px;left:50%;transform:translateX(-50%);z-index:17;padding:6px 12px;max-width:70vw;box-sizing:border-box;background:#eadcbbef;border:1px solid #907953;box-shadow:0 2px 5px #0005;color:#382e21;text-align:center;font:12px Georgia;pointer-events:none}#combat-guide[hidden]{display:none}body.interior-mode #combat-guide{bottom:18px}`;document.head.append(css);
  const send=(action:string,extra:object={})=>deps.send({type:'combat',action,...(angle===undefined?{}:{angle}),...extra});
  function cancel(){if(held||guarding)send('cancel');held=guarding=false;angle=undefined;}
  function press(){if(!deps.context().enabled||held)return false;held=true;send('press');return true;}
  function release(){if(!held)return;held=false;if(deps.context().enabled){send('release');}else send('cancel');}
  function aim(x:number,y:number){const c=deps.context(),p=c.me?.inside??c.me;if(!p||!c.enabled)return;const dx=x-p.x,dy=y-p.y;if(Math.hypot(dx,dy)<3)return;angle=Math.atan2(dy,dx);if(performance.now()-lastAim>100){send('aim');lastAim=performance.now();}}
  window.addEventListener('keyup',e=>{if(e.code==='Space')release();});
  window.addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.repeat||e.ctrlKey||e.altKey||e.metaKey||!(e.code==='ShiftLeft'||e.code==='ShiftRight')||!deps.context().enabled)return;
    if(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,button,[contenteditable=true]'))return;
    // Shift+Space remains pause. The sidestep is triggered on release of Shift, below.
    shiftAt=performance.now();shiftUsed=false;
  });
  let shiftAt=0,shiftUsed=false;
  window.addEventListener('keydown',e=>{if(e.shiftKey&&e.code!=='ShiftLeft'&&e.code!=='ShiftRight'&&!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))shiftUsed=true;});
  window.addEventListener('keyup',e=>{
    if((e.code==='ShiftLeft'||e.code==='ShiftRight')&&shiftAt&&performance.now()-shiftAt<450&&!shiftUsed&&deps.context().enabled){e.preventDefault();send('dodge');}
    if(e.code==='ShiftLeft'||e.code==='ShiftRight')shiftAt=0;
  });
  window.addEventListener('pointerdown',e=>{
    if(e.button!==2||!(e.target instanceof HTMLCanvasElement)||!deps.context().enabled)return;
    e.preventDefault();e.stopImmediatePropagation();guarding=true;send('guard',{on:true});
  },true);
  window.addEventListener('pointerup',e=>{if(e.button===2&&guarding){guarding=false;send('guard',{on:false});}},true);
  window.addEventListener('blur',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  let lastText='',lastPhase='';
  function update(){
    const c=deps.context();guide.hidden=!c.enabled;
    if(!c.enabled||inside!==c.inside){cancel();inside=c.inside;}
    if(!c.enabled)return;
    const s=c.me?.combat;
    if(s?.phase==="windup"&&lastPhase!=="windup")deps.swing();lastPhase=s?.phase??"";
    const action=s?.feedback==='parry'?'Perfect block — counterattack!':s?.feedback==='guardBreak'?'Guard broken':s?.phase==='charge'?(s.heavy?'Heavy ready — release Space':'Preparing strike…'):s?.phase==='guard'?'Guarding — protect your front':s?.phase==='windup'?'Striking…':s?.phase==='recovery'?'Recovering…':s?.counter?'Counterattack ready':'';
    const dodge=c.me?.mounted?'Mounted · keep moving':s?.dodgeCooldown?`Sidestep ${(s.dodgeCooldown/20).toFixed(1)}s`:'Tap Shift · sidestep';
    const text=[action,'Space · strike / hold for heavy','RMB · shield',dodge].filter(Boolean).join('   ·   ');
    if(text!==lastText){guide.textContent=text;lastText=text;}
  }
  return{press,release,aim,update,cancel};
}
