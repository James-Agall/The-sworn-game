import {interiorSolidGrid,type InteriorMap} from './interiors.js';
export interface CaveDressing {x:number;y:number;url:string;w:number;h:number;floor?:boolean;rotation?:number}
const root='/sprites/underground-v2/';
const cache=new WeakMap<InteriorMap,CaveDressing[]>();
// Cosmetic floor dressing stays out of the existing collision/work/combat state.
export function caveScenery(map:InteriorMap):CaveDressing[]{
 const old=cache.get(map);if(old)return old;
 const solid=interiorSolidGrid(map),used=new Set(map.props.map(p=>p.y*map.w+p.x)),seed=map.underground?.seed??map.w*739+map.h*31;
 const sections=map.underground?.landmarks??[{id:0,x:Math.floor(map.w/2),y:Math.floor(map.h/2)}];
 const out:CaveDressing[]=[];
 const tracks=map.underground?.tracks??[],art='/sprites/underground-v3/';
 // Platforms and track are decorative ground layers; native walk/mining collision stays authoritative.
 if(tracks.length){
  const start=tracks[0];out.push({x:start.x,y:start.y,url:art+'platform.png',w:2,h:2,floor:true});
  for(const t of tracks){
   let name='rail-ns',rotation=0;
   if(t.mask===3){name='rail-ne';}else if(t.mask===6){name='rail-ne';rotation=1;}else if(t.mask===12){name='rail-ne';rotation=2;}else if(t.mask===9){name='rail-ne';rotation=3;}
   else if((t.mask&10)&&!(t.mask&5))name='rail-ew';
   out.push({x:t.x,y:t.y,url:art+name+'.png',w:1,h:1,floor:true,rotation});used.add(t.y*map.w+t.x);
  }
  if(map.underground?.kind==='mine'){const end=tracks[tracks.length-4]??start;out.push({x:end.x,y:end.y,url:art+'minecart.png',w:1.25,h:1.1});}
 }

 const choices=[{url:root+'fungus.png',w:1.1,h:.8},{url:root+'bone-rock.png',w:1.1,h:.85},{url:root+'ore-rock.png',w:.85,h:.7},{url:'/sprites/regions-v4/web.png',w:1.4,h:1}];
 for(const s of sections){let count=0;for(let n=0;n<100&&count<8;n++){
  const q=(n*37+s.id*11+seed%81)%81,x=s.x-4+q%9,y=s.y-4+Math.floor(q/9),i=y*map.w+x;
  if(x<1||y<1||x>=map.w-1||y>=map.h-1||solid[i]||used.has(i)||Math.abs(x-s.x)<=1||Math.abs(y-s.y)<=1||Math.hypot(x-map.spawn.x,y-map.spawn.y)<3||Math.hypot(x-map.exit.x,y-map.exit.y)<3||map.slots.some(p=>Math.abs(p.x-x)<=1&&Math.abs(p.y-y)<=1)||map.props.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<=1))continue;
  const h=(Math.imul(x+17,73856093)^Math.imul(y+91,19349663)^seed)>>>0;
  const a=map.underground?.kind==='mine'?choices[[2,2,0,3][h%4]]:choices[h%choices.length];out.push({x,y,...a});used.add(i);count++;
 }}
 cache.set(map,out);return out;
}
