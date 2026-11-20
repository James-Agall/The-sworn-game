// Scripted test: Saint Wren's Abbey (unique world-gen landmark) + Ward Stone (player-built ward).
//   A) the boot world (before any restart or player action) and 10 restarted worlds each have
//      exactly one Abbey: the 9x9 layout around its center, grounds + 1-tile apron otherwise clear,
//      >= 27 tiles from the Town Center, and 3 bishops posted at its hall standing in a row below it.
//      The clergy don't count toward population, fail the client's isCommandable mirror, ignore a
//      live commandMove, and are refused by assignTaskForce.
//   B) the Abbey's permanent ward, live: walk the player inside it and spawn orcs beside him: none picks him as its
//      target and he takes no damage; the same orc beside him outside every ward does target him (control).
//   C) Ward Stone: a Church goes up first (Ward Stones require one); the stone is rejected without
//      10 tools; with 10 tools (setStock hook) a Ward Stone costs exactly 20 wood + 10 tools and
//      summons the colony's Ward Priest (a bishop: a free villager taking the post by day, so population is
//      unchanged) at the Church, who walks to the stone, tends it ("warding") and ignores move orders. Once he has
//      tended it for 10s the ward stands: at night, with the player and Town Center both inside it, no raid mob
//      targets either (village buildings outside the ward are still fair targets); TC/player untouched.
//   D) demolishing that Ward Stone (the last one, so the priest is dismissed) lapses the ward: the Town Center is
//      a target again. See ward-priest-patrol-test.mjs for patrol/grace-period coverage.
// No real-time waiting for nights: B uses spawned mobs, C jumps the clock to ~20 s before dusk (skipToDusk).
// Each section starts with a "restart" (except A's boot-world check). Resets the world for every
// connected client. Select sections with ONLY=A,B,C (C includes D). Needs a fresh server for A's
// boot-world check to mean "before any player action".
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "A,B,C").split(","));
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`     [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;

// Mirrors of protocol.ts / index.ts values used here.
const T = {
  Empty: 0, ChurchPost: 20, Blacksmith: 26, RuinStatue: 39, PropFence: 45,
  AbbeyHall: 46, PropCross: 47, PropLanternPost: 48, WardStone: 49,
};
// isSolidTile: every TileType except Empty (0) and FarmPlot (4).
// + 50/51 (Hunter's/Forager's Hut) and 54/55 (fruit tree, ripe/picked); berry bushes and mushrooms are walkable.
const SOLID = new Set([...Array.from({ length: 49 }, (_, i) => i + 1).filter((t) => t !== 4), 50, 51, 54, 55]);
const ABBEY_LAYOUT = [
  "FFFFFFFFF",
  "F.L.H.L.F",
  "F.......F",
  "F......XF",
  "F...S...F",
  "F......XF",
  "F.......F",
  "F..L.L.XF",
  "FFFF.FFFF",
];
const LAYOUT_TILE = { F: T.PropFence, H: T.AbbeyHall, S: T.RuinStatue, X: T.PropCross, L: T.PropLanternPost, ".": T.Empty };
const WARD_RADIUS_TILES = 12;
const COMMANDABLE = new Set(["knight", "archer", "bishop", "militia", "spearman", "pikeman"]);

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [], hooks: new Map(), events: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    } else if (m.type === "event") {
      c.events.push(m.text);
    } else if (m.type === "testHookResult") {
      c.hooks.set(m.op, m);
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      for (const fn of c.listeners.slice()) fn(m, prev);
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = (s = c.snap) => s.players.find((p) => p.id === c.welcome.id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.hook = async (op, args = {}) => {
    c.hooks.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 200 && !c.hooks.has(op); i++) await sleep(25);
    return c.hooks.get(op);
  };
  c.nextSnap = () => new Promise((r) => { const fn = (s) => { c.listeners.splice(c.listeners.indexOf(fn), 1); r(s); }; c.listeners.push(fn); });
  return c;
}

const a = connect();
await a.ready();
const W = () => a.welcome.worldTilesX;
const H = () => a.welcome.worldTilesY;
const idx = (x, y) => y * W() + x;
const tileAt = (x, y) => a.tiles[idx(x, y)];
const inB = (x, y) => x >= 0 && y >= 0 && x < W() && y < H();
const walkable = (x, y) => inB(x, y) && !SOLID.has(tileAt(x, y));
const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
const center = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const TC = () => ({ x: Math.floor(W() / 2), y: Math.floor(H() / 2) });
// Client main.ts isCommandable mirror.
const isCommandable = (c) => COMMANDABLE.has(c.kind) && (c.kind !== "bishop" || tileAt(c.postX, c.postY) === T.ChurchPost);

async function restart() {
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.nextSnap();
  await a.nextSnap();
  if (a.snap.isPaused) a.send({ type: "pause" });
  a.send({ type: "input", dx: 0, dy: 0 });
}

function bfs(start, goalFn) {
  const prev = new Map([[idx(start.x, start.y), null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (goalFn(cur)) {
      const path = [];
      let t = cur;
      while (t) { path.unshift(t); t = prev.get(idx(t.x, t.y)); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!walkable(n.x, n.y) || prev.has(idx(n.x, n.y))) continue;
      prev.set(idx(n.x, n.y), cur);
      q.push(n);
    }
  }
  return null;
}

// Finds the Abbey from the client's tile view: every AbbeyHall tile, the center (hall + 3 rows
// down, per ABBEY_LAYOUT), the clergy posted at the hall, and every layout/grounds mismatch.
// NPC "Abbey village" settlements (settlements/village-abbey.json) also stamp an AbbeyHall tile (no clergy, a
// different layout), so the landmark is the hall whose 9x9 surroundings match ABBEY_LAYOUT.
function readAbbey(s = a.snap) {
  const halls = [];
  for (let y = 0; y < H(); y++) for (let x = 0; x < W(); x++) if (tileAt(x, y) === T.AbbeyHall) halls.push({ x, y });
  const mismatchesAt = (hall) => {
    const c = { x: hall.x, y: hall.y + 3 };
    const mismatches = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      const inLayout = Math.max(Math.abs(dx), Math.abs(dy)) <= 4;
      const want = inLayout ? LAYOUT_TILE[ABBEY_LAYOUT[dy + 4][dx + 4]] : T.Empty;
      if (!inB(x, y) || tileAt(x, y) !== want) mismatches.push(`(${dx},${dy}) got ${inB(x, y) ? tileAt(x, y) : "OOB"} want ${want}`);
    }
    return mismatches;
  };
  const landmarks = halls.filter((h) => mismatchesAt(h).length === 0);
  if (halls.length === 0 || landmarks.length > 1) return { halls };
  const hall = landmarks[0] ?? halls.find((h) => s.colonists.some((k) => k.postX === h.x && k.postY === h.y)) ?? halls[0];
  const c = { x: hall.x, y: hall.y + 3 };
  const mismatches = mismatchesAt(hall);
  const clergy = s.colonists.filter((k) => k.postX === hall.x && k.postY === hall.y);
  return { halls, hall, center: c, mismatches, clergy };
}

function checkAbbeyWorld(label, s = a.snap) {
  const ab = readAbbey(s);
  if (!ab.hall) {
    result(false, `${label}: exactly one landmark Abbey (AbbeyHall tiles found ${ab.halls.length})`);
    return null;
  }
  const tcDist = Math.hypot(ab.center.x - TC().x, ab.center.y - TC().y);
  const offsets = ab.clergy.map((k) => `(${(k.x - center(ab.center).x) / TILE},${(k.y - center(ab.center).y) / TILE})`).sort().join(" ");
  const ok =
    ab.mismatches.length === 0 &&
    tcDist >= 27 &&
    ab.clergy.length === 3 &&
    ab.clergy.every((k) => k.kind === "bishop") &&
    offsets === "(-1,-2) (0,-2) (1,-2)" &&
    s.colonists.filter((k) => k.kind === "bishop").length === 3;
  result(ok, `${label}: one Abbey centered (${ab.center.x},${ab.center.y}), hall (${ab.hall.x},${ab.hall.y}), ${tcDist.toFixed(1)} tiles from TC (>=27); layout+apron mismatches=${ab.mismatches.length}${ab.mismatches.length ? " " + ab.mismatches.slice(0, 4).join("; ") : ""}; clergy=${ab.clergy.length} ${ab.clergy.map((k) => k.kind).join("/")} at offsets ${offsets}; total bishops in world=${s.colonists.filter((k) => k.kind === "bishop").length}`);
  return ab;
}

// Days are 300 s + 75 s nights, so no waiting: raid mobs spawn (passive) at the day's midpoint, so jump to just past
// it (day 20 so the raid is big enough to judge), give them a moment to appear, then jump to ~20 s before dusk. Do it
// BEFORE the Ward Stone goes up: a ward lapses WARD_GRACE_TICKS after the priest's last tending, so a clock jump while
// it stands would lapse it.
async function skipToDusk(day = 20) {
  const rs = await a.hook("raidState");
  const cycle = rs.dayTicks + rs.nightTicks;
  await a.hook("setCycleTick", { tick: day * cycle + Math.floor(rs.dayTicks / 2) - 3 });
  await sleep(1500);
  await a.hook("setCycleTick", { tick: day * cycle + rs.dayTicks - 400 });
}

// ---------------------------------------------------------------- A: Abbey world-gen + clergy
if (ONLY.has("A")) {
  // Boot world first: nothing has been sent yet except the connection itself.
  const boot = checkAbbeyWorld("A boot world (before any player action)");
  if (boot) {
    // Village life: the colony starts with its villagers; the 3 Abbey clergy are colonists too but don't count.
    result(a.snap.population >= 1 && a.snap.colonists.length === a.snap.population + 3,
      `A boot world: population=${a.snap.population}/${a.snap.populationCap} with ${a.snap.colonists.length} colonists (the villagers + 3 clergy, who don't count)`);
    result(boot.clergy.every((k) => !isCommandable(k)),
      `A clergy fail the client's isCommandable (kind bishop, but posted at AbbeyHall not ChurchPost): ${boot.clergy.map((k) => isCommandable(k)).join(",")}`);
  }
  for (let i = 1; i <= 10; i++) {
    await restart();
    checkAbbeyWorld(`A restart #${i}`);
  }

  const ab = readAbbey();
  if (ab.clergy) {
    const ids = ab.clergy.map((k) => k.id);
    const before = new Map(ab.clergy.map((k) => [k.id, { x: k.x, y: k.y, state: k.state }]));
    await sleep(1500);
    const idle = a.snap.colonists.filter((k) => ids.includes(k.id));
    result(idle.every((k) => dist(k, before.get(k.id)) < 0.01),
      `A clergy hold their places over 1.5s with nobody to heal (states ${idle.map((k) => k.state).join(",")})`);
    const goal = center(TC());
    a.send({ type: "commandMove", unitIds: ids, x: goal.x, y: goal.y });
    a.send({ type: "assignTaskForce", slot: 1, unitIds: ids });
    await sleep(2500);
    const after = a.snap.colonists.filter((k) => ids.includes(k.id));
    result(after.length === 3 && after.every((k) => dist(k, before.get(k.id)) < 0.01),
      `A live commandMove to the Town Center is ignored by the server: clergy moved ${after.map((k) => (dist(k, before.get(k.id)) / TILE).toFixed(2)).join(",")} tiles in 2.5s`);
    result(a.snap.taskForces["1"] === undefined,
      `A assignTaskForce(slot 1, clergy) is refused: taskForces=${JSON.stringify(a.snap.taskForces)}`);
  }
}

// ---------------------------------------------------------------- B: Abbey's permanent ward (live)
if (ONLY.has("B")) {
  await restart();
  const ab = readAbbey();
  const guardianIds = new Set(a.snap.mobs.map((m) => m.id));
  const path = ab.center ? bfs(tileOf(a.me()), (t) => Math.hypot(t.x - ab.center.x, t.y - ab.center.y) <= 7) : null;
  if (!path) {
    result(false, "B: no walkable route into the Abbey's ward");
  } else {
    info(`B: going to (${path[path.length - 1].x},${path[path.length - 1].y}) inside the Abbey ward`);
    // Teleport to the end of the walkable route (a 50-70 tile walk can snag on trees; the walk isn't what is tested).
    await a.hook("teleportPlayer", { x: center(path[path.length - 1]).x, y: center(path[path.length - 1]).y });
    await a.nextSnap();
    await a.nextSnap();
    const me = a.me();
    const meTile = tileOf(me);
    const dAbbey = dist(me, center(ab.center)) / TILE;
    result(dAbbey <= WARD_RADIUS_TILES - 1, `B: player stands at (${meTile.x},${meTile.y}), ${dAbbey.toFixed(1)} tiles from the Abbey center (ward radius ${WARD_RADIUS_TILES})`);
    // Rule under test: a warded player is never a mob's target. (Mobs only go for a player within their aggro range,
    // so raid mobs marching in from the map edge say nothing: put a mob right beside him instead.)
    await a.hook("setRaids", { enabled: false });
    const mobTargets = async (ids) => (await a.hook("bodyState")).mobs.filter((m) => ids.includes(m.id)).map((m) => m.targetType);
    const spawnBeside = async (px) => {
      const t = tileOf(px);
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) {
        if (!walkable(t.x + dx, t.y + dy)) continue;
        const r = await a.hook("spawnMob", { kind: "orc", tx: t.x + dx, ty: t.y + dy });
        if (r.id) return r.id;
      }
      return null;
    };
    const hpInWard = a.me().hp;
    const inside = [await spawnBeside(me), await spawnBeside(me)].filter(Boolean);
    await sleep(4000);
    const insideTargets = await mobTargets(inside);
    result(inside.length >= 1 && insideTargets.every((t) => t !== "player") && a.me().hp === hpInWard,
      `B: ${inside.length} orcs spawned beside the player inside the Abbey ward: targets ${insideTargets.join(",")} (none may be "player"), player hp ${hpInWard} -> ${a.me().hp}`);
    // Control: the same orc beside the player OUTSIDE every ward does pick him.
    const out = bfs(tileOf(a.me()), (t) => Math.hypot(t.x - ab.center.x, t.y - ab.center.y) >= WARD_RADIUS_TILES + 8);
    if (!out) {
      result(false, "B: no walkable tile outside the ward for the control");
    } else {
      const spot = out[out.length - 1];
      await a.hook("teleportPlayer", { x: center(spot).x, y: center(spot).y });
      await a.nextSnap();
      await a.nextSnap();
      const control = await spawnBeside(a.me());
      await sleep(3000);
      const controlTargets = await mobTargets(control ? [control] : []);
      result(controlTargets.length === 1 && controlTargets[0] === "player",
        `B: control, outside the ward at (${spot.x},${spot.y}): the orc beside the player targets ${controlTargets.join(",") || "nothing (not spawned)"} (must be "player")`);
    }
  }
}

// ---------------------------------------------------------------- C/D: Ward Stone
if (ONLY.has("C")) {
  await restart();
  const guardianIds = new Set(a.snap.mobs.map((m) => m.id));
  await a.hook("setRaids", { enabled: true }); // B turned them off (the flag survives a restart)
  await skipToDusk();
  // Stand on open ground near the Town Center (a 5x5 patch of empty tiles, 5-9 tiles away): the spawn point can be
  // hemmed in by houses and fields.
  {
    let spot = null;
    for (let r = 5; r <= 9 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const t = { x: TC().x + dx, y: TC().y + dy };
      let open = true;
      for (let y = -2; y <= 2 && open; y++) for (let x = -2; x <= 2; x++) if (!inB(t.x + x, t.y + y) || tileAt(t.x + x, t.y + y) !== T.Empty) { open = false; break; }
      if (open) spot = t;
    }
    if (spot) {
      await a.hook("teleportPlayer", { x: center(spot).x, y: center(spot).y });
      await a.nextSnap();
      await a.nextSnap();
    }
  }
  const meT = tileOf(a.me());
  const mePx = a.me();
  // Empty tiles within the server's 2.5-tile reach of the player (nobody standing on them).
  const reach = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const t = { x: meT.x + dx, y: meT.y + dy };
    if ((dx === 0 && dy === 0) || !inB(t.x, t.y) || tileAt(t.x, t.y) !== T.Empty) continue;
    if (dist(center(t), mePx) > TILE * 2.5) continue;
    // Villagers mill about the Town Center and the server silently refuses a tile somebody stands on.
    if (a.snap.colonists.some((k) => dist(center(t), k) < TILE * 1.2)) continue;
    reach.push(t);
  }
  const adj4 = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  const sameT = (p, q) => p.x === q.x && p.y === q.y;
  const rest = reach;
  const stone = rest[0];
  const church = rest.find((t) => stone && !sameT(t, stone) && !adj4(t, stone));
  if (!stone || !church) {
    result(false, `C: not enough free tiles in reach (stone=${!!stone}, church=${!!church})`);
  } else {
    for (let i = 0; i < 5 && tileAt(church.x, church.y) !== T.ChurchPost; i++) {
      a.send({ type: "setTile", tileX: church.x, tileY: church.y, tile: T.ChurchPost });
      await sleep(400);
    }
    result(tileAt(church.x, church.y) === T.ChurchPost, `C: Church placed at (${church.x},${church.y}); wood=${a.snap.wood}`);
    // Rejected without tools.
    const w0 = a.snap.wood;
    const tools0 = a.snap.tools;
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.WardStone });
    await sleep(400);
    result(tileAt(stone.x, stone.y) === T.Empty && a.snap.wood === w0 && a.snap.colonists.filter((k) => k.kind === "bishop").length === 4,
      `C: Ward Stone with tools=${tools0} (<10) and wood=${w0} is rejected: tile ${tileAt(stone.x, stone.y)}, wood ${a.snap.wood}, bishops ${a.snap.colonists.filter((k) => k.kind === "bishop").length} (3 Abbey clergy + the Church's)`);

    // The tools come from the stock hook (the Blacksmith economy is covered by its own tests).
    await a.hook("setStock", { stock: { tools: 10 } });
    await a.nextSnap();
    await a.nextSnap();
    info(`C: tools=${a.snap.tools} wood=${a.snap.wood} isNight=${a.snap.isNight}`);

    const before = { wood: a.snap.wood, tools: a.snap.tools, pop: a.snap.population, ev: a.events.length };
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.WardStone });
    await a.nextSnap();
    await a.nextSnap();
    const warder = a.snap.colonists.find((k) => k.postX === stone.x && k.postY === stone.y);
    // The priest taking his post completes the "Assign a worker" goal (+20 wood ...): count goal rewards out of the delta.
    const rewardWood = a.events.slice(before.ev).filter((e) => /^Goal complete/.test(e)).reduce((n, e) => n + Number(/\+(\d+) wood/.exec(e)?.[1] ?? 0), 0);
    result(tileAt(stone.x, stone.y) === T.WardStone && a.snap.wood === before.wood - 20 + rewardWood && a.snap.tools === before.tools - 10,
      `C: Ward Stone placed at (${stone.x},${stone.y}); wood ${before.wood}->${a.snap.wood} (-20, +${rewardWood} goal reward), tools ${before.tools}->${a.snap.tools} (-10)`);
    result(warder?.kind === "bishop" && a.snap.population === before.pop,
      `C: it summoned a Ward Priest (${warder?.kind}, post = the stone; population ${before.pop}->${a.snap.population}, unchanged: a villager took the post)`);
    {
      const deadline2 = Date.now() + 15000;
      while (Date.now() < deadline2 && a.snap.colonists.find((k) => k.id === warder?.id)?.state !== "warding") await sleep(50);
    }
    const w1 = a.snap.colonists.find((k) => k.id === warder?.id);
    const wardingSince = Date.now();
    result(w1?.state === "warding" && dist(w1, center(stone)) <= TILE * 1.5,
      `C: the Ward Priest walked over and is in state "${w1?.state}", ${(dist(w1, center(stone)) / TILE).toFixed(2)} tiles from the stone; client isCommandable=${w1 && isCommandable(w1)}`);
    const wPos = { x: w1.x, y: w1.y };
    a.send({ type: "commandMove", unitIds: [w1.id], x: center(TC()).x + TILE * 6, y: center(TC()).y });
    await sleep(1500);
    const w2 = a.snap.colonists.find((k) => k.id === w1.id);
    result(dist(w2, wPos) < 0.01 && w2.state === "warding", `C: a move order doesn't pull him off his watch (moved ${(dist(w2, wPos) / TILE).toFixed(2)} tiles, state ${w2.state})`);

    const dTc = dist(center(stone), center(TC())) / TILE;
    const dMe = dist(center(stone), a.me()) / TILE;
    info(`C: Town Center ${dTc.toFixed(1)} and player ${dMe.toFixed(1)} tiles from the stone (radius ${WARD_RADIUS_TILES}); no guards exist`);

    // The ward only stands once he has finished his first 10s tending (200 ticks), plus margin.
    await sleep(Math.max(0, 11000 - (Date.now() - wardingSince)));
    // Night: every possible target (player, Town Center) is warded, so night mobs pick nothing.
    const seen = new Map();
    let minPlayerHp = 100;
    const watch = (s) => {
      minPlayerHp = Math.min(minPlayerHp, a.me(s).hp);
      for (const m of s.mobs) {
        // Forts phase C: a settlement's folk (town* kinds: workers walking home at night) are not raiders.
        if (guardianIds.has(m.id) || m.kind.startsWith("town")) continue;
        const e = seen.get(m.id);
        if (!e) seen.set(m.id, { first: { x: m.x, y: m.y }, firstAt: Date.now(), last: { x: m.x, y: m.y }, kind: m.kind });
        else e.last = { x: m.x, y: m.y };
      }
    };
    a.listeners.push(watch);
    while (!a.snap.isNight) await sleep(100);
    // Raid mobs spawn passive at the day's midpoint and loiter until they turn aggressive (by
    // nightfall at the latest), so stillness is measured from nightfall.
    for (const e of seen.values()) {
      e.first = { ...e.last };
      e.firstAt = Date.now();
    }
    const tcHp0 = a.snap.townCenterHp;
    info(`C: night fell; watching for 12s with the ward up`);
    await sleep(12000);
    // Village life: the colony has buildings outside the ward's 12 tiles (houses, fields), which raid mobs rightly
    // march for, so "standing still" is stale. The rule is that nothing warded is picked: no mob targets the Town
    // Center or the player, the Town Center is untouched and the player takes no damage.
    const targetsOf = async () => (await a.hook("bodyState")).mobs.filter((m) => seen.has(m.id)).map((m) => m.targetType);
    const wardedTargets = await targetsOf();
    result(seen.size >= 2 && wardedTargets.every((t) => t !== "townCenter" && t !== "player") && a.snap.townCenterHp === tcHp0 && minPlayerHp === 100,
      `C: ward up — ${seen.size} night mobs, targets ${[...new Set(wardedTargets)].join(",")} (none may be townCenter / player); TC hp ${tcHp0}->${a.snap.townCenterHp}; player min hp ${minPlayerHp}`);

    // D: demolish the stone (and with it, its priest, who goes back to the village) -> ward lapses -> the Town Center
    // is a target again.
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.Empty });
    await sleep(500);
    result(tileAt(stone.x, stone.y) === T.Empty && !a.snap.colonists.some((k) => k.id === w1.id && k.kind === "bishop"),
      `D: Ward Stone demolished: tile ${tileAt(stone.x, stone.y)}, Ward Priest dismissed (no stones left)=${!a.snap.colonists.some((k) => k.id === w1.id && k.kind === "bishop")}`);
    await sleep(3500);
    // Raid mobs already marching keep going for whatever building they picked, so judge the rule with a fresh orc
    // right beside the Town Center: it must pick the Town Center now that nothing wards it.
    const tcT = TC();
    let probe = null;
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3]]) {
      if (!walkable(tcT.x + dx, tcT.y + dy)) continue;
      probe = (await a.hook("spawnMob", { kind: "orc", tx: tcT.x + dx, ty: tcT.y + dy })).id;
      if (probe) break;
    }
    await sleep(3000);
    const probeTarget = (await a.hook("bodyState")).mobs.find((m) => m.id === probe)?.targetType;
    result(probeTarget === "townCenter" || probeTarget === "player",
      `D: ward lapsed — an orc spawned beside the Town Center (and the player) targets ${probeTarget ?? "nothing (not spawned)"} (must be "townCenter" or "player": both are unwarded again)`);
    a.listeners.splice(a.listeners.indexOf(watch), 1);
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
