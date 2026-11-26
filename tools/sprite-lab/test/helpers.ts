// Test helpers: scratch copies of the rig folder (tests never touch the real repo) and a raw HTTP client
// (node:http, so Host / Origin can be set freely).
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { REPO_DIR } from "../server/png.ts";

export { REPO_DIR };
export const PUBLIC = path.join(REPO_DIR, "client", "public");

/** A scratch Lab root with client/public/rig copied in (and optionally the hero frames the rig pages load). */
export async function scratchRoot(opts: { sprites?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sprite-lab-test-"));
  await mkdir(path.join(dir, "client", "public"), { recursive: true });
  await cp(path.join(PUBLIC, "rig"), path.join(dir, "client", "public", "rig"), { recursive: true });
  if (opts.sprites) {
    const heroes = path.join("sprites", "autumn", "frames", "heroes");
    await cp(path.join(PUBLIC, heroes), path.join(dir, "client", "public", heroes), { recursive: true });
    for (const f of ["archer.png", "villager.png"]) await cp(path.join(PUBLIC, "sprites", f), path.join(dir, "client", "public", "sprites", f)).catch(() => {});
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
