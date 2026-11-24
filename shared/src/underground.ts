import {interiorSolidGrid,type InteriorMap,type InteriorProp} from './interiors.js';
export type UndergroundKind='mine'|'cave';
export interface UndergroundOptions{seed:number;kind:UndergroundKind;depth:number;levels?:number;layered?:boolean}
type Point={x:number;y:number};
// One authored cavern, with broad galleries wrapping continuous rock islands.
// Seeds only dress the cave; no rooms, sockets, rotations or shuffled sections.
const outline=[[3,12],[4,6],[11,3],[16,5],[22,4],[27,7],[32,3],[37,4],[38,8],[45,7],[48,3],[55,4],[56,9],[61,10],[62,16],[59,19],[62,23],[61,28],[57,30],[60,34],[62,41],[57,45],[49,43],[44,46],[38,44],[35,46],[28,45],[23,47],[17,45],[14,42],[8,43],[4,39],[6,34],[3,31],[4,25],[7,22],[4,18]];
const islands=[[[12,11],[19,10],[24,13],[30,12],[33,15],[40,12],[44,12],[48,14],[55,13],[55,18],[51,20],[45,19],[41,22],[34,19],[28,22],[22,20],[18,23],[13,20],[15,16]],[[10,28],[16,26],[22,28],[27,25],[33,24],[38,27],[43,24],[48,27],[52,28],[55,32],[53,36],[49,38],[44,36],[39,39],[34,36],[29,39],[25,36],[20,37],[15,34],[11,35],[9,32]],[[50,8],[52,7],[54,9],[53,10]],[[7,36],[9,35],[10,37],[9,39],[7,38]]];
const cache=new Map<string,{map:InteriorMap;solid:Uint8Array}>();
export function undergroundSeed(salt:number,x:number,y:number){let n=(Math.imul(x+31,73856093)^Math.imul(y+79,19349663)^salt)>>>0;n=Math.imul(n^(n>>>16),0x45d9f3b);return(n^(n>>>16))>>>0;}
const inside=(x:number,y:number,poly:number[][])=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
export function buildUnderground(o:UndergroundOptions){
 const depth=Math.max(1,Math.min(3,o.depth)),levels=Math.max(depth,Math.min(3,o.levels??depth)),key=`2:${o.kind}:${o.seed>>>0}:${depth}:${levels}:${!!o.layered}`;const hit=cache.get(key);if(hit)return hit;
 let salt=(o.seed^Math.imul(depth,0x9e3779b9))>>>0;const rnd=()=>{salt=(Math.imul(salt,1664525)+1013904223)>>>0;return salt/4294967296;};
 const shuffle=<T>(a:T[])=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 const w=65,h=49,cells=Array<string>(w*h).fill(' '),reserved=new Set<number>();
 // Depths use the same geological outline, with deliberately opened rock galleries.
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(inside(x+.5,y+.5,outline)&&!islands.some(p=>inside(x+.5,y+.5,p)))cells[y*w+x]='.';
 const carve=(x:number,y:number)=>{if(x>0&&y>0&&x<w-1&&y<h-1)cells[y*w+x]='.';};
 if(depth>=2)for(let y=18;y<=29;y++)for(let x=25;x<=28;x++)carve(x,y);
 if(depth>=3)for(let y=28;y<=40;y++)for(let x=44;x<=47;x++)carve(x,y);
 const spawn={x:8,y:8},exit={x:5,y:6};for(let y=6;y<=9;y++)for(let x=5;x<=9;x++)carve(x,y);cells[exit.y*w+exit.x]='E';
 const nearest=(px:number,py:number)=>{let best={...spawn},distance=Infinity;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(cells[y*w+x]==='.'){const d=Math.hypot(x-px,y-py);if(d<distance){distance=d;best={x,y};}}return best;};
 const flood=(solid:Uint8Array)=>{const seen=new Set<number>([spawn.y*w+spawn.x]),q=[spawn.y*w+spawn.x];for(let n=0;n<q.length;n++){const i=q[n],x=i%w,y=Math.floor(i/w);for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||solid[j]||seen.has(j))continue;seen.add(j);q.push(j);}}return seen;};
 const reachable=flood(Uint8Array.from(cells,c=>c==='.'||c==='E'?0:1));for(let i=0;i<cells.length;i++)if(cells[i]==='.'&&!reachable.has(i))cells[i]=' ';
 const landmarks=[[8,8,'entrance'],[20,7,'upper gallery'],[33,7,'mineral vault'],[52,6,'high chamber'],[57,24,'east hollow'],[33,22,'central passage'],[7,25,'west passage'],[12,39,'lower gallery'],[27,41,'bone hollow'],[52,41,'deep vault']].map(([x,y,role],id)=>({id,role:String(role),...nearest(Number(x),Number(y))}));
 for(const c of [...landmarks,spawn,exit])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)reserved.add((c.y+dy)*w+c.x+dx);
 // Rails follow a continuous navigable route. Edge clearance keeps them off cliff lips.
 const route=(a:Point,b:Point)=>{const start=a.y*w+a.x,end=b.y*w+b.x,dist=new Map([[start,0]]),prev=new Map<number,number>(),todo=new Set([start]);while(todo.size){let cur=-1,best=Infinity;for(const i of todo){const d=dist.get(i)!;if(d<best){cur=i;best=d;}}todo.delete(cur);if(cur===end)break;const x=cur%w,y=Math.floor(cur/w);for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx<1||yy<1||xx>=w-1||yy>=h-1||!reachable.has(j))continue;const edge=dirs.some(([sx,sy])=>!reachable.has((yy+sy)*w+xx+sx)),cost=best+1+(edge?4:0);if(cost<(dist.get(j)??Infinity)){dist.set(j,cost);prev.set(j,cur);todo.add(j);}}}const path:Point[]=[];if(!dist.has(end))return path;for(let cur=end;;cur=prev.get(cur)!){path.push({x:cur%w,y:Math.floor(cur/w)});if(cur===start)break;}return path.reverse();};
 const trackCells=new Set<number>();const stops=o.kind==='mine'?[landmarks[0],landmarks[6],landmarks[7],landmarks[8],landmarks[9]]:[landmarks[0],nearest(8,16)];
 for(let n=1;n<stops.length;n++)for(const p of route(stops[n-1],stops[n])){trackCells.add(p.y*w+p.x);reserved.add(p.y*w+p.x);}
 const tracks=[...trackCells].map(i=>({x:i%w,y:Math.floor(i/w),mask:dirs.reduce((m,[dx,dy],n)=>m|(trackCells.has(i+dy*w+dx)?1<<n:0),0)}));
 const open=cells.slice();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(open[y*w+x]===' '&&[...dirs,[1,1],[-1,1],[1,-1],[-1,-1]].some(([dx,dy])=>'.E'.includes(open[(y+dy)*w+x+dx])))cells[y*w+x]='#';
 const lairs=landmarks.filter(s=>s.id>1).map(s=>({x:s.x,y:s.y}));
 const map:InteriorMap={templateId:'mine',label:o.kind==='cave'?'Cavern':'Mine',level:o.kind==='cave'?1:levels,variant:depth-1,storey:0,w,h,floor:'stone',wall:'stone',cells:cells.join(''),props:[],slots:[],exit,spawn,stairs:null,lairs,underground:{version:2,kind:o.kind,seed:o.seed>>>0,depth,...(o.kind==='mine'&&!o.layered?{rockOnly:true}:{}),landmarks,tracks}};
 const reached=()=>{const solid=interiorSolidGrid(map);return{solid,seen:flood(solid)};};
 const place=(prop:InteriorProp,x:number,y:number,force=false)=>{
  const i=y*w+x;if(cells[i]!=='.'||map.props.some(p=>p.x===x&&p.y===y)||!force&&reserved.has(i))return false;
  map.props.push({prop,x,y,facing:'s'});const {solid,seen}=reached(),approach=(p:Point)=>seen.has(p.y*w+p.x)||dirs.some(([dx,dy])=>seen.has((p.y+dy)*w+p.x+dx));
  if(solid.some((v,i)=>!v&&!seen.has(i))||!map.props.every(approach)||!map.slots.every(approach)){map.props.pop();return false;}return true;
 };
 const shaft=nearest(11,8);if(o.kind==='mine'&&o.layered)reserved.add(shaft.y*w+shaft.x);
 for(const s of landmarks){
  const spots=shuffle(Array.from({length:81},(_,i)=>({x:s.x-4+i%9,y:s.y-4+Math.floor(i/9)}))).filter(p=>p.x>0&&p.y>0&&p.x<w-1&&p.y<h-1&&cells[p.y*w+p.x]==='.'&&!reserved.has(p.y*w+p.x));
  const add=(prop:InteriorProp)=>{for(const p of spots)if(place(prop,p.x,p.y))return p;return undefined;};
  if(o.kind==='mine'){
   if(s.id>0){const ore=add('oreFace');if(ore){const {seen}=reached(),near=dirs.map(([dx,dy])=>({x:ore.x+dx,y:ore.y+dy})).find(p=>seen.has(p.y*w+p.x));if(near&&map.slots.length<5){map.slots.push({...near,slot:map.slots.length?'v':'1'});reserved.add(near.y*w+near.x);}}}
   add('timberProp');if(s.id===0||s.id===7){add('crates');add('barrel');}else add('mineralNode');
  }else{if(s.id===3||s.id===9)add('chest');else add('stalagmite');if(s.id>0){add('cobweb');add('skullBones');}}
  add('lamp');if(s.id>0){add('rockBlock');add(o.kind==='cave'?'fallenSkeleton':'mineralNode');}
 }
 if(o.kind==='mine'&&o.layered&&depth<levels)place('mineShaft',shaft.x,shaft.y,true);
 const result={map,solid:interiorSolidGrid(map)};cache.set(key,result);if(cache.size>256)cache.delete(cache.keys().next().value!);return result;
}
