// Scripted test: global pause freezes simulation; restart resets the world for every connected player.
import WebSocket from "ws";

const URL = `ws://localhost:${process.env.PORT ?? 8080}`;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// World size and Town Center come from the server (welcome / first snapshot), not a fixed 40x40 map.
let W = 0;
const TS = 32;
let TC = null;
const T = { Empty: 0, Wall: 1, KnightPost: 5, TownCenter: 12 };

function client(label) {
  const c = {
    label,
    ws: new WebSocket(URL),
    welcomes: [],
    tiles: [],
    snap: null,
    snapCount: 0,
    tileUpdates: [],
  };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcomes.push({ ...m, at: Date.now(), snapCountAt: c.snapCount });
      W = m.worldTilesX;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      c.snap = m;
      c.snapCount++;
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, at: Date.now() });
      c.tiles[m.tileY * W + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap?.players.find((p) => p.id === c.welcomes[0].id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (c.welcomes.length === 0 || !c.snap) await sleep(20);
  };
  // Wait until at least n snapshots after the given count.
  c.nextSnaps = async (n = 1) => {
    const start = c.snapCount;
    while (c.snapCount < start + n) await sleep(10);
    return c.snap;
  };
  return c;
}

const nearTownCenter = (p) =>
  Math.hypot(p.x - (TC.x * TS + TS / 2), p.y - (TC.y * TS + TS / 2)) <= TS + 0.01;

const a = client("A");
await a.ready();
const myId = a.welcomes[0].id;
TC = { x: a.snap.townCenters[0].x, y: a.snap.townCenters[0].y };
console.log(`[${el()}] A connected id=${myId}; world ${W}x${a.welcomes[0].worldTilesY}, Town Center (${TC.x},${TC.y})`);

// Make sure we start unpaused (shared dev server may have been left paused).
if (a.snap.isPaused) {
  a.send({ type: "pause" });
  await a.nextSnaps(2);
}
result(a.snap.isPaused === false, `initial isPaused=false`);

// ---- (b-setup) build a Wood Wall + Knight Post near the player ----
const tileAt = (x, y) => a.tiles[y * W + x];
const me0 = a.me();
const ptx = Math.floor(me0.x / TS);
const pty = Math.floor(me0.y / TS);
const cands = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    const x = ptx + dx, y = pty + dy;
    const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
    if (Math.hypot(me0.x - cx, me0.y - cy) > TS * 2.5) continue;
    if ((x === ptx && y === pty) || tileAt(x, y) !== T.Empty) continue;
    // Keep the 4 tiles around the town center open so spawn stays reachable.
    if (Math.abs(x - TC.x) + Math.abs(y - TC.y) <= 1) continue;
    cands.push({ x, y, d: dx * dx + dy * dy });
  }
cands.sort((p, q) => q.d - p.d);

const placeAndWait = async (c, tile) => {
  const since = Date.now();
  a.send({ type: "setTile", tileX: c.x, tileY: c.y, tile });
  let upd = null;
  while (!upd && Date.now() - since < 1000) {
    await sleep(20);
    upd = a.tileUpdates.find((u) => u.tileX === c.x && u.tileY === c.y && u.tile === tile && u.at >= since);
  }
  await a.nextSnaps(2);
  return upd;
};

const wallSpot = cands.shift();
const woodBefore = a.snap.wood;
const wallUpd = await placeAndWait(wallSpot, T.Wall);
// WOOD_WALL_COST 3; needs COLONY_INSTANT_BUILD=1 (otherwise placements become construction sites).
result(!!wallUpd && a.snap.wood === woodBefore - 3,
  `Wood Wall placed at (${wallSpot.x},${wallSpot.y}); wood ${woodBefore} -> ${a.snap.wood}`);

const knightSpot = cands.shift();
const ironBefore = a.snap.iron;
const knightUpd = await placeAndWait(knightSpot, T.KnightPost);
const knightCount = () => a.snap.colonists.filter((c) => c.kind === "knight").length;
result(!!knightUpd && a.snap.iron === ironBefore - 10 && knightCount() === 1,
  `Knight Post placed at (${knightSpot.x},${knightSpot.y}); iron ${ironBefore} -> ${a.snap.iron}; knights=${knightCount()}`);

// ---- (a) pause freezes player movement (and colonists) ----
a.send({ type: "pause" });
await a.nextSnaps(2);
result(a.snap.isPaused === true, `after pause: isPaused=${a.snap.isPaused}`);

a.send({ type: "input", dx: 1, dy: 0 });
await a.nextSnaps(1);
const pBefore = { ...a.me() };
const colsBefore = new Map(a.snap.colonists.map((c) => [c.id, { x: c.x, y: c.y }]));
await sleep(500);
const pAfter = a.me();
result(pAfter.x === pBefore.x && pAfter.y === pBefore.y,
  `paused: player pos unchanged with input held (${pBefore.x.toFixed(1)},${pBefore.y.toFixed(1)}) -> (${pAfter.x.toFixed(1)},${pAfter.y.toFixed(1)})`);
const colsMoved = a.snap.colonists.filter((c) => {
  const b = colsBefore.get(c.id);
  return !b || b.x !== c.x || b.y !== c.y;
}).length;
result(colsMoved === 0 && a.snap.colonists.length === colsBefore.size,
  `paused: colonists frozen (${colsMoved} moved/changed of ${colsBefore.size})`);
result(a.snap.isPaused === true, `paused: snapshots still flowing with isPaused=true`);

a.send({ type: "pause" });
await a.nextSnaps(2); // the first snapshot may have been in flight before the server processed the toggle
result(a.snap.isPaused === false, `after second pause: isPaused=${a.snap.isPaused}`);

// Movement resumes: try each direction until one moves (trees/walls may block some).
let moved = false;
for (const dir of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
  a.send({ type: "input", ...dir });
  await a.nextSnaps(1);
  const s = { ...a.me() };
  await sleep(300);
  const e = a.me();
  if (Math.hypot(e.x - s.x, e.y - s.y) > 5) {
    moved = true;
    result(true, `unpaused: player moved with input ${JSON.stringify(dir)} (${s.x.toFixed(1)},${s.y.toFixed(1)}) -> (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
    break;
  }
}
if (!moved) result(false, `unpaused: player did not move in any direction`);
a.send({ type: "input", dx: 0, dy: 0 });
await a.nextSnaps(2);

// ---- (b) restart (issued while paused, to also check it unpauses) ----
a.send({ type: "pause" });
await a.nextSnaps(2);
result(a.snap.isPaused === true, `re-paused before restart`);

const welcomesBefore = a.welcomes.length;
a.send({ type: "restart" });
while (a.welcomes.length === welcomesBefore) await sleep(10);
const w = a.welcomes[a.welcomes.length - 1];
result(w.id === myId, `fresh welcome after restart; id unchanged (${w.id === myId ? "same" : w.id + " != " + myId})`);
result(Array.isArray(w.tiles) && w.tiles.length === w.worldTilesX * w.worldTilesY, `welcome tiles length=${w.tiles.length} (${w.worldTilesX}x${w.worldTilesY})`);
result(w.tiles[TC.y * W + TC.x] === T.TownCenter, `town center tile restored`);
result(w.tiles[wallSpot.y * W + wallSpot.x] !== T.Wall && w.tiles[knightSpot.y * W + knightSpot.x] !== T.KnightPost,
  `previously built wall/knight post gone from fresh map`);
// (The old "only natural tiles" / fixed scatter-count checks are gone: world-gen now lays out biomes, water,
// ruins, encampments and the Abbey, with counts scaled by world size.)

const s = await a.nextSnaps(1);
result(s.wood === 80 && s.grain === 60 && s.iron === 60 && s.rock === 60,
  `post-restart stock wood=${s.wood} grain=${s.grain} iron=${s.iron} rock=${s.rock} (expected 80/60/60/60)`);
// The fresh colony has only its starting builder (Town Center base population 12).
result(s.population === 1 && s.populationCap === 12, `post-restart population=${s.population}/${s.populationCap} (expected 1/12)`);
result(s.townCenterHp === 1000, `post-restart townCenterHp=${s.townCenterHp} (expected 1000)`);
result(!s.colonists.some((c) => c.kind === "knight") && s.colonists.filter((c) => c.kind === "builder").length === 1,
  `post-restart colonists: no knights, 1 builder (${s.colonists.map((c) => c.kind).join(",")})`);
result(s.isPaused === false, `post-restart isPaused=${s.isPaused}`);
result(s.isNight === false, `post-restart isNight=${s.isNight} (cycle reset to day)`);
const meR = s.players.find((p) => p.id === myId);
result(!!meR && nearTownCenter(meR) && meR.hp === 100, `player repositioned next to TC with hp=${meR?.hp} at (${meR?.x},${meR?.y})`);

// ---- (c) restart with two players ----
const b = client("B");
await b.ready();
const idB = b.welcomes[0].id;
// Move A away from spawn so repositioning is observable.
let movedA = false;
for (const dir of [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]) {
  a.send({ type: "input", ...dir });
  await sleep(400);
  a.send({ type: "input", dx: 0, dy: 0 });
  await a.nextSnaps(2);
  if (!nearTownCenter(a.me())) { movedA = true; break; }
}
console.log(`[${el()}] A moved away from spawn before 2-player restart: ${movedA}`);

const aW = a.welcomes.length, bW = b.welcomes.length;
b.send({ type: "restart" });
while (a.welcomes.length === aW || b.welcomes.length === bW) await sleep(10);
result(a.welcomes.at(-1).id === myId && b.welcomes.at(-1).id === idB,
  `both players got fresh welcome with unchanged ids`);
result(a.welcomes.at(-1).tiles.join() === b.welcomes.at(-1).tiles.join(), `both welcomes carry the same fresh map`);
const s2 = await b.nextSnaps(1);
const pa = s2.players.find((p) => p.id === myId);
const pb = s2.players.find((p) => p.id === idB);
result(!!pa && !!pb && nearTownCenter(pa) && nearTownCenter(pb) && pa.hp === 100 && pb.hp === 100,
  `both players near TC with full hp: A=(${pa?.x},${pa?.y}) hp=${pa?.hp}, B=(${pb?.x},${pb?.y}) hp=${pb?.hp}`);
// Other clients (e.g. an open browser tab) may also be connected; every one must be reset.
const allReset = s2.players.every((p) => nearTownCenter(p) && p.hp === 100);
result(s2.players.length >= 2 && allReset,
  `all ${s2.players.length} connected players repositioned near TC with full hp`);

a.ws.close();
b.ws.close();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
