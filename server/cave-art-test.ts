import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {buildUnderground} from '../shared/src/underground.js';
import {caveScenery} from '../shared/src/caveScenery.js';
import {CAVE_WALL_ART,undergroundFloorUrl,undergroundPropUrl,undergroundPropSize} from '../shared/src/undergroundArt.js';
import {interiorSolidGrid,interiorLayoutAccessible} from '../shared/src/interiors.js';
for(const u of Object.values(CAVE_WALL_ART))assert(existsSync('client/public'+u),u);
for(let seed=1;seed<=20;seed++)for(const kind of ['cave','mine'] as const){
 const {map,solid}=buildUnderground({seed,kind,depth:2,levels:3,layered:kind==='mine'});const before=solid.slice();assert.equal(map.floor,'stone');assert(existsSync('client/public'+undergroundFloorUrl(map)));const d=caveScenery(map);assert.equal(caveScenery(map),d);assert(d.length>=map.underground!.sections.length*3,'richer dressing in every generated level');
 for(const a of d){assert(!solid[a.y*map.w+a.x]);assert(existsSync('client/public'+a.url));assert(Math.hypot(a.x-map.spawn.x,a.y-map.spawn.y)>=3);assert(!map.props.some(p=>p.x===a.x&&p.y===a.y));}
 assert.deepEqual(interiorSolidGrid(map),before,'dressing does not alter collision or saved combat positions');assert(interiorLayoutAccessible(map));
 for(const p of map.props){const u=undergroundPropUrl(map,p.prop);if(u)assert(existsSync('client/public'+u));}
 assert(undergroundPropSize('rockBlock').h>=2);assert(undergroundPropSize('stalagmite').w>1);
}
console.log('PASS cave stone/cliff/formation assets, deterministic richer decoration, clear entries and unchanged collision across 40 layouts');
