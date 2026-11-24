import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {TileType,isSolidTile} from '../shared/src/protocol.js';
import {LANDMARK_ART,LANDMARK_ART_URLS} from '../shared/src/landmarkArt.js';
import {encounterAnchor} from '../shared/src/encounters.js';
import {state,mobs,players} from './src/state.js';
import {generateWorld} from './src/worldgen.js';
import {generatedRegionPlan} from './src/regionWorld.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {enterInterior,exitInterior} from './src/interiors.js';
import {mineRecAt} from './src/mines.js';
import type {Player} from './src/types.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();await generateWorld(42);
for(const url of LANDMARK_ART_URLS)assert(existsSync('client/public'+url));
assert(LANDMARK_ART[TileType.CaveEntrance]!.w>=8,'obvious giant cave scale');
const counts={camp:0,cave:0,ruin:0},roadCounts:number[]=[];
for(const r of generatedRegionPlan!.regions){
 if(!['camp','cave','ruin'].includes(r.kind)||r.city!==undefined)continue;
 const a:number[]=[];for(let y=0;y<32;y++)for(let x=0;x<32;x++)a.push(state.tiles[(r.y*32+y)*state.WORLD_TILES_X+r.x*32+x]);
 const anchor=(r.kind==='camp'?26:r.kind==='cave'?21:27)*32+16;if(a[anchor]!== (r.kind==='camp'?TileType.CampEntrance:r.kind==='cave'?TileType.CaveEntrance:TileType.RuinEntrance))continue;
 counts[r.kind as keyof typeof counts]++;
 const entrances=a.flatMap((t,i)=>[TileType.CampEntrance,TileType.CampSideEntrance,TileType.CaveEntrance,TileType.RuinEntrance,TileType.RuinSideEntrance].includes(t)?[i]:[]);
 const seed=anchor+32;assert(!isSolidTile(a[seed]));const seen=new Set([seed]),q=[seed];
 for(let k=0;k<q.length;k++){const i=q[k],x=i%32,y=Math.floor(i/32);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*32+xx;if(xx<0||xx>31||yy<0||yy>31||seen.has(j)||isSolidTile(a[j]))continue;seen.add(j);q.push(j);}}
 for(const e of entrances)assert(seen.has(e+32),'every entrance approach joins the same outdoor paths');
 for(let i=0;i<a.length;i++)if(a[i]===TileType.Road&&(i%32===0||i%32===31||i<32||i>=992))assert(seen.has(i),'regional road seam stays reachable');
 roadCounts.push(a.filter(t=>t===TileType.Road).length);
 assert(a.includes(TileType.Tree)&&a.includes(TileType.Overgrowth),'vegetation '+r.kind+' '+r.x+','+r.y+' trees='+a.filter(t=>t===TileType.Tree).length+' brambles='+a.filter(t=>t===TileType.Overgrowth).length);
 if(r.kind==='camp'){
  assert(entrances.length>=1&&entrances.length<=2);assert(a.filter(t=>t===TileType.Wall).length>70);assert(a.filter(t=>t===TileType.BanditTower).length===4);assert(a.includes(TileType.BanditHall)&&a.filter(t=>t===TileType.BanditTent).length===4);
  // The palisade stays closed: no ordinary ground route from the yard to the outside.
  const inside=16*32+16,visited=new Set([inside]),queue=[inside];for(let k=0;k<queue.length;k++){const i=queue[k],x=i%32,y=Math.floor(i/32);assert(x>0&&x<31&&y>0&&y<31,'fort boundary is closed');for(const j of [i-1,i+1,i-32,i+32])if(!isSolidTile(a[j])&&!visited.has(j)){visited.add(j);queue.push(j);}}
 }else{
  for(const t of [TileType.SkullBones,TileType.FallenSkeleton,TileType.Cobweb])assert(a.filter(v=>v===t).length>=4,'remains and webs throughout the landmark');
  if(r.kind==='cave'){assert.equal(a.filter(t=>t===TileType.CaveEntrance).length,1);assert(a.filter(t=>t===TileType.CaveCliff).length>=28,'large cave artwork has matching cliff collision');}else assert(a.filter(t=>t===TileType.RuinTower).length===2&&a.filter(t=>t===TileType.RuinMasonry).length===4);
 }
}
assert(Object.values(counts).every(n=>n>0));const average=roadCounts.reduce((a,b)=>a+b)/roadCounts.length;assert(average<120,'no surrounding road circuits');
const side=state.tiles.indexOf(TileType.CampSideEntrance);assert(side>=0);const x=side%state.WORLD_TILES_X,y=Math.floor(side/state.WORLD_TILES_X),p={id:'side-test',profileKey:'side-test',clan:0,hp:100,dead:false,input:{dx:0,dy:0},socket:{OPEN:1,readyState:0,send:()=>{}}} as Player;players.set(p.id,p);assert.equal(enterInterior(p,x,y),'');const shared=mineRecAt(x,y),a=encounterAnchor(x,y,TileType.CampSideEntrance);assert.equal(shared,mineRecAt(a.x,a.y));assert.equal(p.interior!.key,`${a.x},${a.y}`);exitInterior(p);players.delete(p.id);
assert(![...mobs.values()].some(m=>['ruin','encampment','castleRuin'].includes(m.siteKind??'')));
console.log('PASS decorated closed forts/1-2 shared entrances, giant cave, overgrowth/remains/webs, masonry, all approach/seam paths, no outdoor guards; mean roads',average.toFixed(1),counts);process.exit(0);
