import { organicTownTemplate } from "./organicTowns.js";
import { limitCitySizes, districtCityTemplate } from "./cityDistricts.js";
import { type SettlementTemplate } from './settlementTemplates.js';
export const REGION_SIZE = 32;
export type RegionKind = 'countryside'|'forest'|'marsh'|'camp'|'ruin'|'cave'|'city'|'fort';
export interface Region { x:number; y:number; kind:RegionKind; variant:number; east:boolean; south:boolean; city?:number }
export interface RegionCity { x:number; y:number; w:number; h:number; variant:number; fort?:boolean }
export interface RegionPlan { version:1; columns:number; rows:number; regions:Region[]; cities:RegionCity[] }
export function planRegions(width:number,height:number,seed:number,version=16):RegionPlan {
 if(version>=15){
  const p=planRegions(width,height,seed,14);
  // Style and street grammar are independent of footprint allocation and the scarce-city quotas.
  p.cities.forEach((c,i)=>{c.variant=(((Math.imul(c.x+1,73856093)^Math.imul(c.y+1,19349663)^seed)>>>0)%3)*10+(((Math.imul(i+1,83492791)^seed)>>>0)%10);});
  return p;
 }
 if(version>=14)return limitCitySizes(planRegions(width,height,seed,13),seed,width,height);
 let salt=seed>>>0;
 const random=()=>{salt=(Math.imul(salt,1664525)+1013904223)>>>0;return salt/4294967296;};
 const columns=Math.ceil(width/REGION_SIZE),rows=Math.ceil(height/REGION_SIZE);
 const kinds:RegionKind[]=['countryside','forest','forest','marsh','camp','ruin','cave','fort'];
 const regions:Region[]=[];
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  // Each cell connects north or west to an earlier cell, forming one connected road network.
  const region:Region={x,y,kind:kinds[Math.floor(random()*kinds.length)],variant:Math.floor(random()*6),east:false,south:false};
  regions.push(region);
  if(x||y){if(x&&(!y||random()<.5))regions[y*columns+x-1].east=true;else regions[(y-1)*columns+x].south=true;}
 }
 for(const r of regions){if(r.x<columns-1&&random()<.18)r.east=true;if(r.y<rows-1&&random()<.18)r.south=true;}
 const cities:RegionCity[]=[];
 const middleX=Math.floor(width/2/32),middleY=Math.floor(height/2/32);
 for(let y=1;y<rows-1;y++)for(let x=1;x<columns-1;x++){
  if(Math.abs(x-middleX)<=1&&Math.abs(y-middleY)<=1)continue;
  const r=regions[y*columns+x];if(r.city!==undefined||random()>.16)continue;
  const w=random()<.5?1:2,h=w===2&&random()<.5?2:1;
  if(x+w>=columns||y+h>=rows)continue;
  if(x<=middleX+1&&x+w>middleX-1&&y<=middleY+1&&y+h>middleY-1)continue;
  let fits=true;
  for(let yy=y-1;yy<=y+h;yy++)for(let xx=x-1;xx<=x+w;xx++)if(regions[yy*columns+xx]?.city!==undefined)fits=false;
  if(!fits)continue;
  const city={x,y,w,h,variant:r.variant},id=cities.length;cities.push(city);
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const q=regions[yy*columns+xx];q.kind='city';q.city=id;}
 }
 // A town is guaranteed on maps large enough to have an outer region away from the start.
 if(!cities.length&&columns>=5&&rows>=5){cities.push({x:1,y:1,w:1,h:1,variant:0});const r=regions[columns+1];r.kind='city';r.city=0;}
 // Forts use the same reservation map, leaving one full region between settlements.
 for(const r of version>=13?regions:[]){
  if(r.kind!=='fort')continue;
  let free=r.x>0&&r.y>0&&r.x<columns-1&&r.y<rows-1&&Math.hypot(r.x-middleX,r.y-middleY)>2;
  for(let yy=r.y-1;yy<=r.y+1;yy++)for(let xx=r.x-1;xx<=r.x+1;xx++)if(regions[yy*columns+xx]?.city!==undefined)free=false;
  if(!free){r.kind='forest';continue;}
  r.city=cities.length;cities.push({x:r.x,y:r.y,w:1,h:1,variant:r.variant,fort:true});
 }
 return {version:1,columns,rows,regions,cities};
}

// A composed city has one keep, one faction and uninterrupted streets at internal region seams.
export function regionCityTemplate(id:string):SettlementTemplate|undefined {
 if(/\-organic2?$/.test(id))return organicTownTemplate(id);
 if(id.endsWith("-district"))return districtCityTemplate(id);
 const match=/^region-city-(1|2)-(1|2)-([0-5])(-dense)?$/.exec(id);if(!match)return;
 const dense=!!match[4];
 const cw=Number(match[1]),ch=Number(match[2]),variant=Number(match[3]);
 const w=cw*32-2,h=ch*32-2;
 const cells=Array.from({length:h},()=>Array.from({length:w},()=>'.'));
 const put=(x:number,y:number,c:string)=>{cells[y][x]=c;};
 for(let x=0;x<w;x++){put(x,0,'%');put(x,h-1,'%');}
 for(let y=0;y<h;y++){put(0,y,'%');put(w-1,y,'%');}
 const streetsX=Array.from({length:cw},(_,i)=>15+i*32),streetsY=Array.from({length:ch},(_,i)=>15+i*32);
 for(const x of streetsX)for(let y=0;y<h;y++)put(x,y,y===0||y===h-1?'G':'=');
 for(const y of streetsY)for(let x=0;x<w;x++)put(x,y,x===0||x===w-1?'G':'=');
 // Cross streets connect every district and serve south-facing building doors.
 for(let y=7;y<h-3;y+=8)if(!dense)for(let x=1;x<w-1;x++)put(x,y,'_');
 if(dense)for(let district=0;district<ch;district++)for(const lane of [5,12,21,28])for(let x=1;x<w-1;x++)put(x,district*32+lane,'_');
 put(14,14,'K');put(14,15,'=');put(13,15,'=');
 for(const [x,y,c]of [[16,16,'t'],[17,16,'q'],[18,16,'r'],[13,16,'g'],[16,18,'g'],[16,17,'v']] as const)put(x,y,c);
 if(dense){put(16,10,'o');put(17,10,'l');put(16,11,'x');}else{put(16,12,'o');put(17,11,'l');put(16,10,'x');}
 const services=['market-hall','bakery-small','blacksmith-small','tavern-small','barn-small','church-chapel'];
 const homes=['house-cottage','house-townhouse','house-hut','house-two-room'];
 const buildings:SettlementTemplate['buildings']=[];
 if(dense){
  for(let ry=0;ry<ch;ry++)for(let rx=0;rx<cw;rx++)for(const localY of [2,9,18,25])for(const localX of [2,8,19,25]){
   const x=rx*32+localX,y=ry*32+localY;
   if(rx===0&&ry===0&&localX===8&&localY===9)continue;
   const index=buildings.length,ref=index<services.length?services[index]:homes[(index+variant)%homes.length];
   buildings.push({ref,x,y});
   if(index>=services.length&&index%3===0&&x+4<w-1){put(x+4,y,'x');put(x+4,y+1,'b');}
  }
 }else{
 for(let y=3;y<h-5&&buildings.length<40;y+=8)for(let baseX=3;baseX<w-5&&buildings.length<40;baseX+=8){
  if(baseX===11&&y===11)continue;
  const x=baseX+((baseX%32===3||baseX%32===19)?(variant+y)%3-1:0);
  const index=buildings.length;
  const ref=index<services.length?services[index]:homes[(index+variant)%homes.length];
  buildings.push({ref,x,y});
  // Door is x+1,y+2. Reserve a clear short path down to the lane.
  for(let yy=y+3;yy<=y+4;yy++)put(x+1,yy,'_');
  if(buildings.length>=40)break;
 }
 }

 return {id,name:`Region city ${cw}×${ch}`,tier:dense?3:cw*ch===1?2:3,weight:0,minStartDist:0,profile:['hearthmoor','ironhold','riverwatch'][variant%3] as SettlementTemplate['profile'],garrison:{townGuard:4,townArcher:2},rows:cells.map(r=>r.join('')),buildings,spriteBuildings:true,rotate:false,mirror:false};
}
