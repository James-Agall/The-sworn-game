// pathfinding.ts: Walkability, A* paths, path following, and body separation (spatial hash).
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { TileType, isSolidTile, TILE_SIZE } from "@colony/shared/protocol";
import type { Body, Mob, TileCoord } from "./types.js";
import {
  COLONIST_BODY_RADIUS, PATH_NODE_BUDGET, PATH_WAYPOINT_TOLERANCE_PX, SEPARATION_ITERATIONS,
  SEPARATION_WEIGHT_MOVING, SEPARATION_WEIGHT_STILL,
} from "./constants.js";
import { bodies, colonists, mobs, mobsAttackingThisTick, state } from "./state.js";
import {
  biomeSpeedMultiplier, inBounds, roadSpeedMultiplier, siteNumber, tileIndex, tileToPixelCenter,
} from "./tiles.js";
import { isWalkablePixel } from "./wildlife.js";
import { gatePassable, isDormantGuardian, isGuardOrMilitiaKind, isWardPriest, mobBodyRadius } from "./index.js";

export function isWalkableTile(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  // Gates: passable by their state, from the current mover's side (hostileMover).
  if (t === TileType.Gate) return gatePassable(tileIndex(tx, ty), state.hostileMover);
  return !isSolidTile(t);
}

export function findAdjacentWalkable(tx: number, ty: number): TileCoord | null {
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  for (const n of neighbors) {
    if (isWalkableTile(n.x, n.y)) return n;
  }
  return null;
}

export function adjacentTilesOfType(tx: number, ty: number, type: TileType): TileCoord[] {
  const neighbors = [
    { x: tx + 1, y: ty },
    { x: tx - 1, y: ty },
    { x: tx, y: ty + 1 },
    { x: tx, y: ty - 1 },
  ];
  return neighbors.filter((n) => inBounds(n.x, n.y) && state.tiles[tileIndex(n.x, n.y)] === type);
}
export function findPath(start: TileCoord, goal: TileCoord): TileCoord[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];

  const key = (t: TileCoord) => t.y * state.WORLD_TILES_X + t.x;
  const visited = new Set<number>([key(start)]);
  const parent = new Map<number, TileCoord>();
  const queue: TileCoord[] = [start];

  // Node budget: a request can never stall a tick on a huge map (a 160 map has 25.6k tiles in all, so
  // it is never reached there). Over budget = no path, like an unreachable goal.
  for (let head = 0; head < queue.length; head++) {
    if (head > PATH_NODE_BUDGET) return null;
    const current = queue[head];
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!isWalkableTile(n.x, n.y)) continue;
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, current);
      if (n.x === goal.x && n.y === goal.y) {
        const path: TileCoord[] = [n];
        let back = current;
        while (!(back.x === start.x && back.y === start.y)) {
          path.unshift(back);
          back = parent.get(key(back))!;
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

export function advanceAlongPath(
  entity: { x: number; y: number; path: TileCoord[] },
  dt: number,
  speed: number
) {
  if (entity.path.length === 0) return;
  // A gate on the path closed (or was locked) since it was planned: drop the path so the mover replans.
  const nextTile = entity.path[0];
  if (inBounds(nextTile.x, nextTile.y) && state.tiles[tileIndex(nextTile.x, nextTile.y)] === TileType.Gate && !isWalkableTile(nextTile.x, nextTile.y)) {
    entity.path = [];
    return;
  }
  const target = tileToPixelCenter(entity.path[0]);
  const ddx = target.x - entity.x;
  const ddy = target.y - entity.y;
  const dist = Math.hypot(ddx, ddy);
  // The road bonus is for colonists only (players move by input, mobs never get it).
  const isColonist = colonists.get((entity as { id?: string }).id ?? "") === entity;
  const road = isColonist ? roadSpeedMultiplier(entity.x, entity.y) : 1;
  const step = speed * biomeSpeedMultiplier(entity.x, entity.y) * road * dt;
  if (dist <= step) {
    entity.x = target.x;
    entity.y = target.y;
    entity.path.shift();
  } else if (entity.path.length > 1 && dist <= PATH_WAYPOINT_TOLERANCE_PX) {
    // Close enough to a waypoint that isn't the last: move on toward the next one. Bodies pushing each
    // other apart can never all stand on one tile centre, and used to orbit it forever (a squad stuck
    // in a knot on its way to its formation). Tile centres of a 4-connected path are edge-adjacent, so
    // the straight line from anywhere in this tile to the next centre stays on those two tiles.
    entity.path.shift();
    const next = tileToPixelCenter(entity.path[0]);
    const nd = Math.hypot(next.x - entity.x, next.y - entity.y);
    if (nd > 0) {
      const s = Math.min(step, nd);
      entity.x += ((next.x - entity.x) / nd) * s;
      entity.y += ((next.y - entity.y) / nd) * s;
    }
  } else {
    entity.x += (ddx / dist) * step;
    entity.y += (ddy / dist) * step;
  }
}

export function collectBodies() {
  bodies.length = 0;
  for (const c of colonists.values()) {
    if (!isGuardOrMilitiaKind(c.kind) && !(c.kind === "bishop" && !isWardPriest(c))) continue;
    const still = c.state === "attacking" || c.state === "idle";
    bodies.push({ e: c, r: COLONIST_BODY_RADIUS, w: still ? SEPARATION_WEIGHT_STILL : SEPARATION_WEIGHT_MOVING });
  }
  for (const m of mobs.values()) {
    if (isDormantGuardian(m) || (m.isDeserter && !m.deserterActive) || m.passive) continue;
    const still = mobsAttackingThisTick.has(m.id);
    bodies.push({ e: m, r: mobBodyRadius(m), w: still ? SEPARATION_WEIGHT_STILL : SEPARATION_WEIGHT_MOVING, mob: true });
  }
}

export function rebuildBodyHash() {
  state.cellHead.fill(-1);
  if (state.cellNext.length < bodies.length) state.cellNext = new Int32Array(bodies.length * 2);
  for (let i = 0; i < bodies.length; i++) {
    const tx = Math.floor(bodies[i].e.x / TILE_SIZE);
    const ty = Math.floor(bodies[i].e.y / TILE_SIZE);
    if (!inBounds(tx, ty)) {
      state.cellNext[i] = -1;
      continue;
    }
    const cell = tileIndex(tx, ty);
    state.cellNext[i] = state.cellHead[cell];
    state.cellHead[cell] = i;
  }
}

// Moves a body by (dx, dy) unless that would put its centre on a solid tile.
export function nudgeBody(b: Body, dx: number, dy: number) {
  const prevMover = state.hostileMover;
  const prevOwner = state.moverOwner;
  state.hostileMover = b.mob === true;
  state.moverOwner = b.mob === true ? siteNumber((b.e as Mob).siteId) : 0;
  const nx = b.e.x + dx;
  const ny = b.e.y + dy;
  if (isWalkablePixel(nx, ny)) {
    b.e.x = nx;
    b.e.y = ny;
  } else if (isWalkablePixel(nx, b.e.y)) {
    b.e.x = nx;
  } else if (isWalkablePixel(b.e.x, ny)) {
    b.e.y = ny;
  }
  state.hostileMover = prevMover;
  state.moverOwner = prevOwner;
}

// Push-apart relaxation over every overlapping pair (allies and enemies alike).
export function separateBodies() {
  collectBodies();
  for (let iter = 0; iter < SEPARATION_ITERATIONS; iter++) {
    rebuildBodyHash();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const tx = Math.floor(a.e.x / TILE_SIZE);
      const ty = Math.floor(a.e.y / TILE_SIZE);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!inBounds(tx + ox, ty + oy)) continue;
          for (let j = state.cellHead[tileIndex(tx + ox, ty + oy)]; j >= 0; j = state.cellNext[j]) {
            if (j <= i) continue;
            const b = bodies[j];
            let dx = b.e.x - a.e.x;
            let dy = b.e.y - a.e.y;
            const min = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            let d = Math.sqrt(d2);
            if (d < 0.01) {
              // Exactly stacked: split along a fixed per-pair direction.
              const ang = (i * 7 + j * 13) * 0.61803;
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              d = 1;
            }
            const overlap = min - Math.sqrt(d2);
            const share = overlap / (a.w + b.w);
            nudgeBody(a, (-dx / d) * share * a.w, (-dy / d) * share * a.w);
            nudgeBody(b, (dx / d) * share * b.w, (dy / d) * share * b.w);
          }
        }
      }
    }
  }
  mobsAttackingThisTick.clear();
}
