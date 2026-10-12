// Scripted test: Half-Latch, the minor demon that slips through when a Ward Stone's ward lapses.
//   A) Setup: 2 Blacksmiths make 10 tools (then demolished), a Brewery burns the colony's grain, a
//      Church goes up (Ward Stones require one) and a Ward Stone next to the player / Town Center.
//      The Ward Priest walks over from the Church and is "warding" by the stone; with only one stone
//      he re-tends it every 10s (WARD_TEND_TICKS), and the ward stands after his first tending.
//   B) Ward up (isWarded true around it): while the priest keeps it tended, night mobs find nothing to
//      target, so the player never takes damage and the Town Center is never hit. No halfLatch exists.
//   C) Lapse, live: the Ward Priest can't be hurt by mobs (pickMobTarget only picks guards/militia,
//      and he's warded anyway), so the only live death is starvation. Once food runs out he takes 10
//      damage every dawn (25 hp -> dies on the 3rd starving dawn). His death doesn't drop the ward at
//      once: the stone stays warded until WARD_GRACE_TICKS (1200) after his last completed tending,
//      i.e. 1000-1201 ticks after his death. Then exactly one halfLatch appears, at the stone's tile
//      center, with the MOB_KIND_CONFIG stats (12 hp).
//   D) Stays lapsed (no food -> his respawn can't be paid for) for 15s: still exactly one halfLatch
//      id ever seen, never a second. The halfLatch is immediately active (moves off the stone toward a
//      target on its own).
//   E) Night-wave exclusion: no mob other than that one lapse spawn was ever a halfLatch, across every
//      night observed during the run.
// Sends "restart" first, which resets the world for every connected client. Runs ~9-12 minutes.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`     [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;

// Mirrors of protocol.ts values used here.
const T = { Empty: 0, ChurchPost: 20, Blacksmith: 26, Brewery: 30, WardStone: 49 };
const WARD_TEND_TICKS = 200;
const WARD_GRACE_TICKS = 1200;

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      for (const fn of c.listeners.slice()) fn(m, prev);
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = (s = c.snap) => s.players.find((p) => p.id === c.welcome.id);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  c.nextSnap = () => new Promise((r) => { const fn = (s) => { c.listeners.splice(c.listeners.indexOf(fn), 1); r(s); }; c.listeners.push(fn); });
  return c;
}

const a = connect();
await a.ready();
const W = () => a.welcome.worldTilesX;
const H = () => a.welcome.worldTilesY;
const tileAt = (x, y) => a.tiles[y * W() + x];
const inB = (x, y) => x >= 0 && y >= 0 && x < W() && y < H();
const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
const center = (t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const food = (s = a.snap) => s.grain + s.meat + s.fruit;

// restart
{
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.nextSnap();
  await a.nextSnap();
  if (a.snap.isPaused) a.send({ type: "pause" });
  a.send({ type: "input", dx: 0, dy: 0 });
}
const guardianIds = new Set(a.snap.mobs.map((m) => m.id));
info(`restarted; ${guardianIds.size} POI guardians at boot (excluded from night-wave accounting)`);

// Global per-snapshot log: every non-guardian mob ever seen (first sighting), night transitions.
let snapIndex = 0;
const firstSeen = new Map(); // id -> { kind, snapIndex, x, y, isNight }
let nightsSeen = 0;
a.listeners.push((s, prev) => {
  snapIndex++;
  if (prev && s.isNight && !prev.isNight) nightsSeen++;
  for (const m of s.mobs) {
    if (guardianIds.has(m.id) || firstSeen.has(m.id)) continue;
    firstSeen.set(m.id, { kind: m.kind, snapIndex, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, isNight: s.isNight });
  }
});

// ---------------------------------------------------------------- A: setup
const meT = tileOf(a.me());
const mePx = a.me();
const reach = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  const t = { x: meT.x + dx, y: meT.y + dy };
  if ((dx === 0 && dy === 0) || !inB(t.x, t.y) || tileAt(t.x, t.y) !== T.Empty) continue;
  if (dist(center(t), mePx) > TILE * 2.5) continue;
  reach.push(t);
}
const adj4 = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
const same = (p, q) => p.x === q.x && p.y === q.y;
const smiths = [];
for (const t of reach) if (smiths.length < 2 && !smiths.some((s) => adj4(s, t))) smiths.push(t);
const brewery = reach.find((t) => !smiths.some((s) => same(s, t)));
const stone = reach.find((t) => !smiths.some((s) => same(s, t)) && !(brewery && same(brewery, t)));
const church = reach.find((t) => !smiths.some((s) => same(s, t)) && !(brewery && same(brewery, t)) && !(stone && (same(stone, t) || adj4(stone, t))));
if (smiths.length < 2 || !brewery || !stone || !church) {
  result(false, `A: not enough free tiles in reach (smiths=${smiths.length}, brewery=${!!brewery}, stone=${!!stone}, church=${!!church})`);
  process.exit(1);
}

for (const t of smiths) a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile: T.Blacksmith });
a.send({ type: "setTile", tileX: brewery.x, tileY: brewery.y, tile: T.Brewery });
await sleep(400);
result(smiths.every((t) => tileAt(t.x, t.y) === T.Blacksmith) && tileAt(brewery.x, brewery.y) === T.Brewery,
  `A: 2 Blacksmiths ${smiths.map((t) => `(${t.x},${t.y})`).join(" ")} + Brewery (${brewery.x},${brewery.y}) placed; wood=${a.snap.wood} iron=${a.snap.iron} grain=${a.snap.grain}`);
{
  const deadline = Date.now() + 60000;
  while (a.snap.tools < 10 && Date.now() < deadline) await sleep(200);
}
for (const t of smiths) a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile: T.Empty });
await sleep(400);
info(`A: tools=${a.snap.tools} wood=${a.snap.wood} food=${food()}; smiths demolished`);

let halfLatchBeforeStone = [...firstSeen.values()].filter((e) => e.kind === "halfLatch").length;
a.send({ type: "setTile", tileX: church.x, tileY: church.y, tile: T.ChurchPost });
await sleep(300);
a.send({ type: "setTile", tileX: stone.x, tileY: stone.y, tile: T.WardStone });
await sleep(600);
const warder = a.snap.colonists.find((k) => k.postX === stone.x && k.postY === stone.y);
result(tileAt(church.x, church.y) === T.ChurchPost && tileAt(stone.x, stone.y) === T.WardStone && warder?.kind === "bishop",
  `A: Church at (${church.x},${church.y}), Ward Stone at (${stone.x},${stone.y}) with the Ward Priest (${warder?.kind}) bound for it (tools ${a.snap.tools}, wood ${a.snap.wood})`);
if (!warder) process.exit(1);
{
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && a.snap.colonists.find((k) => k.id === warder.id)?.state !== "warding") await sleep(50);
  const w = a.snap.colonists.find((k) => k.id === warder.id);
  result(w?.state === "warding" && dist(w, center(stone)) <= TILE * 1.5,
    `A: priest state "${w?.state}", ${(dist(w, center(stone)) / TILE).toFixed(2)} tiles from the stone (<= 1.5 = GARRISON_LOITER_PX); ward stands after ${WARD_TEND_TICKS} ticks of tending`);
  await sleep(11000);
}
info(`A: Town Center ${(dist(center(stone), center({ x: Math.floor(W() / 2), y: Math.floor(H() / 2) })) / TILE).toFixed(1)} and player ${(dist(center(stone), a.me()) / TILE).toFixed(1)} tiles from the stone (ward radius 12)`);

// ---------------------------------------------------------------- B/C: ward up, then lapse
let minPlayerHpWardUp = 100;
let tcHpWardUp0 = a.snap.townCenterHp;
let tcHpAtLapse = null;
let nightMobsWhileWarded = new Set();
let wardUpNightSnaps = 0;
let halfLatchSnapsBeforeLapse = 0;
let death = null; // { snapIndex, snap, prevWarderHp }
let lastWarderHp = warder.hp;
a.listeners.push((s, prev) => {
  if (death) return;
  const w = s.colonists.find((k) => k.id === warder.id);
  if (w) {
    lastWarderHp = w.hp;
    minPlayerHpWardUp = Math.min(minPlayerHpWardUp, a.me(s).hp);
    if (s.isNight) {
      wardUpNightSnaps++;
      for (const m of s.mobs) if (!guardianIds.has(m.id)) nightMobsWhileWarded.add(m.id);
    }
    if (s.mobs.some((m) => m.kind === "halfLatch")) halfLatchSnapsBeforeLapse++;
    tcHpAtLapse = s.townCenterHp;
    return;
  }
  death = { snapIndex, snap: s, prevWarderHp: lastWarderHp };
});

const drainDeadline = Date.now() + 12 * 60000;
let lastLog = 0;
while (!death && Date.now() < drainDeadline) {
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    const w = a.snap.colonists.find((k) => k.id === warder.id);
    info(`waiting for starvation: food=${food()} (grain ${a.snap.grain}) bishop hp=${w?.hp} ${a.snap.isNight ? "night" : "day"} nights=${nightsSeen}`);
  }
  await sleep(200);
}
if (!death) {
  result(false, `C: priest never died within 12 minutes (food=${food()})`);
  process.exit(1);
}
result(!death.snap.mobs.some((m) => m.kind === "halfLatch"),
  `C: priest starved (last hp ${death.prevWarderHp}, food ${food(death.snap)}); the ward does NOT lapse on his death tick (no halfLatch yet)`);
const hlSeenAtDeath = [...firstSeen.values()].filter((e) => e.kind === "halfLatch").length;
let lapse = null;
a.listeners.push((s) => {
  if (lapse || !s.mobs.some((m) => m.kind === "halfLatch")) return;
  lapse = { snapIndex, snap: s };
});
{
  const deadline = Date.now() + 90000;
  while (!lapse && Date.now() < deadline) await sleep(100);
}
if (!lapse) {
  result(false, `C: no halfLatch within 90s of the priest's death`);
  process.exit(1);
}
{
  const after = lapse.snapIndex - death.snapIndex;
  result(hlSeenAtDeath === 0 && after >= WARD_GRACE_TICKS - WARD_TEND_TICKS - 3 && after <= WARD_GRACE_TICKS + 3,
    `C: ward lapsed ${after} ticks after his death (grace: ${WARD_GRACE_TICKS} ticks from his last completed ${WARD_TEND_TICKS}-tick tending -> expect ${WARD_GRACE_TICKS - WARD_TEND_TICKS}..${WARD_GRACE_TICKS + 1})`);
}

result(wardUpNightSnaps > 0 && nightMobsWhileWarded.size >= 2 && minPlayerHpWardUp === 100 && tcHpAtLapse === tcHpWardUp0,
  `B: ward up through ${(wardUpNightSnaps / 20).toFixed(0)}s of night with ${nightMobsWhileWarded.size} night mobs around: player min hp ${minPlayerHpWardUp}, TC hp ${tcHpWardUp0}->${tcHpAtLapse} (nothing in the ward was targetable)`);
result(halfLatchSnapsBeforeLapse === 0 && halfLatchBeforeStone === 0,
  `B: no halfLatch in any snapshot before the lapse (${halfLatchSnapsBeforeLapse} snapshots with one while the ward stood, ${halfLatchBeforeStone} before the stone existed)`);

const ls = lapse.snap;
const hlAtLapse = ls.mobs.filter((m) => m.kind === "halfLatch");
const sc = center(stone);
result(hlAtLapse.length === 1,
  `C: the lapse snapshot/tick has exactly ${hlAtLapse.length} halfLatch`);
if (hlAtLapse.length === 1) {
  const hl = hlAtLapse[0];
  result(hl.x === sc.x && hl.y === sc.y && hl.hp === 12 && hl.maxHp === 12,
    `C: it is at (${hl.x},${hl.y}) = stone tile center (${sc.x},${sc.y}), hp ${hl.hp}/${hl.maxHp} (config 12)`);
}

// ---------------------------------------------------------------- D: stays lapsed, no duplicates
const hlId = hlAtLapse[0]?.id;
let warderBack = false;
let hlStillSnaps = 0;
let maxHlInSnap = 0;
const hlTrack = [];
a.listeners.push((s) => {
  if (s.colonists.some((k) => k.postX === stone.x && k.postY === stone.y)) warderBack = true;
  const hls = s.mobs.filter((m) => m.kind === "halfLatch");
  maxHlInSnap = Math.max(maxHlInSnap, hls.length);
  const mine = hls.find((m) => m.id === hlId);
  if (mine) hlTrack.push({ x: mine.x, y: mine.y, me: a.me(s) });
});
await sleep(15000);
const allHlIds = [...firstSeen.entries()].filter(([, e]) => e.kind === "halfLatch").map(([id]) => id);
result(!warderBack && allHlIds.length === 1 && maxHlInSnap <= 1 && tileAt(stone.x, stone.y) === T.WardStone,
  `D: 15s after the lapse, stone still a WardStone and still unstaffed (food ${food()}, respawn blocked) — halfLatch ids ever seen: ${allHlIds.length}, max in any one snapshot: ${maxHlInSnap}`);
if (hlTrack.length > 1) {
  const first = hlTrack[0];
  const last = hlTrack[hlTrack.length - 1];
  result(dist(first, last) > TILE,
    `D: halfLatch is active, not dormant: moved ${(dist(first, last) / TILE).toFixed(1)} tiles off the stone (player ${(dist(last, last.me) / TILE).toFixed(1)} tiles from it now)`);
} else {
  info(`D: halfLatch tracked for ${hlTrack.length} snapshots (killed?)`);
}

// ---------------------------------------------------------------- E: night-wave exclusion
const nightWave = [...firstSeen.entries()].filter(([id]) => id !== hlId);
const kinds = {};
for (const [, e] of nightWave) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
result(nightWave.length >= 3 && nightWave.every(([, e]) => e.kind !== "halfLatch"),
  `E: ${nightWave.length} non-lapse mobs spawned over ${nightsSeen} nights, none a halfLatch: ${JSON.stringify(kinds)}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} [${el()}]`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
