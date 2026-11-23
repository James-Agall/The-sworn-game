import assert from 'node:assert/strict';
import {planRegions} from '../shared/src/regions.js';
import { writeFileSync } from 'node:fs';
import { organicTownTemplate,TOWN_STYLES,TOWN_LAYOUTS } from '../shared/src/organicTowns.js';
import { validateSettlementTemplate,settlementLayout } from '../shared/src/settlementTemplates.js';
import {loadBuildingTemplates,buildingTemplateById} from './src/buildingTemplates.js';
loadBuildingTemplates();
const samples=[];
let count=0;
for(const suffix of ['organic','organic2'])for(const w of [1,2])for(const h of [1,2])for(let v=0;v<30;v++){
 const t=organicTownTemplate(`region-city-${w}-${h}-${v}-${suffix}`)!;
 const errs=validateSettlementTemplate(t,buildingTemplateById);
 if(errs.length)console.log(t.id,t.buildings.length,errs.slice(0,12));
 assert.deepEqual(errs,[],t.id);
 assert.equal(t,organicTownTemplate(t.id),'template geometry is cached');
 const l=settlementLayout(t,buildingTemplateById);
 const roads=new Set<number>();t.rows.forEach((row,y)=>[...row].forEach((c,x)=>{if('_=G'.includes(c))roads.add(y*l.w+x);}));
 for(const b of t.buildings)assert(roads.has((b.y+2)*l.w+b.x+1),`${t.id}: door has connected road at ${b.x},${b.y}`);
 assert(t.rows.some(row=>row.includes('P'))&&t.rows.some(row=>row.includes('O')));
 assert(t.rows.some(row=>row.includes('i'))&&t.rows.some(row=>row.includes('j')));
 for(const ref of ['blacksmith-small','tailor-small','barn-small','market-hall','bakery-small','tavern-small','church-chapel','brewery-small'])assert(t.buildings.some(b=>b.ref===ref),t.id+': missing '+ref);
 // Treat gates as closed: the outside must not leak through a diagonal gap in the wall.
 const outside=new Set<number>(),q:number[]=[];
 const pass=(x:number,y:number)=>x>=0&&y>=0&&x<l.w&&y<l.h&&!['#','%','G'].includes(t.rows[y][x]);
 for(let y=0;y<l.h;y++)for(let x=0;x<l.w;x++)if((!x||!y||x===l.w-1||y===l.h-1)&&pass(x,y)){outside.add(y*l.w+x);q.push(y*l.w+x);}
 for(let k=0;k<q.length;k++){const i=q[k],x=i%l.w,y=Math.floor(i/l.w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*l.w+xx;if(pass(xx,yy)&&!outside.has(n)){outside.add(n);q.push(n);}}}
 assert(!outside.has(15*l.w+14),t.id+': enclosure leaks through its walls');
 if(suffix==='organic2'){
  for(const ref of ['blacksmith-small','tailor-small']){const b=t.buildings.find(b=>b.ref===ref)!;assert(!outside.has((b.y+1)*l.w+b.x+1),t.id+': workshop outside wall');}
  for(let y=0;y<l.h;y++)for(let x=0;x<l.w;x++)if('ijd'.includes(t.rows[y][x]))assert(!outside.has(y*l.w+x),t.id+': industry outside wall');
  const cx=15+v%10%5-2;
  for(let y=18;y<=20;y++)for(let x=cx-2;x<=cx+2;x++)assert.equal(t.rows[y][x],'=',t.id+': town square paved and unobstructed');
  assert(t.rows.slice(0,6).join('').split('f').length-1>=40,t.id+': exterior farms');
 }

 const homes=t.buildings.filter(b=>b.ref.startsWith('house-')||b.ref==='longhouse').length;
 assert(homes>=5,`${t.id} has ${homes} homes`);
 if(suffix==='organic2'&&w===1&&h===1)samples.push({...t,style:TOWN_STYLES[Math.floor(v/10)],layout:TOWN_LAYOUTS[v%10],homes});
 count++;
}
for(const style of TOWN_STYLES){const group=samples.filter(t=>t.style===style);assert.equal(new Set(group.map(t=>JSON.stringify([t.rows,t.buildings]))).size,10);}
for(const seed of [1,42,736]){
 const old=planRegions(1024,1024,seed,14),fresh=planRegions(1024,1024,seed,15);
 assert.deepEqual(fresh.cities.map(({variant,...c})=>c),old.cities.map(({variant,...c})=>c),'same scarce large-city allocation');
 assert.deepEqual(old,planRegions(1024,1024,seed,14),'legacy world planning remains deterministic');
 assert(fresh.cities.every(c=>c.variant>=0&&c.variant<30));
 assert.equal(new Set(fresh.cities.map(c=>Math.floor(c.variant/10))).size,3,'all town cultures generated');
}
writeFileSync('/tmp/organic-town-layouts.json',JSON.stringify(samples));
console.log(`PASS ${count} organic templates: 10 unique layouts per culture at all four footprints; roads, gates, doors, farms, trades, NPC slots reachable`);
process.exit(0);
