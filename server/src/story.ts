import {STORIES,STORY_RECIPES,type StoryDefinition,type StoryStep} from '@colony/shared/stories';
import {SPECIAL_CAST,SPECIAL_BY_ID} from '@colony/shared/specialCast';
import {BOSS_PROFILES,type JournalView,type JournalEntry} from '@colony/shared/adventure';
import {TileType} from '@colony/shared/protocol';
import {INTERIOR_TEMPLATE_BY_TILE,interiorLayoutAccessible,type InteriorMap,type InteriorProp} from '@colony/shared/interiors';
import {PACK_GOODS,type PackGood,type HeroSkill} from '@colony/shared/herolife';
import type {ItemId} from '@colony/shared/progression';
import type {Player,ResourceKey} from './types.js';
import {state,players,sites,heroProfiles} from './state.js';
import {lifeOf,gainSkill,toast} from './herolife.js';
import {specialAddress,specialResidences} from './specialCast.js';
import {specialCharacterDefeated} from './mines.js';
import {explorationRescued} from './adventureLoot.js';
import {itemCount,takeItem,addItem} from './progression.js';
import {clanOf,withClan} from './clans.js';
import {sendTo} from './saves.js';
import {ownerAt,tileIndex,inBounds} from './tiles.js';
import {gameDay} from './diplomacy.js';
import {playerMaxHp} from './heroes.js';
import {adjustRelation} from './sites.js';
import {revealAround,circleOffsets} from './net.js';
import {refreshInteriorView} from './interiors.js';
const masterSkills:Record<string,HeroSkill>={'hesta-ironroot':'smithing','osmund-bell':'smithing','liora-thread':'building','perrin-ash':'building','maeve-clay':'pottery','viggo-coal':'charcoal','una-stone':'mining','rob-copper':'smithing','nia-flint':'speech','wystan-gear':'milling'};
const stepKey=(s:StoryDefinition)=>`story:${s.id}:step`,doneKey=(s:StoryDefinition)=>`story:${s.id}:done`;
const home=(id:string)=>specialResidences().find(h=>h.id===id);
function locationAvailable(id:string){const h=home(id);if(!h||!inBounds(h.tx,h.ty))return false;const tile=state.tiles[tileIndex(h.tx,h.ty)];if(h.hostile)return [TileType.CampEntrance,TileType.RuinEntrance,TileType.CaveEntrance].includes(tile);if(!INTERIOR_TEMPLATE_BY_TILE[tile as TileType])return false;const site=[...sites.values()].find(s=>s.num===ownerAt(tileIndex(h.tx,h.ty)));return tile===TileType.AbbeyHall||!!site&&site.faction==='human'&&!site.cleared&&!site.captured;}
function currentStep(p:Player,s:StoryDefinition){return s.steps[Math.max(0,(lifeOf(p).flags[stepKey(s)]??1)-1)];}
function revealStep(p:Player,s:StoryDefinition){const step=currentStep(p,s),id=step?.actor??step?.target;if(!id)return;lifeOf(p).flags[`known:${id}`]=1;const h=home(id);if(h)revealAround(h.tx,h.ty,circleOffsets(3));}
function finish(p:Player,s:StoryDefinition){const f=lifeOf(p).flags;if(f[doneKey(s)])return;f[doneKey(s)]=1;f[`recipe:${s.recipe}`]=1;withClan(clanOf(p),()=>{state.stock.gold+=s.gold;});gainSkill(p,s.skill,40);toast(p,`Story complete: ${s.title}. +${s.gold} gold; recipe learned: ${STORY_RECIPES.find(r=>r.id===s.recipe)?.label}. ${s.project}`);refreshInteriorView();}
function advance(p:Player,s:StoryDefinition){const f=lifeOf(p).flags;f[stepKey(s)]=(f[stepKey(s)]??1)+1;if(f[stepKey(s)]>s.steps.length)finish(p,s);else{revealStep(p,s);toast(p,`${s.title}: ${currentStep(p,s).text}`);}}
function targetKey(step:StoryStep){const h=step.target?home(step.target):undefined;return h?`${h.tx},${h.ty}`:undefined;}
function proof(p:Player,step:StoryStep){const f=lifeOf(p).flags,key=targetKey(step);return step.kind==='hunt'?specialCharacterDefeated(step.target!):step.kind==='clue'?!!key&&!!f[`clue:${key}`]:step.kind==='rescue'?!!key&&(!!f[`rescue:${key}`]||explorationRescued(key)):false;}
function settleProof(p:Player,s:StoryDefinition){const f=lifeOf(p).flags;let safety=0;while(f[stepKey(s)]&&!f[doneKey(s)]&&safety++<s.steps.length&&proof(p,currentStep(p,s)))advance(p,s);}
export function storyOnMeet(p:Player,id:string){
 const f=lifeOf(p).flags,lines:string[]=[];f[`cast:met:${id}`]=1;
 for(const s of STORIES.filter(s=>s.members.includes(id))){
  f[`story:${s.id}:heard`]=1;settleProof(p,s);const step=currentStep(p,s);
  if(f[doneKey(s)])lines.push(`${s.title}: ${s.project} Your help is remembered here.`);
  else if(f[stepKey(s)]&&step?.kind==='talk'&&step.actor===id){lines.push(step.answer??s.intro);advance(p,s);if(!f[doneKey(s)])lines.push('Next: '+currentStep(p,s).text);}
 }
 sendJournal(p);return lines.join('\n\n');
}

export function storyEvent(p:Player,type:string,key:string,_id=''){
 const f=lifeOf(p).flags;
 if(type==='craft')f[`crafted:${key}`]=(f[`crafted:${key}`]??0)+1;
 for(const s of STORIES){if(s.steps.some(st=>st.target&&targetKey(st)===key))f[`story:${s.id}:heard`]=1;if(f[stepKey(s)])settleProof(p,s);}sendJournal(p);
}
function supplies(p:Player,step:StoryStep,consume=false){
 return withClan(clanOf(p),()=>{
  const life=lifeOf(p),count=step.count??1;
  if(step.kind==='craft'){const id=step.item as ItemId;if(itemCount(id)<count)return false;if(consume)takeItem(id,count);return true;}
  const g=step.good!;if(g==='hide'){if(itemCount('hide')<count)return false;if(consume)takeItem('hide',count);return true;}
  const pack=life.pack as Partial<Record<string,number>>,stock=state.stock as Record<string,number>;
  if((pack[g]??0)+(stock[g]??0)<count)return false;if(consume){const n=Math.min(pack[g]??0,count);if(n)pack[g]=(pack[g]??0)-n;stock[g]=(stock[g]??0)-(count-n);}return true;
 });
}
export interface StoryResponse {text:string;choices:{label:string;next:string;disabled?:string}[]}
export function storyOffers(p:Player,id:string){
 const f=lifeOf(p).flags,c=SPECIAL_BY_ID.get(id)!,offers:{label:string;next:string;disabled?:string}[]=[];
 for(const s of STORIES.filter(s=>s.members.includes(id))){offers.push({label:`Story: ${s.title}${f[doneKey(s)]?' (complete)':''}`,next:`story:${s.id}`});
  if(!f[doneKey(s)]||c.child)continue;const service=c.group==='faith'?{op:'treatment',label:'Sanctuary treatment (free, once a day)',cost:0}:c.group==='commons'?{op:'lodging',label:'Meal and a full rest (8 gold, once a day)',cost:8}:c.group==='masters'?{op:'training',label:'Masters practical lesson (12 gold, once a day)',cost:12}:undefined;
  if(service)offers.push({label:service.label,next:`story:${s.id}:${service.op}`,disabled:f[`service:${s.id}:${service.op}`]===gameDay()+1?'Available again tomorrow':withClan(clanOf(p),()=>state.stock.gold)<service.cost?'Not enough gold':undefined});
 }return offers;
}
export function storyDialogue(p:Player,actor:string,node:string):StoryResponse|undefined{
 if(!node.startsWith('story:'))return;const [,id,op,arg]=node.split(':'),s=STORIES.find(s=>s.id===id);if(!s||!s.members.includes(actor))return;
 const f=lifeOf(p).flags;f[`story:${s.id}:heard`]=1;let extra='';
 if(['treatment','lodging','training'].includes(op??'')){
  const c=SPECIAL_BY_ID.get(actor)!,allowed=op==='treatment'&&c.group==='faith'||op==='lodging'&&c.group==='commons'||op==='training'&&c.group==='masters',key=`service:${s.id}:${op}`,cost=op==='treatment'?0:op==='lodging'?8:12;
  if(!f[doneKey(s)]||c.child||!allowed)extra='Finish the story before asking for this service.';
  else if(f[key]===gameDay()+1)extra='Come back tomorrow; the service has already been provided today.';
  else if(withClan(clanOf(p),()=>state.stock.gold)<cost)extra='You do not have enough gold. Nothing has been taken.';
  else{withClan(clanOf(p),()=>{state.stock.gold-=cost;});f[key]=gameDay()+1;const life=lifeOf(p);if(op==='training'){gainSkill(p,masterSkills[actor]??s.skill,15);extra='A practical lesson improves your '+(masterSkills[actor]??s.skill)+' skill. (-12 gold; +15 experience)';}else{life.food=100;life.rest=100;life.energy=100;p.hp=Math.min(playerMaxHp(p),p.hp+(op==='treatment'?35:10));extra=op==='treatment'?'You receive food, rest and treatment. (+35 health; needs restored)':'A meal and a quiet bed leave you fed and rested. (-8 gold; needs restored; +10 health)';}}
 }

 if(op==='accept'&&!f[stepKey(s)]&&!f[doneKey(s)]){f[stepKey(s)]=1;revealStep(p,s);for(const other of Object.keys(f))if(other.startsWith('journal:track:'))delete f[other];f[`journal:track:${s.id}`]=1;extra='You agree to follow this story.';}
 settleProof(p,s);let step=currentStep(p,s);
 if(op==='deliver'&&!f[doneKey(s)]&&step?.actor===actor&&['supply','craft'].includes(step.kind)){
  if(supplies(p,step,true)){advance(p,s);extra='The commission is received and recorded.';}else extra='You still need the listed supplies. Nothing has been taken.';
 }
 if(op==='choice'&&!f[doneKey(s)]&&step?.kind==='choice'&&step.actor===actor){
  const choice=step.choices?.find(c=>c.id===arg);if(choice&&!f[`story:${s.id}:choice`]){
   f[`story:${s.id}:choice`]=choice.effect==='aid'?1:2;
   withClan(clanOf(p),()=>{if(choice.effect==='aid'){state.stock.grain+=12;state.stock.fruit+=8;}else if(choice.effect==='law')state.stock.gold+=30;else if(choice.effect==='craft')state.stock.tools+=4;});
   const h=home(actor),site=h?[...sites.values()].find(s=>s.num===ownerAt(tileIndex(h.tx,h.ty))):undefined;if(site)adjustRelation(p.clan,site.id,choice.effect==='aid'?5:10);
   extra=choice.outcome+(choice.effect==='aid'?' (+12 grain, +8 fruit, +5 local relation)':' (+30 gold, +10 local relation)');advance(p,s);
  }
 }
 step=currentStep(p,s);const unavailable=step&&(step.actor??step.target)&&!locationAvailable((step.actor??step.target)!);
 if(op==='report'&&!f[doneKey(s)]&&unavailable){f[`story:${s.id}:absence`]=1;advance(p,s);extra='The missing contact or location is recorded. The surviving witnesses will carry the account forward.';}
 settleProof(p,s);step=currentStep(p,s);
 const choices:StoryResponse['choices']=[];
 if(!f[stepKey(s)]&&!f[doneKey(s)])choices.push({label:'Take up this story.',next:`story:${id}:accept`});
 else if(!f[doneKey(s)]){
  if(step.actor===actor&&['supply','craft'].includes(step.kind))choices.push({label:`Hand over ${step.count} ${step.good??step.item}.`,next:`story:${id}:deliver`,disabled:supplies(p,step)?undefined:'Prepare the listed supplies first'});
  if(step.actor===actor&&step.kind==='choice')for(const c of step.choices??[])choices.push({label:c.label,next:`story:${id}:choice:${c.id}`});
  if(unavailable)choices.push({label:'Report that the contact or location is unavailable.',next:`story:${id}:report`});
 }
 choices.push({label:'Back to our conversation.',next:'start'});
 const text=f[doneKey(s)]?`${s.title}\n\nThe story is complete. ${s.project}\n${f[`story:${s.id}:choice`]===1?'You chose direct community aid.':'You chose a public, accountable settlement.'}\nThe new recipe is available at its proper workstation.`:`${s.title}\n\n${s.intro}\n\n${objective(p,s)}\nReward: ${s.gold} gold, training and ${STORY_RECIPES.find(r=>r.id===s.recipe)?.label}.`;
 sendJournal(p);return{text:[extra,text].filter(Boolean).join('\n\n'),choices};
}
function objective(p:Player,s:StoryDefinition){const step=currentStep(p,s);if(!step)return s.project;const id=step.actor??step.target,c=id?SPECIAL_BY_ID.get(id):undefined;return `${step.text}${c?`\n${c.name} — ${specialAddress(id!)}`:''}${step.kind==='supply'?`\nRequired: ${step.count} ${step.good}.`:step.kind==='craft'?`\nPrepare ${step.count} ${step.item} at a workstation, or obtain them through trade.`:''}`;}
export function journalSnapshot(p:Player):JournalView{
 const f=lifeOf(p).flags,entries:JournalEntry[]=[];
 for(const s of STORIES){if(!f[`story:${s.id}:heard`]&&!f[stepKey(s)])continue;settleProof(p,s);const step=currentStep(p,s),id=step?.actor??step?.target,h=id?home(id):undefined,known=!!id&&(!!f[`known:${id}`]||!!f[`cast:met:${id}`]),done=!!f[doneKey(s)];entries.push({id:s.id,title:s.title,status:done?'complete':f[stepKey(s)]?'active':'available',text:s.intro,objective:done?s.project:objective(p,s),progress:done?'Complete':`Stage ${f[stepKey(s)]??1} of ${s.steps.length}`,reward:`${s.gold} gold; ${STORY_RECIPES.find(r=>r.id===s.recipe)?.label}`,blocked:!done&&id&&!locationAvailable(id)?'This contact or location is unavailable. Report it to another participant.':!done&&step&&['supply','craft'].includes(step.kind)&&!supplies(p,step)?'You need the listed supplies.':undefined,...(!done&&known&&h?{marker:{x:h.tx,y:h.ty,label:SPECIAL_BY_ID.get(id!)!.name}}:{})});}
 for(const c of SPECIAL_CAST.filter(c=>!c.hostile&&f[`cast:${c.id}:accepted`])){const done=!!f[`cast:${c.id}:done`],ready=c.questKind==='hunt'?specialCharacterDefeated(c.connection):c.questKind==='meet'?!!f[`cast:met:${c.connection}`]:false,target=c.questKind==='supply'||done||ready?c.id:c.connection,h=home(target);entries.push({id:`favor:${c.id}`,title:`${c.name}: a personal favour`,status:done?'complete':'active',text:c.hook,objective:done?'Favour completed.':ready?`Return to ${c.name} to report your success.`:c.questKind==='supply'?`Bring ${c.count} ${c.good} to ${c.name}.`:`${c.questKind==='hunt'?'Defeat':'Speak with'} ${SPECIAL_BY_ID.get(c.connection)!.name}, then return to ${c.name}.`,reward:`${c.reward} gold and a practical lesson`,...(h?{marker:{x:h.tx,y:h.ty,label:SPECIAL_BY_ID.get(target)!.name}}:{})});}
 const tracked=Object.keys(f).find(k=>k.startsWith('journal:track:')&&f[k])?.slice('journal:track:'.length),trackedEntry=entries.find(e=>e.id===tracked);
 const characters=SPECIAL_CAST.filter(c=>f[`cast:met:${c.id}`]||f[`known:${c.id}`]).map(c=>({id:c.id,name:c.name,title:c.title,bio:f[`cast:met:${c.id}`]||f[`lore:${c.id}`]?c.bio+(BOSS_PROFILES[c.id]?' '+BOSS_PROFILES[c.id].hint:''):'You have heard this name while following a lead.',address:specialAddress(c.id)}));
 return{entries,characters,clues:Object.keys(f).filter(k=>k.startsWith('clue:')&&f[k]).map(k=>{const key=k.slice(5),names=specialResidences().filter(h=>h.hostile&&`${h.tx},${h.ty}`===key).map(h=>{const c=SPECIAL_BY_ID.get(h.id)!;return `${c.name}: ${BOSS_PROFILES[c.id]?.hint??c.hook}`;});return `Recovered account at ${key}\n${names.join('\n')}`;}),keys:Object.keys(f).filter(k=>k.startsWith('keys:')&&f[k]).map(k=>`Iron key ring — ${k.slice(5)}`),tracked,trackedEntry};
}
const lastSent=new WeakMap<Player,string>();
export function sendJournal(p:Player,force=false){const journal=journalSnapshot(p),json=JSON.stringify(journal);if(!force&&lastSent.get(p)===json)return;lastSent.set(p,json);sendTo(p,{type:'adventureJournal',journal});}
export function handleJournal(p:Player,op:string,id?:string){if(p.dead&&op!=='get')return;if(op==='track'){const entry=journalSnapshot(p).entries.find(e=>e.id===id);if(id&&!entry)return;const f=lifeOf(p).flags;for(const k of Object.keys(f))if(k.startsWith('journal:track:'))delete f[k];if(entry)f[`journal:track:${entry.id}`]=1;}sendJournal(p,true);}
// Visible, persistent room improvements are derived from saved completed stories.
const roomCache=new WeakMap<InteriorMap,Map<string,InteriorMap>>();
function occupiedImprovement(tx:number,ty:number,base:InteriorMap,next:InteriorMap){
 const added=next.props.filter(q=>!base.props.some(b=>b.prop===q.prop&&b.x===q.x&&b.y===q.y));
 return [...players.values()].some(p=>p.interior?.tx===tx&&p.interior.ty===ty&&added.some(q=>Math.hypot(p.interior!.x/32-.5-q.x,p.interior!.y/32-.5-q.y)<.9));
}
export function storyRoomMap(tx:number,ty:number,map:InteriorMap){
 const finished=STORIES.filter(s=>[...heroProfiles.values()].some(p=>p.life?.flags[doneKey(s)])&&s.members.some(id=>{const h=home(id);return h&&!h.hostile&&h.tx===tx&&h.ty===ty;}));if(!finished.length)return map;
 const key=finished.map(s=>s.id).join(','),cache=roomCache.get(map)??new Map<string,InteriorMap>();roomCache.set(map,cache);const hit=cache.get(key);if(hit)return occupiedImprovement(tx,ty,map,hit)?map:hit;
 const next={...map,props:map.props.map(p=>({...p}))};const props:InteriorProp[]=['weaponRack','lamp','sacks','workbench','candelabra','shelf','table','armourStand','banner','timberProp'];
 for(const s of finished){const prop=props[STORIES.indexOf(s)];outer:for(let y=1;y<map.h-1;y++)for(let x=1;x<map.w-1;x++)if(map.cells[y*map.w+x]==='.'&&map.cells[(y-1)*map.w+x]==='#'&&!next.props.some(p=>Math.hypot(p.x-x,p.y-y)<1.5)&&!map.slots.some(p=>p.x===x&&p.y===y)&&Math.hypot(x-map.exit.x,y-map.exit.y)>3&&Math.hypot(x-map.spawn.x,y-map.spawn.y)>2){next.props.push({prop,x,y,facing:'s'});if(interiorLayoutAccessible(next))break outer;next.props.pop();}}
 cache.set(key,next);return occupiedImprovement(tx,ty,map,next)?map:next;
}
