import { TileType } from "@colony/shared/protocol";
import { autumnFrame, loadAutumnSheet } from "./autumnAnimations";
import { HF_ANIMALS, HOUSE_STRIDE } from "@colony/shared/animals";

const buildings: Partial<Record<TileType, [string, number]>> = {
  [TileType.House]: ["civic-buildings", 0], [TileType.BigHouse]: ["civic-buildings", 0], [TileType.HouseLevel2]: ["civic-buildings", 0],
  [TileType.TownCenter]: ["civic-buildings", 1], [TileType.Tavern]: ["civic-buildings", 2],
  [TileType.ChurchPost]: ["civic-buildings", 3], [TileType.AbbeyHall]: ["civic-buildings", 3],
  [TileType.Market]: ["civic-buildings", 4], [TileType.GoldShop]: ["civic-buildings", 4],
  [TileType.LumberjackPost]: ["production-buildings", 0], [TileType.IronMinePost]: ["production-buildings", 1],
  [TileType.RockMinePost]: ["production-buildings", 1], [TileType.Blacksmith]: ["production-buildings", 2],
  [TileType.Bakery]: ["production-buildings", 3], [TileType.TailorShop]: ["production-buildings", 4], [TileType.Brewery]: ["production-buildings", 5],
  [TileType.KnightPost]: ["military-animal-buildings", 0], [TileType.MilitiaPost]: ["military-animal-buildings", 0],
  [TileType.ArcherPost]: ["military-animal-buildings", 1], [TileType.Tower]: ["military-animal-buildings", 1],
  [TileType.Keep]: ["military-animal-buildings", 2], [TileType.CastleLevel2]: ["military-animal-buildings", 2], [TileType.CastleLevel3]: ["military-animal-buildings", 2],
  [TileType.Stables]: ["military-animal-buildings", 3],
  [TileType.HunterHut]: ["specialist-building-tiers", 0], [TileType.ForagerHut]: ["specialist-building-tiers", 1],
  [TileType.BuildersGuild]: ["specialist-building-tiers", 2], [TileType.LuxuryWorkshop]: ["specialist-building-tiers", 3],
  [TileType.ChickenCoop]: ["animal-building-states", 0], [TileType.LivestockBarn]: ["animal-building-states", 1],
  [TileType.PigSty]: ["animal-building-states", 2], [TileType.SheepPen]: ["animal-building-states", 3],
};
export const loadAutumnBuildings = () => Promise.all([...new Set([...Object.values(buildings).map(v => v![0]), "terrain-connections"])].map(loadAutumnSheet));
let occupied = new Map<number, boolean>();
export function syncAutumnHouses(flat: number[] = []): number[] {
  const next = new Map<number, boolean>();
  for (let i = 0; i + HOUSE_STRIDE <= flat.length; i += HOUSE_STRIDE) next.set(flat[i], !!(flat[i + 1] & HF_ANIMALS));
  const changed = [...new Set([...occupied.keys(), ...next.keys()])].filter(i => occupied.get(i) !== next.get(i));
  occupied = next;
  return changed;
}
export function autumnBuildingDamage(tile: number, level: number, hp: number, construction: boolean, index: number) {
  const entry = buildings[tile as TileType];
  if (!entry) return undefined;
  const [sheet, row] = entry;
  if (!construction && hp >= 750) return sheet === "animal-building-states" && occupied.has(index) ? autumnFrame(sheet, row, occupied.get(index) ? 2 : 0) : undefined;
  // Specialist sheets supply damage per tier; the other sheets supply shared damage states.
  const col = sheet === "specialist-building-tiers"
    ? (Math.min(3, Math.max(1, level)) - 1) * 4 + (hp < 500 ? 2 : 1)
    : construction ? 7 : hp < 500 ? 5 : 4;
  if (construction && sheet === "specialist-building-tiers") return undefined;
  return autumnFrame(sheet, row, col);
}
