import { TileType, TILE_SIZE, isGateTile } from '@colony/shared/protocol';
import type { Mob, SiteState } from './types.js';
import { state, sites, mobs } from './state.js';
import { tileIndex, inBounds } from './tiles.js';
import { isWalkableTile } from './pathfinding.js';
import { spawnGuardian } from './worldgen.js';

interface Route { road:number[]; patrol:number[]; posts:number[] }
const routes=new WeakMap<SiteState,Route>();
const progress=new WeakMap<Mob,{route:number[];index:number;wait:number}>();
const holds=new WeakMap<Mob,number>();
const prepared=new WeakSet<SiteState>();
const guardSlots=new WeakMap<Mob,{site:SiteState;index:number}>();
export function releaseTownSpeaker(mob:Mob) { holds.delete(mob); }
export function townSpeakerHeld(mob:Mob) { return (holds.get(mob)??0)>state.cycleTick; }
export function holdTownSpeaker(mob:Mob) { holds.set(mob,state.cycleTick+20*60); }
function neighbours(i:number) {
 const x=i%state.WORLD_TILES_X,y=Math.floor(i/state.WORLD_TILES_X);
 return [[x,y-1],[x+1,y],[x,y+1],[x-1,y]].filter(([x,y])=>inBounds(x,y)).map(([x,y])=>tileIndex(x,y));
}
function tour(nodes:Set<number>,root:number):number[] {
 if(!nodes.has(root))return [];
 const visited=new Set([root]),route=[root];
 const stack=[{i:root,next:0,near:neighbours(root)}];
 while(stack.length){
  const top=stack[stack.length-1];
  if(top.next>=top.near.length){stack.pop();if(stack.length)route.push(stack[stack.length-1].i);continue;}
  const i=top.near[top.next++];if(!nodes.has(i)||visited.has(i))continue;
  visited.add(i);route.push(i);stack.push({i,next:0,near:neighbours(i)});
 }
 return route;
}
const distance=(i:number,x:number,y:number)=>Math.hypot(i%state.WORLD_TILES_X-x,Math.floor(i/state.WORLD_TILES_X)-y);
function nearest(nodes:Iterable<number>,x:number,y:number) {
 let best=-1,d=Infinity;for(const i of nodes){const n=distance(i,x,y);if(n<d){d=n;best=i;}}return best;
}
export function townRoutes(site:SiteState):Route {
 const cached=routes.get(site);if(cached)return cached;
 const roads=new Set<number>(),patrol=new Set<number>(),gates:number[]=[];
 const previousOwner=state.moverOwner;state.moverOwner=site.num;
 try {
  for(let y=site.y0;y<=site.y1;y++)for(let x=site.x0;x<=site.x1;x++){
   const i=tileIndex(x,y),t=state.tiles[i];
   if(t===TileType.Road||t===TileType.CobbleRoad||isGateTile(t))roads.add(i);
   if(isGateTile(t))gates.push(i);
   if(isWalkableTile(x,y)&&neighbours(i).some(n=>[TileType.Wall,TileType.StoneWall].includes(state.tiles[n])))patrol.add(i);
  }
  for(const i of roads)patrol.add(i);
  const root=nearest(roads,site.keepX,site.keepY+1);
  const posts=gates.map(i=>nearest(neighbours(i).filter(n=>isWalkableTile(n%state.WORLD_TILES_X,Math.floor(n/state.WORLD_TILES_X))),site.keepX,site.keepY)).filter(i=>i>=0);
  if(root>=0)posts.push(root);
  const result={road:tour(roads,root),patrol:tour(patrol,root),posts:[...new Set(posts)]};routes.set(site,result);return result;
 }finally{state.moverOwner=previousOwner;}
}
export function ensureTownGuardPosts(site:SiteState) {
 if(site.faction!=='human'||site.captured||site.cleared||prepared.has(site))return;
 prepared.add(site);
 const route=townRoutes(site);
 const desired=Math.min(24,route.posts.length+2);
 while(site.garrisonMax<desired){
  const i=route.posts[site.garrison.length%Math.max(1,route.posts.length)];if(i===undefined)break;
  const m=spawnGuardian('townGuard',{x:i%state.WORLD_TILES_X,y:Math.floor(i/state.WORLD_TILES_X)},site.id,'fort');
  site.garrison.push(m.id);site.garrisonMax++;site.garrisonRoster.townGuard=(site.garrisonRoster.townGuard??0)+1;
 }
 site.posts=[...new Set([...route.posts,...site.posts])];
}
function follow(mob:Mob,route:number[],dt:number,pause:boolean) {
 if(!route.length)return;
 let p=progress.get(mob);
 if(!p||p.route!==route){
  const start=nearest(route,mob.x/TILE_SIZE,mob.y/TILE_SIZE),index=route.indexOf(start);
  p={route,index:Math.max(0,index),wait:0};progress.set(mob,p);
  // Initial placement is onto a cached route, so no individual A* search is necessary.
  mob.x=(start%state.WORLD_TILES_X+.5)*TILE_SIZE;mob.y=(Math.floor(start/state.WORLD_TILES_X)+.5)*TILE_SIZE;
 }
 if((holds.get(mob)??0)>state.cycleTick||p.wait>state.cycleTick)return;
 const i=route[p.index],x=(i%state.WORLD_TILES_X+.5)*TILE_SIZE,y=(Math.floor(i/state.WORLD_TILES_X)+.5)*TILE_SIZE;
 if(!isWalkableTile(i%state.WORLD_TILES_X,Math.floor(i/state.WORLD_TILES_X)))return;
 const dx=x-mob.x,dy=y-mob.y,d=Math.hypot(dx,dy),step=Math.max(0,mob.speed*.65*dt);
 if(d<=step){mob.x=x;mob.y=y;p.index=(p.index+1)%route.length;if(pause&&p.index%19===0)p.wait=state.cycleTick+40+(mob.id.charCodeAt(0)%40);}
 else{mob.x+=dx/d*step;mob.y+=dy/d*step;}
 mob.targetType=null;mob.targetId=null;mob.path.length=0;
}
export function updateTownResident(mob:Mob,dt:number):boolean {
 const s=mob.siteId?sites.get(mob.siteId):undefined;
 if(s?.provoked)progress.delete(mob);
 if(!s||s.faction!=='human'||!s.awake||s.captured||s.cleared||s.provoked)return false;
 if(!mob.siteWorker||mob.siteWorker==='priest'||mob.siteWorker==='herald'||s.workers[0]===mob.id)return false;
 const route=townRoutes(s).road;if(route.length<2)return false;
 follow(mob,route,dt,true);return true;
}
export function updatePeacefulGuard(mob:Mob,dt:number):boolean {
 const s=mob.siteId?sites.get(mob.siteId):undefined;
 if(s?.provoked||mob.guardianActive)progress.delete(mob);
 if(!s||s.faction!=='human'||s.captured||s.cleared||s.provoked||mob.guardianActive||mob.siteWorker)return false;
 if(!s.awake)return true;
 const r=townRoutes(s),cached=guardSlots.get(mob);
 const index=cached?.site===s&&s.garrison[cached.index]===mob.id?cached.index:s.garrison.indexOf(mob.id);
 if(index>=0&&(s!==cached?.site||index!==cached?.index))guardSlots.set(mob,{site:s,index});
 if(index<0)return false;
 if(index<r.posts.length){
  const i=r.posts[index];mob.x=(i%state.WORLD_TILES_X+.5)*TILE_SIZE;mob.y=(Math.floor(i/state.WORLD_TILES_X)+.5)*TILE_SIZE;
  mob.targetType=null;mob.targetId=null;mob.path.length=0;return true;
 }
 follow(mob,r.patrol,dt,false);return true;
}
