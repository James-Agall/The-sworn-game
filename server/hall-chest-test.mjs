// Scripted test: Inventory 2026-11-26 (INVENTORY-2026-11-26.md), the Town Center's Great hall chest. The hero walks
// into their Town Center through its door (walking north into it, the real `input` message); every hall layout (the 3
// variants) validates and has a chest that can be walked up to from the entrance; E by the chest opens "Hall chest"
// with "Deposit carried goods" (deposit one good, deposit all: into the shared stockpile, fish counting as meat) and
// the private chest one choice further; the hall keeps its last chest when redecorated; the per-good `deposit` hero
// action next to the Town Center; and depositing away from any own store gives the existing refusal.
// Needs a FRESH private server: `npm test -- hall-chest`.
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
const T = { Empty: 0 };
const TILE = 32;
const px = (t) => t * TILE + 16;

const c = { ws: new WebSocket(`ws://localhost:${PORT}/?profile=hall-chest`), welcome: null, snap: null, events: [], hook: new Map(), interior: [], dialogue: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") c.welcome = m;
  else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "interior") c.interior.push(m.view);
  else if (m.type === "dialogue") c.dialogue = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 3000 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const life = (args = {}) => hook("heroLife", args);
const ins = (args = {}) => hook("interior", args);
const stock = async () => (await hook("equipState")).stock;
const since = (n) => c.events.slice(n).join(" | ");
async function pressE() {
  const n = c.interior.length;
  const e = c.events.length;
  c.dialogue = null;
  send({ type: "interact" });
  for (let i = 0; i < 100 && c.interior.length === n && c.events.length === e && !c.dialogue; i++) await sleep(10);
}
const dlg = () => c.dialogue?.dialogue;
const choiceIdx = (re) => dlg()?.choices.findIndex((x) => re.test(x.label)) ?? -1;

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause", paused: true });
await hook("setRaids", { enabled: false });
await life({ needs: false, pack: {} });
const tc = (await hook("constructionState")).townCenters[0];
const W = c.welcome.worldTilesX;

// Walkable from the hall's entrance to a cell beside the chest (walls '#' and every furnished cell count as solid).
function chestReachable(map) {
  const solid = (x, y) => x < 0 || y < 0 || x >= map.w || y >= map.h || map.cells[y * map.w + x] === "#" || map.props.some((q) => q.x === x && q.y === y);
  const seen = new Set([`${map.spawn.x},${map.spawn.y}`]);
  const q = [[map.spawn.x, map.spawn.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (solid(nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return map.props.filter((p) => p.prop === "chest").map((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [p.x + dx, p.y + dy]).find(([x, y]) => seen.has(`${x},${y}`)) ?? null);
}

// 1. Walk in: north from below the Town Center into its door (the elder standing by the door takes E first, so the
// walk-in is the path a player uses there: interiors.ts tryEnterAtDoor with bump).
let inside = null;
const enterLog = [];
for (let dx = -2; dx <= 3 && !inside; dx++) {
  await hook("teleportPlayer", { x: px(tc.x + dx), y: px(tc.y + 5) });
  send({ type: "input", dx: 0, dy: -1 });
  await sleep(60);
  await hook("fastForward", { ticks: 60 });
  send({ type: "input", dx: 0, dy: 0 });
  await sleep(60);
  await hook("fastForward", { ticks: 1 });
  const I = await ins();
  enterLog.push(`${dx}: ${I.inside ? "in" : "out"}`);
  if (I.inside) inside = I;
}
result(inside?.inside && inside.view?.map?.templateId === "hall", `walking north into the Town Center door enters the Great hall (${inside?.view?.title}; ${enterLog.join(" / ")})`);
await ins({ exit: true });

// 2. Every hall layout: valid templates, a chest, reachable from the entrance.
const errs = (await ins()).templateErrors ?? [];
result(!errs.some((e) => /hall/i.test(JSON.stringify(e))), `hall templates validate (required props include the chest): ${JSON.stringify(errs).slice(0, 200)}`);
const layouts = [];
for (const variant of [0, 1, 2]) {
  await ins({ variant });
  const I = await ins({ enter: { tx: tc.x, ty: tc.y } });
  const map = I.view?.map;
  const spots = map ? chestReachable(map) : [];
  layouts.push({ variant, map, spots });
  result(map?.templateId === "hall" && spots.length > 0 && spots.every(Boolean), `hall variant ${variant}: ${spots.length} chest(s), each reachable (${JSON.stringify(spots)})`);
  await ins({ exit: true });
}

// 3. The chest: "Deposit carried goods" into the shared stockpile (one good, then all), the private chest one step on.
const { map, spots } = layouts[0];
await ins({ variant: 0 });
await ins({ enter: { tx: tc.x, ty: tc.y } });
await life({ pack: { wood: 5, rock: 3, fish: 2 } });
await ins({ at: { x: px(spots[0][0]), y: px(spots[0][1]) } });
const s0 = await stock();
await pressE();
result(dlg()?.npc?.name === "Hall chest" && /Deposit carried goods/.test(dlg().text) && choiceIdx(/Deposit all carried goods/) >= 0 && choiceIdx(/^Deposit 5 wood/) >= 0 && choiceIdx(/^Deposit 2 fish/) >= 0,
  `E by the chest: ${dlg()?.npc?.name}: ${dlg()?.text?.replace(/\n/g, " / ")} [${dlg()?.choices?.map((x) => x.label).join(" | ")}]`);
let L = await life({ choice: choiceIdx(/^Deposit 5 wood/) });
let s1 = await stock();
result(s1.wood === s0.wood + 5 && !L.life.pack.wood && L.life.pack.rock === 3 && /deposit 5 wood/i.test(dlg()?.text ?? ""), `deposit wood only: stock wood ${s0.wood} -> ${s1.wood}, pack ${JSON.stringify(L.life.pack)}`);
L = await life({ choice: choiceIdx(/Deposit all carried goods/) });
const s2 = await stock();
result(s2.rock === s1.rock + 3 && s2.meat === s1.meat + 2 && Object.keys(L.life.pack).length === 0 && choiceIdx(/Deposit all/) >= 0 && dlg().choices[choiceIdx(/Deposit all/)].disabled,
  `deposit all: rock ${s1.rock} -> ${s2.rock}, meat ${s1.meat} -> ${s2.meat} (fish), pack empty; "Deposit all" now disabled (${dlg().choices[choiceIdx(/Deposit all/)]?.disabled})`);
await life({ pack: { grain: 4 } });
await life({ choice: choiceIdx(/private storage/) });
result(dlg()?.npc?.name === "Chest" && choiceIdx(/Store everything/) >= 0, `"Use the hall chest" opens the private chest (${dlg()?.choices?.map((x) => x.label).join(" | ")})`);
L = await life({ choice: choiceIdx(/Store everything/) });
const I3 = await ins();
result(I3.view.chest?.grain === 4 && !L.life.pack.grain, `private chest stores the grain (${JSON.stringify(I3.view.chest)})`);
await life({ choice: choiceIdx(/^Close/) });

// 4. Redecorating the hall never removes its last chest.
await ins({ at: { x: px(map.spawn.x), y: px(map.spawn.y) } });
send({ type: "interiorEdit", op: "base", base: "cottage" });
await sleep(150);
let v = c.interior[c.interior.length - 1];
let chestsNow = v?.map?.props?.filter((q) => q.prop === "chest") ?? [];
const ev = c.events.length;
for (const q of chestsNow) {
  send({ type: "interiorEdit", op: "remove", x: q.x, y: q.y });
  await sleep(150);
}
v = (await ins()).view;
const left = v?.map?.props?.filter((q) => q.prop === "chest") ?? [];
result(chestsNow.length > 0 && left.length >= 1 && /hall keeps its chest/.test(since(ev)), `redecorated hall (${chestsNow.length} chest(s)): removing them all leaves ${left.length} (${since(ev)})`);
await ins({ exit: true });

// 5. Outside: the per-good deposit next to the Town Center; away from any own store, the existing refusal.
await hook("teleportPlayer", { x: px(tc.x), y: px(tc.y + 2) });
await life({ pack: { wood: 3, rock: 2 } });
const s3 = await stock();
send({ type: "heroAction", action: "deposit", good: "wood" });
await sleep(100);
L = await life();
const s4 = await stock();
result(s4.wood === s3.wood + 3 && L.life.pack.rock === 2 && !L.life.pack.wood, `per-good deposit (wood) next to the Town Center: wood ${s3.wood} -> ${s4.wood}, rock stays (${JSON.stringify(L.life.pack)})`);
await life({ pack: { wood: 3, rock: 2 } });
const s5 = await stock();
send({ type: "heroAction", action: "deposit", good: "rock" });
await sleep(100);
L = await life();
const s6 = await stock();
result(s6.rock === s5.rock + 2 && L.life.pack.wood === 3 && !L.life.pack.rock, `per-good deposit (rock): rock ${s5.rock} -> ${s6.rock}, wood stays in the pack (${JSON.stringify(L.life.pack)})`);
const far = { x: Math.max(3, Math.min(W - 4, tc.x + (tc.x < W / 2 ? 25 : -25))), y: tc.y };
await hook("teleportPlayer", { x: px(far.x), y: px(far.y) });
const e2 = c.events.length;
const s7 = await stock();
send({ type: "heroAction", action: "deposit" });
await sleep(100);
L = await life();
const s8 = await stock();
result(/Stand next to your Town Center or a storage chest to deposit/.test(since(e2)) && L.life.pack.wood === 3 && s8.wood === s7.wood, `25 tiles away: "${since(e2)}", nothing moved`);

c.ws.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll hall-chest checks passed");
process.exit(fails ? 1 : 0);
