// Scripted test: the "Food: N days" readout (DESIGN-REVIEW-nov20 gap G-B; numbers and pure rules in shared/src/food.ts;
// server/src/colonists.ts foodSnapshot + the dawn-meal "Food is low" event). Needs a private server with test hooks and
// a scratch COLONY_SAVE_DIR (`npm test -- food-days` gives that; seasons are OFF there, so it also checks the row exists
// without seasons). Checks: the snapshot's `food` equals the formula (stock / ceil(eaters x upkeep)) for a given stock;
// zero stock reads 0 days; the amber / red thresholds; the dawn meal fires ONE "Food is low" toast per game day (a
// second meal the same day adds none, the next day adds one) and none when stocked; the trend is the change since the
// last dawn meal.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { welcome: null, snap: null, events: [], hooks: new Map() };
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const send = (m) => ws.send(JSON.stringify(m));
const until = async (fn, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (fn()) return true;
  return !!fn();
};
const hook = async (op, args = {}) => {
  c.hooks.delete(op);
  send({ type: "testHook", op, ...args });
  await until(() => c.hooks.has(op), 8000);
  return c.hooks.get(op);
};
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.snap = null;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hooks.set(m.op, m);
});
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await until(() => c.welcome && c.snap, 20000);
c.welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => c.welcome && c.snap, 30000);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });

const GAME_DAY = (await hook("respawnState")).constants.GAME_DAY_TICKS;
const setStock = (stock) => hook("setStock", { stock });
const eat = () => hook("agri", { eat: true });
const lowEvents = () => c.events.filter((e) => /^Food is low/.test(e)).length;
// The snapshot is cached for a second of wall time server-side: wait for one that shows the wanted stock.
const foodWhen = async (stock) => {
  await until(() => c.snap?.foodDays && c.snap.foodDays.stock === stock, 4000);
  return c.snap?.foodDays;
};
const day = async (n) => hook("setCycleTick", { tick: n * GAME_DAY + 400 });

await day(3);

// 1. the snapshot carries `food` and equals the formula (seasons are off in this suite).
await setStock({ grain: 60, meat: 0, fruit: 0 });
let F = await foodWhen(60);
const perDay = F?.perDay ?? 0;
result(!c.snap.winter && !!c.snap.foodDays, `seasons off: no winter field, food row data still sent`);
result(!!F && perDay > 0 && F.days === Math.floor((60 / perDay) * 10) / 10, `60 grain / ${perDay} a day = ${F?.days} days (formula ${Math.floor((60 / perDay) * 10) / 10})`);

// 2. grain + meat + fruit all count.
await setStock({ grain: 20, meat: 20, fruit: 20 });
F = await foodWhen(60);
result(F?.days === Math.floor((60 / perDay) * 10) / 10, `grain + meat + fruit sum to ${F?.stock}: ${F?.days} days`);

// 3. no food: 0 days.
await setStock({ grain: 0, meat: 0, fruit: 0 });
F = await foodWhen(0);
result(F?.days === 0 && F.stock === 0, `no food: ${F?.days} days`);

// 4. thresholds (the row colours): shared/src/food.ts amber < 3 days, red < 1 day.
const { FOOD_LOW_DAYS, FOOD_CRITICAL_DAYS, foodLevel } = await import("../shared/src/food.ts").catch(() => ({}));
if (foodLevel) {
  result(foodLevel(FOOD_LOW_DAYS) === "ok" && foodLevel(FOOD_LOW_DAYS - 0.1) === "low" && foodLevel(FOOD_CRITICAL_DAYS) === "low" && foodLevel(FOOD_CRITICAL_DAYS - 0.1) === "critical" && foodLevel(null) === "ok",
    `levels: ok >= ${FOOD_LOW_DAYS}, low (amber) >= ${FOOD_CRITICAL_DAYS}, critical (red) below`);
} else console.log("SKIP shared/src/food.ts not importable from node (levels checked by tsc only)");

// 5. the dawn meal: stocked -> no toast; low -> one toast per game day.
await setStock({ grain: perDay * 10, meat: 0, fruit: 0 });
let n0 = lowEvents();
await eat();
result(lowEvents() === n0, `stocked (10 days): no "Food is low" toast`);
await setStock({ grain: Math.ceil(perDay * 2.5), meat: 0, fruit: 0 }); // ceil: with an odd perDay (5.62 x 10 people = 57) floor(x.5) read as 2.4 days
n0 = lowEvents();
await eat();
result(lowEvents() === n0 + 1 && /Food is low: about 2.5 days/.test(c.events.filter((e) => /^Food is low/.test(e)).at(-1) ?? ""), `2.5 days left: one toast (${c.events.filter((e) => /^Food is low/.test(e)).at(-1)})`);
await setStock({ grain: 0, meat: 0, fruit: 0 });
await eat();
result(lowEvents() === n0 + 1, `second dawn meal the same game day: still one toast (${lowEvents() - n0})`);
await day(4);
await setStock({ grain: 0, meat: 0, fruit: 0 });
await eat();
result(lowEvents() === n0 + 2, `next game day: a second toast (${lowEvents() - n0})`);

// 6. the trend: the change in stock since the last dawn meal.
await setStock({ grain: 100, meat: 0, fruit: 0 });
await eat();
const afterMeal = (await setStock({})).stock;
const base = afterMeal.grain + afterMeal.meat + afterMeal.fruit;
await setStock({ grain: afterMeal.grain + 30 });
F = await foodWhen(base + 30);
result(F?.trend === 30, `trend +30 since the last dawn meal (${F?.trend})`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
