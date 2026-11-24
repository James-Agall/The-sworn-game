import type {InteriorMap} from './interiors.js';
import {interiorSolidGrid} from './interiors.js';
const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
const cache=new WeakMap<InteriorMap,{x:number;y:number;mask:number}[]>();
// Extend the existing line to working galleries without changing the saved map,
// ore faces or worker slots. Routes are cached and do not run with enemy AI.
export function caveRails(m:InteriorMap){
 const old=cache.get(m);if(old)return old;const rails=new Set((m.underground?.tracks??[]).map(p=>p.y*m.w+p.x));
 if(m.underground?.kind==='mine'&&rails.size){
  const solid=interiorSolidGrid(m),slots=new Set(m.slots.map(p=>p.y*m.w+p.x));
  const allowed=(i:number)=>i>=0&&i<solid.length&&!solid[i]&&!slots.has(i)&&Math.hypot(i%m.w-m.exit.x,Math.floor(i/m.w)-m.exit.y)>2;
  for(const target of m.underground.landmarks.filter(p=>[1,2,3,4,5].includes(p.id))){
   const start=target.y*m.w+target.x;if(!allowed(start))continue;
   const prev=new Map<number,number>(),queue=[start];prev.set(start,-1);let end=-1;
   for(let n=0;n<queue.length;n++){const i=queue[n];if(rails.has(i)){end=i;break;}const x=i%m.w,y=Math.floor(i/m.w);for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy,j=yy*m.w+xx;if(xx<0||yy<0||xx>=m.w||yy>=m.h||!allowed(j)||prev.has(j))continue;prev.set(j,i);queue.push(j);}}
   if(end>=0)for(let i=end;i>=0;i=prev.get(i)??-1)rails.add(i);
  }
 }
 const result=[...rails].map(i=>({x:i%m.w,y:Math.floor(i/m.w),mask:dirs.reduce((mask,[dx,dy],n)=>mask|(rails.has(i+dy*m.w+dx)?1<<n:0),0)}));cache.set(m,result);return result;
}
export interface RailPiece {rotation:number;half?:boolean;ox?:number;oy?:number;curve?:boolean}
// The canonical curve joins N to E; clipped straight halves make T junctions.
export function caveRailPieces(mask:number):RailPiece[]{
 const corners:Record<number,number>={3:0,6:1,12:2,9:3};if(mask in corners)return[{curve:true,rotation:corners[mask]}];
 if(mask===5)return[{rotation:0}];if(mask===10)return[{rotation:1}];
 const out:RailPiece[]=[];
 if((mask&5)===5)out.push({rotation:0});else if(mask&1)out.push({rotation:0,half:true,oy:-.25});else if(mask&4)out.push({rotation:2,half:true,oy:.25});
 if((mask&10)===10)out.push({rotation:1});else if(mask&2)out.push({rotation:1,half:true,ox:.25});else if(mask&8)out.push({rotation:3,half:true,ox:-.25});
 return out;
}
