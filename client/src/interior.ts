// interior.ts: Stardew phase 5c (2026-11-09; server/src/interiors.ts, shared/src/interiors.ts). The building interior
// view: while the server says the hero is inside (message `interior` with the map, NPCs, chest, threat), the world
// layer is hidden and this layer draws the small room instead: floor tiles (the wired wood / stone floor art, a dirt
// stand-in), 3/4 walls and the exit mat drawn in code, furniture from the wired furniture / extra atlas art (a
// stand-in block where none fits), the NPCs and the hero (its interior x / y from the snapshot `inside`), a warm
// lighting vignette and a fade. The camera follows the hero (a room smaller than the screen is centred). HUD: the
// room's title, "Raiders near the door" when hostiles are close, the exit hint near the mat. Esc near the mat leaves.
// The whole-room interior paintings (art-sources builder/interior_room_*) do not fit the template grids: not used.
import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { TileType, type PlayerSnapshot } from "@colony/shared/protocol";
import {
  INTERIOR_ESC_EXIT_TILES, INTERIOR_FADE_MS, INTERIOR_TILE_PX, INTERIOR_VIGNETTE_ALPHA, INTERIOR_ZOOM, type InteriorMap,
  type InteriorProp, type InteriorView,
} from "@colony/shared/interiors";
import type { StructureTextures } from "./structureArt";

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
  banner: "banner_red", forge: "stove_iron", stall: "stall_market_red", candelabra: "candelabra_b",
};
// Stand-in colours (counter, anvil, high seat and any art that fails to load).
const PROP_COLOR: Partial<Record<InteriorProp, number>> = {
  counter: 0x7a4e26, anvil: 0x4a4d52, throne: 0x8a3a2a, hearth: 0x9a5030, altar: 0xd8d0b8, pew: 0x7a5230, oven: 0xa0624a,
  hay: 0xd8b84a, forge: 0x3a3a3e, stall: 0xa04040, banner: 0xa02828, barrel: 0x7a4f28, crates: 0x9a6b3a, sacks: 0xc8b088,
};
const FLOOR_COLOR = { wood: 0x8f5f30, stone: 0x80838a, dirt: 0x7a6145 };
const WALL = { wood: { top: 0x6e4524, face: 0x553319, line: 0x3a2210 }, stone: { top: 0x8d8f94, face: 0x6a6c71, line: 0x45474b } };

export interface InteriorDeps {
  app: { stage: Container; screen: { width: number; height: number }; ticker: { add: (fn: () => void) => void } };
  worldLayer: Container;
  structure: StructureTextures;
  playerTexture: Texture;
  playerHeight: number;
  npcTexture: (kind: string) => Texture | undefined;
  npcHeight: number;
  send: (msg: object) => void;
  myId: () => string | null;
  // Entering / leaving (main.ts: weather, strategy toggle, selection).
  onChange?: (inside: boolean) => void;
}

export interface InteriorUi {
  active: () => boolean;
  onMessage: (view: InteriorView | null) => void;
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
    const url = `${EXTRA}${name}.png`;
    if (extra.has(url)) return extra.get(url) ?? undefined;
    extra.set(url, null);
    Assets.load<Texture>(url)
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
  const hero = new Sprite(deps.playerTexture);
  hero.anchor.set(0.5, 0.85);
  hero.scale.set(deps.playerHeight / deps.playerTexture.height);
  const others = new Map<string, Sprite>();
  let target = { x: 0, y: 0 };
  let shown = { x: NaN, y: NaN };
  let fadeT = 0;

  function propSprite(prop: InteriorProp, x: number, y: number): Container {
    const tile = PROP_TILE[prop];
    const art = tile !== undefined ? deps.structure.furniture(tile) : undefined;
    const tex = art?.texture ?? (PROP_EXTRA[prop] ? extraTexture(PROP_EXTRA[prop]!) : undefined);
    if (!tex) {
      // Stand-in block (3/4: a lit top over a darker front).
      const g = new Graphics();
      const col = PROP_COLOR[prop] ?? 0x8a6a4a;
      const h = prop === "counter" ? 18 : prop === "anvil" ? 14 : 24;
      g.rect(x * T + 3, (y + 1) * T - h - 2, T - 6, h).fill(col).stroke({ width: 1, color: 0x000000, alpha: 0.5 });
      g.rect(x * T + 3, (y + 1) * T - h - 2, T - 6, 5).fill({ color: 0xffffff, alpha: 0.18 });
      if (prop === "throne") g.rect(x * T + 8, (y + 1) * T - h - 12, T - 16, 12).fill(0xc9a227);
      g.zIndex = (y + 1) * T;
      return g;
    }
    const s = new Sprite(tex);
    if (prop === "rug" || art?.place === "flat") {
      s.anchor.set(0, 0);
      s.scale.set(T / tex.width);
      s.position.set(x * T, y * T);
      s.zIndex = -1;
      return s;
    }
    // Upright: fit a box one tile wide (a bit taller), bottom-centred on the tile.
    const k = Math.min((T * 1.05) / tex.width, (T * 1.5) / tex.height);
    s.anchor.set(0.5, 1);
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
        const floorTile = m.floor === "dirt" ? undefined : deps.structure.floor(m.floor === "stone" ? TileType.StoneFloor : TileType.WoodFloor, (x * 7 + y * 13) & 0xff);
        if (floorTile) {
          const s = new Sprite(floorTile.texture);
          s.scale.set(T / floorTile.texture.width);
          s.position.set(x * T, y * T);
          s.zIndex = -9;
          room.addChild(s);
        } else {
          ground.rect(x * T, y * T, T, T).fill(FLOOR_COLOR[m.floor]);
          ground.rect(x * T + ((x * 11 + y * 5) % 20) + 4, y * T + ((x * 3 + y * 17) % 20) + 4, 3, 2).fill({ color: 0x000000, alpha: 0.15 });
        }
        if (ch === "E") {
          // The exit mat with a light from outside.
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
    for (const p of m.props) room.addChild(propSprite(p.prop, p.x, p.y));
    for (const n of v.npcs) {
      const tex = deps.npcTexture(n.kind);
      let body: Container;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0.85);
        s.scale.set(deps.npcHeight / tex.height);
        body = s;
      } else body = new Graphics().circle(0, -8, 8).fill(n.color);
      body.position.set((n.x + 0.5) * T, (n.y + 0.5) * T);
      body.zIndex = (n.y + 0.5) * T;
      room.addChild(body);
      const label = new Text({ text: n.name, style: { fontSize: 9, fill: 0xffffff, fontFamily: "serif", stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5, 1);
      label.resolution = 3;
      label.position.set((n.x + 0.5) * T, n.y * T - 6);
      label.zIndex = 1e6;
      room.addChild(label);
    }
    room.addChild(hero);
    for (const o of others.values()) room.addChild(o);
    builtKey = `${v.key}:${m.templateId}:${m.level}:${JSON.stringify(v.npcs)}`;
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
    hud.hidden = !on;
    fadeT = performance.now();
    deps.onChange?.(on);
  }
  function clearRoom() {
    for (const c of room.removeChildren()) if (c !== hero) c.destroy();
    others.clear();
  }

  function nearExit(): boolean {
    if (!view || !Number.isFinite(target.x)) return false;
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
    hero.position.set(shown.x, shown.y);
    hero.zIndex = shown.y;
    const zoom = INTERIOR_ZOOM;
    const m = view.map;
    room.scale.set(zoom);
    const rw = m.w * T * zoom;
    const rh = m.h * T * zoom;
    const cx = rw <= scr.width ? (scr.width - rw) / 2 : Math.min(0, Math.max(scr.width - rw, scr.width / 2 - shown.x * zoom));
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
      if (!v) {
        view = null;
        builtKey = "";
        clearRoom();
        setInside(false);
        return;
      }
      const fresh = !view || view.key !== v.key;
      view = v;
      titleEl.textContent = v.title;
      threatEl.hidden = v.threat <= 0;
      threatEl.textContent = `Raiders near the door! (${v.threat} hostile${v.threat === 1 ? "" : "s"} close by)`;
      const key = `${v.key}:${v.map.templateId}:${v.map.level}:${JSON.stringify(v.npcs)}`;
      if (fresh || key !== builtKey) build(v);
      if (fresh) shown = { x: NaN, y: NaN };
      setInside(true);
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
          s.scale.set(deps.playerHeight / deps.playerTexture.height);
          s.tint = p.color;
          others.set(p.id, s);
          room.addChild(s);
        }
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
