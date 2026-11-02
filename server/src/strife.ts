// strife.ts: World streaming phase 5 (PLAN-world-streaming.md §4 "settlements vs settlements / camps vs
// settlements"). At dawn, with streaming on, a standing bandit / orc camp or fort whose keep chunk is COLD may raid
// the nearest standing human settlement that is COLD too (never a clan's vassal): one strength roll, a chronicle
// line, stock and parked-garrison losses. A much stronger raider besieges it instead: the settlement posts every
// clan a "help us" quest (break the camp) and may fall after STRIFE_SIEGE_DAYS if the camp still stands and the
// settlement is still out of sight. Neighbouring COLD settlements now and then feud (stock only, never a fall).
// Dice from worldRng (site id, day), so a reload rolls the same. Nothing here touches a player unit or building.
import { TileType } from "@colony/shared/protocol";
import type { SiteState } from "./types.js";
import { GAME_DAY_TICKS } from "./constants.js";
import { clans, hearths, mobs, parkedMobs, sites, state } from "./state.js";
import { ChunkState, chunkOfIndex, chunkStateOf, setTile, streamingOn } from "./chunks.js";
import { dropParkedMob, dropParkedSiteMobs, hashId, worldRng } from "./abstract.js";
import { gameDay, standingTown } from "./diplomacy.js";
import { tileIndex } from "./tiles.js";
import { broadcastTileUpdate } from "./net.js";
import { chronicle } from "./chronicle.js";
import { postHelpQuest } from "./quests.js";

export const STRIFE_RAID_RANGE_TILES = 140;
export const STRIFE_RAID_CHANCE = 0.05;
export const STRIFE_RAID_CHANCE_PER_TIER = 0.02;
// Attacker strength at least this times the defender's: a siege (telegraphed) instead of a plain raid.
export const STRIFE_SIEGE_RATIO = 1.5;
export const STRIFE_SIEGE_DAYS = 2;
export const STRIFE_FALL_CHANCE = 0.5;
export const STRIFE_FEUD_RANGE_TILES = 110;
export const STRIFE_FEUD_CHANCE = 0.01;
// A settlement's walls / militia count as this many garrison members.
const STRIFE_WALL_STRENGTH = 4;

export interface StrifeOptions {
  // Tests: every camp raids (any distance), every raid succeeds, every success besieges / every due siege falls.
  forceRaid?: boolean;
  forceSiege?: boolean;
  forceFall?: boolean;
}
export const strifeStats = { raids: 0, repelled: 0, sieges: 0, fallen: 0, relieved: 0, feuds: 0 };

const isCamp = (s: SiteState) => (s.faction === "bandit" || s.faction === "orc") && !s.cleared && !s.captured;
const coldSite = (s: SiteState) => chunkStateOf(chunkOfIndex(tileIndex(s.keepX, s.keepY))) === ChunkState.Cold;
const where = (s: SiteState) => (s.sighted ? s.name : "a distant settlement");
const campName = (s: SiteState) => (s.sighted ? s.name : `${s.faction === "orc" ? "an orc" : "a bandit"} camp`);

function livingGarrison(s: SiteState): string[] {
  return s.garrison.filter((id) => (mobs.get(id)?.hp ?? parkedMobs.get(id)?.hp ?? 0) > 0);
}

// Up to n parked members of s die (live ones are left alone: they are near someone).
function lose(s: SiteState, n: number) {
  for (const id of [...s.garrison]) {
    if (n <= 0) break;
    if (!parkedMobs.has(id)) continue;
    dropParkedMob(id);
    s.garrison = s.garrison.filter((g) => g !== id);
    n--;
  }
}

function plunder(from: SiteState, to: SiteState | null, share: number): number {
  let total = 0;
  for (const k of Object.keys(from.stock) as (keyof SiteState["stock"])[]) {
    const take = Math.floor((from.stock[k] ?? 0) * share);
    if (take <= 0) continue;
    from.stock[k] = (from.stock[k] ?? 0) - take;
    if (to) to.stock[k] = (to.stock[k] ?? 0) + take;
    total += take;
  }
  return total;
}

function nearestTown(c: SiteState, range: number): SiteState | null {
  let best: SiteState | null = null;
  let bestD = range;
  for (const t of sites.values()) {
    if (!standingTown(t) || (t.vassalOf ?? null) !== null || !coldSite(t)) continue;
    const d = Math.hypot(t.keepX - c.keepX, t.keepY - c.keepY);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best as SiteState | null;
}

// The abstract fall: the keep is a ruin, the hearth out, the parked garrison gone (no clan pays relation).
function fall(t: SiteState, by: SiteState) {
  t.cleared = true;
  t.provoked = false;
  delete t.threat;
  state.ownerVersion++;
  state.relationsVersion++;
  setTile(tileIndex(t.keepX, t.keepY), TileType.RuinedKeep);
  broadcastTileUpdate(t.keepX, t.keepY, TileType.RuinedKeep);
  const h = hearths.get(t.id);
  if (h) h.destroyed = true;
  dropParkedSiteMobs(t.id);
  t.garrison = t.garrison.filter((id) => mobs.has(id));
  strifeStats.fallen++;
  chronicle("settlement", `${where(t)} has fallen to raiders from ${campName(by)}`, { x: t.keepX, y: t.keepY });
}

// sim.ts at dawn (and the strifeDawn test hook).
export function strifeDawn(opts: StrifeOptions = {}) {
  if (!streamingOn()) return;
  const day = gameDay();
  const now = state.cycleTick;
  // Sieges first: relieved (the camp is gone, or someone is near: the real sim takes over), fallen, or held.
  for (const t of sites.values()) {
    if (!t.threat) continue;
    const by = sites.get(t.threat.by);
    if (t.cleared || t.captured) {
      delete t.threat;
      continue;
    }
    if (!by || !isCamp(by) || !coldSite(t)) {
      delete t.threat;
      strifeStats.relieved++;
      chronicle("settlement", `The siege of ${where(t)} is lifted`, { x: t.keepX, y: t.keepY });
      continue;
    }
    if (now < t.threat.fallTick && !opts.forceFall) continue;
    if (opts.forceFall || worldRng(hashId(t.id), day, 3)() < STRIFE_FALL_CHANCE) fall(t, by);
    else {
      delete t.threat;
      chronicle("settlement", `${where(t)} held out against ${campName(by)}`, { x: t.keepX, y: t.keepY });
    }
  }
  for (const c of sites.values()) {
    if (!isCamp(c) || !coldSite(c)) continue;
    const rng = worldRng(hashId(c.id), day, 1);
    if (!opts.forceRaid && rng() >= STRIFE_RAID_CHANCE + STRIFE_RAID_CHANCE_PER_TIER * (c.tier - 1)) continue;
    const t = nearestTown(c, opts.forceRaid ? Infinity : STRIFE_RAID_RANGE_TILES);
    if (!t || t.threat) continue;
    const atk = livingGarrison(c).length * (1 + 0.25 * (c.tier - 1));
    const def = livingGarrison(t).length + STRIFE_WALL_STRENGTH;
    if (atk <= 0) continue;
    if (!opts.forceRaid && rng() >= atk / (atk + def)) {
      lose(c, 1 + Math.floor(rng() * 2));
      strifeStats.repelled++;
      chronicle("raid", `${where(t)} drove off raiders from ${campName(c)}`, { x: t.keepX, y: t.keepY });
      continue;
    }
    if (opts.forceSiege || atk >= STRIFE_SIEGE_RATIO * def) {
      // Telegraphed: no fall without a "help us" first.
      t.threat = { by: c.id, fallTick: now + STRIFE_SIEGE_DAYS * GAME_DAY_TICKS };
      strifeStats.sieges++;
      chronicle("settlement", `Raiders from ${campName(c)} besiege ${where(t)}; it begs the clans for help`, { x: t.keepX, y: t.keepY });
      for (const clan of clans) postHelpQuest(t, clan.id, c.id, t.threat.fallTick);
      continue;
    }
    const took = plunder(t, c, 0.25);
    lose(t, 1 + Math.floor(rng() * 2));
    strifeStats.raids++;
    chronicle("raid", `Raiders from ${campName(c)} sacked the outskirts of ${where(t)}${took > 0 ? ` and carried off ${took} goods` : ""}`, { x: t.keepX, y: t.keepY });
  }
  // Settlement feuds: each close COLD pair rolls once a day.
  const towns = [...sites.values()].filter((t) => standingTown(t) && coldSite(t));
  for (let i = 0; i < towns.length; i++) {
    for (let j = i + 1; j < towns.length; j++) {
      const a = towns[i];
      const b = towns[j];
      if (Math.hypot(a.keepX - b.keepX, a.keepY - b.keepY) > STRIFE_FEUD_RANGE_TILES) continue;
      const rng = worldRng(hashId(a.id), hashId(b.id), day, 2);
      if (rng() >= STRIFE_FEUD_CHANCE) continue;
      const [winner, loser] = rng() < 0.5 ? [a, b] : [b, a];
      plunder(loser, winner, 0.1);
      strifeStats.feuds++;
      chronicle("feud", `${where(winner)} and ${where(loser)} quarrel over grazing; ${where(winner)} comes out ahead`, { x: loser.keepX, y: loser.keepY });
    }
  }
}
