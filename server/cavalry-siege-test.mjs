// Scripted test: cavalry & siege (ROADMAP "Cavalry & siege — landed 2026-10-27").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>, default (160)
// world. Paused world, instant build, cleared arenas west of the Town Center.
//
//   S: Stables builds and garrisons 1 cavalry (2 after an upgrade, level 2), speed 1.6x the knight's;
//      role tables: knight shock, cavalry fast, rams / catapults siege.
//   C: a cavalry rider charging a skeleton 10 tiles away: its first blow is a charge (x2), the next ones not.
//   W: Siege Workshop builds a ram (population +2); the player's ram hits a mob for x0.3.
//   G: a mob ram goes for a locked gate (a Tower behind it, so it isn't simply overrun) and hits it for x4.
//   K: a mob catapult >= 6 tiles from a house hits the house (x3) and splashes the two knights next to it.
//   R: raids: none of the siege kinds before day 10, a ram from day 10, ram + catapult on day 14, the ram in
//      the front row, the catapult on a rear row.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "S,C,W,G,K,R").split(","));
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`INFO [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, hook: new Map() };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const siege = () => hook("siegeState");
const body = () => hook("bodyState");
const px = (tx) => tx * TILE + TILE / 2;

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
await hook("setInstantBuild", { enabled: true });
await hook("setStock", { stock: { wood: 2000, iron: 2000, rock: 2000, grain: 500, meat: 500, fruit: 500 } });

async function clearArena(a, rx = 9, ry = 8) {
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) send({ type: "testHook", op: "setTileRaw", tx: a.x + dx, ty: a.y + dy, tile: 0 });
  await hook("setTileRaw", { tx: a.x, ty: a.y, tile: 0 });
  const bs = await body();
  for (const m of bs.mobs) {
    if (Math.abs(m.x - px(a.x)) <= 22 * TILE && Math.abs(m.y - px(a.y)) <= 20 * TILE) await hook("damageMob", { mobId: m.id, amount: 99999 });
  }
}
async function place(tx, ty, tile) {
  await hook("teleportPlayer", { x: px(tx) - TILE, y: px(ty) + TILE });
  send({ type: "setTile", tileX: tx, tileY: ty, tile });
  await sleep(100);
  await ff(2);
}
const STABLES = 71;
const WORKSHOP = 72;
const GATE = 70;
const HOUSE = 13;

// ---------------------------------------------------------------- S: Stables + role tables
const A = { x: TCT.x - 34, y: TCT.y };
if (ONLY.has("S")) {
  await clearArena(A);
  await place(A.x, A.y, STABLES);
  let st = await siege();
  const cav = st.units.filter((u) => u.kind === "cavalry" && u.postX === A.x && u.postY === A.y);
  result(cav.length === 1, `S: Stables built and garrisoned ${cav.length} cavalry (need 1)`);
  result(cav[0]?.speed === Math.round(110 * 1.6), `S: cavalry speed ${cav[0]?.speed} px/s = 1.6x the knight's 110`);
  result(cav[0]?.maxHp === 60, `S: cavalry HP ${cav[0]?.maxHp} = knight Lv1 (60)`);
  await place(A.x, A.y, STABLES);
  st = await siege();
  const cav2 = st.units.filter((u) => u.kind === "cavalry" && u.postX === A.x && u.postY === A.y);
  result(cav2.length === 2 && cav2.every((u) => u.level === 2), `S: upgraded Stables (Lv2) garrisons ${cav2.length} cavalry (need 2, level 2)`);
  const r = st.roles;
  result(
    r.colonist.knight === "shock" && r.colonist.cavalry === "fast" && r.colonist.batteringRam === "siege" && r.colonist.catapult === "siege" &&
      r.colonist.militia === "frontline" && r.colonist.spearman === "frontline" && r.colonist.pikeman === "frontline" &&
      r.mob.batteringRam === "siege" && r.mob.catapult === "siege",
    `S: role tables (knight ${r.colonist.knight}, cavalry ${r.colonist.cavalry}, ram ${r.colonist.batteringRam}/${r.mob.batteringRam}, catapult ${r.colonist.catapult}/${r.mob.catapult}, militia ${r.colonist.militia})`
  );
  await hook("killColonists", { kind: "cavalry" });
  await place(A.x, A.y, 0);
}

// ---------------------------------------------------------------- C: the cavalry charge
if (ONLY.has("C")) {
  await clearArena(A);
  const rider = (await hook("spawnSoldier", { kind: "cavalry", x: px(A.x - 6), y: px(A.y), stance: "normal" })).id;
  const foe = (await hook("spawnMob", { kind: "skeleton", tx: A.x + 4, ty: A.y })).id;
  await ff(1);
  send({ type: "commandAttack", unitIds: [rider], mobId: foe });
  await sleep(100);
  let events = [];
  for (let i = 0; i < 60; i++) {
    await ff(5);
    events = (await siege()).events.filter((e) => e.id === rider && (e.type === "charge" || e.type === "hit"));
    if (events.length >= 3) break;
  }
  info(`C: rider blows ${events.map((e) => `${e.type}:${e.amount}`).join(" ")}`);
  const charges = events.filter((e) => e.type === "charge");
  result(events[0]?.type === "charge", `C: the first blow after a 10-tile straight ride is a charge`);
  result(charges.length === 1 && events.length >= 2, `C: exactly one charge (${charges.length}) among ${events.length} blows`);
  const hit = events.find((e) => e.type === "hit");
  result(!!hit && near(charges[0]?.amount, hit.amount * 2), `C: charge ${charges[0]?.amount} = 2 x a normal blow ${hit?.amount}`);
  await hook("killColonists", { kind: "cavalry" });
}

// ---------------------------------------------------------------- W: Siege Workshop + the player's ram vs a unit
const B = { x: TCT.x - 34, y: TCT.y + 22 };
if (ONLY.has("W")) {
  await clearArena(B);
  await place(B.x, B.y, WORKSHOP);
  const pop0 = (await siege()).population;
  send({ type: "queueSiege", tileX: B.x, tileY: B.y, kind: "batteringRam" });
  await sleep(100);
  await ff(3);
  let st = await siege();
  const ram = st.units.find((u) => u.kind === "batteringRam" && u.postX === B.x && u.postY === B.y);
  result(!!ram, `W: the Siege Workshop rolled out a battering ram (HP ${ram?.maxHp}, speed ${ram?.speed})`);
  result(ram?.maxHp === 240 && ram?.speed === 55, `W: ram HP 240 (4x knight), speed 55 (0.5x knight)`);
  result(st.population === pop0 + 2, `W: population ${pop0} -> ${st.population} (+2)`);
  // The ram vs a unit: x0.3.
  const rt = { x: Math.floor(ram.x / TILE), y: Math.floor(ram.y / TILE) };
  const foe = (await hook("spawnMob", { kind: "skeleton", tx: rt.x + 1, ty: rt.y })).id;
  send({ type: "commandAttack", unitIds: [ram.id], mobId: foe });
  await sleep(100);
  let hits = [];
  for (let i = 0; i < 40 && hits.length === 0; i++) {
    await ff(5);
    hits = (await siege()).events.filter((e) => e.type === "ramHit" && e.id === ram.id);
  }
  info(`W: player ram hits ${hits.map((e) => e.amount).join(" ")}`);
  result(hits.length > 0 && hits[0].amount >= 12 * 0.3 - 0.01 && hits[0].amount <= 12 * 0.3 * 1.3, `W: ram vs a unit deals ${hits[0]?.amount?.toFixed(2)} (12 x 0.3 = 3.6, x army bonus)`);
  await hook("damageMob", { mobId: foe, amount: 99999 });
}

// ---------------------------------------------------------------- G: a mob ram storms a locked gate (x4)
const G = { x: TCT.x - 34, y: TCT.y - 22 };
if (ONLY.has("G")) {
  await clearArena(G);
  await hook("setTileRaw", { tx: G.x, ty: G.y, tile: GATE });
  // A Tower behind the gate: an undefended gate is simply overrun by a lone ram (Walls & gates item 5).
  await hook("setTileRaw", { tx: G.x + 3, ty: G.y, tile: 62 });
  await ff(2);
  send({ type: "setGateLock", tileX: G.x, tileY: G.y, lock: "closed" });
  await sleep(100);
  await ff(2);
  const hp0 = (await hook("damageBuilding", { tx: G.x, ty: G.y, amount: 0 })).structure?.hp;
  const ram = (await hook("spawnMob", { kind: "batteringRam", tx: G.x - 5, ty: G.y })).id;
  let hits = [];
  for (let i = 0; i < 80 && hits.length === 0; i++) {
    await ff(5);
    hits = (await siege()).events.filter((e) => e.type === "ramHit" && e.id === ram);
  }
  const hp1 = (await hook("damageBuilding", { tx: G.x, ty: G.y, amount: 0 })).structure?.hp;
  info(`G: mob ram hits ${hits.map((e) => `${e.amount}(${e.detail})`).join(" ")}, gate HP ${hp0} -> ${hp1}`);
  result(hits[0]?.detail === `building:${GATE}`, `G: the mob ram's first target is the locked gate (${hits[0]?.detail})`);
  result(hits[0]?.amount === 12 * 4 && hp0 - hp1 === 12 * 4 * hits.length, `G: ram vs gate deals ${hits[0]?.amount} (12 x 4 = 48); gate HP ${hp0} -> ${hp1}`);
  await hook("damageMob", { mobId: ram, amount: 99999 });
}

// ---------------------------------------------------------------- K: a mob catapult shells a house
const K = { x: TCT.x - 56, y: TCT.y };
if (ONLY.has("K")) {
  await clearArena(K, 12, 8);
  await hook("setTileRaw", { tx: K.x, ty: K.y, tile: HOUSE });
  const k1 = (await hook("spawnSoldier", { kind: "knight", x: px(K.x), y: px(K.y - 1), stance: "defensive" })).id;
  const k2 = (await hook("spawnSoldier", { kind: "knight", x: px(K.x), y: px(K.y + 1), stance: "defensive" })).id;
  await ff(2);
  const house0 = (await hook("damageBuilding", { tx: K.x, ty: K.y, amount: 0 })).structure;
  const kHp0 = (await body()).colonists.filter((u) => u.id === k1 || u.id === k2).map((u) => u.hp);
  const cat = await hook("spawnMob", { kind: "catapult", tx: K.x + 8, ty: K.y });
  let shots = [];
  for (let i = 0; i < 30 && shots.length === 0; i++) {
    await ff(4);
    shots = (await siege()).events.filter((e) => e.type === "boulder" && e.id === "m:" + cat.id);
  }
  const bs = await body();
  const catNow = bs.mobs.find((m) => m.id === cat.id);
  const dist = catNow ? Math.hypot(catNow.x - px(K.x), catNow.y - px(K.y)) / TILE : 0;
  const house1 = (await hook("damageBuilding", { tx: K.x, ty: K.y, amount: 0 })).structure;
  const kHp1 = bs.colonists.filter((u) => u.id === k1 || u.id === k2).map((u) => u.hp);
  info(`K: catapult (${cat.maxHp} HP) shots ${shots.map((e) => e.detail).join(" ")}, house ${house0?.hp} -> ${house1?.hp}, knights ${kHp0} -> ${kHp1}`);
  result(shots.length >= 1 && dist >= 6, `K: the catapult fired from ${dist.toFixed(1)} tiles (need >= 6)`);
  result(house0 && house1 && house0.hp - house1.hp === 18 * 3 * shots.length, `K: house HP ${house0?.hp} -> ${house1?.hp} (18 x 3 per boulder)`);
  result(kHp1.length === 2 && kHp1.every((hp, i) => near(kHp0[i] - hp, 18 * shots.length)), `K: both knights next to the house splashed (${kHp0} -> ${kHp1})`);
  await hook("damageMob", { mobId: cat.id, amount: 99999 });
  await hook("killColonists", { kind: "knight" });
}

// ---------------------------------------------------------------- R: siege in raid groups
if (ONLY.has("R")) {
  await hook("forceRaidSiege", { value: true });
  await hook("holdRaidAggro", { value: true });
  async function raidOn(day) {
    for (const m of (await body()).mobs) await hook("damageMob", { mobId: m.id, amount: 99999 });
    await ff(2);
    await hook("spawnRaidNow", { dayIndex: day });
    const rs = await hook("raidState");
    return rs;
  }
  const kindsOf = (rs) => rs.mobs.filter((m) => m.groupId).map((m) => m.kind);
  let rs = await raidOn(9);
  result(!kindsOf(rs).some((k) => k === "batteringRam" || k === "catapult"), `R: day 9 (index): no siege engines (${kindsOf(rs).length} raiders)`);
  rs = await raidOn(10);
  const k10 = kindsOf(rs);
  result(k10.filter((k) => k === "batteringRam").length === 1 && !k10.includes("catapult"), `R: day 10: one ram, no catapult (${k10.filter((k) => k === "batteringRam").length} rams)`);
  rs = await raidOn(14);
  const k14 = kindsOf(rs);
  result(k14.filter((k) => k === "batteringRam").length === 1 && k14.filter((k) => k === "catapult").length === 1, `R: day 14: one ram + one catapult`);
  // March: the groups take their formation slots.
  await hook("raidDepartNow");
  await ff(4);
  rs = await hook("raidState");
  const ramMob = rs.mobs.find((m) => m.kind === "batteringRam");
  const catMob = rs.mobs.find((m) => m.kind === "catapult");
  const group = rs.groups.find((g) => g.memberIds.includes(ramMob?.id));
  const factionOk = group && (group.faction === "greenskinWarband" || group.faction === "banditBand");
  result(!!factionOk, `R: the ram marches with a ${group?.faction} group`);
  const offs = new Map(group?.offsets ?? []);
  const ramOff = group?.leaderId === ramMob?.id ? { x: 0, y: 0, row: 0 } : offs.get(ramMob?.id);
  const frontW = Array.from(offs.values()).filter((o) => o.row === 0).length;
  result(!!ramOff && ramOff.row === 0 && Math.abs(ramOff.x) <= 2 * TILE, `R: ram in the front row, near the centre (row ${ramOff?.row}, x ${ramOff?.x?.toFixed(1)}, ${frontW} in row 0)`);
  const catGroup = rs.groups.find((g) => g.memberIds.includes(catMob?.id));
  const cOffs = new Map(catGroup?.offsets ?? []);
  const catOff = cOffs.get(catMob?.id);
  const frontRows = Array.from(cOffs.entries())
    .filter(([id]) => {
      const k = rs.mobs.find((m) => m.id === id)?.kind;
      return k && !["catapult", "goblinCrossbow", "banditArcher", "darkShaman"].includes(k);
    })
    .map(([, o]) => o.row);
  const lastFront = Math.max(0, ...frontRows);
  result(!!catOff && catOff.row > lastFront && catOff.y > 0, `R: catapult on a rear row (row ${catOff?.row} > front's last ${lastFront}, ${catOff?.y?.toFixed(0)} px back)`);
  await hook("forceRaidSiege", { value: false });
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
