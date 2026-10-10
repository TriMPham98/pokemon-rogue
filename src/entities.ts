import * as THREE from 'three';
import type { Species } from './data';
import { getTex, silhouette, url } from './assets';
import { buildTrainer, shared } from './models';

/** World units per sprite pixel. */
const PX = 0.027;

const BAR_W = 1;
const barBgGeo = new THREE.PlaneGeometry(BAR_W + 0.08, 0.15);
const barFgGeo = new THREE.PlaneGeometry(BAR_W, 0.09);
const barBgMat = shared(new THREE.MeshBasicMaterial({ color: 0x1b1b1b, depthTest: false, transparent: true, opacity: 0.8 }));

const ringGeo = new THREE.RingGeometry(0.6, 0.78, 32);
/** Pulsing ring under weakened wild Pokémon: "throw a ball now". Opacity animated globally. */
export const weakRingMat = shared(new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false }));

const shadowGeo = new THREE.CircleGeometry(1, 24);
const shadowMat = shared(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));

export class HpBar {
  readonly obj = new THREE.Group();
  private fg: THREE.Mesh;
  private mat = new THREE.MeshBasicMaterial({ color: 0x4cd964, depthTest: false, transparent: true });

  constructor() {
    const bg = new THREE.Mesh(barBgGeo, barBgMat);
    bg.renderOrder = 998;
    this.fg = new THREE.Mesh(barFgGeo, this.mat);
    this.fg.renderOrder = 999;
    this.fg.position.z = 0.001;
    this.obj.add(bg, this.fg);
  }

  set(frac: number) {
    const f = Math.max(0.001, Math.min(1, frac));
    this.fg.scale.x = f;
    this.fg.position.x = (-(1 - f) * BAR_W) / 2;
    this.mat.color.setHex(f > 0.5 ? 0x4cd964 : f > 0.25 ? 0xffcc00 : 0xff3b30);
  }
}

export type Side = 'party' | 'wild';

export class Mon {
  xp = 0;
  hp = 0;
  maxHp = 0;
  cd = Math.random() * 0.8;
  lunge = 0;
  lungeDir = new THREE.Vector2();
  flash = 0;
  hurtT = 0; // recent damage, drives the party card flash
  grow = 0; // spawn pop-in, 0..1
  capScale = 1; // shrinks to 0 while inside a Poké Ball / fainted
  retarget = 0;
  fainted = false;
  dying = -1;
  capturing = false;
  moving = false;
  anim = Math.random() * 10;
  target: Unit | null = null;
  evolveTo: Species | null = null;
  evolving = 0; // seconds left in the evolution sequence
  evoFlicker = 0; // drives the old/new silhouette swap
  private viewDex: number | null = null;
  private white = false;

  /** Sprite view: back sprite when heading away from the camera, mirrored to face left/right. */
  back = false;
  flip = false;
  viewW = 1;
  viewH = 1;
  w = 1;
  h = 1;

  readonly obj = new THREE.Group();
  readonly sprite: THREE.Sprite;
  readonly mat = new THREE.SpriteMaterial({ alphaTest: 0.1 });
  readonly shadow = new THREE.Mesh(shadowGeo, shadowMat);
  readonly bar = new HpBar();
  readonly ring = new THREE.Mesh(ringGeo, weakRingMat);
  readonly alphaIcon?: THREE.Sprite;

  constructor(public sp: Species, public level: number, readonly side: Side, readonly boss = false) {
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.ring.visible = false;
    this.obj.add(this.sprite, this.shadow, this.ring, this.bar.obj);
    if (boss) {
      const a = getTex(url.fx('alpha'));
      this.alphaIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: a.tex, depthTest: false }));
      this.alphaIcon.scale.setScalar(0.45);
      this.alphaIcon.renderOrder = 1000;
      this.obj.add(this.alphaIcon);
    }
    this.back = side === 'party';
    this.setSpecies(sp);
  }

  get pos() {
    return this.obj.position;
  }
  get radius() {
    return Math.max(0.3, this.w * 0.35);
  }
  get height() {
    return this.h;
  }
  /** Can act and be targeted. */
  get alive() {
    return !this.fainted && this.dying < 0 && !this.capturing && !this.evolveTo;
  }

  setSpecies(sp: Species) {
    const frac = this.maxHp ? this.hp / this.maxHp : 1;
    this.sp = sp;
    this.recalc();
    this.hp = Math.round(this.maxHp * frac);
    const f = getTex(url.front(sp.dex));
    const k = PX * (this.boss ? 1.6 : 1);
    this.w = f.w * k;
    this.h = f.h * k;
    this.shadow.scale.setScalar(Math.max(0.3, this.w * 0.36));
    this.ring.scale.setScalar(Math.max(0.8, this.w * 0.65));
    this.applyView();
  }

  recalc() {
    this.maxHp = Math.round(this.sp.hp * (1 + 0.15 * (this.level - 1)) * (this.boss ? 3.5 : 1));
  }

  face(dx: number, dz: number) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = dx / len, nz = dz / len;
    if (nz < -0.45) this.back = true;
    else if (nz > 0.25) this.back = false;
    // Front sprites look left; back sprites look right.
    if (Math.abs(nx) > 0.2) this.flip = this.back ? nx < 0 : nx > 0;
    this.applyView();
  }

  /** Temporarily show another species' sprite, optionally as a white silhouette (evolution flicker). */
  showDex(dex: number | null, white = false) {
    if (dex === this.viewDex && white === this.white) return;
    this.viewDex = dex;
    this.white = white;
    this.applyView();
  }

  private applyView() {
    const dex = this.viewDex ?? this.sp.dex;
    const src = this.back ? url.back(dex) : url.front(dex);
    const st = getTex(src);
    const tex = this.white ? silhouette(src) : st.tex;
    if (this.mat.map !== tex) {
      this.mat.map = tex;
      this.mat.needsUpdate = true;
    }
    const k = PX * (this.boss ? 1.6 : 1);
    this.viewW = st.w * k;
    this.viewH = st.h * k;
  }

  dispose() {
    this.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m) && !m.userData.shared) m.dispose();
    });
    this.obj.removeFromParent();
  }
}

export class Trainer {
  hp = 100;
  maxHp = 100;
  inv = 0;
  walk = 0;
  moving = false;
  readonly radius = 0.45;
  readonly height = 1.9;
  readonly obj: THREE.Group;
  readonly legs: THREE.Object3D[];
  readonly arms: THREE.Object3D[];

  constructor() {
    const t = buildTrainer();
    this.obj = t.root;
    this.legs = t.legs;
    this.arms = t.arms;
  }

  get pos() {
    return this.obj.position;
  }
}

export type Unit = Mon | Trainer;
