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
