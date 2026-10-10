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

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3, scale: V3 | number, rot?: V3) {
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
