// Scripted test: per-settlement population caps. Self-contained: boots its OWN 160x160 server with
// COLONY_TEST_HOOKS=1 on PORT (default 21620) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node settlement-pop-test.mjs`.
//   two Town Centers; fill settlement 1 -> next worker post refused with "Settlement 1 full (n/cap)",
//   settlement 2 still accepts; upgrading TC 1 raises its cap and the refused placement now works;
//   per-settlement counts add up to the total; save/load keeps the assignments.
//   tier caps 20/30/40; the Keep (separate building): refused at Town Center level 1, allowed at 2,
//   levels 1..3 add +10/+20/+30 to the settlement cap, demolishing removes it, save/load keeps it.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21620);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, TownCenter: 12, HunterHut: 50, Keep: 73 };
const POI = new Set([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]);
const TILE = 32;
const REACH = TILE * 2.5;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "settlement-pop-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "160", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
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
  const c = { ws: null, welcome: null, snap: null, tiles: [], events: [], hook: new Map(), saves: [] };
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
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.W = () => c.welcome.worldTilesX;
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 400 && !c.hook.has(op); i++) await sleep(10);
    return c.hook.get(op);
  };
  c.freshSnap = async () => {
    const before = c.snap;
    while (c.snap === before) await sleep(10);
    return c.snap;
  };
  return c;
}

function freeTilesNear(c) {
  const me = c.me();
  const occupied = new Set();
  for (const e of [...c.snap.colonists, ...c.snap.players]) occupied.add(Math.floor(e.y / TILE) * c.W() + Math.floor(e.x / TILE));
  const out = [];
  const mx = Math.floor(me.x / TILE);
  const my = Math.floor(me.y / TILE);
  for (let y = my - 2; y <= my + 2; y++)
    for (let x = mx - 2; x <= mx + 2; x++) {
      if (Math.hypot(x * TILE + 16 - me.x, y * TILE + 16 - me.y) > REACH) continue;
      if (c.tileAt(x, y) !== T.Empty || occupied.has(y * c.W() + x)) continue;
      out.push({ x, y });
    }
  return out;
}

function townCenterSpots(c, tcs) {
  const W = c.W();
  const spots = [];
  for (let y = 4; y < W - 4; y++)
    for (let x = 4; x < W - 4; x++) {
      if (c.tileAt(x, y) !== T.Empty || c.tileAt(x + 1, y) !== T.Empty) continue;
      if (tcs.some((tc) => Math.hypot(tc.x - x, tc.y - y) < 26)) continue; // TOWN_CENTER_MIN_SPACING_TILES 24
      // Keep the second settlement fairly near the first so it is reachable and its nearest-TC area is its own.
      if (Math.hypot(tcs[0].x - x, tcs[0].y - y) > 40) continue;
      let poi = false;
      for (let dy = -7; dy <= 7 && !poi; dy++) for (let dx = -7; dx <= 7; dx++) if (POI.has(c.tileAt(x + dx, y + dy))) poi = true;
      if (!poi) spots.push({ x, y });
    }
  return spots;
}

const tele = (c, tx, ty) => c.hookCall("teleportPlayer", { x: tx * TILE + 16, y: ty * TILE + 16 });
// Tries a hut on free tiles next to (tx, ty); returns "placed" | "refused" (event text) | "none".
async function tryHut(c, tx, ty) {
  await tele(c, tx + 3, ty + 3);
  await c.freshSnap();
  const spot = freeTilesNear(c).find((s) => Math.hypot(s.x - tx, s.y - ty) < 8);
  if (!spot) return { r: "none" };
  const before = c.events.length;
  c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.HunterHut });
  await c.freshSnap();
  await c.freshSnap();
  if (c.tileAt(spot.x, spot.y) === T.HunterHut) return { r: "placed" };
  return { r: "refused", text: c.events.slice(before).find((t) => /^Settlement/.test(t)) ?? "" };
}

try {
  let c;
  for (let i = 0; i < 100; i++) {
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
  await c.hookCall("setStock", { stock: { wood: 5000, rock: 5000, iron: 5000, tools: 500, grain: 2000, gold: 500 } });
  let snap = await c.freshSnap();
  const tc1 = { x: snap.townCenters[0].x, y: snap.townCenters[0].y };

  // Second Town Center.
  let tc2 = null;
  for (const spot of townCenterSpots(c, [tc1]).slice(0, 40)) {
    await tele(c, spot.x + 1, spot.y);
    c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.TownCenter });
    await c.freshSnap();
    await c.freshSnap();
    if (c.tileAt(spot.x, spot.y) === T.TownCenter) {
      tc2 = spot;
      break;
    }
  }
  snap = await c.freshSnap();
  result(tc2 !== null && snap.townCenters.length === 2, `second Town Center placed at ${JSON.stringify(tc2)}`);

  const state = () => c.snap.townCenters.map((t) => ({ pop: t.population, cap: t.populationCap, tier: t.populationTierCap }));
  console.log("initial", JSON.stringify(state()));
  result(state()[0].tier === 20 && state()[1].tier === 20, "both Town Centers report tier cap 20 at level 1");

  // Fill settlement 1 until a post is refused.
  let refused = null;
  for (let i = 0; i < 25 && !refused; i++) {
    const r = await tryHut(c, tc1.x, tc1.y);
    if (r.r === "refused") refused = r;
    else if (r.r === "none") await tele(c, tc1.x + (i % 2 ? 4 : -4), tc1.y + (i % 3) * 2 - 2);
  }
  snap = await c.freshSnap();
  const s1 = state()[0];
  result(refused && /^Settlement 1 full \(\d+\/\d+\)/.test(refused.text), `settlement 1 refused a worker post: "${refused?.text}"`);
  result(s1.pop === s1.cap, `settlement 1 is exactly at its cap (${s1.pop}/${s1.cap})`);

  // Settlement 2 still accepts.
  const before2 = state()[1].pop;
  const r2 = await tryHut(c, tc2.x, tc2.y);
  await c.freshSnap();
  result(r2.r === "placed" && state()[1].pop === before2 + 1, `settlement 2 still accepts a post (${before2} -> ${state()[1].pop})`);
  result(state()[0].pop === s1.pop, "settlement 1 count unchanged by settlement 2's hut");

  // Counts add up to the total.
  const sum = c.snap.townCenters.reduce((n, t) => n + t.population, 0);
  result(sum === c.snap.population, `per-settlement counts ${state().map((s) => s.pop).join("+")} = ${sum} equal total ${c.snap.population}`);

  // Upgrade TC 1: cap rises, refused placement now works.
  await tele(c, tc1.x + 1, tc1.y);
  c.send({ type: "setTile", tileX: tc1.x, tileY: tc1.y, tile: T.TownCenter });
  await c.freshSnap();
  await c.freshSnap();
  const up = state()[0];
  result(c.snap.townCenters[0].level === 2 && up.cap > s1.cap && up.tier === 30, `upgrading TC 1 raised its cap ${s1.cap} -> ${up.cap} (tier ceiling ${up.tier})`);
  const again = await tryHut(c, tc1.x, tc1.y);
  result(again.r === "placed", `the previously refused post now succeeds (${again.r})`);

  // Tier 3 ceiling is 40.
  await tele(c, tc1.x + 1, tc1.y);
  c.send({ type: "setTile", tileX: tc1.x, tileY: tc1.y, tile: T.TownCenter });
  await c.freshSnap();
  await c.freshSnap();
  result(c.snap.townCenters[0].level === 3 && state()[0].tier === 40, `Town Center 1 at level 3 has tier ceiling ${state()[0].tier}`);

  // Keep: refused at Town Center level 1 (settlement 2), allowed at level 2 (settlement 1 here is level 3).
  const keepAt = async (tc) => {
    await tele(c, tc.x + 3, tc.y + 3);
    await c.freshSnap();
    const spot = freeTilesNear(c).find((s) => Math.hypot(s.x - tc.x, s.y - tc.y) < 8);
    if (!spot) return null;
    const before = c.events.length;
    c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.Keep });
    await c.freshSnap();
    await c.freshSnap();
    return { spot, placed: c.tileAt(spot.x, spot.y) === T.Keep, text: c.events.slice(before).join("|") };
  };
  const k0 = await keepAt(tc2);
  result(k0 && !k0.placed && /Keep needs a Town Center at level 2/.test(k0.text), `Keep refused at Town Center level 1: "${k0?.text}"`);
  // Settlement 2 to level 2, then the Keep goes up.
  await tele(c, tc2.x + 1, tc2.y);
  c.send({ type: "setTile", tileX: tc2.x, tileY: tc2.y, tile: T.TownCenter });
  await c.freshSnap();
  await c.freshSnap();
  const base2 = state()[1];
  result(c.snap.townCenters[1].level === 2 && base2.tier === 30, `Town Center 2 at level 2 (tier ${base2.tier})`);
  const k1 = await keepAt(tc2);
  await c.freshSnap();
  result(k1 && k1.placed, "Keep allowed at Town Center level 2");
  const keepSpot = k1.spot;
  const lvl = (x, y) => {
    const arr = c.snap.buildingLevels ?? [];
    for (let i = 0; i + 1 < arr.length; i += 2) if (arr[i] === y * c.W() + x) return arr[i + 1];
    return 1;
  };
  const capNow = () => state()[1].cap;
  result(capNow() === base2.cap + 10 && c.snap.townCenters[1].populationKeepBonus === 10, `Keep Lv1 cap ${base2.cap} -> ${capNow()} (+10)`);
  // A second Keep in the same settlement is refused.
  const k2 = await keepAt(tc2);
  result(k2 && !k2.placed && /already has a Keep/.test(k2.text), `second Keep refused: "${k2?.text}"`);
  // Levels 2 and 3 through the upgrade flow.
  for (const n of [2, 3]) {
    await tele(c, keepSpot.x + 1, keepSpot.y);
    c.send({ type: "upgradeBuilding", tileX: keepSpot.x, tileY: keepSpot.y });
    await c.freshSnap();
    await c.freshSnap();
    result(capNow() === base2.cap + 10 * n && lvl(keepSpot.x, keepSpot.y) === n, `Keep Lv${n} cap ${capNow()} (+${capNow() - base2.cap}), level ${lvl(keepSpot.x, keepSpot.y)}`);
  }

  // Save / load round trip keeps assignments (and the Keep).
  const snapState = JSON.stringify(state());
  c.send({ type: "pause" });
  await sleep(300);
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  result(c.saves[0]?.ok === true, "saveGame ok");
  await c.hookCall("killColonists", { kind: "hunter" });
  await c.freshSnap();
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  await c.freshSnap();
  result(c.saves[1]?.ok === true && JSON.stringify(state()) === snapState, `load restored per-settlement counts ${snapState} -> ${JSON.stringify(state())}`);
  result(c.tileAt(keepSpot.x, keepSpot.y) === T.Keep && lvl(keepSpot.x, keepSpot.y) === 3 && capNow() === base2.cap + 30, `load kept the Keep at level 3 (cap ${capNow()})`);

  // Demolishing the Keep removes its bonus.
  await tele(c, keepSpot.x + 1, keepSpot.y);
  c.send({ type: "setTile", tileX: keepSpot.x, tileY: keepSpot.y, tile: T.Empty });
  await c.freshSnap();
  await c.freshSnap();
  result(c.tileAt(keepSpot.x, keepSpot.y) === T.Empty && capNow() === base2.cap, `demolishing the Keep removed its bonus (cap ${capNow()})`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
