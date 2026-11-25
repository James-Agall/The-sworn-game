import {colonists} from './state.js';
import {coldSpeedMult} from './winter.js';
import {biomeSpeedMultiplier,roadSpeedMultiplier} from './tiles.js';
import {compactObstacle} from '@colony/shared/sceneryCollision';
import {TILE_SIZE} from '@colony/shared/protocol';
import {COLONIST_BODY_RADIUS} from './constants.js';
import {state} from './state.js';
import {bodyFitsPixel,canStepPixel} from './pathfinding.js';
export interface GroundPoint {x:number;y:number}
const GRID=TILE_SIZE/2;
const DIRECTIONS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
export const groundRouteStats={searches:0,expanded:0,failed:0};
export function groundLineClear(a:GroundPoint,b:GroundPoint,radius=COLONIST_BODY_RADIUS):boolean {
 const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(TILE_SIZE/3)));
 for(let k=1;k<=n;k++)if(!canStepPixel(a.x+(b.x-a.x)*(k-1)/n,a.y+(b.y-a.y)*(k-1)/n,a.x+(b.x-a.x)*k/n,a.y+(b.y-a.y)*k/n,radius))return false;
 return true;
}
interface Node {x:number;y:number;key:number;g:number;f:number;order:number;parent:Node|null}
const before=(a:Node,b:Node)=>a.f<b.f||a.f===b.f&&(a.g>b.g||a.g===b.g&&a.order<b.order);
function heapPush(heap:Node[],node:Node){let k=heap.length;heap.push(node);while(k>0){const p=(k-1)>>>1;if(!before(node,heap[p]))break;heap[k]=heap[p];k=p;}heap[k]=node;}
function heapPop(heap:Node[]):Node{const first=heap[0],last=heap.pop()!;if(heap.length){let k=0;while(k*2+1<heap.length){let child=k*2+1;if(child+1<heap.length&&before(heap[child+1],heap[child]))child++;if(!before(heap[child],last))break;heap[k]=heap[child];k=child;}heap[k]=last;}return first;}
const heuristic=(x:number,y:number,gx:number,gy:number)=>{const dx=Math.abs(gx-x),dy=Math.abs(gy-y);return Math.max(dx,dy)*10+Math.min(dx,dy)*4;};
function snap(p:GroundPoint,radius:number,start:boolean):GroundPoint|null {
 const x=Math.round(p.x/GRID),y=Math.round(p.y/GRID);let result:GroundPoint|null=null,best=Infinity;
 const startRadius=bodyFitsPixel(p.x,p.y,radius)?radius:0;
 for(let ring=0;ring<=4;ring++){
  for(let dy=-ring;dy<=ring;dy++)for(let dx=-ring;dx<=ring;dx++){
   if(ring&&Math.max(Math.abs(dx),Math.abs(dy))!==ring)continue;
   const q={x:(x+dx)*GRID,y:(y+dy)*GRID},d=(q.x-p.x)**2+(q.y-p.y)**2;
   if(d>=best||!bodyFitsPixel(q.x,q.y,radius))continue;
   if(start&&!groundLineClear(p,q,startRadius))continue;
   result=q;best=d;
  }
  if(result)return result;
 }
 return null;
}
// A bounded, shared foot route on half-tile nodes. Tile placement is unchanged; edges test actual
// body clearance, allowing routes BETWEEN tree trunks instead of discarding every tree cell.
export function findGroundRoute(start:GroundPoint,goal:GroundPoint,radius=COLONIST_BODY_RADIUS,nodeBudget=18000):GroundPoint[]|null {
 groundRouteStats.searches++;
 if(bodyFitsPixel(start.x,start.y,radius)&&bodyFitsPixel(goal.x,goal.y,radius)&&groundLineClear(start,goal,radius))return[{...start},{...goal}];
 const first=snap(start,radius,true),end=snap(goal,radius,false);
 if(!first||!end){groundRouteStats.failed++;return null;}
 const width=state.WORLD_TILES_X*2+1,height=state.WORLD_TILES_Y*2+1;
 const gx=end.x/GRID,gy=end.y/GRID,x=first.x/GRID,y=first.y/GRID;
 let order=0,expanded=0;const root:Node={x,y,key:y*width+x,g:0,f:heuristic(x,y,gx,gy),order:order++,parent:null};
 const heap:Node[]=[root],best=new Map<number,Node>([[root.key,root]]),blocked=new Set<number>();let found:Node|undefined;
 while(heap.length&&expanded<nodeBudget){
  const current=heapPop(heap);if(best.get(current.key)!==current)continue;
  expanded++;if(current.x===gx&&current.y===gy){found=current;break;}
  for(const [dx,dy]of DIRECTIONS){
   const nx=current.x+dx,ny=current.y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
   const key=ny*width+nx,g=current.g+(dx&&dy?14:10),old=best.get(key);
   if(old&&old.g<=g||blocked.has(key))continue;
   const px=nx*GRID,py=ny*GRID;
   if(!bodyFitsPixel(px,py,radius)){blocked.add(key);continue;}
   if(!canStepPixel(current.x*GRID,current.y*GRID,px,py,radius))continue;
   const node:Node={x:nx,y:ny,key,g,f:g+heuristic(nx,ny,gx,gy),order:order++,parent:current};best.set(key,node);heapPush(heap,node);
  }
 }
 groundRouteStats.expanded+=expanded;
 if(!found){groundRouteStats.failed++;return null;}
 const raw:GroundPoint[]=[];for(let n:Node|null=found;n;n=n.parent)raw.push({x:n.x*GRID,y:n.y*GRID});raw.reverse();
 const result:GroundPoint[]=[{...start}];if(Math.hypot(start.x-first.x,start.y-first.y)>.01)result.push(first);
 // Bounded string pulling avoids quadratic ray work on very long routes.
 for(let i=0;i<raw.length-1;){let next=Math.min(raw.length-1,i+12);while(next>i+1&&!groundLineClear(raw[i],raw[next],radius))next--;result.push(raw[next]);i=next;}
 if(bodyFitsPixel(goal.x,goal.y,radius)&&groundLineClear(result[result.length-1],goal,radius))result.push({...goal});
 return result;
}

// Test the formation's swept lanes, rather than the canopy or a single blocked centre tile.
export function needsTravelColumn(path:GroundPoint[],halfWidth:number):boolean {
 if(path.length<2)return false;
 let blocked=0,checked=0,travel=0;
 for(let k=1;k<path.length&&travel<TILE_SIZE*8;k++){
  const a=path[k-1],b=path[k],d=Math.hypot(b.x-a.x,b.y-a.y);if(d<1)continue;
  const lx=-(b.y-a.y)/d,ly=(b.x-a.x)/d,n=Math.max(1,Math.ceil(Math.min(d,TILE_SIZE*8-travel)/TILE_SIZE));
  for(let step=0;step<=n;step++){
   const along=Math.min(d,step*TILE_SIZE),x=a.x+(b.x-a.x)*along/d,y=a.y+(b.y-a.y)*along/d;
   // A broad formation may otherwise sample only the clear grid seams between trunks. Detect
   // actual compact-obstacle density across its local footprint as well as swept lane clearance.
   const tx=Math.floor(x/TILE_SIZE),ty=Math.floor(y/TILE_SIZE),reach=Math.min(3,Math.ceil(halfWidth/TILE_SIZE));let clutter=0;
   for(let yy=Math.max(0,ty-1);yy<=Math.min(state.WORLD_TILES_Y-1,ty+1);yy++)for(let xx=Math.max(0,tx-reach);xx<=Math.min(state.WORLD_TILES_X-1,tx+reach);xx++)if(compactObstacle(state.tiles[yy*state.WORLD_TILES_X+xx]))clutter++;
   if(clutter>=4)return true;
   for(const side of [-1,1])for(const width of [Math.min(halfWidth,TILE_SIZE),halfWidth]){
    checked++;if(!bodyFitsPixel(x+lx*width*side,y+ly*width*side,COLONIST_BODY_RADIUS))blocked++;
   }
  }
  travel+=d;
 }
 return blocked>=3&&blocked>=checked*.12;
}

interface GroundMover {x:number;y:number;path:{x:number;y:number}[];repathCooldown:number;id?:string}
const approaches=new WeakMap<GroundMover,{points:GroundPoint[];cursor:number;goal:GroundPoint;failed:boolean}>();
export function usesGroundApproach(e:GroundPoint,goal:GroundPoint):boolean {
 const tile=(p:GroundPoint)=>state.tiles[Math.floor(p.y/TILE_SIZE)*state.WORLD_TILES_X+Math.floor(p.x/TILE_SIZE)];
 return compactObstacle(tile(e))||compactObstacle(tile(goal));
}
export function groundApproachFailed(e:GroundMover):boolean {return approaches.get(e)?.failed??false;}
// Combat targets can stand at the edge of a trunk's placement cell. Follow a real foot route to
// that point rather than repeatedly requesting the impossible blocked tile centre.
export function advanceGroundApproach(e:GroundMover,goal:GroundPoint,speed:number,dt:number):boolean {
 let p=approaches.get(e);
 if(!usesGroundApproach(e,goal)&&!p)return false;
 if(p&&Math.hypot(p.goal.x-goal.x,p.goal.y-goal.y)>TILE_SIZE){approaches.delete(e);p=undefined;}
 if(!usesGroundApproach(e,goal)&&(!p||p.cursor>=p.points.length)){approaches.delete(e);return false;}
 if(e.repathCooldown>0)e.repathCooldown--;
 if((!p||p.cursor>=p.points.length)&&e.repathCooldown<=0){
  const points=findGroundRoute(e,goal,0,4000);p={points:points??[],cursor:1,goal:{...goal},failed:!points};approaches.set(e,p);e.repathCooldown=10;
 }
 e.path=[];
 if(!p||p.cursor>=p.points.length)return true;
 let target=p.points[p.cursor],dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy);
 while(d<1&&p.cursor<p.points.length-1){target=p.points[++p.cursor];dx=target.x-e.x;dy=target.y-e.y;d=Math.hypot(dx,dy);}
 if(d<1){p.cursor++;return true;}
 const id=e.id??'',road=colonists.get(id)===e?roadSpeedMultiplier(e.x,e.y)*coldSpeedMult(id):1;
 const step=Math.min(d,speed*biomeSpeedMultiplier(e.x,e.y)*road*dt),x=e.x+dx/d*step,y=e.y+dy/d*step;
 if(canStepPixel(e.x,e.y,x,y)){e.x=x;e.y=y;if(step>=d)p.cursor++;}
 else{p.points=[];p.cursor=0;}
 return true;
}
