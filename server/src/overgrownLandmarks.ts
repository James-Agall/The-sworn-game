import {TileType,isSolidTile} from '@colony/shared/protocol';
import type {Region} from '@colony/shared/regions';
import type {EncounterKind} from '@colony/shared/encounters';
import {state} from './state.js';
import {setTile} from './chunks.js';
import {tileIndex} from './tiles.js';

// Only scenery and entrance anchors are stamped. Combat still lives in the lazy entered encounter.
export function overgrownLandmark(r:Region,kind:EncounterKind,roads:Set<number>,road:(x:number,y:number)=>void,safe:(x:number,y:number)=>boolean){
 const x0=r.x*32,y0=r.y*32,idx=(x:number,y:number)=>tileIndex(x0+x,y0+y);
 for(let y=1;y<31;y++)for(let x=1;x<31;x++)if(safe(x0+x,y0+y)||state.tiles[idx(x,y)]===TileType.Water)return;
 const ports:number[]=[];
 for(let n=0;n<32;n++)for(const [x,y]of [[n,0],[n,31],[0,n],[31,n]])if(roads.has(idx(x,y)))ports.push(y*32+x);
 for(let y=1;y<31;y++)for(let x=1;x<31;x++){roads.delete(idx(x,y));setTile(idx(x,y),TileType.Empty);}
 const at=(x:number,y:number)=>state.tiles[idx(x,y)];
 const put=(x:number,y:number,t:TileType)=>setTile(idx(x,y),t);
 const entrances:{x:number;y:number}[]=[];
 if(kind==='camp'){
  // A closed, stepped palisade with corner lookouts, rather than an open tent field.
  const outline=[[9,5],[23,5],[23,6],[25,6],[25,8],[27,8],[27,23],[26,23],[26,25],[23,25],[23,26],[9,26],[9,25],[6,25],[6,23],[5,23],[5,9],[6,9],[6,7],[9,7],[9,5]];
  for(let n=1;n<outline.length;n++){const [ax,ay]=outline[n-1],[bx,by]=outline[n];for(let x=Math.min(ax,bx);x<=Math.max(ax,bx);x++)for(let y=Math.min(ay,by);y<=Math.max(ay,by);y++)put(x,y,TileType.Wall);}
  for(const [x,y]of [[8,8],[25,9],[7,23],[25,23]])put(x,y,TileType.BanditTower);
  for(const [x,y]of [[16,10],[10,14],[23,14],[10,22],[22,22]])put(x,y,x===16?TileType.BanditHall:TileType.BanditTent);
  for(const [x,y,t]of [[12,11,TileType.PropCrate],[13,12,TileType.PropBarrel],[25,17,TileType.PropBarrel],[24,18,TileType.PropCrate],[11,24,TileType.PropCart],[18,23,TileType.PropCrate],[20,12,TileType.SkullBones]])put(x,y,t);
  put(21,18,TileType.PrisonCage);put(15,18,TileType.PropCampfire);put(10,18,TileType.PropCart);
  for(const [x,y,t]of [[8,11,TileType.PropCrate],[23,11,TileType.PropBarrel],[24,20,TileType.PropCrate],[8,20,TileType.PropBarrel],[19,12,TileType.PropLanternPost],[13,22,TileType.PropLanternPost]])put(x,y,t);
  put(16,26,TileType.CampEntrance);entrances.push({x:16,y:26});
  if(r.variant%2){put(22,26,TileType.CampSideEntrance);entrances.push({x:22,y:26});}
  // A few worn paths within the camp, with no road circuit outside its walls.
  for(let y=20;y<26;y++)if(at(16,y)===TileType.Empty)road(x0+16,y0+y);
  for(let x=11;x<=21;x++)if(at(x,20)===TileType.Empty)road(x0+x,y0+20);
 }else if(kind==='cave'){
  for(const [x,y]of [[9,10],[15,8],[22,10],[7,16],[25,16],[10,20],[23,20]])put(x,y,TileType.CaveRock);
  // One giant south-facing mouth is the focal point; keep its approach conspicuously clear.
  for(let y=17;y<=20;y++)for(let x=13;x<=19;x++)put(x,y,TileType.CaveCliff);
  put(16,21,TileType.CaveEntrance);entrances.push({x:16,y:21});
 }else{
  // One connected overgrown complex; larger masonry pieces break up the repeated wall segments.
  for(let y=6;y<=27;y++)for(let x=5;x<=27;x++){
   const edge=x===5||x===27||y===6||y===27;
   if(edge)put(x,y,(x+y)%4?TileType.RuinWall1:TileType.RuinWall2);
   else if((x===12||x===21)&&![11,12,21,22].includes(y))put(x,y,TileType.RuinWall1);
   else if(y===17&&![8,9,16,17,24,25].includes(x))put(x,y,TileType.RuinWall2);
  }
  for(const [x,y]of [[8,10],[24,11]])put(x,y,TileType.RuinTower);
  for(const [x,y]of [[15,9],[18,16],[9,23],[24,22]])put(x,y,TileType.RuinMasonry);
  put(16,13,TileType.RuinStatue);put(16,27,TileType.RuinEntrance);put(5,13,TileType.RuinSideEntrance);
  entrances.push({x:16,y:27},{x:5,y:13});
 }
 // Retain the region's agreed seam connections with a shared shortest-path tree. Never make a perimeter loop.
 const network=new Set<number>(),blocked=(x:number,y:number)=>isSolidTile(at(x,y))||kind==='cave'&&x>=12&&x<=20&&y>=13&&y<=21;
 const connect=(sx:number,sy:number)=>{
  const start=sy*32+sx;if(!network.size){network.add(start);road(x0+sx,y0+sy);return;}
  const q=[start],prev=new Int32Array(1024).fill(-1);prev[start]=start;let end=-1;
  for(let k=0;k<q.length;k++){const i=q[k];if(network.has(i)){end=i;break;}const x=i%32,y=Math.floor(i/32);
   for(const [dx,dy]of [[0,1],[-1,0],[1,0],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*32+xx;if(xx<0||xx>31||yy<0||yy>31||prev[j]!==-1||blocked(xx,yy))continue;prev[j]=i;q.push(j);}
  }
  if(end<0)return;
  for(let i=end;;i=prev[i]){network.add(i);const x=i%32,y=Math.floor(i/32);road(x0+x,y0+y);if(i===start)break;}
 };
 for(const e of entrances){put(e.x,e.y+1,TileType.Empty);connect(e.x,e.y+1);}
 for(const p of new Set(ports))connect(p%32,Math.floor(p/32));
 const clearApproach=(x:number,y:number)=>entrances.some(e=>Math.abs(x-e.x)<=1&&y>=e.y&&y<=e.y+3)||kind==='cave'&&x>=12&&x<=20&&y>=13&&y<=22;
 // Deterministic vegetation clusters use existing mixed trees, with new bramble/ivy ground art.
 const clusters=kind==='camp'?[[3,5],[28,5],[3,26],[28,28]]:kind==='cave'?[[7,8],[25,8],[5,20],[26,22],[9,27],[23,28]]:[[8,8],[24,8],[8,21],[24,24],[3,29],[29,27]];
 for(const [cx,cy]of clusters)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
  const x=cx+dx,y=cy+dy;if(x<1||x>30||y<1||y>30||dx*dx+dy*dy>5||roads.has(idx(x,y))||clearApproach(x,y)||at(x,y)!==TileType.Empty)continue;
  const n=Math.abs(x*31+y*17+r.variant*7)%7;put(x,y,n<2?TileType.Tree:TileType.Overgrowth);
 }
 if(kind!=='camp'){
  // Dry remains and webs are walkable scenery, so they cannot obstruct an entrance or combat route.
  let count=0;for(let n=0;n<220&&count<26;n++){const x=3+(n*7+r.variant)%26,y=5+(n*11+r.variant*3)%24;if(at(x,y)!==TileType.Empty||roads.has(idx(x,y))||clearApproach(x,y))continue;put(x,y,count%3===0?TileType.SkullBones:count%3===1?TileType.FallenSkeleton:TileType.Cobweb);count++;}
  for(const e of entrances)for(const [dx,dy,t]of [[-2,1,TileType.SkullBones],[2,1,TileType.FallenSkeleton],[-3,0,TileType.Cobweb]] as const)if(at(e.x+dx,e.y+dy)===TileType.Empty&&!roads.has(idx(e.x+dx,e.y+dy)))put(e.x+dx,e.y+dy,t);
 }
}

// Recognise only the new composed layouts; legacy world regeneration is unchanged.
export function isInOvergrownLandmark(x:number,y:number){
 const x0=Math.floor(x/32)*32,y0=Math.floor(y/32)*32,at=(dx:number,dy:number)=>state.tiles[tileIndex(x0+dx,y0+dy)];
 return at(16,10)===TileType.BanditHall||at(8,10)===TileType.RuinTower||at(16,21)===TileType.CaveEntrance&&at(9,10)===TileType.CaveRock;
}
