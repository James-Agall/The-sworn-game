import {TileType,isSolidTile} from '@colony/shared/protocol';
import {state,sites,hearths,mobs,players,colonists,constructionSites,buildingHp,buildingLevel} from './state.js';
import {inBounds,tileIndex,ownerAt,setOwner,placedFootprint,resourceKey} from './tiles.js';
import {setSiteTile} from './sites.js';
import {clanIdAt,setTileClan} from './clans.js';
// Upgrade only clear ground. Do not erase roads, trees, player work, or occupied tiles.
export function expandKeepFootprints(){
 let expanded=0,blocked=0;
 const anchors=[];for(let i=0;i<state.tiles.length;i++)if(state.tiles[i]===TileType.Keep||state.tiles[i]===TileType.SiteKeep||state.tiles[i]===TileType.RuinedKeep)anchors.push({x:i%state.WORLD_TILES_X,y:Math.floor(i/state.WORLD_TILES_X),tile:state.tiles[i] as TileType});
 for(const a of anchors){
  if(placedFootprint(a.x,a.y).w===3)continue;
  const site=[...sites.values()].find(s=>s.keepX===a.x&&s.keepY===a.y);
  if(site?.captured){blocked++;continue;}
  const owner=ownerAt(tileIndex(a.x,a.y)),clan=clanIdAt(a.x,a.y);
  const offsets=site?[[-1,-1],[0,0],[-2,-2],[-1,0],[0,-1],[-2,0],[0,-2],[-1,-2],[-2,-1]]:[[0,0]];
  const chosen=offsets.map(([dx,dy])=>({x:a.x+dx,y:a.y+dy})).find(p=>{
   if(!inBounds(p.x,p.y)||!inBounds(p.x+2,p.y+3))return false;
   if(site&&(p.x<site.x0||p.y<site.y0||p.x+2>site.x1||p.y+2>site.y1))return false;
   if(isSolidTile(state.tiles[tileIndex(p.x+1,p.y+3)]))return false;
   for(let y=p.y;y<p.y+3;y++)for(let x=p.x;x<p.x+3;x++){
    if(x===a.x&&y===a.y)continue;
    const i=tileIndex(x,y);if(state.tiles[i]!==TileType.Empty||(ownerAt(i)!==0&&ownerAt(i)!==owner)||constructionSites.has(`${x},${y}`))return false;
    if([...players.values(),...colonists.values(),...mobs.values()].some(u=>Math.floor(u.x/32)===x&&Math.floor(u.y/32)===y))return false;
   }
   return true;
  });
  if(!chosen){blocked++;continue;}
  const p=chosen;const oldKey=resourceKey(a.x,a.y),hp=buildingHp.get(oldKey),level=buildingLevel.get(oldKey);
  for(let y=p.y;y<p.y+3;y++)for(let x=p.x;x<p.x+3;x++){
   setSiteTile(x,y,x===p.x&&y===p.y?a.tile:TileType.BuildingPart,false);setOwner(tileIndex(x,y),owner);if(!owner)setTileClan(tileIndex(x,y),clan);
  }
  const newKey=resourceKey(p.x,p.y);if(hp!==undefined)buildingHp.set(newKey,hp);if(level!==undefined)buildingLevel.set(newKey,level);
  if(site){site.keepX=p.x;site.keepY=p.y;site.homeX=(p.x+1.5)*32;site.homeY=(p.y+3.5)*32;const hearth=hearths.get(site.id);if(hearth){hearth.x=p.x;hearth.y=p.y;}}
  expanded++;
 }
 return{expanded,blocked};
}
