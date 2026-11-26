// Minimap: explored mask, static terrain layer, per-frame markers, compact / expanded / full layouts and the
// strategic map texture. Split out of main.ts (2026-11-26).
import { Application, CanvasSource, Container, Sprite, Texture } from "pixi.js";
import { adventureMapMarker } from "../adventureJournal";
import type { SiteFaction, SiteSnapshot, SiteRelationSnapshot, QuestSnapshot, RelationTier, PlayerSnapshot, ColonistSnapshot, MobSnapshot, TownCenterSnapshot } from "@colony/shared/protocol";
import { Biome, TileType, VISION_RADIUS_COLONIST, VISION_RADIUS_PLAYER } from "@colony/shared/protocol";
import { StrategyCamera } from "../strategy/camera";
import type { VisionSource } from "../strategy/lod";
import { MinimapClass, decodeMaskRuns, minimapCellClass, minimapClassOf } from "@colony/shared/streaming";
import { QUEST_MARKER_IMAGES } from "../worldVisuals";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface MinimapContext {
  strategyCam: StrategyCamera;
  chunkOfTile: (tx: number, ty: number) => number;
  strategicMapSprite: Sprite;
  worldLayer: Container;
  app: Application;
  RELATION_TIER_COLOR: Record<RelationTier, string>;
  FORT_FLAG_COLOR: Record<SiteFaction, string>;
  readonly worldTilesX: number;
  readonly worldTilesY: number;
  readonly siteOwners: Map<number, number>;
  readonly tiles: number[];
  readonly biomes: number[];
  readonly streamed: { chunkTiles: number; chunksX: number; chunksY: number; f: number; cw: number; ch: number; cells: Uint8Array; cellSeen: Uint8Array } | null;
  readonly chunkLoaded: Uint8Array;
  readonly tileSize: number;
  strategicMapDirty: boolean;
  readonly myId: string | null;
  readonly camZoom: number;
  readonly fortMarkers: SiteSnapshot[];
  readonly clanColors: Map<number, number>;
  readonly myClan: number;
  readonly siteRelations: Map<number, SiteRelationSnapshot>;
  readonly latestTownCenters: TownCenterSnapshot[];
  readonly latestQuests: QuestSnapshot[];
  readonly latestHearths: Set<number>;
  readonly castleRuinTile: { x: number; y: number } | null;
  readonly drawFightPings: (ctx: CanvasRenderingContext2D, s: number, u: number) => void;
}

export function createMinimap(game: MinimapContext) {
  const { strategyCam, chunkOfTile, strategicMapSprite, worldLayer, app, RELATION_TIER_COLOR, FORT_FLAG_COLOR } = game;
  // ---- Fog-of-war minimap (DOM canvas, bottom-right; the main view is never fogged) ----
  // Static layer: one pixel per tile in an offscreen canvas, rebuilt whole only on `welcome` and
  // patched per tile on tileUpdate / explored. Each snapshot just blits it and draws the live dots
  // and camera rect on top, so nothing repaints the whole map per frame.
  const minimapEl = document.getElementById("minimap") as HTMLCanvasElement;
  minimapEl.addEventListener("contextmenu", (e) => e.preventDefault());
  const minimapCtx = minimapEl.getContext("2d")!;
  const minimapStatic = document.createElement("canvas");
  const minimapStaticCtx = minimapStatic.getContext("2d")!;
  let minimapImage: ImageData | null = null;
  let minimapStaticDirty = false;
  let explored = new Uint8Array(0);
  const MINIMAP_TARGET_CSS_PX = 180;
  // Both integers, so tile -> pixel stays exact: CSS px per tile, and backing px per CSS px.
  let minimapCssPerTile = 1;
  let minimapDpr = 1;
  // Compact / expanded: a big world's minimap used to be the whole map at >= 1 px per tile (512 px on a 512 map). Now it is a
  // MM_COMPACT_CSS window around the player at 1 px per tile (about 11 x 11 chunks) with a button to expand to the whole map,
  // shrunk to fit the screen. The strategy view always shows the whole map (its click-to-jump needs it). Maps that already fit
  // the compact window have no button.
  const MM_COMPACT_CSS = 176;
  let mmExpanded = false;
  try { mmExpanded = localStorage.getItem("colony-minimap-expanded") === "1"; } catch { /* storage unavailable */ }
  let mmFull = true; // the canvas currently shows the whole world
  let mmBaseCss = 1; // CSS px per tile of the whole-world view (before the screen-fit cap)
  const minimapToggleEl = document.getElementById("minimap-toggle") as HTMLButtonElement | null;
  // Top-left of the visible window, in backing px of the map-space the drawing code works in (0, 0 when the whole map shows).
  let mmOx = 0;
  let mmOy = 0;
  function minimapFullCss(): number {
    const world = Math.max(game.worldTilesX, game.worldTilesY, 1);
    const cap = Math.max(MM_COMPACT_CSS, Math.min(window.innerWidth * 0.3, window.innerHeight * 0.5, 380));
    return Math.min(mmBaseCss, cap / world);
  }
  function minimapCanToggle(): boolean {
    return Math.max(game.worldTilesX, game.worldTilesY) * mmBaseCss > MM_COMPACT_CSS * 1.15;
  }
  function minimapWantsFull(): boolean {
    return !minimapCanToggle() || mmExpanded || strategyCam.inStrategy;
  }
  function applyMinimapLayout() {
    mmFull = minimapWantsFull();
    minimapDpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    minimapCssPerTile = mmFull ? minimapFullCss() : 1;
    const cssW = mmFull ? game.worldTilesX * minimapCssPerTile : Math.min(MM_COMPACT_CSS, game.worldTilesX * minimapCssPerTile);
    const cssH = mmFull ? game.worldTilesY * minimapCssPerTile : Math.min(MM_COMPACT_CSS, game.worldTilesY * minimapCssPerTile);
    minimapEl.width = Math.max(1, Math.ceil(cssW * minimapDpr));
    minimapEl.height = Math.max(1, Math.ceil(cssH * minimapDpr));
    minimapEl.style.width = `${cssW}px`;
    minimapEl.style.height = `${cssH}px`;
    if (minimapToggleEl) {
      minimapToggleEl.hidden = !minimapCanToggle() || strategyCam.inStrategy;
      minimapToggleEl.textContent = mmExpanded ? "\u2921" : "\u2922";
      minimapToggleEl.title = mmExpanded ? "Shrink the minimap to the area around you" : "Expand the minimap to the whole map";
      minimapToggleEl.setAttribute("aria-label", minimapToggleEl.title);
    }
  }
  minimapToggleEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    mmExpanded = !mmExpanded;
    try { localStorage.setItem("colony-minimap-expanded", mmExpanded ? "1" : "0"); } catch { /* storage unavailable */ }
    applyMinimapLayout();
  });
  minimapToggleEl?.addEventListener("pointerdown", (e) => e.stopPropagation());
  window.addEventListener("resize", () => { if (minimapImage) applyMinimapLayout(); });
  // The world tile under a pointer on the minimap (accounts for the compact window's offset).
  function minimapTileAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = minimapEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const sBack = minimapCssPerTile * minimapDpr;
    return { x: (mmOx + ((clientX - r.left) / r.width) * minimapEl.width) / sBack, y: (mmOy + ((clientY - r.top) / r.height) * minimapEl.height) / sBack };
  }
  const MINIMAP_UNEXPLORED = 0x140d07;
  const MINIMAP_BIOME: Record<number, number> = {
    [Biome.Plains]: 0x6b7a3c,
    [Biome.Hills]: 0x8a7650,
    [Biome.Swamp]: 0x4c5a44,
  };
  const MINIMAP_WATER = 0x3d5f73;
  const MINIMAP_MOAT = 0x2f4f5f;
  const MINIMAP_TREE = 0x3c5428;
  const MINIMAP_ROCK = 0x8d8a80;
  const MINIMAP_IRON = 0x7d5644;
  // Deep mines: deposit markers (coal near-black, copper orange, tin pale blue-grey).
  const MINIMAP_COAL = 0x1e1c22;
  const MINIMAP_COPPER = 0xd07a3a;
  const MINIMAP_TIN = 0xb8c8d8;
  // Industry extras: limestone off-white, gold yellow, lead slate.
  const MINIMAP_LIMESTONE = 0xe8e2cc;
  const MINIMAP_GOLD = 0xe8c030;
  const MINIMAP_LEAD = 0x5a6070;
  const MINIMAP_WALL = 0xb8ad98;
  const MINIMAP_ROAD = 0xa8875a;
  const MINIMAP_BUILDING = 0xe0b468;
  const MINIMAP_RUIN = 0xa0322a;
  const MINIMAP_CAMP = 0xd2731a;
  const MINIMAP_ABBEY = 0xf0e6cc;
  const MINIMAP_RUIN_TILES = new Set<number>([
    TileType.RuinWall1, TileType.RuinWall2, TileType.RuinArch, TileType.RuinStatue, TileType.RuinRubble, TileType.Rubble,
  ]);
  const MINIMAP_CAMP_TILES = new Set<number>([
    TileType.PropCampfire, TileType.PropCart, TileType.PropBarrel, TileType.PropCrate, TileType.PropFence,
  ]);
  const MINIMAP_ABBEY_TILES = new Set<number>([TileType.AbbeyHall, TileType.PropCross, TileType.PropLanternPost]);
  function minimapTileColor(index: number): number {
    if (!explored[index]) return MINIMAP_UNEXPLORED;
    // Forts phase A: an NPC fort's walls / buildings.
    if (game.siteOwners.has(index)) return MINIMAP_RUIN;
    const tile = game.tiles[index] ?? TileType.Empty;
    switch (tile) {
      case TileType.Empty:
        return MINIMAP_BIOME[game.biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Water:
        return MINIMAP_WATER;
      case TileType.Tree:
      case TileType.FruitTree:
      case TileType.FruitTreePicked:
        return MINIMAP_TREE;
      // Bushes and mushroom patches are ground cover: drawn as the biome under them.
      case TileType.BerryBush:
      case TileType.BerryBushPicked:
      case TileType.MushroomPatch:
      case TileType.MushroomPatchPicked:
        return MINIMAP_BIOME[game.biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Rock:
        return MINIMAP_ROCK;
      case TileType.IronOre:
        return MINIMAP_IRON;
      case TileType.Wall:
      case TileType.StoneWall:
      case TileType.Gate:
      case TileType.FenceGate:
      case TileType.RiverBridge:
      case TileType.Drawbridge:
        return MINIMAP_WALL;
      case TileType.Moat:
        return MINIMAP_MOAT;
      case TileType.Road:
      case TileType.CobbleRoad:
        return MINIMAP_ROAD;
    }
    if (MINIMAP_RUIN_TILES.has(tile)) return MINIMAP_RUIN;
    if (MINIMAP_CAMP_TILES.has(tile)) return MINIMAP_CAMP;
    if (MINIMAP_ABBEY_TILES.has(tile)) return MINIMAP_ABBEY;
    // Every other tile is something the colony built (the Town Center also gets its own marker).
    return MINIMAP_BUILDING;
  }
  const MINIMAP_CLASS_COLOR: Record<number, number> = {
    [MinimapClass.Plains]: MINIMAP_BIOME[Biome.Plains], [MinimapClass.Hills]: MINIMAP_BIOME[Biome.Hills],
    [MinimapClass.Swamp]: MINIMAP_BIOME[Biome.Swamp], [MinimapClass.Water]: MINIMAP_WATER, [MinimapClass.Moat]: MINIMAP_MOAT,
    [MinimapClass.Tree]: MINIMAP_TREE, [MinimapClass.Rock]: MINIMAP_ROCK, [MinimapClass.Iron]: MINIMAP_IRON,
    [MinimapClass.Wall]: MINIMAP_WALL, [MinimapClass.Road]: MINIMAP_ROAD, [MinimapClass.Building]: MINIMAP_BUILDING,
    [MinimapClass.Ruin]: MINIMAP_RUIN, [MinimapClass.Camp]: MINIMAP_CAMP, [MinimapClass.Abbey]: MINIMAP_ABBEY,
    [MinimapClass.Coal]: MINIMAP_COAL, [MinimapClass.Copper]: MINIMAP_COPPER, [MinimapClass.Tin]: MINIMAP_TIN,
    [MinimapClass.Limestone]: MINIMAP_LIMESTONE, [MinimapClass.Gold]: MINIMAP_GOLD, [MinimapClass.Lead]: MINIMAP_LEAD,
  };
  // World streaming phase 4: one minimap pixel per f x f cell. A loaded chunk's cell is recomputed from its
  // tiles; elsewhere a structure arriving by tileUpdate overrides the welcome's summary.
  function paintMinimapCell(index: number) {
    const sm = game.streamed!;
    const tx = index % game.worldTilesX;
    const ty = Math.floor(index / game.worldTilesX);
    const cx = Math.floor(tx / sm.f);
    const cy = Math.floor(ty / sm.f);
    const cell = cy * sm.cw + cx;
    if (game.chunkLoaded[chunkOfTile(tx, ty)]) {
      sm.cells[cell] = minimapCellClass(game.tiles, game.biomes, game.worldTilesX, game.worldTilesY, cx, cy, sm.f, (i) => game.siteOwners.has(i));
    } else {
      const k = minimapClassOf(game.tiles[index] ?? 0, game.biomes[index] ?? 0, game.siteOwners.has(index));
      if (k >= MinimapClass.Wall) sm.cells[cell] = k;
    }
    if (explored[index]) sm.cellSeen[cell] = 1;
    paintMinimapPixel(cell, sm.cellSeen[cell] ? MINIMAP_CLASS_COLOR[sm.cells[cell]] : MINIMAP_UNEXPLORED);
  }
  function paintMinimapPixel(pixel: number, color: number) {
    const o = pixel * 4;
    minimapImage!.data[o] = color >> 16;
    minimapImage!.data[o + 1] = (color >> 8) & 0xff;
    minimapImage!.data[o + 2] = color & 0xff;
    minimapImage!.data[o + 3] = 255;
    minimapStaticDirty = true;
  }
  function paintMinimapTile(index: number) {
    if (!minimapImage) return;
    if (game.streamed) return paintMinimapCell(index);
    const color = minimapTileColor(index);
    const o = index * 4;
    minimapImage.data[o] = color >> 16;
    minimapImage.data[o + 1] = (color >> 8) & 0xff;
    minimapImage.data[o + 2] = color & 0xff;
    minimapImage.data[o + 3] = 255;
    minimapStaticDirty = true;
  }
  // `welcome` (join or restart): unpack the bitset and rebuild the whole static layer once.
  function resetMinimap(packedExplored: string) {
    const count = game.worldTilesX * game.worldTilesY;
    if (game.streamed) {
      explored = decodeMaskRuns(packedExplored, count);
    } else {
      const bytes = atob(packedExplored);
      explored = new Uint8Array(count);
      for (let i = 0; i < count; i++) explored[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
    }
    // World streaming phase 4: a streamed world's minimap is one CSS px per summary cell (1 / f px per tile).
    mmBaseCss = game.streamed ? 1 / game.streamed.f : Math.max(1, Math.round(MINIMAP_TARGET_CSS_PX / Math.max(game.worldTilesX, game.worldTilesY)));
    applyMinimapLayout();
    if (game.streamed) {
      const sm = game.streamed;
      for (let i = 0; i < count; i++) if (explored[i]) sm.cellSeen[Math.floor(Math.floor(i / game.worldTilesX) / sm.f) * sm.cw + Math.floor((i % game.worldTilesX) / sm.f)] = 1;
      minimapStatic.width = sm.cw;
      minimapStatic.height = sm.ch;
      minimapImage = minimapStaticCtx.createImageData(sm.cw, sm.ch);
      for (let c = 0; c < sm.cw * sm.ch; c++) paintMinimapPixel(c, sm.cellSeen[c] ? MINIMAP_CLASS_COLOR[sm.cells[c]] : MINIMAP_UNEXPLORED);
    } else {
      minimapStatic.width = game.worldTilesX;
      minimapStatic.height = game.worldTilesY;
      minimapImage = minimapStaticCtx.createImageData(game.worldTilesX, game.worldTilesY);
      for (let i = 0; i < count; i++) paintMinimapTile(i);
    }
    // The canvas was resized: a fresh texture for the strategic map sprite.
    if (strategicMapSprite.texture !== Texture.EMPTY) strategicMapSprite.texture.destroy(true);
    strategicMapSprite.texture = new Texture({ source: new CanvasSource({ resource: minimapStatic, scaleMode: "nearest" }) });
    strategicMapSprite.scale.set(game.tileSize * (game.streamed?.f ?? 1));
    game.strategicMapDirty = true;
  }
  function markExplored(indices: number[]) {
    for (const i of indices) {
      if (i < 0 || i >= explored.length || explored[i]) continue;
      explored[i] = 1;
      paintMinimapTile(i);
    }
  }
  // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with the
  // server's vision radii (minimap enemy dots and the strategy fog share it).
  function liveVisionSources(players: PlayerSnapshot[], colonists: ColonistSnapshot[]): VisionSource[] {
    const tileOf = (worldPx: number) => Math.floor(worldPx / game.tileSize);
    const sources: VisionSource[] = [];
    for (const p of players) sources.push({ x: tileOf(p.x), y: tileOf(p.y), r: VISION_RADIUS_PLAYER });
    for (const c of colonists) {
      if (game.tiles[c.postY * game.worldTilesX + c.postX] === TileType.AbbeyHall) continue;
      sources.push({ x: tileOf(c.x), y: tileOf(c.y), r: VISION_RADIUS_COLONIST });
    }
    return sources;
  }
  function cssColor(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
  }
  function drawMinimap(players: PlayerSnapshot[], colonists: ColonistSnapshot[], mobs: MobSnapshot[]) {
    if (!minimapImage) return;
    if (minimapStaticDirty) {
      minimapStaticCtx.putImageData(minimapImage, 0, 0);
      minimapStaticDirty = false;
      game.strategicMapDirty = true;
    }
    if (minimapWantsFull() !== mmFull) applyMinimapLayout();
    const ctx = minimapCtx;
    const s = minimapCssPerTile * minimapDpr; // backing px per tile
    const u = minimapDpr; // backing px per CSS px
    const toMap = (worldPx: number) => (worldPx / game.tileSize) * s;
    const tileOf = (worldPx: number) => Math.floor(worldPx / game.tileSize);
    // Compact window: centred on the player (or the camera when there is none), kept inside the map. Everything below draws in
    // whole-map space; the translate moves the window onto the canvas.
    mmOx = 0;
    mmOy = 0;
    if (!mmFull) {
      const focus = players.find((p) => p.id === game.myId);
      const fx = focus ? toMap(focus.x) : toMap(-worldLayer.position.x / game.camZoom + app.screen.width / game.camZoom / 2);
      const fy = focus ? toMap(focus.y) : toMap(-worldLayer.position.y / game.camZoom + app.screen.height / game.camZoom / 2);
      mmOx = Math.round(Math.max(0, Math.min(game.worldTilesX * s - minimapEl.width, fx - minimapEl.width / 2)));
      mmOy = Math.round(Math.max(0, Math.min(game.worldTilesY * s - minimapEl.height, fy - minimapEl.height / 2)));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimapEl.width, minimapEl.height);
    ctx.save();
    ctx.translate(-mmOx, -mmOy);
    ctx.imageSmoothingEnabled = false;
    {
      // Only the visible part of the static layer (one pixel per tile, or one per summary cell when streamed).
      const per = minimapStatic.width / game.worldTilesX; // static px per tile
      const sx = (mmOx / s) * per;
      const sy = (mmOy / s) * per;
      const sw = Math.min(minimapStatic.width - sx, (minimapEl.width / s) * per);
      const sh = Math.min(minimapStatic.height - sy, (minimapEl.height / s) * per);
      if (sw > 0 && sh > 0) ctx.drawImage(minimapStatic, sx, sy, sw, sh, mmOx, mmOy, (sw / per) * s, (sh / per) * s);
    }

    // Forts phase B: a flag on each explored fort's keep (faction colour; grey = razed, clan colour = captured).
    for (const f of game.fortMarkers) {
      const fx = (f.keepX + 0.5) * s;
      const fy = (f.keepY + 0.5) * s;
      const color = f.captured
        ? `#${(game.clanColors.get(f.capturedBy ?? 0) ?? 0x3a7bd5).toString(16).padStart(6, "0")}`
        : f.cleared ? "#8a8a8a" : f.hostile ? "#c0392b"
        : f.vassalOf !== undefined && f.vassalOf !== game.myClan ? "#a0743a"
        : f.faction === "human" && f.num !== undefined && game.siteRelations.has(f.num) ? RELATION_TIER_COLOR[game.siteRelations.get(f.num)!.tier]
        : FORT_FLAG_COLOR[f.faction];
      // Forts phase C: a human settlement's flag has a green edge (white = neutral, red = hostile).
      ctx.fillStyle = f.faction === "human" && !f.captured && !f.cleared ? "#2e8b3a" : "#1a1008";
      ctx.fillRect(fx - 0.5 * u, fy - 7 * u, 1.5 * u, 9 * u);
      ctx.fillRect(fx + u - 0.5 * u, fy - 7.5 * u, 7 * u, 5 * u);
      ctx.fillStyle = color;
      ctx.fillRect(fx + u, fy - 7 * u, 6 * u, 4 * u);
      // Forts phase F: a crown over this clan's vassals.
      if (f.vassalOf !== undefined && f.vassalOf === game.myClan && !f.cleared && !f.captured) {
        ctx.fillStyle = "#f1c40f";
        ctx.fillRect(fx + u, fy - 9.5 * u, 6 * u, 1.5 * u);
        for (const dx of [1, 3.5, 6]) ctx.fillRect(fx + dx * u - 0.5 * u, fy - 11 * u, u, 1.5 * u);
      }
    }
    for (const { x: tcX, y: tcY } of game.latestTownCenters) {
      const size = 7 * u;
      const cx = (tcX + 0.5) * s;
      const cy = (tcY + 0.5) * s;
      ctx.fillStyle = "#2e1a0c";
      ctx.fillRect(cx - size / 2 - u, cy - size / 2 - u, size + 2 * u, size + 2 * u);
      ctx.fillStyle = "#7a1f1a";
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(cx - 1.5 * u, cy - 1.5 * u, 3 * u, 3 * u);
    }

    // Forts phase D2: a quest marker (gold diamond; green once accepted) on each open quest's target tile.
    for (const q of game.latestQuests) {
      const qx = (q.x + 0.5) * s;
      const qy = (q.y + 0.5) * s;
      const r = 4.5 * u;
      // Batch 2 (SPRITES.md #81): the quest seal icon once it has loaded, else the drawn diamond.
      const seal = q.accepted ? QUEST_MARKER_IMAGES.active : QUEST_MARKER_IMAGES.fresh;
      if (seal.complete && seal.naturalWidth > 0) {
        ctx.drawImage(seal, qx - 2.2 * r, qy - 2.2 * r, 4.4 * r, 4.4 * r);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(qx, qy - r - u);
      ctx.lineTo(qx + r + u, qy);
      ctx.lineTo(qx, qy + r + u);
      ctx.lineTo(qx - r - u, qy);
      ctx.closePath();
      ctx.fillStyle = "#1a0f06";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(qx, qy - r);
      ctx.lineTo(qx + r, qy);
      ctx.lineTo(qx, qy + r);
      ctx.lineTo(qx - r, qy);
      ctx.closePath();
      ctx.fillStyle = q.accepted ? "#5fd35a" : "#f1c40f";
      ctx.fill();
    }

    const adventureMarker=adventureMapMarker();if(adventureMarker){const x=(adventureMarker.x+.5)*s,y=(adventureMarker.y+.5)*s;ctx.beginPath();ctx.arc(x,y,5*u,0,Math.PI*2);ctx.fillStyle='#8a448b';ctx.fill();ctx.lineWidth=2*u;ctx.strokeStyle='#fff1b8';ctx.stroke();}

    // Camp hearths, once explored: a small ember dot with a dark rim on the camp's centre.
    for (const index of game.latestHearths) {
      if (!explored[index]) continue;
      const cx = ((index % game.worldTilesX) + 0.5) * s;
      const cy = (Math.floor(index / game.worldTilesX) + 0.5) * s;
      const r = 2.5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - r - u, cy - r - u, 2 * (r + u), 2 * (r + u));
      ctx.fillStyle = "#ff7a1a";
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }

    // The Castle Ruin, once its centre tile is explored: its 9x9 walls outlined, a red keep in the middle.
    if (game.castleRuinTile && explored[game.castleRuinTile.y * game.worldTilesX + game.castleRuinTile.x]) {
      const half = 4.5 * s;
      const cx = (game.castleRuinTile.x + 0.5) * s;
      const cy = (game.castleRuinTile.y + 0.5) * s;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = "#d8cfbf";
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      const keep = 5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - keep / 2 - u, cy - keep / 2 - u, keep + 2 * u, keep + 2 * u);
      ctx.fillStyle = "#a8321e";
      ctx.fillRect(cx - keep / 2, cy - keep / 2, keep, keep);
    }

    // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with
    // the server's vision radii. Mobs outside it aren't drawn, even on explored ground.
    const sources = liveVisionSources(players, colonists).map((v) => ({ x: v.x, y: v.y, r2: v.r * v.r }));

    ctx.fillStyle = "#f3da98";
    for (const c of colonists) {
      if (!explored[tileOf(c.y) * game.worldTilesX + tileOf(c.x)]) continue;
      ctx.fillRect(Math.round(toMap(c.x) - u), Math.round(toMap(c.y) - u), 2 * u, 2 * u);
    }
    // Forts phase E: own trader wagons on the road, a bigger gold dot with a dark rim.
    for (const c of colonists) {
      if (!c.wagon || c.wagon.leg === "home" || (c.clan ?? 0) !== game.myClan) continue;
      const r = 2.5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(toMap(c.x) - r - u, toMap(c.y) - r - u, 2 * (r + u), 2 * (r + u));
      ctx.fillStyle = "#f1c40f";
      ctx.fillRect(toMap(c.x) - r, toMap(c.y) - r, 2 * r, 2 * r);
    }
    ctx.fillStyle = "#f3da98";

    for (const m of mobs) {
      const mx = tileOf(m.x);
      const my = tileOf(m.y);
      const seen = sources.some((src) => (src.x - mx) ** 2 + (src.y - my) ** 2 <= src.r2);
      if (!seen) continue;
      const x = Math.round(toMap(m.x) - 1.5 * u);
      const y = Math.round(toMap(m.y) - 1.5 * u);
      ctx.fillStyle = "#1a0505";
      ctx.fillRect(x - u, y - u, 5 * u, 5 * u);
      ctx.fillStyle = "#ff3b2a";
      ctx.fillRect(x, y, 3 * u, 3 * u);
    }

    for (const p of players) {
      if (p.id === game.myId) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.y), 3 * u, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(p.color);
      ctx.fill();
      ctx.lineWidth = u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
    }

    const me = players.find((p) => p.id === game.myId);
    if (me) {
      ctx.beginPath();
      ctx.arc(toMap(me.x), toMap(me.y), 4 * u, 0, Math.PI * 2);
      ctx.lineWidth = 3.5 * u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
      ctx.lineWidth = 1.75 * u;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // Main camera viewport (worldLayer is scaled by camZoom and offset to the camera focus).
    const viewX = toMap(-worldLayer.position.x / game.camZoom);
    const viewY = toMap(-worldLayer.position.y / game.camZoom);
    const viewW = toMap(app.screen.width / game.camZoom);
    const viewH = toMap(app.screen.height / game.camZoom);
    ctx.lineWidth = u;
    ctx.strokeStyle = "rgba(251, 236, 200, 0.85)";
    ctx.strokeRect(Math.round(viewX) + u / 2, Math.round(viewY) + u / 2, Math.round(viewW) - u, Math.round(viewH) - u);
    game.drawFightPings(ctx, s, u);
    ctx.restore();
  }
  return { paintMinimapTile, resetMinimap, drawMinimap, markExplored, liveVisionSources, minimapTileAt, minimapEl, get explored() { return explored; }, get minimapCssPerTile() { return minimapCssPerTile; } };
}
