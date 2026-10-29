// Scripted test: forts phase A, the tile owner map (PLAN-forts-diplomacy-moats.md §1, §10 "A").
// Self-contained: boots its OWN 80x80 server with COLONY_TEST_HOOKS=1 on PORT (default 22110) and a temp
// COLONY_SAVE_DIR, kills its process group after. Run from server/: `node owner-map-test.mjs`.
//   A testHook stampTestSite makes a 5x5 NPC-owned wood ring (gate west, tower in the centre).
//   G the site gate stays shut for a knight standing at it (FOREIGN flag in the snapshot), a mob of the
//     site walks out through it, a foreign mob inside stays walled in.
//   T the site tower shoots a knight in range.
//   B a battering ram ordered at the tower breaches a site wall first (-> walkable Rubble, owner cleared),
//     walks in through the gap and destroys the tower.
//   R a raid mob still breaches a colony wood ring around a House.
//   D the player can't demolish a site wall; siteTiles reaches the client; save / load keeps the owners.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22110);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Wall: 1, House: 13, Tower: 62, Gate: 70, Rubble: 74 };
const GATE_FLAG_FOREIGN = 16;
const TILE = 32;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "owner-map-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "80", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);

const c = { ws: null, welcome: null, welcomes: 0, snap: null, tiles: [], siteTiles: null, hook: new Map(), save: null };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      c.snap = m;
      if (m.siteTiles) c.siteTiles = m.siteTiles;
    } else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.save = m;
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const key = (x, y) => `${x},${y}`;
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const W = () => c.welcome.worldTilesX;
const px = (t) => t * TILE + 16;
const mobOf = async (id) => (await hook("buildingState")).mobs.find((m) => m.id === id);
const gateOf = async (x, y) => (await hook("gateState", { checkOverrun: true })).gates.find((g) => g.x === x && g.y === y);
const colonistOf = async (id) => (await hook("bodyState")).colonists.find((u) => u.id === id);
const inBox = (e, cx, cy, r) => Math.abs(Math.floor(e.x / TILE) - cx) <= r && Math.abs(Math.floor(e.y / TILE) - cy) <= r;

try {
  for (let i = 0; i < 100; i++) {
    connect();
    try {
      await new Promise((res, rej) => {
        c.ws.on("open", res);
        c.ws.on("error", rej);
      });
      break;
    } catch {
      await sleep(300);
    }
  }
  while (!c.welcome || !c.snap) await sleep(20);
  send({ type: "pause" });
  await hook("setRaids", { enabled: false });
  await hook("ignorePlayers", { value: true });
  await hook("setInstantBuild", { enabled: true });
  await hook("setCycleTick", { tick: 0 });
  await hook("killColonists", { kind: "builder" });
  const tc = (await hook("constructionState")).townCenters[0];

  // ---- A: stamp the fort east of the Town Center ----
  const S = { x: tc.x + 16, y: tc.y };
  for (let y = S.y - 7; y <= S.y + 7; y++) for (let x = S.x - 8; x <= S.x + 7; x++) await setTile(x, y, T.Empty);
  const site = await hook("stampTestSite", { cx: S.x, cy: S.y });
  const G = site.gate;
  const own = await hook("ownerState");
  result(own.owners.length === 17 && site.walls.length === 15 && G && site.tower, `stamped: ${own.owners.length} owned tiles (15 walls + gate + tower), site #${site.site}`);
  await ff(2);

  // ---- G: the gate ----
  const k1 = (await hook("spawnSoldier", { kind: "knight", x: px(G.x - 1), y: px(G.y), stance: "defensive" })).id;
  await ff(10);
  let g = await gateOf(G.x, G.y);
  result(g && g.open === false, `site gate stays shut with a knight beside it (open=${g?.open})`);
  const flags = c.snap.gates ? c.snap.gates[c.snap.gates.indexOf(G.y * W() + G.x) + 1] : 0;
  result((flags & GATE_FLAG_FOREIGN) !== 0, `snapshot gate carries GATE_FLAG_FOREIGN (flags ${flags})`);
  await hook("killColonists", { kind: "knight" });
  const own1 = (await hook("spawnMob", { kind: "orc", tx: S.x - 1, ty: S.y, siteId: site.siteId })).id;
  const foreign = (await hook("spawnMob", { kind: "orc", tx: S.x + 1, ty: S.y + 1 })).id;
  let left = false;
  let opened = false;
  for (let i = 0; i < 30 && !left; i++) {
    await ff(20);
    const m = await mobOf(own1);
    left = !!m && !inBox(m, S.x, S.y, 2);
    opened ||= (await gateOf(G.x, G.y))?.open === true;
  }
  result(left, `the site's own mob walks out through its gate`);
  result(opened, `the gate opened for its own mob`);
  const fm = await mobOf(foreign);
  result(!!fm && inBox(fm, S.x, S.y, 1), `a foreign mob inside stays walled in (at ${fm && [Math.floor(fm.x / TILE), Math.floor(fm.y / TILE)]})`);
  await hook("damageMob", { mobId: own1, amount: 1e6 });
  await hook("damageMob", { mobId: foreign, amount: 1e6 });
  await ff(2);

  // ---- T: the tower shoots a knight ----
  const k2 = (await hook("spawnSoldier", { kind: "knight", x: px(S.x), y: px(S.y - 5), stance: "defensive" })).id;
  const hp0 = (await colonistOf(k2))?.hp;
  await ff(60);
  const shots = (await hook("ownerState")).towerShots.filter((s) => s.target === "c:" + k2);
  const hp1 = (await colonistOf(k2))?.hp ?? 0;
  result(shots.length > 0 && hp1 < hp0, `site tower shot the knight ${shots.length}x (hp ${hp0} -> ${hp1})`);
  await hook("killColonists", { kind: "knight" });

  // ---- D: no demolishing a site wall; siteTiles on the client ----
  await hook("teleportPlayer", { x: px(S.x - 3), y: px(S.y - 2) });
  send({ type: "setTile", tileX: S.x - 2, tileY: S.y - 2, tile: T.Empty });
  await ff(2);
  await sleep(100);
  result(c.tiles[(S.y - 2) * W() + S.x - 2] === T.Wall, `player can't demolish a site wall (tile ${c.tiles[(S.y - 2) * W() + S.x - 2]})`);
  result(Array.isArray(c.siteTiles) && c.siteTiles.length === 34, `client got siteTiles (${c.siteTiles?.length / 2} tiles)`);
  await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });

  // ---- B: a ram ordered at the tower breaches a wall, walks in, destroys it ----
  const ram = (await hook("spawnSoldier", { kind: "batteringRam", x: px(S.x + 5), y: px(S.y) })).id;
  send({ type: "commandAttackHearth", unitIds: [ram], tileX: site.tower.x, tileY: site.tower.y });
  let rubble = null;
  let towerGone = false;
  for (let i = 0; i < 80 && !towerGone; i++) {
    await ff(40);
    if (!rubble) rubble = site.walls.find((w) => c.tiles[w.y * W() + w.x] === T.Rubble) ?? null;
    towerGone = c.tiles[site.tower.y * W() + site.tower.x] !== T.Tower;
  }
  const gateIntact = c.tiles[G.y * W() + G.x] === T.Gate;
  result(!!rubble, `a site wall fell to Rubble (${rubble && key(rubble.x, rubble.y)})`);
  const ownAfter = await hook("ownerState");
  result(!!rubble && !ownAfter.owners.some((o) => o.x === rubble.x && o.y === rubble.y), `rubble is no longer site-owned`);
  const ramNow = await colonistOf(ram);
  result(towerGone && gateIntact, `ram walked in through the gap and destroyed the tower (gate intact: ${gateIntact}, ram at ${ramNow && [Math.floor(ramNow.x / TILE), Math.floor(ramNow.y / TILE)]})`);
  await hook("killColonists", { kind: "batteringRam" });

  // ---- R: a raid mob still breaches a colony wood ring ----
  const H = { x: tc.x - 12, y: tc.y };
  for (let y = H.y - 6; y <= H.y + 6; y++) for (let x = H.x - 8; x <= H.x + 6; x++) await setTile(x, y, T.Empty);
  await setTile(H.x, H.y, T.House);
  const ring = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ring.push({ x: H.x + dx, y: H.y + dy });
  for (const r of ring) await setTile(r.x, r.y, T.Wall);
  const raider = (await hook("spawnMob", { kind: "orc", tx: H.x - 5, ty: H.y })).id;
  await ff(2);
  const rm = await mobOf(raider);
  result(ring.some((r) => key(r.x, r.y) === rm?.targetId), `raid mob breaches a colony wood wall (target ${rm?.targetId})`);
  await hook("damageMob", { mobId: raider, amount: 1e6 });

  // ---- save / load keeps the owners ----
  const before = (await hook("ownerState")).owners.map((o) => `${o.x},${o.y}:${o.owner}`).sort().join(" ");
  c.save = null;
  send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
  result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
  await hook("setOwner", { tx: S.x - 2, ty: S.y - 2, siteId: null });
  c.save = null;
  c.siteTiles = null;
  const w = c.welcomes;
  send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && (!c.save || c.welcomes === w); i++) await sleep(10);
  send({ type: "pause" });
  const after = (await hook("ownerState")).owners.map((o) => `${o.x},${o.y}:${o.owner}`).sort().join(" ");
  for (let i = 0; i < 100 && !c.siteTiles; i++) await sleep(20);
  result(c.save?.ok === true && after === before && after.length > 0, `loaded: owners restored (${after.split(" ").length} tiles)`);
  result(Array.isArray(c.siteTiles) && c.siteTiles.length === after.split(" ").length * 2, `siteTiles re-sent after the load`);
  g = await gateOf(G.x, G.y);
  const flags2 = c.snap.gates ? c.snap.gates[c.snap.gates.indexOf(G.y * W() + G.x) + 1] : 0;
  result(!!g && (flags2 & GATE_FLAG_FOREIGN) !== 0, `loaded gate still foreign`);
} catch (e) {
  fails++;
  console.log("FAIL exception", e);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
c.ws?.close();
killServer();
process.exit(fails === 0 ? 0 : 1);
