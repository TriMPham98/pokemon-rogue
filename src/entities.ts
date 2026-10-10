import * as THREE from 'three';
import type { Species } from './data';
import { buildMonModel, buildTrainer, shared, type MonModel } from './models';

const BAR_W = 1;
const barBgGeo = new THREE.PlaneGeometry(BAR_W + 0.08, 0.17);
const barFgGeo = new THREE.PlaneGeometry(BAR_W, 0.11);
const barBgMat = shared(new THREE.MeshBasicMaterial({ color: 0x1b1b1b, depthTest: false, transparent: true, opacity: 0.85 }));

const ringGeo = new THREE.RingGeometry(0.6, 0.78, 32);
/** Pulsing ring under weakened wild Pokémon: "throw a ball now". Opacity animated globally. */
export const weakRingMat = shared(new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false }));

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

export class Label {
  readonly sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor(text: string, color: string) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.scale.set(2.2, 0.55, 1);
    this.sprite.renderOrder = 1000;
    this.set(text, color);
  }

  set(text: string, color: string) {
    if (this.key === text + color) return;
    this.key = text + color;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 34);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
  }
}

let uidSeq = 0;

export type Side = 'party' | 'wild';

export class Mon {
  readonly uid = ++uidSeq;
  xp = 0;
  hp = 0;
  maxHp = 0;
  cd = Math.random() * 0.8;
  lunge = 0;
  flash = 0;
  flashOn = false;
  grow = 0; // spawn pop-in, 0..1
  capScale = 1; // shrinks to 0 while inside a Poké Ball / fainted
  retarget = 0;
  fainted = false;
  dying = -1;
  capturing = false;
  moving = false;
  anim = Math.random() * 10;
  target: Unit | null = null;

  readonly obj = new THREE.Group(); // world position, unrotated (bars/labels live here)
  readonly yaw = new THREE.Group(); // facing + scale
  readonly model: MonModel;
  readonly bar = new HpBar();
  readonly label: Label;
  readonly ring: THREE.Mesh;
  readonly scale: number;

  constructor(readonly sp: Species, public level: number, readonly side: Side, readonly boss = false) {
    this.model = buildMonModel(sp);
    this.scale = (boss ? 1.75 : 1) * Math.min(1.25, 0.9 + level * 0.012);
    this.label = new Label(this.labelText(), this.labelColor());
    this.ring = new THREE.Mesh(ringGeo, weakRingMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.ring.scale.setScalar(this.scale);
    this.ring.visible = false;
    this.yaw.add(this.model.root);
    this.obj.add(this.yaw, this.bar.obj, this.label.sprite, this.ring);
    this.recalc();
    this.hp = this.maxHp;
  }

  get pos() {
    return this.obj.position;
  }
  get radius() {
    return this.model.radius * this.scale;
  }
  get height() {
    return this.model.height * this.scale;
  }
  /** Can act and be targeted. */
  get alive() {
    return !this.fainted && this.dying < 0 && !this.capturing;
  }

  recalc() {
    this.maxHp = Math.round(this.sp.hp * (1 + 0.15 * (this.level - 1)) * (this.boss ? 3.5 : 1));
  }

  labelText() {
    if (this.boss) return `ALPHA Lv${this.level}`;
    return this.side === 'party' ? `${this.sp.name} ${this.level}` : `Lv${this.level}`;
  }
  labelColor() {
    return this.boss ? '#ff9a3c' : this.side === 'party' ? '#a6f5b0' : '#ffffff';
  }
  refreshLabel() {
    this.label.set(this.labelText(), this.labelColor());
  }

  dispose() {
    this.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m) && !m.userData.shared) m.dispose();
    });
    this.label.dispose();
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
