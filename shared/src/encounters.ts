import {TileType,type MobKind} from './protocol.js';
import {interiorSolidGrid,type InteriorMap,type InteriorProp} from './interiors.js';
export type EncounterKind='camp'|'cave'|'ruin';
export const ENCOUNTER_TILES=[TileType.CampEntrance,TileType.CaveEntrance,TileType.RuinEntrance] as const;
export const encounterKind=(tile:number):EncounterKind|undefined=>(tile===TileType.CampEntrance||tile===TileType.CampSideEntrance)?'camp':tile===TileType.CaveEntrance?'cave':(tile===TileType.RuinEntrance||tile===TileType.RuinSideEntrance)?'ruin':undefined;
export const encounterAnchor=(x:number,y:number,tile:number)=>tile===TileType.CampSideEntrance?{x:Math.floor(x/32)*32+16,y:Math.floor(y/32)*32+26}:tile===TileType.RuinSideEntrance?{x:Math.floor(x/32)*32+16,y:Math.floor(y/32)*32+27}:{x,y};
export const encounterVariant=(x:number,y:number)=>Math.abs(x*7+y*11)%4;
export const ENCOUNTER_LABEL:Record<EncounterKind,string>={camp:'Bandit camp',cave:'Cavern',ruin:'Ancient ruins'};
export const encounterEnemies=(kind:EncounterKind):MobKind[]=>kind==='camp'?['banditClubman','banditArcher','banditClubman','banditArcher','banditClubman','banditClubman']:kind==='cave'?['caveSpider','caveBat','giantSpider','caveSpider','caveBat']:['skeleton','skeleton','giantSpider','skeleton','skeleton'];
const cache=new Map<string,{map:InteriorMap;solid:Uint8Array}>();
// Separate maps use the proven mine interior wire format and combat, without creating overworld mobs.
export function encounterMap(kind:EncounterKind,variant=0){
 const key=kind+':'+variant;const hit=cache.get(key);if(hit)return hit;
 const w=29,h=27,cells=Array<string>(w*h).fill('#');
 const set=(x:number,y:number,t='.')=>{cells[y*w+x]=t;};
 if(kind==='cave'){
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(Math.hypot((x-9)/8,(y-10)/8)<1||Math.hypot((x-20)/7,(y-10)/8)<1||Math.hypot((x-14)/6,(y-20)/6)<1)set(x,y);
  for(let y=8;y<26;y++)for(let x=12;x<=16;x++)set(x,y);
 }else{
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)set(x,y);
  if(kind==='ruin'){
   // One connected ruined complex with several rooms and open doorways.
   for(let y=2;y<23;y++)if(![7,8,18,19].includes(y)){set(9,y,'#');set(20,y,'#');}
   for(let x=1;x<w-1;x++)if(![4,5,13,14,15,24,25].includes(x))set(x,14,'#');
  }
 }
 const exit={x:14,y:26},spawn={x:14,y:24};set(exit.x,exit.y,'E');set(14,25);set(14,24);
 const props:InteriorMap['props']=[];
 const prop=(p:InteriorProp,x:number,y:number)=>{if(cells[y*w+x]==='.')props.push({prop:p,x,y,facing:'s'});};
 if(kind==='camp'){
  for(const [x,y]of [[5,5],[23,5],[5,18],[23,18]])prop('campTent',x,y);
  prop('prisonCage',14,4);prop('hearth',14,12);prop('weaponRack',3,11);prop('barrel',25,11);prop('crates',24,12);
 }else if(kind==='cave'){
  for(const [x,y]of [[5,7],[6,13],[23,7],[22,14],[10,20],[18,21]])prop('rockBlock',x,y);
  prop('chest',22,4);
 }else{
  prop('statue',14,5);prop('chest',25,4);for(const [x,y]of [[4,5],[6,20],[24,20],[17,10]])prop('ruinRubble',x,y);
 }
 if(kind==='camp'){
  prop('banditTower',2,3);prop('banditTower',26,3);prop('crates',4,12);prop('barrel',24,21);
 }else{
  for(const [x,y]of [[4,8],[7,12],[23,12],[8,21],[21,22],[17,6],[13,16],[18,19]])prop((x+y)%3===0?'skullBones':(x+y)%3===1?'fallenSkeleton':'cobweb',x,y);
  for(const [x,y]of [[3,6],[24,6],[6,18],[23,20]])prop('overgrowth',x,y);
 }
 const lairs=(kind==='camp'?[[6,9],[22,9],[7,21],[21,21],[12,8],[17,8]]:kind==='cave'?[[7,9],[22,10],[14,17],[10,6],[20,6]]:[[5,7],[24,7],[14,10],[5,21],[24,21]]).map(([x,y])=>({x,y}));
 const map:InteriorMap={templateId:'mine',label:ENCOUNTER_LABEL[kind],level:1,variant,storey:0,w,h,floor:kind==='ruin'?'stone':'dirt',wall:kind==='camp'?'wood':'stone',cells:cells.join(''),props,slots:[],exit,spawn,stairs:null,lairs};
 const result={map,solid:interiorSolidGrid(map)};cache.set(key,result);return result;
}
