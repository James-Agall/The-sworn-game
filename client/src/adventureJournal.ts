import type {JournalView,JournalEntry} from '@colony/shared/adventure';
interface Deps {send:(m:object)=>void;focus:(x:number,y:number)=>void}
let marker:JournalEntry['marker'];
export const adventureMapMarker=()=>marker;
export function setupAdventureJournal(deps:Deps){
 const panel=document.getElementById('quest-panel')!,title=document.getElementById('qp-title')!,button=document.getElementById('quests-btn')!;
 title.textContent='Journal';panel.setAttribute('aria-label','Journal');button.setAttribute('title','Journal and settlement quests (J)');
 const tabs=document.createElement('nav');tabs.className='adventure-tabs';tabs.setAttribute('aria-label','Journal sections');
 const body=document.createElement('section');body.id='adventure-journal';body.setAttribute('aria-live','polite');
 panel.children[0].after(tabs);tabs.after(body);panel.dataset.journalTab='stories';
 let tab='stories',filter='active',search='',journal:JournalView={entries:[],characters:[],clues:[],keys:[]},lastRequest=0,lastRender='';
 const controls:HTMLButtonElement[]=[];
 for(const [id,label]of [['stories','Stories'],['settlement','Settlement'],['people','People'],['records','Notes & keys']]){const b=document.createElement('button');b.textContent=label;b.className='econ-btn';b.onclick=()=>{tab=id;panel.dataset.journalTab=id;lastRender='';render();};tabs.append(b);controls.push(b);}
 const notices=document.createElement('div');notices.id='adventure-notices';notices.setAttribute('aria-live','polite');document.body.append(notices);
 const tracker=document.createElement('aside');tracker.id='adventure-tracker';tracker.hidden=true;tracker.setAttribute('aria-label','Tracked objective');document.body.append(tracker);
 const style=document.createElement('style');style.textContent=`
 #adventure-notices{position:fixed;right:18px;bottom:25px;max-width:340px;z-index:45;pointer-events:none;font:14px Georgia}.adventure-notice{padding:10px 13px;margin-top:7px;border:1px solid #9d8354;border-radius:4px;background:#eadbb7f2;color:#302412;box-shadow:0 3px 10px #0005;line-height:1.4}
 #quest-panel{box-sizing:border-box;width:min(700px,calc(100vw - 30px));max-height:calc(100vh - 100px);overflow-y:auto}#quest-panel[data-journal-tab="stories"] #qp-list,#quest-panel[data-journal-tab="stories"] #qp-empty,#quest-panel[data-journal-tab="stories"] #qp-foot,#quest-panel[data-journal-tab="people"] #qp-list,#quest-panel[data-journal-tab="people"] #qp-empty,#quest-panel[data-journal-tab="people"] #qp-foot,#quest-panel[data-journal-tab="records"] #qp-list,#quest-panel[data-journal-tab="records"] #qp-empty,#quest-panel[data-journal-tab="records"] #qp-foot{display:none}#quest-panel[data-journal-tab="settlement"] #adventure-journal{display:none}.adventure-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-bottom:1px solid #9d8354}.adventure-tabs button{min-height:34px}.adventure-tabs button.active,.aj-filters button.active{background:#556047;color:#fff5d9}#adventure-journal{padding:12px}.aj-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.aj-search{width:100%;padding:9px;box-sizing:border-box;margin:0 0 12px;background:#fff5d8;color:#312717;border:1px solid #9d8354;font:inherit}.aj-card{padding:14px;margin:0 0 12px;border:1px solid #b09a6e;border-radius:4px;background:#fff7df66}.aj-card h3{margin:0 0 6px;font-size:17px}.aj-card p{white-space:pre-line;line-height:1.45;margin:8px 0}.aj-card small{display:block;color:#66573e}.aj-card button{margin:7px 7px 0 0;min-height:32px}.aj-blocked{color:#8b3527}.aj-empty{padding:18px;line-height:1.6}#adventure-tracker{position:fixed;left:180px;top:110px;width:290px;box-sizing:border-box;padding:12px 14px;background:#ead9b2;background-image:var(--paper,none);color:#302412;border:1px solid #88623a;box-shadow:0 3px 12px #0005;border-radius:4px;z-index:12;font:13px Georgia}#adventure-tracker[hidden]{display:none}#adventure-tracker strong{display:block;font-size:15px;margin-bottom:6px}#adventure-tracker p{margin:6px 0;line-height:1.4;max-height:105px;overflow:auto}#adventure-tracker button{padding:5px 8px;margin:6px 5px 0 0;font:inherit;border:1px solid #9d8354;background:#f0e3c4;cursor:pointer}#adventure-tracker small{display:block;color:#6e5c3e}.aj-record{padding:10px 0;white-space:pre-line;border-bottom:1px solid #b09a6e}body:has(#main-menu:not([hidden])) #adventure-tracker{display:none}@media(max-width:720px){#quest-panel{left:10px!important;right:10px!important;top:65px!important;transform:none!important;width:auto!important;max-height:calc(100vh - 80px)}#adventure-tracker{width:235px;font-size:12px}}`;
 document.head.append(style);
 const request=()=>{if(performance.now()-lastRequest<250)return;lastRequest=performance.now();deps.send({type:'adventureJournal',op:'get'});};
 const track=(id?:string)=>deps.send({type:'adventureJournal',op:'track',id});
 const make=(tag:string,text?:string,cls?:string)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 function card(e:JournalEntry){const a=make('article',undefined,'aj-card'),h=make('h3',e.title),status=make('small',`${e.status==='active'?'In progress':e.status==='complete'?'Completed':'A new lead'}${e.progress?' · '+e.progress:''}`);a.append(h,status,make('p',e.text),make('p',e.objective),make('small','Reward: '+e.reward));if(e.blocked)a.append(make('p',e.blocked,'aj-blocked'));const b=make('button',journal.tracked===e.id?'Stop tracking':'Track objective') as HTMLButtonElement;b.className='econ-btn';b.onclick=()=>track(journal.tracked===e.id?undefined:e.id);a.append(b);if(e.marker&&e.status!=='complete'){const map=make('button','Show on map') as HTMLButtonElement;map.className='econ-btn';map.onclick=()=>{if(e.marker){panel.hidden=true;deps.focus(e.marker.x,e.marker.y);}};a.append(map);}return a;}
 function render(){
  controls.forEach((b,i)=>b.classList.toggle('active',['stories','settlement','people','records'][i]===tab));
  const key=JSON.stringify([tab,filter,search,journal]);if(key===lastRender)return;lastRender=key;body.replaceChildren();if(tab==='settlement')return;
  if(tab==='stories'){
   const buttons=make('div',undefined,'aj-filters');for(const [id,label]of [['active','Active'],['available','New leads'],['complete','Completed'],['all','All']]){const b=make('button',label) as HTMLButtonElement;b.className='econ-btn'+(filter===id?' active':'');b.onclick=()=>{filter=id;render();};buttons.append(b);}body.append(buttons);
   const list=journal.entries.filter(e=>filter==='all'||e.status===filter);if(!list.length)body.append(make('p',filter==='active'?'No active stories yet. Speak to a named resident in a house, workshop, hall or chapel to follow a lead.':'Nothing recorded in this section yet.','aj-empty'));for(const e of list)body.append(card(e));
  }else if(tab==='people'){
   const input=make('input') as HTMLInputElement;input.className='aj-search';input.placeholder='Find a name or profession';input.setAttribute('aria-label','Search known people');input.value=search;input.oninput=()=>{search=input.value;render();const next=body.querySelector('input') as HTMLInputElement;next.focus();next.setSelectionRange(search.length,search.length);};body.append(input);
   const list=journal.characters.filter(c=>(c.name+' '+c.title).toLowerCase().includes(search.toLowerCase()));if(!list.length)body.append(make('p','People and named threats appear here when you meet them or learn about them.','aj-empty'));for(const c of list){const a=make('article',undefined,'aj-card');a.append(make('h3',c.name),make('small',c.title),make('p',c.bio),make('small',c.address));body.append(a);}
  }else{
   body.append(make('h3','Key rings'));if(!journal.keys.length)body.append(make('p','No keys found yet. Search hostile locations for an iron key ring.'));for(const k of journal.keys)body.append(make('div',k,'aj-record'));
   body.append(make('h3','Recovered accounts'));if(!journal.clues.length)body.append(make('p','Read expedition notes, stolen dispatches and ruined inscriptions to preserve their clues here.'));for(const c of journal.clues)body.append(make('div',c,'aj-record'));
  }
 }
 function layout(){
  const econ=document.getElementById('economy-panel'),rect=econ?.getBoundingClientRect(),bar=document.getElementById('player-bar')?.getBoundingClientRect(),stats=document.getElementById('colony-stats')?.getBoundingClientRect();
  const left=rect&&rect.width>45&&rect.left<100?rect.right+12:16;tracker.style.left=Math.round(Math.min(left,Math.max(16,window.innerWidth-260)))+'px';tracker.style.top=Math.round(Math.max(105,(bar?.bottom??0)+10,Math.min(stats?.bottom??0,100)+10))+'px';
 }
 function renderTracker(){
  const e=journal.trackedEntry;tracker.replaceChildren();tracker.hidden=!e;marker=e?.status==='active'?e.marker:undefined;if(!e)return;
  tracker.append(make('strong',e.title),make('small',e.progress??e.status),make('p',e.objective));const distance=make('small');distance.id='adventure-distance';tracker.append(distance);
  const open=make('button','Journal (J)') as HTMLButtonElement;open.onclick=()=>{panel.hidden=false;tab='stories';panel.dataset.journalTab=tab;request();render();};const clear=make('button','Untrack') as HTMLButtonElement;clear.onclick=()=>track();tracker.append(open,clear);layout();
 }
 new MutationObserver(()=>{if(!panel.hidden){request();render();}}).observe(panel,{attributes:true,attributeFilter:['hidden']});
 for(const id of ['economy-panel','colony-stats','player-bar']){const e=document.getElementById(id);if(e)new MutationObserver(layout).observe(e,{attributes:true,attributeFilter:['class','style','hidden']});}
 window.addEventListener('resize',layout);
 window.addEventListener('keydown',e=>{if(e.key.toLowerCase()!=='j'||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;if(e.target instanceof HTMLElement&&(e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)))return;e.preventDefault();panel.hidden=!panel.hidden;if(!panel.hidden){request();render();}});
 const timer=window.setInterval(()=>{if(!panel.hidden||journal.tracked)request();},4000);
 void timer;
 return{
  onEvent(text:string){if(!document.body.classList.contains('interior-mode'))return;const n=make('div',text,'adventure-notice');notices.append(n);while(notices.children.length>3)notices.firstElementChild?.remove();window.setTimeout(()=>n.remove(),6500);},
  onJournal(data:JournalView){journal=data;lastRender='';if(!panel.hidden)render();renderTracker();},
  onPlayer(x:number,y:number,tileSize:number){const e=journal.trackedEntry,distance=document.getElementById('adventure-distance');if(!distance||!e)return;if(!e.marker){distance.textContent=e.status==='complete'?'Completed':'Follow the clues to learn the destination.';return;}const dx=e.marker.x+.5-x/tileSize,dy=e.marker.y+.5-y/tileSize,d=Math.hypot(dx,dy),bearing=(dy<-.4?'N':dy>.4?'S':'')+(dx>.4?'E':dx<-.4?'W':'');distance.textContent=d<4?'At this location — enter and follow the objective.':`${Math.round(d)} tiles ${bearing}`;},
  onWelcome(){journal={entries:[],characters:[],clues:[],keys:[]};marker=undefined;lastRender='';tracker.hidden=true;request();},
  open(){panel.hidden=false;request();render();},
 };
}
