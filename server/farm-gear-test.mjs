// Scripted test: hemp fields, 2x2 pastures, gear pickup, forge queue + autocraft
// (ROADMAP "Hemp, pastures, gear pickup, forge autocraft — landed 2026-10-30").
// Self-contained: boots its OWN 96x96 server with COLONY_TEST_HOOKS=1 on PORT (default 22310; the test runner
// passes one from its block) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node farm-gear-test.mjs`.
//   H a Hemp Field is walkable (a soldier can stand on it; a Pasture tile can't) and its farmhand delivers hemp.
//   P a Pasture takes a clear 2x2 block (refused when a part tile is taken), costs 10 wood, stamps 3 part tiles,
//     a part tile opens the same info panel, one tending cycle pays 4 x 90 meat, demolishing a part clears all 4.
//   G already-spawned soldiers pick up stock gear: knight > pikeman > spearman, lower tier first, never down,
//     the old piece goes back to the stock; the snapshot tier changes and a toast fires.
//   Q the forge queue holds 20.
//   A autocraft keeps the stock at its target, stops at the iron / wood reserve, and is kept by save / load.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22310);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Wall: 1, Pasture: 21, CottonFarm: 24, Blacksmith: 26, BuildingPart: 90 };
const TILE = 32;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "farm-gear-"));
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
  await c.hookCall("gearPickupConfig", { enabled: false });
  await c.hookCall("setStock", { stock: { wood: 1000, rock: 1000, iron: 1000, tools: 0, grain: 2000, meat: 0, cotton: 0, gold: 500 } });
  const snap = await c.freshSnap();
  const tc = { x: snap.townCenters[0].x, y: snap.townCenters[0].y };

  // Finds a spot around the Town Center whose w x h block (plus a 1-tile ring) is Empty, teleports the player
  // next to it (left of the anchor) and returns the anchor.
  const usedSpots = [];
  const findSpot = async (w, h) => {
    for (let r = 4; r < 14; r++) {
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

  // ---- H: Hemp Field ----
  const hs = await findSpot(1, 1);
  await place(hs.x, hs.y, T.CottonFarm);
  result(c.tileAt(hs.x, hs.y) === T.CottonFarm, `(H) Hemp Field placed at (${hs.x},${hs.y})`);
  const onHemp = await c.hookCall("spawnSoldier", { kind: "spearman", x: hs.x * TILE + 16, y: hs.y * TILE + 16 });
  result(!!onHemp.id, `(H) a soldier can stand on the Hemp Field (walkable): id ${onHemp.id}`);
  const fhHemp = (await c.hookCall("farmState")).farmhands.find((f) => f.postX === hs.x && f.postY === hs.y);
  result(!!fhHemp, `(H) the Hemp Field has its farmhand (${fhHemp?.cycleTicksRemaining}t to its first batch)`);
  await c.hookCall("setStock", { stock: { cotton: 0 } });
  const hempOk = await ffUntil(async () => (await stockOf(c)).cotton > 0, 40000, 1000);
  const cotton = (await stockOf(c)).cotton;
  result(hempOk && cotton === 90, `(H) the Hemp Field delivers its batch of hemp: +${cotton} cotton (1x1: 90)`);

  // ---- P: 2x2 Pasture ----
  // Refused when a part tile is taken: a wall on the bottom-right part tile.
  const bs0 = await findSpot(2, 2);
  await place(bs0.x + 1, bs0.y + 1, T.Wall);
  const evBlocked = c.events.length;
  await place(bs0.x, bs0.y, T.Pasture);
  result(c.tileAt(bs0.x, bs0.y) === T.Empty && c.tileAt(bs0.x + 1, bs0.y) === T.Empty && c.events.slice(evBlocked).some((t) => /clear 2x2 block/.test(t)),
    `(P) refused with a blocked part tile (anchor ${c.tileAt(bs0.x, bs0.y)}): "${c.events.slice(evBlocked).find((t) => /2x2/.test(t))}"`);
  const ps = await findSpot(2, 2);
  const woodBefore = (await stockOf(c)).wood;
  const evPlace = c.events.length;
  await place(ps.x, ps.y, T.Pasture);
  await c.freshSnap();
  const woodPaid = woodBefore + goalWood(c, evPlace) - (await stockOf(c)).wood;
  const block = [c.tileAt(ps.x, ps.y), c.tileAt(ps.x + 1, ps.y), c.tileAt(ps.x, ps.y + 1), c.tileAt(ps.x + 1, ps.y + 1)];
  result(block.join() === `${T.Pasture},${T.BuildingPart},${T.BuildingPart},${T.BuildingPart}`, `(P) Pasture anchor + 3 part tiles: ${block.join()}`);
  result(woodPaid === 10, `(P) a 2x2 Pasture costs 10 wood (paid ${woodPaid})`);
  const onPart = await c.hookCall("spawnSoldier", { kind: "spearman", x: (ps.x + 1) * TILE + 16, y: (ps.y + 1) * TILE + 16 });
  result(!onPart.id, `(P) part tiles are solid like the Pasture (no soldier spawns there)`);
  const partInfo = await c.buildingInfo(ps.x + 1, ps.y + 1);
  result(partInfo?.name === "Pasture" && partInfo.bonuses.some((b) => /2x2 paddock: x4/.test(b)), `(P) a part tile opens the Pasture's panel: ${partInfo?.name} / ${partInfo?.bonuses.find((b) => /paddock/.test(b))}`);
  await c.hookCall("setStock", { stock: { meat: 0 } });
  const meatOk = await ffUntil(async () => (await stockOf(c)).meat > 0, 40000, 1000);
  const meat = (await stockOf(c)).meat;
  result(meatOk && meat === 360, `(P) one tending cycle pays 4 x 90 = 360 meat (got ${meat})`);
  await c.hookCall("teleportPlayer", { x: (ps.x + 2) * TILE + 16, y: (ps.y + 1) * TILE + 16 });
  await c.freshSnap();
  await place(ps.x + 1, ps.y + 1, T.Empty);
  const after = [c.tileAt(ps.x, ps.y), c.tileAt(ps.x + 1, ps.y), c.tileAt(ps.x, ps.y + 1), c.tileAt(ps.x + 1, ps.y + 1)];
  const fhLeft = (await c.hookCall("farmState")).farmhands.some((f) => f.postX === ps.x && f.postY === ps.y);
  result(after.every((t) => t === T.Empty) && !fhLeft, `(P) demolishing a part tile clears all 4 tiles and the farmhand: ${after.join()}`);
  // A legacy (old-save) 1x1 Pasture: no part tiles, x1.
  const ls = await findSpot(1, 1);
  await c.hookCall("setTileRaw", { tx: ls.x, ty: ls.y, tile: T.Pasture });
  const legacyInfo = await c.buildingInfo(ls.x, ls.y);
  result(legacyInfo?.bonuses.some((b) => /Old 1x1 pasture: x1/.test(b)), `(P) a legacy 1x1 Pasture still reads as one: ${legacyInfo?.bonuses.find((b) => /1x1/.test(b))}`);

  // ---- G: gear pickup ----
  // Only the three soldiers below may pick up gear: the spearman from the Hemp Field check goes.
  await c.hookCall("killColonists", { kind: "spearman" });
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  const gx = (tc.x - 8) * TILE + 16;
  const gy = (tc.y + 6) * TILE + 16;
  const ids = {};
  for (const [i, kind] of ["spearman", "pikeman", "knight"].entries()) {
    ids[kind] = (await c.hookCall("spawnSoldier", { kind, x: gx + i * TILE, y: gy })).id;
  }
  const tiers = async () => {
    const es = await c.hookCall("equipState");
    const of = (id) => es.units.find((u) => u.id === id);
    return { es, k: of(ids.knight), p: of(ids.pikeman), s: of(ids.spearman) };
  };
  let g = await tiers();
  result(g.k && g.p && g.s && [g.k, g.p, g.s].every((u) => u.armourTier === 0 && u.weaponTier === 0), `(G) three soldiers muster unequipped (empty stock)`);
  const ev3 = c.events.length;
  await c.hookCall("setEquipment", { armour: [1, 0, 0], weapon: [0, 0, 0] });
  await c.hookCall("gearPickupConfig", { enabled: true });
  await c.hookCall("fastForward", { ticks: 61 });
  g = await tiers();
  result(g.k.armourTier === 1 && g.p.armourTier === 0 && g.s.armourTier === 0 && g.es.equipment.armour.join() === "0,0,0",
    `(G) one T1 armour goes to the knight first (k/p/s ${g.k.armourTier}/${g.p.armourTier}/${g.s.armourTier})`);
  await c.hookCall("setEquipment", { armour: [0, 1, 0], weapon: [0, 0, 1] });
  await c.hookCall("fastForward", { ticks: 61 });
  g = await tiers();
  result(g.k.armourTier === 2 && g.p.armourTier === 1 && g.s.armourTier === 0 && g.es.equipment.armour.join() === "0,0,0",
    `(G) a T2 upgrades the knight, his old T1 goes to the pikeman (k/p/s ${g.k.armourTier}/${g.p.armourTier}/${g.s.armourTier}, stock ${g.es.equipment.armour})`);
  result(g.k.weaponTier === 3 && g.p.weaponTier === 0, `(G) the one T3 weapon goes to the knight (k/p ${g.k.weaponTier}/${g.p.weaponTier})`);
  await c.hookCall("setEquipment", { armour: [2, 0, 0], weapon: [0, 0, 0] });
  await c.hookCall("fastForward", { ticks: 61 });
  g = await tiers();
  result(g.k.armourTier === 2 && g.p.armourTier === 1 && g.s.armourTier === 1 && g.es.equipment.armour.join() === "1,0,0",
    `(G) never a downgrade or a sideways swap: only the spearman takes a T1 (k/p/s ${g.k.armourTier}/${g.p.armourTier}/${g.s.armourTier}, stock ${g.es.equipment.armour})`);
  const sSnap = (await c.freshSnap()).colonists.find((x) => x.id === ids.spearman);
  result(sSnap?.armourTier === 1, `(G) snapshot carries the spearman's new armourTier ${sSnap?.armourTier}`);
  await c.freshSnap();
  result(c.events.slice(ev3).some((t) => /soldiers? equipped from the armoury stock/.test(t)), `(G) toast: "${c.events.slice(ev3).find((t) => /equipped from/.test(t))}"`);
  await c.hookCall("gearPickupConfig", { enabled: false });

  // ---- Q: forge queue size ----
  const bsSpot = await findSpot(1, 1);
  await place(bsSpot.x, bsSpot.y, T.Blacksmith);
  result(c.tileAt(bsSpot.x, bsSpot.y) === T.Blacksmith, `(Q) Blacksmith placed at (${bsSpot.x},${bsSpot.y})`);
  await c.hookCall("fastForward", { ticks: 5 });
  let info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  result(info?.forge?.cap === 20, `(Q) forge queue cap ${info?.forge?.cap}`);
  c.send({ type: "pause", paused: true });
  await sleep(100);
  for (let i = 0; i < 24; i++) c.send({ type: "queueForge", tileX: bsSpot.x, tileY: bsSpot.y, slot: "weapon" });
  await sleep(100);
  let es = await c.hookCall("equipState");
  const q = es.forges.find((f) => f.key === `${bsSpot.x},${bsSpot.y}`)?.queue.length ?? 0;
  result(q === 20, `(Q) 24 sends queue exactly 20 (saw ${q})`);
  c.send({ type: "pause", paused: false });
  await c.hookCall("fastForward", { ticks: 100 });

  // ---- A: autocraft ----
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  await c.hookCall("setStock", { stock: { iron: 1000, wood: 1000, tools: 0 } });
  c.send({ type: "setForgeAuto", tileX: bsSpot.x, tileY: bsSpot.y, on: true, target: 3 });
  await c.freshSnap();
  await c.hookCall("fastForward", { ticks: 400 });
  es = await c.hookCall("equipState");
  result(es.equipment.armour.join() === "3,0,0" && es.equipment.weapon.join() === "3,0,0", `(A) autocraft fills the stock to target 3 of each (T1): ${JSON.stringify(es.equipment)}`);
  await c.hookCall("fastForward", { ticks: 400 });
  es = await c.hookCall("equipState");
  result(es.equipment.armour[0] === 3 && es.equipment.weapon[0] === 3 && (es.forges.find((f) => f.key === `${bsSpot.x},${bsSpot.y}`)?.queue.length ?? 0) === 0,
    `(A) and stops there: ${JSON.stringify(es.equipment)}`);
  info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  result(info?.forge?.auto?.on === true && info.forge.auto.target === 3 && /at target/.test(info.forge.auto.status), `(A) info: ${JSON.stringify(info?.forge?.auto)}`);
  c.send({ type: "setForgeAuto", tileX: bsSpot.x, tileY: bsSpot.y, on: true, target: 0 });
  info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  result(info?.forge?.auto?.target === 3, `(A) a target of 0 is refused (still ${info?.forge?.auto?.target})`);
  // Reserve: 25 iron: armour (25 -> 22), weapon (22 -> 20), then nothing (any more would dip under 20).
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  // tools at the 30 cap: the smith's own tools crafting (1 iron + 1 wood each) idles and spends no iron.
  await c.hookCall("setStock", { stock: { iron: 25, wood: 1000, tools: 30 } });
  await c.hookCall("fastForward", { ticks: 400 });
  es = await c.hookCall("equipState");
  info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  result(es.stock.iron === 20 && es.equipment.armour[0] === 1 && es.equipment.weapon[0] === 1 && /reserve/.test(info?.forge?.auto?.status ?? ""),
    `(A) stops at the iron reserve: iron ${es.stock.iron}, ${JSON.stringify(es.equipment)}, status "${info?.forge?.auto?.status}"`);
  // Save / load keeps the toggle.
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  c.send({ type: "setForgeAuto", tileX: bsSpot.x, tileY: bsSpot.y, on: false });
  info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  const offBeforeLoad = info?.forge?.auto?.on === false;
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  info = await c.buildingInfo(bsSpot.x, bsSpot.y);
  result(c.saves[0]?.ok && offBeforeLoad && info?.forge?.auto?.on === true && info.forge.auto.target === 3, `(A) save / load keeps autocraft on, target ${info?.forge?.auto?.target}`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
