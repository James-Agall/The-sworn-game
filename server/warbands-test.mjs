// Scripted test: forts phase G (warbands.ts, sites.ts camp growth). Self-contained: boots its OWN 256x256 server
// with COLONY_TEST_HOOKS=1 on PORT (default 21660) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node warbands-test.mjs`.
//   W a warband spawns at the map edge (>= 60 tiles from the Town Center) and walks (abstract: no bodies far away)
//   M a player within 96 tiles materialises it (real mobs), within 20 the "on the move" toast; far again: abstract
//   F it arrives and founds a tier-1 camp (founded, garrison = the warband, "settled" toast)
//   G lazy growth by days: tier 2 / 3 with more garrison and keep HP, walls laid
//   R a tier-3 founded camp raids (3 x tier + day / 4 mobs of its faction) on its night
//   C a razed camp stops growing; a later warband re-settles the spot only after the cooldown
//   S save / load keeps a warband on the move (abstract) and the founded camp
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21660);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const DAY = TICK * 375;
const T = { Wall: 1, SiteKeep: 77 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "warbands-test-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "256", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);

const c = { ws: null, welcome: null, snap: null, tiles: [], events: [], hook: new Map(), saves: [] };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 6000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const bands = async () => (await hook("warbandsState")).warbands;
const siteOf = async (id) => (await hook("sitesState")).sites.find((s) => s.id === id);

for (let i = 0; i < 200; i++) {
  try {
    connect();
    await new Promise((res, rej) => {
      c.ws.once("open", res);
      c.ws.once("error", rej);
    });
    break;
  } catch {
    await sleep(250);
  }
}
while (!c.snap) await sleep(20);
const tc = c.snap.townCenters[0];
const W = c.welcome.worldTilesX;
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });
await tp(tc.x, tc.y + 2);

// ---- W: spawn at the far edge, abstract walk ----
const edges = [{ x: 2, y: tc.y }, { x: W - 3, y: tc.y }, { x: tc.x, y: 2 }, { x: tc.x, y: W - 3 }]
  .sort((a, b) => Math.hypot(b.x - tc.x, b.y - tc.y) - Math.hypot(a.x - tc.x, a.y - tc.y));
let sp = null;
for (const e of edges) {
  sp = await hook("spawnWarband", { faction: "bandit", atX: e.x, atY: e.y, size: 6 });
  if (sp.warband) break;
}
const wb = sp.warband;
result(!!wb && wb.routeLen > 20, `W warband spawned (${wb?.faction}, route ${wb?.routeLen} tiles, problem ${sp.problem ?? "-"})`);
if (!wb) process.exit(1);
const startD = Math.hypot(wb.tile.x - tc.x, wb.tile.y - tc.y);
result(startD >= 60, `W spawn tile ${Math.round(startD)} tiles from the Town Center (>= 60)`);
await ff(TICK * 3);
let b = (await bands()).find((x) => x.id === wb.id);
result(b && b.idx > 2 && !b.materialised && b.members === 0, `W abstract walk far from everyone: idx ${b?.idx?.toFixed(1)}, materialised ${b?.materialised}`);

// ---- M: materialise near a player, sighting toast, abstract again when far ----
const walkableNear = (x, y) => {
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = c.tiles[(y + dy) * W + x + dx];
    if (t === 0) return { x: x + dx, y: y + dy };
  }
  return { x, y };
};
let p = walkableNear(Math.max(3, Math.min(W - 4, b.tile.x + (b.tile.x < W / 2 ? 30 : -30))), b.tile.y);
await tp(p.x, p.y);
await ff(TICK * 2);
b = (await bands()).find((x) => x.id === wb.id);
const bodies = c.snap.mobs ? (c.snap.mobs ?? []).length : 0;
result(b?.materialised && b.members === 6, `M a player 30 tiles off materialises it (members ${b?.members}, ${bodies} mobs on the map)`);
const idxBefore = b.idx;
p = walkableNear(Math.max(3, Math.min(W - 4, b.tile.x)), Math.max(3, Math.min(W - 4, b.tile.y + (b.tile.y < W / 2 ? 14 : -14))));
await tp(p.x, p.y);
await ff(TICK * 4);
b = (await bands()).find((x) => x.id === wb.id);
const moveToast = c.events.find((e) => e.includes("warband is on the move"));
result(!!moveToast, `M sighting toast: "${moveToast ?? c.events.slice(-3).join(" | ")}"`);
result(b && b.idx > idxBefore, `M bodies walk the route (idx ${idxBefore.toFixed(1)} -> ${b?.idx?.toFixed(1)})`);
const corner = [[3, 3], [W - 4, 3], [3, W - 4], [W - 4, W - 4]].map(([x, y]) => ({ x, y }))
  .sort((u, v) => Math.hypot(v.x - b.tile.x, v.y - b.tile.y) - Math.hypot(u.x - b.tile.x, u.y - b.tile.y))[0];
p = walkableNear(corner.x, corner.y);
await tp(p.x, p.y);
await ff(TICK * 2);
b = (await bands()).find((x) => x.id === wb.id);
const rosterN = b ? Object.values(b.roster).reduce((a, v) => a + v, 0) : 0;
result(b && !b.materialised && b.members === 0 && rosterN === 6, `M far again: abstract (materialised ${b?.materialised}, roster ${rosterN})`);

// ---- F: arrive and found a camp ----
await tp(tc.x, tc.y + 2);
let camp = null;
for (let i = 0; i < 40 && !camp; i++) {
  await ff(TICK * 15);
  if ((await bands()).some((x) => x.id === wb.id)) continue;
  camp = (await hook("sitesState")).sites.find((s) => s.founded);
}
result(!!camp && camp.tier === 1 && camp.garrisonMax === 6 && camp.keepTile === T.SiteKeep, `F camp founded: ${camp?.name}, tier ${camp?.tier}, garrison ${camp?.garrisonMax}, keep tile ${camp?.keepTile}`);
const settled = c.events.find((e) => e.startsWith("A warband has settled at"));
result(!!settled, `F settled toast (the warband was sighted): "${settled ?? "-"}"`);
if (!camp) process.exit(1);
const dCamp = Math.hypot(camp.keepX - tc.x, camp.keepY - tc.y);
result(dCamp >= 60, `F camp ${Math.round(dCamp)} tiles from the Town Center`);

// ---- G: lazy growth by days ----
const walls = (s) => {
  let n = 0;
  for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) if (c.tiles[y * W + x] === T.Wall) n++;
  return n;
};
let g = await hook("growSite", { siteId: camp.id, days: 3 });
result(g.gained === 0 && g.tier === 1, `G 3 days: no growth yet (tier ${g.tier})`);
g = await hook("growSite", { siteId: camp.id, days: 2.1 });
await sleep(300);
let s = await siteOf(camp.id);
result(g.tier === 2 && g.garrisonMax === 8 && g.keepMaxHp === 350 && walls(s) > 20, `G 5 days: tier ${g.tier}, garrison ${g.garrisonMax}, keep ${g.keepMaxHp}, ${walls(s)} walls`);
g = await hook("growSite", { siteId: camp.id, days: 12 });
result(g.tier === 3 && g.garrisonMax === 12 && g.keepMaxHp === 550, `G 12 more days: tier ${g.tier} (Thornwick's top), garrison ${g.garrisonMax}, keep ${g.keepMaxHp}`);

// ---- R: tier-3 camp raids on its night ----
const day = Math.floor((await hook("raidState")).cycleTick / DAY);
let groups = [];
for (const d of [day, day + 1]) groups.push(...(await hook("campRaids", { day: d })).groups);
const want = 9 + Math.floor(day / 4);
const near = dCamp <= 140;
result(near ? groups.some((x) => x.faction === "banditBand" && (x.size === want || x.size === 9 + Math.floor((day + 1) / 4))) : groups.length === 0,
  `R ${near ? "raid group" : "out of range (no raid)"}: ${groups.map((x) => `${x.faction} x${x.size}`).join(", ") || "none"} (want ${want})`);
// Out of range: a stamped Thornwick 90 tiles off, marked founded and grown to tier 3, raids instead.
if (!near) {
  let st = null;
  for (const [dx, dy] of [[90, 0], [-90, 0], [0, 90], [0, -90], [70, 70], [-70, -70]]) {
    st = await hook("stampSite", { template: "thornwick", dx, dy, search: 10 });
    if (st.site) break;
  }
  if (st.site) {
    await hook("growSite", { siteId: st.site.id, found: true, tiers: 1 });
    groups = [];
    for (const d of [day, day + 1]) groups.push(...(await hook("campRaids", { day: d })).groups);
    result(groups.some((x) => x.faction === "banditBand" && x.size >= 9), `R a founded tier-3 camp 90 tiles off raids: ${groups.map((x) => `${x.faction} x${x.size}`).join(", ") || "none"}`);
  } else result(false, `R could not stamp a test camp: ${st.problem}`);
}

// ---- C: razed camp, cooldown, re-settle ----
await hook("damageHearth", { siteId: camp.id, amount: 99999 });
await ff(2);
g = await hook("growSite", { siteId: camp.id, days: 20 });
s = await siteOf(camp.id);
result(s.cleared && g.gained === 0 && g.clearedTick !== null, `C razed camp: cleared ${s.cleared}, no growth (gained ${g.gained})`);
let w2 = (await hook("spawnWarband", { faction: "bandit" })).warband;
result(!!w2 && w2.resettle === null, `C within the cooldown a new warband does not pick the spot (resettle ${w2?.resettle})`);
await hook("growSite", { siteId: camp.id, clearedDaysAgo: 11 });
const w3 = (await hook("spawnWarband", { faction: "bandit", size: 5 })).warband;
result(w3?.resettle === camp.id, `C after the cooldown a warband heads for the old spot (resettle ${w3?.resettle === camp.id})`);

// ---- S: save / load ----
b = (await bands()).find((x) => x.id === w3?.id);
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
await sleep(800);
const after = await bands();
const b2 = after.find((x) => x.id === w3?.id);
s = await siteOf(camp.id);
result(c.saves[0]?.ok && c.saves[1]?.ok && b2 && Math.abs(b2.idx - b.idx) <= 2 && s?.founded === true, `S save / load keeps the warbands (${after.length}, idx ${b?.idx?.toFixed(0)} -> ${b2?.idx?.toFixed(0)}) and the founded camp`);
send({ type: "pause", paused: true });
// Let w3 arrive: the razed camp is replaced by a fresh tier-1 camp on the same spot.
let fresh = null;
for (let i = 0; i < 40 && !fresh; i++) {
  await ff(TICK * 15);
  if ((await bands()).some((x) => x.id === w3?.id)) continue;
  fresh = (await hook("sitesState")).sites.find((x) => x.founded && !x.cleared && x.x0 === camp.x0 && x.y0 === camp.y0);
}
const gone = !(await siteOf(camp.id));
result(!!fresh && gone && fresh.tier === 1, `C re-settled: a fresh tier-1 camp (${fresh?.name}) on the old spot, the ruin is gone (${gone})`);
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
