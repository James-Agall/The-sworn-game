// Scripted test: raid waves (the night-wave system). Needs COLONY_TEST_HOOKS=1 (time travel, raid
// state dumps, direct mob damage, forced deserter roll) and a private server with no other players:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=80 PORT=8097 npx tsx src/index.ts &   then
//   PORT=8097 node raid-waves-test.mjs
// Checks: day-0 raid = 5 mobs spawned at the day midpoint, all on the map edge, all passive; the horde
// holds >= half; every group is single-faction with only unlocked kinds; passive mobs stay put; damage
// to one member aggroes its whole group; everything is aggressive and storming after nightfall;
// day-1 raid = 7; no cap (day 20 = 45, day 50 = 105); deserter nights (deserters are the horde's
// core, bandits fill up to the raid size; none when deserters alone reach it).
// PERF=1 additionally builds ~150 raid mobs and reports server tick times (run with
// COLONY_WORLD_SIZE=160 for the realistic case). Runtime ~1 min.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const PERF = process.env.PERF === "1";
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`info [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
// Mirror of server RAID_BASE_SIZE / RAID_SIZE_PER_DAY / RAID_EDGE_BAND_TILES / RAID_LOITER_RADIUS_TILES.
const raidSize = (day) => 5 + 2 * day;
const EDGE_BAND = 3;
const LOITER = 3;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, events: [], hooks: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcomes++;
    c.world = m.worldTilesX;
  } else if (m.type === "snapshot") {
    c.snap = m;
    c.snapCount++;
  } else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hooks.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const snaps = async (n) => {
  const start = c.snapCount;
  while (c.snapCount < start + n) await sleep(10);
};
const hook = async (op, args = {}) => {
  const before = c.hooks.length;
  send({ type: "testHook", op, ...args });
  const deadline = Date.now() + 3000;
  while (c.hooks.length === before) {
    if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}: is COLONY_TEST_HOOKS=1 set?`);
    await sleep(5);
  }
  return c.hooks[c.hooks.length - 1];
};
const restart = async () => {
  const w = c.welcomes;
  send({ type: "restart", difficulty: "normal" });
  while (c.welcomes === w) await sleep(10);
  await snaps(2);
};

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);
await restart();
await hook("forceDeserterRoll", { value: false });
// Day-0 and deserter raids hold their aggro until nightfall so passive state can be inspected without
// racing a random early aggro; the day 1/20/50 raids use the real random aggro times.
await hook("holdRaidAggro", { value: true });

let st = await hook("raidState");
const DAY = st.dayTicks;
const CYCLE = st.dayTicks + st.nightTicks;
const MID = Math.floor(DAY / 2);
const W = st.worldTiles;
const TC = { x: Math.floor(W / 2) * TILE + TILE / 2, y: Math.floor(W / 2) * TILE + TILE / 2 };
const tileOf = (m) => ({ x: Math.floor(m.x / TILE), y: Math.floor(m.y / TILE) });
const onEdge = (m) => {
  const t = tileOf(m);
  return Math.min(t.x, t.y, W - 1 - t.x, W - 1 - t.y) < EDGE_BAND;
};
const unlocked = (kind, day) => st.unlockDays[kind] <= day;
info(`world ${W}x${W}, day=${DAY} ticks, cycle=${CYCLE}; world-gen mobs: ${st.mobs.length}`);
result(st.groups.length === 0 && st.mobs.every((m) => m.groupId === null), "fresh world: no raid groups yet");

// Jumps to just before day `day`'s midpoint and returns the mobs that spawned there.
async function raidAtDay(day) {
  const beforeIds = new Set((await hook("raidState")).mobs.map((m) => m.id));
  const eventsBefore = c.events.length;
  await hook("setCycleTick", { tick: day * CYCLE + MID - 3 });
  await snaps(8);
  st = await hook("raidState");
  const fresh = st.mobs.filter((m) => !beforeIds.has(m.id));
  return { fresh, events: c.events.slice(eventsBefore), state: st };
}

function checkGroups(label, day, mobsInRaid, state) {
  const groupIds = new Set(mobsInRaid.map((m) => m.groupId));
  const groups = state.groups.filter((g) => groupIds.has(g.id));
  const horde = groups.find((g) => g.isHorde);
  result(!!horde && horde.memberIds.length * 2 >= mobsInRaid.length,
    `${label}: horde holds >= half (${horde?.memberIds.length}/${mobsInRaid.length}); groups: ${groups.map((g) => `${g.faction}x${g.memberIds.length}${g.isHorde ? "*" : ""}@${g.edge}`).join(", ")}`);
  const bad = [];
  for (const g of groups) {
    const allowed = new Set(state.factions[g.faction].map((e) => e.kind));
    const coreUnlocked = state.factions[g.faction].some((e) => e.core && unlocked(e.kind, day));
    if (!coreUnlocked) bad.push(`${g.faction} not eligible on day ${day}`);
    for (const id of g.memberIds) {
      const m = state.mobs.find((x) => x.id === id);
      if (m.isDeserter) continue;
      if (!allowed.has(m.kind)) bad.push(`${m.kind} in ${g.faction}`);
      if (!unlocked(m.kind, day)) bad.push(`${m.kind} locked on day ${day}`);
    }
  }
  result(bad.length === 0, `${label}: every group single-faction with unlocked kinds only${bad.length ? " — " + bad.join(", ") : ""}`);
}

// ---- Day 0 raid ----
const r0 = await raidAtDay(0);
const raid0 = r0.fresh;
result(raid0.length === raidSize(0), `day-0 raid spawned ${raid0.length} mobs (expected ${raidSize(0)})`);
result(st.cycleTick % CYCLE >= MID && st.cycleTick % CYCLE < MID + 12, `raid spawned at the day midpoint (cycle tick ${st.cycleTick % CYCLE}, midpoint ${MID})`);
result(raid0.every(onEdge), `all raid mobs on the map edge band (${raid0.map((m) => `${tileOf(m).x},${tileOf(m).y}`).join(" ")})`);
result(raid0.every((m) => m.passive && m.groupId), `all raid mobs passive and grouped`);
const tiles0 = new Set(raid0.map((m) => `${tileOf(m).x},${tileOf(m).y}`));
result(tiles0.size === raid0.length, `no two raid mobs share a tile (${tiles0.size} tiles / ${raid0.length} mobs)`);
checkGroups("day 0", 0, raid0, st);
const gather = r0.events.find((e) => e.category === "raid" && /^Raiders gather at the (north|south|east|west) edge$/.test(e.text));
result(!!gather, `raid event: "${gather?.text}"`);

// ---- Passive: they hold near their spawn and don't head for the colony ----
const spawnPos = new Map(raid0.map((m) => [m.id, tileOf(m)]));
await sleep(3000);
st = await hook("raidState");
const stillPassive = st.mobs.filter((m) => spawnPos.has(m.id) && m.passive);
const strayed = stillPassive.filter((m) => {
  const a = spawnPos.get(m.id);
  const b = tileOf(m);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > LOITER;
});
result(stillPassive.length > 0 && strayed.length === 0,
  `passive mobs stay within ${LOITER} tiles of spawn over 3 s (${stillPassive.length} still passive, ${strayed.length} strayed)`);
result(stillPassive.every((m) => m.targetType === null), "passive mobs have no target");

// ---- Damage aggro ----
// Prefer a non-horde group so the horde is left to march at nightfall.
const passiveGroups = st.groups
  .filter((g) => g.state === "passive" && g.memberIds.length >= 2)
  .sort((p, q) => Number(p.isHorde) - Number(q.isHorde));
let hordeDamaged = false;
if (passiveGroups.length === 0) {
  info("no passive group with >= 2 members left to test damage aggro on (all aggro'd early); skipped");
} else {
  const g = passiveGroups[0];
  const others = st.groups.filter((x) => x.id !== g.id && x.state === "passive").map((x) => x.id);
  hordeDamaged = g.isHorde;
  await hook("damageMob", { mobId: g.memberIds[0], amount: 1 });
  st = await hook("raidState");
  const members = st.mobs.filter((m) => g.memberIds.includes(m.id));
  result(!st.groups.some((x) => x.id === g.id) && members.every((m) => !m.passive && m.groupId === null),
    `damaging one member aggroes its whole group (${members.length} members now aggressive, group dissolved)`);
  result(others.every((id) => st.groups.find((x) => x.id === id)?.state === "passive"),
    `other passive groups unaffected (${others.length})`);
}

// ---- Nightfall: everyone storms ----
const eventsBeforeNight = c.events.length;
await hook("setCycleTick", { tick: DAY - 10 });
while (!c.snap.isNight) await sleep(20);
await snaps(4);
st = await hook("raidState");
const raidNow = st.mobs.filter((m) => spawnPos.has(m.id));
result(raidNow.every((m) => !m.passive) && st.groups.every((g) => g.state !== "passive"),
  `after nightfall no raid mob or group is passive (${raidNow.length} mobs, groups: ${st.groups.map((g) => g.state).join(",") || "none"})`);
const d0 = new Map(raidNow.map((m) => [m.id, Math.hypot(m.x - TC.x, m.y - TC.y)]));
await sleep(4000);
st = await hook("raidState");
const closer = st.mobs.filter((m) => d0.has(m.id) && Math.hypot(m.x - TC.x, m.y - TC.y) < d0.get(m.id) - TILE);
result(closer.length >= Math.ceil(d0.size / 2), `raid storms the colony: ${closer.length}/${d0.size} mobs >= 1 tile closer to the Town Center after 4 s`);
const nightEvents = c.events.slice(eventsBeforeNight);
const marchEvent = c.events.find((e) => e.category === "raid" && e.text === "The horde marches on the colony");
if (hordeDamaged) info(`the horde was the group aggro'd by damage (the only group), so it never marched; march event ${marchEvent ? "seen" : "not seen"}`);
else result(!!marchEvent, `"The horde marches on the colony" announced (events since nightfall: ${nightEvents.map((e) => e.text).join(" | ")})`);

// ---- Day 1 = 7, no cap ----
await hook("holdRaidAggro", { value: false });
for (const day of [1, 20, 50]) {
  const r = await raidAtDay(day);
  const groupsNow = r.state.groups.filter((g) => r.fresh.some((m) => m.groupId === g.id));
  const lo = day * CYCLE + MID;
  const hi = day * CYCLE + DAY + Math.floor((st.nightTicks * 2) / 3); // arrival-timed departures (see raid-timing-test.mjs)
  result(groupsNow.every((g) => g.aggroTick >= lo && g.aggroTick < hi),
    `day ${day}: every group's aggro tick lies between the spawn and the end of the arrival window (${groupsNow.map((g) => g.aggroTick - lo).join(",")} ticks after spawn; window ends at +${hi - lo})`);
  result(r.fresh.length === raidSize(day), `day-${day} raid = ${r.fresh.length} (expected ${raidSize(day)})`);
  // A group whose random aggro time fell in the first few ticks may already be marching off the edge.
  const marching = new Set(r.state.groups.filter((g) => g.state !== "passive").map((g) => g.id));
  const held = r.fresh.filter((m) => !marching.has(m.groupId));
  result(held.every(onEdge) && held.every((m) => m.passive),
    `day ${day}: all mobs of still-passive groups on the edge band and passive (${held.length}/${r.fresh.length}; ${marching.size} group(s) already marching)`);
  checkGroups(`day ${day}`, day, r.fresh, r.state);
}

// ---- Deserter nights ----
await hook("holdRaidAggro", { value: true });
await restart();
await hook("forceDeserterRoll", { value: true });
let added = (await hook("addDeserters", { count: 3 })).ids;
// A group whose uniform aggro time lands in the few ticks before we look is already released, so
// "in the raid" = still grouped, or a deserter that has already turned.
const inRaid = (m) => m.groupId !== null || (m.isDeserter && m.deserterActive);
let evIdx = c.events.length;
let r = await raidAtDay(12);
let deserters = st.mobs.filter((m) => added.includes(m.id) && inRaid(m));
let fresh = r.fresh;
let horde = st.groups.find((g) => g.isHorde);
result(deserters.length === 3 && fresh.length === raidSize(12) - 3,
  `deserter night day 12: ${deserters.length} deserters + ${fresh.length} fresh = ${deserters.length + fresh.length} (expected ${raidSize(12)})`);
if (horde) {
  result(added.every((id) => horde.memberIds.includes(id)) && horde.memberIds.length * 2 >= raidSize(12),
    `deserters are the horde's core (horde ${horde.memberIds.length}/${raidSize(12)})`);
} else info("horde already aggro'd before inspection; horde-core check skipped this run");
result(st.groups.every((g) => g.faction === "banditBand") && fresh.every((m) => m.kind.startsWith("bandit")),
  `deserter night: every group is Bandit band, fresh kinds ${[...new Set(fresh.map((m) => m.kind))].join(",")}`);
const freshHeld = fresh.filter((m) => m.passive);
result(freshHeld.every(onEdge) && deserters.every((m) => !onEdge(m)), "fresh bandits on the edge, deserters stay where they are");
await hook("setCycleTick", { tick: 12 * CYCLE + DAY - 5 });
while (!c.snap.isNight) await sleep(20);
await snaps(4);
st = await hook("raidState");
const turned = c.events.slice(evIdx).find((e) => e.category === "deserter");
result(turned?.text === "The deserters have turned on the colony (3)", `deserter event on going aggressive: "${turned?.text}"`);
result(st.mobs.filter((m) => added.includes(m.id)).every((m) => m.deserterActive && !m.passive && m.groupId === null),
  "deserters active and on per-mob targeting after nightfall");

await restart();
await hook("forceDeserterRoll", { value: true });
added = (await hook("addDeserters", { count: 8 })).ids;
r = await raidAtDay(0);
deserters = st.mobs.filter((m) => added.includes(m.id) && inRaid(m));
result(r.fresh.length === 0 && deserters.length === 8 && st.groups.length <= 1,
  `deserters (8) >= raid size (5): no fresh bandits, none cut (${deserters.length} deserters in the raid, ${r.fresh.length} fresh, ${st.groups.length} group)`);
result(!r.events.some((e) => e.text.startsWith("Raiders gather")), "no edge-gather event for a deserters-only raid");
await hook("forceDeserterRoll", { value: false });
await hook("holdRaidAggro", { value: false });

// ---- Perf ----
if (PERF) {
  await restart();
  await raidAtDay(20);
  await raidAtDay(50);
  st = await hook("raidState");
  info(`perf: ${st.mobs.length} mobs (${st.mobs.filter((m) => m.groupId).length} raid), ${st.groups.length} groups, world ${W}x${W}`);
  await hook("tickStats", { reset: true });
  await sleep(4000);
  const passive = await hook("tickStats", { reset: true });
  info(`perf passive (4 s): avg ${passive.avgMs.toFixed(2)} ms, p95 ${passive.p95Ms.toFixed(2)}, max ${passive.maxMs.toFixed(2)}`);
  await hook("setCycleTick", { tick: 50 * CYCLE + DAY - 2 });
  await sleep(500);
  await hook("tickStats", { reset: true });
  // 30 s of the 40 s night marching, then 10 s with every group broken up (before the next raid).
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    const s = await hook("tickStats", { reset: true });
    const rs = await hook("raidState");
    const dists = rs.mobs.filter((m) => !m.siteId).map((m) => Math.hypot(m.x - TC.x, m.y - TC.y) / TILE);
    const avgDist = dists.reduce((a, b) => a + b, 0) / Math.max(1, dists.length);
    info(`perf storm t+${(i + 1) * 5}s: ${s.mobs} mobs, ${s.groups} groups marching, avg dist to TC ${avgDist.toFixed(1)} tiles; tick avg ${s.avgMs.toFixed(2)} ms, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)}`);
  }
  // Worst case for pathfinding: every remaining group breaks up at once (as if all were hit), so each
  // mob runs its own per-mob targeting/pathing from wherever it is.
  const rs = await hook("raidState");
  for (const g of rs.groups) await hook("damageMob", { mobId: g.memberIds[0], amount: 1 });
  await hook("tickStats", { reset: true });
  for (let i = 0; i < 2; i++) {
    await sleep(5000);
    const s = await hook("tickStats", { reset: true });
    info(`perf all per-mob (${rs.groups.length} groups dissolved) +${(i + 1) * 5}s: ${s.mobs} mobs; tick avg ${s.avgMs.toFixed(2)} ms, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)}`);
  }
}

c.ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
process.exit(fails === 0 ? 0 : 1);
