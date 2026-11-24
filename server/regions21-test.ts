import assert from 'node:assert/strict';
import {TileType,TILE_SIZE} from '../shared/src/protocol.js';
import {encounterKind,encounterAnchor,encounterMap} from '../shared/src/encounters.js';
import {state,mobs,players,hearths} from './src/state.js';
import {generateWorld} from './src/worldgen.js';
import {generatedRegionPlan} from './src/regionWorld.js';
import {loadBuildingTemplates} from './src/buildingTemplates.js';
import {loadSettlementTemplates} from './src/settlementTemplates.js';
import {loadCampTemplates} from './src/camps.js';
import {tryEnterAtDoor,exitInterior,handleInteriorExit,stepInteriorMovement} from './src/interiors.js';
import {minesForSave,restoreMines,mineRecAt,mineInteriorMap,mineHeroAttack,updateMines,minesDawn} from './src/mines.js';
import {heroProfileOf} from './src/heroes.js';
import {quests} from './src/quests.js';
import {sites} from './src/state.js';
import {animalZones} from './src/zones.js';
import {ensurePaddocks,paddockById} from './src/paddocks.js';
import type {Player} from './src/types.js';
loadBuildingTemplates();loadSettlementTemplates();loadCampTemplates();await generateWorld(42);
for(const kind of ['camp','cave','ruin'] as const)for(let v=0;v<4;v++){
 const {map,solid}=encounterMap(kind,v),start=map.spawn.y*map.w+map.spawn.x,seen=new Set([start]),q=[start];
 for(let k=0;k<q.length;k++){const i=q[k],x=i%map.w,y=Math.floor(i/map.w);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*map.w+xx;if(xx<0||yy<0||xx>=map.w||yy>=map.h||solid[j]||seen.has(j))continue;seen.add(j);q.push(j);}}
 assert(seen.has(map.exit.y*map.w+map.exit.x),'exit reachable');for(const p of map.lairs!)assert(seen.has(p.y*map.w+p.x),'every enemy spawn reachable');
}
assert.equal(minesForSave().filter(r=>r.encounter).length,0,'no encounter records or AI until entry');
assert(![...mobs.values()].some(m=>['ruin','encampment','castleRuin'].includes(m.siteKind??'')),'no regional encounter guards outside');
const farmSignatures=new Set<string>();let farms=0;
for(const r of generatedRegionPlan!.regions.filter(r=>r.kind==='countryside')){const a=[];for(let y=0;y<32;y++)for(let x=0;x<32;x++)a.push(state.tiles[(r.y*32+y)*state.WORLD_TILES_X+r.x*32+x]);if(!a.includes(TileType.BarnPost))continue;farms++;assert(a.filter(t=>t===TileType.FarmPlot).length>=100);assert(a.filter(t=>t===TileType.FruitTree).length>=15);assert(a.filter(t=>t===TileType.House).length>=2);assert(a.filter(t=>t===TileType.Tree).length>=3,'scattered countryside trees');farmSignatures.add(a.map(t=>t===TileType.Tree?0:t).join(','));}
assert(farms>0&&farmSignatures.size>=3,'several countryside arrangements');ensurePaddocks(true);for(const z of animalZones().filter(z=>z.ruralKey))assert(paddockById(z.id)?.fenced);
const messages:any[]=[];const p={id:'entered-test',profileKey:'entered-test',clan:0,nickname:'Tester',hp:100,dead:false,attackCooldownTicks:0,input:{dx:0,dy:0},socket:{OPEN:1,readyState:1,send:(s:string)=>messages.push(JSON.parse(s))}} as unknown as Player;players.set(p.id,p);
for(const tile of [TileType.CampEntrance,TileType.CaveEntrance,TileType.RuinEntrance]){
 const i=state.tiles.indexOf(tile),x=i%state.WORLD_TILES_X,y=Math.floor(i/state.WORLD_TILES_X);assert(i>=0);p.x=(x+.5)*32;p.y=(y+1.5)*32;p.interior=undefined;p.dead=false;p.hp=100;
 assert(tryEnterAtDoor(p,false),'normal door interaction');assert(p.interior);assert(messages.some(m=>m.type==='interior'&&m.view?.map.label));
 let r=mineRecAt(x,y)!;assert(r?.encounter===encounterKind(tile));assert(r.layers[0].mobs.length>=5);const first=r.layers[0].mobs[0],hp=first.hp;
 const grid=mineInteriorMap(x,y,1,0);const floorNear=(x:number,y:number)=>[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:x+dx,y:y+dy})).find(q=>!grid.solid[q.y*grid.map.w+q.x])!;
 let near=floorNear(first.x,first.y);p.interior!.x=(near.x+.5)*32;p.interior!.y=(near.y+.5)*32;p.attackCooldownTicks=0;mineHeroAttack(p);assert(first.hp<hp,'hero attack hits inside');
 const snapshot=minesForSave();exitInterior(p);const savedHp=first.hp,savedX=first.x;for(let n=0;n<60;n++){state.cycleTick++;updateMines();}assert.equal(first.x,savedX,'unoccupied encounter freezes');restoreMines(snapshot);assert.equal(mineRecAt(x,y)!.layers[0].mobs[0].hp,Math.ceil(savedHp));
 p.x=(x+.5)*32;p.y=(y+1.5)*32;assert(tryEnterAtDoor(p,false));r=mineRecAt(x,y)!;
 // Enemy attacks use the same indoor damage path. No overworld mobs are created.
 const m=r.layers[0].mobs[0];near=floorNear(m.x,m.y);p.interior!.x=(m.x+.5+(near.x-m.x)*.55)*32;p.interior!.y=(m.y+.5+(near.y-m.y)*.55)*32;m.awake=true;m.cd=0;const beforeHp=p.hp;state.cycleTick++;updateMines();assert(p.hp<beforeHp,'enemy damages hero inside');
 // Clear all enemies through real attacks, then verify one-time rewards and persistence.
 if(tile===TileType.CampEntrance){const site=[...sites.values()].find(s=>s.faction==='human'&&!s.captured)!;assert(site);quests.push({id:999,clan:0,siteId:site.id,kind:'clearCamp',postedTick:state.cycleTick,expiresTick:1e9,reward:5,relation:1,accepted:true,x,y,targetId:`landmark:${x},${y}`});}
 const beforeGold=state.stock.gold;
 for(let n=0;n<400&&r.layers[0].mobs.length;n++){const target=r.layers[0].mobs[0],q=floorNear(Math.round(target.x),Math.round(target.y));p.interior!.x=(q.x+.5)*32;p.interior!.y=(q.y+.5)*32;p.attackCooldownTicks=0;mineHeroAttack(p);}
 assert.equal(r.layers[0].status,'cleared');if(tile===TileType.CampEntrance)assert(!quests.some(q=>q.id===999),'native clear-camp quest completes');assert(state.stock.gold>beforeGold);const gold=state.stock.gold;
 const done=minesForSave();exitInterior(p);restoreMines(done);state.cycleTick+=20*300*10;minesDawn();p.x=(x+.5)*32;p.y=(y+1.5)*32;tryEnterAtDoor(p,false);assert.equal(mineRecAt(x,y)!.layers[0].status,'cleared','does not reset at dawn or re-entry');assert.equal(state.stock.gold,gold,'no duplicate clear loot');
 if(tile===TileType.RuinEntrance){exitInterior(p);const sx=Math.floor(x/32)*32+5,sy=Math.floor(y/32)*32+13;if(state.tiles[sy*state.WORLD_TILES_X+sx]===TileType.RuinSideEntrance){p.x=(sx+.5)*32;p.y=(sy+1.5)*32;assert(tryEnterAtDoor(p,false));assert.equal(p.interior!.key,`${x},${y}`,'two ruin doors share one encounter');assert.equal(mineRecAt(sx,sy),mineRecAt(x,y));}}
 const map=grid.map;p.interior!.x=(map.exit.x+.5)*32;p.interior!.y=(map.exit.y+.5)*32;handleInteriorExit(p);assert(!p.interior,'return through normal exit');
}
assert(![...mobs.values()].some(m=>['ruin','encampment','castleRuin'].includes(m.siteKind??'')));
// A bow cannot shoot through a ruin partition.
const wallRuin=state.tiles.findIndex((t,i)=>t===TileType.RuinSideEntrance&&mineRecAt(i%state.WORLD_TILES_X,Math.floor(i/state.WORLD_TILES_X))?.layers[0].status!=='cleared'),wx=wallRuin%state.WORLD_TILES_X,wy=Math.floor(wallRuin/state.WORLD_TILES_X);p.x=(wx+.5)*32;p.y=(wy+1.5)*32;tryEnterAtDoor(p,false);const wr=mineRecAt(wx,wy)!;const victim=wr.layers[0].mobs[0];assert(victim);const wallGrid=mineInteriorMap(wx,wy,1,0);let shot:{x:number;y:number;dx:number}|undefined;for(let y=1;y<wallGrid.map.h-1&&!shot;y++)for(let x=1;x<wallGrid.map.w-6&&!shot;x++)for(let dx=3;dx<=5;dx++){if(!wallGrid.solid[y*wallGrid.map.w+x]&&!wallGrid.solid[y*wallGrid.map.w+x+dx]&&Array.from({length:dx-1},(_,i)=>wallGrid.solid[y*wallGrid.map.w+x+i+1]).some(Boolean)){shot={x,y,dx};break;}}assert(shot);victim.x=shot.x+shot.dx;victim.y=shot.y;const oldHP=victim.hp;p.interior!.x=(shot.x+.5)*32;p.interior!.y=(shot.y+.5)*32;const prof=heroProfileOf(p),oldWeapon=prof.equipment.weapon;prof.equipment.weapon={kind:'bow'} as any;p.attackCooldownTicks=0;mineHeroAttack(p);assert.equal(victim.hp,oldHP,'walls block ranged attacks');prof.equipment.weapon=oldWeapon;exitInterior(p);
const side=state.tiles.indexOf(TileType.RuinSideEntrance);assert(side>=0);const sx=side%state.WORLD_TILES_X,sy=Math.floor(side/state.WORLD_TILES_X),alias=encounterAnchor(sx,sy,TileType.RuinSideEntrance);p.x=(sx+.5)*32;p.y=(sy+1.5)*32;assert(tryEnterAtDoor(p,false));assert.equal(p.interior!.key,`${alias.x},${alias.y}`);assert.equal(mineRecAt(sx,sy),mineRecAt(alias.x,alias.y));exitInterior(p);
players.delete(p.id);console.log('PASS countryside variants/trees, enclosed zones, connected interiors, lazy combat, damage, dormancy, two-way entry, shared ruin doors, save/load and one-time clearing rewards');process.exit(0);
