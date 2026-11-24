import {farmBarnTown} from './farmBarns.js';
import {compactTown} from './compactTowns.js';
import type { SettlementTemplate, SettlementProfile } from './settlementTemplates.js';
export const TOWN_STYLES = ['hearthmoor','ironhold','riverwatch'] as const;
export const TOWN_LAYOUTS = ['Market green','Bending high street','Church close','Forked lanes','Burgage rows','Courtyard clusters','Crescent ward','Twin greens','Gate market','Winding commons'] as const;
export const TOWN_HOUSE_URLS = TOWN_STYLES.flatMap(s=>Array.from({length:4},(_,i)=>`/sprites/towns-v2/${s}-${i}.png`));
export const TOWN_ROAD_URLS = ['earth','cobble','gravel','setts'].map(s=>`/sprites/towns-v2/road-${s}.png`);
export const TOWN_HOME_BASES=[['cottage','farmhouse','cottage','longhouse'],['cottage','townhouse','farmhouse','manor'],['townhouse','townhouse','cottage','manor']] as const;
const templates=new Map<string,SettlementTemplate>();
export function organicTownTemplate(id:string):SettlementTemplate|undefined {
 const cached=templates.get(id);if(cached)return cached;
 if(id.endsWith('-organic5')){const base=organicTownTemplate(id.replace(/organic5$/,'organic4'));if(!base)return;const result=farmBarnTown(id,base);templates.set(id,result);return result;}
 if(id.endsWith('-organic4')){const base=organicTownTemplate(id.replace(/organic4$/,'organic3'));if(!base)return;const result=compactTown(id,base);templates.set(id,result);return result;}
 if(id.endsWith('-organic3')){const base=organicTownTemplate(id.replace(/organic3$/,'organic2'));if(!base)return;const result=livingTown({...base,id});templates.set(id,result);return result;}
 const m=/^region-city-(1|2)-(1|2)-(\d{1,2})-(organic2?)$/.exec(id);if(!m||+m[3]>=30)return;
 const revised=m[4]==='organic2';
 const cw=+m[1],ch=+m[2],v=+m[3],style=Math.floor(v/10),layout=v%10;
 const w=cw*32-2,h=ch*32-2,top=6,bottom=h-(revised?4:5);
 const grid=Array.from({length:h},()=>Array<string>(w).fill('.'));
 const buildings:SettlementTemplate['buildings']=[],blocked=new Uint8Array(w*h),occupied=new Uint8Array(w*h);
 const at=(x:number,y:number)=>grid[y]?.[x];
 const put=(x:number,y:number,c:string)=>{if(x>=0&&y>=0&&x<w&&y<h)grid[y][x]=c;};
 const hash=(x:number,y:number)=>{let n=Math.imul(x+91,374761393)^Math.imul(y+37,668265263)^Math.imul(v+1,1274126177);n=Math.imul(n^(n>>>13),1274126177);return (n^(n>>>16))>>>0;};
 // Row-wise rounded bounds with unequal bulges: one closed cardinal wall chain, never diagonal gaps.
 const bounds=Array.from({length:h},(_,y)=>{
  const d=Math.min(y-top,bottom-y),r=4+layout%3;
  const corner=d<r?Math.ceil(r-Math.sqrt(Math.max(0,r*r-(r-d)*(r-d)))):0;
  const wave=Math.round((1+layout%2)*Math.sin((y-top)/(bottom-top)*Math.PI*2+v*.7));
  return [Math.max(1,2+corner+wave),Math.min(w-2,w-3-corner+Math.round(Math.sin(y*.18+v)*1.5))];
 });
 const wallChar=style===0?'#':'%';
 for(let y=top;y<=bottom;y++){
  const [l,r]=bounds[y];put(l,y,wallChar);put(r,y,wallChar);
  if(y===top||y===bottom)for(let x=l;x<=r;x++)put(x,y,wallChar);
  if(y>top)for(const side of [0,1]){const x=bounds[y-1][side],xx=bounds[y][side];for(let k=Math.min(x,xx);k<=Math.max(x,xx);k++)put(k,y,wallChar);}
 }
 const inside=(x:number,y:number)=>y>top&&y<bottom&&x>bounds[y][0]&&x<bounds[y][1]&&at(x,y)!==wallChar;
 // Reserve room for the existing enlarged keep and its front approach.
 for(let y=10;y<=16;y++)for(let x=12;x<=16;x++){blocked[y*w+x]=y<15?1:0;occupied[y*w+x]=1;}
 const road=(x:number,y:number,paved=false)=>{
  if(x<0||x>=w||y<0||y>=h)return;
  const c=at(x,y);if(c==='G')return;if(c===wallChar)put(x,y,'G');else if(!blocked[y*w+x]||y===15&&x===14)put(x,y,paved?'=':'_');
 };
 const line=(a:[number,number],b:[number,number],paved=false)=>{
  let [x,y]=a;road(x,y,paved);
  while(x!==b[0]||y!==b[1]){if(x!==b[0]&&(y===b[1]||Math.abs(b[0]-x)>=Math.abs(b[1]-y)))x+=Math.sign(b[0]-x);else y+=Math.sign(b[1]-y);road(x,y,paved);}
 };
 const poly=(points:[number,number][],paved=false)=>{for(let i=1;i<points.length;i++)line(points[i-1],points[i],paved);};
 const bend=layout%5-2,market:[number,number]=[15+bend,19];
 // Fixed outer sockets preserve inter-chunk joins; the lanes bend after crossing each gate.
 for(let k=0;k<cw;k++){
  const x=15+k*32;
  poly([[x,0],[x,6],[x+3+bend,9],[x+6+bend,18],[...market]],style!==0);
  poly([[x,h-1],[x,h-5],[x+bend,bottom-2],[...market]],style!==0);
 }
 for(let k=0;k<ch;k++){
  const y=15+k*32;
  poly([[0,y],[7,y],[9+bend,y+3],[...market]],style===1);
  poly([[w-1,y],[w-8,y],[w-10,y+3+bend],[...market]],style===1);
 }
 // A horseshoe approach connects the keep without crossing its footprint.
 poly([[14,15],[14,17],[...market]],true);
 const civic=(x:number,y:number)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!blocked[(y+dy)*w+x+dx]&&at(x+dx,y+dy)==='.')road(x+dx,y+dy,style!==0);};
 civic(...market);
 // A reserved, fully paved 5x3 town square cannot be consumed by later infill.
 if(revised)for(let y=market[1]-1;y<=market[1]+1;y++)for(let x=market[0]-2;x<=market[0]+2;x++){
  road(x,y,true);occupied[y*w+x]=1;
 }
 // Ten street grammars: greens, crooked rows, closes, forks, yards and offset secondary centres.
 const extra:[number,number][][]=[
  [[7,11],[7,20],[22,20],[22,11],[19,11]],
  [[5,11],[8,12],[8,20],[24,21]],
  [[5,11],[9,11],[9,20],[23,20],[23,11]],
  [[5,11],[8,18],[15,20],[24,10]],
  [[6,10],[6,21],[23,21],[23,10]],
  [[5,12],[8,12],[8,21],[22,21],[22,12],[25,12]],
  [[6,11],[6,16],[9,21],[21,21],[24,16],[24,11]],
  [[5,11],[8,11],[8,21],[22,21],[22,11],[25,11]],
  [[5,12],[6,20],[24,20],[24,10]],
  [[5,11],[8,13],[7,21],[20,21],[24,17],[24,11]],
 ];
 const districtRoads=extra[layout].map(([x,y])=>[Math.min(w-5,x+(style===2?1:0)),Math.min(bottom-2,y)] as [number,number]);
 poly(districtRoads.slice(0,3));line(districtRoads[2],market);
 if(layout===0||layout===7){civic(8,19);if(layout===7)civic(23,19);}
 // Long towns grow offset quarters instead of repeating a copy of the first block.
 if(ch>1||cw>1){
  for(let yy=0;yy<ch;yy++)for(let xx=0;xx<cw;xx++){
   if(!xx&&!yy)continue;
   const cx=xx*32+13+(layout%3),cy=Math.min(bottom-3,yy*32+15+bend);
   poly([[...market],[cx,market[1]+(yy?3:0)],[cx,cy],[w-7,cy+1]]);
   civic(cx,cy);
   if(ch>1)poly([[6,22],[7+bend,34],[8,46],[cx,cy]]);
  }
 }
 // Rural belt and the dirty trades remain outside the defences, with common connecting lanes.
 for(let x=1;x<w-1;x++){road(x,5);road(x,h-1);}
 put(3,3,'P');put(8,3,'O');put(11,3,'O');
 for(let y=1;y<=3;y++)for(let x=19+(layout+y)%3;x<=Math.min(w-3,26-(layout+y)%2);x++)if(at(x,y)==='.')put(x,y,'f');
 if(cw>1)for(let x=34;x<w-4;x++)for(let y=1;y<=3;y++)if(at(x,y)==='.')put(x,y,(x+layout)%11===0?'O':'f');
 for(const [x,y]of [[2,2],[3,2],[4,2],[5,2],[5,3],[5,4]] as const)if(at(x,y)==='.')put(x,y,'p');
 for(const [x,c]of revised?[]:([[7,'i'],[10,'j'],[13,'d']] as const)){put(x,h-3,c);road(x,h-2);}
 const isRoad=(c:string|undefined)=>c==='_'||c==='='||c==='G';
 // Join any branches that skirt the keep's reserved footprint before plots occupy the ground.
 const connected=new Uint8Array(w*h);
 const flood=(root:number)=>{const q=[root];connected[root]=1;for(let k=0;k<q.length;k++){const i=q[k],x=i%w,y=Math.floor(i/w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&!connected[n]&&isRoad(at(xx,yy))){connected[n]=1;q.push(n);}}}};
 flood(market[1]*w+market[0]);
 for(let sy=0;sy<h;sy++)for(let sx=0;sx<w;sx++){
  const start=sy*w+sx;if(!isRoad(at(sx,sy))||connected[start])continue;
  const prev=new Int32Array(w*h).fill(-1),queue=[start];prev[start]=start;let end=-1;
  for(let k=0;k<queue.length&&end<0;k++){const i=queue[k],x=i%w,y=Math.floor(i/w);if(connected[i]){end=i;break;}for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||prev[n]>=0||blocked[n]||!['.','_','=','G'].includes(at(xx,yy)!))continue;prev[n]=i;queue.push(n);}}
  if(end>=0){for(let i=end;i!==start;i=prev[i])road(i%w,Math.floor(i/w));flood(start);}
 }
 // Every south-facing doorway receives an actual road path. BFS runs only during template creation.
 const connect=(sx:number,sy:number)=>{
  const start=sy*w+sx;if(isRoad(at(sx,sy)))return true;
  const previous=new Int32Array(w*h).fill(-1),queue=[start];previous[start]=start;let end=-1;
  for(let k=0;k<queue.length&&end<0;k++){
   const i=queue[k],x=i%w,y=Math.floor(i/w);
   if(i!==start&&isRoad(at(x,y))){end=i;break;}
   const dirs=hash(x,y)%2?[[0,1],[1,0],[-1,0],[0,-1]]:[[0,1],[-1,0],[1,0],[0,-1]];
   for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy,n=yy*w+xx,c=at(xx,yy);if(c===undefined||previous[n]>=0||blocked[n]||!['.','_','=','G'].includes(c))continue;previous[n]=i;queue.push(n);}
  }
  for(let i=end;i>=0&&i!==start;i=previous[i]){const x=i%w,y=Math.floor(i/w);road(x,y);}if(end>=0)road(sx,sy);return end>=0;
 };
 const canBuild=(x:number,y:number)=>{
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){
   const i=(y+dy)*w+x+dx,c=at(x+dx,y+dy);
   if(c===undefined||occupied[i]||c!=='.'&&!(dy===2&&(c==='_'||c==='=')))return false;
  }return true;
 };
 const add=(ref:string,x:number,y:number)=>{
  if(buildings.length>=128||!canBuild(x,y))return false;
  buildings.push({ref,x,y});
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){occupied[(y+dy)*w+x+dx]=1;if(dy<2)blocked[(y+dy)*w+x+dx]=1;}
  if(!connect(x+1,y+2)){
   buildings.pop();for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){occupied[(y+dy)*w+x+dx]=0;if(dy<2)blocked[(y+dy)*w+x+dx]=0;}return false;
  }
  return true;
 };
 if(!revised){add('blacksmith-small',2,h-4);add('tailor-small',18,h-4);}
 if(revised){for(let y=1;y<=3;y++)for(let x=24;x<=26;x++)put(x,y,'.');add('barn-small',24,1);}else add('barn-small',24,h-4);
 const plots:{x:number;y:number;rank:number}[]=[];
 for(let y=top+2;y<=bottom-3;y++)for(let x=3;x<w-5;x++){
  if(!inside(x,y)||!inside(x+2,y+2)||!canBuild(x,y))continue;
  const distance=Math.abs(x+1-market[0])+Math.abs(y+2-market[1]);
  // Street frontage first, then seeded offsets produce unequal plots and back yards.
  const frontage=[-1,0,1].some(dx=>isRoad(at(x+1+dx,y+2)))?0:5;
  plots.push({x,y,rank:frontage+distance*.08+(hash(x,y)%1000)/180});
 }
 plots.sort((a,b)=>a.rank-b.rank);
 // Commons and churchyards leave deliberate neighbourhood breathing space, not vacant house slots.
 const green=layout===0?[8,13,2,1]:layout===2?[22,10,2,1]:layout===6?[8,19,1,2]:layout===7?[7,11,1,1]:layout===9?[22,21,2,1]:null;
 const greenCells:number[]=[];
 if(green){const [cx,cy,rx,ry]=green;for(let y=cy-ry;y<=cy+ry;y++)for(let x=cx-rx;x<=cx+rx;x++)if(inside(x,y)&&!blocked[y*w+x]&&at(x,y)==='.'){
  occupied[y*w+x]=1;greenCells.push(y*w+x);
 }}
 if(layout===7)for(let y=20;y<=21;y++)for(let x=22;x<=24;x++)if(inside(x,y)&&at(x,y)==='.'&&!blocked[y*w+x]){occupied[y*w+x]=1;greenCells.push(y*w+x);}
 // Workshops are placed first into a shared inner-wall working quarter.
 if(revised){
  let smith:{x:number;y:number}|undefined;
  for(const ref of ['blacksmith-small','tailor-small']){
   const ordered=[...plots].sort((a,b)=>(Math.abs(a.x-5)+Math.abs(a.y-(bottom-4)))-(Math.abs(b.x-5)+Math.abs(b.y-(bottom-4))));
   for(const p of ordered)if(add(ref,p.x,p.y)){if(ref==='blacksmith-small')smith=p;break;}
  }
  for(const c of ['i','j','d']){
   const pockets:{x:number;y:number;rank:number}[]=[];
   for(let y=top+1;y<bottom;y++)for(let x=2;x<w-2;x++)if(inside(x,y)&&at(x,y)==='.'&&!occupied[y*w+x]&&!blocked[y*w+x])pockets.push({x,y,rank:Math.abs(x-(smith?.x??5))+Math.abs(y-(smith?.y??bottom-4))});
   pockets.sort((a,b)=>a.rank-b.rank);
   for(const p of pockets){const i=p.y*w+p.x;if(blocked[i+w]||!['.','_','='].includes(at(p.x,p.y+1)!))continue;blocked[i]=1;if(!connect(p.x,p.y+1)){blocked[i]=0;continue;}put(p.x,p.y,c);occupied[i]=1;break;}
  }
 }
 const services=['market-hall' ,'bakery-small','tavern-small','church-chapel','brewery-small'];
 const homes=['house-cottage','house-townhouse','house-hut','house-two-room','longhouse'];
 const servicePlaces=[[market[0]+3,market[1]-2],[w-8,top+3],[19,bottom-3],[layout===2?w-9:5,top+3],[5,bottom-3]];
 for(let k=0;k<services.length;k++){
  const [cx,cy]=servicePlaces[k];
  const candidates=[...plots].sort((a,b)=>(Math.abs(a.x-cx)+Math.abs(a.y-cy)+a.rank*.1)-(Math.abs(b.x-cx)+Math.abs(b.y-cy)+b.rank*.1));
  for(const plot of candidates)if(add(services[k],plot.x,plot.y))break;
 }
 let house=0;
 for(const p of plots)if(add(homes[(house+style+layout)%homes.length],p.x,p.y))house++;
 put(14,14,'K');
 // NPCs use vacant road-adjacent pockets and cannot replace a road articulation.
 const npc=(c:string,cx:number,cy:number)=>{
  const places=[];for(let y=top+1;y<bottom;y++)for(let x=2;x<w-2;x++)if(at(x,y)==='.'&&!occupied[y*w+x]&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>isRoad(at(x+dx,y+dy))))places.push({x,y,d:Math.abs(x-cx)+Math.abs(y-cy)});
  places.sort((a,b)=>a.d-b.d);const p=places[0];if(p)put(p.x,p.y,c);
 };
 for(const [c,x,y]of [['t',19,17],['q',19,15],['r',20,12],['g',8,15],['g',22,15],['v',22,19]] as const)npc(c,x,y);
 // A tree and bench-side lantern distinguish a common from the trading road.
 for(let k=0;k<greenCells.length;k++){
  const i=greenCells[k],x=i%w,y=Math.floor(i/w);if(at(x,y)==='.'&&(k===0||k===greenCells.length-1))put(x,y,k===0?'a':'l');
 }
 // Small planted and storage pockets vary the street edges without blocking doors or lanes.
 for(let y=top+2;y<bottom-1;y++)for(let x=3;x<w-3;x++){
  if(at(x,y)!=='.'||occupied[y*w+x]||blocked[y*w+x]||!inside(x,y)||hash(x,y)%31!==0)continue;
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>isRoad(at(x+dx,y+dy))))put(x,y,hash(x,y)%2?'b':'l');
 }
 if(revised){
  for(let y=market[1]-1;y<=market[1]+1;y++)for(let x=market[0]-2;x<=market[0]+2;x++)put(x,y,'=');
  for(let y=0;y<h;y++)for(let x=1;x<w-1;x++){
   if(at(x,y)!=='.'||occupied[y*w+x]||blocked[y*w+x]||y>=top&&y<=bottom)continue;
   // Small fields and pasture/orchard pockets along both rural approach lanes.
   if(y>=1&&y<=4||y>=h-4&&y<h-1){
    const n=hash(Math.floor(x/4),Math.floor(y/2));
    if(n%7===0&&x%4===2&&y%2===1)put(x,y,n%2?'O':'P');
    else if(n%7!==0)put(x,y,'f');
   }
  }
 }
 const template:SettlementTemplate={id,name:`${TOWN_STYLES[style]} ${TOWN_LAYOUTS[layout]}`,tier:3,weight:0,minStartDist:0,profile:TOWN_STYLES[style] as SettlementProfile,garrison:{townGuard:4,townArcher:2},rows:grid.map(r=>r.join('')),buildings,spriteBuildings:true,rotate:false,mirror:false};
 templates.set(id,template);return template;
}

// Layer civic amenities onto a versioned layout without altering existing saved templates.
function livingTown(t:SettlementTemplate):SettlementTemplate {
 const grid=t.rows.map(r=>r.split('')),w=grid[0].length,h=grid.length,v=Number(t.id.split('-')[4]),cx=15+v%10%5-2;
 const at=(x:number,y:number)=>grid[y]?.[x];
 const put=(x:number,y:number,c:string)=>{grid[y][x]=c;};
 const plots=new Set<number>();
 for(const b of t.buildings)for(let y=b.y;y<b.y+3;y++)for(let x=b.x;x<b.x+3;x++)plots.add(y*w+x);
 // One northern agricultural district: fenced livestock west, orchard rows centre, fields east.
 for(let y=0;y<6;y++)for(let x=0;x<w;x++)if(!plots.has(y*w+x)&&!['_','=','G'].includes(at(x,y)!))put(x,y,'.');
 for(let y=h-3;y<h-1;y++)for(let x=0;x<w;x++)if(['f','P','O','p'].includes(at(x,y)!))put(x,y,'.');
 for(let y=0;y<=4;y++)for(let x=1;x<=6;x++)put(x,y,x===1||x===6||y===0||y===4?'p':'u');
 put(3,2,'P');put(4,4,'F');
 for(const y of [1,3])for(let k=0;k<3+v%3;k++){const x=8+k*2;if(at(x,y)==='.')put(x,y,'A');}
 for(let y=1;y<=4;y++)for(let x=18;x<w-2;x++)if(at(x,y)==='.'&&!plots.has(y*w+x))put(x,y,'f');
 // Stalls and the board occupy the rear edge; the two front rows remain a clear crossing.
 put(cx-2,18,'$');put(cx,18,'B');put(cx+2,18,'$');
 // Bypass occupied rear-square cells so every existing approach still joins the plaza.
 const roof=new Set<number>();for(const b of t.buildings)for(let y=b.y;y<b.y+2;y++)for(let x=b.x;x<b.x+3;x++)roof.add(y*w+x);
 const roadChars=['_','=','G','F'];const linked=new Set<number>();
 const flood=(root:number)=>{const q=[root];linked.add(root);for(let k=0;k<q.length;k++){const i=q[k],x=i%w,y=Math.floor(i/w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*w+xx;if(roadChars.includes(at(xx,yy)!)&&!linked.has(n)){linked.add(n);q.push(n);}}}};
 flood(19*w+cx);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(roadChars.includes(at(x,y)!)&&!linked.has(y*w+x)){
  const start=y*w+x,prev=new Map<number,number>([[start,start]]),q=[start];let end=-1;
  for(let k=0;k<q.length;k++){const i=q[k],xx=i%w,yy=Math.floor(i/w);if(linked.has(i)){end=i;break;}for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=xx+dx,ny=yy+dy,n=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||prev.has(n)||roof.has(n)||!['.','_','=','G','F'].includes(at(nx,ny)!))continue;prev.set(n,i);q.push(n);}}
  if(end>=0){for(let i=end;i!==start;i=prev.get(i)!)if(at(i%w,Math.floor(i/w))==='.')put(i%w,Math.floor(i/w),'_');flood(start);}
 }
 let trees=grid.flat().filter(c=>c==='a').length,lights=grid.flat().filter(c=>c==='l').length;
 const inTown=(x:number,y:number)=>{const row=grid[y];let left=-1,right=-1;for(let i=0;i<row.length;i++)if('#%G'.includes(row[i])){if(left<0)left=i;right=i;}return x>left&&x<right;};
 const clear=(x:number,y:number)=>inTown(x,y)&&at(x,y)==='.'&&!plots.has(y*w+x)&&Math.hypot(x-14,y-14)>4;
 for(let y=8;y<h-6;y++)for(let x=3;x<w-3;x++){
  if(!clear(x,y))continue;
  const farHome=t.buildings.every(b=>Math.abs(x-(b.x+1))>=2.5||Math.abs(y-(b.y+1))>=2.5);
  const farTree=grid.every((row,yy)=>row.every((c,xx)=>c!=='a'||Math.hypot(xx-x,yy-y)>=3));
  if(trees<6&&farHome&&farTree){put(x,y,'a');trees++;}
 }
 for(let y=7;y<h-4;y++)for(let x=2;x<w-2;x++){
  if(!clear(x,y)||lights>=12)continue;
  if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>['_','='].includes(at(x+dx,y+dy)!))&&grid.every((row,yy)=>row.every((c,xx)=>c!=='l'||Math.hypot(xx-x,yy-y)>=3))){put(x,y,'l');lights++;}
 }
 return {...t,rows:grid.map(r=>r.join(''))};
}
