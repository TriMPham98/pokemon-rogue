import * as THREE from 'three';
import type { Species } from './data';

export const ARENA_R = 26;

/** Unit-sized geometries shared by every model; meshes scale them. */
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cone: new THREE.ConeGeometry(1, 1, 16),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  halfTorus: new THREE.TorusGeometry(1, 0.3, 8, 16, Math.PI),
  hemiTop: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  hemiBottom: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
};

type V3 = [number, number, number];

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, scale: V3 | number, rot?: V3) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  if (typeof scale === 'number') m.scale.setScalar(scale);
  else m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

/** Materials reused across many objects; never disposed per-entity. */
export function shared<T extends THREE.Material>(m: T): T {
  m.userData.shared = true;
  return m;
}

export interface MonModel {
  root: THREE.Group;
  mats: THREE.MeshToonMaterial[];
  height: number;
  radius: number;
  flame?: THREE.Object3D;
  wings: THREE.Object3D[];
}

export function buildMonModel(sp: Species): MonModel {
  const L = sp.look;
  const root = new THREE.Group();
  const mats: THREE.MeshToonMaterial[] = [];
  const wings: THREE.Object3D[] = [];
  let flame: THREE.Object3D | undefined;

  const M = (color: number, p: THREE.MeshToonMaterialParameters = {}) => {
    const m = new THREE.MeshToonMaterial({ color, ...p });
    m.userData.baseEmissive = m.emissive.getHex();
    mats.push(m);
    return m;
  };
  const add = <T extends THREE.Object3D>(o: T) => (root.add(o), o);

  const body = M(L.body);
  const accent = M(L.accent ?? L.body);
  const dark = M(0x1a1a1a);
  const white = M(0xffffff);

  const [sx, sy, sz] = L.bodyScale;
  const rx = 0.5 * sx, ry = 0.5 * sy, rz = 0.5 * sz;
  const by = (L.float ? 0.5 : 0.14) + ry;

  add(mesh(GEO.sphere, body, [0, by, 0], [rx, ry, rz]));
  if (L.belly !== undefined) {
    add(mesh(GEO.sphere, M(L.belly), [0, by - ry * 0.1, rz * 0.42], [rx * 0.72, ry * 0.75, rz * 0.6]));
  }

  if (!L.float) {
    const feet: V3[] = L.quad
      ? [[-rx * 0.55, 0.1, rz * 0.5], [rx * 0.55, 0.1, rz * 0.5], [-rx * 0.55, 0.1, -rz * 0.5], [rx * 0.55, 0.1, -rz * 0.5]]
      : [[-rx * 0.5, 0.1, rz * 0.35], [rx * 0.5, 0.1, rz * 0.35]];
    for (const f of feet) add(mesh(GEO.sphere, body, f, [0.13, 0.11, 0.17]));
  }

  // Face anchor: either a head sphere or the front of the body.
  let face = { y: by, z: 0, rx, ry, rz };
  if (L.head) {
    const hr = L.head;
    const hy = L.quad ? by + ry * 0.55 : by + ry * 0.8 + hr * 0.55;
    const hz = L.quad ? rz * 0.8 + hr * 0.25 : rz * 0.2;
    add(mesh(GEO.sphere, body, [0, hy, hz], hr));
    face = { y: hy, z: hz, rx: hr, ry: hr, rz: hr };
  }
  const top = face.y + face.ry;

  const er = Math.min(face.rx, face.ry) * 0.16;
  if (L.oneEye) {
    const ez = face.z + face.rz * 0.82;
    add(mesh(GEO.sphere, white, [0, face.y + face.ry * 0.1, ez], er * 2.2));
    add(mesh(GEO.sphere, dark, [0, face.y + face.ry * 0.1, ez + er * 1.5], er));
  } else {
    const eyeMat = L.eye !== undefined ? M(L.eye) : dark;
    for (const s of [-1, 1]) {
      const ex = s * face.rx * 0.38, ey = face.y + face.ry * 0.18, ez = face.z + face.rz * 0.86;
      add(mesh(GEO.sphere, eyeMat, [ex, ey, ez], [er, er * 1.35, er * 0.8]));
      add(mesh(GEO.sphere, L.eye === 0xffffff ? dark : white, [ex + s * er * 0.2, ey + er * 0.5, ez + er * 0.6], er * 0.4));
    }
  }

  if (L.ears) {
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * face.rx * 0.5, face.y + face.ry * 0.7, face.z - face.rz * 0.1);
      ear.rotation.z = -s * 0.4;
      if (L.ears === 'pointy') {
        const h = face.ry * (L.earLen ?? 1), r = face.rx * 0.26;
        ear.add(mesh(GEO.cone, body, [0, h / 2, 0], [r, h, r * 0.55]));
        if (L.earTip !== undefined) ear.add(mesh(GEO.cone, M(L.earTip), [0, h * 0.85, 0], [r * 0.36, h * 0.3, r * 0.22]));
      } else {
        ear.add(mesh(GEO.sphere, body, [0, face.ry * 0.25, 0], [face.rx * 0.32, face.ry * 0.34, face.rz * 0.1]));
      }
      add(ear);
    }
  }

  const tz = -rz * 0.9, ty = by - ry * 0.3;
  switch (L.tail) {
    case 'flame': {
      add(mesh(GEO.sphere, body, [0, ty, tz - 0.08], 0.12));
      add(mesh(GEO.sphere, body, [0, ty + 0.12, tz - 0.26], 0.1));
      const fl = new THREE.Group();
      fl.position.set(0, ty + 0.26, tz - 0.34);
      fl.add(mesh(GEO.cone, M(0xff6a1a, { emissive: 0xff4400, emissiveIntensity: 0.9 }), [0, 0.14, 0], [0.11, 0.32, 0.11]));
      fl.add(mesh(GEO.cone, M(0xffe066, { emissive: 0xffcc00, emissiveIntensity: 1 }), [0, 0.1, 0.03], [0.06, 0.2, 0.06]));
      flame = add(fl);
      break;
    }
    case 'bolt':
      add(mesh(GEO.box, accent, [0, ty, tz - 0.12], [0.07, 0.28, 0.1], [0.6, 0, 0]));
      add(mesh(GEO.box, body, [0, ty + 0.22, tz - 0.3], [0.08, 0.32, 0.22], [-0.5, 0, 0]));
      add(mesh(GEO.box, body, [0, ty + 0.5, tz - 0.42], [0.09, 0.4, 0.36], [0.4, 0, 0]));
      break;
    case 'curl':
      for (let i = 0; i < 3; i++) add(mesh(GEO.sphere, accent, [0, ty + i * 0.13, tz - 0.08 - i * 0.1], 0.12 - i * 0.02));
      break;
    case 'fan':
      for (const k of [-1, 0, 1])
        for (let i = 0; i < 3; i++)
          add(mesh(GEO.sphere, accent, [k * (0.08 + i * 0.09), ty + 0.05 + i * 0.14, tz - 0.08 - i * 0.1], 0.12 - i * 0.015));
      break;
  }

  for (const x of L.extra ?? []) {
    switch (x) {
      case 'bulb': {
        add(mesh(GEO.sphere, accent, [0, by + ry * 0.8, -rz * 0.2], [0.34, 0.32, 0.34]));
        const leaf = M(0x2f7d40);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          add(mesh(GEO.cone, leaf, [Math.cos(a) * 0.28, by + ry * 0.55, -rz * 0.2 + Math.sin(a) * 0.28], [0.12, 0.25, 0.05], [Math.sin(a) * 1.2, -a, -Math.cos(a) * 1.2]));
        }
        break;
      }
      case 'shell':
        add(mesh(GEO.sphere, accent, [0, by, -rz * 0.22], [rx * 1.08, ry * 1.02, rz * 0.85]));
        break;
      case 'wings':
        for (const s of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(s * rx * 0.85, by + ry * 0.2, -rz * 0.1);
          pivot.add(mesh(GEO.sphere, accent, [s * 0.28, 0, 0], [0.32, 0.07, 0.22]));
          pivot.userData.side = s;
          wings.push(add(pivot));
        }
        break;
      case 'magnets': {
        const metal = M(0x9aa4ad);
        for (const s of [-1, 1]) {
          add(mesh(GEO.halfTorus, metal, [s * (rx + 0.14), by, 0], 0.16, [0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2]));
          add(mesh(GEO.box, M(s > 0 ? 0xd83030 : 0x3060d8), [s * (rx + 0.14), by + 0.16, 0], [0.1, 0.06, 0.1]));
          add(mesh(GEO.box, M(s > 0 ? 0x3060d8 : 0xd83030), [s * (rx + 0.14), by - 0.16, 0], [0.1, 0.06, 0.1]));
        }
        add(mesh(GEO.cyl, metal, [0, top + 0.06, 0], [0.05, 0.14, 0.05]));
        add(mesh(GEO.cyl, metal, [0, top + 0.14, 0], [0.1, 0.04, 0.1]));
        break;
      }
      case 'leaves': {
        const leaf = M(0x4caf50);
        for (let i = 0; i < 5; i++) {
          const pivot = new THREE.Group();
          pivot.position.set(0, top - 0.05, 0);
          pivot.rotation.y = (i / 5) * Math.PI * 2;
          const tilt = new THREE.Group();
          tilt.rotation.x = 0.55;
          tilt.add(mesh(GEO.sphere, leaf, [0, 0.3, 0], [0.11, 0.34, 0.05]));
          pivot.add(tilt);
          add(pivot);
        }
        break;
      }
      case 'arms':
        for (const s of [-1, 1]) {
          add(mesh(GEO.sphere, body, [s * (rx + 0.08), by + 0.02, rz * 0.1], 0.12));
          add(mesh(GEO.sphere, body, [s * (rx + 0.24), by + 0.05, rz * 0.35], 0.18));
        }
        break;
      case 'aura': {
        const m = mesh(GEO.sphere, M(0x8a5cc8, { transparent: true, opacity: 0.35, depthWrite: false }), [0, by, 0], [rx * 1.45, ry * 1.45, rz * 1.45]);
        m.castShadow = false;
        add(m);
        break;
      }
      case 'bill':
        add(mesh(GEO.sphere, M(0xf7e9b0), [0, face.y - face.ry * 0.2, face.z + face.rz * 0.92], [face.rx * 0.45, face.ry * 0.15, face.rz * 0.35]));
        break;
      case 'beak':
        add(mesh(GEO.cone, M(0xe8a040), [0, face.y - face.ry * 0.1, face.z + face.rz * 1.05], [0.07, 0.18, 0.07], [Math.PI / 2, 0, 0]));
        break;
      case 'crest':
        for (let i = 0; i < 3; i++) add(mesh(GEO.box, accent, [(i - 1) * 0.08, top, face.z], [0.05, 0.16, 0.16]));
        break;
      case 'cheeks':
        for (const s of [-1, 1]) add(mesh(GEO.sphere, M(0xe0383a), [s * face.rx * 0.62, face.y - face.ry * 0.2, face.z + face.rz * 0.7], [face.rx * 0.17, face.rx * 0.17, face.rx * 0.09]));
        break;
    }
  }

  const box = new THREE.Box3().setFromObject(root);
  return { root, mats, height: box.max.y, radius: Math.max(rx, rz) + 0.1, flame, wings };
}

export function buildTrainer() {
  const root = new THREE.Group();
  const T = (c: number) => new THREE.MeshToonMaterial({ color: c });
  const skin = T(0xf1c9a0), red = T(0xd8323a), jeans = T(0x2f4a8a), white = T(0xffffff), hair = T(0x3a2a1a), pack = T(0xe0a030), dark = T(0x1a1a1a);

  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.14, 0.75, 0);
    hip.add(mesh(GEO.cyl, jeans, [0, -0.36, 0], [0.11, 0.72, 0.11]));
    hip.add(mesh(GEO.box, dark, [0, -0.72, 0.05], [0.18, 0.08, 0.28]));
    legs.push(hip);
    root.add(hip);

    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.38, 1.3, 0);
    shoulder.add(mesh(GEO.cyl, red, [0, -0.25, 0], [0.08, 0.5, 0.08]));
    shoulder.add(mesh(GEO.sphere, skin, [0, -0.54, 0], 0.08));
    arms.push(shoulder);
    root.add(shoulder);
  }
  root.add(mesh(GEO.cyl, red, [0, 1.05, 0], [0.3, 0.6, 0.22]));
  root.add(mesh(GEO.cyl, white, [0, 1.2, 0.01], [0.305, 0.08, 0.225]));
  root.add(mesh(GEO.box, pack, [0, 1.1, -0.27], [0.42, 0.45, 0.2]));
  root.add(mesh(GEO.sphere, skin, [0, 1.62, 0], 0.26));
  root.add(mesh(GEO.sphere, hair, [0, 1.64, -0.05], 0.265));
  for (const s of [-1, 1]) root.add(mesh(GEO.sphere, dark, [s * 0.09, 1.64, 0.23], [0.035, 0.05, 0.03]));
  root.add(mesh(GEO.hemiTop, red, [0, 1.7, 0], 0.285));
  root.add(mesh(GEO.cyl, red, [0, 1.71, 0.2], [0.2, 0.025, 0.16]));
  root.add(mesh(GEO.box, white, [0, 1.84, 0.21], [0.14, 0.1, 0.04], [-0.5, 0, 0]));
  return { root, legs, arms };
}

const ballRed = shared(new THREE.MeshToonMaterial({ color: 0xe53935 }));
const ballWhite = shared(new THREE.MeshToonMaterial({ color: 0xf5f5f5 }));
const ballBlack = shared(new THREE.MeshToonMaterial({ color: 0x1a1a1a }));

export function buildPokeball(r = 0.2) {
  const g = new THREE.Group();
  g.add(mesh(GEO.hemiTop, ballRed, [0, 0, 0], r));
  g.add(mesh(GEO.hemiBottom, ballWhite, [0, 0, 0], r));
  g.add(mesh(GEO.cyl, ballBlack, [0, 0, 0], [r * 1.02, r * 0.14, r * 1.02]));
  g.add(mesh(GEO.cyl, ballWhite, [0, 0, r * 0.98], [r * 0.3, r * 0.12, r * 0.3], [Math.PI / 2, 0, 0]));
  return g;
}

export function buildArena() {
  const g = new THREE.Group();
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshToonMaterial({ color: 0x6fb85a }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 64), new THREE.MeshToonMaterial({ color: 0x92d47a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  g.add(floor);

  const edge = new THREE.Mesh(new THREE.RingGeometry(ARENA_R, ARENA_R + 0.5, 96), new THREE.MeshToonMaterial({ color: 0xe9dca4 }));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  g.add(edge);

  // Grass tufts
  const tufts = new THREE.InstancedMesh(GEO.cone, new THREE.MeshToonMaterial({ color: 0x4f9a3e }), 500);
  const d = new THREE.Object3D();
  for (let i = 0; i < tufts.count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = i < 120 ? Math.sqrt(Math.random()) * ARENA_R : rnd(ARENA_R + 1, ARENA_R + 22);
    const h = rnd(0.25, 0.55);
    d.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    d.scale.set(0.07, h, 0.07);
    d.rotation.set(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2));
    d.updateMatrix();
    tufts.setMatrixAt(i, d.matrix);
  }
  g.add(tufts);

  // Flowers
  const flowers = new THREE.InstancedMesh(GEO.sphere, new THREE.MeshToonMaterial({ color: 0xffffff }), 160);
  const palette = [0xffffff, 0xffd84a, 0xff7aa8, 0xb88cff];
  const col = new THREE.Color();
  for (let i = 0; i < flowers.count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ARENA_R + 10);
    d.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
    d.scale.setScalar(0.07);
    d.rotation.set(0, 0, 0);
    d.updateMatrix();
    flowers.setMatrixAt(i, d.matrix);
    flowers.setColorAt(i, col.setHex(palette[i % palette.length]));
  }
  g.add(flowers);

  // Tree ring
  const trunk = new THREE.MeshToonMaterial({ color: 0x7a5232 });
  const leaves = [new THREE.MeshToonMaterial({ color: 0x2f7d40 }), new THREE.MeshToonMaterial({ color: 0x3d9650 })];
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rnd(-0.04, 0.04);
    const r = ARENA_R + rnd(3, 16);
    const s = rnd(0.8, 1.5);
    const tree = new THREE.Group();
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    tree.scale.setScalar(s);
    tree.add(mesh(GEO.cyl, trunk, [0, 0.8, 0], [0.22, 1.6, 0.22]));
    tree.add(mesh(GEO.cone, leaves[i % 2], [0, 2.3, 0], [1.3, 2.2, 1.3]));
    tree.add(mesh(GEO.cone, leaves[(i + 1) % 2], [0, 3.4, 0], [0.95, 1.8, 0.95]));
    g.add(tree);
  }

  // Rocks
  const rockMat = new THREE.MeshToonMaterial({ color: 0x9a9a92 });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rnd(6, ARENA_R + 6);
    const s = rnd(0.25, 0.6);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    rock.scale.set(s, s * 0.6, s);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = rock.receiveShadow = true;
    g.add(rock);
  }
  return g;
}
