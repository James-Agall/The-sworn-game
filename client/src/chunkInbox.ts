const clockNow=()=>performance.now();
export interface IncomingChunk {c:number;tiles:string;biomes:string}
// Keep network arrival order, while allowing newer tile edits to supersede a queued chunk snapshot.
export class ChunkInbox {
 private active?:Iterator<void>;private activeChunk?:number;
 private queue=new Map<number,IncomingChunk>();private edits=new Map<number,Map<number,number>>();
 push(chunks:IncomingChunk[]){for(const c of chunks)this.queue.set(c.c,c);}
 patch(c:number,index:number,tile:number){if(!this.queue.has(c))return;let e=this.edits.get(c);if(!e)this.edits.set(c,e=new Map());e.set(index,tile);}
 take(){const next=this.queue.values().next();if(next.done)return;const chunk=next.value,overrides=this.edits.get(chunk.c);this.queue.delete(chunk.c);this.edits.delete(chunk.c);return{chunk,overrides};}
 // A yielded art job reads live tiles, so edits arriving mid-install cannot be overwritten by it.
 drain(budgetMs:number,build:(chunk:IncomingChunk,overrides?:Map<number,number>)=>Iterator<void>,now=clockNow){
  const deadline=now()+budgetMs;
  do{
   if(!this.active){const next=this.take();if(!next)return;this.activeChunk=next.chunk.c;this.active=build(next.chunk,next.overrides);}
   if(this.active.next().done){this.active=undefined;this.activeChunk=undefined;}
  }while(now()<deadline);
 }
 has(c:number){return this.activeChunk===c||this.queue.has(c);}
 clear(){this.activeChunk=undefined;this.active=undefined;this.queue.clear();this.edits.clear();}get size(){return this.queue.size+(this.active?1:0);}
}
