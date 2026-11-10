// Scripted test: modular building phase 3, zones (ROADMAP "Modular building — phase 3"). New Farm Plots are retired;
// a painted GROWING zone (wheat) is tilled, sown and tended by free villagers, ripe tiles are harvested into loose
// goods that haulers carry to the nearest matching STOCKPILE zone (filters) or, with none, to a Town Center; the
// stock gets them. Erasing, switching the crop to hemp, home / animal areas, the zones snapshot and save / load.
// Needs a FRESH private server WITHOUT COLONY_LEGACY_BUILD: `npm test -- zones` (boots one: world 80, test hooks,
// unlock-all, scratch save dir).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { Empty: 0, Tree: 2, FarmPlot: 4, CottonFarm: 24 };
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, zones: null, events: [], hook: new Map(), save: null, welcomes: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") {
    c.snap = m;
    if (m.zones) c.zones = m.zones;
  } else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const rect = (x0, y0, x1, y1) => {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(x, y);
  return out;
};
const zs = (args = {}) => hook("zoneState", args);
const edit = async (m) => {
  send({ type: "zoneEdit", ...m });
  await hook("fastForward", { ticks: 1 });
};
// Runs the sim until done(state) (or a cap), keeping it daytime.
const runUntil = async (done, maxTicks, step = 400) => {
  let s = await zs();
  for (let t = 0; t < maxTicks && !done(s); t += step) {
    if ((await hook("respawnState"))?.isNight) await hook("setCycleTick", { tick: 0 });
    await hook("fastForward", { ticks: step });
    s = await zs();
  }
  return s;
};

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setInstantBuild", { enabled: true });
await hook("setCycleTick", { tick: 0 });

const tc = (await hook("constructionState")).townCenters[0];
const O = { x: tc.x + 4, y: tc.y - 6 };
for (let y = O.y; y < O.y + 14; y++) for (let x = O.x; x < O.x + 20; x++) await setTile(x, y, T.Empty);
await hook("teleportPlayer", { x: (O.x + 10) * TILE + 16, y: (O.y + 13) * TILE + 16 });

// 1. New Farm Plots are retired (a growing zone replaces them).
const ev0 = c.events.length;
await hook("teleportPlayer", { x: (O.x + 18) * TILE + 16, y: (O.y + 12) * TILE + 16 });
send({ type: "setTile", tileX: O.x + 17, tileY: O.y + 12, tile: T.FarmPlot });
await hook("fastForward", { ticks: 1 });
let st = await hook("structureState", { at: [{ x: O.x + 17, y: O.y + 12 }] });
result(st.tiles[0] === T.Empty && c.events.slice(ev0).some((e) => /retired/.test(e)), `new Farm Plot refused: ${c.events.slice(ev0).join(" | ")}`);
await hook("teleportPlayer", { x: (O.x + 10) * TILE + 16, y: (O.y + 13) * TILE + 16 });

// 2. Paint a 4 x 2 wheat zone (a tree inside is skipped), erase 2 tiles.
await setTile(O.x + 4, O.y + 1, T.Tree);
await edit({ op: "paint", kind: "growing", crop: "wheat", tiles: rect(O.x + 1, O.y + 1, O.x + 4, O.y + 2) });
let s = await zs();
const grow = s.zones.find((z) => z.kind === "growing");
result(!!grow && grow.size === 7 && grow.crop === "wheat" && s.stages[0] === 7, `growing zone painted: ${grow?.size} tiles (tree skipped), crop ${grow?.crop}`);
await edit({ op: "erase", tiles: rect(O.x + 4, O.y + 1, O.x + 4, O.y + 2) });
s = await zs();
result(s.zones.find((z) => z.id === grow.id)?.size === 6, `erased the column: ${s.zones.find((z) => z.id === grow.id)?.size} tiles`);
await setTile(O.x + 4, O.y + 1, T.Empty);
for (let i = 0; i < 300 && !c.zones?.zones.some((z) => z.id === grow.id); i++) await sleep(10);
result(c.zones?.zones.some((z) => z.id === grow.id && z.kind === "growing"), `zones snapshot sent to the client (${c.zones?.zones.length} zones)`);

// 3. Free villagers till, sow and tend it.
await hook("peopleState", { spawn: 4 });
s = await zs();
result(s.freeVillagers >= 4, `${s.freeVillagers} free villagers to work zones`);
s = await runUntil((q) => q.stages[2] + q.stages[3] === 6 && q.tended === 6, 12000);
result(s.stages[2] + s.stages[3] === 6, `tilled and sown: stages ${s.stages.join("/")}`);
result(s.tended === 6, `tended: ${s.tended}/6`);

// 4. A stockpile that takes only wood: the ripe wheat is harvested and hauled to the Town Center (no food stockpile).
await edit({ op: "paint", kind: "stockpile", tiles: rect(O.x + 8, O.y + 1, O.x + 10, O.y + 3) });
s = await zs();
const pile = s.zones.find((z) => z.kind === "stockpile");
await edit({ op: "setFilters", zoneId: pile.id, filters: ["wood"] });
s = await zs();
result(JSON.stringify(s.zones.find((z) => z.id === pile.id).filters) === '["wood"]', `stockpile filters: ${s.zones.find((z) => z.id === pile.id).filters}`);
const grain0 = s.stock.grain;
await zs({ setCrops: { stage: 4, tended: true, zoneId: grow.id } });
s = await runUntil((q) => q.stages[4] === 0 && q.piles.every((p) => p.n < 1) && q.jobs.every((j) => !j.carry), 12000);
const got1 = s.stock.grain - grain0;
result(s.stages[4] === 0 && s.stages[1] + s.stages[2] + s.stages[3] === 6, `harvested all 6 (stages ${s.stages.join("/")})`);
result(got1 >= 12 && (s.zones.find((z) => z.id === pile.id).stored.grain ?? 0) === 0, `hauled to the Town Center: +${got1} grain (6 x ${(16.36 / 6).toFixed(2)} per tile, whole units), wood-only stockpile got none`);

// 5. Food filter on: the next harvest goes into the stockpile (and the stock).
await edit({ op: "setFilters", zoneId: pile.id, filters: ["food", "cloth"] });
await hook("setCycleTick", { tick: 0 });
await zs({ setCrops: { stage: 4, tended: true, zoneId: grow.id } });
const grain1 = (await zs()).stock.grain;
s = await runUntil((q) => q.stages[4] === 0 && q.piles.every((p) => p.n < 1) && q.jobs.every((j) => !j.carry), 12000);
const stored = s.zones.find((z) => z.id === pile.id).stored.grain ?? 0;
result(stored >= 12 && s.stock.grain - grain1 === stored, `hauled into the food stockpile: stored ${stored}, stock +${s.stock.grain - grain1}`);
result(s.snapshot.zones.find((z) => z.id === pile.id)?.stored?.grain === Math.min(stored, s.stock.grain), `snapshot stockpile count ${s.snapshot.zones.find((z) => z.id === pile.id)?.stored?.grain}`);

// 6. Switch the crop to hemp: sown tiles go back to tilled; a hemp harvest gives cloth (cotton).
await edit({ op: "setCrop", zoneId: grow.id, crop: "hemp" });
s = await zs();
result(s.zones.find((z) => z.id === grow.id).crop === "hemp" && s.stages[2] + s.stages[3] + s.stages[4] === 0, `crop -> hemp, stages ${s.stages.join("/")}`);
await hook("setCycleTick", { tick: 0 });
await zs({ setCrops: { stage: 4, tended: true, zoneId: grow.id } });
const cotton0 = (await zs()).stock.cotton;
s = await runUntil((q) => q.stages[4] === 0 && q.piles.every((p) => p.n < 1) && q.jobs.every((j) => !j.carry), 12000);
result(s.stock.cotton - cotton0 >= 6 * 22, `hemp harvest: +${s.stock.cotton - cotton0} cotton (22.5 per tile)`);

// 7. Home and animal areas; rename; delete.
await edit({ op: "paint", kind: "home", tiles: rect(O.x + 12, O.y + 1, O.x + 16, O.y + 4) });
await edit({ op: "paint", kind: "animal", tiles: rect(O.x + 12, O.y + 6, O.x + 14, O.y + 8) });
s = await zs();
const home = s.zones.find((z) => z.kind === "home");
await edit({ op: "rename", zoneId: home.id, name: "Village green" });
s = await zs();
result(s.zones.find((z) => z.id === home.id)?.name === "Village green" && s.zones.some((z) => z.kind === "animal" && z.size === 9), `home area renamed, animal area 9 tiles`);

// 9. Gap closure G2: stockpile capacity (40 / tile), overflow to the next stockpile with room, haulers show their
// load, the tally shrinks when the stock is spent (oldest stockpile first) and never exceeds the stock.
await edit({ op: "setFilters", zoneId: pile.id, filters: ["wood"] });
await edit({ op: "paint", kind: "stockpile", tiles: rect(O.x + 2, O.y + 8, O.x + 2, O.y + 8) });
s = await zs();
const s1 = s.zones.filter((z) => z.kind === "stockpile").sort((a, b) => b.id - a.id)[0];
await edit({ op: "paint", kind: "stockpile", tiles: rect(O.x + 8, O.y + 8, O.x + 9, O.y + 8) });
s = await zs();
const s2 = s.zones.filter((z) => z.kind === "stockpile").sort((a, b) => b.id - a.id)[0];
await edit({ op: "setFilters", zoneId: s1.id, filters: ["food"] });
await edit({ op: "setFilters", zoneId: s2.id, filters: ["food"] });
s = await zs();
result(s.zones.find((z) => z.id === s1.id).capacity === 40 && s.zones.find((z) => z.id === s2.id).capacity === 80 && s.zones.find((z) => z.id === pile.id).capacity === 360,
  `capacity 40 / tile: ${s.zones.filter((z) => z.kind === "stockpile").map((z) => `${z.size} tiles = ${z.capacity}`).join(", ")}`);
await hook("setCycleTick", { tick: 0 });
await zs({ addPile: { x: O.x + 1, y: O.y + 8, res: "grain", n: 60 } });
let sawHauler = null;
for (let t = 0; t < 3000 && !sawHauler; t += 10) {
  await hook("fastForward", { ticks: 10 });
  const q = await zs();
  if (q.haulers.length > 0) sawHauler = q.haulers[0];
}
result(sawHauler?.haul === "grain", `a hauler shows its load in the snapshot: ${JSON.stringify(sawHauler)}`);
s = await runUntil((q) => q.piles.every((p) => p.n < 1) && q.jobs.every((j) => !j.carry), 12000);
const st1 = s.zones.find((z) => z.id === s1.id);
const st2 = s.zones.find((z) => z.id === s2.id);
result((st1.stored.grain ?? 0) === 40 && (st2.stored.grain ?? 0) === 20, `60 grain: the near 1-tile stockpile fills to ${st1.stored.grain ?? 0}/40, the overflow goes on: ${st2.stored.grain ?? 0} in the next`);
const snapS1 = s.snapshot.zones.find((z) => z.id === s1.id);
result(snapS1?.capacity === 40 && snapS1?.used === 40, `zone list fill bar data: ${snapS1?.used}/${snapS1?.capacity}`);
const tally = (q) => q.zones.filter((z) => z.kind === "stockpile").reduce((n, z) => n + (z.stored.grain ?? 0), 0);
s = await zs({ tickZones: true });
const t0g = tally(s);
const oldest0 = s.zones.find((z) => z.id === pile.id).stored.grain ?? 0;
await hook("setStock", { stock: { grain: s.stock.grain - 25 } });
s = await zs({ tickZones: true });
result(tally(s) === t0g - 25 && (s.zones.find((z) => z.id === pile.id).stored.grain ?? 0) === Math.max(0, oldest0 - 25), `spending 25 grain shrinks the tallies ${t0g} -> ${tally(s)} (oldest stockpile first: ${oldest0} -> ${s.zones.find((z) => z.id === pile.id).stored.grain ?? 0})`);
await hook("setStock", { stock: { grain: 10 } });
s = await zs({ tickZones: true });
result(tally(s) <= 10, `stock down to 10: tallies ${tally(s)} (never above the stock)`);

// 8. Save / load keeps zones, crops, piles and tallies.
await zs({ setCrops: { stage: 3, tended: false, zoneId: grow.id } });
s = await zs();
const sig = (q) => JSON.stringify([q.zones.map((z) => [z.id, z.kind, z.name, z.crop, z.filters, z.size, z.stored]), q.stages, q.tended]);
const before = sig(s);
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await edit({ op: "delete", zoneId: home.id });
s = await zs();
result(!s.zones.some((z) => z.id === home.id), `home area deleted`);
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
s = await zs();
result(sig(s) === before, `loaded: zones / crops / tallies the same`);
// (Before the load the client was sent 3 zones: the home area was deleted after the save.)
for (let i = 0; i < 300 && c.zones?.zones.length !== s.zones.length; i++) await sleep(10);
result(c.zones?.zones.length === s.zones.length, `zones snapshot resent after the load (${c.zones?.zones.length})`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
