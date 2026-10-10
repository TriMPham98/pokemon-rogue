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

export type Extra =
  | 'bulb' | 'shell' | 'wings' | 'magnets' | 'leaves' | 'arms'
  | 'aura' | 'bill' | 'beak' | 'crest' | 'cheeks';

/** Procedural look: every Pokémon is assembled from primitive shapes. */
export interface Look {
  body: number;
  accent?: number;
  belly?: number;
  eye?: number;
  bodyScale: [number, number, number];
  head?: number; // head radius; omitted = eyes sit on the body
  quad?: boolean; // four-legged, head in front
  float?: boolean;
  oneEye?: boolean;
  ears?: 'pointy' | 'round';
  earLen?: number;
  earTip?: number;
  tail?: 'flame' | 'bolt' | 'curl' | 'fan';
  extra?: Extra[];
}

export interface Species {
  id: string;
  name: string;
  type: PType;
  hp: number;
  atk: number;
  speed: number;
  range: number; // > 2.5 means it fires projectiles
  cooldown: number;
  minRound: number; // earliest round it appears in the wild
  catchRate: number;
  blurb: string;
  look: Look;
}

export const SPECIES: Species[] = [
  {
    id: 'bulbasaur', name: 'Bulbasaur', type: 'grass',
    hp: 50, atk: 10, speed: 4.4, range: 5, cooldown: 1.2, minRound: 6, catchRate: 0.55,
    blurb: 'Sturdy and steady. Fires Razor Leaf from range — great against water and rock.',
    look: { body: 0x7fd1b9, accent: 0x3fa45b, bodyScale: [0.95, 0.6, 1.1], head: 0.38, quad: true, ears: 'pointy', earLen: 0.45, extra: ['bulb'] },
  },
  {
    id: 'charmander', name: 'Charmander', type: 'fire',
    hp: 42, atk: 12, speed: 5, range: 1.6, cooldown: 0.9, minRound: 6, catchRate: 0.55,
    blurb: 'Fast melee brawler. Scratches hard and scorches grass types.',
    look: { body: 0xf28c3a, belly: 0xf7dc8f, bodyScale: [0.7, 0.85, 0.65], head: 0.36, tail: 'flame' },
  },
  {
    id: 'squirtle', name: 'Squirtle', type: 'water',
    hp: 54, atk: 9, speed: 4.2, range: 5, cooldown: 1.1, minRound: 6, catchRate: 0.55,
    blurb: 'Tanky shell, Water Gun from range. Douses fire and rock types.',
    look: { body: 0x8fd0ec, accent: 0x9c6234, belly: 0xf1e2a6, bodyScale: [0.8, 0.8, 0.7], head: 0.36, tail: 'curl', extra: ['shell'] },
  },
  {
    id: 'pikachu', name: 'Pikachu', type: 'electric',
    hp: 36, atk: 13, speed: 6, range: 6, cooldown: 1.0, minRound: 4, catchRate: 0.5,
    blurb: 'Glass cannon. Long-range Thunder Shock.',
    look: { body: 0xf8d838, accent: 0x8b5a2b, bodyScale: [0.6, 0.7, 0.55], head: 0.38, ears: 'pointy', earLen: 1.3, earTip: 0x222222, tail: 'bolt', extra: ['cheeks'] },
  },
  {
    id: 'rattata', name: 'Rattata', type: 'normal',
    hp: 30, atk: 8, speed: 5.6, range: 1.4, cooldown: 0.8, minRound: 1, catchRate: 1,
    blurb: 'Quick biter.',
    look: { body: 0x9b6fb5, belly: 0xf0e0b0, bodyScale: [0.7, 0.55, 0.95], head: 0.3, quad: true, ears: 'round', tail: 'curl' },
  },
  {
    id: 'pidgey', name: 'Pidgey', type: 'flying',
    hp: 32, atk: 8, speed: 5.4, range: 1.5, cooldown: 0.9, minRound: 1, catchRate: 1,
    blurb: 'Swooping pecks.',
    look: { body: 0xb5864f, accent: 0x8a5f33, belly: 0xf3dcb0, bodyScale: [0.75, 0.75, 0.75], head: 0.3, float: true, extra: ['wings', 'beak'] },
  },
  {
    id: 'oddish', name: 'Oddish', type: 'grass',
    hp: 38, atk: 9, speed: 3.8, range: 4.5, cooldown: 1.2, minRound: 1, catchRate: 1,
    blurb: 'Spits seeds from range.',
    look: { body: 0x4466b8, eye: 0xb0202a, bodyScale: [0.75, 0.75, 0.75], extra: ['leaves'] },
  },
  {
    id: 'geodude', name: 'Geodude', type: 'rock',
    hp: 56, atk: 10, speed: 3.2, range: 1.5, cooldown: 1.4, minRound: 2, catchRate: 0.9,
    blurb: 'Slow, tough rock puncher.',
    look: { body: 0x8d8a7e, bodyScale: [0.9, 0.8, 0.8], float: true, extra: ['arms'] },
  },
  {
    id: 'vulpix', name: 'Vulpix', type: 'fire',
    hp: 36, atk: 11, speed: 5.6, range: 4.5, cooldown: 1.1, minRound: 2, catchRate: 0.85,
    blurb: 'Lobs embers.',
    look: { body: 0xc96a3e, accent: 0xe08a52, bodyScale: [0.65, 0.55, 0.85], head: 0.32, quad: true, ears: 'pointy', earLen: 0.8, tail: 'fan' },
  },
  {
    id: 'psyduck', name: 'Psyduck', type: 'water',
    hp: 46, atk: 10, speed: 4, range: 5, cooldown: 1.3, minRound: 2, catchRate: 0.85,
    blurb: 'Confused, but sprays water.',
    look: { body: 0xf2cf55, bodyScale: [0.85, 0.85, 0.75], head: 0.4, extra: ['bill'] },
  },
  {
    id: 'machop', name: 'Machop', type: 'fighting',
    hp: 52, atk: 13, speed: 4.5, range: 1.6, cooldown: 1.0, minRound: 3, catchRate: 0.8,
    blurb: 'Heavy hitter, shreds normal and rock types.',
    look: { body: 0x9fb0c4, accent: 0xd8c7a0, bodyScale: [0.75, 0.9, 0.6], head: 0.32, extra: ['crest', 'arms'] },
  },
  {
    id: 'magnemite', name: 'Magnemite', type: 'electric',
    hp: 34, atk: 11, speed: 4, range: 5.5, cooldown: 1.2, minRound: 3, catchRate: 0.8,
    blurb: 'Zaps from afar.',
    look: { body: 0xb9c3cc, bodyScale: [0.7, 0.7, 0.7], float: true, oneEye: true, extra: ['magnets'] },
  },
  {
    id: 'gastly', name: 'Gastly', type: 'ghost',
    hp: 32, atk: 12, speed: 5, range: 4, cooldown: 1.1, minRound: 4, catchRate: 0.75,
    blurb: 'Spooky. Immune to normal moves.',
    look: { body: 0x2b2140, eye: 0xffffff, bodyScale: [0.8, 0.8, 0.8], float: true, extra: ['aura'] },
  },
  {
    id: 'abra', name: 'Abra', type: 'psychic',
    hp: 30, atk: 14, speed: 4.5, range: 6, cooldown: 1.4, minRound: 5, catchRate: 0.7,
    blurb: 'Psychic blasts from long range.',
    look: { body: 0xe7c04f, bodyScale: [0.7, 0.8, 0.6], head: 0.34, ears: 'pointy', earLen: 0.8 },
  },
];

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export const STARTERS = ['bulbasaur', 'charmander', 'squirtle'];

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
