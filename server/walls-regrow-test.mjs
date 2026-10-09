// Scripted test: wall costs, wood/rock gathering, infinite iron ore, tree regrowth.
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
const W = 25;
const T = { Empty: 0, Wall: 1, Tree: 2, Lumber: 3, IronOre: 7, Rock: 8, IronMine: 9, RockMine: 10, StoneWall: 11 };
const tileAt = (x, y) => tiles[y * W + x];
const send = (m) => ws.send(JSON.stringify(m));
const place = (x, y, tile) => send({ type: "setTile", tileX: x, tileY: y, tile });
const ironHistory = [];

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    tiles.push(...m.tiles);
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

// Empty tiles within reach (2.5 tiles) of spawn (12,12), excluding spawn tile.
const cands = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 6.25) continue;
    const x = 12 + dx, y = 12 + dy;
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

// (c)/(e) place gatherer posts
const posts = {};
for (const [name, tile] of [["Lumberjack", T.Lumber], ["RockMine", T.RockMine], ["IronMine", T.IronMine]]) {
  const c = take();
  const since = Date.now();
  place(c.x, c.y, tile);
  await sleep(300);
  const ok = updatesFor(c, since).some((u) => u.tile === tile);
  posts[name] = c;
  result(ok, `${name} post placed at (${c.x},${c.y})`);
}

// (d) wall purchases once stock available; (c) stocks increase
const doWall = async (name, tile, stockKey) => {
  while (snap[stockKey] < 1 && Date.now() - t0 < 70000) await sleep(100);
  if (snap[stockKey] < 1) return result(false, `${stockKey} never reached 1 within budget`);
  result(true, `${stockKey} increased to ${snap[stockKey]} (gathering works)`);
  const c = take();
  if (!c) return result(false, `no empty tile in reach for ${name}`);
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
  result(!!upd && after === before - 1, `${name} accepted at (${c.x},${c.y}); ${stockKey} ${before} -> ${after}`);
};
await doWall("Wood Wall", T.Wall, "wood");
await doWall("Stone Wall", T.StoneWall, "rock");

// (e) iron reaches >= 2 without any initial IronOre tile turning Empty
while (snap.iron < 2 && Date.now() - t0 < 100000) await sleep(200);
const oreDestroyed = tileUpdates.filter((u) => initialIronOre.has(u.tileY * W + u.tileX) && u.tile !== T.IronOre);
const oreNow = tiles.filter((t) => t === T.IronOre).length;
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
