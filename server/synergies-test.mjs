// Scripted test: neighbourhood synergies. (1) +1 population cap per orthogonal (house, house) / (house, building) pair,
// (2) extra guards for a unit building per adjacent house, (3) a solid placement that would seal in a unit
// building's last open side is rejected (3 houses around a unit building allowed, the 4th rejected).
// industrialSynergyMultiplier is covered by industrial-synergy-test.mjs, armyDamageMultiplier by
// army-damage-test.mjs, Town Center overflow sheltering by shelter-overflow-test.mjs.
// Needs a fresh server with no other players; run with COLONY_WORLD_SIZE=80.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`info [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {
  Empty: 0, Wall: 1, Tree: 2, Lumberjack: 3, FarmPlot: 4, KnightPost: 5, ArcherPost: 6, IronOre: 7, Rock: 8,
  IronMine: 9, RockMine: 10, StoneWall: 11, TownCenter: 12, House: 13, BigHouse: 14, HouseLevel2: 15,
  MilitiaPost: 32, Barn: 16, Castle2: 17, Castle3: 18, ArcherTower: 19,
};
const TILE = 32;
const REACH = TILE * 2.5;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, firstSnap: null, tiles: [], tileUpdates: [], snaps: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      if (!c.firstSnap) c.firstSnap = m;
      m.at = Date.now();
      // Track player deaths (hp resets to max + teleport to the TC) so a failed action can be explained.
      const prevMe = c.snap?.players.find((p) => p.id === c.welcome?.id);
      const nowMe = m.players.find((p) => p.id === c.welcome?.id);
      if (prevMe && nowMe && nowMe.hp > prevMe.hp && Math.hypot(nowMe.x - prevMe.x, nowMe.y - prevMe.y) > 40) {
        c.deaths = (c.deaths ?? 0) + 1;
        console.log(`info [${el()}] PLAYER DIED (hp ${prevMe.hp} -> respawned at ${Math.floor(nowMe.x / 32)},${Math.floor(nowMe.y / 32)}); mobs=${m.mobs.length} night=${m.isNight}`);
      }
      c.snap = m;
      if (c.recordSnaps) c.snaps.push(m);
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, prev: c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX], at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  // Only Empty / FarmPlot count as walkable. The old partial SOLID list missed MilitiaPost (32) and the other
  // newer solid tiles, so the (3) walk planned a path straight through section (2)'s Militia Camp and stalled.
  c.walkable = (x, y) => c.inBounds(x, y) && (c.tileAt(x, y) === T.Empty || c.tileAt(x, y) === 4);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

function bfs(c) {
  const start = c.meTile();
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

// Returns false on timeout, or early when the player stops making progress for 2s (blocked, or killed and
// respawned at the Town Center) so the caller can re-plan from wherever the player actually is.
async function walkPath(c, path, timeoutMs = 45000) {
  const since = Date.now();
  let lastPos = { ...c.me() }, lastMoveAt = Date.now();
  for (const wp of path) {
    const cx = wp.x * TILE + TILE / 2;
    const cy = wp.y * TILE + TILE / 2;
    for (;;) {
      const now = Date.now();
      const cur = c.me();
      if (Math.hypot(cur.x - lastPos.x, cur.y - lastPos.y) > 2) {
        if (Math.hypot(cur.x - lastPos.x, cur.y - lastPos.y) > TILE * 2) {
          // Teleported (death respawn): the remaining path no longer starts here.
          c.send({ type: "input", dx: 0, dy: 0 });
          return false;
        }
        lastPos = { ...cur };
        lastMoveAt = now;
      }
      if (now - since > timeoutMs || now - lastMoveAt > 2000) {
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

// Walk to tile s, re-planning from the current position after any failed walk (blocked, timed out,
// died). Gives up only after `attempts` tries or when s stops being reachable (e.g. a tree regrew on it).
async function ensureAt(c, s, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const t = c.meTile();
    const me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) return false;
    if (!(await walkPath(c, path.length ? path : [s]))) {
      info(`walk towards (${s.x},${s.y}) interrupted at tile (${c.meTile().x},${c.meTile().y}); re-planning (attempt ${attempt + 1})`);
      await sleep(300);
    }
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const colonistOnTile = (c, x, y) =>
  c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);
const kinds = (c, kind) => c.snap.colonists.filter((k) => k.kind === kind);

// Send a setTile and collect every tileUpdate (anywhere) that arrives within waitMs.
async function act(c, x, y, tile, waitMs = 500) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.at >= since);
}

// Placement expected to succeed: retries a few times in case a walking colonist briefly blocks the tile.
async function placeExpectAt(c, x, y, tile, expectX, expectY, expectTile, tries = 6) {
  for (let i = 0; i < tries; i++) {
    for (let w = 0; w < 200 && colonistOnTile(c, x, y); w++) await sleep(100);
    const ups = await act(c, x, y, tile);
    const hit = ups.filter((u) => u.tileX === expectX && u.tileY === expectY);
    if (hit.length) return { ups, hit };
    await sleep(300);
  }
  return { ups: [], hit: [] };
}

// Find a reachable standing tile whose surrounding 5x5 box (Chebyshev radius 2) is entirely Empty and
// unoccupied, at least 7 tiles away from every previously used site.
function findSite(c, avoid) {
  const { dist, key } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    if (avoid.some((a) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) < 7)) continue;
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++)
      for (let dy = -2; dy <= 2 && ok; dy++) {
        const tx = x + dx, ty = y + dy;
        if (!c.inBounds(tx, ty) || c.tileAt(tx, ty) !== T.Empty) ok = false;
        else if ((dx || dy) && colonistOnTile(c, tx, ty)) ok = false;
      }
    if (ok && (!best || d < best.d)) best = { x, y, d };
  }
  return best;
}

// The 5x5 box around s is still all Empty tiles (colonists passing through are tolerated: placements wait).
function boxEmpty(c, s) {
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      if (!c.inBounds(s.x + dx, s.y + dy) || c.tileAt(s.x + dx, s.y + dy) !== T.Empty) return false;
  return true;
}

const usedSites = [];
// Picks the nearest clear site and walks there. If the walk fails (site became unreachable or blocked,
// player died on the way), the site is re-validated and, if no longer clear, a fresh one is picked.
async function gotoNewSite(c, label) {
  const tried = [];
  for (let pick = 0; pick < 4; pick++) {
    // Re-check the site from scratch each pick: trees regrow and colonists wander onto empty tiles.
    const s = findSite(c, [...usedSites, ...tried]);
    if (!s) break;
    const ok = await ensureAt(c, s);
    if (ok && boxEmpty(c, s)) {
      usedSites.push(s);
      result(true, `${label} walked to site (${s.x},${s.y}) [${s.d} tiles away${pick ? `, pick ${pick + 1}` : ""}]`);
      return s;
    }
    info(`${label} site (${s.x},${s.y}) not reached/clear (ok=${ok}, player at ${c.meTile().x},${c.meTile().y}); picking another`);
    tried.push(s);
  }
  result(false, `${label} could not walk to any clear 5x5 site`);
  return null;
}


const a = connect();
await a.ready();
// Houses cost 20 wood + 5 rock since the pop cap rework; top the stock up so the test is about synergies,
// not about waiting for lumberjacks (needs COLONY_TEST_HOOKS=1).
a.ws.send(JSON.stringify({ type: "testHook", op: "setStock", stock: { wood: 500, rock: 500, iron: 200 } }));
await sleep(300);
const cap0 = a.snap.populationCap;
info(`connected; wood=${a.snap.wood} iron=${a.snap.iron} rock=${a.snap.rock} cap=${cap0}`);

let ljPos = null, houses1 = [];
// ---- (1) population bonus for adjacent houses ----
{
  const s = await gotoNewSite(a, "(1)");
  if (s) {
    const H1 = { x: s.x, y: s.y - 2 }, H2 = { x: s.x + 1, y: s.y - 2 };
    await placeExpectAt(a, H1.x, H1.y, T.House, H1.x, H1.y, T.House);
    await sleep(100);
    result(a.snap.populationCap === cap0 + 1, `(1) single House: cap ${cap0}->${a.snap.populationCap} (expected +1)`);
    await placeExpectAt(a, H2.x, H2.y, T.House, H2.x, H2.y, T.House);
    await sleep(100);
    result(a.snap.populationCap === cap0 + 3, `(1) adjacent House: cap ${a.snap.populationCap} (expected ${cap0 + 3} = 2 houses + 1 pair bonus)`);
    ljPos = { x: s.x + 1, y: s.y - 1 }; houses1 = [H1, H2];
    await placeExpectAt(a, s.x + 1, s.y - 1, T.Lumberjack, s.x + 1, s.y - 1, T.Lumberjack);
    await sleep(100);
    result(a.snap.populationCap === cap0 + 5, `(1) Lumberjack below H2 (orthogonal to H2, diagonal to H1): cap ${a.snap.populationCap} (expected ${cap0 + 5}: 2 pairs, diagonals count)`);
  }
}

// ---- (2) extra guards for a militia camp next to a house ----
{
  const s = await gotoNewSite(a, "(2)");
  if (s) {
    const M = { x: s.x, y: s.y - 2 };
    const atPost = () => a.snap.colonists.filter((k) => Math.floor(k.postX ?? -1) === M.x && Math.floor(k.postY ?? -1) === M.y);
    await placeExpectAt(a, M.x, M.y, T.MilitiaPost, M.x, M.y, T.MilitiaPost);
    await sleep(200);
    const n0 = atPost().length;
    result(n0 === 2, `(2) Militia Camp alone: ${n0} units (expected 2)`);
    // The militia stand on the camp's neighbouring tiles; put the House on a side nobody is standing on
    // (waiting for a unit to leave its slot can take a whole day cycle).
    const H = [{ x: M.x + 1, y: M.y }, { x: M.x - 1, y: M.y }, { x: M.x, y: M.y + 1 }].find((p) => !colonistOnTile(a, p.x, p.y)) ?? { x: M.x + 1, y: M.y };
    await placeExpectAt(a, H.x, H.y, T.House, H.x, H.y, T.House);
    await sleep(300);
    const n1 = atPost().length;
    result(n1 === 3, `(2) House placed next to the camp: ${n1} units (expected 3 = 2 + 1 per adjacent house)`);
    result(a.snap.populationCap === cap0 + 5 + 2, `(2) cap ${a.snap.populationCap} (expected ${cap0 + 7}: earlier +5, this house +1, house-camp pair +1)`);
  }
}

// ---- (3) 3 houses around a unit building allowed, 4th rejected ----
{
  while (a.snap.isNight) await sleep(250); // walking at night is unreliable (mobs, shelter)
  const s = await gotoNewSite(a, "(3)");
  if (s) {
    const K = { x: s.x + 1, y: s.y - 1 };
    const N = [{ x: K.x - 1, y: K.y }, { x: K.x + 1, y: K.y }, { x: K.x, y: K.y - 1 }, { x: K.x, y: K.y + 1 }];
    const knights = () => a.snap.colonists.filter((k) => k.kind === "knight" && k.postX === K.x && k.postY === K.y);
    await placeExpectAt(a, K.x, K.y, T.KnightPost, K.x, K.y, T.KnightPost);
    await sleep(200);
    const capK = a.snap.populationCap;
    // Houses on the three sides that are not the player's tile.
    let placed = 0; // W, E, N sides; the W-N and E-N houses touch diagonally
    // Knights idle on the post's open sides; build on the sides nobody is standing on first, so the
    // occupied one is left for the 4th-house check instead of blocking a placement for a whole day.
    const order = [...N].sort((p, q) => colonistOnTile(a, p.x, p.y) - colonistOnTile(a, q.x, q.y));
    for (const p of order) {
      if (placed === 3) break;
      if (p.x === s.x && p.y === s.y) continue;
      const r = await placeExpectAt(a, p.x, p.y, T.House, p.x, p.y, T.House);
      if (r.hit.length) placed++;
    }
    await sleep(300);
    result(placed === 3 && knights().length === 4, `(3) 3 houses around the KnightPost accepted (${placed}); knights=${knights().length} (expected 4 = 1 + 3)`);
    result(a.snap.populationCap === capK + 8, `(3) cap ${capK}->${a.snap.populationCap} (expected +8 = 3 houses + 3 house-post pairs + 2 diagonal house-house pairs)`);
    const last = N.find((p) => a.tileAt(p.x, p.y) === T.Empty);
    if (last && !(last.x === s.x && last.y === s.y)) {
      // The knights idle on their post's only open side, and a tile with a colonist on it is rejected
      // anyway (which would make this pass for the wrong reason), so only test it while it is free.
      for (let w = 0; w < 450 && colonistOnTile(a, last.x, last.y); w++) await sleep(100);
      if (!colonistOnTile(a, last.x, last.y)) {
        const wood = a.snap.wood;
        const ups = await act(a, last.x, last.y, T.House, 700);
        // Lumberjacks keep adding wood, so "rejected" means the House cost was never deducted.
        result(ups.filter((u) => u.tileX === last.x && u.tileY === last.y).length === 0 && a.tileAt(last.x, last.y) === T.Empty && a.snap.wood >= wood,
          `(3) 4th House on the last open side (${last.x},${last.y}) rejected: tile ${a.tileAt(last.x, last.y)}, wood ${wood}->${a.snap.wood}`);
      } else {
        // Fallback for the same rule (sealsInSpawner), unit-building side: a Knight Post on a tile whose four
        // sides are all solid is refused; with one side opened it is accepted (control).
        info(`(3) knights still standing on (${last.x},${last.y}) after 45s; checking the enclosed-post variant instead`);
        const X = { x: s.x - 1, y: s.y + 1 };
        const sides = [{ x: X.x - 1, y: X.y }, { x: X.x + 1, y: X.y }, { x: X.x, y: X.y + 1 }, { x: X.x, y: X.y - 1 }];
        let walls = 0;
        for (const p of sides) if ((await placeExpectAt(a, p.x, p.y, T.Wall, p.x, p.y, T.Wall)).hit.length) walls++;
        const iron = a.snap.iron;
        const ups = colonistOnTile(a, X.x, X.y) ? null : await act(a, X.x, X.y, T.KnightPost, 700);
        result(walls === 4 && ups && ups.filter((u) => u.tileX === X.x && u.tileY === X.y).length === 0 && a.snap.iron === iron,
          `(3) Knight Post on (${X.x},${X.y}) with all 4 sides walled (${walls}/4) rejected: iron ${iron}->${a.snap.iron}`);
        await act(a, sides[1].x, sides[1].y, T.Empty, 400);
        const ok = await placeExpectAt(a, X.x, X.y, T.KnightPost, X.x, X.y, T.KnightPost);
        result(ok.hit.length > 0, `(3) control: after opening one side, the Knight Post on (${X.x},${X.y}) is accepted`);
      }
    } else result(false, `(3) no open side left for the 4th-house check (last=${JSON.stringify(last)}; player tile was used as a side)`);
  }
}

// ---- (4) night shelter: a worker goes to a nearby house with a free bed ----
// (Overflow to the Town Center when beds run out is NOT covered here.)
if (ljPos) {
  // Need a night with >= 10s left (night is the last 40% of the 100s cycle): if the current night is
  // nearly over, wait for the next one.
  const since = Date.now();
  const nightLeftS = () => (1 - a.snap.cycleProgress) * 100;
  while (!(a.snap.isNight && nightLeftS() >= 10) && Date.now() - since < 150000) await sleep(250);
  await sleep(6000);
  const lj = a.snap.colonists.find((k) => k.kind === "lumberjack" && k.postX === ljPos.x && k.postY === ljPos.y);
  // Beds go to the nearest free house, which may be any house built above (each has 1 bed).
  for (let y = 0; y < a.H(); y++) for (let x = 0; x < a.W(); x++) if (a.tileAt(x, y) === T.House && !houses1.some((h) => h.x === x && h.y === y)) houses1.push({ x, y });
  const d = lj ? Math.min(...houses1.map((h) => Math.hypot(lj.x - (h.x * TILE + 16), lj.y - (h.y * TILE + 16)))) / TILE : null;
  result(!!lj && a.snap.isNight && d <= 1.5 && lj.sheltered === true,
    `(4) at night the lumberjack is within 1.5 tiles of a house: ${d?.toFixed(2)} tiles, sheltered=${lj?.sheltered}, night=${a.snap.isNight}`);
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
