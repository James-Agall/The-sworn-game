// Scripted test: wall costs, wood/rock gathering, infinite iron ore, tree regrowth.
// Rewritten 2026-10-31 for today's rules: any world size (the runner boots 160 with COLONY_INSTANT_BUILD=1 and
// COLONY_TEST_HOOKS=1), a starting stock (zeroed here with setStock), walls 3 wood / 3 rock, mines placed ON an
// IronOre / Rock tile (the player is teleported next to one).
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let welcome = null;
let snap = null;
const tileUpdates = [];
const tiles = [];
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let W = 0;
const T = { Empty: 0, Wall: 1, Tree: 2, Lumber: 3, IronOre: 7, Rock: 8, IronMine: 9, RockMine: 10, StoneWall: 11 };
const tileAt = (x, y) => tiles[y * W + x];
const send = (m) => ws.send(JSON.stringify(m));
const place = (x, y, tile) => send({ type: "setTile", tileX: x, tileY: y, tile });
const hookResults = new Map();
const hook = async (op, args = {}) => {
  hookResults.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 300 && !hookResults.has(op); i++) await sleep(10);
  return hookResults.get(op);
};
const WALL_COST = 3;
const ironHistory = [];

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    W = m.worldTilesX;
    tiles.push(...m.tiles);
  } else if (m.type === "testHookResult") {
    hookResults.set(m.op, m);
  } else if (m.type === "snapshot") {
    if (snap && m.iron !== snap.iron) ironHistory.push({ t: el(), iron: m.iron });
    snap = m;
  } else if (m.type === "tileUpdate") {
    tileUpdates.push({ ...m, prev: tileAt(m.tileX, m.tileY), at: Date.now() });
    tiles[m.tileY * W + m.tileX] = m.tile;
  }
});

await new Promise((r) => ws.on("open", r));
while (!welcome || !snap) await sleep(20);
const initialIronOre = new Set();
for (let i = 0; i < welcome.tiles.length; i++) if (welcome.tiles[i] === T.IronOre) initialIronOre.add(i);
console.log(`[${el()}] connected; initial trees=${welcome.tiles.filter((t) => t === T.Tree).length} ironOre=${initialIronOre.size} rock=${welcome.tiles.filter((t) => t === T.Rock).length}`);

await hook("setRaids", { enabled: false });
await hook("setGoalIndex", { index: 3 }); // no first-goal payouts inside the exact stock checks
await hook("setStock", { stock: { wood: 0, rock: 0, iron: 0 } });
await sleep(150);
const me = () => snap.players.find((p) => p.id === welcome.id);
const tp = async (x, y) => {
  await hook("teleportPlayer", { x: x * 32 + 16, y: y * 32 + 16 });
  await sleep(150);
};
// Empty tiles within reach (2.5 tiles) of the player, excluding the player's tile.
const P0 = { x: Math.floor(me().x / 32), y: Math.floor(me().y / 32) };
const cands = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 6.25) continue;
    const x = P0.x + dx, y = P0.y + dy;
    if (tileAt(x, y) === T.Empty) cands.push({ x, y, d: dx * dx + dy * dy });
  }
// Prefer outer ring for posts so they don't box the player in.
cands.sort((a, b) => b.d - a.d);
console.log(`[${el()}] ${cands.length} empty tiles in reach`);
const take = () => {
  const i = cands.findIndex((c) => tileAt(c.x, c.y) === T.Empty);
  return i >= 0 ? cands.splice(i, 1)[0] : null;
};
const updatesFor = (c, since) => tileUpdates.filter((u) => u.tileX === c.x && u.tileY === c.y && u.at >= since);

// (a) / (b) rejected walls with 0 stock
for (const [name, tile, stockKey] of [["Wood Wall", T.Wall, "wood"], ["Stone Wall", T.StoneWall, "rock"]]) {
  const c = cands[cands.length - 1];
  const since = Date.now();
  const stock = snap[stockKey];
  place(c.x, c.y, tile);
  await sleep(500);
  result(stock === 0 && updatesFor(c, since).length === 0 && tileAt(c.x, c.y) === T.Empty,
    `${name} with ${stockKey}=${stock} rejected (no tileUpdate, tile Empty)`);
}

// (c)/(e) place gatherer posts: a Lumberjack in reach, each mine ON the nearest Rock / IronOre tile (with an
// Empty neighbour for its miner), the player teleported beside it.
const nearestOf = (type) => {
  let best = null;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== type) continue;
    const x = i % W, y = Math.floor(i / W);
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((n) => tileAt(n.x, n.y) === T.Empty);
    if (!side) continue;
    const d = Math.hypot(x - P0.x, y - P0.y);
    if (!best || d < best.d) best = { x, y, side, d };
  }
  return best;
};
const posts = {};
for (const [name, tile, on] of [["Lumberjack", T.Lumber, null], ["RockMine", T.RockMine, T.Rock], ["IronMine", T.IronMine, T.IronOre]]) {
  let c;
  if (on === null) c = take();
  else {
    const n = nearestOf(on);
    if (!n) {
      result(false, `no ${name} site (no ${on === T.Rock ? "Rock" : "IronOre"} tile with an Empty side)`);
      continue;
    }
    await tp(n.side.x, n.side.y);
    c = n;
  }
  const since = Date.now();
  place(c.x, c.y, tile);
  await sleep(300);
  const ok = updatesFor(c, since).some((u) => u.tile === tile);
  posts[name] = c;
  result(ok, `${name} post placed at (${c.x},${c.y})`);
}
await tp(P0.x, P0.y);

// (d) wall purchases once stock available; (c) stocks increase
const doWall = async (name, tile, stockKey) => {
  while (snap[stockKey] < WALL_COST && Date.now() - t0 < 120000) await sleep(100);
  if (snap[stockKey] < WALL_COST) return result(false, `${stockKey} never reached ${WALL_COST} within budget`);
  result(true, `${stockKey} increased to ${snap[stockKey]} (gathering works)`);
  const c = take();
  if (!c) return result(false, `no empty tile in reach for ${name}`);
  // Freeze gathering for the exact cost check (pause does not block placements).
  send({ type: "pause" });
  while (!snap.isPaused) await sleep(20);
  const before = snap[stockKey];
  const since = Date.now();
  place(c.x, c.y, tile);
  let upd = null;
  while (!upd && Date.now() - since < 1000) {
    await sleep(20);
    upd = updatesFor(c, since).find((u) => u.tile === tile);
  }
  await sleep(120); // let a snapshot arrive after the placement tick
  const after = snap[stockKey];
  send({ type: "pause" });
  while (snap.isPaused) await sleep(20);
  result(!!upd && after === before - WALL_COST, `${name} accepted at (${c.x},${c.y}); ${stockKey} ${before} -> ${after} (-${WALL_COST})`);
};
await doWall("Wood Wall", T.Wall, "wood");
await doWall("Stone Wall", T.StoneWall, "rock");

// (e) iron reaches >= 2 without any initial IronOre tile turning Empty
while (snap.iron < 2 && Date.now() - t0 < 180000) await sleep(200);
// The Iron Mine itself sits on one ore tile (placed there on purpose): every other ore tile must survive.
const mineKey = posts.IronMine ? posts.IronMine.y * W + posts.IronMine.x : -1;
const oreDestroyed = tileUpdates.filter((u) => u.tileY * W + u.tileX !== mineKey && initialIronOre.has(u.tileY * W + u.tileX) && u.tile !== T.IronOre);
const oreNow = tiles.filter((t) => t === T.IronOre).length + (initialIronOre.has(mineKey) ? 1 : 0);
console.log(`[${el()}] iron history: ${JSON.stringify(ironHistory)}`);
result(snap.iron >= 2 && oreDestroyed.length === 0 && oreNow === initialIronOre.size,
  `iron mined ${snap.iron}x, ore tiles destroyed=${oreDestroyed.length}, IronOre count ${initialIronOre.size} -> ${oreNow}`);

// (f) tree regrowth (ensure >= 30s elapsed)
while (Date.now() - t0 < 30000) await sleep(200);
const grown = tileUpdates.filter((u) => u.tile === T.Tree);
console.log(`[${el()}] tree growth events: ${grown.map((u) => `(${u.tileX},${u.tileY})@${((u.at - t0) / 1000).toFixed(1)}s prev=${u.prev}`).join(" ")}`);
result(grown.length >= 2 && grown.every((u) => u.prev === T.Empty),
  `${grown.length} trees grew (from Empty tiles) in ${el()}; trees now=${tiles.filter((t) => t === T.Tree).length}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
ws.close();
process.exit(fails ? 1 : 0);
