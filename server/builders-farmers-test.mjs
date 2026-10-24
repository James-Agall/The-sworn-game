// Scripted test: builders spread over damaged buildings (walls included) and farmers tend their plots.
// Needs a private server: PORT=<free> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1 npx tsx src/index.ts; PORT=<free> node builders-farmers-test.mjs
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, Wall: 1, FarmPlot: 4, House: 13, BarnPost: 16, BuildersGuild: 58 };

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcomes: 0, snap: null, snapCount: 0, hooks: [], tiles: [], W: 0 };
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
  else if (m.type === "testHookResult") c.hooks.push(m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const snaps = async (n) => {
  const start = c.snapCount;
  while (c.snapCount < start + n) await sleep(10);
};
const hook = async (op, args = {}) => {
  const before = c.hooks.length;
  send({ type: "testHook", op, ...args });
  const deadline = Date.now() + 60000;
  while (c.hooks.length === before) {
    if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}: is COLONY_TEST_HOOKS=1 set?`);
    await sleep(5);
  }
  return c.hooks[c.hooks.length - 1];
};
const ff = (ticks) => hook("fastForward", { ticks });
const place = async (tx, ty, tile) => {
  send({ type: "setTile", tileX: tx, tileY: ty, tile });
  const deadline = Date.now() + 2000;
  while (c.tiles[ty * c.W + tx] !== tile && Date.now() < deadline) await sleep(10);
  return c.tiles[ty * c.W + tx] === tile;
};

await new Promise((r) => c.ws.on("open", r));
while (!c.snap) await sleep(10);
send({ type: "restart", difficulty: "normal" });
await sleep(200);
await snaps(2);
await hook("setRaids", { enabled: false });
await hook("setInstantBuild", { enabled: true });
await hook("setStock", { stock: { wood: 500, rock: 500, grain: 5000 } });
const me = c.snap.players[0];
const P = { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) };

// ---- (a) builders spread; a damaged wall is repaired ----
// The colony starts with one builder: a Builders' Guild adds a second.
const guild = { x: P.x, y: P.y + 2 };
await hook("setTileRaw", { tx: guild.x, ty: guild.y, tile: T.Empty });
await snaps(2);
result(await place(guild.x, guild.y, T.BuildersGuild), "Builders' Guild placed");
await snaps(2);
result((await hook("constructionState")).builders.length >= 2, "two builders");
const wall = { x: P.x + 3, y: P.y + 3 };
const house = { x: P.x - 3, y: P.y + 3 };
for (const t of [wall, house]) await hook("setTileRaw", { tx: t.x, ty: t.y, tile: t.x === wall.x ? T.Wall : T.House });
await snaps(2);
send({ type: "pause" });
while (!c.snap.isPaused) await sleep(10);
const dmg = async (t) => (await hook("damageBuilding", { tx: t.x, ty: t.y, amount: 60 })).structure;
const w0 = await dmg(wall);
const h0 = await dmg(house);
result(w0 && h0 && w0.hp < w0.max && h0.hp < h0.max, `wall and house damaged (${w0?.hp}/${w0?.max}, ${h0?.hp}/${h0?.max})`);
const wallKey = `${wall.x},${wall.y}`;
const houseKey = `${house.x},${house.y}`;
let spread = false;
let maxPerTarget = 0;
for (let i = 0; i < 150; i++) {
  await ff(20);
  const cs = await hook("constructionState");
  const per = {};
  for (const b of cs.builders) if (b.repairKey) per[b.repairKey] = (per[b.repairKey] ?? 0) + 1;
  maxPerTarget = Math.max(maxPerTarget, ...Object.values(per), 0);
  if (per[wallKey] && per[houseKey]) spread = true;
  const w = (await hook("damageBuilding", { tx: wall.x, ty: wall.y })).structure;
  const h = (await hook("damageBuilding", { tx: house.x, ty: house.y })).structure;
  if (w.hp >= w.max && h.hp >= h.max) break;
}
const wf = (await hook("damageBuilding", { tx: wall.x, ty: wall.y })).structure;
const hf = (await hook("damageBuilding", { tx: house.x, ty: house.y })).structure;
result(spread, "builders were on the wall and the house at the same time");
result(maxPerTarget <= 2, `at most 2 builders per building (max ${maxPerTarget})`);
result(wf.hp >= wf.max && hf.hp >= hf.max, `wall and house fully healed (${wf.hp}/${wf.max}, ${hf.hp}/${hf.max})`);

// ---- (b) farmer visits both plots; yield unchanged ----
const B = { x: P.x, y: P.y - 2 };
const plots = [{ x: B.x - 1, y: B.y }, { x: B.x + 1, y: B.y }];
await hook("teleportPlayer", { x: B.x * TILE + 16, y: (B.y + 1) * TILE + 16 });
await snaps(2);
for (const t of [B, ...plots]) await hook("setTileRaw", { tx: t.x, ty: t.y, tile: T.Empty });
await place(B.x, B.y, T.BarnPost);
for (const p of plots) await place(p.x, p.y, T.FarmPlot);
await ff(5);
const fs = await hook("farmState");
const K = fs.constants;
const visited = new Set();
let farmingSeen = false;
const DAY = K.DAY_TICKS + K.NIGHT_TICKS;
for (let t = 0; t < DAY; t += 5) {
  await ff(5);
  const cs = await hook("constructionState");
  const f = cs.farmers.find((q) => q.postX === B.x && q.postY === B.y);
  if (!f) continue;
  if (f.sheltering) continue;
  for (const p of plots) {
    if (Math.hypot(f.x - (p.x * TILE + 16), f.y - (p.y * TILE + 16)) < 6) visited.add(`${p.x},${p.y}`);
  }
  if (f.state === "farming") farmingSeen = true;
}
result(visited.size === 2, `farmer stood on both plots during a day (visited ${[...visited].join(" ")})`);
result(farmingSeen, "farmer shows the farming work state at a plot");
// Yield per harvest unchanged: grain comes from updateFarmPlots only.
await hook("setStock", { stock: { grain: 0 } });
await ff(K.FARM_GROW_TICKS + K.FARM_HARVEST_TICKS + 10);
const grain = (await hook("setStock", { stock: {} })).stock.grain;
console.log(`info grain after one grow+harvest: ${grain} (expect ${2 * K.FARM_YIELD_PER_HARVEST} minus consumption)`);
result(grain >= 2 * K.FARM_YIELD_PER_HARVEST - 1, `both plots harvested once at FARM_YIELD_PER_HARVEST (${grain} grain)`);

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
c.ws.close();
process.exit(fails ? 1 : 0);
