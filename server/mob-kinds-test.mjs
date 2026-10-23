// Scripted test: 10 monster kinds.
//   a) per-kind spawning: restarts the world (day 0), observes NIGHTS nights, checks every spawned
//      mob's kind is unlocked for that night's day index, that its maxHp matches the config table,
//      that multiple distinct kinds appear, and that per-tick movement matches each kind's speed.
//   b) ranged kinds: a goblinCrossbow / darkShaman that engages the player attacks from range
//      (projectile effect drawn from its own position, distance > melee range, <= its range).
//   c) special mechanics (troll regen, spider poison, shaman heal). These kinds unlock on days 6-10,
//      so they can't be reached on the real server in a practical runtime; section c needs a server
//      started with FORCE_KINDS / FORCE_MAX / a short day (see the scratch harness in the report).
//      Select with ONLY=c MECH=spider|troll|shaman PORT=8081.
// Default: ONLY=a,b against the real dev server on :8080. Note: (a) sends "restart", which resets
// the world for every connected client.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "a,b").split(","));
const NIGHTS = Number(process.env.NIGHTS ?? 3);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK_RATE = 20;

// Mirror of server MOB_KIND_CONFIG (range in tiles here).
const CONFIG = {
  goblin: { maxHp: 18, damage: 4, speed: 95, range: 0.8, melee: true, unlockDay: 0 },
  wolf: { maxHp: 22, damage: 6, speed: 130, range: 0.8, melee: true, unlockDay: 0 },
  goblinCrossbow: { maxHp: 16, damage: 6, speed: 80, range: 4, melee: false, unlockDay: 1 },
  orc: { maxHp: 45, damage: 10, speed: 75, range: 0.8, melee: true, unlockDay: 3 },
  skeleton: { maxHp: 50, damage: 8, speed: 60, range: 0.8, melee: true, unlockDay: 4 },
  armoredOrc: { maxHp: 80, damage: 14, speed: 55, range: 0.8, melee: true, unlockDay: 6 },
  giantSpider: { maxHp: 35, damage: 7, speed: 115, range: 0.8, melee: true, unlockDay: 6 },
  darkShaman: { maxHp: 25, damage: 12, speed: 70, range: 5, melee: false, unlockDay: 7 },
  troll: { maxHp: 120, damage: 16, speed: 65, range: 0.8, melee: true, unlockDay: 10 },
  ogre: { maxHp: 220, damage: 28, speed: 50, range: 0.8, melee: true, unlockDay: 12 },
  // Bandit band raid faction (also encampment guardians, excluded below as world-gen mobs).
  banditClubman: { maxHp: 30, damage: 7, speed: 85, range: 0.8, melee: true, unlockDay: 0 },
  banditArcher: { maxHp: 25, damage: 8, speed: 75, range: 4, melee: false, unlockDay: 0 },
  banditElite: { maxHp: 70, damage: 14, speed: 70, range: 0.8, melee: true, unlockDay: 3 },
};
const DAY0_KINDS = new Set(["goblin", "wolf", "banditClubman", "banditArcher"]);

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, listeners: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      for (const fn of c.listeners) fn(m, prev);
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = (s = c.snap) => s.players.find((p) => p.id === c.welcome.id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const a = connect();
await a.ready();

// ---------------------------------------------------------------- (a) + (b)
if (ONLY.has("a") || ONLY.has("b")) {
  // Normal difficulty: maxHp checks below are against the unscaled config (a bare restart would keep
  // whatever difficulty a previous test left the server on).
  a.send({ type: "restart", difficulty: "normal" });
  await sleep(300);
  if (a.snap.isPaused) a.send({ type: "pause" });
  // A fresh world now starts with dormant ruin/encampment guardians (world-gen, not night spawns);
  // they're excluded from every night-spawn check below.
  const worldGenMobIds = new Set(a.snap.mobs.map((m) => m.id));
  result(a.snap.isNight === false, `fresh world after restart: isNight=${a.snap.isNight} (day 0), world-gen guardians=${worldGenMobIds.size} (excluded below)`);
  console.log(`[${el()}] connected players: ${a.snap.players.length} (other clients, e.g. a browser tab, may also be present)`);

  let nightIndex = 0; // dayIndex of the current/last night (night of day N happens inside cycle N)
  let wasNight = false;
  let nightsSeen = 0;
  const seen = new Map(); // mobId -> { kind, day, maxHp }
  const kindsByDay = new Map(); // day -> Map(kind -> count)
  const maxStep = new Map(); // kind -> max per-tick displacement observed
  const stepsByKind = new Map(); // kind -> every non-zero per-tick displacement observed
  const rangedShots = []; // { kind, d, myTarget }
  let meleeEffects = 0;

  a.listeners.push((s, prev) => {
    if (s.isNight && !wasNight) nightsSeen++;
    if (!s.isNight && wasNight) nightIndex++;
    wasNight = s.isNight;

    for (const m of s.mobs) {
      if (worldGenMobIds.has(m.id)) continue;
      if (!seen.has(m.id)) {
        // Spawned while the current dayIndex = nightIndex (raids spawn at the day's midpoint, and
        // nightIndex only advances at dawn).
        seen.set(m.id, { kind: m.kind, day: nightIndex, maxHp: m.maxHp });
        const byKind = kindsByDay.get(nightIndex) ?? new Map();
        byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
        kindsByDay.set(nightIndex, byKind);
      }
      const pm = prev?.mobs.find((x) => x.id === m.id);
      if (pm && !s.isPaused) {
        const step = dist(pm, m);
        if (step > (maxStep.get(m.kind) ?? 0)) maxStep.set(m.kind, step);
        if (step > 0.01) {
          if (!stepsByKind.has(m.kind)) stepsByKind.set(m.kind, []);
          stepsByKind.get(m.kind).push(step);
        }
      }
    }
    for (const e of s.effects) {
      const shooter = s.mobs.find((m) => Math.abs(m.x - e.fromX) < 0.01 && Math.abs(m.y - e.fromY) < 0.01);
      if (!shooter) continue;
      if (CONFIG[shooter.kind].melee && !e.melee) meleeEffects++;
      const me = a.me(s);
      const toMe = me && Math.abs(me.x - e.toX) < 1 && Math.abs(me.y - e.toY) < 1;
      rangedShots.push({ kind: shooter.kind, d: Math.hypot(e.toX - e.fromX, e.toY - e.fromY), toMe });
    }
  });

  // Stand at spawn and swing every 300ms (server cooldown 0.5s) so melee mobs near us die; ranged
  // mobs stay out of our 1.3-tile reach.
  const swing = setInterval(() => a.send({ type: "attack" }), 300);
  const cycleSec = (60 + 40);
  const totalSec = (NIGHTS - 1) * cycleSec + 60 + 40 + 8;
  console.log(`[${el()}] observing ${NIGHTS} night(s), ~${totalSec}s ...`);
  const deadline = Date.now() + totalSec * 1000;
  while (Date.now() < deadline && nightsSeen <= NIGHTS) {
    if (nightsSeen === NIGHTS && !a.snap.isNight) break;
    await sleep(500);
  }
  clearInterval(swing);

  if (ONLY.has("a")) {
    for (const [day, byKind] of [...kindsByDay].sort((x, y) => x[0] - y[0])) {
      console.log(`[${el()}] day ${day} spawns: ${[...byKind].map(([k, n]) => `${k}=${n}`).join(", ")}`);
    }
    result(seen.size > 0, `observed ${seen.size} spawned mobs over ${nightsSeen} night(s)`);
    const badGate = [...seen.values()].filter((m) => CONFIG[m.kind] === undefined || CONFIG[m.kind].unlockDay > m.day);
    result(badGate.length === 0, `day-gating: no mob spawned before its unlock day${badGate.length ? " — violators: " + badGate.map((m) => `${m.kind}@day${m.day}`).join(", ") : ""}`);
    const day0 = kindsByDay.get(0) ?? new Map();
    result([...day0.keys()].every((k) => DAY0_KINDS.has(k)), `day 0 only ${[...DAY0_KINDS].join("/")}: {${[...day0.keys()].join(", ")}}`);
    const distinct = new Set([...seen.values()].map((m) => m.kind));
    result(distinct.size >= 2, `multiple distinct kinds seen: {${[...distinct].join(", ")}}`);
    const badHp = [...seen.values()].filter((m) => CONFIG[m.kind] && m.maxHp !== CONFIG[m.kind].maxHp);
    result(badHp.length === 0, `every spawned mob's maxHp matches its kind's config${badHp.length ? " — mismatches: " + badHp.map((m) => `${m.kind}:${m.maxHp}`).join(", ") : ""}`);
    // Raid groups march at their slowest member's pace and loiter at half speed, so a kind may never
    // reach full speed in the window: check it never exceeds it. Since combat bodies landed (body
    // separation pushes overlapping bodies apart after everyone has moved), a mob in a crowd can also be
    // shoved on top of its own step on the odd tick, so the raw max is only reported; the check is on
    // the 98th-percentile step, which separation spikes don't reach.
    for (const [kind, steps] of stepsByKind) {
      const expected = CONFIG[kind].speed / TICK_RATE;
      const sorted = steps.slice().sort((p, q) => p - q);
      const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
      result(p98 <= expected + 0.05, `${kind} p98 per-tick step ${p98.toFixed(2)}px <= speed/TICK_RATE = ${expected.toFixed(2)}px (max ${maxStep.get(kind).toFixed(2)}px over ${steps.length} steps)`);
    }
    const crossbowsByDay1Plus = [...seen.values()].filter((m) => m.kind === "goblinCrossbow").length;
    console.log(`[${el()}] goblinCrossbow spawns (eligible from day 1): ${crossbowsByDay1Plus}`);
  }

  if (ONLY.has("b")) {
    result(meleeEffects === 0, `melee kinds never emit a projectile effect (saw ${meleeEffects})`);
    const ranged = rangedShots.filter((r) => !CONFIG[r.kind].melee);
    if (ranged.length === 0) {
      console.log(`SKIP [${el()}] (b) no ranged mob fired during the window (spawn kind is random; crossbow weight is 4/20 from day 1)`);
    } else {
      const byKind = new Map();
      for (const r of ranged) {
        const e = byKind.get(r.kind) ?? { n: 0, min: Infinity, max: 0, toMe: 0 };
        e.n++;
        e.min = Math.min(e.min, r.d);
        e.max = Math.max(e.max, r.d);
        if (r.toMe) e.toMe++;
        byKind.set(r.kind, e);
      }
      for (const [kind, e] of byKind) {
        const rangePx = CONFIG[kind].range * TILE;
        // A ranged mob stops on the first path step that puts it inside its range, so most shots
        // should be fired from well beyond melee distance (0.8 tiles = 25.6px).
        result(e.max <= rangePx + 0.01 && e.min > CONFIG.goblin.range * TILE,
          `${kind}: ${e.n} shots (${e.toMe} at us), fired from ${e.min.toFixed(1)}–${e.max.toFixed(1)}px; melee range 25.6px, its range ${rangePx}px`);
      }
    }
  }
}

// ---------------------------------------------------------------- (c) forced-kind harness
if (ONLY.has("c")) {
  const MECH = process.env.MECH ?? "spider";
  const swingAt = async (pred, timeoutMs = 4000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (pred()) return true;
      a.send({ type: "attack" });
      await sleep(520);
    }
    return false;
  };
  const waitFor = async (pred, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (pred()) return true;
      await sleep(25);
    }
    return false;
  };
  const mobOf = (kind) => a.snap.mobs.find((m) => m.kind === kind);
  // Restart so mobs spawn while we're connected (a mob that spawned with no players around
  // locks onto the Town Center and never re-targets).
  a.send({ type: "restart" });
  await sleep(300);

  if (MECH === "spider") {
    // Let one spider poison us, kill it, then watch HP keep ticking down by exactly 1/tick.
    // Track the spider by id: with FORCE_MAX=1 a replacement spawns the very next tick after a kill.
    let spId = null;
    const hpLog = [];
    a.listeners.push((s) => hpLog.push({ t: Date.now(), hp: a.me(s)?.hp, alive: s.mobs.some((m) => m.id === spId) }));
    const near = await waitFor(() => { const sp = mobOf("giantSpider"); return sp && dist(sp, a.me()) <= 1.2 * TILE; }, 60000);
    spId = mobOf("giantSpider")?.id ?? null;
    const hpBefore = a.me().hp;
    const ok = near && (await waitFor(() => a.me().hp !== hpBefore, 3000));
    result(ok, `a giantSpider reached and hit the player (hp ${hpBefore} -> ${a.me().hp})`);
    if (ok) {
      const swing = setInterval(() => a.send({ type: "attack" }), 520);
      const killed = await waitFor(() => !a.snap.mobs.some((m) => m.id === spId), 6000);
      clearInterval(swing);
      result(killed, `spider killed by player swings`);
      const killT = Date.now();
      await sleep(4000);
      const killIdx = hpLog.findIndex((l, i) => i > 0 && hpLog[i - 1].alive && !l.alive);
      const after = hpLog.slice(killIdx);
      let ones = 0, others = 0, lastOneT = killT;
      for (let i = 1; i < after.length; i++) {
        const d = after[i - 1].hp - after[i].hp;
        if (d === 1) { ones++; lastOneT = after[i].t; }
        else if (d > 0) others++;
      }
      result(ones > 0 && ones <= 60, `after the spider died, hp kept dropping by exactly 1 on ${ones} ticks (poison, ≤60 = 3s)`);
      result(others === 0, `no non-poison damage during the window (${others} other drops)`);
      result(Date.now() - lastOneT > 500, `poison stopped ticking (${((lastOneT - killT) / 1000).toFixed(2)}s after kill)`);
    }
  } else if (MECH === "troll") {
    const ok = await waitFor(() => { const t = mobOf("troll"); return t && dist(t, a.me()) <= 1.2 * TILE; }, 60000);
    result(ok, `a troll reached the player`);
    if (ok) {
      const trollId = mobOf("troll").id;
      a.send({ type: "attack" });
      const hit = await waitFor(() => { const t = a.snap.mobs.find((m) => m.id === trollId); return t && t.hp < t.maxHp; }, 2000);
      const hitT = Date.now();
      result(hit, `player hit the troll (hp ${a.snap.mobs.find((m) => m.id === trollId)?.hp})`);
      const log = [];
      a.listeners.push((s) => { const t = s.mobs.find((m) => m.id === trollId); if (t) log.push({ t: Date.now(), hp: t.hp }); });
      await sleep(5500);
      let firstHealT = null, badStep = 0;
      for (let i = 1; i < log.length; i++) {
        const d = log[i].hp - log[i - 1].hp;
        if (d > 0) { if (firstHealT === null) firstHealT = log[i].t; if (d !== 1) badStep++; }
      }
      const delay = firstHealT ? (firstHealT - hitT) / 1000 : null;
      result(delay !== null && delay >= 3.8 && delay <= 4.5, `troll regen started ${delay?.toFixed(2)}s after last damage (expect ~4s)`);
      result(badStep === 0, `troll regen steps are exactly +1/tick (${badStep} non-+1 steps)`);
      result(log.at(-1)?.hp === 120, `troll back to full 120 hp, never above (final ${log.at(-1)?.hp}, max ${Math.max(...log.map((l) => l.hp))})`);
    }
  } else if (MECH === "shaman") {
    // Needs the harness started with FORCE_ZERO_DMG=1 so the player survives long enough to
    // position. The shaman stops ~5 tiles out; once the troll is on us, walk to ~2.5 tiles from the
    // shaman (outside our 1.3-tile reach so our swings hit the troll, not the shaman) so the troll
    // following us ends up inside the shaman's 5-tile heal range.
    const ok = await waitFor(() => {
      const t = mobOf("troll"), sh = mobOf("darkShaman");
      return t && sh && dist(t, a.me()) <= 1.2 * TILE && dist(sh, a.me()) <= 5.2 * TILE;
    }, 60000);
    result(ok, `darkShaman and troll both spawned and engaged the player`);
    if (ok) {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        const sh = mobOf("darkShaman"), me = a.me();
        if (!sh || dist(sh, me) <= 2.5 * TILE) break;
        a.send({ type: "input", dx: Math.sign(Math.round((sh.x - me.x) / 8)), dy: Math.sign(Math.round((sh.y - me.y) / 8)) });
        await sleep(50);
      }
      a.send({ type: "input", dx: 0, dy: 0 });
      const near = await waitFor(() => {
        const t = mobOf("troll"), sh = mobOf("darkShaman");
        return t && sh && dist(t, a.me()) <= 1.2 * TILE && dist(sh, a.me()) > 1.6 * TILE && dist(t, sh) <= 5 * TILE;
      }, 15000);
      const t = mobOf("troll"), sh = mobOf("darkShaman");
      result(near, `troll is next to us and within 5 tiles of the shaman (troll-shaman ${t && sh ? (dist(t, sh) / TILE).toFixed(2) : "?"} tiles)`);
      if (near) {
        const trollId = mobOf("troll").id;
        const log = [];
        a.listeners.push((s) => { const t = s.mobs.find((m) => m.id === trollId); if (t) log.push({ t: Date.now(), hp: t.hp, maxHp: t.maxHp }); });
        // Hit the troll twice (30 dmg) so a single 15-hp shaman heal can't be capped to < 15.
        a.send({ type: "attack" }); await sleep(560); a.send({ type: "attack" });
        await sleep(3500); // < 4s regen delay after the second hit, >= one full 3s shaman cooldown
        const jumps = [];
        for (let i = 1; i < log.length; i++) { const d = log[i].hp - log[i - 1].hp; if (d > 1) jumps.push(d); }
        result(jumps.length > 0 && jumps.every((j) => j === 15), `troll received shaman heal jump(s) of +15 inside the regen delay: [${jumps.join(", ")}] (log ${log.map((l) => l.hp).join(",")})`);
      }
    }
  }
}

a.ws.close();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
