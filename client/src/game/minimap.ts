// Fog-of-war minimap (DOM canvas, bottom-right): static 1 px/tile layer, explored mask, live dots, click-to-jump.
import {
  Biome, TileType, type PlayerSnapshot, type ColonistSnapshot, VISION_RADIUS_PLAYER, VISION_RADIUS_COLONIST,
  type MobSnapshot, type SiteFaction, type RelationTier
} from "@colony/shared/protocol";
import { MinimapClass, minimapCellClass, minimapClassOf, decodeMaskRuns } from "@colony/shared/streaming";
import {
  Texture, CanvasSource, type Application, type Renderer, type Sprite, type Container, type ContainerChild
} from "pixi.js";
import type { VisionSource } from "../strategy/lod";
import { QUEST_MARKER_IMAGES } from "../worldVisuals";
import type { MainState } from "./state";
import type { StrategyCamera } from "../strategy/camera";

// What this module reads from main() (late fields are read through `deps` at call time: declared after this module's setup).
export interface MinimapDeps {
  app: Application<Renderer>;
  chunkOfTile: (tx: number, ty: number) => number;
  drawFightPings: (ctx: CanvasRenderingContext2D, s: number, u: number) => void;
  FORT_FLAG_COLOR: Record<SiteFaction, string>;
  RELATION_TIER_COLOR: Record<RelationTier, string>;
  S: MainState;
  strategicMapSprite: Sprite;
  strategyCam: StrategyCamera;
  worldLayer: Container<ContainerChild>;
}

export function setupMinimap(deps: MinimapDeps) {
  const {
    app, chunkOfTile, drawFightPings, FORT_FLAG_COLOR, RELATION_TIER_COLOR, S, strategicMapSprite, strategyCam,
    worldLayer
  } = deps;
  // ---- Fog-of-war minimap (DOM canvas, bottom-right; the main view is never fogged) ----
  // Static layer: one pixel per tile in an offscreen canvas, rebuilt whole only on `welcome` and
  // patched per tile on tileUpdate / explored. Each snapshot just blits it and draws the live dots
  // and camera rect on top, so nothing repaints the whole map per frame.
  const minimapEl = document.getElementById("minimap") as HTMLCanvasElement;
  minimapEl.addEventListener("contextmenu", (e) => e.preventDefault());
  const minimapCtx = minimapEl.getContext("2d")!;
  const minimapStatic = document.createElement("canvas");
  const minimapStaticCtx = minimapStatic.getContext("2d")!;
  S.minimapImage = null;
  S.minimapStaticDirty = false;
  // The strategic map sprite's texture needs a re-upload from minimapStatic (done only in the Map band).
  S.strategicMapDirty = false;
  S.explored = new Uint8Array(0);
  const MINIMAP_TARGET_CSS_PX = 180;
  // Both integers, so tile -> pixel stays exact: CSS px per tile, and backing px per CSS px.
  S.minimapCssPerTile = 1;
  S.minimapDpr = 1;
  // Compact / expanded: a big world's minimap used to be the whole map at >= 1 px per tile (512 px on a 512 map). Now it is a
  // MM_COMPACT_CSS window around the player at 1 px per tile (about 11 x 11 chunks) with a button to expand to the whole map,
  // shrunk to fit the screen. The strategy view always shows the whole map (its click-to-jump needs it). Maps that already fit
  // the compact window have no button.
  const MM_COMPACT_CSS = 176;
  S.mmExpanded = false;
  try { S.mmExpanded = localStorage.getItem("colony-minimap-expanded") === "1"; } catch { /* storage unavailable */ }
  S.mmFull = true; // the canvas currently shows the whole world
  S.mmBaseCss = 1; // CSS px per tile of the whole-world view (before the screen-fit cap)
  const minimapToggleEl = document.getElementById("minimap-toggle") as HTMLButtonElement | null;
  // Top-left of the visible window, in backing px of the map-space the drawing code works in (0, 0 when the whole map shows).
  S.mmOx = 0;
  S.mmOy = 0;
  function minimapFullCss(): number {
    const world = Math.max(S.worldTilesX, S.worldTilesY, 1);
    const cap = Math.max(MM_COMPACT_CSS, Math.min(window.innerWidth * 0.3, window.innerHeight * 0.5, 380));
    return Math.min(S.mmBaseCss, cap / world);
  }
  function minimapCanToggle(): boolean {
    return Math.max(S.worldTilesX, S.worldTilesY) * S.mmBaseCss > MM_COMPACT_CSS * 1.15;
  }
  function minimapWantsFull(): boolean {
    return !minimapCanToggle() || S.mmExpanded || strategyCam.inStrategy;
  }
  function applyMinimapLayout() {
    S.mmFull = minimapWantsFull();
    S.minimapDpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    S.minimapCssPerTile = S.mmFull ? minimapFullCss() : 1;
    const cssW = S.mmFull ? S.worldTilesX * S.minimapCssPerTile : Math.min(MM_COMPACT_CSS, S.worldTilesX * S.minimapCssPerTile);
    const cssH = S.mmFull ? S.worldTilesY * S.minimapCssPerTile : Math.min(MM_COMPACT_CSS, S.worldTilesY * S.minimapCssPerTile);
    minimapEl.width = Math.max(1, Math.ceil(cssW * S.minimapDpr));
    minimapEl.height = Math.max(1, Math.ceil(cssH * S.minimapDpr));
    minimapEl.style.width = `${cssW}px`;
    minimapEl.style.height = `${cssH}px`;
    if (minimapToggleEl) {
      minimapToggleEl.hidden = !minimapCanToggle() || strategyCam.inStrategy;
      minimapToggleEl.textContent = S.mmExpanded ? "\u2921" : "\u2922";
      minimapToggleEl.title = S.mmExpanded ? "Shrink the minimap to the area around you" : "Expand the minimap to the whole map";
      minimapToggleEl.setAttribute("aria-label", minimapToggleEl.title);
    }
  }
  minimapToggleEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    S.mmExpanded = !S.mmExpanded;
    try { localStorage.setItem("colony-minimap-expanded", S.mmExpanded ? "1" : "0"); } catch { /* storage unavailable */ }
    applyMinimapLayout();
  });
  minimapToggleEl?.addEventListener("pointerdown", (e) => e.stopPropagation());
  window.addEventListener("resize", () => { if (S.minimapImage) applyMinimapLayout(); });
  // The world tile under a pointer on the minimap (accounts for the compact window's offset).
  function minimapTileAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = minimapEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const sBack = S.minimapCssPerTile * S.minimapDpr;
    return { x: (S.mmOx + ((clientX - r.left) / r.width) * minimapEl.width) / sBack, y: (S.mmOy + ((clientY - r.top) / r.height) * minimapEl.height) / sBack };
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
    if (!S.explored[index]) return MINIMAP_UNEXPLORED;
    // Forts phase A: an NPC fort's walls / buildings.
    if (S.siteOwners.has(index)) return MINIMAP_RUIN;
    const tile = S.tiles[index] ?? TileType.Empty;
    switch (tile) {
      case TileType.Empty:
        return MINIMAP_BIOME[S.biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
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
        return MINIMAP_BIOME[S.biomes[index] ?? Biome.Plains] ?? MINIMAP_BIOME[Biome.Plains];
      case TileType.Rock:
        return MINIMAP_ROCK;
      case TileType.IronOre:
        return MINIMAP_IRON;
      case TileType.CoalSeam:
        return MINIMAP_COAL;
      case TileType.CopperOre:
        return MINIMAP_COPPER;
      case TileType.TinOre:
        return MINIMAP_TIN;
      case TileType.Limestone:
        return MINIMAP_LIMESTONE;
      case TileType.GoldOre:
        return MINIMAP_GOLD;
      case TileType.LeadOre:
        return MINIMAP_LEAD;
      case TileType.Wall:
      case TileType.StoneWall:
      case TileType.Gate:
      case TileType.FenceGate:
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
    const sm = S.streamed!;
    const tx = index % S.worldTilesX;
    const ty = Math.floor(index / S.worldTilesX);
    const cx = Math.floor(tx / sm.f);
    const cy = Math.floor(ty / sm.f);
    const cell = cy * sm.cw + cx;
    if (S.chunkLoaded[chunkOfTile(tx, ty)]) {
      sm.cells[cell] = minimapCellClass(S.tiles, S.biomes, S.worldTilesX, S.worldTilesY, cx, cy, sm.f, (i) => S.siteOwners.has(i));
    } else {
      const k = minimapClassOf(S.tiles[index] ?? 0, S.biomes[index] ?? 0, S.siteOwners.has(index));
      if (k >= MinimapClass.Wall) sm.cells[cell] = k;
    }
    if (S.explored[index]) sm.cellSeen[cell] = 1;
    paintMinimapPixel(cell, sm.cellSeen[cell] ? MINIMAP_CLASS_COLOR[sm.cells[cell]] : MINIMAP_UNEXPLORED);
  }
  function paintMinimapPixel(pixel: number, color: number) {
    const o = pixel * 4;
    S.minimapImage!.data[o] = color >> 16;
    S.minimapImage!.data[o + 1] = (color >> 8) & 0xff;
    S.minimapImage!.data[o + 2] = color & 0xff;
    S.minimapImage!.data[o + 3] = 255;
    S.minimapStaticDirty = true;
  }

  function paintMinimapTile(index: number) {
    if (!S.minimapImage) return;
    if (S.streamed) return paintMinimapCell(index);
    const color = minimapTileColor(index);
    const o = index * 4;
    S.minimapImage.data[o] = color >> 16;
    S.minimapImage.data[o + 1] = (color >> 8) & 0xff;
    S.minimapImage.data[o + 2] = color & 0xff;
    S.minimapImage.data[o + 3] = 255;
    S.minimapStaticDirty = true;
  }

  // `welcome` (join or restart): unpack the bitset and rebuild the whole static layer once.
  function resetMinimap(packedExplored: string) {
    const count = S.worldTilesX * S.worldTilesY;
    if (S.streamed) {
      S.explored = decodeMaskRuns(packedExplored, count);
    } else {
      const bytes = atob(packedExplored);
      S.explored = new Uint8Array(count);
      for (let i = 0; i < count; i++) S.explored[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
    }
    // World streaming phase 4: a streamed world's minimap is one CSS px per summary cell (1 / f px per tile).
    S.mmBaseCss = S.streamed ? 1 / S.streamed.f : Math.max(1, Math.round(MINIMAP_TARGET_CSS_PX / Math.max(S.worldTilesX, S.worldTilesY)));
    applyMinimapLayout();
    if (S.streamed) {
      const sm = S.streamed;
      for (let i = 0; i < count; i++) if (S.explored[i]) sm.cellSeen[Math.floor(Math.floor(i / S.worldTilesX) / sm.f) * sm.cw + Math.floor((i % S.worldTilesX) / sm.f)] = 1;
      minimapStatic.width = sm.cw;
      minimapStatic.height = sm.ch;
      S.minimapImage = minimapStaticCtx.createImageData(sm.cw, sm.ch);
      for (let c = 0; c < sm.cw * sm.ch; c++) paintMinimapPixel(c, sm.cellSeen[c] ? MINIMAP_CLASS_COLOR[sm.cells[c]] : MINIMAP_UNEXPLORED);
    } else {
      minimapStatic.width = S.worldTilesX;
      minimapStatic.height = S.worldTilesY;
      S.minimapImage = minimapStaticCtx.createImageData(S.worldTilesX, S.worldTilesY);
      for (let i = 0; i < count; i++) paintMinimapTile(i);
    }
    // The canvas was resized: a fresh texture for the strategic map sprite.
    if (strategicMapSprite.texture !== Texture.EMPTY) strategicMapSprite.texture.destroy(true);
    strategicMapSprite.texture = new Texture({ source: new CanvasSource({ resource: minimapStatic, scaleMode: "nearest" }) });
    strategicMapSprite.scale.set(S.tileSize * (S.streamed?.f ?? 1));
    S.strategicMapDirty = true;
  }

  function markExplored(indices: number[]) {
    for (const i of indices) {
      if (i < 0 || i >= S.explored.length || S.explored[i]) continue;
      S.explored[i] = 1;
      paintMinimapTile(i);
    }
  }

  // Live view right now: players and the colony's own colonists (not the Abbey's clergy), with the
  // server's vision radii (minimap enemy dots and the strategy fog share it).
  function liveVisionSources(players: PlayerSnapshot[], colonists: ColonistSnapshot[]): VisionSource[] {
    const tileOf = (worldPx: number) => Math.floor(worldPx / S.tileSize);
    const sources: VisionSource[] = [];
    for (const p of players) sources.push({ x: tileOf(p.x), y: tileOf(p.y), r: VISION_RADIUS_PLAYER });
    for (const c of colonists) {
      if (S.tiles[c.postY * S.worldTilesX + c.postX] === TileType.AbbeyHall) continue;
      sources.push({ x: tileOf(c.x), y: tileOf(c.y), r: VISION_RADIUS_COLONIST });
    }
    return sources;
  }

  function cssColor(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
  }

  function drawMinimap(players: PlayerSnapshot[], colonists: ColonistSnapshot[], mobs: MobSnapshot[]) {
    if (!S.minimapImage) return;
    if (S.minimapStaticDirty) {
      minimapStaticCtx.putImageData(S.minimapImage, 0, 0);
      S.minimapStaticDirty = false;
      S.strategicMapDirty = true;
    }
    if (minimapWantsFull() !== S.mmFull) applyMinimapLayout();
    const ctx = minimapCtx;
    const s = S.minimapCssPerTile * S.minimapDpr; // backing px per tile
    const u = S.minimapDpr; // backing px per CSS px
    const toMap = (worldPx: number) => (worldPx / S.tileSize) * s;
    const tileOf = (worldPx: number) => Math.floor(worldPx / S.tileSize);
    // Compact window: centred on the player (or the camera when there is none), kept inside the map. Everything below draws in
    // whole-map space; the translate moves the window onto the canvas.
    S.mmOx = 0;
    S.mmOy = 0;
    if (!S.mmFull) {
      const focus = players.find((p) => p.id === S.myId);
      const fx = focus ? toMap(focus.x) : toMap(-worldLayer.position.x / S.camZoom + app.screen.width / S.camZoom / 2);
      const fy = focus ? toMap(focus.y) : toMap(-worldLayer.position.y / S.camZoom + app.screen.height / S.camZoom / 2);
      S.mmOx = Math.round(Math.max(0, Math.min(S.worldTilesX * s - minimapEl.width, fx - minimapEl.width / 2)));
      S.mmOy = Math.round(Math.max(0, Math.min(S.worldTilesY * s - minimapEl.height, fy - minimapEl.height / 2)));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimapEl.width, minimapEl.height);
    ctx.save();
    ctx.translate(-S.mmOx, -S.mmOy);
    ctx.imageSmoothingEnabled = false;
    {
      // Only the visible part of the static layer (one pixel per tile, or one per summary cell when streamed).
      const per = minimapStatic.width / S.worldTilesX; // static px per tile
      const sx = (S.mmOx / s) * per;
      const sy = (S.mmOy / s) * per;
      const sw = Math.min(minimapStatic.width - sx, (minimapEl.width / s) * per);
      const sh = Math.min(minimapStatic.height - sy, (minimapEl.height / s) * per);
      if (sw > 0 && sh > 0) ctx.drawImage(minimapStatic, sx, sy, sw, sh, S.mmOx, S.mmOy, (sw / per) * s, (sh / per) * s);
    }

    // Forts phase B: a flag on each explored fort's keep (faction colour; grey = razed, clan colour = captured).
    for (const f of S.fortMarkers) {
      const fx = (f.keepX + 0.5) * s;
      const fy = (f.keepY + 0.5) * s;
      const color = f.captured
        ? `#${(S.clanColors.get(f.capturedBy ?? 0) ?? 0x3a7bd5).toString(16).padStart(6, "0")}`
        : f.cleared ? "#8a8a8a" : f.hostile ? "#c0392b"
        : f.vassalOf !== undefined && f.vassalOf !== S.myClan ? "#a0743a"
        : f.faction === "human" && f.num !== undefined && S.siteRelations.has(f.num) ? RELATION_TIER_COLOR[S.siteRelations.get(f.num)!.tier]
        : FORT_FLAG_COLOR[f.faction];
      // Forts phase C: a human settlement's flag has a green edge (white = neutral, red = hostile).
      ctx.fillStyle = f.faction === "human" && !f.captured && !f.cleared ? "#2e8b3a" : "#1a1008";
      ctx.fillRect(fx - 0.5 * u, fy - 7 * u, 1.5 * u, 9 * u);
      ctx.fillRect(fx + u - 0.5 * u, fy - 7.5 * u, 7 * u, 5 * u);
      ctx.fillStyle = color;
      ctx.fillRect(fx + u, fy - 7 * u, 6 * u, 4 * u);
      // Forts phase F: a crown over this clan's vassals.
      if (f.vassalOf !== undefined && f.vassalOf === S.myClan && !f.cleared && !f.captured) {
        ctx.fillStyle = "#f1c40f";
        ctx.fillRect(fx + u, fy - 9.5 * u, 6 * u, 1.5 * u);
        for (const dx of [1, 3.5, 6]) ctx.fillRect(fx + dx * u - 0.5 * u, fy - 11 * u, u, 1.5 * u);
      }
    }
    for (const { x: tcX, y: tcY } of S.latestTownCenters) {
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
    for (const q of S.latestQuests) {
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

    // Camp hearths, once explored: a small ember dot with a dark rim on the camp's centre.
    for (const index of S.latestHearths) {
      if (!S.explored[index]) continue;
      const cx = ((index % S.worldTilesX) + 0.5) * s;
      const cy = (Math.floor(index / S.worldTilesX) + 0.5) * s;
      const r = 2.5 * u;
      ctx.fillStyle = "#1a0f06";
      ctx.fillRect(cx - r - u, cy - r - u, 2 * (r + u), 2 * (r + u));
      ctx.fillStyle = "#ff7a1a";
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }

    // The Castle Ruin, once its centre tile is explored: its 9x9 walls outlined, a red keep in the middle.
    if (S.castleRuinTile && S.explored[S.castleRuinTile.y * S.worldTilesX + S.castleRuinTile.x]) {
      const half = 4.5 * s;
      const cx = (S.castleRuinTile.x + 0.5) * s;
      const cy = (S.castleRuinTile.y + 0.5) * s;
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
      if (!S.explored[tileOf(c.y) * S.worldTilesX + tileOf(c.x)]) continue;
      ctx.fillRect(Math.round(toMap(c.x) - u), Math.round(toMap(c.y) - u), 2 * u, 2 * u);
    }
    // Forts phase E: own trader wagons on the road, a bigger gold dot with a dark rim.
    for (const c of colonists) {
      if (!c.wagon || c.wagon.leg === "home" || (c.clan ?? 0) !== S.myClan) continue;
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
      if (p.id === S.myId) continue;
      ctx.beginPath();
      ctx.arc(toMap(p.x), toMap(p.y), 3 * u, 0, Math.PI * 2);
      ctx.fillStyle = cssColor(p.color);
      ctx.fill();
      ctx.lineWidth = u;
      ctx.strokeStyle = "#1a0f06";
      ctx.stroke();
    }

    const me = players.find((p) => p.id === S.myId);
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
    const viewX = toMap(-worldLayer.position.x / S.camZoom);
    const viewY = toMap(-worldLayer.position.y / S.camZoom);
    const viewW = toMap(app.screen.width / S.camZoom);
    const viewH = toMap(app.screen.height / S.camZoom);
    ctx.lineWidth = u;
    ctx.strokeStyle = "rgba(251, 236, 200, 0.85)";
    ctx.strokeRect(Math.round(viewX) + u / 2, Math.round(viewY) + u / 2, Math.round(viewW) - u, Math.round(viewH) - u);
    drawFightPings(ctx, s, u);
    ctx.restore();
  }
  return {
    paintMinimapTile, resetMinimap, drawMinimap, markExplored, liveVisionSources, minimapTileAt, minimapEl
  };
}
