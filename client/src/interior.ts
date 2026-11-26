import { drawPlayerCombat, drawDuelCue } from "./playerCombat";
import type { CombatLive } from "@colony/shared/combatRules";
import {EXPLORATION_REACH} from "@colony/shared/adventure";
import {loadSpecialArt,specialTexture,specialAnchor,specialScale} from './specialCastArt';
import {SPECIAL_BY_ID} from '@colony/shared/specialCast';
import {interiorMonsterScale} from '@colony/shared/hostileScatter';
import {RUIN_FLOOR_URL,RUIN_WALL_ART,RUIN_TITLES,ruinFloorUrl,ruinWallPieces,ruinDoorFrames,ruinPropArt,ruinScenery,ruinEntrance} from '@colony/shared/ruinArt';
import {caveWallPieces} from '@colony/shared/caveWalls';
import {caveScenery} from '@colony/shared/caveScenery';
import {stoneFloorCell,cliffStripCell,caveRailHalf} from './caveTextures';
import {undergroundFloorUrl,CAVE_WALL_ART,undergroundPropUrl,undergroundPropSize,undergroundEntrance,undergroundOreUrl} from '@colony/shared/undergroundArt';
import {npcVariantFrame} from "./npcVariants";
import {PLAYER_BASES,HOME_PROPS} from "@colony/shared/playerBases";
// interior.ts: Stardew phase 5c (2026-11-09; server/src/interiors.ts, shared/src/interiors.ts). The building interior
// view: while the server says the hero is inside (message `interior` with the map, NPCs, chest, threat), the world
// layer is hidden and this layer draws the small room instead: floor tiles (the wired wood / stone floor art, a dirt
// stand-in), 3/4 walls and the exit mat drawn in code, furniture from the wired furniture / extra atlas art (a
// stand-in block where none fits), the NPCs and the hero (its interior x / y from the snapshot `inside`), a warm
// lighting vignette and a fade. The camera follows the hero (a room smaller than the screen is centred). HUD: the
// room's title, "Raiders near the door" when hostiles are close, the exit hint near the mat. Esc near the mat leaves.
// The whole-room interior paintings (art-sources builder/interior_room_*) do not fit the template grids: not used.
// Gap closure G5: NPCs move by `interiorNpcs` (eased), walk with their kind's walk frames, work with its action frames
// (or a stand-in tool swing), bob when idle, sit lower on a chair, lie across a bed asleep ("z"), face where they go
// and show a speech bubble when they greet. Stairs ("U" / "D") are drawn in code; upstairs has no exit hint.
import { loadTexture } from "./atlas";
import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { TileType, SPELLS, type SpellId, type InteriorSpellEffect, type PlayerSnapshot } from "@colony/shared/protocol";
import {
  INTERIOR_BOB_MS, INTERIOR_BOB_PX, INTERIOR_ESC_EXIT_TILES, INTERIOR_FADE_MS, INTERIOR_TILE_PX, INTERIOR_VIGNETTE_ALPHA,
  INTERIOR_WALK_FRAME_MS, INTERIOR_WORK_MS, INTERIOR_ZOOM, type InteriorMap, type InteriorNpcLive, type InteriorProp, type InteriorView,
} from "@colony/shared/interiors";
import type { StructureTextures } from "./structureArt";
import { MINE_STATUS_LABEL, type MineMobLive, type MineResource } from "@colony/shared/mines";
import { rigTextureScale } from "./heroRig";
import { directionalFrame, autumnFrame, loadAutumnSheet } from "./autumnAnimations";

const T = INTERIOR_TILE_PX;
const EXTRA = "/sprites/structure/extra/";
// Furniture art: a wired furniture TileType (structureArt.ts, stand-in when missing) or an extra atlas piece.
const PROP_TILE: Partial<Record<InteriorProp, TileType>> = {
  bed: TileType.Bed, chest: TileType.Chest, table: TileType.Table, chair: TileType.Chair, lamp: TileType.Lamp, rug: TileType.Rug,
  shelf: TileType.Shelf, statue: TileType.Statue, weaponRack: TileType.WeaponRack, workbench: TileType.Workbench,
};
const PROP_EXTRA: Partial<Record<InteriorProp, string>> = {
 adventureNote:"/sprites/adventure/note.png",adventureKey:"/sprites/adventure/keys.png",adventurePot:"/sprites/adventure/pot.png",adventureCache:"/sprites/regions-v4/brambles.png",adventureGate:"/sprites/structure/extra/door_wood_arched_closed.png",
 skullBones:'/sprites/regions-v4/skulls.png',fallenSkeleton:'/sprites/regions-v4/skeleton.png',cobweb:'/sprites/regions-v4/web.png',overgrowth:'/sprites/regions-v4/brambles.png',banditTower:'/sprites/regions-v4/watchtower.png',
 campTent:'/sprites/regions-v2/tent.png',prisonCage:'/sprites/regions-v2/cage.png',rockBlock:'/sprites/regions-v3/rock-block.png',ruinRubble:'/sprites/ruinRubble.png',
  bedFine: "bed_blue_double", hearth: "fireplace_lit_b", wardrobe: "wardrobe", altar: "altar_candles", pew: "bench", oven: "oven_round",
  barrel: "barrel", crates: "crates_barrels_stack", sacks: "sacks_pile", hay: "hay_pile_crate", armourStand: "armor_stand",
  banner: "banner_red", forge: "forge", counter: "counter", anvil: "anvil", throne: "throne", stall: "stall_market_red", candelabra: "candelabra_b",
  // Layered mines: the way down to the next level is drawn with the Mine's own world sprite (stand-in, SPRITES.md).
  mineShaft: "/sprites/ironMine.png",
};
// Stand-in colours (counter, anvil, high seat and any art that fails to load).
const PROP_COLOR: Partial<Record<InteriorProp, number>> = {
  // Deep mines: drawn in code (SPRITES.md #111): the ore face (flecked in its ore's colour) and the timber prop.
  oreFace: 0x4a443e, timberProp: 0x7a5230, mineShaft: 0x2a2018,
  counter: 0x7a4e26, anvil: 0x4a4d52, throne: 0x8a3a2a, hearth: 0x9a5030, altar: 0xd8d0b8, pew: 0x7a5230, oven: 0xa0624a,
  hay: 0xd8b84a, forge: 0x3a3a3e, stall: 0xa04040, banner: 0xa02828, barrel: 0x7a4f28, crates: 0x9a6b3a, sacks: 0xc8b088,
};
// Scale: the hero / NPC body is HUMAN_CHAR_PX (25 px) tall, so a tile (32 px) is about 2.2 m. Furniture is sized by its
// DRAWN pixels (transparent padding ignored) to these heights, so a chair comes up to a person's thigh, a table to the
// waist, a wardrobe over their head; whatever the art's canvas size. Width is capped at about a tile (long pieces).
const PROP_HEIGHT_PX: Partial<Record<InteriorProp, number>> = {
 adventureNote:12,adventureKey:10,adventurePot:15,adventureCache:14,adventureGate:45,
  mineralNode:26,stalagmite:30,
  skullBones:14,fallenSkeleton:14,cobweb:22,overgrowth:22,banditTower:54,
  campTent:48,prisonCage:40,rockBlock:40,ruinRubble:16,
  chair: 18, pew: 16, table: 20, bed: 31, bedFine: 31, chest: 16, shelf: 30, wardrobe: 32, hearth: 28, lamp: 22, statue: 30,
  weaponRack: 24, workbench: 16, altar: 18, oven: 22, barrel: 14, crates: 14, sacks: 11, hay: 13, armourStand: 26, banner: 28,
  forge: 24, stall: 26, candelabra: 20, counter: 14, anvil: 10, throne: 22, oreFace: 30, timberProp: 30, mineShaft: 30,
};
// Layered mines: a Mine's ore face flecks by level (copper, iron, gold).
const LAYER_FLECK = [0xe0843a, 0xa0583a, 0xf0c830];
// Deep mines: the ore face's flecks by mine tile (Quarry, Iron, Coal, Copper, Tin Mine).
const ORE_FLECK: Record<number, number> = {
  [TileType.RockMinePost]: 0xb8b2a8, [TileType.IronMinePost]: 0xa0583a, [TileType.CoalMine]: 0x141216,
  [TileType.CopperMine]: 0xe0843a, [TileType.TinMine]: 0xd8e4ee,
  // Industry extras: Lime Quarry, Gold Mine, Lead Mine.
  [TileType.LimeQuarry]: 0xf2eedc, [TileType.GoldMine]: 0xf0c830, [TileType.LeadMine]: 0x6a7080,
};
const PROP_DEFAULT_HEIGHT_PX = 18;
const opaqueBoxes = new WeakMap<Texture, { x: number; y: number; w: number; h: number }>();
// Bounding box of the texture's visible pixels (falls back to the whole frame).
export function opaqueBox(tex: Texture): { x: number; y: number; w: number; h: number } {
  const hit = opaqueBoxes.get(tex);
  if (hit) return hit;
  let box = { x: 0, y: 0, w: tex.width, h: tex.height };
  try {
    const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
    const w = Math.round(tex.frame.width), h = Math.round(tex.frame.height);
    if (src && w && h) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(src, tex.frame.x, tex.frame.y, w, h, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let l = w, r = -1, t = h, b = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 20) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
      if (r >= l && b >= t) box = { x: l, y: t, w: r - l + 1, h: b - t + 1 };
    }
  } catch { /* keep the whole frame */ }
  opaqueBoxes.set(tex, box);
  return box;
}
const FLOOR_COLOR = { wood: 0x8f5f30, stone: 0x80838a, dirt: 0x7a6145 };
const WALL = { wood: { top: 0x6e4524, face: 0x553319, line: 0x3a2210 }, stone: { top: 0x8d8f94, face: 0x6a6c71, line: 0x45474b } };

export interface InteriorDeps {
  app: { stage: Container; screen: { width: number; height: number }; ticker: { add: (fn: () => void) => void } };
  worldLayer: Container;
  structure: StructureTextures;
  playerTexture: Texture;
  heroTexture?: (id: string, moving: boolean, distance?: number) => Texture | undefined;
  playerHeight: number;
  // Scale that draws a human frame's body at the world's body height (alpha-measured, like the world sprites); falls back to playerHeight / frame height.
  humanScale?: (tex: Texture) => number;
  npcTexture: (kind: string) => Texture | undefined;
  // Gap closure G5: the kind's walk / action frames and their scale (missing: the still texture, stand-in motion).
  npcAnim?: (kind: string) => { walk: Texture[]; action: Texture[]; scale: number } | undefined;
  npcHeight: number;
  // Deep mines: a cave monster's art (idle texture and scale, walk / attack frames and their scale, stand-in tint).
  mobArt?: (kind: string) => { idle: Texture; scale: number; walk: Texture[]; action: Texture[]; walkScale: number; tint?: number } | undefined;
  send: (msg: object) => void;
  spellAim?:()=>{slot:number;spell:SpellId}|null;
  castSpell?:(target:{targetId?:string;x?:number;y?:number})=>void;
  cancelSpell?:()=>void;
  combatAim?:(x:number,y:number)=>void;
  notice?:(text:string)=>void;
  myId: () => string | null;
  // Entering / leaving (main.ts: weather, strategy toggle, selection).
  onChange?: (inside: boolean) => void;
}

export interface InteriorUi {
  active: () => boolean;
  useHighlighted: () => boolean;
  onSpell:(effect:InteriorSpellEffect)=>void;
  onMessage: (view: InteriorView | null) => void;
  // Gap closure G5: message `interiorNpcs`.
  onNpcs: (key: string, storey: number, npcs: InteriorNpcLive[]) => void;
  // Deep mines: message `interiorMobs`.
  onMobs: (key: string, mobs: MineMobLive[]) => void;
  onPlayers: (players: PlayerSnapshot[]) => void;
  reset: () => void;
}

function vignetteTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(128, 128, 40, 128, 128, 180);
  r.addColorStop(0, "rgba(255, 190, 110, 0.06)");
  r.addColorStop(0.55, "rgba(30, 16, 6, 0.25)");
  r.addColorStop(1, "rgba(8, 4, 2, 1)");
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  return Texture.from(c);
}

export function setupInterior(deps: InteriorDeps): InteriorUi {
  const layer = new Container();
  layer.visible = false;
  const room = new Container();
  const spellFx:{effect:InteriorSpellEffect;started:number;g:Graphics}[]=[];
  room.sortableChildren = true;
  const vignette = new Sprite(vignetteTexture());
  vignette.alpha = INTERIOR_VIGNETTE_ALPHA;
  const fade = new Graphics();
  layer.addChild(room, vignette, fade);
  layer.eventMode = "none";
  deps.app.stage.addChildAt(layer, deps.app.stage.getChildIndex(deps.worldLayer) + 1);

  // HUD: the title, the threat warning, the exit hint.
  const style = document.createElement("style");
  style.textContent = `
#int-hud { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; flex-direction: column;
  align-items: center; gap: 4px; pointer-events: none; font-family: var(--font-serif, serif); }
#int-hud[hidden] { display: none; }
#int-title { padding: 2px 12px; border-radius: 3px; background: rgba(30, 18, 8, .72); color: #f3e3c0; font-size: 14px; }
#int-threat { padding: 3px 12px; border-radius: 3px; background: rgba(150, 20, 20, .88); color: #fff; font-size: 13px; font-weight: bold; }
#int-threat[hidden], #int-exit[hidden] { display: none; }
#int-exit { padding: 2px 10px; border-radius: 3px; background: rgba(30, 18, 8, .6); color: #f3e3c0; font-size: 12px; }
#int-mine { padding: 3px 12px; border-radius: 3px; background: rgba(40, 28, 20, .85); color: #f3e3c0; font-size: 12.5px; max-width: 520px; text-align: center; }
#int-mine.infested { background: rgba(120, 30, 20, .9); color: #fff; font-weight: bold; }
#int-mine[hidden] { display: none; }`;
  document.head.appendChild(style);
  const hud = document.createElement("div");
  hud.id = "int-hud";
  hud.hidden = true;
  const titleEl = document.createElement("div");
  titleEl.id = "int-title";
  const threatEl = document.createElement("div");
  threatEl.id = "int-threat";
  threatEl.hidden = true;
  const exitEl = document.createElement("div");
  exitEl.id = "int-exit";
  exitEl.hidden = true;
  exitEl.textContent = "Walk onto the mat or press Esc to leave";
  // Deep mines: the mine's status (infested: monsters left, Space to fight) and hazards.
  const mineEl = document.createElement("div");
  mineEl.id = "int-mine";
  mineEl.hidden = true;
  hud.append(titleEl, threatEl, mineEl, exitEl);
  document.body.appendChild(hud);

  // Extra atlas art loads on demand; a missing file keeps the stand-in.
  const extra = new Map<string, Texture | null>();
  let rebuildPending = false;
  function extraTexture(name: string): Texture | undefined {
    const url = name.startsWith("/")?name:`${EXTRA}${name}.png`;
    if (extra.has(url)) return extra.get(url) ?? undefined;
    extra.set(url, null);
    loadTexture(url)
      .then((t) => {
        if (!t) return;
        t.source.scaleMode = "nearest";
        extra.set(url, t);
        rebuildPending = true;
      })
      .catch(() => undefined);
    return undefined;
  }

  let view: InteriorView | null = null;
  let builtKey = "";
  let decorating=false;
  let openChest:{x:number;y:number;until:number}|null=null;
  let hover:{x:number;y:number}|null=null;
  const interactionOutline=new Graphics();interactionOutline.zIndex=1e7;
  const interactionHint=document.createElement('div');interactionHint.id='interior-use-hint';interactionHint.hidden=true;document.body.append(interactionHint);
  const hintStyle=document.createElement('style');hintStyle.textContent='#interior-use-hint{position:fixed;left:50%;bottom:115px;transform:translateX(-50%);max-width:calc(100vw - 30px);padding:9px 14px;background:#eadbb7ee;color:#352916;border:1px solid #967c4f;border-radius:4px;z-index:18;font:14px Georgia;pointer-events:none;text-align:center}#interior-use-hint[hidden]{display:none}#hl-dialogue{max-height:min(65vh,620px);overflow-y:auto}#hl-choices button{padding:7px 9px;min-height:31px}';document.head.append(hintStyle);
  window.addEventListener('pointermove',e=>{if(!view||!(e.target instanceof HTMLCanvasElement)){hover=null;return;}const p=localPoint(e);hover={x:Math.floor(p.x/T),y:Math.floor(p.y/T)};if(!decorating)deps.combatAim?.(p.x,p.y);});
  const editor=document.createElement('section');editor.id='home-editor';editor.hidden=true;
  editor.innerHTML=`<h3>Make yourself at home</h3><label>Base style <select id="home-base">${PLAYER_BASES.map(b=>`<option value="${b.id}">${b.label}</option>`).join('')}</select></label><button id="home-base-apply">Use this base</button><label>Floor <select id="home-floor"><option value="wood">Wood planks</option><option value="stone">Stone tiles</option><option value="dirt">Packed earth</option></select></label><label>Walls <select id="home-wall"><option value="wood">Timber</option><option value="stone">Stone</option></select></label><label>Furnishing <select id="home-prop"><option value="remove">Remove furnishing</option>${HOME_PROPS.map(p=>`<option value="${p}">${p.replace(/([A-Z])/g,' $1')}</option>`).join('')}</select></label><label>Facing <select id="home-facing"><option value="n">North</option><option value="e">East</option><option value="s" selected>South</option><option value="w">West</option></select></label><img id="home-preview" alt="Selected furnishing"/><p>Click a floor tile to place or remove furniture. Paths and the doorway must stay clear. Furniture changes are free.</p><button id="home-done">Done decorating</button>`;
  document.body.append(editor);
  const decorButton=document.createElement('button');decorButton.id='home-decorate';decorButton.textContent='Decorate home';decorButton.style.pointerEvents='auto';hud.append(decorButton);
  const select=(id:string)=>editor.querySelector<HTMLSelectElement>('#home-'+id)!;
  const edit=(m:object)=>deps.send({type:'interiorEdit',...m});
  const closeEditor=()=>{decorating=false;editor.hidden=true;};
  decorButton.onclick=()=>{decorating=!decorating;editor.hidden=!decorating;if(view){select('base').value=view.homeDesign?.base??'cottage';select('floor').value=view.map.floor;select('wall').value=view.map.wall;}};
  editor.querySelector<HTMLButtonElement>('#home-done')!.onclick=closeEditor;
  editor.querySelector<HTMLButtonElement>('#home-base-apply')!.onclick=()=>{if(window.confirm('Use this base and its furnished layout? Stored chest contents will be kept.'))edit({op:'base',base:select('base').value});};
  select('floor').onchange=()=>edit({op:'floor',floor:select('floor').value});select('wall').onchange=()=>edit({op:'wall',wall:select('wall').value});
  const preview=()=>{const p=select('prop').value,img=editor.querySelector<HTMLImageElement>('#home-preview')!;img.hidden=!['bed','chair','chest','table','hearth','shelf','wardrobe'].includes(p);if(!img.hidden)img.src=`/sprites/interiors-v2/${p}_${select('facing').value}.png`;};select('prop').onchange=preview;select('facing').onchange=preview;preview();
  const localPoint=(e:PointerEvent)=>{const rect=(e.target as HTMLCanvasElement).getBoundingClientRect();return room.toLocal({x:(e.clientX-rect.left)*deps.app.screen.width/rect.width,y:(e.clientY-rect.top)*deps.app.screen.height/rect.height});};
  window.addEventListener('pointerdown',e=>{
    if(!view||!(e.target instanceof HTMLCanvasElement))return;
    const point=localPoint(e),x=Math.floor(point.x/T),y=Math.floor(point.y/T),aim=deps.spellAim?.();
    if(aim&&!decorating){
      if(e.button!==0&&e.button!==2)return;e.preventDefault();e.stopImmediatePropagation();
      if(e.button===2){deps.cancelSpell?.();return;}
      const def=SPELLS[aim.spell];
      if(def.targeting==='enemy'){
        const mob=mobsLive?.mobs.filter(m=>m.hp>0&&Math.hypot((m.x+.5)*T-point.x,(m.y+.25)*T-point.y)<T*.9).sort((a,b)=>Math.hypot((a.x+.5)*T-point.x,(a.y+.25)*T-point.y)-Math.hypot((b.x+.5)*T-point.x,(b.y+.25)*T-point.y))[0];
        if(mob)deps.castSpell?.({targetId:mob.id});else deps.notice?.(`${def.name}: click an enemy in this room. Right click cancels.`);
      }else if(def.targeting==='ally'){
        const ally=[...others].filter(([,s])=>Math.hypot(s.x-point.x,s.y-point.y)<T).sort(([,a],[,b])=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];deps.castSpell?.(ally?{targetId:ally[0]}:{});
      }else deps.castSpell?.({x:point.x,y:point.y});
      return;
    }
    if(e.button!==0)return;
    if(decorating){e.preventDefault();e.stopImmediatePropagation();const prop=select('prop').value;edit({op:prop==='remove'?'remove':'place',prop,x,y,facing:select('facing').value});return;}
    const object=view.exploration?.objects.some(o=>o.x===x&&o.y===y&&(!o.secret||Math.hypot((x+.5)*T-target.x,(y+.5)*T-target.y)<T*1.8))||view.furniture?.some(o=>o.x===x&&o.y===y&&!o.cleared);
    if(object){e.preventDefault();e.stopImmediatePropagation();deps.send({type:'interiorUse',x,y});return;}
    const npc=[...npcViews].filter(([,n])=>Math.hypot((n.sx+.5)*T-point.x,(n.sy+.25)*T-point.y)<T*.55).sort(([,a],[,b])=>Math.hypot((a.sx+.5)*T-point.x,(a.sy+.25)*T-point.y)-Math.hypot((b.sx+.5)*T-point.x,(b.sy+.25)*T-point.y))[0];
    if(npc){e.preventDefault();e.stopImmediatePropagation();deps.send({type:'interiorTalk',id:npc[0]});return;}
    if(view.map.props.some(p=>p.x===x&&p.y===y&&['chest','bed','bedFine'].includes(p.prop))){e.preventDefault();e.stopImmediatePropagation();openChest={x,y,until:performance.now()+5000};rebuildPending=true;window.setTimeout(()=>{openChest=null;rebuildPending=true;},5000);deps.send({type:'interiorUse',x,y});}
  },true);
  const homeStyle=document.createElement('style');homeStyle.textContent=`#home-editor{position:fixed;right:18px;top:140px;width:240px;max-height:75vh;overflow:auto;padding:18px;background:#242c26f5;color:#eee2c6;border:1px solid #a48c59;border-radius:10px;z-index:40;font:14px Georgia}#home-editor[hidden]{display:none}#home-editor label{display:block;margin:12px 0}#home-editor select,#home-editor button{display:block;box-sizing:border-box;width:100%;padding:8px;margin-top:5px;background:#3c4737;color:#fff0cf;border:1px solid #8a7954;border-radius:5px}#home-preview{width:52px;height:52px;object-fit:contain;image-rendering:pixelated}#home-editor p{font-size:12px;line-height:1.5;color:#c1c4ae}#home-decorate{padding:7px 12px;background:#344733;color:#f4e3bc;border:1px solid #b09562;border-radius:5px}#home-decorate[hidden]{display:none}`;homeStyle.textContent+=`body.interior-mode #next-bar,body.interior-mode #event-feed,body.interior-mode #goal-tracker,body.interior-mode #economy-panel,body.interior-mode #economy-panel-toggle,body.interior-mode #build-panel,body.interior-mode #build-panel-toggle,body.interior-mode #minimap-frame,body.interior-mode #hero-hotbar{display:none!important}body.interior-mode.interior-stockpile #economy-panel:not(.collapsed){display:block!important}body.interior-mode #int-hud{top:100px}body.interior-mode #player-bar{top:58px!important}`;document.head.append(homeStyle);

  const hero = new Sprite(deps.playerTexture);
  hero.anchor.set(0.5, 0.85);
  const heroK = (t: Texture) => deps.humanScale?.(t) ?? deps.playerHeight / t.height;
  hero.scale.set(heroK(deps.playerTexture));
  const others = new Map<string, Sprite>();
  let target = { x: 0, y: 0 };
  let shown = { x: NaN, y: NaN };
  let fadeT = 0;

  // Gap closure G5: the NPCs drawn (by id): body, name, bubble, eased position, the last live state.
  interface NpcView {
    specialId?:string;
    body: Container;
    label: Text;
    bubble: Container;
    bubbleText: Text;
    zzz: Text;
    anim?: { walk: Texture[]; action: Texture[]; scale: number };
    variant?:boolean;
    still?: Texture;
    k: number;
    right: boolean;
    sx: number;
    sy: number;
    live: InteriorNpcLive;
    phase: number;
  }
  const npcViews = new Map<string, NpcView>();
  // Deep mines: the mine's monsters drawn (by id): body, hp bar, "z z" asleep, eased position, a red flash when hit.
  type MobArt = NonNullable<ReturnType<NonNullable<InteriorDeps["mobArt"]>>>;
  interface MobView {
    cue:Graphics;
    body: Sprite | Graphics;
    bar: Graphics;
    label:Text;
    zzz: Text;
    art?: MobArt;
    sx: number;
    sy: number;
    live: MineMobLive;
    lastHp: number;
    flashUntil: number;
    phase: number;
  }
  const mobViews = new Map<string, MobView>();
  let mobsLive: { key: string; mobs: MineMobLive[] } | null = null;
  // The hero's swing in a mine (Space): a short slash arc beside the hero.
  const slash = new Graphics();
  slash.zIndex = 1e6 - 1;
  let heroCombat:CombatLive|undefined;
  let pendingLive: { key: string; storey: number; npcs: InteriorNpcLive[] } | null = null;

  function propSprite(prop: InteriorProp, x: number, y: number, facing="s", ore?: string): Container {
    if (prop === "stairsUp" || prop === "stairsDown") {
      const texture = autumnFrame("furniture-stations", 5, prop === "stairsUp" ? 2 : 3);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.width = T; sprite.height = T;
        sprite.position.set(x * T, y * T); sprite.zIndex = -1;
        return sprite;
      }
      // Stand-in stairs (SPRITES.md): steps rising toward the back wall (up), or a dark stairwell (down).
      const g = new Graphics();
      const up = prop === "stairsUp";
      g.rect(x * T + 2, y * T + 2, T - 4, T - 4).fill(up ? 0x6b4423 : 0x24160a);
      for (let k = 0; k < 5; k++) {
        const yy = y * T + 4 + k * 5;
        g.rect(x * T + 4, yy, T - 8, 3).fill({ color: up ? 0xb07a45 : 0x5a3a1c, alpha: up ? 1 - k * 0.12 : 0.4 + k * 0.12 });
      }
      g.zIndex = -1;
      return g;
    }
    if(view?.mine?.encounter==='ruin'){
      const a=ruinPropArt(prop),t=a?extraTexture(a.url):undefined;if(a&&t){const b=opaqueBox(t),sp=new Sprite(t),k=Math.min(T*a.w/b.w,T*a.h/b.h);sp.anchor.set((b.x+b.w/2)/t.width,(b.y+b.h)/t.height);sp.scale.set(k);sp.position.set((x+.5)*T,(y+1)*T-1);sp.zIndex=(y+1)*T;return sp;}
    }
    if(view&&(view.map.underground||view.map.templateId==='mine'&&(!view.mine?.encounter||view.mine.encounter==='cave'))){
      // Mining rework: a Mine's mineral node shows the ore it holds now (the per-ore underground art).
      const url=ore&&prop==='mineralNode'?undergroundOreUrl(ore as MineResource):undergroundPropUrl(view.map,prop,view.mine?.tile,x,y),t=url?extraTexture(url):undefined;
      if(t){const s=new Sprite(t),b=opaqueBox(t),size=undergroundPropSize(prop),k=Math.min(T*size.h/b.h,T*size.w/b.w);s.anchor.set((b.x+b.w/2)/t.width,(b.y+b.h)/t.height);s.scale.set(k);s.position.set((x+.5)*T,(y+1)*T-1);s.zIndex=(y+1)*T;return s;}
    }
    if (prop === "oreFace" || prop === "timberProp") {
      // Deep mines stand-ins (SPRITES.md #111): a rock face flecked with its ore; a timber prop (two posts, a cap beam).
      const g = new Graphics();
      const X = x * T;
      const Y = y * T;
      if (prop === "oreFace") {
        g.rect(X, Y, T, T).fill(0x3e3832);
        g.rect(X + 2, Y + 2, T - 4, T - 6).fill(0x5a524a).stroke({ width: 1, color: 0x000000, alpha: 0.4 });
        const fleck = (view?.mine?.layer ? LAYER_FLECK[view.mine.layer - 1] : undefined) ?? ORE_FLECK[view?.mine?.tile ?? 0] ?? 0xb8b2a8;
        for (let k = 0; k < 6; k++) g.rect(X + 4 + ((x * 13 + y * 7 + k * 11) % (T - 10)), Y + 4 + ((x * 5 + y * 17 + k * 7) % (T - 12)), 3, 2).fill(fleck);
        g.zIndex = y * T;
      } else {
        g.rect(X + 5, Y + 3, 4, T - 4).fill(0x6a4626);
        g.rect(X + T - 9, Y + 3, 4, T - 4).fill(0x6a4626);
        g.rect(X + 3, Y + 1, T - 6, 5).fill(0x8a6238).stroke({ width: 1, color: 0x2a1a0c, alpha: 0.6 });
        g.zIndex = (y + 1) * T;
      }
      return g;
    }
    const tile = PROP_TILE[prop];
    const art = tile !== undefined ? deps.structure.furniture(tile) : undefined;
    const oriented=['bed','chair','chest','table','hearth','shelf','wardrobe'].includes(prop)?extraTexture(`/sprites/interiors-v2/${prop==='chest'&&(view?.exploration?.objects.some(o=>o.x===x&&o.y===y&&o.opened)||openChest?.x===x&&openChest?.y===y&&performance.now()<openChest.until)?'chest_open':prop}_${facing}.png`):undefined;
    const tex = (prop==='rug'?extraTexture('/sprites/autumn/frames/square-terrain/cobble-rugs-07.png'):undefined) ?? oriented ?? art?.texture ?? (PROP_EXTRA[prop] ? extraTexture(PROP_EXTRA[prop]!) : undefined);
    if (!tex) {
      // Stand-in block (3/4: a lit top over a darker front).
      const g = new Graphics();
      const col = PROP_COLOR[prop] ?? 0x8a6a4a;
      const h = PROP_HEIGHT_PX[prop] ?? PROP_DEFAULT_HEIGHT_PX;
      g.rect(x * T + 3, (y + 1) * T - h - 2, T - 6, h).fill(col).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
      g.rect(x * T + 3, (y + 1) * T - h - 2, T - 6, 5).fill({ color: 0xffffff, alpha: 0.18 });
      if (prop === "throne") g.rect(x * T + 8, (y + 1) * T - h - 12, T - 16, 12).fill(0xc9a227);
      g.zIndex = (y + 1) * T;
      return g;
    }
    const s = new Sprite(tex);
    if (prop === "rug" || (!oriented && art?.place === "flat")) {
      s.anchor.set(0, 0);
      s.scale.set(T / tex.width);
      s.position.set(x * T, y * T);
      s.zIndex = -1;
      return s;
    }
    // Upright: the drawn piece at its real-world height (capped at a tile wide), bottom-centred on the tile.
    const box = opaqueBox(tex);
    const k = Math.min((PROP_HEIGHT_PX[prop] ?? PROP_DEFAULT_HEIGHT_PX) / box.h, (T * 1.05) / box.w);
    s.anchor.set((box.x + box.w / 2) / tex.width, (box.y + box.h) / tex.height);
    s.scale.set(k);
    s.position.set((x + 0.5) * T, (y + 1) * T - 1);
    s.zIndex = (y + 1) * T;
    return s;
  }

  function build(v: InteriorView) {
    const keep = new Set<Container>([hero, slash, interactionOutline, ...others.values()]);
    // Deep mines: the monsters' sprites go with the room; syncMobs() below draws them again.
    mobViews.clear();
    for (const c of room.removeChildren()) if (!keep.has(c)) c.destroy();
    const m: InteriorMap = v.map;
    const rockInterior=!!m.underground||m.templateId==='mine'&&(!v.mine?.encounter||v.mine.encounter==='cave');
    const ruinInterior=v.mine?.encounter==='ruin',stoneInterior=rockInterior||ruinInterior;
    const ground = new Graphics();
    ground.zIndex = -10;
    room.addChild(ground);
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const ch = m.cells[y * m.w + x];
        if (ch === " ") continue;
        if (ch === "#") continue;
        const dirtTexture = stoneInterior?extraTexture(ruinInterior?ruinFloorUrl(m,x,y):undergroundFloorUrl(m)):m.floor === "dirt"?extraTexture("floor_dirt_1"):undefined;
        const floorTile = stoneInterior?(dirtTexture?{texture:stoneFloorCell(dirtTexture,x,y)}:undefined):m.floor === "dirt" ? (dirtTexture ? { texture: dirtTexture } : undefined) : deps.structure.floor(m.floor === "stone" ? TileType.StoneFloor : TileType.WoodFloor, 0);
        if (floorTile) {
          const s = new Sprite(floorTile.texture);
          s.scale.set(T / floorTile.texture.width);
          s.position.set(x * T, y * T);
          if(m.floor==='wood'){s.rotation=Math.PI/2;s.position.x+=T;}
          s.zIndex = -9;
          room.addChild(s);
        } else {
          ground.rect(x * T, y * T, T, T).fill(FLOOR_COLOR[m.floor]);
          ground.rect(x * T + ((x * 11 + y * 5) % 20) + 4, y * T + ((x * 3 + y * 17) % 20) + 4, 3, 2).fill({ color: 0x000000, alpha: 0.15 });
        }
        if (ch === "E" && !stoneInterior) {
          const mat = extraTexture("exit_mat");
          if (mat) {
            const sprite = new Sprite(mat); sprite.width = T; sprite.height = T;
            sprite.position.set(x * T, y * T); sprite.zIndex = -8; room.addChild(sprite);
            continue;
          }
          // Fallback while the mat loads.
          ground.rect(x * T, y * T, T, T).fill(0x2a1a0c);
          ground.rect(x * T + 4, y * T + 6, T - 8, T - 12).fill(0x9a3a2a).stroke({ width: 2, color: 0xd8b060 });
        }
      }
    }
    // Walls: the back row is tall (a face below a top), the sides / front are a top cap only (3/4 cutaway).
    const walls = new Graphics();
    walls.zIndex = -5;
    room.addChild(walls);
    if(stoneInterior)for(const p of (ruinInterior?ruinWallPieces(m):caveWallPieces(m))){
      const tex=extraTexture((ruinInterior?RUIN_WALL_ART:CAVE_WALL_ART)[p.kind]);if(!tex)continue;
      const frame=p.kind==='body'?stoneFloorCell(tex,Math.floor(p.x),Math.floor(p.y)):p.strip!==undefined?cliffStripCell(tex,p.strip):tex,sp=new Sprite(frame);
      sp.width=p.w*T;sp.height=p.h*T;sp.position.set(p.x*T,p.y*T);if(p.flip){sp.scale.x=-Math.abs(sp.scale.x);sp.x+=p.w*T;}sp.zIndex=-5;room.addChild(sp);
    }
    const solidAt = (x: number, y: number) => x < 0 || y < 0 || x >= m.w || y >= m.h || m.cells[y * m.w + x] === "#";
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (m.cells[y * m.w + x] !== "#") continue;
        if(stoneInterior)continue;
        {
          const south=!solidAt(x,y+1),north=!solidAt(x,y-1),east=!solidAt(x+1,y),west=!solidAt(x-1,y);
          const draw=(name:string,px:number,py:number,w:number,h:number)=>{const tex=extraTexture('/sprites/cozy-walls/'+(m.wall==='stone'?'stone-':'')+name+'.png');if(!tex)return false;const sp=new Sprite(tex);sp.position.set(px,py);sp.width=w;sp.height=h;sp.zIndex=-5;room.addChild(sp);return true;};
          if(south||(y===0&&x>1&&x<m.w-2)){
            const hearth=m.props.some(p=>p.prop==='hearth'&&p.x===x&&p.y===y+1);
            const face=hearth?'beam':y===0&&x%4===2?'window':y===0&&x%5===3?'picture':'panel';
            if(!draw(face,x*T,y*T-8,T,T+8))walls.rect(x*T,y*T,T,T).fill(0xb8823d);
          }else if(north){
            draw('cap-h',x*T,y*T,T,8);
          }else if(east||west){
            const inner=x>0&&x<m.w-1;
            const width=inner?T:9,xx=inner?x*T:east?(x+1)*T-width:x*T;
            draw('cap-v',xx,y*T,width,T);
          }
          // Fully occluded corner cells stay outside the cutaway; no solid brown blocks.
          continue;
        }

      }
    }
    if(stoneInterior)for(const d of (ruinInterior?ruinScenery(m):caveScenery(m))){
      const tex=extraTexture(d.url);if(!tex)continue;if(d.floor){const sp=new Sprite(d.frame==='top'?caveRailHalf(tex):tex);sp.anchor.set(.5);sp.width=d.w*T;sp.height=d.h*T;sp.position.set((d.x+.5+(d.offsetX??0))*T,(d.y+.5+(d.offsetY??0))*T);sp.rotation=(d.rotation??0)*Math.PI/2;sp.zIndex=-7;room.addChild(sp);continue;}const b=opaqueBox(tex),sp=new Sprite(tex),k=Math.min(d.w*T/b.w,d.h*T/b.h);sp.anchor.set((b.x+b.w/2)/tex.width,(b.y+b.h)/tex.height);sp.scale.set(k);sp.position.set((d.x+.5)*T,(d.y+1)*T-1);sp.zIndex=d.wall?-4:(d.y+1)*T-2;room.addChild(sp);
    }
    if(ruinInterior)for(const p of ruinDoorFrames(m)){const tex=extraTexture(p.url);if(!tex)continue;const b=opaqueBox(tex),sp=new Sprite(tex);sp.anchor.set(b.x/tex.width,b.y/tex.height);sp.scale.set(p.w*T/b.w,p.h*T/b.h);sp.position.set(p.x*T,p.y*T);sp.zIndex=-3;room.addChild(sp);}
    if(stoneInterior){
      const entrance=ruinInterior?ruinEntrance(m):undergroundEntrance(m),p=entrance.opening,opening=new Graphics();
      opening.roundRect(p.x*T,p.y*T,p.w*T,p.h*T,T*.15).fill(0x080705);opening.zIndex=-3;room.addChild(opening);
      for(const part of entrance.sprites){const tex=extraTexture(part.url);if(!tex)continue;const b=opaqueBox(tex),sp=new Sprite(tex);sp.anchor.set(b.x/tex.width,b.y/tex.height);sp.scale.set(part.w*T/b.w,part.h*T/b.h);sp.position.set(part.x*T,part.y*T);sp.zIndex=-3;room.addChild(sp);}
    }
    for (const p of m.props){const f=v.furniture?.find(f=>f.x===p.x&&f.y===p.y);if(f?.cleared)continue;
      if(f?.empty&&['weaponRack','armourStand'].includes(p.prop)||f?.off||v.exploration?.objects.some(o=>o.kind==='lamp'&&o.opened&&o.x===p.x&&o.y===p.y)){
        const g=new Graphics(),x=p.x*T,y=p.y*T,wood=0x785237,edge=0x38261d,hi=0xa77b4a;
        if(p.prop==='weaponRack'){g.rect(x+4,y+9,3,22).rect(x+25,y+9,3,22).rect(x+3,y+12,26,4).rect(x+3,y+24,26,3).fill(wood);g.rect(x+4,y+9,1,22).rect(x+25,y+9,1,22).rect(x+3,y+12,26,1).fill(hi);}
        else if(p.prop==='armourStand'){g.rect(x+14,y+5,4,24).rect(x+7,y+12,18,3).rect(x+7,y+28,18,3).fill(wood);g.circle(x+16,y+5,3).fill(hi);}
        else if(p.prop==='hearth'){g.rect(x+3,y+6,26,25).fill(0x716259);g.rect(x+9,y+16,14,15).fill(0x211a17);g.rect(x+5,y+28,22,3).fill(0x918071);g.rect(x+11,y+27,10,2).fill(wood);}
        else{g.rect(x+14,y+10,3,21).rect(x+9,y+29,14,2).fill(edge);g.rect(x+11,y+8,10,12).fill(0x6f6859);g.rect(x+14,y+10,4,8).fill(0x292824);}
        g.zIndex=(p.y+1)*T;room.addChild(g);continue;
      }
      const o=v.exploration?.objects.find(o=>o.x===p.x&&o.y===p.y);if(o?.kind==='key'&&!o.available)continue;
      // A worked-out mineral / rock node (mining rework) is drawn faded until it grows back.
      const sp=propSprite(p.prop,p.x,p.y,p.facing,f?.ore);if(f?.empty&&(p.prop==='mineralNode'||p.prop==='rockBlock'))sp.alpha=.35;room.addChild(sp);}
    for(const o of v.exploration?.objects??[]){if(o.opened&&!o.empty&&['crate','barrel','pot','cache'].includes(o.kind)){const tex=extraTexture('/sprites/adventure/pouch.png');if(tex){const b=opaqueBox(tex),sp=new Sprite(tex),k=12/b.h;sp.anchor.set((b.x+b.w/2)/tex.width,(b.y+b.h)/tex.height);sp.scale.set(k);sp.position.set((o.x+.5)*T,(o.y+1)*T);sp.zIndex=(o.y+1)*T;room.addChild(sp);}}if(o.kind==='gate'&&o.opened){const tex=extraTexture('/sprites/structure/extra/door_wood_stonearch_open_b.png');if(tex){const sp=new Sprite(tex);sp.anchor.set(.5,1);sp.width=1.3*T;sp.height=1.4*T;sp.position.set((o.x+.5)*T,(o.y+1)*T);sp.zIndex=(o.y+1)*T;room.addChild(sp);}}}
    const old = new Map(npcViews);
    npcViews.clear();
    for (const n of v.npcs) {
      if(n.specialId)loadSpecialArt(n.specialId,()=>{rebuildPending=true;});
      const anim = deps.npcAnim?.(n.kind);
      const special=n.specialId?specialTexture(n.specialId,"idle",0):undefined;
      const tex = special??anim?.walk[0] ?? deps.npcTexture(n.kind);
      let body: Container;
      let k = 1;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(special?specialAnchor.x:.5,special?specialAnchor.y:.85);
        k = special?specialScale(n.specialId!):anim ? anim.scale : deps.humanScale?.(tex) ?? deps.npcHeight / tex.height;
        s.scale.set(k);
        body = s;
      } else body = new Graphics().circle(0, -8, 8).fill(n.color);
      room.addChild(body);
      // Named roles: a gold "!" before the name of someone with work for you.
      const label = new Text({ text: n.quest ? `! ${n.name}` : n.name, style: { fontSize: 9, fill: n.quest ? 0xffd75a : 0xffffff, fontFamily: "serif", stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 1);
      label.resolution = 3;
      label.zIndex = 1e6;
      room.addChild(label);
      const bubble = new Container();
      const bubbleText = new Text({ text: "", style: { fontSize: 8, fill: 0x2a1a0c, fontFamily: "serif" } });
      bubbleText.anchor.set(0.5, 1);
      bubbleText.resolution = 3;
      bubble.addChild(new Graphics(), bubbleText);
      bubble.zIndex = 1e6 + 1;
      bubble.visible = false;
      room.addChild(bubble);
      const zzz = new Text({ text: "z z", style: { fontSize: 8, fill: 0xdfe8ff, fontFamily: "serif", stroke: { color: 0x000000, width: 2 } } });
      zzz.anchor.set(0.5, 1);
      zzz.resolution = 3;
      zzz.zIndex = 1e6;
      zzz.visible = false;
      room.addChild(zzz);
      const prev = old.get(n.id);
      const live: InteriorNpcLive = prev?.live ?? { id: n.id, x: n.x, y: n.y, face: "d", pose: "idle" };
      npcViews.set(n.id, {
        specialId:n.specialId,
        variant:!n.specialId&&(["villager","farmer","trader","elder"].includes(n.kind)||n.act==="resident"||n.act==="patron"),
        body, label, bubble, bubbleText, zzz, anim, still: tex, k, right: prev?.right ?? true,
        sx: prev?.sx ?? live.x, sy: prev?.sy ?? live.y, live, phase: (n.id.length * 97) % 1000,
      });
    }
    if (pendingLive && pendingLive.key === v.key && pendingLive.storey === m.storey) applyLive(pendingLive.npcs);
    room.addChild(hero, slash, interactionOutline);
    for (const o of others.values()) room.addChild(o);
    builtKey = keyOf(v);
    syncMobs();
  }

  // Deep mines: the monsters of the mine the hero is in (message interiorMobs): new ones drawn, gone ones dropped.
  function syncMobs() {
    const list = view && mobsLive && mobsLive.key === view.key ? mobsLive.mobs : [];
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.id);
      let mv = mobViews.get(m.id);
      if (!mv) {
        if(m.specialId)loadSpecialArt(m.specialId);
        const art = deps.mobArt?.(m.kind);
        let body: Sprite | Graphics;
        if (art) {
          const sp = new Sprite(art.idle);
          sp.anchor.set(0.5, 0.85);
          sp.scale.set(art.scale*interiorMonsterScale(m.kind));
          if (art.tint !== undefined) sp.tint = 0xffffff;
          body = sp;
        } else body = new Graphics().circle(0, -6, 6).fill(0x2a2028);
        const cue=new Graphics();cue.zIndex=-1;
        const bar = new Graphics();
        bar.zIndex = 1e6;
        const zzz = new Text({ text: "z z", style: { fontSize: 8, fill: 0xdfe8ff, fontFamily: "serif", stroke: { color: 0x000000, width: 2 } } });
        zzz.anchor.set(0.5, 1);
        zzz.resolution = 3;
        zzz.zIndex = 1e6;
        const label=new Text({text:m.name??"",style:{fontSize:9,fill:0xffd4b1,fontFamily:"serif",stroke:{color:0x000000,width:3}}});label.anchor.set(.5,1);label.zIndex=1e6;
        room.addChild(body, bar, zzz,label,cue);
        mv = { cue,body, bar, zzz, label, art, sx: m.x, sy: m.y, live: m, lastHp: m.hp, flashUntil: 0, phase: (m.id.length * 131) % 1000 };
        mobViews.set(m.id, mv);
      }
      if (m.hp < mv.lastHp) mv.flashUntil = performance.now() + 180;
      mv.lastHp = m.hp;
      mv.live = m;
      if (Math.hypot(m.x - mv.sx, m.y - mv.sy) > 3) {
        mv.sx = m.x;
        mv.sy = m.y;
      }
    }
    for (const [id, mv] of mobViews) {
      if (seen.has(id)) continue;
      mv.body.destroy();
      mv.bar.destroy();
      mv.cue.destroy();
      mv.label.destroy();
      mv.zzz.destroy();
      mobViews.delete(id);
    }
  }

  // Each frame: ease toward the live position; walk / bite frames; flip by facing; hp bar; asleep: dimmed, "z z".
  function animateMobs(now: number) {
    for (const mv of mobViews.values()) {
      const m = mv.live;
      mv.sx += (m.x - mv.sx) * 0.3;
      mv.sy += (m.y - mv.sy) * 0.3;
      const x = (mv.sx + 0.5) * T;
      const y = (mv.sy + 0.5) * T;
      const t = now + mv.phase;
      const b = mv.body;
      if (b instanceof Sprite && mv.art) {
        const a = mv.art;
        let tex = a.idle;
        let k = a.scale;
        if (m.act === "walk" && a.walk.length) {
          tex = a.walk[Math.floor(t / INTERIOR_WALK_FRAME_MS) % a.walk.length];
          k = a.walkScale;
        } else if (m.act === "attack" && a.action.length) {
          const pose=m.duel?.phase==="windup"?.1+m.duel.progress*.3:m.duel?.phase==="recovery"?.5+m.duel.progress*.5:undefined;
          tex = a.action[pose===undefined?Math.floor(t / 160) % a.action.length:Math.min(a.action.length-1,Math.floor(pose*a.action.length))];
          k = a.walkScale;
        }
        if (b.texture !== tex) b.texture = tex;
        k*=interiorMonsterScale(m.kind);b.scale.set(k * (m.face === "l" ? -1 : 1), k);
        b.tint = 0xffffff;
      }
      const attack=m.bossAttack,custom=m.specialId?specialTexture(m.specialId,now<mv.flashUntil?'hurt':attack?'action':m.act==='walk'?'walk':m.act==='attack'?'action':'idle',attack?(attack.phase==='windup'?0:attack.progress<.2?160:320):t):undefined;
      if(custom&&b instanceof Sprite){b.texture=custom;b.anchor.set(specialAnchor.x,specialAnchor.y);const k=specialScale(m.specialId!);b.scale.set(k*(m.face==='l'?-1:1),k);b.tint=0xffffff;}
      const cue=mv.cue;cue.clear();
      drawDuelCue(cue,m.duel,T/2);
      if(attack){const ax=(attack.x+.5)*T,ay=(attack.y+.5)*T,ox=(attack.fromX+.5)*T,oy=(attack.fromY+.5)*T,line=['archer','assassin','beast','swoop'].includes(attack.style),active=attack.phase==='windup',color=active?0xe8b24f:0xd05439;
        if(active||attack.progress<.2){if(line)cue.moveTo(ox,oy).lineTo(ax,ay).stroke({width:Math.max(3,attack.radius*2*T),color,alpha:active?.13:.3});else cue.circle(ax,ay,attack.radius*T).fill({color,alpha:active?.12:.28});cue.circle(ax,ay,(line?.35:attack.radius)*T).stroke({width:2,color,alpha:active?.7:1});}
        mv.label.text=(m.name??'')+' · '+attack.name;
      }else mv.label.text=m.name??'';
      if(m.hazard?.remaining){const hx=(m.hazard.x+.5)*T,hy=(m.hazard.y+.5)*T,hr=m.hazard.radius*T;cue.circle(hx,hy,hr).fill({color:0xb5b4a6,alpha:.15}).stroke({width:1,color:0xddd8bb,alpha:.6});for(let n=0;n<8;n++){const a=n*Math.PI/4;cue.moveTo(hx,hy).lineTo(hx+Math.cos(a)*hr,hy+Math.sin(a)*hr).stroke({width:1,color:0xddd8bb,alpha:.45});}}
      if(m.burning)for(let f=0;f<3;f++)cue.circle(x-5+f*5,y-8-(t/65+f*3)%12,2).fill({color:f%2?0xffdc86:0xf18b38,alpha:.85});
      if(m.slowed)cue.circle(x,y+1,7).stroke({width:1.5,color:0x8ed4ed,alpha:.8});
      if(m.cursed)cue.circle(x,y-24,3).stroke({width:1.5,color:0xc591d9,alpha:.85});
      b.alpha = m.act === "sleep" ? 0.7 : 1;
      b.position.set(x, y + (m.act === "sleep" ? 0 : Math.sin(t / 220) * (m.kind === "caveBat" ? 3 : 0.6)));
      b.zIndex = y;
      const g = mv.bar;
      g.clear();
      const bh=m.specialId?(SPECIAL_BY_ID.get(m.specialId)?.height??25):25;mv.label.position.set(x,y-bh-8);
      const w = 20;
      g.rect(x - w / 2, y - bh - 4, w, 3).fill(0x2a0a0a);
      g.rect(x - w / 2, y - bh - 4, (w * Math.max(0, m.hp)) / Math.max(1, m.maxHp), 3).fill(0xd83a2a);
      mv.zzz.visible = m.act === "sleep";
      mv.zzz.position.set(x + 6, y - 14 - (Math.floor(t / 600) % 3));
    }
    slash.visible = !!heroCombat;slash.clear();drawPlayerCombat(slash,shown,heroCombat);
  }
  const keyOf = (v: InteriorView) => `${v.key}:${v.map.templateId}:${v.map.level}:${v.map.variant}:${v.map.storey}:${JSON.stringify(v.npcs)}:${JSON.stringify(v.map)}:${JSON.stringify(v.furniture)}:${JSON.stringify(v.exploration?.objects.filter(o=>o.kind==='lamp'))}`;

  function applyLive(npcs: InteriorNpcLive[]) {
    for (const n of npcs) {
      const nv = npcViews.get(n.id);
      if (!nv) continue;
      if (Math.hypot(n.x - nv.sx, n.y - nv.sy) > 3) {
        nv.sx = n.x;
        nv.sy = n.y;
      }
      if (n.face === "l") nv.right = false;
      else if (n.face === "r") nv.right = true;
      if (n.say !== nv.live.say) {
        nv.bubbleText.text = n.say ?? "";
        const g = nv.bubble.children[0] as Graphics;
        g.clear();
        if (n.say) {
          const w = nv.bubbleText.width + 8;
          const h = nv.bubbleText.height + 4;
          g.roundRect(-w / 2, -h - 1, w, h, 3).fill(0xfff6e0).stroke({ width: 1, color: 0x3a2210 });
          g.poly([-3, -1, 3, -1, 0, 3]).fill(0xfff6e0);
        }
      }
      nv.live = n;
    }
  }

  // Each frame: ease toward the live position, pick the pose's frame, bob / swing / sit / lie down.
  function animateNpcs(now: number) {
    void loadAutumnSheet("human-life-directions");
    for (const nv of npcViews.values()) {
      const n = nv.live;
      nv.sx += (n.x - nv.sx) * 0.3;
      nv.sy += (n.y - nv.sy) * 0.3;
      let x = (nv.sx + 0.5) * T;
      let y = (nv.sy + 0.5) * T;
      const t = now + nv.phase;
      let tex = nv.still;
      let rot = 0;
      let dy = 0;
      let sy = 1;
      if (n.pose === "walk") {
        if (nv.anim?.walk.length) tex = nv.anim.walk[Math.floor(t / INTERIOR_WALK_FRAME_MS) % nv.anim.walk.length];
        else dy = -Math.abs(Math.sin(t / INTERIOR_WALK_FRAME_MS)) * 2;
      } else if (n.pose === "work") {
        // Tool swing: the action frames, else a 2-frame tilt.
        if (nv.anim?.action.length) tex = nv.anim.action[Math.floor((t / INTERIOR_WORK_MS) * nv.anim.action.length) % nv.anim.action.length];
        else rot = Math.floor(t / (INTERIOR_WORK_MS / 2)) % 2 ? 0.12 : -0.05;
      } else if (n.pose === "sit") {
        const seated = directionalFrame("human-life-directions",1,n.face==="u"?"n":n.face==="d"?"s":n.face==="l"?"w":"e",Math.floor(t/250));
        if (seated) tex = seated;
        else { dy = 3; sy = 0.86; }
      } else if (n.pose === "sleep") {
        const sleeping = directionalFrame("human-life-directions",2,n.face==="u"?"n":n.face==="d"?"s":n.face==="l"?"w":"e",Math.floor(t/600));
        if (sleeping) tex = sleeping;
        else rot = -Math.PI / 2;
        y -= 4;
        x += 2;
      } else dy = Math.sin((t / INTERIOR_BOB_MS) * Math.PI * 2) * INTERIOR_BOB_PX;
      const custom=nv.specialId?specialTexture(nv.specialId,n.pose==='walk'?'walk':n.pose==='work'||n.pose==='idle'&&Math.floor(t/7000)%3===2?'action':'idle',t):undefined;
      if(custom){tex=custom;dy=0;rot=n.pose==='sleep'?-Math.PI/2:0;sy=n.pose==='sit'?.88:1;if(nv.body instanceof Sprite)nv.body.anchor.set(specialAnchor.x,specialAnchor.y);}
      const varied=nv.variant&&['idle','walk'].includes(n.pose)?npcVariantFrame(n.id,n.face==='u'?'n':n.face==='d'?'s':n.face==='l'?'w':'e',n.pose==='walk'?Math.floor(t/160):1):undefined;
      if(varied)tex=varied;
      const b = nv.body;
      if (b instanceof Sprite && tex && b.texture !== tex) b.texture = tex;
      const sxSign = varied?1:nv.right ? 1 : -1;
      b.scale.set((custom?specialScale(nv.specialId!):varied?25/72:nv.k)*sxSign,(custom?specialScale(nv.specialId!):varied?25/72:nv.k)*sy);
      b.rotation = rot;
      b.position.set(x, y + dy);
      b.zIndex = n.pose === "sleep" ? (nv.sy + 0.5) * T - 8 : y;
      nv.label.position.set(x, n.pose === "sleep" ? y - 14 : y - (nv.specialId?(SPECIAL_BY_ID.get(nv.specialId)?.height??25)+5:22) + dy);
      nv.label.visible = n.pose !== "sleep";
      nv.zzz.visible = n.pose === "sleep";
      nv.zzz.position.set(x + 6, y - 12 - (Math.floor(t / 600) % 3));
      nv.bubble.visible = !!n.say && n.pose !== "sleep";
      nv.bubble.position.set(x, y - 34 + dy);
    }
  }

  let highlighted:{x:number;y:number}|undefined;
  let inside = false;
  function setInside(on: boolean) {
    if (inside === on) return;
    inside = on;
    // Leaving: the layer stays up (black, fading out over the world) until the fade is done.
    layer.visible = true;
    room.visible = on;
    vignette.visible = on;
    deps.worldLayer.visible = !on;
    document.body.classList.toggle("interior-mode",on);
    hud.hidden = !on;
    interactionHint.hidden=!on;
    fadeT = performance.now();
    deps.onChange?.(on);
  }
  function clearRoom() {
    for (const c of room.removeChildren()) if (c !== hero && c !== slash && c!==interactionOutline) c.destroy();
    others.clear();
    npcViews.clear();
    mobViews.clear();
    mobsLive = null;
    pendingLive = null;
  }

  function nearExit(): boolean {
    if (!view || !Number.isFinite(target.x)) return false;
    if (view.map.storey > 0) return false;
    const e = view.map.exit;
    return Math.hypot((e.x + 0.5) * T - target.x, (e.y + 0.5) * T - target.y) / T <= INTERIOR_ESC_EXIT_TILES;
  }

  deps.app.ticker.add(() => {
    const scr = deps.app.screen;
    const a = Math.max(0, 1 - (performance.now() - fadeT) / INTERIOR_FADE_MS);
    fade.clear();
    if (a > 0 && layer.visible) fade.rect(0, 0, scr.width, scr.height).fill({ color: 0x000000, alpha: a });
    if (!view) {
      if (layer.visible && a <= 0) layer.visible = false;
      return;
    }
    if (rebuildPending) {
      rebuildPending = false;
      build(view);
    }
    // Ease toward the snapshot position (snapshots come at the tick rate).
    if (!Number.isFinite(shown.x) || Math.hypot(target.x - shown.x, target.y - shown.y) > T * 3) shown = { ...target };
    else {
      shown.x += (target.x - shown.x) * 0.35;
      shown.y += (target.y - shown.y) * 0.35;
    }
    const moving = Math.hypot(target.x-shown.x,target.y-shown.y)>.3;
    const heroArt=deps.heroTexture?.(deps.myId() ?? "",moving,Math.hypot(shown.x-hero.x,shown.y-hero.y));
    if(heroArt) { hero.anchor.set(rigTextureScale(heroArt) ? 120/256 : .5,rigTextureScale(heroArt) ? 163/192 : .85); hero.texture=heroArt; const sign=heroCombat?(Math.cos(heroCombat.angle)>=0?1:-1):target.x<shown.x? -1:target.x>shown.x?1:Math.sign(hero.scale.x)||1; const k=heroK(heroArt); hero.scale.set(sign*k,k); }
    hero.position.set(shown.x, shown.y);
    hero.zIndex = shown.y;
    interactionOutline.clear();interactionHint.hidden=true;highlighted=undefined;
    const hx=target.x/T-.5,hy=target.y/T-.5,objects=[...(view.exploration?.objects??[]),...(view.furniture??[]).filter(o=>!o.cleared).map(o=>({...o,available:true,secret:false}))],hovered=hover?objects.find(o=>o.available&&o.x===hover!.x&&o.y===hover!.y&&(!o.secret||Math.hypot(o.x-hx,o.y-hy)<1.8)):undefined;
    const nearby=objects.filter(o=>o.available&&Math.hypot(o.x-hx,o.y-hy)<=EXPLORATION_REACH).sort((a,b)=>Math.hypot(a.x-hx,a.y-hy)-Math.hypot(b.x-hx,b.y-hy))[0],use=hovered??nearby;
    if(use&&!decorating){highlighted={x:use.x,y:use.y};const near=Math.hypot(use.x-hx,use.y-hy)<=EXPLORATION_REACH;interactionOutline.roundRect(use.x*T+2,use.y*T+2,T-4,T-4,3).stroke({width:2,color:near?0xf4db95:0xc0b69a,alpha:.8});interactionHint.textContent=near?`E · ${use.prompt} ${use.label}`:`${use.label} · Walk closer to ${use.prompt.toLowerCase()}`;interactionHint.hidden=false;}
    animateNpcs(performance.now());
    animateMobs(performance.now());
    if(!use&&view.exploration&&!decorating){interactionHint.textContent=(view.exploration.pattern??'')+' · '+(view.exploration.stealth??'')+' · J: journal';interactionHint.hidden=false;}
    const aim=deps.spellAim?.();if(aim&&!decorating){interactionHint.textContent=`${SPELLS[aim.spell].name} · Click a target; right click or Esc cancels`;interactionHint.hidden=false;highlighted=undefined;interactionOutline.circle(target.x,target.y,SPELLS[aim.spell].range*T).stroke({width:1.5,color:0xf2c94c,alpha:.5});}
    for(let n=spellFx.length-1;n>=0;n--){const fx=spellFx[n],age=(performance.now()-fx.started)/700,g=fx.g,e=fx.effect;if(age>=1||g.destroyed||view.key!==e.key){if(!g.destroyed)g.destroy();spellFx.splice(n,1);continue;}g.clear();const color=e.spell==='fireBolt'?0xf19432:e.spell==='frost'?0x9bdbec:e.spell==='thunder'?0xf8edb6:e.spell==='heal'?0x8fd07e:e.spell==='curse'?0xc895d2:0xe8d38a;
      if(e.spell==='fireBolt'&&age<.55){const t=age/.55,x=e.fromX+(e.x-e.fromX)*t,y=e.fromY+(e.y-e.fromY)*t;g.moveTo(x-(e.x-e.fromX)*.08,y-(e.y-e.fromY)*.08).lineTo(x,y).stroke({width:4,color,alpha:.7});g.circle(x,y,5).fill(color);g.circle(x,y,2).fill(0xffedab);}
      else{const radius=(e.radius||15)*Math.min(1,(age+.2)*1.4);g.circle(e.x,e.y,radius).stroke({width:3,color,alpha:1-age});g.circle(e.x,e.y,radius*.45).fill({color,alpha:(1-age)*.2});}
    }
    const m=view.map;
    const viewportW=scr.width-(decorating?300:0);
    const zoom=decorating?Math.min(INTERIOR_ZOOM,viewportW/(m.w*T),(scr.height-200)/(m.h*T)):INTERIOR_ZOOM;
    room.scale.set(zoom);
    const rw = m.w * T * zoom;
    const rh = m.h * T * zoom;
    const cx = rw <= viewportW ? (viewportW - rw) / 2 : Math.min(0, Math.max(viewportW - rw, viewportW / 2 - shown.x * zoom));
    const cy = rh <= scr.height ? (scr.height - rh) / 2 : Math.min(0, Math.max(scr.height - rh, scr.height / 2 - shown.y * zoom));
    room.position.set(Math.round(cx), Math.round(cy));
    vignette.width = scr.width;
    vignette.height = scr.height;
    if(view.mine?.encounter==='ruin'&&m.ruin){const x=shown.x/T,y=shown.y/T,a=m.ruin.areas.find(a=>x>=a.x&&y>=a.y&&x<a.x+a.w&&y<a.y+a.h),title=RUIN_TITLES[m.variant%4]+' — '+(a?.label??'Passage');if(titleEl.textContent!==title)titleEl.textContent=title;}
    exitEl.hidden = !nearExit();
    const rockExit=!!m.underground||m.templateId==='mine'&&(!view.mine?.encounter||view.mine.encounter==='cave');
    exitEl.textContent=view.mine?.encounter==='ruin'?'Walk through the arch or press Esc to return outside':rockExit?(view.mine?.layer&&view.mine.layer>1?'Enter the tunnel or press Esc to go up a level':'Enter the tunnel or press Esc to return outside'):'Walk onto the mat or press Esc to leave';
  });

  // Esc near the exit mat leaves (the server re-checks the distance).
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !view || !nearExit()) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (!(document.getElementById("hl-dialogue")?.hidden ?? true)) return;
      deps.send({ type: "interiorExit" });
    },
    true,
  );

  return {
    active: () => !!view,
    onSpell(effect){if(!view||view.key!==effect.key||(view.instanceVariant??view.map.variant)!==effect.variant)return;const g=new Graphics();g.zIndex=1e6;room.addChild(g);spellFx.push({effect,started:performance.now(),g});},
    useHighlighted:()=>{if(!view||!highlighted||decorating)return false;deps.send({type:'interiorUse',...highlighted});return true;},
    onMessage(v) {
      if(v&&decorating){select("floor").value=v.map.floor;select("wall").value=v.map.wall;}
      decorButton.hidden=!v?.editable;if(!v?.editable)closeEditor();
      if (!v) {
        view = null;heroCombat=undefined;
        builtKey = "";
        clearRoom();
        setInside(false);
        return;
      }
      // Layered mines: another layer of the same Mine is a fresh room too.
      const fresh = !view || view.key !== v.key || view.map.storey !== v.map.storey || view.map.variant !== v.map.variant;
      view = v;
      titleEl.textContent = v.mine?.encounter==='ruin'?RUIN_TITLES[v.map.variant%4]:v.title;
      // Deep mines: status, monsters left (Space fights), hazards.
      mineEl.hidden = !v.mine;
      if (v.mine) {
        const mi = v.mine;
        mineEl.className = mi.status === "infested" ? "infested" : "";
        const head = mi.encounter?(mi.status==='cleared'?'Cleared — search for remaining treasure':`${mi.monsters} enemies inside. Space to fight.`):mi.status === "infested"
          ? `Infested: ${mi.monsters} monster${mi.monsters === 1 ? "" : "s"} left. Space to fight; the miners come back once it is clear`
          : MINE_STATUS_LABEL[mi.status];
        // Layered mines: the level the hero is on, what it yields and whether a way down is open.
        const layer = mi.layer ? `Level ${mi.layer} of ${mi.layers} (${mi.yields})${(mi.layers ?? 0) > mi.layer ? ": the old mine head leads down" : ""}` : "";
        mineEl.textContent = [layer, head, ...mi.hazards].filter(Boolean).join(" · ");
      }
      threatEl.hidden = v.threat <= 0;
      threatEl.textContent = `Raiders near the door! (${v.threat} hostile${v.threat === 1 ? "" : "s"} close by)`;
      if (fresh || keyOf(v) !== builtKey) build(v);
      if (fresh) shown = { x: NaN, y: NaN };
      setInside(true);
    },
    onMobs(key, mobs) {
      mobsLive = { key, mobs };
      syncMobs();
    },
    onNpcs(key, storey, npcs) {
      pendingLive = { key, storey, npcs };
      if (view && view.key === key && view.map.storey === storey) applyLive(npcs);
    },
    onPlayers(players) {
      if (!view) return;
      const id = deps.myId();
      const seen = new Set<string>();
      for (const p of players) {
        if (!p.inside || p.inside.key !== view.key) continue;
        if (p.id === id) {
          target = { x: p.inside.x, y: p.inside.y };heroCombat=p.combat;
          continue;
        }
        // Another hero in the same building.
        seen.add(p.id);
        let s = others.get(p.id);
        if (!s) {
          s = new Sprite(deps.playerTexture);
          s.anchor.set(0.5, 0.85);
          s.scale.set(heroK(deps.playerTexture));
          s.tint = 0xffffff;
          others.set(p.id, s);
          room.addChild(s);
        }
        const art=deps.heroTexture?.(p.id,Math.hypot(p.inside.x-s.x,p.inside.y-s.y)>.3,Math.hypot(p.inside.x-s.x,p.inside.y-s.y));
        if(art) {s.anchor.set(rigTextureScale(art) ? 120/256 : .5,rigTextureScale(art) ? 163/192 : .85);s.texture=art;s.tint=0xffffff;const k=heroK(art);s.scale.set((p.combat?(Math.cos(p.combat.angle)>=0?1:-1):(p.inside.x<s.x?-1:1))*k,k);}
        s.position.set(p.inside.x, p.inside.y);
        s.zIndex = p.inside.y;
      }
      for (const [oid, s] of others) {
        if (seen.has(oid)) continue;
        s.destroy();
        others.delete(oid);
      }
    },
    reset() {
      if (view) this.onMessage(null);
    },
  };
}
