// Renders FireRed/LeafGreen tileset metatiles (pret/pokefirered data/tilesets) into RGBA images, and the minimal
// PNG codec it needs (indexed 4/8-bit in, RGBA out) so the asset script stays dependency-free.
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  w: number;
  h: number;
  px: Uint8Array; // RGBA
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Decodes a non-interlaced indexed PNG (bit depth 4 or 8) to palette indices. */
export function decodeIndexedPng(buf: Uint8Array): { w: number; h: number; idx: Uint8Array; plte: number[][] } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat: Uint8Array[] = [];
  const plte: number[][] = [];
  while (p < buf.length) {
    const len = dv.getUint32(p);
    const t = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') (w = dv.getUint32(p + 8)), (h = dv.getUint32(p + 12)), (depth = d[8]), (type = d[9]);
    if (t === 'IDAT') idat.push(d);
    if (t === 'PLTE') for (let i = 0; i + 2 < d.length; i += 3) plte.push([d[i], d[i + 1], d[i + 2]]);
    p += 12 + len;
  }
  if (type !== 3 && type !== 0) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((w * depth) / 8);
  const bpp = 1;
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const idx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) idx[y * w + x] = depth === 4 ? (out[y * stride + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : out[y * stride + x];
  return { w, h, idx, plte };
}

/** An object-event sprite sheet (indexed, colour 0 transparent): crops frame 0 of `fw`×`fh` to RGBA. */
export function spriteFrame(buf: Uint8Array, fw: number, fh: number): Image {
  const { w, idx, plte } = decodeIndexedPng(buf);
  const img = { w: fw, h: fh, px: new Uint8Array(fw * fh * 4) };
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const c = idx[y * w + x];
      if (c && plte[c]) img.px.set([...plte[c], 255], (y * fw + x) * 4);
    }
  return img;
}

export function encodePng(img: Image): Buffer {
  const chunk = (t: string, d: Uint8Array) => {
    const b = Buffer.alloc(12 + d.length);
    b.writeUInt32BE(d.length, 0);
    b.write(t, 4, 'ascii');
    Buffer.from(d).copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4)).copy(raw, y * (img.w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

/** JASC-PAL → [r, g, b][] */
export const parsePal = (text: string) =>
  text.trim().split(/\r?\n/).slice(3).map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);

/** A primary + secondary tileset pair, as a map uses them. */
export interface Tileset {
  tiles: { w: number; idx: Uint8Array }[]; // [primary, secondary] tile sheets, 8×8 tiles in rows of w/8
  metatiles: Uint16Array[]; // [primary, secondary]
  pals: [number, number, number][][]; // 16 palettes: 0-6 primary, 7-12 secondary
}

const PRIMARY_TILES = 640; // FRLG: tiles and metatiles past 640 come from the secondary tileset
const PRIMARY_PALS = 7;

export function makeTileset(
  primary: { tiles: Uint8Array; meta: Uint8Array; pals: string[] },
  secondary: { tiles: Uint8Array; meta: Uint8Array; pals: string[] },
): Tileset {
  const t0 = decodeIndexedPng(primary.tiles), t1 = decodeIndexedPng(secondary.tiles);
  const u16 = (b: Uint8Array) => new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const pals = Array.from({ length: 16 }, (_, i) => parsePal((i < PRIMARY_PALS ? primary.pals[i] : secondary.pals[i]) ?? 'JASC-PAL\n0100\n0\n'));
  return { tiles: [t0, t1], metatiles: [u16(primary.meta), u16(secondary.meta)], pals };
}

export const metatileCount = (ts: Tileset) => PRIMARY_TILES + ts.metatiles[1].length / 8;

function drawTile(ts: Tileset, ref: number, img: Image, ox: number, oy: number) {
  const tile = ref & 0x3ff, hf = ref & 0x400, vf = ref & 0x800, pal = ts.pals[ref >> 12];
  const sheet = tile < PRIMARY_TILES ? ts.tiles[0] : ts.tiles[1];
  const t = tile < PRIMARY_TILES ? tile : tile - PRIMARY_TILES;
  const cols = sheet.w / 8, tx = (t % cols) * 8, ty = Math.floor(t / cols) * 8;
  if (ty >= sheet.idx.length / sheet.w) return;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const c = sheet.idx[(ty + (vf ? 7 - y : y)) * sheet.w + tx + (hf ? 7 - x : x)];
      if (!c || !pal?.[c]) continue; // colour 0 is transparent
      const o = ((oy + y) * img.w + ox + x) * 4;
      img.px.set([...pal[c], 255], o);
    }
}

/** Draws metatile `id` (both layers) at (ox, oy). `layers` picks bottom (0), top (1) or both. */
export function drawMetatile(ts: Tileset, id: number, img: Image, ox: number, oy: number, layers: 0 | 1 | 2 = 2) {
  const meta = id < PRIMARY_TILES ? ts.metatiles[0] : ts.metatiles[1];
  const m = id < PRIMARY_TILES ? id : id - PRIMARY_TILES;
  for (let l = 0; l < 2; l++) {
    if (layers !== 2 && layers !== l) continue;
    for (let i = 0; i < 4; i++) drawTile(ts, meta[m * 8 + l * 4 + i], img, ox + (i & 1) * 8, oy + (i >> 1) * 8);
  }
}

/**
 * Gives a canopy a trunk. On the map a tree's trunk is hidden by the tile row below it, so cut out on its own the
 * canopy ends flat, as if sunk into the ground. The trunk comes from FireRed's own round tree (general metatiles
 * 20/21/36/37): its brown pixels (red ≥ green; everything else there is leaves or shadow), drawn under the canopy.
 */
export function addTrunk(ts: Tileset, img: Image): Image {
  const src = renderGrid(ts, [[20, 21], [36, 37]]);
  const pts: [number, number][] = [];
  for (let y = 16; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const o = (y * 32 + x) * 4;
      if (src.px[o + 3] && src.px[o] >= src.px[o + 1]) pts.push([x, y]);
    }
  if (!pts.length) return img;
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  // Stretched to twice its height: on the map only its stub shows, standing up it needs to read as a trunk.
  const tw = x1 - x0 + 1, th = (y1 - y0 + 1) * 2;
  const hidden = 2; // tuck the top of the trunk under the leaves
  const out = { w: img.w, h: img.h + th - hidden, px: new Uint8Array(img.w * (img.h + th - hidden) * 4) };
  out.px.set(img.px);
  const ox = Math.round((img.w - tw) / 2), oy = img.h - hidden;
  for (const [x, y] of pts)
    for (const dy of [0, 1]) {
      const tx = ox + x - x0, ty = oy + (y - y0) * 2 + dy, o = (ty * out.w + tx) * 4;
      if (!out.px[o + 3]) out.px.set(src.px.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4), o);
    }
  return out;
}

/** Renders a grid of metatile ids (rows of columns; -1 = empty) into an image. */
export function renderGrid(ts: Tileset, grid: number[][], layers: 0 | 1 | 2 = 2): Image {
  const h = grid.length * 16, w = Math.max(...grid.map((r) => r.length)) * 16;
  const img = { w, h, px: new Uint8Array(w * h * 4) };
  grid.forEach((row, y) => row.forEach((id, x) => id >= 0 && drawMetatile(ts, id, img, x * 16, y * 16, layers)));
  return img;
}

/**
 * Renders an object (tree, sign, rock…) and cuts it out of its background. Map art paints objects over a ground
 * tile, so we flood-fill from the edges through every pixel identical to the ground (`bg` metatiles tiled
 * underneath): that removes the surroundings but keeps same-coloured pixels inside the object.
 */
export function renderCutout(ts: Tileset, grid: number[][], bg: number[]): Image {
  const img = renderGrid(ts, grid);
  const backs = bg.map((b) => renderGrid(ts, grid.map((r) => r.map(() => b))));
  const { w, h, px } = img;
  const isBg = (i: number) => px[i * 4 + 3] === 0 || backs.some((o) => o.px[i * 4] === px[i * 4] && o.px[i * 4 + 1] === px[i * 4 + 1] && o.px[i * 4 + 2] === px[i * 4 + 2]);
  const seen = new Uint8Array(w * h), stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !isBg(i)) continue;
    seen[i] = 1;
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  // Drop specks left over from the ground (stray grass tufts): opaque islands of a few pixels.
  const label = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (label[i] >= 0 || !px[i * 4 + 3]) continue;
    const comp: number[] = [], q = [i];
    label[i] = i;
    while (q.length) {
      const j = q.pop()!;
      comp.push(j);
      const x = j % w, y = (j / w) | 0;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (k >= 0 && label[k] < 0 && px[k * 4 + 3]) (label[k] = i), q.push(k);
    }
    if (comp.length < 12) for (const j of comp) px[j * 4 + 3] = 0;
  }
  return img;
}
