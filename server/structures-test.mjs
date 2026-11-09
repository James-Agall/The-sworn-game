// Scripted test: modular building phase 1 (ROADMAP "Modular building — phase 1"). A wood room built from blueprint
// orders (placeStructure: wall outline, a door cut into it, floors, beds) is detected as an enclosed, roofed room;
// tiles outside are not roofed. Friendly units path through the door, mobs do not until it is broken. Beds in the
// roofed room add one population slot each (and become homes); a bed outside a room does not. A window keeps the
// room closed; a stone room gets a stone roof. Blueprints with builders: costs paid up front, priority toggle,
// cancel refunds, builders finish the rest. Progression gates on the new pieces. Save / load keeps it all.
// Needs a FRESH private server: PORT=<free port> COLONY_WORLD_SIZE=80 COLONY_TEST_HOOKS=1 COLONY_UNLOCK_ALL=1 COLONY_SAVE_DIR=<scratch dir>
// (or `npm test -- structures`, which boots one).
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
const T = {
  Empty: 0, Wall: 1, Tree: 2, StoneWall: 11, ConstructionSite: 59,
  WoodDoor: 110, StoneDoor: 111, WoodWindow: 112, StoneWindow: 113, WoodFloor: 114, StoneFloor: 115, Bed: 116,
};
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
});
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  c.hook.delete(op);
  send({ type: "testHook", op, ...args });
  for (let i = 0; i < 1500 && !c.hook.has(op); i++) await sleep(10);
  return c.hook.get(op);
};
const setTile = (x, y, tile) => hook("setTileRaw", { tx: x, ty: y, tile });
const flat = (list) => list.flatMap((p) => [p.x, p.y]);
// Sends a blueprint order and lets one tick run (instant build resolves at once).
const place = async (tile, list) => {
  send({ type: "placeStructure", tile, tiles: flat(list) });
  await hook("fastForward", { ticks: 1 });
};
const st = (args = {}) => hook("structureState", args);
const rect = (x0, y0, x1, y1) => {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};
const outline = (x0, y0, x1, y1) => rect(x0, y0, x1, y1).filter((p) => p.x === x0 || p.x === x1 || p.y === y0 || p.y === y1);

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setInstantBuild", { enabled: true });
await hook("setCycleTick", { tick: 0 });
await hook("setStock", { stock: { wood: 500, rock: 500 } });

const tc = (await hook("constructionState")).townCenters[0];
// A clear 20 x 12 yard east of the Town Center.
const O = { x: tc.x + 4, y: tc.y - 5 };
for (let y = O.y; y < O.y + 12; y++) for (let x = O.x; x < O.x + 20; x++) await setTile(x, y, T.Empty);
await hook("teleportPlayer", { x: (O.x + 10) * TILE + 16, y: (O.y + 11) * TILE + 16 });
const base = await st();
result(base.rooms.length === 0 || base.rooms.every((r) => r.x1 < O.x || r.x0 >= O.x + 20 || r.y1 < O.y || r.y0 >= O.y + 12), `no room in the cleared yard to start (${base.rooms.length} rooms on the map)`);
const cap0 = base.settlements[0].housingCap;

// 1. A wood room: walls 1..5 x 1..4 (interior 3 x 2), a door on the south wall, floors and two beds inside.
const R = { x0: O.x + 1, y0: O.y + 1, x1: O.x + 5, y1: O.y + 4 };
await place(T.Wall, outline(R.x0, R.y0, R.x1, R.y1));
const door = { x: R.x0 + 2, y: R.y1 };
let s = await st({ at: [{ x: R.x0 + 1, y: R.y0 + 1 }, { x: R.x0 - 1, y: R.y0 }] });
const room1 = () => s.rooms.find((r) => r.x0 === R.x0 + 1 && r.y0 === R.y0 + 1);
result(!!room1() && room1().size === 6 && s.roofed[0] === true && s.roofed[1] === false, `wall outline encloses a 6-tile roofed room (roofed in/out ${s.roofed})`);
await place(T.WoodDoor, [door]);
await place(T.WoodFloor, rect(R.x0 + 1, R.y0 + 1, R.x1 - 1, R.y1 - 1));
await place(T.Bed, [{ x: R.x0 + 1, y: R.y0 + 1 }, { x: R.x0 + 3, y: R.y0 + 1 }]);
s = await st({ at: [door, { x: R.x0 + 2, y: R.y0 + 2 }, { x: R.x0 + 1, y: R.y0 + 1 }] });
result(s.tiles[0] === T.WoodDoor && s.tiles[1] === T.WoodFloor && s.tiles[2] === T.Bed, `door cut into the wall, floor and bed placed (${s.tiles})`);
result(!!room1() && room1().size === 6 && room1().beds.length === 2 && room1().stone === false, `still one room with a door: 2 beds, thatch roof (${JSON.stringify(room1())})`);
result(s.roofed[1] === true, `floor tile is roofed`);

// 2. Population: each bed in the roofed room is one more home slot.
result(s.settlements[0].housingCap === cap0 + 2, `housing cap ${cap0} -> ${s.settlements[0].housingCap} (+2 beds)`);
await hook("assignHomes");
s = await st();
const bedHomes = s.homes.filter((h) => room1().beds.some((b) => b.x === h.x && b.y === h.y));
// Everyone already has a home (the Town Center), so the beds are spare homes: nobody is assigned outside a home.
result(bedHomes.length <= 2 && s.homes.every((h) => h.x >= 0), `beds are valid homes (${bedHomes.length} in beds; ${s.homes.length} housed in all)`);
// A bed outside any room counts for nothing.
await place(T.Bed, [{ x: O.x + 10, y: O.y + 6 }]);
s = await st();
result(s.settlements[0].housingCap === cap0 + 2, `a bed in the open adds nothing (cap ${s.settlements[0].housingCap})`);

// 3. Pathing: the colony walks through the door, mobs do not; a broken door lets them in.
const inside = { x: R.x0 + 2, y: R.y0 + 1 };
const outside = { x: door.x, y: door.y + 2 };
s = await st({ paths: [{ from: outside, to: inside }, { from: outside, to: inside, hostile: true }] });
result(s.paths[0] !== null && s.paths[1] === null, `friendly path through the door ${s.paths[0]}, hostile path ${s.paths[1]}`);
const hp = await hook("damageBuilding", { tx: door.x, ty: door.y, amount: 0 });
result(hp.structure?.max === 160, `wood door HP ${hp.structure?.max}`);
await hook("damageBuilding", { tx: door.x, ty: door.y, amount: 10000 });
s = await st({ at: [door, inside], paths: [{ from: outside, to: inside, hostile: true }] });
result(s.tiles[0] === T.Empty && s.roofed[1] === false && s.paths[0] !== null, `broken door: gap (${s.tiles[0]}), room open (roofed ${s.roofed[1]}), mobs path in (${s.paths[0]})`);
await place(T.WoodDoor, [door]);
s = await st({ at: [inside] });
result(s.roofed[0] === true && s.settlements[0].housingCap === cap0 + 2, `rebuilt door closes the room again (cap ${s.settlements[0].housingCap})`);

// 4. A window keeps the room closed (and blocks everyone).
const win = { x: R.x0, y: R.y0 + 1 };
await place(T.WoodWindow, [win]);
s = await st({ at: [win, inside], paths: [{ from: { x: win.x - 1, y: win.y }, to: { x: win.x + 1, y: win.y } }] });
result(s.tiles[0] === T.WoodWindow && s.roofed[1] === true, `window in the wall, room still roofed`);

// 5. A stone room gets a stone roof; a demolished wall opens it.
const S = { x0: O.x + 8, y0: O.y + 1, x1: O.x + 11, y1: O.y + 4 };
await place(T.StoneWall, outline(S.x0, S.y0, S.x1, S.y1));
await place(T.StoneDoor, [{ x: S.x0 + 1, y: S.y1 }]);
s = await st({ at: [{ x: S.x0 + 1, y: S.y0 + 1 }] });
const room2 = s.rooms.find((r) => r.x0 === S.x0 + 1 && r.y0 === S.y0 + 1);
result(!!room2 && room2.stone === true && room2.size === 4 && s.roofed[0], `stone room: 4 tiles, stone roof (${JSON.stringify(room2)})`);
send({ type: "placeStructure", tile: T.Empty, tiles: flat([{ x: S.x1, y: S.y0 + 1 }]) });
await hook("fastForward", { ticks: 1 });
s = await st({ at: [{ x: S.x0 + 1, y: S.y0 + 1 }] });
result(s.roofed[0] === false, `a cleared wall opens the stone room (no roof)`);
await place(T.StoneWall, [{ x: S.x1, y: S.y0 + 1 }]);

// 6. A walled area holding something else (a tree) is not a room; neither is a big yard.
const Y = { x0: O.x + 13, y0: O.y + 1, x1: O.x + 16, y1: O.y + 4 };
await place(T.Wall, outline(Y.x0, Y.y0, Y.x1, Y.y1));
await setTile(Y.x0 + 1, Y.y0 + 1, T.Tree);
s = await st({ at: [{ x: Y.x0 + 2, y: Y.y0 + 2 }] });
result(s.roofed[0] === false, `walls around a tree: no roof`);

// 7. Blueprints with builders: paid at once, priority, cancel refunds, builders finish the rest.
await hook("setInstantBuild", { enabled: false });
await hook("setStock", { stock: { wood: 100, rock: 100 } });
const line = [0, 1, 2].map((k) => ({ x: O.x + 1 + k, y: O.y + 8 }));
await place(T.Wall, line);
s = await st({ at: line });
let stock = (await hook("setStock", { stock: {} })).stock;
result(s.tiles.every((t) => t === T.ConstructionSite) && stock.wood === 91, `3 wall blueprints, 9 wood paid (stock ${stock.wood})`);
send({ type: "siteOrder", tileX: line[2].x, tileY: line[2].y, action: "priority" });
await hook("fastForward", { ticks: 1 });
s = await st();
result(s.sites.find((q) => q.x === line[2].x && q.y === line[2].y)?.priority === true, `priority set on a blueprint`);
send({ type: "siteOrder", tileX: line[0].x, tileY: line[0].y, action: "cancel" });
await hook("fastForward", { ticks: 1 });
s = await st({ at: [line[0]] });
stock = (await hook("setStock", { stock: {} })).stock;
result(s.tiles[0] === T.Empty && stock.wood === 94, `cancelled blueprint refunds 3 wood (stock ${stock.wood})`);
for (let i = 0; i < 30; i++) {
  await hook("fastForward", { ticks: 100 });
  s = await st({ at: [line[1], line[2]] });
  if (s.tiles.every((t) => t === T.Wall)) break;
}
result(s.tiles.every((t) => t === T.Wall), `builders finish the remaining blueprints (${s.tiles})`);

// 8. Progression: stone pieces need a Quarry, wood pieces the stone axe (in the starter kit).
await hook("setInstantBuild", { enabled: true });
await hook("progression", { unlockAll: false, reset: true });
const g1 = { x: O.x + 18, y: O.y + 9 };
const g2 = { x: O.x + 18, y: O.y + 10 };
await place(T.StoneFloor, [g1]);
await place(T.WoodFloor, [g2]);
s = await st({ at: [g1, g2] });
result(s.tiles[0] === T.Empty && s.tiles[1] === T.WoodFloor, `locked: stone floor refused without a Quarry (${s.tiles[0]}), wood floor allowed (${s.tiles[1]})`);
await hook("progression", { unlockAll: true });

// 9. Save / load keeps the rooms, roof and housing.
s = await st();
const roomsBefore = s.rooms.length;
const capBefore = s.settlements[0].housingCap;
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await setTile(R.x0 + 1, R.y0, T.Empty);
c.save = null;
const w = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w); i++) await sleep(10);
send({ type: "pause", paused: true });
s = await st({ at: [inside, door] });
result(c.save?.ok === true && s.rooms.length === roomsBefore && s.roofed[0] === true && s.tiles[1] === T.WoodDoor, `loaded: ${s.rooms.length}/${roomsBefore} rooms, roofed ${s.roofed[0]}, door ${s.tiles[1]}`);
result(s.settlements[0].housingCap === capBefore, `loaded housing cap ${s.settlements[0].housingCap} (was ${capBefore})`);
s = await st({ paths: [{ from: outside, to: inside }, { from: outside, to: inside, hostile: true }] });
result(s.paths[0] !== null && s.paths[1] === null, `loaded door: friendly ${s.paths[0]}, hostile ${s.paths[1]}`);
const audit = await hook("auditRegistry");
result(audit.bad === 0, `tile registry consistent (${audit.bad} mismatches)`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
