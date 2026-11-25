import {ChunkInbox} from './src/chunkInbox.js';
import assert from 'node:assert/strict';
import {Container,Sprite,Texture,TextureSource} from 'pixi.js';
import {SceneryIndex,staticDepth,groundDepth,orderUnit,bucketKeys,spriteRect} from './src/sceneDepth.js';
const layer=new Container(),decor=new Container(),index=new SceneryIndex();layer.sortableChildren=true;
const texture=new Texture({source:new TextureSource({width:64,height:96})});
const tree=new Sprite(texture);tree.anchor.set(.5,1);tree.position.set(160,192);tree.zIndex=staticDepth(5*512+5,512);
index.track('tree',tree,layer,true);index.updateVisible({left:0,top:0,right:400,bottom:400});assert.equal(tree.parent,layer);
const hero=new Sprite(texture);hero.width=20;hero.height=28;hero.anchor.set(.5,1);hero.position.set(160,160);const e={sprite:hero,hpBar:new Container(),groundX:160,groundY:160} as any;
orderUnit(e,layer,512);layer.sortChildren();assert(layer.getChildIndex(hero)<layer.getChildIndex(tree),'behind: tree draws after character');assert.equal(index.occluders(hero,hero.zIndex)[0],tree);
e.groundY=220;hero.y=220;orderUnit(e,layer,512);layer.sortChildren();assert(layer.getChildIndex(hero)>layer.getChildIndex(tree),'front: character draws after tree');assert.equal(index.occluders(hero,hero.zIndex).length,0);
e.groundY=220;e.ip={ox:0,oy:-70};hero.y=150;orderUnit(e,layer,512);assert(hero.zIndex<tree.zIndex,'interpolated feet cross the depth plane smoothly');
assert(groundDepth(1000,200,512)<groundDepth(0,201,512),'X cannot reverse vertical depth');
index.updateVisible({left:3000,top:3000,right:3300,bottom:3300});assert.notEqual(tree.parent,layer,'offscreen scenery leaves the sortable scene');assert.equal(index.visibleCount,0);
index.updateVisible({left:0,top:0,right:400,bottom:400});assert.equal(tree.parent,layer);assert.equal(index.visibleCount,1);
// Art may extend across a chunk boundary even when its anchor is outside it.
tree.position.set(256,256);tree.scale.set(5);index.track('tree',tree,layer,true);assert(bucketKeys(spriteRect(tree)).length>1);index.updateVisible({left:0,top:0,right:80,bottom:80});assert.equal(tree.parent,layer);
const floor=new Sprite(texture);floor.position.set(0,0);index.track('decor',floor,decor,false);assert(!index.occluders(hero,-100).includes(floor),'ground decorations never mask a character');
index.remove('tree');assert(!index.occluders(hero,-100).includes(tree));index.clear();assert.equal(index.count,0);
console.log('PASS tree/building front and back ordering, interpolated depth, X tie-breaks, chunk-edge art, viewport parking/re-entry, non-occluding ground and reset');

const inbox=new ChunkInbox();inbox.push([{c:1,tiles:'old',biomes:'a'},{c:2,tiles:'next',biomes:'b'}]);inbox.patch(1,50,0);inbox.patch(1,51,8);inbox.patch(1,50,4);inbox.push([{c:1,tiles:'new snapshot',biomes:'a'}]);const first=inbox.take()!;assert.equal(first.chunk.c,1);assert.equal(first.chunk.tiles,'new snapshot');assert.equal(first.overrides!.get(50),4);assert.equal(first.overrides!.get(51),8);assert.equal(inbox.take()!.chunk.c,2);assert.equal(inbox.take(),undefined);inbox.push([{c:4,tiles:'old world',biomes:'a'}]);inbox.clear();assert.equal(inbox.take(),undefined);console.log('PASS bounded chunk arrival order, duplicate replies, newer live tile edits and world-reset cancellation');

// Closed-form bounds match all four transformed corners, including flipped/rotated sprites.
for(let n=0;n<200;n++){
 hero.rotation=n*.081;hero.scale.set((n%2?-1:1)*(.1+n/100),.3+n/200);hero.anchor.set((n%3)/2,(n%5)/4);
 const xs:number[]=[],ys:number[]=[];
 for(const x of [-hero.anchor.x*hero.texture.width,(1-hero.anchor.x)*hero.texture.width])for(const y of [-hero.anchor.y*hero.texture.height,(1-hero.anchor.y)*hero.texture.height]){xs.push(hero.x+x*hero.scale.x*Math.cos(hero.rotation)-y*hero.scale.y*Math.sin(hero.rotation));ys.push(hero.y+x*hero.scale.x*Math.sin(hero.rotation)+y*hero.scale.y*Math.cos(hero.rotation));}
 const bounds=spriteRect(hero);assert(Math.abs(bounds.left-Math.min(...xs))<1e-8);assert(Math.abs(bounds.right-Math.max(...xs))<1e-8);assert(Math.abs(bounds.top-Math.min(...ys))<1e-8);assert(Math.abs(bounds.bottom-Math.max(...ys))<1e-8);
}
// A small budget yields, resumes in order, sees live edits and drops old-world work on reset.
let clock=0;const rendered:number[]=[];const live=new Map<number,number>();
const job=function*(chunk:{c:number}){for(let n=0;n<5;n++){rendered.push(live.get(chunk.c)??chunk.c);clock++;yield;}};
inbox.push([{c:1,tiles:'',biomes:''},{c:2,tiles:'',biomes:''}]);inbox.drain(2,job,()=>clock);assert.equal(rendered.length,2);assert.equal(inbox.size,2);
live.set(1,99);inbox.drain(2,job,()=>clock);assert.deepEqual(rendered,[1,1,99,99]);inbox.clear();inbox.drain(2,job,()=>clock);assert.equal(rendered.length,4);
inbox.push([{c:3,tiles:'',biomes:''}]);inbox.drain(10,job,()=>clock);assert.deepEqual(rendered.slice(4),[3,3,3,3,3]);assert.equal(inbox.size,0);
console.log('PASS rotated/flipped bounds, time-budgeted art jobs, mid-install live edits and active reset');
