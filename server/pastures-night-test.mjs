// Scripted test (2026-11-06): pasture animals + 2x2 orchards, villagers indoors at night, couples' births.
// Self-contained: boots its OWN 96x96 server with COLONY_TEST_HOOKS=1 on PORT (default 22330) and a temp
// COLONY_SAVE_DIR, kills its process group after. Run from server/: `node pastures-night-test.mjs`.
//   O an Orchard takes a clear 2x2 block (3 part tiles, 10 wood) and pays 4 x 90 x 0.5 fruit a cycle.
//   P a Pig pasture (2x2) pays the most meat and no hide; a Cow pasture meat + hides; a Sheep pasture wool + meat
//     (PASTURE_YIELDS x 4 tiles x FOOD_OUTPUT_MULT); the info panel names them Cow / Pig Pasture.
//   N at night every person (workers, free villagers, children) ends up indoors (snapshot `sheltered`), none in the
//     open; at dawn nobody is sheltered and the workers go back to work.
//   C births come from couples: adults pair up (mutual Person.partner, stable over dawns), a couple that just had a
//     child cannot have another within COUPLE_BIRTH_COOLDOWN_DAYS, births never pass the population cap.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22330);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const info = (msg) => console.log(`info ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Wall: 1, Pasture: 21, Orchard: 22, WoolFarm: 23, BuildingPart: 90, PigPasture: 104 };
const TILE = 32;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "pastures-night-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "96", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
const killServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
};
process.on("exit", killServer);

function connect() {
  const c = { ws: null, welcome: null, snap: null, tiles: [], events: [], hook: new Map(), saves: [], info: null };
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
    else if (m.type === "buildingInfo") c.info = m.info;
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.W = () => c.welcome.worldTilesX;
  c.tileAt = (x, y) => (x < 0 || y < 0 || x >= c.W() || y >= c.W() ? -1 : c.tiles[y * c.W() + x]);
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  c.freshSnap = async () => {
    const before = c.snap;
    while (c.snap === before) await sleep(10);
    return c.snap;
  };
  c.buildingInfo = async (x, y) => {
    c.info = undefined;
    c.send({ type: "buildingInfo", tileX: x, tileY: y });
    for (let i = 0; i < 300 && c.info === undefined; i++) await sleep(10);
    return c.info;
  };
  return c;
}

const stockOf = async (c) => (await c.hookCall("setStock", { stock: {} })).stock;
// Wood paid into the stock by "Goal complete: ... (+20 wood ...)" toasts since event index `from`.
const goalWood = (c, from) =>
  c.events.slice(from).filter((t) => /^Goal complete/.test(t)).reduce((s, t) => s + Number((t.match(/\+(\d+) wood/) ?? [0, 0])[1]), 0);

try {
  let c;
  for (let i = 0; i < 120; i++) {
    c = connect();
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
  await c.hookCall("setRaids", { enabled: false });
  await c.hookCall("setInstantBuild", { enabled: true });
  await c.hookCall("ignorePlayers", { value: true });
  await c.hookCall("setStock", { stock: { wood: 1000, rock: 1000, iron: 1000, grain: 5000, meat: 0, fruit: 0, wool: 0, gold: 500 } });
  const snap = await c.freshSnap();
  const tc = { x: snap.townCenters[0].x, y: snap.townCenters[0].y };

  const usedSpots = [];
  const findSpot = async (w, h) => {
    for (let r = 4; r < 16; r++) {
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2 + r;
        const x = tc.x + Math.round(Math.cos(ang) * r);
        const y = tc.y + Math.round(Math.sin(ang) * r);
        let ok = true;
        for (let dy = -1; dy <= h && ok; dy++) for (let dx = -2; dx <= w && ok; dx++) if (c.tileAt(x + dx, y + dy) !== T.Empty) ok = false;
        if (!ok || usedSpots.some((s) => Math.abs(s.x - x) < 5 && Math.abs(s.y - y) < 5)) continue;
        usedSpots.push({ x, y });
        await c.hookCall("teleportPlayer", { x: (x - 1) * TILE + 16, y: y * TILE + 16 });
        await c.freshSnap();
        return { x, y };
      }
    }
    return null;
  };
  const place = async (x, y, tile) => {
    c.send({ type: "setTile", tileX: x, tileY: y, tile });
    await c.freshSnap();
    await c.freshSnap();
  };
  const ffUntil = async (pred, maxTicks, step = 500) => {
    for (let t = 0; t < maxTicks; t += step) {
      await c.hookCall("fastForward", { ticks: step });
      if (await pred()) return true;
    }
    return false;
  };
  const hides = async () => ((await c.hookCall("progression", {})).snapshot?.items?.hide ?? []).reduce((s, n) => s + n, 0);
  const block = (p) => [c.tileAt(p.x, p.y), c.tileAt(p.x + 1, p.y), c.tileAt(p.x, p.y + 1), c.tileAt(p.x + 1, p.y + 1)];

  // ---- O: 2x2 Orchard ----
  const os = await findSpot(2, 2);
  const woodBefore = (await stockOf(c)).wood;
  const evPlace = c.events.length;
  await place(os.x, os.y, T.Orchard);
  await c.freshSnap();
  const woodPaid = woodBefore + goalWood(c, evPlace) - (await stockOf(c)).wood;
  result(block(os).join() === `${T.Orchard},${T.BuildingPart},${T.BuildingPart},${T.BuildingPart}`, `(O) Orchard anchor + 3 part tiles: ${block(os).join()}`);
  result(woodPaid === 10, `(O) a 2x2 Orchard costs 10 wood (paid ${woodPaid})`);
  const oInfo = await c.buildingInfo(os.x + 1, os.y + 1);
  result(oInfo?.name === "Orchard" && oInfo.bonuses.some((b) => /2x2 orchard: x4/.test(b)), `(O) a part tile opens the Orchard's panel: ${oInfo?.bonuses.find((b) => /orchard/.test(b))}`);
  await c.hookCall("setStock", { stock: { fruit: 0 } });
  const fruitOk = await ffUntil(async () => (await stockOf(c)).fruit > 0, 80000, 1000);
  const fruit = (await stockOf(c)).fruit;
  result(fruitOk && fruit === 180, `(O) one tending cycle pays 4 x 90 x 0.5 = 180 fruit (food balance; got ${fruit})`);
  await place(os.x, os.y, T.Empty);

  // ---- P: pasture animals, one at a time ----
  const animals = [
    // PASTURE_YIELDS x 4 tiles x FOOD_OUTPUT_MULT 0.5 (food balance, 2026-11-06).
    { name: "Cow Pasture", tile: T.Pasture, meat: 240, wool: 0, hide: 2 },
    { name: "Pig Pasture", tile: T.PigPasture, meat: 320, wool: 0, hide: 0 },
    { name: "Sheep Pasture", tile: T.WoolFarm, meat: 200, wool: 180, hide: 0 },
  ];
  for (const a of animals) {
    const ps = await findSpot(2, 2);
    const ev0 = c.events.length;
    for (let i = 0; i < 3 && c.tileAt(ps.x, ps.y) !== a.tile; i++) await place(ps.x, ps.y, a.tile);
    if (c.tileAt(ps.x, ps.y) !== a.tile) info(`${a.name} at (${ps.x},${ps.y}) not placed: ${JSON.stringify(c.events.slice(ev0))}`);
    result(block(ps).join() === `${a.tile},${T.BuildingPart},${T.BuildingPart},${T.BuildingPart}`, `(P) ${a.name} is 2x2: ${block(ps).join()}`);
    const pi = await c.buildingInfo(ps.x, ps.y);
    result(pi?.name === a.name, `(P) its panel reads "${pi?.name}" (${pi?.bonuses.find((b) => /Each batch/.test(b))})`);
    await c.hookCall("setStock", { stock: { meat: 0, wool: 0 } });
    const h0 = await hides();
    const ok = await ffUntil(async () => (await stockOf(c)).meat > 0, 80000, 1000);
    const st = await stockOf(c);
    const dh = (await hides()) - h0;
    // (a dawn in the same fast-forward step may feed a few of it to the colony)
    result(ok && st.meat <= a.meat && st.meat >= a.meat - 30 && st.wool === a.wool && dh === a.hide,
      `(P) ${a.name} batch: meat ${st.meat} (want ${a.meat}), wool ${st.wool} (want ${a.wool}), hide +${dh} (want ${a.hide})`);
    await place(ps.x, ps.y, T.Empty);
  }

  // ---- N: night shelter ----
  await c.hookCall("teleportPlayer", { x: tc.x * TILE + 16, y: (tc.y + 3) * TILE + 16 });
  await c.hookCall("peopleState", { spawn: 3 });
  await c.hookCall("peopleState", { spawn: 2, child: true });
  const rs = await c.hookCall("raidState");
  const cycle = rs.dayTicks + rs.nightTicks;
  const CIV = new Set(["lumberjack", "farmer", "ironMiner", "rockMiner", "farmhand", "artisan", "hunter", "forager", "builder", "villager"]);
  // Some workers first: a Lumberjack post near the Town Center (its worker comes from the free villagers).
  const ls = await findSpot(1, 1);
  await place(ls.x, ls.y, 3);
  await c.hookCall("fastForward", { ticks: 200 });
  await c.hookCall("setCycleTick", { tick: Math.ceil(rs.cycleTick / cycle) * cycle + rs.dayTicks + 5 });
  await c.hookCall("fastForward", { ticks: 1200 });
  let s = await c.freshSnap();
  const civ = s.colonists.filter((u) => CIV.has(u.kind));
  const outside = civ.filter((u) => !u.sheltered);
  result(s.isNight && civ.length >= 6 && outside.length === 0,
    `(N) night: ${civ.length - outside.length}/${civ.length} people indoors (${civ.filter((u) => u.kind === "villager").length} villagers incl. ${civ.filter((u) => u.child).length} children)${outside.length ? `; outside: ${outside.map((u) => `${u.kind}@${Math.floor(u.x / TILE)},${Math.floor(u.y / TILE)}`).join(" ")}` : ""}`);
  // A villager walled in at night still ends up indoors (no idling in the open).
  const v = s.colonists.find((u) => u.kind === "villager" && !u.child);
  if (v) {
    const vx = Math.floor(v.x / TILE), vy = Math.floor(v.y / TILE);
    await c.hookCall("setCycleTick", { tick: Math.ceil(rs.cycleTick / cycle) * cycle + cycle });
    await c.hookCall("fastForward", { ticks: 40 });
    s = await c.freshSnap();
    const v2 = s.colonists.find((u) => u.id === v.id);
    const wx = Math.floor(v2.x / TILE), wy = Math.floor(v2.y / TILE);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) await c.hookCall("setTileRaw", { tx: wx + dx, ty: wy + dy, tile: T.Wall });
    await c.hookCall("setCycleTick", { tick: Math.ceil(rs.cycleTick / cycle) * cycle + cycle + rs.dayTicks + 5 });
    await c.hookCall("fastForward", { ticks: 200 });
    s = await c.freshSnap();
    const v3 = s.colonists.find((u) => u.id === v.id);
    result(!!v3?.sheltered, `(N) a villager walled in at (${wx},${wy}) (was ${vx},${vy}) is still indoors at night: sheltered=${v3?.sheltered}`);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) await c.hookCall("setTileRaw", { tx: wx + dx, ty: wy + dy, tile: T.Empty });
  }
  // Dawn: nobody sheltered; the lumberjack goes back to work.
  await c.hookCall("setCycleTick", { tick: Math.ceil(rs.cycleTick / cycle) * cycle + 3 * cycle + 5 });
  await c.hookCall("fastForward", { ticks: 400 });
  s = await c.freshSnap();
  const still = s.colonists.filter((u) => CIV.has(u.kind) && u.sheltered);
  const lj = s.colonists.find((u) => u.kind === "lumberjack");
  result(!s.isNight && still.length === 0, `(N) dawn: nobody sheltered (${still.length})`);
  result(!!lj && lj.state !== "idle", `(N) dawn: the lumberjack is back at work (state ${lj?.state})`);

  // ---- C: couples ----
  await c.hookCall("peopleState", { creative: false });
  await c.hookCall("setStock", { stock: { grain: 5000 } });
  // Room under the cap: only 8 adults left (the Town Center alone sleeps 12).
  let ps = await c.hookCall("peopleState", { clear: true, spawn: 8 });
  ps = await c.hookCall("peopleState", { dawn: {} });
  const adults = () => ps.persons.filter((p) => !p.child && p.kind !== "hero" && !p.spouse);
  const pairOk = (list) => list.every((p) => !p.partner || ps.persons.find((q) => q.id === p.partner)?.partner === p.id);
  const paired = adults().filter((p) => p.partner).length;
  result(pairOk(adults()) && paired >= adults().length - 1, `(C) dawn pairs the adults into couples: ${paired}/${adults().length} paired, all mutual`);
  const pairs1 = new Map(adults().map((p) => [p.id, p.partner]));
  const births = new Map();
  let overCap = 0;
  for (let d = 0; d < 6; d++) {
    const before = new Set(ps.persons.map((p) => p.id));
    const full = ps.population >= ps.cap;
    ps = await c.hookCall("peopleState", { dawn: {} });
    const kids = ps.persons.filter((p) => !before.has(p.id) && p.origin === "born");
    if (kids.length && (full || ps.population > ps.cap)) overCap++;
    for (const kid of kids) {
      const key = [...kid.parents].sort().join("+");
      births.set(key, (births.get(key) ?? 0) + 1);
    }
  }
  const stable = [...pairs1].every(([id, partner]) => !partner || !ps.persons.find((p) => p.id === id) || ps.persons.find((p) => p.id === id)?.partner === partner);
  result(stable, `(C) couples stay paired over dawns`);
  // Six dawns at the same tick: the cooldown allows at most one child per couple.
  result([...births.values()].every((n) => n === 1) && overCap === 0,
    `(C) at most one child per couple within the cooldown (${JSON.stringify([...births.values()])}), no birth past the cap (${overCap}); pop ${ps.population}/${ps.cap}`);
  info(`births by couple over 6 same-day dawns: ${births.size} couples had a child`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
