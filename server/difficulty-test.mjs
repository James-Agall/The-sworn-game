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
// Takes ~1.5-2 min (the raid spawns 30 s and night falls 60 s after a restart).
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
const RAID_BASE_SIZE = 5;

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

// Everything present right after the restart is a world-gen guardian; the raid appears at the day
// midpoint (cycleProgress = 0.5 * dayFraction).
const dayMobIds = new Set(a.snap.mobs.map((m) => m.id));
while (a.snap.cycleProgress < a.snap.dayFraction / 2) await a.nextSnaps(1);
await a.nextSnaps(3);
const raidCount = a.snap.mobs.filter((m) => !dayMobIds.has(m.id)).length;
const expectedRaid = Math.max(1, Math.round(RAID_BASE_SIZE * HARD.spawnCount));
result(raidCount === expectedRaid, `day-0 raid at the day midpoint = ${raidCount} mobs (expected round(${RAID_BASE_SIZE} x ${HARD.spawnCount}) = ${expectedRaid})`);
while (!a.snap.isNight) await a.nextSnaps(1);
console.log(`[${el()}] night fell; ${dayMobIds.size} world-gen (guardian) mobs excluded`);

const expectedHp = (kind) => Math.max(1, Math.round(DAY0[kind].maxHp * HARD.mobHp));
const expectedDmg = Object.fromEntries(
  Object.entries(DAY0).map(([k, v]) => [k, Math.max(1, Math.round(v.damage * HARD.mobDamage))])
);
const checked = new Set();
let hpOk = 0;
let hpBad = [];
let hitSeen = null;
let lastHp = a.snap.players.find((p) => p.id === a.id()).hp;
const nightStart = Date.now();
while (Date.now() - nightStart < 38000 && a.snap.isNight) {
  const s = await a.nextSnaps(1);
  const nightMobs = s.mobs.filter((m) => !dayMobIds.has(m.id));
  for (const m of nightMobs) {
    if (checked.has(m.id)) continue;
    checked.add(m.id);
    if (!DAY0[m.kind]) continue;
    if (m.maxHp === expectedHp(m.kind)) hpOk++;
    else hpBad.push(`${m.kind} maxHp ${m.maxHp} != ${expectedHp(m.kind)}`);
  }
  const me = s.players.find((p) => p.id === a.id());
  // Walk toward the nearest night mob so one of them hits us.
  const target = nightMobs.sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
  if (target && !hitSeen) {
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    a.send({ type: "input", dx: Math.abs(dx) > 8 ? Math.sign(dx) : 0, dy: Math.abs(dy) > 8 ? Math.sign(dy) : 0 });
  }
  if (me.hp < lastHp && !hitSeen) {
    const drop = lastHp - me.hp;
    // Attribute the hit only when exactly one raid mob could have landed it: in melee reach, or a
    // bandit archer within its 4-tile range.
    const could = nightMobs.filter((m) => {
      const d = Math.hypot(m.x - me.x, m.y - me.y);
      return d < 48 || (m.kind === "banditArcher" && d < 32 * 4.5);
    });
    if (could.length === 1 && DAY0[could[0].kind]) hitSeen = { kind: could[0].kind, drop };
  }
  lastHp = me.hp;
  if (hitSeen && checked.size >= 4) break;
}
a.send({ type: "input", dx: 0, dy: 0 });

result(checked.size > 0, `raid mobs seen at night (${checked.size})`);
result(hpBad.length === 0 && hpOk > 0, `raid mob maxHp scaled x${HARD.mobHp} (${hpOk} ok${hpBad.length ? "; " + hpBad.join(", ") : ""})`);
if (hitSeen) {
  result(
    hitSeen.drop === expectedDmg[hitSeen.kind],
    `${hitSeen.kind} hit the player for ${hitSeen.drop} (expected ${expectedDmg[hitSeen.kind]} = round(${DAY0[hitSeen.kind].damage} x ${HARD.mobDamage}))`
  );
} else {
  console.log(`INFO [${el()}] no unambiguous night-mob hit on the player observed; damage multiplier not checked this run`);
}

a.ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
process.exit(fails === 0 ? 0 : 1);
