import assert from 'node:assert/strict';
import {organicTownTemplate} from '../shared/src/organicTowns.js';
import {validateSettlementTemplate} from '../shared/src/settlementTemplates.js';
import {loadBuildingTemplates,buildingTemplateById} from './src/buildingTemplates.js';
loadBuildingTemplates();
for(const w of [1,2])for(const h of [1,2])for(let v=0;v<30;v++){
 const id=`region-city-${w}-${h}-${v}-organic4`,t=organicTownTemplate(id)!,old=organicTownTemplate(id.replace('organic4','organic3'))!;
 const errs=validateSettlementTemplate(t,buildingTemplateById);if(errs.length)console.log(id,errs.slice(0,10));assert.deepEqual(errs,[],id);
 assert.deepEqual(t.buildings.map(b=>b.ref).sort(),old.buildings.map(b=>b.ref).sort());
 const area=(rows:string[])=>rows.reduce((a,r)=>{const lo=[...r].findIndex(c=>'#%G'.includes(c));let hi=-1;[...r].forEach((c,x)=>{if('#%G'.includes(c))hi=x;});return a+Math.max(0,hi-lo+1);},0);
 assert(area(t.rows)<area(old.rows),`${id}: core area ${area(t.rows)} vs ${area(old.rows)}`);
 const farms=(rows:string[])=>rows.join('').split('f').length-1;
 assert(farms(t.rows)>=Math.ceil(farms(old.rows)*1.3),`${id}: bigger farms ${farms(t.rows)} vs ${farms(old.rows)}`);

 const board=t.rows.flatMap((row,y)=>[...row].flatMap((c,x)=>c==='B'?[{x,y}]:[]))[0];assert(board,'town quest board');
 assert(t.rows[board.y].split('$').length-1>=2,'square market stalls');
 assert(t.rows.join('').split('a').length-1>=1,'town trees');
 assert(t.rows.join('').split('l').length-1>=6,'lights distributed inside town');
 const homes=t.buildings.filter(b=>b.ref.startsWith('house-')||b.ref==='longhouse');
 for(let a=0;a<homes.length;a++)for(let b=a+1;b<homes.length;b++)assert(Math.abs(homes[a].x-homes[b].x)>=2.35||Math.abs(homes[a].y-homes[b].y)>=2.7,'visible house envelopes separated');
}
console.log('PASS 120 compact templates: identical buildings, smaller core, larger farms, connected entrances, civic amenities and non-overlapping houses');
process.exit(0);
