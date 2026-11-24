import type {CaveDressing} from './caveScenery.js';
import {interiorSolidGrid,type InteriorMap} from './interiors.js';
import {caveWallPieces} from './caveWalls.js';
const old='/sprites/ruins-v1/',root='/sprites/ruins-v2/';
export const RUIN_FLOOR_URL=root+'room-floor.png';
export const RUIN_WALL_ART={face:root+'wall-face.png',rim:old+'wall-rim.png',side:old+'wall-side.png',body:root+'wall-core.png'};
export const RUIN_TITLES=['Ruined sanctuary','Forgotten crypt','Fallen keep','Ruined cloister'];
export function ruinFloorUrl(m:InteriorMap,x:number,y:number){const s=m.ruin?.surfaces[y*m.w+x];return s==='g'?root+'courtyard.png':s==='p'?root+'paving.png':RUIN_FLOOR_URL;}
export function ruinPropArt(prop:string){
 const all:Record<string,{url:string;w:number;h:number}>={
  crates:{url:'/sprites/structure/extra/crates_barrels_stack.png',w:1,h:.85},barrel:{url:'/sprites/structure/extra/barrel.png',w:.55,h:.65},
  statue:{url:old+'broken-statue.png',w:1.35,h:1.9},ruinRubble:{url:old+'column-rubble.png',w:1.5,h:1},ruinColumn:{url:old+'column-rubble.png',w:1.25,h:1.65},sarcophagus:{url:old+'sarcophagus.png',w:1.2,h:.78},
  skullBones:{url:'/sprites/regions-v4/skulls.png',w:.7,h:.5},fallenSkeleton:{url:'/sprites/regions-v4/skeleton.png',w:1.2,h:.65},
  cobweb:{url:'/sprites/regions-v4/web.png',w:1.1,h:.8},overgrowth:{url:'/sprites/regions-v4/brambles.png',w:1.2,h:.9},
 };return all[prop];
}
export function ruinEntrance(m:InteriorMap){const {x,y}=m.exit;return{opening:{x:x-.2,y:y-.7,w:1.4,h:1.6},sprites:[{url:root+'door-arch.png',x:x-.9,y:y-1.8,w:2.8,h:2.8}]};}
export function ruinDoorFrames(m:InteriorMap){return(m.ruin?.doors??[]).filter(d=>d.axis==='y').map(d=>({url:root+'door-arch.png',x:d.x-.2,y:d.y-1.8,w:d.width+.4,h:2.8}));}
const wallCache=new WeakMap<InteriorMap,ReturnType<typeof caveWallPieces>>();
export function ruinWallPieces(m:InteriorMap){
 const cached=wallCache.get(m);if(cached)return cached;
 const outside=(x:number,y:number)=>m.ruin?.areas.some(a=>a.type==='courtyard'&&x>=a.x&&y>=a.y&&x<a.x+a.w&&y<a.y+a.h)??false;
 const pieces=caveWallPieces(m).map(p=>{const q={...p},x=Math.round(p.x),y=Math.round(p.kind==='face'?p.y+p.h-1:p.y),low=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>outside(x+dx,y+dy));if(q.kind==='face'){const height=low?1:Math.min(2.1,q.h===1?1:2.1);q.y=q.y+q.h-height;q.h=height;}else if(q.kind==='side'&&!low){q.y-=.3;q.h+=.3;}return q;});wallCache.set(m,pieces);return pieces;
}
export interface RuinDressing extends CaveDressing {}
const cache=new WeakMap<InteriorMap,RuinDressing[]>();
// Decoration is sparse and edge-bound. Large furnishings are real blocking
// props in the authored layout, with navigation validated by the generator.
export function ruinScenery(m:InteriorMap){
 const cached=cache.get(m);if(cached)return cached;const solid=interiorSolidGrid(m),used=new Set(m.props.map(p=>p.y*m.w+p.x)),out:RuinDressing[]=[];
 const safe=(x:number,y:number)=>x>0&&y>0&&x<m.w-1&&y<m.h-1&&!solid[y*m.w+x]&&!used.has(y*m.w+x)&&m.ruin?.surfaces[y*m.w+x]!=='p'&&Math.hypot(x-m.spawn.x,y-m.spawn.y)>3&&Math.hypot(x-m.exit.x,y-m.exit.y)>3&&!m.lairs?.some(p=>Math.hypot(p.x-x,p.y-y)<2)&&!m.props.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<=1);
 for(const a of m.ruin?.areas??[]){
  let count=0;for(const [dx,dy]of [[0,0],[a.w-1,0],[0,a.h-1],[a.w-1,a.h-1],[1,Math.floor(a.h/2)],[a.w-2,a.h-2]]){
   if(count>=3)break;const x=a.x+dx,y=a.y+dy;if(!safe(x,y))continue;const n=(count+m.variant)%3,art=a.type==='courtyard'?{url:'/sprites/regions-v4/brambles.png',w:1.1,h:.8}:n===0?{url:'/sprites/regions-v4/web.png',w:1.1,h:.8}:n===1?{url:'/sprites/regions-v4/skeleton.png',w:1.1,h:.6}:{url:old+'column-rubble.png',w:.85,h:.7};out.push({x,y,...art});used.add(y*m.w+x);count++;
  }
 }
 cache.set(m,out);return out;
}
