import {setTile} from './chunks.js';
import {broadcastTileUpdate} from './net.js';
import {spawnMobAt} from './creative.js';
import {grantFoundEquipment,handleEquipItem,heroProfileOf} from './heroes.js';
import {TileType} from '@colony/shared/protocol';
// Only called by the existing COLONY_TEST_HOOKS gate. No live-game endpoint.
import {players,mobs,state} from './state.js';
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
  if(msg.mode==='expedition'||msg.mode==='expedition-return'){
    const tx=f['adv:rescue-0:target:x'],ty=f['adv:rescue-0:target:y'];if(!f['adv:rescue-0:accepted'])return{error:'Accept the apprentice contract through the journal first'};
    p.creativeGod=true;p.hp=100;state.isPaused=false;
    if(msg.mode==='expedition-return'){p.x=(f['adv:rescue-0:issuer:x']+.5)*32;p.y=(f['adv:rescue-0:issuer:y']+1.5)*32;}
    else{p.x=(tx+.5)*32;p.y=(ty+1.5)*32;enterInterior(p,tx,ty);const I=p.interior!,r=mineRecAt(tx,ty)!,g=mineInteriorMap(tx,ty,1,I.variant),object=explorationView(p,false)!.objects.find(o=>o.kind===(typeof msg.object==='string'?msg.object:'key'));if(!object)return{error:'No such object'};const at=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:object.x+dx,y:object.y+dy})).find(a=>!g.solid[a.y*g.map.w+a.x]);if(!at)return{error:'No approach'};I.x=(at.x+.5)*32;I.y=(at.y+.5)*32;const free:{x:number;y:number}[]=[];for(let y=2;y<g.map.h-2;y++)for(let x=2;x<g.map.w-2;x++)if(!g.solid[y*g.map.w+x]&&Math.hypot(x-object.x,y-object.y)>9)free.push({x,y});r.layers[0].mobs.forEach((m,n)=>{Object.assign(m,free[n%free.length]??{x:2,y:2},{speed:0,awake:false,cd:100000});});refreshInteriorView();}
   }else if(msg.mode==='combat'){
    const x=Math.min(state.WORLD_TILES_X-14,Math.max(14,Math.floor(p.x/32))),y=Math.min(state.WORLD_TILES_Y-14,Math.max(14,Math.floor(p.y/32)));
    for(const [id,m]of mobs)if(Math.hypot(m.x-p.x,m.y-p.y)<900)mobs.delete(id);
    for(let yy=y-9;yy<=y+9;yy++)for(let xx=x-12;xx<=x+12;xx++){setTile(yy*state.WORLD_TILES_X+xx,TileType.Empty);broadcastTileUpdate(xx,yy,TileType.Empty);}
    p.x=(x+.5)*32;p.y=(y+.5)*32;
    const prof=heroProfileOf(p);prof.inventory=[];for(const slot of Object.keys(prof.equipment) as (keyof typeof prof.equipment)[])prof.equipment[slot]=null;
    for(const kind of ['sword','axe','spear','bow']){const item=grantFoundEquipment(p,'weapon',2,kind);if(kind==='sword'&&item)handleEquipItem(p,item.id,'weapon');}
    for(const slot of ['head','chest','offhand'] as const){const item=grantFoundEquipment(p,slot,2);if(item)handleEquipItem(p,item.id,slot);}
    for(const [kind,dx,dy]of [['banditClubman',1.1,0],['armoredOrc',3,-1],['skeleton',3,2],['banditArcher',5,-3]] as const){const m=spawnMobAt(kind,x,y);if(m){m.x=p.x+dx*32;m.y=p.y+dy*32;m.hp=m.maxHp=500;m.damage=1;m.speed=0;m.targetType='player';m.targetId=p.id;m.range=kind==='banditArcher'?180:kind==='banditClubman'?45:60;m.attackCooldownTicks=0;}}
    state.testPlayersIgnored=false;state.isPaused=false;
   }else if(['render','render-front','render-house','render-house-front'].includes(msg.mode)){
   const x=44,y=47,w=state.WORLD_TILES_X;
   if(msg.mode==='render')for(let yy=y-8;yy<=y+8;yy++)for(let xx=x-9;xx<=x+12;xx++){const tile=xx===x&&yy===y?TileType.Tree:xx===x+7&&yy===y?TileType.House:TileType.Empty;setTile(yy*w+xx,tile);broadcastTileUpdate(xx,yy,tile);}
   const house=msg.mode.includes('house'),front=msg.mode.endsWith('front');p.x=(x+(house?7:0)+.5)*32;p.y=(y+(front?1.6:.35))*32;state.isPaused=false;state.cycleTick=200;
  }else if(msg.mode==='journal'||msg.mode==='story'){
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
