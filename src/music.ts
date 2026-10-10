import { url } from './assets';

/**
 * A small player for FireRed/LeafGreen's music: the decomp's MIDI files (pret/pokefirered) voiced with the instruments
 * from each song's voicegroup, the way the GBA's m4a sound engine does it — pulse waves with the right duty cycle, the
 * wave channel's 4-bit shapes, LFSR noise, and the game's own sampled instruments with their ADSR envelopes.
 * `npm run assets` builds the per-song instrument JSON (see scripts/fetch-assets.ts).
 */

type Env = [attack: number, decay: number, sustain: number, release: number];
interface Voice {
  t: 'ds' | 'sq' | 'wave' | 'noise';
  key: number;
  env: Env;
  s?: string; // sample name
  fixed?: boolean; // no_resample: plays at the mixer rate whatever the note
  rev?: boolean;
  duty?: number;
  w?: string; // wave channel shape
  period?: number; // noise: 0 = 15-bit LFSR (hiss), 1 = 7-bit (metallic)
  drum?: boolean; // from a drum kit: the voice's own key sets the pitch
}
type Program = Voice | { t: 'split'; keys: Record<number, Voice> };
interface SongData {
  vol: number;
  programs: Record<number, Program>;
}

type Ev =
  | { t: number; ch: number; k: 'note'; key: number; vel: number; dur: number }
  | { t: number; ch: number; k: 'prog' | 'vol' | 'pan' | 'mod' | 'lfos' | 'bendr' | 'bend'; v: number };

interface Song {
  events: Ev[];
  loopStart: number; // seconds; the "[" / "]" markers mid2agb uses
  loopEnd: number;
  data: SongData;
}

interface Sample {
  buf: AudioBuffer;
  rate60: number; // playback rate that sounds MIDI key 60
  loop: [number, number] | null; // seconds
}

const GBA_MIXER_RATE = 13379; // FRLG's m4a mixing rate; no_resample samples play at it
const FRAME = 1 / 60;
const VOICE_GAIN = { ds: 0.9, sq: 0.16, wave: 0.28, noise: 0.16 };

// ───────────── loading ─────────────

const songCache = new Map<string, Promise<Song | null>>();
const sampleCache = new Map<string, Promise<Sample | null>>();
let wavesPromise: Promise<Record<string, string>> | null = null;

function parseMidi(buf: ArrayBuffer, data: SongData): Song {
  const b = new Uint8Array(buf);
  let p = 0;
  const u32 = () => ((b[p++] << 24) | (b[p++] << 16) | (b[p++] << 8) | b[p++]) >>> 0;
  const u16 = () => (b[p++] << 8) | b[p++];
  const vlq = () => {
    let v = 0, c;
    do {
      c = b[p++];
      v = (v << 7) | (c & 0x7f);
    } while (c & 0x80);
    return v;
  };
  p = 10;
  const ntr = u16(), div = u16();
  type Raw = { tick: number; ch: number; k: string; a: number; b: number };
  const raw: Raw[] = [];
  const tempos: [tick: number, usPerQuarter: number][] = [];
  let loopStartTick = -1, loopEndTick = -1, endTick = 0;
  for (let t = 0; t < ntr; t++) {
    p += 4;
    const end = u32() + p;
    let tick = 0, rs = 0;
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++;
      else st = rs;
      if (st === 0xff) {
        const ty = b[p++], len = vlq();
        if (ty === 0x51) tempos.push([tick, (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]]);
        if (ty === 0x06 || ty === 0x01) {
          const text = String.fromCharCode(...b.subarray(p, p + len));
          if (text === '[') loopStartTick = tick;
          if (text === ']') loopEndTick = tick;
        }
        p += len;
        endTick = Math.max(endTick, tick);
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        p += vlq();
        continue;
      }
      rs = st;
      const ty = st & 0xf0, ch = st & 15;
      const a = b[p++];
      const bb = ty === 0xc0 || ty === 0xd0 ? 0 : b[p++];
      raw.push({ tick, ch, k: ty.toString(16), a, b: bb });
      endTick = Math.max(endTick, tick);
    }
  }
  tempos.sort((x, y) => x[0] - y[0]);
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);
  const sec = (tick: number) => {
    let s = 0;
    for (let i = 0; i < tempos.length; i++) {
      const [t0, us] = tempos[i];
      const t1 = i + 1 < tempos.length ? Math.min(tick, tempos[i + 1][0]) : tick;
      if (t1 <= t0) break;
      s += ((t1 - t0) * us) / div / 1e6;
    }
    return s;
  };

  // Pair note-ons with note-offs per channel and key.
  raw.sort((x, y) => x.tick - y.tick);
  const events: Ev[] = [];
  const open = new Map<number, { ev: Ev & { k: 'note' }; tick: number }[]>();
  const close = (ch: number, key: number, tick: number) => {
    const list = open.get(ch * 128 + key);
    const n = list?.shift();
    if (n) n.ev.dur = Math.max(0.01, sec(tick) - n.ev.t);
  };
  for (const r of raw) {
    const t = sec(r.tick);
    if (r.k === '90' && r.b > 0) {
      const ev = { t, ch: r.ch, k: 'note' as const, key: r.a, vel: r.b, dur: 0.25 };
      events.push(ev);
      const id = r.ch * 128 + r.a;
      open.set(id, [...(open.get(id) ?? []), { ev, tick: r.tick }]);
    } else if (r.k === '80' || r.k === '90') close(r.ch, r.a, r.tick);
    else if (r.k === 'c0') events.push({ t, ch: r.ch, k: 'prog', v: r.a });
    else if (r.k === 'e0') events.push({ t, ch: r.ch, k: 'bend', v: ((r.b << 7) | r.a) - 8192 });
    else if (r.k === 'b0') {
      const k = ({ 7: 'vol', 10: 'pan', 1: 'mod', 21: 'lfos', 20: 'bendr' } as const)[r.a as 7];
      if (k) events.push({ t, ch: r.ch, k, v: r.b });
    }
  }
  // Controllers before notes at the same instant, so a note picks up its program/volume.
  events.sort((x, y) => x.t - y.t || (x.k === 'note' ? 1 : 0) - (y.k === 'note' ? 1 : 0));
  return {
    events,
    loopStart: loopStartTick >= 0 ? sec(loopStartTick) : 0,
    loopEnd: loopEndTick >= 0 ? sec(loopEndTick) : sec(endTick),
    data,
  };
}

/** WAV with pret's extra chunks: `agbp` is m4a's pitch field (Hz × 1024 at key 60), `agbl` the loop end. */
function parseWav(ctx: AudioContext, ab: ArrayBuffer): Sample | null {
  const v = new DataView(ab);
  let p = 12, rate = 0, bits = 8, pcm: Uint8Array | null = null, agbp = 0, agbl = -1, loopStart = -1, loopEnd = -1, unity = 60;
  while (p + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const len = v.getUint32(p + 4, true), d = p + 8;
    if (id === 'fmt ') (rate = v.getUint32(d + 4, true)), (bits = v.getUint16(d + 14, true));
    else if (id === 'data') pcm = new Uint8Array(ab, d, Math.min(len, v.byteLength - d));
    else if (id === 'agbp') agbp = v.getUint32(d, true);
    else if (id === 'agbl') agbl = v.getUint32(d, true);
    else if (id === 'smpl') {
      unity = v.getUint32(d + 12, true) || 60;
      if (v.getUint32(d + 28, true) > 0) (loopStart = v.getUint32(d + 44, true)), (loopEnd = v.getUint32(d + 48, true));
    }
    p = d + len + (len & 1);
  }
  if (!pcm || !rate) return null;
  const n = bits === 16 ? pcm.length >> 1 : pcm.length;
  const buf = ctx.createBuffer(1, Math.max(1, n), rate);
  const out = buf.getChannelData(0);
  if (bits === 16) {
    const dv = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
  } else for (let i = 0; i < n; i++) out[i] = (pcm[i] - 128) / 128;
  const at60 = agbp ? agbp / 1024 : rate * 2 ** ((60 - unity) / 12);
  if (agbl >= 0) loopEnd = agbl;
  const loop: [number, number] | null = loopStart >= 0 && loopEnd > loopStart ? [loopStart / rate, loopEnd / rate] : null;
  return { buf, rate60: at60 / rate, loop };
}

function loadSample(ctx: AudioContext, name: string) {
  let s = sampleCache.get(name);
  if (!s) {
    s = fetch(url.musicSample(name))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((ab) => parseWav(ctx, ab))
      .catch(() => null);
    sampleCache.set(name, s);
  }
  return s;
}

function loadSong(ctx: AudioContext, name: string) {
  let s = songCache.get(name);
  if (!s) {
    s = (async () => {
      try {
        const [data, mid] = await Promise.all([
          fetch(url.musicData(name)).then((r) => r.json() as Promise<SongData>),
          fetch(url.musicMidi(name)).then((r) => r.arrayBuffer()),
        ]);
        const song = parseMidi(mid, data);
        // Fetch the samples the song actually plays.
        const used = new Set<string>();
        const progs = new Map<number, number>();
        for (const e of song.events) {
          if (e.k === 'prog') progs.set(e.ch, e.v);
          if (e.k !== 'note') continue;
          const v = pickVoice(data, progs.get(e.ch) ?? 0, e.key);
          if (v?.s) used.add(v.s);
        }
        await Promise.all([...used].map((n) => loadSample(ctx, n)));
        return song;
      } catch {
        return null;
      }
    })();
    songCache.set(name, s);
  }
  return s;
}

function pickVoice(data: SongData, program: number, key: number): Voice | null {
  const p = data.programs[program];
  if (!p) return null;
  return p.t === 'split' ? p.keys[key] ?? null : p;
}

// ───────────── synthesis helpers ─────────────

const pulseWaves = new Map<number, PeriodicWave>();
function pulse(ctx: AudioContext, duty: number) {
  const d = [0.125, 0.25, 0.5, 0.75][duty & 3];
  let w = pulseWaves.get(d);
  if (!w) {
    const n = 64, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * d);
    pulseWaves.set(d, (w = ctx.createPeriodicWave(re, im)));
  }
  return w;
}

const gbWaves = new Map<string, PeriodicWave>();
function gbWave(ctx: AudioContext, name: string, hex: string) {
  let w = gbWaves.get(name);
  if (!w) {
    // 16 bytes → 32 four-bit samples, high nibble first.
    const s: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      s.push((byte >> 4) / 7.5 - 1, (byte & 15) / 7.5 - 1);
    }
    const n = 17, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      for (let j = 0; j < s.length; j++) {
        const a = (2 * Math.PI * k * j) / s.length;
        re[k] += (s[j] * Math.cos(a)) / s.length;
        im[k] += (s[j] * Math.sin(a)) / s.length;
      }
    }
    gbWaves.set(name, (w = ctx.createPeriodicWave(re, im)));
  }
  return w;
}

const noiseBufs = new Map<number, AudioBuffer>();
/** The GB noise channel's LFSR: 15-bit for hiss, 7-bit for a metallic, pitched buzz. */
function lfsrNoise(ctx: AudioContext, short: boolean) {
  let b = noiseBufs.get(short ? 1 : 0);
  if (!b) {
    const len = short ? 127 * 64 : ctx.sampleRate;
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let r = 0x7fff;
    const step = short ? 8 : 4; // samples per LFSR clock at key 60
    for (let i = 0; i < len; i++) {
      if (i % step === 0) {
        const bit = (r ^ (r >> 1)) & 1;
        r = (r >> 1) | (bit << 14);
        if (short) r = (r & ~0x40) | (bit << 6);
      }
      d[i] = r & 1 ? 0.6 : -0.6;
    }
    noiseBufs.set(short ? 1 : 0, b);
  }
  return b;
}

/** m4a's sampled-instrument envelope multiplies by k/256 every frame; as a WebAudio time constant: */
const tau = (k: number) => (k <= 0 ? 0.002 : k >= 255 ? 30 : -FRAME / Math.log(k / 256));

function reverb(ctx: AudioContext) {
  const len = Math.floor(ctx.sampleRate * 1.1);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

// ───────────── player ─────────────

interface Channel {
  gain: GainNode;
  pan: StereoPannerNode;
  bend: ConstantSourceNode; // cents, fed into every note's detune
  lfo: OscillatorNode;
  lfoDepth: GainNode; // vibrato depth in cents
  program: number;
  bendRange: number;
}

/** One song playing. Schedules ahead on the audio clock and loops between the song's markers. */
export class SongPlayer {
  readonly out: GainNode;
  private chans: Channel[] = [];
  private timer = 0;
  private idx = 0;
  private offset = 0; // context time of song time 0 for this pass
  private live = new Set<AudioScheduledSourceNode>();
  private stopped = false;
  readonly done: Promise<void>;
  private finish!: () => void;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private song: Song,
    private waves: Record<string, string>,
    private loop: boolean,
  ) {
    this.done = new Promise((r) => (this.finish = r));
    this.out = ctx.createGain();
    this.out.gain.value = song.data.vol / 127;
    this.out.connect(dest);
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    const rv = reverb(ctx);
    this.out.connect(rv).connect(wet).connect(dest);
    for (let i = 0; i < 16; i++) {
      const gain = ctx.createGain(), pan = ctx.createStereoPanner(), bend = ctx.createConstantSource();
      const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
      gain.gain.value = 100 / 127;
      bend.offset.value = 0;
      lfo.frequency.value = (22 * 60) / 256;
      lfoDepth.gain.value = 0;
      lfo.connect(lfoDepth);
      gain.connect(pan).connect(this.out);
      bend.start();
      lfo.start();
      this.chans.push({ gain, pan, bend, lfo, lfoDepth, program: 0, bendRange: 2 });
    }
  }

  start() {
    this.offset = this.ctx.currentTime + 0.08;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 60);
  }

  /** Stops now; anything already sounding is cut after `fade` seconds (the caller fades `out`). */
  stop(fade = 0) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const at = this.ctx.currentTime + fade;
    for (const s of this.live) {
      try {
        s.stop(at);
      } catch {}
    }
    setTimeout(() => {
      for (const c of this.chans) (c.bend.stop(), c.lfo.stop());
      this.out.disconnect();
      this.finish();
    }, (fade + 0.2) * 1000);
  }

  private pump() {
    const { events, loopStart, loopEnd } = this.song;
    const horizon = this.ctx.currentTime + 0.35;
    for (;;) {
      const e = events[this.idx];
      const pastLoop = !e || (this.loop && e.t >= loopEnd);
      if (pastLoop) {
        if (!this.loop) {
          // Let the tail ring out, then report done.
          const tail = this.offset + loopEnd - this.ctx.currentTime;
          if (tail < 0.5) this.stop(1.2);
          return;
        }
        this.offset += loopEnd - loopStart;
        this.idx = events.findIndex((x) => x.t >= loopStart);
        if (this.idx < 0 || loopEnd - loopStart < 0.5) return this.stop();
        continue;
      }
      const at = this.offset + e.t;
      if (at > horizon) return;
      this.idx++;
      this.apply(e, Math.max(at, this.ctx.currentTime), this.loop ? loopEnd - e.t : Infinity);
    }
  }

  private apply(e: Ev, at: number, maxDur: number) {
    const c = this.chans[e.ch];
    switch (e.k) {
      case 'prog': return void (c.program = e.v);
      case 'vol': return c.gain.gain.setValueAtTime(e.v / 127, at);
      case 'pan': return c.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, (e.v - 64) / 64)), at);
      case 'mod': return c.lfoDepth.gain.setValueAtTime(e.v * 3, at);
      case 'lfos': return c.lfo.frequency.setValueAtTime(Math.max(0.5, (e.v * 60) / 256), at);
      case 'bendr': return void (c.bendRange = e.v || 2);
      case 'bend': return c.bend.offset.setValueAtTime((e.v / 8192) * c.bendRange * 100, at);
      case 'note': return this.note(c, e.key, e.vel, at, Math.min(e.dur, maxDur));
    }
  }

  private note(c: Channel, key: number, vel: number, at: number, dur: number) {
    const v = pickVoice(this.song.data, c.program, key);
    if (!v) return;
    const ctx = this.ctx;
    const k = v.drum ? v.key : key;
    let src: AudioScheduledSourceNode & { detune: AudioParam };
    if (v.t === 'ds') {
      const ss = resolvedSamples.get(v.s!); // loaded before playback started (see createPlayer)
      if (!ss) return;
      const b = ctx.createBufferSource();
      b.buffer = v.rev ? reversed(ctx, ss.buf) : ss.buf;
      b.playbackRate.value = v.fixed ? GBA_MIXER_RATE / ss.buf.sampleRate : ss.rate60 * 2 ** ((k - 60) / 12);
      if (ss.loop && !v.rev) (b.loop = true), (b.loopStart = ss.loop[0]), (b.loopEnd = ss.loop[1]);
      src = b;
    } else if (v.t === 'noise') {
      const b = ctx.createBufferSource();
      b.buffer = lfsrNoise(ctx, v.period === 1);
      b.loop = true;
      b.playbackRate.value = Math.min(8, 2 ** ((k - 60) / 12));
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.setPeriodicWave(v.t === 'sq' ? pulse(ctx, v.duty ?? 2) : gbWave(ctx, v.w!, this.waves[v.w!] ?? '0123456789abcdeffedcba9876543210'));
      o.frequency.value = 440 * 2 ** ((k - 69) / 12);
      src = o;
    }
    c.bend.connect(src.detune);
    if (!v.drum) c.lfoDepth.connect(src.detune);

    const g = ctx.createGain();
    const peak = (vel / 127) * VOICE_GAIN[v.t];
    const [a, d, s, r] = v.env;
    const p = g.gain;
    p.setValueAtTime(0, at);
    let end: number;
    if (v.t === 'ds') {
      // Attack adds `a` (of 255) per frame; decay/release multiply by d/256, r/256 per frame.
      const att = a >= 255 ? 0.003 : (255 / Math.max(1, a)) * FRAME;
      p.linearRampToValueAtTime(peak, at + att);
      if (s < 255) p.setTargetAtTime(peak * (s / 255), at + att, tau(d));
      const off = at + Math.max(dur, att);
      holdAt(p, off);
      p.setTargetAtTime(0, off, tau(r));
      end = off + Math.min(4, tau(r) * 5 + 0.02);
    } else {
      // Game Boy channels: 16 volume steps, attack/decay/release are frames per step.
      const att = a * FRAME * 15 * 0.25 + 0.003;
      p.linearRampToValueAtTime(peak, at + att);
      const sus = peak * (s / 15);
      const dec = d ? d * FRAME * (15 - s) * 0.5 : 0.002;
      if (s < 15) p.linearRampToValueAtTime(sus, at + att + dec);
      const off = at + Math.max(dur, att);
      holdAt(p, off);
      const rel = r ? r * FRAME * 15 * 0.35 : 0.015;
      p.linearRampToValueAtTime(0, off + rel);
      end = off + rel + 0.02;
    }
    src.connect(g).connect(c.gain);
    src.start(at);
    src.stop(end);
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      g.disconnect();
      try {
        c.bend.disconnect(src.detune);
        if (!v.drum) c.lfoDepth.disconnect(src.detune);
      } catch {}
    };
  }
}

const resolvedSamples = new Map<string, Sample>();
const reversedBufs = new WeakMap<AudioBuffer, AudioBuffer>();
function reversed(ctx: AudioContext, b: AudioBuffer) {
  let r = reversedBufs.get(b);
  if (!r) {
    r = ctx.createBuffer(1, b.length, b.sampleRate);
    r.getChannelData(0).set([...b.getChannelData(0)].reverse());
    reversedBufs.set(b, r);
  }
  return r;
}

/** Freezes an envelope where it is at `t` (so the release starts from the current level). */
function holdAt(p: AudioParam, t: number) {
  const ap = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (ap.cancelAndHoldAtTime) ap.cancelAndHoldAtTime(t);
}

/** Loads a song (MIDI + instruments + samples) and returns a ready-to-start player, or null if it's missing. */
export async function createPlayer(ctx: AudioContext, dest: AudioNode, name: string, loop: boolean) {
  wavesPromise ??= fetch(url.musicData('waves'))
    .then((r) => r.json() as Promise<Record<string, string>>)
    .catch(() => ({}));
  const [song, waves] = await Promise.all([loadSong(ctx, name), wavesPromise]);
  if (!song) return null;
  // Resolve sample promises into a plain map so note scheduling never waits.
  for (const [n, pr] of sampleCache) if (!resolvedSamples.has(n)) {
    const s = await pr;
    if (s) resolvedSamples.set(n, s);
  }
  return new SongPlayer(ctx, dest, song, waves, loop);
}
