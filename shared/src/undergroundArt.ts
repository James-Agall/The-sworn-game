import {TileType} from './protocol.js';
import type {InteriorMap} from './interiors.js';
const root='/sprites/underground-v2/';
export const undergroundFloorUrl=(_m:InteriorMap)=>'/sprites/underground-v3/stone-floor.png';
export const CAVE_WALL_ART={face:'/sprites/underground-v3/cliff-face.png',rim:'/sprites/underground-v3/rock-rim.png',side:'/sprites/underground-v3/side-wall.png'};
// Retained for exports and older callers; faces are selected from exposed floor edges by the renderer.
export function undergroundWallUrl(_m:InteriorMap,_mask:number){return CAVE_WALL_ART.face;}
export function undergroundPropUrl(m:InteriorMap,prop:string,tile?:number){
 return prop==='oreFace'?(m.underground?.rockOnly||tile===TileType.RockMinePost?'/sprites/regions-v3/rock-block.png':root+'ore-rock.png')
 :prop==='mineralNode'?root+'crystals.png':prop==='stalagmite'?root+'stalagmites.png':prop==='rockBlock'?root+'rock-column.png'
 :prop==='timberProp'?'/sprites/autumn/frames/cave-props/supports-stairs-01.png':prop==='mineShaft'?'/sprites/autumn/frames/cave-props/supports-stairs-07.png':undefined;
}
export function undergroundPropSize(prop:string){return prop==='rockBlock'?{w:1.5,h:2.5}:prop==='stalagmite'?{w:1.6,h:1.9}:prop==='mineralNode'?{w:1.3,h:1.6}:prop==='timberProp'?{w:1.1,h:1.5}:prop==='mineShaft'?{w:1,h:1}:{w:1.2,h:1.3};}
