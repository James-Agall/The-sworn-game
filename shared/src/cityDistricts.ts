import type { Region, RegionCity, RegionPlan } from './regions.js';
import type { SettlementTemplate } from './settlementTemplates.js';

// Allocate the scarce large cities before filling remaining slots with single-region towns.
export function limitCitySizes(plan:RegionPlan,seed:number,width:number,height:number):RegionPlan {
 const regions:Region[]=plan.regions.map(r=>({...r,kind:r.kind==='city'?'countryside' as const:r.kind,city:undefined}));
 const cities:RegionCity[]=[];
 let salt=seed>>>0;
 const random=()=>{salt=(Math.imul(salt,1664525)+1013904223)>>>0;return salt/4294967296;};
 const candidates=regions.filter(r=>r.x>0&&r.y>0&&r.x<plan.columns-1&&r.y<plan.rows-1).map(r=>({r,order:random()})).sort((a,b)=>a.order-b.order).map(v=>v.r);
 const mx=Math.floor(width/64),my=Math.floor(height/64);
 const place=(w:number,h:number,fort=false)=>{
  for(const r of candidates){
   if(r.x+w>=plan.columns||r.y+h>=plan.rows)continue;
   const dx=Math.max(r.x*32-width/2,width/2-(r.x+w)*32,0);
   const dy=Math.max(r.y*32-height/2,height/2-(r.y+h)*32,0);
   if(Math.hypot(dx,dy)<20)continue;
   let free=true;
   for(let y=r.y-1;y<=r.y+h;y++)for(let x=r.x-1;x<=r.x+w;x++)if(regions[y*plan.columns+x]?.city!==undefined)free=false;
   if(!free)continue;
   const id=cities.length;cities.push({x:r.x,y:r.y,w,h,variant:r.variant,fort});
   for(let y=r.y;y<r.y+h;y++)for(let x=r.x;x<r.x+w;x++){const q=regions[y*plan.columns+x];q.kind=fort?'fort':'city';q.city=id;}
   return true;
  }
  return false;
 };
 place(2,2);
 const longCities=1+Math.floor(random()*3);
 for(let i=0;i<longCities;i++)place(1,2);
 const target=Math.max(1,Math.floor(regions.length/14));
 while(cities.length<target&&place(1,1)){}
 for(const r of regions)if(r.kind==='fort'&&r.city===undefined)r.kind='forest';
 return {...plan,regions,cities};
}

// Rounded, stepped defensive walls enclose the residential core. Farming and heavy industry
// occupy the same settlement's outskirts, keeping all plots within its reserved region footprint.
export function districtCityTemplate(id:string):SettlementTemplate|undefined {
 const match=/^region-city-(1|2)-(1|2)-([0-5])-district$/.exec(id);if(!match)return;
 const cw=Number(match[1]),ch=Number(match[2]),variant=Number(match[3]);
 const w=cw*32-2,h=ch*32-2;
 const grid=Array.from({length:h},()=>Array<string>(w).fill('.'));
 const buildings:SettlementTemplate['buildings']=[];
 const put=(x:number,y:number,c:string)=>{if(x>=0&&y>=0&&x<w&&y<h)grid[y][x]=c;};
 const left=2,right=w-3,top=7,bottom=h-6,radius=3+variant%3;
 const inside=(x:number,y:number)=>{
  if(x<left||x>right||y<top||y>bottom)return false;
  const cx=Math.max(left+radius,Math.min(right-radius,x));
  const cy=Math.max(top+radius,Math.min(bottom-radius,y));
  return (x-cx)**2+(y-cy)**2<=radius**2;
 };
 const wallCells=new Set<number>();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(inside(x,y)&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>!inside(x+dx,y+dy)))wallCells.add(y*w+x);
 // Join diagonal stair steps on the exterior side so wall sprites form continuous runs.
 for(const i of [...wallCells]){
  const x=i%w,y=Math.floor(i/w);
  for(const dy of [-1,1])if(wallCells.has((y+dy)*w+x+1)&&!wallCells.has(y*w+x+1)&&!wallCells.has((y+dy)*w+x)){
   if(!inside(x+1,y))wallCells.add(y*w+x+1);else wallCells.add((y+dy)*w+x);
  }
 }
 const wall=(x:number,y:number)=>wallCells.has(y*w+x);

 const axesX=Array.from({length:cw},(_,i)=>15+32*i);
 const axesY=Array.from({length:ch},(_,i)=>15+32*i);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(wall(x,y))put(x,y,variant===1||variant===4?'#':'%');
  if(axesX.includes(x)||axesY.includes(y))put(x,y,wall(x,y)?'G':'=');
 }
 // Lanes join the main streets. The civic square is reserved from house placement.
 for(let y=top+5;y<bottom;y+=4)for(let x=left+1;x<right;x++)if(!wall(x,y)&&inside(x,y))put(x,y,'_');
 put(14,14,'K');
 const occupied=new Set<number>();
 for(let y=9;y<=17;y++)for(let x=12;x<=18;x++)occupied.add(y*w+x);
 const canBuild=(x:number,y:number)=>{
  for(let yy=y;yy<y+3;yy++)for(let xx=x;xx<x+3;xx++)if((grid[yy]?.[xx]!=='.'&&!(yy===y+2&&['_','='].includes(grid[yy]?.[xx])))||occupied.has(yy*w+xx)||wall(xx,yy))return false;
  return true;
 };
 const add=(ref:string,x:number,y:number)=>{
  if(buildings.length>=128)return false;
  if(!canBuild(x,y))return false;
  buildings.push({ref,x,y});
  for(let yy=y;yy<y+3;yy++)for(let xx=x;xx<x+3;xx++)occupied.add(yy*w+xx);
  return true;
 };
 // Heavy industries are a single group south of the wall, with a shared access lane.
 for(let x=1;x<w-1;x++)put(x,h-1,'_');
 for(let x=3;x<w-2;x+=4)put(x,h-2,'_');
 add('blacksmith-small',2,h-4);
 put(7,h-3,'i');put(10,h-3,'j');put(11,h-3,'M');
 put(7,h-2,'_');put(10,h-2,'_');
 put(13,h-3,'d');put(13,h-2,'_');
 add('tailor-small',18,h-4);add('barn-small',24,h-4);
 // Crop fields, animal paddocks and orchards form the northern rural belt.
 put(3,3,'P');put(8,3,'O');put(11,3,'O');
 for(let y=1;y<=4;y++)for(let x=19;x<=Math.min(w-3,26);x++)if(x!==15)put(x,y,'f');
 for(let x=1;x<w-1;x++)put(x,5,'_');
 put(3,2,'p');put(4,2,'p');put(5,2,'p');put(5,3,'p');put(5,4,'p');
 put(7,2,'a');put(12,2,'a');put(6,4,'b');put(17,3,'l');
 const services=['market-hall','bakery-small','tavern-small','church-chapel','brewery-small'];
 const homes=['house-cottage','house-townhouse','house-hut','house-two-room','longhouse'];
 let service=0,house=0;
 const plots:{x:number;y:number}[]=[];
 for(let y=top+2;y+3<=bottom;y+=4)for(let x=left+2;x+3<=right;x+=4)if(inside(x,y)&&inside(x+2,y+2)&&canBuild(x,y))plots.push({x,y});
 plots.sort((a,b)=>Math.hypot(a.x-14,a.y-14)-Math.hypot(b.x-14,b.y-14));
 const residential:typeof plots=[];
 for(const plot of plots){
  if(service<services.length&&add(services[service],plot.x,plot.y))service++;
  else residential.push(plot);
 }
 residential.sort((a,b)=>((a.x*37+a.y*19+variant*13)%101)-((b.x*37+b.y*19+variant*13)%101));
 for(const plot of residential)if(add(homes[(house+variant)%homes.length],plot.x,plot.y))house++;

 // Where space permits, service-side cottages fill vacant outskirts plots.
 for(let x=30;x+3<w-1;x+=4)add(homes[(x+variant)%homes.length],x,h-4);
 for(const [x,y,c]of [[16,13,'t'],[17,13,'q'],[18,13,'r'],[13,16,'g'],[17,17,'g'],[18,17,'v'],[16,10,'o'],[17,10,'l'],[18,10,'x']] as const)put(x,y,c);
 // Gardens and storage sit in spare pockets; main paths and entrances remain clear.
 for(let y=top+2;y<bottom-1;y+=4)for(let x=left+1;x<right;x+=8){
  if(grid[y][x]==='.'&&!occupied.has(y*w+x)&&!wall(x,y))put(x,y,(x+y+variant)%2?'a':'l');
 }
 return {id,name:`District city ${cw}×${ch}`,tier:3,weight:0,minStartDist:0,profile:['hearthmoor','ironhold','riverwatch'][variant%3] as SettlementTemplate['profile'],garrison:{townGuard:4,townArcher:2},rows:grid.map(row=>row.join('')),buildings,spriteBuildings:true,rotate:false,mirror:false};
}
