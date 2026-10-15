import * as THREE from 'three';
import { getTex, url } from './assets';
import { ANIMS, type AnimDef } from './data';

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

interface Ring {
  m: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  t: number;
  life: number;
  r: number;
  hold: boolean;
}

const ANIM_FPS = 15;
const ringGeo = new THREE.RingGeometry(0.9, 1, 64);

/**
 * Fire-and-forget billboard effects. Names in ANIMS are FireRed battle-anim sheets (animated: looping ones cycle,
 * the rest play once over the effect's life); anything else is a Showdown battle-fx sprite.
 */
export class Effects {
  private list: Fx[] = [];
  private rings: Ring[] = [];

  constructor(private scene: THREE.Scene) {}

  /** A sprite sized so its longest side is `size` world units. Caller owns it (release with drop()). */
  sprite(name: string, size: number, item = false) {
    const def = item ? undefined : ANIMS[name];
    if (def) {
      const tex = getTex(url.battle(name)).tex.clone();
      tex.repeat.set(1, 1 / def.n);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      const k = size / Math.max(def.w, def.h);
      s.scale.set(def.w * k, def.h * k, 1);
      s.renderOrder = 10;
      s.userData.anim = def;
      this.frame(s, 0);
      return s;
    }
    const st = getTex(item ? url.item(name) : url.fx(name));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: st.tex, transparent: true, depthWrite: false }));
    const k = size / Math.max(st.w, st.h);
    s.scale.set(st.w * k, st.h * k, 1);
    s.renderOrder = 10;
    return s;
  }

  /** Shows frame `i` of an animated sheet (wraps). */
  frame(s: THREE.Sprite, i: number) {
    const def = s.userData.anim as AnimDef | undefined;
    if (!def) return;
    const f = ((Math.floor(i) % def.n) + def.n) % def.n;
    s.material.map!.offset.y = 1 - (f + 1) / def.n;
  }

  /** Advances a sprite the caller is moving itself (projectiles): looping sheets cycle, play-once ones hold frame 0. */
  tick(s: THREE.Sprite, t: number) {
    const def = s.userData.anim as AnimDef | undefined;
    if (def?.loop) this.frame(s, t * (def.fps ?? ANIM_FPS));
  }

  drop(s: THREE.Sprite) {
    s.removeFromParent();
    if (s.userData.anim) s.material.map?.dispose(); // its own UV view; the image itself is shared
    s.material.dispose();
  }

  spawn(name: string, pos: THREE.Vector3, o: FxOpts = {}) {
    const s = this.sprite(name, o.size ?? 1);
    const def = s.userData.anim as AnimDef | undefined;
    s.position.copy(pos);
    s.material.rotation = o.rotation ?? 0;
    if (o.color !== undefined) s.material.color.setHex(o.color);
    s.visible = !o.delay;
    this.scene.add(s);
    // A play-once sheet runs at the game's pace unless told otherwise.
    const life = o.life ?? (def && !def.loop ? def.n / (def.fps ?? ANIM_FPS) + 0.1 : 0.35);
    this.list.push({
      s, t: -(o.delay ?? 0), life, sx: s.scale.x, sy: s.scale.y, grow: o.grow ?? 0,
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

  /**
   * A ring on the ground showing an area: a shockwave expanding out to radius `r`, or with `hold` a pulsing warning
   * that stays at `r` for its whole life (a fuse about to blow).
   */
  ring(pos: THREE.Vector3, r: number, color: number, life = 0.45, hold = false) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.07, pos.z);
    m.renderOrder = 5;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, r, hold });
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
      const def = f.s.userData.anim as AnimDef | undefined;
      if (def?.loop) this.frame(f.s, f.t * (def.fps ?? ANIM_FPS));
      else if (def) this.frame(f.s, Math.min(def.n - 1, p * def.n));
      // Animated sheets carry their own ending; only fade the last stretch.
      f.s.material.opacity = def ? Math.min(1, (1 - p) * 5) : 1 - p * p;
      if (p < 1) return true;
      this.drop(f.s);
      return false;
    });
    this.rings = this.rings.filter((g) => {
      g.t += dt;
      const p = g.t / g.life;
      if (g.hold) {
        g.m.scale.setScalar(g.r);
        g.m.material.opacity = 0.35 + 0.35 * Math.sin(g.t * (10 + 30 * p));
      } else {
        g.m.scale.setScalar(g.r * (0.3 + 0.7 * Math.sqrt(Math.min(1, p))));
        g.m.material.opacity = 0.9 * (1 - p);
      }
      if (p < 1) return true;
      g.m.removeFromParent();
      g.m.material.dispose();
      return false;
    });
  }
}
