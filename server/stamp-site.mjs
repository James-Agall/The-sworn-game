// Forts phase B browser-check helper: stamps a real fort template (testHook stampSite) near the first Town
// Center, so you can walk to it, and lists every fort on the map. The server must run with
// COLONY_TEST_HOOKS=1 (and, for safety, a scratch COLONY_SAVE_DIR).
//   PORT=<server port> node stamp-site.mjs [thornwick|grakkar|hearthmoor|ironhold|riverwatch|list] [dx] [dy]
// Forts phase C: hearthmoor / ironhold / riverwatch stamp a neutral human settlement.
// dx / dy: offset of the fort centre from the first Town Center in tiles (default 30, 0); it looks up to 45
// tiles around that spot for clear ground. "list" only prints the forts world-gen placed.
import WebSocket from "ws";

const PORT = process.env.PORT ?? 8080;
const template = process.argv[2] ?? "thornwick";
const dx = Number(process.argv[3] ?? 30);
const dy = Number(process.argv[4] ?? 0);
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
  for (let i = 0; i < 500 && !replies.has(op); i++) await sleep(10);
  return replies.get(op);
};
await new Promise((r) => ws.on("open", r));
while (!snap) await sleep(20);
const tc = snap.townCenters[0];
if (template !== "list") {
  const r = await hook("stampSite", { template, dx, dy, search: 45 });
  if (!r) {
    console.log("No reply: is the server running with COLONY_TEST_HOOKS=1?");
    process.exit(1);
  }
  if (!r.site) console.log(`Could not stamp ${template} near (${tc.x + dx}, ${tc.y + dy}): ${r.problem}`);
  else console.log(`Stamped ${r.site.name}: keep at (${r.site.keepX}, ${r.site.keepY}), ${r.site.keepX - tc.x} / ${r.site.keepY - tc.y} tiles from the Town Center`);
}
const st = await hook("sitesState");
for (const s of st?.sites ?? []) {
  const d = Math.hypot(s.keepX - tc.x, s.keepY - tc.y);
  const human = s.faction === "human" ? `, ${s.template}, ${s.provoked ? "HOSTILE" : "neutral"}, relation ${s.relation}` : "";
  console.log(`  ${s.name} (${s.faction}, tier ${s.tier}${human}) keep (${s.keepX}, ${s.keepY}), ${d.toFixed(0)} tiles away (dx ${s.keepX - tc.x}, dy ${s.keepY - tc.y}), garrison ${s.alive.length - (s.workerMobs?.length ?? 0)}/${s.garrisonMax}${s.cleared ? ", cleared" : ""}`);
}
ws.close();
process.exit(0);
