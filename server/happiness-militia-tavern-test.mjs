// Scripted test: colony happiness, Militia -> Spearman -> Pikeman line, Brewery/Tavern alcohol economy,
// desertion -> dormant deserter mob, and restart reset of all new state. Every phase begins with a `restart`, so it
// must be the ONLY connected player (restart resets the world for everyone).
//
//   H: happiness in snapshot matches the server formula recomputed client-side (food variety / trees / tavern coverage).
//   A: Militia Camp -> 2 militia (30hp), placed on it -> MilitiaCamp2 + 6 spearmen (50hp), placed on it again -> MilitiaCamp3 + 10
//      pikemen (80hp); costs 5 wood + 5 iron each; pikemen accept commandMove + task-force assignment (commandable).
//   B: Brewery consumes 2 grain -> 1 alcohol; cycle time slowed by happiness (live vs the 4s happiness=100 baseline);
//      lumberjack earns wood for a Tavern; Tavern raises happiness via coverage; Tavern converts 1 alcohol -> 10 gold.
//   C: grain burned to 0 -> happiness < 35 -> at dawn soldiers desert into dormant 80hp mobs (not deletions).
//   Final: restart clears alcohol / militia line / deserters.
// Current-server notes: restart stock is wood 80 / iron 60 / rock 60 / grain 60; craft cycles also speed up 5% per
// other industrial building within 5 tiles; a unit building gets +1 unit per adjacent house (incl. diagonals).
// Saint Wren's Abbey clergy (world-gen bishops posted at the AbbeyHall) are not the colony's: they are filtered
// out of every snapshot's `colonists` (kept in `clergy`), exactly as the server's population and happiness do.
// Run with COLONY_WORLD_SIZE=80.
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
  Barn: 16, Castle2: 17, Castle3: 18, ArcherTower: 19, Church: 20,
  Pasture: 21, Orchard: 22, WoolFarm: 23, CottonFarm: 24, TailorShop: 25, Blacksmith: 26, LuxuryWorkshop: 27,
  Market: 28, GoldShop: 29, Brewery: 30, Tavern: 31, MilitiaPost: 32, MilitiaCamp2: 33, MilitiaCamp3: 34,
};
const ABBEY_HALL = 46;
// Every tile type the server treats as solid (protocol.ts isSolidTile): 1..49 except FarmPlot (4),
// which includes world-gen water, ruins, encampment props, the Abbey and Ward Stones.
// + 50/51 (Hunter's/Forager's Hut) and 54/55 (fruit tree, ripe/picked); berry bushes and mushrooms are walkable.
const SOLID = new Set([...Array.from({ length: 49 }, (_, i) => i + 1).filter((t) => t !== 4), 50, 51, 54, 55]);
const INDUSTRIAL = new Set([3, 16, 9, 10, 21, 22, 23, 24, 25, 26, 27, 30]);
const TILE = 32;
const PLAYER_ATTACK_RANGE = TILE * 1.3;
const SOLDIER = new Set(["knight", "archer", "militia", "spearman", "pikeman"]);
const MILITIA_LINE = new Set(["militia", "spearman", "pikeman"]);

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: [], tileUpdates: [], onSnap: null };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const isClergy = (k) => c.tiles[k.postY * c.welcome.worldTilesX + k.postX] === ABBEY_HALL;
      m.clergy = m.colonists.filter(isClergy);
      m.colonists = m.colonists.filter((k) => !isClergy(k));
      m.at = Date.now();
      const prev = c.snap;
      c.snap = m;
      if (c.onSnap && prev) c.onSnap(prev, m);
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, at: Date.now() });
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
  c.walkable = (x, y) => c.inBounds(x, y) && !SOLID.has(c.tileAt(x, y));
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

async function walkPath(c, path, timeoutMs = 30000) {
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

async function ensureAt(c, s) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = c.meTile();
    const me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) return false;
    await walkPath(c, path.length ? path : [s]);
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const colonistOnTile = (c, x, y) =>
  c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);
const kinds = (c, kind) => c.snap.colonists.filter((k) => k.kind === kind);
const atPost = (c, p) => c.snap.colonists.filter((k) => k.postX === p.x && k.postY === p.y);

async function act(c, x, y, tile, waitMs = 400) {
  const since = Date.now();
  c.send({ type: "setTile", tileX: x, tileY: y, tile });
  await sleep(waitMs);
  return c.tileUpdates.filter((u) => u.at >= since);
}

async function placeExpectAt(c, x, y, tile, expectX = x, expectY = y, tries = 6) {
  for (let i = 0; i < tries; i++) {
    for (let w = 0; w < 50 && colonistOnTile(c, x, y); w++) await sleep(100);
    const ups = await act(c, x, y, tile);
    const hit = ups.filter((u) => u.tileX === expectX && u.tileY === expectY);
    if (hit.length) return { ups, hit };
    await sleep(300);
  }
  return { ups: [], hit: [] };
}

async function waitFor(c, pred, timeoutMs) {
  const since = Date.now();
  while (Date.now() - since < timeoutMs) {
    if (pred(c.snap)) return true;
    await sleep(50);
  }
  return pred(c.snap);
}

function findSite(c) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
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

async function gotoSite(c, label) {
  const s = findSite(c);
  if (!s) {
    result(false, `${label} no 5x5 empty site reachable`);
    return null;
  }
  const ok = await ensureAt(c, s);
  result(ok, `${label} walked to site (${s.x},${s.y}) [${s.d} tiles away]`);
  return ok ? s : null;
}

// industrialSynergyMultiplier: +5% per other industrial building within 5 tiles (Chebyshev).
function industrialSynergy(c, x, y) {
  let n = 0;
  for (let ty = y - 5; ty <= y + 5; ty++)
    for (let tx = x - 5; tx <= x + 5; tx++)
      if ((tx !== x || ty !== y) && c.inBounds(tx, ty) && INDUSTRIAL.has(c.tileAt(tx, ty))) n++;
  return 1 + n * 0.05;
}

// Client-side replica of the server's computeColonyHappiness() (snapshot colonists exclude the Abbey clergy).
function expectedHappiness(c) {
  const s = c.snap;
  const food = ["grain", "meat", "fruit"].filter((k) => s[k] > 0).length;
  let trees = 0;
  const taverns = [];
  for (let i = 0; i < c.tiles.length; i++) {
    if (c.tiles[i] === T.Tree) trees++;
    if (c.tiles[i] === T.Tavern) taverns.push({ x: i % c.W(), y: Math.floor(i / c.W()) });
  }
  const posts = new Set(s.colonists.map((k) => `${k.postX},${k.postY}`));
  let tavernScore = 0;
  if (posts.size > 0 && taverns.length > 0) {
    let covered = 0;
    for (const p of posts) {
      const [px, py] = p.split(",").map(Number);
      if (taverns.some((t) => Math.hypot(t.x - px, t.y - py) <= 6)) covered++;
    }
    tavernScore = (covered / posts.size) * 100;
  }
  const h = (food / 3) * 100 * 0.4 + Math.min(100, (trees / 20) * 100) * 0.3 + tavernScore * 0.3;
  return { value: Math.max(0, Math.min(100, Math.round(h))), food, trees, taverns: taverns.length, posts: posts.size, tavernScore };
}

function checkHappinessFormula(c, label) {
  const e = expectedHappiness(c);
  result(c.snap.happiness === e.value,
    `${label} happiness=${c.snap.happiness} matches formula ${e.value} (foodTypes=${e.food}, trees=${e.trees}, taverns=${e.taverns}, posts=${e.posts}, tavernCov=${e.tavernScore.toFixed(0)}%)`);
  return e;
}

async function restart(c, label) {
  const w0 = c.welcomes;
  const mobIdsBefore = new Set(c.snap.mobs.map((m) => m.id));
  c.send({ type: "restart" });
  await waitFor(c, () => c.welcomes > w0, 3000);
  await sleep(300);
  const s = c.snap;
  const militia = s.colonists.filter((k) => MILITIA_LINE.has(k.kind)).length;
  // A fresh world starts with its own world-gen ruin/encampment guardians, so "mobs cleared" means
  // none of the pre-restart mobs (incl. deserters) survived it.
  const carried = s.mobs.filter((m) => mobIdsBefore.has(m.id)).length;
  result(s.alcohol === 0 && s.colonists.length === 0 && militia === 0 && carried === 0 && !s.isNight,
    `${label} restart: alcohol=${s.alcohol} colony colonists=${s.colonists.length} militiaLine=${militia} pre-restart mobs(incl. deserters) carried over=${carried} day=${!s.isNight}`);
  // The only colonists a fresh world has are Saint Wren's Abbey's three world-gen clergy (none if no Abbey fit).
  const hasAbbey = c.tiles.includes(ABBEY_HALL);
  result(s.clergy.length === (hasAbbey ? 3 : 0) && s.clergy.every((k) => k.kind === "bishop"),
    `${label} restart: only the Abbey's world-gen clergy remain (${s.clergy.length} bishops at the AbbeyHall, expected ${hasAbbey ? 3 : 0})`);
  checkHappinessFormula(c, `${label} post-restart`);
}

const a = connect();
await a.ready();
info(`connected; players=${a.snap.players.length}`);
if (a.snap.players.length !== 1) info("WARNING: other players connected; restart will affect them");

const defend = setInterval(() => {
  if (!a.snap) return;
  const me = a.me();
  if (!me) return;
  if (a.snap.mobs.some((m) => Math.hypot(m.x - me.x, m.y - me.y) <= PLAYER_ATTACK_RANGE)) a.send({ type: "attack" });
}, 100);

// =============== Phase A: Militia line ===============
await restart(a, "(A0)");
{
  const s = await gotoSite(a, "(A)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    const M = P(-1, -1);
    let w0 = a.snap.wood, i0 = a.snap.iron;
    let r = await placeExpectAt(a, M.x, M.y, T.MilitiaPost);
    await sleep(150);
    let g = atPost(a, M);
    result(r.hit[0]?.tile === T.MilitiaPost && g.length === 2 && g.every((k) => k.kind === "militia" && k.maxHp === 30 && k.hp === 30),
      `(c) Militia Camp placed -> ${g.length} units [${g.map((k) => `${k.kind}:${k.hp}/${k.maxHp}`).join(", ")}]`);
    result(a.snap.wood === w0 - 5 && a.snap.iron === i0 - 5, `(c) Militia Camp cost: wood ${w0}->${a.snap.wood}, iron ${i0}->${a.snap.iron} (-5/-5)`);
    result(a.snap.population === 0, `(c) militia are population-exempt (pop=${a.snap.population}/${a.snap.populationCap})`);
    const firstIds = g.map((k) => k.id);

    w0 = a.snap.wood; i0 = a.snap.iron;
    // Upgrades happen by placing the MilitiaPost ON the existing camp; the camp tile itself gets the tileUpdate.
    let ups1 = (await act(a, M.x, M.y, T.MilitiaPost, 600)).filter((u) => u.tileX === M.x && u.tileY === M.y);
    await sleep(150);
    g = atPost(a, M);
    result(ups1.length === 1 && ups1[0].tileX === M.x && ups1[0].tileY === M.y && ups1[0].tile === T.MilitiaCamp2 && a.tileAt(M.x, M.y) === T.MilitiaCamp2,
      `(c) placing ON M upgrades it -> MilitiaCamp2 (tile=${a.tileAt(M.x, M.y)}); tileUpdates=${JSON.stringify(ups1.map((u) => [u.tileX, u.tileY, u.tile]))} (only M; trees elsewhere ignored)`);
    result(g.length === 6 && g.every((k) => k.kind === "spearman" && k.maxHp === 50 && k.hp === 50),
      `(c) tier 2: ${g.length} units, kinds=${[...new Set(g.map((k) => k.kind))]}, hp=${[...new Set(g.map((k) => `${k.hp}/${k.maxHp}`))]}`);
    result(firstIds.every((id) => g.some((k) => k.id === id && k.kind === "spearman")), `(c) both original militia were converted in place to spearmen (same ids)`);
    result(a.snap.wood === w0 - 5 && a.snap.iron === i0 - 5, `(c) upgrade cost: wood ${w0}->${a.snap.wood}, iron ${i0}->${a.snap.iron}`);

    ups1 = await act(a, M.x, M.y, T.MilitiaPost, 600);
    await sleep(150);
    g = atPost(a, M);
    result(ups1.some((u) => u.tileX === M.x && u.tileY === M.y && u.tile === T.MilitiaCamp3) && a.tileAt(M.x, M.y) === T.MilitiaCamp3, `(c) third placement -> MilitiaCamp3 (tile=${a.tileAt(M.x, M.y)})`);
    result(g.length === 10 && g.every((k) => k.kind === "pikeman" && k.maxHp === 80 && k.hp === 80),
      `(c) tier 3: ${g.length} units, kinds=${[...new Set(g.map((k) => k.kind))]}, hp=${[...new Set(g.map((k) => `${k.hp}/${k.maxHp}`))]}`);
    result(a.snap.population === 0, `(c) still population-exempt at tier 3 (pop=${a.snap.population})`);

    // Commandable: move order + task force assignment are accepted by the server for the militia line.
    const ids = g.map((k) => k.id);
    const before = new Map(g.map((k) => [k.id, { x: k.x, y: k.y }]));
    const dest = P(1, 2);
    a.send({ type: "commandMove", unitIds: ids, x: dest.x * TILE + 16, y: dest.y * TILE + 16 });
    a.send({ type: "assignTaskForce", slot: 3, unitIds: ids });
    await sleep(2500);
    const moved = atPost(a, M).filter((k) => {
      const b = before.get(k.id);
      return b && Math.hypot(k.x - b.x, k.y - b.y) > TILE;
    }).length;
    const tf = a.snap.taskForces["3"] ?? [];
    result(moved >= 8, `(c) commandMove accepted: ${moved}/10 pikemen moved > 1 tile toward (${dest.x},${dest.y})`);
    result(tf.length === 10, `(c) task force 3 holds ${tf.length}/10 pikemen (server COMMANDABLE_KINDS accepts militia line)`);

    // Breaking the top tier reverts straight to Empty and removes the garrison.
    const ups = await act(a, M.x, M.y, T.Empty);
    result(ups.some((u) => u.tileX === M.x && u.tileY === M.y && u.tile === T.Empty) && atPost(a, M).length === 0,
      `(c) breaking MilitiaCamp3 -> Empty, garrison removed (left=${atPost(a, M).length})`);
  }
}

// =============== Phase B: Brewery / Tavern / happiness speed ===============
await restart(a, "(B0)");
{
  const s = await gotoSite(a, "(B)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    await placeExpectAt(a, ...Object.values(P(-2, 0)), T.House);
    await placeExpectAt(a, ...Object.values(P(-2, 1)), T.House);
    const B = P(0, -2);
    const w0 = a.snap.wood, i0 = a.snap.iron, g0 = a.snap.grain;
    const breweryEvents = [];
    const tavernEvents = [];
    a.onSnap = (prev, next) => {
      if (next.alcohol > prev.alcohol) breweryEvents.push({ at: next.at, dAlc: next.alcohol - prev.alcohol, dGrain: next.grain - prev.grain, happiness: next.happiness, night: next.isNight });
      if (next.gold - prev.gold === 10) tavernEvents.push({ at: next.at, dAlc: next.alcohol - prev.alcohol, dGold: 10 });
    };
    let r = await placeExpectAt(a, B.x, B.y, T.Brewery);
    const placedAt = Date.now();
    await sleep(150);
    const art = atPost(a, B);
    result(r.hit[0]?.tile === T.Brewery && art.length === 1 && art[0].kind === "artisan",
      `(d) Brewery placed -> ${art.length} ${art[0]?.kind} at post; wood ${w0}->${a.snap.wood} iron ${i0}->${a.snap.iron} (expect -10/-5)`);
    result(a.snap.wood === w0 - 10 && a.snap.iron === i0 - 5, `(d) Brewery cost 10 wood + 5 iron`);
    // Lumberjack (2nd pop slot) to earn wood for the Tavern.
    const L = P(2, 0);
    await placeExpectAt(a, L.x, L.y, T.Lumberjack);
    result(kinds(a, "lumberjack").length === 1, `(B) lumberjack placed for Tavern wood; grain at start=${g0}`);

    await waitFor(a, () => breweryEvents.length >= 3, 30000);
    const e = breweryEvents;
    result(e.length >= 1 && e[0].dAlc === 1 && e[0].dGrain === -2,
      `(d) first brew: alcohol +${e[0]?.dAlc}, grain ${e[0]?.dGrain} (expect +1 / -2) after ${e[0] ? ((e[0].at - placedAt) / 1000).toFixed(2) : "n/a"}s`);
    result(e.slice(0, 3).every((x) => x.dAlc === 1 && x.dGrain === -2), `(d) 3 brews each exactly 2 grain -> 1 alcohol: ${e.slice(0, 3).map((x) => `${x.dGrain}/${x.dAlc}`).join(" ")}`);
    if (e.length >= 3) {
      const interval = (e[2].at - e[1].at) / 1000;
      const h = e[1].happiness;
      const mult = 0.5 + 0.5 * (h / 100);
      // effectiveCraftTicks also divides by the industrial synergy (the lumberjack below is within 5 tiles).
      const syn = industrialSynergy(a, B.x, B.y);
      const expectTicks = Math.max(1, Math.round(80 / (mult * syn)));
      result(Math.abs(interval - expectTicks / 20) < 0.5 && interval > 4.4,
        `(b) live speed: brew cycle ${interval.toFixed(2)}s at happiness ${h}, synergy x${syn} (formula ${expectTicks} ticks = ${(expectTicks / 20).toFixed(2)}s) vs 4.00s baseline at happiness 100`);
    }
    checkHappinessFormula(a, "(b) mid-phase");

    // Wait for enough wood for House #3 + Tavern (10 + 20) and rock (10).
    info(`waiting for wood >= 30 (wood=${a.snap.wood})`);
    const enough = await waitFor(a, (sn) => sn.wood >= 30, 150000);
    result(enough, `(B) lumberjack accumulated wood=${a.snap.wood}`);
    if (enough) {
      await ensureAt(a, s);
      await placeExpectAt(a, ...Object.values(P(-2, -1)), T.House);
      const hBefore = checkHappinessFormula(a, "(d) before Tavern");
      const T1 = P(1, 2);
      const w1 = a.snap.wood, k1 = a.snap.rock;
      r = await placeExpectAt(a, T1.x, T1.y, T.Tavern);
      await sleep(200);
      const tav = atPost(a, T1);
      result(r.hit[0]?.tile === T.Tavern && tav.length === 1 && tav[0].kind === "artisan" && a.snap.wood === w1 - 20 && a.snap.rock === k1 - 10,
        `(d) Tavern placed -> ${tav[0]?.kind}; wood ${w1}->${a.snap.wood} (-20), rock ${k1}->${a.snap.rock} (-10)`);
      const hAfter = checkHappinessFormula(a, "(d) after Tavern");
      result(a.snap.happiness > hBefore.value && hAfter.tavernScore === 100,
        `(d) happiness rose ${hBefore.value} -> ${a.snap.happiness} with Tavern covering ${hAfter.posts}/${hAfter.posts} posts (all within 6 tiles)`);
      const ok = await waitFor(a, () => tavernEvents.length >= 1, 30000);
      const te = tavernEvents[0];
      result(ok && te && te.dGold === 10 && (te.dAlc === -1 || te.dAlc === 0),
        `(d) Tavern sale: gold +${te?.dGold}, alcohol ${te?.dAlc} (expect -1; 0 only if a brew landed the same tick)`);
    }
    a.onSnap = null;
  }
}

// =============== Phase C: desertion -> dormant deserter mobs ===============
await restart(a, "(C0)");
{
  const s = await gotoSite(a, "(C)");
  if (s) {
    const P = (dx, dy) => ({ x: s.x + dx, y: s.y + dy });
    await placeExpectAt(a, ...Object.values(P(-2, 0)), T.House);
    // Restart grain is 60 now: three Breweries burn it to 0 well before the first dawn (food variety -> 0, so
    // happiness = scenery only = 30 < 35).
    await placeExpectAt(a, ...Object.values(P(0, -2)), T.Brewery);
    await placeExpectAt(a, ...Object.values(P(-1, -2)), T.Brewery);
    await placeExpectAt(a, ...Object.values(P(1, -2)), T.Brewery);
    // Not beside the House: a unit building gets +1 unit per adjacent house, and this checks the bare tier count.
    const M = P(1, 1);
    await placeExpectAt(a, M.x, M.y, T.MilitiaPost);
    await placeExpectAt(a, M.x, M.y, T.MilitiaPost, M.x, M.y); // upgrade = place ON the camp
    await placeExpectAt(a, M.x, M.y, T.MilitiaPost, M.x, M.y);
    const pk = kinds(a, "pikeman");
    result(pk.length === 10, `(e) setup: ${pk.length} pikemen; grain=${a.snap.grain}; happiness=${a.snap.happiness}`);

    const events = [];
    let lastDawnAt = null;
    a.onSnap = (prev, next) => {
      if (prev.isNight && !next.isNight) lastDawnAt = next.at;
      const nextIds = new Set(next.colonists.map((k) => k.id));
      const gone = prev.colonists.filter((k) => SOLDIER.has(k.kind) && !nextIds.has(k.id));
      if (!gone.length) return;
      const prevMobIds = new Set(prev.mobs.map((m) => m.id));
      const newMobs = next.mobs.filter((m) => !prevMobIds.has(m.id));
      events.push({ at: next.at, dawn: prev.isNight && !next.isNight, happinessPrev: prev.happiness, gone, newMobs });
    };
    let lowSeen = false;
    // Day 60s + night 40s: each low-happiness dawn deserts each soldier with 15% chance, so watch up to 3 dawns.
    const until = Date.now() + 330000;
    while (Date.now() < until) {
      await sleep(250);
      if (a.snap.happiness < 35) lowSeen = true;
      if (events.some((ev) => ev.dawn && ev.newMobs.length > 0)) break;
    }
    a.onSnap = null;
    info(`happiness now ${a.snap.happiness} (foodTypes grain=${a.snap.grain} meat=${a.snap.meat} fruit=${a.snap.fruit}); low(<35) seen=${lowSeen}`);
    const des = events.filter((ev) => ev.dawn && ev.newMobs.length > 0);
    if (des.length) {
      const ev = des[0];
      const deserterMobs = ev.newMobs.filter((m) => m.maxHp === 80 && m.hp === 80);
      const posMatch = ev.gone.every((k) => deserterMobs.some((m) => Math.hypot(m.x - k.x, m.y - k.y) < 1));
      result(deserterMobs.length === ev.gone.length && posMatch,
        `(e) at dawn (prev-tick happiness ${ev.happinessPrev} < 35): ${ev.gone.length} ${[...new Set(ev.gone.map((k) => k.kind))]} vanished and ${deserterMobs.length} new mob(s) with hp/maxHp 80/80 appeared at their exact positions`);
      // Dormant: the deserter mob does not move on its own. (Loyal pikemen in range may attack it - that's expected.)
      const id = deserterMobs[0].id;
      const p0 = deserterMobs[0];
      await sleep(1500);
      const m1 = a.snap.mobs.find((m) => m.id === id);
      result(!m1 || Math.hypot(m1.x - p0.x, m1.y - p0.y) < 1,
        m1 ? `(e) deserter ${id.slice(0, 8)} stayed put for 1.5s (dormant), hp=${m1.hp}/${m1.maxHp}` : `(e) deserter ${id.slice(0, 8)} already killed (by loyal guards in alert range) - never moved while alive`);
      const remaining = kinds(a, "pikeman").length;
      info(`remaining pikemen=${remaining}, mobs=${a.snap.mobs.length} [${a.snap.mobs.map((m) => `${m.hp}/${m.maxHp}`).join(", ")}], gold=${a.snap.gold}`);
    } else {
      const deaths = events.length;
      result(false, `(e) no dawn desertion observed in window (lowSeen=${lowSeen}, soldier-removal events=${deaths}) - see report`);
    }
  }
}

await restart(a, "(F)");
clearInterval(defend);
console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails ? 1 : 0);
