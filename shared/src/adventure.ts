import {interiorSolidGrid,interiorLayoutAccessible,type InteriorMap,type InteriorProp} from './interiors.js';
export type ExplorationKind='camp'|'cave'|'ruin'|'mine';
export type ExplorationObjectKind='crate'|'barrel'|'pot'|'chest'|'cache'|'note'|'key'|'gate'|'cage'|'barricade'|'oil'|'alarm'|'lever'|'lamp';
export interface ExplorationObject {id:string;kind:ExplorationObjectKind;x:number;y:number;prop:InteriorProp;label:string;locked?:boolean;secret?:boolean;maxHp?:number}
export interface ExplorationObjectLive extends ExplorationObject {hp?:number;opened?:boolean;empty?:boolean;read?:boolean;available:boolean;prompt:string}
export interface ExplorationView {objects:ExplorationObjectLive[];keys:number;cleared:boolean;pattern?:string;stealth?:string}
export interface ExplorationPlan {map:InteriorMap;objects:ExplorationObject[];lockedRoom:boolean}
export const EXPLORATION_REACH=1.65;
export function adventureHash(s:string){let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
export function explorationPlan(base:InteriorMap,kind:ExplorationKind,seed:number):ExplorationPlan{
 const map:InteriorMap={...base,props:base.props.map(p=>({...p})),...(base.ruin?{ruin:{...base.ruin,surfaces:base.ruin.surfaces}}:{})},objects:ExplorationObject[]=[];
 const add=(type:ExplorationObjectKind,x:number,y:number,prop:InteriorProp,label:string,extra:Partial<ExplorationObject>={})=>{const o={id:`${type}:${x},${y}`,kind:type,x,y,prop,label,...extra};objects.push(o);return o;};
 for(const p of map.props){if(p.prop==='crates')add('crate',p.x,p.y,p.prop,'Supply crate',{maxHp:9});else if(p.prop==='barrel')add('barrel',p.x,p.y,p.prop,'Old barrel',{maxHp:7});else if(p.prop==='chest'&&kind!=='mine')add('chest',p.x,p.y,p.prop,kind==='ruin'?'Relic coffer':'Spoils chest');else if(p.prop==='prisonCage')add('cage',p.x,p.y,p.prop,'Prisoner cage',{locked:true});}
 const empty=(x:number,y:number)=>x>1&&y>1&&x<map.w-2&&y<map.h-2&&map.cells[y*map.w+x]==='.'&&!map.props.some(p=>Math.hypot(p.x-x,p.y-y)<1.5)&&!map.lairs?.some(p=>Math.hypot(p.x-x,p.y-y)<2)&&Math.hypot(x-map.spawn.x,y-map.spawn.y)>3;
 const spots:{x:number;y:number;rank:number}[]=[];for(let y=2;y<map.h-2;y++)for(let x=2;x<map.w-2;x++)if(empty(x,y))spots.push({x,y,rank:adventureHash(`${seed}:${x},${y}`)});spots.sort((a,b)=>a.rank-b.rank);
 const put=(kind:ExplorationObjectKind,prop:InteriorProp,label:string,extra:Partial<ExplorationObject>={})=>{const at=spots.find(p=>empty(p.x,p.y));if(!at)return;map.props.push({prop,x:at.x,y:at.y,facing:'s'});if(!interiorLayoutAccessible(map)){map.props.pop();return;}return add(kind,at.x,at.y,prop,label,extra);};
 // Functional props reuse the shipped art; every placement preserves the main route.
  put('oil','barrel','Pitch barrel — explosive',{maxHp:8});
  put('lamp','lamp','Lantern — toggle light');
  if(kind==='camp')put('alarm','candelabra','Signal brazier — destroy to silence',{maxHp:10});
  put('note','adventureNote',kind==='camp'?'Stolen dispatch':kind==='ruin'?'Weathered inscription':kind==='mine'?'Foremans survey':'Lost expedition journal');
 put('key','adventureKey','Iron ring of keys');
 put('cache','adventureCache',kind==='cave'?'Loose stones':'Concealed cache',{secret:true});
 for(let n=0;n<3;n++)put('pot','adventurePot',kind==='ruin'?'Ancient pot':'Storage jar',{maxHp:4});
 if(!objects.some(o=>o.kind==='chest'))put('chest','chest','Treasure chest');
 if(!objects.some(o=>o.kind==='cage'))put('cage','prisonCage',kind==='camp'?'Captured courier':'Trapped explorer',{locked:true});
 // A small genuine side room, reached through a locked door. The open version
 // must preserve every existing route, workstation, enemy lair and entrance.
 let lockedRoom=false;
 outer:for(const at of spots){
  if(!empty(at.x,at.y))continue;
  for(const sign of [-1,1]){
   const cx=at.x,cy=at.y+sign*3,dy=at.y+sign;
   if(cx<3||cx>=map.w-3||cy<3||cy>=map.h-3)continue;
   const ring:number[]=[];let ok=true;
   for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++){
    const i=y*map.w+x;if(map.props.some(p=>p.x===x&&p.y===y)||map.lairs?.some(p=>Math.hypot(p.x-x,p.y-y)<1.5)||Math.hypot(x-map.exit.x,y-map.exit.y)<3||Math.hypot(x-map.spawn.x,y-map.spawn.y)<3)ok=false;
    if(kind!=='camp'&&'.E'.includes(map.cells[i]))ok=false;ring.push(i);
   }
   if(!ok)continue;
   const old=map.cells,cells=old.split('');for(const i of ring){const x=i%map.w,y=Math.floor(i/map.w);cells[i]=Math.abs(x-cx)<=1&&Math.abs(y-cy)<=1?'.':'#';}cells[dy*map.w+cx]='.';map.cells=cells.join('');
   if(!interiorLayoutAccessible(map)){map.cells=old;continue;}
   const chest={x:cx,y:cy};map.props.push({prop:'chest',...chest,facing:'s'});if(!interiorLayoutAccessible(map)){map.props.pop();map.cells=old;continue;}
   add('chest',cx,cy,'chest',kind==='ruin'?'Sealed reliquary':kind==='cave'?'Expedition strongbox':'Locked pay chest',{locked:true});
   map.props.push({prop:'adventureGate',x:cx,y:dy,facing:'s'});add('gate',cx,dy,'adventureGate','Locked storeroom door',{locked:true});
    // A separately breakable alternative, when the surrounding floor can really reach it.
    for(const side of [-1,1]){const bx=cx+side*2,by=cy,outside=bx+side;if(map.cells[by*map.w+outside]!=='.')continue;const before=map.cells,c=before.split('');c[by*map.w+bx]='.';map.cells=c.join('');map.props.push({prop:'crates',x:bx,y:by,facing:'s'});const open={...map,props:map.props.filter(q=>q.prop!=='adventureGate')};if(interiorLayoutAccessible(open)){add('barricade',bx,by,'crates','Barricaded side passage',{maxHp:18});break;}map.props.pop();map.cells=before;}
    put('lever','workbench','Storeroom winch — opens the side passage');
   if(map.ruin){const s=map.ruin.surfaces.split('');for(const i of ring)s[i]='s';s[dy*map.w+cx]='p';map.ruin={...map.ruin,surfaces:s.join('')};}
   lockedRoom=true;break outer;
  }
 }
 // Four encounter shapes, each with three seeded arrangements. Native enemy spawning uses these lairs.
  const pattern=Math.floor(seed/3)%4,variant=seed%3,grid=interiorSolidGrid(map);
  const reachable=new Set<number>(),queue=[map.spawn.y*map.w+map.spawn.x];reachable.add(queue[0]);for(let n=0;n<queue.length;n++){const i=queue[n],x=i%map.w,y=Math.floor(i/map.w);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy,j=yy*map.w+xx;if(xx<0||yy<0||xx>=map.w||yy>=map.h||grid[j]||reachable.has(j))continue;reachable.add(j);queue.push(j);}}
  const candidates=spots.filter(p=>reachable.has(p.y*map.w+p.x)&&!grid[p.y*map.w+p.x]&&Math.hypot(p.x-map.spawn.x,p.y-map.spawn.y)>5);
  const center={x:map.w/2,y:map.h/2};
  if(candidates.length&&map.lairs?.length){const chosen:{x:number;y:number}[]=[];for(let i=0;i<map.lairs.length;i++){
   const target=pattern===0?{x:map.spawn.x+(i%3-1)*(2+variant),y:map.spawn.y-6-variant-i}:pattern===1?{x:i%2?map.w-4-variant:3+variant,y:4+(i*5)%(map.h-8)}:pattern===2?(objects.find(o=>o.kind==='alarm')??center):{x:center.x+(i%3-1)*(3+variant),y:center.y+(Math.floor(i/3)%3-1)*4};
   const at=candidates.filter(p=>!chosen.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<2)).sort((a,b)=>Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(b.x-target.x,b.y-target.y))[0];if(at)chosen.push({x:at.x,y:at.y});
  }if(chosen.length)map.lairs=chosen;}
  return{map,objects,lockedRoom};
}
export type BossStyle='captain'|'archer'|'assassin'|'spider'|'champion'|'guardian'|'beast'|'swoop';
export interface BossProfile {style:BossStyle;attack:string;windup:number;recovery:number;range:number;radius:number;cooldown:number;damage:number;hint:string;summon?:boolean}
export const BOSS_PROFILES:Record<string,BossProfile>={
 'king-rusk':{style:'captain',attack:'Royal cleave',windup:18,recovery:19,range:1.8,radius:1.35,cooldown:38,damage:1.25,summon:true,hint:'His axe rises before a broad cleave. Strike while he recovers; his rally can only call two extra bandits.'},
 'veyla-red':{style:'assassin',attack:'Red riposte',windup:13,recovery:17,range:2.4,radius:.7,cooldown:31,damage:1.1,hint:'She marks the ground before lunging. Step aside and punish the recovery.'},
 'harrow-pike':{style:'champion',attack:'Jailers thrust',windup:17,recovery:18,range:2.8,radius:.55,cooldown:35,damage:1.15,hint:'His spear covers a narrow line. Move sideways after he commits.'},
 'moth-black':{style:'archer',attack:'Poisoned arrow',windup:20,recovery:15,range:5,radius:.55,cooldown:40,damage:1.05,hint:'She aims at your last position, then looses. Cover and lateral movement spoil the shot.'},
 'ulric-cinder':{style:'champion',attack:'Shield counter',windup:20,recovery:23,range:1.7,radius:.95,cooldown:35,damage:1.25,hint:'His shield reduces frontal hits while ready. His counter leaves him exposed.'},
 'bela-crow':{style:'captain',attack:'Smugglers sweep',windup:17,recovery:19,range:1.9,radius:1.1,cooldown:36,damage:1.15,summon:true,hint:'Watch her axe hand. Below half health she can signal two smugglers, once.'},
 'sable-venn':{style:'assassin',attack:'Hidden blade',windup:15,recovery:15,range:2.8,radius:.6,cooldown:32,damage:1.15,hint:'The false pilgrim pauses before a knife rush. Moving after the warning avoids the committed strike.'},
 'grent-hook':{style:'guardian',attack:'Tollbreakers smash',windup:26,recovery:26,range:1.7,radius:1.4,cooldown:48,damage:1.5,hint:'His heavy club is slow. Leave the marked circle, then attack during the long recovery.'},
 'sister-thorn':{style:'champion',attack:'Broken oath',windup:21,recovery:23,range:1.7,radius:1.1,cooldown:37,damage:1.25,hint:'Her guarded stance ends when the mace falls. Save your strongest strike for that opening.'},
 'marrow-jack':{style:'assassin',attack:'Graverobbers cut',windup:14,recovery:17,range:2.5,radius:.7,cooldown:33,damage:1.2,hint:'His skull mask hides his face, not his wind-up. Dodge the marked rush.'},
 'widow-of-the-well':{style:'spider',attack:'Widows web',windup:22,recovery:20,range:4.5,radius:1.2,cooldown:42,damage:.75,summon:true,hint:'Her pale abdomen warns of a web. Leave the marked ground; the web slows anyone who remains.'},
 'crownless-weeper':{style:'champion',attack:'Funeral arc',windup:25,recovery:27,range:2,radius:1.3,cooldown:44,damage:1.5,hint:'The broken sword rises slowly. Its broad strike is followed by a generous opening.'},
 'the-ash-abbot':{style:'guardian',attack:'Ashen prayer',windup:28,recovery:25,range:3.5,radius:1.5,cooldown:49,damage:1.1,hint:'His censer marks an ash circle before it burns. He cannot turn the prayer once it begins.'},
 'old-granite':{style:'guardian',attack:'Quarry slam',windup:32,recovery:32,range:2,radius:1.8,cooldown:52,damage:1.65,hint:'Cracks brighten before the slam. Back away, then strike the exposed seams while the guardian settles.'},
 'pale-mother':{style:'spider',attack:'Brood snare',windup:23,recovery:23,range:4,radius:1.3,cooldown:44,damage:.7,summon:true,hint:'Her web has a long warning. Below half health she can hatch only two young spiders.'},
 'rattlethane':{style:'champion',attack:'Boneguard counter',windup:23,recovery:26,range:1.8,radius:1.1,cooldown:42,damage:1.35,hint:'The round shield protects his front until he commits his axe. Circle him or wait for recovery.'},
 'bellwing':{style:'swoop',attack:'Bellwing dive',windup:20,recovery:21,range:4,radius:.8,cooldown:39,damage:1.1,hint:'The wings spread before a straight dive. Move off the marked flight line.'},
 'mirejaw':{style:'beast',attack:'Burrow charge',windup:24,recovery:24,range:3.6,radius:1,cooldown:44,damage:1.35,hint:'Its jaw opens before a committed charge. Rock and corners stop the rush.'},
 'the-hollow-bride':{style:'assassin',attack:'Mourners reaping',windup:20,recovery:24,range:2.7,radius:.9,cooldown:39,damage:1.25,hint:'Her sickle follows a marked lunge. Step away after the veil lifts.'},
 'coalheart':{style:'guardian',attack:'Ember eruption',windup:30,recovery:28,range:3.7,radius:1.6,cooldown:50,damage:1.4,hint:'Embers gather in a marked patch before erupting. The cracks cool during recovery.'},
};
export interface BossAttackLive {phase:'windup'|'recovery';name:string;style:BossStyle;x:number;y:number;fromX:number;fromY:number;radius:number;progress:number}
export interface JournalEntry {id:string;title:string;status:'available'|'active'|'complete';text:string;objective:string;progress?:string;blocked?:string;reward:string;marker?:{x:number;y:number;label:string};choices?:{id:string;label:string}[]}
export interface JournalView {entries:JournalEntry[];characters:{id:string;name:string;title:string;bio:string;address:string}[];clues:string[];keys:string[];tracked?:string;trackedEntry?:JournalEntry}
