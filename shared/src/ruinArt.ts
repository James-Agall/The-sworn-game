import type {CaveDressing} from './caveScenery.js';
import {interiorSolidGrid,type InteriorMap} from './interiors.js';
const root='/sprites/ruins-v1/';
export const RUIN_FLOOR_URL=root+'flagstone.png';
export const RUIN_WALL_ART={face:root+'wall-face.png',rim:root+'wall-rim.png',side:root+'wall-side.png',body:root+'wall-core.png'};
export const RUIN_TITLES=['Ruined sanctuary','Forgotten crypt','Fallen keep','Ruined cloister'];
export function ruinPropArt(prop:string){
 const all:Record<string,{url:string;w:number;h:number}>={
  statue:{url:root+'broken-statue.png',w:1.4,h:2.2},ruinRubble:{url:root+'column-rubble.png',w:1.5,h:1},
  skullBones:{url:'/sprites/regions-v4/skulls.png',w:.85,h:.6},fallenSkeleton:{url:'/sprites/regions-v4/skeleton.png',w:1.3,h:.7},
  cobweb:{url:'/sprites/regions-v4/web.png',w:1.3,h:.9},overgrowth:{url:'/sprites/regions-v4/brambles.png',w:1.3,h:1},
 };return all[prop];
}
export function ruinEntrance(m:InteriorMap){const {x,y}=m.exit;return{opening:{x:x-.15,y:y-.6,w:1.3,h:1.5},sprites:[{url:'/sprites/regions-v3/ruin-entrance.png',x:x-.75,y:y-1.7,w:2.5,h:2.7}]};}
export interface RuinDressing extends CaveDressing {}
const cache=new WeakMap<InteriorMap,RuinDressing[]>();
// Scenery-only dressing preserves existing encounters, doors, saved enemy
// positions and line-of-sight. Larger set pieces stay clear of combat lanes.
export function ruinScenery(m:InteriorMap){
 const old=cache.get(m);if(old)return old;const solid=interiorSolidGrid(m),used=new Set(m.props.map(p=>p.y*m.w+p.x)),out:RuinDressing[]=[],variant=m.variant%4;
 const safe=(x:number,y:number)=>x>0&&y>0&&x<m.w-1&&y<m.h-1&&!solid[y*m.w+x]&&!used.has(y*m.w+x)&&Math.hypot(x-m.spawn.x,y-m.spawn.y)>3&&Math.hypot(x-m.exit.x,y-m.exit.y)>3&&!m.lairs?.some(p=>Math.hypot(p.x-x,p.y-y)<2)&&!m.props.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<=1);
 const add=(x:number,y:number,url:string,w:number,h:number)=>{if(!safe(x,y))return;out.push({x,y,url,w,h});used.add(y*m.w+x);};
 // Crypt, memorial/shrine and collapsed hall areas within the existing complex.
 for(const [x,y]of [[3,3],[6,3],[3,10],[6,10]])add(x,y,root+'sarcophagus.png',1.45,1.05);
 for(const [x,y]of [[11,3],[18,3],[11,11],[18,11],[11,17],[18,17],[11,22],[18,22]])add(x,y,root+'column-rubble.png',1.35,1);
 for(const [x,y]of [[3,17],[7,17],[22,17],[26,17]])add(x,y,variant===2?'/sprites/structure/extra/crates_barrels_stack.png':root+'sarcophagus.png',1.4,1.05);
 add(14,3,'/sprites/structure/extra/altar_candles.png',1.6,1.25);
 for(const [x,y]of [[12,18],[17,18],[12,21],[17,21]])add(x,y,'/sprites/structure/extra/bench.png',1.4,.65);
 for(const [x,y]of [[22,3],[26,10],[3,22],[26,23]])add(x,y,variant===1?root+'sarcophagus.png':root+'broken-statue.png',1.2,1.6);
 // Smaller remains, ivy and fallen stone cluster against walls and door sides.
 const small=[{url:'/sprites/regions-v4/skulls.png',w:.65,h:.45},{url:'/sprites/regions-v4/skeleton.png',w:1.2,h:.65},{url:'/sprites/regions-v4/web.png',w:1.3,h:.9},{url:'/sprites/regions-v4/brambles.png',w:1.15,h:.8},{url:root+'column-rubble.png',w:.9,h:.65}];
 for(let y=2;y<m.h-2;y++)for(let x=2;x<m.w-2;x++){
  const hash=(x*73+y*137+variant*37)>>>0;if(hash%7!==0||!safe(x,y))continue;
  const closeWall=[[0,-1],[1,0],[0,1],[-1,0]].some(([dx,dy])=>m.cells[(y+dy)*m.w+x+dx]==='#');
  if(!closeWall&&hash%3!==0)continue;const a=small[hash%small.length];out.push({x,y,...a});used.add(y*m.w+x);
 }
 cache.set(m,out);return out;
}
