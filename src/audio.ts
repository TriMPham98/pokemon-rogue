import type { MoveKind, PType } from './data';
import { url } from './assets';

const MUSIC_VOL = 0.3;

/** Pokémon cries + music are real game audio (see scripts/fetch-assets.ts); SFX are synthesized chiptune blips. */
class AudioEngine {
  muted = (() => {
    try {
      return localStorage.getItem('pr-muted') === '1';
    } catch {
      return false;
    }
  })();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private cries = new Map<string, Promise<AudioBuffer | null>>();
  private gates = new Map<string, number>();
  private music: HTMLAudioElement | null = null;
  private musicName = '';
  private musicVol = MUSIC_VOL;

  /** Must be called from a user gesture before anything is audible. */
  unlock() {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(c.destination);
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('pr-muted', this.muted ? '1' : '0');
    } catch {}
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.7;
    if (this.music) this.music.muted = this.muted;
    return this.muted;
  }

  // ── real audio ──

  preloadCry(id: string) {
    if (!this.ctx || this.cries.has(id)) return this.cries.get(id);
    const p = fetch(url.cry(id))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((b) => this.ctx!.decodeAudioData(b))
      .catch(() => null);
    this.cries.set(id, p);
    return p;
  }

  async cry(id: string, vol = 0.5, rate = 1) {
    if (!this.ctx || !this.gate('cry', 250)) return;
    const buf = await this.preloadCry(id);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  playMusic(name: string) {
    if (this.musicName === name) return;
    this.musicName = name;
    this.stopMusic(false);
    const el = new Audio(url.music(name));
    el.loop = true;
    el.muted = this.muted;
    el.volume = 0;
    el.play().catch(() => {});
    this.fade(el, this.musicVol, 1200);
    this.music = el;
  }

  stopMusic(reset = true) {
    const old = this.music;
    if (old) this.fade(old, 0, 600, () => old.pause());
    this.music = null;
    if (reset) this.musicName = '';
  }

  /** Briefly lowers the music, e.g. under the catch jingle. */
  duck(ms: number) {
    const el = this.music;
    if (!el) return;
    this.fade(el, MUSIC_VOL * 0.25, 120);
    setTimeout(() => this.music === el && this.fade(el, MUSIC_VOL, 600), ms);
  }

  private fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void) {
    const from = el.volume, start = performance.now();
    const step = () => {
      const f = Math.min(1, (performance.now() - start) / ms);
      el.volume = from + (to - from) * f;
      if (f < 1) requestAnimationFrame(step);
      else done?.();
    };
    step();
  }

  // ── synth ──

  private gate(key: string, ms: number) {
    const now = performance.now();
    if ((this.gates.get(key) ?? 0) > now) return false;
    this.gates.set(key, now + ms);
    return true;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType = 'square', vol = 0.1, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, f0: number, f1: number, vol = 0.15, type: BiquadFilterType = 'bandpass', delay = 0, q = 1) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  throw() {
    this.noise(0.25, 600, 2400, 0.1);
    this.tone(300, 900, 0.18, 'sine', 0.05);
  }
  ballOpen() {
    this.tone(1200, 400, 0.12, 'square', 0.06);
    this.noise(0.15, 3000, 800, 0.08);
  }
  wobble() {
    this.tone(220, 180, 0.07, 'square', 0.07);
    this.tone(330, 260, 0.06, 'square', 0.05, 0.05);
  }
  caught() {
    this.tone(1400, 1400, 0.04, 'square', 0.1);
    [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.07, 0.25 + i * 0.12));
    this.tone(1047, 1047, 0.4, 'square', 0.07, 0.61);
  }
  breakFree() {
    this.noise(0.25, 1500, 300, 0.18, 'lowpass');
    this.tone(600, 150, 0.25, 'sawtooth', 0.06);
  }
  hit(mult: number) {
    if (!this.gate('hit', 70)) return;
    if (mult > 1) {
      this.noise(0.18, 2500, 400, 0.2, 'lowpass');
      this.tone(880, 1320, 0.12, 'square', 0.06);
    } else if (mult < 1) this.noise(0.12, 600, 200, 0.1, 'lowpass');
    else this.noise(0.12, 1600, 300, 0.14, 'lowpass');
  }
  move(type: PType, kind: MoveKind) {
    if (!this.gate(`move-${type}`, kind === 'spray' ? 250 : 120)) return;
    switch (type) {
      case 'fire': return this.noise(0.35, 700, 2600, 0.09);
      case 'water': return this.noise(0.35, 2400, 500, 0.09, 'bandpass', 0, 4);
      case 'grass': this.noise(0.2, 3000, 6000, 0.06, 'highpass'); return this.tone(1800, 2600, 0.1, 'sine', 0.03);
      case 'electric': this.tone(90, 70, 0.25, 'sawtooth', 0.06); return this.tone(1400, 300, 0.2, 'square', 0.035);
      case 'psychic': this.tone(400, 1200, 0.35, 'sine', 0.07); return this.tone(600, 1800, 0.35, 'triangle', 0.035);
      case 'ghost': return this.tone(220, 110, 0.4, 'triangle', 0.08);
      case 'rock': return this.noise(0.25, 500, 120, 0.16, 'lowpass');
      case 'flying': return this.noise(0.3, 900, 2200, 0.08);
      default: return this.noise(0.08, 1200, 400, 0.12, 'lowpass');
    }
  }
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.1, 'square', 0.05, i * 0.07));
  }
  /** Rising, accelerating shimmer under the evolution sequence (`dur` seconds). */
  evolve(dur: number) {
    let t = 0;
    for (let i = 0; t < dur - 0.1; i++) {
      const f = 330 * Math.pow(2, (i % 12) / 12) * (i >= 12 ? 2 : 1);
      this.tone(f, f, 0.12, 'triangle', 0.045, t);
      t += Math.max(0.06, 0.2 - i * 0.008);
    }
  }
  evolved() {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, f, i === 5 ? 0.5 : 0.13, 'square', 0.06, i * 0.13));
  }
  faint() {
    this.tone(600, 80, 0.6, 'square', 0.05);
  }
  hurt() {
    if (!this.gate('hurt', 200)) return;
    this.noise(0.2, 300, 80, 0.25, 'lowpass');
    this.tone(150, 60, 0.2, 'square', 0.07);
  }
  roundStart() {
    [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.05, i * 0.1));
    this.tone(784, 784, 0.3, 'square', 0.06, 0.3);
  }
  alpha() {
    this.tone(110, 55, 1, 'sawtooth', 0.08);
    this.noise(1, 200, 60, 0.18, 'lowpass');
  }
  dash() {
    this.noise(0.18, 400, 2000, 0.12);
  }
  shiny() {
    [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, f, 0.18, 'sine', 0.05, i * 0.07));
  }
  slamWarn() {
    this.tone(70, 110, 1.1, 'sawtooth', 0.05);
  }
  slam() {
    this.noise(0.6, 600, 60, 0.35, 'lowpass');
    this.tone(90, 40, 0.5, 'square', 0.1);
  }
  ui() {
    this.tone(880, 880, 0.05, 'square', 0.04);
  }
}

export const audio = new AudioEngine();
