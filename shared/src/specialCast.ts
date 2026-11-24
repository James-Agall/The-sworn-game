// Authored cast. Art rows are stable save IDs; never derive identity from a sprite index.
import {SPECIAL_CAST_DATA} from './specialCastData.js';
export interface SpecialCharacter {
 id:string; name:string; title:string; group:string; groupLabel:string; sheet:number; row:number;
 venues:string[]; appearance:string; bio:string; hook:string; good:'wood'|'iron'|'rock'|'fruit'|'grain'|'wool'|'clothes'|'hide';
 child:boolean; hostile:boolean; kind:string; action:string; height:number; connection:string;
 questKind:'hunt'|'meet'|'supply'; count:number; reward:number;
}
export const SPECIAL_CAST=SPECIAL_CAST_DATA as SpecialCharacter[];
export const SPECIAL_BY_ID=new Map(SPECIAL_CAST.map(c=>[c.id,c]));
export const SPECIAL_SHEETS=['wayfarers','masters','faith','court','commons','youngfolk','rural','watch','outlaws','beasts'];
export const SPECIAL_FRAME_SIZE=96;
export const SPECIAL_BASELINE=84;
export const SPECIAL_BODY_HEIGHT=48;
export type SpecialPose='idle'|'walk'|'action'|'hurt';
export function specialFrameIndex(pose:SpecialPose,ms:number){
 if(pose==='hurt')return 9;
 if(pose==='walk')return 2+Math.floor(ms/145)%4;
 if(pose==='action')return 6+Math.floor(ms/160)%3;
 return Math.floor(ms/460)%2;
}
export function specialSheetUrl(id:string){const c=SPECIAL_BY_ID.get(id);return c?`/sprites/special-cast/${SPECIAL_SHEETS[c.sheet]}.png`:undefined;}
