// Scripted test: modular building phase 2, rooms and quality (ROADMAP "Modular building — phase 2"). Furniture placed
// with blueprint orders sets a room's ROLE (bedroom, kitchen, workshop, barracks, storeroom, hall); its STATS (size,
// beauty, cleanliness, warmth) and score follow floors / furniture / dirt; room records are recomputed incrementally
// (and match a full recompute); effects: bedroom sleep -> colony happiness, hero rest, workshop speed / grade,
// kitchen meals, barracks morale; the "needs a roofed room" gate for a new Bakery; save / load keeps dirt and roles.
// Needs a FRESH private server WITHOUT COLONY_LEGACY_BUILD: `npm test -- rooms` (boots one: world 80, test hooks,
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
const T = {
  Empty: 0, Wall: 1, StoneWall: 11, WoodDoor: 110, WoodFloor: 114, StoneFloor: 115, Bed: 116, Bakery: 103, Blacksmith: 26,
  Table: 117, Chair: 118, Chest: 119, Shelf: 120, Hearth: 121, Lamp: 122, Rug: 123, Workbench: 124, Statue: 125, WeaponRack: 126,
};
const TILE = 32;

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, events: [], hook: new Map(), save: null, welcomes: 0 };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "event") c.events.push(m.text ?? m.message ?? JSON.stringify(m));
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
// A blueprint order (instant build); a tile a wandering villager happened to stand on (placement refuses it) is
// written directly instead, so the layout is always complete.
const place = async (tile, list) => {
  send({ type: "placeStructure", tile, tiles: flat(list) });
  await hook("fastForward", { ticks: 1 });
  const st = await hook("structureState", { at: list });
  for (let k = 0; k < list.length; k++) if (st.tiles[k] !== tile) await setTile(list[k].x, list[k].y, tile);
};
// One building via setTile (the hero stands next to it: setTile has a reach limit).
const placeOne = async (x, y, tile) => {
  await hook("teleportPlayer", { x: (x + 1) * TILE + 16, y: y * TILE + 16 });
  send({ type: "setTile", tileX: x, tileY: y, tile });
  await hook("fastForward", { ticks: 1 });
};
const rs = (args = {}) => hook("roomState", args);
const rect = (x0, y0, x1, y1) => {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};
const outline = (x0, y0, x1, y1) => rect(x0, y0, x1, y1).filter((p) => p.x === x0 || p.x === x1 || p.y === y0 || p.y === y1);
// A wall room (outline x0..x1, y0..y1) with a door in the middle of its south wall; returns its first interior tile.
const room = async (x0, y0, x1, y1, wall = T.Wall) => {
  await place(wall, outline(x0, y0, x1, y1));
  await place(T.WoodDoor, [{ x: Math.floor((x0 + x1) / 2), y: y1 }]);
  return { x: x0 + 1, y: y0 + 1 };
};
const roomOf = (s, p) => s.rooms.find((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1);

await new Promise((r) => c.ws.on("open", r));
while (!c.welcome || !c.snap) await sleep(20);
send({ type: "pause" });
await hook("setRaids", { enabled: false });
await hook("ignorePlayers", { value: true });
await hook("setInstantBuild", { enabled: true });
await hook("setCycleTick", { tick: 0 });
await hook("setStock", { stock: { wood: 2000, rock: 2000, iron: 200, wool: 200 } });

const tc = (await hook("constructionState")).townCenters[0];
// A clear 30 x 22 yard east of the Town Center (out of the villagers' stroll range round it).
const O = { x: tc.x + 7, y: tc.y - 10 };
for (let y = O.y; y < O.y + 22; y++) for (let x = O.x; x < O.x + 30; x++) await setTile(x, y, T.Empty);
await hook("teleportPlayer", { x: (O.x + 15) * TILE + 16, y: (O.y + 21) * TILE + 16 });

// 1. A bedroom: walls 0..4 x 0..3 (interior 3 x 2 = 6 tiles), a bed.
const B = await room(O.x, O.y, O.x + 4, O.y + 3);
await place(T.Bed, [B]);
let s = await rs({ at: [B] });
let r = roomOf(s, B);
result(r?.role === "bedroom" && r.tiles === 6, `bed in a 6-tile room: ${r?.role} (${r?.tiles} tiles)`);
const bare = r;
result(bare.beauty < 50 && bare.warmth <= 40 && bare.size === 100, `bare bedroom stats: size ${bare.size}, beauty ${bare.beauty}, warmth ${bare.warmth}, clean ${bare.cleanliness}, score ${bare.score} (${bare.tier})`);
result(s.at[0].info?.roleLabel === "Bedroom" && s.at[0].info.tips.length > 0, `room info: ${s.at[0].info?.roleLabel}, tips: ${s.at[0].info?.tips.join(" | ")}`);

// 2. Incremental recompute: furniture in one room re-floods only round it; the result matches a full recompute.
const before = s.recompute;
await place(T.WoodFloor, rect(B.x + 1, B.y, B.x + 2, B.y + 1));
await place(T.Rug, [{ x: B.x + 1, y: B.y + 1 }]);
await place(T.Lamp, [{ x: B.x + 2, y: B.y }]);
s = await rs({ at: [B] });
r = roomOf(s, B);
const after = s.recompute;
result(after.full === before.full && after.incremental > before.incremental && after.flooded - before.flooded < 2000,
  `incremental: full ${before.full}->${after.full}, incremental ${before.incremental}->${after.incremental}, flooded ${after.flooded - before.flooded} tiles`);
result(r.beauty > bare.beauty && r.warmth > bare.warmth && r.score > bare.score, `floor + rug + lamp: beauty ${bare.beauty}->${r.beauty}, warmth ${bare.warmth}->${r.warmth}, score ${bare.score}->${r.score}`);
const incr = JSON.stringify(s.rooms.map((q) => [q.id, q.tiles, q.role, q.counts]));
s = await rs({ fullRecompute: true });
const full = JSON.stringify(s.rooms.map((q) => [q.id, q.tiles, q.role, q.counts]));
result(incr === full && s.recompute.full === after.full + 1, `incremental rooms == full recompute (${s.rooms.length} rooms)`);

// 3. Roles: kitchen, workshop, barracks, storeroom, hall.
const K = await room(O.x + 6, O.y, O.x + 10, O.y + 4);
await place(T.Table, [K]);
await place(T.Hearth, [{ x: K.x + 2, y: K.y }]);
const W = await room(O.x + 12, O.y, O.x + 16, O.y + 4);
await place(T.Workbench, [W]);
const R = await room(O.x + 18, O.y, O.x + 24, O.y + 4);
await place(T.Bed, [R, { x: R.x + 1, y: R.y }, { x: R.x + 2, y: R.y }]);
s = await rs();
result(roomOf(s, R)?.role === "bedroom", `3 beds without a rack: ${roomOf(s, R)?.role}`);
await place(T.WeaponRack, [{ x: R.x + 4, y: R.y + 2 }]);
const S = await room(O.x, O.y + 6, O.x + 3, O.y + 9);
await place(T.Chest, [S]);
const H = await room(O.x + 6, O.y + 6, O.x + 13, O.y + 13);
await place(T.Rug, [{ x: H.x + 2, y: H.y + 2 }]);
s = await rs({ at: [R] });
const roles = [K, W, R, S, H].map((p) => roomOf(s, p)?.role);
result(roles.join(",") === "kitchen,workshop,barracks,storeroom,hall", `roles: ${roles.join(", ")}`);
result(s.barracksMorale < 1, `barracks morale drain x${s.barracksMorale.toFixed(2)}`);

// 4. Cleanliness: dirt lowers it; it is swept over time; people walking through dirty it.
await rs({ setDirt: { ...K, dirt: 60 } });
s = await rs();
const dirty = roomOf(s, K);
result(dirty.cleanliness <= 40 && dirty.score < roomOf(s, W).score + 40, `dirt 60: cleanliness ${dirty.cleanliness}`);
for (let i = 0; i < 10; i++) await rs({ tickRooms: true });
s = await rs();
result(roomOf(s, K).dirt < 60, `cleaned over 10 s: dirt 60 -> ${roomOf(s, K).dirt.toFixed(2)}`);
await hook("teleportPlayer", { x: (K.x + 1) * TILE + 16, y: (K.y + 1) * TILE + 16 });
await rs({ setDirt: { ...K, dirt: 10 } });
for (let i = 0; i < 10; i++) await rs({ tickRooms: true });
s = await rs();
result(roomOf(s, K).dirt > 10, `a hero standing inside 10 s: dirt 10 -> ${roomOf(s, K).dirt.toFixed(2)}`);
await hook("teleportPlayer", { x: (O.x + 15) * TILE + 16, y: (O.y + 21) * TILE + 16 });

// 5. Effects. Kitchen: meals add happiness; bedroom: a resident sleeps by quality; hero rest.
s = await rs();
const happyKitchen = s.roomHappiness;
result(happyKitchen > 0, `kitchen meals: room happiness +${happyKitchen.toFixed(2)}`);
// A good bedroom (stone floor, rug, statue, hearth) vs an awful one (bare, filthy).
const G = await room(O.x + 15, O.y + 6, O.x + 19, O.y + 10, T.StoneWall);
await place(T.StoneFloor, rect(G.x, G.y, G.x + 2, G.y + 2));
await place(T.Bed, [G]);
await place(T.Rug, [{ x: G.x + 1, y: G.y }, { x: G.x + 1, y: G.y + 1 }]);
await place(T.Statue, [{ x: G.x + 2, y: G.y + 2 }]);
await place(T.Hearth, [{ x: G.x + 2, y: G.y }]);
s = await rs({ setHome: { x: G.x, y: G.y }, at: [G] });
const good = roomOf(s, G);
result(good.role === "bedroom" && good.score >= 70, `good bedroom: score ${good.score} (${good.tier}), q ${good.q.toFixed(2)}`);
result(s.roomHappiness > happyKitchen && s.at[0].sleep > 0, `resident in the good bedroom: room happiness ${happyKitchen.toFixed(2)} -> ${s.roomHappiness.toFixed(2)} (sleep ${s.at[0].sleep.toFixed(2)})`);
result(s.at[0].heroRest > 3, `hero rest in the good bedroom x${s.at[0].heroRest.toFixed(2)}`);
const A = await room(O.x + 21, O.y + 6, O.x + 23, O.y + 8);
await place(T.Bed, [A]);
await rs({ setDirt: { ...A, dirt: 100 } });
s = await rs({ setHome: { x: A.x, y: A.y }, at: [A] });
result(roomOf(s, A).score < 50 && s.at[0].sleep < 0 && s.roomHappiness < happyKitchen, `resident in an awful bedroom (score ${roomOf(s, A).score}): sleep ${s.at[0].sleep.toFixed(2)}, room happiness ${s.roomHappiness.toFixed(2)}`);

// 6. "Needs a roofed room": a new Bakery out in the open is refused, inside a room it goes up (a workshop).
const ev0 = c.events.length;
const out = { x: O.x + 27, y: O.y + 15 };
await placeOne(out.x, out.y, T.Bakery);
s = await hook("structureState", { at: [out] });
result(s.tiles[0] === T.Empty && c.events.slice(ev0).some((e) => /needs a roofed room/.test(e)), `Bakery in the open refused (${c.events.slice(ev0).join(" | ")})`);
const P = await room(O.x + 22, O.y + 12, O.x + 26, O.y + 16);
await place(T.WoodFloor, [P]);
await placeOne(P.x, P.y, T.Bakery);
s = await hook("structureState", { at: [P] });
const rsP = await rs({ at: [P] });
result(s.tiles[0] === T.Bakery && roomOf(rsP, P)?.role === "workshop", `Bakery on a floor inside a room: tile ${s.tiles[0]}, room ${roomOf(rsP, P)?.role}, station speed x${rsP.at[0].workshop.speed.toFixed(2)}`);
await place(T.Workbench, [{ x: P.x + 2, y: P.y + 2 }]);
const rsP2 = await rs({ at: [P] });
result(rsP2.at[0].workshop.speed > rsP.at[0].workshop.speed, `a workbench speeds it: x${rsP.at[0].workshop.speed.toFixed(2)} -> x${rsP2.at[0].workshop.speed.toFixed(2)}`);

// 8. Gap closure G1. Multi-tile furniture: a 1x2 bed (rot 0) and a turned one (rot 1) take 2 tiles each (anchor + part),
// count once, refuse a blocked second tile, demolish as one (clicking the part); beds + a Medicine Chest = infirmary
// (its beds are not homes); patients heal there (faster with herbs); the hero heals x3 resting there.
T.LongTable = 127; T.Wardrobe = 128; T.MedicineChest = 129; T.PartW = 134; T.PartN = 135; T.ChurchPost = 20;
const placeRot = async (tile, p, rot) => {
  send({ type: "placeStructure", tile, tiles: [p.x, p.y], ...(rot === undefined ? {} : { rot }) });
  await hook("fastForward", { ticks: 1 });
};
const tilesAt = async (list) => (await hook("structureState", { at: list })).tiles;
const I = await room(O.x + 14, O.y + 12, O.x + 19, O.y + 17);
await place(T.WoodFloor, rect(I.x, I.y, I.x + 3, I.y + 3));
await placeRot(T.Bed, I, 0);
await placeRot(T.Bed, { x: I.x + 1, y: I.y }, 1);
let tl = await tilesAt([I, { x: I.x, y: I.y + 1 }, { x: I.x + 1, y: I.y }, { x: I.x + 2, y: I.y }]);
result(tl.join(",") === [T.Bed, T.PartN, T.Bed, T.PartW].join(","), `1x2 bed + turned 2x1 bed: tiles ${tl.join(",")}`);
await placeRot(T.Bed, { x: I.x + 3, y: I.y + 3 }, 0);
tl = await tilesAt([{ x: I.x + 3, y: I.y + 3 }]);
result(tl[0] !== T.Bed, `a bed whose second tile is a wall is refused (tile ${tl[0]})`);
s = await rs({ at: [I] });
const beds0 = s.usableBeds;
result(roomOf(s, I).role === "bedroom" && roomOf(s, I).counts[T.Bed] === 2, `2-tile beds count once each: ${roomOf(s, I).counts[T.Bed]} beds, ${roomOf(s, I).role}`);
// Demolish as one: clear the turned bed by its part tile.
send({ type: "placeStructure", tile: T.Empty, tiles: [I.x + 2, I.y] });
await hook("fastForward", { ticks: 1 });
tl = await tilesAt([{ x: I.x + 1, y: I.y }, { x: I.x + 2, y: I.y }]);
result(tl.every((t) => t !== T.Bed && t !== T.PartW), `cleared by its part tile: both tiles gone (${tl.join(",")})`);
await placeRot(T.Bed, { x: I.x + 1, y: I.y }, 1);
await placeRot(T.LongTable, { x: I.x + 1, y: I.y + 3 });
tl = await tilesAt([{ x: I.x + 1, y: I.y + 3 }, { x: I.x + 2, y: I.y + 3 }]);
result(tl.join(",") === [T.LongTable, T.PartW].join(","), `long table 2x1: ${tl.join(",")}`);
await place(T.MedicineChest, [{ x: I.x + 3, y: I.y }]);
s = await rs({ at: [I, { x: I.x, y: I.y + 1 }] });
const inf = roomOf(s, I);
result(inf.role === "infirmary" && s.usableBeds === beds0 - 2, `beds + medicine chest = infirmary (${inf.role}, score ${inf.score}); home beds ${beds0} -> ${s.usableBeds}`);
result(s.at[0].infirmaryRate > 0 && s.at[1].infirmaryRate > 0 && s.at[0].heroHeal === 3 && s.at[0].heroRest >= 1,
  `infirmary heal ${(s.at[0].infirmaryRate * 100).toFixed(2)}%/s (part tile too), hero heal x${s.at[0].heroHeal}, rest x${s.at[0].heroRest.toFixed(2)}`);
result(s.at[0].info.effects.some((e) => /Heals/.test(e)), `infirmary effects: ${s.at[0].info.effects.join(" | ")}`);
const herbs0 = s.herbs;
s = await rs({ patient: { x: I.x, y: I.y, hpFrac: 0.3 }, tickRooms: true });
const p1 = s.patient;
const gain1 = p1.hp - p1.maxHp * 0.3;
result(gain1 > 0, `a patient in an infirmary bed heals ${gain1.toFixed(2)} HP in 1 s (herbs ${herbs0})`);
s = await rs({ herbs: 3, patient: { id: p1.id, x: I.x, y: I.y, hpFrac: 0.3 }, tickRooms: true });
const gain2 = s.patient.hp - s.patient.maxHp * 0.3;
result(s.infirmary.doses >= 1 && (herbs0 > 0 || gain2 > gain1 * 1.5), `with herbs: ${gain2.toFixed(2)} HP (doses ${s.infirmary.doses}, herbs left ${s.herbs})`);

// 9. Storeroom protection (spoilage, raid theft), hall gathering, chapel faith.
s = await rs();
const prot0 = s.storeroomProtection;
await place(T.Shelf, [{ x: S.x + 1, y: S.y }]);
s = await rs({ at: [S] });
result(prot0 > 0 && s.storeroomProtection > prot0 && s.at[0].info.effects.some((e) => /Protects/.test(e)), `storeroom protects ${(prot0 * 100).toFixed(1)}% -> ${(s.storeroomProtection * 100).toFixed(1)}% with a shelf`);
await hook("setStock", { stock: { grain: 1000, wood: 2000, rock: 2000 } });
s = await rs({ spoil: true });
result(s.spoiled.grain > 0 && s.spoiled.grain < 20, `daily spoilage: ${s.spoiled.grain} of 1000 grain (2% less protection)`);
s = await rs({ theftAt: { x: S.x - 1, y: S.y } });
result((s.stolen.wood ?? 0) > 0 && s.stolen.wood < 100, `raid theft at a storeroom wall: ${JSON.stringify(s.stolen)}`);
s = await rs({ hallGathered: 0, at: [H] });
const hall0 = s.roomHappiness;
s = await rs({ hallGathered: 6 });
result(s.roomHappiness > hall0 && s.hallShare === 1, `hall: gathering 0 -> 6 at dusk: room happiness ${hall0.toFixed(2)} -> ${s.roomHappiness.toFixed(2)} (share ${s.hallShare})`);
const Ch = await room(O.x, O.y + 11, O.x + 5, O.y + 16);
await place(T.StoneFloor, rect(Ch.x, Ch.y, Ch.x + 3, Ch.y + 3));
await placeOne(Ch.x + 1, Ch.y, T.ChurchPost);
s = await rs({ at: [{ x: Ch.x + 1, y: Ch.y }] });
const happyNoDev = s.roomHappiness;
result(roomOf(s, Ch)?.role === "church" && s.reviveMult === 1 && s.at[0].info.effects.some((e) => /devotions/.test(e)), `chapel without devotions: ${roomOf(s, Ch)?.role}, revive x${s.reviveMult}`);
await place(T.Statue, [{ x: Ch.x + 3, y: Ch.y + 3 }]);
await place(T.Lamp, [{ x: Ch.x, y: Ch.y + 3 }]);
s = await rs({ at: [{ x: Ch.x + 1, y: Ch.y }] });
result(s.reviveMult < 1 && s.roomHappiness > happyNoDev && s.at[0].chapelHeal >= 1, `chapel with a statue + lamp (score ${roomOf(s, Ch).score}): revive x${s.reviveMult.toFixed(2)}, happiness ${happyNoDev.toFixed(2)} -> ${s.roomHappiness.toFixed(2)}, priest heal x${s.at[0].chapelHeal.toFixed(2)}`);

// 7. Save / load: dirt, roles and stats come back.
await rs({ setDirt: { ...W, dirt: 33 } });
s = await rs();
const sig = (st) => JSON.stringify(st.rooms.map((q) => [q.id, q.role, q.tiles, Math.round(q.dirt)]));
const sigBefore = sig(s);
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await rs({ setDirt: { ...W, dirt: 0 } });
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
s = await rs();
result(sig(s) === sigBefore && Math.round(roomOf(s, W).dirt) === 33, `loaded: rooms / roles / dirt the same (workshop dirt ${roomOf(s, W).dirt})`);
const audit = await hook("auditRegistry");
result(audit.bad === 0, `tile registry consistent (${audit.bad} mismatches)`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
