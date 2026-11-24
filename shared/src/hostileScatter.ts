import {interiorSolidGrid,interiorLayoutAccessible,type InteriorMap} from './interiors.js';
import type {MobKind} from './protocol.js';
export const HOSTILE_CONTENT_VERSION=1;
export const HOSTILE_POPULATION=12;
export function interiorMonsterScale(kind:MobKind){return kind==='skeleton'?25/(8.5*3.5):kind==='caveSpider'?.7:kind==='giantSpider'?1.2:1;}
type Group={id:string;x:number;y:number;w:number;h:number};
const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
// Executed once when the cached interior is constructed. These are native
// colliding props and native monster lairs, not ambient overworld actors.
export function scatterHostileInterior(m:InteriorMap,kind:'cave'|'ruin',seed:number){
 const hash=(x:number,y:number)=>((Math.imul(x+31,73856093)^Math.imul(y+79,19349663)^seed)>>>0)/4294967296;
 const groups:Group[]=m.ruin?['north-west','north-east','main-court','west','east','garden'].map(id=>m.ruin!.areas.find(a=>a.id===id)!).filter(Boolean):m.underground?[1,2,9,3,4,5,6,7,8].map(id=>m.underground!.landmarks.find(a=>a.id===id)!).filter(Boolean).map(p=>({id:String(p.id),x:p.x-5,y:p.y-5,w:11,h:11})):[{id:'west',x:2,y:2,w:Math.floor(m.w/2)-2,h:m.h-6},{id:'east',x:Math.floor(m.w/2),y:2,w:Math.floor(m.w/2)-2,h:m.h-6}];
 const points=(g:Group)=>Array.from({length:g.w*g.h},(_,n)=>({x:g.x+n%g.w,y:g.y+Math.floor(n/g.w)})).filter(p=>p.x>1&&p.y>1&&p.x<m.w-2&&p.y<m.h-2&&m.cells[p.y*m.w+p.x]==='.');
 const nearDoor=(x:number,y:number,r:number)=>(m.ruin?.doors??[]).some(d=>Math.hypot(x-(d.x+(d.axis==='y'?(d.width-1)/2:0)),y-(d.y+(d.axis==='x'?(d.width-1)/2:0)))<r);
 const entranceClear=(x:number,y:number,r:number)=>Math.hypot(x-m.spawn.x,y-m.spawn.y)>=r&&Math.hypot(x-m.exit.x,y-m.exit.y)>=r;
 const budget=kind==='cave'?14:10;let placed=0;
 const choices=groups.map(g=>points(g).sort((a,b)=>{
  const score=(p:{x:number;y:number})=>(dirs.some(([dx,dy])=>m.cells[(p.y+dy)*m.w+p.x+dx]==='#')?0:3)+hash(p.x,p.y);
  return score(a)-score(b);
 }));
 for(let round=0;round<3&&placed<budget;round++)for(let gi=0;gi<groups.length&&placed<budget;gi++){
  for(const p of choices[gi]){
   const solid=interiorSolidGrid(m),i=p.y*m.w+p.x;
   if(solid[i]||!entranceClear(p.x,p.y,5)||nearDoor(p.x,p.y,3)||m.ruin?.surfaces[i]==='p'||m.props.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<2)||m.slots.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<2)||m.lairs?.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<3)||dirs.filter(([dx,dy])=>!solid[(p.y+dy)*m.w+p.x+dx]).length<3)continue;
   m.props.push({prop:'crates',x:p.x,y:p.y,facing:'s'});if(!interiorLayoutAccessible(m)){m.props.pop();continue;}placed++;break;
  }
 }
 const solid=interiorSolidGrid(m),spawns:{x:number;y:number}[]=[];
 const safe=(p:{x:number;y:number})=>!solid[p.y*m.w+p.x]&&entranceClear(p.x,p.y,8)&&!nearDoor(p.x,p.y,2.5)&&dirs.every(([dx,dy])=>!solid[(p.y+dy)*m.w+p.x+dx])&&!m.props.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<1.2)&&!spawns.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<3);
 const candidates=groups.map(g=>points(g).sort((a,b)=>{const score=(p:{x:number;y:number})=>Math.hypot(p.x-(g.x+(g.w-1)/2),p.y-(g.y+(g.h-1)/2))+hash(p.x+7,p.y+13)*2;return score(a)-score(b);}));
 for(let round=0;round<3&&spawns.length<HOSTILE_POPULATION;round++)for(const list of candidates){const p=list.find(safe);if(p)spawns.push(p);if(spawns.length===HOSTILE_POPULATION)break;}
 if(spawns.length<HOSTILE_POPULATION){const all=points({id:'fallback',x:2,y:2,w:m.w-4,h:m.h-4}).sort((a,b)=>hash(a.x,a.y)-hash(b.x,b.y));for(const p of all)if(safe(p)){spawns.push(p);if(spawns.length===HOSTILE_POPULATION)break;}}
 m.lairs=spawns;
}
