// Modular building phase 4 (2026-11-09, docs PLAN-rimworld-stardew.md): job priorities, the RimWorld work tab.
// Every adult civilian has a priority per work type: 1 (highest) .. 4, or 0 = off. Free villagers take the
// best-priority job on offer (ties: nearest); station / building workers keep their post (an override) while its
// work type is not off. Skills are the existing per-profession XP levels (progression.ts WORKER_XP_LEVELS).
import type { Profession } from "./progression.js";

export const WORK_TYPES = [
  "building", "farming", "woodcutting", "mining", "hunting", "cooking", "crafting", "animals", "hauling", "fighting",
] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_LABEL: Record<WorkType, string> = {
  building: "Building", farming: "Farming", woodcutting: "Woodcutting", mining: "Mining", hunting: "Hunting",
  cooking: "Cooking", crafting: "Crafting", animals: "Animals", hauling: "Hauling", fighting: "Fighting",
};
// Column headers (the Work tab is narrow).
export const WORK_SHORT: Record<WorkType, string> = {
  building: "Build", farming: "Farm", woodcutting: "Wood", mining: "Mine", hunting: "Hunt", cooking: "Cook", crafting: "Craft", animals: "Anim",
  hauling: "Haul", fighting: "Fight",
};
export const WORK_HELP: Record<WorkType, string> = {
  building: "Blueprints, structures and construction sites (Town Center builders; free villagers lend a hand)",
  farming: "Growing zones (till, sow, tend, harvest) and Barns, pastures, orchards, wool / cotton farms",
  woodcutting: "Lumber Camp posts",
  mining: "Quarry and Iron Mine posts",
  hunting: "Hunter's Hut and Forager's Hut posts",
  cooking: "Mill, Bakery, Brewery and Tavern posts",
  crafting: "Tailor, Blacksmith, Bloomery, Charcoal Burner and Jeweler posts",
  animals: "Animal houses (coop, barn, sty, pen, stables): fill feeders and troughs, collect eggs / milk / wool",
  hauling: "Carry loose goods (harvests) to stockpiles",
  fighting: "Answer a Town Center's call to arms and train as a soldier (never forced: off = stays home)",
};

// The professions (skills) behind each work type; building, hauling and fighting have none.
export const WORK_PROFESSIONS: Record<WorkType, Profession[]> = {
  building: [], farming: ["farmer", "farmhand"], woodcutting: ["woodcutter"], mining: ["miner"], hunting: ["hunter", "forager"],
  cooking: ["miller", "baker", "brewer", "innkeeper"], crafting: ["tailor", "smith", "smelter", "collier", "jeweler"],
  animals: ["herder"], hauling: [], fighting: [],
};
export const PROFESSION_WORK: Record<Profession, WorkType> = Object.fromEntries(
  (Object.entries(WORK_PROFESSIONS) as [WorkType, Profession[]][]).flatMap(([w, ps]) => ps.map((p) => [p, w]))
) as Record<Profession, WorkType>;

export const WORK_PRIORITY_MAX = 4;
// Default priorities (default mode, and old saves / new people in manual mode): the person's own post 1, a work
// type it has reached skill level 2+ in 2, everything else 3.
export const WORK_DEFAULT_ASSIGNED = 1;
export const WORK_DEFAULT_SKILLED = 2;
export const WORK_DEFAULT_LEVEL_SKILLED = 2;
export const WORK_DEFAULT = 3;

export interface WorkTabRow {
  id: string;
  name: string;
  // What the person is: "Free villager", "Woodcutter at Lumber Camp", ...
  role: string;
  // What it is doing right now ("Hauling grain", "Building", "Idle", ...).
  job: string;
  // Effective priority per WORK_TYPES entry (0 = off).
  pri: number[];
  // Skill level per WORK_TYPES entry (0 = no skill for that type, else 1-4) and the XP behind it.
  skill: number[];
  xp: number[];
  // The work type of the post this person is assigned to (an override), if any.
  assigned?: WorkType;
}
export interface WorkTabSnapshot {
  manual: boolean;
  rows: WorkTabRow[];
}
