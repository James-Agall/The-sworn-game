// Self-contained character creator integration test. Uses a private port and scratch saves.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';
const dir=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.env.PORT)||await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
assert.notEqual(port,8080);
const child=spawn(dir+'../node_modules/.bin/tsx',['src/index.ts'],{cwd:dir,env:{...process.env,PORT:String(port),COLONY_SAVE_DIR:mkdtempSync(tmpdir()+'/appearance-'),COLONY_TEST_HOOKS:'1',COLONY_WORLD_SIZE:'80',COLONY_UNLOCK_ALL:'1'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<500;i++){if(fn())return;await sleep(20);}throw Error('Timed out: '+label);}
const clients=[];
async function connect(key){
 const c={welcome:null,snap:null,hooks:new Map(),events:[],saves:[],profile:null};clients.push(c);
 for(let i=0;i<100;i++){const ws=new WebSocket(`ws://127.0.0.1:${port}/?profile=${key}`);c.ws=ws;
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')c.welcome=m;if(m.type==='snapshot'){c.snap=m;if(m.profile)c.profile=m.profile;}if(m.type==='event')c.events.push(m.text);if(m.type==='testHookResult')c.hooks.set(m.op,m);if(m.type==='saveResult')c.saves.push(m);});
  if(await new Promise(r=>{ws.once('open',()=>r(true));ws.once('error',()=>r(false));}))break;await sleep(100);
 }
 c.send=m=>c.ws.send(JSON.stringify(m));
 c.hook=async(op,args={})=>{c.hooks.delete(op);c.send({type:'testHook',op,...args});await until(()=>c.hooks.has(op),op);return c.hooks.get(op);};
 c.act=async m=>{c.send(m);return c.hook('heroState');};
 await until(()=>c.welcome&&c.snap,'connect');return c;
}
try{
 const a=await connect('creator-a'),b=await connect('creator-b');
 await a.hook('setRaids',{enabled:false});await a.hook('ignorePlayers',{value:true});
 let hs=await a.act({type:'setHeroAppearance',appearance:{name:'  Mira <script>\n',gender:'f',build:100,face:-2,hair:3.8,hairColor:Infinity,skin:9,horse:'invalid'}});
 assert.deepEqual(hs.profile.appearance,{name:'Mira script',gender:'f',build:2,face:0,hair:3,hairColor:1,skin:4,look:'wanderer',horse:'bay'});
 hs=await a.act({type:'setHeroAppearance',appearance:null});assert.equal(hs.profile.appearance.name,'Mira script');hs=await a.act({type:'setHeroAppearance',appearance:{}});assert.equal(hs.profile.appearance.name,'Wanderer');assert.equal(hs.profile.appearance.build,1);
 const appearance={name:'Mira Storm',gender:'f',build:0,face:2,hair:3,hairColor:3,skin:2,horse:'grey',look:'wanderer'};
 hs=await a.act({type:'setHeroAppearance',appearance});assert.deepEqual(hs.profile.appearance,appearance);
 await until(()=>b.snap.players.find(p=>p.id===a.welcome.id)?.visual?.appearance.name===appearance.name,'remote appearance');
 console.log('PASS validated fields, defaults and multiplayer appearance');
 await a.hook('setEquipment',{armour:[10,10,10],weapon:[10,10,10]});
 const take=async(slot,tier,extra={})=>{hs=await a.act({type:'takeFromArmoury',slot,tier,...extra});return hs.profile.inventory.at(-1);};
 const helm=await take('armour',1,{armourPart:'head'}),body=await take('armour',2,{armourPart:'chest'}),shield=await take('armour',3,{armourPart:'offhand'});
 assert.deepEqual((await a.hook('equipState')).equipment.armour,[9,9,9]);assert.equal(helm.kind,'helm');assert.equal(shield.kind,'shield');
 const bow=await take('weapon',1,{weaponKind:'bow'}),axe=await take('weapon',2,{weaponKind:'axe'});
 await a.act({type:'equipItem',itemId:helm.id,slot:'head'});await a.act({type:'equipItem',itemId:body.id,slot:'chest'});
 hs=await a.act({type:'equipItem',itemId:shield.id,slot:'offhand'});const before=JSON.stringify(hs.profile);
 hs=await a.act({type:'equipItem',itemId:bow.id,slot:'weapon'});assert.equal(JSON.stringify(hs.profile),before);assert.match(hs.events.at(-1).detail,/both hands/);
 await a.act({type:'unequipItem',slot:'offhand'});hs=await a.act({type:'equipItem',itemId:bow.id,slot:'weapon'});const before2=JSON.stringify(hs.profile);
 hs=await a.act({type:'equipItem',itemId:shield.id,slot:'offhand'});assert.equal(JSON.stringify(hs.profile),before2);assert.match(hs.events.at(-1).detail,/both hands/);
 const count=hs.profile.inventory.length;await take('weapon',1,{weaponKind:'staff'});assert.equal(hs.profile.inventory.length,count);
 await a.act({type:'unequipItem',slot:'weapon'});const unarmed=await a.hook('heroState');
 hs=await a.act({type:'equipItem',itemId:axe.id,slot:'weapon'});assert.equal(hs.profile.equipment.weapon.kind,'axe');assert.equal(hs.cooldownTicks,Math.round(unarmed.cooldownTicks*1.25));
 await a.act({type:'equipItem',itemId:shield.id,slot:'offhand'});
 await until(()=>{const v=b.snap.players.find(p=>p.id===a.welcome.id)?.visual;return v?.weapon==='axe'&&v?.shieldTier===3&&v?.helmTier===1&&v?.armour===2;},'remote gear tiers');
 for(const [relicId,slot] of [['vhorrunStride','legs'],['abbeyEmberstaff','weapon']]){const item=(await a.hook('grantRelic',{relicId})).item;const before=JSON.stringify((await a.hook('heroState')).profile);hs=await a.act({type:'equipItem',itemId:item.id,slot});assert.equal(JSON.stringify(hs.profile),before);}
 console.log('PASS armoury stock, four gear slots, bow/shield refusal in both orders, axe cooldown, remote gear');
 // Exercise actual combat damage, not just an item label.
 const tc=a.snap.townCenters[0],dummy=await a.hook('spawnMob',{kind:'troll',tx:tc.x-8,ty:tc.y+6});
 await until(()=>a.snap.mobs.some(m=>m.id===dummy.id),'dummy');const mob=a.snap.mobs.find(m=>m.id===dummy.id);
 await a.hook('teleportPlayer',{x:mob.x,y:mob.y});await a.act({type:'attack'});
 hs=await a.hook('heroState');const hit=hs.events.filter(e=>e.type==='hit'&&e.detail===dummy.id).at(-1);
 assert.ok(hit);assert.ok(Math.abs(hit.amount-15*1.25*hs.profile.stats.damageMult)<1e-6);
 await a.hook('damageMob',{mobId:dummy.id,amount:1e7});
 console.log('PASS axe deals a slower, harder hit');
 const saved=JSON.stringify(hs.profile);a.send({type:'saveGame',slot:'slot1'});await until(()=>a.saves.length===1,'save');assert.ok(a.saves[0].ok);
 await a.act({type:'setHeroAppearance',appearance:{name:'Changed'}});await a.act({type:'unequipItem',slot:'head'});
 a.send({type:'loadGame',slot:'slot1'});await until(()=>a.saves.length===2,'load');assert.ok(a.saves[1].ok);
 hs=await a.hook('heroState');assert.equal(JSON.stringify(hs.profile),saved);
 await until(()=>a.profile?.appearance.name===appearance.name,'loaded profile snapshot');
 console.log('PASS save/load restores all appearance choices and equipped tiers');
 console.log('ALL PASS');
}catch(e){console.error(logs.slice(-1500));throw e;}finally{for(const c of clients)c.ws?.close();child.kill('SIGTERM');}
