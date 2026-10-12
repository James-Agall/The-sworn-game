// Scripted test: gravestones on colonist death + the event-notification feed.
//   A) Setup: 3 Breweries next to the player. Each spawns an artisan (a food consumer, 20 hp) and
//      burns grain into alcohol, so the colony runs out of food and the artisans start starving
//      (10 damage per starving dawn).
//   B) Day/night events: every snapshot where isNight flips to true was preceded (same tick) by a
//      "night" event, and every flip back to day by a "dawn" event. No night/dawn event arrives
//      without a flip.
//   C) Gravestones, checked on every snapshot for the whole run:
//      - each "death" event is matched by exactly one new gravestone in that tick's snapshot, and a
//        gravestone never appears without a death; each new one sits where a now-vanished colonist
//        stood in the previous snapshot (<= 8px), with variant 0 or 1.
//      - a gravestone never disappears except on a dawn snapshot, and on a dawn snapshot every
//        gravestone from before it is gone (deaths in the dawn tick itself may add new ones).
//   D) The first gravestone persists across many snapshots and is gone right after the next dawn.
// Sends "restart" first, which resets the world for every connected client. Runs ~4-8 minutes.
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

const T = { Empty: 0, Brewery: 30 };

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, tiles: null, listeners: [], events: [], pending: [] };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = m.tiles.slice();
      c.welcomes++;
    } else if (m.type === "tileUpdate") {
      if (c.tiles) c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    } else if (m.type === "event") {
      c.events.push(m);
      c.pending.push(m);
    } else if (m.type === "snapshot") {
      const prev = c.snap;
      c.snap = m;
      const evs = c.pending;
      c.pending = [];
      for (const fn of c.listeners.slice()) fn(m, prev, evs);
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
const gKey = (g) => `${g.x},${g.y},${g.variant}`;

{
  const before = a.welcomes;
  a.send({ type: "restart" });
  while (a.welcomes === before) await sleep(20);
  await a.nextSnap();
  await a.nextSnap();
  if (a.snap.isPaused) a.send({ type: "pause" });
  a.send({ type: "input", dx: 0, dy: 0 });
}
result(Array.isArray(a.snap.gravestones) && a.snap.gravestones.length === 0, `restart: snapshot carries gravestones=[] (${JSON.stringify(a.snap.gravestones)})`);

// ---------------------------------------------------------------- per-snapshot invariants
const stats = {
  nightFlips: 0, dawnFlips: 0, nightEvents: 0, dawnEvents: 0, deathEvents: 0, gravestonesAdded: 0,
  flipMismatch: [], deathMismatch: [], badPlacement: [], badRemoval: [], dawnLeftovers: [], badVariant: [],
};
let first = null; // { key, g, addedAt, seenSnaps, removedOnDawn }
a.listeners.push((s, prev, evs) => {
  if (!prev) return;
  const nightEvs = evs.filter((e) => e.category === "night").length;
  const dawnEvs = evs.filter((e) => e.category === "dawn").length;
  const deathEvs = evs.filter((e) => e.category === "death");
  stats.nightEvents += nightEvs;
  stats.dawnEvents += dawnEvs;
  stats.deathEvents += deathEvs.length;
  const nightFlip = s.isNight && !prev.isNight;
  const dawnFlip = !s.isNight && prev.isNight;
  if (nightFlip) stats.nightFlips++;
  if (dawnFlip) stats.dawnFlips++;
  if (nightEvs !== (nightFlip ? 1 : 0) || dawnEvs !== (dawnFlip ? 1 : 0)) {
    stats.flipMismatch.push(`nightFlip=${nightFlip} nightEvs=${nightEvs} dawnFlip=${dawnFlip} dawnEvs=${dawnEvs}`);
  }

  const prevKeys = new Set(prev.gravestones.map(gKey));
  const curKeys = new Set(s.gravestones.map(gKey));
  const added = s.gravestones.filter((g) => !prevKeys.has(gKey(g)));
  const removed = prev.gravestones.filter((g) => !curKeys.has(gKey(g)));
  stats.gravestonesAdded += added.length;
  if (added.length !== deathEvs.length) {
    stats.deathMismatch.push(`added=${added.length} deathEvents=${deathEvs.length} (${deathEvs.map((e) => e.text).join("; ")})`);
  }
  const curIds = new Set(s.colonists.map((c) => c.id));
  const vanished = prev.colonists.filter((c) => !curIds.has(c.id));
  for (const g of added) {
    if (g.variant !== 0 && g.variant !== 1) stats.badVariant.push(gKey(g));
    const near = vanished.some((c) => dist(c, g) <= 8);
    if (!near) stats.badPlacement.push(`${gKey(g)} vanished=${vanished.map((c) => `${c.kind}@${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(" ")}`);
  }
  if (removed.length > 0 && !dawnFlip) stats.badRemoval.push(`${removed.length} removed outside dawn`);
  if (dawnFlip && removed.length !== prev.gravestones.length) stats.dawnLeftovers.push(`${prev.gravestones.length - removed.length} survived dawn`);

  if (!first && added.length > 0) {
    first = { key: gKey(added[0]), g: added[0], addedAt: Date.now(), seenSnaps: 1, removedOnDawn: null, deathTexts: deathEvs.map((e) => e.text) };
  } else if (first && first.removedOnDawn === null) {
    if (curKeys.has(first.key)) first.seenSnaps++;
    else first.removedOnDawn = dawnFlip;
  }
});

// ---------------------------------------------------------------- A: setup
const meT = tileOf(a.me());
const reach = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  const t = { x: meT.x + dx, y: meT.y + dy };
  if ((dx === 0 && dy === 0) || !inB(t.x, t.y) || tileAt(t.x, t.y) !== T.Empty) continue;
  if (dist(center(t), a.me()) > TILE * 2.5) continue;
  reach.push(t);
}
const adj4 = (p, q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
const breweries = [];
for (const t of reach) if (breweries.length < 3 && !breweries.some((b) => adj4(b, t) || (b.x === t.x && b.y === t.y))) breweries.push(t);
if (breweries.length < 3) {
  result(false, `A: only ${breweries.length} non-adjacent free tiles in reach`);
  process.exit(1);
}
for (const t of breweries) a.send({ type: "setTile", tileX: t.x, tileY: t.y, tile: T.Brewery });
await sleep(500);
result(breweries.every((t) => tileAt(t.x, t.y) === T.Brewery),
  `A: 3 Breweries placed ${breweries.map((t) => `(${t.x},${t.y})`).join(" ")}; grain=${a.snap.grain}, artisans=${a.snap.colonists.filter((c) => c.kind === "artisan").length}`);

// ---------------------------------------------------------------- run until D resolves
const deadline = Date.now() + 10 * 60000;
let lastLog = 0;
while ((!first || first.removedOnDawn === null) && Date.now() < deadline) {
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    const art = a.snap.colonists.filter((c) => c.kind === "artisan").map((c) => c.hp);
    info(`${a.snap.isNight ? "night" : "day"} food=${a.snap.grain + a.snap.meat + a.snap.fruit} artisan hp=[${art}] gravestones=${a.snap.gravestones.length} events=${a.events.length}`);
  }
  await sleep(200);
}

// ---------------------------------------------------------------- report
const cats = {};
for (const e of a.events) cats[e.category] = (cats[e.category] ?? 0) + 1;
info(`events by category: ${JSON.stringify(cats)}; sample texts: ${[...new Set(a.events.map((e) => e.text))].slice(0, 6).join(" | ")}`);

result(stats.nightFlips >= 1 && stats.nightEvents === stats.nightFlips,
  `B: ${stats.nightFlips} nightfall(s), ${stats.nightEvents} "night" event(s)`);
result(stats.dawnFlips >= 1 && stats.dawnEvents === stats.dawnFlips,
  `B: ${stats.dawnFlips} dawn(s), ${stats.dawnEvents} "dawn" event(s)`);
result(stats.flipMismatch.length === 0, `B: night/dawn event always in the same tick as the flip (${stats.flipMismatch.slice(0, 3).join(" / ") || "no mismatches"})`);

result(first !== null, `C: a colonist died within the run (${first ? first.deathTexts.join("; ") : "none"})`);
result(stats.deathEvents >= 1 && stats.deathMismatch.length === 0,
  `C: ${stats.deathEvents} death event(s) <-> ${stats.gravestonesAdded} new gravestone(s), 1:1 per tick (${stats.deathMismatch.slice(0, 3).join(" / ") || "no mismatches"})`);
result(stats.badPlacement.length === 0, `C: every gravestone sits where a vanished colonist stood (${stats.badPlacement.slice(0, 3).join(" / ") || "all within 8px"})`);
result(stats.badVariant.length === 0, `C: every variant is 0 or 1`);
result(stats.badRemoval.length === 0, `C: gravestones only ever removed at dawn (${stats.badRemoval.slice(0, 3).join(" / ") || "ok"})`);
result(stats.dawnLeftovers.length === 0, `C: every pre-dawn gravestone gone on the dawn snapshot (${stats.dawnLeftovers.slice(0, 3).join(" / ") || "ok"})`);

if (first) {
  result(first.seenSnaps >= 20, `D: first gravestone (${first.key}) persisted across ${first.seenSnaps} snapshots (${((Date.now() - first.addedAt) / 1000).toFixed(0)}s)`);
  result(first.removedOnDawn === true, `D: first gravestone removed on the next dawn snapshot (removedOnDawn=${first.removedOnDawn})`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL(S)`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
