import {TILE_SIZE,TICK_RATE} from '@colony/shared/protocol';
import type {Colonist} from './types.js';
import {COLONIST_BODY_RADIUS} from './constants.js';
import {state} from './state.js';
import {bodyFitsPixel,canStepPixel} from './pathfinding.js';
import {findGroundRoute,type GroundPoint} from './groundNavigation.js';
const GAP=COLONIST_BODY_RADIUS*2+3,TRAIL_KEEP=GAP*4;
export interface TravelColumn {
 ids:string[];route:GroundPoint[];cursor:number;trails:Map<string,GroundPoint[]>;
 blockedSince?:number;repathAt:number;lastLeader?:string;lastX?:number;lastY?:number;
}
export function createTravelColumn(members:Colonist[],route:GroundPoint[]):TravelColumn {
 const a=route[0],b=route[1]??a,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
 // Front to back, with nearby files feeding the entrance first. Stable identity breaks equal ties.
 const ordered=members.slice().sort((u,v)=>Math.hypot(u.x-a.x,u.y-a.y)-Math.hypot(v.x-a.x,v.y-a.y)||((v.x-u.x)*dx+(v.y-u.y)*dy)/len||u.id.localeCompare(v.id));
 return{ids:ordered.map(c=>c.id),route,cursor:1,trails:new Map(),repathAt:0};
}
export function rememberTrail(column:TravelColumn,c:Colonist){
 let points=column.trails.get(c.id);if(!points)column.trails.set(c.id,points=[{x:c.x,y:c.y}]);
 const last=points[points.length-1];if(Math.hypot(c.x-last.x,c.y-last.y)>=3)points.push({x:c.x,y:c.y});
 let length=0;for(let k=points.length-1;k>0;k--){length+=Math.hypot(points[k].x-points[k-1].x,points[k].y-points[k-1].y);if(length>TRAIL_KEEP){points.splice(0,k-1);break;}}
}
export function followTrail(column:TravelColumn,previous:Colonist):GroundPoint {
 const points=column.trails.get(previous.id)??[],current={x:previous.x,y:previous.y};let end=current,left=GAP;
 for(let k=points.length-1;k>=0;k--){const p=points[k],d=Math.hypot(end.x-p.x,end.y-p.y);if(d>=left)return{x:end.x+(p.x-end.x)*left/d,y:end.y+(p.y-end.y)*left/d};left-=d;end=p;}
 return end;
}
export interface ColumnSteer extends GroundPoint {column:TravelColumn;previous?:Colonist}
const detours=new WeakMap<Colonist,{column:TravelColumn;points:GroundPoint[];cursor:number;retry:number;target:GroundPoint}>();
export function clearColumnDetour(c:Colonist,keepRally=false){if(keepRally&&detours.get(c)?.column===groundRallies.get(c)?.column)return;detours.delete(c);}
let budgetTick=-1,budgetCount=0,budgetAt=0;
// Joining a file can require a short detour. Bound this new work; a waiting soldier has no expensive
// fallback search and combat AI remains unchanged. Regular followers reuse the predecessor's trail.
export function stepTravelColumn(c:Colonist,target:ColumnSteer,dt:number,speed:number):void {
 const previous=target.previous,spacing=previous?Math.hypot(previous.x-c.x,previous.y-c.y)-GAP:Infinity;
 let step=Math.min(speed*dt,Math.max(0,spacing));c.state='returning';c.path=[];
 if(step<.01)return;
 let d=detours.get(c);if(d?.column!==target.column)d=undefined;
 if(d&&Math.hypot(d.target.x-target.x,d.target.y-target.y)>TILE_SIZE)d.points=[];
 let point=d&&d.cursor<d.points.length?d.points[d.cursor]:target;
 let dx=point.x-c.x,dy=point.y-c.y,length=Math.hypot(dx,dy);
 if(length<1&&d&&d.cursor<d.points.length){d.cursor++;point=d.points[d.cursor]??target;dx=point.x-c.x;dy=point.y-c.y;length=Math.hypot(dx,dy);}
 step=Math.min(step,length);if(step<.01)return;
 const nx=c.x+dx/length*step,ny=c.y+dy/length*step;
 // Old saves may have a point-body standing very close to a wall. Let it leave that overlap first.
 const radius=bodyFitsPixel(c.x,c.y,COLONIST_BODY_RADIUS)?COLONIST_BODY_RADIUS:0;
 if(canStepPixel(c.x,c.y,nx,ny,radius)){c.x=nx;c.y=ny;return;}
 if(state.cycleTick<(d?.retry??0))return;
 if(budgetTick!==state.cycleTick){budgetTick=state.cycleTick;budgetCount=0;budgetAt=performance.now();}
 if(budgetCount>=6||performance.now()-budgetAt>4)return;
 budgetCount++;
 const route=findGroundRoute({x:c.x,y:c.y},target,COLONIST_BODY_RADIUS,1800);
 d={column:target.column,points:route??[],cursor:1,retry:state.cycleTick+TICK_RATE/2,target:{x:target.x,y:target.y}};detours.set(c,d);
}

const groundRallies=new WeakMap<Colonist,{x:number;y:number;column:TravelColumn}>();
// An individual final slot can now be a clear point inside a tree's reserved placement tile.
export function steerGroundRally(c:Colonist,x:number,y:number,dt:number,speed:number){
 if(Math.hypot(x-c.x,y-c.y)<=2&&canStepPixel(c.x,c.y,x,y,COLONIST_BODY_RADIUS)){c.x=x;c.y=y;c.path=[];c.state='idle';detours.delete(c);return;}
 let p=groundRallies.get(c);if(!p||p.x!==x||p.y!==y){p={x,y,column:createTravelColumn([c],[{x:c.x,y:c.y},{x,y}])};groundRallies.set(c,p);}
 stepTravelColumn(c,{x,y,column:p.column},dt,speed);
}
