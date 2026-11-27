// Player rig contact sheets (2026-11-27, PLAYER-RIG-2026-11-27.md): the RUNTIME rig (heroFrame with allowRig, the
// hero-npc sheets blocked) for every weapon with/without shield, idle/walk x8/attack x8/hurt/mounted, armour tiers,
// builds and genders, plus joint and motion close-ups and walk ground-contact numbers (metrics.json).
// Art inspection only: no game actions, no saves, no asset changes. Run it against a private Vite dev server:
//   (cd client && npx vite --port 31940 --strictPort --host 127.0.0.1) &
//   PW_MODULE_FROM=<package.json whose node_modules has playwright> PW_CHROME=<chromium> \
//     node scripts/player-rig-sheets.mjs <out dir> 31940
// 1x / 2x sheets use the real in-game scale (25 px per frame.bodyHeight); the others draw the bake 1:1 or zoomed.
import {createRequire} from 'node:module';import {writeFileSync,mkdirSync} from 'node:fs';
const require=createRequire(process.env.PW_MODULE_FROM??'/home/james/projects/auto-loan-ff-release/package.json');const {chromium}=require('playwright');
const [out,port]=[process.argv[2],process.argv[3]];if(!out||!port||[8080,5173,5175].includes(+port))throw Error('usage: node scripts/player-rig-sheets.mjs <out dir> <private vite port>');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PW_CHROME??`${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.route('**/sprites/hero-npc/**',r=>r.abort());
await page.goto(`http://127.0.0.1:${port}/rig/parts/grounded-v2/README.md`);
const sheets=await page.evaluate(async()=>{
 const {heroFrame,loadHeroRig}=await import('/src/heroRig.ts');await loadHeroRig();
 const look={name:'W',gender:'m',build:1,face:0,hair:1,hairColor:1,skin:1,look:'wanderer',horse:'bay'};
 const base={appearance:look,weapon:'sword',weaponTier:1,armour:1,helmet:false,helmTier:0,shield:false,shieldTier:0};
 const res=[];
 const frame=(v,s,p,m)=>{const f=heroFrame(v,{state:s,phase:p},m,true);if(!f)throw Error('no rig '+JSON.stringify(v)+s);return f};
 function sheet(name,cols,rows,cells,k,crop,game){const [OX,OY,CW,CH]=crop??[40,18,170,165]; // cells: [{v,s,p,m,label}] ; k = draw scale of the native bake
  const cw=Math.round(CW*k),ch=Math.round(CH*k)+14;const c=document.createElement('canvas');c.width=cols*cw;c.height=rows*ch;const g=c.getContext('2d');
  g.fillStyle='#cad0b1';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=k<1;g.imageSmoothingQuality='high';g.font='11px sans-serif';
  cells.forEach((e,i)=>{if(!e)return;const x=(i%cols)*cw,y=Math.floor(i/cols)*ch;const f=frame(e.v,e.s,e.p,e.m);const oy=e.m?OY+40:OY;
   const kk=game?game*25/f.bodyHeight:k;g.drawImage(f.canvas,OX,oy,CW,CH,x,y+14,CW*kk,CH*kk);g.fillStyle='#302b22';g.fillText(e.label,x+2,y+11);
   g.strokeStyle='rgba(0,0,0,.15)';g.strokeRect(x+.5,y+.5,cw-1,ch-1);});
  res.push({name,url:c.toDataURL('image/png')});}
 const weaponSheets=[['sword',false],['sword',true],['axe',false],['axe',true],['spear',false],['spear',true],['bow',false],['unarmed',false]];
 const all1x=[];
 for(const [w,sh] of weaponSheets){const v={...base,weapon:w,shield:sh,shieldTier:sh?1:0};const cells=[];
  cells.push({v,s:'idle',p:0,label:'idle 0'},{v,s:'idle',p:.5,label:'idle .5'},{v,s:'hurt',p:.3,label:'hurt .3'},{v,s:'idle',p:0,m:true,label:'ride idle'},{v,s:'walk',p:.25,m:true,label:'ride walk'},{v,s:'attack',p:.5,m:true,label:'ride atk .5'},{v,s:'attack',p:.62,m:true,label:'ride atk .62'},null);
  for(let i=0;i<8;i++)cells.push({v,s:'walk',p:i/8,label:'walk '+i+'/8'});
  for(let i=0;i<8;i++)cells.push({v,s:'attack',p:i/7,label:'atk '+(i/7).toFixed(2)});
  const nm=`w-${w}${sh?'-shield':''}`;sheet(nm,8,3,cells,1);all1x.push(...cells.slice(0,7),...cells.slice(8));}
 // variants: armour tiers, builds, genders
 const vc=[];
 for(let t=0;t<4;t++)for(const [s,p] of [['idle',0],['walk',.25],['attack',.5]])vc.push({v:{...base,armour:t,helmet:t>0,helmTier:t,weaponTier:t||1,shield:t>0,shieldTier:t},s,p,label:`armour ${t} ${s}`});
 for(const g of ['m','f'])for(let b=0;b<3;b++)for(const [s,p] of [['idle',0],['walk',.25]])vc.push({v:{...base,appearance:{...look,gender:g,build:b,hair:b+1,face:b,skin:b+1}},s,p,label:`${g} build ${b} ${s}`});
 sheet('variants',12,Math.ceil(vc.length/12),vc,1);
 sheet('all-1x-ingame',24,Math.ceil((all1x.length+vc.length)/24),[...all1x,...vc],25/89,undefined,1);
 sheet('variants-2x-ingame',12,Math.ceil(vc.length/12),vc,50/89,undefined,2);
 // joint zoom (5x the bake) of key poses
 const z=[{v:{...base,shield:true,shieldTier:1},s:'idle',p:0,label:'idle'},{v:{...base,shield:true,shieldTier:1},s:'walk',p:.25,label:'walk .25'},{v:{...base,weapon:'spear'},s:'attack',p:.5,label:'spear .5'},{v:{...base,weapon:'bow'},s:'attack',p:.5,label:'bow .5'}];
 sheet('joints-zoom',2,2,z,5,[80,54,100,114]);
 const mz=[];for(const p of [0,.125,.25,.375,.5,.625,.75,.875])mz.push({v:{...base,weapon:'unarmed'},s:'walk',p,label:'walk '+p});for(const w of ['sword','axe','spear','bow'])for(const p of [.28,.5,.62,.85])mz.push({v:{...base,weapon:w},s:'attack',p,label:w+' '+p});
 sheet('motion-zoom',8,3,mz,2.2,[70,50,120,118]);
 // walk ground contact: lowest opaque row per 32 phases (both feet), and idle
 const low=(f)=>{const g=f.canvas.getContext('2d'),d=g.getImageData(0,0,f.canvas.width,f.canvas.height).data,W=f.canvas.width;for(let y=f.canvas.height-1;y>=0;y--)for(let x=0;x<W;x++)if(d[(y*W+x)*4+3]>100)return y;return -1};
 const top=(f)=>{const g=f.canvas.getContext('2d'),d=g.getImageData(0,0,f.canvas.width,f.canvas.height).data,W=f.canvas.width;for(let y=0;y<f.canvas.height;y++)for(let x=60;x<180;x++)if(d[(y*W+x)*4+3]>100)return y;return -1};
 const v0={...base,weapon:'unarmed'};const idle=frame(v0,'idle',0);const lows=[];for(let i=0;i<32;i++)lows.push(low(frame(v0,'walk',i/32)));
 return {res,metrics:{idleLow:low(idle),idleTop:top(idle),walkLows:lows}};
});
for(const s of sheets.res)writeFileSync(`${out}/${s.name}.png`,Buffer.from(s.url.split(',')[1],'base64'));
writeFileSync(`${out}/metrics.json`,JSON.stringify(sheets.metrics));console.log(JSON.stringify(sheets.metrics));console.log('errors',errors);
await browser.close();
