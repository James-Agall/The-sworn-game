// net.ts: Networking: the HTTP/WebSocket server objects, broadcasts, welcome, fog of war, fight notifiers, view culling.
// Split out of index.ts (ROADMAP "Server module split"); behaviour unchanged.
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import {
  VISION_RADIUS_PLAYER, VISION_RADIUS_COLONIST, VISION_RADIUS_BUILDING, VISION_RADIUS_START, TILE_SIZE,
  type ServerMessage, type TileType, type GameEventCategory, type FightKind, bossTitle, FIGHT_CLUSTER_TILES,
  FIGHT_WINDOW_SECONDS, TICK_RATE, type FightSnapshot, FIGHT_RELEVANCE_TILES, FIGHT_MAX_PER_PLAYER,
} from "@colony/shared/protocol";
import type { ActiveFight, FightHit, Mob, Player } from "./types.js";
import {
  EXPLORED_FLUSH_TICKS, FIGHT_BATTLE_COMBATANTS, FIGHT_BATTLE_DPS, FIGHT_MAJOR_COMBATANTS, FIGHT_MAJOR_DPS,
  FIGHT_MAX_HITS, FIGHT_MAX_TRACKED, FIGHT_RAID_LABELS, FIGHT_WINDOW_TICKS, SET_VIEW_MIN_MS,
  STRATEGY_VIEW_MARGIN_TILES, STRATEGY_VIEW_MAX_HALF_TILES, VISION_BUILDING_TILES,
} from "./constants.js";
import { clans, colonists, players, state, tileClan } from "./state.js";
import { clamp } from "./tiles.js";
import { TOWN_CENTER_TILE, isAbbeyClergy } from "./colonists.js";
import { listSaves } from "./saves.js";
import { isClanOwnableTile, setTileClan } from "./clans.js";

// ---- Fog of war (minimap only) ----

export function circleOffsets(radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push([dx, dy]);
    }
  }
  return out;
}
export const PLAYER_VISION_OFFSETS = circleOffsets(VISION_RADIUS_PLAYER);
export const COLONIST_VISION_OFFSETS = circleOffsets(VISION_RADIUS_COLONIST);
export const BUILDING_VISION_OFFSETS = circleOffsets(VISION_RADIUS_BUILDING);
export const START_VISION_OFFSETS = circleOffsets(VISION_RADIUS_START);

export function revealAround(tx: number, ty: number, offsets: Array<[number, number]>) {
  for (const [dx, dy] of offsets) {
    const x = tx + dx;
    const y = ty + dy;
    if (x < 0 || y < 0 || x >= state.WORLD_TILES_X || y >= state.WORLD_TILES_Y) continue;
    const index = y * state.WORLD_TILES_X + x;
    if (state.explored[index]) continue;
    state.explored[index] = 1;
    state.pendingExplored.push(index);
  }
}

export function revealFrom(source: object, px: number, py: number, offsets: Array<[number, number]>) {
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const index = ty * state.WORLD_TILES_X + tx;
  if (state.visionTile.get(source) === index) return;
  state.visionTile.set(source, index);
  revealAround(tx, ty, offsets);
}

export function updateVision() {
  for (const p of players.values()) revealFrom(p, p.x, p.y, PLAYER_VISION_OFFSETS);
  // The Abbey's clergy are world-gen residents, not the colony's eyes.
  for (const c of colonists.values()) {
    if (!isAbbeyClergy(c)) revealFrom(c, c.x, c.y, COLONIST_VISION_OFFSETS);
  }
}

export function resetExplored() {
  state.explored.fill(0);
  state.visionTile = new WeakMap();
  revealAround(TOWN_CENTER_TILE.x, TOWN_CENTER_TILE.y, START_VISION_OFFSETS);
  // The fresh world reaches clients whole, in `welcome`.
  state.pendingExplored = [];
}

export function packExplored(): string {
  const bytes = new Uint8Array(Math.ceil(state.explored.length / 8));
  for (let i = 0; i < state.explored.length; i++) {
    if (state.explored[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

export function flushExplored() {
  if (--state.exploredFlushCountdown > 0) return;
  state.exploredFlushCountdown = EXPLORED_FLUSH_TICKS;
  if (state.pendingExplored.length === 0) return;
  const message: ServerMessage = { type: "explored", tiles: state.pendingExplored };
  state.pendingExplored = [];
  const payload = JSON.stringify(message);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

export function broadcastTileUpdate(tx: number, ty: number, tile: TileType) {
  // Clans: a tile that is no longer a building (cleared, destroyed, reverted to ore) loses its clan.
  if (tileClan.size > 0 && !isClanOwnableTile(tile)) setTileClan(ty * state.WORLD_TILES_X + tx, 0);
  // With 2+ clans every building change resends snapshot `clanTiles` (clan 0's buildings are listed too).
  if (clans.length > 1) state.clanTilesVersion++;
  state.buildingTargetsDirty = true;
  state.gateTilesDirty = true;
  if (VISION_BUILDING_TILES.has(tile)) revealAround(tx, ty, BUILDING_VISION_OFFSETS);
  const update: ServerMessage = { type: "tileUpdate", tileX: tx, tileY: ty, tile };
  const payload = JSON.stringify(update);
  for (const p of players.values()) {
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}

// Clans: inside a clan context (state.eventClan) only that clan's players get the toast.
export function broadcastEvent(category: GameEventCategory, text: string) {
  const event: ServerMessage = { type: "event", category, text };
  const payload = JSON.stringify(event);
  const only = state.eventClan;
  for (const p of players.values()) {
    if (only && p.clan !== only.id) continue;
    if (p.socket.readyState === p.socket.OPEN) {
      p.socket.send(payload);
    }
  }
}
// One HTTP server on PORT: websocket upgrades go to `wss`; plain GET /saves lists the save slots for
// the main menu (which has no websocket open yet).
export const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url?.split("?")[0] === "/saves") {
    void listSaves().then((saves) => {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ saves }));
    });
    return;
  }
  res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
  res.end();
});
export const wss = new WebSocketServer({ server: httpServer });

export function sendWelcome(player: Player) {
  const welcome: ServerMessage = {
    type: "welcome",
    id: player.id,
    tileSize: TILE_SIZE,
    worldTilesX: state.WORLD_TILES_X,
    worldTilesY: state.WORLD_TILES_Y,
    tiles: Array.from(state.tiles),
    biomes: Array.from(state.biomes),
    explored: packExplored(),
    difficulty: state.difficulty,
    castleRuin: state.castleRuinCenter,
    ...(state.creative ? { creative: true } : {}),
  };
  player.socket.send(JSON.stringify(welcome));
}

export function clearFights() {
  state.fightHits = [];
  state.activeFights = [];
}

export function fightThreatOf(mob: Mob): { kind: FightKind; label: string; rank: number } {
  if (mob.boss === "warlord") return { kind: "boss", label: bossTitle(mob.kind, "warlord"), rank: 7 };
  if (mob.siteKind === "castleRuin") return { kind: "boss", label: "Castle Ruin", rank: 6 };
  if (mob.boss === "elite") return { kind: "boss", label: bossTitle(mob.kind, "elite"), rank: 5 };
  if (mob.siteKind === "miniBoss") return { kind: "boss", label: "Mini-boss pack", rank: 5 };
  if (mob.siteKind === "ruin") return { kind: "guardians", label: "Ruin guardians", rank: 4 };
  if (mob.siteKind === "encampment") return { kind: "guardians", label: "Bandit camp", rank: 4 };
  if (mob.isDeserter) return { kind: "deserters", label: "Deserters", rank: 3 };
  if (mob.kind === "halfLatch") return { kind: "monsters", label: "Half-Latch", rank: 1 };
  return { kind: "raid", label: FIGHT_RAID_LABELS[mob.kind] ?? "Greenskin raid", rank: 2 };
}

export function recordFightHit(mob: Mob, x: number, y: number, other: string, amount: number) {
  const id = other.slice(2);
  const colonist = other.startsWith("c:") ? colonists.get(id) : undefined;
  state.fightHits.push({
    tick: state.cycleTick,
    x,
    y,
    mobId: mob.id,
    other,
    amount,
    units: !!colonist && !isAbbeyClergy(colonist),
    buildings: other.startsWith("b:"),
    playerId: other.startsWith("p:") ? id : null,
    ...fightThreatOf(mob),
  });
  if (state.fightHits.length > FIGHT_MAX_HITS) state.fightHits.splice(0, state.fightHits.length - FIGHT_MAX_HITS);
}

// A mob's own blow on its current target, logged halfway between the two.
export function recordMobStrike(mob: Mob, hitX: number, hitY: number) {
  const prefix = mob.targetType === "colonist" ? "c:" : mob.targetType === "player" ? "p:" : "b:";
  recordFightHit(mob, (mob.x + hitX) / 2, (mob.y + hitY) / 2, prefix + mob.targetId, mob.damage);
}

export function scanFights() {
  const cutoff = state.cycleTick - FIGHT_WINDOW_TICKS;
  // A setCycleTick (tests) can move time backwards: future-dated hits go too.
  state.fightHits = state.fightHits.filter((h) => h.tick > cutoff && h.tick <= state.cycleTick);

  interface Cluster {
    sumX: number;
    sumY: number;
    n: number;
    hits: FightHit[];
  }
  const radius = FIGHT_CLUSTER_TILES * TILE_SIZE;
  const clusters: Cluster[] = [];
  for (const h of state.fightHits) {
    let best: Cluster | null = null;
    let bestD = radius;
    for (const c of clusters) {
      const d = Math.hypot(c.sumX / c.n - h.x, c.sumY / c.n - h.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) {
      best = { sumX: 0, sumY: 0, n: 0, hits: [] };
      clusters.push(best);
    }
    best.sumX += h.x;
    best.sumY += h.y;
    best.n++;
    best.hits.push(h);
  }
  // Centroids drift as hits join: merge any two that ended up within the radius.
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        if (Math.hypot(a.sumX / a.n - b.sumX / b.n, a.sumY / a.n - b.sumY / b.n) > radius) continue;
        a.sumX += b.sumX;
        a.sumY += b.sumY;
        a.n += b.n;
        a.hits.push(...b.hits);
        clusters.splice(j, 1);
        merged = true;
        break;
      }
    }
  }

  const next: ActiveFight[] = clusters.map((c) => {
    const combatants = new Set<string>();
    const playerIds = new Set<string>();
    let damage = 0;
    let lastTick = 0;
    let units = false;
    let buildings = false;
    let top = c.hits[0];
    for (const h of c.hits) {
      combatants.add("m:" + h.mobId);
      combatants.add(h.other);
      damage += h.amount;
      lastTick = Math.max(lastTick, h.tick);
      units ||= h.units;
      buildings ||= h.buildings;
      if (h.playerId) playerIds.add(h.playerId);
      if (h.rank > top.rank) top = h;
    }
    const dps = Math.round(damage / FIGHT_WINDOW_SECONDS);
    const count = combatants.size;
    const intensity: 1 | 2 | 3 =
      count >= FIGHT_MAJOR_COMBATANTS || dps >= FIGHT_MAJOR_DPS ? 3 : count >= FIGHT_BATTLE_COMBATANTS || dps >= FIGHT_BATTLE_DPS ? 2 : 1;
    return {
      id: 0,
      x: Math.floor(c.sumX / c.n / TILE_SIZE),
      y: Math.floor(c.sumY / c.n / TILE_SIZE),
      combatants: count,
      dps,
      intensity,
      kind: top.kind,
      label: top.label,
      units,
      buildings,
      quiet: Math.round(((state.cycleTick - lastTick) / TICK_RATE) * 10) / 10,
      playerIds,
      lastTick,
    };
  });
  next.sort((a, b) => b.combatants - a.combatants);
  next.length = Math.min(next.length, FIGHT_MAX_TRACKED);

  // Keep ids stable: biggest fights first claim the nearest previous fight within ~1.5 radii.
  const unclaimed = state.activeFights.slice();
  for (const f of next) {
    let bestIdx = -1;
    let bestD = FIGHT_CLUSTER_TILES * 1.5;
    unclaimed.forEach((p, i) => {
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d <= bestD) {
        bestD = d;
        bestIdx = i;
      }
    });
    f.id = bestIdx >= 0 ? unclaimed.splice(bestIdx, 1)[0].id : state.nextFightId++;
  }
  state.activeFights = next;
}

// The colony is shared, so any fight its units or buildings are in concerns every player; other
// fights (a lone rider, the Abbey's clergy) only those within FIGHT_RELEVANCE_TILES. Fights the
// player is in come first, then bigger, then nearer.
export function fightsForPlayer(player: Player): FightSnapshot[] {
  if (state.activeFights.length === 0) return [];
  const ptx = player.x / TILE_SIZE;
  const pty = player.y / TILE_SIZE;
  return state.activeFights
    .map((f) => ({ f, you: f.playerIds.has(player.id), dist: Math.hypot(f.x + 0.5 - ptx, f.y + 0.5 - pty) }))
    .filter(({ f, you, dist }) => you || f.units || f.buildings || dist <= FIGHT_RELEVANCE_TILES)
    .sort((a, b) => Number(b.you) - Number(a.you) || b.f.intensity - a.f.intensity || a.dist - b.dist)
    .slice(0, FIGHT_MAX_PER_PLAYER)
    .map(({ f, you }): FightSnapshot => ({
      id: f.id,
      x: f.x,
      y: f.y,
      combatants: f.combatants,
      dps: f.dps,
      intensity: f.intensity,
      kind: f.kind,
      label: f.label,
      units: f.units,
      buildings: f.buildings,
      you,
      quiet: f.quiet,
    }));
}

// Splices the player's `fights` into the shared snapshot JSON (omitted when they have none).
export function withPlayerFights(payload: string, player: Player): string {
  const fights = fightsForPlayer(player);
  if (fights.length === 0) return payload;
  return payload.slice(0, -1) + ',"fights":' + JSON.stringify(fights) + "}";
}

// Validates / clamps a setView. Only culling reads it: dormancy, raids and fights still key off the rider.
export function handleSetView(player: Player, msg: { x: unknown; y: unknown; halfW: unknown; halfH: unknown; strategy: unknown }) {
  if (msg.strategy !== true) {
    player.view = null;
    return;
  }
  const now = Date.now();
  if (now - player.viewSetAt < SET_VIEW_MIN_MS) return;
  const nums = [msg.x, msg.y, msg.halfW, msg.halfH];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return;
  const [x, y, halfW, halfH] = nums as number[];
  player.viewSetAt = now;
  player.view = {
    x: clamp(x, 0, state.WORLD_TILES_X) * TILE_SIZE,
    y: clamp(y, 0, state.WORLD_TILES_Y) * TILE_SIZE,
    halfW: (clamp(halfW, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
    halfH: (clamp(halfH, 1, STRATEGY_VIEW_MAX_HALF_TILES) + STRATEGY_VIEW_MARGIN_TILES) * TILE_SIZE,
  };
}
