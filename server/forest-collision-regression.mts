import assert from 'node:assert/strict';
import {TileType as T,isSolidTile} from '@colony/shared/protocol';
import {treeAt,treeSizeClass} from '@colony/shared/trees';
import {sceneryRadius} from '@colony/shared/sceneryCollision';
import {state,gates,tileOwner,tileClan} from './src/state.js';
import {markTileRegistryStale,setTile} from './src/chunks.js';
import {findPath,bodyFitsPixel,canStepPixel} from './src/pathfinding.js';
import {collidesAt} from './src/tiles.js';
import {findGroundRoute,groundLineClear,groundRouteStats} from './src/groundNavigation.js';
const W=48,H=40;state.WORLD_TILES_X=W;state.WORLD_TILES_Y=H;state.tiles=new Uint8Array(W*H);state.biomes=new Uint8Array(W*H);tileOwner.clear();tileClan.clear();gates.clear();markTileRegistryStale();
let checks=0;
for(let y=0;y<100;y++)for(let x=0;x<100;x++){
 const n=((Math.imul(x+17,73856093)^Math.imul(y+31,19349663))>>>0)%10;
 const tree=treeAt(x,y);assert.equal(tree.scale,n<2?.58:n<8?1:1.45);assert.equal(tree.wood,n<2?1:n<8?3:6);assert.equal(tree.chops,n<2?2:n<8?5:10);assert.equal(sceneryRadius(T.Tree,x,y),[3,5,8][treeSizeClass(x,y)]);checks++;
}
const tx=12,ty=10,cx=(tx+.5)*32,cy=(ty+.5)*32;setTile(ty*W+tx,T.Tree);
assert(!bodyFitsPixel(cx,cy));assert(bodyFitsPixel(tx*32+1,cy));
assert(collidesAt(cx,cy));assert(!collidesAt(tx*32-10,cy));
assert(!canStepPixel(tx*32+1,cy,(tx+1)*32-1,cy),'swept movement cannot tunnel through a small trunk');
for(const tile of [T.PropBarrel,T.PropCrate,T.PropLanternPost,T.PropCross,T.PropCampfire]){setTile(ty*W+tx,tile);assert(isSolidTile(tile));assert(!bodyFitsPixel(cx,cy));assert(bodyFitsPixel(tx*32+1,ty*32+1));checks++;}
for(const tile of [T.Wall,T.StoneWall,T.PropFence,T.House,T.Water,T.Moat]){setTile(ty*W+tx,tile);assert(!bodyFitsPixel(tx*32+1,ty*32+1));assert(!canStepPixel(tx*32-1,cy,tx*32+1,cy));checks++;}
state.tiles.fill(T.Empty);markTileRegistryStale();
// A complete row of tree tiles blocks the old tile-centre search. Foot-clearance navigation must
// find the real spaces between trunks, without cutting through their physical bases.
for(let x=0;x<W;x++)setTile(20*W+x,T.Tree);
const start={x:16*32,y:18*32},goal={x:21*32,y:24*32};
assert.equal(findPath({x:16,y:18},{x:21,y:24}),null);
const began=performance.now(),route=findGroundRoute(start,goal);const routeMs=performance.now()-began;
assert(route&&route.length>1,'a route through the forest exists');
for(let i=1;i<route.length;i++)assert(groundLineClear(route[i-1],route[i]),'every forest edge retains body clearance');
// The hero can pass between normal/sapling trunks, while a pair of large trunks can remain too narrow.
let normalGap=false;
for(let x=1;x<W;x++)if(treeSizeClass(x-1,20)<2&&treeSizeClass(x,20)<2){assert(!collidesAt(x*32,20.5*32));normalGap=true;break;}
assert(normalGap);
for(let x=0;x<W;x++)setTile(20*W+x,T.StoneWall);
assert.equal(findGroundRoute(start,goal),null,'solid walls are never treated as forest gaps');
state.tiles.fill(T.Empty);markTileRegistryStale();
setTile(8*W+8,T.Wall);setTile(9*W+9,T.Wall);
assert(!canStepPixel(9.5*32,8.5*32,8.5*32,9.5*32,7),'no diagonal wall corner cut');
console.log(`PASS ${checks} tree-size/yield and collision checks; forest route ${routeMs.toFixed(2)} ms, ${route!.length} points; ${groundRouteStats.expanded} expanded nodes`);
