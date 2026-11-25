import { combatMotion } from "./playerCombat.js";
import {explorationView} from './adventureLoot.js';
import {storyRoomMap} from './story.js';
import {furnitureView,useFurniture,furnitureRoomMap,resetFurniture} from './furniture.js';
import {bossMoveSpeed} from './bossCombat.js';
import {companionSnapshots,companionLive} from "./companions.js";
import {specialAt} from './specialCast.js';
import {SPECIAL_BY_ID} from '@colony/shared/specialCast';
import {encounterKind,encounterMap,encounterAnchor,encounterVariant} from '@colony/shared/encounters';
import {ensureEnteredEncounter,encounterInteract,mineInteriorMap} from './mines.js';
import {PLAYER_BASES,HOME_PROPS,playerBaseMap,validHomeMap,type HomeDesign} from "@colony/shared/playerBases";
// interiors.ts: Stardew phase 5c (docs PLAN-rimworld-stardew.md 5c; ROADMAP "Stardew layer — phase 5c"). The hero
// enters a prefab building through its door (E on / walking north into it from the tile below it) and walks a small
// separate tile map built lazily from the building type's template (shared/src/interiors.ts). The world sim keeps
// running; the hero's world x / y stay at the door, where nothing can target or hurt it (mobs never enter). NPCs
// inside are bound to the building's real people (posted workers, residents) or, in a settlement, to its Elder /
// trader / priest / villagers, and talk through the existing dialogue (herolife.ts). Own buildings have a chest
// (pack <-> chest, saved per building) and, in a house or your hall, a bed (sleep to dawn / nap). Interiors are not
// part of the world grid: never saved, never streamed; only chest contents are saved (`interiorChests`).
// Gap closure G5: a building's layout is one of INTERIOR_VARIANTS per type (interiorVariantFor: anchor + level); the
// NPCs live (keepers work at their station, residents wander by day / eat at a table at dusk / sleep in a bed at
// night, tavern patrons sit at the tables; facing, poses and greeting bubbles go out as `interiorNpcs`); the tavern /
// barracks / hall have an upper floor up the "U" stairs (storey 1: guest rooms / the keepers' bedrooms).
import {
  INTERIOR_BARN_CHEST_CAP, INTERIOR_BED_REST_MULT, INTERIOR_BUMP_COOLDOWN_TICKS, INTERIOR_CHEST_CAP, INTERIOR_DOOR_REACH_TILES,
  INTERIOR_ENEMY_BLOCK_TILES, INTERIOR_ESC_EXIT_TILES, INTERIOR_FIXED_LEVEL, INTERIOR_GREET_COOLDOWN_TICKS, INTERIOR_GREET_RANGE_TILES,
  INTERIOR_NPC_SEND_TICKS, INTERIOR_NPC_SPEED_TILES, INTERIOR_NPC_STOP_TILES, INTERIOR_NPC_WAIT_MAX_TICKS, INTERIOR_NPC_WAIT_MIN_TICKS,
  INTERIOR_NPC_WANDER_TILES, INTERIOR_PATRONS_DAY, INTERIOR_PATRONS_DUSK, INTERIOR_PATRONS_NIGHT, INTERIOR_REFRESH_TICKS, INTERIOR_SAY_TICKS,
  INTERIOR_SLEEP_TEMPLATES, INTERIOR_SPEED_MULT, INTERIOR_TEMPLATE_BY_TILE, INTERIOR_THREAT_ALERT_TILES, INTERIOR_UPPER_TEMPLATES,
  INTERIOR_USE_RANGE_TILES, INTERIOR_VARIANTS, buildInteriorMap, interiorSeats, interiorSolidGrid, interiorVariantFor,
  validateAllInteriorTemplates, type InteriorFacing, type InteriorMap, type InteriorNpcAct, type InteriorNpcLive,
  type InteriorNpcPose, type InteriorNpcSnapshot, type InteriorTemplateId, type InteriorView,
} from "@colony/shared/interiors";
import { STATION_SKILL, NPC_ROLE_LABEL, PACK_CAP, PACK_GOODS, PACK_LABEL, PACK_WEIGHT, TALK_RANGE_TILES, type NpcRole, type PackGood } from "@colony/shared/herolife";
import { PLAYER_HALF_SIZE, PLAYER_SPEED, TILE_SIZE, TileType, isSolidTile } from "@colony/shared/protocol";
import type { Mob, Player, SiteState } from "./types.js";
import { GAME_DAY_TICKS, dt } from "./constants.js";
import { colonists, mobs, players, state } from "./state.js";
import { anchorOfTile, placedFootprint, collidesAt, getBuildingLevel, inBounds, isNightNow, ownerAt, tileIndex } from "./tiles.js";
import { clanIdAt, clanOf, withClan } from "./clans.js";
import { siteByNum } from "./sites.js";
import { gameDay, standingTown, tierOf } from "./diplomacy.js";
import { isTowerTarget } from "./combat.js";
import { isSleepingNeutral } from "./creative.js";
import { sendTo } from "./saves.js";
import { heroProfileOf } from "./heroes.js";
import { isMounted } from "./animals.js";
import { isDuskNow } from "./structures.js";
import { MINE_LABEL, isLayeredMine, isMineTile, mineLayerResourcesText } from "@colony/shared/mines";
import { mineHidesMiners, mineView } from "./mines.js";
import {
  type ChoiceRt, type TalkInside, closeTalk, furnitureTalk, heroSpeedMult, lifeOf, nameFor, namedRoleMark, packWeight, restHeroFully,
  handlePersonalCraft, setHeroResting, startTalk, stopHeroBusy, talkColorFor, toast,
} from "./herolife.js";
import { namedRoleName, type QuestRole } from "@colony/shared/namedRoles";

// ---- chests (saved) ----
const homeDesigns=new Map<string,HomeDesign>();
const homeSent=new Map<string,string>();
const homeCache=new WeakMap<HomeDesign,{map:InteriorMap;solid:Uint8Array}>();
const chests = new Map<string, Partial<Record<PackGood, number>>>();

// ---- maps (generated lazily per template + level, never saved) ----
const maps = new Map<string, { map: InteriorMap; solid: Uint8Array }>();
function mapFor(id: InteriorTemplateId, level: number, variant = 0, storey = 0) {
  const k = `${id}:${level}:${variant}:${storey}`;
  let m = maps.get(k);
  if (!m) {
    const map = buildInteriorMap(id, level, variant, storey);
    maps.set(k, (m = { map, solid: interiorSolidGrid(map) }));
  }
  return m;
}
function designedMap(key:string, id:InteriorTemplateId,level:number,variant:number,storey=0){
 const [ex,ey]=key.split(',').map(Number),kind=encounterKind(state.tiles[tileIndex(ex,ey)]);if(kind||id==='mine')return mineInteriorMap(ex,ey,level,variant);

 const design=homeDesigns.get(key);if(!design&&id==='house'&&storey===0&&forcedVariant===null){const [x,y]=key.split(',').map(Number);const base=['cottage','farmhouse','townhouse','hill-burrow'][(x*7+y*11)%4];const cacheKey='home-default:'+base+':'+level;let hit=maps.get(cacheKey);if(!hit){const map=playerBaseMap({base},level);const solid=interiorSolidGrid(map);const free=[];for(let yy=2;yy<map.h-2;yy++)for(let xx=2;xx<map.w-2;xx++)if(!solid[yy*map.w+xx])free.push({x:xx,y:yy,slot:'v' as const});map.slots=free.slice(0,3);hit={map,solid};maps.set(cacheKey,hit);}return hit;}if(!design||storey>0||!['house','hall'].includes(id))return mapFor(id,level,variant,storey);
 let hit=homeCache.get(design);if(!hit||hit.map.level!==level){const map=playerBaseMap(design,level);hit={map,solid:interiorSolidGrid(map)};homeCache.set(design,hit);}return hit;
}
const mapOf=(I:NonNullable<Player['interior']>)=>{const base=designedMap(I.key,I.templateId as InteriorTemplateId,I.level,I.variant,I.storey);const map=storyRoomMap(I.tx,I.ty,base.map);return furnitureRoomMap(I.key,I.variant,I.storey,map===base.map?base:{map,solid:interiorSolidGrid(map)});};

// Test hook `interior {variant}`: every building uses this layout (null: the deterministic pick).
let forcedVariant: number | null = null;

// The interior of the building anchored at (tx, ty), if it has one.
export function interiorTemplateAt(tx: number, ty: number): { id: InteriorTemplateId; tile: TileType; level: number; variant: number } | null {
  if (!inBounds(tx, ty)) return null;
  const tile = state.tiles[tileIndex(tx, ty)] as TileType;
  const kind=encounterKind(tile);const a=encounterAnchor(tx,ty,tile);if(kind)return {id:'mine',tile,level:1,variant:encounterVariant(a.x,a.y)};
  const id = INTERIOR_TEMPLATE_BY_TILE[tile];
  if (!id) return null;
  const level = Math.max(1, Math.min(3, INTERIOR_FIXED_LEVEL[tile] ?? getBuildingLevel(tx, ty)));
  // Deep mines: a mine's layout is its depth (adit / shaft / deep), never a hash. Layered mines: a Mine is entered on
  // its level 1 (variant 0); its shafts lead down (changeMineLayer).
  const variant = id === "mine" ? (isLayeredMine(tile) ? 0 : level - 1) : forcedVariant ?? interiorVariantFor(tx, ty, level);
  return { id, tile, level, variant };
}

// Who may go in: your own clan's buildings, a friendly human settlement's buildings, the Abbey.
type Access = { kind: "own" } | { kind: "abbey" } | { kind: "site"; site: SiteState } | { refuse: string };
function accessFor(p: Player, tx: number, ty: number, tile: TileType): Access {
  if(encounterKind(tile))return {kind:'own'};
  if (tile === TileType.AbbeyHall) return { kind: "abbey" };
  const owner = ownerAt(tileIndex(tx, ty));
  if (owner !== 0) {
    const s = siteByNum(owner);
    if (!standingTown(s)) return { refuse: "Nobody lives there any more" };
    if (tierOf(p.clan ?? 0, s) === "hostile") return { refuse: `The door is barred to you (${s.name} is hostile)` };
    return { kind: "site", site: s };
  }
  if (tile === TileType.SiteKeep) return { refuse: "Nobody lives there any more" };
  if (clanIdAt(tx, ty) !== (p.clan ?? 0)) return { refuse: "That is not your building" };
  return { kind: "own" };
}

function isHostileMob(m: Mob): boolean {
  return m.hp > 0 && !m.siteWorker && isTowerTarget(m) && !isSleepingNeutral(m);
}
// Hostile mobs within `tiles` of the door tile (tx, ty + 1).
function hostilesNearDoor(tx: number, ty: number, tiles: number): number {
  const door=exteriorDoor(tx,ty);tx=door.x;ty=door.y-1;
  const cx = (tx + 0.5) * TILE_SIZE;
  const cy = (ty + 1.5) * TILE_SIZE;
  const r = tiles * TILE_SIZE;
  let n = 0;
  for (const m of mobs.values()) {
    if (Math.abs(m.x - cx) > r || Math.abs(m.y - cy) > r || Math.hypot(m.x - cx, m.y - cy) > r) continue;
    if (isHostileMob(m)) n++;
  }
  return n;
}

// ---- NPC binding ----
interface Binding {
  snap: InteriorNpcSnapshot;
  role: NpcRole;
  name: string;
  colonistId?: string;
  specialId?: string;
  site?: SiteState;
  // Gap closure G5: the tile it belongs to (station / slot), its seat (patrons, residents at dusk), its bed.
  home: { x: number; y: number };
  seat?: { x: number; y: number; face: InteriorFacing };
  bed?: { x: number; y: number };
}
const px = (t: number) => (t + 0.5) * TILE_SIZE;
// The keeper of these sleeps upstairs at night (not at the counter); the tavern stays open late.
const KEEPER_SLEEPS_UP: ReadonlySet<InteriorTemplateId> = new Set(["hall", "barracks"]);
type DayPhase = "day" | "dusk" | "night";
const dayPhase = (): DayPhase => (isNightNow() ? "night" : isDuskNow() ? "dusk" : "day");
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const bedsOf = (m: InteriorMap) => m.props.filter((q) => q.prop === "bed" || q.prop === "bedFine");

// The people inside: bound per storey, time of day and (own buildings) the clan's real people.
function bindNpcs(p: Player, key: string, tx: number, ty: number, map: InteriorMap, acc: Access, storey = 0): Binding[] {
  const out: Binding[] = [];
  if(encounterKind(state.tiles[tileIndex(tx,ty)]))return out;
  if ("refuse" in acc) return out;
  const id = map.templateId;
  const phase = dayPhase();
  const ground = storey > 0 ? mapFor(id, map.level, map.variant, 0).map : map;
  const slots = (s: "1" | "2" | "v") => ground.slots.filter((q) => q.slot === s);
  const seen = new Set<string>();
  const put = (slot: { x: number; y: number }, b: Omit<Binding, "snap" | "home">, kind: string, act: InteriorNpcAct) => {
    let nid = `${key}:${b.colonistId ?? `${b.role}:${b.name}`}`;
    while (seen.has(nid)) nid += "'";
    seen.add(nid);
    out.push({
      ...b,
      home: { x: slot.x, y: slot.y },
      snap: { id: nid, ...(b.specialId?{specialId:b.specialId}:{}), name: b.name, roleLabel: NPC_ROLE_LABEL[b.role], x: slot.x, y: slot.y, color: talkColorFor(b.name), kind, act },
    });
  };
  if (acc.kind === "site") {
    const s = acc.site;
    const one = slots("1")[0];
    // Named roles (shared/src/namedRoles.ts): the Elder in the hall, the priest at the altar, the smith at the forge, the
    // captain in a barracks (a settlement's barracks is a hall-type room); anyone else keeps the counter.
    const tile = state.tiles[tileIndex(tx, ty)] as TileType;
    const barracks = tile === TileType.KnightPost || tile === TileType.MilitiaPost || tile === TileType.MilitiaCamp2 || tile === TileType.MilitiaCamp3;
    if (one) {
      if (barracks) put(one, { role: "captain", name: namedRoleName(s.id, "captain"), site: s }, "knight", "keeper");
      else if (id === "hall") put(one, { role: "leader", name: namedRoleName(s.id, "elder"), site: s }, "villager", "keeper");
      else if (id === "church") put(one, { role: "questGiver", name: namedRoleName(s.id, "priest"), site: s }, "bishop", "keeper");
      else if (id === "smithy") put(one, { role: "smith", name: namedRoleName(s.id, "smith"), site: s }, "villager", "keeper");
      else put(one, { role: "trader", name: nameFor(`${s.id}:${key}:keeper`), site: s }, "villager", "keeper");
    }
    const two = slots("2")[0];
    if (two) put(two, { role: "trader", name: namedRoleName(s.id, "trader"), site: s }, "villager", "keeper");
    // A "!" by the name of a named person with work for you (as over the merchant / priest / captain outdoors).
    const QR: Partial<Record<NpcRole, QuestRole>> = { trader: "trader", questGiver: "priest", smith: "smith", captain: "captain" };
    for (const b of out) {
      const r = QR[b.role];
      if (r && b.name === namedRoleName(s.id, r) && namedRoleMark(p.clan ?? 0, s, r)) b.snap.quest = true;
    }
    const vs = slots("v").slice(0, id === "house" || id === "church" ? 1 : 0);
    vs.forEach((v, i) => put(v, { role: "villager", name: nameFor(`${s.id}:${key}:v${i}`), site: s }, "villager", "resident"));
  } else {
    // Own buildings and the Abbey: the people posted here (keeper / priest), then those who live here.
    const clan = acc.kind === "abbey" ? 0 : p.clan ?? 0;
    const alive = Array.from(colonists.values()).filter((c) => c.hp > 0 && !c.ghost && (c.clan ?? 0) === clan && c.kind !== "wagon");
    // Deep mines: the miners of an infested mine have fled.
    const posted = id === "mine" && mineHidesMiners(tx, ty, map.variant) ? [] : alive.filter((c) => c.postX === tx && c.postY === ty).sort((a, b) => (a.id < b.id ? -1 : 1));
    const residents = alive
      .filter((c) => c.person && c.person.homeX === tx && c.person.homeY === ty && !posted.includes(c))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const roleOf = (c: (typeof alive)[number], isPosted: boolean): NpcRole =>
      c.kind === "bishop" || acc.kind === "abbey" ? "priest" : isPosted ? "keeper" : "folk";
    const queue = [...posted.map((c) => ({ c, posted: true })), ...residents.map((c) => ({ c, posted: false }))];
    for (const slot of [...slots("1"), ...slots("2"), ...slots("v")]) {
      const next = queue.shift();
      if (!next) break;
      const c = next.c;
      const act: InteriorNpcAct = slot === slots("1")[0] || slots("2").includes(slot) ? "keeper" : "resident";
      put(slot, { role: roleOf(c, next.posted), name: c.person?.name ?? nameFor(c.id), colonistId: c.id }, c.kind === "hero" ? "knight" : c.kind, act);
    }
    // Gap closure G5 (c): your villagers off duty drink at your tavern at dusk / night.
    if (id === "tavern" && phase !== "day") {
      const used = new Set(out.map((b) => b.colonistId));
      const free = alive
        .filter((c) => c.person && !c.person.child && !used.has(c.id) && c.kind !== "hero")
        .sort((a, b) => hashOf(`${a.id}:${gameDay()}`) - hashOf(`${b.id}:${gameDay()}`));
      patronPool = free.map((c) => ({ name: c.person!.name, colonistId: c.id, kind: c.kind }));
    }
  }
  // Gap closure G5 (c): patrons at the tavern tables (villagers off duty at dusk / night, travellers).
  if (id === "tavern" && storey === 0) {
    const seats = interiorSeats(map);
    const [lo, hi] = phase === "night" ? INTERIOR_PATRONS_NIGHT : phase === "dusk" ? INTERIOR_PATRONS_DUSK : INTERIOR_PATRONS_DAY;
    const want = Math.min(seats.length, lo + (hashOf(`${key}:${gameDay()}:${phase}`) % (hi - lo + 1)));
    const pool = acc.kind === "own" ? patronPool : [];
    patronPool = [];
    const order = seats.map((q, i) => ({ q, k: hashOf(`${key}:seat${i}:${gameDay()}`) })).sort((a, b) => a.k - b.k).map((x) => x.q);
    for (let i = 0; i < want; i++) {
      const seat = order[i];
      // Keep at least one traveller; the rest are your own folk off duty (when there are any).
      const own = i < want - 1 ? pool[i] : undefined;
      const s = acc.kind === "site" ? acc.site : undefined;
      const name = own?.name ?? (s && i % 2 === 0 ? nameFor(`${s.id}:${key}:patron${i}`) : `${nameFor(`${key}:${gameDay()}:trav${i}`)} the traveller`);
      put(seat, { role: "patron", name, colonistId: own?.colonistId, site: s, seat }, own?.kind ?? "villager", "patron");
    }
  }
  patronPool = [];
  if(storey===0){
    const solid=interiorSolidGrid(map),occupied=new Set(out.map(b=>`${b.home.x},${b.home.y}`));
    const free:{x:number;y:number}[]=[];
    for(let y=2;y<map.h-2;y++)for(let x=2;x<map.w-2;x++)if(!solid[y*map.w+x]&&!occupied.has(`${x},${y}`)&&Math.hypot(x-map.spawn.x,y-map.spawn.y)>2&&Math.hypot(x-map.exit.x,y-map.exit.y)>2)free.push({x,y});
    const cast=specialAt(tx,ty);for(const [i,c]of cast.entries()){
      const at=free[Math.floor((i+.5)*free.length/Math.max(1,cast.length))];if(!at)continue;
      const role:NpcRole=c.group==='masters'?'smith':c.group==='faith'?'priest':c.group==='watch'?'captain':c.group==='court'&&!c.child?'leader':c.group==='commons'?'trader':'villager';
      put(at,{role,name:c.name,specialId:c.id,...(acc.kind==='site'?{site:acc.site}:{})},'villager',c.group==='masters'&&map.templateId==='smithy'?'keeper':'resident');
      out[out.length-1].snap.roleLabel=c.title;
    }
  }
  if (storey === 0) {
    // At night the hall's / barracks' keeper is upstairs in bed.
    if (phase === "night" && KEEPER_SLEEPS_UP.has(id) && INTERIOR_UPPER_TEMPLATES[id]) {
      const k = out.findIndex((b) => b.snap.act === "keeper" && b.home.x === slots("1")[0]?.x && b.home.y === slots("1")[0]?.y);
      if (k >= 0) out.splice(k, 1);
    }
    // Residents: a bed each (night), a seat each (dusk); patrons have taken the tavern's seats.
    const beds = bedsOf(map);
    const seats = interiorSeats(map).filter((q) => !out.some((b) => b.seat && b.seat.x === q.x && b.seat.y === q.y));
    out.filter((b) => b.snap.act === "resident").forEach((b, i) => {
      if (beds[i]) b.bed = { x: beds[i].x, y: beds[i].y };
      if (seats[i]) b.seat = seats[i];
    });
    return out;
  }
  // Upstairs: by night the keeper of a hall / barracks sleeps here, and travellers in the tavern's guest beds.
  const up: Binding[] = [];
  if (phase !== "night") return up;
  const beds = bedsOf(map);
  const sleepers = id === "tavern"
    ? [0, 1].map((i) => ({ b: undefined as Binding | undefined, name: `${nameFor(`${key}:${gameDay()}:guest${i}`)} the traveller` }))
    : out.filter((b) => b.snap.act === "keeper" && b.home.x === slots("1")[0]?.x && b.home.y === slots("1")[0]?.y).map((b) => ({ b, name: b.name }));
  sleepers.slice(0, beds.length).forEach((x, i) => {
    const bed = { x: beds[i].x, y: beds[i].y };
    const b: Binding = x.b
      ? { ...x.b, home: bed, bed, snap: { ...x.b.snap, x: bed.x, y: bed.y, act: "sleeper" } }
      : { role: "patron", name: x.name, home: bed, bed, snap: { id: `${key}:up:${i}`, name: x.name, roleLabel: NPC_ROLE_LABEL.patron, x: bed.x, y: bed.y, color: talkColorFor(x.name), kind: "villager", act: "sleeper" } };
    up.push(b);
  });
  return up;
}
// Own tavern patrons (bindNpcs fills it, then uses it straight away).
let patronPool: { name: string; colonistId: string; kind: string }[] = [];

// ---- living NPCs (gap closure G5 a) ----
interface LiveNpc {
  id: string;
  x: number;
  y: number;
  face: InteriorFacing;
  pose: InteriorNpcPose;
  path: { x: number; y: number }[];
  wait: number;
  seed: number;
  say?: string;
  sayUntil: number;
  greetNext: number;
  // What it is heading for: "" (wandering), "bed", "seat", "home".
  goal: string;
}
interface LiveRoom {
  npcs: Map<string, LiveNpc>;
  binds: Binding[];
  map: InteriorMap;
  solid: Uint8Array;
  tick: number;
}
const rooms = new Map<string, LiveRoom>();
// Layered mines: each layer of a Mine is its own room.
const roomKeyOf = (I: NonNullable<Player["interior"]>) => `${I.key}:${I.storey}${I.templateId === "mine" && isLayeredMine(I.tile) ? `:L${I.variant}` : ""}`;

function rand(n: LiveNpc): number {
  n.seed ^= n.seed << 13;
  n.seed ^= n.seed >>> 17;
  n.seed ^= n.seed << 5;
  return ((n.seed >>> 0) % 10000) / 10000;
}

// Where a binding should be now: its bed (sleeper; resident at night), its seat (patron; resident at dusk), its
// station (keeper), or nowhere in particular (resident by day).
function goalOf(b: Binding, phase: DayPhase): { goal: string; at?: { x: number; y: number } } {
  const act = b.snap.act;
  if (act === "sleeper" || (act === "resident" && phase === "night" && b.bed)) return { goal: "bed", at: b.bed };
  if (act === "patron" || (act === "resident" && phase === "dusk" && b.seat)) return { goal: "seat", at: b.seat };
  if (act === "keeper") return { goal: "home", at: b.home };
  return { goal: "" };
}

// Live NPCs for the bindings (kept by id; a new one starts where it should be).
function syncRoom(rk: string, map: InteriorMap, solid: Uint8Array, binds: Binding[]): LiveRoom {
  let r = rooms.get(rk);
  if (!r || r.map !== map) {
    r = { npcs: new Map(), binds, map, solid, tick: state.cycleTick };
    rooms.set(rk, r);
  }
  r.binds = binds;
  const phase = dayPhase();
  const keep = new Set<string>();
  for (const b of binds) {
    keep.add(b.snap.id);
    if (r.npcs.has(b.snap.id)) continue;
    const g = goalOf(b, phase);
    const at = g.at ?? b.home;
    r.npcs.set(b.snap.id, {
      id: b.snap.id, x: at.x, y: at.y, face: b.seat && g.goal === "seat" ? b.seat.face : "d", pose: "idle", path: [],
      wait: INTERIOR_NPC_WAIT_MIN_TICKS, seed: hashOf(b.snap.id) | 1, sayUntil: 0, greetNext: 0, goal: g.goal,
    });
  }
  for (const k of r.npcs.keys()) if (!keep.has(k)) r.npcs.delete(k);
  return r;
}

// Shortest path on the room grid (4-way) to `to` (which may be a solid bed / chair tile); [] when none.
function pathTo(r: LiveRoom, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const { w, h } = r.map;
  const s = from.y * w + from.x;
  const g = to.y * w + to.x;
  if (s === g) return [];
  const prev = new Int32Array(w * h).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    if (i === g) break;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (prev[j] >= 0 || (r.solid[j] && j !== g) || r.map.cells[j] === "E") continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[g] < 0) return [];
  const out: { x: number; y: number }[] = [];
  for (let i = g; i !== s; i = prev[i]) out.push({ x: i % w, y: Math.floor(i / w) });
  return out.reverse();
}

const KEEPER_WORKS: ReadonlySet<InteriorTemplateId> = new Set(["smithy", "bakery", "barn", "mine"]);
const GREETS: Record<string, string[]> = {
  smithy: ["Mind the sparks!", "Need an edge on that?"], bakery: ["Fresh loaves today!", "Mind, the oven's hot."],
  tavern: ["What'll it be?", "Ale's cold, the fire's warm."], shop: ["Have a look around.", "Fair prices, friend."],
  hall: ["Welcome to the hall.", "Speak, traveller."], church: ["Peace be with you.", "The Saint watches over us."],
  barracks: ["At ease.", "Stay sharp out there."], barn: ["Mind the hay.", "Busy day."], house: ["Oh! Hello.", "Make yourself at home."],
  mine: ["Mind your head.", "Good seam today.", "Watch the props."],
  patron: ["Cheers!", "Another round!", "Evening, stranger.", "Sit, sit!"],
};
function greetingFor(b: Binding, room: InteriorTemplateId): string {
  if(b.specialId)return SPECIAL_BY_ID.get(b.specialId)?.hook??"Good day.";
  const list = b.role === "patron" ? GREETS.patron : b.snap.act === "keeper" ? GREETS[room] : ["Good day to you.", "Hello there."];
  return list[hashOf(b.snap.id) % list.length];
}

// One tick of a room: walking, waiting, facing / stopping for heroes, greetings.
function stepRoom(r: LiveRoom, heroes: { x: number; y: number }[]) {
  const phase = dayPhase();
  const step = INTERIOR_NPC_SPEED_TILES * dt;
  for (const b of r.binds) {
    const n = r.npcs.get(b.snap.id);
    if (!n) continue;
    const g = goalOf(b, phase);
    const cx = Math.round(n.x);
    const cy = Math.round(n.y);
    // A new goal (dusk came, night fell): walk there.
    if (g.goal !== n.goal) {
      n.goal = g.goal;
      n.path = g.at ? pathTo(r, { x: cx, y: cy }, g.at) : [];
      n.wait = 0;
    }
    // Nearest hero: stop and turn to them; greet when they come close.
    let near: { x: number; y: number; d: number } | null = null;
    for (const h of heroes) {
      const d = Math.hypot(h.x - n.x, h.y - n.y);
      if (!near || d < near.d) near = { ...h, d };
    }
    const asleep = n.goal === "bed" && n.path.length === 0 && cx === g.at?.x && cy === g.at?.y;
    if (n.say && state.cycleTick >= n.sayUntil) n.say = undefined;
    if (near && near.d <= INTERIOR_GREET_RANGE_TILES && !asleep && state.cycleTick >= n.greetNext) {
      n.say = greetingFor(b, r.map.templateId);
      n.sayUntil = state.cycleTick + INTERIOR_SAY_TICKS;
      n.greetNext = state.cycleTick + INTERIOR_GREET_COOLDOWN_TICKS;
    }
    const faceTo = (dx: number, dy: number): InteriorFacing => (Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "l" : "r") : dy < 0 ? "u" : "d");
    if (near && near.d <= INTERIOR_NPC_STOP_TILES && !asleep && n.pose !== "sit") {
      n.face = faceTo(near.x - n.x, near.y - n.y);
      n.pose = b.snap.act === "keeper" && KEEPER_WORKS.has(r.map.templateId) ? "work" : "idle";
      continue;
    }
    if (n.path.length > 0) {
      const t = n.path[0];
      const dx = t.x - n.x;
      const dy = t.y - n.y;
      const d = Math.hypot(dx, dy);
      if (d <= step) {
        n.x = t.x;
        n.y = t.y;
        n.path.shift();
      } else {
        n.x += (dx / d) * step;
        n.y += (dy / d) * step;
      }
      n.face = faceTo(dx, dy);
      n.pose = "walk";
      continue;
    }
    // Arrived / standing.
    if (n.goal === "bed") n.pose = asleep ? "sleep" : "idle";
    else if (n.goal === "seat") {
      n.pose = "sit";
      if (b.seat) n.face = b.seat.face;
    } else if (n.goal === "home") {
      n.pose = KEEPER_WORKS.has(r.map.templateId) ? "work" : "idle";
      if (!near || near.d > INTERIOR_GREET_RANGE_TILES) n.face = "d";
      else n.face = faceTo(near.x - n.x, near.y - n.y);
    } else {
      // Wandering: wait, then walk to a free tile nearby.
      n.pose = "idle";
      if (--n.wait > 0) continue;
      n.wait = INTERIOR_NPC_WAIT_MIN_TICKS + Math.floor(rand(n) * (INTERIOR_NPC_WAIT_MAX_TICKS - INTERIOR_NPC_WAIT_MIN_TICKS));
      const R = INTERIOR_NPC_WANDER_TILES;
      for (let tries = 0; tries < 8; tries++) {
        const tx = cx + Math.round((rand(n) * 2 - 1) * R);
        const ty = cy + Math.round((rand(n) * 2 - 1) * R);
        if (tx < 0 || ty < 0 || tx >= r.map.w || ty >= r.map.h) continue;
        const j = ty * r.map.w + tx;
        if (r.solid[j] || r.map.cells[j] === "E" || (tx === cx && ty === cy)) continue;
        const path = pathTo(r, { x: cx, y: cy }, { x: tx, y: ty });
        if (path.length > 0 && path.length <= R * 2) {
          n.path = path;
          break;
        }
      }
    }
  }
}

const liveOf = (r: LiveRoom): InteriorNpcLive[] =>
  r.binds.flatMap((b) => {
    const n = r.npcs.get(b.snap.id);
    if (!n) return [];
    return [{ id: n.id, x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100, face: n.face, pose: n.pose, ...(n.say ? { say: n.say } : {}) }];
  });

// ---- view ----
function titleFor(map: InteriorMap, acc: Access, tile = 0): string {
  if(encounterKind(tile))return map.label;
  if ("refuse" in acc) return map.label;
  if (acc.kind === "abbey") return "Saint Wren's Abbey";
  if (acc.kind === "site") return `${map.label}, ${acc.site.name}`;
  // Deep mines: named by the mine (Quarry, Iron Mine, ...) and its depth.
  if (map.templateId === "mine" && isLayeredMine(tile)) return `Your mine, level ${map.variant + 1} (${mineLayerResourcesText(map.variant + 1)})`;
  if (map.templateId === "mine") return `Your ${(MINE_LABEL[tile] ?? "Mine").toLowerCase()}${map.level >= 3 ? " (deep workings)" : map.level === 2 ? " (shaft)" : ""}`;
  return `Your ${map.label.toLowerCase()}`;
}
const chestCapFor = (id: string) => (id === "barn" ? INTERIOR_BARN_CHEST_CAP : INTERIOR_CHEST_CAP);
const hasProp = (map: InteriorMap, prop: string) => map.props.some((q) => q.prop === prop);

function viewFor(p: Player): { view: InteriorView; npcs: Binding[]; acc: Access } | null {
  const I = p.interior;
  if (!I) return null;
  const { map, solid } = mapOf(I);
  const acc = accessFor(p, I.tx, I.ty, I.tile as TileType);
  const npcs = bindNpcs(p, I.key, I.tx, I.ty, map, acc, I.storey);
  syncRoom(roomKeyOf(I), map, solid, npcs);
  const own = "kind" in acc && acc.kind === "own";
  const view: InteriorView = {
    instanceVariant:I.variant,
    furniture:furnitureView(p,map,own&&!encounterKind(I.tile),explorationView(p,false)?.objects??[]),
    exploration:explorationView(p,mineView(I.tx,I.ty,I.variant)?.status==='cleared'),
    key: I.key,
    tx: I.tx,
    ty: I.ty,
    map,
    npcs: [...npcs.map((b) => b.snap),...companionSnapshots(p)],
    chest: own && hasProp(map, "chest") ? { ...(chests.get(I.key) ?? {}) } : null,
    chestCap: chestCapFor(map.templateId),
    editable:own && ["house","hall"].includes(I.templateId) && I.storey===0,
    homeDesign:homeDesigns.get(I.key),
    canSleep: own && INTERIOR_SLEEP_TEMPLATES.has(map.templateId) && (hasProp(map, "bed") || hasProp(map, "bedFine")),
    threat: hostilesNearDoor(I.tx, I.ty, INTERIOR_THREAT_ALERT_TILES),
    title: titleFor(map, acc, I.tile),
    ...(map.templateId === "mine" && mineView(I.tx, I.ty, I.variant) ? { mine: mineView(I.tx, I.ty, I.variant) } : {}),
  };
  return { view, npcs, acc };
}

function sendView(p: Player, force = false) {
  const v = viewFor(p);
  if (!v || !p.interior) return;
  const json = JSON.stringify(v.view);
  if (!force && json === p.interior.sent) return;
  p.interior.sent = json;
  sendTo(p, { type: "interior", view: v.view });
}

export function companionRoomGrid(p:Player){return p.interior?mapOf(p.interior):undefined;}
export function refreshInteriorView(key?:string){for(const p of players.values())if(p.interior&&(!key||p.interior.key===key))sendView(p,true);}
export function handleInteriorTalk(p:Player,id:unknown){
 if(typeof id!=='string'||id.length>200||p.dead||!p.interior)return;const v=viewFor(p);if(!v)return;
 const b=v.npcs.find(b=>b.snap.id===id),n=rooms.get(roomKeyOf(p.interior))?.npcs.get(id);if(!b)return;
 const x=n?.x??b.snap.x,y=n?.y??b.snap.y,I=p.interior;if(Math.hypot(px(x)-I.x,px(y)-I.y)>TALK_RANGE_TILES*TILE_SIZE)return toast(p,'Walk closer to speak.');
 const map=v.view.map,solid=interiorSolidGrid(map),hx=I.x/TILE_SIZE-.5,hy=I.y/TILE_SIZE-.5,steps=Math.ceil(Math.hypot(x-hx,y-hy)*6);for(let i=1;i<steps;i++)if(solid[Math.round(hy+(y-hy)*i/steps)*map.w+Math.round(hx+(x-hx)*i/steps)])return toast(p,'Walk around the wall to speak.');
 startTalk(p,{role:b.role,specialId:b.specialId,name:b.name,d:0,site:b.site,colonist:b.colonistId?colonists.get(b.colonistId):undefined,inside:{key:I.key,x:px(x),y:px(y),anchor:{x:I.tx,y:I.ty},tavern:I.templateId==='tavern'}});
}
// ---- enter / exit ----
function exteriorDoor(tx:number,ty:number){const fp=placedFootprint(tx,ty);return{x:tx+Math.floor(fp.w/2),y:ty+fp.h};}

// The building whose door the hero stands at (door = the tile below a 1x1 prefab building). `bump`: only the
// hero's own tile counts (walking north into the building from its door tile).
function doorAt(p: Player, bump: boolean): { tx: number; ty: number } | null {
  const mx = Math.floor(p.x / TILE_SIZE);
  const my = Math.floor(p.y / TILE_SIZE);
  let best: { tx: number; ty: number; d: number } | null = null;
  const r = bump ? 0 : 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const doorX = mx + dx;
      const doorY = my + dy;
      if (!inBounds(doorX, doorY - 1)) continue;
      const a = anchorOfTile(doorX, doorY - 1);
      const door=exteriorDoor(a.x,a.y);if (door.x !== doorX || door.y !== doorY || !interiorTemplateAt(a.x, a.y)) continue;
      const d = Math.hypot(px(doorX) - p.x, px(doorY) - p.y) / TILE_SIZE;
      if (d <= INTERIOR_DOOR_REACH_TILES && (!best || d < best.d)) best = { tx: a.x, ty: a.y, d };
    }
  }
  // Deep mines: a mine whose door (the tile below it) is blocked (it stands in a vein, ore below it) is entered with E
  // from any free side.
  if (!best && !bump) {
    for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
      const mx2 = mx + dx;
      const my2 = my + dy;
      if (!inBounds(mx2, my2) || !isMineTile(state.tiles[tileIndex(mx2, my2)])) continue;
      if (inBounds(mx2, my2 + 1) && !isSolidTile(state.tiles[tileIndex(mx2, my2 + 1)] as TileType)) continue;
      const d = Math.hypot(px(mx2) - p.x, px(my2) - p.y) / TILE_SIZE;
      if (d <= 1 + INTERIOR_DOOR_REACH_TILES && (!best || d < best.d)) best = { tx: mx2, ty: my2, d };
    }
  }
  return best;
}

// E / a bump at a door: true when there was a door (entered, or refused with a toast).
export function tryEnterAtDoor(p: Player, bump: boolean): boolean {
  if (p.dead || p.interior) return false;
  const door = doorAt(p, bump);
  if (!door) return false;
  if (bump) {
    if (state.cycleTick - (p.interiorBumpTick ?? -1e9) < INTERIOR_BUMP_COOLDOWN_TICKS) return true;
    p.interiorBumpTick = state.cycleTick;
  }
  const why = enterInterior(p, door.tx, door.ty);
  if (why) toast(p, why);
  return true;
}

// Puts the hero inside the building anchored at (tx, ty); "" = entered, else why not.
export function enterInterior(p: Player, tx: number, ty: number): string {
  if (p.dead) return "You cannot";
  // Gap closure G6: horses stay outside.
  if (isMounted(p)) return "Dismount first (X): horses stay outside";
  const t = interiorTemplateAt(tx, ty);
  if (!t) return "That building has no way in";
  const acc = accessFor(p, tx, ty, t.tile);
  if ("refuse" in acc) return acc.refuse;
  const near = hostilesNearDoor(tx, ty, INTERIOR_ENEMY_BLOCK_TILES);
  if (near > 0) return `Enemies are too close (${near} within ${INTERIOR_ENEMY_BLOCK_TILES} tiles): you cannot get inside`;
  stopHeroBusy(p);
  const a=encounterAnchor(tx,ty,t.tile),key=`${a.x},${a.y}`;
  if(encounterKind(t.tile))ensureEnteredEncounter(tx,ty);
  const { map } = designedMap(key,t.id,t.level,t.variant);
  // The world body waits at the door.
  const door=exteriorDoor(tx,ty);p.x=px(door.x);p.y=px(door.y);
  p.interior = {
    key, tx, ty, tile: t.tile, level: t.level, templateId: t.id, variant: t.variant, storey: 0,
    x: px(map.spawn.x), y: px(map.spawn.y), sent: "", nextRefresh: state.cycleTick + INTERIOR_REFRESH_TICKS,
  };
  sendView(p, true);
  return "";
}

// Back to the world at the building's door (the nearest free spot if something stands on it now).
export function exitInterior(p: Player, why = "") {
  const I = p.interior;
  if (!I) return;
  stopHeroBusy(p);
  p.interior = undefined;
  p.interiorBumpTick = state.cycleTick;
  const door=exteriorDoor(I.tx,I.ty);let x=px(door.x);let y=px(door.y);
  if (collidesAt(x, y)) {
    found: for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = px(I.tx + dx);
          const ny = px(I.ty + 1 + dy);
          if (inBounds(I.tx + dx, I.ty + 1 + dy) && !collidesAt(nx, ny)) {
            x = nx;
            y = ny;
            break found;
          }
        }
      }
    }
  }
  p.x = x;
  p.y = y;
  sendTo(p, { type: "interior", view: null });
  if (why) toast(p, why);
}

// Esc near the exit mat.
export function handleInteriorExit(p: Player) {
  const I = p.interior;
  if (!I) return;
  const { map } = mapOf(I);
  if (I.storey > 0) return toast(p, "Take the stairs down first");
  if (Math.hypot(px(map.exit.x) - I.x, px(map.exit.y) - I.y) / TILE_SIZE > INTERIOR_ESC_EXIT_TILES) return toast(p, map.underground?"Walk to the tunnel entrance to leave":encounterKind(I.tile)==='ruin'?"Walk to the ruined arch to leave":"Walk to the door mat to leave");
  // Layered mines: from a deeper level the mat is the way back up.
  if (I.templateId === "mine" && isLayeredMine(I.tile) && I.variant > 0) return changeMineLayer(p, I.variant - 1);
  exitInterior(p);
}

// ---- per tick ----
// sim.ts: the hero walks the interior map (its own small collision grid); stepping onto the exit mat leaves.
export function stepInteriorMovement(p: Player) {
  const I = p.interior;
  if (!I) return;
  const { map, solid } = mapOf(I);
  const { dx, dy, mult:combatSpeed } = combatMotion(p);
  const len = Math.hypot(dx, dy) || 1;
  const speed = PLAYER_SPEED * INTERIOR_SPEED_MULT * heroProfileOf(p).stats.moveSpeedMult * heroSpeedMult(p) * bossMoveSpeed(p) * combatSpeed;
  const blocked = (x: number, y: number) => {
    const steps=Math.max(1,Math.ceil(Math.hypot(x-I.x,y-I.y)/4));
    for(let n=1;n<=steps;n++)for (const ox of [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE]) {
      for (const oy of [-PLAYER_HALF_SIZE, PLAYER_HALF_SIZE]) {
        const cx = Math.floor((I.x+(x-I.x)*n/steps + ox) / TILE_SIZE);
        const cy = Math.floor((I.y+(y-I.y)*n/steps + oy) / TILE_SIZE);
        if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || solid[cy * map.w + cx]) return true;
      }
    }
    return false;
  };
  const nx = I.x + (dx / len) * speed * dt;
  if (!blocked(nx, I.y)) I.x = nx;
  const ny = I.y + (dy / len) * speed * dt;
  if (!blocked(I.x, ny)) I.y = ny;
  const mx = Math.floor(I.x / TILE_SIZE);
  const my = Math.floor(I.y / TILE_SIZE);
  // Gap closure G5 (d): onto the stairs: the other storey (a fresh arrival ignores the stairs for a moment).
  if (map.stairs && mx === map.stairs.x && my === map.stairs.y && state.cycleTick - (p.interiorBumpTick ?? -1e9) >= INTERIOR_BUMP_COOLDOWN_TICKS) {
    changeStorey(p, I.storey > 0 ? 0 : 1);
    return;
  }
  // Layered mines: onto the shaft (the Mine's sprite drawn inside) goes down a level; the mat of a deeper level up.
  const layered = I.templateId === "mine" && isLayeredMine(I.tile);
  const fresh = state.cycleTick - (p.interiorBumpTick ?? -1e9) < INTERIOR_BUMP_COOLDOWN_TICKS;
  if (layered && !fresh && map.props.some((q) => q.prop === "mineShaft" && q.x === mx && q.y === my)) return changeMineLayer(p, I.variant + 1);
  if (layered && I.variant > 0 && mx === map.exit.x && my === map.exit.y) {
    if (!fresh) changeMineLayer(p, I.variant - 1);
    return;
  }
  if (I.storey === 0 && mx === map.exit.x && my === map.exit.y) exitInterior(p);
}

// Layered mines: down the shaft / back up to `variant` (a layer of the Mine, 0-based; never past its level). Going
// down, the hero appears just inside the new layer's mat; going up, beside the shaft it came down.
export function changeMineLayer(p: Player, variant: number) {
  const I = p.interior;
  if (!I || I.templateId !== "mine" || !isLayeredMine(I.tile) || variant < 0 || variant >= I.level || variant === I.variant) return;
  stopHeroBusy(p);
  const down = variant > I.variant;
  I.variant = variant;
  const { map, solid } = mapOf(I);
  let at = map.spawn;
  if (!down) {
    const s = map.props.find((q) => q.prop === "mineShaft");
    if (s) {
      at = [[0, 1], [-1, 0], [1, 0], [0, -1]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy }))
        .find((q) => q.x >= 0 && q.y >= 0 && q.x < map.w && q.y < map.h && !solid[q.y * map.w + q.x] && map.cells[q.y * map.w + q.x] !== "E") ?? map.spawn;
    }
  }
  I.x = px(at.x);
  I.y = px(at.y);
  I.npcSent = "";
  p.interiorBumpTick = state.cycleTick;
  sendView(p, true);
  toast(p, down ? `You climb down to the mine's level ${variant + 1}` : `You climb back up to level ${variant + 1}`);
}

// Up / down the stairs: the hero appears beside the stairs of the other storey.
export function changeStorey(p: Player, storey: number) {
  const I = p.interior;
  if (!I || storey === I.storey || (storey > 0 && !INTERIOR_UPPER_TEMPLATES[I.templateId as InteriorTemplateId])) return;
  stopHeroBusy(p);
  I.storey = storey;
  const { map, solid } = mapOf(I);
  let at = map.spawn;
  if (storey === 0 && map.stairs) {
    const s = map.stairs;
    at = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy }))
      .find((q) => q.x >= 0 && q.y >= 0 && q.x < map.w && q.y < map.h && !solid[q.y * map.w + q.x] && map.cells[q.y * map.w + q.x] !== "E") ?? map.spawn;
  }
  I.x = px(at.x);
  I.y = px(at.y);
  I.npcSent = "";
  p.interiorBumpTick = state.cycleTick;
  sendView(p, true);
  toast(p, storey > 0 ? "You climb the stairs" : "You go back down");
}

// sim.ts, once a tick: dead heroes are put out; every INTERIOR_REFRESH_TICKS the building is re-checked (gone: out;
// upgraded: the new level's room) and the view is resent if its NPCs / chest / threat changed.
export function updateInteriors() {
  if(state.cycleTick%20===0){
    for(const key of homeDesigns.keys()){const [x,y]=key.split(',').map(Number);if(!interiorTemplateAt(x,y))homeDesigns.delete(key);}
    const homes:[number,string][]=[...homeDesigns].map(([key,d])=>{const [x,y]=key.split(',').map(Number);return[tileIndex(x,y),d.base]});const sig=JSON.stringify(homes);
    for(const p of players.values())if(homeSent.get(p.id)!==sig){sendTo(p,{type:'homeDesigns',homes});homeSent.set(p.id,sig);}
    for(const id of homeSent.keys())if(!players.has(id))homeSent.delete(id);
  }
  // Gap closure G5: the rooms someone is in step once a tick; their NPCs go out every INTERIOR_NPC_SEND_TICKS.
  const inRoom = new Map<string, Player[]>();
  for (const p of players.values()) {
    if (!p.interior || p.dead) continue;
    const rk = roomKeyOf(p.interior);
    const list = inRoom.get(rk);
    if (list) list.push(p);
    else inRoom.set(rk, [p]);
  }
  for (const [rk, r] of rooms) {
    const ps = inRoom.get(rk);
    if (!ps) {
      rooms.delete(rk);
      continue;
    }
    if (r.tick === state.cycleTick) continue;
    r.tick = state.cycleTick;
    stepRoom(r, ps.map((q) => ({ x: q.interior!.x / TILE_SIZE - 0.5, y: q.interior!.y / TILE_SIZE - 0.5 })));
    if (state.cycleTick % INTERIOR_NPC_SEND_TICKS !== 0) continue;
    const npcs = [...liveOf(r),...companionLive(ps[0])];
    const json = JSON.stringify(npcs);
    for (const q of ps) {
      if (q.interior!.npcSent === json) continue;
      q.interior!.npcSent = json;
      sendTo(q, { type: "interiorNpcs", key: q.interior!.key, storey: q.interior!.storey, npcs });
    }
  }
  for (const p of players.values()) {
    const I = p.interior;
    if (!I) continue;
    if (p.dead) {
      exitInterior(p);
      continue;
    }
    if (state.cycleTick < I.nextRefresh) continue;
    I.nextRefresh = state.cycleTick + INTERIOR_REFRESH_TICKS;
    withClan(clanOf(p), () => {
      const t = interiorTemplateAt(I.tx, I.ty);
      if (!t || t.id !== I.templateId) return exitInterior(p, "The building is gone: you are back outside");
      if ("refuse" in accessFor(p, I.tx, I.ty, t.tile)) return exitInterior(p, "You are shown the door");
      // Layered mines: the hero stays on its layer (while the Mine still reaches it).
      const want = t.id === "mine" && isLayeredMine(t.tile) && I.tile === t.tile ? Math.min(I.variant, t.level - 1) : t.variant;
      if (t.level !== I.level || t.tile !== I.tile || want !== I.variant) {
        I.level = t.level;
        I.tile = t.tile;
        I.variant = want;
        const { map, solid } = mapOf(I);
        const cx = Math.floor(I.x / TILE_SIZE);
        const cy = Math.floor(I.y / TILE_SIZE);
        if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h || solid[cy * map.w + cx]) Object.assign(I, { x: px(map.spawn.x), y: px(map.spawn.y) });
      }
      sendView(p);
    });
  }
}

// ---- E inside ----
export function interiorInteract(p: Player) {
  const I = p.interior;
  const v = viewFor(p);
  if (!I || !v) return;
  const { map } = v.view;
  const dist = (x: number, y: number) => Math.hypot(px(x) - I.x, px(y) - I.y) / TILE_SIZE;
  const inside = (x: number, y: number): TalkInside => ({ key: I.key, x: px(x), y: px(y), anchor: { x: I.tx, y: I.ty }, ...(map.templateId === "tavern" ? { tavern: true } : {}) });
  const live = rooms.get(roomKeyOf(I));
  type Pick = { d: number; run: () => void };
  let best: Pick | null = null;
  const offer = (d: number, run: () => void) => {
    if (!best || d < best.d) best = { d, run };
  };
  for (const b of v.npcs) {
    const n = live?.npcs.get(b.snap.id);
    const nx = n?.x ?? b.snap.x;
    const ny = n?.y ?? b.snap.y;
    const d = dist(nx, ny);
    if (d > TALK_RANGE_TILES) continue;
    const c = b.colonistId ? colonists.get(b.colonistId) : undefined;
    offer(d - TALK_RANGE_TILES, () => startTalk(p, { role: b.role, specialId:b.specialId, name: b.name, d, site: b.site, colonist: c, inside: inside(nx, ny) }));
  }
  for(const o of v.view.exploration?.objects??[]){const d=dist(o.x,o.y);if(o.available&&d<=1.65)offer(d,()=>encounterInteract(p,o.x,o.y));}
  for (const q of map.props) {
    if(v.view.exploration?.objects.some(o=>o.x===q.x&&o.y===q.y))continue;
    const d = dist(q.x, q.y);
    if (d > INTERIOR_USE_RANGE_TILES) continue;
    if (q.prop === "bed" || q.prop === "bedFine") offer(d, () => bedTalk(p, v.view.canSleep, v.view.threat, inside(q.x, q.y)));
    else if (WORK_PROPS.has(q.prop) && interiorWorkstation(p)) offer(d + 1, () => handlePersonalCraft(p));
    else if(v.view.furniture?.some(f=>f.x===q.x&&f.y===q.y))offer(d,()=>handleInteriorUse(p,q.x,q.y));
    else if (q.prop === "chest") offer(d, () => (v.view.chest ? chestTalk(p, "", inside(q.x, q.y)) : toast(p, "This chest is not yours")));
  }
  const de = dist(map.exit.x, map.exit.y);
  if (de <= INTERIOR_USE_RANGE_TILES) offer(de + 0.25, () => exitInterior(p));
  const pick = best as Pick | null;
  if (pick) pick.run();
  else toast(p, "Nothing to use here (walk up to someone, a bed, a chest or the door mat)");
}

// Stardew phase 5c: interior rest multiplier for herolife.ts shelterMult (your own house / hall: your bed).
export function interiorRestMult(p: Player): number {
  const I = p.interior;
  if (!I || !INTERIOR_SLEEP_TEMPLATES.has(I.templateId as InteriorTemplateId)) return 1;
  const acc = accessFor(p, I.tx, I.ty, I.tile as TileType);
  return "kind" in acc && acc.kind === "own" ? INTERIOR_BED_REST_MULT : 1;
}

// ---- the bed ----
function bedTalk(p: Player, canSleep: boolean, threat: number, at: TalkInside, head = "") {
  if (!canSleep) return toast(p, "This is not your bed");
  const night = isNightNow();
  const choices: ChoiceRt[] = [
    { label: "Sleep until dawn.", action: "sleep", disabled: !night ? "It is still day: you can only nap" : threat > 0 ? "Not with enemies at the door" : undefined },
    { label: "Lie down for a while (rest faster; move to get up).", action: "nap" },
  ];
  furnitureTalk(p, "Your bed", (head ? head + "\n\n" : "") + "A warm bed in your own house.", choices, at);
}

// A full night's sleep: rest and energy full; time skips to dawn only when no other hero is connected.
function sleepToDawn(p: Player): string {
  restHeroFully(p);
  const others = Array.from(players.values()).filter((o) => o !== p && !o.dead);
  if (others.length > 0) return "You sleep a few hours and wake rested (others are awake: the night goes on).";
  // The tick before dawn: the next sim step is dawn (state.wasNight is already true), so dawn runs as ever.
  const day = Math.floor(state.cycleTick / GAME_DAY_TICKS);
  state.cycleTick = Math.max(state.cycleTick, (day + 1) * GAME_DAY_TICKS - 1);
  return "You sleep until dawn and wake rested.";
}

// ---- the chest ----
const chestWeight = (c: Partial<Record<PackGood, number>>) => Math.round(PACK_GOODS.reduce((w, g) => w + (c[g] ?? 0) * PACK_WEIGHT[g], 0) * 10) / 10;
const goodsText = (c: Partial<Record<PackGood, number>>) =>
  PACK_GOODS.filter((g) => (c[g] ?? 0) > 0).map((g) => `${c[g]} ${PACK_LABEL[g].toLowerCase()}`).join(", ") || "empty";

function chestTalk(p: Player, head: string, at: TalkInside) {
  const I = p.interior;
  if (!I) return;
  const chest = chests.get(I.key) ?? {};
  const life = lifeOf(p);
  const cap = chestCapFor(I.templateId);
  const cw = chestWeight(chest);
  const pw = packWeight(life);
  const choices: ChoiceRt[] = [
    { label: "Open shared Stockpile (carried resources stay with you).", action: "openStockpile" },
    { label: "Store everything you carry.", action: "chestPut", arg: "all", disabled: pw <= 0 ? "Your pack is empty" : cw >= cap ? "The chest is full" : undefined },
    { label: "Take everything.", action: "chestTake", arg: "all", disabled: cw <= 0 ? "The chest is empty" : pw >= PACK_CAP ? "Your pack is full" : undefined },
  ];
  for (const g of PACK_GOODS) if ((life.pack[g] ?? 0) > 0 && choices.length < 6) choices.push({ label: `Store your ${PACK_LABEL[g].toLowerCase()} (${life.pack[g]}).`, action: "chestPut", arg: g, disabled: cw >= cap ? "The chest is full" : undefined });
  for (const g of PACK_GOODS) if ((chest[g] ?? 0) > 0 && choices.length < 9) choices.push({ label: `Take the ${PACK_LABEL[g].toLowerCase()} (${chest[g]}).`, action: "chestTake", arg: g, disabled: pw >= PACK_CAP ? "Your pack is full" : undefined });
  const text = `${head ? head + "\n\n" : ""}Chest (${cw} / ${cap}): ${goodsText(chest)}.\nYour pack (${pw} / ${PACK_CAP}): ${goodsText(life.pack)}.`;
  furnitureTalk(p, "Chest", text, choices, at);
}

// Moves goods (all of `g`, or everything) from `from` into `to` while `to` stays under `cap` (weight). Returns the count.
function move(from: Partial<Record<PackGood, number>>, to: Partial<Record<PackGood, number>>, g: PackGood | "all", cap: number): number {
  let n = 0;
  let room = cap - chestWeight(to);
  for (const k of g === "all" ? PACK_GOODS : [g]) {
    const have = from[k] ?? 0;
    const q = Math.min(have, Math.floor((room + 1e-9) / PACK_WEIGHT[k]));
    if (q <= 0) continue;
    from[k] = have - q;
    if (!from[k]) delete from[k];
    to[k] = (to[k] ?? 0) + q;
    room -= q * PACK_WEIGHT[k];
    n += q;
  }
  return n;
}

// herolife.ts handleDialogueChoice: a bed / chest choice.
export function interiorFurnitureChoice(p: Player, action: string, arg: unknown) {
  if(encounterInteract(p))return;
  const I = p.interior;
  const v = viewFor(p);
  if (!I || !v) return closeTalk(p);
  const { map } = v.view;
  const near = (prop: string) => map.props.find((q) => (q.prop === prop || (prop === "bed" && q.prop === "bedFine")) && Math.hypot(px(q.x) - I.x, px(q.y) - I.y) / TILE_SIZE <= TALK_RANGE_TILES + 2);
  const at = (q: { x: number; y: number }): TalkInside => ({ key: I.key, x: px(q.x), y: px(q.y), anchor: { x: I.tx, y: I.ty } });
  if (action === "sleep" || action === "nap") {
    const bed = near("bed");
    if (!bed || !v.view.canSleep) return closeTalk(p);
    if (action === "nap") {
      closeTalk(p);
      setHeroResting(p, true);
      return toast(p, "You lie down in your bed (move to get up)");
    }
    if (!isNightNow() || v.view.threat > 0) return bedTalk(p, v.view.canSleep, v.view.threat, at(bed));
    closeTalk(p);
    return toast(p, sleepToDawn(p));
  }
  const chestProp = near("chest");
  if (!chestProp || !v.view.chest) return closeTalk(p);
  const g = arg === "all" || (PACK_GOODS as unknown[]).includes(arg) ? (arg as PackGood | "all") : "all";
  const chest = chests.get(I.key) ?? {};
  const life = lifeOf(p);
  let head: string;
  if (action === "chestPut") {
    const n = move(life.pack, chest, g, chestCapFor(I.templateId));
    head = n > 0 ? `You store ${n} goods.` : "Nothing fits.";
  } else {
    // Pack capacity is weight too: fill the pack up to PACK_CAP.
    const n = move(chest, life.pack, g, PACK_CAP);
    head = n > 0 ? `You take ${n} goods.` : "Nothing fits in your pack.";
  }
  if (Object.keys(chest).length > 0) chests.set(I.key, chest);
  else chests.delete(I.key);
  chestTalk(p, head, at(chestProp));
  sendView(p);
}

// ---- snapshot / saves / tests ----
export function playerInside(p: Player): { key: string; x: number; y: number } | undefined {
  const I = p.interior;
  return I ? { key: I.key, x: Math.round(I.x * 10) / 10, y: Math.round(I.y * 10) / 10 } : undefined;
}

export type InteriorChestsSave = [string, Partial<Record<PackGood, number>>][];
export function interiorChestsForSave(): InteriorChestsSave | undefined {
  const out: InteriorChestsSave = [];
  for (const [k, c] of chests) if (Object.keys(c).length > 0) out.push([k, { ...c }]);
  return out.length ? out : undefined;
}
export function restoreInteriorChests(data: unknown) {
  chests.clear();
  if (!Array.isArray(data)) return;
  for (const e of data) {
    if (!Array.isArray(e) || typeof e[0] !== "string" || !e[1] || typeof e[1] !== "object") continue;
    const c: Partial<Record<PackGood, number>> = {};
    for (const g of PACK_GOODS) {
      const n = Math.floor(Number((e[1] as Record<string, unknown>)[g]));
      if (Number.isFinite(n) && n > 0) c[g] = n;
    }
    if (Object.keys(c).length) chests.set(e[0], c);
  }
}
export function resetInteriors() {
  resetFurniture();homeDesigns.clear();homeSent.clear();
  chests.clear();
  rooms.clear();
}

// Test hook: force one layout everywhere (null / out of range: the deterministic pick).
export function setForcedInteriorVariant(v: unknown) {
  forcedVariant = typeof v === "number" && Number.isInteger(v) && v >= 0 && v < INTERIOR_VARIANTS ? v : null;
}

export function interiorDebug(p: Player) {
  const v = viewFor(p);
  const I = p.interior;
  const r = I ? rooms.get(roomKeyOf(I)) : undefined;
  return {
    inside: I ? { key: I.key, x: I.x, y: I.y, templateId: I.templateId, level: I.level, variant: I.variant, storey: I.storey } : null,
    view: v?.view ?? null,
    live: r ? liveOf(r) : [],
    chests: Array.from(chests.entries()),
    templateErrors: validateAllInteriorTemplates(),
  };
}

// Cosmetic housing edits are authoritative, owned, bounded, persisted and never block exits.
export function handleInteriorEdit(p:Player,m:{op:string;base?:string;floor?:string;wall?:string;prop?:string;x?:number;y?:number;facing?:string}){
 const I=p.interior,v=viewFor(p);if(!I||p.dead||!v?.view.editable)return;
 if(v.view.threat){toast(p,'Wait until the danger outside has passed before decorating');return;}
 let d:HomeDesign={...(homeDesigns.get(I.key)??{base:['cottage','farmhouse','townhouse','hill-burrow'][(I.tx*7+I.ty*11)%4]})};
 if(m.op==='base'){if(!PLAYER_BASES.some(b=>b.id===m.base))return;d={base:m.base!};}
 else if(m.op==='floor'){if(!['wood','stone','dirt'].includes(m.floor??''))return;d.floor=m.floor as HomeDesign['floor'];}
 else if(m.op==='wall'){if(!['wood','stone'].includes(m.wall??''))return;d.wall=m.wall as HomeDesign['wall'];}
 else if(m.op==='place'||m.op==='remove'){
  const map=playerBaseMap(d,I.level),x=m.x!,y=m.y!;if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||y<1||x>=map.w-1||y>=map.h-1||map.cells[y*map.w+x]!=='.'||(x===map.spawn.x&&y===map.spawn.y))return;
  d.props=map.props.filter(q=>q.x!==x||q.y!==y);
  if(m.op==='place'){if(!HOME_PROPS.includes(m.prop as any)||!['n','e','s','w'].includes(m.facing??''))return;d.props.push({prop:m.prop as any,x,y,facing:m.facing as any});}
  if(!d.props.some(q=>q.prop==='chest')&&Object.keys(chests.get(I.key)??{}).length){toast(p,'Empty the house chest before removing the last chest');return;}
 }else return;
 const map=playerBaseMap(d,I.level);if(!validHomeMap(map)){toast(p,'Keep the doorway, walking routes and furniture accessible');return;}
 homeDesigns.set(I.key,d);homeSent.clear();
 const homes:[number,string][]=[...homeDesigns].map(([key,d])=>{const [x,y]=key.split(',').map(Number);return[tileIndex(x,y),d.base]});for(const other of players.values())sendTo(other,{type:'homeDesigns',homes});
 for(const k of rooms.keys())if(k.startsWith(I.key+':'))rooms.delete(k);
 for(const other of players.values())if(other.interior?.key===I.key){const x=Math.floor(other.interior.x/TILE_SIZE),y=Math.floor(other.interior.y/TILE_SIZE);if(m.op==='base'||x<0||y<0||x>=map.w||y>=map.h||interiorSolidGrid(map)[y*map.w+x]){other.interior.x=px(map.spawn.x);other.interior.y=px(map.spawn.y);}other.interior.storey=0;sendView(other,true);}
}
function objectContext(p:Player,v:NonNullable<ReturnType<typeof viewFor>>){const own='kind'in v.acc&&v.acc.kind==='own';return{map:v.view.map,own:own&&!encounterKind(p.interior!.tile),hostile:!!encounterKind(p.interior!.tile),siteId:'site'in v.acc?v.acc.site.id:undefined,refresh:()=>refreshInteriorView(p.interior!.key),work:()=>{if(!interiorWorkstation(p))return false;handlePersonalCraft(p);return true;}};}
export function handleInteriorObjectChoice(p:Player,raw:string){let data:{x:number;y:number;op:string;arg?:string};try{data=JSON.parse(raw);}catch{return;}if(!Number.isInteger(data.x)||!Number.isInteger(data.y)||typeof data.op!=='string')return;const v=viewFor(p);if(!v||p.dead)return;const q=v.view.map.props.find(q=>q.x===data.x&&q.y===data.y);if(q)useFurniture(p,q,objectContext(p,v),data.op,typeof data.arg==='string'?data.arg:'');}
export function handleInteriorUse(p:Player,x:number,y:number){
 const fv=p.interior?viewFor(p):null;if(fv&&!p.dead&&Number.isInteger(x)&&Number.isInteger(y)&&!fv.view.exploration?.objects.some(o=>o.x===x&&o.y===y)){const q=fv.view.map.props.find(q=>q.x===x&&q.y===y);if(q&&useFurniture(p,q,objectContext(p,fv)))return;}
 if(p.interior&&encounterKind(p.interior.tile)){if(Number.isInteger(x)&&Number.isInteger(y))encounterInteract(p,x,y);return;}
 const I=p.interior,v=viewFor(p);if(!I||!v||!Number.isInteger(x)||!Number.isInteger(y))return;
 if(Math.hypot(px(x)-I.x,px(y)-I.y)>INTERIOR_USE_RANGE_TILES*TILE_SIZE){toast(p,'Walk closer to use that furniture');return;}
 if(v.view.exploration?.objects.some(o=>o.x===x&&o.y===y)){encounterInteract(p,x,y);return;}
 const q=v.view.map.props.find(q=>q.x===x&&q.y===y);if(!q)return;
 const at={key:I.key,x:px(x),y:px(y),anchor:{x:I.tx,y:I.ty}};
 if(q.prop==='chest'){if(v.view.chest)chestTalk(p,'',at);else toast(p,'This chest is not yours');}
 else if(WORK_PROPS.has(q.prop)&&interiorWorkstation(p))handlePersonalCraft(p);
 else if(q.prop==='bed'||q.prop==='bedFine')bedTalk(p,v.view.canSleep,v.view.threat,at);
}
export const homeDesignsForSave=()=>Array.from(homeDesigns.entries());
export function restoreHomeDesigns(data:unknown){
 homeDesigns.clear();homeSent.clear();if(!Array.isArray(data))return;
 for(const e of data){if(!Array.isArray(e)||typeof e[0]!=='string'||!/^\d+,\d+$/.test(e[0])||!e[1]||!PLAYER_BASES.some(b=>b.id===e[1].base))continue;
 const d=e[1] as HomeDesign;if(d.floor&&!['wood','stone','dirt'].includes(d.floor)||d.wall&&!['wood','stone'].includes(d.wall))continue;if(d.props&&(!Array.isArray(d.props)||d.props.some(p=>!p||!HOME_PROPS.includes(p.prop)&&p.prop!=='throne'||!Number.isInteger(p.x)||!Number.isInteger(p.y))))continue;
 const map=playerBaseMap(d,3);if(map.props.some(p=>p.x<1||p.y<1||p.x>=map.w-1||p.y>=map.h-1||map.cells[p.y*map.w+p.x]!=='.'))continue;if(validHomeMap(map))homeDesigns.set(e[0],d);
 }
}

function ownWorldChest(p:Player,x:number,y:number){if(!inBounds(x,y)||ownerAt(tileIndex(x,y))!==0||clanIdAt(x,y)!==(p.clan??0))return false;const tile=state.tiles[tileIndex(x,y)];return tile===TileType.Chest||(tile===TileType.PropCrate&&lifeOf(p).builds.some(b=>b.kind==='chest'&&b.x===x&&b.y===y));}
export function tryWorldChest(p:Player,tx:unknown,ty:unknown){
 const x=Math.floor(p.x/TILE_SIZE),y=Math.floor(p.y/TILE_SIZE),candidates:{x:number;y:number;d:number}[]=[];
 for(let yy=y-2;yy<=y+2;yy++)for(let xx=x-2;xx<=x+2;xx++){const d=Math.hypot(px(xx)-p.x,px(yy)-p.y);if(d<=INTERIOR_USE_RANGE_TILES*TILE_SIZE&&ownWorldChest(p,xx,yy))candidates.push({x:xx,y:yy,d});}
 candidates.sort((a,b)=>(a.x===tx&&a.y===ty?-1:b.x===tx&&b.y===ty?1:a.d-b.d));const q=candidates[0];if(!q)return false;
 worldChestTalk(p,{world:true,key:`world:${q.x},${q.y}`,x:px(q.x),y:px(q.y),anchor:q});return true;
}
function worldChestTalk(p:Player,at:TalkInside){const c=chests.get(at.key)??{},life=lifeOf(p);const choices:ChoiceRt[]=[{label:'Store everything you carry',action:'worldChestPut',arg:'all',disabled:packWeight(life)<=0?'Your pack is empty':undefined},{label:'Take everything',action:'worldChestTake',arg:'all',disabled:chestWeight(c)<=0?'The chest is empty':undefined}];for(const g of PACK_GOODS){if((life.pack[g]??0)>0)choices.push({label:`Store ${PACK_LABEL[g]}`,action:'worldChestPut',arg:g});if((c[g]??0)>0)choices.push({label:`Take ${PACK_LABEL[g]}`,action:'worldChestTake',arg:g});}furnitureTalk(p,'Storage chest',`Chest (${chestWeight(c)} / ${INTERIOR_CHEST_CAP}): ${goodsText(c)}. Your pack: ${goodsText(life.pack)}.`,choices,at);}
export function worldChestChoice(p:Player,at:TalkInside,action:string,arg:unknown){if(p.dead||p.interior||!ownWorldChest(p,at.anchor.x,at.anchor.y)||Math.hypot(at.x-p.x,at.y-p.y)>INTERIOR_USE_RANGE_TILES*TILE_SIZE)return closeTalk(p);const c=chests.get(at.key)??{},life=lifeOf(p);if(arg!=='all'&&!PACK_GOODS.includes(arg as PackGood))return;const good=arg as PackGood|'all';if(action==='worldChestPut')move(life.pack,c,good,INTERIOR_CHEST_CAP);else if(action==='worldChestTake')move(c,life.pack,good,PACK_CAP);chests.set(at.key,c);worldChestTalk(p,at);}

// Deep mines: the ore face of a coal / copper / tin mine is its workstation (the hero digs there).
const WORK_PROPS=new Set(['anvil','forge','oven','workbench','counter','barrel','oreFace']);
function ownInteriorNear(p:Player,props:Set<string>){
 const I=p.interior;if(!I||p.dead||encounterKind(I.tile)||state.tiles[tileIndex(I.tx,I.ty)]!==I.tile)return false;
 const acc=accessFor(p,I.tx,I.ty,I.tile as TileType);
 if(!('kind' in acc)||acc.kind!=='own')return false;
 return mapOf(I).map.props.some(q=>props.has(q.prop)&&Math.hypot(px(q.x)-I.x,px(q.y)-I.y)<=INTERIOR_USE_RANGE_TILES*TILE_SIZE);
}
export function ownInterior(p:Player):boolean{
 const I=p.interior;if(!I||p.dead||encounterKind(I.tile)||state.tiles[tileIndex(I.tx,I.ty)]!==I.tile)return false;
 const acc=accessFor(p,I.tx,I.ty,I.tile as TileType);return 'kind' in acc&&acc.kind==='own';
}
export function sharedStockAccess(p:Player):boolean{return ownInteriorNear(p,new Set(['chest']));}
export function interiorWorkstation(p:Player){
 const I=p.interior;
 if(!I||p.dead||encounterKind(I.tile)||!STATION_SKILL[I.tile as TileType]||state.tiles[tileIndex(I.tx,I.ty)]!==I.tile)return null;const acc=accessFor(p,I.tx,I.ty,I.tile as TileType);if(!('kind'in acc))return null;return mapOf(I).map.props.some(q=>WORK_PROPS.has(q.prop)&&Math.hypot(px(q.x)-I.x,px(q.y)-I.y)<=INTERIOR_USE_RANGE_TILES*TILE_SIZE)?{tx:I.tx,ty:I.ty,tile:I.tile as TileType}:null;
}

// World generation assigns existing house styles through the persisted home-design system.
export function seedHomeDesign(x:number,y:number,base:string) {
 if(!PLAYER_BASES.some(b=>b.id===base))return;
 homeDesigns.set(`${x},${y}`,{base});homeSent.clear();
}
