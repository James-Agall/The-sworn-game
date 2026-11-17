import {readPNG,writePNG} from './lib/png.mjs';
import {fileURLToPath} from 'node:url';
export function applySpearShieldCorrection(out=fileURLToPath(new URL('../client/public/sprites/hero-npc',import.meta.url))){
 const patch=readPNG(fileURLToPath(new URL('./rig-layouts/hero-spear-shield-correction.png',import.meta.url)));
 for(let tier=0;tier<4;tier++)for(const mounted of [false,true]){const file=out+`/armour-${tier}-${mounted?'mounted':'foot'}.png`,p=readPNG(file),row=tier*2+Number(mounted);
 for(let col=0;col<3;col++)for(let y=0;y<240;y++){const src=((row*240+y)*768+col*256)*4,dst=((3*240+y)*p.w+(6+col)*256)*4;p.data.set(patch.data.subarray(src,src+1024),dst)}writePNG(file,p);}
}
if(process.argv[1]===fileURLToPath(import.meta.url))applySpearShieldCorrection(process.argv[2]);
