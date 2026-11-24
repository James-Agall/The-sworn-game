import {TileType} from './protocol.js';
import type {InteriorMap} from './interiors.js';
const root='/sprites/autumn/frames/';
export const undergroundFloorUrl=(_m:InteriorMap)=>'/sprites/structure/extra/floor_dirt_1.png';
export function undergroundWallUrl(m:InteriorMap,mask:number){const material=m.underground?.kind==='cave'?'moss':(m.underground?.depth??1)>=3?'basalt':'limestone';return root+'cave-walls/'+material+'-'+(mask<8?'00-07':'08-15')+'-'+String(mask%8+1).padStart(2,'0')+'.png';}
export function undergroundPropUrl(m:InteriorMap,prop:string,tile?:number){const d=m.underground?.depth??1;
 return prop==='oreFace'?root+'cave-props/mineral-deposits-'+(m.underground?.rockOnly||tile===TileType.RockMinePost?'03':d===1?'04':d===2?'01':'07')+'.png':prop==='mineralNode'?root+'cave-props/mineral-deposits-05.png':prop==='stalagmite'?root+'cave-props/rock-formations-02.png':prop==='timberProp'?root+'cave-props/supports-stairs-01.png':prop==='mineShaft'?root+'cave-props/supports-stairs-07.png':undefined;
}
