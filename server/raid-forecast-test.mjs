// Scripted test: dusk raid forecast. Needs COLONY_TEST_HOOKS=1 and a private server:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=80 PORT=21020 npx tsx src/index.ts &   then
//   PORT=21020 node raid-forecast-test.mjs
// Checks: no forecast before the raid is committed; after the day-midpoint spawn the snapshot forecast matches
// the real groups (band of the member count, factions, entry edges); no forecast once raids are skipped.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, hooks: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcomes++;
  else if (m.type === "snapshot") {
    c.snap = m;
    c.snapCount++;
  } else if (m.type === "testHookResult") c.hooks.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const snaps = async (n) => {
  const start = c.snapCount;
  while (c.snapCount < start + n) await sleep(10);
};
const hook = async (op, args = {}) => {
  const before = c.hooks.length;
  send({ type: "testHook", op, ...args });
  const deadline = Date.now() + 5000;
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
// Mirrors shared/src/raidForecast.ts RAID_FORECAST_BAND_MAX (6 / 14 / 30).
const bandOf = (n) => (n <= 6 ? "small" : n <= 14 ? "medium" : n <= 30 ? "large" : "huge");

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);

// 1. Raids skipped: past the midpoint with raids off, nothing is spawned, so no forecast is shown.
await restart();
await hook("setRaids", { enabled: false });
let st = await hook("raidState");
await hook("setCycleTick", { tick: Math.floor(st.dayTicks / 2) - 3 });
await snaps(12);
st = await hook("raidState");
result(st.groups.length === 0, "raids off: no raid groups spawned");
result(c.snap.raidForecast === undefined, "raids off: no forecast in the snapshot");

// 2. Raids on: before the spawn there is no forecast; after it the forecast equals the real committed raid.
await restart();
await hook("setRaids", { enabled: true });
await hook("holdRaidAggro", { value: true });
await snaps(3);
result(c.snap.raidForecast === undefined, "before the midpoint spawn: no forecast");
await hook("spawnRaidNow", { dayIndex: 3 });
await snaps(4);
st = await hook("raidState");
const groups = st.groups;
const count = groups.reduce((n, g) => n + g.memberIds.length, 0);
const f = c.snap.raidForecast;
result(groups.length > 0 && count > 0, `raid spawned: ${groups.length} groups, ${count} raiders`);
result(!!f, "forecast present after the spawn");
if (f) {
  result(f.band === bandOf(count), `forecast band ${f.band} matches the real count ${count}`);
  const facs = [...new Set(groups.map((g) => g.faction))].sort();
  result(JSON.stringify([...f.factions].sort()) === JSON.stringify(facs), `forecast factions ${f.factions} match ${facs}`);
  const edges = [...new Set(groups.map((g) => g.edge).filter(Boolean))].sort();
  result(JSON.stringify([...f.edges].sort()) === JSON.stringify(edges), `forecast edges ${f.edges} match ${edges}`);
  result(!("count" in f) && !("size" in f), "forecast carries no exact numbers");
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
