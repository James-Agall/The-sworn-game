// Scripted test: night shelter with houses + Town Center overflow (assignShelter / houseCapacity /
// isAtShelter / ColonistSnapshot.sheltered). Rules: at night every civilian sleeps in the nearest house
// that still has a free bed (House 1, BigHouse 3, HouseLevel2 5 beds); whoever is left over, or everyone
// when there are no houses, shelters at the Town Center. `sheltered` is true only while a civilian is
// within 1.5 tiles of its own shelter, and goes false at dawn.
//   Day 1:   9 civilians (4 farms, Tailor, Luxury Workshop, Blacksmith, 2 Lumberjacks) + a Knight Post
//            (mob bait) at a production site away from the TC. No houses.
//   Night 1: with zero houses, every civilian ends at the TC, sheltered=true.
//   Dawn 1:  sheltered goes false for everyone.
//   Day 2:   3 houses at a separate site: H1 House -> BigHouse -> HouseLevel2 when goods allow, H2 + H3 Houses.
//   Night 2: houses full (each occupant at a distinct house, none over capacity), the rest at the TC; no
//            civilian sits at a house while a nearer house still has a free bed; then H3 is demolished
//            mid-night and its occupant must re-shelter at the TC (all other beds are taken).
//   Dawn 2:  sheltered goes false for everyone.
// Takes ~3.5 minutes. Needs a fresh server with no other players and COLONY_TEST_HOOKS=1 (setStock); run
// with COLONY_WORLD_SIZE=80.
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
  Empty: 0, Lumberjack: 3, FarmPlot: 4, KnightPost: 5, TownCenter: 12, House: 13, BigHouse: 14, HouseLevel2: 15,
  Pasture: 21, Orchard: 22, WoolFarm: 23, CottonFarm: 24, TailorShop: 25, Blacksmith: 26, LuxuryWorkshop: 27,
};
const BEDS = { [T.House]: 1, [T.BigHouse]: 3, [T.HouseLevel2]: 5 };
const CIVILIAN = new Set(["lumberjack", "farmer", "ironMiner", "rockMiner", "farmhand", "artisan"]);
const TILE = 32;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tiles: [], tileUpdates: [], onSnap: null, hooks: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      if (c.onSnap) c.onSnap(prev, m);
    } else if (m.type === "testHookResult") {
      c.hooks.push(m);
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.hook = async (op, args = {}) => {
    const before = c.hooks.length;
    c.send({ type: "testHook", op, ...args });
    const deadline = Date.now() + 60000;
    while (c.hooks.length === before) {
      if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}: is COLONY_TEST_HOOKS=1 set?`);
      await sleep(5);
    }
    return c.hooks[c.hooks.length - 1];
  };
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => c.inBounds(x, y) && (c.tileAt(x, y) === T.Empty || c.tileAt(x, y) === T.FarmPlot);
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
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = c.meTile();
    const me = c.me();
    const centred = Math.abs(me.x - (s.x * TILE + 16)) <= 5 && Math.abs(me.y - (s.y * TILE + 16)) <= 5;
    if (t.x === s.x && t.y === s.y && centred) return true;
    const path = pathTo(c, s);
    if (!path) {
      await sleep(500);
      continue;
    }
    await walkPath(c, path.length ? path : [s]);
  }
  const t = c.meTile();
  return t.x === s.x && t.y === s.y;
}

const colonistOnTile = (c, x, y) =>
  c.snap.colonists.some((k) => Math.floor(k.x / TILE) === x && Math.floor(k.y / TILE) === y);

async function placeExpect(c, x, y, tile, expectTile = tile, tries = 6) {
  for (let i = 0; i < tries; i++) {
    for (let w = 0; w < 50 && colonistOnTile(c, x, y); w++) await sleep(100);
    const since = Date.now();
    c.send({ type: "setTile", tileX: x, tileY: y, tile });
    await sleep(400);
    if (c.tileUpdates.some((u) => u.at >= since && u.tileX === x && u.tileY === y && u.tile === expectTile)) return true;
    await sleep(300);
  }
  return false;
}

// Nearest reachable standing tile whose 5x5 box is Empty, with its centre between minTc and maxTc tiles
// from the Town Center and at least minAway tiles from every tile in `away`.
function findSite(c, tc, minTc, maxTc, away = [], minAway = 0) {
  const { dist } = bfs(c);
  let best = null;
  for (const [k, d] of dist) {
    const x = k % c.W();
    const y = Math.floor(k / c.W());
    const dTc = Math.hypot(x - tc.x, y - tc.y);
    if (dTc < minTc || dTc > maxTc) continue;
    if (away.some((p) => Math.hypot(p.x - x, p.y - y) < minAway)) continue;
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

const a = connect();
await a.ready();
const TC = { x: Math.floor(a.W() / 2), y: Math.floor(a.H() / 2) };
info(`connected; TC=(${TC.x},${TC.y}) tile=${a.tileAt(TC.x, TC.y)} wood=${a.snap.wood} iron=${a.snap.iron} cap=${a.snap.populationCap} night=${a.snap.isNight}`);
const px = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const dTiles = (e, t) => Math.hypot(e.x - px(t).x, e.y - px(t).y) / TILE;
const tileStr = (e) => `(${Math.floor(e.x / TILE)},${Math.floor(e.y / TILE)})`;
const civs = (s = a.snap) => s.colonists.filter((k) => CIVILIAN.has(k.kind));

// ---- Day 1: production site ----
const P = findSite(a, TC, 6, 14);
if (!P) {
  result(false, "no production site found");
  process.exit(1);
}
result(await ensureAt(a, P), `walked to production site (${P.x},${P.y}), ${Math.hypot(P.x - TC.x, P.y - TC.y).toFixed(1)} tiles from the TC`);
// Outer ring (distance 2) minus (0,-2)/(0,+2), which stay open as exits; inner ring stays walkable.
const prodPlan = [
  [T.Pasture, -2, -1], [T.Orchard, -2, 0], [T.WoolFarm, -2, 1], [T.CottonFarm, -1, 2],
  [T.TailorShop, 1, 2], [T.LuxuryWorkshop, 2, 1], [T.Blacksmith, -1, -2],
  [T.Lumberjack, 1, -2], [T.Lumberjack, 2, -1], [T.KnightPost, 2, 0],
];
let placedProd = 0;
for (const [tile, dx, dy] of prodPlan) if (await placeExpect(a, P.x + dx, P.y + dy, tile)) placedProd++;
await sleep(500);
result(placedProd === prodPlan.length, `production site: ${placedProd}/${prodPlan.length} buildings placed; civilians=${civs().length} pop=${a.snap.population}/${a.snap.populationCap}`);
const civCount = civs().length;
info(`civilians: ${civs().map((k) => k.kind).join(",")}`);

// Returns the shelters (TC or house tiles) within 1.5 tiles of a colonist.
function sheltersNear(k, houses) {
  const out = [];
  if (dTiles(k, TC) <= 1.5) out.push("TC");
  for (const h of houses) if (dTiles(k, h) <= 1.5) out.push(`${h.x},${h.y}`);
  return out;
}

// Wait for night, then until every civilian reports sheltered (stable for 1s) or `maxMs` passes.
// Captures the exact snapshot of each day->night and night->day transition.
let lastNightfall = null, lastDawn = null;
a.onSnap = (prev, m) => {
  if (prev && !prev.isNight && m.isNight) lastNightfall = m;
  if (prev && prev.isNight && !m.isNight) lastDawn = m;
};

async function waitNightSettled(maxMs) {
  lastNightfall = null;
  while (!lastNightfall) await sleep(50);
  const nightStart = lastNightfall;
  const since = Date.now();
  let stableSince = null;
  while (Date.now() - since < maxMs && a.snap.isNight) {
    const all = civs().length > 0 && civs().every((k) => k.sheltered);
    if (all) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince > 1000) break;
    } else stableSince = null;
    await sleep(100);
  }
  return { nightStart, settled: a.snap };
}

async function checkDawn(label) {
  lastDawn = null;
  while (!lastDawn) await sleep(50);
  // The snapshot of the first day tick (each civilian clears its sheltering state in that tick).
  const s = lastDawn;
  const still = civs(s).filter((k) => k.sheltered);
  result(civs(s).length > 0 && still.length === 0, `${label} first day snapshot: sheltered=true for ${still.length}/${civs(s).length} civilians (expected 0)`);
}

// ---- Night 1: no houses -> everyone at the TC ----
{
  const { settled } = await waitNightSettled(30000);
  const cs = civs(settled);
  const atTc = cs.filter((k) => k.sheltered && dTiles(k, TC) <= 1.5);
  result(cs.length === civCount && atTc.length === cs.length,
    `(night 1, no houses) ${atTc.length}/${cs.length} civilians sheltered within 1.5 tiles of the TC: ${cs.map((k) => `${k.kind}${tileStr(k)} ${dTiles(k, TC).toFixed(2)}t sh=${k.sheltered}`).join(" | ")}`);
  await checkDawn("(dawn 1)");
}

// ---- Day 2: houses ----
const Hs = findSite(a, TC, 6, 16, [P], 7);
if (!Hs) {
  result(false, "no house site found");
  process.exit(1);
}
result(await ensureAt(a, Hs), `walked to house site (${Hs.x},${Hs.y}), ${Math.hypot(Hs.x - TC.x, Hs.y - TC.y).toFixed(1)} tiles from the TC`);
const H1 = { x: Hs.x - 2, y: Hs.y - 1 }, H2 = { x: Hs.x + 2, y: Hs.y - 1 }, H3 = { x: Hs.x, y: Hs.y + 2 };
const houses = [H1, H2, H3];
for (const h of [H2, H3, H1]) {
  while (a.snap.wood < 10 && !a.snap.isNight) await sleep(250);
  result(await placeExpect(a, h.x, h.y, T.House), `House placed at (${h.x},${h.y}) (wood now ${a.snap.wood})`);
}
// Slow farming: the day-1 farms only deliver after 3 days of tending, so the goods the two house upgrades
// need are granted directly (testHook setStock; this test is about shelter, not production). Extra fruit
// because the Luxury Workshop keeps eating it.
{
  const st = (await a.hook("setStock", { stock: {} })).stock;
  await a.hook("setStock", {
    stock: { grain: st.grain + 10, meat: st.meat + 10, fruit: st.fruit + 40, clothes: st.clothes + 5, tools: st.tools + 2, luxuryItems: st.luxuryItems + 1 },
  });
}
// Upgrade H1 as far as the goods allow before night (leave ~6s of day so the result settles).
const dayLeft = () => !a.snap.isNight && a.snap.cycleProgress < a.snap.dayFraction - 0.03;
const goods = () => `grain=${a.snap.grain} meat=${a.snap.meat} fruit=${a.snap.fruit} clothes=${a.snap.clothes} tools=${a.snap.tools} lux=${a.snap.luxuryItems} wood=${a.snap.wood}`;
for (const [from, to, can] of [
  [T.House, T.BigHouse, (s) => s.grain >= 1 && s.meat >= 1 && s.fruit >= 1 && s.clothes >= 2 && s.wood >= 10],
  [T.BigHouse, T.HouseLevel2, (s) => s.grain >= 2 && s.meat >= 2 && s.fruit >= 2 && s.clothes >= 3 && s.tools >= 2 && s.luxuryItems >= 1 && s.wood >= 10],
]) {
  if (a.tileAt(H1.x, H1.y) !== from) break;
  while (dayLeft() && !can(a.snap)) await sleep(250);
  if (!can(a.snap)) {
    info(`H1 not upgraded past ${from} before night (${goods()})`);
    break;
  }
  result(await placeExpect(a, H1.x, H1.y, T.House, to, 3), `H1 upgraded ${from} -> ${to} (${goods()})`);
}
const beds = () => houses.reduce((n, h) => n + (BEDS[a.tileAt(h.x, h.y)] ?? 0), 0);
info(`houses: ${houses.map((h) => `(${h.x},${h.y})=${a.tileAt(h.x, h.y)}`).join(" ")}; beds=${beds()} civilians=${civs().length}`);
result(a.tileAt(H1.x, H1.y) === T.HouseLevel2, `H1 reached HouseLevel2 (5 beds) before night 2 (tile ${a.tileAt(H1.x, H1.y)}); if not, the 5-bed case is untested`);

// ---- Night 2: houses fill first, overflow to the TC ----
{
  // Track each civilian's position on the first night tick (shelter is assigned on that tick).
  const { nightStart, settled } = await waitNightSettled(25000);
  const cs = civs(settled);
  const totalBeds = beds();
  const where = new Map(); // id -> "TC" | "x,y"
  const ambiguous = [];
  for (const k of cs) {
    const near = sheltersNear(k, houses);
    if (near.length === 1) where.set(k.id, near[0]);
    else ambiguous.push(`${k.kind}${tileStr(k)}:${near.join("/") || "none"}`);
  }
  const occ = (key) => cs.filter((k) => where.get(k.id) === key).length;
  const houseKey = (h) => `${h.x},${h.y}`;
  info(`night 2 settled: ${cs.map((k) => `${k.kind}${tileStr(k)} sh=${k.sheltered} @${where.get(k.id) ?? "?"}`).join(" | ")}`);
  info(`occupancy: TC=${occ("TC")} ${houses.map((h) => `${houseKey(h)}[${a.tileAt(h.x, h.y)}]=${occ(houseKey(h))}/${BEDS[a.tileAt(h.x, h.y)]}`).join(" ")}`);
  result(cs.length === civCount && cs.every((k) => k.sheltered) && ambiguous.length === 0,
    `(night 2) all ${cs.length} civilians sheltered, each next to exactly one shelter (ambiguous/none: ${ambiguous.join(" ") || "-"})`);
  result(houses.every((h) => occ(houseKey(h)) <= BEDS[a.tileAt(h.x, h.y)]), `(night 2) no house over capacity`);
  result(houses.every((h) => occ(houseKey(h)) === BEDS[a.tileAt(h.x, h.y)]) && occ("TC") === cs.length - totalBeds,
    `(night 2) ${totalBeds} beds for ${cs.length} civilians: every bed used, the other ${cs.length - totalBeds} at the TC (TC has ${occ("TC")})`);
  // Nearest-house preference: nobody sleeps at a house (or the TC) while a strictly nearer house (from
  // where they stood at nightfall) still has a free bed; beds only fill up during the night.
  const violations = [];
  for (const k of cs) {
    const w = where.get(k.id);
    const start = nightStart.colonists.find((o) => o.id === k.id);
    if (!w || !start) continue;
    const myD = w === "TC" ? Infinity : Math.hypot(start.x - px(houses.find((h) => houseKey(h) === w)).x, start.y - px(houses.find((h) => houseKey(h) === w)).y);
    for (const h of houses) {
      if (houseKey(h) === w) continue;
      const dH = Math.hypot(start.x - px(h).x, start.y - px(h).y);
      if (dH < myD - 8 && occ(houseKey(h)) < BEDS[a.tileAt(h.x, h.y)]) violations.push(`${k.kind}${tileStr(start)}@${w} but (${houseKey(h)}) nearer with a free bed`);
    }
  }
  result(violations.length === 0, `(night 2) nearest-house preference: ${violations.length ? violations.join("; ") : "no civilian skipped a nearer house with a free bed"}`);

  // Demolish H3 mid-night: its occupant must re-shelter (every other bed is taken -> the TC).
  const evicted = cs.filter((k) => where.get(k.id) === houseKey(H3));
  const tcBefore = occ("TC");
  if (!(await ensureAt(a, Hs))) info(`could not get back to the house site (player at ${tileStr(a.me())})`);
  const okBreak = await placeExpect(a, H3.x, H3.y, T.Empty, T.Empty, 3);
  result(okBreak, `(night 2) H3 (${H3.x},${H3.y}) demolished at night (isNight=${a.snap.isNight}); its occupants: ${evicted.map((k) => k.kind).join(",") || "none"}`);
  const since = Date.now();
  const remaining = houses.filter((h) => h !== H3);
  let s = a.snap;
  while (Date.now() - since < 15000 && a.snap.isNight) {
    s = a.snap;
    const done = evicted.every((e) => {
      const k = s.colonists.find((o) => o.id === e.id);
      return k && k.sheltered && dTiles(k, TC) <= 1.5;
    });
    if (done) break;
    await sleep(100);
  }
  const ev = evicted.map((e) => s.colonists.find((o) => o.id === e.id));
  result(evicted.length > 0 && ev.every((k) => k && k.sheltered && dTiles(k, TC) <= 1.5),
    `(night 2) evicted occupant(s) re-sheltered at the TC: ${ev.map((k) => k ? `${k.kind}${tileStr(k)} ${dTiles(k, TC).toFixed(2)}t sh=${k.sheltered}` : "gone").join(" | ")} (night=${s.isNight}, ${((Date.now() - since) / 1000).toFixed(1)}s)`);
  const cs2 = civs(s);
  const occ2 = (h) => cs2.filter((k) => sheltersNear(k, remaining).includes(houseKey(h))).length;
  result(remaining.every((h) => occ2(h) <= BEDS[a.tileAt(h.x, h.y)]) && cs2.filter((k) => dTiles(k, TC) <= 1.5).length === tcBefore + evicted.length,
    `(night 2) after demolition: ${remaining.map((h) => `(${houseKey(h)})=${occ2(h)}/${BEDS[a.tileAt(h.x, h.y)]}`).join(" ")}, TC ${tcBefore} -> ${cs2.filter((k) => dTiles(k, TC) <= 1.5).length}`);
  await checkDawn("(dawn 2)");
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
