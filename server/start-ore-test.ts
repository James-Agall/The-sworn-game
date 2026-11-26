// Mining rework (2026-11-26): world gen no longer makes the six deposit veins, and the first Town Center always has
// at least START_ORE_MIN (2) iron ore outcrops within START_ORE_RADIUS_TILES (20, Euclidean): on open ground reachable
// on foot from the Town Center, off reserved / owned grounds. Generates real worlds in-process (no server, no saves)
// at sizes 80, 160, 512 and 1024 over several seeds. Run from the repo root: `cd server && npx tsx start-ore-test.ts`.
import assert from 'node:assert/strict';
import {TileType,isSolidTile} from '../shared/src/protocol.js';
import {START_ORE_MIN,START_ORE_RADIUS_TILES} from '../shared/src/mines.js';
import {state,clans} from './src/state.js';
import {withClan} from './src/clans.js';
import {tileIndex,inBounds,ownerAt} from './src/tiles.js';
import {generateWorld,setWorldSize,isInReservedGrounds} from './src/worldgen.js';
import {WORLDGEN_VERSION} from './src/worldbase.js';

const DEPOSITS=[TileType.CoalSeam,TileType.CopperOre,TileType.TinOre,TileType.Limestone,TileType.GoldOre,TileType.LeadOre];
const walk=(x:number,y:number)=>{if(!inBounds(x,y))return false;const t=state.tiles[tileIndex(x,y)] as TileType;return !isSolidTile(t)&&t!==TileType.Water&&t!==TileType.Moat;};
const runs:{size:number;seeds:number[]}[]=[{size:80,seeds:[1,2,3,4,5,6]},{size:160,seeds:[1,2,3,4,5,6]},{size:512,seeds:[11,12,13,14]},{size:1024,seeds:[21,22,23]}];
const started=performance.now();let worlds=0;
// Silence the generators' progress lines; failures still throw.
const log=console.log;console.log=()=>{};
try{
 for(const {size,seeds} of runs)for(const seed of seeds){
  setWorldSize(size);
  await generateWorld(seed,fn=>withClan(clans[0],fn),WORLDGEN_VERSION);
  const tc=state.townCenters[0];assert(tc,`size ${size} seed ${seed}: a Town Center`);
  for(const t of DEPOSITS)assert(!state.tiles.includes(t),`size ${size} seed ${seed}: no retired deposit tile ${t} is generated`);
  // Reachability on foot from around the Town Center (independent of worldgen's own search; not bounded by the radius).
  const reach=new Set<number>(),q:number[]=[];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(walk(tc.x+dx,tc.y+dy)){reach.add(tileIndex(tc.x+dx,tc.y+dy));q.push(tileIndex(tc.x+dx,tc.y+dy));}
  for(let n=0;n<q.length;n++){const x=q[n]%state.WORLD_TILES_X,y=Math.floor(q[n]/state.WORLD_TILES_X);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(Math.abs(nx-tc.x)>60||Math.abs(ny-tc.y)>60||!walk(nx,ny)||reach.has(tileIndex(nx,ny)))continue;reach.add(tileIndex(nx,ny));q.push(tileIndex(nx,ny));}}
  const R=START_ORE_RADIUS_TILES,good:{x:number;y:number}[]=[];
  for(let y=tc.y-R;y<=tc.y+R;y++)for(let x=tc.x-R;x<=tc.x+R;x++){
   if(!inBounds(x,y)||state.tiles[tileIndex(x,y)]!==TileType.IronOre||Math.hypot(x-tc.x,y-tc.y)>R)continue;
   if(isInReservedGrounds(x,y)||ownerAt(tileIndex(x,y))!==0)continue;
   if(![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>reach.has(tileIndex(x+dx,y+dy))))continue;
   good.push({x,y});
  }
  assert(good.length>=START_ORE_MIN,`size ${size} seed ${seed}: ${good.length} reachable iron ore outcrops within ${R} tiles of the Town Center at ${tc.x},${tc.y} (need ${START_ORE_MIN})`);
  worlds++;
 }
 // Same seed, same base: the guarantee is deterministic (streamed saves regenerate their base from the seed).
 setWorldSize(160);await generateWorld(77,fn=>withClan(clans[0],fn),WORLDGEN_VERSION);const a=state.tiles.slice();
 await generateWorld(77,fn=>withClan(clans[0],fn),WORLDGEN_VERSION);assert.deepEqual(state.tiles,a,'one seed always regenerates the same tiles');
}finally{console.log=log;}
console.log(`PASS start ore: >=${START_ORE_MIN} reachable iron ore within ${START_ORE_RADIUS_TILES} tiles of the start and no deposit veins on ${worlds} worlds (sizes ${runs.map(r=>r.size).join('/')}), deterministic per seed (${Math.round(performance.now()-started)}ms)`);
process.exit(0);
