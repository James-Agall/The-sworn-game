// Scripted test: modular building phase 4, job priorities (ROADMAP "Modular building — phase 4"). The Work tab table
// (children left out, defaults by post / skill), manual mode, "off" disables a job, the best priority wins (building
// vs farming), a post goes to the best priority then the best skill, an assigned worker leaves its post only when its
// work type is off, a priority-placed worker leaves for a better job after its shift, fighting off = no levy, back to
// default mode, gap closure G3 hand assignment (assign / unassign, pinned beats priorities, validation, the
// person card's open posts, work type off), save / load (manual mode, numbers, the pin).
// Needs a FRESH private server WITHOUT COLONY_LEGACY_BUILD / LEGACY_STAFF: `npm test -- work-priorities` (boots one:
// world 80, test hooks, unlock-all, scratch save dir).
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
const T = { Empty: 0, Wall: 1, HunterHut: 50 };
const TILE = 32;
const TYPES = ["building", "farming", "woodcutting", "mining", "hunting", "cooking", "crafting", "animals", "hauling", "fighting"];
const col = (t) => TYPES.indexOf(t);

const c = { ws: new WebSocket(`ws://localhost:${PORT}`), welcome: null, snap: null, tab: null, events: [], hook: new Map(), save: null, welcomes: 0, info: null, posts: null };
c.ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    c.welcome = m;
    c.welcomes++;
  } else if (m.type === "snapshot") c.snap = m;
  else if (m.type === "workTab") c.tab = m.tab;
  else if (m.type === "event") c.events.push(m.text);
  else if (m.type === "testHookResult") c.hook.set(m.op, m);
  else if (m.type === "saveResult") c.save = m;
  else if (m.type === "buildingInfo") c.info = m.info;
  else if (m.type === "workPosts") c.posts = m;
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
const ws = (args = {}) => hook("workState", args);
const zs = (args = {}) => hook("zoneState", args);
// A workSet / workMode and the workTab reply.
const tabAfter = async (m) => {
  c.tab = null;
  send(m);
  await hook("fastForward", { ticks: 1 });
  for (let i = 0; i < 300 && !c.tab; i++) await sleep(10);
  return c.tab;
};
const setWork = (ids, work, priority) => tabAfter({ type: "workSet", ids, work, priority });
const row = (tab, id) => tab.rows.find((r) => r.id === id);
// Runs the sim (daytime) until done(workState) or a cap.
const runUntil = async (done, maxTicks, step = 100) => {
  let s = await ws();
  for (let t = 0; t < maxTicks && !done(s); t += step) {
    if ((await hook("respawnState"))?.isNight) await hook("setCycleTick", { tick: 0 });
    await hook("fastForward", { ticks: step });
    s = await ws();
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
await hook("peopleState", { spawn: 4 });
await hook("peopleState", { spawn: 1, child: true });

// 1. The table: adults only, default mode, the Town Center builder has building 1 (its post), villagers 3.
let tab = await tabAfter({ type: "workTab" });
let s = await ws();
const adults = s.people.filter((p) => !p.child && ["villager", "builder"].includes(p.kind));
const child = s.people.find((p) => p.child);
result(tab && !tab.manual && tab.rows.length === adults.length && !tab.rows.some((r) => r.id === child?.id),
  `work tab: ${tab?.rows.length} rows = ${adults.length} adults, the child left out, default mode`);
const builder = s.people.find((p) => p.kind === "builder");
const vills = s.people.filter((p) => p.kind === "villager" && !p.child).map((p) => p.id);
result(row(tab, builder.id)?.pri[col("building")] === 1 && row(tab, builder.id)?.assigned === "building" && row(tab, vills[0])?.pri.every((p) => p === 3),
  `defaults: builder building ${row(tab, builder.id)?.pri[col("building")]} (assigned), villager ${row(tab, vills[0])?.pri.join("")}`);
const [V1, V2, V3, V4, V5] = vills;
const others = (...keep) => vills.filter((id) => !keep.includes(id));

// 2. Manual mode freezes the defaults as numbers; farming + hauling off for everyone: a growing zone stays untilled.
tab = await tabAfter({ type: "workMode", manual: true });
result(tab.manual && row(tab, V1).pri.every((p) => p === 3), `manual mode: ${row(tab, V1).pri.join("")}`);
await setWork(vills, "farming", 0);
await setWork(vills, "hauling", 0);
await setWork(vills, "building", 0);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "wheat", tiles: rect(O.x + 1, O.y + 1, O.x + 3, O.y + 1) });
await hook("fastForward", { ticks: 1 });
await runUntil(() => false, 400);
let z = await zs();
result(z.stages[0] === 3 && Object.keys((await ws()).jobs).length === 0, `farming off: zone untouched (stages ${z.stages.join("/")})`);

// 3. Farming on (priority 1) for V1 alone: it tills / sows the zone and trains the farmer skill.
await setWork([V1], "farming", 1);
s = await runUntil((q) => q.jobs[V1] === "farming", 200, 20);
result(s.jobs[V1] === "farming" && Object.keys(s.jobs).length === 1, `V1 farms (jobs ${JSON.stringify(s.jobs)})`);
await runUntil(() => false, 600);
z = await zs();
tab = await tabAfter({ type: "workTab" });
result(z.stages[0] === 0, `zone worked by priority: stages ${z.stages.join("/")}`);
result(row(tab, V1).xp[col("farming")] > 0, `V1 farmer XP ${row(tab, V1).xp[col("farming")]} (zone farming trains it)`);

// 4. Priority order: V1 building 1 / farming 2, V2 building 2 / farming 1, with a blueprint and farm work on offer.
await setWork([V1], "farming", 2);
await setWork([V1], "building", 1);
await setWork([V2], "farming", 1);
await setWork([V2], "building", 2);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "wheat", tiles: rect(O.x + 1, O.y + 3, O.x + 6, O.y + 4) });
await hook("setInstantBuild", { enabled: false });
send({ type: "placeStructure", tile: T.Wall, tiles: rect(O.x + 10, O.y + 8, O.x + 15, O.y + 8) });
await hook("fastForward", { ticks: 1 });
s = await runUntil((q) => q.jobs[V1] && q.jobs[V2], 400, 10);
result(s.jobs[V1] === "building" && s.jobs[V2] === "farming", `best priority first: V1 ${s.jobs[V1]}, V2 ${s.jobs[V2]}`);
const site0 = (await hook("constructionState")).sites.length;
s = await runUntil((q) => q.people.find((p) => p.id === V1)?.state === "building", 600, 20);
result(s.people.find((p) => p.id === V1)?.state === "building", `V1 builds a blueprint (${site0} sites)`);

// 5. Off disables building: V1 drops the site at once.
await setWork([V1], "building", 0);
s = await ws();
result(s.jobs[V1] !== "building" && !s.people.find((p) => p.id === V1).site, `building off: V1 left the site (job ${s.jobs[V1] ?? "none"})`);

// 6. An assigned worker (the old Town Center builder) keeps its post while building is on, leaves when it is off;
// it is not put back (building off), the open post waits for someone with building on.
await setWork(others(), "building", 0);
await setWork([V2], "building", 0);
s = await ws({ assignments: true });
result(s.people.find((p) => p.id === builder.id)?.kind === "builder", `assigned builder stays while building is on`);
await setWork([builder.id], "building", 0);
s = await ws();
result(s.people.find((p) => p.id === builder.id)?.kind === "villager" && s.vacancies.some((v) => v.kind === "builder"),
  `building off: the builder goes back to the village, its post is open (${s.log.slice(-1)})`);
await hook("fastForward", { ticks: 60 });
s = await ws();
result(s.vacancies.some((v) => v.kind === "builder"), `nobody with building on: the post stays open`);
await hook("setInstantBuild", { enabled: true });

// 7. A Hunter's Hut goes to the best priority, then the best skill: V3 (hunter level 3) over V4 (no XP); hunting off
// for everyone else, V5 hunting 3.
await setWork(vills, "hunting", 0);
await setWork([builder.id], "hunting", 0);
await setWork([V3, V4], "hunting", 2);
await setWork([V5], "hunting", 3);
await ws({ setXp: { id: V3, prof: "hunter", xp: 400 } });
const hut = { x: O.x + 17, y: O.y + 2 };
await hook("teleportPlayer", { x: (hut.x - 1) * TILE + 16, y: hut.y * TILE + 16 });
send({ type: "setTile", tileX: hut.x, tileY: hut.y, tile: T.HunterHut });
s = await runUntil((q) => q.people.some((p) => p.kind === "hunter"), 200, 20);
const hunter = s.people.find((p) => p.kind === "hunter");
result(hunter?.id === V3 && hunter.byPriority, `Hunter's Hut staffed by V3 (best priority, best skill): ${hunter?.id === V3 ? "V3" : hunter?.id}`);
tab = await tabAfter({ type: "workTab" });
result(row(tab, V3).skill[col("hunting")] === 3 && /Hunter at/.test(row(tab, V3).role), `tab: V3 hunting skill ${row(tab, V3).skill[col("hunting")]}, role "${row(tab, V3).role}"`);

// 8. Hunting off for V3: it leaves; the post goes to V4 (priority 2) before V5 (priority 3).
await setWork([V3], "hunting", 0);
s = await runUntil((q) => q.people.some((p) => p.kind === "hunter"), 200, 20);
result(s.people.find((p) => p.id === V3)?.kind === "villager" && s.people.find((p) => p.kind === "hunter")?.id === V4,
  `V3 off -> V4 takes the hut (hunter ${s.people.find((p) => p.kind === "hunter")?.id === V4 ? "V4" : "?"})`);

// 9. V4 was placed by priorities: with farming 1 and farm work waiting it leaves the hut after its shift (30 s).
await setWork([V1, V2], "farming", 0);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "wheat", tiles: rect(O.x + 1, O.y + 6, O.x + 8, O.y + 7) });
await setWork([V4], "farming", 1);
await setWork([V4], "hunting", 2);
await setWork([V5], "hunting", 0);
s = await runUntil((q) => q.people.find((p) => p.id === V4)?.kind === "villager", 1600, 100);
result(s.people.find((p) => p.id === V4)?.kind === "villager" && s.log.some((l) => /leaves Hunting for Farming/.test(l)),
  `priority-placed V4 left the hut for farming: ${s.log.filter((l) => /leaves/.test(l)).join(" | ")}`);

// 10. Fighting off = no levy: only V5 (fighting on) answers the call to arms.
await setWork([...vills, builder.id], "fighting", 0);
await setWork([V5], "fighting", 3);
const lv = await hook("peopleState", { levyAt: { x: tc.x, y: tc.y } });
s = await ws();
const levied = s.people.filter((p) => p.kind === "militia");
result(levied.length === 1 && levied[0].id === V5, `levy: ${levied.length} answered (${levied.map((p) => (p.id === V5 ? "V5" : p.id)).join(", ")}) ${lv?.levyInfo?.reason ?? ""}`);
await hook("peopleState", { levyAt: { x: tc.x, y: tc.y, dismiss: true } });

// 11. Back to default mode: offs stay off, the rest return to defaults (V3's hunting skill 3 -> default 2).
await setWork([V3], "hunting", 4);
tab = await tabAfter({ type: "workMode", manual: false });
result(!tab.manual && row(tab, V3).pri[col("hunting")] === 2 && row(tab, V1).pri[col("building")] === 0 && row(tab, V1).pri[col("cooking")] === 3,
  `default mode: V3 hunting ${row(tab, V3).pri[col("hunting")]}, V1 building ${row(tab, V1).pri[col("building")]}, cooking ${row(tab, V1).pri[col("cooking")]}`);
tab = await setWork([V1], "building", 2);
result(row(tab, V1).pri[col("building")] === 3, `default mode: a cell is on / off (V1 building back on = ${row(tab, V1).pri[col("building")]})`);

// 13. Gap closure G3: hand-assign workers. V1 to the Hunter's Hut by hand: pinned, its role says "(assigned)", a
// priority-placed hunter there gives way.
const people = async () => (await ws()).people;
const kindOf = async (id) => (await people()).find((p) => p.id === id)?.kind;
const lastEvent = () => c.events[c.events.length - 1] ?? "";
const act = async (m) => {
  const n = c.events.length;
  tab = await tabAfter(m);
  return c.events.length > n ? lastEvent() : "";
};
const info = async (x, y) => {
  c.info = null;
  send({ type: "buildingInfo", tileX: x, tileY: y });
  for (let i = 0; i < 300 && !c.info; i++) await sleep(10);
  return c.info;
};
await setWork([V1, V2], "hunting", 3);
let hi = await info(hut.x, hut.y);
result(hi?.posts?.work === "hunting" && hi.posts.canAssign && hi.posts.candidates.some((x) => x.id === V1),
  `hut panel: posts ${hi?.posts ? `${hi.posts.role} open ${hi.posts.open}, workers ${hi.posts.workers.length}, ${hi.posts.candidates.length} candidates` : "missing"}`);
let why = await act({ type: "assignWorker", id: V1, tileX: hut.x, tileY: hut.y });
s = await ws();
result(s.people.find((p) => p.id === V1)?.kind === "hunter" && s.people.filter((p) => p.kind === "hunter").length === 1 && row(tab, V1)?.pinned && /\(assigned\)/.test(row(tab, V1)?.role),
  `V1 assigned by hand: ${row(tab, V1)?.role} pinned ${row(tab, V1)?.pinned} ${why}`);
hi = await info(hut.x, hut.y);
result(hi?.posts?.workers.length === 1 && hi.posts.workers[0].id === V1 && hi.posts.workers[0].pinned && !hi.posts.canAssign,
  `hut panel: V1 pinned, no slot to assign (canAssign ${hi?.posts?.canAssign})`);

// 14. Validation: the child, a worker on a post and a full post (pinned worker) are refused.
why = await act({ type: "assignWorker", id: child.id, tileX: hut.x, tileY: hut.y });
result(/too young/.test(why), `child refused: "${why}"`);
why = await act({ type: "assignWorker", id: V1, tileX: hut.x, tileY: hut.y });
result(/not a free villager/.test(why), `worker on a post refused: "${why}"`);
why = await act({ type: "assignWorker", id: V2, tileX: hut.x, tileY: hut.y });
result(/No free slot/.test(why) && (await kindOf(V2)) === "villager", `full post (pinned worker) refused: "${why}"`);
c.posts = null;
send({ type: "workPosts", id: V2 });
for (let i = 0; i < 300 && !c.posts; i++) await sleep(10);
result(c.posts && !c.posts.posts.some((p) => p.tx === hut.x && p.ty === hut.y), `person card posts for V2: ${c.posts?.posts.length} (the full hut left out)`);

// 15. Pinned beats priorities: manual mode, V1 hunting 3 / farming 1 with farm work waiting: still a hunter after the
// minimum shift (a priority-placed worker left in step 9).
await tabAfter({ type: "workMode", manual: true });
await setWork([V1], "hunting", 3);
await setWork([V1], "farming", 1);
send({ type: "zoneEdit", op: "paint", kind: "growing", crop: "wheat", tiles: rect(O.x + 1, O.y + 10, O.x + 8, O.y + 11) });
s = await runUntil(() => false, 1000, 100);
result(s.people.find((p) => p.id === V1)?.kind === "hunter", `pinned V1 keeps the hut past its shift (log ${s.log.slice(-1)})`);

// 16. Unassign: V1 back to the village, the post opens, and priorities do not put V1 straight back there.
why = await act({ type: "unassignWorker", id: V1 });
s = await runUntil((q) => q.people.some((p) => p.kind === "hunter"), 300, 20);
const h2 = s.people.find((p) => p.kind === "hunter");
result((await kindOf(V1)) === "villager" && !row(tab, V1)?.pinned && h2?.id !== V1,
  `unassigned: V1 ${await kindOf(V1)}, hut ${h2 ? (h2.id === V1 ? "V1 again" : "refilled by someone else") : "open"} ${why}`);

// 17. Work type off ends a hand assignment: V1 assigned again (the hold only stops priorities), hunting off -> leaves.
why = await act({ type: "assignWorker", id: V1, tileX: hut.x, tileY: hut.y });
const pinnedAgain = (await kindOf(V1)) === "hunter" && row(tab, V1)?.pinned;
await setWork([V1], "hunting", 0);
s = await ws({ assignments: true });
result(pinnedAgain && s.people.find((p) => p.id === V1)?.kind === "villager", `re-assigned (${pinnedAgain}) then hunting off: V1 ${s.people.find((p) => p.id === V1)?.kind}`);
await setWork([V1], "hunting", 3);
await tabAfter({ type: "workMode", manual: false });
why = await act({ type: "assignWorker", id: V1, tileX: hut.x, tileY: hut.y });
result((await kindOf(V1)) === "hunter" && row(tab, V1)?.pinned, `V1 pinned to the hut for the save ${why}`);

// 12. Save / load: manual mode and the numbers come back.
await tabAfter({ type: "workMode", manual: true });
await setWork([V1], "woodcutting", 4);
c.save = null;
send({ type: "saveGame", slot: "slot1" });
for (let i = 0; i < 300 && !c.save; i++) await sleep(10);
result(c.save?.ok === true, `saved (${c.save?.error ?? "ok"})`);
await setWork([V1], "woodcutting", 1);
await tabAfter({ type: "workMode", manual: false });
c.save = null;
const w0 = c.welcomes;
send({ type: "loadGame", slot: "slot1" });
for (let i = 0; i < 300 && (!c.save || c.welcomes === w0); i++) await sleep(10);
send({ type: "pause", paused: true });
tab = await tabAfter({ type: "workTab" });
result(tab.manual && row(tab, V1)?.pri[col("woodcutting")] === 4, `loaded: manual ${tab.manual}, V1 woodcutting ${row(tab, V1)?.pri[col("woodcutting")]}`);
result(row(tab, V1)?.pinned && /Hunter/.test(row(tab, V1)?.role ?? ""), `loaded: V1 still hand-assigned (${row(tab, V1)?.role})`);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws.close();
process.exit(fails === 0 ? 0 : 1);
