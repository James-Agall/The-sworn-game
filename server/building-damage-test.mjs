// Scripted test: building HP, mob attacks on buildings (wall-aware breach), destruction, builder repair
// (automatic + manual Repair), the snapshot's damagedBuildings and save/load of building HP.
// Needs a private server: PORT=<free port> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1 COLONY_INSTANT_BUILD=1
// COLONY_SAVE_DIR=<scratch dir> (the save/load step writes slot1 there).
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
const T = { Empty: 0, Wall: 1, House: 13, HunterHut: 50 };
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tiles: [], events: [], hook: new Map(), info: null, save: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "buildingInfo") c.info = m;
  else if (m.type === "saveResult") c.save = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const freshSnap = async () => {
  const before = c.snap;
  while (c.snap === before) await sleep(10);
  return c.snap;
};
const W = () => c.welcome.worldTilesX;
const tileAt = (x, y) => c.tiles[y * W() + x];
const key = (x, y) => `${x},${y}`;
const hpOf = (st, x, y) => new Map(st.buildingHp).get(key(x, y)) ?? null;
const setTile = (x, y, tile) => send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile });

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
// Paused: only fastForward moves the simulation, so every step below is deterministic in time.
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setStock", { stock: { wood: 500, rock: 500, iron: 500, tools: 50 } });
await hook("setCycleTick", { tick: 0 });

// 0. The colony starts with one builder (Town Center level 1).
let cs = await hook("constructionState");
const tc = cs.townCenters[0];
result(cs.builders.length === 1, `one starting builder (${cs.builders.length})`);

// Arena east of the Town Center, cleared of trees / rocks.
const ax = tc.x + 4;
for (let y = tc.y - 6; y <= tc.y + 6; y++) for (let x = ax; x <= ax + 14; x++) setTile(x, y, T.Empty);
const H = { x: tc.x + 10, y: tc.y };
setTile(H.x, H.y, T.House);
await hook("fastForward", { ticks: 1 });

// 1. No guard / player to fight: the mob goes for the nearest non-wall building, and damages it.
let mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
let st = await hook("buildingState");
let m = st.mobs.find((x) => x.id === mob.id);
result(m?.targetType === "building" && m.targetId === key(H.x, H.y), `mob targets the nearest building, the House (${m?.targetType} ${m?.targetId})`);
await hook("fastForward", { ticks: 200 });
st = await hook("buildingState");
const houseHp = hpOf(st, H.x, H.y);
result(houseHp !== null && houseHp < 120, `the House took damage (${houseHp}/120)`);
let snap = await freshSnap();
let dmg = new Map();
for (let i = 0; i < snap.damagedBuildings.length; i += 2) dmg.set(snap.damagedBuildings[i], snap.damagedBuildings[i + 1]);
const hIndex = H.y * W() + H.x;
result(dmg.has(hIndex) && dmg.get(hIndex) < 1000, `snapshot.damagedBuildings lists it (${dmg.get(hIndex)} permille)`);
c.info = null;
send({ type: "buildingInfo", tileX: H.x, tileY: H.y });
for (let i = 0; i < 200 && !c.info; i++) await sleep(10);
result(c.info?.info?.maxHp === 120 && c.info.info.hp < 120 && c.info.info.repair !== null, `buildingInfo: HP ${c.info?.info?.hp}/${c.info?.info?.maxHp}, repair ${JSON.stringify(c.info?.info?.repair)}`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });

// 2. A short way around a wall: no breach, the House stays the target.
const wallCol = H.x + 2;
for (let y = H.y - 2; y <= H.y + 2; y++) setTile(wallCol, y, T.Wall);
mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
st = await hook("buildingState");
m = st.mobs.find((x) => x.id === mob.id);
result(m?.targetId === key(H.x, H.y), `open detour: no breach, target stays the House (${m?.targetId})`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });
for (let y = H.y - 2; y <= H.y + 2; y++) setTile(wallCol, y, T.Empty);

// 3. Sealed in by a ring of walls: the mob breaches a wall, then reaches the House.
const ring = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ring.push({ x: H.x + dx, y: H.y + dy });
for (const r of ring) setTile(r.x, r.y, T.Wall);
mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
st = await hook("buildingState");
m = st.mobs.find((x) => x.id === mob.id);
const wallTarget = ring.find((r) => key(r.x, r.y) === m?.targetId);
result(m?.targetType === "building" && !!wallTarget, `sealed House: mob targets a ring wall to breach (${m?.targetId})`);
const hpBefore = hpOf(st, H.x, H.y);
c.events.length = 0;
let breached = false;
let hitHouse = false;
for (let i = 0; i < 40 && !(breached && hitHouse); i++) {
  await hook("fastForward", { ticks: 40 });
  await freshSnap();
  breached = ring.some((r) => tileAt(r.x, r.y) === T.Empty);
  st = await hook("buildingState");
  hitHouse = (hpOf(st, H.x, H.y) ?? 120) < hpBefore;
}
result(breached && c.events.some((e) => e.text === "Wood Wall destroyed"), `a wall was breached ('Wood Wall destroyed' event: ${c.events.some((e) => e.text === "Wood Wall destroyed")})`);
result(hitHouse, `the mob went on through the breach and hit the House (${hpOf(st, H.x, H.y)}/${hpBefore})`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });
for (const r of ring) setTile(r.x, r.y, T.Empty);

// 4. Automatic repair by day: an idle builder heals the House and spends wood.
await hook("setCycleTick", { tick: 0 });
await hook("setStock", { stock: { wood: 500 } });
st = await hook("buildingState");
const damagedHp = hpOf(st, H.x, H.y);
let sawRepairing = false;
for (let i = 0; i < 100; i++) {
  // Keep it day (builders shelter at night): a full 20 -> 120 HP repair takes most of a day.
  if (i % 40 === 0) await hook("setCycleTick", { tick: 0 });
  await hook("fastForward", { ticks: 20 });
  st = await hook("buildingState");
  if (st.builders.some((b) => b.state === "repairing" && b.repairKey === key(H.x, H.y))) sawRepairing = true;
  if (hpOf(st, H.x, H.y) === null) break;
}
result(sawRepairing && hpOf(st, H.x, H.y) === null, `builder repaired the House to full (from ${damagedHp}; saw 'repairing': ${sawRepairing})`);
result(st.stock.wood < 500, `repair spent wood (${500 - st.stock.wood})`);

// 5. Manual Repair: pays up front, queues the job, builders finish it.
await hook("setCycleTick", { tick: 0 });
await hook("damageBuilding", { tx: H.x, ty: H.y, amount: 60 });
const woodBefore = (await hook("buildingState")).stock.wood;
send({ type: "repairBuilding", tileX: H.x, tileY: H.y });
await freshSnap();
st = await hook("buildingState");
result(st.repairQueue.includes(key(H.x, H.y)) && st.stock.wood < woodBefore, `Repair queued and paid (${woodBefore - st.stock.wood} wood, queue ${JSON.stringify(st.repairQueue)})`);
for (let i = 0; i < 60 && hpOf(st, H.x, H.y) !== null; i++) {
  await hook("fastForward", { ticks: 20 });
  st = await hook("buildingState");
}
result(hpOf(st, H.x, H.y) === null && st.repairQueue.length === 0, `manual repair finished (hp ${hpOf(st, H.x, H.y) ?? "full"}, queue ${st.repairQueue.length})`);

// 6. 0 HP destroys the building, its worker post and announces it.
const hut = { x: H.x - 3, y: H.y };
// (Trees regrow over the fast-forwarded day: clear the spot and the player's tile again.)
setTile(hut.x, hut.y, T.Empty);
setTile(hut.x + 1, hut.y, T.Empty);
await hook("teleportPlayer", { x: (hut.x + 1) * TILE + 16, y: hut.y * TILE + 16 });
send({ type: "setTile", tileX: hut.x, tileY: hut.y, tile: T.HunterHut });
snap = await freshSnap();
snap = await freshSnap();
const hunterBefore = snap.colonists.filter((col) => col.postX === hut.x && col.postY === hut.y).length;
c.events.length = 0;
await hook("damageBuilding", { tx: hut.x, ty: hut.y, amount: 1e6 });
snap = await freshSnap();
snap = await freshSnap();
const hunterAfter = snap.colonists.filter((col) => col.postX === hut.x && col.postY === hut.y).length;
result(
  hunterBefore === 1 && tileAt(hut.x, hut.y) === T.Empty && hunterAfter === 0 && c.events.some((e) => e.text.endsWith(" destroyed")),
  `destroyed Hunter's Hut: tile ${tileAt(hut.x, hut.y)}, hunters ${hunterBefore} -> ${hunterAfter}, events ${JSON.stringify(c.events.map((e) => e.text))}`
);

// 7. Save -> load keeps building HP.
await hook("damageBuilding", { tx: H.x, ty: H.y, amount: 30 });
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
await hook("damageBuilding", { tx: H.x, ty: H.y, amount: 50 });
c.save = null;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
st = await hook("buildingState");
result(c.save?.ok === true && hpOf(st, H.x, H.y) === 90, `save/load restored the House at 90/120 HP (${hpOf(st, H.x, H.y)})`);

c.ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
