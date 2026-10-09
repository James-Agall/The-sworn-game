// Scripted test: setTile -> tileUpdate round-trip for the tile types the client now renders as
// sprites (Wall, House, KnightPost), plus a demolish (sprite-removal path) and a restart (full
// welcome re-sync path). Server-side only: proves the messages that drive the client's
// setTileSprite still flow, not that the client paints them correctly. Needs a fresh server.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Wall: 1, KnightPost: 5, TownCenter: 12, House: 13 };
const TILE = 32;

const ws = new WebSocket(`ws://localhost:${PORT}`);
let welcome = null;
let welcomeCount = 0;
let snap = null;
let tiles = [];
const tileUpdates = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    welcomeCount++;
    tiles = [...m.tiles];
  } else if (m.type === "snapshot") {
    snap = m;
  } else if (m.type === "tileUpdate") {
    tileUpdates.push({ ...m, at: Date.now() });
    tiles[m.tileY * welcome.worldTilesX + m.tileX] = m.tile;
  }
});
const send = (m) => ws.send(JSON.stringify(m));
await new Promise((r) => ws.on("open", r));
while (!welcome || !snap) await sleep(20);
const W = welcome.worldTilesX;
const tileAt = (x, y) => tiles[y * W + x];
result(tiles.length === W * welcome.worldTilesY, `welcome: ${W}x${welcome.worldTilesY} tiles, tileSize ${welcome.tileSize}`);

const me = snap.players.find((p) => p.id === welcome.id);
const pt = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };
// Empty tiles in reach, outer ring first so placements don't box the player in.
const cands = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    if (dx === 0 && dy === 0) continue;
    const x = pt.x + dx, y = pt.y + dy;
    const c = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
    if (Math.hypot(me.x - c.x, me.y - c.y) > TILE * 2.5) continue;
    if (tileAt(x, y) === T.Empty) cands.push({ x, y, d: dx * dx + dy * dy });
  }
cands.sort((a, b) => b.d - a.d);
console.log(`info [${el()}] player at tile ${pt.x},${pt.y}; ${cands.length} empty tiles in reach; stock wood=${snap.wood} iron=${snap.iron} rock=${snap.rock}`);

async function placeAndExpect(name, tile) {
  const c = cands.shift();
  if (!c) return result(false, `${name}: no empty tile in reach`);
  const since = Date.now();
  send({ type: "setTile", tileX: c.x, tileY: c.y, tile });
  for (let i = 0; i < 50; i++) {
    const u = tileUpdates.find((u) => u.tileX === c.x && u.tileY === c.y && u.at >= since);
    if (u) {
      result(u.tile === tile, `${name} at ${c.x},${c.y}: tileUpdate broadcast with tile=${u.tile}`);
      return c;
    }
    await sleep(20);
  }
  result(false, `${name} at ${c.x},${c.y}: no tileUpdate within 1s`);
  return null;
}

const wall = await placeAndExpect("Wall", T.Wall);
await placeAndExpect("House", T.House);
await placeAndExpect("KnightPost", T.KnightPost);

if (wall) {
  const since = Date.now();
  send({ type: "setTile", tileX: wall.x, tileY: wall.y, tile: T.Empty });
  let u = null;
  for (let i = 0; i < 50 && !u; i++) {
    u = tileUpdates.find((u) => u.tileX === wall.x && u.tileY === wall.y && u.at >= since);
    if (!u) await sleep(20);
  }
  result(u?.tile === T.Empty, `demolish Wall at ${wall.x},${wall.y}: tileUpdate tile=${u?.tile}`);
}

// Restart -> server re-sends welcome (client's full redrawGrid/setTileSprite path).
const before = welcomeCount;
send({ type: "restart" });
for (let i = 0; i < 50 && welcomeCount === before; i++) await sleep(20);
result(welcomeCount === before + 1, `restart: fresh welcome received`);
result(tiles.filter((t) => t === T.TownCenter).length === 1, `restart: map has exactly one TownCenter`);
await sleep(500);
result(ws.readyState === ws.OPEN, `socket still open after restart`);

ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
process.exit(fails === 0 ? 0 : 1);
