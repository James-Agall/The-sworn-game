// Scripted test: knight posts fill the settlement's garrison ceiling, Town Center spacing, camp hearths.
// Self-contained: boots its OWN 160x160 server with COLONY_TEST_HOOKS=1 on PORT (default 21610) and a
// temp COLONY_SAVE_DIR, kills its process group after. Run from server/: `node camp-hearth-test.mjs`.
//   P knight posts fill settlement 1's garrison (each post +1 knight; soldiers no longer use population, see
//     ROADMAP "Pop cap rework") until one is refused with "Settlement 1 garrison full"; a knight-post upgrade
//     (+2 base knights) is refused too.
//   S a second Town Center inside the spacing is refused (message names the distance), outside accepted.
//   H a knight ordered against a bandit camp's hearth damages it and wakes the guardians; destroying it
//     routs every guardian ("leave"), burns the campfire to rubble, pays loot, toasts, counts
//     campsDestroyed; the guardians despawn within ~60 s; the destroyed flag survives save/load.
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 21610);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, KnightPost: 5, TownCenter: 12, CastleLevel2: 17, RuinRubble: 40, PropCampfire: 41 };
const POI = new Set([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48]);
const TILE = 32;
const REACH = TILE * 2.5;
const SPACING = 24;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "camp-hearth-"));
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

// Free tiles in reach whose 4 neighbours are all empty (a post never seals another in).
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
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.tileAt(x + dx, y + dy) !== T.Empty)) continue;
      out.push({ x, y });
    }
  return out;
}

const tele = (c, tx, ty) => c.hookCall("teleportPlayer", { x: tx * TILE + 16, y: ty * TILE + 16 });

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
  await c.hookCall("setStock", { stock: { wood: 5000, rock: 5000, iron: 5000, tools: 500, grain: 2000, gold: 500 } });
  let snap = await c.freshSnap();
  const tc1 = { x: snap.townCenters[0].x, y: snap.townCenters[0].y };
  const s1 = () => ({ pop: c.snap.townCenters[0].population, cap: c.snap.townCenters[0].populationCap });

  // ---- P: knight posts fill settlement 1's garrison ----
  const knights = () => c.snap.colonists.filter((u) => u.kind === "knight").length;
  console.log("settlement 1 at start", JSON.stringify(s1()));
  let refused = null;
  let placed = 0;
  let deltasOk = true;
  const posts = [];
  for (let i = 0; i < 30 && !refused; i++) {
    const ang = i * 0.9;
    const r = 3 + (i % 4);
    await tele(c, tc1.x + Math.round(Math.cos(ang) * r), tc1.y + Math.round(Math.sin(ang) * r));
    await c.freshSnap();
    const spot = freeTilesNear(c).find((s) => Math.hypot(s.x - tc1.x, s.y - tc1.y) < 9 && Math.hypot(s.x - tc1.x, s.y - tc1.y) > 1.5);
    if (!spot) continue;
    const before = { ...s1(), k: knights(), ev: c.events.length };
    c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.KnightPost });
    await c.freshSnap();
    await c.freshSnap();
    if (c.tileAt(spot.x, spot.y) === T.KnightPost) {
      placed++;
      posts.push(spot);
      if (s1().pop !== before.pop || knights() !== before.k + 1) deltasOk = false;
    } else {
      const text = c.events.slice(before.ev).find((t) => /^Settlement/.test(t));
      if (text) refused = text;
    }
  }
  const tc = () => c.snap.townCenters[0];
  result(placed > 0 && deltasOk, `${placed} knight posts placed, each +1 knight and settlement population unchanged (now ${JSON.stringify(s1())})`);
  result(!!refused && /^Settlement 1 garrison full \(\d+\/\d+ soldiers\)/.test(refused), `knight post refused when the garrison is full: "${refused}"`);
  result(tc().garrisonBase === tc().garrisonCap && placed === tc().garrisonCap,
    `settlement 1 garrison exactly at its ceiling (${tc().garrisonBase}/${tc().garrisonCap}, ${placed} posts)`);
  // Upgrade refused (Hall of the Sworn adds 2 knights).
  {
    const p = posts[0];
    const ev = c.events.length;
    c.send({ type: "upgradeBuilding", tileX: p.x, tileY: p.y });
    await c.freshSnap();
    await c.freshSnap();
    const text = c.events.slice(ev).find((t) => /^Settlement/.test(t)) ?? "";
    result(c.tileAt(p.x, p.y) === T.KnightPost && /full/.test(text), `knight post upgrade refused at the cap: "${text}"`);
  }

  // ---- S: Town Center spacing ----
  const tcSpot = (minD, maxD) => {
    const W = c.W();
    for (let y = 6; y < W - 6; y++)
      for (let x = 6; x < W - 6; x++) {
        const d = Math.hypot(tc1.x - x, tc1.y - y);
        if (d < minD || d > maxD || c.tileAt(x, y) !== T.Empty || c.tileAt(x + 1, y) !== T.Empty) continue;
        let poi = false;
        for (let dy = -7; dy <= 7 && !poi; dy++) for (let dx = -7; dx <= 7; dx++) if (POI.has(c.tileAt(x + dx, y + dy))) poi = true;
        if (!poi) return { x, y };
      }
    return null;
  };
  const near = tcSpot(16, 20);
  {
    await tele(c, near.x + 1, near.y);
    const ev = c.events.length;
    c.send({ type: "setTile", tileX: near.x, tileY: near.y, tile: T.TownCenter });
    await c.freshSnap();
    await c.freshSnap();
    const text = c.events.slice(ev).join("|");
    result(c.tileAt(near.x, near.y) !== T.TownCenter && new RegExp(`at least ${SPACING} tiles`).test(text), `Town Center ${Math.hypot(near.x - tc1.x, near.y - tc1.y).toFixed(1)} tiles away refused: "${text}"`);
  }
  let tc2 = null;
  for (let tries = 0; tries < 30 && !tc2; tries++) {
    const spot = tcSpot(SPACING + 1 + tries, SPACING + 4 + tries);
    if (!spot) break;
    await tele(c, spot.x + 1, spot.y);
    c.send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: T.TownCenter });
    await c.freshSnap();
    await c.freshSnap();
    if (c.tileAt(spot.x, spot.y) === T.TownCenter) tc2 = spot;
  }
  result(!!tc2 && c.snap.townCenters.length === 2, `second Town Center accepted ${tc2 ? Math.hypot(tc2.x - tc1.x, tc2.y - tc1.y).toFixed(1) : "?"} tiles away`);

  // ---- H: camp hearth ----
  let hs = await c.hookCall("hearthState");
  const total = hs.hearths.length;
  const camp = hs.hearths.find((h) => !h.destroyed && h.guardians.length >= 2 && h.guardians.every((g) => !g.active));
  result(!!camp && camp.hp === 150 && camp.tile === T.PropCampfire && /bandit/.test(camp.faction), `${total} hearths; picked ${camp?.faction} camp at (${camp?.x},${camp?.y}) hp ${camp?.hp}, ${camp?.guardians.length} guardians`);
  const snapH = (await c.freshSnap()).hearths ?? [];
  result(snapH.includes(camp.y * c.W() + camp.x), "snapshot `hearths` lists it");
  // A knight next to it, ordered to attack.
  let approach = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    if (c.tileAt(camp.x + dx * 2, camp.y + dy * 2) === T.Empty) {
      approach = { x: camp.x + dx * 2, y: camp.y + dy * 2 };
      break;
    }
  }
  // Six knights (they fight the guardians the approach wakes first, then the hearth).
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const k = await c.hookCall("spawnSoldier", { kind: "knight", x: approach.x * TILE + 16 + (i % 3) * 6 - 6, y: approach.y * TILE + 16 + Math.floor(i / 3) * 6 - 3 });
    if (k.id) ids.push(k.id);
  }
  c.send({ type: "commandAttackHearth", unitIds: ids, tileX: camp.x, tileY: camp.y });
  let hit = null;
  for (let i = 0; i < 300 && !hit; i++) {
    await sleep(100);
    const st = await c.hookCall("hearthState");
    const h = st.hearths.find((x) => x.siteId === camp.siteId);
    if (h.hp < h.maxHp && st.events.some((e) => e.siteId === camp.siteId && / c:/.test(e.detail ?? ""))) hit = h;
  }
  result(!!hit, `knights damaged the hearth: hp ${hit?.hp}/${hit?.maxHp}`);
  result(!!hit && hit.guardians.every((g) => g.active), "hitting the hearth woke its guardians");
  const dmgSnap = await c.freshSnap();
  const dmgFlat = dmgSnap.damagedBuildings;
  let inDamaged = false;
  for (let i = 0; i < dmgFlat.length; i += 2) if (dmgFlat[i] === camp.y * c.W() + camp.x) inDamaged = true;
  result(inDamaged, "damaged hearth is in `damagedBuildings` (HP bar)");

  // Destroy it. The knights go first (killColonists), and two more awake guardians of the site join any
  // still alive, so the rout always has someone to rout (six knights may already have killed them all).
  await c.hookCall("killColonists", { kind: "knight" });
  for (let i = 0; i < 2; i++) await c.hookCall("spawnMob", { kind: "banditClubman", tx: camp.x + (i ? 2 : -2), ty: camp.y + 2, siteId: camp.siteId });
  const goldBefore = (await c.hookCall("goalState")).stock.gold;
  const ev = c.events.length;
  const d = await c.hookCall("damageHearth", { siteId: camp.siteId, amount: 1000 });
  hs = await c.hookCall("hearthState");
  const dead = hs.hearths.find((x) => x.siteId === camp.siteId);
  const tactics = await c.hookCall("tacticsState");
  const goal = await c.hookCall("goalState");
  await c.freshSnap();
  await c.freshSnap();
  const toast = c.events.slice(ev).find((t) => /camp breaks and scatters/.test(t)) ?? "";
  result(d.destroyed === true && dead.destroyed && dead.tile === T.RuinRubble && c.tileAt(camp.x, camp.y) === T.RuinRubble, "hearth destroyed, campfire burnt to rubble");
  result(dead.guardians.length > 0 && dead.guardians.every((g) => g.tactic === "leave"), `all ${dead.guardians.length} guardians rout (leave): ${dead.guardians.map((g) => g.tactic).join(",")}`);
  result(tactics.events.some((e) => e.regiment === camp.siteId && e.type === "rout"), "rout went through startRout (tactics event)");
  const loot = 15 * camp.garrison;
  result(goal.stock.gold - goldBefore === loot, `loot ${goal.stock.gold - goldBefore} gold (= 15 x garrison ${camp.garrison})`);
  result(/^The bandit camp breaks and scatters!/.test(toast), `toast: "${toast}"`);
  result(hs.campsDestroyed === 1 && goal.campsDestroyed === 1, `campsDestroyed ${hs.campsDestroyed}`);
  result(!(c.snap.hearths ?? []).includes(camp.y * c.W() + camp.x), "snapshot `hearths` drops it");
  // Fled guardians are gone within ~60 s.
  await c.hookCall("fastForward", { ticks: 65 * 20 });
  hs = await c.hookCall("hearthState");
  const after = hs.hearths.find((x) => x.siteId === camp.siteId);
  result(after.guardians.length === 0, `guardians despawned after 65 s (${after.guardians.length} left)`);

  // Save / load keeps the destroyed flag (and every other hearth).
  c.send({ type: "pause" });
  await sleep(300);
  c.send({ type: "saveGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
  await c.hookCall("damageHearth", { siteId: hs.hearths.find((x) => !x.destroyed).siteId, amount: 10 });
  c.send({ type: "loadGame", slot: "slot1" });
  for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
  await sleep(500);
  const loaded = await c.hookCall("hearthState");
  const lh = loaded.hearths.find((x) => x.siteId === camp.siteId);
  result(
    c.saves[0]?.ok && c.saves[1]?.ok && lh?.destroyed === true && loaded.campsDestroyed === 1 && loaded.hearths.length === total &&
      loaded.hearths.filter((x) => !x.destroyed).every((x) => x.hp === x.maxHp),
    `save/load: destroyed flag kept, campsDestroyed ${loaded.campsDestroyed}, ${loaded.hearths.length}/${total} hearths`
  );
} finally {
  killServer();
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
