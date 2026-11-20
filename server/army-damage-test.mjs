// Scripted test: army cluster synergy (armyDamageMultiplier). A guard's hit deals
// base damage x (1 + 0.05 per army building or Blacksmith in the 8 tiles around its own post).
// Deterministic (no raids, no night wait, no walking): test hooks stamp the neighbour tiles (setTileRaw), put a
// soldier on an empty tile (spawnSoldier: its post is that tile) and drop an orc next to it (spawnMob). Four
// isolated 5x5 sites, far apart and away from villagers:
//   L  knight, nothing adjacent                          -> x1.00 (12 dmg)
//   K  knight, Militia Post + Archer Post + Blacksmith   -> x1.15 (13.8 dmg)
//   M  militia, Knight Post + Blacksmith                 -> x1.10
//   A  archer, Knight Post + Blacksmith                  -> x1.10
// Black-box measurement: every snapshot's attack effects are matched to their attacker (the one colonist standing at
// effect.from) and target (the mob that stood at effect.to in the previous snapshot). For every mob hit exactly once
// in a tick and still alive afterwards, the hp drop is that single hit's damage, compared with base(kind) x
// multiplier computed from the tiles around the attacker's post.
// Needs COLONY_TEST_HOOKS=1 and a fresh server with no other players; run with COLONY_WORLD_SIZE=80.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const info = (msg) => console.log(`info [${el()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, FarmPlot: 4, KnightPost: 5, ArcherPost: 6, Blacksmith: 26, MilitiaPost: 32 };
// Server isMilitaryTile: KnightPost, CastleLevel2/3, ArcherPost, MilitiaPost, MilitiaCamp2/3.
const MILITARY = new Set([5, 17, 18, 6, 32, 33, 34]);
const TILE = 32;
const BASE_DAMAGE = { knight: 12, militia: 6, archer: 8 }; // level-1 stats (KNIGHT_LEVEL_STATS[0], MILITIA_LEVEL_STATS[0], ARCHER_DAMAGE)

function connect() {
  const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, prev: null, tiles: [], tileUpdates: [], onSnap: null };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") {
      c.welcome = m;
      c.tiles = [...m.tiles];
    } else if (m.type === "snapshot") {
      c.prev = c.snap;
      c.snap = m;
      if (c.onSnap && c.prev) c.onSnap(c.prev, m);
    } else if (m.type === "tileUpdate") {
      c.tileUpdates.push({ ...m, at: Date.now() });
      c.tiles[m.tileY * c.welcome.worldTilesX + m.tileX] = m.tile;
    }
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.me = () => c.snap.players.find((p) => p.id === c.welcome.id);
  c.meTile = () => ({ x: Math.floor(c.me().x / TILE), y: Math.floor(c.me().y / TILE) });
  c.W = () => c.welcome.worldTilesX;
  c.H = () => c.welcome.worldTilesY;
  c.inBounds = (x, y) => x >= 0 && y >= 0 && x < c.W() && y < c.H();
  c.tileAt = (x, y) => c.tiles[y * c.W() + x];
  c.walkable = (x, y) => c.inBounds(x, y) && (c.tileAt(x, y) === T.Empty || c.tileAt(x, y) === T.FarmPlot);
  c.ready = async () => {
    await new Promise((r) => c.ws.on("open", r));
    while (!c.welcome || !c.snap) await sleep(20);
  };
  return c;
}

// Server-equivalent: bonus accumulated with += 0.05 per qualifying neighbour, then 1 + bonus.
function armyMult(c, tx, ty) {
  let bonus = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (!c.inBounds(tx + dx, ty + dy)) continue;
    const t = c.tileAt(tx + dx, ty + dy);
    if (MILITARY.has(t) || t === T.Blacksmith) bonus += 0.05;
  }
  return 1 + bonus;
}

const kindClass = (k) => (k === "knight" ? "knight" : k === "archer" ? "archer" : k === "militia" ? "militia" : null);


const hook = (c, msg) =>
  new Promise((resolve) => {
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "testHookResult" && m.op === msg.op) { c.ws.off("message", onMsg); resolve(m); }
    };
    c.ws.on("message", onMsg);
    c.send({ type: "testHook", ...msg });
  });
const setTileRaw = (c, x, y, tile) => hook(c, { op: "setTileRaw", tx: x, ty: y, tile });

// Greedy pick of `n` sites: a 5x5 all-Empty box (no army building / Blacksmith within 4 tiles), no colonist or
// player within 6 tiles, each at least 12 tiles from the others.
function findSites(c, n) {
  const W = c.W(), H = c.H();
  const found = [];
  const near = (x, y, r) => [...c.snap.colonists, ...c.snap.players].some((k) => Math.abs(k.x / TILE - x) <= r && Math.abs(k.y / TILE - y) <= r);
  for (let y = 6; y < H - 6; y++)
    for (let x = 6; x < W - 6 && found.length < n; x++) {
      if (found.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) < 12) || near(x, y, 6)) continue;
      let ok = true;
      for (let dx = -4; dx <= 4 && ok; dx++)
        for (let dy = -4; dy <= 4 && ok; dy++) {
          const t = c.tileAt(x + dx, y + dy);
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2 ? t !== T.Empty : MILITARY.has(t) || t === T.Blacksmith) ok = false;
        }
      if (ok) found.push({ x, y });
    }
  return found;
}

const a = connect();
await a.ready();
info(`connected; wood=${a.snap.wood} iron=${a.snap.iron} rock=${a.snap.rock} mobs=${a.snap.mobs.length} night=${a.snap.isNight}`);

const sites = findSites(a, 4);
result(sites.length === 4, `four isolated open sites found (${sites.map((p) => `(${p.x},${p.y})`).join(" ")})`);
if (sites.length < 4) process.exit(1);
// post = the soldier's own tile; neighbours stamped around it.
const posts = {
  L: { ...sites[0], kind: "knight", around: [] },
  K: { ...sites[1], kind: "knight", around: [[-1, 0, T.Blacksmith], [1, 0, T.MilitiaPost], [0, 1, T.ArcherPost]] },
  M: { ...sites[2], kind: "militia", around: [[-1, 0, T.Blacksmith], [1, 0, T.KnightPost]] },
  A: { ...sites[3], kind: "archer", around: [[-1, 0, T.Blacksmith], [1, 0, T.KnightPost]] },
};
for (const p of Object.values(posts))
  for (const [dx, dy, tile] of p.around) await setTileRaw(a, p.x + dx, p.y + dy, tile);
await sleep(400);
const mults = Object.fromEntries(Object.entries(posts).map(([n, p]) => [n, armyMult(a, p.x, p.y)]));
info(`multipliers from tiles: ${Object.entries(mults).map(([n, m]) => `${n}=${m.toFixed(2)}`).join(" ")}`);
result(Math.abs(mults.L - 1) < 1e-9 && Math.abs(mults.K - 1.15) < 1e-9 && Math.abs(mults.M - 1.1) < 1e-9 && Math.abs(mults.A - 1.1) < 1e-9,
  `layout gives L x1.00, K x1.15 (2 army + Blacksmith), M x1.10, A x1.10`);
const postName = (px, py) => Object.entries(posts).find(([, p]) => p.x === px && p.y === py)?.[0] ?? null;
for (const p of Object.values(posts)) {
  const r = await hook(a, { op: "spawnSoldier", kind: p.kind, x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
  result(!!r.id, `${p.kind} spawned on its post tile (${p.x},${p.y})`);
}

// ---- measure hits ----
const hits = []; // {post, kind, drop, expected, base}
const unmatched = { noAttacker: 0, noTarget: 0, multi: 0, killed: 0, foreign: 0, ambiguousTick: 0 };
a.onSnap = (prev, cur) => {
  if (!cur.effects?.length) return;
  const byMob = new Map();
  let ambiguousTick = false;
  for (const e of cur.effects) {
    const targets = prev.mobs.filter((m) => m.x === e.toX && m.y === e.toY);
    const fromColonist = cur.colonists.some((k) => k.x === e.fromX && k.y === e.fromY);
    // Mob attacks also produce effects (towards a colonist/player); only guard effects matter here. A guard
    // effect that can't be pinned to exactly one mob makes the whole tick ambiguous: skip it.
    if (targets.length !== 1) {
      unmatched.noTarget++;
      if (fromColonist) ambiguousTick = true;
      continue;
    }
    const target = targets[0];
    if (!byMob.has(target.id)) byMob.set(target.id, []);
    byMob.get(target.id).push(e);
  }
  if (ambiguousTick) { unmatched.ambiguousTick++; return; }
  for (const [mobId, effs] of byMob) {
    if (effs.length !== 1) { unmatched.multi++; continue; }
    const e = effs[0];
    // Exactly one colonist must stand at effect.from: units of different posts can overlap exactly.
    const attackers = cur.colonists.filter((k) => k.x === e.fromX && k.y === e.fromY);
    if (attackers.length !== 1) { unmatched.noAttacker++; continue; }
    const attacker = attackers[0];
    const post = postName(attacker.postX, attacker.postY);
    const cls = kindClass(attacker.kind);
    if (!post || !cls) { unmatched.foreign++; continue; }
    const before = prev.mobs.find((m) => m.id === mobId);
    const after = cur.mobs.find((m) => m.id === mobId);
    if (!after) { unmatched.killed++; continue; }
    const drop = before.hp - after.hp;
    const mult = armyMult(a, attacker.postX, attacker.postY);
    hits.push({ post, kind: attacker.kind, mob: before.kind, drop, base: BASE_DAMAGE[cls], expected: BASE_DAMAGE[cls] * mult, mult });
    if (Math.abs(drop - BASE_DAMAGE[cls] * mult) > 1e-6)
      info(`MISMATCH detail: effects=${JSON.stringify(cur.effects)} prevMobs@pos=${JSON.stringify(prev.mobs.filter((m) => Math.hypot(m.x - before.x, m.y - before.y) < 40))} curMob=${JSON.stringify(after)} attackers=${JSON.stringify(cur.colonists.filter((k) => cur.effects.some((e) => e.fromX === k.x && e.fromY === k.y)))}`);
  }
};


const hitsOf = (p, kind) => hits.filter((h) => h.post === p && h.kind === kind);
const enough = () => Object.entries(posts).every(([n, p]) => hitsOf(n, p.kind).length >= 3);
// An orc two tiles east of each soldier that still needs hits and has no live orc nearby; refreshed twice a second.
const deadline = Date.now() + 60000;
while (!enough() && Date.now() < deadline) {
  for (const [n, p] of Object.entries(posts)) {
    if (hitsOf(n, p.kind).length >= 3) continue;
    const busy = a.snap.mobs.some((m) => m.kind === "orc" && Math.abs(m.x / TILE - p.x) < 6 && Math.abs(m.y / TILE - p.y) < 6);
    if (!busy) await hook(a, { op: "spawnMob", kind: "orc", tx: p.x + 2, ty: p.y });
  }
  await sleep(500);
}
info(`measured: per post ${JSON.stringify(Object.fromEntries(Object.keys(posts).map((p) => [p, hits.filter((h) => h.post === p).length])))}`);
a.onSnap = null;

for (const h of hits) info(`hit ${h.post} ${h.kind} -> ${h.mob}: drop ${h.drop.toFixed(4)} (expected ${h.expected.toFixed(4)} = ${h.base} x ${h.mult.toFixed(2)})`);
info(`skipped effects: ${JSON.stringify(unmatched)}`);
const bad = hits.filter((h) => Math.abs(h.drop - h.expected) > 1e-6);
result(hits.length > 0 && bad.length === 0, `all ${hits.length} isolated hits dealt exactly base x multiplier (mismatches: ${bad.length}${bad.length ? " " + JSON.stringify(bad.slice(0, 5)) : ""})`);
const lHits = hitsOf("L", "knight");
const kHits = hitsOf("K", "knight");
result(lHits.length > 0 && lHits.every((h) => Math.abs(h.drop - 12) < 1e-6), `lone knight (no army neighbours): ${lHits.length} hits, all 12 (${[...new Set(lHits.map((h) => +h.drop.toFixed(4)))]})`);
result(kHits.length > 0 && kHits.every((h) => Math.abs(h.drop - 13.8) < 1e-6), `clustered knight (Militia + Archer + Blacksmith adjacent): ${kHits.length} hits, all 13.8 = 12 x 1.15 (${[...new Set(kHits.map((h) => +h.drop.toFixed(4)))]})`);
const mHits = hitsOf("M", "militia"), aHits = hitsOf("A", "archer");
result(mHits.length > 0 && mHits.every((h) => Math.abs(h.drop - 6.6) < 1e-6), `clustered militia: ${mHits.length} hits, all 6.6 = 6 x 1.10`);
result(aHits.length > 0 && aHits.every((h) => Math.abs(h.drop - 8.8) < 1e-6), `clustered archer: ${aHits.length} hits, all 8.8 = 8 x 1.10`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`} in ${el()}`);
a.ws.close();
process.exit(fails === 0 ? 0 : 1);
