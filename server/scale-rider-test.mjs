// Scripted test: scale pass + goblin wolf rider (ROADMAP "Scale pass + goblin wolf rider — landed").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir> (`npm test -- scale-rider`
// boots one). Pauses the world and works in a cleared arena west of the Town Center.
//
//   V: size variation - 25 goblins / orcs / wolves: every roll in [0.85, 1.2], spread across the range, re-derived
//      from the id (deterministic), maxHp / speed / damage scaled from it, mean hp x damage within ~10% of base,
//      and the snapshot's `scale` field set exactly when the size != 1.
//   K: kind scale - a troll's / an ogre's melee reach and body radius grow x1.3 / x1.4 (x its roll).
//   C: wolf rider - role "fast", raid tables (riderPack faction, greenskin entry, unlock day 8); a rider running at a
//      knight lands a charge for 2x its damage, then rides off (hit and run); a pikeman's blow lands x1.6.
//   R: regiment - a raid group of 2 orcs + 2 riders shows 2 "fast" members in the strategy intel.
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
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// Mirror of server MOB_KIND_CONFIG / MOB_BODY_RADIUS for the kinds checked here.
const BASE = {
  goblin: { maxHp: 18, damage: 4, speed: 95 },
  orc: { maxHp: 45, damage: 10, speed: 75 },
  wolf: { maxHp: 22, damage: 6, speed: 130 },
  goblinRider: { maxHp: 30, damage: 7, speed: 125 },
};
const MELEE_RANGE = TILE * 0.8;

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
const mobState = async () => (await hook("raidState")).mobs;

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "join" });
const W = c.welcome.worldTilesX;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
const px = (tx) => tx * TILE + TILE / 2;
const A = { x: TCT.x - 34, y: TCT.y };
for (let dy = -12; dy <= 12; dy++) for (let dx = -20; dx <= 20; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: 0 });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: 0 });
async function clearArena() {
  for (const m of await mobState()) {
    if (Math.abs(m.x - px(A.x)) <= 30 * TILE && Math.abs(m.y - px(A.y)) <= 24 * TILE) await hook("damageMob", { mobId: m.id, amount: 1e7 });
  }
  for (const k of ["knight", "pikeman"]) await hook("killColonists", { kind: k });
  await ff(2);
}
await clearArena();

// ---------------------------------------------------------------- V: size variation
{
  const ids = [];
  for (const kind of ["goblin", "orc", "wolf"]) {
    for (let i = 0; i < 25; i++) {
      const r = await hook("spawnMob", { kind, tx: A.x - 12 + (i % 25), ty: A.y - 10 + ["goblin", "orc", "wolf"].indexOf(kind) * 2 });
      ids.push(r.id);
    }
  }
  await sleep(250); // a snapshot or two (paused: one per tick)
  const st = (await mobState()).filter((m) => ids.includes(m.id));
  const scales = st.map((m) => m.scale);
  const lo = Math.min(...scales);
  const hi = Math.max(...scales);
  result(st.length === 75 && scales.every((s) => s >= 0.85 && s <= 1.2), `V: 75 rolls all in [0.85, 1.2] (min ${lo}, max ${hi})`);
  result(lo <= 0.92 && hi >= 1.12, `V: rolls spread over the range (min ${lo} <= 0.92, max ${hi} >= 1.12)`);
  result(st.every((m) => m.rolledScale === m.scale), "V: every roll re-derives from the mob's id (deterministic)");
  const badHp = st.filter((m) => m.maxHp !== Math.max(1, Math.round(BASE[m.kind].maxHp * m.scale)));
  result(badHp.length === 0, `V: maxHp = base x size${badHp.length ? " — " + badHp.map((m) => `${m.kind} ${m.scale}: ${m.maxHp}`).join(", ") : ""}`);
  const badSpeed = st.filter((m) => !near(m.speed, BASE[m.kind].speed * (1 - (m.scale - 1) * 0.5)));
  result(badSpeed.length === 0, `V: speed = base x (1 - (size - 1) / 2): bigger is slower${badSpeed.length ? " — " + badSpeed.map((m) => `${m.kind} ${m.scale}: ${m.speed}`).join(", ") : ""}`);
  const big = st.filter((m) => m.kind === "orc").sort((p, q) => q.scale - p.scale);
  result(big[0].damage > big[big.length - 1].damage && big[0].range > big[big.length - 1].range && big[0].bodyRadius > big[big.length - 1].bodyRadius,
    `V: the biggest orc (${big[0].scale}) out-hits / out-reaches / out-sizes the smallest (${big[big.length - 1].scale}): dmg ${big[0].damage} vs ${big[big.length - 1].damage}, reach ${big[0].range.toFixed(1)} vs ${big[big.length - 1].range.toFixed(1)}, body ${big[0].bodyRadius.toFixed(1)} vs ${big[big.length - 1].bodyRadius.toFixed(1)}`);
  const power = st.reduce((s, m) => s + (m.maxHp * m.damage) / (BASE[m.kind].maxHp * BASE[m.kind].damage), 0) / st.length;
  result(power > 0.9 && power < 1.12, `V: mean hp x damage vs base ${power.toFixed(3)} (roughly power-neutral)`);
  const snapBad = st.filter((m) => {
    const s = c.snap.mobs.find((x) => x.id === m.id);
    return !s || (m.scale === 1 ? s.scale !== undefined : s.scale !== m.scale);
  });
  result(snapBad.length === 0, `V: snapshot \`scale\` = the roll, omitted when 1 (${snapBad.length} mismatches)`);
  await clearArena();
}

// ---------------------------------------------------------------- K: kind scale (trolls / ogres)
{
  const troll = await hook("spawnMob", { kind: "troll", tx: A.x + 6, ty: A.y - 6 });
  const ogre = await hook("spawnMob", { kind: "ogre", tx: A.x + 6, ty: A.y + 6 });
  result(near(troll.range, MELEE_RANGE * 1.3 * troll.scale) && near(troll.bodyRadius, 12 * 1.3 * troll.scale),
    `K: troll reach ${troll.range.toFixed(1)}px (25.6 x 1.3 x ${troll.scale}), body ${troll.bodyRadius.toFixed(1)}px (12 x 1.3 x ${troll.scale})`);
  result(near(ogre.range, MELEE_RANGE * 1.4 * ogre.scale) && near(ogre.bodyRadius, 14 * 1.4 * ogre.scale),
    `K: ogre reach ${ogre.range.toFixed(1)}px (25.6 x 1.4 x ${ogre.scale}), body ${ogre.bodyRadius.toFixed(1)}px (14 x 1.4 x ${ogre.scale})`);
  const boss = await hook("spawnMob", { kind: "ogre", tx: A.x + 10, ty: A.y, boss: "warlord" });
  result(boss.scale === 1 && boss.maxHp === 990 && boss.bodyRadius > ogre.bodyRadius,
    `K: a Warlord takes no roll (scale ${boss.scale}, ${boss.maxHp} hp) and has the biggest body (${boss.bodyRadius.toFixed(1)}px)`);
  await clearArena();
}

// ---------------------------------------------------------------- C: goblin wolf rider
{
  const rs = await hook("raidState");
  const sg = await hook("siegeState");
  result(sg.roles.mob.goblinRider === "fast", `C: goblinRider role ${sg.roles.mob.goblinRider}`);
  result(rs.unlockDays.goblinRider === 8 && rs.factions.riderPack?.[0]?.kind === "goblinRider" && rs.factions.greenskinWarband.some((e) => e.kind === "goblinRider" && !e.core),
    `C: riders unlock on day ${rs.unlockDays.goblinRider}, ride as a riderPack faction and a non-core greenskin extra`);

  const knight = (await hook("spawnSoldier", { kind: "knight", x: px(A.x), y: px(A.y), stance: "defensive" })).id;
  const rider = await hook("spawnMob", { kind: "goblinRider", tx: A.x + 8, ty: A.y });
  result(rider.maxHp === Math.round(BASE.goblinRider.maxHp * rider.scale), `C: rider spawned (${rider.maxHp} hp, ${rider.damage} dmg, size ${rider.scale}, speed ${rider.speed.toFixed(1)})`);
  const since = sg.cycleTick;
  let charge = null;
  let chargeDist = null;
  let maxAfter = 0;
  for (let i = 0; i < 200; i++) {
    await ff(2);
    const ms = (await mobState()).find((m) => m.id === rider.id);
    const ks = (await hook("bodyState")).colonists.find((u) => u.id === knight);
    if (!ms || !ks) break;
    const d = Math.hypot(ms.x - ks.x, ms.y - ks.y);
    if (!charge) {
      const ev = (await hook("siegeState")).events.find((e) => e.id === rider.id && e.tick > since);
      if (ev) {
        charge = ev;
        chargeDist = d;
      }
    } else {
      maxAfter = Math.max(maxAfter, d);
      if (i > 0 && maxAfter > chargeDist + TILE * 2) break;
    }
  }
  info(`C: first rider blow ${JSON.stringify(charge)}, distance then ${chargeDist?.toFixed(1)}px, max after ${maxAfter.toFixed(1)}px`);
  result(charge?.type === "riderCharge" && near(charge.amount, rider.damage * 2), `C: the rider's first blow is a charge for 2 x ${rider.damage} (${charge?.type} ${charge?.amount})`);
  result(chargeDist !== null && maxAfter > chargeDist + TILE * 2, `C: then it rides off (hit and run): ${chargeDist?.toFixed(1)}px -> ${maxAfter.toFixed(1)}px`);

  // Pikemen are its bane: a pikeman's blow lands x1.6, a knight's x1.
  const rider2 = await hook("spawnMob", { kind: "goblinRider", tx: A.x + 14, ty: A.y + 8 });
  const pike = (await hook("spawnSoldier", { kind: "pikeman", x: px(A.x - 10), y: px(A.y + 10), stance: "defensive" })).id;
  await hook("damageMob", { mobId: rider2.id, amount: 10, byColonist: pike });
  const afterPike = (await mobState()).find((m) => m.id === rider2.id).hp;
  await hook("damageMob", { mobId: rider2.id, amount: 10, byColonist: knight });
  const afterKnight = (await mobState()).find((m) => m.id === rider2.id).hp;
  result(near(rider2.hp - afterPike, 16) && near(afterPike - afterKnight, 10), `C: pikeman blow of 10 takes ${(rider2.hp - afterPike).toFixed(1)} (x1.6), a knight's ${(afterPike - afterKnight).toFixed(1)}`);
  await clearArena();
}

// ---------------------------------------------------------------- R: riders as the fast wing of a regiment
{
  await hook("teleportPlayer", { x: px(A.x - 4), y: px(A.y) });
  await sleep(150);
  send({ type: "setView", x: px(A.x), y: px(A.y), halfW: 20, halfH: 12, strategy: true });
  const g = await hook("spawnRaidGroup", { kinds: ["orc", "orc", "goblinRider", "goblinRider"], tx: A.x + 4, ty: A.y - 1 });
  let reg = null;
  for (let i = 0; i < 60 && !reg; i++) {
    await sleep(50);
    reg = (c.snap.enemyRegiments ?? []).find((r) => r.id === g.id) ?? null;
  }
  result(!!reg && reg.roles.fast === 2 && reg.roles.frontline === 2, `R: regiment intel ${JSON.stringify(reg?.roles)} (2 fast riders, 2 frontline orcs), power ${reg?.power}`);
  await clearArena();
}

send({ type: "pause", paused: false });
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`} [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
