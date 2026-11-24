import {TileType,Biome,isSolidTile,isGateTile} from '@colony/shared/protocol';
import type {Region} from '@colony/shared/regions';
import {state,hearths,gates} from './state.js';
import {setTile} from './chunks.js';
import {tileIndex,inBounds,setOwner,siteNumber} from './tiles.js';
import {seedHomeDesign} from './interiors.js';
import {createRuralAnimalZone} from './zones.js';
import {stampCamp,campTemplateById} from './camps.js';
export function marshTile(x:number,y:number,variant:number,roll:number):TileType{
 const wet=Math.hypot((x-9-variant%3)/9,(y-9)/8)<1||Math.hypot((x-23)/8,(y-23+variant%3)/9)<1||Math.hypot(x-6,y-25)<4;
 return wet?TileType.Water:roll<.6?TileType.MarshGround:roll<.84?TileType.MarshReeds:roll<.9?TileType.Tree:TileType.Empty;
}
interface Context {r:Region;roads:Set<number>;road:(x:number,y:number)=>void;safe:(x:number,y:number)=>boolean}
export function ruralHomestead({r,roads,road,safe}:Context){
 const x0=r.x*32,y0=r.y*32;
 // Do not partly stamp a farm over a landmark or the player's starting settlement.
 for(let y=1;y<31;y++)for(let x=1;x<31;x++)if(safe(x0+x,y0+y))return;
 const free=(x:number,y:number)=>!roads.has(tileIndex(x0+x,y0+y))&&state.tiles[tileIndex(x0+x,y0+y)]!==TileType.Water;
 const cols=5+r.variant%2,rows=3+r.variant%2;
 // Keep complete orchard rows on dry ground. Water-side farms can swap their southern plots.
 const orchard=[[20,20,4,23,10,27],[2,20,22,23,28,27]].find(([ox,oy,hx,hy,cx,cy])=>{
  for(let y=oy;y<=oy+(rows-1)*2;y++)for(let x=ox;x<=ox+(cols-1)*2;x++)if(!free(x,y))return false;
  return [[hx,hy],[cx,cy]].every(([x,y])=>free(x,y));
 });
 if(!orchard||!free(13,5))return;
 for(let y=3;y<=10;y++)for(let x=21;x<=29;x++)if(!free(x,y))return;
 const [ox,oy,hx,hy,cx,cy]=orchard;
 const owner=siteNumber(`rural:${r.x}:${r.y}`,true);
 const put=(x:number,y:number,t:TileType)=>{const xx=x0+x,yy=y0+y,i=tileIndex(xx,yy);if(!inBounds(xx,yy)||roads.has(i)||state.tiles[i]===TileType.Water)return false;setTile(i,t);if(t===TileType.FenceGate)gates.set(i,{open:false,lock:'auto',clearTicks:0,overrun:false});if(t!==TileType.Empty)setOwner(i,owner);return true;};
 for(let y=1;y<31;y++)for(let x=1;x<31;x++)if([TileType.Tree,TileType.Rock,TileType.IronOre,TileType.FarmPlot].includes(state.tiles[tileIndex(x0+x,y0+y)]))put(x,y,TileType.Empty);
 let fields=0;
 for(let y=2;y<=11;y++)for(let x=2;x<=11;x++)if(put(x,y,TileType.FarmPlot))fields++;
 for(let y=2;y<14&&fields<100;y++)for(let x=2;x<14&&fields<100;x++)if(state.tiles[tileIndex(x0+x,y0+y)]===TileType.Empty&&put(x,y,TileType.FarmPlot))fields++;
 // A separate fenced, gated livestock enclosure to the north-east.
 const pen:number[]=[];
 for(let y=3;y<=10;y++)for(let x=21;x<=29;x++){
  const edge=x===21||x===29||y===3||y===10;
  put(x,y,edge?(x===25&&y===10?TileType.FenceGate:TileType.PropFence):TileType.Empty);
  if(!edge&&state.tiles[tileIndex(x0+x,y0+y)]===TileType.Empty)pen.push(tileIndex(x0+x,y0+y));
 }
 // Register gates just as player paddock gates, but do not attach them to a settlement AI.
 put(23,5,TileType.Pasture);
 if(pen.length)createRuralAnimalZone(`rural:${r.x}:${r.y}`,'Countryside livestock pen',pen);
 put(13,5,TileType.BarnPost);
 for(const [x,y,base]of [[hx,hy,'farmhouse'],[cx,cy,'cottage']] as const){put(x,y,TileType.House);seedHomeDesign(x0+x,y0+y,base);}
 for(let row=0;row<rows;row++)for(let k=0;k<cols;k++)put(ox+k*2,oy+row*2,TileType.FruitTree);
 // Make up any crop cells lost to a river on this farm's western field belt.
 const fillFields=()=>{fields=0;for(let y=1;y<31;y++)for(let x=1;x<31;x++)if(state.tiles[tileIndex(x0+x,y0+y)]===TileType.FarmPlot)fields++;
 for(let y=2;y<30&&fields<100;y++)for(let x=2;x<14&&fields<100;x++){
  if((x>=ox&&x<=ox+(cols-1)*2&&y>=oy&&y<=oy+(rows-1)*2)||(Math.abs(x-hx)<=1&&Math.abs(y-hy)<=2)||(Math.abs(x-cx)<=1&&Math.abs(y-cy)<=2)||(Math.abs(x-13)<=1&&Math.abs(y-5)<=2))continue;
  if(state.tiles[tileIndex(x0+x,y0+y)]===TileType.Empty&&put(x,y,TileType.FarmPlot))fields++;
 }
 };fillFields();
 const connect=(sx:number,sy:number)=>{
  const start=tileIndex(x0+sx,y0+sy),q=[start],prev=new Map<number,number>([[start,start]]);let end=-1;
  for(let k=0;k<q.length;k++){const i=q[k],x=i%state.WORLD_TILES_X,y=Math.floor(i/state.WORLD_TILES_X);if(roads.has(i)){end=i;break;}
   for(const [dx,dy]of [[0,1],[1,0],[-1,0],[0,-1]]){const xx=x+dx,yy=y+dy,j=tileIndex(xx,yy);if(xx<=x0||xx>=x0+31||yy<=y0||yy>=y0+31||prev.has(j)||isSolidTile(state.tiles[j])||isGateTile(state.tiles[j]))continue;prev.set(j,i);q.push(j);}
  }
  if(end<0)return;for(let i=end;;i=prev.get(i)!){road(i%state.WORLD_TILES_X,Math.floor(i/state.WORLD_TILES_X));if(state.tiles[i]!==TileType.Water){setTile(i,TileType.Road);setOwner(i,0);}if(i===start)break;}
 };
 for(const [x,y]of [[13,6],[hx,hy+1],[cx,cy+1],[25,11]])connect(x,y);
 fillFields();
}
export function banditRegion({r,roads,road}:Context){
 const x=r.x*32+16,y=r.y*32+16,variant=r.variant%3,walled=r.variant>=3;
 const template=campTemplateById(`region-bandit-${walled?'walled':'open'}-${variant}`)!;
 for(let yy=y-10;yy<=y+10;yy++)for(let xx=x-10;xx<=x+10;xx++)setTile(tileIndex(xx,yy),TileType.Empty);
 const placed=stampCamp(template,{x,y},0),h=hearths.get(placed.siteId)!;h.prisoners=Math.max(1,h.prisoners??0);
 for(let yy=y-10;yy<=y+10;yy++){road(x-10,yy);road(x+10,yy);}for(let xx=x-10;xx<=x+10;xx++){road(xx,y-10);road(xx,y+10);}
 // Bypass the tents and cage; the south opening joins the surrounding road circuit.
 for(let yy=y-9;yy<=y+9;yy++)for(let xx=x-9;xx<=x+9;xx++)roads.delete(tileIndex(xx,yy));
 road(x,y+9);road(x,y+10);
}
export function expandRuins({r,roads,safe}:Context,centre:{x:number;y:number}){
 const x0=r.x*32,y0=r.y*32;
 const put=(x:number,y:number,t:TileType)=>{const xx=x0+x,yy=y0+y;if(safe(xx,yy)||roads.has(tileIndex(xx,yy))||Math.max(Math.abs(xx-centre.x),Math.abs(yy-centre.y))<=3)return;setTile(tileIndex(xx,yy),t);};
 // Several broken buildings, archways and rubble courts instead of a single tiny prop cluster.
 for(const [x,y,w,h]of [[2,2,12,10],[20,3,9,9],[3,21,11,8],[20,22,9,7]]){
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
   const edge=xx===x||yy===y||xx===x+w-1||yy===y+h-1;
   if(edge&&(xx+yy+r.variant)%4!==0)put(xx,yy,(xx+yy)%2?TileType.RuinWall1:TileType.RuinWall2);
   else if(!edge&&(xx*13+yy*7+r.variant)%11===0)put(xx,yy,TileType.RuinRubble);
   else if(!edge)put(xx,yy,TileType.Empty);
  }
  put(x+Math.floor(w/2),y+h-1,TileType.RuinArch);
 }
 put(18,12,TileType.RuinStatue);
}
