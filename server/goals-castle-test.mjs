// Scripted test: ROADMAP Phase 5 — goal track, Castle Ruin, Ogre Warlord, mini-boss packs.
// Self-contained like save-load-test.mjs: boots its OWN private servers (tsx, COLONY_TEST_HOOKS=1,
// COLONY_SAVE_DIR = a temp dir) on PORT, PORT+1, ... (default 18961), one per world size, so the
// shared :8080 world and server/saves/ are never touched. Run from server/: `node goals-castle-test.mjs`
// (SIZES=80,160,64 by default; the first size also runs the gameplay sections).
//   A (every size, 3 worlds each): exactly one Castle Ruin (welcome.castleRuin), its 9x9 layout of
//      ruin tiles, far from the Town Center; one Ogre Warlord at its centre (ogre, 4.5x hp, 2x damage,
//      snapshot boss "warlord"); 8-12 dormant ruin-weighted guardians inside its walls; mini-boss
//      packs (one elite at 2.5x hp / 1.5x damage + 2-4 followers of its kind); all dormant.
//   B (first size): goal track in order — place a building, assign a worker, arm a unit, survive the
//      first night, then 3/7/14/21 nights (time travel) — each with a "milestone" toast and its reward;
//      snapshot.goal follows.
//   C: "sighted" toasts fire once per boss when the player comes within vision range.
//   D: save -> restart -> load restores goal state, Castle Ruin and Warlord; a save with the Phase 5
//      fields stripped (an old save) still loads, its goal track caught up silently.
//   E: killing an elite pays its reward + toast and wakes its pack; killing the Warlord pays, toasts,
//      clears the Castle Ruin and completes the final goal; the Warlord never respawns.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_PORT = Number(process.env.PORT ?? 18961);
const SIZES = (process.env.SIZES ?? "80,160,64").split(",").map(Number);
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
const REACH = TILE * 2.5;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));

// Mirrors of protocol.ts / server constants used here.
const T = { Empty: 0, Wall: 1, RuinWall1: 36, RuinWall2: 37, RuinArch: 38, RuinStatue: 39, RuinRubble: 40, HunterHut: 50 };
const CASTLE_RUIN_LAYOUT = [
  "12A1.1A21",
  "2.......2",
  "A..R.R..A",
  "1.S...S.1",
  "....B....",
  "1.S...S.1",
  "A..R.R..A",
  "2.......2",
  "12A1.1A21",
];
const LAYOUT_TILE = { 1: T.RuinWall1, 2: T.RuinWall2, A: T.RuinArch, S: T.RuinStatue, R: T.RuinRubble };
// Mirror of server MOB_KIND_CONFIG for the boss kinds (bosses take no size roll; their followers do).
const MOB_BASE = {
  ogre: { maxHp: 220, damage: 28 },
  wolf: { maxHp: 22, damage: 6 },
  orc: { maxHp: 45, damage: 10 },
  skeleton: { maxHp: 50, damage: 8 },
  giantSpider: { maxHp: 35, damage: 7 },
  armoredOrc: { maxHp: 80, damage: 14 },
  troll: { maxHp: 120, damage: 16 },
};
const CASTLE_KINDS = new Set(["skeleton", "orc", "armoredOrc", "darkShaman"]);
const MINI_BOSS_KINDS = new Set(["wolf", "orc", "skeleton", "giantSpider", "armoredOrc", "troll"]);
const GOAL_TITLES = [
  "Place a building",
  "Assign a worker",
  "Arm a unit",
  "Survive the first night",
  // Long days (2026-10-23): rescaled from 3/7/14/21.
  "Survive 2 nights",
  "Survive 4 nights",
  "Survive 7 nights",
  "Survive 10 nights",
  "Clear the Castle Ruin",
];

function startServer(port, size, saveDir) {
  const proc = spawn(TSX, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), COLONY_WORLD_SIZE: String(size), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group: tsx runs the server in a child process, and killing the group takes both.
    detached: true,
  });
  const s = { proc, log: "", exited: false };
  proc.stdout.on("data", (d) => (s.log += d));
  proc.stderr.on("data", (d) => (s.log += d));
  proc.on("exit", () => (s.exited = true));
  return s;
}

function killServer(s) {
  try {
    process.kill(-s.proc.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

async function waitForPort(port) {
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/saves`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${port} never came up`);
}

function connect(port) {
  const c = { ws: new WebSocket(`ws://localhost:${port}`), welcome: null, welcomes: 0, snap: null, tiles: [], waiters: [], events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    else if (m.type === "event") c.events.push(m);
    for (const w of c.waiters.slice()) {
      if (w.pred(m)) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 30000) =>
    new Promise((resolve, reject) => {
      const w = { pred, resolve };
      c.waiters.push(w);
      setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    });
  c.hook = (op, data = {}) => {
    const p = c.wait((m) => m.type === "testHookResult" && m.op === op, 120000);
    c.send({ type: "testHook", op, ...data });
    return p;
  };
  c.nextSnap = () => c.wait((m) => m.type === "snapshot");
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.W = () => c.welcome.worldTilesX;
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  return c;
}

async function restart(c) {
  const before = c.welcomes;
  c.send({ type: "restart" });
  while (c.welcomes === before) await sleep(20);
  await c.nextSnap();
  await c.nextSnap();
}

// Waits (real time) until pred(goalState) holds, polling the hook.
async function waitGoal(c, pred, ms = 8000) {
  const deadline = Date.now() + ms;
  let st = await c.hook("goalState");
  while (!pred(st) && Date.now() < deadline) {
    await sleep(150);
    st = await c.hook("goalState");
  }
  return st;
}

function checkWorld(c, st, label) {
  const W = c.W();
  const cr = c.welcome.castleRuin;
  result(!!cr, `${label}: welcome.castleRuin is set (${JSON.stringify(cr)})`);
  if (!cr) return;
  result(JSON.stringify(cr) === JSON.stringify(st.castleRuinCenter), `${label}: welcome.castleRuin matches the server's`);
  const R = 4;
  result(cr.x - R >= 0 && cr.y - R >= 0 && cr.x + R < W && cr.y + R < W, `${label}: 9x9 footprint is in bounds`);
  let mismatches = 0;
  for (let ry = 0; ry < 9; ry++) {
    for (let rx = 0; rx < 9; rx++) {
      const ch = CASTLE_RUIN_LAYOUT[ry][rx];
      const want = LAYOUT_TILE[ch] ?? T.Empty;
      if (c.tileAt(cr.x + rx - R, cr.y + ry - R) !== want) mismatches++;
    }
  }
  result(mismatches === 0, `${label}: footprint tiles match the Castle Ruin layout (mismatches ${mismatches})`);
  const tc = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
  const d = Math.hypot(cr.x - tc.x, cr.y - tc.y);
  result(d >= Math.min(Math.floor(W * 0.25), 15 + 5), `${label}: Castle Ruin is ${d.toFixed(1)} tiles from the Town Center (world ${W})`);

  const warlords = st.mobs.filter((m) => m.boss === "warlord");
  result(warlords.length === 1, `${label}: exactly one Ogre Warlord (${warlords.length})`);
  const wl = warlords[0];
  if (wl) {
    const atCentre = Math.floor(wl.x / TILE) === cr.x && Math.floor(wl.y / TILE) === cr.y;
    result(wl.kind === "ogre" && atCentre, `${label}: Warlord is an ogre at the centre (${wl.kind} @ ${Math.floor(wl.x / TILE)},${Math.floor(wl.y / TILE)})`);
    result(
      wl.maxHp === Math.round(MOB_BASE.ogre.maxHp * 4.5) && wl.hp === wl.maxHp && wl.damage === MOB_BASE.ogre.damage * 2,
      `${label}: Warlord stats 4.5x hp / 2x damage (${wl.maxHp} hp, ${wl.damage} dmg)`
    );
    const snapWl = c.snap.mobs.find((m) => m.id === wl.id);
    result(snapWl?.boss === "warlord", `${label}: snapshot carries boss "warlord" for it`);
  }
  const guards = st.mobs.filter((m) => m.siteKind === "castleRuin" && !m.boss);
  result(guards.length >= 8 && guards.length <= 12, `${label}: ${guards.length} Castle Ruin guardians (8-12)`);
  result(guards.every((m) => CASTLE_KINDS.has(m.kind)), `${label}: guardian kinds ⊆ {skeleton, orc, armoredOrc, darkShaman}: {${[...new Set(guards.map((m) => m.kind))].join(", ")}}`);
  result(
    guards.every((m) => Math.max(Math.abs(Math.floor(m.x / TILE) - cr.x), Math.abs(Math.floor(m.y / TILE) - cr.y)) <= 3),
    `${label}: every guardian stands inside the walls`
  );
  result(guards.every((m) => m.siteId === wl?.siteId), `${label}: guardians share the Warlord's site (one wake group)`);

  const elites = st.mobs.filter((m) => m.boss === "elite");
  result(elites.length >= 1, `${label}: ${elites.length} mini-boss pack(s)`);
  let packOk = true;
  for (const e of elites) {
    const pack = st.mobs.filter((m) => m.siteId === e.siteId && m.id !== e.id);
    if (!MINI_BOSS_KINDS.has(e.kind) || pack.length < 2 || pack.length > 4 || pack.some((m) => m.kind !== e.kind || m.boss)) packOk = false;
    if (e.maxHp !== Math.round(MOB_BASE[e.kind].maxHp * 2.5)) packOk = false;
    if (e.damage !== Math.round(MOB_BASE[e.kind].damage * 1.5)) packOk = false;
  }
  result(packOk, `${label}: each pack = one elite (2.5x hp, 1.5x dmg) + 2-4 followers of its kind: ${elites.map((e) => `${e.kind}(${e.maxHp}hp)+${st.mobs.filter((m) => m.siteId === e.siteId).length - 1}`).join(", ")}`);
  result(st.mobs.every((m) => !m.guardianActive), `${label}: every Castle Ruin / mini-boss mob is dormant`);
}

const servers = [];
// A killed run must not leave its private servers behind (a stale one would answer the next run).
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const s of servers) killServer(s);
    process.exit(1);
  });
}
async function portInUse(port) {
  try {
    await fetch(`http://localhost:${port}/saves`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}
try {
  for (let i = 0; i < SIZES.length; i++) {
    const size = SIZES[i];
    const port = BASE_PORT + i;
    if (await portInUse(port)) throw new Error(`port ${port} is already serving: set PORT to a free base port`);
    const saveDir = mkdtempSync(path.join(tmpdir(), "colony-goals-"));
    const srv = startServer(port, size, saveDir);
    servers.push(srv);
    await waitForPort(port);
    const c = connect(port);
    await c.ready();
    await c.hook("setRaids", { enabled: false });
    await c.hook("ignorePlayers", { value: true });

    // ------------------------------------------------------------ A: world-gen
    for (let w = 0; w < 3; w++) {
      if (w > 0) await restart(c);
      const st = await c.hook("goalState");
      checkWorld(c, st, `A ${size}x${size} world ${w + 1}`);
      if (w === 0) {
        result(c.snap.goal?.index === 0 && c.snap.goal?.title === GOAL_TITLES[0] && c.snap.goal?.total === GOAL_TITLES.length,
          `A ${size}: fresh world starts on goal 1/${GOAL_TITLES.length} "${c.snap.goal?.title}"`);
        result(JSON.stringify(st.goalTitles) === JSON.stringify(GOAL_TITLES), `A ${size}: goal order ${st.goalTitles.join(" -> ")}`);
      }
    }
    const start = await c.hook("goalState");
    const before = c.snap.mobs.filter((m) => start.mobs.some((s) => s.id === m.id)).map((m) => ({ id: m.id, x: m.x, y: m.y }));
    await sleep(2000);
    const moved = before.filter((b) => {
      const now = c.snap.mobs.find((m) => m.id === b.id);
      return !now || Math.hypot(now.x - b.x, now.y - b.y) > 0.01;
    });
    result(moved.length === 0, `A ${size}: Castle Ruin + mini-boss mobs stay put while dormant (moved ${moved.length}/${before.length})`);

    if (i > 0) {
      c.ws.close();
      continue;
    }

    // ------------------------------------------------------------ B: goal track
    await c.hook("setInstantBuild", { enabled: true });
    const me = c.me();
    const mx = Math.floor(me.x / TILE);
    const my = Math.floor(me.y / TILE);
    const occupied = new Set([...c.snap.colonists, ...c.snap.players].map((e) => Math.floor(e.y / TILE) * c.W() + Math.floor(e.x / TILE)));
    const free = [];
    for (let y = my - 2; y <= my + 2; y++) for (let x = mx - 2; x <= mx + 2; x++) {
      if (Math.hypot(x * TILE + 16 - me.x, y * TILE + 16 - me.y) > REACH) continue;
      if (c.tileAt(x, y) === T.Empty && !occupied.has(y * c.W() + x)) free.push({ x, y });
    }
    c.events.length = 0;
    const gold0 = (await c.hook("goalState")).stock.gold;
    const hut = free[0];
    c.send({ type: "setTile", tileX: hut.x, tileY: hut.y, tile: T.HunterHut });
    let st = await waitGoal(c, (s) => s.goalIndex >= 2);
    result(c.tileAt(hut.x, hut.y) === T.HunterHut, `B: Hunter's Hut placed at (${hut.x},${hut.y})`);
    result(st.goalIndex === 2, `B: placing it completed "Place a building" and (its hunter) "Assign a worker" -> goal ${st.goalIndex + 1} "${st.goal.title}"`);
    const ms = () => c.events.filter((e) => e.category === "milestone").map((e) => e.text);
    result(ms()[0]?.startsWith("Goal complete: Place a building") && ms()[1]?.startsWith("Goal complete: Assign a worker"),
      `B: milestone toasts in order: ${JSON.stringify(ms())}`);
    const post = free.find((t) => Math.abs(t.x - hut.x) + Math.abs(t.y - hut.y) > 1) ?? free[1];
    const knight = await c.hook("spawnSoldier", { kind: "knight", x: (post.x + 0.5) * TILE, y: (post.y + 0.5) * TILE });
    if (!knight.id) info(`spawnSoldier refused at (${post.x},${post.y})`);
    st = await waitGoal(c, (s) => s.goalIndex >= 3);
    result(st.goalIndex === 3 && ms()[2]?.startsWith("Goal complete: Arm a unit"), `B: a knight completed "Arm a unit" -> "${st.goal.title}" (${ms()[2]})`);
    await c.nextSnap();
    result(c.snap.goal.index === 3 && c.snap.goal.title === "Survive the first night" && c.snap.goal.progress === 0 && c.snap.goal.target === 1,
      `B: snapshot.goal = ${JSON.stringify(c.snap.goal)}`);
    const raid = await c.hook("raidState");
    const cycle = raid.dayTicks + raid.nightTicks;
    await c.hook("setCycleTick", { tick: cycle + 5 });
    st = await waitGoal(c, (s) => s.goalIndex >= 4);
    result(st.goalIndex === 4 && st.nightsSurvived === 1, `B: first dawn completed "Survive the first night" -> "${st.goal.title}" ${st.goal.progress}/${st.goal.target}`);
    await c.hook("setCycleTick", { tick: 3 * cycle + 5 });
    st = await waitGoal(c, (s) => s.goalIndex >= 5 && s.goal.progress === 3);
    await c.nextSnap();
    result(st.goalIndex === 5 && c.snap.goal.progress === 3 && c.snap.goal.target === 4, `B: 3 nights -> snapshot progress ${c.snap.goal.progress}/${c.snap.goal.target}`);
    await c.hook("setCycleTick", { tick: 10 * cycle + 5 });
    st = await waitGoal(c, (s) => s.goalIndex >= 8);
    result(st.goalIndex === 8 && st.goal.title === "Clear the Castle Ruin", `B: 10 nights chain-completed the night milestones -> "${st.goal.title}"`);
    const nightToasts = ms().slice(3);
    result(
      ["first night", "2 nights", "4 nights", "7 nights", "10 nights"].every((n, k) => nightToasts[k]?.includes(n)),
      `B: one toast per night milestone: ${JSON.stringify(nightToasts)}`
    );
    // Rewards: 15+30+60+100+150 gold from the night goals (no kills happened).
    result(st.stock.gold - gold0 === 355, `B: goal rewards paid (+${st.stock.gold - gold0} gold, expected +355)`);

    // ------------------------------------------------------------ C: sightings
    c.events.length = 0;
    // The elite farthest from the Warlord, so only one of them is in view at a time.
    const wlPos = st.mobs.find((m) => m.boss === "warlord");
    const elite = st.mobs
      .filter((m) => m.boss === "elite")
      .sort((p, q) => Math.hypot(q.x - wlPos.x, q.y - wlPos.y) - Math.hypot(p.x - wlPos.x, p.y - wlPos.y))[0];
    await c.hook("teleportPlayer", { x: elite.x + 3 * TILE, y: elite.y });
    await sleep(1600);
    await c.hook("teleportPlayer", { x: elite.x + 3 * TILE, y: elite.y + TILE });
    await sleep(1300);
    const bossToasts = () => c.events.filter((e) => e.category === "boss").map((e) => e.text);
    st = await c.hook("goalState");
    result(bossToasts().length === 1 && bossToasts()[0].includes("sighted"), `C: one "sighted" toast for the elite: ${JSON.stringify(bossToasts())}`);
    result(st.mobs.find((m) => m.id === elite.id)?.bossSighted === true && !st.mobs.find((m) => m.boss === "warlord").bossSighted,
      `C: elite marked sighted, Warlord not yet`);
    const wl0 = st.mobs.find((m) => m.boss === "warlord");
    await c.hook("teleportPlayer", { x: wl0.x, y: wl0.y + 8 * TILE });
    await sleep(1600);
    result(bossToasts().length === 2 && bossToasts()[1] === "The Ogre Warlord has been sighted at the Castle Ruin", `C: Warlord sighting toast: ${JSON.stringify(bossToasts()[1])}`);
    st = await c.hook("goalState");
    result(st.mobs.every((m) => !m.guardianActive), `C: being seen doesn't wake anything`);

    // ------------------------------------------------------------ D: save / load
    c.send({ type: "saveGame", slot: "slot1" });
    const sr = await c.wait((m) => m.type === "saveResult");
    result(sr.ok, `D: saved slot1`);
    const savedCastle = c.welcome.castleRuin;
    await restart(c);
    st = await c.hook("goalState");
    result(st.goalIndex === 0 && !st.castleCleared, `D: restart resets the goal track (goal ${st.goalIndex + 1})`);
    c.send({ type: "loadGame", slot: "slot1" });
    await c.wait((m) => m.type === "saveResult" && m.action === "load");
    await c.nextSnap();
    st = await c.hook("goalState");
    result(st.goalIndex === 8 && JSON.stringify(c.welcome.castleRuin) === JSON.stringify(savedCastle), `D: load restores goal ${st.goalIndex + 1} and the Castle Ruin at ${JSON.stringify(c.welcome.castleRuin)}`);
    const wlLoaded = st.mobs.find((m) => m.boss === "warlord");
    result(wlLoaded && wlLoaded.maxHp === 990 && wlLoaded.bossSighted === true, `D: Warlord restored (boss, ${wlLoaded?.maxHp} hp, sighted ${wlLoaded?.bossSighted})`);
    await c.nextSnap();
    result(c.snap.goal.index === 8, `D: snapshot.goal after load = ${c.snap.goal.title}`);
    // An "old" save: the same file with every Phase 5 field stripped.
    const file = JSON.parse(readFileSync(path.join(saveDir, "slot1.json"), "utf8"));
    delete file.state.goals;
    delete file.state.castleRuinCenter;
    for (const m of file.state.mobs) {
      delete m.boss;
      delete m.bossSighted;
    }
    writeFileSync(path.join(saveDir, "slot2.json"), JSON.stringify(file));
    c.events.length = 0;
    c.send({ type: "loadGame", slot: "slot2" });
    const lr = await c.wait((m) => m.type === "saveResult" && m.action === "load");
    await c.nextSnap();
    st = await c.hook("goalState");
    result(lr.ok && c.welcome.castleRuin === null, `D: pre-Phase-5 save loads (ok ${lr.ok}, castleRuin ${c.welcome.castleRuin})`);
    result(st.goalIndex === 8 && c.events.every((e) => e.category !== "milestone"), `D: its goal track caught up silently to goal ${st.goalIndex + 1} (milestone toasts: ${c.events.filter((e) => e.category === "milestone").length})`);
    c.send({ type: "loadGame", slot: "slot1" });
    await c.wait((m) => m.type === "saveResult" && m.action === "load");
    await c.nextSnap();

    // ------------------------------------------------------------ E: kills
    st = await c.hook("goalState");
    c.events.length = 0;
    const el2 = st.mobs.find((m) => m.boss === "elite");
    const gold1 = st.stock.gold;
    await c.hook("damageMob", { mobId: el2.id, amount: 1e6 });
    await sleep(200);
    st = await c.hook("goalState");
    const pack = st.mobs.filter((m) => m.siteId === el2.siteId);
    result(!st.mobs.some((m) => m.id === el2.id) && pack.length >= 2 && pack.every((m) => m.guardianActive), `E: elite dead, its ${pack.length} followers awake`);
    const eliteGoldKill = Math.max(3, Math.round((el2.maxHp + el2.damage * 2) / 8));
    result(st.stock.gold - gold1 === 60 + eliteGoldKill, `E: elite pays +${st.stock.gold - gold1} gold (60 bonus + ${eliteGoldKill} kill)`);
    result(bossToasts().some((t) => t.includes("is slain")), `E: slain toast: ${JSON.stringify(bossToasts())}`);
    const wl = st.mobs.find((m) => m.boss === "warlord");
    c.events.length = 0;
    const gold2 = st.stock.gold;
    await c.hook("damageMob", { mobId: wl.id, amount: 1e6 });
    st = await waitGoal(c, (s) => s.goalIndex >= 9, 3000);
    result(st.castleCleared && !st.mobs.some((m) => m.boss === "warlord"), `E: Warlord dead, castleCleared`);
    result(st.mobs.filter((m) => m.siteKind === "castleRuin").every((m) => m.guardianActive), `E: the Castle Ruin's guardians woke`);
    result(st.goalIndex === 9 && st.goal.index === 9 && st.goal.title === "Every goal complete", `E: final goal complete (${st.goal.index}/${st.goal.total} "${st.goal.title}")`);
    const warlordKill = Math.max(3, Math.round((wl.maxHp + wl.damage * 2) / 8));
    result(st.stock.gold - gold2 === 250 + warlordKill + 100, `E: +${st.stock.gold - gold2} gold (250 bonus + ${warlordKill} kill + 100 goal)`);
    info(`E toasts: ${JSON.stringify(c.events.map((e) => `${e.category}: ${e.text}`))}`);
    result(c.events.some((e) => e.category === "boss" && e.text.startsWith("The Ogre Warlord has fallen")) &&
      c.events.some((e) => e.category === "milestone" && e.text.startsWith("Final goal complete: Clear the Castle Ruin")),
      `E: "has fallen" boss toast + final milestone toast`);
    await c.hook("fastForward", { ticks: 2 * cycle });
    st = await c.hook("goalState");
    result(!st.mobs.some((m) => m.boss === "warlord") && st.goalIndex === 9, `E: no Warlord respawn after 2 more days; goal track stays complete`);
    await c.nextSnap();
    result(c.snap.goal.index === 9, `E: snapshot.goal shows completion`);
    c.ws.close();
  }
} catch (err) {
  result(false, `threw: ${err.stack}`);
} finally {
  for (const s of servers) killServer(s);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
