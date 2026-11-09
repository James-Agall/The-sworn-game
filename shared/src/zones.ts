// Modular building phase 3 (2026-11-09, docs/colony2d/PLAN-rimworld-stardew.md): zones, shared by the server
// (server/src/zones.ts: tiles, crops, piles, jobs, saves) and the client (Zones tab, overlays, zone list).
//
// A ZONE is a painted set of tiles owned by a clan: GROWING (a crop: tilled, sown, tended, harvested tile by tile),
// STOCKPILE (storage with filters: haulers bring loose goods to it), HOME (idle villagers wander there) and ANIMAL (a
// placeholder for phase 5d, no logic yet). A tile is in at most one zone. Zones are not tiles: they live beside the
// tile layer (no setTile, no chunk versions, no diff log), saved as run-length tile lists.
export type ZoneKind = "growing" | "stockpile" | "home" | "animal";
export const ZONE_KINDS: readonly ZoneKind[] = ["growing", "stockpile", "home", "animal"];
export const ZONE_KIND_LABEL: Record<ZoneKind, string> = { growing: "Growing zone", stockpile: "Stockpile", home: "Home area", animal: "Animal area" };
// Overlay colours (0xRRGGBB).
export const ZONE_KIND_COLOR: Record<ZoneKind, number> = { growing: 0x6fcf4f, stockpile: 0xe0b040, home: 0x4fa8e0, animal: 0xc070d0 };

// ---- crops (yields / times: server/src/constants.ts ZONE_* from the Farm Plot / Hemp Field numbers) ----
export type CropId = "wheat" | "hemp";
export const CROPS: readonly CropId[] = ["wheat", "hemp"];
export const CROP_LABEL: Record<CropId, string> = { wheat: "Wheat (grain)", hemp: "Hemp (cloth)" };
// Stock resource each crop yields.
export const CROP_RESOURCE: Record<CropId, "grain" | "cotton"> = { wheat: "grain", hemp: "cotton" };

// Per growing tile. Stage 0 untilled (no state stored), 1 tilled, 2 sown, 3 growing, 4 ripe.
export const CropStage = { Untilled: 0, Tilled: 1, Sown: 2, Growing: 3, Ripe: 4 } as const;
// Fraction of the grow time a sown tile reads as "sown" before "growing".
export const CROP_SOWN_FRACTION = 1 / 3;

// ---- stockpile filters ----
export type StockCategory = "food" | "wood" | "stone" | "ore" | "metal" | "cloth" | "tools" | "weapons" | "armour" | "other";
export const STOCK_CATEGORIES: readonly StockCategory[] = ["food", "wood", "stone", "ore", "metal", "cloth", "tools", "weapons", "armour", "other"];
export const STOCK_CATEGORY_LABEL: Record<StockCategory, string> = {
  food: "Food", wood: "Wood", stone: "Stone", ore: "Ore", metal: "Metal", cloth: "Cloth", tools: "Tools", weapons: "Weapons",
  armour: "Armour", other: "Other goods",
};
// The category of each stock resource (metal / weapons / armour are items and gear: no loose goods of theirs yet).
export const RESOURCE_CATEGORY: Record<string, StockCategory> = {
  grain: "food", meat: "food", fruit: "food", wood: "wood", rock: "stone", iron: "ore", wool: "cloth", cotton: "cloth",
  clothes: "cloth", tools: "tools", luxuryItems: "other", gold: "other", alcohol: "other",
};
// Loose goods on the wire / in saves: an index into this list.
export const PILE_RESOURCES = ["grain", "meat", "fruit", "wood", "rock", "iron", "wool", "cotton", "clothes", "tools", "luxuryItems", "gold", "alcohol"] as const;

// Most tiles one zoneEdit may name (like a structure order) and how far from the hero / an own Town Center.
export const ZONE_EDIT_MAX_TILES = 400;
export const ZONE_EDIT_RANGE_TILES = 40;

// Client-only Zones tab tools (never sent as tiles).
export const ZONE_TOOL_WHEAT = 210;
export const ZONE_TOOL_HEMP = 211;
export const ZONE_TOOL_STOCKPILE = 212;
export const ZONE_TOOL_HOME = 213;
export const ZONE_TOOL_ANIMAL = 214;
export const ZONE_TOOL_ERASE = 215;
export const ZONE_TOOLS: readonly number[] = [ZONE_TOOL_WHEAT, ZONE_TOOL_HEMP, ZONE_TOOL_STOCKPILE, ZONE_TOOL_HOME, ZONE_TOOL_ANIMAL, ZONE_TOOL_ERASE];
export function isZoneTool(t: number): boolean {
  return t >= ZONE_TOOL_WHEAT && t <= ZONE_TOOL_ERASE;
}

// Run-length tile lists: [start, length, start, length, ...] over ascending tile indices.
export function rleEncode(sorted: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < sorted.length; ) {
    let n = 1;
    while (k + n < sorted.length && sorted[k + n] === sorted[k] + n) n++;
    out.push(sorted[k], n);
    k += n;
  }
  return out;
}
export function rleDecode(rle: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < rle.length; k += 2) for (let n = 0; n < rle[k + 1]; n++) out.push(rle[k] + n);
  return out;
}

// Snapshot (`zones`, resent when the clan's zones / crops / piles change).
export interface ZoneSnapshot {
  id: number;
  kind: ZoneKind;
  name: string;
  crop?: CropId;
  filters?: StockCategory[];
  // RLE tile indices.
  tiles: number[];
  // Stockpiles: goods delivered here still in the stock, by resource.
  stored?: Record<string, number>;
}
export interface ZonesSnapshot {
  zones: ZoneSnapshot[];
  // Crop tiles with a stage > 0, flattened [tile, stage, ...].
  crops: number[];
  // Loose goods, flattened [tile, PILE_RESOURCES index, amount (floored), ...].
  piles: number[];
}
