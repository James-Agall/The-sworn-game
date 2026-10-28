// Scripted test: Hero phase 4 spells (ROADMAP "Hero phase 4: spells").
// Self-contained: boots its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 22010) and a
// temp COLONY_SAVE_DIR, kills its process group after. Run from server/: `node spells-test.mjs`.
//   L level 2 auto-learns the player's first spell (Fire Bolt) into slot 1; T a tome teaches and is consumed;
//   C the Church sells Heal / Ward for gold; S setSpellSlot validates; then every spell's effect, cooldown,
//   range, spell power, a hero's Auto Heal and save / load of learned spells and slots.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22010);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const T = { Empty: 0, ChurchPost: 20 };
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "spelltest-"));
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
  const c = { ws: null, welcome: null, snap: null, profile: null, events: [], hook: new Map(), saves: [], info: null };
  c.ws = new WebSocket(`ws://localhost:${PORT}/?profile=spell-tester`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.profile) c.profile = m.profile;
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
    else if (m.type === "buildingInfo") c.info = m.info;
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

const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

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
  await c.hookCall("setStock", { stock: { gold: 1000, grain: 2000 } });
  const W = c.welcome.worldTilesX;
  const tileAt = (x, y) => c.welcome.tiles[y * W + x];
  const tc = { x: c.snap.townCenters[0].x, y: c.snap.townCenters[0].y };
  const st = () => c.hookCall("spellState");
  const send = async (m) => {
    c.send(m);
    await c.freshSnap();
    await c.freshSnap();
  };
  const lastEvent = (s, type) => s.events.filter((e) => e.type === type).pop();
  // An open arena 14 tiles west of the Town Center.
  const arena = { tx: tc.x - 14, ty: tc.y };
  for (let dy = -4; dy <= 4; dy++) for (let dx = -10; dx <= 10; dx++) {
    if (tileAt(arena.tx + dx, arena.ty + dy) !== T.Empty) await c.hookCall("setTileRaw", { tx: arena.tx + dx, ty: arena.ty + dy, tile: T.Empty });
  }
  const px = (tx) => tx * TILE + 16;
  const stand = async (tx, ty) => c.hookCall("teleportPlayer", { x: px(tx), y: px(ty) });
  await stand(arena.tx, arena.ty);
  const mobHp = async (id) => (await c.hookCall("raidState")).mobs.find((m) => m.id === id)?.hp ?? null;
  const cast = async (slot, extra = {}) => {
    c.send({ type: "castSpell", slot, ...extra });
    await c.freshSnap();
    await c.freshSnap();
    return st();
  };
  const slotOf = (s, id) => s.player.slots.indexOf(id);
  // Every mob on the map (world-gen guardians, night Half-Latches) out of the way of the long waits.
  const killAll = async () => {
    // (Bosses / packs far away are left alone: their kills would drop tomes / relics into the pack.)
    for (const m of (await c.hookCall("raidState")).mobs) {
      if (m.maxHp > 300 || Math.hypot(m.x - px(arena.tx), m.y - px(arena.ty)) > 30 * TILE) continue;
      await c.hookCall("damageMob", { mobId: m.id, amount: 1e7 });
    }
  };
  await killAll();

  // ---- L: level 2 learns Fire Bolt ----
  for (let i = 0; i < 4; i++) {
    const g = await c.hookCall("spawnMob", { kind: "goblin", tx: tc.x - 20, ty: tc.y - 20 });
    await c.hookCall("damageMob", { mobId: g.id, amount: 1e7, byPlayer: true });
  }
  let s = await st();
  result(s.player.learned.join() === "fireBolt" && s.player.slots[0] === "fireBolt" && c.events.some((t) => t.includes("learn Fire Bolt")),
    `level 2: auto-learns Fire Bolt into slot 1 (${s.player.learned}, slots ${s.player.slots})`);

  // ---- T: tome ----
  const tome = (await c.hookCall("grantTome", { spellId: "thunder" })).item;
  await c.freshSnap();
  await c.freshSnap();
  result(tome?.slot === "tome" && c.profile.inventory.some((i) => i.id === tome.id), `Tome of Thunder in the pack (${tome?.name})`);
  await send({ type: "useTome", itemId: tome.id });
  s = await st();
  result(s.player.learned.includes("thunder") && !s.inventory.some((i) => i.id === tome.id) && s.player.slots[1] === "thunder",
    `tome read: Thunder learned (slot ${slotOf(s, "thunder") + 1}) and the tome is consumed`);

  // ---- C: Church sells Heal / Ward ----
  const church = { x: tc.x + 4, y: tc.y + 4 };
  await c.hookCall("setTileRaw", { tx: church.x, ty: church.y, tile: T.ChurchPost });
  c.info = null;
  c.send({ type: "buildingInfo", tileX: church.x, tileY: church.y });
  for (let i = 0; i < 300 && !c.info; i++) await sleep(10);
  result(c.info?.spellShop?.length === 2 && c.info.spellShop[0].gold === 80, `Church panel lists ${c.info?.spellShop?.map((o) => `${o.label} ${o.gold}`).join(", ")}`);
  const gold0 = (await st()).gold;
  await send({ type: "learnSpell", spellId: "heal", tileX: church.x, tileY: church.y });
  await send({ type: "learnSpell", spellId: "ward", tileX: church.x, tileY: church.y });
  s = await st();
  result(s.player.learned.includes("heal") && s.player.learned.includes("ward") && near(gold0 - s.gold, 200, 5),
    `Church: Heal + Ward learned, gold ${gold0} -> ${s.gold} (-200)`);
  await send({ type: "learnSpell", spellId: "fireBolt", tileX: church.x, tileY: church.y });
  result(lastEvent(await st(), "refuse")?.detail.includes("doesn't teach"), `Church refuses a non-basic spell`);

  // ---- S: setSpellSlot ----
  await send({ type: "setSpellSlot", slot: 3, spellId: "summon" });
  s = await st();
  result(s.player.slots[3] === "ward" && lastEvent(s, "refuse")?.detail.includes("isn't learned"), `unlearned spell refused for a slot (${s.player.slots})`);
  await send({ type: "setSpellSlot", slot: 7, spellId: "heal" });
  await send({ type: "setSpellSlot", slot: 3, spellId: "heal" });
  s = await st();
  result(s.player.slots[3] === "heal" && s.player.slots[2] === null, `Heal moved to slot 4 (slots ${s.player.slots}); bad slot index ignored`);
  await send({ type: "setSpellSlot", slot: 2, spellId: "ward" });

  // ---- Fire Bolt: damage + burn, cooldown, range ----
  const troll = await c.hookCall("spawnMob", { kind: "troll", tx: arena.tx + 3, ty: arena.ty });
  const hp0 = troll.hp;
  s = await cast(0, { targetId: troll.id });
  const hp1 = await mobHp(troll.id);
  result(near(hp0 - hp1, 30, 0.5), `Fire Bolt hits for 30 (${hp0} -> ${hp1})`);
  s = await cast(0, { targetId: troll.id });
  result(lastEvent(s, "refuse")?.detail.includes("cooldown"), `second immediate Fire Bolt refused: "${lastEvent(s, "refuse")?.detail}"`);
  await c.hookCall("fastForward", { ticks: 70 });
  const hp2 = await mobHp(troll.id);
  result(near(hp1 - hp2, 9, 0.5), `burn: 3/s for 3 s = 9 more (${hp1} -> ${hp2})`);
  await c.hookCall("spellConfig", { resetCooldowns: true });
  const far = await c.hookCall("spawnMob", { kind: "troll", tx: arena.tx - 10, ty: arena.ty });
  s = await cast(0, { targetId: far.id });
  result(lastEvent(s, "refuse")?.detail.includes("Out of range") && (await mobHp(far.id)) === far.hp, `Fire Bolt at 10 tiles refused (out of range 8)`);
  await c.hookCall("damageMob", { mobId: far.id, amount: 1e7 });

  // ---- spell power: the Abbey Emberstaff (+40%) ----
  const staff = (await c.hookCall("grantRelic", { relicId: "abbeyEmberstaff" })).item;
  await send({ type: "equipItem", itemId: staff.id, slot: "weapon" });
  await c.hookCall("spellConfig", { resetCooldowns: true });
  await c.freshSnap();
  const tm = c.snap.mobs.find((m) => m.id === troll.id);
  await c.hookCall("teleportPlayer", { x: tm.x - 40, y: tm.y });
  const hpA = await mobHp(troll.id);
  s = await cast(0, { targetId: troll.id });
  const hpB = await mobHp(troll.id);
  result(near(s.player.spellPowerMult, 1.4) && near(hpA - hpB, 42, 0.5), `spell power x${s.player.spellPowerMult}: Fire Bolt hits for ${hpA - hpB} (30 x1.4 = 42)`);
  await send({ type: "unequipItem", slot: "weapon" });
  await c.hookCall("damageMob", { mobId: troll.id, amount: 1e7 });

  // ---- Thunder: AoE hits 2 mobs ----
  const o1 = await c.hookCall("spawnMob", { kind: "troll", tx: arena.tx + 4, ty: arena.ty });
  const o2 = await c.hookCall("spawnMob", { kind: "troll", tx: arena.tx + 5, ty: arena.ty });
  await c.freshSnap();
  const m1 = c.snap.mobs.find((m) => m.id === o1.id);
  const m2 = c.snap.mobs.find((m) => m.id === o2.id);
  s = await cast(1, { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 });
  const t1 = await mobHp(o1.id);
  const t2 = await mobHp(o2.id);
  result(near(o1.hp - t1, 40, 0.5) && near(o2.hp - t2, 40, 0.5) && lastEvent(s, "aoe")?.amount >= 2, `Thunder hits both trolls for 40 (${o1.hp}->${t1}, ${o2.hp}->${t2})`);

  // ---- Frost: slow ----
  await c.hookCall("grantSpell", { spellId: "frost" });
  await send({ type: "setSpellSlot", slot: 1, spellId: "frost" });
  await c.freshSnap();
  const fm = c.snap.mobs.find((m) => m.id === o1.id);
  s = await cast(1, { x: fm.x, y: fm.y });
  const fs = s.statuses["m:" + o1.id];
  const speedNow = (await c.hookCall("raidState")).mobs.find((m) => m.id === o1.id);
  result(fs?.slowUntil > s.spellTick && fs.baseSpeed > 0 && near(near(await mobHp(o1.id), t1 - 15, 0.5) ? 1 : 0, 1),
    `Frost: 15 damage and a 4 s 50% slow (base speed ${fs?.baseSpeed}, slowed until tick ${fs?.slowUntil}, now ${s.spellTick}) ${speedNow ? "" : ""}`);
  await c.hookCall("fastForward", { ticks: 90 });
  s = await st();
  result(!s.statuses["m:" + o1.id]?.slowUntil, `the slow expires after 4 s`);

  // ---- Curse: +30% damage taken ----
  await c.hookCall("grantSpell", { spellId: "curse" });
  await send({ type: "setSpellSlot", slot: 0, spellId: "curse" });
  await stand(arena.tx, arena.ty);
  const o3 = await c.hookCall("spawnMob", { kind: "troll", tx: arena.tx + 3, ty: arena.ty + 1 });
  s = await cast(0, { targetId: o3.id });
  const c0 = await mobHp(o3.id);
  await c.hookCall("damageMob", { mobId: o3.id, amount: 50 });
  const c1 = await mobHp(o3.id);
  result(near(c0 - c1, 65, 0.5), `Curse: a 50 blow takes ${c0 - c1} (x1.3)`);
  await c.hookCall("damageMob", { mobId: o3.id, amount: 1e7 });
  await c.hookCall("damageMob", { mobId: o1.id, amount: 1e7 });
  await c.hookCall("damageMob", { mobId: o2.id, amount: 1e7 });

  // ---- Heal an ally, Ward absorbs ----
  const knight = await c.hookCall("spawnSoldier", { kind: "knight", x: px(arena.tx + 2), y: px(arena.ty + 1), stance: "defensive" });
  await c.hookCall("setColonistHp", { id: knight.id, hp: 10 });
  s = await cast(3, { targetId: knight.id });
  const kh = (await c.hookCall("bodyState")).colonists.find((k) => k.id === knight.id)?.hp;
  result(near(kh, 55, 0.5) && near(lastEvent(s, "cast")?.amount, 45), `Heal on a knight at 10 HP -> ${kh} (+45)`);
  s = await cast(2, {});
  const hpBefore = s.player.hp;
  await c.hookCall("damagePlayer", { amount: 50 });
  s = await st();
  result(near(s.player.hp, hpBefore, 0.01) && near(lastEvent(s, "absorb")?.amount, 50) && near(s.statuses["p:" + s.player.id]?.shield, 10),
    `Ward on self absorbs a 50 blow (hp ${hpBefore} -> ${s.player.hp}, shield left ${s.statuses["p:" + s.player.id]?.shield})`);
  await c.hookCall("damagePlayer", { amount: 30 });
  s = await st();
  result(near(s.player.hp, hpBefore - 20, 0.01), `the rest of a 30 blow gets through (hp ${s.player.hp})`);

  // ---- Rally Banner ----
  await c.hookCall("grantSpell", { spellId: "rallyBanner" });
  await send({ type: "setSpellSlot", slot: 0, spellId: "rallyBanner" });
  s = await cast(0, { x: px(arena.tx + 2), y: px(arena.ty + 1) });
  const ks = s.statuses["c:" + knight.id];
  result(ks?.buffDamage === 0.25 && ks?.buffSpeed === 0.15 && s.statuses["p:" + s.player.id]?.buffDamage === 0.25,
    `Rally Banner buffs the knight and the player (+25% damage, +15% speed)`);

  // ---- Summon ----
  await c.hookCall("grantSpell", { spellId: "summon" });
  await send({ type: "setSpellSlot", slot: 0, spellId: "summon" });
  await killAll();
  const pop0 = (await st()).population;
  s = await cast(0, { x: px(arena.tx - 2), y: px(arena.ty) });
  await c.freshSnap();
  const summonedSnap = c.snap.colonists.filter((x) => x.summoned).length;
  result(s.summons.length === 2 && s.summons.every((x) => x.alive) && s.population === pop0 && summonedSnap === 2,
    `Summon raises 2 skeleton militia (snapshot summoned ${summonedSnap}), population unchanged ${pop0} -> ${s.population}`);
  await c.hookCall("fastForward", { ticks: 41 * 20 });
  await killAll();
  await c.freshSnap();
  s = await st();
  result(s.summons.length === 0 && !c.snap.colonists.some((x) => x.summoned) && !!lastEvent(s, "expire"), `the summons crumble after 40 s (${JSON.stringify(s.summons)}, expire ${!!lastEvent(s, "expire")}, snap ${c.snap.colonists.filter((x) => x.summoned).length})`);

  // ---- Hero Auto: a mage heals a wounded ally ----
  const hero = await c.hookCall("spawnHero", { heroClass: "mage", x: px(arena.tx + 1), y: px(arena.ty - 1), stance: "defensive" });
  await c.hookCall("grantSpell", { spellId: "heal", heroId: hero.id });
  await c.hookCall("setColonistHp", { id: knight.id, hp: 2 });
  const kb = (await c.hookCall("bodyState")).colonists.find((k) => k.id === knight.id)?.hp;
  await c.hookCall("fastForward", { ticks: 20 });
  s = await st();
  const ka = (await c.hookCall("bodyState")).colonists.find((k) => k.id === knight.id)?.hp;
  const heroBook = s.heroes.find((h) => h.key === "hero:" + hero.id);
  const heroCast = s.events.find((e) => e.type === "cast" && e.key === "hero:" + hero.id && e.spell === "heal");
  result(!!heroCast && near(heroCast.amount, 56.25) && near(ka - kb, 56.25, 0.5) && heroBook.auto && near(heroBook.spellPowerMult, 1.25),
    `mage (spell power x${heroBook?.spellPowerMult}) auto-casts Heal on the wounded knight: ${kb} -> ${ka} (45 x1.25)`);
  await send({ type: "setSpellAuto", heroId: hero.id, auto: false });
  s = await st();
  result(s.heroes.find((h) => h.key === "hero:" + hero.id)?.auto === false, `the hero's Auto toggle turns off`);

  // ---- save / load keeps learned spells and slots ----
  s = await st();
  const saved = JSON.stringify([s.player.learned, s.player.slots]);
  const savedHero = JSON.stringify(s.heroes.find((h) => h.key === "hero:" + hero.id)?.learned);
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  await send({ type: "setSpellSlot", slot: 0, spellId: null });
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  s = await st();
  result(c.saves[0]?.ok && c.saves[1]?.ok && JSON.stringify([s.player.learned, s.player.slots]) === saved &&
    JSON.stringify(s.heroes.find((h) => h.key === "hero:" + hero.id)?.learned) === savedHero && s.heroes.find((h) => h.key === "hero:" + hero.id)?.auto === false,
    `save/load keeps learned spells ${s.player.learned} and slots ${s.player.slots}; the hero's book (${savedHero}, Auto off)`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
