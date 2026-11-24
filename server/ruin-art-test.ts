import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {buildUnderground} from '../shared/src/underground.js';
import {undergroundEntrance} from '../shared/src/undergroundArt.js';
import {encounterMap} from '../shared/src/encounters.js';
import {ruinScenery,ruinPropArt,ruinEntrance,RUIN_WALL_ART,RUIN_FLOOR_URL} from '../shared/src/ruinArt.js';
import {caveWallPieces} from '../shared/src/caveWalls.js';
for(const kind of ['mine','cave'] as const){
 const m=buildUnderground({kind,seed:42,depth:1,levels:3,layered:kind==='mine'}).map,e=undergroundEntrance(m),url=e.sprites[0].url;
 assert.equal(url,kind==='mine'?'/sprites/underground-v5/mining-adit.png':'/sprites/ruins-v1/cave-opening.png');assert(existsSync('client/public'+url));assert.equal(m.cells[m.exit.y*m.w+m.exit.x],'E');
 assert(e.sprites[0].y+e.sprites[0].h===m.exit.y+1,'art threshold matches existing exit');
}
for(const u of [...Object.values(RUIN_WALL_ART),RUIN_FLOOR_URL])assert(existsSync('client/public'+u));
for(let v=0;v<4;v++){
 const {map,solid}=encounterMap('ruin',v),before=JSON.stringify(map),d=ruinScenery(map);assert.equal(d,ruinScenery(map));assert(d.length>=5&&d.length<=21,'sparse decoration around real furnished rooms');
 for(const p of d){assert(existsSync('client/public'+p.url),p.url);assert(!solid[p.y*map.w+p.x]);assert(Math.hypot(p.x-map.spawn.x,p.y-map.spawn.y)>3);assert(!map.lairs!.some(l=>Math.hypot(l.x-p.x,l.y-p.y)<2));}
 if(map.ruin!.areas.some(a=>['crypt','ossuary'].includes(a.role)))assert(map.props.some(p=>p.prop==='sarcophagus'));assert(existsSync('client/public/sprites/ruins-v1/column-rubble.png'));assert(d.some(p=>p.url.endsWith('broken-statue.png'))||map.props.some(p=>ruinPropArt(p.prop)?.url.endsWith('broken-statue.png')));
 assert(caveWallPieces(map).filter(p=>p.kind==='body').length===map.cells.split('').filter(c=>c==='#').length,'all ruin wall joints backed');
 for(const p of map.props){const a=ruinPropArt(p.prop);if(a)assert(existsSync('client/public'+a.url));}
 assert(existsSync('client/public'+ruinEntrance(map).sprites[0].url));assert.equal(JSON.stringify(map),before,'scenery keeps saved geometry, props and enemy locations');
}
console.log('PASS mine-only approved adit, natural cave entry, four populated ruin styles, assets, wall joints and unchanged saved collision/encounters');
