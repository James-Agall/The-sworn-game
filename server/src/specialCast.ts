import {SPECIAL_CAST,SPECIAL_BY_ID,type SpecialCharacter} from '@colony/shared/specialCast';
import {INTERIOR_TEMPLATE_BY_TILE} from '@colony/shared/interiors';
import {encounterKind,encounterAnchor} from '@colony/shared/encounters';
import {TileType} from '@colony/shared/protocol';
import {state,sites} from './state.js';
import {ownerAt,tileIndex} from './tiles.js';
export interface SpecialResidence {id:string;tx:number;ty:number;venue:string;place:string;hostile:boolean}
let tileBuffer:Uint8Array|undefined,salt=-1,homes:SpecialResidence[]=[];
const normalize=(v:string)=>({tailor:'shop',market:'shop',workshop:'smithy',mill:'bakery',farmhouse:'house',stables:'barn'}[v]??v);
// Scan once per loaded world. Residents have no overworld bodies or off-screen AI.
export function specialResidences():SpecialResidence[]{
 if(tileBuffer===state.tiles&&salt===state.worldNoiseSalt)return homes;
 tileBuffer=state.tiles;salt=state.worldNoiseSalt;homes=[];
 const venues:{tx:number;ty:number;venue:string;place:string;load:number}[]=[],keys=new Set<string>();
 for(let ty=0;ty<state.WORLD_TILES_Y;ty++)for(let tx=0;tx<state.WORLD_TILES_X;tx++){
  const tile=state.tiles[tileIndex(tx,ty)],hostile=encounterKind(tile);
  if(hostile){const a=encounterAnchor(tx,ty,tile),key=`${a.x},${a.y}`;if(!keys.has(key)){keys.add(key);venues.push({tx:a.x,ty:a.y,venue:hostile,place:`${hostile==='camp'?'Bandit fort':hostile==='cave'?'Cavern':'Ancient ruin'} (${a.x}, ${a.y})`,load:0});}continue;}
  const venue=INTERIOR_TEMPLATE_BY_TILE[tile as TileType];if(!venue||venue==='mine')continue;
  const owner=ownerAt(tileIndex(tx,ty)),site=[...sites.values()].find(s=>s.num===owner);
  if(tile!==TileType.AbbeyHall&&(!site||site.faction!=="human"||site.cleared||site.captured))continue;
  venues.push({tx,ty,venue,place:`${venue==='church'?'Chapel':venue==='hall'?'Hall':venue[0].toUpperCase()+venue.slice(1)} in ${site?.name??'the abbey'} (${tx}, ${ty})`,load:0});
 }
 for(const c of SPECIAL_CAST){
  const pool=venues.filter(v=>c.hostile?['camp','cave','ruin'].includes(v.venue)&&v.load<(v.venue==='camp'?6:12):!['camp','cave','ruin'].includes(v.venue));
  const prefs=c.venues.map(normalize);
  // Give scarce specialist venues priority, then share homes evenly.
  pool.sort((a,b)=>{
   const score=(v:typeof a)=>v.load*v.load*3+(prefs.includes(v.venue)?prefs.indexOf(v.venue)*2:24)+(c.hostile&&!prefs.includes(v.venue)?200:0);
   return score(a)-score(b)||a.ty-b.ty||a.tx-b.tx;
  });
  const v=pool[0];if(!v)continue;v.load++;homes.push({id:c.id,tx:v.tx,ty:v.ty,venue:v.venue,place:v.place,hostile:c.hostile});
 }
 return homes;
}
export function specialAt(tx:number,ty:number,hostile=false):SpecialCharacter[]{return specialResidences().filter(h=>h.tx===tx&&h.ty===ty&&h.hostile===hostile).map(h=>SPECIAL_BY_ID.get(h.id)!);}
export function specialAddress(id:string){return specialResidences().find(h=>h.id===id)?.place??'not present in this small world';}
export function resetSpecialResidences(){tileBuffer=undefined;homes=[];}
