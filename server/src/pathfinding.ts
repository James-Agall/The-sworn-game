import { FORT_BUILDABLE, FORT_GATES, isFortification, isFortPart, isLargeGate, isWideBridge, fortPartner, fortAnchor, rampartTransition } from "@colony/shared/fortifications";
// pathfinding.ts: Walkability, A* paths, path following, and body separation (spatial hash).
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { coldSpeedMult } from "./winter.js";
import { TileType, isGateTile, isSolidTile, TILE_SIZE } from "@colony/shared/protocol";
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
import { cachedPath, pathCacheKey, pathCacheStats, storePath } from "./chunks.js";

const VERIFY_PATH_CACHE = process.env.COLONY_TEST_HOOKS === "1" && process.env.COLONY_PATH_CACHE_VERIFY === "1";
import { isWardPriest } from "./colonists.js";
import { isGuardOrMilitiaKind } from "./units.js";
import { gatePassable } from "./combat.js";
import { isDormantGuardian, mobBodyRadius } from "./mobs.js";

export function isWalkableTile(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  // Gates: passable by their state, from the current mover's side (hostileMover).
  if (isGateTile(t)) {
    sawGate = true;
    return gatePassable(tileIndex(tx, ty), state.hostileMover);
  }
  return t===TileType.Rampart || !isSolidTile(t);
}
export function canStepTile(fx:number,fy:number,tx:number,ty:number):boolean {
 if(!inBounds(fx,fy)||!inBounds(tx,ty))return false;
 const from=state.tiles[tileIndex(fx,fy)],to=state.tiles[tileIndex(tx,ty)];
 // Perf fast path (path searches call this per step): with neither tile a fortification (Rampart ..
 // WideBridgeVPart) every rule below reduces to isWalkableTile(tx, ty), written out here.
 if((from<TileType.Rampart||from>TileType.WideBridgeVPart)&&(to<TileType.Rampart||to>TileType.WideBridgeVPart)){
   if(isGateTile(to)){sawGate=true;return gatePassable(tileIndex(tx,ty),state.hostileMover);}
   return !isSolidTile(to);
 }
 if(!rampartTransition(from,to))return false;
 // Friendly defenders can cross the deck above a closed gate, but cannot descend through its locked doors.
 if(isLargeGate(from)&&!isLargeGate(to)&&to!==TileType.Rampart&&to!==TileType.WallLadder&&!gatePassable(tileIndex(fx,fy),state.hostileMover))return false;
 if(isLargeGate(to)&&(from===TileType.Rampart||isLargeGate(from))&&!state.hostileMover){
   const a=fortAnchor((x,y)=>inBounds(x,y)?state.tiles[tileIndex(x,y)]:-1,tx,ty);
   return isLargeGate(state.tiles[tileIndex(a.x,a.y)]);
 }

 // Both halves remain blocked while their anchor is unfinished.
 if(isFortPart(to)){const a=fortAnchor((x,y)=>inBounds(x,y)?state.tiles[tileIndex(x,y)]:-1,tx,ty);if(state.tiles[tileIndex(a.x,a.y)]===TileType.ConstructionSite)return false;}
 return isWalkableTile(tx,ty);
}
export function canStepPixel(fx:number,fy:number,tx:number,ty:number):boolean {
 const x=Math.floor(fx/TILE_SIZE),y=Math.floor(fy/TILE_SIZE),nx=Math.floor(tx/TILE_SIZE),ny=Math.floor(ty/TILE_SIZE);
 if(Math.abs(nx-x)>1||Math.abs(ny-y)>1)return false;
 if(x!==nx&&y!==ny)return (canStepTile(x,y,nx,y)&&canStepTile(nx,y,nx,ny))||(canStepTile(x,y,x,ny)&&canStepTile(x,ny,nx,ny));
 return canStepTile(x,y,nx,ny);
}
// Set when isWalkableTile looked at a gate: findPath does not cache that search.
let sawGate = false;

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
// Perf counters since the last tickStats reset (test hook): findPath calls, fresh searches (cache misses),
// nodes those searches expanded, and searches that found no path.
export const pathStats = { calls: 0, searches: 0, nodes: 0, failed: 0 };

// blocked (optional, forts phase E wagon detours): extra tiles this search treats as unwalkable.
export function findPath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): TileCoord[] | null {
  pathStats.calls++;
  if (start.x === goal.x && start.y === goal.y) return [];
  // World streaming phase 1: an unchanged region gives the same answer as last time (see chunks.ts).
  const cacheable = !blocked && inBounds(start.x, start.y) && inBounds(goal.x, goal.y);
  const ck = cacheable ? pathCacheKey(tileIndex(start.x, start.y), tileIndex(goal.x, goal.y), state.hostileMover) : 0;
  if (cacheable) {
    const hit = cachedPath(ck);
    if (hit !== undefined) {
      // Test runs with COLONY_PATH_CACHE_VERIFY=1: every hit is checked against a fresh search.
      if (VERIFY_PATH_CACHE) {
        const fresh = searchPath(start, goal, blocked).path;
        if (JSON.stringify(fresh) !== JSON.stringify(hit)) pathCacheStats.mismatches++;
      }
      return hit;
    }
  }
  const prevSawGate = sawGate;
  sawGate = false;
  pathStats.searches++;
  const result = searchPath(start, goal, blocked);
  if (!result.path) pathStats.failed++;
  if (cacheable && !sawGate) storePath(ck, result.path, result.visited);
  sawGate = prevSawGate || sawGate;
  return result.path;
}

// searchPath scratch, reused by every search (perf: the old Set / Map / per-neighbour objects were most of a
// search's cost and a large share of GC in big fights). seenAt[k] === searchGen marks tile k visited in the
// current search; parentOf[k] is the tile it was reached from; searchQueue holds visited tiles in BFS order.
let seenAt = new Uint32Array(0);
let parentOf = new Int32Array(0);
let searchQueue = new Int32Array(0);
let searchGen = 0;
const NX = [1, -1, 0, 0];
const NY = [0, 0, 1, -1];

// Breadth-first search; the same visiting order (neighbours +x, -x, +y, -y) and so exactly the same path as
// before the perf rewrite. `visited` (start, every queued tile, and the goal when found) is a view of the
// scratch queue: valid only until the next search.
function searchPath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): { path: TileCoord[] | null; visited: Int32Array } {
  const W = state.WORLD_TILES_X;
  const size = state.tiles.length;
  if (seenAt.length !== size) {
    seenAt = new Uint32Array(size);
    parentOf = new Int32Array(size);
    searchQueue = new Int32Array(size + 1);
    searchGen = 0;
  }
  if (++searchGen === 0xffffffff) {
    seenAt.fill(0);
    searchGen = 1;
  }
  const gen = searchGen;
  const startK = start.y * W + start.x;
  // An out-of-bounds start: the old Set took any key; nothing is ever reached from it except through
  // canStepTile, which rejects it, so it only needs to be listed.
  if (startK >= 0 && startK < size) seenAt[startK] = gen;
  searchQueue[0] = startK;
  let len = 1;

  // Node budget: a request can never stall a tick on a huge map (a 160 map has 25.6k tiles in all, so
  // it is never reached there). Over budget = no path, like an unreachable goal.
  for (let head = 0; head < len; head++) {
    if (head > PATH_NODE_BUDGET) {
      pathStats.nodes += head;
      return { path: null, visited: searchQueue.subarray(0, len) };
    }
    const ck = searchQueue[head];
    const cx = ck % W;
    const cy = (ck - cx) / W;
    for (let d = 0; d < 4; d++) {
      const nx = cx + NX[d];
      const ny = cy + NY[d];
      if (!canStepTile(cx, cy, nx, ny)) continue;
      const isGoal = nx === goal.x && ny === goal.y;
      if (blocked && blocked(nx, ny) && !isGoal) continue;
      const k = ny * W + nx;
      if (seenAt[k] === gen) continue;
      seenAt[k] = gen;
      parentOf[k] = ck;
      if (isGoal) {
        searchQueue[len] = k;
        pathStats.nodes += head + 1;
        const path: TileCoord[] = [{ x: nx, y: ny }];
        let back = ck;
        while (back !== startK) {
          const bx = back % W;
          path.push({ x: bx, y: (back - bx) / W });
          back = parentOf[back];
        }
        path.reverse();
        return { path, visited: searchQueue.subarray(0, len + 1) };
      }
      searchQueue[len++] = k;
    }
  }
  pathStats.nodes += len;
  return { path: null, visited: searchQueue.subarray(0, len) };
}

export function advanceAlongPath(
  entity: { x: number; y: number; path: TileCoord[] },
  dt: number,
  speed: number
) {
  if (entity.path.length === 0) return;
  // A gate on the path closed (or was locked) since it was planned: drop the path so the mover replans.
  const nextTile = entity.path[0];
  if (inBounds(nextTile.x, nextTile.y) && isGateTile(state.tiles[tileIndex(nextTile.x, nextTile.y)]) && !canStepTile(Math.floor(entity.x/TILE_SIZE),Math.floor(entity.y/TILE_SIZE),nextTile.x,nextTile.y)) {
    entity.path = [];
    return;
  }
  const cx=Math.floor(entity.x/TILE_SIZE),cy=Math.floor(entity.y/TILE_SIZE);
  if(!canStepTile(cx,cy,nextTile.x,nextTile.y)){entity.path=[];return;}
  const target = tileToPixelCenter(entity.path[0]);
  const ddx = target.x - entity.x;
  const ddy = target.y - entity.y;
  const dist = Math.hypot(ddx, ddy);
  // The road bonus is for colonists only (players move by input, mobs never get it).
  const id = (entity as { id?: string }).id ?? "";
  const isColonist = colonists.get(id) === entity;
  // Winter: a colonist out in the cold without warm clothes is slower (winter.ts).
  const road = isColonist ? roadSpeedMultiplier(entity.x, entity.y) * coldSpeedMult(id) : 1;
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
      const nx=entity.x+((next.x-entity.x)/nd)*s,ny=entity.y+((next.y-entity.y)/nd)*s;
      if(canStepPixel(entity.x,entity.y,nx,ny)){entity.x=nx;entity.y=ny;}
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

// The cells rebuildBodyHash filled last time: only those go back to -1 (a fill of the whole map was ~1.3 ms a
// tick on a 2048 map). A new cellHead array (setWorldSize) is filled whole once.
let bodyCells: number[] = [];
let bodyCellsOf: Int32Array | null = null;
export function rebuildBodyHash() {
  if (bodyCellsOf !== state.cellHead) {
    state.cellHead.fill(-1);
    bodyCellsOf = state.cellHead;
  } else {
    for (const cell of bodyCells) state.cellHead[cell] = -1;
  }
  bodyCells = [];
  if (state.cellNext.length < bodies.length) state.cellNext = new Int32Array(bodies.length * 2);
  for (let i = 0; i < bodies.length; i++) {
    const tx = Math.floor(bodies[i].e.x / TILE_SIZE);
    const ty = Math.floor(bodies[i].e.y / TILE_SIZE);
    if (!inBounds(tx, ty)) {
      state.cellNext[i] = -1;
      continue;
    }
    const cell = tileIndex(tx, ty);
    if (state.cellHead[cell] < 0) bodyCells.push(cell);
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
  // Phase H: never nudged through the corner between two diagonal solid tiles (moat / wall lines).
  // (canStepPixel from the body's current spot, written out: a per-call closure here showed in the profile.)
  const ex = b.e.x;
  const ey = b.e.y;
  const cornerCut = !canStepPixel(ex, ey, nx, ey) && !canStepPixel(ex, ey, ex, ny);
  if (!cornerCut && canStepPixel(ex, ey, nx, ny)) {
    b.e.x = nx;
    b.e.y = ny;
  } else if (canStepPixel(ex, ey, nx, ey)) {
    b.e.x = nx;
  } else if (canStepPixel(ex, ey, ex, ny)) {
    b.e.y = ny;
  }
  state.hostileMover = prevMover;
  state.moverOwner = prevOwner;
}

// Push-apart relaxation over every overlapping pair (allies and enemies alike).
const SEPARATION_BIG_CROWD = 1500;

export function separateBodies() {
  collectBodies();
  // Perf: a huge crowd gets one relaxation pass (units overlap a little more in a 3k v 3k fight; small games unchanged).
  const iterations = bodies.length > SEPARATION_BIG_CROWD ? 1 : SEPARATION_ITERATIONS;
  for (let iter = 0; iter < iterations; iter++) {
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
