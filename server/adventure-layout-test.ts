import assert from 'node:assert/strict';
import {explorationPlan,BOSS_PROFILES} from '../shared/src/adventure.js';
import {encounterMap} from '../shared/src/encounters.js';
import {buildUnderground} from '../shared/src/underground.js';
import {interiorLayoutAccessible,interiorSolidGrid} from '../shared/src/interiors.js';
import {SPECIAL_CAST} from '../shared/src/specialCast.js';
import {STORIES} from '../shared/src/stories.js';
let rooms=0;
for(const kind of ['camp','cave','ruin'] as const)for(let seed=0;seed<(kind==='cave'?32:4);seed++){
 const base=kind==='cave'?buildUnderground({seed,kind,depth:1}).map:encounterMap(kind,seed).map,p=explorationPlan(base,kind,seed);
 assert(p.objects.some(o=>o.kind==='note'));assert(p.objects.some(o=>o.kind==='key'));assert(p.objects.some(o=>o.kind==='chest'));assert(p.objects.some(o=>o.kind==='cage'));assert(p.lockedRoom,`${kind} ${seed} gets a real locked room`);
 const open={...p.map,props:p.map.props.filter(p=>p.prop!=='adventureGate')};assert(interiorLayoutAccessible(open),'all floors and objects accessible after unlocking');
 const solid=interiorSolidGrid(p.map),w=p.map.w,start=base.spawn.y*w+base.spawn.x,seen=new Set([start]),q=[start];for(let i=0;i<q.length;i++){const a=q[i],x=a%w,y=Math.floor(a/w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=p.map.h||solid[j]||seen.has(j))continue;seen.add(j);q.push(j);}}
 assert(seen.has(base.exit.y*w+base.exit.x),'exit remains reachable while room locked');for(const a of base.lairs??[])assert(seen.has(a.y*w+a.x),'all original enemy lairs remain reachable');for(const o of p.objects.filter(o=>['key','note'].includes(o.kind)))assert(seen.has(o.y*w+o.x),'keys and notes are outside the lock');rooms++;
}
assert.equal(STORIES.length,10);assert.equal(new Set(STORIES.flatMap(s=>s.members)).size,100);
for(const c of SPECIAL_CAST.filter(c=>c.hostile))assert(BOSS_PROFILES[c.id],c.id);
for(const s of STORIES){const used=new Set(s.steps.flatMap(st=>[st.actor,st.target].filter(Boolean)));for(const id of s.members)assert(used.has(id),`${s.id} gives ${id} a real stage`);}
console.log('PASS',rooms,'exploration layouts, locked rooms, reachable keys/notes/lairs/exits, twenty boss profiles and ten stories covering all one hundred characters');
