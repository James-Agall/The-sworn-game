// npm run lab:validate -- <set> [--root <dir>] [--json]
// Prints the validator report for client/public/rig/parts/<set>/ and exits 1 when any check fails (warnings do not fail).
import { realpathSync } from "node:fs";
import { formatReport } from "../shared/validators.ts";
import { validateSetOnDisk } from "../server/sets.ts";
import { REPO_DIR } from "../server/png.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k: string) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const root = realpathSync(opt("--root") || process.env.LAB_ROOT || REPO_DIR), json = flag("--json");
const sets = args;
if (!sets.length) { console.error("usage: npm run lab:validate -- <set> [<set> ...] [--root dir] [--json]"); process.exit(2); }
let failed = false;
for (const set of sets) {
  try {
    const r = await validateSetOnDisk(root, set);
    console.log(json ? JSON.stringify(r, null, 1) : formatReport(r));
    if (r.level === "fail") failed = true;
  } catch (e) {
    console.error(`${set}: ${(e as Error).message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
