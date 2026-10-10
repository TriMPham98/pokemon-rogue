export type PType =
  | 'normal' | 'fire' | 'water' | 'grass' | 'electric'
  | 'rock' | 'ghost' | 'fighting' | 'psychic' | 'flying';

export const TYPE_COLOR: Record<PType, number> = {
  normal: 0xa8a878,
  fire: 0xf08030,
  water: 0x6890f0,
  grass: 0x78c850,
  electric: 0xf8d030,
  rock: 0xb8a038,
  ghost: 0x705898,
  fighting: 0xc03028,
  psychic: 0xf85888,
  flying: 0xa890f0,
};

// Attacker -> defender multipliers. Anything not listed is 1x.
const CHART: Partial<Record<PType, Partial<Record<PType, number>>>> = {
  normal: { rock: 0.5, ghost: 0 },
  fire: { grass: 2, fire: 0.5, water: 0.5, rock: 0.5 },
  water: { fire: 2, rock: 2, water: 0.5, grass: 0.5 },
  grass: { water: 2, rock: 2, fire: 0.5, grass: 0.5, flying: 0.5 },
  electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5 },
  rock: { fire: 2, flying: 2, fighting: 0.5 },
  ghost: { ghost: 2, psychic: 2, normal: 0 },
  fighting: { normal: 2, rock: 2, flying: 0.5, psychic: 0.5, ghost: 0 },
  psychic: { fighting: 2, psychic: 0.5 },
  flying: { grass: 2, fighting: 2, electric: 0.5, rock: 0.5 },
};

export function typeMult(attacker: PType, defender: PType): number {
  return CHART[attacker]?.[defender] ?? 1;
}

/**
 * How a move is drawn:
 * shot  – fx sprite(s) fly to the target (`count` staggered, optional `arc`)
 * spray – a fast stream of small fx sprites
 * beam  – instant crackling chain from attacker to target
 * melee – attacker lunges, fx sprite slams onto the target
 * burst – fx sprite blooms on the target
 */
export type MoveKind = 'shot' | 'spray' | 'beam' | 'melee' | 'burst';

export interface Move {
  name: string;
  type: PType;
  kind: MoveKind;
  fx: string; // Showdown battle-fx sprite name
  size: number;
  count?: number;
  spin?: boolean;
  arc?: number;
}

// Sizes are authored relative to each other; FX_SCALE keeps every move readable at gameplay zoom.
const FX_SCALE = 1.5;
const mv = (name: string, type: PType, kind: MoveKind, fx: string, size: number, extra: Partial<Move> = {}): Move =>
  ({ name, type, kind, fx, size: size * FX_SCALE, ...extra });

export const MOVES = {
  razorLeaf: mv('Razor Leaf', 'grass', 'shot', 'leaf1', 0.55, { count: 2, spin: true }),
  razorLeaf3: mv('Razor Leaf', 'grass', 'shot', 'leaf2', 0.6, { count: 3, spin: true }),
  solarBeam: mv('Solar Beam', 'grass', 'shot', 'energyball', 1.3),
  absorb: mv('Absorb', 'grass', 'shot', 'energyball', 0.5),
  megaDrain: mv('Mega Drain', 'grass', 'shot', 'energyball', 0.75),
  petalDance: mv('Petal Dance', 'grass', 'spray', 'petal', 0.5, { count: 6, spin: true }),
  ember: mv('Ember', 'fire', 'shot', 'fireball', 0.75),
  fireFang: mv('Fire Fang', 'fire', 'melee', 'topbite', 1.1),
  flamethrower: mv('Flamethrower', 'fire', 'spray', 'fireball', 0.65, { count: 6 }),
  waterGun: mv('Water Gun', 'water', 'spray', 'waterwisp', 0.5, { count: 3 }),
  bubbleBeam: mv('Bubble Beam', 'water', 'spray', 'waterwisp', 0.55, { count: 5 }),
  hydroPump: mv('Hydro Pump', 'water', 'spray', 'waterwisp', 0.85, { count: 7 }),
  thunderShock: mv('Thunder Shock', 'electric', 'beam', 'lightning', 0.9),
  thunderbolt: mv('Thunderbolt', 'electric', 'beam', 'lightning', 1.2),
  tackle: mv('Tackle', 'normal', 'melee', 'impact', 0.9),
  hyperFang: mv('Hyper Fang', 'normal', 'melee', 'topbite', 1.1),
  gust: mv('Gust', 'flying', 'shot', 'feather', 0.5, { spin: true }),
  gust2: mv('Gust', 'flying', 'shot', 'feather', 0.55, { count: 2, spin: true }),
  airSlash: mv('Air Slash', 'flying', 'shot', 'feather', 0.65, { count: 3, spin: true }),
  rockThrow: mv('Rock Throw', 'rock', 'shot', 'rock1', 0.6, { arc: 2, spin: true }),
  rockThrow2: mv('Rock Throw', 'rock', 'shot', 'rock2', 0.7, { arc: 2, count: 2, spin: true }),
  rockSlide: mv('Rock Slide', 'rock', 'shot', 'rock3', 0.85, { arc: 3, count: 3, spin: true }),
  karateChop: mv('Karate Chop', 'fighting', 'melee', 'leftchop', 1.0),
  crossChop: mv('Cross Chop', 'fighting', 'melee', 'rightchop', 1.4),
  nightShade: mv('Night Shade', 'ghost', 'burst', 'blackwisp', 1.2),
  shadowBall: mv('Shadow Ball', 'ghost', 'shot', 'shadowball', 0.8),
  shadowBall2: mv('Shadow Ball', 'ghost', 'shot', 'shadowball', 1.1),
  confusion: mv('Confusion', 'psychic', 'burst', 'mistball', 1.1),
  psybeam: mv('Psybeam', 'psychic', 'burst', 'mistball', 1.4),
  psychic: mv('Psychic', 'psychic', 'burst', 'mistball', 1.9),
  swift: mv('Swift', 'normal', 'shot', 'shine', 0.5, { count: 3, spin: true }),
  waterPulse: mv('Water Pulse', 'water', 'burst', 'waterwisp', 1.6),
} satisfies Record<string, Move>;

export interface Species {
  id: string; // also the Showdown cry name
  name: string;
  dex: number; // national dex number, used for sprite paths
  type: PType;
  hp: number;
  atk: number;
  speed: number;
  range: number; // > 2.5 means it attacks from range
  cooldown: number;
  move: Move;
  minRound: number; // earliest round it appears in the wild (99 = never)
  catchRate: number;
  float?: boolean;
  evos?: Evo[];
  blurb?: string;
}

export type Stone = 'fire-stone' | 'water-stone' | 'thunder-stone' | 'leaf-stone';

export const STONE_NAME: Record<Stone, string> = {
  'fire-stone': 'Fire Stone',
  'water-stone': 'Water Stone',
  'thunder-stone': 'Thunder Stone',
  'leaf-stone': 'Leaf Stone',
};

/** Evolves on reaching `level`, or when given `stone` (offered as a round reward). */
export type Evo = { to: string; level: number; stone?: never } | { to: string; stone: Stone; level?: never };

// Trade evolutions (Kadabra, Machoke, Graveler, Haunter) are level-based here, as in most fan games.
const lv = (to: string, level: number): Evo[] => [{ to, level }];
const st = (...pairs: [to: string, stone: Stone][]): Evo[] => pairs.map(([to, stone]) => ({ to, stone }));

type Row = [id: string, name: string, dex: number, type: PType, stats: [hp: number, atk: number, speed: number, range: number, cd: number], move: Move, minRound: number, catchRate: number, evos?: Evo[]];

const M = MOVES;
const ROWS: Row[] = [
  ['bulbasaur', 'Bulbasaur', 1, 'grass', [50, 10, 4.4, 5, 1.3], M.razorLeaf, 6, 0.55, lv('ivysaur', 16)],
  ['ivysaur', 'Ivysaur', 2, 'grass', [64, 13, 4.6, 5, 1.3], M.razorLeaf3, 99, 0.45, lv('venusaur', 32)],
  ['venusaur', 'Venusaur', 3, 'grass', [82, 17, 4.6, 6, 1.5], M.solarBeam, 99, 0.3],
  ['charmander', 'Charmander', 4, 'fire', [42, 12, 5, 4.5, 1.0], M.ember, 6, 0.55, lv('charmeleon', 16)],
  ['charmeleon', 'Charmeleon', 5, 'fire', [55, 15, 5.3, 1.6, 1.0], M.fireFang, 99, 0.45, lv('charizard', 36)],
  ['charizard', 'Charizard', 6, 'fire', [72, 20, 5.8, 6, 1.2], M.flamethrower, 99, 0.3],
  ['squirtle', 'Squirtle', 7, 'water', [54, 9, 4.2, 5, 1.2], M.waterGun, 6, 0.55, lv('wartortle', 16)],
  ['wartortle', 'Wartortle', 8, 'water', [68, 12, 4.4, 5, 1.2], M.bubbleBeam, 99, 0.45, lv('blastoise', 36)],
  ['blastoise', 'Blastoise', 9, 'water', [88, 16, 4.4, 6.5, 1.4], M.hydroPump, 99, 0.3],
  ['pikachu', 'Pikachu', 25, 'electric', [36, 13, 6, 6, 1.1], M.thunderShock, 4, 0.5, st(['raichu', 'thunder-stone'])],
  ['raichu', 'Raichu', 26, 'electric', [50, 17, 6.3, 6.5, 1.1], M.thunderbolt, 12, 0.35],
  ['rattata', 'Rattata', 19, 'normal', [30, 8, 5.6, 1.4, 0.9], M.tackle, 1, 1, lv('raticate', 20)],
  ['raticate', 'Raticate', 20, 'normal', [45, 12, 5.8, 1.5, 0.9], M.hyperFang, 9, 0.7],
  ['pidgey', 'Pidgey', 16, 'flying', [32, 8, 5.4, 4.5, 1.1], M.gust, 1, 1, lv('pidgeotto', 18)],
  ['pidgeotto', 'Pidgeotto', 17, 'flying', [46, 11, 5.6, 4.5, 1.0], M.gust2, 9, 0.7, lv('pidgeot', 36)],
  ['pidgeot', 'Pidgeot', 18, 'flying', [64, 15, 6, 5, 1.0], M.airSlash, 99, 0.35],
  ['oddish', 'Oddish', 43, 'grass', [38, 9, 3.8, 4.5, 1.3], M.absorb, 1, 1, lv('gloom', 21)],
  ['gloom', 'Gloom', 44, 'grass', [50, 12, 3.9, 4.5, 1.3], M.megaDrain, 9, 0.7, st(['vileplume', 'leaf-stone'])],
  ['vileplume', 'Vileplume', 45, 'grass', [66, 16, 4, 5, 1.3], M.petalDance, 99, 0.35],
  ['geodude', 'Geodude', 74, 'rock', [56, 10, 3.2, 4.5, 1.5], M.rockThrow, 2, 0.9, lv('graveler', 25)],
  ['graveler', 'Graveler', 75, 'rock', [72, 13, 3.3, 4.5, 1.5], M.rockThrow2, 10, 0.6, lv('golem', 32)],
  ['golem', 'Golem', 76, 'rock', [92, 17, 3.4, 5, 1.6], M.rockSlide, 99, 0.3],
  ['vulpix', 'Vulpix', 37, 'fire', [36, 11, 5.6, 4.5, 1.2], M.ember, 2, 0.85, st(['ninetales', 'fire-stone'])],
  ['ninetales', 'Ninetales', 38, 'fire', [56, 15, 6, 5.5, 1.2], M.flamethrower, 12, 0.4],
  ['psyduck', 'Psyduck', 54, 'water', [46, 10, 4, 5, 1.4], M.waterGun, 2, 0.85, lv('golduck', 33)],
  ['golduck', 'Golduck', 55, 'water', [64, 14, 4.6, 6, 1.3], M.hydroPump, 12, 0.4],
  ['machop', 'Machop', 66, 'fighting', [52, 13, 4.5, 1.6, 1.1], M.karateChop, 3, 0.8, lv('machoke', 28)],
  ['machoke', 'Machoke', 67, 'fighting', [66, 16, 4.6, 1.7, 1.1], M.karateChop, 10, 0.55, lv('machamp', 34)],
  ['machamp', 'Machamp', 68, 'fighting', [84, 21, 4.8, 1.8, 1.1], M.crossChop, 99, 0.3],
  ['magnemite', 'Magnemite', 81, 'electric', [34, 11, 4, 5.5, 1.3], M.thunderShock, 3, 0.8, lv('magneton', 30)],
  ['magneton', 'Magneton', 82, 'electric', [54, 15, 4.2, 6, 1.3], M.thunderbolt, 11, 0.5],
  ['gastly', 'Gastly', 92, 'ghost', [32, 12, 5, 4, 1.2], M.nightShade, 4, 0.75, lv('haunter', 25)],
  ['haunter', 'Haunter', 93, 'ghost', [44, 15, 5.3, 5, 1.2], M.shadowBall, 11, 0.55, lv('gengar', 32)],
  ['gengar', 'Gengar', 94, 'ghost', [60, 19, 5.6, 5.5, 1.2], M.shadowBall2, 99, 0.3],
  ['abra', 'Abra', 63, 'psychic', [30, 14, 4.5, 6, 1.5], M.confusion, 5, 0.7, lv('kadabra', 16)],
  ['kadabra', 'Kadabra', 64, 'psychic', [42, 18, 4.7, 6, 1.5], M.psybeam, 11, 0.5, lv('alakazam', 30)],
  ['alakazam', 'Alakazam', 65, 'psychic', [56, 23, 5, 6.5, 1.5], M.psychic, 99, 0.3],
  ['eevee', 'Eevee', 133, 'normal', [44, 11, 5.4, 4.5, 1.1], M.swift, 3, 0.6, st(['vaporeon', 'water-stone'], ['jolteon', 'thunder-stone'], ['flareon', 'fire-stone'])],
  ['vaporeon', 'Vaporeon', 134, 'water', [92, 15, 4.6, 5.5, 1.3], M.waterPulse, 99, 0.3],
  ['jolteon', 'Jolteon', 135, 'electric', [52, 18, 7, 6.5, 0.85], M.thunderbolt, 99, 0.3],
  ['flareon', 'Flareon', 136, 'fire', [62, 23, 5.4, 1.7, 1.0], M.fireFang, 99, 0.3],
];

const FLOATERS = new Set(['pidgey', 'pidgeotto', 'pidgeot', 'magnemite', 'magneton', 'gastly', 'haunter', 'charizard']);

const BLURBS: Record<string, string> = {
  bulbasaur: 'Sturdy and steady. Razor Leaf from range — great against water and rock.',
  charmander: 'Hard-hitting Ember. Scorches grass types, evolves into a close-range brawler.',
  squirtle: 'Tanky shell, Water Gun stream. Douses fire and rock types.',
};

export const SPECIES: Species[] = ROWS.map(([id, name, dex, type, [hp, atk, speed, range, cooldown], move, minRound, catchRate, evos]) => ({
  id, name, dex, type, hp, atk, speed, range, cooldown, move, minRound, catchRate,
  float: FLOATERS.has(id) || undefined,
  evos,
  blurb: BLURBS[id],
}));

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export const STARTERS = ['bulbasaur', 'charmander', 'squirtle'];

/** Item sprites used for reward icons and the thrown ball. */
export const ITEMS = ['poke-ball', 'great-ball', 'hyper-potion', 'max-revive', 'rare-candy', 'x-attack', 'focus-band', ...Object.keys(STONE_NAME)];

/** Battle-fx sprites used outside of moves. */
export const FX_EXTRA = ['impact', 'shine', 'alpha', 'electroball'];

export const MUSIC = { battle: 'hgss-kanto-trainer', boss: 'bw2-kanto-gym-leader' };

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
