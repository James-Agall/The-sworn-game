# Raid march fix, raid warning, longer days (2026-11-27)

Branch `raid-march-fix` (from `play-build`). Regression: `server/raid-march-test.mjs` (wraps the in-process
`server/raid-march-regression.mts`, 41 checks).

## 1. Raid march

Before: `raidGroupShouldEngage` returned true for any non-wall building within `MOB_BUILDING_AGGRO_TILES` (6)
of the group's leader. At night the whole group dissolved into lone mobs that chain-attacked outlying farms and
houses one by one, so a raid rarely reached the Town Center.

Now (`server/src/raids.ts`):

- `raidEngageReason(group, leader, goal)` returns `"contact"` (the Town Center, a guard / militia or a player is in
  range: the group fights and breaks up for good, exactly as before), `{ side: tile }`, or `null`.
- A **side target** is a non-wall, unwarded building within `RAID_SIDE_ENGAGE_TILES` (2) of the leader, at night only,
  at most `RAID_SIDE_TARGET_MAX` (2) per raid, never one already finished or given up (`group.sideDone`). Walking
  past anything farther is free. A route that does not exist at all (a walled-in colony) still breaks the group up
  so walls and gates get breached as before; the existing "leave when nothing to attack" logic in `updateMob` is
  untouched.
- On a side target the group is released like any contact (`engageRaidGroup`, row by row) and parked in `sideRaids`.
  `updateSideRaids` runs every tick: when the building is gone (`resolveTargetPosition("building", key) === null`)
  the same group (same id, so `regimentId` / morale keys still match) re-forms (`reformRaidGroup`: members back in
  the group, new leader and formation) and marches to the Town Center again.
- **Stuck timeout**: `RAID_SIDE_TARGET_TIMEOUT_TICKS` = 45 s of game time on one side building and the group gives it
  up (it is added to `sideDone`, so it does not turn back to it) and resumes. 45 s is a few building-kill times and
  a fraction of a night; "one game day" (562 s) would have outlasted the whole night.
- **Not held forever**: dawn drops every side record (the per-mob rules take over); a record with no living members
  is dropped. See "Left undone" about `nightlyRaidActive`.
- By day a group never takes side targets (it keeps walking and holds near the colony, as before).
- `MOB_BUILDING_AGGRO_TILES` (6) now applies to lone mobs only (mobs.ts `buildingNearby`); comment updated.

Constants (`server/src/constants.ts`): `RAID_SIDE_ENGAGE_TILES`, `RAID_SIDE_TARGET_MAX`, `RAID_SIDE_TARGET_TIMEOUT_TICKS`.

## 2. Raid warning

- Protocol (`shared/src/protocol.ts`): `{ type: "raidWarning"; warning }` and `{ type: "raidWarningCleared"; cleared }`.
  Types, `compassDirection`, validators `isRaidWarning` / `isRaidWarningCleared` and the texts live in
  `shared/src/raidWarning.ts` (export `@colony/shared/raidWarning`).
- Server (`raids.ts`): `spawnRaid` stamps every group with a `raidId` and the owning `clan` and opens a warning. The raid's
  live (not yet in contact) groups, including groups on a side target, give: direction of the lead group from the
  Town Center (8-point compass), walking distance in tiles, ETA in ticks (route to the Town Center's approach tile x
  `RAID_TRAVEL_SLACK` / the slowest member's speed, plus the wait until a passive group's `aggroTick`), raider count and
  the raiders' tile. It is re-sent every `RAID_WARNING_REFRESH_TICKS` (5 s) and cleared with a reason: `contact`
  (every group has engaged), `defeated` (nobody left), `expired` (`RAID_WARNING_MAX_TICKS`, one game day).
  Only the owning clan's players get it (everyone while there is a single clan).
- Client (`client/src/main.ts`): a small banner under the forecast line ("Raiders approaching from the W: 66 tiles away, about
  25 s (4)") with a dismiss button (per raid), a toast on first sight and on clear, and a pulsing red dot on the minimap.
  Validators run on receipt; the welcome message resets it.

## 3. Longer days

`DAY_TICKS` 6000 -> 9000 (450 s), `NIGHT_TICKS` 1500 -> 2240 (112 s; 112.5 s would keep the old 4:1 exactly, but 11250
ticks does not divide by 4, and the calendar's winter forage catch-up (a quarter of a day) then rounds off by a tick;
11240 does). Cycle 562 s (was 375 s), `DAY_LENGTH_SCALE` 3.75 -> 5.62, `DAYLIGHT_SCALE` 5 -> 7.5.

Consumers audited:

| Consumer | Result |
|---|---|
| `FOOD_PER_COLONIST_PER_DAY` (`1 x DAY_LENGTH_SCALE`) | follows: 5.62 per colonist per day, still 1 per 100 s real time |
| Farm grow / fallow, hemp, farmhand cycles, forage regrow, wildlife respawn (`LEGACY_*` ticks) | real time, unchanged |
| Autosave | was "every dawn" (375 s -> 562 s apart): **fixed**, new `AUTOSAVE_INTERVAL_TICKS` (375 s) timer in `sim.ts` besides the dawn save |
| Calendar (`GAME_DAY_TICKS`, 7-day seasons), weather, `seasonDayTicks` | per game day: seasons, years and weather phases are 1.5x longer in real time (the point of the change); comment numbers updated |
| Animals (feed / water / manure per day, adult age), spoilage, winter fuel and garment wear, sickness, mines, quests, levies, settlement hostility, deserter activation, camp growth, births / maturity (`CHILD_MATURE_DAYS`), `WORK_UNASSIGN_HOLD_TICKS` | all counted in game days: scale with the day (per-day balance unchanged, real time 1.5x) |
| `RAID_SPAWN_CYCLE_TICK`, `DUSK_RESPAWN_CYCLE_TICK`, `sim.ts` raid timing | derived from `DAY_TICKS` / `dayTicksFor`: midday spawn, nightfall arrival window (`nightTicksFor`) follow |
| `saves.ts migrateSaveDayLength` | existing mechanism keeps a loaded save's place in the cycle; nothing added (no migration work) |

Deliberately left: per-day game-balance numbers (fuel, spoilage, animal needs) keep their per-day values, so in real
time those drain 1.5x slower; farm and food timers stay in real time. If you would rather keep fuel / spoilage /
animal needs constant per real second, multiply them by `DAY_LENGTH_SCALE / 3.75`.

Tests whose premise was the old length were updated (hard-coded 300 / 375 / 7500 ticks), and `day-respawn-test.mjs`'s
night-length assertion (60-90 s) and upkeep assertion (3.75) were rewritten to 100-125 s and 5.62 because the
premise (the length of day / night) is deliberately reversed.
