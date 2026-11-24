import type {InteriorMap} from './interiors.js';
export interface CaveWallPiece {kind:'body'|'face'|'rim'|'side';x:number;y:number;w:number;h:number;strip?:number;flip?:boolean}
const cache=new WeakMap<InteriorMap,CaveWallPiece[]>();
// Fill the complete solid boundary first, including diagonal joins. Exposed faces
// are independent, so a thin rock island can show its front, back and sides.
export function caveWallPieces(m:InteriorMap){
 const old=cache.get(m);if(old)return old;
 const out:CaveWallPiece[]=[],open=(x:number,y:number)=>x>=0&&y>=0&&x<m.w&&y<m.h&&!['#',' '].includes(m.cells[y*m.w+x]);
 for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(m.cells[y*m.w+x]==='#')out.push({kind:'body',x,y,w:1.01,h:1.01});
 for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(m.cells[y*m.w+x]==='#'){
  const n=open(x,y-1),s=open(x,y+1),e=open(x+1,y),w=open(x-1,y);
  if(n)out.push({kind:'rim',x:x-.02,y:y-.06,w:1.04,h:.46,strip:x});
  if(e)out.push({kind:'side',x:x+.48,y:y-.02,w:.54,h:1.04,flip:true});
  if(w)out.push({kind:'side',x:x-.02,y:y-.02,w:.54,h:1.04});
  if(s){const height=n?1:1.8;out.push({kind:'face',x:x-.02,y:y+1-height,w:1.04,h:height,strip:x});}
 }
 cache.set(m,out);return out;
}
