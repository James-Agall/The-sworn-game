// Lossless PNG decode / encode in the browser (a port of scripts/lib/png.mjs on top of Compression/DecompressionStream).
// The Lab keeps part pixels as raw straight-alpha RGBA, never round-tripping them through a canvas (canvas premultiplies
// alpha, which would alter the soft-alpha edges of the painted parts on every edit).
export type RGBA = { w: number; h: number; data: Uint8ClampedArray };

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function decodePNG(buf: Uint8Array): Promise<RGBA> {
  if (!SIG.every((v, i) => buf[i] === v)) throw new Error("not a PNG");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = dv.getUint32(pos), type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8)), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === "PLTE") plte = body; else if (type === "tRNS") trns = body; else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (interlace) throw new Error("interlaced PNG not supported");
  const chans = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype], bpp = Math.max(1, (chans * depth) >> 3), stride = (w * chans * depth + 7) >> 3;
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of idat) { all.set(c, o); o += c.length; }
  const raw = await pipe(all, new DecompressionStream("deflate")), px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst - stride + i] : 0, c = i >= bpp && y ? px[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const sample = (x: number, y: number, ch: number) => {
    if (depth === 8) return px[y * stride + x * chans + ch];
    if (depth === 16) return px[y * stride + (x * chans + ch) * 2];
    const bits = x * chans * depth + ch * depth, byte = px[y * stride + (bits >> 3)];
    return (byte >> (8 - depth - (bits & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4;
    if (ctype === 6) { for (let k = 0; k < 4; k++) out[q + k] = sample(x, y, k); }
    else if (ctype === 2) { for (let k = 0; k < 3; k++) out[q + k] = sample(x, y, k); out[q + 3] = 255; }
    else if (ctype === 0) { const v = depth < 8 ? sample(x, y, 0) * (255 / ((1 << depth) - 1)) : sample(x, y, 0); out[q] = out[q + 1] = out[q + 2] = v; out[q + 3] = 255; }
    else if (ctype === 4) { out[q] = out[q + 1] = out[q + 2] = sample(x, y, 0); out[q + 3] = sample(x, y, 1); }
    else { const i = sample(x, y, 0); out[q] = plte![i * 3]; out[q + 1] = plte![i * 3 + 1]; out[q + 2] = plte![i * 3 + 2]; out[q + 3] = trns && i < trns.length ? trns[i] : 255; }
  }
  return { w, h, data: out };
}

export async function encodePNG(img: RGBA): Promise<Uint8Array> {
  const { w, h, data } = img, raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const z = await pipe(raw, new CompressionStream("deflate"));
  const chunk = (type: string, body: Uint8Array) => {
    const b = new Uint8Array(body.length + 12), dv = new DataView(b.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(body, 8);
    dv.setUint32(8 + body.length, crc32(b.subarray(4, 8 + body.length)));
    return b;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array(SIG), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function fetchPNG(url: string): Promise<RGBA> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return decodePNG(new Uint8Array(await r.arrayBuffer()));
}
export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const blank = (w: number, h: number): RGBA => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
export const cloneImg = (i: RGBA): RGBA => ({ w: i.w, h: i.h, data: new Uint8ClampedArray(i.data) });

/** Display canvas for an image (cached per image object; images are treated as immutable). */
const canvases = new WeakMap<RGBA, HTMLCanvasElement>();
export function toCanvas(img: RGBA): HTMLCanvasElement {
  let c = canvases.get(img);
  if (!c) {
    c = document.createElement("canvas"); c.width = img.w; c.height = img.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
    canvases.set(img, c);
  }
  return c;
}
/** Read an image the user picked (any format the browser decodes). PNGs are decoded losslessly. */
export async function fileToImg(file: File): Promise<RGBA> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (SIG.every((v, i) => buf[i] === v)) return decodePNG(buf);
  const bmp = await createImageBitmap(new Blob([buf]));
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d")!; g.drawImage(bmp, 0, 0);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}
