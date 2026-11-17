import {applySpearShieldCorrection} from './apply-spear-shield-correction.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readPNG,writePNG} from './lib/png.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url)),src=process.argv[2],out=process.argv[3]??repo+'/client/public/sprites/hero-npc';if(!src)throw Error('Usage: node scripts/slice-npc-hero.mjs SOURCE_DIRECTORY [OUTPUT_DIRECTORY]');mkdirSync(out,{recursive:true});
const layout=JSON.parse(readFileSync(src+'/layout.json'));const report=[];
for(const sheet of layout.sheets){const p=readPNG(src+'/'+sheet.file),labels=new Int32Array(p.w*p.h),components=[];let id=0;
 for(let pos=0;pos<labels.length;pos++){if(labels[pos]||p.data[pos*4+3]<80)continue;const pixels=[pos];labels[pos]=++id;let x0=p.w,y0=p.h,x1=0,y1=0,sumX=0,sumY=0;
  for(let q=0;q<pixels.length;q++){const n=pixels[q],x=n%p.w,y=Math.floor(n/p.w);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);sumX+=x;sumY+=y;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,k=yy*p.w+xx;if(xx>=0&&yy>=0&&xx<p.w&&yy<p.h&&!labels[k]&&p.data[k*4+3]>=80){labels[k]=id;pixels.push(k);}}}
  components.push({id,pixels,x0,y0,x1,y1,cx:sumX/pixels.length,cy:sumY/pixels.length});
 }
 const groups=Array.from({length:70},()=>[]);const mains=components.filter(c=>c.pixels.length>250).sort((a,b)=>b.pixels.length-a.pixels.length).slice(0,70);
 for(const c of mains){const row=Math.min(6,Math.floor(c.cy/(p.h/7))),col=Math.min(9,Math.floor(c.cx/(p.w/10)));groups[row*10+col].push(c);}
 if(groups.some(g=>g.length!==1))throw Error(sheet.file+' ambiguous sprite grid '+groups.map(g=>g.length));
 for(const c of components){if(mains.includes(c)||c.pixels.length<8)continue;let best=0,dist=Infinity;for(let i=0;i<70;i++){const main=groups[i][0],d=((c.cx-main.cx)/(p.w/10))**2+((c.cy-main.cy)/(p.h/7))**2;if(d<dist){dist=d;best=i;}}if(dist<.65)groups[best].push(c);}
 const dest={w:2560,h:1680,data:new Uint8Array(2560*1680*4)};
 for(let row=0;row<7;row++){const idle=groups[row*10][0],scale=(sheet.mounted?150:89)/(idle.y1-idle.y0+1);
  for(let col=0;col<10;col++){const group=groups[row*10+col],main=group[0],ids=new Set(group.map(c=>c.id));let sum=0,n=0;for(const k of main.pixels){const y=Math.floor(k/p.w);if(y>main.y1-(idle.y1-idle.y0)*.72&&y<main.y1-(idle.y1-idle.y0)*.42){sum+=k%p.w;n++;}}const cx=n?sum/n:main.cx,ground=sheet.mounted?211:163;
   for(let y=0;y<240;y++)for(let x=0;x<256;x++){const xx=Math.round((x-120)/scale+cx),yy=Math.round((y-ground)/scale+main.y1),k=yy*p.w+xx;if(xx<0||yy<0||xx>=p.w||yy>=p.h||!ids.has(labels[k]))continue;dest.data.set(p.data.subarray(k*4,k*4+4),((row*240+y)*dest.w+col*256+x)*4);}
  }
 }
 writePNG(out+'/'+sheet.file,dest);report.push({file:sheet.file,frames:70,components:mains.length});console.log(sheet.file+': 70 outline-isolated frames');
}
writeFileSync(out+'/manifest.json',JSON.stringify({cell:[256,240],rows:layout.rows,animations:layout.animations,bodyHeight:89,ground:{foot:163,mounted:211},sheets:report},null,2));

// Preserve the reviewed one-handed spear/shield attacks after regenerating the base pack.
applySpearShieldCorrection(out);
