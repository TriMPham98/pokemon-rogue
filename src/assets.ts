import * as THREE from 'three';
import { decompressFrames, parseGIF } from 'gifuct-js';

// Populated by `npm run assets` (runs automatically before dev/build).
const BASE = `${import.meta.env.BASE_URL}assets`;

export const url = {
  front: (dex: number, shiny = false) => `${BASE}/sprites/front/${shiny ? 'shiny/' : ''}${dex}.png`,
  back: (dex: number, shiny = false) => `${BASE}/sprites/back/${shiny ? 'shiny/' : ''}${dex}.png`,
  anim: (dex: number, back: boolean, shiny = false) => `${BASE}/sprites/anim/${back ? 'back' : 'front'}/${shiny ? 'shiny/' : ''}${dex}.gif`,
  trainer: (name: string) => `${BASE}/trainer/${name}.png`,
  fx: (name: string) => `${BASE}/fx/${name}.png`,
  item: (name: string) => `${BASE}/items/${name}.png`,
  cry: (id: string) => `${BASE}/cries/${id}.mp3`,
  musicMidi: (name: string) => `${BASE}/music/${name}.mid`,
  musicData: (name: string) => `${BASE}/music/${name}.json`,
  musicSample: (name: string) => `${BASE}/music/samples/${name}.wav`,
};

/** A texture cropped to its opaque pixels; w/h are the cropped size in source pixels. */
export interface SpriteTex {
  tex: THREE.Texture;
  w: number;
  h: number;
  canvas: HTMLCanvasElement;
  icon?: string; // cropped image as a data URL for DOM cards, built on first use
  white?: THREE.Texture;
}

const cache = new Map<string, SpriteTex>();
let missing = 0;
let fallback: SpriteTex | undefined;

function placeholder(): SpriteTex {
  if (fallback) return fallback;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff4fd8';
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('?', 16, 23);
  return (fallback = { tex: new THREE.CanvasTexture(c), w: 32, h: 32, canvas: c });
}

function trim(img: HTMLImageElement, pixelArt: boolean): SpriteTex {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) (x0 = 0), (y0 = 0), (x1 = width - 1), (y1 = height - 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = pixelArt ? THREE.NearestFilter : THREE.LinearFilter;
  return { tex, w, h, canvas: out };
}

async function load(src: string) {
  if (cache.has(src)) return;
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    cache.set(src, trim(img, !src.includes('/fx/')));
  } catch {
    missing++;
    cache.set(src, placeholder());
  }
}

export async function preload(srcs: string[], onProgress: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(srcs.map((s) => load(s).then(() => onProgress(++done, srcs.length))));
  return missing;
}

/** Synchronous lookup; everything is preloaded before the game starts. */
export function getTex(src: string): SpriteTex {
  return cache.get(src) ?? placeholder();
}

/** Solid white silhouette of a sprite, for the evolution sequence. Built on first use. */
export function silhouette(src: string): THREE.Texture {
  const st = getTex(src);
  if (st.white) return st.white;
  const c = document.createElement('canvas');
  c.width = st.w;
  c.height = st.h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(st.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = st.tex.magFilter;
  return (st.white = tex);
}

/** Cropped sprite for <img> tags, so small Pokémon don't drown in padding. */
export function icon(src: string) {
  const st = getTex(src);
  return (st.icon ??= st.canvas.toDataURL());
}

/** An animated sprite decoded into a grid sheet; frames share one texture and are picked via UV offset. */
export interface AnimSheet {
  tex: THREE.Texture;
  frames: number;
  cols: number;
  rows: number;
  w: number; // cell size in source pixels (union of every frame's opaque area)
  h: number;
  ends: number[]; // cumulative frame end times in seconds
  total: number;
}

const anims = new Map<string, AnimSheet | null>();

/**
 * Synchronous lookup that kicks off a background decode on first request. Returns undefined until the
 * sheet is ready (callers show the static sprite meanwhile) and null if the GIF is unavailable.
 */
export function getAnim(src: string): AnimSheet | null | undefined {
  const a = anims.get(src);
  if (a !== undefined) return a;
  if (!decoding.has(src)) {
    decoding.add(src);
    void decodeAnim(src).catch(() => null).then((r) => anims.set(src, r));
  }
  return undefined;
}
const decoding = new Set<string>();

async function decodeAnim(src: string): Promise<AnimSheet | null> {
  const res = await fetch(src);
  if (!res.ok) return null;
  const gif = parseGIF(await res.arrayBuffer());
  const frames = decompressFrames(gif, true);
  if (!frames.length) return null;
  const W = gif.lsd.width, H = gif.lsd.height;

  // Composite each frame onto the logical screen, honouring GIF disposal, to get full images.
  const screen = document.createElement('canvas');
  screen.width = W;
  screen.height = H;
  const sctx = screen.getContext('2d', { willReadFrequently: true })!;
  const patch = document.createElement('canvas');
  const pctx = patch.getContext('2d')!;
  const full: ImageData[] = [];
  const delays: number[] = [];
  for (const f of frames) {
    const { width, height, left, top } = f.dims;
    const before = f.disposalType === 3 ? sctx.getImageData(0, 0, W, H) : null;
    patch.width = width;
    patch.height = height;
    pctx.putImageData(new ImageData(new Uint8ClampedArray(f.patch), width, height), 0, 0);
    sctx.drawImage(patch, left, top);
    full.push(sctx.getImageData(0, 0, W, H));
    delays.push(Math.max(20, f.delay || 100) / 1000);
    if (f.disposalType === 2) sctx.clearRect(left, top, width, height);
    else if (before) sctx.putImageData(before, 0, 0);
  }

  // Crop every frame to the union of their opaque pixels so the feet stay planted on the ground.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const img of full) {
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cols = Math.ceil(Math.sqrt(full.length)), rows = Math.ceil(full.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * w;
  sheet.height = rows * h;
  const ctx = sheet.getContext('2d')!;
  full.forEach((img, i) => ctx.putImageData(img, (i % cols) * w - x0, Math.floor(i / cols) * h - y0, x0, y0, w, h));

  const tex = new THREE.CanvasTexture(sheet);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter; // linear would bleed neighbouring frames in at the cell edges
  tex.magFilter = THREE.NearestFilter;
  let t = 0;
  const ends = delays.map((d) => (t += d));
  return { tex, frames: full.length, cols, rows, w, h, ends, total: t };
}

/** Per-instance view of a shared sheet (own UV offset, same GPU texture). */
export function sheetView(a: AnimSheet) {
  const tex = a.tex.clone();
  tex.repeat.set(1 / a.cols, 1 / a.rows);
  return tex;
}

/**
 * Points `tex` at the frame of `a` that's showing at time `t` (seconds, loops), mirrored if `flip`.
 * Sprites ignore a negative scale (three.js takes the length of the scale), so mirroring happens in UV space.
 */
export function setFrame(tex: THREE.Texture, a: AnimSheet, t: number, flip = false) {
  const tt = ((t % a.total) + a.total) % a.total;
  let i = 0;
  while (i < a.frames - 1 && a.ends[i] <= tt) i++;
  const col = i % a.cols, row = Math.floor(i / a.cols);
  tex.repeat.x = (flip ? -1 : 1) / a.cols;
  tex.offset.set((col + (flip ? 1 : 0)) / a.cols, 1 - (row + 1) / a.rows);
}
