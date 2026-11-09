// RimWorld / Stardew art (2026-11-09, SPRITES.md #90-#97): files made from the sliced ChatGPT atlases by
// art-sources/rimworld-stardew/wire_sprites.py into client/public/sprites/<group>/. Every file here is OPTIONAL:
// the structure art loads through loadOptionalTextures (a missing png keeps the procedural stand-in in
// structureArt.ts), icons are <img>s that hide themselves if missing, and STAGED art is not loaded at all until a
// later phase asks for it (loadStaged).
import { Assets, Texture } from "pixi.js";
import { TileType } from "@colony/shared/protocol";

const S = "/sprites/structure/";

// ---- wired: modular building structure art ----
// Doors / windows are baked onto the wood / stone wall straights (same canvas and WALL_ART_PX_PER_TILE scale as
// the connected wall pieces); floors, rug and roofs are 64x64 tiles; furniture is upright art at 64 px per tile,
// drawn bottom-centred on its tile.
export const STRUCTURE_ART_PX_PER_TILE = 64;
export const structureDoorUrl = (stone: boolean, horizontal: boolean, open: boolean) =>
  `${S}door_${stone ? "stone" : "wood"}_${horizontal ? "h" : "v"}_${open ? "open" : "closed"}.png`;
export const structureWindowUrl = (stone: boolean, horizontal: boolean) =>
  `${S}window_${stone ? "stone" : "wood"}_${horizontal ? "h" : "v"}.png`;
export const FLOOR_VARIANTS = 3;
export const structureFloorUrl = (stone: boolean, variant: number) => `${S}floor_${stone ? "stone" : "wood"}_${variant + 1}.png`;
// Wood rooms: thatch; stone rooms: clay tile. Slate is staged (roof_slate.png) for a later roof choice.
export const structureRoofUrl = (stone: boolean) => `${S}roof_${stone ? "tile" : "thatch"}.png`;
export const STRUCTURE_FURNITURE_ART: Partial<Record<TileType, string>> = {
  [TileType.Bed]: `${S}bed.png`,
  [TileType.Table]: `${S}table.png`,
  [TileType.Chair]: `${S}chair.png`,
  [TileType.Chest]: `${S}chest.png`,
  [TileType.Shelf]: `${S}shelf.png`,
  [TileType.Hearth]: `${S}hearth.png`,
  [TileType.Lamp]: `${S}lamp.png`,
  [TileType.Rug]: `${S}rug.png`,
  [TileType.Workbench]: `${S}workbench.png`,
  [TileType.Statue]: `${S}statue.png`,
  [TileType.WeaponRack]: `${S}weapon_rack.png`,
};
export const STRUCTURE_ART_URLS: string[] = [
  ...[false, true].flatMap((stone) => [
    ...[false, true].flatMap((h) => [structureDoorUrl(stone, h, false), structureDoorUrl(stone, h, true), structureWindowUrl(stone, h)]),
    ...Array.from({ length: FLOOR_VARIANTS }, (_, v) => structureFloorUrl(stone, v)),
    structureRoofUrl(stone),
  ]),
  ...(Object.values(STRUCTURE_FURNITURE_ART) as string[]),
];

// ---- wired: HUD icons (32x32, shown at 14-18 px) ----
export const iconUrl = (name: string) => `/sprites/icons/${name}.png`;
// Room panel: role badge (RoomRole; "room" = no role has none) and the four stat icons.
export const roomRoleIconUrl = (role: string): string | undefined => (role === "room" ? undefined : iconUrl(`room_${role}`));
export const ROOM_STAT_ICON: Record<string, string> = {
  Size: iconUrl("stat_size"), Beauty: iconUrl("stat_beauty"), Cleanliness: iconUrl("stat_cleanliness"), Warmth: iconUrl("stat_warmth"),
};
// Zones panel stockpile filters (StockCategory; "other" has none).
export const stockIconUrl = (category: string): string | undefined => (category === "other" ? undefined : iconUrl(`stock_${category}`));
// Resources panel: items and gear that have a fitting icon (the rest keep the lettered chip).
export const ITEM_ICON: Record<string, string> = {
  "item:stoneAxe": iconUrl("tool_axe"),
  "item:stonePick": iconUrl("tool_pickaxe"),
  "item:smithTools": iconUrl("stock_tools"),
  "item:flour": iconUrl("tool_seedbag"),
  ...Object.fromEntries([1, 2, 3].flatMap((t) => [[`gear:weapon:${t}`, iconUrl("stock_weapons")], [`gear:armour:${t}`, iconUrl("stock_armour")]])),
};
// An <img> for a small HUD icon that removes itself if the file is missing.
export function iconImg(src: string, px: number, title = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.title = title;
  img.style.cssText = `width: ${px}px; height: ${px}px; vertical-align: middle; image-rendering: auto;`;
  img.addEventListener("error", () => img.remove());
  return img;
}

// ---- staged: copied, not used yet (later phases) ----
// Load on demand: `await loadStaged(STAGED.villager.sow)` -> textures in frame order (missing files are skipped).
const frames = (group: string, prefix: string, n: number) => Array.from({ length: n }, (_, i) => `/sprites/${group}/${prefix}_${i + 1}.png`);
export const STAGED = {
  // Single facing (3/4 front-right), one shared canvas per set, feet bottom-aligned (README "villager" atlas).
  villager: {
    sow: frames("villager", "sow", 5), water: frames("villager", "water", 5), harvest: frames("villager", "harvest", 5),
    haulSack: frames("villager", "haul_sack", 5), hammer: frames("villager", "hammer", 5), chop: frames("villager", "chop", 3),
    mine: frames("villager", "mine", 2), cook: frames("villager", "cook", 3), sleepBed: frames("villager", "sleep_bed", 2),
    eatTableA: frames("villager", "eat_table_a", 3), eatTableB: frames("villager", "eat_table_b", 3), sit: frames("villager", "sit", 2),
    bowlCarry: frames("villager", "bowl_carry", 5),
    // The straw-hat farmer of the builder atlas (a different character).
    farmerHaulA: frames("villager", "farmer_haul_a", 5), farmerHaulB: frames("villager", "farmer_haul_b", 5),
  },
  ui: { staminaBar: "/sprites/ui/stamina_bar.png", hotbarA: "/sprites/ui/hotbar_a.png", hotbarB: "/sprites/ui/hotbar_b.png" },
  // Seasons (#94): trees, ground tiles, water; weather overlays are OPAQUE baked tiles (reference only).
  seasons: ["tree_spring_blossom", "tree_summer_green", "tree_autumn_orange", "tree_winter_snow", "ground_spring_flowers", "ground_summer_grass", "ground_autumn_leaves", "ground_winter_snow", "tile_water_frozen_or_water"].map((n) => `/sprites/seasons/${n}.png`),
  weather: ["rain", "snow", "fog", "storm"].map((n) => `/sprites/weather/weather_${n}.png`),
  // Animals (#96): single pose each; buildings occupied-only.
  animals: ["animal_chicken_hen", "animal_chicken_rooster", "animal_chick_a", "animal_chick_b", "animal_cow", "animal_cow_and_calf_pair", "animal_pig", "animal_sheep_a", "animal_sheep_b", "animal_horse_brown", "animal_horse_gray", "animal_pony_brown", "animal_foal_or_calf", "animal_dog_brown", "animal_dog_gray", "animal_cat_dark", "animal_cat_orange", "building_chicken_coop", "building_barn_cows", "building_pig_sty", "building_sheep_pen"].map((n) => `/sprites/animals/${n}.png`),
  // Crops / soil (#93): opaque tiles (soil, crops on soil) plus props (scarecrow, sprinkler, fence).
  crops: "/sprites/crops/",
  // Extra furniture, doors, windows, roof pieces, floors (#90 / #91): /sprites/structure/extra/<atlas name>.png.
  structureExtra: "/sprites/structure/extra/",
  roofSlate: `${S}roof_slate.png`,
  // Icons staged for phase 4-5 (work priorities, tools, needs, seasons): /sprites/icons/<name>.png, see wire_sprites.py ICONS.
} as const;

export async function loadStaged(urls: string[]): Promise<Texture[]> {
  const out: Texture[] = [];
  for (const url of urls) {
    try {
      const t = await Assets.load<Texture>(url);
      if (t) out.push(t);
    } catch {
      // Missing: skipped.
    }
  }
  return out;
}
