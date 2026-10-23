// Scripted test: off-screen fight notifiers (ROADMAP "Off-screen fight notifiers — landed 2026-10-23").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir> (160x160 world).
// Restarts the world, pauses it and drives everything with fastForward.
//
//   C: clustering - a west arena with two skirmishes 4 tiles apart (knights vs goblins) and an east
//      arena with one: exactly 2 fights, each centred within 4 tiles of its arena, colony units in,
//      label "Greenskin raid"; the fights lie west / east of the player (direction via the client's
//      own placeEdgeArrow: the west arrow sits on the left rim, the east one on the right); ids stay
//      stable across scans; the snapshot's `fights` carries both for the player.
//   E: expiry - every mob removed without a blow: the fights stay listed (quiet rising) until
//      FIGHT_WINDOW_SECONDS after the last blow, then drop out, and the snapshot omits `fights`.
//   R: relevance - a second player B, far from A (> FIGHT_RELEVANCE_TILES), hits a troll: B's list has it
//      with you=true, A's doesn't; once A stands near it, A's list has it with you=false.
//   B: buildings - a goblin next to a lone building far from any soldier: a fight with buildings=true.
//   K: cap - 10 separate skirmishes: 10 fights tracked, the player's list capped at FIGHT_MAX_PER_PLAYER.
import WebSocket from "ws";
import { placeEdgeArrow, compassDirection } from "../client/src/fightArrows.ts";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
let passes = 0;
const result = (ok, msg) => {
  if (ok) passes++;
  else fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, House: 13 };
// Mirrors of protocol.ts.
const FIGHT_WINDOW_SECONDS = 3;
const FIGHT_RELEVANCE_TILES = 48;
const FIGHT_MAX_PER_PLAYER = 8;
const TICK_RATE = 20;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, hook: new Map() };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") { c.welcome = m; c.welcomes++; }
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.call = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  // Waits for a snapshot sent after now (so it reflects the latest hooks).
  c.freshSnap = async () => {
    const prev = c.snap;
    while (c.snap === prev) await sleep(10);
    return c.snap;
  };
  return c;
}

const a = connect();
await a.ready();
const W = a.welcome.worldTilesX;
const H = a.welcome.worldTilesY;
const TC = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
const px = (t) => t * TILE + TILE / 2;
const ff = (ticks) => a.call("fastForward", { ticks });
const fightState = () => a.call("fightState");

// Fresh world, paused, no raids, mobs ignore players (test clients stand in the world).
{
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.freshSnap();
  if (!a.snap.isPaused) a.send({ type: "pause" });
  await a.call("setRaids", { enabled: false });
  await a.call("ignorePlayers", { value: true });
  await a.call("setCycleTick", { tick: 0 });
  await a.call("teleportPlayer", { x: px(TC.x), y: px(TC.y + 3) });
}

async function clearArea(cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    a.send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
  }
  await a.call("setTileRaw", { tx: cx, ty: cy, tile: T.Empty });
}
async function killAllMobs() {
  const rs = await a.call("raidState");
  for (const m of rs.mobs) await a.call("damageMob", { mobId: m.id, amount: 999999 });
}
async function killSoldiers() {
  await a.call("killColonists", { kind: "knight" });
}
// Knights in a short line at (tx, ty), goblins 1 tile east of them.
async function skirmish(tx, ty, knights = 3, goblins = 3, mobKind = "goblin") {
  for (let i = 0; i < knights; i++) await a.call("spawnSoldier", { kind: "knight", x: px(tx), y: px(ty + i - 1), stance: "aggressive" });
  for (let i = 0; i < goblins; i++) await a.call("spawnMob", { kind: mobKind, tx: tx + 1, ty: ty + i - 1 });
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

// Wipe whatever the world started with (Abbey guardians aside, nothing should be fighting).
await killAllMobs();
await ff(FIGHT_WINDOW_SECONDS * TICK_RATE + 20);
{
  const fs = await fightState();
  result(fs.fights.length === 0, `start: no fights after a restart and a quiet window (${fs.fights.length})`);
}

// ---------------------------------------------------------------- C: clustering + direction
const WEST = { x: TC.x - 30, y: TC.y };
const EAST = { x: TC.x + 30, y: TC.y };
await clearArea(WEST.x, WEST.y, 8);
await clearArea(EAST.x, EAST.y, 6);
await skirmish(WEST.x - 2, WEST.y);
await skirmish(WEST.x + 2, WEST.y);
await skirmish(EAST.x, EAST.y);
await ff(30);
let firstIds;
{
  const fs = await fightState();
  info(`C: fights ${JSON.stringify(fs.fights.map((f) => ({ id: f.id, x: f.x, y: f.y, n: f.combatants, dps: f.dps, i: f.intensity, label: f.label, units: f.units })))}, hits ${fs.hits}`);
  result(fs.fights.length === 2, `C: 3 skirmishes (two 4 tiles apart) cluster into 2 fights (${fs.fights.length})`);
  const west = fs.fights.find((f) => f.x < TC.x);
  const east = fs.fights.find((f) => f.x > TC.x);
  result(!!west && dist(west, WEST) <= 4, `C: west fight centred near (${WEST.x},${WEST.y}): ${west ? `(${west.x},${west.y})` : "missing"}`);
  result(!!east && dist(east, EAST) <= 4, `C: east fight centred near (${EAST.x},${EAST.y}): ${east ? `(${east.x},${east.y})` : "missing"}`);
  result(!!west && west.combatants >= 8 && east && east.combatants >= 4 && west.combatants > east.combatants,
    `C: combatant counts west ${west?.combatants} > east ${east?.combatants} (12 vs 6 bodies, the ones that traded blows)`);
  result(fs.fights.every((f) => f.units && !f.buildings && f.kind === "raid" && f.label === "Greenskin raid"),
    "C: both fights: colony units in, no buildings, kind raid, label 'Greenskin raid'");
  result(fs.fights.every((f) => f.dps > 0 && f.intensity >= 1 && f.intensity <= 3 && f.quiet >= 0 && f.quiet <= FIGHT_WINDOW_SECONDS),
    `C: dps / intensity / quiet in range (${fs.fights.map((f) => `${f.dps}dps i${f.intensity} q${f.quiet}`).join(", ")})`);
  result(new Set(fs.fights.map((f) => f.id)).size === 2, "C: distinct fight ids");
  firstIds = { west: west?.id, east: east?.id };

  // Direction, through the client's own arrow placement: the player's 1280x720 viewport centred on them.
  const me = a.me();
  const viewW = 1280, viewH = 720, zoom = 1.3;
  const toScreen = (f) => ({ x: viewW / 2 + ((f.x + 0.5) * TILE - me.x) * zoom, y: viewH / 2 + ((f.y + 0.5) * TILE - me.y) * zoom });
  const insets = { top: 60, right: 30, bottom: 40, left: 30 };
  if (west && east) {
    const ws = toScreen(west), es = toScreen(east);
    const wa = placeEdgeArrow(viewW, viewH, ws.x, ws.y, insets);
    const ea = placeEdgeArrow(viewW, viewH, es.x, es.y, insets);
    result(!wa.onScreen && Math.abs(wa.x - insets.left) < 1e-6 && Math.abs(Math.abs(wa.angle) - Math.PI) < 0.35,
      `C: west fight -> arrow on the left rim (${wa.x.toFixed(0)},${wa.y.toFixed(0)}), angle ${(wa.angle * 180 / Math.PI).toFixed(0)}deg, ${compassDirection(west.x - me.x / TILE, west.y - me.y / TILE)}`);
    result(!ea.onScreen && Math.abs(ea.x - (viewW - insets.right)) < 1e-6 && Math.abs(ea.angle) < 0.35,
      `C: east fight -> arrow on the right rim (${ea.x.toFixed(0)},${ea.y.toFixed(0)}), angle ${(ea.angle * 180 / Math.PI).toFixed(0)}deg, ${compassDirection(east.x - me.x / TILE, east.y - me.y / TILE)}`);
    result(compassDirection(west.x - me.x / TILE, west.y - me.y / TILE) === "west" && compassDirection(east.x - me.x / TILE, east.y - me.y / TILE) === "east",
      "C: compass names west / east");
  }
}
await ff(20);
{
  const fs = await fightState();
  const west = fs.fights.find((f) => f.x < TC.x);
  const east = fs.fights.find((f) => f.x > TC.x);
  result(west?.id === firstIds.west && east?.id === firstIds.east, `C: ids stable across scans (west ${firstIds.west}->${west?.id}, east ${firstIds.east}->${east?.id})`);
  const snap = await a.freshSnap();
  const ids = (snap.fights ?? []).map((f) => f.id).sort();
  result(ids.length === 2 && ids.includes(firstIds.west) && ids.includes(firstIds.east) && snap.fights.every((f) => f.you === false),
    `C: snapshot.fights lists both for the player, you=false (${JSON.stringify(ids)})`);
}

// ---------------------------------------------------------------- E: expiry
// The goblins may already be dead: a fresh orc skirmish in each arena, a second of blows, then every
// mob removed without a blow (damageMob hook carries no attacker), so the last blow is ~now.
await skirmish(WEST.x, WEST.y, 2, 2, "orc");
await skirmish(EAST.x, EAST.y, 2, 2, "orc");
await ff(20);
await killAllMobs();
{
  const fs = await fightState();
  const lastTick = fs.cycleTick;
  await ff(Math.round((FIGHT_WINDOW_SECONDS - 1) * TICK_RATE));
  const mid = await fightState();
  result(mid.fights.length === 2 && mid.fights.every((f) => f.quiet >= 1.5),
    `E: ${FIGHT_WINDOW_SECONDS - 1}s after the last blow both fights still listed, quiet ${mid.fights.map((f) => f.quiet).join("/")}`);
  await ff(Math.round(1.5 * TICK_RATE));
  const end = await fightState();
  result(end.fights.length === 0 && end.hits === 0, `E: ${FIGHT_WINDOW_SECONDS + 0.5}s after: fights gone (${end.fights.length}), hits pruned (${end.hits})`);
  const snap = await a.freshSnap();
  result(snap.fights === undefined, "E: snapshot omits `fights` when there are none");
  info(`E: last blow ~tick ${lastTick}, now ${end.cycleTick}`);
}
await killSoldiers();

// ---------------------------------------------------------------- R: relevance
{
  const b = connect();
  await b.ready();
  const FAR = { x: 14, y: 14 };
  await clearArea(FAR.x, FAR.y, 3);
  await b.call("teleportPlayer", { x: px(FAR.x), y: px(FAR.y) });
  await a.call("teleportPlayer", { x: px(TC.x), y: px(TC.y + 3) });
  const troll = await a.call("spawnMob", { kind: "troll", tx: FAR.x + 1, ty: FAR.y });
  info(`R: B at (${FAR.x},${FAR.y}), ${Math.hypot(FAR.x - TC.x, FAR.y - TC.y - 3).toFixed(0)} tiles from A; troll ${troll.id?.slice(0, 8)}`);
  // B swings a few times (cooldown runs on sim ticks), stepping up to the troll each time (it walks off).
  const swing = async () => {
    const t = (await a.call("raidState")).mobs.find((m) => m.id === troll.id);
    if (t) await b.call("teleportPlayer", { x: t.x - TILE * 0.8, y: t.y });
    b.send({ type: "attack" });
  };
  for (let i = 0; i < 4; i++) {
    await swing();
    await sleep(60);
    await ff(15);
  }
  const fsB = await b.call("fightState");
  const fsA = await a.call("fightState");
  const trollNow = (await a.call("raidState")).mobs.find((m) => m.id === troll.id);
  info(`R: troll now ${trollNow ? `(${(trollNow.x / TILE).toFixed(1)},${(trollNow.y / TILE).toFixed(1)}) hp ${trollNow.hp}` : "gone"}; fights ${JSON.stringify(fsB.fights.map((f) => [f.x, f.y, f.playerIds.length]))}`);
  const theFight = fsB.fights.find((f) => f.playerIds.includes(b.welcome.id));
  result(!!theFight && !theFight.units && !theFight.buildings && theFight.playerIds.includes(b.welcome.id),
    `R: B's blows make a fight at ${theFight ? `(${theFight.x},${theFight.y})` : "?"} with B in it, no colony units/buildings`);
  result(fsB.mine.some((f) => f.id === theFight?.id && f.you === true), "R: B's list has it, you=true");
  result(!fsA.mine.some((f) => f.id === theFight?.id), `R: A's list (${fsA.mine.length}) leaves it out: > ${FIGHT_RELEVANCE_TILES} tiles away, not A's fight`);
  const snapB = await b.freshSnap();
  result((snapB.fights ?? []).some((f) => f.id === theFight?.id && f.you), "R: B's snapshot carries it");
  const snapA = await a.freshSnap();
  result(!(snapA.fights ?? []).some((f) => f.id === theFight?.id), "R: A's snapshot doesn't");
  await a.call("teleportPlayer", { x: px(FAR.x + 20), y: px(FAR.y + 20) });
  await swing();
  await sleep(60);
  await ff(10);
  const near = await a.call("fightState");
  result(near.mine.some((f) => f.id === theFight?.id && f.you === false), "R: once A is within range, A's list has it (you=false)");
  b.ws.close();
  await a.call("teleportPlayer", { x: px(TC.x), y: px(TC.y + 3) });
  await killAllMobs();
  await ff(FIGHT_WINDOW_SECONDS * TICK_RATE + 10);
}

// ---------------------------------------------------------------- B: building under attack
{
  const S = { x: TC.x, y: TC.y - 34 };
  await clearArea(S.x, S.y, 4);
  await a.call("setInstantBuild", { enabled: true });
  await a.call("setStock", { stock: { wood: 9999, rock: 9999, iron: 9999, gold: 9999 } });
  await a.call("setTileRaw", { tx: S.x, ty: S.y, tile: T.House });
  await a.call("spawnMob", { kind: "goblin", tx: S.x + 1, ty: S.y });
  await ff(60);
  const fs = await fightState();
  const f = fs.fights.find((x) => dist(x, S) <= 4);
  info(`B: ${JSON.stringify(fs.fights.map((x) => ({ x: x.x, y: x.y, units: x.units, buildings: x.buildings, label: x.label })))}`);
  result(!!f && f.buildings, `B: goblin next to a lone house -> fight with buildings=true${f ? ` at (${f.x},${f.y})` : ""}`);
  await killAllMobs();
  await a.call("setInstantBuild", { enabled: false });
  await ff(FIGHT_WINDOW_SECONDS * TICK_RATE + 10);
}

// ---------------------------------------------------------------- K: cap
{
  const spots = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) spots.push({ x: 16 + i * 18, y: TC.y + (j === 0 ? -40 : 40) });
  for (const s of spots) await clearArea(s.x, s.y, 3);
  for (const s of spots) await skirmish(s.x, s.y, 1, 1);
  await ff(30);
  const fs = await fightState();
  result(fs.fights.length === spots.length, `K: ${spots.length} separate skirmishes -> ${fs.fights.length} fights tracked`);
  result(fs.mine.length === FIGHT_MAX_PER_PLAYER, `K: the player's list capped at ${FIGHT_MAX_PER_PLAYER} (${fs.mine.length})`);
  const snap = await a.freshSnap();
  result((snap.fights ?? []).length === FIGHT_MAX_PER_PLAYER, `K: snapshot.fights capped too (${(snap.fights ?? []).length})`);
  const sorted = fs.mine.every((f, i) => i === 0 || fs.mine[i - 1].intensity >= f.intensity);
  result(sorted, "K: list ordered by intensity (then distance)");
  await killAllMobs();
  await killSoldiers();
}

console.log(fails === 0 ? `\nALL PASS (${passes})` : `\n${fails} FAILURE(S), ${passes} passed`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
