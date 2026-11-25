import {TileType as T} from './protocol.js';
import {treeSizeClass} from './trees.js';
// Physical bases in 32px tiles. Placement, harvesting and artwork still use the original tile IDs.
// Zero means this is not a compact obstacle: buildings, fences, walls and water retain full cells.
const TREE_RADII=[3,5,8] as const;
const radii=new Float32Array(256);
for(const [tile,radius]of [[T.FruitTree,5],[T.FruitTreePicked,5],[T.PropBarrel,7],[T.PropCrate,9],[T.PropLanternPost,3],[T.PropCross,4],[T.PropCampfire,7],[T.RuinStatue,8],[T.RuinRubble,10],[T.Rock,11],[T.IronOre,11],[T.TownQuestBoard,7]])radii[tile]=radius;
export function compactObstacle(tile:number):boolean {return tile===T.Tree||radii[tile]>0;}
export function sceneryRadius(tile:number,tx:number,ty:number):number {
 return tile===T.Tree?TREE_RADII[treeSizeClass(tx,ty)]:radii[tile]??0;
}
