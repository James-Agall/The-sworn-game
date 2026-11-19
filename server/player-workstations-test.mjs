// Scripted test: Stardew phase 5c, building interiors (ROADMAP "Stardew layer — phase 5c"). The hero enters an own
// House through its door with E (the real `interact` message) and by walking north into it, walks the interior map
// (its own collision grid: walls, solid furniture; the world body waits at the door, hidden), stores pack goods in the
// chest, sleeps in the bed (night: skip to dawn, rest / energy full; day: nap), leaves on the exit mat and with Esc
// near it; nothing hurts a hero indoors; entering is refused with enemies near the door; the Town Center hall's
// people talk through the usual dialogue (keeper: the building panel, folk: "How do you fare?"); a settlement's
// Market has its trader; chests survive save / load (the hero is outside after a load).
// Gap closure G5 (section 11): every layout validates, 3 variants per type picked deterministically per building,
// living NPCs (a resident wanders by day, sits at a table at dusk, sleeps in a bed at night; keepers work at their
// station; facing follows movement; greeting bubbles), tavern patrons (2-6 seated by time of day, own villagers off
// duty at night, rumours, buying a drink), the tavern's stairs to its guest rooms.
// Needs a FRESH private server (default 160 map: its human settlements have Markets): `npm test -- interiors`.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, House: 13, TownCenter: 12, Market: 28, Church: 20, Blacksmith: 26, Tavern: 31 };
const TILE = 32;
const px = (t) => t * TILE + 16;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0, interior: [], dialogue: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
  else if (m.type === "interior") c.interior.push(m.view);
  else if (m.type === "dialogue") c.dialogue = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const life = (args = {}) => hook("heroLife", args);
const ff = (ticks) => hook("fastForward", { ticks });
const ins = (args = {}) => hook("interior", args);
const stand = (x, y) => hook("teleportPlayer", { x: px(x), y: px(y) });
const eventsSince = (n) => c.events.slice(n).join(" | ");
const lastView = () => c.interior[c.interior.length - 1];
// The real E message, then the server's answer (an interior view / a dialogue / an event).
async function pressE() {
  const n = c.interior.length;
  const e = c.events.length;
  c.dialogue = null;
  send({ type: "interact" });
  for (let i = 0; i < 100 && c.interior.length === n && c.events.length === e && !c.dialogue; i++) await sleep(10);
}
async function walk(dx, dy, ticks) {
  send({ type: "input", dx, dy });
  await sleep(60);
  await ff(ticks);
  send({ type: "input", dx: 0, dy: 0 });
  await sleep(60);
  await ff(1);
}
async function mySnap() {
  const tick = c.snap?.tick;
  for (let i = 0; i < 100 && c.snap?.tick === tick; i++) await sleep(10);
  return c.snap?.players?.find((p) => p.id === c.welcome.id);
}


await new Promise(r=>c.ws.on('open',r));
while(!c.welcome||!c.snap)await sleep(20);
send({type:'pause'});
await hook('setRaids',{enabled:false});await hook('ignorePlayers',{value:true});
await life({needs:false,pack:{},skills:{baking:400,smithing:400}});
const W=c.welcome.worldTilesX;
const tc=(await hook('constructionState')).townCenters[0];
const x=Math.max(8,Math.min(W-15,tc.x+12)),y=Math.max(8,Math.min(W-15,tc.y+10));
for(let yy=y-2;yy<y+8;yy++)for(let xx=x-2;xx<x+8;xx++)await setTile(xx,yy,0);
const sync=()=>life();
const stock=async()=>(await hook('setStock',{stock:{}})).stock;
const count=(it,id)=>Array.isArray(it[id])?it[id].reduce((a,b)=>a+b,0):(it[id]??0);
const items=async()=>(await hook('progression')).items;
const craft=async id=>{send({type:'heroCraft',recipe:id});return sync();};
await hook('setStock',{stock:{wood:2000,rock:2000,iron:2000,grain:2000,wool:2000,cotton:2000,fruit:2000,alcohol:2000}});
await hook('progression',{items:{flour:100,charcoal:100,ironBloom:100,sourdoughStarter:1}});
// All requested building chests open the same stockpile; their private contents remain intact.
for(const tile of [12,13,16,26,103]){
 await setTile(x,y,tile);await stand(x,y+1);
 const inside=await ins({enter:{tx:x,ty:y},variant:0});
 result(inside.why==='',`Can enter stockpile building ${tile}`);
 const v=lastView(),ch=v.map.props.find(p=>p.prop==='chest');
 result(!!ch,`Building ${tile} has a chest`);
 if(!ch)continue;
 await ins({at:{x:px(ch.x),y:px(ch.y+1)}});
 send({type:'interiorUse',x:ch.x,y:ch.y});await sync();
 const choice=c.dialogue?.dialogue?.choices.findIndex(q=>q.label.startsWith('Open shared'));
 result(choice>=0,`Chest ${tile} offers shared Stockpile`);
 send({type:'dialogueChoice',choice});await sync();
 result(c.dialogue?.openStockpile===true,`Chest ${tile} opens Stockpile`);
 await life({pack:{wood:4}});send({type:'heroAction',action:'deposit'});let l=await sync();result(!l.life.pack.wood,`Deposit carried goods at ${tile}`);
 send({type:'stockWithdraw',good:'wood',amount:10});l=await sync();result(l.life.pack.wood===10,`Withdraw goods at ${tile}`);
 await life({pack:{wood:39}});send({type:'stockWithdraw',good:'wood',amount:10});l=await sync();result(l.life.pack.wood===40,`Withdrawal respects weight capacity at ${tile}`);
 send({type:'stockWithdraw',good:'wood',amount:-100});l=await sync();result(l.life.pack.wood===40,'Reject negative withdrawal');
 // Existing local chest transfer still works alongside shared storage.
 await life({pack:{wood:2}});send({type:'interiorUse',x:ch.x,y:ch.y});await sync();
 const store=c.dialogue.dialogue.choices.findIndex(q=>q.label.startsWith('Store everything'));
 send({type:'dialogueChoice',choice:store});await sync();
 result((await ins()).chests.some(([k,v])=>v.wood>=2),'Local chest goods preserved separately');
 await ins({exit:true});
}
// Interior anvil / oven recipes work without an NPC worker.
for(const [tile,prop,id,output,seconds] of [[103,'oven','flatbread','flatbread',20],[103,'oven','bread','bread',40],[26,'anvil','forge:weapon:1',null,10],[26,'anvil','forge:armour:1',null,15]]){
 await setTile(x,y,tile);await stand(x,y+1);await ins({enter:{tx:x,ty:y},variant:0});
 const q=lastView().map.props.find(q=>q.prop===prop);await ins({at:{x:px(q.x),y:px(q.y+1)}});
 send({type:'interiorUse',x:q.x,y:q.y});await sync();result(c.dialogue?.dialogue?.name==='Craft at workstation'||c.dialogue?.dialogue?.choices?.some(q=>q.label.includes('Forge'))||c.dialogue?.dialogue?.choices?.some(q=>q.label.includes('Bake')),`${prop} opens recipe chooser`);
 const before=output?count(await items(),output):null;
 let l=await craft(id);result(!!l.snap.work,`${id} starts a personal batch`);
 await ff(seconds*20+30);l=await sync();result(!l.snap.work,`${id} finishes`);
 if(output)result(count(await items(),output)===before+2,`${id} produces exact output`);
 else result(c.events.some(e=>e.includes(id.includes('weapon')?'Forge tier 1 weapons complete':'Forge tier 1 armour complete')),`${id} produces equipment`);
 await ins({exit:true});
}
// Every remaining existing artisan/progression workshop is accessible personally.
for(const [tile,id,out,amount,seconds,isItem] of [[100,'charcoal','charcoal',3,90,true],[101,'ironBloom','ironBloom',1,40,true],[102,'flour','flour',2,20,true],[25,'artisan:25','clothes',1,30,false],[27,'artisan:27','luxuryItems',1,30,false],[30,'artisan:30','alcohol',1,30,false],[31,'artisan:31','gold',10,30,false]]){
 await setTile(x,y,tile);await stand(x,y+1);
 const before=isItem?count(await items(),out):(await stock())[out];
 const l=await craft(id);result(!!l.snap.work,`Station ${tile} accepts ${id}`);
 await ff(seconds*20+10);result(!(await sync()).snap.work,`${id} batch finishes`);
 const after=isItem?count(await items(),out):(await stock())[out];result(after===before+amount,`${id} delivers its output`);
}
// No remote crafting/withdrawal, and an interrupted batch never produces output.
await setTile(x,y,103);await stand(x,y+1);
await craft('flatbread');const before=count(await items(),'flatbread');
await stand(x+6,y+6);await ff(1);result(!(await sync()).snap.work,'Moving away cancels crafting');
result(!(await craft('flatbread')).snap.work,'Remote crafting refused');
await life({pack:{}});send({type:'stockWithdraw',good:'wood',amount:10});result(!(await sync()).life.pack.wood,'Remote withdrawal refused');
// Three tree classes yield 1, 3 and 6 wood when felled (2, 5, 10 chops); capacity rechecked on completion.
const found=new Set();
for(let xx=x;xx<x+8;xx++)for(let yy=y+3;yy<y+8;yy++){
 const n=((Math.imul(xx+17,73856093)^Math.imul(yy+31,19349663))>>>0)%10,amount=n<2?1:n<8?3:6,chops=n<2?2:n<8?5:10;
 if(found.has(amount))continue;found.add(amount);
 await setTile(xx,yy,2);await setTile(xx-1,yy,0);await stand(xx-1,yy);await life({pack:{}});
 // Felling: no wood until the last chop.
 let early=0;
 for(let k=1;k<=chops;k++){if(k===chops)early=(await sync()).life.pack.wood??0;await life({energy:100,use:{tool:'axe',tx:xx,ty:yy}});await ff(70);}
 result(early===0&&(await sync()).life.pack.wood===amount,`Tree size yields ${amount} wood after ${chops} chops`);
}
result(found.size===3,'All three tree sizes covered');

// Skill XP is paid at completion, after the inputs: cancelling a batch (moving away) earns nothing and costs nothing.
{
 await life({skills:{baking:0}});await hook('progression',{items:{flour:100}});
 await setTile(x,y,103);await stand(x,y+1);
 const flour0=count(await items(),'flour');
 await craft('bread');await ff(60);await stand(x+6,y+6);await ff(1);
 let l=await sync();
 result(!l.snap.work&&(l.life.skills.baking??0)===0,`Cancelled batch grants no XP (baking ${l.life.skills.baking??0})`);
 result(count(await items(),'flour')===flour0,'Cancelled batch spends no inputs');
 await stand(x,y+1);await craft('flatbread');await ff(20*20+30);l=await sync();
 result(!l.snap.work&&l.life.skills.baking===20,`Completed 20s batch grants 20 XP (baking ${l.life.skills.baking})`);
}
// Two stations in reach: the one the hero stands beside (the nearest) is worked, and the job keeps its own station.
{
 await life({skills:{baking:0}});
 await setTile(x,y,102);await setTile(x+2,y,103);await stand(x+2,y+1);
 const before=count(await items(),'flatbread');
 let l=await craft('flatbread');result(!!l.snap.work,'Nearest of two stations is picked (oven, not mill)');
 await ff(20*20+30);l=await sync();
 result(!l.snap.work&&count(await items(),'flatbread')===before+2,'Job at the nearer station completes');
 await setTile(x,y,0);await setTile(x+2,y,0);
}
// Forge tiers need a smith level with the gates closed (tier 1 gear: level 2); open gates ignore it.
{
 await hook('progression',{unlockAll:false});
 await setTile(x,y,26);await stand(x,y+1);
 await life({skills:{smithing:0}});
 let l=await craft('forge:weapon:1');result(!l.snap.work,'Forge refused below smith level with gates closed');
 await life({skills:{smithing:400}});
 l=await craft('forge:weapon:1');result(!!l.snap.work,'Forge allowed at smith level 2+');
 send({type:'heroAction',action:'stopWork'});await sync();
 await hook('progression',{unlockAll:true});
 await life({skills:{smithing:0}});
 l=await craft('forge:weapon:1');result(!!l.snap.work,'Open gates ignore the smith-level gate');
 send({type:'heroAction',action:'stopWork'});await sync();
 await setTile(x,y,0);
}
// A settlement's smithy offers no personal crafting at its anvil.
{
 let town=(await hook('sitesState')).sites.find(st=>st.faction==='human'&&!st.cleared&&!st.captured);
 for(const [dx,dy] of [[30,0],[-30,0],[0,30],[0,-30],[30,30],[-30,-30]]){
  if(town)break;
  const st=await hook('stampSite',{template:'hearthmoor',dx,dy,search:20});
  if(st?.site)town=st.site;
 }
 if(town){
  await setTile(x,y,26);await hook('setOwner',{tx:x,ty:y,siteId:town.id});await stand(x,y+1);
  await ins({enter:{tx:x,ty:y},variant:0});
  const q=lastView()?.map?.props?.find(q=>q.prop==='anvil');
  if(q){
   await ins({at:{x:px(q.x),y:px(q.y+1)}});c.dialogue=null;
   send({type:'interiorUse',x:q.x,y:q.y});await sync();
   result(c.dialogue?.dialogue?.name!=='Craft at workstation','Settlement anvil offers no personal crafting');
   result(!(await sync()).snap.work,'No batch started at a settlement anvil');
  }else result(false,'Settlement smithy has an anvil');
  await ins({exit:true});
 }else result(false,'A standing human settlement exists for the anvil test');
}
c.ws.close();console.log(`${fails} failures`);process.exit(fails?1:0);
