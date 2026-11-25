import { FORT_BUILDABLE, FORT_GATES, isFortification, isFortPart, isLargeGate, isWideBridge, fortPartner, fortAnchor, rampartTransition } from "@colony/shared/fortifications";
// pathfinding.ts: Walkability, breadth-first paths, path following, and body separation (spatial hash).
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
import { cachedPath, pathCacheKey, pathCacheStats, storePathChunks, pathDependencyChunks, CHUNK_TILES } from "./chunks.js";

const VERIFY_PATH_CACHE = process.env.COLONY_TEST_HOOKS === "1" && process.env.COLONY_PATH_CACHE_VERIFY === "1";
import { isWardPriest } from "./colonists.js";
import { isGuardOrMilitiaKind } from "./units.js";
import { gatePassable } from "./combat.js";
import { isDormantGuardian, mobBodyRadius } from "./mobs.js";

const WALKABLE = Uint8Array.from({ length: 256 }, (_, t) => t === TileType.Rampart || !isSolidTile(t as TileType) ? 1 : 0);

export function isWalkableTile(tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  const t = state.tiles[tileIndex(tx, ty)] as TileType;
  // Gates: passable by their state, from the current mover's side (hostileMover).
  if (isGateTile(t)) {
    sawGate = true;
    return gatePassable(tileIndex(tx, ty), state.hostileMover);
  }
  return t === undefined ? !isSolidTile(t) : WALKABLE[t] === 1;
}
export function canStepTile(fx:number,fy:number,tx:number,ty:number):boolean {
 if(!inBounds(fx,fy)||!inBounds(tx,ty))return false;
 const from=state.tiles[tileIndex(fx,fy)],to=state.tiles[tileIndex(tx,ty)];
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
// blocked (optional, forts phase E wagon detours): extra tiles this search treats as unwalkable.
export function findPath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): TileCoord[] | null {
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
  const result = searchPath(start, goal, blocked);
  if (cacheable && !sawGate) storePathChunks(ck, result.path, result.chunks);
  sawGate = prevSawGate || sawGate;
  return result.path;
}

interface SearchWorkspace {
  width: number; height: number; generation: number; columns: number;
  seen: Uint32Array; parents: Int32Array; queue: Int32Array;
  chunkSeen: Uint32Array; chunks: Int32Array; chunkCount: number;
}
// Searches are synchronous. A small pool also protects the workspace if a blocked callback starts
// another search. Returned paths own their coordinates; only cache dependency scratch is borrowed.
const searchWorkspaces: SearchWorkspace[] = [];
let searchDepth = 0;
const PROFILE_PATHS = process.env.COLONY_TEST_HOOKS === "1" || process.env.COLONY_PERF === "1";
export const pathSearchStats = { searches: 0, visited: 0, maxVisited: 0, totalMs: 0, maxMs: 0, budgetExceeded: 0 };
function searchChunk(w: SearchWorkspace, c: number) {
  if (w.chunkSeen[c] === w.generation) return;
  w.chunkSeen[c] = w.generation;
  w.chunks[w.chunkCount++] = c;
}
function searchDependencies(w: SearchWorkspace, x: number, y: number) {
  const cx = x >>> 5, cy = y >>> 5, c = cy * w.columns + cx;
  searchChunk(w, c);
  // Match the old cache's visited tile AND its four neighbours, including unexpanded nodes.
  if ((x & 31) === 0 && x > 0) searchChunk(w, c - 1);
  if ((x & 31) === 31 && x < w.width - 1) searchChunk(w, c + 1);
  if ((y & 31) === 0 && y > 0) searchChunk(w, c - w.columns);
  if ((y & 31) === 31 && y < w.height - 1) searchChunk(w, c + w.columns);
}
function searchPath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): { path: TileCoord[] | null; chunks: Int32Array } {
  const width = state.WORLD_TILES_X, height = state.WORLD_TILES_Y, size = width * height;
  // Normal game coordinates are integral. Retain the old behaviour for unusual diagnostic callers.
  if (!Number.isInteger(start.x) || !Number.isInteger(start.y) || !Number.isInteger(goal.x) || !Number.isInteger(goal.y)) {
    const old = legacySearchPath(start, goal, blocked);
    return { path: old.path, chunks: pathDependencyChunks(old.visited) };
  }
  if (!inBounds(start.x, start.y)) return { path: null, chunks: new Int32Array() };
  const slot = searchDepth++;
  let w = searchWorkspaces[slot];
  if (!w || w.width !== width || w.height !== height) {
    const columns = Math.ceil(width / CHUNK_TILES), count = columns * Math.ceil(height / CHUNK_TILES);
    w = { width, height, columns, generation: 0, seen: new Uint32Array(size), parents: new Int32Array(size), queue: new Int32Array(size), chunkSeen: new Uint32Array(count), chunks: new Int32Array(count), chunkCount: 0 };
    searchWorkspaces[slot] = w;
  }
  w.generation = (w.generation + 1) >>> 0;
  if (!w.generation) { w.seen.fill(0); w.chunkSeen.fill(0); w.generation = 1; }
  w.chunkCount = 0;
  const began = PROFILE_PATHS ? performance.now() : 0;
  let tail = 1;
  const first = start.y * width + start.x, target = goal.y * width + goal.x;
  w.queue[0] = first; w.seen[first] = w.generation;
  searchDependencies(w, start.x, start.y);
  try {
    for (let head = 0; head < tail; head++) {
      if (head > PATH_NODE_BUDGET) { if (PROFILE_PATHS) pathSearchStats.budgetExceeded++; break; }
      const current = w.queue[head], x = current % width, y = (current - x) / width;
      // East, west, south, north: preserve the original BFS's exact tie-breaking and node budget.
      for (let direction = 0; direction < 4; direction++) {
        const nx = x + (direction === 0 ? 1 : direction === 1 ? -1 : 0);
        const ny = y + (direction === 2 ? 1 : direction === 3 ? -1 : 0);
        if (!canStepTile(x, y, nx, ny)) continue;
        if (blocked && blocked(nx, ny) && !(nx === goal.x && ny === goal.y)) continue;
        const next = ny * width + nx;
        if (w.seen[next] === w.generation) continue;
        w.seen[next] = w.generation; w.parents[next] = current;
        searchDependencies(w, nx, ny);
        w.queue[tail++] = next;
        if (next === target && nx === goal.x && ny === goal.y) {
          const path: TileCoord[] = [];
          for (let back = next; back !== first; back = w.parents[back]) path.push({ x: back % width, y: Math.floor(back / width) });
          path.reverse();
          return { path, chunks: w.chunks.subarray(0, w.chunkCount) };
        }
      }
    }
    return { path: null, chunks: w.chunks.subarray(0, w.chunkCount) };
  } finally {
    searchDepth--;
    if (PROFILE_PATHS) {
      const ms = performance.now() - began;
      pathSearchStats.searches++; pathSearchStats.visited += tail;
      pathSearchStats.maxVisited = Math.max(pathSearchStats.maxVisited, tail);
      pathSearchStats.totalMs += ms; pathSearchStats.maxMs = Math.max(pathSearchStats.maxMs, ms);
    }
  }
}

function legacySearchPath(start: TileCoord, goal: TileCoord, blocked?: (x: number, y: number) => boolean): { path: TileCoord[] | null; visited: Set<number> } {
  const key = (t: TileCoord) => t.y * state.WORLD_TILES_X + t.x;
  const visited = new Set<number>([key(start)]);
  const parent = new Map<number, TileCoord>();
  const queue: TileCoord[] = [start];

  // Node budget: a request can never stall a tick on a huge map (a 160 map has 25.6k tiles in all, so
  // it is never reached there). Over budget = no path, like an unreachable goal.
  for (let head = 0; head < queue.length; head++) {
    if (head > PATH_NODE_BUDGET) return { path: null, visited };
    const current = queue[head];
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const n of neighbors) {
      if (!canStepTile(current.x,current.y,n.x,n.y)) continue;
      if (blocked && blocked(n.x, n.y) && !(n.x === goal.x && n.y === goal.y)) continue;
      const k = key(n);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, current);
      if (n.x === goal.x && n.y === goal.y) {
        const path: TileCoord[] = [n];
        let back = current;
        while (!(back.x === start.x && back.y === start.y)) {
          path.push(back);
          back = parent.get(key(back))!;
        }
        path.reverse();
        return { path, visited };
      }
      queue.push(n);
    }
  }
  return { path: null, visited };
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
  const step=(x:number,y:number)=>canStepPixel(b.e.x,b.e.y,x,y);
  const cornerCut = !step(nx,b.e.y) && !step(b.e.x,ny);
  if (!cornerCut && step(nx,ny)) {
    b.e.x = nx;
    b.e.y = ny;
  } else if (step(nx,b.e.y)) {
    b.e.x = nx;
  } else if (step(b.e.x,ny)) {
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
