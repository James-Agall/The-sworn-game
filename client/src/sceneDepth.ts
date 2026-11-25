import {Container,Sprite,Texture} from 'pixi.js';
import type {EntityVisual} from './worldVisuals';

export interface WorldRect {left:number;top:number;right:number;bottom:number}
export const overlaps=(a:WorldRect,b:WorldRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
// Feet determine the plane. X only breaks ties; a tall sprite's head never changes its depth.
export const groundDepth=(x:number,y:number,width:number,size=32)=>(y/size-1)*width+x/(size*width);
export const staticDepth=(old:number,width:number)=>old<0?old:Math.floor(old/width)*width+(old%width)/width;
export function spriteRect(s:Sprite):WorldRect {
 const w=s.texture.width,h=s.texture.height,x0=-s.anchor.x*w,x1=x0+w,y0=-s.anchor.y*h,y1=y0+h;
 const c=Math.cos(s.rotation),n=Math.sin(s.rotation);let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
 for(const x of [x0,x1])for(const y of [y0,y1]){const px=s.x+x*s.scale.x*c-y*s.scale.y*n,py=s.y+x*s.scale.x*n+y*s.scale.y*c;left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
 return{left,right,top,bottom};
}
export function bucketKeys(r:WorldRect,span=256):number[]{
 const keys:number[]=[];for(let y=Math.floor(r.top/span);y<=Math.floor((r.bottom-.001)/span);y++)for(let x=Math.floor(r.left/span);x<=Math.floor((r.right-.001)/span);x++)keys.push(y*65536+x);return keys;
}
type Scenery={sprite:Sprite;parent:Container;rect:WorldRect;keys:number[];occluder:boolean};
// Offscreen scenery is parked outside the stage. Sorting and transform traversal see only the viewport.
export class SceneryIndex {
 private entries=new Map<string,Scenery>();private buckets=new Map<number,Set<string>>();private active=new Set<string>();
 private visibleKeys=new Set<number>();private parked=new Container();private camera='';
 track(id:string,sprite:Sprite,parent:Container,occluder:boolean){
  this.remove(id);const rect=spriteRect(sprite),keys=bucketKeys(rect),e={sprite,parent,rect,keys,occluder};this.entries.set(id,e);
  for(const key of keys){let b=this.buckets.get(key);if(!b)this.buckets.set(key,b=new Set());b.add(id);}
  if(keys.some(k=>this.visibleKeys.has(k))){parent.addChild(sprite);this.active.add(id);}else this.parked.addChild(sprite);
 }
 remove(id:string){const e=this.entries.get(id);if(!e)return;for(const key of e.keys){const b=this.buckets.get(key);b?.delete(id);if(!b?.size)this.buckets.delete(key);}this.entries.delete(id);this.active.delete(id);}
 updateVisible(rect:WorldRect){
  const span=256,x0=Math.floor(rect.left/span)-1,x1=Math.floor(rect.right/span)+1,y0=Math.floor(rect.top/span)-1,y1=Math.floor(rect.bottom/span)+1,key=`${x0}:${x1}:${y0}:${y1}`;
  if(key===this.camera)return;this.camera=key;const want=new Set<string>();this.visibleKeys.clear();
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const k=y*65536+x;this.visibleKeys.add(k);for(const id of this.buckets.get(k)??[])want.add(id);}
  for(const id of this.active)if(!want.has(id)){const e=this.entries.get(id);if(e&&!e.sprite.destroyed)this.parked.addChild(e.sprite);}
  for(const id of want)if(!this.active.has(id)){const e=this.entries.get(id);if(e&&!e.sprite.destroyed)e.parent.addChild(e.sprite);}
  this.active=want;
 }
 occluders(body:Sprite,depth:number):Sprite[]{
  const rect=spriteRect(body),seen=new Set<string>(),out:Sprite[]=[];
  for(const k of bucketKeys(rect))for(const id of this.buckets.get(k)??[]){if(seen.has(id))continue;seen.add(id);const e=this.entries.get(id)!;
   if(e.occluder&&this.active.has(id)&&e.sprite.visible&&!e.sprite.destroyed&&e.sprite.zIndex>depth+.00001&&overlaps(rect,e.rect))out.push(e.sprite);
  }
  return out.sort((a,b)=>b.zIndex-a.zIndex).slice(0,4);
 }
 clear(){this.entries.clear();this.buckets.clear();this.active.clear();this.visibleKeys.clear();this.camera='';}
 get count(){return this.entries.size;}get visibleCount(){return this.active.size;}
}
const PARTS=['aura','marker','sprite','wound','load','hpBar','sigil','markLabel','bossLabel','heroLabel','questMark'] as const;
export function orderUnit(e:EntityVisual,layer:Container,width:number,size=32){
 if(e.groundX===undefined||e.groundY===undefined)return;
 const z=groundDepth(e.groundX+(e.ip?.ox??0),e.groundY+(e.ip?.oy??0),width,size);
 for(let n=0;n<PARTS.length;n++){const p=e[PARTS[n]];if(!p||p.destroyed)continue;if(p.parent!==layer)layer.addChild(p);const depth=z+n*.000001;if(p.zIndex!==depth)p.zIndex=depth;}
}
// The outline is baked once per existing animation frame, not filtered every frame.
// Keeping the original dimensions/trim preserves alignment with the hero's exact current pose.
const shadows=new WeakMap<Texture,Map<number,Texture>>();
const shadowLru=new Map<Texture,{source:Texture;radius:number}>();
function shadowTexture(sprite:Sprite):Texture {
 const texture=sprite.texture,radius=Math.max(1,Math.min(6,Math.round(1/Math.abs(sprite.scale.x))));
 let frames=shadows.get(texture);if(!frames)shadows.set(texture,frames=new Map());const hit=frames.get(radius);if(hit){const info=shadowLru.get(hit)!;shadowLru.delete(hit);shadowLru.set(hit,info);return hit;}
 const resource=texture.source.resource as CanvasImageSource|undefined;if(!resource)return texture;
 const make=()=>{const c=document.createElement('canvas');c.width=texture.orig.width;c.height=texture.orig.height;return c;};
 const raw=make(),g=raw.getContext('2d')!,f=texture.frame,trim=texture.trim;
 try{g.drawImage(resource,f.x,f.y,f.width,f.height,trim?.x??0,trim?.y??0,trim?.width??f.width,trim?.height??f.height);}catch{return texture;}
 const canvas=make(),c=canvas.getContext('2d')!;
 for(const [x,y]of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])c.drawImage(raw,x*radius,y*radius);
 c.globalCompositeOperation='source-in';c.fillStyle='rgba(145,138,117,.8)';c.fillRect(0,0,canvas.width,canvas.height);
 c.globalCompositeOperation='destination-out';c.drawImage(raw,0,0);
 g.globalCompositeOperation='source-in';g.fillStyle='rgba(8,8,8,.35)';g.fillRect(0,0,raw.width,raw.height);
 c.globalCompositeOperation='source-over';c.drawImage(raw,0,0);
 const result=Texture.from(canvas);result.source.scaleMode='nearest';frames.set(radius,result);shadowLru.set(result,{source:texture,radius});
 if(shadowLru.size>64){const [old,info]=shadowLru.entries().next().value!;shadowLru.delete(old);shadows.get(info.source)?.delete(info.radius);old.source.unload();old.destroy(true);}
 return result;
}
// Alpha masks follow actual tree/house transparency. No original artwork is recoloured.
export function createHiddenHeroOutline(layer:Container){
 const slots=Array.from({length:4},()=>{const group=new Container(),ghost=new Sprite(),mask=new Sprite();group.addChild(ghost,mask);ghost.setMask({mask,channel:'alpha'});group.visible=false;layer.addChild(group);return{group,ghost,mask};});
 const copy=(to:Sprite,from:Sprite)=>{to.position.copyFrom(from.position);to.anchor.copyFrom(from.anchor);to.scale.copyFrom(from.scale);to.rotation=from.rotation;};
 return{update(hero:Container|undefined,occluders:Sprite[],on:boolean){for(let i=0;i<slots.length;i++){const s=slots[i],cover=occluders[i];s.group.visible=on&&hero instanceof Sprite&&hero.visible&&!!cover;if(!s.group.visible)continue;copy(s.ghost,hero as Sprite);s.ghost.texture=shadowTexture(hero as Sprite);copy(s.mask,cover);s.mask.texture=cover.texture;}},clear(){for(const s of slots)s.group.visible=false;}};
}
