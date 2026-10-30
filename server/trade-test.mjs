// Scripted test: forts phase D, relations and direct trade. Self-contained: boots its OWN 256x256 server with
// COLONY_TEST_HOOKS=1 on PORT (default 22140) and a temp COLONY_SAVE_DIR, kills its process group after.
// Run from server/: `node trade-test.mjs`.
//   T relation tiers by value (Hostile / Wary / Neutral / Friendly / Allied; phase F: 100 without an army does not
//     vassalise, "would swear fealty" toast instead; the vassal tier itself is vassals-test's)
//   H hostile / wary / out of range: trade refused, nothing changes hands
//   P prices: buy > sell at every tier, buy falls and sell rises with the tier
//   B a buy moves goods and gold both ways; stock-limited; daily per-good cap
//   G relation gain from trade: diminishing, capped per day; defence kill near the walls counts
//   D dawn: production of its own goods, consumption of the rest, relation drift after idle days
//   S save / load keeps relations, the day's counters and the settlement's stock
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 22140);
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
const saveDir = mkdtempSync(path.join(tmpdir(), "trade-test-"));
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

const c = { ws: null, welcome: null, snap: null, events: [], hook: new Map(), saves: [], relations: null };
function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcome = m;
    else if (m.type === "snapshot") {
      c.snap = m;
      if (m.relations) c.relations = m.relations;
    } else if (m.type === "event") c.events.push(m.text);
    else if (m.type === "testHookResult") c.hook.set(m.op, m);
    else if (m.type === "buildingInfo") c.info = m.info;
    else if (m.type === "saveResult") c.saves.push(m);
  });
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const info = async (tx, ty) => {
  c.info = undefined;
  send({ type: "buildingInfo", tileX: tx, tileY: ty });
  for (let i = 0; i < 300 && c.info === undefined; i++) await sleep(10);
  return c.info;
};

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
const tc = c.snap.townCenters[0];
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
for (const kind of new Set((c.snap.colonists ?? []).map((u) => u.kind))) await hook("killColonists", { kind });
await hook("setCycleTick", { tick: TICK * 10 });

let st = null;
for (const [dx, dy] of [[0, 60], [60, 0], [0, -60], [-60, 0], [60, 60], [-60, -60]]) {
  st = await hook("stampSite", { template: "hearthmoor", dx, dy, search: 25 });
  if (st?.site) break;
}
const site = st?.site;
result(!!site, `stamped ${site?.name ?? st?.problem}`);
if (!site) process.exit(1);
const id = site.id;
const kx = site.keepX;
const ky = site.keepY;
const rel = (v) => hook("diploSet", { siteId: id, relation: v });
const stock = () => hook("setStock", { stock: {} }).then((r) => r.stock);
const trade = async (good, qty, side) => {
  const n = c.events.length;
  send({ type: "tradeWithSite", tileX: kx, tileY: ky, good, qty, side });
  await sleep(120);
  return c.events.slice(n).join(" | ");
};

// ---- T: tiers ----
const tiers = [];
for (const v of [-60, -30, 0, 30, 70, 100, 80, 65]) tiers.push((await rel(v)).tier);
result(tiers.join(",") === "hostile,wary,neutral,friendly,allied,allied,allied,allied", `T tiers -60..100, 80, 65: ${tiers.join(",")}`);
result(c.events.some((e) => e.includes(`${site.name} would swear fealty`)), "T relation 100 with no army: fealty refused toast (phase F)");

// ---- H: refusals ----
await hook("setStock", { stock: { gold: 1000, grain: 0, wood: 0, meat: 0 } });
await tp(kx + 2, ky + 2);
await rel(-60);
let txt = await trade("grain", 5, "buy");
let s0 = await stock();
result(txt.includes("Hostile") && s0.grain === 0 && s0.gold === 1000, `H hostile refuses: "${txt}"`);
await rel(-30);
txt = await trade("grain", 5, "buy");
result(txt.includes("Wary") && (await stock()).grain === 0, `H wary refuses: "${txt}"`);
await rel(0);
await tp(tc.x, tc.y + 2);
txt = await trade("grain", 5, "buy");
result(txt.includes("Walk up") && (await stock()).grain === 0, `H out of range refuses: "${txt}"`);
await tp(kx + 2, ky + 2);

// ---- P: prices by tier ----
const price = {};
for (const [v, t] of [[0, "neutral"], [30, "friendly"], [70, "allied"]]) {
  await rel(v);
  const i = await info(kx, ky);
  const g = i?.trade?.goods.find((x) => x.good === "grain");
  price[t] = g;
  if (t === "neutral") result(i?.trade?.canTrade === true && i.trade.tier === "neutral", `P trade panel at Neutral: canTrade ${i?.trade?.canTrade} (${i?.trade?.reason})`);
}
result(["neutral", "friendly", "allied"].every((t) => price[t].buy > price[t].sell), `P buy > sell: ${JSON.stringify(Object.fromEntries(Object.entries(price).map(([t, g]) => [t, [g.buy, g.sell]])))}`);
result(price.neutral.buy > price.friendly.buy && price.friendly.buy > price.allied.buy && price.neutral.sell < price.friendly.sell && price.friendly.sell < price.allied.sell, "P better tier: cheaper to buy, better to sell");
result(Math.abs(price.neutral.buy - 2.8) < 0.01 && Math.abs(price.friendly.buy - 2.38) < 0.01 && Math.abs(price.allied.buy - 1.96) < 0.01, `P grain buy 2.8 / 2.38 / 1.96 (x1.0 / 0.85 / 0.7)`);

// ---- B: a buy, stock limit, daily cap ----
await rel(0);
await hook("diploSet", { siteId: id, stock: { grain: 80, wood: 200 } });
txt = await trade("grain", 10, "buy");
s0 = await stock();
let d = await hook("diploSet", { siteId: id });
result(s0.grain === 10 && s0.gold === 1000 - 30 && d.stock.grain === 70 && d.stock.gold === 50 + 30, `B bought 10 grain for 30 gold: "${txt}" (colony ${s0.grain} grain ${s0.gold} gold, theirs ${d.stock.grain} / ${d.stock.gold} gold)`);
await hook("diploSet", { siteId: id, stock: { grain: 5 } });
txt = await trade("grain", 20, "buy");
result((await stock()).grain === 15, `B stock-limited: only 5 left -> ${txt}`);
txt = await trade("grain", 5, "buy");
result(txt.includes("no grain left") && (await stock()).grain === 15, `B none left: "${txt}"`);
txt = await trade("wood", 50, "buy");
txt += " / " + (await trade("wood", 5, "buy"));
result((await stock()).wood === 40 && txt.includes("no more wood today"), `B daily cap 40 per good: ${txt}`);
// Selling is limited by their purse.
await hook("diploSet", { siteId: id, stock: { gold: 3 } });
await hook("setStock", { stock: { meat: 50 } });
txt = await trade("meat", 20, "sell");
s0 = await stock();
d = await hook("diploSet", { siteId: id });
result(s0.meat === 48 && d.stock.gold === 0, `B sell limited by their purse (3 gold): "${txt}" -> colony meat ${s0.meat}`);

// ---- G: relation gain cap (fresh day) ----
await hook("setCycleTick", { tick: (await hook("raidState")).dayTicks + (await hook("raidState")).nightTicks + TICK * 10 });
await rel(0);
await hook("diploSet", { siteId: id, stock: { gold: 600, grain: 0, meat: 0, fruit: 0, wool: 0 } });
await hook("setStock", { stock: { gold: 5000, grain: 200, meat: 200, fruit: 200, wool: 200 } });
txt = await trade("grain", 30, "sell");
const g1 = (await hook("diploSet", { siteId: id })).relation;
for (const g of ["meat", "fruit", "wool", "grain"]) await trade(g, 40, "sell");
for (const g of ["meat", "fruit"]) await trade(g, 40, "buy");
d = await hook("diploSet", { siteId: id });
result(g1 > 0 && g1 < 2, `G first sale gains ${g1} (${txt})`);
result(d.relation > g1 && d.relation <= 6.001 && Math.abs(d.diplo.tradeGain - d.relation) < 0.01, `G many trades: relation ${d.relation} capped at 6 (tradeGain ${d.diplo.tradeGain})`);
const goblin = await hook("spawnMob", { kind: "goblin", tx: site.x0 - 3, ty: ky });
await hook("damageMob", { mobId: goblin.id, amount: 99999, byPlayer: true });
const d2 = await hook("diploSet", { siteId: id });
result(d2.relation > d.relation && d2.diplo.defendGain > 0, `G defence kill near the walls: ${d.relation} -> ${d2.relation}`);

// ---- D: dawn production / consumption / drift ----
await hook("diploSet", { siteId: id, stock: { grain: 50, wood: 100 } });
await rel(20);
const raid = await hook("raidState");
const day = raid.dayTicks + raid.nightTicks;
// Jump to just before the 5th dawn (no gains since today), then cross it.
await hook("setCycleTick", { tick: Math.floor(raid.cycleTick / day) * day + 4 * day - 5 });
await ff(10);
d = await hook("diploSet", { siteId: id });
result(d.stock.grain === 70 && d.stock.wood === 90, `D dawn: grain 50 -> ${d.stock.grain} (+20 produced), wood 100 -> ${d.stock.wood} (-10% used)`);
result(d.relation === 19, `D drift after idle days: 20 -> ${d.relation}`);
await sleep(200);
const r = (c.relations ?? []).find((x) => x.num === site.num);
result(r?.value === 19 && r.tier === "neutral", `D snapshot relations: ${JSON.stringify(r)}`);

// ---- S: save / load ----
await rel(42);
await hook("diploSet", { siteId: id, stock: { grain: 123 } });
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 1; i++) await sleep(20);
await rel(-80);
await hook("diploSet", { siteId: id, stock: { grain: 1 } });
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && c.saves.length < 2; i++) await sleep(20);
await sleep(800);
d = await hook("diploSet", { siteId: id });
result(c.saves[0]?.ok && c.saves[1]?.ok && d.relation === 42 && d.tier === "friendly" && d.stock.grain === 123 && d.diplo?.lastGainDay !== undefined, `S save / load: relation ${d.relation} (${d.tier}), grain ${d.stock?.grain}, diplo ${JSON.stringify(d.diplo)}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
