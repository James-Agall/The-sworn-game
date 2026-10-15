// Scripted test: combat bodies and lines - separation, melee engagement slots, line leash + return to
// slot, a mob passing a house attacks it, heading-relative raid formations, and tick time with ~150 mobs.
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>
// (any world size; the tick measurement is meant for the default 160x160).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, House: 13 };

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, hook: new Map() };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const body = () => hook("bodyState");

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const myId = c.welcome.id;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });

// A cleared 21x21 arena well west of the Town Center.
const A = { x: TCT.x - 26, y: TCT.y };
for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: T.Empty });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: T.Empty });
const px = (tx) => tx * TILE + TILE / 2;

// 1. Separation: two knights spawned on one point end at least a body apart.
const k1 = (await hook("spawnSoldier", { kind: "knight", x: px(A.x - 6), y: px(A.y - 6) })).id;
const k2 = (await hook("spawnSoldier", { kind: "knight", x: px(A.x - 6), y: px(A.y - 6) })).id;
await ff(5);
let bs = await body();
const [b1, b2] = [k1, k2].map((id) => bs.colonists.find((u) => u.id === id));
const sep = Math.hypot(b1.x - b2.x, b1.y - b2.y);
result(sep >= 13, `two knights spawned on one point separate (${sep.toFixed(1)} px apart, bodies 2 x 7)`);
await hook("killColonists", { kind: "knight" });

// 2. Engagement slots: five goblins on one player take distinct ring slots around it.
await hook("ignorePlayers", { value: false });
await hook("teleportPlayer", { x: px(A.x + 4), y: px(A.y + 4) });
const gob = [];
for (let i = 0; i < 5; i++) gob.push((await hook("spawnMob", { kind: "goblin", tx: A.x + 7, ty: A.y + 4 })).id);
await ff(50);
bs = await body();
const P = { x: px(A.x + 4), y: px(A.y + 4) };
const onMe = bs.slots.filter(([, s]) => s.key === `p:${myId}`);
const slotIdx = new Set(onMe.map(([, s]) => s.slot));
const gm = bs.mobs.filter((m) => gob.includes(m.id));
let minPair = Infinity;
for (let i = 0; i < gm.length; i++) for (let j = i + 1; j < gm.length; j++) minPair = Math.min(minPair, Math.hypot(gm[i].x - gm[j].x, gm[i].y - gm[j].y));
const angles = gm.map((m) => Math.atan2(m.y - P.y, m.x - P.x)).sort((a, b) => a - b);
let maxGap = 0;
for (let i = 0; i < angles.length; i++) maxGap = Math.max(maxGap, ((angles[(i + 1) % angles.length] - angles[i]) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI);
const spread = 360 - (maxGap * 180) / Math.PI;
const inRange = gm.filter((m) => Math.hypot(m.x - P.x, m.y - P.y) <= TILE * 0.8 + 0.5).length;
result(onMe.length === 5 && slotIdx.size === 5 && minPair >= 13 && spread >= 120 && inRange === 5,
  `5 goblins on one player: ${slotIdx.size} distinct slots, ${inRange} in strike range, closest pair ${minPair.toFixed(1)} px, angular spread ${spread.toFixed(0)} deg`);
for (const id of gob) await hook("damageMob", { mobId: id, amount: 999 });
await hook("ignorePlayers", { value: true });
await hook("teleportPlayer", { x: px(TCT.x), y: px(TCT.y + 2) });

// 3. Line leash: a knight (normal stance, leash 4 tiles) fights a goblin near its slot, never strays
// past the leash, and walks back onto its slot afterwards.
const R = { x: px(A.x - 4), y: px(A.y + 6) };
const kn = (await hook("spawnSoldier", { kind: "knight", x: R.x, y: R.y, stance: "normal" })).id;
const g1 = (await hook("spawnMob", { kind: "goblin", tx: A.x - 1, ty: A.y + 6 })).id;
let maxOut = 0;
let fought = false;
for (let i = 0; i < 30; i++) {
  await ff(10);
  bs = await body();
  const k = bs.colonists.find((u) => u.id === kn);
  const g = bs.mobs.find((m) => m.id === g1);
  if (process.env.DEBUG) info(`leash ${i}: knight ${k ? `${k.x.toFixed(0)},${k.y.toFixed(0)} ${k.state} hp ${k.hp} -> ${k.targetMobId?.slice(0, 6)}` : "gone"}; goblin ${g ? `${g.x.toFixed(0)},${g.y.toFixed(0)} hp ${g.hp} ${g.id.slice(0, 6)}` : "dead"}; near: ${bs.mobs.filter((m) => Math.hypot(m.x - R.x, m.y - R.y) < 200).map((m) => `${m.kind}:${m.id.slice(0, 6)}`).join(" ")}`);
  if (!k) break;
  if (k.state === "attacking") fought = true;
  maxOut = Math.max(maxOut, Math.hypot(k.x - R.x, k.y - R.y) / TILE);
}
const kEnd = bs.colonists.find((u) => u.id === kn);
const gAlive = bs.mobs.some((m) => m.id === g1);
result(fought && !gAlive && maxOut <= 4.5 && kEnd && Math.hypot(kEnd.x - R.x, kEnd.y - R.y) <= 3,
  `knight fought (${fought}), goblin dead (${!gAlive}), furthest ${maxOut.toFixed(2)} tiles from slot (leash 4), back on slot: ${kEnd ? Math.hypot(kEnd.x - R.x, kEnd.y - R.y).toFixed(1) : "dead"} px (${kEnd?.state})`);
await hook("killColonists", { kind: "knight" });

// 4. A mob heading for the Town Center attacks a house it passes (no guard / player near).
const g2 = (await hook("spawnMob", { kind: "goblin", tx: A.x - 8, ty: A.y - 8 })).id;
await ff(5);
bs = await body();
const g2a = bs.mobs.find((m) => m.id === g2);
info(`goblin's first target: ${g2a?.targetType} ${g2a?.targetId}`);
const house = { x: A.x - 2, y: A.y - 6 };
await hook("setTileRaw", { tx: house.x, ty: house.y, tile: T.House });
await ff(200);
bs = await body();
const g2b = bs.mobs.find((m) => m.id === g2);
const hs = await hook("buildingState");
const hp = new Map(hs.buildingHp).get(`${house.x},${house.y}`); // present only once damaged
result(g2a?.targetId !== `${house.x},${house.y}` && g2b?.targetType === "building" && g2b?.targetId === `${house.x},${house.y}` && typeof hp === "number",
  `goblin passing a house turns on it: target ${g2b?.targetType} ${g2b?.targetId}, house hp ${hp ?? "undamaged"}`);
await hook("damageMob", { mobId: g2, amount: 999 });

// 5. Raid formations: followers hold heading-relative slots; ranged in rows behind the melee.
await hook("setRaids", { enabled: true });
await hook("holdRaidAggro", { value: true });
let st = await hook("raidState");
const DAY = st.dayTicks;
const CYCLE = st.dayTicks + st.nightTicks;
const MID = Math.floor(DAY / 2);
await hook("setCycleTick", { tick: 6 * CYCLE + MID - 2 });
await ff(5);
await hook("setCycleTick", { tick: 6 * CYCLE + DAY - 1 });
await ff(240);
st = await hook("raidState");
let ok = 0;
let total = 0;
let rankBad = 0;
let rotated = 0;
for (const g of st.groups) {
  if (g.state !== "marching" || g.engagedTick !== null || g.headingX === null) continue;
  const leader = st.mobs.find((m) => m.id === g.leaderId);
  if (!leader) continue;
  if (Math.abs(g.headingX) < 0.9) rotated++;
  const fx = g.headingX;
  const fy = g.headingY;
  for (const [id, off] of g.offsets) {
    const m = st.mobs.find((x) => x.id === id && x.groupId === g.id);
    if (!m) continue;
    const ex = leader.x - fy * off.x - fx * off.y;
    const ey = leader.y + fx * off.x - fy * off.y;
    total++;
    if (Math.hypot(m.x - ex, m.y - ey) <= 24) ok++;
  }
  const rowOf = (pred) => g.offsets.filter(([id]) => pred(st.mobs.find((x) => x.id === id))).map(([, o]) => o.row);
  const ranged = rowOf((m) => m && ["goblinCrossbow", "banditArcher", "darkShaman"].includes(m.kind));
  const melee = rowOf((m) => m && !["goblinCrossbow", "banditArcher", "darkShaman"].includes(m.kind));
  if (ranged.length && melee.length && Math.min(...ranged) < Math.max(...melee)) rankBad++;
}
result(total >= 4 && ok / total >= 0.7 && rankBad === 0,
  `marching followers on their heading-relative slots: ${ok}/${total} within 24 px (${rotated} groups heading off the x axis); ranged behind melee in every group (${rankBad} bad)`);

// 6. Tick time with ~150 mobs on the live loop (unpaused): marching, then broken up near the colony.
await hook("setRaids", { enabled: true });
send({ type: "pause" }); // toggles back to running
await sleep(300);
const raidAt = async (day) => {
  await hook("setCycleTick", { tick: day * CYCLE + MID - 3 });
  await sleep(600);
};
await raidAt(20);
await raidAt(40);
await hook("ignorePlayers", { value: false });
st = await hook("raidState");
info(`perf: ${st.mobs.length} mobs, ${st.groups.length} groups, world ${W}x${W}`);
await hook("setCycleTick", { tick: 40 * CYCLE + DAY - 2 });
await sleep(400);
await hook("tickStats", { reset: true });
const avgs = [];
for (let i = 0; i < 6; i++) {
  await sleep(5000);
  const s = await hook("tickStats", { reset: true });
  const rs = await hook("raidState");
  const engaging = rs.groups.filter((g) => g.engagedTick !== null).length;
  avgs.push(s.avgMs);
  info(`t+${(i + 1) * 5}s: ${s.mobs} mobs, ${s.groups} groups (${engaging} releasing rows); tick avg ${s.avgMs.toFixed(2)} ms, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)}`);
}
// Worst case: every remaining group hit at once, so all of them release their rows together.
for (const g of (await hook("raidState")).groups) await hook("damageMob", { mobId: g.memberIds[0], amount: 1 });
await hook("tickStats", { reset: true });
for (let i = 0; i < 2; i++) {
  await sleep(5000);
  const s = await hook("tickStats", { reset: true });
  avgs.push(s.avgMs);
  info(`all broken up t+${(i + 1) * 5}s: ${s.mobs} mobs, ${s.groups} groups; tick avg ${s.avgMs.toFixed(2)} ms, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)}`);
}
const overall = avgs.reduce((a, b) => a + b, 0) / avgs.length;
result(overall < 5, `tick avg over the 40 s storm ${overall.toFixed(2)} ms (target < 5)`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
