// Scripted test: starting stockpile, immediate Knight Post purchase, infinite rock deposits.
// Needs a private server with COLONY_TEST_HOOKS=1 (teleportPlayer) and COLONY_INSTANT_BUILD=1, no other players
// (any world size). The world size and Town Center come from the server (welcome / snapshot).
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let welcome = null;
let snap = null;
let firstSnap = null;
const tileUpdates = [];
const tiles = [];
const hooks = new Map();
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, KnightPost: 5, Rock: 8, RockMine: 10 };
let W = 0;
const tileAt = (x, y) => tiles[y * W + x];
const send = (m) => ws.send(JSON.stringify(m));
const place = (x, y, tile) => send({ type: "setTile", tileX: x, tileY: y, tile });
const hook = async (op, args = {}) => {
  hooks.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 300 && !hooks.has(op); i++) await sleep(10);
  return hooks.get(op);
};
const rockHistory = [];

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    W = m.worldTilesX;
    tiles.length = 0;
    tiles.push(...m.tiles);
  } else if (m.type === "snapshot") {
    if (!firstSnap) firstSnap = m;
    if (snap && m.rock !== snap.rock) rockHistory.push({ t: el(), rock: m.rock });
    snap = m;
  } else if (m.type === "tileUpdate") {
    tileUpdates.push({ ...m, prev: tileAt(m.tileX, m.tileY), at: Date.now() });
    tiles[m.tileY * W + m.tileX] = m.tile;
  } else if (m.type === "testHookResult") hooks.set(m.op, m);
});

await new Promise((r) => ws.on("open", r));
while (!welcome || !firstSnap) await sleep(20);
const initialRockCount = welcome.tiles.filter((t) => t === T.Rock).length;
console.log(`[${el()}] connected; world ${W}x${welcome.worldTilesY}, rock deposits=${initialRockCount}`);

// (a) starting stockpile (STARTING_WOOD / IRON / ROCK / GRAIN)
const { wood, grain, iron, rock } = firstSnap;
result(wood === 80 && grain === 60 && iron === 60 && rock === 60,
  `first snapshot stock wood=${wood} grain=${grain} iron=${iron} rock=${rock} (expected 80/60/60/60)`);

const me = () => snap.players.find((p) => p.id === welcome.id);
// Empty tiles within reach (2.5 tiles) of the player, excluding its own tile; outer ring first.
const reachable = (want) => {
  const p = me();
  const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
  const out = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = px + dx, y = py + dy;
      if ((dx === 0 && dy === 0) || Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) > TILE * 2.5) continue;
      if (tileAt(x, y) === want) out.push({ x, y, d: dx * dx + dy * dy });
    }
  return out.sort((a, b) => b.d - a.d);
};
const placeAndWait = async (c, tile) => {
  const since = Date.now();
  place(c.x, c.y, tile);
  let upd = null;
  while (!upd && Date.now() - since < 1000) {
    await sleep(20);
    upd = tileUpdates.find((u) => u.tileX === c.x && u.tileY === c.y && u.tile === tile && u.at >= since);
  }
  await sleep(120); // let a post-placement snapshot arrive
  return upd;
};

// (b) Knight Post immediately, no gathering (KNIGHT_IRON_COST 10 + KNIGHT_ROCK_COST 5)
{
  const c = reachable(T.Empty)[0];
  const before = { iron: snap.iron, rock: snap.rock };
  const upd = await placeAndWait(c, T.KnightPost);
  result(!!upd && snap.iron === before.iron - 10 && snap.rock === before.rock - 5,
    `Knight Post accepted at (${c.x},${c.y}) immediately; iron ${before.iron} -> ${snap.iron}, rock ${before.rock} -> ${snap.rock}`);
  result(snap.iron === 50 && snap.rock === 55, `post-Knight stock iron=${snap.iron} (exp 50) rock=${snap.rock} (exp 55)`);
}

// (c) A Quarry (Rock Mine, placed on a Rock deposit) mines twice; no other Rock tile is ever removed.
{
  const tc = snap.townCenters[0];
  let rockTile = null;
  for (let r = 2; r < 30 && !rockTile; r++)
    for (let y = tc.y - r; y <= tc.y + r && !rockTile; y++)
      for (let x = tc.x - r; x <= tc.x + r && !rockTile; x++)
        if (tileAt(x, y) === T.Rock && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(x + dx, y + dy) === T.Empty))
          rockTile = { x, y };
  const stand = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: rockTile.x + dx, y: rockTile.y + dy })).find((t) => tileAt(t.x, t.y) === T.Empty);
  await hook("teleportPlayer", { x: stand.x * TILE + 16, y: stand.y * TILE + 16 });
  await sleep(200);
  const watchFrom = Date.now();
  const upd = await placeAndWait(rockTile, T.RockMine);
  result(!!upd, `Rock Mine placed on the Rock deposit at (${rockTile.x},${rockTile.y})`);
  const base = snap.rock;
  while (snap.rock < base + 2 && Date.now() - watchFrom < 90000) await sleep(200);
  const rockRemoved = tileUpdates.filter((u) => u.at >= watchFrom && u.prev === T.Rock && u.tile !== T.Rock && !(u.tileX === rockTile.x && u.tileY === rockTile.y));
  const rockNow = tiles.filter((t) => t === T.Rock).length;
  console.log(`[${el()}] rock history: ${JSON.stringify(rockHistory)}`);
  result(snap.rock >= base + 2, `rock mined twice: ${base} -> ${snap.rock}`);
  result(rockRemoved.length === 0 && rockNow === initialRockCount - 1,
    `other Rock tiles removed=${rockRemoved.length}; Rock count ${initialRockCount} -> ${rockNow} (only the quarry's own deposit)`);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
ws.close();
process.exit(fails ? 1 : 0);
