import {scatterHostileInterior} from './hostileScatter.js';
import {interiorSolidGrid,interiorLayoutAccessible,type InteriorMap,type InteriorProp} from './interiors.js';
export interface RuinArea {id:string;role:string;label:string;type:'room'|'courtyard';x:number;y:number;w:number;h:number}
export interface RuinDoor {x:number;y:number;width:number;axis:'x'|'y'}
export interface RuinPlan {version:2;areas:RuinArea[];doors:RuinDoor[];surfaces:string}
const cache=new Map<number,{map:InteriorMap;solid:Uint8Array}>();
export function buildRuin(variant=0){
 const v=Math.max(0,Math.min(3,variant)),hit=cache.get(v);if(hit)return hit;
 const w=41,h=37,cells=Array<string>(w*h).fill(' '),surfaces=Array<string>(w*h).fill(' '),areas:RuinArea[]=[],doors:RuinDoor[]=[];
 const roles=[['crypt','treasury','stores','chapel'],['crypt','ossuary','stores','shrine'],['barracks','treasury','stores','hall'],['chapel','archive','stores','crypt']][v];
 const labels:Record<string,string>={crypt:'Crypt',treasury:'Treasury',stores:'Stores',chapel:'Chapel',ossuary:'Ossuary',shrine:'Shrine',barracks:'Barracks',hall:'Great hall',archive:'Archive'};
 const rect=(x:number,y:number,ww:number,hh:number,ch:string,surface=' ')=>{for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+ww;xx++)if(xx>0&&yy>0&&xx<w-1&&yy<h-1){cells[yy*w+xx]=ch;surfaces[yy*w+xx]=surface;}};
 const room=(id:string,role:string,x:number,y:number,ww:number,hh:number)=>{rect(x-2,y-2,ww+4,hh+4,'#');rect(x,y,ww,hh,'.','s');areas.push({id,role,label:labels[role]??'Gatehouse',type:'room',x,y,w:ww,h:hh});};
 room('north-west',roles[0],3,3,9,10);room('north-east',roles[1],30,3,8,10);
 room('west',roles[2],3,19,8,7);room('east',roles[3],30,20,8,10);
 room('gatehouse','gatehouse',15,30,11,4);
 for(const a of [{id:'main-court',role:'courtyard',label:'Main courtyard',x:15,y:12,w:11,h:14},{id:'garden',role:'garden',label:'Garden court',x:16,y:3,w:9,h:5}]){rect(a.x,a.y,a.w,a.h,'.','g');areas.push({...a,type:'courtyard'});}
 // Doorways and passageways cut through the thick walls, linking each wing to the court.
 rect(12,11,5,2,'.','p');doors.push({x:13,y:11,width:2,axis:'x'});
 rect(24,11,7,2,'.','p');doors.push({x:28,y:11,width:2,axis:'x'});
 rect(11,21,6,2,'.','p');doors.push({x:12,y:21,width:2,axis:'x'});
 rect(24,23,7,2,'.','p');doors.push({x:28,y:23,width:2,axis:'x'});
 rect(19,8,3,5,'.','p');doors.push({x:19,y:9,width:3,axis:'y'});
 rect(19,25,3,6,'.','p');doors.push({x:19,y:28,width:3,axis:'y'});
 rect(19,34,3,2,'.','p');
 // Open-air courts have a quiet earth/grass surface and distinct paved routes.
 for(let y=12;y<=25;y++)for(let x=19;x<=21;x++)surfaces[y*w+x]='p';
 for(let y=21;y<=22;y++)for(let x=15;x<=25;x++)surfaces[y*w+x]='p';
 for(let y=23;y<=24;y++)for(let x=22;x<=25;x++)surfaces[y*w+x]='p';
 for(let y=16;y<=20;y++)for(let x=18;x<=22;x++)surfaces[y*w+x]='p';
 for(let y=3;y<=7;y++)for(let x=19;x<=21;x++)surfaces[y*w+x]='p';
 const exit={x:20,y:35},spawn={x:20,y:32};cells[exit.y*w+exit.x]='E';
 const floor=cells.slice();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(floor[y*w+x]===' '&&[[0,-1],[1,0],[0,1],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]].some(([dx,dy])=>'.E'.includes(floor[(y+dy)*w+x+dx])))cells[y*w+x]='#';
 const lairs=[{x:7,y:7},{x:34,y:7},{x:20,y:21},{x:6,y:22},{x:34,y:25}];
 const map:InteriorMap={templateId:'mine',label:'Ancient ruins',level:1,variant:v,storey:0,w,h,floor:'stone',wall:'stone',cells:cells.join(''),props:[],slots:[],exit,spawn,stairs:null,lairs,ruin:{version:2,areas,doors,surfaces:surfaces.join('')}};
 const place=(prop:InteriorProp,x:number,y:number)=>{
  if(map.cells[y*w+x]!=='.'||map.props.some(p=>p.x===x&&p.y===y)||lairs.some(p=>Math.hypot(p.x-x,p.y-y)<1.5)||Math.hypot(x-spawn.x,y-spawn.y)<2)return;
  map.props.push({prop,x,y,facing:'s'});if(!interiorLayoutAccessible(map))map.props.pop();
 };
 for(const a of areas.filter(a=>a.type==='room')){
  if(['crypt','ossuary'].includes(a.role))for(const [dx,dy]of [[2,1],[6,1],[2,a.h-3],[6,a.h-3]])place('sarcophagus',a.x+dx,a.y+dy);
  else if(['chapel','shrine','hall'].includes(a.role)){place('altar',a.x+Math.floor(a.w/2),a.y+1);for(const [dx,dy]of [[2,4],[6,4],[2,7],[6,7]])if(dy<a.h-1&&dx<a.w-1)place('pew',a.x+dx,a.y+dy);}
  else if(a.role==='treasury'){place('chest',a.x+a.w-2,a.y+1);place('crates',a.x+1,a.y+1);place('barrel',a.x+1,a.y+a.h-2);}
  else if(a.role==='gatehouse'){place('ruinColumn',a.x+1,a.y+1);place('ruinColumn',a.x+a.w-2,a.y+1);}
  else{place('crates',a.x+1,a.y+1);place(a.role==='archive'?'shelf':'weaponRack',a.x+1,a.y+a.h-2);place('barrel',a.x+a.w-2,a.y+1);}
 }
 place('statue',20,18);
 for(const [x,y]of [[17,4],[23,4],[17,6],[23,6],[16,14],[24,14],[16,24],[24,25]])place('overgrowth',x,y);
 // Variants mirror the footprint, retaining clear room/courtyard identities.
 if(v%2){const mirror=(x:number)=>w-1-x,reverseRows=(s:string)=>Array.from({length:h},(_,y)=>s.slice(y*w,(y+1)*w).split('').reverse().join('')).join('');map.cells=reverseRows(map.cells);map.ruin!.surfaces=reverseRows(map.ruin!.surfaces);for(const p of [...map.props,...lairs,map.spawn,map.exit])p.x=mirror(p.x);for(const a of areas)a.x=w-a.x-a.w;for(const d of doors)d.x=d.axis==='y'?w-d.x-d.width:mirror(d.x);}
 scatterHostileInterior(map,'ruin',v*7919+6103);
 const result={map,solid:interiorSolidGrid(map)};cache.set(v,result);return result;
}
