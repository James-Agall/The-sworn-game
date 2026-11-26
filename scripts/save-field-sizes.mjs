#!/usr/bin/env node
// Read-only: which fields of a save's world state are big, and which grow between saves.
//   node scripts/save-field-sizes.mjs <save.json> [<later save.json> ...]
// Prints every state field's JSON size per file (largest first) and the average growth per file step, plus a few
// counts (mobs by kind, raid groups, colonists, wildlife). Only reads the files given; point it at COPIES of saves.
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/save-field-sizes.mjs <save.json> [<later save.json> ...]");
  process.exit(1);
}
const saves = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const sizes = saves.map((s) => Object.fromEntries(Object.entries(s.state).map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0])));
const last = sizes.at(-1);
const keys = [...new Set(sizes.flatMap(Object.keys))].sort((a, b) => (last[b] ?? 0) - (last[a] ?? 0));
const kib = (n) => (n / 1024).toFixed(1).padStart(9);
console.log("field".padEnd(24) + files.map((_, i) => `#${i + 1} KiB`.padStart(9)).join("") + (files.length > 1 ? "  KiB/step".padStart(11) : ""));
for (const k of keys) {
  const row = sizes.map((s) => s[k] ?? 0);
  const step = files.length > 1 ? (row.at(-1) - row[0]) / (files.length - 1) : 0;
  if (Math.max(...row) < 1024 && Math.abs(step) < 256) continue;
  console.log(k.padEnd(24) + row.map(kib).join("") + (files.length > 1 ? kib(step).padStart(11) : ""));
}
for (const [i, s] of saves.entries()) {
  const kinds = {};
  for (const m of s.state.mobs ?? []) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  console.log(
    `#${i + 1} day ${s.dayIndex + 1}: ${s.state.mobs?.length ?? 0} mobs ${JSON.stringify(kinds)}, ${s.state.raidGroups?.length ?? 0} raid groups, ` +
      `${s.state.colonists?.length ?? 0} colonists, ${s.state.wildlife?.length ?? 0} wildlife, ${s.state.townCenters?.length ?? 0} town centres`
  );
}
