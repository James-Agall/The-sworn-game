import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {SPECIAL_CAST,SPECIAL_BY_ID,SPECIAL_SHEETS,specialFrameIndex} from '../shared/src/specialCast.js';
import {interiorSolidGrid} from '../shared/src/interiors.js';
import {TileType,TILE_SIZE} from '../shared/src/protocol.js';
import {encounterKind} from '../shared/src/encounters.js';
import {generateWorld} from './src/worldgen.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {specialResidences,resetSpecialResidences,specialAt} from './src/specialCast.js';
import {ensureEnteredEncounter,minesForSave,restoreMines,mineRecAt,mineHeroAttack,specialCharacterDefeated} from './src/mines.js';
import {tryEnterAtDoor,exitInterior,interiorInteract} from './src/interiors.js';
import {startTalk,handleDialogueChoice,lifeOf} from './src/herolife.js';
import {placedFootprint} from './src/tiles.js';
import {state,players,mobs} from './src/state.js';
import type {Player} from './src/types.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();await generateWorld(42);resetSpecialResidences();
assert.equal(SPECIAL_CAST.length,100);assert.equal(SPECIAL_BY_ID.size,100);assert.equal(new Set(SPECIAL_CAST.map(c=>c.name)).size,100);assert.equal(SPECIAL_CAST.filter(c=>c.hostile).length,20);
for(const c of SPECIAL_CAST){assert(SPECIAL_BY_ID.has(c.connection));assert.notEqual(c.id,c.connection);assert(c.bio.length>35&&c.hook.length>20);assert(c.height>=18&&c.height<=42);}
for(const sheet of SPECIAL_SHEETS){const file=`client/public/sprites/special-cast/${sheet}.png`;assert(existsSync(file));const b=readFileSync(file);assert.equal(b.readUInt32BE(16),960);assert.equal(b.readUInt32BE(20),960);assert.equal(b[25],6,'RGBA artwork');}
assert.equal(specialFrameIndex('walk',0),2);assert.equal(specialFrameIndex('walk',580),2);assert.equal(specialFrameIndex('hurt',999),9);
const homes=specialResidences();assert.equal(homes.length,100,'all characters get an actual world home');assert.deepEqual(specialResidences(),homes);assert(![...mobs.values()].some(m=>m.id.startsWith('special:')),'no hundred-agent overworld population');
const messages:any[]=[],p={id:'cast-test',profileKey:'cast-test',clan:0,nickname:'Test',hp:100,dead:false,attackCooldownTicks:0,input:{dx:0,dy:0},socket:{OPEN:1,readyState:1,send:(s:string)=>messages.push(JSON.parse(s))}} as unknown as Player;players.set(p.id,p);
let residents=0;for(const home of homes.filter(h=>!h.hostile)){
 const fp=placedFootprint(home.tx,home.ty);p.x=(home.tx+Math.floor(fp.w/2)+.5)*32;p.y=(home.ty+fp.h+.5)*32;p.interior=undefined;assert(tryEnterAtDoor(p,false),home.place);
 const v=messages.filter(m=>m.type==='interior'&&m.view).at(-1)?.view;assert(v,home.place);assert(p.interior,home.id+JSON.stringify(messages.slice(-3)));assert.equal(v.key,home.tx+','+home.ty,home.id+' wrong door');const n=v.npcs.find((n:any)=>n.specialId===home.id);assert(n,'resident present: '+home.id);const solid=interiorSolidGrid(v.map);assert(!solid[n.y*v.map.w+n.x]);residents++;
 p.interior!.x=(n.x+.5)*32;p.interior!.y=(n.y+.5)*32;interiorInteract(p);assert(messages.some(m=>m.type==='dialogue'&&m.dialogue?.npc.name===n.name));exitInterior(p);
}
const inside={key:'test',x:16,y:16,anchor:{x:0,y:0}};p.interior={key:'test',x:16,y:16} as any;
function talk(id:string){const c=SPECIAL_BY_ID.get(id)!;startTalk(p,{specialId:id,name:c.name,role:'villager',d:0,inside});return messages.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)!.dialogue;}
function choose(text:string){const d=messages.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)!.dialogue,i=d.choices.findIndex((c:any)=>c.label.includes(text));assert(i>=0,text);handleDialogueChoice(p,i);return messages.filter(m=>m.type==='dialogue'&&m.dialogue).at(-1)!.dialogue;}
const child=talk('pip-reed');assert(!child.choices.some((c:any)=>/court|marry|betroth/i.test(c.label)));assert(lifeOf(p).flags['cast:met:pip-reed']);
const worker=SPECIAL_CAST.find(c=>c.group==='masters'&&c.questKind==='supply'&&c.good==='iron')!;talk(worker.id);choose('Can I help?');lifeOf(p).pack.iron=worker.count;const gold=state.stock.gold;choose('Claim');assert.equal(state.stock.gold,gold+worker.reward);assert.equal(lifeOf(p).pack.iron,0);choose('Our favour');assert.equal(state.stock.gold,gold+worker.reward,'one-time rewards');choose('Teach me');assert(lifeOf(p).flags[`cast:${worker.id}:lesson`]);
p.interior=undefined;let bosses=0;for(const home of homes.filter(h=>h.hostile)){
 const r=ensureEnteredEncounter(home.tx,home.ty)!;const before=r.encounter==='camp'?6:12;assert.equal(r.layers[0].mobs.length,before,'bosses replace guards');const m=r.layers[0].mobs.find(m=>m.specialId===home.id);assert(m,home.id+' placed');bosses++;
}
const saved=minesForSave();restoreMines(saved);assert.deepEqual(minesForSave(),saved,'named bosses preserve identity, health and position on reload');
const killedHome=homes.find(h=>h.hostile)!,r=mineRecAt(killedHome.tx,killedHome.ty)!,boss=r.layers[0].mobs.find(m=>m.specialId===killedHome.id)!;boss.hp=1;
p.x=(killedHome.tx+.5)*32;p.y=(killedHome.ty+1.5)*32;assert(tryEnterAtDoor(p,false));p.interior!.x=(boss.x+.5)*32;p.interior!.y=(boss.y+.5)*32;p.attackCooldownTicks=0;mineHeroAttack(p);assert(specialCharacterDefeated(killedHome.id));const after=minesForSave();restoreMines(after);ensureEnteredEncounter(killedHome.tx,killedHome.ty);assert(specialCharacterDefeated(killedHome.id));assert(!mineRecAt(killedHome.tx,killedHome.ty)!.layers[0].mobs.some(m=>m.specialId===killedHome.id),'boss stays defeated');
console.log(`PASS 100 identities, 100 homes, ${residents} accessible residents, 20 native bosses, ten transparent animation atlases, personal dialogue/favours/lessons, child dialogue, one-time rewards, boss save/reload/death persistence`);process.exit(0);
