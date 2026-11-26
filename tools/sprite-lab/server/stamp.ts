// "Preview stamp" with the REAL server stamper: runs stamper/worker.ts in a child process (the repo's own tsx, cwd
// <repo>/server, a scratch COLONY_SAVE_DIR deleted afterwards, COLONY_TEST_HOOKS=1, no port), with the Lab root's user
// building templates visible to the game's building store (settlements may reference them). Never touches saves.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError, templateUserBase } from "./paths.ts";
import { REPO_DIR } from "./png.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, "stamper", "worker.ts"), ALIAS = path.join(HERE, "stamper", "alias.mjs");
export const STAMP_WORLD_SIZE = 160;
let busy = false;

export async function realStamp(root: string, body: Record<string, unknown>) {
  const { kind, template, transform = 0, seed = 1, tier = 1, samples = 6 } = body as { kind?: unknown; template?: unknown; transform?: unknown; seed?: unknown; tier?: unknown; samples?: unknown };
  if (kind !== "camps" && kind !== "settlements" && kind !== "sites" && kind !== "pois") throw new HttpError(400, "the real stamper previews camps, settlements, sites and POI pools");
  if (!Number.isInteger(tier) || (tier as number) < 1 || (tier as number) > 4) throw new HttpError(400, "tier: 1-4");
  if (!Number.isInteger(samples) || (samples as number) < 1 || (samples as number) > 12) throw new HttpError(400, "samples: 1-12");
  if (!template || typeof template !== "object" || Array.isArray(template)) throw new HttpError(400, "template must be an object");
  if (!Number.isInteger(transform) || (transform as number) < 0 || (transform as number) > 7) throw new HttpError(400, "transform: 0-7");
  if (!Number.isInteger(seed) || (seed as number) < 1 || (seed as number) > 2 ** 31) throw new HttpError(400, "seed: a positive integer");
  if (busy) throw new HttpError(429, "a stamp preview is already running");
  busy = true;
  const scratch = await mkdtemp(path.join(os.tmpdir(), "sprite-lab-stamp-"));
  try {
    const tsx = import.meta.resolve("tsx");
    const env: Record<string, string> = {
      PATH: process.env.PATH || "", HOME: scratch, COLONY_SAVE_DIR: path.join(scratch, "saves"), COLONY_TEST_HOOKS: "1",
      COLONY_WORLD_SIZE: String(STAMP_WORLD_SIZE),
      COLONY_CAMP_USER_DIR: path.join(root, ...templateUserBase("camps")),
      COLONY_BUILDING_USER_DIR: path.join(root, ...templateUserBase("buildings")),
      COLONY_SETTLEMENT_USER_DIR: path.join(root, ...templateUserBase("settlements")),
      COLONY_SITE_USER_DIR: path.join(root, ...templateUserBase("sites")),
      COLONY_POI_USER_DIR: path.join(root, ...templateUserBase("pois")),
      COLONY_CASTLE_RUIN_USER_DIR: path.join(root, ...templateUserBase("castle-ruins")),
    };
    const out = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["--import", tsx, "--import", ALIAS, WORKER], {
        cwd: path.join(REPO_DIR, "server"), env, timeout: 60_000, maxBuffer: 32 << 20, shell: false,
      }, (err, stdout, stderr) => {
        if (err && !String(stdout).includes("@@RESULT@@")) reject(new HttpError(500, `stamper process failed: ${String(stderr).slice(-1500) || err.message}`));
        else resolve(String(stdout));
      });
      child.stdin!.end(JSON.stringify({ kind, template, transform, seed, tier, samples }));
    });
    const i = out.lastIndexOf("@@RESULT@@");
    if (i < 0) throw new HttpError(500, "stamper printed no result");
    const r = JSON.parse(out.slice(i + 10).trim());
    return { ...r, source: "server-stamper", log: out.slice(0, i).trim().split("\n").filter(Boolean).slice(-20) };
  } finally {
    busy = false;
    await rm(scratch, { recursive: true, force: true });
  }
}
