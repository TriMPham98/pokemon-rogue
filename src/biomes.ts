import * as THREE from 'three';
import { MUSIC, SPECIES_BY_ID, type Species } from './data';
import { type EnvName } from './env';
import { getTex, url } from './assets';
import { ARENA_R, GEO, mesh } from './models';

type Deco = 'meadow' | 'forest' | 'cave' | 'beach' | 'volcano' | 'tower';

/** A weighted encounter; `from` is the first round of the area (1-5) it can show up in. */
export interface Encounter {
  sp: Species;
  w: number;
  from: number;
}

export interface Biome {
  name: string;
  deco: Deco;
  ground: number;
  sky: number;
  light: number; // hemisphere intensity
  glow?: number; // cave crystals
  sun?: [color: number, intensity: number]; // overrides the deco's sunlight (Route 11's sunset)
  art: ArenaArt;
  wild: Encounter[]; // the area's 5th round ends with an evolved form of one of its basic Pokémon (see Game.leaderSpecies)
  music: string;
}

/**
 * Which FireRed art an arena is built from (see env.ts). Ground and decals lie flat on a 1-unit metatile grid;
 * props and the ring around the edge stand up as billboards, like the Pokémon.
 */
export interface ArenaArt {
  ground: EnvName[]; // metatiles for the floor, first ones most common
  outer?: EnvName[]; // floor beyond the arena (the sea at Cerulean Cape); defaults to `ground`
  path?: EnvName; // a winding route path across the arena
  patches?: [EnvName, number]; // blobs of e.g. tall grass, and how many
  decals?: [EnvName, number][]; // single flat tiles scattered around (flowers)
  props?: [EnvName, number, number?][]; // billboards inside the arena: art, count, scale
  ring: [EnvName, number, number?][]; // billboards walling in the arena: art, count, scale
  fence?: EnvName; // posts all the way around the edge
  tint?: number; // multiplies billboard colours (darker underground)
}

export const ROUNDS_PER_AREA = 5;

/**
 * Encounter table shorthand: "pidgey:4 pidgeotto:1@3" = Pidgey at weight 4, Pidgeotto at weight 1 from the
 * area's 3rd round on. Weight defaults to 1.
 */
function table(spec: string): Encounter[] {
  return spec.trim().split(/\s+/).map((tok) => {
    const [, id, w, from] = /^([a-z]+)(?::([\d.]+))?(?:@(\d))?$/.exec(tok) ?? [];
    const sp = SPECIES_BY_ID[id];
    if (!sp) throw new Error(`Unknown species in encounter table: ${tok}`);
    return { sp, w: w ? Number(w) : 1, from: from ? Number(from) : 1 };
  });
}

type AreaDef = Omit<Biome, 'wild' | 'music'> & { wild: string };

const GRASS: EnvName[] = ['grass', 'grass', 'grass', 'grass', 'grassTufts', 'grassTufts2'];

/**
 * Kanto in story order, a new area every 5 rounds; loops after Cerulean Cave.
 * Encounters follow where each Pokémon lives in Red/Blue/FireRed, with evolved forms showing up later in an area.
 * Legendaries are rare encounters in their FireRed haunts, on an area's last round only.
 */
const AREAS: AreaDef[] = [
  {
    name: 'Route 1', deco: 'meadow', ground: 0x6fb85a, sky: 0xa8dcff, light: 1.6,
    art: { ground: GRASS, path: 'dirt', patches: ['tallGrass', 7], decals: [['flowers', 14]], props: [['pine', 7], ['cutTree', 3], ['routeSign', 1]], ring: [['pine', 80], ['hedge', 16]], fence: 'fencePost' },
    wild: 'pidgey:5 rattata:5 spearow:3 nidoranf:2 nidoranm:2 mankey:2@2 pidgeotto:1@4 raticate:1@4',
  },
  {
    name: 'Viridian Forest', deco: 'forest', ground: 0x2f6b34, sky: 0x86b89a, light: 1.3,
    art: { ground: GRASS, patches: ['tallGrass', 11], decals: [['forestFlowers', 12]], props: [['pine', 24], ['forestTree', 6], ['cutTree', 5], ['tipsSign', 1]], ring: [['forestTree', 34, 1], ['pine', 110, 1.15]], tint: 0xe8f0e0 },
    wild: 'caterpie:5 weedle:5 metapod:3 kakuna:3 pidgey:2 pikachu:1 bulbasaur:1@3 butterfree:1@4 beedrill:1@4',
  },
  {
    name: 'Mt. Moon', deco: 'cave', ground: 0x34323c, sky: 0x1a1828, light: 1.0, glow: 0xe8e0ff,
    art: { ground: ['caveFloor'], props: [['caveRock', 14], ['caveRubble', 18], ['smashRock', 5], ['boulder', 3]], ring: [['caveRock', 110, 2.6], ['caveRubble', 50, 1.6]], tint: 0xc8c8d8 },
    wild: 'zubat:5 geodude:4 paras:3 sandshrew:3 ekans:2 clefairy:2 jigglypuff:2 omanyte:1@3 kabuto:1@3',
  },
  {
    name: 'Cerulean Cape', deco: 'beach', ground: 0x3d8fd6, sky: 0x9fdcff, light: 1.35,
    art: { ground: ['sand'], outer: ['water'], patches: ['tallGrass', 4], props: [['pine', 3], ['smashRock', 4], ['tipsSign', 1]], ring: [['pine', 22], ['hedge', 10]] },
    wild: 'psyduck:4 poliwag:4 goldeen:4 magikarp:3 krabby:3 horsea:2 oddish:3 bellsprout:3 abra:2 venonat:2 meowth:2 squirtle:1@3',
  },
  {
    name: 'Route 11', deco: 'meadow', ground: 0x7cb05a, sky: 0xffd8a8, light: 1.5, sun: [0xffb070, 2.3],
    art: { ground: GRASS, path: 'dirt', patches: ['tallGrass', 10], decals: [['flowers', 10]], props: [['pine', 6], ['cutTree', 4], ['routeSign', 1]], ring: [['pine', 70], ['hedge', 24]], fence: 'fencePost' },
    wild: 'drowzee:4 diglett:4 meowth:3 spearow:3 ekans:3 sandshrew:3 growlithe:2 vulpix:2 farfetchd voltorb@3 dugtrio@4',
  },
  {
    name: 'Rock Tunnel', deco: 'cave', ground: 0x3f3934, sky: 0x24222a, light: 1.0,
    art: { ground: ['tunnelFloor'], props: [['tunnelRock', 16], ['tunnelRubble', 20], ['boulder', 4]], ring: [['tunnelRock', 110, 2.6], ['tunnelRubble', 50, 1.6]], tint: 0xc0bcc8 },
    wild: 'zubat:4 geodude:4 machop:4 onix:3 mankey:3 cubone:2 graveler@3 golbat@3 machoke@4',
  },
  {
    name: 'Pokémon Tower', deco: 'tower', ground: 0x2a2238, sky: 0x241c34, light: 0.9,
    art: { ground: ['towerFloor'], props: [['grave', 14], ['graveGold', 2]], ring: [['grave', 130, 1.3], ['graveGold', 10, 1.3]], tint: 0xd0c8e8 },
    wild: 'gastly:6 cubone:3 zubat:2 haunter:2@3 golbat@3 marowak@4',
  },
  {
    name: 'Cycling Road', deco: 'meadow', ground: 0x5aa86a, sky: 0xb8e0ff, light: 1.6,
    art: { ground: GRASS, path: 'dirt', patches: ['tallGrass', 6], decals: [['flowers', 8]], props: [['hedge', 8], ['routeSign', 2]], ring: [['hedge', 40], ['pine', 50]], fence: 'fencePost' },
    wild: 'doduo:4 ponyta:3 grimer:3 koffing:3 spearow:2 fearow:2 rattata:2 raticate:2 lickitung eevee porygon mrmime snorlax@4',
  },
  {
    name: 'Safari Zone', deco: 'forest', ground: 0x4f8a3a, sky: 0xc8f0c8, light: 1.5,
    art: { ground: GRASS, patches: ['tallGrass', 14], decals: [['flowers', 10]], props: [['forestTree', 4], ['pine', 8], ['cutTree', 4], ['tipsSign', 1]], ring: [['forestTree', 26, 1], ['pine', 80, 1.1]] },
    wild:
      'nidorino:3 nidorina:3 exeggcute:3 rhyhorn:3 paras:2 venonat:2 tangela:2 chansey kangaskhan scyther pinsir tauros dratini ' +
      'parasect@3 venomoth@3 dragonair@5',
  },
  {
    name: 'Seafoam Islands', deco: 'cave', ground: 0x9cbcd6, sky: 0x86a8c8, light: 1.1, glow: 0x9fe8ff,
    art: { ground: ['iceFloor'], props: [['iceRock', 16], ['iceRubble', 16]], ring: [['iceRock', 110, 2.6], ['iceRubble', 50, 1.6]], tint: 0xdde4f0 },
    wild: 'seel:4 shellder:3 slowpoke:3 staryu:3 horsea:2 krabby:2 psyduck:2 golbat:2 jynx dewgong@3 cloyster@4 slowbro@4 lapras@4 articuno:0.3@5',
  },
  {
    name: 'Power Plant', deco: 'cave', ground: 0x2e3238, sky: 0x1c2028, light: 1.0, glow: 0xffe060,
    art: { ground: ['plantFloor'], props: [['boulder', 6], ['smashRock', 6], ['itemBall', 2]], ring: [['deepRock', 90, 2.4], ['boulder', 40, 2]], tint: 0xc8ccd8 },
    wild: 'magnemite:5 voltorb:5 pikachu:3 grimer:2 electabuzz@2 magneton:2@3 electrode:2@3 raichu@4 zapdos:0.3@5',
  },
  {
    name: 'Cinnabar Volcano', deco: 'volcano', ground: 0x2e1d1a, sky: 0x3a1c18, light: 1.1,
    art: { ground: ['tunnelFloor'], props: [['tunnelRock', 14], ['tunnelRubble', 16], ['smashRock', 4]], ring: [['tunnelRock', 110, 2.8], ['boulder', 30, 1.8]], tint: 0xf0c0a8 },
    wild: 'growlithe:3 vulpix:3 ponyta:3 koffing:3 magmar:2 grimer:2 ditto:2 charmander omanyte kabuto rapidash@3 weezing@3 muk@4 aerodactyl@4 moltres:0.3@5',
  },
  {
    name: 'Victory Road', deco: 'cave', ground: 0x4a3a2a, sky: 0x2a2018, light: 1.0, glow: 0xffa860,
    art: { ground: ['caveFloor'], props: [['caveRock', 12], ['boulder', 8], ['caveRubble', 14]], ring: [['caveRock', 110, 2.8], ['boulder', 40, 2]], tint: 0xd0c4b8 },
    wild: 'machoke:4 graveler:4 onix:3 golbat:3 marowak:2 primeape:2 arbok:2 sandslash:2 venomoth hitmonlee hitmonchan machamp@4 golem@4',
  },
  {
    name: 'Cerulean Cave', deco: 'cave', ground: 0x1e2238, sky: 0x141628, light: 0.9, glow: 0xc080ff,
    art: { ground: ['deepFloor'], props: [['deepRock', 16], ['deepRubble', 18], ['smashRock', 4]], ring: [['deepRock', 120, 2.8], ['deepRubble', 50, 1.6]], tint: 0xb8bcd8 },
    wild:
      'ditto:3 golbat:3 kadabra:3 parasect:2 wigglytuff:2 electrode:2 magneton:2 raichu:2 rhydon:2 chansey sandslash primeape ' +
      'dodrio venomoth marowak alakazam@3 mew:0.3@3 mewtwo:0.3@5',
  },
];

export const BIOMES: Biome[] = AREAS.map((a, i) => ({
  ...a,
  wild: table(a.wild),
  music: MUSIC.areas[i % MUSIC.areas.length],
}));

export const biomeFor = (round: number) => BIOMES[Math.floor((Math.max(1, round) - 1) / ROUNDS_PER_AREA) % BIOMES.length];

/** 1-based round within the current area. */
export const areaRound = (round: number) => ((Math.max(1, round) - 1) % ROUNDS_PER_AREA) + 1;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Sunlight per kind of area: warm daylight outside, dim cool light underground. */
const SUN: Record<Deco, [number, number]> = {
  meadow: [0xfff1d6, 2.3],
  forest: [0xe6ffc8, 1.7],
  cave: [0xc0c4ff, 1.1],
  beach: [0xfff8ec, 1.9],
  volcano: [0xff9a60, 1.8],
  tower: [0xa898e0, 1.0],
};
export const sunFor = (b: Biome) => b.sun ?? SUN[b.deco];

/** Cheap smooth 2D value noise in [0, 1], for ground colour patches. */
function noise2(x: number, y: number, seed: number) {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Soft round dot used by every ambient particle system. */
const dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.userData.shared = true;
  return t;
})();

interface MoteSpec {
  n: number;
  color: number;
  size: number;
  rise: number; // upward speed (negative falls)
  drift: number; // sideways wander
  top: number; // particles wrap between 0.1 and this height
  glow?: boolean; // additive blending
  blink?: boolean; // fireflies / wisps fade in and out
}

/** Ambient air per kind of area: pollen, fireflies, cave dust, sea spray, embers, ghostly wisps. */
const MOTES: Record<Deco, MoteSpec> = {
  meadow: { n: 70, color: 0xfff4b0, size: 0.13, rise: 0.06, drift: 0.6, top: 3.5 },
  forest: { n: 70, color: 0xd8ff6a, size: 0.26, rise: 0.05, drift: 0.5, top: 3, glow: true, blink: true },
  cave: { n: 110, color: 0xd8d8ff, size: 0.14, rise: 0.03, drift: 0.2, top: 4, glow: true },
  beach: { n: 50, color: 0xffffff, size: 0.12, rise: 0.25, drift: 0.9, top: 2.5 },
  volcano: { n: 110, color: 0xff7a2a, size: 0.17, rise: 1.1, drift: 0.5, top: 6, glow: true, blink: true },
  tower: { n: 45, color: 0x9a7aff, size: 0.42, rise: 0.3, drift: 0.4, top: 4, glow: true, blink: true },
};

function motes(spec: MoteSpec, tint?: number) {
  const n = spec.n, R = ARENA_R + 6;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), phase = new Float32Array(n);
  const base = new THREE.Color(tint ?? spec.color);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
    pos.set([Math.cos(a) * r, rnd(0.1, spec.top), Math.sin(a) * r], i * 3);
    col.set([base.r, base.g, base.b], i * 3);
    phase[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: spec.size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false,
    blending: spec.glow ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: spec.glow ? 1 : 0.85,
  }));
  pts.frustumCulled = false;
  const tick = (t: number, dt: number) => {
    for (let i = 0; i < n; i++) {
      const k = i * 3, p = phase[i];
      pos[k] += Math.sin(t * 0.7 + p) * spec.drift * dt;
      pos[k + 1] += spec.rise * dt * (0.6 + 0.4 * Math.sin(p));
      pos[k + 2] += Math.cos(t * 0.6 + p * 1.3) * spec.drift * dt;
      if (pos[k + 1] > spec.top) pos[k + 1] = 0.1;
      if (spec.blink) {
        const f = Math.max(0, Math.sin(t * (1.2 + (p % 1.5)) + p));
        col[k] = base.r * f;
        col[k + 1] = base.g * f;
        col[k + 2] = base.b * f;
      }
    }
    geo.attributes.position.needsUpdate = true;
    if (spec.blink) geo.attributes.color.needsUpdate = true;
  };
  return { pts, tick };
}
const toon = (color: number, p: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, ...p });


/** Scatter `n` instanced copies of `geo` around the ring between r0 and r1. */
function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, r0: number, r1: number, place: (d: THREE.Object3D) => void) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = rnd(r0, r1);
    d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    d.rotation.set(0, Math.random() * Math.PI * 2, 0);
    d.scale.setScalar(1);
    place(d);
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
  }
  im.castShadow = true;
  return im;
}



// ───────────── FireRed art in 3D ─────────────

/**
 * Billboards share the camera's tilt (the camera never rotates), exactly like the THREE.Sprite Pokémon and trainer.
 * Parallel planes can't cut through each other, so a trainer walking behind a tree is hidden by it instead of
 * slicing into it.
 */
const FACE_CAMERA = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 4, 0, 0));
const UNIT = 1 / 16; // world units per GBA pixel: a 16 px metatile is one unit

const envTex = (name: EnvName) => getTex(url.env(name));

function pixelTex(src: THREE.Texture | HTMLCanvasElement, repeat = false) {
  const t = src instanceof THREE.Texture ? src.clone() : new THREE.CanvasTexture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = repeat;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** A 16×16-metatile floor texture with tiles picked at random from `tiles` (repeats are weighted by listing twice). */
function floorTexture(tiles: EnvName[]) {
  const n = 16, c = document.createElement('canvas');
  c.width = c.height = n * 16;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) ctx.drawImage(envTex(tiles[Math.floor(Math.random() * tiles.length)]).canvas, x * 16, y * 16, 16, 16);
  return pixelTex(c, true);
}

/**
 * A ground disc tiled with FireRed metatiles (one per world unit, aligned to the integer grid), with a faint
 * vertex-colour wash of noise so a big field of identical tiles doesn't look flat.
 */
function groundDisc(r: number, tiles: EnvName[], y: number, amount: number) {
  const geo = new THREE.RingGeometry(0.001, r, 160, Math.ceil(r * 1.4));
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const seed = Math.random() * 100;
  for (let i = 0; i < pos.count; i++) {
    const n = noise2(pos.getX(i) * 0.1, pos.getY(i) * 0.1, seed);
    const l = 1 - amount * 0.5 + n * amount;
    cols.set([l, l, l], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const map = floorTexture(tiles);
  map.repeat.set((2 * r) / 16, (2 * r) / 16);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/** Flat metatiles laid on grid cells (path, tall grass, flowers), one instanced draw per tile kind. */
function decals(name: EnvName, cells: [number, number][], y = 0.015) {
  const mat = new THREE.MeshLambertMaterial({ map: pixelTex(envTex(name).tex), transparent: true, alphaTest: 0.5, depthWrite: false });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, Math.max(1, cells.length));
  const d = new THREE.Object3D();
  cells.forEach(([x, z], i) => {
    d.position.set(x + 0.5, y, z + 0.5);
    d.updateMatrix();
    im.setMatrixAt(i, d.matrix);
  });
  im.count = cells.length;
  im.receiveShadow = true;
  return im;
}

const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
shadowMat.userData.shared = true;

/**
 * Standing billboards of one art at the given spots, plus a soft blob shadow under each. Sized from the art's pixels
 * (16 px = 1 unit) times `scale`.
 */
function billboards(name: EnvName, spots: { x: number; z: number; s: number }[], tint = 0xffffff) {
  const g = new THREE.Group();
  if (!spots.length) return g;
  const st = envTex(name);
  const w = st.w * UNIT, h = st.h * UNIT;
  const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: pixelTex(st.tex), alphaTest: 0.5, color: tint });
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const sh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), shadowMat, spots.length);
  const m = new THREE.Matrix4(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach(({ x, z, s }, i) => {
    im.setMatrixAt(i, m.compose(p.set(x, 0, z), FACE_CAMERA, sc.setScalar(s)));
    sh.setMatrixAt(i, m.compose(p.set(x, 0.02, z), new THREE.Quaternion(), sc.set(w * s * 0.42, 1, w * s * 0.22)));
  });
  // No cast shadows: from a camera-facing plane they'd be thin slivers. The blobs ground them instead.
  g.add(sh, im);
  return g;
}

/** Random spots in an annulus, at least `gap` (× scale) apart from each other and from `taken`, which they join. */
function spotsIn(n: number, r0: number, r1: number, gap: number, taken: { x: number; z: number; s: number }[], scale = 1, jitter = 0.15) {
  const out: { x: number; z: number; s: number }[] = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const a = Math.random() * Math.PI * 2, r = r0 + (r1 - r0) * Math.sqrt(Math.random());
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if ([...taken, ...out].some((o) => Math.hypot(o.x - x, o.z - z) < gap * Math.max(o.s, scale))) continue;
    out.push({ x, z, s: scale * (1 + rnd(-jitter, jitter)) });
  }
  taken.push(...out);
  return out;
}

/** Grid cells inside a blob around (cx, cz). */
function blob(cx: number, cz: number, r: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let x = Math.floor(cx - r); x <= cx + r; x++)
    for (let z = Math.floor(cz - r); z <= cz + r; z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / r;
      if (d < 1 - Math.random() * 0.25) cells.push([x, z]);
    }
  return cells;
}

/** Ground a prop blocks, as an axis-aligned rectangle (z0 is the far edge). */
export interface Solid {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A place wild Pokémon spawn and loiter (a tall-grass patch, or a hollow in a cave). */
export interface Zone {
  x: number;
  z: number;
  r: number;
}

/**
 * An arena: static scenery, `userData.zones` (where wild Pokémon live), `userData.solids` (props nobody can walk
 * through) and `userData.tick(time, dt)` for the ambient animation (particles, waves, lava).
 */
export function buildArena(b: Biome) {
  const g = new THREE.Group();
  const tickers: ((t: number, dt: number) => void)[] = [];
  g.userData.tick = (t: number, dt: number) => tickers.forEach((f) => f(t, dt));
  const art = b.art;
  const inside = (x: number, z: number, pad = 1) => Math.hypot(x + 0.5, z + 0.5) < ARENA_R - pad;

  // Ground: the arena floor, and the world beyond it.
  const outer = groundDisc(80, art.outer ?? art.ground, 0, 0.18);
  g.add(outer, groundDisc(ARENA_R + 3, art.ground, 0.005, 0.12));
  if (art.outer) {
    // The sea scrolls gently.
    const map = (outer.material as THREE.MeshLambertMaterial).map!;
    tickers.push((t) => map.offset.set(Math.sin(t * 0.3) * 0.004, t * 0.002));
  }

  // A route path winding across, on whole grid cells like the games.
  const busy: { x: number; z: number; s: number }[] = [{ x: 0, z: 0, s: 0.8 }]; // keep the start point clear
  if (art.path) {
    const cells: [number, number][] = [];
    for (let x = -ARENA_R - 3; x <= ARENA_R + 3; x++)
      for (let z = -ARENA_R - 3; z <= ARENA_R + 3; z++)
        if (Math.abs(z + 0.5 - 4 * Math.sin((x + 0.5) / 7) - 2) < 1.6 && Math.hypot(x, z) < ARENA_R + 3) cells.push([x, z]);
    g.add(decals(art.path, cells, 0.01));
    for (const [x, z] of cells) busy.push({ x: x + 0.5, z: z + 0.5, s: 0.4 });
  }
  // Where wild Pokémon live: the tall grass patches, or (underground) open hollows between the rocks.
  const zones: Zone[] = [];
  if (art.patches) {
    const [name, n] = art.patches;
    const cells: [number, number][] = [];
    for (const spot of spotsIn(n, 5, ARENA_R - 4, 6, busy, 1)) {
      const r = rnd(1.8, 3);
      cells.push(...blob(spot.x, spot.z, r).filter(([x, z]) => inside(x, z)));
      zones.push({ x: spot.x, z: spot.z, r: r * 0.8 });
    }
    g.add(decals(name, cells, 0.02));
  } else {
    for (const spot of spotsIn(8, 6, ARENA_R - 4, 7, [{ x: 0, z: 0, s: 0.8 }], 1)) zones.push({ x: spot.x, z: spot.z, r: 2.6 });
  }
  g.userData.zones = zones;
  for (const [name, n] of art.decals ?? []) {
    const cells: [number, number][] = [];
    for (const s of spotsIn(n, 3, ARENA_R + 6, 1.5, busy, 0.3)) {
      cells.push([Math.floor(s.x), Math.floor(s.z)]);
      if (Math.random() < 0.6) cells.push([Math.floor(s.x) + 1, Math.floor(s.z)]);
    }
    g.add(decals(name, cells, 0.018));
  }

  // Standing art: props inside the arena, and a dense ring walling it in.
  const tint = art.tint ?? 0xffffff;
  // Props inside the arena are solid, like map tiles in the games: a tree blocks the whole patch of ground its
  // picture covers on screen (its width, and back as far as it's tall), so nobody ends up standing inside it.
  const solids: Solid[] = [];
  for (const [name, n, scale = 1] of art.props ?? []) {
    const spots = spotsIn(n, 4, ARENA_R - 2, 1.4 + 0.6 * scale, busy, scale);
    g.add(billboards(name, spots, tint));
    const st = envTex(name);
    for (const { x, z, s } of spots) {
      const hw = Math.max(0.3, st.w * UNIT * s * 0.5), depth = st.h * UNIT * s * 1.25;
      solids.push({ x0: x - hw, x1: x + hw, z0: z - depth, z1: z + 0.2 });
    }
  }
  g.userData.solids = solids;
  const ring: { x: number; z: number; s: number }[] = [];
  for (const [name, n, scale = 1] of art.ring) {
    const spots = spotsIn(n, ARENA_R + 1.2, ARENA_R + 16, 0.9, ring, scale, 0.25);
    g.add(billboards(name, spots, tint));
  }
  if (art.fence) {
    const n = Math.round(2 * Math.PI * (ARENA_R + 0.7));
    const spots = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: Math.cos(a) * (ARENA_R + 0.7), z: Math.sin(a) * (ARENA_R + 0.7), s: 1 };
    });
    g.add(billboards(art.fence, spots, tint));
  }

  const m = motes(MOTES[b.deco], b.deco === 'cave' ? b.glow : undefined);
  g.add(m.pts);
  tickers.push(m.tick);

  switch (b.deco) {
    case 'cave': {
      // Glowing crystal clusters among the rocks.
      if (!b.glow) break;
      const crystal = toon(b.glow, { emissive: b.glow, emissiveIntensity: 0.5 });
      tickers.push((t) => (crystal.emissiveIntensity = 0.5 * (0.75 + 0.35 * Math.sin(t * 1.3))));
      for (const spot of spotsIn(7, 5, ARENA_R - 3, 3, busy, 1)) {
        const cluster = scatter(GEO.cone, crystal, 4, 0, 0.35, (d) => {
          const h = rnd(0.35, 0.8);
          d.position.y = h * 0.4;
          d.scale.set(0.1, h, 0.1);
          d.rotation.set(rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5));
        });
        cluster.position.set(spot.x, 0, spot.z);
        g.add(cluster);
      }
      break;
    }
    case 'beach': {
      // Waves lapping at the shore: foam rings roll out from the sand and fade.
      const waves = [0, 1, 2].map((i) => {
        const w = new THREE.Mesh(
          new THREE.RingGeometry(ARENA_R + 3, ARENA_R + 3.3, 128),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
        );
        w.rotation.x = -Math.PI / 2;
        w.position.y = 0.012;
        g.add(w);
        return { w, off: i / 3 };
      });
      tickers.push((t) => {
        for (const { w, off } of waves) {
          const p = (t * 0.12 + off) % 1;
          w.scale.setScalar(1 + p * 0.35);
          (w.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
        }
      });
      break;
    }
    case 'volcano': {
      // Glowing lava cracks across the floor and pools beyond the rocks.
      const lava = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
      tickers.push((t) => lava.color.setHSL(0.045 + 0.015 * Math.sin(t * 1.7), 1, 0.52 + 0.06 * Math.sin(t * 2.3)));
      g.add(scatter(GEO.box, lava, 26, 3, ARENA_R - 1, (d) => {
        d.position.y = 0.03;
        d.scale.set(rnd(0.6, 1.8), 0.01, 0.07);
      }));
      g.add(scatter(new THREE.CircleGeometry(1, 20), lava, 18, ARENA_R + 3, ARENA_R + 14, (d) => {
        d.position.y = 0.03;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.setScalar(rnd(0.6, 2));
      }));
      break;
    }
    case 'tower': {
      // Candles among the graves, and low purple mist drifting over the floor.
      const wax = toon(0xf0e8d0), flame = new THREE.MeshBasicMaterial({ color: 0xffb040 });
      tickers.push((t) => flame.color.setHSL(0.09 + 0.02 * Math.sin(t * 13), 1, 0.55 + 0.1 * Math.sin(t * 17 + Math.sin(t * 5))));
      for (const spot of spotsIn(18, 3, ARENA_R + 4, 1, busy, 0.3)) {
        const c = new THREE.Group();
        c.add(mesh(GEO.cyl, wax, [0, 0.15, 0], [0.06, 0.3, 0.06]));
        c.add(mesh(GEO.sphere, flame, [0, 0.36, 0], [0.05, 0.08, 0.05]));
        c.position.set(spot.x, 0, spot.z);
        g.add(c);
      }
      const mist = new THREE.MeshBasicMaterial({ color: 0x9a7aff, map: dotTex, transparent: true, opacity: 0.22, depthWrite: false });
      const puffs = Array.from({ length: 14 }, () => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mist);
        m.rotation.x = -Math.PI / 2;
        m.position.set(rnd(-ARENA_R, ARENA_R), 0.05 + Math.random() * 0.05, rnd(-ARENA_R, ARENA_R));
        m.scale.setScalar(rnd(5, 9));
        g.add(m);
        return { m, v: rnd(0.2, 0.5) };
      });
      tickers.push((_, dt) => {
        for (const { m, v } of puffs) {
          m.position.x += v * dt;
          if (m.position.x > ARENA_R + 6) m.position.x = -ARENA_R - 6;
          m.rotation.z += v * 0.1 * dt;
        }
      });
      break;
    }
  }
  return g;
}

/** Frees GPU resources of an arena that's being replaced (shared GEO geometries are kept). */
export function disposeArena(g: THREE.Object3D) {
  const shared = new Set<THREE.BufferGeometry>(Object.values(GEO));
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Points).isPoints) return;
    if (!shared.has(m.geometry)) m.geometry.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      if (x.userData.shared) continue;
      const map = (x as THREE.MeshBasicMaterial).map;
      if (map && !map.userData.shared) map.dispose();
      x.dispose();
    }
  });
  g.removeFromParent();
}
