import { Texture, type Renderer, Sprite } from 'pixi.js';

// Small cached terrain textures keep rounded banks independent of ownership and lighting tints.
const water = new Map<string,Texture>();
const roads = new Map<string,Texture>();
const surfaces=new Map<number,HTMLCanvasElement>();
function canvas() { const c=document.createElement('canvas');c.width=c.height=32;return c; }
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
 const source=new Sprite(base);source.width=source.height=32;
 const image=renderer.extract.canvas({target:source});
 ctx.drawImage(image as HTMLCanvasElement,0,0,32,32);source.destroy();
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
 if(surface&&renderer){
  let source=surfaces.get(surface.uid);
  if(!source){const sprite=new Sprite(surface);source=renderer.extract.canvas({target:sprite}) as HTMLCanvasElement;surfaces.set(surface.uid,source);sprite.destroy();}
  // Original material colour, rounded cardinal connectors, cached once per combination.
  ctx.globalCompositeOperation='source-atop';
  ctx.save();ctx.translate(16,16);ctx.rotate(variation*Math.PI/2);ctx.drawImage(source,-16,-16,32,32);ctx.restore();
 }else draw(Math.max(10,width-5),'#aa9670');
 ctx.globalCompositeOperation='source-atop';
 if(!surface)for(let i=0;i<65;i++){const x=(i*17+3)%32,y=(i*11+7)%32;ctx.fillStyle=i%2?'#8f7e5b55':'#c0ac8255';ctx.fillRect(x,y,1,1);}
 const texture=Texture.from(c);roads.set(key,texture);return texture;
}
