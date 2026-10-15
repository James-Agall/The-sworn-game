// Scripted test: Road / Cobble Road tiles (placement, cost, demolish, player speed bonus) and
// Hunger-marked elites (raid-spawn marks with boosted stats + snapshot field + event, Gunne's
// lowest-hp% targeting, Gorrath's once-per-mob wounded fury, x3 gold).
// Needs a private server: PORT=<free port> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1.
// The world is paused for the whole run; every simulated tick comes from testHook fastForward.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, KnightPost: 5, Road: 60, CobbleRoad: 61 };
const TILE = 32;
const REACH = TILE * 2.5;
// Server MOB_KIND_CONFIG base stats (normal difficulty), to check the mark multipliers.
const BASE = {
  goblin: [18, 4], wolf: [22, 6], goblinCrossbow: [16, 6], orc: [45, 10], skeleton: [50, 8], armoredOrc: [80, 14],
  giantSpider: [35, 7], darkShaman: [25, 12], troll: [120, 16], ogre: [220, 28], banditClubman: [30, 7],
  banditArcher: [25, 8], banditElite: [70, 14],
};

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tiles: [], events: [], hook: new Map() };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
});
const send = (m) => c.ws.send(JSON.stringify(m));
const W = () => c.welcome.worldTilesX;
const tileAt = (x, y) => c.tiles[y * W() + x];
const me = () => c.snap.players.find((p) => p.id === c.welcome.id);
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 400 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const freshSnap = async () => {
  const before = c.snap;
  while (c.snap === before) await sleep(10);
  return c.snap;
};
const ff = (ticks) => hook("fastForward", { ticks });

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
await hook("setRaids", { enabled: false });
await hook("setInstantBuild", { enabled: true });
await hook("setStock", { stock: { wood: 2000, rock: 100, iron: 2000, tools: 200, gold: 0 } });
send({ type: "pause" });
await freshSnap();
let snap = await freshSnap();
result(snap.isPaused, "world paused for the test");

// ---- 1. Road placement, cost, demolish ----
{
  const p = me();
  const mx = Math.floor(p.x / TILE);
  const my = Math.floor(p.y / TILE);
  const occupied = new Set([...snap.colonists, ...snap.players].map((e) => Math.floor(e.y / TILE) * W() + Math.floor(e.x / TILE)));
  const free = [];
  for (let y = my - 2; y <= my + 2; y++)
    for (let x = mx - 2; x <= mx + 2; x++)
      if (Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) <= REACH && tileAt(x, y) === T.Empty && !occupied.has(y * W() + x)) free.push({ x, y });
  result(free.length >= 2, `found ${free.length} free tiles in reach`);
  const rockBefore = snap.rock;
  send({ type: "setTile", tileX: free[0].x, tileY: free[0].y, tile: T.Road });
  send({ type: "setTile", tileX: free[1].x, tileY: free[1].y, tile: T.CobbleRoad });
  snap = await freshSnap();
  snap = await freshSnap();
  result(tileAt(free[0].x, free[0].y) === T.Road, "Road placed (instant build)");
  result(tileAt(free[1].x, free[1].y) === T.CobbleRoad, "Cobble Road placed");
  result(rockBefore - snap.rock === 3, `roads cost 1 + 2 rock (spent ${rockBefore - snap.rock})`);
  send({ type: "setTile", tileX: free[0].x, tileY: free[0].y, tile: T.Empty });
  await freshSnap();
  await freshSnap();
  result(tileAt(free[0].x, free[0].y) === T.Empty, "Demolish reverts a Road to Empty");
}

// ---- 2. Player speed bonus on roads (+25%) ----
{
  // Two adjacent rows of 12 empty Plains tiles, away from the edges.
  const biomes = c.welcome.biomes;
  let spot = null;
  for (let y = 5; y < W() - 6 && !spot; y++) {
    for (let x = 5; x < W() - 18 && !spot; x++) {
      let ok = true;
      for (let dy = 0; dy < 2 && ok; dy++)
        for (let dx = 0; dx < 12 && ok; dx++) ok = tileAt(x + dx, y + dy) === T.Empty && biomes[(y + dy) * W() + x + dx] === 0;
      if (ok) spot = { x, y };
    }
  }
  result(!!spot, "found a 12x2 clear plains strip");
  for (let dx = 0; dx < 12; dx++) await hook("setTileRaw", { tx: spot.x + dx, ty: spot.y, tile: T.Road });
  const run = async (row) => {
    const startX = spot.x * TILE + 16;
    await hook("teleportPlayer", { x: startX, y: (spot.y + row) * TILE + 16 });
    send({ type: "input", dx: 1, dy: 0 });
    await ff(20);
    send({ type: "input", dx: 0, dy: 0 });
    await freshSnap();
    const s = await freshSnap();
    return s.players.find((pl) => pl.id === c.welcome.id).x - startX;
  };
  const onRoad = await run(0);
  const offRoad = await run(1);
  const ratio = onRoad / offRoad;
  result(Math.abs(ratio - 1.25) < 0.02, `player 1 s on road ${onRoad.toFixed(1)}px vs off road ${offRoad.toFixed(1)}px (x${ratio.toFixed(3)})`);
}

// ---- 3. Gunne targets the lowest-hp% guard; an unmarked mob takes the nearest ----
{
  const p = me();
  const mx = Math.floor(p.x / TILE);
  const my = Math.floor(p.y / TILE);
  // Two Halls of the Sworn near the player (1 knight each at level 1).
  let placed = 0;
  for (let y = my - 2; y <= my + 2 && placed < 2; y++) {
    for (let x = mx - 2; x <= mx + 2 && placed < 2; x++) {
      if (Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) > REACH || tileAt(x, y) !== T.Empty) continue;
      if (Math.floor(p.x / TILE) === x && Math.floor(p.y / TILE) === y) continue;
      send({ type: "setTile", tileX: x, tileY: y, tile: T.KnightPost });
      await freshSnap();
      await freshSnap();
      if (tileAt(x, y) === T.KnightPost) placed++;
    }
  }
  snap = await freshSnap();
  const knights = snap.colonists.filter((col) => col.kind === "knight");
  result(knights.length >= 2, `${knights.length} knights stand`);
  // Spawn spot: an empty tile 3-6 tiles from the knights; the healthy knight is the nearer one.
  const kx = (k) => k.x / TILE;
  const ky = (k) => k.y / TILE;
  let spawn = null;
  let healthy = null;
  let wounded = null;
  for (let r = 3; r <= 6 && !spawn; r++) {
    for (let a = 0; a < 16 && !spawn; a++) {
      const tx = Math.floor(kx(knights[0]) + r * Math.cos((a * Math.PI) / 8));
      const ty = Math.floor(ky(knights[0]) + r * Math.sin((a * Math.PI) / 8));
      if (tileAt(tx, ty) !== T.Empty) continue;
      const d = knights.map((k) => Math.hypot(kx(k) - tx - 0.5, ky(k) - ty - 0.5));
      const order = knights.map((k, i) => i).sort((i, j) => d[i] - d[j]);
      if (d[order[1]] - d[order[0]] < 0.5 || d[order[1]] > 9) continue;
      spawn = { x: tx, y: ty };
      healthy = knights[order[0]];
      wounded = knights[order[1]];
    }
  }
  result(!!spawn, "found a spawn tile nearer one knight than the other");
  await hook("setColonistHp", { id: wounded.id, hp: Math.round(wounded.maxHp * 0.3) });
  const gunne = await hook("spawnMob", { kind: "goblin", tx: spawn.x, ty: spawn.y, mark: 5 });
  const plain = await hook("spawnMob", { kind: "goblin", tx: spawn.x, ty: spawn.y });
  result(gunne.mark === 5 && gunne.maxHp === Math.round(18 * 1.5) && gunne.damage === Math.round(4 * 1.25), `marked goblin hp ${gunne.maxHp} dmg ${gunne.damage} (x1.5 / x1.25)`);
  await ff(1);
  const rs = await hook("raidState");
  const g = rs.mobs.find((m) => m.id === gunne.id);
  const u = rs.mobs.find((m) => m.id === plain.id);
  result(g?.targetId === wounded.id, `Gunne-marked goblin targets the wounded (farther) knight (${g?.targetId === wounded.id ? "yes" : g?.targetId})`);
  result(u?.targetId === healthy.id, `unmarked goblin targets the nearer healthy knight (${u?.targetId === healthy.id ? "yes" : u?.targetId})`);
  snap = await freshSnap();
  const snapMark = snap.mobs.find((m) => m.id === gunne.id)?.mark;
  const snapPlain = snap.mobs.find((m) => m.id === plain.id);
  result(snapMark === 5 && snapPlain && !("mark" in snapPlain), "snapshot carries mark only on the marked mob");
  await hook("damageMob", { mobId: gunne.id, amount: 9999 });
  await hook("damageMob", { mobId: plain.id, amount: 9999 });
}

// ---- 4. Gorrath: first lethal blow -> wounded fury at 20% hp; then dies and pays x3 gold ----
{
  snap = await freshSnap();
  const goldBefore = snap.gold;
  const p = me();
  const gor = await hook("spawnMob", { kind: "orc", tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) - 6, mark: 1 });
  await hook("damageMob", { mobId: gor.id, amount: 9999 });
  let rs = await hook("raidState");
  const m = rs.mobs.find((x) => x.id === gor.id);
  result(!!m && m.hp === Math.round(m.maxHp * 0.2) && m.furyUntilTick > rs.cycleTick, `Gorrath survives the lethal blow at ${m?.hp}/${m?.maxHp} in fury`);
  await hook("damageMob", { mobId: gor.id, amount: 9999 });
  rs = await hook("raidState");
  result(!rs.mobs.some((x) => x.id === gor.id), "second lethal blow kills it");
  snap = await freshSnap();
  const expected = Math.max(3, Math.round((gor.maxHp + gor.damage * 2) / 8)) * 3;
  result(snap.gold - goldBefore === expected, `kill paid ${snap.gold - goldBefore} gold (expected x3 = ${expected})`);
}

// ---- 5. Raid spawn on a late day: marks appear, capped, boosted, announced ----
{
  await hook("forceMarkChance", { value: 1 });
  await hook("setRaids", { enabled: true });
  await hook("holdRaidAggro", { value: true });
  const info = await hook("raidState");
  const cycle = info.dayTicks + info.nightTicks;
  const day = 20;
  const eventsBefore = c.events.length;
  await hook("setCycleTick", { tick: day * cycle + Math.floor(info.dayTicks / 2) + 5 });
  await ff(1);
  const rs = await hook("raidState");
  const raiders = rs.mobs.filter((m) => m.groupId !== null && !m.isDeserter);
  const marked = raiders.filter((m) => m.mark > 0);
  const cap = Math.max(1, Math.floor(raiders.length / 5));
  result(raiders.length > 0 && marked.length === cap, `day ${day}: ${raiders.length} raiders, ${marked.length} marked (cap ${cap})`);
  const boosted = marked.every((m) => m.maxHp === Math.round(BASE[m.kind][0] * 1.5) && m.damage === Math.round(BASE[m.kind][1] * 1.25) && m.hp === m.maxHp);
  result(boosted, `marked raiders have x1.5 hp / x1.25 damage (${marked.map((m) => `${m.kind}:${m.mark}`).join(", ")})`);
  const unboosted = raiders.filter((m) => !m.mark).every((m) => m.maxHp === BASE[m.kind][0]);
  result(unboosted, "unmarked raiders keep base hp");
  snap = await freshSnap();
  const inSnap = snap.mobs.filter((m) => m.mark);
  result(inSnap.length === marked.length, `snapshot shows ${inSnap.length} marked mobs`);
  await sleep(100);
  const leads = c.events.slice(eventsBefore).filter((e) => e.category === "raid" && /-marked .* leads the raid/.test(e.text));
  result(leads.length === 1 && leads[0].text.includes(`${marked.length - 1} more Hunger-marked`), `one raid toast for the marked elites: ${leads.map((e) => e.text).join(" | ")}`);
  await hook("forceMarkChance", { value: null });
}

send({ type: "pause" });
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
