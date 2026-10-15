export type PType =
  | 'normal' | 'fire' | 'water' | 'grass' | 'electric' | 'ice' | 'fighting' | 'poison'
  | 'ground' | 'flying' | 'psychic' | 'bug' | 'rock' | 'ghost' | 'dragon';

export const TYPE_COLOR: Record<PType, number> = {
  normal: 0xa8a878,
  fire: 0xf08030,
  water: 0x6890f0,
  grass: 0x78c850,
  electric: 0xf8d030,
  ice: 0x98d8d8,
  fighting: 0xc03028,
  poison: 0xa040a0,
  ground: 0xe0c068,
  flying: 0xa890f0,
  psychic: 0xf85888,
  bug: 0xa8b820,
  rock: 0xb8a038,
  ghost: 0x705898,
  dragon: 0x7038f8,
};

// Attacker -> defender multipliers (the modern chart, minus Dark/Steel/Fairy). Anything not listed is 1x.
const CHART: Partial<Record<PType, Partial<Record<PType, number>>>> = {
  normal: { rock: 0.5, ghost: 0 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2 },
  ghost: { normal: 0, psychic: 2, ghost: 2 },
  dragon: { dragon: 2 },
};

export function typeMult(attacker: PType, defender: PType): number {
  return CHART[attacker]?.[defender] ?? 1;
}

/** Effectiveness against a (possibly dual-typed) species. */
export function typeMultVs(attacker: PType, sp: Species): number {
  return typeMult(attacker, sp.type) * (sp.type2 ? typeMult(attacker, sp.type2) : 1);
}

export const typeLabel = (sp: Species) => (sp.type2 ? `${sp.type}/${sp.type2}` : sp.type);

/**
 * How a move is drawn (the attacker also plays a matching wind-up animation, see Mon.act):
 * shot  – fx sprite(s) fly to the target (`count` staggered, optional `arc`)
 * spray – a fast stream of small fx sprites
 * beam  – instant crackling chain from attacker to target
 * melee – attacker winds up and lunges, fx sprite slams onto the target
 * burst – fx sprite blooms on the target
 * quake – attacker jumps and stomps; a shockwave and debris erupt under the target
 * drop  – fx sprites rain down onto the target from above
 * bolt  – a lightning column strikes the target from the sky
 */
export type MoveKind = 'shot' | 'spray' | 'beam' | 'melee' | 'burst' | 'quake' | 'drop' | 'bolt';

export type Category = 'physical' | 'special';
/**
 * Major status conditions: poison and burn chip HP (burn also halves physical damage), paralysis halves speed, sleep
 * stops a Pokémon in its tracks for a few seconds (and doubles the odds of catching it).
 */
export type Status = 'psn' | 'brn' | 'par' | 'slp';

export interface Move {
  name: string;
  type: PType;
  cat: Category;
  power: number; // real base power; multi-hit moves store their average total (Pin Missile 25 × ~3 = 75)
  kind: MoveKind;
  fx: string; // FireRed battle-anim sheet (ANIMS) or Showdown battle-fx sprite name
  size: number;
  count?: number;
  spin?: boolean;
  arc?: number;
  tint?: number; // multiplies the fx sprite colour
  end?: string; // fx sprite that blooms where the move lands
  cd?: number; // cooldown multiplier for heavy hitters
  // Battle effects, as in the main games
  highCrit?: boolean; // 1/8 crit chance instead of 1/24
  status?: [Status, number]; // inflicts a status with this chance
  drain?: number; // heals this fraction of the damage dealt
  recoil?: number; // attacker takes this fraction of the damage dealt
  fixed?: number | 'level'; // fixed damage (Dragon Rage, Night Shade)
  vsDef?: boolean; // special move that hits physical Defense (Psystrike)
  trap?: boolean; // binds the target: it can't move and loses HP for a few seconds
  slow?: boolean; // String Shot: halves the target's speed for a few seconds
  aoe?: number; // also hits everything else within this radius of the target, for SPLASH of the damage
}

/**
 * FireRed's battle-animation sprite sheets (pret/pokefirered graphics/battle_anims/sprites), the same art the game
 * draws its moves with. Each is a vertical strip of `n` frames of `w`×`h` pixels, colour 0 transparent. `loop` sheets
 * cycle while they fly (flames, spinning bones); the rest play once where they're spawned. `pal` swaps in one of the
 * game's alternate palettes (Sleep Powder is Poison Powder in green).
 */
export interface AnimDef {
  file: string;
  w: number;
  h: number;
  n: number;
  loop?: boolean;
  fps?: number;
  pal?: string;
}
const a = (file: string, w: number, h: number, n: number, extra: Partial<AnimDef> = {}): AnimDef => ({ file, w, h, n, ...extra });
export const ANIMS: Record<string, AnimDef> = {
  fire: a('fire', 32, 32, 8, { loop: true }),
  small_ember: a('small_ember', 32, 32, 5, { loop: true }),
  fire_plume: a('fire_plume', 32, 32, 5),
  spinning_fire: a('spinning_fire', 32, 32, 4, { loop: true }),
  explosion: a('explosion', 32, 32, 4),
  explosion_2: a('explosion_2', 32, 32, 6),
  explosion_4: a('explosion_4', 32, 32, 5),
  hit: a('hit', 32, 32, 5),
  punch_impact: a('punch_impact', 32, 32, 1),
  slam_hit: a('slam_hit', 32, 32, 8),
  cut: a('cut', 32, 32, 4),
  slash: a('slash', 32, 32, 4),
  scratch: a('scratch', 32, 32, 5),
  fang_attack: a('fang_attack', 32, 32, 4),
  sharp_teeth: a('sharp_teeth', 64, 64, 1),
  clamp: a('clamp', 64, 64, 1),
  horn_hit: a('horn_hit', 32, 32, 1),
  red_fist: a('red_fist', 32, 32, 1),
  humanoid_foot: a('humanoid_foot', 32, 32, 1),
  cross_impact: a('cross_impact', 32, 32, 1),
  bubble: a('bubble', 16, 16, 3),
  water_droplet: a('water_droplet', 32, 32, 8),
  water_droplet_2: a('water_droplet_2', 32, 32, 5),
  water_impact: a('water_impact', 32, 32, 1),
  water_orb: a('water_orb', 16, 16, 4, { loop: true }),
  splash: a('splash', 64, 64, 1),
  lightning: a('lightning', 32, 32, 5),
  shock: a('shock', 32, 32, 6),
  electricity: a('electricity', 32, 32, 4),
  spark_h: a('spark_h', 32, 16, 2, { loop: true }),
  ice_chunk: a('ice_chunk', 32, 32, 5),
  ice_crystals: a('ice_crystals_0', 16, 16, 1),
  icicle_spear: a('icicle_spear', 32, 32, 1),
  rainbow_rings: a('rainbow_rings', 8, 8, 6, { loop: true }),
  razor_leaf: a('razor_leaf', 32, 16, 1),
  leaf: a('leaf', 16, 16, 9, { loop: true }),
  petal: a('petal', 16, 16, 7, { loop: true }),
  vine: a('vine', 32, 32, 5),
  orbs: a('orbs', 16, 16, 3, { loop: true }),
  bluegreen_orb: a('bluegreen_orb', 16, 16, 1),
  green_star: a('green_star', 16, 16, 4),
  sleep_powder: a('poison_powder', 8, 8, 16, { loop: true, pal: 'sleep_powder' }),
  poison_bubble: a('poison_bubble', 16, 16, 3),
  toxic_bubble: a('toxic_bubble', 16, 16, 8),
  rocks: a('rocks', 32, 32, 6),
  flat_rock: a('flat_rock', 16, 16, 5),
  mud: a('mud_unk', 16, 16, 4),
  bone: a('bone', 32, 32, 1),
  bone_spin: a('bone_2', 32, 32, 4, { loop: true }),
  gust: a('gust', 32, 32, 2, { loop: true }),
  air_wave: a('air_wave', 32, 16, 1),
  air_slash: a('air_slash', 16, 16, 3),
  shadow_ball: a('shadow_ball', 32, 32, 1),
  lick: a('lick', 16, 16, 10),
  ghostly_spirit: a('ghostly_spirit', 32, 32, 1),
  purple_flame: a('purple_flame', 16, 16, 8, { loop: true }),
  blue_flames: a('blue_flames', 32, 32, 2, { loop: true }),
  needle: a('needle', 16, 16, 1),
  string: a('string', 64, 32, 1),
  spider_web: a('spider_web', 64, 64, 1),
  yellow_star: a('yellow_star', 32, 32, 1),
  coin: a('coin', 16, 16, 4, { loop: true }),
  egg: a('large_fresh_egg', 16, 16, 1),
  tri_attack: a('tri_attack_triangle', 64, 64, 1),
  circle_of_light: a('circle_of_light', 64, 64, 1),
  thin_ring: a('thin_ring', 64, 64, 1),
  spiral: a('spiral', 64, 64, 1),
  gray_smoke: a('gray_smoke', 32, 32, 5),
  z: a('z', 16, 16, 2, { loop: true, fps: 3 }),
};

// Sizes are authored relative to each other; FX_SCALE keeps every move readable at gameplay zoom. FireRed sheets keep
// padding around each frame (the Showdown sprites are cropped), so they're drawn a bit bigger.
const FX_SCALE = 1.5;
const ANIM_SCALE = 1.4;
const P: Category = 'physical', S: Category = 'special';
export const mv = (name: string, type: PType, cat: Category, power: number, kind: MoveKind, fx: string, size: number, extra: Partial<Move> = {}): Move =>
  ({ name, type, cat, power, kind, fx, size: size * FX_SCALE * (fx in ANIMS ? ANIM_SCALE : 1), ...extra });

export const MOVES = {
  // normal
  tackle: mv('Tackle', 'normal', P, 40, 'melee', 'hit', 0.9),
  scratch: mv('Scratch', 'normal', P, 40, 'melee', 'scratch', 0.9),
  pound: mv('Pound', 'normal', P, 40, 'melee', 'hit', 0.8),
  doubleSlap: mv('Double Slap', 'normal', P, 45, 'melee', 'slam_hit', 0.9),
  hyperFang: mv('Hyper Fang', 'normal', P, 80, 'melee', 'fang_attack', 1.1),
  slash: mv('Slash', 'normal', P, 70, 'melee', 'slash', 1.1, { highCrit: true }),
  hornAttack: mv('Horn Attack', 'normal', P, 65, 'melee', 'horn_hit', 1.0),
  stomp: mv('Stomp', 'normal', P, 65, 'melee', 'humanoid_foot', 1.1, { end: 'hit' }),
  takeDown: mv('Take Down', 'normal', P, 90, 'melee', 'hit', 1.3, { recoil: 0.25 }),
  bodySlam: mv('Body Slam', 'normal', P, 85, 'quake', 'gray_smoke', 1.4, { status: ['par', 0.3], end: 'slam_hit' }),
  megaPunch: mv('Mega Punch', 'normal', P, 80, 'melee', 'red_fist', 1.2, { end: 'hit' }),
  swift: mv('Swift', 'normal', S, 60, 'shot', 'yellow_star', 0.5, { count: 3, spin: true }),
  payDay: mv('Pay Day', 'normal', P, 40, 'shot', 'coin', 0.45, { count: 3, arc: 1 }),
  triAttack: mv('Tri Attack', 'normal', S, 80, 'shot', 'tri_attack', 0.9, { spin: true }),
  eggBomb: mv('Egg Bomb', 'normal', P, 100, 'shot', 'egg', 0.7, { arc: 2, end: 'explosion', aoe: 1.8 }),
  barrage: mv('Barrage', 'normal', P, 45, 'shot', 'egg', 0.5, { count: 2, arc: 1.5, end: 'explosion' }),
  hyperBeam: mv('Hyper Beam', 'normal', S, 150, 'beam', 'orbs', 0.7, { tint: 0xffb060, end: 'explosion_2', cd: 1.4, aoe: 1.8 }),
  // Ditto copies its target's move
  transform: mv('Transform', 'normal', P, 0, 'melee', 'hit', 0.9),
  // fire
  ember: mv('Ember', 'fire', S, 40, 'shot', 'small_ember', 0.75, { status: ['brn', 0.1], end: 'fire_plume' }),
  fireFang: mv('Fire Fang', 'fire', P, 65, 'melee', 'fang_attack', 1.1, { status: ['brn', 0.1], end: 'fire_plume' }),
  firePunch: mv('Fire Punch', 'fire', P, 75, 'melee', 'punch_impact', 1.1, { status: ['brn', 0.1], end: 'fire_plume' }),
  flamethrower: mv('Flamethrower', 'fire', S, 90, 'spray', 'fire', 0.6, { status: ['brn', 0.1], count: 6, end: 'fire_plume' }),
  fireSpin: mv('Fire Spin', 'fire', S, 35, 'spray', 'spinning_fire', 0.55, { trap: true, count: 5 }),
  fireBlast: mv('Fire Blast', 'fire', S, 110, 'shot', 'fire', 1.1, { status: ['brn', 0.1], cd: 1.3, end: 'explosion_2', aoe: 2.2 }),
  // water
  waterGun: mv('Water Gun', 'water', S, 40, 'spray', 'water_orb', 0.4, { count: 3, end: 'water_impact' }),
  bubble: mv('Bubble', 'water', S, 40, 'shot', 'bubble', 0.4, { count: 3, arc: 0.6 }),
  bubbleBeam: mv('Bubble Beam', 'water', S, 65, 'spray', 'bubble', 0.5, { count: 5 }),
  hydroPump: mv('Hydro Pump', 'water', S, 110, 'spray', 'water_orb', 0.7, { count: 7, cd: 1.2, end: 'water_droplet' }),
  waterPulse: mv('Water Pulse', 'water', S, 60, 'burst', 'thin_ring', 1.2, { tint: 0x80b8ff }),
  surf: mv('Surf', 'water', S, 90, 'quake', 'water_droplet_2', 1.3, { end: 'splash', aoe: 2.6 }),
  crabhammer: mv('Crabhammer', 'water', P, 100, 'melee', 'water_impact', 1.2, { highCrit: true, end: 'hit' }),
  clamp: mv('Clamp', 'water', P, 35, 'melee', 'clamp', 1.0, { trap: true }),
  waterfall: mv('Waterfall', 'water', P, 80, 'melee', 'water_impact', 1.1, { end: 'water_droplet' }),
  // grass
  vineWhip: mv('Vine Whip', 'grass', P, 45, 'melee', 'vine', 1.0),
  razorLeaf: mv('Razor Leaf', 'grass', P, 55, 'shot', 'leaf', 0.5, { highCrit: true, count: 2 }),
  razorLeaf3: mv('Razor Leaf', 'grass', P, 55, 'shot', 'razor_leaf', 0.6, { highCrit: true, count: 3, spin: true }),
  absorb: mv('Absorb', 'grass', S, 20, 'shot', 'bluegreen_orb', 0.4, { drain: 0.5, end: 'green_star' }),
  megaDrain: mv('Mega Drain', 'grass', S, 40, 'shot', 'bluegreen_orb', 0.6, { drain: 0.5, end: 'green_star' }),
  petalDance: mv('Petal Dance', 'grass', S, 120, 'spray', 'petal', 0.45, { count: 6 }),
  solarBeam: mv('Solar Beam', 'grass', S, 120, 'beam', 'orbs', 0.6, { end: 'circle_of_light', tint: 0xe8ffb0, cd: 1.3, aoe: 1.6 }),
  // electric
  thunderShock: mv('Thunder Shock', 'electric', S, 40, 'beam', 'spark_h', 0.8, { status: ['par', 0.1], end: 'electricity' }),
  thunderbolt: mv('Thunderbolt', 'electric', S, 90, 'beam', 'spark_h', 1.0, { status: ['par', 0.1], end: 'shock' }),
  thunder: mv('Thunder', 'electric', S, 110, 'bolt', 'lightning', 1.2, { status: ['par', 0.3], cd: 1.3, end: 'shock', aoe: 1.8 }),
  thunderPunch: mv('Thunder Punch', 'electric', P, 75, 'melee', 'punch_impact', 1.1, { status: ['par', 0.1], end: 'electricity' }),
  spark: mv('Spark', 'electric', P, 65, 'melee', 'electricity', 1.0, { status: ['par', 0.3] }),
  // ice
  iceBeam: mv('Ice Beam', 'ice', S, 90, 'beam', 'ice_crystals', 0.45, { end: 'ice_chunk' }),
  auroraBeam: mv('Aurora Beam', 'ice', S, 65, 'beam', 'rainbow_rings', 0.4, { end: 'ice_chunk' }),
  blizzard: mv('Blizzard', 'ice', S, 110, 'spray', 'ice_crystals', 0.5, { count: 7, spin: true, cd: 1.2, end: 'ice_chunk', aoe: 2.2 }),
  icePunch: mv('Ice Punch', 'ice', P, 75, 'melee', 'punch_impact', 1.1, { end: 'ice_chunk' }),
  icicleSpear: mv('Icicle Spear', 'ice', P, 75, 'shot', 'icicle_spear', 0.6, { count: 3 }),
  // fighting
  karateChop: mv('Karate Chop', 'fighting', P, 50, 'melee', 'cut', 1.0, { highCrit: true }),
  crossChop: mv('Cross Chop', 'fighting', P, 100, 'melee', 'cross_impact', 1.3, { highCrit: true, end: 'hit' }),
  lowKick: mv('Low Kick', 'fighting', P, 60, 'melee', 'humanoid_foot', 1.0),
  doubleKick: mv('Double Kick', 'fighting', P, 60, 'melee', 'humanoid_foot', 0.9, { end: 'hit' }),
  highJumpKick: mv('High Jump Kick', 'fighting', P, 130, 'melee', 'humanoid_foot', 1.3, { end: 'explosion' }),
  cometPunch: mv('Comet Punch', 'fighting', P, 54, 'melee', 'red_fist', 1.0, { end: 'hit' }),
  submission: mv('Submission', 'fighting', P, 80, 'melee', 'slam_hit', 1.2, { recoil: 0.25 }),
  // poison
  poisonSting: mv('Poison Sting', 'poison', P, 15, 'shot', 'needle', 0.45, { status: ['psn', 0.3] }),
  twineedle: mv('Twineedle', 'poison', P, 50, 'shot', 'needle', 0.5, { status: ['psn', 0.2], count: 2 }),
  acid: mv('Acid', 'poison', S, 40, 'spray', 'poison_bubble', 0.45, { count: 4 }),
  smog: mv('Smog', 'poison', S, 30, 'burst', 'gray_smoke', 1.3, { status: ['psn', 0.4], tint: 0xd090ff, aoe: 1.8 }),
  sludge: mv('Sludge', 'poison', S, 65, 'shot', 'poison_bubble', 0.6, { status: ['psn', 0.3], arc: 1.5, end: 'toxic_bubble' }),
  sludgeBomb: mv('Sludge Bomb', 'poison', S, 90, 'shot', 'poison_bubble', 0.8, { status: ['psn', 0.3], arc: 2, end: 'toxic_bubble', aoe: 1.8 }),
  poisonFang: mv('Poison Fang', 'poison', P, 50, 'melee', 'fang_attack', 1.0, { status: ['psn', 0.5], tint: 0xd890ff }),
  // ground
  mudSlap: mv('Mud-Slap', 'ground', S, 20, 'spray', 'mud', 0.45, { count: 3 }),
  boneClub: mv('Bone Club', 'ground', P, 65, 'shot', 'bone', 0.55, { spin: true, end: 'hit' }),
  bonemerang: mv('Bonemerang', 'ground', P, 100, 'shot', 'bone_spin', 0.6, { count: 2, arc: 1, end: 'hit' }),
  dig: mv('Dig', 'ground', P, 80, 'quake', 'flat_rock', 1.0, { end: 'hit' }),
  earthquake: mv('Earthquake', 'ground', P, 100, 'quake', 'rocks', 1.3, { cd: 1.2, end: 'explosion_4', aoe: 3 }),
  // flying
  gust: mv('Gust', 'flying', S, 40, 'shot', 'gust', 0.5),
  gust2: mv('Gust', 'flying', S, 40, 'shot', 'gust', 0.55, { count: 2 }),
  airSlash: mv('Air Slash', 'flying', S, 75, 'shot', 'air_slash', 0.5, { count: 3, spin: true }),
  peck: mv('Peck', 'flying', P, 35, 'melee', 'hit', 0.7),
  drillPeck: mv('Drill Peck', 'flying', P, 80, 'melee', 'horn_hit', 1.0, { end: 'hit' }),
  wingAttack: mv('Wing Attack', 'flying', P, 60, 'melee', 'air_wave', 1.0, { end: 'hit' }),
  // psychic
  confusion: mv('Confusion', 'psychic', S, 50, 'burst', 'spiral', 0.9, { tint: 0xffa8e0 }),
  psybeam: mv('Psybeam', 'psychic', S, 65, 'burst', 'spiral', 1.1, { tint: 0xe0a0ff }),
  psychic: mv('Psychic', 'psychic', S, 90, 'burst', 'thin_ring', 1.2, { tint: 0xff90c8, aoe: 2.2 }),
  psystrike: mv('Psystrike', 'psychic', S, 100, 'burst', 'thin_ring', 1.5, { vsDef: true, tint: 0xd0a0ff, aoe: 2.6 }),
  // Mew picks a random move every time
  metronome: mv('Metronome', 'psychic', S, 0, 'burst', 'spiral', 1.1),
  // bug
  stringShot: mv('String Shot', 'bug', S, 0, 'shot', 'string', 0.6, { slow: true }),
  leechLife: mv('Leech Life', 'bug', P, 80, 'melee', 'sharp_teeth', 0.9, { drain: 0.5, tint: 0xc8f070 }),
  pinMissile: mv('Pin Missile', 'bug', P, 75, 'shot', 'needle', 0.45, { count: 4, tint: 0xd0f080 }),
  xScissor: mv('X-Scissor', 'bug', P, 80, 'melee', 'cross_impact', 1.1, { tint: 0xc8f070 }),
  signalBeam: mv('Signal Beam', 'bug', S, 75, 'beam', 'orbs', 0.4, { end: 'green_star', tint: 0xa0ff80 }),
  // rock
  rockThrow: mv('Rock Throw', 'rock', P, 50, 'shot', 'rocks', 0.5, { arc: 2, spin: true }),
  rockThrow2: mv('Rock Throw', 'rock', P, 50, 'shot', 'rocks', 0.55, { arc: 2, count: 2, spin: true }),
  rockSlide: mv('Rock Slide', 'rock', P, 75, 'drop', 'rocks', 0.7, { count: 3, spin: true, aoe: 2 }),
  spikeCannon: mv('Spike Cannon', 'rock', P, 60, 'shot', 'needle', 0.45, { count: 4 }),
  // ghost
  lick: mv('Lick', 'ghost', P, 30, 'melee', 'lick', 0.9, { status: ['par', 0.3] }),
  nightShade: mv('Night Shade', 'ghost', S, 0, 'burst', 'ghostly_spirit', 0.9, { fixed: 'level' }),
  shadowBall: mv('Shadow Ball', 'ghost', S, 80, 'shot', 'shadow_ball', 0.6),
  shadowBall2: mv('Shadow Ball', 'ghost', S, 80, 'shot', 'shadow_ball', 0.8),
  // dragon
  dragonRage: mv('Dragon Rage', 'dragon', S, 0, 'shot', 'purple_flame', 0.6, { fixed: 40 }),
  twister: mv('Twister', 'dragon', S, 40, 'spray', 'gust', 0.5, { count: 6, tint: 0xa8a0ff }),
  outrage: mv('Outrage', 'dragon', P, 120, 'quake', 'blue_flames', 1.3, { tint: 0xc0a0ff, cd: 1.2, end: 'explosion', aoe: 2.4 }),
  // Voltorb, Geodude, Koffing and their evolutions blow up when cornered (see BOOM in battle.ts); hits everyone nearby
  explosion: mv('Explosion', 'normal', P, 250, 'burst', 'explosion_2', 2.4, { aoe: 3.2 }),
} satisfies Record<string, Move>;

export type MoveId = keyof typeof MOVES;

export interface Species {
  id: string; // also the Showdown cry name
  name: string;
  dex: number; // national dex number, used for sprite paths
  type: PType;
  type2?: PType;
  base: Stats; // real base stats
  catchRate: number; // real capture rate, 3-255
  expYield: number; // real base experience yield
  growth: Growth;
  speed: number; // movement speed in the arena
  range: number; // > 2.5 means it attacks from range
  cooldown: number;
  move: Move;
  height: number; // Pokédex height in metres; drives on-screen size
  legendary?: boolean;
  boom?: boolean; // lights a fuse and explodes when badly hurt (wild only)
  float?: boolean;
  evos?: Evo[];
  blurb?: string;
}

export type Stone = 'fire-stone' | 'water-stone' | 'thunder-stone' | 'leaf-stone' | 'moon-stone';

export const STONE_NAME: Record<Stone, string> = {
  'fire-stone': 'Fire Stone',
  'water-stone': 'Water Stone',
  'thunder-stone': 'Thunder Stone',
  'leaf-stone': 'Leaf Stone',
  'moon-stone': 'Moon Stone',
};

/**
 * The level a Pokémon must reach before its stone is offered: roughly where a FireRed playthrough first gets one.
 * Moon Stones are found in Mt. Moon (party around Lv12); the others are sold at the Celadon Dept. Store (around Lv25).
 */
export const STONE_LEVEL: Record<Stone, number> = {
  'moon-stone': 12,
  'fire-stone': 25,
  'water-stone': 25,
  'thunder-stone': 25,
  'leaf-stone': 25,
};

/** Evolves on reaching `level`, or when given `stone` (offered as a round reward). */
export type Evo = { to: string; level: number; stone?: never } | { to: string; stone: Stone; level?: never };

// Trade evolutions (Kadabra, Machoke, Graveler, Haunter) are level-based here, as in most fan games.
const lv = (to: string, level: number): Evo[] => [{ to, level }];
const st = (...pairs: [to: string, stone: Stone][]): Evo[] => pairs.map(([to, stone]) => ({ to, stone }));

type Types = PType | [PType, PType];
export interface Stats {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}
export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export const STAT_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/** Real base stats, in the usual order. */
type Base = [hp: number, atk: number, def: number, spa: number, spd: number, spe: number];
type Row = [dex: number, id: string, name: string, types: Types, base: Base, move: MoveId, evos?: Evo[]];

const ROWS: Row[] = [
  [1, 'bulbasaur', 'Bulbasaur', ['grass', 'poison'], [45, 49, 49, 65, 65, 45], 'razorLeaf', lv('ivysaur', 16)],
  [2, 'ivysaur', 'Ivysaur', ['grass', 'poison'], [60, 62, 63, 80, 80, 60], 'razorLeaf3', lv('venusaur', 32)],
  [3, 'venusaur', 'Venusaur', ['grass', 'poison'], [80, 82, 83, 100, 100, 80], 'solarBeam'],
  [4, 'charmander', 'Charmander', 'fire', [39, 52, 43, 60, 50, 65], 'ember', lv('charmeleon', 16)],
  [5, 'charmeleon', 'Charmeleon', 'fire', [58, 64, 58, 80, 65, 80], 'fireFang', lv('charizard', 36)],
  [6, 'charizard', 'Charizard', ['fire', 'flying'], [78, 84, 78, 109, 85, 100], 'flamethrower'],
  [7, 'squirtle', 'Squirtle', 'water', [44, 48, 65, 50, 64, 43], 'waterGun', lv('wartortle', 16)],
  [8, 'wartortle', 'Wartortle', 'water', [59, 63, 80, 65, 80, 58], 'bubbleBeam', lv('blastoise', 36)],
  [9, 'blastoise', 'Blastoise', 'water', [79, 83, 100, 85, 105, 78], 'hydroPump'],
  [10, 'caterpie', 'Caterpie', 'bug', [45, 30, 35, 20, 20, 45], 'stringShot', lv('metapod', 7)],
  [11, 'metapod', 'Metapod', 'bug', [50, 20, 55, 25, 25, 30], 'tackle', lv('butterfree', 10)],
  [12, 'butterfree', 'Butterfree', ['bug', 'flying'], [60, 45, 50, 90, 80, 70], 'confusion'],
  [13, 'weedle', 'Weedle', ['bug', 'poison'], [40, 35, 30, 20, 20, 50], 'poisonSting', lv('kakuna', 7)],
  [14, 'kakuna', 'Kakuna', ['bug', 'poison'], [45, 25, 50, 25, 25, 35], 'poisonSting', lv('beedrill', 10)],
  [15, 'beedrill', 'Beedrill', ['bug', 'poison'], [65, 90, 40, 45, 80, 75], 'twineedle'],
  [16, 'pidgey', 'Pidgey', ['normal', 'flying'], [40, 45, 40, 35, 35, 56], 'gust', lv('pidgeotto', 18)],
  [17, 'pidgeotto', 'Pidgeotto', ['normal', 'flying'], [63, 60, 55, 50, 50, 71], 'gust2', lv('pidgeot', 36)],
  [18, 'pidgeot', 'Pidgeot', ['normal', 'flying'], [83, 80, 75, 70, 70, 101], 'airSlash'],
  [19, 'rattata', 'Rattata', 'normal', [30, 56, 35, 25, 35, 72], 'tackle', lv('raticate', 20)],
  [20, 'raticate', 'Raticate', 'normal', [55, 81, 60, 50, 70, 97], 'hyperFang'],
  [21, 'spearow', 'Spearow', ['normal', 'flying'], [40, 60, 30, 31, 31, 70], 'peck', lv('fearow', 20)],
  [22, 'fearow', 'Fearow', ['normal', 'flying'], [65, 90, 65, 61, 61, 100], 'drillPeck'],
  [23, 'ekans', 'Ekans', 'poison', [35, 60, 44, 40, 54, 55], 'poisonFang', lv('arbok', 22)],
  [24, 'arbok', 'Arbok', 'poison', [60, 95, 69, 65, 79, 80], 'acid'],
  [25, 'pikachu', 'Pikachu', 'electric', [35, 55, 40, 50, 50, 90], 'thunderShock', st(['raichu', 'thunder-stone'])],
  [26, 'raichu', 'Raichu', 'electric', [60, 90, 55, 90, 80, 110], 'thunderbolt'],
  [27, 'sandshrew', 'Sandshrew', 'ground', [50, 75, 85, 20, 30, 40], 'scratch', lv('sandslash', 22)],
  [28, 'sandslash', 'Sandslash', 'ground', [75, 100, 110, 45, 55, 65], 'earthquake'],
  [29, 'nidoranf', 'Nidoran♀', 'poison', [55, 47, 52, 40, 40, 41], 'poisonSting', lv('nidorina', 16)],
  [30, 'nidorina', 'Nidorina', 'poison', [70, 62, 67, 55, 55, 56], 'doubleKick', st(['nidoqueen', 'moon-stone'])],
  [31, 'nidoqueen', 'Nidoqueen', ['poison', 'ground'], [90, 92, 87, 75, 85, 76], 'bodySlam'],
  [32, 'nidoranm', 'Nidoran♂', 'poison', [46, 57, 40, 40, 40, 50], 'hornAttack', lv('nidorino', 16)],
  [33, 'nidorino', 'Nidorino', 'poison', [61, 72, 57, 55, 55, 65], 'poisonFang', st(['nidoking', 'moon-stone'])],
  [34, 'nidoking', 'Nidoking', ['poison', 'ground'], [81, 102, 77, 85, 75, 85], 'earthquake'],
  [35, 'clefairy', 'Clefairy', 'normal', [70, 45, 48, 60, 65, 35], 'doubleSlap', st(['clefable', 'moon-stone'])],
  [36, 'clefable', 'Clefable', 'normal', [95, 70, 73, 95, 90, 60], 'swift'],
  [37, 'vulpix', 'Vulpix', 'fire', [38, 41, 40, 50, 65, 65], 'ember', st(['ninetales', 'fire-stone'])],
  [38, 'ninetales', 'Ninetales', 'fire', [73, 76, 75, 81, 100, 100], 'flamethrower'],
  [39, 'jigglypuff', 'Jigglypuff', 'normal', [115, 45, 20, 45, 25, 20], 'pound', st(['wigglytuff', 'moon-stone'])],
  [40, 'wigglytuff', 'Wigglytuff', 'normal', [140, 70, 45, 85, 50, 45], 'bodySlam'],
  [41, 'zubat', 'Zubat', ['poison', 'flying'], [40, 45, 35, 30, 40, 55], 'leechLife', lv('golbat', 22)],
  [42, 'golbat', 'Golbat', ['poison', 'flying'], [75, 80, 70, 65, 75, 90], 'wingAttack'],
  [43, 'oddish', 'Oddish', ['grass', 'poison'], [45, 50, 55, 75, 65, 30], 'absorb', lv('gloom', 21)],
  [44, 'gloom', 'Gloom', ['grass', 'poison'], [60, 65, 70, 85, 75, 40], 'megaDrain', st(['vileplume', 'leaf-stone'])],
  [45, 'vileplume', 'Vileplume', ['grass', 'poison'], [75, 80, 85, 110, 90, 50], 'petalDance'],
  [46, 'paras', 'Paras', ['bug', 'grass'], [35, 70, 55, 45, 55, 25], 'leechLife', lv('parasect', 24)],
  [47, 'parasect', 'Parasect', ['bug', 'grass'], [60, 95, 80, 60, 80, 30], 'xScissor'],
  [48, 'venonat', 'Venonat', ['bug', 'poison'], [60, 55, 50, 40, 55, 45], 'psybeam', lv('venomoth', 31)],
  [49, 'venomoth', 'Venomoth', ['bug', 'poison'], [70, 65, 60, 90, 75, 90], 'signalBeam'],
  [50, 'diglett', 'Diglett', 'ground', [10, 55, 25, 35, 45, 95], 'dig', lv('dugtrio', 26)],
  [51, 'dugtrio', 'Dugtrio', 'ground', [35, 100, 50, 50, 70, 120], 'earthquake'],
  [52, 'meowth', 'Meowth', 'normal', [40, 45, 35, 40, 40, 90], 'payDay', lv('persian', 28)],
  [53, 'persian', 'Persian', 'normal', [65, 70, 60, 65, 65, 115], 'slash'],
  [54, 'psyduck', 'Psyduck', 'water', [50, 52, 48, 65, 50, 55], 'waterGun', lv('golduck', 33)],
  [55, 'golduck', 'Golduck', 'water', [80, 82, 78, 95, 80, 85], 'hydroPump'],
  [56, 'mankey', 'Mankey', 'fighting', [40, 80, 35, 35, 45, 70], 'karateChop', lv('primeape', 28)],
  [57, 'primeape', 'Primeape', 'fighting', [65, 105, 60, 60, 70, 95], 'crossChop'],
  [58, 'growlithe', 'Growlithe', 'fire', [55, 70, 45, 70, 50, 60], 'fireFang', st(['arcanine', 'fire-stone'])],
  [59, 'arcanine', 'Arcanine', 'fire', [90, 110, 80, 100, 80, 95], 'fireBlast'],
  [60, 'poliwag', 'Poliwag', 'water', [40, 50, 40, 40, 40, 90], 'bubble', lv('poliwhirl', 25)],
  [61, 'poliwhirl', 'Poliwhirl', 'water', [65, 65, 65, 50, 50, 90], 'bubbleBeam', st(['poliwrath', 'water-stone'])],
  [62, 'poliwrath', 'Poliwrath', ['water', 'fighting'], [90, 95, 95, 70, 90, 70], 'submission'],
  [63, 'abra', 'Abra', 'psychic', [25, 20, 15, 105, 55, 90], 'confusion', lv('kadabra', 16)],
  [64, 'kadabra', 'Kadabra', 'psychic', [40, 35, 30, 120, 70, 105], 'psybeam', lv('alakazam', 30)],
  [65, 'alakazam', 'Alakazam', 'psychic', [55, 50, 45, 135, 95, 120], 'psychic'],
  [66, 'machop', 'Machop', 'fighting', [70, 80, 50, 35, 35, 35], 'karateChop', lv('machoke', 28)],
  [67, 'machoke', 'Machoke', 'fighting', [80, 100, 70, 50, 60, 45], 'lowKick', lv('machamp', 34)],
  [68, 'machamp', 'Machamp', 'fighting', [90, 130, 80, 65, 85, 55], 'crossChop'],
  [69, 'bellsprout', 'Bellsprout', ['grass', 'poison'], [50, 75, 35, 70, 30, 40], 'vineWhip', lv('weepinbell', 21)],
  [70, 'weepinbell', 'Weepinbell', ['grass', 'poison'], [65, 90, 50, 85, 45, 55], 'razorLeaf', st(['victreebel', 'leaf-stone'])],
  [71, 'victreebel', 'Victreebel', ['grass', 'poison'], [80, 105, 65, 100, 70, 70], 'razorLeaf3'],
  [72, 'tentacool', 'Tentacool', ['water', 'poison'], [40, 40, 35, 50, 100, 70], 'acid', lv('tentacruel', 30)],
  [73, 'tentacruel', 'Tentacruel', ['water', 'poison'], [80, 70, 65, 80, 120, 100], 'sludgeBomb'],
  [74, 'geodude', 'Geodude', ['rock', 'ground'], [40, 80, 100, 30, 30, 20], 'rockThrow', lv('graveler', 25)],
  [75, 'graveler', 'Graveler', ['rock', 'ground'], [55, 95, 115, 45, 45, 35], 'rockThrow2', lv('golem', 32)],
  [76, 'golem', 'Golem', ['rock', 'ground'], [80, 120, 130, 55, 65, 45], 'rockSlide'],
  [77, 'ponyta', 'Ponyta', 'fire', [50, 85, 55, 65, 65, 90], 'ember', lv('rapidash', 40)],
  [78, 'rapidash', 'Rapidash', 'fire', [65, 100, 70, 80, 80, 105], 'fireSpin'],
  [79, 'slowpoke', 'Slowpoke', ['water', 'psychic'], [90, 65, 65, 40, 40, 15], 'confusion', lv('slowbro', 37)],
  [80, 'slowbro', 'Slowbro', ['water', 'psychic'], [95, 75, 110, 100, 80, 30], 'waterPulse'],
  [81, 'magnemite', 'Magnemite', 'electric', [25, 35, 70, 95, 55, 45], 'thunderShock', lv('magneton', 30)],
  [82, 'magneton', 'Magneton', 'electric', [50, 60, 95, 120, 70, 70], 'thunderbolt'],
  [83, 'farfetchd', "Farfetch'd", ['normal', 'flying'], [52, 90, 55, 58, 62, 60], 'slash'],
  [84, 'doduo', 'Doduo', ['normal', 'flying'], [35, 85, 45, 35, 35, 75], 'peck', lv('dodrio', 31)],
  [85, 'dodrio', 'Dodrio', ['normal', 'flying'], [60, 110, 70, 60, 60, 110], 'triAttack'],
  [86, 'seel', 'Seel', 'water', [65, 45, 55, 45, 70, 45], 'auroraBeam', lv('dewgong', 34)],
  [87, 'dewgong', 'Dewgong', ['water', 'ice'], [90, 70, 80, 70, 95, 70], 'iceBeam'],
  [88, 'grimer', 'Grimer', 'poison', [80, 80, 50, 40, 50, 25], 'sludge', lv('muk', 38)],
  [89, 'muk', 'Muk', 'poison', [105, 105, 75, 65, 100, 50], 'sludgeBomb'],
  [90, 'shellder', 'Shellder', 'water', [30, 65, 100, 45, 25, 40], 'clamp', st(['cloyster', 'water-stone'])],
  [91, 'cloyster', 'Cloyster', ['water', 'ice'], [50, 95, 180, 85, 45, 70], 'icicleSpear'],
  [92, 'gastly', 'Gastly', ['ghost', 'poison'], [30, 35, 30, 100, 35, 80], 'nightShade', lv('haunter', 25)],
  [93, 'haunter', 'Haunter', ['ghost', 'poison'], [45, 50, 45, 115, 55, 95], 'shadowBall', lv('gengar', 32)],
  [94, 'gengar', 'Gengar', ['ghost', 'poison'], [60, 65, 60, 130, 75, 110], 'shadowBall2'],
  [95, 'onix', 'Onix', ['rock', 'ground'], [35, 45, 160, 30, 45, 70], 'rockSlide'],
  [96, 'drowzee', 'Drowzee', 'psychic', [60, 48, 45, 43, 90, 42], 'confusion', lv('hypno', 26)],
  [97, 'hypno', 'Hypno', 'psychic', [85, 73, 70, 73, 115, 67], 'psychic'],
  [98, 'krabby', 'Krabby', 'water', [30, 105, 90, 25, 25, 50], 'clamp', lv('kingler', 28)],
  [99, 'kingler', 'Kingler', 'water', [55, 130, 115, 50, 50, 75], 'crabhammer'],
  [100, 'voltorb', 'Voltorb', 'electric', [40, 30, 50, 55, 55, 100], 'spark', lv('electrode', 30)],
  [101, 'electrode', 'Electrode', 'electric', [60, 50, 70, 80, 80, 150], 'thunderbolt'],
  [102, 'exeggcute', 'Exeggcute', ['grass', 'psychic'], [60, 40, 80, 60, 45, 40], 'barrage', st(['exeggutor', 'leaf-stone'])],
  [103, 'exeggutor', 'Exeggutor', ['grass', 'psychic'], [95, 95, 85, 125, 75, 55], 'eggBomb'],
  [104, 'cubone', 'Cubone', 'ground', [50, 50, 95, 40, 50, 35], 'boneClub', lv('marowak', 28)],
  [105, 'marowak', 'Marowak', 'ground', [60, 80, 110, 50, 80, 45], 'bonemerang'],
  [106, 'hitmonlee', 'Hitmonlee', 'fighting', [50, 120, 53, 35, 110, 87], 'highJumpKick'],
  [107, 'hitmonchan', 'Hitmonchan', 'fighting', [50, 105, 79, 35, 110, 76], 'cometPunch'],
  [108, 'lickitung', 'Lickitung', 'normal', [90, 55, 75, 60, 75, 30], 'lick'],
  [109, 'koffing', 'Koffing', 'poison', [40, 65, 95, 60, 45, 35], 'smog', lv('weezing', 35)],
  [110, 'weezing', 'Weezing', 'poison', [65, 90, 120, 85, 70, 60], 'sludge'],
  [111, 'rhyhorn', 'Rhyhorn', ['ground', 'rock'], [80, 85, 95, 30, 30, 25], 'stomp', lv('rhydon', 42)],
  [112, 'rhydon', 'Rhydon', ['ground', 'rock'], [105, 130, 120, 45, 45, 40], 'earthquake'],
  [113, 'chansey', 'Chansey', 'normal', [250, 5, 5, 35, 105, 50], 'eggBomb'],
  [114, 'tangela', 'Tangela', 'grass', [65, 55, 115, 100, 40, 60], 'vineWhip'],
  [115, 'kangaskhan', 'Kangaskhan', 'normal', [105, 95, 80, 40, 80, 90], 'megaPunch'],
  [116, 'horsea', 'Horsea', 'water', [30, 40, 70, 70, 25, 60], 'bubble', lv('seadra', 32)],
  [117, 'seadra', 'Seadra', 'water', [55, 65, 95, 95, 45, 85], 'hydroPump'],
  [118, 'goldeen', 'Goldeen', 'water', [45, 67, 60, 35, 50, 63], 'hornAttack', lv('seaking', 33)],
  [119, 'seaking', 'Seaking', 'water', [80, 92, 65, 65, 80, 68], 'waterfall'],
  [120, 'staryu', 'Staryu', 'water', [30, 45, 55, 70, 55, 85], 'waterGun', st(['starmie', 'water-stone'])],
  [121, 'starmie', 'Starmie', ['water', 'psychic'], [60, 75, 85, 100, 85, 115], 'surf'],
  [122, 'mrmime', 'Mr. Mime', 'psychic', [40, 45, 65, 100, 120, 90], 'psybeam'],
  [123, 'scyther', 'Scyther', ['bug', 'flying'], [70, 110, 80, 55, 80, 105], 'xScissor'],
  [124, 'jynx', 'Jynx', ['ice', 'psychic'], [65, 50, 35, 115, 95, 95], 'icePunch'],
  [125, 'electabuzz', 'Electabuzz', 'electric', [65, 83, 57, 95, 85, 105], 'thunderPunch'],
  [126, 'magmar', 'Magmar', 'fire', [65, 95, 57, 100, 85, 93], 'firePunch'],
  [127, 'pinsir', 'Pinsir', 'bug', [65, 125, 100, 55, 70, 85], 'xScissor'],
  [128, 'tauros', 'Tauros', 'normal', [75, 100, 95, 40, 70, 110], 'takeDown'],
  [129, 'magikarp', 'Magikarp', 'water', [20, 10, 55, 15, 20, 80], 'tackle', lv('gyarados', 20)],
  [130, 'gyarados', 'Gyarados', ['water', 'flying'], [95, 125, 79, 60, 100, 81], 'hyperBeam'],
  [131, 'lapras', 'Lapras', ['water', 'ice'], [130, 85, 80, 85, 95, 60], 'iceBeam'],
  [132, 'ditto', 'Ditto', 'normal', [48, 48, 48, 48, 48, 48], 'transform'],
  [133, 'eevee', 'Eevee', 'normal', [55, 55, 50, 45, 65, 55], 'swift', st(['vaporeon', 'water-stone'], ['jolteon', 'thunder-stone'], ['flareon', 'fire-stone'])],
  [134, 'vaporeon', 'Vaporeon', 'water', [130, 65, 60, 110, 95, 65], 'waterPulse'],
  [135, 'jolteon', 'Jolteon', 'electric', [65, 65, 60, 110, 95, 130], 'thunderbolt'],
  [136, 'flareon', 'Flareon', 'fire', [65, 130, 60, 95, 110, 65], 'fireFang'],
  [137, 'porygon', 'Porygon', 'normal', [65, 60, 70, 85, 75, 40], 'triAttack'],
  [138, 'omanyte', 'Omanyte', ['rock', 'water'], [35, 40, 100, 90, 55, 35], 'waterGun', lv('omastar', 40)],
  [139, 'omastar', 'Omastar', ['rock', 'water'], [70, 60, 125, 115, 70, 55], 'spikeCannon'],
  [140, 'kabuto', 'Kabuto', ['rock', 'water'], [30, 80, 90, 55, 45, 55], 'scratch', lv('kabutops', 40)],
  [141, 'kabutops', 'Kabutops', ['rock', 'water'], [60, 115, 105, 65, 70, 80], 'slash'],
  [142, 'aerodactyl', 'Aerodactyl', ['rock', 'flying'], [80, 105, 65, 60, 75, 130], 'wingAttack'],
  [143, 'snorlax', 'Snorlax', 'normal', [160, 110, 65, 65, 110, 30], 'bodySlam'],
  [144, 'articuno', 'Articuno', ['ice', 'flying'], [90, 85, 100, 95, 125, 85], 'blizzard'],
  [145, 'zapdos', 'Zapdos', ['electric', 'flying'], [90, 90, 85, 125, 90, 100], 'thunder'],
  [146, 'moltres', 'Moltres', ['fire', 'flying'], [90, 100, 90, 125, 85, 90], 'fireBlast'],
  [147, 'dratini', 'Dratini', 'dragon', [41, 64, 45, 50, 50, 50], 'dragonRage', lv('dragonair', 30)],
  [148, 'dragonair', 'Dragonair', 'dragon', [61, 84, 65, 70, 70, 70], 'twister', lv('dragonite', 55)],
  [149, 'dragonite', 'Dragonite', ['dragon', 'flying'], [91, 134, 95, 100, 100, 80], 'outrage'],
  [150, 'mewtwo', 'Mewtwo', 'psychic', [106, 110, 90, 154, 90, 130], 'psystrike'],
  [151, 'mew', 'Mew', 'psychic', [100, 100, 100, 100, 100, 100], 'metronome'],
];

/** Pokédex heights in decimetres, indexed by dex number - 1 (from PokeAPI). */
const HEIGHT_DM = [
  7, 10, 20, 6, 11, 17, 5, 10, 16, 3, 7, 11, 3, 6, 10, 3, 11, 15, 3, 7, 3, 12, 20, 35, 4, 8, 6, 10, 4, 8, 13,
  5, 9, 14, 6, 13, 6, 11, 5, 10, 8, 16, 5, 8, 12, 3, 10, 10, 15, 2, 7, 4, 10, 8, 17, 5, 10, 7, 19, 6, 10, 13,
  9, 13, 15, 8, 15, 16, 7, 10, 17, 9, 16, 4, 10, 14, 10, 17, 12, 16, 3, 10, 8, 14, 18, 11, 17, 9, 12, 3, 15,
  13, 16, 15, 88, 10, 16, 4, 13, 5, 12, 4, 20, 4, 10, 15, 14, 12, 6, 12, 10, 19, 11, 10, 22, 4, 12, 6, 13, 8,
  11, 13, 15, 14, 11, 13, 15, 14, 9, 65, 25, 3, 3, 10, 8, 9, 8, 4, 10, 5, 13, 18, 21, 17, 16, 20, 18, 40, 22,
  20, 4,
];

// Per-species data from PokeAPI, indexed by dex number - 1.
/** Capture rates (3 = legendary, 255 = Caterpie). */
const CATCH_RATE = [
  45, 45, 45, 45, 45, 45, 45, 45, 45, 255, 120, 45, 255, 120, 45, 255, 120, 45, 255, 127, 255, 90, 255, 90, 190,
  75, 255, 90, 235, 120, 45, 235, 120, 45, 150, 25, 190, 75, 170, 50, 255, 90, 255, 120, 45, 190, 75, 190, 75, 255,
  50, 255, 90, 190, 75, 190, 75, 190, 75, 255, 120, 45, 200, 100, 50, 180, 90, 45, 255, 120, 45, 190, 60, 255, 120,
  45, 190, 60, 190, 75, 190, 60, 45, 190, 45, 190, 75, 190, 75, 190, 60, 190, 90, 45, 45, 190, 75, 225, 60, 190,
  60, 90, 45, 190, 75, 45, 45, 45, 190, 60, 120, 60, 30, 45, 45, 225, 75, 225, 60, 225, 60, 45, 45, 45, 45,
  45, 45, 45, 255, 45, 45, 35, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 25, 3, 3, 3, 45, 45, 45, 3,
  45,
];
/** Base experience yields. */
const EXP_YIELD = [
  64, 142, 236, 62, 142, 240, 63, 142, 239, 39, 72, 178, 39, 72, 178, 50, 122, 216, 51, 145, 52, 155, 58, 157, 112,
  218, 60, 158, 55, 128, 227, 55, 128, 227, 113, 217, 60, 177, 95, 196, 49, 159, 64, 138, 221, 57, 142, 61, 158, 53,
  149, 58, 154, 64, 175, 61, 159, 70, 194, 60, 135, 230, 62, 140, 225, 61, 142, 227, 60, 137, 221, 67, 180, 60, 137,
  223, 82, 175, 63, 172, 65, 163, 132, 62, 165, 65, 166, 65, 175, 61, 184, 62, 142, 225, 77, 66, 169, 65, 166, 66,
  172, 65, 186, 64, 149, 159, 159, 77, 68, 172, 69, 170, 395, 87, 172, 59, 154, 64, 158, 68, 182, 161, 100, 159, 172,
  173, 175, 172, 40, 189, 187, 101, 65, 184, 184, 184, 79, 71, 173, 71, 173, 180, 189, 261, 261, 261, 60, 147, 270, 306,
  270,
];
/** Growth rates: 1 slow, 2 medium fast, 3 fast, 4 medium slow. */
const GROWTH_ID = [
  4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 3, 3, 2, 2, 3, 3,
  2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1, 4, 4, 4, 2, 2, 2, 2,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 3, 2, 2, 2, 2, 2, 2, 1,
  1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4,
];
const GROWTHS = ['slow', 'medium', 'fast', 'mediumSlow'] as const;
export type Growth = (typeof GROWTHS)[number];

/** Total experience needed to reach `level` on a growth curve (the real formulas). */
export function expAt(g: Growth, level: number) {
  const n = Math.min(100, level);
  if (n <= 1) return 0;
  switch (g) {
    case 'slow': return Math.floor((5 * n ** 3) / 4);
    case 'medium': return n ** 3;
    case 'fast': return Math.floor((4 * n ** 3) / 5);
    case 'mediumSlow': return Math.max(0, Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140));
  }
}

const LEGENDARY = new Set(['articuno', 'zapdos', 'moltres', 'mewtwo', 'mew']);
/** Self-Destruct / Explosion users in Red/Blue. */
const BOOM = new Set(['voltorb', 'electrode', 'geodude', 'graveler', 'golem', 'koffing', 'weezing']);

const FLOATERS = new Set([
  'butterfree', 'beedrill', 'pidgey', 'pidgeotto', 'pidgeot', 'spearow', 'fearow', 'zubat', 'golbat', 'venomoth',
  'magnemite', 'magneton', 'gastly', 'haunter', 'koffing', 'weezing', 'charizard', 'aerodactyl', 'articuno',
  'zapdos', 'moltres', 'dragonite', 'mew', 'porygon', 'scyther',
]);

const BLURBS: Record<string, string> = {
  bulbasaur: 'Sturdy and steady. Razor Leaf from range — great against water and rock.',
  charmander: 'Hard-hitting Ember. Scorches grass types, evolves into a close-range brawler.',
  squirtle: 'Tanky shell, Water Gun stream. Douses fire and rock types.',
  pikachu: 'Fast and fragile. Thunder Shock zaps from long range. Evolves with a Thunder Stone.',
  eevee: 'Adaptable. Evolve it with any of three stones into the form your team needs.',
  abra: 'Psychic powerhouse with paper-thin defenses.',
};

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const MELEE = new Set<MoveKind>(['melee', 'quake']);

/** Arena behaviour (movement, reach, attack rhythm) comes from base stats; battle maths uses the real stats (see battle.ts). */
function derive([, atk, , spa, , spe]: Base, move: Move) {
  return {
    speed: clampN(3 + spe * 0.03, 3, 7.2),
    range: MELEE.has(move.kind) ? 1.6 : clampN(4 + Math.max(atk, spa) * 0.015, 4.5, 6.5),
    cooldown: (move.cd ?? 1) * 1.2 * clampN(1.2 - spe * 0.003, 0.85, 1.15),
  };
}

export const SPECIES: Species[] = ROWS.map(([dex, id, name, types, b, moveId, evos]) => {
  const [type, type2] = Array.isArray(types) ? types : [types];
  const move = MOVES[moveId];
  return {
    id, name, dex, type, type2, move, height: HEIGHT_DM[dex - 1] / 10, ...derive(b, move),
    base: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] },
    catchRate: CATCH_RATE[dex - 1], expYield: EXP_YIELD[dex - 1], growth: GROWTHS[GROWTH_ID[dex - 1] - 1],
    legendary: LEGENDARY.has(id) || undefined, boom: BOOM.has(id) || undefined, float: FLOATERS.has(id) || undefined, evos, blurb: BLURBS[id],
  };
});

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/** Species that something evolves into (everything else is a basic Pokémon). */
export const EVOLVED = new Set(SPECIES.flatMap((s) => (s.evos ?? []).map((e) => e.to)));

export const STARTERS = ['bulbasaur', 'charmander', 'squirtle'];

/** Item sprites used for reward icons and the thrown ball. */
export const ITEMS = ['poke-ball', 'great-ball', 'ultra-ball', 'full-heal', 'hyper-potion', 'max-revive', 'rare-candy', 'x-attack', 'focus-band', ...Object.keys(STONE_NAME)];

/** Battle-fx sprites used outside of moves. */
export const FX_EXTRA = ['impact', 'shine', 'electroball', 'wisp'];

/** Every fx sprite the game can draw. */
export const FX_ALL = [...new Set([...Object.values(MOVES).flatMap((m: Move) => [m.fx, ...(m.end ? [m.end] : [])]), ...FX_EXTRA])].filter((f) => !(f in ANIMS));

/**
 * FireRed/LeafGreen songs (pret/pokefirered MIDI + the game's own instrument samples, played by src/music.ts).
 * Each area uses the theme its FRLG map plays (Seafoam really does share Viridian Forest's, Safari Zone the evolution theme).
 */
export const MUSIC = {
  title: 'mus_title',
  wild: 'mus_vs_wild', // an area's last round: its evolved Pokémon shows up
  legend: 'mus_vs_legend',
  mewtwo: 'mus_vs_mewtwo',
  victory: 'mus_victory_wild',
  caught: 'mus_caught_intro', // the "Gotcha!" fanfare
  center: 'mus_poke_center',
  heal: 'mus_heal', // the Pokémon Center healing jingle
  evolving: 'mus_evolution', // under the evolution sequence
  evolved: 'mus_evolved', // "Congratulations! Your … evolved into …!"
  // one per area, in BIOMES order
  areas: [
    'mus_route1', 'mus_viridian_forest', 'mus_mt_moon', 'mus_route24', 'mus_route11', 'mus_mt_moon', 'mus_poke_tower',
    'mus_cycling', 'mus_evolution', 'mus_viridian_forest', 'mus_poke_mansion', 'mus_sevii_cave', 'mus_victory_road',
    'mus_rocket_hideout',
  ],
};

/** FireRed sound effects, which pokefirered also keeps as MIDI songs (played the same way as the music). */
export const SE = {
  select: 'se_select', // pressing A in a menu
};

/** Overworld sprite sheet for the trainer (pokefirered). */
export const TRAINER_SHEET = 'red_normal';

/** Odds of a wild Pokémon being shiny. Much kinder than the real games, so a run can actually find one. */
export const SHINY_ODDS = 1 / 64;

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
