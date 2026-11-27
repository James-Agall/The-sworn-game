// Scripted test: gravestones on colonist death + the event-notification feed. Deterministic and fast (~10 s):
// deaths are forced with the killColonists / spawnSoldier test hooks (COLONY_TEST_HOOKS=1) instead of waiting for
// a starvation death; the dawn is reached with setCycleTick.
//   A) restart: the snapshot carries gravestones=[].
//   B) One death: one "death" event and exactly one new gravestone, where the colonist stood (<= 8px), variant 0/1.
//   C) Several deaths in one tick (4 knights on one spot, so look-alike stones; then knights + builders back to
//      back): per snapshot, new gravestones == "death" events == colonists that vanished, positions matched 1:1.
//   D) Gravestones persist across snapshots, and are removed only on the dawn snapshot, all at once.
//   E) Night/dawn events arrive in the same snapshot as the isNight flip, one each.
// Sends "restart" first, which resets the world for every connected client.
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
const TILE = 32;
const GAME_DAY_TICKS = 11240; // DAY_TICKS (450 s) + NIGHT_TICKS (112 s) at 20 Hz

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, welcomes: 0, snap: null, listeners: [], pending: [], waiters: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") { c.welcome = m; c.welcomes++; }
  else if (m.type === "event") c.pending.push(m);
  else if (m.type === "snapshot") {
    const prev = c.snap;
    c.snap = m;
    const evs = c.pending;
    c.pending = [];
    for (const fn of c.listeners.slice()) fn(m, prev, evs);
  }
  // A hook result goes to the oldest matching waiter only (back-to-back calls of one op each get their own reply).
  for (const w of c.waiters.slice()) if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); if (m.type === "testHookResult") break; }
});
const send = (m) => c.ws.send(JSON.stringify(m));
const wait = (pred, ms = 15000) => new Promise((resolve, reject) => {
  const w = { pred, resolve };
  c.waiters.push(w);
  setTimeout(() => { if (c.waiters.includes(w)) { c.waiters.splice(c.waiters.indexOf(w), 1); reject(new Error("timeout waiting for message")); } }, ms);
});
// Sends a hook and returns its result promise (not awaited by callers that fire several back to back).
const hook = (op, data = {}) => { const p = wait((m) => m.type === "testHookResult" && m.op === op); send({ type: "testHook", op, ...data }); return p; };
const nextSnaps = async (n) => { for (let i = 0; i < n; i++) await wait((m) => m.type === "snapshot"); };

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
{
  const before = c.welcomes;
  send({ type: "restart" });
  while (c.welcomes === before) await sleep(20);
  await nextSnaps(2);
}
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
if (c.snap.isPaused) send({ type: "pause" });
send({ type: "input", dx: 0, dy: 0 });
result(Array.isArray(c.snap.gravestones) && c.snap.gravestones.length === 0, `A: restart snapshot carries gravestones=[] (${JSON.stringify(c.snap.gravestones)})`);

// ---------------------------------------------------------------- per-snapshot invariants
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const log = []; // one entry per tick that had a death event or a gravestone change
const bad = { count: [], placement: [], variant: [], removal: [], dawnLeft: [], flip: [] };
let jumping = false;
let deathEvents = 0, nightEvents = 0, dawnEvents = 0, nightFlips = 0, dawnFlips = 0;
c.listeners.push((s, prev, evs) => {
  if (!prev) return;
  const nightEvs = evs.filter((e) => e.category === "night").length;
  const dawnEvs = evs.filter((e) => e.category === "dawn").length;
  // A raid razing a building ("X destroyed") posts in the "death" category too but leaves no gravestone.
  const deathEvs = evs.filter((e) => e.category === "death" && !/ destroyed\b/.test(e.text));
  nightEvents += nightEvs; dawnEvents += dawnEvs; deathEvents += deathEvs.length;
  // The setCycleTick jump into the night is the hook's doing (it resyncs wasNight), so it posts no "night" event.
  const nightFlip = s.isNight && !prev.isNight && !jumping;
  const dawnFlip = !s.isNight && prev.isNight;
  if (nightFlip) nightFlips++;
  if (dawnFlip) dawnFlips++;
  if (nightEvs !== (nightFlip ? 1 : 0) || dawnEvs !== (dawnFlip ? 1 : 0)) bad.flip.push(`nightFlip=${nightFlip}/${nightEvs} dawnFlip=${dawnFlip}/${dawnEvs}`);

  if (dawnFlip) {
    // Everything from before the dawn is wiped; stones from deaths in the dawn tick itself may follow.
    if (s.gravestones.length > deathEvs.length) bad.dawnLeft.push(`${s.gravestones.length} left, ${deathEvs.length} deaths`);
    return;
  }
  const added = s.gravestones.slice(prev.gravestones.length);
  if (s.gravestones.length < prev.gravestones.length) bad.removal.push(`${prev.gravestones.length} -> ${s.gravestones.length} outside dawn`);
  const curIds = new Set(s.colonists.map((x) => x.id));
  const vanished = prev.colonists.filter((x) => !curIds.has(x.id));
  const curMobIds = new Set(s.mobs.map((m) => m.id));
  const vanishedMobs = prev.mobs.filter((m) => !curMobIds.has(m.id));
  // Match each new stone to a distinct vanished colonist (else a vanished mob: a monster's stone, no event).
  const pool = vanished.slice(), mobPool = vanishedMobs.slice();
  let colonistStones = 0;
  for (const g of added) {
    if (g.variant !== 0 && g.variant !== 1) bad.variant.push(`${g.x},${g.y},${g.variant}`);
    const i = pool.findIndex((x) => dist(x, g) <= 8);
    if (i >= 0) { pool.splice(i, 1); colonistStones++; continue; }
    const j = mobPool.findIndex((m) => dist(m, g) <= 8);
    if (j >= 0) mobPool.splice(j, 1);
    else bad.placement.push(`${g.x.toFixed(0)},${g.y.toFixed(0)}`);
  }
  if (colonistStones !== deathEvs.length) bad.count.push(`colonistStones=${colonistStones} deathEvents=${deathEvs.length} (${deathEvs.map((e) => e.text).join("; ")})`);
  if (added.length || deathEvs.length) log.push({ added: added.length, colonistStones, deaths: deathEvs.length });
});

// ---------------------------------------------------------------- B: one death
const me = c.snap.players.find((p) => p.id === c.welcome.id);
const spot = { x: me.x + TILE * 3, y: me.y };
const spawnKnights = async (n, at) => {
  for (let i = 0; i < n; i++) await hook("spawnSoldier", { kind: "knight", x: at.x, y: at.y });
};
const stones = () => c.snap.gravestones.length;
await hook("killColonists", { kind: "knight" }); // clean slate
await nextSnaps(2);
const ev0 = deathEvents, st0 = stones();
await spawnKnights(1, spot);
await nextSnaps(1);
const k1 = await hook("killColonists", { kind: "knight" });
await nextSnaps(3);
result(k1.killed === 1 && stones() === st0 + 1 && deathEvents === ev0 + 1,
  `B: one death -> one "death" event and one new gravestone (killed=${k1.killed}, stones ${st0}->${stones()}, events +${deathEvents - ev0})`);

// ---------------------------------------------------------------- C: several deaths in one tick
await spawnKnights(4, spot);
await nextSnaps(1);
const ev1 = deathEvents, st1 = stones(), logN = log.length;
const k4 = await hook("killColonists", { kind: "knight" });
await nextSnaps(3);
result(k4.killed === 4 && deathEvents - ev1 === 4 && stones() - st1 === 4,
  `C: 4 deaths in one tick -> 4 "death" events, 4 new gravestones on one spot (killed=${k4.killed}, events +${deathEvents - ev1}, stones +${stones() - st1})`);
const burst = log.slice(logN).find((e) => e.deaths === 4);
result(!!burst && burst.added === 4 && burst.colonistStones === 4, `C: all four arrive in a single snapshot (${JSON.stringify(burst)})`);

// Mixed kinds, back to back (same or adjacent ticks): the totals still pair up, per snapshot.
await spawnKnights(3, { x: spot.x, y: spot.y + TILE * 2 });
await nextSnaps(1);
const ev2 = deathEvents, st2 = stones();
const kinds = ["knight", "builder", "villager"];
const res = await Promise.all(kinds.map((kind) => hook("killColonists", { kind })));
const total = res.reduce((n, r) => n + r.killed, 0);
await nextSnaps(3);
result(total >= 3 && deathEvents - ev2 === total && stones() - st2 === total,
  `C: mixed kinds ${kinds.map((k, i) => `${k}=${res[i].killed}`).join(" ")} -> ${total} events, ${total} gravestones (events +${deathEvents - ev2}, stones +${stones() - st2})`);

// ---------------------------------------------------------------- D: persistence, removal only at dawn
const standing = stones();
await nextSnaps(10);
result(standing >= 8 && stones() === standing, `D: ${standing} gravestones persist across 10 more snapshots`);
// Jump to 3 ticks before the end of the night; the dawn snapshot follows within a few ticks.
jumping = true;
await hook("setCycleTick", { tick: GAME_DAY_TICKS - 3 });
await nextSnaps(1);
jumping = false;
await wait((m) => m.type === "snapshot" && !m.isNight && dawnFlips >= 1, 15000).catch(() => {});
await nextSnaps(2);
result(stones() === 0 && dawnFlips >= 1, `D: all gravestones gone after the dawn (now ${stones()}, dawnFlips=${dawnFlips})`);

// ---------------------------------------------------------------- invariants over the whole run
result(bad.count.length === 0, `C: per snapshot, colonist gravestones == death events (${bad.count.slice(0, 3).join(" / ") || "no mismatches"})`);
result(bad.placement.length === 0, `C: every gravestone sits where a vanished colonist (or mob) stood (${bad.placement.slice(0, 3).join(" / ") || "all within 8px"})`);
result(bad.variant.length === 0, `C: every variant is 0 or 1`);
result(bad.removal.length === 0, `D: gravestones only removed at dawn (${bad.removal.slice(0, 3).join(" / ") || "ok"})`);
result(bad.dawnLeft.length === 0, `D: every pre-dawn gravestone gone on the dawn snapshot (${bad.dawnLeft.slice(0, 3).join(" / ") || "ok"})`);
result(dawnEvents === dawnFlips && nightEvents === nightFlips && bad.flip.length === 0,
  `E: night/dawn events match the flips, same snapshot (night ${nightEvents}/${nightFlips}, dawn ${dawnEvents}/${dawnFlips}, ${bad.flip.slice(0, 3).join(" / ") || "no mismatches"})`);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL(S)`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
