import {heroProfileOf} from './heroes.js';
import {TileType} from '@colony/shared/protocol';
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
  }else if(msg.mode==='fire'||msg.mode==='rack'){
   const campIndex=state.tiles.indexOf(TileType.CampEntrance);
   const h=msg.mode==='rack'&&campIndex>=0?{tx:campIndex%state.WORLD_TILES_X,ty:Math.floor(campIndex/state.WORLD_TILES_X)}:specialResidences().find(h=>h.hostile&&state.tiles[h.ty*state.WORLD_TILES_X+h.tx]===TileType.RuinEntrance)??specialResidences().find(h=>h.id==='king-rusk')!;
   p.x=(h.tx+.5)*32;p.y=(h.ty+1.5)*32;enterInterior(p,h.tx,h.ty);const I=p.interior!,r=mineRecAt(h.tx,h.ty)!,g=mineInteriorMap(h.tx,h.ty,1,I.variant),L=r.layers[0];
   const prof=heroProfileOf(p);prof.spells=['fireBolt','frost','thunder','heal'];prof.spellSlots=['fireBolt','frost','thunder','heal'];prof.version=++state.heroProfileVersionCounter;
   if(msg.mode==='rack'){
    L.mobs.forEach(m=>m.hp=0);const q=g.map.props.find(q=>q.prop==='weaponRack')!;const near=[[0,1],[1,0],[-1,0],[0,-1]].map(([dx,dy])=>({x:q.x+dx,y:q.y+dy})).find(q=>!g.solid[q.y*g.map.w+q.x])!;I.x=(near.x+.5)*32;I.y=(near.y+.5)*32;
   }else{
    let a={x:g.map.spawn.x,y:g.map.spawn.y};for(let y=3;y<g.map.h-3;y++)for(let x=3;x<g.map.w-6;x++)if([0,1,2,3].every(d=>!g.solid[y*g.map.w+x+d])){a={x,y};break;}
    const m=L.mobs[0];L.mobs=[m];Object.assign(m,{x:a.x+3,y:a.y,hp:200,maxHp:200,awake:false,specialId:undefined,speed:0,cd:100000});I.x=(a.x+.5)*32;I.y=(a.y+.5)*32;
   }
   state.cycleTick+=20-state.cycleTick%20;updateMines();state.isPaused=true;refreshInteriorView();
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
 return{players:[...players.values()].map(p=>({id:p.id,inside:p.interior?.key})),journal:journalSnapshot(p),exploration:explorationView(p,false),inside:p.interior,mobs:p.interior?mineRecAt(p.interior.tx,p.interior.ty)?.layers[0]?.mobs.map(m=>({id:m.id,hp:m.hp,x:m.x,y:m.y})):[]};
}
