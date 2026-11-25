import { Texture, type Renderer, Sprite } from 'pixi.js';

// Small cached terrain textures keep rounded banks independent of ownership and lighting tints.
const water = new Map<string,Texture>();
const roads = new Map<string,Texture>();
const surfaces=new Map<number,HTMLCanvasElement>();
function canvas() { const c=document.createElement('canvas');c.width=c.height=32;return c; }
const extracted=new WeakMap<Texture,HTMLCanvasElement>();
function textureCanvas(texture:Texture,renderer:Renderer):HTMLCanvasElement {
 const hit=extracted.get(texture);if(hit)return hit;
 const c=document.createElement('canvas');c.width=texture.orig.width;c.height=texture.orig.height;
 const g=c.getContext('2d')!,source=texture.source.resource as CanvasImageSource|undefined,f=texture.frame,t=texture.trim;
 if(source&&!texture.rotate){try{g.drawImage(source,f.x,f.y,f.width,f.height,t?.x??0,t?.y??0,t?.width??f.width,t?.height??f.height);extracted.set(texture,c);return c;}catch{/* Unusual GPU-only textures use the existing fallback. */}}
 const sprite=new Sprite(texture),fallback=renderer.extract.canvas({target:sprite}) as HTMLCanvasElement;sprite.destroy();extracted.set(texture,fallback);return fallback;
}

export function roundedWater(base:Texture,mask:number,renderer:Renderer):Texture {
 const key=`${base.uid}:${mask}`;
 const cached=water.get(key);if(cached)return cached;
 const c=canvas(),ctx=c.getContext('2d')!;
 ctx.beginPath();ctx.roundRect(0,0,32,32,14);ctx.fill();
 if(mask&1)ctx.fillRect(0,0,32,16);
 if(mask&2)ctx.fillRect(16,0,16,32);
 if(mask&4)ctx.fillRect(0,16,32,16);
 if(mask&8)ctx.fillRect(0,0,16,32);
 ctx.globalCompositeOperation='source-in';
 ctx.drawImage(textureCanvas(base,renderer),0,0,32,32);
 const texture=Texture.from(c);water.set(key,texture);return texture;
}
export function naturalRoad(mask:number,width=19,surface?:Texture,renderer?:Renderer,variation=0):Texture {
 const key=`${mask}:${width}:${surface?.uid??0}:${variation}`;
 const cached=roads.get(key);if(cached)return cached;
 const c=canvas(),ctx=c.getContext('2d')!;
 const draw=(width:number,color:string)=>{
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.arc(16,16,width/2,0,Math.PI*2);ctx.fill();
  for(const [bit,x,y] of [[1,16,-2],[2,34,16],[4,16,34],[8,-2,16]])if(mask&bit){ctx.beginPath();ctx.moveTo(16,16);ctx.lineTo(x,y);ctx.stroke();}
 };
 draw(width+2,'#716447');draw(width,'#9c8861');
 if(width>=24&&mask===15){ctx.fillStyle='#9c8861';ctx.fillRect(0,0,32,32);}
 if(surface&&renderer){
  let source=surfaces.get(surface.uid);
  if(!source){source=textureCanvas(surface,renderer);surfaces.set(surface.uid,source);}
  // Original material colour, rounded cardinal connectors, cached once per combination.
  ctx.globalCompositeOperation='source-atop';
  ctx.save();ctx.translate(16,16);ctx.rotate(variation*Math.PI/2);ctx.drawImage(source,-16,-16,32,32);ctx.restore();
 }else draw(Math.max(10,width-5),'#aa9670');
 ctx.globalCompositeOperation='source-atop';
 if(!surface)for(let i=0;i<65;i++){const x=(i*17+3)%32,y=(i*11+7)%32;ctx.fillStyle=i%2?'#8f7e5b55':'#c0ac8255';ctx.fillRect(x,y,1,1);}
 const texture=Texture.from(c);roads.set(key,texture);return texture;
}

const bridges=new Map<string,Texture>();
export function riverBridgeTexture(deck:Texture,base:Texture,renderer:Renderer):Texture{
 const key=deck.uid+':'+base.uid,cached=bridges.get(key);if(cached)return cached;
 const c=canvas(),ctx=c.getContext('2d')!;
 for(const texture of [base,deck])ctx.drawImage(textureCanvas(texture,renderer),0,0,32,32);
 const result=Texture.from(c);bridges.set(key,result);return result;
}
