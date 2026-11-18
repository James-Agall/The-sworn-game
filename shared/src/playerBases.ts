import {buildInteriorMap, interiorSolidGrid, type InteriorMap, type InteriorProp, type InteriorFloor} from './interiors.js';
export const PLAYER_BASES = [
 {id:'hill-burrow',label:'Hill burrow',w:11,h:9,floor:'wood',wall:'wood'},
 {id:'cottage',label:'Cottage',w:11,h:8,floor:'wood',wall:'wood'},
 {id:'townhouse',label:'Townhouse',w:9,h:13,floor:'wood',wall:'stone'},
 {id:'longhouse',label:'Longhouse',w:17,h:9,floor:'wood',wall:'wood'},
 {id:'hunting-lodge',label:'Hunting lodge',w:13,h:9,floor:'wood',wall:'wood'},
 {id:'farmhouse',label:'Farmhouse',w:15,h:11,floor:'wood',wall:'wood'},
 {id:'watchtower',label:'Watchtower home',w:9,h:11,floor:'stone',wall:'stone'},
 {id:'manor',label:'Fortified manor',w:17,h:13,floor:'wood',wall:'stone'},
 {id:'gatehouse',label:'Gatehouse residence',w:17,h:11,floor:'stone',wall:'stone'},
 {id:'keep',label:'Stone keep',w:19,h:15,floor:'stone',wall:'stone'},
] as const;
export type HomeDesign={base:string;floor?:InteriorFloor;wall?:'wood'|'stone';props?:InteriorMap['props']};
export const HOME_PROPS:InteriorProp[]=['bed','bedFine','chest','table','chair','hearth','lamp','rug','shelf','wardrobe','barrel','crates','sacks','hay','weaponRack','armourStand','banner','statue','workbench','candelabra'];
export function playerBaseMap(design:HomeDesign,level:number):InteriorMap{
 const b=PLAYER_BASES.find(b=>b.id===design.base)??PLAYER_BASES[1],idx=PLAYER_BASES.indexOf(b),w=b.w,h=b.h,cx=Math.floor(w/2);
 const cells:string[]=Array.from({length:w*h},(_,i)=>i%w===0||i%w===w-1||i<w||i>=w*(h-1)?'#':'.');cells[(h-1)*w+cx]='E';
 // Bedrooms and a service alcove have generous doorways onto a central hall.
 if(w>=13){for(let y=1;y<h-3;y++){if(y!==3&&y!==h-5){cells[y*w+4]='#';cells[y*w+w-5]='#';}}}
 if(design.base==='hill-burrow')for(const [x,y]of [[1,1],[w-2,1],[1,h-2],[w-2,h-2]])cells[y*w+x]='#';
 const props:InteriorMap['props']=[{prop:'bed',x:2,y:2,facing:'n'},{prop:'chest',x:w-3,y:2,facing:'s'},{prop:'hearth',x:cx,y:1,facing:'s'},{prop:'table',x:cx,y:4,facing:'s'},{prop:'chair',x:cx-1,y:4,facing:'e'},{prop:'chair',x:cx+1,y:4,facing:'w'},{prop:'shelf',x:1,y:h-3,facing:'e'},{prop:'rug',x:cx,y:h-3,facing:'s'}];
 const extras:InteriorProp[]=['barrel','lamp','wardrobe','banner','weaponRack','sacks','armourStand','statue','workbench','throne'];
 props.push({prop:extras[idx],x:w-2,y:h-3,facing:'w'});
 if(w>=15)props.push({prop:'bedFine',x:2,y:h-4,facing:'n'},{prop:'workbench',x:w-3,y:4,facing:'w'});
 return{templateId:'house',label:b.label,level,variant:idx,storey:0,w,h,floor:design.floor??b.floor,wall:design.wall??b.wall,cells:cells.join(''),props:design.props??props,slots:[],exit:{x:cx,y:h-1},spawn:{x:cx,y:h-2},stairs:null};
}
export function validHomeMap(m:InteriorMap):boolean{
 const solid=interiorSolidGrid(m),start=m.spawn.y*m.w+m.spawn.x;if(solid[start]||m.props.length>120)return false;
 const seen=new Set([start]),q=[start];for(let k=0;k<q.length;k++){const i=q[k];for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=i%m.w+dx,y=Math.floor(i/m.w)+dy,j=y*m.w+x;if(x<0||y<0||x>=m.w||y>=m.h||solid[j]||seen.has(j))continue;seen.add(j);q.push(j);}}
 if(!seen.has(m.exit.y*m.w+m.exit.x))return false;
 // Keep every usable floor connected and each furnishing reachable from a side.
 for(let i=0;i<solid.length;i++)if(!solid[i]&&!seen.has(i))return false;
 return m.props.every(p=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has((p.y+dy)*m.w+p.x+dx)));
}
