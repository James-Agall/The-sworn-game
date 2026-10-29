// Scripted test: boot world size, starting stock, ore-only mine placement + revert-on-break,
// Town Center immunity, and player melee (friendly fire + 0.5s cooldown).
// Sections can be limited with ONLY=a,b,c,d,e (default) plus the slow night checks f (civilians
// shelter in houses first and at the TC only when there are no free beds - this test builds no houses, so
// everyone uses the TC - + mob priority, add STATIC=1 to skip walking) and g2 (TC attacked when no
// players are connected). Sections c, e and walking-f need a server where players can actually
// walk away from spawn and no other players are connected.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "a,b,c,d,e").split(","));
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Wall: 1, IronOre: 7, Rock: 8, IronMine: 9, RockMine: 10, TownCenter: 12 };
const SOLID = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
const TILE = 32;
const REACH = TILE * 2.5;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, firstSnap: null, tiles: [], tileUpdates: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      if (!c.firstSnap) c.firstSnap = m;
      c.snap = m;
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, prev: c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX], at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H() && !SOLID.has(c.tileAt(x, y));
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

// BFS over walkable tiles from the player's current tile; returns parent map + dist map.
function bfs(c) {
  const me = c.me();
  const start = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };
  const key = (x, y) => y * c.W() + x;
  const dist = new Map([[key(start.x, start.y), 0]]);
  const parent = new Map();
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!c.walkable(n.x, n.y) || dist.has(key(n.x, n.y))) continue;
      dist.set(key(n.x, n.y), dist.get(key(cur.x, cur.y)) + 1);
      parent.set(key(n.x, n.y), cur);
      q.push(n);
    }
  }
  return { start, dist, parent, key };
}

function pathTo(c, goal) {
  const { start, dist, parent, key } = bfs(c);
  if (!dist.has(key(goal.x, goal.y))) return null;
  const path = [];
  let cur = goal;
  while (!(cur.x === start.x && cur.y === start.y)) {
    path.unshift(cur);
    cur = parent.get(key(cur.x, cur.y));
  }
  return path;
}

// Axis-aligned steering along tile centres (one axis at a time, 4px tolerance).
async function walkPath(c, path, timeoutMs = 20000) {
  const since = Date.now();
  for (const wp of path) {
    const cx = wp.x * TILE + TILE / 2;
    const cy = wp.y * TILE + TILE / 2;
    for (;;) {
      if (Date.now() - since > timeoutMs) {
        c.send({ type: "input", dx: 0, dy: 0 });
        return false;
      }
      const me = c.me();
      const ex = cx - me.x;
      const ey = cy - me.y;
      let dx = 0, dy = 0;
      if (Math.abs(ex) > 4) dx = Math.sign(ex);
      else if (Math.abs(ey) > 4) dy = Math.sign(ey);
      else break;
      c.send({ type: "input", dx, dy });
      await sleep(25);
    }
  }
  c.send({ type: "input", dx: 0, dy: 0 });
  await sleep(150);
  return true;
}

// Find a reachable walkable tile adjacent to (tx,ty), nearest by walking distance.
function approachFor(c, tx, ty) {
  const { dist, key } = bfs(c);
  let best = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = { x: tx + dx, y: ty + dy };
    const d = dist.get(key(n.x, n.y));
    if (d !== undefined && (!best || d < best.d)) best = { ...n, d };
  }
  return best;
}

async function setTileAndWatch(c, x, y, tile, waitMs = 600) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.tileX === x && u.tileY === y && u.at >= since);
}

const a = connect();
await a.ready();
console.log(`[${el()}] connected on :${PORT}; players=${a.snap.players.length} me=(${a.me().x},${a.me().y})`);
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };

if (ONLY.has("a")) {
  // The boot size is COLONY_WORLD_SIZE, else DEFAULT_WORLD_TILES (160); the Town Center sits at the centre.
  const WANT = Number(process.env.COLONY_WORLD_SIZE ?? 160);
  result(a.welcome.worldTilesX === WANT && a.welcome.worldTilesY === WANT,
    `(a) welcome world size ${a.welcome.worldTilesX}x${a.welcome.worldTilesY} (expected ${WANT}x${WANT})`);
  result(a.welcome.tiles.length === WANT * WANT && a.tileAt(TC.x, TC.y) === T.TownCenter,
    `(a) tiles.length=${a.welcome.tiles.length}; tile at (${TC.x},${TC.y}) = ${a.tileAt(TC.x, TC.y)} (expected TownCenter=12)`);
  const counts = { tree: 0, iron: 0, rock: 0 };
  for (const t of a.welcome.tiles) {
    if (t === 2) counts.tree++;
    if (t === 7) counts.iron++;
    if (t === 8) counts.rock++;
  }
  console.log(`[${el()}] (a) info: welcome tile counts trees=${counts.tree} ironOre=${counts.iron} rock=${counts.rock} (seeded 24/14/16; trees may have regrown if server is older)`);
}

if (ONLY.has("b")) {
  const { wood, grain, iron, rock, townCenterHp, townCenterMaxHp } = a.firstSnap;
  result(wood === 80 && grain === 60 && iron === 60 && rock === 60,
    `(b) first snapshot stock wood=${wood} grain=${grain} iron=${iron} rock=${rock} (expected 80/60/60/60)`);
  result(townCenterHp === 1000 && townCenterMaxHp === 1000,
    `(b) townCenterHp=${townCenterHp} townCenterMaxHp=${townCenterMaxHp} (expected 1000/1000: Town Center Lv1)`);
}

if (ONLY.has("d")) {
  const meT = { x: Math.floor(a.me().x / TILE), y: Math.floor(a.me().y / TILE) };
  const d = Math.hypot(a.me().x - (TC.x * TILE + 16), a.me().y - (TC.y * TILE + 16));
  console.log(`[${el()}] (d) player tile (${meT.x},${meT.y}), ${d.toFixed(1)}px from TC centre (reach ${REACH})`);
  const placeTc = await setTileAndWatch(a, TC.x, TC.y, T.TownCenter);
  const breakTc = await setTileAndWatch(a, TC.x, TC.y, T.Empty);
  const wallOverTc = await setTileAndWatch(a, TC.x, TC.y, T.Wall);
  result(d <= REACH, `(d) player is within reach of the TC, so any rejection is not just a reach check`);
  result(placeTc.length === 0, `(d) setTile TownCenter(12) at (${TC.x},${TC.y}) rejected (tileUpdates=${placeTc.length})`);
  result(breakTc.length === 0, `(d) setTile Empty (break) at TC rejected (tileUpdates=${breakTc.length})`);
  result(wallOverTc.length === 0 && a.tileAt(TC.x, TC.y) === T.TownCenter,
    `(d) placing a Wall over the TC rejected; tile still ${a.tileAt(TC.x, TC.y)}`);
  // Placing a TownCenter somewhere else (an Empty tile in reach) must also be rejected.
  let empty = null;
  for (let dx = -2; dx <= 2 && !empty; dx++)
    for (let dy = -2; dy <= 2 && !empty; dy++) {
      const x = meT.x + dx, y = meT.y + dy;
      if ((dx || dy) && a.tileAt(x, y) === T.Empty && Math.hypot(x * TILE + 16 - a.me().x, y * TILE + 16 - a.me().y) <= REACH) empty = { x, y };
    }
  if (empty) {
    const ups = await setTileAndWatch(a, empty.x, empty.y, T.TownCenter);
    result(ups.length === 0, `(d) placing TownCenter on Empty (${empty.x},${empty.y}) rejected (tileUpdates=${ups.length})`);
  }
}

if (ONLY.has("c")) {
  // Reject: Iron Mine / Rock Mine on Empty, and on the wrong ore.
  const meT = { x: Math.floor(a.me().x / TILE), y: Math.floor(a.me().y / TILE) };
  let empty = null;
  for (let dx = -2; dx <= 2 && !empty; dx++)
    for (let dy = -2; dy <= 2 && !empty; dy++) {
      const x = meT.x + dx, y = meT.y + dy;
      if ((dx || dy) && a.tileAt(x, y) === T.Empty && Math.hypot(x * TILE + 16 - a.me().x, y * TILE + 16 - a.me().y) <= REACH) empty = { x, y };
    }
  {
    const ups = await setTileAndWatch(a, empty.x, empty.y, T.IronMine);
    result(ups.length === 0 && a.tileAt(empty.x, empty.y) === T.Empty,
      `(c) Iron Mine on Empty (${empty.x},${empty.y}) in reach rejected (tileUpdates=${ups.length}, tile=${a.tileAt(empty.x, empty.y)})`);
    const ups2 = await setTileAndWatch(a, empty.x, empty.y, T.RockMine);
    result(ups2.length === 0 && a.tileAt(empty.x, empty.y) === T.Empty,
      `(c) Rock Mine on Empty (${empty.x},${empty.y}) in reach rejected (tileUpdates=${ups2.length})`);
  }

  for (const [label, ore, mine, wrongMine] of [["Iron", T.IronOre, T.IronMine, T.RockMine], ["Rock", T.Rock, T.RockMine, T.IronMine]]) {
    // Nearest reachable ore of this kind.
    const { dist, key } = bfs(a);
    let target = null;
    for (let y = 0; y < a.H(); y++)
      for (let x = 0; x < a.W(); x++) {
        if (a.tileAt(x, y) !== ore) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const d = dist.get(key(x + dx, y + dy));
          if (d !== undefined && (!target || d < target.d)) target = { x, y, d };
        }
      }
    if (!target) {
      result(false, `(c) no reachable ${label} ore tile found`);
      continue;
    }
    const app = approachFor(a, target.x, target.y);
    const path = pathTo(a, app);
    const walked = await walkPath(a, path, 25000);
    const reachDist = Math.hypot(a.me().x - (target.x * TILE + 16), a.me().y - (target.y * TILE + 16));
    result(walked && reachDist <= REACH,
      `(c) walked ${path.length} tiles to (${app.x},${app.y}) next to ${label} ore (${target.x},${target.y}); ${reachDist.toFixed(1)}px away`);

    const wrong = await setTileAndWatch(a, target.x, target.y, wrongMine);
    result(wrong.length === 0 && a.tileAt(target.x, target.y) === ore,
      `(c) wrong mine type (${wrongMine}) on ${label} ore rejected (tileUpdates=${wrong.length})`);

    const placed = await setTileAndWatch(a, target.x, target.y, mine);
    result(placed.length === 1 && placed[0].tile === mine && placed[0].prev === ore,
      `(c) ${label} Mine on ${label} ore (${target.x},${target.y}) accepted: ${JSON.stringify(placed.map((u) => ({ tile: u.tile, prev: u.prev })))}`);
    await sleep(200);
    const miners = a.snap.colonists.filter((c) => c.kind === (label === "Iron" ? "ironMiner" : "rockMiner"));
    console.log(`[${el()}] (c) info: ${label.toLowerCase()} miners now=${miners.length}`);

    const broke = await setTileAndWatch(a, target.x, target.y, T.Empty);
    result(broke.length === 1 && broke[0].tile === ore,
      `(c) breaking ${label} Mine reverts tile to ${label} ore (${ore}): ${JSON.stringify(broke.map((u) => u.tile))}`);
    await sleep(200);
    const minersAfter = a.snap.colonists.filter((c) => c.kind === (label === "Iron" ? "ironMiner" : "rockMiner"));
    result(minersAfter.length === miners.length - 1, `(c) its miner was removed (${miners.length} -> ${minersAfter.length})`);
  }
}

if (ONLY.has("e")) {
  const b = connect();
  await b.ready();
  await sleep(200);
  // Bring A onto B's tile (A may have walked away during section c).
  const bTile = { x: Math.floor(b.me().x / TILE), y: Math.floor(b.me().y / TILE) };
  const back = pathTo(a, bTile);
  if (back && back.length) await walkPath(a, back, 20000);
  await sleep(200);
  const meA = a.me();
  const meB = b.me();
  const sep = Math.hypot(meA.x - meB.x, meA.y - meB.y);
  console.log(`[${el()}] (e) players=${a.snap.players.length}; A=(${meA.x.toFixed(0)},${meA.y.toFixed(0)}) B=(${meB.x.toFixed(0)},${meB.y.toFixed(0)}) sep=${sep.toFixed(1)}px mobs=${a.snap.mobs.length}`);
  if (a.snap.players.length !== 2) console.log(`[${el()}] (e) WARNING: other players are connected; nearest-target ties may hit them instead of B`);
  const hpLog = [];
  let lastHp = b.me().hp;
  const watcher = setInterval(() => {
    const hp = b.me()?.hp;
    if (hp !== undefined && hp !== lastHp) {
      hpLog.push({ at: Date.now(), from: lastHp, to: hp });
      lastHp = hp;
    }
  }, 5);
  const start = Date.now();
  let sent = 0;
  while (Date.now() - start < 2200) {
    a.send({ type: "attack" });
    sent++;
    await sleep(100);
  }
  await sleep(200);
  clearInterval(watcher);
  const drops = hpLog.map((h) => h.from - h.to);
  const gaps = hpLog.slice(1).map((h, i) => h.at - hpLog[i].at);
  console.log(`[${el()}] (e) sent ${sent} attacks in 2.2s; B hp changes: ${JSON.stringify(hpLog.map((h) => `${h.from}->${h.to}`))}; gaps(ms)=${JSON.stringify(gaps)}`);
  result(hpLog.length > 0 && drops.every((d) => d === 15), `(e) friendly fire: every hit on B is exactly 15 (${JSON.stringify(drops)})`);
  result(hpLog.length >= 4 && hpLog.length <= 5 && hpLog.length < sent,
    `(e) cooldown gate: ${hpLog.length} hits from ${sent} messages over 2.2s (expected 4-5 at one per 0.5s)`);
  result(gaps.every((g) => g >= 450), `(e) all gaps between hits >= 450ms (${JSON.stringify(gaps)})`);
  result(a.me().hp === 100, `(e) attacker took no self-damage (hp=${a.me().hp})`);
  b.ws.close();
}

// ---- (f) + (g) best-effort night checks: civilians shelter (houses first, TC overflow); mob target priority ----
// STATIC=1: don't walk (posts placed in reach of spawn, no guard) -> checks f and "player beats TC".
// default: walk to place a Knight Post on one side of the TC and civilians on the far side -> checks f
// and "guard beats player".
const tcPx = { x: TC.x * TILE + TILE / 2, y: TC.y * TILE + TILE / 2 };
const tilesFromTc = (e) => Math.hypot(e.x - tcPx.x, e.y - tcPx.y) / TILE;
const tileStr = (e) => `(${Math.floor(e.x / TILE)},${Math.floor(e.y / TILE)})`;

function emptyNeighborsInReach(c) {
  const me = c.me();
  const meT = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };
  const out = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = meT.x + dx, y = meT.y + dy;
      if ((dx || dy) && c.tileAt(x, y) === T.Empty && Math.hypot(x * TILE + 16 - me.x, y * TILE + 16 - me.y) <= REACH - 4)
        out.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
    }
  return out.sort((p, q) => q.d - p.d);
}

async function placeNear(c, tile, label) {
  for (const spot of emptyNeighborsInReach(c)) {
    const ups = await setTileAndWatch(c, spot.x, spot.y, tile, 300);
    if (ups.some((u) => u.tile === tile)) {
      console.log(`[${el()}] placed ${label} at (${spot.x},${spot.y})`);
      return spot;
    }
  }
  console.log(`[${el()}] could not place ${label}`);
  return null;
}

function pickSpot(c, minTc, maxTc, avoid, minAvoid) {
  const { dist, key } = bfs(c);
  const cands = [];
  for (let y = 1; y < c.H() - 1; y++)
    for (let x = 1; x < c.W() - 1; x++) {
      const d = dist.get(key(x, y));
      if (d === undefined) continue;
      const dTc = Math.hypot(x - TC.x, y - TC.y);
      if (dTc < minTc || dTc > maxTc) continue;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < minAvoid) continue;
      cands.push({ x, y, d });
    }
  cands.sort((p, q) => p.d - q.d);
  return cands[0] ?? null;
}

if (ONLY.has("f")) {
  const STATIC = process.env.STATIC === "1";
  let knightPost = null;
  let civSpot = null;
  if (!STATIC) {
    const kSpot = pickSpot(a, 7, 10, null, 0);
    if (process.env.NOKNIGHT !== "1" && kSpot && (await walkPath(a, pathTo(a, kSpot), 20000)))
      knightPost = await placeNear(a, 5, "Knight Post");
    civSpot = pickSpot(a, 7, 10, kSpot, 13);
    if (civSpot) await walkPath(a, pathTo(a, civSpot), 25000);
  }
  await placeNear(a, 3, "Lumberjack Post");
  await placeNear(a, 16, "Barn"); // a farmer (FarmPlot=4 needs an adjacent Barn, so it can't be placed alone)
  console.log(`[${el()}] (f) player waiting at ${tileStr(a.me())}, ${tilesFromTc(a.me()).toFixed(1)} tiles from TC; isNight=${a.snap.isNight}`);

  const nightWait = Date.now();
  while (!a.snap.isNight && Date.now() - nightWait < 55000) await sleep(100);
  if (!a.snap.isNight) {
    result(false, "(f) night never fell within 55s");
  } else {
    console.log(`[${el()}] (f) night fell`);
    const civKinds = new Set(["lumberjack", "farmer", "ironMiner", "rockMiner"]);
    const nightStartFood = a.snap.grain;
    const farmerStates = new Map();
    const mobFirst = new Map();
    const mobLast = new Map();
    let lastNight = null;
    let tcHpMin = a.snap.townCenterHp;
    let phase = "night";
    let dawnAt = null;
    const afterDawn = [];
    for (;;) {
      const s = a.snap;
      tcHpMin = Math.min(tcHpMin, s.townCenterHp);
      const civs = s.colonists.filter((c) => civKinds.has(c.kind));
      const knights = s.colonists.filter((c) => c.kind === "knight" || c.kind === "archer");
      if (s.isNight) {
        lastNight = s;
        for (const c of civs) if (c.kind === "farmer") {
          if (!farmerStates.has(c.id)) farmerStates.set(c.id, new Set());
          farmerStates.get(c.id).add(c.state);
        }
      } else if (phase === "night") {
        phase = "dawn";
        dawnAt = Date.now();
        console.log(`[${el()}] (f) dawn`);
      }
      for (const m of s.mobs) {
        const ctx = { x: m.x, y: m.y, player: { ...a.me() }, knight: knights[0] ? { x: knights[0].x, y: knights[0].y } : null };
        if (!mobFirst.has(m.id)) mobFirst.set(m.id, ctx);
        mobLast.set(m.id, ctx);
      }
      const civStr = civs.map((c) => `${c.kind}${tileStr(c)} d=${tilesFromTc(c).toFixed(1)} ${c.state}`).join(" | ");
      const mobStr = s.mobs.map((m) => tileStr(m)).join(" ");
      console.log(`[${el()}] ${s.isNight ? "NIGHT" : "DAY  "} grain=${s.grain} tcHp=${s.townCenterHp} playerHp=${a.me().hp} :: ${civStr} :: mobs ${mobStr || "-"}${knights.length ? ` :: guard ${tileStr(knights[0])} ${knights[0].state} hp=${knights[0].hp}` : ""}`);
      if (phase === "dawn") {
        afterDawn.push(civs.map((c) => ({ ...c })));
        if (Date.now() - dawnAt > 6000) break;
      }
      await sleep(2000);
    }

    // f: civilians sleep in houses while beds last (House 1 / BigHouse 3 / HouseLevel2 5) and the rest at
    // the TC. This section builds no houses, so with no beds in the world everyone must be at the TC.
    const nightCivs = lastNight.colonists.filter((c) => civKinds.has(c.kind));
    let beds = 0;
    for (const t of a.tiles) beds += t === 13 ? 1 : t === 14 ? 3 : t === 15 ? 5 : 0;
    const atTc = nightCivs.filter((c) => tilesFromTc(c) <= 1.5 && c.sheltered === true);
    const expectTc = Math.max(0, nightCivs.length - beds);
    result(nightCivs.length >= 2 && (beds === 0 ? atTc.length === nightCivs.length : atTc.length === expectTc),
      `(f) end of night, ${beds} house beds: civilians at ${nightCivs.map((c) => `${c.kind}${tileStr(c)} ${tilesFromTc(c).toFixed(2)} tiles sh=${c.sheltered}`).join(", ")} (expected ${expectTc} sheltered <= 1.5 tiles from TC)`);
    result(nightCivs.filter((c) => c.kind !== "farmer").every((c) => c.state === "idle"),
      `(f) gatherers report state "idle" while sheltering (${nightCivs.filter((c) => c.kind !== "farmer").map((c) => c.state)})`);
    const fStates = [...farmerStates.values()].map((st) => [...st]);
    result(fStates.length > 0 && fStates.every((st) => st.length === 1) && lastNight.grain === nightStartFood,
      `(f) farmer state frozen through the night (${JSON.stringify(fStates)}), grain ${nightStartFood} -> ${lastNight.grain} during night`);
    const resumed = afterDawn.flat().some((c) => c.kind === "lumberjack" && c.state !== "idle");
    result(resumed, `(f) lumberjack resumed its job after dawn (states after dawn: ${JSON.stringify(afterDawn.map((cs) => cs.filter((c) => c.kind === "lumberjack").map((c) => c.state)[0]))})`);
    const farmerAfter = afterDawn.at(-1)?.find((c) => c.kind === "farmer");
    if (farmerAfter) console.log(`[${el()}] (f) info: farmer 6s after dawn at ${tileStr(farmerAfter)} (${tilesFromTc(farmerAfter).toFixed(1)} tiles from TC), state ${farmerAfter.state}`);

    // g: mob target priority (best-effort).
    console.log(`[${el()}] (g) mobs observed: ${mobFirst.size}`);
    let discriminating = 0, towardGuard = 0;
    for (const [id, first] of mobFirst) {
      const last = mobLast.get(id);
      const dPlayer0 = Math.hypot(first.x - first.player.x, first.y - first.player.y) / TILE;
      const dPlayer1 = Math.hypot(last.x - last.player.x, last.y - last.player.y) / TILE;
      const dTc0 = Math.hypot(first.x - tcPx.x, first.y - tcPx.y) / TILE;
      const dTc1 = Math.hypot(last.x - tcPx.x, last.y - tcPx.y) / TILE;
      let line = `mob ${id.slice(0, 4)} ${tileStr(first)} -> ${tileStr(last)}: player ${dPlayer0.toFixed(1)} -> ${dPlayer1.toFixed(1)}, TC ${dTc0.toFixed(1)} -> ${dTc1.toFixed(1)}`;
      if (first.knight && last.knight) {
        const dK0 = Math.hypot(first.x - first.knight.x, first.y - first.knight.y) / TILE;
        const dK1 = Math.hypot(last.x - last.knight.x, last.y - last.knight.y) / TILE;
        line += `, guard ${dK0.toFixed(1)} -> ${dK1.toFixed(1)}`;
        if (dPlayer0 < dK0) {
          discriminating++;
          if (dK1 < dK0 - 2 && dK1 < dPlayer1) towardGuard++;
        }
      }
      console.log(`[${el()}] (g)   ${line}`);
    }
    if (STATIC || !knightPost) {
      result(mobFirst.size > 0 && tcHpMin === 300,
        `(g) with a player connected and no guards, TC was never damaged (min tcHp=${tcHpMin}, mobs seen=${mobFirst.size})`);
      if (!STATIC) {
        let towardPlayer = 0;
        for (const [id, first] of mobFirst) {
          const last = mobLast.get(id);
          const dP0 = Math.hypot(first.x - first.player.x, first.y - first.player.y);
          const dP1 = Math.hypot(last.x - last.player.x, last.y - last.player.y);
          if (dP1 < dP0 - 3 * TILE) towardPlayer++;
        }
        result(towardPlayer > 0, `(g) no guards: ${towardPlayer}/${mobFirst.size} mobs closed >3 tiles on the player (player is ${tilesFromTc(a.me()).toFixed(1)} tiles from the TC)`);
      }
    } else if (knightPost) {
      console.log(`[${el()}] (g) mobs that started closer to the player than to the guard: ${discriminating}; of those, ended up heading to/near the guard: ${towardGuard}`);
      result(discriminating === 0 || towardGuard > 0,
        `(g) guard-over-player priority ${discriminating === 0 ? "INCONCLUSIVE (no mob spawned closer to the player than the guard)" : `observed (${towardGuard}/${discriminating})`}`);
    }
  }
}

if (ONLY.has("g2")) {
  // TC becomes the target only when no guards and no players exist: disconnect for the night.
  const hp0 = a.snap.townCenterHp;
  const nightWait = Date.now();
  while (!a.snap.isNight && Date.now() - nightWait < 55000) await sleep(100);
  console.log(`[${el()}] (g2) night fell (tcHp=${hp0}); disconnecting all players for 30s`);
  a.ws.close();
  await sleep(30000);
  const r = connect();
  await r.ready();
  const s = r.firstSnap;
  console.log(`[${el()}] (g2) reconnected: isNight=${s.isNight} tcHp=${s.townCenterHp} mobs=${s.mobs.map((m) => `${tileStr(m)} d=${tilesFromTc(m).toFixed(1)}`).join(" ")}`);
  result(s.townCenterHp < hp0, `(g2) with no guards/players, mobs damaged the Town Center: ${hp0} -> ${s.townCenterHp}`);
  r.ws.close();
  process.exit(fails ? 1 : 0);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
a.ws.close();
process.exit(fails ? 1 : 0);
