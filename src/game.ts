import * as THREE from 'three';
import { type Species, FX_EXTRA, ITEMS, MOVES, MUSIC, SHINY_ODDS, SPECIES, SPECIES_BY_ID, STARTERS, STONE_NAME, TYPE_COLOR, hex, typeMult, type Evo, type Move } from './data';
import { ARENA_R } from './models';
import { BIOMES, biomeFor, buildArena, disposeArena, type Biome } from './biomes';
import { UNLOCKS, finishRun, register, save } from './progress';
import { Mon, Trainer, weakRingMat, type Unit } from './entities';
import { Effects } from './fx';
import { audio } from './audio';
import { icon, preload, url } from './assets';
import { UI, type Arrow, type CardSpec } from './ui';

type State = 'loading' | 'starter' | 'playing' | 'paused' | 'reward' | 'swap' | 'gameover';

interface Projectile {
  sprite: THREE.Sprite;
  start: THREE.Vector3;
  target: Unit;
  t: number;
  dur: number;
  arc: number;
  spin: number;
  dmg: number;
  mult: number;
  real: boolean; // the last sprite of a volley carries the damage; the rest are visual
}

interface Ball {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  homing: Mon | null;
  t: number;
  dur: number;
  arc: number;
  state: 'fly' | 'wobble' | 'miss' | 'done';
  mon: Mon | null;
  success: boolean;
  resolveAt: number;
  wobbles: number;
}

interface Floater { el: HTMLElement; pos: THREE.Vector3; t: number; total?: number }

interface Reward {
  title: string;
  item: string;
  desc: string;
  cond?: (g: Game) => boolean;
  apply: (g: Game) => void;
}

const PARTY_MAX = 6;
const THROW_RANGE = 14;
const TRAINER_SPEED = 7;
const CAM_OFFSET = new THREE.Vector3(0, 12, 12);
// Look a bit south of the trainer so the party panel doesn't hide what's coming from below.
const CAM_LEAD = new THREE.Vector3(0, 0.5, 1.5);
const SUN_OFFSET = new THREE.Vector3(12, 22, 8);
const FLOATER_LIFE = 0.8;
const WEAK = 0.35;
const DASH_TIME = 0.18;
const DASH_SPEED = 24;
const DASH_CD = 1.4;
const SLAM_R = 3.4;
const SLAM_WIND = 1.2;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distXZ = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const easeOutBack = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const shuffle = <T>(arr: T[]) => arr.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const xpNeed = (level: number) => Math.round(level * level * 0.6);
const EVOLVE_TIME = 2.6;
const mid = (u: Unit) => u.pos.clone().setY(u.height * 0.5);
function weightedPick<T>(items: T[], weight: (t: T) => number) {
  let r = Math.random() * items.reduce((a, t) => a + weight(t), 0);
  for (const t of items) if ((r -= weight(t)) <= 0) return t;
  return items[items.length - 1];
}

const REWARDS: Reward[] = [
  {
    title: 'Hyper Potion', item: 'hyper-potion', desc: 'Fully heal every conscious Pokémon and the trainer.',
    apply: (g) => {
      for (const p of g.party) if (!p.fainted) p.hp = p.maxHp;
      g.trainer.hp = g.trainer.maxHp;
    },
  },
  {
    title: 'Max Revive', item: 'max-revive', desc: 'Revive all fainted Pokémon at 60% HP.',
    cond: (g) => g.party.some((p) => p.fainted),
    apply: (g) => {
      for (const p of g.party) if (p.fainted) g.revive(p, 0.6);
    },
  },
  {
    title: 'Rare Candy', item: 'rare-candy', desc: '+1 level to every Pokémon in your party.',
    apply: (g) => g.party.forEach((p) => g.levelUp(p)),
  },
  {
    title: 'Poké Ball ×5', item: 'poke-ball', desc: 'Five more Poké Balls.',
    apply: (g) => (g.pokeballs += 5),
  },
  {
    title: 'X Attack', item: 'x-attack', desc: 'Your party deals +15% damage for the rest of the run.',
    apply: (g) => (g.partyAtkMul += 0.15),
  },
  {
    title: 'Focus Band', item: 'focus-band', desc: '+30 max trainer HP and fully heal the trainer.',
    apply: (g) => {
      g.trainer.maxHp += 30;
      g.trainer.hp = g.trainer.maxHp;
    },
  },
  {
    title: 'Great Ball Upgrade', item: 'great-ball', desc: '+12% catch chance on every throw for the rest of the run.',
    apply: (g) => (g.catchBonus += 0.12),
  },
];

export class Game {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private ui = new UI();
  private fx = new Effects(this.scene);
  private reticle: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private mouse = new THREE.Vector2();
  private aim = new THREE.Vector3();
  private aimMon: Mon | null = null;
  private camFocus = new THREE.Vector3();
  private keys = new Set<string>();

  readonly trainer = new Trainer();
  party: Mon[] = [];
  private wilds: Mon[] = [];
  private dying: Mon[] = [];
  private projectiles: Projectile[] = [];
  private balls: Ball[] = [];
  private floaters: Floater[] = [];
  private dmgFloaters = new Map<Mon, Floater>();

  private state: State = 'loading';
  private round = 0;
  private toSpawn = 0;
  private spawnTimer = 0;
  private bossPending = false;
  private criedThisRound = new Set<string>();
  pokeballs = 5;
  partyAtkMul = 1;
  catchBonus = 0;
  private hold = false;
  private caught = 0;
  private defeated = 0;
  private throwCd = 0;
  private uiTimer = 0;
  private time = 0;
  private seenHints: Set<string>;
  private hemi = new THREE.HemisphereLight(0xdff2ff, 0x4f7a3a, 1.6);
  private arena: THREE.Object3D | null = null;
  private biome: Biome = BIOMES[0];
  private focus: Mon | null = null;
  private focusRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private slams = new Map<Mon, THREE.Group>();
  private dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector2();
  private dodge = 0;
  private shake = 0;
  private hitStop = 0;
  private hitStopCd = 0;
  private unlockedAtStart = new Set<string>();

  constructor(container: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    this.scene.background = new THREE.Color(0xa8dcff);
    this.scene.fog = new THREE.Fog(0xa8dcff, 30, 60);
    this.scene.add(this.hemi);
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
    s.shadow.bias = -0.0005;
    this.scene.add(s, s.target);
    this.setBiome(BIOMES[0]);
    this.scene.add(this.trainer.obj);

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.95, 4, 1),
      new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);

    try {
      this.seenHints = new Set(JSON.parse(localStorage.getItem('pr-hints') ?? '[]'));
    } catch {
      this.seenHints = new Set();
    }

    this.bindInput();
    this.resize();
    this.loop();
    void this.load();
  }

  // ───────────────────────────── setup / input ─────────────────────────────

  private async load() {
    const srcs = [
      ...SPECIES.flatMap((s) => [url.front(s.dex), url.back(s.dex), url.front(s.dex, true), url.back(s.dex, true)]),
      ...[...new Set([...Object.values(MOVES).map((m) => m.fx), ...FX_EXTRA])].map(url.fx),
      ...ITEMS.map(url.item),
    ];
    this.ui.showModal('Loading…', '', []);
    const missing = await preload(srcs, (done, total) => {
      const p = document.querySelector('#modal p');
      if (p) p.textContent = `${done} / ${total} sprites`;
    });
    if (!missing) return this.showStarter();
    this.ui.showModal(
      'Some assets are missing',
      `${missing} sprites failed to load. Run <code>npm run assets</code> and reload. You can still play with placeholders.`,
      [{ title: 'Continue anyway', onClick: () => this.showStarter() }],
    );
  }

  private bindInput() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      audio.unlock();
      if (k === ' ') e.preventDefault();
      if (e.repeat) return;
      if (k === ' ') this.throwBall();
      if (k === 'f') this.toggleHold();
      if (k === 'm') audio.toggleMute();
      if (k === 'shift') this.dash();
      if (k === 'e') this.setFocus(this.aimMon);
      if (k === 'escape' || k === 'p') this.togglePause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.state === 'playing') this.togglePause();
    });
    window.addEventListener('pointerdown', () => audio.unlock());
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.throwBall();
      if (e.button === 2) this.setFocus(this.aimMon);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private hint(key: string, text: string) {
    if (this.seenHints.has(key)) return;
    this.seenHints.add(key);
    try {
      localStorage.setItem('pr-hints', JSON.stringify([...this.seenHints]));
    } catch {}
    this.ui.hint(text);
  }

  // ───────────────────────────── flow ─────────────────────────────

  private showStarter() {
    this.state = 'starter';
    this.unlockedAtStart = new Set(UNLOCKS.filter((u) => u.ok()).map((u) => u.id));
    const meta = save.runs
      ? `<br/><span class="meta">Best: round ${save.best} · Pokédex ${save.caught.length}/${SPECIES.length} · ✦ ${save.shinies.length} shiny</span>`
      : '';
    const choices = [...STARTERS.map((id) => ({ id, need: '' })), ...UNLOCKS.map((u) => ({ id: u.id, need: u.ok() ? '' : u.need }))];
    this.ui.showModal(
      'Choose your partner',
      `Survive endless rounds of wild Pokémon. Weaken them, then throw Poké Balls to build a team of six.${meta}`,
      choices.map(({ id, need }) => {
        const sp = SPECIES_BY_ID[id];
        if (need) return { title: '???', icon: icon(url.front(sp.dex)), body: `🔒 ${need} to unlock.`, locked: true, onClick: () => {} };
        return {
          title: sp.name,
          icon: icon(url.front(sp.dex)),
          tag: `${sp.type} · ${sp.move.name}`,
          tagColor: hex(TYPE_COLOR[sp.type]),
          body: sp.blurb,
          onClick: () => {
            audio.unlock();
            const m = new Mon(sp, 6, 'party');
            m.pos.set(1.5, 0, 1.5);
            this.addToParty(m);
            register(sp.id);
            this.ui.hideModal();
            this.state = 'playing';
            this.startRound(1);
          },
        };
      }),
    );
  }

  private setBiome(b: Biome) {
    if (this.arena) disposeArena(this.arena);
    this.arena = buildArena(b);
    this.scene.add(this.arena);
    (this.scene.background as THREE.Color).setHex(b.sky);
    this.scene.fog!.color.setHex(b.sky);
    this.hemi.intensity = b.light;
    this.biome = b;
  }

  private startRound(n: number) {
    this.round = n;
    this.toSpawn = Math.min(26, 2 + n * 2);
    this.bossPending = n % 5 === 0;
    this.spawnTimer = 1.5;
    this.criedThisRound.clear();
    const b = biomeFor(n);
    const newArea = b !== this.biome || n === 1;
    if (b !== this.biome) this.setBiome(b);
    this.ui.banner(newArea ? b.name : `Round ${n}`, newArea ? `Round ${n} · a new area` : this.bossPending ? 'An Alpha lurks nearby…' : 'Wild Pokémon incoming!');
    audio.roundStart();
    audio.playMusic(this.bossPending ? MUSIC.boss : b.music);
    if (n === 1) this.hint('move', 'Move with WASD — your Pokémon follow you and battle on their own.');
  }

  private endRound() {
    this.state = 'reward';
    this.pokeballs += 2;
    for (const p of this.party) if (!p.fainted) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25);
    this.trainer.hp = Math.min(this.trainer.maxHp, this.trainer.hp + 15);
    for (const p of this.projectiles) this.dropSprite(p.sprite);
    this.projectiles = [];
    this.reticle.visible = false;

    const next = () => {
      audio.ui();
      this.ui.hideModal();
      this.state = 'playing';
      this.startRound(this.round + 1);
    };
    const cards: CardSpec[] = shuffle(REWARDS.filter((r) => !r.cond || r.cond(this)))
      .slice(0, 3)
      .map((o) => ({ title: o.title, icon: icon(url.item(o.item)), body: o.desc, onClick: () => (o.apply(this), next()) }));
    // Stones only show up when someone can use one; Alpha rounds always offer one.
    const offers = this.stoneOffers();
    const show = () => this.ui.showModal(`Round ${this.round} cleared!`, '+2 Poké Balls and your team recovered 25% HP. Pick a reward:', cards);
    if (offers.length && (this.round % 5 === 0 || Math.random() < 0.5)) cards[0] = this.stoneCard(pick(offers), next, show);
    show();
  }

  private stoneOffers() {
    return this.party
      .filter((p) => !p.fainted && !p.evolveTo)
      .map((mon) => ({ mon, evos: (mon.sp.evos ?? []).filter((e) => e.stone) }))
      .filter((o) => o.evos.length);
  }

  private stoneCard({ mon, evos }: { mon: Mon; evos: Evo[] }, next: () => void, back: () => void): CardSpec {
    const evolveInto = (e: Evo) => () => {
      next();
      this.evolve(mon, SPECIES_BY_ID[e.to]);
    };
    if (evos.length === 1) {
      const to = SPECIES_BY_ID[evos[0].to];
      return {
        title: STONE_NAME[evos[0].stone!],
        icon: icon(url.item(evos[0].stone!)),
        tag: 'Evolution',
        tagColor: '#9b59ff',
        body: `Evolve ${mon.sp.name} into ${to.name} now.`,
        onClick: evolveInto(evos[0]),
      };
    }
    // Branching evolution (Eevee): let the player pick the form.
    return {
      title: 'Evolution Stones',
      icon: icon(url.item(evos[0].stone!)),
      tag: 'Evolution',
      tagColor: '#9b59ff',
      body: `Choose what ${mon.sp.name} evolves into.`,
      onClick: () =>
        this.ui.showModal(
          `Evolve ${mon.sp.name}`,
          'Pick a stone. This is permanent!',
          [
            ...evos.map((e) => {
              const to = SPECIES_BY_ID[e.to];
              return {
                title: to.name,
                icon: icon(url.front(to.dex)),
                tag: `${STONE_NAME[e.stone!]} · ${to.type}`,
                tagColor: hex(TYPE_COLOR[to.type]),
                body: `${to.move.name}`,
                onClick: evolveInto(e),
              };
            }),
            { title: 'Back', body: 'See the other rewards', ghost: true, onClick: back },
          ],
        ),
    };
  }

  private gameOver(reason: string) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.reticle.visible = false;
    audio.stopMusic();
    audio.faint();
    const best = finishRun(this.round);
    const unlocked = UNLOCKS.filter((u) => u.ok() && !this.unlockedAtStart.has(u.id)).map((u) => SPECIES_BY_ID[u.id].name);
    this.ui.showModal(
      'Run over',
      `${reason}<br/>You reached <b>round ${this.round}</b>, defeated <b>${this.defeated}</b> and caught <b>${this.caught}</b> Pokémon.` +
        `<br/><span class="meta">${best ? '<span class="best">New best!</span>' : `Best: round ${save.best}`} · Pokédex ${save.caught.length}/${SPECIES.length}</span>` +
        (unlocked.length ? `<br/><span class="meta best">New starter unlocked: ${unlocked.join(', ')}!</span>` : ''),
      [{ title: 'Play again', icon: icon(url.item('poke-ball')), body: 'Start a new run', onClick: () => location.reload() }],
    );
  }

  private togglePause() {
    if (this.state === 'paused') {
      this.ui.hideModal();
      this.state = 'playing';
      return;
    }
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.keys.clear();
    this.ui.showModal('Paused', 'Esc or P to resume · M toggles sound', [
      { title: 'Resume', icon: icon(url.item('poke-ball')), onClick: () => this.togglePause() },
      { title: 'Restart run', ghost: true, onClick: () => location.reload() },
    ]);
  }

  private toggleHold() {
    if (this.state !== 'playing') return;
    this.hold = !this.hold;
    for (const p of this.party) p.target = null;
    audio.ui();
  }

  // ───────────────────────────── main loop ─────────────────────────────

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const active = this.state !== 'paused';
    // Hit-stop: a few frames of near-freeze on big hits sells the impact.
    let gdt = dt;
    if (this.hitStop > 0) (this.hitStop -= dt), (gdt = dt * 0.08);
    this.hitStopCd -= dt;
    if (active) this.time += gdt;
    if (this.state === 'playing') this.update(gdt);
    if (active) {
      this.animate(gdt);
      this.fx.update(gdt);
    }
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateFloaters(active ? dt : 0);
    this.ui.setArrows(this.state === 'playing' ? this.arrows() : []);
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
      this.wilds.length === 0 && !this.balls.some((b) => b.state === 'wobble') &&
      !this.party.some((p) => p.evolveTo) // let a last-kill evolution play out before the reward screen
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
    this.dodge -= dt;
    this.dashCd -= dt;
    t.moving = len > 0;
    if (this.dashT > 0) {
      this.dashT -= dt;
      t.pos.x += this.dashDir.x * DASH_SPEED * dt;
      t.pos.z += this.dashDir.y * DASH_SPEED * dt;
      if (Math.random() < 0.6) this.fx.spawn('wisp', t.pos.clone().setY(0.4), { size: 0.9, life: 0.35, grow: 0.6, color: 0xdddddd });
    } else if (t.moving) {
      t.pos.x += (x / len) * TRAINER_SPEED * dt;
      t.pos.z += (z / len) * TRAINER_SPEED * dt;
      t.walk += dt * 12;
      this.turn(t.obj, x, z, dt);
    } else {
      this.turn(t.obj, this.aim.x - t.pos.x, this.aim.z - t.pos.z, dt, 8);
    }
    this.clampArena(t.pos);
  }

  private dash() {
    if (this.state !== 'playing' || this.dashCd > 0) return;
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const z = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (x || z) this.dashDir.set(x, z);
    else this.dashDir.set(this.aim.x - this.trainer.pos.x, this.aim.z - this.trainer.pos.z);
    if (this.dashDir.lengthSq() < 1e-6) this.dashDir.set(0, 1);
    this.dashDir.normalize();
    this.dashT = DASH_TIME;
    this.dashCd = DASH_CD;
    this.dodge = DASH_TIME + 0.12; // i-frames
    audio.dash();
  }

  private setFocus(m: Mon | null) {
    if (this.state !== 'playing') return;
    this.focus = m && m !== this.focus ? m : null;
    if (this.focus) for (const p of this.party) p.target = this.focus;
    audio.ui();
  }

  private updateAim() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const targets = this.wilds.filter((w) => w.alive);
    // Prefer the sprite under the cursor: clicking a Pokémon's body should target it.
    const hit = this.raycaster.intersectObjects(targets.map((w) => w.sprite), false)[0];
    this.aimMon = hit ? targets.find((w) => w.sprite === hit.object) ?? null : null;
    if (this.aimMon) this.aim.copy(this.aimMon.pos);
    else if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.aim)) return;
    const tp = this.trainer.pos;
    const d = distXZ(this.aim, tp);
    if (d > THROW_RANGE) {
      this.aim.sub(tp).multiplyScalar(THROW_RANGE / d).add(tp);
      this.aimMon = null;
    }
    this.aim.y = 0;
    this.aimMon ??= targets.find((w) => distXZ(w.pos, this.aim) < w.radius + 0.4) ?? null;
    this.reticle.visible = true;
    this.reticle.position.set(this.aim.x, 0.06, this.aim.z);
    this.reticle.material.color.setHex(this.aimMon ? 0xffd23f : 0xffffff);
    this.reticle.scale.setScalar(this.aimMon ? Math.max(1.4, this.aimMon.radius * 2.5) : 1);
  }

  // ───────────────────────────── spawning ─────────────────────────────

  private updateSpawning(dt: number) {
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      const cap = 3 + Math.floor(this.round / 3);
      if (this.spawnTimer <= 0 && this.wilds.length < cap) {
        this.spawnWild(false);
        this.toSpawn--;
        this.spawnTimer = Math.max(1, 2.4 - this.round * 0.07);
      }
    } else if (this.bossPending && this.wilds.length <= 1) {
      this.bossPending = false;
      const b = this.spawnWild(true);
      this.ui.toast(`An ALPHA ${b.sp.name} appeared!`, 'warn');
      audio.alpha();
      void audio.cry(b.sp.id, 0.7, 0.8);
    }
  }

  private spawnWild(boss: boolean) {
    const pool = SPECIES.filter((s) => s.minRound <= this.round);
    const sp = weightedPick(pool, (s) => (this.biome.types.includes(s.type) ? 4 : 1));
    const level = Math.max(2, Math.round(this.round * 1.4) + Math.floor(Math.random() * 2)) + (boss ? 3 : 0);
    const shiny = Math.random() < SHINY_ODDS;
    const m = new Mon(sp, level, 'wild', boss, shiny);
    const tp = this.trainer.pos;
    let x = 0, z = 0;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(6, ARENA_R - 1);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (Math.hypot(x - tp.x, z - tp.z) > 11) break;
    }
    m.pos.set(x, 0, z);
    m.face(tp.x - x, tp.z - z);
    this.scene.add(m.obj);
    this.wilds.push(m);
    this.fx.spawn('shine', m.pos.clone().setY(0.6), { size: 1.2, life: 0.4, grow: 0.8 });
    if (shiny) {
      this.fx.sparkle(mid(m), 10, 0.5);
      audio.shiny();
      this.ui.toast(`✦ A shiny ${sp.name} appeared!`, 'warn');
      this.hint('shiny', 'Shiny Pokémon are rare — follow the blue arrow and catch it before your team KOs it (F holds fire).');
    }
    if (!boss && !this.criedThisRound.has(sp.id)) {
      this.criedThisRound.add(sp.id);
      void audio.cry(sp.id, 0.3);
    }
    return m;
  }

  // ───────────────────────────── AI ─────────────────────────────

  private updateParty(m: Mon, dt: number) {
    m.cd -= dt;
    m.moving = false;
    if (m.evolveTo) return; // mid-evolution: rooted and untargetable
    const tp = this.trainer.pos;
    if (this.focus && !this.valid(this.focus)) this.focus = null;
    if (this.hold) m.target = null;
    else if (this.focus && distXZ(this.focus.pos, tp) < 16) m.target = this.focus;
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
      this.moveTo(m, tp.x + Math.cos(a) * 2.4, tp.z + Math.sin(a) * 2.4, m.sp.speed * 1.3, dt, 0.25);
    }
  }

  private updateWild(m: Mon, dt: number) {
    if (m.grow < 1) return;
    m.cd -= dt;
    m.moving = false;
    if (m.boss) {
      if (m.slamT > 0) return this.updateSlam(m, dt);
      m.slamCd -= dt;
      if (m.slamCd <= 0 && m.target && distXZ(m.target.pos, m.pos) < SLAM_R + 1) return this.startSlam(m);
    }
    m.retarget -= dt;
    if (!m.target || !this.valid(m.target) || m.retarget <= 0) {
      m.retarget = 1 + Math.random();
      m.target = this.nearest<Unit>(m.pos, [...this.party.filter((p) => p.alive), this.trainer]);
    }
    if (m.target) this.engage(m, m.target, dt, m.sp.speed * (m.boss ? 0.75 : 0.8));
  }

  /** Alpha signature: a telegraphed ground slam. The red disc fills up — dash out before it lands. */
  private startSlam(m: Mon) {
    m.slamT = SLAM_WIND;
    const g = new THREE.Group();
    const mat = (o: number) => new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: o, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat(0.35));
    const edge = new THREE.Mesh(new THREE.RingGeometry(SLAM_R - 0.12, SLAM_R, 64), mat(0.9));
    for (const d of [fill, edge]) d.rotation.x = -Math.PI / 2;
    g.add(fill, edge);
    g.position.set(m.pos.x, 0.05, m.pos.z);
    this.scene.add(g);
    this.slams.set(m, g);
    audio.slamWarn();
    this.hint('slam', 'Alpha slam! Get out of the red circle — Shift dashes and makes you briefly invulnerable.');
  }

  private updateSlam(m: Mon, dt: number) {
    m.slamT -= dt;
    const g = this.slams.get(m)!;
    const p = 1 - Math.max(0, m.slamT) / SLAM_WIND;
    g.children[0].scale.setScalar(Math.max(0.01, SLAM_R * p));
    m.flash = m.slamT < 0.25 ? 0.05 : 0;
    if (m.slamT > 0) return;
    this.clearSlam(m);
    m.slamCd = rand(5, 7.5);
    const atk = this.atkOf(m) * 1.8;
    for (const u of [...this.party.filter((p) => p.alive), this.trainer]) {
      if (distXZ(u.pos, m.pos) > SLAM_R + u.radius) continue;
      const mult = u instanceof Mon ? typeMult(m.sp.move.type, u.sp.type) || 0.5 : 1;
      this.hit(u, Math.round(atk * mult * (u instanceof Trainer ? 0.6 : 0.8)), mult, m.pos, 1.4);
    }
    this.shake = Math.max(this.shake, 0.7);
    this.fx.spawn('impact', m.pos.clone().setY(0.3), { size: SLAM_R * 1.8, life: 0.35, grow: 0.3 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.fx.spawn(pick(['rock1', 'rock2', 'rock3']), m.pos.clone().setY(0.4), {
        size: 0.6, life: 0.6, spin: 8, gravity: 14, vel: new THREE.Vector3(Math.cos(a) * 5, 5, Math.sin(a) * 5),
      });
    }
    audio.slam();
  }

  private clearSlam(m: Mon) {
    const g = this.slams.get(m);
    if (!g) return;
    disposeArena(g);
    this.slams.delete(m);
    m.slamT = 0;
  }

  private engage(m: Mon, t: Unit, dt: number, speed: number) {
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const reach = m.sp.range + m.radius + t.radius;
    if (d > reach * 0.9) this.moveTo(m, t.pos.x, t.pos.z, speed, dt, reach * 0.85);
    else m.face(dx, dz);
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
    m.face(dx, dz);
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
    const mv = m.sp.move;
    // Slower than a real-time brawler on purpose: every move should be readable.
    m.cd = m.sp.cooldown * (m.side === 'wild' ? 1.5 : 1.15) * rand(0.9, 1.1);
    const mult = t instanceof Mon ? typeMult(mv.type, t.sp.type) : 1;
    let dmg = this.atkOf(m) * rand(0.85, 1) * mult;
    if (t instanceof Trainer) dmg *= 0.7;
    else if (t.side === 'party') dmg *= 0.8;
    dmg = mult === 0 ? 0 : Math.max(1, Math.round(dmg));
    audio.move(mv.type, mv.kind);

    const from = mid(m);
    switch (mv.kind) {
      case 'shot':
      case 'spray': {
        const n = mv.count ?? 1;
        for (let i = 0; i < n; i++) this.launch(from, t, mv, i * (mv.kind === 'spray' ? 0.07 : 0.15), i === n - 1 ? dmg : 0, mult, i === n - 1);
        break;
      }
      case 'beam': {
        const to = mid(t);
        const segs = Math.max(2, Math.ceil(from.distanceTo(to) / (mv.size * 0.6)));
        for (let i = 0; i < segs; i++) {
          const p = from.clone().lerp(to, (i + 0.5) / segs).add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), 0));
          this.fx.spawn(mv.fx, p, { size: mv.size, life: 0.22, rotation: rand(-0.5, 0.5), color: 0xffffaa });
        }
        this.fx.spawn('electroball', to, { size: mv.size, life: 0.3, grow: 0.6 });
        this.hit(t, dmg, mult, m.pos, 0.2);
        break;
      }
      case 'melee': {
        m.lunge = 0.25;
        m.lungeDir.set(t.pos.x - m.pos.x, t.pos.z - m.pos.z).normalize();
        this.fx.spawn(mv.fx, mid(t), { size: mv.size, life: 0.3, grow: 0.3, rotation: rand(-0.3, 0.3) });
        this.hit(t, dmg, mult, m.pos, 0.45);
        break;
      }
      case 'burst':
        this.fx.spawn(mv.fx, mid(t), { size: mv.size * 0.4, life: 0.45, grow: 1.6 });
        this.hit(t, dmg, mult, m.pos, 0.2);
        break;
    }
  }

  private launch(from: THREE.Vector3, target: Unit, mv: Move, delay: number, dmg: number, mult: number, real: boolean) {
    const spray = mv.kind === 'spray';
    const sprite = this.fx.sprite(mv.fx, mv.size * (spray ? rand(0.8, 1.2) : 1));
    const start = from.clone();
    if (spray) start.add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.15, 0.15), rand(-0.2, 0.2)));
    sprite.position.copy(start);
    sprite.visible = false;
    this.scene.add(sprite);
    const dur = Math.max(0.12, start.distanceTo(mid(target)) / (spray ? 13 : 10));
    this.projectiles.push({ sprite, start, target, t: -delay, dur, arc: mv.arc ?? 0, spin: mv.spin ? rand(8, 14) : 0, dmg, mult, real });
  }

  private updateProjectiles(dt: number) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      if (!this.valid(p.target)) return this.dropSprite(p.sprite), false;
      p.sprite.visible = true;
      const f = Math.min(1, p.t / p.dur);
      p.sprite.position.lerpVectors(p.start, mid(p.target), f);
      p.sprite.position.y += Math.sin(Math.PI * f) * p.arc;
      p.sprite.material.rotation += p.spin * dt;
      if (f < 1) return true;
      if (p.real) {
        this.fx.spawn('impact', p.sprite.position, { size: 0.6, life: 0.15, grow: 0.4 });
        this.hit(p.target, p.dmg, p.mult, p.start, 0.2);
      }
      this.dropSprite(p.sprite);
      return false;
    });
  }

  private dropSprite(s: THREE.Sprite) {
    s.removeFromParent();
    s.material.dispose();
  }

  private hit(t: Unit, dmg: number, mult: number, from?: THREE.Vector3, knock = 0) {
    if (t instanceof Trainer) {
      if (t.inv > 0 || this.dodge > 0 || this.state !== 'playing') return;
      t.hp -= dmg;
      t.inv = 0.35;
      this.knockback(t, from, knock);
      this.shake = Math.max(this.shake, 0.25);
      this.ui.hurt();
      audio.hurt();
      this.floater(t.pos, 2.1, `-${dmg}`, '#ff5a5a');
      this.hint('hurt', 'Wild Pokémon go for you too — keep your team between you and them.');
      if (t.hp <= 0) {
        t.hp = 0;
        this.gameOver('You were overwhelmed by wild Pokémon!');
      }
      return;
    }
    if (!t.alive) return;
    if (mult === 0) {
      if (t.side === 'wild') this.floater(t.pos, t.height + 0.2, 'immune', '#aaaaaa');
      return;
    }
    t.hp -= dmg;
    t.flash = 0.1;
    this.knockback(t, from, knock * (t.boss ? 0.2 : 1));
    if (mult > 1 && t.side === 'wild' && this.hitStopCd <= 0) (this.hitStop = 0.05), (this.hitStopCd = 0.3);
    if (t.side === 'party') t.hurtT = 0.3;
    else {
      // Numbers only for damage you deal; your own team's health lives on the party cards.
      audio.hit(mult);
      this.damageNumber(t, dmg, mult);
      if (mult > 1) {
        this.fx.sparkle(mid(t), 3, 0.35);
        this.hint('types', 'Super effective! Mix types in your team to cover more matchups.');
      }
    }
    if (t.hp <= 0) {
      t.hp = 0;
      this.faint(t);
    }
  }

  private knockback(t: Unit, from: THREE.Vector3 | undefined, k: number) {
    if (!from || !k) return;
    const dx = t.pos.x - from.x, dz = t.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    t.pos.x += (dx / d) * k;
    t.pos.z += (dz / d) * k;
    this.clampArena(t.pos);
  }

  private faint(m: Mon) {
    if (m.side === 'wild') {
      this.wilds.splice(this.wilds.indexOf(m), 1);
      m.dying = 0.5;
      this.dying.push(m);
      this.defeated++;
      this.grantXp(m);
      if (this.defeated >= 3 && this.caught === 0) this.hint('hold', 'Tip: press F so your team holds fire while you line up a catch.');
      return;
    }
    m.fainted = true;
    m.target = null;
    void audio.cry(m.sp.id, 0.5, 0.85);
    this.ui.toast(`${m.sp.name} fainted!`, 'bad');
    if (this.party.every((p) => p.fainted)) this.gameOver('Your whole party fainted!');
  }

  private grantXp(w: Mon) {
    const awake = this.party.filter((p) => !p.fainted);
    // Shared XP: a bigger team levels each member a bit slower.
    const each = Math.round((w.level * 5 * (w.boss ? 4 : 1) * 2) / (awake.length + 1));
    for (const p of awake) {
      p.xp += each;
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
    audio.levelUp();
    if (!p.fainted) this.floater(p.pos, p.height + 0.5, 'Lv up!', '#7dffa0');
    this.checkEvolution(p);
  }

  private checkEvolution(p: Mon) {
    const evo = p.sp.evos?.find((e) => e.level !== undefined && p.level >= e.level);
    if (evo) this.evolve(p, SPECIES_BY_ID[evo.to]);
  }

  evolve(p: Mon, to: Species) {
    if (p.evolveTo || p.fainted) return;
    p.evolveTo = to;
    p.evolving = EVOLVE_TIME;
    p.evoFlicker = 0;
    p.target = null;
    audio.evolve(EVOLVE_TIME);
    audio.duck((EVOLVE_TIME + 1.5) * 1000);
    this.ui.toast(`What? ${p.sp.name} is evolving!`, 'good');
  }

  private finishEvolution(m: Mon) {
    const old = m.sp.name;
    m.showDex(null);
    m.setSpecies(m.evolveTo!);
    register(m.sp.id, m.shiny);
    m.evolveTo = null;
    m.flash = 0.25;
    this.fx.sparkle(mid(m), 12, 0.6);
    this.fx.spawn('shine', mid(m), { size: m.h * 2, life: 0.5, grow: 0.6 });
    this.ui.toast(`${old} evolved into ${m.sp.name}!`, 'good');
    audio.evolved();
    setTimeout(() => void audio.cry(m.sp.id, 0.7), 400);
    this.hint('evolved', `Evolved Pokémon are tougher and learn a new move — ${m.sp.name} now uses ${m.sp.move.name}.`);
    this.checkEvolution(m); // Rare Candy can push past two thresholds
  }

  revive(p: Mon, frac: number) {
    p.fainted = false;
    p.hp = Math.round(p.maxHp * frac);
    p.pos.copy(this.trainer.pos).add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(1, 2)));
    p.grow = 0;
    this.checkEvolution(p); // may have passed a threshold via Rare Candy while fainted
  }

  private addToParty(m: Mon) {
    this.party.push(m);
    this.scene.add(m.obj);
    m.grow = 0;
    this.fx.sparkle(mid(m), 6);
    void audio.cry(m.sp.id, 0.5);
    const stones = (m.sp.evos ?? []).filter((e) => e.stone).map((e) => STONE_NAME[e.stone!]);
    if (stones.length) this.hint('stone', `${m.sp.name} evolves with a ${stones.join(' / ')} — watch for it in round rewards.`);
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
    const sprite = this.fx.sprite('poke-ball', 0.45, true);
    sprite.position.copy(from);
    this.scene.add(sprite);
    this.balls.push({
      sprite, from, to, homing: this.aimMon, t: 0, dur: 0.3 + dist / 22, arc: 1.2 + dist * 0.12,
      state: 'fly', mon: null, success: false, resolveAt: 0, wobbles: 0,
    });
    for (const a of this.trainer.arms) a.rotation.x = -2.2;
    audio.throw();
  }

  private updateBalls(dt: number) {
    for (const b of [...this.balls]) {
      b.t += dt;
      if (b.state === 'fly') {
        if (b.homing?.alive) b.to.set(b.homing.pos.x, 0, b.homing.pos.z);
        const f = Math.min(1, b.t / b.dur);
        b.sprite.position.lerpVectors(b.from, b.to, f);
        b.sprite.position.y = b.from.y * (1 - f) + 0.25 * f + Math.sin(Math.PI * f) * b.arc;
        b.sprite.material.rotation -= dt * 14;
        const target = this.wilds.find(
          (w) => w.alive && w.grow >= 1 && distXZ(w.pos, b.sprite.position) < w.radius + 0.35 && b.sprite.position.y < w.height + 0.4,
        );
        if (target) this.startCapture(b, target);
        else if (f >= 1) (b.state = 'miss'), (b.t = 0);
      } else if (b.state === 'miss') {
        if (b.t < 0.5) b.sprite.material.rotation -= dt * 8 * (1 - b.t / 0.5);
        b.sprite.material.opacity = 1 - Math.max(0, (b.t - 0.8) / 0.4);
        if (b.t > 1.2) this.removeBall(b);
      } else if (b.state === 'done') {
        b.sprite.material.opacity = 1 - Math.max(0, (b.t - 0.5) / 0.3);
        if (b.t > 0.8) this.removeBall(b);
      } else {
        // Three wobbles at 0.4 / 1.0 / 1.6s, then click. Failed catches break out early.
        const starts = [0.4, 1.0, 1.6];
        const phase = starts.find((s) => b.t >= s && b.t < s + 0.35);
        if (phase !== undefined && b.wobbles < starts.indexOf(phase) + 1) {
          b.wobbles++;
          audio.wobble();
        }
        b.sprite.material.rotation = phase !== undefined ? Math.sin(((b.t - phase) / 0.35) * Math.PI * 2) * 0.5 : 0;
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
    b.sprite.position.set(w.pos.x, 0.25, w.pos.z);
    b.sprite.material.rotation = 0;
    const frac = w.hp / w.maxHp;
    const chance = clamp((1 - 0.88 * frac) * w.sp.catchRate * (w.boss ? 0.4 : 1) + this.catchBonus, 0.04, 0.97);
    b.success = Math.random() < chance;
    b.resolveAt = b.success ? 2.2 : pick([0.8, 1.4, 2.0]);
    this.floater(w.pos, 1.4, `${Math.round(chance * 100)}% catch`, '#7fd3ff');
    this.fx.spawn('shine', b.sprite.position.clone().setY(0.6), { size: 1.4, life: 0.3, grow: 0.5 });
    audio.ballOpen();
  }

  private resolveCapture(b: Ball) {
    const w = b.mon!;
    const at = b.sprite.position.clone();
    if (!b.success) {
      this.removeBall(b);
      w.capturing = false;
      this.fx.spawn('impact', at.setY(0.5), { size: 0.9, life: 0.2, grow: 0.5 });
      this.ui.toast(`Oh no! ${w.sp.name} broke free!`, 'warn');
      audio.breakFree();
      this.hint('hold', 'Tip: press F so your team holds fire while you line up a catch.');
      return;
    }
    b.state = 'done';
    b.t = 0;
    b.sprite.material.color.setScalar(0.65); // the classic "clicked shut" dim
    this.wilds.splice(this.wilds.indexOf(w), 1);
    w.dispose();
    this.caught++;
    this.fx.sparkle(at.clone().setY(0.5), 8);
    this.ui.toast(`Gotcha! ${w.sp.name} was caught!`, 'good');
    audio.caught();
    audio.duck(1600);
    setTimeout(() => void audio.cry(w.sp.id, 0.6), 900);
    const nm = new Mon(w.sp, w.level, 'party', false, w.shiny);
    if (register(w.sp.id, w.shiny)) setTimeout(() => this.ui.toast(`New Pokédex entry: ${w.sp.name}!`, 'info'), 700);
    nm.hp = Math.round(nm.maxHp * Math.max(0.5, w.hp / w.maxHp));
    nm.pos.copy(at).setY(0);
    if (this.party.length < PARTY_MAX) this.addToParty(nm);
    else this.showSwap(nm);
  }

  private removeBall(b: Ball) {
    this.dropSprite(b.sprite);
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
          icon: icon(url.front(p.sp.dex, p.shiny)),
          tag: p.sp.type,
          tagColor: hex(TYPE_COLOR[p.sp.type]),
          body: `Lv${p.level} · ${p.fainted ? 'Fainted' : `${Math.ceil(p.hp)}/${p.maxHp} HP`}`,
          onClick: () => {
            p.dispose();
            this.party[i] = nm;
            this.scene.add(nm.obj);
            nm.grow = 0;
            void audio.cry(nm.sp.id, 0.5);
            resume();
          },
        })),
        { title: `Let ${nm.sp.name} go`, icon: icon(url.front(nm.sp.dex, nm.shiny)), body: 'Keep your current team.', ghost: true, onClick: () => (nm.dispose(), resume()) },
      ],
    );
  }

  // ───────────────────────────── visuals ─────────────────────────────

  private animate(dt: number) {
    weakRingMat.opacity = 0.45 + 0.35 * Math.sin(this.time * 8);
    for (const m of this.slams.keys()) if (!this.wilds.includes(m) || m.capturing) this.clearSlam(m);
    const f = this.focus && this.valid(this.focus) ? this.focus : null;
    this.focusRing.visible = !!f;
    if (f) {
      this.focusRing.position.set(f.pos.x, 0.06, f.pos.z);
      this.focusRing.scale.setScalar(Math.max(1, f.radius * 1.8));
      this.focusRing.rotation.z += dt * 2;
    }
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
  }

  private animateMon(m: Mon, dt: number) {
    m.anim += dt;
    m.flash -= dt;
    m.hurtT -= dt;
    m.grow = Math.min(1, m.grow + dt * 3);
    const hidden = m.capturing || m.fainted;
    m.capScale += ((hidden ? 0 : 1) - m.capScale) * Math.min(1, dt * 10);
    const s = Math.max(0.0001, easeOutBack(m.grow) * m.capScale);

    if (m.evolveTo) {
      // Classic sequence: a white silhouette flickers between the old and new form, faster and faster.
      m.evolving -= dt;
      const p = 1 - m.evolving / EVOLVE_TIME;
      m.evoFlicker += dt * (1.5 + 20 * p * p);
      m.showDex(Math.floor(m.evoFlicker) % 2 ? m.evolveTo.dex : m.sp.dex, true);
      if (Math.random() < dt * (3 + 10 * p)) {
        const a = Math.random() * Math.PI * 2;
        this.fx.spawn('shine', mid(m).add(new THREE.Vector3(Math.cos(a) * 0.8, rand(-0.5, 0.8), Math.sin(a) * 0.4)), { size: 0.35, life: 0.5, grow: -0.5, vel: new THREE.Vector3(0, 1.2, 0) });
      }
      if (m.evolving <= 0) this.finishEvolution(m);
    }

    // Hop while walking, breathe while idle, hover if it flies.
    const hover = m.sp.float ? 0.45 + 0.12 * Math.sin(m.anim * 3) : 0;
    const hop = m.moving && !m.sp.float ? Math.abs(Math.sin(m.anim * 11)) * 0.2 : 0;
    const squash = m.moving ? 1 + 0.06 * Math.cos(m.anim * 22) : 1 + 0.025 * Math.sin(m.anim * 3);
    const lunge = m.lunge > 0 ? Math.sin((1 - m.lunge / 0.25) * Math.PI) * 0.5 : 0;
    if (m.lunge > 0) m.lunge -= dt;
    let sink = 0;
    if (m.dying >= 0) {
      const k = Math.max(0, m.dying / 0.5);
      m.mat.opacity = k;
      sink = (1 - k) * 0.4;
    }
    m.sprite.position.set(m.lungeDir.x * lunge, hover + hop - sink, m.lungeDir.y * lunge);
    m.sprite.scale.set((m.viewW * s * (m.flip ? -1 : 1)) / Math.sqrt(squash), m.viewH * s * squash, 1);
    m.sprite.visible = s > 0.01;
    m.shadow.visible = s > 0.05;

    // Tint priority: hit flash > red capture beam > normal. (Evolving uses a silhouette texture.)
    if (m.flash > 0) m.mat.color.setScalar(5);
    else if (m.capturing) m.mat.color.setRGB(3, 0.5, 0.5);
    else m.mat.color.setScalar(1);

    const top = m.h * s + hover;
    // Party health lives on the cards; overhead bars are only for wild Pokémon you've hurt.
    const showBar = m.side === 'wild' && m.alive && m.dying < 0 && m.hp < m.maxHp && s > 0.3;
    m.bar.obj.visible = showBar;
    if (showBar) {
      m.bar.obj.position.y = top + 0.25;
      m.bar.obj.quaternion.copy(this.camera.quaternion);
      m.bar.set(m.hp / m.maxHp);
    }
    if (m.alphaIcon) {
      m.alphaIcon.position.set(-0.78, top + 0.25, 0); // badge beside the HP bar
      m.alphaIcon.visible = m.alive;
    }
    if (m.shiny && m.alive && Math.random() < dt * 2.5) {
      this.fx.spawn('shine', mid(m).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0, 0.6), 0)), { size: 0.3, life: 0.5, grow: -0.6 });
    }
    const weak = m.side === 'wild' && m.alive && m.hp / m.maxHp < WEAK;
    m.ring.visible = weak;
    if (weak) this.hint('weak', 'Weak wild Pokémon get a yellow ring — click one to throw a Poké Ball!');
  }

  private turn(o: THREE.Object3D, dx: number, dz: number, dt: number, rate = 12) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    let d = Math.atan2(dx, dz) - o.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    o.rotation.y += d * Math.min(1, rate * dt);
  }

  private clampArena(p: THREE.Vector3) {
    const r = Math.hypot(p.x, p.z), max = ARENA_R - 0.6;
    if (r > max) (p.x *= max / r), (p.z *= max / r);
  }

  private floater(pos: THREE.Vector3, y: number, text: string, color: string, big = false) {
    this.floaters.push({ el: this.ui.floater(text, color, big), pos: new THREE.Vector3(pos.x + rand(-0.3, 0.3), y, pos.z), t: 0 });
  }

  /** One number per target: rapid hits (sprays, volleys, several attackers) add into it instead of stacking. */
  private damageNumber(t: Mon, dmg: number, mult: number) {
    const f = this.dmgFloaters.get(t);
    if (f && f.t < 0.35) {
      f.total! += dmg;
      f.t = 0;
      f.pos.set(t.pos.x, t.height + 0.6, t.pos.z);
      f.el.textContent = `${f.total}${mult > 1 || f.el.classList.contains('big') ? '!' : ''}`;
      if (mult > 1) (f.el.classList.add('big'), (f.el.style.color = '#ffd23f'));
      return;
    }
    const color = mult > 1 ? '#ffd23f' : mult < 1 ? '#c8c8c8' : '#ffffff';
    this.floater(t.pos, t.height + 0.6, mult > 1 ? `${dmg}!` : `${dmg}`, color, mult > 1);
    const nf = this.floaters[this.floaters.length - 1];
    nf.total = dmg;
    this.dmgFloaters.set(t, nf);
  }

  private updateFloaters(dt: number) {
    const v = new THREE.Vector3();
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      f.pos.y += dt * 1.2;
      v.copy(f.pos).project(this.camera);
      const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(1 - (f.t / FLOATER_LIFE) ** 2);
      if (f.t < FLOATER_LIFE) return true;
      f.el.remove();
      for (const [m, df] of this.dmgFloaters) if (df === f) this.dmgFloaters.delete(m);
      return false;
    });
  }

  private arrows(): Arrow[] {
    const out: Arrow[] = [];
    const v = new THREE.Vector3();
    for (const w of this.wilds) {
      if (!w.alive || out.length >= 12) continue;
      v.copy(w.pos).setY(0.5).project(this.camera);
      let { x, y } = v;
      if (v.z < 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1) continue;
      if (v.z > 1) (x = -x), (y = -y);
      const m = Math.max(Math.abs(x), Math.abs(y));
      x /= m;
      y /= m;
      out.push({
        x: ((x * 0.95 + 1) / 2) * innerWidth,
        y: ((1 - y * 0.9) / 2) * innerHeight,
        angle: Math.atan2(-y, x),
        kind: w.boss ? 'alpha' : w.shiny ? 'shiny' : w.hp / w.maxHp < WEAK ? 'weak' : 'wild',
      });
    }
    return out;
  }

  private updateCamera(dt: number) {
    this.camFocus.lerp(this.trainer.pos, 1 - Math.exp(-6 * dt));
    const look = this.camFocus.clone().add(CAM_LEAD);
    this.camera.position.copy(look).add(CAM_OFFSET);
    this.camera.lookAt(look);
    if (this.shake > 0.01) {
      this.camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.shake * 0.35));
      this.shake *= Math.exp(-7 * dt);
    }
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
      muted: audio.muted,
      dash: clamp(1 - this.dashCd / DASH_CD, 0, 1),
      focus: this.focus && this.valid(this.focus) ? this.focus.sp.name : undefined,
    });
    this.ui.setParty(
      this.party.map((p) => ({
        name: p.sp.name,
        icon: icon(url.front(p.sp.dex, p.shiny)),
        shiny: p.shiny,
        level: p.level,
        move: p.sp.move.name,
        color: hex(TYPE_COLOR[p.sp.move.type]),
        hp: p.hp,
        maxHp: p.maxHp,
        xpFrac: Math.min(1, p.xp / xpNeed(p.level)),
        fainted: p.fainted,
        hurt: p.hurtT > 0,
        evolving: p.evolveTo !== null,
        evoLevel: p.sp.evos?.find((e) => e.level)?.level,
        evoStones: (p.sp.evos ?? []).filter((e) => e.stone).map((e) => icon(url.item(e.stone!))),
      })),
    );
  }
}
