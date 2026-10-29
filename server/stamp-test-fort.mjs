// Forts phase A browser-check helper: stamps a hand-placed NPC test fort (testHook stampTestSite, a 5x5
// wood ring owned by an NPC site, gate west, tower in the centre) plus a small garrison of the site's own
// mobs, then disconnects. The server must run with COLONY_TEST_HOOKS=1.
//   PORT=<server port> node stamp-test-fort.mjs [dx] [dy]
// dx / dy: offset of the fort centre from the first Town Center in tiles (default 12, 0).
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const dx = Number(process.argv[2] ?? 12);
const dy = Number(process.argv[3] ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(`ws://localhost:${PORT}`);
const replies = new Map();
let snap = null;
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "snapshot") snap = m;
  else if (m.type === "testHookResult") replies.set(m.op, m);
});
const hook = async (op, args = {}) => {
  replies.delete(op);
  ws.send(JSON.stringify({ type: "testHook", op, ...args }));
  for (let i = 0; i < 300 && !replies.has(op); i++) await sleep(10);
  return replies.get(op);
};
await new Promise((r) => ws.on("open", r));
while (!snap) await sleep(20);
const tc = snap.townCenters[0];
const cx = tc.x + dx;
const cy = tc.y + dy;
for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 5; x <= cx + 4; x++) await hook("setTileRaw", { tx: x, ty: y, tile: 0 });
const site = await hook("stampTestSite", { cx, cy });
if (!site) {
  console.log("No reply: is the server running with COLONY_TEST_HOOKS=1?");
  process.exit(1);
}
for (const [x, y] of [[cx - 1, cy - 1], [cx + 1, cy + 1]]) await hook("spawnMob", { kind: "banditClubman", tx: x, ty: y, siteId: site.siteId });
console.log(`Test fort ${site.siteId} at (${cx}, ${cy}): gate (${site.gate.x}, ${site.gate.y}), tower (${site.tower.x}, ${site.tower.y})`);
ws.close();
process.exit(0);
