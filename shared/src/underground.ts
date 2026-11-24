import {interiorSolidGrid,type InteriorMap,type InteriorProp} from './interiors.js';
export type UndergroundKind='mine'|'cave';
export interface UndergroundOptions{seed:number;kind:UndergroundKind;depth:number;levels?:number;layered?:boolean}
// These 11x11 section masks are shuffled, rotated and connected through their central sockets.
export const UNDERGROUND_SECTIONS={
 chamber:['   .....   ','  .......  ',' ......... ','...........','...........','...........','...........','...........',' ......... ','  .......  ','   .....   '],
 gallery:['           ','           ','  .......  ',' ..........','...........','...........','...........','.......... ','  .......  ','           ','           '],
 fork:['   .....   ','   .....   ','   .....   ',' ........  ','.......... ','...........','...........',' ..........','   .....   ','   .....   ','   .....   '],
 pocket:['           ','  .....    ',' .......   ','.........  ','.......... ','...........','.......... ',' ......... ','  .......  ','   .....   ','           '],
 pillars:['  .......  ',' ......... ','...........','...  ......','...  ......','...........','......  ...','......  ...','...........',' ......... ','  .......  '],
 workings:['           ',' ......... ',' ......... ','...........','...........','...........','...........','...........',' ......... ',' ......... ','           '],
 split:['  .......  ',' ......... ','.......... ','...........','.....  ....','.....  ....','...........',' ..........','  .........','    .......','     ..... '],
} as const;
export type UndergroundShape=keyof typeof UNDERGROUND_SECTIONS;
const cache=new Map<string,{map:InteriorMap;solid:Uint8Array}>();
export function undergroundSeed(salt:number,x:number,y:number){let n=(Math.imul(x+31,73856093)^Math.imul(y+79,19349663)^salt)>>>0;n=Math.imul(n^(n>>>16),0x45d9f3b);return(n^(n>>>16))>>>0;}
export function buildUnderground(o:UndergroundOptions){
 const depth=Math.max(1,Math.min(3,o.depth)),levels=Math.max(depth,Math.min(3,o.levels??depth)),key=`1:${o.kind}:${o.seed>>>0}:${depth}:${levels}:${!!o.layered}`;const hit=cache.get(key);if(hit)return hit;
 let salt=(o.seed^Math.imul(depth,0x9e3779b9))>>>0;const rnd=()=>{salt=(Math.imul(salt,1664525)+1013904223)>>>0;return salt/4294967296;};
 const shuffle=<T>(a:T[])=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 const w=49,h=49,cells=Array<string>(w*h).fill(' '),reserved=new Set<number>(),floor=(x:number,y:number,protect=false)=>{if(x<1||y<1||x>w-2||y>h-2)return;cells[y*w+x]='.';if(protect)reserved.add(y*w+x);};
 const centre=(id:number)=>({x:9+id%3*15,y:9+Math.floor(id/3)*15});
 const adjacent=(id:number)=>[id%3>0?id-1:-1,id%3<2?id+1:-1,id>=3?id-3:-1,id<6?id+3:-1].filter(n=>n>=0);
 const selected=new Set<number>([7]),edges:[number,number][]=[];
 const count=o.kind==='cave'?6+Math.floor(rnd()*3):Math.min(9,5+depth);
 while(selected.size<count){const options=[...selected].flatMap(a=>adjacent(a).filter(b=>!selected.has(b)).map(b=>[a,b] as [number,number]));const edge=options[Math.floor(rnd()*options.length)];edges.push(edge);selected.add(edge[1]);}
 const extras=shuffle([...selected].flatMap(a=>adjacent(a).filter(b=>b>a&&selected.has(b)&&!edges.some(([x,y])=>x===a&&y===b||y===a&&x===b)).map(b=>[a,b] as [number,number])));
 edges.push(...extras.slice(0,Math.min(extras.length,1+depth%2)));
 const shapes=shuffle(Object.keys(UNDERGROUND_SECTIONS) as UndergroundShape[]),sections:{id:number;shape:UndergroundShape;role:string;x:number;y:number;rotation:number}[]=[];
 for(const [n,id]of shuffle([...selected]).entries()){
  const c=centre(id),shape=id===7?'chamber':shapes[n%shapes.length],rotation=Math.floor(rnd()*4),mask=UNDERGROUND_SECTIONS[shape];
  for(let y=0;y<11;y++)for(let x=0;x<11;x++)if(mask[y][x]==='.'){
   let xx=x-5,yy=y-5;for(let k=0;k<rotation;k++)[xx,yy]=[-yy,xx];floor(c.x+xx,c.y+yy);
  }
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)floor(c.x+dx,c.y+dy,true);
  sections.push({id,shape,role:id===7?'entrance':o.kind==='mine'?(n%3===0?'stores':'ore chamber'):(n%3===0?'cache':'nest'),...c,rotation});
 }
 const line=(a:{x:number;y:number},b:{x:number;y:number})=>{
  const dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y),length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);
  for(let n=0;n<=length;n++){const x=a.x+dx*n,y=a.y+dy*n;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)floor(x+i,y+j,true);}
 };
 for(const [a,b]of edges){const p=centre(a),q=centre(b),jog=Math.floor(rnd()*5)-2;
  const points=p.y===q.y?[p,{x:Math.round((p.x+q.x)/2),y:p.y},{x:Math.round((p.x+q.x)/2),y:p.y+jog},{x:q.x,y:q.y+jog},q]:[p,{x:p.x,y:Math.round((p.y+q.y)/2)},{x:p.x+jog,y:Math.round((p.y+q.y)/2)},{x:q.x+jog,y:q.y},q];
  for(let n=1;n<points.length;n++)line(points[n-1],points[n]);
 }
 const exit={x:24,y:47},spawn={x:24,y:45};line(centre(7),{x:24,y:47});cells[exit.y*w+exit.x]='E';
 // Keep only the exposed rock boundary. Everything beyond is unrendered solid darkness.
 const open=cells.slice();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(open[y*w+x]===' '&&[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]].some(([dx,dy])=>open[(y+dy)*w+x+dx]==='.'||open[(y+dy)*w+x+dx]==='E'))cells[y*w+x]='#';
 const lairs=sections.filter(s=>s.id!==7).map(s=>({x:s.x,y:s.y}));
 const map:InteriorMap={templateId:'mine',label:o.kind==='cave'?'Cavern':'Mine',level:o.kind==='cave'?1:levels,variant:depth-1,storey:0,w,h,floor:'stone',wall:'stone',cells:cells.join(''),props:[],slots:[],exit,spawn,stairs:null,lairs,underground:{version:1,kind:o.kind,seed:o.seed>>>0,depth,...(o.kind==='mine'&&!o.layered?{rockOnly:true}:{}),sections,connections:edges}};
 const reached=()=>{const solid=interiorSolidGrid(map),start=spawn.y*w+spawn.x,seen=new Set([start]),queue=[start];for(let k=0;k<queue.length;k++){const i=queue[k],x=i%w,y=Math.floor(i/w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||solid[j]||seen.has(j))continue;seen.add(j);queue.push(j);}}return{solid,seen};};
 const place=(prop:InteriorProp,x:number,y:number,force=false)=>{
  const i=y*w+x;if(cells[i]!=='.'||map.props.some(p=>p.x===x&&p.y===y)||!force&&reserved.has(i))return false;
  const p={prop,x,y,facing:'s' as const};map.props.push(p);const {solid,seen}=reached();
  const approach=(p:{x:number;y:number})=>seen.has(p.y*w+p.x)||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has((p.y+dy)*w+p.x+dx));
  if(solid.some((v,i)=>!v&&!seen.has(i))||!map.props.every(approach)||!map.slots.every(approach)){map.props.pop();return false;}return true;
 };
 if(o.kind==='mine'&&o.layered)reserved.add(centre(7).y*w+centre(7).x+2);
 for(const s of sections){
  const spots=shuffle(Array.from({length:81},(_,i)=>({x:s.x-4+i%9,y:s.y-4+Math.floor(i/9)}))).filter(p=>cells[p.y*w+p.x]==='.'&&!reserved.has(p.y*w+p.x));
  const add=(p:InteriorProp)=>{for(const c of spots)if(place(p,c.x,c.y))return c;return undefined;};
  if(o.kind==='mine'){
   if(s.id!==7){const ore=add('oreFace');if(ore){const {seen}=reached();const near=[[0,1],[1,0],[-1,0],[0,-1]].map(([dx,dy])=>({x:ore.x+dx,y:ore.y+dy})).find(p=>seen.has(p.y*w+p.x));if(near&&map.slots.length<5){map.slots.push({...near,slot:map.slots.length?'v':'1'});reserved.add(near.y*w+near.x);}}}
   add('timberProp');if(s.role==='stores'){add('crates');add('barrel');}else add('mineralNode');
   if(s.id===7&&o.layered&&depth<levels){const c={x:s.x+2,y:s.y};place('mineShaft',c.x,c.y,true);reserved.add(c.y*w+c.x);}
  }else{add(s.role==='cache'?'chest':'stalagmite');if(s.id!==7){add('cobweb');add('skullBones');}}
  add('lamp');if(s.id!==7){add('rockBlock');add(o.kind==='cave'?'fallenSkeleton':'mineralNode');}
 }
 const result={map,solid:interiorSolidGrid(map)};cache.set(key,result);if(cache.size>256)cache.delete(cache.keys().next().value!);return result;
}
