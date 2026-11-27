import assert from 'node:assert/strict';
import { TileType as T, HungerMark } from '@colony/shared/protocol';
import { attackSpec, strikeContains } from '@colony/shared/combatRules';
import { state, players, mobs, wildlife, gates, heroProfiles, colonists } from './src/state.js';
import { markTileRegistryStale, setTile } from './src/chunks.js';
import { heroProfileOf, recomputeHeroProfile } from './src/heroes.js';
import { createRaidMob } from './src/raids.js';
import { queuePlayerAttack, handleCombatInput, stepPlayerCombat, playerCombatLive, defendPlayer, combatMotion, resetPlayerCombat } from './src/playerCombat.js';
import { worldCombatSight } from './src/worldPlayerStrike.js';
import { stepDuel, duelLive, enemyGuardMultiplier, resetDuels, clearDuel } from './src/duelCombat.js';
import { ensureEnteredEncounter, mineInteriorMap, resetMines } from './src/mines.js';
import { collidesAt } from './src/tiles.js';
import { restoreLivestock, handleAnimalAction, isMounted, dismountHero } from './src/animals.js';
import type { Player, Mob } from './src/types.js';
const W=64;Object.assign(state,{WORLD_TILES_X:W,WORLD_TILES_Y:W,worldWidth:W*32,worldHeight:W*32,tiles:new Uint8Array(W*W),biomes:new Uint8Array(W*W),siteGrounds:new Uint8Array(W*W),isPaused:false,spellTick:0,cycleTick:200});markTileRegistryStale();
const messages:object[]=[],p={id:'fighter',profileKey:'fighter',clan:0,x:512,y:512,hp:100,dead:false,input:{dx:0,dy:0},attackCooldownTicks:0,poisonTicksRemaining:0,socket:{OPEN:1,readyState:1,send:(s:string)=>messages.push(JSON.parse(s))}} as unknown as Player;
players.clear();players.set(p.id,p);colonists.clear();
const prof=heroProfileOf(p);let checked=0;
function reset(kind='sword'){
  resetPlayerCombat();resetDuels();mobs.clear();wildlife.clear();gates.clear();state.tiles.fill(T.Empty);markTileRegistryStale();
  Object.assign(p,{x:512,y:512,hp:100,dead:false,attackCooldownTicks:0,input:{dx:0,dy:0},interior:undefined});
  prof.equipment={weapon:{id:'test-'+kind,slot:'weapon',kind,name:kind,tier:1,stats:{}}};
  // Players now start with a plain tier-1 sword (starter weapon): the cached stats must follow this gear-free
  // setup, otherwise they keep the starter sword's damage bonus and every damage figure below shifts.
  recomputeHeroProfile(prof);
}
function mob(x:number,y:number,kind='banditClubman'){
  const m=createRaidMob(kind as any,{x:Math.floor(x/32),y:Math.floor(y/32)},'',false);Object.assign(m,{x,y,hp:500,maxHp:500,groupId:null,mark:HungerMark.None});mobs.set(m.id,m);return m;
}
function tick(n=1){for(let k=0;k<n;k++){state.spellTick++;state.cycleTick++;if(p.attackCooldownTicks>0)p.attackCooldownTicks--;stepPlayerCombat(p);}}
function gearShield(){prof.equipment.offhand={id:'shield',slot:'offhand',kind:'shield',name:'shield',tier:1,stats:{}};}
function input(action:'press'|'release'|'guard'|'dodge'|'aim'|'cancel',angle=0,on?:boolean){handleCombatInput(p,{type:'combat',action,angle,on});}

reset();const front=mob(545,512),second=mob(540,525),back=mob(481,512),far=mob(600,512);
assert(queuePlayerAttack(p,false,0));tick(2);assert.equal(front.hp,500,'damage waits for the contact frame');tick();assert(front.hp<500&&second.hp<500,'sword arc can catch nearby targets');assert.equal(back.hp,500,'no backwards auto-target hit');assert.equal(far.hp,500);const hp=front.hp;tick(12);assert.equal(front.hp,hp,'one damage application per swing');checked++;
reset();const buffered=mob(542,512);queuePlayerAttack(p,false,0);tick(8);assert(!queuePlayerAttack(p,false,0));tick(5);assert.equal(buffered.hp,470,'a buffered input starts the next legal attack');checked++;
reset('axe');const defender=mob(544,512,'armoredOrc');stepDuel(defender,{id:p.id,target:p,range:60,ranged:false,ready:false,scale:1,clear:()=>true,hit:()=>{},cooldown:()=>{}});assert.equal(enemyGuardMultiplier(defender,p,attackSpec('sword')), .4);queuePlayerAttack(p,true,0);tick(10);assert(defender.hp<465,'heavy axe breaks a frontal guard');assert.equal(duelLive(defender)?.phase,'stagger');checked++;
reset('spear');const tip=mob(575,512),wide=mob(548,543);queuePlayerAttack(p,false,0);tick(4);assert(tip.hp<500);assert.equal(wide.hp,500,'spear is a narrow thrust');checked++;
reset('bow');const arrow=mob(650,512),offLine=mob(570,548);input('press');tick(8);input('release');assert(playerCombatLive(p)?.heavy);tick(2);assert(arrow.hp<480);assert.equal(offLine.hp,500);checked++;
reset('bow');const covered=mob(640,512);setTile(16*W+18,T.StoneWall);queuePlayerAttack(p,false,0);tick(5);assert.equal(covered.hp,500,'cover blocks a shot');setTile(16*W+18,T.Water);assert(worldCombatSight(p,covered),'arrows cross water');setTile(16*W+18,T.Gate);gates.set(16*W+18,{open:false,lock:'auto',overrun:false} as any);assert(!worldCombatSight(p,covered),'a closed automatic gate is still arrow cover');gates.get(16*W+18)!.open=true;assert(worldCombatSight(p,covered));checked++;
reset();gearShield();let parried=0;input('guard');assert.equal(defendPlayer(p,20,{x:550,y:512,parry:()=>parried++}),0);assert.equal(parried,1);assert(playerCombatLive(p)?.counter);tick(5);assert.equal(defendPlayer(p,20,{x:550,y:512}),8);assert.equal(defendPlayer(p,20,{x:470,y:512}),20,'a rear blow bypasses the shield');assert.equal(defendPlayer(p,20),20,'poison/environmental damage cannot be shielded');input('guard',0,false);input('guard');assert.equal(defendPlayer(p,20,{x:550,y:512}),8,'rapid guard toggles cannot refresh the parry window');assert.equal(defendPlayer(p,20,{x:550,y:512,heavy:true}),16);assert.equal(playerCombatLive(p)?.feedback,'guardBreak');checked++;
reset();input('dodge');assert.equal(playerCombatLive(p)?.phase,'dodge');assert(combatMotion(p).mult>2);tick(4);input('dodge');assert.notEqual(playerCombatLive(p)?.phase,'dodge','sidestep cooldown prevents spam');assert(playerCombatLive(p)!.dodgeCooldown>0);checked++;
reset();p.input={dx:1,dy:0};setTile(16*W+17,T.StoneWall);input('dodge');const motion=combatMotion(p);assert(collidesAt(545,512,p.x,p.y),'sidestep uses the full player body against a wall');assert(motion.dx>0);checked++;
reset();const swapped=mob(542,512);queuePlayerAttack(p,false,0);prof.equipment.weapon!.id='other';tick(4);assert.equal(swapped.hp,500,'swapping equipment cancels a queued hit');checked++;
reset();const outside=mob(542,512);queuePlayerAttack(p,false,0);p.interior={key:'10,10',templateId:'house',variant:0,storey:0,x:100,y:100} as any;tick(4);assert.equal(outside.hp,500,'changing room cancels an outside swing');p.interior=undefined;checked++;

reset();gearShield();input('guard');state.isPaused=true;input('guard',0,false);assert.notEqual(playerCombatLive(p)?.phase,'guard');state.isPaused=false;input('press');state.isPaused=true;input('release');state.isPaused=false;tick(24);assert.notEqual(playerCombatLive(p)?.phase,'windup','release during pause cannot become an automatic later attack');checked++;

// A readable enemy commits to its wind-up instead of tracking a sidestep into the impact.
reset();const e=mob(400,400),target={x:430,y:400};let hits=0;const h={id:p.id,target,range:50,ranged:false,ready:true,scale:1,clear:()=>true,hit:()=>{hits++;},cooldown:()=>{}};
assert(stepDuel(e,h));assert.equal(duelLive(e)?.phase,'windup');tick(7);stepDuel(e,h);assert.equal(hits,0);target.x=370;tick();stepDuel(e,h);assert.equal(hits,0,'the committed attack misses a target that moves behind');assert.equal(duelLive(e)?.phase,'recovery');clearDuel(e);assert.equal(duelLive(e),undefined);checked++;

// The same scheduled attack and directional hit geometry run inside both landmark types.
for(const tile of [T.CaveEntrance,T.RuinEntrance,T.CampEntrance]){
  reset();resetMines();setTile(10*W+10,tile);const rec=ensureEnteredEncounter(10,10)!;assert(rec);
  const grid=mineInteriorMap(10,10,1,rec.variant??0),spots:{x:number;y:number}[]=[];
  for(let y=3;y<grid.map.h-3;y++)for(let x=3;x<grid.map.w-3;x++)if([-1,0,1].every(dx=>!grid.solid[y*grid.map.w+x+dx]))spots.push({x,y});assert(spots.length);
  const a=spots[Math.floor(spots.length/2)],L=rec.layers[0];L.mobs.forEach((m,n)=>{m.hp=500;m.maxHp=500;m.specialId=undefined;m.x=a.x;m.y=a.y+6+n;});
  const ahead=L.mobs[0],behind=L.mobs[1];Object.assign(ahead,{x:a.x+1,y:a.y});Object.assign(behind,{x:a.x-1,y:a.y});
  p.interior={key:'10,10',tx:10,ty:10,tile,templateId:'mine',level:1,variant:rec.variant??0,storey:0,x:(a.x+.5)*32,y:(a.y+.5)*32} as any;
  queuePlayerAttack(p,false,0);tick(2);assert.equal(ahead.hp,500);tick();assert(ahead.hp<500);assert.equal(behind.hp,500);checked++;
}

// A real mounted hero uses mounted attacks; horses cannot perform the on-foot sidestep.
reset();setTile(14*W+16,T.Stables);restoreLivestock({nextId:2,lastDay:0,houses:[],animals:[{id:1,species:'horse',male:true,born:-100,house:'16,14',fed:1,watered:1,happiness:100,health:100,productDays:0,productFrac:0}]});
assert.match(handleAnimalAction(p,{tileX:16,tileY:14,op:'ride',id:1}),/mount/);assert(isMounted(p));input('dodge');assert.notEqual(playerCombatLive(p)?.phase,'dodge');const ridingTarget=mob(558,512);queuePlayerAttack(p,false,0);tick(3);assert(ridingTarget.hp<500,'mounted passing strike lands in front');tick(12);stepPlayerCombat(p);p.x+=12;state.spellTick++;stepPlayerCombat(p);const movingTarget=mob(p.x+40,p.y);queuePlayerAttack(p,false,0);tick(3);assert(Math.abs(movingTarget.hp-481.25)<.001,'actual forward riding motion gives a capped 25 percent bonus');
tick(12);prof.equipment.weapon!.kind='spear';stepPlayerCombat(p);p.x+=12;state.spellTick++;stepPlayerCombat(p);queuePlayerAttack(p,false,Math.PI);assert(Math.abs(playerCombatLive(p)!.angle)<.61,'a mounted spear thrust stays in the forward sector');
dismountHero(p,true);checked++;
assert(!strikeContains(attackSpec('spear'),{x:0,y:0},{x:-20,y:0}));
console.log(`PASS ${checked} integrated player-combat scenarios: contact timing, aim, buffering, weapons, cover, guard/parry, dodge, swaps, room transitions, enemy commitment, all hostile interiors and mounting`);
