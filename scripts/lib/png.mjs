// png.mjs: minimal PNG decode / encode with no dependencies (node zlib only).
// decodePNG(buffer) -> { w, h, data: Uint8Array RGBA }, encodePNG({ w, h, data }) -> Buffer. 8-bit (and 16-bit) PNGs, any colour type, non-interlaced.
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0, plte = null, trns = null; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === "PLTE") plte = body; else if (type === "tRNS") trns = body; else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  if (interlace) throw new Error("interlaced PNG not supported");
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype], bpp = Math.max(1, (chans * depth) >> 3), stride = (w * chans * depth + 7) >> 3;
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
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
  const out = new Uint8Array(w * h * 4), sample = (x, y, ch) => { if (depth === 8) return px[y * stride + x * chans + ch]; if (depth === 16) return px[y * stride + (x * chans + ch) * 2]; const bits = x * chans * depth + ch * depth, byte = px[y * stride + (bits >> 3)]; return (byte >> (8 - depth - (bits & 7))) & ((1 << depth) - 1); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (ctype === 6) { for (let k = 0; k < 4; k++) out[o + k] = sample(x, y, k); }
    else if (ctype === 2) { for (let k = 0; k < 3; k++) out[o + k] = sample(x, y, k); out[o + 3] = 255; }
    else if (ctype === 0) { const v = depth < 8 ? sample(x, y, 0) * (255 / ((1 << depth) - 1)) : sample(x, y, 0); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
    else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = sample(x, y, 0); out[o + 3] = sample(x, y, 1); }
    else { const i = sample(x, y, 0); out[o] = plte[i * 3]; out[o + 1] = plte[i * 3 + 1]; out[o + 2] = plte[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255; }
  }
  return { w, h, data: out };
}
export function encodePNG({ w, h, data }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, body) => { const b = Buffer.alloc(body.length + 12); b.writeUInt32BE(body.length, 0); b.write(type, 4, "latin1"); body.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export const readPNG = (path) => decodePNG(readFileSync(path));
export const writePNG = (path, img) => writeFileSync(path, encodePNG(img));
