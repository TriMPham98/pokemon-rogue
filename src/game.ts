import * as THREE from 'three';
import { type Species, ANIMS, EVOLVED, FX_ALL, ITEMS, MOVES, MUSIC, SHINY_ODDS, SPECIES, SPECIES_BY_ID, STARTERS, STONE_LEVEL, STONE_NAME, TRAINER_SHEET, STAT_KEYS, STAT_LABEL, TYPE_COLOR, expAt, hex, typeLabel, typeMultVs, type Evo, type Move, type MoveKind, type PType, type Status } from './data';
import {
  BOOM, CHARGE, LEADER_LEVELS, BALLS, SLEEP_TIME, SPLASH, calcStats, SLOW_TIME, STATUS_DOT, TRAP_TIME, catchChance, damage, WILD_TEMPO,
  EXP_SHARE_BENCH, expGain, hordeCap, hordeSize, packMax, spawnGap, wildLevel, wildPower, type BallKind, type Hit,
} from './battle';
import { SPECIALS, type Special } from './specials';
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
const SWITCH_CD = 0.6; // seconds between recalling / sending out Pokémon
const FORMATION_R = 1.8; // idle party Pokémon fan out around the trainer at this distance
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
const mid = (u: Mon) => u.pos.clone().setY(u.height * 0.5);
/** Wind-up before each kind of move lands, long enough to read the attacker's animation. */
/** Status condition labels and tints. */
const STATUS_INFO: Record<Status, { label: string; verb: string; color: number; css: string }> = {
  psn: { label: 'PSN', verb: 'was poisoned', color: 0xc070ff, css: '#b05ce0' },
  brn: { label: 'BRN', verb: 'was burned', color: 0xff7040, css: '#ff7040' },
  par: { label: 'PAR', verb: 'is paralyzed', color: 0xffe040, css: '#e8c020' },
  slp: { label: 'SLP', verb: 'fell asleep', color: 0x8890d0, css: '#8890d0' },
};
const WIND: Record<MoveKind, number> = { melee: 0.18, shot: 0.14, spray: 0.14, drop: 0.3, beam: 0.3, bolt: 0.35, burst: 0.25, quake: 0.38 };
/** Mew's Metronome draws from every other move. */
const METRONOME = Object.values(MOVES).filter((m: Move) => m !== MOVES.metronome && m !== MOVES.transform && m !== MOVES.explosion);
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
    title: 'Full Heal', item: 'full-heal', desc: 'Your Pokémon shrug off status for the rest of the run (no poison, burn, paralysis or sleep).',
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
  /** Every Pokémon out of its ball and battling: the whole party at once, minus fainted and recalled ones. */
  out: Mon[] = [];
  /** Recalled with 1-6 to sit out the fight; they stay in their ball until sent out again. */
  private benched = new Set<Mon>();
  private switchCd = 0;
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
  /** Party slot whose special is being aimed (its number key is held down), or -1. */
  private aiming = -1;
  private preview: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Lingering Poison Gas clouds. */
  private clouds: { pos: THREE.Vector3; r: number; t: number; tick: number; src: Mon; sp: Special }[] = [];
  /** Delayed bits of a move (chain lightning, rocks still falling), in game time. */
  private later: { t: number; fn: () => void }[] = [];
  /** Evolutions waiting for the end of the round, where each plays its full sequence before anything else happens. */
  private evoQueue: { mon: Mon; to: Species }[] = [];

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

    this.preview = new THREE.Mesh(
      new THREE.RingGeometry(0.93, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.visible = false;
    this.scene.add(this.preview);

    try {
      this.seenHints = new Set(JSON.parse(localStorage.getItem('pr-hints') ?? '[]'));
    } catch {
      this.seenHints = new Set();
    }

    this.bindInput();
    this.ui.onPartyClick = (i) => this.toggleOut(i);
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
      ...Object.keys(ANIMS).map(url.battle),
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
      if (k >= '1' && k <= '6') this.beginAim(Number(k) - 1);
      if (k === 'm') audio.toggleMute();
      if (k === 'shift') this.dash();
      if (k === 'e') this.setFocus(this.aimMon);
      if (k === 'escape' || k === 'p') this.togglePause();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k >= '1' && k <= '6' && this.aiming === Number(k) - 1) this.unleash();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.aiming = -1;
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
            this.addToParty(m);
            register(sp.id);
            this.ui.hideModal();
            this.state = 'playing';
            this.startRound(1); // sends it out
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
    this.toSpawn = hordeSize(n, this.party.length);
    this.leaderPending = n % ROUNDS_PER_AREA === 0;
    this.roundTotal = this.toSpawn + (this.leaderPending ? 1 : 0);
    this.spawnTimer = 1.5;
    this.criedThisRound.clear();
    this.deploy(); // revived (Max Revive, Pokémon Center) or newly caught Pokémon join in
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
      p.leap = null;
      p.leapY = 0;
      p.status = null;
      p.trapT = p.slowT = p.stunT = p.rageT = 0;
      if (!p.fainted) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
    }
    for (const p of this.projectiles) this.dropSprite(p.sprite);
    this.projectiles = [];
    this.clouds = [];
    this.later = [];
    this.aiming = -1;
    this.reticle.visible = false;
    this.preview.visible = false;

    const next = () => {
      this.ui.hideModal();
      // Finishing an area means a stop at the Pokémon Center before the next one.
      if (this.round % ROUNDS_PER_AREA === 0) return this.showCenter();
      this.state = 'playing';
      this.startRound(this.round + 1);
    };
    const cards: CardSpec[] = shuffle(REWARDS.filter((r) => !r.cond || r.cond(this)))
      .slice(0, 3)
      .map((o) => ({ title: o.title, icon: icon(url.item(o.item)), body: o.desc, onClick: () => (o.apply(this), void this.playEvolutions(MUSIC.victory).then(next)) }));
    // Stones only show up when someone can use one; an area's last round always offers one.
    const offers = this.stoneOffers();
    const show = () => this.ui.showModal(`Round ${this.round} cleared!`, '+2 Poké Balls, status cured and 35% HP restored. Pick a reward:', cards);
    if (offers.length && (this.round % ROUNDS_PER_AREA === 0 || Math.random() < 0.5)) cards[0] = this.stoneCard(pick(offers), next, show);
    // Pokémon that grew enough during the round evolve first, each with its full sequence.
    void this.playEvolutions(MUSIC.victory).then(show);
  }

  /** Between areas: Nurse Joy restores the whole party, fainted ones included. */
  private async showCenter() {
    this.state = 'center';
    for (const p of this.party) {
      p.fainted = false;
      p.hp = p.maxHp;
      p.status = null;
      p.trapT = p.slowT = 0;
      this.checkEvolution(p); // a Rare Candy may have pushed a fainted Pokémon past its level
    }
    await this.playEvolutions(MUSIC.center);
    audio.playMusic(MUSIC.center);
    setTimeout(() => this.state === 'center' && void audio.jingle(MUSIC.heal), 900);
    const area = biomeFor(this.round + 1).name;
    const go = () => {
      this.ui.hideModal();
      this.state = 'playing';
      this.startRound(this.round + 1);
    };
    this.ui.showModal(
      'Pokémon Center',
      `Your Pokémon are fighting fit! On to <b>${area}</b>.`,
      [{ title: `Head to ${area}`, icon: icon(url.item(`${this.ball}-ball`)), body: 'Your whole party comes out swinging.', onClick: go }],
      `${this.partySummary()}<div class="center-hero"><img class="pc" src="${icon(url.env('pokemonCenter'))}" alt="" /><img class="nurse" src="${icon(url.env('nurse'))}" alt="" /></div>`,
    );
  }

  private stoneOffers() {
    return this.party
      .filter((p) => !p.fainted && !this.evoQueue.some((e) => e.mon === p))
      .map((mon) => ({ mon, evos: (mon.sp.evos ?? []).filter((e) => e.stone && mon.level >= STONE_LEVEL[e.stone]) }))
      .filter((o) => o.evos.length);
  }

  private stoneCard({ mon, evos }: { mon: Mon; evos: Evo[] }, next: () => void, back: () => void): CardSpec {
    const evolveInto = (e: Evo) => () => {
      this.evolve(mon, SPECIES_BY_ID[e.to]);
      void this.playEvolutions(MUSIC.victory).then(next);
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
    this.preview.visible = false;
    this.evoQueue = [];
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
    // The team acknowledges the order: a low cry to stand down, a sharp one to attack.
    const lead = this.out.find((p) => p.alive);
    if (lead) void audio.cry(lead.sp.id, 0.5, this.hold ? 0.85 : 1.1);
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
    const due = this.later.filter((l) => (l.t -= dt) <= 0);
    this.later = this.later.filter((l) => l.t > 0);
    for (const l of due) l.fn();
    for (const m of [...this.out, ...this.wilds]) {
      if (m.act) this.tickAct(m, dt);
      if (m.alive) this.tickStatus(m, dt);
    }
    this.out.forEach((m, i) => this.updateParty(m, i, dt));
    for (const m of [...this.wilds]) if (m.alive) this.updateWild(m, dt);
    this.updateClouds(dt);
    this.separate();
    this.updateProjectiles(dt);
    this.updateBalls(dt);
    if (
      this.state === 'playing' && this.toSpawn === 0 && !this.leaderPending &&
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
      const team = this.party.length, cap = hordeCap(this.round, team);
      if (this.spawnTimer <= 0 && this.wilds.length < cap) {
        // Packs share a patch of grass: bunched up, and worth an area move.
        const pack = Math.min(this.toSpawn, cap - this.wilds.length, 1 + Math.floor(Math.random() * packMax(this.round)));
        const home = this.pickHome();
        for (let i = 0; i < pack; i++) this.spawnWild(false, home);
        this.toSpawn -= pack;
        this.spawnTimer = spawnGap(this.round, team) * (0.6 + 0.4 * pack);
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

  /** A patch of tall grass (or a cave hollow) away from the trainer. */
  private pickHome(): Zone {
    const tp = this.trainer.pos;
    const zones: Zone[] = this.arena?.userData.zones ?? [];
    const far = zones.filter((z) => Math.hypot(z.x - tp.x, z.z - tp.z) > AGGRO_R + z.r + 3);
    return pick(far.length ? far : zones.length ? zones : [{ x: 0, z: -12, r: 3 }]);
  }

  private spawnWild(leader: boolean, home = this.pickHome()) {
    // Each area has its own encounter table; evolved forms unlock later in the area.
    const stage = areaRound(this.round);
    const level = Math.min(100, wildLevel(this.round) + (leader ? LEADER_LEVELS : 0));
    const sp = leader ? this.leaderSpecies(level) : weightedPick(this.biome.wild.filter((e) => e.from <= stage), (e) => e.w).sp;
    const shiny = Math.random() < SHINY_ODDS;
    const m = new Mon(sp, level, 'wild', leader, shiny);
    this.refreshMusic();
    // Appear in its patch of grass and loiter there.
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

  private updateParty(m: Mon, slot: number, dt: number) {
    m.cd -= dt;
    m.moving = false;
    if (m.leap) return this.tickLeap(m, dt);
    if (m.disabled || this.windingUp(m)) return;
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
    if (m.target) {
      this.chargeUp(m, CHARGE.passive * dt);
      this.engage(m, m.target, dt, m.sp.speed * m.slowMul);
    } else {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.03 * dt); // catch breath out of combat
      // Fan out in an arc on the camera side of the trainer, so the team doesn't stack on one spot.
      const n = this.out.length, a = Math.PI / 2 + (slot - (n - 1) / 2) * 0.75;
      this.moveTo(m, tp.x + Math.cos(a) * FORMATION_R, tp.z + Math.sin(a) * FORMATION_R, m.sp.speed * 1.3, dt, 0.25);
    }
  }

  private updateWild(m: Mon, dt: number) {
    if (m.grow < 1) return;
    m.cd -= dt;
    m.moving = false;
    if (m.fuse > 0) return void ((m.fuse -= dt) <= 0 && this.explode(m));
    if (m.disabled || this.windingUp(m)) return;
    if (m.sp.boom && m.aggro && m.hp < m.maxHp * BOOM.hp) return this.lightFuse(m);
    if (!m.aggro) {
      const near = distXZ(m.pos, this.trainer.pos) < AGGRO_R || this.out.some((p) => p.alive && distXZ(m.pos, p.pos) < AGGRO_R) || m.hp < m.maxHp;
      if (!near) return this.loiter(m, dt);
      this.alert(m);
    }
    m.retarget -= dt;
    if (!m.target || !this.valid(m.target) || m.retarget <= 0) {
      m.retarget = 1 + Math.random();
      // Only Pokémon battle: wild ones go for the nearest of your Pokémon, never the trainer.
      m.target = this.nearest(m.pos, this.out.filter((p) => p.alive));
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
    return u.alive && (u.side === 'wild' ? this.wilds.includes(u) : this.out.includes(u));
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
    for (const p of this.out) if (p.alive && !p.leap) units.push({ p: p.pos, r: p.radius, w: 1 });
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
    m.cd = m.sp.cooldown * (m.side === 'wild' ? WILD_TEMPO : 1.1) * rand(0.9, 1.1) * (m.status === 'par' ? 1.5 : 1) * (m.rageT > 0 ? 0.5 : 1);
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
    if (!m.alive) return void (m.act = null); // caught or fainted mid-wind-up
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
    if (h.dmg > 0) h.dmg = Math.max(1, Math.round(h.dmg * this.powerMul(m)));
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
        this.fx.spawn(mv.end ?? 'electroball', to, { size: mv.size * (mv.kind === 'bolt' ? 1.1 : 1.2), grow: 0.3 });
        if (mv.kind === 'bolt') this.shake = Math.max(this.shake, 0.2);
        this.land(t, h, m, mv, m.pos, 0.2);
        break;
      }
      case 'melee':
        this.fx.spawn(mv.fx, mid(t), { size: mv.size, grow: 0.3, rotation: rand(-0.3, 0.3), ...fxOpts });
        if (mv.end) this.fx.spawn(mv.end, mid(t), { size: mv.size * 0.9, delay: 0.1 });
        this.land(t, h, m, mv, m.pos, 0.45);
        break;
      case 'burst':
        this.fx.spawn(mv.fx, mid(t), { size: mv.size * 0.5, life: 0.45, grow: 1.2, ...fxOpts });
        this.land(t, h, m, mv, m.pos, 0.2);
        break;
      case 'quake': {
        // Shockwave under the target plus debris thrown outward.
        const ground = t.pos.clone().setY(0.25);
        this.fx.spawn(mv.end ?? 'impact', ground, { size: mv.size * 1.3, grow: 0.5, ...(mv.end ? {} : { life: 0.35, color: mv.tint ?? 0xe0c080 }) });
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
      this.fx.tick(p.sprite, p.t);
      if (f < 1) return true;
      if (p.real) {
        if (p.mv.end) this.fx.spawn(p.mv.end, p.sprite.position, { size: p.mv.size * 1.4 });
        else this.fx.spawn('impact', p.sprite.position, { size: 0.6, life: 0.15, grow: 0.4 });
        this.land(p.target, p.hit, p.src, p.mv, p.start, 0.2);
      }
      this.dropSprite(p.sprite);
      return false;
    });
  }

  private dropSprite(s: THREE.Sprite) {
    this.fx.drop(s);
  }

  /** A move connects: damage, then its secondary effects (status, bind, drain, recoil). */
  private land(t: Mon, h: Hit, src: Mon, mv: Move, from: THREE.Vector3, knock: number) {
    if (!this.valid(t)) return;
    if (mv.aoe) this.splash(src, t.pos.clone(), mv, t);
    if (h.mult === 0) return this.hit(t, 0, 0);
    if (src.side === 'party') {
      t.lastHitBy = src;
      if (h.dmg > 0) this.chargeUp(src, (CHARGE.hit * Math.min(h.dmg, t.hp)) / t.maxHp + 0.02);
    }
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

  /** An area move's spread: everything else of the target's side near where it landed takes SPLASH of the damage. */
  private splash(src: Mon, c: THREE.Vector3, mv: Move, skip: Mon) {
    const r = mv.aoe!;
    this.fx.ring(c, r, TYPE_COLOR[mv.type]);
    for (const e of [...(src.side === 'party' ? this.wilds : this.out)]) {
      if (e === skip || !e.alive || distXZ(e.pos, c) > r + e.radius) continue;
      const h = damage(src, e, mv);
      if (h.mult === 0 || h.dmg <= 0) continue;
      if (src.side === 'party') e.lastHitBy = src;
      this.hit(e, Math.max(1, Math.round(h.dmg * this.powerMul(src) * SPLASH)), h.mult, c, 0.35, h.crit);
      if (e.alive && mv.status && Math.random() < mv.status[1]) this.inflict(e, mv.status[0]);
    }
  }

  /** Damage multiplier on top of the formula: X Attack and Outrage for your team, the early-game ease-in for wild ones. */
  private powerMul(m: Mon) {
    return (m.side === 'party' ? this.partyAtkMul : wildPower(this.round)) * (m.rageT > 0 ? 1.5 : 1);
  }

  private inflict(t: Mon, st: Status) {
    if (t.status || !t.alive) return;
    if (t.side === 'party' && this.statusImmune) return;
    // Type immunities from the games: Poison types can't be poisoned, Fire types can't be burned, Electric can't be
    // paralyzed, and (as of X/Y) Grass types shrug off powders, so Sleep Powder doesn't work on them.
    const immune: Record<Status, PType> = { psn: 'poison', brn: 'fire', par: 'electric', slp: 'grass' };
    if (t.sp.type === immune[st] || t.sp.type2 === immune[st]) return;
    t.status = st;
    t.statusTick = 1;
    if (st === 'slp') {
      t.sleepT = rand(...SLEEP_TIME);
      t.act = null;
      if (t.side === 'wild') this.hint('sleep', 'Sleeping Pokémon can\u2019t fight back and are twice as easy to catch. Hold fire (F) and throw!');
    }
    const info = STATUS_INFO[st];
    this.floater(t.pos, t.height + 0.5, info.label, info.css);
    if (t.side === 'party') this.ui.toast(`${t.sp.name} ${info.verb}!`, 'warn');
    else if (st !== 'slp') this.hint('status', 'Status conditions (poison, burn, paralysis) also make wild Pokémon 1.5× easier to catch.');
  }

  /** Poison/burn chip damage and bind damage. Neither can knock a Pokémon out on its own (it stops at 1 HP). */
  private tickStatus(m: Mon, dt: number) {
    m.slowT -= dt;
    m.stunT -= dt;
    m.rageT -= dt;
    if (m.status === 'slp' && (m.sleepT -= dt) <= 0) {
      m.status = null;
      this.floater(m.pos, m.height + 0.4, 'Woke up!', '#c8d0ff');
    }
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
    if (t.side === 'party') {
      t.hurtT = 0.3;
      this.chargeUp(t, (CHARGE.hurt * dmg) / t.maxHp);
    } else {
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
    m.act = null;
    this.out.splice(this.out.indexOf(m), 1); // it shrinks back into its ball in animate()
    void audio.cry(m.sp.id, 0.5, 0.85);
    this.ui.toast(`${m.sp.name} fainted!`, 'bad');
    if (this.party.every((p) => p.fainted)) return this.gameOver('Your whole party fainted!');
    // Don't leave the field empty because the rest were recalled: the last one standing comes out.
    if (!this.out.length) this.deploy(true);
  }

  private grantXp(w: Mon) {
    for (const p of this.party) {
      if (p.fainted || p.level >= 100) continue;
      p.xp += expGain(w, p.level, p === w.lastHitBy ? 1 : EXP_SHARE_BENCH);
      while (p.level < 100 && p.xp >= expAt(p.sp.growth, p.level + 1)) this.levelUp(p);
    }
  }

  /** Fills a Pokémon's special meter, announcing it the moment it's full. */
  private chargeUp(m: Mon, amt: number) {
    if (m.side !== 'party' || m.charge >= 1) return;
    m.charge = Math.min(1, m.charge + amt);
    if (m.charge < 1) return;
    const sp = SPECIALS[m.sp.type];
    const slot = this.party.indexOf(m) + 1;
    if (this.out.includes(m)) this.floater(m.pos, m.height + 0.8, `${sp.name} ready!`, hex(TYPE_COLOR[m.sp.type]), true);
    audio.shiny();
    this.hint('special', `${m.sp.name}'s special is charged! Hold ${slot} to aim ${sp.name} at the cursor and let go to unleash it.`);
  }

  levelUp(p: Mon) {
    if (p.level >= 100) return;
    p.level++;
    p.xp = Math.max(p.xp, expAt(p.sp.growth, p.level));
    const old = p.maxHp;
    p.recalc();
    if (!p.fainted) p.hp += p.maxHp - old;
    audio.levelUp();
    if (this.out.includes(p)) this.floater(p.pos, p.height + 0.5, 'Lv up!', '#7dffa0');
    this.checkEvolution(p);
  }

  private checkEvolution(p: Mon) {
    const evo = p.sp.evos?.find((e) => e.level !== undefined && p.level >= e.level);
    if (evo) this.evolve(p, SPECIES_BY_ID[evo.to]);
  }

  /** Queues an evolution. In battle it waits for the round to end; playEvolutions() runs the queue. */
  evolve(p: Mon, to: Species) {
    if (this.evoQueue.some((e) => e.mon === p)) return;
    this.evoQueue.push({ mon: p, to });
    if (this.state !== 'playing') return;
    this.ui.toast(`${p.sp.name} is ready to evolve!`, 'good');
    if (this.out.includes(p)) this.fx.sparkle(mid(p), 8, 0.4);
    this.hint('evolve-later', 'Pokémon that are ready to evolve do it when the round is cleared.');
  }

  /** Plays every queued evolution, one after the other, then puts `resume` back on. */
  private async playEvolutions(resume?: string) {
    if (!this.evoQueue.length) return;
    while (this.evoQueue.length) {
      const { mon, to } = this.evoQueue.shift()!;
      if (!this.party.includes(mon) || mon.sp === to) continue; // released in the meantime
      const from = mon.sp;
      await this.ui.evolution({
        from: from.name,
        to: to.name,
        fromIcon: icon(url.front(from.dex, mon.shiny)),
        toIcon: icon(url.front(to.dex, mon.shiny)),
        onStart: () => {
          audio.playMusic(MUSIC.evolving);
          void audio.cry(from.id, 0.7);
        },
        onDone: () => {
          this.finishEvolution(mon, to);
          void audio.jingle(MUSIC.evolved);
          setTimeout(() => void audio.cry(to.id, 0.7), 300);
        },
      });
    }
    if (resume) audio.playMusic(resume);
  }

  private finishEvolution(m: Mon, to: Species) {
    m.setSpecies(to);
    m.xp = Math.max(m.xp, expAt(m.sp.growth, m.level));
    register(m.sp.id, m.shiny);
    m.flash = 0.25;
    this.hint('evolved', `Evolved Pokémon are tougher and learn a new move — ${m.sp.name} now uses ${m.sp.move.name}.`);
    this.checkEvolution(m); // Rare Candy can push past two thresholds
  }

  /** Sends `m` out next to the trainer (or at `at`, where it was just caught) to join the fight. */
  private sendOut(m: Mon, quiet = false, at?: THREE.Vector3) {
    if (this.out.includes(m) || m.fainted || !this.party.includes(m)) return;
    this.benched.delete(m);
    this.out.push(m);
    const tp = this.trainer.pos;
    if (at) m.pos.copy(at).setY(0);
    else m.pos.set(tp.x + rand(-1.5, 1.5), 0, tp.z + rand(0.8, 1.8));
    this.clampArena(m.pos);
    m.act = null;
    m.target = null;
    m.grow = 0;
    m.capScale = 1;
    m.cd = 0.5;
    this.scene.add(m.obj);
    if (quiet) return;
    this.fx.sparkle(mid(m), 6);
    this.floater(m.pos, m.height + 0.7, `Go! ${m.sp.name}!`, '#ffffff');
    void audio.cry(m.sp.id, 0.5);
  }

  private recall(m: Mon) {
    const i = this.out.indexOf(m);
    if (i < 0) return;
    this.out.splice(i, 1);
    this.benched.add(m);
    m.act = null;
    m.target = null;
    this.fx.spawn('shine', mid(m), { size: 1.2, life: 0.3, grow: -0.6, color: 0xff6060 });
    m.obj.removeFromParent();
  }

  /** Everyone who can battle and hasn't been recalled comes out. `force` brings out recalled ones too. */
  private deploy(force = false) {
    if (force) this.benched.clear();
    for (const p of this.party) if (!p.fainted && !this.benched.has(p)) this.sendOut(p, true);
  }

  /** Number keys / party cards: recall a Pokémon to its ball, or send it back out. */
  toggleOut(i: number) {
    const m = this.party[i];
    if (this.state !== 'playing' || !m || this.switchCd > 0) return;
    if (m.fainted) return this.ui.toast(`${m.sp.name} has no energy left to battle!`, 'bad');
    this.switchCd = SWITCH_CD;
    if (!this.out.includes(m)) return this.sendOut(m);
    if (this.out.length === 1) return this.ui.toast(`${m.sp.name} is the only one left battling!`, 'warn');
    this.recall(m);
    this.floater(m.pos, m.height + 0.7, `${m.sp.name}, come back!`, '#ff9a9a');
    this.hint('recall', 'Recalled Pokémon sit out safely but still earn half experience. Click the card again to send it back out.');
  }

  revive(p: Mon, frac: number) {
    p.fainted = false;
    p.hp = Math.round(p.maxHp * frac);
    this.checkEvolution(p); // may have passed a threshold via Rare Candy while fainted
  }

  private addToParty(m: Mon, at?: THREE.Vector3) {
    this.party.push(m);
    // A fresh catch pops right back out of its ball and joins the brawl.
    if (this.state === 'playing') this.sendOut(m, this.party.length === 1, at);
    if (this.party.length > 1) {
      this.ui.toast(`${m.sp.name} joined the fight!`, 'info');
      this.hint('switch', 'Your whole party battles at once. Press 1-6 (or click a card) to recall one to safety.');
    }
    const stones = (m.sp.evos ?? []).filter((e) => e.stone).map((e) => STONE_NAME[e.stone!]);
    const from = Math.min(...(m.sp.evos ?? []).filter((e) => e.stone).map((e) => STONE_LEVEL[e.stone!]));
    if (stones.length) this.hint('stone', `${m.sp.name} evolves with a ${stones.join(' / ')} — watch for it in round rewards from Lv${from}.`);
  }

  // ───────────────────────────── specials ─────────────────────────────

  /** Number key down: start aiming that Pokémon's special (a ring previews where it lands). */
  private beginAim(i: number) {
    const m = this.party[i];
    if (this.state !== 'playing' || !m) return;
    const sp = SPECIALS[m.sp.type];
    if (m.fainted || !this.out.includes(m)) return this.ui.toast(`${m.sp.name} isn't out battling.`, 'bad');
    if (m.charge < 1) return this.ui.toast(`${m.sp.name}'s ${sp.name} is ${Math.floor(m.charge * 100)}% charged.`, 'info');
    this.aiming = i;
    audio.ui();
  }

  /** Number key up: fire the special being aimed. */
  private unleash() {
    const m = this.party[this.aiming];
    this.aiming = -1;
    if (this.state !== 'playing' || !m || !this.out.includes(m) || !m.alive || m.charge < 1 || m.leap) return;
    m.charge = 0;
    this.fireSpecial(m, SPECIALS[m.sp.type], this.aim.clone());
  }

  /** Where the aimed special would land, and how big it is. */
  private updatePreview() {
    const m = this.party[this.aiming];
    const sp = m && SPECIALS[m.sp.type];
    this.preview.visible = !!sp && this.state === 'playing';
    if (!sp) return;
    const self = sp.aim === 'self' || sp.aim === 'rage';
    const at = self ? m.pos : this.aim;
    this.preview.position.set(at.x, 0.08, at.z);
    this.preview.scale.setScalar(sp.aim === 'line' ? 1 : sp.r);
    this.preview.material.color.setHex(TYPE_COLOR[sp.move.type]);
    this.preview.material.opacity = 0.55 + 0.3 * Math.sin(this.time * 10);
  }

  private foesOf(m: Mon) {
    return (m.side === 'party' ? this.wilds : this.out).filter((u) => u.alive);
  }

  private fireSpecial(m: Mon, sp: Special, at: THREE.Vector3) {
    at.y = 0;
    const color = hex(TYPE_COLOR[sp.move.type]);
    this.floater(m.pos, m.height + 0.9, `${m.sp.name} used ${sp.name}!`, color, true);
    void audio.cry(m.sp.id, 0.6, 1.1);
    audio.move(sp.move.type, sp.move.kind);
    m.act = null;
    m.target = null;
    const dir = new THREE.Vector3(at.x - m.pos.x, 0, at.z - m.pos.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    m.face(dir.x, dir.z);
    switch (sp.aim) {
      case 'cursor':
        this.fillArea(sp, at);
        this.after(sp.rain ? 0.4 : 0.1, () => this.blast(m, sp, at));
        break;
      case 'self':
      case 'rage':
        this.fillArea(sp, m.pos.clone());
        this.blast(m, sp, m.pos.clone());
        if (sp.rage) m.rageT = sp.rage;
        break;
      case 'line': {
        // Hyper Beam: a stream of orbs through everything in the way.
        const from = mid(m), len = 11;
        for (let i = 1; i <= 16; i++) {
          const p = from.clone().addScaledVector(dir, (i / 16) * len);
          this.fx.spawn(sp.move.fx, p, { size: sp.move.size, life: 0.5, grow: 0.5, color: sp.move.tint, delay: i * 0.012 });
        }
        for (const e of this.foesOf(m)) {
          const rel = e.pos.clone().sub(m.pos);
          const along = rel.dot(dir);
          if (along < 0 || along > len || rel.addScaledVector(dir, -along).length() > sp.r + e.radius) continue;
          this.after(along * 0.012 * (16 / len), () => this.strike(m, sp, e, m.pos));
        }
        if (sp.recharge) m.stunT = sp.recharge;
        this.shake = Math.max(this.shake, 0.3);
        break;
      }
      case 'chain': {
        // Thunder: the foes nearest the cursor, struck one after another.
        const hit = this.foesOf(m)
          .filter((e) => distXZ(e.pos, at) < sp.r)
          .sort((a, b) => distXZ(a.pos, at) - distXZ(b.pos, at))
          .slice(0, sp.hits ?? 1);
        if (!hit.length) this.fx.spawn(sp.move.fx, at.clone().setY(2), { size: sp.move.size * 2.5 });
        hit.forEach((e, i) =>
          this.after(i * 0.14, () => {
            if (!e.alive) return;
            for (let k = 0; k < 3; k++) this.fx.spawn(sp.move.fx, mid(e).setY(0.8 + k * 1.6), { size: sp.move.size * 1.4, rotation: rand(-0.2, 0.2) });
            this.shake = Math.max(this.shake, 0.2);
            this.strike(m, sp, e, at);
          }),
        );
        break;
      }
      case 'leap': {
        // Fly lands on the cursor; Focus Punch homes in on the foe nearest it.
        const foe = sp.move.type === 'fighting' ? this.nearest(at, this.foesOf(m).filter((e) => distXZ(e.pos, at) < 3)) : null;
        const to = foe ? foe.pos.clone().addScaledVector(dir, -(foe.radius + m.radius)) : at.clone();
        this.clampArena(to);
        m.leap = {
          from: m.pos.clone(), to, t: 0, dur: 0.5,
          land: () => {
            this.fx.spawn(sp.move.fx, mid(m), { size: sp.move.size, grow: 0.4 });
            this.blast(m, sp, foe?.alive ? foe.pos.clone() : m.pos.clone());
          },
        };
        break;
      }
    }
  }

  /** Sprites filling a special's area: dropped from the sky for Blizzard and co., blooming in place otherwise. */
  private fillArea(sp: Special, c: THREE.Vector3) {
    const n = sp.n ?? 1, size = sp.move.size;
    if (n === 1) return this.fx.spawn(sp.move.fx, c.clone().setY(1), { size: size, life: 0.7, grow: 0.3, color: sp.move.tint });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * sp.r * 0.85;
      const p = c.clone().add(new THREE.Vector3(Math.cos(a) * d, 0.5, Math.sin(a) * d));
      if (sp.rain) this.fx.spawn(sp.move.fx, p.clone().setY(6), { size, life: 0.45, color: sp.move.tint, vel: new THREE.Vector3(0, -12, 0), delay: i * 0.025, spin: rand(-4, 4) });
      else this.fx.spawn(sp.move.fx, p, { size, color: sp.move.tint, delay: i * 0.04, grow: 0.2 });
    }
  }

  /** A special lands at `c`: every foe in range is struck, a shockwave rings out, and Poison Gas leaves its cloud. */
  private blast(m: Mon, sp: Special, c: THREE.Vector3) {
    this.fx.ring(c, sp.r, TYPE_COLOR[sp.move.type], 0.5);
    this.shake = Math.max(this.shake, sp.r > 4 ? 0.45 : 0.25);
    for (const e of this.foesOf(m)) if (distXZ(e.pos, c) < sp.r + e.radius) this.strike(m, sp, e, c);
    if (sp.cloud) this.clouds.push({ pos: c.clone(), r: sp.r, t: sp.cloud, tick: 0.5, src: m, sp });
  }

  /** One foe takes a special: damage (unless it's pure status), then its effects. */
  private strike(m: Mon, sp: Special, e: Mon, from: THREE.Vector3) {
    if (!this.valid(e)) return;
    const h = damage(m, e, sp.move);
    if (h.mult === 0 && (sp.move.power > 0 || sp.move.fixed !== undefined)) return this.hit(e, 0, 0);
    if (m.side === 'party') e.lastHitBy = m;
    if (sp.move.end) this.fx.spawn(sp.move.end, mid(e), { size: Math.max(1.2, e.radius * 2.4) });
    if (h.dmg > 0) this.hit(e, Math.max(1, Math.round(h.dmg * this.powerMul(m))), h.mult, from, sp.knock ?? 0.4, h.crit);
    else if (sp.knock) this.knockback(e, from, sp.knock);
    if (!e.alive) return;
    if (e.side === 'wild' && h.dmg > 0) this.alert(e);
    if (sp.status && Math.random() < sp.status[1]) this.inflict(e, sp.status[0]);
    if (sp.trap) {
      e.trapT = TRAP_TIME;
      this.floater(e.pos, e.height + 0.4, sp.move.type === 'ice' ? 'Frozen!' : 'Trapped!', hex(TYPE_COLOR[sp.move.type]));
    }
    if (sp.slow) e.slowT = SLOW_TIME;
    if (sp.stun) {
      e.stunT = Math.max(e.stunT, sp.stun);
      e.act = null;
    }
  }

  private after(t: number, fn: () => void) {
    this.later.push({ t, fn });
  }

  /** Fly / Focus Punch in the air: an arc from where it took off to where it lands. */
  private tickLeap(m: Mon, dt: number) {
    const l = m.leap!;
    l.t += dt;
    const f = Math.min(1, l.t / l.dur);
    m.pos.lerpVectors(l.from, l.to, f);
    m.leapY = Math.sin(Math.PI * f) * 3;
    if (Math.random() < 0.5) this.fx.spawn('wisp', mid(m).setY(m.leapY + 0.5), { size: 0.7, life: 0.3, grow: 0.5, color: 0xdddddd });
    if (f < 1) return;
    m.leap = null;
    m.leapY = 0;
    l.land();
  }

  private updateClouds(dt: number) {
    this.clouds = this.clouds.filter((c) => {
      c.t -= dt;
      if ((c.tick -= dt) <= 0) {
        c.tick = 0.5;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r;
          this.fx.spawn('gray_smoke', c.pos.clone().add(new THREE.Vector3(Math.cos(a) * d, 0.5, Math.sin(a) * d)), { size: 1.6, color: c.sp.move.tint, grow: 0.4 });
        }
        for (const e of this.foesOf(c.src)) if (distXZ(e.pos, c.pos) < c.r + e.radius && c.sp.status) this.inflict(e, c.sp.status[0]);
      }
      return c.t > 0;
    });
  }

  // ───────────────────────────── explosions ─────────────────────────────

  /** A Voltorb, Geodude or Koffing in trouble: it stops, flashes and swells, then blows up. */
  private lightFuse(m: Mon) {
    m.fuse = BOOM.fuse;
    m.act = null;
    m.target = null;
    this.floater(m.pos, m.height + 0.6, '!!', '#ff3b30', true);
    this.fx.ring(m.pos, BOOM.r, 0xff3020, BOOM.fuse, true);
    void audio.cry(m.sp.id, 0.6, 1.3);
    this.hint('boom', `${m.sp.name} is about to explode! Get your Pokémon clear (click a card to recall one), or knock it out or catch it before it blows.`);
  }

  /** Explosion: hits everything within BOOM.r, wild Pokémon included, and the user faints. */
  private explode(m: Mon) {
    if (!this.wilds.includes(m) || !m.alive) return; // caught (or caught up in another blast) in the meantime
    m.fuse = 0;
    const c = m.pos.clone();
    this.fx.spawn('explosion_2', c.clone().setY(1.2), { size: 5, grow: 0.3 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.fx.spawn('explosion', c.clone().add(new THREE.Vector3(Math.cos(a) * BOOM.r * 0.6, 0.6, Math.sin(a) * BOOM.r * 0.6)), { size: 2.2, delay: 0.05 + i * 0.03 });
    }
    this.fx.ring(c, BOOM.r, 0xffa040, 0.5);
    this.shake = Math.max(this.shake, 0.7);
    audio.move('normal', 'quake');
    audio.strong();
    m.hp = 0;
    this.faint(m);
    for (const u of [...this.out, ...this.wilds]) {
      if (!u.alive || distXZ(u.pos, c) > BOOM.r + u.radius) continue;
      const h = damage(m, u, MOVES.explosion);
      if (h.mult === 0) continue;
      this.hit(u, Math.max(1, Math.round(h.dmg * wildPower(this.round) * BOOM.mul)), h.mult, c, 1.8, h.crit);
    }
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
    if (this.party.length < PARTY_MAX) this.addToParty(nm, at);
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
            if (this.out.includes(p)) this.out.splice(this.out.indexOf(p), 1);
            this.benched.delete(p);
            p.dispose();
            this.party[i] = nm;
            resume();
            this.sendOut(nm);
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
    this.updatePreview();
    // Fainted Pokémon stay in the scene until they've shrunk back into their ball.
    for (const p of this.party) {
      if (!p.obj.parent) continue;
      this.animateMon(p, dt);
      if (p.fainted && p.capScale < 0.01) p.obj.removeFromParent();
    }
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
    // A lit fuse swells the sprite; Psychic's hold lifts it off the ground.
    const swell = m.fuse > 0 ? 1 + 0.25 * (1 - m.fuse / BOOM.fuse) : 1;
    const lift = m.stunT > 0 && m.status !== 'slp' ? 0.3 + 0.1 * Math.sin(m.anim * 5) : 0;
    m.sprite.position.set((dir?.x ?? 0) * pose.fwd + pose.jx, hover + hop - sink + pose.up + m.leapY + lift, (dir?.y ?? 0) * pose.fwd);
    m.sprite.scale.set((m.viewW * s * pose.grow * swell) / Math.sqrt(squash), m.viewH * s * pose.grow * swell * squash, 1);
    m.sprite.visible = s > 0.01;
    m.shadow.visible = s > 0.05;

    // Tint priority: hit flash > lit fuse > red capture beam > move charge > rampage > status > normal.
    if (m.flash > 0) m.mat.color.setScalar(5);
    else if (m.fuse > 0) m.mat.color.setScalar(Math.sin(this.time * (14 + 40 * (1 - m.fuse / BOOM.fuse))) > 0 ? 4 : 1);
    else if (m.capturing) m.mat.color.setRGB(3, 0.5, 0.5);
    else if (pose.glow > 0) m.mat.color.setScalar(1).lerp(this.tmpColor.setHex(m.act!.color).multiplyScalar(2.2), pose.glow);
    else if (m.rageT > 0) m.mat.color.setRGB(1.6 + 0.4 * Math.sin(this.time * 12), 0.7, 0.7);
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
    if (m.status === 'slp' && m.alive && Math.random() < dt * 1.6) {
      this.fx.spawn('z', mid(m).setY(top + 0.2), { size: 0.5, life: 1.1, vel: new THREE.Vector3(0.3, 0.8, 0) });
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
        evolving: this.evoQueue.some((e) => e.mon === p),
        charge: p.charge,
        special: SPECIALS[p.sp.type].name,
        specialColor: hex(TYPE_COLOR[p.sp.type]),
        evoLevel: p.sp.evos?.find((e) => e.level)?.level,
        evoStones: (p.sp.evos ?? []).filter((e) => e.stone).map((e) => icon(url.item(e.stone!))),
        benched: this.benched.has(p),
      })),
    );
  }
}
