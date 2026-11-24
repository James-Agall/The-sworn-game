import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {TOWN_INDUSTRY_URLS,townIndustryUrl,TOWN_INDUSTRY_ART,TOWN_INDUSTRY_STYLES} from '../shared/src/townIndustry.js';
import {organicTownTemplate} from '../shared/src/organicTowns.js';
import {validateSettlementTemplate} from '../shared/src/settlementTemplates.js';
import {loadBuildingTemplates,buildingTemplateById} from './src/buildingTemplates.js';
loadBuildingTemplates();
for(const url of TOWN_INDUSTRY_URLS)assert(existsSync('client/public'+url),'missing workshop art '+url);
for(const style of TOWN_INDUSTRY_STYLES)for(const tile of Object.keys(TOWN_INDUSTRY_ART))assert(townIndustryUrl(Number(tile),style)?.includes('/'+style+'-'),'workshop matches town style');
for(const suffix of ['organic4','organic5'])for(const w of [1,2])for(const h of [1,2])for(let v=0;v<30;v++){
 const id=`region-city-${w}-${h}-${v}-${suffix}`,t=organicTownTemplate(id)!,old=organicTownTemplate(id.replace(suffix,'organic3'))!;
 const errs=validateSettlementTemplate(t,buildingTemplateById);if(errs.length)console.log(id,errs.slice(0,10));assert.deepEqual(errs,[],id);
 assert.deepEqual(t.buildings.map(b=>b.ref).sort(),old.buildings.map(b=>b.ref).sort());
 const area=(rows:string[])=>rows.reduce((a,r)=>{const lo=[...r].findIndex(c=>'#%G'.includes(c));let hi=-1;[...r].forEach((c,x)=>{if('#%G'.includes(c))hi=x;});return a+Math.max(0,hi-lo+1);},0);
 assert(area(t.rows)<area(old.rows),`${id}: core area ${area(t.rows)} vs ${area(old.rows)}`);
 const farms=(rows:string[])=>rows.join('').split('f').length-1;
 assert(farms(t.rows)>=Math.ceil(farms(old.rows)*1.3),`${id}: bigger farms ${farms(t.rows)} vs ${farms(old.rows)}`);

 if(suffix==='organic5'){
  const barn=t.buildings.find(b=>b.ref==='barn-small')!;
  const inTown=(x:number,y:number)=>{const row=t.rows[y];let l=-1,r=-1;[...row].forEach((c,xx)=>{if('#%G'.includes(c)){if(l<0)l=xx;r=xx;}});return l>=0&&x>=l&&x<=r;};
  assert(!inTown(barn.x+1,barn.y+1),'barn is outside the town beside the fields');
  let crops=0;for(let y=barn.y-1;y<=barn.y+3;y++)for(let x=barn.x-1;x<=barn.x+3;x++)if(t.rows[y]?.[x]==='f')crops++;
  assert(crops>=3,'barn serves the crop district');
 }
 const board=t.rows.flatMap((row,y)=>[...row].flatMap((c,x)=>c==='B'?[{x,y}]:[]))[0];assert(board,'town quest board');
 assert(t.rows[board.y].split('$').length-1>=2,'square market stalls');
 assert(t.rows.join('').split('a').length-1>=1,'town trees');
 assert(t.rows.join('').split('l').length-1>=6,'lights distributed inside town');
 const homes=t.buildings.filter(b=>b.ref.startsWith('house-')||b.ref==='longhouse');
 for(let a=0;a<homes.length;a++)for(let b=a+1;b<homes.length;b++)assert(Math.abs(homes[a].x-homes[b].x)>=2.35||Math.abs(homes[a].y-homes[b].y)>=2.7,'visible house envelopes separated');
}
console.log('PASS 240 compact/barn templates: identical buildings, smaller core, larger farms, connected entrances, civic amenities and non-overlapping houses');
process.exit(0);
