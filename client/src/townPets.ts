import { Container, Sprite, Texture } from 'pixi.js';
import { loadTexture } from './atlas';
import type { SiteSnapshot } from '@colony/shared/protocol';

// Cosmetic pets reuse the town's road tour and require no server entities, AI or snapshots per frame.
export function createTownPets(layer:Container) {
 const textures:Texture[]=[];
 const pets=new Map<string,{sprite:Sprite;phase:number;route:number[]}>();
 for(const [index,name] of ['animal_dog_brown','animal_cat_orange'].entries())void loadTexture(`/sprites/animals/${name}.png`).then(t=>{textures[index]=t;}).catch(()=>{});
 let time=0;
 return {update(sites:SiteSnapshot[],width:number,size:number,dt:number,paused:boolean,visible:boolean,cx:number,cy:number){
  if(!paused)time+=Math.min(dt,.1);
  const keep=new Set<string>();
  for(const site of sites){
   const route=site.ambientRoad;
   if(!route||route.length<2||site.hostile||site.cleared||site.captured||(!textures[0]||!textures[1]))continue;
   if(Math.hypot(site.keepX*size-cx,site.keepY*size-cy)>size*100)continue;
   for(let n=0;n<2;n++){
    const key=`${site.num}:${n}`;keep.add(key);let pet=pets.get(key);
    if(!pet){const sprite=new Sprite(textures[n]);sprite.anchor.set(.5,.9);sprite.height=n?12:17;sprite.scale.x=Math.abs(sprite.scale.y);layer.addChild(sprite);pet={sprite,phase:(site.num??0)*13+n*41,route};pets.set(key,pet);}
    pet.route=route;
    const length=route.length-1,phase=(time*(n===1?0.7:1)+pet.phase)%(length*2);
    const position=phase<=length?phase:length*2-phase;
    const i=Math.min(length-1,Math.floor(position)),f=position-i,a=route[i],b=route[i+1];
    const x=((a%width)*(1-f)+(b%width)*f+.5)*size;
    const y=(Math.floor(a/width)*(1-f)+Math.floor(b/width)*f+.5)*size;
    const direction=(b%width-a%width)*(phase<=length?1:-1);
    pet.sprite.scale.x=Math.abs(pet.sprite.scale.y)*(direction<0?-1:1);
    pet.sprite.position.set(x,y+Math.sin(time*8+pet.phase)*.5);pet.sprite.visible=visible;
   }
  }
  for(const[key,pet]of pets)if(!keep.has(key)){pet.sprite.destroy();pets.delete(key);}
 }};
}
