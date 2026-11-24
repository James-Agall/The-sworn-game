import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {buildRuin} from '../shared/src/ruins.js';
import {interiorLayoutAccessible} from '../shared/src/interiors.js';
import {ruinFloorUrl,ruinScenery,ruinDoorFrames} from '../shared/src/ruinArt.js';
import {TileType} from '../shared/src/protocol.js';
import {setTile} from './src/chunks.js';
import {tileIndex} from './src/tiles.js';
import {ensureEnteredEncounter,minesForSave,restoreMines,mineRecAt,mineInteriorMap} from './src/mines.js';
import {state} from './src/state.js';
for(let v=0;v<4;v++){
 const {map:m,solid}=buildRuin(v);assert.equal(buildRuin(v).map,m);assert(interiorLayoutAccessible(m));assert.equal(m.ruin?.version,2);assert.equal(m.w,41);assert.equal(m.h,37);
 const rooms=m.ruin!.areas.filter(a=>a.type==='room'),courts=m.ruin!.areas.filter(a=>a.type==='courtyard');assert.equal(rooms.length,5);assert.equal(courts.length,2);
 assert.equal(m.ruin!.surfaces.length,m.cells.length);assert(m.cells.includes(' '),'separate structural wings and void space');
 for(const a of rooms){assert.equal(m.cells[(a.y+1)*m.w+a.x-1],'#');assert.equal(m.cells[(a.y+1)*m.w+a.x-2],'#','two-cell room walls');}
 for(const d of m.ruin!.doors)for(let n=0;n<d.width;n++)assert(!solid[(d.y+(d.axis==='x'?n:0))*m.w+d.x+(d.axis==='y'?n:0)],'doors stay open at full width');
 assert(m.lairs!.every(p=>!solid[p.y*m.w+p.x]));assert(!solid[m.exit.y*m.w+m.exit.x]);
 const surfaces=new Set<string>();for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(!['#',' '].includes(m.cells[y*m.w+x]))surfaces.add(ruinFloorUrl(m,x,y));assert.equal(surfaces.size,3);for(const u of surfaces)assert(existsSync('client/public'+u));
 if(rooms.some(a=>['crypt','ossuary'].includes(a.role)))assert(m.props.filter(p=>p.prop==='sarcophagus').length>=3);
 for(const p of m.props.filter(p=>['sarcophagus','ruinColumn'].includes(p.prop)))assert(solid[p.y*m.w+p.x],'large furnishings have real collision');
 const before=JSON.stringify(m),dressing=ruinScenery(m);assert(dressing.length<=21,'limited edge decoration');for(const p of dressing){assert(!solid[p.y*m.w+p.x]);assert.notEqual(m.ruin!.surfaces[p.y*m.w+p.x],'p','main paths remain uncluttered');assert(existsSync('client/public'+p.url),p.url);}assert.equal(JSON.stringify(m),before);
 assert.equal(ruinDoorFrames(m).length,2);for(const p of ruinDoorFrames(m))assert(existsSync('client/public'+p.url),p.url);
}
// Upgrade an old visited ruin without respawning dead enemies or paying rewards again.
setTile(tileIndex(16,27),TileType.RuinEntrance);setTile(tileIndex(5,13),TileType.RuinSideEntrance);const r=ensureEnteredEncounter(16,27)!;assert.equal(mineRecAt(5,13),r);
r.layers[0].mobs[0].hp-=2;r.layers[0].mobs.pop();const hp=r.layers[0].mobs[0].hp,count=r.layers[0].mobs.length,gold=state.stock.gold;
const legacy=minesForSave().map(({ruinLayoutVersion,...e})=>e);legacy[0].layers[0].mobs[0].x=5;legacy[0].layers[0].mobs[0].y=7;restoreMines(legacy);
const current=mineRecAt(16,27)!,grid=mineInteriorMap(16,27,1,0);assert.equal(current.ruinLayoutVersion,2);assert.equal(current.layers[0].mobs.length,count);assert.equal(current.layers[0].mobs[0].hp,hp);assert.equal(state.stock.gold,gold);for(const m of current.layers[0].mobs)assert(!grid.solid[m.y*grid.map.w+m.x]);
const first=current.layers[0].mobs[0],at=grid.map.lairs![0];const near=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:at.x+dx,y:at.y+dy})).find(p=>!grid.solid[p.y*grid.map.w+p.x])!;first.x=near.x;first.y=near.y;restoreMines(minesForSave());assert.equal(mineRecAt(16,27)!.layers[0].mobs[0].x,near.x,'migrates only once');
const cleared=minesForSave().map(({ruinLayoutVersion,...e})=>e);cleared[0].layers[0]={status:'cleared',mobs:[],clearedDay:123,rollDay:234};restoreMines(cleared);assert.equal(mineRecAt(16,27)!.layers[0].status,'cleared');assert.equal(mineRecAt(16,27)!.layers[0].mobs.length,0);assert.equal(mineRecAt(16,27)!.layers[0].clearedDay,123);assert.equal(state.stock.gold,gold);
console.log('PASS four room/courtyard ruins, thick walls, full-width doors, real furniture collision, sparse scenery, connected routes and one-time save migration preserving health/kills/rewards');process.exit(0);
