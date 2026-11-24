import assert from 'node:assert/strict';
import {buildUnderground,UNDERGROUND_SECTIONS} from '../shared/src/underground.js';
import {interiorSolidGrid,interiorLayoutAccessible} from '../shared/src/interiors.js';
import {state,players} from './src/state.js';
import {TileType} from '../shared/src/protocol.js';
import {setTile} from './src/chunks.js';
import {tileIndex} from './src/tiles.js';
import {mineInteriorMap,ensureEnteredEncounter,minesForSave,restoreMines,mineRecAt,mineDebug} from './src/mines.js';
import {enterInterior,exitInterior,changeMineLayer} from './src/interiors.js';
import {buildingLevel} from './src/state.js';
import type {Player} from './src/types.js';
for(const mask of Object.values(UNDERGROUND_SECTIONS)){assert.equal(mask.length,11);for(const row of mask)assert.equal(row.length,11);}
const signatures=new Set<string>();let maps=0;const started=performance.now();
for(let seed=0;seed<24;seed++)for(const kind of ['mine','cave'] as const)for(let depth=1;depth<=3;depth++){
 const options={seed,kind,depth,levels:3,layered:kind==='mine'},a=buildUnderground(options),b=buildUnderground(options);assert.equal(a,b,'cached seeded map');assert(interiorLayoutAccessible(a.map),'every floor, prop and slot is reachable');
 assert(a.map.underground!.sections.length>=6);assert(a.map.underground!.connections.length>=a.map.underground!.sections.length-1);assert(a.map.lairs!.every(p=>!a.solid[p.y*a.map.w+p.x]));assert(a.map.cells.includes(' '),'black solid space separates sections');
 assert(a.map.cells.split('').filter(c=>c==='.').length<49*49*.65,'connected sections rather than a filled rectangle');
 assert(!a.solid[a.map.spawn.y*a.map.w+a.map.spawn.x]);assert(a.map.props.filter(p=>p.prop==='lamp').length>=a.map.underground!.sections.length-1);
 if(kind==='mine'){assert(a.map.props.some(p=>p.prop==='oreFace'));assert.equal(a.map.props.some(p=>p.prop==='mineShaft'),depth<3);assert(a.map.slots.length>=3);}
 if(kind==='cave'&&depth===1)signatures.add(a.map.cells);maps++;
}
assert(signatures.size>=20,'layouts shuffle by seed');
for(let seed=0;seed<12;seed++){const a=buildUnderground({kind:'mine',seed,depth:1,levels:1,layered:true}).map,b=buildUnderground({kind:'mine',seed,depth:1,levels:3,layered:true}).map;assert.equal(a.cells,b.cells,'upgrades retain existing floor geometry');assert.deepEqual(a.props.filter(p=>p.prop==='oreFace'),b.props.filter(p=>p.prop==='oreFace'),'ore faces stay aligned after deeper shafts open');}

// Runtime map, combat map, view map and saved seed share exactly the same geometry.
state.worldNoiseSalt=20261124;const tx=20,ty=20;setTile(tileIndex(tx,ty),TileType.IronMinePost);buildingLevel.set(`${tx},${ty}`,3);
mineDebug({sync:true});const map=mineInteriorMap(tx,ty,3,0),r=mineRecAt(tx,ty)!;assert(r.layoutSeed!==undefined);assert(map.map.underground);const saved=minesForSave(),sig=map.map.cells;
restoreMines(saved);assert.equal(mineInteriorMap(tx,ty,3,0).map.cells,sig);assert.equal(mineRecAt(tx,ty)!.layoutSeed,r.layoutSeed);
const messages:any[]=[];const p={id:'underground-test',profileKey:'underground-test',clan:0,hp:100,dead:false,input:{dx:0,dy:0},socket:{OPEN:1,readyState:1,send:(s:string)=>messages.push(JSON.parse(s))}} as unknown as Player;players.set(p.id,p);
assert.equal(enterInterior(p,tx,ty),'');assert.equal(messages.filter(m=>m.type==='interior').at(-1).view.map.cells,sig);changeMineLayer(p,1);assert.equal(p.interior!.variant,1);const lower=messages.filter(m=>m.type==='interior').at(-1).view.map;assert.notEqual(lower.cells,sig);changeMineLayer(p,0);assert.equal(messages.filter(m=>m.type==='interior').at(-1).view.map.cells,sig);exitInterior(p);
// Old saved records retain their old compact maps and positions.
restoreMines(saved.map(({layoutSeed,...old})=>old));assert(!mineInteriorMap(tx,ty,3,0).map.underground);assert(mineInteriorMap(tx,ty,3,0).map.w<49);
setTile(tileIndex(30,30),TileType.CaveEntrance);const c=ensureEnteredEncounter(30,30)!;assert(c.layoutSeed!==undefined);const cave=mineInteriorMap(30,30,1,0);assert.equal(cave.map.underground?.kind,'cave');const cs=minesForSave();c.layers[0].mobs[0].hp-=2;const hp=c.layers[0].mobs[0].hp;restoreMines(minesForSave());assert.equal(mineRecAt(30,30)!.layers[0].mobs[0].hp,hp);assert.equal(mineInteriorMap(30,30,1,0).map.cells,cave.map.cells);
players.delete(p.id);console.log(`PASS ${maps} shuffled modular layouts, sections/routes/slots/ore/ladders, per-depth variation, shared runtime views, seed/health save-load and legacy layouts (${Math.round(performance.now()-started)}ms)`);process.exit(0);
