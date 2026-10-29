// goals.ts: The goal track.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TileType } from "@colony/shared/protocol";
import type { GoalDef, ResourceKey } from "./types.js";
import { GAME_DAY_TICKS, GOAL_WORKER_KINDS, VISION_BUILDING_TILES } from "./constants.js";
import { colonists, constructionSites, state } from "./state.js";
import { formatReward, grantReward } from "./worldgen.js";
import { isSoldierKind } from "./units.js";
import { broadcastEvent } from "./net.js";

// Dawns since the world began (cycle 0 starts at dawn, so day N's dawn is cycleTick N * cycle).
export function nightsSurvived(): number {
  return Math.floor(state.cycleTick / GAME_DAY_TICKS);
}

// Any player-placed structure: a queued construction, a built building (Town Centers beyond the
// starting one count), or a wall.
export function anyPlayerBuilding(): boolean {
  if (constructionSites.size > 0 || state.townCenters.length > 1) return true;
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i] as TileType;
    if (t === TileType.Wall || t === TileType.StoneWall || t === TileType.Gate) return true;
    if (t !== TileType.TownCenter && VISION_BUILDING_TILES.has(t)) return true;
  }
  return false;
}

export function flagGoal(done: boolean) {
  return { progress: done ? 1 : 0, target: 1 };
}

export function nightsGoal(target: number, reward: Partial<Record<ResourceKey, number>>): GoalDef {
  return {
    title: target === 1 ? "Survive the first night" : `Survive ${target} nights`,
    progress: () => ({ progress: Math.min(target, nightsSurvived()), target }),
    reward,
  };
}

export const GOALS: GoalDef[] = [
  { title: "Place a building", progress: () => flagGoal(anyPlayerBuilding()), reward: { wood: 20 } },
  {
    title: "Assign a worker",
    progress: () => flagGoal(Array.from(colonists.values()).some((c) => GOAL_WORKER_KINDS.has(c.kind))),
    reward: { wood: 20, rock: 10 },
  },
  {
    title: "Arm a unit",
    progress: () => flagGoal(Array.from(colonists.values()).some((c) => isSoldierKind(c.kind))),
    reward: { iron: 15 },
  },
  // Long days: was 1/3/7/14/21 nights of the old 100 s cycle (2 / 5 / 12 / 23 / 35 min); now 1/2/4/7/10
  // long nights of 375 s (6 / 12.5 / 25 / 44 / 62.5 min): each step still a meaningful stretch of play.
  nightsGoal(1, { gold: 15, grain: 20 }),
  nightsGoal(2, { gold: 30, wood: 30, rock: 30 }),
  nightsGoal(4, { gold: 60, iron: 40, rock: 40 }),
  nightsGoal(7, { gold: 100, wood: 60, iron: 60 }),
  nightsGoal(10, { gold: 150, wood: 80, iron: 80, rock: 80 }),
  { title: "Clear the Castle Ruin", progress: () => flagGoal(state.castleCleared), reward: { gold: 100 } },
];
state.goalSnapshot = { index: 0, total: GOALS.length, title: GOALS[0].title, progress: 0, target: 1 };

export function refreshGoalSnapshot(progress?: { progress: number; target: number }) {
  if (state.goalIndex >= GOALS.length) {
    state.goalSnapshot = { index: GOALS.length, total: GOALS.length, title: "Every goal complete", progress: 1, target: 1 };
    return;
  }
  const p = progress ?? GOALS[state.goalIndex].progress();
  state.goalSnapshot = { index: state.goalIndex, total: GOALS.length, title: GOALS[state.goalIndex].title, ...p };
}

// silent: catch up without rewards or toasts (an old save loaded with no goal state).
export function evaluateGoals(silent = false) {
  while (state.goalIndex < GOALS.length) {
    const goal = GOALS[state.goalIndex];
    const p = goal.progress();
    if (p.progress < p.target) {
      refreshGoalSnapshot(p);
      return;
    }
    state.goalIndex++;
    if (silent) continue;
    grantReward(goal.reward);
    const final = state.goalIndex === GOALS.length;
    broadcastEvent(
      "milestone",
      final
        ? `Final goal complete: ${goal.title} — the colony stands victorious! (${formatReward(goal.reward)})`
        : `Goal complete: ${goal.title} (${formatReward(goal.reward)})`
    );
  }
  refreshGoalSnapshot();
}

export function resetGoals() {
  state.goalIndex = 0;
  state.castleCleared = false;
  state.campsDestroyed = 0;
  refreshGoalSnapshot(flagGoal(false));
}
