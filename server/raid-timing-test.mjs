// Scripted test: raid arrival timing. Needs COLONY_TEST_HOOKS=1 and a private server:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=160 PORT=21010 npx tsx src/index.ts &   then
//   PORT=21010 node raid-timing-test.mjs
// Checks: raids spawned at the day midpoint depart staggered (aggroTick > spawn for trips that fit the
// day); no group makes contact before nightfall; first contact falls in [nightfall, nightfall + 2/3 night]
// (+ tolerance); a group forced to depart at once arrives early and holds passive and stationary near the
// colony until nightfall, then engages.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
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

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);

const STEP = 10;
// Spawns the day-0 raid (optionally forcing immediate departure) and fast-forwards to the end of the
// arrival window, recording each group's contact tick (engaged or removed) and pre-night samples.
async function trial(label, departNow) {
  await restart();
  await hook("forceDeserterRoll", { value: false });
  let st = await hook("raidState");
  const { dayTicks: DAY, nightTicks: NIGHT, worldTiles: W } = st;
  const MID = Math.floor(DAY / 2);
  const tc = { x: Math.floor(W / 2) * TILE, y: Math.floor(W / 2) * TILE };
  await hook("setCycleTick", { tick: MID - 3 });
  await snaps(8);
  st = await hook("raidState");
  if (departNow) st = (await hook("raidDepartNow"), await hook("raidState"));
  const spawnTick = st.cycleTick;
  const groups = new Map(st.groups.map((g) => [g.id, { g, contact: null, dep: g.aggroTick }]));
  result(groups.size > 0, `${label}: ${groups.size} groups spawned; departures +${[...groups.values()].map((x) => Math.round((x.dep - spawnTick) / 20)).join("s, +")}s`);
  const pos = (s, g) => g.memberIds.map((id) => s.mobs.find((m) => m.id === id)).filter(Boolean);
  let earlyContact = 0;
  let pre = null; // sample ~5s before nightfall
  let preLate = null; // sample at nightfall - 1 step
  while (st.cycleTick < DAY + NIGHT * 0.67 + 20 * 20) {
    await hook("fastForward", { ticks: STEP });
    st = await hook("raidState");
    for (const x of groups.values()) {
      const cur = st.groups.find((g) => g.id === x.g.id);
      const made = !cur || cur.engagedTick !== null;
      if (made && x.contact === null) {
        x.contact = st.cycleTick;
        if (st.cycleTick < DAY) earlyContact++;
      }
    }
    if (!pre && st.cycleTick >= DAY - 100) pre = st;
    if (!preLate && st.cycleTick >= DAY - STEP - 1) preLate = st;
  }
  result(earlyContact === 0, `${label}: no group made contact before nightfall`);
  const tol = 20 * 20;
  for (const x of groups.values()) {
    const fits = x.dep > spawnTick + 5;
    const inWin = x.contact !== null && x.contact >= DAY && x.contact <= DAY + Math.floor((NIGHT * 2) / 3) + tol;
    if (fits || x.contact !== null) result(inWin || (!fits && x.contact >= DAY), `${label}: ${x.g.faction} contact at night+${x.contact === null ? "none" : Math.round((x.contact - DAY) / 20) + "s"} (window 0..${Math.round((NIGHT * 2) / 3 / 20)}s)`);
  }
  if (departNow) {
    // Pre-night: every group still alive is paused: passive, stationary, near the colony.
    let paused = 0;
    for (const x of groups.values()) {
      const a = pre && st && pos(pre, x.g);
      const b = preLate && pos(preLate, x.g);
      if (!a || !b || a.length === 0 || b.length === 0 || x.g.isDeserter) continue;
      const still = b.every((m) => {
        const m0 = a.find((q) => q.id === m.id);
        return m0 && Math.hypot(m.x - m0.x, m.y - m0.y) < 2;
      });
      const near = Math.hypot(b[0].x - tc.x, b[0].y - tc.y) / TILE < 40;
      if (still && near && b.every((m) => m.passive)) paused++;
    }
    result(paused > 0, `${label}: ${paused}/${groups.size} groups held passive and stationary near the colony before nightfall`);
  }
}

await trial("natural", false);
await trial("natural2", false);
await trial("depart-now", true);
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
