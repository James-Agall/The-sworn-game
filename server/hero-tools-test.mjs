// Scripted test: Stardew phase 5a, hero tools on tiles (ROADMAP "Stardew layer — phase 5a"). The hero tills grass into
// a hero plot (hoe), sows it (a seed bag item is used up), waters it (the can's charges; full-speed growth vs half for
// an unwatered plot), harvests a ripe crop by hand and with a scythe into the pack, refills the can at water, chops a
// tree with the axe (one yield per use), the tool gates (a missing scythe), energy drain / half-speed work at 0 /
// recovery by resting and eating, a till inside a growing zone (a zone tile, not a plot), and save / load of plots,
// energy and water. Needs a FRESH private server with gates ON (no COLONY_UNLOCK_ALL): `npm test -- hero-tools`.
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
const T = { Empty: 0, Tree: 2, Water: 35 };
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
const life = (args = {}) => hook("heroLife", args);
const zs = (args = {}) => hook("zoneState", args);
const ff = (ticks) => hook("fastForward", { ticks });
const items = async () => (await hook("progression", {})).items ?? {};
const count = (it, id) => (Array.isArray(it[id]) ? it[id].reduce((a, b) => a + b, 0) : it[id] ?? 0);
const plotAt = (s, x, y) => s.plots.find((p) => p.x === x && p.y === y);
const eventsSince = (n) => c.events.slice(n).join(" | ");

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
await hook("setStock", { stock: { wood: 200, rock: 200, grain: 50 } });
await life({ needs: true, energy: 100, water: 20, pack: {}, food: 100, rest: 100, skills: {} });

const W = c.welcome.worldTilesX;
const tc = (await hook("constructionState")).townCenters[0];
// A clear patch well away from the Town Center (villagers in talking range would take E first).
const O = { x: Math.max(4, Math.min(W - 12, tc.x + (tc.x < W / 2 ? 14 : -18))), y: Math.max(4, Math.min(W - 8, tc.y + 6)) };
for (let y = O.y - 2; y <= O.y + 3; y++) for (let x = O.x - 2; x <= O.x + 8; x++) await setTile(x, y, T.Empty);
const H = { x: O.x + 2, y: O.y + 1 };
const stand = (x, y) => hook("teleportPlayer", { x: x * TILE + 16, y: y * TILE + 16 });
await stand(H.x, H.y);
const A = { x: H.x + 1, y: H.y };
const B = { x: H.x - 1, y: H.y };

// 0. Starter kit: hoe, watering can, wheat seeds (plus the axe and pick).
let it = await items();
result(count(it, "hoe") === 1 && count(it, "wateringCan") === 1 && count(it, "wheatSeeds") === 8 && count(it, "stoneAxe") === 1, `starter kit ${JSON.stringify(it)}`);

// 1. Hoe tills grass into a hero plot (energy -3, farming XP).
let L = await life({ use: { tool: "hoe", tx: A.x, ty: A.y } });
result(L.tool?.act === "till", `hoe started tilling (${JSON.stringify(L.tool)}, snap ${JSON.stringify(L.snap.gather)})`);
await ff(25);
let s = await zs();
L = await life();
result(plotAt(s, A.x, A.y)?.stage === 1 && plotAt(s, A.x, A.y)?.clan === 0 && !plotAt(s, A.x, A.y)?.inZone, `tilled into a hero plot ${JSON.stringify(plotAt(s, A.x, A.y))}`);
result(L.life.energy === 97 && (L.life.skills.farming ?? 0) > 0, `till cost 3 energy (${L.life.energy}) and trained farming (${L.life.skills.farming})`);
// Out of reach: two tiles away does nothing.
await life({ use: { tool: "hoe", tx: H.x + 3, ty: H.y } });
L = await life();
result(L.tool === null, `a tile two away is out of reach`);

// 2. Seed bag sows (one wheat seed used); a second plot sown, not watered.
await life({ use: { tool: "seeds", tx: A.x, ty: A.y, crop: "wheat" } });
await ff(15);
await life({ use: { tool: "hoe", tx: B.x, ty: B.y } });
await ff(25);
await life({ use: { tool: "seeds", tx: B.x, ty: B.y, crop: "wheat" } });
await ff(15);
s = await zs();
it = await items();
result(plotAt(s, A.x, A.y)?.stage === 2 && plotAt(s, A.x, A.y)?.crop === "wheat" && plotAt(s, B.x, B.y)?.stage === 2, `both plots sown with wheat`);
result(count(it, "wheatSeeds") === 6, `two seeds used (${count(it, "wheatSeeds")} left)`);
// Hemp: no hemp seeds -> refused.
let ev = c.events.length;
await life({ use: { tool: "hoe", tx: H.x, ty: H.y + 1 } });
await ff(25);
await life({ use: { tool: "seeds", tx: H.x, ty: H.y + 1, crop: "hemp" } });
await ff(15);
s = await zs();
result(plotAt(s, H.x, H.y + 1)?.stage === 1 && /No hemp seeds/.test(eventsSince(ev)), `no hemp seeds: not sown (${eventsSince(ev)})`);

// 3. Watering can: one charge, the tile counts as tended; watered grows twice as fast.
await life({ use: { tool: "wateringCan", tx: A.x, ty: A.y } });
await ff(15);
s = await zs();
L = await life();
result(plotAt(s, A.x, A.y)?.tended === true && plotAt(s, B.x, B.y)?.tended === false && L.life.water === 19, `watered A (can ${L.life.water}/20)`);
const pa0 = plotAt(s, A.x, A.y).progress;
const pb0 = plotAt(s, B.x, B.y).progress;
for (let k = 0; k < 10; k++) await zs({ tickZones: true });
s = await zs();
const ga = plotAt(s, A.x, A.y).progress - pa0;
const gb = plotAt(s, B.x, B.y).progress - pb0;
result(ga > 0 && Math.abs(ga - 2 * gb) < 1e-6, `watered grows at full speed (${ga}), unwatered at half (${gb})`);

// 4. Harvest by hand (E with no tool): grain into the pack, the plot back to tilled.
await zs({ setCropAt: { x: A.x, y: A.y, stage: 4 } });
await life({ interactWith: { tx: A.x, ty: A.y } });
L = await life();
result(L.tool?.act === "harvest" && L.tool.total === 30, `E by hand starts a slow harvest (${JSON.stringify(L.tool)}, talking ${JSON.stringify(L.talking)})`);
await ff(35);
s = await zs();
L = await life();
result((L.life.pack.grain ?? 0) >= 1 && plotAt(s, A.x, A.y)?.stage === 1, `hand harvest: ${L.life.pack.grain} grain, plot tilled again`);
// The zones snapshot lists hero plots (code: stage | watered << 3 | crop index + 1 << 4).
const snapB = s.snapshot.crops.findIndex((v, k) => k % 2 === 0 && v === B.y * W + B.x);
result(snapB >= 0 && s.snapshot.crops[snapB + 1] === (2 | (1 << 4)), `snapshot has plot B as sown wheat (${s.snapshot.crops[snapB + 1]})`);

// 5. Tool gate: no scythe in the stores -> refused; crafted by hand -> a quick harvest.
await zs({ setCropAt: { x: B.x, y: B.y, stage: 4 } });
ev = c.events.length;
await life({ use: { tool: "scythe", tx: B.x, ty: B.y } });
await ff(2);
result(/need a scythe/.test(eventsSince(ev)), `no scythe: ${eventsSince(ev)}`);
send({ type: "craftItem", recipe: "scythe" });
await ff(2);
it = await items();
result(count(it, "scythe") === 1, `scythe crafted by hand`);
const grain0 = (await life()).life.pack.grain ?? 0;
await life({ use: { tool: "scythe", tx: B.x, ty: B.y } });
L = await life();
result(L.tool?.act === "harvest" && L.tool.total === 10, `scythe harvest is quick (${L.tool?.total} ticks)`);
await ff(12);
L = await life();
result((L.life.pack.grain ?? 0) > grain0, `scythe harvest into the pack (${grain0} -> ${L.life.pack.grain})`);

// 6. Empty can refused; refill at water.
await life({ water: 0 });
await life({ use: { tool: "seeds", tx: B.x, ty: B.y, crop: "wheat" } });
await ff(15);
ev = c.events.length;
await life({ use: { tool: "wateringCan", tx: B.x, ty: B.y } });
await ff(2);
result(/can is empty/.test(eventsSince(ev)), `empty can: ${eventsSince(ev)}`);
await setTile(H.x, H.y - 1, T.Water);
await life({ use: { tool: "wateringCan", tx: H.x, ty: H.y - 1 } });
await ff(25);
L = await life();
result(L.life.water === 20, `refilled at water (${L.life.water})`);
await setTile(H.x, H.y - 1, T.Empty);

// 7. Axe: one chop per use (Space / click), energy -3.
await setTile(H.x + 1, H.y + 1, T.Tree);
await life({ energy: 50, pack: {} });
await life({ use: { tool: "axe", tx: H.x + 1, ty: H.y + 1 } });
L = await life();
result(L.gathering?.kind === "chop" && L.gathering.once, `axe starts one chop`);
await ff(70);
L = await life();
result((L.life.pack.wood ?? 0) === 2 && L.gathering === null && L.life.energy === 47, `one chop: ${L.life.pack.wood} wood, stopped, energy ${L.life.energy}`);
ev = c.events.length;
await life({ use: { tool: "pick", tx: H.x + 1, ty: H.y + 1 } });
await ff(2);
result(/No rock or ore/.test(eventsSince(ev)), `pick on a tree refused: ${eventsSince(ev)}`);

// 8. Energy 0: half-speed work (never blocked); resting and eating recover it.
await life({ energy: 0 });
await life({ use: { tool: "hoe", tx: H.x - 1, ty: H.y + 1 } });
await ff(10);
L = await life();
const left = L.tool?.left;
result(L.tool?.act === "till" && Math.abs(left - (L.tool.total - 10 * 0.5 * (1 + 0.25 * 0))) < 1e-6, `exhausted: till at half speed (${left} of ${L.tool?.total} left)`);
result(L.snap.slow?.some((x) => /Exhausted/.test(x)), `status shows exhausted (${L.snap.slow})`);
await ff(30);
s = await zs();
result(plotAt(s, H.x - 1, H.y + 1)?.stage === 1, `exhausted hero still tills`);
L = await life({ action: "rest" });
await ff(60);
L = await life();
result(L.life.energy >= 4, `resting recovers energy (${L.life.energy})`);
await life({ action: "rest" });
const e0 = (await life({ pack: { meat: 1 }, food: 40 })).life.energy;
await life({ action: "eat" });
L = await life();
result(L.life.energy > e0 && !(L.life.pack.meat > 0), `eating recovers energy (${e0} -> ${L.life.energy})`);

// 9. A till inside an own growing zone works the zone's tile (no plot; villagers may tend it).
const Z = { x: H.x + 4, y: H.y };
for (let x = Z.x; x <= Z.x + 1; x++) await setTile(x, Z.y, T.Empty);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "wheat", tiles: [Z.x, Z.y, Z.x + 1, Z.y] });
await ff(1);
await stand(Z.x - 1, Z.y);
await life({ use: { tool: "hoe", tx: Z.x, ty: Z.y } });
await ff(25);
s = await zs();
result(!plotAt(s, Z.x, Z.y) && s.stages[1] + s.stages[2] >= 1, `till in a growing zone makes a zone tile, not a plot (stages ${s.stages})`);
// Seeds in the zone sow its crop with no seed used.
const seeds0 = count(await items(), "wheatSeeds");
await life({ use: { tool: "seeds", tx: Z.x, ty: Z.y, crop: "hemp" } });
await ff(15);
s = await zs();
result(count(await items(), "wheatSeeds") === seeds0 && count(await items(), "hempSeeds") === 0 && s.stages[2] >= 1, `zone tile sown with the zone's crop, no seed used`);
await stand(H.x, H.y);

// 10. Villagers leave hero plots outside zones alone.
await zs({ setCropAt: { x: B.x, y: B.y, stage: 4 } });
for (let k = 0; k < 5; k++) await ff(200), await hook("setCycleTick", { tick: 0 });
s = await zs();
result(plotAt(s, B.x, B.y)?.stage === 4, `ripe hero plot left for the hero (stage ${plotAt(s, B.x, B.y)?.stage})`);

// 11. Save / load keeps plots (stage, crop, water state), energy and the can.
await life({ energy: 33, water: 7 });
s = await zs();
const sig = (q) => JSON.stringify(q.plots.map((p) => [p.x, p.y, p.clan, p.stage, p.tended, p.crop]).sort());
const before = sig(s);
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await life({ use: { tool: "scythe", tx: B.x, ty: B.y } });
await ff(12);
await life({ energy: 90, water: 20 });
s = await zs();
result(sig(s) !== before, `changed after the save`);
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
await sleep(100);
s = await zs();
L = await life();
result(sig(s) === before, `loaded: hero plots the same (${s.plots.length})`);
result(Math.round(L.life.energy) === 33 && L.life.water === 7, `loaded: energy ${L.life.energy}, water ${L.life.water}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
