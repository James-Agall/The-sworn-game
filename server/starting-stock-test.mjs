// Scripted test: starting stockpile, immediate Knight Post purchase, infinite rock deposits.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let welcome = null;
let snap = null;
let firstSnap = null;
const tileUpdates = [];
const tiles = [];
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 25;
const T = { Empty: 0, KnightPost: 5, Rock: 8, RockMine: 10 };
const tileAt = (x, y) => tiles[y * W + x];
const send = (m) => ws.send(JSON.stringify(m));
const place = (x, y, tile) => send({ type: "setTile", tileX: x, tileY: y, tile });
const rockHistory = [];

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    tiles.push(...m.tiles);
  } else if (m.type === "snapshot") {
    if (!firstSnap) firstSnap = m;
    if (snap && m.rock !== snap.rock) rockHistory.push({ t: el(), rock: m.rock });
    snap = m;
  } else if (m.type === "tileUpdate") {
    tileUpdates.push({ ...m, prev: tileAt(m.tileX, m.tileY), at: Date.now() });
    tiles[m.tileY * W + m.tileX] = m.tile;
  }
});

await new Promise((r) => ws.on("open", r));
while (!welcome || !firstSnap) await sleep(20);
const initialRockCount = welcome.tiles.filter((t) => t === T.Rock).length;
console.log(`[${el()}] connected; rock deposits=${initialRockCount}`);

// (a) starting stockpile
const { wood, food, iron, rock } = firstSnap;
result(wood === 20 && food === 10 && iron === 15 && rock === 15,
  `first snapshot stock wood=${wood} food=${food} iron=${iron} rock=${rock} (expected 20/10/15/15)`);

// Empty tiles within reach (2.5 tiles) of spawn (12,12), excluding spawn tile; outer ring first.
const cands = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > 6.25) continue;
    const x = 12 + dx, y = 12 + dy;
    if (tileAt(x, y) === T.Empty) cands.push({ x, y, d: dx * dx + dy * dy });
  }
cands.sort((a, b) => b.d - a.d);
const take = () => {
  const i = cands.findIndex((c) => tileAt(c.x, c.y) === T.Empty);
  return i >= 0 ? cands.splice(i, 1)[0] : null;
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

// (b) Knight Post immediately, no gathering
{
  const c = take();
  const before = { iron: snap.iron, rock: snap.rock };
  const upd = await placeAndWait(c, T.KnightPost);
  result(!!upd && snap.iron === before.iron - 10 && snap.rock === before.rock - 5,
    `Knight Post accepted at (${c.x},${c.y}) immediately; iron ${before.iron} -> ${snap.iron}, rock ${before.rock} -> ${snap.rock}`);
  result(snap.iron === 5 && snap.rock === 10, `post-Knight stock iron=${snap.iron} (exp 5) rock=${snap.rock} (exp 10)`);
}

// (c) Rock Mine mines twice, no Rock tile ever removed
{
  const c = take();
  const watchFrom = Date.now();
  const upd = await placeAndWait(c, T.RockMine);
  result(!!upd, `Rock Mine placed at (${c.x},${c.y})`);
  const base = snap.rock;
  while (snap.rock < base + 2 && Date.now() - watchFrom < 90000) await sleep(200);
  const rockRemoved = tileUpdates.filter((u) => u.at >= watchFrom && u.prev === T.Rock && u.tile !== T.Rock);
  const rockNow = tiles.filter((t) => t === T.Rock).length;
  console.log(`[${el()}] rock history: ${JSON.stringify(rockHistory)}`);
  result(snap.rock >= base + 2, `rock mined twice: ${base} -> ${snap.rock}`);
  result(rockRemoved.length === 0 && rockNow === initialRockCount,
    `Rock tiles removed=${rockRemoved.length}; Rock count ${initialRockCount} -> ${rockNow}`);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
ws.close();
process.exit(fails ? 1 : 0);
