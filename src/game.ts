import * as THREE from 'three';
import { SPECIES, SPECIES_BY_ID, STARTERS, TYPE_COLOR, hex, typeMult, type PType } from './data';
import { ARENA_R, GEO, buildArena, buildPokeball, shared } from './models';
import { Mon, Trainer, weakRingMat, type Unit } from './entities';
import { UI } from './ui';

type State = 'starter' | 'playing' | 'reward' | 'swap' | 'gameover';

interface Projectile { mesh: THREE.Mesh; target: Unit; dmg: number; mult: number }
interface Ball {
  obj: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  state: 'fly' | 'wobble' | 'miss';
  mon: Mon | null;
  success: boolean;
  resolveAt: number;
}
interface Floater { el: HTMLElement; pos: THREE.Vector3; t: number }
interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; t: number; life: number; size: number }

interface Reward {
  title: string;
  icon: string;
  desc: string;
  cond?: (g: Game) => boolean;
  apply: (g: Game) => void;
}

const PARTY_MAX = 6;
const THROW_RANGE = 14;
const TRAINER_SPEED = 7;
const CAM_OFFSET = new THREE.Vector3(0, 15, 11);
const SUN_OFFSET = new THREE.Vector3(12, 22, 8);
const FLOATER_LIFE = 0.9;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distXZ = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const easeOutBack = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const shuffle = <T>(arr: T[]) => arr.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const xpNeed = (level: number) => level * level;

const matCache = new Map<number, THREE.MeshBasicMaterial>();
const glowMat = (color: number) => {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = shared(new THREE.MeshBasicMaterial({ color }))));
  return m;
};

const REWARDS: Reward[] = [
  {
    title: 'Hyper Potion Mist', icon: '🧪', desc: 'Fully heal every conscious Pokémon and the trainer.',
    apply: (g) => {
      for (const p of g.party) if (!p.fainted) p.hp = p.maxHp;
      g.trainer.hp = g.trainer.maxHp;
    },
  },
  {
    title: 'Max Revive', icon: '💎', desc: 'Revive all fainted Pokémon at 60% HP.',
    cond: (g) => g.party.some((p) => p.fainted),
    apply: (g) => {
      for (const p of g.party) if (p.fainted) g.revive(p, 0.6);
    },
  },
  {
    title: 'Rare Candy Bag', icon: '🍬', desc: '+1 level to every Pokémon in your party.',
    apply: (g) => g.party.forEach((p) => g.levelUp(p)),
  },
  {
    title: 'Poké Ball Crate', icon: '📦', desc: '+5 Poké Balls.',
    apply: (g) => (g.pokeballs += 5),
  },
  {
    title: 'X Attack', icon: '⚔️', desc: 'Your party deals +15% damage for the rest of the run.',
    apply: (g) => (g.partyAtkMul += 0.15),
  },
  {
    title: 'Trainer Vest', icon: '🦺', desc: '+30 max trainer HP and fully heal the trainer.',
    apply: (g) => {
      g.trainer.maxHp += 30;
      g.trainer.hp = g.trainer.maxHp;
    },
  },
  {
    title: 'Great Ball Upgrade', icon: '🔵', desc: '+12% catch chance on every throw for the rest of the run.',
    apply: (g) => (g.catchBonus += 0.12),
  },
];

export class Game {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private ui = new UI();
  private reticle: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouse = new THREE.Vector2();
  private aim = new THREE.Vector3();
  private camFocus = new THREE.Vector3();
  private keys = new Set<string>();

  readonly trainer = new Trainer();
  party: Mon[] = [];
  private wilds: Mon[] = [];
  private dying: Mon[] = [];
  private projectiles: Projectile[] = [];
  private balls: Ball[] = [];
  private floaters: Floater[] = [];
  private particles: Particle[] = [];

  private state: State = 'starter';
  private round = 0;
  private toSpawn = 0;
  private spawnTimer = 0;
  private bossPending = false;
  pokeballs = 5;
  partyAtkMul = 1;
  catchBonus = 0;
  private hold = false;
  private caught = 0;
  private defeated = 0;
  private throwCd = 0;
  private uiTimer = 0;
  private time = 0;

  constructor(container: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene.background = new THREE.Color(0xa8dcff);
    this.scene.fog = new THREE.Fog(0xa8dcff, 30, 65);
    this.scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4f7a3a, 1.6));
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
    s.shadow.bias = -0.0005;
    this.scene.add(s, s.target);
    this.scene.add(buildArena());
    this.scene.add(this.trainer.obj);

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.bindInput();
    this.resize();
    this.showStarter();
    this.loop();
  }

  // ───────────────────────────── setup / input ─────────────────────────────

  private bindInput() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ') e.preventDefault();
      if (e.repeat) return;
      if (k === ' ') this.throwBall();
      if (k === 'f') this.toggleHold();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.throwBall();
    });
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ───────────────────────────── flow ─────────────────────────────

  private showStarter() {
    this.state = 'starter';
    this.ui.showModal(
      'Choose your partner',
      'Survive endless rounds of wild Pokémon. Weaken them, then throw Poké Balls to build a team of six.',
      STARTERS.map((id) => {
        const sp = SPECIES_BY_ID[id];
        return {
          title: sp.name,
          tag: sp.type,
          tagColor: hex(TYPE_COLOR[sp.type]),
          body: sp.blurb,
          onClick: () => {
            const m = new Mon(sp, 6, 'party');
            m.pos.set(1.5, 0, 1.5);
            this.addToParty(m);
            this.ui.hideModal();
            this.state = 'playing';
            this.startRound(1);
          },
        };
      }),
    );
  }

  private startRound(n: number) {
    this.round = n;
    this.toSpawn = Math.min(26, 2 + n * 2);
    this.bossPending = n % 5 === 0;
    this.spawnTimer = 1.2;
    this.ui.banner(`Round ${n}`, this.bossPending ? 'An Alpha lurks nearby…' : 'Wild Pokémon incoming!');
  }

  private endRound() {
    this.state = 'reward';
    this.pokeballs += 2;
    for (const p of this.party) if (!p.fainted) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25);
    this.trainer.hp = Math.min(this.trainer.maxHp, this.trainer.hp + 15);
    for (const p of this.projectiles) p.mesh.removeFromParent();
    this.projectiles = [];

    const options = shuffle(REWARDS.filter((r) => !r.cond || r.cond(this))).slice(0, 3);
    this.ui.showModal(
      `Round ${this.round} cleared!`,
      '+2 Poké Balls and your team recovered 25% HP. Pick a reward:',
      options.map((o) => ({
        title: o.title,
        icon: o.icon,
        body: o.desc,
        onClick: () => {
          o.apply(this);
          this.ui.hideModal();
          this.state = 'playing';
          this.startRound(this.round + 1);
        },
      })),
    );
  }

  private gameOver(reason: string) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.reticle.visible = false;
    this.ui.showModal(
      'Run over',
      `${reason}<br/>You reached <b>round ${this.round}</b>, defeated <b>${this.defeated}</b> and caught <b>${this.caught}</b> Pokémon.`,
      [{ title: 'Play again', icon: '🔁', body: 'Start a new run', onClick: () => location.reload() }],
    );
  }

  private toggleHold() {
    if (this.state !== 'playing') return;
    this.hold = !this.hold;
    for (const p of this.party) p.target = null;
    this.ui.toast(this.hold ? 'Holding fire — line up a catch!' : 'Party attacking!', 'info');
  }

  // ───────────────────────────── main loop ─────────────────────────────

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.time += dt;
    if (this.state === 'playing') this.update(dt);
    this.animate(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateFloaters(dt);
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.refreshHud();
    }
  };

  private update(dt: number) {
    this.throwCd -= dt;
    this.updateTrainer(dt);
    this.updateAim();
    this.updateSpawning(dt);
    for (const m of this.party) if (!m.fainted) this.updateParty(m, dt);
    for (const m of this.wilds) if (m.alive) this.updateWild(m, dt);
    this.separate();
    this.updateProjectiles(dt);
    this.updateBalls(dt);
    if (
      this.state === 'playing' && this.toSpawn === 0 && !this.bossPending &&
      this.wilds.length === 0 && !this.balls.some((b) => b.state === 'wobble')
    ) this.endRound();
  }

  // ───────────────────────────── trainer / aim ─────────────────────────────

  private updateTrainer(dt: number) {
    const t = this.trainer;
    const k = this.keys;
    let x = 0, z = 0;
    if (k.has('w') || k.has('arrowup')) z -= 1;
    if (k.has('s') || k.has('arrowdown')) z += 1;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    const len = Math.hypot(x, z);
    t.inv -= dt;
    t.moving = len > 0;
    if (t.moving) {
      t.pos.x += (x / len) * TRAINER_SPEED * dt;
      t.pos.z += (z / len) * TRAINER_SPEED * dt;
      t.walk += dt * 12;
      this.face(t.obj, x, z, dt);
    } else {
      this.face(t.obj, this.aim.x - t.pos.x, this.aim.z - t.pos.z, dt, 8);
    }
    this.clampArena(t.pos);
  }

  private updateAim() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.aim)) return;
    const tp = this.trainer.pos;
    const d = distXZ(this.aim, tp);
    if (d > THROW_RANGE) this.aim.sub(tp).multiplyScalar(THROW_RANGE / d).add(tp);
    this.aim.y = 0;
    const over = this.wilds.some((w) => w.alive && distXZ(w.pos, this.aim) < w.radius + 0.4);
    this.reticle.visible = true;
    this.reticle.position.set(this.aim.x, 0.06, this.aim.z);
    this.reticle.material.color.setHex(over ? 0xffd23f : 0xffffff);
    this.reticle.scale.setScalar(over ? 1.4 : 1);
  }

  // ───────────────────────────── spawning ─────────────────────────────

  private updateSpawning(dt: number) {
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      const cap = 5 + Math.floor(this.round / 2);
      if (this.spawnTimer <= 0 && this.wilds.length < cap) {
        this.spawnWild(false);
        this.toSpawn--;
        this.spawnTimer = Math.max(0.7, 2 - this.round * 0.08);
      }
    } else if (this.bossPending && this.wilds.length <= 1) {
      this.bossPending = false;
      const b = this.spawnWild(true);
      this.ui.toast(`An ALPHA ${b.sp.name} appeared!`, 'warn');
    }
  }

  private spawnWild(boss: boolean) {
    const pool = SPECIES.filter((s) => s.minRound <= this.round);
    const sp = pick(pool);
    const level = Math.max(2, Math.round(this.round * 1.4) + Math.floor(Math.random() * 2)) + (boss ? 3 : 0);
    const m = new Mon(sp, level, 'wild', boss);
    const tp = this.trainer.pos;
    let x = 0, z = 0;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(6, ARENA_R - 1);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (Math.hypot(x - tp.x, z - tp.z) > 11) break;
    }
    m.pos.set(x, 0, z);
    m.yaw.rotation.y = Math.atan2(tp.x - x, tp.z - z);
    this.scene.add(m.obj);
    this.wilds.push(m);
    this.burst(m.pos, 0xffffff, 8);
    return m;
  }

  // ───────────────────────────── AI ─────────────────────────────

  private updateParty(m: Mon, dt: number) {
    m.cd -= dt;
    m.moving = false;
    const tp = this.trainer.pos;
    if (this.hold) m.target = null;
    else {
      if (m.target && (!this.valid(m.target) || distXZ(m.target.pos, tp) > 15)) m.target = null;
      m.retarget -= dt;
      if (!m.target || m.retarget <= 0) {
        m.retarget = 0.5;
        m.target = this.nearest(m.pos, this.wilds.filter((w) => w.alive && distXZ(w.pos, tp) < 12));
      }
    }
    if (m.target) this.engage(m, m.target, dt, m.sp.speed);
    else {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.03 * dt); // catch breath out of combat
      const a = (this.party.indexOf(m) / PARTY_MAX) * Math.PI * 2 + 0.6;
      this.moveTo(m, tp.x + Math.cos(a) * 2.3, tp.z + Math.sin(a) * 2.3, m.sp.speed * 1.3, dt, 0.2);
    }
  }

  private updateWild(m: Mon, dt: number) {
    if (m.grow < 1) return;
    m.cd -= dt;
    m.moving = false;
    m.retarget -= dt;
    if (!m.target || !this.valid(m.target) || m.retarget <= 0) {
      m.retarget = 1 + Math.random();
      m.target = this.nearest<Unit>(m.pos, [...this.party.filter((p) => p.alive), this.trainer]);
    }
    if (m.target) this.engage(m, m.target, dt, m.sp.speed * (m.boss ? 0.75 : 0.8));
  }

  private engage(m: Mon, t: Unit, dt: number, speed: number) {
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const reach = m.sp.range + m.radius + t.radius;
    if (d > reach * 0.9) this.moveTo(m, t.pos.x, t.pos.z, speed, dt, reach * 0.85);
    else this.face(m.yaw, dx, dz, dt);
    if (d <= reach && m.cd <= 0) this.attack(m, t);
  }

  private moveTo(m: Mon, x: number, z: number, speed: number, dt: number, stop: number) {
    const dx = x - m.pos.x, dz = z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return;
    const step = Math.min(speed * dt, d - stop);
    m.pos.x += (dx / d) * step;
    m.pos.z += (dz / d) * step;
    m.moving = true;
    this.face(m.yaw, dx, dz, dt);
    this.clampArena(m.pos);
  }

  private valid(u: Unit) {
    if (u instanceof Trainer) return u.hp > 0;
    return u.alive && (u.side === 'wild' ? this.wilds.includes(u) : this.party.includes(u));
  }

  private nearest<T extends Unit>(p: THREE.Vector3, list: T[]): T | null {
    let best: T | null = null, bd = Infinity;
    for (const u of list) {
      const d = distXZ(p, u.pos);
      if (d < bd) (bd = d), (best = u);
    }
    return best;
  }

  private separate() {
    const units: { p: THREE.Vector3; r: number; w: number }[] = [{ p: this.trainer.pos, r: this.trainer.radius, w: 0.2 }];
    for (const m of this.party) if (m.alive) units.push({ p: m.pos, r: m.radius, w: 1 });
    for (const m of this.wilds) if (m.alive) units.push({ p: m.pos, r: m.radius, w: m.boss ? 0.3 : 1 });
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z;
        const d = Math.hypot(dx, dz), min = a.r + b.r;
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / d, tw = a.w + b.w;
        a.p.x -= dx * push * (a.w / tw);
        a.p.z -= dz * push * (a.w / tw);
        b.p.x += dx * push * (b.w / tw);
        b.p.z += dz * push * (b.w / tw);
      }
    }
  }

  // ───────────────────────────── combat ─────────────────────────────

  private atkOf(m: Mon) {
    const side = m.side === 'party' ? this.partyAtkMul : Math.min(1.2, 0.5 + 0.05 * this.round);
    return m.sp.atk * (1 + 0.08 * (m.level - 1)) * side * (m.boss ? 1.3 : 1);
  }

  private attack(m: Mon, t: Unit) {
    m.cd = m.sp.cooldown * (m.side === 'wild' ? 1.35 : 1) * rand(0.9, 1.1);
    const mult = t instanceof Mon ? typeMult(m.sp.type, t.sp.type) : 1;
    let dmg = this.atkOf(m) * rand(0.85, 1) * mult;
    if (t instanceof Trainer) dmg *= 0.7;
    else if (t.side === 'party') dmg *= 0.8;
    dmg = mult === 0 ? 0 : Math.max(1, Math.round(dmg));
    if (m.sp.range > 2.5) {
      const mesh = new THREE.Mesh(GEO.sphere, glowMat(TYPE_COLOR[m.sp.type]));
      mesh.scale.setScalar(m.boss ? 0.3 : 0.18);
      mesh.position.set(m.pos.x, m.height * 0.6, m.pos.z);
      this.scene.add(mesh);
      this.projectiles.push({ mesh, target: t, dmg, mult });
    } else {
      m.lunge = 0.25;
      this.hit(t, dmg, mult);
    }
  }

  private updateProjectiles(dt: number) {
    this.projectiles = this.projectiles.filter((p) => {
      if (!this.valid(p.target)) return void p.mesh.removeFromParent(), false;
      const to = p.target.pos.clone().setY(p.target.height * 0.5);
      const d = p.mesh.position.distanceTo(to);
      const step = 14 * dt;
      if (d <= step + 0.3) {
        this.hit(p.target, p.dmg, p.mult);
        p.mesh.removeFromParent();
        return false;
      }
      p.mesh.position.add(to.sub(p.mesh.position).multiplyScalar(step / d));
      return true;
    });
  }

  private hit(t: Unit, dmg: number, mult: number) {
    if (t instanceof Trainer) {
      if (t.inv > 0 || this.state !== 'playing') return;
      t.hp -= dmg;
      t.inv = 0.35;
      this.ui.hurt();
      this.floater(t.pos, 2.1, `-${dmg}`, '#ff5a5a');
      if (t.hp <= 0) {
        t.hp = 0;
        this.gameOver('You were overwhelmed by wild Pokémon!');
      }
      return;
    }
    if (!t.alive) return;
    if (mult === 0) return this.floater(t.pos, t.height + 0.2, 'No effect', '#aaaaaa');
    t.hp -= dmg;
    t.flash = 0.12;
    const color = mult > 1 ? '#ffd23f' : mult < 1 ? '#b8b8b8' : t.side === 'party' ? '#ff8080' : '#ffffff';
    this.floater(t.pos, t.height + 0.2, mult > 1 ? `${dmg}!` : `${dmg}`, color, mult > 1);
    if (t.hp <= 0) {
      t.hp = 0;
      this.faint(t);
    }
  }

  private faint(m: Mon) {
    if (m.side === 'wild') {
      this.wilds.splice(this.wilds.indexOf(m), 1);
      m.dying = 0.6;
      this.dying.push(m);
      this.defeated++;
      this.burst(m.pos, TYPE_COLOR[m.sp.type], 10);
      this.grantXp(m);
      return;
    }
    m.fainted = true;
    m.target = null;
    this.ui.toast(`${m.sp.name} fainted and returned to its ball!`, 'bad');
    if (this.party.every((p) => p.fainted)) this.gameOver('Your whole party fainted!');
  }

  private grantXp(w: Mon) {
    const amount = w.level * 3 * (w.boss ? 4 : 1);
    for (const p of this.party) {
      if (p.fainted) continue;
      p.xp += amount;
      while (p.xp >= xpNeed(p.level)) {
        p.xp -= xpNeed(p.level);
        this.levelUp(p);
      }
    }
  }

  levelUp(p: Mon) {
    p.level++;
    const old = p.maxHp;
    p.recalc();
    if (!p.fainted) p.hp += p.maxHp - old;
    p.refreshLabel();
    if (!p.fainted) this.floater(p.pos, p.height + 0.5, 'LEVEL UP!', '#7dffa0', true);
  }

  revive(p: Mon, frac: number) {
    p.fainted = false;
    p.hp = Math.round(p.maxHp * frac);
    p.pos.copy(this.trainer.pos).add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(1, 2)));
    p.grow = 0;
  }

  private addToParty(m: Mon) {
    this.party.push(m);
    this.scene.add(m.obj);
    m.grow = 0;
    this.burst(m.pos, 0xffffff, 10);
  }

  // ───────────────────────────── catching ─────────────────────────────

  private throwBall() {
    if (this.state !== 'playing' || this.throwCd > 0) return;
    if (this.pokeballs <= 0) return this.ui.toast('Out of Poké Balls!', 'bad');
    this.pokeballs--;
    this.throwCd = 0.35;
    const from = this.trainer.pos.clone().setY(1.5);
    const to = this.aim.clone();
    const dist = distXZ(from, to);
    const obj = buildPokeball();
    obj.position.copy(from);
    this.scene.add(obj);
    this.balls.push({ obj, from, to, t: 0, dur: 0.3 + dist / 22, arc: 1.2 + dist * 0.12, state: 'fly', mon: null, success: false, resolveAt: 0 });
    for (const a of this.trainer.arms) a.rotation.x = -2.2;
  }

  private updateBalls(dt: number) {
    for (const b of [...this.balls]) {
      b.t += dt;
      if (b.state === 'fly') {
        const f = Math.min(1, b.t / b.dur);
        b.obj.position.lerpVectors(b.from, b.to, f);
        b.obj.position.y = b.from.y * (1 - f) + 0.2 * f + Math.sin(Math.PI * f) * b.arc;
        b.obj.rotation.x += dt * 18;
        const target = this.wilds.find(
          (w) => w.alive && w.grow >= 1 && distXZ(w.pos, b.obj.position) < w.radius + 0.35 && b.obj.position.y < w.height + 0.4,
        );
        if (target) this.startCapture(b, target);
        else if (f >= 1) (b.state = 'miss'), (b.t = 0);
      } else if (b.state === 'miss') {
        if (b.t < 0.5) b.obj.rotation.x += dt * 8 * (1 - b.t / 0.5);
        if (b.t > 0.8) b.obj.scale.setScalar(Math.max(0.001, 1 - (b.t - 0.8) / 0.4));
        if (b.t > 1.2) this.removeBall(b);
      } else {
        // Three wobbles at 0.4 / 1.0 / 1.6s, then click. Failed catches break out early.
        const phase = [0.4, 1.0, 1.6].find((s) => b.t >= s && b.t < s + 0.35);
        b.obj.rotation.z = phase !== undefined ? Math.sin(((b.t - phase) / 0.35) * Math.PI * 2) * 0.45 : 0;
        if (b.t >= b.resolveAt) this.resolveCapture(b);
      }
    }
  }

  private startCapture(b: Ball, w: Mon) {
    w.capturing = true;
    w.target = null;
    b.state = 'wobble';
    b.t = 0;
    b.mon = w;
    b.obj.position.set(w.pos.x, 0.2, w.pos.z);
    b.obj.rotation.set(0, Math.atan2(this.trainer.pos.x - w.pos.x, this.trainer.pos.z - w.pos.z), 0);
    const frac = w.hp / w.maxHp;
    const chance = clamp((1 - 0.88 * frac) * w.sp.catchRate * (w.boss ? 0.4 : 1) + this.catchBonus, 0.04, 0.97);
    b.success = Math.random() < chance;
    b.resolveAt = b.success ? 2.2 : pick([0.8, 1.4, 2.0]);
    this.floater(w.pos, 1.4, `${Math.round(chance * 100)}% catch`, '#7fd3ff');
    this.burst(b.obj.position, 0xffffff, 12);
  }

  private resolveCapture(b: Ball) {
    const w = b.mon!;
    this.removeBall(b);
    if (!b.success) {
      w.capturing = false;
      this.burst(b.obj.position, 0xff6060, 10);
      this.ui.toast(`Oh no! ${w.sp.name} broke free!`, 'warn');
      return;
    }
    this.wilds.splice(this.wilds.indexOf(w), 1);
    w.dispose();
    this.caught++;
    this.burst(b.obj.position, 0xffe066, 22);
    this.ui.toast(`Gotcha! ${w.sp.name} was caught!`, 'good');
    const nm = new Mon(w.sp, w.level, 'party');
    nm.hp = Math.round(nm.maxHp * Math.max(0.5, w.hp / w.maxHp));
    nm.pos.copy(b.obj.position).setY(0);
    if (this.party.length < PARTY_MAX) this.addToParty(nm);
    else this.showSwap(nm);
  }

  private removeBall(b: Ball) {
    b.obj.removeFromParent();
    this.balls.splice(this.balls.indexOf(b), 1);
  }

  private showSwap(nm: Mon) {
    this.state = 'swap';
    const resume = () => {
      this.ui.hideModal();
      this.state = 'playing';
    };
    this.ui.showModal(
      'Your party is full!',
      `Release a Pokémon to make room for <b>${nm.sp.name} Lv${nm.level}</b>, or let ${nm.sp.name} go.`,
      [
        ...this.party.map((p, i) => ({
          title: `Release ${p.sp.name}`,
          tag: p.sp.type,
          tagColor: hex(TYPE_COLOR[p.sp.type]),
          body: `Lv${p.level} · ${p.fainted ? 'Fainted' : `${Math.ceil(p.hp)}/${p.maxHp} HP`}`,
          onClick: () => {
            p.dispose();
            this.party[i] = nm;
            this.scene.add(nm.obj);
            nm.grow = 0;
            resume();
          },
        })),
        { title: `Let ${nm.sp.name} go`, body: 'Keep your current team.', ghost: true, onClick: () => (nm.dispose(), resume()) },
      ],
    );
  }

  // ───────────────────────────── visuals ─────────────────────────────

  private animate(dt: number) {
    weakRingMat.opacity = 0.45 + 0.35 * Math.sin(this.time * 8);
    for (const m of this.party) this.animateMon(m, dt);
    for (const m of this.wilds) this.animateMon(m, dt);
    this.dying = this.dying.filter((m) => {
      m.dying -= dt;
      this.animateMon(m, dt);
      if (m.dying > 0) return true;
      m.dispose();
      return false;
    });

    const t = this.trainer;
    const swing = t.moving ? Math.sin(t.walk) * 0.7 : 0;
    t.legs[0].rotation.x = swing;
    t.legs[1].rotation.x = -swing;
    for (const [i, a] of t.arms.entries()) {
      const rest = (i ? swing : -swing) * 0.8;
      a.rotation.x += (rest - a.rotation.x) * Math.min(1, dt * 8);
    }
    t.obj.position.y = t.moving ? Math.abs(Math.sin(t.walk)) * 0.06 : 0;
    t.obj.visible = !(t.inv > 0 && Math.floor(this.time * 20) % 2);

    this.particles = this.particles.filter((p) => {
      p.t += dt;
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * Math.max(0.001, 1 - p.t / p.life));
      if (p.t < p.life) return true;
      p.mesh.removeFromParent();
      return false;
    });
  }

  private animateMon(m: Mon, dt: number) {
    m.anim += dt;
    m.grow = Math.min(1, m.grow + dt * 3);
    const hidden = m.capturing || m.fainted;
    m.capScale += ((hidden ? 0 : 1) - m.capScale) * Math.min(1, dt * 12);
    let s = m.scale * easeOutBack(m.grow) * m.capScale;
    if (m.dying >= 0) s *= Math.max(0, m.dying / 0.6);
    m.yaw.scale.setScalar(Math.max(0.0001, s));
    m.yaw.visible = s > 0.01;

    const root = m.model.root;
    root.position.y = m.sp.look.float ? 0.12 * Math.sin(m.anim * 3) : m.moving ? Math.abs(Math.sin(m.anim * 14)) * 0.12 : 0;
    if (m.lunge > 0) m.lunge -= dt;
    root.position.z = m.lunge > 0 ? Math.sin((1 - m.lunge / 0.25) * Math.PI) * 0.45 : 0;

    m.flash -= dt;
    const on = m.flash > 0;
    if (on !== m.flashOn) {
      m.flashOn = on;
      for (const mat of m.model.mats) mat.emissive.setHex(on ? 0xffffff : mat.userData.baseEmissive);
    }
    if (m.model.flame) m.model.flame.scale.set(1, 0.85 + 0.25 * Math.sin(m.anim * 22) + 0.1 * Math.random(), 1);
    for (const w of m.model.wings) w.rotation.z = Math.sin(m.anim * 16) * 0.6 * w.userData.side;

    const h = m.model.height * s;
    m.bar.obj.position.y = h + 0.3;
    m.label.sprite.position.y = h + 0.62;
    m.bar.obj.quaternion.copy(this.camera.quaternion);
    m.bar.set(m.hp / m.maxHp);
    const showUi = s > 0.3 && m.dying < 0;
    m.bar.obj.visible = m.label.sprite.visible = showUi;
    m.ring.visible = m.side === 'wild' && m.alive && m.hp / m.maxHp < 0.35;
  }

  private face(o: THREE.Object3D, dx: number, dz: number, dt: number, rate = 12) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    let d = Math.atan2(dx, dz) - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * Math.min(1, rate * dt);
  }

  private clampArena(p: THREE.Vector3) {
    const r = Math.hypot(p.x, p.z), max = ARENA_R - 0.6;
    if (r > max) (p.x *= max / r), (p.z *= max / r);
  }

  private burst(pos: THREE.Vector3, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(GEO.sphere, glowMat(color));
      const size = rand(0.05, 0.11);
      mesh.position.set(pos.x, Math.max(pos.y, 0.4), pos.z);
      mesh.scale.setScalar(size);
      this.scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), t: 0, life: rand(0.4, 0.7), size });
    }
  }

  private floater(pos: THREE.Vector3, y: number, text: string, color: string, big = false) {
    this.floaters.push({ el: this.ui.floater(text, color, big), pos: new THREE.Vector3(pos.x + rand(-0.3, 0.3), y, pos.z), t: 0 });
  }

  private updateFloaters(dt: number) {
    const v = new THREE.Vector3();
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      f.pos.y += dt * 1.3;
      v.copy(f.pos).project(this.camera);
      const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(1 - (f.t / FLOATER_LIFE) ** 2);
      if (f.t < FLOATER_LIFE) return true;
      f.el.remove();
      return false;
    });
  }

  private updateCamera(dt: number) {
    this.camFocus.lerp(this.trainer.pos, 1 - Math.exp(-6 * dt));
    this.camera.position.copy(this.camFocus).add(CAM_OFFSET);
    this.camera.lookAt(this.camFocus.x, this.camFocus.y + 0.5, this.camFocus.z);
    this.sun.position.copy(this.camFocus).add(SUN_OFFSET);
    this.sun.target.position.copy(this.camFocus);
  }

  private refreshHud() {
    this.ui.setHud({
      round: this.round,
      remaining: this.wilds.length + this.toSpawn + (this.bossPending ? 1 : 0),
      balls: this.pokeballs,
      hp: this.trainer.hp,
      maxHp: this.trainer.maxHp,
      hold: this.hold,
    });
    this.ui.setParty(
      this.party.map((p) => ({
        name: p.sp.name,
        level: p.level,
        type: p.sp.type,
        color: hex(TYPE_COLOR[p.sp.type as PType]),
        hp: p.hp,
        maxHp: p.maxHp,
        xpFrac: p.xp / xpNeed(p.level),
        fainted: p.fainted,
      })),
    );
  }
}
