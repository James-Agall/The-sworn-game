// Scripted test: Armour & weapons (ROADMAP "Armour & weapons — landed 2026-10-28").
// Self-contained: boots its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 21710) and a
// temp COLONY_SAVE_DIR, kills its process group after. Run from server/: `node equipment-test.mjs`.
//   F a staffed Blacksmith Lv1 forges tier-1 armour (3 iron) and a weapon (2 iron + 1 wood); at Lv2 tier-2
//     armour (5 iron + 1 tool, or + 1 wood without tools) and a weapon (4 iron + 1 wood).
//   E a knight spawned with stock takes the highest tier of each slot (stock decremented, tiers recorded);
//     with an empty stock it spawns unequipped (tier 0) and a toast says so.
//   D a weapon-T3 knight deals x1.7 its base blow; an armour-T3 knight takes x0.55 of a hit.
//   L an armoured mob kill drops one tier-1 piece (drop chance forced to 1); a goblin drops nothing; a
//     Hunger-marked goblin always drops; a destroyed hearth pays 1 + floor(garrison / 2) tiered pieces.
//   S save/load keeps the stock and every unit's tiers.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21710);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Blacksmith: 26 };
const TILE = 32;
const REACH = TILE * 2.5;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "equipment-"));
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
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.hookCall = async (op, args = {}) => {
    c.hook.delete(op);
    c.send({ type: "testHook", op, ...args });
    for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
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

const sum = (eq) => eq.armour.reduce((a, b) => a + b, 0) + eq.weapon.reduce((a, b) => a + b, 0);
const near = (a, b) => Math.abs(a - b) < 1e-6;

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
  await c.hookCall("ignorePlayers", { value: true });
  await c.hookCall("setStock", { stock: { wood: 1000, rock: 1000, iron: 1000, tools: 0, grain: 2000, gold: 500 } });
  let snap = await c.freshSnap();
  const tc = { x: snap.townCenters[0].x, y: snap.townCenters[0].y };
  result(snap.equipment && sum(snap.equipment) === 0, `snapshot equipment starts empty ${JSON.stringify(snap.equipment)}`);

  // ---- F: forge at Lv1 / Lv2 ----
  let bs = null;
  for (let i = 0; i < 20 && !bs; i++) {
    const ang = i * 1.1;
    await c.hookCall("teleportPlayer", { x: (tc.x + Math.round(Math.cos(ang) * 4)) * TILE + 16, y: (tc.y + Math.round(Math.sin(ang) * 4)) * TILE + 16 });
    await c.freshSnap();
    const me = c.me();
    const mx = Math.floor(me.x / TILE);
    const my = Math.floor(me.y / TILE);
    for (let y = my - 2; y <= my + 2 && !bs; y++)
      for (let x = mx - 2; x <= mx + 2 && !bs; x++) {
        if (Math.hypot(x * TILE + 16 - me.x, y * TILE + 16 - me.y) > REACH || (x === mx && y === my)) continue;
        if (c.tileAt(x, y) !== T.Empty) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.tileAt(x + dx, y + dy) !== T.Empty)) continue;
        c.send({ type: "setTile", tileX: x, tileY: y, tile: T.Blacksmith });
        await c.freshSnap();
        await c.freshSnap();
        if (c.tileAt(x, y) === T.Blacksmith) bs = { x, y };
      }
  }
  result(!!bs, `Blacksmith placed at ${JSON.stringify(bs)}`);
  await c.hookCall("fastForward", { ticks: 5 });
  let info = await c.buildingInfo(bs.x, bs.y);
  result(info?.forge?.tier === 1 && info.forge.options.every((o) => o.enabled), `Lv1 forge info ${JSON.stringify(info?.forge)}`);

  const forge = async (slot) => {
    const before = (await c.hookCall("equipState")).stock;
    c.send({ type: "queueForge", tileX: bs.x, tileY: bs.y, slot });
    await c.freshSnap();
    await c.hookCall("fastForward", { ticks: 3 });
    const after = await c.hookCall("equipState");
    const d = (k) => before[k] - after.stock[k];
    return { iron: d("iron"), wood: d("wood"), tools: d("tools"), eq: after.equipment };
  };
  let r = await forge("armour");
  result(r.iron === 3 && r.wood === 0 && r.eq.armour[0] === 1, `Lv1 armour: -${r.iron} iron -${r.wood} wood, stock ${JSON.stringify(r.eq)}`);
  r = await forge("weapon");
  result(r.iron === 2 && r.wood === 1 && r.eq.weapon[0] === 1, `Lv1 weapon: -${r.iron} iron -${r.wood} wood, stock ${JSON.stringify(r.eq)}`);

  c.send({ type: "upgradeBuilding", tileX: bs.x, tileY: bs.y });
  await c.freshSnap();
  await c.hookCall("fastForward", { ticks: 10 });
  info = await c.buildingInfo(bs.x, bs.y);
  result(info?.level === 2 && info.forge?.tier === 2, `Blacksmith upgraded: level ${info?.level}, forge tier ${info?.forge?.tier}`);
  await c.hookCall("setStock", { stock: { tools: 0 } });
  r = await forge("armour");
  result(r.iron === 5 && r.wood === 1 && r.tools === 0 && r.eq.armour[1] === 1, `Lv2 armour, no tools: -${r.iron} iron -${r.wood} wood -${r.tools} tools`);
  await c.hookCall("setStock", { stock: { tools: 5 } });
  r = await forge("armour");
  result(r.iron === 5 && r.wood === 0 && r.tools === 1 && r.eq.armour[1] === 2, `Lv2 armour with tools: -${r.iron} iron -${r.tools} tool`);
  r = await forge("weapon");
  result(r.iron === 4 && r.wood === 1 && r.eq.weapon[1] === 1, `Lv2 weapon: -${r.iron} iron -${r.wood} wood, stock ${JSON.stringify(r.eq)}`);
  // Queue cap 5 without instant progress: no smith ticks happen between sends.
  await c.hookCall("setStock", { stock: { iron: 1000 } });
  for (let i = 0; i < 7; i++) c.send({ type: "queueForge", tileX: bs.x, tileY: bs.y, slot: "weapon" });
  await sleep(30);
  let es = await c.hookCall("equipState");
  const q = es.forges.find((f) => f.key === `${bs.x},${bs.y}`)?.queue.length ?? 0;
  result(q <= 5, `queue capped at 5 (saw ${q})`);
  await c.hookCall("fastForward", { ticks: 20 });
  es = await c.hookCall("equipState");
  await c.hookCall("setEquipment", { armour: [1, 2, 0], weapon: [1, 1, 0] });

  // ---- E: spawning takes the best tier ----
  const spot = { x: (tc.x + 10) * TILE + 16, y: tc.y * TILE + 16 };
  const k1 = (await c.hookCall("spawnSoldier", { kind: "knight", x: spot.x, y: spot.y })).id;
  es = await c.hookCall("equipState");
  let u = es.units.find((x) => x.id === k1);
  result(
    u?.armourTier === 2 && u.weaponTier === 2 && es.equipment.armour.join() === "1,1,0" && es.equipment.weapon.join() === "1,0,0",
    `knight takes armour T${u?.armourTier} weapon T${u?.weaponTier}; stock left ${JSON.stringify(es.equipment)}`
  );
  snap = await c.freshSnap();
  const ks = snap.colonists.find((x) => x.id === k1);
  result(ks?.armourTier === 2 && ks?.weaponTier === 2, `snapshot carries armourTier/weaponTier ${ks?.armourTier}/${ks?.weaponTier}`);
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  const ev0 = c.events.length;
  const k2 = (await c.hookCall("spawnSoldier", { kind: "knight", x: spot.x + TILE, y: spot.y })).id;
  await c.freshSnap();
  es = await c.hookCall("equipState");
  u = es.units.find((x) => x.id === k2);
  result(u?.armourTier === 0 && u.weaponTier === 0 && es.events.some((e) => e.type === "unequipped" && e.id === k2), `empty stock: knight spawns unequipped (${u?.armourTier}/${u?.weaponTier})`);
  result(c.events.slice(ev0).some((t) => /musters without/.test(t)), `unequipped toast: ${c.events.slice(ev0).find((t) => /musters/.test(t))}`);
  const a1 = (await c.hookCall("spawnSoldier", { kind: "archer", x: spot.x + 2 * TILE, y: spot.y })).id;
  es = await c.hookCall("equipState");
  result(!es.units.some((x) => x.id === a1), `archers are not equipped kinds`);

  // ---- D: damage multipliers ----
  await c.hookCall("setEquipment", { armour: [0, 0, 1], weapon: [0, 0, 1] });
  const far = { x: (tc.x - 12) * TILE + 16, y: (tc.y + 8) * TILE + 16 };
  const k3 = (await c.hookCall("spawnSoldier", { kind: "knight", x: far.x, y: far.y, stance: "aggressive" })).id;
  es = await c.hookCall("equipState");
  u = es.units.find((x) => x.id === k3);
  result(u?.armourTier === 3 && u.weaponTier === 3, `T3 knight equipped ${u?.armourTier}/${u?.weaponTier}`);
  const dummy = await c.hookCall("spawnMob", { kind: "troll", tx: Math.floor(far.x / TILE) + 1, ty: Math.floor(far.y / TILE) });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) {
    await c.hookCall("fastForward", { ticks: 10 });
    es = await c.hookCall("equipState");
    hit = es.events.find((e) => e.type === "hit" && e.id === k3);
  }
  const base = hit ? Number(hit.detail) : NaN;
  result(!!hit && base >= 12 && near(hit.amount, base * 1.7), `weapon T3 blow ${hit?.amount?.toFixed(2)} = base ${base.toFixed(2)} x1.7`);
  await c.hookCall("damageMob", { mobId: dummy.id, amount: 100000 });
  await c.hookCall("setColonistHp", { id: k3, hp: 60 });
  const dmg = await c.hookCall("damageColonist", { id: k3, amount: 20 });
  result(dmg.found && near(dmg.before - dmg.after, 11), `armour T3 takes ${dmg.before - dmg.after} of 20 (x0.55)`);
  const dmg2 = await c.hookCall("damageColonist", { id: k2, amount: 20 });
  result(near(dmg2.before - dmg2.after, 20), `unequipped knight takes the full 20 (${dmg2.before - dmg2.after})`);

  // ---- L: drops ----
  await c.hookCall("equipConfig", { dropChance: 1 });
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  const mt = { tx: tc.x - 20, ty: tc.y - 20 };
  const ev1 = c.events.length;
  const orc = await c.hookCall("spawnMob", { kind: "armoredOrc", ...mt });
  await c.hookCall("damageMob", { mobId: orc.id, amount: 100000 });
  es = await c.hookCall("equipState");
  result(es.equipment.armour[0] + es.equipment.weapon[0] === 1 && sum(es.equipment) === 1, `armoured orc kill drops one tier-1 piece ${JSON.stringify(es.equipment)}`);
  await c.freshSnap();
  result(c.events.slice(ev1).some((t) => /Salvaged a tier-1/.test(t)), `drop toast: ${c.events.slice(ev1).find((t) => /Salvaged/.test(t))}`);
  const gob = await c.hookCall("spawnMob", { kind: "goblin", ...mt });
  await c.hookCall("damageMob", { mobId: gob.id, amount: 100000 });
  es = await c.hookCall("equipState");
  result(sum(es.equipment) === 1, `goblin kill drops nothing (${sum(es.equipment)})`);
  await c.hookCall("equipConfig", { dropChance: 0 });
  const marked = await c.hookCall("spawnMob", { kind: "goblin", ...mt, mark: 1 });
  await c.hookCall("damageMob", { mobId: marked.id, amount: 1e7 });
  await c.hookCall("damageMob", { mobId: marked.id, amount: 1e7 });
  es = await c.hookCall("equipState");
  result(marked.mark !== 0 && sum(es.equipment) === 2, `Hunger-marked goblin always drops (chance 0): total ${sum(es.equipment)}`);
  await c.hookCall("equipConfig", {});

  const hs = await c.hookCall("hearthState");
  const camp = hs.hearths.find((h) => !h.destroyed);
  const beforeLoot = sum(es.equipment);
  const ev2 = c.events.length;
  await c.hookCall("damageHearth", { siteId: camp.siteId, amount: 100000 });
  es = await c.hookCall("equipState");
  const gained = sum(es.equipment) - beforeLoot;
  const want = 1 + Math.floor(Math.max(1, camp.garrison) / 2);
  const loots = es.events.filter((e) => e.type === "loot" && e.detail === "hearth");
  result(gained === want && loots.length === want && loots.every((e) => e.tier >= 1 && e.tier <= 3), `hearth (garrison ${camp.garrison}) pays ${gained}/${want} pieces, tiers ${loots.map((e) => e.tier)}`);
  await c.freshSnap();
  result(c.events.slice(ev2).some((t) => /Plundered .*\(T[123]/.test(t)), `plunder toast: ${c.events.slice(ev2).find((t) => /Plundered/.test(t))}`);

  // ---- S: save / load ----
  await c.hookCall("setEquipment", { armour: [2, 0, 1], weapon: [0, 3, 0] });
  const saved = await c.hookCall("equipState");
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  await c.hookCall("setEquipment", { armour: [0, 0, 0], weapon: [0, 0, 0] });
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  const loaded = await c.hookCall("equipState");
  const tiersOf = (s) => s.units.map((x) => `${x.id}:${x.armourTier}/${x.weaponTier}`).sort().join();
  result(
    c.saves[0]?.ok && c.saves[1]?.ok && JSON.stringify(loaded.equipment) === JSON.stringify(saved.equipment) && tiersOf(loaded) === tiersOf(saved) &&
      loaded.units.some((x) => x.id === k1 && x.armourTier === 2),
    `save/load keeps stock ${JSON.stringify(loaded.equipment)} and ${loaded.units.length} units' tiers`
  );
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
