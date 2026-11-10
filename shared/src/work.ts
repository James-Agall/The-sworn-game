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
  // Gap closure G3: put on that post by hand (pinned: priorities never move it; only Unassign or the work type off).
  pinned?: boolean;
}
export interface WorkTabSnapshot {
  manual: boolean;
  rows: WorkTabRow[];
}

// ---- gap closure G3: hand-assigned workers (building panel "Assign worker", person card "Assign to...") ----
// A hand assignment pins the person to the post: priority-based filling never moves it (no "better job" leave), a
// priority-placed worker gives up its slot to it, and it stays until Unassign or its work type is set off. Unassigned
// people are not put back on that post by priorities for WORK_UNASSIGN_HOLD_TICKS (server constants).
export interface PostWorkerInfo {
  id: string;
  name: string;
  // Skill level in the post's work type (0 = no skill for it).
  skill: number;
  pinned: boolean;
}
export interface PostCandidateInfo {
  id: string;
  name: string;
  skill: number;
  // What it is doing now ("Idle", "Hauling", ...).
  job: string;
}
// BuildingInfo.posts: the building's work posts (stations, camps, huts, barns, Town Center builders).
export interface BuildingPostsInfo {
  work: WorkType;
  // The post's job ("Hunter", "Builder", ...).
  role: string;
  open: number;
  workers: PostWorkerInfo[];
  // Free adult villagers of the clan with this work type on (best skill first, then nearest; capped).
  candidates: PostCandidateInfo[];
  // A free slot can be made: an open one, or a worker placed by priorities who gives way.
  canAssign: boolean;
}
// Reply to `workPosts` {id}: the posts near that person it could be assigned to (nearest first; capped).
export interface WorkPostOption {
  tx: number;
  ty: number;
  name: string;
  work: WorkType;
  open: number;
  // No open slot: a priority-placed worker would give way.
  bump: boolean;
  dist: number;
  skill: number;
}
export const WORK_POST_OPTIONS_MAX = 12;
export const WORK_POST_CANDIDATES_MAX = 12;
