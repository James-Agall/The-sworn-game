import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {buildUnderground} from '../shared/src/underground.js';
import {caveWallPieces} from '../shared/src/caveWalls.js';
import {caveRails,caveRailPieces} from '../shared/src/caveRails.js';
import {caveScenery} from '../shared/src/caveScenery.js';
import {undergroundResources,undergroundPropUrl,CAVE_WALL_ART} from '../shared/src/undergroundArt.js';
import {MINE_LAYER_YIELDS} from '../shared/src/mines.js';
import {interiorLayoutAccessible} from '../shared/src/interiors.js';
for(const url of Object.values(CAVE_WALL_ART))assert(existsSync('client/public'+url));
let maps=0,corners=0,junctions=0;
for(let seed=1;seed<=8;seed++)for(const kind of ['mine','cave'] as const)for(let depth=1;depth<=3;depth++){
 const {map,solid}=buildUnderground({seed,kind,depth,levels:3,layered:kind==='mine'}),before=JSON.stringify(map),walls=caveWallPieces(map),body=new Set(walls.filter(p=>p.kind==='body').map(p=>p.y*map.w+p.x));
 assert.equal(caveWallPieces(map),walls);
 for(let y=0;y<map.h;y++)for(let x=0;x<map.w;x++)if(map.cells[y*map.w+x]==='#'){
  assert(body.has(y*map.w+x),'every boundary corner has opaque rock backing');
  const open=(xx:number,yy:number)=>xx>=0&&yy>=0&&xx<map.w&&yy<map.h&&!['#',' '].includes(map.cells[yy*map.w+xx]);
  const n=open(x,y-1),s=open(x,y+1),e=open(x+1,y),w=open(x-1,y);
  if(!n&&!s&&!e&&!w)corners++;
  if(n&&s){assert(walls.some(p=>p.kind==='rim'&&Math.abs(p.x-x)<.1&&Math.abs(p.y-y)<.1));assert(walls.some(p=>p.kind==='face'&&Math.abs(p.x-x)<.1&&p.y===y));}
 }
 const rails=caveRails(map),ids=new Set(rails.map(p=>p.y*map.w+p.x));assert.equal(caveRails(map),rails);
 for(const p of rails){assert(!solid[p.y*map.w+p.x],'railways remain on walkable ground');assert(caveRailPieces(p.mask).length>0);if([7,11,13,14,15].includes(p.mask))junctions++;}
 if(kind==='mine'){
  assert(rails.length>map.underground!.tracks.length+20,'branches reach upper and eastern workings');
  assert.deepEqual(undergroundResources(map),MINE_LAYER_YIELDS[depth-1].map(p=>p.res));
  const urls=new Set(map.props.filter(p=>p.prop==='oreFace'||p.prop==='mineralNode').map(p=>undergroundPropUrl(map,p.prop,undefined,p.x,p.y)));
  assert.deepEqual([...urls].sort(),undergroundResources(map).map(r=>'/sprites/underground-v4/'+r+'.png').sort(),'all and only this depth’s minerals appear');
 }
 const deco=caveScenery(map);
 for(const p of deco){assert(existsSync('client/public'+p.url));if(p.wall)assert.equal(map.cells[p.y*map.w+p.x],'#');else assert(!solid[p.y*map.w+p.x]);}
 if(kind==='mine')assert(deco.filter(p=>p.url.endsWith('workbench.png')||p.url.endsWith('wheelbarrow.png')||p.url.endsWith('tool-rack.png')).length>=4);
 assert.equal(JSON.stringify(map),before,'visual improvements preserve saved geometry and ore/worker positions');assert(interiorLayoutAccessible(map));maps++;
}
const quarry=buildUnderground({seed:1,kind:'mine',depth:3,levels:3,layered:false}).map;assert.equal(undergroundResources(quarry).length,0);for(const p of quarry.props.filter(p=>p.prop==='oreFace'||p.prop==='mineralNode'))assert.equal(undergroundPropUrl(quarry,p.prop,undefined,p.x,p.y),'/sprites/regions-v3/rock-block.png');
assert(corners>0);assert(junctions>0);console.log(`PASS ${maps} cave/mine layouts: all corner backing, thin walls, depth minerals, quarry rock, connected railway branches/junctions, props and unchanged saved navigation`);
