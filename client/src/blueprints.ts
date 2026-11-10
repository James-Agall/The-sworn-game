// blueprints.ts: the Build menu's Blueprints tab (building templates, shared/src/buildingTemplates.ts). A side panel
// lists every template (thumbnail drawn from its ASCII with the structure piece art, tier, size, rooms, cost, needs);
// picking one arms the "Place blueprint" tool: a ghost of its footprint follows the cursor (red where something is in
// the way), R turns it, M mirrors it, right-click sends placeBlueprint (the server orders every piece as a blueprint).
import { Container, Graphics, type Texture } from "pixi.js";
import { TileType, type ClientMessage } from "@colony/shared/protocol";
import {
  BUILDING_LEGEND, BUILDING_TYPE_LABEL, type BuildingTemplate, buildingBareInterior, buildingCells, buildingCostText, buildingOrigin,
  buildingStats,
} from "@colony/shared/buildingTemplates";
import { isFloorTile, isStructureTile, structurePlacementOk } from "@colony/shared/structures";
import type { StructureTextures } from "./structureArt";

export interface BlueprintsDeps {
  send(m: ClientMessage): void;
  tileSize(): number;
  // The client's tile at (x, y), -1 off the map.
  tileAt(x: number, y: number): number;
  textures: StructureTextures;
  // Arms the Place blueprint tool (after a template is picked).
  arm(): void;
}

const THUMB = 84;

// Draws a texture (a canvas / image backed Pixi texture) into a 2d canvas cell; false when it has no drawable source.
function drawTex(g: CanvasRenderingContext2D, tex: Texture, x: number, y: number, s: number): boolean {
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src) return false;
  const f = tex.frame;
  try {
    g.drawImage(src, f.x, f.y, f.width, f.height, x, y, s, s);
    return true;
  } catch {
    return false;
  }
}

// A thumbnail of the template's grid: floors / beds / furniture / doors / windows with the piece art, walls and
// stations as colour blocks (stand-ins until the piece art covers them).
export function drawBlueprintThumb(canvas: HTMLCanvasElement, rows: string[], tex: StructureTextures | null) {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const cs = Math.max(4, Math.floor(THUMB / Math.max(w, h, 1)));
  canvas.width = w * cs;
  canvas.height = h * cs;
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#c9d6a0";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const at = (x: number, y: number) => BUILDING_LEGEND[rows[y]?.[x] ?? "."];
  const wallish = (x: number, y: number) => {
    const k = at(x, y)?.kind;
    return k === "wall" || k === "window" || k === "door";
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = at(x, y);
    if (!s || s.tile === undefined) continue;
    const px = x * cs;
    const py = y * cs;
    const stone = s.tile === TileType.StoneWall || s.tile === TileType.StoneDoor || s.tile === TileType.StoneWindow || s.tile === TileType.StoneFloor;
    const horizontal = wallish(x - 1, y) || wallish(x + 1, y);
    let done = false;
    if (tex) {
      if (s.kind === "floor") done = drawTex(g, tex.floor(s.tile, x * 7 + y * 13)!.texture, px, py, cs);
      else if (s.kind === "furniture") {
        drawTex(g, tex.floor(TileType.WoodFloor, x + y)!.texture, px, py, cs);
        done = drawTex(g, tex.furniture(s.tile).texture, px, py, cs);
      } else if (s.kind === "door") done = drawTex(g, tex.door(stone, horizontal, false).texture, px, py, cs);
      else if (s.kind === "window") done = drawTex(g, tex.window(stone, horizontal).texture, px, py, cs);
    }
    if (!done) {
      g.fillStyle = s.color;
      g.fillRect(px, py, cs, cs);
      if (s.kind === "station" || s.kind === "annex") {
        g.fillStyle = "#fff";
        g.font = `bold ${Math.max(6, cs - 2)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(rows[y][x], px + cs / 2, py + cs / 2 + 1);
      }
    }
  }
}

export function setupBlueprints(deps: BlueprintsDeps) {
  const overlay = new Container();
  const ghost = new Graphics();
  overlay.addChild(ghost);
  let templates: BuildingTemplate[] = [];
  let selected: BuildingTemplate | null = null;
  let transform = 0;
  let active = false;
  let hover: { x: number; y: number } | null = null;
  let asked = false;

  const panel = document.createElement("div");
  panel.id = "blueprint-panel";
  panel.style.cssText =
    "position: fixed; right: 12px; top: 120px; width: 300px; max-height: 64vh; overflow-y: auto; background: rgba(20,22,28,0.92);" +
    "color: #e8e8e8; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 8px; font: 12px sans-serif; z-index: 30; display: none;";
  document.body.appendChild(panel);
  const filter = document.createElement("select");
  filter.style.cssText = "width: 100%; margin: 4px 0; background: #2a2d36; color: #eee; border: 1px solid #555;";

  function render() {
    const head = document.createElement("div");
    head.style.cssText = "font-weight: bold; margin-bottom: 4px;";
    head.textContent = "Blueprints";
    const help = document.createElement("div");
    help.style.cssText = "opacity: 0.75; margin-bottom: 4px;";
    help.textContent = "Pick a building, then right-click the map to order it. R rotates, M mirrors. Builders raise it piece by piece; the cost is paid up front.";
    const kinds = Array.from(new Set(templates.map((t) => t.buildingType)));
    const keep = filter.value;
    filter.replaceChildren(new Option("All types", ""), ...kinds.map((k) => new Option(BUILDING_TYPE_LABEL[k] ?? k, k)));
    filter.value = kinds.includes(keep as BuildingTemplate["buildingType"]) ? keep : "";
    const rows: HTMLElement[] = [];
    for (const t of templates) {
      if (filter.value && t.buildingType !== filter.value) continue;
      const st = buildingStats(t);
      const row = document.createElement("div");
      row.style.cssText = `display: flex; gap: 6px; align-items: flex-start; padding: 4px; margin: 3px 0; cursor: pointer; border-radius: 4px; background: ${selected?.id === t.id ? "rgba(120,170,255,0.25)" : "rgba(255,255,255,0.04)"};`;
      const thumb = document.createElement("canvas");
      thumb.style.cssText = "image-rendering: pixelated; flex: none; max-width: 84px;";
      drawBlueprintThumb(thumb, t.rows, deps.textures);
      const text = document.createElement("div");
      text.innerHTML = "";
      const name = document.createElement("div");
      name.style.fontWeight = "bold";
      name.textContent = `${t.name}${t.builtin ? "" : " (user)"}`;
      const meta = document.createElement("div");
      meta.style.opacity = "0.8";
      meta.textContent = `${BUILDING_TYPE_LABEL[t.buildingType]} · tier ${t.tier} · ${st.w}x${st.h} · ${st.rooms.map((r) => r.role).join(" + ")}${st.beds ? ` · ${st.beds} beds` : ""}${st.yards ? ` · ${st.yards} yard` : ""}${st.passages ? ` · ${st.passages} gate passage${st.passages > 1 ? "s" : ""}` : ""}`;
      const cost = document.createElement("div");
      cost.textContent = `Cost: ${buildingCostText(st.cost)}`;
      text.append(name, meta, cost);
      // Gap closure G8: a keep template's anchor has the prefab Keep's gates (checked by the server on order).
      const needList = t.buildingType === "keep" ? [...st.needs, "a Town Center at level 2 (one Keep per settlement)"] : st.needs;
      if (needList.length) {
        const needs = document.createElement("div");
        needs.style.color = "#ffcf80";
        needs.textContent = `Needs: ${needList.join(", ")}`;
        text.append(needs);
      }
      row.append(thumb, text);
      row.addEventListener("click", () => {
        selected = t;
        transform = 0;
        deps.arm();
        render();
        drawGhost();
      });
      rows.push(row);
    }
    panel.replaceChildren(head, help, filter, ...rows);
  }
  filter.addEventListener("change", render);

  // Red where the ground is taken (the server checks it again, with range, cost and progression).
  function drawGhost() {
    ghost.clear();
    if (!active || !selected || !hover) return;
    const ts = deps.tileSize();
    const { w, h, cells } = buildingCells(selected, transform);
    const o = buildingOrigin(hover.x, hover.y, w, h);
    ghost.rect(o.x * ts, o.y * ts, w * ts, h * ts).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    for (const b of buildingBareInterior(selected, transform)) {
      const cur = deps.tileAt(o.x + b.x, o.y + b.y);
      if (cur !== TileType.Empty && !isFloorTile(cur)) ghost.rect((o.x + b.x) * ts, (o.y + b.y) * ts, ts, ts).fill({ color: 0xff3030, alpha: 0.35 });
    }
    for (const c of cells) {
      const cur = deps.tileAt(o.x + c.x, o.y + c.y);
      const ok = cur === c.tile || (isStructureTile(c.tile) ? cur >= 0 && structurePlacementOk(c.tile, cur) : cur === TileType.Empty || isFloorTile(cur));
      const color = Number.parseInt(BUILDING_LEGEND[c.ch].color.slice(1), 16);
      ghost.rect((o.x + c.x) * ts, (o.y + c.y) * ts, ts, ts).fill({ color: ok ? color : 0xff3030, alpha: ok ? 0.5 : 0.6 });
    }
  }

  const turn = (k: number) => {
    if (!selected) return;
    if (k === 1 && !selected.rotate) return;
    if (k === 4 && !selected.mirror) return;
    transform = k === 4 ? transform ^ 4 : (transform & 4) | ((transform + 1) & 3);
    drawGhost();
  };

  return {
    overlay,
    setActive(on: boolean) {
      active = on;
      panel.style.display = on ? "block" : "none";
      if (on && !asked) {
        asked = true;
        deps.send({ type: "blueprintList" });
      }
      drawGhost();
    },
    setList(list: BuildingTemplate[]) {
      templates = list.slice().sort((a, b) => (a.buildingType === b.buildingType ? a.tier - b.tier : a.buildingType < b.buildingType ? -1 : 1));
      if (selected) selected = templates.find((t) => t.id === selected!.id) ?? null;
      render();
    },
    hover(tile: { x: number; y: number } | null) {
      hover = tile;
      drawGhost();
    },
    // Right-click with the tool: order the picked template centred on the tile.
    place(x: number, y: number): boolean {
      if (!selected) return false;
      deps.send({ type: "placeBlueprint", id: selected.id, x, y, transform });
      return true;
    },
    // R / M while the tool is armed: true when the key was used.
    key(k: string): boolean {
      if (!active || !selected) return false;
      if (k === "r") turn(1);
      else if (k === "m") turn(4);
      else return false;
      return true;
    },
  };
}
