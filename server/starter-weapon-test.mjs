// Scripted test: every player starts able to fight (2026-11-27). A profile with no weapon at all (equipped or in the
// pack) gets a plain tier-1 sword, equipped, once: the flag is saved, so a dropped or sold sword is never granted again;
// old saves without the flag get it on next use; a pack weapon counts; heroes ("hero:<id>") never get one.
// Runs server/starter-weapon-regression.mts in-process (no network, no ports, no saves).
import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, ["--import", "tsx", "starter-weapon-regression.mts"], {
  cwd: import.meta.dirname,
  env: { ...process.env, COLONY_TEST_HOOKS: "1" },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
