// Scripted test: walls & gates (ROADMAP §8 items 2-5). Wall / gate costs and HP, gate placement, auto
// open / close with friendly proximity, a closed gate holding a mob out (it storms the gate instead of a
// stone wall, but breaches a wood wall), a locked-open gate letting it through, the overrun bypass with /
// without a living tower, and the gate lock surviving save / load.
// Needs a FRESH private server (leftover soldiers from an earlier run interfere): PORT=<free port> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>
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
const T = { Empty: 0, Wall: 1, Tower: 62, StoneWall: 11, House: 13, Gate: 70 };
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const key = (x, y) => `${x},${y}`;
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const gateOf = async (x, y, checkOverrun = false) => (await hook("gateState", { checkOverrun })).gates.find((g) => g.x === x && g.y === y);
const mobOf = async (id) => (await hook("buildingState")).mobs.find((m) => m.id === id);

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setInstantBuild", { enabled: true });
await hook("setCycleTick", { tick: 0 });
await hook("setStock", { stock: { wood: 100, rock: 100 } });

// 1. Numbers.
let gs = await hook("gateState");
result(gs.hp.wall === 200 && gs.hp.stoneWall === 900 && gs.hp.gate === 450, `HP wood/stone/gate ${gs.hp.wall}/${gs.hp.stoneWall}/${gs.hp.gate}`);
result(gs.cost.wall.wood === 3 && gs.cost.stoneWall.rock === 3 && gs.cost.gate.wood === 10 && gs.cost.gate.rock === 5, `costs ${JSON.stringify(gs.cost)}`);

const tc = (await hook("constructionState")).townCenters[0];
const H = { x: tc.x + 12, y: tc.y };
for (let y = H.y - 8; y <= H.y + 8; y++) for (let x = H.x - 9; x <= H.x + 8; x++) await setTile(x, y, T.Empty);
const G = { x: H.x - 1, y: H.y };
const far = { x: tc.x * TILE + 16, y: (tc.y + 1) * TILE + 16 };

// 2. Placement + auto open / close.
await hook("teleportPlayer", { x: (G.x - 1) * TILE + 16, y: G.y * TILE + 16 });
send({ type: "setTile", tileX: G.x, tileY: G.y, tile: T.Gate });
await hook("fastForward", { ticks: 1 });
gs = await hook("gateState");
let g = gs.gates.find((q) => q.x === G.x && q.y === G.y);
const stock = c.snap && (await hook("setStock", { stock: {} })).stock;
result(!!g && stock.wood === 90 && stock.rock === 95, `gate placed for 10 wood + 5 rock (stock ${stock.wood}/${stock.rock})`);
result(g?.open === true, `opens with the player beside it (open=${g?.open})`);
await hook("teleportPlayer", far);
await hook("fastForward", { ticks: 30 });
g = await gateOf(G.x, G.y);
result(g?.open === true, `still open 1.5 s after the player left`);
await hook("fastForward", { ticks: 20 });
g = await gateOf(G.x, G.y);
result(g?.open === false, `closed ~2 s after (open=${g?.open})`);

// 3. Stone ring with the gate on the far (west) side, a tower in range (no overrun), no builders.
const ring = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !(H.x + dx === G.x && H.y + dy === G.y)) ring.push({ x: H.x + dx, y: H.y + dy });
await setTile(H.x, H.y, T.House);
for (const r of ring) await setTile(r.x, r.y, T.StoneWall);
// Within 8 tiles of the gate and of the east wall, so both pay the same tower penalty.
const tower = { x: H.x + 3, y: H.y - 6 };
await setTile(tower.x, tower.y, T.Tower);
await hook("killColonists", { kind: "builder" });
await hook("setStock", { stock: { wood: 0, rock: 0, iron: 0 } });
let mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
let m = await mobOf(mob.id);
result(m?.targetId === key(G.x, G.y), `stone ring: mob storms the gate despite the detour (target ${m?.targetId})`);
await hook("fastForward", { ticks: 400 });
g = await gateOf(G.x, G.y);
m = await mobOf(mob.id);
const inside = m &&Math.abs(Math.floor(m.x / TILE) - H.x) <= 1 && Math.abs(Math.floor(m.y / TILE) - H.y) <= 1;
result(g.hp && g.hp.hp < 450 && !g.open && !inside, `closed gate holds: gate HP ${g.hp?.hp}/450, mob outside (${!inside})`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });

// 4. Same with a wood ring: the weaker wood wall is breached instead.
for (const r of ring) await setTile(r.x, r.y, T.Wall);
mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
m = await mobOf(mob.id);
result(ring.some((r) => key(r.x, r.y) === m?.targetId), `wood ring: mob breaches a wood wall (target ${m?.targetId})`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });
for (const r of ring) await setTile(r.x, r.y, T.StoneWall);

// 5. Locked open: any unit passes, the mob goes in for the House.
mob = await hook("spawnMob", { kind: "orc", tx: H.x + 5, ty: H.y });
await hook("fastForward", { ticks: 2 });
send({ type: "setGateLock", tileX: G.x, tileY: G.y, lock: "open" });
await hook("fastForward", { ticks: 25 });
m = await mobOf(mob.id);
result(m?.targetId === key(H.x, H.y), `locked open: mob re-targets the House through the gate (${m?.targetId})`);
let reached = false;
for (let i = 0; i < 20 && !reached; i++) {
  await hook("fastForward", { ticks: 40 });
  m = await mobOf(mob.id);
  reached = !!m && Math.hypot(m.x - (G.x * TILE + 16), m.y - (G.y * TILE + 16)) < TILE * 1.2;
}
result(reached, `mob walked into the open gate`);
await hook("damageMob", { mobId: mob.id, amount: 1e6 });

// 6. Overrun: mobs near the gate, no defenders; with and without the tower.
send({ type: "setGateLock", tileX: G.x, tileY: G.y, lock: "auto" });
await hook("fastForward", { ticks: 60 });
const ids = [];
for (let i = 0; i < 2; i++) ids.push((await hook("spawnMob", { kind: "orc", tx: G.x - 4, ty: G.y + i })).id);
g = await gateOf(G.x, G.y, true);
result(g.open === false && g.overrun === false, `living tower within 8 tiles: no overrun (overrun=${g.overrun}, open=${g.open})`);
await setTile(tower.x, tower.y, T.Empty);
c.events.length = 0;
g = await gateOf(G.x, G.y, true);
await sleep(100);
result(g.overrun === true && c.events.some((e) => e.text === "Gate overrun"), `no tower: hostile majority overruns the gate (+ toast: ${c.events.some((e) => e.text === "Gate overrun")})`);
await hook("spawnSoldier", { kind: "knight", x: (G.x - 3) * TILE + 16, y: (G.y - 4) * TILE + 16 });
for (const id of ids) await hook("damageMob", { mobId: id, amount: 1e6 });
g = await gateOf(G.x, G.y, true);
result(g.overrun === false, `majority lost: overrun ends`);

// 7. Save / load keeps the lock.
send({ type: "setGateLock", tileX: G.x, tileY: G.y, lock: "closed" });
await sleep(50);
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
send({ type: "setGateLock", tileX: G.x, tileY: G.y, lock: "auto" });
await sleep(50);
c.save = null;
const w = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w); i++) await sleep(10);
send({ type: "pause" });
g = await gateOf(G.x, G.y);
result(c.save?.ok === true && g?.lock === "closed" && c.welcome.tiles[G.y * c.welcome.worldTilesX + G.x] === T.Gate, `loaded: gate tile + lock "${g?.lock}" restored`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
