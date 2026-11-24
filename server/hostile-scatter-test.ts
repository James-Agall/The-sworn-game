import assert from 'node:assert/strict';
import {buildUnderground} from '../shared/src/underground.js';
import {buildRuin} from '../shared/src/ruins.js';
import {encounterEnemies} from '../shared/src/encounters.js';
import {interiorLayoutAccessible} from '../shared/src/interiors.js';
import {HOSTILE_POPULATION,interiorMonsterScale} from '../shared/src/hostileScatter.js';
import {undergroundPropSize} from '../shared/src/undergroundArt.js';
import {ruinPropArt} from '../shared/src/ruinArt.js';
import {TileType} from '../shared/src/protocol.js';
import {setTile} from './src/chunks.js';
import {tileIndex} from './src/tiles.js';
import {ensureEnteredEncounter,minesForSave,restoreMines,mineRecAt,mineInteriorMap,updateMines} from './src/mines.js';
import {state} from './src/state.js';
let checked=0;
for(const kind of ['cave','ruin'] as const)for(let n=0;n<(kind==='cave'?24:4);n++){
 const {map:m,solid}=kind==='cave'?buildUnderground({kind,seed:n,depth:1}):buildRuin(n);
 assert(interiorLayoutAccessible(m));assert.equal(m.lairs!.length,HOSTILE_POPULATION);assert.equal(encounterEnemies(kind).length,HOSTILE_POPULATION);
 assert(m.props.filter(p=>p.prop==='crates').length>=(kind==='cave'?12:10),'scattered colliding box piles');
 for(const p of m.props.filter(p=>p.prop==='crates')){assert(solid[p.y*m.w+p.x]);assert(Math.hypot(p.x-m.spawn.x,p.y-m.spawn.y)>=5);assert(Math.hypot(p.x-m.exit.x,p.y-m.exit.y)>=5);if(m.ruin)assert.notEqual(m.ruin.surfaces[p.y*m.w+p.x],'p');}
 for(const [i,p]of m.lairs!.entries()){assert(!solid[p.y*m.w+p.x]);assert(Math.hypot(p.x-m.spawn.x,p.y-m.spawn.y)>=8);assert(Math.hypot(p.x-m.exit.x,p.y-m.exit.y)>=8);for(const q of m.lairs!.slice(0,i))assert(Math.hypot(q.x-p.x,q.y-p.y)>=3,'separate monster positions');}
 if(m.ruin)for(const a of m.ruin.areas.filter(a=>a.role!=='gatehouse'))assert(m.lairs!.some(p=>p.x>=a.x&&p.y>=a.y&&p.x<a.x+a.w&&p.y<a.y+a.h),'guards distributed across rooms and courts');
 else for(const a of m.underground!.landmarks.filter(a=>a.id>0))assert(m.lairs!.some(p=>Math.hypot(p.x-a.x,p.y-a.y)<=6),'all cave galleries populated');checked++;
}
assert.equal(interiorMonsterScale('skeleton')*8.5*3.5,25);assert(interiorMonsterScale('caveSpider')*6.5*3.5<20);assert(interiorMonsterScale('giantSpider')*8.5*3.5>32);assert.equal(undergroundPropSize('crates').h,ruinPropArt('crates')!.h);assert(ruinPropArt('sarcophagus')!.w<=1.25);assert(ruinPropArt('statue')!.h>1.5);
for(const [tile,x,y]of [[TileType.CaveEntrance,30,30],[TileType.RuinEntrance,16,27]]){setTile(tileIndex(x,y),tile);const r=ensureEnteredEncounter(x,y)!;assert.equal(r.layers[0].mobs.length,12);r.layers[0].mobs[0].hp-=2;r.layers[0].mobs.pop();}
const legacy=minesForSave().map(({encounterContentVersion,...r})=>({...r,layers:r.layers.map(L=>({...L,mobs:L.mobs.slice(0,3)}))})),gold=state.stock.gold;restoreMines(legacy);
for(const old of legacy){const [x,y]=old.key.split(',').map(Number),r=mineRecAt(x,y)!,grid=mineInteriorMap(x,y,1,0);assert.equal(r.encounterContentVersion,1);assert.equal(r.layers[0].mobs.length,10,'three survivors plus seven new guards, preserving two prior kills');assert.equal(r.layers[0].mobs[0].hp,old.layers[0].mobs[0].hp);assert.equal(r.layers[0].mobs[0].kind,old.layers[0].mobs[0].kind);for(const m of r.layers[0].mobs)assert(!grid.solid[m.y*grid.map.w+m.x]);}
assert.equal(state.stock.gold,gold);const saved=minesForSave();restoreMines(saved);assert.deepEqual(minesForSave(),saved,'upgrade applies once, preserving positions and health');const positions=JSON.stringify(minesForSave());for(let n=0;n<30;n++){state.cycleTick++;updateMines();}assert.equal(JSON.stringify(minesForSave()),positions,'empty locations keep AI dormant');
const cleared=saved.map(({encounterContentVersion,...r})=>({...r,layers:r.layers.map(L=>({...L,status:'cleared' as const,mobs:[]}))}));restoreMines(cleared);for(const r of minesForSave()){assert.equal(r.layers[0].status,'cleared');assert.equal(r.layers[0].mobs.length,0,'cleared locations do not respawn');}assert.equal(state.stock.gold,gold);
console.log(`PASS ${checked} cave/ruin populations, crates, open routes, full-area coverage, hero-relative sizing and one-time population upgrade preserving deaths/HP/cleared state/dormancy`);process.exit(0);
