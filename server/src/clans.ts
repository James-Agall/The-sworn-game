// clans.ts: Clans (PLAN-forts-diplomacy-moats.md decision 1, phase A2; ROADMAP "Clans — landed"). A clan owns
// its stock, equipment, goals, army, colonists, Town Centers (and so population caps), raid target and task
// forces; players of one clan share all of it. Clan 0 is the default (every player and every old save), so a
// game where nobody founds a clan behaves exactly like the single shared colony.
// The per-clan fields are accessors on `state` forwarding to `state.clan` (state.ts ClanFields): this module
// sets that context. Ownership of things on the map: player-built tiles (tileClan, missing = 0), colonists
// and Town Centers (`clan`, missing = 0), players (`clan`).
import { TileType } from "@colony/shared/protocol";
import type { Colonist, Player, TownCenter } from "./types.js";
import { BREAKABLE_TILES, GAME_DAY_TICKS, TOWN_CENTER_MIN_SPACING_TILES } from "./constants.js";
import { type Clan, clans, makeClan, state, tileClan, tileOwner } from "./state.js";
import { initialStock } from "./economy.js";
import { isInReservedGrounds } from "./worldgen.js";
import { topUpTownCenterBuilders, townCenterMaxHp } from "./colonists.js";
import { townCenterSpotOk } from "./construction.js";
import { refreshGoalSnapshot } from "./goals.js";
import { START_VISION_OFFSETS, broadcastTileUpdate, revealAround } from "./net.js";

export function clanById(id: number | undefined): Clan {
  return clans[id ?? 0] ?? clans[0];
}

export function clanOf(player: Player): Clan {
  return clanById(player.clan);
}

export function colonistClanId(c: Colonist): number {
  return c.clan ?? 0;
}

// True when `c` belongs to the active clan (state.clan).
export function inClan(c: { clan?: number }): boolean {
  return (c.clan ?? 0) === state.clan.id;
}

// Runs fn with `clan` as the active clan (and the clan its broadcastEvent toasts reach), restoring the
// previous context afterwards.
export function withClan<T>(clan: Clan, fn: () => T): T {
  const prevClan = state.clan;
  const prevEvent = state.eventClan;
  state.clan = clan;
  state.eventClan = clans.length > 1 ? clan : null;
  try {
    return fn();
  } finally {
    // A restart / load inside fn may have dropped the previous clan: fall back to clan 0.
    const alive = clans[prevClan.id] === prevClan;
    state.clan = alive ? prevClan : clans[0];
    state.eventClan = alive ? prevEvent : null;
  }
}

// Cheap per-entity context switch for hot loops (no closure): sets the active clan; call resetClan after.
export function enterClan(id: number | undefined) {
  if (clans.length === 1) return;
  const clan = clanById(id);
  state.clan = clan;
  state.eventClan = clan;
}

export function resetClan() {
  state.clan = clans[0];
  state.eventClan = null;
}

// Runs fn once per clan with that clan active (one call with clan 0 when there is only one clan).
export function forEachClan(fn: (clan: Clan) => void) {
  if (clans.length === 1) {
    fn(clans[0]);
    return;
  }
  for (const clan of clans) withClan(clan, () => fn(clan));
}

export function clanIdAtIndex(index: number): number {
  return tileClan.size === 0 ? 0 : tileClan.get(index) ?? 0;
}

export function clanIdAt(tx: number, ty: number): number {
  return tileClan.size === 0 ? 0 : tileClan.get(ty * state.WORLD_TILES_X + tx) ?? 0;
}

// Records the clan of a player-placed tile (clan 0 is the default, stored as "missing").
export function setTileClan(index: number, clanId: number) {
  if ((tileClan.get(index) ?? 0) === clanId) return;
  if (clanId > 0) tileClan.set(index, clanId);
  else tileClan.delete(index);
  state.clanTilesVersion++;
}

// The active clan's Town Centers (all of them while there is one clan).
export function clanTownCenters(): TownCenter[] {
  if (clans.length === 1) return state.townCenters;
  const id = state.clan.id;
  return state.townCenters.filter((tc) => (tc.clan ?? 0) === id);
}

// Town Centers of clan `id` (all of them while there is one clan).
export function townCentersOfClan(id: number | undefined): TownCenter[] {
  if (clans.length === 1) return state.townCenters;
  const want = id ?? 0;
  return state.townCenters.filter((tc) => (tc.clan ?? 0) === want);
}

// A tile a clan can own: player buildings, construction sites, Town Centers (not rubble / natural tiles).
export function isClanOwnableTile(t: TileType): boolean {
  return t !== TileType.Rubble && (t === TileType.TownCenter || t === TileType.ConstructionSite || BREAKABLE_TILES.includes(t));
}

// True when (tx, ty) is a building of a clan other than `clanId` (edits / orders on it are refused).
export function isForeignClanTile(tx: number, ty: number, clanId: number): boolean {
  if (clanIdAt(tx, ty) === clanId) return false;
  return isClanOwnableTile(state.tiles[ty * state.WORLD_TILES_X + tx] as TileType);
}

// Player-morale key of an army regiment id of the active clan (regiment ids like "tf1" repeat across clans).
export function moraleKey(regimentId: string): string {
  return state.clan.id === 0 ? regimentId : `${state.clan.id}|${regimentId}`;
}

// ---- Founding a clan ----

// A Town Center spot for a new clan: open plains-like ground (5x5 clear of buildings, resources and water),
// a legal Town Center spot, outside the Abbey / Castle Ruin grounds and fort tiles, at least a quarter of the
// map side (and the Town Center spacing) from every Town Center, inside the map margin. Random sampling, the first fit wins; null when none is found.
export function findClanSite(): { x: number; y: number } | null {
  const size = state.WORLD_TILES_X;
  const minD = Math.max(TOWN_CENTER_MIN_SPACING_TILES, Math.floor(size / 4));
  const margin = 6;
  for (let tries = 0; tries < 4000; tries++) {
    const x = margin + Math.floor(Math.random() * (size - 2 * margin));
    const y = margin + Math.floor(Math.random() * (state.WORLD_TILES_Y - 2 * margin));
    if (state.townCenters.some((tc) => Math.hypot(tc.x - x, tc.y - y) < minD)) continue;
    if (isInReservedGrounds(x, y)) continue;
    let clear = true;
    for (let dy = -2; dy <= 2 && clear; dy++) {
      for (let dx = -2; dx <= 2 && clear; dx++) {
        const i = (y + dy) * size + (x + dx);
        if (state.tiles[i] !== TileType.Empty || tileOwner.has(i)) clear = false;
      }
    }
    if (!clear || !townCenterSpotOk(x, y)) continue;
    return { x, y };
  }
  return null;
}

// The player founds a new clan: its own stock (the starting stock), goals from scratch, a Town Center with
// its starting builder on a free spot (findClanSite). Returns the clan, or null (no room: stays in its clan).
export function foundClan(player: Player): Clan | null {
  const spot = findClanSite();
  if (!spot) return null;
  const id = clans.length;
  const clan = makeClan(id, `Clan ${id}`, player.color, Math.floor(state.cycleTick / GAME_DAY_TICKS));
  Object.assign(clan.stock, initialStock());
  clans.push(clan);
  player.clan = id;
  withClan(clan, () => {
    setTileClan(spot.y * state.WORLD_TILES_X + spot.x, id);
    state.tiles[spot.y * state.WORLD_TILES_X + spot.x] = TileType.TownCenter;
    const tc: TownCenter = { x: spot.x, y: spot.y, level: 1, hp: townCenterMaxHp(1), clan: id };
    state.townCenters.push(tc);
    broadcastTileUpdate(spot.x, spot.y, TileType.TownCenter);
    revealAround(spot.x, spot.y, START_VISION_OFFSETS);
    topUpTownCenterBuilders(tc);
    refreshGoalSnapshot();
  });
  state.heroRosterVersion++;
  return clan;
}

// Snapshot `clanTiles`: [tile index, clan id] for every clan-ownable tile (clan 0's included), one map pass.
export function clanTilesForSnapshot(): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (isClanOwnableTile(state.tiles[i] as TileType)) out.push(i, clanIdAtIndex(i));
  }
  return out;
}
