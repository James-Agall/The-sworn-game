// Roads across marsh water (2026-11-26, ROAD-WATER-2026-11-26.md). One world size per process (COLONY_WORLD_SIZE),
// one worldgen version (ROAD_WATER_VERSION). Generates each seed and prints a "ROADWATER {json}" line of road / water
// metrics; at version 23+ it also asserts the invariants: no Road / CobbleRoad tile with Water on two opposite sides
// or on 3-4 sides, no bridge on dry land away from any other bridge over water, and the start features intact.
import assert from 'node:assert/strict';
import {TileType,isRoadTile,isGateTile} from '@colony/shared/protocol';
import {state,sites} from './src/state.js';
import {generateWorld} from './src/worldgen.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {auditWorld} from './src/abstract.js';
import {auditTileRegistry} from './src/chunks.js';

const version=Number(process.env.ROAD_WATER_VERSION),seeds=(process.env.ROAD_WATER_SEEDS??'1,7,13,42,99,2024').split(',').map(Number);
assert(version>=22,'ROAD_WATER_VERSION');
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();
const log=console.log;
for(const seed of seeds){
 console.log=()=>{};
 try{await generateWorld(seed,fn=>fn(),version);}finally{console.log=log;}
 const W=state.WORLD_TILES_X,H=state.WORLD_TILES_Y,t=state.tiles;
 const at=(x:number,y:number)=>x<0||y<0||x>=W||y>=H?-1:t[y*W+x];
 const N=[[0,-1],[1,0],[0,1],[-1,0]] as const;
 const wetAround=(x:number,y:number)=>N.map(([dx,dy])=>at(x+dx,y+dy)===TileType.Water);
 let road=0,bridge=0,causeway=0,water3=0,dryBridge=0,lonelyBridge=0;const bad:string[]=[];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const v=t[y*W+x];if(!isRoadTile(v))continue;
  const wn=wetAround(x,y),n=wn.filter(Boolean).length;
  if(v===TileType.RiverBridge){
   bridge++;
   if(n>0)continue;
   dryBridge++;
   // A dry bridge tile is fine as the second lane of a wide bridge: next to a bridge tile that does span water.
   if(!N.some(([dx,dy])=>at(x+dx,y+dy)===TileType.RiverBridge&&wetAround(x+dx,y+dy).some(Boolean))){lonelyBridge++;if(bad.length<5)bad.push(`lonely bridge ${x},${y}`);}
  }else{
   road++;
   if(wn[0]&&wn[2]||wn[1]&&wn[3]){causeway++;if(bad.length<5)bad.push(`causeway ${x},${y}`);}
   if(n>=3){water3++;if(bad.length<5)bad.push(`road with ${n} water sides ${x},${y}`);}
  }
 }
 // The road network: road / bridge / gate tiles, 4-connected. Linked = touches the largest network.
 const net=(v:number)=>isRoadTile(v)||isGateTile(v),comp=new Int32Array(W*H).fill(-1),sizes:number[]=[];
 for(let i=0;i<W*H;i++){
  if(comp[i]>=0||!net(t[i]))continue;
  const id=sizes.length,q=[i];let n=0;comp[i]=id;
  while(q.length){const j=q.pop()!;n++;const x=j%W,y=(j-x)/W;for(const [dx,dy]of N){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=W||yy>=H)continue;const k=yy*W+xx;if(comp[k]<0&&net(t[k])){comp[k]=id;q.push(k);}}}
  sizes.push(n);
 }
 const largest=Math.max(...sizes),big=sizes.indexOf(largest);
 const touches=(x0:number,y0:number,x1:number,y1:number)=>{for(let y=Math.max(0,y0);y<=Math.min(H-1,y1);y++)for(let x=Math.max(0,x0);x<=Math.min(W-1,x1);x++)if(comp[y*W+x]===big)return true;return false;};
 const c0=state.townCenters[0];
 let linked=0;for(const s of sites.values())if(touches(s.x0-3,s.y0-3,s.x1+3,s.y1+3))linked++;
 const audit=auditWorld(),registry=auditTileRegistry();
 const m={size:W,seed,version,road,bridge,causeway,water3,dryBridge,lonelyBridge,components:sizes.length,largest,
  townCentre:t[c0.y*W+c0.x]===TileType.TownCenter,townCentreLinked:touches(c0.x-4,c0.y-4,c0.x+4,c0.y+4),settlements:sites.size,linked,
  auditProblems:audit.problems.length,registryMismatches:registry};
 log('ROADWATER '+JSON.stringify(m));
 assert(m.townCentre,'the start Town Center is stamped');
 assert(m.townCentreLinked,'the start joins the road network');
 assert(m.settlements>=1,'settlements are placed');
 assert.equal(m.auditProblems,0,'world audit: '+audit.problems.join('; '));
 assert.equal(registry,0,'tile registry matches a full scan');
 if(version>=23){
  assert.equal(causeway,0,`${W} seed ${seed}: no road with water on opposite sides (${bad.join('; ')})`);
  assert.equal(water3,0,`${W} seed ${seed}: no road with water on 3-4 sides (${bad.join('; ')})`);
  assert.equal(lonelyBridge,0,`${W} seed ${seed}: every bridge spans water or widens one that does (${bad.join('; ')})`);
 }
}
process.exit(0);
