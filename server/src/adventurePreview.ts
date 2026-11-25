// Only called by the existing COLONY_TEST_HOOKS gate. No live-game endpoint.
import {players,state} from './state.js';
import type {Player} from './types.js';
import {specialResidences} from './specialCast.js';
import {STORIES} from '@colony/shared/stories';
import {lifeOf} from './herolife.js';
import {enterInterior,exitInterior,refreshInteriorView,handleInteriorTalk} from './interiors.js';
import {mineRecAt,mineInteriorMap,updateMines} from './mines.js';
import {journalSnapshot,sendJournal,storyOnMeet} from './story.js';
import {explorationView} from './adventureLoot.js';
export function adventurePreview(caller:Player,msg:Record<string,unknown>){
 const p=typeof msg.target==='string'?players.get(msg.target):caller;
 if(!p)return{error:'No player'};
 if(typeof msg.mode==='string'){
  if(p.interior)exitInterior(p);p.dead=false;p.hp=1000;p.attackCooldownTicks=0;p.input={dx:0,dy:0};const f=lifeOf(p).flags;
  if(msg.mode==='journal'||msg.mode==='story'){
   for(const s of STORIES)f[`story:${s.id}:heard`]=1;
   f['story:iron-and-oaths:step']=1;f['journal:track:iron-and-oaths']=1;
   f['story:the-unrung-bell:step']=3;f['story:cloth-for-the-living:step']=2;
   for(const h of specialResidences().filter(h=>!h.hostile).slice(0,12))f[`cast:met:${h.id}`]=1;
   const h=specialResidences().find(h=>h.id==='hesta-ironroot')!;p.x=(h.tx+.5)*32;p.y=(h.ty+1.5)*32;
   if(msg.mode==='story'){enterInterior(p,h.tx,h.ty);refreshInteriorView();}
  }else if(msg.mode==='loot'||msg.mode==='boss'){
   const h=specialResidences().find(h=>h.id===(msg.mode==='boss'?'old-granite':'king-rusk'))!;p.x=(h.tx+.5)*32;p.y=(h.ty+1.5)*32;enterInterior(p,h.tx,h.ty);const I=p.interior!,r=mineRecAt(h.tx,h.ty)!,grid=mineInteriorMap(h.tx,h.ty,1,I.variant),objects=explorationView(p,false)!.objects;
   if(msg.mode==='loot'){const o=objects.find(o=>o.kind===(typeof msg.object==='string'?msg.object:'key'))!;const a=[[0,1],[0,-1],[1,0],[-1,0]].map(([dx,dy])=>({x:o.x+dx,y:o.y+dy})).find(a=>!grid.solid[a.y*grid.map.w+a.x])!;I.x=(a.x+.5)*32;I.y=(a.y+.5)*32;for(const m of r.layers[0].mobs){m.awake=false;m.x=grid.map.lairs![0].x;m.y=grid.map.lairs![0].y;}}
   else{
    const m=r.layers[0].mobs.find(m=>m.specialId==='old-granite')!;r.layers[0].mobs=[m];m.awake=true;const free=[];for(let y=3;y<grid.map.h-3;y++)for(let x=3;x<grid.map.w-3;x++)if(!grid.solid[y*grid.map.w+x]&&!grid.solid[y*grid.map.w+x+1]&&!grid.solid[(y+1)*grid.map.w+x]&&!grid.solid[(y-1)*grid.map.w+x])free.push({x,y});const a=free.find(a=>Math.hypot(a.x-grid.map.spawn.x,a.y-grid.map.spawn.y)>6)!;m.x=a.x;m.y=a.y;I.x=(a.x+1.5)*32;I.y=(a.y+.5)*32;r.layers[0].lastActiveTick=state.cycleTick-1;m.bossState={phase:'windup',start:state.cycleTick,end:state.cycleTick+600,x:a.x+1,y:a.y,fromX:m.x,fromY:m.y};state.cycleTick+=3;r.layers[0].lastActiveTick=state.cycleTick-1;updateMines();
   }
   refreshInteriorView();
  }
  sendJournal(p,true);
 }
 return{players:[...players.values()].map(p=>({id:p.id,inside:p.interior?.key})),journal:journalSnapshot(p),exploration:explorationView(p,false)};
}
