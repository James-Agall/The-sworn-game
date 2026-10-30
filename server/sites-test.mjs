// Scripted test: forts phase B stages 2-3 (stamping / spacing were smoke-tested in stage 1).
// Self-contained: boots its OWN 256x256 server with COLONY_TEST_HOOKS=1 on PORT (default 21640) and a temp
// COLONY_SAVE_DIR, kills its process group after. Run from server/: `node sites-test.mjs`.
//   D a fort stamped ~105 tiles from the start sleeps (no colony unit within 96); the player walking near wakes it
//   R after a faked long sleep, waking refills the garrison (one per 60 s slept, up to the max)
//   W the player inside the provoke radius wakes the whole garrison; standing 26 tiles off, nobody chases past
//     the leash; once calm they heal at home and fall dormant again
//   C razing the keep: RuinedKeep, cleared, "<name> falls!" toast, loot includes the stockpile share
//   K rebuild the ruined keep: refused while a garrison mob lives inside; then a Town Center outpost of the
//     player's clan, the fort's walls owner 0 + that clan, the site captured, grounds released
//   S save / load keeps the captured site, the outpost and the owners
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21640);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const T = { TownCenter: 12, Wall: 50, SiteKeep: 77, RuinedKeep: 78, ConstructionSite: 7 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "sites-test-"));
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
    else if (m.type === "saveResult" || m.type === "loadResult") c.saves.push(m);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const siteOf = async (id) => (await hook("sitesState")).sites.find((s) => s.id === id);
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

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

// Colonists wander up to ~20 tiles from the start: remove them all (respawns come back at the Town Center).
const kinds = new Set((c.snap.colonists ?? []).map((u) => u.kind));
for (const kind of kinds) await hook("killColonists", { kind });

// ---- D: dormancy ----
let st = null;
for (const [dx, dy] of [[110, 110], [-110, 110], [110, -110], [-110, -110], [112, 0], [-112, 0], [0, 112], [0, -112]]) {
  st = await hook("stampSite", { template: "thornwick", dx, dy, search: 8 });
  if (st?.site && Math.max(Math.abs(st.site.keepX - tc.x), Math.abs(st.site.keepY - tc.y)) >= 102) break;
}
const site0 = st?.site;
result(!!site0, `stamped ${site0?.name ?? st?.problem} at ${site0 ? `${site0.keepX - tc.x} / ${site0.keepY - tc.y}` : "?"} tiles from the Town Center`);
if (!site0) process.exit(1);
const id = site0.id;
await tp(tc.x, tc.y + 2);
await ff(TICK * 2);
let s = await siteOf(id);
result(s.awake === false, `D fort asleep with nobody within 96 tiles (awake ${s.awake}, nearest ${JSON.stringify(s.nearestUnit)})`);
await tp(site0.keepX - 40, site0.keepY);
await ff(TICK * 2);
s = await siteOf(id);
result(s.awake === true && s.alive.every((m) => !m.active), `D player 40 tiles off wakes the site (awake ${s.awake}) but not its guardians`);

// ---- R: refill on waking after a long sleep ----
const full = s.alive.length;
for (const m of s.alive.slice(0, 2)) await hook("damageMob", { mobId: m.id, amount: 99999 });
await tp(tc.x, tc.y + 2);
await ff(TICK * 30);
s = await siteOf(id);
const sleptFrom = s.lastSimTick;
result(s.awake === false, `R site asleep again with the player home (nearest ${JSON.stringify(s.nearestUnit)})`);
await hook("siteSet", { siteId: id, fields: { lastSimTick: sleptFrom - TICK * 60 * 3 } });
await tp(site0.keepX - 40, site0.keepY);
await ff(TICK * 2);
s = await siteOf(id);
result(s.awake && s.alive.length === full, `R refilled on waking: ${s.alive.length}/${full} (max ${s.garrisonMax})`);

// ---- W: wake, leash, heal, re-dormant ----
await tp(site0.keepX, site0.keepY + 9);
await ff(TICK * 2);
s = await siteOf(id);
result(s.provoked && s.alive.every((m) => m.active), `W player near the keep provokes the whole garrison (${s.alive.filter((m) => m.active).length}/${s.alive.length} active)`);
const home = { x: s.homeX, y: s.homeY };
// The player backs off south one tile every half second, from 3 to 34 tiles below home (a kite).
let chased = 0;
let maxD = 0;
for (let k = 3; k <= 34; k++) {
  await tp(Math.floor(home.x / TILE), Math.floor(home.y / TILE) + k);
  await ff(10);
  s = await siteOf(id);
  for (const m of s.alive) {
    const d = Math.hypot(m.x - home.x, m.y - home.y) / TILE;
    maxD = Math.max(maxD, d);
    if (k <= 18) chased = Math.max(chased, d);
  }
}
result(chased >= 8, `W defenders chase a retreating player (furthest ${chased.toFixed(1)} tiles from home)`);
result(maxD <= 20, `W nobody chases past the leash (16 + 2, max ${maxD.toFixed(1)} tiles from home)`);
await ff(TICK * 4);
s = await siteOf(id);
const back = Math.max(...s.alive.map((m) => Math.hypot(m.x - home.x, m.y - home.y) / TILE));
result(back <= 12, `W they walk home (furthest now ${back.toFixed(1)} tiles)`);
const hurt = s.alive[0];
await hook("damageMob", { mobId: hurt.id, amount: Math.floor(hurt.maxHp * 0.5) });
await tp(tc.x, tc.y + 2);
await ff(TICK * 8);
s = await siteOf(id);
const healed = s.alive.find((m) => m.id === hurt.id);
result(!!healed && healed.hp > hurt.maxHp * 0.5 + 1, `W a hurt guardian heals at home (${healed?.hp?.toFixed(0)} / ${hurt.maxHp})`);
await ff(TICK * 25);
s = await siteOf(id);
result(s.alive.every((m) => !m.active), `W calm for 20 s: back to dormant (${s.alive.filter((m) => m.active).length} still active)`);
const atHome = s.alive.every((m) => Math.hypot(m.x - m.postX, m.y - m.postY) <= TILE * 2);
result(atHome, "W everyone is back on its post");

// ---- C: clear + loot ----
const before = (await hook("setStock", { stock: {} })).stock;
await tp(site0.keepX, site0.keepY + 2);
await hook("damageHearth", { siteId: id, amount: 99999 });
await ff(2);
const after = (await hook("setStock", { stock: {} })).stock;
s = await siteOf(id);
const toast = c.events.find((e) => e.includes(`${site0.name} falls!`));
result(s.cleared && s.keepTile === T.RuinedKeep, `C keep razed: cleared ${s.cleared}, keep tile ${s.keepTile}`);
result(!!toast, `C toast names the fort: ${toast ?? c.events.slice(-3).join(" | ")}`);
const gotWood = after.wood - before.wood;
result(gotWood >= Math.floor((site0.stock.wood ?? 0) * 0.5), `C loot includes the stockpile share (+${gotWood} wood, stock had ${site0.stock.wood})`);

if (process.env.SITES_TEST_STAGE === "2") {
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
// STAGE3
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
