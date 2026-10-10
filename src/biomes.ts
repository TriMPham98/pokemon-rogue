import * as THREE from 'three';
import { MUSIC, SPECIES_BY_ID, type Species } from './data';
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
  floor: number;
  edge: number;
  tuft: number;
  sky: number;
  light: number; // hemisphere intensity
  rock?: [number, number]; // cave walls
  glow?: number; // cave crystals
  sun?: [color: number, intensity: number]; // overrides the deco's sunlight (Route 11's sunset)
  wild: Encounter[]; // the area's 5th round ends with an evolved form of one of its basic Pokémon (see Game.leaderSpecies)
  music: string;
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

/**
 * Kanto in story order, a new area every 5 rounds; loops after Cerulean Cave.
 * Encounters follow where each Pokémon lives in Red/Blue/FireRed, with evolved forms showing up later in an area.
 * Legendaries are rare encounters in their FireRed haunts, on an area's last round only.
 */
const AREAS: AreaDef[] = [
  {
    name: 'Route 1', deco: 'meadow', ground: 0x6fb85a, floor: 0x92d47a, edge: 0xe9dca4, tuft: 0x4f9a3e, sky: 0xa8dcff, light: 1.6,
    wild: 'pidgey:5 rattata:5 spearow:3 nidoranf:2 nidoranm:2 mankey:2@2 pidgeotto:1@4 raticate:1@4',
  },
  {
    name: 'Viridian Forest', deco: 'forest', ground: 0x2f6b34, floor: 0x5e9a4c, edge: 0x7a6a3c, tuft: 0x2e6a2c, sky: 0x86b89a, light: 1.3,
    wild: 'caterpie:5 weedle:5 metapod:3 kakuna:3 pidgey:2 pikachu:1 bulbasaur:1@3 butterfree:1@4 beedrill:1@4',
  },
  {
    name: 'Mt. Moon', deco: 'cave', ground: 0x34323c, floor: 0x6c6878, edge: 0x55525e, tuft: 0x7a7688, sky: 0x1a1828, light: 1.0,
    rock: [0x55525e, 0x645f70], glow: 0xe8e0ff,
    wild: 'zubat:5 geodude:4 paras:3 sandshrew:3 ekans:2 clefairy:2 jigglypuff:2 omanyte:1@3 kabuto:1@3',
  },
  {
    name: 'Cerulean Cape', deco: 'beach', ground: 0x3d8fd6, floor: 0xf0e0aa, edge: 0xfff6d8, tuft: 0x7cbf5a, sky: 0x9fdcff, light: 1.35,
    wild: 'psyduck:4 poliwag:4 goldeen:4 magikarp:3 krabby:3 horsea:2 oddish:3 bellsprout:3 abra:2 venonat:2 meowth:2 squirtle:1@3',
  },
  {
    name: 'Route 11', deco: 'meadow', ground: 0x7cb05a, floor: 0xb6d88a, edge: 0xe8d8a0, tuft: 0x5a9a40, sky: 0xffd8a8, light: 1.5, sun: [0xffb070, 2.3],
    wild: 'drowzee:4 diglett:4 meowth:3 spearow:3 ekans:3 sandshrew:3 growlithe:2 vulpix:2 farfetchd voltorb@3 dugtrio@4',
  },
  {
    name: 'Rock Tunnel', deco: 'cave', ground: 0x3f3934, floor: 0x7a6e60, edge: 0x5a5048, tuft: 0x6a6258, sky: 0x24222a, light: 1.0,
    wild: 'zubat:4 geodude:4 machop:4 onix:3 mankey:3 cubone:2 graveler@3 golbat@3 machoke@4',
  },
  {
    name: 'Pokémon Tower', deco: 'tower', ground: 0x2a2238, floor: 0x4a3e5c, edge: 0x7a6a9a, tuft: 0x3e3450, sky: 0x241c34, light: 0.9,
    wild: 'gastly:6 cubone:3 zubat:2 haunter:2@3 golbat@3 marowak@4',
  },
  {
    name: 'Cycling Road', deco: 'meadow', ground: 0x5aa86a, floor: 0xc8c0a8, edge: 0xffffff, tuft: 0x4a8a50, sky: 0xb8e0ff, light: 1.6,
    wild: 'doduo:4 ponyta:3 grimer:3 koffing:3 spearow:2 fearow:2 rattata:2 raticate:2 lickitung eevee porygon mrmime snorlax@4',
  },
  {
    name: 'Safari Zone', deco: 'forest', ground: 0x4f8a3a, floor: 0x9cc46a, edge: 0xa08850, tuft: 0x3e7a30, sky: 0xc8f0c8, light: 1.5,
    wild:
      'nidorino:3 nidorina:3 exeggcute:3 rhyhorn:3 paras:2 venonat:2 tangela:2 chansey kangaskhan scyther pinsir tauros dratini ' +
      'parasect@3 venomoth@3 dragonair@5',
  },
  {
    name: 'Seafoam Islands', deco: 'cave', ground: 0x9cbcd6, floor: 0xc4dcee, edge: 0x8ab4d8, tuft: 0xa8c8e0, sky: 0x86a8c8, light: 1.1,
    rock: [0xa8c8e0, 0xc0dcf0], glow: 0x9fe8ff,
    wild: 'seel:4 shellder:3 slowpoke:3 staryu:3 horsea:2 krabby:2 psyduck:2 golbat:2 jynx dewgong@3 cloyster@4 slowbro@4 lapras@4 articuno:0.3@5',
  },
  {
    name: 'Power Plant', deco: 'cave', ground: 0x2e3238, floor: 0x6a7078, edge: 0xd8c040, tuft: 0x50565e, sky: 0x1c2028, light: 1.0,
    rock: [0x4a5058, 0x5a6068], glow: 0xffe060,
    wild: 'magnemite:5 voltorb:5 pikachu:3 grimer:2 electabuzz@2 magneton:2@3 electrode:2@3 raichu@4 zapdos:0.3@5',
  },
  {
    name: 'Cinnabar Volcano', deco: 'volcano', ground: 0x2e1d1a, floor: 0x5e3a30, edge: 0xff6a1a, tuft: 0x6b4a3a, sky: 0x3a1c18, light: 1.1,
    wild: 'growlithe:3 vulpix:3 ponyta:3 koffing:3 magmar:2 grimer:2 ditto:2 charmander omanyte kabuto rapidash@3 weezing@3 muk@4 aerodactyl@4 moltres:0.3@5',
  },
  {
    name: 'Victory Road', deco: 'cave', ground: 0x4a3a2a, floor: 0x8a7458, edge: 0x6a5a40, tuft: 0x7a6448, sky: 0x2a2018, light: 1.0,
    rock: [0x5a4a38, 0x6a5840], glow: 0xffa860,
    wild: 'machoke:4 graveler:4 onix:3 golbat:3 marowak:2 primeape:2 arbok:2 sandslash:2 venomoth hitmonlee hitmonchan machamp@4 golem@4',
  },
  {
    name: 'Cerulean Cave', deco: 'cave', ground: 0x1e2238, floor: 0x4a5070, edge: 0x6a70a0, tuft: 0x3a4060, sky: 0x141628, light: 0.9,
    rock: [0x3a3f5a, 0x48506e], glow: 0xc080ff,
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

/**
 * A ground disc with vertex-coloured patches (two octaves of noise) instead of one flat colour.
 * `tint(x, z)` can blend toward another colour, e.g. a dirt path across the meadow.
 */
function groundDisc(r: number, color: number, y: number, amount: number, tint?: (x: number, z: number) => [number, number] | null) {
  const geo = new THREE.RingGeometry(0.001, r, 160, Math.ceil(r * 1.4));
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const base = new THREE.Color(color), c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const seed = Math.random() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = -pos.getY(i); // ring lies in XY before it's rotated flat
    const n = noise2(x * 0.12, z * 0.12, seed) * 0.7 + noise2(x * 0.45, z * 0.45, seed + 9) * 0.3;
    c.setHSL(hsl.h + (n - 0.5) * amount * 0.25, hsl.s, Math.min(1, Math.max(0, hsl.l + (n - 0.5) * amount)));
    const t = tint?.(x, z);
    if (t) c.lerp(new THREE.Color(t[0]), t[1]);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

/** Toon material whose instanced blades bend in the wind (`time` is a shared uniform the arena ticks). */
function swayMat(color: number, time: { value: number }, strength = 0.14) {
  const m = new THREE.MeshToonMaterial({ color });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float bend = (position.y + 0.5) * (position.y + 0.5);
      mvPosition.x += sin(uTime * 1.9 + mvPosition.x * 0.35 + mvPosition.z * 0.22) * ${strength.toFixed(3)} * bend;
      mvPosition.z += cos(uTime * 1.4 + mvPosition.z * 0.3) * ${(strength * 0.5).toFixed(3)} * bend;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  return m;
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

function disc(r: number, color: number, y: number, mat?: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), mat ?? toon(color));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

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

function ringOf(n: number, r0: number, r1: number, build: (i: number) => THREE.Object3D) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05), r = rnd(r0, r1);
    const o = build(i);
    o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    o.rotation.y = Math.random() * Math.PI * 2;
    g.add(o);
  }
  return g;
}

function pine(trunk: THREE.Material, leaves: THREE.Material[], s: number, i: number) {
  const t = new THREE.Group();
  t.scale.setScalar(s);
  t.add(mesh(GEO.cyl, trunk, [0, 0.8, 0], [0.22, 1.6, 0.22]));
  t.add(mesh(GEO.cone, leaves[i % 2], [0, 2.3, 0], [1.3, 2.2, 1.3]));
  t.add(mesh(GEO.cone, leaves[(i + 1) % 2], [0, 3.4, 0], [0.95, 1.8, 0.95]));
  return t;
}

/** An arena: static scenery plus `userData.tick(time, dt)` for the ambient animation (wind, particles, waves, lava). */
export function buildArena(b: Biome) {
  const g = new THREE.Group();
  const time = { value: 0 };
  const tickers: ((t: number, dt: number) => void)[] = [(t) => (time.value = t)];
  g.userData.tick = (t: number, dt: number) => tickers.forEach((f) => f(t, dt));

  const outdoors = b.deco === 'meadow' || b.deco === 'forest';
  // Meadows get a sandy path winding through the arena, like a route.
  const path = b.deco === 'meadow'
    ? (x: number, z: number): [number, number] | null => {
      const d = Math.abs(z - 4 * Math.sin(x / 7) - 2);
      return d < 2.4 ? [b.edge, 0.55 * Math.min(1, (2.4 - d) / 0.8)] : null;
    }
    : undefined;
  g.add(groundDisc(80, b.ground, 0, b.deco === 'beach' ? 0.05 : 0.14));
  g.add(groundDisc(ARENA_R, b.floor, 0.01, 0.12, path));
  const edge = new THREE.Mesh(new THREE.RingGeometry(ARENA_R, ARENA_R + 0.5, 96), toon(b.edge));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  g.add(edge);

  // A few tufts inside for texture, more outside.
  const tuftMat = outdoors ? swayMat(b.tuft, time) : toon(b.tuft);
  const tuft = (d: THREE.Object3D) => {
    const h = rnd(0.25, 0.55);
    d.position.y = h / 2;
    d.scale.set(0.07, h, 0.07);
    d.rotation.x = rnd(-0.2, 0.2);
  };
  g.add(scatter(GEO.cone, tuftMat, 30, 0, ARENA_R, tuft));
  if (b.deco !== 'beach') g.add(scatter(GEO.cone, tuftMat, 400, ARENA_R + 1, ARENA_R + 22, tuft));

  if (outdoors) {
    // Patches of tall grass: classic encounter grass, swaying in the wind.
    const tall = swayMat(new THREE.Color(b.tuft).multiplyScalar(1.08).getHex(), time, 0.2);
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(6, ARENA_R - 4);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, pr = rnd(1.4, 2.6);
      const patch = scatter(GEO.cone, tall, 90, 0, pr, (d) => {
        const h = rnd(0.4, 0.7);
        d.position.y = h / 2;
        d.scale.set(0.06, h, 0.06);
        d.rotation.x = rnd(-0.15, 0.15);
      });
      patch.position.set(cx, 0, cz);
      g.add(patch);
    }
  }
  const m = motes(MOTES[b.deco], b.deco === 'cave' ? b.glow : undefined);
  g.add(m.pts);
  tickers.push(m.tick);

  const trunk = toon(0x7a5232);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const boulders = (mat: THREE.Material, n: number, r0: number, r1: number, s0: number, s1: number) =>
    scatter(rockGeo, mat, n, r0, r1, (d) => {
      const s = rnd(s0, s1);
      d.position.y = s * 0.3;
      d.scale.set(s, s * 0.6, s);
      d.rotation.set(Math.random(), Math.random(), Math.random());
    });

  switch (b.deco) {
    case 'meadow': {
      // A wooden fence around the arena: posts plus two circular rails.
      const wood = toon(0xb08850);
      const posts = new THREE.InstancedMesh(GEO.box, wood, 72);
      const d = new THREE.Object3D();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        d.position.set(Math.cos(a) * (ARENA_R + 0.9), 0.45, Math.sin(a) * (ARENA_R + 0.9));
        d.rotation.set(0, -a, 0);
        d.scale.set(0.16, 0.9, 0.16);
        d.updateMatrix();
        posts.setMatrixAt(i, d.matrix);
      }
      posts.castShadow = true;
      g.add(posts);
      for (const y of [0.4, 0.75]) {
        const rail = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 0.9, 0.05, 6, 160), wood);
        rail.rotation.x = Math.PI / 2;
        rail.position.y = y;
        rail.castShadow = true;
        g.add(rail);
      }
      const leaves = [toon(0x2f7d40), toon(0x3d9650)];
      g.add(ringOf(70, ARENA_R + 3, ARENA_R + 19, (i) => pine(trunk, leaves, rnd(0.8, 1.5), i)));
      const flowers = scatter(GEO.sphere, toon(0xffffff), 160, ARENA_R + 1, ARENA_R + 12, (d) => (d.position.y = 0.08, d.scale.setScalar(0.07)));
      const col = new THREE.Color(), palette = [0xffffff, 0xffd84a, 0xff7aa8, 0xb88cff];
      for (let i = 0; i < flowers.count; i++) flowers.setColorAt(i, col.setHex(palette[i % palette.length]));
      g.add(flowers, boulders(toon(0x9a9a92), 14, ARENA_R - 2, ARENA_R + 8, 0.25, 0.6));
      const inner = scatter(GEO.sphere, toon(0xffffff), 70, 2, ARENA_R - 1, (d) => (d.position.y = 0.06, d.scale.setScalar(0.06)));
      for (let i = 0; i < inner.count; i++) inner.setColorAt(i, col.setHex(palette[i % palette.length]));
      g.add(inner);
      break;
    }
    case 'forest': {
      const leaves = [toon(0x1f5a2c), toon(0x2a6e36)];
      g.add(ringOf(130, ARENA_R + 1.5, ARENA_R + 20, (i) => pine(trunk, leaves, rnd(1.1, 2.0), i)));
      g.add(scatter(GEO.sphere, toon(0x2f7d40), 40, ARENA_R - 1, ARENA_R + 3, (d) => {
        const s = rnd(0.5, 1.1);
        d.position.y = s * 0.4;
        d.scale.set(s, s * 0.8, s);
      }));
      // Mushrooms and fallen leaves, some inside the clearing
      g.add(scatter(GEO.hemiTop, toon(0xd8483a), 30, ARENA_R + 0.5, ARENA_R + 6, (d) => (d.position.y = 0.15, d.scale.setScalar(0.18))));
      g.add(scatter(GEO.hemiTop, toon(0xe0b04a), 14, 4, ARENA_R - 2, (d) => (d.position.y = 0.05, d.scale.setScalar(0.14))));
      const fallen = scatter(GEO.sphere, toon(0xffffff), 120, 1, ARENA_R, (d) => (d.position.y = 0.03, d.scale.set(0.16, 0.015, 0.09)));
      const lc = new THREE.Color(), lp = [0x8a6a2a, 0xa8742c, 0x4d7a2e, 0x6b4a22];
      for (let i = 0; i < fallen.count; i++) fallen.setColorAt(i, lc.setHex(lp[i % lp.length]));
      g.add(fallen);
      break;
    }
    case 'cave': {
      const [r0, r1] = b.rock ?? [0x4e463f, 0x5d544b];
      const stone = [toon(r0), toon(r1)];
      const crystal = toon(b.glow ?? 0x8fd8ff, { emissive: b.glow ?? 0x3aa0ff, emissiveIntensity: b.glow ? 0.5 : 0.8 });
      const ci = crystal.emissiveIntensity;
      tickers.push((t) => (crystal.emissiveIntensity = ci * (0.75 + 0.35 * Math.sin(t * 1.3))));
      g.add(ringOf(90, ARENA_R + 1, ARENA_R + 18, (i) => {
        const h = rnd(2, 6);
        const m = mesh(GEO.cone, stone[i % 2], [0, h / 2, 0], [rnd(0.8, 1.8), h, rnd(0.8, 1.8)]);
        const grp = new THREE.Group();
        grp.add(m);
        return grp;
      }));
      g.add(boulders(toon(new THREE.Color(r1).multiplyScalar(1.15).getHex()), 26, ARENA_R - 3, ARENA_R + 10, 0.4, 1.2));
      g.add(boulders(toon(r0), 50, 2, ARENA_R - 1, 0.06, 0.16)); // pebbles
      // Inside the cave: short stalagmites, glowing crystal clusters and still puddles.
      g.add(scatter(GEO.cone, stone[1], 18, 4, ARENA_R - 2, (d) => {
        const h = rnd(0.35, 0.8);
        d.position.y = h / 2;
        d.scale.set(rnd(0.18, 0.3), h, rnd(0.18, 0.3));
      }));
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, r = rnd(5, ARENA_R - 3);
        const cluster = scatter(GEO.cone, crystal, 4, 0, 0.35, (d) => {
          const h = rnd(0.35, 0.8);
          d.position.y = h * 0.4;
          d.scale.set(0.1, h, 0.1);
          d.rotation.set(rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5));
        });
        cluster.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        g.add(cluster);
      }
      const puddle = new THREE.MeshBasicMaterial({ color: new THREE.Color(b.floor).multiplyScalar(0.5).lerp(new THREE.Color(b.glow ?? 0x8fd8ff), 0.12), transparent: true, opacity: 0.75, depthWrite: false });
      g.add(scatter(new THREE.CircleGeometry(1, 24), puddle, 6, 4, ARENA_R - 3, (d) => {
        d.position.y = 0.015;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.set(rnd(0.8, 1.6), rnd(0.5, 1), 1);
      }));
      g.add(scatter(GEO.cone, crystal, 10, 5, ARENA_R - 2, (d) => {
        const h = rnd(0.25, 0.5);
        d.position.y = h / 2;
        d.scale.set(0.08, h, 0.08);
      }));
      // Glowing crystals for light and colour.
      g.add(scatter(GEO.cone, crystal, 24, ARENA_R + 0.5, ARENA_R + 7, (d) => {
        const h = rnd(0.5, 1.2);
        d.position.y = h / 2;
        d.scale.set(0.15, h, 0.15);
        d.rotation.z = rnd(-0.4, 0.4);
      }));
      break;
    }
    case 'beach': {
      // Sea all around (ground disc), a sandy island arena, palms on a strip of beach.
      g.add(disc(ARENA_R + 6, 0xe8d49a, 0.005));
      const leaf = toon(0x3c9a3c);
      g.add(ringOf(26, ARENA_R + 1.5, ARENA_R + 5, () => {
        const p = new THREE.Group();
        const tilt = rnd(-0.25, 0.25);
        p.add(mesh(GEO.cyl, toon(0xa07040), [0, 1.6, 0], [0.16, 3.2, 0.16], [tilt, 0, 0]));
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          p.add(mesh(GEO.sphere, leaf, [Math.cos(a) * 0.9, 3.2, Math.sin(a) * 0.9 + tilt * 3], [1.0, 0.08, 0.3], [0, -a, -0.35]));
        }
        return p;
      }));
      g.add(boulders(toon(0xd9c48a), 10, ARENA_R - 2, ARENA_R + 5, 0.3, 0.7));
      // Waves lapping at the shore: foam rings roll out from the sand and fade.
      const waves = [0, 1, 2].map((i) => {
        const w = new THREE.Mesh(
          new THREE.RingGeometry(ARENA_R + 6, ARENA_R + 6.35, 128),
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
          (w.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - p);
        }
      });
      // Tide pools and shells
      g.add(scatter(new THREE.CircleGeometry(1, 24), toon(0x6cc2ee), 6, 5, ARENA_R - 3, (d) => {
        d.position.y = 0.015;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.set(rnd(0.8, 1.6), rnd(0.5, 1), 1);
      }));
      // Driftwood washed up on the sand.
      g.add(scatter(GEO.cyl, toon(0xb89a70), 6, 5, ARENA_R - 2, (d) => {
        d.position.y = 0.08;
        d.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI);
        d.scale.set(0.09, rnd(1, 2), 0.09);
      }));
      g.add(scatter(GEO.hemiTop, toon(0xffb8c8), 40, 2, ARENA_R + 4, (d) => (d.position.y = 0.02, d.scale.set(0.12, 0.06, 0.12))));
      break;
    }
    case 'volcano': {
      const rock = toon(0x3a2a26);
      g.add(ringOf(70, ARENA_R + 2, ARENA_R + 18, () => {
        const h = rnd(1.5, 4);
        const grp = new THREE.Group();
        grp.add(mesh(GEO.cone, rock, [0, h / 2, 0], [rnd(1, 2.2), h, rnd(1, 2.2)]));
        return grp;
      }));
      const lava = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
      tickers.push((t) => lava.color.setHSL(0.045 + 0.015 * Math.sin(t * 1.7), 1, 0.52 + 0.06 * Math.sin(t * 2.3)));
      g.add(scatter(new THREE.CircleGeometry(1, 20), lava, 22, ARENA_R + 1, ARENA_R + 14, (d) => {
        d.position.y = 0.03;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.setScalar(rnd(0.6, 2.2));
      }));
      g.add(boulders(toon(0x4a3630), 20, ARENA_R - 2, ARENA_R + 8, 0.3, 0.9));
      g.add(boulders(toon(0x3a2a26), 16, 4, ARENA_R - 2, 0.15, 0.4)); // cooled lava rocks
      // Glowing cracks across the arena floor
      g.add(scatter(GEO.box, lava, 26, 3, ARENA_R - 1, (d) => {
        d.position.y = 0.02;
        d.scale.set(rnd(0.6, 1.8), 0.01, 0.07);
      }));
      break;
    }
    case 'tower': {
      // Lavender's graveyard: rows of headstones, candles and a few bare trees.
      const stone = [toon(0x6e6a80), toon(0x5c586e)];
      const grave = (i: number) => {
        const grp = new THREE.Group();
        const h = rnd(0.7, 1.2);
        grp.add(mesh(GEO.box, stone[i % 2], [0, h / 2, 0], [0.7, h, 0.2]));
        grp.add(mesh(GEO.cyl, stone[i % 2], [0, h, 0], [0.35, 0.2, 0.35], [Math.PI / 2, 0, 0]));
        return grp;
      };
      g.add(ringOf(90, ARENA_R + 1, ARENA_R + 14, grave));
      g.add(ringOf(10, ARENA_R - 3, ARENA_R - 1.5, grave));
      const wax = toon(0xf0e8d0), flame = new THREE.MeshBasicMaterial({ color: 0xffb040 });
      tickers.push((t) => flame.color.setHSL(0.09 + 0.02 * Math.sin(t * 13), 1, 0.55 + 0.1 * Math.sin(t * 17 + Math.sin(t * 5))));
      g.add(ringOf(28, ARENA_R - 1, ARENA_R + 6, () => {
        const c = new THREE.Group();
        c.add(mesh(GEO.cyl, wax, [0, 0.15, 0], [0.06, 0.3, 0.06]));
        c.add(mesh(GEO.sphere, flame, [0, 0.36, 0], [0.05, 0.08, 0.05]));
        return c;
      }));
      const bark = toon(0x3a3040);
      g.add(ringOf(24, ARENA_R + 6, ARENA_R + 18, () => {
        const t = new THREE.Group();
        const h = rnd(2.5, 4);
        t.add(mesh(GEO.cyl, bark, [0, h / 2, 0], [0.14, h, 0.14]));
        for (let k = 0; k < 3; k++) t.add(mesh(GEO.cyl, bark, [0, h * rnd(0.55, 0.85), 0], [0.06, 1.2, 0.06], [rnd(-1, 1), rnd(0, 6), rnd(0.6, 1)]));
        return t;
      }));
      g.add(boulders(toon(0x4a4258), 30, 2, ARENA_R - 1, 0.06, 0.16));
      // A few headstones and candles inside, and low purple mist drifting over the floor.
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, r = rnd(5, ARENA_R - 4);
        const o = grave(i);
        o.scale.setScalar(0.7);
        o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        o.rotation.y = rnd(-0.4, 0.4);
        g.add(o);
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
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
  g.removeFromParent();
}
