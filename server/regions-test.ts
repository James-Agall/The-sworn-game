import assert from 'node:assert/strict';
import { isSolidTile,isGateTile } from '../shared/src/protocol.js';
import { planRegions,regionCityTemplate } from '../shared/src/regions.js';
import { validateSettlementTemplate } from '../shared/src/settlementTemplates.js';
import { loadBuildingTemplates,buildingTemplateById } from './src/buildingTemplates.js';
import { loadSettlementTemplates } from './src/settlementTemplates.js';
import { loadCampTemplates } from './src/camps.js';
import { generateWorld } from './src/worldgen.js';
import { state,sites,mobs } from './src/state.js';
import { generatedRegionPlan } from './src/regionWorld.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();
for(const suffix of ["","-dense","-district"])for(const w of [1,2])for(const h of [1,2])for(let v=0;v<6;v++){
 const t=regionCityTemplate(`region-city-${w}-${h}-${v}${suffix}`)!;
 const errors=validateSettlementTemplate(t,buildingTemplateById);
 assert.deepEqual(errors,[],t.id+': '+errors.join(', '));
}
for(const size of [128,160,256,512])for(const seed of [1,42,736]){
 const p=planRegions(size,size,seed);assert.deepEqual(p,planRegions(size,size,seed));
 const reached=new Set([0]),pending=[0];
 while(pending.length){const n=pending.pop()!,r=p.regions[n];
  const neighbours=[];
  if(r.east)neighbours.push(n+1);if(r.south)neighbours.push(n+p.columns);
  if(r.x&&p.regions[n-1].east)neighbours.push(n-1);
  if(r.y&&p.regions[n-p.columns].south)neighbours.push(n-p.columns);
  for(const id of neighbours)if(!reached.has(id)){reached.add(id);pending.push(id);}
 }
 assert.equal(reached.size,p.regions.length,'road graph connected');
}
await generateWorld(42);
assert(generatedRegionPlan);assert(sites.size>0,'real settlement sites');assert(mobs.size>0,'real NPC/encounter entities');
const visited=new Set<number>(),queue=[state.townCenters[0].y*state.WORLD_TILES_X+state.townCenters[0].x];
visited.add(queue[0]);
for(let k=0;k<queue.length;k++){
 const i=queue[k],x=i%state.WORLD_TILES_X,y=Math.floor(i/state.WORLD_TILES_X);
 for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
  const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=state.WORLD_TILES_X||yy>=state.WORLD_TILES_Y)continue;
  const n=yy*state.WORLD_TILES_X+xx,t=state.tiles[n];
  if(!visited.has(n)&&(!isSolidTile(t)||isGateTile(t))){visited.add(n);queue.push(n);}
 }
}
for(const site of sites.values())assert([[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy])=>visited.has((site.keepY+dy)*state.WORLD_TILES_X+site.keepX+dx)),`city ${site.layout} is reachable from player start`);
const owners=new Map<number,string>();
for(const site of sites.values())for(let y=Math.floor(site.y0/32);y<=Math.floor(site.y1/32);y++)for(let x=Math.floor(site.x0/32);x<=Math.floor(site.x1/32);x++){
 const chunk=y*Math.ceil(state.WORLD_TILES_X/32)+x;
 assert(!owners.has(chunk),`two settlement identities in chunk ${x},${y}`);owners.set(chunk,site.id);
}
const planned=generatedRegionPlan!.cities;
assert(planned.filter(c=>c.w===2&&c.h===2).length<=1,'at most one 2x2 city');
assert(planned.filter(c=>c.w*c.h===2).length<=3,'at most three double-region cities');
assert(planned.filter(c=>c.w===2&&c.h===1).length===0,'double-region cities are 1x2');
for(const city of planned)assert(city.w*city.h===1||city.w===1&&city.h===2||city.w===2&&city.h===2);
if(state.WORLD_TILES_X>=512){
 assert.equal(planned.filter(c=>c.w===2&&c.h===2).length,1);
 assert(planned.filter(c=>c.w===1&&c.h===2).length>=1);
 assert.equal([...sites.values()].filter(s=>s.layout?.startsWith('region-city-2-2-')).length,1,'large city actually stamped');
}
const district=regionCityTemplate('region-city-1-1-0-district')!;
const dense=regionCityTemplate('region-city-1-1-0-dense')!;
const houses=(t:typeof district)=>t.buildings.filter(b=>b.ref.startsWith('house-')||b.ref==='longhouse').length;
console.log(`Housing count ${houses(dense)} -> ${houses(district)}`);
assert(houses(district)>houses(dense),"more houses than the previous layout");
assert(district.rows.some(r=>r.includes('i'))&&district.rows.some(r=>r.includes('j')),'metal production chain');
assert(district.rows.some(r=>r.includes('P'))&&district.rows.some(r=>r.includes('O')),'pasture and orchard');
console.log(`City sizes: ${planned.filter(c=>c.w*c.h===4).length} large, ${planned.filter(c=>c.w*c.h===2).length} double, ${planned.filter(c=>c.w*c.h===1).length} single`);
console.log('PASS one settlement identity per chunk and actual entrances reachable from player start');
console.log('PASS 24 composed city templates, deterministic connected plans, real generated settlements and entities');
process.exit(0);
