import {interiorSolidGrid,type InteriorMap} from './interiors.js';
export interface CaveDressing {x:number;y:number;url:string;w:number;h:number}
const root='/sprites/underground-v2/';
const cache=new WeakMap<InteriorMap,CaveDressing[]>();
// Cosmetic floor dressing stays out of the existing collision/work/combat state.
export function caveScenery(map:InteriorMap):CaveDressing[]{
 const old=cache.get(map);if(old)return old;
 const solid=interiorSolidGrid(map),used=new Set(map.props.map(p=>p.y*map.w+p.x)),seed=map.underground?.seed??map.w*739+map.h*31;
 const sections=map.underground?.sections??[{id:0,x:Math.floor(map.w/2),y:Math.floor(map.h/2)}];
 const out:CaveDressing[]=[];
 const choices=[{url:root+'fungus.png',w:1.1,h:.8},{url:root+'bone-rock.png',w:1.1,h:.85},{url:root+'ore-rock.png',w:.85,h:.7},{url:'/sprites/regions-v4/web.png',w:1.4,h:1}];
 for(const s of sections){let count=0;for(let n=0;n<100&&count<8;n++){
  const q=(n*37+s.id*11+seed%81)%81,x=s.x-4+q%9,y=s.y-4+Math.floor(q/9),i=y*map.w+x;
  if(x<1||y<1||x>=map.w-1||y>=map.h-1||solid[i]||used.has(i)||Math.abs(x-s.x)<=1||Math.abs(y-s.y)<=1||Math.hypot(x-map.spawn.x,y-map.spawn.y)<3||Math.hypot(x-map.exit.x,y-map.exit.y)<3||map.slots.some(p=>Math.abs(p.x-x)<=1&&Math.abs(p.y-y)<=1)||map.props.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<=1))continue;
  const h=(Math.imul(x+17,73856093)^Math.imul(y+91,19349663)^seed)>>>0;
  const a=map.underground?.kind==='mine'?choices[[2,2,0,3][h%4]]:choices[h%choices.length];out.push({x,y,...a});used.add(i);count++;
 }}
 cache.set(map,out);return out;
}
