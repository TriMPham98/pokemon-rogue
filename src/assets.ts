import * as THREE from 'three';

// Populated by `npm run assets` (runs automatically before dev/build).
const BASE = `${import.meta.env.BASE_URL}assets`;

export const url = {
  front: (dex: number) => `${BASE}/sprites/front/${dex}.png`,
  back: (dex: number) => `${BASE}/sprites/back/${dex}.png`,
  fx: (name: string) => `${BASE}/fx/${name}.png`,
  item: (name: string) => `${BASE}/items/${name}.png`,
  cry: (id: string) => `${BASE}/cries/${id}.mp3`,
  music: (name: string) => `${BASE}/music/${name}.mp3`,
};

/** A texture cropped to its opaque pixels; w/h are the cropped size in source pixels. */
export interface SpriteTex {
  tex: THREE.Texture;
  w: number;
  h: number;
  icon: string; // cropped image as a data URL, for DOM cards
  canvas: HTMLCanvasElement;
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
  return (fallback = { tex: new THREE.CanvasTexture(c), w: 32, h: 32, icon: c.toDataURL(), canvas: c });
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
  return { tex, w, h, icon: out.toDataURL(), canvas: out };
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
export const icon = (src: string) => getTex(src).icon;
