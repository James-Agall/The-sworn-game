// Scripted test: monster tactics (ROADMAP "Monster tactics — landed 2026-10-27").
// Needs a private server: PORT=<free port> COLONY_TEST_HOOKS=1 COLONY_SAVE_DIR=<scratch dir>, default world size
// (160, as regiment-test). Pauses the world and works in a cleared arena well west of the Town Center.
//
//   F: flanking - 5 knights in a north-south line + 2 archers behind it vs a regiment of 6 armoured orcs +
//      2 orcs + 1 wolf (morale frozen): a flank group forms (the wolf) and a wolf strikes an archer while the
//      regiment's front line is still fighting the knights.
//   R: rout - a raid group of 2 goblins (still in contact formation) vs 8 knights: it routs (tactics event
//      + "The raiders break and flee!" toast), the goblins move away, and afterwards the group, its
//      regiment and its mobs are all gone.
//   W: wall cover - 3 goblins + 1 goblin crossbow of a walled site ("fortT") inside a walled 5x5 enclosure
//      with a closed gate, 8 knights outside: the regiment takes cover and every member is still inside
//      after 15 s; breaking the gate below half HP ends the cover ("coverEnd" breach).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const ONLY = new Set((process.env.ONLY ?? "F,R,W").split(","));
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

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, hook: new Map(), events: [] };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m);
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
const body = () => hook("bodyState");
const tactics = () => hook("tacticsState");

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
const W = c.welcome.worldTilesX;
const TCT = { x: Math.floor(W / 2), y: Math.floor(W / 2) };
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
const px = (tx) => tx * TILE + TILE / 2;

const A = { x: TCT.x - 34, y: TCT.y };
for (let dy = -12; dy <= 12; dy++) for (let dx = -20; dx <= 20; dx++) send({ type: "testHook", op: "setTileRaw", tx: A.x + dx, ty: A.y + dy, tile: 0 });
await hook("setTileRaw", { tx: A.x, ty: A.y, tile: 0 });
async function clearArena() {
  const bs = await body();
  for (const m of bs.mobs) {
    if (Math.abs(m.x - px(A.x)) <= 30 * TILE && Math.abs(m.y - px(A.y)) <= 24 * TILE) await hook("damageMob", { mobId: m.id, amount: 99999 });
  }
  for (const k of ["knight", "archer"]) await hook("killColonists", { kind: k });
  await ff(2);
}
await clearArena();

async function knightLine(x, y0, n, stance) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await hook("spawnSoldier", { kind: "knight", x: px(x), y: px(y0 + i), stance })).id);
  return ids;
}

// ---------------------------------------------------------------- F: flanking
if (ONLY.has("F")) {
  await hook("tacticsConfig", { freezeMorale: true });
  await knightLine(A.x - 2, A.y - 2, 5, "normal");
  const archers = [];
  for (const dy of [-1, 1]) archers.push((await hook("spawnSoldier", { kind: "archer", x: px(A.x - 5), y: px(A.y + dy), stance: "normal" })).id);
  const front = [];
  for (let i = 0; i < 6; i++) front.push((await hook("spawnMob", { kind: "armoredOrc", tx: A.x + 4 + (i % 2), ty: A.y - 2 + Math.floor(i / 2) * 2, regimentId: "rF" })).id);
  for (let i = 0; i < 2; i++) front.push((await hook("spawnMob", { kind: "orc", tx: A.x + 5, ty: A.y - 1 + 2 * i, regimentId: "rF" })).id);
  const wolf = (await hook("spawnMob", { kind: "wolf", tx: A.x + 5, ty: A.y - 3, regimentId: "rF" })).id;
  let flankAt = null;
  let strike = null;
  let maxWolfLateral = 0;
  for (let i = 0; i < 160 && !strike; i++) {
    await ff(5);
    const ts = await tactics();
    const bs = await body();
    const w = bs.mobs.find((m) => m.id === wolf);
    if (w) maxWolfLateral = Math.max(maxWolfLateral, Math.abs(w.y / TILE - A.y));
    if (!flankAt && ts.events.some((e) => e.regiment === "rF" && e.type === "flank")) flankAt = ts.cycleTick;
    const ev = ts.events.find((e) => e.regiment === "rF" && e.type === "flankStrike");
    if (ev) {
      const frontAlive = bs.mobs.filter((m) => front.includes(m.id));
      const engaged = frontAlive.some((m) => m.targetType === "colonist");
      const hurt = bs.colonists.filter((u) => archers.includes(u.id)).some((u) => u.hp < 35) || bs.colonists.filter((u) => archers.includes(u.id)).length < 2;
      strike = { tick: ts.cycleTick, detail: ev.detail, frontAlive: frontAlive.length, engaged, hurt };
    }
    if (process.env.DEBUG && i % 4 === 0) info(`F${i} ${JSON.stringify(ts.events.slice(-2))}: wolf ${w ? `${(w.x / TILE - A.x).toFixed(1)},${(w.y / TILE - A.y).toFixed(1)} ${w.targetType}` : "dead"} | ${ts.mobs.filter((m) => m.regiment === "rF").map((m) => `${m.kind[0]}:${m.tactic ?? "-"}`).join(" ")}`);
  }
  info(`F: flank at ${flankAt}, strike ${JSON.stringify(strike)}, wolf max lateral ${maxWolfLateral.toFixed(1)} tiles`);
  result(flankAt !== null, "F: the regiment sent a flank group round the knight line");
  result(maxWolfLateral >= 6, `F: the wolf swung wide round the line's end (max ${maxWolfLateral.toFixed(1)} tiles off-centre, line half-width 2)`);
  result(!!strike && /wolf->archer/.test(strike.detail ?? ""), `F: a wolf struck an archer (${strike?.detail ?? "none"})`);
  result(!!strike && strike.frontAlive > 0 && strike.engaged && strike.hurt, `F: ...while the front line was still engaged with the knights (front alive ${strike?.frontAlive}, engaged ${strike?.engaged}, archer hurt ${strike?.hurt})`);
  await hook("tacticsConfig", { freezeMorale: false });
  await clearArena();
}

// ---------------------------------------------------------------- R: rout
if (ONLY.has("R")) {
  await knightLine(A.x - 2, A.y - 4, 8, "defensive");
  await ff(2);
  const g = await hook("spawnRaidGroup", { kinds: ["goblin", "goblin"], tx: A.x + 7, ty: A.y });
  const kx = px(A.x - 2);
  const ky = px(A.y);
  let routAt = null;
  let atRout = null;
  let later = null;
  for (let i = 0; i < 80; i++) {
    await ff(5);
    const ts = await tactics();
    const mine = ts.mobs.filter((m) => m.regiment === g.id);
    const meanD = mine.length ? mine.reduce((s, m) => s + Math.hypot(m.x - kx, m.y - ky), 0) / mine.length / TILE : null;
    if (process.env.DEBUG && i % 4 === 0) info(`R${i}: ${JSON.stringify(ts.regiments.find((r) => r.id === g.id))} ${mine.map((m) => `${m.kind}@${(m.x / TILE - A.x).toFixed(1)},${(m.y / TILE - A.y).toFixed(1)} ${m.groupId ? "G" : ""}${m.tactic ?? ""} ${m.targetType}`).join(" ")}`);
    if (routAt === null && ts.events.some((e) => e.regiment === g.id && e.type === "rout")) {
      routAt = ts.cycleTick;
      atRout = meanD;
      info(`R: rout at ${routAt}: ${JSON.stringify(ts.regiments.find((r) => r.id === g.id))}, ${mine.length} goblins ${mine.map((m) => m.tactic).join(",")}`);
    } else if (routAt !== null && ts.cycleTick - routAt >= 40 && later === null) {
      later = meanD;
      break;
    }
  }
  result(routAt !== null, `R: 2 goblins vs 8 knights: the raid group routed (tick ${routAt})`);
  result(c.events.some((e) => e.text === "The raiders break and flee!"), "R: toast 'The raiders break and flee!'");
  result(atRout !== null && later !== null && later > atRout + 2, `R: the goblins moved away (${atRout?.toFixed(1)} -> ${later?.toFixed(1)} tiles from the knights)`);
  await ff(1300);
  const ts = await tactics();
  const left = ts.mobs.filter((m) => m.regiment === g.id).length;
  const desp = ts.events.filter((e) => e.regiment === g.id && e.type === "despawn").length;
  result(left === 0 && !ts.groups.includes(g.id) && !ts.regiments.some((r) => r.id === g.id), `R: cleaned up - ${left} mobs left, group ${ts.groups.includes(g.id) ? "still listed" : "gone"}, regiment ${ts.regiments.some((r) => r.id === g.id) ? "still listed" : "gone"} (${desp} despawned at the edge)`);
  result(desp >= 1, `R: at least one routed raider left by the map edge (${desp})`);
  await clearArena();
}

// ---------------------------------------------------------------- W: wall cover
if (ONLY.has("W")) {
  // 5x5 interior (x0..x0+4, y0..y0+4) ringed by walls, a closed gate mid-east.
  const x0 = A.x + 2;
  const y0 = A.y - 2;
  for (let x = x0 - 1; x <= x0 + 5; x++) for (let y = y0 - 1; y <= y0 + 5; y++) {
    const ring = x === x0 - 1 || x === x0 + 5 || y === y0 - 1 || y === y0 + 5;
    if (ring) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: x === x0 + 5 && y === y0 + 2 ? 70 : 1 });
  }
  await hook("setTileRaw", { tx: x0, ty: y0, tile: 0 });
  await hook("setRegimentWalled", { id: "fortT" });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await hook("spawnMob", { kind: "goblin", tx: x0 + 1 + i, ty: y0 + 1, siteId: "fortT" })).id);
  ids.push((await hook("spawnMob", { kind: "goblinCrossbow", tx: x0 + 2, ty: y0 + 3, siteId: "fortT" })).id);
  await knightLine(x0 + 8, y0 - 2, 8, "defensive");
  const inside = (m) => m.x >= x0 * TILE && m.x < (x0 + 5) * TILE && m.y >= y0 * TILE && m.y < (y0 + 5) * TILE;
  let allInside = true;
  for (let i = 0; i < 60; i++) {
    await ff(5);
    const ts = await tactics();
    const mine = ts.mobs.filter((m) => ids.includes(m.id));
    if (!mine.every(inside)) allInside = false;
  }
  const ts = await tactics();
  const reg = ts.regiments.find((r) => r.id === "fortT");
  const mine = ts.mobs.filter((m) => ids.includes(m.id));
  info(`W: regiment ${JSON.stringify(reg)}; mobs ${mine.map((m) => `${m.kind}@${(m.x / TILE - x0).toFixed(1)},${(m.y / TILE - y0).toFixed(1)}`).join(" ")}`);
  result(ts.events.some((e) => e.regiment === "fortT" && e.type === "cover") && reg?.sheltering === true, "W: the outnumbered walled regiment took cover");
  result(mine.length === 4 && allInside, `W: all ${mine.length} members stayed inside the walls for 15 s`);
  const gate = await hook("damageBuilding", { tx: x0 + 5, ty: y0 + 2, amount: 0 });
  const gmax = gate.structure?.max ?? 0;
  await hook("damageBuilding", { tx: x0 + 5, ty: y0 + 2, amount: Math.ceil(gmax * 0.6) });
  await ff(45);
  const ts2 = await tactics();
  const end = ts2.events.find((e) => e.regiment === "fortT" && e.type === "coverEnd");
  result(!!end && end.detail === "breach" && !ts2.regiments.find((r) => r.id === "fortT")?.sheltering, `W: gate below half HP (max ${gmax}) -> cover ends (${end?.detail ?? "none"})`);
}

console.log(fails === 0 ? `\nALL PASS [${el()}]` : `\n${fails} FAIL(S) [${el()}]`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
