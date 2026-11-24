import type {SettlementTemplate} from './settlementTemplates.js';
// Move the existing barn to its fields. Existing saved compact templates retain their old geometry.
export function farmBarnTown(id:string,base:SettlementTemplate):SettlementTemplate {
 const g=base.rows.map(r=>r.split('')),w=g[0].length,h=g.length;
 const buildings=base.buildings.map(b=>({...b})),barn=buildings.find(b=>b.ref==='barn-small');if(!barn)throw new Error(id+': missing barn');
 const at=(x:number,y:number)=>g[y]?.[x];
 const inTown=(x:number,y:number)=>{if(!g[y])return false;let l=-1,r=-1;g[y].forEach((c,xx)=>{if('#%G'.includes(c)){if(l<0)l=xx;r=xx;}});return l>=0&&x>=l&&x<=r;};
 const taken=new Set<number>();for(const b of buildings)for(let y=b.y;y<b.y+3;y++)for(let x=b.x;x<b.x+3;x++)taken.add(y*w+x);
 const candidates:{x:number;y:number;score:number}[]=[];
 for(let y=1;y+3<h;y++)for(let x=1;x+3<w;x++){
  let crops=0,ok=true;for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++){const c=at(x+dx,y+dy);if(inTown(x+dx,y+dy)||taken.has((y+dy)*w+x+dx)||!['.','f'].includes(c!))ok=false;if(c==='f')crops++;}
  if(ok&&crops>=6)candidates.push({x,y,score:crops*10-Math.min(x,y,w-x-3,h-y-3)});
 }
 candidates.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
 for(const p of candidates){
  const roof=new Set<number>();for(let dy=0;dy<2;dy++)for(let dx=0;dx<3;dx++)roof.add((p.y+dy)*w+p.x+dx);
  const start=(p.y+2)*w+p.x+1,prev=new Map<number,number>([[start,start]]),q=[start];let end=-1;
  for(let k=0;k<q.length;k++){const i=q[k],x=i%w,y=Math.floor(i/w);if(['_','=','G','F'].includes(at(x,y)!)){end=i;break;}
   for(const [dx,dy]of [[0,1],[1,0],[-1,0],[0,-1]]){const xx=x+dx,yy=y+dy,n=yy*w+xx;if(xx<0||yy<0||xx>=w||yy>=h||prev.has(n)||roof.has(n)||taken.has(n)||inTown(xx,yy)||!['.','f','_','=','G','F'].includes(at(xx,yy)!))continue;prev.set(n,i);q.push(n);}
  }
  if(end<0)continue;
  const lane=new Set<number>();for(let i=end;;i=prev.get(i)!){lane.add(i);if(i===start)break;}
  let nearby=0;for(let y=p.y-1;y<=p.y+3;y++)for(let x=p.x-1;x<=p.x+3;x++)if(at(x,y)==='f'&&!lane.has(y*w+x)&&!(x>=p.x&&x<p.x+3&&y>=p.y&&y<p.y+3))nearby++;
  if(nearby<3)continue;
  const old={x:barn.x,y:barn.y};barn.x=p.x;barn.y=p.y;
  for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)g[p.y+dy][p.x+dx]='.';
  for(let i=end;;i=prev.get(i)!){const x=i%w,y=Math.floor(i/w);if(!['_','=','G','F'].includes(at(x,y)!))g[y][x]='_';if(i===start)break;}
  // The vacated barn frontage becomes a small planted court, preserving all houses.
  if(at(old.x+1,old.y+1)==='.')g[old.y+1][old.x+1]='a';
  if(at(old.x+2,old.y+2)==='.')g[old.y+2][old.x+2]='l';
  const target=base.rows.join('').split('f').length-1;
  let count=g.flat().filter(c=>c==='f').length;
  while(count<target){let best:{x:number;y:number}|undefined,score=Infinity;
   const fields:{x:number;y:number}[]=[];g.forEach((row,y)=>row.forEach((c,x)=>{if(c==='f')fields.push({x,y});}));
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    if(at(x,y)!=='.'||inTown(x,y)||taken.has(y*w+x)||x>=p.x&&x<p.x+3&&y>=p.y&&y<p.y+3)continue;
    if(g.some((row,yy)=>Math.abs(yy-y)<=1&&row.some((c,xx)=>c==='A'&&Math.abs(xx-x)<=1)))continue;
    const d=Math.min(...fields.map(f=>Math.abs(f.x-x)+Math.abs(f.y-y)));if(d<score){best={x,y};score=d;}
   }if(!best)break;g[best.y][best.x]='f';count++;
  }
  return {...base,id,rows:g.map(r=>r.join('')),buildings};
 }
 throw new Error(id+': no accessible farm-side barn plot');
}
