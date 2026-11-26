// Rebuild tools/sprite-lab/piskel-dist/ from the vendored Piskel source (tools/sprite-lab/vendor/piskel/).
//
//   node tools/sprite-lab/scripts/build-piskel.mjs [--work <empty scratch dir>]
//
// Third-party build code is untrusted, so the build runs in a fresh scratch copy, never inside the repo:
//   1. copy vendor/piskel/ to <work>/piskel (default: a new mkdtemp folder under the OS temp dir)
//   2. npm ci --ignore-scripts (no install hooks run) in that copy
//   3. node scripts/sprite.js, then vite build (Piskel's own build steps; scripts/partials.js is for piskelapp.com, skipped)
//   4. copy dest/prod to piskel-dist/ WITHOUT source maps and without the unminified bundle (index.html loads only the
//      -min bundle), and strip the sourceMappingURL comment
// Needs network access for npm ci. The result is committed so `npm run lab` needs no build.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(LAB, "vendor", "piskel"), OUT = path.join(LAB, "piskel-dist");
const args = process.argv.slice(2), wi = args.indexOf("--work");
const work = wi >= 0 ? path.resolve(args[wi + 1]) : mkdtempSync(path.join(os.tmpdir(), "sprite-lab-piskel-build-"));
if (existsSync(work) && readdirSync(work).length) { console.error(`--work ${work} must be a new empty folder`); process.exit(2); }
mkdirSync(work, { recursive: true });
const dir = path.join(work, "piskel");
console.log(`build folder: ${dir}`);
cpSync(SRC, dir, { recursive: true });
const run = (cmd, a) => execFileSync(cmd, a, { cwd: dir, stdio: "inherit", env: { ...process.env, CI: "1", HUSKY: "0" } });
run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
run(process.execPath, ["scripts/sprite.js"]);
run(process.execPath, [path.join(dir, "node_modules", "vite", "bin", "vite.js"), "build"]);

const prod = path.join(dir, "dest", "prod");
rmSync(OUT, { recursive: true, force: true });
cpSync(prod, OUT, {
  recursive: true,
  filter: (p) => !p.endsWith(".map") && !(/piskel-packaged-\d/.test(path.basename(p)) && p.endsWith(".js")) && !p.includes(`${path.sep}piskelapp-partials`),
});
for (const f of readdirSync(path.join(OUT, "js"))) {
  const p = path.join(OUT, "js", f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"));
}
const size = (p) => statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : statSync(p).size;
console.log(`piskel-dist: ${(size(OUT) / 1024).toFixed(0)} KiB written to ${OUT}`);
console.log(`(scratch build left in ${work}; delete it when done)`);
