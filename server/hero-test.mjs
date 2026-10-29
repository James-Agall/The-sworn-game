// Scripted test: Hero phase 3 (ROADMAP "Hero phase 3: heroes").
// Self-contained: boots its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 21910) and a
// temp COLONY_SAVE_DIR, kills its process group after. Run from server/: `node hero-test.mjs`.
//   P a full settlement refuses a recruit; a Keep Lv1 recruits 1 hero (cost paid, +2 population), refuses the 2nd.
//   C at Keep Lv3: champion / marksman / mage spawn with their class stats and roles.
//   E a relic equipped on a hero via heroId changes its damage / max HP / damage taken; unequip returns it.
//   X a hero's killing blows give it XP and levels apply (+4% damage, +6% HP); a real fight credits it;
//     a relic from a hero's kill lands in the player's pack.
//   R a dead hero waits for a dawn / dusk window and pays 50 + 25 x level gold (waits without gold).
//   S save / load keeps hero name / class / level / equipment.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21910);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, HunterHut: 50, Keep: 73 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "herotest-"));
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
  const c = { ws: null, welcome: null, snap: null, profile: null, heroes: null, events: [], hook: new Map(), saves: [], info: null };
  c.ws = new WebSocket(`ws://localhost:${PORT}/?profile=hero-tester`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.profile) c.profile = m.profile;
      if (m.heroes) c.heroes = m.heroes;
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
    else if (m.type === "buildingInfo") c.info = m.info;
    else if (m.type === "tileUpdate" && c.welcome) c.welcome.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
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
  return c;
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

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
  await c.hookCall("ignorePlayers", { value: true });
  await c.hookCall("setInstantBuild", { enabled: true });
  await c.hookCall("setStock", { stock: { gold: 2000, iron: 500, wood: 500, rock: 500, tools: 100, grain: 2000 } });
  const W = c.welcome.worldTilesX;
  const tileAt = (x, y) => c.welcome.tiles[y * W + x];
  const tc = { x: c.snap.townCenters[0].x, y: c.snap.townCenters[0].y };
  // A Keep on an empty tile with an empty ring around it, 3-6 tiles from the Town Center.
  let keep = null;
  for (let r = 3; r <= 7 && !keep; r++)
    for (let dy = -r; dy <= r && !keep; dy++)
      for (let dx = -r; dx <= r && !keep; dx++) {
        const x = tc.x + dx, y = tc.y + dy;
        let ok = true;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (tileAt(x + ox, y + oy) !== T.Empty) ok = false;
        if (ok) keep = { x, y };
      }
  await c.hookCall("setTileRaw", { tx: keep.x, ty: keep.y, tile: T.Keep });
  const hs = () => c.hookCall("heroUnitState");
  const info = async () => {
    c.info = null;
    c.send({ type: "buildingInfo", tileX: keep.x, tileY: keep.y });
    for (let i = 0; i < 300 && !c.info; i++) await sleep(10);
    return c.info;
  };
  const recruit = async (cls) => {
    const before = c.events.length;
    c.send({ type: "recruitHero", tx: keep.x, ty: keep.y, class: cls });
    await c.freshSnap();
    await c.freshSnap();
    await c.freshSnap();
    return c.events.slice(before);
  };
  const pop = () => c.snap.townCenters[0];

  // ---- P: population / Keep level gates ----
  let snap = await c.freshSnap();
  const free = pop().populationCap - pop().population;
  const spots = [];
  for (let y = tc.y - 14; y <= tc.y + 14; y++)
    for (let x = tc.x - 14; x <= tc.x + 14; x++) {
      if (Math.hypot(x - tc.x, y - tc.y) < 8 || tileAt(x, y) !== T.Empty) continue;
      spots.push({ x, y });
    }
  // Fillers are Hunter's Huts (1 civilian hunter each): soldiers no longer use settlement population
  // (ROADMAP "Pop cap rework"). Spots 2 tiles apart so no hut touches another.
  const fillers = [];
  for (const s of spots) {
    if (fillers.length >= free - 1) break;
    if (s.x % 2 || s.y % 2) continue;
    await c.hookCall("teleportPlayer", { x: (s.x + 1) * TILE + 16, y: s.y * TILE + 16 });
    await c.freshSnap();
    c.send({ type: "setTile", tileX: s.x, tileY: s.y, tile: T.HunterHut });
    await c.freshSnap();
    await c.freshSnap();
    if (tileAt(s.x, s.y) === T.HunterHut) fillers.push(s);
  }
  snap = await c.freshSnap();
  console.log(`settlement 1: ${pop().population}/${pop().populationCap} (Keep +${pop().populationKeepBonus}), ${fillers.length} fillers`);
  let ev = await recruit("champion");
  let st = await hs();
  result(st.heroes.length === 0 && ev.some((t) => /Can't recruit: Settlement 1 full/.test(t)), `full settlement refuses a recruit: "${ev.find((t) => /recruit/.test(t))}"`);
  // Demolish the filler huts (killing the hunters would only queue their respawns).
  for (const f of fillers) {
    await c.hookCall("teleportPlayer", { x: (f.x + 1) * TILE + 16, y: f.y * TILE + 16 });
    await c.freshSnap();
    c.send({ type: "setTile", tileX: f.x, tileY: f.y, tile: T.Empty });
    await c.freshSnap();
  }
  await c.hookCall("fastForward", { ticks: 2 });
  snap = await c.freshSnap();
  const pop0 = pop().population;
  const gold0 = snap.gold, iron0 = snap.iron;
  ev = await recruit("champion");
  st = await hs();
  snap = c.snap;
  const champ = st.units[0];
  result(st.units.length === 1 && champ?.heroClass === "champion" && gold0 - snap.gold === 120 && iron0 - snap.iron === 20,
    `Keep Lv1 recruits a champion "${champ?.name}" (gold -${gold0 - snap.gold}, iron -${iron0 - snap.iron})`);
  result(pop().population === pop0 + 2, `the hero costs 2 population (${pop0} -> ${pop().population})`);
  const g1 = snap.gold;
  ev = await recruit("marksman");
  st = await hs();
  result(st.units.length === 1 && c.snap.gold === g1 && ev.some((t) => /Keep Lv 1 holds 1 hero/.test(t)), `a 2nd hero at Keep Lv1 refused: "${ev.find((t) => /recruit/.test(t))}"`);
  let ki = await info();
  result(ki?.heroes?.count === 1 && ki.heroes.cap === 1 && ki.heroes.options.every((o) => !o.enabled) && ki.heroes.roster[0]?.name === champ.name,
    `Keep panel: heroes ${ki?.heroes?.count}/${ki?.heroes?.cap}, buttons disabled, roster ${JSON.stringify(ki?.heroes?.roster)}`);

  // ---- C: class stats and roles at Keep Lv3 ----
  for (let i = 0; i < 2; i++) {
    c.send({ type: "upgradeBuilding", tileX: keep.x, tileY: keep.y });
    await c.hookCall("fastForward", { ticks: 3 });
    await c.freshSnap();
  }
  ki = await info();
  result(ki?.level === 3 && ki.heroes.cap === 3, `Keep upgraded to Lv ${ki?.level}: cap ${ki?.heroes?.cap}`);
  await recruit("marksman");
  await recruit("mage");
  st = await hs();
  const by = (cls) => st.units.find((u) => u.heroClass === cls);
  const [ch, mk, mg] = [by("champion"), by("marksman"), by("mage")];
  result(ch && ch.maxHp === 160 && near(ch.stats.damage, 26) && ch.stats.speed === 110 && ch.stats.melee && ch.role === "shock",
    `champion: HP ${ch?.maxHp}, dmg ${ch?.stats.damage}, speed ${ch?.stats.speed}, range ${ch?.stats.range}, role ${ch?.role}`);
  result(mk && mk.maxHp === 90 && near(mk.stats.damage, 16) && mk.stats.speed === 100 && mk.stats.range === 5 * TILE && !mk.stats.melee && mk.role === "ranged",
    `marksman: HP ${mk?.maxHp}, dmg ${mk?.stats.damage}, speed ${mk?.stats.speed}, range ${mk?.stats.range / TILE} tiles, role ${mk?.role}`);
  result(mg && mg.maxHp === 80 && near(mg.stats.damage, 14) && mg.stats.speed === 95 && mg.stats.range === 7 * TILE && !mg.stats.melee && mg.role === "caster",
    `mage: HP ${mg?.maxHp}, dmg ${mg?.stats.damage}, speed ${mg?.stats.speed}, range ${mg?.stats.range / TILE} tiles, role ${mg?.role}`);
  const names = new Set(st.units.map((u) => u.name));
  const cs = c.snap.colonists.find((x) => x.id === ch.id);
  result(names.size === 3 && cs?.kind === "hero" && cs.heroName === ch.name && cs.heroClass === "champion" && cs.heroLevel === 1 && c.heroes?.length === 3,
    `3 unique names ${[...names].join(", ")}; snapshot colonist + heroes tabs (${c.heroes?.length})`);

  // ---- E: equip on a hero via heroId ----
  const blade = (await c.hookCall("grantRelic", { relicId: "swornOathblade" })).item;
  const hide = (await c.hookCall("grantRelic", { relicId: "gorrathHide" })).item;
  c.send({ type: "equipItem", itemId: blade.id, slot: "weapon", heroId: ch.id });
  c.send({ type: "equipItem", itemId: hide.id, slot: "chest", heroId: ch.id });
  await c.freshSnap();
  await c.freshSnap();
  st = await hs();
  let chu = st.units.find((u) => u.id === ch.id);
  let chs = st.heroes.find((h) => h.id === ch.id);
  result(near(chu.stats.damage, 26 * 1.6) && chu.maxHp === 190 && chs.profile.equipment.weapon?.id === blade.id && !c.profile.inventory.some((i) => i.id === blade.id || i.id === hide.id),
    `relics on the champion: damage ${chu.stats.damage.toFixed(1)} (26 x1.6), max HP ${chu.maxHp} (160 + 30), gone from the player's pack`);
  const dmg = await c.hookCall("damageColonist", { id: ch.id, amount: 10 });
  result(near(dmg.before - dmg.after, 6), `10 damage taken as ${(dmg.before - dmg.after).toFixed(2)} (x0.6)`);
  c.send({ type: "unequipItem", slot: "weapon", heroId: ch.id });
  await c.freshSnap();
  await c.freshSnap();
  st = await hs();
  chu = st.units.find((u) => u.id === ch.id);
  result(near(chu.stats.damage, 26) && c.profile.inventory.some((i) => i.id === blade.id), `unequip via heroId: damage ${chu.stats.damage}, blade back in the player's pack`);

  // ---- X: XP and levels ----
  const spot = spots[spots.length - 1];
  for (let i = 0; i < 4; i++) {
    const g = await c.hookCall("spawnMob", { kind: "goblin", tx: spot.x, ty: spot.y });
    await c.hookCall("damageMob", { mobId: g.id, amount: 1e7, byColonist: ch.id });
  }
  st = await hs();
  chs = st.heroes.find((h) => h.id === ch.id);
  chu = st.units.find((u) => u.id === ch.id);
  result(chs.profile.xp === 40 && chs.profile.level === 2, `4 kills by the champion: xp ${chs.profile.xp}, level ${chs.profile.level}`);
  result(near(chu.stats.damage, 26 * 1.04) && chu.maxHp === 160 + 30 + 10, `level 2: damage ${chu.stats.damage.toFixed(2)} (x1.04), max HP ${chu.maxHp} (160 + 30 + 6% of 160)`);
  result(c.events.some((t) => t.startsWith(`${ch.name} reaches level 2`)), `level-up toast for ${ch.name}`);
  const relicCount = () => c.profile.inventory.filter((i) => i.tier === "relic").length;
  const r0 = relicCount();
  await c.hookCall("heroConfig", { relicChance: 1 });
  const orc = await c.hookCall("spawnMob", { kind: "armoredOrc", tx: spot.x, ty: spot.y });
  await c.hookCall("damageMob", { mobId: orc.id, amount: 1e7, byColonist: ch.id });
  await c.hookCall("heroConfig", {});
  await c.freshSnap();
  await c.freshSnap();
  st = await hs();
  result(relicCount() === r0 + 1 && st.heroes.find((h) => h.id === ch.id).profile.xp === 50, `a hero's armoured-orc kill: relic into the player's pack (${r0} -> ${relicCount()}), +10 hero XP`);
  // A real fight: a goblin next to the marksman; its arrows kill it and the XP is its own.
  const mkx = Math.floor(mk.x / TILE), mky = Math.floor(mk.y / TILE);
  const g = await c.hookCall("spawnMob", { kind: "goblin", tx: mkx + 2, ty: mky });
  await c.hookCall("fastForward", { ticks: 200 });
  st = await hs();
  // All three heroes stand together, so whoever lands the killing blow (melee or arrow / bolt) gets the 10 XP.
  const xpOf = (h) => h.profile.xp - (h.id === ch.id ? 50 : 0);
  const gained = st.heroes.map((h) => `${h.name} ${xpOf(h)}`).join(", ");
  const hits = st.events.filter((e) => e.type === "hit" && e.key === `hero:${mk.id}`);
  result(st.heroes.reduce((n, h) => n + xpOf(h), 0) === 10 && hits.length > 0 && near(hits[0].amount, 16),
    `a real fight next to the heroes: marksman arrows of ${hits[0]?.amount}, kill XP to the killer (${gained}; goblin ${g.id ? "spawned" : "missing"})`);

  // ---- R: death, window respawn, fee ----
  const rs = await c.hookCall("respawnState");
  const dusk = rs.duskTick;
  await c.hookCall("setCycleTick", { tick: 100 });
  const lvl = st.heroes.find((h) => h.id === ch.id).profile.level;
  const fee = 50 + 25 * lvl;
  await c.hookCall("damageColonist", { id: ch.id, amount: 1e6 });
  st = await hs();
  result(!st.units.some((u) => u.id === ch.id) && st.queue.some((q) => q.hero?.id === ch.id) && st.heroes.find((h) => h.id === ch.id)?.status === "fallen",
    `the champion falls: queued for a window, tab status fallen, fee ${st.heroes.find((h) => h.id === ch.id)?.respawnFee}`);
  await c.hookCall("fastForward", { ticks: 300 });
  st = await hs();
  result(!st.units.some((u) => u.id === ch.id), `still waiting mid-day (no respawn outside a window)`);
  await c.hookCall("setStock", { stock: { gold: fee - 1 } });
  await c.hookCall("setCycleTick", { tick: dusk - 3 });
  await c.hookCall("fastForward", { ticks: 6 });
  st = await hs();
  result(!st.units.some((u) => u.id === ch.id) && st.gold === fee - 1 && st.events.some((e) => e.type === "respawnWait"), `dusk window without ${fee} gold: waits (gold ${st.gold})`);
  await c.hookCall("setStock", { stock: { gold: 1000 } });
  await c.hookCall("setCycleTick", { tick: rs.constants.GAME_DAY_TICKS - 3 });
  await c.hookCall("fastForward", { ticks: 6 });
  st = await hs();
  chu = st.units.find((u) => u.id === ch.id);
  chs = st.heroes.find((h) => h.id === ch.id);
  result(chu && st.gold === 1000 - fee && chu.name === ch.name && chs.profile.level === lvl && chs.profile.equipment.chest?.id === hide.id && chu.hp === chu.maxHp,
    `dawn window: back with the same id / name, level ${chs?.profile.level}, Hide kept, paid ${1000 - st.gold} (= 50 + 25 x ${lvl})`);

  // ---- S: save / load ----
  const before = JSON.stringify(st.heroes.map((h) => [h.id, h.name, h.heroClass, h.profile.level, h.profile.xp, h.profile.equipment]));
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  c.send({ type: "unequipItem", slot: "chest", heroId: ch.id });
  await c.freshSnap();
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(400);
  st = await hs();
  const after = JSON.stringify(st.heroes.map((h) => [h.id, h.name, h.heroClass, h.profile.level, h.profile.xp, h.profile.equipment]));
  result(c.saves[0]?.ok && c.saves[1]?.ok && after === before && st.units.length === 3 && st.units.find((u) => u.id === ch.id)?.maxHp === 200,
    `save/load keeps 3 heroes' name / class / level / xp / equipment (champion max HP ${st.units.find((u) => u.id === ch.id)?.maxHp})`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
