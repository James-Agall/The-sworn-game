import {loadTexture} from './atlas';
import type{Texture}from'pixi.js';
const frames=new Map<string,Texture>();let requested=false;
export function npcVariantFrame(id:string,facing:string,frame:number):Texture|undefined{
 if(!requested){requested=true;for(let row=0;row<4;row++)for(const face of ['n','e','s','w'])for(let f=0;f<3;f++){const key=`${row}_${face}_${f}`;void loadTexture(`/sprites/npc-variants/${key}.png`).then(t=>frames.set(key,t)).catch(()=>{});}}
 let h=0;for(const c of id)h=(Math.imul(h,31)+c.charCodeAt(0))>>>0;return frames.get(`${h%4}_${facing}_${Math.floor(frame)%3}`);
}
