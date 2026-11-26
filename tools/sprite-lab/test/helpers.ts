// Test helpers: scratch copies of the rig folder (tests never touch the real repo) and a raw HTTP client
// (node:http, so Host / Origin can be set freely).
import { cp, mkdir, mkdtemp, readdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { REPO_DIR } from "../server/png.ts";

export { REPO_DIR };
export const PUBLIC = path.join(REPO_DIR, "client", "public");
export const TEMPLATE_DIRS = ["camps", "buildings", "settlements"];
const AREA_ART_DIRS = ["structure", "regions-v2", "regions-v3", "regions-v4", "towns-v2", "animals", "fortifications"];

/** A scratch Lab root with client/public/rig copied in (and optionally the hero frames the rig pages load). */
export async function scratchRoot(opts: { sprites?: boolean; templates?: boolean; areaArt?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sprite-lab-test-"));
  await mkdir(path.join(dir, "client", "public"), { recursive: true });
  await cp(path.join(PUBLIC, "rig"), path.join(dir, "client", "public", "rig"), { recursive: true });
  // Area tab: the game's template folders (built-ins + their user/ folders, which are empty in the repo)
  if (opts.templates) for (const k of TEMPLATE_DIRS) await cp(path.join(REPO_DIR, "server", "data", k), path.join(dir, "server", "data", k), { recursive: true });
  // Area tab art: the top-level sprites and the folders the tile tables use (~26 MB; not autumn / hero-npc)
  if (opts.areaArt) {
    const src = path.join(PUBLIC, "sprites"), dst = path.join(dir, "client", "public", "sprites");
    await mkdir(dst, { recursive: true });
    for (const e of await readdir(src, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".png")) await cp(path.join(src, e.name), path.join(dst, e.name));
      else if (e.isDirectory() && AREA_ART_DIRS.includes(e.name)) await cp(path.join(src, e.name), path.join(dst, e.name), { recursive: true });
    }
  }
  if (opts.sprites) {
    const heroes = path.join("sprites", "autumn", "frames", "heroes");
    await cp(path.join(PUBLIC, heroes), path.join(dir, "client", "public", heroes), { recursive: true });
    // + the quest markers client/src/worldVisuals.ts loads when the Area tab imports its tile-art tables
    for (const f of ["archer.png", "villager.png", "ui-questNew.png", "ui-questActive.png"]) await cp(path.join(PUBLIC, "sprites", f), path.join(dir, "client", "public", "sprites", f)).catch(() => {});
  }
  return dir;
}

export type Res = { status: number; headers: http.IncomingHttpHeaders; body: Buffer; json(): any };
export function request(url: string, o: { method?: string; headers?: Record<string, string>; body?: string | Buffer; rawPath?: string } = {}): Promise<Res> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, method: o.method || "GET", path: o.rawPath ?? u.pathname + u.search, headers: o.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const body = Buffer.concat(chunks); resolve({ status: res.statusCode || 0, headers: res.headers, body, json: () => JSON.parse(body.toString("utf8")) }); });
    });
    r.on("error", reject);
    if (o.body) r.write(o.body);
    r.end();
  });
}

/** A same-origin write the way the Lab app sends it. */
export function write(base: string, p: string, body: unknown, method = "POST", extra: Record<string, string> = {}): Promise<Res> {
  const u = new URL(base);
  return request(new URL(p, base).href, {
    method, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: u.origin, "X-Lab": "1", ...extra },
  });
}
