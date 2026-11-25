// Stable tree sizes: existing worlds gain variety without changing tile IDs or saves.
// Felling (2026-11-19): a chop gives no wood; a tree falls after `chops` chops (hero swings or lumberjack strikes)
// and only then pays out its `wood`.
export const TREE_CHOPS = { sapling: 2, tree: 5, large: 10 } as const;
export const TREE_WOOD = { sapling: 1, tree: 3, large: 6 } as const;
// Chop progress on a tree left untouched this long (ticks; 60 s at 20 ticks/s) is lost.
export const TREE_CHOP_DECAY_TICKS = 60 * 20;
export function treeSizeClass(x:number,y:number):0|1|2 {
 const h=(Math.imul(x+17,73856093)^Math.imul(y+31,19349663))>>>0;
 const n=h%10;return n<2?0:n<8?1:2;
}
export function treeAt(x: number, y: number) {
 const size=treeSizeClass(x,y);
 return size===0?{name:'Sapling',scale:.58,wood:TREE_WOOD.sapling,chops:TREE_CHOPS.sapling}
  :size===1?{name:'Tree',scale:1,wood:TREE_WOOD.tree,chops:TREE_CHOPS.tree}
  :{name:'Large tree',scale:1.45,wood:TREE_WOOD.large,chops:TREE_CHOPS.large};
}
