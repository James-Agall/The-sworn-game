// Scripted test: Saint Wren's Abbey (unique world-gen landmark) + Ward Stone (player-built ward).
//   A) the boot world (before any restart or player action) and 10 restarted worlds each have
//      exactly one Abbey: the 9x9 layout around its center, grounds + 1-tile apron otherwise clear,
//      >= 27 tiles from the Town Center, and 3 bishops posted at its hall standing in a row below it.
//      The clergy don't count toward population, fail the client's isCommandable mirror, ignore a
//      live commandMove, and are refused by assignTaskForce.
//   B) the Abbey's permanent ward, live: walk the player inside it and wait for night. With no
//      guards built, an unwarded player is always every mob's first pick; mobs heading for the Town
//      Center instead (and never hurting the player) shows the player was skipped as warded.
//   C) Ward Stone: a Church goes up first (Ward Stones require one); the stone is rejected without
//      10 tools; 3 Blacksmiths make tools, then a Ward Stone costs exactly 20 wood + 10 tools and
//      summons the colony's Ward Priest (a bishop, +1 population) at the Church, who walks to the
//      stone, tends it ("warding") and ignores move orders. Once he has tended it for 10s the ward
//      stands: at night, with the player and Town Center both inside it, night mobs find nothing
//      to target and stand still; TC/player untouched.
//   D) demolishing that Ward Stone (the last one, so the priest is dismissed) lapses the ward: the
//      same mobs start moving. See ward-priest-patrol-test.mjs for patrol/grace-period coverage.
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
const SOLID = new Set(Array.from({ length: 49 }, (_, i) => i + 1).filter((t) => t !== 4));
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
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
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

async function followPath(path, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let i = 1;
  let lastProgress = Date.now();
  let lastPos = a.me();
  while (Date.now() < deadline) {
    const s = await a.nextSnap();
    const me = a.me(s);
    if (i >= path.length) break;
    const target = center(path[i]);
    const ddx = target.x - me.x;
    const ddy = target.y - me.y;
    if (Math.abs(ddx) <= 4 && Math.abs(ddy) <= 4) { i++; continue; }
    if (dist(me, lastPos) > 1) { lastProgress = Date.now(); lastPos = me; }
    if (Date.now() - lastProgress > 1500) {
      const goal = path[path.length - 1];
      const re = bfs(tileOf(me), (t) => t.x === goal.x && t.y === goal.y);
      if (!re) break;
      path = re;
      i = 1;
      lastProgress = Date.now();
      continue;
    }
    a.send({ type: "input", dx: Math.abs(ddx) > 4 ? Math.sign(ddx) : 0, dy: Math.abs(ddy) > 4 ? Math.sign(ddy) : 0 });
  }
  a.send({ type: "input", dx: 0, dy: 0 });
  await a.nextSnap();
  await a.nextSnap();
  return a.me();
}

// Finds the Abbey from the client's tile view: every AbbeyHall tile, the center (hall + 3 rows
// down, per ABBEY_LAYOUT), the clergy posted at the hall, and every layout/grounds mismatch.
function readAbbey(s = a.snap) {
  const halls = [];
  for (let y = 0; y < H(); y++) for (let x = 0; x < W(); x++) if (tileAt(x, y) === T.AbbeyHall) halls.push({ x, y });
  if (halls.length !== 1) return { halls };
  const hall = halls[0];
  const c = { x: hall.x, y: hall.y + 3 };
  const mismatches = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const x = c.x + dx;
    const y = c.y + dy;
    const inLayout = Math.max(Math.abs(dx), Math.abs(dy)) <= 4;
    const want = inLayout ? LAYOUT_TILE[ABBEY_LAYOUT[dy + 4][dx + 4]] : T.Empty;
    if (!inB(x, y) || tileAt(x, y) !== want) mismatches.push(`(${dx},${dy}) got ${inB(x, y) ? tileAt(x, y) : "OOB"} want ${want}`);
  }
  const clergy = s.colonists.filter((k) => k.postX === hall.x && k.postY === hall.y);
  return { halls, hall, center: c, mismatches, clergy };
}

function checkAbbeyWorld(label, s = a.snap) {
  const ab = readAbbey(s);
  if (ab.halls.length !== 1) {
    result(false, `${label}: exactly one AbbeyHall tile (found ${ab.halls.length})`);
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

// ---------------------------------------------------------------- A: Abbey world-gen + clergy
if (ONLY.has("A")) {
  // Boot world first: nothing has been sent yet except the connection itself.
  const boot = checkAbbeyWorld("A boot world (before any player action)");
  if (boot) {
    result(a.snap.population === 0 && a.snap.colonists.length === 3,
      `A boot world: population=${a.snap.population}/${a.snap.populationCap} with ${a.snap.colonists.length} colonists (the 3 clergy don't count)`);
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
    info(`B: walking ${path.length - 1} tiles to (${path[path.length - 1].x},${path[path.length - 1].y}) inside the Abbey ward`);
    const me = await followPath(path);
    const meTile = tileOf(me);
    const dAbbey = dist(me, center(ab.center)) / TILE;
    result(dAbbey <= WARD_RADIUS_TILES - 1, `B: player stands at (${meTile.x},${meTile.y}), ${dAbbey.toFixed(1)} tiles from the Abbey center (ward radius ${WARD_RADIUS_TILES})`);
    // Track night mobs from first sighting.
    const seen = new Map();
    let minPlayerHp = a.me().hp;
    let tcHpAtNight = null;
    const watch = (s) => {
      minPlayerHp = Math.min(minPlayerHp, a.me(s).hp);
      for (const m of s.mobs) {
        if (guardianIds.has(m.id)) continue;
        const e = seen.get(m.id);
        if (!e) seen.set(m.id, { first: { x: m.x, y: m.y }, last: { x: m.x, y: m.y }, kind: m.kind });
        else e.last = { x: m.x, y: m.y };
      }
    };
    a.listeners.push(watch);
    while (!a.snap.isNight) await sleep(200);
    tcHpAtNight = a.snap.townCenterHp;
    info(`B: night fell; watching night mobs for 14s`);
    await sleep(14000);
    a.listeners.splice(a.listeners.indexOf(watch), 1);
    const meNow = a.me();
    const tcPx = center(TC());
    let towardTc = 0;
    let towardPlayer = 0;
    const rows = [];
    for (const [id, e] of seen) {
      const d = dist(e.first, e.last);
      if (d < TILE * 2) { rows.push(`${e.kind} moved ${(d / TILE).toFixed(1)}t`); continue; }
      const gainTc = dist(e.first, tcPx) - dist(e.last, tcPx);
      const gainMe = dist(e.first, meNow) - dist(e.last, meNow);
      // Heading = which goal the mob closed on more, relative to the straight-line distance it covered.
      if (gainTc > gainMe) towardTc++; else towardPlayer++;
      rows.push(`${e.kind} moved ${(d / TILE).toFixed(1)}t, closed ${(gainTc / TILE).toFixed(1)}t on TC vs ${(gainMe / TILE).toFixed(1)}t on player`);
    }
    info(`B: night mobs: ${rows.join("; ")}`);
    result(seen.size >= 2 && towardTc >= 1 && towardPlayer === 0,
      `B: ${seen.size} night mobs; of those that moved >=2 tiles, ${towardTc} headed for the Town Center and ${towardPlayer} for the player (an unwarded player would be every mob's first pick)`);
    result(minPlayerHp === 100, `B: player inside the Abbey ward never took damage (min hp ${minPlayerHp})`);
    info(`B: Town Center hp ${tcHpAtNight} -> ${a.snap.townCenterHp} (unwarded, so it may be hit)`);
  }
}

// ---------------------------------------------------------------- C/D: Ward Stone
if (ONLY.has("C")) {
  await restart();
  const guardianIds = new Set(a.snap.mobs.map((m) => m.id));
  const meT = tileOf(a.me());
  const mePx = a.me();
  // Empty tiles within the server's 2.5-tile reach of the player (nobody standing on them).
  const reach = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const t = { x: meT.x + dx, y: meT.y + dy };
    if ((dx === 0 && dy === 0) || !inB(t.x, t.y) || tileAt(t.x, t.y) !== T.Empty) continue;
    if (dist(center(t), mePx) > TILE * 2.5) continue;
    reach.push(t);
  }
  const adj4 = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  const sameT = (p, q) => p.x === q.x && p.y === q.y;
  // Blacksmiths must not be 4-adjacent to each other (that would level one up instead of adding a
  // second worker). 3, not 4: the Church's 15 wood has to fit in the 80 starting wood too.
  const smiths = [];
  for (const t of reach) {
    if (smiths.length < 3 && !smiths.some((s) => adj4(s, t))) smiths.push(t);
  }
  const rest = reach.filter((t) => !smiths.some((s) => sameT(s, t)));
  const stone = rest[0];
  const church = rest.find((t) => stone && !sameT(t, stone) && !adj4(t, stone));
  if (smiths.length < 3 || !stone || !church) {
    result(false, `C: not enough free tiles in reach (smiths=${smiths.length}, stone=${!!stone}, church=${!!church})`);
  } else {
    a.send({ type: "setTile", tileX: church.x, tileY: church.y, tile: T.ChurchPost });
    await sleep(400);
    result(tileAt(church.x, church.y) === T.ChurchPost, `C: Church placed at (${church.x},${church.y}); wood=${a.snap.wood}`);
    // Rejected without tools.
    const w0 = a.snap.wood;
    const tools0 = a.snap.tools;
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.WardStone });
    await sleep(400);
    result(tileAt(stone.x, stone.y) === T.Empty && a.snap.wood === w0 && a.snap.colonists.filter((k) => k.kind === "bishop").length === 4,
      `C: Ward Stone with tools=${tools0} (<10) and wood=${w0} is rejected: tile ${tileAt(stone.x, stone.y)}, wood ${a.snap.wood}, bishops ${a.snap.colonists.filter((k) => k.kind === "bishop").length} (3 Abbey clergy + the Church's)`);

    for (const t of smiths) a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile: T.Blacksmith });
    await sleep(400);
    result(smiths.every((t) => tileAt(t.x, t.y) === T.Blacksmith), `C: 3 Blacksmiths placed at ${smiths.map((t) => `(${t.x},${t.y})`).join(" ")}; wood=${a.snap.wood} iron=${a.snap.iron}`);
    const deadline = Date.now() + 40000;
    while (a.snap.tools < 10 && Date.now() < deadline) await sleep(200);
    info(`C: tools=${a.snap.tools} wood=${a.snap.wood} isNight=${a.snap.isNight}`);
    for (const t of smiths) a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile: T.Empty });
    await sleep(400);

    const before = { wood: a.snap.wood, tools: a.snap.tools, pop: a.snap.population };
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.WardStone });
    await a.nextSnap();
    await a.nextSnap();
    const warder = a.snap.colonists.find((k) => k.postX === stone.x && k.postY === stone.y);
    result(tileAt(stone.x, stone.y) === T.WardStone && a.snap.wood === before.wood - 20 && a.snap.tools === before.tools - 10,
      `C: Ward Stone placed at (${stone.x},${stone.y}); wood ${before.wood}->${a.snap.wood} (-20), tools ${before.tools}->${a.snap.tools} (-10)`);
    result(warder?.kind === "bishop" && a.snap.population === before.pop + 1 && dist(warder, center(church)) <= TILE * 1.6,
      `C: it summoned a Ward Priest (${warder?.kind}, post = the stone) ${warder ? (dist(warder, center(church)) / TILE).toFixed(2) : "?"} tiles from the Church (population ${before.pop}->${a.snap.population}, +1)`);
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
        if (guardianIds.has(m.id)) continue;
        const e = seen.get(m.id);
        if (!e) seen.set(m.id, { first: { x: m.x, y: m.y }, firstAt: Date.now(), last: { x: m.x, y: m.y }, kind: m.kind });
        else e.last = { x: m.x, y: m.y };
      }
    };
    a.listeners.push(watch);
    while (!a.snap.isNight) await sleep(200);
    const tcHp0 = a.snap.townCenterHp;
    info(`C: night fell; watching for 12s with the ward up`);
    await sleep(12000);
    const wardedRows = [...seen.values()].map((e) => `${e.kind} ${(dist(e.first, e.last) / TILE).toFixed(2)}t over ${((Date.now() - e.firstAt) / 1000).toFixed(1)}s`);
    const stillAll = [...seen.values()].every((e) => dist(e.first, e.last) < 0.01);
    result(seen.size >= 2 && stillAll && a.snap.townCenterHp === tcHp0 && minPlayerHp === 100,
      `C: ward up — ${seen.size} night mobs, all standing still at spawn (${wardedRows.join("; ")}); TC hp ${tcHp0}->${a.snap.townCenterHp}; player min hp ${minPlayerHp}`);

    // D: demolish the stone (and with it, its bishop) -> ward lapses -> the same mobs engage.
    const stillPresent = [...seen.keys()].filter((id) => a.snap.mobs.some((m) => m.id === id));
    const lapseStart = new Map(a.snap.mobs.filter((m) => stillPresent.includes(m.id)).map((m) => [m.id, { x: m.x, y: m.y }]));
    a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.Empty });
    await sleep(500);
    result(tileAt(stone.x, stone.y) === T.Empty && !a.snap.colonists.some((k) => k.id === w1.id),
      `D: Ward Stone demolished: tile ${tileAt(stone.x, stone.y)}, Ward Priest dismissed (no stones left)=${!a.snap.colonists.some((k) => k.id === w1.id)}`);
    await sleep(3500);
    const moved = a.snap.mobs.filter((m) => lapseStart.has(m.id) && dist(m, lapseStart.get(m.id)) > TILE);
    result(lapseStart.size >= 1 && moved.length === lapseStart.size,
      `D: ward lapsed — ${moved.length}/${lapseStart.size} of the previously idle night mobs started moving within 4s (${a.snap.mobs.filter((m) => lapseStart.has(m.id)).map((m) => `${m.kind} ${(dist(m, lapseStart.get(m.id)) / TILE).toFixed(1)}t`).join(", ")})`);
    a.listeners.splice(a.listeners.indexOf(watch), 1);
  }
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
