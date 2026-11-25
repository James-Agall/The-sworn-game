export interface IncomingChunk {c:number;tiles:string;biomes:string}
// Keep network arrival order, while allowing newer tile edits to supersede a queued chunk snapshot.
export class ChunkInbox {
 private queue=new Map<number,IncomingChunk>();private edits=new Map<number,Map<number,number>>();
 push(chunks:IncomingChunk[]){for(const c of chunks)this.queue.set(c.c,c);}
 patch(c:number,index:number,tile:number){if(!this.queue.has(c))return;let e=this.edits.get(c);if(!e)this.edits.set(c,e=new Map());e.set(index,tile);}
 take(){const next=this.queue.values().next();if(next.done)return;const chunk=next.value,overrides=this.edits.get(chunk.c);this.queue.delete(chunk.c);this.edits.delete(chunk.c);return{chunk,overrides};}
 clear(){this.queue.clear();this.edits.clear();}get size(){return this.queue.size;}
}
