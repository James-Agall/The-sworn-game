// Scripted economy test: placement costs, mining, knight purchase.
// Needs a private server with COLONY_TEST_HOOKS=1 (setStock, teleportPlayer) and COLONY_INSTANT_BUILD=1, no other
// players (any world size; size and Town Center are read from the server).
// The old "farm food" and "dawn food upkeep" checks are gone: the single `food` stock was replaced by grain / meat /
// fruit and per-colonist hunger (Farm Plots now need a Barn); slow-farming-test and hunger-roads-test cover those.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let welcome = null;
let snap = null;
const tileUpdates = [];
const tiles = [];
const hooks = new Map();
// Short-term goal rewards (ROADMAP Phase 5: "Assign a worker" +20 wood +10 rock, "Arm a unit" +15 iron, ...) land in
// the stock as "Goal complete: ... (+N key, ...)" events; cost checks subtract them.
const goalRewards = [];
const rewardSince = (t, key) => goalRewards.filter((r) => r.at >= t).reduce((n, r) => n + (r.reward[key] ?? 0), 0);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, KnightPost: 5, ArcherPost: 6, IronOre: 7, Rock: 8, IronMine: 9, RockMine: 10 };
const KNIGHT_IRON_COST = 10;
const KNIGHT_ROCK_COST = 5;
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

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    W = m.worldTilesX;
    tiles.length = 0;
    tiles.push(...m.tiles);
  } else if (m.type === "snapshot") {
    snap = m;
  } else if (m.type === "tileUpdate") {
    tiles[m.tileY * W + m.tileX] = m.tile;
    tileUpdates.push(m);
  } else if (m.type === "testHookResult") hooks.set(m.op, m);
  else if (m.type === "event" && /Goal complete/.test(m.text ?? "")) {
    const reward = {};
    for (const [, n, key] of (m.text.match(/\(([^)]*)\)\s*$/)?.[1] ?? "").matchAll(/\+(\d+) (\w+)/g)) reward[key] = Number(n);
    goalRewards.push({ at: Date.now(), reward, text: m.text });
  }
});

await new Promise((r) => ws.on("open", r));
while (!welcome || !snap) await sleep(20);

const me = () => snap.players.find((p) => p.id === welcome.id);
const tc = snap.townCenters[0];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const emptyInReach = () => {
  const p = me();
  const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
  const out = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = px + dx, y = py + dy;
      if ((dx === 0 && dy === 0) || Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) > TILE * 2.5) continue;
      if (tileAt(x, y) === T.Empty) out.push({ x, y, d: dx * dx + dy * dy });
    }
  return out.sort((a, b) => a.d - b.d);
};
const deposit = (kind) => {
  for (let r = 2; r < 40; r++)
    for (let y = tc.y - r; y <= tc.y + r; y++)
      for (let x = tc.x - r; x <= tc.x + r; x++) {
        if (tileAt(x, y) !== kind) continue;
        const stand = N4.map(([dx, dy]) => ({ x: x + dx, y: y + dy })).find((t) => tileAt(t.x, t.y) === T.Empty);
        if (stand) return { x, y, stand };
      }
  return null;
};
const goTo = async (t) => {
  await hook("teleportPlayer", { x: t.x * TILE + 16, y: t.y * TILE + 16 });
  await sleep(150);
};

// a. Knight post with 0 iron.
await hook("setStock", { stock: { iron: 0, wood: 0 } });
await sleep(150);
const kSpot = emptyInReach().at(-1);
const before = tileUpdates.length;
result(snap.iron === 0, `iron set to 0 (iron=${snap.iron})`);
place(kSpot.x, kSpot.y, T.KnightPost);
await sleep(500);
const kUpdate = tileUpdates.slice(before).some((u) => u.tileX === kSpot.x && u.tileY === kSpot.y);
result(!kUpdate && tileAt(kSpot.x, kSpot.y) === 0 && !snap.colonists.some((c) => c.kind === "knight"),
  `Knight Post rejected with 0 iron (no tileUpdate, tile still Empty, no knight)`);

// b. Archer post with 0 wood.
const before2 = tileUpdates.length;
result(snap.wood === 0, `wood set to 0 (wood=${snap.wood})`);
place(kSpot.x, kSpot.y, T.ArcherPost);
await sleep(500);
const aUpdate = tileUpdates.slice(before2).some((u) => u.tileX === kSpot.x && u.tileY === kSpot.y);
result(!aUpdate && tileAt(kSpot.x, kSpot.y) === 0 && !snap.colonists.some((c) => c.kind === "archer"),
  `Archer Post rejected with 0 wood (no tileUpdate, tile still Empty, no archer)`);
await hook("setStock", { stock: { wood: 80 } });

// c. Iron mine + rock mine, each on its deposit (mines only go on ore / rock).
const iDep = deposit(T.IronOre);
await goTo(iDep.stand);
place(iDep.x, iDep.y, T.IronMine);
await sleep(300);
result(tileAt(iDep.x, iDep.y) === T.IronMine && snap.colonists.some((c) => c.kind === "ironMiner"), `Iron Mine placed at ${iDep.x},${iDep.y} + ironMiner spawned`);
const rDep = deposit(T.Rock);
await goTo(rDep.stand);
const rock0 = snap.rock;
place(rDep.x, rDep.y, T.RockMine);
await sleep(300);
result(tileAt(rDep.x, rDep.y) === T.RockMine && snap.colonists.some((c) => c.kind === "rockMiner"), `Rock Mine placed at ${rDep.x},${rDep.y} + rockMiner spawned`);
const rockAfterMine = snap.rock;

let firstIron = null, firstRock = null;
while (Date.now() - t0 < 60000 && (firstIron === null || firstRock === null)) {
  if (firstIron === null && snap.iron > 0) firstIron = el();
  if (firstRock === null && snap.rock > rockAfterMine) firstRock = el();
  await sleep(100);
}
result(snap.iron > 0, `iron increased above 0 (first at ${firstIron}, now ${snap.iron})`);
result(snap.rock > rockAfterMine, `rock increased (${rock0} before the mine, ${rockAfterMine} after, first rise at ${firstRock}, now ${snap.rock})`);

// d. Wait for enough mined iron for a Knight Post, then buy one: exactly 10 iron + 5 rock, one knight.
while (snap.iron < KNIGHT_IRON_COST && Date.now() - t0 < Number(process.env.IRON_WAIT_MS ?? 120000)) await sleep(200);
if (snap.iron >= KNIGHT_IRON_COST) {
  await goTo({ x: tc.x + 1, y: tc.y + 3 });
  // The miners would keep delivering during the cost check: retire them first (they respawn at dawn).
  await hook("killColonists", { kind: "ironMiner" });
  await hook("killColonists", { kind: "rockMiner" });
  await sleep(200);
  const ironBefore = snap.iron;
  const rockBefore = snap.rock;
  const placedAt = Date.now();
  const knightsBefore = snap.colonists.filter((c) => c.kind === "knight").length;
  const b3 = tileUpdates.length;
  const spot = emptyInReach().at(-1);
  place(spot.x, spot.y, T.KnightPost);
  await sleep(500);
  const upd = tileUpdates.slice(b3).some((u) => u.tileX === spot.x && u.tileY === spot.y && u.tile === T.KnightPost);
  const knights = snap.colonists.filter((c) => c.kind === "knight").length;
  result(upd, `Knight Post accepted with iron=${ironBefore} (tileUpdate fired)`);
  result(knights === knightsBefore + 1, `knight colonist appeared in snapshot`);
  const dIron = ironBefore - snap.iron + rewardSince(placedAt, "iron");
  const dRock = rockBefore - snap.rock + rewardSince(placedAt, "rock");
  if (goalRewards.some((r) => r.at >= placedAt)) console.log(`[${el()}] goal rewards in the window: ${goalRewards.filter((r) => r.at >= placedAt).map((r) => r.text).join(" | ")}`);
  result(dIron === KNIGHT_IRON_COST && dRock === KNIGHT_ROCK_COST,
    `Knight Post cost exactly ${KNIGHT_IRON_COST} iron + ${KNIGHT_ROCK_COST} rock (iron ${ironBefore} -> ${snap.iron}, rock ${rockBefore} -> ${snap.rock})`);
} else {
  result(false, `iron never reached ${KNIGHT_IRON_COST} within the wait window (iron=${snap.iron})`);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
