import { STAT_KEYS, typeMultVs, type Move, type Species, type Stats, type Status } from './data';

/**
 * Battle maths from the main series (Gen 3+ stat, damage, capture and Gen 5 scaled-experience formulas), plus the
 * handful of knobs that turn a turn-based game into a real-time horde survival.
 */

// ───────────── balance knobs ─────────────

/** Wild level for a round: Route 1 starts at Lv2-4, Cerulean Cave (rounds 66-70) sits around Lv70 like Mewtwo. */
export const wildLevel = (round: number) => Math.min(100, 1 + round + Math.floor(Math.random() * 3));
/**
 * Wild Pokémon come in crowds while the games are 1-on-1, so their attacks are scaled down: gently ramping over the
 * first three areas while you build a team (45% at round 1, full power from round 16).
 */
export const wildPower = (round: number) => Math.min(1, 0.45 + 0.037 * (round - 1));
/** Wild Pokémon act less often than your trained team (cooldown multiplier; the party's is 1.1). */
export const WILD_TEMPO = 1.9;
/** Each area's 5th round ends with an evolved form of one of its basic Pokémon, a few levels above the rest. */
export const LEADER_LEVELS = 2;
/**
 * Experience is split like the old Exp. All: a lone starter gets all of it, a bigger team shares it, and nobody gets
 * less than EXP_FLOOR (so a full team doesn't stall).
 */
export const EXP_FLOOR = 0.3;
/**
 * The trainer isn't a Pokémon: a hit takes the fraction of HP it would take from a sturdy (base 80) Pokémon of the
 * attacker's level, scaled by this. Keeps the trainer's 100 HP meaningful at Lv5 and Lv70 alike.
 */
export const TRAINER_TAKEN = 0.28;
/** Seconds a bind (Fire Spin, Clamp) or String Shot lasts. */
export const TRAP_TIME = 4;
export const SLOW_TIME = 4;
/** Poison and burn: fraction of max HP lost per second. */
export const STATUS_DOT = 1 / 20;

// ───────────── stats ─────────────

export const randomIvs = (): Stats => ({
  hp: rnd32(), atk: rnd32(), def: rnd32(), spa: rnd32(), spd: rnd32(), spe: rnd32(),
});
const rnd32 = () => Math.floor(Math.random() * 32);

/** Real stat formula (neutral nature, no EVs). */
export function calcStats(base: Stats, ivs: Stats, level: number): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    const core = Math.floor(((2 * base[k] + ivs[k]) * level) / 100);
    out[k] = k === 'hp' ? core + level + 10 : core + 5;
  }
  return out;
}

/** What a fighter brings to the damage formula. */
export interface Fighter {
  sp: Species;
  level: number;
  stats: Stats;
  status: Status | null;
}

const REF_BASE = 80;
const refStat = (level: number, hp = false) => {
  const core = Math.floor(((2 * REF_BASE + 15) * level) / 100);
  return hp ? core + level + 10 : core + 5;
};

export interface Hit {
  dmg: number;
  mult: number; // type effectiveness
  crit: boolean;
}

/**
 * The main-series damage formula: ((2L/5 + 2) · Power · A/D / 50 + 2) · crit · random · STAB · type.
 * `def` null means the trainer, who takes a share of what a sturdy reference Pokémon would (see TRAINER_TAKEN).
 */
export function damage(att: Fighter, def: Fighter | null, mv: Move, trainerMaxHp = 100, typeless = false): Hit {
  const mult = def && !typeless ? typeMultVs(mv.type, def.sp) : 1;
  if (mv.power <= 0 && mv.fixed === undefined) return { dmg: 0, mult, crit: false };
  if (mult === 0) return { dmg: 0, mult, crit: false };
  let dmg: number;
  let crit = false;
  if (mv.fixed !== undefined) {
    dmg = mv.fixed === 'level' ? att.level : mv.fixed;
  } else {
    const phys = mv.cat === 'physical';
    const A = phys ? att.stats.atk : att.stats.spa;
    const D = def ? (phys || mv.vsDef ? def.stats.def : def.stats.spd) : refStat(att.level);
    crit = Math.random() < (mv.highCrit ? 1 / 8 : 1 / 24);
    dmg = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * mv.power * A) / D) / 50) + 2;
    if (crit) dmg *= 1.5;
    dmg *= 0.85 + Math.random() * 0.15;
    if (mv.type === att.sp.type || mv.type === att.sp.type2) dmg *= 1.5;
    dmg *= mult;
    if (phys && att.status === 'brn') dmg *= 0.5;
  }
  if (!def) dmg = (dmg / refStat(att.level, true)) * trainerMaxHp * TRAINER_TAKEN;
  return { dmg: Math.max(1, Math.round(dmg)), mult, crit };
}

// ───────────── catching ─────────────

/** Ball multipliers, as in the games. */
export const BALLS = { poke: { name: 'Poké Ball', mult: 1 }, great: { name: 'Great Ball', mult: 1.5 }, ultra: { name: 'Ultra Ball', mult: 2 } };
export type BallKind = keyof typeof BALLS;

/**
 * Gen 3/4 capture: a = (3M − 2H)·rate·ball·status / 3M, then four shake checks, which works out to (a/255)^¾.
 */
export function catchChance(sp: Species, hp: number, maxHp: number, ball: number, status: Status | null) {
  const a = (((3 * maxHp - 2 * Math.max(1, hp)) * sp.catchRate * ball) / (3 * maxHp)) * (status ? 1.5 : 1);
  return Math.min(1, Math.max(0.01, (a / 255) ** 0.75));
}

// ───────────── experience ─────────────

/** Gen 5 scaled experience: beating something above your level pays more, farming weaklings pays little. */
export function expGain(defeated: Fighter, receiverLevel: number, teamSize: number) {
  const L = defeated.level;
  const scale = ((2 * L + 10) / (L + receiverLevel + 10)) ** 2.5;
  return Math.floor(((defeated.sp.expYield * L) / 5) * scale * Math.max(EXP_FLOOR, 1 / Math.max(1, teamSize))) + 1;
}
