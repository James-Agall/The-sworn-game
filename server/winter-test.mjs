// Scripted test: winter, heating fuel and clothing (ROADMAP "Winter — landed"; PLAN-agri-industry-winter-mines.md
// phase 4; numbers in shared/src/winter.ts). Needs a private server WITH seasons (no COLONY_NO_SEASONS), test hooks, a
// scratch COLONY_SAVE_DIR, instant build and W80 (`npm test -- winter` gives all of that). Checks: the autumn "Winter
// needs" warning (event + snapshot); occupied homes burn fuel at each winter dawn (bigger homes more); coal burns before
// wood and gives double heat; no fuel = cold homes (happiness down, a dawn health hit, slower work, the snapshot's cold
// homes); the Tailor sews coats / boots / tunics (grades), people take them from the stores (outdoor workers first) and
// they wear out; the cold-work / speed penalty applies only outdoors in winter (or snow) without warm clothes, the
// hero's too; save / load keeps the cold homes and every wardrobe; seasons off: no winter at all.
import WebSocket from "ws";

const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8080}`);
const TILE = 32;
const T = { Empty: 0, House: 13, BigHouse: 14, TailorShop: 25 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { welcome: null, snap: null, tiles: [], W: 0, events: [], hooks: new Map(), saves: [], workTab: null };
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
    c.W = m.worldTilesX;
    c.tiles = [...m.tiles];
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "tileUpdate") c.tiles[m.tileY * c.W + m.tileX] = m.tile;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hooks.set(m.op, m);
  else if (m.type === "saveResult") c.saves.push(m);
  else if (m.type === "workTab") c.workTab = m.tab;
});
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
await until(() => c.welcome && c.snap, 20000);
c.welcome = null;
send({ type: "restart", difficulty: "normal" });
await until(() => c.welcome && c.snap, 30000);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setCycleTick", { tick: 20 * 10 });

const tileAt = (x, y) => c.tiles[y * c.W + x];
const ff = (ticks) => hook("fastForward", { ticks });
const tp = (tx, ty) => hook("teleportPlayer", { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const evSince = (n) => c.events.slice(n).join(" | ");
const cal = (args = {}) => hook("calendar", args);
// Jump to (season, day) of this year and run the calendar's day change (the winter dawn) now.
const goTo = (season, day = 1) => cal({ set: { season, day }, update: true });
const win = (args = {}) => hook("winter", args);
const prog = (args = {}) => hook("progression", args);
const items = async () => (await prog()).items;
const setStock = (stock) => hook("setStock", { stock });
const stock = async () => (await setStock({})).stock;
// Sets an item to exactly n (Poor grade added when short).
const setExact = async (id, n) => {
  const have = (await items())[id] ?? 0;
  if (n !== have) await prog({ items: { [id]: n - have } });
  const now = (await items())[id] ?? 0;
  if (now !== n) console.log(`  (setExact ${id}: wanted ${n}, have ${now})`);
};
const place = async (x, y, tile) => {
  await tp(x - 1, y - 1);
  for (let i = 0; i < 6 && tileAt(x, y) !== tile; i++) {
    send({ type: "setTile", tileX: x, tileY: y, tile });
    await until(() => tileAt(x, y) === tile, 400);
    if (tileAt(x, y) !== tile) await ff(10);
  }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// Back to early morning of the current day (villagers are out working, not sheltering for the night).
const GAME_DAY = 20 * (300 + 75);
const morning = async () => {
  const t = (await ff(0)).cycleTick;
  await hook("setCycleTick", { tick: Math.floor(t / GAME_DAY) * GAME_DAY + 400 });
};

await ff(5);
const tc = c.snap.townCenters[0];
const bx = tc.x + 6 + 14 < c.W - 2 ? tc.x + 6 : tc.x - 20;
const by = Math.max(6, Math.min(c.W - 12, tc.y - 3));
for (let y = by - 2; y <= by + 8; y++) for (let x = bx - 2; x <= bx + 12; x++) send({ type: "testHook", op: "setTileRaw", tx: x, ty: y, tile: T.Empty });
await setStock({ wood: 500, rock: 500, iron: 100, grain: 500, meat: 100, fruit: 100, clothes: 0, wool: 0, cotton: 0 });
for (const id of ["coal", "charcoal", "coat", "boots", "tunic", "hide"]) await setExact(id, 0);

// 0. seasons on: the snapshot carries `winter`; nobody wears anything yet.
await cal({ update: true });
let W = await win({ update: true });
result(W.seasonsOn && !W.winter && W.snapshot && W.snapshot.needClothes === W.snapshot.people && !!c.snap.winter,
  `seasons on: winter snapshot ${JSON.stringify(W.snapshot)}`);

// 1. two houses (1 heat each) + a Big House (2): people move in; the Town Center shelters the rest (2).
await place(bx, by, T.House);
await place(bx + 3, by, T.House);
// The Big House is set straight (it is an upgrade of a House, gated on cloth).
await hook("setTileRaw", { tx: bx + 6, ty: by, tile: T.BigHouse });
await hook("assignHomes");
W = await win();
const unitNeed = (key) => W.units.find((u) => u.key === key)?.need;
const tcKey = `${tc.x},${tc.y}`;
result(unitNeed(`${bx},${by}`) === 1 && unitNeed(`${bx + 6},${by}`) === 2 && unitNeed(tcKey) === 2 && W.homeless === 0,
  `heat per home: ${JSON.stringify(W.units.map((u) => [u.key, u.need, u.people]))}, homeless ${W.homeless}`);
const burn = W.units.reduce((n, u) => n + u.need, 0);
result(W.snapshot.burn === burn && W.snapshot.homes >= 4, `snapshot burn ${W.snapshot.burn}/day over ${W.snapshot.homes} homes (expected ${burn})`);

// 2. autumn: short of fuel and clothes -> "Winter needs" event at dawn and in the snapshot.
await setStock({ wood: 5 });
let ev = c.events.length;
await goTo(2, 1);
W = await win();
result(/Winter needs: .*more fuel.*warm clothes/.test(evSince(ev)) && /Winter needs/.test(W.snapshot.warning ?? ""),
  `autumn warning: event "${evSince(ev)}", snapshot "${W.snapshot.warning}"`);
await setStock({ wood: 500 });
await setExact("coat", 40);
await win({ dress: true });
W = await win();
await sleep(1200);
result(!W.snapshot.warning && !c.snap.winter?.warning, `no warning once fuel and clothes are stocked (${W.snapshot.warning ?? "none"}, ${W.snapshot.days} days of fuel)`);
await win({ wardrobe: { id: "all", set: null } });
await setExact("coat", 0);

// 3. winter dawn: occupied homes burn wood; nobody cold.
await setStock({ wood: 100 });
ev = c.events.length;
await goTo(3, 1);
let S = await stock();
W = await win();
result(S.wood === 100 - burn && W.state && W.state.cold.length === 0 && W.persons.every((p) => !p.coldHome),
  `Winter 1: wood ${100} -> ${S.wood} (burn ${burn}), cold homes ${JSON.stringify(W.state?.cold)}; events "${evSince(ev)}"`);
result(W.snapshot.days === Math.floor(S.wood / burn) && W.snapshot.cold === true, `days of fuel left ${W.snapshot.days} (wood ${S.wood} / ${burn})`);

// 4. coal burns first and gives double heat (wood untouched).
await setStock({ wood: 100 });
await setExact("coal", 20);
await goTo(3, 2);
S = await stock();
let I = await items();
result(S.wood === 100 && (I.coal ?? 0) === 20 - Math.ceil(burn / 2), `coal first: coal 20 -> ${I.coal ?? 0} (need ${Math.ceil(burn / 2)} for ${burn} heat), wood ${S.wood}`);
// charcoal last: coal 0, wood 0, charcoal covers it at 2 heat each.
await setExact("coal", 0);
await setExact("charcoal", 20);
await setStock({ wood: 0 });
await goTo(3, 3);
I = await items();
W = await win();
result((I.charcoal ?? 0) <= 20 - Math.floor(burn / 2) && W.state.cold.length === 0, `charcoal heats too: charcoal 20 -> ${I.charcoal}, cold ${W.state.cold.length}`);

// 5. no fuel: cold homes -> happiness penalty, a dawn health hit, slower work, the snapshot's cold homes.
await setExact("charcoal", 0);
await setStock({ wood: 0 });
for (const p of W.persons) await hook("setColonistHp", { id: p.id, hp: p.maxHp });
ev = c.events.length;
await goTo(3, 4);
W = await win({ update: true });
const coldOnes = W.persons.filter((p) => p.coldHome);
result(W.state.cold.length >= 4 && coldOnes.length === W.persons.length, `no fuel: ${W.state.cold.length} cold homes, ${coldOnes.length}/${W.persons.length} people cold`);
result(/Cold homes: no fuel/.test(evSince(ev)), `cold homes event: ${evSince(ev)}`);
result(W.happinessPenalty > 9.9 && W.snapshot.coldHomes === W.state.cold.length && W.snapshot.coldPeople === coldOnes.length && W.snapshot.days === 0,
  `cold-home happiness penalty ${W.happinessPenalty.toFixed(1)}, snapshot ${W.snapshot.coldHomes} homes / ${W.snapshot.coldPeople} people / ${W.snapshot.days} days`);
result(coldOnes.every((p) => p.hp === p.maxHp - 8 || p.hp === Math.ceil(p.maxHp * 0.3)), `dawn cold damage: ${coldOnes.map((p) => `${p.hp}/${p.maxHp}`).join(" ")}`);
// Daytime, no fuel (no heated ground anywhere): the undressed outdoors are exposed: x0.6 work, x0.85 more for the cold home.
const bare = W.persons.find((p) => p.exposed && !p.warm);
result(!!bare && near(bare.work, 0.6 * 0.85), `exposed, no clothes, cold home: work x${bare?.work}`);
result(W.persons.filter((p) => !p.exposed).every((p) => near(p.work, 0.85)), `not exposed, cold home: x0.85 (${W.persons.filter((p) => !p.exposed).length} people)`);
// Cold damage outdoors: an exposed person loses hp over 41 s (1 hp per 20 s), never below the floor.
const exposedIds = W.persons.filter((p) => p.exposed).map((p) => p.id);
for (const id of exposedIds) await hook("setColonistHp", { id, hp: 18 });
await ff(20 * 41);
W = await win({ update: true });
const hurt = exposedIds.map((id) => W.persons.find((q) => q.id === id)).filter((p) => p && p.hp < 18);
result(exposedIds.length > 0 && hurt.length > 0, `out in the cold hurts: ${hurt.length}/${exposedIds.length} lost hp (${hurt.map((p) => `${p.hp}/${p.maxHp}`).join(" ")})`);
// A coat lifts the outdoor penalty (the cold home's x0.85 stays).
await win({ wardrobe: { id: "all", set: { coat: { grade: 1, cond: 1 } } } });
W = await win({ update: true });
result(W.exposed.length === 0 && W.persons.every((p) => near(p.work, 0.85)), `everyone in coats: exposed ${W.exposed.length}, work ${[...new Set(W.persons.map((p) => p.work))]}`);

// 6. the Tailor: sews coats (cloth + wool) with seasons on; boots need hides; output grade by tier. People fetch
// what is sewn on their own, so count the store and the wardrobes together.
await win({ wardrobe: { id: "all", set: null } });
await win({ wardrobe: { id: "hero", set: null } });
const TS = { x: bx + 1, y: by + 4 };
ev = c.events.length;
await place(TS.x, TS.y, T.TailorShop);
result(tileAt(TS.x, TS.y) === T.TailorShop, `Tailor Shop placed`);
await setStock({ clothes: 4, wool: 4, cotton: 0 });
await setExact("hide", 4);
let staffed = false;
for (let i = 0; i < 40 && !staffed; i++) {
  await ff(20);
  await sleep(60);
  staffed = c.snap.colonists.some((u) => u.kind === "artisan" && u.postX === TS.x && u.postY === TS.y);
}
result(staffed, "a tailor took the Tailor Shop post");
const made = async (g) => {
  const st = await win();
  return ((await items())[g] ?? 0) + st.persons.filter((p) => p.wardrobe?.[g]).length + (st.hero.wardrobe?.[g] ? 1 : 0);
};
for (let i = 0; i < 40 && (await made("coat")) < 2; i++) await ff(200);
S = await stock();
result((await made("coat")) === 2 && S.clothes === 0 && S.wool === 0, `2 coats sewn from 4 cloth + 4 wool: ${await made("coat")} coats, cloth ${S.clothes}, wool ${S.wool}`);
for (let i = 0; i < 40 && (await made("boots")) < 2; i++) await ff(200);
I = await items();
result((await made("boots")) === 2 && (I.hide ?? 0) === 0, `2 boots from 4 hides: ${await made("boots")} boots, hides ${I.hide ?? 0}`);
W = await win();
const worn = [...W.persons.map((p) => p.wardrobe), W.hero.wardrobe].flatMap((w) => (w ? Object.values(w) : []));
result(worn.length > 0 && worn.every((g) => g.grade === 1), `garments from a level-1 shop are Poor, and people took them: ${JSON.stringify(worn)}`);

// 7. people dress from the stores (hero, then outdoor workers before indoor ones), best grade first.
await win({ wardrobe: { id: "all", set: null } });
await win({ wardrobe: { id: "hero", set: null } });
for (const g of ["coat", "boots", "tunic"]) await setExact(g, 0);
await prog({ items: { coat: 2 }, quality: 3 });
await prog({ items: { coat: 1 }, quality: 1 });
W = await win({ dress: true, update: true });
const dressed = W.persons.filter((p) => p.wardrobe?.coat);
I = await items();
result(W.hero.wardrobe?.coat?.grade === 3 && dressed.length === 2 && (I.coat ?? 0) === 0,
  `3 coats: the hero (Fine) + 2 people (${dressed.map((p) => `${p.kind} g${p.wardrobe.coat.grade}`).join(", ")}), ${I.coat ?? 0} left`);
result(dressed.every((p) => !p.indoors) && W.persons.some((p) => p.indoors), `outdoor workers are dressed before the tailor at the bench (${dressed.map((p) => p.kind).join(", ")})`);
result(W.persons.filter((p) => p.warm).every((p) => !p.exposed), "nobody warmly dressed is out in the cold");

// 8. fuel back: heated homes warm the ground around them; the undressed further out stay exposed (x0.6 only).
await win({ wardrobe: { id: "all", set: null } });
const exposedNoFuel = (await win({ update: true })).exposed.length;
await setStock({ wood: 200 });
await morning();
await goTo(2, 7);
await goTo(3, 5);
await win({ wardrobe: { id: "all", set: null } });
W = await win({ update: true });
result(W.state.cold.length === 0 && W.persons.every((p) => !p.coldHome), `fuel restocked: no cold homes (${W.state.cold.length})`);
const exposedNow = W.persons.filter((p) => p.exposed);
result(exposedNow.length <= exposedNoFuel && exposedNow.every((p) => near(p.work, 0.6)) && W.persons.filter((p) => !p.exposed).every((p) => near(p.work, 1)),
  `heated homes: exposed ${exposedNow.length} (was ${exposedNoFuel} with no fuel) at x0.6, the rest x1`);

// 9. not in summer: the same undressed people work at x1.
await goTo(1, 1);
W = await win({ update: true });
result(W.exposed.length === 0 && W.persons.every((p) => near(p.work, 1)) && !W.state, `summer: exposed ${W.exposed.length}, work x1 for all, no burn state`);
// ...but falling snow outdoors chills the undressed even out of winter.
await cal({ weather: "snow" });
W = await win({ update: true });
result(W.exposed.length > 0, `summer snow: ${W.exposed.length} exposed`);
await cal({ weather: "auto" });

// 10. the hero: undressed, outdoors in winter, away from homes -> cold, slower; a coat fixes it.
await goTo(3, 6);
const far = { x: bx + 12, y: by + 8 };
await tp(far.x, far.y);
await win({ wardrobe: { id: "hero", set: null } });
W = await win({ update: true });
const coldSpeed = W.hero.speed;
result(W.hero.cold === true, `hero undressed outdoors in winter is cold (speed x${coldSpeed.toFixed(3)})`);
await win({ wardrobe: { id: "hero", set: { tunic: { grade: 2, cond: 1 }, boots: { grade: 1, cond: 1 } } } });
W = await win({ update: true });
result(W.hero.cold === false && W.hero.speed > coldSpeed + 0.1, `tunic + boots: warm (speed x${W.hero.speed.toFixed(3)} vs x${coldSpeed.toFixed(3)})`);

// 11. clothes wear out: a winter dawn takes 2/56 of a Poor coat, 2/112 of a Fine one; a worn-out one is gone.
await win({ wardrobe: { id: "all", set: null } });
const p0 = W.persons[0].id;
const p1 = W.persons[1].id;
await win({ wardrobe: { id: p0, set: { coat: { grade: 1, cond: 1 } } } });
await win({ wardrobe: { id: p1, set: { coat: { grade: 3, cond: 0.01 } } } });
await goTo(3, 7);
W = await win();
const w0 = W.persons.find((p) => p.id === p0).wardrobe;
const w1 = W.persons.find((p) => p.id === p1).wardrobe;
result(w0?.coat && near(w0.coat.cond, 1 - 2 / 56, 1e-3) && !w1?.coat, `wear: Poor coat ${w0?.coat?.cond}, worn-out Fine coat gone (${JSON.stringify(w1)})`);

// 12. the person card (workTab rows): wardrobe text and the needs-clothes flag.
c.workTab = null;
send({ type: "workTab" });
await until(() => c.workTab, 3000);
const row0 = c.workTab?.rows.find((r) => r.id === p0);
const bareRow = c.workTab?.rows.find((r) => r.id !== p0 && r.cold);
result(/Winter coat \(Poor, 9\d%\)/.test(row0?.wardrobe ?? "") && !(row0?.cold ?? []).some((f) => /clothes/.test(f)) && bareRow && bareRow.cold.some((f) => /Needs warm clothes|Freezing/.test(f)),
  `person card: "${row0?.wardrobe}" ${JSON.stringify(row0?.cold ?? [])}; bare: ${JSON.stringify(bareRow?.cold)}`);

// 13. save / load: today's cold homes, people's and the hero's wardrobes survive.
await setStock({ wood: 0 });
await cal({ set: { season: 3, day: 2 }, update: true });
W = await win();
const coldBefore = [...W.state.cold].sort();
await win({ wardrobe: { id: "hero", set: { coat: { grade: 2, cond: 0.5 } } } });
send({ type: "saveGame", slot: "slot1" });
await until(() => c.saves.length > 0, 5000);
await win({ wardrobe: { id: "all", set: null } });
await win({ wardrobe: { id: "hero", set: null } });
c.welcome = null;
send({ type: "loadGame", slot: "slot1" });
await until(() => c.welcome && c.snap, 30000);
send({ type: "pause", paused: true });
W = await win({ update: true });
result(JSON.stringify([...(W.state?.cold ?? [])].sort()) === JSON.stringify(coldBefore) && coldBefore.length > 0 && W.persons.some((p) => p.coldHome),
  `save / load keeps today's cold homes (${coldBefore.length})`);
const p0After = W.persons.find((p) => p.id === p0);
result(p0After?.wardrobe?.coat?.grade === 1 && W.hero.wardrobe?.coat?.grade === 2 && near(W.hero.wardrobe.coat.cond, 0.5),
  `save / load keeps wardrobes: person ${JSON.stringify(p0After?.wardrobe)}, hero ${JSON.stringify(W.hero.wardrobe)}`);

// 14. seasons off: no winter snapshot, nobody exposed, no burn, every multiplier 1; the Tailor does not sew garments.
await cal({ off: true });
W = await win({ update: true, dawn: true });
await sleep(1200);
const woodBefore = (await stock()).wood;
result(!W.seasonsOn && W.snapshot === null && W.exposed.length === 0 && W.persons.every((p) => near(p.work, 1) && !p.coldHome) && !c.snap.winter && W.happinessPenalty === 0,
  `seasons off: snapshot ${JSON.stringify(W.snapshot)}, exposed ${W.exposed.length}, work ${[...new Set(W.persons.map((p) => p.work))]}`);
await setStock({ clothes: 4, wool: 4, cotton: 0 });
await setExact("coat", 0);
await ff(1500);
I = await items();
S = await stock();
result((I.coat ?? 0) === 0 && S.wood === woodBefore, `seasons off: no coats sewn (${I.coat ?? 0}); cloth ${S.clothes}, wool ${S.wool}; no fuel burned`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
