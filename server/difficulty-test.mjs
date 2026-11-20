// Scripted test: world difficulty (Easy / Normal / Hard).
//   a) welcome + snapshot echo the active difficulty; the first setDifficulty claims it, a second
//      client's later one is ignored; restart{difficulty} claims it outright; a bare restart reopens
//      the claim for the next setDifficulty.
//   b) Hard multipliers on raid-wave mobs: every mob that appears after the restart (i.e. not a POI
//      guardian) has maxHp = round(config maxHp * 1.3); the first hit a raid mob lands on the player
//      is round(config damage * 1.35); the day-0 raid (spawned at once at the day midpoint) is
//      round(5 * 1.35) = 7 mobs.
// Sends "restart": run it against a PRIVATE server, e.g.
//   COLONY_WORLD_SIZE=80 PORT=8097 npx tsx src/index.ts &   then   PORT=8097 node difficulty-test.mjs
// Hooks jump the clock: runs in a few seconds.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const URL = `ws://localhost:${PORT}`;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror of server DIFFICULTY_HARD, the day-0 raid kinds in MOB_KIND_CONFIG/RAID_FACTIONS and
// RAID_BASE_SIZE.
const HARD = { mobDamage: 1.35, mobHp: 1.3, spawnCount: 1.35 };
const DAY0 = {
  goblin: { maxHp: 18, damage: 4 },
  wolf: { maxHp: 22, damage: 6 },
  banditClubman: { maxHp: 30, damage: 7 },
  banditArcher: { maxHp: 25, damage: 8 },
};
// Village life phase 4: RAID_BASE_SIZE 3, times the people factor clamp(people / 15, 0.5, 1.5 at tier 1).
const RAID_BASE_SIZE = 3;

function client(label) {
  const c = { label, ws: new WebSocket(URL), welcomes: [], snap: null, snapCount: 0 };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcomes.push(m);
    else if (m.type === "snapshot") {
      c.snap = m;
      c.snapCount++;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.id = () => c.welcomes[c.welcomes.length - 1].id;
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (c.welcomes.length === 0 || !c.snap) await sleep(20);
  };
  c.nextSnaps = async (n = 2) => {
    const start = c.snapCount;
    while (c.snapCount < start + n) await sleep(10);
    return c.snap;
  };
  c.nextWelcome = async (count) => {
    while (c.welcomes.length < count) await sleep(10);
    return c.welcomes[count - 1];
  };
  return c;
}

// ---- a) claim / echo / race ----
const a = client("A");
await a.ready();
result(["easy", "normal", "hard"].includes(a.welcomes[0].difficulty), `welcome carries difficulty (${a.welcomes[0].difficulty})`);
result(typeof a.snap.difficulty === "string", `snapshot carries difficulty (${a.snap.difficulty})`);

// Bare restart -> unclaimed; A claims hard.
let wa = a.welcomes.length;
a.send({ type: "restart" });
await a.nextWelcome(wa + 1);
a.send({ type: "setDifficulty", difficulty: "hard" });
await a.nextSnaps();
result(a.snap.difficulty === "hard", `first setDifficulty after restart claims it (hard): ${a.snap.difficulty}`);

const b = client("B");
await b.ready();
result(b.welcomes[0].difficulty === "hard", `late joiner's welcome shows the active difficulty: ${b.welcomes[0].difficulty}`);
b.send({ type: "setDifficulty", difficulty: "easy" });
await b.nextSnaps();
result(b.snap.difficulty === "hard", `second client's setDifficulty is ignored: ${b.snap.difficulty}`);
b.send({ type: "setDifficulty", difficulty: "bogus" });
await b.nextSnaps();
result(b.snap.difficulty === "hard", `invalid value ignored: ${b.snap.difficulty}`);

// restart{difficulty} claims outright; B's follow-up setDifficulty is ignored.
wa = a.welcomes.length;
let wb = b.welcomes.length;
a.send({ type: "restart", difficulty: "easy" });
const wA = await a.nextWelcome(wa + 1);
const wB = await b.nextWelcome(wb + 1);
result(wA.difficulty === "easy" && wB.difficulty === "easy", `restart{easy} -> both welcomes easy (${wA.difficulty}/${wB.difficulty})`);
b.send({ type: "setDifficulty", difficulty: "hard" });
await b.nextSnaps();
result(b.snap.difficulty === "easy", `setDifficulty after restart{difficulty} ignored: ${b.snap.difficulty}`);

// Bare restart reopens: B claims hard, then A's easy is ignored (two players connected).
wb = b.welcomes.length;
a.send({ type: "restart" });
await b.nextWelcome(wb + 1);
b.send({ type: "setDifficulty", difficulty: "hard" });
await b.nextSnaps();
a.send({ type: "setDifficulty", difficulty: "easy" });
await a.nextSnaps(4);
result(a.snap.difficulty === "hard", `bare restart reopens the claim, first sender wins: ${a.snap.difficulty}`);
b.ws.close();
await sleep(200);

// Solo on the first day: the only connected player may change their mind.
a.send({ type: "setDifficulty", difficulty: "easy" });
await a.nextSnaps();
result(a.snap.difficulty === "easy", `solo first-day player can re-pick: ${a.snap.difficulty}`);

// ---- b) Hard multipliers on raid mobs ----
wa = a.welcomes.length;
a.send({ type: "restart", difficulty: "hard" });
await a.nextWelcome(wa + 1);
await a.nextSnaps(3);
result(a.snap.difficulty === "hard", "world restarted on hard");

// Needs COLONY_TEST_HOOKS=1 (the runner boots it so). No waiting for the real day / night clock: hooks jump the
// cycle and spawn the mobs.
const hook = (op, args = {}) =>
  new Promise((resolve) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "testHookResult" && m.op === op) { a.ws.off("message", onMsg); resolve(m); }
    };
    a.ws.on("message", onMsg);
    a.send({ type: "testHook", op, ...args });
  });

// Everything present right after the restart is a world-gen guardian; the day-0 raid appears at the day midpoint.
const dayMobIds = new Set(a.snap.mobs.map((m) => m.id));
const rs0 = await hook("raidState");
await hook("setCycleTick", { tick: Math.floor(rs0.dayTicks / 2) - 2 });
let raidMobs = [];
for (let i = 0; i < 100 && raidMobs.length === 0; i++) {
  await a.nextSnaps(1);
  raidMobs = a.snap.mobs.filter((m) => !dayMobIds.has(m.id));
}
await a.nextSnaps(5);
raidMobs = a.snap.mobs.filter((m) => !dayMobIds.has(m.id));
// The server's own size for tonight (people factor and tier cap x the Hard spawn multiplier): the whole raid is spawned.
const { size: expectedRaid } = await hook("raidSize", { dayIndex: 0 });
result(expectedRaid >= 1 && raidMobs.length === expectedRaid, `day-0 raid at the day midpoint = ${raidMobs.length} mobs (server raidSize for day 0 on Hard = ${expectedRaid})`);

// Scale pass: on top of the difficulty, each raid mob's maxHp is x its rolled size s (snapshot `scale`) and
// its damage x (1 + (s - 1) / 2), to 0.1 (server applyMobSize).
const expectedHp = (kind, s = 1) => Math.max(1, Math.round(Math.max(1, Math.round(DAY0[kind].maxHp * HARD.mobHp)) * s));
const expectedDmg = Object.fromEntries(
  Object.entries(DAY0).map(([k, v]) => [k, Math.max(1, Math.round(v.damage * HARD.mobDamage))])
);
const sizedDmg = (kind, s = 1) => (s === 1 ? expectedDmg[kind] : Math.max(1, Math.round(expectedDmg[kind] * (1 + (s - 1) * 0.5) * 10) / 10));
let hpOk = 0;
const hpBad = [];
for (const m of raidMobs) {
  if (!DAY0[m.kind]) continue;
  if (m.maxHp === expectedHp(m.kind, m.scale ?? 1)) hpOk++;
  else hpBad.push(`${m.kind} maxHp ${m.maxHp} != ${expectedHp(m.kind, m.scale ?? 1)}`);
}
result(raidMobs.length > 0, `raid mobs seen (${raidMobs.length})`);
result(hpBad.length === 0 && hpOk > 0, `raid mob maxHp scaled x${HARD.mobHp} (${hpOk} ok${hpBad.length ? "; " + hpBad.join(", ") : ""})`);

// Damage multiplier, deterministically: a goblin spawned on the player (the only raid mob there) lands its first
// hit for round(4 x 1.35) x its size factor.
const me0 = a.snap.players.find((p) => p.id === a.id());
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: false });
const g = await hook("spawnMob", { kind: "goblin", tx: Math.floor(me0.x / 32), ty: Math.floor(me0.y / 32) });
let firstDrop = 0;
let lastHp = a.snap.players.find((p) => p.id === a.id()).hp;
for (let i = 0; i < 150 && !firstDrop; i++) {
  const s = await a.nextSnaps(1);
  const hp = s.players.find((p) => p.id === a.id()).hp;
  if (hp < lastHp) firstDrop = lastHp - hp;
  lastHp = hp;
}
const gScale = a.snap.mobs.find((m) => m.id === g.id)?.scale ?? g.scale ?? 1;
result(firstDrop > 0 && Math.abs(firstDrop - sizedDmg("goblin", gScale)) < 1e-6,
  `goblin hit the player for ${firstDrop} (expected ${sizedDmg("goblin", gScale)} = round(${DAY0.goblin.damage} x ${HARD.mobDamage}) x size ${gScale})`);

a.ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
process.exit(fails === 0 ? 0 : 1);
