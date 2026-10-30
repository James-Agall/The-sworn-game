// Scripted test: creative mode (QUEUE.md "CREATIVE MODE"). Needs a private server with COLONY_TEST_HOOKS=1 and a
// scratch COLONY_SAVE_DIR (the runner gives both), no other players. Checks: creative commands are refused in a
// normal game; a restart {creative: true} is the only way in; stock stays infinite after spending; building is
// instant; spawn counts; a Test clan unit is attacked only by force-attack or with "allow attacking" on; a
// creative game saves (manual and auto) only to the "creative" slot.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let welcome = null;
let snap = null;
let fails = 0;
const tiles = [];
let W = 0;
const results = [];
const hooks = new Map();
let saveResult = null;
let saveList = null;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const KNIGHT_POST = 5;
const send = (m) => ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (fn()) return true;
  return !!fn();
};
const creative = async (msg) => {
  const n = results.length;
  send(msg);
  await until(() => results.length > n, 3000);
  return results[n] ?? null;
};
const hook = async (op, args = {}) => {
  hooks.delete(op);
  send({ type: "testHook", op, ...args });
  await until(() => hooks.has(op), 3000);
  return hooks.get(op);
};

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    welcome = m;
    snap = null;
    W = m.worldTilesX;
    tiles.length = 0;
    tiles.push(...m.tiles);
  } else if (m.type === "snapshot") snap = m;
  else if (m.type === "tileUpdate") tiles[m.tileY * W + m.tileX] = m.tile;
  else if (m.type === "creativeResult") results.push(m);
  else if (m.type === "testHookResult") hooks.set(m.op, m);
  else if (m.type === "saveResult") saveResult = m;
  else if (m.type === "saveList") saveList = m.saves;
});

await new Promise((r) => ws.on("open", r));
await until(() => welcome && snap);
const me = () => snap.players.find((p) => p.id === welcome.id);

// 1. A normal game refuses every creative command.
result(!welcome.creative, `normal world: welcome.creative=${welcome.creative}`);
let r = await creative({ type: "creativeSpawn", side: "own", kind: "knight", count: 10, x: me().x, y: me().y });
result(r && !r.ok && !snap.colonists.some((c) => c.kind === "knight"), `normal game refuses creativeSpawn (${r?.text})`);
r = await creative({ type: "creativeSet", op: "godmode", on: true });
result(r && !r.ok, `normal game refuses creativeSet (${r?.text})`);
// A setDifficulty never turns creative on.
send({ type: "setDifficulty", difficulty: "normal" });
await sleep(200);
r = await creative({ type: "creativeSet", op: "heal" });
result(r && !r.ok, "still refused after setDifficulty");
// A normal save in slot 1 (it must survive the creative game).
saveResult = null;
send({ type: "saveGame", slot: "slot1" });
await until(() => saveResult);
result(saveResult?.ok && saveResult.slot === "slot1", `normal save went to ${saveResult?.slot}`);

// 2. New game, creative.
welcome = null;
send({ type: "restart", difficulty: "normal", creative: true });
await until(() => welcome && snap && snap.creative);
result(welcome?.creative === true && !!snap?.creative, `restart {creative: true}: welcome.creative=${welcome?.creative}, snapshot.creative=${JSON.stringify(snap?.creative)}`);
result(snap.wood >= 999999 && snap.gold >= 999999 && snap.iron >= 999999, `infinite stock: wood ${snap.wood} gold ${snap.gold} iron ${snap.iron}`);

// 3. Spend (a Knight Post in reach): built at once, stock unchanged.
const p = me();
const px = Math.floor(p.x / TILE), py = Math.floor(p.y / TILE);
let spot = null;
for (let dx = -2; dx <= 2 && !spot; dx++) for (let dy = -2; dy <= 2 && !spot; dy++) {
  const x = px + dx, y = py + dy;
  if ((dx || dy) && tiles[y * W + x] === 0 && Math.hypot(x * TILE + 16 - p.x, y * TILE + 16 - p.y) <= TILE * 2.5) spot = { x, y };
}
if (spot) {
  send({ type: "setTile", tileX: spot.x, tileY: spot.y, tile: KNIGHT_POST });
  await until(() => tiles[spot.y * W + spot.x] === KNIGHT_POST, 3000);
  result(tiles[spot.y * W + spot.x] === KNIGHT_POST, `Knight Post built instantly (tile ${tiles[spot.y * W + spot.x]})`);
  await sleep(200);
  result(snap.wood >= 999999 && snap.iron >= 999999, `stock after building: wood ${snap.wood} iron ${snap.iron}`);
  result((snap.populationCap ?? 0) >= 9999, `no population cap (${snap.populationCap})`);
} else result(false, "no empty tile in reach");
send({ type: "buyWithGold", item: "tools" });
await sleep(200);
result(snap.gold >= 999999, `gold after buying: ${snap.gold}`);

// 4. Spawn counts.
const ax = p.x + 6 * TILE, ay = p.y;
r = await creative({ type: "creativeSpawn", side: "own", kind: "knight", count: 10, x: ax, y: ay, formation: "line", gear: 3 });
const ownIds = r?.ids ?? [];
result(r?.ok && ownIds.length === 10, `spawn 10 own knights: ${ownIds.length}`);
await sleep(200);
result(snap.colonists.filter((c) => ownIds.includes(c.id) && c.armourTier === 3).length === 10, "they wear tier 3 gear");
r = await creative({ type: "creativeSpawn", side: "enemy", kind: "goblin", count: 100, x: p.x - 12 * TILE, y: p.y, formation: "block" });
result(r?.ok && r.ids.length >= 90, `spawn 100 goblins: ${r?.ids?.length}`);
r = await creative({ type: "creativeSet", op: "killMobs" });
await sleep(200);
result(r?.ok && snap.mobs.filter((m) => !m.kind.startsWith("town")).length === 0, `killMobs: ${r?.killed} killed, ${snap.mobs.length} mobs left`);

// 5. A Test clan dummy right next to the knights: left alone with the toggle off ...
r = await creative({ type: "creativeSpawn", side: "neutral", kind: "knight", count: 1, x: ax + 6 * TILE, y: ay });
const dummyId = r?.ids?.[0];
result(!!dummyId, "spawned a Test clan dummy knight");
await sleep(3000);
let dummy = snap.colonists.find((c) => c.id === dummyId);
result(dummy && dummy.hp === dummy.maxHp && dummy.clan > 0, `toggle off: dummy untouched (hp ${dummy?.hp}/${dummy?.maxHp}, clan ${dummy?.clan})`);
// ... until force-attacked.
r = await creative({ type: "creativeSet", op: "forceAttack", unitIds: ownIds.slice(-3), targetType: "c", targetId: dummyId });
result(r?.ok && r.units === 3, `forceAttack: ${r?.text}`);
await until(() => { const d = snap.colonists.find((c) => c.id === dummyId); return !d || d.hp < d.maxHp; }, 8000);
dummy = snap.colonists.find((c) => c.id === dummyId);
result(!dummy || dummy.hp < dummy.maxHp, `force-attack hits the dummy (hp ${dummy?.hp ?? "dead"})`);
if (dummy && dummy.hp >= dummy.maxHp) console.log("  debug:", JSON.stringify(snap.colonists.filter((c) => ownIds.slice(-3).includes(c.id) || c.id === dummyId).map((c) => [c.kind, Math.round(c.x), Math.round(c.y), c.state, c.hp, c.clan])));
// With "allow attacking neutral units" on, the knights pick a second dummy themselves.
r = await creative({ type: "creativeSpawn", side: "neutral", kind: "archer", count: 1, x: ax - 6 * TILE, y: ay });
const dummy2 = r?.ids?.[0];
await sleep(2000);
let d2 = snap.colonists.find((c) => c.id === dummy2);
result(d2 && d2.hp === d2.maxHp, "second dummy untouched with the toggle off");
r = await creative({ type: "creativeSet", op: "allowAttack", on: true });
result(r?.ok && snap && (await until(() => snap.creative?.allowAttack === true, 2000)), "allowAttack on");
await until(() => { const d = snap.colonists.find((c) => c.id === dummy2); return !d || d.hp < d.maxHp; }, 10000);
d2 = snap.colonists.find((c) => c.id === dummy2);
result(!d2 || d2.hp < d2.maxHp, `toggle on: knights attack the Test clan unit on their own (hp ${d2?.hp ?? "dead"})`);
r = await creative({ type: "creativeSet", op: "clearNeutrals" });
result(r?.ok, `clearNeutrals: ${r?.text}`);

// 6. Saves: manual and auto go to the "creative" slot; slot 1 and the autosave are untouched (save list).
const listNow = async () => {
  saveList = null;
  send({ type: "listSaves" });
  await until(() => saveList);
  return Object.fromEntries((saveList ?? []).map((s) => [s.slot, s]));
};
const before = await listNow();
saveResult = null;
send({ type: "saveGame", slot: "slot1" });
await until(() => saveResult);
result(saveResult?.ok && saveResult.slot === "creative", `creative manual save went to ${saveResult?.slot}`);
const mid = await listNow();
const cyc = await hook("raidState");
await sleep(1100);
await hook("setCycleTick", { tick: cyc.dayTicks + cyc.nightTicks - 3 });
let after = mid;
await until(() => false, 1500);
after = await listNow();
result(!!after.creative && after.creative.savedAt !== mid.creative?.savedAt && after.creative.creative === true && after.creative.label === "Creative",
  `dawn autosave wrote the creative slot (${JSON.stringify(after.creative)})`);
result(JSON.stringify(after.autosave) === JSON.stringify(before.autosave), `autosave slot untouched (${after.autosave?.savedAt ?? "none"})`);
result(!!before.slot1 && after.slot1?.savedAt === before.slot1.savedAt, "slot 1 untouched");

// 7. Back to a normal game: creative off again.
welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => welcome && snap);
r = await creative({ type: "creativeSet", op: "heal" });
result(!welcome.creative && r && !r.ok && !snap.creative && snap.wood < 999999, `plain restart is a normal game again (wood ${snap.wood})`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL(S)`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
