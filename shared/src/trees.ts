// Stable tree sizes: existing worlds gain variety without changing tile IDs or saves.
export function treeAt(x: number, y: number) {
 const h=(Math.imul(x+17,73856093)^Math.imul(y+31,19349663))>>>0;
 const n=h%10;
 return n<2?{name:'Sapling',scale:.58,wood:1}:n<8?{name:'Tree',scale:1,wood:3}:{name:'Large tree',scale:1.45,wood:6};
}
