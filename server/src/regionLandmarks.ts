import {TileType} from '@colony/shared/protocol';
import type {Region} from '@colony/shared/regions';
import type {EncounterKind} from '@colony/shared/encounters';
import {state} from './state.js';
import {setTile} from './chunks.js';
import {tileIndex} from './tiles.js';
// Only scenery and entrance anchors are stamped; enemies are lazy interior encounter records.
export function enteredLandmark(r:Region,kind:EncounterKind,roads:Set<number>,road:(x:number,y:number)=>void,safe:(x:number,y:number)=>boolean){
 const x0=r.x*32,y0=r.y*32;
 for(let y=2;y<31;y++)for(let x=2;x<31;x++)if(safe(x0+x,y0+y)||state.tiles[tileIndex(x0+x,y0+y)]===TileType.Water)return;
 const put=(x:number,y:number,t:TileType)=>setTile(tileIndex(x0+x,y0+y),t);
 for(let y=3;y<=29;y++)for(let x=3;x<=29;x++){roads.delete(tileIndex(x0+x,y0+y));put(x,y,TileType.Empty);}
 // Regional traffic bypasses the landmark and meets its entrance from the south.
 for(let n=2;n<=30;n++){road(x0+2,y0+n);road(x0+30,y0+n);road(x0+n,y0+2);road(x0+n,y0+30);}
 if(kind==='camp'){
  if(r.variant%2)for(let n=6;n<=26;n++){put(n,6,TileType.Wall);put(n,26,TileType.Wall);put(6,n,TileType.Wall);put(26,n,TileType.Wall);}
  for(const [x,y]of [[10,11],[22,11],[10,21],[22,21]])put(x,y,TileType.Tent);
  put(16,11,TileType.PrisonCage);put(15,17,TileType.PropCampfire);put(21,18,TileType.PropBarrel);
  put(16,26,TileType.CampEntrance);put(15,26,TileType.Empty);put(17,26,TileType.Empty);
  for(let y=27;y<=30;y++){put(16,y,TileType.Empty);road(x0+16,y0+y);}
 }else if(kind==='cave'){
  // Layered rock shelves around a visible south-facing cave mouth.
  for(let y=5;y<=20;y+=3)for(let x=5+(y%2);x<=27;x+=3)if(Math.hypot((x-16)/11,(y-12)/8)<1&&(x*13+y*7+r.variant)%5<4)put(x,y,TileType.CaveRock);
  put(16,21,TileType.CaveEntrance);for(let y=22;y<=30;y++){put(16,y,TileType.Empty);road(x0+16,y0+y);}
 }else{
  // A single continuous perimeter, connected wings and two visible entrance arches.
  for(let y=5;y<=27;y++)for(let x=5;x<=27;x++){
   const edge=x===5||x===27||y===5||y===27;
   if(edge)put(x,y,(x+y)%3?TileType.RuinWall1:TileType.RuinWall2);
   else if((x===12||x===21)&&![12,13,22,23].includes(y))put(x,y,TileType.RuinWall1);
   else if(y===17&&![8,9,16,17,24,25].includes(x))put(x,y,TileType.RuinWall2);
   else if((x*17+y*11+r.variant)%29===0)put(x,y,TileType.RuinRubble);
  }
  put(16,10,TileType.RuinStatue);put(16,27,TileType.RuinEntrance);put(5,13,TileType.RuinSideEntrance);
  put(5,14,TileType.Empty);for(let x=2;x<5;x++)road(x0+x,y0+14);
  for(let y=28;y<=30;y++)road(x0+16,y0+y);
 }
}
