import {enteredLandmark} from './regionLandmarks.js';
import {ruralHomestead,banditRegion,expandRuins,marshTile} from './regionDetails.js';
import { Biome, TILE_SIZE, TileType } from '@colony/shared/protocol';
import { planRegions, regionCityTemplate, REGION_SIZE, type RegionPlan } from '@colony/shared/regions';
import { state, sites, gates,mobs } from './state.js';
import { setTile } from './chunks.js';
import { tileIndex, inBounds, ownerAt, setOwner } from './tiles.js';
import { stampSettlement } from './settlementTemplates.js';
import { campPool, stampCamp } from './camps.js';
import { campRadius } from '@colony/shared/camps';
import { placeAbbey, placeCastleRuin, isInAbbeyGrounds, isInCastleRuinGrounds, placePoiSite, spawnGuardian } from './worldgen.js';
import { TOWN_HOME_BASES } from '@colony/shared/organicTowns';
import { seedHomeDesign } from './interiors.js';

export let generatedRegionPlan: RegionPlan | null = null;
export function restoreRegionPlan(plan: RegionPlan | undefined) { generatedRegionPlan=plan?.version===1?plan:null; }
export function generateRegionWorld(version = 21) {
 const width=state.WORLD_TILES_X,height=state.WORLD_TILES_Y;
 const plan=planRegions(width,height,state.worldNoiseSalt,version);
 generatedRegionPlan=plan;
 const landmarks: {x:number;y:number}[]=[];
 // Landmark rejection sampling must respect the scarce preallocated city footprints.
 const reserved:number[]=[];
 if(version>=14)for(const city of plan.cities){
  for(let y=city.y*32-6;y<(city.y+city.h)*32+6;y++)for(let x=city.x*32-6;x<(city.x+city.w)*32+6;x++){
   if(!inBounds(x,y))continue;
   const i=tileIndex(x,y);
   if(state.tiles[i]===TileType.Empty){setTile(i,TileType.Water);reserved.push(i);}
  }
 }
 placeAbbey(landmarks);placeCastleRuin(landmarks);
 if(version>=21&&state.castleRuinCenter){const c=state.castleRuinCenter;
  for(const [id,m]of mobs)if(m.siteKind==='castleRuin')mobs.delete(id);
  setTile(tileIndex(c.x,c.y+5),TileType.RuinEntrance);setTile(tileIndex(c.x,c.y+6),TileType.Empty);
 }

 for(const i of reserved)if(state.tiles[i]===TileType.Water)setTile(i,TileType.Empty);
 const landmarkAt=(x:number,y:number)=>isInAbbeyGrounds(x,y)||isInCastleRuinGrounds(x,y);
 const centre=state.townCenters[0];
 const safe=(x:number,y:number)=>Math.hypot(x-centre.x,y-centre.y)<20||landmarkAt(x,y);
 const write=(x:number,y:number,tile:TileType)=>{if(inBounds(x,y)&&!safe(x,y))setTile(tileIndex(x,y),tile);};
 const riverX=width>192?Math.floor(width*.22):Math.floor(width*.12);
 const roads=new Set<number>();
 const road=(x:number,y:number)=>{if(inBounds(x,y))roads.add(tileIndex(x,y));};
 for(const r of plan.regions){
  const x=r.x*32+16,y=r.y*32+16;
  road(x,y);
  const winding=(horizontal:boolean)=>{
   let last=0;
   for(let step=0;step<=32;step++){
    // Flat at both endpoints so adjacent regions keep their agreed road sockets.
    const offset=version>=20&&horizontal&&x<=riverX+10&&x+32>=riverX-10?0:version>=13&&r.city===undefined?Math.round(Math.sin(step*Math.PI/16)*3*Math.sin(step*Math.PI/32)):0;
    for(let cross=Math.min(last,offset);cross<=Math.max(last,offset);cross++)road(x+(horizontal?step:cross),y+(horizontal?cross:step));
    last=offset;
   }
  };
  if(r.east)winding(true);
  if(r.south)winding(false);
 }
 // Join the hero's starting square to the regional network.
 for(let y=Math.min(centre.y,Math.floor(centre.y/32)*32+16);y<=Math.max(centre.y,Math.floor(centre.y/32)*32+16);y++)road(centre.x,y);
 for(let x=Math.min(centre.x,Math.floor(centre.x/32)*32+16);x<=Math.max(centre.x,Math.floor(centre.x/32)*32+16);x++)road(x,Math.floor(centre.y/32)*32+16);
 for(const r of plan.regions){
  if(r.city!==undefined)continue;
  const x0=r.x*32,y0=r.y*32;
  for(let y=y0;y<Math.min(y0+32,height);y++)for(let x=x0;x<Math.min(x0+32,width);x++){
   if(safe(x,y)||roads.has(tileIndex(x,y)))continue;
   const roll=Math.random();
   state.biomes[tileIndex(x,y)]=r.kind==='marsh'?Biome.Swamp:r.kind==='cave'?Biome.Hills:Biome.Plains;
   if(version>=20&&r.kind==='marsh'){write(x,y,marshTile(x%32,y%32,r.variant,roll));continue;}
   if(r.kind==='forest'&&roll<.25+r.variant*.025)write(x,y,TileType.Tree);
   else if(r.kind==='marsh'&& (version<13?roll<.16:Math.hypot(x%32-(9+r.variant),y%32-10)<4||Math.hypot(x%32-22,y%32-(22-r.variant))<3))write(x,y,TileType.Water);
   else if(version<20&&r.kind==='countryside'&&x%32>=5&&x%32<=9&&y%32>=5&&y%32<=9)write(x,y,TileType.FarmPlot);
   else if(roll<.06)write(x,y,TileType.Tree);
   else if(roll<.072)write(x,y,TileType.Rock);
   else if(roll<.077)write(x,y,TileType.IronOre);
  }
 }
 // A continuous river occupies one column, avoiding the initial settlement and city footprints.
 let previousRiverX=riverX;
 for(let y=1;y<height-1;y++){
  const centreX=version>=13?riverX+Math.round(Math.sin(y/23)*5):riverX;
  const radius=version>=20?1+Math.round((1+Math.sin(y/31))*1.5):0;
  for(let x=Math.min(previousRiverX,centreX)-radius;x<=Math.max(previousRiverX,centreX)+radius;x++){
   const r=plan.regions[Math.floor(y/32)*plan.columns+Math.floor(x/32)];
   if(r?.city===undefined)write(x,y,TileType.Water);
  }
  previousRiverX=centreX;
 }

 for(const city of plan.cities){
  const id=`region-city-${city.w}-${city.h}-${city.variant}${version>=19?"-organic5":version>=18?"-organic4":version>=17?"-organic3":version>=16?"-organic2":version>=15?"-organic":version>=14?"-district":version>=13?"-dense":""}`;
  const template=regionCityTemplate(id)!;
  const x0=city.x*32+1,y0=city.y*32+1;
  let reserved=false;
  for(let yy=y0-4;yy<y0+city.h*32+4;yy++)for(let xx=x0-4;xx<x0+city.w*32+4;xx++)if(landmarkAt(xx,yy))reserved=true;
  if(reserved)continue;
  if(x0+template.rows[0].length>=width-2||y0+template.rows.length>=height-2)continue;
  stampSettlement(template,x0,y0);
  const styles=['cottage','townhouse','farmhouse','longhouse','hunting-lodge','hill-burrow','manor'];
  for(const b of template.buildings)if(b.ref.startsWith('house-')||version>=15&&b.ref==='longhouse'){
   const x=x0+b.x+1,y=y0+b.y+1;
   const base=version>=15?TOWN_HOME_BASES[Math.floor(city.variant/10)][Math.abs(x*7+y*11)%4]:styles[(b.x+b.y+city.variant)%styles.length];
   seedHomeDesign(x,y,base);
  }
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
  if(r.city!==undefined)continue;
  if(x<14||y<14||x>=width-14||y>=height-14||safe(x,y)||r.kind==='city')continue;
  // Keep all encounters away from the shared road hub. Their approach is a short branch.
  const at={x:x-7,y:y-7};
  const detail={r,roads,road,safe};
  if(version>=20&&r.kind==='countryside'){ruralHomestead(detail,version>=21);continue;}
  if(version>=21&&['camp','cave','ruin'].includes(r.kind)){enteredLandmark(r,r.kind as 'camp'|'cave'|'ruin',roads,road,safe);continue;}
  if(version>=20&&r.kind==='camp'){banditRegion(detail);continue;}
  if(r.kind==='fort'){
   if(r.city!==undefined)continue;
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
   placePoiSite('ruin',at);if(version>=20)expandRuins(detail,at);
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
  if(version>=18){const region=plan.regions[Math.floor(y/32)*plan.columns+Math.floor(x/32)],city=region?.city===undefined?undefined:plan.cities[region.city];if(city&&x>=city.x*32+1&&x<(city.x+city.w)*32-1&&y>=city.y*32+1&&y<(city.y+city.h)*32-1)continue;}
  if(landmarkAt(x,y)||ownerAt(i)!==0||state.tiles[i]===TileType.TownCenter)continue;
  const tile=state.tiles[i];
  if([TileType.Empty,TileType.Tree,TileType.Rock,TileType.IronOre,TileType.Water].includes(tile)){
   setTile(i,tile===TileType.Water?(version>=20?TileType.RiverBridge:TileType.Drawbridge):TileType.Road);
   if(tile===TileType.Water&&version<20)gates.set(i,{open:true,lock:'auto',clearTicks:0,overrun:false});
  }
 }
 // Ensure the centre of every external city connector is open all the way to its street.
 console.log(`[regions] ${plan.regions.length} regions, ${sites.size} settlements, 32-cell chunks`);
 return plan;
}

// Populate older neutral region towns using only vacant plots. Player-owned sites are excluded.
export function populateExistingRegionTowns() {
 const styles=['cottage','townhouse','farmhouse','longhouse','hunting-lodge','hill-burrow'];
 for(const site of sites.values()){
  if(!site.layout?.startsWith('region-city-')||(site.layout.endsWith('-dense')||site.layout.endsWith('-district')||/\-organic[2345]?$/.test(site.layout))||site.captured||site.cleared)continue;
  let count=0;
  for(let y=site.y0;y<=site.y1;y++)for(let x=site.x0;x<=site.x1;x++)if([TileType.House,TileType.BigHouse,TileType.HouseLevel2].includes(state.tiles[tileIndex(x,y)]))count++;
  const target=Math.min(40,Math.floor((site.x1-site.x0)*(site.y1-site.y0)/45));
  for(let y=site.y0+3;y<site.y1-3&&count<target;y+=4)for(let x=site.x0+3;x<site.x1-3&&count<target;x+=4){
   if(Math.hypot(x-site.keepX,y-site.keepY)<7)continue;
   let free=true;
   for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(state.tiles[tileIndex(xx,yy)]!==TileType.Empty||ownerAt(tileIndex(xx,yy))!==0)free=false;
   if(!free)continue;
   setTile(tileIndex(x,y),TileType.House);setOwner(tileIndex(x,y),site.num);
   seedHomeDesign(x,y,styles[count%styles.length]);
   if(site.homes)site.homes.villagers.push(tileIndex(x,y+1));
   count++;
  }
 }
}
