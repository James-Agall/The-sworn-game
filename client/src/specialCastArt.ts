import {SPECIAL_BY_ID,SPECIAL_FRAME_SIZE,SPECIAL_BASELINE,SPECIAL_BODY_HEIGHT,specialFrameIndex,specialSheetUrl,type SpecialPose} from '@colony/shared/specialCast';
import {Texture,Rectangle} from 'pixi.js';
import {loadTexture} from './atlas';
const sheets=new Map<string,Texture>(),pending=new Set<string>(),frames=new Map<string,Texture>();
export function loadSpecialArt(id:string,ready?:()=>void){const url=specialSheetUrl(id);if(!url||sheets.has(url)||pending.has(url))return;pending.add(url);void loadTexture(url).then(t=>{pending.delete(url);t.source.scaleMode="nearest";sheets.set(url,t);ready?.();}).catch(()=>pending.delete(url));}
export function specialTexture(id:string,pose:SpecialPose,ms:number){
 const c=SPECIAL_BY_ID.get(id),url=specialSheetUrl(id);if(!c||!url)return;const sheet=sheets.get(url);if(!sheet)return;
 const col=specialFrameIndex(pose,ms),key=`${id}:${col}`;let tex=frames.get(key);if(!tex){tex=new Texture({source:sheet.source,frame:new Rectangle(sheet.frame.x+col*SPECIAL_FRAME_SIZE,sheet.frame.y+c.row*SPECIAL_FRAME_SIZE,SPECIAL_FRAME_SIZE,SPECIAL_FRAME_SIZE)});frames.set(key,tex);}return tex;
}
export const specialAnchor={x:.5,y:SPECIAL_BASELINE/SPECIAL_FRAME_SIZE};
export const specialScale=(id:string)=>(SPECIAL_BY_ID.get(id)?.height??25)/SPECIAL_BODY_HEIGHT;
