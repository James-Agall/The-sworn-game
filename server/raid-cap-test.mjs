// Scripted test: the nightly raid cap and target-less raiders (RAIDS-2026-11-26.md). Boots its own server on a private
// port (PORT from the test runner, else 31470) with COLONY_TEST_HOOKS=1 and a scratch COLONY_SAVE_DIR:
//   npm test -- raid-cap
// A: a second nightly raid does not form while the first is alive, and does once it is dead.
// B: with the Town Center and every building gone, the raiders walk off the map and are removed (no raid groups, no
//    raid mobs, nothing parked, world audit clean).
// C: no raid spawns on later nights while the colony has nothing to attack.
// D: a leaving raider survives save -> load and keeps leaving (then is removed).
// E: 26 game days of natural raids on an undefended colony: raid groups / raid mobs stay bounded and the save stops
//    growing.
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, statSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const PORT = Number(process.env.PORT ?? 31470);
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
let fails = 0;
const result = (ok, msg) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} [${el()}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX = [path.join(SERVER_DIR, "node_modules/.bin/tsx"), path.join(SERVER_DIR, "../node_modules/.bin/tsx")].find((p) => existsSync(p));
const saveDir = mkdtempSync(path.join(tmpdir(), "colony-raid-cap-"));
const GUARD_KINDS = ["knight", "archer", "cavalry", "hero", "militia", "spearman", "pikeman"];

const proc = spawn(TSX, ["src/index.ts"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), COLONY_WORLD_SIZE: "160", COLONY_WORLD_SEED: "7", COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: saveDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
proc.stdout.on("data", (d) => (serverLog += d));
proc.stderr.on("data", (d) => (serverLog += d));
const finish = (code) => {
  proc.kill("SIGKILL");
  rmSync(saveDir, { recursive: true, force: true });
  process.exit(code);
};

async function waitForPort(port) {
  for (let i = 0; i < 600; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/saves`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server on ${port} never came up:\n${serverLog.slice(-2000)}`);
}

const c = { welcomes: 0, snap: null, hooks: [], saveResults: [] };
async function connect() {
  c.ws = new WebSocket(`ws://localhost:${PORT}`);
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "welcome") c.welcomes++;
    else if (m.type === "snapshot") c.snap = m;
    else if (m.type === "testHookResult") c.hooks.push(m);
    else if (m.type === "saveResult") c.saveResults.push(m);
  });
  await new Promise((r) => c.ws.on("open", r));
  while (!c.snap) await sleep(10);
}
const send = (m) => c.ws.send(JSON.stringify(m));
const hook = async (op, args = {}) => {
  const before = c.hooks.length;
  send({ type: "testHook", op, ...args });
  const deadline = Date.now() + 120000;
  while (c.hooks.length === before) {
    if (Date.now() > deadline) throw new Error(`no testHookResult for ${op}`);
    await sleep(5);
  }
  return c.hooks[c.hooks.length - 1];
};
const saveOrLoad = async (type, slot) => {
  const before = c.saveResults.length;
  send({ type, slot });
  const deadline = Date.now() + 120000;
  while (c.saveResults.length === before) {
    if (Date.now() > deadline) throw new Error(`no saveResult for ${type} ${slot}`);
    await sleep(10);
  }
  return c.saveResults[c.saveResults.length - 1];
};
const restart = async () => {
  const w = c.welcomes;
  send({ type: "restart", difficulty: "normal" });
  while (c.welcomes === w) await sleep(10);
  await sleep(300);
};
// An undefended colony: no soldiers, the player ignored by mobs (so raiders only ever have the colony to attack),
// no deserter waves (they are not edge-spawned and would muddy the counts), no warbands.
const undefended = async () => {
  await hook("forceDeserterRoll", { value: false });
  await hook("ignorePlayers", { value: true });
  await hook("setWarbands", { enabled: false });
  await hook("setRaids", { enabled: true });
  for (const kind of GUARD_KINDS) await hook("killColonists", { kind });
};
const raidMobs = (st) => st.mobs.filter((m) => m.raidClan !== null);
const ff = async (ticks) => {
  for (let left = ticks; left > 0; left -= 2000) await hook("fastForward", { ticks: Math.min(2000, left) });
};
// Jumps to `ticks` before the raid spawn point (the day's midpoint) of day `day`, then steps past it.
const toRaidSpawn = async (day) => {
  const st = await hook("raidState");
  const dayLen = st.dayTicks + st.nightTicks;
  await hook("setCycleTick", { tick: day * dayLen + Math.floor(st.dayTicks / 2) - 3 });
  await hook("fastForward", { ticks: 10 });
  return hook("raidState");
};
// Fast-forwards in steps until no raid group or raid mob is left (or `maxTicks` pass); returns what it saw.
const runUntilGone = async (maxTicks, step = 20) => {
  let st = await hook("raidState");
  let ticks = 0;
  const seen = { leaving: new Set(), maxLeaving: 0 };
  while (ticks < maxTicks && (st.groups.length > 0 || raidMobs(st).length > 0)) {
    await hook("fastForward", { ticks: step });
    ticks += step;
    st = await hook("raidState");
    const leaving = raidMobs(st).filter((m) => m.tactic === "leave");
    for (const m of leaving) seen.leaving.add(m.id);
    seen.maxLeaving = Math.max(seen.maxLeaving, leaving.length);
  }
  return { st, ticks, seen };
};

try {
  await waitForPort(PORT);
  await connect();

  // ---------------- A: one nightly raid at a time ----------------
  {
    await restart();
    await undefended();
    let st = await toRaidSpawn(0);
    const first = new Set(st.groups.map((g) => g.id));
    const firstMobs = new Set(raidMobs(st).map((m) => m.id));
    result(first.size > 0 && st.groups.every((g) => g.raidClan === 0) && firstMobs.size > 0,
      `A: day 0 raid formed (${first.size} groups, ${firstMobs.size} raiders, all tagged clan 0)`);
    // Skip the night: day 1's raid time comes while day 0's raid is still on the map.
    st = await toRaidSpawn(1);
    const alive = raidMobs(st).filter((m) => firstMobs.has(m.id)).length;
    const newGroups = st.groups.filter((g) => !first.has(g.id)).length;
    const newMobs = raidMobs(st).filter((m) => !firstMobs.has(m.id)).length;
    result(alive > 0 && newGroups === 0 && newMobs === 0,
      `A: day 1 with ${alive} raiders of day 0 alive: no new raid (new groups ${newGroups}, new raiders ${newMobs})`);
    // Kill the first raid; the next night's raid forms again.
    for (const m of raidMobs(st)) await hook("damageMob", { mobId: m.id, amount: 1e9 });
    await hook("fastForward", { ticks: 5 });
    st = await hook("raidState");
    result(st.groups.length === 0 && raidMobs(st).length === 0, `A: day 0 raid dead (groups ${st.groups.length}, raiders ${raidMobs(st).length})`);
    st = await toRaidSpawn(2);
    const fresh = st.groups.filter((g) => !first.has(g.id));
    result(fresh.length > 0 && raidMobs(st).length > 0 && st.raidTargetExists,
      `A: day 2 raid forms once the first is gone (${fresh.length} groups, ${raidMobs(st).length} raiders)`);
  }

  // ---------------- B + C: the colony falls, raiders leave, no more raids ----------------
  {
    await restart();
    await undefended();
    let st = await toRaidSpawn(0);
    const n0 = raidMobs(st).length;
    await hook("raidDepartNow");
    await hook("fastForward", { ticks: 300 });
    st = await hook("raidState");
    const marching = st.groups.filter((g) => g.state === "marching").length;
    const razed = await hook("razeColony");
    result(razed.townCenters === 0 && razed.buildings === 0 && marching > 0,
      `B: colony razed (Town Centers ${razed.townCenters}, buildings ${razed.buildings}) while ${marching}/${st.groups.length} groups march (${n0} raiders)`);
    await hook("fastForward", { ticks: 1 });
    st = await hook("raidState");
    result(st.raidTargetExists === false, `B: raidTargetExists false after the raze`);
    // RAID_LEAVE_MAX_TICKS is 60 s (1200 ticks): every raider is gone well within 3000 ticks.
    const gone = await runUntilGone(3000);
    st = gone.st;
    result(gone.seen.leaving.size > 0, `B: raiders walked off as "leave" (${gone.seen.leaving.size} seen leaving, max ${gone.seen.maxLeaving} at once)`);
    result(st.groups.length === 0 && raidMobs(st).length === 0 && st.parkedRaidMobs === 0,
      `B: after ${gone.ticks} ticks: raid groups ${st.groups.length}, raid mobs ${raidMobs(st).length}, parked ${st.parkedRaidMobs}`);
    const leftovers = st.mobs.filter((m) => m.regimentId && !m.siteId).length;
    result(leftovers === 0, `B: no released raiders left behind (${leftovers})`);
    const audit = await hook("auditWorld");
    result(audit.ok && audit.problems.length === 0, `B: world audit clean (${audit.problems.length} problems${audit.problems.length ? ": " + audit.problems.slice(0, 3).join("; ") : ""})`);
    // C: nights 1 and 2 bring no raid.
    for (const day of [1, 2]) {
      st = await toRaidSpawn(day);
      await hook("fastForward", { ticks: 200 });
      st = await hook("raidState");
      result(st.groups.length === 0 && raidMobs(st).length === 0, `C: day ${day} with nothing to attack: no raid (groups ${st.groups.length}, raid mobs ${raidMobs(st).length})`);
    }
  }

  // ---------------- D: a leaving raid survives save -> load ----------------
  {
    await restart();
    await undefended();
    await toRaidSpawn(0);
    await hook("raidDepartNow");
    // Night, so groups break up on contact: raze once released raiders (no group) are on the map, so this part
    // covers the per-raider path (updateMob) where B covered the group path (marchRaidGroup).
    let st = await hook("raidState");
    await hook("setCycleTick", { tick: st.dayTicks + 5 });
    let released = 0;
    for (let i = 0; i < 100 && released === 0; i++) {
      await hook("fastForward", { ticks: 50 });
      st = await hook("raidState");
      released = raidMobs(st).filter((m) => m.groupId === null).length;
    }
    result(released > 0, `D: ${released} raiders released from their groups (contact) before the raze`);
    await hook("razeColony");
    st = await hook("raidState");
    for (let i = 0; i < 20 && !raidMobs(st).some((m) => m.tactic === "leave"); i++) {
      await hook("fastForward", { ticks: 10 });
      st = await hook("raidState");
    }
    send({ type: "pause" });
    await sleep(200);
    st = await hook("raidState");
    const leaving = raidMobs(st).filter((m) => m.tactic === "leave");
    const sr = await saveOrLoad("saveGame", "slot1");
    result(sr.ok && leaving.length > 0, `D: saved with ${leaving.length} raiders leaving (${sr.ok ? "ok" : sr.error})`);
    // Let them all leave, then load: they are back and still leaving.
    await runUntilGone(3000);
    const lr = await saveOrLoad("loadGame", "slot1");
    await sleep(300);
    st = await hook("raidState");
    const back = raidMobs(st).filter((m) => m.tactic === "leave");
    const same = leaving.every((m) => back.some((b) => b.id === m.id && b.leaveUntilTick === m.leaveUntilTick));
    result(lr.ok && back.length === leaving.length && same && st.groups.length === 0,
      `D: after load ${back.length}/${leaving.length} raiders still leaving with their deadlines, raid groups ${st.groups.length}`);
    const pos0 = new Map(back.map((m) => [m.id, m]));
    await hook("fastForward", { ticks: 60 });
    st = await hook("raidState");
    const edgeDist = (m) => Math.min(m.x, m.y, st.worldTiles * 32 - m.x, st.worldTiles * 32 - m.y);
    const moved = raidMobs(st).filter((m) => pos0.has(m.id) && (edgeDist(m) < edgeDist(pos0.get(m.id)) - 1)).length;
    const despawned = [...pos0.keys()].filter((id) => !st.mobs.some((m) => m.id === id)).length;
    result(moved + despawned > 0, `D: after load they keep going (${moved} nearer an edge, ${despawned} already off the map)`);
    const gone = await runUntilGone(3000);
    const audit = await hook("auditWorld");
    result(gone.st.groups.length === 0 && raidMobs(gone.st).length === 0 && audit.ok,
      `D: all removed after load (${gone.ticks} ticks), audit ${audit.ok ? "clean" : audit.problems.slice(0, 3).join("; ")}`);
    send({ type: "pause" });
  }

  // ---------------- E: 26 days of natural raids on an undefended colony ----------------
  {
    await restart();
    await undefended();
    let st = await hook("raidState");
    const dayLen = st.dayTicks + st.nightTicks;
    let maxGroups = 0;
    let maxRaiders = 0;
    let tcFellDay = null;
    const series = [];
    const sizes = {};
    for (let day = 0; day < 26; day++) {
      await ff(dayLen);
      st = await hook("raidState");
      const groups = st.groups.length;
      const raiders = raidMobs(st).length;
      maxGroups = Math.max(maxGroups, groups);
      maxRaiders = Math.max(maxRaiders, raiders);
      series.push(`${groups}/${raiders}`);
      if (tcFellDay === null && (await hook("constructionState")).townCenters.length === 0) tcFellDay = day;
      if (day === 14 || day === 25) {
        const slot = day === 14 ? "slot2" : "slot3";
        const sr = await saveOrLoad("saveGame", slot);
        const file = path.join(saveDir, `${slot}.json`);
        const parsed = JSON.parse(readFileSync(file, "utf8")).state;
        sizes[day] = {
          bytes: statSync(file).size,
          groups: parsed.raidGroups.length,
          raidMobs: parsed.mobs.filter((m) => m.raidClan !== undefined).length,
          mobsBytes: JSON.stringify(parsed.mobs).length,
          ok: sr.ok,
        };
      }
    }
    const size25 = (await hook("raidSize", { dayIndex: 25 })).size;
    console.log(`  E: day-end groups/raiders: ${series.join(" ")}; Town Center fell on day ${tcFellDay ?? "never"}; target left: ${st.raidTargetExists}`);
    // One raid at a time: never more groups / raiders than about one raid of the largest day (x1.4 camp bonus cap,
    // + a few for the horde rounding).
    const raiderBound = Math.ceil(size25 * 1.4) + 6;
    result(maxGroups <= 12 && maxRaiders <= raiderBound, `E: bounded over 26 days: max ${maxGroups} groups (<= 12), max ${maxRaiders} raiders (<= ${raiderBound})`);
    const a = sizes[14];
    const b = sizes[25];
    console.log(`  E: save day 14 ${(a.bytes / 1024).toFixed(1)} KiB (${a.groups} groups, ${a.raidMobs} raid mobs, mobs ${(a.mobsBytes / 1024).toFixed(1)} KiB); day 25 ${(b.bytes / 1024).toFixed(1)} KiB (${b.groups} groups, ${b.raidMobs} raid mobs, mobs ${(b.mobsBytes / 1024).toFixed(1)} KiB)`);
    result(a.ok && b.ok && b.groups <= 12 && b.raidMobs <= raiderBound, `E: day 25 save holds at most one raid (${b.groups} groups, ${b.raidMobs} raid mobs)`);
    // Before the fix the mobs field alone grew ~5.7 KB / day (11 days: ~63 KB); now the raid part must not grow.
    const mobsGrowth = b.mobsBytes - a.mobsBytes;
    result(mobsGrowth < 16 * 1024 && b.bytes - a.bytes < 48 * 1024,
      `E: save stops growing: day 14 -> 25 file ${((b.bytes - a.bytes) / 1024).toFixed(1)} KiB (< 48), mobs ${(mobsGrowth / 1024).toFixed(1)} KiB (< 16)`);
    const audit = await hook("auditWorld");
    result(audit.ok, `E: world audit clean (${audit.problems.slice(0, 3).join("; ")})`);
  }

  // ---------------- E2: 26 days with the Town Center rebuilt whenever it falls (always a target) ----------------
  // Raids keep coming here, so this checks the cap over many nights: never more than about one raid on the map.
  {
    await restart();
    await undefended();
    const home = (await hook("constructionState")).townCenters[0];
    let st = await hook("raidState");
    const dayLen = st.dayTicks + st.nightTicks;
    const raidGroupIds = new Set();
    let maxGroups = 0;
    let maxRaiders = 0;
    let rebuilt = 0;
    let overlap = 0;
    const series = [];
    for (let day = 0; day < 26; day++) {
      for (let part = 0; part < 4; part++) {
        await ff(Math.ceil(dayLen / 4));
        st = await hook("raidState");
        // A raid is the groups of one spawn: their ids all appear at the same sample; groups of two different
        // spawns on the map at once would show up as fresh ids while older raiders still stand.
        const fresh = st.groups.filter((g) => g.raidClan === 0 && !raidGroupIds.has(g.id));
        const older = raidMobs(st).filter((m) => m.groupId === null || !fresh.some((g) => g.id === m.groupId));
        if (fresh.length > 0 && older.length > 0) overlap++;
        for (const g of st.groups) raidGroupIds.add(g.id);
        maxGroups = Math.max(maxGroups, st.groups.length);
        maxRaiders = Math.max(maxRaiders, raidMobs(st).length);
        if ((await hook("constructionState")).townCenters.length === 0) {
          await hook("placeTownCenter", { tx: home.x, ty: home.y });
          rebuilt++;
        }
      }
      series.push(`${st.groups.length}/${raidMobs(st).length}`);
    }
    const size25 = (await hook("raidSize", { dayIndex: 25 })).size;
    const raiderBound = Math.ceil(size25 * 1.4) + 6;
    console.log(`  E2: day-end groups/raiders: ${series.join(" ")}; Town Center rebuilt ${rebuilt}x; ${raidGroupIds.size} raid groups seen`);
    result(raidGroupIds.size >= 5, `E2: raids kept coming while there was a target (${raidGroupIds.size} groups over 26 days)`);
    result(overlap === 0, `E2: no new raid formed while an older raid's raiders were on the map (${overlap} overlaps)`);
    result(maxGroups <= 12 && maxRaiders <= raiderBound, `E2: bounded: max ${maxGroups} groups (<= 12), max ${maxRaiders} raiders (<= ${raiderBound})`);
    const audit = await hook("auditWorld");
    result(audit.ok, `E2: world audit clean (${audit.problems.slice(0, 3).join("; ")})`);
  }
} catch (e) {
  result(false, `error: ${e.stack ?? e}`);
}
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
c.ws?.close();
finish(fails === 0 ? 0 : 1);
