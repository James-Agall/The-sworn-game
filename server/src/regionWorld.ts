import { Biome, TILE_SIZE, TileType } from '@colony/shared/protocol';
import { planRegions, regionCityTemplate, REGION_SIZE, type RegionPlan } from '@colony/shared/regions';
import { state, sites, gates } from './state.js';
import { setTile } from './chunks.js';
import { tileIndex, inBounds, ownerAt } from './tiles.js';
import { stampSettlement } from './settlementTemplates.js';
import { campPool, stampCamp } from './camps.js';
import { campRadius } from '@colony/shared/camps';
import { placeAbbey, placeCastleRuin, isInAbbeyGrounds, isInCastleRuinGrounds, placePoiSite, spawnGuardian } from './worldgen.js';
import { seedHomeDesign } from './interiors.js';

export let generatedRegionPlan: RegionPlan | null = null;
export function restoreRegionPlan(plan: RegionPlan | undefined) { generatedRegionPlan=plan?.version===1?plan:null; }
export function generateRegionWorld() {
 const width=state.WORLD_TILES_X,height=state.WORLD_TILES_Y;
 const plan=planRegions(width,height,state.worldNoiseSalt);
 generatedRegionPlan=plan;
 const landmarks: {x:number;y:number}[]=[];
 placeAbbey(landmarks);placeCastleRuin(landmarks);
 const landmarkAt=(x:number,y:number)=>isInAbbeyGrounds(x,y)||isInCastleRuinGrounds(x,y);
 const centre=state.townCenters[0];
 const safe=(x:number,y:number)=>Math.hypot(x-centre.x,y-centre.y)<20||landmarkAt(x,y);
 const write=(x:number,y:number,tile:TileType)=>{if(inBounds(x,y)&&!safe(x,y))setTile(tileIndex(x,y),tile);};
 const roads=new Set<number>();
 const road=(x:number,y:number)=>{if(inBounds(x,y))roads.add(tileIndex(x,y));};
 for(const r of plan.regions){
  const x=r.x*32+16,y=r.y*32+16;
  road(x,y);
  if(r.east)for(let dx=0;dx<=32;dx++)road(x+dx,y);
  if(r.south)for(let dy=0;dy<=32;dy++)road(x,y+dy);
 }
 // Join the hero's starting square to the regional network.
 for(let y=Math.min(centre.y,Math.floor(centre.y/32)*32+16);y<=Math.max(centre.y,Math.floor(centre.y/32)*32+16);y++)road(centre.x,y);
 for(let x=Math.min(centre.x,Math.floor(centre.x/32)*32+16);x<=Math.max(centre.x,Math.floor(centre.x/32)*32+16);x++)road(x,Math.floor(centre.y/32)*32+16);
 for(const r of plan.regions){
  if(r.kind==='city')continue;
  const x0=r.x*32,y0=r.y*32;
  for(let y=y0;y<Math.min(y0+32,height);y++)for(let x=x0;x<Math.min(x0+32,width);x++){
   if(safe(x,y)||roads.has(tileIndex(x,y)))continue;
   const roll=Math.random();
   state.biomes[tileIndex(x,y)]=r.kind==='marsh'?Biome.Swamp:r.kind==='cave'?Biome.Hills:Biome.Plains;
   if(r.kind==='forest'&&roll<.25+r.variant*.025)write(x,y,TileType.Tree);
   else if(r.kind==='marsh'&&roll<.16)write(x,y,TileType.Water);
   else if(r.kind==='countryside'&&x%32>=5&&x%32<=9&&y%32>=5&&y%32<=9)write(x,y,TileType.FarmPlot);
   else if(roll<.06)write(x,y,TileType.Tree);
   else if(roll<.072)write(x,y,TileType.Rock);
   else if(roll<.077)write(x,y,TileType.IronOre);
  }
 }
 // A continuous river occupies one column, avoiding the initial settlement and city footprints.
 const riverX=width>192?Math.floor(width*.22):Math.floor(width*.12);
 for(let y=1;y<height-1;y++){
  const r=plan.regions[Math.floor(y/32)*plan.columns+Math.floor(riverX/32)];
  if(r?.kind!=='city')write(riverX,y,TileType.Water);
 }
 for(const city of plan.cities){
  const id=`region-city-${city.w}-${city.h}-${city.variant}`;
  const template=regionCityTemplate(id)!;
  const x0=city.x*32+1,y0=city.y*32+1;
  let reserved=false;
  for(let yy=y0-4;yy<y0+city.h*32+4;yy++)for(let xx=x0-4;xx<x0+city.w*32+4;xx++)if(landmarkAt(xx,yy))reserved=true;
  if(reserved)continue;
  if(x0+template.rows[0].length>=width-2||y0+template.rows.length>=height-2)continue;
  stampSettlement(template,x0,y0);
  const styles=['cottage','townhouse','farmhouse','longhouse','hunting-lodge','hill-burrow','manor'];
  for(const b of template.buildings)if(b.ref.startsWith('house-'))seedHomeDesign(x0+b.x+1,y0+b.y+1,styles[(b.x+b.y+city.variant)%styles.length]);
  // All exterior gates reach the centre of their neighbouring region.
  for(let dx=0;dx<city.w;dx++){
   const x=city.x*32+16+dx*32;
   for(let y=city.y*32-16;y<=city.y*32;y++)road(x,y);
   for(let y=(city.y+city.h)*32-1;y<=(city.y+city.h)*32+16;y++)road(x,y);
  }
  for(let dy=0;dy<city.h;dy++){
   const y=city.y*32+16+dy*32;
   for(let x=city.x*32-16;x<=city.x*32;x++)road(x,y);
   for(let x=(city.x+city.w)*32-1;x<=(city.x+city.w)*32+16;x++)road(x,y);
  }
 }
 const camps=campPool().filter(t=>campRadius(t)<=10&&t.entrance==='S');
 const fallbackCamps=campPool().filter(t=>campRadius(t)<=10);
 for(const r of plan.regions){
  const x=r.x*32+16,y=r.y*32+16;
  if(landmarks.some(p=>Math.abs(p.x-x)<40&&Math.abs(p.y-y)<40))continue;
  if(x<14||y<14||x>=width-14||y>=height-14||safe(x,y)||r.kind==='city')continue;
  // Keep all encounters away from the shared road hub. Their approach is a short branch.
  const at={x:x-7,y:y-7};
  if(r.kind==='fort'){
   if(r.x===0||r.y===0||r.x>=plan.columns-1||r.y>=plan.rows-1||Math.hypot(x-centre.x,y-centre.y)<64)continue;
   const template=regionCityTemplate(`region-city-1-1-${r.variant}`)!;
   stampSettlement({...template,name:'Border fort'},r.x*32+1,r.y*32+1);
  }else if(r.kind==='camp'){
   const pool=camps.length?camps:fallbackCamps;
   if(pool.length){const tpl=pool[r.variant%pool.length],radius=campRadius(tpl);
    const campAt={x:x,y:y};
    for(let yy=y-radius-1;yy<=y+radius+1;yy++)for(let xx=x-radius-1;xx<=x+radius+1;xx++)write(xx,yy,TileType.Empty);
    stampCamp(tpl,campAt,0);
    // Route the network around the camp. The template's own entrance is retained.
    for(let yy=y-radius-1;yy<=y+radius+1;yy++){road(x-radius-1,yy);road(x+radius+1,yy);}
    for(let xx=x-radius-1;xx<=x+radius+1;xx++){road(xx,y-radius-1);road(xx,y+radius+1);}
    for(let offset=-radius;offset<=radius;offset++){roads.delete(tileIndex(x+offset,y));roads.delete(tileIndex(x,y+offset));}
   }
  }else if(r.kind==='ruin'){
   for(let yy=at.y-4;yy<=at.y+4;yy++)for(let xx=at.x-4;xx<=at.x+4;xx++)write(xx,yy,TileType.Empty);
   placePoiSite('ruin',at);
  }else if(r.kind==='cave'){
   // An outdoor rocky cave encounter uses existing rock and cave-creature entities.
   for(let dx=-4;dx<=4;dx++)for(let dy=-4;dy<=0;dy++)write(at.x+dx,at.y+dy,TileType.Rock);
   write(at.x,at.y,TileType.Empty);write(at.x,at.y-1,TileType.Empty);
   spawnGuardian('caveSpider',{x:at.x,y:at.y},`region-cave-${r.x}-${r.y}`,'ruin');
   spawnGuardian('caveBat',{x:at.x+1,y:at.y+1},`region-cave-${r.x}-${r.y}`,'ruin');
  }
 }
 // Roads are stamped last and never overwrite settlement buildings, gates or encounter props.
 for(const i of roads){
  const x=i%width,y=Math.floor(i/width);
  if(landmarkAt(x,y)||ownerAt(i)!==0||state.tiles[i]===TileType.TownCenter)continue;
  const tile=state.tiles[i];
  if([TileType.Empty,TileType.Tree,TileType.Rock,TileType.IronOre,TileType.Water].includes(tile)){
   setTile(i,tile===TileType.Water?TileType.Drawbridge:TileType.Road);
   if(tile===TileType.Water)gates.set(i,{open:true,lock:'auto',clearTicks:0,overrun:false});
  }
 }
 // Ensure the centre of every external city connector is open all the way to its street.
 console.log(`[regions] ${plan.regions.length} regions, ${sites.size} settlements, 32-cell chunks`);
 return plan;
}
