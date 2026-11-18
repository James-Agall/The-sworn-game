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
import { TileType, type PlayerSnapshot } from "@colony/shared/protocol";
import {
  INTERIOR_BOB_MS, INTERIOR_BOB_PX, INTERIOR_ESC_EXIT_TILES, INTERIOR_FADE_MS, INTERIOR_TILE_PX, INTERIOR_VIGNETTE_ALPHA,
  INTERIOR_WALK_FRAME_MS, INTERIOR_WORK_MS, INTERIOR_ZOOM, type InteriorMap, type InteriorNpcLive, type InteriorProp, type InteriorView,
} from "@colony/shared/interiors";
import type { StructureTextures } from "./structureArt";
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
  bedFine: "bed_blue_double", hearth: "fireplace_lit_b", wardrobe: "wardrobe", altar: "altar_candles", pew: "bench", oven: "oven_round",
  barrel: "barrel", crates: "crates_barrels_stack", sacks: "sacks_pile", hay: "hay_pile_crate", armourStand: "armor_stand",
  banner: "banner_red", forge: "forge", counter: "counter", anvil: "anvil", throne: "throne", stall: "stall_market_red", candelabra: "candelabra_b",
};
// Stand-in colours (counter, anvil, high seat and any art that fails to load).
const PROP_COLOR: Partial<Record<InteriorProp, number>> = {
  counter: 0x7a4e26, anvil: 0x4a4d52, throne: 0x8a3a2a, hearth: 0x9a5030, altar: 0xd8d0b8, pew: 0x7a5230, oven: 0xa0624a,
  hay: 0xd8b84a, forge: 0x3a3a3e, stall: 0xa04040, banner: 0xa02828, barrel: 0x7a4f28, crates: 0x9a6b3a, sacks: 0xc8b088,
};
// Scale: the hero / NPC body is HUMAN_CHAR_PX (25 px) tall, so a tile (32 px) is about 2.2 m. Furniture is sized by its
// DRAWN pixels (transparent padding ignored) to these heights, so a chair comes up to a person's thigh, a table to the
// waist, a wardrobe over their head; whatever the art's canvas size. Width is capped at about a tile (long pieces).
const PROP_HEIGHT_PX: Partial<Record<InteriorProp, number>> = {
  chair: 18, pew: 16, table: 20, bed: 31, bedFine: 31, chest: 16, shelf: 30, wardrobe: 32, hearth: 28, lamp: 22, statue: 30,
  weaponRack: 24, workbench: 16, altar: 18, oven: 22, barrel: 14, crates: 14, sacks: 11, hay: 13, armourStand: 26, banner: 28,
  forge: 24, stall: 26, candelabra: 20, counter: 14, anvil: 10, throne: 22,
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
  send: (msg: object) => void;
  myId: () => string | null;
  // Entering / leaving (main.ts: weather, strategy toggle, selection).
  onChange?: (inside: boolean) => void;
}

export interface InteriorUi {
  active: () => boolean;
  onMessage: (view: InteriorView | null) => void;
  // Gap closure G5: message `interiorNpcs`.
  onNpcs: (key: string, storey: number, npcs: InteriorNpcLive[]) => void;
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
#int-exit { padding: 2px 10px; border-radius: 3px; background: rgba(30, 18, 8, .6); color: #f3e3c0; font-size: 12px; }`;
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
  hud.append(titleEl, threatEl, exitEl);
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
  window.addEventListener('pointerdown',e=>{if(!view||!(e.target instanceof HTMLCanvasElement)||e.button!==0)return;const point=room.toLocal({x:e.clientX,y:e.clientY});const x=Math.floor(point.x/T),y=Math.floor(point.y/T);if(decorating){e.preventDefault();e.stopImmediatePropagation();const prop=select('prop').value;edit({op:prop==='remove'?'remove':'place',prop,x,y,facing:select('facing').value});}else if(view.map.props.some(p=>p.x===x&&p.y===y&&['chest','bed','bedFine'].includes(p.prop))){e.preventDefault();e.stopImmediatePropagation();openChest={x,y,until:performance.now()+5000};rebuildPending=true;window.setTimeout(()=>{openChest=null;rebuildPending=true;},5000);deps.send({type:'interiorUse',x,y});}},true);
  const homeStyle=document.createElement('style');homeStyle.textContent=`#home-editor{position:fixed;right:18px;top:140px;width:240px;max-height:75vh;overflow:auto;padding:18px;background:#242c26f5;color:#eee2c6;border:1px solid #a48c59;border-radius:10px;z-index:40;font:14px Georgia}#home-editor[hidden]{display:none}#home-editor label{display:block;margin:12px 0}#home-editor select,#home-editor button{display:block;box-sizing:border-box;width:100%;padding:8px;margin-top:5px;background:#3c4737;color:#fff0cf;border:1px solid #8a7954;border-radius:5px}#home-preview{width:52px;height:52px;object-fit:contain;image-rendering:pixelated}#home-editor p{font-size:12px;line-height:1.5;color:#c1c4ae}#home-decorate{padding:7px 12px;background:#344733;color:#f4e3bc;border:1px solid #b09562;border-radius:5px}#home-decorate[hidden]{display:none}`;homeStyle.textContent+=`body.interior-mode #next-bar,body.interior-mode #event-feed,body.interior-mode #goal-tracker,body.interior-mode #economy-panel,body.interior-mode #economy-panel-toggle,body.interior-mode #build-panel,body.interior-mode #build-panel-toggle,body.interior-mode #minimap-frame,body.interior-mode #hero-hotbar{display:none!important}body.interior-mode #int-hud{top:100px}body.interior-mode #player-bar{top:58px!important}`;document.head.append(homeStyle);

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
  let pendingLive: { key: string; storey: number; npcs: InteriorNpcLive[] } | null = null;

  function propSprite(prop: InteriorProp, x: number, y: number, facing="s"): Container {
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
    const tile = PROP_TILE[prop];
    const art = tile !== undefined ? deps.structure.furniture(tile) : undefined;
    const oriented=['bed','chair','chest','table','hearth','shelf','wardrobe'].includes(prop)?extraTexture(`/sprites/interiors-v2/${prop==='chest'&&openChest?.x===x&&openChest?.y===y&&performance.now()<openChest.until?'chest_open':prop}_${facing}.png`):undefined;
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
    const keep = new Set<Container>([hero, ...others.values()]);
    for (const c of room.removeChildren()) if (!keep.has(c)) c.destroy();
    const m: InteriorMap = v.map;
    const ground = new Graphics();
    ground.zIndex = -10;
    room.addChild(ground);
    const wall = WALL[m.wall];
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const ch = m.cells[y * m.w + x];
        if (ch === " ") continue;
        if (ch === "#") continue;
        const dirtTexture = m.floor === "dirt" ? extraTexture("floor_dirt_1") : undefined;
        const floorTile = m.floor === "dirt" ? (dirtTexture ? { texture: dirtTexture } : undefined) : deps.structure.floor(m.floor === "stone" ? TileType.StoneFloor : TileType.WoodFloor, 0);
        if (floorTile) {
          const s = new Sprite(floorTile.texture);
          s.scale.set(T / floorTile.texture.width);
          s.position.set(x * T, y * T);
          if(m.templateId==='house'&&m.floor==='wood'){s.rotation=Math.PI/2;s.position.x+=T;}
          s.zIndex = -9;
          room.addChild(s);
        } else {
          ground.rect(x * T, y * T, T, T).fill(FLOOR_COLOR[m.floor]);
          ground.rect(x * T + ((x * 11 + y * 5) % 20) + 4, y * T + ((x * 3 + y * 17) % 20) + 4, 3, 2).fill({ color: 0x000000, alpha: 0.15 });
        }
        if (ch === "E") {
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
    const solidAt = (x: number, y: number) => x < 0 || y < 0 || x >= m.w || y >= m.h || m.cells[y * m.w + x] === "#";
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (m.cells[y * m.w + x] !== "#") continue;
        if(m.templateId==='house'){
          const south=!solidAt(x,y+1),north=!solidAt(x,y-1),east=!solidAt(x+1,y),west=!solidAt(x-1,y);
          const draw=(name:string,px:number,py:number,w:number,h:number)=>{const tex=extraTexture('/sprites/cozy-walls/'+name+'.png');if(!tex)return false;const sp=new Sprite(tex);sp.position.set(px,py);sp.width=w;sp.height=h;sp.zIndex=-5;room.addChild(sp);return true;};
          if(south||(y===0&&x>1&&x<m.w-2)){
            const hearth=m.props.some(p=>p.prop==='hearth'&&p.x===x&&p.y===y+1);
            const face=m.wall==='stone'?'plaster':hearth?'beam':y===0&&x%4===2?'window':y===0&&x%5===3?'picture':'panel';
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
        walls.rect(x*T,y*T,T,T).fill(wall.face);
        const mask = (y > 0 && m.cells[(y - 1) * m.w + x] === "#" ? 1 : 0)
          | (x + 1 < m.w && m.cells[y * m.w + x + 1] === "#" ? 2 : 0)
          | (y + 1 < m.h && m.cells[(y + 1) * m.w + x] === "#" ? 4 : 0)
          | (x > 0 && m.cells[y * m.w + x - 1] === "#" ? 8 : 0);
        const wallArt = autumnFrame("interior-walls", (m.wall === "stone" ? 4 : 0) + Math.floor(mask / 8), mask % 8);
        if (wallArt) {
          const sprite = new Sprite(wallArt);
          sprite.anchor.set(0.5, 1);
          sprite.scale.set(T / 68);
          sprite.position.set((x + 0.5) * T, (y + 1) * T);
          sprite.zIndex = -5;
          room.addChild(sprite);
          continue;
        }
        walls.rect(x * T, y * T, T, T).fill(wall.top);
        walls.rect(x * T, y * T, T, 2).fill({ color: 0xffffff, alpha: 0.12 });
        if (!solidAt(x, y + 1)) {
          // A face toward the room below: planks or stone courses.
          walls.rect(x * T, y * T + 10, T, T - 10).fill(wall.face);
          for (let k = 0; k < 3; k++) walls.rect(x * T, y * T + 14 + k * 6, T, 1).fill(wall.line);
          if (m.wall === "stone") walls.rect(x * T + ((y + x) % 2 ? 10 : 22), y * T + 10, 1, T - 10).fill(wall.line);
        }
      }
    }
    for (const p of m.props) room.addChild(propSprite(p.prop, p.x, p.y,p.facing));
    const old = new Map(npcViews);
    npcViews.clear();
    for (const n of v.npcs) {
      const anim = deps.npcAnim?.(n.kind);
      const tex = anim?.walk[0] ?? deps.npcTexture(n.kind);
      let body: Container;
      let k = 1;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0.85);
        k = anim ? anim.scale : deps.humanScale?.(tex) ?? deps.npcHeight / tex.height;
        s.scale.set(k);
        body = s;
      } else body = new Graphics().circle(0, -8, 8).fill(n.color);
      room.addChild(body);
      const label = new Text({ text: n.name, style: { fontSize: 9, fill: 0xffffff, fontFamily: "serif", stroke: { color: 0x000000, width: 3 } } });
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
        variant:["villager","farmer","trader","elder"].includes(n.kind)||n.act==="resident"||n.act==="patron",
        body, label, bubble, bubbleText, zzz, anim, still: tex, k, right: prev?.right ?? true,
        sx: prev?.sx ?? live.x, sy: prev?.sy ?? live.y, live, phase: (n.id.length * 97) % 1000,
      });
    }
    if (pendingLive && pendingLive.key === v.key && pendingLive.storey === m.storey) applyLive(pendingLive.npcs);
    room.addChild(hero);
    for (const o of others.values()) room.addChild(o);
    builtKey = keyOf(v);
  }
  const keyOf = (v: InteriorView) => `${v.key}:${v.map.templateId}:${v.map.level}:${v.map.variant}:${v.map.storey}:${JSON.stringify(v.npcs)}:${JSON.stringify(v.map)}`;

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
      const varied=nv.variant&&['idle','walk'].includes(n.pose)?npcVariantFrame(n.id,n.face==='u'?'n':n.face==='d'?'s':n.face==='l'?'w':'e',n.pose==='walk'?Math.floor(t/160):1):undefined;
      if(varied)tex=varied;
      const b = nv.body;
      if (b instanceof Sprite && tex && b.texture !== tex) b.texture = tex;
      const sxSign = varied?1:nv.right ? 1 : -1;
      b.scale.set((varied?25/72:nv.k)*sxSign,(varied?25/72:nv.k)*sy);
      b.rotation = rot;
      b.position.set(x, y + dy);
      b.zIndex = n.pose === "sleep" ? (nv.sy + 0.5) * T - 8 : y;
      nv.label.position.set(x, n.pose === "sleep" ? y - 14 : y - 22 + dy);
      nv.label.visible = n.pose !== "sleep";
      nv.zzz.visible = n.pose === "sleep";
      nv.zzz.position.set(x + 6, y - 12 - (Math.floor(t / 600) % 3));
      nv.bubble.visible = !!n.say && n.pose !== "sleep";
      nv.bubble.position.set(x, y - 34 + dy);
    }
  }

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
    fadeT = performance.now();
    deps.onChange?.(on);
  }
  function clearRoom() {
    for (const c of room.removeChildren()) if (c !== hero) c.destroy();
    others.clear();
    npcViews.clear();
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
    if(heroArt) { hero.anchor.set(rigTextureScale(heroArt) ? 120/256 : .5,rigTextureScale(heroArt) ? 163/192 : .85); hero.texture=heroArt; const sign=target.x<shown.x? -1:target.x>shown.x?1:Math.sign(hero.scale.x)||1; const k=heroK(heroArt); hero.scale.set(sign*k,k); }
    hero.position.set(shown.x, shown.y);
    hero.zIndex = shown.y;
    animateNpcs(performance.now());
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
    exitEl.hidden = !nearExit();
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
    onMessage(v) {
      if(v&&decorating){select("floor").value=v.map.floor;select("wall").value=v.map.wall;}
      decorButton.hidden=!v?.editable;if(!v?.editable)closeEditor();
      if (!v) {
        view = null;
        builtKey = "";
        clearRoom();
        setInside(false);
        return;
      }
      const fresh = !view || view.key !== v.key || view.map.storey !== v.map.storey;
      view = v;
      titleEl.textContent = v.title;
      threatEl.hidden = v.threat <= 0;
      threatEl.textContent = `Raiders near the door! (${v.threat} hostile${v.threat === 1 ? "" : "s"} close by)`;
      if (fresh || keyOf(v) !== builtKey) build(v);
      if (fresh) shown = { x: NaN, y: NaN };
      setInside(true);
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
          target = { x: p.inside.x, y: p.inside.y };
          continue;
        }
        // Another hero in the same building.
        seen.add(p.id);
        let s = others.get(p.id);
        if (!s) {
          s = new Sprite(deps.playerTexture);
          s.anchor.set(0.5, 0.85);
          s.scale.set(heroK(deps.playerTexture));
          s.tint = p.color;
          others.set(p.id, s);
          room.addChild(s);
        }
        const art=deps.heroTexture?.(p.id,Math.hypot(p.inside.x-s.x,p.inside.y-s.y)>.3,Math.hypot(p.inside.x-s.x,p.inside.y-s.y));
        if(art) {s.anchor.set(rigTextureScale(art) ? 120/256 : .5,rigTextureScale(art) ? 163/192 : .85);s.texture=art;s.tint=0xffffff;const k=heroK(art);s.scale.set((p.inside.x<s.x?-1:1)*k,k);}
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
