import * as THREE from 'three';
import { type Species, EVOLVED, FX_ALL, ITEMS, MOVES, MUSIC, SHINY_ODDS, SPECIES, SPECIES_BY_ID, STARTERS, STONE_LEVEL, STONE_NAME, TRAINER_SHEET, STAT_KEYS, STAT_LABEL, TYPE_COLOR, expAt, hex, typeLabel, typeMultVs, type Evo, type Move, type MoveKind, type Status } from './data';
import { LEADER_LEVELS, BALLS, calcStats, SLOW_TIME, STATUS_DOT, TRAP_TIME, catchChance, damage, WILD_TEMPO, EXP_SHARE_BENCH, expGain, wildLevel, wildPower, type BallKind, type Hit } from './battle';
import { ARENA_R } from './models';
import { BIOMES, ROUNDS_PER_AREA, areaRound, biomeFor, buildArena, disposeArena, sunFor, type Biome, type Solid, type Zone } from './biomes';
import { finishRun, register, save } from './progress';
import { ACT_FOLLOW, Mon, TRAINER_FRAMES, Trainer, weakRingMat } from './entities';
import { Effects } from './fx';
import { audio } from './audio';
import { icon, preload, url } from './assets';
import { ENV } from './env';
import { UI, statRow, type Arrow, type CardSpec, type TypeChip } from './ui';

type State = 'loading' | 'title' | 'starter' | 'playing' | 'paused' | 'reward' | 'swap' | 'center' | 'gameover';

interface Projectile {
  sprite: THREE.Sprite;
  start: THREE.Vector3;
  target: Mon;
  t: number;
  dur: number;
  arc: number;
  spin: number;
  hit: Hit;
  src: Mon;
  mv: Move;
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
const AGGRO_R = 5.5; // wild Pokémon notice you (or your Pokémon) this close
const SWITCH_CD = 1.2; // seconds between switching Pokémon
const FAINT_SWITCH = 1.1; // the next Pokémon comes out this long after one faints
const THROW_RANGE = 14;
const TRAINER_SPEED = 7;
const CAM_OFFSET = new THREE.Vector3(0, 12, 12);
// Look a bit south of the trainer so the party panel doesn't hide what's coming from below.
const CAM_LEAD = new THREE.Vector3(0, 0.5, 1.5);
const UP = new THREE.Vector3(0, 1, 0);
// Units only collide with solids at this fraction of their radius: feet, not the whole sprite, meet a trunk.
const SOLID_GIVE = 0.6;
const STEER_LOOK = 1.2; // how far ahead walkers start curving around a solid
const SUN_OFFSET = new THREE.Vector3(12, 22, 8);
const FLOATER_LIFE = 0.8;
const WEAK = 0.35;
const DASH_TIME = 0.18;
const DASH_SPEED = 24;
const DASH_CD = 1.4;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distXZ = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const easeOutBack = (x: number) => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
const shuffle = <T>(arr: T[]) => arr.map((v) => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
const EVOLVE_TIME = 2.6;
const mid = (u: Mon) => u.pos.clone().setY(u.height * 0.5);
/** Wind-up before each kind of move lands, long enough to read the attacker's animation. */
/** Status condition labels and tints. */
const STATUS_INFO: Record<Status, { label: string; verb: string; color: number; css: string }> = {
  psn: { label: 'PSN', verb: 'was poisoned', color: 0xc070ff, css: '#b05ce0' },
  brn: { label: 'BRN', verb: 'was burned', color: 0xff7040, css: '#ff7040' },
  par: { label: 'PAR', verb: 'is paralyzed', color: 0xffe040, css: '#e8c020' },
};
const WIND: Record<MoveKind, number> = { melee: 0.18, shot: 0.14, spray: 0.14, drop: 0.3, beam: 0.3, bolt: 0.35, burst: 0.25, quake: 0.38 };
/** Mew's Metronome draws from every other move. */
const METRONOME = Object.values(MOVES).filter((m: Move) => m !== MOVES.metronome && m !== MOVES.transform);
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const typeChips = (sp: Species): TypeChip[] =>
  [sp.type, ...(sp.type2 ? [sp.type2] : [])].map((t) => ({ label: t.toUpperCase(), color: hex(TYPE_COLOR[t]) }));
function weightedPick<T>(items: T[], weight: (t: T) => number) {
  let r = Math.random() * items.reduce((a, t) => a + weight(t), 0);
  for (const t of items) if ((r -= weight(t)) <= 0) return t;
  return items[items.length - 1];
}

const REWARDS: Reward[] = [
  {
    title: 'Hyper Potion', item: 'hyper-potion', desc: 'Fully heal every conscious Pokémon.',
    apply: (g) => {
      for (const p of g.party) if (!p.fainted) p.hp = p.maxHp;
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
    title: 'Great Balls', item: 'great-ball', desc: 'Upgrade every ball you throw to a Great Ball (1.5× catch rate).',
    cond: (g) => g.ball === 'poke',
    apply: (g) => (g.ball = 'great'),
  },
  {
    title: 'Ultra Balls', item: 'ultra-ball', desc: 'Upgrade every ball you throw to an Ultra Ball (2× catch rate).',
    cond: (g) => g.ball === 'great',
    apply: (g) => (g.ball = 'ultra'),
  },
  {
    title: 'Full Heal', item: 'full-heal', desc: 'Your Pokémon shrug off status for the rest of the run (no poison, burn or paralysis).',
    cond: (g) => !g.statusImmune,
    apply: (g) => (g.statusImmune = true),
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

  readonly trainer = new Trainer(TRAINER_SHEET);
  party: Mon[] = [];
  /** The one Pokémon out of its ball; the rest of the party waits, like in the games. */
  active: Mon | null = null;
  private switchCd = 0;
  private faintSwitch = -1;
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
  private leaderPending = false;
  private roundTotal = 0;
  private criedThisRound = new Set<string>();
  pokeballs = 5;
  partyAtkMul = 1;
  ball: BallKind = 'poke';
  statusImmune = false;
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
  private dashT = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector2();
  private shake = 0;
  private hitStop = 0;
  private hitStopCd = 0;
  private tmpColor = new THREE.Color();

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
    this.setBiome(BIOMES[0], false); // the arena itself is built once its FireRed art has loaded
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
    this.ui.onPartyClick = (i) => this.switchTo(i);
    this.resize();
    this.loop();
    void this.load();
  }

  // ───────────────────────────── setup / input ─────────────────────────────

  private async load() {
    // The arena's art first, so the world never shows placeholder textures.
    this.ui.showModal('Loading…', '', []);
    await preload(Object.keys(ENV).map(url.env), () => {});
    this.setBiome(this.biome);
    const srcs = [
      ...SPECIES.flatMap((s) => [url.front(s.dex), url.back(s.dex), url.front(s.dex, true), url.back(s.dex, true)]),
      ...FX_ALL.map(url.fx),
      ...ITEMS.map(url.item),
    ];
    const missing = await preload(srcs, (done, total) => {
      const p = document.querySelector('#modal p');
      if (p) p.textContent = `${done} / ${total} sprites`;
    }); // counts every failed load so far, the arena art included
    if (!missing) return this.showHero();
    this.ui.showModal(
      'Some assets are missing',
      `${missing} sprites failed to load. Run <code>npm run assets</code> and reload. You can still play with placeholders.`,
      [{ title: 'Continue anyway', onClick: () => this.showHero() }],
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
      if (this.state === 'title' && (k === 'enter' || k === ' ')) return this.leaveHero();
      if (k === ' ') this.throwBall();
      if (k === 'f') this.toggleHold();
      if (k >= '1' && k <= '6') this.switchTo(Number(k) - 1);
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
    audio.watchVisibility();
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.throwBall();
      if (e.button === 2) this.toggleHold();
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

  /** Title screen over the slowly orbiting first area; the title theme starts on the first click or key. */
  private showHero() {
    this.ui.hideModal();
    this.state = 'title';
    audio.playMusic(MUSIC.title);
    const stats = save.runs
      ? [
          { label: 'Best round', value: String(save.best) },
          { label: 'Pokédex', value: `${save.caught.length}/${SPECIES.length}` },
          { label: 'Shiny', value: `✦ ${save.shinies.length}` },
          { label: 'Runs', value: String(save.runs) },
        ]
      : [];
    this.ui.showHero(
      {
        trainer: url.trainer(TRAINER_SHEET),
        frames: TRAINER_FRAMES,
        lineup: ['bulbasaur', 'charmander', 'squirtle', 'pikachu'].map((id) => url.anim(SPECIES_BY_ID[id].dex, false)),
        stats,
      },
      () => this.leaveHero(),
    );
  }

  private leaveHero() {
    if (this.state !== 'title') return;
    audio.unlock();
    audio.ui();
    this.ui.hideHero();
    this.showStarter();
  }

  private showStarter() {
    this.state = 'starter';
    const meta = save.runs
      ? `<br/><span class="meta">Best: round ${save.best} · Pokédex ${save.caught.length}/${SPECIES.length} · ✦ ${save.shinies.length} shiny</span>`
      : '';
    this.ui.showModal(
      'Choose your partner',
      `Survive endless rounds of wild Pokémon. Weaken them, then throw Poké Balls to build a team of six.${meta}`,
      STARTERS.map((id) => {
        const sp = SPECIES_BY_ID[id];
        return {
          title: sp.name,
          icon: icon(url.front(sp.dex)),
          types: typeChips(sp),
          move: { label: sp.move.name, color: hex(TYPE_COLOR[sp.move.type]) },
          body: sp.blurb,
          stats: STAT_KEYS.map((k) => ({ label: STAT_LABEL[k], value: sp.base[k] })),
          onClick: () => {
            audio.unlock();
            const m = new Mon(sp, 5, 'party');
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

  private setBiome(b: Biome, build = true) {
    if (this.arena) disposeArena(this.arena);
    this.arena = build ? buildArena(b) : null;
    if (this.arena) this.scene.add(this.arena);
    (this.scene.background as THREE.Color).setHex(b.sky);
    this.scene.fog!.color.setHex(b.sky);
    this.hemi.intensity = b.light;
    const [sunColor, sunI] = sunFor(b);
    this.sun.color.setHex(sunColor);
    this.sun.intensity = sunI;
    this.hemi.groundColor.setHex(b.ground).multiplyScalar(0.8);
    this.biome = b;
  }

  private startRound(n: number) {
    this.round = n;
    this.toSpawn = Math.min(16, 3 + Math.floor(n * 0.8));
    this.leaderPending = n % ROUNDS_PER_AREA === 0;
    this.roundTotal = this.toSpawn + (this.leaderPending ? 1 : 0);
    this.spawnTimer = 1.5;
    this.criedThisRound.clear();
    const b = biomeFor(n);
    const newArea = b !== this.biome || n === 1;
    if (b !== this.biome) this.setBiome(b);
    this.ui.banner(newArea ? b.name : `Round ${n}`, newArea ? `Round ${n} · a new area` : this.leaderPending ? 'Something stronger lurks nearby…' : 'Wild Pokémon incoming!');
    audio.roundStart();
    audio.playMusic(b.music);
    if (n === 1) this.hint('move', 'Wild Pokémon wait in the tall grass. Walk over with WASD — your Pokémon battles on its own.');
  }

  private endRound() {
    this.state = 'reward';
    audio.playMusic(MUSIC.victory);
    this.pokeballs += 2;
    for (const p of this.party) {
      p.act = null;
      p.status = null;
      p.trapT = p.slowT = 0;
      if (!p.fainted) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
    }
    for (const p of this.projectiles) this.dropSprite(p.sprite);
    this.projectiles = [];
    this.reticle.visible = false;

    const next = () => {
      this.ui.hideModal();
      // Finishing an area means a stop at the Pokémon Center before the next one.
      if (this.round % ROUNDS_PER_AREA === 0) return this.showCenter();
      this.state = 'playing';
      this.startRound(this.round + 1);
    };
    const cards: CardSpec[] = shuffle(REWARDS.filter((r) => !r.cond || r.cond(this)))
      .slice(0, 3)
      .map((o) => ({ title: o.title, icon: icon(url.item(o.item)), body: o.desc, onClick: () => (o.apply(this), next()) }));
    // Stones only show up when someone can use one; an area's last round always offers one.
    const offers = this.stoneOffers();
    const show = () => this.ui.showModal(`Round ${this.round} cleared!`, '+2 Poké Balls, status cured and 35% HP restored. Pick a reward:', cards);
    if (offers.length && (this.round % ROUNDS_PER_AREA === 0 || Math.random() < 0.5)) cards[0] = this.stoneCard(pick(offers), next, show);
    show();
  }

  /** Between areas: Nurse Joy restores the whole party, and you choose who leads into the next area. */
  private showCenter() {
    this.state = 'center';
    audio.playMusic(MUSIC.center);
    setTimeout(() => this.state === 'center' && void audio.jingle(MUSIC.heal), 900);
    for (const p of this.party) {
      p.fainted = false;
      p.hp = p.maxHp;
      p.status = null;
      p.trapT = p.slowT = 0;
      this.checkEvolution(p); // a Rare Candy may have pushed a fainted Pokémon past its level
    }
    const area = biomeFor(this.round + 1).name;
    const go = (lead: Mon | null) => {
      this.ui.hideModal();
      if (lead && lead !== this.active) this.sendOut(lead, true);
      this.state = 'playing';
      this.startRound(this.round + 1);
    };
    this.ui.showModal(
      'Pokémon Center',
      `Your Pokémon are fighting fit! Choose who leads the way into <b>${area}</b>.`,
      [
        ...this.party.map((p) => ({
          title: p.sp.name,
          icon: icon(url.front(p.sp.dex, p.shiny)),
          tag: `Lv${p.level} · ${typeLabel(p.sp)}`,
          tagColor: hex(TYPE_COLOR[p.sp.type]),
          body: p === this.active ? 'Leading now' : 'Lead with this one',
          onClick: () => go(p),
        })),
      ],
      `<div class="center-hero"><img class="pc" src="${icon(url.env('pokemonCenter'))}" alt="" /><img class="nurse" src="${icon(url.env('nurse'))}" alt="" /></div>`,
    );
  }

  private stoneOffers() {
    return this.party
      .filter((p) => !p.fainted && !p.evolveTo)
      .map((mon) => ({ mon, evos: (mon.sp.evos ?? []).filter((e) => e.stone && mon.level >= STONE_LEVEL[e.stone]) }))
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
                tag: `${STONE_NAME[e.stone!]} · ${typeLabel(to)}`,
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
    this.ui.showModal(
      'Run over',
      `${reason}<br/>You reached <b>round ${this.round}</b>, defeated <b>${this.defeated}</b> and caught <b>${this.caught}</b> Pokémon.` +
        `<br/><span class="meta">${best ? '<span class="best">New best!</span>' : `Best: round ${save.best}`} · Pokédex ${save.caught.length}/${SPECIES.length}</span>`,
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
    this.ui.showModal(
      'Paused',
      `${this.biome.name} · Round ${this.round} · ${BALLS[this.ball].name}s${this.statusImmune ? ' · Full Heal' : ''}${this.partyAtkMul > 1 ? ` · X Attack +${Math.round((this.partyAtkMul - 1) * 100)}%` : ''}`,
      [
        { title: 'Resume', icon: icon(url.item(`${this.ball}-ball`)), onClick: () => this.togglePause() },
        { title: 'Restart run', body: 'Abandon this run and pick a new partner.', ghost: true, onClick: () => location.reload() },
      ],
      this.partySummary(),
    );
  }

  /** Pause-screen team sheet: real stats at the current level, with the move's power and category. */
  private partySummary() {
    if (!this.party.length) return '';
    const rows = this.party.map((p) => {
      // Bars are relative to a base-150, max-IV Pokémon of the same level.
      const top = calcStats({ hp: 150, atk: 150, def: 150, spa: 150, spd: 150, spe: 150 }, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, p.level);
      const mv = p.sp.move;
      const power = mv.fixed !== undefined ? (mv.fixed === 'level' ? `=Lv` : `=${mv.fixed}`) : mv.power || '—';
      return `<div class="sheet-mon ${p.fainted ? 'fainted' : ''}">
        <img src="${icon(url.front(p.sp.dex, p.shiny))}" alt="" />
        <div class="sheet-id"><b>${p.shiny ? '<span class="shiny">✦</span>' : ''}${p.sp.name}</b><span>Lv${p.level} · ${typeChips(p.sp).map((c) => `<span class="type" style="background:${c.color}">${c.label}</span>`).join('')}</span>
          <span class="sheet-move"><span class="dot" style="background:${hex(TYPE_COLOR[mv.type])}"></span>${mv.name} · ${mv.cat === 'physical' ? 'Phys' : 'Spec'} ${power}</span></div>
        <div class="sheet-stats">${STAT_KEYS.map((k) => statRow(STAT_LABEL[k], k === 'hp' ? p.maxHp : p.stats[k], top[k])).join('')}</div>
      </div>`;
    });
    return `<div class="sheet">${rows.join('')}</div>`;
  }

  private toggleHold() {
    if (this.state !== 'playing') return;
    this.hold = !this.hold;
    for (const p of this.party) p.target = null;
    audio.ui();
    // The lead acknowledges the order: a low cry to stand down, a sharp one to attack.
    if (this.active?.alive) void audio.cry(this.active.sp.id, 0.5, this.hold ? 0.85 : 1.1);
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
      this.arena?.userData.tick?.(this.time, gdt);
    }
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateFloaters(active ? dt : 0);
    this.ui.setArrows(this.state === 'playing' ? this.arrows() : []);
    this.ui.setTarget(this.state === 'playing' ? this.targetInfo() : null);
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      if (this.state !== 'loading') this.refreshHud(); // item icons aren't loaded yet
    }
  };

  private update(dt: number) {
    this.throwCd -= dt;
    this.updateTrainer(dt);
    this.updateAim();
    this.updateSpawning(dt);
    this.switchCd -= dt;
    const out = this.active;
    for (const m of [...(out ? [out] : []), ...this.wilds]) {
      if (m.act) this.tickAct(m, dt);
      if (m.alive) this.tickStatus(m, dt);
    }
    if (out && !out.fainted) this.updateParty(out, dt);
    if (this.faintSwitch > 0 && (this.faintSwitch -= dt) <= 0) {
      // The fainted Pokémon returns to its ball and the next one in line comes out.
      const next = this.party.find((p) => !p.fainted);
      if (next) this.sendOut(next);
    }
    for (const m of this.wilds) if (m.alive) this.updateWild(m, dt);
    this.separate();
    this.updateProjectiles(dt);
    this.updateBalls(dt);
    if (
      this.state === 'playing' && this.toSpawn === 0 && !this.leaderPending &&
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
    this.dashCd -= dt;
    t.moving = len > 0;
    if (this.dashT > 0) {
      this.dashT -= dt;
      t.pos.x += this.dashDir.x * DASH_SPEED * dt;
      t.pos.z += this.dashDir.y * DASH_SPEED * dt;
      if (Math.random() < 0.6) this.fx.spawn('wisp', t.pos.clone().setY(0.4), { size: 0.9, life: 0.35, grow: 0.6, color: 0xdddddd });
    } else if (t.moving) {
      // Glance off trunks and rocks rather than stopping dead on them.
      const [sx, sz] = this.steer(t.pos, t.radius, x / len, z / len, 1);
      t.pos.x += sx * TRAINER_SPEED * dt;
      t.pos.z += sz * TRAINER_SPEED * dt;
      t.face(x, z);
    } else if (t.throwT <= 0) {
      t.face(this.aim.x - t.pos.x, this.aim.z - t.pos.z);
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
      // They wait in the grass until you come close, so more can be around at once than are fighting you.
      const cap = Math.min(7, 3 + Math.floor(this.round / 4));
      if (this.spawnTimer <= 0 && this.wilds.length < cap) {
        this.spawnWild(false);
        this.toSpawn--;
        this.spawnTimer = Math.max(1, 2.4 - this.round * 0.07);
      }
    } else if (this.leaderPending && this.wilds.length <= 1) {
      this.leaderPending = false;
      const b = this.spawnWild(true);
      this.ui.toast(`A strong wild ${b.sp.name} appeared!`, 'warn');
      audio.strong();
      void audio.cry(b.sp.id, 0.7, 0.8);
    }
  }

  /**
   * The finale of an area: one of its basic Pokémon, evolved. It always takes the first step (Pidgey → Pidgeotto) and
   * keeps going while its level would allow it (Caterpie → Metapod → Butterfree in Viridian Forest).
   */
  private leaderSpecies(level: number) {
    const stage = areaRound(this.round);
    const table = this.biome.wild.filter((e) => e.from <= stage);
    const basics = table.filter((e) => !EVOLVED.has(e.sp.id) && e.sp.evos?.length);
    let sp = weightedPick(basics.length ? basics : table, (e) => e.w).sp;
    for (let first = true; sp.evos?.length; first = false) {
      const ok = first ? sp.evos : sp.evos.filter((e) => (e.level !== undefined ? e.level <= level : level >= 30));
      if (!ok.length) break;
      sp = SPECIES_BY_ID[pick(ok).to];
    }
    return sp;
  }

  private spawnWild(leader: boolean) {
    // Each area has its own encounter table; evolved forms unlock later in the area.
    const stage = areaRound(this.round);
    const level = Math.min(100, wildLevel(this.round) + (leader ? LEADER_LEVELS : 0));
    const sp = leader ? this.leaderSpecies(level) : weightedPick(this.biome.wild.filter((e) => e.from <= stage), (e) => e.w).sp;
    const shiny = Math.random() < SHINY_ODDS;
    const m = new Mon(sp, level, 'wild', leader, shiny);
    this.refreshMusic();
    // Appear in a patch of tall grass (a hollow, underground) away from the trainer, and loiter there.
    const tp = this.trainer.pos;
    const zones: Zone[] = this.arena?.userData.zones ?? [];
    const far = zones.filter((z) => Math.hypot(z.x - tp.x, z.z - tp.z) > AGGRO_R + z.r + 3);
    const home = pick(far.length ? far : zones.length ? zones : [{ x: 0, z: -12, r: 3 }]);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * home.r;
    m.home = home;
    m.pos.set(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
    m.face(rand(-1, 1), rand(-1, 1));
    this.scene.add(m.obj);
    this.wilds.push(m);
    if (leader) this.alert(m); // the area's strong Pokémon comes looking for you
    this.fx.spawn('shine', m.pos.clone().setY(0.6), { size: 1.2, life: 0.4, grow: 0.8 });
    if (shiny) {
      this.fx.sparkle(mid(m), 10, 0.5);
      audio.shiny();
      this.ui.toast(`✦ A shiny ${sp.name} appeared!`, 'warn');
      this.hint('shiny', 'Shiny Pokémon are rare — follow the blue arrow and catch it before your team KOs it (F holds fire).');
    }
    if (!leader && !this.criedThisRound.has(sp.id)) {
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
    if (this.windingUp(m)) return;
    const tp = this.trainer.pos;
    if (this.focus && !this.valid(this.focus)) this.focus = null;
    if (this.hold) m.target = null;
    else if (this.focus && distXZ(this.focus.pos, tp) < 16) m.target = this.focus;
    else {
      if (m.target && (!this.valid(m.target) || distXZ(m.target.pos, tp) > 15)) m.target = null;
      m.retarget -= dt;
      if (!m.target || m.retarget <= 0) {
        m.retarget = 0.5;
        // Fight what's fighting you; leave Pokémon still idling in the grass alone (E focuses one on purpose).
        m.target = this.nearest(m.pos, this.wilds.filter((w) => w.alive && w.aggro && distXZ(w.pos, tp) < 12));
      }
    }
    if (m.target) this.engage(m, m.target, dt, m.sp.speed * m.slowMul);
    else {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.03 * dt); // catch breath out of combat
      this.moveTo(m, tp.x + 1.4, tp.z + 1.2, m.sp.speed * 1.3, dt, 0.25);
    }
  }

  private updateWild(m: Mon, dt: number) {
    if (m.grow < 1) return;
    m.cd -= dt;
    m.moving = false;
    if (this.windingUp(m)) return;
    if (!m.aggro) {
      const a = this.active;
      const near = distXZ(m.pos, this.trainer.pos) < AGGRO_R || (a?.alive && distXZ(m.pos, a.pos) < AGGRO_R) || m.hp < m.maxHp;
      if (!near) return this.loiter(m, dt);
      this.alert(m);
    }
    m.retarget -= dt;
    if (!m.target || !this.valid(m.target) || m.retarget <= 0) {
      m.retarget = 1 + Math.random();
      // Only Pokémon battle: wild ones go for whoever you've sent out, never the trainer.
      m.target = this.active?.alive ? this.active : null;
    }
    if (m.target) this.engage(m, m.target, dt, m.sp.speed * m.slowMul * 0.8);
  }

  /** Unaware wild Pokémon mill about their patch of grass. */
  private loiter(m: Mon, dt: number) {
    m.wanderT -= dt;
    const h = m.home;
    if (m.wanderT <= 0 && h) {
      m.wanderT = rand(1.5, 4.5);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * h.r;
      m.wanderTo.set(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r);
    }
    // Amble, with pauses: only move during the first part of each wander.
    if (m.wanderT > 1.2) this.moveTo(m, m.wanderTo.x, m.wanderTo.y, m.sp.speed * 0.3, dt, 0.2);
  }

  /** A wild Pokémon spots you: a "!" pops up, it cries, and nearby ones from the same patch join in. */
  private alert(m: Mon, spread = true) {
    if (m.aggro) return;
    m.aggro = true;
    m.retarget = 0;
    this.floater(m.pos, m.height + 0.6, '!', '#ff5a5a', true);
    if (!this.criedThisRound.has(`aggro:${m.sp.id}`)) {
      this.criedThisRound.add(`aggro:${m.sp.id}`);
      void audio.cry(m.sp.id, 0.35);
    }
    if (spread) for (const w of this.wilds) if (w !== m && !w.aggro && w.alive && distXZ(w.pos, m.pos) < 3.5) this.alert(w, false);
    this.hint('aggro', 'Wild Pokémon lurk in the grass and attack your Pokémon when you get close — approach on your terms.');
  }

  private engage(m: Mon, t: Mon, dt: number, speed: number) {
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const reach = m.sp.range + m.radius + t.radius;
    if (d > reach * 0.9) this.moveTo(m, t.pos.x, t.pos.z, speed, dt, reach * 0.85);
    else m.face(dx, dz);
    if (d <= reach && m.cd <= 0) this.attack(m, t);
  }

  private moveTo(m: Mon, x: number, z: number, speed: number, dt: number, stop: number) {
    if (m.trapT > 0) return; // bound in place
    const dx = x - m.pos.x, dz = z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return;
    const step = Math.min(speed * dt, d - stop);
    const [sx, sz] = this.steer(m.pos, m.radius, dx / d, dz / d, d);
    m.pos.x += sx * step;
    m.pos.z += sz * step;
    m.moving = true;
    m.face(sx, sz);
    this.clampArena(m.pos);
  }

  private valid(u: Mon) {
    return u.alive && (u.side === 'wild' ? this.wilds.includes(u) : u === this.active);
  }

  private nearest(p: THREE.Vector3, list: Mon[]): Mon | null {
    let best: Mon | null = null, bd = Infinity;
    for (const u of list) {
      const d = distXZ(p, u.pos);
      if (d < bd) (bd = d), (best = u);
    }
    return best;
  }

  private separate() {
    const units: { p: THREE.Vector3; r: number; w: number }[] = [{ p: this.trainer.pos, r: this.trainer.radius, w: 0.2 }];
    if (this.active?.alive) units.push({ p: this.active.pos, r: this.active.radius, w: 1 });
    for (const m of this.wilds) if (m.alive) units.push({ p: m.pos, r: m.radius, w: 1 });
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
    // Tree trunks, rocks, signs and graves are solid: push units straight out, so they slide around the curve.
    for (const u of units) {
      for (const s of this.solids()) {
        const dx = u.p.x - s.x, dz = u.p.z - s.z, d = Math.hypot(dx, dz), min = s.r + u.r * SOLID_GIVE;
        if (d >= min) continue;
        if (d < 1e-4) u.p.x += min;
        else (u.p.x = s.x + (dx / d) * min), (u.p.z = s.z + (dz / d) * min);
      }
    }
  }

  private solids(): Solid[] {
    return this.arena?.userData.solids ?? [];
  }

  /**
   * Bends a unit direction (dx, dz) around a solid ahead, so walkers curve past trunks and rocks instead of
   * pressing into them. Returns the direction to move in (unit length).
   */
  private steer(p: THREE.Vector3, r: number, dx: number, dz: number, reach: number) {
    let best: Solid | null = null, bestAlong = Infinity, side = 0, depth = 0;
    for (const s of this.solids()) {
      const sx = s.x - p.x, sz = s.z - p.z;
      const along = sx * dx + sz * dz; // how far ahead the solid is
      if (along <= 0 || along > Math.min(reach, STEER_LOOK + s.r) || along >= bestAlong) continue;
      const lateral = dx * sz - dz * sx; // which side of our path its centre is on
      const clear = s.r + r * SOLID_GIVE + 0.1;
      if (Math.abs(lateral) >= clear) continue;
      (best = s), (bestAlong = along), (side = lateral >= 0 ? -1 : 1), (depth = 1 - Math.abs(lateral) / clear);
    }
    if (!best) return [dx, dz] as const;
    // Turn towards the free side: the more squarely we'd hit it, the harder the turn.
    const k = 0.6 + 1.6 * depth;
    const nx = dx + -dz * side * k, nz = dz + dx * side * k, n = Math.hypot(nx, nz);
    return [nx / n, nz / n] as const;
  }

  // ───────────────────────────── combat ─────────────────────────────

  /** Starts a move: the attacker winds up (see animateMon) and the move lands when the wind-up ends. */
  private attack(m: Mon, t: Mon) {
    let mv = m.sp.move;
    if (mv === MOVES.transform && t instanceof Mon) mv = t.sp.move; // Ditto copies whoever it fights
    else if (mv === MOVES.metronome) mv = pick(METRONOME);
    // Slower than a real-time brawler on purpose: every move should be readable.
    m.cd = m.sp.cooldown * (m.side === 'wild' ? WILD_TEMPO : 1.1) * rand(0.9, 1.1) * (m.status === 'par' ? 1.5 : 1);
    if (m.status === 'par' && Math.random() < 0.25) {
      // Fully paralyzed: loses this turn.
      m.flash = 0.08;
      this.floater(m.pos, m.height + 0.4, 'Paralyzed!', STATUS_INFO.par.css);
      return;
    }
    const dir = new THREE.Vector2(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1);
    m.act = { pose: mv.kind, t: 0, wind: WIND[mv.kind], dir: dir.normalize(), fired: false, color: TYPE_COLOR[mv.type], fire: () => this.useMove(m, t, mv) };
  }

  private windingUp(m: Mon) {
    return !!m.act && !m.act.fired;
  }

  private tickAct(m: Mon, dt: number) {
    const a = m.act!;
    if (!m.alive) return void (m.act = null); // caught, fainted or evolving mid-wind-up
    a.t += dt;
    if (!a.fired && a.t >= a.wind) {
      a.fired = true;
      a.fire();
    }
    if (a.t >= a.wind + ACT_FOLLOW) m.act = null;
  }

  private useMove(m: Mon, t: Mon, mv: Move) {
    if (!this.valid(t)) return;
    const h = damage(m, t, mv);
    if (h.dmg > 0) h.dmg = Math.max(1, Math.round(h.dmg * (m.side === 'party' ? this.partyAtkMul : wildPower(this.round))));
    audio.move(mv.type, mv.kind);

    const from = mid(m);
    const fxOpts = mv.tint !== undefined ? { color: mv.tint } : {};
    switch (mv.kind) {
      case 'shot':
      case 'spray': {
        const n = mv.count ?? 1;
        for (let i = 0; i < n; i++) this.launch(from, t, m, mv, i * (mv.kind === 'spray' ? 0.07 : 0.15), h, i === n - 1);
        break;
      }
      case 'drop': {
        // Rains down from above the target.
        const n = mv.count ?? 1;
        for (let i = 0; i < n; i++) {
          const sky = mid(t).add(new THREE.Vector3(rand(-0.8, 0.8), rand(5, 6.5), rand(-0.8, 0.8)));
          this.launch(sky, t, m, mv, i * 0.12, h, i === n - 1);
        }
        break;
      }
      case 'beam':
      case 'bolt': {
        const to = mid(t);
        // A bolt comes straight down from the sky; a beam runs from the attacker.
        const src = mv.kind === 'bolt' ? to.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 7, 0)) : from;
        const segs = Math.max(2, Math.ceil(src.distanceTo(to) / (mv.size * 0.6)));
        for (let i = 0; i < segs; i++) {
          const p = src.clone().lerp(to, (i + 0.5) / segs).add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.15, 0.15), 0));
          this.fx.spawn(mv.fx, p, { size: mv.size, life: 0.22, rotation: mv.kind === 'bolt' ? Math.PI / 2 + rand(-0.4, 0.4) : rand(-0.5, 0.5), ...fxOpts, delay: i * 0.012 });
        }
        this.fx.spawn(mv.end ?? 'electroball', to, { size: mv.size * (mv.kind === 'bolt' ? 0.9 : 1), life: 0.3, grow: 0.6, ...fxOpts });
        if (mv.kind === 'bolt') this.shake = Math.max(this.shake, 0.2);
        this.land(t, h, m, mv, m.pos, 0.2);
        break;
      }
      case 'melee':
        this.fx.spawn(mv.fx, mid(t), { size: mv.size, life: 0.3, grow: 0.3, rotation: rand(-0.3, 0.3), ...fxOpts });
        this.land(t, h, m, mv, m.pos, 0.45);
        break;
      case 'burst':
        this.fx.spawn(mv.fx, mid(t), { size: mv.size * 0.4, life: 0.45, grow: 1.6, ...fxOpts });
        this.land(t, h, m, mv, m.pos, 0.2);
        break;
      case 'quake': {
        // Shockwave under the target plus debris thrown outward.
        const ground = t.pos.clone().setY(0.25);
        this.fx.spawn('impact', ground, { size: mv.size * 1.3, life: 0.35, grow: 0.5, color: mv.tint ?? 0xe0c080 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3);
          this.fx.spawn(mv.fx, ground, {
            size: mv.size * 0.3, life: 0.55, spin: 8, gravity: 14, ...fxOpts,
            vel: new THREE.Vector3(Math.cos(a) * 3.5, rand(4, 6), Math.sin(a) * 3.5),
          });
        }
        this.shake = Math.max(this.shake, 0.15);
        this.land(t, h, m, mv, m.pos, 0.5);
        break;
      }
    }
  }

  private launch(from: THREE.Vector3, target: Mon, src: Mon, mv: Move, delay: number, hit: Hit, real: boolean) {
    const spray = mv.kind === 'spray';
    const sprite = this.fx.sprite(mv.fx, mv.size * (spray ? rand(0.8, 1.2) : 1));
    if (mv.tint !== undefined) sprite.material.color.setHex(mv.tint);
    const start = from.clone();
    if (spray) start.add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.15, 0.15), rand(-0.2, 0.2)));
    sprite.position.copy(start);
    sprite.visible = false;
    this.scene.add(sprite);
    const dur = Math.max(0.12, start.distanceTo(mid(target)) / (spray ? 13 : 10));
    this.projectiles.push({ sprite, start, target, t: -delay, dur, arc: mv.arc ?? 0, spin: mv.spin ? rand(8, 14) : 0, hit, src, mv, real });
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
        this.land(p.target, p.hit, p.src, p.mv, p.start, 0.2);
      }
      this.dropSprite(p.sprite);
      return false;
    });
  }

  private dropSprite(s: THREE.Sprite) {
    s.removeFromParent();
    s.material.dispose();
  }

  /** A move connects: damage, then its secondary effects (status, bind, drain, recoil). */
  private land(t: Mon, h: Hit, src: Mon, mv: Move, from: THREE.Vector3, knock: number) {
    if (!this.valid(t)) return;
    if (h.mult === 0) return this.hit(t, 0, 0);
    if (h.dmg > 0) this.hit(t, h.dmg, h.mult, from, knock, h.crit);
    if (!t.alive) {
      if (mv.drain && src.alive) src.hp = Math.min(src.maxHp, src.hp + Math.max(1, Math.round(h.dmg * mv.drain)));
      return;
    }
    if (mv.status && Math.random() < mv.status[1]) this.inflict(t, mv.status[0]);
    if (mv.trap && t.trapT <= 0) {
      t.trapT = TRAP_TIME;
      if (t.side === 'wild') this.floater(t.pos, t.height + 0.4, 'Trapped!', '#ff9a5a');
    }
    if (mv.slow) t.slowT = SLOW_TIME;
    if (mv.drain && src.alive) src.hp = Math.min(src.maxHp, src.hp + Math.max(1, Math.round(h.dmg * mv.drain)));
    if (mv.recoil && src.alive && h.dmg > 0) this.hit(src, Math.max(1, Math.round(h.dmg * mv.recoil)), 1);
  }

  private inflict(t: Mon, st: Status) {
    if (t.status || !t.alive) return;
    if (t.side === 'party' && this.statusImmune) return;
    // Type immunities from the games: Poison types can't be poisoned, Fire types can't be burned, Electric can't be paralyzed.
    const immune = { psn: 'poison', brn: 'fire', par: 'electric' } as const;
    if (t.sp.type === immune[st] || t.sp.type2 === immune[st]) return;
    t.status = st;
    t.statusTick = 1;
    const info = STATUS_INFO[st];
    this.floater(t.pos, t.height + 0.5, info.label, info.css);
    if (t.side === 'party') this.ui.toast(`${t.sp.name} ${info.verb}!`, 'warn');
    else this.hint('status', 'Status conditions (poison, burn, paralysis) also make wild Pokémon 1.5× easier to catch.');
  }

  /** Poison/burn chip damage and bind damage. Neither can knock a Pokémon out on its own (it stops at 1 HP). */
  private tickStatus(m: Mon, dt: number) {
    m.slowT -= dt;
    let chip = 0;
    if (m.trapT > 0) {
      m.trapT -= dt;
      chip += m.maxHp * (1 / 16) * dt;
    }
    if (m.status === 'psn' || m.status === 'brn') chip += m.maxHp * STATUS_DOT * dt;
    if (chip <= 0) return;
    m.hp = Math.max(Math.min(m.hp, 1), m.hp - chip);
    m.statusTick -= dt;
    if (m.statusTick <= 0) {
      m.statusTick = 1;
      // Wild ones blink; your own card shows the status chip instead of flashing red every second.
      if (m.side === 'wild') m.flash = 0.05;
    }
  }

  private hit(t: Mon, dmg: number, mult: number, from?: THREE.Vector3, knock = 0, crit = false) {
    if (!t.alive) return;
    if (mult === 0) {
      if (t.side === 'wild') this.floater(t.pos, t.height + 0.2, 'immune', '#aaaaaa');
      return;
    }
    t.hp -= dmg;
    t.flash = 0.1;
    this.knockback(t, from, knock);
    if (mult > 1 && t.side === 'wild' && this.hitStopCd <= 0) (this.hitStop = 0.05), (this.hitStopCd = 0.3);
    if (t.side === 'party') t.hurtT = 0.3;
    else {
      // Numbers only for damage you deal; your own team's health lives on the party cards.
      audio.hit(mult);
      this.damageNumber(t, dmg, mult, crit);
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

  private knockback(t: Mon, from: THREE.Vector3 | undefined, k: number) {
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
    if (this.party.every((p) => p.fainted)) return this.gameOver('Your whole party fainted!');
    this.faintSwitch = FAINT_SWITCH;
  }

  private grantXp(w: Mon) {
    for (const p of this.party) {
      if (p.fainted || p.level >= 100) continue;
      p.xp += expGain(w, p.level, p === this.active ? 1 : EXP_SHARE_BENCH);
      while (p.level < 100 && p.xp >= expAt(p.sp.growth, p.level + 1)) this.levelUp(p);
    }
  }

  levelUp(p: Mon) {
    if (p.level >= 100) return;
    p.level++;
    p.xp = Math.max(p.xp, expAt(p.sp.growth, p.level));
    const old = p.maxHp;
    p.recalc();
    if (!p.fainted) p.hp += p.maxHp - old;
    audio.levelUp();
    if (p === this.active && !p.fainted) this.floater(p.pos, p.height + 0.5, 'Lv up!', '#7dffa0');
    this.checkEvolution(p);
  }

  private checkEvolution(p: Mon) {
    const evo = p.sp.evos?.find((e) => e.level !== undefined && p.level >= e.level);
    if (evo) this.evolve(p, SPECIES_BY_ID[evo.to]);
  }

  evolve(p: Mon, to: Species) {
    if (p.evolveTo || p.fainted) return;
    if (p !== this.active || this.state !== 'playing') {
      // Out of sight in its ball (or between rounds): no sequence, just the news.
      p.evolveTo = to;
      return this.finishEvolution(p, true);
    }
    p.evolveTo = to;
    p.evolving = EVOLVE_TIME;
    p.evoFlicker = 0;
    p.target = null;
    audio.evolve(EVOLVE_TIME);
    audio.duck((EVOLVE_TIME + 1.5) * 1000);
    this.ui.toast(`What? ${p.sp.name} is evolving!`, 'good');
  }

  private finishEvolution(m: Mon, quiet = false) {
    const old = m.sp.name;
    m.showDex(null);
    m.setSpecies(m.evolveTo!);
    m.xp = Math.max(m.xp, expAt(m.sp.growth, m.level));
    register(m.sp.id, m.shiny);
    m.evolveTo = null;
    m.flash = 0.25;
    this.ui.toast(`${old} evolved into ${m.sp.name}!`, 'good');
    audio.evolved();
    if (!quiet) {
      this.fx.sparkle(mid(m), 12, 0.6);
      this.fx.spawn('shine', mid(m), { size: m.h * 2, life: 0.5, grow: 0.6 });
    }
    setTimeout(() => void audio.cry(m.sp.id, 0.7), 400);
    this.hint('evolved', `Evolved Pokémon are tougher and learn a new move — ${m.sp.name} now uses ${m.sp.move.name}.`);
    this.checkEvolution(m); // Rare Candy can push past two thresholds
  }

  /** Recalls the Pokémon that's out (if any) and sends `m` out next to the trainer. */
  private sendOut(m: Mon, quiet = false) {
    if (m === this.active || m.fainted || !this.party.includes(m)) return;
    const prev = this.active;
    if (prev) {
      prev.act = null;
      prev.target = null;
      if (!prev.fainted && !quiet) this.fx.spawn('shine', mid(prev), { size: 1.2, life: 0.3, grow: -0.6, color: 0xff6060 });
      prev.obj.removeFromParent();
    }
    this.active = m;
    this.faintSwitch = -1;
    const tp = this.trainer.pos;
    m.pos.set(tp.x + 1.2, 0, tp.z + 1.2);
    this.clampArena(m.pos);
    m.act = null;
    m.target = null;
    m.grow = 0;
    m.cd = 0.5;
    this.scene.add(m.obj);
    this.switchCd = SWITCH_CD;
    if (quiet) return;
    this.fx.sparkle(mid(m), 6);
    this.floater(m.pos, m.height + 0.7, `Go! ${m.sp.name}!`, '#ffffff');
    void audio.cry(m.sp.id, 0.5);
  }

  /** Number keys / party cards: swap which Pokémon is out. */
  switchTo(i: number) {
    const m = this.party[i];
    if (this.state !== 'playing' || !m || m === this.active) return;
    if (m.fainted) return this.ui.toast(`${m.sp.name} has no energy left to battle!`, 'bad');
    if (this.active?.evolveTo) return;
    if (this.switchCd > 0 && !this.active?.fainted) return;
    this.sendOut(m);
    this.hint('switch', 'Switch Pokémon with 1-6 (or click a party card) to bring a better type matchup.');
  }

  revive(p: Mon, frac: number) {
    p.fainted = false;
    p.hp = Math.round(p.maxHp * frac);
    this.checkEvolution(p); // may have passed a threshold via Rare Candy while fainted
  }

  private addToParty(m: Mon) {
    this.party.push(m);
    if (!this.active) this.sendOut(m);
    else {
      this.ui.toast(`${m.sp.name} joined your party — press ${this.party.length} to send it out.`, 'info');
      this.hint('switch', 'Only one Pokémon fights at a time. Switch with 1-6 (or click a party card).');
    }
    const stones = (m.sp.evos ?? []).filter((e) => e.stone).map((e) => STONE_NAME[e.stone!]);
    const from = Math.min(...(m.sp.evos ?? []).filter((e) => e.stone).map((e) => STONE_LEVEL[e.stone!]));
    if (stones.length) this.hint('stone', `${m.sp.name} evolves with a ${stones.join(' / ')} — watch for it in round rewards from Lv${from}.`);
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
    const sprite = this.fx.sprite(`${this.ball}-ball`, 0.45, true);
    sprite.position.copy(from);
    this.scene.add(sprite);
    this.balls.push({
      sprite, from, to, homing: this.aimMon, t: 0, dur: 0.3 + dist / 22, arc: 1.2 + dist * 0.12,
      state: 'fly', mon: null, success: false, resolveAt: 0, wobbles: 0,
    });
    this.trainer.throwT = 0.3;
    this.trainer.face(to.x - from.x, to.z - from.z);
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
    const chance = this.catchOdds(w);
    b.success = Math.random() < chance;
    b.resolveAt = b.success ? 2.2 : pick([0.8, 1.4, 2.0]);
    this.floater(w.pos, 1.4, `${Math.round(chance * 100)}% catch`, '#7fd3ff');
    this.fx.spawn('shine', b.sprite.position.clone().setY(0.6), { size: 1.4, life: 0.3, grow: 0.5 });
    audio.ballOpen();
  }

  catchOdds(w: Mon) {
    return catchChance(w.sp, w.hp, w.maxHp, BALLS[this.ball].mult, w.status);
  }

  private resolveCapture(b: Ball) {
    const w = b.mon!;
    const at = b.sprite.position.clone();
    if (!b.success) {
      this.removeBall(b);
      w.capturing = false;
      this.fx.spawn('impact', at.setY(0.5), { size: 0.9, life: 0.2, grow: 0.5 });
      this.ui.toast(`Oh no! ${w.sp.name} broke free!`, 'warn');
      this.alert(w);
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
    audio.jingle(MUSIC.caught);
    setTimeout(() => void audio.cry(w.sp.id, 0.6), 900);
    const nm = new Mon(w.sp, w.level, 'party', false, w.shiny);
    Object.assign(nm.ivs, w.ivs); // same individual, same IVs
    nm.recalc();
    if (register(w.sp.id, w.shiny)) setTimeout(() => this.ui.toast(`New Pokédex entry: ${w.sp.name}!`, 'info'), 700);
    nm.hp = Math.round(nm.maxHp * Math.max(0.5, w.hp / w.maxHp));
    nm.status = w.status;
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
          tag: typeLabel(p.sp),
          tagColor: hex(TYPE_COLOR[p.sp.type]),
          body: `Lv${p.level} · ${p.fainted ? 'Fainted' : `${Math.ceil(p.hp)}/${p.maxHp} HP`}`,
          onClick: () => {
            const wasOut = p === this.active;
            p.dispose();
            this.party[i] = nm;
            if (wasOut) {
              this.active = null;
              this.sendOut(nm);
            } else void audio.cry(nm.sp.id, 0.5);
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
    const f = this.focus && this.valid(this.focus) ? this.focus : null;
    this.focusRing.visible = !!f;
    if (f) {
      this.focusRing.position.set(f.pos.x, 0.06, f.pos.z);
      this.focusRing.scale.setScalar(Math.max(1, f.radius * 1.8));
      this.focusRing.rotation.z += dt * 2;
    }
    if (this.active) this.animateMon(this.active, dt);
    for (const m of this.wilds) this.animateMon(m, dt);
    this.dying = this.dying.filter((m) => {
      m.dying -= dt;
      this.animateMon(m, dt);
      if (m.dying > 0) return true;
      m.dispose();
      return false;
    });

    const t = this.trainer;
    t.animate(dt, this.dashT > 0 ? 16 : t.moving && this.state === 'playing' ? 8 : 0);
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

    // The animated sprite plays faster while walking and attacking.
    m.tickAnim(dt * (m.moving ? 1.6 : 1) * (m.act ? 2 : 1));

    // Hop while walking, breathe while idle, hover if it flies.
    const hover = m.sp.float ? 0.45 + 0.12 * Math.sin(m.anim * 3) : 0;
    const hop = m.moving && !m.sp.float ? Math.abs(Math.sin(m.anim * 11)) * 0.2 : 0;
    let squash = m.moving ? 1 + 0.06 * Math.cos(m.anim * 22) : 1 + 0.025 * Math.sin(m.anim * 3);
    const pose = this.pose(m);
    squash *= pose.squash;
    let sink = 0;
    if (m.dying >= 0) {
      const k = Math.max(0, m.dying / 0.5);
      m.mat.opacity = k;
      sink = (1 - k) * 0.4;
    }
    const dir = m.act?.dir;
    m.sprite.position.set((dir?.x ?? 0) * pose.fwd + pose.jx, hover + hop - sink + pose.up, (dir?.y ?? 0) * pose.fwd);
    m.sprite.scale.set((m.viewW * s * pose.grow) / Math.sqrt(squash), m.viewH * s * pose.grow * squash, 1);
    m.sprite.visible = s > 0.01;
    m.shadow.visible = s > 0.05;

    // Tint priority: hit flash > red capture beam > normal. (Evolving uses a silhouette texture.)
    if (m.flash > 0) m.mat.color.setScalar(5);
    else if (m.capturing) m.mat.color.setRGB(3, 0.5, 0.5);
    else if (pose.glow > 0) m.mat.color.setScalar(1).lerp(this.tmpColor.setHex(m.act!.color).multiplyScalar(2.2), pose.glow);
    else if (m.alive && (m.status || m.trapT > 0)) {
      // Status shows as a slow pulse of its colour (orange for a bind).
      const c = m.status ? STATUS_INFO[m.status].color : 0xff9a5a;
      m.mat.color.setScalar(1).lerp(this.tmpColor.setHex(c), 0.3 + 0.2 * Math.sin(this.time * 6));
    } else m.mat.color.setScalar(1);

    const top = m.h * s + hover;
    // Party health lives on the cards; overhead bars are only for wild Pokémon you've hurt.
    const showBar = m.side === 'wild' && m.alive && m.dying < 0 && m.hp < m.maxHp && s > 0.3;
    m.bar.obj.visible = showBar;
    if (showBar) {
      m.bar.obj.position.y = top + 0.25;
      m.bar.obj.quaternion.copy(this.camera.quaternion);
      m.bar.set(m.hp / m.maxHp);
    }
    if (m.shiny && m.alive && Math.random() < dt * 2.5) {
      this.fx.spawn('shine', mid(m).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0, 0.6), 0)), { size: 0.3, life: 0.5, grow: -0.6 });
    }
    const weak = m.side === 'wild' && m.alive && m.hp / m.maxHp < WEAK;
    m.ring.visible = weak;
    if (weak) this.hint('weak', 'Weak wild Pokémon get a yellow ring — click one to throw a Poké Ball!');
  }

  /**
   * Attacker body language per move kind: wind-up (p: 0→1), then follow-through (q: 0→1) once the move fires.
   * fwd is along the attack direction, up is vertical; squash/grow scale the sprite; glow tints it the move's type colour.
   */
  private pose(m: Mon) {
    const out = { fwd: 0, up: 0, jx: 0, squash: 1, grow: 1, glow: 0 };
    const a = m.act;
    if (!a || !m.alive) return out;
    const p = Math.min(1, a.t / a.wind);
    const q = a.fired ? Math.min(1, (a.t - a.wind) / ACT_FOLLOW) : 0;
    const arc = Math.sin(q * Math.PI);
    switch (a.pose) {
      case 'melee': // rear back, then lunge into the target
        out.fwd = a.fired ? -0.25 * (1 - q) + arc * 0.65 : -0.25 * easeOut(p);
        out.squash = a.fired ? 1 + 0.08 * arc : 1 - 0.12 * p;
        break;
      case 'shot':
      case 'spray':
      case 'drop': // draw back, then thrust forward as the move leaves
        out.fwd = a.fired ? -0.15 * (1 - q) + arc * 0.22 : -0.15 * p;
        out.squash = a.fired ? 1 + 0.06 * arc : 1 - 0.08 * p;
        out.glow = a.fired ? 0 : 0.35 * p;
        break;
      case 'beam':
      case 'bolt': // shudder while charging, kick back on release
        out.jx = a.fired ? 0 : (Math.random() - 0.5) * 0.1 * p;
        out.fwd = a.fired ? -0.18 * arc : 0;
        out.glow = a.fired ? 1 - q : p;
        out.grow = 1 + 0.06 * (a.fired ? 1 - q : p);
        break;
      case 'burst': // levitate and swell with psychic power
        out.up = a.fired ? 0.35 * (1 - q) : 0.35 * easeOut(p);
        out.grow = 1 + 0.12 * (a.fired ? 1 - q : p);
        out.glow = a.fired ? 0.8 * (1 - q) : 0.8 * p;
        break;
      case 'quake': // crouch, leap, and slam down as the shockwave hits
        out.up = a.fired ? 0 : p < 0.2 ? 0 : Math.sin(((p - 0.2) / 0.8) * Math.PI) * 1.1;
        out.squash = a.fired ? 1 - 0.3 * arc : p < 0.2 ? 1 - 0.25 * (p / 0.2) : 1 + 0.1 * Math.sin(((p - 0.2) / 0.8) * Math.PI);
        break;
    }
    return out;
  }

  private clampArena(p: THREE.Vector3) {
    const r = Math.hypot(p.x, p.z), max = ARENA_R - 0.6;
    if (r > max) (p.x *= max / r), (p.z *= max / r);
  }

  private floater(pos: THREE.Vector3, y: number, text: string, color: string, big = false) {
    this.floaters.push({ el: this.ui.floater(text, color, big), pos: new THREE.Vector3(pos.x + rand(-0.3, 0.3), y, pos.z), t: 0 });
  }

  /** One number per target: rapid hits (sprays, volleys, several attackers) add into it instead of stacking. */
  private damageNumber(t: Mon, dmg: number, mult: number, crit: boolean) {
    if (crit) this.floater(t.pos, t.height + 1.0, 'Critical hit!', '#ff9a3c');
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
        kind: w.leader ? 'leader' : w.shiny ? 'shiny' : w.hp / w.maxHp < WEAK ? 'weak' : 'wild',
      });
    }
    return out;
  }

  private updateCamera(dt: number) {
    this.camFocus.lerp(this.trainer.pos, 1 - Math.exp(-6 * dt));
    const look = this.camFocus.clone().add(CAM_LEAD);
    // The title screen slowly circles the trainer.
    this.camera.position.copy(look).add(this.state === 'title' ? CAM_OFFSET.clone().applyAxisAngle(UP, this.time * 0.08) : CAM_OFFSET);
    this.camera.lookAt(look);
    if (this.shake > 0.01) {
      this.camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(this.shake * 0.35));
      this.shake *= Math.exp(-7 * dt);
    }
    this.sun.position.copy(this.camFocus).add(SUN_OFFSET);
    this.sun.target.position.copy(this.camFocus);
  }

  /** Info card for the wild Pokémon under the cursor. */
  private targetInfo() {
    const w = this.aimMon;
    if (!w || !w.alive || w.grow < 1) return null;
    const v = w.pos.clone().setY(w.height + 0.55).project(this.camera);
    const awake = this.party.filter((p) => !p.fainted);
    const best = Math.max(0, ...awake.map((p) => typeMultVs(p.sp.move.type, w.sp)));
    return {
      x: ((v.x + 1) / 2) * innerWidth,
      y: ((1 - v.y) / 2) * innerHeight,
      name: w.sp.name,
      level: w.level,
      types: typeChips(w.sp),
      hpFrac: w.hp / w.maxHp,
      status: w.status ? { label: STATUS_INFO[w.status].label, color: STATUS_INFO[w.status].css } : undefined,
      catchPct: Math.round(this.catchOdds(w) * 100),
      leader: w.leader,
      shiny: w.shiny,
      matchup: !awake.length ? undefined : best > 1 ? ('good' as const) : best < 1 ? ('bad' as const) : undefined,
    };
  }

  /** The area theme, or a battle theme while the area's strong Pokémon or a legendary is around. */
  private refreshMusic() {
    if (this.state !== 'playing') return;
    const legend = this.wilds.find((w) => w.sp.legendary);
    audio.playMusic(legend ? (legend.sp.id === 'mewtwo' ? MUSIC.mewtwo : MUSIC.legend) : this.wilds.some((w) => w.leader) ? MUSIC.wild : this.biome.music);
  }

  private refreshHud() {
    this.refreshMusic();
    this.ui.setHud({
      area: this.biome.name,
      round: this.round,
      remaining: this.wilds.length + this.toSpawn + (this.leaderPending ? 1 : 0),
      total: this.roundTotal,
      balls: this.pokeballs,
      ballName: BALLS[this.ball].name,
      ballIcon: icon(url.item(`${this.ball}-ball`)),
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
        types: typeChips(p.sp),
        status: p.status ? { label: STATUS_INFO[p.status].label, color: STATUS_INFO[p.status].css } : undefined,
        move: p.sp.move.name,
        color: hex(TYPE_COLOR[p.sp.move.type]),
        hp: p.hp,
        maxHp: p.maxHp,
        xpFrac: p.level >= 100 ? 1 : clamp((p.xp - expAt(p.sp.growth, p.level)) / (expAt(p.sp.growth, p.level + 1) - expAt(p.sp.growth, p.level)), 0, 1),
        fainted: p.fainted,
        hurt: p.hurtT > 0,
        evolving: p.evolveTo !== null,
        evoLevel: p.sp.evos?.find((e) => e.level)?.level,
        evoStones: (p.sp.evos ?? []).filter((e) => e.stone).map((e) => icon(url.item(e.stone!))),
        active: p === this.active,
      })),
    );
  }
}
