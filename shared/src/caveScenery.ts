import {interiorSolidGrid,type InteriorMap} from './interiors.js';
import {caveRails,caveRailPieces} from './caveRails.js';
import {undergroundMineralUrl} from './undergroundArt.js';
export interface CaveDressing {x:number;y:number;url:string;w:number;h:number;floor?:boolean;wall?:boolean;rotation?:number;frame?:'top';offsetX?:number;offsetY?:number}
const root='/sprites/underground-v2/',art='/sprites/underground-v4/';
const cache=new WeakMap<InteriorMap,CaveDressing[]>();
export function caveScenery(map:InteriorMap):CaveDressing[]{
 const old=cache.get(map);if(old)return old;
 const solid=interiorSolidGrid(map),used=new Set(map.props.map(p=>p.y*map.w+p.x)),seed=map.underground?.seed??map.w*739+map.h*31;
 const landmarks=map.underground?.landmarks??[{id:0,x:Math.floor(map.w/2),y:Math.floor(map.h/2)}],out:CaveDressing[]=[],tracks=caveRails(map),railCells=new Set(tracks.map(p=>p.y*map.w+p.x));
 if(tracks.length){
  const start=tracks[0];out.push({x:start.x,y:start.y,url:'/sprites/underground-v3/platform.png',w:2,h:2,floor:true});
  for(const t of tracks){
   for(const piece of caveRailPieces(t.mask))out.push({x:t.x,y:t.y,url:art+(piece.curve?'rail-ne.png':'rail-ns.png'),w:1,h:piece.half?.5:1,floor:true,rotation:piece.rotation,...(piece.half?{frame:'top' as const}:{}),offsetX:piece.ox,offsetY:piece.oy});
   used.add(t.y*map.w+t.x);
  }
  if(map.underground?.kind==='mine'){
   for(const end of [tracks[tracks.length-4],tracks.find(p=>p.x>30&&p.y<15)])if(end&&Math.hypot(end.x-map.spawn.x,end.y-map.spawn.y)>3)out.push({x:end.x,y:end.y,url:'/sprites/underground-v3/minecart.png',w:1,h:.9});
  }
 }
 const safe=(x:number,y:number)=>x>0&&y>0&&x<map.w-1&&y<map.h-1&&!solid[y*map.w+x]&&!used.has(y*map.w+x)&&Math.hypot(x-map.spawn.x,y-map.spawn.y)>=3&&Math.hypot(x-map.exit.x,y-map.exit.y)>=3&&!map.slots.some(p=>Math.abs(p.x-x)<=1&&Math.abs(p.y-y)<=1)&&!map.lairs?.some(p=>Math.hypot(p.x-x,p.y-y)<1.5)&&!map.props.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<=1);
 const choices=[{url:root+'fungus.png',w:1.1,h:.8},{url:root+'bone-rock.png',w:1.1,h:.85},{url:root+'ore-rock.png',w:.85,h:.7},{url:'/sprites/regions-v4/web.png',w:1.4,h:1}];
 for(const s of landmarks){let count=0;for(let n=0;n<100&&count<8;n++){
  const q=(n*37+s.id*11+seed%81)%81,x=s.x-4+q%9,y=s.y-4+Math.floor(q/9),i=y*map.w+x;
  if(!safe(x,y)||Math.abs(x-s.x)<=1||Math.abs(y-s.y)<=1)continue;
  const hash=(Math.imul(x+17,73856093)^Math.imul(y+91,19349663)^seed)>>>0;
  const a=map.underground?.kind==='mine'?(hash%4===0?choices[0]:hash%4===3?choices[3]:{url:undergroundMineralUrl(map,x,y),w:.9,h:.8}):choices[hash%choices.length];out.push({x,y,...a});used.add(i);count++;
 }}
 if(map.underground?.kind==='mine')for(const s of landmarks.filter(p=>[1,3,5,7,9].includes(p.id))){
  let nprops=0;for(let n=0;n<121&&nprops<2;n++){
   const q=(n*43+s.id*17+seed%121)%121,x=s.x-5+q%11,y=s.y-5+Math.floor(q/11);if(!safe(x,y)||[...railCells].some(i=>Math.abs(i%map.w-x)+Math.abs(Math.floor(i/map.w)-y)<2))continue;
   const names=s.id%3===0?['workbench','tool-rack']:['tool-rack','wheelbarrow'];out.push({x,y,url:art+names[nprops]+'.png',w:nprops?1.2:1.4,h:1.2});used.add(y*map.w+x);nprops++;
  }
 }
 // Ore at wall bases uses the same resource table as the actual mine layer.
 const open=(x:number,y:number)=>x>=0&&y>=0&&x<map.w&&y<map.h&&!['#',' '].includes(map.cells[y*map.w+x]);
 for(let y=1;y<map.h-1;y++)for(let x=1;x<map.w-1;x++)if(map.cells[y*map.w+x]==='#'&&(open(x,y+1)||open(x+1,y)||open(x-1,y))){
  const hash=(Math.imul(x+7,73856093)^Math.imul(y+19,19349663)^seed)>>>0;if(hash%(map.underground?.kind==='mine'?9:23)!==0)continue;
  out.push({x,y,url:undergroundMineralUrl(map,x,y),w:.65,h:.65,wall:true});
 }
 cache.set(map,out);return out;
}
