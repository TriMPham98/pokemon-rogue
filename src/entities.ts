import * as THREE from 'three';
import { expAt, type MoveKind, type Species, type Stats, type Status } from './data';
import { calcStats, randomIvs } from './battle';
import { type AnimSheet, getAnim, getTex, setFrame, sheetView, silhouette, url } from './assets';
import { shared } from './models';

/**
 * On-screen height for a Pokédex height in metres, next to the 1.9-unit trainer. Square-root compressed so
 * Diglett (0.2 m) is still clickable and Onix (8.8 m) still fits the arena.
 */
const worldHeight = (m: number) => Math.max(0.55, Math.min(4.2, 1.3 * Math.sqrt(m)));

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

/** A move in progress: the attacker winds up for `wind` seconds, then the move fires and a short follow-through plays. */
export interface Act {
  pose: MoveKind;
  t: number;
  wind: number;
  dir: THREE.Vector2; // toward the target, XZ
  fired: boolean;
  color: number; // type colour for the charge glow
  fire: () => void;
}

/** Follow-through after a move fires. */
export const ACT_FOLLOW = 0.25;

export class Mon {
  xp = 0; // total experience, on the species' growth curve
  hp = 0;
  maxHp = 0;
  readonly ivs: Stats = randomIvs();
  stats!: Stats;
  status: Status | null = null;
  statusTick = 0; // seconds until the next poison/burn chip
  trapT = 0; // >0 while bound by Fire Spin / Clamp
  slowT = 0; // >0 while slowed by String Shot
  // Wild behaviour: loiter around `home` until something comes close, then fight.
  home: { x: number; z: number; r: number } | null = null;
  aggro = false;
  wanderT = 0;
  readonly wanderTo = new THREE.Vector2();
  cd = Math.random() * 0.8;
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
  target: Mon | null = null;
  lastHitBy: Mon | null = null; // who gets the knockout's full experience
  evolveTo: Species | null = null;
  evolving = 0; // seconds left in the evolution sequence
  evoFlicker = 0; // drives the old/new silhouette swap
  act: Act | null = null;
  animClock = Math.random() * 10; // drives the animated sprite; runs faster while walking or attacking
  private viewDex: number | null = null;
  private white = false;
  private sheet: AnimSheet | null = null;
  private px = 0.027;
  /** Per-instance texture views (own UV repeat/offset for frames and mirroring, shared GPU image). */
  private views = new Map<THREE.Texture, THREE.Texture>();

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

  constructor(public sp: Species, public level: number, readonly side: Side, readonly leader = false, readonly shiny = false) {
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.03;
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.ring.visible = false;
    this.obj.add(this.sprite, this.shadow, this.ring, this.bar.obj);
    this.back = side === 'party';
    this.setSpecies(sp);
    this.xp = expAt(sp.growth, level);
  }

  get pos() {
    return this.obj.position;
  }
  /** Speed multiplier from paralysis and String Shot. */
  get slowMul() {
    return (this.status === 'par' ? 0.5 : 1) * (this.slowT > 0 ? 0.5 : 1);
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
    const f = getTex(url.front(sp.dex, this.shiny));
    // World units per sprite pixel, so the front sprite stands as tall as its Pokédex height says.
    this.px = worldHeight(sp.height) / f.h;
    this.w = f.w * this.px;
    this.h = f.h * this.px;
    this.shadow.scale.setScalar(Math.max(0.3, this.w * 0.36));
    this.ring.scale.setScalar(Math.max(0.8, this.w * 0.65));
    this.applyView();
  }

  recalc() {
    this.stats = calcStats(this.sp.base, this.ivs, this.level);
    this.maxHp = this.stats.hp;
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
    const k = this.px;
    // Animated Black/White sprite once it's decoded; the static sprite until then and for silhouettes.
    const sheet = this.white ? null : getAnim(url.anim(dex, this.back, this.shiny));
    this.sheet = sheet ?? null;
    let base: THREE.Texture;
    if (sheet) {
      base = sheet.tex;
      this.viewW = sheet.w * k;
      this.viewH = sheet.h * k;
    } else {
      const src = this.back ? url.back(dex, this.shiny) : url.front(dex, this.shiny);
      const st = getTex(src);
      base = this.white ? silhouette(src) : st.tex;
      this.viewW = st.w * k;
      this.viewH = st.h * k;
    }
    let tex = this.views.get(base);
    if (!tex) this.views.set(base, (tex = sheet ? sheetView(sheet) : base.clone()));
    if (sheet) setFrame(tex, sheet, this.animClock, this.flip);
    else {
      tex.repeat.x = this.flip ? -1 : 1;
      tex.offset.x = this.flip ? 1 : 0;
    }
    if (this.mat.map !== tex) {
      this.mat.map = tex;
      this.mat.needsUpdate = true;
    }
  }

  /** Advances the animated sprite; picks up a sheet that finished decoding since the last view change. */
  tickAnim(dt: number) {
    this.animClock += dt;
    if (!this.sheet && !this.white) this.applyView();
    if (this.sheet) setFrame(this.mat.map!, this.sheet, this.animClock, this.flip);
  }

  dispose() {
    for (const t of this.views.values()) t.dispose();
    this.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m) && !m.userData.shared) m.dispose();
    });
    this.obj.removeFromParent();
  }
}

export const TRAINER_FRAMES = 9; // pokefirered overworld sheet: down, up, left, then two walking frames for each
const STAND = { down: 0, up: 1, left: 2, right: 2 };
const STEPS = { down: [3, 4], up: [5, 6], left: [7, 8], right: [7, 8] };
type Facing = keyof typeof STAND;

/** The player: Red's overworld sprite, billboarded like the Pokémon. */
export class Trainer {
  walk = 0; // walk-cycle phase
  moving = false;
  throwT = 0;
  facing: Facing = 'down';
  readonly radius = 0.45;
  readonly height = 1.9;
  readonly obj = new THREE.Group();
  readonly sprite: THREE.Sprite;
  private tex: THREE.Texture;

  constructor(sheet: string) {
    this.tex = new THREE.TextureLoader().load(url.trainer(sheet));
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.repeat.set(1 / TRAINER_FRAMES, 1);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, alphaTest: 0.1 }));
    this.sprite.center.set(0.5, 0);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.setScalar(0.4);
    this.obj.add(this.sprite, shadow);
  }

  get pos() {
    return this.obj.position;
  }

  face(dx: number, dz: number) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    this.facing = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'left' : 'right') : dz < 0 ? 'up' : 'down';
  }

  /** Picks the sheet frame and squash for this tick. `walkRate` is steps per second (0 = standing). */
  animate(dt: number, walkRate: number) {
    this.throwT = Math.max(0, this.throwT - dt);
    if (walkRate > 0) this.walk += dt * walkRate;
    else this.walk = 0;
    const phase = Math.floor(this.walk) % 4; // step, stand, other step, stand
    const frame = phase % 2 === 0 && walkRate > 0 ? STEPS[this.facing][phase / 2] : STAND[this.facing];
    // The sheet only has left-facing frames; right mirrors them in UV space (sprites ignore negative scale).
    const right = this.facing === 'right';
    this.tex.repeat.x = (right ? -1 : 1) / TRAINER_FRAMES;
    this.tex.offset.x = (frame + (right ? 1 : 0)) / TRAINER_FRAMES;
    // A quick wind-up and fling when throwing a ball.
    const th = this.throwT > 0 ? Math.sin((1 - this.throwT / 0.3) * Math.PI) : 0;
    const w = 0.95, h = 1.9;
    this.sprite.scale.set(w * (1 + 0.08 * th), h * (1 - 0.08 * th), 1);
    this.sprite.position.y = walkRate > 0 ? Math.abs(Math.sin(this.walk * Math.PI)) * 0.05 : 0;
  }
}
