// Raid march fix: in-process regression (raid-march-regression.mts); no server needed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const save = mkdtempSync(path.join(tmpdir(), "colony-raid-march-"));
const r = spawnSync(process.execPath, ["--import", "tsx", "raid-march-regression.mts"], {
  cwd: import.meta.dirname,
  env: { ...process.env, COLONY_TEST_HOOKS: "1", COLONY_SAVE_DIR: save },
  stdio: "inherit",
});
rmSync(save, { recursive: true, force: true });
process.exit(r.status ?? 1);
