// Scripted test: Towers (ROADMAP §8 item 6) and bigger, leaner Barns (item 7). Needs a private server
// with test hooks and its own save dir:
//   COLONY_TEST_HOOKS=1 COLONY_WORLD_SIZE=80 PORT=19310 npx tsx src/index.ts &   then
//   PORT=19310 node towers-farms-test.mjs
// Checks: a Tower places with no workers and costs 20 wood + 15 rock; it shoots a troll for its level's
// damage at its level's rate (L1-L3, upgraded via upgradeBuilding at the TOWER_COSTS price); max HP is
// the big-building class x level; livingTowersNear; a Barn takes 8 plots within 2 tiles, not a 9th;
// yield 24; the Archery Range still places and trains an archer (and is not a Tower).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 19310;
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, ArcherPost: 6, BarnPost: 16, FarmPlot: 4, ArcherTower: 19, Tower: 62 };

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, msgs: [], tiles: [], W: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcomes++;
    c.W = m.worldTilesX;
    c.tiles = m.tiles.slice();
  } else if (m.type === "snapshot") {
    c.snap = m;
    c.snapCount++;
  } else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
  else c.msgs.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const waitFor = async (pred, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = c.msgs.find(pred);
    if (hit) {
      c.msgs.splice(c.msgs.indexOf(hit), 1);
      return hit;
    }
    if (Date.now() > deadline) throw new Error("timeout");
    await sleep(5);
  }
};
const hook = (op, args = {}) => {
  send({ type: "testHook", op, ...args });
  return waitFor((m) => m.type === "testHookResult" && m.op === op);
};
const snaps = async (n) => {
  const s = c.snapCount;
  while (c.snapCount < s + n) await sleep(10);
};
const tileAt = (x, y) => c.tiles[y * c.W + x];
const ff = (ticks) => hook("fastForward", { ticks });
const placeAt = async (tx, ty, tile, standX = tx + 1, standY = ty) => {
  await hook("teleportPlayer", { x: standX * TILE + 16, y: standY * TILE + 16 });
  send({ type: "setTile", tileX: tx, tileY: ty, tile });
  const deadline = Date.now() + 1000;
  while (tileAt(tx, ty) !== tile && Date.now() < deadline) await sleep(10);
  return tileAt(tx, ty) === tile;
};
const mobHp = async (id) => (await hook("raidState")).mobs.find((m) => m.id === id)?.hp ?? null;

await new Promise((r) => c.ws.on("open", r));
send({ type: "join", name: "towers" });
while (!c.welcomes) await sleep(10);
send({ type: "restart", difficulty: "normal" });
while (c.welcomes < 2) await sleep(10);
await snaps(2);
await hook("setInstantBuild", { enabled: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 10 });
// Paused: only fastForward advances the sim, so tick counts between shots are exact.
send({ type: "pause" });
for (let y = 15; y <= 45; y++) for (let x = 15; x <= 35; x++) await hook("setTileRaw", { tx: x, ty: y, tile: T.Empty });
await hook("setStock", { stock: { wood: 500, rock: 500, iron: 100 } });

// ---- Tower placement ----
const TX = 25, TY = 40;
const before = (await hook("setStock", { stock: {} })).stock;
const colonistsBefore = c.snap.colonists.length;
result(await placeAt(TX, TY, T.Tower), `Tower placed at (${TX},${TY})`);
const st = await hook("towerState");
const after = (await hook("setStock", { stock: {} })).stock;
result(before.wood - after.wood === 20 && before.rock - after.rock === 15, `L1 cost ${before.wood - after.wood} wood + ${before.rock - after.rock} rock (expected 20 + 15)`);
await snaps(2);
result(c.snap.colonists.length === colonistsBefore && !c.snap.colonists.some((k) => k.postX === TX && k.postY === TY), "no workers spawned for the Tower");
const t1 = st.towers.find((t) => t.x === TX && t.y === TY);
result(t1 && t1.level === 1 && t1.hp?.max === 250, `L1 HP max ${t1?.hp?.max} (expected 250)`);

// Fires at a troll in range: damage per shot and ticks between shots.
async function measure(level) {
  const { id } = await hook("spawnMob", { kind: "troll", tx: TX + 3, ty: TY });
  let hp = await mobHp(id);
  let firstTick = -1;
  for (let i = 0; i < 40 && firstTick < 0; i++) {
    const r = await ff(1);
    const h = await mobHp(id);
    if (h < hp) {
      result(hp - h === st.stats[level - 1].damage, `L${level} shot damage ${hp - h} (expected ${st.stats[level - 1].damage})`);
      firstTick = r.cycleTick;
    }
    hp = h;
  }
  let secondTick = -1;
  for (let i = 0; i < 40 && secondTick < 0; i++) {
    const r = await ff(1);
    const h = await mobHp(id);
    // Trolls regenerate: only a drop is a shot.
    if (h < hp) secondTick = r.cycleTick;
    hp = h;
  }
  result(secondTick - firstTick === st.cooldownTicks[level - 1], `L${level} shot interval ${secondTick - firstTick} ticks (expected ${st.cooldownTicks[level - 1]})`);
  await hook("damageMob", { mobId: id, amount: 9999 });
}
await measure(1);
for (const level of [2, 3]) {
  const s0 = (await hook("setStock", { stock: {} })).stock;
  send({ type: "upgradeBuilding", tileX: TX, tileY: TY });
  await sleep(200);
  const s1 = (await hook("setStock", { stock: {} })).stock;
  const cost = st.costs[level - 1];
  result(s0.wood - s1.wood === cost.wood && s0.rock - s1.rock === cost.rock, `L${level} upgrade cost ${s0.wood - s1.wood} wood + ${s0.rock - s1.rock} rock (expected ${cost.wood} + ${cost.rock})`);
  const tw = (await hook("towerState")).towers.find((t) => t.x === TX && t.y === TY);
  result(tw?.level === level, `Tower level ${tw?.level} (expected ${level}), HP max ${tw?.hp?.max}`);
  await measure(level);
}
const t3 = (await hook("towerState")).towers.find((t) => t.x === TX && t.y === TY);
result(t3?.hp?.max === 450, `L3 HP max ${t3?.hp?.max} (expected 450 = 250 x 1.8)`);
const near = (await hook("towerState", { tx: TX + 2, ty: TY, radius: 3 })).near;
const far = (await hook("towerState", { tx: TX + 10, ty: TY, radius: 3 })).near;
result(near.length === 1 && near[0].level === 3 && far.length === 0, `livingTowersNear: ${near.length} near, ${far.length} far (expected 1, 0)`);

// ---- Barn: 8 plots within 2 tiles, not a 9th; leaner yield ----
const BX = 20, BY = 20;
result(await placeAt(BX, BY, T.BarnPost), "Barn placed");
const spots = [[-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [-2, 0], [2, 0], [0, 2], [1, 2]];
let placed = 0;
for (const [dx, dy] of spots.slice(0, 8)) if (await placeAt(BX + dx, BY + dy, T.FarmPlot, BX + dx, BY + dy)) placed++;
result(placed === 8, `${placed}/8 farm plots placed within 2 tiles of the Barn`);
const [nx, ny] = spots[8];
result(!(await placeAt(BX + nx, BY + ny, T.FarmPlot, BX + nx, BY + ny)), "9th plot rejected (Barn full)");
result(!(await placeAt(BX + 3, BY + 3, T.FarmPlot, BX + 3, BY + 3)), "plot 3 tiles from any Barn rejected");
const farm = await hook("farmState");
result(farm.plots.filter((p) => p.barnX === BX && p.barnY === BY).length === 8, "8 plots belong to the Barn");
result(farm.constants.FARM_YIELD_PER_HARVEST === 24, `FARM_YIELD_PER_HARVEST ${farm.constants.FARM_YIELD_PER_HARVEST} (expected 24)`);

// ---- The Archery Range still trains an archer (independent of the Tower) ----
const AX = 30, AY = 30;
const w0 = (await hook("setStock", { stock: {} })).stock.wood;
result(await placeAt(AX, AY, T.ArcherPost), "Archery Range placed");
await snaps(3);
const w1 = (await hook("setStock", { stock: {} })).stock.wood;
const archers = c.snap.colonists.filter((k) => k.kind === "archer" && k.postX === AX && k.postY === AY);
result(archers.length >= 1 && w0 - w1 === 10, `Archery Range: ${archers.length} archer(s), cost ${w0 - w1} wood (expected >=1, 10)`);
const tw = (await hook("towerState")).towers;
result(!tw.some((t) => t.x === AX && t.y === AY), "isTowerTile does not match the Archery Range");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
