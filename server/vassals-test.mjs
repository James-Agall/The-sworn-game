// Scripted test: forts phase F, vassals (call to arms and tribute). Self-contained: boots its OWN 256x256
// server with COLONY_TEST_HOOKS=1 on PORT (default 22170) and a temp COLONY_SAVE_DIR, kills its process group
// after. Run from server/: `node vassals-test.mjs`.
//   V vassalise: relation 100 with no army -> refused (weaker); with knights -> vassal at dawn, tier "vassal"
//   T tribute: setTax on, at the due dawn the clan gets share x their stock / purse (share = min(0.4, 0.1 x
//     power ratio)), relation -6 x sqrt(share / 0.4)
//   C call to arms: half the guards become the clan's levies (regiment v:<siteId>, no population), take a
//     regiment order, are pulled back inside 60 tiles, march home after their day and rejoin the garrison;
//     cooldown refuses a second call; a dead levy costs relation 1
//   W weaker: setTax refused without an army; at dawn a vassal stronger than its liege breaks free
//   B breakaway below relation 70
//   S save / load keeps vassalOf, tribute state and a levy on the field
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22170);
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = 32;
const TICK = 20;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(DIR, "node_modules/.bin/tsx"), path.join(DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "vassals-test-"));
const server = spawn(TSX, ["src/index.ts"], {
  cwd: DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "256", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: "ignore",
  detached: true,
});
process.on("exit", () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
});

const allEvents = [];
const c = { ws: null, snap: null, events: [], hook: new Map(), saves: [] };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "snapshot") c.snap = { ...c.snap, ...m };
    else if (m.type === "event") {
      c.events.push(m.text);
      allEvents.push(m.text);
    }
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "saveResult") c.saves.push(m);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 6000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const saw = (re) => c.events.some((t) => re.test(t));

for (let i = 0; i < 200; i++) {
  try {
    connect();
    await new Promise((res, rej) => {
      c.ws.once("open", res);
      c.ws.once("error", rej);
    });
    break;
  } catch {
    await sleep(250);
  }
}
while (!c.snap) await sleep(20);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });
await hook("setCycleTick", { tick: TICK * 5 });

let st = null;
for (const [dx, dy] of [[0, 45], [45, 0], [0, -45], [-45, 0], [45, 45], [-45, -45]]) {
  st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 25 });
  if (st?.site) break;
}
const site = st?.site;
result(!!site, `stamped ${site?.name ?? st?.problem}`);
if (!site) process.exit(1);
const sid = site.id;
const kx = site.keepX;
const ky = site.keepY;
await tp(kx, ky + 2);
await ff(40);
const tc = c.snap.townCenters[0];
const vs = (args = {}) => hook("vassalSet", { siteId: sid, ...args });
// Clear the map's wild mobs / camp guardians so nothing interferes (the settlement's own folk stay).
const keepIds = new Set((await hook("sitesState")).sites.filter((x) => x.id === sid).flatMap((x) => x.alive.map((m) => m.id)));
await sleep(100);
for (const m of c.snap.mobs ?? []) if (!keepIds.has(m.id) && !String(m.kind).startsWith("town")) await hook("damageMob", { mobId: m.id, amount: 1e7 });

// ---- V: vassalise ----
let v = await vs({ relation: 100 });
result(v.vassalOf === null && v.clanPower < v.sitePower && saw(/would swear fealty/), `V no army: not a vassal (power ${v.clanPower} vs ${v.sitePower}, tier ${v.tier})`);
const knights = [];
for (let i = 0; i < 8; i++) knights.push((await hook("spawnSoldier", { kind: "knight", x: (tc.x + 2 + (i % 4)) * TILE + 16, y: (tc.y + 3 + Math.floor(i / 4)) * TILE + 16 })).id);
await ff(TICK * 3);
v = await vs({ dawn: true });
result(v.vassalOf === 0 && v.tier === "vassal" && saw(/swears fealty/), `V knights (power ${v.clanPower} vs ${v.sitePower}): vassal ${v.vassalOf}, tier ${v.tier}`);
await sleep(300);
const flag = (c.snap.sites ?? []).find((x) => x.num === site.num);
result(flag?.vassalOf === 0, `V snapshot sites[].vassalOf = ${flag?.vassalOf}`);

// ---- T: tribute ----
await hook("diploSet", { siteId: sid, stock: { gold: 300, grain: 100, fruit: 40, meat: 0, wool: 0, wood: 0, rock: 0, iron: 0, clothes: 0, tools: 0 } });
await hook("setStock", { stock: { gold: 0, grain: 0, fruit: 0 } });
send({ type: "setTax", tileX: kx, tileY: ky, on: true });
await sleep(200);
v = await vs({ nextTaxDay: 0 });
const ratio = v.clanPower / v.sitePower;
const share = Math.min(0.4, 0.1 * ratio);
const cost = Math.round(6 * Math.sqrt(share / 0.4) * 10) / 10;
const rel0 = v.relation;
v = await vs({ dawn: true });
const got = (await hook("setStock", { stock: {} })).stock;
result(v.vassal.tax && got.gold === Math.floor(300 * share) && got.grain === Math.floor(100 * share) && got.fruit === Math.floor(40 * share),
  `T tribute at share ${share.toFixed(3)}: +${got.gold} gold, +${got.grain} grain, +${got.fruit} fruit (their gold now ${v.stock.gold})`);
result(Math.abs(rel0 - v.relation - cost) < 0.011 && v.vassal.lastTax?.gold === got.gold && v.vassal.nextTaxDay > v.vassal.lastTax.day,
  `T relation ${rel0} -> ${v.relation} (cost ${cost}), ledger last ${v.vassal.lastTax?.gold} gold, next day ${v.vassal.nextTaxDay}`);

// ---- C: call to arms ----
const garrison0 = v.garrison;
const pop0 = c.snap.population;
const tx = kx + 15;
send({ type: "callToArms", tileX: kx, tileY: ky, x: tx * TILE + 16, y: ky * TILE + 16 });
await sleep(200);
v = await vs();
const levyIds = v.levies.map((l) => l.id);
result(v.levies.length === Math.min(garrison0, Math.max(2, Math.ceil(garrison0 / 2))) && v.garrison === garrison0 - v.levies.length && v.levies.every((l) => l.clan === 0 && ["spearman", "archer", "knight"].includes(l.kind)),
  `C ${v.levies.length} levies (${v.levies.map((l) => l.kind).join(", ")}), garrison ${garrison0} -> ${v.garrison}`);
await ff(TICK);
await sleep(300);
const reg = (c.snap.armyRegiments ?? []).find((r) => r.id === `v:${sid}`);
result(reg?.unitIds.length === levyIds.length && /Levy$/.test(reg.name) && c.snap.population === pop0, `C regiment "${reg?.name}" ${reg?.unitIds.length} units, population ${pop0} -> ${c.snap.population}`);
// A regiment order 20 tiles further south of the keep.
send({ type: "regimentOrder", regimentIds: [`v:${sid}`], order: { kind: "move", x: kx * TILE + 16, y: (ky + 20) * TILE + 16 } });
for (let i = 0; i < 8; i++) {
  await ff(TICK * 5);
  v = await vs();
  if (Math.max(...v.levies.map((l) => Math.hypot(l.x / TILE - kx, l.y / TILE - (ky + 20)))) < 4) break;
}
const dOrder = Math.max(...v.levies.map((l) => Math.hypot(l.x / TILE - kx, l.y / TILE - (ky + 20))));
result(dOrder < 6, `C levies obey a regiment order (max ${dOrder.toFixed(1)} tiles from its point)`);
// Leash: ordered 100 tiles away, they never end up beyond 60 of the keep.
// Toward the Town Center and beyond (the mobs on the way cleared first, so nobody dies in the test).
const ux = (tc.x - kx) / Math.hypot(tc.x - kx, tc.y - ky);
const uy = (tc.y - ky) / Math.hypot(tc.x - kx, tc.y - ky);
const clamp = (n) => Math.max(2, Math.min(253, Math.round(n)));
for (const d of [30, 55]) {
  await tp(clamp(kx + ux * d), clamp(ky + uy * d));
  await ff(2);
  await sleep(300);
  for (const m of c.snap.mobs ?? []) if (!keepIds.has(m.id) && !String(m.kind).startsWith("town")) await hook("damageMob", { mobId: m.id, amount: 1e7 });
}
await tp(kx, ky + 2);
send({ type: "regimentOrder", regimentIds: [`v:${sid}`], order: { kind: "move", x: clamp(kx + ux * 100) * TILE + 16, y: clamp(ky + uy * 100) * TILE + 16 } });
let maxD = 0;
for (let i = 0; i < 40; i++) {
  await ff(TICK);
  v = await vs();
  maxD = Math.max(maxD, ...v.levies.map((l) => Math.hypot(l.x / TILE - kx, l.y / TILE - ky)));
}
result(maxD <= 60 && saw(/will not march beyond/), `C leash: furthest ${maxD.toFixed(1)} tiles from the keep`);
// Second call refused while on the field.
c.events.length = 0;
send({ type: "callToArms", tileX: kx, tileY: ky });
await sleep(200);
result(saw(/already on the field/), `C second call refused: ${c.events.at(-1)}`);
// Service over: they march home and rejoin the garrison.
v = await vs({ levyUntilTick: 0, tick: true });
result(v.levies.every((l) => l.home), `C service over: all ${v.levies.length} marching home`);
for (let i = 0; i < 60 && v.levies.length > 0; i++) {
  await ff(TICK * 5);
  v = await vs();
}
const lost = v.vassal.levyLost ?? 0;
result(v.levies.length === 0 && v.garrison === garrison0 - lost && lost < levyIds.length && saw(/levy is home/), `C home: levies ${v.levies.length}, garrison ${v.garrison}/${garrison0} (${lost} fell)`);
c.events.length = 0;
send({ type: "callToArms", tileX: kx, tileY: ky });
await sleep(200);
result(saw(/Called too recently/), `C cooldown: ${c.events.at(-1)}`);
// A casualty costs relation.
await vs({ levyCooldownUntilTick: 0 });
send({ type: "callToArms", tileX: kx, tileY: ky });
await sleep(200);
v = await vs();
const relC = v.relation;
await hook("damageColonist", { id: v.levies[0].id, amount: 1e6 });
v = await vs();
result(Math.abs(relC - v.relation - 1) < 0.011 && v.levies.length >= 1, `C a levy killed: relation ${relC} -> ${v.relation}`);

// ---- S: save / load with a levy on the field ----
const before = `${v.vassalOf}|${v.vassal.tax}|${v.vassal.taxGoldTotal}|${v.levies.length}`;
c.saves = [];
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
await vs({ vassal: false });
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
await sleep(800);
v = await vs();
const after = `${v.vassalOf}|${v.vassal?.tax}|${v.vassal?.taxGoldTotal}|${v.levies.length}`;
result(c.saves[0]?.ok && c.saves[1]?.ok && after === before, `S save / load: [${before}] -> [${after}]`);

// ---- W: weaker ----
v = await vs({ levyUntilTick: 0, tick: true });
for (let i = 0; i < 60 && v.levies.length > 0; i++) {
  await ff(TICK * 5);
  v = await vs();
}
await hook("killColonists", { kind: "knight" });
await vs({ tax: false });
await ff(TICK * 3);
c.events.length = 0;
send({ type: "setTax", tileX: kx, tileY: ky, on: true });
await sleep(200);
v = await vs();
result(!v.vassal.tax && saw(/too weak to demand tribute/), `W tax refused with no army: ${c.events.at(-1)}`);
v = await vs({ dawn: true });
result(v.vassalOf === null && saw(/breaks free: its garrison now outmatches/), `W stronger vassal breaks free at dawn (vassalOf ${v.vassalOf}, tier ${v.tier})`);

// ---- B: breakaway below 70 ----
await vs({ vassal: true, relation: 75 });
c.events.length = 0;
v = await vs({ relation: 69 });
result(v.vassalOf === null && v.tier !== "vassal" && saw(/breaks free: your relation fell below 70/), `B relation 69: vassalOf ${v.vassalOf}, tier ${v.tier}`);

if (process.env.DEBUG) console.log(allEvents.filter((t) => /breaks|fell|died|slain|killed|struck|Levy|levy|takes up/.test(t)).join("\n"));
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
