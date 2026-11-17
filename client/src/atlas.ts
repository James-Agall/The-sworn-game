// Perf plan phase 4: texture loading through the sprite atlas (scripts/pack-atlas.mjs -> public/atlas/).
// `loadTexture(url)` / `loadTextures(urls)` are drop-in replacements for `Assets.load<Texture>(...)`: a URL the
// manifest knows comes out of one of a handful of big sheets (no request of its own), anything else (or no atlas
// built at all) falls back to a normal Assets.load, so a missing atlas only costs speed, never correctness.
// One Texture per URL, shared, as Assets.load gave.
import { Assets, Rectangle, Texture } from "pixi.js";

interface Manifest {
  sheets: string[];
  frames: Record<string, [number, number, number, number, number]>;
}

let manifestPromise: Promise<Manifest | null> | null = null;
const sheetTextures = new Map<number, Promise<Texture>>();
const frameTextures = new Map<string, Texture>();

function manifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch("/atlas/manifest.json")
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

function sheet(m: Manifest, i: number): Promise<Texture> {
  let p = sheetTextures.get(i);
  if (!p) {
    p = Assets.load<Texture>(m.sheets[i]).then((t) => {
      t.source.scaleMode = "nearest";
      return t;
    });
    sheetTextures.set(i, p);
  }
  return p;
}

async function fromAtlas(m: Manifest, url: string): Promise<Texture | null> {
  const known = frameTextures.get(url);
  if (known) return known;
  const f = m.frames[url];
  if (!f) return null;
  const base = await sheet(m, f[0]);
  const again = frameTextures.get(url);
  if (again) return again;
  const texture = new Texture({ source: base.source, frame: new Rectangle(f[1], f[2], f[3], f[4]) });
  frameTextures.set(url, texture);
  return texture;
}

export async function loadTexture(url: string): Promise<Texture> {
  const m = await manifest();
  const hit = m ? await fromAtlas(m, url) : null;
  return hit ?? Assets.load<Texture>(url);
}

export async function loadTextures(urls: string[]): Promise<Record<string, Texture>> {
  const m = await manifest();
  const out: Record<string, Texture> = {};
  const misses: string[] = [];
  await Promise.all(
    urls.map(async (url) => {
      const hit = m ? await fromAtlas(m, url) : null;
      if (hit) out[url] = hit;
      else misses.push(url);
    })
  );
  if (misses.length) Object.assign(out, await Assets.load<Texture>(misses));
  return out;
}
