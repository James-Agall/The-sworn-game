// Scripted test: Hero phases 1-2 (ROADMAP "Hero phases 1-2: items, inventory, character sheet").
// Self-contained: boots its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 21810) and a
// temp COLONY_SAVE_DIR, kills its process group after. Run from server/: `node character-sheet-test.mjs`.
//   R a relic granted by hook lands in the inventory (and the per-player snapshot `profile`).
//   W a weapon relic refuses the head slot, equips into weapon: the player's blow on a dummy mob is x mult.
//   A an armour relic: damage taken x mult, max HP bonus (HP clamped back on unequip); unequip restores.
//   T "Take from armoury" moves one plain tiered piece from the colony stock into the inventory.
//   X kills by the player give XP; level 2 applies +4% damage / +6 max HP.
//   B a mini-boss elite, the Warlord and a hearth (chance forced) each grant a relic.
//   S save/load keeps inventory, equipment and XP; death keeps the equipment.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21810);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "charsheet-"));
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
  const c = { ws: null, welcome: null, snap: null, profile: null, events: [], hook: new Map(), saves: [] };
  c.ws = new WebSocket(`ws://localhost:${PORT}/?profile=sheet-tester`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.profile) c.profile = m.profile;
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
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
  return c;
}

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
  await c.hookCall("ignorePlayers", { value: true });
  const tc = { x: c.snap.townCenters[0].x, y: c.snap.townCenters[0].y };
  let hs = await c.hookCall("heroState");
  result(hs.key === "sheet-tester" && c.profile && c.profile.level === 1 && c.profile.inventory.length === 0 && c.profile.stats.maxHp === 100,
    `fresh profile via ?profile= key ${hs.key}: level ${c.profile?.level}, empty pack, snapshot profile sent`);
  const stats = () => hs.profile.stats;
  const send = async (m) => {
    c.send(m);
    await c.freshSnap();
    await c.freshSnap();
    hs = await c.hookCall("heroState");
    return hs;
  };

  // ---- R: grant ----
  const blade = (await c.hookCall("grantRelic", { relicId: "swornOathblade" })).item;
  hs = await c.hookCall("heroState");
  await c.freshSnap();
  await c.freshSnap();
  result(blade && blade.tier === "relic" && hs.profile.inventory.some((i) => i.id === blade.id) && c.profile.inventory.some((i) => i.id === blade.id),
    `relic granted into inventory: ${blade?.name} ${JSON.stringify(blade?.stats)}`);
  result(c.events.some((t) => t === `Relic found: ${blade?.name}`), `toast "Relic found: ${blade?.name}"`);
  const dup = (await c.hookCall("grantRelic", { relicId: "swornOathblade" })).item;
  result(dup === null, `a relic already owned is not granted twice`);

  // ---- W: wrong slot refused, weapon equip applies the damage multiplier ----
  await send({ type: "equipItem", itemId: blade.id, slot: "head" });
  result(hs.profile.equipment.head === null && hs.profile.inventory.some((i) => i.id === blade.id) && hs.events.some((e) => e.type === "refuse"),
    `weapon relic refused in the head slot`);
  await send({ type: "equipItem", itemId: blade.id, slot: "weapon" });
  result(hs.profile.equipment.weapon?.id === blade.id && !hs.profile.inventory.some((i) => i.id === blade.id) && near(stats().damageMult, 1.6),
    `weapon relic equipped: damage x${stats().damageMult}, attack speed x${stats().attackSpeedMult} (cooldown ${hs.cooldownTicks})`);
  const spot = { tx: tc.x - 10, ty: tc.y + 6 };
  const dummy = await c.hookCall("spawnMob", { kind: "troll", ...spot });
  await c.hookCall("teleportPlayer", { x: spot.tx * TILE + 16, y: spot.ty * TILE + 16 });
  await c.freshSnap();
  const m = c.snap.mobs.find((x) => x.id === dummy.id);
  if (m) await c.hookCall("teleportPlayer", { x: m.x, y: m.y });
  c.send({ type: "attack" });
  await c.freshSnap();
  await c.freshSnap();
  hs = await c.hookCall("heroState");
  const hit = hs.events.filter((e) => e.type === "hit" && e.detail === dummy.id).pop();
  result(!!hit && near(hit.amount, 15 * 1.6), `player blow on the dummy = 15 x1.6 = ${hit?.amount}`);
  await c.hookCall("damageMob", { mobId: dummy.id, amount: 1e7 });

  // ---- A: armour relic: damage taken, max HP, clamp ----
  const hide = (await c.hookCall("grantRelic", { relicId: "gorrathHide" })).item;
  await send({ type: "equipItem", itemId: hide.id, slot: "chest" });
  result(near(stats().damageTakenMult, 0.6) && stats().maxHp === 130, `Gorrath's Hide: damage taken x${stats().damageTakenMult}, max HP ${stats().maxHp}`);
  result(hs.hp <= 100, `max HP gain doesn't heal (hp ${hs.hp})`);
  let before = hs.hp;
  let dp = await c.hookCall("damagePlayer", { amount: 10 });
  result(near(before - dp.hp, 6), `10 damage taken as ${(before - dp.hp).toFixed(2)} (x0.6)`);
  // Heal to the new max (a negative "damage" through the same x0.6), then unequip: HP clamps to 100.
  await c.hookCall("damagePlayer", { amount: -(130 - dp.hp) / 0.6 });
  hs = await c.hookCall("heroState");
  result(near(hs.hp, 130), `healed to the raised max ${hs.hp.toFixed(1)}/130`);
  await send({ type: "unequipItem", slot: "chest" });
  result(hs.hp === 100 && stats().maxHp === 100 && near(stats().damageTakenMult, 1) && hs.profile.inventory.some((i) => i.id === hide.id),
    `unequip chest: max HP ${stats().maxHp}, hp clamped ${hs.hp}, damage taken x${stats().damageTakenMult}, back in pack`);
  before = hs.hp;
  dp = await c.hookCall("damagePlayer", { amount: 10 });
  result(near(before - dp.hp, 10), `unequipped: full 10 damage taken`);
  await send({ type: "unequipItem", slot: "weapon" });
  result(near(stats().damageMult, 1) && hs.profile.equipment.weapon === null, `unequip weapon: damage x${stats().damageMult}`);

  // ---- T: take from armoury ----
  await c.hookCall("setEquipment", { armour: [0, 0, 2], weapon: [1, 0, 0] });
  const invBefore = hs.profile.inventory.length;
  await send({ type: "takeFromArmoury", slot: "armour", tier: 3 });
  let eq = (await c.hookCall("equipState")).equipment;
  const plate = hs.profile.inventory.find((i) => i.tier === 3 && i.slot === "chest");
  result(eq.armour[2] === 1 && hs.profile.inventory.length === invBefore + 1 && plate?.stats.damageTakenPct === -45,
    `take T3 armour: stock ${JSON.stringify(eq.armour)}, pack +1 "${plate?.name}" ${JSON.stringify(plate?.stats)}`);
  await send({ type: "takeFromArmoury", slot: "weapon", tier: 2 });
  eq = (await c.hookCall("equipState")).equipment;
  result(hs.profile.inventory.length === invBefore + 1 && eq.weapon[0] === 1, `take T2 weapon refused (none in stock)`);
  await send({ type: "takeFromArmoury", slot: "weapon", tier: 1 });
  const sword = hs.profile.inventory.find((i) => i.tier === 1 && i.slot === "weapon");
  result(sword?.stats.damagePct === 20, `take T1 weapon: "${sword?.name}" ${JSON.stringify(sword?.stats)}`);
  await send({ type: "equipItem", itemId: plate.id, slot: "chest" });
  await send({ type: "equipItem", itemId: hide.id, slot: "chest" });
  result(hs.profile.equipment.chest?.id === hide.id && hs.profile.inventory.some((i) => i.id === plate.id), `equipping onto an occupied slot swaps the old item back to the pack`);

  // ---- X: XP and levels ----
  const xp0 = hs.profile.xp;
  for (let i = 0; i < 4; i++) {
    const g = await c.hookCall("spawnMob", { kind: "goblin", tx: tc.x - 20, ty: tc.y - 20 });
    await c.hookCall("damageMob", { mobId: g.id, amount: 1e7, byPlayer: true });
  }
  hs = await c.hookCall("heroState");
  result(hs.profile.xp === xp0 + 40 && hs.profile.level === 2, `4 kills: xp ${hs.profile.xp}, level ${hs.profile.level}`);
  result(near(stats().damageMult, 1.04) && stats().maxHp === 130 + 6, `level 2: damage x${stats().damageMult.toFixed(3)}, max HP ${stats().maxHp} (Hide 130 + 6)`);
  const g2 = await c.hookCall("spawnMob", { kind: "goblin", tx: tc.x - 20, ty: tc.y - 20 });
  await c.hookCall("damageMob", { mobId: g2.id, amount: 1e7 });
  hs = await c.hookCall("heroState");
  result(hs.profile.xp === xp0 + 40, `a kill not by the player gives no XP`);

  // ---- B: boss relics ----
  const relics = () => hs.profile.inventory.filter((i) => i.tier === "relic" && i.slot !== "tome").length + Object.values(hs.profile.equipment).filter((i) => i?.tier === "relic").length;
  let r0 = relics();
  const elite = await c.hookCall("spawnMob", { kind: "orc", tx: tc.x - 22, ty: tc.y - 20, boss: "elite" });
  await c.hookCall("damageMob", { mobId: elite.id, amount: 1e7, byPlayer: true });
  hs = await c.hookCall("heroState");
  result(relics() === r0 + 1 && hs.profile.xp === xp0 + 100, `mini-boss elite kill grants a relic (${r0} -> ${relics()}) and 60 XP`);
  r0 = relics();
  const warlord = await c.hookCall("spawnMob", { kind: "ogre", tx: tc.x - 22, ty: tc.y - 22, boss: "warlord" });
  await c.hookCall("damageMob", { mobId: warlord.id, amount: 1e7, byPlayer: true });
  hs = await c.hookCall("heroState");
  result(relics() === r0 + 1, `Ogre Warlord kill grants a relic (${r0} -> ${relics()})`);
  r0 = relics();
  await c.hookCall("heroConfig", { relicChance: 0 });
  const orc = await c.hookCall("spawnMob", { kind: "armoredOrc", tx: tc.x - 20, ty: tc.y - 22 });
  await c.hookCall("damageMob", { mobId: orc.id, amount: 1e7, byPlayer: true });
  hs = await c.hookCall("heroState");
  result(relics() === r0, `armoured orc with relic chance 0: no relic`);
  await c.hookCall("heroConfig", { relicChance: 1 });
  const camp = (await c.hookCall("hearthState")).hearths.find((h) => !h.destroyed);
  await c.hookCall("damageHearth", { siteId: camp.siteId, amount: 1e6 });
  hs = await c.hookCall("heroState");
  result(relics() === r0 + 1, `destroyed hearth (chance forced 1) grants a relic (${r0} -> ${relics()})`);
  await c.hookCall("heroConfig", {});

  // ---- S: save / load, death ----
  const savedProfile = JSON.stringify(hs.profile);
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  await send({ type: "unequipItem", slot: "chest" });
  await c.hookCall("grantRelic", {});
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  hs = await c.hookCall("heroState");
  result(c.saves[0]?.ok && c.saves[1]?.ok && JSON.stringify(hs.profile) === savedProfile && hs.hp === stats().maxHp,
    `save/load keeps inventory (${hs.profile.inventory.length}), equipment (chest ${hs.profile.equipment.chest?.name}), xp ${hs.profile.xp}; respawned at ${hs.hp}`);
  await c.freshSnap();
  await c.freshSnap();
  result(c.profile && JSON.stringify(c.profile) === savedProfile, `the loaded profile is resent in the snapshot`);
  await c.hookCall("damagePlayer", { amount: 1e6 });
  hs = await c.hookCall("heroState");
  result(!hs.dead && hs.hp === stats().maxHp && hs.profile.equipment.chest?.id === hide.id && JSON.stringify(hs.profile) === savedProfile,
    `death + respawn keeps equipment and pack (hp ${hs.hp}/${stats().maxHp})`);
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
