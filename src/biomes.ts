import * as THREE from 'three';
import { MUSIC, type PType } from './data';
import { ARENA_R, GEO, mesh } from './models';

type Deco = 'meadow' | 'forest' | 'cave' | 'beach' | 'volcano';

export interface Biome {
  name: string;
  deco: Deco;
  ground: number;
  floor: number;
  edge: number;
  tuft: number;
  sky: number;
  light: number; // hemisphere intensity
  types: PType[]; // favoured in the spawn pool; empty = no preference
  music: string;
}

/** A new area every 5 rounds (right after each Alpha). Loops after the last one. */
export const BIOMES: Biome[] = [
  { name: 'Route 1', deco: 'meadow', ground: 0x6fb85a, floor: 0x92d47a, edge: 0xe9dca4, tuft: 0x4f9a3e, sky: 0xa8dcff, light: 1.6, types: [], music: MUSIC.areas[0] },
  { name: 'Viridian Forest', deco: 'forest', ground: 0x2f6b34, floor: 0x5e9a4c, edge: 0x7a6a3c, tuft: 0x2e6a2c, sky: 0x86b89a, light: 1.3, types: ['grass', 'flying', 'normal', 'electric'], music: MUSIC.areas[1] },
  { name: 'Rock Tunnel', deco: 'cave', ground: 0x3f3934, floor: 0x7a6e60, edge: 0x5a5048, tuft: 0x6a6258, sky: 0x24222a, light: 1.0, types: ['rock', 'fighting', 'ghost', 'psychic'], music: MUSIC.areas[2] },
  { name: 'Cerulean Cape', deco: 'beach', ground: 0x3d8fd6, floor: 0xf0e0aa, edge: 0xfff6d8, tuft: 0x7cbf5a, sky: 0x9fdcff, light: 1.7, types: ['water', 'flying', 'electric', 'psychic'], music: MUSIC.areas[3] },
  { name: 'Cinnabar Volcano', deco: 'volcano', ground: 0x2e1d1a, floor: 0x5e3a30, edge: 0xff6a1a, tuft: 0x6b4a3a, sky: 0x3a1c18, light: 1.1, types: ['fire', 'rock', 'fighting', 'ghost'], music: MUSIC.areas[4] },
];

export const biomeFor = (round: number) => BIOMES[Math.floor((Math.max(1, round) - 1) / 5) % BIOMES.length];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
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

export function buildArena(b: Biome) {
  const g = new THREE.Group();
  g.add(disc(80, b.ground, 0));
  g.add(disc(ARENA_R, b.floor, 0.01));
  const edge = new THREE.Mesh(new THREE.RingGeometry(ARENA_R, ARENA_R + 0.5, 96), toon(b.edge));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  g.add(edge);

  // A few tufts inside for texture, more outside.
  const tuftMat = toon(b.tuft);
  const tuft = (d: THREE.Object3D) => {
    const h = rnd(0.25, 0.55);
    d.position.y = h / 2;
    d.scale.set(0.07, h, 0.07);
    d.rotation.x = rnd(-0.2, 0.2);
  };
  g.add(scatter(GEO.cone, tuftMat, 30, 0, ARENA_R, tuft));
  if (b.deco !== 'beach') g.add(scatter(GEO.cone, tuftMat, 400, ARENA_R + 1, ARENA_R + 22, tuft));

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
      const stone = [toon(0x4e463f), toon(0x5d544b)];
      g.add(ringOf(90, ARENA_R + 1, ARENA_R + 18, (i) => {
        const h = rnd(2, 6);
        const m = mesh(GEO.cone, stone[i % 2], [0, h / 2, 0], [rnd(0.8, 1.8), h, rnd(0.8, 1.8)]);
        const grp = new THREE.Group();
        grp.add(m);
        return grp;
      }));
      g.add(boulders(toon(0x6b6157), 26, ARENA_R - 3, ARENA_R + 10, 0.4, 1.2));
      g.add(boulders(toon(0x5a524a), 50, 2, ARENA_R - 1, 0.06, 0.16)); // pebbles
      g.add(scatter(GEO.cone, toon(0x8fd8ff, { emissive: 0x3aa0ff, emissiveIntensity: 0.8 }), 10, 5, ARENA_R - 2, (d) => {
        const h = rnd(0.25, 0.5);
        d.position.y = h / 2;
        d.scale.set(0.08, h, 0.08);
      }));
      // Glowing crystals for light and colour.
      g.add(scatter(GEO.cone, toon(0x8fd8ff, { emissive: 0x3aa0ff, emissiveIntensity: 0.8 }), 24, ARENA_R + 0.5, ARENA_R + 7, (d) => {
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
      // Tide pools and shells
      g.add(scatter(new THREE.CircleGeometry(1, 24), toon(0x6cc2ee), 6, 5, ARENA_R - 3, (d) => {
        d.position.y = 0.015;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.set(rnd(0.8, 1.6), rnd(0.5, 1), 1);
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
      g.add(scatter(new THREE.CircleGeometry(1, 20), lava, 22, ARENA_R + 1, ARENA_R + 14, (d) => {
        d.position.y = 0.03;
        d.rotation.set(-Math.PI / 2, 0, 0);
        d.scale.setScalar(rnd(0.6, 2.2));
      }));
      g.add(boulders(toon(0x4a3630), 20, ARENA_R - 2, ARENA_R + 8, 0.3, 0.9));
      // Glowing cracks across the arena floor
      g.add(scatter(GEO.box, lava, 26, 3, ARENA_R - 1, (d) => {
        d.position.y = 0.02;
        d.scale.set(rnd(0.6, 1.8), 0.01, 0.07);
      }));
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
    if (!m.isMesh) return;
    if (!shared.has(m.geometry)) m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
  g.removeFromParent();
}
