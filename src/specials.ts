import { mv, type Move, type PType, type Status } from './data';

/**
 * Specials: each party Pokémon charges one big move of its (first) type by battling, then you aim and unleash it with
 * its number key. They're where the strategy lives: where to drop them, in what order, and which matchups to save
 * them for (Sleep Powder a crowd before throwing balls, Surf to shove a pack off a weak teammate, …).
 */
export type SpecialAim =
  | 'cursor' // lands on the cursor
  | 'self' // erupts around the user
  | 'line' // pierces everything between the user and the cursor
  | 'chain' // strikes the `hits` foes nearest the cursor, one after another
  | 'leap' // the user flies to the cursor (Fighting: the foe nearest it) and crashes down
  | 'rage'; // erupts around the user, then it rampages: attacks faster and harder for `rage` seconds

export interface Special {
  name: string;
  desc: string;
  /** Type, power and category for the damage formula; `fx` fills the area, `end` blooms on each foe hit. */
  move: Move;
  aim: SpecialAim;
  r: number; // radius (half-width for 'line')
  n?: number; // how many fx sprites fill the area
  rain?: boolean; // the fx fall from the sky before it lands
  status?: [Status, number];
  trap?: boolean;
  slow?: boolean;
  stun?: number; // seconds foes can't move or act (flinch, lifted by Psychic)
  knock?: number; // pushed away from the centre
  cloud?: number; // leaves a cloud that re-applies `status` for this many seconds
  hits?: number;
  recharge?: number; // the user can't act for this long afterwards
  rage?: number;
}

const P = 'physical', S = 'special';

export const SPECIALS: Record<PType, Special> = {
  normal: {
    name: 'Hyper Beam', desc: 'Pierces everything between it and the cursor. The user must recharge.', aim: 'line', r: 1.1, recharge: 2,
    move: mv('Hyper Beam', 'normal', S, 150, 'beam', 'orbs', 0.9, { tint: 0xffb060, end: 'explosion' }),
  },
  fire: {
    name: 'Fire Blast', desc: 'A huge blast of fire at the cursor. Often burns.', aim: 'cursor', r: 2.8, n: 7, status: ['brn', 0.5],
    move: mv('Fire Blast', 'fire', S, 110, 'burst', 'fire', 1.1, { end: 'explosion_2' }),
  },
  water: {
    name: 'Surf', desc: 'A tidal wave around the user that shoves every foe away.', aim: 'self', r: 4.5, n: 10, knock: 2.8,
    move: mv('Surf', 'water', S, 90, 'quake', 'water_droplet_2', 1.1, { end: 'water_impact' }),
  },
  grass: {
    name: 'Sleep Powder', desc: 'Puts everything at the cursor to sleep: no moving, no attacking, twice as easy to catch.', aim: 'cursor', r: 3.2, n: 16, rain: true,
    status: ['slp', 1],
    move: mv('Sleep Powder', 'grass', S, 0, 'burst', 'sleep_powder', 0.25),
  },
  electric: {
    name: 'Thunder', desc: 'Lightning strikes the five foes nearest the cursor. May paralyze.', aim: 'chain', r: 5, hits: 5, status: ['par', 0.3],
    move: mv('Thunder', 'electric', S, 110, 'bolt', 'lightning', 1.3, { end: 'shock' }),
  },
  ice: {
    name: 'Blizzard', desc: 'A storm of ice at the cursor that freezes foes in place.', aim: 'cursor', r: 3.2, n: 12, rain: true, trap: true, slow: true,
    move: mv('Blizzard', 'ice', S, 110, 'drop', 'ice_chunk', 0.8, { end: 'ice_chunk' }),
  },
  fighting: {
    name: 'Focus Punch', desc: 'Leaps onto the foe nearest the cursor with a crushing, stunning punch.', aim: 'leap', r: 1.8, knock: 3, stun: 1,
    move: mv('Focus Punch', 'fighting', P, 150, 'melee', 'red_fist', 1.4, { highCrit: true, end: 'hit' }),
  },
  poison: {
    name: 'Poison Gas', desc: 'Leaves a cloud at the cursor that poisons anything inside for 6 seconds.', aim: 'cursor', r: 3, n: 8, status: ['psn', 1], cloud: 6,
    move: mv('Poison Gas', 'poison', S, 20, 'burst', 'gray_smoke', 1.2, { tint: 0xd090ff, end: 'toxic_bubble' }),
  },
  ground: {
    name: 'Earthquake', desc: 'Shakes everything around the user. Walk it into the crowd first.', aim: 'self', r: 5, n: 10, stun: 0.6,
    move: mv('Earthquake', 'ground', P, 100, 'quake', 'rocks', 0.9, { end: 'explosion_4' }),
  },
  flying: {
    name: 'Fly', desc: 'Flies to the cursor and dives in, scattering the foes there.', aim: 'leap', r: 2.4, knock: 2.2,
    move: mv('Fly', 'flying', P, 90, 'melee', 'gust', 1.3, { end: 'hit' }),
  },
  psychic: {
    name: 'Psychic', desc: 'Lifts every foe at the cursor and holds them helpless for a moment.', aim: 'cursor', r: 3.4, stun: 2.5,
    move: mv('Psychic', 'psychic', S, 90, 'burst', 'thin_ring', 3.2, { tint: 0xff90c8, end: 'spiral' }),
  },
  bug: {
    name: 'Spider Web', desc: 'Nets everything at the cursor: they can’t move and slowly lose HP.', aim: 'cursor', r: 3.6, trap: true, slow: true,
    move: mv('Spider Web', 'bug', S, 20, 'burst', 'spider_web', 3.2, { end: 'string' }),
  },
  rock: {
    name: 'Rock Slide', desc: 'Rocks rain down on the cursor. Foes hit flinch.', aim: 'cursor', r: 3, n: 9, rain: true, stun: 1.2,
    move: mv('Rock Slide', 'rock', P, 100, 'drop', 'rocks', 0.9, { end: 'hit' }),
  },
  ghost: {
    name: 'Night Shade', desc: 'Damage equal to the user’s level to every foe at the cursor, whatever its defenses. Scares them stiff.', aim: 'cursor', r: 3.4, n: 6, stun: 1.2,
    move: mv('Night Shade', 'ghost', S, 0, 'burst', 'ghostly_spirit', 1.0, { fixed: 'level', end: 'purple_flame' }),
  },
  dragon: {
    name: 'Outrage', desc: 'Erupts around the user, then it rampages: double attack speed and +50% damage for 6 seconds.', aim: 'rage', r: 2.6, n: 6, rage: 6,
    move: mv('Outrage', 'dragon', P, 120, 'quake', 'blue_flames', 1.1, { tint: 0xc0a0ff, end: 'explosion' }),
  },
};
