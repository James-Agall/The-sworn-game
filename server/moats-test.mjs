// Scripted test: moats & drawbridges (forts plan §9 / phase H). Self-contained: boots its OWN 128x128 server
// with COLONY_TEST_HOOKS=1 on PORT (default 22180) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node moats-test.mjs`.
//   P placement: moat 1 wood (not next to the Town Center), drawbridge 25 wood + 10 iron only on a moat, fill = Empty
//   K a raised drawbridge auto-lowers for a knight beside it, raises again when it leaves
//   B a mob outside a moat ring with a drawbridge storms the drawbridge and stays out; a tower shoots across
//   R a battering ram breaks the drawbridge -> the tile is Moat again (no gate record)
//   F a fully closed ring: the mob fills a moat tile (-> Rubble) and gets in
//   S formation slots on a moat band snap to the regiment's bank
//   D a diagonal moat line has no corner squeeze (a mob never crosses it while every tile stands)
//   T the stamper lays Grakkar tier 4's moat + drawbridge (a site gate)
//   L save / load keeps moat tiles, the drawbridge and its lock
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22180);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, House: 13, Tower: 62, Gate: 70, Rubble: 74, Moat: 75, Drawbridge: 76 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "moats-test-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "128", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);

const c = { ws: null, welcome: null, snap: null, tiles: [], events: [], hook: new Map(), saves: [], welcomes: 0 };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.welcomes++;
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
const raw = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const tileAt = (x, y) => c.tiles[y * c.welcome.worldTilesX + x];
const key = (x, y) => `${x},${y}`;
const gateOf = async (x, y) => (await hook("gateState")).gates.find((g) => g.x === x && g.y === y);
const mobOf = async (id) => (await hook("buildingState")).mobs.find((m) => m.id === id);
// Placement needs the player within REACH (2.5 tiles): stand two tiles west of the tile.
const place = async (x, y, tile) => {
  await tp(x - 2, y);
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await ff(1);
  await sleep(30);
};
const stock = async () => (await hook("setStock", { stock: {} })).stock;
const killMob = (id) => hook("damageMob", { mobId: id, amount: 1e6 });

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
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setInstantBuild", { enabled: true });
await hook("setCycleTick", { tick: 0 });
await hook("clearWildlife");
await hook("killColonists", { kind: "builder" });
const tc = c.snap.townCenters[0];
const H = { x: tc.x + 14, y: tc.y };
for (let y = H.y - 12; y <= H.y + 12; y++) for (let x = H.x - 12; x <= H.x + 12; x++) await raw(x, y, T.Empty);

// ---- P: placement rules ----
await hook("setStock", { stock: { wood: 200, rock: 50, iron: 20 } });
await tp(H.x - 4, H.y - 4);
// Ring of radius 2 around the House, drawbridge in the middle of the west side.
const ring = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push({ x: H.x + dx, y: H.y + dy });
const DB = { x: H.x - 2, y: H.y };
await raw(H.x, H.y, T.House);
// A tower within 8 tiles of the drawbridge (no overrun) but out of range of the bank west of it.
await raw(DB.x + 8, DB.y, T.Tower);
for (const r of ring) await place(r.x, r.y, T.Moat);
let st = await stock();
result(ring.every((r) => tileAt(r.x, r.y) === T.Moat) && st.wood === 200 - ring.length, `P: ${ring.length} moat tiles dug for 1 wood each (wood ${st.wood})`);
await place(H.x + 6, H.y + 6, T.Drawbridge);
result(tileAt(H.x + 6, H.y + 6) === T.Empty, `P: a drawbridge on bare ground is refused`);
await place(DB.x, DB.y, T.Drawbridge);
st = await stock();
let g = await gateOf(DB.x, DB.y);
result(tileAt(DB.x, DB.y) === T.Drawbridge && st.wood === 200 - ring.length - 25 && st.iron === 10 && !!g && g.hp?.max === 450,
  `P: drawbridge on the moat for 25 wood + 10 iron, a gate record with 450 HP (wood ${st.wood}, iron ${st.iron})`);
await tp(tc.x + 2, tc.y + 2);
await place(tc.x + 1, tc.y, T.Moat);
result(tileAt(tc.x + 1, tc.y) !== T.Moat, `P: no moat next to the Town Center`);
await tp(H.x + 5, H.y + 5);
await place(H.x + 6, H.y + 6, T.Moat);
await place(H.x + 6, H.y + 6, T.Empty);
result(tileAt(H.x + 6, H.y + 6) === T.Empty, `P: demolishing a moat tile fills it (Empty)`);

// ---- K: knight lowers the drawbridge ----
await tp(tc.x, tc.y + 3);
await ff(60);
g = await gateOf(DB.x, DB.y);
result(g && !g.open, `K: raised with nobody near (open=${g?.open})`);
await hook("spawnSoldier", { kind: "knight", x: (DB.x - 1) * TILE + 16, y: DB.y * TILE + 16 });
await ff(2);
g = await gateOf(DB.x, DB.y);
result(g?.open === true, `K: lowered for a knight beside it`);
await hook("killColonists", { kind: "knight" });
await ff(60);
g = await gateOf(DB.x, DB.y);
result(g?.open === false, `K: raised again ~2 s after the knight is gone`);

// ---- B: raised drawbridge holds; tower shoots across ----
const inRing = (m) => m && Math.abs(Math.floor(m.x / TILE) - H.x) <= 1 && Math.abs(Math.floor(m.y / TILE) - H.y) <= 1;
let mob = await hook("spawnMob", { kind: "orc", tx: H.x - 6, ty: H.y });
await ff(2);
let m = await mobOf(mob.id);
result(m?.targetId === key(DB.x, DB.y), `B: the mob storms the raised drawbridge (target ${m?.targetId})`);
await ff(300);
g = await gateOf(DB.x, DB.y);
m = await mobOf(mob.id);
result(g && g.hp.hp < 450 && !g.open && !inRing(m), `B: drawbridge holds (HP ${g?.hp?.hp}/450), mob outside (${!inRing(m)})`);
await killMob(mob.id);
// Tower inside the ring, an orc idling on the far bank: towers ignore the water.
await raw(H.x + 1, H.y + 1, T.Tower);
mob = await hook("spawnMob", { kind: "orc", tx: H.x + 4, ty: H.y + 4 });
const hp0 = mob.hp;
await ff(200);
const after = (await hook("bodyState")).mobs.find((q) => q.id === mob.id);
result(!after || (hp0 !== undefined && after.hp < hp0), `B: the tower shoots across the moat (hp ${hp0} -> ${after ? after.hp : "dead"})`);
if (after) await killMob(mob.id);
await raw(H.x + 1, H.y + 1, T.Empty);

// ---- R: a ram breaks the drawbridge -> Moat ----
mob = await hook("spawnMob", { kind: "batteringRam", tx: H.x - 6, ty: H.y });
let broke = false;
for (let i = 0; i < 40 && !broke; i++) {
  await ff(100);
  await sleep(20);
  broke = tileAt(DB.x, DB.y) === T.Moat;
}
if (!broke) await hook("damageBuilding", { tx: DB.x, ty: DB.y, amount: 1e6 });
await sleep(30);
g = await gateOf(DB.x, DB.y);
result(broke && tileAt(DB.x, DB.y) === T.Moat && !g, `R: the ram broke the drawbridge -> Moat, no gate record (ram did it: ${broke})`);
if (mob?.id) await killMob(mob.id);

// ---- F: a fully closed ring gets filled ----
mob = await hook("spawnMob", { kind: "orc", tx: H.x - 6, ty: H.y });
await ff(2);
m = await mobOf(mob.id);
const ringKeys = new Set(ring.map((r) => key(r.x, r.y)));
result(ringKeys.has(m?.targetId ?? ""), `F: with no drawbridge the mob goes for a moat tile (target ${m?.targetId})`);
let filled = null;
for (let i = 0; i < 40 && !filled; i++) {
  await ff(100);
  await sleep(20);
  filled = ring.find((r) => tileAt(r.x, r.y) === T.Rubble) ?? null;
}
result(!!filled, `F: the mob filled a moat tile -> Rubble (${filled ? key(filled.x, filled.y) : "none"})`);
await killMob(mob.id);

// ---- S: slots on a moat band snap to the regiment's bank ----
const S = { x: H.x - 6, y: H.y - 8 };
for (let y = S.y - 3; y <= S.y + 3; y++) for (let x = S.x - 1; x <= S.x + 1; x++) await raw(x, y, T.Moat);
const ids = [];
for (let i = 0; i < 4; i++) ids.push((await hook("spawnSoldier", { kind: "spearman", x: (S.x - 5) * TILE + 16, y: (S.y - 2 + i) * TILE + 16 })).id);
send({ type: "regimentOrder", unitIds: ids, order: { kind: "move", x: S.x * TILE + 16, y: S.y * TILE + 16 } });
await ff(300);
let units = (await hook("bodyState")).colonists.filter((u) => ids.includes(u.id));
const onMoat = units.filter((u) => tileAt(Math.floor(u.x / TILE), Math.floor(u.y / TILE)) === T.Moat);
const west = units.every((u) => Math.floor(u.x / TILE) <= S.x - 2 && Math.floor(u.x / TILE) >= S.x - 3);
result(units.length === 4 && onMoat.length === 0 && west, `S: slots snapped to the west bank (x ${units.map((u) => Math.floor(u.x / TILE) - S.x).join(",")}, on moat ${onMoat.length})`);
await hook("killColonists", { kind: "spearman" });

// ---- D: diagonal moat line, no squeeze ----
// A diamond of moat tiles (8-connected only) around a House: the mob may only get in by filling a tile.
const DD = { x: H.x + 4, y: H.y - 8 };
const diamond = [];
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.abs(dx) + Math.abs(dy) === 3) diamond.push({ x: DD.x + dx, y: DD.y + dy });
for (const d of diamond) await raw(d.x, d.y, T.Moat);
await raw(DD.x, DD.y, T.House);
mob = await hook("spawnMob", { kind: "goblin", tx: DD.x + 5, ty: DD.y + 1 });
let squeezed = false;
for (let i = 0; i < 20; i++) {
  await ff(20);
  m = await mobOf(mob.id);
  const inside = m && Math.abs(Math.floor(m.x / TILE) - DD.x) + Math.abs(Math.floor(m.y / TILE) - DD.y) < 3;
  if (inside && diamond.every((d) => tileAt(d.x, d.y) === T.Moat)) squeezed = true;
}
result(!squeezed, `D: no mob slipped through the diagonal moat line`);
await killMob(mob.id);

// ---- T: Grakkar tier 4 is moated ----
for (let y = 80; y <= 115; y++) for (let x = 44; x <= 84; x++) if (tileAt(x, y) !== T.Empty) await raw(x, y, T.Empty);
const gk = await hook("stampSite", { template: "grakkar", dx: 0, dy: 34, search: 30, tier: 4 });
const s = gk?.site;
let moats = 0;
let bridges = [];
if (s) {
  for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
    if (tileAt(x, y) === T.Moat) moats++;
    if (tileAt(x, y) === T.Drawbridge) bridges.push({ x, y });
  }
}
const gates = (await hook("gateState")).gates;
result(!!s && moats === 28 && bridges.length === 1 && gates.some((q) => q.x === bridges[0].x && q.y === bridges[0].y && !q.open),
  `T: Grakkar tier 4: ${moats} moat tiles, ${bridges.length} drawbridge, raised (problem ${gk?.problem ?? "none"})`);

// ---- L: save / load ----
await raw(DB.x, DB.y, T.Drawbridge);
await ff(1);
send({ type: "setGateLock", tileX: DB.x, tileY: DB.y, lock: "open" });
await sleep(50);
c.saves.length = 0;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length === 0; i++) await sleep(10);
send({ type: "setGateLock", tileX: DB.x, tileY: DB.y, lock: "auto" });
await sleep(50);
const w0 = c.welcomes;
c.saves.length = 0;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (c.saves.length === 0 || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
g = await gateOf(DB.x, DB.y);
result(tileAt(DB.x, DB.y) === T.Drawbridge && g?.lock === "open" && tileAt(DB.x, DB.y - 1) === T.Moat,
  `L: loaded: drawbridge + lock "${g?.lock}", moat tiles kept`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
c.ws.close();
killServer();
process.exit(fails === 0 ? 0 : 1);
