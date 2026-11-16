// Art inspection only: render the real runtime, every gender/build/weapon/armour combination.
// Imported by a private preview session; no game actions, no saves, no asset changes.
import {writeFileSync,mkdirSync} from 'node:fs';
export async function renderRigContactSheets(page,output){
 const sheets=await page.evaluate(async()=>{
  const {heroFrame,loadHeroRig}=await import('/src/heroRig.ts');await loadHeroRig();
  const {heroArt,loadHeroAppearanceArt}=await import('/src/heroAppearance.ts');await loadHeroAppearanceArt();
  const defaultLook={name:'Wanderer',gender:'m',build:1,face:0,hair:1,hairColor:1,skin:1,look:'wanderer',horse:'bay'};
  const base={appearance:defaultLook,weapon:'unarmed',weaponTier:1,armour:0,helmet:false,helmTier:0,shield:false,shieldTier:0};
  const result=[];
  function sheet(name,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#cad0b1';g.fillRect(0,0,w,h);g.font='13px sans-serif';return{c,g,save:()=>result.push({name,url:c.toDataURL('image/png')})};}
  function draw(g,v,state,phase,mounted,x,y,k=1){const f=heroFrame(v,{state,phase},mounted);if(!f)throw Error('Missing rig '+JSON.stringify(v));g.drawImage(f.canvas,x-120*k,y-(mounted?211:163)*k,f.canvas.width*k,f.canvas.height*k);return f;}
  for(const gender of ['m','f'])for(const build of [0,1,2]){
   const {g,save}=sheet(`rig-${gender}-build${build}`,1280,16*150);let row=0;
   for(const weapon of ['sword','axe','spear','bow'])for(const armour of [0,1,2,3]){
    const v={...base,appearance:{...defaultLook,gender,build,face:armour%3,hair:armour%4,hairColor:armour,skin:armour},weapon,weaponTier:armour||1,armour,helmet:armour>0,helmTier:armour,shield:weapon!=='bow'&&armour>0,shieldTier:armour};
    const poses=[['idle',0,false],['walk',.125,false],['walk',.625,false],['attack',.35,false],['attack',.65,false],['idle',0,true],['walk',.625,true],['attack',.65,true]];
    poses.forEach(([s,p,m],col)=>{const x=col*160,y=row*150;g.fillStyle='#302b22';g.fillText(`${weapon} T${armour} ${s}${m?' ride':''}`,x+3,y+14);draw(g,v,s,p,m,x+72,y+130,m?.64:1);draw(g,v,s,p,m,x+137,y+145,25/93);});row++;
   }save();
  }
  {const {g,save}=sheet('hair-and-faces',960,720);for(const gender of ['m','f'])for(let face=0;face<3;face++)for(let hair=0;hair<4;hair++){
   const row=(gender==='f'?3:0)+face,x=hair*240,y=row*120;g.fillStyle='#302b22';g.fillText(`${gender} face ${face} hair ${hair}`,x+8,y+16);draw(g,{...base,appearance:{...defaultLook,gender,face,hair,hairColor:hair,skin:face}},'idle',0,false,x+115,y+115,1);
  }save();}
  {const {g,save}=sheet('character-lineup',1120,530);g.fillStyle='#302b22';g.font='22px Georgia';g.fillText('Painted character rig · foot and mounted',24,30);g.font='13px sans-serif';
   for(let i=0;i<4;i++){const weapon=['sword','axe','spear','bow'][i],x=130+i*270,v={...base,appearance:{...defaultLook,gender:i%2?'f':'m',hair:i,skin:i%3,horse:['bay','grey','black','palomino'][i]},weapon,armour:i,helmet:i>0,helmTier:i,weaponTier:i||1,shield:i===2,shieldTier:i};g.fillText(`${weapon} · armour ${i}`,x-60,60);draw(g,v,'idle',0,false,x,225,1.5);draw(g,v,'idle',0,true,x,460,1.25);}
   const old=heroArt(base);if(old){g.fillText('Existing hero / rig, both at game body size',24,502);g.drawImage(old.canvas,325,478,34,34);draw(g,base,'idle',0,false,380,512,25/93);}save();}
  return result;
 });
 mkdirSync(output,{recursive:true});for(const s of sheets)writeFileSync(output+'/'+s.name+'.png',Buffer.from(s.url.split(',')[1],'base64'));return sheets.length;
}
