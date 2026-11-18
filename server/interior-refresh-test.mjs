import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';
if(process.env.INTERIOR_REFRESH_INNER!=='1'){
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 const r=spawnSync(path.join(root,'node_modules/.bin/tsx'),[fileURLToPath(import.meta.url)],{stdio:'inherit',env:{...process.env,INTERIOR_REFRESH_INNER:'1'}});process.exit(r.status??1);
}
const {INTERIOR_TEMPLATES,INTERIOR_UPPER_TEMPLATES,buildInteriorMap,interiorLayoutAccessible}=await import('../shared/src/interiors.ts');
let count=0;
for(const id of Object.keys(INTERIOR_TEMPLATES))for(let level=1;level<=3;level++)for(let variant=0;variant<3;variant++)for(const storey of INTERIOR_UPPER_TEMPLATES[id]?[0,1]:[0]){
 const m=buildInteriorMap(id,level,variant,storey);
 assert(interiorLayoutAccessible(m),`${id} level ${level} variant ${variant} floor ${storey} inaccessible`);
 assert(m.props.every(p=>['n','e','s','w'].includes(p.facing)),`${id} missing facing`);
 assert.equal(JSON.stringify(m),JSON.stringify(buildInteriorMap(id,level,variant,storey)),'deterministic layout');count++;
}
console.log(`PASS ${count} rebuilt interior variants/levels/floors: paths, furniture access, facing and determinism`);
