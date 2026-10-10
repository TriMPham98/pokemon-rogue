import * as THREE from 'three';

export const ARENA_R = 26;

/** Unit-sized geometries shared by every model; meshes scale them. */
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cone: new THREE.ConeGeometry(1, 1, 16),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  hemiTop: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
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
    const r = i < 30 ? Math.sqrt(Math.random()) * ARENA_R : rnd(ARENA_R + 1, ARENA_R + 22);
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
    const a = Math.random() * Math.PI * 2, r = rnd(ARENA_R + 1, ARENA_R + 12);
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
    const a = Math.random() * Math.PI * 2, r = rnd(ARENA_R - 2, ARENA_R + 8);
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
