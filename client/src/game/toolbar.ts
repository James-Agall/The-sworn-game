// Toolbar: tool buttons, category tabs, tool selection, build requirements and the progression panel; runs
// the toolbar's initial setup at its original position. Split out of main.ts (2026-11-27).
import { type GoodKey } from "../economyPanel";
import { setupProgressionPanel } from "../progressionPanel";
import { Sprite } from "pixi.js";
import { STRUCTURE_FURNITURE_ART, iconImg } from "../spriteRegistry";
import { setupZones } from "../zones";
import { setupBlueprints } from "../blueprints";
import { BLUEPRINT_TOOL } from "@colony/shared/buildingTemplates";
import { ZONE_TOOL_ANIMAL, ZONE_TOOL_ERASE, ZONE_TOOL_HEMP, ZONE_TOOL_HOME, ZONE_TOOL_STOCKPILE, ZONE_TOOL_WHEAT, isZoneTool } from "@colony/shared/zones";
import { ROOM_TOOL_STONE, ROOM_TOOL_WOOD } from "@colony/shared/structures";
import { isRoadTile, TileType } from "@colony/shared/protocol";
import { type ToolCategory, TOOL_CATEGORIES, TOOLS, TOOL_NONE } from "../tools";
import { TILE_SPRITE_FILES, TILE_OPTIONAL_ART } from "../worldVisuals";
import type { ArmyOrderKind } from "@colony/shared/protocol";

// Closure state from main.ts. Plain fields are fixed references (objects mutated in place, functions); the
// readonly / settable ones are live getters (or setters) onto main's `let` variables.
export interface ToolbarContext {
  zonesUi: ReturnType<typeof setupZones>;
  blueprintsUi: ReturnType<typeof setupBlueprints>;
  placementGhost: Sprite;
  configurePlacementGhost: (tool: TileType) => void;
  buildRequirementsEl: HTMLElement;
  sendMessage: (msg: object) => void;
  GOODS_GROUPS: { heading: string; goods: { key: GoodKey; label: string; }[]; }[];
  latestStock: Partial<Record<GoodKey, number>>;
  setGoodCount: (key: string, n: number) => void;
  activeCategory: ToolCategory;
  readonly creativeWorld: boolean;
  currentTool: TileType;
  readonly selectedIds: Set<string>;
  readonly setSelection: (ids: Iterable<string>) => void;
  readonly strategyOrderKey: (e: KeyboardEvent) => ArmyOrderKind | null;
}

export function createToolbar(game: ToolbarContext) {
  const { zonesUi, blueprintsUi, placementGhost, configurePlacementGhost, buildRequirementsEl, sendMessage, GOODS_GROUPS, latestStock, setGoodCount } = game;
  const toolButtonEls = new Map<TileType, HTMLButtonElement>();
  const categoryTabEls = new Map<ToolCategory, HTMLButtonElement>();
  function setupToolbar() {
    const container = document.getElementById("toolbar")!;
    for (const tool of TOOLS) {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      const toolIcons:Record<number,string>={
        [ZONE_TOOL_WHEAT]:'crops/crop_wheat_stage5',[ZONE_TOOL_HEMP]:'crops/hemp_ripe',
        [ZONE_TOOL_STOCKPILE]:'structure/chest',[ZONE_TOOL_HOME]:'cottage',[ZONE_TOOL_ANIMAL]:'fortifications/fence_h',
        [ZONE_TOOL_ERASE]:'icons/tool_hoe',[TileType.Empty]:'icons/tool_pickaxe',[BLUEPRINT_TOOL]:'icons/work_building',
        [ROOM_TOOL_WOOD]:'woodWall',[ROOM_TOOL_STONE]:'stoneWall',
        [TileType.WoodFloor]:'structure/floor_wood_1',[TileType.StoneFloor]:'structure/floor_stone_1',
        [TileType.WoodDoor]:'structure/door_wood_h_closed',[TileType.StoneDoor]:'structure/door_stone_h_closed',
        [TileType.WoodWindow]:'structure/window_wood_h',[TileType.StoneWindow]:'structure/window_stone_h',
      };
      const name=toolIcons[tool.tile]??TILE_OPTIONAL_ART[tool.tile]??TILE_SPRITE_FILES[tool.tile]??'icons/work_building';
      const icon=iconImg(STRUCTURE_FURNITURE_ART[tool.tile]??`/sprites/${name}.png`,28,tool.label);icon.className='build-tool-icon';
      btn.append(icon,document.createTextNode(tool.key ? `${tool.label} (${tool.key})` : tool.label));
      btn.addEventListener("click", () => {
        selectTool(tool.tile, true);
        btn.blur();
      });
      container.appendChild(btn);
      toolButtonEls.set(tool.tile, btn);
    }
    refreshToolbarSelection();
  }
  function setupCategoryTabs() {
    const container = document.getElementById("build-category-tabs")!;
    for (const cat of TOOL_CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "category-tab";
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        game.activeCategory = cat.key;
        refreshToolbarVisibility();
        refreshCategoryTabSelection();
        btn.blur();
      });
      container.appendChild(btn);
      categoryTabEls.set(cat.key, btn);
    }
    refreshCategoryTabSelection();
  }
  function refreshCategoryTabSelection() {
    for (const [key, btn] of categoryTabEls) {
      btn.classList.toggle("selected", key === game.activeCategory);
    }
  }
  // Break is pinned and always shown, regardless of the active category tab.
  function refreshToolbarVisibility() {
    for (const tool of TOOLS) {
      const btn = toolButtonEls.get(tool.tile);
      if (!btn) continue;
      // Phase 3: retired tools (Farm Plot, Hemp Field) only in creative mode.
      const visible = (tool.tile === TileType.Empty || tool.category === game.activeCategory) && (!tool.legacy || game.creativeWorld);
      btn.style.display = visible ? "" : "none";
    }
    // The building templates (Blueprints) are hidden for now outside creative mode: the buildings are single sprites.
    if (game.activeCategory === "blueprints") game.activeCategory = TOOL_CATEGORIES[0].key;
    categoryTabEls.get("blueprints")?.style.setProperty("display", "none");
    zonesUi.setActive(game.activeCategory === "zones" || isZoneTool(game.currentTool));
    blueprintsUi.setActive(false);
  }
  function refreshToolbarSelection() {
    for (const [tile, btn] of toolButtonEls) {
      btn.classList.toggle("selected", tile === game.currentTool);
    }
  }
  function selectTool(tile: TileType, fromUser = false) {
    game.currentTool = tile;
    zonesUi.setActive(tile !== TOOL_NONE && (game.activeCategory === "zones" || isZoneTool(tile)));
    blueprintsUi.setActive(false);
    // Picking something to build puts the units down, so right-click places instead of giving orders.
    if (fromUser && tile !== TileType.Empty && game.selectedIds.size > 0) game.setSelection([]);
    if (tile !== TileType.TownCenter && !isRoadTile(tile)) placementGhost.visible = false;
    configurePlacementGhost(tile);
    refreshToolbarSelection();
    refreshBuildRequirements();
  }
  function refreshBuildRequirements() {
    if (game.currentTool === TOOL_NONE) {
      buildRequirementsEl.textContent = "";
      return;
    }
    const def = TOOLS.find((t) => t.tile === game.currentTool);
    const text = def && def.cost ? def.cost : "No requirements.";
    const needs = progressionUi.locked()[game.currentTool];
    buildRequirementsEl.textContent = needs ? `Locked. Needs: ${needs.join(", ")}. ${text}` : text;
  }
  const progressionUi = setupProgressionPanel({
    send: (m) => sendMessage(m),
    goodsGroups: GOODS_GROUPS,
    latestStock,
    setGoodCount,
    toolButtonEls,
    refreshBuildRequirements: () => refreshBuildRequirements(),
    strategyOrderKey: (e) => game.strategyOrderKey(e),
  });
  const { applyProgression, itemTotal } = progressionUi;
  setupToolbar();
  setupCategoryTabs();
  refreshToolbarVisibility();
  selectTool(game.currentTool);
  return { selectTool, progressionUi, toolButtonEls, refreshToolbarVisibility, applyProgression, refreshCategoryTabSelection, itemTotal };
}
