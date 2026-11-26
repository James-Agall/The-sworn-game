// Roads across marsh water (ROAD-WATER-2026-11-26.md). Runs road-water-regression.mts at world sizes 160, 512 and
// 1024, once at worldgen version 22 (before the fix) and once at 23, then compares them seed by seed: version 23 has
// no road causeways over water (asserted inside the .mts) and keeps every road tile, the road network's pieces, its
// largest piece and every settlement it reached. Generation only: no game server is booted.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run=(size,version)=>new Promise((resolve,reject)=>{
 const saveDir=mkdtempSync(path.join(os.tmpdir(),'colony-road-water-'));
 const proc=spawn(process.execPath,['--import','tsx','road-water-regression.mts'],{cwd:import.meta.dirname,stdio:['ignore','pipe','inherit'],
  env:{...process.env,COLONY_TEST_HOOKS:'1',COLONY_SAVE_DIR:saveDir,COLONY_WORLD_SIZE:String(size),ROAD_WATER_VERSION:String(version)}});
 let out='';proc.stdout.on('data',d=>out+=d);
 proc.on('close',code=>{rmSync(saveDir,{recursive:true,force:true});
  const rows=out.split('\n').filter(l=>l.startsWith('ROADWATER ')).map(l=>JSON.parse(l.slice(10)));
  if(code!==0){process.stdout.write(out);reject(new Error(`size ${size} version ${version} exited ${code}`));}else resolve(rows);});
});
let failures=0;
for(const size of [160,512,1024]){
 const before=await run(size,22),after=await run(size,23);
 assert.equal(after.length,before.length,'same seeds at both versions');
 let causewaysBefore=0;
 for(let k=0;k<after.length;k++){
  const b=before[k],a=after[k];
  causewaysBefore+=b.causeway+b.water3;
  console.log(`${size} seed ${a.seed}: causeways ${b.causeway} -> ${a.causeway}, 3+ water ${b.water3} -> ${a.water3}, road ${b.road} -> ${a.road}, bridges ${b.bridge} -> ${a.bridge}, dry bridges ${b.dryBridge} (lonely ${b.lonelyBridge}) -> ${a.dryBridge} (lonely ${a.lonelyBridge}), pieces ${b.components} -> ${a.components}, largest ${b.largest} -> ${a.largest}, settlements linked ${b.linked}/${b.settlements} -> ${a.linked}/${a.settlements}`);
  try{
   assert(a.road+a.bridge>=b.road+b.bridge,'no road tile lost');
   assert(a.components<=b.components,'the road network is not split into more pieces');
   assert(a.largest>=b.largest,'the main road network does not shrink');
   assert(a.linked>=b.linked,'every settlement the roads reached is still reached');
   assert(a.townCentreLinked||!b.townCentreLinked,'the start stays on the road network');
  }catch(e){failures++;console.log('FAIL',e.message);}
 }
 // The old generator really did lay causeways at the larger sizes: the comparison above is not vacuous.
 if(size>=512)assert(causewaysBefore>0,`version 22 had causeways at ${size}`);
}
assert.equal(failures,0);
console.log('PASS road-water: no road causeways over water at version 23 (160/512/1024, 6 seeds); road tiles, network pieces and settlement links kept');
process.exit(0);
