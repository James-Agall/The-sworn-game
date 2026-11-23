import type {SettlementTemplate} from './settlementTemplates.js';
type Point={x:number;y:number};
// Keep building inventories identical while selecting the smallest workable compact envelope.
export function compactTown(id:string,base:SettlementTemplate):SettlementTemplate {
 const w=base.rows[0].length,h=base.rows.length,v=Number(id.split('-')[4]),n=v%10;
 for(const extra of [0,1,2,3])for(const phase of [0,1,2]){
  const result=compose(id,base,w,h,v,n,extra,phase);if(result)return result;
 }
 throw new Error('Unable to compact '+id+' without losing houses');
}
function compose(id:string,base:SettlementTemplate,w:number,h:number,v:number,n:number,extra:number,phase:number):SettlementTemplate|undefined {
 const cw=w===30?24:54,ch=(h===30?19:47)+extra;
 if(ch>h-6)return;
 // The agricultural side, core offset and district anchors vary independently of town culture.
 const side=n%4,ox=side===3?w-cw-1:side===1?1:Math.max(1,Math.floor((w-cw)/2)+(n%3-1)),oy=side===0?h-ch-1:side===2?1:Math.floor((h-ch)/2);
 const right=ox+cw-1,bottom=oy+ch-1;
 const g=Array.from({length:h},()=>Array<string>(w).fill('.')),used=new Uint8Array(w*h),solid=new Uint8Array(w*h);
 const at=(x:number,y:number)=>g[y]?.[x],put=(x:number,y:number,c:string)=>{g[y][x]=c;};
 const wall=base.profile==='hearthmoor'?'#':'%';
 const rowBounds=(y:number)=>{const d=Math.min(y-oy,bottom-y),cut=d===0?3:d===1?1:0;return [ox+cut,right-cut];};
 for(let y=oy;y<=bottom;y++){const [l,r]=rowBounds(y);put(l,y,wall);put(r,y,wall);if(y===oy||y===bottom)for(let x=l;x<=r;x++)put(x,y,wall);if(y>oy)for(const s of [0,1]){const old=rowBounds(y-1)[s],now=rowBounds(y)[s];for(let x=Math.min(old,now);x<=Math.max(old,now);x++)put(x,y,wall);}}
 const inside=(x:number,y:number)=>y>oy&&y<bottom&&x>rowBounds(y)[0]&&x<rowBounds(y)[1]&&at(x,y)!==wall;
 const keep={x:ox+(n%2?cw-7:6),y:oy+6+(n%3===2?Math.min(4,ch-13):0)};
 const square={x:ox+(n%2?6:cw-7),y:oy+Math.min(ch-5,10+n%3)};
 for(let y=keep.y-4;y<=keep.y;y++)for(let x=keep.x-2;x<=keep.x+2;x++)used[y*w+x]=solid[y*w+x]=1;
 for(let y=square.y-1;y<=square.y+1;y++)for(let x=square.x-2;x<=square.x+2;x++){put(x,y,'=');used[y*w+x]=1;}
 for(const [dx,c]of [[-2,'$'],[0,'B'],[2,'$']] as const){put(square.x+dx,square.y-1,c);solid[(square.y-1)*w+square.x+dx]=1;}
 const road=(c:string|undefined)=>['_','=','G','F'].includes(c!);
 const connect=(start:Point,end?:Point,paved=false,outsideOnly=false)=>{
  if(!['.','_','=','G','F'].includes(at(start.x,start.y)!))return false;
  const i=start.y*w+start.x,prev=new Int32Array(w*h).fill(-1),q=[i];prev[i]=i;let hit=-1;
  for(let k=0;k<q.length;k++){const a=q[k],x=a%w,y=Math.floor(a/w);
   if(end?x===end.x&&y===end.y:road(at(x,y))){hit=a;break;}
   const dirs=(n+phase)%2?[[1,0],[0,1],[-1,0],[0,-1]]:[[-1,0],[0,1],[1,0],[0,-1]];
   for(const [dx,dy]of dirs){const xx=x+dx,yy=y+dy,b=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||prev[b]>=0||solid[b]||!['.','_','=','G','F'].includes(at(xx,yy)!))continue;if(outsideOnly&&inside(xx,yy))continue;prev[b]=a;q.push(b);}
  }
  if(hit<0)return false;
  for(let a=hit;;a=prev[a]){const x=a%w,y=Math.floor(a/w);if(!road(at(x,y)))put(x,y,paved?'=':'_');if(a===i)break;}return true;
 };
 if(!connect({x:keep.x,y:keep.y+1}))return;
 const gates:Point[]=[{x:ox+5+(n*3)%(cw-10),y:oy},{x:right,y:oy+4+(n*5)%(ch-8)},{x:ox+5+(n*7)%(cw-10),y:bottom},{x:ox,y:oy+4+(n*2)%(ch-8)}];
 // Some towns have three gates; sockets on the missing side follow an exterior approach lane.
 const gateList=gates.filter((_,i)=>n%3!==1||i!==(n+1)%4);
 for(const gate of gateList)put(gate.x,gate.y,'G');

 const first=gateList[n%gateList.length];if(!connect(first,square,base.profile!=='hearthmoor'))return;
 const buildings:SettlementTemplate['buildings']=[];
 const can=(x:number,y:number)=>{for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const c=at(x+dx,y+dy);if(!inside(x+dx,y+dy)||used[(y+dy)*w+x+dx]||c!=='.'&&!(dy===2&&road(c)))return false;}return true;};
 const add=(ref:string,x:number,y:number)=>{if(!can(x,y))return false;for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){used[(y+dy)*w+x+dx]=1;if(dy<2)solid[(y+dy)*w+x+dx]=1;}
  if(!connect({x:x+1,y:y+2})){for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)used[(y+dy)*w+x+dx]=solid[(y+dy)*w+x+dx]=0;return false;}buildings.push({ref,x,y});return true;};
 const candidates:Point[]=[];
 // Dense frontage rows have staggered plot starts. Streets use the open doorway row between roofs.
 for(let y=oy+1;y+3<bottom;y+=3)for(let x=ox+1+(Math.floor((y-oy)/3)+phase)%2;x+3<right;x+=3)candidates.push({x,y});
 const refs=base.buildings.map(b=>b.ref),industry=refs.filter(r=>['blacksmith-small','tailor-small','brewery-small'].includes(r)),civic=refs.filter(r=>!industry.includes(r)&&!r.startsWith('house-')&&r!=='longhouse'),homes=refs.filter(r=>r.startsWith('house-')||r==='longhouse');
 const work={x:ox+(n%3===0?cw-7:5),y:oy+(n%3===2?5:ch-5)};
 for(const ref of [...industry,...civic,...homes]){
  const target=industry.includes(ref)?work:ref==='market-hall'?square:ref==='church-chapel'?{x:ox+cw/2,y:oy+4}:square;
  const ordered=[...candidates].sort((a,b)=>(Math.abs(a.x-target.x)+Math.abs(a.y-target.y))-(Math.abs(b.x-target.x)+Math.abs(b.y-target.y)));
  let done=false;for(const p of ordered)if(add(ref,p.x,p.y)){done=true;break;}
  if(!done)return;
 }
 // Complete the remaining gates after the housing frontages establish their street network.
 for(const gate of gateList)if(!connect(gate,square))return;
 if(n%3===2)for(const main of [...gateList]){
  const pair=main.x===ox||main.x===right?{x:main.x,y:main.y+1}:{x:main.x+1,y:main.y};
  const inner={x:pair.x+(pair.x===ox?1:pair.x===right?-1:0),y:pair.y+(pair.y===oy?1:pair.y===bottom?-1:0)};
  if(at(pair.x,pair.y)===wall&&road(at(inner.x,inner.y))){put(pair.x,pair.y,'G');gateList.push(pair);break;}
 }
 // Regional sockets remain fixed, while the approaches and gate positions vary.
 const sockets:Point[]=[];
 for(let x=15;x<w;x+=32){sockets.push({x,y:0},{x,y:h-1});}
 for(let y=15;y<h;y+=32){sockets.push({x:0,y},{x:w-1,y});}
 for(const p of sockets){const ordered=[...gateList].sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));let done=false;for(const gate of ordered)if(connect(p,gate,false,true)){done=true;break;}if(!done)return;}
 // Machines share the workshop neighbourhood and retain a direct street approach.
 for(const c of ['i','j','d']){
  const cells:Point[]=[];for(let y=oy+1;y<bottom;y++)for(let x=ox+1;x<right;x++)if(inside(x,y)&&at(x,y)==='.'&&!used[y*w+x]&&!solid[(y+1)*w+x])cells.push({x,y});
  cells.sort((a,b)=>(Math.abs(a.x-work.x)+Math.abs(a.y-work.y))-(Math.abs(b.x-work.x)+Math.abs(b.y-work.y)));
  let done=false;for(const p of cells){solid[p.y*w+p.x]=1;if(connect({x:p.x,y:p.y+1})){put(p.x,p.y,c);used[p.y*w+p.x]=1;done=true;break;}solid[p.y*w+p.x]=0;}if(!done)return;
 }
 put(keep.x,keep.y,'K');

 // NPC pockets are distributed around the actual civic and working districts.
 for(const [c,target]of [['t',square],['q',square],['r',keep],['g',first],['g',gateList[(n+1)%gateList.length]],['v',work]] as const){
  const cells:Point[]=[];for(let y=oy+1;y<bottom;y++)for(let x=ox+1;x<right;x++)if(inside(x,y)&&at(x,y)==='.'&&!used[y*w+x]&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>road(at(x+dx,y+dy))))cells.push({x,y});
  cells.sort((a,b)=>(Math.abs(a.x-target.x)+Math.abs(a.y-target.y))-(Math.abs(b.x-target.x)+Math.abs(b.y-target.y)));if(!cells.length)return;const p=cells[0];put(p.x,p.y,c);
 }
 // Place separated orchard and livestock plots in available rural strips; fill the largest remaining strip with fields.
 const available=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&!inside(x,y)&&at(x,y)==='.';
 const rects:{x:number;y:number;score:number}[]=[];
 for(let y=0;y+5<=h;y++)for(let x=0;x+6<=w;x++)if(Array.from({length:5},(_,dy)=>Array.from({length:6},(_,dx)=>available(x+dx,y+dy)).every(Boolean)).every(Boolean)&&y+5<h&&['.','_','='].includes(at(x+3,y+5)!))rects.push({x,y,score:(side===0?-y:side===2?y:side===1?x:-x)});
 rects.sort((a,b)=>a.score-b.score);if(!rects.length)return;const pen=rects[(n+phase)%Math.min(rects.length,4)];
 for(let dy=0;dy<5;dy++)for(let dx=0;dx<6;dx++)put(pen.x+dx,pen.y+dy,dx===0||dx===5||dy===0||dy===4?'p':'u');
 put(pen.x+2,pen.y+2,'P');put(pen.x+3,pen.y+4,'F');if(pen.y+5<h&&!connect({x:pen.x+3,y:pen.y+5},first,false,true))return;
 const orchard:Point[]=[];
 for(let y=1;y<h-1;y++)for(let x=1;x+5<w;x++)if([0,2,4].every(dx=>available(x+dx,y)))orchard.push({x,y});
 orchard.sort((a,b)=>(n%2?b.y-a.y:a.y-b.y)||(n%3?b.x-a.x:a.x-b.x));
 let rows=0;for(const p of orchard){if(rows>=2)break;if(![0,2,4].every(dx=>available(p.x+dx,p.y)))continue;
  if(rows&&g.some((r,yy)=>r.some((c,xx)=>c==='A'&&Math.abs(yy-p.y)<2&&Math.abs(xx-p.x)<7)))continue;
  for(let k=0;k<3+n%3;k++){const x=p.x+k*2;if(!available(x,p.y))break;put(x,p.y,'A');}rows++;
 }
 if(rows<2)return;
 // Broad crop belts reclaim the ground released by compaction. No crops inside the defences or pen.
 const outsideCells:Point[]=[];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(available(x,y)&&!g.some((row,yy)=>Math.abs(yy-y)<=1&&row.some((c,xx)=>c==='A'&&Math.abs(xx-x)<=1)))outsideCells.push({x,y});
 const farmSide=n%4;
 for(const p of outsideCells){const inBelt=farmSide===0?p.y<oy:farmSide===1?p.x>right:farmSide===2?p.y>bottom:p.x<ox;if(inBelt)put(p.x,p.y,'f');}
 const targetFields=Math.ceil((base.rows.join('').split('f').length-1)*1.3);
 let fieldCount=g.flat().filter(c=>c==='f').length;
 const edgeDistance=(p:Point)=>farmSide===0?p.y:farmSide===1?w-p.x:farmSide===2?h-p.y:p.x;
 for(const p of outsideCells.sort((a,b)=>edgeDistance(a)-edgeDistance(b))){if(fieldCount>=targetFields)break;if(at(p.x,p.y)==='.'){put(p.x,p.y,'f');fieldCount++;}}
 // Maximal-spacing decoration fills all neighbourhoods, rather than stopping in scan order.
 for(const [c,target,spacing]of [['a',6,3],['l',12,3]] as const){
  const chosen:Point[]=[];
  while(chosen.length<target){let best:Point|undefined,bestScore=-1;
   for(let y=oy+1;y<bottom;y++)for(let x=ox+1;x<right;x++){
    if(!inside(x,y)||at(x,y)!=='.'||used[y*w+x]||solid[y*w+x])continue;
    if(c==='a'&&buildings.some(b=>Math.abs(x-b.x-1)<2.4&&Math.abs(y-b.y-1)<2.4))continue;
    if(c==='l'&&![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>road(at(x+dx,y+dy))))continue;
    const dist=chosen.length?Math.min(...chosen.map(p=>Math.hypot(x-p.x,y-p.y))):Math.hypot(x-(ox+(n%2?cw:0)),y-(oy+ch/2));
    const score=dist+((x*17+y*13+v)%11)/20;if(dist>=spacing&&score>bestScore){best={x,y};bestScore=score;}
   }if(!best)break;put(best.x,best.y,c);chosen.push(best);
  }
 }
 return {...base,id,rows:g.map(r=>r.join('')),buildings};
}
