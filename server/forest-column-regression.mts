import assert from 'node:assert/strict';import fs from 'node:fs';
import {TileType as T} from '@colony/shared/protocol';
import {state,colonists,mobs,orderGroups,squadMarchSpeed} from './src/state.js';
import {markTileRegistryStale,setTile} from './src/chunks.js';
import {spawnSoldierAt} from './src/creative.js';
import {startFormationMarch,updateFormationMarch,stopFormationMarch} from './src/battle.js';
import {returnToRally,unitStats} from './src/units.js';
import {rallyUnit} from './src/orders.js';
import {bodyFitsPixel,separateBodies} from './src/pathfinding.js';
import {groundRouteStats} from './src/groundNavigation.js';
import type {OrderGroup,Colonist} from './src/types.js';
const W=48,H=36;state.WORLD_TILES_X=W;state.WORLD_TILES_Y=H;state.worldWidth=W*32;state.worldHeight=H*32;state.tiles=new Uint8Array(W*H);state.biomes=new Uint8Array(W*H);state.cellHead=new Int32Array(W*H).fill(-1);state.cellNext=new Int32Array(64);state.siteGrounds=new Uint8Array(W*H);state.hostileMover=false;colonists.clear();mobs.clear();orderGroups.clear();markTileRegistryStale();
for(let x=0;x<W;x++){setTile(x,T.StoneWall);setTile((H-1)*W+x,T.StoneWall);}
for(let y=1;y<H-1;y++){for(let x=14;x<=22;x++)setTile(y*W+x,T.Tree);if(y!==23)setTile(y*W+28,T.StoneWall);}
const members:Colonist[]=[];for(let n=0;n<12;n++){const c=spawnSoldierAt(n%3===0?'archer':'militia',(7+n%3)*32+16,(16+Math.floor(n/3))*32+16,0);assert(c);members.push(c);}
const finals=new Map(members.map((c,n)=>[c.id,{x:(36+Math.floor(n/4))*32+16,y:(21+n%4)*32+16}]));
const g:OrderGroup={id:'forest-test',unitIds:new Set(members.map(c=>c.id)),current:{kind:'move',x:37*32,y:23*32},queue:[],destX:37*32,destY:23*32,startedTick:0,engaged:false,clearSince:-1,followAt:null};orderGroups.set(g.id,g);
assert(startFormationMarch(g,members,finals,finals,37*32,23*32,0));for(const c of members){const s=finals.get(c.id)!;rallyUnit(c,s.x,s.y,null);}
assert(g.march?.column,'dense forest selects predecessor-trail travel');
const trace:any[]=[];let completed=-1,collisionTicks=0,worstStep=0;
const start=performance.now();
for(let tick=0;tick<2400;tick++){
 state.cycleTick=tick;squadMarchSpeed.clear();const began=performance.now();updateFormationMarch();
 for(const c of members)returnToRally(c,.05,squadMarchSpeed.get(c.id)??unitStats(c).speed);
 separateBodies();worstStep=Math.max(worstStep,performance.now()-began);
 for(const c of members)if(!bodyFitsPixel(c.x,c.y))collisionTicks++;
 if(tick%5===0)trace.push({tick,column:g.march?.column?.ids.length??0,units:members.map(c=>({id:c.id,x:c.x,y:c.y,state:c.state}))});
 if(!g.march&&members.every(c=>Math.hypot(c.x-finals.get(c.id)!.x,c.y-finals.get(c.id)!.y)<4)){completed=tick;break;}
}
const result={completedTick:completed,simulatedSeconds:completed/20,wallMs:performance.now()-start,worstStepMs:worstStep,collisionTicks,routeStats:{...groundRouteStats},units:members.map(c=>({id:c.id,x:c.x,y:c.y,final:finals.get(c.id),state:c.state})),remainingColumn:g.march?.column?.ids.length??0};
const reportDir=process.env.COLONY_FOREST_REPORT_DIR;
if(reportDir){fs.mkdirSync(reportDir,{recursive:true});fs.writeFileSync(`${reportDir}/column-test.json`,JSON.stringify(result,null,2));fs.writeFileSync(`${reportDir}/column-trace.json`,JSON.stringify({width:W,height:H,tiles:[...state.tiles],trace}));}
console.log(JSON.stringify(result));
assert.equal(collisionTicks,0,'no trunk, wall or water penetration');assert(completed>0,'the whole column clears the forest and re-forms on its final slots');
// A new order replaces the file, and combat immediately releases column steering.
assert(startFormationMarch(g,members,finals,finals,8*32,18*32,Math.PI));stopFormationMarch(g);assert.equal(g.march,undefined);
for(let n=0;n<members.length;n++){members[n].x=(7+n%3)*32+16;members[n].y=(16+Math.floor(n/3))*32+16;}
assert(startFormationMarch(g,members,finals,finals,37*32,23*32,0));assert(g.march?.column);
g.engaged=true;state.cycleTick++;updateFormationMarch();assert.equal(g.march,undefined,'combat releases column steering');g.engaged=false;
// A clear stopping point in a tree cell must not be treated as a building garrison.
const solo=members[0],treeGoal={x:18*32+2,y:23*32+2};assert(bodyFitsPixel(treeGoal.x,treeGoal.y,7));
rallyUnit(solo,treeGoal.x,treeGoal.y,null);
for(let tick=0;tick<1000&&Math.hypot(solo.x-treeGoal.x,solo.y-treeGoal.y)>2;tick++){state.cycleTick++;updateFormationMarch();returnToRally(solo,.05,unitStats(solo).speed);assert(bodyFitsPixel(solo.x,solo.y));}
assert(Math.hypot(solo.x-treeGoal.x,solo.y-treeGoal.y)<=2,'individual tree-cell stopping point reached');
console.log('PASS full forest crossing, a one-tile stone choke, collision separation, tail arrival, final formation, combat interruption, tree-cell arrival and cancellation');
