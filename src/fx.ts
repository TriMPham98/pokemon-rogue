import * as THREE from 'three';
import { getTex, url } from './assets';

export interface FxOpts {
  size?: number;
  life?: number;
  grow?: number; // extra scale reached by end of life (0.5 = 150%)
  vel?: THREE.Vector3;
  gravity?: number;
  spin?: number;
  rotation?: number;
  color?: number;
  delay?: number;
}

interface Fx {
  s: THREE.Sprite;
  t: number;
  life: number;
  sx: number;
  sy: number;
  grow: number;
  vel?: THREE.Vector3;
  gravity: number;
  spin: number;
}

/** Fire-and-forget billboard effects built from Showdown battle-fx sprites. */
export class Effects {
  private list: Fx[] = [];

  constructor(private scene: THREE.Scene) {}

  /** A sprite sized so its longest side is `size` world units. Caller owns it. */
  sprite(name: string, size: number, item = false) {
    const st = getTex(item ? url.item(name) : url.fx(name));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.tex, transparent: true, depthWrite: false }));
    const k = size / Math.max(st.w, st.h);
    s.scale.set(st.w * k, st.h * k, 1);
    s.renderOrder = 10;
    return s;
  }

  spawn(name: string, pos: THREE.Vector3, o: FxOpts = {}) {
    const s = this.sprite(name, o.size ?? 1);
    s.position.copy(pos);
    s.material.rotation = o.rotation ?? 0;
    if (o.color !== undefined) s.material.color.setHex(o.color);
    s.visible = !o.delay;
    this.scene.add(s);
    this.list.push({
      s, t: -(o.delay ?? 0), life: o.life ?? 0.35, sx: s.scale.x, sy: s.scale.y, grow: o.grow ?? 0,
      vel: o.vel, gravity: o.gravity ?? 0, spin: o.spin ?? 0,
    });
  }

  /** Sparkle burst, e.g. on a successful catch or evolution. */
  sparkle(pos: THREE.Vector3, n: number, size = 0.45) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn('shine', pos, {
        size: size * (0.7 + Math.random() * 0.6), life: 0.7, grow: -0.6,
        vel: new THREE.Vector3(Math.cos(a) * 3, 2.5 + Math.random() * 2, Math.sin(a) * 3), gravity: 6,
      });
    }
  }

  update(dt: number) {
    this.list = this.list.filter((f) => {
      f.t += dt;
      if (f.t < 0) return true;
      f.s.visible = true;
      const p = f.t / f.life;
      if (f.vel) {
        f.s.position.addScaledVector(f.vel, dt);
        f.vel.y -= f.gravity * dt;
      }
      const k = Math.max(0.01, 1 + f.grow * p);
      f.s.scale.set(f.sx * k, f.sy * k, 1);
      f.s.material.rotation += f.spin * dt;
      f.s.material.opacity = 1 - p * p;
      if (p < 1) return true;
      f.s.removeFromParent();
      f.s.material.dispose();
      return false;
    });
  }
}
