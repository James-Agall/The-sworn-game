// Fast smoke suite (`npm run smoke`): ONE server boot (creative mode, test hooks, scratch save dir) and one short,
// independent check per system, run in sequence on that one world. Time is fast-forwarded with test hooks, never
// waited for; checks assert on state. A check that throws FAILs on its own and the rest still run.
// Exit code 0 only if every check passed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const TILE = 32;
const TICK = 20;
const DAY = TICK * 300;
const T = { Empty: 0, Wall: 1, LumberjackPost: 3, KnightPost: 5, House: 13, Pasture: 21, Gate: 70, Moat: 75, Drawbridge: 76 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

// ---- one private server ----
const portFree = (port) =>
  new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(false));
    s.listen(port, () => s.close(() => res(true)));
  });
// A random start (not always 31900): two smoke runs at once (other agents on this machine) must not share a server.
let PORT = 31900 + Math.floor(Math.random() * 500);
while (!(await portFree(PORT))) PORT++;
const saveDir = mkdtempSync(path.join(tmpdir(), "colony-smoke-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const cleanup = () => {
  try { process.kill(-server.pid, "SIGKILL"); } catch {}
  try { rmSync(saveDir, { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

// ---- client ----
const c = { ws: null, welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), results: [], saves: [], saveList: null, info: undefined };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.snap = null;
      c.W = m.worldTilesX;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
    else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hooks.set(m.op, m);
    else if (m.type === "creativeResult") c.results.push(m);
    else if (m.type === "saveResult") c.saves.push(m);
    else if (m.type === "saveList") c.saveList = m.saves;
    else if (m.type === "buildingInfo") c.info = m.info;
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(15)) if (fn()) return true;
  return !!fn();
};
const hook = async (op, args = {}) => {
  c.hooks.delete(op);
  send({ type: "testHook", op, ...args });
  await until(() => c.hooks.has(op), 5000);
  return c.hooks.get(op);
};
const creative = async (msg) => {
  const n = c.results.length;
  send(msg);
  await until(() => c.results.length > n, 3000);
  return c.results[n] ?? null;
};
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const raw = (tx, ty, tile) => hook("setTileRaw", { tx, ty, tile });
const tileAt = (x, y) => c.tiles[y * c.W + x];
const stock = () => hook("setStock", { stock: {} }).then((r) => r.stock);
const snapNow = async () => {
  const s = c.snap;
  await until(() => c.snap !== s, 2000);
  return c.snap;
};
const place = async (x, y, tile, want = tile) => {
  await tp(x - 1, y - 1);
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await until(() => tileAt(x, y) === want, 1500);
};
// Bare ground in a (2r+1) square, fast (fire and forget, then one awaited hook to flush).
const clearBox = async (cx, cy, r) => {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
  await raw(cx, cy, T.Empty);
};
const events = (from) => c.events.slice(from).join(" | ");

// ---- check harness ----
let passed = 0;
const failed = [];
const check = async (name, fn) => {
  const t = Date.now();
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    ok = r === true || (Array.isArray(r) && r[0] === true);
    detail = Array.isArray(r) ? r[1] ?? "" : r === true ? "" : String(r);
  } catch (e) {
    detail = `threw ${e?.message ?? e}`;
  }
  if (ok) passed++;
  else failed.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${detail ? ` - ${detail}` : ""}`);
};

// ---- connect (the server needs a moment to boot) ----
for (let i = 0; i < 240 && !c.snap; i++) {
  try {
    connect();
    await new Promise((res, rej) => { c.ws.once("open", res); c.ws.once("error", rej); });
    break;
  } catch { await sleep(250); }
}
let bootOk = await until(() => c.welcome && c.snap, 30000);
if (bootOk) {
  // Creative mode: infinite stock, instant building (a plain restart is a normal game).
  c.welcome = null;
  send({ type: "restart", difficulty: "normal", creative: true });
  bootOk = await until(() => c.welcome && c.snap?.creative, 30000);
}

if (!bootOk) {
  console.log("FAIL boot: server did not come up in creative mode");
  process.exit(1);
}
const bootPeople = { ...(c.snap.people ?? {}), persons: (c.snap.colonists ?? []).filter((u) => u.name).length };
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });
await hook("setCycleTick", { tick: TICK * 10 });
const me = () => c.snap.players.find((p) => p.id === c.welcome.id);
const tc = c.snap.townCenters[0];
const zero = { grain: 0, meat: 0, fruit: 0, wool: 0, wood: 0, rock: 0, iron: 0, clothes: 0, tools: 0 };

// 1. boot shape
await check("boot: welcome + snapshot shape", () => {
  const w = c.welcome, s = c.snap;
  const ok = w.worldTilesX > 0 && w.tiles.length === w.worldTilesX * w.worldTilesY && w.creative === true && !!w.id
    && !!me() && Array.isArray(s.colonists) && Array.isArray(s.mobs) && s.townCenters.length >= 1 && s.wood >= 999999;
  return [ok, `world ${w.worldTilesX}x${w.worldTilesY}, ${s.colonists.length} colonists, wood ${s.wood}`];
});

// 2. build / demolish + multi-tile footprint
const H = { x: tc.x + 14, y: tc.y };
await clearBox(H.x, H.y, 10);
await tp(H.x - 3, H.y - 3);
await check("build/demolish: House and 2x2 Pasture footprint", async () => {
  await place(H.x, H.y, T.House);
  const built = tileAt(H.x, H.y) === T.House;
  const ev0 = c.events.length;
  await tp(H.x + 3, H.y + 3);
  await place(H.x + 4, H.y + 4, T.Pasture, T.Pasture);
  const foot = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => tileAt(H.x + 4 + dx, H.y + 4 + dy));
  const fullFoot = foot.every((t) => t !== T.Empty);
  await place(H.x, H.y, T.Empty);
  await place(H.x + 4, H.y + 4, T.Empty);
  const gone = tileAt(H.x, H.y) === T.Empty && [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => tileAt(H.x + 4 + dx, H.y + 4 + dy) === T.Empty);
  return [built && fullFoot && gone, `house ${built}, footprint tiles ${foot.join(",")}, demolished ${gone} ${events(ev0)}`];
});

// 3. moat + drawbridge + gate behaviour
await check("moat + drawbridge: placement rules and knight lowers it", async () => {
  const ring = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push({ x: H.x + dx, y: H.y + dy });
  const DB = { x: H.x - 2, y: H.y };
  await raw(H.x, H.y, T.House);
  for (const r of ring) await place(r.x, r.y, T.Moat);
  const moated = ring.every((r) => tileAt(r.x, r.y) === T.Moat);
  await place(H.x + 6, H.y + 6, T.Drawbridge, T.Drawbridge);
  const bareRefused = tileAt(H.x + 6, H.y + 6) === T.Empty;
  await place(DB.x, DB.y, T.Drawbridge);
  const bridge = tileAt(DB.x, DB.y) === T.Drawbridge;
  const gateOf = async () => (await hook("gateState")).gates.find((g) => g.x === DB.x && g.y === DB.y);
  await tp(tc.x, tc.y + 3);
  await ff(60);
  const raised = (await gateOf())?.open === false;
  await hook("spawnSoldier", { kind: "knight", x: (DB.x - 1) * TILE + 16, y: DB.y * TILE + 16 });
  await ff(3);
  const lowered = (await gateOf())?.open === true;
  // (No "raised again" check: a creative world re-trains killed soldiers at once, so one is always near.)
  return [moated && bareRefused && bridge && raised && lowered,
    `moat ${moated}, bare refused ${bareRefused}, bridge ${bridge}, raised with nobody near ${raised}, lowered for a knight ${lowered}`];
});

// 4. a settlement for trade / quests / wagon / vassals
let site = null;
let stampProblem = "";
// The generated map is crowded with forts / ruins: clear a patch and stamp exactly there, trying a grid of spots.
const spots = [];
for (let dx = -80; dx <= 80; dx += 20) for (let dy = -80; dy <= 80; dy += 20) if (Math.hypot(dx, dy) >= 35) spots.push([dx, dy]);
spots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
for (const [dx, dy] of spots) {
  const cx = tc.x + dx, cy = tc.y + dy;
  if (cx < 12 || cy < 12 || cx > c.W - 13 || cy > c.W - 13) continue;
  await clearBox(cx, cy, 11);
  const st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 0 });
  if (st?.site) { site = st.site; break; }
  stampProblem += `[${dx},${dy}: ${st?.problem ?? "no reply"}] `;
}
const sid = site?.id;
const rel = (v) => hook("diploSet", { siteId: sid, relation: v });
const clearMobs = async () => {
  const keep = new Set((await hook("sitesState")).sites.filter((x) => x.id === sid).flatMap((x) => x.alive.map((m) => m.id)));
  await sleep(60);
  for (const m of c.snap.mobs ?? []) if (!keep.has(m.id) && !String(m.kind).startsWith("town")) await hook("damageMob", { mobId: m.id, amount: 1e7 });
};
if (site) {
  await tp(site.keepX, site.keepY + 2);
  await ff(40);
  await clearMobs();
}

await check("settlement: stamped with a keep and garrison", async () => {
  if (!site) return `no site stamped: ${stampProblem}`;
  const s = (await hook("sitesState")).sites.find((x) => x.id === sid);
  return [!!s && s.alive.length > 0 && s.hearth && !s.hearth.destroyed, `${site.name}, ${s?.alive.length} folk, keep tile ${s?.keepTile}`];
});

await check("trade: buy and sell at a Friendly settlement", async () => {
  if (!site) return "no site";
  await tp(site.keepX + 2, site.keepY + 2);
  await rel(30);
  // (A creative world tops our own stock up every message, so assert on events and the settlement's stock.)
  await hook("diploSet", { siteId: sid, stock: { grain: 80, wood: 0, gold: 600 } });
  const theirs = async () => (await hook("diploSet", { siteId: sid })).stock;
  const n = c.events.length;
  send({ type: "tradeWithSite", tileX: site.keepX, tileY: site.keepY, good: "grain", qty: 5, side: "buy" });
  await sleep(150);
  const s1 = await theirs();
  const bought = events(n).includes("Bought 5 grain") && s1.grain === 75;
  const n2 = c.events.length;
  send({ type: "tradeWithSite", tileX: site.keepX, tileY: site.keepY, good: "wood", qty: 10, side: "sell" });
  await sleep(150);
  const s2 = await theirs();
  const sold = /Sold 10 wood/.test(events(n2)) && s2.wood === 10 && s2.gold < 600;
  return [bought && sold, `their grain ${s1.grain}, wood ${s2.wood}, gold ${s2.gold}; ${events(n)}`];
});

await check("quests: post, accept, deliver", async () => {
  if (!site) return "no site";
  await rel(0);
  const p = await hook("questPost", { siteId: sid, kind: "deliver" });
  const q = p.quest;
  if (!q) return `not posted: ${p.problem}`;
  const msg = async (type) => {
    const n = c.events.length;
    send({ type, questId: q.id });
    await sleep(150);
    return events(n);
  };
  const acc = await msg("acceptQuest");
  const accepted = (await hook("questState")).quests.find((o) => o.id === q.id)?.accepted === true;
  await hook("setStock", { stock: { ...zero, gold: 0, [q.good]: q.qty + 5 } });
  const del = await msg("deliverQuest");
  const done = del.includes("Quest complete") && del.includes(`+${q.reward} gold`) && !(await hook("questState")).quests.some((o) => o.id === q.id);
  return [accepted && done, `accepted "${acc}", delivered "${del}"`];
});

await check("wagon: post spawns a wagon with escorts and a trip leaves", async () => {
  if (!site) return "no site";
  await rel(30);
  await hook("diploSet", { siteId: sid, stock: { gold: 600, ...zero } });
  await hook("setStock", { stock: { ...zero, wood: 200, gold: 0 } });
  const px = tc.x + 4, py = tc.y + 4;
  await tp(tc.x, tc.y + 2);
  await clearMobs();
  await hook("wagonPost", { tx: px, ty: py, level: 1, auto: false });
  await ff(TICK + 1);
  const post = async () => (await hook("wagonState")).posts.find((p) => p.key === `${px},${py}`);
  let p = await post();
  const spawned = !!p?.wagon && p.escorts.length >= 1;
  const r = await hook("wagonSend", { tx: px, ty: py, dest: "auto" });
  p = r.posts.find((q) => q.key === `${px},${py}`);
  const leaves = r.problem === "" && p?.wagon?.leg === "out";
  return [spawned && leaves, `wagon ${p?.wagon?.maxHp} HP, ${p?.escorts?.length} escorts, leg ${p?.wagon?.leg}, problem "${r.problem}"`];
});

await check("vassal + tax: fealty then tribute", async () => {
  if (!site) return "no site";
  await tp(tc.x, tc.y + 2);
  await hook("wagonRecall", { id: (c.snap.colonists.find((u) => u.kind === "wagon") ?? {}).id ?? "" });
  for (let i = 0; i < 8; i++) await hook("spawnSoldier", { kind: "knight", x: (tc.x + 2 + (i % 4)) * TILE + 16, y: (tc.y + 3 + Math.floor(i / 4)) * TILE + 16 });
  await ff(TICK * 3);
  await hook("vassalSet", { siteId: sid, relation: 100 });
  let v = await hook("vassalSet", { siteId: sid, dawn: true });
  const vassal = v.vassalOf === 0 && v.tier === "vassal";
  await hook("diploSet", { siteId: sid, stock: { gold: 300, grain: 100, fruit: 40 } });
  await hook("setStock", { stock: { gold: 0, grain: 0, fruit: 0 } });
  send({ type: "setTax", tileX: site.keepX, tileY: site.keepY, on: true });
  await sleep(150);
  await hook("vassalSet", { siteId: sid, nextTaxDay: 0 });
  v = await hook("vassalSet", { siteId: sid, dawn: true });
  const got = await stock();
  return [vassal && v.vassal?.tax === true && got.gold > 0, `vassal ${vassal} (power ${v.clanPower} vs ${v.sitePower}), tribute +${got.gold} gold +${got.grain} grain`];
});

// 5. warband spawn -> settle into a camp -> growth tier
await check("warband: spawn, settle into a camp, grow a tier", async () => {
  await hook("killColonists", { kind: "knight" });
  await tp(tc.x, tc.y + 2);
  const edges = [{ x: 2, y: tc.y }, { x: c.W - 3, y: tc.y }, { x: tc.x, y: 2 }, { x: tc.x, y: c.W - 3 }]
    .sort((a, b) => Math.hypot(b.x - tc.x, b.y - tc.y) - Math.hypot(a.x - tc.x, a.y - tc.y));
  let sp = null;
  for (const e of edges) {
    sp = await hook("spawnWarband", { faction: "bandit", atX: e.x, atY: e.y, size: 6 });
    if (sp.warband) break;
  }
  for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.5, 0.15], [0.5, 0.85]]) {
    if (sp.warband) break;
    const x0 = Math.floor(c.W * fx), y0 = Math.floor(c.W * fy);
    await clearBox(x0 + 4, y0 + 4, 8);
    sp = await hook("spawnWarband", { faction: "bandit", size: 6, x0, y0 });
  }
  const wb = sp.warband;
  if (!wb) return `no warband: ${sp.problem}`;
  let camp = null;
  for (let i = 0; i < 60 && !camp; i++) {
    await ff(TICK * 15);
    if ((await hook("warbandsState")).warbands.some((x) => x.id === wb.id)) continue;
    camp = (await hook("sitesState")).sites.find((s) => s.founded);
  }
  if (!camp) return "warband never settled";
  const g = await hook("growSite", { siteId: camp.id, days: 5.1 });
  return [camp.tier === 1 && g.tier >= 2, `camp ${camp.name} tier ${camp.tier} -> ${g.tier}, garrison ${g.garrisonMax}`];
});

// 6. a raid spawns, spawned soldiers kill it
await check("raid: spawns, aggro at night, killed by spawned soldiers", async () => {
  await hook("holdRaidAggro", { value: false });
  const before = new Set((await hook("raidState")).mobs.map((m) => m.id));
  await hook("spawnRaidNow", { dayIndex: 3 });
  let st = await hook("raidState");
  const fresh = st.mobs.filter((m) => !before.has(m.id) && m.groupId);
  if (!fresh.length) return `no raid mobs spawned (${st.groups.length} groups)`;
  const ids = new Set(fresh.map((m) => m.id));
  // Soldiers on top of the raiders, then night: the fight happens right there.
  const cx = fresh.reduce((a, m) => a + m.x, 0) / fresh.length;
  const cy = fresh.reduce((a, m) => a + m.y, 0) / fresh.length;
  for (let i = 0; i < 16; i++) await hook("spawnSoldier", { kind: i % 2 ? "knight" : "archer", x: cx + (i % 4) * 24 - 36, y: cy + Math.floor(i / 4) * 24 - 36 });
  await hook("setCycleTick", { tick: DAY + 5 });
  let alive = fresh.length;
  for (let i = 0; i < 80 && alive > 0; i++) {
    await ff(TICK * 3);
    st = await hook("raidState");
    alive = st.mobs.filter((m) => ids.has(m.id)).length;
  }
  return [alive === 0, `${fresh.length} raiders spawned (night aggro), ${alive} left alive`];
});

// 7. units + regiment move order
await check("units: creative spawn and a move order", async () => {
  await hook("killColonists", { kind: "knight" });
  await hook("killColonists", { kind: "archer" });
  await clearBox(tc.x - 14, tc.y - 6, 8);
  const ax = (tc.x - 18) * TILE, ay = (tc.y - 6) * TILE;
  const r = await creative({ type: "creativeSpawn", side: "own", kind: "knight", count: 6, x: ax, y: ay, formation: "line" });
  const ids = r?.ids ?? [];
  const ox = ax + 10 * TILE, oy = ay;
  send({ type: "commandMove", unitIds: ids, x: ox, y: oy });
  await ff(TICK * 15);
  await sleep(200);
  const us = c.snap.colonists.filter((u) => ids.includes(u.id));
  const near = us.filter((u) => Math.hypot(u.x - ox, u.y - oy) < 5 * TILE).length;
  return [r?.ok && ids.length === 6 && near >= 5, `spawned ${ids.length}, ${near}/${us.length} within 5 tiles of the target`];
});

// 8. creative neutral + enemy, force-attack
await check("creative: spawn enemy/neutral and force-attack", async () => {
  const ids = c.snap.colonists.filter((u) => u.kind === "knight").map((u) => u.id);
  if (ids.length < 3) return "no knights";
  const own = c.snap.colonists.find((u) => u.id === ids[0]);
  const n = await creative({ type: "creativeSpawn", side: "neutral", kind: "knight", count: 1, x: own.x + 2 * TILE, y: own.y + 2 * TILE });
  const dummyId = n?.ids?.[0];
  await ff(TICK * 5);
  await sleep(150);
  let dummy = c.snap.colonists.find((u) => u.id === dummyId);
  const untouched = !!dummy && dummy.hp === dummy.maxHp && dummy.clan > 0;
  const fa = await creative({ type: "creativeSet", op: "forceAttack", unitIds: ids.slice(0, 3), targetType: "c", targetId: dummyId });
  for (let i = 0; i < 20; i++) {
    await ff(TICK * 3);
    await sleep(50);
    dummy = c.snap.colonists.find((u) => u.id === dummyId);
    if (!dummy || dummy.hp < dummy.maxHp) break;
  }
  const hit = !dummy || dummy.hp < dummy.maxHp;
  const r = await creative({ type: "creativeSpawn", side: "enemy", kind: "goblin", count: 5, x: own.x + 8 * TILE, y: own.y });
  const spawnedEnemies = r?.ok && r.ids.length >= 4;
  await creative({ type: "creativeSet", op: "killMobs" });
  await creative({ type: "creativeSet", op: "clearNeutrals" });
  return [spawnedEnemies && untouched && fa?.ok && hit, `enemies ${r?.ids?.length}, dummy untouched ${untouched}, forceAttack ${fa?.ok}, hit ${hit} (hp ${dummy?.hp ?? "dead"})`];
});

// 8b. village life phase 1: a fixed population (creative switched off for the check)
await check("people: 10 at start, a post takes a free villager, the dead stay dead", async () => {
  const start = bootPeople.persons === 10 && bootPeople.free === 9;
  // Vacancies fill by day only: start in the morning.
  await hook("setCycleTick", { tick: 2 * (DAY + TICK * 75) + TICK * 10 });
  await ff(2);
  await hook("killColonists", { kind: "villager" });
  await hook("peopleState", { creative: false, spawn: 2 });
  await hook("setInstantBuild", { enabled: true });
  const L = { x: tc.x - 6, y: tc.y + 9 };
  await clearBox(L.x, L.y, 2);
  await place(L.x, L.y, T.LumberjackPost);
  await ff(TICK + 1);
  const at = (ps) => ps.persons.filter((p) => p.kind === "lumberjack" && p.postX === L.x && p.postY === L.y);
  let ps = await hook("peopleState");
  const first = at(ps)[0];
  const took = !!first && ps.people.free === 1;
  await hook("damageColonist", { id: first?.id ?? "", amount: 1e6 });
  await ff(TICK * 2 + 1);
  ps = await hook("peopleState");
  const second = at(ps)[0];
  const refilled = !!second && second.id !== first?.id && ps.people.free === 0 && !ps.persons.some((p) => p.id === first?.id);
  await hook("damageColonist", { id: second?.id ?? "", amount: 1e6 });
  // Across a dusk and a dawn (the old respawn windows), by time travel (a whole day of ticks is too slow here).
  await hook("setCycleTick", { tick: DAY - 3 });
  await ff(TICK * 2);
  await hook("setCycleTick", { tick: 2 * DAY + TICK * 150 - 3 });
  await ff(TICK * 3);
  ps = await hook("peopleState");
  const stayDead = at(ps).length === 0 && ps.vacancies.some((q) => q.tx === L.x && q.ty === L.y);
  await place(L.x, L.y, T.Empty);
  ps = await hook("peopleState", { creative: true });
  const dropped = !ps.vacancies.some((q) => q.tx === L.x && q.ty === L.y);
  await hook("setInstantBuild", { enabled: false });
  return [start && took && refilled && stayDead && dropped,
    `boot ${bootPeople.persons} people (${bootPeople.free} free), took ${took}, refilled ${refilled}, stay dead ${stayDead}, vacancy dropped on demolish ${dropped}`];
});

// 8c. village life phase 2: a birth, growing up, an immigrant, freed prisoners (creative off)
await check("people growth: birth, child grows up, immigrant, freed prisoners", async () => {
  // Everyone out (creative-spawned soldiers count toward the housing cap too), then two adults.
  await hook("peopleState", { creative: false, clear: true, spawn: 2 });
  let ps = await hook("peopleState", { dawn: { birth: true } });
  const kid = ps.persons.find((p) => p.child);
  const born = !!kid && kid.parents.length === 2 && ps.people.children === 1;
  await hook("setCycleTick", { tick: (kid?.born ?? 0) + 6 * (DAY + TICK * 75) + 5 });
  await ff(TICK + 1);
  ps = await hook("peopleState");
  const grown = ps.persons.some((p) => p.id === kid?.id && !p.child) && ps.people.children === 0;
  const before = ps.persons.length;
  ps = await hook("peopleState", { dawn: { immigrant: true } });
  const immigrant = ps.persons.filter((p) => p.origin === "immigrant").length >= 3 && ps.persons.length >= before + 1;
  ps = await hook("peopleState", { rescueAt: { x: tc.x + 20, y: tc.y } });
  const rescued = ps.persons.filter((p) => p.origin === "rescued").length;
  await hook("peopleState", { creative: true });
  return [born && grown && immigrant && rescued >= 1 && rescued <= 3, `born ${born} (${kid?.name}), grown ${grown}, immigrant ${immigrant}, ${rescued} rescued, pop ${ps.population}/${ps.cap}`];
});

// 8d. village life phase 3: Train unit needs a free villager + tier gear, takes a day, makes the soldier
await check("training: gear + villager required, 1-day timer, trainee becomes the knight", async () => {
  await hook("peopleState", { creative: false });
  for (const k of ["villager", "knight"]) await hook("killColonists", { kind: k });
  await hook("setInstantBuild", { enabled: true });
  const K = { x: tc.x + 6, y: tc.y + 9 };
  await clearBox(K.x, K.y, 2);
  await place(K.x, K.y, T.KnightPost);
  await ff(2);
  let ps = await hook("peopleState", { trainAt: K });
  const noFreeKnight = !ps.persons.some((p) => p.kind === "knight" && p.postX === K.x) && ps.vacancies.some((q) => q.tx === K.x && q.ty === K.y);
  const noVillager = /No free villager/.test(ps.trainInfo?.reason ?? "");
  await hook("peopleState", { spawn: 1 });
  await hook("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  ps = await hook("peopleState", { trainAt: K });
  const noGear = /T1 weapon/.test(ps.trainInfo?.reason ?? "");
  await hook("setEquipment", { armour: [1, 0, 0], weapon: [1, 0, 0] });
  await hook("setInstantBuild", { enabled: false });
  send({ type: "trainUnit", tileX: K.x, tileY: K.y });
  await sleep(150);
  ps = await hook("peopleState", { trainAt: K });
  const trainee = ps.persons.find((p) => p.training);
  const timer = trainee?.training?.ticksTotal === DAY && ps.people.training === 1;
  const eq = await hook("setEquipment", {});
  const paid = eq.equipment.armour[0] === 0 && eq.equipment.weapon[0] === 0;
  await hook("peopleState", { finishTraining: true });
  await ff(2);
  ps = await hook("peopleState");
  const knight = ps.persons.find((p) => p.id === trainee?.id);
  const done = knight?.kind === "knight" && knight.postX === K.x && !ps.vacancies.some((q) => q.tx === K.x && q.ty === K.y);
  await place(K.x, K.y, T.Empty);
  await hook("peopleState", { creative: true });
  return [noFreeKnight && noVillager && noGear && timer && paid && done,
    `post left open ${noFreeKnight}, refused w/o villager ${noVillager}, w/o gear ${noGear}, 1-day timer ${timer}, gear paid ${paid}, became knight ${done}`];
});

// 9. save/load round trip keeps a stamped site (creative games save to the "creative" slot)
await check("save/load: round trip preserves the stamped site", async () => {
  if (!site) return "no site";
  const before = (await hook("sitesState")).sites.find((s) => s.id === sid);
  c.saves.length = 0;
  send({ type: "saveGame", slot: "slot1" });
  await until(() => c.saves.length > 0, 5000);
  const slot = c.saves[0]?.slot;
  if (!c.saves[0]?.ok) return `save failed: ${JSON.stringify(c.saves[0])}`;
  await raw(site.keepX, site.keepY, T.Empty);
  c.welcome = null;
  send({ type: "loadGame", slot });
  await until(() => c.welcome && c.snap, 15000);
  const after = (await hook("sitesState")).sites.find((s) => s.id === sid);
  const keepBack = tileAt(site.keepX, site.keepY) === before.keepTile;
  return [!!after && after.name === before.name && keepBack && !!c.snap.creative, `slot ${slot}, site ${after?.name}, keep tile ${tileAt(site.keepX, site.keepY)} (was ${before.keepTile}), creative ${!!c.snap.creative}`];
});

// 10. world streaming: the tile registry matches a full scan after everything above (incl. the load), and paths hit the cache
await check("world streaming: registry audit + path cache", async () => {
  const r = await hook("auditRegistry");
  return [r?.bad === 0 && r?.pathHits > 0 && !r?.pathMismatches, `mismatches ${r?.bad}, path cache hits ${r?.pathHits} / misses ${r?.pathMisses} / wrong ${r?.pathMismatches} (counted only with COLONY_PATH_CACHE_VERIFY=1)`];
});

// 11. world streaming phase 2: a 160 map keeps every chunk ACTIVE (nothing freezes below 768 tiles)
await check("world streaming: chunk manager off on small maps", async () => {
  const r = await hook("chunkState", { force: true, x: 2 * TILE, y: 2 * TILE });
  return [r?.on === false && r?.cold === 0 && r?.warm === 0 && r?.active === r?.chunksX * r?.chunksY && r?.at === 2, `on ${r?.on}, ${r?.chunksX}x${r?.chunksY} chunks: ${r?.active} active / ${r?.warm} warm / ${r?.cold} cold`];
});

// 12. world streaming phase 3: every entity is in exactly one form (live or abstract record) after everything above
await check("world streaming: world audit (no duplicated / vanished entities)", async () => {
  const r = await hook("auditWorld");
  return [r?.ok === true, `${r?.problems?.length ?? "?"} problems${r?.problems?.length ? ": " + r.problems.slice(0, 3).join("; ") : ""}; ${JSON.stringify(r?.counts ?? {})}`];
});

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(failed.length === 0 ? `ALL PASS (${passed} checks, ${secs}s)` : `${failed.length} FAILED (${failed.join("; ")}), ${passed} passed, ${secs}s`);
c.ws.close();
process.exit(failed.length === 0 ? 0 : 1);
