// Scripted test: builders, construction sites, building levels in the snapshot, placeable /
// upgradeable Town Centers, game over and respawn at a rebuilt Town Center.
// Needs a private server: PORT=<free port> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1 (no COLONY_INSTANT_BUILD).
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
const T = { Empty: 0, Wall: 1, House: 13, TownCenter: 12, HunterHut: 50, BuildersGuild: 58, ConstructionSite: 59 };
const POI = new Set([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]);
const TILE = 32;
const REACH = TILE * 2.5;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tiles: [], events: [], hook: new Map(), info: null };
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
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.W = () => c.welcome.worldTilesX;
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 400 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  // Waits for a fresh snapshot (so it reflects every message sent before the call).
  c.freshSnap = async () => {
    const before = c.snap;
    while (c.snap === before) await sleep(10);
    return c.snap;
  };
  return c;
}

// Empty tiles within reach of the player that no colonist or player stands on.
function freeTilesNearMe(c) {
  const me = c.me();
  const occupied = new Set();
  for (const e of [...c.snap.colonists, ...c.snap.players]) occupied.add(Math.floor(e.y / TILE) * c.W() + Math.floor(e.x / TILE));
  const out = [];
  const mx = Math.floor(me.x / TILE);
  const my = Math.floor(me.y / TILE);
  for (let y = my - 2; y <= my + 2; y++) {
    for (let x = mx - 2; x <= mx + 2; x++) {
      if (Math.hypot(x * TILE + 16 - me.x, y * TILE + 16 - me.y) > REACH) continue;
      if (c.tileAt(x, y) !== T.Empty || occupied.has(y * c.W() + x)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

// Candidate Town Center spots: empty, 14+ tiles from every standing Town Center, no POI within 7.
function townCenterSpots(c, townCenters) {
  const W = c.W();
  const spots = [];
  for (let y = 4; y < W - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      if (c.tileAt(x, y) !== T.Empty || c.tileAt(x + 1, y) !== T.Empty) continue;
      if (townCenters.some((tc) => Math.hypot(tc.x - x, tc.y - y) < 14)) continue;
      let poi = false;
      for (let dy = -7; dy <= 7 && !poi; dy++) for (let dx = -7; dx <= 7; dx++) if (POI.has(c.tileAt(x + dx, y + dy))) poi = true;
      if (!poi) spots.push({ x, y });
    }
  }
  return spots;
}

// Teleports next to each candidate in turn and places a Town Center until one lands.
async function placeTownCenter(c, spots) {
  for (const spot of spots.slice(0, 40)) {
    await c.hookCall("teleportPlayer", { x: (spot.x + 1) * TILE + 16, y: spot.y * TILE + 16 });
    c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.TownCenter });
    await c.freshSnap();
    await c.freshSnap();
    if (c.tileAt(spot.x, spot.y) === T.TownCenter) return spot;
  }
  return null;
}

const c = connect();
await c.ready();
await c.hookCall("setRaids", { enabled: false });
await c.hookCall("setStock", { stock: { wood: 2000, rock: 2000, iron: 2000, tools: 200, grain: 500 } });
await c.hookCall("setCycleTick", { tick: 0 });
let snap = await c.freshSnap();

// 1. The colony starts with 1 builder (a Town Center keeps one builder per level).
const builders = snap.colonists.filter((col) => col.kind === "builder");
result(builders.length === 1, `starts with 1 builder (got ${builders.length})`);
result(snap.townCenters.length === 1 && snap.townCenters[0].level === 1, "one level-1 Town Center in the snapshot");

// 2. Placing a House creates a construction site; the builders finish it.
const spot = freeTilesNearMe(c)[0];
c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.House });
snap = await c.freshSnap();
snap = await c.freshSnap();
const index = spot.y * c.W() + spot.x;
result(c.tileAt(spot.x, spot.y) === T.ConstructionSite, `House placement became a construction site (tile ${c.tileAt(spot.x, spot.y)})`);
const siteEntry = [];
for (let i = 0; i < snap.constructionSites.length; i += 5) if (snap.constructionSites[i] === index) siteEntry.push(...snap.constructionSites.slice(i, i + 5));
result(siteEntry[1] === T.House && siteEntry[3] === 0, `snapshot lists the site with target House (${JSON.stringify(siteEntry)})`);
let sawBuilding = false;
for (let i = 0; i < 100 && c.tileAt(spot.x, spot.y) !== T.House; i++) {
  await c.hookCall("fastForward", { ticks: 20 });
  const st = await c.hookCall("constructionState");
  if (st.builders.some((b) => b.state === "building")) sawBuilding = true;
  await c.freshSnap();
}
result(sawBuilding, "a builder worked the site (state 'building')");
result(c.tileAt(spot.x, spot.y) === T.House, "the House appeared when construction completed");

// 3. Building level reaches the snapshot (instant build for speed: Hunter's Hut placed twice = Lv2).
await c.hookCall("setInstantBuild", { enabled: true });
const hutSpot = freeTilesNearMe(c)[0];
c.send({ type: "setTile", tileX: hutSpot.x, tileY: hutSpot.y, tile: T.HunterHut });
await c.freshSnap();
c.send({ type: "setTile", tileX: hutSpot.x, tileY: hutSpot.y, tile: T.HunterHut });
snap = await c.freshSnap();
snap = await c.freshSnap();
const hutIndex = hutSpot.y * c.W() + hutSpot.x;
const levels = new Map();
for (let i = 0; i < snap.buildingLevels.length; i += 2) levels.set(snap.buildingLevels[i], snap.buildingLevels[i + 1]);
result(levels.get(hutIndex) === 2, `Hunter's Hut level 2 is in snapshot.buildingLevels (${levels.get(hutIndex)})`);
await c.hookCall("setInstantBuild", { enabled: false });

// 4. No builder alive: placement is rejected with a toast.
await c.hookCall("killColonists", { kind: "builder" });
// Freeze the simulation (placements are still handled) so the dead builders don't respawn mid-test.
c.send({ type: "pause" });
const wallSpot = freeTilesNearMe(c).find((t) => !(t.x === hutSpot.x && t.y === hutSpot.y));
c.events.length = 0;
c.send({ type: "setTile", tileX: wallSpot.x, tileY: wallSpot.y, tile: T.Wall });
await c.freshSnap();
await c.freshSnap();
result(c.tileAt(wallSpot.x, wallSpot.y) === T.Empty, "no builders: the wall was not placed");
result(c.events.some((e) => e.text === "No builders available"), "no builders: 'No builders available' event");

// 5. Town Center: placeable (instant while no builder lives), upgradeable, multiplier applied.
const tcSpot = await placeTownCenter(c, townCenterSpots(c, snap.townCenters));
snap = await c.freshSnap();
result(tcSpot !== null && snap.townCenters.length === 2, `second Town Center placed (${JSON.stringify(tcSpot)})`);
let st = await c.hookCall("constructionState");
const postedAt = (state, x, y) => state.builders.filter((b) => b.postX === x && b.postY === y).length;
result(postedAt(st, tcSpot.x, tcSpot.y) === 1, `new level-1 Town Center gets 1 builder (${postedAt(st, tcSpot.x, tcSpot.y)})`);
const happinessOnly = st.happinessSpeedMultiplier;
// Its builder is alive now, so the upgrades below would be construction sites: build them instantly.
await c.hookCall("setInstantBuild", { enabled: true });
result(Math.abs(st.productionSpeedMultiplier - happinessOnly) < 1e-9 && st.armyBonus === 0, "no Town Center bonus at level 1");
c.send({ type: "setTile", tileX: tcSpot.x, tileY: tcSpot.y, tile: T.TownCenter });
snap = await c.freshSnap();
snap = await c.freshSnap();
st = await c.hookCall("constructionState");
const tc2 = st.townCenters.find((t) => t.x === tcSpot.x && t.y === tcSpot.y);
result(tc2?.level === 2 && tc2.hp === 1500, `Town Center upgraded to level 2 with 1500 HP (${JSON.stringify(tc2)})`);
result(postedAt(st, tcSpot.x, tcSpot.y) === 2, `level-2 Town Center has 2 builders (${postedAt(st, tcSpot.x, tcSpot.y)})`);
result(
  Math.abs(st.productionSpeedMultiplier / st.happinessSpeedMultiplier - 1.05) < 1e-9 && Math.abs(st.armyBonus - 0.05) < 1e-9,
  `level-2 Town Center: +5% productivity (x${(st.productionSpeedMultiplier / st.happinessSpeedMultiplier).toFixed(3)}) and +5% damage (${st.armyBonus})`
);
const tcLevels = new Map();
for (let i = 0; i < snap.buildingLevels.length; i += 2) tcLevels.set(snap.buildingLevels[i], snap.buildingLevels[i + 1]);
result(tcLevels.get(tcSpot.y * c.W() + tcSpot.x) === 2, "Town Center level 2 is in snapshot.buildingLevels");
c.info = null;
c.send({ type: "buildingInfo", tileX: tcSpot.x, tileY: tcSpot.y });
for (let i = 0; i < 100 && !c.info; i++) await sleep(10);
result(
  c.info?.info?.name === "Town Center" && c.info.info.level === 2 && c.info.info.hp === 1500 && c.info.info.upgrade?.cost.startsWith("Lv3"),
  `buildingInfo for the Town Center: ${JSON.stringify(c.info?.info && { name: c.info.info.name, level: c.info.info.level, hp: c.info.info.hp, upgrade: c.info.info.upgrade, bonuses: c.info.info.bonuses.length })}`
);

// 5b. Level 3 (the Keep): 3 builders. A Builders' Guild still adds one builder per level.
c.send({ type: "setTile", tileX: tcSpot.x, tileY: tcSpot.y, tile: T.TownCenter });
await c.freshSnap();
await c.freshSnap();
st = await c.hookCall("constructionState");
const tcKeep = st.townCenters.find((t) => t.x === tcSpot.x && t.y === tcSpot.y);
result(tcKeep?.level === 3 && postedAt(st, tcSpot.x, tcSpot.y) === 3, `level-3 Town Center has 3 builders (level ${tcKeep?.level}, ${postedAt(st, tcSpot.x, tcSpot.y)})`);
const guildSpot = freeTilesNearMe(c)[0];
c.send({ type: "setTile", tileX: guildSpot.x, tileY: guildSpot.y, tile: T.BuildersGuild });
await c.freshSnap();
c.send({ type: "setTile", tileX: guildSpot.x, tileY: guildSpot.y, tile: T.BuildersGuild });
await c.freshSnap();
await c.freshSnap();
st = await c.hookCall("constructionState");
result(
  c.tileAt(guildSpot.x, guildSpot.y) === T.BuildersGuild && postedAt(st, guildSpot.x, guildSpot.y) === 2,
  `level-2 Builders' Guild has 2 builders (${postedAt(st, guildSpot.x, guildSpot.y)})`
);
await c.hookCall("setInstantBuild", { enabled: false });

// 6. Destroy every Town Center and kill the player: game over (dead, no respawn).
for (const tc of st.townCenters) await c.hookCall("damageTownCenter", { tx: tc.x, ty: tc.y, amount: 1e6 });
const dmg = await c.hookCall("damagePlayer", { amount: 10000 });
await c.hookCall("fastForward", { ticks: 5 });
snap = await c.freshSnap();
result(dmg.dead === true && c.me().dead === true && snap.townCenters.length === 0, "no Town Center + player killed: dead (game over)");

// 7. Another (alive) player places a new Town Center: instant, and the dead player respawns there.
const c2 = connect();
await c2.ready();
const tc3 = await placeTownCenter(c2, townCenterSpots(c2, []));
await c.hookCall("fastForward", { ticks: 2 });
snap = await c.freshSnap();
const me = c.me();
const dist = tc3 ? Math.hypot(me.x - (tc3.x * TILE + 16), me.y - (tc3.y * TILE + 16)) : Infinity;
result(tc3 !== null && snap.townCenters.length === 1, `new Town Center built at once (${JSON.stringify(tc3)})`);
result(me.dead === false && me.hp === 100 && dist <= TILE * 1.5, `dead player respawned next to it (${dist.toFixed(0)}px away)`);

c.ws.close();
c2.ws.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
