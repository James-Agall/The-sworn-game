// In-process regression for the raid-march fix (RAID-MARCH-2026-11-27.md). No server, no sockets: the raid
// module runs on a hand-built map and is stepped tick by tick.
//   A  a building 5 tiles off the route is walked past: the group keeps marching and reaches the Town Center
//   B  a building 1 tile off the route is attacked (group released onto it), then the same group re-forms
//      when it falls and marches on to the Town Center
//   C  the side-target cap (RAID_SIDE_TARGET_MAX): the next building on the route is ignored
//   D  the stuck timeout: a building that never falls is given up after RAID_SIDE_TARGET_TIMEOUT_TICKS
//   E  the raid warning: direction / distance / ETA from the live group, refresh, and the cleared message
import assert from "node:assert/strict";
import { TileType as T, TILE_SIZE, TICK_RATE } from "@colony/shared/protocol";
import { compassDirection, isRaidWarning, isRaidWarningCleared } from "@colony/shared/raidWarning";
import { colonists, mobs, players, raidGroups, state } from "./src/state.js";
import { markTileRegistryStale, setTile } from "./src/chunks.js";
import {
  RAID_ENGAGE_RANGE_TILES, RAID_SIDE_ENGAGE_TILES, RAID_SIDE_TARGET_MAX, RAID_SIDE_TARGET_TIMEOUT_TICKS, RAID_SPAWN_CYCLE_TICK,
  RAID_TRAVEL_SLACK, RAID_WARNING_REFRESH_TICKS, DAY_TICKS, GAME_DAY_TICKS,
} from "./src/constants.js";
import {
  createRaidMob, raidWarningFor, raidWarningLog, raidWarnings, sideRaids, spawnRaid, startRaidGroupMarch, updateRaidGroups,
  updateRaidWarnings, openRaidWarning,
} from "./src/raids.js";
import type { RaidGroup } from "./src/types.js";

const W = 90, H = 50, TCX = 70, TCY = 25;
let passed = 0;
const ok = (cond: unknown, msg: string) => { assert(cond, msg); passed++; console.log(`PASS ${msg}`); };

function freshWorld() {
  state.WORLD_TILES_X = W; state.WORLD_TILES_Y = H; state.worldWidth = W * TILE_SIZE; state.worldHeight = H * TILE_SIZE;
  state.tiles = new Uint8Array(W * H); state.biomes = new Uint8Array(W * H);
  state.cellHead = new Int32Array(W * H).fill(-1); state.cellNext = new Int32Array(64);
  state.siteGrounds = new Uint8Array(W * H); state.hostileMover = false; state.seasonsOff = true;
  state.routeCost = new Float64Array(W * H);
  colonists.clear(); mobs.clear(); players.clear(); raidGroups.clear(); sideRaids.clear(); raidWarnings.clear(); raidWarningLog.length = 0;
  markTileRegistryStale();
  state.townCenters = [{ x: TCX, y: TCY, level: 1, hp: 1000 } as any];
  setTile(TCY * W + TCX, T.TownCenter);
  state.buildingTargetsDirty = true;
  state.cycleTick = DAY_TICKS + 500; // night
}
const house = (x: number, y: number) => { setTile(y * W + x, T.House); state.buildingTargetsDirty = true; };
const razeHouse = (x: number, y: number) => { setTile(y * W + x, T.Empty ?? 0); state.buildingTargetsDirty = true; };

function makeGroup(n = 4): RaidGroup {
  const g: RaidGroup = {
    id: `g-${Math.random()}`, faction: "banditBand", isHorde: true, edge: "west", memberIds: [], homes: new Map(), aggroTick: 0,
    state: "passive", leaderId: null, offsets: new Map(), repathCooldown: 0, raidId: `raid-${Math.random()}`, clan: 0,
  };
  for (let i = 0; i < n; i++) {
    const m = createRaidMob("banditClubman", { x: 6, y: TCY - 1 + i }, g.id, false);
    g.memberIds.push(m.id);
    g.homes.set(m.id, { x: 6, y: TCY - 1 + i });
  }
  raidGroups.set(g.id, g);
  startRaidGroupMarch(g);
  return g;
}
const leaderOf = (g: RaidGroup) => mobs.get(g.leaderId!)!;
const tick = () => { state.cycleTick++; updateRaidGroups(1 / TICK_RATE); };
// Steps until `until()` or `max` ticks; returns the ticks used.
function run(until: () => boolean, max = 20000): number {
  let n = 0;
  while (!until() && n < max) { tick(); n++; }
  return n;
}
const atContact = (g: RaidGroup) => g.engagedTick !== undefined || !raidGroups.has(g.id);

// ---- A: a building 5 tiles off the route is walked past ----
freshWorld();
house(30, TCY + 5);
{
  const g = makeGroup();
  const sawHouseRange = { hit: false };
  const used = run(() => {
    const l = leaderOf(g);
    if (Math.abs(l.x / TILE_SIZE - 30) < 3) sawHouseRange.hit = true;
    return atContact(g);
  });
  const l = leaderOf(g);
  ok(sawHouseRange.hit, "A: the leader marched right past the house's column (5 tiles off the route)");
  ok(sideRaids.size === 0 && (g.sideCount ?? 0) === 0, "A: no side target was taken");
  ok(g.engagedTick !== undefined, `A: the group made contact (${used} ticks)`);
  ok(Math.hypot(l.x - (TCX + 0.5) * TILE_SIZE, l.y - (TCY + 0.5) * TILE_SIZE) <= RAID_ENGAGE_RANGE_TILES * TILE_SIZE + 2, "A: contact happened at the Town Center's engage range, not at the farm");
  ok(state.tiles[(TCY + 5) * W + 30] === T.House, "A: the house is untouched");
}

// ---- B: a building on the route is attacked, then the march resumes ----
freshWorld();
house(30, TCY);
{
  const g = makeGroup();
  run(() => sideRaids.has(g.id) || atContact(g));
  ok(sideRaids.has(g.id) && g.sideCount === 1 && g.sideTile?.x === 30 && g.sideTile?.y === TCY, "B: the group broke off for the house within 2 tiles of its route");
  const stoppedAt = leaderOf(g).x / TILE_SIZE;
  ok(stoppedAt < TCX - RAID_ENGAGE_RANGE_TILES - 10, `B: ... far from the Town Center (leader at x=${stoppedAt.toFixed(1)})`);
  // Everyone is released (rows); the house is still standing: the group stays parked on it.
  run(() => !raidGroups.has(g.id), 2000);
  const released = Array.from(mobs.values()).filter((m) => m.regimentId === g.id && m.groupId === null);
  ok(released.length === 4 && !sideRaids.get(g.id)?.engagedTick === false, "B: all four raiders released onto the side target");
  for (let i = 0; i < 20; i++) tick();
  ok(!raidGroups.has(g.id) && sideRaids.has(g.id), "B: while the house stands the raiders stay released");
  razeHouse(30, TCY);
  tick();
  ok(raidGroups.get(g.id) === g && g.state === "marching" && g.engagedTick === undefined && sideRaids.size === 0, "B: the house fell: the SAME group re-formed and is marching again");
  ok(Array.from(mobs.values()).every((m) => m.groupId === g.id && !m.passive), "B: every raider is back in the group");
  run(() => atContact(g));
  const l = leaderOf(g);
  ok(g.engagedTick !== undefined && l.x / TILE_SIZE > TCX - RAID_ENGAGE_RANGE_TILES - 2, "B: the resumed march reached the Town Center");
}

// ---- C: the side-target cap ----
freshWorld();
house(22, TCY); house(34, TCY); house(46, TCY);
{
  const g = makeGroup();
  let first = -1;
  for (const hx of [22, 34]) {
    run(() => sideRaids.has(g.id) || atContact(g));
    ok(sideRaids.has(g.id) && g.sideTile?.x === hx, `C: side target ${hx === 22 ? 1 : 2} is the house at x=${hx}`);
    run(() => !raidGroups.has(g.id), 2000);
    razeHouse(hx, TCY);
    tick();
    ok(raidGroups.has(g.id) && g.engagedTick === undefined, `C: re-formed after house ${hx}`);
    if (first < 0) first = g.sideCount ?? 0;
  }
  ok(g.sideCount === RAID_SIDE_TARGET_MAX, `C: ${RAID_SIDE_TARGET_MAX} side targets taken`);
  run(() => sideRaids.has(g.id) || atContact(g));
  ok(!sideRaids.has(g.id) && g.engagedTick !== undefined, "C: the third house on the route is ignored; the group goes on to the Town Center");
  ok(state.tiles[(TCY) * W + 46] === T.House, "C: the third house still stands");
  ok((g.sideDone ?? []).length === RAID_SIDE_TARGET_MAX, "C: finished targets are remembered");
}

// ---- D: the stuck timeout ----
freshWorld();
house(30, TCY);
{
  const g = makeGroup();
  run(() => sideRaids.has(g.id));
  run(() => !raidGroups.has(g.id), 2000);
  const since = g.sideSince!;
  state.cycleTick = since + RAID_SIDE_TARGET_TIMEOUT_TICKS - 5;
  updateRaidGroups(1 / TICK_RATE);
  ok(!raidGroups.has(g.id) && sideRaids.has(g.id), "D: just before the timeout the group is still on the house");
  state.cycleTick = since + RAID_SIDE_TARGET_TIMEOUT_TICKS;
  updateRaidGroups(1 / TICK_RATE);
  ok(raidGroups.has(g.id) && g.state === "marching" && sideRaids.size === 0, "D: at the timeout the group gives the house up and marches again");
  ok(state.tiles[(TCY) * W + 30] === T.House, "D: the house was never destroyed");
  ok((g.sideDone ?? []).includes(`30,${TCY}`), "D: the abandoned house is remembered");
  run(() => atContact(g) || sideRaids.has(g.id));
  ok(!sideRaids.has(g.id) && g.engagedTick !== undefined, "D: the group does not turn back to the same house; it reaches the Town Center");
}
// Dawn drops a side record (nothing is held across the night).
freshWorld();
house(30, TCY);
{
  const g = makeGroup();
  run(() => sideRaids.has(g.id));
  run(() => !raidGroups.has(g.id), 2000);
  state.cycleTick = GAME_DAY_TICKS * 2 + 5; // morning
  updateRaidGroups(1 / TICK_RATE);
  ok(sideRaids.size === 0 && !raidGroups.has(g.id), "D: at dawn the side record is dropped (no stranded group)");
}

// ---- E: the raid warning ----
freshWorld();
state.cycleTick = 100;
{
  const g = makeGroup();
  state.cycleTick = DAY_TICKS + 500;
  const w = raidWarningFor(g.raidId!, 0)!;
  ok(w && isRaidWarning(w), "E: a warning is produced for a live raid and passes the validator");
  ok(w.dir === "W" && compassDirection(1, 0) === "E" && compassDirection(-1, -1) === "NW" && compassDirection(0, 1) === "S" && compassDirection(1, -1) === "NE", "E: direction: raiders west of the Town Center read W (and the compass helper is right)");
  const speed = Math.min(...Array.from(mobs.values()).map((m) => m.speed));
  const dist = Math.hypot(TCX - 6, 0);
  ok(w.distanceTiles >= dist - 1 && w.distanceTiles <= dist * 1.3, `E: distance ${w.distanceTiles} tiles ~ the ${dist.toFixed(0)}-tile gap`);
  const expect = Math.ceil((((w.distanceTiles - RAID_ENGAGE_RANGE_TILES) * TILE_SIZE * RAID_TRAVEL_SLACK) / speed) * TICK_RATE);
  ok(w.etaTicks === expect && w.etaTicks > TICK_RATE * 5 && w.etaTicks < GAME_DAY_TICKS, `E: ETA ${w.etaTicks} ticks = path x pace (expected ${expect})`);
  ok(w.count === 4 && w.homeX === TCX && w.homeY === TCY, "E: count and the Town Center marker");
  // Refresh cadence + shrinking ETA as the group walks.
  state.cycleTick = DAY_TICKS + 500;
  raidWarningLog.length = 0;
  openRaidWarning(g.raidId!, 0);
  ok(raidWarningLog.length === 1 && raidWarningLog[0].kind === "warn", "E: opening a warning sends one at once");
  for (let i = 0; i < RAID_WARNING_REFRESH_TICKS * 3; i++) { tick(); if (state.cycleTick % TICK_RATE === 0) updateRaidWarnings(); }
  const warns = raidWarningLog.filter((r) => r.kind === "warn");
  ok(warns.length >= 3 && warns.length <= 5, `E: refreshed every ~${RAID_WARNING_REFRESH_TICKS} ticks (${warns.length} sends in 3 refresh periods)`);
  ok(warns[warns.length - 1].warning!.etaTicks < warns[0].warning!.etaTicks, "E: the ETA counts down as the raiders march");
  // Contact ends it with a "contact" clear.
  run(() => atContact(g));
  for (let i = 0; i < 3; i++) { tick(); updateRaidWarnings(); }
  // Engaged groups are not 'live': the warning is cleared once every group has made contact.
  const cleared = raidWarningLog.filter((r) => r.kind === "clear");
  ok(cleared.length === 1 && cleared[0].reason === "contact" && isRaidWarningCleared({ id: cleared[0].id, reason: cleared[0].reason }), "E: contact clears the warning (reason contact)");
  ok(raidWarnings.size === 0, "E: nothing left registered afterwards");
}
// Beaten off before contact -> "defeated"; and a full spawnRaid announces itself.
freshWorld();
state.cycleTick = RAID_SPAWN_CYCLE_TICK;
{
  spawnRaid(0);
  ok(raidGroups.size > 0 && raidWarningLog.length >= 1 && raidWarningLog[0].kind === "warn", "E: spawnRaid warns the clan as it spawns");
  const w = raidWarningLog[0].warning!;
  ok(isRaidWarning(w) && w.etaTicks > 0 && w.distanceTiles > RAID_ENGAGE_RANGE_TILES && w.count >= 1, `E: spawn warning ${w.dir}, ${w.distanceTiles} tiles, ETA ${w.etaTicks} ticks, ${w.count} raiders`);
  const edge = Array.from(raidGroups.values())[0].edge;
  const want = { north: ["N", "NE", "NW"], south: ["S", "SE", "SW"], west: ["W", "NW", "SW"], east: ["E", "NE", "SE"] }[edge!];
  ok(want.includes(w.dir), `E: direction ${w.dir} matches the ${edge} edge the raiders spawned on`);
  ok(w.etaTicks >= Math.max(0, Array.from(raidGroups.values())[0].aggroTick - state.cycleTick), "E: the ETA includes the wait until the group sets out");
  mobs.clear(); raidGroups.clear();
  state.cycleTick += TICK_RATE;
  updateRaidWarnings();
  const cl = raidWarningLog.filter((r) => r.kind === "clear");
  ok(cl.length === 1 && cl[0].reason === "defeated", "E: a raid with no one left is cleared as defeated");
}
console.log(`PASS raid-march regression: ${passed} checks`);
void RAID_SIDE_ENGAGE_TILES;
