import assert from 'node:assert/strict';
import {state,gates,constructionSites} from './src/state.js';
import {TileType as T} from '@colony/shared/protocol';
import {rampartTransition,isLargeGate,isFortPart} from '@colony/shared/fortifications';
import {findPath,canStepTile,pathSearchStats} from './src/pathfinding.js';
import {markTileRegistryStale,setTile,pathCacheStats} from './src/chunks.js';
import {PATH_NODE_BUDGET} from './src/constants.js';
import type {TileCoord} from './src/types.js';
function referencePath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): { path: TileCoord[] | null; visited: Set<number> } {
  const key = (t: TileCoord) => t.y * state.WORLD_TILES_X + t.x;
  const visited = new Set<number>([key(start)]);
  const parent = new Map<number, TileCoord>();
  const queue: TileCoord[] = [start];

  // Node budget: a request can never stall a tick on a huge map (a 160 map has 25.6k tiles in all, so
  // it is never reached there). Over budget = no path, like an unreachable goal.
  for (let head = 0; head < queue.length; head++) {
    if (head > PATH_NODE_BUDGET) return { path: null, visited };
    const current = queue[head];
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!canStepTile(current.x,current.y,n.x,n.y)) continue;
      if (blocked && blocked(n.x, n.y) && !(n.x === goal.x && n.y === goal.y)) continue;
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, current);
      if (n.x === goal.x && n.y === goal.y) {
        const path: TileCoord[] = [n];
        let back = current;
        while (!(back.x === start.x && back.y === start.y)) {
          path.unshift(back);
          back = parent.get(key(back))!;
        }
        return { path, visited };
      }
      queue.push(n);
    }
  }
  return { path: null, visited };
}

let checks=0;
for(let a=0;a<256;a++)for(let b=0;b<256;b++){
 const access=(t:number)=>t===T.WallLadder||isLargeGate(t);
 assert.equal(rampartTransition(a,b),a===T.Rampart?b===T.Rampart||access(b):b!==T.Rampart||access(a));checks++;
}
const setup=(w:number,h:number)=>{state.WORLD_TILES_X=w;state.WORLD_TILES_Y=h;state.tiles=new Uint8Array(w*h);gates.clear();constructionSites.clear();markTileRegistryStale();};
let seed=7241;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const compare=(start:TileCoord,goal:TileCoord,blocked?: (x:number,y:number)=>boolean)=>{
 const expected=start.x===goal.x&&start.y===goal.y?[]:referencePath(start,goal,blocked).path;
 assert.deepEqual(findPath(start,goal,blocked),expected,JSON.stringify({start,goal}));
 assert.deepEqual(findPath(start,goal,blocked),expected,'cached route');checks+=2;
};
for(let map=0;map<60;map++){
 setup(35+map%3,33+map%5);
 const pieces=[T.Wall,T.Water,T.Rampart,T.WallLadder,T.LargeGateH,T.LargeGateHPart,T.PropCrate,T.WoodDoor,T.ConstructionSite];
 for(let i=0;i<state.tiles.length;i++)if(random()<.24){const t=pieces[Math.floor(random()*pieces.length)];state.tiles[i]=t;if(t===T.LargeGateH||t===T.WoodDoor)gates.set(i,{open:random()>.5,lock:random()>.5?'auto':'locked',clearTicks:0,overrun:false});}
 for(let q=0;q<12;q++){
  const start={x:Math.floor(random()*state.WORLD_TILES_X),y:Math.floor(random()*state.WORLD_TILES_Y)},goal={x:Math.floor(random()*state.WORLD_TILES_X),y:Math.floor(random()*state.WORLD_TILES_Y)};
  state.hostileMover=!!(q%2);compare(start,goal,q%3===0?(x,y)=>(x+y)%13===0:undefined);
 }
}
setup(70,53);state.hostileMover=false;
for(let y=0;y<53;y++)setTile(y*70+32,T.Wall);
compare({x:30,y:20},{x:35,y:20});
setTile(20*70+32,T.Empty);compare({x:30,y:20},{x:35,y:20});
setTile(20*70+32,T.Wall);compare({x:30,y:20},{x:35,y:20});
for(const goal of [{x:71,y:0},{x:-1,y:1},{x:1,y:53}])compare({x:1,y:1},goal);
compare({x:-1,y:0},{x:1,y:1});compare({x:-1,y:0},{x:-1,y:0});
// A nested custom blocker must not overwrite the outer search's queue or parents.
setup(70,53);let nested=false;
const start={x:4,y:3},goal={x:60,y:49},expected=referencePath(start,goal).path;
assert.deepEqual(findPath(start,goal,()=>{if(!nested){nested=true;findPath({x:2,y:2},{x:65,y:48});}return false;}),expected);checks++;
const owned=findPath(start,goal)!;owned.shift();owned[0].x=-100;
assert.deepEqual(findPath(start,goal),expected);checks++;
// A large blocked search still uses the original node budget and canonical answer.
setup(256,256);compare({x:0,y:0},{x:255,y:255});
console.log(`PASS ${checks} transition/path/cache checks; ${pathSearchStats.searches} cold searches, ${pathCacheStats.hits} cache hits`);

import {neighbourhoodPopulationBonus,isHouseTile,isSynergyBuilding,isMilitaryTile} from './src/colonists.js';
import {tileIndicesOfAny} from './src/chunks.js';
import {NEIGHBOURS_8} from './src/constants.js';
import {inBounds,tileIndex} from './src/tiles.js';
import {clanIdAt,setTileClan} from './src/clans.js';
import {tileClan} from './src/state.js';
import {TileType} from '@colony/shared/protocol';
const HOUSE_TILES=[T.House,T.BigHouse,T.HouseLevel2];
function referenceBonus(onBonus?: (tx: number, ty: number) => void): number {
  let bonus = 0;
  for (const i of tileIndicesOfAny(HOUSE_TILES)) {
    const tx = i % state.WORLD_TILES_X;
    const ty = Math.floor(i / state.WORLD_TILES_X);
    for (const [dx, dy] of NEIGHBOURS_8) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!inBounds(nx, ny)) continue;
      const n = state.tiles[tileIndex(nx, ny)] as TileType;
      // Clans: a pair only counts inside one clan.
      if (tileClan.size > 0 && clanIdAt(nx, ny) !== clanIdAt(tx, ty)) continue;
      // Village life: military buildings no longer add housing (houses + Town Centers + Keeps only).
      if (isSynergyBuilding(n) && !isMilitaryTile(n)) {
        bonus++;
        onBonus?.(tx, ty);
      }
      // House-house pairs are seen from both ends; count each once (the "later" tile in scan order).
      else if (isHouseTile(n) && (dy > 0 || (dy === 0 && dx > 0))) {
        bonus++;
        onBonus?.(tx, ty);
      }
    }
  }
  return bonus;
}


setup(40,35);tileClan.clear();state.clanTilesVersion++;
const buildings=[T.House,T.BigHouse,T.HouseLevel2,T.BarnPost,T.LumberjackPost,T.KnightPost,T.Empty];
for(let edit=0;edit<200;edit++){
 const i=(8+edit%12)+(8+Math.floor(edit/12)%12)*40;
 setTile(i,buildings[edit%buildings.length]);setTileClan(i,edit%3);
 const expected:number[][]=[],actual:number[][]=[],cached:number[][]=[];
 const bonus=referenceBonus((x,y)=>expected.push([x,y]));
 assert.equal(neighbourhoodPopulationBonus((x,y)=>actual.push([x,y])),bonus);
 assert.equal(neighbourhoodPopulationBonus((x,y)=>cached.push([x,y])),bonus);
 assert.deepEqual(actual,expected);assert.deepEqual(cached,expected);
}
state.tiles.fill(T.Empty);markTileRegistryStale();assert.equal(neighbourhoodPopulationBonus(),0);
console.log('PASS 200 housing-layout/clan edits, cached callback order and bulk reset');
