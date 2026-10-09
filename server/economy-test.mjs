// Scripted economy test: placement costs, mining, knight purchase, farm food, dawn upkeep.
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
const tileAt = (x, y) => tiles[y * W + x];
const send = (m) => ws.send(JSON.stringify(m));
const place = (x, y, tile) => send({ type: "setTile", tileX: x, tileY: y, tile });

const snapHistory = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    tiles.push(...m.tiles);
  } else if (m.type === "snapshot") {
    snap = m;
    snapHistory.push({ t: Date.now(), food: m.food, colonists: m.colonists.length, isNight: m.isNight });
    if (snapHistory.length > 2000) snapHistory.shift();
  } else if (m.type === "tileUpdate") {
    tiles[m.tileY * W + m.tileX] = m.tile;
    tileUpdates.push(m);
  }
});

await new Promise((r) => ws.on("open", r));
while (!welcome || !snap) await sleep(20);

// Player is at (400,400) = tile (12,12). Candidate tiles within REACH (80px) excluding own tile.
const candidates = [];
for (let dx = -2; dx <= 2; dx++)
  for (let dy = -2; dy <= 2; dy++) {
    if (dx === 0 && dy === 0) continue;
    const x = 12 + dx, y = 12 + dy;
    const d = Math.hypot(dx * 32, dy * 32);
    if (d <= 80 && tileAt(x, y) === 0) candidates.push({ x, y, d });
  }
candidates.sort((a, b) => a.d - b.d);
console.log(`Empty reachable tiles: ${candidates.length}`);
const take = () => {
  const c = candidates.shift();
  if (!c) throw new Error("ran out of reachable empty tiles");
  return c;
};

// e. Farm early.
const farm = take();
place(farm.x, farm.y, 4);
await sleep(300);
result(tileAt(farm.x, farm.y) === 4 && snap.colonists.some((c) => c.kind === "farmer"), `Farm placed at ${farm.x},${farm.y}`);

// a. Knight post with 0 iron.
const kSpot = take();
const before = tileUpdates.length;
result(snap.iron === 0, `iron starts at 0 (iron=${snap.iron})`);
place(kSpot.x, kSpot.y, 5);
await sleep(500);
const kUpdate = tileUpdates.slice(before).some((u) => u.tileX === kSpot.x && u.tileY === kSpot.y);
result(!kUpdate && tileAt(kSpot.x, kSpot.y) === 0 && !snap.colonists.some((c) => c.kind === "knight"),
  `Knight Post rejected with 0 iron (no tileUpdate, tile still Empty, no knight)`);

// b. Archer post with 0 wood.
const before2 = tileUpdates.length;
result(snap.wood === 0, `wood starts at 0 (wood=${snap.wood})`);
place(kSpot.x, kSpot.y, 6);
await sleep(500);
const aUpdate = tileUpdates.slice(before2).some((u) => u.tileX === kSpot.x && u.tileY === kSpot.y);
result(!aUpdate && tileAt(kSpot.x, kSpot.y) === 0 && !snap.colonists.some((c) => c.kind === "archer"),
  `Archer Post rejected with 0 wood (no tileUpdate, tile still Empty, no archer)`);

// c. Iron mine + rock mine.
const iSpot = take();
place(iSpot.x, iSpot.y, 9);
const rSpot = take();
place(rSpot.x, rSpot.y, 10);
await sleep(300);
result(tileAt(iSpot.x, iSpot.y) === 9 && snap.colonists.some((c) => c.kind === "ironMiner"), `Iron Mine placed at ${iSpot.x},${iSpot.y} + ironMiner spawned`);
result(tileAt(rSpot.x, rSpot.y) === 10 && snap.colonists.some((c) => c.kind === "rockMiner"), `Rock Mine placed at ${rSpot.x},${rSpot.y} + rockMiner spawned`);

let firstIron = null, firstRock = null;
while (Date.now() - t0 < 45000 && (firstIron === null || firstRock === null)) {
  if (firstIron === null && snap.iron > 0) firstIron = el();
  if (firstRock === null && snap.rock > 0) firstRock = el();
  await sleep(100);
}
result(snap.iron > 0, `iron increased above 0 (first at ${firstIron}, now ${snap.iron})`);
result(snap.rock > 0, `rock increased above 0 (first at ${firstRock}, now ${snap.rock})`);
{ const ft = Date.now(); while (snap.food === 0 && Date.now() - ft < 15000) await sleep(100); }
result(snap.food > 0, `food accumulated from farm (food=${snap.food})`);

// Snapshot data around dawn: watch for the night->day transition.
let dawnCheck = null;
const watchDawn = (async () => {
  // Wait for night, then the transition back to day.
  while (!snap.isNight) await sleep(20);
  let lastNight = { food: snap.food, colonists: snap.colonists.length };
  while (snap.isNight) {
    lastNight = { food: snap.food, colonists: snap.colonists.length };
    await sleep(0);
    await new Promise((r) => ws.once("message", r));
  }
  dawnCheck = { before: lastNight, after: { food: snap.food, colonists: snap.colonists.length }, at: el() };
})();

// d. Wait for iron >= 15 (miner deposits ~1 per trip), up to a hard cap.
while (snap.iron < 15 && Date.now() - t0 < Number(process.env.IRON_WAIT_MS ?? 75000)) await sleep(200);
if (snap.iron >= 15) {
  // Find a free reachable spot (re-check, colonists may stand there).
  const ironBefore = snap.iron;
  const knightsBefore = snap.colonists.filter((c) => c.kind === "knight").length;
  const b3 = tileUpdates.length;
  let spot = kSpot;
  if (tileAt(spot.x, spot.y) !== 0) spot = take();
  place(spot.x, spot.y, 5);
  await sleep(500);
  const upd = tileUpdates.slice(b3).some((u) => u.tileX === spot.x && u.tileY === spot.y && u.tile === 5);
  const knights = snap.colonists.filter((c) => c.kind === "knight").length;
  result(upd, `Knight Post accepted with iron=${ironBefore} (tileUpdate fired)`);
  result(knights === knightsBefore + 1, `knight colonist appeared in snapshot`);
  const delta = snap.iron - ironBefore;
  result(delta === -15, `iron decreased by exactly 15 (delta=${delta}, ${ironBefore} -> ${snap.iron})`);
} else {
  result(false, `iron never reached 15 within the wait window (iron=${snap.iron})`);
}

// 4. Dawn food upkeep (first dawn at ~50s after server start).
const deadline = Date.now() + 90000;
while (!dawnCheck && Date.now() < deadline) await sleep(200);
if (dawnCheck) {
  const { before: b, after: a } = dawnCheck;
  const expected = b.food >= b.colonists ? b.food - b.colonists : 0;
  console.log(`  dawn at ${dawnCheck.at}: before food=${b.food} colonists=${b.colonists}; after food=${a.food} colonists=${a.colonists}`);
  result(a.food === expected, `dawn upkeep: food ${b.food} -> ${a.food} (expected ${expected} = food - colonistCount)`);
} else {
  result(false, "never observed a dawn transition");
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
