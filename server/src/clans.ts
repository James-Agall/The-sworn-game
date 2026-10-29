// clans.ts: Clans (PLAN-forts-diplomacy-moats.md decision 1, phase A2; ROADMAP "Clans — landed"). A clan owns
// its stock, equipment, goals, army, colonists, Town Centers (and so population caps), raid target and task
// forces; players of one clan share all of it. Clan 0 is the default (every player and every old save), so a
// game where nobody founds a clan behaves exactly like the single shared colony.
// The per-clan fields are accessors on `state` forwarding to `state.clan` (state.ts ClanFields): this module
// sets that context. Ownership of things on the map: player-built tiles (tileClan, missing = 0), colonists
// and Town Centers (`clan`, missing = 0), players (`clan`).
import type { Colonist, Player, TownCenter } from "./types.js";
import { type Clan, clans, state, tileClan } from "./state.js";

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
    state.clan = prevClan;
    state.eventClan = prevEvent;
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
