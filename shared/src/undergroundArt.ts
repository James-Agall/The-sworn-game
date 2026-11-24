import {TileType} from './protocol.js';
import type {InteriorMap} from './interiors.js';
import {MINE_LAYER_YIELDS,type MineResource} from './mines.js';
const root='/sprites/underground-v4/',old='/sprites/underground-v2/';
export const undergroundFloorUrl=(_m:InteriorMap)=>'/sprites/underground-v3/stone-floor.png';
export const CAVE_WALL_ART={face:root+'cliff-face.png',rim:root+'rock-rim.png',side:root+'side-wall.png',body:root+'rock-body.png'};
export function undergroundWallUrl(_m:InteriorMap,_mask:number){return CAVE_WALL_ART.face;}
export function undergroundResources(m:InteriorMap):MineResource[]{return m.underground?.kind==='mine'&&!m.underground.rockOnly?(MINE_LAYER_YIELDS[(m.underground.depth??1)-1]??MINE_LAYER_YIELDS[0]).map(v=>v.res):[];}
export function undergroundMineralUrl(m:InteriorMap,x:number,y:number){
 const resources=undergroundResources(m);if(!resources.length)return m.underground?.rockOnly?'/sprites/regions-v3/rock-block.png':old+'crystals.png';
 const nodes=m.props.filter(p=>p.prop==='oreFace'||p.prop==='mineralNode'),index=nodes.findIndex(p=>p.x===x&&p.y===y),choice=resources[(index<0?Math.abs(x*7+y*11):index)%resources.length];return root+choice+'.png';
}
export function undergroundPropUrl(m:InteriorMap,prop:string,tile?:number,x=0,y=0){
 return prop==='oreFace'||prop==='mineralNode'?(tile===TileType.RockMinePost?'/sprites/regions-v3/rock-block.png':undergroundMineralUrl(m,x,y))
 :prop==='stalagmite'?old+'stalagmites.png':prop==='rockBlock'?old+'rock-column.png'
 :prop==='timberProp'?'/sprites/autumn/frames/cave-props/supports-stairs-01.png':prop==='mineShaft'?'/sprites/autumn/frames/cave-props/supports-stairs-07.png':undefined;
}
export function undergroundPropSize(prop:string){return prop==='rockBlock'?{w:1.5,h:2.5}:prop==='stalagmite'?{w:1.6,h:1.9}:prop==='mineralNode'?{w:1.3,h:1.3}:prop==='timberProp'?{w:1.1,h:1.5}:prop==='mineShaft'?{w:1,h:1}:{w:1.2,h:1.3};}
