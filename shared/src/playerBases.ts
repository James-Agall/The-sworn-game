import {interiorSolidGrid, type InteriorMap, type InteriorProp, type InteriorFloor} from './interiors.js';
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
export const HOME_PROPS:InteriorProp[]=['bed','bedFine','chest','table','chair','hearth','lamp','rug','shelf','wardrobe','barrel','crates','sacks','hay','weaponRack','armourStand','banner','statue','workbench','candelabra','counter','oven','throne'];
export function playerBaseMap(design:HomeDesign,level:number):InteriorMap{
 const b=PLAYER_BASES.find(b=>b.id===design.base)??PLAYER_BASES[1],idx=PLAYER_BASES.indexOf(b),w=b.w,h=b.h,cx=Math.floor(w/2);
 const cells:string[]=Array.from({length:w*h},(_,i)=>i%w===0||i%w===w-1||i<w||i>=w*(h-1)?'#':'.');cells[(h-1)*w+cx]='E';
 // A bedroom divider gives smaller houses an alcove with an open two-cell doorway.
 if(w<=11){for(const y of [1,2])if(!design.props?.some(p=>p.x===4&&p.y===y))cells[y*w+4]='#';}
 // Bedrooms and a service alcove have generous doorways onto a central hall.
 if(w>=13){for(let y=1;y<h-3;y++){if(y!==3&&y!==h-5){cells[y*w+4]='#';cells[y*w+w-5]='#';}}}
 if(design.base==='hill-burrow')for(const [x,y]of [[1,1],[w-2,1],[1,h-2],[w-2,h-2]])cells[y*w+x]='#';
 const props:InteriorMap['props']=[];
 const map:InteriorMap={templateId:'house',label:b.label,level,variant:idx,storey:0,w,h,floor:design.floor??b.floor,wall:design.wall??b.wall,cells:cells.join(''),props,slots:[],exit:{x:cx,y:h-1},spawn:{x:cx,y:h-2},stairs:null};
 // Furnished activity areas differ by home; keep an uninterrupted central route to the exit.
 const add=(prop:InteriorProp,x:number,y:number,facing:'n'|'e'|'s'|'w'='s')=>{
  if(x<1||y<1||x>=w-1||y>=h-1||cells[y*w+x]!=='.'||props.some(p=>p.x===x&&p.y===y)||(x===cx&&y===h-2))return;
  props.push({prop,x,y,facing});if(!validHomeMap(map))props.pop();
 };
 add('bed',2,2,'n');add('chest',w-3,2);add('hearth',b.id==='keep'?cx-3:w<=9?cx+1:cx,1);
 const themes:Record<string,InteriorProp[]>={
  'hill-burrow':['shelf','barrel','sacks','oven','counter','lamp'],
  cottage:['shelf','wardrobe','counter','lamp','barrel'],
  townhouse:['workbench','shelf','crates','counter','lamp'],
  longhouse:['barrel','banner','weaponRack','lamp'],
  'hunting-lodge':['weaponRack','hay','workbench','sacks','lamp'],
  farmhouse:['oven','sacks','barrel','counter','hay','lamp'],
  watchtower:['weaponRack','armourStand','workbench','banner','lamp'],
  manor:['shelf','statue','candelabra','banner','counter'],
  gatehouse:['weaponRack','armourStand','workbench','crates','banner','lamp'],
  keep:['banner','statue','armourStand','weaponRack','candelabra','shelf']
 };
 // Dining / working centre, with chairs facing into the table.
 const diningY=Math.floor(h/2);
 add('table',cx-1,diningY);add('chair',cx-2,diningY,'e');add('chair',cx,diningY,'w');
 add('rug',cx-1,diningY+1);add('lamp',1,2,'e');add('wardrobe',1,1,'e');
 if(w>=13){add('bedFine',2,h-4,'n');add('chest',1,h-4,'e');add('workbench',w-3,h-4,'w');}
 if(['longhouse','manor','keep'].includes(b.id)){
  add('table',cx-1,diningY-2);add('chair',cx-2,diningY-2,'e');add('chair',cx,diningY-2,'w');
 }
 if(b.id==='keep'){add('throne',cx,1);add('banner',cx+2,1);add('rug',cx,2);}
 if(['townhouse','hunting-lodge','farmhouse'].includes(b.id))add('workbench',w-3,Math.max(3,diningY-1),'w');
 const theme=themes[b.id];let n=0;
 // Wall-side storage, alcoves and small islands; skip any item that would block access.
 const positions:[number,number][]=[];
 for(let x=1;x<w-1;x+=2)if(x!==cx)positions.push([x,1]);
 for(let y=3;y<h-2;y+=2){positions.push([1,y],[w-2,y]);}
 for(let y=3;y<h-3;y+=3)positions.push([w-3,y]);
 for(let x=2;x<w-2;x+=3)if(Math.abs(x-cx)>2)positions.push([x,h-2]);
 for(const [x,y] of positions){const facing=x===1?'e':x===w-2?'w':'s';const item=x<4&&y>1?(['shelf','chest','lamp','wardrobe'] as InteriorProp[])[n++%4]:theme[n++%theme.length];add(item,x,y,facing);}
 // Soft floor accents remain walkable and visually tie the chambers together.
 for(const [x,y]of [[2,3],[w-3,h-3],[cx,h-3]])add('rug',x,y);
 if(design.props)map.props=design.props;
 return map;
}
export function validHomeMap(m:InteriorMap):boolean{
 const solid=interiorSolidGrid(m),start=m.spawn.y*m.w+m.spawn.x;if(solid[start]||m.props.length>120)return false;
 const seen=new Set([start]),q=[start];for(let k=0;k<q.length;k++){const i=q[k];for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=i%m.w+dx,y=Math.floor(i/m.w)+dy,j=y*m.w+x;if(x<0||y<0||x>=m.w||y>=m.h||solid[j]||seen.has(j))continue;seen.add(j);q.push(j);}}
 if(!seen.has(m.exit.y*m.w+m.exit.x))return false;
 // Keep every usable floor connected and each furnishing reachable from a side.
 for(let i=0;i<solid.length;i++)if(!solid[i]&&!seen.has(i))return false;
 return m.props.every(p=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has((p.y+dy)*m.w+p.x+dx)));
}
