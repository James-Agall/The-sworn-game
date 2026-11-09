// Scripted test: Stardew phase 5b, seasons / calendar / weather (ROADMAP "Stardew layer — phase 5b"). Day -> season
// mapping on the game-day clock (7-day seasons, 28-day year), deterministic weather from the world salt (+ the clear
// first day, snow only in winter, a creative override), crop season gating (wheat in spring, hemp only in summer),
// rain watering unroofed crops (not roofed ones), the daily water reset, winter stopping outdoor growth, the first
// frost killing unroofed growing crops (ripe and roofed survive; roofed = greenhouse at half speed in any season),
// the winter cold on the hero's rest, the snapshot field and save / load of the calendar.
// Needs a FRESH private server WITH seasons (no COLONY_NO_SEASONS): `npm test -- calendar`.
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
const T = { Empty: 0, Wall: 1, WoodDoor: 110 };
const TILE = 32;
const GAME_DAY = 20 * (300 + 75);
const DAY = 20 * 300;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text);
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
const cal = (args = {}) => hook("calendar", args);
const plotAt = (s, p) => s.plots.find((q) => q.x === p.x && q.y === p.y);
const eventsSince = (n) => c.events.slice(n).join(" | ");
const stand = (x, y) => hook("teleportPlayer", { x: x * TILE + 16, y: y * TILE + 16 });
// Jump to (season, day of season) and run the calendar's day change now.
const goTo = async (season, day = 1) => cal({ set: { season, day }, update: true });

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 0 });
let C = await cal({ update: true });

// 0. A new game starts on Spring 1, Year 1, clear; the snapshot carries it.
await sleep(150);
result(C.calendar.season === 0 && C.calendar.day === 1 && C.calendar.year === 1 && C.calendar.weather === "clear" && C.offset === 0,
  `new game: ${JSON.stringify(C.calendar)}`);
result(c.snap.calendar && c.snap.calendar.season === 0 && c.snap.calendar.day === 1 && c.snap.calendar.daysPerSeason === 7,
  `snapshot calendar ${JSON.stringify(c.snap.calendar)}`);

// 1. Day -> season mapping on the day clock (7 days a season, 28 a year).
const expect = [[0, 0, 1, 1], [6, 0, 7, 1], [7, 1, 1, 1], [13, 1, 7, 1], [14, 2, 1, 1], [21, 3, 1, 1], [27, 3, 7, 1], [28, 0, 1, 2], [30, 0, 3, 2]];
let mapOk = true;
for (const [d, season, day, year] of expect) {
  await hook("setCycleTick", { tick: d * GAME_DAY + 100 });
  C = await cal();
  if (C.calendar.season !== season || C.calendar.day !== day || C.calendar.year !== year) {
    mapOk = false;
    console.log(`  day ${d}: got ${JSON.stringify(C.calendar)}`);
  }
}
result(mapOk, `day index -> season / day / year`);
await hook("setCycleTick", { tick: 0 });
await cal({ update: true });

// 2. Deterministic weather: same salt -> same 2 years; first day clear; snow only in winter, rain only outside it.
const F1 = (await cal({ salt: 12345, forecast: 56 })).forecast;
const F2 = (await cal({ forecast: 56 })).forecast;
const F3 = (await cal({ salt: 999, forecast: 56 })).forecast;
await cal({ salt: 12345 });
result(JSON.stringify(F1) === JSON.stringify(F2), `same salt + day -> same weather`);
result(JSON.stringify(F1) !== JSON.stringify(F3), `another salt -> other weather`);
result(F1[0].kind === "clear", `first day clear`);
const winter = (k) => Math.floor((k % 28) / 7) === 3;
result(F1.every((w, k) => (w.kind === "snow" ? winter(k) : true) && (w.kind === "rain" || w.kind === "storm" ? !winter(k) : true)),
  `snow only in winter, rain / storm never in winter (${F1.map((w) => w.kind[0]).join("")})`);
result(F1.some((w) => w.kind === "rain" || w.kind === "storm") && F1.some((w) => w.kind === "snow"), `two years have rain and snow`);
result(F1.every((w) => w.kind === "clear" || (w.from >= 0 && w.to > w.from && w.to <= 1)), `spells have a start and an end within the day`);
// The weather now follows today's spell; a creative override wins for the day.
const rainy = F1.findIndex((w, k) => k > 0 && k < 21 && w.kind === "rain");
await hook("setCycleTick", { tick: rainy * GAME_DAY + Math.floor((F1[rainy].from + 0.01) * GAME_DAY) });
C = await cal({ update: true });
result(C.calendar.weather === "rain" && C.raining, `day ${rainy + 1}: raining inside its spell (${JSON.stringify(F1[rainy])})`);
await hook("setCycleTick", { tick: rainy * GAME_DAY + Math.floor(Math.min(0.999, F1[rainy].to + 0.01) * GAME_DAY) });
C = await cal();
result(F1[rainy].to >= 0.99 || C.calendar.weather === "clear", `after the spell: ${C.calendar.weather}`);
await hook("setCycleTick", { tick: 0 });
await cal({ update: true });
C = await cal({ weather: "fog" });
result(C.calendar.weather === "fog", `creative override: fog`);
C = await cal({ weather: "auto" });
result(C.calendar.weather === "clear", `override cleared: ${C.calendar.weather}`);

// ---- crops: hero plots (gates open: seeds are free) ----
await hook("setStock", { stock: { wood: 200, rock: 200, grain: 50 } });
await life({ needs: false, energy: 100, water: 20 });
const W = c.welcome.worldTilesX;
const tc = (await hook("constructionState")).townCenters[0];
const O = { x: Math.max(4, Math.min(W - 16, tc.x + (tc.x < W / 2 ? 14 : -20))), y: Math.max(4, Math.min(W - 10, tc.y + 6)) };
for (let y = O.y - 2; y <= O.y + 6; y++) for (let x = O.x - 2; x <= O.x + 12; x++) await setTile(x, y, T.Empty);
const H = { x: O.x + 2, y: O.y + 1 };
const A = { x: H.x + 1, y: H.y }; // outdoor wheat
const B = { x: H.x - 1, y: H.y }; // outdoor hemp
const R = { x: H.x, y: H.y + 1 }; // outdoor wheat that will be ripe at the frost
// A roofed room (walls x0..x1, y0..y1, door south); inside: G (wheat) and the hero's spot.
const rx0 = O.x + 6, ry0 = O.y - 1, rx1 = O.x + 10, ry1 = O.y + 3;
for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) if (x === rx0 || x === rx1 || y === ry0 || y === ry1) await setTile(x, y, T.Wall);
await setTile(rx0 + 2, ry1, T.WoodDoor);
await ff(1);
const G = { x: rx0 + 1, y: ry0 + 1 };
const GH = { x: rx0 + 2, y: ry0 + 1 };
const rooms = await hook("roomState", {});
result((rooms?.rooms ?? []).some((r) => G.x >= r.x0 && G.x <= r.x1 && G.y >= r.y0 && G.y <= r.y1), `greenhouse room detected (${rooms?.rooms?.length} rooms)`);

const till = async (p, crop) => {
  await life({ use: { tool: "hoe", tx: p.x, ty: p.y } });
  await ff(25);
  await life({ use: { tool: "seeds", tx: p.x, ty: p.y, crop } });
  await ff(15);
};
await stand(H.x, H.y);
await till(A, "wheat");
await till(B, "hemp");
await till(R, "wheat");
await stand(GH.x, GH.y);
await till(G, "wheat");
await stand(H.x, H.y);
let s = await zs();
result([A, B, R, G].every((p) => plotAt(s, p)?.stage === 2), `four plots sown (${[A, B, R, G].map((p) => plotAt(s, p)?.stage)})`);

const grow = async () => {
  const s0 = await zs();
  await zs({ tickZones: true });
  const s1 = await zs();
  const d = (p) => (plotAt(s1, p)?.progress ?? 0) - (plotAt(s0, p)?.progress ?? 0);
  return { A: d(A), B: d(B), G: d(G), R: d(R), s: s1 };
};
const water = async (list, tended = true) => {
  for (const p of list) await zs({ setCropAt: { x: p.x, y: p.y, tended } });
};

// 3. Spring (clear): wheat grows, hemp is out of season; the greenhouse grows at half speed.
await cal({ weather: "clear" });
await water([A, B, G]);
let g = await grow();
result(g.A > 0 && g.B === 0, `spring: wheat grows (${g.A}), hemp waits for summer (${g.B})`);
result(g.G > 0 && Math.abs(g.G - g.A / 2) < 1e-6, `greenhouse wheat at half speed (${g.G} vs ${g.A})`);

// 4. Summer: hemp grows.
await goTo(1, 2);
await cal({ weather: "clear" });
await water([A, B, G]);
g = await grow();
result(g.B > 0 && g.A > 0, `summer: hemp grows (${g.B}), wheat too (${g.A})`);

// 5. The daily water reset: a new day dries every crop.
await water([A, B, G]);
await goTo(1, 3);
await cal({ weather: "clear" });
s = await zs();
result([A, B, G].every((p) => plotAt(s, p)?.tended === false), `dawn: crops need water again`);

// 6. Rain waters unroofed crops for the day; not the roofed one.
await cal({ weather: "rain" });
g = await grow();
result(plotAt(g.s, A)?.tended === true && plotAt(g.s, B)?.tended === true && plotAt(g.s, G)?.tended === false,
  `rain watered A / B, not the greenhouse (${[A, B, G].map((p) => plotAt(g.s, p)?.tended)})`);
await cal({ weather: "auto" });

// 7. Autumn, first half: wheat still grows; second half: out of season.
await goTo(2, 2);
await cal({ weather: "clear" });
await water([A, G]);
g = await grow();
result(g.A > 0 && g.B === 0, `early autumn: wheat grows (${g.A}), hemp stopped (${g.B})`);
await goTo(2, 6);
await cal({ weather: "clear" });
await water([A, G]);
g = await grow();
result(g.A === 0 && g.G > 0, `late autumn: outdoor wheat stopped (${g.A}), greenhouse still grows (${g.G})`);

// 8. The first frost: unroofed sown / growing crops die (back to tilled); ripe and roofed ones survive.
await zs({ setCropAt: { x: R.x, y: R.y, stage: 4 } });
let ev = c.events.length;
await goTo(3, 1);
await sleep(100);
s = await zs();
result(plotAt(s, A)?.stage === 1 && plotAt(s, A)?.crop === null && plotAt(s, B)?.stage === 1, `frost killed the outdoor crops (A ${plotAt(s, A)?.stage}, B ${plotAt(s, B)?.stage})`);
result(plotAt(s, R)?.stage === 4 && plotAt(s, G)?.stage >= 2, `ripe and greenhouse crops survive (R ${plotAt(s, R)?.stage}, G ${plotAt(s, G)?.stage})`);
result(/Winter begins/.test(eventsSince(ev)) && /Frost/.test(eventsSince(ev)), `events: ${eventsSince(ev)}`);

// 9. Winter stops outdoor growth: resown wheat waits; the greenhouse grows.
await stand(H.x, H.y);
ev = c.events.length;
await life({ use: { tool: "seeds", tx: A.x, ty: A.y, crop: "wheat" } });
await ff(15);
await sleep(100);
result(/Sown, but wheat grows only spring to mid-autumn/.test(eventsSince(ev)), `winter sowing warns: ${eventsSince(ev)}`);
await cal({ weather: "clear" });
await water([A, G]);
g = await grow();
result(plotAt(g.s, A)?.stage === 2 && g.A === 0 && g.G > 0, `winter: outdoor sown wheat waits (${g.A}), greenhouse grows (${g.G})`);
C = await cal();
result(C.winter && !C.raining, `winter, no rain watering`);

// 10. Winter cold: at night outdoors with no shelter the hero's rest drains x1.5 (vs the same night in summer).
const restDrop = async () => {
  await life({ needs: true, rest: 80, food: 100 });
  await ff(40);
  return 80 - (await life()).life.rest;
};
const nightTick = (day) => (day * GAME_DAY) + DAY + 200;
await hook("setCycleTick", { tick: nightTick(1) });
await cal({ set: { season: 1, day: 3 }, update: true });
const summerDrop = await restDrop();
await hook("setCycleTick", { tick: nightTick(1) });
await cal({ set: { season: 3, day: 3 }, update: true });
const winterDrop = await restDrop();
result(summerDrop > 0 && Math.abs(winterDrop / summerDrop - 1.5) < 0.05, `winter night out in the cold: rest drains ${winterDrop.toFixed(2)} vs ${summerDrop.toFixed(2)}`);
await life({ needs: false });

// 11. Save / load keeps the calendar offset and a creative weather override.
await hook("setCycleTick", { tick: 2 * GAME_DAY + 100 });
await cal({ set: { season: 2, day: 4, year: 2 }, weather: "storm", update: true });
const before = await cal();
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await cal({ set: { season: 0, day: 1, year: 1 }, weather: "auto" });
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
await sleep(100);
C = await cal();
result(C.offset === before.offset && C.calendar.season === 2 && C.calendar.day === 4 && C.calendar.year === 2 && C.calendar.weather === "storm",
  `loaded: ${JSON.stringify(C.calendar)} offset ${C.offset}`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
