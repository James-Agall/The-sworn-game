// Convert only untouched neutral template buildings; never overwrite captured or player-edited settlements.
import {readFileSync,existsSync} from 'node:fs';
import {TileType} from '@colony/shared/protocol';
import {buildingCells} from '@colony/shared/buildingTemplates';
import {settlementLayout,transformSettlement,spriteBuildingCells,type SettlementTemplate} from '@colony/shared/settlementTemplates';
import {buildingTemplateById} from './buildingTemplates.js';
import {sites,state,tileOwner,mobs} from './state.js';
import {setSiteTile} from './sites.js';
import {tileIndex,setOwner} from './tiles.js';
export function migrateNeutralSpriteHomes(){
 let count=0;
 for(const site of sites.values()){
  if(site.faction!=='human'||site.captured||site.cleared||!site.layout)continue;
  const path=new URL('../data/settlements-legacy/'+site.layout+'.json',import.meta.url);
  if(!existsSync(path))continue;
  const original=JSON.parse(readFileSync(path,'utf8')) as SettlementTemplate;
  for(let tf=0;tf<8;tf++){
   const t=transformSettlement(original,tf,buildingTemplateById),l=settlementLayout(t,buildingTemplateById);
   if(l.w!==site.x1-site.x0+1||l.h!==site.y1-site.y0+1||!l.keep||site.x0+l.keep.x!==site.keepX||site.y0+l.keep.y!==site.keepY)continue;
   // Exact old layout match prevents converting edited, damaged, or already converted places.
   let match=true;
   for(let y=0;y<l.h&&match;y++)for(let x=0;x<l.w;x++){const old=l.tiles[y*l.w+x];if(old>=0&&state.tiles[tileIndex(site.x0+x,site.y0+y)]!==old){match=false;break;}}
   if(!match)continue;
   const homes:number[]=[];
   for(const b of t.buildings){
    const bt=buildingTemplateById(b.ref)!;const shape=buildingCells(bt,b.transform??0);
    const x0=site.x0+b.x,y0=site.y0+b.y;
    const tile=spriteBuildingCells(bt).cells[0].tile;
    let ax=x0+Math.floor(shape.w/2),ay=y0+Math.floor(shape.h/2);
    if(tile===TileType.Keep){ax=site.keepX;ay=site.keepY;}
    for(const c of shape.cells){const x=x0+c.x,y=y0+c.y,i=tileIndex(x,y);if(x===site.keepX&&y===site.keepY)continue;if(tileOwner.get(i)===site.num){setSiteTile(x,y,TileType.Empty,false);setOwner(i,site.num);}}
    if(tile!==TileType.Keep){setSiteTile(ax,ay,tile,false);setOwner(tileIndex(ax,ay),site.num);}
    const front=tileIndex(ax,ay+1);
    if(['house','longhouse','hall'].includes(bt.buildingType))homes.push(front);
    for(const mob of mobs.values())if(mob.siteId===site.id&&mob.siteWorker&&mob.x/32>=x0&&mob.x/32<x0+shape.w&&mob.y/32>=y0&&mob.y/32<y0+shape.h){mob.x=ax*32+16;mob.y=(ay+1)*32+16;mob.workB=front;}
   }
   if(site.homes&&homes.length)site.homes.villagers=homes;
   count++;break;
  }
 }
 return count;
}
