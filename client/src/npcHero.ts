import {Texture} from 'pixi.js';
import {sanitizeHeroAppearance,type HeroVisual} from '@colony/shared/protocol';
import type {HeroPose} from './heroRig';
const sheets=new Map<string,HTMLImageElement>();
const cache=new Map<string,{canvas:HTMLCanvasElement;texture:Texture;bodyHeight:number;buildScale:number}>();
let loading:Promise<void>|undefined;
export function loadNpcHero(){return loading??=Promise.all([0,1,2,3].flatMap(t=>['foot','mounted'].map(mode=>new Promise<void>(resolve=>{const key=`armour-${t}-${mode}`,i=new Image();i.onload=()=>{sheets.set(key,i);resolve()};i.onerror=()=>resolve();i.src=`/sprites/hero-npc/${key}.png?v=spear-shield-20261117`;})))).then(()=>{});}
export function npcHeroFrame(v:HeroVisual,pose:HeroPose,mounted:boolean){
 const a=sanitizeHeroAppearance(v.appearance);
 // The supplied pack contains one male and these seven loadouts. Retain the rig for missing artwork.
 if(a.gender!=='m'||a.face!==0||a.hair!==1||a.hairColor!==1||a.skin!==1||(mounted&&a.horse!=='bay')||!['sword','spear','axe','bow'].includes(v.weapon))return;
 if(v.helmet !== (v.armour>0) || (v.helmet && (v.helmTier||1)!==v.armour) || (v.weaponTier||1)!==Math.max(1,v.armour) || (v.shield && (v.shieldTier||1)!==Math.max(1,v.armour)))return;
 const tier=Math.max(0,Math.min(3,v.armour)),key=`armour-${tier}-${mounted?'mounted':'foot'}`,img=sheets.get(key);if(!img)return;
 const row=v.weapon==='bow'?6:({sword:0,spear:2,axe:4} as Record<string,number>)[v.weapon]+(v.shield?1:0);
 const oneShot=pose.state==='attack'||pose.state==='hurt',phase=oneShot?Math.max(0,Math.min(.999999,pose.phase)):((pose.phase%1)+1)%1;
 const frames={idle:[0,1],walk:[2,3,4,5],attack:[6,7,8],hurt:[9]}[pose.state],col=frames[Math.floor(phase*frames.length)];
 const id=`${key}/${row}/${col}/${a.build}/${pose.facing??1}`;const old=cache.get(id);if(old)return old;
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=mounted?240:192;const g=canvas.getContext('2d')!;g.imageSmoothingEnabled=false;
 const ground=mounted?211:163,factor=[.93,1,1.07][a.build];g.translate(120,ground);g.scale((pose.facing===-1?-1:1)*factor,factor);g.translate(-120,-ground);
 g.drawImage(img,col*256,row*240,256,240,0,0,256,240);
 const texture=Texture.from(canvas);texture.source.scaleMode='nearest';const result={canvas,texture,bodyHeight:89,buildScale:factor};cache.set(id,result);if(cache.size>384)cache.delete(cache.keys().next().value!);return result;
}
