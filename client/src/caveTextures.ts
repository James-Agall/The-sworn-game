import {Rectangle,Texture} from 'pixi.js';
const floors=new WeakMap<Texture,Texture[]>(),strips=new WeakMap<Texture,Texture[]>();
// UV slices preserve a continuous 2x2 floor material and a continuous three-cell cliff strip.
export function stoneFloorCell(t:Texture,x:number,y:number){
 let all=floors.get(t);if(!all){all=Array.from({length:4},(_,n)=>new Texture({source:t.source,frame:new Rectangle(t.frame.x+n%2*t.width/2,t.frame.y+Math.floor(n/2)*t.height/2,t.width/2,t.height/2)}));floors.set(t,all);}
 return all[((y%2+2)%2)*2+(x%2+2)%2];
}
export function cliffStripCell(t:Texture,index:number){
 let all=strips.get(t);if(!all){all=Array.from({length:3},(_,n)=>new Texture({source:t.source,frame:new Rectangle(t.frame.x+n*t.width/3,t.frame.y,t.width/3,t.height)}));strips.set(t,all);}
 return all[(index%3+3)%3];
}

const railHalves=new WeakMap<Texture,Texture>();
export function caveRailHalf(t:Texture){let half=railHalves.get(t);if(!half){half=new Texture({source:t.source,frame:new Rectangle(t.frame.x,t.frame.y,t.width,t.height/2)});railHalves.set(t,half);}return half;}
