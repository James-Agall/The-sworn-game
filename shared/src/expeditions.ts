import type {Equipment,GearItem,ItemStats} from './protocol.js';
import type {CombatStrike} from './combatRules.js';

export const ADVENTURE_GEAR = {
 counter:{name:'Counterweight sword',kind:'sword',slot:'weapon',benefit:'A perfect block gives a longer counterattack opportunity.',cost:'10% less damage.',stats:{damagePct:-10}},
 pierce:{name:'Long ash spear',kind:'spear',slot:'weapon',benefit:'Thrusts can pierce one additional enemy in their line.',cost:'12% slower attacks.',stats:{attackSpeedPct:-12}},
 breach:{name:'Breaching axe',kind:'axe',slot:'weapon',benefit:'Heavy blows deal double damage to barricades and breakable containers.',cost:'Recovery takes 0.2 seconds longer after each swing.',stats:{}},
 patient:{name:'Yew hunting bow',kind:'bow',slot:'weapon',benefit:'Charged arrows pierce one additional target.',cost:'Quick shots deal 15% less damage.',stats:{}},
 steady:{name:'Steady round shield',kind:'shield',slot:'offhand',benefit:'The perfect-block window lasts one extra tick.',cost:'4% slower movement.',stats:{damageTakenPct:-6,moveSpeedPct:-4}},
 wayfarer:{name:'Wayfarer boots',kind:'boots',slot:'legs',benefit:'Dodge recovers four ticks sooner.',cost:'6% more damage taken.',stats:{damageTakenPct:6}},
} as const;
export type AdventureGearId=keyof typeof ADVENTURE_GEAR;
export function adventureTrait(item:GearItem|null|undefined):AdventureGearId|undefined {
 const id=item?.adventureTrait;return id&&Object.hasOwn(ADVENTURE_GEAR,id)&&ADVENTURE_GEAR[id].slot===item.slot&&ADVENTURE_GEAR[id].kind===item.kind?id:undefined;
}
export function hasAdventureTrait(e:Equipment,id:AdventureGearId){return adventureTrait(e[ADVENTURE_GEAR[id].slot])===id;}
export function adventureStrike(e:Equipment,s:CombatStrike):CombatStrike {
 const next={...s};
 if(s.weapon==='spear'&&hasAdventureTrait(e,'pierce'))next.maxTargets=Math.min(4,next.maxTargets+1);
 if(s.weapon==='bow'&&hasAdventureTrait(e,'patient')){if(s.heavy)next.maxTargets=Math.min(3,next.maxTargets+1);else next.damageMult*=.85;}
 if(s.weapon==='axe'&&hasAdventureTrait(e,'breach'))next.recovery+=4;
 return next;
}
export function adventureGear(id:AdventureGearId,uid:string,tier:1|2|3=1,base:ItemStats={}):GearItem {
 const d=ADVENTURE_GEAR[id],stats={...base};for(const[k,v]of Object.entries(d.stats))stats[k as keyof ItemStats]=(stats[k as keyof ItemStats]??0)+v;
 return{id:uid,name:d.name,kind:d.kind,slot:d.slot,tier,stats,adventureTrait:id,icon:d.slot==='weapon'?`icon-weaponT${tier}`:`icon-armourT${tier}`};
}
export type ContractFamily='rescue'|'recovery'|'hunt'|'sabotage'|'restoration'|'investigation';
export interface ContractDefinition {id:string;title:string;family:ContractFamily;kind:'camp'|'ruin'|'cave'|'mine';brief:string;objective:string;optional:string;gold:number}
const families:{family:ContractFamily;kind:ContractDefinition['kind'];titles:string[];brief:string;objective:string;optional:string}[]=[
 {family:'rescue',kind:'camp',titles:["Hesta’s missing apprentice",'The captured courier','The lost pilgrim'],brief:'People have vanished on the road. Find the keys, drive the cage guards away and open the cage. You do not need to kill everyone.',objective:'Free the captives, then return to the issuer.',optional:'Recover a supply chest before reporting.'},
 {family:'recovery',kind:'ruin',titles:['Tools of a forgotten trade','The stolen pay chest','The lost survey'],brief:'Recover useful supplies from a real container in the ruins.',objective:'Loot a chest, then return to the issuer.',optional:'Read the local inscription.'},
 {family:'hunt',kind:'cave',titles:['A threat beneath the hill','The old den','The last watch'],brief:'Clear a dangerous inhabited site. The journal records the cleared location permanently.',objective:'Clear the location, then return.',optional:'Recover its expedition account.'},
 {family:'sabotage',kind:'camp',titles:['Silence the signal','The raiders’ stores','A quiet approach'],brief:'Break the camp’s alarm before it is used. A triggered alarm summons only a fixed pair of reinforcements.',objective:'Destroy the alarm, then return.',optional:'Keep the alarm from sounding.'},
 {family:'restoration',kind:'mine',titles:['Reopen the workings','A safe copper face','The miners’ return'],brief:'Clear the working mine’s first layer. Its existing miners can then work it again.',objective:'Clear the mine’s first layer, then report.',optional:'Recover the foreman’s survey.'},
 {family:'investigation',kind:'ruin',titles:['The weathered record','Names in the stone','An unfinished account'],brief:'Find an inscription or expedition note. The information is kept in your journal rather than a losable item.',objective:'Read the account, then return.',optional:'Open the locked storeroom.'},
];
export const CONTRACTS:ContractDefinition[]=families.flatMap(f=>f.titles.map((title,i)=>({id:`${f.family}-${i}`,title,family:f.family,kind:f.kind,brief:f.brief,objective:f.objective,optional:f.optional,gold:35+i*10})));
export const CONTRACT_BY_ID=new Map(CONTRACTS.map(c=>[c.id,c]));
export type CompanionRole='guard'|'ranger'|'healer';
export const COMPANIONS=[{id:'ser-alden',role:'guard',label:'Guard',kind:'knight'},{id:'neri-bow',role:'ranger',label:'Ranger',kind:'archer'},{id:'mother-aveline',role:'healer',label:'Healer',kind:'bishop'}] as const;
