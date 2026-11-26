// npm run lab  [-- --port 5180] [--root <dir>]   (env: PORT, LAB_ROOT)
// Starts the Sprite Lab on http://127.0.0.1:<port>/ (127.0.0.1 only) and prints the URL.
import { startLab } from "./lab.ts";
import { REPO_DIR } from "./png.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1]; };
const port = Number(opt("--port") ?? process.env.PORT ?? 5180);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("bad port"); process.exit(2); }
if ([8080, 5173, 5175].includes(port)) { console.error(`port ${port} belongs to the game / other dev servers; pick another`); process.exit(2); }
const root = opt("--root") ?? process.env.LAB_ROOT ?? REPO_DIR;

const lab = await startLab({ root, port, log: (s) => console.log(`[lab] ${s}`) });
console.log(`Sprite Lab running at ${lab.url}`);
console.log(`  root: ${lab.root}${lab.root === REPO_DIR ? " (this repo: saves go into client/public/rig/parts/, backups in art-sources/lab/backups/)" : ""}`);
console.log("  Ctrl+C to stop");
const stop = () => { lab.close().finally(() => process.exit(0)); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
